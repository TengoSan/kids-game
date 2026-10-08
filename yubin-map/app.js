// 郵便番号マップ
// 1. 全国の市区町村境界（TopoJSON）と、市区町村ごとの郵便番号一覧を読み込む
// 2. 入力された数字で始まる郵便番号を持つ市区町村を塗り、そこへズームする
//    （1桁ごとに候補が絞られていく）
// 3. 7桁そろったら zipcloud API で町名まで表示する

const MAP_URL = 'data/municipalities.json';
const ZIP_URL = 'data/zipindex.json';
const API_URL = 'https://zipcloud.ibsnet.co.jp/api/search?zipcode=';
const MAX_ZOOM = 600; // 東京の区など小さい地域まで寄れるよう大きめ
const FIT_RATIO = 0.3; // 塗った地域が画面の何割を占めるまで寄るか（周りの地域も見えるように控えめ）
const FAR_ISLANDS = '13421'; // 小笠原村
const DEFAULT_MESSAGE = '郵便番号を1桁ずつ入力すると、該当する地域が絞り込まれます';

const svg = d3.select('#map');
const g = svg.append('g');
const input = document.getElementById('zip-input');
const form = document.getElementById('search-form');
const resultEl = document.getElementById('result');

let features = [];       // 市区町村ごとの地形
let byCode = new Map();  // 市区町村コード → 地形（飛び地で複数あることも）
let zipIndex = [];       // [市区町村コード, [[上3桁, [下4桁...]], ...]]
let path = null;
let muniPaths = null;
let currentHits = [];    // いま塗っている市区町村
let requestId = 0;       // 古い検索結果で上書きしないための番号

const zoom = d3.zoom()
  .scaleExtent([1, MAX_ZOOM])
  .on('zoom', (e) => g.attr('transform', e.transform));
svg.call(zoom).on('dblclick.zoom', null);

// 「横浜市」+「中区」→「横浜市中区」。zipcloud の address2 と同じ形にそろえる
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

  // 隣り合う市区町村の都道府県が違うところだけを線にする → 県境
  const prefMesh = topojson.mesh(topo, obj, (a, b) => a.properties.N03_001 !== b.properties.N03_001);
  g.append('path').attr('class', 'pref-border').datum(prefMesh);
  g.append('g').attr('class', 'hit-layer');

  draw();
  document.getElementById('loading').remove();
  window.addEventListener('resize', debounce(draw, 200));
  if (input.value) update(normalize(input.value).slice(0, 7));
}).catch(() => {
  document.getElementById('loading').textContent = '地図データを読み込めませんでした';
});

// 画面サイズに合わせて地図を描き直す
function draw() {
  const { width, height } = svg.node().getBoundingClientRect();
  svg.attr('viewBox', `0 0 ${width} ${height}`);
  zoom.extent([[0, 0], [width, height]]).translateExtent([[-width, -height], [width * 2, height * 2]]);

  // 南鳥島・沖ノ鳥島（小笠原村）まで入れると本土が小さくなるので、全体表示の範囲からは外す
  const mainland = features.filter((f) => f.properties.N03_007 !== FAR_ISLANDS);
  const projection = d3.geoMercator().fitExtent(
    [[16, 16], [width - 16, height - 16]],
    { type: 'FeatureCollection', features: mainland }
  );
  path = d3.geoPath(projection);
  muniPaths.attr('d', path);
  g.select('.pref-border').attr('d', path);
  g.select('.hit-layer').selectAll('path').attr('d', path);

  if (currentHits.length) zoomTo(currentHits, 0);
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
  // 選ばれた地域の外枠を一番上に重ねて見やすくする
  g.select('.hit-layer').selectAll('path')
    .data(hits)
    .join('path')
    .attr('class', 'hit-outline')
    .attr('d', path);
}

function zoomTo(targets, duration = 900) {
  const { width, height } = svg.node().getBoundingClientRect();
  let [x0, y0, x1, y1] = [Infinity, Infinity, -Infinity, -Infinity];
  targets.forEach((f) => {
    const [[a, b], [c, d]] = path.bounds(f);
    x0 = Math.min(x0, a); y0 = Math.min(y0, b);
    x1 = Math.max(x1, c); y1 = Math.max(y1, d);
  });
  // 候補が全国に散らばっているときは全国表示より引かない
  const scale = Math.max(1, Math.min(MAX_ZOOM, FIT_RATIO / Math.max((x1 - x0) / width, (y1 - y0) / height)));
  const t = d3.zoomIdentity
    .translate(width / 2, height / 2)
    .scale(scale)
    .translate(-(x0 + x1) / 2, -(y0 + y1) / 2);
  svg.transition().duration(duration).call(zoom.transform, t);
}

