// Raccoon-man (Pac-Man style). Eat every dot in the maze while four ghosts chase you.
// A big dot makes the ghosts afraid for a few seconds: then you can catch them.
// Three ghosts at the start, the fourth joins from level 3. They hunt for a while, then wander.
// The maze is generated for each level. It has no dead ends and every dot can be reached.
(function (name, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else (window.RA = window.RA || { modules: {} }).modules[name] = api;
})('pacman', function () {
  const isNode = typeof require === 'function';
  const U = isNode ? require('../core/util.js') : window.RA.modules.util;
  const AR = isNode ? require('../core/arcade.js') : window.RA.modules.arcade;
  const A = isNode ? null : window.RA.audio;
  const SV = isNode ? null : window.RA.modules.saves;

  const W = 21;
  const H = 15;
  const TUNNEL_ROW = 7;
  const DIRS = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] };
  const DIR_NAMES = ['up', 'left', 'down', 'right'];
  const OPP = { up: 'down', down: 'up', left: 'right', right: 'left' };
  // smart = how often a chaser takes the shortest way to the raccoon while it hunts.
  const CHASERS = [
    { color: '#ff2a1a', smart: 0.65 },
    { color: '#ffb8ff', smart: 0.45 },
    { color: '#22e8f0', smart: 0.25 },
    { color: '#ffb852', smart: 0.35 },
  ];
  const HUNT_TIME = 14; // seconds of hunting, then...
  const WANDER_TIME = 6; // ...seconds of wandering at random
  const POWER_TIME = 7;
  const FREEZE_TIME = 1.2;

  // Grid codes: '#' wall, '.' dot, 'o' big dot (power), ' ' empty floor.
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
      return { id: i, color: c.color, x: h.x + spots[i][0], y: h.y + spots[i][1], dir: 'up', p: 0, moving: false, eaten: false, wait: i * 2.5 };
    });
  }

  function pacSpeed(state) {
    return 6 + Math.min(4, state.level) * 0.25;
  }

  function ghostSpeed(state, g) {
    if (g.eaten) return 11;
    if (isAfraid(state, g)) return 3.2;
    return Math.min(pacSpeed(state) - 0.5, 3.7 + state.level * 0.35);
  }

  // A chaser is afraid while the big dot works. One that was caught and came back is not
  // afraid again until the next big dot, so it cannot be caught over and over.
  function isAfraid(state, g) {
    return state.scared > 0 && !g.eaten && !g.brave;
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
    if (isAfraid(state, g) || !isHunting(state)) return random;
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
      state.ghosts.forEach(function (g) {
        g.brave = false;
        if (!g.eaten) reverse(g);
      });
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
          g.brave = true;
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
      // In the tunnel the two ends of the row touch, so the distance wraps around.
      let dx = Math.abs(gp.x - pp.x);
      if (dx > W / 2) dx = W - dx;
      if (dx + Math.abs(gp.y - pp.y) > 0.7) continue;
      if (isAfraid(state, g)) {
        // 200, 400, 800, 1600 points, as in the arcade.
        state.eatChain = Math.min(4, state.eatChain + 1);
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
  const TILE = 30;
  const HUD = 40;
  const VIEW_W = W * TILE;
  const VIEW_H = H * TILE + HUD;
  const WALL = '#2233ee';
  const DOT = '#ffb8ae';
  const ANGLE = { right: 0, down: Math.PI / 2, left: Math.PI, up: -Math.PI / 2 };

  function isWall(grid, x, y) {
    return x < 0 || y < 0 || x >= W || y >= H || grid[y][x] === '#';
  }

  // Walls are black inside with a thin blue outline, like the 1980 arcade maze.
  function paintMaze(g, grid, clock) {
    const t = 3;
    g.fillStyle = WALL;
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) if (grid[y][x] === '#') g.fillRect(x * TILE, HUD + y * TILE, TILE, TILE);
    }
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        if (grid[y][x] !== '#') continue;
        const l = isWall(grid, x - 1, y) ? 0 : t;
        const r = isWall(grid, x + 1, y) ? 0 : t;
        const u = isWall(grid, x, y - 1) ? 0 : t;
        const d = isWall(grid, x, y + 1) ? 0 : t;
        const sx = x * TILE;
        const sy = HUD + y * TILE;
        g.fillStyle = '#000';
        g.fillRect(sx + l, sy + u, TILE - l - r, TILE - u - d);
        // Inner corners: keep a blue corner where only the diagonal tile is floor.
        g.fillStyle = WALL;
        if (!l && !u && !isWall(grid, x - 1, y - 1)) g.fillRect(sx, sy, t, t);
        if (!r && !u && !isWall(grid, x + 1, y - 1)) g.fillRect(sx + TILE - t, sy, t, t);
        if (!l && !d && !isWall(grid, x - 1, y + 1)) g.fillRect(sx, sy + TILE - t, t, t);
        if (!r && !d && !isWall(grid, x + 1, y + 1)) g.fillRect(sx + TILE - t, sy + TILE - t, t, t);
      }
    }
    g.fillStyle = DOT;
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const cx = x * TILE + TILE / 2;
        const cy = HUD + y * TILE + TILE / 2;
        if (grid[y][x] === '.') {
          g.fillRect(cx - 2.5, cy - 2.5, 5, 5);
        } else if (grid[y][x] === 'o' && Math.floor(clock * 4) % 2 === 0) {
          g.beginPath();
          g.arc(cx, cy, 8, 0, Math.PI * 2);
          g.fill();
        }
      }
    }
  }

  function paintPac(g, x, y, dir, open) {
    const a = ANGLE[dir] || 0;
    g.fillStyle = '#ffee00';
    g.beginPath();
    g.moveTo(x, y);
    g.arc(x, y, TILE / 2 - 2, a + open, a + Math.PI * 2 - open);
    g.closePath();
    g.fill();
  }

  // mode: 'chase', 'scared', 'flash' or 'eyes'.
  function paintGhost(g, x, y, color, dir, mode, clock) {
    const r = TILE / 2 - 2;
    if (mode !== 'eyes') {
      g.fillStyle = mode === 'scared' ? '#2233ee' : mode === 'flash' ? '#f4f4f4' : color;
      g.beginPath();
      g.arc(x, y - 1, r, Math.PI, 0);
      g.lineTo(x + r, y + r);
      // The hem has three points that move as the ghost walks.
      const shift = Math.floor(clock * 8) % 2 ? r / 3 : 0;
      for (let i = 0; i < 3; i++) {
        const x0 = x + r - (i * 2 * r) / 3;
        g.lineTo(x0 - r / 3 + shift / 2, y + r - 5);
        g.lineTo(x0 - (2 * r) / 3, y + r);
      }
      g.closePath();
      g.fill();
    }
    if (mode === 'scared' || mode === 'flash') {
      g.fillStyle = mode === 'flash' ? '#e02020' : '#ffd0c0';
      g.fillRect(x - 6, y - 5, 4, 4);
      g.fillRect(x + 2, y - 5, 4, 4);
      g.fillRect(x - 8, y + 4, 3, 2); g.fillRect(x - 5, y + 2, 3, 2); g.fillRect(x - 2, y + 4, 3, 2);
      g.fillRect(x + 1, y + 2, 3, 2); g.fillRect(x + 4, y + 4, 3, 2);
      return;
    }
    const d = DIRS[dir] || [0, 0];
    g.fillStyle = '#fff';
    g.beginPath();
    g.ellipse(x - 5 + d[0] * 2, y - 3 + d[1] * 2, 4, 5, 0, 0, Math.PI * 2);
    g.ellipse(x + 5 + d[0] * 2, y - 3 + d[1] * 2, 4, 5, 0, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#1a2cd0';
    g.beginPath();
    g.arc(x - 5 + d[0] * 4, y - 3 + d[1] * 4, 2.2, 0, Math.PI * 2);
    g.arc(x + 5 + d[0] * 4, y - 3 + d[1] * 4, 2.2, 0, Math.PI * 2);
    g.fill();
  }

  function paint(g, state, hi, clock, ready) {
    const px = function (pos) { return { x: pos.x * TILE + TILE / 2, y: HUD + pos.y * TILE + TILE / 2 }; };
    g.fillStyle = '#000';
    g.fillRect(0, 0, VIEW_W, VIEW_H);
    paintMaze(g, state.grid, clock);
    state.ghosts.forEach(function (gh) {
      const pos = px(positionOf(gh));
      let mode = 'chase';
      if (gh.eaten) mode = 'eyes';
      else if (isAfraid(state, gh)) mode = state.scared < 2 && Math.floor(clock * 6) % 2 === 0 ? 'flash' : 'scared';
      paintGhost(g, pos.x, pos.y, gh.color, gh.dir, mode, clock);
      if (pos.x < TILE / 2) paintGhost(g, pos.x + VIEW_W, pos.y, gh.color, gh.dir, mode, clock);
      if (pos.x > VIEW_W - TILE / 2) paintGhost(g, pos.x - VIEW_W, pos.y, gh.color, gh.dir, mode, clock);
    });
    if (!state.over || state.won) {
      const pp = px(positionOf(state.pac));
      const open = state.pac.moving ? 0.08 + Math.abs(Math.sin(clock * 14)) * 0.6 : 0.35;
      paintPac(g, pp.x, pp.y, state.pac.dir, open);
      if (pp.x < TILE / 2) paintPac(g, pp.x + VIEW_W, pp.y, state.pac.dir, open);
      if (pp.x > VIEW_W - TILE / 2) paintPac(g, pp.x - VIEW_W, pp.y, state.pac.dir, open);
    }
    if (ready) {
      const ry = HUD + (state.house.y + 3) * TILE + TILE / 2;
      g.fillStyle = '#000';
      g.fillRect(VIEW_W / 2 - 78, ry - 15, 156, 30);
      AR.pixelText(g, 'PRONTI!', VIEW_W / 2, ry, 16, '#ffee00');
    }
    AR.pixelText(g, 'PUNTI ' + state.score, 10, HUD / 2, 12, '#fff', 'left');
    AR.pixelText(g, 'RECORD ' + Math.max(hi, state.score), VIEW_W / 2 - 30, HUD / 2, 12, '#ff4a30');
    AR.pixelText(g, 'LIV.' + state.level, VIEW_W - 104, HUD / 2, 12, '#ffb852', 'right');
    for (let i = 0; i < state.lives; i++) paintPac(g, VIEW_W - 22 - i * 30, HUD / 2, 'left', 0.5);
  }

  function thumb(el) {
    const s = newGame(11, 1);
    s.pac.x = 4; s.pac.y = 5; s.pac.dir = 'right';
    for (let x = 1; x <= 4; x++) if (s.grid[5][x] !== '#') s.grid[5][x] = ' ';
    s.ghosts.forEach(function (gh, i) { gh.x = 12 + i * 2; gh.y = 5; gh.dir = 'left'; });
    AR.thumb(el, VIEW_W, 300, function (g) {
      g.save();
      g.translate(0, -HUD - 40);
      paint(g, s, 0, 0.1, false);
      g.restore();
    });
  }

  function mount(container) {
    const wrap = U.el('div', { class: 'arcade-stage' });
    container.appendChild(wrap);
    const view = AR.createCanvas(wrap, VIEW_W, VIEW_H, 'pacman');
    const g = view.ctx;
    const best = AR.record('pacman');
    let seedBase = Math.floor(Math.random() * 1e6);
    let state = newGame(seedBase, 1);
    let started = false;
    let clock = 0;
    let waiting = true; // a saved game may still be waiting for "resume or new"
    let between = null; // { level, score, lives } while the card between two levels is shown

    function draw() {
      paint(g, state, best.get(), clock, started && state.freeze > 0 && !state.over);
    }

    function frame(dt) {
      clock += dt;
      if (!started || state.over) return;
      // A key that is still held after a restart counts as the wanted direction.
      if (!state.pac.want) {
        const inp = AR.dirInput();
        state.pac.want = inp.left ? 'left' : inp.right ? 'right' : inp.up ? 'up' : inp.down ? 'down' : null;
      }
      update(state, dt, null);
      best.submit(state.score);
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
      const hi = best.submit(state.score);
      if (state.won) {
        if (A) A.sfx.win();
        const level = state.level + 1;
        const score = state.score;
        const lives = state.lives;
        between = { level: level, score: score, lives: lives };
        AR.overlay(wrap, 'LIVELLO SUPERATO', 'Punti: ' + score + '. Record: ' + hi + '.', 'LIVELLO ' + level, function () { startLevel(level, score, lives); });
      } else {
        if (A) A.sfx.lose();
        AR.overlay(wrap, 'PARTITA FINITA', 'Punti: ' + state.score + '. Livello: ' + state.level + '. Record: ' + hi + '.', 'GIOCA ANCORA', function () { startLevel(1, 0, 3); });
      }
    }

    function startLevel(level, score, lives) {
      seedBase += 1;
      state = newGame(seedBase, level, score, lives);
      waiting = false;
      between = null;
      started = true;
    }

    // What is kept of a game that the player leaves. The maze comes back from its seed.
    function persist() {
      if (waiting) return;
      if (between) return SV.save('pacman', { between: between, score: between.score, level: between.level, lives: between.lives });
      if (!started || state.over) return SV.clear('pacman');
      SV.save('pacman', {
        seed: state.seed, level: state.level, score: state.score, lives: state.lives, grid: state.grid,
        acornsLeft: state.acornsLeft, pac: { x: state.pac.x, y: state.pac.y, dir: state.pac.dir },
        ghosts: state.ghosts.map(function (gh) { return { x: gh.x, y: gh.y, dir: gh.dir, eaten: gh.eaten, wait: gh.wait, brave: !!gh.brave }; }),
        scared: state.scared, eatChain: state.eatChain, modeClock: state.modeClock,
      });
    }

    function resume(saved) {
      if (saved.between) return startLevel(saved.between.level, saved.between.score, saved.between.lives);
      const s = newGame(saved.seed, saved.level, saved.score, saved.lives);
      s.grid = saved.grid;
      s.acornsLeft = saved.acornsLeft;
      Object.assign(s.pac, saved.pac);
      saved.ghosts.forEach(function (gh, i) { if (s.ghosts[i]) Object.assign(s.ghosts[i], gh); });
      s.scared = saved.scared;
      s.eatChain = saved.eatChain;
      s.modeClock = saved.modeClock;
      seedBase = saved.seed;
      state = s;
      waiting = false;
      between = null;
      started = true; // newGame starts with the "PRONTI!" pause
    }

    const KEY_DIR = { arrowup: 'up', w: 'up', arrowdown: 'down', s: 'down', arrowleft: 'left', a: 'left', arrowright: 'right', d: 'right' };
    const unbind = AR.bindKeys(function (k, down) {
      if (down && KEY_DIR[k] && started) state.pac.want = KEY_DIR[k];
    });
    const loop = AR.startLoop(frame, draw, { view: view, active: function () { return started && !state.over; } });
    AR.help(wrap, 'Usa le quattro frecce per muoverti nel labirinto. P: pausa.');
    AR.startCard(wrap, {
      id: 'pacman',
      title: 'RACCOON-MAN',
      body: 'Mangia tutti i puntini. I fantasmi ti inseguono. Il puntino grosso li spaventa: allora puoi mangiarli.',
      summary: function (saved) { return 'Punti: ' + saved.score + '. Livello: ' + saved.level + '. Vite: ' + saved.lives + '.'; },
      onResume: resume,
      onNew: function () { startLevel(1, 0, 3); },
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
    meta: { id: 'pacman', title: 'Raccoon-man', desc: 'Mangia i puntini e scappa dai fantasmi.' },
    mount: mount,
    thumb: thumb,
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
