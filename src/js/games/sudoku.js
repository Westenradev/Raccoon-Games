// Sudoku with 3 levels. Every puzzle has exactly one solution.
(function (name, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else (window.RA = window.RA || { modules: {} }).modules[name] = api;
})('sudoku', function () {
  const isNode = typeof require === 'function';
  const U = isNode ? require('../core/util.js') : window.RA.modules.util;
  const A = isNode ? null : window.RA.audio;

  const LEVELS = {
    facile: { label: 'Facile 🐣', givens: 40 },
    medio: { label: 'Medio 🦝', givens: 32 },
    difficile: { label: 'Difficile 🐺', givens: 26 },
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

  // Makes a puzzle with the given number of starting numbers, unique solution.
  function generatePuzzle(levelKey, rnd) {
    const level = LEVELS[levelKey] || LEVELS.facile;
    const solution = generateSolution(rnd);
    const puzzle = solution.slice();
    const cells = U.shuffle(Array.from({ length: 81 }, (_, i) => i), rnd);
    let filled = 81;
    for (const i of cells) {
      if (filled <= level.givens) break;
      const keep = puzzle[i];
      puzzle[i] = 0;
      const test = puzzle.slice();
      if (countSolutions(test, 2, null) !== 1) {
        puzzle[i] = keep;
      } else {
        filled -= 1;
      }
    }
    return { puzzle: puzzle, solution: solution, givens: puzzle.map((v) => v !== 0) };
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
  function mount(container, ctx) {
    let alive = true;
    let level = U.store.get('sudoku.level', 'facile');
    let game = null;
    let board = null;
    let selected = -1;
    let showErrors = false;
    let startedAt = Date.now();
    let timer = null;
    let mistakes = 0;
    const root = U.el('div', { class: 'sudoku game-panel' });
    container.appendChild(root);

    function newGame() {
      const rnd = U.makeRng();
      game = generatePuzzle(level, rnd);
      board = game.puzzle.slice();
      selected = -1;
      mistakes = 0;
      showErrors = false;
      startedAt = Date.now();
      render();
    }

    function setValue(v) {
      if (selected < 0 || game.givens[selected]) return;
      board[selected] = v;
      if (v !== 0 && v !== game.solution[selected]) {
        mistakes += 1;
        if (A) A.sfx.bad();
      } else if (v !== 0 && A) {
        A.sfx.click();
      }
      if (isSolved(board, game.solution)) {
        if (A) A.sfx.win();
        return render(true);
      }
      render();
    }

    function hint() {
      const empty = [];
      for (let i = 0; i < 81; i++) if (board[i] !== game.solution[i]) empty.push(i);
      if (!empty.length) return;
      const i = selected >= 0 && board[selected] !== game.solution[selected] ? selected : empty[0];
      board[i] = game.solution[i];
      selected = i;
      if (isSolved(board, game.solution)) return render(true);
      render();
    }

    function render(won) {
      if (!alive) return;
      root.innerHTML = '';
      const bad = showErrors ? new Set([...conflicts(board), ...board.map((v, i) => (v && v !== game.solution[i] ? i : -1)).filter((x) => x >= 0)]) : new Set();
      const grid = U.el('div', { class: 'sudoku-grid' });
      const mins = Math.floor((Date.now() - startedAt) / 60000);
      for (let i = 0; i < 81; i++) {
        const r = Math.floor(i / 9);
        const c = i % 9;
        const cls = ['cell'];
        if (game.givens[i]) cls.push('given');
        if (selected === i) cls.push('sel');
        else if (selected >= 0 && (Math.floor(selected / 9) === r || selected % 9 === c || (Math.floor(selected / 27) === Math.floor(r / 3) && Math.floor((selected % 9) / 3) === Math.floor(c / 3)))) cls.push('peer');
        if (bad.has(i)) cls.push('bad');
        if (c % 3 === 2 && c < 8) cls.push('br');
        if (r % 3 === 2 && r < 8) cls.push('bb');
        grid.appendChild(U.el('div', {
          class: cls.join(' '),
          text: board[i] ? String(board[i]) : '',
          onclick: won || alive === false ? null : function () { selected = i; render(); },
        }));
      }
      root.appendChild(grid);

      const pad = U.el('div', { class: 'pad' });
      for (let v = 1; v <= 9; v++) {
        pad.appendChild(U.el('button', { class: 'btn num', text: String(v), onclick: function () { if (!won) setValue(v); } }));
      }
      pad.appendChild(U.el('button', { class: 'btn num erase', text: '⌫', onclick: function () { if (!won) setValue(0); } }));
      root.appendChild(pad);

      const levelButtons = U.el('div', { class: 'levels' });
      Object.keys(LEVELS).forEach(function (k) {
        levelButtons.appendChild(U.el('button', { class: 'btn ' + (k === level ? '' : 'ghost'), text: LEVELS[k].label, onclick: function () { level = k; U.store.set('sudoku.level', k); newGame(); } }));
      });
      root.appendChild(levelButtons);
      root.appendChild(U.el('div', { class: 'actions' },
        U.el('button', { class: 'btn', text: showErrors ? 'Nascondi errori' : 'Controlla errori', onclick: function () { showErrors = !showErrors; render(); } }),
        U.el('button', { class: 'btn', text: 'Suggerimento 💡', onclick: function () { if (!won) hint(); } }),
        U.el('button', { class: 'btn ghost', text: 'Nuovo', onclick: newGame })));
      root.appendChild(U.el('div', { class: 'msg', text: won ? 'Bravo! Sudoku completato 🦝🎉 Errori: ' + mistakes : 'Tempo: ' + Math.max(0, mins) + ' min · Errori: ' + mistakes + ' · Usa i numeri 1-9 o la tastiera.' }));
    }

    function onKey(e) {
      if (!alive) return;
      if (e.key >= '1' && e.key <= '9') setValue(Number(e.key));
      else if (e.key === 'Backspace' || e.key === 'Delete' || e.key === '0') setValue(0);
      else if (e.key.indexOf('Arrow') === 0 && selected >= 0) {
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

    newGame();
    return {
      destroy: function () {
        alive = false;
        document.removeEventListener('keydown', onKey);
        if (timer) clearInterval(timer);
      },
    };
  }

  return {
    meta: { id: 'sudoku', title: 'Sudoku', icon: '🔢', desc: 'Sudoku a 3 livelli. Ogni puzzle ha una sola soluzione.' },
    mount: mount,
    LEVELS: LEVELS,
    generatePuzzle: generatePuzzle,
    countSolutions: countSolutions,
    isSolved: isSolved,
    conflicts: conflicts,
    PEERS: PEERS,
  };
});
