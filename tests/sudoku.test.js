const test = require('node:test');
const assert = require('node:assert');
const Su = require('../src/js/games/sudoku.js');
const U = require('../src/js/core/util.js');

test('sudoku: solutions are valid and puzzles have unique solutions', () => {
  for (const level of ['facile', 'medio', 'difficile']) {
    for (let seed = 1; seed <= 6; seed++) {
      const g = Su.generatePuzzle(level, U.makeRng(seed * 7 + 1));
      // solution valid: no conflicts and all filled
      assert.ok(g.solution.every((v) => v >= 1 && v <= 9));
      assert.strictEqual(Su.conflicts(g.solution).size, 0);
      // puzzle keeps given numbers that match solution
      g.puzzle.forEach((v, i) => { if (v) assert.strictEqual(v, g.solution[i]); });
      // unique solution
      const copy = g.puzzle.slice();
      assert.strictEqual(Su.countSolutions(copy, 2, null), 1, level + ' seed ' + seed);
      const givens = g.puzzle.filter((v) => v).length;
      assert.ok(givens <= Su.LEVELS[level].givens + 1, 'givens ' + givens);
    }
  }
});
