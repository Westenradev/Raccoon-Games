// Briscola (you vs Gatto CPU). One hand per game. 120 points in total. More than 60 wins.
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

  // Points per card rank (1 = Asso, 3, 10 = Gatto Re, 9 = Chihuahua, 8 = Topo).
  const POINTS = { 1: 11, 3: 10, 10: 4, 9: 3, 8: 2, 2: 0, 4: 0, 5: 0, 6: 0, 7: 0 };
  // Strength order for taking a trick. Higher wins.
  const STRENGTH = { 1: 10, 3: 9, 10: 8, 9: 7, 8: 6, 7: 5, 6: 4, 5: 3, 4: 2, 2: 1 };

  function newHand(rnd) {
    const deck = U.shuffle(D.makeDeck(), rnd);
    const trump = deck[deck.length - 1].suit;
    return {
      deck: deck,
      trumpSuit: trump,
      hands: [deck.splice(0, 3), deck.splice(0, 3)],
      table: [null, null],
      leader: HUMAN,
      pile: [[], []],
      turn: HUMAN,
      ended: false,
      lastTrick: null,
      log: '',
    };
  }

  function trumpCard(state) {
    return state.deck[state.deck.length - 1] || null;
  }

  // Which of two played cards wins. first = leader's card.
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

  // Player plays a card. Returns { ok, reason, trick }.
  function play(state, player, cardId) {
    if (state.ended) return { ok: false, reason: 'hand over' };
    if (state.turn !== player) return { ok: false, reason: 'not your turn' };
    const hand = state.hands[player];
    const idx = hand.findIndex((c) => c.id === cardId);
    if (idx < 0) return { ok: false, reason: 'card not in hand' };
    const card = hand.splice(idx, 1)[0];
    const second = 1 - state.leader;
    if (player === state.leader) {
      state.table[state.leader] = card;
      state.turn = second;
      state.log = (player === HUMAN ? 'Tu' : 'Gatto') + ' gioca ' + D.cardLabel(card) + ' ' + D.SUITS[card.suit].icon;
      return { ok: true };
    }
    state.table[second] = card;
    const lead = state.table[state.leader];
    const winnerSide = trickWinner(lead, card, state.trumpSuit) === 0 ? state.leader : second;
    const pts = cardPoints(lead) + cardPoints(card);
    state.pile[winnerSide] = state.pile[winnerSide].concat([lead, card]);
    state.lastTrick = { winner: winnerSide, points: pts, cards: [lead, card] };
    state.table = [null, null];
    state.log = (winnerSide === HUMAN ? 'Prendi' : 'Il Gatto prende') + ' la mano: +' + pts;
    // Winner draws first, then the other player.
    const other = 1 - winnerSide;
    if (state.deck.length > 0) state.hands[winnerSide].push(state.deck.shift());
    if (state.deck.length > 0) state.hands[other].push(state.deck.shift());
    state.leader = winnerSide;
    state.turn = winnerSide;
    if (state.hands[0].length === 0 && state.hands[1].length === 0) state.ended = true;
    return { ok: true, trick: state.lastTrick };
  }

  function score(state) {
    const pts = [0, 0];
    state.pile.forEach((cards, i) => {
      pts[i] = cards.reduce((s, c) => s + cardPoints(c), 0);
    });
    // Last trick bonus is not used in this version.
    const winner = pts[0] > 60 ? HUMAN : pts[1] > 60 ? CPU : null;
    return { points: pts, winner: winner, tie: pts[0] === 60 && pts[1] === 60 };
  }

  // CPU picks a card.
  function cpuChoose(state, rnd) {
    const hand = state.hands[CPU];
    const trump = state.trumpSuit;
    let choice = null;
    const lead = state.table[state.leader];
    if (state.leader === CPU) {
      // Leader: play the weakest card, keep high points for later. Sometimes play a trump ace.
      choice = hand.reduce((a, b) => (valueOf(a, trump) <= valueOf(b, trump) ? a : b));
    } else {
      const winning = hand.filter((c) => trickWinner(lead, c, trump) === 1);
      const pointsOnTable = cardPoints(lead);
      if (winning.length && (pointsOnTable >= 2 || rnd() < 0.2)) {
        choice = winning.reduce((a, b) => (valueOf(a, trump) <= valueOf(b, trump) ? a : b));
      } else {
        choice = hand.reduce((a, b) => (valueOf(a, trump) <= valueOf(b, trump) ? a : b));
      }
    }
    return choice.id;
  }

  // Used for cpu choice: points first, then trump bonus, then strength.
  function valueOf(card, trump) {
    return cardPoints(card) * 10 + (card.suit === trump ? 100 : 0) + STRENGTH[card.rank];
  }

  // ---------- Browser interface ----------
  function mount(container, ctx) {
    let alive = true;
    let timer = null;
    let rnd = U.makeRng();
    let hand = null;
    let wins = [0, 0];
    let busy = false;
    const root = U.el('div', { class: 'briscola game-panel' });
    container.appendChild(root);

    function startHand() {
      hand = newHand(rnd);
      busy = false;
      render();
      nextCpu();
    }

    function nextCpu() {
      if (!alive || hand.ended || hand.turn !== CPU) return;
      busy = true;
      render();
      timer = setTimeout(function () {
        if (!alive) return;
        const id = cpuChoose(hand, rnd);
        const r = play(hand, CPU, id);
        if (A) A.sfx.place();
        afterPlay(!!r.trick);
      }, 750);
    }

    function afterPlay(trickDone) {
      busy = false;
      if (trickDone && A) hand.lastTrick.winner === HUMAN ? A.sfx.ok() : A.sfx.bad();
      if (hand.ended) return finish();
      render();
      nextCpu();
    }

    function finish() {
      const s = score(hand);
      const you = s.points[0];
      const cpu = s.points[1];
      const winner = s.winner;
      if (winner === HUMAN) wins[0] += 1;
      else if (winner === CPU) wins[1] += 1;
      if (A) winner === HUMAN ? A.sfx.win() : A.sfx.lose();
      render();
      const overlay = U.el('div', { class: 'overlay' },
        U.el('div', { class: 'card-box' },
          U.el('h2', { text: winner === HUMAN ? 'Hai vinto! 🦝' : winner === CPU ? 'Vince il Gatto 🐱' : 'Pareggio 60 - 60' }),
          U.el('p', { text: 'Tu: ' + you + ' punti · Gatto: ' + cpu + ' punti' }),
          U.el('p', { text: 'Vittorie: tu ' + wins[0] + ' · Gatto ' + wins[1] }),
          U.el('button', { class: 'btn big', text: 'Nuova mano', onclick: function () { overlay.remove(); startHand(); } })));
      root.appendChild(overlay);
    }

    function render() {
      if (!alive) return;
      root.querySelectorAll('.overlay').forEach((o) => o.remove());
      root.innerHTML = '';
      const trump = trumpCard(hand);
      const top = U.el('div', { class: 'scopa-top' },
        U.el('div', { class: 'score', text: 'Tu ' + wins[0] + ' · Gatto ' + wins[1] + ' (vittorie)' }),
        U.el('div', { class: 'score', text: 'Mazzo: ' + hand.deck.length }));
      const trumpRow = U.el('div', { class: 'trump-row' },
        U.el('span', { text: 'Briscola:' }),
        D.cardEl(trump, { small: true }),
        U.el('span', { class: 'trump-suit', text: D.SUITS[hand.trumpSuit].icon + ' ' + D.SUITS[hand.trumpSuit].name }));
      const cpuRow = U.el('div', { class: 'hand cpu' });
      hand.hands[CPU].forEach(() => cpuRow.appendChild(D.cardEl(null, { hidden: true, small: true })));
      const tableRow = U.el('div', { class: 'table trick' });
      const slots = [hand.table[CPU], hand.table[HUMAN]];
      slots.forEach((c, i) => {
        tableRow.appendChild(U.el('div', { class: 'slot' + (c ? '' : ' empty') }, c ? D.cardEl(c, { small: false }) : U.el('span', { text: i === CPU ? 'Gatto' : 'Tu' })));
      });
      const handRow = U.el('div', { class: 'hand me' });
      const myTurn = !busy && hand.turn === HUMAN && !hand.ended;
      hand.hands[HUMAN].forEach((c) => {
        handRow.appendChild(D.cardEl(c, {
          onclick: myTurn ? function () {
            const r = play(hand, HUMAN, c.id);
            if (!r.ok) return;
            if (A) A.sfx.place();
            afterPlay(!!r.trick);
          } : null,
          disabled: !myTurn,
        }));
      });
      const msg = U.el('div', { class: 'msg', text: busy ? 'Il Gatto sta pensando...' : (hand.log || 'Gioca una carta. Vince la carta più forte.') });
      root.append(top, trumpRow, cpuRow, tableRow, msg, handRow);
      root.appendChild(U.el('div', { class: 'hint', text: 'Punti: Asso 11 · Tre 10 · Gatto Re 4 · Chihuahua 3 · Topo 2' }));
    }

    startHand();
    return {
      destroy: function () {
        alive = false;
        if (timer) clearTimeout(timer);
      },
    };
  }

  return {
    meta: { id: 'briscola', title: 'Briscola', icon: '🂡', desc: 'Briscola contro il Gatto. Più di 60 punti vince.' },
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
