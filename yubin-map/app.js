// 郵便番号マップ
// 1. 全国の市区町村境界（TopoJSON）と、市区町村ごとの郵便番号一覧を読み込む
// 2. 入力された数字で始まる郵便番号を持つ市区町村を塗り、そこへズームする
//    （1桁ごとに候補が絞られていく）
// 3. 3桁以上入力されたら町（港町など）の一覧と位置を読み込む。市区町村が3つ以下に絞られたら
//    その町丁目の境界を重ね、候補の町を塗る。候補の町が少なくなったら町名を出してそこへ寄る
//    （市区町村の中での6・7桁目の違いが見えるように。境界が見つからない町はピンで示す）

const MAP_URL = 'data/municipalities.json';
const ZIP_URL = 'data/zipindex.json';
const TOWNS_URL = (head) => `data/towns/${head}.json`; // 上3桁ごとの町名・位置
const SHAPES_URL = (code) => `data/shapes/${code}.json`; // 市区町村ごとの町丁目境界
const TOWN_LAYER_LIMIT = 3; // 市区町村がこの数以下に絞られたら町丁目の境界を重ねる
const MAX_ZOOM = 8000; // 町が数百mおきに並ぶ都心部でもピンが重ならないところまで寄れるよう大きめ
// 塗った地域が画面の何割を占めるまで寄るか。
// 1〜3市区町村なら周りの地域も見えるよう控えめに、それより多いときは候補全体が大きく見えるように
const FIT_RATIO_FEW = 0.3;
const FIT_RATIO_MANY = 0.8;
const FAR_ISLANDS = '13421'; // 小笠原村
const OUTLINE_LIMIT = 30; // 候補がこの数以下になったら外枠を描く
const PIN_LIMIT = 15;     // 候補の町がこの数以下になったらピンを立てる
const DEFAULT_MESSAGE = '郵便番号を1桁ずつ入力すると、該当する地域が絞り込まれます';

const svg = d3.select('#map');
const g = svg.append('g');
const pinLayer = svg.append('g').attr('class', 'pin-layer'); // ピンは拡大しても大きさを変えないので地図とは別の層
const input = document.getElementById('zip-input');
const form = document.getElementById('search-form');
const resultEl = document.getElementById('result');

let features = [];       // 市区町村ごとの地形
let byCode = new Map();  // 市区町村コード → 地形（飛び地で複数あることも）
let zipIndex = [];       // [市区町村コード, [[上3桁, [下4桁...]], ...]]
let path = null;
let projection = null;
let currentPins = [];    // いま立てているピン { name, lng, lat }
const townCache = new Map(); // 上3桁 → 町データ（読み込み済み）
const shapeData = new Map();    // 市区町村コード → 町丁目の地形（読み込み済み）
const shapeLoading = new Map(); // 市区町村コード → 読み込み中の Promise
let muniPaths = null;
let currentHits = [];    // いま塗っている市区町村
let currentFocus = null; // いまズームしている範囲（画面サイズが変わったら同じ範囲に寄り直す）
let requestId = 0;       // 古い検索結果で上書きしないための番号

const zoom = d3.zoom()
  .scaleExtent([1, MAX_ZOOM])
  .on('zoom', (e) => {
    g.attr('transform', e.transform);
    placePins(e.transform);
  });
svg.call(zoom).on('dblclick.zoom', null);

// 「横浜市」+「中区」→「横浜市中区」。郵便番号データの市区町村名と同じ形にそろえる
const fullName = (f) => (f.properties.N03_003 || '') + (f.properties.N03_004 || '');
// 画面表示用。東京都の島しょ部に付く「大島支庁」などは住所に含まれないので外す
const displayName = (f) => fullName(f).replace(/^.+支庁/, '');

