// Scopa (2 players: you vs Gatto CPU). Rules: Italian classic with mandatory capture.
(function (name, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else (window.RA = window.RA || { modules: {} }).modules[name] = api;
})('scopa', function () {
  const isNode = typeof require === 'function';
  const U = isNode ? require('../core/util.js') : window.RA.modules.util;
  const D = isNode ? require('./deck.js') : window.RA.modules.deck;
  const A = isNode ? null : window.RA.audio;

  const WIN_SCORE = 11;
  const HUMAN = 0;
  const CPU = 1;

  // Every subset of table cards whose ranks add up to value.
  // Works rank by rank, so the search stays small even with a large table.
  function captureOptions(table, value) {
    const out = [];
    const byRank = [];
    for (let r = 0; r <= 10; r++) byRank.push([]);
    table.forEach((c) => byRank[c.rank].push(c.id));
    // All k-card combinations of a list of ids.
    const combos = function (ids, k) {
      if (k === 0) return [[]];
      const res = [];
      for (let i = 0; i <= ids.length - k; i++) {
        combos(ids.slice(i + 1), k - 1).forEach((rest) => res.push([ids[i]].concat(rest)));
      }
      return res;
    };
    const walk = function (rank, remaining, chosen) {
      if (remaining === 0) {
        if (chosen.length > 0) out.push(chosen.slice());
        return;
      }
      if (rank > value || rank > 10) return;
      const ids = byRank[rank];
      const maxK = Math.min(ids.length, Math.floor(remaining / rank));
      for (let k = 0; k <= maxK; k++) {
        combos(ids, k).forEach((set) => walk(rank + 1, remaining - k * rank, chosen.concat(set)));
      }
    };
    if (value >= 1 && value <= 10) walk(1, value, []);
    return out;
  }

  function sameSet(a, b) {
    if (a.length !== b.length) return false;
    const x = a.slice().sort((p, q) => p - q);
    const y = b.slice().sort((p, q) => p - q);
    return x.every((v, i) => v === y[i]);
  }

  function newMatch() {
    return { scores: [0, 0], dealer: CPU, round: 0, over: false, winner: null, round_: null, log: [] };
  }

  // Starts a round. Returns state for that round.
  function startRound(match, rnd) {
    const deck = U.shuffle(D.makeDeck(), rnd);
    const table = deck.splice(0, 4);
    const state = {
      deck: deck,
      table: table,
      hands: [deck.splice(0, 3), deck.splice(0, 3)],
      captured: [[], []],
      scope: [0, 0],
      turn: (match.dealer + 1) % 2,
      lastTaker: null,
      moves: 0,
      ended: false,
      result: null,
      lastEvent: '',
    };
    match.round += 1;
    return state;
  }

  function dealMore(state) {
    if (state.deck.length === 0) return;
    state.hands[0] = state.hands[0].concat(state.deck.splice(0, 3));
    state.hands[1] = state.hands[1].concat(state.deck.splice(0, 3));
  }

  function valueOf(card) {
    return card.rank;
  }

  // Plays one card. takeIds = ids of table cards taken (may be empty).
  // Returns { ok, reason, scopa }.
  function play(state, player, cardId, takeIds) {
    if (state.ended) return { ok: false, reason: 'round over' };
    if (state.turn !== player) return { ok: false, reason: 'not your turn' };
    const hand = state.hands[player];
    const idx = hand.findIndex((c) => c.id === cardId);
    if (idx < 0) return { ok: false, reason: 'card not in hand' };
    const card = hand[idx];
    const take = takeIds || [];
    const opts = captureOptions(state.table, valueOf(card));
    let scopa = false;

    if (take.length === 0) {
      if (opts.length > 0) return { ok: false, reason: 'capture is mandatory' };
    } else {
      const valid = opts.some((o) => sameSet(o, take));
      if (!valid) return { ok: false, reason: 'invalid capture' };
    }

    hand.splice(idx, 1);
    state.moves += 1;
    if (take.length > 0) {
      const taken = state.table.filter((c) => take.indexOf(c.id) >= 0);
      state.table = state.table.filter((c) => take.indexOf(c.id) < 0);
      state.captured[player] = state.captured[player].concat(taken, [card]);
      state.lastTaker = player;
      const lastCardsLeft = state.deck.length === 0 && state.hands[0].length === 0 && state.hands[1].length === 0;
      if (state.table.length === 0 && !lastCardsLeft) {
        state.scope[player] += 1;
        scopa = true;
      }
      state.lastEvent = (player === HUMAN ? 'Tu' : 'Gatto') + ' prende ' + (taken.length + 1) + (scopa ? ' e fa SCOPA!' : '');
    } else {
      state.table.push(card);
      state.lastEvent = (player === HUMAN ? 'Tu' : 'Gatto') + ' posa ' + D.cardLabel(card);
    }

    state.turn = 1 - player;
    if (state.hands[0].length === 0 && state.hands[1].length === 0) {
      if (state.deck.length > 0) {
        dealMore(state);
      } else {
        endRound(state);
      }
    }
    return { ok: true, scopa: scopa };
  }

  // Gives remaining table cards to last taker and scores the round.
  function endRound(state) {
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
      cards.forEach((c) => {
        if (c.suit === s) best = Math.max(best, D.PRIMIERA[c.rank]);
      });
      total += best;
    }
    return total;
  }

  // Returns points for each player for this round.
  function scoreRound(state) {
    const pts = [0, 0];
    const cards = state.captured;
    const count = [cards[0].length, cards[1].length];
    if (count[0] !== count[1]) pts[count[0] > count[1] ? 0 : 1] += 1;
    const den = cards.map((c) => c.filter((x) => x.suit === 1).length);
    if (den[0] !== den[1]) pts[den[0] > den[1] ? 0 : 1] += 1;
    const sette = cards.map((c) => c.some((x) => x.rank === 7 && x.suit === 1));
    if (sette[0]) pts[0] += 1;
    if (sette[1]) pts[1] += 1;
    const prim = cards.map(primieraSum);
    if (prim[0] !== prim[1]) pts[prim[0] > prim[1] ? 0 : 1] += 1;
    pts[0] += state.scope[0];
    pts[1] += state.scope[1];
    return { points: pts, count: count, denari: den, settebello: sette, primiera: prim, scope: state.scope.slice() };
  }

  // Applies round result to match. Returns true if match finished.
  function closeRound(match, state) {
    match.scores[0] += state.result.points[0];
    match.scores[1] += state.result.points[1];
    match.log.push('Round ' + match.round + ': ' + match.scores[0] + ' - ' + match.scores[1]);
    if (match.scores[0] >= WIN_SCORE || match.scores[1] >= WIN_SCORE) {
      if (match.scores[0] !== match.scores[1]) {
        match.over = true;
        match.winner = match.scores[0] > match.scores[1] ? HUMAN : CPU;
        return true;
      }
    }
    match.dealer = 1 - match.dealer;
    return false;
  }

  // CPU chooses a play. Returns { cardId, takeIds }.
  function cpuChoose(state, rnd) {
    const hand = state.hands[CPU];
    let best = null;
    hand.forEach((card) => {
      const opts = captureOptions(state.table, valueOf(card));
      if (opts.length === 0) {
        const score = -valueOf(card) * 0.4 + (rnd() * 0.5);
        if (!best || score > best.score) best = { score: score, cardId: card.id, takeIds: [] };
        return;
      }
      opts.forEach((o) => {
        const taken = state.table.filter((c) => o.indexOf(c.id) >= 0);
        let score = 0;
        taken.forEach((c) => {
          score += 1;
          if (c.rank === 7 && c.suit === 1) score += 6;
          if (c.suit === 1) score += 0.6;
          if (D.isFigure(c)) score += 0.4;
          score += D.PRIMIERA[c.rank] / 10;
        });
        score += 0.5 * (o.length);
        if (taken.length === state.table.length) score += 4;
        score -= valueOf(card) * 0.1;
        if (!best || score > best.score) best = { score: score, cardId: card.id, takeIds: o };
      });
    });
    return best;
  }

  // ---------- Browser interface ----------
  function mount(container, ctx) {
    let alive = true;
    let timer = null;
    let match = newMatch();
    let rnd = U.makeRng();
    let state = null;
    let selCard = null;
    let selTake = [];
    let busy = false;
    const root = U.el('div', { class: 'scopa game-panel' });
    container.appendChild(root);

    function say(msg) {
      const box = root.querySelector('.msg');
      if (box) box.textContent = msg;
    }

    function startNewRound() {
      state = startRound(match, rnd);
      selCard = null;
      selTake = [];
      render();
      nextTurn();
    }

    function nextTurn() {
      if (!alive || state.ended) return;
      if (state.turn === CPU) {
        busy = true;
        render();
        timer = setTimeout(function () {
          if (!alive) return;
          const c = cpuChoose(state, rnd);
          play(state, CPU, c.cardId, c.takeIds);
          if (A) A.sfx.place();
          busy = false;
          afterMove();
        }, 800);
      }
    }

    function afterMove() {
      selCard = null;
      selTake = [];
      if (state.ended) return roundEnd();
      render();
      nextTurn();
    }

    function roundEnd() {
      const over = closeRound(match, state);
      const r = state.result;
      const overlay = U.el('div', { class: 'overlay' });
      const you = r.points[0];
      const cpu = r.points[1];
      const body = U.el('div', { class: 'card-box' },
        U.el('h2', { text: over ? (match.winner === HUMAN ? 'Hai vinto la partita! 🦝' : 'Il Gatto vince la partita 🐱') : 'Fine del round ' + match.round }),
        U.el('p', { text: 'Tu: +' + you + '   Gatto: +' + cpu }),
        U.el('ul', { class: 'small-list' },
          U.el('li', { text: 'Carte: ' + r.count[0] + ' contro ' + r.count[1] }),
          U.el('li', { text: 'Denari: ' + r.denari[0] + ' contro ' + r.denari[1] }),
          U.el('li', { text: 'Settebello: ' + (r.settebello[0] ? 'tu' : r.settebello[1] ? 'Gatto' : 'nessuno') }),
          U.el('li', { text: 'Primiera: ' + r.primiera[0] + ' contro ' + r.primiera[1] }),
          U.el('li', { text: 'Scope: ' + r.scope[0] + ' contro ' + r.scope[1] })),
        U.el('p', { text: 'Punteggio totale: ' + match.scores[0] + ' - ' + match.scores[1] })
      );
      if (over) {
        if (A) match.winner === HUMAN ? A.sfx.win() : A.sfx.lose();
        body.appendChild(U.el('button', { class: 'btn big', text: 'Nuova partita', onclick: restart }));
      } else {
        body.appendChild(U.el('button', { class: 'btn big', text: 'Prossimo round', onclick: function () { overlay.remove(); startNewRound(); } }));
      }
      overlay.appendChild(body);
      root.appendChild(overlay);
    }

    function restart() {
      match = newMatch();
      startNewRound();
    }

    function humanReady() {
      return alive && !busy && state && !state.ended && state.turn === HUMAN;
    }

    function options() {
      if (!selCard) return [];
      const card = state.hands[HUMAN].find((c) => c.id === selCard);
      return card ? captureOptions(state.table, card.rank) : [];
    }

    function confirmPlay() {
      if (!humanReady() || selCard === null) return say('Prima scegli una carta dalla tua mano.');
      const opts = options();
      const r = play(state, HUMAN, selCard, selTake);
      if (!r.ok) {
        if (A) A.sfx.bad();
        const need = opts.length ? 'Seleziona una presa valida sul tavolo (somma uguale al valore della carta).' : r.reason;
        return say(need);
      }
      if (A) r.scopa ? A.sfx.win() : A.sfx.ok();
      afterMove();
    }

    function render() {
      if (!alive) return;
      root.querySelectorAll('.overlay').forEach(function (o) { o.remove(); });
      root.innerHTML = '';
      const top = U.el('div', { class: 'scopa-top' },
        U.el('div', { class: 'score', text: 'Tu ' + match.scores[0] + ' · Gatto ' + match.scores[1] + '  (primi a ' + WIN_SCORE + ')' }),
        U.el('div', { class: 'score', text: 'Mazzo: ' + state.deck.length + ' · Round ' + match.round }));
      const cpuRow = U.el('div', { class: 'hand cpu' });
      state.hands[CPU].forEach(function () { cpuRow.appendChild(D.cardEl(null, { hidden: true, small: true })); });
      const opts = options();
      const tableRow = U.el('div', { class: 'table' });
      state.table.forEach(function (c) {
        const inTake = selTake.indexOf(c.id) >= 0;
        const clickable = humanReady() && selCard !== null;
        tableRow.appendChild(D.cardEl(c, {
          selected: inTake,
          onclick: clickable ? function () {
            if (inTake) selTake = selTake.filter((x) => x !== c.id);
            else selTake = selTake.concat([c.id]);
            if (A) A.sfx.click();
            render();
          } : null,
        }));
      });
      const handRow = U.el('div', { class: 'hand me' });
      state.hands[HUMAN].forEach(function (c) {
        handRow.appendChild(D.cardEl(c, {
          selected: selCard === c.id,
          onclick: humanReady() ? function () {
            selCard = c.id;
            selTake = [];
            if (A) A.sfx.click();
            say(captureOptions(state.table, c.rank).length ? 'Scegli le carte da prendere, poi premi Gioca.' : 'Nessuna presa: premi Gioca per posare la carta.');
            render();
          } : null,
        }));
      });
      const btns = U.el('div', { class: 'actions' },
        U.el('button', { class: 'btn', text: 'Gioca ▶', onclick: confirmPlay }),
        U.el('button', { class: 'btn ghost', text: 'Annulla scelta', onclick: function () { selCard = null; selTake = []; render(); } }));
      const status = U.el('div', { class: 'msg', text: busy ? 'Il Gatto sta giocando...' : (state.lastEvent || 'Tocca una carta della tua mano.') });
      root.append(top, cpuRow, tableRow, status, handRow, btns);
      if (opts.length) root.appendChild(U.el('div', { class: 'hint', text: 'Prese possibili: ' + opts.length }));
    }

    startNewRound();

    return {
      destroy: function () {
        alive = false;
        if (timer) clearTimeout(timer);
      },
    };
  }

  return {
    meta: { id: 'scopa', title: 'Scopa', icon: '🃏', desc: 'Scopa contro il Gatto. Prima a 11 punti.' },
    mount: mount,
    captureOptions: captureOptions,
    newMatch: newMatch,
    startRound: startRound,
    play: play,
    cpuChoose: cpuChoose,
    scoreRound: scoreRound,
    closeRound: closeRound,
    endRound: endRound,
    WIN_SCORE: WIN_SCORE,
    HUMAN: HUMAN,
    CPU: CPU,
  };
});
