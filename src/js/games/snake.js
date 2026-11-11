// Snake, in the look of the old mobile phones. The border and your own body end the game.
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
  // The look of the Snake on old mobile phones: dark pixels on a green screen.
  const CELL = 30;
  const HUD = 46;
  const FRAME = 10;
  const VIEW_W = COLS * CELL + FRAME * 2;
  const VIEW_H = ROWS * CELL + HUD + FRAME;
  const LCD = '#c7f0d8';
  const LCD_GRID = '#b9e3ca';
  const INK = '#33402f';

  // One cell made of 3 x 3 screen pixels with thin gaps.
  function lcdCell(g, x, y, pattern) {
    const p = CELL / 3;
    for (let r = 0; r < 3; r++) {
      for (let c = 0; c < 3; c++) {
        if (pattern[r][c] === 'X') g.fillRect(x + c * p + 1, y + r * p + 1, p - 2, p - 2);
      }
    }
  }
  const FULL = ['XXX', 'XXX', 'XXX'];
  const FOOD = ['.X.', 'X.X', '.X.'];
  const CRASH = ['X.X', '.X.', 'X.X'];
  const HEAD = { right: ['XX.', 'XXX', 'XX.'], left: ['.XX', 'XXX', '.XX'], up: ['.X.', 'XXX', 'XXX'], down: ['XXX', 'XXX', '.X.'] };

  function paint(g, state, hi) {
    g.fillStyle = LCD;
    g.fillRect(0, 0, VIEW_W, VIEW_H);
    // Faint grid of the screen pixels.
    g.fillStyle = LCD_GRID;
    const p = CELL / 3;
    for (let x = FRAME; x <= VIEW_W - FRAME; x += p) g.fillRect(x - 0.5, HUD, 1, ROWS * CELL);
    for (let y = HUD; y <= HUD + ROWS * CELL; y += p) g.fillRect(FRAME, y - 0.5, COLS * CELL, 1);
    g.fillStyle = INK;
    // Border of the field.
    g.fillRect(FRAME - 5, HUD - 5, COLS * CELL + 10, 3);
    g.fillRect(FRAME - 5, HUD + ROWS * CELL + 2, COLS * CELL + 10, 3);
    g.fillRect(FRAME - 5, HUD - 5, 3, ROWS * CELL + 10);
    g.fillRect(FRAME + COLS * CELL + 2, HUD - 5, 3, ROWS * CELL + 10);
    if (state.food) lcdCell(g, FRAME + state.food.x * CELL, HUD + state.food.y * CELL, FOOD);
    state.snake.forEach(function (s, i) {
      // After a crash the head turns into a cross.
      const head = state.alive || state.won ? HEAD[state.dir] : CRASH;
      lcdCell(g, FRAME + s.x * CELL, HUD + s.y * CELL, i === 0 ? head : FULL);
    });
    AR.pixelText(g, String(state.score).padStart(4, '0'), FRAME, HUD / 2 - 2, 18, INK, 'left');
    AR.pixelText(g, 'RECORD ' + String(Math.max(hi, state.score)).padStart(4, '0'), VIEW_W - FRAME, HUD / 2 - 2, 12, INK, 'right');
  }

  function thumb(el) {
    const s = newGame(5);
    s.snake = [];
    [[9, 6], [8, 6], [7, 6], [6, 6], [5, 6], [5, 7], [5, 8], [6, 8], [7, 8], [8, 8]].forEach(function (c) { s.snake.push({ x: c[0], y: c[1] }); });
    s.food = { x: 12, y: 6 };
    s.score = 70;
    AR.thumb(el, 480, 350, function (g) {
      g.save();
      g.translate(-60, -60);
      paint(g, s, 0);
      g.restore();
    });
  }

  function mount(container) {
    const wrap = U.el('div', { class: 'arcade-stage' });
    container.appendChild(wrap);
    const view = AR.createCanvas(wrap, VIEW_W, VIEW_H, 'snake');
    const g = view.ctx;
    const best = AR.record('snake');
    let state = newGame(1);
    let started = false;
    let acc = 0;

    function draw() {
      paint(g, state, best.get());
    }

    function frame(dt) {
      if (!started || !state.alive) return;
      acc += dt;
      while (acc >= stepTime(state) && state.alive) {
        acc -= stepTime(state);
        const r = stepSnake(state);
        if (A && r === 'ate') A.sfx.eat();
        best.submit(state.score);
        if (r === 'dead') {
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
        'Punti: ' + state.score + '. Bocconi: ' + state.eaten + '. Record: ' + hi + '.',
        'GIOCA ANCORA', newRun);
    }

    function newRun() {
      state = newGame(Math.floor(Math.random() * 1e9));
      started = true;
      acc = 0;
    }

    const KEY_DIR = { arrowup: 'up', w: 'up', arrowdown: 'down', s: 'down', arrowleft: 'left', a: 'left', arrowright: 'right', d: 'right' };
    const unbind = AR.bindKeys(function (k, down) {
      if (down && KEY_DIR[k] && started) turn(state, KEY_DIR[k]);
    });
    const loop = AR.startLoop(frame, draw, { view: view, active: function () { return started && state.alive; } });
    AR.help(wrap, 'Usa le quattro frecce per girare. P: pausa.');
    AR.overlay(wrap, 'SNAKE', 'Mangia i bocconi: il serpente si allunga. Non toccare il bordo e non toccare la coda.', 'INIZIA', newRun);
    return {
      destroy: function () {
        best.submit(state.score);
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
    meta: { id: 'snake', title: 'Snake', desc: 'Il serpente dei vecchi telefonini.' },
    mount: mount,
    thumb: thumb,
    newGame: newGame,
    stepSnake: stepSnake,
    turn: turn,
    COLS: COLS,
    ROWS: ROWS,
  };
});