// ---------- データの読み込みと描画 ----------
Promise.all([d3.json(MAP_URL), d3.json(ZIP_URL)]).then(([topo, zips]) => {
  const obj = Object.values(topo.objects)[0];
  features = topojson.feature(topo, obj).features;
  features.forEach((f) => {
    const code = f.properties.N03_007;
    if (!byCode.has(code)) byCode.set(code, []);
    byCode.get(code).push(f);
  });
  // { "13101": { "100": "0000 0001 ..." } } を検索しやすい配列に直す
  zipIndex = Object.entries(zips).map(([code, groups]) =>
    [code, Object.entries(groups).map(([head, tails]) => [head, tails.split(' ')])]);

  muniPaths = g.selectAll('path.muni')
    .data(features)
    .join('path')
    .attr('class', 'muni');
  muniPaths.append('title').text((f) => f.properties.N03_001 + displayName(f));

  g.append('g').attr('class', 'town-layer'); // 町丁目の境界（市区町村の塗りの上、県境の下）

  // 隣り合う市区町村の都道府県が違うところだけを線にする → 県境
  const prefMesh = topojson.mesh(topo, obj, (a, b) => a.properties.N03_001 !== b.properties.N03_001);
  g.append('path').attr('class', 'pref-border').datum(prefMesh);
  g.append('g').attr('class', 'hit-layer');
  g.append('g').attr('class', 'target-layer'); // タイムアタックの出題地域（いちばん上に枠で示す）

  draw();
  document.getElementById('loading').remove();
  new ResizeObserver(debounce(draw, 150)).observe(document.getElementById('map-wrap'));
  if (input.value) update(normalize(input.value).slice(0, 7));
}).catch(() => {
  document.getElementById('loading').textContent = '地図データを読み込めませんでした';
});

// 画面サイズに合わせて地図を描き直す
function draw() {
  const { width, height } = svg.node().getBoundingClientRect();
  if (!width || !height) {
    // 画面の切り替え途中などで地図の大きさが0のときは描かない。まだ一度も描けていなければ少し待って再挑戦
    if (!path) setTimeout(draw, 200);
    return;
  }
  svg.attr('viewBox', `0 0 ${width} ${height}`);
  zoom.extent([[0, 0], [width, height]]).translateExtent([[-width, -height], [width * 2, height * 2]]);

  // 南鳥島・沖ノ鳥島（小笠原村）まで入れると本土が小さくなるので、全体表示の範囲からは外す
  const mainland = features.filter((f) => f.properties.N03_007 !== FAR_ISLANDS);
  projection = d3.geoMercator().fitExtent(
    [[16, 16], [width - 16, height - 16]],
    { type: 'FeatureCollection', features: mainland }
  );
  path = d3.geoPath(projection);
  muniPaths.attr('d', path);
  g.select('.pref-border').attr('d', path);
  g.select('.hit-layer').selectAll('path').attr('d', path);
  g.select('.town-layer').selectAll('path').attr('d', path);
  g.select('.target-layer').selectAll('path').attr('d', path);

  if (currentFocus) applyFocus(currentFocus, 0);
  else svg.call(zoom.transform, d3.zoomIdentity);
}

// ---------- 色付けとズーム ----------
function highlight(hits) {
  currentHits = hits;
  const prefs = new Set(hits.map((f) => f.properties.N03_001));
  const hitSet = new Set(hits);
  muniPaths
    .classed('in-pref', (f) => prefs.has(f.properties.N03_001))
    .classed('hit', (f) => hitSet.has(f));
  // 選ばれた地域の外枠を一番上に重ねて見やすくする。
  // 候補が多いときは白い枠線だらけで色が見えなくなるので、塗りと同じ色の枠線にする
  // （小さな島でも色が付いているのが分かるように、枠線自体は残す）
  g.select('.hit-layer').selectAll('path')
    .data(hits)
    .join('path')
    .attr('class', hits.length <= OUTLINE_LIMIT ? 'hit-outline' : 'hit-outline many')
    .attr('d', path);
}

// 市区町村に寄る。1〜3市区町村なら周りも見えるよう控えめに、それより多いときは大きく
function zoomTo(targets, duration = 900) {
  if (!targets.length) return;
  applyFocus({ features: targets }, duration);
}

// ピン（町の位置）に寄る。この地図には道路などがなく深く寄っても位置が分かりにくいので、
// ピン1本のときは市区町村の大きさの半分以上を映し、市区町村の中のどのあたりかが分かるようにする。
// 複数のときはピン同士が重ならないよう、ピンの広がりに合わせて寄る
function zoomToPins(pins, muni, duration = 900) {
  if (!pins.length) return;
  applyFocus({ pins, muni }, duration);
}

