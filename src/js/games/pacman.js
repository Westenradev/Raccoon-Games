// Raccoon-man. Eat every acorn in the maze. A cat, a chihuahua and a mouse chase you.
// From level 3 a second chihuahua joins them. The chasers hunt for a while, then wander.
// A pizza slice makes the chasers afraid for a few seconds: then you can catch them.
// The maze is generated for each level. It has no dead ends and every acorn can be reached.
(function (name, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else (window.RA = window.RA || { modules: {} }).modules[name] = api;
})('pacman', function () {
  const isNode = typeof require === 'function';
  const U = isNode ? require('../core/util.js') : window.RA.modules.util;
  const AR = isNode ? require('../core/arcade.js') : window.RA.modules.arcade;
  const A = isNode ? null : window.RA.audio;

  const W = 21;
  const H = 15;
  const TUNNEL_ROW = 7;
  const DIRS = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] };
  const DIR_NAMES = ['up', 'left', 'down', 'right'];
  const OPP = { up: 'down', down: 'up', left: 'right', right: 'left' };
  // smart = how often a chaser takes the shortest way to the raccoon while it hunts.
  const CHASERS = [
    { emoji: '🐱', smart: 0.65 },
    { emoji: '🐕', smart: 0.45 },
    { emoji: '🐭', smart: 0.25 },
    { emoji: '🐕', smart: 0.35 },
  ];
  const HUNT_TIME = 14; // seconds of hunting, then...
  const WANDER_TIME = 6; // ...seconds of wandering at random
  const POWER_TIME = 7;
  const FREEZE_TIME = 1.2;

  // Grid codes: '#' wall, '.' acorn, 'o' pizza power-up, ' ' empty floor.
  function buildMaze(seed) {
    const rnd = U.makeRng(seed);
    const g = [];
    for (let y = 0; y < H; y++) g.push(new Array(W).fill('#'));
    // A recursive backtracker carves a maze on the odd cells.
    const stack = [[1, 1]];
    g[1][1] = ' ';
    while (stack.length) {
      const top = stack[stack.length - 1];
      const opts = [];
      [[2, 0], [-2, 0], [0, 2], [0, -2]].forEach(function (d) {
        const nx = top[0] + d[0];
        const ny = top[1] + d[1];
        if (nx > 0 && nx < W - 1 && ny > 0 && ny < H - 1 && g[ny][nx] === '#') opts.push(d);
      });
      if (!opts.length) {
        stack.pop();
        continue;
      }
      const d = opts[Math.floor(rnd() * opts.length)];
      g[top[1] + d[1] / 2][top[0] + d[0] / 2] = ' ';
      g[top[1] + d[1]][top[0] + d[0]] = ' ';
      stack.push([top[0] + d[0], top[1] + d[1]]);
    }
    // Open one more wall at every dead end, so nobody can be trapped in a corner.
    for (let y = 1; y < H - 1; y += 2) {
      for (let x = 1; x < W - 1; x += 2) {
        const closed = [[1, 0], [-1, 0], [0, 1], [0, -1]].filter(function (d) { return g[y + d[1]][x + d[0]] === '#'; });
        if (closed.length < 3) continue;
        const usable = closed.filter(function (d) {
          const nx = x + d[0] * 2;
          const ny = y + d[1] * 2;
          return nx > 0 && nx < W - 1 && ny > 0 && ny < H - 1;
        });
        if (!usable.length) continue;
        const d = usable[Math.floor(rnd() * usable.length)];
        g[y + d[1]][x + d[0]] = ' ';
      }
    }
    // A few more openings give extra ways to escape.
    for (let y = 1; y < H - 1; y++) {
      for (let x = 1; x < W - 1; x++) {
        if (g[y][x] !== '#' || (x + y) % 2 === 0 || rnd() >= 0.1) continue;
        const across = x % 2 === 0 ? [[-1, 0], [1, 0]] : [[0, -1], [0, 1]];
        if (across.every(function (d) { return g[y + d[1]][x + d[0]] === ' '; })) g[y][x] = ' ';
      }
    }
    // Home of the chasers in the centre (3 x 3 open floor).
    const cx = (W - 1) / 2;
    const cy = (H - 1) / 2;
    for (let y = cy - 1; y <= cy + 1; y++) {
      for (let x = cx - 1; x <= cx + 1; x++) g[y][x] = ' ';
    }
    // Tunnel on the middle row: the left edge leads to the right edge.
    g[TUNNEL_ROW][0] = ' ';
    g[TUNNEL_ROW][W - 1] = ' ';
    // Start tile of the raccoon, in the middle of the bottom corridor.
    const start = { x: cx, y: H - 2 };
    g[start.y][start.x] = ' ';
    // Acorns on the floor, except in the home and on the start tile.
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        if (g[y][x] !== ' ') continue;
        const inHome = Math.abs(x - cx) <= 1 && Math.abs(y - cy) <= 1;
        if (!inHome && !(x === start.x && y === start.y)) g[y][x] = '.';
      }
    }
    [[1, 1], [W - 2, 1], [1, H - 2], [W - 2, H - 2]].forEach(function (p) { g[p[1]][p[0]] = 'o'; });
    return { grid: g, start: start, house: { x: cx, y: cy } };
  }

  function countAcorns(grid) {
    let n = 0;
    grid.forEach(function (row) {
      row.forEach(function (c) { if (c === '.' || c === 'o') n += 1; });
    });
    return n;
  }

  function wrapX(x) {
    return x < 0 ? W - 1 : (x >= W ? 0 : x);
  }

  function nextTile(x, y, dir) {
    const d = DIRS[dir];
    return { x: wrapX(x + d[0]), y: y + d[1] };
  }

  function canMove(grid, x, y, dir) {
    const d = DIRS[dir];
    const nx = x + d[0];
    const ny = y + d[1];
    if (ny < 0 || ny >= H) return false;
    if ((nx < 0 || nx >= W) && y !== TUNNEL_ROW) return false;
    return grid[ny][wrapX(nx)] !== '#';
  }

  // Walking distance from (sx, sy) to every floor tile. Walls stay at Infinity.
  function distanceMap(grid, sx, sy) {
    const dist = [];
    for (let y = 0; y < H; y++) dist.push(new Array(W).fill(Infinity));
    dist[sy][sx] = 0;
    const queue = [[sx, sy]];
    for (let i = 0; i < queue.length; i++) {
      const x = queue[i][0];
      const y = queue[i][1];
      for (const dir of DIR_NAMES) {
        if (!canMove(grid, x, y, dir)) continue;
        const n = nextTile(x, y, dir);
        if (dist[n.y][n.x] !== Infinity) continue;
        dist[n.y][n.x] = dist[y][x] + 1;
        queue.push([n.x, n.y]);
      }
    }
    return dist;
  }

  // Position in tile units, with the progress toward the next tile.
  function positionOf(e) {
    if (!e.moving) return { x: e.x, y: e.y };
    const d = DIRS[e.dir];
    return { x: e.x + d[0] * e.p, y: e.y + d[1] * e.p };
  }

  function newGame(seed, level, score, lives) {
    const m = buildMaze(seed);
    const state = {
      seed: seed,
      level: level || 1,
      grid: m.grid,
      start: m.start,
      house: m.house,
      homeDist: distanceMap(m.grid, m.house.x, m.house.y),
      pacDist: null,
      pac: null,
      ghosts: [],
      score: score || 0,
      lives: lives == null ? 3 : lives,
      acornsLeft: countAcorns(m.grid),
      scared: 0,
      eatChain: 0,
      freeze: FREEZE_TIME,
      modeClock: 0,
      over: false,
      won: false,
      rnd: U.makeRng(seed * 31 + 7),
      events: [],
    };
    resetPositions(state);
    return state;
  }

  function resetPositions(state) {
    state.pac = { x: state.start.x, y: state.start.y, dir: 'left', want: null, p: 0, moving: false };
    state.scared = 0;
    state.eatChain = 0;
    state.freeze = FREEZE_TIME;
    state.modeClock = 0;
    const h = state.house;
    const spots = [[0, -1], [-1, 0], [1, 0], [0, 1]];
    state.ghosts = CHASERS.slice(0, state.level < 3 ? 3 : 4).map(function (c, i) {
      return { id: i, emoji: c.emoji, x: h.x + spots[i][0], y: h.y + spots[i][1], dir: 'up', p: 0, moving: false, eaten: false, wait: i * 2.5 };
    });
  }

  function pacSpeed(state) {
    return 6 + Math.min(4, state.level) * 0.25;
  }

  function ghostSpeed(state, g) {
    if (g.eaten) return 11;
    if (state.scared > 0) return 3.2;
    return Math.min(pacSpeed(state) - 0.5, 3.7 + state.level * 0.35);
  }

  function isHunting(state) {
    return state.modeClock % (HUNT_TIME + WANDER_TIME) < HUNT_TIME;
  }

  // Direction for a chaser that stands on a tile.
  function ghostChoice(state, g) {
    const open = DIR_NAMES.filter(function (d) { return canMove(state.grid, g.x, g.y, d); });
    if (!open.length) return null;
    const best = function (dist, list) {
      let pick = list[0];
      let low = Infinity;
      list.forEach(function (d) {
        const n = nextTile(g.x, g.y, d);
        if (dist[n.y][n.x] < low) {
          low = dist[n.y][n.x];
          pick = d;
        }
      });
      return pick;
    };
    if (g.eaten) return best(state.homeDist, open);
    // A chaser does not turn back, unless it is in a dead end.
    const ahead = open.filter(function (d) { return d !== OPP[g.dir]; });
    const opts = ahead.length ? ahead : open;
    const random = opts[Math.floor(state.rnd() * opts.length)];
    if (state.scared > 0 || !isHunting(state)) return random;
    const smart = Math.min(0.95, CHASERS[g.id].smart + (state.level - 1) * 0.05);
    if (state.rnd() >= smart) return random;
    if (!state.pacDist) state.pacDist = distanceMap(state.grid, state.pac.x, state.pac.y);
    return best(state.pacDist, opts);
  }

  // Moves an entity. choose() gives the direction to leave a tile. onArrive() runs on each new tile.
  function advance(e, distance, choose, onArrive) {
    let budget = distance;
    let guard = 0;
    while (budget > 0 && guard++ < 8) {
      if (!e.moving) {
        const d = choose();
        if (!d) return;
        e.dir = d;
        e.moving = true;
        e.p = 0;
      }
      const need = 1 - e.p;
      if (budget < need) {
        e.p += budget;
        return;
      }
      budget -= need;
      const n = nextTile(e.x, e.y, e.dir);
      e.x = n.x;
      e.y = n.y;
      e.p = 0;
      e.moving = false;
      if (onArrive && onArrive() === false) return;
    }
  }

  // Turns an entity around in the middle of a step.
  function reverse(e) {
    if (!e.moving) return;
    const n = nextTile(e.x, e.y, e.dir);
    e.x = n.x;
    e.y = n.y;
    e.dir = OPP[e.dir];
    e.p = 1 - e.p;
  }

  function eatTile(state) {
    const pac = state.pac;
    const cell = state.grid[pac.y][pac.x];
    if (cell !== '.' && cell !== 'o') return;
    state.grid[pac.y][pac.x] = ' ';
    state.acornsLeft -= 1;
    if (cell === '.') {
      state.score += 10;
      state.events.push('eat');
    } else {
      state.score += 50;
      state.scared = POWER_TIME;
      state.eatChain = 0;
      state.events.push('power');
      state.ghosts.forEach(function (g) { if (!g.eaten) reverse(g); });
    }
    if (state.acornsLeft === 0) {
      state.won = true;
      state.over = true;
    }
  }

  // One simulation step. wantDir is 'up', 'down', 'left', 'right' or null.
  function update(state, dt, wantDir) {
    state.events = [];
    if (state.over) return;
    const pac = state.pac;
    if (wantDir) pac.want = wantDir;
    if (state.freeze > 0) {
      state.freeze -= dt;
      return;
    }
    state.pacDist = null;
    state.modeClock += dt;

    // The raccoon can turn back at any moment. Other turns happen on a tile.
    if (pac.moving && pac.want === OPP[pac.dir]) reverse(pac);
    advance(pac, pacSpeed(state) * dt, function () {
      if (pac.want && canMove(state.grid, pac.x, pac.y, pac.want)) return pac.want;
      if (pac.want && canMove(state.grid, pac.x, pac.y, pac.dir)) return pac.dir;
      return null;
    }, function () {
      eatTile(state);
      return !state.over;
    });
    if (state.over) return;
    if (state.scared > 0) state.scared = Math.max(0, state.scared - dt);

    state.ghosts.forEach(function (g) {
      if (g.wait > 0) {
        g.wait -= dt;
        return;
      }
      advance(g, ghostSpeed(state, g) * dt, function () { return ghostChoice(state, g); }, function () {
        if (g.eaten && g.x === state.house.x && g.y === state.house.y) {
          g.eaten = false;
          g.wait = 1.5;
          return false;
        }
        return true;
      });
    });

    // Contact test on the real positions, so two that cross each other also meet.
    const pp = positionOf(pac);
    for (const g of state.ghosts) {
      if (g.eaten) continue;
      const gp = positionOf(g);
      if (Math.abs(gp.x - pp.x) + Math.abs(gp.y - pp.y) > 0.7) continue;
      if (state.scared > 0) {
        state.eatChain += 1;
        state.score += 200 * Math.pow(2, state.eatChain - 1);
        g.eaten = true;
        state.events.push('ghost');
      } else {
        state.lives -= 1;
        state.events.push('die');
        if (state.lives <= 0) state.over = true;
        else resetPositions(state);
        return;
      }
    }
  }

  // ---------- Browser interface ----------
  function mount(container) {
    const TILE = 30;
    const HUD = 36;
    const wrap = U.el('div', { class: 'arcade-stage' });
    container.appendChild(wrap);
    const view = AR.createCanvas(wrap, W * TILE, H * TILE + HUD, 'pacman');
    const g = view.ctx;
    let hi = U.store.get('hi.pacman', 0);
    let seedBase = Math.floor(Math.random() * 1e6);
    let state = newGame(seedBase, 1);
    let started = false;
    let clock = 0;

    function px(pos) {
      return { x: pos.x * TILE + TILE / 2, y: HUD + pos.y * TILE + TILE / 2 };
    }

    function drawMaze() {
      for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
          const c = state.grid[y][x];
          const sx = x * TILE;
          const sy = HUD + y * TILE;
          if (c === '#') {
            g.fillStyle = '#1e2a78';
            g.fillRect(sx, sy, TILE, TILE);
            // Light edge where a wall meets the floor.
            g.fillStyle = '#7c9cff';
            if (y > 0 && state.grid[y - 1][x] !== '#') g.fillRect(sx, sy, TILE, 3);
            if (y < H - 1 && state.grid[y + 1][x] !== '#') g.fillRect(sx, sy + TILE - 3, TILE, 3);
            if (x > 0 && state.grid[y][x - 1] !== '#') g.fillRect(sx, sy, 3, TILE);
            if (x < W - 1 && state.grid[y][x + 1] !== '#') g.fillRect(sx + TILE - 3, sy, 3, TILE);
          } else if (c === '.') {
            g.fillStyle = '#fbbf77';
            g.beginPath();
            g.arc(sx + TILE / 2, sy + TILE / 2, 3.5, 0, Math.PI * 2);
            g.fill();
          } else if (c === 'o') {
            AR.emoji(g, '🍕', sx + TILE / 2, sy + TILE / 2, TILE - 8 + Math.sin(clock * 6) * 2);
          }
        }
      }
    }

    function draw() {
      g.fillStyle = '#05050f';
      g.fillRect(0, 0, view.w, view.h);
      drawMaze();
      state.ghosts.forEach(function (gh) {
        const pos = px(positionOf(gh));
        if (gh.eaten) {
          AR.emoji(g, '👀', pos.x, pos.y, TILE - 14);
          return;
        }
        if (state.scared > 0) {
          const blink = state.scared < 2 && Math.floor(clock * 6) % 2 === 0;
          g.fillStyle = blink ? '#e0e7ff' : '#3b82f6';
          g.beginPath();
          g.arc(pos.x, pos.y, TILE / 2 - 2, 0, Math.PI * 2);
          g.fill();
          g.globalAlpha = 0.75;
          AR.emoji(g, gh.emoji, pos.x, pos.y + 1, TILE - 12);
          g.globalAlpha = 1;
        } else {
          AR.emoji(g, gh.emoji, pos.x, pos.y + 1, TILE - 4);
        }
      });
      if (!state.over || state.won) {
        const pp = px(positionOf(state.pac));
        AR.emoji(g, '🦝', pp.x, pp.y + 1, TILE - 2);
      }
      if (started && state.freeze > 0 && !state.over) {
        AR.text(g, 'Pronti!', view.w / 2, HUD + (state.house.y + 3) * TILE + TILE / 2, 20, '#fde047');
      }
      g.fillStyle = '#0f0d2b';
      g.fillRect(0, 0, view.w, HUD);
      AR.text(g, 'Punti ' + state.score, 10, HUD / 2, 15, '#fef3c7', 'left');
      AR.text(g, 'Livello ' + state.level + ' · Record ' + Math.max(hi, state.score), view.w / 2, HUD / 2, 15, '#fef3c7');
      AR.text(g, 'Vite', view.w - 84, HUD / 2, 15, '#fef3c7', 'right');
      for (let i = 0; i < state.lives; i++) AR.emoji(g, '🦝', view.w - 68 + i * 24, HUD / 2 + 1, 18);
    }

    function frame(dt) {
      clock += dt;
      if (!started || state.over) return;
      update(state, dt, null);
      state.events.forEach(function (e) {
        if (!A) return;
        if (e === 'eat') A.sfx.eat();
        if (e === 'power') A.sfx.power();
        if (e === 'ghost') A.sfx.pop();
        if (e === 'die') A.sfx.hit();
      });
      if (state.over) endRun();
    }

    function endRun() {
      started = false;
      if (state.score > hi) {
        hi = state.score;
        U.store.set('hi.pacman', hi);
      }
      if (state.won) {
        if (A) A.sfx.win();
        const level = state.level + 1;
        const score = state.score;
        const lives = state.lives;
        AR.overlay(wrap, 'Ghiande finite! 🦝🌰', 'Punti: ' + score + ' · Record: ' + hi, 'Livello ' + level, function () { startLevel(level, score, lives); });
      } else {
        if (A) A.sfx.lose();
        AR.overlay(wrap, 'Ti hanno preso! 🐱', 'Punti: ' + state.score + ' · Livello: ' + state.level + ' · Record: ' + hi, 'Gioca ancora', function () { startLevel(1, 0, 3); });
      }
    }

    function startLevel(level, score, lives) {
      seedBase += 1;
      state = newGame(seedBase, level, score, lives);
      started = true;
    }

    const KEY_DIR = { arrowup: 'up', w: 'up', arrowdown: 'down', s: 'down', arrowleft: 'left', a: 'left', arrowright: 'right', d: 'right' };
    const unbind = AR.bindKeys(function (k, down) {
      if (down && KEY_DIR[k] && started) state.pac.want = KEY_DIR[k];
    });
    const loop = AR.startLoop(frame, draw);
    AR.overlay(wrap, 'Raccoon-man 🦝', 'Usa le frecce per muoverti. Mangia tutte le ghiande. Il gatto, il topo e i chihuahua ti inseguono: la pizza 🍕 li spaventa e puoi acchiapparli.', 'Inizia', function () { startLevel(1, 0, 3); });
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
    meta: { id: 'pacman', title: 'Raccoon-man', icon: '🌰', desc: 'Mangia le ghiande nel labirinto e scappa da gatti e chihuahua.' },
    mount: mount,
    buildMaze: buildMaze,
    newGame: newGame,
    update: update,
    countAcorns: countAcorns,
    distanceMap: distanceMap,
    canMove: canMove,
    nextTile: nextTile,
    W: W,
    H: H,
  };
});
