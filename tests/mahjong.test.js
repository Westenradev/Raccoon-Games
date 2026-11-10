const test = require('node:test');
const assert = require('node:assert');
const M = require('../src/js/games/mahjong.js');
const U = require('../src/js/core/util.js');

test('mahjong: layout has 144 tiles, 36 types x 4 copies', () => {
  for (let seed = 1; seed <= 30; seed++) {
    const tiles = M.makeLayout(U.makeRng(seed));
    assert.strictEqual(tiles.length, 144);
    const counts = new Array(36).fill(0);
    tiles.forEach((t) => counts[t.type]++);
    counts.forEach((c) => assert.strictEqual(c, 4));
  }
});

test('mahjong: generated pair order can be removed in full (solvable)', () => {
  for (let seed = 1; seed <= 60; seed++) {
    const rnd = U.makeRng(seed);
    const pairs = M.buildPairs(rnd);
    assert.ok(pairs && pairs.length === 72, 'pairs, seed ' + seed);
    // forward removal = reverse of build order
    const board = new Set();
    pairs.forEach((p) => p.forEach((s) => board.add(s.x + ',' + s.y + ',' + s.l)));
    const isFreeIn = (s) => {
      if (board.has(s.x + ',' + s.y + ',' + (s.l + 1))) return false;
      return !board.has((s.x - 1) + ',' + s.y + ',' + s.l) || !board.has((s.x + 1) + ',' + s.y + ',' + s.l);
    };
    for (let k = pairs.length - 1; k >= 0; k--) {
      const [a, b] = pairs[k];
      assert.ok(isFreeIn(a) && isFreeIn(b), 'not free at removal, seed ' + seed + ' k ' + k);
      board.delete(a.x + ',' + a.y + ',' + a.l);
      board.delete(b.x + ',' + b.y + ',' + b.l);
    }
  }
});

test('mahjong: findPair finds a pair on a fresh layout', () => {
  const tiles = M.makeLayout(U.makeRng(9));
  assert.ok(M.findPair(tiles));
});
