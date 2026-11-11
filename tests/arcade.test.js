// Tetris, Snake, Raccoon Defender, Raccoon-man and Bolle: rules, random play and playing bots.
const test = require('node:test');
const assert = require('node:assert');
const U = require('../src/js/core/util.js');
const T = require('../src/js/games/tetris.js');
const Sn = require('../src/js/games/snake.js');
const I = require('../src/js/games/invaders.js');
const P = require('../src/js/games/pacman.js');
const Bu = require('../src/js/games/bubbles.js');

const DT = 1 / 60;

// ---------------- Tetris ----------------
test('tetris: 200 random games end, the piece never overlaps the board', () => {
  for (let seed = 1; seed <= 200; seed++) {
    const rnd = U.makeRng(seed * 13);
    const s = T.newGame(seed);
    let steps = 0;
    while (!s.over && steps++ < 6000) {
      const r = rnd();
      if (r < 0.25) T.move(s, -1);
      else if (r < 0.5) T.move(s, 1);
      else if (r < 0.6) T.rotate(s);
      else if (r < 0.75) T.softDrop(s);
      else if (r < 0.9) T.hardDrop(s);
      else T.tick(s, 0.5);
      assert.strictEqual(s.board.length, T.H);
      for (const row of s.board) {
        assert.strictEqual(row.length, T.W);
        assert.ok(!row.every((v) => v !== null), 'a full row was not cleared');
      }
      if (s.cur) assert.ok(!T.collides(s.board, s.cur.type, s.cur.rot, s.cur.x, s.cur.y), 'overlap, seed ' + seed);
    }
    assert.ok(s.over, 'random play should end, seed ' + seed);
  }
});

test('tetris: full rows are cleared and scored (1 row = 100, 4 rows = 800)', () => {
  const s = T.newGame(4);
  for (let x = 2; x < T.W; x++) s.board[T.H - 1][x] = 0;
  s.cur = { type: 1, rot: 0, x: 0, y: 0 }; // O piece falls in columns 0-1
  T.hardDrop(s);
  assert.strictEqual(s.lines, 1);
  assert.ok(s.score >= 100);
  assert.strictEqual(s.board[T.H - 1][0], 1, 'the top half of the O piece moved down');
  assert.strictEqual(s.board[T.H - 1][5], null);

  const t = T.newGame(5);
  for (let y = T.H - 4; y < T.H; y++) for (let x = 1; x < T.W; x++) t.board[y][x] = 2;
  t.cur = { type: 0, rot: 1, x: -2, y: 0 }; // vertical I piece in column 0
  assert.ok(!T.collides(t.board, 0, 1, -2, 0));
  T.hardDrop(t);
  assert.strictEqual(t.lines, 4);
  assert.ok(t.score >= 800);
  assert.ok(t.board.every((row) => row.every((v) => v === null)));
});

// Placement bot: tries every rotation and column, and scores the board that results
// (rows cleared, holes, total height, bumps).
function tetrisBotMove(s) {
  let best = null;
  for (let rot = 0; rot < 4; rot++) {
    for (let x = -2; x < T.W; x++) {
      if (T.collides(s.board, s.cur.type, rot, x, s.cur.y)) continue;
      let y = s.cur.y;
      while (!T.collides(s.board, s.cur.type, rot, x, y + 1)) y++;
      let b = s.board.map((r) => r.slice());
      T.cells(s.cur.type, rot, x, y).forEach((p) => { if (p.y >= 0) b[p.y][p.x] = 9; });
      const before = b.length;
      b = b.filter((r) => !r.every((v) => v !== null));
      const lines = before - b.length;
      while (b.length < T.H) b.unshift(new Array(T.W).fill(null));
      let holes = 0;
      let height = 0;
      let bumps = 0;
      const tops = [];
      for (let cx = 0; cx < T.W; cx++) {
        let top = 0;
        for (let cy = 0; cy < T.H; cy++) {
          if (b[cy][cx] !== null) {
            if (!top) top = T.H - cy;
          } else if (top) holes++;
        }
        tops.push(top);
        height += top;
      }
      for (let i = 1; i < tops.length; i++) bumps += Math.abs(tops[i] - tops[i - 1]);
      const score = 7.6 * lines - 3.6 * holes - 5.1 * height / 10 - 1.8 * bumps;
      if (!best || score > best.score) best = { score, rot, x };
    }
  }
  return best;
}

