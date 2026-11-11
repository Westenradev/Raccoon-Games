// Raccoon Arcade: main menu and game router.
(function () {
  const RA = window.RA;
  const M = RA.modules;
  const U = M.util;
  const D = M.deck;

  // The menu has two shelves: games played at the table, and games of the arcade room.
  const SHELVES = [
    { key: 'table', title: 'Al tavolo', ids: ['scopa', 'briscola', 'solitario', 'dama', 'sudoku', 'mahjong'] },
    { key: 'arcade', title: 'Sala giochi', ids: ['tetris', 'bubbles', 'invaders', 'pacman', 'snake'] },
  ];
  const ARCADE = SHELVES[1].ids;

  const stage = document.getElementById('stage');
  const homeBtn = document.getElementById('home');
  const muteBtn = document.getElementById('mute');
  let current = null;

  function setMuteLabel() {
    muteBtn.textContent = RA.audio.isMuted() ? 'Suono: no' : 'Suono: sì';
  }

  function card(suit, rank, style) {
    const node = D.cardEl({ id: suit * 10 + rank - 1, suit: suit, rank: rank }, { disabled: true });
    node.style.cssText = style;
    return node;
  }

  // Small pictures for the table games. Arcade games draw their own on a canvas.
  const THUMBS = {
    scopa: function (el) {
      el.append(
        card(1, 7, 'left:16%;top:22%;transform:rotate(-7deg)'),
        card(0, 1, 'left:33%;top:16%;transform:rotate(-2deg)'),
        card(2, 10, 'left:50%;top:16%;transform:rotate(3deg)'),
        card(3, 3, 'left:67%;top:22%;transform:rotate(8deg)'));
    },
    briscola: function (el) {
      const back = D.cardEl(null, { hidden: true });
      back.style.cssText = 'left:14%;top:18%';
      el.append(
        card(2, 1, 'left:24%;top:18%;transform:rotate(90deg)'),
        back,
        card(0, 3, 'left:56%;top:14%;transform:rotate(-6deg)'),
        card(3, 10, 'left:70%;top:20%;transform:rotate(7deg)'));
    },
    solitario: function (el) {
      el.style.background = 'radial-gradient(ellipse at 50% 30%, #12804a, #0b5a33)';
      [[0, 10], [2, 9], [1, 8], [3, 7], [0, 6]].forEach(function (c, i) {
        el.appendChild(card(c[0], c[1], 'left:' + (12 + i * 16) + '%;top:' + (10 + i * 9) + '%'));
      });
    },
    dama: function (el) {
      const board = U.el('div', { class: 'checker-board', style: 'width:150px;min-width:0;border-width:6px;outline-offset:-5px;grid-template-columns:repeat(4,1fr);grid-template-rows:repeat(4,1fr)' });
      const pieces = { 0: 'black', 2: 'black', 5: 'black damone', 10: 'white', 13: 'white', 15: 'white' };
      for (let i = 0; i < 16; i++) {
        const dark = ((i >> 2) + (i & 3)) % 2 === 0;
        const sq = U.el('div', { class: 'sq ' + (dark ? 'dark' : 'light') });
        if (pieces[i]) sq.appendChild(U.el('div', { class: 'piece ' + pieces[i] }));
        board.appendChild(sq);
      }
      el.appendChild(U.el('div', { class: 'thumb-wood' }, board));
    },
    sudoku: function (el) {
      const grid = U.el('div', { class: 'sudoku-grid', style: 'width:132px;min-width:0;grid-template-columns:repeat(3,1fr);grid-template-rows:repeat(3,1fr)' });
      ['5', '', '9', '', '7', '', '2', '', '4'].forEach(function (v, i) {
        grid.appendChild(U.el('div', { class: 'cell' + (i === 4 ? ' sel' : ' given'), style: 'font-size:26px', text: v }));
      });
      el.appendChild(U.el('div', { class: 'thumb-paper' }, grid));
    },
    mahjong: function (el) {
      const wrap = U.el('div', { class: 'thumb-jade' });
      [['g0', 16, 26, -6], ['d5', 39, 20, 0], ['b8', 62, 26, 6]].forEach(function (t) {
        const tile = U.el('div', { class: 'mj-tile', style: 'left:' + t[1] + '%;top:' + t[2] + '%;width:58px;height:78px;transform:rotate(' + t[3] + 'deg)' });
        tile.innerHTML = M.mahjong.faceSvg(t[0]);
        wrap.appendChild(tile);
      });
      el.appendChild(wrap);
    },
  };

  function stopCurrent() {
    if (current && current.destroy) current.destroy();
    current = null;
    RA.current = null;
    RA.currentId = null;
  }

  function showMenu() {
    stopCurrent();
    RA.audio.stopAmbient();
    homeBtn.hidden = true;
    document.body.classList.remove('arcade-mode');
    stage.innerHTML = '';
    stage.className = 'menu';
    stage.appendChild(U.el('div', { class: 'menu-head' },
      U.el('h1', { text: 'Raccoon Arcade' }),
      U.el('p', { text: 'Undici giochi. Scegline uno: per tornare qui premi Esc.' })));
    SHELVES.forEach(function (shelf) {
      stage.appendChild(U.el('h2', { class: 'shelf-title', text: shelf.title }));
      const row = U.el('div', { class: 'shelf ' + shelf.key });
      shelf.ids.forEach(function (id) {
        const mod = M[id];
        if (!mod) return;
        const thumb = U.el('div', { class: 'thumb' });
        try {
          if (THUMBS[id]) THUMBS[id](thumb);
          else if (mod.thumb) mod.thumb(thumb);
        } catch (err) {
          console.error(err);
        }
        row.appendChild(U.el('button', {
          class: 'tile',
          'data-game': id,
          onclick: function () {
            RA.audio.sfx.click();
            openGame(id);
          },
        }, thumb,
        // A game that was left in the middle waits here to be taken up again.
        M.saves.has(id) ? U.el('div', { class: 'tile-badge', text: 'Partita in sospeso' }) : null,
        U.el('div', { class: 'tile-title', text: mod.meta.title }),
        U.el('div', { class: 'tile-desc', text: mod.meta.desc })));
      });
      stage.appendChild(row);
    });
    window.scrollTo(0, 0);
  }

  function openGame(id) {
    stopCurrent();
    stage.innerHTML = '';
    stage.className = 'play';
    homeBtn.hidden = false;
    document.body.classList.toggle('arcade-mode', ARCADE.indexOf(id) >= 0);
    window.scrollTo(0, 0);
    try {
      current = M[id].mount(stage);
      RA.current = current;
      RA.currentId = id;
    } catch (err) {
      console.error(err);
      stage.appendChild(U.el('div', { class: 'card-box' },
        U.el('h2', { text: 'Questo gioco non si avvia' }),
        U.el('p', { text: String(err && err.message ? err.message : err) }),
        U.el('button', { class: 'btn', text: 'Torna al menu', onclick: showMenu })));
    }
  }

  // The buttons lose focus after a click, so the space bar in a game does not press them again.
  homeBtn.addEventListener('click', function () {
    RA.audio.sfx.click();
    homeBtn.blur();
    showMenu();
  });
  muteBtn.addEventListener('click', function () {
    RA.audio.setMuted(!RA.audio.isMuted());
    setMuteLabel();
    muteBtn.blur();
  });

  // Closing the app (or reloading the page) keeps the game in progress, like the Menu button.
  const saveCurrent = function () {
    if (current && current.save) current.save();
  };
  window.addEventListener('beforeunload', saveCurrent);
  window.addEventListener('pagehide', saveCurrent);

  // Escape returns to the menu from any game.
  window.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && !homeBtn.hidden) showMenu();
  });

  setMuteLabel();
  showMenu();

  // Used by the automated browser tests.
  RA.openGame = openGame;
  RA.showMenu = showMenu;
})();
