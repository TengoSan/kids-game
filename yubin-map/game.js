// タイムアタック
// 出題された地域（都道府県・市区町村・町）の郵便番号を、制限時間内にできるだけ多く入力する。
// 入力した番号で始まる郵便番号が、すべて出題された地域の中に入ったら正解（何桁目で正解してもよい）。
// app.js の地図・データ・入力処理をそのまま使う。

const LEVELS = {
  easy: { label: '初級', unit: '都道府県', time: 60 },
  normal: { label: '中級', unit: '市区町村', time: 90 },
  hard: { label: '上級', unit: '町', time: 120 },
};
const NEXT_DELAY = 700;  // 正解してから次の問題を出すまで（ミリ秒）
const PASS_DELAY = 1800; // パスしたとき答えの例を見せる時間（ミリ秒）

const modeTabs = document.querySelectorAll('.mode-tabs button');
const gameBar = document.getElementById('game-bar');
const gameCard = document.getElementById('game-card');
const questionEl = document.getElementById('game-question');
const timeEl = document.getElementById('game-time');
const timeBar = document.getElementById('game-time-bar');
const scoreEl = document.getElementById('game-score');
const statusEl = document.getElementById('game-status');

let game = null;     // 遊んでいる最中の状態
let mode = 'free';   // 'free'（自由入力）/ 'game'（タイムアタック）
let audio = null;    // 効果音（スタートボタンを押したときに用意する）

// ---------- 画面の切り替え ----------
modeTabs.forEach((btn) => btn.addEventListener('click', () => setMode(btn.dataset.mode)));

function setMode(next) {
  mode = next;
  modeTabs.forEach((b) => b.classList.toggle('active', b.dataset.mode === mode));
  document.body.classList.toggle('game-mode', mode === 'game');
  stopGame();
  setTarget(null);
  setDigits('');
  if (mode === 'game') showSetup();
  else {
    hideCard();
    gameBar.hidden = true;
  }
}

// 地図の上のカード（難易度選択・結果）。出している間はテンキーと入力欄を隠してカードを広く見せる
function showCard(html) {
  gameCard.innerHTML = html;
  gameCard.hidden = false;
  document.body.classList.add('card-open');
}

function hideCard() {
  gameCard.hidden = true;
  document.body.classList.remove('card-open');
}

// 難易度を選ぶカード
function showSetup() {
  gameBar.hidden = true;
  showCard(`
    <h2>タイムアタック</h2>
    <p>地図に青緑の枠で示した地域の郵便番号を入力してください。入力した番号で始まる郵便番号がすべてその地域に入れば正解です。何桁目で正解しても構いません。</p>
    <div class="level-buttons">
      ${Object.entries(LEVELS).map(([key, lv]) => `
        <button type="button" data-level="${key}">
          <span class="level-name">${lv.label}</span>
          <span class="level-desc">${lv.unit}・${lv.time}秒</span>
          <span class="level-best">自己ベスト ${loadBest(key)}問</span>
        </button>`).join('')}
    </div>`);
  gameCard.querySelectorAll('[data-level]').forEach((b) => b.addEventListener('click', () => startGame(b.dataset.level)));
}

function showResult() {
  const lv = LEVELS[game.level];
  const best = loadBest(game.level);
  const isNew = game.score > best;
  if (isNew) saveBest(game.level, game.score);
  gameBar.hidden = true;
  showCard(`
    <h2>終了</h2>
    <p class="final-score">${lv.label}（${lv.unit}）　正解 <strong>${game.score}</strong> 問</p>
    <p>${isNew ? '自己ベストを更新しました' : `自己ベスト ${Math.max(best, game.score)} 問`}${game.passes ? `　パス ${game.passes} 回` : ''}</p>
    <div class="card-actions">
      <button type="button" id="again-btn" class="primary">もう一度</button>
      <button type="button" id="level-btn">難易度を変える</button>
    </div>`);
  document.getElementById('again-btn').addEventListener('click', () => startGame(game.level));
  document.getElementById('level-btn').addEventListener('click', showSetup);
}

// ---------- ゲームの進行 ----------
function startGame(level) {
  initAudio();
  stopGame();
  game = {
    level,
    score: 0,
    passes: 0,
    endAt: performance.now() + LEVELS[level].time * 1000,
    waiting: false, // 正解・パスの直後で次の問題を待っている間は true
    recent: [],     // 同じ問題が続かないように直近の出題を覚えておく
    raf: 0,
  };
  hideCard();
  gameBar.hidden = false;
  scoreEl.textContent = '正解 0';
  nextQuestion();
  tick();
}

function stopGame() {
  if (game) {
    cancelAnimationFrame(game.raf);
    clearTimeout(game.nextTimer);
    game.over = true;
  }
}