function applyFocus(focus, duration) {
  currentFocus = focus;
  let box;
  let ratio;
  if (focus.towns) {
    // 町丁目の境界（と、境界のない町のピン）がすべて入る範囲
    box = boundsOf(focus.towns);
    focus.extraPins.forEach((p) => {
      const [x, y] = projection([p.lng, p.lat]);
      box = [Math.min(box[0], x), Math.min(box[1], y), Math.max(box[2], x), Math.max(box[3], y)];
    });
    ratio = focus.ratio;
  } else if (focus.pins) {
    const pts = focus.pins.map((p) => projection([p.lng, p.lat]));
    box = [d3.min(pts, (p) => p[0]), d3.min(pts, (p) => p[1]), d3.max(pts, (p) => p[0]), d3.max(pts, (p) => p[1])];
    const [mx0, my0, mx1, my1] = boundsOf(focus.muni);
    const minSpan = Math.max(mx1 - mx0, my1 - my0) * (focus.pins.length === 1 ? 0.5 : 0.03);
    const cx = (box[0] + box[2]) / 2;
    const cy = (box[1] + box[3]) / 2;
    const half = Math.max(box[2] - box[0], box[3] - box[1], minSpan) / 2;
    box = [cx - half, cy - half, cx + half, cy + half];
    ratio = 0.7;
  } else {
    box = boundsOf(focus.features);
    ratio = focus.ratio || (focus.features.length <= 3 ? FIT_RATIO_FEW : FIT_RATIO_MANY);
  }
  zoomToBox(box, ratio, duration);
}

function boundsOf(fs) {
  let [x0, y0, x1, y1] = [Infinity, Infinity, -Infinity, -Infinity];
  fs.forEach((f) => {
    const [[a, b], [c, d]] = path.bounds(f);
    x0 = Math.min(x0, a); y0 = Math.min(y0, b);
    x1 = Math.max(x1, c); y1 = Math.max(y1, d);
  });
  return [x0, y0, x1, y1];
}

function zoomToBox([x0, y0, x1, y1], ratio, duration) {
  const { width, height } = svg.node().getBoundingClientRect();
  if (!width || !height || ![x0, y0, x1, y1].every(Number.isFinite)) return; // 計算できない範囲では動かさない
  // 候補が全国に散らばっているときは全国表示より引かない
  const scale = Math.max(1, Math.min(MAX_ZOOM, ratio / Math.max((x1 - x0) / width, (y1 - y0) / height)));
  const t = d3.zoomIdentity
    .translate(width / 2, height / 2)
    .scale(scale)
    .translate(-(x0 + x1) / 2, -(y0 + y1) / 2);
  svg.transition().duration(duration).call(zoom.transform, t);
}

// ---------- ピン ----------
function showPins(pins) {
  currentPins = pins;
  svg.classed('has-pins', pins.length > 0); // ピンがあるときは塗りを薄くしてピンを目立たせる
  const sel = pinLayer.selectAll('g.pin')
    .data(pins, (p) => p.name)
    .join((enter) => {
      const pin = enter.append('g').attr('class', 'pin');
      pin.append('circle').attr('r', 7);
      pin.append('text').attr('y', 5);
      return pin;
    });
  // 境界を塗った町は丸を付けず、町名だけを区画の真ん中に出す（labelOnly）
  sel.classed('label-only', (p) => !!p.labelOnly);
  sel.select('text').text((p) => p.name).attr('x', (p) => (p.labelOnly ? 0 : 11)); // 重なる町名は placePins で隠す
  placePins(d3.zoomTransform(svg.node()));
}

function placePins(t) {
  if (!projection || !Number.isFinite(t.k)) return;
  const pins = pinLayer.selectAll('g.pin');
  pins.each((p) => { p.xy = t.apply(projection([p.lng, p.lat])); })
    .attr('transform', (p) => `translate(${p.xy})`);
  // 町名が重なるときは、上から順に置いていき、先に置いた町名と重なるものは隠す
  const placed = [];
  pins.select('text').each(function (p) {
    const w = this.getComputedTextLength();
    const x0 = p.labelOnly ? p.xy[0] - w / 2 : p.xy[0];
    const box = [x0, p.xy[1] - 9, x0 + w + (p.labelOnly ? 0 : 11), p.xy[1] + 9];
    const hit = placed.some((b) => box[0] < b[2] && b[0] < box[2] && box[1] < b[3] && b[1] < box[3]);
    if (!hit) placed.push(box);
    d3.select(this).attr('visibility', hit ? 'hidden' : null);
  });
}

// ズームする範囲。塗った地域はすべて画面に収める（沖縄なども切らない）。
// ただし伊豆諸島・小笠原（東京都の「〇〇支庁」）は本州から1000km近く離れていて、
// 一緒に収めると東京の区が点になってしまうので、他に候補があるときはズーム範囲から外す（色は付ける）
const isTokyoIsland = (f) => (f.properties.N03_003 || '').endsWith('支庁');
function zoomArea(hits) {
  const main = hits.filter((f) => !isTokyoIsland(f));
  return main.length ? main : hits;
}

