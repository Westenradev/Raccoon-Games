// Tetris Procioni. 10 x 20 board. Each piece has an animal symbol.
(function (name, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else (window.RA = window.RA || { modules: {} }).modules[name] = api;
})('tetris', function () {
  const isNode = typeof require === 'function';
  const U = isNode ? require('../core/util.js') : window.RA.modules.util;
  const AR = isNode ? require('../core/arcade.js') : window.RA.modules.arcade;
  const A = isNode ? null : window.RA.audio;

  const W = 10;
  const H = 20;

  // Base shapes. Index = piece type.
  const BASE = [
    { name: 'I', emoji: '🦝', color: '#f59e0b', m: [[0, 0, 0, 0], [1, 1, 1, 1], [0, 0, 0, 0], [0, 0, 0, 0]] },
    { name: 'O', emoji: '🧀', color: '#facc15', m: [[1, 1], [1, 1]] },
    { name: 'T', emoji: '🐱', color: '#a78bfa', m: [[0, 1, 0], [1, 1, 1], [0, 0, 0]] },
    { name: 'S', emoji: '🐟', color: '#34d399', m: [[0, 1, 1], [1, 1, 0], [0, 0, 0]] },
    { name: 'Z', emoji: '🐭', color: '#f472b6', m: [[1, 1, 0], [0, 1, 1], [0, 0, 0]] },
    { name: 'J', emoji: '🐕', color: '#60a5fa', m: [[1, 0, 0], [1, 1, 1], [0, 0, 0]] },
    { name: 'L', emoji: '🦴', color: '#fb923c', m: [[0, 0, 1], [1, 1, 1], [0, 0, 0]] },
  ];

  // Rotations precomputed for each type. ROT[type][rot] = matrix of 1 and 0.
  function rotateMatrix(m) {
    const n = m.length;
    const out = [];
    for (let r = 0; r < n; r++) {
      out.push([]);
      for (let c = 0; c < n; c++) out[r].push(m[n - 1 - c][r]);
    }
    return out;
  }
  const ROT = BASE.map(function (p) {
    const list = [p.m];
    for (let i = 1; i < 4; i++) list.push(rotateMatrix(list[i - 1]));
    return list;
  });

  // Cells of a piece as [{x, y}] relative to piece origin.
  function cells(type, rot, x, y) {
    const m = ROT[type][rot];
    const out = [];
    for (let r = 0; r < m.length; r++) {
      for (let c = 0; c < m[r].length; c++) {
        if (m[r][c]) out.push({ x: x + c, y: y + r });
      }
    }
    return out;
  }

  function emptyBoard() {
    const b = [];
    for (let y = 0; y < H; y++) b.push(new Array(W).fill(null));
    return b;
  }

  function collides(board, type, rot, x, y) {
    return cells(type, rot, x, y).some(function (p) {
      if (p.x < 0 || p.x >= W || p.y >= H) return true;
      if (p.y < 0) return false;
      return board[p.y][p.x] !== null;
    });
  }

  function nextBag(state) {
    if (state.bag.length === 0) state.bag = U.shuffle([0, 1, 2, 3, 4, 5, 6], state.rnd);
    return state.bag.pop();
  }

  function newGame(seed) {
    const rnd = U.makeRng(seed);
    const state = {
      rnd: rnd,
      board: emptyBoard(),
      bag: [],
      cur: null,
      next: 0,
      score: 0,
      lines: 0,
      level: 1,
      over: false,
      gravity: 0,
      cleared: 0,
    };
    state.next = nextBag(state);
    spawn(state);
    return state;
  }

  function spawn(state) {
    const type = state.next;
    state.next = nextBag(state);
    state.cur = { type: type, rot: 0, x: 3, y: 0 };
    if (collides(state.board, type, 0, 3, 0)) {
      state.over = true;
      state.cur = null;
    }
  }

  // Try moving by dx. Returns true if moved.
  function move(state, dx) {
    if (state.over || !state.cur) return false;
    const c = state.cur;
    if (collides(state.board, c.type, c.rot, c.x + dx, c.y)) return false;
    c.x += dx;
    return true;
  }

  // Rotate clockwise with simple wall kicks.
  function rotate(state) {
    if (state.over || !state.cur) return false;
    const c = state.cur;
    const nr = (c.rot + 1) % 4;
    const kicks = [0, -1, 1, -2, 2];
    for (const k of kicks) {
      if (!collides(state.board, c.type, nr, c.x + k, c.y)) {
        c.rot = nr;
        c.x += k;
        return true;
      }
    }
    return false;
  }

  function lockPiece(state) {
    const c = state.cur;
    cells(c.type, c.rot, c.x, c.y).forEach(function (p) {
      if (p.y >= 0) state.board[p.y][p.x] = c.type;
    });
    // Clear full rows.
    let cleared = 0;
    for (let y = H - 1; y >= 0; y--) {
      if (state.board[y].every(function (v) { return v !== null; })) {
        state.board.splice(y, 1);
        state.board.unshift(new Array(W).fill(null));
        cleared += 1;
        y += 1; // check same index again
      }
    }
    if (cleared) {
      const table = [0, 100, 300, 500, 800];
      state.score += table[cleared] * state.level;
      state.lines += cleared;
      state.cleared = cleared;
      state.level = Math.floor(state.lines / 10) + 1;
    } else {
      state.cleared = 0;
    }
    state.cur = null;
    spawn(state);
    return cleared;
  }

  // Moves piece down one row. Returns 'moved' or 'locked'.
  function stepDown(state) {
    if (state.over || !state.cur) return 'none';
    const c = state.cur;
    if (!collides(state.board, c.type, c.rot, c.x, c.y + 1)) {
      c.y += 1;
      return 'moved';
    }
    lockPiece(state);
    return 'locked';
  }

  function softDrop(state) {
    const r = stepDown(state);
    if (r === 'moved') state.score += 1;
    return r;
  }

  function hardDrop(state) {
    if (state.over || !state.cur) return 0;
    let dist = 0;
    while (!collides(state.board, state.cur.type, state.cur.rot, state.cur.x, state.cur.y + 1)) {
      state.cur.y += 1;
      dist += 1;
    }
    state.score += dist * 2;
    lockPiece(state);
    return dist;
  }

  function gravityInterval(level) {
    return Math.max(0.05, 0.8 - (level - 1) * 0.07);
  }

  // Advances gravity by dt seconds.
  function tick(state, dt) {
    if (state.over) return;
    state.gravity += dt;
    const every = gravityInterval(state.level);
    while (state.gravity >= every && !state.over) {
      state.gravity -= every;
      stepDown(state);
    }
  }

  // Ghost row for display.
  function ghostY(state) {
    const c = state.cur;
    if (!c) return 0;
    let y = c.y;
    while (!collides(state.board, c.type, c.rot, c.x, y + 1)) y += 1;
    return y;
  }

  // ---------- Browser interface ----------
  function mount(container, ctx) {
    const CELL = 30;
    const SIDE = 150;
    const canvasWrap = U.el('div', { class: 'arcade-stage' });
    container.appendChild(canvasWrap);
    const { canvas, ctx: g } = AR.createCanvas(canvasWrap, W * CELL + SIDE, H * CELL, 'tetris');
    const hiKey = 'tetris';
    let hi = U.store.get(hiKey, 0);
    let state = null;
    let started = false;
    let paused = false;
    let loop = null;
    let unbind = null;
    let dasLeft = 0;
    let dasRight = 0;
    let dasDown = 0;
    const cleanup = [];

    function draw() {
      g.fillStyle = '#1b1035';
      g.fillRect(0, 0, canvas.width, canvas.height);
      // Board grid.
      for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
          g.fillStyle = (x + y) % 2 ? '#241547' : '#20123f';
          g.fillRect(x * CELL, y * CELL, CELL, CELL);
          const v = state.board[y][x];
          if (v !== null) drawBlock(x, y, v, 1);
        }
      }
      if (state.cur && !state.over) {
        const gy = ghostY(state);
        cells(state.cur.type, state.cur.rot, state.cur.x, gy).forEach(function (p) {
          if (p.y >= 0) {
            g.strokeStyle = 'rgba(255,255,255,0.35)';
            g.strokeRect(p.x * CELL + 3, p.y * CELL + 3, CELL - 6, CELL - 6);
          }
        });
        cells(state.cur.type, state.cur.rot, state.cur.x, state.cur.y).forEach(function (p) {
          if (p.y >= 0) drawBlock(p.x, p.y, state.cur.type, 1);
        });
      }
      // Side panel.
      const sx = W * CELL + 12;
      AR.text(g, 'NEXT', sx + 50, 24, 16, '#fde68a');
      const nb = BASE[state.next];
      ROT[state.next][0].forEach(function (row, r) {
        row.forEach(function (v, c) {
          if (v) AR.emoji(g, nb.emoji, sx + 40 + c * 22 + 11, 60 + r * 22 + 11, 20);
        });
      });
      AR.text(g, 'PUNTI', sx + 50, 170, 16, '#fde68a');
      AR.text(g, String(state.score), sx + 50, 196, 22, '#fff');
      AR.text(g, 'MIGLIORE', sx + 50, 236, 14, '#fde68a');
      AR.text(g, String(Math.max(hi, state.score)), sx + 50, 258, 18, '#fff');
      AR.text(g, 'LIVELLO', sx + 50, 298, 14, '#fde68a');
      AR.text(g, String(state.level), sx + 50, 320, 20, '#fff');
      AR.text(g, 'RIGHE', sx + 50, 350, 14, '#fde68a');
      AR.text(g, String(state.lines), sx + 50, 372, 20, '#fff');
      if (paused) {
        g.fillStyle = 'rgba(0,0,0,0.6)';
        g.fillRect(0, 0, canvas.width, canvas.height);
        AR.text(g, 'PAUSA', canvas.width / 2, canvas.height / 2, 40, '#fff');
      }
    }

    function drawBlock(x, y, type, alpha) {
      g.globalAlpha = alpha;
      g.fillStyle = BASE[type].color;
      g.fillRect(x * CELL + 1, y * CELL + 1, CELL - 2, CELL - 2);
      g.globalAlpha = 1;
      AR.emoji(g, BASE[type].emoji, x * CELL + CELL / 2, y * CELL + CELL / 2 + 1, 20);
    }

    function action(a) {
      if (!started || state.over || paused) return;
      if (a === 'left') move(state, -1);
      if (a === 'right') move(state, 1);
      if (a === 'rotate') { if (rotate(state) && A) A.sfx.click(); }
      if (a === 'down') softDrop(state);
      if (a === 'drop') {
        hardDrop(state);
        if (A) A.sfx.place();
      }
      if (state.cleared && A) { A.sfx.clear(); state.cleared = 0; }
      if (state.over) gameOver();
    }

    function gameOver() {
      started = false;
      if (state.score > hi) {
        hi = state.score;
        U.store.set(hiKey, hi);
      }
      if (A) A.sfx.lose();
      AR.overlay(canvasWrap, 'Game over 🦝', 'Punti: ' + state.score + ' · Righe: ' + state.lines + ' · Migliore: ' + hi, 'Gioca ancora', newRun);
    }

    function newRun() {
      state = newGame(Math.floor(Math.random() * 1e9));
      started = true;
      paused = false;
      dasLeft = dasRight = dasDown = 0;
      loop = loop || AR.startLoop(update, draw);
    }

    function update(dt) {
      if (!started || paused || state.over) return;
      // Held keys auto-repeat.
      const inp = AR.dirInput();
      const repeatEvery = 0.09;
      if (inp.left) { dasLeft -= dt; if (dasLeft <= 0) { move(state, -1); dasLeft = repeatEvery; } } else dasLeft = 0;
      if (inp.right) { dasRight -= dt; if (dasRight <= 0) { move(state, 1); dasRight = repeatEvery; } } else dasRight = 0;
      if (inp.down) { dasDown -= dt; if (dasDown <= 0) { softDrop(state); dasDown = 0.05; } } else dasDown = 0;
      tick(state, dt);
      if (state.over) gameOver();
    }

    function onKey(k, isDownNow) {
      if (!isDownNow) return;
      if (k === 'p') { paused = !paused; return; }
      if (k === 'arrowup' || k === 'w' || k === 'x') action('rotate');
      if (k === ' ') action('drop');
      // First press moves once now. Held keys repeat in update() after a short delay.
      if (k === 'arrowleft') { action('left'); dasLeft = 0.2; }
      if (k === 'arrowright') { action('right'); dasRight = 0.2; }
      if (k === 'arrowdown') { action('down'); dasDown = 0.2; }
    }

    unbind = AR.bindKeys(onKey);
    state = newGame(1);
    draw();
    AR.overlay(canvasWrap, 'Tetris Procioni 🦝', 'Frecce: muovi e ruota con ↑. Spazio: caduta. P: pausa.', 'Inizia', newRun);

    return {
      destroy: function () {
        if (loop) loop.stop();
        if (unbind) unbind();
        cleanup.forEach(function (f) { f(); });
      },
    };
  }

  return {
    meta: { id: 'tetris', title: 'Tetris', icon: '🧱', desc: 'Incastra i blocchi con i simboli degli animali.' },
    mount: mount,
    newGame: newGame,
    move: move,
    rotate: rotate,
    softDrop: softDrop,
    hardDrop: hardDrop,
    tick: tick,
    collides: collides,
    cells: cells,
    W: W,
    H: H,
  };
});
