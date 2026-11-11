// Raccoon Defender (Space Invaders style): rows of pixel invaders come down on a planet,
// a green cannon and green shelters defend it, and a flying saucer crosses the sky for extra points.
(function (name, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else (window.RA = window.RA || { modules: {} }).modules[name] = api;
})('invaders', function () {
  const isNode = typeof require === 'function';
  const U = isNode ? require('../core/util.js') : window.RA.modules.util;
  const AR = isNode ? require('../core/arcade.js') : window.RA.modules.arcade;
  const A = isNode ? null : window.RA.audio;
  const SV = isNode ? null : window.RA.modules.saves;

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
  const UFO_Y = 58;
  // Row type: 0 = small invader (top row), 1 = medium, 2 = large (bottom rows).
  const TYPES = [{ points: 30 }, { points: 20 }, { points: 10 }];

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
      fy: 84,
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
      pops: [], // things that were just hit: { x, y, type, points, life }, for the burst on screen
      ufo: null, // the flying saucer that crosses the top now and then: { x, dir, points }
      ufoTimer: 14, // seconds until the next saucer
      steps: 0, // formation steps so far: the invaders change pose at every step
    };
  }

  function nextWave(state) {
    state.wave += 1;
    state.score += 100;
    state.invaders = makeInvaders();
    state.shields = makeShields(); // new shelters for each wave
    state.fx = 40;
    state.fy = 84;
    state.dir = 1;
    state.pBullets = [];
    state.eBullets = [];
    state.ufo = null;
    state.ufoTimer = 14;
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
    // Later waves are faster, but never so fast that they cannot be stopped.
    const base = Math.max(0.36, 0.7 - (state.wave - 1) * 0.05);
    return Math.max(0.06, base * (0.25 + 0.75 * frac));
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
      const u = state.ufo;
      if (u && Math.abs(b.x - u.x) < 20 && b.y > UFO_Y - 10 && b.y < UFO_Y + 10) {
        state.score += u.points;
        state.pops.push({ x: u.x, y: UFO_Y, type: 3, points: u.points, life: 1 });
        state.ufo = null;
        state.ufoTimer = 14 + state.rnd() * 10;
        state.events.push('ufokill');
        return false;
      }
      for (const inv of state.invaders) {
        if (!inv.alive) continue;
        const p = invaderPos(state, inv);
        if (b.x > p.x - INV_W / 2 && b.x < p.x + INV_W / 2 && b.y > p.y - INV_H / 2 && b.y < p.y + INV_H / 2) {
          inv.alive = false;
          state.pops.push({ x: p.x, y: p.y, type: inv.type, points: TYPES[inv.type].points, life: 0.7 });
          state.score += TYPES[inv.type].points;
          state.events.push('kill');
          return false;
        }
      }
      return true;
    });

    // The flying saucer: it crosses the top of the screen and is worth extra points.
    if (state.ufo) {
      state.ufo.x += state.ufo.dir * 95 * dt;
      if (state.ufo.x < -30 || state.ufo.x > W + 30) {
        state.ufo = null;
        state.ufoTimer = 14 + state.rnd() * 10;
      }
    } else {
      state.ufoTimer -= dt;
      if (state.ufoTimer <= 0 && aliveCount(state) > 6) {
        const dir = state.rnd() < 0.5 ? 1 : -1;
        state.ufo = { x: dir > 0 ? -28 : W + 28, dir: dir, points: [50, 100, 150, 300][Math.floor(state.rnd() * 4)] };
        state.events.push('ufo');
      }
    }

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
    const fireEvery = Math.max(0.7, 1.7 - (state.wave - 1) * 0.12);
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
    state.eBullets.forEach((b) => { b.y += (170 + state.wave * 20) * dt; });
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
    state.steps += 1;
    state.events.push('step');
    // Invaders that reach the shelters break the cells they touch.
    alive.forEach(function (inv) {
      const p = invaderPos(state, inv);
      if (p.y + INV_H / 2 < SHIELD_Y) return;
      state.shields.forEach(function (block) {
        block.forEach(function (c) {
          if (c.alive && c.x < p.x + INV_W / 2 && c.x + SHIELD_CELL > p.x - INV_W / 2 && c.y < p.y + INV_H / 2 && c.y + SHIELD_CELL > p.y - INV_H / 2) c.alive = false;
        });
      });
    });
    // Invaders reaching the player row end the game.
    const lowestY = Math.max.apply(null, alive.map((i) => state.fy + i.row * SPACING_Y));
    if (lowestY + INV_H / 2 >= PLAYER_Y - 10) {
      state.over = true;
      state.events.push('invaded');
    }
  }

  // ---------- Browser interface ----------
  // The classic game with more light: coloured invaders that glow, a starry sky, the planet
  // to defend at the bottom, pixel bursts, and the lines of an old arcade screen.
  const WHITE = '#f4f4f4';
  const GREEN = '#3dff6e';
  const TYPE_COLOR = ['#ff6ad5', '#6ae3ff', '#b6ff6a', '#ff5340'];
  // Two poses for each invader. 'X' is a lit pixel.
  const SPRITES = [
    [['...XX...', '..XXXX..', '.XXXXXX.', 'XX.XX.XX', 'XXXXXXXX', '..X..X..', '.X.XX.X.', 'X.X..X.X'],
      ['...XX...', '..XXXX..', '.XXXXXX.', 'XX.XX.XX', 'XXXXXXXX', '.X.XX.X.', 'X......X', '.X....X.']],
    [['..X.....X..', '...X...X...', '..XXXXXXX..', '.XX.XXX.XX.', 'XXXXXXXXXXX', 'X.XXXXXXX.X', 'X.X.....X.X', '...XX.XX...'],
      ['..X.....X..', 'X..X...X..X', 'X.XXXXXXX.X', 'XXX.XXX.XXX', 'XXXXXXXXXXX', '.XXXXXXXXX.', '..X.....X..', '.X.......X.']],
    [['....XXXX....', '.XXXXXXXXXX.', 'XXXXXXXXXXXX', 'XXX..XX..XXX', 'XXXXXXXXXXXX', '...XX..XX...', '..XX.XX.XX..', 'XX........XX'],
      ['....XXXX....', '.XXXXXXXXXX.', 'XXXXXXXXXXXX', 'XXX..XX..XXX', 'XXXXXXXXXXXX', '..XXX..XXX..', '.XX..XX..XX.', '..XX....XX..']],
  ];
  const CANNON = ['......X......', '.....XXX.....', '.....XXX.....', '.XXXXXXXXXXX.', 'XXXXXXXXXXXXX', 'XXXXXXXXXXXXX', 'XXXXXXXXXXXXX'];
  const SAUCER = ['.....XXXXXX.....', '...XXXXXXXXXX...', '..XXXXXXXXXXXX..', '.XX.XX.XX.XX.XX.', 'XXXXXXXXXXXXXXXX', '..XXX..XX..XXX..', '...X........X...'];
  const PX = 2.5;

  // Sprites with their glow are drawn once on a hidden canvas, then copied: this stays fast.
  const glowCache = {};
  function glow(g, rows, cx, cy, px, color) {
    const key = rows.join('|') + px + color;
    let s = glowCache[key];
    if (!s) {
      const pad = 9;
      const k = 3;
      const w = rows[0].length * px + pad * 2;
      const h = rows.length * px + pad * 2;
      const c = document.createElement('canvas');
      c.width = Math.ceil(w * k);
      c.height = Math.ceil(h * k);
      const cg = c.getContext('2d');
      cg.scale(k, k);
      cg.shadowColor = color;
      cg.shadowBlur = 7 * k;
      AR.sprite(cg, rows, pad, pad, px, color);
      cg.shadowBlur = 0;
      AR.sprite(cg, rows, pad, pad, px, color);
      s = glowCache[key] = { c: c, w: w, h: h };
    }
    g.drawImage(s.c, cx - s.w / 2, cy - s.h / 2, s.w, s.h);
  }

  // Stars in three layers that drift down at different speeds.
  const STARS = [];
  for (let i = 0; i < 90; i++) {
    const layer = i % 3;
    STARS.push({ x: (i * 97.3) % W, y: (i * 151.7) % H, size: 1 + layer * 0.7, speed: 4 + layer * 7, phase: i * 1.7 });
  }
  let scanlines = null;

  // view (optional): { clock, debris, shake, flash, banner, muzzle }
  function paint(g, state, hi, view) {
    const v = view || {};
    const clock = v.clock || 0;
    // Deep space.
    const sky = g.createLinearGradient(0, 0, 0, H);
    sky.addColorStop(0, '#05041a');
    sky.addColorStop(0.7, '#0a0730');
    sky.addColorStop(1, '#150a3a');
    g.fillStyle = sky;
    g.fillRect(0, 0, W, H);
    g.save();
    if (v.shake > 0) g.translate(Math.sin(clock * 95) * v.shake * 6, Math.cos(clock * 80) * v.shake * 4);
    STARS.forEach(function (st) {
      const y = (st.y + clock * st.speed) % H;
      g.globalAlpha = 0.35 + 0.45 * Math.abs(Math.sin(clock * 1.3 + st.phase));
      g.fillStyle = st.size > 2 ? '#bcd0ff' : '#fff';
      g.fillRect(st.x, y, st.size, st.size);
    });
    g.globalAlpha = 1;
    // The planet to defend: a blue curve with a thin glowing air.
    const planet = g.createRadialGradient(W / 2, H + 560, 540, W / 2, H + 560, 600);
    planet.addColorStop(0, '#0d3b7a');
    planet.addColorStop(0.75, '#1466b8');
    planet.addColorStop(0.9, 'rgba(90,200,255,0.55)');
    planet.addColorStop(1, 'rgba(90,200,255,0)');
    g.fillStyle = planet;
    g.fillRect(0, H - 70, W, 70);

    const pose = state.steps % 2;
    state.invaders.forEach(function (inv) {
      if (!inv.alive) return;
      const p = invaderPos(state, inv);
      glow(g, SPRITES[inv.type][pose], Math.round(p.x), Math.round(p.y), PX, TYPE_COLOR[inv.type]);
    });
    if (state.ufo) {
      glow(g, SAUCER, state.ufo.x, UFO_Y, PX, TYPE_COLOR[3]);
      // Running lights under the saucer.
      g.fillStyle = Math.floor(clock * 8) % 2 ? '#ffe600' : '#fff';
      for (let i = -2; i <= 2; i++) g.fillRect(state.ufo.x + i * 7 - 1, UFO_Y + 4, 2.5, 2.5);
    }
    // Shelters: a soft halo, then the bricks.
    state.shields.forEach(function (block) {
      block.forEach(function (c) {
        if (!c.alive) return;
        g.fillStyle = 'rgba(61,255,110,0.18)';
        g.fillRect(c.x - 2, c.y - 2, SHIELD_CELL + 4, SHIELD_CELL + 4);
      });
    });
    g.fillStyle = GREEN;
    state.shields.forEach(function (block) {
      block.forEach(function (c) {
        if (c.alive) g.fillRect(c.x, c.y, SHIELD_CELL, SHIELD_CELL);
      });
    });
    if (!(state.invuln > 0 && Math.floor(state.invuln * 10) % 2 === 0) && !state.over) {
      glow(g, CANNON, Math.round(state.px), PLAYER_Y, 3, GREEN);
      if (v.muzzle > 0) {
        g.fillStyle = 'rgba(255,255,200,' + Math.min(1, v.muzzle * 8).toFixed(2) + ')';
        g.beginPath();
        g.arc(state.px, PLAYER_Y - 14, 7, 0, Math.PI * 2);
        g.fill();
      }
    }
    // Player shots: a bright bolt with a fading tail.
    state.pBullets.forEach(function (b) {
      const tail = g.createLinearGradient(0, b.y, 0, b.y + 30);
      tail.addColorStop(0, 'rgba(160,255,190,0.9)');
      tail.addColorStop(1, 'rgba(160,255,190,0)');
      g.fillStyle = tail;
      g.fillRect(b.x - 2, b.y, 4, 30);
      g.fillStyle = '#fff';
      g.fillRect(b.x - 1.5, b.y, 3, 11);
    });
    // Enemy shots: orange zigzag bolts.
    state.eBullets.forEach(function (b) {
      const wob = Math.floor(b.y / 8) % 2 ? 2 : -2;
      g.fillStyle = 'rgba(255,150,60,0.3)';
      g.fillRect(b.x - 5, b.y - 9, 10, 18);
      g.fillStyle = '#ffb347';
      g.fillRect(b.x - 1.5 + wob, b.y - 8, 3, 5);
      g.fillRect(b.x - 1.5 - wob, b.y - 3, 3, 5);
      g.fillRect(b.x - 1.5 + wob, b.y + 2, 3, 5);
    });
    // Pixel debris of what was hit, and the points it gave.
    (v.debris || []).forEach(function (p) {
      g.globalAlpha = Math.max(0, Math.min(1, p.life * 2.2));
      g.fillStyle = p.color;
      g.fillRect(p.x, p.y, p.size, p.size);
    });
    g.globalAlpha = 1;
    state.pops.forEach(function (b) {
      g.globalAlpha = Math.max(0, Math.min(1, b.life * 2));
      AR.pixelText(g, String(b.points || ''), b.x, b.y - (1 - b.life) * 26, b.type === 3 ? 12 : 9, b.type === 3 ? '#ffe600' : '#fff');
    });
    g.globalAlpha = 1;

    // Ground line and lives.
    g.fillStyle = GREEN;
    g.fillRect(0, H - 24, W, 2);
    AR.pixelText(g, 'VITE', 10, H - 11, 11, GREEN, 'left');
    for (let i = 0; i < state.lives; i++) AR.sprite(g, CANNON, 64 + i * 34, H - 19, 2, GREEN);
    AR.pixelText(g, 'ONDATA ' + state.wave, W - 10, H - 11, 11, GREEN, 'right');
    g.restore();

    // Score bar.
    AR.pixelText(g, 'PUNTI', 12, 14, 11, WHITE, 'left');
    AR.pixelText(g, String(state.score).padStart(5, '0'), 12, 32, 12, WHITE, 'left');
    AR.pixelText(g, 'RECORD', W - 12, 14, 11, '#ff6ad5', 'right');
    AR.pixelText(g, String(Math.max(hi, state.score)).padStart(5, '0'), W - 12, 32, 12, '#ff6ad5', 'right');
    if (v.banner > 0) {
      g.globalAlpha = Math.min(1, v.banner * 2);
      AR.pixelText(g, 'ONDATA ' + state.wave, W / 2, H / 2 - 20, 22, '#ffe600');
      g.globalAlpha = 1;
    }
    if (v.flash > 0) {
      g.fillStyle = 'rgba(255,60,40,' + Math.min(0.45, v.flash).toFixed(2) + ')';
      g.fillRect(0, 0, W, H);
    }
    // The lines and the dark corners of an old arcade screen.
    if (!scanlines) {
      const c = document.createElement('canvas');
      c.width = 4;
      c.height = 4;
      const cg = c.getContext('2d');
      cg.fillStyle = 'rgba(0,0,0,0.22)';
      cg.fillRect(0, 2, 4, 2);
      scanlines = g.createPattern(c, 'repeat');
    }
    g.fillStyle = scanlines;
    g.fillRect(0, 0, W, H);
    const corner = g.createRadialGradient(W / 2, H / 2, H * 0.35, W / 2, H / 2, H * 0.75);
    corner.addColorStop(0, 'rgba(0,0,0,0)');
    corner.addColorStop(1, 'rgba(0,0,0,0.5)');
    g.fillStyle = corner;
    g.fillRect(0, 0, W, H);
  }

  function thumb(el) {
    const s = newGame(3);
    s.fx = 70;
    s.fy = 150;
    [4, 13, 22, 31, 40, 41, 38].forEach(function (i) { s.invaders[i].alive = false; });
    s.px = 250;
    s.pBullets = [{ x: 250, y: 400 }];
    s.eBullets = [{ x: 150, y: 380 }];
    s.ufo = { x: 330, dir: 1, points: 100 };
    AR.thumb(el, W, 350, function (g) {
      g.save();
      g.translate(0, -90);
      g.beginPath();
      g.rect(0, 90, W, 350);
      g.clip();
      // Bring the saucer, the shelters and the cannon into the small picture.
      const shown = Object.assign({}, s, { shields: s.shields.map(function (b) { return b.map(function (c) { return { x: c.x, y: c.y - 60, alive: c.alive }; }); }) });
      paint(g, shown, 0, { clock: 1 });
      g.restore();
    });
  }

  // What is kept of a game that the player leaves.
  const KEPT = ['px', 'invaders', 'fx', 'fy', 'dir', 'stepAcc', 'fireAcc', 'shields', 'score', 'lives', 'wave', 'steps', 'ufoTimer'];

  function mount(container) {
    const wrap = U.el('div', { class: 'arcade-stage' });
    container.appendChild(wrap);
    const view = AR.createCanvas(wrap, W, H, 'invaders');
    const g = view.ctx;
    const best = AR.record('invaders');
    let state = newGame(1);
    let started = false;
    let waiting = true; // a saved game may still be waiting for "resume or new"
    const fx = { clock: 0, debris: [], shake: 0, flash: 0, banner: 0, muzzle: 0 };

    function draw() {
      paint(g, state, best.get(), fx);
    }

    function burst(x, y, color, n, speed) {
      for (let i = 0; i < n; i++) {
        const a = Math.random() * Math.PI * 2;
        const sp = speed * (0.3 + Math.random() * 0.7);
        fx.debris.push({ x: x, y: y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 0.35 + Math.random() * 0.3, size: 2 + Math.random() * 2.5, color: color });
      }
    }

    // Called by the loop. Uses the game logic function update(state, dt, input).
    function frame(dt) {
      fx.clock += dt;
      fx.shake = Math.max(0, fx.shake - dt * 2.5);
      fx.flash = Math.max(0, fx.flash - dt * 1.4);
      fx.banner = Math.max(0, fx.banner - dt);
      fx.muzzle = Math.max(0, fx.muzzle - dt);
      fx.debris.forEach(function (p) {
        p.life -= dt;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.vy += 160 * dt;
      });
      fx.debris = fx.debris.filter(function (p) { return p.life > 0; });
      state.pops.forEach(function (b) {
        if (!b.seen) {
          b.seen = true;
          burst(b.x, b.y, TYPE_COLOR[b.type], b.type === 3 ? 34 : 16, b.type === 3 ? 190 : 130);
        }
        b.life -= dt;
      });
      state.pops = state.pops.filter(function (b) { return b.life > 0; });
      if (!started || state.over) return;
      update(state, dt, AR.dirInput());
      best.submit(state.score);
      state.events.forEach(function (e) {
        if (e === 'shoot') fx.muzzle = 0.09;
        if (e === 'hit') {
          fx.shake = 1;
          fx.flash = 0.45;
          burst(state.px, PLAYER_Y, GREEN, 40, 220);
        }
        if (e === 'wave') fx.banner = 1.6;
        if (!A) return;
        if (e === 'shoot') A.sfx.shoot();
        if (e === 'kill') A.sfx.pop();
        if (e === 'hit') A.sfx.hit();
        if (e === 'wave') A.sfx.win();
        if (e === 'step') A.sfx.tick();
        if (e === 'ufo') A.sfx.power();
        if (e === 'ufokill') A.sfx.clear();
      });
      if (state.over) gameOver();
    }

    function gameOver() {
      started = false;
      const hi = best.submit(state.score);
      if (A) A.sfx.lose();
      AR.overlay(wrap, 'PARTITA FINITA', 'Punti: ' + state.score + '. Ondata: ' + state.wave + '. Record: ' + hi + '.', 'GIOCA ANCORA', newRun);
    }

    function begin(next) {
      state = next;
      waiting = false;
      started = true;
      fx.debris = [];
      fx.shake = 0;
      fx.flash = 0;
      fx.banner = 1.6;
    }

    function newRun() {
      begin(newGame(Math.floor(Math.random() * 1e9)));
    }

    function persist() {
      if (waiting) return;
      if (!started || state.over) return SV.clear('invaders');
      const keep = {};
      KEPT.forEach(function (k) { keep[k] = state[k]; });
      SV.save('invaders', keep);
    }

    const unbind = AR.bindKeys(function () {});
    const loop = AR.startLoop(frame, draw, { view: view, active: function () { return started && !state.over; } });
    AR.help(wrap, 'Frecce sinistra e destra: muovi il cannone. Spazio: spara. P: pausa.');
    AR.startCard(wrap, {
      id: 'invaders',
      title: 'RACCOON DEFENDER',
      body: 'Gli invasori scendono verso il pianeta. Colpiscili tutti prima che arrivino a terra. Il disco volante in alto vale punti in più.',
      summary: function (saved) { return 'Punti: ' + saved.score + '. Ondata: ' + saved.wave + '. Vite: ' + saved.lives + '.'; },
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
    meta: { id: 'invaders', title: 'Raccoon Defender', desc: 'Ferma gli invasori dello spazio.' },
    mount: mount,
    thumb: thumb,
    newGame: newGame,
    update: update,
    W: W,
    H: H,
  };
});