function resetMap() {
  highlight([]);
  showPins([]);
  clearTowns();
  currentFocus = null;
  svg.transition().duration(900).call(zoom.transform, d3.zoomIdentity);
}

// ---------- 郵便番号の先頭 → 市区町村 ----------
// 戻り値: [{ code, count }]（count はその市区町村で該当する郵便番号の件数）
function lookup(prefix) {
  const head = prefix.slice(0, 3);
  const tail = prefix.slice(3);
  const found = [];
  zipIndex.forEach(([code, groups]) => {
    let count = 0;
    groups.forEach(([key, tails]) => {
      // 「*」付きは事業所・私書箱用の番号。所在地が別の県のこともあるので7桁ぴったりのときだけ使う
      const isBiz = key[0] === '*';
      if (isBiz && prefix.length < 7) return;
      const h = isBiz ? key.slice(1) : key;
      if (prefix.length <= 3) {
        if (h.startsWith(prefix)) count += tails.length;
      } else if (h === head) {
        count += tail ? tails.filter((t) => t.startsWith(tail)).length : tails.length;
      }
    });
    if (count) found.push({ code, count });
  });
  return found;
}

// 住所（都道府県＋市区町村名）→ 地図の市区町村。地図データより新しい区名は「市」全体で代用
function findMunicipalities(r) {
  const inPref = features.filter((f) => f.properties.N03_001 === r.address1);
  const exact = inPref.filter((f) => fullName(f) === r.address2 || f.properties.N03_004 === r.address2);
  if (exact.length) return { hits: exact, approx: false };
  const city = inPref.filter((f) => {
    const c = f.properties.N03_003;
    return c && c.endsWith('市') && r.address2.startsWith(c);
  });
  return { hits: city, approx: city.length > 0 };
}

// ---------- 入力に合わせて表示を更新 ----------
function update(digits) {
  if (!features.length) return;
  if (!path) draw(); // まだ地図を描けていなければ先に描く
  if (!path) return;
  const id = ++requestId;
  if (!digits) {
    resetMap();
    showMessage(DEFAULT_MESSAGE);
    return;
  }

  const found = lookup(digits);
  const hits = found.flatMap((m) => byCode.get(m.code) || []);
  const zipCount = found.reduce((sum, m) => sum + m.count, 0);
  const label = `〒${formatPartial(digits)}`;

  if (!hits.length) {
    resetMap();
    showMessage(digits.length === 7
      ? `〒${formatZip(digits)} に該当する住所は見つかりませんでした`
      : `${label} で始まる郵便番号はありません`, true);
    return;
  }

  highlight(hits);
  if (digits.length < 3) clearTowns();
  showHtml(`${label}<br><span class="addr">${escapeHtml(summarize(hits))}</span>` +
    `<br><span class="note">${found.length}市区町村・郵便番号 ${zipCount.toLocaleString()} 件</span>`);

  // 3桁以上なら町の一覧を読み込んで、町名とピンを出す（読み込み済みならすぐ）
  if (digits.length >= 3) {
    const head = digits.slice(0, 3);
    if (townCache.has(head)) {
      showTowns(digits, townCache.get(head), hits);
      return;
    }
    d3.json(TOWNS_URL(head)).then((data) => {
      townCache.set(head, data);
      if (id === requestId) showTowns(digits, data, hits);
    }).catch(() => { /* 町データが読めなくても市区町村までの表示は残す */ });
  }
  showPins([]);
  zoomTo(zoomArea(hits));
}

