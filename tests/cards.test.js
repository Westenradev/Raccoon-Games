// Scopa, Briscola and Solitario: rules and full simulated games.
const test = require('node:test');
const assert = require('node:assert');
const U = require('../src/js/core/util.js');
const D = require('../src/js/games/deck.js');
const S = require('../src/js/games/scopa.js');
const B = require('../src/js/games/briscola.js');
const Sol = require('../src/js/games/solitario.js');

const card = (rank, suit, id) => ({ id: id == null ? suit * 10 + rank - 1 : id, rank, suit });

test('deck: 40 different cards, 4 suits x 10 ranks', () => {
  const deck = D.makeDeck();
  assert.strictEqual(deck.length, 40);
  assert.strictEqual(new Set(deck.map((c) => c.id)).size, 40);
  assert.strictEqual(D.cardName(card(7, 1)), '7 di Denari');
  assert.strictEqual(D.cardName(card(10, 0)), 'Re di Coppe');
  assert.strictEqual(D.cardName(card(1, 3)), 'Asso di Bastoni');
});

test('scopa: a sum can be captured when no single card matches', () => {
  const table = [card(3, 0), card(4, 0), card(2, 2)];
  const o = S.captureOptions(table, 7).map((x) => x.slice().sort().join(','));
  assert.deepStrictEqual(o, ['2,3']); // 3 + 4
  const o9 = S.captureOptions(table, 9).map((x) => x.slice().sort((a, b) => a - b).join(','));
  assert.deepStrictEqual(o9, ['2,3,21']); // 3 + 4 + 2
});

test('scopa: a single card of the same value must be taken before a sum', () => {
  const table = [card(3, 0), card(4, 0), card(7, 1), card(7, 2)];
  const o = S.captureOptions(table, 7).map((x) => x.join(',')).sort();
  assert.deepStrictEqual(o, ['16', '26']);
});

test('scopa: capture is mandatory, wrong captures are refused', () => {
  const m = S.newMatch();
  const st = S.startRound(m, U.makeRng(1));
  st.table = [card(5, 0), card(2, 1)];
  st.hands[S.HUMAN] = [card(7, 2), card(1, 3), card(9, 3)];
  st.turn = S.HUMAN;
  assert.strictEqual(S.play(st, S.HUMAN, 26, []).ok, false); // must take 5 + 2
  assert.strictEqual(S.play(st, S.HUMAN, 26, [4]).ok, false); // 5 alone is not 7
  assert.strictEqual(S.play(st, S.CPU, st.hands[S.CPU][0].id, []).ok, false); // not its turn
  const r = S.play(st, S.HUMAN, 26, [4, 11]);
  assert.ok(r.ok && r.scopa, 'clearing the table is a scopa');
  assert.strictEqual(st.scope[S.HUMAN], 1);
  assert.strictEqual(st.captured[S.HUMAN].length, 3);
});

test('scopa: clearing the table with the last card of the round is not a scopa', () => {
  const m = S.newMatch();
  const st = S.startRound(m, U.makeRng(2));
  st.deck = [];
  st.table = [card(4, 0)];
  st.hands = [[card(4, 1)], []];
  st.turn = S.HUMAN;
  const r = S.play(st, S.HUMAN, 13, [3]);
  assert.ok(r.ok);
  assert.strictEqual(r.scopa, false);
  assert.ok(st.ended);
});

test('scopa: round scoring (cards, denari, settebello, primiera, scope)', () => {
  const st = { captured: [[], []], scope: [2, 0] };
  const all = D.makeDeck();
  st.captured[0] = all.filter((c) => c.suit === 1 || c.rank === 7 || c.rank === 6); // 10 denari + 3 sevens + 3 sixes
  st.captured[1] = all.filter((c) => st.captured[0].indexOf(c) < 0);
  const r = S.scoreRound(st);
  assert.deepStrictEqual(r.count, [16, 24]);
  assert.deepStrictEqual(r.denari, [10, 0]);
  assert.deepStrictEqual(r.settebello, [true, false]);
  assert.strictEqual(r.primiera[0], 84);
  // cards -> player 1, denari + settebello + primiera + 2 scope -> player 0
  assert.deepStrictEqual(r.points, [5, 1]);
});

