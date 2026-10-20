'use strict';
// ピクセル・ホップ — オレンジのドットキャラクターの横スクロールアクション
(() => {
  // ===================== 基本設定 =====================
  const W = 480, H = 272, TS = 16, ROWS = 17;   // 画面 480x272、1タイル16px、縦17タイル
  const STEP = 1000 / 60;                        // 物理更新は60fps固定（端末差をなくすため）
  const PHYS = {
    g: 0.45, maxFall: 7.5,
    acc: 0.3, airAcc: 0.22, dec: 0.3, airDec: 0.06, max: 2.3,
    dashMax: 3.6,               // ダッシュ中の最高速度
    jump: 8.0, cut: 3.0,        // ボタンを離すと上昇を打ち切る（小ジャンプ）
    runJump: 0.5,               // 助走が速いほどジャンプが高くなる係数
    coyote: 6, buffer: 8,       // 足場を離れた直後・着地直前の入力も受け付ける猶予
  };
  const START_LIVES = 3;

  // タイル種別
  const T_EMPTY = 0, T_GROUND = 1, T_BRICK = 2, T_Q = 3, T_USED = 4, T_STONE = 5, T_ONEWAY = 6, T_SPIKE = 7;
  const SOLID = [false, true, true, true, true, true, false, false];

  // 色
  const C = {
    dirt: '#6A5546', dirtDark: '#5A4739', dirtDot: '#7C6453', edge: '#4B3B30',
    grass: '#7E9F57', grassLight: '#A3C26F', grassDark: '#647F44',
    brick: '#B8673F', brickDark: '#8F4D2E', brickLight: '#D08259',
    q: '#E9B24A', qDark: '#B98328', qLight: '#F7D78E', qMark: '#7A4E14',
    used: '#9C8B7C', usedDark: '#76675B', usedLight: '#B5A598',
    stone: '#8E867E', stoneDark: '#6C655E', stoneLight: '#ABA49C',
    plat: '#8C6E58', platLight: '#B08E74', platDark: '#634C3C',
    coin: '#F2BE45', coinLight: '#FFF0B5', coinDark: '#C98F1F',
    spike: '#B7BCC2', spikeDark: '#727980',
    player: '#D97A4A', eye: '#1F1A17',
    pole: '#5E4C3F', flag: '#D97A4A', flagOff: '#EDE6DC',
  };

  // ステージごとの背景テーマ
  const THEMES = [
    { name: 'day', skyTop: '#FBF7F1', skyBot: '#EEDFCB', far: '#E2D1BC', near: '#D3BCA0', cloud: '#FFFFFF', orb: '#FFF4D6', stars: false, night: false },
    { name: 'dusk', skyTop: '#F6D7B6', skyBot: '#EBA184', far: '#D9978A', near: '#B67B6F', cloud: '#FCE5D0', orb: '#FFE2A8', stars: false, night: false },
    { name: 'night', skyTop: '#1C2036', skyBot: '#3B3658', far: '#302D4B', near: '#26243C', cloud: '#4A4668', orb: '#F4EDE4', stars: true, night: true },
  ];

  // ===================== 保存データ =====================
  const SAVE_KEY = 'pixelhop.v1';
  const save = (() => {
    const base = { unlocked: 1, best: {}, muted: false };
    try { return Object.assign(base, JSON.parse(localStorage.getItem(SAVE_KEY) || '{}')); } catch (e) { return base; }
  })();
  function writeSave() { try { localStorage.setItem(SAVE_KEY, JSON.stringify(save)); } catch (e) { /* 保存できない環境では無視 */ } }

  // ===================== サウンド（Web Audio で合成） =====================
  const Sound = {
    ctx: null, master: null, bgmGain: null, muted: save.muted,
    timer: null, step: 0, nextTime: 0, song: null,
    init() {
      if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.muted ? 0 : 0.5;
      this.master.connect(this.ctx.destination);
      this.bgmGain = this.ctx.createGain();
      this.bgmGain.gain.value = 0.3;
      this.bgmGain.connect(this.master);
    },
    setMuted(m) {
      this.muted = m;
      if (this.ctx) this.master.gain.setTargetAtTime(m ? 0 : 0.5, this.ctx.currentTime, 0.02);
    },
    tone(freq, dur, o = {}) {
      const c = this.ctx; if (!c) return;
      const t = (o.at != null ? o.at : c.currentTime) + (o.delay || 0);
      const osc = c.createOscillator(), g = c.createGain();
      osc.type = o.type || 'square';
      osc.frequency.setValueAtTime(freq, t);
      if (o.slide) osc.frequency.exponentialRampToValueAtTime(o.slide, t + dur);
      const v = o.vol != null ? o.vol : 0.15;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(v, t + 0.005);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      osc.connect(g); g.connect(o.dest || this.master);
      osc.start(t); osc.stop(t + dur + 0.02);
    },
    noise(dur, vol = 0.15, delay = 0) {
      const c = this.ctx; if (!c) return;
      const len = Math.floor(c.sampleRate * dur);
      const buf = c.createBuffer(1, len, c.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
      const src = c.createBufferSource(), g = c.createGain();
      src.buffer = buf; g.gain.value = vol;
      src.connect(g); g.connect(this.master);
      src.start(c.currentTime + delay);
    },
    play(name) {
      if (!this.ctx) return;
      switch (name) {
        case 'jump': this.tone(260, 0.14, { slide: 560, vol: 0.1 }); break;
        case 'coin': this.tone(988, 0.06, { vol: 0.09 }); this.tone(1319, 0.2, { vol: 0.09, delay: 0.06 }); break;
        case 'stomp': this.tone(240, 0.15, { slide: 70, vol: 0.16 }); break;
        case 'bump': this.tone(150, 0.09, { type: 'triangle', slide: 90, vol: 0.3 }); break;
        case 'break': this.noise(0.18, 0.18); this.tone(220, 0.12, { type: 'triangle', slide: 60, vol: 0.25 }); break;
        case 'die': this.tone(620, 0.7, { slide: 80, vol: 0.13, delay: 0.25 }); break;
        case 'fall': this.tone(500, 0.5, { slide: 90, vol: 0.13 }); break;
        case 'oneup': [660, 880, 1320, 1760].forEach((f, i) => this.tone(f, 0.09, { vol: 0.08, delay: i * 0.07 })); break;
        case 'check': this.tone(784, 0.1, { vol: 0.09 }); this.tone(1047, 0.22, { vol: 0.09, delay: 0.1 }); break;
        case 'select': this.tone(660, 0.06, { vol: 0.08 }); break;
        case 'clear': {
          const seq = [[523, 0], [659, 0.12], [784, 0.24], [1047, 0.36], [784, 0.6], [1047, 0.72]];
          seq.forEach(([f, d], i) => this.tone(f, i === seq.length - 1 ? 0.6 : 0.14, { vol: 0.1, delay: d }));
          seq.forEach(([f, d]) => this.tone(f / 2, 0.14, { type: 'triangle', vol: 0.18, delay: d }));
          break;
        }
        case 'over': [392, 330, 262, 196].forEach((f, i) => this.tone(f, 0.3, { type: 'triangle', vol: 0.25, delay: i * 0.25 })); break;
        case 'firework': this.noise(0.25, 0.08); break;
        case 'item': this.tone(300, 0.35, { type: 'triangle', slide: 900, vol: 0.25 }); break;
        case 'powerup': [523, 659, 784, 1047, 1319, 1568].forEach((f, i) => this.tone(f, 0.08, { vol: 0.09, delay: i * 0.05 })); break;
        case 'shrink': [784, 587, 440, 330].forEach((f, i) => this.tone(f, 0.08, { vol: 0.1, delay: i * 0.06 })); break;
        case 'shot': this.tone(1200, 0.08, { slide: 300, vol: 0.07 }); break;
        case 'kick': this.tone(300, 0.12, { slide: 90, vol: 0.14 }); this.noise(0.06, 0.06); break;
      }
    },
    // --- BGM：8小節のループを先読みスケジュール ---
    startBgm(themeIdx) {
      if (!this.ctx) return;
      this.stopBgm();
      this.song = typeof themeIdx === 'string' ? SONGS_EXTRA[themeIdx] : (SONGS[themeIdx] || SONGS[0]);
      this.step = 0;
      this.nextTime = this.ctx.currentTime + 0.1;
      this.timer = setInterval(() => this.schedule(), 25);
    },
    stopBgm() { if (this.timer) clearInterval(this.timer); this.timer = null; },
    schedule() {
      const s = this.song, c = this.ctx;
      const stepDur = 60 / s.tempo / 2; // 8分音符
      while (this.nextTime < c.currentTime + 0.15) {
        const i = this.step % s.melody.length;
        const n = s.melody[i];
        if (n !== '-') {
          let hold = 1;
          while (hold < 4 && s.melody[(i + hold) % s.melody.length] === '-') hold++;
          this.tone(noteFreq(n, s.transpose), stepDur * hold * 0.85, { type: s.wave, vol: 0.12, at: this.nextTime, dest: this.bgmGain });
        }
        if (i % 2 === 0) {
          const root = s.bass[Math.floor(i / 8) % s.bass.length];
          const up = (i / 2) % 2 === 1 ? 12 : 0;
          this.tone(noteFreq(root, s.transpose + up), stepDur * 0.9, { type: 'triangle', vol: 0.22, at: this.nextTime, dest: this.bgmGain });
        }
        this.nextTime += stepDur;
        this.step++;
      }
    },
  };

  function noteFreq(name, transpose = 0) {
    const m = /^([A-G])(#?)(\d)$/.exec(name);
    const semi = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }[m[1]] + (m[2] ? 1 : 0);
    const midi = (Number(m[3]) + 1) * 12 + semi + transpose;
    return 440 * Math.pow(2, (midi - 69) / 12);
  }

  const MELODY = (
    'E5 - G5 - A5 G5 E5 - ' +
    'D5 - E5 - C5 - - - ' +
    'E5 - G5 - A5 C6 B5 A5 ' +
    'G5 - - - E5 - - - ' +
    'F5 - A5 - C6 A5 F5 - ' +
    'E5 - G5 - C6 - G5 - ' +
    'D5 E5 F5 - E5 D5 C5 - ' +
    'D5 - - - G4 - - -'
  ).split(' ');
  const BASS = ['C3', 'G2', 'A2', 'E2', 'F2', 'C3', 'G2', 'G2'];
  const SONGS = [
    { tempo: 132, wave: 'square', transpose: 0, melody: MELODY, bass: BASS },
    { tempo: 116, wave: 'triangle', transpose: -3, melody: MELODY, bass: BASS },
    { tempo: 148, wave: 'square', transpose: -5, melody: MELODY, bass: BASS },
  ];
  // 無敵中の速いBGM
  const SONGS_EXTRA = {
    star: {
      tempo: 210, wave: 'square', transpose: 0,
      melody: 'C5 E5 G5 C6 G5 E5 C5 E5 D5 F5 A5 D6 A5 F5 D5 F5'.split(' '),
      bass: ['C3', 'D3'],
    },
  };

  // ===================== スプライト =====================
  function makeSprite(rows, pal, unit = 2) {
    const c = document.createElement('canvas');
    c.width = rows[0].length * unit; c.height = rows.length * unit;
    const g = c.getContext('2d');
    rows.forEach((row, y) => [...row].forEach((ch, x) => {
      const col = pal[ch];
      if (!col) return;
      g.fillStyle = col; g.fillRect(x * unit, y * unit, unit, unit);
    }));
    return c;
  }

  // 主人公：小さい姿 12x8ドット／大きい姿 12x12ドット（1ドット=2px）
  // x=胴体 a=腕 l=脚。目は向きやまばたきのため別に描く
  const P_PALS = [
    { x: C.player, a: C.player, l: C.player },          // 0: 通常
    { x: '#C4472F', a: '#F2C14E', l: '#F2C14E' },        // 1: ビーム
    { x: '#F2C14E', a: '#FFF0B5', l: '#FFF0B5' },        // 2〜4: 無敵中の点滅
    { x: '#F7F2EA', a: C.player, l: C.player },
    { x: '#7FB6E0', a: '#F7F2EA', l: '#F7F2EA' },
  ];
  const EYE_Y = { small: 2, big: 4 };
  const pCache = {};
  function pSprite(size, frame, pal) {
    const k = size + frame + pal;
    if (!pCache[k]) {
      const big = size === 'big';
      const armRows = { jump: big ? [2, 3] : [1, 2], fall: big ? [5, 6] : [3, 4] }[frame] || (big ? [4, 5] : [2, 3]);
      const body = Array.from({ length: big ? 9 : 6 }, (_, i) => armRows.includes(i) ? 'aaxxxxxxxxaa' : '..xxxxxxxx..');
      const L = '..l.l..l.l..';
      const tail = { walkA: '..l....l....', walkB: '....l....l..', jump: '............' }[frame] || L;
      pCache[k] = makeSprite([...body, ...(big ? [L, L, tail] : [L, tail])], P_PALS[pal]);
    }
    return pCache[k];
  }
  // 目つきの完成形（HUDやタイトル用）
  const PORTRAIT_ROWS = ['..xxxxxxxx..', '..xexxxxex..', 'xxxxxxxxxxxx', 'xxxxxxxxxxxx', '..xxxxxxxx..', '..xxxxxxxx..', '..x.x..x.x..', '..x.x..x.x..'];
  function playerPortrait(unit) {
    return makeSprite(PORTRAIT_ROWS, { x: C.player, e: C.eye }, unit);
  }

  // アイテム：パワーチップ（大きくなる）・ビームチップ（弾を撃てる）・スター（無敵）・1UP
  const CHIP = ['..k..k..', '.oooooo.', 'kooLLook', '.oLooLo.', '.oLooLo.', 'kooLLook', '.oooooo.', '..k..k..'];
  const STAR = ['...yy...', '...yy...', 'yyyyyyyy', '.yeyyey.', '..yyyy..', '.yyyyyy.', '.yy..yy.', 'y......y'];
  const ISPR = {
    power: makeSprite(CHIP, { o: C.player, L: '#FFF0B5', k: '#5E4C3F' }),
    beam: makeSprite(CHIP, { o: '#C4472F', L: '#F2C14E', k: '#5E4C3F' }),
    star: [makeSprite(STAR, { y: '#F2C14E', e: '#5E4C3F' }), makeSprite(STAR, { y: '#FFF0B5', e: '#5E4C3F' })],
    oneup: makeSprite(PORTRAIT_ROWS, { x: '#7E9F57', e: C.eye }),
  };
  const SHOT = makeSprite(['.o.', 'oLo', '.o.'], { o: '#F2C14E', L: '#FFFFFF' });

  // 敵：バグ（踏める）・フライ（空中、踏める）・トゲ（踏めない）
  const ESPR = {
    bug: [
      makeSprite(['.l....l.', '..bbbb..', '.bbbbbb.', 'bbebbebb', 'bbbbbbbb', '.b.b.b.b'], { b: '#6A5A8C', l: '#9C8EC0', e: '#FFFFFF' }),
      makeSprite(['..l..l..', '..bbbb..', '.bbbbbb.', 'bbebbebb', 'bbbbbbbb', 'b.b.b.b.'], { b: '#6A5A8C', l: '#9C8EC0', e: '#FFFFFF' }),
    ],
    bugFlat: makeSprite(['........', '........', '........', '.bbbbbb.', 'bbebbebb', 'bbbbbbbb'], { b: '#6A5A8C', e: '#FFFFFF' }),
    fly: [
      makeSprite(['l......l', 'll.bb.ll', '.bbbbbb.', 'bbebbebb', '.bbbbbb.', '..b..b..'], { b: '#4F6FA8', l: '#A9C2EA', e: '#FFFFFF' }),
      makeSprite(['........', '...bb...', '.bbbbbb.', 'lbebbebl', 'lbbbbbbl', 'l.b..b.l'], { b: '#4F6FA8', l: '#A9C2EA', e: '#FFFFFF' }),
    ],
    flyFlat: makeSprite(['........', '........', '........', '.bbbbbb.', 'bbebbebb', '.bbbbbb.'], { b: '#4F6FA8', e: '#FFFFFF' }),
    spiky: [
      makeSprite(['k..k..k.', '.kbkbkk.', 'bbbbbbbb', 'bebbbbeb', 'bbbbbbbb', '.b.b.b.b'], { b: '#5E7A4A', k: '#D9DDE1', e: '#FFFFFF' }),
      makeSprite(['.k..k..k', '.kkbkbk.', 'bbbbbbbb', 'bebbbbeb', 'bbbbbbbb', 'b.b.b.b.'], { b: '#5E7A4A', k: '#D9DDE1', e: '#FFFFFF' }),
    ],
  };
  const COIN = makeSprite(['.oo.', 'oLoo', 'oLoo', 'oLod', '.od.'], { o: C.coin, L: C.coinLight, d: C.coinDark });

  // タイル画像を事前に作っておく
  function tileCanvas(draw) {
    const c = document.createElement('canvas'); c.width = c.height = TS;
    draw(c.getContext('2d')); return c;
  }
  function dirt(g, seed) {
    g.fillStyle = C.dirt; g.fillRect(0, 0, 16, 16);
    g.fillStyle = C.dirtDot;
    const pts = seed ? [[3, 4], [11, 9], [6, 13], [13, 2]] : [[2, 10], [9, 5], [12, 13], [5, 1]];
    pts.forEach(([x, y]) => g.fillRect(x, y, 2, 1));
    g.fillStyle = C.dirtDark;
    pts.forEach(([x, y]) => g.fillRect(x, y + 1, 2, 1));
  }
  const TILE = {
    ground: [tileCanvas(g => dirt(g, 0)), tileCanvas(g => dirt(g, 1))],
    groundTop: tileCanvas(g => {
      dirt(g, 1);
      g.fillStyle = C.grass; g.fillRect(0, 0, 16, 5);
      g.fillStyle = C.grassLight; g.fillRect(0, 0, 16, 2);
      g.fillStyle = C.grass; g.fillRect(2, 5, 2, 2); g.fillRect(8, 5, 3, 1); g.fillRect(13, 5, 2, 2);
      g.fillStyle = C.grassDark; g.fillRect(2, 7, 2, 1); g.fillRect(13, 7, 2, 1);
    }),
    brick: tileCanvas(g => {
      g.fillStyle = C.brick; g.fillRect(0, 0, 16, 16);
      g.fillStyle = C.brickDark;
      g.fillRect(0, 7, 16, 1); g.fillRect(0, 15, 16, 1);
      g.fillRect(7, 0, 1, 7); g.fillRect(15, 0, 1, 7); g.fillRect(3, 8, 1, 7); g.fillRect(11, 8, 1, 7);
      g.fillStyle = C.brickLight;
      g.fillRect(0, 0, 7, 1); g.fillRect(8, 0, 7, 1); g.fillRect(0, 8, 3, 1); g.fillRect(4, 8, 7, 1); g.fillRect(12, 8, 4, 1);
    }),
    q: tileCanvas(g => {
      g.fillStyle = C.qDark; g.fillRect(0, 0, 16, 16);
      g.fillStyle = C.q; g.fillRect(1, 1, 14, 14);
      g.fillStyle = C.qLight; g.fillRect(1, 1, 14, 1); g.fillRect(1, 1, 1, 14);
      g.fillStyle = C.qDark; [[2, 2], [13, 2], [2, 13], [13, 13]].forEach(([x, y]) => g.fillRect(x, y, 1, 1));
      // 「?」マーク
      g.fillStyle = C.qMark;
      [[6, 4, 4, 1], [5, 5, 1, 2], [10, 5, 1, 2], [9, 7, 1, 1], [8, 8, 1, 2], [8, 11, 1, 1]].forEach(r => g.fillRect(...r));
    }),
    used: tileCanvas(g => {
      g.fillStyle = C.usedDark; g.fillRect(0, 0, 16, 16);
      g.fillStyle = C.used; g.fillRect(1, 1, 14, 14);
      g.fillStyle = C.usedLight; g.fillRect(1, 1, 14, 1);
      g.fillStyle = C.usedDark; [[3, 3], [12, 3], [3, 12], [12, 12]].forEach(([x, y]) => g.fillRect(x, y, 1, 1));
    }),
    stone: tileCanvas(g => {
      g.fillStyle = C.stoneDark; g.fillRect(0, 0, 16, 16);
      g.fillStyle = C.stone; g.fillRect(0, 0, 15, 15);
      g.fillStyle = C.stoneLight; g.fillRect(0, 0, 15, 1); g.fillRect(0, 0, 1, 15);
    }),
    oneway: tileCanvas(g => {
      g.fillStyle = C.platDark; g.fillRect(0, 0, 16, 6);
      g.fillStyle = C.plat; g.fillRect(0, 0, 16, 5);
      g.fillStyle = C.platLight; g.fillRect(0, 0, 16, 1);
      g.fillStyle = C.platDark; g.fillRect(3, 2, 1, 1); g.fillRect(12, 2, 1, 1);
    }),
    spike: tileCanvas(g => {
      for (let s = 0; s < 2; s++) {
        for (let r = 0; r < 10; r++) {
          const half = Math.ceil((r + 1) * 4 / 10);
          g.fillStyle = C.spike; g.fillRect(s * 8 + 4 - half, 6 + r, half * 2, 1);
          g.fillStyle = C.spikeDark; g.fillRect(s * 8 + 4, 6 + r, half, 1);
        }
      }
    }),
  };

  // ===================== 背景（遠景・近景の多重スクロール） =====================
  const bgCache = {};
  function hillLayer(width, base, amp, ks, color, seed) {
    const c = document.createElement('canvas'); c.width = width; c.height = H;
    const g = c.getContext('2d'); g.fillStyle = color;
    for (let x = 0; x < width; x += 8) {
      let h = base;
      ks.forEach((k, i) => { h += Math.sin((x / width) * Math.PI * 2 * k + seed * (i + 1)) * amp / (i + 1); });
      h = Math.round(h / 4) * 4;  // 段々にしてドット絵らしく
      g.fillRect(x, H - h, 8, h);
    }
    return c;
  }
  function getBg(ti) {
    if (bgCache[ti]) return bgCache[ti];
    const th = THEMES[ti];
    const grad = ctx.createLinearGradient(0, 0, 0, H);
    grad.addColorStop(0, th.skyTop); grad.addColorStop(1, th.skyBot);
    const stars = [];
    let s = 7;
    const rnd = () => (s = (s * 9301 + 49297) % 233280) / 233280;
    for (let i = 0; i < 60; i++) stars.push({ x: rnd() * 960, y: rnd() * 150, p: rnd() * 6 });
    const clouds = [];
    for (let i = 0; i < 7; i++) clouds.push({ x: rnd() * 900, y: 20 + rnd() * 70, w: 3 + Math.floor(rnd() * 4) });
    bgCache[ti] = {
      grad, stars, clouds,
      far: hillLayer(512, 76, 26, [2, 5, 9], th.far, 1.3),
      near: hillLayer(640, 50, 18, [3, 7, 11], th.near, 4.1),
    };
    return bgCache[ti];
  }
  function drawDisc(cx, cy, r, color) {
    ctx.fillStyle = color;
    for (let y = -r; y <= r; y += 2) {
      const hw = Math.round(Math.sqrt(r * r - y * y) / 2) * 2;
      ctx.fillRect(cx - hw, cy + y, hw * 2, 2);
    }
  }
  function drawBackground(ti, camX) {
    const th = THEMES[ti], bg = getBg(ti);
    ctx.fillStyle = bg.grad; ctx.fillRect(0, 0, W, H);
    if (th.stars) {
      bg.stars.forEach(st => {
        const x = ((st.x - camX * 0.05) % 960 + 960) % 960;
        if (x > W) return;
        const tw = Math.sin(frameCount * 0.05 + st.p) > 0.6 ? 2 : 1;
        ctx.fillStyle = '#E8E2F2'; ctx.fillRect(Math.round(x), Math.round(st.y), tw, tw);
      });
    }
    drawDisc(ti === 1 ? 360 : 380, ti === 1 ? 150 : 52, ti === 1 ? 26 : 14, th.orb);
    // 雲
    ctx.fillStyle = th.cloud;
    bg.clouds.forEach(cl => {
      const x = Math.round((((cl.x - camX * 0.12 - frameCount * 0.05) % 1000) + 1000) % 1000 - 100);
      const w = cl.w * 8;
      ctx.fillRect(x, cl.y, w, 6); ctx.fillRect(x + 6, cl.y - 4, w - 14, 4); ctx.fillRect(x + 10, cl.y - 8, Math.max(8, w - 26), 4);
    });
    const ox1 = -Math.round(camX * 0.22) % 512;
    for (let x = ox1; x < W; x += 512) ctx.drawImage(bg.far, x, -24);
    const ox2 = -Math.round(camX * 0.45) % 640;
    for (let x = ox2; x < W; x += 640) ctx.drawImage(bg.near, x, -8);
  }

  // ===================== ステージ定義 =====================
  // 座標はタイル単位。y は下から数えた段（地面の高さ2なら、立つ面は y=2）
  const LEVELS = [
    {
      name: 'はじまりの草原', theme: 0, width: 160,
      build(a) {
        a.start(6, 2);
        a.ground(0, 32, 2);
        a.coins(8, 2, 3);
        a.blocks(13, 5, 'BPB?B');
        a.coins(13, 6, 5);
        a.enemy('bug', 22, 2);
        a.arc(31, 3, 5);
        a.ground(35, 25, 2);
        a.ground(40, 4, 3); a.ground(44, 6, 4); a.ground(50, 4, 3);
        a.coins(44, 4, 6);
        a.enemy('bug', 47, 4);
        a.blocks(56, 5, '?');
        a.arc(60, 4, 4);
        a.ground(64, 32, 2);
        a.checkpoint(66, 2);
        a.blocks(72, 5, 'B?BPB');
        a.coins(72, 6, 5);
        a.blocks(74, 9, 'L');
        a.enemy('bug', 80, 2); a.enemy('bug', 86, 2);
        a.ground(92, 1, 3); a.ground(93, 1, 4); a.ground(94, 1, 5); a.ground(95, 3, 6);
        a.ground(100, 1, 5); a.ground(101, 1, 4); a.ground(102, 1, 3);
        a.ground(100, 60, 2);
        a.blocks(108, 5, '?T?');
        a.enemy('bug', 110, 2); a.enemy('bug', 116, 2);
        a.plat(120, 5, 4); a.plat(126, 8, 4); a.coins(126, 9, 4);
        a.coins(134, 2, 6);
        a.enemy('bug', 140, 2);
        a.goal(150, 2);
      },
    },
    {
      name: '夕暮れの丘', theme: 1, width: 200,
      build(a) {
        a.start(6, 2);
        a.ground(0, 20, 2);
        a.coins(6, 2, 4);
        a.enemy('bug', 14, 2);
        a.arc(20, 3, 4);
        a.ground(24, 14, 2);
        a.blocks(27, 5, 'BPB');
        a.enemy('fly', 33, 5, { range: 3 });
        a.ground(38, 6, 1); a.spikes(38, 1, 6);
        a.plat(40, 4, 2); a.coins(40, 5, 2);
        a.ground(44, 16, 2);
        a.checkpoint(46, 2);
        a.ground(50, 3, 3); a.ground(53, 3, 4); a.coins(53, 4, 3);
        a.enemy('bug', 57, 2);
        a.arc(60, 4, 4);
        a.ground(64, 10, 2);
        a.enemy('bug', 69, 2);
        a.plat(76, 4, 3); a.coins(76, 5, 3);
        a.plat(81, 6, 3); a.coins(81, 7, 3);
        a.ground(86, 30, 2);
        a.checkpoint(88, 2);
        a.blocks(92, 5, '?BPB?');
        a.enemy('bug', 96, 2); a.enemy('bug', 101, 2);
        a.enemy('fly', 105, 6, { range: 3 });
        a.spikes(109, 2, 2);
        a.arc(116, 4, 3);
        a.ground(119, 30, 2);
        a.ground(124, 3, 4); a.spikes(127, 2, 3); a.ground(130, 3, 4);
        a.coins(127, 5, 3);
        a.enemy('bug', 137, 2); a.enemy('spiky', 143, 2);
        a.arc(149, 4, 3);
        a.ground(152, 48, 2);
        a.enemy('fly', 160, 6, { range: 3 });
        a.blocks(164, 5, 'BTB');
        a.enemy('bug', 168, 2);
        a.enemy('fly', 174, 5, { range: 2 });
        a.ground(180, 1, 3); a.ground(181, 1, 4); a.ground(182, 1, 5);
        a.goal(190, 2);
      },
    },
    {
      name: '夜の工場', theme: 2, width: 210,
      build(a) {
        a.start(6, 2);
        a.ground(0, 17, 2);
        a.coins(8, 2, 3);
        a.enemy('spiky', 13, 2);
        a.mover(17, 3, 4, 'x', 6, 0.6);
        a.coins(20, 7, 3);
        a.ground(27, 19, 2);
        a.checkpoint(30, 2);
        a.blocks(33, 5, 'BPB');
        a.enemy('bug', 37, 2); a.enemy('spiky', 42, 2);
        a.ground(46, 10, 1); a.spikes(46, 1, 10);
        a.mover(47, 4, 3, 'x', 5, 0.7);
        a.ground(56, 24, 2);
        a.checkpoint(58, 2);
        a.enemy('fly', 63, 6, { range: 3 });
        a.ground(66, 3, 4); a.ground(69, 3, 6); a.ground(72, 3, 4);
        a.coins(69, 6, 3);
        a.enemy('bug', 77, 2);
        a.arc(80, 4, 4);
        a.ground(84, 7, 2);
        a.mover(88, 3, 3, 'y', 5, 0.5);
        a.ground(91, 4, 8);
        a.coins(91, 8, 4);
        a.ground(95, 20, 2);
        a.checkpoint(97, 2);
        a.enemy('bug', 100, 2); a.blocks(102, 5, 'P?'); a.enemy('spiky', 106, 2);
        a.enemy('fly', 117, 5, { range: 2 });
        a.ground(119, 25, 2);
        a.plat(123, 5, 3); a.plat(127, 8, 3); a.plat(131, 11, 3); a.coins(131, 12, 3);
        a.enemy('spiky', 126, 2); a.enemy('fly', 134, 6, { range: 2 });
        a.ground(144, 14, 1); a.spikes(144, 1, 14);
        a.mover(145, 4, 3, 'x', 4, 0.8);
        a.mover(152, 5, 3, 'x', 3, 0.9);
        a.ground(158, 52, 2);
        a.checkpoint(160, 2);
        a.enemy('bug', 166, 2); a.blocks(168, 5, 'BPBTB');
        a.enemy('fly', 177, 8, { range: 3 }); a.enemy('bug', 182, 2);
        a.ground(188, 1, 3); a.ground(189, 1, 4); a.ground(190, 1, 5); a.ground(191, 1, 6);
        a.goal(200, 2);
      },
    },
  ];

  function buildLevel(idx) {
    const def = LEVELS[idx];
    const w = def.width;
    const grid = Array.from({ length: ROWS }, () => new Uint8Array(w));
    const L = { idx, def, w, grid, contents: {}, coins: [], spawns: [], movers: [], checkpoints: [], start: { x: 3, y: 2 }, goal: null, totalCoins: 0 };
    const row = y => ROWS - 1 - y;
    const set = (x, y, t) => { if (x >= 0 && x < w && y >= 0 && y < ROWS) grid[row(y)][x] = t; };
    const coinAt = (x, y) => ({ x: x * TS + 8, y: row(y) * TS + 8, taken: false });
    const api = {
      start(x, y) { L.start = { x, y }; },
      ground(x, len, h) { for (let i = x; i < x + len; i++) for (let y = 0; y < h; y++) set(i, y, T_GROUND); },
      // ? コイン / P パワーチップ / T スター / L 1UP（見た目はすべて ? ブロック）、B レンガ、S 石
      blocks(x, y, s) {
        const ITEM = { P: 'power', T: 'star', L: 'oneup' };
        [...s].forEach((c, i) => {
          if (c === ' ') return;
          if (ITEM[c]) { set(x + i, y, T_Q); L.contents[`${x + i},${row(y)}`] = ITEM[c]; }
          else set(x + i, y, c === '?' ? T_Q : c === 'S' ? T_STONE : T_BRICK);
        });
      },
      plat(x, y, len) { for (let i = 0; i < len; i++) set(x + i, y, T_ONEWAY); },
      spikes(x, y, len) { for (let i = 0; i < len; i++) set(x + i, y, T_SPIKE); },
      coins(x, y, n) { for (let i = 0; i < n; i++) L.coins.push(coinAt(x + i, y)); },
      arc(x, y, n) { for (let i = 0; i < n; i++) L.coins.push(coinAt(x + i, y + Math.round(Math.sin((i / (n - 1)) * Math.PI) * 2))); },
      enemy(type, x, y, opt = {}) { L.spawns.push(Object.assign({ type, x, y }, opt)); },
      mover(x, y, len, axis, dist, speed) {
        const px = x * TS, py = (ROWS - y) * TS;
        L.movers.push({ x: px, y: py, w: len * TS, h: 6, x0: px, y0: py, axis, dist: dist * TS, speed, phase: 0, dx: 0, dy: 0 });
      },
      checkpoint(x, y) { L.checkpoints.push({ x, y, px: x * TS + 7, active: false }); },
      goal(x, y) { L.goal = { x, y, px: x * TS + 7, base: (ROWS - y) * TS, flag: 0 }; },
    };
    def.build(api);
    let q = 0;
    grid.forEach(r => r.forEach(t => { if (t === T_Q) q++; }));
    q -= Object.keys(L.contents).length;
    L.totalCoins = L.coins.length + q;
    return L;
  }

  function makeEnemy(s) {
    const e = { type: s.type, w: 14, h: 11, vx: -0.5, vy: 0, t: 0, face: -1, dead: false, deadT: 0, kill: null, active: false, onGround: false };
    if (s.type === 'fly') {
      e.h = 10;
      e.x0 = s.x * TS + 1; e.y0 = (ROWS - s.y) * TS - 8 - e.h;
      e.x = e.x0; e.y = e.y0; e.range = (s.range || 2) * TS;
    } else {
      if (s.type === 'spiky') e.vx = -0.4;
      e.x = s.x * TS + 1; e.y = (ROWS - s.y) * TS - e.h;
    }
    return e;
  }

  // ===================== 状態 =====================
  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');
  const $ = id => document.getElementById(id);
  const stageEl = $('stage'), overlay = $('overlay'), hud = $('hud'), banner = $('banner');

  let state = 'title';      // title / play / paused / goal / clear / over / ending
  let level = null, enemies = [], particles = [], popups = [], bumps = [], items = [], shots = [];
  let frameCount = 0;
  const cam = { x: 0 };
  const player = { x: 0, y: 0, w: 18, h: 15, vx: 0, vy: 0, onGround: false, coyote: 0, jumpBuf: 0, face: 1, walkT: 0, squash: 0, inv: 0, dead: false, deadT: 0, riding: null, blink: 0, form: 'small', star: 0, shootT: 0 };
  const game = { stage: 0, lives: START_LIVES, coins: 0, stageCoins: 0, frames: 0, respawn: null, goalT: 0, morphT: 0, morph: null, run: { frames: 0, coins: 0 } };

  // ===================== 入力 =====================
  const input = { left: false, right: false, jump: false, jumpPressed: false, dash: false, firePressed: false };
  const keys = new Set();
  const KEY_LEFT = ['ArrowLeft', 'KeyA'], KEY_RIGHT = ['ArrowRight', 'KeyD'], KEY_JUMP = ['Space', 'ArrowUp', 'KeyW', 'KeyZ', 'KeyK'];
  const KEY_DASH = ['ShiftLeft', 'ShiftRight', 'KeyX', 'KeyJ'];  // 押している間ダッシュ、押した瞬間にビーム
  function syncKeys() {
    input.left = KEY_LEFT.some(k => keys.has(k)) || touch.left;
    input.right = KEY_RIGHT.some(k => keys.has(k)) || touch.right;
    input.jump = KEY_JUMP.some(k => keys.has(k)) || touch.jump;
    input.dash = KEY_DASH.some(k => keys.has(k)) || touch.dashPad || touch.dashBtn;
  }
  window.addEventListener('keydown', e => {
    Sound.init();
    if (state === 'play' || state === 'goal') {
      if ([...KEY_LEFT, ...KEY_RIGHT, ...KEY_JUMP, ...KEY_DASH, 'ArrowDown'].includes(e.code)) e.preventDefault();
      if (KEY_JUMP.includes(e.code) && !keys.has(e.code)) input.jumpPressed = true;
      if (KEY_DASH.includes(e.code) && !keys.has(e.code)) input.firePressed = true;
      keys.add(e.code);
      syncKeys();
      if ((e.code === 'Escape' || e.code === 'KeyP') && state === 'play') pause();
    } else if (state === 'paused' && (e.code === 'Escape' || e.code === 'KeyP')) {
      resume();
    }
  });
  window.addEventListener('keyup', e => { keys.delete(e.code); syncKeys(); });
  window.addEventListener('blur', () => { keys.clear(); touch.left = touch.right = touch.jump = touch.dashPad = touch.dashBtn = false; syncKeys(); });

  // タッチ：左下パッドは指の位置で左右を判定（指を滑らせて切り替えられる）
  // パッドの外側の端を押すとダッシュになる
  const touch = { left: false, right: false, jump: false, dashPad: false, dashBtn: false };
  const pad = $('pad'), jumpBtn = $('jump-btn'), bBtn = $('b-btn');
  const padPointers = new Map();
  function updatePad() {
    touch.left = touch.right = touch.dashPad = false;
    const r = pad.getBoundingClientRect();
    padPointers.forEach(x => {
      const rel = (x - r.left) / r.width;
      if (rel < 0.5) touch.left = true; else touch.right = true;
      if (rel < 0.2 || rel > 0.8) touch.dashPad = true;
    });
    pad.children[0].classList.toggle('on', touch.left);
    pad.children[1].classList.toggle('on', touch.right);
    pad.classList.toggle('dash', touch.dashPad);
    syncKeys();
  }
  pad.addEventListener('pointerdown', e => { e.preventDefault(); Sound.init(); pad.setPointerCapture(e.pointerId); padPointers.set(e.pointerId, e.clientX); updatePad(); });
  pad.addEventListener('pointermove', e => { if (padPointers.has(e.pointerId)) { padPointers.set(e.pointerId, e.clientX); updatePad(); } });
  ['pointerup', 'pointercancel', 'lostpointercapture'].forEach(ev => pad.addEventListener(ev, e => { padPointers.delete(e.pointerId); updatePad(); }));
  jumpBtn.addEventListener('pointerdown', e => {
    e.preventDefault(); Sound.init(); jumpBtn.setPointerCapture(e.pointerId);
    if (!touch.jump) input.jumpPressed = true;
    touch.jump = true; jumpBtn.classList.add('on'); syncKeys();
  });
  ['pointerup', 'pointercancel', 'lostpointercapture'].forEach(ev => jumpBtn.addEventListener(ev, () => { touch.jump = false; jumpBtn.classList.remove('on'); syncKeys(); }));
  bBtn.addEventListener('pointerdown', e => {
    e.preventDefault(); Sound.init(); bBtn.setPointerCapture(e.pointerId);
    if (!touch.dashBtn) input.firePressed = true;
    touch.dashBtn = true; bBtn.classList.add('on'); syncKeys();
  });
  ['pointerup', 'pointercancel', 'lostpointercapture'].forEach(ev => bBtn.addEventListener(ev, () => { touch.dashBtn = false; bBtn.classList.remove('on'); syncKeys(); }));
  const isTouch = window.matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;
  if (isTouch) document.body.classList.add('touch');
  window.addEventListener('touchstart', () => document.body.classList.add('touch'), { once: true, passive: true });
  window.addEventListener('pointerdown', () => Sound.init());
  document.addEventListener('contextmenu', e => e.preventDefault());

  // ===================== タイル判定 =====================
  function tileAt(tx, ty) {
    if (ty < 0 || ty >= ROWS) return T_EMPTY;
    if (tx < 0 || tx >= level.w) return T_STONE; // ステージの左右端は壁
    return level.grid[ty][tx];
  }
  // 横方向の移動と衝突
  function moveX(e, dx) {
    if (!dx) return false;
    e.x += dx;
    const y0 = Math.floor(e.y / TS), y1 = Math.floor((e.y + e.h - 0.01) / TS);
    const tx = dx > 0 ? Math.floor((e.x + e.w - 0.01) / TS) : Math.floor(e.x / TS);
    for (let ty = y0; ty <= y1; ty++) {
      if (SOLID[tileAt(tx, ty)]) {
        e.x = dx > 0 ? tx * TS - e.w : (tx + 1) * TS;
        return true;
      }
    }
    return false;
  }
  // 縦方向の移動と衝突（上り下りで結果を返す）
  function moveY(e, dy, prevBottom) {
    e.y += dy;
    const x0 = Math.floor(e.x / TS), x1 = Math.floor((e.x + e.w - 0.01) / TS);
    if (dy > 0) {
      const ty = Math.floor((e.y + e.h - 0.01) / TS);
      for (let tx = x0; tx <= x1; tx++) {
        const t = tileAt(tx, ty);
        if (SOLID[t] || (t === T_ONEWAY && prevBottom <= ty * TS + 0.01)) {
          e.y = ty * TS - e.h; e.vy = 0;
          return { floor: true };
        }
      }
    } else if (dy < 0) {
      const ty = Math.floor(e.y / TS);
      const hits = [];
      for (let tx = x0; tx <= x1; tx++) if (SOLID[tileAt(tx, ty)]) hits.push(tx);
      if (hits.length) {
        e.y = (ty + 1) * TS; e.vy = 0;
        // 頭の中心に近いブロックを叩いたことにする
        const cx = e.x + e.w / 2;
        hits.sort((a, b) => Math.abs(a * TS + 8 - cx) - Math.abs(b * TS + 8 - cx));
        return { ceil: true, tx: hits[0], ty };
      }
    }
    return {};
  }
  const overlap = (a, b) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;

  // ===================== エフェクト =====================
  function burst(x, y, n, colors, o = {}) {
    for (let i = 0; i < n; i++) {
      const a = o.angle != null ? o.angle + (Math.random() - 0.5) * (o.spread || 1) : Math.random() * Math.PI * 2;
      const sp = (o.speed || 1.5) * (0.4 + Math.random() * 0.8);
      particles.push({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: (o.life || 30) * (0.6 + Math.random() * 0.6), color: colors[i % colors.length], size: o.size || 2, g: o.g != null ? o.g : 0.08 });
    }
  }
  function dust(x, y) { burst(x, y, 6, ['#E7DACB', '#CDBBA7'], { angle: -Math.PI / 2, spread: 2.6, speed: 0.9, life: 18, g: 0.02 }); }
  function popup(x, y, text) { popups.push({ x, y, text, life: 50 }); }

  // ===================== ゲーム進行 =====================
  function loadStage(idx) {
    game.stage = idx;
    level = buildLevel(idx);
    game.stageCoins = 0;
    game.frames = 0;
    game.respawn = { x: level.start.x, y: level.start.y };
    particles = []; popups = []; bumps = []; items = []; shots = [];
    game.morphT = 0;
    stageEl.classList.toggle('night', THEMES[level.def.theme].night);
    spawnPlayer();
    resetEnemies();
    cam.x = clampCam(player.x - W / 3);
  }
  function resetEnemies() { enemies = level.spawns.map(makeEnemy); }
  function spawnPlayer() {
    const r = game.respawn;
    player.h = player.form === 'small' ? 15 : 23;
    Object.assign(player, { star: 0, shootT: 0, x: r.x * TS - 1, y: (ROWS - r.y) * TS - player.h, vx: 0, vy: 0, onGround: false, coyote: 0, jumpBuf: 0, face: 1, dead: false, deadT: 0, riding: null, inv: 0, squash: 0 });
  }
  function clampCam(x) { return Math.max(0, Math.min(level.w * TS - W, x)); }

  function startStage(idx) {
    loadStage(idx);
    state = 'play';
    input.jumpPressed = false;
    hideOverlay();
    hud.hidden = false;
    updateHud(true);
    showBanner(`ステージ ${idx + 1}<small>${level.def.name}</small>`);
    Sound.init();
    playStageBgm();
    if (document.activeElement) document.activeElement.blur();
  }

  function killPlayer(fell) {
    if (player.dead) return;
    player.dead = true; player.deadT = 0;
    player.vy = fell ? 0 : -6;
    player.fell = fell;
    Sound.stopBgm();
    Sound.play(fell ? 'fall' : 'die');
  }
  function afterDeath() {
    game.lives--;
    updateHud(true);
    if (game.lives <= 0) {
      state = 'over';
      Sound.play('over');
      showOverlay(`
        <div class="panel">
          <h2>ゲームオーバー</h2>
          <p class="sub">ステージ ${game.stage + 1}「${level.def.name}」</p>
          <div class="btns">
            <button class="btn primary" data-action="retry">もう一度挑戦</button>
            <button class="btn" data-action="title">タイトルへ</button>
          </div>
        </div>`);
      return;
    }
    player.form = 'small';   // やられたら小さい姿に戻る
    items = []; shots = [];
    spawnPlayer();
    player.inv = 90;
    resetEnemies();
    cam.x = clampCam(player.x - W / 3);
    playStageBgm();
  }

  function playStageBgm() { Sound.startBgm(player.star > 0 ? 'star' : level.def.theme); }

  // ---- 姿の変化（大きくなる・ビーム・小さくなる） ----
  const formSize = f => (f === 'small' ? 'small' : 'big');
  const formPal = f => (f === 'beam' ? 1 : 0);
  function setForm(form) {
    const p = player;
    if (p.form === form) return;
    game.morph = { from: { size: formSize(p.form), pal: formPal(p.form) }, to: { size: formSize(form), pal: formPal(form) } };
    game.morphT = 36;       // 変身中は少しだけ時間を止める
    const oldH = p.h;
    p.form = form;
    p.h = form === 'small' ? 15 : 23;
    p.y += oldH - p.h;      // 足元の位置はそのまま
  }
  function hurtPlayer() {
    const p = player;
    if (p.dead || p.inv > 0 || p.star > 0 || game.morphT > 0) return;
    if (p.form === 'small') return killPlayer(false);
    setForm('small');
    p.inv = 120;
    Sound.play('shrink');
  }

  // ---- アイテム ----
  function spawnItem(type, tx, ty) {
    const it = { type, x: tx * TS + 1, y: ty * TS, w: 14, h: 14, vx: 0, vy: 0, emerge: 16, t: 0 };
    items.push(it);
    Sound.play('item');
  }
  function updateItems() {
    items = items.filter(it => {
      it.t++;
      if (it.emerge > 0) {     // ブロックからせり出す
        it.y -= 14 / 16;
        if (--it.emerge === 0) {
          it.y = Math.round(it.y);
          if (it.type === 'star') { it.vx = 1.4; it.vy = -4; }
          else if (it.type !== 'beam') it.vx = 1.0;
        }
        return true;
      }
      if (it.type === 'beam') return true;
      it.vy = Math.min(it.vy + 0.35, PHYS.maxFall);
      const v = it.vx;
      if (moveX(it, v)) it.vx = -v;
      const r = moveY(it, it.vy, it.y + it.h);
      if (r.floor && it.type === 'star') it.vy = -5;
      return it.y < H + 32;
    });
  }
  function collectItem(it) {
    const p = player;
    const cx = it.x + it.w / 2, cy = it.y;
    switch (it.type) {
      case 'power':
        if (p.form === 'small') { setForm('big'); Sound.play('powerup'); } else Sound.play('coin');
        popup(cx, cy, 'POWER');
        break;
      case 'beam':
        setForm('beam'); Sound.play('powerup');
        popup(cx, cy, 'BEAM');
        break;
      case 'star':
        p.star = 600;
        Sound.play('powerup');
        Sound.startBgm('star');
        popup(cx, cy, 'STAR');
        break;
      case 'oneup':
        game.lives++;
        Sound.play('oneup');
        popup(cx, cy, '1UP');
        updateHud();
        break;
    }
    burst(cx, cy + 7, 10, ['#FFFFFF', C.coin, C.player], { speed: 1.5, life: 20, g: 0 });
  }

  // ---- ビーム弾 ----
  function fireShot() {
    const p = player;
    if (shots.length >= 2) return;
    shots.push({ x: p.face > 0 ? p.x + p.w - 2 : p.x - 4, y: p.y + 6, w: 6, h: 6, vx: p.face * 4.5, vy: 1.5, life: 150 });
    p.shootT = 8;
    Sound.play('shot');
  }
  function updateShots() {
    shots = shots.filter(s => {
      s.vy = Math.min(s.vy + 0.35, 6);
      if (moveX(s, s.vx)) { burst(s.x + 3, s.y + 3, 5, ['#FFFFFF', '#F2C14E'], { speed: 1, life: 12, g: 0 }); return false; }
      if (moveY(s, s.vy, s.y + s.h).floor) s.vy = -3.2;
      if (--s.life <= 0 || s.y > H || s.x < cam.x - 24 || s.x > cam.x + W + 24) return false;
      for (const e of enemies) {
        if (!e.dead && e.active && overlap(s, e)) {
          knockEnemy(e, Math.sign(s.vx));
          burst(s.x + 3, s.y + 3, 8, ['#FFFFFF', '#F2C14E'], { speed: 1.4, life: 14, g: 0 });
          return false;
        }
      }
      return true;
    });
  }

  function addCoin(x, y) {
    game.coins++; game.stageCoins++;
    Sound.play('coin');
    burst(x, y, 6, [C.coinLight, C.coin], { speed: 1.2, life: 16, g: 0 });
    if (game.coins % 50 === 0) {
      game.lives++;
      Sound.play('oneup');
      popup(player.x + player.w / 2, player.y - 6, '1UP');
    }
    updateHud();
  }

  function bumpTile(tx, ty) {
    const t = tileAt(tx, ty);
    if (t === T_Q) {
      level.grid[ty][tx] = T_USED;
      bumps.push({ tx, ty, t: 0 });
      Sound.play('bump');
      let content = level.contents[`${tx},${ty}`];
      if (content) {
        // 小さい姿ならパワーチップ、大きい姿ならビームチップが出る
        if (content === 'power' && player.form !== 'small') content = 'beam';
        spawnItem(content, tx, ty);
      } else {
        particles.push({ x: tx * TS + 4, y: ty * TS - 10, vx: 0, vy: -4.5, life: 26, coin: true, g: 0.3 });
        addCoin(tx * TS + 8, ty * TS - 8);
      }
    } else if (t === T_BRICK && player.form === 'small') {
      // 小さい姿ではレンガは壊せない
      Sound.play('bump');
      bumps.push({ tx, ty, t: 0 });
    } else if (t === T_BRICK) {
      level.grid[ty][tx] = T_EMPTY;
      Sound.play('break');
      [[-1, -4], [1, -4], [-1.2, -2.5], [1.2, -2.5]].forEach(([vx, vy], i) => {
        particles.push({ x: tx * TS + (i % 2) * 8 + 2, y: ty * TS + (i > 1 ? 8 : 0) + 2, vx, vy, life: 60, color: C.brick, size: 5, g: 0.25 });
      });
    } else {
      Sound.play('bump');
      bumps.push({ tx, ty, t: 0 });
    }
    // ブロックの上にいる敵・コインにも作用
    const top = ty * TS;
    enemies.forEach(e => {
      if (!e.dead && Math.abs(e.y + e.h - top) < 3 && e.x + e.w > tx * TS && e.x < tx * TS + TS) knockEnemy(e);
    });
    level.coins.forEach(c => {
      if (!c.taken && Math.abs(c.y - (top - 8)) < 4 && Math.abs(c.x - (tx * TS + 8)) < 8) { c.taken = true; addCoin(c.x, c.y); }
    });
    items.forEach(it => {   // 上に乗っているアイテムは跳ねる
      if (!it.emerge && Math.abs(it.y + it.h - top) < 3 && it.x + it.w > tx * TS && it.x < tx * TS + TS) {
        it.vy = -4;
        if (it.vx) it.vx = (it.x + it.w / 2 < tx * TS + 8 ? -1 : 1) * Math.abs(it.vx);
      }
    });
  }

  function knockEnemy(e, dir = player.face) {
    e.dead = true; e.kill = 'knock'; e.deadT = 0; e.vy = -4; e.vx = dir * 0.8;
    Sound.play('kick');
    popup(e.x + e.w / 2, e.y - 4, '+1');
  }

  // ---- 主人公の更新 ----
  function updatePlayer(inp) {
    const p = player;
    if (p.dead) {
      p.deadT++;
      if (!p.fell && p.deadT > 20) { p.vy = Math.min(p.vy + 0.35, 8); p.y += p.vy; }
      if (p.deadT > (p.fell ? 60 : 100)) afterDeath();
      return;
    }
    if (p.inv > 0) p.inv--;
    if (p.squash > 0) p.squash--;
    if (p.shootT > 0) p.shootT--;
    if (p.star > 0 && --p.star === 0 && state === 'play') playStageBgm();
    if (p.blink > 0) p.blink--; else if (Math.random() < 0.005) p.blink = 8;

    // 動く足場に乗っていれば一緒に運ばれる
    if (p.riding) {
      const m = p.riding;
      moveX(p, m.dx);
      p.y = m.y - p.h;
    }
    p.riding = null;

    // 横移動（加速・減速）
    const dir = (inp.right ? 1 : 0) - (inp.left ? 1 : 0);
    const maxV = inp.dash ? PHYS.dashMax : PHYS.max;
    if (dir) {
      if (Math.sign(p.vx) === dir && Math.abs(p.vx) > maxV) {
        p.vx -= dir * 0.06;   // ダッシュをやめたら少しずつ減速
      } else {
        const turning = p.vx * dir < 0 && p.onGround;
        p.vx += dir * (p.onGround ? PHYS.acc : PHYS.airAcc) * (turning ? 1.6 : 1);
        if (Math.abs(p.vx) > maxV) p.vx = dir * maxV;
      }
      p.face = dir;
      if (p.onGround && Math.abs(p.vx) > 3 && frameCount % 5 === 0) dust(p.x + p.w / 2 - dir * 8, p.y + p.h);
    } else {
      const d = p.onGround ? PHYS.dec : PHYS.airDec;
      p.vx = Math.abs(p.vx) <= d ? 0 : p.vx - Math.sign(p.vx) * d;
    }

    // ジャンプ（先行入力と足場離れ直後の猶予つき）
    if (inp.jumpPressed) p.jumpBuf = PHYS.buffer;
    inp.jumpPressed = false;
    if (p.onGround) p.coyote = PHYS.coyote; else if (p.coyote > 0) p.coyote--;
    if (p.jumpBuf > 0) {
      p.jumpBuf--;
      if (p.coyote > 0) {
        p.vy = -(PHYS.jump + Math.max(0, Math.abs(p.vx) - PHYS.max) * PHYS.runJump);
        p.coyote = 0; p.jumpBuf = 0; p.onGround = false;
        Sound.play('jump');
        dust(p.x + p.w / 2, p.y + p.h);
      }
    }
    if (!inp.jump && p.vy < -PHYS.cut) p.vy = -PHYS.cut;
    if (inp.firePressed && p.form === 'beam') fireShot();
    inp.firePressed = false;

    const prevBottom = p.y + p.h;
    if (moveX(p, p.vx)) p.vx = 0;
    p.vy = Math.min(p.vy + PHYS.g, PHYS.maxFall);
    const fallSpeed = p.vy;
    const wasGround = p.onGround;
    p.onGround = false;
    const res = moveY(p, p.vy, prevBottom);
    if (res.floor) p.onGround = true;
    if (res.ceil) bumpTile(res.tx, res.ty);
    // 動く足場への着地（上からのみ乗れる）
    if (p.vy >= 0) {
      for (const m of level.movers) {
        if (p.x + p.w > m.x + 1 && p.x < m.x + m.w - 1 && prevBottom <= m.y + 3 && p.y + p.h >= m.y) {
          p.y = m.y - p.h; p.vy = 0; p.onGround = true; p.riding = m;
          break;
        }
      }
    }
    if (p.onGround && !wasGround && fallSpeed > 3) { p.squash = 6; dust(p.x + p.w / 2, p.y + p.h); }
    p.walkT = p.onGround ? p.walkT + Math.abs(p.vx) : 0;

    // トゲ
    const x0 = Math.floor(p.x / TS), x1 = Math.floor((p.x + p.w - 1) / TS);
    const y0 = Math.floor(p.y / TS), y1 = Math.floor((p.y + p.h - 1) / TS);
    for (let ty = y0; ty <= y1; ty++) for (let tx = x0; tx <= x1; tx++) {
      if (tileAt(tx, ty) === T_SPIKE && overlap(p, { x: tx * TS + 2, y: ty * TS + 7, w: 12, h: 9 })) return hurtPlayer();
    }
    // 穴に落ちた
    if (p.y > H + 8) return killPlayer(true);
  }

  // ---- 敵の更新 ----
  function updateEnemy(e) {
    if (e.dead) {
      e.deadT++;
      if (e.kill === 'knock') { e.vy += 0.3; e.y += e.vy; e.x += e.vx; }
      return;
    }
    if (!e.active) { if (e.x < cam.x + W + 40) e.active = true; else return; }
    e.t++;
    if (e.type === 'fly') {
      const nx = e.x0 + Math.sin(e.t * 0.02) * e.range;
      e.face = nx > e.x ? 1 : -1;
      e.x = nx;
      e.y = e.y0 + Math.sin(e.t * 0.06) * 8;
      return;
    }
    e.vy = Math.min(e.vy + PHYS.g, PHYS.maxFall);
    if (e.onGround) {
      // 足場の端やトゲの手前で引き返す
      const fx = e.vx > 0 ? e.x + e.w + 1 : e.x - 1;
      const tx = Math.floor(fx / TS);
      const below = tileAt(tx, Math.floor((e.y + e.h + 2) / TS));
      const front = tileAt(tx, Math.floor((e.y + e.h - 1) / TS));
      if (!(SOLID[below] || below === T_ONEWAY) || front === T_SPIKE) e.vx = -e.vx;
    }
    const v = e.vx;
    if (moveX(e, v)) e.vx = -v;
    e.face = Math.sign(e.vx);
    e.onGround = !!moveY(e, e.vy, e.y + e.h).floor;
    if (e.y > H + 32) e.dead = true;
  }

  function updateMovers() {
    level.movers.forEach(m => {
      m.phase += (m.speed / m.dist) * Math.PI;
      const off = (1 - Math.cos(m.phase)) / 2 * m.dist;
      const nx = m.axis === 'x' ? m.x0 + off : m.x0;
      const ny = m.axis === 'y' ? m.y0 - off : m.y0;
      m.dx = nx - m.x; m.dy = ny - m.y;
      m.x = nx; m.y = ny;
    });
  }

  function interact() {
    const p = player;
    if (p.dead) return;
    // コイン
    for (const c of level.coins) {
      if (!c.taken && Math.abs(c.x - (p.x + p.w / 2)) < 13 && Math.abs(c.y - (p.y + p.h / 2)) < 12) { c.taken = true; addCoin(c.x, c.y); }
    }
    // アイテム
    items = items.filter(it => {
      if (it.emerge > 0 || !overlap(p, it)) return true;
      collectItem(it);
      return false;
    });
    // 敵
    for (const e of enemies) {
      if (e.dead || !e.active || !overlap(p, e)) continue;
      if (p.star > 0) { knockEnemy(e, Math.sign(e.x - p.x) || 1); continue; }   // 無敵中は触れるだけで倒せる
      const stompable = e.type !== 'spiky';
      if (stompable && p.vy > 0 && p.y + p.h - p.vy <= e.y + 6) {
        e.dead = true; e.kill = 'stomp'; e.deadT = 0;
        p.vy = input.jump ? -8.5 : -5;
        p.onGround = false;
        Sound.play('stomp');
        burst(e.x + e.w / 2, e.y + e.h / 2, 8, ['#FFFFFF', '#E7DACB'], { speed: 1.4, life: 18, g: 0 });
        popup(e.x + e.w / 2, e.y - 4, '+1');
      } else if (p.inv <= 0) {
        hurtPlayer();
        if (p.dead) return;
      }
    }
    // 中間ポイント
    for (const cp of level.checkpoints) {
      if (!cp.active && p.x + p.w > cp.px) {
        level.checkpoints.forEach(o => { if (o.px <= cp.px) o.active = true; });
        game.respawn = { x: cp.x, y: cp.y };
        Sound.play('check');
        burst(cp.px, (ROWS - cp.y) * TS - 26, 10, [C.flag, '#FFFFFF'], { speed: 1.3, life: 24, g: 0.02 });
      }
    }
    // ゴール
    if (p.x + p.w >= level.goal.px) startGoal();
  }

  function startGoal() {
    state = 'goal';
    game.goalT = 0;
    player.vx = 0;
    player.star = 0;
    shots = [];
    input.jumpPressed = false;
    Sound.stopBgm();
    Sound.play('clear');
  }
  function updateGoal() {
    game.goalT++;
    const t = game.goalT;
    const g = level.goal;
    g.flag = Math.min(1, g.flag + 0.025);
    const auto = { left: false, right: t > 40 && t < 85, jump: t >= 20 && t < 30, jumpPressed: t === 20 };
    updatePlayer(auto);
    if (t === 50 || t === 75 || t === 100) {
      const fx = g.px + 40 + (t % 3) * 30, fy = 60 + (t % 2) * 30;
      burst(fx, fy, 28, [C.player, C.coin, '#FFFFFF', '#8FB8E8'], { speed: 2.2, life: 45, g: 0.03 });
      Sound.play('firework');
    }
    if (t === 150) showClear();
  }

  function update() {
    frameCount++;
    if (state === 'title') {
      cam.x += 0.5;
      if (cam.x > level.w * TS - W) cam.x = 0;
      updateMovers();
      enemies.forEach(updateEnemy);
    } else if (state === 'play') {
      if (game.morphT > 0) {
        game.morphT--;        // 変身演出の間は止める
        input.jumpPressed = input.firePressed = false;
      } else {
        game.frames++;
        updateMovers();
        updatePlayer(input);
        enemies.forEach(updateEnemy);
        updateItems();
        updateShots();
        interact();
        updateCamera();
        if (frameCount % 6 === 0) updateHud();
      }
    } else if (state === 'goal') {
      updateMovers();
      updateGoal();
      enemies.forEach(updateEnemy);
      updateItems();
      updateCamera();
    }
    if (state !== 'paused') {
      particles = particles.filter(pt => {
        pt.vy += pt.g; pt.x += pt.vx; pt.y += pt.vy;
        return --pt.life > 0;
      });
      popups = popups.filter(pp => { pp.y -= 0.5; return --pp.life > 0; });
      bumps = bumps.filter(b => ++b.t < 8);
    }
  }

  function updateCamera() {
    if (player.dead) return;
    const target = clampCam(player.x + player.w / 2 - W / 2 + player.face * 28 + player.vx * 10);
    cam.x += (target - cam.x) * 0.1;
  }

  // ===================== 描画 =====================
  let scale = 1;
  function render() {
    ctx.setTransform(scale, 0, 0, scale, 0, 0);
    ctx.imageSmoothingEnabled = false;
    if (!level) return;
    const cx = Math.round(cam.x);
    drawBackground(level.def.theme, cx);
    items.forEach(it => { if (it.emerge > 0) drawItem(it, cx); });   // せり出し中はブロックの後ろ
    drawTiles(cx);
    drawCoins(cx);
    drawMovers(cx);
    drawCheckpoints(cx);
    drawGoal(cx);
    items.forEach(it => { if (!it.emerge) drawItem(it, cx); });
    enemies.forEach(e => drawEnemy(e, cx));
    shots.forEach(s => ctx.drawImage(SHOT, Math.round(s.x - cx), Math.round(s.y)));
    if (state !== 'title') drawPlayer(cx);
    drawParticles(cx);
  }

  function drawTiles(cx) {
    const g = level.grid;
    const c0 = Math.max(0, Math.floor(cx / TS)), c1 = Math.min(level.w - 1, Math.floor((cx + W) / TS));
    for (let r = 0; r < ROWS; r++) {
      for (let c = c0; c <= c1; c++) {
        const t = g[r][c];
        if (!t) continue;
        let oy = 0;
        for (const b of bumps) if (b.tx === c && b.ty === r) oy = -Math.round(Math.sin((b.t / 8) * Math.PI) * 4);
        const x = c * TS - cx, y = r * TS + oy;
        switch (t) {
          case T_GROUND: {
            const top = r === 0 || g[r - 1][c] !== T_GROUND;
            ctx.drawImage(top ? TILE.groundTop : TILE.ground[(c * 7 + r * 3) % 2], x, y);
            ctx.fillStyle = C.edge;
            if (c > 0 && g[r][c - 1] !== T_GROUND) ctx.fillRect(x, y + (top ? 5 : 0), 1, top ? 11 : 16);
            if (c < level.w - 1 && g[r][c + 1] !== T_GROUND) ctx.fillRect(x + 15, y + (top ? 5 : 0), 1, top ? 11 : 16);
            break;
          }
          case T_BRICK: ctx.drawImage(TILE.brick, x, y); break;
          case T_Q: ctx.drawImage(TILE.q, x, y); break;
          case T_USED: ctx.drawImage(TILE.used, x, y); break;
          case T_STONE: ctx.drawImage(TILE.stone, x, y); break;
          case T_ONEWAY: ctx.drawImage(TILE.oneway, x, y); break;
          case T_SPIKE: ctx.drawImage(TILE.spike, x, y); break;
        }
      }
    }
  }

  function drawCoins(cx) {
    const widths = [8, 6, 2, 6];
    const w = widths[Math.floor(frameCount / 8) % 4];
    for (const c of level.coins) {
      if (c.taken) continue;
      const x = c.x - cx;
      if (x < -10 || x > W + 10) continue;
      ctx.drawImage(COIN, Math.round(x - w / 2), c.y - 5, w, 10);
    }
  }

  function drawMovers(cx) {
    for (const m of level.movers) {
      const x = Math.round(m.x - cx), y = Math.round(m.y);
      if (x > W || x + m.w < 0) continue;
      ctx.fillStyle = C.stoneDark; ctx.fillRect(x, y, m.w, m.h);
      ctx.fillStyle = C.stone; ctx.fillRect(x, y, m.w, m.h - 2);
      ctx.fillStyle = C.stoneLight; ctx.fillRect(x, y, m.w, 1);
      ctx.fillStyle = '#E9B24A';
      for (let i = 4; i < m.w - 4; i += 8) ctx.fillRect(x + i, y + 2, 4, 2);
    }
  }

  function drawCheckpoints(cx) {
    for (const cp of level.checkpoints) {
      const x = cp.px - cx, base = (ROWS - cp.y) * TS;
      if (x < -20 || x > W + 20) continue;
      ctx.fillStyle = C.pole; ctx.fillRect(x, base - 28, 2, 28);
      ctx.fillRect(x - 3, base - 2, 8, 2);
      const wave = cp.active ? Math.round(Math.sin(frameCount * 0.15)) : 0;
      ctx.fillStyle = cp.active ? C.flag : '#B9AFA4';
      ctx.fillRect(x + 2, base - 28 + wave, 10, 7);
      ctx.fillRect(x + 12, base - 26 + wave, 2, 3);
    }
  }

  function drawGoal(cx) {
    const g = level.goal;
    const x = g.px - cx;
    if (x < -40 || x > W + 40) return;
    const top = g.base - 8 * TS;
    ctx.fillStyle = C.pole; ctx.fillRect(x, top, 2, g.base - top);
    ctx.fillStyle = '#E9B24A'; ctx.fillRect(x - 2, top - 6, 6, 6);
    ctx.fillStyle = C.stone; ctx.fillRect(x - 7, g.base - 8, 16, 8);
    ctx.fillStyle = C.stoneLight; ctx.fillRect(x - 7, g.base - 8, 16, 1);
    // 旗：クリアするとオレンジになって上がる
    const fy = Math.round(g.base - 30 - (g.base - 30 - (top + 2)) * easeOut(g.flag));
    const done = g.flag > 0;
    ctx.fillStyle = done ? C.flag : C.flagOff;
    ctx.fillRect(x + 2, fy, 18, 12);
    ctx.fillStyle = done ? '#A8562F' : '#C9BFB3';
    ctx.fillRect(x + 2, fy + 11, 18, 1);
    // 旗にキャラクターの目
    ctx.fillStyle = done ? C.eye : '#9C9288';
    ctx.fillRect(x + 7, fy + 4, 2, 2); ctx.fillRect(x + 14, fy + 4, 2, 2);
  }
  const easeOut = t => 1 - Math.pow(1 - t, 3);

  function drawEnemy(e, cx) {
    const x = Math.round(e.x - cx - 1), y = Math.round(e.y - 1);
    if (x < -20 || x > W + 20 || (e.dead && e.kill === 'stomp' && e.deadT > 30)) return;
    if (e.dead && e.kill === 'stomp') {
      ctx.drawImage(e.type === 'fly' ? ESPR.flyFlat : ESPR.bugFlat, x, y);
      return;
    }
    const frames = ESPR[e.type];
    const img = frames[Math.floor((e.t + (e.type === 'fly' ? 0 : 0)) / (e.type === 'fly' ? 6 : 10)) % 2];
    if (e.dead) { // ひっくり返って落ちる
      ctx.save(); ctx.translate(x + 8, y + 6); ctx.scale(1, -1); ctx.drawImage(img, -8, -6); ctx.restore();
      return;
    }
    ctx.drawImage(img, x, y);
  }

  function drawItem(it, cx) {
    const x = Math.round(it.x - cx - 1), y = Math.round(it.y - 1);
    if (x < -24 || x > W + 24) return;
    if (it.type === 'star') ctx.drawImage(ISPR.star[Math.floor(it.t / 4) % 2], x, y);
    else if (it.type === 'oneup') ctx.drawImage(ISPR.oneup, x - 4, y + 2, 24, 16);
    else ctx.drawImage(ISPR[it.type], x, y);
  }

  function drawPlayer(cx) {
    const p = player;
    if (!p.dead && p.inv > 0 && game.morphT === 0 && Math.floor(p.inv / 4) % 2 === 0) return;
    let frame = 'idle';
    if (p.dead) frame = 'jump';
    else if (!p.onGround) frame = p.vy < 0 ? 'jump' : 'fall';
    else if (p.shootT > 0) frame = 'jump';
    else if (Math.abs(p.vx) > 0.2) frame = Math.floor(p.walkT / 8) % 2 ? 'walkA' : 'walkB';
    // 姿と色：変身中は前後の姿を交互に、無敵中は色が切り替わる
    let size = formSize(p.form), pal = formPal(p.form);
    if (game.morphT > 0 && game.morph) {
      const m = Math.floor(game.morphT / 4) % 2 ? game.morph.from : game.morph.to;
      size = m.size; pal = m.pal;
    }
    if (p.star > 0) pal = p.star > 120 || Math.floor(p.star / 6) % 2 ? 2 + Math.floor(frameCount / 3) % 3 : pal;
    const img = pSprite(size, frame, pal);
    const sx = p.squash > 0 ? 1.17 : 1, sy = p.squash > 0 ? 0.81 : 1;
    const dw = Math.round(img.width * sx), dh = Math.round(img.height * sy);
    const dx = Math.round(p.x + p.w / 2 - dw / 2 - cx), dy = Math.round(p.y + p.h - dh + 1);
    ctx.drawImage(img, dx, dy, dw, dh);
    // 目（進行方向へ1px寄せる／まばたき／やられたら閉じる）
    ctx.fillStyle = C.eye;
    const eo = p.dead ? 0 : p.face;
    const ey = dy + Math.round(EYE_Y[size] * sy);
    const closed = p.dead || p.blink > 0;
    const eh = closed ? 1 : 2;
    ctx.fillRect(dx + Math.round(6 * sx) + eo, ey + (closed ? 1 : 0), 2, eh);
    ctx.fillRect(dx + Math.round(16 * sx) + eo, ey + (closed ? 1 : 0), 2, eh);
  }

  function drawParticles(cx) {
    for (const pt of particles) {
      if (pt.coin) { ctx.drawImage(COIN, Math.round(pt.x - cx), Math.round(pt.y)); continue; }
      ctx.globalAlpha = Math.min(1, pt.life / 15);
      ctx.fillStyle = pt.color;
      ctx.fillRect(Math.round(pt.x - cx), Math.round(pt.y), pt.size, pt.size);
    }
    ctx.globalAlpha = 1;
    ctx.font = '8px "DotGothic16", monospace';
    ctx.textAlign = 'center';
    for (const pp of popups) {
      ctx.fillStyle = THEMES[level.def.theme].night ? '#F4EDE4' : '#2B2420';
      ctx.globalAlpha = Math.min(1, pp.life / 15);
      ctx.fillText(pp.text, Math.round(pp.x - cx), Math.round(pp.y));
    }
    ctx.globalAlpha = 1;
  }

  // ===================== 画面・UI =====================
  const lifeIcon = playerPortrait(1);
  $('hud-life-icon').src = lifeIcon.toDataURL();
  const hudCache = {};
  function setText(id, v) { if (hudCache[id] !== v) { hudCache[id] = v; $(id).textContent = v; } }
  function fmtTime(frames, precise) {
    const s = frames / 60;
    const m = Math.floor(s / 60), r = s - m * 60;
    return precise ? `${m}:${r.toFixed(1).padStart(4, '0')}` : `${m}:${String(Math.floor(r)).padStart(2, '0')}`;
  }
  function updateHud() {
    setText('hud-stage', `ステージ ${game.stage + 1}`);
    setText('hud-coins', String(game.coins));
    setText('hud-lives', String(Math.max(0, game.lives)));
    setText('hud-time', fmtTime(game.frames));
  }

  const SOUND_ON = '<svg viewBox="0 0 8 8"><path d="M0 3h2l2-2h1v6H4L2 5H0zM6 2h1v4H6z"/></svg>';
  const SOUND_OFF = '<svg viewBox="0 0 8 8"><path d="M0 3h2l2-2h1v6H4L2 5H0zM6 3h1v1H6zM7 2h1v1H7zM7 4h1v1H7z"/></svg>';
  function renderSoundBtn() { $('btn-sound').innerHTML = Sound.muted ? SOUND_OFF : SOUND_ON; }
  $('btn-sound').addEventListener('click', e => {
    e.currentTarget.blur();
    Sound.init();
    Sound.setMuted(!Sound.muted);
    save.muted = Sound.muted; writeSave();
    renderSoundBtn();
  });
  $('btn-pause').addEventListener('click', e => { e.currentTarget.blur(); if (state === 'play') pause(); });
  renderSoundBtn();

  function showOverlay(html, cls = '') {
    overlay.innerHTML = html;
    overlay.className = 'show ' + cls;
    const primary = overlay.querySelector('.primary');
    if (primary && !document.body.classList.contains('touch')) primary.focus();
  }
  function hideOverlay() { overlay.className = ''; overlay.innerHTML = ''; }
  let bannerTimer = null;
  function showBanner(html) {
    banner.innerHTML = html;
    banner.hidden = false;
    banner.style.animation = 'none'; void banner.offsetWidth; banner.style.animation = '';
    clearTimeout(bannerTimer);
    bannerTimer = setTimeout(() => { banner.hidden = true; }, 2300);
  }

  function pause() {
    state = 'paused';
    keys.clear(); syncKeys();
    Sound.stopBgm();
    Sound.play('select');
    showOverlay(`
      <div class="panel">
        <h2>一時停止</h2>
        <div class="btns">
          <button class="btn primary" data-action="resume">再開する</button>
          <button class="btn" data-action="restart">ステージをやり直す</button>
          <button class="btn" data-action="title">タイトルへ</button>
        </div>
      </div>`);
  }
  function resume() {
    hideOverlay();
    state = 'play';
    input.jumpPressed = input.firePressed = false;
    playStageBgm();
  }

  function showClear() {
    state = 'clear';
    const idx = game.stage;
    const time = game.frames;
    const prev = save.best[idx];
    const isRecord = prev == null || time < prev;
    if (isRecord) save.best[idx] = time;
    save.unlocked = Math.max(save.unlocked, Math.min(LEVELS.length, idx + 2));
    writeSave();
    game.run.frames += time;
    game.run.coins += game.stageCoins;
    const last = idx === LEVELS.length - 1;
    showOverlay(`
      <div class="panel">
        <h2>ステージ ${idx + 1} クリア</h2>
        <table class="stats">
          <tr><td>タイム</td><td>${fmtTime(time, true)}</td></tr>
          <tr><td>コイン</td><td>${game.stageCoins} / ${level.totalCoins}</td></tr>
          <tr><td>ベスト</td><td>${fmtTime(save.best[idx], true)}</td></tr>
        </table>
        ${isRecord && prev != null ? '<p class="new-record">ベストタイム更新</p>' : ''}
        <div class="btns">
          <button class="btn primary" data-action="${last ? 'ending' : 'next'}">${last ? '結果を見る' : '次のステージへ'}</button>
          <button class="btn" data-action="title">タイトルへ</button>
        </div>
      </div>`, 'clear-bg');
  }

  function showEnding() {
    state = 'ending';
    hud.hidden = true;
    showOverlay(`
      <div class="panel">
        <h2>全ステージクリア</h2>
        <p class="sub">最後まで遊んでいただき、ありがとうございました。</p>
        <table class="stats">
          <tr><td>合計タイム</td><td>${fmtTime(game.run.frames, true)}</td></tr>
          <tr><td>集めたコイン</td><td>${game.run.coins}</td></tr>
        </table>
        <div class="btns"><button class="btn primary" data-action="title">タイトルへ</button></div>
      </div>`);
  }

  function showTitle() {
    state = 'title';
    Sound.stopBgm();
    hud.hidden = true;
    banner.hidden = true;
    loadStage(0);
    cam.x = 0;
    const stageBtns = LEVELS.map((lv, i) => {
      const locked = i + 1 > save.unlocked;
      const best = save.best[i] != null ? `ベスト ${fmtTime(save.best[i], true)}` : (locked ? '未開放' : '未クリア');
      return `<button class="stage-btn" data-action="stage" data-n="${i}" ${locked ? 'disabled' : ''}>${i + 1}. ${lv.name}<small>${best}</small></button>`;
    }).join('');
    const help = document.body.classList.contains('touch')
      ? '左下で移動（外側の端を押すとダッシュ）、右下の JUMP でジャンプ、B でダッシュ・ビーム発射。'
      : '移動: ← →　ジャンプ: スペース / Z　ダッシュ・ビーム: Shift / X　一時停止: Esc';
    showOverlay(`
      <div class="panel title-panel">
        <canvas id="title-sprite" width="24" height="16"></canvas>
        <h1>PIXEL HOP</h1>
        <p class="sub">ピクセル・ホップ</p>
        <div class="btns"><button class="btn primary" data-action="start">スタート</button></div>
        <div class="stage-select">ステージ選択<div class="row">${stageBtns}</div></div>
        <p class="help">${help}</p>
        <a class="top-link" href="../">トップへ戻る</a>
      </div>`, 'clear-bg');
    $('title-sprite').getContext('2d').drawImage(playerPortrait(2), 0, 0);
  }

  function newRun(idx) {
    player.form = 'small';
    game.lives = START_LIVES;
    game.coins = 0;
    game.run = { frames: 0, coins: 0 };
    startStage(idx);
  }

  overlay.addEventListener('click', e => {
    const b = e.target.closest('[data-action]');
    if (!b) return;
    Sound.init();
    Sound.play('select');
    switch (b.dataset.action) {
      case 'start': newRun(0); break;
      case 'stage': newRun(Number(b.dataset.n)); break;
      case 'resume': resume(); break;
      case 'restart': game.lives = Math.max(game.lives, 1); startStage(game.stage); break;
      case 'retry': game.lives = START_LIVES; player.form = 'small'; startStage(game.stage); break;
      case 'next': startStage(game.stage + 1); break;
      case 'ending': showEnding(); break;
      case 'title': showTitle(); break;
    }
  });

  document.addEventListener('visibilitychange', () => { if (document.hidden && state === 'play') pause(); });

  // ===================== 画面サイズ調整 =====================
  function fit() {
    const vw = window.innerWidth, vh = window.innerHeight;
    const s = Math.min(vw / W, vh / H);
    stageEl.style.width = `${Math.floor(W * s)}px`;
    stageEl.style.height = `${Math.floor(H * s)}px`;
    document.documentElement.style.setProperty('--u', `${s}px`);
    // キャンバスは「ゲーム内1px = 整数個の実ピクセル」で描くとドットがにじまない
    scale = Math.max(1, Math.round(s * (window.devicePixelRatio || 1)));
    canvas.width = W * scale; canvas.height = H * scale;
  }
  window.addEventListener('resize', fit);
  window.addEventListener('orientationchange', () => setTimeout(fit, 200));
  fit();

  // ===================== メインループ =====================
  let last = performance.now(), acc = 0, frozen = false;
  function loop(now) {
    requestAnimationFrame(loop);
    let dt = now - last; last = now;
    if (dt > 100) dt = 100;
    acc += dt;
    while (acc >= STEP) { if (!frozen) update(); acc -= STEP; }
    render();
  }
  showTitle();
  requestAnimationFrame(loop);

  // Service Worker（オフラインでも遊べるように）
  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }

  // 動作確認用（開発者ツールから状態を見られる）
  window.__pixelHop = { get state() { return state; }, player, game, cam, get level() { return level; }, get enemies() { return enemies; }, get items() { return items; }, get shots() { return shots; }, startStage, input, setForm, spawnItem,
    set frozen(v) { frozen = v; }, step(n) { for (let i = 0; i < n; i++) update(); } };
})();
