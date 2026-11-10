// Briscola for 2 players: you against the Chihuahua. 120 points in total. 61 or more wins.
(function (name, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else (window.RA = window.RA || { modules: {} }).modules[name] = api;
})('briscola', function () {
  const isNode = typeof require === 'function';
  const U = isNode ? require('../core/util.js') : window.RA.modules.util;
  const D = isNode ? require('./deck.js') : window.RA.modules.deck;
  const A = isNode ? null : window.RA.audio;

  const HUMAN = 0;
  const CPU = 1;

  // Points per rank: Asso 11, Tre 10, Re 4, Cavallo 3, Fante 2.
  const POINTS = { 1: 11, 3: 10, 10: 4, 9: 3, 8: 2, 2: 0, 4: 0, 5: 0, 6: 0, 7: 0 };
  // Strength order inside a suit. Higher wins.
  const STRENGTH = { 1: 10, 3: 9, 10: 8, 9: 7, 8: 6, 7: 5, 6: 4, 5: 3, 4: 2, 2: 1 };

  // The last card of the deck is the briscola card. It is drawn last.
  function newHand(rnd, leader) {
    const deck = U.shuffle(D.makeDeck(), rnd);
    const first = leader === CPU ? CPU : HUMAN;
    const trump = deck[deck.length - 1];
    const hands = [[], []];
    hands[first] = deck.splice(0, 3);
    hands[1 - first] = deck.splice(0, 3);
    return {
      deck: deck,
      trumpCard: trump,
      trumpSuit: trump.suit,
      hands: hands,
      table: [null, null], // card played by HUMAN and by CPU in the current trick
      leader: first,
      turn: first,
      pile: [[], []],
      ended: false,
      lastTrick: null,
    };
  }

  // Which of two played cards wins: 0 = the first card (leader), 1 = the second.
  function trickWinner(a, b, trumpSuit) {
    const aT = a.suit === trumpSuit;
    const bT = b.suit === trumpSuit;
    if (aT !== bT) return bT ? 1 : 0;
    if (a.suit !== b.suit) return 0;
    return STRENGTH[b.rank] > STRENGTH[a.rank] ? 1 : 0;
  }

  function cardPoints(c) {
    return POINTS[c.rank] || 0;
  }

  // A player plays a card. Returns { ok, reason, trick }.
  // trick is set when the play completes a trick: { winner, points, cards: [human, cpu] }.
  function play(state, player, cardId) {
    if (state.ended) return { ok: false, reason: 'hand over' };
    if (state.turn !== player) return { ok: false, reason: 'not your turn' };
    const hand = state.hands[player];
    const idx = hand.findIndex(function (c) { return c.id === cardId; });
    if (idx < 0) return { ok: false, reason: 'card not in hand' };
    const card = hand.splice(idx, 1)[0];
    state.table[player] = card;
    if (player === state.leader) {
      state.turn = 1 - player;
      return { ok: true, trick: null };
    }
    const lead = state.table[state.leader];
    const winner = trickWinner(lead, card, state.trumpSuit) === 0 ? state.leader : player;
    const pts = cardPoints(lead) + cardPoints(card);
    state.pile[winner].push(lead, card);
    state.lastTrick = { winner: winner, points: pts, cards: state.table.slice() };
    state.table = [null, null];
    // The winner draws first.
    if (state.deck.length > 0) state.hands[winner].push(state.deck.shift());
    if (state.deck.length > 0) state.hands[1 - winner].push(state.deck.shift());
    state.leader = winner;
    state.turn = winner;
    if (state.hands[0].length === 0 && state.hands[1].length === 0) state.ended = true;
    return { ok: true, trick: state.lastTrick };
  }

  function score(state) {
    const pts = state.pile.map(function (cards) {
      return cards.reduce(function (s, c) { return s + cardPoints(c); }, 0);
    });
    const winner = pts[0] > 60 ? HUMAN : pts[1] > 60 ? CPU : null;
    return { points: pts, winner: winner, tie: winner === null };
  }

  // How much the CPU wants to keep a card. Low value cards are played first.
  function keepValue(card, trump) {
    return cardPoints(card) * 10 + (card.suit === trump ? 60 : 0) + STRENGTH[card.rank];
  }

  // CPU picks a card id.
  function cpuChoose(state, rnd) {
    const hand = state.hands[CPU];
    const trump = state.trumpSuit;
    const lead = state.table[state.leader];
    let best = null;
    hand.forEach(function (c) {
      let value;
      if (state.leader === CPU || !lead) {
        // Leading: give away as little as possible.
        value = -keepValue(c, trump);
      } else {
        const total = cardPoints(lead) + cardPoints(c);
        const trumpCost = c.suit === trump ? 5 + STRENGTH[c.rank] * 0.6 : 0;
        if (trickWinner(lead, c, trump) === 1) value = total - trumpCost + 1;
        else value = -total - trumpCost - STRENGTH[c.rank] * 0.05;
      }
      value += rnd() * 0.01;
      if (!best || value > best.value) best = { value: value, id: c.id };
    });
    return best.id;
  }

  // ---------- Browser interface ----------
  function mount(container) {
    let alive = true;
    const timers = [];
    const rnd = U.makeRng();
    let hand = null;
    let wins = [0, 0];
    let nextLeader = HUMAN;
    let busy = false;
    let shown = null; // finished trick that stays on the table for a moment
    let note = '';
    const root = U.el('div', { class: 'briscola game-panel' });
    container.appendChild(root);

    function later(fn, ms) {
      timers.push(setTimeout(function () { if (alive) fn(); }, ms));
    }

    function startHand() {
      hand = newHand(rnd, nextLeader);
      nextLeader = 1 - nextLeader;
      busy = false;
      shown = null;
      note = hand.turn === HUMAN ? 'Tocca a te. Gioca una carta.' : 'Inizia il Chihuahua.';
      render();
      proceed();
    }

    // Continues the hand after any play.
    function proceed() {
      if (hand.ended) return finish();
      if (hand.turn !== CPU) {
        busy = false;
        return render();
      }
      busy = true;
      render();
      later(function () {
        const r = play(hand, CPU, cpuChoose(hand, rnd));
        if (A) A.sfx.place();
        afterPlay(r);
      }, 800);
    }

    function afterPlay(r) {
      if (!r.trick) {
        note = hand.turn === HUMAN ? 'Tocca a te. Rispondi alla carta del Chihuahua.' : 'Il Chihuahua sta pensando…';
        return proceed();
      }
      // Leave both cards on the table for a moment, so the player sees who took the trick.
      shown = r.trick;
      busy = true;
      const mine = r.trick.winner === HUMAN;
      note = (mine ? 'Prendi tu' : 'Prende il Chihuahua') + ': ' + r.trick.points + ' punti.';
      if (A) mine ? A.sfx.ok() : A.sfx.bad();
      render();
      later(function () {
        shown = null;
        note = hand.ended ? '' : (hand.turn === HUMAN ? 'Tocca a te. Gioca una carta.' : 'Gioca il Chihuahua.');
        proceed();
      }, 1500);
    }

    function clickCard(c) {
      if (busy || hand.ended || hand.turn !== HUMAN) return;
      const r = play(hand, HUMAN, c.id);
      if (!r.ok) return;
      if (A) A.sfx.place();
      afterPlay(r);
    }

    function finish() {
      const s = score(hand);
      if (s.winner === HUMAN) wins[0] += 1;
      else if (s.winner === CPU) wins[1] += 1;
      if (A) s.winner === HUMAN ? A.sfx.win() : A.sfx.lose();
      busy = true;
      note = '';
      render();
      root.appendChild(U.el('div', { class: 'overlay' },
        U.el('div', { class: 'card-box' },
          U.el('h2', { text: s.winner === HUMAN ? 'Hai vinto! 🦝🏆' : s.winner === CPU ? 'Vince il Chihuahua 🐕' : 'Pareggio: 60 a 60' }),
          U.el('p', { text: 'Tu: ' + s.points[0] + ' punti · Chihuahua: ' + s.points[1] + ' punti' }),
          U.el('p', { text: 'Partite vinte: tu ' + wins[0] + ' · Chihuahua ' + wins[1] }),
          U.el('button', { class: 'btn big', text: 'Nuova partita', onclick: startHand }))));
    }

    function render() {
      if (!alive) return;
      root.innerHTML = '';
      const pts = score(hand).points;
      root.appendChild(U.el('div', { class: 'pill-row' },
        U.el('div', { class: 'pill', text: 'Punti: tu ' + pts[0] + ' · Chihuahua ' + pts[1] }),
        U.el('div', { class: 'pill', text: 'Partite: ' + wins[0] + ' - ' + wins[1] }),
        U.el('div', { class: 'pill', text: 'Mazzo: ' + hand.deck.length })));

      const trumpInfo = U.el('div', { class: 'trump-row' }, U.el('span', { text: 'Briscola:' }));
      if (hand.deck.length) trumpInfo.appendChild(D.cardEl(hand.trumpCard, { small: true, disabled: true }));
      const suitBadge = U.el('span', { class: 'trump-suit' });
      suitBadge.innerHTML = D.suitSvg(hand.trumpSuit, 'inline');
      suitBadge.appendChild(document.createTextNode(' ' + D.SUITS[hand.trumpSuit].name));
      trumpInfo.appendChild(suitBadge);
      root.appendChild(trumpInfo);

      const cpuRow = U.el('div', { class: 'hand cpu' }, U.el('span', { class: 'seat', text: '🐕 Chihuahua' }));
      hand.hands[CPU].forEach(function () { cpuRow.appendChild(D.cardEl(null, { hidden: true, small: true })); });
      root.appendChild(cpuRow);

      const cards = shown ? shown.cards : hand.table;
      const felt = U.el('div', { class: 'felt trick' });
      [CPU, HUMAN].forEach(function (who) {
        const c = cards[who];
        const slot = U.el('div', { class: 'slot' + (c ? '' : ' empty') + (shown && shown.winner === who ? ' winner' : '') });
        slot.appendChild(U.el('div', { class: 'slot-name', text: who === CPU ? 'Chihuahua' : 'Tu' }));
        if (c) slot.appendChild(D.cardEl(c, { disabled: true }));
        felt.appendChild(slot);
      });
      root.appendChild(felt);
      root.appendChild(U.el('div', { class: 'msg', text: note }));

      const myTurn = !busy && hand.turn === HUMAN && !hand.ended;
      const handRow = U.el('div', { class: 'hand me' });
      hand.hands[HUMAN].forEach(function (c) {
        handRow.appendChild(D.cardEl(c, { disabled: !myTurn, onclick: function () { clickCard(c); } }));
      });
      root.appendChild(handRow);
      root.appendChild(U.el('div', { class: 'hint', text: 'Valore: Asso 11 · Tre 10 · Re 4 · Cavallo 3 · Fante 2. La briscola batte gli altri semi.' }));
    }

    startHand();
    return {
      destroy: function () {
        alive = false;
        timers.forEach(clearTimeout);
      },
      debug: {
        get state() { return hand; },
        get busy() { return busy; },
        get wins() { return wins; },
      },
    };
  }

  return {
    meta: { id: 'briscola', title: 'Briscola', icon: '🃏', desc: 'Briscola contro il Chihuahua. Vince chi fa almeno 61 punti.' },
    mount: mount,
    newHand: newHand,
    play: play,
    score: score,
    cpuChoose: cpuChoose,
    trickWinner: trickWinner,
    HUMAN: HUMAN,
    CPU: CPU,
  };
});