// 残り時間の表示（requestAnimationFrame で画面の書き換えに合わせて更新）
function tick() {
  if (!game || game.over) return;
  const left = Math.max(0, game.endAt - performance.now());
  timeEl.textContent = `残り ${Math.ceil(left / 1000)}秒`;
  timeBar.style.width = `${(left / (LEVELS[game.level].time * 1000)) * 100}%`;
  timeBar.classList.toggle('low', left < 10000);
  if (left <= 0) {
    finishGame();
    return;
  }
  game.raf = requestAnimationFrame(tick);
}

function finishGame() {
  stopGame();
  playTone([392, 330, 262], 0.15);
  setTarget(null);
  setDigits('');
  showResult();
}

async function nextQuestion() {
  if (!game || game.over) return;
  game.waiting = true;
  questionEl.textContent = '出題中…';
  const target = await pickTarget(game.level);
  if (!game || game.over) return;
  game.recent = [target.id, ...game.recent].slice(0, 20);
  game.qno = (game.qno || 0) + 1;
  setTarget(target);
  questionEl.innerHTML = `<span class="qno">第${game.qno}問</span> ${escapeHtml(target.label)}`;
  setStatus('');
  game.waiting = false;
  setDigits('');
  showTargetArea(); // 入力が空のときは onZipChange が呼ばれないことがあるので、ここでも目標に寄る
}

document.getElementById('pass-btn').addEventListener('click', () => {
  if (!game || game.over || game.waiting) return;
  game.waiting = true;
  game.passes += 1;
  setStatus(`答えの例：〒${formatZip(game.target.example)}`, 'info');
  playTone([220], 0.12);
  game.nextTimer = setTimeout(nextQuestion, PASS_DELAY);
});

// ---------- 正解の判定 ----------
// app.js の setDigits から、入力が変わるたびに呼ばれる
window.onZipChange = (digits) => {
  if (mode !== 'game' || !game || game.over || game.waiting || !game.target) return;
  if (!digits) {
    setStatus('');
    showTargetArea();
    return;
  }
  judge(digits).then((result) => {
    if (!game || game.over || game.waiting || digits !== lastDigits) return; // 判定中に入力が変わった
    if (result === 'correct') {
      game.score += 1;
      game.waiting = true;
      scoreEl.textContent = `正解 ${game.score}`;
      setStatus('正解', 'correct');
      playTone([660, 880], 0.1);
      game.nextTimer = setTimeout(nextQuestion, NEXT_DELAY);
    } else if (result === 'off') {
      setStatus('この番号では範囲から外れています', 'off');
    } else {
      setStatus('');
    }
  });
};

// 'correct'（すべて目標の中）/ 'off'（目標が候補に入っていない）/ 'partial'（まだ絞り込み中）
async function judge(digits) {
  const t = game.target;
  const found = lookup(digits);
  if (!found.length) return 'off';
  const codes = found.map((m) => m.code);

  if (game.level === 'easy') {
    const prefs = new Set(codes.map((c) => byCode.get(c)[0].properties.N03_001));
    if (!prefs.has(t.pref)) return 'off';
    return prefs.size === 1 ? 'correct' : 'partial';
  }
  if (game.level === 'normal') {
    if (!codes.includes(t.code)) return 'off';
    return codes.length === 1 ? 'correct' : 'partial';
  }
  // 上級: 町の単位で判定する。3桁未満はまだ町が分からないので市区町村で判断
  if (!codes.some((c) => t.codes.includes(c))) return 'off';
  if (digits.length < 3) return 'partial';
  const data = await loadTowns(digits.slice(0, 3));
  const tail = digits.slice(3);
  const biz = new Set(data.b);
  const towns = Object.entries(data.z)
    .filter(([z]) => z.startsWith(tail) && (digits.length === 7 || !biz.has(z)))
    .map(([, [ci, name]]) => data.c[ci] + '|' + name);
  if (!towns.includes(t.townKey)) return 'off';
  return towns.every((k) => k === t.townKey) ? 'correct' : 'partial';
}

function loadTowns(head) {
  if (townCache.has(head)) return Promise.resolve(townCache.get(head));
  return d3.json(TOWNS_URL(head)).then((data) => {
    townCache.set(head, data);
    return data;
  });
}

// ---------- 出題 ----------
const pick = (list) => list[Math.floor(Math.random() * list.length)];

// どの郵便番号がどの市区町村に属するか（地図の境界が古く複数の区にまたがる番号は除く）
let exclusiveZips = null;
function getExclusiveZips() {
  if (exclusiveZips) return exclusiveZips;
  const owners = new Map(); // 郵便番号 → 市区町村コード（複数なら null）
  zipIndex.forEach(([code, groups]) => {
    groups.forEach(([key, tails]) => {
      if (key[0] === '*') return; // 事業所・私書箱用の番号は出題に使わない
      tails.forEach((tl) => {
        const z = key + tl;
        owners.set(z, owners.has(z) ? null : code);
      });
    });
  });
  exclusiveZips = new Map(); // 市区町村コード → その市区町村だけに属する郵便番号の一覧
  owners.forEach((code, z) => {
    if (!code) return;
    if (!exclusiveZips.has(code)) exclusiveZips.set(code, []);
    exclusiveZips.get(code).push(z);
  });
  return exclusiveZips;
}

