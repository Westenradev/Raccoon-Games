// Mahjong solitaire (Ancient China mood, soft ambient sound).
// Tile types: 4 animals x 9 Chinese numerals = 36 types, 4 copies each (144 tiles).
// Layouts are built in reverse, so every generated layout can be cleared.
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

  // Pyramid. Each layer is a rectangle of cells {x0..x1, y0..y1}. Layer n sits on layer n-1.
  const LAYERS = [
    { x0: 0, x1: 11, y0: 1, y1: 6 }, // 72
    { x0: 1, x1: 10, y0: 2, y1: 5 }, // 40
    { x0: 3, x1: 8, y0: 2, y1: 5 }, // 24
    { x0: 4, x1: 7, y0: 3, y1: 4 }, // 8
  ];

  function allSlots() {
    const out = [];
    LAYERS.forEach((L, l) => {
      for (let y = L.y0; y <= L.y1; y++) {
        for (let x = L.x0; x <= L.x1; x++) out.push({ x: x, y: y, l: l });
      }
    });
    return out;
  }

  const key = (s) => s.x + ',' + s.y + ',' + s.l;

  // A tile is free when nothing sits on it and one side is open.
  function isFree(s, present) {
    if (present.has(s.x + ',' + s.y + ',' + (s.l + 1))) return false;
    const left = present.has((s.x - 1) + ',' + s.y + ',' + s.l);
    const right = present.has((s.x + 1) + ',' + s.y + ',' + s.l);
    return !left || !right;
  }

  // Builds pairs of slots in an order that can be removed one pair at a time.
  // Returns an array of [slotA, slotB] in reverse order (last pair is removed first).
  // Each row grows outward from a random centre. That order keeps every tile free
  // when it is added. Pairs are taken from consecutive tiles, then checked again.
  // Pairs in each row are mirror images around the middle of the row:
  // (middle-1-k, middle+k). Adding them from the centre outward keeps every tile free.
  // The order is checked once more, so a wrong layout cannot pass silently.
  function buildPairs() {
    const pairs = [];
    LAYERS.forEach((L, l) => {
      const n = L.x1 - L.x0 + 1;
      const h = n / 2;
      for (let y = L.y0; y <= L.y1; y++) {
        for (let k = 0; k < h; k++) {
          pairs.push([
            { x: L.x0 + h - 1 - k, y: y, l: l },
            { x: L.x0 + h + k, y: y, l: l },
          ]);
        }
      }
    });
    const present = new Set();
    for (const [a, b] of pairs) {
      present.add(key(a));
      present.add(key(b));
      if (!isFree(a, present) || !isFree(b, present)) return null;
    }
    return pairs;
  }

  // Full layout with tile types. Each tile: { id, x, y, l, type }.
  function makeLayout(rnd) {
    const pairs = buildPairs(rnd);
    if (!pairs) throw new Error('layout failed');
    const types = [];
    for (let t = 0; t < 36; t++) types.push(t, t);
    U.shuffle(types, rnd);
    const tiles = [];
    pairs.forEach((p, k) => {
      p.forEach((s) => tiles.push({ id: tiles.length, x: s.x, y: s.y, l: s.l, type: types[k] }));
    });
    return tiles;
  }

  function tileLabel(type) {
    const animal = ANIMALS[Math.floor(type / 9)];
    const numeral = NUMERALS[type % 9];
    return { animal: animal, numeral: numeral };
  }

  function freeTiles(tiles) {
    const present = new Set(tiles.map((t) => t.x + ',' + t.y + ',' + t.l));
    return tiles.filter((t) => isFree(t, present));
  }

  function findPair(tiles) {
    const free = freeTiles(tiles);
    for (let i = 0; i < free.length; i++) {
      for (let j = i + 1; j < free.length; j++) {
        if (free[i].type === free[j].type) return [free[i], free[j]];
      }
    }
    return null;
  }

  // ---------- Browser interface ----------
  function mount(container, ctx) {
    let alive = true;
    let rnd = U.makeRng();
    let tiles = [];
    let removed = [];
    let history = [];
    let selected = null;
    let pairsLeft = 72;
    let startedAt = Date.now();
    let score = 0;
    const root = U.el('div', { class: 'mahjong game-panel' });
    container.appendChild(root);
    if (A) A.startAmbient();

    function newGame() {
      tiles = makeLayout(rnd);
      history = [];
      selected = null;
      pairsLeft = 72;
      score = 0;
      startedAt = Date.now();
      render();
    }

    function present(tile) {
      return tiles.indexOf(tile) >= 0;
    }

    function tryPick(tile) {
      if (!alive) return;
      const free = freeTiles(tiles);
      if (free.indexOf(tile) < 0) {
        if (A) A.sfx.bad();
        return;
      }
      if (!selected) {
        selected = tile;
        if (A) A.sfx.click();
        return render();
      }
      if (selected === tile) {
        selected = null;
        return render();
      }
      if (selected.type === tile.type) {
        const pair = [selected, tile];
        history.push(pair.slice());
        tiles = tiles.filter((t) => t !== selected && t !== tile);
        pairsLeft -= 1;
        score += 10;
        selected = null;
        if (A) A.sfx.pop();
        if (tiles.length === 0) {
          if (A) A.sfx.win();
          return render(true);
        }
        render();
        if (!findPair(tiles)) {
          if (A) A.sfx.bad();
          render();
        }
        return;
      }
      if (A) A.sfx.bad();
      selected = tile;
      render();
    }

    function undo() {
      const pair = history.pop();
      if (!pair) return;
      pair.forEach((t) => tiles.push(t));
      pairsLeft += 1;
      score = Math.max(0, score - 10);
      selected = null;
      render();
    }

    function hint() {
      const pair = findPair(tiles);
      if (!pair) return render(false, 'Nessuna coppia libera. Premi Mescola.');
      selected = null;
      render(false, 'Suggerimento: guarda le due tessere evidenziate.', pair);
    }

    function shuffleTiles() {
      // Shuffle types among remaining tiles. Try a few times to find a free pair.
      const types = tiles.map((t) => t.type);
      for (let k = 0; k < 200; k++) {
        U.shuffle(types, rnd);
        tiles.forEach((t, i) => { t.type = types[i]; });
        if (findPair(tiles)) break;
      }
      selected = null;
      render(false, 'Tessere mescolate.');
    }

    function render(won, note, hintPair) {
      if (!alive) return;
      root.innerHTML = '';
      const info = U.el('div', { class: 'mj-top' },
        U.el('span', { text: 'Coppie rimaste: ' + pairsLeft + ' · Punti: ' + score }),
        U.el('span', { text: 'Tempo: ' + Math.floor((Date.now() - startedAt) / 1000) + ' s' }));
      root.appendChild(info);
      const board = U.el('div', { class: 'mj-board' });
      const free = new Set(freeTiles(tiles));
      const hintSet = new Set(hintPair || []);
      tiles.slice().sort((a, b) => a.l - b.l || a.y - b.y || a.x - b.x).forEach((t) => {
        const lab = tileLabel(t.type);
        const cls = ['mj-tile'];
        if (free.has(t)) cls.push('free');
        if (selected === t) cls.push('sel');
        if (hintSet.has(t)) cls.push('hint');
        const node = U.el('div', {
          class: cls.join(' '),
          style: 'left:' + (t.x * 46 + t.l * 4) + 'px;top:' + (t.y * 52 - t.l * 5) + 'px;z-index:' + (t.l * 10 + t.y),
          onclick: won ? null : function () { tryPick(t); },
        }, U.el('div', { class: 'face', text: lab.animal }), U.el('div', { class: 'num', text: lab.numeral }));
        board.appendChild(node);
      });
      root.appendChild(board);
      if (won) {
        const secs = Math.floor((Date.now() - startedAt) / 1000);
        root.appendChild(U.el('div', { class: 'overlay' }, U.el('div', { class: 'card-box' },
          U.el('h2', { text: 'Bravo! 🦝 Tutto ripulito' }),
          U.el('p', { text: 'Punti: ' + score + ' · Tempo: ' + secs + ' s' }),
          U.el('button', { class: 'btn big', text: 'Nuova partita', onclick: newGame }))));
      }
      root.appendChild(U.el('div', { class: 'msg', text: note || 'Scegli due tessere libere uguali. Le tessere libere hanno il bordo luminoso.' }));
      root.appendChild(U.el('div', { class: 'actions' },
        U.el('button', { class: 'btn', text: 'Suggerimento 💡', onclick: hint }),
        U.el('button', { class: 'btn', text: 'Annulla ↩', onclick: undo }),
        U.el('button', { class: 'btn', text: 'Mescola 🔀', onclick: shuffleTiles }),
        U.el('button', { class: 'btn ghost', text: 'Nuova', onclick: newGame })));
    }

    newGame();
    return {
      destroy: function () {
        alive = false;
        if (A) A.stopAmbient();
      },
    };
  }

  return {
    meta: { id: 'mahjong', title: 'Mahjong', icon: '🀄', desc: 'Trova le coppie di tessere uguali. Suoni rilassanti.' },
    mount: mount,
    makeLayout: makeLayout,
    freeTiles: freeTiles,
    findPair: findPair,
    buildPairs: buildPairs,
    LAYERS: LAYERS,
  };
});
