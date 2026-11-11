// Tetris. 10 x 20 well, the seven classic pieces in their standard colours.
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

  // Base shapes with the standard colours: I cyan, O yellow, T purple, S green, Z red, J blue, L orange.
  const BASE = [
    { name: 'I', color: '#00e0e8', m: [[0, 0, 0, 0], [1, 1, 1, 1], [0, 0, 0, 0], [0, 0, 0, 0]] },
    { name: 'O', color: '#f2e400', m: [[1, 1], [1, 1]] },
    { name: 'T', color: '#a020f0', m: [[0, 1, 0], [1, 1, 1], [0, 0, 0]] },
    { name: 'S', color: '#18d818', m: [[0, 1, 1], [1, 1, 0], [0, 0, 0]] },
    { name: 'Z', color: '#f02020', m: [[1, 1, 0], [0, 1, 1], [0, 0, 0]] },
    { name: 'J', color: '#2848f0', m: [[1, 0, 0], [1, 1, 1], [0, 0, 0]] },
    { name: 'L', color: '#f09a00', m: [[0, 0, 1], [1, 1, 1], [0, 0, 0]] },
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
      clearedRows: [],
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
    // Clear full rows. clearedRows keeps where they were, for the flash on screen.
    let cleared = 0;
    state.clearedRows = [];
    for (let y = H - 1; y >= 0; y--) {
      if (state.board[y].every(function (v) { return v !== null; })) {
        state.clearedRows.push(y - cleared);
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
  const CELL = 30;
  const SIDE = 170;
  const VIEW_W = W * CELL + SIDE;
  const VIEW_H = H * CELL;

  // One block with a light edge on the top left and a dark edge on the bottom right.
  function paintBlock(g, px, py, size, color) {
    g.fillStyle = color;
    g.fillRect(px, py, size, size);
    const e = Math.max(2, Math.round(size * 0.13));
    g.fillStyle = 'rgba(255,255,255,0.55)';
    g.fillRect(px, py, size, e);
    g.fillRect(px, py, e, size);
    g.fillStyle = 'rgba(0,0,0,0.38)';
    g.fillRect(px, py + size - e, size, e);
    g.fillRect(px + size - e, py, e, size);
    g.fillStyle = 'rgba(255,255,255,0.16)';
    g.fillRect(px + e * 2, py + e * 2, size - e * 4, size - e * 4);
  }

  function paint(g, state, hi, fx) {
    g.fillStyle = '#000';
    g.fillRect(0, 0, VIEW_W, VIEW_H);
    // Well with a faint grid.
    g.fillStyle = '#07070d';
    g.fillRect(0, 0, W * CELL, VIEW_H);
    g.strokeStyle = 'rgba(255,255,255,0.06)';
    g.lineWidth = 1;
    g.beginPath();
    for (let x = 1; x < W; x++) { g.moveTo(x * CELL + 0.5, 0); g.lineTo(x * CELL + 0.5, VIEW_H); }
    for (let y = 1; y < H; y++) { g.moveTo(0, y * CELL + 0.5); g.lineTo(W * CELL, y * CELL + 0.5); }
    g.stroke();
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        if (state.board[y][x] !== null) paintBlock(g, x * CELL + 1, y * CELL + 1, CELL - 2, BASE[state.board[y][x]].color);
      }
    }
    if (state.cur && !state.over) {
      const c = state.cur;
      g.strokeStyle = '#fff';
      g.globalAlpha = 0.5;
      g.lineWidth = 2;
      cells(c.type, c.rot, c.x, ghostY(state)).forEach(function (p) {
        if (p.y >= 0) g.strokeRect(p.x * CELL + 3, p.y * CELL + 3, CELL - 6, CELL - 6);
      });
      g.globalAlpha = 1;
      cells(c.type, c.rot, c.x, c.y).forEach(function (p) {
        if (p.y >= 0) paintBlock(g, p.x * CELL + 1, p.y * CELL + 1, CELL - 2, BASE[c.type].color);
      });
    }
    // White flash where rows were cleared, and sparks.
    if (fx) {
      fx.flashes.forEach(function (f) {
        g.fillStyle = 'rgba(255,255,255,' + Math.max(0, f.life * 3).toFixed(2) + ')';
        g.fillRect(0, f.row * CELL, W * CELL, CELL);
      });
      fx.sparks.forEach(function (p) {
        g.fillStyle = p.color;
        g.globalAlpha = Math.max(0, p.life * 1.6);
        g.fillRect(p.x, p.y, 4, 4);
      });
      g.globalAlpha = 1;
    }
    // Side panel.
    const sx = W * CELL;
    const mid = sx + SIDE / 2;
    g.fillStyle = '#101018';
    g.fillRect(sx, 0, SIDE, VIEW_H);
    g.fillStyle = '#3a3a4a';
    g.fillRect(sx, 0, 3, VIEW_H);
    AR.pixelText(g, 'PROSSIMO', mid, 30, 12, '#9aa0ff');
    g.fillStyle = '#000';
    g.fillRect(mid - 58, 46, 116, 86);
    const shape = ROT[state.next][0];
    let minR = 9, maxR = -1, minC = 9, maxC = -1;
    shape.forEach(function (row, r) {
      row.forEach(function (v, c) {
        if (!v) return;
        minR = Math.min(minR, r); maxR = Math.max(maxR, r); minC = Math.min(minC, c); maxC = Math.max(maxC, c);
      });
    });
    const bs = 24;
    const ox = mid - ((maxC - minC + 1) * bs) / 2;
    const oy = 89 - ((maxR - minR + 1) * bs) / 2;
    shape.forEach(function (row, r) {
      row.forEach(function (v, c) {
        if (v) paintBlock(g, ox + (c - minC) * bs + 1, oy + (r - minR) * bs + 1, bs - 2, BASE[state.next].color);
      });
    });
    [['PUNTI', state.score], ['RECORD', Math.max(hi, state.score)], ['LIVELLO', state.level], ['RIGHE', state.lines]].forEach(function (row, i) {
      AR.pixelText(g, row[0], mid, 176 + i * 74, 12, '#9aa0ff');
      AR.pixelText(g, String(row[1]), mid, 204 + i * 74, 16, '#fff');
    });
  }

  function thumb(el) {
    const s = newGame(7);
    const rows = ['....JJ....', 'ZZ..JSS.LL', 'IZZTJOSSLT', 'IOOTTOLLTT', 'IOOTSSILLL'];
    const map = { I: 0, O: 1, T: 2, S: 3, Z: 4, J: 5, L: 6 };
    rows.forEach(function (row, i) {
      for (let x = 0; x < W; x++) if (row[x] !== '.') s.board[H - rows.length + i][x] = map[row[x]];
    });
    s.cur = { type: 2, rot: 0, x: 3, y: 9 };
    AR.thumb(el, W * CELL, 330, function (g) {
      g.translate(0, -270);
      paint(g, s, 0, null);
      g.translate(0, 270);
    });
  }

  function mount(container) {
    const wrap = U.el('div', { class: 'arcade-stage' });
    container.appendChild(wrap);
    const view = AR.createCanvas(wrap, VIEW_W, VIEW_H, 'tetris');
    const g = view.ctx;
    const best = AR.record('tetris');
    let state = newGame(1);
    let started = false;
    let lastPiece = null;
    const fx = { flashes: [], sparks: [] };
    // Time until a held key repeats, per direction.
    const hold = { left: 0, right: 0, down: 0 };

    function draw() {
      paint(g, state, best.get(), fx);
    }

    function afterAction() {
      if (state.cleared) {
        if (A) A.sfx.clear();
        state.clearedRows.forEach(function (row) {
          fx.flashes.push({ row: row, life: 0.33 });
          for (let i = 0; i < 14; i++) {
            fx.sparks.push({
              x: Math.random() * W * CELL, y: row * CELL + CELL / 2,
              vx: (Math.random() - 0.5) * 260, vy: -Math.random() * 220,
              life: 0.6, color: BASE[Math.floor(Math.random() * 7)].color,
            });
          }
        });
        state.cleared = 0;
      }
      best.submit(state.score);
      if (state.over) gameOver();
    }

    function gameOver() {
      started = false;
      if (A) A.sfx.lose();
      AR.overlay(wrap, 'PARTITA FINITA', 'Punti: ' + state.score + '. Righe: ' + state.lines + '. Record: ' + best.get() + '.', 'GIOCA ANCORA', newRun);
    }

    function newRun() {
      state = newGame(Math.floor(Math.random() * 1e9));
      started = true;
      fx.flashes = [];
      fx.sparks = [];
      hold.left = hold.right = hold.down = 0;
    }

    function frame(dt) {
      fx.flashes.forEach(function (f) { f.life -= dt; });
      fx.flashes = fx.flashes.filter(function (f) { return f.life > 0; });
      fx.sparks.forEach(function (p) {
        p.life -= dt;
        p.vy += 700 * dt;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
      });
      fx.sparks = fx.sparks.filter(function (p) { return p.life > 0; });
      if (!started || state.over) return;
      const inp = AR.dirInput();
      // A new piece does not fall fast just because the down key is still held from the last one.
      if (state.cur !== lastPiece) {
        lastPiece = state.cur;
        if (inp.down) hold.down = 0.3;
      }
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
      if (!down || !started || state.over || loop.isPaused() || k === 'p') return;
      // The first press acts at once. A held key repeats after a short wait (see frame).
      if (k === 'arrowleft' || k === 'a') { move(state, -1); hold.left = 0.2; }
      else if (k === 'arrowright' || k === 'd') { move(state, 1); hold.right = 0.2; }
      else if (k === 'arrowdown' || k === 's') { softDrop(state); hold.down = 0.2; }
      else if (k === 'arrowup' || k === 'w' || k === 'x') { if (rotate(state) && A) A.sfx.click(); }
      else if (k === ' ') { hardDrop(state); if (A) A.sfx.place(); }
      afterAction();
    });
    const loop = AR.startLoop(frame, draw, { view: view, active: function () { return started && !state.over; } });
    AR.help(wrap, 'Frecce sinistra e destra: muovi. Freccia su: ruota. Freccia giù: scendi. Spazio: lascia cadere. P: pausa.');
    AR.overlay(wrap, 'TETRIS', 'Incastra i pezzi e riempi le righe. Una riga piena sparisce.', 'INIZIA', newRun);

    return {
      destroy: function () {
        best.submit(state.score);
        loop.stop();
        unbind();
      },
      debug: {
        get state() { return state; },
        get started() { return started; },
        get paused() { return loop.isPaused(); },
      },
    };
  }

  return {
    meta: { id: 'tetris', title: 'Tetris', desc: 'Incastra i pezzi e completa le righe.' },
    mount: mount,
    thumb: thumb,
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
