// Bolle (bubble shooter). Three or more bubbles of the same colour pop.
// Bubbles that lose their link to the ceiling fall. Every few shots a new row comes down.
// Clear every bubble to reach the next level.
(function (name, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else (window.RA = window.RA || { modules: {} }).modules[name] = api;
})('bubbles', function () {
  const isNode = typeof require === 'function';
  const U = isNode ? require('../core/util.js') : window.RA.modules.util;
  const AR = isNode ? require('../core/arcade.js') : window.RA.modules.arcade;
  const A = isNode ? null : window.RA.audio;

  const R = 18; // bubble radius
  const WIDTH = 360;
  const HEIGHT = 610;
  const TOP = 36; // height of the score bar
  const ROW_H = 31;
  const SHOOT_X = WIDTH / 2;
  const SHOOT_Y = 548;
  const DANGER_Y = 470; // a bubble centre at or under this line ends the game
  const SPEED = 760;
  const SHOTS_PER_ROW = 6;
  const MAX_ANGLE = 1.35;
  // Six colours. Each one also has its own mark, so they can be told apart without colour.
  const COLORS = ['#e53935', '#fdd835', '#43a047', '#1e88e5', '#8e24aa', '#fb8c00'];
  const DARK = ['#8e1512', '#b59400', '#1f6b24', '#0d4c93', '#501064', '#a85a00'];
  const KINDS = COLORS;

  // Row ids are absolute. Even rows hold 10 bubbles, odd rows hold 9 and are shifted.
  const isEven = function (rid) { return ((rid % 2) + 2) % 2 === 0; };
  const colsIn = function (rid) { return isEven(rid) ? 10 : 9; };
  const key = function (rid, c) { return rid + ',' + c; };
  const unkey = function (k) { return k.split(',').map(Number); };

  function posOf(rid, c, base) {
    return { x: (isEven(rid) ? R : 2 * R) + c * 2 * R, y: TOP + R + (rid - base) * ROW_H };
  }

  // Cells that touch (rid, c), inside the field and not above the ceiling row.
  function neighbours(rid, c, base) {
    const out = [[rid, c - 1], [rid, c + 1]];
    if (isEven(rid)) out.push([rid - 1, c - 1], [rid - 1, c], [rid + 1, c - 1], [rid + 1, c]);
    else out.push([rid - 1, c], [rid - 1, c + 1], [rid + 1, c], [rid + 1, c + 1]);
    return out.filter(function (p) { return p[0] >= base && p[1] >= 0 && p[1] < colsIn(p[0]); });
  }

  function kindsFor(level) {
    return Math.min(KINDS.length, 3 + level);
  }

  function newGame(seed, level, score) {
    const rnd = U.makeRng(seed);
    const lv = level || 1;
    const kinds = kindsFor(lv);
    const grid = new Map();
    const rows = Math.min(8, 4 + lv);
    for (let rid = 0; rid < rows; rid++) {
      for (let c = 0; c < colsIn(rid); c++) grid.set(key(rid, c), Math.floor(rnd() * kinds));
    }
    const state = {
      rnd: rnd,
      level: lv,
      kinds: kinds,
      grid: grid,
      base: 0, // row id of the ceiling row
      angle: 0,
      moving: null,
      cur: 0,
      next: 0,
      shots: 0,
      rowsLeft: 4 + lv * 2,
      score: score || 0,
      over: false,
      won: false,
      events: [],
      gone: [], // bubbles removed by the last shot, for the animation
    };
    state.cur = pickKind(state);
    state.next = pickKind(state);
    return state;
  }

  // A random kind that is still on the board, so that every shot can be useful.
  function pickKind(state) {
    const present = [];
    state.grid.forEach(function (kind) { if (present.indexOf(kind) < 0) present.push(kind); });
    if (!present.length) return Math.floor(state.rnd() * state.kinds);
    return present[Math.floor(state.rnd() * present.length)];
  }

  // Removes the group of same-kind bubbles around (rid, c) when it has 3 or more.
  function popGroup(state, rid, c) {
    const kind = state.grid.get(key(rid, c));
    const seen = new Set([key(rid, c)]);
    const stack = [[rid, c]];
    while (stack.length) {
      const cell = stack.pop();
      neighbours(cell[0], cell[1], state.base).forEach(function (n) {
        const k = key(n[0], n[1]);
        if (!seen.has(k) && state.grid.get(k) === kind) {
          seen.add(k);
          stack.push(n);
        }
      });
    }
    if (seen.size < 3) return 0;
    seen.forEach(function (k) {
      const cell = unkey(k);
      const p = posOf(cell[0], cell[1], state.base);
      state.gone.push({ x: p.x, y: p.y, kind: kind, fall: false });
      state.grid.delete(k);
    });
    return seen.size;
  }

  // Removes the bubbles that are not linked to the ceiling row. Returns how many.
  function dropFloating(state) {
    const seen = new Set();
    const stack = [];
    state.grid.forEach(function (v, k) {
      const cell = unkey(k);
      if (cell[0] === state.base) {
        seen.add(k);
        stack.push(cell);
      }
    });
    while (stack.length) {
      const cell = stack.pop();
      neighbours(cell[0], cell[1], state.base).forEach(function (n) {
        const k = key(n[0], n[1]);
        if (!seen.has(k) && state.grid.has(k)) {
          seen.add(k);
          stack.push(n);
        }
      });
    }
    const loose = [];
    state.grid.forEach(function (v, k) { if (!seen.has(k)) loose.push(k); });
    loose.forEach(function (k) {
      const cell = unkey(k);
      const p = posOf(cell[0], cell[1], state.base);
      state.gone.push({ x: p.x, y: p.y, kind: state.grid.get(k), fall: true });
      state.grid.delete(k);
    });
    return loose.length;
  }

  // Puts the flying bubble in the free cell nearest to (x, y).
  function settle(state, x, y, kind) {
    let best = null;
    let bestD = Infinity;
    const consider = function (rid, c) {
      if (state.grid.has(key(rid, c))) return;
      const p = posOf(rid, c, state.base);
      const d = (p.x - x) * (p.x - x) + (p.y - y) * (p.y - y);
      if (d < bestD) {
        bestD = d;
        best = [rid, c];
      }
    };
    for (let c = 0; c < colsIn(state.base); c++) consider(state.base, c);
    state.grid.forEach(function (v, k) {
      const cell = unkey(k);
      neighbours(cell[0], cell[1], state.base).forEach(function (n) { consider(n[0], n[1]); });
    });
    if (!best) return { popped: 0, dropped: 0 };
    state.grid.set(key(best[0], best[1]), kind);
    const popped = popGroup(state, best[0], best[1]);
    const dropped = popped ? dropFloating(state) : 0;
    if (popped) state.score += popped * 10 + dropped * 20;
    return { popped: popped, dropped: dropped };
  }

  function touchesBubble(state, x, y) {
    const limit = (2 * R - 3) * (2 * R - 3);
    for (const k of state.grid.keys()) {
      const cell = unkey(k);
      const p = posOf(cell[0], cell[1], state.base);
      if ((p.x - x) * (p.x - x) + (p.y - y) * (p.y - y) < limit) return true;
    }
    return false;
  }

  function lowestY(state) {
    let low = 0;
    state.grid.forEach(function (v, k) {
      const cell = unkey(k);
      low = Math.max(low, posOf(cell[0], cell[1], state.base).y);
    });
    return low;
  }

  function fire(state) {
    if (state.over || state.moving) return false;
    state.moving = { x: SHOOT_X, y: SHOOT_Y, vx: Math.sin(state.angle) * SPEED, vy: -Math.cos(state.angle) * SPEED, kind: state.cur };
    state.cur = state.next;
    state.next = pickKind(state);
    state.events.push('shoot');
    return true;
  }

  // The flying bubble landed: place it, add a new row when due, then check win and loss.
  function land(state, m) {
    state.moving = null;
    const res = settle(state, m.x, m.y, m.kind);
    state.events.push(res.popped ? 'pop' : 'land');
    state.shots += 1;
    if (state.grid.size === 0) {
      state.won = true;
      state.over = true;
      return;
    }
    if (state.rowsLeft > 0 && state.shots % SHOTS_PER_ROW === 0) {
      state.base -= 1;
      state.rowsLeft -= 1;
      for (let c = 0; c < colsIn(state.base); c++) state.grid.set(key(state.base, c), Math.floor(state.rnd() * state.kinds));
      state.events.push('row');
    }
    if (lowestY(state) >= DANGER_Y) {
      state.over = true;
      return;
    }
    // The waiting bubbles must be kinds that are still on the board.
    const present = new Set(state.grid.values());
    if (!present.has(state.cur)) state.cur = pickKind(state);
    if (!present.has(state.next)) state.next = pickKind(state);
  }

  // Advances the flying bubble by dt seconds.
  function update(state, dt) {
    state.events = [];
    if (state.over || !state.moving) return;
    state.gone = [];
    const steps = 6;
    for (let s = 0; s < steps; s++) {
      const m = state.moving;
      m.x += (m.vx * dt) / steps;
      m.y += (m.vy * dt) / steps;
      if (m.x < R) {
        m.x = R;
        m.vx = Math.abs(m.vx);
      } else if (m.x > WIDTH - R) {
        m.x = WIDTH - R;
        m.vx = -Math.abs(m.vx);
      }
      if (m.y - R <= TOP || touchesBubble(state, m.x, m.y)) {
        land(state, m);
        return;
      }
    }
  }

  // Points of the aim line, with wall bounces, until the first contact.
  function aimPath(state, maxLen) {
    const pts = [];
    let x = SHOOT_X;
    let y = SHOOT_Y;
    let vx = Math.sin(state.angle);
    const vy = -Math.cos(state.angle);
    for (let d = 0; d < maxLen; d += 4) {
      x += vx * 4;
      y += vy * 4;
      if (x < R) { x = R; vx = Math.abs(vx); }
      if (x > WIDTH - R) { x = WIDTH - R; vx = -Math.abs(vx); }
      if (y - R <= TOP || touchesBubble(state, x, y)) break;
      if (d % 20 === 0) pts.push({ x: x, y: y });
    }
    return pts;
  }

  // ---------- Browser interface ----------
  // The mark inside each bubble: disc, triangle, square, diamond, cross, ring.
  function mark(g, x, y, kind) {
    const r = 5.5;
    g.fillStyle = 'rgba(255,255,255,0.8)';
    g.strokeStyle = 'rgba(255,255,255,0.8)';
    g.lineWidth = 2.6;
    g.beginPath();
    if (kind === 0) {
      g.arc(x, y, r - 1, 0, Math.PI * 2);
      g.fill();
    } else if (kind === 1) {
      g.moveTo(x, y - r); g.lineTo(x + r, y + r - 1); g.lineTo(x - r, y + r - 1);
      g.closePath();
      g.fill();
    } else if (kind === 2) {
      g.fillRect(x - r + 1, y - r + 1, r * 2 - 2, r * 2 - 2);
    } else if (kind === 3) {
      g.moveTo(x, y - r - 1); g.lineTo(x + r, y); g.lineTo(x, y + r + 1); g.lineTo(x - r, y);
      g.closePath();
      g.fill();
    } else if (kind === 4) {
      g.moveTo(x - r, y); g.lineTo(x + r, y); g.moveTo(x, y - r); g.lineTo(x, y + r);
      g.stroke();
    } else {
      g.arc(x, y, r - 1, 0, Math.PI * 2);
      g.stroke();
    }
  }

  // A glass ball: dark rim, bright body, a white glint on the top left.
  function paintBubble(g, x, y, kind, alpha) {
    g.globalAlpha = alpha == null ? 1 : alpha;
    const body = g.createRadialGradient(x - 5, y - 6, 2, x, y, R);
    body.addColorStop(0, '#ffffff');
    body.addColorStop(0.28, COLORS[kind]);
    body.addColorStop(1, DARK[kind]);
    g.fillStyle = body;
    g.beginPath();
    g.arc(x, y, R - 1, 0, Math.PI * 2);
    g.fill();
    mark(g, x, y + 2, kind);
    g.fillStyle = 'rgba(255,255,255,0.85)';
    g.beginPath();
    g.ellipse(x - 6, y - 8, 4.5, 2.6, -0.6, 0, Math.PI * 2);
    g.fill();
    g.globalAlpha = 1;
  }

  function paint(g, state, hi, opts) {
    const o = opts || {};
    // Well.
    const bg = g.createLinearGradient(0, TOP, 0, HEIGHT);
    bg.addColorStop(0, '#0a1a3a');
    bg.addColorStop(1, '#05070f');
    g.fillStyle = bg;
    g.fillRect(0, 0, WIDTH, HEIGHT);
    g.fillStyle = 'rgba(255,255,255,0.03)';
    for (let x = 0; x < WIDTH; x += 2 * R) g.fillRect(x, TOP, R, DANGER_Y + R - TOP);
    // Ceiling bar that comes down, and the limit line.
    g.fillStyle = '#5a6a8a';
    g.fillRect(0, TOP - 3, WIDTH, 5);
    g.fillStyle = '#ff3b30';
    for (let x = 0; x < WIDTH; x += 16) g.fillRect(x, DANGER_Y + R, 9, 3);

    state.grid.forEach(function (kind, k) {
      const cell = unkey(k);
      const p = posOf(cell[0], cell[1], state.base);
      paintBubble(g, p.x, p.y, kind);
    });
    (o.particles || []).forEach(function (p) { paintBubble(g, p.x, p.y, p.kind, Math.max(0, p.life)); });

    if (o.aim && !state.moving && !state.over) {
      g.fillStyle = 'rgba(255,255,255,0.8)';
      aimPath(state, 520).forEach(function (p) { g.fillRect(p.x - 2, p.y - 2, 4, 4); });
    }
    // Launcher: a round base with a pointer.
    g.save();
    g.translate(SHOOT_X, SHOOT_Y);
    g.fillStyle = '#2a3550';
    g.beginPath();
    g.arc(0, 10, 30, Math.PI, 0);
    g.fill();
    g.rotate(state.angle);
    g.fillStyle = '#d7dbe6';
    g.fillRect(-3, -46, 6, 30);
    g.beginPath();
    g.moveTo(0, -58); g.lineTo(9, -44); g.lineTo(-9, -44);
    g.closePath();
    g.fill();
    g.restore();
    if (state.moving) paintBubble(g, state.moving.x, state.moving.y, state.moving.kind);
    else paintBubble(g, SHOOT_X, SHOOT_Y, state.cur);
    AR.pixelText(g, 'DOPO', WIDTH - 44, SHOOT_Y - 28, 9, '#9aa0ff');
    paintBubble(g, WIDTH - 44, SHOOT_Y, state.next);
    AR.pixelText(g, 'FILE ' + state.rowsLeft, 10, HEIGHT - 14, 9, '#9aa0ff', 'left');

    // Score bar.
    g.fillStyle = '#000';
    g.fillRect(0, 0, WIDTH, TOP - 3);
    AR.pixelText(g, String(state.score).padStart(5, '0'), 8, TOP / 2 - 1, 12, '#fff', 'left');
    AR.pixelText(g, 'LIV.' + state.level, WIDTH / 2, TOP / 2 - 1, 10, '#ffe600');
    AR.pixelText(g, String(Math.max(hi, state.score)).padStart(5, '0'), WIDTH - 8, TOP / 2 - 1, 12, '#ff4a30', 'right');
  }

  function thumb(el) {
    const s = newGame(9, 3);
    s.angle = -0.45;
    AR.thumb(el, WIDTH, 270, function (g) {
      g.save();
      g.translate(0, -TOP + 4);
      paint(g, s, 0, { aim: true });
      g.restore();
    });
  }

  function mount(container) {
    const wrap = U.el('div', { class: 'arcade-stage' });
    container.appendChild(wrap);
    const view = AR.createCanvas(wrap, WIDTH, HEIGHT, 'bubbles');
    const g = view.ctx;
    let hi = U.store.get('hi.bubbles', 0);
    let state = newGame(1, 1, 0);
    let started = false;
    let particles = [];

    function draw() {
      paint(g, state, hi, { particles: particles, aim: started });
    }

    function frame(dt) {
      particles.forEach(function (p) {
        p.life -= dt * (p.fall ? 1.2 : 3.5);
        if (p.fall) {
          p.vy += 900 * dt;
          p.y += p.vy * dt;
        }
      });
      particles = particles.filter(function (p) { return p.life > 0; });
      if (!started || state.over) return;
      const inp = AR.dirInput();
      if (inp.left) state.angle = Math.max(-MAX_ANGLE, state.angle - 1.3 * dt);
      if (inp.right) state.angle = Math.min(MAX_ANGLE, state.angle + 1.3 * dt);
      update(state, dt);
      state.events.forEach(function (e) {
        if (e === 'pop') {
          state.gone.forEach(function (b) { particles.push({ x: b.x, y: b.y, kind: b.kind, fall: b.fall, vy: 0, life: 1 }); });
          if (A) A.sfx.pop();
        }
        if (e === 'land' && A) A.sfx.place();
        if (e === 'row' && A) A.sfx.tick();
      });
      if (state.over) endRun();
    }

    function endRun() {
      started = false;
      if (state.score > hi) {
        hi = state.score;
        U.store.set('hi.bubbles', hi);
      }
      if (state.won) {
        if (A) A.sfx.win();
        const next = state.level + 1;
        const score = state.score + 100;
        AR.overlay(wrap, 'LIVELLO ' + state.level + ' FINITO', 'Punti: ' + score + ' (100 di premio).', 'LIVELLO ' + next, function () { startLevel(next, score); });
      } else {
        if (A) A.sfx.lose();
        AR.overlay(wrap, 'PARTITA FINITA', 'Le bolle hanno passato la linea rossa. Punti: ' + state.score + '. Record: ' + hi + '.', 'GIOCA ANCORA', function () { startLevel(1, 0); });
      }
    }

    function startLevel(level, score) {
      state = newGame(Math.floor(Math.random() * 1e9), level, score);
      particles = [];
      started = true;
    }

    function shoot() {
      if (started && fire(state) && A) A.sfx.shoot();
    }

    function aimFromEvent(e) {
      const rect = view.canvas.getBoundingClientRect();
      const x = ((e.clientX - rect.left) / rect.width) * WIDTH;
      const y = ((e.clientY - rect.top) / rect.height) * HEIGHT;
      const a = Math.atan2(x - SHOOT_X, Math.max(10, SHOOT_Y - y));
      state.angle = Math.max(-MAX_ANGLE, Math.min(MAX_ANGLE, a));
    }
    view.canvas.addEventListener('mousemove', function (e) { if (started) aimFromEvent(e); });
    view.canvas.addEventListener('mousedown', function (e) {
      if (!started) return;
      aimFromEvent(e);
      shoot();
    });

    const unbind = AR.bindKeys(function (k, down) {
      if (down && (k === ' ' || k === 'arrowup' || k === 'w')) shoot();
    });
    const loop = AR.startLoop(frame, draw);
    AR.help(wrap, 'Mira con il mouse e fai clic per tirare. Oppure: frecce sinistra e destra per mirare, Spazio per tirare.');
    AR.overlay(wrap, 'BOLLE', 'Unisci tre bolle dello stesso colore per farle scoppiare. Non farle scendere sotto la linea rossa.', 'INIZIA', function () { startLevel(1, 0); });
    return {
      destroy: function () {
        loop.stop();
        unbind();
      },
      debug: {
        get state() { return state; },
        get started() { return started; },
      },
    };
  }

  return {
    meta: { id: 'bubbles', title: 'Bolle', desc: 'Tre bolle dello stesso colore scoppiano.' },
    mount: mount,
    thumb: thumb,
    newGame: newGame,
    update: update,
    fire: fire,
    posOf: posOf,
    neighbours: neighbours,
    WIDTH: WIDTH,
    DANGER_Y: DANGER_Y,
    MAX_ANGLE: MAX_ANGLE,
  };
});
