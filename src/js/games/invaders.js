// Raccoon Defender (Space Invaders style). The raccoon shoots cats, mice and chihuahuas.
(function (name, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else (window.RA = window.RA || { modules: {} }).modules[name] = api;
})('invaders', function () {
  const isNode = typeof require === 'function';
  const U = isNode ? require('../core/util.js') : window.RA.modules.util;
  const AR = isNode ? require('../core/arcade.js') : window.RA.modules.arcade;
  const A = isNode ? null : window.RA.audio;

  const W = 480;
  const H = 600;
  const COLS = 9;
  const ROWS = 5;
  const INV_W = 30;
  const INV_H = 24;
  const SPACING_X = 40;
  const SPACING_Y = 34;
  const PLAYER_W = 40;
  const PLAYER_Y = H - 46;
  const SHIELD_Y = H - 150;
  const SHIELD_CELL = 8;
  // Row type: 0 = cat (top), 1 = mouse, 2 = chihuahua (bottom).
  const TYPES = [
    { emoji: '🐱', points: 30 },
    { emoji: '🐭', points: 20 },
    { emoji: '🐕', points: 10 },
  ];

  function rowType(row) {
    if (row === 0) return 0;
    if (row < 3) return 1;
    return 2;
  }

  function makeShields() {
    const shields = [];
    for (let s = 0; s < 4; s++) {
      const x0 = 50 + s * 110;
      const cells = [];
      for (let r = 0; r < 4; r++) {
        for (let c = 0; c < 6; c++) {
          // A notch in the middle bottom, like classic shields.
          if (r >= 2 && c >= 2 && c <= 3) continue;
          cells.push({ x: x0 + c * SHIELD_CELL, y: SHIELD_Y + r * SHIELD_CELL, alive: true });
        }
      }
      shields.push(cells);
    }
    return shields;
  }

  function makeInvaders() {
    const list = [];
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        list.push({ col: c, row: r, type: rowType(r), alive: true });
      }
    }
    return list;
  }

  function newGame(seed) {
    return {
      rnd: U.makeRng(seed),
      px: W / 2,
      pBullets: [],
      eBullets: [],
      invaders: makeInvaders(),
      fx: 40,
      fy: 70,
      dir: 1,
      stepAcc: 0,
      fireAcc: 0,
      shields: makeShields(),
      score: 0,
      lives: 3,
      wave: 1,
      invuln: 0,
      over: false,
      cooldown: 0,
      events: [],
    };
  }

  function nextWave(state) {
    state.wave += 1;
    state.score += 100;
    state.invaders = makeInvaders();
    state.fx = 40;
    state.fy = 70;
    state.dir = 1;
    state.pBullets = [];
    state.eBullets = [];
    state.events.push('wave');
  }

  function invaderPos(state, inv) {
    return { x: state.fx + inv.col * SPACING_X, y: state.fy + inv.row * SPACING_Y };
  }

  function aliveCount(state) {
    return state.invaders.filter((i) => i.alive).length;
  }

  // Seconds between formation steps. Fewer invaders means faster steps.
  function stepEvery(state) {
    const total = COLS * ROWS;
    const frac = aliveCount(state) / total;
    return Math.max(0.05, (0.7 - (state.wave - 1) * 0.07) * (0.25 + 0.75 * frac));
  }

  function hitShield(state, x, y, w, h) {
    for (const block of state.shields) {
      for (const cell of block) {
        if (!cell.alive) continue;
        if (x < cell.x + SHIELD_CELL && x + w > cell.x && y < cell.y + SHIELD_CELL && y + h > cell.y) {
          cell.alive = false;
          return true;
        }
      }
    }
    return false;
  }

  // Advance by dt seconds. input = { left, right, fire } booleans.
  function update(state, dt, input) {
    if (state.over) return;
    state.events = [];
    // Player move.
    const speed = 240;
    if (input.left) state.px -= speed * dt;
    if (input.right) state.px += speed * dt;
    state.px = Math.max(PLAYER_W / 2, Math.min(W - PLAYER_W / 2, state.px));
    if (state.cooldown > 0) state.cooldown -= dt;
    if (input.fire && state.cooldown <= 0 && state.pBullets.length < 2) {
      state.pBullets.push({ x: state.px, y: PLAYER_Y - 10 });
      state.cooldown = 0.35;
      state.events.push('shoot');
    }
    if (state.invuln > 0) state.invuln -= dt;

    // Player bullets.
    state.pBullets.forEach((b) => { b.y -= 460 * dt; });
    state.pBullets = state.pBullets.filter((b) => {
      if (b.y < 0) return false;
      if (hitShield(state, b.x - 2, b.y, 4, 12)) return false;
      for (const inv of state.invaders) {
        if (!inv.alive) continue;
        const p = invaderPos(state, inv);
        if (b.x > p.x - INV_W / 2 && b.x < p.x + INV_W / 2 && b.y > p.y - INV_H / 2 && b.y < p.y + INV_H / 2) {
          inv.alive = false;
          state.score += TYPES[inv.type].points;
          state.events.push('kill');
          return false;
        }
      }
      return true;
    });

    // Formation step timer.
    state.stepAcc += dt;
    const every = stepEvery(state);
    while (state.stepAcc >= every) {
      state.stepAcc -= every;
      moveFormation(state);
      if (state.over) return;
    }

    // Enemy fire from the lowest alive invader of a random column.
    state.fireAcc += dt;
    const fireEvery = Math.max(0.35, 1.4 - (state.wave - 1) * 0.12);
    if (state.fireAcc >= fireEvery) {
      state.fireAcc = 0;
      const lowest = {};
      state.invaders.forEach((inv) => {
        if (!inv.alive) return;
        if (!lowest[inv.col] || inv.row > lowest[inv.col].row) lowest[inv.col] = inv;
      });
      const shooters = Object.keys(lowest).map((k) => lowest[k]);
      if (shooters.length) {
        const s = shooters[Math.floor(state.rnd() * shooters.length)];
        const p = invaderPos(state, s);
        state.eBullets.push({ x: p.x, y: p.y + INV_H / 2 });
      }
    }

    // Enemy bullets.
    state.eBullets.forEach((b) => { b.y += (200 + state.wave * 20) * dt; });
    state.eBullets = state.eBullets.filter((b) => {
      if (b.y > H) return false;
      if (hitShield(state, b.x - 2, b.y - 6, 4, 12)) return false;
      if (state.invuln <= 0 && Math.abs(b.x - state.px) < PLAYER_W / 2 && b.y > PLAYER_Y - 14 && b.y < PLAYER_Y + 14) {
        loseLife(state);
        return false;
      }
      return true;
    });

    if (aliveCount(state) === 0) nextWave(state);
  }

  function loseLife(state) {
    state.lives -= 1;
    state.invuln = 1.5;
    state.events.push('hit');
    if (state.lives <= 0) state.over = true;
  }

  function moveFormation(state) {
    const alive = state.invaders.filter((i) => i.alive);
    if (!alive.length) return;
    const minCol = Math.min.apply(null, alive.map((i) => i.col));
    const maxCol = Math.max.apply(null, alive.map((i) => i.col));
    const leftX = state.fx + minCol * SPACING_X - INV_W / 2;
    const rightX = state.fx + maxCol * SPACING_X + INV_W / 2;
    const nextLeft = leftX + state.dir * 12;
    const nextRight = rightX + state.dir * 12;
    if (nextLeft < 6 || nextRight > W - 6) {
      state.dir *= -1;
      state.fy += 16;
    } else {
      state.fx += state.dir * 12;
    }
    state.events.push('step');
    // Invaders reaching the player row end the game.
    const lowestY = Math.max.apply(null, alive.map((i) => state.fy + i.row * SPACING_Y));
    if (lowestY + INV_H / 2 >= PLAYER_Y - 10) {
      state.over = true;
      state.events.push('invaded');
    }
  }

  // ---------- Browser interface ----------
  function mount(container, ctx) {
    const wrap = U.el('div', { class: 'arcade-stage' });
    container.appendChild(wrap);
    const view = AR.createCanvas(wrap, W, H, 'invaders');
    const g = view.ctx;
    const hiKey = 'invaders';
    let hi = U.store.get(hiKey, 0);
    let state = newGame(1);
    let started = false;
    let loop = null;
    let unbind = null;
    let fireHeld = false;

    function draw() {
      g.fillStyle = '#0b1026';
      g.fillRect(0, 0, W, H);
      // Stars.
      g.fillStyle = 'rgba(255,255,255,0.5)';
      for (let i = 0; i < 40; i++) g.fillRect((i * 97) % W, (i * 53) % H, 2, 2);
      state.shields.forEach(function (block) {
        block.forEach(function (c) {
          if (c.alive) {
            g.fillStyle = '#84cc16';
            g.fillRect(c.x, c.y, SHIELD_CELL - 1, SHIELD_CELL - 1);
          }
        });
      });
      state.invaders.forEach(function (inv) {
        if (!inv.alive) return;
        const p = invaderPos(state, inv);
        AR.emoji(g, TYPES[inv.type].emoji, p.x, p.y, 26);
      });
      // Player.
      if (!(state.invuln > 0 && Math.floor(state.invuln * 10) % 2 === 0)) {
        AR.emoji(g, '🦝', state.px, PLAYER_Y, 34);
      }
      g.fillStyle = '#facc15';
      state.pBullets.forEach((b) => g.fillRect(b.x - 2, b.y, 4, 12));
      state.eBullets.forEach((b) => AR.emoji(g, '🦴', b.x, b.y, 14));
      AR.text(g, 'Punti ' + state.score, 8, 14, 14, '#fef3c7', 'left');
      AR.text(g, 'Migliore ' + Math.max(hi, state.score), W / 2, 14, 14, '#fef3c7');
      AR.text(g, 'Vite ' + '🦝'.repeat(Math.max(0, state.lives)), W - 8, 14, 14, '#fef3c7', 'right');
      AR.text(g, 'Ondata ' + state.wave, W / 2, H - 14, 12, '#94a3b8');
    }

    // Called by the loop every frame. Uses the game logic function update(state, dt, input).
    function frame(dt) {
      if (!started || state.over) return;
      const inp = AR.dirInput();
      const input = { left: inp.left, right: inp.right, fire: inp.fire || fireHeld };
      update(state, dt, input);
      state.events.forEach(function (e) {
        if (!A) return;
        if (e === 'shoot') A.sfx.shoot();
        if (e === 'kill') A.sfx.pop();
        if (e === 'hit') A.sfx.hit();
        if (e === 'wave') A.sfx.win();
      });
      if (state.over) gameOver();
    }

    function gameOver() {
      started = false;
      if (state.score > hi) {
        hi = state.score;
        U.store.set(hiKey, hi);
      }
      if (A) A.sfx.lose();
      AR.overlay(wrap, 'Il Gatto ha vinto 🐱', 'Punti: ' + state.score + ' · Ondata: ' + state.wave + ' · Migliore: ' + hi, 'Gioca ancora', newRun);
    }

    function newRun() {
      state = newGame(Math.floor(Math.random() * 1e9));
      started = true;
      loop = loop || AR.startLoop(frame, draw);
    }

    function onKey(k, down) {
      if (k === ' ' || k === 'enter') fireHeld = down;
    }

    unbind = AR.bindKeys(onKey);
    draw();
    AR.overlay(wrap, 'Raccoon Defender 🦝', 'Frecce o A/D per muoverti. Spazio per sparare. Difendi la città dai gatti, dai topi e dai chihuahua.', 'Inizia', newRun);
    return {
      destroy: function () {
        if (loop) loop.stop();
        if (unbind) unbind();
      },
    };
  }

  return {
    meta: { id: 'invaders', title: 'Raccoon Defender', icon: '👾', desc: 'Space Invaders con il procione difensore.' },
    mount: mount,
    newGame: newGame,
    update: update,
    W: W,
    H: H,
  };
});
