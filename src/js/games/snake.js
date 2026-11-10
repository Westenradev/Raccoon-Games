// Snake Procione. The raccoon head eats fish. Walls and your own body end the game.
(function (name, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else (window.RA = window.RA || { modules: {} }).modules[name] = api;
})('snake', function () {
  const isNode = typeof require === 'function';
  const U = isNode ? require('../core/util.js') : window.RA.modules.util;
  const AR = isNode ? require('../core/arcade.js') : window.RA.modules.arcade;
  const A = isNode ? null : window.RA.audio;

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

  // One movement step. Returns 'ate', 'moved', or 'dead'.
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
      }
      return 'ate';
    }
    state.snake.pop();
    return 'moved';
  }

  // Seconds between steps. Gets faster with more fish.
  function stepTime(state) {
    return Math.max(0.05, 0.14 - state.eaten * 0.004);
  }

  // ---------- Browser interface ----------
  function mount(container, ctx) {
    const CELL = 28;
    const wrap = U.el('div', { class: 'arcade-stage' });
    container.appendChild(wrap);
    const view = AR.createCanvas(wrap, COLS * CELL, ROWS * CELL, 'snake');
    const g = view.ctx;
    const hiKey = 'snake';
    let hi = U.store.get(hiKey, 0);
    let state = newGame(1);
    let started = false;
    let acc = 0;
    let loop = null;
    let unbind = null;

    function draw() {
      g.fillStyle = '#17321f';
      g.fillRect(0, 0, view.canvas.width, view.canvas.height);
      for (let y = 0; y < ROWS; y++) {
        for (let x = 0; x < COLS; x++) {
          g.fillStyle = (x + y) % 2 ? '#1d3d27' : '#214730';
          g.fillRect(x * CELL, y * CELL, CELL, CELL);
        }
      }
      if (state.food) AR.emoji(g, '🐟', state.food.x * CELL + CELL / 2, state.food.y * CELL + CELL / 2, CELL - 4);
      state.snake.forEach(function (p, i) {
        const cx = p.x * CELL + CELL / 2;
        const cy = p.y * CELL + CELL / 2;
        if (i === 0) {
          AR.emoji(g, '🦝', cx, cy, CELL + 2);
        } else {
          g.fillStyle = i % 2 ? '#84cc16' : '#65a30d';
          g.beginPath();
          g.arc(cx, cy, CELL / 2 - 2, 0, Math.PI * 2);
          g.fill();
        }
      });
      AR.text(g, 'Punti: ' + state.score + '   Migliore: ' + Math.max(hi, state.score), 10, 12, 14, '#fef3c7', 'left');
    }

    function update(dt) {
      if (!started || !state.alive) return;
      acc += dt;
      const every = stepTime(state);
      while (acc >= every && state.alive) {
        acc -= every;
        const r = stepSnake(state);
        if (A && r === 'ate') A.sfx.eat();
        if (r === 'dead') {
          if (A) A.sfx.hit();
          return endRun();
        }
      }
    }

    function endRun() {
      started = false;
      if (state.score > hi) {
        hi = state.score;
        U.store.set(hiKey, hi);
      }
      AR.overlay(wrap,
        state.won ? 'Hai vinto! 🦝🏆' : 'Oh no! 🦝',
        'Punti: ' + state.score + ' · Pesci: ' + state.eaten + ' · Migliore: ' + hi,
        'Gioca ancora', newRun);
    }

    function newRun() {
      state = newGame(Math.floor(Math.random() * 1e9));
      started = true;
      acc = 0;
      loop = loop || AR.startLoop(update, draw);
    }

    function onKey(k, down) {
      if (!down) return;
      const map = { arrowup: 'up', w: 'up', arrowdown: 'down', s: 'down', arrowleft: 'left', a: 'left', arrowright: 'right', d: 'right' };
      if (map[k] && started) turn(state, map[k]);
    }

    unbind = AR.bindKeys(onKey);
    draw();
    AR.overlay(wrap, 'Snake Procione 🦝', 'Frecce o WASD per girare. Mangia i pesci. Non sbattere contro il muro o contro te stesso.', 'Inizia', newRun);
    return {
      destroy: function () {
        if (loop) loop.stop();
        if (unbind) unbind();
      },
    };
  }

  return {
    meta: { id: 'snake', title: 'Snake', icon: '🐍', desc: 'Il procione mangia pesci. Più pesci, più veloce.' },
    mount: mount,
    newGame: newGame,
    stepSnake: stepSnake,
    turn: turn,
    COLS: COLS,
    ROWS: ROWS,
  };
});