// 町（港町・山下町など）の単位で候補をまとめ、少なければピンを立ててそこへ寄る
function showTowns(digits, data, hits) {
  const tail = digits.slice(3);
  const biz = new Set(data.b);
  const entries = Object.entries(data.z)
    .filter(([t]) => t.startsWith(tail) && (digits.length === 7 || !biz.has(t)));
  if (!entries.length) {
    showPins([]);
    zoomTo(zoomArea(hits));
    return;
  }

  // 同じ町に複数の番号があることもあるので、町ごとにまとめる
  const towns = new Map();
  entries.forEach(([t, [ci, name, lat, lng, shp]]) => {
    const key = data.c[ci] + '|' + name;
    if (!towns.has(key)) towns.set(key, { key, city: data.c[ci], name, lat, lng, shp });
  });
  const list = [...towns.values()];
  const named = list.filter((x) => x.name);
  const pref = hits[0].properties.N03_001;
  const cities = [...new Set(list.map((x) => x.city))];

  let html;
  if (digits.length === 7) {
    const [t, [ci, name]] = entries[0];
    const city = data.c[ci];
    html = `〒${formatZip(digits)}<br><span class="addr">${escapeHtml(pref + city + name)}</span>`;
    if (biz.has(t)) html += '<br><span class="note">事業所・私書箱用の郵便番号です</span>';
    if (findMunicipalities({ address1: pref, address2: city }).approx) {
      html += '<br><span class="note">地図の境界データが古いため、市全体を塗っています</span>';
    }
  } else {
    const head = cities.length === 1 ? pref + cities[0] : summarize(hits);
    const shown = named.slice(0, 3).map((x) => x.name).join('・');
    const more = named.length > 3 ? ` ほか${named.length - 3}町域` : '';
    html = `〒${formatPartial(digits)}<br><span class="addr">${escapeHtml(head)}` +
      (shown ? ` ${escapeHtml(shown)}${more}` : '') + '</span>' +
      `<br><span class="note">${named.length}町域・郵便番号 ${entries.length.toLocaleString()} 件</span>`;
  }
  showHtml(html);

  // 市区町村が3つ以下に絞られていれば町丁目の境界を重ねる（読み込み済みならすぐ）
  const codes = [...new Set(zoomArea(hits).map((f) => f.properties.N03_007))];
  if (codes.length > TOWN_LAYER_LIMIT) {
    clearTowns();
    showPinsOrMuni(named, hits);
    return;
  }
  if (codes.every((c) => shapeData.has(c))) {
    renderTowns(codes, list, named, hits);
    return;
  }
  showPinsOrMuni(named, hits); // 境界の読み込みが終わるまでは、これまでどおりピンで示す
  const id = requestId;
  Promise.all(codes.map(loadShapes)).then(() => {
    if (id === requestId) renderTowns(codes, list, named, hits);
  });
}

// 町丁目の境界がないときの表示: 候補の町が少なければピン、多ければ市区町村全体
function showPinsOrMuni(named, hits) {
  const pins = named.filter((x) => x.lat != null);
  if (named.length <= PIN_LIMIT && pins.length) {
    showPins(pins.map((x) => ({ name: x.name, lat: x.lat, lng: x.lng })));
    zoomToPins(pins, zoomArea(hits));
  } else {
    showPins([]);
    zoomTo(zoomArea(hits));
  }
}

// ---------- 町丁目の境界 ----------
function loadShapes(code) {
  if (!shapeLoading.has(code)) {
    shapeLoading.set(code, d3.json(SHAPES_URL(code)).then((topo) => {
      const fs = topojson.feature(topo, Object.values(topo.objects)[0]).features;
      fs.forEach((f, i) => { f.key = `${code}:${i}`; });
      shapeData.set(code, fs);
    }).catch(() => shapeData.set(code, []))); // 境界データがない市区町村（北方領土など）は空にしておく
  }
  return shapeLoading.get(code);
}

// 「14104:12,13|22131:5」→ ['14104:12', '14104:13', '22131:5']
const parseShapeRef = (ref) => (ref ? ref.split('|').flatMap((part) => {
  const [code, idx] = part.split(':');
  return idx.split(',').map((i) => `${code}:${i}`);
}) : []);

// 市区町村の中の町丁目をすべて線で描き、候補の町を塗る。候補が少なければ町名を出してそこへ寄る
function renderTowns(codes, list, named, hits) {
  const all = codes.flatMap((c) => shapeData.get(c) || []);
  const byKey = new Map(all.map((f) => [f.key, f]));
  const candidates = new Set();
  const shapesOf = new Map(); // 町 → その町の区画
  list.forEach((x) => {
    const fs = parseShapeRef(x.shp).map((k) => byKey.get(k)).filter(Boolean);
    fs.forEach((f) => candidates.add(f.key));
    if (fs.length) shapesOf.set(x.key, fs);
  });

  svg.classed('has-towns', all.length > 0); // 町を塗るときは市区町村の塗りを薄くする
  g.select('.town-layer').selectAll('path')
    .data(all, (f) => f.key)
    .join('path')
    .attr('class', (f) => (candidates.has(f.key) ? 'town hit' : 'town'))
    .attr('d', path);

  if (!all.length) {
    showPinsOrMuni(named, hits);
    return;
  }
  if (named.length > PIN_LIMIT) {
    // 候補の町が多いうちは町名を出さず、塗った町が画面いっぱいになるところまで寄る
    showPins([]);
    const shapes = all.filter((f) => candidates.has(f.key));
    if (shapes.length) applyFocus({ towns: shapes, extraPins: [], ratio: FIT_RATIO_MANY }, 900);
    else zoomTo(zoomArea(hits));
    return;
  }
  const marks = [];
  const focusShapes = [];
  named.forEach((x) => {
    const fs = shapesOf.get(x.key);
    if (fs) {
      focusShapes.push(...fs);
      const [lng, lat] = d3.geoCentroid({ type: 'FeatureCollection', features: fs });
      marks.push({ name: x.name, lat, lng, labelOnly: true });
    } else if (x.lat != null) {
      marks.push({ name: x.name, lat: x.lat, lng: x.lng }); // 境界が見つからない町はピンで示す
    }
  });
  showPins(marks);
  if (focusShapes.length) {
    // 町が1つなら周りの町も見えるよう控えめに、複数なら候補の町が大きく見えるように寄る
    applyFocus({ towns: focusShapes, extraPins: marks.filter((m) => !m.labelOnly), ratio: named.length === 1 ? 0.35 : 0.7 }, 900);
  } else if (marks.length) {
    zoomToPins(marks, zoomArea(hits));
  } else {
    zoomTo(zoomArea(hits));
  }
}

