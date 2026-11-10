// Solitario (Klondike with the 40-card Piacentino deck). Draw 1, unlimited stock recycling.
(function (name, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else (window.RA = window.RA || { modules: {} }).modules[name] = api;
})('solitario', function () {
  const isNode = typeof require === 'function';
  const U = isNode ? require('../core/util.js') : window.RA.modules.util;
  const D = isNode ? require('./deck.js') : window.RA.modules.deck;
  const A = isNode ? null : window.RA.audio;

  // Suits 0 and 1 are "red". Suits 2 and 3 are "black". Only used for alternating colour rule.
  const colorOf = (c) => (c.suit < 2 ? 'r' : 'b');

  function newGame(rnd) {
    const deck = U.shuffle(D.makeDeck(), rnd);
    const tableau = [];
    for (let col = 0; col < 7; col++) {
      const pile = [];
      for (let i = 0; i <= col; i++) {
        pile.push({ card: deck.pop(), up: i === col });
      }
      tableau.push(pile);
    }
    return {
      tableau: tableau,
      stock: deck.map((c) => ({ card: c, up: false })),
      waste: [],
      foundation: [[], [], [], []],
      moves: 0,
    };
  }

  function canToTableau(card, top) {
    if (!top) return card.rank === 10;
    return top.up && colorOf(top.card) !== colorOf(card) && top.card.rank === card.rank + 1;
  }

  function canToFoundation(card, suit, state) {
    if (card.suit !== suit) return false;
    return state.foundation[suit].length + 1 === card.rank;
  }

  // Returns the cards that would move from a source. null when source is invalid.
  function sourceCards(state, src) {
    if (src.type === 'waste') {
      return state.waste.length ? [state.waste[state.waste.length - 1]] : null;
    }
    if (src.type === 'found') {
      const p = state.foundation[src.suit];
      return p.length ? [{ card: p[p.length - 1], up: true }] : null;
    }
    if (src.type === 'tab') {
      const col = state.tableau[src.col];
      if (!col || src.idx < 0 || src.idx >= col.length || !col[src.idx].up) return null;
      // A run must be descending by one and alternate colour.
      for (let i = src.idx; i < col.length - 1; i++) {
        const a = col[i].card;
        const b = col[i + 1].card;
        if (!col[i + 1].up || b.rank !== a.rank - 1 || colorOf(a) === colorOf(b)) return null;
      }
      return col.slice(src.idx);
    }
    return null;
  }

  // Try to move src to dst. Returns { ok, reason }.
  function move(state, src, dst) {
    const cards = sourceCards(state, src);
    if (!cards) return { ok: false, reason: 'no card' };
    const first = cards[0].card;
    if (dst.type === 'found') {
      if (cards.length !== 1) return { ok: false, reason: 'one card only' };
      if (!canToFoundation(first, dst.suit, state)) return { ok: false, reason: 'not allowed' };
    } else if (dst.type === 'tab') {
      const target = state.tableau[dst.col];
      if (!target) return { ok: false, reason: 'bad column' };
      if (src.type === 'tab' && src.col === dst.col) return { ok: false, reason: 'same column' };
      const top = target.length ? target[target.length - 1] : null;
      if (!canToTableau(first, top)) return { ok: false, reason: 'not allowed' };
    } else {
      return { ok: false, reason: 'bad target' };
    }

    // Remove from source.
    if (src.type === 'waste') state.waste.pop();
    else if (src.type === 'found') state.foundation[src.suit].pop();
    else state.tableau[src.col].splice(src.idx);

    // Place on destination.
    if (dst.type === 'found') state.foundation[dst.suit].push(first);
    else state.tableau[dst.col] = state.tableau[dst.col].concat(cards);

    // Flip the card left behind.
    if (src.type === 'tab') {
      const col = state.tableau[src.col];
      if (col.length && !col[col.length - 1].up) col[col.length - 1].up = true;
    }
    state.moves += 1;
    return { ok: true };
  }

  function drawStock(state) {
    if (state.stock.length) {
      const c = state.stock.pop();
      c.up = true;
      state.waste.push(c);
    } else if (state.waste.length) {
      state.stock = state.waste.reverse().map((c) => ({ card: c.card, up: false }));
      state.waste = [];
    } else {
      return { ok: false };
    }
    state.moves += 1;
    return { ok: true };
  }

  function isWon(state) {
    return state.foundation.every((p) => p.length === 10);
  }

  // Finds any legal move to a foundation. Used by double click and by hint.
  function findFoundationMove(state) {
    const sources = [{ type: 'waste' }];
    state.tableau.forEach((col, i) => {
      if (col.length) sources.push({ type: 'tab', col: i, idx: col.length - 1 });
    });
    for (const s of sources) {
      const cards = sourceCards(state, s);
      if (!cards || cards.length !== 1) continue;
      const c = cards[0].card;
      if (canToFoundation(c, c.suit, state)) return { src: s, dst: { type: 'found', suit: c.suit } };
    }
    return null;
  }

  // ---------- Browser interface ----------
  function mount(container, ctx) {
    let rnd = U.makeRng();
    let state = newGame(rnd);
    let sel = null; // selected source
    let alive = true;
    const root = U.el('div', { class: 'solitario game-panel' });
    container.appendChild(root);

    function newGameNow() {
      state = newGame(rnd);
      sel = null;
      render();
    }

    function attempt(src, dst) {
      const r = move(state, src, dst);
      if (!r.ok) {
        if (A) A.sfx.bad();
        sel = null;
        render();
        return false;
      }
      if (A) A.sfx.place();
      sel = null;
      if (isWon(state)) {
        if (A) A.sfx.win();
        render();
        root.appendChild(U.el('div', { class: 'overlay' }, U.el('div', { class: 'card-box' },
          U.el('h2', { text: 'Hai vinto! 🦝🎉' }),
          U.el('p', { text: 'Tutte le carte sono nelle pile finali in ' + state.moves + ' mosse.' }),
          U.el('button', { class: 'btn big', text: 'Nuova partita', onclick: newGameNow }))));
        return true;
      }
      render();
      return true;
    }

    function tapCard(src) {
      if (!sel) {
        sel = src;
        if (A) A.sfx.click();
        return render();
      }
      if (sel.type === src.type && sel.col === src.col && sel.idx === src.idx && sel.suit === src.suit) {
        sel = null;
        return render();
      }
      // Tap a card in a column to use it as target column.
      attempt(sel, { type: 'tab', col: src.col });
    }

    function tapTarget(dst) {
      if (!sel) return;
      attempt(sel, dst);
    }

    function cardsOf(pile) { return pile; }

    function render() {
      if (!alive) return;
      root.innerHTML = '';
      const top = U.el('div', { class: 'sol-top' });
      const stock = state.stock.length
        ? D.cardEl(null, { hidden: true, onclick: function () { sel = null; drawStock(state); render(); } })
        : U.el('div', { class: 'pcard empty', onclick: function () { sel = null; drawStock(state); render(); }, text: '↺' });
      const wasteTop = state.waste.length ? state.waste[state.waste.length - 1].card : null;
      const waste = wasteTop
        ? D.cardEl(wasteTop, { selected: sel && sel.type === 'waste', onclick: function () { return tapCard({ type: 'waste' }); } })
        : U.el('div', { class: 'pcard empty' });
      top.append(stock, waste, U.el('div', { class: 'spacer' }));
      state.foundation.forEach((pile, suit) => {
        const topCard = pile.length ? pile[pile.length - 1] : null;
        const node = topCard ? D.cardEl(topCard, { selected: sel && sel.type === 'found' && sel.suit === suit, onclick: function () {
          if (sel) return tapTarget({ type: 'found', suit: suit });
          return tapCard({ type: 'found', suit: suit });
        } }) : U.el('div', { class: 'pcard empty found', onclick: function () { tapTarget({ type: 'found', suit: suit }); }, text: D.SUITS[suit].icon });
        top.appendChild(node);
      });
      root.appendChild(top);

      const board = U.el('div', { class: 'tableau' });
      state.tableau.forEach((col, ci) => {
        const colEl = U.el('div', { class: 'col', onclick: function (e) {
          if (e.target === colEl && sel) tapTarget({ type: 'tab', col: ci });
        } });
        colEl.style.height = (col.length * 22 + 150) + 'px';
        if (!col.length) {
          colEl.appendChild(U.el('div', { class: 'pcard empty', onclick: function () { if (sel) tapTarget({ type: 'tab', col: ci }); } }));
        }
        col.forEach((slot, idx) => {
          const isSel = sel && sel.type === 'tab' && sel.col === ci && idx >= sel.idx;
          const node = slot.up
            ? D.cardEl(slot.card, { selected: isSel, onclick: function () {
              if (sel) return tapTarget({ type: 'tab', col: ci });
              return tapCard({ type: 'tab', col: ci, idx: idx });
            } })
            : D.cardEl(null, { hidden: true, small: false });
          node.classList.add('stacked');
          node.style.top = (idx * 22) + 'px';
          if (slot.up) {
            node.addEventListener('dblclick', function () {
              const f = findFoundationMove(state);
              if (!f) return;
              const srcCards = sourceCards(state, { type: 'tab', col: ci, idx: idx });
              if (srcCards && idx === col.length - 1) attempt({ type: 'tab', col: ci, idx: idx }, { type: 'found', suit: slot.card.suit });
            });
          }
          colEl.appendChild(node);
        });
        board.appendChild(colEl);
      });
      root.appendChild(board);

      const msg = U.el('div', { class: 'msg', text: sel ? 'Ora tocca dove spostare la carta.' : 'Tocca una carta, poi tocca la colonna di destinazione. Doppio tocco: va alla pila finale.' });
      root.appendChild(msg);
      root.appendChild(U.el('div', { class: 'actions' },
        U.el('button', { class: 'btn', text: 'Suggerimento', onclick: function () {
          const f = findFoundationMove(state);
          msg.textContent = f ? 'Puoi mettere una carta nella pila finale.' : 'Nessuna mossa diretta verso le pile finali.';
        } }),
        U.el('button', { class: 'btn ghost', text: 'Nuova partita', onclick: newGameNow }),
        U.el('span', { class: 'hint', text: 'Mosse: ' + state.moves + ' · Carte in pila: ' + state.foundation.reduce((s, p) => s + p.length, 0) + '/40' })));
    }

    render();
    return {
      destroy: function () { alive = false; },
    };
  }

  return {
    meta: { id: 'solitario', title: 'Solitario', icon: '🂠', desc: 'Solitario classico con il mazzo dei procioni.' },
    mount: mount,
    newGame: newGame,
    move: move,
    drawStock: drawStock,
    isWon: isWon,
    canToTableau: canToTableau,
    findFoundationMove: findFoundationMove,
  };
});
