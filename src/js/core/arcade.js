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
    const scale = Math.max(2, Math.ceil(window.devicePixelRatio || 1));
    canvas.width = w * scale;
    canvas.height = h * scale;
    canvas.className = 'arcade-canvas ' + (extraClass || '');
    container.style.width = 'min(100%, calc((100vh - 150px) * ' + (w / h).toFixed(4) + '))';
    canvas.style.aspectRatio = w + ' / ' + h;
    const ctx = canvas.getContext('2d');
    ctx.setTransform(scale, 0, 0, scale, 0, 0);
    container.appendChild(canvas);
    return { canvas: canvas, ctx: ctx, w: w, h: h };
  }

  // Keyboard state. Keys are lower-case names like 'arrowleft', ' ', 'a'.
  const down = {};
  const listeners = [];
  function releaseAll() {
    Object.keys(down).forEach(function (k) { down[k] = false; });
  }
  function onKeyDown(e) {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const k = e.key.toLowerCase();
    if (GAME_KEYS.indexOf(k) >= 0) e.preventDefault();
    if (down[k]) return; // ignore keyboard auto-repeat
    down[k] = true;
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
    return {
      left: isDown('arrowleft') || isDown('a'),
      right: isDown('arrowright') || isDown('d'),
      up: isDown('arrowup') || isDown('w'),
      down: isDown('arrowdown') || isDown('s'),
      fire: isDown(' '),
    };
  }

  // Fixed-step game loop. step(dt) is called in STEP chunks. draw() after each frame.
  function startLoop(step, draw) {
    let running = true;
    let raf = 0;
    let last = null;
    let acc = 0;
    const frame = function (t) {
      if (!running) return;
      if (last === null) last = t;
      acc += Math.min(0.1, (t - last) / 1000);
      last = t;
      let guard = 0;
      while (acc >= STEP && guard++ < 8) {
        step(STEP);
        acc -= STEP;
      }
      if (guard >= 8) acc = 0;
      draw();
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return {
      stop: function () {
        running = false;
        cancelAnimationFrame(raf);
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

  // Start / game-over card on top of the game stage. Enter or a click starts.
  function overlay(container, title, body, buttonText, onStart) {
    let box = null;
    const go = function () {
      if (!box) return;
      window.removeEventListener('keydown', onKey);
      box.remove();
      box = null;
      onStart();
    };
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
    overlay: overlay,
  };
});
