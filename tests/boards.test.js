// Sudoku, Mahjong and Dama: generators, rules and full simulated games.
const test = require('node:test');
const assert = require('node:assert');
const U = require('../src/js/core/util.js');
const Su = require('../src/js/games/sudoku.js');
const M = require('../src/js/games/mahjong.js');
const D = require('../src/js/games/dama.js');

test('sudoku: every level gives a valid grid with exactly one solution', () => {
  for (const level of Object.keys(Su.LEVELS)) {
    for (let seed = 1; seed <= 8; seed++) {
      const g = Su.generatePuzzle(level, U.makeRng(seed * 7 + 1));
      assert.ok(g.solution.every((v) => v >= 1 && v <= 9));
      assert.strictEqual(Su.conflicts(g.solution).size, 0);
      for (let u = 0; u < 9; u++) {
        const row = new Set(g.solution.slice(u * 9, u * 9 + 9));
        assert.strictEqual(row.size, 9);
      }
      g.puzzle.forEach((v, i) => { if (v) assert.strictEqual(v, g.solution[i]); });
      assert.strictEqual(Su.countSolutions(g.puzzle.slice(), 2, null), 1, level + ' seed ' + seed);
      const givens = g.puzzle.filter((v) => v).length;
      assert.ok(givens >= 17 && givens <= Su.LEVELS[level].givens + 6, level + ' has ' + givens + ' numbers');
    }
  }
});

test('sudoku: no level needs guessing, and Difficile needs more than single steps', () => {
  const grades = { facile: [], medio: [], difficile: [] };
  for (const level of Object.keys(grades)) {
    for (let seed = 1; seed <= 12; seed++) grades[level].push(Su.grade(Su.generatePuzzle(level, U.makeRng(seed * 31)).puzzle));
  }
  assert.ok(grades.facile.every((g) => g === 0), 'facile ' + grades.facile);
  assert.ok(grades.medio.every((g) => g === 0), 'medio ' + grades.medio);
  assert.ok(grades.difficile.every((g) => g <= 1), 'difficile ' + grades.difficile);
  assert.ok(grades.difficile.filter((g) => g === 1).length >= 9, 'difficile ' + grades.difficile);
  // The grader agrees with a known hard puzzle that needs more than these steps.
  const hard = '800000000003600000070090200050007000000045700000100030001000068008500010090000400'.split('').map(Number);
  assert.strictEqual(Su.grade(hard), 2);
});

test('sudoku: harder levels show fewer numbers', () => {
  const avg = (level) => {
    let n = 0;
    for (let s = 1; s <= 6; s++) n += Su.generatePuzzle(level, U.makeRng(s)).puzzle.filter((v) => v).length;
    return n / 6;
  };
  assert.ok(avg('facile') > avg('medio') && avg('medio') > avg('difficile'));
});

test('mahjong: the Turtle layout has 144 places, each tile above the table rests on tiles', () => {
  const slots = M.turtleSlots();
  assert.strictEqual(slots.length, 144);
  assert.strictEqual(new Set(slots.map((t) => t.x + ',' + t.y + ',' + t.l)).size, 144);
  const perLayer = [0, 0, 0, 0, 0];
  slots.forEach((t) => { perLayer[t.l]++; });
  assert.deepStrictEqual(perLayer, [87, 36, 16, 4, 1]);
  const over = (a, b) => Math.abs(a.x - b.x) < 2 && Math.abs(a.y - b.y) < 2;
  slots.forEach((t) => {
    // no two tiles of one layer overlap
    assert.ok(!slots.some((o) => o !== t && o.l === t.l && over(o, t)));
    if (t.l > 0) assert.ok(slots.some((o) => o.l === t.l - 1 && over(o, t)), 'a tile hangs in the air');
  });
});

test('mahjong: free tile rule (nothing on top, left or right side open)', () => {
  const a = { x: 2, y: 0, l: 0 };
  const b = { x: 4, y: 0, l: 0 };
  const c = { x: 6, y: 0, l: 0 };
  const half = { x: 8, y: 1, l: 0 }; // half a row down, still touches c
  const top = { x: 3, y: 0, l: 1 }; // lies on a and b
  assert.ok(M.isFree(a, [a, b, c]));
  assert.ok(!M.isFree(b, [a, b, c]), 'closed on both sides');
  assert.ok(M.isFree(c, [a, b, c]));
  assert.ok(!M.isFree(c, [a, b, c, half]), 'a tile half a row lower also closes the side');
  assert.ok(!M.isFree(a, [a, b, c, top]) && !M.isFree(b, [a, b, top]), 'covered tiles are blocked');
  assert.ok(M.isFree(top, [a, b, c, top]));
});

