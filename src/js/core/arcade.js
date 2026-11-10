// Shared helpers for arcade games (canvas, fixed-step loop, keys, overlay).
(function (name, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else (window.RA = window.RA || { modules: {} }).modules[name] = api;
})('arcade', function () {
  const isNode = typeof require === 'function';
  const U = isNode ? require('./util.js') : window.RA.modules.util;

  const STEP = 1 / 60; // logic runs at a fixed 60 steps per second

  // Creates a canvas inside container. Size is in logical pixels.
  function createCanvas(container, w, h, extraClass) {
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    canvas.className = 'arcade-canvas ' + (extraClass || '');
    container.appendChild(canvas);
    return { canvas: canvas, ctx: canvas.getContext('2d') };
  }

  // Keyboard state. Keys are lower-case names like 'arrowleft', ' ', 'a'.
  const down = {};
  const listeners = [];
  function onKeyDown(e) {
    const k = e.key.toLowerCase();
    if (!down[k]) listeners.forEach((fn) => fn(k, true));
    down[k] = true;
    if (['arrowup', 'arrowdown', 'arrowleft', 'arrowright', ' '].indexOf(k) >= 0) e.preventDefault();
  }
  function onKeyUp(e) {
    const k = e.key.toLowerCase();
    down[k] = false;
    listeners.forEach((fn) => fn(k, false));
  }
  function bindKeys(fn) {
    if (!listeners.length) {
      window.addEventListener('keydown', onKeyDown);
      window.addEventListener('keyup', onKeyUp);
    }
    listeners.push(fn);
    return function () {
      const i = listeners.indexOf(fn);
      if (i >= 0) listeners.splice(i, 1);
      if (!listeners.length) {
        window.removeEventListener('keydown', onKeyDown);
        window.removeEventListener('keyup', onKeyUp);
        Object.keys(down).forEach((k) => { down[k] = false; });
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
      fire: isDown(' ') || isDown('enter'),
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
    ctx.font = size + 'px "Apple Color Emoji", "Segoe UI Emoji", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(ch, x, y);
  }

  function text(ctx, str, x, y, size, color, align) {
    ctx.font = 'bold ' + size + 'px system-ui, -apple-system, sans-serif';
    ctx.fillStyle = color || '#fff';
    ctx.textAlign = align || 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(str, x, y);
  }

  // Start / game-over overlay as DOM, placed on top of the game stage.
  function overlay(container, title, body, buttonText, onStart) {
    const box = U.el('div', { class: 'overlay arcade-overlay' },
      U.el('div', { class: 'card-box' },
        U.el('h2', { text: title }),
        U.el('div', { class: 'small-list' }, body),
        U.el('button', { class: 'btn big', text: buttonText, onclick: function () { box.remove(); onStart(); } })));
    container.appendChild(box);
    return box;
  }

  function hiScoreKey(id) {
    return 'hi.' + id;
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
    overlay: overlay,
    hiScoreKey: hiScoreKey,
  };
});
