const test = require('node:test');
const assert = require('node:assert');
const T = require('../src/js/games/tetris.js');
const U = require('../src/js/core/util.js');

test('tetris: 300 random games end, board stays valid', () => {
  for (let seed = 1; seed <= 300; seed++) {
    const rnd = U.makeRng(seed * 13);
    const s = T.newGame(seed);
    let steps = 0;
    while (!s.over && steps++ < 5000) {
      const r = rnd();
      if (r < 0.25) T.move(s, -1);
      else if (r < 0.5) T.move(s, 1);
      else if (r < 0.6) T.rotate(s);
      else if (r < 0.75) T.softDrop(s);
      else if (r < 0.9) T.hardDrop(s);
      else T.tick(s, 0.5);
      // board cells only hold valid types
      for (const row of s.board) {
        assert.strictEqual(row.length, T.W);
        row.forEach((v) => assert.ok(v === null || (v >= 0 && v <= 6)));
      }
      if (s.cur) assert.ok(!T.collides(s.board, s.cur.type, s.cur.rot, s.cur.x, s.cur.y), 'piece overlaps, seed ' + seed);
    }
    assert.ok(s.over, 'random game should end, seed ' + seed);
    assert.ok(s.score >= 0);
  }
});

test('tetris: clearing a full row adds score and lines', () => {
  const s = T.newGame(4);
  // fill bottom row except columns 0..1 (I piece vertical isn\'t needed; use O piece at bottom-left)
  for (let x = 2; x < T.W; x++) s.board[T.H - 1][x] = 0;
  s.cur = { type: 1, rot: 0, x: 0, y: T.H - 2 }; // O piece fills cols 0-1 of last two rows
  const cleared = T.hardDrop(s) && s.lines;
  assert.ok(s.lines >= 1, 'lines ' + s.lines);
  assert.ok(s.score >= 100);
  void cleared;
});
