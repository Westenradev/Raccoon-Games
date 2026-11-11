// Dama italiana with the Damone. You (white, bottom) play against the computer (black, top).
// The board has its dark corner square at the bottom right, as in Italian dama.
// Rules:
// - A pedina moves one step forward on the diagonal. It captures forward only.
// - A pedina can never capture a Damone. Only a Damone can capture a Damone.
// - A Damone moves and captures one step in all four diagonal directions.
// - Capture is mandatory. You must take the most pieces. With the same number,
//   a Damone must capture before a pedina, and then the capture with more Damoni wins.
// - A pedina that reaches the last row becomes a Damone.
// Three CPU levels: Facile, Medio, Difficile.
(function (name, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else (window.RA = window.RA || { modules: {} }).modules[name] = api;
})('dama', function () {
  const isNode = typeof require === 'function';
  const U = isNode ? require('../core/util.js') : window.RA.modules.util;
  const A = isNode ? null : window.RA.audio;
  const SV = isNode ? null : window.RA.modules.saves;

  const WHITE = 'w'; // human, moves up (row index goes down)
  const BLACK = 'b'; // CPU, moves down
  const LEVELS = {
    facile: { label: 'Facile', depth: 2, blunder: 0.35 },
    medio: { label: 'Medio', depth: 4, blunder: 0 },
    difficile: { label: 'Difficile', depth: 8, blunder: 0 },
  };
  const DRAW_PLIES = 80; // 40 moves each without a capture or a pedina move

  const inside = function (r, c) { return r >= 0 && r < 8 && c >= 0 && c < 8; };
  const rowOf = function (i) { return i >> 3; };
  const colOf = function (i) { return i & 7; };
  const other = function (color) { return color === WHITE ? BLACK : WHITE; };

  // Pieces are { c: 'w' | 'b', d: true when Damone }. Only dark squares are used:
  // a square is dark when row + column is even, so the bottom right corner is dark.
  const isDark = function (sq) { return (rowOf(sq) + colOf(sq)) % 2 === 0; };
  function initialBoard() {
    const b = new Array(64).fill(null);
    for (let r = 0; r < 8; r++) {
      for (let c = 0; c < 8; c++) {
        if ((r + c) % 2 === 1) continue;
        if (r < 3) b[r * 8 + c] = { c: BLACK, d: false };
        else if (r > 4) b[r * 8 + c] = { c: WHITE, d: false };
      }
    }
    return b;
  }

  function stepDirs(piece) {
    if (piece.d) return [[-1, -1], [-1, 1], [1, -1], [1, 1]];
    const f = piece.c === WHITE ? -1 : 1;
    return [[f, -1], [f, 1]];
  }

  function canTake(attacker, target) {
    return !!target && target.c !== attacker.c && (!target.d || attacker.d);
  }

  // Capture chains for the piece on sq. Each: { path: [squares], caps: [squares], damoni: n }.
  function captureChains(board, sq, piece) {
    const out = [];
    const dirs = stepDirs(piece);
    const walk = function (b, at, path, caps, damoni) {
      let extended = false;
      const r0 = rowOf(at);
      const c0 = colOf(at);
      for (const d of dirs) {
        const r = r0 + d[0];
        const c = c0 + d[1];
        const lr = r + d[0];
        const lc = c + d[1];
        if (!inside(lr, lc)) continue;
        const x = r * 8 + c;
        const land = lr * 8 + lc;
        if (!canTake(piece, b[x]) || b[land]) continue;
        const nb = b.slice();
        nb[at] = null;
        nb[x] = null;
        nb[land] = piece;
        extended = true;
        walk(nb, land, path.concat([land]), caps.concat([x]), damoni + (b[x].d ? 1 : 0));
      }
      if (!extended && caps.length) out.push({ path: path, caps: caps, damoni: damoni, byDamone: piece.d });
    };
    walk(board, sq, [sq], [], 0);
    return out;
  }

  // All legal moves for one colour: [{ from, to, path, caps }].
  function legalMoves(board, color) {
    let caps = [];
    const simple = [];
    for (let sq = 0; sq < 64; sq++) {
      const p = board[sq];
      if (!p || p.c !== color) continue;
      const chains = captureChains(board, sq, p);
      if (chains.length) caps = caps.concat(chains);
      if (caps.length) continue;
      for (const d of stepDirs(p)) {
        const r = rowOf(sq) + d[0];
        const c = colOf(sq) + d[1];
        if (inside(r, c) && !board[r * 8 + c]) simple.push({ path: [sq, r * 8 + c], caps: [] });
      }
    }
    let moves = simple;
    if (caps.length) {
      // Italian priority rules.
      const most = Math.max.apply(null, caps.map(function (m) { return m.caps.length; }));
      moves = caps.filter(function (m) { return m.caps.length === most; });
      if (moves.some(function (m) { return m.byDamone; })) moves = moves.filter(function (m) { return m.byDamone; });
      const mostDamoni = Math.max.apply(null, moves.map(function (m) { return m.damoni; }));
      moves = moves.filter(function (m) { return m.damoni === mostDamoni; });
    }
    return moves.map(function (m) {
      return { from: m.path[0], to: m.path[m.path.length - 1], path: m.path, caps: m.caps };
    });
  }

  function applyMove(board, mv) {
    const nb = board.slice();
    let piece = nb[mv.from];
    nb[mv.from] = null;
    for (const x of mv.caps) nb[x] = null;
    if (!piece.d && rowOf(mv.to) === (piece.c === WHITE ? 0 : 7)) piece = { c: piece.c, d: true };
    nb[mv.to] = piece;
    return nb;
  }

  function evaluate(board, color) {
    let score = 0;
    for (let sq = 0; sq < 64; sq++) {
      const p = board[sq];
      if (!p) continue;
      let v;
      if (p.d) {
        v = 270;
      } else {
        const r = rowOf(sq);
        const advance = p.c === WHITE ? 7 - r : r;
        v = 100 + advance * 4;
        // Pieces on the home row stop the other side from making a Damone.
        if (advance === 0) v += 8;
      }
      const col = colOf(sq);
      if (col >= 2 && col <= 5) v += 3;
      score += p.c === color ? v : -v;
    }
    return score;
  }

  // Negamax with alpha-beta. Score is from the point of view of the side to move.
  function search(board, color, depth, alpha, beta) {
    const moves = legalMoves(board, color);
    if (moves.length === 0) return -100000 - depth;
    if (depth <= 0) {
      // Do not stop in the middle of an exchange.
      if (!moves[0].caps.length) return evaluate(board, color);
      depth = 1;
    }
    let best = -Infinity;
    for (const mv of moves) {
      const score = -search(applyMove(board, mv), other(color), depth - 1, -beta, -alpha);
      if (score > best) best = score;
      if (best > alpha) alpha = best;
      if (alpha >= beta) break;
    }
    return best;
  }

  // Chooses the CPU move. level is a key of LEVELS.
  function cpuMove(board, color, level, rnd) {
    const cfg = LEVELS[level] || LEVELS.medio;
    const moves = U.shuffle(legalMoves(board, color), rnd);
    if (!moves.length) return null;
    if (moves.length === 1) return moves[0];
    if (cfg.blunder && rnd() < cfg.blunder) return moves[0];
    let best = null;
    let bestScore = -Infinity;
    for (const mv of moves) {
      // Full window for every root move, so equal moves keep their random order.
      const score = -search(applyMove(board, mv), other(color), cfg.depth - 1, -Infinity, -bestScore + 1);
      if (score > bestScore) {
        bestScore = score;
        best = mv;
      }
    }
    return best;
  }

  function pieces(n) {
    return n + (n === 1 ? ' pezzo' : ' pezzi');
  }

  function countPieces(board, color) {
    let n = 0;
    for (const p of board) if (p && p.c === color) n += 1;
    return n;
  }

  // ---------- Browser interface ----------
  function mount(container) {
    let alive = true;
    const timers = [];
    const rnd = U.makeRng();
    let level = U.store.get('dama.level', 'facile');
    if (!LEVELS[level]) level = 'facile';
    let board = initialBoard();
    let turn = WHITE;
    let selected = null;
    let quietPlies = 0;
    let over = null; // 'human' | 'cpu' | 'draw'
    let thinking = false;
    let lastMove = null;
    let choice = null; // capture moves to choose from, when two share start and end
    let note = '';
    const wins = U.store.get('dama.score', { human: 0, cpu: 0 });
    const root = U.el('div', { class: 'dama game-panel tabletop' });
    container.appendChild(root);

    function reset() {
      timers.forEach(clearTimeout);
      board = initialBoard();
      turn = WHITE;
      selected = null;
      quietPlies = 0;
      over = null;
      thinking = false;
      lastMove = null;
      choice = null;
      note = '';
      render();
    }

    // ----- saved game -----
    function persist() {
      if (asking) return; // the saved game is still waiting for an answer
      if (over || !lastMove) return SV.clear('dama');
      SV.save('dama', { board: board, turn: turn, quietPlies: quietPlies, lastMove: lastMove, level: level });
    }

    function restore(saved) {
      board = saved.board;
      turn = saved.turn;
      quietPlies = saved.quietPlies;
      lastMove = saved.lastMove;
      level = LEVELS[saved.level] ? saved.level : level;
      note = 'Partita ripresa da dove l\'avevi lasciata.';
      render();
      if (turn === BLACK) cpuTurn();
    }

    function finish(result) {
      over = result;
      if (result === 'human') wins.human += 1;
      if (result === 'cpu') wins.cpu += 1;
      U.store.set('dama.score', wins);
      if (!A) return;
      if (result === 'human') A.sfx.win();
      else if (result === 'cpu') A.sfx.lose();
      else A.sfx.ok();
    }

    function playMove(mv) {
      const wasMan = !board[mv.from].d;
      board = applyMove(board, mv);
      quietPlies = mv.caps.length || wasMan ? 0 : quietPlies + 1;
      lastMove = mv;
      if (A) {
        A.sfx.knock();
        if (mv.caps.length) A.sfx.pop();
      }
      if (A && wasMan && board[mv.to].d) A.sfx.power();
      turn = other(turn);
      selected = null;
      if (!legalMoves(board, turn).length) finish(turn === WHITE ? 'cpu' : 'human');
      else if (quietPlies >= DRAW_PLIES) finish('draw');
    }

    function cpuTurn() {
      thinking = true;
      render();
      timers.push(setTimeout(function () {
        if (!alive) return;
        const mv = cpuMove(board, BLACK, level, rnd);
        thinking = false;
        if (mv) playMove(mv);
        note = mv && mv.caps.length ? 'L\'avversario ha mangiato ' + mv.caps.length + (mv.caps.length === 1 ? ' pezzo.' : ' pezzi.') : '';
        // Tell the player at once when the answer must be a capture.
        const reply = over ? [] : legalMoves(board, WHITE);
        if (note && reply.length && reply[0].caps.length) note += ' Ora devi mangiare tu: tocca un pezzo con il cerchio.';
        render();
      }, 500));
    }

    function humanMove(mv) {
      choice = null;
      playMove(mv);
      note = '';
      render();
      if (!over) cpuTurn();
    }

    // Several captures can share start and end. Routes that give the same position count as one.
    // When they differ, the player picks the piece to take at the first point where they differ.
    function askRoute(cands) {
      const seen = {};
      const unique = cands.filter(function (m) {
        const k = JSON.stringify(applyMove(board, m));
        if (seen[k]) return false;
        seen[k] = true;
        return true;
      });
      if (unique.length === 1) return humanMove(unique[0]);
      let at = 0;
      while (unique.every(function (m) { return m.caps[at] === unique[0].caps[at]; })) at += 1;
      choice = { moves: unique, at: at };
      note = 'Puoi mangiare in due modi. Tocca il pezzo che vuoi mangiare.';
      if (A) A.sfx.click();
      render();
    }

    function clickSquare(sq) {
      if (over || turn !== WHITE || thinking) return;
      const moves = legalMoves(board, WHITE);
      if (choice) {
        const picked = choice.moves.filter(function (m) { return m.caps[choice.at] === sq; });
        choice = null;
        note = '';
        if (picked.length) return askRoute(picked);
      }
      if (selected !== null) {
        const same = moves.filter(function (m) { return m.from === selected && m.to === sq; });
        if (same.length) return askRoute(same);
      }
      const p = board[sq];
      if (p && p.c === WHITE) {
        if (moves.some(function (m) { return m.from === sq; })) {
          selected = selected === sq ? null : sq;
          note = '';
          if (A) A.sfx.click();
        } else {
          selected = null;
          note = moves[0].caps.length ? 'Devi mangiare: muovi un pezzo con il cerchio.' : 'Questo pezzo non può muoversi.';
          if (A) A.sfx.bad();
        }
      } else {
        selected = null;
      }
      render();
    }

    function render() {
      if (!alive) return;
      root.innerHTML = '';
      const myTurn = !over && turn === WHITE && !thinking;
      const moves = myTurn ? legalMoves(board, WHITE) : [];
      const movable = new Set(moves.map(function (m) { return m.from; }));
      const targets = choice
        ? new Set(choice.moves.map(function (m) { return m.caps[choice.at]; }))
        : new Set(moves.filter(function (m) { return m.from === selected; }).map(function (m) { return m.to; }));
      const mustCapture = moves.length > 0 && moves[0].caps.length > 0;

      root.appendChild(U.el('div', { class: 'pill-row' },
        U.el('div', { class: 'pill', text: 'Tu (bianco): ' + pieces(countPieces(board, WHITE)) }),
        U.el('div', { class: 'pill', text: 'Avversario (nero): ' + pieces(countPieces(board, BLACK)) }),
        U.el('div', { class: 'pill', text: 'Partite vinte: ' + wins.human + ' a ' + wins.cpu })));

      const boardEl = U.el('div', { class: 'checker-board' });
      for (let sq = 0; sq < 64; sq++) {
        const dark = isDark(sq);
        const cls = ['sq', dark ? 'dark' : 'light'];
        if (selected === sq) cls.push('sel');
        if (targets.has(sq)) cls.push('target');
        if (lastMove && (lastMove.from === sq || lastMove.to === sq)) cls.push('last');
        if (lastMove && lastMove.caps.indexOf(sq) >= 0) cls.push('taken');
        const cell = U.el('div', { class: cls.join(' '), 'data-sq': sq, onclick: dark ? function () { clickSquare(sq); } : null });
        const p = board[sq];
        if (p) {
          const pc = ['piece', p.c === WHITE ? 'white' : 'black'];
          if (p.d) pc.push('damone');
          if (movable.has(sq)) pc.push(mustCapture ? 'must' : 'movable');
          cell.appendChild(U.el('div', { class: pc.join(' ') }));
        }
        boardEl.appendChild(cell);
      }
      root.appendChild(boardEl);

      let msg = note;
      if (over) msg = over === 'human' ? 'Hai vinto!' : over === 'cpu' ? 'Ha vinto l\'avversario' : 'Patta: 40 mosse a testa senza prese e senza mosse di pedina.';
      else if (thinking) msg = 'L\'avversario sta pensando…';
      else if (!msg) msg = mustCapture ? 'Devi mangiare. Tocca un pezzo con il cerchio.' : (selected === null ? 'Tocca un tuo pezzo, poi la casella di arrivo.' : 'Ora tocca una casella con il pallino bianco.');
      root.appendChild(U.el('div', { class: 'msg' + (over ? ' big' : ''), text: msg }));

      const levels = U.el('div', { class: 'levels' }, U.el('span', { class: 'hint', text: 'Livello' }));
      Object.keys(LEVELS).forEach(function (k) {
        levels.appendChild(U.el('button', {
          class: 'btn ' + (k === level ? '' : 'ghost'),
          'data-level': k,
          text: LEVELS[k].label,
          onclick: function () {
            level = k;
            U.store.set('dama.level', k);
            render();
          },
        }));
      });
      levels.appendChild(U.el('button', { class: 'btn ghost', text: 'Nuova partita', onclick: reset }));
      root.appendChild(levels);
      root.appendChild(U.el('div', { class: 'legend' },
        U.el('span', null, U.el('i', { class: 'piece white' }), 'Pedina: muove e mangia in avanti'),
        U.el('span', null, U.el('i', { class: 'piece white damone' }), 'Damone: muove in ogni direzione. Solo un Damone lo può mangiare')));
    }

    const saved = SV.load('dama');
    let asking = !!saved;
    if (saved) {
      SV.ask(root, 'Dama: tu ' + pieces(countPieces(saved.board, WHITE)) + ', avversario ' + pieces(countPieces(saved.board, BLACK)) + '.',
        function () { asking = false; restore(saved); },
        function () { asking = false; SV.clear('dama'); render(); });
    } else {
      render();
    }
    return {
      destroy: function () {
        persist();
        alive = false;
        timers.forEach(clearTimeout);
      },
      save: persist,
      debug: {
        get board() { return board; },
        get turn() { return turn; },
        get over() { return over; },
        get thinking() { return thinking; },
        get level() { return level; },
        legalMoves: function () { return legalMoves(board, turn); },
      },
    };
  }

  return {
    meta: { id: 'dama', title: 'Dama', desc: 'Dama italiana. Solo un Damone può mangiare un Damone.' },
    mount: mount,
    LEVELS: LEVELS,
    initialBoard: initialBoard,
    isDark: isDark,
    legalMoves: legalMoves,
    applyMove: applyMove,
    cpuMove: cpuMove,
    evaluate: evaluate,
    WHITE: WHITE,
    BLACK: BLACK,
  };
});