function randomScopaMove(st, rnd) {
  const hand = st.hands[S.HUMAN];
  const c = hand[Math.floor(rnd() * hand.length)];
  const opts = S.captureOptions(st.table, c.rank);
  return { cardId: c.id, takeIds: opts.length ? opts[Math.floor(rnd() * opts.length)] : [] };
}

test('scopa: 400 full matches end, every round uses all 40 cards', () => {
  let cpuWins = 0;
  for (let seed = 1; seed <= 400; seed++) {
    const rnd = U.makeRng(seed);
    const m = S.newMatch();
    let rounds = 0;
    while (!m.over && rounds++ < 200) {
      const st = S.startRound(m, rnd);
      assert.strictEqual(st.turn, 1 - m.dealer);
      let moves = 0;
      while (!st.ended && moves++ < 100) {
        const p = st.turn;
        const c = p === S.CPU ? S.cpuChoose(st, rnd) : randomScopaMove(st, rnd);
        const r = S.play(st, p, c.cardId, c.takeIds);
        assert.ok(r.ok, 'move refused: ' + r.reason + ' (seed ' + seed + ')');
        const inPlay = st.deck.length + st.table.length + st.hands[0].length + st.hands[1].length +
          st.captured[0].length + st.captured[1].length;
        assert.strictEqual(inPlay, 40, 'cards lost, seed ' + seed);
      }
      assert.ok(st.ended);
      assert.strictEqual(moves, 36);
      assert.strictEqual(st.captured[0].length + st.captured[1].length + st.table.length, 40);
      S.closeRound(m, st);
    }
    assert.ok(m.over, 'match did not end, seed ' + seed);
    assert.ok(m.scores[m.winner] >= S.WIN_SCORE && m.scores[m.winner] > m.scores[1 - m.winner]);
    if (m.winner === S.CPU) cpuWins++;
  }
  assert.ok(cpuWins > 240, 'the CPU should beat a random player most of the time: ' + cpuWins + '/400');
});

test('briscola: trick rules', () => {
  const trump = 2;
  assert.strictEqual(B.trickWinner(card(1, 0), card(2, trump), trump), 1, 'any trump beats an ace');
  assert.strictEqual(B.trickWinner(card(3, trump), card(1, trump), trump), 1, 'ace beats three');
  assert.strictEqual(B.trickWinner(card(3, 0), card(10, 0), trump), 0, 'three beats king');
  assert.strictEqual(B.trickWinner(card(2, 0), card(1, 1), trump), 0, 'other suit does not win');
});

test('briscola: 1000 hands end with 120 points, the trump card is drawn last', () => {
  let cpuWins = 0;
  let humanWins = 0;
  for (let seed = 1; seed <= 1000; seed++) {
    const rnd = U.makeRng(seed);
    const h = B.newHand(rnd, seed % 2);
    assert.strictEqual(h.turn, seed % 2);
    assert.strictEqual(h.deck[h.deck.length - 1], h.trumpCard);
    let plays = 0;
    while (!h.ended && plays++ < 60) {
      const p = h.turn;
      const id = p === B.CPU ? B.cpuChoose(h, rnd) : h.hands[p][Math.floor(rnd() * h.hands[p].length)].id;
      const before = h.deck.length;
      const r = B.play(h, p, id);
      assert.ok(r.ok, r.reason);
      if (before === 2 && h.deck.length === 0) {
        const loser = 1 - r.trick.winner;
        assert.ok(h.hands[loser].indexOf(h.trumpCard) >= 0, 'the loser of that trick draws the trump card');
      }
      assert.ok(h.hands[0].length <= 3 && h.hands[1].length <= 3);
    }
    assert.ok(h.ended);
    assert.strictEqual(plays, 40);
    const s = B.score(h);
    assert.strictEqual(s.points[0] + s.points[1], 120);
    assert.strictEqual(h.pile[0].length + h.pile[1].length, 40);
    if (s.winner === B.CPU) cpuWins++;
    if (s.winner === B.HUMAN) humanWins++;
  }
  assert.ok(cpuWins > humanWins * 2, 'the CPU should beat a random player: ' + cpuWins + ' vs ' + humanWins);
});

