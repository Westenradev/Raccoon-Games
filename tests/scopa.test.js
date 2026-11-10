const test = require('node:test');
const assert = require('node:assert');
const S = require('../src/js/games/scopa.js');
const U = require('../src/js/core/util.js');

function pickRandomHuman(st, rnd) {
  const hand = st.hands[S.HUMAN];
  const card = hand[Math.floor(rnd() * hand.length)];
  const opts = S.captureOptions(st.table, card.rank);
  if (opts.length === 0) return { cardId: card.id, takeIds: [] };
  const o = opts[Math.floor(rnd() * opts.length)];
  return { cardId: card.id, takeIds: o };
}

test('scopa: 300 full matches finish with all 40 cards accounted for', () => {
  for (let seed = 1; seed <= 300; seed++) {
    const rnd = U.makeRng(seed);
    const m = S.newMatch();
    let guard = 0;
    while (!m.over && guard++ < 500) {
      const st = S.startRound(m, rnd);
      let moves = 0;
      while (!st.ended && moves++ < 200) {
        const p = st.turn;
        const c = p === S.CPU ? S.cpuChoose(st, rnd) : pickRandomHuman(st, rnd);
        const r = S.play(st, p, c.cardId, c.takeIds);
        assert.ok(r.ok, 'move failed: ' + r.reason + ' seed ' + seed);
      }
      assert.ok(st.ended, 'round did not end, seed ' + seed);
      const total = st.captured[0].length + st.captured[1].length + st.table.length;
      assert.strictEqual(total, 40, 'card count, seed ' + seed);
      S.closeRound(m, st);
    }
    assert.ok(m.over, 'match did not end, seed ' + seed);
    assert.ok(m.scores[m.winner] >= 11);
  }
});

test('scopa: capture options include every concrete card combination', () => {
  const t = [
    { id: 1, rank: 3, suit: 0 },
    { id: 2, rank: 4, suit: 0 },
    { id: 3, rank: 7, suit: 1 },
    { id: 4, rank: 7, suit: 2 },
  ];
  const o = S.captureOptions(t, 7).map((x) => x.slice().sort().join(',')).sort();
  assert.deepStrictEqual(o, ['1,2', '3', '4']);
});

test('scopa: large table is handled quickly', () => {
  const t = [];
  for (let i = 0; i < 40; i++) t.push({ id: i, rank: (i % 10) + 1, suit: 0 });
  const start = Date.now();
  for (let v = 1; v <= 10; v++) S.captureOptions(t, v);
  assert.ok(Date.now() - start < 2000);
});

test('scopa: invalid play is rejected', () => {
  const rnd = U.makeRng(5);
  const m = S.newMatch();
  const st = S.startRound(m, rnd);
  const r = S.play(st, S.CPU, st.hands[S.CPU][0].id, []);
  assert.strictEqual(r.ok, false);
});
