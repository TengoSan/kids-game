// 郵便番号マップ
// 1. 全国の市区町村境界（TopoJSON）を読み込んで地図を描く
// 2. 郵便番号を zipcloud API で住所に変換する
// 3. 住所の「都道府県＋市区町村名」と一致する地域を塗り、そこへズームする

const DATA_URL = 'data/municipalities.json';
const API_URL = 'https://zipcloud.ibsnet.co.jp/api/search?zipcode=';
const MAX_ZOOM = 600; // 東京の区など小さい地域まで寄れるよう大きめ
const FIT_RATIO = 0.3; // 塗った地域が画面の何割を占めるまで寄るか（周りの地域も見えるように控えめ）
const FAR_ISLANDS = '13421'; // 小笠原村

const svg = d3.select('#map');
const g = svg.append('g');
const input = document.getElementById('zip-input');
const form = document.getElementById('search-form');
const button = document.getElementById('search-btn');
const resultEl = document.getElementById('result');

let features = [];       // 市区町村ごとの地形
let prefMesh = null;     // 都道府県の境界線
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

// ---------- 地図の読み込みと描画 ----------
d3.json(DATA_URL).then((topo) => {
  const obj = Object.values(topo.objects)[0];
  features = topojson.feature(topo, obj).features;
  // 隣り合う市区町村の都道府県が違うところだけを線にする → 県境
  prefMesh = topojson.mesh(topo, obj, (a, b) => a.properties.N03_001 !== b.properties.N03_001);

  muniPaths = g.selectAll('path.muni')
    .data(features)
    .join('path')
    .attr('class', 'muni');
  muniPaths.append('title').text((f) => f.properties.N03_001 + fullName(f));

  g.append('path').attr('class', 'pref-border').datum(prefMesh);
  g.append('g').attr('class', 'hit-layer');

  draw();
  document.getElementById('loading').remove();
  window.addEventListener('resize', debounce(draw, 200));
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
function highlight(pref, hits) {
  currentHits = hits;
  muniPaths
    .classed('in-pref', (f) => f.properties.N03_001 === pref)
    .classed('hit', (f) => hits.includes(f));
  // 選ばれた地域の外枠を一番上に重ねて見やすくする
  g.select('.hit-layer').selectAll('path')
    .data(hits)
    .join('path')
    .attr('class', 'hit-outline')
    .attr('d', path);
}

function zoomTo(targets, duration = 1500) {
  const { width, height } = svg.node().getBoundingClientRect();
  let [x0, y0, x1, y1] = [Infinity, Infinity, -Infinity, -Infinity];
  targets.forEach((f) => {
    const [[a, b], [c, d]] = path.bounds(f);
    x0 = Math.min(x0, a); y0 = Math.min(y0, b);
    x1 = Math.max(x1, c); y1 = Math.max(y1, d);
  });
  const scale = Math.min(MAX_ZOOM, FIT_RATIO / Math.max((x1 - x0) / width, (y1 - y0) / height));
  const t = d3.zoomIdentity
    .translate(width / 2, height / 2)
    .scale(scale)
    .translate(-(x0 + x1) / 2, -(y0 + y1) / 2);
  svg.transition().duration(duration).call(zoom.transform, t);
}

function resetMap() {
  highlight(null, []);
  svg.transition().duration(1000).call(zoom.transform, d3.zoomIdentity);
}

// ---------- 住所 → 市区町村の照合 ----------
function findMunicipalities(r) {
  const inPref = features.filter((f) => f.properties.N03_001 === r.address1);
  const exact = inPref.filter((f) => fullName(f) === r.address2 || f.properties.N03_004 === r.address2);
  if (exact.length) return { hits: exact, approx: false };

  // 区の再編など、地図データ（2021年）より新しい住所の場合は「市」全体で塗る
  const city = inPref.filter((f) => {
    const c = f.properties.N03_003;
    return c && c.endsWith('市') && r.address2.startsWith(c);
  });
  return { hits: city, approx: city.length > 0 };
}

// ---------- 検索 ----------
// 全角数字やハイフンが混ざっていても7桁の数字だけを取り出す
function normalize(text) {
  return text.replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xFEE0)).replace(/\D/g, '');
}

async function search(zip) {
  if (!features.length) return;
  const id = ++requestId;
  button.disabled = true;
  showMessage('検索中…');
  try {
    const res = await fetch(API_URL + zip);
    const json = await res.json();
    if (id !== requestId) return; // もっと新しい検索が始まっている
    if (json.status !== 200) throw new Error(json.message || '検索に失敗しました');
    if (!json.results) {
      resetMap();
      showMessage(`〒${formatZip(zip)} に該当する住所が見つかりませんでした`, true);
      return;
    }
    showResult(zip, json.results);
  } catch (err) {
    if (id !== requestId) return;
    showMessage('通信エラー：インターネット接続を確認してください', true);
  } finally {
    if (id === requestId) button.disabled = false;
  }
}

function showResult(zip, results) {
  const pref = results[0].address1;
  const hits = new Set();
  let approx = false;
  results.forEach((r) => {
    const m = findMunicipalities(r);
    m.hits.forEach((f) => hits.add(f));
    approx = approx || m.approx;
  });
  const hitList = [...hits];

  const addrs = results.map((r) => r.address1 + r.address2 + r.address3);
  let html = `〒${formatZip(zip)}<br><span class="addr">${escapeHtml(addrs[0])}</span>`;
  if (addrs.length > 1) html += `<span class="note">（ほか ${addrs.length - 1} 件）</span>`;
  if (!hitList.length) html += '<br><span class="note">地図上の市区町村が見つからないため、都道府県のみ表示しています</span>';
  else if (approx) html += '<br><span class="note">地図データが古いため、市全体を塗っています</span>';
  resultEl.className = 'result';
  resultEl.innerHTML = html;

  highlight(pref, hitList);
  const target = hitList.length ? hitList : features.filter((f) => f.properties.N03_001 === pref);
  zoomTo(target);
}

function showMessage(text, isError = false) {
  resultEl.className = 'result' + (isError ? ' error' : '');
  resultEl.textContent = text;
}

const formatZip = (z) => z.slice(0, 3) + '-' + z.slice(3);
const escapeHtml = (s) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function debounce(fn, ms) {
  let t;
  return () => { clearTimeout(t); t = setTimeout(fn, ms); };
}

// 入力欄：打ちながら「123-4567」の形に整え、7桁そろったら自動で検索
let lastSearched = '';
input.addEventListener('input', () => {
  const digits = normalize(input.value).slice(0, 7);
  input.value = digits.length > 3 ? formatZip(digits) : digits;
  if (digits.length === 7 && digits !== lastSearched) {
    lastSearched = digits;
    search(digits);
  }
});

form.addEventListener('submit', (e) => {
  e.preventDefault();
  const digits = normalize(input.value);
  if (digits.length !== 7) {
    showMessage('郵便番号は7桁の数字で入力してください', true);
    return;
  }
  lastSearched = digits;
  search(digits);
});

document.getElementById('zoom-in').addEventListener('click', () => svg.transition().call(zoom.scaleBy, 2));
document.getElementById('zoom-out').addEventListener('click', () => svg.transition().call(zoom.scaleBy, 0.5));
document.getElementById('reset-btn').addEventListener('click', () => {
  svg.transition().duration(1000).call(zoom.transform, d3.zoomIdentity);
});
