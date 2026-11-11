// Snake in a garden. The hedge around the field and your own body end the game.
(function (name, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else (window.RA = window.RA || { modules: {} }).modules[name] = api;
})('snake', function () {
  const isNode = typeof require === 'function';
  const U = isNode ? require('../core/util.js') : window.RA.modules.util;
  const AR = isNode ? require('../core/arcade.js') : window.RA.modules.arcade;
  const A = isNode ? null : window.RA.audio;
  const SV = isNode ? null : window.RA.modules.saves;

  const COLS = 24;
  const ROWS = 18;
  const DIRS = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] };
  const OPP = { up: 'down', down: 'up', left: 'right', right: 'left' };

  function placeFood(state) {
    const taken = new Set(state.snake.map((p) => p.x + ',' + p.y));
    const free = [];
    for (let y = 0; y < ROWS; y++) {
      for (let x = 0; x < COLS; x++) if (!taken.has(x + ',' + y)) free.push({ x: x, y: y });
    }
    if (!free.length) return null;
    return free[Math.floor(state.rnd() * free.length)];
  }

  function newGame(seed) {
    const rnd = U.makeRng(seed);
    const mid = Math.floor(ROWS / 2);
    const state = {
      rnd: rnd,
      snake: [{ x: 5, y: mid }, { x: 4, y: mid }, { x: 3, y: mid }],
      dir: 'right',
      queue: [],
      food: null,
      score: 0,
      eaten: 0,
      alive: true,
      won: false,
    };
    state.food = placeFood(state);
    return state;
  }

  // Queue a turn. Ignores a reverse direction and keeps at most 2 pending turns.
  function turn(state, d) {
    const last = state.queue.length ? state.queue[state.queue.length - 1] : state.dir;
    if (d === last || d === OPP[last]) return;
    if (state.queue.length < 2) state.queue.push(d);
  }

  // One movement step. Returns 'ate', 'moved', or 'dead' (game finished: crash, or field full with state.won).
  function stepSnake(state) {
    if (!state.alive) return 'dead';
    if (state.queue.length) state.dir = state.queue.shift();
    const [dx, dy] = DIRS[state.dir];
    const head = state.snake[0];
    const nx = head.x + dx;
    const ny = head.y + dy;
    if (nx < 0 || ny < 0 || nx >= COLS || ny >= ROWS) {
      state.alive = false;
      return 'dead';
    }
    const eating = state.food && nx === state.food.x && ny === state.food.y;
    // The tail moves away this step, unless we eat.
    const body = eating ? state.snake : state.snake.slice(0, -1);
    if (body.some((p) => p.x === nx && p.y === ny)) {
      state.alive = false;
      return 'dead';
    }
    state.snake.unshift({ x: nx, y: ny });
    if (eating) {
      state.score += 10 * (1 + Math.floor(state.eaten / 5));
      state.eaten += 1;
      state.food = placeFood(state);
      if (!state.food) {
        state.won = true;
        state.alive = false;
        return 'dead';
      }
      return 'ate';
    }
    state.snake.pop();
    return 'moved';
  }

  // Seconds between steps. It gets a little faster with each bite, down to 0.09 s.
  function stepTime(state) {
    return Math.max(0.09, 0.15 - state.eaten * 0.003);
  }

  // ---------- Browser interface ----------
  // A garden: grass in two greens, a blue snake that glides from cell to cell, fruit to eat.
  const CELL = 30;
  const HUD = 50;
  const FRAME = 12;
  const VIEW_W = COLS * CELL + FRAME * 2;
  const VIEW_H = ROWS * CELL + HUD + FRAME;
  const GRASS = ['#a9d95c', '#9fd051'];
  const HEDGE = '#3f6b25';
  const BODY = '#3f6fe8';
  const BODY_DARK = '#2748a8';
  const STRIPE = '#7fd4ff';
  const FRUITS = ['apple', 'lemon', 'cherry', 'plum'];
  const FRUIT_COLOR = { apple: '#e53935', lemon: '#fdd835', cherry: '#d81b60', plum: '#8e24aa' };

  // Decoration of the field: [cell x, cell y, kind]. Kinds 0-2 are flowers, 3 is a tuft of grass.
  const FLOWERS = [];
  (function () {
    const rnd = U.makeRng(20240611);
    for (let i = 0; i < 34; i++) {
      FLOWERS.push({ x: Math.floor(rnd() * COLS), y: Math.floor(rnd() * ROWS), kind: i % 4, dx: (rnd() - 0.5) * 12, dy: (rnd() - 0.5) * 12 });
    }
  })();

  const centre = function (c) { return { x: FRAME + c.x * CELL + CELL / 2, y: HUD + c.y * CELL + CELL / 2 }; };
  const mix = function (a, b, t) { return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }; };

  function paintFruit(g, kind, x, y, size) {
    const r = size / 2;
    g.fillStyle = 'rgba(0,0,0,0.18)';
    g.beginPath();
    g.ellipse(x + 2, y + r - 1, r * 0.8, r * 0.3, 0, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = FRUIT_COLOR[kind];
    g.beginPath();
    if (kind === 'apple') {
      g.arc(x - r * 0.32, y + 1, r * 0.72, 0, Math.PI * 2);
      g.arc(x + r * 0.32, y + 1, r * 0.72, 0, Math.PI * 2);
    } else if (kind === 'lemon') {
      g.ellipse(x, y + 1, r, r * 0.74, -0.3, 0, Math.PI * 2);
    } else if (kind === 'cherry') {
      g.arc(x - r * 0.45, y + r * 0.35, r * 0.52, 0, Math.PI * 2);
      g.arc(x + r * 0.45, y + r * 0.2, r * 0.52, 0, Math.PI * 2);
    } else {
      g.ellipse(x, y + 1, r * 0.8, r * 0.95, 0.2, 0, Math.PI * 2);
    }
    g.fill();
    // Stalk and leaf.
    g.strokeStyle = '#6d4c1e';
    g.lineWidth = 2.5;
    g.lineCap = 'round';
    g.beginPath();
    g.moveTo(x, y - r * 0.45);
    g.quadraticCurveTo(x + 1, y - r, x + r * 0.3, y - r * 1.1);
    g.stroke();
    g.fillStyle = '#43a047';
    g.beginPath();
    g.ellipse(x + r * 0.55, y - r * 0.85, r * 0.42, r * 0.2, -0.5, 0, Math.PI * 2);
    g.fill();
    // Shine.
    g.fillStyle = 'rgba(255,255,255,0.7)';
    g.beginPath();
    g.ellipse(x - r * 0.42, y - r * 0.2, r * 0.2, r * 0.12, -0.6, 0, Math.PI * 2);
    g.fill();
  }

  // view (optional): { prev, t, clock, sparks, pops, shake, deadFor }
  // prev = cells of the snake before the last step, t = 0..1 progress of the glide to the new cells.
  function paint(g, state, hi, view) {
    const v = view || {};
    const clock = v.clock || 0;
    g.fillStyle = HEDGE;
    g.fillRect(0, 0, VIEW_W, VIEW_H);
    g.save();
    if (v.shake > 0) g.translate(Math.sin(clock * 90) * v.shake * 7, Math.cos(clock * 70) * v.shake * 5);
    for (let y = 0; y < ROWS; y++) {
      for (let x = 0; x < COLS; x++) {
        g.fillStyle = GRASS[(x + y) % 2];
        g.fillRect(FRAME + x * CELL, HUD + y * CELL, CELL, CELL);
      }
    }
    // Small flowers and tufts of darker grass, always in the same places.
    FLOWERS.forEach(function (f) {
      const fx = FRAME + f.x * CELL + CELL / 2 + f.dx;
      const fy = HUD + f.y * CELL + CELL / 2 + f.dy;
      if (f.kind === 3) {
        g.fillStyle = 'rgba(60,120,30,0.5)';
        g.fillRect(fx - 5, fy, 2.5, 7); g.fillRect(fx - 1, fy - 3, 2.5, 10); g.fillRect(fx + 3, fy + 1, 2.5, 6);
        return;
      }
      g.fillStyle = ['#ffffff', '#ffd1ec', '#fff3a8'][f.kind];
      for (let i = 0; i < 5; i++) {
        const a = (i / 5) * Math.PI * 2 + f.x;
        g.beginPath();
        g.arc(fx + Math.cos(a) * 3.6, fy + Math.sin(a) * 3.6, 2.6, 0, Math.PI * 2);
        g.fill();
      }
      g.fillStyle = '#f6a21c';
      g.beginPath();
      g.arc(fx, fy, 2.2, 0, Math.PI * 2);
      g.fill();
    });
    // Soft shade along the hedge.
    g.fillStyle = 'rgba(0,0,0,0.12)';
    g.fillRect(FRAME, HUD, COLS * CELL, 5);
    g.fillRect(FRAME, HUD, 5, ROWS * CELL);

    if (state.food) {
      const f = centre(state.food);
      paintFruit(g, FRUITS[state.eaten % FRUITS.length], f.x, f.y + Math.sin(clock * 4) * 1.5, CELL * 0.82 + Math.sin(clock * 6) * 1.5);
    }

    // The line of the body: from the gliding head, through the cells, to the gliding tail.
    const cells = state.snake;
    const prev = v.prev && v.prev.length ? v.prev : cells;
    const t = v.t == null ? 1 : Math.max(0, Math.min(1, v.t));
    const pts = cells.map(centre);
    pts[0] = mix(centre(prev[0]), pts[0], t);
    const last = pts.length - 1;
    if (prev.length === cells.length) pts[last] = mix(centre(prev[prev.length - 1]), pts[last], t);
    const dead = !state.alive && !state.won;
    const flash = dead && Math.floor(clock * 10) % 2 === 0 && (v.deadFor || 0) < 0.9;
    // Points every few pixels along the body, from the head to the tail.
    const dots = [];
    let run = 0;
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i];
      const b = pts[i + 1];
      const len = Math.hypot(b.x - a.x, b.y - a.y);
      for (let d = 0; d < len; d += 4) {
        const k = len ? d / len : 0;
        dots.push({ x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k, at: run + d });
      }
      run += len;
    }
    dots.push({ x: pts[last].x, y: pts[last].y, at: run });
    const R = CELL * 0.4;
    // The body gets thinner over the last cells, down to the tip of the tail.
    const radius = function (dot) { return R * Math.min(1, 0.3 + (run - dot.at) / (CELL * 2.6)); };
    const pass = function (draw) {
      for (let i = dots.length - 1; i >= 0; i--) draw(dots[i], radius(dots[i]));
    };
    const disc = function (x, y, r) {
      g.beginPath();
      g.arc(x, y, r, 0, Math.PI * 2);
      g.fill();
    };
    // Shadow on the grass, dark edge, then stripes that travel with the snake.
    g.fillStyle = 'rgba(0,0,0,0.2)';
    pass(function (dot, r) { disc(dot.x + 3, dot.y + 5, r + 2); });
    g.fillStyle = flash ? '#fff' : (dead ? '#59648a' : BODY_DARK);
    pass(function (dot, r) { disc(dot.x, dot.y, r + 2.5); });
    pass(function (dot, r) {
      const band = Math.floor(dot.at / 15) % 2;
      g.fillStyle = flash ? '#ffd0d0' : dead ? (band ? '#8f9bbf' : '#7d8bb0') : (band ? BODY : STRIPE);
      disc(dot.x, dot.y, r);
    });
    // A line of light along the back makes the body look round.
    g.fillStyle = 'rgba(255,255,255,0.28)';
    pass(function (dot, r) { disc(dot.x - r * 0.3, dot.y - r * 0.32, r * 0.34); });

    // Head: a little larger than the body and longer in the direction of travel.
    const h = pts[0];
    const d = DIRS[state.dir];
    const turnAngle = Math.atan2(d[1], d[0]);
    g.fillStyle = flash ? '#fff' : (dead ? '#59648a' : BODY_DARK);
    g.beginPath();
    g.ellipse(h.x + d[0] * 3, h.y + d[1] * 3, CELL * 0.6, CELL * 0.5, turnAngle, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = dead ? '#7d8bb0' : BODY;
    g.beginPath();
    g.ellipse(h.x + d[0] * 3, h.y + d[1] * 3, CELL * 0.6 - 2.5, CELL * 0.5 - 2.5, turnAngle, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = 'rgba(255,255,255,0.25)';
    g.beginPath();
    g.ellipse(h.x + d[0] * 3 - 3, h.y + d[1] * 3 - 4, CELL * 0.3, CELL * 0.16, turnAngle, 0, Math.PI * 2);
    g.fill();
    if (!dead && Math.floor(clock * 2.2) % 3 === 0) {
      // The tongue comes out now and then.
      g.strokeStyle = '#e53935';
      g.lineWidth = 2.5;
      g.lineCap = 'round';
      g.beginPath();
      const tx = h.x + d[0] * CELL * 0.66;
      const ty = h.y + d[1] * CELL * 0.66;
      g.moveTo(tx, ty);
      g.lineTo(tx + d[0] * 7, ty + d[1] * 7);
      g.lineTo(tx + d[0] * 12 + d[1] * 4, ty + d[1] * 12 + d[0] * 4);
      g.moveTo(tx + d[0] * 7, ty + d[1] * 7);
      g.lineTo(tx + d[0] * 12 - d[1] * 4, ty + d[1] * 12 - d[0] * 4);
      g.stroke();
    }
    // Eyes, on the two sides of the head, looking ahead.
    [-1, 1].forEach(function (side) {
      const ex = h.x + d[0] * 7 + d[1] * side * 7.5;
      const ey = h.y + d[1] * 7 + d[0] * side * 7.5;
      if (dead) {
        g.strokeStyle = '#1b1b1b';
        g.lineWidth = 2.5;
        g.beginPath();
        g.moveTo(ex - 3.5, ey - 3.5); g.lineTo(ex + 3.5, ey + 3.5);
        g.moveTo(ex + 3.5, ey - 3.5); g.lineTo(ex - 3.5, ey + 3.5);
        g.stroke();
        return;
      }
      g.fillStyle = '#fff';
      disc(ex, ey, 5.6);
      g.fillStyle = '#111';
      disc(ex + d[0] * 2.2, ey + d[1] * 2.2, 2.9);
      g.fillStyle = '#fff';
      disc(ex + d[0] * 1.2 - 1, ey + d[1] * 1.2 - 1.2, 1);
    });

    (v.sparks || []).forEach(function (p) {
      g.globalAlpha = Math.max(0, p.life * 2);
      g.fillStyle = p.color;
      g.fillRect(p.x - 3, p.y - 3, 6, 6);
    });
    g.globalAlpha = 1;
    (v.pops || []).forEach(function (p) {
      g.globalAlpha = Math.max(0, Math.min(1, p.life * 2));
      AR.pixelText(g, p.text, p.x, p.y, 12, '#fff');
    });
    g.globalAlpha = 1;
    g.restore();

    // Top bar: fruit eaten, points, record.
    g.fillStyle = '#2f5219';
    g.fillRect(0, 0, VIEW_W, HUD - 8);
    paintFruit(g, 'apple', 26, 21, 24);
    AR.pixelText(g, 'x ' + state.eaten, 46, 22, 14, '#fff', 'left');
    AR.pixelText(g, 'PUNTI ' + state.score, VIEW_W / 2, 22, 14, '#fff');
    AR.pixelText(g, 'RECORD ' + Math.max(hi, state.score), VIEW_W - 14, 22, 12, '#ffe082', 'right');
  }

  function thumb(el) {
    const s = newGame(5);
    s.snake = [];
    [[11, 6], [10, 6], [9, 6], [8, 6], [7, 6], [7, 7], [7, 8], [8, 8], [9, 8], [10, 8], [10, 9], [10, 10], [9, 10]].forEach(function (c) { s.snake.push({ x: c[0], y: c[1] }); });
    s.food = { x: 14, y: 6 };
    s.score = 120;
    s.eaten = 10;
    AR.thumb(el, 480, 350, function (g) {
      g.save();
      g.translate(-110, -90);
      paint(g, s, 0, { clock: 0.1 });
      g.restore();
    });
  }

  // What is kept of a game that the player leaves.
  function pack(state) {
    return { snake: state.snake, dir: state.dir, queue: state.queue, food: state.food, score: state.score, eaten: state.eaten };
  }

  function mount(container) {
    const wrap = U.el('div', { class: 'arcade-stage' });
    container.appendChild(wrap);
    const view = AR.createCanvas(wrap, VIEW_W, VIEW_H, 'snake');
    const g = view.ctx;
    const best = AR.record('snake');
    let state = newGame(1);
    let started = false;
    let waiting = true; // a saved game may still be waiting for "resume or new"
    let acc = 0;
    const fx = { prev: null, t: 1, clock: 0, sparks: [], pops: [], shake: 0, deadFor: 0 };

    function draw() {
      fx.t = started && state.alive ? acc / stepTime(state) : 1;
      paint(g, state, best.get(), fx);
    }

    function frame(dt) {
      fx.clock += dt;
      fx.shake = Math.max(0, fx.shake - dt * 2.2);
      if (!state.alive) fx.deadFor += dt;
      fx.sparks.forEach(function (p) {
        p.life -= dt;
        p.vy += 500 * dt;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
      });
      fx.sparks = fx.sparks.filter(function (p) { return p.life > 0; });
      fx.pops.forEach(function (p) {
        p.life -= dt;
        p.y -= 30 * dt;
      });
      fx.pops = fx.pops.filter(function (p) { return p.life > 0; });
      if (!started || !state.alive) return;
      acc += dt;
      while (acc >= stepTime(state) && state.alive) {
        acc -= stepTime(state);
        fx.prev = state.snake.map(function (c) { return { x: c.x, y: c.y }; });
        const fruit = FRUITS[state.eaten % FRUITS.length];
        const before = state.score;
        const r = stepSnake(state);
        if (r === 'ate' || (r === 'dead' && state.won)) {
          if (A) A.sfx.eat();
          const at = centre(state.snake[0]);
          for (let i = 0; i < 12; i++) {
            fx.sparks.push({ x: at.x, y: at.y, vx: (Math.random() - 0.5) * 260, vy: -Math.random() * 220, life: 0.5, color: i % 3 ? FRUIT_COLOR[fruit] : '#fff' });
          }
          fx.pops.push({ x: at.x, y: at.y - 30, text: '+' + (state.score - before), life: 0.9 });
        }
        best.submit(state.score);
        if (r === 'dead') {
          fx.prev = null;
          if (!state.won) fx.shake = 1;
          if (A) state.won ? A.sfx.win() : A.sfx.hit();
          endRun();
        }
      }
    }

    function endRun() {
      started = false;
      const hi = best.get();
      AR.overlay(wrap,
        state.won ? 'CAMPO PIENO!' : 'PARTITA FINITA',
        'Punti: ' + state.score + '. Frutti: ' + state.eaten + '. Record: ' + hi + '.',
        'GIOCA ANCORA', newRun);
    }

    function begin(next) {
      state = next;
      waiting = false;
      started = true;
      acc = 0;
      fx.prev = null;
      fx.sparks = [];
      fx.pops = [];
      fx.shake = 0;
      fx.deadFor = 0;
    }

    function newRun() {
      begin(newGame(Math.floor(Math.random() * 1e9)));
    }

    function persist() {
      if (waiting) return;
      if (started && state.alive) SV.save('snake', pack(state));
      else SV.clear('snake');
    }

    const KEY_DIR = { arrowup: 'up', w: 'up', arrowdown: 'down', s: 'down', arrowleft: 'left', a: 'left', arrowright: 'right', d: 'right' };
    const unbind = AR.bindKeys(function (k, down) {
      if (down && KEY_DIR[k] && started && !loop.isPaused()) turn(state, KEY_DIR[k]);
    });
    const loop = AR.startLoop(frame, draw, { view: view, active: function () { return started && state.alive; } });
    AR.help(wrap, 'Usa le quattro frecce per girare. P: pausa.');
    AR.startCard(wrap, {
      id: 'snake',
      title: 'SNAKE',
      body: 'Mangia la frutta: il serpente si allunga. Non toccare la siepe e non toccare la coda.',
      summary: function (saved) { return 'Punti: ' + saved.score + '. Frutti: ' + saved.eaten + '.'; },
      onResume: function (saved) {
        begin(Object.assign(newGame(Math.floor(Math.random() * 1e9)), saved));
        loop.getReady(1.5);
      },
      onNew: newRun,
    });
    return {
      destroy: function () {
        best.submit(state.score);
        persist();
        loop.stop();
        unbind();
      },
      save: persist,
      debug: {
        get state() { return state; },
        get started() { return started; },
      },
    };
  }

  return {
    meta: { id: 'snake', title: 'Snake', desc: 'Mangia la frutta e non morderti la coda.' },
    mount: mount,
    thumb: thumb,
    newGame: newGame,
    stepSnake: stepSnake,
    turn: turn,
    COLS: COLS,
    ROWS: ROWS,
  };
});
