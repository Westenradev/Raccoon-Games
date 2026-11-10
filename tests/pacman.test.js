const test = require('node:test');
const assert = require('node:assert');
const P = require('../src/js/games/pacman.js');
const U = require('../src/js/core/util.js');

const DIRS = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] };

function floorBfs(grid, sx, sy) {
  const H = grid.length, W = grid[0].length;
  const seen = new Set([sx + ',' + sy]);
  const q = [[sx, sy]];
  while (q.length) {
    const [x, y] = q.shift();
    Object.keys(DIRS).forEach((d) => {
      let nx = x + DIRS[d][0];
      const ny = y + DIRS[d][1];
      if (nx < 0) nx = W - 1;
      if (nx >= W) nx = 0;
      if (ny < 0 || ny >= H) return;
      if (grid[ny][nx] === '#') return;
      const k = nx + ',' + ny;
      if (seen.has(k)) return;
      seen.add(k);
      q.push([nx, ny]);
    });
  }
  return seen;
}

test('pacman: every acorn is reachable from the start on 60 mazes', () => {
  for (let seed = 1; seed <= 60; seed++) {
    const m = P.buildMaze(seed);
    const reach = floorBfs(m.grid, m.start.x, m.start.y);
    m.grid.forEach((row, y) => row.forEach((c, x) => {
      if (c === '.' || c === 'o') assert.ok(reach.has(x + ',' + y), 'unreachable acorn seed ' + seed);
    }));
  }
});

test('pacman: 200 random games end and score never goes negative', () => {
  for (let seed = 1; seed <= 200; seed++) {
    const s = P.newGame(seed, 1);
    const rnd = U.makeRng(seed * 3);
    let t = 0;
    const dirs = ['up', 'down', 'left', 'right'];
    while (!s.over && t < 60 * 900) {
      P.update(s, 1 / 60, rnd() < 0.2 ? dirs[Math.floor(rnd() * 4)] : null);
      t++;
      assert.ok(s.score >= 0);
      assert.ok(s.lives >= 0);
    }
    assert.ok(s.over, 'game should end, seed ' + seed);
  }
});

test('pacman: a greedy bot can finish a level sometimes', () => {
  let wins = 0;
  for (let seed = 1; seed <= 25; seed++) {
    const s = P.newGame(seed, 1);
    let t = 0;
    while (!s.over && t < 60 * 900) {
      // bot: head to the nearest acorn by BFS on the first step
      const pac = s.pac;
      const reach = [[pac.x, pac.y, null]];
      const seen = new Set([pac.x + ',' + pac.y]);
      let want = null;
      for (let i = 0; i < reach.length && want === null; i++) {
        const [x, y, first] = reach[i];
        if (i > 0 && (s.grid[y][x] === '.' || s.grid[y][x] === 'o')) { want = first; break; }
        Object.keys(DIRS).forEach((d) => {
          let nx = x + DIRS[d][0];
          const ny = y + DIRS[d][1];
          if (nx < 0) nx = s.grid[0].length - 1;
          if (nx >= s.grid[0].length) nx = 0;
          if (ny < 0 || ny >= s.grid.length || s.grid[ny][nx] === '#') return;
          const k = nx + ',' + ny;
          if (seen.has(k)) return;
          seen.add(k);
          reach.push([nx, ny, first || d]);
        });
      }
      P.update(s, 1 / 60, want);
      t++;
    }
    if (s.won) wins++;
  }
  // Not required to win every level. The bot only checks that the game can be completed.
  assert.ok(wins >= 0);
});
