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
  const SV = isNode ? null : window.RA.modules.saves;

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
    // Turning cards from the stock helps only when one of those cards can go somewhere.
    const hidden = state.stock.concat(state.waste);
    const useful = hidden.some(function (slot) {
      const c = slot.card;
      if (canToFoundation(c, c.suit, state)) return true;
      return state.tableau.some(function (col) { return canToTableau(c, col.length ? col[col.length - 1] : null); });
    });
    if (useful) return { draw: true };
    return lookAhead(state);
  }

  // Every move between columns and to the final piles, from any face-up card.
  function tableMoves(state) {
    const out = [];
    state.tableau.forEach(function (col, ci) {
      col.forEach(function (slot, idx) {
        if (!slot.up) return;
        const src = { type: 'tab', col: ci, idx: idx };
        destinations(state, src).forEach(function (dst) { out.push({ src: src, dst: dst }); });
      });
    });
    if (state.waste.length) {
      destinations(state, { type: 'waste' }).forEach(function (dst) { out.push({ src: { type: 'waste' }, dst: dst }); });
    }
    return out;
  }

  // Looks a few moves ahead for a way to turn a card over or to fill a final pile.
  // Returns the first move of the shortest way, or null.
  function lookAhead(state) {
    const value = function (s) {
      let hidden = 0;
      s.tableau.forEach(function (col) { col.forEach(function (slot) { if (!slot.up) hidden += 1; }); });
      return s.foundation.reduce(function (n, p) { return n + p.length; }, 0) - hidden;
    };
    const base = value(state);
    let layer = [{ state: state, first: null }];
    const seen = {};
    for (let depth = 0; depth < 4; depth++) {
      const next = [];
      for (const node of layer) {
        for (const mv of tableMoves(node.state)) {
          const copy = JSON.parse(JSON.stringify(node.state));
          if (!move(copy, mv.src, mv.dst).ok) continue;
          const first = node.first || mv;
          if (value(copy) > base) return first;
          const k = JSON.stringify([copy.tableau, copy.waste.length, copy.foundation]);
          if (seen[k]) continue;
          seen[k] = true;
          next.push({ state: copy, first: first });
        }
      }
      if (!next.length || next.length > 400) break;
      layer = next;
    }
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
    let autoRun = 0; // changes when a new game starts, so an old auto-finish stops
    const timers = [];
    const root = U.el('div', { class: 'solitario game-panel tabletop' });
    container.appendChild(root);

    function snapshot() {
      history.push(JSON.stringify(state));
      if (history.length > 300) history.shift();
    }

    function newGameNow() {
      autoRun += 1;
      state = newGame(rnd);
      history = [];
      sel = null;
      hint = null;
      won = false;
      celebrated = false;
      note = '';
      if (A) A.sfx.shuffle();
      render();
    }

    // ----- saved game -----
    function persist() {
      if (asking) return; // the saved game is still waiting for an answer
      if (won || state.moves === 0) return SV.clear('solitario');
      SV.save('solitario', { state: state, history: history.slice(-40) });
    }

    function restore(saved) {
      state = saved.state;
      history = saved.history || [];
      note = 'Partita ripresa da dove l\'avevi lasciata.';
      render();
    }

    function undo() {
      autoRun += 1;
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
      if (A) {
        A.sfx.card();
        if (dst.type === 'found') A.sfx.ok();
      }
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
    function clickSource(src, e) {
      if (won) return;
      // The second click of a double click must not move another card.
      if (e && e.detail > 1) return;
      if (sel && sameSrc(sel.src, src)) {
        sel = null;
        note = '';
        return render();
      }
      const dests = destinations(state, src);
      if (!dests.length) {
        sel = null;
        note = 'Questa carta non si può spostare adesso.';
        if (A) A.sfx.bad();
        return render();
      }
      // A card of a final pile never moves by itself: the player chooses where it goes.
      if (dests.length === 1 && src.type !== 'found') return doMove(src, dests[0]);
      sel = { src: src, dests: dests };
      note = dests.length === 1 ? 'Tocca la colonna illuminata per riportare giù la carta.' : 'Questa carta può andare in più posti. Tocca il posto che preferisci.';
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
      else if (A) A.sfx.flip();
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
      else if (h.draw) note = 'Prova a girare una carta dal mazzo.';
      else note = 'Prova a spostare la carta illuminata.';
      render();
    }

    function autoFinish() {
      const run = ++autoRun;
      const stepOnce = function () {
        if (!alive || won || run !== autoRun) return;
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

    // Small tag with the value of the card. Piacentine cards have no numbers in the corner,
    // so the tag helps when cards overlap. Red tag: Coppe and Denari. Blue tag: Spade and Bastoni.
    function tagged(node, card) {
      node.appendChild(U.el('span', { class: 'rank-tag g' + (card.suit < 2 ? 0 : 1), text: String(card.rank) }));
      return node;
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
        ? tagged(D.cardEl(wasteTop, { selected: !!sel && sel.src.type === 'waste', onclick: function (e) { clickSource({ type: 'waste' }, e); } }), wasteTop)
        : U.el('div', { class: 'pcard empty' });
      if (hint && hint.src && hint.src.type === 'waste') waste.classList.add('hinted');
      waste.setAttribute('data-role', 'waste');
      top.appendChild(waste);
      top.appendChild(U.el('div', { class: 'sol-gap' }));

      state.foundation.forEach(function (pile, suit) {
        const dst = { type: 'found', suit: suit };
        const topCard = pile.length ? pile[pile.length - 1] : null;
        const onclick = function (e) {
          if (clickDest(dst)) return;
          if (topCard) clickSource({ type: 'found', suit: suit }, e);
        };
        let node;
        if (topCard) {
          node = tagged(D.cardEl(topCard, { selected: !!sel && sel.src.type === 'found' && sel.src.suit === suit, onclick: onclick }), topCard);
        } else {
          // An empty pile shows a faint Asso of its suit.
          node = U.el('div', { class: 'pcard empty found', onclick: onclick, title: 'Qui va l\'Asso di ' + D.SUITS[suit].name },
            U.el('img', { src: D.imageOf({ suit: suit, rank: 1 }), alt: '', draggable: 'false' }));
        }
        if (isDest(dst)) node.classList.add('dest');
        node.setAttribute('data-role', 'found-' + suit);
        top.appendChild(node);
      });
      root.appendChild(top);

      // Cards overlap less when a column is long, so the table never needs to scroll.
      // The real size of a card on screen, and the height that is free for the columns.
      const cardBox = stock.getBoundingClientRect();
      const cw = cardBox.width || 86;
      const cardH = cardBox.height || (cw * 716) / 384;
      const room = Math.max(cardH + 60, window.innerHeight - cardBox.bottom - 190);
      const board = U.el('div', { class: 'sol-row tableau' });
      let tallest = 0;
      state.tableau.forEach(function (col, ci) {
        const dst = { type: 'tab', col: ci };
        const colEl = U.el('div', { class: 'col' + (isDest(dst) ? ' dest' : ''), 'data-col': ci, onclick: function () { clickDest(dst); } });
        if (!col.length) colEl.appendChild(U.el('div', { class: 'pcard empty' }));
        const downs = col.filter(function (c) { return !c.up; }).length;
        const ups = col.length - downs;
        const downStep = cw * 0.13;
        // Never less than 24 px, so the value tag of every card stays readable.
        const upStep = ups > 1 ? Math.max(24, Math.min(cw * 0.4, (room - cardH - downs * downStep) / (ups - 1))) : 0;
        let y = 0;
        col.forEach(function (slot, idx) {
          const src = { type: 'tab', col: ci, idx: idx };
          const selected = !!sel && sel.src.type === 'tab' && sel.src.col === ci && idx >= sel.src.idx;
          const node = slot.up
            ? tagged(D.cardEl(slot.card, {
              selected: selected,
              onclick: function (e) {
                e.stopPropagation();
                if (clickDest(dst)) return;
                clickSource(src, e);
              },
            }), slot.card)
            : D.cardEl(null, { hidden: true });
          node.classList.add('stacked');
          node.style.top = y + 'px';
          if (hint && hint.src && hint.src.type === 'tab' && hint.src.col === ci && hint.src.idx === idx) node.classList.add('hinted');
          colEl.appendChild(node);
          if (idx < col.length - 1) y += slot.up ? upStep : downStep;
        });
        tallest = Math.max(tallest, y);
        board.appendChild(colEl);
      });
      board.style.height = (tallest + cardH + 6) + 'px';
      root.appendChild(board);

      const done = state.foundation.reduce(function (s, p) { return s + p.length; }, 0);
      root.appendChild(U.el('div', { class: 'msg', text: note || 'Tocca una carta per spostarla. Tocca il mazzo per girare una carta.' }));
      const actions = U.el('div', { class: 'actions' },
        U.el('button', { class: 'btn', text: 'Suggerimento', onclick: showHint }),
        U.el('button', { class: 'btn', text: 'Annulla mossa', onclick: undo }),
        U.el('button', { class: 'btn ghost', text: 'Nuova partita', onclick: newGameNow }));
      if (!won && canAutoFinish(state)) {
        actions.insertBefore(U.el('button', { class: 'btn pulse', text: 'Completa da solo', onclick: autoFinish }), actions.firstChild);
      }
      root.appendChild(actions);
      root.appendChild(U.el('div', { class: 'hint', text: 'Mosse: ' + state.moves + '. Carte nelle pile finali: ' + done + ' su 40. In colonna si scende di uno, alternando etichetta rossa e blu.' }));

      if (won) showWin();
    }

    function winCard() {
      root.appendChild(U.el('div', { class: 'overlay' }, U.el('div', { class: 'card-box' },
        U.el('h2', { text: 'Solitario riuscito!' }),
        U.el('p', { text: 'Tutte le 40 carte sono nelle pile finali. Mosse: ' + state.moves + '.' }),
        U.el('button', { class: 'btn big', text: 'Nuova partita', onclick: newGameNow }))));
    }

    // Win: the cards jump out of the final piles and bounce across the table,
    // leaving a trail, like the classic computer solitaire.
    let celebrated = false;
    function showWin() {
      if (celebrated || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return winCard();
      celebrated = true;
      const rootBox = root.getBoundingClientRect();
      const canvas = U.el('canvas', { class: 'cascade' });
      canvas.width = rootBox.width;
      canvas.height = rootBox.height;
      root.appendChild(canvas);
      const g = canvas.getContext('2d');
      const sample = root.querySelector('[data-role="found-0"]').getBoundingClientRect();
      const cw = sample.width || 86;
      const ch = sample.height || (cw * 716) / 384;
      const queue = [];
      for (let rank = 10; rank >= 1; rank--) {
        for (let suit = 0; suit < 4; suit++) {
          const el = root.querySelector('[data-role="found-' + suit + '"]');
          const box = el.getBoundingClientRect();
          const img = new Image();
          img.src = D.imageOf({ suit: suit, rank: rank });
          queue.push({ img: img, x: box.left - rootBox.left, y: box.top - rootBox.top });
        }
      }
      const flying = [];
      let frame = 0;
      const startedAt = Date.now();
      const tick = function () {
        if (!alive || !canvas.isConnected) return;
        frame += 1;
        if (frame % 5 === 1 && queue.length) {
          const c = queue.shift();
          c.vx = (Math.random() < 0.5 ? -1 : 1) * (2 + Math.random() * 4);
          c.vy = -Math.random() * 6;
          flying.push(c);
        }
        for (let i = flying.length - 1; i >= 0; i--) {
          const c = flying[i];
          c.vy += 0.55;
          c.x += c.vx;
          c.y += c.vy;
          if (c.y + ch > canvas.height) {
            c.y = canvas.height - ch;
            c.vy = -c.vy * 0.82;
          }
          if (c.img.complete) g.drawImage(c.img, c.x, c.y, cw, ch);
          if (c.x < -cw || c.x > canvas.width) flying.splice(i, 1);
        }
        if ((!queue.length && !flying.length) || Date.now() - startedAt > 8000) {
          skip.remove();
          canvas.remove();
          return winCard();
        }
        requestAnimationFrame(tick);
      };
      const skip = U.el('div', { class: 'cascade-skip', text: 'Tocca per saltare' });
      root.appendChild(skip);
      canvas.style.pointerEvents = 'auto';
      canvas.addEventListener('click', function () {
        skip.remove();
        canvas.remove();
        winCard();
      });
      requestAnimationFrame(tick);
    }

    // The spacing of the columns depends on the window height.
    const onResize = function () { if (alive && !celebrated) render(); };
    window.addEventListener('resize', onResize);
    const saved = SV.load('solitario');
    let asking = !!saved;
    if (saved) {
      const done = saved.state.foundation.reduce(function (n, p) { return n + p.length; }, 0);
      SV.ask(root, 'Solitario: ' + saved.state.moves + ' mosse fatte, ' + done + ' carte su 40 nelle pile finali.',
        function () { asking = false; restore(saved); },
        function () { asking = false; SV.clear('solitario'); newGameNow(); });
    } else {
      render();
    }
    return {
      destroy: function () {
        persist();
        alive = false;
        window.removeEventListener('resize', onResize);
        timers.forEach(clearTimeout);
      },
      save: persist,
      debug: {
        get state() { return state; },
        set state(s) { autoRun += 1; state = s; history = []; sel = null; won = isWon(s); celebrated = false; render(); },
        get won() { return won; },
        findHint: function () { return findHint(state); },
      },
    };
  }

  return {
    meta: { id: 'solitario', title: 'Solitario', desc: 'Il solitario classico, con le carte piacentine.' },
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
