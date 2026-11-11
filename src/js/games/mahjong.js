// Mahjong solitaire with the classic "Turtle" layout and the traditional tile faces:
// dots, bamboo, characters, winds, dragons, flowers and seasons (144 tiles).
// A deal is made by taking the full layout apart two free tiles at a time,
// so every deal can be solved.
(function (name, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else (window.RA = window.RA || { modules: {} }).modules[name] = api;
})('mahjong', function () {
  const isNode = typeof require === 'function';
  const U = isNode ? require('../core/util.js') : window.RA.modules.util;
  const A = isNode ? null : window.RA.audio;

  // ---------- Layout ----------
  // Positions are in half tiles: a tile at (x, y) covers x..x+2 and y..y+2.
  // Rows of the bottom layer: [first column, last column] in whole tiles.
  const BASE_ROWS = [[1, 12], [3, 10], [2, 11], [1, 12], [1, 12], [2, 11], [3, 10], [1, 12]];

  function turtleSlots() {
    const out = [];
    BASE_ROWS.forEach(function (r, y) {
      for (let x = r[0]; x <= r[1]; x++) out.push({ x: x * 2, y: y * 2, l: 0 });
    });
    // The three tiles on the sides sit half a row down, between rows 3 and 4.
    out.push({ x: 0, y: 7, l: 0 }, { x: 26, y: 7, l: 0 }, { x: 28, y: 7, l: 0 });
    for (let y = 1; y <= 6; y++) for (let x = 4; x <= 9; x++) out.push({ x: x * 2, y: y * 2, l: 1 });
    for (let y = 2; y <= 5; y++) for (let x = 5; x <= 8; x++) out.push({ x: x * 2, y: y * 2, l: 2 });
    for (let y = 3; y <= 4; y++) for (let x = 6; x <= 7; x++) out.push({ x: x * 2, y: y * 2, l: 3 });
    out.push({ x: 13, y: 7, l: 4 }); // the cap, on the four tiles of layer 3
    return out;
  }

  const overlaps = function (a, b) { return Math.abs(a.x - b.x) < 2 && Math.abs(a.y - b.y) < 2; };

  // A tile is free when no tile lies on it and its left side or its right side is open.
  function isFree(t, tiles) {
    let left = false;
    let right = false;
    for (const o of tiles) {
      if (o === t) continue;
      if (o.l === t.l + 1 && overlaps(o, t)) return false;
      if (o.l !== t.l || Math.abs(o.y - t.y) >= 2) continue;
      if (o.x === t.x - 2) left = true;
      else if (o.x === t.x + 2) right = true;
    }
    return !left || !right;
  }

  function freeTiles(tiles) {
    return tiles.filter(function (t) { return isFree(t, tiles); });
  }

  // Takes the given tiles apart, two random free ones at a time.
  // Returns the pairs in removal order, or null when the random choices reach a dead end.
  function takeApart(slots, rnd) {
    let remaining = slots.slice();
    const pairs = [];
    while (remaining.length) {
      const free = freeTiles(remaining);
      if (free.length < 2) return null;
      const a = free.splice(Math.floor(rnd() * free.length), 1)[0];
      const b = free[Math.floor(rnd() * free.length)];
      remaining = remaining.filter(function (s) { return s !== a && s !== b; });
      pairs.push([a, b]);
    }
    return pairs;
  }

  function solvablePairs(slots, rnd, tries) {
    for (let i = 0; i < (tries || 300); i++) {
      const pairs = takeApart(slots, rnd);
      if (pairs) return pairs;
    }
    return null;
  }

  // ---------- Tile kinds ----------
  // type = matching group (0..35). Groups 0..33 have four equal tiles.
  // Group 34 is the four flowers and group 35 the four seasons: inside a group any two match.
  // face = what is drawn: d1..d9 dots, b1..b9 bamboo, c1..c9 characters,
  // w0..w3 winds, g0..g2 dragons, f0..f3 flowers, s0..s3 seasons.
  function facesOfType(type) {
    if (type < 9) return rep('d' + (type + 1));
    if (type < 18) return rep('b' + (type - 8));
    if (type < 27) return rep('c' + (type - 17));
    if (type < 31) return rep('w' + (type - 27));
    if (type < 34) return rep('g' + (type - 31));
    const k = type === 34 ? 'f' : 's';
    return [k + 0, k + 1, k + 2, k + 3];
  }
  function rep(face) {
    return [face, face, face, face];
  }

  // Full deal. Each tile: { id, x, y, l, type, face }. Tiles 2k and 2k+1 are a pair that
  // can be removed in that order.
  function makeLayout(rnd) {
    const pairs = solvablePairs(turtleSlots(), rnd);
    if (!pairs) throw new Error('layout failed');
    const types = [];
    for (let t = 0; t < 36; t++) types.push(t, t);
    U.shuffle(types, rnd);
    const used = {};
    const tiles = [];
    pairs.forEach(function (p, k) {
      const type = types[k];
      p.forEach(function (s) {
        used[type] = (used[type] || 0) + 1;
        tiles.push({ id: tiles.length, x: s.x, y: s.y, l: s.l, type: type, face: facesOfType(type)[used[type] - 1] });
      });
    });
    return tiles;
  }

  function findPair(tiles) {
    const seen = {};
    for (const t of freeTiles(tiles)) {
      if (seen[t.type]) return [seen[t.type], t];
      seen[t.type] = t;
    }
    return null;
  }

  // Gives the remaining tiles new faces, so that the board can be cleared again.
  // Returns false when the shape itself cannot be cleared (for example two stacked tiles).
  function reshuffle(tiles, rnd) {
    const pairs = solvablePairs(tiles, rnd, 200);
    if (!pairs) return false;
    const byType = {};
    tiles.forEach(function (t) { (byType[t.type] = byType[t.type] || []).push(t.face); });
    const stock = [];
    Object.keys(byType).forEach(function (type) {
      const faces = byType[type];
      for (let i = 0; i + 1 < faces.length; i += 2) stock.push({ type: Number(type), faces: [faces[i], faces[i + 1]] });
    });
    U.shuffle(stock, rnd);
    pairs.forEach(function (p, k) {
      p[0].type = p[1].type = stock[k].type;
      p[0].face = stock[k].faces[0];
      p[1].face = stock[k].faces[1];
    });
    return true;
  }

  // ---------- Tile faces (SVG, 60 x 80) ----------
  const INK = '#1b1b1b';
  const RED = '#c0261c';
  const GREEN = '#17803d';
  const BLUE = '#1f4fa8';
  const CJK = 'font-family="Songti SC, STSong, PingFang SC, Hiragino Sans GB, WenQuanYi Zen Hei, serif"';
  const NUMERALS = ['一', '二', '三', '四', '五', '六', '七', '八', '九'];
  const WINDS = [['東', 'E'], ['南', 'S'], ['西', 'O'], ['北', 'N']];
  const FLOWERS = ['梅', '蘭', '菊', '竹'];
  const SEASONS = ['春', '夏', '秋', '冬'];

  function dot(x, y, r, color) {
    return '<circle cx="' + x + '" cy="' + y + '" r="' + r + '" fill="' + color + '"/>' +
      '<circle cx="' + x + '" cy="' + y + '" r="' + (r * 0.62).toFixed(1) + '" fill="none" stroke="#fff" stroke-width="' + (r * 0.16).toFixed(1) + '"/>' +
      '<circle cx="' + x + '" cy="' + y + '" r="' + (r * 0.22).toFixed(1) + '" fill="#fff"/>';
  }

  // Positions and colours of the dots for 1..9.
  const DOTS = {
    1: [[30, 42, 21, RED]],
    2: [[30, 25, 13, GREEN], [30, 59, 13, BLUE]],
    3: [[16, 21, 10, BLUE], [30, 42, 10, RED], [44, 63, 10, GREEN]],
    4: [[18, 25, 11, BLUE], [42, 25, 11, GREEN], [18, 59, 11, GREEN], [42, 59, 11, BLUE]],
    5: [[16, 22, 9.5, BLUE], [44, 22, 9.5, GREEN], [30, 42, 9.5, RED], [16, 62, 9.5, GREEN], [44, 62, 9.5, BLUE]],
    6: [[18, 20, 9, GREEN], [42, 20, 9, GREEN], [18, 42, 9, RED], [42, 42, 9, RED], [18, 64, 9, RED], [42, 64, 9, RED]],
    7: [[14, 15, 6.5, GREEN], [30, 21, 6.5, GREEN], [46, 27, 6.5, GREEN], [18, 46, 8.5, RED], [42, 46, 8.5, RED], [18, 66, 8.5, RED], [42, 66, 8.5, RED]],
    8: [[18, 14, 7.5, BLUE], [42, 14, 7.5, BLUE], [18, 32, 7.5, BLUE], [42, 32, 7.5, BLUE], [18, 50, 7.5, BLUE], [42, 50, 7.5, BLUE], [18, 68, 7.5, BLUE], [42, 68, 7.5, BLUE]],
    9: [[13, 19, 7.5, GREEN], [30, 19, 7.5, GREEN], [47, 19, 7.5, GREEN], [13, 42, 7.5, RED], [30, 42, 7.5, RED], [47, 42, 7.5, RED], [13, 65, 7.5, BLUE], [30, 65, 7.5, BLUE], [47, 65, 7.5, BLUE]],
  };

  function stick(x, y, h, color) {
    const w = 7;
    return '<g fill="' + color + '">' +
      '<rect x="' + (x - w / 2) + '" y="' + (y - h / 2) + '" width="' + w + '" height="' + h + '" rx="3"/>' +
      '<rect x="' + (x - w / 2 - 1.5) + '" y="' + (y - 1.5) + '" width="' + (w + 3) + '" height="3" rx="1.5"/>' +
      '</g><rect x="' + (x - 0.8) + '" y="' + (y - h / 2 + 3) + '" width="1.6" height="' + (h - 6) + '" fill="#fff" opacity="0.55"/>';
  }

  // Positions and colours of the bamboo sticks for 2..9. [x, y, height, colour]
  const STICKS = {
    2: [[30, 24, 26, GREEN], [30, 58, 26, GREEN]],
    3: [[30, 23, 26, RED], [18, 58, 26, GREEN], [42, 58, 26, GREEN]],
    4: [[18, 24, 26, GREEN], [42, 24, 26, GREEN], [18, 58, 26, GREEN], [42, 58, 26, GREEN]],
    5: [[15, 24, 24, GREEN], [45, 24, 24, GREEN], [30, 42, 24, RED], [15, 60, 24, GREEN], [45, 60, 24, GREEN]],
    6: [[15, 25, 26, GREEN], [30, 25, 26, GREEN], [45, 25, 26, GREEN], [15, 59, 26, GREEN], [30, 59, 26, GREEN], [45, 59, 26, GREEN]],
    7: [[30, 17, 20, RED], [15, 42, 20, GREEN], [30, 42, 20, GREEN], [45, 42, 20, GREEN], [15, 66, 20, GREEN], [30, 66, 20, GREEN], [45, 66, 20, GREEN]],
    8: [[12, 24, 26, GREEN], [24, 24, 26, GREEN], [36, 24, 26, GREEN], [48, 24, 26, GREEN], [12, 60, 26, GREEN], [24, 60, 26, GREEN], [36, 60, 26, GREEN], [48, 60, 26, GREEN]],
    9: [[15, 17, 20, RED], [30, 17, 20, RED], [45, 17, 20, RED], [15, 42, 20, GREEN], [30, 42, 20, GREEN], [45, 42, 20, GREEN], [15, 66, 20, BLUE], [30, 66, 20, BLUE], [45, 66, 20, BLUE]],
  };

  function label(text) {
    return '<text x="5" y="13" font-family="Helvetica, Arial, sans-serif" font-size="11" font-weight="700" fill="#6b6253">' + text + '</text>';
  }

  function glyph(ch, y, size, color) {
    return '<text x="30" y="' + y + '" text-anchor="middle" ' + CJK + ' font-size="' + size + '" font-weight="700" fill="' + color + '">' + ch + '</text>';
  }

  function petals(x, y, color) {
    let out = '';
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2 - Math.PI / 2;
      out += '<circle cx="' + (x + Math.cos(a) * 5).toFixed(1) + '" cy="' + (y + Math.sin(a) * 5).toFixed(1) + '" r="3.6" fill="' + color + '"/>';
    }
    return out + '<circle cx="' + x + '" cy="' + y + '" r="2.4" fill="#f6c945"/>';
  }

  // SVG markup of one tile face.
  function faceSvg(face) {
    const kind = face[0];
    const n = Number(face.slice(1));
    let body = '';
    if (kind === 'd') {
      body = DOTS[n].map(function (d) { return dot(d[0], d[1], d[2], d[3]); }).join('') + label(n);
    } else if (kind === 'b') {
      if (n === 1) {
        // One bamboo: a single big cane (the traditional tile shows a bird).
        body = '<rect x="24" y="14" width="12" height="56" rx="5" fill="' + GREEN + '"/>' +
          '<rect x="21" y="30" width="18" height="4" rx="2" fill="#0d5a2a"/><rect x="21" y="50" width="18" height="4" rx="2" fill="#0d5a2a"/>' +
          '<rect x="28.5" y="17" width="2.5" height="50" fill="#fff" opacity="0.5"/>' +
          '<path d="M36 24c8-6 13-5 16-1-5 4-10 5-16 1z" fill="' + RED + '"/>';
      } else {
        body = STICKS[n].map(function (s) { return stick(s[0], s[1], s[2], s[3]); }).join('');
      }
      body += label(n);
    } else if (kind === 'c') {
      body = glyph(NUMERALS[n - 1], 38, 30, INK) + glyph('萬', 72, 30, RED) + label(n);
    } else if (kind === 'w') {
      body = glyph(WINDS[n][0], 58, 44, INK) + label(WINDS[n][1]);
    } else if (kind === 'g') {
      if (n === 0) body = glyph('中', 58, 46, RED);
      else if (n === 1) body = glyph('發', 58, 44, GREEN);
      else body = '<rect x="11" y="13" width="38" height="54" rx="4" fill="none" stroke="' + BLUE + '" stroke-width="4"/><rect x="17" y="19" width="26" height="42" rx="2" fill="none" stroke="' + BLUE + '" stroke-width="1.5"/>';
    } else if (kind === 'f') {
      body = petals(44, 16, RED) + glyph(FLOWERS[n], 62, 36, GREEN) + label(n + 1);
    } else {
      body = '<circle cx="45" cy="15" r="7" fill="#f6a21c"/>' + glyph(SEASONS[n], 62, 36, BLUE) + label(n + 1);
    }
    return '<svg viewBox="0 0 60 80" aria-hidden="true">' + body + '</svg>';
  }

  // ---------- Browser interface ----------
  const HW = 30; // half tile width in px
  const HH = 40; // half tile height in px
  const LX = -6; // shift of each higher layer
  const LY = -7;
  const PAD = 34;
  const BOARD_W = 30 * HW + PAD * 2;
  const BOARD_H = 16 * HH + PAD * 2;

  function mount(container) {
    let alive = true;
    const rnd = U.makeRng();
    let tiles = [];
    let history = [];
    let selected = null;
    let hintPair = null;
    let note = '';
    let score = 0;
    let stuck = false;
    let startedAt = Date.now();
    let endedAt = null;
    const root = U.el('div', { class: 'mahjong game-panel table-jade' });
    container.appendChild(root);
    if (A) A.startAmbient();

    function elapsed() {
      const secs = Math.floor(((endedAt || Date.now()) - startedAt) / 1000);
      return Math.floor(secs / 60) + ':' + (secs % 60 < 10 ? '0' : '') + (secs % 60);
    }
    const clock = setInterval(function () {
      const node = root.querySelector('.clock');
      if (node && !endedAt) node.textContent = elapsed();
    }, 1000);

    function newGame() {
      tiles = makeLayout(rnd);
      history = [];
      selected = null;
      hintPair = null;
      note = '';
      score = 0;
      stuck = false;
      startedAt = Date.now();
      endedAt = null;
      render();
    }

    function afterChange() {
      selected = null;
      hintPair = null;
      stuck = tiles.length > 0 && !findPair(tiles);
      if (stuck) {
        note = 'Non ci sono più coppie libere. Premi Mescola, oppure Annulla mossa.';
        if (A) A.sfx.bad();
      }
      render();
    }

    function pick(tile) {
      if (!alive || endedAt) return;
      if (!isFree(tile, tiles)) {
        note = 'Questa tessera è bloccata: deve avere un lato libero e niente sopra.';
        if (A) A.sfx.bad();
        return render();
      }
      note = '';
      hintPair = null;
      if (!selected) {
        selected = tile;
        if (A) A.sfx.click();
        return render();
      }
      if (selected === tile) {
        selected = null;
        return render();
      }
      if (selected.type !== tile.type) {
        selected = tile;
        if (A) A.sfx.click();
        return render();
      }
      history.push([selected, tile]);
      const gone = selected;
      tiles = tiles.filter(function (t) { return t !== gone && t !== tile; });
      score += 10;
      if (A) A.sfx.pop();
      if (tiles.length === 0) {
        endedAt = Date.now();
        selected = null;
        if (A) A.sfx.win();
        return render();
      }
      afterChange();
    }

    function undo() {
      if (endedAt) return;
      const pair = history.pop();
      if (!pair) return;
      tiles = tiles.concat(pair);
      score = Math.max(0, score - 10);
      note = 'Mossa annullata.';
      afterChange();
    }

    function hint() {
      if (endedAt) return;
      const pair = findPair(tiles);
      selected = null;
      if (!pair) return afterChange();
      hintPair = pair;
      score = Math.max(0, score - 5);
      note = 'Guarda le due tessere che lampeggiano.';
      render();
    }

    function shuffleTiles() {
      if (endedAt || !tiles.length) return;
      history = [];
      if (reshuffle(tiles, rnd)) {
        note = 'Tessere mescolate.';
        afterChange();
      } else {
        selected = null;
        stuck = true;
        note = 'Queste tessere non si possono più liberare. Inizia una nuova partita.';
        render();
      }
    }

    function fit() {
      const wrap = root.querySelector('.mj-wrap');
      const board = root.querySelector('.mj-board');
      if (!wrap || !board) return;
      const availH = Math.max(300, window.innerHeight - 56 - 250);
      const scale = Math.min(1.25, wrap.clientWidth / BOARD_W, availH / BOARD_H);
      board.style.transform = 'scale(' + scale + ')';
      board.style.marginLeft = (-BOARD_W / 2) + 'px';
      wrap.style.height = Math.ceil(BOARD_H * scale) + 'px';
    }

    function render() {
      if (!alive) return;
      root.innerHTML = '';
      root.appendChild(U.el('div', { class: 'pill-row' },
        U.el('div', { class: 'mj-title', text: 'Mahjong' }),
        U.el('div', { class: 'pill', text: 'Coppie rimaste: ' + tiles.length / 2 }),
        U.el('div', { class: 'pill', text: 'Punti: ' + score }),
        U.el('div', { class: 'pill' }, 'Tempo ', U.el('span', { class: 'clock', text: elapsed() }))));

      const board = U.el('div', { class: 'mj-board', style: 'width:' + BOARD_W + 'px;height:' + BOARD_H + 'px' });
      const free = new Set(freeTiles(tiles));
      tiles.slice().sort(function (a, b) { return a.l - b.l || a.y - b.y || a.x - b.x; }).forEach(function (t) {
        const cls = ['mj-tile', free.has(t) ? 'free' : 'blocked'];
        if (selected === t) cls.push('sel');
        if (hintPair && hintPair.indexOf(t) >= 0) cls.push('hint');
        const node = U.el('div', {
          class: cls.join(' '),
          'data-id': t.id,
          style: 'left:' + (PAD + t.x * HW + t.l * LX) + 'px;top:' + (PAD + t.y * HH + t.l * LY) + 'px;width:' + (HW * 2 - 5) + 'px;height:' + (HH * 2 - 6) + 'px;z-index:' + (t.l * 1000 + t.y * 32 + t.x),
          onclick: function () { pick(t); },
        });
        node.innerHTML = faceSvg(t.face);
        board.appendChild(node);
      });
      root.appendChild(U.el('div', { class: 'mj-wrap' }, board));

      root.appendChild(U.el('div', { class: 'msg', text: note || 'Tocca due tessere uguali e libere. Tutti i fiori fanno coppia tra loro, e così le stagioni.' }));
      root.appendChild(U.el('div', { class: 'actions' },
        U.el('button', { class: 'btn', text: 'Suggerimento', onclick: hint }),
        U.el('button', { class: 'btn', text: 'Annulla mossa', onclick: undo }),
        U.el('button', { class: 'btn' + (stuck ? ' pulse' : ''), text: 'Mescola', onclick: shuffleTiles }),
        U.el('button', { class: 'btn ghost', text: 'Nuova partita', onclick: newGame })));

      if (endedAt) {
        root.appendChild(U.el('div', { class: 'overlay' }, U.el('div', { class: 'card-box' },
          U.el('h2', { text: 'Tavolo pulito!' }),
          U.el('p', { text: 'Punti: ' + score + '. Tempo: ' + elapsed() + '.' }),
          U.el('button', { class: 'btn big', text: 'Nuova partita', onclick: newGame }))));
      }
      fit();
    }

    window.addEventListener('resize', fit);
    newGame();
    return {
      destroy: function () {
        alive = false;
        clearInterval(clock);
        window.removeEventListener('resize', fit);
        if (A) A.stopAmbient();
      },
      debug: {
        get tiles() { return tiles; },
        get won() { return !!endedAt; },
        get stuck() { return stuck; },
        findPair: function () { return findPair(tiles); },
        freeIds: function () { return freeTiles(tiles).map(function (t) { return t.id; }); },
      },
    };
  }

  return {
    meta: { id: 'mahjong', title: 'Mahjong', desc: 'Trova le coppie di tessere uguali. Musica calma.' },
    mount: mount,
    makeLayout: makeLayout,
    turtleSlots: turtleSlots,
    isFree: isFree,
    freeTiles: freeTiles,
    findPair: findPair,
    reshuffle: reshuffle,
    takeApart: takeApart,
    faceSvg: faceSvg,
  };
});
