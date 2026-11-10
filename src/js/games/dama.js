// Dama (checkers) with Damone. Rule: a Damone can only be captured by another Damone.
// Pedina (man): moves one step forward, captures in all four directions.
// Damone (king): flies along diagonals, captures like a flying king.
// Captures are mandatory. Three CPU levels: Facile, Medio, Difficile (search depth).
(function (name, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else (window.RA = window.RA || { modules: {} }).modules[name] = api;
})('dama', function () {
  const isNode = typeof require === 'function';
  const U = isNode ? require('../core/util.js') : window.RA.modules.util;
  const A = isNode ? null : window.RA.audio;

  const WHITE = 'w'; // human, moves up (row decreases)
  const BLACK = 'b'; // CPU, moves down (row increases)
  const DIRS = [[-1, -1], [-1, 1], [1, -1], [1, 1]];
  const LEVELS = {
    facile: { label: 'Facile 🐣', depth: 2 },
    medio: { label: 'Medio 🦝', depth: 4 },
    difficile: { label: 'Difficile 🐺', depth: 5 },
  };
  const VALUE = { man: 1, damone: 2.4 };

  function initialBoard() {
    const b = new Array(64).fill(null);
    for (let r = 0; r < 8; r++) {
      for (let c = 0; c < 8; c++) {
        if ((r + c) % 2 === 0) continue; // only dark squares are used
        if (r < 3) b[r * 8 + c] = { c: BLACK, d: false };
        else if (r > 4) b[r * 8 + c] = { c: WHITE, d: false };
      }
    }
    return b;
  }

  const inside = (r, c) => r >= 0 && r < 8 && c >= 0 && c < 8;
  const rowOf = (i) => Math.floor(i / 8);
  const colOf = (i) => i % 8;

  function canTake(attacker, target) {
    return target.c !== attacker.c && (!target.d || attacker.d);
  }

  // Finds capture chains for one piece standing on sq. Returns list of { path, caps }.
  function captureChains(board, sq, piece) {
    const out = [];
    const walk = function (b, at, path, caps) {
      let extended = false;
      const r0 = rowOf(at);
      const c0 = colOf(at);
      DIRS.forEach(function (d) {
        if (piece.d) {
          // Flying: skip empty squares, then one enemy, then any empty landing beyond it.
          let r = r0 + d[0];
          let c = c0 + d[1];
          while (inside(r, c) && !b[r * 8 + c]) { r += d[0]; c += d[1]; }
          if (!inside(r, c)) return;
          const target = b[r * 8 + c];
          if (!canTake(piece, target)) return;
          const x = r * 8 + c;
          let lr = r + d[0];
          let lc = c + d[1];
          while (inside(lr, lc) && !b[lr * 8 + lc]) {
            const land = lr * 8 + lc;
            const nb = b.slice();
            nb[at] = null;
            nb[x] = null;
            nb[land] = piece;
            extended = true;
            walk(nb, land, path.concat([land]), caps.concat([x]));
            lr += d[0];
            lc += d[1];
          }
        } else {
          const r = r0 + d[0];
          const c = c0 + d[1];
          const lr = r + d[0];
          const lc = c + d[1];
          if (!inside(lr, lc) || !inside(r, c)) return;
          const target = b[r * 8 + c];
          if (!target || !canTake(piece, target)) return;
          if (b[lr * 8 + lc]) return;
          const x = r * 8 + c;
          const land = lr * 8 + lc;
          const nb = b.slice();
          nb[at] = null;
          nb[x] = null;
          nb[land] = piece;
          extended = true;
          walk(nb, land, path.concat([land]), caps.concat([x]));
        }
      });
      if (!extended && caps.length) out.push({ path: path, caps: caps });
    };
    walk(board.slice(), sq, [sq], []);
    return out;
  }

  function simpleMoves(board, sq, piece) {
    const out = [];
    const r0 = rowOf(sq);
    const c0 = colOf(sq);
    if (piece.d) {
      DIRS.forEach(function (d) {
        let r = r0 + d[0];
        let c = c0 + d[1];
        while (inside(r, c) && !board[r * 8 + c]) {
          out.push({ path: [sq, r * 8 + c], caps: [] });
          r += d[0];
          c += d[1];
        }
      });
    } else {
      const fwd = piece.c === WHITE ? -1 : 1;
      [-1, 1].forEach(function (dc) {
        const r = r0 + fwd;
        const c = c0 + dc;
        if (inside(r, c) && !board[r * 8 + c]) out.push({ path: [sq, r * 8 + c], caps: [] });
      });
    }
    return out;
  }

  // All legal moves for one colour. Captures are mandatory when present.
  function legalMoves(board, color) {
    let caps = [];
    let simple = [];
    for (let sq = 0; sq < 64; sq++) {
      const p = board[sq];
      if (!p || p.c !== color) continue;
      captureChains(board, sq, p).forEach((m) => caps.push(m));
      if (!caps.length) simple = simple.concat(simpleMoves(board, sq, p));
    }
    const moves = caps.length ? caps : simple;
    return moves.map((m) => ({ from: m.path[0], to: m.path[m.path.length - 1], path: m.path, caps: m.caps }));
  }

  function applyMove(board, mv) {
    const nb = board.slice();
    let piece = nb[mv.from];
    nb[mv.from] = null;
    mv.caps.forEach((x) => { nb[x] = null; });
    const last = mv.to;
    const promoRow = piece.c === WHITE ? 0 : 7;
    if (!piece.d && rowOf(last) === promoRow) piece = { c: piece.c, d: true };
    nb[last] = piece;
    return nb;
  }

  function evaluate(board, forColor) {
    let score = 0;
    for (let sq = 0; sq < 64; sq++) {
      const p = board[sq];
      if (!p) continue;
      const sign = p.c === forColor ? 1 : -1;
      let v = p.d ? VALUE.damone : VALUE.man;
      if (!p.d) {
        const progress = p.c === WHITE ? 7 - rowOf(sq) : rowOf(sq);
        v += progress * 0.04;
      }
      score += sign * v;
    }
    return score;
  }

  // Alpha-beta search. Returns best score for side to move.
  function minimax(board, color, depth, alpha, beta) {
    const moves = legalMoves(board, color);
    if (moves.length === 0) return -1000 - depth;
    if (depth === 0) return evaluate(board, color);
    const other = color === WHITE ? BLACK : WHITE;
    let best = -Infinity;
    for (const mv of moves) {
      const nb = applyMove(board, mv);
      const score = -minimax(nb, other, depth - 1, -beta, -alpha);
      if (score > best) best = score;
      if (best > alpha) alpha = best;
      if (alpha >= beta) break;
    }
    return best;
  }

  // Chooses the CPU move for the given level.
  function cpuMove(board, color, depth, rnd) {
    const moves = legalMoves(board, color);
    if (!moves.length) return null;
    const other = color === WHITE ? BLACK : WHITE;
    let best = null;
    let bestScore = -Infinity;
    U.shuffle(moves.slice(), rnd).forEach((mv) => {
      const nb = applyMove(board, mv);
      let score = -minimax(nb, other, depth - 1, -Infinity, Infinity);
      score += rnd() * 0.01; // break ties differently each game
      if (score > bestScore) {
        bestScore = score;
        best = mv;
      }
    });
    return best;
  }

  // ---------- Browser interface ----------
  function mount(container, ctx) {
    let alive = true;
    let timer = null;
    let rnd = U.makeRng();
    let level = U.store.get('dama.level', 'facile');
    let board = initialBoard();
    let turn = WHITE;
    let selected = null;
    let targets = [];
    let quietPlies = 0;
    let over = null;
    let thinking = false;
    let wins = { human: U.store.get('dama.wins', 0), cpu: 0 };
    const root = U.el('div', { class: 'dama game-panel' });
    container.appendChild(root);

    function reset() {
      board = initialBoard();
      turn = WHITE;
      selected = null;
      targets = [];
      quietPlies = 0;
      over = null;
      thinking = false;
      render();
    }

    function checkEnd() {
      const moves = legalMoves(board, turn);
      if (moves.length === 0) {
        over = turn === WHITE ? 'cpu' : 'human';
        if (over === 'human') {
          wins.human += 1;
          U.store.set('dama.wins', wins.human);
        } else {
          wins.cpu += 1;
        }
        if (A) over === 'human' ? A.sfx.win() : A.sfx.lose();
        return true;
      }
      if (quietPlies >= 80) {
        over = 'draw';
        return true;
      }
      return false;
    }

    function playMove(mv) {
      const wasCapture = mv.caps.length > 0;
      const piece = board[mv.from];
      const wasMan = !piece.d;
      board = applyMove(board, mv);
      const promoted = wasMan && board[mv.to].d;
      quietPlies = wasCapture || promoted ? 0 : quietPlies + 1;
      if (A) wasCapture ? A.sfx.pop() : A.sfx.place();
      turn = turn === WHITE ? BLACK : WHITE;
      selected = null;
      targets = [];
    }

    function cpuTurn() {
      if (!alive || over || turn !== BLACK) return;
      thinking = true;
      render();
      timer = setTimeout(function () {
        if (!alive) return;
        const mv = cpuMove(board, BLACK, LEVELS[level].depth, rnd);
        thinking = false;
        if (mv) playMove(mv);
        if (checkEnd()) return render();
        render();
      }, 450);
    }

    function clickSquare(sq) {
      if (over || turn !== WHITE || thinking) return;
      const p = board[sq];
      const moves = legalMoves(board, WHITE);
      if (selected !== null) {
        const mv = moves.find((m) => m.from === selected && m.to === sq);
        if (mv) {
          playMove(mv);
          if (!checkEnd()) cpuTurn();
          return render();
        }
        if (p && p.c === WHITE) {
          // Switch selection to another own piece.
        } else {
          selected = null;
          targets = [];
          return render();
        }
      }
      if (p && p.c === WHITE) {
        const own = moves.filter((m) => m.from === sq);
        if (!own.length) {
          if (A) A.sfx.bad();
          return;
        }
        selected = sq;
        targets = own.map((m) => m.to);
        if (A) A.sfx.click();
        render();
      }
    }

    function render() {
      if (!alive) return;
      root.innerHTML = '';
      root.appendChild(U.el('div', { class: 'dama-top' },
        U.el('span', { text: 'Tu: pedine e damoni (bianchi)' }),
        U.el('span', { text: 'Gatto: (neri) · Vittorie tue: ' + wins.human }) ));
      const boardEl = U.el('div', { class: 'checker-board' });
      for (let sq = 0; sq < 64; sq++) {
        const r = rowOf(sq);
        const c = colOf(sq);
        const dark = (r + c) % 2 === 1;
        const cls = ['sq', dark ? 'dark' : 'light'];
        if (selected === sq) cls.push('sel');
        if (targets.indexOf(sq) >= 0) cls.push('target');
        const cell = U.el('div', { class: cls.join(' '), onclick: function () { if (dark) clickSquare(sq); } });
        const p = board[sq];
        if (p) {
          const piece = U.el('div', { class: 'piece ' + (p.c === WHITE ? 'white' : 'black') + (p.d ? ' damone' : '') });
          piece.textContent = p.d ? (p.c === WHITE ? '🦝' : '🐱') : (p.c === WHITE ? '🐭' : '🐕');
          if (p.d) piece.appendChild(U.el('span', { class: 'crown', text: '👑' }));
          cell.appendChild(piece);
        }
        boardEl.appendChild(cell);
      }
      root.appendChild(boardEl);
      const msg = over
        ? (over === 'human' ? 'Hai vinto! 🦝🎉' : over === 'cpu' ? 'Ha vinto il Gatto 🐱' : 'Patta: troppe mosse senza catture.')
        : (thinking ? 'Il Gatto sta pensando...' : (turn === WHITE ? 'Tocca una tua pedina, poi la casella di arrivo.' : 'Turno del Gatto.'));
      root.appendChild(U.el('div', { class: 'msg', text: msg }));
      root.appendChild(U.el('div', { class: 'levels' },
        Object.keys(LEVELS).map(function (k) {
          return U.el('button', { class: 'btn ' + (k === level ? '' : 'ghost'), text: LEVELS[k].label, onclick: function () {
            level = k;
            U.store.set('dama.level', k);
            reset();
          } });
        })));
      root.appendChild(U.el('div', { class: 'actions' },
        U.el('button', { class: 'btn', text: 'Nuova partita', onclick: reset }),
        U.el('span', { class: 'hint', text: 'Damone: solo un altro damone lo può mangiare.' })));
      root.appendChild(U.el('p', { class: 'small-list', text: 'Le pedine possono mangiare in ogni direzione. Le catture sono obbligatorie.' }));
    }

    render();
    return {
      destroy: function () {
        alive = false;
        if (timer) clearTimeout(timer);
      },
    };
  }

  return {
    meta: { id: 'dama', title: 'Dama', icon: '⛀', desc: 'Dama con Damone. Il Damone si mangia solo con un altro Damone.' },
    mount: mount,
    LEVELS: LEVELS,
    initialBoard: initialBoard,
    legalMoves: legalMoves,
    applyMove: applyMove,
    cpuMove: cpuMove,
    WHITE: WHITE,
    BLACK: BLACK,
  };
});