test('tetris: a simple bot clears many rows using only move, rotate and drop', () => {
  let total = 0;
  for (let seed = 1; seed <= 5; seed++) {
    const s = T.newGame(seed);
    let pieces = 0;
    while (!s.over && pieces++ < 400) {
      const m = tetrisBotMove(s);
      if (!m) break;
      let guard = 0;
      while (s.cur.rot !== m.rot && guard++ < 4) T.rotate(s);
      guard = 0;
      while (s.cur.x !== m.x && guard++ < 12) T.move(s, m.x > s.cur.x ? 1 : -1);
      T.hardDrop(s);
    }
    total += s.lines;
    assert.strictEqual(s.level, Math.floor(s.lines / 10) + 1);
  }
  assert.ok(total >= 400, 'bot cleared ' + total + ' rows in 5 games');
});

// ---------------- Snake ----------------
test('snake: 300 random games end, the body never overlaps, food is never on the body', () => {
  for (let seed = 1; seed <= 300; seed++) {
    const rnd = U.makeRng(seed + 99);
    const s = Sn.newGame(seed);
    let steps = 0;
    while (s.alive && steps++ < 5000) {
      if (rnd() < 0.3) Sn.turn(s, ['up', 'down', 'left', 'right'][Math.floor(rnd() * 4)]);
      if (Sn.stepSnake(s) === 'dead') break;
      const keys = s.snake.map((p) => p.x + ',' + p.y);
      assert.strictEqual(new Set(keys).size, keys.length);
      assert.ok(!keys.includes(s.food.x + ',' + s.food.y));
    }
    assert.ok(!s.alive);
  }
});

test('snake: a reverse turn is ignored, eating makes the snake longer', () => {
  const s = Sn.newGame(2);
  Sn.turn(s, 'left');
  assert.strictEqual(s.queue.length, 0);
  s.food = { x: s.snake[0].x + 1, y: s.snake[0].y };
  assert.strictEqual(Sn.stepSnake(s), 'ate');
  assert.strictEqual(s.snake.length, 4);
  assert.strictEqual(s.score, 10);
  // Quick double turn: both turns are kept in order.
  Sn.turn(s, 'up');
  Sn.turn(s, 'left');
  Sn.stepSnake(s);
  Sn.stepSnake(s);
  assert.strictEqual(s.dir, 'left');
  assert.ok(s.alive);
});

test('snake: a path-finding bot eats many fish', () => {
  const dirs = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] };
  let total = 0;
  for (let seed = 1; seed <= 10; seed++) {
    const s = Sn.newGame(seed);
    let steps = 0;
    while (s.alive && steps++ < 4000) {
      const body = new Set(s.snake.slice(0, -1).map((p) => p.x + ',' + p.y));
      const head = s.snake[0];
      const queue = [[head.x, head.y, null]];
      const seen = new Set([head.x + ',' + head.y]);
      let want = null;
      let fallback = null;
      for (let i = 0; i < queue.length && !want; i++) {
        const [x, y, first] = queue[i];
        for (const d of Object.keys(dirs)) {
          const nx = x + dirs[d][0];
          const ny = y + dirs[d][1];
          const k = nx + ',' + ny;
          if (nx < 0 || ny < 0 || nx >= Sn.COLS || ny >= Sn.ROWS || body.has(k) || seen.has(k)) continue;
          seen.add(k);
          if (!fallback) fallback = first || d;
          if (nx === s.food.x && ny === s.food.y) { want = first || d; break; }
          queue.push([nx, ny, first || d]);
        }
      }
      Sn.turn(s, want || fallback || s.dir);
      Sn.stepSnake(s);
    }
    total += s.eaten;
  }
  assert.ok(total >= 200, 'bot ate ' + total + ' fish in 10 games');
});

// ---------------- Raccoon Defender ----------------
test('invaders: 60 games with random input end and stay inside the limits', () => {
  for (let seed = 1; seed <= 60; seed++) {
    const rnd = U.makeRng(seed);
    const s = I.newGame(seed);
    let t = 0;
    while (!s.over && t++ < 60 * 900) {
      I.update(s, DT, { left: rnd() < 0.4, right: rnd() < 0.4, fire: rnd() < 0.5 });
      assert.ok(s.lives >= 0 && s.pBullets.length <= 2);
      assert.ok(s.px >= 0 && s.px <= I.W);
    }
    assert.ok(s.over, 'seed ' + seed);
  }
});

