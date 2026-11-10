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
  function mount(container) {
    const CELL = 30;
    const SIDE = 160;
    const wrap = U.el('div', { class: 'arcade-stage' });
    container.appendChild(wrap);
    const view = AR.createCanvas(wrap, W * CELL + SIDE, H * CELL, 'tetris');
    const g = view.ctx;
    let hi = U.store.get('hi.tetris', 0);
    let state = newGame(1);
    let started = false;
    let paused = false;
    // Time until a held key repeats, per direction.
    const hold = { left: 0, right: 0, down: 0 };

    function drawBlock(x, y, type) {
      g.fillStyle = BASE[type].color;
      g.fillRect(x * CELL + 1, y * CELL + 1, CELL - 2, CELL - 2);
      g.fillStyle = 'rgba(255,255,255,0.25)';
      g.fillRect(x * CELL + 1, y * CELL + 1, CELL - 2, 4);
      AR.emoji(g, BASE[type].emoji, x * CELL + CELL / 2, y * CELL + CELL / 2 + 2, 19);
    }

    function draw() {
      g.fillStyle = '#1b1035';
      g.fillRect(0, 0, view.w, view.h);
      for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
          g.fillStyle = (x + y) % 2 ? '#241547' : '#20123f';
          g.fillRect(x * CELL, y * CELL, CELL, CELL);
          if (state.board[y][x] !== null) drawBlock(x, y, state.board[y][x]);
        }
      }
      if (state.cur && !state.over) {
        const c = state.cur;
        g.strokeStyle = 'rgba(255,255,255,0.4)';
        g.lineWidth = 2;
        cells(c.type, c.rot, c.x, ghostY(state)).forEach(function (p) {
          if (p.y >= 0) g.strokeRect(p.x * CELL + 3, p.y * CELL + 3, CELL - 6, CELL - 6);
        });
        cells(c.type, c.rot, c.x, c.y).forEach(function (p) {
          if (p.y >= 0) drawBlock(p.x, p.y, c.type);
        });
      }
      // Side panel.
      const sx = W * CELL;
      const mid = sx + SIDE / 2;
      g.fillStyle = '#120a26';
      g.fillRect(sx, 0, SIDE, view.h);
      AR.text(g, 'PROSSIMO', mid, 26, 14, '#fde68a');
      const shape = ROT[state.next][0];
      const size = shape.length;
      shape.forEach(function (row, r) {
        row.forEach(function (v, c) {
          if (!v) return;
          const bx = mid - (size * 24) / 2 + c * 24;
          const by = 48 + r * 24;
          g.fillStyle = BASE[state.next].color;
          g.fillRect(bx + 1, by + 1, 22, 22);
          AR.emoji(g, BASE[state.next].emoji, bx + 12, by + 13, 15);
        });
      });
      const rows = [['PUNTI', state.score], ['RECORD', Math.max(hi, state.score)], ['LIVELLO', state.level], ['RIGHE', state.lines]];
      rows.forEach(function (row, i) {
        AR.text(g, row[0], mid, 180 + i * 62, 13, '#fde68a');
        AR.text(g, String(row[1]), mid, 204 + i * 62, 22, '#fff');
      });
      ['← → muovi', '↑ ruota', '↓ giù veloce', 'Spazio: caduta', 'P: pausa'].forEach(function (line, i) {
        AR.text(g, line, mid, 452 + i * 22, 12, '#b9afd9');
      });
      if (paused) {
        g.fillStyle = 'rgba(0,0,0,0.65)';
        g.fillRect(0, 0, view.w, view.h);
        AR.text(g, 'PAUSA', view.w / 2, view.h / 2 - 14, 40, '#fff');
        AR.text(g, 'Premi P per continuare', view.w / 2, view.h / 2 + 26, 16, '#fde68a');
      }
    }

    function afterAction() {
      if (state.cleared) {
        if (A) A.sfx.clear();
        state.cleared = 0;
      }
      if (state.over) gameOver();
    }

    function gameOver() {
      started = false;
      if (state.score > hi) {
        hi = state.score;
        U.store.set('hi.tetris', hi);
      }
      if (A) A.sfx.lose();
      AR.overlay(wrap, 'Partita finita 🦝', 'Punti: ' + state.score + ' · Righe: ' + state.lines + ' · Record: ' + hi, 'Gioca ancora', newRun);
    }

    function newRun() {
      state = newGame(Math.floor(Math.random() * 1e9));
      started = true;
      paused = false;
      hold.left = hold.right = hold.down = 0;
    }

    function frame(dt) {
      if (!started || paused || state.over) return;
      const inp = AR.dirInput();
      ['left', 'right', 'down'].forEach(function (d) {
        if (!inp[d]) {
          hold[d] = 0;
          return;
        }
        hold[d] -= dt;
        if (hold[d] > 0) return;
        if (d === 'left') move(state, -1);
        else if (d === 'right') move(state, 1);
        else softDrop(state);
        hold[d] += d === 'down' ? 0.05 : 0.09;
      });
      tick(state, dt);
      afterAction();
    }

    const unbind = AR.bindKeys(function (k, down) {
      if (!down || !started || state.over) return;
      if (k === 'p') {
        paused = !paused;
        return;
      }
      if (paused) return;
      // The first press acts at once. A held key repeats after a short wait (see frame).
      if (k === 'arrowleft' || k === 'a') { move(state, -1); hold.left = 0.2; }
      else if (k === 'arrowright' || k === 'd') { move(state, 1); hold.right = 0.2; }
      else if (k === 'arrowdown' || k === 's') { softDrop(state); hold.down = 0.2; }
      else if (k === 'arrowup' || k === 'w' || k === 'x') { if (rotate(state) && A) A.sfx.click(); }
      else if (k === ' ') { hardDrop(state); if (A) A.sfx.place(); }
      afterAction();
    });
    const loop = AR.startLoop(frame, draw);
    AR.overlay(wrap, 'Tetris dei Procioni 🦝', 'Frecce ← → per muovere, ↑ per ruotare, ↓ per scendere. Spazio fa cadere il pezzo. P mette in pausa.', 'Inizia', newRun);

    return {
      destroy: function () {
        loop.stop();
        unbind();
      },
      debug: {
        get state() { return state; },
        get started() { return started; },
        get paused() { return paused; },
      },
    };
  }

  return {
    meta: { id: 'tetris', title: 'Tetris', icon: '🧱', desc: 'Incastra i pezzi e completa le righe.' },
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
