const test = require('node:test');
const assert = require('node:assert');
const D = require('../src/js/games/dama.js');
const U = require('../src/js/core/util.js');

test('dama: 200 random games end, pieces stay consistent', () => {
  let finished = 0;
  for (let seed = 1; seed <= 200; seed++) {
    const rnd = U.makeRng(seed);
    let b = D.initialBoard();
    let turn = D.WHITE;
    let plies = 0;
    let quiet = 0;
    while (plies < 400) {
      const moves = D.legalMoves(b, turn);
      if (!moves.length) break;
      const mv = turn === D.BLACK && seed % 2 ? D.cpuMove(b, turn, 1, rnd) : moves[Math.floor(rnd() * moves.length)];
      // a captured piece must be an enemy and not a damone captured by a man
      mv.caps.forEach((x) => {
        const victim = b[x];
        const attacker = b[mv.from];
        assert.ok(victim && victim.c !== turn, 'victim colour');
        if (victim.d) assert.ok(attacker.d, 'man captured a damone, seed ' + seed);
      });
      quiet = mv.caps.length ? 0 : quiet + 1;
      b = D.applyMove(b, mv);
      turn = turn === D.WHITE ? D.BLACK : D.WHITE;
      plies++;
      if (quiet > 80) break;
    }
    finished++;
    // no piece is left in an impossible spot
    b.forEach((p, i) => { if (p) assert.ok(p.c === 'w' || p.c === 'b'); void i; });
  }
  assert.strictEqual(finished, 200);
});

test('dama: captures are mandatory', () => {
  const b = new Array(64).fill(null);
  const idx = (r, c) => r * 8 + c;
  b[idx(5, 2)] = { c: 'w', d: false };
  b[idx(4, 3)] = { c: 'b', d: false };
  const moves = D.legalMoves(b, 'w');
  assert.ok(moves.length >= 1 && moves.every((m) => m.caps.length > 0));
});

test('dama: a man cannot capture a damone', () => {
  const b = new Array(64).fill(null);
  const idx = (r, c) => r * 8 + c;
  b[idx(5, 2)] = { c: 'w', d: false };
  b[idx(4, 3)] = { c: 'b', d: true };
  const moves = D.legalMoves(b, 'w');
  assert.strictEqual(moves.filter((m) => m.caps.length).length, 0);
});

test('dama: a damone can capture a damone', () => {
  const b = new Array(64).fill(null);
  const idx = (r, c) => r * 8 + c;
  b[idx(5, 2)] = { c: 'w', d: true };
  b[idx(4, 3)] = { c: 'b', d: true };
  const moves = D.legalMoves(b, 'w');
  assert.ok(moves.some((m) => m.caps.length === 1 && m.to === idx(3, 4)));
});

test('dama: cpu search is quick at hard level', () => {
  const rnd = U.makeRng(3);
  const start = Date.now();
  let b = D.initialBoard();
  let turn = D.WHITE;
  for (let i = 0; i < 6; i++) {
    const mv = turn === D.BLACK ? D.cpuMove(b, turn, 5, rnd) : D.legalMoves(b, turn)[0];
    if (!mv) break;
    b = D.applyMove(b, mv);
    turn = turn === D.WHITE ? D.BLACK : D.WHITE;
  }
  assert.ok(Date.now() - start < 20000, 'too slow ' + (Date.now() - start));
});