test('invaders: a bot that aims and dodges clears the first wave', () => {
  let reached = 0;
  for (let seed = 1; seed <= 10; seed++) {
    const s = I.newGame(seed);
    let t = 0;
    while (!s.over && s.wave < 2 && t++ < 60 * 300) {
      // Aim under the nearest column that still has an invader.
      let target = s.px;
      let bestD = Infinity;
      s.invaders.forEach((i) => {
        if (!i.alive) return;
        const x = s.fx + i.col * 40;
        if (Math.abs(x - s.px) < bestD) { bestD = Math.abs(x - s.px); target = x; }
      });
      let left = target < s.px - 3;
      let right = target > s.px + 3;
      // Step aside when a bone falls toward the raccoon.
      const bone = s.eBullets.find((b) => Math.abs(b.x - s.px) < 30 && b.y > 330 && b.y < 570);
      if (bone) {
        left = bone.x >= s.px ? s.px > 40 : s.px > I.W - 40;
        right = !left;
      }
      I.update(s, DT, { left, right, fire: true });
    }
    if (s.wave >= 2) reached++;
  }
  assert.ok(reached >= 7, 'bot reached wave 2 in ' + reached + '/10 games');
});

// ---------------- Raccoon-man ----------------
test('pacman: mazes have no dead ends and every acorn can be reached', () => {
  for (let seed = 1; seed <= 80; seed++) {
    const m = P.buildMaze(seed);
    const dist = P.distanceMap(m.grid, m.start.x, m.start.y);
    assert.notStrictEqual(m.grid[m.start.y][m.start.x], '#', 'start tile is floor');
    let acorns = 0;
    for (let y = 0; y < P.H; y++) {
      for (let x = 0; x < P.W; x++) {
        const c = m.grid[y][x];
        if (c === '#') continue;
        assert.ok(dist[y][x] < Infinity, 'tile cut off, seed ' + seed);
        if (c === '.' || c === 'o') acorns++;
        const exits = ['up', 'down', 'left', 'right'].filter((d) => P.canMove(m.grid, x, y, d)).length;
        assert.ok(exits >= 2, 'dead end at ' + x + ',' + y + ' seed ' + seed);
      }
    }
    assert.ok(acorns > 100);
    assert.strictEqual(m.grid.flat().filter((c) => c === 'o').length, 4);
  }
});

test('pacman: the tunnel wraps from one side to the other', () => {
  const m = P.buildMaze(3);
  assert.ok(P.canMove(m.grid, 0, 7, 'left'));
  assert.deepStrictEqual(P.nextTile(0, 7, 'left'), { x: P.W - 1, y: 7 });
  assert.ok(!P.canMove(m.grid, 1, 1, 'up'));
});

test('pacman: 100 random games end with score and lives in range', () => {
  for (let seed = 1; seed <= 100; seed++) {
    const s = P.newGame(seed, 1);
    const rnd = U.makeRng(seed * 3);
    const dirs = ['up', 'down', 'left', 'right'];
    let t = 0;
    while (!s.over && t++ < 60 * 600) {
      P.update(s, DT, rnd() < 0.1 ? dirs[Math.floor(rnd() * 4)] : null);
      assert.ok(s.lives >= 0 && s.lives <= 3 && s.score >= 0);
      assert.notStrictEqual(s.grid[s.pac.y][s.pac.x], '#', 'raccoon inside a wall');
      s.ghosts.forEach((g) => assert.notStrictEqual(s.grid[g.y][g.x], '#', 'chaser inside a wall'));
    }
    assert.ok(s.over, 'seed ' + seed);
  }
});

