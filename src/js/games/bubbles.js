// Bubble Buster (Bolle Procioni). Shoot animal bubbles. Three or more of the same kind pop.
// Bubbles that lose their link to the ceiling fall. Every 6 shots the ceiling comes down one row.
(function (name, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else (window.RA = window.RA || { modules: {} }).modules[name] = api;
})('bubbles', function () {
  const isNode = typeof require === 'function';
  const U = isNode ? require('../core/util.js') : window.RA.modules.util;
  const AR = isNode ? require('../core/arcade.js') : window.RA.modules.arcade;
  const A = isNode ? null : window.RA.audio;

  const R = 18; // bubble radius
  const WIDTH = 360;
  const ROW_H = 31;
  const SHOOT_Y = 490;
  const SPEED = 720;
  const KINDS = ['🦝', '🐭', '🐱', '🐕', '🐟'];
  const COLORS = ['#f59e0b', '#94a3b8', '#fb7185', '#60a5fa', '#34d399'];
  const SHOTS_PER_ROW = 6;
  const DANGER_Y = 420;

  // Row ids are absolute. Even ids have 10 bubbles, odd ids have 9. Parity gives the offset.
  const isEven = (rid) => ((rid % 2) + 2) % 2 === 0;
  const colsIn = (rid) => (isEven(rid) ? 10 : 9);
  const validCell = (rid, c) => c >= 0 && c < colsIn(rid);

  function posOf(rid, c, base) {
    return { x: (isEven(rid) ? 18 : 36) + c * 36, y: 18 + (rid - base) * ROW_H };
  }

  function neighbours(rid, c) {
    const out = [[rid, c - 1], [rid, c + 1]];
    if (isEven(rid)) {
      out.push([rid - 1, c - 1], [rid - 1, c], [rid + 1, c - 1], [rid + 1, c]);
    } else {
      out.push([rid - 1, c], [rid - 1, c + 1], [rid + 1, c], [rid + 1, c + 1]);
    }
    return out.filter((p) => validCell(p[0], p[1]));
  }

  function key(rid, c) {
    return rid + ',' + c;
  }

  // Start field: n rows of random kinds.
  function newGame(seed) {
    const rnd = U.makeRng(seed);
    const grid = new Map();
    const base = 0;
    for (let r = 0; r < 6; r++) {
      const rid = base + r;
      for (let c = 0; c < colsIn(rid); c++) grid.set(key(rid, c), Math.floor(rnd() * KINDS.length));
    }
    const state = {
      rnd: rnd,
      grid: grid,
      base: base,
      angle: 0,
      moving: null,
      cur: Math.floor(rnd() * KINDS.length),
      next: Math.floor(rnd() * KINDS.length),
      shots: 0,
      score: 0,
      over: false,
      won: false,
      events: [],
    };
    return state;
  }

  // Remove groups of 3+ same-kind bubbles touching cell (rid, c). Returns count removed.
  function popGroup(state, rid, c) {
    const kind = state.grid.get(key(rid, c));
    const seen = new Set([key(rid, c)]);
    const stack = [[rid, c]];
    const group = [];
    while (stack.length) {
      const [r, cc] = stack.pop();
      group.push([r, cc]);
      neighbours(r, cc).forEach(function (n) {
        const k = key(n[0], n[1]);
        if (!seen.has(k) && state.grid.get(k) === kind) {
          seen.add(k);
          stack.push(n);
        }
      });
    }
    if (group.length < 3) return 0;
    group.forEach(function (p) { state.grid.delete(key(p[0], p[1])); });
    return group.length;
  }

  // Drops bubbles that are not connected to the ceiling row (base). Returns count dropped.
  function dropFloating(state) {
    const seen = new Set();
    const stack = [];
    state.grid.forEach(function (v, k) {
      const rid = Number(k.split(',')[0]);
      if (rid === state.base) {
        seen.add(k);
        stack.push(k.split(',').map(Number));
      }
    });
    while (stack.length) {
      const [r, c] = stack.pop();
      neighbours(r, c).forEach(function (n) {
        const k = key(n[0], n[1]);
        if (!seen.has(k) && state.grid.has(k)) {
          seen.add(k);
          stack.push(n);
        }
      });
    }
    let dropped = 0;
    const toDelete = [];
    state.grid.forEach(function (v, k) {
      if (!seen.has(k)) toDelete.push(k);
    });
    toDelete.forEach(function (k) {
      state.grid.delete(k);
      dropped += 1;
    });
    return dropped;
  }

  // Places the moving bubble. Finds the empty cell nearest to its position next to the contact.
  function settle(state, x, y, kind) {
    let best = null;
    let bestD = Infinity;
    const consider = function (rid, c) {
      if (!validCell(rid, c) || state.grid.has(key(rid, c))) return;
      const p = posOf(rid, c, state.base);
      const d = (p.x - x) * (p.x - x) + (p.y - y) * (p.y - y);
      if (d < bestD) {
        bestD = d;
        best = [rid, c];
      }
    };
    // Candidate cells: the top row, or empty neighbours of any bubble.
    const top = state.base;
    for (let c = 0; c < colsIn(top); c++) consider(top, c);
    state.grid.forEach(function (v, k) {
      const [r, c] = k.split(',').map(Number);
      neighbours(r, c).forEach(function (n) { consider(n[0], n[1]); });
    });
    if (!best) {
      // Fallback: place in a new row above. Should not happen in normal play.
      best = [state.base, 0];
    }
    state.grid.set(key(best[0], best[1]), kind);
    const popped = popGroup(state, best[0], best[1]);
    let dropped = 0;
    if (popped) {
      dropped = dropFloating(state);
      state.score += popped * 10 + dropped * 20;
      state.events.push('pop');
    } else {
      state.events.push('land');
    }
    return { popped: popped, dropped: dropped };
  }

  function fire(state) {
    if (state.over || state.moving) return false;
    const a = state.angle;
    state.moving = { x: WIDTH / 2, y: SHOOT_Y, vx: Math.sin(a) * SPEED, vy: -Math.cos(a) * SPEED, kind: state.cur };
    state.cur = state.next;
    state.next = Math.floor(state.rnd() * KINDS.length);
    state.events.push('shoot');
    return true;
  }

  // Advances the moving bubble and handles impacts. Also keeps the ceiling descending.
  function update(state, dt) {
    if (state.over) return;
    state.events = [];
    if (state.moving) {
      const steps = 4;
      for (let s = 0; s < steps && state.moving; s++) {
        const m = state.moving;
        m.x += (m.vx * dt) / steps;
        m.y += (m.vy * dt) / steps;
        if (m.x < R) { m.x = R; m.vx = -m.vx; }
        if (m.x > WIDTH - R) { m.x = WIDTH - R; m.vx = -m.vx; }
        let hit = m.y - R <= 0;
        if (!hit) {
          for (const v of state.grid.keys()) {
            const [r, c] = v.split(',').map(Number);
            const p = posOf(r, c, state.base);
            const dx = p.x - m.x;
            const dy = p.y - m.y;
            if (dx * dx + dy * dy < (2 * R - 4) * (2 * R - 4)) {
              hit = true;
              break;
            }
          }
        }
        if (hit) {
          state.moving = null;
          settle(state, m.x, m.y, m.kind);
          state.shots += 1;
          if (state.shots % SHOTS_PER_ROW === 0) {
            state.base -= 1;
            const rid = state.base;
            for (let c = 0; c < colsIn(rid); c++) {
              state.grid.set(key(rid, c), Math.floor(state.rnd() * KINDS.length));
            }
          }
          if (state.grid.size === 0) {
            state.won = true;
            state.over = true;
          }
          const lowest = Math.max.apply(null, [0].concat(Array.from(state.grid.keys()).map(function (k) {
            const [r, c] = k.split(',').map(Number);
            return posOf(r, c, state.base).y;
          })));
          if (lowest >= DANGER_Y) {
            state.over = true;
          }
          if (state.events.indexOf('pop') < 0) state.events.push('land');
          return;
        }
      }
    }
  }

  // ---------- Browser interface ----------
  function mount(container, ctx) {
    const wrap = U.el('div', { class: 'arcade-stage' });
    container.appendChild(wrap);
    const view = AR.createCanvas(wrap, WIDTH, 540, 'bubbles');
    const g = view.ctx;
    const hiKey = 'bubbles';
    let hi = U.store.get(hiKey, 0);
    let state = newGame(1);
    let started = false;
    let loop = null;
    let unbind = null;

    function drawBubble(x, y, kind) {
      g.beginPath();
      g.arc(x, y, R - 1, 0, Math.PI * 2);
      g.fillStyle = COLORS[kind];
      g.fill();
      g.strokeStyle = 'rgba(255,255,255,0.6)';
      g.lineWidth = 2;
      g.stroke();
      AR.emoji(g, KINDS[kind], x, y + 1, R * 1.5);
    }

    function draw() {
      g.fillStyle = '#1e1b4b';
      g.fillRect(0, 0, WIDTH, 540);
      state.grid.forEach(function (kind, k) {
        const [r, c] = k.split(',').map(Number);
        const p = posOf(r, c, state.base);
        drawBubble(p.x, p.y, kind);
      });
      // Danger line.
      g.strokeStyle = 'rgba(248,113,113,0.7)';
      g.setLineDash([6, 6]);
      g.beginPath();
      g.moveTo(0, DANGER_Y + 14);
      g.lineTo(WIDTH, DANGER_Y + 14);
      g.stroke();
      g.setLineDash([]);
      // Aim line.
      g.strokeStyle = 'rgba(253,230,138,0.6)';
      g.setLineDash([4, 6]);
      g.beginPath();
      g.moveTo(WIDTH / 2, SHOOT_Y);
      g.lineTo(WIDTH / 2 + Math.sin(state.angle) * 220, SHOOT_Y - Math.cos(state.angle) * 220);
      g.stroke();
      g.setLineDash([]);
      if (state.moving) drawBubble(state.moving.x, state.moving.y, state.moving.kind);
      // Shooter.
      drawBubble(WIDTH / 2, SHOOT_Y, state.cur);
      AR.emoji(g, '🦝', WIDTH / 2, SHOOT_Y + 40, 26);
      drawBubble(WIDTH - 36, SHOOT_Y + 40, state.next);
      AR.text(g, 'Punti ' + state.score, 8, 14, 14, '#fef3c7', 'left');
      AR.text(g, 'Migliore ' + Math.max(hi, state.score), WIDTH - 8, 14, 14, '#fef3c7', 'right');
      AR.text(g, 'Colpi ' + state.shots + '  (nuova fila ogni ' + SHOTS_PER_ROW + ')', WIDTH / 2, 530, 11, '#94a3b8');
    }

    function frame(dt) {
      if (!started || state.over) return;
      const inp = AR.dirInput();
      if (inp.left) state.angle = Math.max(-1.3, state.angle - 1.2 * dt);
      if (inp.right) state.angle = Math.min(1.3, state.angle + 1.2 * dt);
      update(state, dt);
      state.events.forEach(function (e) {
        if (!A) return;
        if (e === 'shoot') A.sfx.shoot();
        if (e === 'pop') A.sfx.pop();
        if (e === 'land') A.sfx.place();
      });
      if (state.over) endRun();
    }

    function endRun() {
      started = false;
      if (state.score > hi) {
        hi = state.score;
        U.store.set(hiKey, hi);
      }
      if (state.won) {
        if (A) A.sfx.win();
        AR.overlay(wrap, 'Tutte le bolle sono scoppiate! 🦝', 'Punti: ' + state.score + ' · Migliore: ' + hi, 'Gioca ancora', newRun);
      } else {
        if (A) A.sfx.lose();
        AR.overlay(wrap, 'Il soffitto è sceso 🐱', 'Punti: ' + state.score + ' · Migliore: ' + hi, 'Gioca ancora', newRun);
      }
    }

    function newRun() {
      state = newGame(Math.floor(Math.random() * 1e9));
      started = true;
      loop = loop || AR.startLoop(frame, draw);
    }

    function onKey(k, down) {
      if (down && (k === ' ' || k === 'enter' || k === 'arrowup' || k === 'w')) {
        if (started) fire(state);
      }
    }

    function aimFromEvent(e) {
      const rect = view.canvas.getBoundingClientRect();
      const x = ((e.clientX - rect.left) / rect.width) * WIDTH;
      const y = ((e.clientY - rect.top) / rect.height) * 540;
      const a = Math.atan2(x - WIDTH / 2, SHOOT_Y - y);
      state.angle = Math.max(-1.3, Math.min(1.3, a));
    }

    view.canvas.addEventListener('mousemove', function (e) { if (started) aimFromEvent(e); });
    view.canvas.addEventListener('mousedown', function (e) {
      if (!started) return;
      aimFromEvent(e);
      fire(state);
    });

    unbind = AR.bindKeys(onKey);
    draw();
    AR.overlay(wrap, 'Bolle Procioni 🦝', 'Muovi il mouse per mirare, clicca per sparare. Oppure usa le frecce e Spazio. Tre bolle uguali scoppiano.', 'Inizia', newRun);
    return {
      destroy: function () {
        if (loop) loop.stop();
        if (unbind) unbind();
      },
    };
  }

  return {
    meta: { id: 'bubbles', title: 'Bolle Procioni', icon: '🫧', desc: 'Spara le bolle con gli animali. Tre uguali scoppiano.' },
    mount: mount,
    newGame: newGame,
    update: update,
    fire: fire,
    dropFloating: dropFloating,
    WIDTH: WIDTH,
  };
});