test('mahjong: a deal has 34 kinds x 4 plus 4 flowers and 4 seasons', () => {
  for (let seed = 1; seed <= 20; seed++) {
    const tiles = M.makeLayout(U.makeRng(seed));
    assert.strictEqual(tiles.length, 144);
    const byType = {};
    tiles.forEach((t) => { (byType[t.type] = byType[t.type] || []).push(t.face); });
    assert.strictEqual(Object.keys(byType).length, 36);
    Object.keys(byType).forEach((type) => {
      const faces = byType[type];
      assert.strictEqual(faces.length, 4);
      const distinct = new Set(faces).size;
      assert.strictEqual(distinct, Number(type) >= 34 ? 4 : 1, 'faces of type ' + type);
      faces.forEach((f) => assert.ok(M.faceSvg(f).indexOf('<svg') === 0));
    });
  }
});

test('mahjong: every deal can be cleared in its build order', () => {
  for (let seed = 1; seed <= 40; seed++) {
    let tiles = M.makeLayout(U.makeRng(seed));
    // tiles are stored pair by pair, in removal order
    for (let k = 0; k < 72; k++) {
      const a = tiles.find((t) => t.id === 2 * k);
      const b = tiles.find((t) => t.id === 2 * k + 1);
      assert.strictEqual(a.type, b.type);
      assert.ok(M.isFree(a, tiles) && M.isFree(b, tiles), 'pair ' + k + ' is blocked, seed ' + seed);
      tiles = tiles.filter((t) => t !== a && t !== b);
    }
    assert.strictEqual(tiles.length, 0);
  }
});

test('mahjong: greedy play with reshuffle when stuck always ends', () => {
  let cleared = 0;
  for (let seed = 1; seed <= 30; seed++) {
    const rnd = U.makeRng(seed);
    let tiles = M.makeLayout(rnd);
    let guard = 0;
    while (tiles.length && guard++ < 400) {
      const pair = M.findPair(tiles);
      if (pair) {
        assert.strictEqual(pair[0].type, pair[1].type);
        assert.notStrictEqual(pair[0], pair[1]);
        tiles = tiles.filter((t) => t !== pair[0] && t !== pair[1]);
      } else if (!M.reshuffle(tiles, rnd)) {
        break;
      } else {
        assert.ok(M.findPair(tiles), 'a reshuffle must leave a free pair');
        const counts = {};
        tiles.forEach((t) => { counts[t.type] = (counts[t.type] || 0) + 1; });
        assert.ok(Object.values(counts).every((c) => c % 2 === 0));
        // flowers and seasons keep different faces
        [34, 35].forEach((type) => {
          const faces = tiles.filter((t) => t.type === type).map((t) => t.face);
          assert.strictEqual(new Set(faces).size, faces.length);
        });
      }
    }
    if (!tiles.length) cleared++;
  }
  assert.ok(cleared >= 22, 'cleared ' + cleared + '/30');
});

const idx = (r, c) => r * 8 + c;
const empty = () => new Array(64).fill(null);
const W = { c: 'w', d: false };
const B = { c: 'b', d: false };
const WD = { c: 'w', d: true };
const BD = { c: 'b', d: true };

test('dama: start position and first moves', () => {
  const b = D.initialBoard();
  assert.strictEqual(b.filter((p) => p && p.c === 'w').length, 12);
  assert.strictEqual(b.filter((p) => p && p.c === 'b').length, 12);
  b.forEach((p, i) => { if (p) assert.ok(D.isDark(i), 'pieces stand on dark squares'); });
  assert.ok(D.isDark(idx(7, 7)) && !D.isDark(idx(7, 0)), 'Italian board: the dark corner is at the bottom right');
  assert.ok(b[idx(7, 7)] && b[idx(7, 7)].c === 'w' && b[idx(0, 0)] && b[idx(0, 0)].c === 'b');
  assert.strictEqual(D.legalMoves(b, 'w').length, 7);
  assert.strictEqual(D.legalMoves(b, 'b').length, 7);
});

test('dama: a pedina moves and captures forward only', () => {
  const b = empty();
  b[idx(4, 3)] = W;
  b[idx(5, 4)] = B; // behind the white pedina
  let moves = D.legalMoves(b, 'w');
  assert.ok(moves.every((m) => m.caps.length === 0 && (m.to >> 3) === 3), 'no backward capture');
  b[idx(3, 2)] = B;
  moves = D.legalMoves(b, 'w');
  assert.strictEqual(moves.length, 1, 'capture is mandatory');
  assert.deepStrictEqual(moves[0].caps, [idx(3, 2)]);
  assert.strictEqual(moves[0].to, idx(2, 1));
});

test('dama: a pedina cannot capture a Damone, a Damone can', () => {
  const b = empty();
  b[idx(4, 3)] = W;
  b[idx(3, 2)] = BD;
  assert.ok(D.legalMoves(b, 'w').every((m) => m.caps.length === 0));
  b[idx(4, 3)] = WD;
  const moves = D.legalMoves(b, 'w');
  assert.strictEqual(moves.length, 1);
  assert.deepStrictEqual(moves[0].caps, [idx(3, 2)]);
  // and the black Damone can capture the white pedina in front or behind it
  const b2 = empty();
  b2[idx(3, 2)] = BD;
  b2[idx(2, 3)] = W;
  assert.deepStrictEqual(D.legalMoves(b2, 'b')[0].caps, [idx(2, 3)]);
});