function clearTowns() {
  g.select('.town-layer').selectAll('path').remove();
  svg.classed('has-towns', false);
}

// 候補の市区町村を短い文にまとめる（例: 「東京都 千代田区・中央区・港区 ほか5市区町村」）
function summarize(hits) {
  const names = [];
  const prefs = [];
  hits.forEach((f) => {
    const p = f.properties.N03_001;
    const n = displayName(f);
    if (!prefs.includes(p)) prefs.push(p);
    if (!names.some((x) => x.p === p && x.n === n)) names.push({ p, n });
  });
  if (prefs.length > 1) {
    const shown = prefs.slice(0, 3).join('・');
    return prefs.length > 3 ? `${shown} ほか${prefs.length - 3}都道府県` : shown;
  }
  const shown = names.slice(0, 3).map((x) => x.n).join('・');
  return `${prefs[0]} ${shown}` + (names.length > 3 ? ` ほか${names.length - 3}市区町村` : '');
}

// ---------- 表示まわり ----------
function showMessage(text, isError = false) {
  resultEl.className = 'result' + (isError ? ' error' : '');
  resultEl.textContent = text;
}

function showHtml(html) {
  resultEl.className = 'result';
  resultEl.innerHTML = html;
}

// 全角数字やハイフンが混ざっていても数字だけを取り出す
function normalize(text) {
  return text.replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xFEE0)).replace(/\D/g, '');
}

const formatZip = (z) => (z.length > 3 ? z.slice(0, 3) + '-' + z.slice(3) : z);
// 未入力の桁を「＊」で埋める（例: 10 → 10＊-＊＊＊＊）
const formatPartial = (z) => formatZip(z.padEnd(7, '＊'));
const escapeHtml = (s) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function debounce(fn, ms) {
  let t;
  return () => { clearTimeout(t); t = setTimeout(fn, ms); };
}

// 入力欄の数字を「123-4567」の形で表示し、変わっていれば地図を更新する
let lastDigits = '';
function setDigits(text) {
  const digits = normalize(text).slice(0, 7);
  input.value = formatZip(digits);
  if (digits !== lastDigits) {
    lastDigits = digits;
    update(digits);
    if (window.onZipChange) window.onZipChange(digits); // タイムアタック（game.js）の正解判定
  }
}

// PC のキーボードや貼り付けでの入力
input.addEventListener('input', () => setDigits(input.value));

form.addEventListener('submit', (e) => {
  e.preventDefault();
  input.blur(); // スマホでキーボードを閉じて地図を見やすくする
});

// 画面のテンキー
document.querySelectorAll('#keypad [data-key]').forEach((btn) => {
  btn.addEventListener('click', () => setDigits(lastDigits + btn.dataset.key));
});
document.getElementById('bs-btn').addEventListener('click', () => setDigits(lastDigits.slice(0, -1)));
document.getElementById('clear-btn').addEventListener('click', () => setDigits(''));

document.getElementById('zoom-in').addEventListener('click', () => svg.transition().call(zoom.scaleBy, 2));
document.getElementById('zoom-out').addEventListener('click', () => svg.transition().call(zoom.scaleBy, 0.5));
document.getElementById('reset-btn').addEventListener('click', () => {
  svg.transition().duration(900).call(zoom.transform, d3.zoomIdentity);
});
