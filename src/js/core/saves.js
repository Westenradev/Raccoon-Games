// Saved games. When the player leaves a game in the middle (Menu, Esc, or closing the app),
// the game is kept. Opening that game again asks: take it up again, or start a new one.
(function (name, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else (window.RA = window.RA || { modules: {} }).modules[name] = api;
})('saves', function () {
  const isNode = typeof require === 'function';
  const U = isNode ? require('./util.js') : window.RA.modules.util;
  const VERSION = 1;

  // Saving can be turned off (the automatic browser tests do it, so every game starts fresh).
  function enabled() {
    return !U.store.get('saves.off', false);
  }

  // The saved game of one game id, or null.
  function load(id) {
    if (!enabled()) return null;
    const s = U.store.get('save.' + id, null);
    return s && s.v === VERSION && s.data ? s.data : null;
  }

  function save(id, data) {
    if (enabled()) U.store.set('save.' + id, { v: VERSION, at: Date.now(), data: data });
  }

  function clear(id) {
    U.store.set('save.' + id, null);
  }

  function has(id) {
    return load(id) !== null;
  }

  // Card for the table games: "Riprendi la partita" or "Nuova partita".
  function ask(root, text, onResume, onNew) {
    root.classList.add('asking');
    const done = function (fn) {
      return function () {
        box.remove();
        root.classList.remove('asking');
        fn();
      };
    };
    const box = U.el('div', { class: 'overlay' },
      U.el('div', { class: 'card-box' },
        U.el('h2', { text: 'Partita in sospeso' }),
        U.el('p', { text: text }),
        U.el('button', { class: 'btn big', 'data-save': 'resume', text: 'Riprendi la partita', onclick: done(onResume) }),
        U.el('div', null, U.el('button', { class: 'btn plain', 'data-save': 'new', text: 'Inizia una nuova partita', onclick: done(onNew) }))));
    root.appendChild(box);
  }

  return { enabled: enabled, load: load, save: save, clear: clear, has: has, ask: ask };
});
