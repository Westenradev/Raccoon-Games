// Shared helpers for arcade games (canvas, fixed-step loop, keys, overlay).
(function (name, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else (window.RA = window.RA || { modules: {} }).modules[name] = api;
})('arcade', function () {
  const isNode = typeof require === 'function';
  const U = isNode ? require('./util.js') : window.RA.modules.util;

  const STEP = 1 / 60; // logic runs at a fixed 60 steps per second
  const GAME_KEYS = ['arrowup', 'arrowdown', 'arrowleft', 'arrowright', ' '];

  // Creates a canvas inside container. w and h are logical pixels: games always draw in
  // that coordinate space. The backing store is larger, so the picture stays sharp on
  // Retina screens, and CSS scales the canvas to fill the window height.
  function createCanvas(container, w, h, extraClass) {
    const canvas = document.createElement('canvas');
    canvas.className = 'arcade-canvas ' + (extraClass || '');
    container.style.width = 'min(100%, calc((100vh - 150px) * ' + (w / h).toFixed(4) + '))';
    canvas.style.aspectRatio = w + ' / ' + h;
    const ctx = canvas.getContext('2d');
    container.appendChild(canvas);
    // One backing pixel for each screen pixel (or more), also after the window changes size.
    const fit = function () {
      const shown = canvas.getBoundingClientRect().width || w;
      const scale = Math.min(5, Math.max(2, Math.ceil((shown * (window.devicePixelRatio || 1)) / w)));
      if (canvas.width !== w * scale) {
        canvas.width = w * scale;
        canvas.height = h * scale;
      }
      ctx.setTransform(scale, 0, 0, scale, 0, 0);
    };
    fit();
    window.addEventListener('resize', fit);
    return { canvas: canvas, ctx: ctx, w: w, h: h, release: function () { window.removeEventListener('resize', fit); } };
  }

  // Keyboard state. Keys are lower-case names like 'arrowleft', ' ', 'a'.
  const down = {};
  const tapped = {}; // time of the last press of each key, so a very short tap still counts
  const listeners = [];
  function releaseAll() {
    Object.keys(down).forEach(function (k) { down[k] = false; });
    Object.keys(tapped).forEach(function (k) { tapped[k] = 0; });
  }
  function onKeyDown(e) {
    if (e.metaKey || e.ctrlKey || e.altKey) {
      // With Cmd held, macOS sends no key-up for other keys: drop them all, so none stays stuck.
      releaseAll();
      return;
    }
    const k = e.key.toLowerCase();
    if (GAME_KEYS.indexOf(k) >= 0) e.preventDefault();
    if (down[k]) return; // ignore keyboard auto-repeat
    down[k] = true;
    tapped[k] = performance.now();
    listeners.slice().forEach(function (fn) { fn(k, true); });
  }
  function onKeyUp(e) {
    const k = e.key.toLowerCase();
    if (GAME_KEYS.indexOf(k) >= 0) e.preventDefault();
    if (!down[k]) return;
    down[k] = false;
    listeners.slice().forEach(function (fn) { fn(k, false); });
  }
  function bindKeys(fn) {
    if (!listeners.length) {
      window.addEventListener('keydown', onKeyDown);
      window.addEventListener('keyup', onKeyUp);
      window.addEventListener('blur', releaseAll);
    }
    listeners.push(fn);
    return function () {
      const i = listeners.indexOf(fn);
      if (i >= 0) listeners.splice(i, 1);
      if (!listeners.length) {
        window.removeEventListener('keydown', onKeyDown);
        window.removeEventListener('keyup', onKeyUp);
        window.removeEventListener('blur', releaseAll);
        releaseAll();
      }
    };
  }
  function isDown(k) {
    return !!down[k];
  }
  // Left/right/up/down/fire from arrows, WASD, or Space.
  function dirInput() {
    // A tap counts once, and only if it was a moment ago: an old press must not act later.
    const now = performance.now();
    const on = function (k) {
      const v = !!down[k] || (!!tapped[k] && now - tapped[k] < 150);
      tapped[k] = 0;
      return v;
    };
    return {
      left: on('arrowleft') || on('a'),
      right: on('arrowright') || on('d'),
      up: on('arrowup') || on('w'),
      down: on('arrowdown') || on('s'),
      fire: on(' '),
    };
  }

  // Fixed-step game loop. step(dt) is called in STEP chunks. draw() after each frame.
  // opts: { view, active }. With them the loop also handles the pause: the P key stops and
  // restarts a game in progress, and the game stops by itself when the window loses focus.
  // active() tells if a game is in progress (not on a start or game-over card).
  function startLoop(step, draw, opts) {
    const o = opts || {};
    const active = o.active || function () { return false; };
    let running = true;
    let paused = false;
    let ready = 0; // seconds of "PRONTI!" before a resumed game moves
    let raf = 0;
    let last = null;
    let acc = 0;
    const onKey = function (e) {
      if ((e.key === 'p' || e.key === 'P') && !e.repeat && !e.metaKey && !e.ctrlKey && active()) paused = !paused;
    };
    const onBlur = function () { if (active()) paused = true; };
    const onHide = function () { if (document.hidden) onBlur(); };
    // A click on the game also ends the pause, for players who use only the mouse.
    const onClick = function () { paused = false; };
    window.addEventListener('keydown', onKey);
    window.addEventListener('blur', onBlur);
    document.addEventListener('visibilitychange', onHide);
    if (o.view) o.view.canvas.addEventListener('click', onClick);
    const frame = function (t) {
      if (!running) return;
      if (last === null) last = t;
      acc += Math.min(0.1, (t - last) / 1000);
      last = t;
      if (!active()) paused = false;
      if (ready > 0 && !paused) {
        ready -= acc;
        acc = 0;
      }
      if (paused || ready > 0) {
        acc = 0;
      } else {
        let guard = 0;
        while (acc >= STEP && guard++ < 8) {
          step(STEP);
          acc -= STEP;
        }
        if (guard >= 8) acc = 0;
      }
      draw();
      if (ready > 0 && !paused && o.view) {
        const g = o.view.ctx;
        g.fillStyle = 'rgba(0,0,0,0.45)';
        g.fillRect(0, o.view.h / 2 - 34, o.view.w, 68);
        pixelText(g, 'PRONTI!', o.view.w / 2, o.view.h / 2, 24, '#ffe600');
      }
      if (paused && o.view) {
        const g = o.view.ctx;
        g.fillStyle = 'rgba(0,0,0,0.74)';
        g.fillRect(0, 0, o.view.w, o.view.h);
        pixelText(g, 'PAUSA', o.view.w / 2, o.view.h / 2 - 18, 26, '#ffe600');
        pixelText(g, 'Premi P o fai clic', o.view.w / 2, o.view.h / 2 + 22, 11, '#fff');
        pixelText(g, 'per continuare', o.view.w / 2, o.view.h / 2 + 44, 11, '#fff');
      }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return {
      stop: function () {
        running = false;
        cancelAnimationFrame(raf);
        window.removeEventListener('keydown', onKey);
        window.removeEventListener('blur', onBlur);
        document.removeEventListener('visibilitychange', onHide);
        if (o.view) o.view.canvas.removeEventListener('click', onClick);
        if (o.view && o.view.release) o.view.release();
      },
      isPaused: function () { return paused; },
      // Shows "PRONTI!" for a moment before the game moves (used when a saved game starts again).
      getReady: function (seconds) { ready = seconds; },
    };
  }

  // Record (best score) of a game. It is saved as soon as it is beaten, so leaving a game
  // in the middle does not lose it.
  function record(id) {
    let best = U.store.get('hi.' + id, 0);
    return {
      get: function () { return best; },
      submit: function (score) {
        if (score > best) {
          best = score;
          U.store.set('hi.' + id, best);
        }
        return best;
      },
    };
  }

  // Draw an emoji centred on x, y.
  function emoji(ctx, ch, x, y, size) {
    ctx.font = size + 'px "Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#fff';
    ctx.fillText(ch, x, y);
  }

  function text(ctx, str, x, y, size, color, align) {
    ctx.font = 'bold ' + size + 'px -apple-system, system-ui, "Helvetica Neue", sans-serif';
    ctx.fillStyle = color || '#fff';
    ctx.textAlign = align || 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(str, x, y);
  }

  // Text in the pixel font of the arcade games.
  function pixelText(ctx, str, x, y, size, color, align) {
    ctx.font = size + 'px "Press Start", "Courier New", monospace';
    ctx.fillStyle = color || '#fff';
    ctx.textAlign = align || 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(str, x, y);
  }

  // Draws a pixel sprite. rows = strings, 'X' is a filled pixel. (x, y) is the top left.
  function sprite(ctx, rows, x, y, px, color) {
    ctx.fillStyle = color;
    for (let r = 0; r < rows.length; r++) {
      const row = rows[r];
      for (let c = 0; c < row.length; c++) {
        if (row[c] === 'X') ctx.fillRect(x + c * px, y + r * px, px, px);
      }
    }
  }

  // Small still picture of a game for the menu. paint(ctx) draws in w x h logical pixels.
  function thumb(el, w, h, paint) {
    const canvas = document.createElement('canvas');
    canvas.width = w * 2;
    canvas.height = h * 2;
    canvas.style.objectFit = 'cover';
    const ctx = canvas.getContext('2d');
    ctx.setTransform(2, 0, 0, 2, 0, 0);
    el.appendChild(canvas);
    const draw = function () { paint(ctx); };
    draw();
    // Draw again when the pixel font has arrived.
    if (document.fonts && document.fonts.load) document.fonts.load('10px "Press Start"').then(draw, function () {});
  }

  // One line under the canvas that tells the keys.
  function help(container, text) {
    container.parentNode.appendChild(U.el('p', { class: 'arcade-help', text: text }));
  }

  // First card of an arcade game. With a saved game it offers to take it up again.
  // opts: { id, title, body, summary(saved), onResume(saved), onNew }
  function startCard(container, opts) {
    const SV = window.RA.modules.saves;
    const saved = SV.load(opts.id);
    if (!saved) return overlay(container, opts.title, opts.body, 'INIZIA', opts.onNew);
    return overlay(container, 'PARTITA SALVATA', opts.summary(saved), 'RIPRENDI', function () { opts.onResume(saved); },
      { text: 'NUOVA PARTITA', onClick: function () { SV.clear(opts.id); opts.onNew(); } });
  }

  // Start / game-over card on top of the game stage. Enter or a click starts.
  // second (optional) = { text, onClick }: a smaller second button, for example "new game"
  // under "resume".
  function overlay(container, title, body, buttonText, onStart, second) {
    let box = null;
    const close = function (fn) {
      if (!box) return;
      window.removeEventListener('keydown', onKey);
      box.remove();
      box = null;
      fn();
    };
    const go = function () { close(onStart); };
    const onKey = function (e) {
      if (!box || !box.isConnected) {
        window.removeEventListener('keydown', onKey);
        return;
      }
      if (e.key === 'Enter') {
        e.preventDefault();
        go();
      }
    };
    box = U.el('div', { class: 'overlay arcade-overlay' },
      U.el('div', { class: 'card-box' },
        U.el('h2', { text: title }),
        U.el('p', { text: body }),
        U.el('button', { class: 'btn big', text: buttonText, onclick: go }),
        second ? U.el('div', null, U.el('button', { class: 'btn plain', 'data-save': 'new', text: second.text, onclick: function () { close(second.onClick); } })) : null,
        U.el('p', { class: 'hint', text: 'Oppure premi il tasto Invio' })));
    container.appendChild(box);
    window.addEventListener('keydown', onKey);
    return box;
  }

  return {
    STEP: STEP,
    createCanvas: createCanvas,
    bindKeys: bindKeys,
    isDown: isDown,
    dirInput: dirInput,
    startLoop: startLoop,
    emoji: emoji,
    text: text,
    pixelText: pixelText,
    sprite: sprite,
    thumb: thumb,
    help: help,
    record: record,
    overlay: overlay,
    startCard: startCard,
  };
});