test('briscola: playing out of turn or a card you do not hold is refused', () => {
  const h = B.newHand(U.makeRng(3), B.HUMAN);
  assert.strictEqual(B.play(h, B.CPU, h.hands[B.CPU][0].id).ok, false);
  assert.strictEqual(B.play(h, B.HUMAN, h.hands[B.CPU][0].id).ok, false);
});

function countSol(g) {
  return g.stock.length + g.waste.length + g.foundation.reduce((s, p) => s + p.length, 0) +
    g.tableau.reduce((s, c) => s + c.length, 0);
}

test('solitario: deal has 7 columns of 1..7 cards and 12 cards in the stock', () => {
  const g = Sol.newGame(U.makeRng(1));
  g.tableau.forEach((col, i) => {
    assert.strictEqual(col.length, i + 1);
    assert.ok(col[col.length - 1].up);
    assert.ok(col.slice(0, -1).every((s) => !s.up));
  });
  assert.strictEqual(g.stock.length, 12);
  assert.strictEqual(countSol(g), 40);
});

test('solitario: move rules', () => {
  const g = Sol.newGame(U.makeRng(1));
  const up = (c) => ({ card: c, up: true });
  g.stock = [];
  g.waste = [up(card(6, 2))];
  g.foundation = [[], [], [], []];
  g.tableau = [[up(card(7, 0))], [up(card(7, 3))], [], [up(card(10, 1)), up(card(9, 2))], [up(card(1, 1))], [], []];
  // 6 of Spade goes on a 7 of the other colour group only.
  assert.strictEqual(Sol.move(g, { type: 'waste' }, { type: 'tab', col: 1 }).ok, false);
  assert.strictEqual(Sol.move(g, { type: 'waste' }, { type: 'tab', col: 2 }).ok, false, 'only a Re on an empty column');
  assert.strictEqual(Sol.move(g, { type: 'waste' }, { type: 'tab', col: 0 }).ok, true);
  // A run moves as one block. A Re run can go to an empty column.
  assert.strictEqual(Sol.move(g, { type: 'tab', col: 3, idx: 0 }, { type: 'tab', col: 2 }).ok, true);
  assert.strictEqual(g.tableau[2].length, 2);
  // Foundations start with the Asso.
  assert.strictEqual(Sol.move(g, { type: 'tab', col: 0, idx: 1 }, { type: 'found', suit: 2 }).ok, false);
  assert.strictEqual(Sol.move(g, { type: 'tab', col: 4, idx: 0 }, { type: 'found', suit: 1 }).ok, true);
  assert.strictEqual(countSol(g), 6);
});

test('solitario: 300 games played with the hint engine stay consistent, and some are won', () => {
  let wins = 0;
  for (let seed = 1; seed <= 300; seed++) {
    const rnd = U.makeRng(seed);
    const g = Sol.newGame(rnd);
    let idle = 0;
    for (let step = 0; step < 600 && !Sol.isWon(g); step++) {
      const h = Sol.findHint(g);
      if (!h) break;
      if (h.draw) {
        Sol.drawStock(g);
        idle++;
        if (idle > g.stock.length + g.waste.length + 2) break; // went around the stock with no move
      } else {
        assert.ok(Sol.move(g, h.src, h.dst).ok, 'hint must be a legal move, seed ' + seed);
        idle = 0;
      }
      assert.strictEqual(countSol(g), 40, 'cards lost, seed ' + seed);
      g.tableau.forEach((col) => {
        // face-up cards always form a valid run
        for (let i = 1; i < col.length; i++) {
          if (col[i - 1].up) assert.ok(col[i].up && col[i].card.rank === col[i - 1].card.rank - 1);
        }
      });
    }
    if (Sol.isWon(g)) wins++;
    else if (Sol.canAutoFinish(g)) assert.ok(Sol.findFoundationMove(g), 'auto finish must always have a move');
  }
  assert.ok(wins >= 10, 'a simple player should win some games: ' + wins + '/300');
});
