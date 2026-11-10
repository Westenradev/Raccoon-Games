// Mahjong solitaire in an old Chinese tea-house mood, with soft ambient sound.
// 36 tile kinds (4 animals x 9 Chinese numerals), 4 copies each: 144 tiles.
// A deal is made by taking a full pyramid apart two free tiles at a time, so it can always be solved.
(function (name, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else (window.RA = window.RA || { modules: {} }).modules[name] = api;
})('mahjong', function () {
  const isNode = typeof require === 'function';
  const U = isNode ? require('../core/util.js') : window.RA.modules.util;
  const A = isNode ? null : window.RA.audio;

  const ANIMALS = ['🦝', '🐭', '🐱', '🐕'];
  const NUMERALS = ['一', '二', '三', '四', '五', '六', '七', '八', '九'];

  // Pyramid. Each layer is a rectangle of cells. Layer n sits on layer n - 1.
  const LAYERS = [
    { x0: 0, x1: 11, y0: 0, y1: 5 }, // 72 tiles
    { x0: 1, x1: 10, y0: 1, y1: 4 }, // 40
    { x0: 3, x1: 8, y0: 1, y1: 4 }, // 24
    { x0: 4, x1: 7, y0: 2, y1: 3 }, // 8
  ];

  function allSlots() {
    const out = [];
    LAYERS.forEach(function (L, l) {
      for (let y = L.y0; y <= L.y1; y++) {
        for (let x = L.x0; x <= L.x1; x++) out.push({ x: x, y: y, l: l });
      }
    });
    return out;
  }

  const key = function (s) { return s.x + ',' + s.y + ',' + s.l; };

  // A tile is free when nothing sits on it and its left or right side is open.
  function isFree(s, present) {
    if (present.has(s.x + ',' + s.y + ',' + (s.l + 1))) return false;
    return !present.has((s.x - 1) + ',' + s.y + ',' + s.l) || !present.has((s.x + 1) + ',' + s.y + ',' + s.l);
  }

  // Takes the given slots apart, two random free slots at a time.
  // Returns the pairs in removal order, or null when the random choices reach a dead end.
  function takeApart(slots, rnd) {
    const remaining = slots.slice();
    const present = new Set(remaining.map(key));
    const pairs = [];
    while (remaining.length) {
      const free = remaining.filter(function (s) { return isFree(s, present); });
      if (free.length < 2) return null;
      const a = free.splice(Math.floor(rnd() * free.length), 1)[0];
      const b = free[Math.floor(rnd() * free.length)];
      [a, b].forEach(function (s) {
        present.delete(key(s));
        remaining.splice(remaining.indexOf(s), 1);
      });
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

  // Full deal. Each tile: { id, x, y, l, type }.
  function makeLayout(rnd) {
    const pairs = solvablePairs(allSlots(), rnd);
    if (!pairs) throw new Error('layout failed');
    const types = [];
    for (let t = 0; t < 36; t++) types.push(t, t);
    U.shuffle(types, rnd);
    const tiles = [];
    pairs.forEach(function (p, k) {
      p.forEach(function (s) { tiles.push({ id: tiles.length, x: s.x, y: s.y, l: s.l, type: types[k] }); });
    });
    return tiles;
  }

  function freeTiles(tiles) {
    const present = new Set(tiles.map(key));
    return tiles.filter(function (t) { return isFree(t, present); });
  }

  function findPair(tiles) {
    const free = freeTiles(tiles);
    const seen = {};
    for (const t of free) {
      if (seen[t.type]) return [seen[t.type], t];
      seen[t.type] = t;
    }
    return null;
  }

  // Gives the remaining tiles new kinds, so that the board can be cleared again.
  // Returns false when the shape itself cannot be cleared (for example two stacked tiles).
  function reshuffle(tiles, rnd) {
    const pairs = solvablePairs(tiles, rnd, 200);
    if (!pairs) return false;
    const counts = {};
    tiles.forEach(function (t) { counts[t.type] = (counts[t.type] || 0) + 1; });
    const types = [];
    Object.keys(counts).forEach(function (t) {
      for (let i = 0; i < counts[t] / 2; i++) types.push(Number(t));
    });
    U.shuffle(types, rnd);
    pairs.forEach(function (p, k) {
      p[0].type = types[k];
      p[1].type = types[k];
    });
    return true;
  }

  // ---------- Browser interface ----------
  const TW = 58; // tile width
  const TH = 74; // tile height
  const LX = -6; // shift of each higher layer
  const LY = -7;
  const PAD = 26;
  const BOARD_W = 12 * TW + PAD * 2;
  const BOARD_H = 6 * TH + PAD * 2;

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
    const root = U.el('div', { class: 'mahjong game-panel' });
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
        note = 'Non ci sono più coppie libere. Premi Mescola 🔀 oppure Annulla ↩.';
        if (A) A.sfx.bad();
      }
      render();
    }

    function pick(tile) {
      if (!alive || endedAt) return;
      if (freeTiles(tiles).indexOf(tile) < 0) {
        note = 'Questa tessera è bloccata. Serve un lato libero e niente sopra.';
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
      tiles = tiles.filter(function (t) { return t !== selected && t !== tile; });
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
      note = 'Guarda le due tessere con il bordo verde.';
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
      const availW = wrap.clientWidth;
      const availH = Math.max(260, window.innerHeight - 290);
      const scale = Math.min(1.25, availW / BOARD_W, availH / BOARD_H);
      board.style.transform = 'scale(' + scale + ')';
      wrap.style.height = Math.ceil(BOARD_H * scale) + 'px';
    }

    function render() {
      if (!alive) return;
      root.innerHTML = '';
      root.appendChild(U.el('div', { class: 'mj-title' }, '🏮 ', U.el('span', { text: '麻將 · Mahjong dei Procioni' }), ' 🏮'));
      root.appendChild(U.el('div', { class: 'pill-row' },
        U.el('div', { class: 'pill', text: 'Coppie rimaste: ' + tiles.length / 2 }),
        U.el('div', { class: 'pill', text: 'Punti: ' + score }),
        U.el('div', { class: 'pill' }, '⏱ ', U.el('span', { class: 'clock', text: elapsed() }))));

      const board = U.el('div', { class: 'mj-board', style: 'width:' + BOARD_W + 'px;height:' + BOARD_H + 'px' });
      const free = new Set(freeTiles(tiles));
      tiles.slice().sort(function (a, b) { return a.l - b.l || a.y - b.y || a.x - b.x; }).forEach(function (t) {
        const cls = ['mj-tile', 'a' + Math.floor(t.type / 9)];
        cls.push(free.has(t) ? 'free' : 'blocked');
        if (selected === t) cls.push('sel');
        if (hintPair && hintPair.indexOf(t) >= 0) cls.push('hint');
        board.appendChild(U.el('div', {
          class: cls.join(' '),
          'data-id': t.id,
          style: 'left:' + (PAD + t.x * TW + t.l * LX) + 'px;top:' + (PAD + t.y * TH + t.l * LY) + 'px;z-index:' + (t.l * 100 + t.y * 12 + t.x),
          onclick: function () { pick(t); },
        }, U.el('span', { class: 'face', text: ANIMALS[Math.floor(t.type / 9)] }), U.el('span', { class: 'num', text: NUMERALS[t.type % 9] })));
      });
      root.appendChild(U.el('div', { class: 'mj-wrap' }, board));

      root.appendChild(U.el('div', { class: 'msg', text: note || 'Tocca due tessere uguali e libere. Una tessera è libera se non ha niente sopra e ha un lato aperto.' }));
      root.appendChild(U.el('div', { class: 'actions' },
        U.el('button', { class: 'btn', text: 'Suggerimento 💡', onclick: hint }),
        U.el('button', { class: 'btn', text: 'Annulla ↩', onclick: undo }),
        U.el('button', { class: 'btn' + (stuck ? ' pulse' : ''), text: 'Mescola 🔀', onclick: shuffleTiles }),
        U.el('button', { class: 'btn ghost', text: 'Nuova partita', onclick: newGame })));

      if (endedAt) {
        root.appendChild(U.el('div', { class: 'overlay' }, U.el('div', { class: 'card-box' },
          U.el('h2', { text: 'Tavolo pulito! 🦝🏮' }),
          U.el('p', { text: 'Punti: ' + score + ' · Tempo: ' + elapsed() }),
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
    meta: { id: 'mahjong', title: 'Mahjong', icon: '🀄', desc: 'Trova le coppie di tessere uguali. Musica calma in stile cinese.' },
    mount: mount,
    makeLayout: makeLayout,
    freeTiles: freeTiles,
    findPair: findPair,
    reshuffle: reshuffle,
    takeApart: takeApart,
    allSlots: allSlots,
    LAYERS: LAYERS,
  };
});
