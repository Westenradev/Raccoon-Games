// Raccoon Arcade main menu and game router.
(function () {
  const RA = window.RA;
  const M = RA.modules;
  const U = M.util;

  // Order on the menu.
  const ORDER = ['scopa', 'briscola', 'solitario', 'sudoku', 'mahjong', 'dama', 'bubbles', 'tetris', 'invaders', 'pacman', 'snake'];

  const stage = document.getElementById('stage');
  const homeBtn = document.getElementById('home');
  const muteBtn = document.getElementById('mute');
  let current = null;

  function setMuteIcon() {
    const m = RA.audio.isMuted();
    muteBtn.textContent = m ? '🔇' : '🔊';
    muteBtn.title = m ? 'Audio spento. Clicca per accendere.' : 'Audio acceso. Clicca per spegnere.';
  }

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
    stage.innerHTML = '';
    stage.className = 'menu';
    const grid = U.el('div', { class: 'menu-grid' });
    ORDER.forEach(function (id) {
      const mod = M[id];
      if (!mod) return;
      const meta = mod.meta;
      grid.appendChild(U.el('button', {
        class: 'tile',
        onclick: function () {
          RA.audio.sfx.click();
          openGame(id);
        },
      },
      U.el('div', { class: 'tile-icon', text: meta.icon }),
      U.el('div', { class: 'tile-title', text: meta.title }),
      U.el('div', { class: 'tile-desc', text: meta.desc })));
    });
    stage.appendChild(U.el('div', { class: 'menu-head' },
      U.el('h1', { text: 'Raccoon Arcade 🦝' }),
      U.el('p', { text: 'Scegli un gioco. Per tornare qui premi il tasto Esc o il pulsante Menu.' })));
    stage.appendChild(grid);
    stage.appendChild(U.el('p', { class: 'menu-foot', text: '🦝 🐭 🐱 🐕  Buon divertimento!' }));
    window.scrollTo(0, 0);
  }

  function openGame(id) {
    stopCurrent();
    stage.innerHTML = '';
    stage.className = 'play';
    homeBtn.hidden = false;
    const mod = M[id];
    window.scrollTo(0, 0);
    try {
      current = mod.mount(stage);
      RA.current = current;
      RA.currentId = id;
    } catch (err) {
      console.error(err);
      stage.appendChild(U.el('div', { class: 'card-box' },
        U.el('h2', { text: 'Ops! Questo gioco non si avvia.' }),
        U.el('p', { text: String(err && err.message ? err.message : err) }),
        U.el('button', { class: 'btn', text: 'Torna al menu', onclick: showMenu })));
    }
  }

  homeBtn.addEventListener('click', function () {
    RA.audio.sfx.click();
    showMenu();
  });

  // The button loses focus after a click, so the space bar in a game does not press it again.
  muteBtn.addEventListener('click', function () {
    RA.audio.setMuted(!RA.audio.isMuted());
    setMuteIcon();
    muteBtn.blur();
  });

  // Escape returns to the menu from any game.
  window.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && !homeBtn.hidden) showMenu();
  });

  setMuteIcon();
  showMenu();

  // Used by the automated browser test.
  RA.openGame = openGame;
  RA.showMenu = showMenu;
})();