async function pickTarget(level) {
  const zips = getExclusiveZips();
  const codes = [...zips.keys()].filter((c) => byCode.has(c));
  for (let tries = 0; tries < 30; tries++) {
    if (level === 'easy') {
      const pref = pick([...new Set(features.map((f) => f.properties.N03_001))]);
      if (game.recent.includes(pref)) continue;
      const prefCodes = codes.filter((c) => byCode.get(c)[0].properties.N03_001 === pref);
      const example = pick(zips.get(pick(prefCodes)));
      return { id: pref, pref, label: pref, example, features: features.filter((f) => f.properties.N03_001 === pref) };
    }
    const code = pick(codes);
    const fs = byCode.get(code);
    const pref = fs[0].properties.N03_001;
    if (level === 'normal') {
      if (game.recent.includes(code)) continue;
      return { id: code, code, pref, label: pref + displayName(fs[0]), example: pick(zips.get(code)), features: fs };
    }
    // 上級: その市区町村の郵便番号から1つ選び、その町を出題する（町の境界があるものだけ）
    const zip = pick(zips.get(code));
    const data = await loadTowns(zip.slice(0, 3));
    const entry = data.z[zip.slice(3)];
    if (!entry || !entry[1] || !entry[4]) continue;
    const [ci, name, , , shp] = entry;
    const townKey = data.c[ci] + '|' + name;
    if (game.recent.includes(townKey)) continue;
    const refs = parseShapeRef(shp);
    const refCodes = [...new Set(refs.map((r) => r.split(':')[0]))];
    await Promise.all(refCodes.map(loadShapes));
    const shapes = refs.map((r) => (shapeData.get(r.split(':')[0]) || [])[Number(r.split(':')[1])]).filter(Boolean);
    if (!shapes.length) continue;
    return {
      id: townKey, townKey, pref, label: pref + data.c[ci] + ' ' + name, example: zip,
      codes: lookup(zip).map((m) => m.code), // 地図の境界が古い場合は複数の区になる
      features: shapes, muni: fs,
    };
  }
  return pickTarget('normal'); // 条件に合う町が見つからなかったときは市区町村で出題
}

// ---------- 地図への表示 ----------
// 出題地域を青緑の枠で示す（ほかの塗りの上に重ねる）
function setTarget(target) {
  if (game) game.target = target;
  g.select('.target-layer').selectAll('path')
    .data(target ? target.features : [])
    .join('path')
    .attr('class', 'target-area')
    .attr('d', path);
}

// 入力が空のときは、出題地域とその周りが見えるところへ寄る
function showTargetArea() {
  const t = game && game.target;
  if (!t || !path) return;
  if (game.level === 'easy') {
    // 全国を映して、どの都道府県かが分かるように
    currentFocus = null;
    svg.transition().duration(900).call(zoom.transform, d3.zoomIdentity);
  } else if (game.level === 'normal') {
    // 都道府県全体を映して、その中のどこかが分かるように
    applyFocus({ features: zoomArea(features.filter((f) => f.properties.N03_001 === t.pref)), ratio: FIT_RATIO_MANY }, 900);
  } else {
    // 市区町村全体を映して、その中のどの町かが分かるように
    applyFocus({ towns: t.muni, extraPins: [], ratio: 0.8 }, 900);
  }
}

function setStatus(text, kind) {
  statusEl.textContent = text;
  statusEl.className = 'game-status' + (kind ? ` ${kind}` : '');
}

// ---------- 自己ベスト（この端末にだけ保存。保存できない環境でも遊べるようにする）----------
function loadBest(level) {
  try {
    return Number(localStorage.getItem(`yubin-map-best-${level}`)) || 0;
  } catch (e) {
    return 0;
  }
}

function saveBest(level, score) {
  try {
    localStorage.setItem(`yubin-map-best-${level}`, String(score));
  } catch (e) { /* 保存できなくても続ける */ }
}

// ---------- 効果音（Web Audio。ユーザーがボタンを押したあとに用意する）----------
function initAudio() {
  if (audio) return;
  try {
    audio = new (window.AudioContext || window.webkitAudioContext)();
  } catch (e) {
    audio = null;
  }
}

function playTone(freqs, length) {
  if (!audio) return;
  freqs.forEach((f, i) => {
    const t0 = audio.currentTime + i * length;
    const osc = audio.createOscillator();
    const gain = audio.createGain();
    osc.frequency.value = f;
    gain.gain.setValueAtTime(0.15, t0);
    gain.gain.exponentialRampToValueAtTime(0.001, t0 + length);
    osc.connect(gain).connect(audio.destination);
    osc.start(t0);
    osc.stop(t0 + length);
  });
}
