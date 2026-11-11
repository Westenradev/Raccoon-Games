// Sudoku with 3 levels. Every puzzle has exactly one solution.
(function (name, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else (window.RA = window.RA || { modules: {} }).modules[name] = api;
})('sudoku', function () {
  const isNode = typeof require === 'function';
  const U = isNode ? require('../core/util.js') : window.RA.modules.util;
  const A = isNode ? null : window.RA.audio;
  const SV = isNode ? null : window.RA.modules.saves;

  // givens = numbers shown at the start. grade = the hardest step a player needs:
  // 0 = only "single" steps (one place for a number, or one number for a place),
  // 1 = also pairs and "locked" numbers. No level ever needs guessing.
  const LEVELS = {
    facile: { label: 'Facile', givens: 42, grade: 0 },
    medio: { label: 'Medio', givens: 32, grade: 0 },
    difficile: { label: 'Difficile', givens: 27, grade: 1 },
  };

  // Board is a flat array of 81 numbers, 0 = empty.
  function peers(i) {
    const r = Math.floor(i / 9);
    const c = i % 9;
    const out = [];
    for (let k = 0; k < 9; k++) {
      out.push(r * 9 + k);
      out.push(k * 9 + c);
    }
    const br = Math.floor(r / 3) * 3;
    const bc = Math.floor(c / 3) * 3;
    for (let dr = 0; dr < 3; dr++) {
      for (let dc = 0; dc < 3; dc++) out.push((br + dr) * 9 + (bc + dc));
    }
    return out.filter((x, idx, arr) => x !== i && arr.indexOf(x) === idx);
  }
  const PEERS = [];
  for (let i = 0; i < 81; i++) PEERS.push(peers(i));

  function canPlace(b, i, v) {
    return PEERS[i].every((p) => b[p] !== v);
  }

  // Counts solutions up to limit. Fills b in place.
  function countSolutions(b, limit, rnd) {
    let count = 0;
    const order = [];
    for (let i = 0; i < 81; i++) order.push(i);
    const solve = function () {
      if (count >= limit) return;
      let best = -1;
      let bestOpts = null;
      // Pick the empty cell with the fewest options (fast search).
      for (let i = 0; i < 81; i++) {
        if (b[i] !== 0) continue;
        const opts = [];
        for (let v = 1; v <= 9; v++) if (canPlace(b, i, v)) opts.push(v);
        if (opts.length === 0) return;
        if (best < 0 || opts.length < bestOpts.length) {
          best = i;
          bestOpts = opts;
          if (opts.length === 1) break;
        }
      }
      if (best < 0) {
        count += 1;
        return;
      }
      const opts = rnd ? U.shuffle(bestOpts.slice(), rnd) : bestOpts;
      for (const v of opts) {
        b[best] = v;
        solve();
        if (count >= limit) return; // keep the found solution in b
        b[best] = 0;
      }
    };
    solve();
    return count;
  }

  function generateSolution(rnd) {
    const b = new Array(81).fill(0);
    countSolutions(b, 1, rnd); // fills b with one full solution
    return b;
  }

  // ---------- Grading: how hard is a puzzle for a person? ----------
  const UNITS = [];
  for (let k = 0; k < 9; k++) {
    const row = [];
    const col = [];
    const box = [];
    for (let j = 0; j < 9; j++) {
      row.push(k * 9 + j);
      col.push(j * 9 + k);
      box.push((Math.floor(k / 3) * 3 + Math.floor(j / 3)) * 9 + (k % 3) * 3 + (j % 3));
    }
    UNITS.push(row, col, box);
  }
  const bitCount = function (m) {
    let n = 0;
    while (m) { m &= m - 1; n += 1; }
    return n;
  };

  // Solves with human steps only. Returns 0 (singles), 1 (pairs or locked numbers needed)
  // or 2 (cannot be solved with these steps).
  function grade(puzzle) {
    const b = puzzle.slice();
    const cand = new Array(81).fill(0);
    for (let i = 0; i < 81; i++) {
      if (b[i]) continue;
      for (let v = 1; v <= 9; v++) if (canPlace(b, i, v)) cand[i] |= 1 << v;
    }
    const place = function (i, v) {
      b[i] = v;
      cand[i] = 0;
      PEERS[i].forEach(function (p) { cand[p] &= ~(1 << v); });
    };
    const singles = function () {
      let moved = false;
      for (let i = 0; i < 81; i++) {
        if (!b[i] && bitCount(cand[i]) === 1) {
          place(i, Math.log2(cand[i]));
          moved = true;
        }
      }
      UNITS.forEach(function (unit) {
        for (let v = 1; v <= 9; v++) {
          const spots = unit.filter(function (i) { return cand[i] & (1 << v); });
          if (spots.length === 1) {
            place(spots[0], v);
            moved = true;
          }
        }
      });
      return moved;
    };
    const harder = function () {
      let changed = false;
      const strip = function (cells, mask) {
        cells.forEach(function (i) {
          if (cand[i] & mask) {
            cand[i] &= ~mask;
            changed = true;
          }
        });
      };
      // Locked numbers: inside a unit, a number fits only in cells that also share another unit.
      UNITS.forEach(function (unit) {
        for (let v = 1; v <= 9; v++) {
          const spots = unit.filter(function (i) { return cand[i] & (1 << v); });
          if (spots.length < 2 || spots.length > 3) continue;
          UNITS.forEach(function (other) {
            if (other === unit || !spots.every(function (i) { return other.indexOf(i) >= 0; })) return;
            strip(other.filter(function (i) { return spots.indexOf(i) < 0; }), 1 << v);
          });
        }
      });
      // Pairs: two cells of a unit with the same two numbers.
      UNITS.forEach(function (unit) {
        for (let x = 0; x < 9; x++) {
          for (let y = x + 1; y < 9; y++) {
            const m = cand[unit[x]];
            if (m && m === cand[unit[y]] && bitCount(m) === 2) {
              strip(unit.filter(function (i, k) { return k !== x && k !== y; }), m);
            }
          }
        }
      });
      return changed;
    };
    let level = 0;
    for (let guard = 0; guard < 400; guard++) {
      if (b.every(function (v) { return v; })) return level;
      if (singles()) continue;
      if (!harder()) return 2;
      level = 1;
    }
    return 2;
  }

  // One puzzle with a unique solution and at most `givens` numbers shown.
  function carve(givens, rnd) {
    const solution = generateSolution(rnd);
    const puzzle = solution.slice();
    const cells = U.shuffle(Array.from({ length: 81 }, function (_, i) { return i; }), rnd);
    let filled = 81;
    for (const i of cells) {
      if (filled <= givens) break;
      const keep = puzzle[i];
      puzzle[i] = 0;
      if (countSolutions(puzzle.slice(), 2, null) !== 1) puzzle[i] = keep;
      else filled -= 1;
    }
    return { puzzle: puzzle, solution: solution };
  }

  // Makes a puzzle for a level: unique solution, and the right kind of steps.
  function generatePuzzle(levelKey, rnd) {
    const level = LEVELS[levelKey] || LEVELS.facile;
    let fallback = null;
    for (let attempt = 0; attempt < 80; attempt++) {
      const p = carve(level.givens, rnd);
      const g = grade(p.puzzle);
      if (g === level.grade) {
        fallback = p;
        break;
      }
      // Never keep a puzzle that needs guessing. An easier one is an acceptable spare.
      if (g < level.grade && !fallback) fallback = p;
    }
    if (!fallback) fallback = carve(42, rnd);
    return { puzzle: fallback.puzzle, solution: fallback.solution, givens: fallback.puzzle.map(function (v) { return v !== 0; }) };
  }

  function isSolved(board, solution) {
    return board.every((v, i) => v === solution[i]);
  }

  function conflicts(board) {
    const bad = new Set();
    for (let i = 0; i < 81; i++) {
      if (!board[i]) continue;
      if (PEERS[i].some((p) => board[p] === board[i])) bad.add(i);
    }
    return bad;
  }

  // ---------- Browser interface ----------
  function mount(container) {
    let alive = true;
    let level = U.store.get('sudoku.level', 'facile');
    if (!LEVELS[level]) level = 'facile';
    let game = null;
    let board = null;
    let selected = -1;
    let showErrors = false;
    let startedAt = Date.now();
    let endedAt = null;
    let mistakes = 0;
    let hints = 0;
    let won = false;
    const root = U.el('div', { class: 'sudoku game-panel sheet' });
    container.appendChild(root);

    function elapsed() {
      const secs = Math.floor(((endedAt || Date.now()) - startedAt) / 1000);
      const m = Math.floor(secs / 60);
      const s = secs % 60;
      return m + ':' + (s < 10 ? '0' : '') + s;
    }

    const clock = setInterval(function () {
      const node = root.querySelector('.clock');
      if (node && !won) node.textContent = elapsed();
    }, 1000);

    function newGame() {
      game = generatePuzzle(level, U.makeRng());
      board = game.puzzle.slice();
      selected = -1;
      mistakes = 0;
      hints = 0;
      showErrors = false;
      won = false;
      startedAt = Date.now();
      endedAt = null;
      render();
    }

    // ----- saved game -----
    function persist() {
      if (asking) return; // the saved game is still waiting for an answer
      const touched = game && board.some(function (v, i) { return v !== game.puzzle[i]; });
      if (won || !touched) return SV.clear('sudoku');
      SV.save('sudoku', { game: game, board: board, level: level, mistakes: mistakes, hints: hints, elapsedMs: Date.now() - startedAt });
    }

    function restore(saved) {
      game = saved.game;
      board = saved.board;
      level = saved.level;
      mistakes = saved.mistakes;
      hints = saved.hints;
      selected = -1;
      showErrors = false;
      won = false;
      endedAt = null;
      startedAt = Date.now() - saved.elapsedMs; // the clock goes on from where it stopped
      render();
    }

    function checkWin() {
      if (!isSolved(board, game.solution)) return false;
      won = true;
      endedAt = Date.now();
      selected = -1;
      if (A) A.sfx.win();
      return true;
    }

    function setValue(v) {
      if (won || selected < 0 || game.givens[selected]) return;
      if (board[selected] === v) return;
      board[selected] = v;
      if (v !== 0 && v !== game.solution[selected]) {
        mistakes += 1;
        if (A) A.sfx.bad();
      } else if (A) {
        A.sfx.click();
      }
      checkWin();
      render();
    }

    function hint() {
      if (won) return;
      const wrong = [];
      for (let i = 0; i < 81; i++) if (board[i] !== game.solution[i]) wrong.push(i);
      if (!wrong.length) return;
      const i = selected >= 0 && board[selected] !== game.solution[selected] ? selected : wrong[Math.floor(Math.random() * wrong.length)];
      board[i] = game.solution[i];
      selected = i;
      hints += 1;
      if (A) A.sfx.ok();
      checkWin();
      render();
    }

    function render() {
      if (!alive) return;
      root.innerHTML = '';
      const bad = new Set();
      if (showErrors) {
        board.forEach(function (v, i) { if (v && v !== game.solution[i]) bad.add(i); });
      }
      const selValue = selected >= 0 ? board[selected] : 0;
      const sr = Math.floor(selected / 9);
      const sc = selected % 9;
      const grid = U.el('div', { class: 'sudoku-grid' });
      for (let i = 0; i < 81; i++) {
        const r = Math.floor(i / 9);
        const c = i % 9;
        const cls = ['cell'];
        if (game.givens[i]) cls.push('given');
        if (selected === i) cls.push('sel');
        else if (selected >= 0 && (r === sr || c === sc || (Math.floor(r / 3) === Math.floor(sr / 3) && Math.floor(c / 3) === Math.floor(sc / 3)))) cls.push('peer');
        if (selValue && board[i] === selValue && selected !== i) cls.push('same');
        if (bad.has(i)) cls.push('bad');
        if (c % 3 === 2 && c < 8) cls.push('br');
        if (r % 3 === 2 && r < 8) cls.push('bb');
        grid.appendChild(U.el('div', {
          class: cls.join(' '),
          'data-i': i,
          text: board[i] ? String(board[i]) : '',
          onclick: function () {
            if (won) return;
            selected = i;
            render();
          },
        }));
      }
      root.appendChild(U.el('div', { class: 'sheet-head' },
        U.el('h2', { text: 'Sudoku' }),
        U.el('div', { class: 'sheet-meta' },
          U.el('span', null, 'Tempo ', U.el('b', { class: 'clock', text: elapsed() })),
          U.el('span', null, 'Errori ', U.el('b', { text: String(mistakes) })),
          U.el('span', null, 'Aiuti ', U.el('b', { text: String(hints) })))));
      const levelButtons = U.el('div', { class: 'levels' });
      Object.keys(LEVELS).forEach(function (k) {
        levelButtons.appendChild(U.el('button', {
          class: 'btn ' + (k === level ? '' : 'ghost'),
          'data-level': k,
          text: LEVELS[k].label,
          onclick: function () {
            level = k;
            U.store.set('sudoku.level', k);
            newGame();
          },
        }));
      });
      root.appendChild(levelButtons);

      const counts = new Array(10).fill(0);
      board.forEach(function (v) { counts[v] += 1; });
      const pad = U.el('div', { class: 'pad' });
      for (let v = 1; v <= 9; v++) {
        const left = Math.max(0, 9 - counts[v]);
        pad.appendChild(U.el('button', {
          class: 'btn num' + (left === 0 ? ' done' : ''),
          title: 'Ne mancano ' + left,
          onclick: function () { setValue(v); },
        }, String(v), U.el('small', { text: left === 0 ? 'fatto' : 'ancora ' + left })));
      }
      pad.appendChild(U.el('button', { class: 'btn num erase', text: 'Cancella', title: 'Cancella la casella', onclick: function () { setValue(0); } }));
      root.appendChild(U.el('div', { class: 'sudoku-main' }, grid, pad));

      root.appendChild(U.el('div', { class: 'msg', text: won
        ? 'Bravo! Sudoku completato in ' + elapsed() + '.'
        : 'Tocca una casella, poi un numero. Puoi usare anche la tastiera.' }));
      root.appendChild(U.el('div', { class: 'actions' },
        U.el('button', { class: 'btn ghost', text: showErrors ? 'Nascondi gli errori' : 'Mostra gli errori', onclick: function () { showErrors = !showErrors; render(); } }),
        U.el('button', { class: 'btn ghost', text: 'Dammi un aiuto', onclick: hint }),
        U.el('button', { class: 'btn primary', text: 'Nuovo sudoku', onclick: newGame })));
    }

    function onKey(e) {
      if (!alive || won || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key >= '1' && e.key <= '9') {
        setValue(Number(e.key));
      } else if (e.key === 'Backspace' || e.key === 'Delete' || e.key === '0') {
        e.preventDefault();
        setValue(0);
      } else if (e.key.indexOf('Arrow') === 0) {
        e.preventDefault();
        if (selected < 0) selected = 40;
        let r = Math.floor(selected / 9);
        let c = selected % 9;
        if (e.key === 'ArrowUp') r = Math.max(0, r - 1);
        if (e.key === 'ArrowDown') r = Math.min(8, r + 1);
        if (e.key === 'ArrowLeft') c = Math.max(0, c - 1);
        if (e.key === 'ArrowRight') c = Math.min(8, c + 1);
        selected = r * 9 + c;
        render();
      }
    }
    document.addEventListener('keydown', onKey);

    const saved = SV.load('sudoku');
    let asking = !!saved;
    if (saved) {
      const left = saved.board.filter(function (v) { return !v; }).length;
      SV.ask(root, 'Sudoku ' + LEVELS[saved.level].label.toLowerCase() + ': mancano ' + left + ' caselle.',
        function () { asking = false; restore(saved); },
        function () { asking = false; SV.clear('sudoku'); newGame(); });
    } else {
      newGame();
    }
    return {
      destroy: function () {
        persist();
        alive = false;
        clearInterval(clock);
        document.removeEventListener('keydown', onKey);
      },
      save: persist,
      debug: {
        get game() { return game; },
        get board() { return board; },
        get won() { return won; },
        get level() { return level; },
      },
    };
  }

  return {
    meta: { id: 'sudoku', title: 'Sudoku', desc: 'Tre livelli. Ogni schema ha una sola soluzione.' },
    mount: mount,
    LEVELS: LEVELS,
    generatePuzzle: generatePuzzle,
    grade: grade,
    countSolutions: countSolutions,
    isSolved: isSolved,
    conflicts: conflicts,
    PEERS: PEERS,
  };
});
