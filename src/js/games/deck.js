// Piacentino-style 40-card deck. Suits are the traditional ones: Coppe, Denari, Spade, Bastoni.
// The court cards are double-headed like real Piacentine cards, with animals for the people:
// Fante = Topo, Cavallo = Gatto on a horse, Re = Procione with a crown.
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
  const FIGURES = {
    8: { name: 'Fante', animal: 'Topo', art: ['🐭'] },
    9: { name: 'Cavallo', animal: 'Gatto', art: ['🐱', '🐴'] },
    10: { name: 'Re', animal: 'Procione', art: ['👑', '🦝'] },
  };

  // Scopa primiera values (ranks 1..10).
  const PRIMIERA = { 1: 16, 2: 12, 3: 13, 4: 14, 5: 15, 6: 18, 7: 21, 8: 10, 9: 10, 10: 10 };

  // Pips per row for the number cards.
  const PIP_ROWS = { 2: [1, 1], 3: [1, 1, 1], 4: [2, 2], 5: [2, 1, 2], 6: [2, 2, 2], 7: [2, 1, 2, 2] };

  // Small drawings of the four suits. viewBox is 24 x 24.
  const SUIT_ART = [
    // Coppe: a red and gold goblet.
    '<path d="M6 2.5h12v5.5a6 6 0 0 1-12 0z" fill="#dc2626" stroke="#7f1d1d" stroke-width="1.2"/>' +
      '<path d="M6 5h12" stroke="#fbbf24" stroke-width="1.6"/>' +
      '<rect x="10.8" y="13.4" width="2.4" height="4.6" fill="#f5c518" stroke="#a16207" stroke-width="0.8"/>' +
      '<path d="M7 21.5h10l-2-3.5H9z" fill="#f5c518" stroke="#a16207" stroke-width="1"/>',
    // Denari: a gold coin.
    '<circle cx="12" cy="12" r="10" fill="#f5c518" stroke="#a16207" stroke-width="1.5"/>' +
      '<circle cx="12" cy="12" r="6.2" fill="#fde68a" stroke="#a16207" stroke-width="1"/>' +
      '<circle cx="12" cy="12" r="2.4" fill="#dc2626" stroke="#7f1d1d" stroke-width="0.8"/>',
    // Spade: a straight sword.
    '<path d="M12 1l2.3 4v11h-4.6V5z" fill="#bfdbfe" stroke="#1e3a8a" stroke-width="1.1"/>' +
      '<path d="M12 3v12" stroke="#1e3a8a" stroke-width="0.7"/>' +
      '<rect x="6.5" y="15.6" width="11" height="2.2" rx="1" fill="#f5c518" stroke="#a16207" stroke-width="0.8"/>' +
      '<rect x="10.9" y="17.8" width="2.2" height="3.6" fill="#7c2d12"/>' +
      '<circle cx="12" cy="22.2" r="1.5" fill="#f5c518" stroke="#a16207" stroke-width="0.7"/>',
    // Bastoni: a wooden club, thick at the top, with two knots.
    '<path d="M8.6 5.2c0-2.3 1.5-3.7 3.4-3.700s3.4 1.4 3.4 3.700c0 4.3-1.2 8.8-1.8 13.200l-.4 3.600h-2.400l-.4-3.600C9.8 14 8.6 9.5 8.6 5.200z" fill="#a16207" stroke="#5b3a0a" stroke-width="1.2"/>' +
      '<path d="M8.9 8.5 6.3 7.200M15.1 11.500l2.6-1.3" stroke="#5b3a0a" stroke-width="1.8" stroke-linecap="round"/>' +
      '<ellipse cx="12" cy="5.6" rx="1.5" ry="1" fill="#5b3a0a"/><ellipse cx="12.3" cy="11.5" rx="1" ry="0.7" fill="#5b3a0a"/>',
  ];

  function suitSvg(suit, cls) {
    return '<svg class="suit ' + (cls || '') + '" viewBox="0 0 24 24" aria-hidden="true">' + SUIT_ART[suit] + '</svg>';
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

  function faceHtml(card) {
    if (FIGURES[card.rank]) {
      const half = '<div class="fig-half">' +
        '<span class="fig-art r' + card.rank + '">' + FIGURES[card.rank].art.map(function (e) { return '<i>' + e + '</i>'; }).join('') + '</span>' +
        suitSvg(card.suit, 'fig-suit') + '</div>';
      return '<div class="face figure">' + half + '<div class="fig-band"></div>' + half.replace('fig-half', 'fig-half flip') + '</div>';
    }
    if (card.rank === 1) {
      return '<div class="face ace">' + suitSvg(card.suit, 'ace-suit') + '<span class="ace-pet">🦝</span></div>';
    }
    const rows = PIP_ROWS[card.rank].map(function (n) {
      let row = '<div class="pip-row">';
      for (let i = 0; i < n; i++) row += suitSvg(card.suit, 'pip');
      return row + '</div>';
    }).join('');
    return '<div class="face pips n' + card.rank + '">' + rows + '</div>';
  }

  // Builds the DOM for one card. opts: { hidden, selected, small, disabled, onclick }.
  function cardEl(card, opts) {
    const o = opts || {};
    const size = o.small ? ' small' : '';
    if (o.hidden || !card) {
      return U.el('div', { class: 'pcard back' + size, onclick: o.onclick }, U.el('span', { class: 'back-art', text: '🦝' }));
    }
    const cls = 'pcard suit-' + SUITS[card.suit].key + size + (o.selected ? ' selected' : '') + (o.disabled ? ' disabled' : '');
    const node = U.el('div', { class: cls, title: cardName(card), 'data-card': card.id, onclick: o.onclick });
    const idx = '<b>' + card.rank + '</b>' + suitSvg(card.suit, 'idx-suit');
    node.innerHTML = '<div class="idx tl">' + idx + '</div><div class="idx br">' + idx + '</div>' + faceHtml(card);
    return node;
  }

  return {
    SUITS: SUITS,
    DENARI: DENARI,
    FIGURES: FIGURES,
    PRIMIERA: PRIMIERA,
    makeDeck: makeDeck,
    cardName: cardName,
    cardEl: cardEl,
    suitSvg: suitSvg,
    isFigure: function (card) { return card.rank >= 8; },
  };
});
