// Scopa for 2 players: you against the computer. First to 11 points wins the match.
// Rules: capture is mandatory. A single card of the same value must be taken before a sum.
(function (name, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else (window.RA = window.RA || { modules: {} }).modules[name] = api;
})('scopa', function () {
  const isNode = typeof require === 'function';
  const U = isNode ? require('../core/util.js') : window.RA.modules.util;
  const D = isNode ? require('./deck.js') : window.RA.modules.deck;
  const A = isNode ? null : window.RA.audio;
  const SV = isNode ? null : window.RA.modules.saves;

  const WIN_SCORE = 11;
  const HUMAN = 0;
  const CPU = 1;

  // All k-card combinations of a list.
  function combos(list, k) {
    if (k === 0) return [[]];
    const res = [];
    for (let i = 0; i <= list.length - k; i++) {
      combos(list.slice(i + 1), k - 1).forEach(function (rest) { res.push([list[i]].concat(rest)); });
    }
    return res;
  }

  // Legal captures for a card of the given value. Each option is a list of table card ids.
  // When one table card has the same value, only single cards can be taken (classic rule).
  function captureOptions(table, value) {
    const singles = table.filter(function (c) { return c.rank === value; });
    if (singles.length) return singles.map(function (c) { return [c.id]; });
    const out = [];
    const byRank = [];
    for (let r = 0; r <= 10; r++) byRank.push([]);
    table.forEach(function (c) { byRank[c.rank].push(c.id); });
    // Works rank by rank, so the search stays small even with a large table.
    const walk = function (rank, remaining, chosen) {
      if (remaining === 0) {
        if (chosen.length > 0) out.push(chosen);
        return;
      }
      if (rank > remaining || rank > 10) return;
      const ids = byRank[rank];
      const maxK = Math.min(ids.length, Math.floor(remaining / rank));
      for (let k = 0; k <= maxK; k++) {
        combos(ids, k).forEach(function (set) { walk(rank + 1, remaining - k * rank, chosen.concat(set)); });
      }
    };
    if (value >= 1 && value <= 10) walk(1, value, []);
    return out;
  }

  function sameSet(a, b) {
    if (a.length !== b.length) return false;
    const x = a.slice().sort(function (p, q) { return p - q; });
    const y = b.slice().sort(function (p, q) { return p - q; });
    return x.every(function (v, i) { return v === y[i]; });
  }

  function newMatch() {
    return { scores: [0, 0], dealer: CPU, round: 0, over: false, winner: null };
  }

  // Starts a round. The player who is not the dealer plays first.
  function startRound(match, rnd) {
    // A table with three or four Re can never be cleared, so those deals are shuffled again.
    let deck;
    do {
      deck = U.shuffle(D.makeDeck(), rnd);
    } while (deck.slice(0, 4).filter(function (c) { return c.rank === 10; }).length >= 3);
    const table = deck.splice(0, 4);
    match.round += 1;
    return {
      deck: deck,
      table: table,
      hands: [deck.splice(0, 3), deck.splice(0, 3)],
      captured: [[], []],
      scope: [0, 0],
      turn: 1 - match.dealer,
      lastTaker: null,
      ended: false,
      result: null,
      last: null,
    };
  }

  // Plays one card. takeIds = ids of the table cards taken (empty when nothing can be taken).
  // Returns { ok, reason, scopa, taken }.
  function play(state, player, cardId, takeIds) {
    if (state.ended) return { ok: false, reason: 'round over' };
    if (state.turn !== player) return { ok: false, reason: 'not your turn' };
    const hand = state.hands[player];
    const idx = hand.findIndex(function (c) { return c.id === cardId; });
    if (idx < 0) return { ok: false, reason: 'card not in hand' };
    const card = hand[idx];
    const take = takeIds || [];
    const opts = captureOptions(state.table, card.rank);
    if (take.length === 0) {
      if (opts.length > 0) return { ok: false, reason: 'capture is mandatory' };
    } else if (!opts.some(function (o) { return sameSet(o, take); })) {
      return { ok: false, reason: 'invalid capture' };
    }

    hand.splice(idx, 1);
    let scopa = false;
    let taken = [];
    if (take.length > 0) {
      taken = state.table.filter(function (c) { return take.indexOf(c.id) >= 0; });
      state.table = state.table.filter(function (c) { return take.indexOf(c.id) < 0; });
      state.captured[player] = state.captured[player].concat(taken, [card]);
      state.lastTaker = player;
      // Clearing the table with the very last card of the round is not a scopa.
      const lastCard = state.deck.length === 0 && state.hands[0].length === 0 && state.hands[1].length === 0;
      if (state.table.length === 0 && !lastCard) {
        state.scope[player] += 1;
        scopa = true;
      }
    } else {
      state.table.push(card);
    }
    state.last = { player: player, card: card, taken: taken, scopa: scopa };

    state.turn = 1 - player;
    if (state.hands[0].length === 0 && state.hands[1].length === 0) {
      if (state.deck.length > 0) {
        // The first player of the round (the one who is to move now) is dealt first.
        state.hands[state.turn] = state.deck.splice(0, 3);
        state.hands[1 - state.turn] = state.deck.splice(0, 3);
      } else {
        endRound(state);
      }
    }
    return { ok: true, scopa: scopa, taken: taken };
  }

  // Gives the cards left on the table to the last taker and scores the round.
  function endRound(state) {
    // swept = the cards that were still on the table, kept so they can be shown once more.
    state.swept = state.table.slice();
    if (state.lastTaker !== null && state.table.length) {
      state.captured[state.lastTaker] = state.captured[state.lastTaker].concat(state.table);
      state.table = [];
    }
    state.ended = true;
    state.result = scoreRound(state);
  }

  function primieraSum(cards) {
    let total = 0;
    for (let s = 0; s < 4; s++) {
      let best = 0;
      cards.forEach(function (c) {
        if (c.suit === s) best = Math.max(best, D.PRIMIERA[c.rank]);
      });
      total += best;
    }
    return total;
  }

  // Points of the round: cards, denari, settebello, primiera, scope.
  function scoreRound(state) {
    const pts = [0, 0];
    const cards = state.captured;
    const count = [cards[0].length, cards[1].length];
    if (count[0] !== count[1]) pts[count[0] > count[1] ? 0 : 1] += 1;
    const den = cards.map(function (c) { return c.filter(function (x) { return x.suit === D.DENARI; }).length; });
    if (den[0] !== den[1]) pts[den[0] > den[1] ? 0 : 1] += 1;
    const sette = cards.map(function (c) { return c.some(function (x) { return x.rank === 7 && x.suit === D.DENARI; }); });
    if (sette[0]) pts[0] += 1;
    if (sette[1]) pts[1] += 1;
    const prim = cards.map(primieraSum);
    if (prim[0] !== prim[1]) pts[prim[0] > prim[1] ? 0 : 1] += 1;
    pts[0] += state.scope[0];
    pts[1] += state.scope[1];
    return { points: pts, count: count, denari: den, settebello: sette, primiera: prim, scope: state.scope.slice() };
  }

  // Adds the round result to the match. Returns true when the match is finished.
  // With both players at 11 or more and the same score, another round is played.
  function closeRound(match, state) {
    match.scores[0] += state.result.points[0];
    match.scores[1] += state.result.points[1];
    const top = Math.max(match.scores[0], match.scores[1]);
    if (top >= WIN_SCORE && match.scores[0] !== match.scores[1]) {
      match.over = true;
      match.winner = match.scores[0] > match.scores[1] ? HUMAN : CPU;
      return true;
    }
    match.dealer = 1 - match.dealer;
    return false;
  }

  // CPU chooses a play. Returns { cardId, takeIds }.
  function cpuChoose(state, rnd) {
    const hand = state.hands[CPU];
    const lastCard = state.deck.length === 0 && state.hands[HUMAN].length === 0 && hand.length === 1;
    const worth = function (c) {
      let v = 1;
      if (c.suit === D.DENARI) v += 1.5;
      if (c.rank === 7) v += c.suit === D.DENARI ? 12 : 2.5;
      if (c.rank === 6) v += 1;
      if (c.rank === 1) v += 0.5;
      return v;
    };
    let best = null;
    const consider = function (card, take) {
      const rest = state.table.filter(function (c) { return take.indexOf(c.id) < 0; });
      let score = rnd() * 0.3;
      if (take.length) {
        state.table.forEach(function (c) { if (take.indexOf(c.id) >= 0) score += worth(c); });
        score += worth(card);
        if (rest.length === 0 && !lastCard) score += 10;
      } else {
        score -= worth(card) * 1.2;
        rest.push(card);
      }
      // A table that adds up to 10 or less lets the other player make a scopa.
      const sum = rest.reduce(function (s, c) { return s + c.rank; }, 0);
      if (sum > 0 && sum <= 10) score -= 3;
      if (!best || score > best.score) best = { score: score, cardId: card.id, takeIds: take };
    };
    hand.forEach(function (card) {
      const opts = captureOptions(state.table, card.rank);
      if (opts.length === 0) consider(card, []);
      else opts.forEach(function (o) { consider(card, o); });
    });
    return { cardId: best.cardId, takeIds: best.takeIds };
  }

  // ---------- Browser interface ----------
  function mount(container) {
    let alive = true;
    const timers = [];
    const rnd = U.makeRng();
    let match = newMatch();
    let state = null;
    let busy = false;
    let choosing = null; // { cardId, opts } when the player must pick one of several captures
    let preview = null; // { card, takeIds } while the CPU shows its move
    let note = '';
    const root = U.el('div', { class: 'scopa game-panel tabletop' });
    container.appendChild(root);

    function later(fn, ms) {
      timers.push(setTimeout(function () { if (alive) fn(); }, ms));
    }

    function names(cards) {
      return cards.map(D.cardName).join(' + ');
    }

    function describe(last) {
      const who = last.player === HUMAN ? 'Hai' : 'L\'avversario ha';
      if (!last.taken.length) return who + ' posato ' + D.cardName(last.card) + '.';
      return who + ' preso ' + names(last.taken) + ' con ' + D.cardName(last.card) + '.' + (last.scopa ? ' Scopa!' : '');
    }

    function startNewRound() {
      state = startRound(match, rnd);
      choosing = null;
      preview = null;
      busy = false;
      note = state.turn === HUMAN ? 'Tocca a te. Scegli una carta dalla tua mano.' : 'Inizia l\'avversario.';
      if (A) A.sfx.shuffle();
      render();
      nextTurn();
    }

    // ----- saved game -----
    // What to keep when the player leaves: the match, and the hand in progress.
    function persist() {
      if (asking) return; // the saved game is still waiting for an answer
      // A match where no card was played yet is not worth keeping.
      const touched = state && (match.round > 1 || !!state.last);
      if (!touched || match.over) return SV.clear('scopa');
      SV.save('scopa', { match: match, state: state.ended ? null : state });
    }

    function restore(saved) {
      match = saved.match;
      if (!saved.state) return startNewRound();
      state = saved.state;
      choosing = null;
      preview = null;
      busy = false;
      note = 'Partita ripresa. ' + (state.turn === HUMAN ? 'Tocca a te.' : 'Tocca all\'avversario.');
      render();
      nextTurn();
    }

    function nextTurn() {
      if (state.ended) return roundEnd();
      if (state.turn !== CPU) return;
      busy = true;
      render();
      later(function () {
        const c = cpuChoose(state, rnd);
        const card = state.hands[CPU].find(function (x) { return x.id === c.cardId; });
        preview = { card: card, takeIds: c.takeIds };
        note = 'L\'avversario gioca ' + D.cardName(card) + (c.takeIds.length ? ' e prende…' : '.');
        if (A) A.sfx.card();
        render();
        later(function () {
          preview = null;
          const r = play(state, CPU, c.cardId, c.takeIds);
          if (A && r.taken.length) A.sfx.take();
          if (A && r.scopa) A.sfx.lose();
          note = describe(state.last) + (state.ended ? '' : ' Tocca a te.');
          busy = false;
          render();
          nextTurn();
        }, 1300);
      }, 700);
    }

    function humanPlay(cardId, takeIds) {
      const r = play(state, HUMAN, cardId, takeIds);
      if (!r.ok) {
        if (A) A.sfx.bad();
        return;
      }
      choosing = null;
      if (A) {
        if (r.taken.length) A.sfx.take();
        else A.sfx.card();
        if (r.scopa) A.sfx.win();
      }
      note = describe(state.last);
      render();
      nextTurn();
    }

    function clickHand(card, e) {
      if (busy || state.ended || state.turn !== HUMAN) return;
      // The second click of a double click (for example on "Prossima mano") must not play a card.
      if (e && e.detail > 1) return;
      const opts = captureOptions(state.table, card.rank);
      if (opts.length <= 1) return humanPlay(card.id, opts[0] || []);
      choosing = { cardId: card.id, opts: opts };
      note = 'Con ' + D.cardName(card) + ' puoi fare più prese. Scegli quale con i pulsanti qui sotto.';
      if (A) A.sfx.click();
      render();
    }

    // Shows the table after the last card for a moment, then the points of the hand.
    function roundEnd() {
      const over = closeRound(match, state);
      busy = true;
      const left = state.swept ? state.swept.length : 0;
      note = describe(state.last) + (left && state.lastTaker !== null
        ? ' Mano finita: ' + (left === 1 ? 'la carta rimasta va' : 'le ' + left + ' carte rimaste vanno') + (state.lastTaker === HUMAN ? ' a te.' : ' all\'avversario.')
        : ' Mano finita.');
      render();
      later(function () { showRoundResult(over); }, 1500);
    }

    function showRoundResult(over) {
      const r = state.result;
      const line = function (label, a, b) {
        return U.el('tr', null, U.el('td', { text: label }), U.el('td', { text: String(a) }), U.el('td', { text: String(b) }));
      };
      const box = U.el('div', { class: 'card-box' },
        U.el('h2', { text: over ? (match.winner === HUMAN ? 'Hai vinto la partita!' : 'Ha vinto l\'avversario') : 'Fine della mano ' + match.round }),
        U.el('table', { class: 'score-table' },
          U.el('tr', null, U.el('th', { text: '' }), U.el('th', { text: 'Tu' }), U.el('th', { text: 'Avversario' })),
          line('Carte', r.count[0], r.count[1]),
          line('Denari', r.denari[0], r.denari[1]),
          line('Settebello', r.settebello[0] ? '✔' : '', r.settebello[1] ? '✔' : ''),
          line('Primiera', r.primiera[0], r.primiera[1]),
          line('Scope', r.scope[0], r.scope[1]),
          line('Punti della mano', '+' + r.points[0], '+' + r.points[1]),
          line('Totale', match.scores[0], match.scores[1])),
        U.el('button', {
          class: 'btn big',
          text: over ? 'Nuova partita' : 'Prossima mano',
          onclick: function () {
            if (over) match = newMatch();
            startNewRound();
          },
        }));
      if (A && over) match.winner === HUMAN ? A.sfx.win() : A.sfx.lose();
      root.appendChild(U.el('div', { class: 'overlay' }, box));
    }

    function pileEl(who) {
      const n = state.captured[who].length;
      const stack = U.el('div', { class: 'stack' + (n ? '' : ' none') });
      if (n) stack.appendChild(D.cardEl(null, { hidden: true }));
      return U.el('div', { class: 'pile' }, stack,
        U.el('div', { text: n + (n === 1 ? ' carta presa' : ' carte prese') }),
        U.el('div', { class: 'scope', text: 'Scope: ' + state.scope[who] }));
    }

    function render() {
      if (!alive) return;
      root.innerHTML = '';
      const myTurn = !busy && !state.ended && state.turn === HUMAN;
      root.appendChild(U.el('div', { class: 'pill-row' },
        U.el('div', { class: 'pill', text: 'Tu ' + match.scores[0] + ' — Avversario ' + match.scores[1] }),
        U.el('div', { class: 'pill', text: 'Si vince a ' + WIN_SCORE }),
        U.el('div', { class: 'pill', text: 'Mano ' + match.round }),
        U.el('div', { class: 'pill', text: 'Mazzo: ' + state.deck.length })));

      const cpuHand = U.el('div', { class: 'hand cpu' });
      state.hands[CPU].forEach(function (c) {
        if (preview && preview.card.id === c.id) return;
        cpuHand.appendChild(D.cardEl(null, { hidden: true, small: true }));
      });
      root.appendChild(U.el('div', { class: 'seat-row' },
        U.el('div', { class: 'seat-name right', text: 'Avversario' }), cpuHand, pileEl(CPU)));

      const tableRow = U.el('div', { class: 'felt' });
      const marked = preview ? preview.takeIds : (choosing ? [].concat.apply([], choosing.opts) : []);
      // At the end of a hand the cards left on the table stay visible until the points appear.
      const shown = state.ended && state.swept ? state.swept : state.table;
      shown.forEach(function (c) {
        // While a capture is being chosen, a table card that is part of only one capture picks it.
        const mine = choosing && myTurn ? choosing.opts.filter(function (o) { return o.indexOf(c.id) >= 0; }) : [];
        tableRow.appendChild(D.cardEl(c, {
          selected: marked.indexOf(c.id) >= 0,
          disabled: mine.length !== 1,
          onclick: mine.length === 1 ? function () { humanPlay(choosing.cardId, mine[0]); } : null,
        }));
      });
      if (preview) {
        const played = D.cardEl(preview.card, { disabled: true });
        played.classList.add('played');
        tableRow.appendChild(played);
      }
      if (!shown.length && !preview) tableRow.appendChild(U.el('span', { class: 'felt-note', text: 'Il tavolo è vuoto' }));
      root.appendChild(tableRow);

      root.appendChild(U.el('div', { class: 'msg', text: note }));

      if (choosing && myTurn) {
        const optRow = U.el('div', { class: 'actions' });
        choosing.opts.forEach(function (o) {
          const cards = state.table.filter(function (c) { return o.indexOf(c.id) >= 0; });
          // A double click on the hand card must not also press a button that appears under it.
          optRow.appendChild(U.el('button', { class: 'btn', text: 'Prendi ' + names(cards), onclick: function (e) { if (e.detail <= 1) humanPlay(choosing.cardId, o); } }));
        });
        optRow.appendChild(U.el('button', { class: 'btn ghost', text: 'Annulla', onclick: function (e) { if (e.detail > 1) return; choosing = null; note = 'Scegli una carta dalla tua mano.'; render(); } }));
        root.appendChild(optRow);
      }

      const handRow = U.el('div', { class: 'hand me' });
      state.hands[HUMAN].forEach(function (c) {
        handRow.appendChild(D.cardEl(c, {
          selected: !!choosing && choosing.cardId === c.id,
          disabled: !myTurn,
          onclick: function (e) { clickHand(c, e); },
        }));
      });
      root.appendChild(U.el('div', { class: 'seat-row' },
        U.el('div', { class: 'seat-name right', text: 'Tu' }), handRow, pileEl(HUMAN)));
      root.appendChild(U.el('div', { class: 'hint', text: 'Tocca una carta per giocarla. Se puoi prendere, devi prendere.' }));
    }

    const saved = SV.load('scopa');
    let asking = !!saved;
    if (saved) {
      SV.ask(root, 'Scopa: tu ' + saved.match.scores[0] + ', avversario ' + saved.match.scores[1] + '. Mano ' + saved.match.round + '.',
        function () { asking = false; restore(saved); },
        function () { asking = false; SV.clear('scopa'); startNewRound(); });
    } else {
      startNewRound();
    }

    return {
      destroy: function () {
        persist();
        alive = false;
        timers.forEach(clearTimeout);
      },
      save: persist,
      debug: {
        get state() { return state; },
        get match() { return match; },
        get busy() { return busy; },
      },
    };
  }

  return {
    meta: { id: 'scopa', title: 'Scopa', desc: 'Contro il computer. Vince chi arriva a 11 punti.' },
    mount: mount,
    captureOptions: captureOptions,
    newMatch: newMatch,
    startRound: startRound,
    play: play,
    cpuChoose: cpuChoose,
    scoreRound: scoreRound,
    closeRound: closeRound,
    WIN_SCORE: WIN_SCORE,
    HUMAN: HUMAN,
    CPU: CPU,
  };
});
