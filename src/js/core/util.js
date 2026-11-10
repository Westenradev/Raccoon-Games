// Shared helpers. Works in the browser (window.RA.modules.util) and in Node (require).
(function (name, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else (window.RA = window.RA || { modules: {} }).modules[name] = api;
})('util', function () {
  // Seeded random generator (mulberry32). Same seed gives same sequence.
  function makeRng(seed) {
    let a = (seed == null ? Math.floor(Math.random() * 4294967296) : seed) >>> 0;
    return function () {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function shuffle(arr, rnd) {
    const r = rnd || Math.random;
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(r() * (i + 1));
      const tmp = arr[i];
      arr[i] = arr[j];
      arr[j] = tmp;
    }
    return arr;
  }

  function pick(arr, rnd) {
    const r = rnd || Math.random;
    return arr[Math.floor(r() * arr.length)];
  }

  function clamp(v, lo, hi) {
    return Math.max(lo, Math.min(hi, v));
  }

  // Local storage wrapper. Never throws. Used for high scores and mute.
  const store = {
    get(key, fallback) {
      try {
        const raw = localStorage.getItem('ra.' + key);
        return raw == null ? fallback : JSON.parse(raw);
      } catch (e) {
        return fallback;
      }
    },
    set(key, value) {
      try {
        localStorage.setItem('ra.' + key, JSON.stringify(value));
      } catch (e) {
        /* storage blocked: ignore */
      }
    },
  };

  // DOM builder. el('div', {class: 'x', onclick: fn}, child1, [child2, child3])
  function el(tag, props) {
    const node = document.createElement(tag);
    if (props) {
      for (const key of Object.keys(props)) {
        const val = props[key];
        if (val == null || val === false) continue;
        if (key === 'class') node.className = val;
        else if (key === 'style') node.style.cssText = val;
        else if (key.indexOf('on') === 0) node.addEventListener(key.slice(2), val);
        else if (key === 'text') node.textContent = val;
        else node.setAttribute(key, val === true ? '' : String(val));
      }
    }
    const kids = Array.prototype.slice.call(arguments, 2);
    const add = function (c) {
      if (c == null || c === false) return;
      if (Array.isArray(c)) c.forEach(add);
      else if (c.nodeType) node.appendChild(c);
      else node.appendChild(document.createTextNode(String(c)));
    };
    kids.forEach(add);
    return node;
  }

  function shuffled(n, rnd) {
    const out = [];
    for (let i = 0; i < n; i++) out.push(i);
    return shuffle(out, rnd);
  }

  return { makeRng, shuffle, pick, clamp, store, el, shuffled };
});