// 候補が離島などに散らばっていても全国表示に戻らないよう、郵便番号の件数が多い地域を優先して寄る。
// 件数で重み付けした中心から近い順に、全体の9割の件数をカバーするまでの市区町村を返す
function mainArea(hits, weightOf) {
  if (hits.length <= 1) return hits;
  const pts = hits.map((f) => ({ f, c: path.centroid(f), w: weightOf(f) || 1 }));
  const total = pts.reduce((sum, p) => sum + p.w, 0);
  const cx = pts.reduce((sum, p) => sum + p.c[0] * p.w, 0) / total;
  const cy = pts.reduce((sum, p) => sum + p.c[1] * p.w, 0) / total;
  pts.sort((a, b) => Math.hypot(a.c[0] - cx, a.c[1] - cy) - Math.hypot(b.c[0] - cx, b.c[1] - cy));
  const result = [];
  let covered = 0;
  for (const p of pts) {
    result.push(p.f);
    covered += p.w;
    if (covered >= total * 0.9) break;
  }
  return result;
}

function resetMap() {
  highlight([]);
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
  requestId++;
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
    if (digits.length === 7) {
      fetchAddress(digits, []); // 手元のデータにない新しい番号の可能性があるので API でも確認
    } else {
      resetMap();
      showMessage(`${label} で始まる郵便番号はありません`, true);
    }
    return;
  }

  highlight(hits);
  const weight = new Map(found.map((m) => [m.code, m.count]));
  zoomTo(mainArea(hits, (f) => weight.get(f.properties.N03_007)));
  showHtml(`${label}<br><span class="addr">${escapeHtml(summarize(hits))}</span>` +
    `<br><span class="note">${found.length}市区町村・郵便番号 ${zipCount.toLocaleString()} 件</span>`);

  if (digits.length === 7) fetchAddress(digits, hits);
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

// 7桁そろったら町名まで調べる。手元のデータで見つからなかった番号もここで地図に反映する
async function fetchAddress(zip, localHits) {
  const id = requestId;
  try {
    const res = await fetch(API_URL + zip);
    const json = await res.json();
    if (id !== requestId) return; // 入力が変わっている
    if (json.status !== 200) throw new Error(json.message);
    if (!json.results) {
      if (!localHits.length) {
        resetMap();
        showMessage(`〒${formatZip(zip)} に該当する住所は見つかりませんでした`, true);
      }
      return;
    }
    const results = json.results;
    let hits = localHits;
    let approx = false;
    if (!hits.length) {
      hits = [...new Set(results.flatMap((r) => findMunicipalities(r).hits))];
      if (hits.length) { highlight(hits); zoomTo(hits); }
    }
    approx = results.some((r) => findMunicipalities(r).approx);

    const addrs = results.map((r) => r.address1 + r.address2 + r.address3);
    let html = `〒${formatZip(zip)}<br><span class="addr">${escapeHtml(addrs[0])}</span>`;
    if (addrs.length > 1) html += `<span class="note">（ほか ${addrs.length - 1} 件）</span>`;
    if (approx) html += '<br><span class="note">地図データが古いため、市全体を表示しています</span>';
    showHtml(html);
  } catch (err) {
    // 通信できなくても、手元のデータで塗った地図と市区町村名はそのまま残す
    if (id === requestId && !localHits.length) {
      showMessage('通信エラー：インターネット接続を確認してください', true);
    }
  }
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

// 入力欄：打ちながら「123-4567」の形に整え、1桁ごとに地図を更新する
let lastDigits = '';
input.addEventListener('input', () => {
  const digits = normalize(input.value).slice(0, 7);
  input.value = formatZip(digits);
  if (digits !== lastDigits) {
    lastDigits = digits;
    update(digits);
  }
});

form.addEventListener('submit', (e) => {
  e.preventDefault();
  input.blur(); // スマホでキーボードを閉じて地図を見やすくする
});

document.getElementById('clear-btn').addEventListener('click', () => {
  input.value = '';
  lastDigits = '';
  update('');
  input.focus();
});

document.getElementById('zoom-in').addEventListener('click', () => svg.transition().call(zoom.scaleBy, 2));
document.getElementById('zoom-out').addEventListener('click', () => svg.transition().call(zoom.scaleBy, 0.5));
document.getElementById('reset-btn').addEventListener('click', () => {
  svg.transition().duration(900).call(zoom.transform, d3.zoomIdentity);
});
