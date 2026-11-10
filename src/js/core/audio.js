// Sound effects and ambient music, made with the Web Audio API (no audio files needed).
(function () {
  const RA = (window.RA = window.RA || { modules: {} });
  const store = RA.modules.util.store;

  let ctx = null;
  let muted = !!store.get('muted', false);
  let masterGain = null;

  function context() {
    try {
      if (!ctx) {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return null;
        ctx = new AC();
        masterGain = ctx.createGain();
        masterGain.gain.value = 0.5;
        masterGain.connect(ctx.destination);
      }
      if (ctx.state === 'suspended') ctx.resume();
      return ctx;
    } catch (e) {
      return null;
    }
  }

  // One short note. Freq in Hz, dur in seconds.
  function tone(freq, dur, type, vol, delay) {
    if (muted) return;
    const c = context();
    if (!c) return;
    const t0 = c.currentTime + (delay || 0);
    const osc = c.createOscillator();
    const g = c.createGain();
    osc.type = type || 'sine';
    osc.frequency.setValueAtTime(freq, t0);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(vol || 0.15, t0 + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + (dur || 0.15));
    osc.connect(g);
    g.connect(masterGain);
    osc.start(t0);
    osc.stop(t0 + (dur || 0.15) + 0.05);
  }

  function slide(from, to, dur, type, vol) {
    if (muted) return;
    const c = context();
    if (!c) return;
    const t0 = c.currentTime;
    const osc = c.createOscillator();
    const g = c.createGain();
    osc.type = type || 'square';
    osc.frequency.setValueAtTime(from, t0);
    osc.frequency.exponentialRampToValueAtTime(Math.max(20, to), t0 + dur);
    g.gain.setValueAtTime(vol || 0.1, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(g);
    g.connect(masterGain);
    osc.start(t0);
    osc.stop(t0 + dur + 0.05);
  }

  const sfx = {
    click: function () { tone(660, 0.05, 'triangle', 0.12); },
    place: function () { tone(330, 0.08, 'triangle', 0.15); },
    ok: function () { tone(523, 0.1, 'sine', 0.15); tone(784, 0.14, 'sine', 0.15, 0.08); },
    bad: function () { slide(220, 90, 0.2, 'sawtooth', 0.08); },
    win: function () {
      [523, 659, 784, 1046].forEach(function (f, i) { tone(f, 0.25, 'triangle', 0.18, i * 0.12); });
    },
    lose: function () {
      [392, 330, 262, 196].forEach(function (f, i) { tone(f, 0.3, 'sawtooth', 0.08, i * 0.15); });
    },
    pop: function () { slide(900, 300, 0.12, 'sine', 0.15); },
    shoot: function () { slide(1400, 300, 0.12, 'square', 0.05); },
    hit: function () { slide(180, 40, 0.25, 'sawtooth', 0.12); },
    eat: function () { tone(880, 0.05, 'square', 0.06); tone(1100, 0.05, 'square', 0.06, 0.05); },
    power: function () { slide(300, 900, 0.35, 'triangle', 0.12); },
    clear: function () { [660, 880, 990].forEach(function (f, i) { tone(f, 0.12, 'triangle', 0.14, i * 0.06); }); },
    tick: function () { tone(1200, 0.02, 'square', 0.03); },
  };

  // Soft ambient: low drone plus random pentatonic bells. Used by Mahjong.
  let ambientTimer = null;
  let droneNodes = null;
  function startAmbient() {
    stopAmbient();
    if (muted) return;
    const c = context();
    if (!c) return;
    const osc = c.createOscillator();
    const lp = c.createBiquadFilter();
    const g = c.createGain();
    osc.type = 'sine';
    osc.frequency.value = 110;
    lp.type = 'lowpass';
    lp.frequency.value = 300;
    g.gain.value = 0.05;
    osc.connect(lp);
    lp.connect(g);
    g.connect(masterGain);
    osc.start();
    droneNodes = { osc: osc, g: g };
    const scale = [523.25, 587.33, 659.25, 783.99, 880, 1046.5];
    const bell = function () {
      if (!ambientTimer) return;
      const f = scale[Math.floor(Math.random() * scale.length)];
      tone(f, 1.6, 'sine', 0.06);
      ambientTimer = setTimeout(bell, 1800 + Math.random() * 2600);
    };
    ambientTimer = setTimeout(bell, 800);
  }
  function stopAmbient() {
    if (ambientTimer) clearTimeout(ambientTimer);
    ambientTimer = null;
    if (droneNodes) {
      try { droneNodes.osc.stop(); } catch (e) { /* already stopped */ }
      droneNodes = null;
    }
  }

  function setMuted(m) {
    muted = !!m;
    store.set('muted', muted);
    if (muted) stopAmbient();
    if (masterGain && ctx) masterGain.gain.value = muted ? 0 : 0.5;
  }

  RA.audio = {
    sfx: sfx,
    startAmbient: startAmbient,
    stopAmbient: stopAmbient,
    setMuted: setMuted,
    isMuted: function () { return muted; },
  };
})();
