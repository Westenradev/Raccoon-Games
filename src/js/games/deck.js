// Piacentino-style 40-card deck with animal figures. Used by Scopa, Briscola and Solitario.
(function (name, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else (window.RA = window.RA || { modules: {} }).modules[name] = api;
})('deck', function () {
  const U = typeof require === 'function' ? require('../core/util.js') : window.RA.modules.util;

  // Suits. Index is used in card ids.
  const SUITS = [
    { key: 'coppe', name: 'Ciotole', icon: '🥛', color: '#dbeafe' },
    { key: 'denari', name: 'Formaggi', icon: '🧀', color: '#fef3c7' },
    { key: 'spade', name: 'Pesci', icon: '🐟', color: '#dcfce7' },
    { key: 'bastoni', name: 'Ossa', icon: '🦴', color: '#fce7f3' },
  ];

  // Ranks 1..10. 8 = Topo (mouse), 9 = Chihuahua, 10 = Gatto Re (cat king).
  const FIGURES = { 8: { label: 'T', icon: '🐭', name: 'Topo' }, 9: { label: 'C', icon: '🐕', name: 'Chihuahua' }, 10: { label: 'R', icon: '🐱', name: 'Gatto Re' } };

  // Scopa primiera values (ranks 1..10).
  const PRIMIERA = { 1: 16, 2: 12, 3: 13, 4: 14, 5: 15, 6: 18, 7: 21, 8: 10, 9: 10, 10: 10 };

  function makeDeck() {
    const cards = [];
    for (let s = 0; s < 4; s++) {
      for (let r = 1; r <= 10; r++) {
        cards.push({ id: s * 10 + (r - 1), suit: s, rank: r });
      }
    }
    return cards;
  }

  function cardLabel(card) {
    if (FIGURES[card.rank]) return FIGURES[card.rank].label;
    return String(card.rank);
  }

  function cardTitle(card) {
    const figure = FIGURES[card.rank] ? FIGURES[card.rank].name : (card.rank === 1 ? 'Procione' : 'Numero ' + card.rank);
    return figure + ' di ' + SUITS[card.suit].name;
  }

  // Builds the DOM for one card. opts: { hidden, selected, small, onclick }.
  function cardEl(card, opts) {
    const o = opts || {};
    if (o.hidden || !card) {
      return U.el('div', { class: 'pcard back' + (o.small ? ' small' : ''), onclick: o.onclick }, U.el('span', { class: 'back-art', text: '🦝' }));
    }
    const suit = SUITS[card.suit];
    const cls = 'pcard' + (o.selected ? ' selected' : '') + (o.small ? ' small' : '') + (o.disabled ? ' disabled' : '');
    const node = U.el('div', { class: cls, title: cardTitle(card), style: 'background:' + suit.color, onclick: o.onclick });
    node.appendChild(U.el('div', { class: 'corner tl' }, U.el('b', { text: cardLabel(card) }), U.el('i', { text: suit.icon })));
    node.appendChild(U.el('div', { class: 'corner br' }, U.el('b', { text: cardLabel(card) }), U.el('i', { text: suit.icon })));
    const center = U.el('div', { class: 'center' });
    if (FIGURES[card.rank]) {
      center.appendChild(U.el('div', { class: 'figure', text: FIGURES[card.rank].icon }));
      if (card.rank === 10) center.appendChild(U.el('div', { class: 'crown', text: '👑' }));
    } else if (card.rank === 1) {
      center.appendChild(U.el('div', { class: 'figure', text: '🦝' }));
    } else {
      const pips = U.el('div', { class: 'pips n' + card.rank });
      for (let i = 0; i < card.rank; i++) pips.appendChild(U.el('span', { text: suit.icon }));
      center.appendChild(pips);
    }
    node.appendChild(center);
    return node;
  }

  return {
    SUITS: SUITS,
    FIGURES: FIGURES,
    PRIMIERA: PRIMIERA,
    makeDeck: makeDeck,
    cardLabel: cardLabel,
    cardTitle: cardTitle,
    cardEl: cardEl,
    isFigure: function (card) { return card.rank >= 8; },
  };
});
