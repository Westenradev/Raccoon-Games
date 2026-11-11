// The 40-card Piacentine deck: Coppe, Denari, Spade, Bastoni, ranks 1 to 7 plus Fante, Cavallo, Re.
// Card faces are scans of a real Piacentine deck (public domain, see CREDITS.md).
// Used by Scopa, Briscola and Solitario.
(function (name, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else (window.RA = window.RA || { modules: {} }).modules[name] = api;
})('deck', function () {
  const U = typeof require === 'function' ? require('../core/util.js') : window.RA.modules.util;

  // Suit index is used in card ids: id = suit * 10 + (rank - 1).
  const SUITS = [
    { key: 'coppe', name: 'Coppe' },
    { key: 'denari', name: 'Denari' },
    { key: 'spade', name: 'Spade' },
    { key: 'bastoni', name: 'Bastoni' },
  ];
  const DENARI = 1;

  // Ranks 1..10. 8 = Fante, 9 = Cavallo, 10 = Re.
  const RANK_NAMES = { 1: 'Asso', 8: 'Fante', 9: 'Cavallo', 10: 'Re' };
  // Scopa primiera values (ranks 1..10).
  const PRIMIERA = { 1: 16, 2: 12, 3: 13, 4: 14, 5: 15, 6: 18, 7: 21, 8: 10, 9: 10, 10: 10 };

  const IMAGE_DIR = 'assets/cards/piacentine/';

  function imageOf(card) {
    return IMAGE_DIR + SUITS[card.suit].key + '-' + card.rank + '.webp';
  }

  function makeDeck() {
    const cards = [];
    for (let s = 0; s < 4; s++) {
      for (let r = 1; r <= 10; r++) {
        cards.push({ id: s * 10 + (r - 1), suit: s, rank: r });
      }
    }
    return cards;
  }

  // "7 di Denari", "Re di Coppe".
  function cardName(card) {
    return (RANK_NAMES[card.rank] || String(card.rank)) + ' di ' + SUITS[card.suit].name;
  }

  // Builds the DOM for one card. opts: { hidden, selected, small, disabled, onclick }.
  function cardEl(card, opts) {
    const o = opts || {};
    const size = o.small ? ' small' : '';
    if (o.hidden || !card) {
      return U.el('div', { class: 'pcard back' + size, onclick: o.onclick });
    }
    const cls = 'pcard' + size + (o.selected ? ' selected' : '') + (o.disabled ? ' disabled' : '');
    return U.el('div', { class: cls, title: cardName(card), 'data-card': card.id, onclick: o.onclick },
      U.el('img', { src: imageOf(card), alt: cardName(card), draggable: 'false' }));
  }

  return {
    SUITS: SUITS,
    DENARI: DENARI,
    PRIMIERA: PRIMIERA,
    makeDeck: makeDeck,
    cardName: cardName,
    cardEl: cardEl,
    imageOf: imageOf,
    isFigure: function (card) { return card.rank >= 8; },
  };
});