test('dama: a Damone moves one step in four directions and does not fly', () => {
  const b = empty();
  b[idx(4, 3)] = WD;
  const moves = D.legalMoves(b, 'w');
  assert.deepStrictEqual(moves.map((m) => m.to).sort((x, y) => x - y), [idx(3, 2), idx(3, 4), idx(5, 2), idx(5, 4)]);
  b[idx(2, 1)] = B; // two squares away: no capture
  assert.ok(D.legalMoves(b, 'w').every((m) => m.caps.length === 0));
});

test('dama: you must take the most pieces, and a Damone captures before a pedina', () => {
  const b = empty();
  b[idx(6, 1)] = W;
  b[idx(5, 2)] = B;
  b[idx(3, 4)] = B; // double jump for the pedina on (6,1)
  b[idx(6, 5)] = W;
  b[idx(5, 6)] = B; // single jump for the pedina on (6,5)
  let moves = D.legalMoves(b, 'w');
  assert.strictEqual(moves.length, 1);
  assert.strictEqual(moves[0].caps.length, 2);
  assert.strictEqual(moves[0].to, idx(2, 5));

  const c = empty();
  c[idx(6, 1)] = W;
  c[idx(5, 2)] = B;
  c[idx(6, 5)] = WD;
  c[idx(5, 6)] = B;
  moves = D.legalMoves(c, 'w');
  assert.strictEqual(moves.length, 1);
  assert.strictEqual(moves[0].from, idx(6, 5), 'the Damone must capture');
});

test('dama: a pedina on the last row becomes a Damone', () => {
  const b = empty();
  b[idx(1, 2)] = W;
  b[idx(6, 5)] = B;
  const mv = D.legalMoves(b, 'w')[0];
  const nb = D.applyMove(b, mv);
  assert.strictEqual(nb[mv.to].d, true);
  const mb = D.legalMoves(nb, 'b')[0];
  assert.strictEqual(D.applyMove(nb, mb)[mb.to].d, true);
  assert.strictEqual(b[idx(1, 2)].d, false, 'the old board is not changed');
});

function playGame(seed, whiteLevel, blackLevel) {
  const rnd = U.makeRng(seed);
  let b = D.initialBoard();
  let turn = 'w';
  let quiet = 0;
  for (let ply = 0; ply < 300; ply++) {
    const moves = D.legalMoves(b, turn);
    if (!moves.length) return turn === 'w' ? 'b' : 'w';
    const level = turn === 'w' ? whiteLevel : blackLevel;
    const mv = level ? D.cpuMove(b, turn, level, rnd) : moves[Math.floor(rnd() * moves.length)];
    assert.ok(moves.some((m) => m.from === mv.from && m.to === mv.to), 'cpu move must be legal');
    const attacker = b[mv.from];
    mv.caps.forEach((x) => {
      assert.ok(b[x] && b[x].c !== turn);
      if (b[x].d) assert.ok(attacker.d, 'a pedina captured a Damone');
    });
    quiet = mv.caps.length || !attacker.d ? 0 : quiet + 1;
    b = D.applyMove(b, mv);
    turn = turn === 'w' ? 'b' : 'w';
    if (quiet >= 80) return 'draw';
  }
  return 'draw';
}

test('dama: 300 random games follow the rules and end', () => {
  const results = { w: 0, b: 0, draw: 0 };
  for (let seed = 1; seed <= 300; seed++) results[playGame(seed, null, null)]++;
  assert.ok(results.w + results.b > 200, JSON.stringify(results));
});

test('dama: each level beats a random player, stronger levels more often', () => {
  const score = (level, n) => {
    let wins = 0;
    for (let seed = 1; seed <= n; seed++) if (playGame(seed, null, level) === 'b') wins++;
    return wins / n;
  };
  const facile = score('facile', 30);
  const medio = score('medio', 30);
  assert.ok(facile >= 0.5, 'facile wins ' + facile);
  assert.ok(medio >= 0.85, 'medio wins ' + medio);
  assert.ok(medio >= facile);
});

test('dama: difficile beats medio and answers fast', () => {
  let hard = 0;
  let slowest = 0;
  const rnd = U.makeRng(7);
  for (let seed = 1; seed <= 6; seed++) {
    const r = playGame(seed, seed % 2 ? 'medio' : 'difficile', seed % 2 ? 'difficile' : 'medio');
    if ((seed % 2 && r === 'b') || (!(seed % 2) && r === 'w')) hard++;
  }
  let b = D.initialBoard();
  let turn = 'w';
  for (let ply = 0; ply < 30; ply++) {
    const t0 = Date.now();
    const mv = D.cpuMove(b, turn, 'difficile', rnd);
    slowest = Math.max(slowest, Date.now() - t0);
    if (!mv) break;
    b = D.applyMove(b, mv);
    turn = turn === 'w' ? 'b' : 'w';
  }
  assert.ok(slowest < 1500, 'slowest move took ' + slowest + ' ms');
  assert.ok(hard >= 3, 'difficile won ' + hard + ' of 6 against medio');
});
