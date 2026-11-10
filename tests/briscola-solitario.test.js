const test = require('node:test');
const assert = require('node:assert');
const B = require('../src/js/games/briscola.js');
const S = require('../src/js/games/solitario.js');
const U = require('../src/js/core/util.js');

test('briscola: 1000 hands end with 120 points and 40 cards', () => {
  for (let seed = 1; seed <= 1000; seed++) {
    const rnd = U.makeRng(seed);
    const h = B.newHand(rnd);
    let guard = 0;
    while (!h.ended && guard++ < 100) {
      const player = h.turn;
      let cardId;
      if (player === B.CPU) cardId = B.cpuChoose(h, rnd);
      else cardId = h.hands[B.HUMAN][Math.floor(rnd() * h.hands[B.HUMAN].length)].id;
      const r = B.play(h, player, cardId);
      assert.ok(r.ok, 'play failed: ' + r.reason + ' seed ' + seed);
    }
    assert.ok(h.ended, 'hand did not end, seed ' + seed);
    const s = B.score(h);
    assert.strictEqual(s.points[0] + s.points[1], 120, 'points, seed ' + seed);
    assert.strictEqual(h.pile[0].length + h.pile[1].length, 40, 'cards, seed ' + seed);
  }
});

test('briscola: trump beats any non-trump card', () => {
  const trump = 2;
  const ace = { id: 1, rank: 1, suit: 0 };
  const lowTrump = { id: 2, rank: 2, suit: trump };
  assert.strictEqual(B.trickWinner(ace, lowTrump, trump), 1);
  const aceTrump = { id: 3, rank: 1, suit: trump };
  const threeTrump = { id: 4, rank: 3, suit: trump };
  assert.strictEqual(B.trickWinner(threeTrump, aceTrump, trump), 1);
});

test('solitario: 500 random games keep 40 cards and never break', () => {
  for (let seed = 1; seed <= 500; seed++) {
    const rnd = U.makeRng(seed);
    const g = S.newGame(rnd);
    const count = () =>
      g.stock.length + g.waste.length + g.foundation.reduce((s, p) => s + p.length, 0) +
      g.tableau.reduce((s, c) => s + c.length, 0);
    assert.strictEqual(count(), 40);
    for (let step = 0; step < 1500; step++) {
      const roll = rnd();
      if (roll < 0.3) {
        S.drawStock(g);
      } else {
        const f = S.findFoundationMove(g);
        if (f && rnd() < 0.7) {
          S.move(g, f.src, f.dst);
        } else {
          // random tableau-to-tableau attempt
          const from = Math.floor(rnd() * 7);
          const to = Math.floor(rnd() * 7);
          const col = g.tableau[from];
          if (col.length) {
            const idx = Math.floor(rnd() * col.length);
            S.move(g, { type: 'tab', col: from, idx: idx }, { type: 'tab', col: to });
          }
        }
      }
      assert.strictEqual(count(), 40, 'card count broke, seed ' + seed + ' step ' + step);
    }
  }
});

test('solitario: a game can be won by only foundation moves on a prepared board', () => {
  const g = S.newGame(U.makeRng(1));
  // Build a board where every card sits in its foundation except the last one per suit.
  g.stock = [];
  g.waste = [];
  g.tableau = [[], [], [], [], [], [], []];
  g.foundation = [[], [], [], []];
  for (let s = 0; s < 4; s++) {
    for (let r = 1; r <= 10; r++) {
      g.foundation[s].push({ suit: s, rank: r });
    }
  }
  // Move all but the first card of suit 0 back to the waste pile via one card.
  const c = g.foundation[0].pop();
  g.waste = [{ card: c, up: true }];
  assert.strictEqual(S.isWon(g), false);
  const r = S.move(g, { type: 'waste' }, { type: 'found', suit: 0 });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(S.isWon(g), true);
});
