const test = require('node:test');
const assert = require('node:assert');
const B = require('../src/js/games/bubbles.js');
const U = require('../src/js/core/util.js');

function connectedToTop(state) {
  const seen = new Set();
  const stack = [];
  state.grid.forEach((v, k) => {
    const [r, c] = k.split(',').map(Number);
    if (r === state.base) { seen.add(k); stack.push([r, c]); }
  });
  while (stack.length) {
    const [r, c] = stack.pop();
    const isEven = ((r % 2) + 2) % 2 === 0;
    const cand = [[r, c - 1], [r, c + 1]];
    if (isEven) cand.push([r - 1, c - 1], [r - 1, c], [r + 1, c - 1], [r + 1, c]);
    else cand.push([r - 1, c], [r - 1, c + 1], [r + 1, c], [r + 1, c + 1]);
    cand.forEach(([rr, cc]) => {
      const k = rr + ',' + cc;
      if (state.grid.has(k) && !seen.has(k)) { seen.add(k); stack.push([rr, cc]); }
    });
  }
  return seen.size === state.grid.size;
}

test('bubbles: 150 random games end, floating bubbles never survive', () => {
  for (let seed = 1; seed <= 150; seed++) {
    const s = B.newGame(seed);
    const rnd = U.makeRng(seed * 5);
    let t = 0;
    while (!s.over && t < 60 * 900) {
      if (!s.moving && rnd() < 0.5) s.angle = (rnd() * 2 - 1) * 1.2;
      if (!s.moving) B.fire(s);
      B.update(s, 1 / 60);
      t++;
      assert.ok(connectedToTop(s), 'floating bubble, seed ' + seed);
    }
    assert.ok(s.over, 'game should end, seed ' + seed);
  }
});

test('bubbles: three in a row of the same kind pop', () => {
  const s = B.newGame(3);
  s.grid = new Map();
  // Place 2 same-kind bubbles in the top row, then the third lands next to them.
  s.grid.set('0,0', 1);
  s.grid.set('0,1', 1);
  s.grid.set('0,2', 3);
  s.grid.set('0,3', 4);
  s.cur = 1;
  s.moving = { x: 36 * 2 + 18, y: 18, vx: 0, vy: 0, kind: 1 };
  B.update(s, 1 / 60);
  assert.ok(!s.grid.has('0,2') || s.grid.get('0,2') !== 3 || s.grid.size < 4, 'pop expected');
  assert.ok(s.score >= 30 || s.grid.size < 4, 'score ' + s.score);
});
