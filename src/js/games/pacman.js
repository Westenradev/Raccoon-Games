// Raccoon-man. Eat all the acorns in the maze. Cats, mice and chihuahuas chase you.
// Fish power-ups make the chasers afraid for a short time. The maze is generated, so every tile connects.
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
  const TILE = 26;
  const TUNNEL_ROW = 7;
  const DIRS = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] };
  const OPP = { up: 'down', down: 'up', left: 'right', right: 'left' };
  const GHOST_EMOJI = ['🐱', '🐭', '🐕', '🐱'];

  // Grid codes: '#' wall, '.' acorn, 'o' fish power-up, ' ' empty floor.
  function buildMaze(seed) {
    const rnd = U.makeRng(seed);
    const g = [];
    for (let y = 0; y < H; y++) g.push(new Array(W).fill('#'));
    // Recursive backtracker carves a perfect maze on odd cells.
    const stack = [[1, 1]];
    g[1][1] = ' ';
    while (stack.length) {
      const top = stack[stack.length - 1];
      const x = top[0];
      const y = top[1];
      const opts = [];
      [[2, 0], [-2, 0], [0, 2], [0, -2]].forEach(function (d) {
        const nx = x + d[0];
        const ny = y + d[1];
        if (nx > 0 && nx < W - 1 && ny > 0 && ny < H - 1 && g[ny][nx] === '#') {
          opts.push([nx, ny, d[0] / 2, d[1] / 2]);
        }
      });
      if (!opts.length) {
        stack.pop();
        continue;
      }
      const o = opts[Math.floor(rnd() * opts.length)];
      g[y + o[3]][x + o[2]] = ' ';
      g[o[1]][o[0]] = ' ';
      stack.push([o[0], o[1]]);
    }
    // Open some extra walls to make loops. Outer frame stays closed.
    for (let y = 1; y < H - 1; y++) {
      for (let x = 1; x < W - 1; x++) {
        if (g[y][x] !== '#' || (x + y) % 2 === 0 || rnd() >= 0.12) continue;
        const hOpen = g[y][x - 1] !== '#' && g[y][x + 1] !== '#';
        const vOpen = g[y - 1][x] !== '#' && g[y + 1][x] !== '#';
        if (hOpen || vOpen) g[y][x] = ' ';
      }
    }
    // Ghost house in the centre (3 x 3 open floor).
    const cx = Math.floor(W / 2);
    const cy = Math.floor(H / 2);
    for (let y = cy - 1; y <= cy + 1; y++) {
      for (let x = cx - 1; x <= cx + 1; x++) g[y][x] = ' ';
    }
    // Tunnel on the middle row, wrapping left and right.
    g[TUNNEL_ROW][0] = ' ';
    g[TUNNEL_ROW][W - 1] = ' ';
    // Acorns on the floor, except inside the house and at the start.
    const start = { x: cx, y: H - 2 };
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        if (g[y][x] !== ' ') continue;
        const inHouse = Math.abs(x - cx) <= 1 && Math.abs(y - cy) <= 1;
        if (!inHouse && !(x === start.x && y === start.y)) g[y][x] = '.';
      }
    }
    // Fish power-ups in the four corners of the floor.
    [[1, 1], [W - 2, 1], [1, H - 2], [W - 2, H - 2]].forEach(function (p) {
      if (g[p[1]][p[0]] === '.') g[p[1]][p[0]] = 'o';
    });
    return { grid: g, start: start, house: { x: cx, y: cy } };
  }

  function countAcorns(grid) {
    let n = 0;
    grid.forEach(function (row) {
      row.forEach(function (c) { if (c === '.' || c === 'o') n += 1; });
    });
    return n;
  }

  // Wraps x on the tunnel row.
  function wrapX(x) {
    if (x < 0) return W - 1;
    if (x >= W) return 0;
    return x;
  }

  function canMove(grid, x, y, dir) {
    const d = DIRS[dir];
    let nx = x + d[0];
    const ny = y + d[1];
    if (ny < 0 || ny >= H) return false;
    if (nx < 0 || nx >= W) {
      if (y !== TUNNEL_ROW) return false;
      nx = wrapX(nx);
    }
    return grid[ny][nx] !== '#';
  }

  function nextTile(x, y, dir) {
    const d = DIRS[dir];
    return { x: wrapX(x + d[0]), y: y + d[1] };
  }

  function dist(a, b) {
    return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
  }

  // Position of an entity in tile units, including progress toward its next tile.
  function continuousPos(e) {
    const d = DIRS[e.dir] || [0, 0];
    return { x: e.x + d[0] * e.p, y: e.y + d[1] * e.p };
  }

  function newGame(seed, level) {
    const m = buildMaze(seed);
    const state = {
      seed: seed,
      level: level || 1,
      grid: m.grid,
      start: m.start,
      house: m.house,
      pac: null,
      ghosts: [],
      score: 0,
      lives: 3,
      acornsLeft: countAcorns(m.grid),
      scared: 0,
      eatChain: 0,
      over: false,
      won: false,
      rnd: U.makeRng(seed * 31 + 7),
      events: [],
    };
    resetPositions(state);
    return state;
  }

  function resetPositions(state) {
    state.pac = { x: state.start.x, y: state.start.y, dir: 'left', want: 'left', p: 0 };
    state.scared = 0;
    state.eatChain = 0;
    const hx = state.house.x;
    const hy = state.house.y;
    state.ghosts = GHOST_EMOJI.map(function (emoji, i) {
      return {
        id: i,
        emoji: emoji,
        x: hx + (i % 2 ? 1 : -1),
        y: hy + (i < 2 ? -1 : 1),
        dir: 'up',
        p: 0,
        eaten: false,
        wait: 1 + i * 1.5,
      };
    });
  }

  function pacSpeed(state) {
    return 6 + state.level * 0.3;
  }

  function ghostSpeed(state, g) {
    if (g.eaten) return 9;
    if (state.scared > 0) return 3 + state.level * 0.2;
    return 4.5 + state.level * 0.5;
  }

  // Ghost choice at a tile. Never turns around unless it is stuck.
  function ghostChoice(state, g) {
    const opts = Object.keys(DIRS).filter(function (d) {
      return d !== OPP[g.dir] && canMove(state.grid, g.x, g.y, d);
    });
    if (!opts.length) return OPP[g.dir];
    const randomPick = function () { return opts[Math.floor(state.rnd() * opts.length)]; };
    if (state.scared > 0 && !g.eaten) return randomPick();
    if (!g.eaten && state.rnd() < 0.2 + state.level * 0.05) return randomPick();
    const target = g.eaten ? state.house : state.pac;
    return opts.reduce(function (best, d) {
      const t = nextTile(g.x, g.y, d);
      const b = nextTile(g.x, g.y, best);
      return dist(t, target) < dist(b, target) ? d : best;
    }, opts[0]);
  }

  // Moves an entity along dir with speed. Chooses a new direction on each arrival.
  function moveEntity(e, dir, speed, dt, chooseNext) {
    e.p += speed * dt;
    while (e.p >= 1) {
      e.p -= 1;
      const n = nextTile(e.x, e.y, dir);
      e.x = n.x;
      e.y = n.y;
      e.dir = dir;
      const next = chooseNext();
      if (next && canMove(e.grid, e.x, e.y, next)) {
        dir = next;
        e.dir = next;
      } else if (canMove(e.grid, e.x, e.y, e.dir)) {
        dir = e.dir;
      } else {
        e.p = 0;
        return;
      }
    }
  }

  // One simulation step. dirInput is 'up', 'down', 'left', 'right' or null.
  function update(state, dt, dirInput) {
    if (state.over) return;
    state.events = [];
    const pac = state.pac;
    if (dirInput) pac.want = dirInput;

    // Raccoon-man moves. At a tile he turns to the wanted direction when that is open.
    if (pac.p === 0 && canMove(state.grid, pac.x, pac.y, pac.want)) pac.dir = pac.want;
    if (pac.p > 0 || canMove(state.grid, pac.x, pac.y, pac.dir)) {
      pac.grid = state.grid;
      moveEntity(pac, pac.dir, pacSpeed(state), dt, function () {
        return canMove(state.grid, pac.x, pac.y, pac.want) ? pac.want : null;
      });
    }

    // Eat acorns and fish on the tile he stands on.
    const cell = state.grid[pac.y][pac.x];
    if (cell === '.') {
      state.grid[pac.y][pac.x] = ' ';
      state.acornsLeft -= 1;
      state.score += 10;
      state.events.push('eat');
    } else if (cell === 'o') {
      state.grid[pac.y][pac.x] = ' ';
      state.acornsLeft -= 1;
      state.score += 50;
      state.scared = 6;
      state.eatChain = 0;
      state.events.push('power');
    }
    if (state.acornsLeft === 0) {
      state.won = true;
      state.over = true;
      return;
    }
    if (state.scared > 0) state.scared -= dt;

    // Chasers.
    state.ghosts.forEach(function (g) {
      g.grid = state.grid;
      if (g.wait > 0) {
        g.wait -= dt;
        return;
      }
      if (g.p === 0) {
        const nd = ghostChoice(state, g);
        if (canMove(state.grid, g.x, g.y, nd)) g.dir = nd;
      }
      if (!canMove(state.grid, g.x, g.y, g.dir)) return;
      moveEntity(g, g.dir, ghostSpeed(state, g), dt, function () {
        return ghostChoice(state, g);
      });
      if (g.eaten && g.x === state.house.x && g.y === state.house.y) {
        g.eaten = false;
        g.p = 0;
      }
    });

    // Collisions use continuous positions, so a chaser that passes the raccoon also counts.
    const pp = continuousPos(pac);
    state.ghosts.forEach(function (g) {
      if (g.eaten || g.wait > 0) return;
      const gp = continuousPos(g);
      if (Math.abs(gp.x - pp.x) > 0.6 || Math.abs(gp.y - pp.y) > 0.6) return;
      if (state.scared > 0) {
        state.eatChain += 1;
        state.score += 200 * Math.pow(2, state.eatChain - 1);
        g.eaten = true;
        state.events.push('ghost');
      } else {
        loseLife(state);
      }
    });
  }

  function loseLife(state) {
    state.lives -= 1;
    state.events.push('die');
    if (state.lives <= 0) {
      state.over = true;
      return;
    }
    resetPositions(state);
  }

  // ---------- Browser interface ----------
  function mount(container, ctx) {
    const HUD = 34;
    const wrap = U.el('div', { class: 'arcade-stage' });
    container.appendChild(wrap);
    const view = AR.createCanvas(wrap, W * TILE, H * TILE + HUD, 'pacman');
    const g = view.ctx;
    const hiKey = 'pacman';
    let hi = U.store.get(hiKey, 0);
    let state = newGame(1, 1);
    let started = false;
    let loop = null;
    let unbind = null;
    let seedBase = Math.floor(Math.random() * 1e6);
    let pendingDir = null;

    function px(pos) {
      return { x: pos.x * TILE + TILE / 2, y: HUD + pos.y * TILE + TILE / 2 };
    }

    function draw() {
      g.fillStyle = '#05050f';
      g.fillRect(0, 0, view.canvas.width, view.canvas.height);
      for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
          const c = state.grid[y][x];
          const sx = x * TILE;
          const sy = HUD + y * TILE;
          if (c === '#') {
            g.fillStyle = '#1e3a8a';
            g.fillRect(sx + 1, sy + 1, TILE - 2, TILE - 2);
            g.strokeStyle = '#60a5fa';
            g.strokeRect(sx + 4, sy + 4, TILE - 8, TILE - 8);
          } else if (c === '.') {
            g.fillStyle = '#fde68a';
            g.beginPath();
            g.arc(sx + TILE / 2, sy + TILE / 2, 3, 0, Math.PI * 2);
            g.fill();
          } else if (c === 'o') {
            AR.emoji(g, '🐟', sx + TILE / 2, sy + TILE / 2, TILE - 6);
          }
        }
      }
      state.ghosts.forEach(function (gh) {
        const pos = px(continuousPos(gh));
        if (gh.eaten) {
          AR.text(g, '👀', pos.x, pos.y, 14, '#fff');
        } else if (state.scared > 0) {
          AR.emoji(g, '🧊', pos.x, pos.y, TILE - 4);
        } else {
          AR.emoji(g, gh.emoji, pos.x, pos.y, TILE - 2);
        }
      });
      const pp = px(continuousPos(state.pac));
      if (!state.over || state.won) AR.emoji(g, '🦝', pp.x, pp.y, TILE);
      AR.text(g, 'Punti ' + state.score, 8, HUD / 2, 14, '#fef3c7', 'left');
      AR.text(g, 'Migliore ' + Math.max(hi, state.score), view.canvas.width / 2, HUD / 2, 14, '#fef3c7');
      AR.text(g, 'Vite ' + '🦝'.repeat(Math.max(0, state.lives)), view.canvas.width - 8, HUD / 2, 14, '#fef3c7', 'right');
    }

    function frame(dt) {
      if (!started || state.over) return;
      const inp = AR.dirInput();
      let want = null;
      if (inp.left) want = 'left';
      else if (inp.right) want = 'right';
      else if (inp.up) want = 'up';
      else if (inp.down) want = 'down';
      if (pendingDir) {
        want = pendingDir;
        pendingDir = null;
      }
      update(state, dt, want);
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
        U.store.set(hiKey, hi);
      }
      if (state.won) {
        if (A) A.sfx.win();
        AR.overlay(wrap, 'Ghiande finite! 🦝🌰', 'Punti: ' + state.score + ' · Migliore: ' + hi, 'Livello successivo', nextLevel);
      } else {
        if (A) A.sfx.lose();
        AR.overlay(wrap, 'Game over 🦝', 'Punti: ' + state.score + ' · Migliore: ' + hi, 'Gioca ancora', newRun);
      }
    }

    function startLevel(level) {
      seedBase += 1;
      state = newGame(seedBase, level);
      started = true;
      loop = loop || AR.startLoop(frame, draw);
    }

    function nextLevel() {
      startLevel(state.level + 1);
    }

    function newRun() {
      startLevel(1);
    }

    function onKey(k, down) {
      if (!down) return;
      const map = { arrowup: 'up', w: 'up', arrowdown: 'down', s: 'down', arrowleft: 'left', a: 'left', arrowright: 'right', d: 'right' };
      if (map[k]) pendingDir = map[k];
    }

    unbind = AR.bindKeys(onKey);
    draw();
    AR.overlay(wrap, 'Raccoon-man 🦝', 'Mangia tutte le ghiande. Gatti, topi e chihuahua ti inseguono. Il pesce 🐟 li fa scappare.', 'Inizia', newRun);
    return {
      destroy: function () {
        if (loop) loop.stop();
        if (unbind) unbind();
      },
    };
  }

  return {
    meta: { id: 'pacman', title: 'Raccoon-man', icon: '🟡', desc: 'Mangia le ghiande. Scappa dai gatti.' },
    mount: mount,
    buildMaze: buildMaze,
    newGame: newGame,
    update: update,
    countAcorns: countAcorns,
    W: W,
    H: H,
  };
});