// Bot: goes to the nearest acorn and keeps 3 tiles away from a dangerous chaser.
// It plans from the tile the raccoon reaches next, because turns happen on a tile.
function pacBot(s) {
  const names = ['up', 'left', 'down', 'right'];
  const pac = s.pac;
  const from = pac.moving ? P.nextTile(pac.x, pac.y, pac.dir) : { x: pac.x, y: pac.y };
  const maps = s.ghosts.filter((g) => !g.eaten).map((g) => P.distanceMap(s.grid, g.x, g.y));
  const near = (x, y) => maps.reduce((m, d) => Math.min(m, d[y][x]), Infinity);
  const hunted = s.scared <= 1;
  if (hunted && pac.moving && near(from.x, from.y) <= 1) return { up: 'down', down: 'up', left: 'right', right: 'left' }[pac.dir];
  const queue = [[from.x, from.y, null]];
  const seen = new Set([from.x + ',' + from.y]);
  for (let i = 0; i < queue.length; i++) {
    const [x, y, first] = queue[i];
    if (i > 0 && (s.grid[y][x] === '.' || s.grid[y][x] === 'o')) return first;
    for (const d of names) {
      if (!P.canMove(s.grid, x, y, d)) continue;
      const n = P.nextTile(x, y, d);
      const k = n.x + ',' + n.y;
      if (seen.has(k) || (hunted && near(n.x, n.y) <= 3)) continue;
      seen.add(k);
      queue.push([n.x, n.y, first || d]);
    }
  }
  // No safe acorn: go to the neighbour tile that is farthest from the chasers.
  let want = null;
  let bestD = -1;
  names.forEach((d) => {
    if (!P.canMove(s.grid, from.x, from.y, d)) return;
    const n = P.nextTile(from.x, from.y, d);
    if (near(n.x, n.y) > bestD) { bestD = near(n.x, n.y); want = d; }
  });
  return want;
}

test('pacman: a careful bot finishes most games of level 1, score and lives carry on', () => {
  let wins = 0;
  let caught = 0;
  for (let seed = 1; seed <= 10; seed++) {
    const s = P.newGame(seed, 1);
    assert.strictEqual(s.ghosts.length, 3);
    let t = 0;
    while (!s.over && t++ < 60 * 400) {
      P.update(s, DT, pacBot(s));
      if (s.events.includes('ghost')) caught++;
    }
    if (s.won) {
      wins++;
      assert.strictEqual(s.acornsLeft, 0);
      const next = P.newGame(seed + 100, 2, s.score, s.lives);
      assert.strictEqual(next.score, s.score);
      assert.strictEqual(next.lives, s.lives);
    }
  }
  assert.ok(wins >= 6, 'bot finished ' + wins + '/10 games');
  assert.ok(caught >= 1, 'the bot should catch a scared chaser at least once');
  assert.strictEqual(P.newGame(1, 3).ghosts.length, 4, 'a fourth chaser comes at level 3');
});

test('pacman: a caught chaser goes home and comes back', () => {
  const s = P.newGame(5, 1);
  s.freeze = 0;
  const g = s.ghosts[0];
  g.wait = 0;
  g.eaten = true;
  g.x = 1; g.y = 1; g.moving = false;
  s.ghosts.slice(1).forEach((o) => { o.wait = 999; });
  s.pac.x = P.W - 2; s.pac.y = P.H - 2;
  let t = 0;
  while (g.eaten && t++ < 60 * 20) P.update(s, DT, null);
  assert.ok(!g.eaten, 'the chaser reached home');
  assert.deepStrictEqual([g.x, g.y], [s.house.x, s.house.y]);
});

// ---------------- Bolle Procioni ----------------
function linkedToCeiling(s) {
  const seen = new Set();
  const stack = [];
  s.grid.forEach((v, k) => {
    const [r, c] = k.split(',').map(Number);
    if (r === s.base) { seen.add(k); stack.push([r, c]); }
  });
  while (stack.length) {
    const [r, c] = stack.pop();
    Bu.neighbours(r, c, s.base).forEach(([rr, cc]) => {
      const k = rr + ',' + cc;
      if (s.grid.has(k) && !seen.has(k)) { seen.add(k); stack.push([rr, cc]); }
    });
  }
  return seen.size === s.grid.size;
}

