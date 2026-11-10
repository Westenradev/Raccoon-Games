const test = require('node:test');
const assert = require('node:assert');
const Sn = require('../src/js/games/snake.js');
const U = require('../src/js/core/util.js');

test('snake: 300 random games end, body never overlaps, food never on body', () => {
  for (let seed = 1; seed <= 300; seed++) {
    const rnd = U.makeRng(seed + 99);
    const s = Sn.newGame(seed);
    let steps = 0;
    while (s.alive && steps++ < 5000) {
      if (rnd() < 0.3) Sn.turn(s, ['up', 'down', 'left', 'right'][Math.floor(rnd() * 4)]);
      const r = Sn.stepSnake(s);
      if (r === 'dead') break;
      const keys = s.snake.map((p) => p.x + ',' + p.y);
      assert.strictEqual(new Set(keys).size, keys.length, 'self overlap, seed ' + seed);
      if (s.food) assert.ok(!keys.includes(s.food.x + ',' + s.food.y), 'food on snake');
    }
    assert.ok(!s.alive, 'game should end, seed ' + seed);
  }
});

test('snake: reverse turn is ignored', () => {
  const s = Sn.newGame(2);
  Sn.turn(s, 'left');
  assert.strictEqual(s.queue.length, 0);
});
