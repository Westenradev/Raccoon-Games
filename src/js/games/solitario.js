// Solitario (Klondike with the 40-card Piacentino deck). Draw one card, stock can be recycled.
// Columns go down by one and alternate colour group: Coppe/Denari against Spade/Bastoni.
// Final piles go up by suit from the Asso to the Re. Only a Re can go on an empty column.
(function (name, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else (window.RA = window.RA || { modules: {} }).modules[name] = api;
})('solitario', function () {
  const isNode = typeof require === 'function';
  const U = isNode ? require('../core/util.js') : window.RA.modules.util;
  const D = isNode ? require('./deck.js') : window.RA.modules.deck;
  const A = isNode ? null : window.RA.audio;

  // Coppe and Denari are the "warm" group. Spade and Bastoni are the "cool" group.
  const groupOf = function (c) { return c.suit < 2 ? 0 : 1; };

  function newGame(rnd) {
    const deck = U.shuffle(D.makeDeck(), rnd);
    const tableau = [];
    for (let col = 0; col < 7; col++) {
      const pile = [];
      for (let i = 0; i <= col; i++) pile.push({ card: deck.pop(), up: i === col });
      tableau.push(pile);
    }
    return {
      tableau: tableau,
      stock: deck.map(function (c) { return { card: c, up: false }; }),
      waste: [],
      foundation: [[], [], [], []],
      moves: 0,
    };
  }

  function canToTableau(card, top) {
    if (!top) return card.rank === 10;
    return top.up && groupOf(top.card) !== groupOf(card) && top.card.rank === card.rank + 1;
  }

  function canToFoundation(card, suit, state) {
    return card.suit === suit && state.foundation[suit].length + 1 === card.rank;
  }

  // Cards that move from a source: [{card, up}]. null when the source is not valid.
  // src: { type: 'waste' } | { type: 'found', suit } | { type: 'tab', col, idx }
  function sourceCards(state, src) {
    if (src.type === 'waste') {
      return state.waste.length ? [state.waste[state.waste.length - 1]] : null;
    }
    if (src.type === 'found') {
      const p = state.foundation[src.suit];
      return p && p.length ? [{ card: p[p.length - 1], up: true }] : null;
    }
    if (src.type === 'tab') {
      const col = state.tableau[src.col];
      if (!col || src.idx < 0 || src.idx >= col.length || !col[src.idx].up) return null;
      return col.slice(src.idx);
    }
    return null;
  }

  function checkMove(state, src, dst) {
    const cards = sourceCards(state, src);
    if (!cards) return 'no card';
    const first = cards[0].card;
    if (dst.type === 'found') {
      if (src.type === 'found') return 'not allowed';
      if (cards.length !== 1) return 'one card only';
      if (!canToFoundation(first, dst.suit, state)) return 'not allowed';
      return null;
    }
    if (dst.type === 'tab') {
      const target = state.tableau[dst.col];
      if (!target) return 'bad column';
      if (src.type === 'tab' && src.col === dst.col) return 'same column';
      if (!canToTableau(first, target.length ? target[target.length - 1] : null)) return 'not allowed';
      return null;
    }
    return 'bad target';
  }

  // Moves src to dst when the rules allow it. Returns { ok, reason }.
  function move(state, src, dst) {
    const reason = checkMove(state, src, dst);
    if (reason) return { ok: false, reason: reason };
    const cards = sourceCards(state, src);
    if (src.type === 'waste') state.waste.pop();
    else if (src.type === 'found') state.foundation[src.suit].pop();
    else state.tableau[src.col].splice(src.idx);

    if (dst.type === 'found') state.foundation[dst.suit].push(cards[0].card);
    else state.tableau[dst.col] = state.tableau[dst.col].concat(cards);

    // Turn over the card that was under the moved cards.
    if (src.type === 'tab') {
      const col = state.tableau[src.col];
      if (col.length && !col[col.length - 1].up) col[col.length - 1].up = true;
    }
    state.moves += 1;
    return { ok: true };
  }

  // Takes one card from the stock, or turns the waste pile over when the stock is empty.
  function drawStock(state) {
    if (state.stock.length) {
      const c = state.stock.pop();
      c.up = true;
      state.waste.push(c);
    } else if (state.waste.length) {
      state.stock = state.waste.reverse().map(function (c) { return { card: c.card, up: false }; });
      state.waste = [];
    } else {
      return { ok: false };
    }
    state.moves += 1;
    return { ok: true };
  }

  function isWon(state) {
    return state.foundation.every(function (p) { return p.length === 10; });
  }

  // Every place a source can go. Empty columns count once, because they are all the same.
  function destinations(state, src) {
    const cards = sourceCards(state, src);
    if (!cards) return [];
    const out = [];
    const first = cards[0].card;
    if (!checkMove(state, src, { type: 'found', suit: first.suit })) out.push({ type: 'found', suit: first.suit });
    let emptyUsed = false;
    for (let col = 0; col < 7; col++) {
      const dst = { type: 'tab', col: col };
      if (checkMove(state, src, dst)) continue;
      if (!state.tableau[col].length) {
        // Moving a Re from the bottom of one column to another empty column does nothing.
        if (emptyUsed || (src.type === 'tab' && src.idx === 0)) continue;
        emptyUsed = true;
      }
      out.push(dst);
    }
    return out;
  }

  function findFoundationMove(state) {
    const sources = [{ type: 'waste' }];
    state.tableau.forEach(function (col, i) {
      if (col.length) sources.push({ type: 'tab', col: i, idx: col.length - 1 });
    });
    for (const s of sources) {
      const cards = sourceCards(state, s);
      if (!cards) continue;
      const c = cards[0].card;
      if (!checkMove(state, s, { type: 'found', suit: c.suit })) return { src: s, dst: { type: 'found', suit: c.suit } };
    }
    return null;
  }

  // A useful next move, or null. { src, dst } or { draw: true }.
  function findHint(state) {
    const f = findFoundationMove(state);
    if (f) return f;
    // Column moves that turn a card over or free a column for a waiting Re.
    for (let col = 0; col < 7; col++) {
      const pile = state.tableau[col];
      const idx = pile.findIndex(function (s) { return s.up; });
      if (idx < 0) continue;
      const src = { type: 'tab', col: col, idx: idx };
      const dst = destinations(state, src).filter(function (d) { return d.type === 'tab'; })[0];
      if (dst && (idx > 0 || state.tableau[dst.col].length)) return { src: src, dst: dst };
    }
    if (state.waste.length) {
      const dst = destinations(state, { type: 'waste' })[0];
      if (dst) return { src: { type: 'waste' }, dst: dst };
    }
    if (state.stock.length || state.waste.length) return { draw: true };
    return null;
  }

  // True when only final-pile moves are left: no hidden cards and nothing in stock or waste.
  function canAutoFinish(state) {
    return !state.stock.length && !state.waste.length &&
      state.tableau.every(function (col) { return col.every(function (s) { return s.up; }); });
  }

  // ---------- Browser interface ----------
  function mount(container) {
    const rnd = U.makeRng();
    let state = newGame(rnd);
    let history = [];
    let sel = null; // { src, dests }
    let hint = null;
    let note = '';
    let won = false;
    let alive = true;
    const timers = [];
    const root = U.el('div', { class: 'solitario game-panel' });
    container.appendChild(root);

    function snapshot() {
      history.push(JSON.stringify(state));
      if (history.length > 300) history.shift();
    }

    function newGameNow() {
      state = newGame(rnd);
      history = [];
      sel = null;
      hint = null;
      won = false;
      note = '';
      render();
    }

    function undo() {
      if (!history.length || won) return;
      state = JSON.parse(history.pop());
      sel = null;
      hint = null;
      note = 'Mossa annullata.';
      render();
    }

    function doMove(src, dst) {
      snapshot();
      const r = move(state, src, dst);
      if (!r.ok) {
        history.pop();
        return false;
      }
      sel = null;
      hint = null;
      note = '';
      if (A) dst.type === 'found' ? A.sfx.ok() : A.sfx.place();
      if (isWon(state)) {
        won = true;
        if (A) A.sfx.win();
      }
      render();
      return true;
    }

    function sameSrc(a, b) {
      return a.type === b.type && a.col === b.col && a.idx === b.idx && a.suit === b.suit;
    }

    // Click on a card: one destination moves at once, several let the player choose.
    function clickSource(src) {
      if (won) return;
      if (sel && sameSrc(sel.src, src)) {
        sel = null;
        return render();
      }
      const dests = destinations(state, src);
      if (!dests.length) {
        sel = null;
        note = 'Questa carta non si può spostare adesso.';
        if (A) A.sfx.bad();
        return render();
      }
      if (dests.length === 1) return doMove(src, dests[0]);
      sel = { src: src, dests: dests };
      note = 'Scegli dove mettere la carta: tocca una delle destinazioni illuminate.';
      if (A) A.sfx.click();
      render();
    }

    function clickDest(dst) {
      if (!sel) return false;
      const ok = sel.dests.some(function (d) { return d.type === dst.type && d.col === dst.col && d.suit === dst.suit; });
      if (!ok) return false;
      doMove(sel.src, dst);
      return true;
    }

    function draw() {
      if (won) return;
      snapshot();
      if (!drawStock(state).ok) history.pop();
      else if (A) A.sfx.click();
      sel = null;
      hint = null;
      note = '';
      render();
    }

    function showHint() {
      if (won) return;
      const h = findHint(state);
      sel = null;
      hint = h;
      if (!h) note = 'Non vedo altre mosse. Puoi annullare o iniziare una nuova partita.';
      else if (h.draw) note = 'Prova a pescare una carta dal mazzo.';
      else note = 'Prova a spostare la carta illuminata.';
      render();
    }

    function autoFinish() {
      const stepOnce = function () {
        if (!alive || won) return;
        const f = findFoundationMove(state);
        if (!f) return;
        doMove(f.src, f.dst);
        timers.push(setTimeout(stepOnce, 90));
      };
      stepOnce();
    }

    function isDest(dst) {
      return !!sel && sel.dests.some(function (d) { return d.type === dst.type && d.col === dst.col && d.suit === dst.suit; });
    }

    function render() {
      if (!alive) return;
      root.innerHTML = '';
      const top = U.el('div', { class: 'sol-row' });
      const stock = state.stock.length
        ? D.cardEl(null, { hidden: true, onclick: draw })
        : U.el('div', { class: 'pcard empty', onclick: draw, title: 'Rigira il mazzo' }, state.waste.length ? U.el('span', { class: 'recycle', text: '↺' }) : null);
      if (hint && hint.draw) stock.classList.add('hinted');
      stock.setAttribute('data-role', 'stock');
      top.appendChild(stock);

      const wasteTop = state.waste.length ? state.waste[state.waste.length - 1].card : null;
      const waste = wasteTop
        ? D.cardEl(wasteTop, { selected: !!sel && sel.src.type === 'waste', onclick: function () { clickSource({ type: 'waste' }); } })
        : U.el('div', { class: 'pcard empty' });
      if (hint && hint.src && hint.src.type === 'waste') waste.classList.add('hinted');
      waste.setAttribute('data-role', 'waste');
      top.appendChild(waste);
      top.appendChild(U.el('div', { class: 'sol-gap' }));

      state.foundation.forEach(function (pile, suit) {
        const dst = { type: 'found', suit: suit };
        const topCard = pile.length ? pile[pile.length - 1] : null;
        const onclick = function () {
          if (clickDest(dst)) return;
          if (topCard) clickSource({ type: 'found', suit: suit });
        };
        let node;
        if (topCard) {
          node = D.cardEl(topCard, { selected: !!sel && sel.src.type === 'found' && sel.src.suit === suit, onclick: onclick });
        } else {
          node = U.el('div', { class: 'pcard empty found', onclick: onclick });
          node.innerHTML = D.suitSvg(suit, 'found-suit');
        }
        if (isDest(dst)) node.classList.add('dest');
        node.setAttribute('data-role', 'found-' + suit);
        top.appendChild(node);
      });
      root.appendChild(top);

      const board = U.el('div', { class: 'sol-row tableau' });
      let tallest = 0;
      state.tableau.forEach(function (col, ci) {
        const dst = { type: 'tab', col: ci };
        const colEl = U.el('div', { class: 'col' + (isDest(dst) ? ' dest' : ''), 'data-col': ci, onclick: function () { clickDest(dst); } });
        if (!col.length) colEl.appendChild(U.el('div', { class: 'pcard empty' }));
        let y = 0;
        col.forEach(function (slot, idx) {
          const src = { type: 'tab', col: ci, idx: idx };
          const selected = !!sel && sel.src.type === 'tab' && sel.src.col === ci && idx >= sel.src.idx;
          const node = slot.up
            ? D.cardEl(slot.card, {
              selected: selected,
              onclick: function (e) {
                e.stopPropagation();
                if (clickDest(dst)) return;
                clickSource(src);
              },
            })
            : D.cardEl(null, { hidden: true });
          node.classList.add('stacked');
          node.style.top = y + 'px';
          if (hint && hint.src && hint.src.type === 'tab' && hint.src.col === ci && hint.src.idx === idx) node.classList.add('hinted');
          colEl.appendChild(node);
          y += slot.up ? 30 : 12;
        });
        tallest = Math.max(tallest, y);
        board.appendChild(colEl);
      });
      board.style.height = (tallest + 110) + 'px';
      root.appendChild(board);

      const done = state.foundation.reduce(function (s, p) { return s + p.length; }, 0);
      root.appendChild(U.el('div', { class: 'msg', text: note || 'Tocca una carta per spostarla. Tocca il mazzo per pescare.' }));
      const actions = U.el('div', { class: 'actions' },
        U.el('button', { class: 'btn', text: 'Suggerimento 💡', onclick: showHint }),
        U.el('button', { class: 'btn', text: 'Annulla ↩', onclick: undo }),
        U.el('button', { class: 'btn ghost', text: 'Nuova partita', onclick: newGameNow }));
      if (!won && canAutoFinish(state)) {
        actions.insertBefore(U.el('button', { class: 'btn', text: 'Completa da solo ✨', onclick: autoFinish }), actions.firstChild);
      }
      root.appendChild(actions);
      root.appendChild(U.el('div', { class: 'hint', text: 'Mosse: ' + state.moves + ' · Carte nelle pile finali: ' + done + ' su 40' }));

      if (won) {
        root.appendChild(U.el('div', { class: 'overlay' }, U.el('div', { class: 'card-box' },
          U.el('h2', { text: 'Hai vinto! 🦝🎉' }),
          U.el('p', { text: 'Tutte le carte sono nelle pile finali. Mosse: ' + state.moves + '.' }),
          U.el('button', { class: 'btn big', text: 'Nuova partita', onclick: newGameNow }))));
      }
    }

    render();
    return {
      destroy: function () {
        alive = false;
        timers.forEach(clearTimeout);
      },
      debug: {
        get state() { return state; },
        set state(s) { state = s; history = []; sel = null; won = isWon(s); render(); },
        get won() { return won; },
        findHint: function () { return findHint(state); },
      },
    };
  }

  return {
    meta: { id: 'solitario', title: 'Solitario', icon: '🎴', desc: 'Il solitario classico con le carte Piacentine dei procioni.' },
    mount: mount,
    newGame: newGame,
    move: move,
    drawStock: drawStock,
    isWon: isWon,
    destinations: destinations,
    findHint: findHint,
    findFoundationMove: findFoundationMove,
    canAutoFinish: canAutoFinish,
    canToTableau: canToTableau,
  };
});