test('bubbles: 100 random games end, no bubble floats, none sits above the ceiling', () => {
  for (let seed = 1; seed <= 100; seed++) {
    const s = Bu.newGame(seed, 1 + (seed % 3));
    const rnd = U.makeRng(seed * 5);
    let t = 0;
    while (!s.over && t++ < 60 * 1200) {
      if (!s.moving) {
        s.angle = (rnd() * 2 - 1) * Bu.MAX_ANGLE;
        Bu.fire(s);
      }
      Bu.update(s, DT);
      if (!s.moving) {
        assert.ok(linkedToCeiling(s), 'floating bubble, seed ' + seed);
        s.grid.forEach((v, k) => {
          const [r, c] = k.split(',').map(Number);
          assert.ok(r >= s.base, 'bubble above the ceiling');
          const p = Bu.posOf(r, c, s.base);
          assert.ok(p.x >= 18 && p.x <= Bu.WIDTH - 18, 'bubble outside the field');
        });
        if (s.grid.size) {
          const kinds = new Set(s.grid.values());
          assert.ok(kinds.has(s.cur), 'the next shot must be a kind that is on the board');
        }
      }
    }
    assert.ok(s.over, 'seed ' + seed);
  }
});

test('bubbles: three of a kind pop and the hanging bubbles fall', () => {
  const s = Bu.newGame(3, 1);
  s.grid = new Map([['0,0', 1], ['0,1', 1], ['1,0', 2], ['1,1', 2], ['0,5', 3]]);
  s.rowsLeft = 0;
  // A bubble of kind 1 lands on cell 0,2: 0,0 + 0,1 + 0,2 pop, the two below fall.
  s.moving = { x: Bu.posOf(0, 2, 0).x, y: Bu.posOf(0, 2, 0).y + 6, vx: 0, vy: -100, kind: 1 };
  let t = 0;
  while (s.moving && t++ < 600) Bu.update(s, DT);
  assert.deepStrictEqual(Array.from(s.grid.keys()), ['0,5']);
  assert.strictEqual(s.score, 3 * 10 + 2 * 20);
  assert.strictEqual(s.gone.length, 5);
});

// Bot: tries many angles on a copy of the game and keeps the one that pops the most.
function cloneBubbles(s) {
  const c = Object.assign({}, s);
  c.grid = new Map(s.grid);
  c.rnd = () => 0.5;
  c.events = [];
  c.gone = [];
  c.moving = null;
  c.rowsLeft = 0;
  return c;
}

test('bubbles: an aiming bot clears level 1', () => {
  let wins = 0;
  for (let seed = 1; seed <= 6; seed++) {
    const s = Bu.newGame(seed, 1);
    let shots = 0;
    while (!s.over && shots++ < 300) {
      let best = { gain: -Infinity, angle: 0 };
      for (let a = -1.3; a <= 1.3; a += 0.05) {
        const c = cloneBubbles(s);
        c.angle = a;
        Bu.fire(c);
        let t = 0;
        while (c.moving && t++ < 600) Bu.update(c, DT);
        let gain = (s.grid.size + 1 - c.grid.size) * 10;
        if (gain === 0) {
          // Nothing popped: prefer a place next to bubbles of the same kind.
          c.grid.forEach((kind, k) => {
            if (s.grid.has(k)) return;
            const [r, col] = k.split(',').map(Number);
            Bu.neighbours(r, col, c.base).forEach(([rr, cc]) => { if (c.grid.get(rr + ',' + cc) === kind) gain += 1; });
          });
        }
        if (gain > best.gain) best = { gain, angle: a };
      }
      s.angle = best.angle;
      Bu.fire(s);
      let t = 0;
      while (s.moving && t++ < 600) Bu.update(s, DT);
    }
    if (s.won) wins++;
  }
  assert.ok(wins >= 4, 'bot cleared level 1 in ' + wins + '/6 games');
});

test('pacman: a chaser that was caught cannot be caught again before the next big dot', () => {
  const s = P.newGame(5, 1);
  s.freeze = 0;
  s.scared = 7;
  // Stand on the home tile, where caught chasers come back.
  s.pac.x = s.house.x; s.pac.y = s.house.y; s.pac.moving = false; s.pac.want = null;
  s.ghosts.forEach((g) => { g.wait = 0; });
  const start = s.score;
  let catches = 0;
  for (let t = 0; t < 60 * 7 && !s.over; t++) {
    P.update(s, DT, null);
    if (s.events.includes('ghost')) catches++;
  }
  assert.ok(catches <= s.ghosts.length, 'each chaser at most once: ' + catches);
  assert.ok(s.score - start <= 200 + 400 + 800 + 1600, 'points from chasers: ' + (s.score - start));
});
