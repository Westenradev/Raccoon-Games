const test = require('node:test');
const assert = require('node:assert');
const I = require('../src/js/games/invaders.js');

test('invaders: 100 games with random input end cleanly', () => {
  for (let seed = 1; seed <= 100; seed++) {
    const s = I.newGame(seed);
    let t = 0;
    while (!s.over && t < 60 * 900) {
      const input = { left: Math.random() < 0.4, right: Math.random() < 0.4, fire: Math.random() < 0.5 };
      I.update(s, 1 / 60, input);
      t++;
      assert.ok(s.lives >= 0);
      assert.ok(s.pBullets.length <= 2);
      assert.ok(s.px >= 0 && s.px <= I.W);
    }
    assert.ok(s.over, 'game should end, seed ' + seed);
  }
});

test('invaders: a simple aiming bot can clear a wave and advance', () => {
  let advanced = 0;
  for (let seed = 1; seed <= 20; seed++) {
    const s = I.newGame(seed);
    let t = 0;
    while (!s.over && t < 60 * 600 && s.wave < 2) {
      // move under the leftmost alive column, fire constantly
      const alive = s.invaders.filter((i) => i.alive);
      let target = s.px;
      if (alive.length) {
        const col = alive[0];
        target = s.fx + col.col * 40;
      }
      const input = { left: target < s.px - 4, right: target > s.px + 4, fire: true };
      I.update(s, 1 / 60, input);
      t++;
    }
    if (s.wave >= 2) advanced++;
  }
  assert.ok(advanced >= 1, 'bot should clear at least one wave');
});
