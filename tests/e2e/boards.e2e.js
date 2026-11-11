#!/usr/bin/env node
// End-to-end test for Sudoku, Mahjong and Dama, played through the real page in headless Chromium.
//
// Run:   node tests/e2e/boards.e2e.js [--only=sudoku,mahjong,dama] [--seed=N] [--shots=DIR] [--strict]
// Env:   DAMA_GAMES=2 (complete games per level), SHOT_DIR=dir (same as --shots), STRICT=1 (same as --strict)
// Time:  about 5 minutes for everything (Dama takes most of it: the CPU waits 500 ms before each move).
//
// The page's read-only debug hook (window.RA.current.debug) is used only to READ the state.
// Every action is a real mouse click or key press. The rules are checked against an independent
// implementation written in this file (not the game's own modules).
// Buttons and messages are matched by a key word, so small changes of the wording do not break the test.
// Exit code 0 = all hard checks passed. "KNOWN" lines are defects that are already reported and
// do not fail the run, unless --strict is given. (At the moment no check is marked as known.)
// One exception to "read only": the block "two capture routes" in the Dama section places a position
// by writing into debug.board, because that position cannot be reached on purpose in a normal game.
'use strict';
const path = require('path');
const fs = require('fs');
const { chromium } = require('playwright');

const ARGS = process.argv.slice(2);
const argVal = (name) => { const a = ARGS.find((x) => x.indexOf('--' + name + '=') === 0); return a ? a.slice(name.length + 3) : null; };
const ONLY = (argVal('only') || 'sudoku,mahjong,dama').split(',');
const SEED = Number(argVal('seed') || process.env.SEED || 20240611);
const SHOT_DIR = argVal('shots') || process.env.SHOT_DIR || null;
const STRICT = ARGS.indexOf('--strict') >= 0 || process.env.STRICT === '1';
const DAMA_GAMES = Number(process.env.DAMA_GAMES || 2);
const PAGE_URL = 'file://' + path.resolve(__dirname, '..', '..', 'src', 'index.html');

// ---------- small test kit ----------
const failures = [];
const known = [];
const notes = [];
let checks = 0;
function ok(cond, msg) {
  checks += 1;
  if (!cond) { failures.push(msg); console.log('  FAIL: ' + msg); }
  return !!cond;
}
function eq(a, b, msg) {
  const A = JSON.stringify(a); const B = JSON.stringify(b);
  const cut = (s) => (s && s.length > 220 ? s.slice(0, 220) + '…' : s);
  return ok(A === B, msg + ' (got ' + cut(A) + ', expected ' + cut(B) + ')');
}
// A defect that is already in the bug report: does not fail the run unless --strict.
function knownBug(cond, msg) {
  checks += 1;
  if (cond) return true;
  if (STRICT) { failures.push(msg); console.log('  FAIL (strict): ' + msg); } else if (known.indexOf(msg) < 0) { known.push(msg); console.log('  KNOWN: ' + msg); }
  return false;
}
function makeRng(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
let rnd = makeRng(SEED);
const pickOne = (arr) => arr[Math.floor(rnd() * arr.length)];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const sortNum = (arr) => arr.slice().sort((a, b) => a - b);
const has = (list, name) => list.indexOf(name) >= 0;
let page = null;
let shotCount = 0;
async function shot(name) {
  if (!SHOT_DIR) return;
  fs.mkdirSync(SHOT_DIR, { recursive: true });
  shotCount += 1;
  await page.screenshot({ path: path.join(SHOT_DIR, name + '.png') });
}
const onMenu = () => page.evaluate(() => !window.RA.current && document.querySelectorAll('#stage .tile').length > 0);
async function waitMenu() {
  await page.waitForFunction(() => !window.RA.current && document.querySelectorAll('#stage .tile').length > 0, null, { timeout: 5000 });
}
// Opens a game with a real click on its menu tile.
async function openFromMenu(title, readySelector) {
  if (!(await onMenu())) await page.keyboard.press('Escape');
  await waitMenu();
  await page.locator('#stage .tile', { has: page.locator('.tile-title', { hasText: new RegExp('^\\s*' + title + '\\s*$') }) }).first().click();
  await page.waitForSelector(readySelector);
}
// Counts the calls of every sound effect (window.RA.audio.sfx.*), to check which sound a result plays.
async function installSoundSpy() {
  await page.evaluate(() => {
    if (window.__sfx) return;
    window.__sfx = {};
    const sfx = window.RA.audio.sfx;
    Object.keys(sfx).forEach((name) => {
      const real = sfx[name];
      window.__sfx[name] = 0;
      sfx[name] = function () { window.__sfx[name] += 1; return real.apply(this, arguments); };
    });
  });
}
const sounds = () => page.evaluate(() => Object.assign({}, window.__sfx));
// Clicks the first button inside scope whose text matches the word.
const clickBtn = (scope, re) => page.locator(scope + ' button', { hasText: re }).first().click({ timeout: 5000 });
// Checks that the page does not need scrolling at the main window size (1120 x 812).
async function checkFits(name) {
  const m = await page.evaluate(() => ({ sh: document.documentElement.scrollHeight, ch: document.documentElement.clientHeight, sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
  ok(m.sh <= m.ch, name + ': the game fits in the 1120 x 812 window without scrolling (it is ' + (m.sh - m.ch) + ' px too tall)');
  ok(m.sw <= m.cw, name + ': no horizontal overflow at 1120 x 812');
  return m.sh - m.ch;
}

// =====================================================================================
// SUDOKU
// =====================================================================================
const sudokuState = () => page.evaluate(() => {
  const d = window.RA.current.debug;
  const q = (s) => Array.from(document.querySelectorAll(s));
  const text = document.querySelector('.sudoku').textContent;
  const num = (re) => { const m = text.match(re); return m ? Number(m[1]) : null; };
  return {
    puzzle: d.game.puzzle.slice(), solution: d.game.solution.slice(), givens: d.game.givens.slice(),
    board: d.board.slice(), won: d.won, level: d.level,
    cells: q('.sudoku-grid .cell').map((c) => ({ i: Number(c.dataset.i), t: c.textContent, cls: c.className.split(' ') })),
    clock: document.querySelector('.sudoku .clock').textContent,
    errors: num(/Errori\s*:?\s*(\d+)/), hints: num(/Aiuti\s*:?\s*(\d+)/),
    msg: document.querySelector('.sudoku .msg').textContent,
    pad: q('.pad .btn.num').map((b) => ({ t: b.textContent, done: b.classList.contains('done'), title: b.title, small: b.querySelector('small') ? b.querySelector('small').textContent : null })),
    levels: q('.sudoku .levels .btn').map((b) => ({ t: b.textContent.trim(), on: !b.classList.contains('ghost') })),
    actions: q('.sudoku .actions .btn').map((b) => b.textContent.trim()),
    ls: localStorage.getItem('ra.sudoku.level'),
  };
});

// Independent solver: counts solutions up to limit.
function sudokuCount(grid, limit) {
  const b = grid.slice();
  let count = 0;
  const canPut = (i, v) => {
    const r = Math.floor(i / 9); const c = i % 9;
    for (let k = 0; k < 9; k++) if (b[r * 9 + k] === v || b[k * 9 + c] === v) return false;
    const br = r - (r % 3); const bc = c - (c % 3);
    for (let dr = 0; dr < 3; dr++) for (let dc = 0; dc < 3; dc++) if (b[(br + dr) * 9 + bc + dc] === v) return false;
    return true;
  };
  const rec = () => {
    let best = -1; let bestOpts = null;
    for (let i = 0; i < 81; i++) {
      if (b[i]) continue;
      const opts = [];
      for (let v = 1; v <= 9; v++) if (canPut(i, v)) opts.push(v);
      if (!opts.length) return;
      if (!bestOpts || opts.length < bestOpts.length) { best = i; bestOpts = opts; }
    }
    if (best < 0) { count += 1; return; }
    for (const v of bestOpts) { b[best] = v; rec(); b[best] = 0; if (count >= limit) return; }
  };
  rec();
  return count;
}
// Independent grading with human steps. Returns 0 when "single" steps are enough (one number for a
// cell, one cell for a number), 1 when locked numbers or pairs are needed too, 2 when even those fail.
function sudokuGrade(puzzle) {
  const units = [];
  for (let k = 0; k < 9; k++) {
    units.push(Array.from({ length: 9 }, (_, j) => k * 9 + j));
    units.push(Array.from({ length: 9 }, (_, j) => j * 9 + k));
    units.push(Array.from({ length: 9 }, (_, j) => (Math.floor(k / 3) * 3 + Math.floor(j / 3)) * 9 + (k % 3) * 3 + (j % 3)));
  }
  const peersOf = (i) => units.filter((u) => u.indexOf(i) >= 0).reduce((all, u) => all.concat(u), []).filter((x) => x !== i);
  const b = puzzle.slice();
  const cand = b.map((v, i) => {
    const set = new Set();
    if (!v) for (let d = 1; d <= 9; d++) if (peersOf(i).every((q) => b[q] !== d)) set.add(d);
    return set;
  });
  const put = (i, d) => { b[i] = d; cand[i].clear(); peersOf(i).forEach((q) => cand[q].delete(d)); };
  let level = 0;
  for (let guard = 0; guard < 500; guard++) {
    if (b.every((v) => v)) return level;
    let moved = false;
    for (let i = 0; i < 81 && !moved; i++) if (!b[i] && cand[i].size === 1) { put(i, Array.from(cand[i])[0]); moved = true; }
    for (const u of units) {
      for (let d = 1; d <= 9 && !moved; d++) {
        const spots = u.filter((i) => cand[i].has(d));
        if (spots.length === 1) { put(spots[0], d); moved = true; }
      }
    }
    if (moved) continue;
    let cut = false;
    for (const u of units) {
      for (let d = 1; d <= 9; d++) { // locked numbers
        const spots = u.filter((i) => cand[i].has(d));
        if (spots.length < 2 || spots.length > 3) continue;
        for (const o of units) {
          if (o === u || !spots.every((i) => o.indexOf(i) >= 0)) continue;
          o.forEach((i) => { if (spots.indexOf(i) < 0 && cand[i].has(d)) { cand[i].delete(d); cut = true; } });
        }
      }
      for (let x = 0; x < 9; x++) { // pairs
        for (let y = x + 1; y < 9; y++) {
          const A = cand[u[x]]; const B = cand[u[y]];
          if (A.size !== 2 || B.size !== 2 || !Array.from(A).every((d) => B.has(d))) continue;
          u.forEach((i, k) => { if (k !== x && k !== y) A.forEach((d) => { if (cand[i].has(d)) { cand[i].delete(d); cut = true; } }); });
        }
      }
    }
    if (!cut) return 2;
    level = 1;
  }
  return 2;
}
function validSolution(s) {
  const units = [];
  for (let k = 0; k < 9; k++) {
    units.push(Array.from({ length: 9 }, (_, j) => k * 9 + j));
    units.push(Array.from({ length: 9 }, (_, j) => j * 9 + k));
    units.push(Array.from({ length: 9 }, (_, j) => (Math.floor(k / 3) * 3 + Math.floor(j / 3)) * 9 + (k % 3) * 3 + (j % 3)));
  }
  return units.every((u) => new Set(u.map((i) => s[i])).size === 9 && u.every((i) => s[i] >= 1 && s[i] <= 9));
}
function checkSudokuDom(st, label) {
  let good = st.cells.length === 81;
  let sel = 0;
  st.cells.forEach((c, k) => {
    if (c.i !== k) good = false;
    if (c.t !== (st.board[k] ? String(st.board[k]) : '')) good = false;
    if (has(c.cls, 'given') !== st.givens[k]) good = false;
    if (has(c.cls, 'sel')) sel += 1;
  });
  ok(good, 'sudoku ' + label + ': the 81 cells on screen match debug.board and the givens');
  ok(sel <= 1, 'sudoku ' + label + ': at most one selected cell');
  const counts = new Array(10).fill(0);
  st.board.forEach((v) => { counts[v] += 1; });
  ok(st.pad.length === 10 && st.pad.slice(0, 9).every((b, k) => {
    const left = Math.max(0, 9 - counts[k + 1]);
    const shown = (b.title.match(/\d+/) || [null])[0];
    // the small label on the key: "ancora N" while numbers are missing, "fatto" when all nine are placed
    const label = b.small === null ? true : left === 0 ? /fatto/i.test(b.small) : (b.small.match(/\d+/) || [''])[0] === String(left);
    return b.t.charAt(0) === String(k + 1) && b.done === (left === 0) && shown === String(left) && label;
  }), 'sudoku ' + label + ': number pad shows 1-9, each with the right count of missing numbers');
}
const cellSel = (i) => '.sudoku-grid .cell[data-i="' + i + '"]';
const padClick = (v) => page.locator('.pad .btn.num').nth(v === 0 ? 9 : v - 1).click();
const selectedCell = (st) => { const c = st.cells.find((x) => has(x.cls, 'sel')); return c ? c.i : -1; };
const RE_ERRORS = /errori/i;
const RE_HINT = /aiuto/i;
const RE_NEW_SUDOKU = /nuovo/i;

async function sudokuLevel(levelKey, levelLabel, expectGivens, stats) {
  const tag = levelKey;
  await clickBtn('.sudoku .levels', new RegExp('^\\s*' + levelLabel));
  let st = await sudokuState();
  eq(st.level, levelKey, 'sudoku: level button "' + levelLabel + '" sets the level');
  eq(st.ls, JSON.stringify(levelKey), 'sudoku: level is saved in localStorage');
  ok(st.levels.filter((b) => b.on).length === 1 && st.levels.find((b) => b.on).t.indexOf(levelLabel) === 0, 'sudoku ' + tag + ': exactly the chosen level button is highlighted');
  checkSudokuDom(st, tag + ' start');
  const givenCount = st.givens.filter(Boolean).length;
  stats.givens[levelKey] = givenCount;
  eq(givenCount, expectGivens, 'sudoku ' + tag + ': number of givens');
  ok(st.puzzle.every((v, i) => (v === 0) === !st.givens[i] && (v === 0 || v === st.solution[i])), 'sudoku ' + tag + ': givens agree with the solution');
  ok(validSolution(st.solution), 'sudoku ' + tag + ': debug solution is a valid grid');
  eq(sudokuCount(st.puzzle, 2), 1, 'sudoku ' + tag + ': puzzle has exactly one solution (independent solver)');
  // Facile and Medio need single steps only; Difficile needs pairs or locked numbers, never guessing.
  const graded = sudokuGrade(st.puzzle);
  stats.grades[levelKey] = graded;
  eq(graded, levelKey === 'difficile' ? 1 : 0, 'sudoku ' + tag + ': difficulty by human steps (0 singles, 1 pairs/locked numbers, 2 not solvable that way)');
  ok(/tastiera/i.test(st.msg), 'sudoku ' + tag + ': the help line mentions the keyboard ("' + st.msg + '")');
  eq([st.clock, st.errors, st.hints], ['0:00', 0, 0], 'sudoku ' + tag + ': clock and counters start at zero');
  ok(st.actions.length === 3 && /Mostra/i.test(st.actions[0]) && RE_ERRORS.test(st.actions[0]) && RE_HINT.test(st.actions[1]) && RE_NEW_SUDOKU.test(st.actions[2]), 'sudoku ' + tag + ': action buttons (show errors, hint, new)');
  const sol = st.solution;
  const empties = [];
  const givens = [];
  for (let i = 0; i < 81; i++) (st.givens[i] ? givens : empties).push(i);
  const wrongFor = (i) => (sol[i] % 9) + 1;
  let mistakes = 0;
  let hints = 0;
  const sfxStart = await sounds();

  // --- givens cannot be changed (mouse pad, keyboard digit, Backspace, Delete, erase button)
  for (const g of [givens[0], givens[givens.length - 1], pickOne(givens)]) {
    await page.click(cellSel(g));
    await padClick(wrongFor(g));
    await page.keyboard.press(String(wrongFor(g)));
    await page.keyboard.press('Backspace');
    await page.keyboard.press('Delete');
    await padClick(0);
  }
  st = await sudokuState();
  eq(st.board, st.puzzle, 'sudoku ' + tag + ': givens cannot be changed or erased');
  eq(st.errors, 0, 'sudoku ' + tag + ': touching a given does not count as a mistake');

  // --- wrong entry with the pad, show errors, erase with the pad
  const a = empties[0];
  await page.click(cellSel(a));
  st = await sudokuState();
  eq(selectedCell(st), a, 'sudoku ' + tag + ': clicking a cell selects it');
  const ar = Math.floor(a / 9); const ac = a % 9;
  ok(st.cells.every((c) => {
    const r = Math.floor(c.i / 9); const col = c.i % 9;
    const peer = c.i !== a && (r === ar || col === ac || (Math.floor(r / 3) === Math.floor(ar / 3) && Math.floor(col / 3) === Math.floor(ac / 3)));
    return has(c.cls, 'peer') === peer;
  }), 'sudoku ' + tag + ': row, column and box of the selected cell are highlighted');
  await padClick(wrongFor(a));
  mistakes += 1;
  st = await sudokuState();
  eq(st.board[a], wrongFor(a), 'sudoku ' + tag + ': a wrong number can be entered with the pad');
  eq(st.errors, mistakes, 'sudoku ' + tag + ': the wrong entry is counted');
  ok(!has(st.cells[a].cls, 'bad'), 'sudoku ' + tag + ': errors are hidden until the show-errors button is pressed');
  ok(st.cells.every((c) => has(c.cls, 'same') === (c.i !== a && st.board[c.i] === wrongFor(a))), 'sudoku ' + tag + ': equal numbers are highlighted');
  await padClick(wrongFor(a)); // same wrong number again: no second mistake
  st = await sudokuState();
  eq(st.errors, mistakes, 'sudoku ' + tag + ': entering the same number twice is not a second mistake');
  await clickBtn('.sudoku .actions', RE_ERRORS);
  st = await sudokuState();
  ok(/Nascondi/i.test(st.actions[0]), 'sudoku ' + tag + ': the errors button toggles its label ("' + st.actions[0] + '")');
  eq(st.cells.filter((c) => has(c.cls, 'bad')).map((c) => c.i), [a], 'sudoku ' + tag + ': show-errors marks exactly the wrong cell');
  if (levelKey === 'facile') {
    await shot('sudoku-errors-shown');
    // the selected wrong cell must still look selected
    const sameLook = await page.evaluate((i) => {
      const cell = document.querySelector('.sudoku-grid .cell[data-i="' + i + '"]');
      const look = () => { const cs = getComputedStyle(cell); return [cs.backgroundColor, cs.boxShadow, cs.outlineStyle, cs.outlineColor, cs.borderTopColor].join('|'); };
      const withSel = look();
      cell.classList.remove('sel');
      const without = look();
      cell.classList.add('sel');
      return withSel === without;
    }, a);
    ok(!sameLook, 'sudoku: with errors shown, a selected wrong cell still looks different from an unselected wrong cell');
  }
  await padClick(0);
  st = await sudokuState();
  eq(st.board[a], 0, 'sudoku ' + tag + ': the erase button clears the cell');
  eq(st.cells.filter((c) => has(c.cls, 'bad')).length, 0, 'sudoku ' + tag + ': no error mark after erasing');

  // --- wrong entry with the keyboard; Backspace, Delete and 0 erase
  const b = empties[1];
  await page.click(cellSel(b));
  for (const eraseKey of ['Backspace', 'Delete', '0']) {
    await page.keyboard.press(String(wrongFor(b)));
    mistakes += 1;
    st = await sudokuState();
    ok(st.board[b] === wrongFor(b) && has(st.cells[b].cls, 'bad'), 'sudoku ' + tag + ': wrong keyboard entry is shown and marked (errors visible)');
    await page.keyboard.press(eraseKey);
    st = await sudokuState();
    eq(st.board[b], 0, 'sudoku ' + tag + ': key ' + eraseKey + ' erases the cell');
  }
  eq(st.errors, mistakes, 'sudoku ' + tag + ': mistake counter after keyboard errors');
  await clickBtn('.sudoku .actions', RE_ERRORS);
  ok(/Mostra/i.test((await sudokuState()).actions[0]), 'sudoku ' + tag + ': errors can be hidden again');

  // --- hint: fixes the selected wrong cell; with a correct cell selected it fills another one
  await page.keyboard.press(String(wrongFor(b)));
  mistakes += 1;
  await clickBtn('.sudoku .actions', RE_HINT);
  hints += 1;
  st = await sudokuState();
  eq(st.board[b], sol[b], 'sudoku ' + tag + ': the hint corrects the selected wrong cell');
  eq(st.hints, hints, 'sudoku ' + tag + ': hint counter');
  eq(selectedCell(st), b, 'sudoku ' + tag + ': the hinted cell stays selected');
  const before = st.board.slice();
  await clickBtn('.sudoku .actions', RE_HINT); // selected cell is right now: a random empty cell is filled
  hints += 1;
  st = await sudokuState();
  const changed = [];
  st.board.forEach((v, i) => { if (v !== before[i]) changed.push(i); });
  ok(changed.length === 1 && st.board[changed[0]] === sol[changed[0]] && !st.givens[changed[0]], 'sudoku ' + tag + ': the hint fills exactly one more cell with the right number');
  eq(selectedCell(st), changed[0], 'sudoku ' + tag + ': the hint selects the cell it filled');
  eq([st.errors, st.hints], [mistakes, hints], 'sudoku ' + tag + ': counters after hints');
  checkSudokuDom(st, tag + ' after hints');

  // --- arrow keys: clamp at the edges
  await page.click(cellSel(0));
  await page.keyboard.press('ArrowUp');
  await page.keyboard.press('ArrowLeft');
  eq(selectedCell(await sudokuState()), 0, 'sudoku ' + tag + ': arrows stop at the top-left corner');
  await page.click(cellSel(80));
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowRight');
  eq(selectedCell(await sudokuState()), 80, 'sudoku ' + tag + ': arrows stop at the bottom-right corner');

  // --- fill the rest: mouse pad, click + keyboard, arrows + keyboard
  st = await sudokuState();
  const todo = [];
  for (let i = 0; i < 81; i++) if (st.board[i] !== sol[i]) todo.push(i);
  let cur = 80;
  let n = 0;
  for (const i of todo) {
    n += 1;
    const last = n === todo.length;
    const mode = n % 3;
    if (mode === 0) {
      await page.click(cellSel(i));
      await padClick(sol[i]);
    } else if (mode === 1) {
      await page.click(cellSel(i));
      await page.keyboard.press(String(sol[i]));
    } else {
      let r = Math.floor(cur / 9); let c = cur % 9;
      const tr = Math.floor(i / 9); const tc = i % 9;
      while (r !== tr) { await page.keyboard.press(r < tr ? 'ArrowDown' : 'ArrowUp'); r += r < tr ? 1 : -1; }
      while (c !== tc) { await page.keyboard.press(c < tc ? 'ArrowRight' : 'ArrowLeft'); c += c < tc ? 1 : -1; }
      if (n % 6 === 2) eq(selectedCell(await sudokuState()), i, 'sudoku ' + tag + ': arrow keys move the selection to the wanted cell');
      await page.keyboard.press(String(sol[i]));
    }
    cur = i;
    if (last || n % 7 === 0) {
      st = await sudokuState();
      eq(st.board[i], sol[i], 'sudoku ' + tag + ': cell ' + i + ' holds the entered number');
      if (!last) ok(!st.won, 'sudoku ' + tag + ': not won before the last cell');
    }
  }
  st = await sudokuState();
  const sfxEnd = await sounds();
  eq([sfxEnd.win - sfxStart.win, sfxEnd.bad - sfxStart.bad], [1, mistakes], 'sudoku ' + tag + ': the win sound plays once, the error sound once per wrong entry');
  ok(st.won, 'sudoku ' + tag + ': solved, debug.won is true');
  eq(st.board, sol, 'sudoku ' + tag + ': final board equals the solution');
  ok(/^Bravo! Sudoku completato in \d+:\d\d/.test(st.msg), 'sudoku ' + tag + ': win message shown ("' + st.msg + '")');
  ok(st.pad.slice(0, 9).every((p) => p.done), 'sudoku ' + tag + ': all pad numbers are greyed out when solved');
  eq([st.errors, st.hints], [mistakes, hints], 'sudoku ' + tag + ': counters at the end');
  checkSudokuDom(st, tag + ' solved');
  await shot('sudoku-won-' + levelKey);
  // after the win nothing can be changed
  await page.click(cellSel(empties[2]));
  await page.keyboard.press(String(wrongFor(empties[2])));
  await padClick(wrongFor(empties[2]));
  await padClick(0);
  await clickBtn('.sudoku .actions', RE_HINT);
  const st2 = await sudokuState();
  ok(st2.won && JSON.stringify(st2.board) === JSON.stringify(sol) && selectedCell(st2) === -1, 'sudoku ' + tag + ': a solved grid cannot be changed');
  eq([st2.errors, st2.hints], [mistakes, hints], 'sudoku ' + tag + ': counters frozen after the win');
  if (levelKey === 'facile') {
    await sleep(1150);
    const st3 = await sudokuState();
    eq(st3.clock, st.clock, 'sudoku: the clock stops after the win');
    ok(st3.msg === st.msg, 'sudoku: the win message keeps the same time');
  }
  stats.solved += 1;
}

async function testSudoku() {
  console.log('SUDOKU');
  const stats = { solved: 0, givens: {}, grades: {} };
  await openFromMenu('Sudoku', '.sudoku-grid .cell');
  stats.overflow = await checkFits('sudoku');
  await shot('sudoku-start');
  // the number pad: nine keys and the erase key, all inside the window and not on top of the grid
  const padBox = await page.evaluate(() => {
    const g = document.querySelector('.sudoku-grid').getBoundingClientRect();
    const keys = Array.from(document.querySelectorAll('.pad .btn.num')).map((b) => { const r = b.getBoundingClientRect(); return { l: r.left, r: r.right, t: r.top, b: r.bottom, w: r.width, h: r.height, clipped: b.scrollWidth > b.clientWidth + 1 || b.scrollHeight > b.clientHeight + 1 }; });
    return { grid: { l: g.left, r: g.right, t: g.top, b: g.bottom }, keys: keys, vw: window.innerWidth, vh: window.innerHeight };
  });
  ok(padBox.keys.length === 10 && padBox.keys.every((k) => k.l >= 0 && k.r <= padBox.vw && k.t >= 0 && k.b <= padBox.vh), 'sudoku: all ten pad keys are inside the window');
  ok(padBox.keys.every((k) => k.r <= padBox.grid.l || k.l >= padBox.grid.r || k.b <= padBox.grid.t || k.t >= padBox.grid.b), 'sudoku: the pad does not overlap the grid');
  ok(padBox.keys.every((k) => !k.clipped), 'sudoku: no pad key has clipped text');
  ok(padBox.keys.slice(0, 9).every((k) => k.w >= 44 && k.h >= 44), 'sudoku: number keys are at least 44 px (smallest ' + Math.round(Math.min.apply(null, padBox.keys.slice(0, 9).map((k) => Math.min(k.w, k.h)))) + ' px)');
  stats.key = Math.round(padBox.keys[0].w) + ' x ' + Math.round(padBox.keys[0].h);
  // clock runs
  await page.waitForFunction(() => document.querySelector('.sudoku .clock').textContent === '0:01', null, { timeout: 3000 }).then(() => ok(true, 'clock'), () => ok(false, 'sudoku: the clock reaches 0:01 after one second'));
  // keyboard with nothing selected: digits do nothing, an arrow selects the centre cell
  let st = await sudokuState();
  await page.keyboard.press('5');
  await page.keyboard.press('Backspace');
  eq((await sudokuState()).board, st.board, 'sudoku: a digit with no cell selected does nothing');
  await page.keyboard.press('ArrowRight');
  eq(selectedCell(await sudokuState()), 41, 'sudoku: first arrow key starts from the centre cell (40) and moves');

  await sudokuLevel('facile', 'Facile', 42, stats);
  await sudokuLevel('medio', 'Medio', 32, stats);
  await sudokuLevel('difficile', 'Difficile', 27, stats);

  // "Nuovo sudoku" after a win gives a fresh puzzle of the same level
  const prev = await sudokuState();
  await clickBtn('.sudoku .actions', RE_NEW_SUDOKU);
  st = await sudokuState();
  ok(!st.won && st.level === 'difficile' && JSON.stringify(st.puzzle) !== JSON.stringify(prev.puzzle), 'sudoku: "Nuovo sudoku" starts a new puzzle on the same level');
  eq([st.errors, st.hints], [0, 0], 'sudoku: counters reset by "Nuovo sudoku"');
  // level switch in the middle of a game
  const e = st.givens.indexOf(false);
  await page.click(cellSel(e));
  await page.keyboard.press(String((st.solution[e] % 9) + 1));
  await clickBtn('.sudoku .actions', RE_ERRORS);
  await clickBtn('.sudoku .levels', /^\s*Medio/);
  st = await sudokuState();
  ok(st.level === 'medio' && JSON.stringify(st.board) === JSON.stringify(st.puzzle) && st.givens.filter(Boolean).length === 32, 'sudoku: switching level mid-game starts a clean medio puzzle');
  ok(st.errors === 0 && st.hints === 0 && /Mostra/i.test(st.actions[0]) && selectedCell(st) === -1, 'sudoku: counters, error display and selection reset on level switch');
  // level is remembered after leaving with Esc
  await page.keyboard.press('Escape');
  await waitMenu();
  ok((await page.locator('#home').isHidden()), 'app: the Menu button is hidden on the menu');
  await page.keyboard.press('7'); // a stale key handler would throw here
  await page.keyboard.press('ArrowLeft');
  await openFromMenu('Sudoku', '.sudoku-grid .cell');
  eq((await sudokuState()).level, 'medio', 'sudoku: the level is remembered after going back to the menu');
  await page.click('#home');
  await waitMenu();
  console.log('  solved ' + stats.solved + ' puzzles; givens ' + JSON.stringify(stats.givens) + '; grades ' + JSON.stringify(stats.grades) + '; pad key ' + stats.key + ' px');
  return stats;
}

// =====================================================================================
// MAHJONG
// =====================================================================================
// Tiles are { id, x, y, l, type, face }. x and y are in half tiles: a tile covers x..x+2 and y..y+2.
// Kind and picture of every tile seen so far, by id (kept for tiles that were removed).
const mjKinds = {};
const mjState = async () => {
  const st = await mjRead();
  st.tiles.forEach((t) => { mjKinds[t.id] = { type: t.type, face: t.face }; });
  return st;
};
const mjRead = () => page.evaluate(() => {
  const d = window.RA.current.debug;
  const q = (s) => Array.from(document.querySelectorAll(s));
  const ov = document.querySelector('.mahjong .overlay');
  const text = document.querySelector('.mahjong').textContent;
  const num = (re) => { const m = text.match(re); return m ? Number(m[1]) : null; };
  return {
    tiles: d.tiles.map((t) => ({ id: t.id, x: t.x, y: t.y, l: t.l, type: t.type, face: t.face == null ? null : t.face })),
    won: d.won, stuck: d.stuck, freeIds: d.freeIds().slice().sort((a, b) => a - b),
    pair: (function () { const p = d.findPair(); return p ? [p[0].id, p[1].id] : null; })(),
    dom: q('.mj-board .mj-tile').map((e) => ({ id: Number(e.dataset.id), cls: e.className.split(' '), html: e.innerHTML })),
    pairsLeft: num(/Coppie rimaste\s*:?\s*(\d+)/), score: num(/Punti\s*:?\s*(-?\d+)/),
    msg: document.querySelector('.mahjong .msg').textContent,
    overlay: ov ? { h2: ov.querySelector('h2').textContent, p: ov.querySelector('p').textContent } : null,
    pulse: q('.mahjong .actions .btn.pulse').map((b) => b.textContent.trim()),
  };
});
// Independent rule. A tile is free when no tile of the next layer lies on any part of it,
// and it has no neighbour on its left or no neighbour on its right (same layer, touching rows).
function mjLinks(tiles) {
  const n = tiles.length;
  const cover = []; const left = []; const right = [];
  for (let i = 0; i < n; i++) {
    cover.push([]); left.push([]); right.push([]);
    const t = tiles[i];
    for (let j = 0; j < n; j++) {
      if (i === j) continue;
      const o = tiles[j];
      if (o.l === t.l + 1 && Math.abs(o.x - t.x) < 2 && Math.abs(o.y - t.y) < 2) cover[i].push(j);
      if (o.l === t.l && Math.abs(o.y - t.y) < 2) {
        if (o.x === t.x - 2) left[i].push(j);
        if (o.x === t.x + 2) right[i].push(j);
      }
    }
  }
  return { cover: cover, left: left, right: right };
}
function mjFreeIdx(links, present) {
  const out = [];
  const here = (j) => present[j];
  for (let i = 0; i < present.length; i++) {
    if (!present[i] || links.cover[i].some(here)) continue;
    if (links.left[i].some(here) && links.right[i].some(here)) continue;
    out.push(i);
  }
  return out;
}
function mjFree(tiles) {
  const links = mjLinks(tiles);
  return mjFreeIdx(links, tiles.map(() => true)).map((i) => tiles[i]);
}
function mjHasPair(tiles) {
  const seen = {};
  return mjFree(tiles).some((t) => { if (seen[t.type]) return true; seen[t.type] = true; return false; });
}
// Random playouts on a copy of the deal.
// want: 'clear' (all tiles go), 'stuck' (tiles left, no free pair),
//       'dead' (only two tiles left and one lies on the other: the same kind, never free together).
function mjPlan(tiles, want, tries) {
  const links = mjLinks(tiles);
  const n = tiles.length;
  // for 'dead': candidates are an upper tile and the tile under it, of the same kind
  const stacks = [];
  if (want === 'dead') {
    for (let i = 0; i < n; i++) links.cover[i].forEach((j) => { if (tiles[i].type === tiles[j].type) stacks.push([j, i]); });
    if (!stacks.length) return null;
  }
  for (let k = 0; k < tries; k++) {
    const present = tiles.map(() => true);
    const keep = want === 'dead' ? stacks[k % stacks.length] : null;
    let left = n;
    const seq = [];
    for (;;) {
      const free = mjFreeIdx(links, present);
      const pairs = [];
      for (let a = 0; a < free.length; a++) {
        for (let b = a + 1; b < free.length; b++) {
          if (tiles[free[a]].type !== tiles[free[b]].type) continue;
          if (keep && (free[a] === keep[0] || free[b] === keep[0])) continue;
          pairs.push([free[a], free[b]]);
        }
      }
      if (!pairs.length) break;
      const p = pickOne(pairs);
      present[p[0]] = false; present[p[1]] = false;
      left -= 2;
      seq.push([tiles[p[0]].id, tiles[p[1]].id]);
    }
    if (want === 'clear' && left === 0) return seq;
    if (want === 'stuck' && left > 0) return seq;
    if (want === 'dead' && left === 2) return seq;
  }
  return null;
}
// The matching group that belongs to a picture: 34 groups of four equal tiles, the flowers, the seasons.
function mjGroupOfFace(face) {
  const kind = face.charAt(0); const n = Number(face.slice(1));
  if (kind === 'd') return n - 1;
  if (kind === 'b') return 8 + n;
  if (kind === 'c') return 17 + n;
  if (kind === 'w') return 27 + n;
  if (kind === 'g') return 31 + n;
  return kind === 'f' ? 34 : kind === 's' ? 35 : -1;
}
function mjCheck(st, label, expectScore) {
  eq(sortNum(st.dom.map((d) => d.id)), sortNum(st.tiles.map((t) => t.id)), 'mahjong ' + label + ': tiles on screen = tiles in debug');
  const free = sortNum(mjFree(st.tiles).map((t) => t.id));
  eq(st.freeIds, free, 'mahjong ' + label + ': debug.freeIds follows the free rule');
  const freeSet = new Set(free);
  const byId = {};
  st.tiles.forEach((t) => { byId[t.id] = t; });
  ok(st.dom.every((d) => has(d.cls, 'free') === freeSet.has(d.id) && has(d.cls, 'blocked') === !freeSet.has(d.id)), 'mahjong ' + label + ': free/blocked classes follow the free rule');
  // equal faces are drawn the same, different faces are drawn differently
  const pictureOfFace = {}; const faceOfPicture = {};
  let drawn = true;
  st.dom.forEach((d) => {
    const face = byId[d.id].face == null ? 'type' + byId[d.id].type : byId[d.id].face;
    if (!d.html) drawn = false;
    if (pictureOfFace[face] == null) pictureOfFace[face] = d.html; else if (pictureOfFace[face] !== d.html) drawn = false;
    if (faceOfPicture[d.html] == null) faceOfPicture[d.html] = face; else if (faceOfPicture[d.html] !== face) drawn = false;
  });
  ok(drawn, 'mahjong ' + label + ': equal tiles show the same picture and different tiles show different pictures');
  if (st.tiles.length && st.tiles[0].face != null) ok(st.tiles.every((t) => mjGroupOfFace(t.face) === t.type), 'mahjong ' + label + ': the matching group of every tile fits its picture');
  eq(st.pairsLeft, st.tiles.length / 2, 'mahjong ' + label + ': pairs counter');
  if (expectScore != null) eq(st.score, expectScore, 'mahjong ' + label + ': score');
  const counts = {};
  st.tiles.forEach((t) => { counts[t.type] = (counts[t.type] || 0) + 1; });
  ok(Object.keys(counts).every((k) => counts[k] % 2 === 0), 'mahjong ' + label + ': every kind is present an even number of times');
  eq(!!st.pair, mjHasPair(st.tiles), 'mahjong ' + label + ': debug.findPair agrees that a free pair exists/does not exist');
  if (st.tiles.length && !st.won) eq(st.stuck, !mjHasPair(st.tiles), 'mahjong ' + label + ': debug.stuck');
}
const tileSel = (id) => '.mj-board .mj-tile[data-id="' + id + '"]';
const clickTile = (id) => page.click(tileSel(id), { timeout: 4000 });
const mjSelected = (st) => st.dom.filter((d) => has(d.cls, 'sel')).map((d) => d.id);
const mjHinted = (st) => sortNum(st.dom.filter((d) => has(d.cls, 'hint')).map((d) => d.id));
const RE_MJ_HINT = /Suggerimento/i;
const RE_MJ_UNDO = /Annulla/i;
const RE_MJ_SHUFFLE = /Mescola/i;
const RE_MJ_NEW = /Nuova partita/i;
const RE_MJ_DEAD = /non si possono più liberare/i;

async function mjFreshDealChecks(label) {
  const st = await mjState();
  eq(st.tiles.length, 144, 'mahjong ' + label + ': 144 tiles dealt');
  const counts = new Array(36).fill(0);
  st.tiles.forEach((t) => { counts[t.type] += 1; });
  ok(counts.every((c) => c === 4), 'mahjong ' + label + ': 36 matching groups of 4 tiles');
  eq(new Set(st.tiles.map((t) => t.x + ',' + t.y + ',' + t.l)).size, 144, 'mahjong ' + label + ': no two tiles in the same place');
  // every tile above the table lies fully on tiles of the layer below
  ok(st.tiles.every((t) => t.l === 0 || [[0, 0], [1, 0], [0, 1], [1, 1]].every((q) => st.tiles.some((o) => o.l === t.l - 1 && t.x + q[0] >= o.x && t.x + q[0] < o.x + 2 && t.y + q[1] >= o.y && t.y + q[1] < o.y + 2))), 'mahjong ' + label + ': every upper tile is carried by the layer below');
  mjCheck(st, label, 0);
  ok(!st.won && !st.stuck && !st.overlay, 'mahjong ' + label + ': fresh deal is neither won nor stuck');
  ok(mjPlan(st.tiles, 'clear', 3000) !== null, 'mahjong ' + label + ': the deal can be cleared (independent search)');
  // What the mouse really hits: the centre of a tile with nothing on it is the tile itself,
  // the centre of a tile under a tile in the very same place is the upper tile.
  const hit = await page.evaluate(() => Array.from(document.querySelectorAll('.mj-board .mj-tile')).map((e) => {
    const r = e.getBoundingClientRect();
    const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    const tile = top && top.closest('.mj-tile');
    return { id: Number(e.dataset.id), hit: tile ? Number(tile.dataset.id) : -1, w: r.width, h: r.height, left: r.left, right: r.right, top: r.top, bottom: r.bottom };
  }));
  const links = mjLinks(st.tiles);
  const index = {};
  st.tiles.forEach((t, i) => { index[t.id] = i; });
  const view = page.viewportSize();
  ok(hit.every((h) => {
    if (h.bottom > view.height) return true; // below the window: checked separately
    const i = index[h.id];
    if (!links.cover[i].length) return h.hit === h.id;
    const t = st.tiles[i];
    if (links.cover[i].some((j) => st.tiles[j].x === t.x && st.tiles[j].y === t.y)) return h.hit !== h.id && h.hit >= 0;
    return true;
  }), 'mahjong ' + label + ': a click on the centre of a tile reaches that tile, or the tile lying on it');
  ok(hit.every((h) => h.left >= 0 && h.right <= view.width && h.top >= 0), 'mahjong ' + label + ': no tile is cut off at the left, right or top edge');
  ok(hit.every((h) => h.bottom <= view.height), 'mahjong ' + label + ': no tile is below the bottom edge of the window');
  return { st: st, tileW: Math.round(hit[0].w), tileH: Math.round(hit[0].h) };
}

// expect = { score, stack }: the score the page must show and the pairs removed so far (newest last).
async function mjPlayPair(pair, expect) {
  await clickTile(pair[0]);
  await clickTile(pair[1]);
  expect.score += 10;
  expect.stack.push(pair);
}
// "Annulla mossa": puts the last removed pair back and takes 10 points away (never below zero).
async function mjUndo(expect) {
  await clickBtn('.mahjong .actions', RE_MJ_UNDO);
  const pair = expect.stack.pop();
  if (pair) expect.score = Math.max(0, expect.score - 10);
  return pair || null;
}
function mjReset(expect) {
  expect.score = 0;
  expect.stack = [];
}

async function mjWinChecks(expect, label) {
  const st = await mjState();
  const sfxNow = await sounds();
  eq(sfxNow.win - (expect.winSounds || 0), 1, 'mahjong ' + label + ': the win sound plays once');
  expect.winSounds = sfxNow.win;
  ok(st.won && st.tiles.length === 0, 'mahjong ' + label + ': all tiles removed, debug.won');
  ok(st.overlay && /Tavolo pulito/.test(st.overlay.h2), 'mahjong ' + label + ': win overlay is shown');
  ok(st.overlay && new RegExp('Punti: ' + expect.score + '\\b.*Tempo: \\d+:\\d\\d').test(st.overlay.p), 'mahjong ' + label + ': overlay shows score ' + expect.score + ' and the time ("' + (st.overlay && st.overlay.p) + '")');
  eq(st.pairsLeft, 0, 'mahjong ' + label + ': zero pairs left');
  await shot('mahjong-won-' + label.replace(/\W+/g, '-'));
  // the overlay covers the buttons under it
  const blockedByOverlay = await page.evaluate(() => {
    const b = Array.from(document.querySelectorAll('.mahjong .actions .btn')).find((x) => x.textContent.indexOf('Annulla') >= 0);
    const r = b.getBoundingClientRect();
    const top = document.elementFromPoint(r.left + r.width / 2, Math.min(r.top + r.height / 2, window.innerHeight - 2));
    return !!(top && top.closest('.overlay'));
  });
  ok(blockedByOverlay, 'mahjong ' + label + ': the win overlay covers the action buttons');
  await page.click('.mahjong .overlay .btn.big');
  mjReset(expect);
  const fresh = await mjState();
  ok(fresh.tiles.length === 144 && !fresh.won && !fresh.overlay && fresh.score === 0, 'mahjong ' + label + ': "Nuova partita" in the overlay deals a new game');
}

// Presses Mescola and checks everything it promises. Returns the number of pairs it put back
// (0 = plain shuffle; more when the tiles left could not be cleared, e.g. two tiles one on the other).
async function mjShuffle(expect, label, stats) {
  const before = await mjState();
  const kindsBefore = Object.assign({}, mjKinds);
  await clickBtn('.mahjong .actions', RE_MJ_SHUFFLE);
  stats.shuffles += 1;
  const st = await mjState();
  ok(!RE_MJ_DEAD.test(st.msg), 'mahjong ' + label + ': Mescola never ends the game with "non si possono più liberare"');
  const m = st.msg.match(/rimesso (\d+) coppi([ae])\b/);
  const undone = m ? Number(m[1]) : 0;
  if (m) {
    stats.rescues += 1;
    ok(undone >= 1 && (undone === 1) === (m[2] === 'a'), 'mahjong ' + label + ': the message counts the pairs put back, with the right singular/plural ("' + st.msg + '")');
  } else {
    ok(/mescolate/i.test(st.msg), 'mahjong ' + label + ': Mescola message ("' + st.msg + '")');
  }
  const back = [];
  for (let k = 0; k < undone; k++) {
    const pair = expect.stack.pop();
    if (pair) back.push(pair[0], pair[1]);
    expect.score = Math.max(0, expect.score - 10);
  }
  eq(sortNum(st.tiles.map((t) => t.id)), sortNum(before.tiles.map((t) => t.id).concat(back)), 'mahjong ' + label + ': Mescola keeps all tiles' + (undone ? ' and puts back exactly the last ' + undone + ' removed pair(s)' : ''));
  const now = {};
  st.tiles.forEach((t) => { now[t.id] = t; });
  ok(before.tiles.every((t) => now[t.id] && now[t.id].x === t.x && now[t.id].y === t.y && now[t.id].l === t.l), 'mahjong ' + label + ': Mescola keeps every tile in its place');
  eq(sortNum(st.tiles.map((t) => t.type)), sortNum(st.tiles.map((t) => kindsBefore[t.id].type)), 'mahjong ' + label + ': Mescola keeps the same kinds');
  eq(st.tiles.map((t) => String(t.face)).sort(), st.tiles.map((t) => String(kindsBefore[t.id].face)).sort(), 'mahjong ' + label + ': Mescola keeps the same pictures');
  ok(!!st.pair && !st.stuck && st.pulse.length === 0, 'mahjong ' + label + ': after Mescola a free pair exists and the button stops pulsing');
  ok(mjPlan(st.tiles, 'clear', 3000) !== null, 'mahjong ' + label + ': after Mescola the board can be cleared (independent search)');
  mjCheck(st, label + ' after Mescola', expect.score);
  return undone;
}

// Plays the current position to the end. picker: 'greedy' (debug.findPair) or 'hint' (Suggerimento button).
// Returns 'cleared', or 'error' when a check failed in a way that stops the game.
async function mjFinish(picker, expect, label, stats) {
  for (let guard = 0; guard < 500; guard++) {
    const st = await mjState();
    if (st.won) return 'cleared';
    if (!st.pair) {
      ok(st.stuck, 'mahjong ' + label + ': no free pair means stuck');
      stats.stuckSeen += 1;
      await mjShuffle(expect, label, stats);
      if (!(await mjState()).pair) return 'error';
      continue;
    }
    if (picker === 'hint') {
      await clickBtn('.mahjong .actions', RE_MJ_HINT);
      expect.score = Math.max(0, expect.score - 5);
      const hs = await mjState();
      const h = mjHinted(hs);
      if (!ok(h.length === 2, 'mahjong ' + label + ': Suggerimento marks two tiles')) return 'error';
      await mjPlayPair(h, expect);
    } else {
      await mjPlayPair(st.pair, expect);
    }
    if (guard % 12 === 0) mjCheck(await mjState(), label + ' move ' + guard, expect.score);
  }
  ok(false, 'mahjong ' + label + ': game did not end');
  return 'error';
}

async function testMahjong() {
  console.log('MAHJONG');
  const stats = { cleared: 0, rescues: 0, stuckSeen: 0, shuffles: 0, games: 0, deadReplayed: false };
  const expect = { score: 0, stack: [] };
  await openFromMenu('Mahjong', '.mj-board .mj-tile');
  stats.overflow = await checkFits('mahjong');
  // sound off and on again while the ambient music is wanted
  const muteBefore = await page.locator('#mute').textContent();
  await page.click('#mute');
  const muteOff = await page.locator('#mute').textContent();
  ok(muteOff !== muteBefore && (await page.evaluate(() => window.RA.audio.isMuted())) === true, 'app: the sound button switches the sound off and changes its label ("' + muteBefore + '" -> "' + muteOff + '")');
  await page.click('#mute');
  ok((await page.locator('#mute').textContent()) === muteBefore && (await page.evaluate(() => window.RA.audio.isMuted())) === false, 'app: the sound button switches back');
  // the four buttons are inside the window and not on top of the tiles
  const bar = await page.evaluate(() => {
    const board = Array.from(document.querySelectorAll('.mj-board .mj-tile')).map((e) => e.getBoundingClientRect());
    const top = Math.min.apply(null, board.map((r) => r.top));
    return Array.from(document.querySelectorAll('.mahjong .actions button')).map((b) => { const r = b.getBoundingClientRect(); return { t: b.textContent.trim(), inside: r.left >= 0 && r.right <= window.innerWidth && r.top >= 0 && r.bottom <= window.innerHeight, clear: r.bottom <= top }; });
  });
  ok(bar.length === 4 && bar.every((b) => b.inside && b.clear), 'mahjong: Suggerimento, Annulla, Mescola and Nuova partita are visible and do not cover the tiles (' + bar.map((b) => b.t).join(', ') + ')');

  // ---------- game 1: planned clear with side trips ----------
  let info = await mjFreshDealChecks('game 1');
  let st = info.st;
  stats.tile = info.tileW + ' x ' + info.tileH;
  stats.games += 1;
  await shot('mahjong-start');
  const plan = mjPlan(st.tiles, 'clear', 6000);
  if (plan) {
    const byId = {};
    st.tiles.forEach((t) => { byId[t.id] = t; });
    // a blocked tile with nothing on it (both sides taken): message, nothing selected
    const links = mjLinks(st.tiles);
    const freeSet = new Set(st.freeIds);
    const blockedOpen = st.tiles.filter((t, i) => !freeSet.has(t.id) && !links.cover[i].length);
    const bt = pickOne(blockedOpen);
    await clickTile(bt.id);
    let s2 = await mjState();
    ok(/bloccata/i.test(s2.msg) && mjSelected(s2).length === 0 && s2.tiles.length === 144, 'mahjong: clicking a blocked tile only shows the "bloccata" message');
    await shot('mahjong-blocked-message');
    // select, then click a different kind: selection moves
    const frees = st.tiles.filter((t) => freeSet.has(t.id));
    const fa = frees[0];
    const fb = frees.find((t) => t.type !== fa.type);
    await clickTile(fa.id);
    s2 = await mjState();
    eq(mjSelected(s2), [fa.id], 'mahjong: a free tile gets selected');
    ok(!/bloccata/i.test(s2.msg), 'mahjong: the blocked message is cleared by the next valid click');
    await clickTile(bt.id); // blocked tile while one is selected: selection stays
    s2 = await mjState();
    eq(mjSelected(s2), [fa.id], 'mahjong: clicking a blocked tile keeps the current selection');
    await clickTile(fb.id);
    s2 = await mjState();
    ok(mjSelected(s2).length === 1 && mjSelected(s2)[0] === fb.id && s2.tiles.length === 144, 'mahjong: two different free tiles are not removed, the second becomes the selection');
    await shot('mahjong-selected');
    await clickTile(fb.id);
    eq(mjSelected(await mjState()), [], 'mahjong: clicking the selected tile again deselects it');
    // undo with nothing to undo
    await mjUndo(expect);
    s2 = await mjState();
    ok(s2.tiles.length === 144 && s2.score === 0, 'mahjong: Annulla with no moves does nothing');
    // hint
    await clickBtn('.mahjong .actions', RE_MJ_HINT);
    s2 = await mjState();
    const h = mjHinted(s2);
    ok(h.length === 2 && byId[h[0]].type === byId[h[1]].type && freeSet.has(h[0]) && freeSet.has(h[1]), 'mahjong: Suggerimento marks two matching free tiles');
    ok(s2.msg.length > 0 && !/Tocca due tessere/.test(s2.msg), 'mahjong: Suggerimento shows its own message ("' + s2.msg + '")');
    eq(s2.score, 0, 'mahjong: the score never goes below zero');
    await shot('mahjong-hint');

    let k = 0;
    for (const pair of plan) {
      await mjPlayPair(pair, expect);
      k += 1;
      if (k === 1) {
        s2 = await mjState();
        ok(s2.tiles.length === 142 && mjHinted(s2).length === 0 && mjSelected(s2).length === 0, 'mahjong: a matching pair is removed and the hint marks go away');
        mjCheck(s2, 'game 1 first pair', expect.score);
      }
      if (k === 4) {
        await clickBtn('.mahjong .actions', RE_MJ_HINT);
        expect.score -= 5;
        eq((await mjState()).score, expect.score, 'mahjong: a hint costs 5 points');
      }
      if (k === 6) {
        // undo two moves, then play them again
        const beforeUndo = await mjState();
        await mjUndo(expect);
        s2 = await mjState();
        ok(s2.tiles.length === beforeUndo.tiles.length + 2 && s2.tiles.some((t) => t.id === pair[0]) && s2.tiles.some((t) => t.id === pair[1]), 'mahjong: Annulla puts the last pair back');
        ok(/annullata/i.test(s2.msg) || s2.stuck, 'mahjong: undo message ("' + s2.msg + '")');
        mjCheck(s2, 'game 1 after undo', expect.score);
        await mjUndo(expect);
        s2 = await mjState();
        eq(s2.tiles.length, beforeUndo.tiles.length + 4, 'mahjong: a second Annulla puts back the pair before');
        mjCheck(s2, 'game 1 after second undo', expect.score);
        await mjPlayPair(plan[4], expect);
        await mjPlayPair(plan[5], expect);
        eq((await mjState()).tiles.length, beforeUndo.tiles.length, 'mahjong: the undone pairs can be removed again');
      }
      if (k === 30) await shot('mahjong-midgame');
      if (k % 15 === 0 && k < 72) mjCheck(await mjState(), 'game 1 pair ' + k, expect.score);
    }
    await mjWinChecks(expect, 'game 1');
    stats.cleared += 1;
  } else {
    ok(false, 'mahjong game 1: no clearing plan found');
  }

  // ---------- game 2: reach the stuck state, undo out of it, Mescola, undo after Mescola, finish ----------
  info = await mjFreshDealChecks('game 2');
  st = info.st;
  stats.games += 1;
  mjReset(expect);
  const toStuck = mjPlan(st.tiles, 'stuck', 400);
  if (ok(toStuck !== null, 'mahjong game 2: a way into a stuck position was found')) {
    for (const pair of toStuck) await mjPlayPair(pair, expect);
    const s2 = await mjState();
    ok(s2.stuck && !s2.pair && s2.tiles.length > 0, 'mahjong: stuck state reached');
    ok(/Non ci sono più coppie/i.test(s2.msg) && RE_MJ_SHUFFLE.test(s2.msg) && RE_MJ_UNDO.test(s2.msg), 'mahjong: stuck message names Mescola and Annulla ("' + s2.msg + '")');
    ok(s2.pulse.length === 1 && RE_MJ_SHUFFLE.test(s2.pulse[0]), 'mahjong: the Mescola button pulses when stuck');
    mjCheck(s2, 'game 2 stuck', expect.score);
    await shot('mahjong-stuck');
    stats.stuckSeen += 1;
    await clickBtn('.mahjong .actions', RE_MJ_HINT); // no pair to show
    let s3 = await mjState();
    ok(s3.stuck && mjHinted(s3).length === 0 && s3.score === expect.score, 'mahjong: Suggerimento in a stuck position marks nothing and costs nothing');
    const lastPair = await mjUndo(expect);
    s3 = await mjState();
    ok(!s3.stuck && s3.tiles.length === s2.tiles.length + 2 && s3.pulse.length === 0, 'mahjong: Annulla leaves the stuck state');
    await mjPlayPair(lastPair, expect);
    ok((await mjState()).stuck, 'mahjong: playing the same pair again is stuck again');
    // Mescola, then Annulla: the undo history survives the shuffle
    const undone = await mjShuffle(expect, 'game 2', stats);
    const afterShuffle = await mjState();
    const wanted = expect.stack.length ? expect.stack[expect.stack.length - 1] : null;
    const backPair = await mjUndo(expect);
    s3 = await mjState();
    if (wanted) {
      ok(s3.tiles.length === afterShuffle.tiles.length + 2 && s3.tiles.some((t) => t.id === wanted[0]) && s3.tiles.some((t) => t.id === wanted[1]), 'mahjong: Annulla after Mescola puts back the pair removed before the shuffle (Mescola had put back ' + undone + ')');
      ok(!!s3.pair && !s3.stuck, 'mahjong: after Mescola + Annulla a free pair exists');
      ok(mjPlan(s3.tiles, 'clear', 3000) !== null, 'mahjong: after Mescola + Annulla the board can still be cleared (independent search)');
      mjCheck(s3, 'game 2 after Mescola + Annulla', expect.score);
    }
    ok(backPair === wanted, 'mahjong: test bookkeeping of the undo history');
  }
  if ((await mjFinish('greedy', expect, 'game 2', stats)) === 'cleared') {
    await mjWinChecks(expect, 'game 2');
    stats.cleared += 1;
  }

  // ---------- game 3: only the Suggerimento button decides the moves ----------
  info = await mjFreshDealChecks('game 3');
  stats.games += 1;
  mjReset(expect);
  {
    // Mescola on a fresh deal after one pair, and Annulla after it
    await mjPlayPair(info.st.pair, expect);
    const undone = await mjShuffle(expect, 'game 3 early', stats);
    eq(undone, 0, 'mahjong: Mescola in a position that is not stuck puts nothing back');
    eq((await mjState()).tiles.length, 142, 'mahjong: Mescola does not add or remove tiles');
    await mjUndo(expect);
    const s2 = await mjState();
    eq([s2.tiles.length, s2.score], [144, 0], 'mahjong: Annulla after an early Mescola brings the first pair back and takes its 10 points away');
    mjCheck(s2, 'game 3 after early Mescola + Annulla', expect.score);
    ok(mjPlan(s2.tiles, 'clear', 3000) !== null, 'mahjong: that board can still be cleared (independent search)');
  }
  if ((await mjFinish('hint', expect, 'game 3', stats)) === 'cleared') {
    await mjWinChecks(expect, 'game 3');
    stats.cleared += 1;
  }
  ok(stats.cleared >= 3, 'mahjong: three full games cleared (cleared ' + stats.cleared + ')');
  ok(stats.stuckSeen >= 1, 'mahjong: the stuck state was reached at least once');

  // ---------- the last two tiles lie one on the other: Mescola must rescue the game ----------
  for (let attempt = 0; attempt < 5 && !stats.deadReplayed; attempt++) {
    if (attempt > 0) await clickBtn('.mahjong .actions', RE_MJ_NEW);
    st = await mjState();
    mjReset(expect);
    const toDead = mjPlan(st.tiles, 'dead', 1500);
    if (!toDead) continue;
    stats.games += 1;
    stats.deadReplayed = true;
    for (const pair of toDead) await mjPlayPair(pair, expect);
    let s2 = await mjState();
    ok(s2.tiles.length === 2 && s2.stuck && s2.tiles[0].type === s2.tiles[1].type, 'mahjong: reached the last two tiles, one lying on the other');
    eq(s2.score, 710, 'mahjong: 71 pairs give 710 points');
    await shot('mahjong-last-two-stacked');
    const undone = await mjShuffle(expect, 'last two stacked', stats);
    s2 = await mjState();
    ok(undone >= 1 && s2.tiles.length === 2 + 2 * undone, 'mahjong: Mescola puts pairs back when the last tiles lie one on the other (' + undone + ' put back, message "' + s2.msg + '")');
    await shot('mahjong-rescued');
    const again = await mjUndo(expect);
    const s3 = await mjState();
    ok(again !== null && s3.tiles.length === s2.tiles.length + 2, 'mahjong: Annulla still works after that Mescola');
    mjCheck(s3, 'rescued + Annulla', expect.score);
    if ((await mjFinish('greedy', expect, 'rescued game', stats)) === 'cleared') {
      await mjWinChecks(expect, 'rescued game');
      stats.cleared += 1;
      stats.rescuedWin = true;
    }
    ok(stats.rescuedWin === true, 'mahjong: a game that ran into two stacked tiles can be finished after Mescola');
  }
  if (!stats.deadReplayed) notes.push('mahjong: no deal with a reachable same-kind stack was found in 5 deals (rescue check skipped)');

  // "Nuova partita" mid-game, then leave with the Menu button while the ambient sound runs
  await mjPlayPair((await mjState()).pair, expect);
  await clickBtn('.mahjong .actions', RE_MJ_NEW);
  mjReset(expect);
  st = await mjState();
  ok(st.tiles.length === 144 && st.score === 0 && !st.stuck, 'mahjong: "Nuova partita" deals a fresh game');
  await mjUndo(expect);
  eq((await mjState()).tiles.length, 144, 'mahjong: Annulla on a new game does not bring back tiles of the game before');
  await page.click('#home');
  await waitMenu();
  console.log('  games ' + stats.games + ', cleared ' + stats.cleared + ', stuck seen ' + stats.stuckSeen + ', shuffles ' + stats.shuffles + ', rescues by Mescola ' + stats.rescues + ', tile size on screen ' + stats.tile + ' px');
  return stats;
}

// =====================================================================================
// DAMA: independent rules
// =====================================================================================
// Board = string of 64 chars: '.', 'w' 'W' (white pedina/Damone), 'b' 'B' (black).
const isWhite = (ch) => ch === 'w' || ch === 'W';
const isKing = (ch) => ch === 'W' || ch === 'B';
// darkParity: (row + col) % 2 of the dark squares, read from the page.
function startBoard(darkParity) {
  let s = '';
  for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) s += (r + c) % 2 !== darkParity ? '.' : r < 3 ? 'b' : r > 4 ? 'w' : '.';
  return s;
}
function ruleMoves(s, color) {
  const mine = (ch) => ch !== '.' && isWhite(ch) === (color === 'w');
  const quiet = [];
  let caps = [];
  for (let sq = 0; sq < 64; sq++) {
    const p = s[sq];
    if (!mine(p)) continue;
    const king = isKing(p);
    const fwd = color === 'w' ? -1 : 1;
    const dirs = king ? [[-1, -1], [-1, 1], [1, -1], [1, 1]] : [[fwd, -1], [fwd, 1]];
    const r0 = sq >> 3; const c0 = sq & 7;
    for (const d of dirs) {
      const r = r0 + d[0]; const c = c0 + d[1];
      if (r >= 0 && r < 8 && c >= 0 && c < 8 && s[r * 8 + c] === '.') quiet.push({ from: sq, to: r * 8 + c, path: [sq, r * 8 + c], caps: [], king: king, kings: 0 });
    }
    // capture chains: taken pieces are remembered, the start square counts as empty
    const walk = (at, path, taken, kings) => {
      let more = false;
      const r1 = at >> 3; const c1 = at & 7;
      for (const d of dirs) {
        const mr = r1 + d[0]; const mc = c1 + d[1];
        const lr = mr + d[0]; const lc = mc + d[1];
        if (lr < 0 || lr > 7 || lc < 0 || lc > 7) continue;
        const mid = mr * 8 + mc; const land = lr * 8 + lc;
        const victim = s[mid];
        if (victim === '.' || mine(victim) || taken.indexOf(mid) >= 0) continue;
        if (isKing(victim) && !king) continue; // a pedina never takes a Damone
        if (s[land] !== '.' && land !== sq) continue;
        more = true;
        walk(land, path.concat([land]), taken.concat([mid]), kings + (isKing(victim) ? 1 : 0));
      }
      if (!more && taken.length) caps.push({ from: sq, to: at, path: path, caps: taken, king: king, kings: kings });
    };
    walk(sq, [sq], [], 0);
  }
  if (!caps.length) return quiet;
  const most = Math.max.apply(null, caps.map((m) => m.caps.length));
  caps = caps.filter((m) => m.caps.length === most);
  if (caps.some((m) => m.king)) caps = caps.filter((m) => m.king);
  const mostKings = Math.max.apply(null, caps.map((m) => m.kings));
  return caps.filter((m) => m.kings === mostKings);
}
function ruleApply(s, mv) {
  const a = s.split('');
  let p = a[mv.from];
  a[mv.from] = '.';
  mv.caps.forEach((x) => { a[x] = '.'; });
  if (p === 'w' && (mv.to >> 3) === 0) p = 'W';
  if (p === 'b' && (mv.to >> 3) === 7) p = 'B';
  a[mv.to] = p;
  return a.join('');
}
const moveKey = (m) => m.path.join('-') + 'x' + m.caps.join(',');
const countOf = (s, color) => s.split('').filter((ch) => ch !== '.' && isWhite(ch) === (color === 'w')).length;

// A simple strong player for the human side (negamax on the independent rules).
function ruleEval(s, color) {
  let v = 0;
  for (let sq = 0; sq < 64; sq++) {
    const p = s[sq];
    if (p === '.') continue;
    const r = sq >> 3;
    const x = isKing(p) ? 260 : 100 + (isWhite(p) ? 7 - r : r) * 3;
    v += isWhite(p) === (color === 'w') ? x : -x;
  }
  return v;
}
function ruleSearch(s, color, depth, alpha, beta) {
  const moves = ruleMoves(s, color);
  if (!moves.length) return -90000 - depth;
  if (depth <= 0 && !moves[0].caps.length) return ruleEval(s, color);
  let best = -Infinity;
  for (const m of moves) {
    const v = -ruleSearch(ruleApply(s, m), color === 'w' ? 'b' : 'w', depth - 1, -beta, -alpha);
    if (v > best) best = v;
    if (best > alpha) alpha = best;
    if (alpha >= beta) break;
  }
  return best;
}
function chooseHuman(s, moves, policy) {
  if (policy === 'random') return pickOne(moves);
  const depth = policy === 'strong' ? 6 : 2;
  let best = []; let bestV = -Infinity;
  for (const m of moves) {
    // integer scores: this window still gives exact values for moves as good as the best one
    const v = -ruleSearch(ruleApply(s, m), 'b', depth - 1, -Infinity, -bestV + 1);
    if (v > bestV) { bestV = v; best = [m]; } else if (v === bestV) best.push(m);
  }
  return pickOne(best);
}

// ---------- Dama: page helpers ----------
const damaState = () => page.evaluate(() => {
  const d = window.RA.current.debug;
  const q = (s) => Array.from(document.querySelectorAll(s));
  const ints = (s) => (s.match(/\d+/g) || []).map(Number);
  const pills = q('.dama .pill').map((p) => p.textContent);
  return {
    b: d.board.map((p) => (!p ? '.' : p.c === 'w' ? (p.d ? 'W' : 'w') : (p.d ? 'B' : 'b'))).join(''),
    turn: d.turn, over: d.over, thinking: d.thinking, level: d.level,
    moves: d.legalMoves().map((m) => ({ from: m.from, to: m.to, path: m.path.slice(), caps: m.caps.slice() })),
    sqs: q('.dama .checker-board .sq[data-sq]').map((e) => {
      const p = e.querySelector('.piece');
      return { sq: Number(e.dataset.sq), cls: e.className.split(' '), p: p ? p.className.split(' ') : null };
    }),
    counts: [ints(pills[0] || '')[0], ints(pills[1] || '')[0]], wins: ints(pills[2] || ''), pillText: pills.join(' | '),
    msg: document.querySelector('.dama .msg').textContent,
    msgBig: document.querySelector('.dama .msg').classList.contains('big'),
    levelBtns: q('.dama button[data-level]').map((b) => ({ k: b.dataset.level, on: !b.classList.contains('ghost') })),
    lsLevel: localStorage.getItem('ra.dama.level'),
    lsScore: JSON.parse(localStorage.getItem('ra.dama.score') || '{"human":0,"cpu":0}'),
  };
});
const sqSel = (sq) => '.dama .checker-board .sq[data-sq="' + sq + '"]';
const clickSq = (sq) => page.click(sqSel(sq), { timeout: 4000 });
const RE_DAMA_NEW = /Nuova partita/i;
const RE_MUST = /Devi mangiare/i;
let DARK = 1; // (row + col) % 2 of the dark squares, set from the page
let START = startBoard(1);
const anySel = (s) => s.sqs.some((q) => has(q.cls, 'sel'));

function checkDamaDom(st, label) {
  let good = st.sqs.length === 64;
  st.sqs.forEach((q, k) => {
    const ch = st.b[k];
    const dark = ((k >> 3) + (k & 7)) % 2 === DARK;
    if (q.sq !== k || has(q.cls, 'dark') !== dark || has(q.cls, 'light') === dark) good = false;
    if (ch === '.') { if (q.p) good = false; return; }
    if (!q.p || !dark) { good = false; return; }
    if (has(q.p, 'white') !== isWhite(ch) || has(q.p, 'black') === isWhite(ch)) good = false;
    if (has(q.p, 'damone') !== isKing(ch)) good = false;
  });
  ok(good, 'dama ' + label + ': the board on screen matches debug.board (pieces, colours, Damoni, all on dark squares)');
  eq(st.counts, [countOf(st.b, 'w'), countOf(st.b, 'b')], 'dama ' + label + ': piece counters');
  ok(!/(^|\D)1 pezzi/.test(st.pillText) && st.counts.every((n, k) => n !== 1 || /(^|\D)1 pezzo/.test(st.pillText.split(' | ')[k])), 'dama ' + label + ': one piece is written "1 pezzo" ("' + st.pillText + '")');
  eq(st.wins, [st.lsScore.human, st.lsScore.cpu], 'dama ' + label + ': wins counter equals the saved score');
  ok(st.levelBtns.length === 3 && st.levelBtns.filter((b) => b.on).length === 1 && st.levelBtns.find((b) => b.on).k === st.level, 'dama ' + label + ': the current level button is highlighted');
}
// Checks at the start of a human turn. Returns the independent legal moves.
function checkHumanTurn(st, label) {
  checkDamaDom(st, label);
  const mine = ruleMoves(st.b, 'w');
  eq(st.moves.map(moveKey).sort(), mine.map(moveKey).sort(), 'dama ' + label + ': legal moves for white equal the independent rules on ' + st.b);
  const must = mine.length > 0 && mine[0].caps.length > 0;
  const origins = new Set(mine.map((m) => m.from));
  ok(st.sqs.every((q) => {
    if (!q.p) return true;
    const mark = has(q.p, 'must') ? 'must' : has(q.p, 'movable') ? 'movable' : '';
    return mark === (origins.has(q.sq) ? (must ? 'must' : 'movable') : '');
  }), 'dama ' + label + ': exactly the pieces that may move are marked (' + (must ? 'capture' : 'plain move') + ')');
  ok(!st.sqs.some((q) => has(q.cls, 'sel') || has(q.cls, 'target')), 'dama ' + label + ': nothing selected at the start of the turn');
  return { moves: mine, must: must, origins: origins };
}

async function waitCpu() {
  // Resolves when the CPU has answered; returns ms since the human's move click.
  return Promise.race([
    page.evaluate(() => new Promise((res) => {
      const tick = () => {
        const cur = window.RA.current;
        if (!cur || !cur.debug.thinking) res(performance.now() - window.__moveClick);
        else setTimeout(tick, 2);
      };
      tick();
    })),
    sleep(30000).then(() => { throw new Error('CPU did not answer within 30 s'); }),
  ]);
}

// Clicks that must not change anything.
async function illegalClicks(st, info, label, cov) {
  const b = st.b;
  const snapshot = async (what) => {
    const s = await damaState();
    ok(s.b === b && s.turn === 'w' && !s.thinking && !s.over, 'dama ' + label + ': ' + what + ' does not change the position');
    return s;
  };
  const light = []; const emptyDark = []; const enemy = []; const stuckOwn = [];
  for (let sq = 0; sq < 64; sq++) {
    if (((sq >> 3) + (sq & 7)) % 2 !== DARK) { light.push(sq); continue; }
    if (b[sq] === '.') emptyDark.push(sq);
    else if (!isWhite(b[sq])) enemy.push(sq);
    else if (!info.origins.has(sq)) stuckOwn.push(sq);
  }
  // a light square, an empty dark square, an enemy piece
  await clickSq(pickOne(light));
  if (emptyDark.length) await clickSq(pickOne(emptyDark));
  if (enemy.length) await clickSq(pickOne(enemy));
  let s = await snapshot('clicking a light square, an empty square and an enemy piece');
  ok(!anySel(s), 'dama ' + label + ': those clicks select nothing');
  // own piece that may not move
  if (stuckOwn.length) {
    await clickSq(pickOne(stuckOwn));
    s = await snapshot('clicking a piece that may not move');
    ok(!anySel(s), 'dama ' + label + ': a piece that may not move is not selected');
    ok(info.must ? RE_MUST.test(s.msg) : /non può muoversi/i.test(s.msg), 'dama ' + label + ': message for a piece that may not move ("' + s.msg + '")');
    if (info.must) { cov.mustRefused += 1; if (cov.mustRefused === 1) await shot('dama-must-capture-refused'); }
  }
  // select a legal piece, then click a square that is not a target
  const from = pickOne(Array.from(info.origins));
  const targets = new Set(info.moves.filter((m) => m.from === from).map((m) => m.to));
  await clickSq(from);
  s = await damaState();
  eq(s.sqs.filter((q) => has(q.cls, 'sel')).map((q) => q.sq), [from], 'dama ' + label + ': a movable piece gets selected');
  eq(sortNum(s.sqs.filter((q) => has(q.cls, 'target')).map((q) => q.sq)), sortNum(Array.from(targets)), 'dama ' + label + ': the marked arrival squares are exactly the legal ones');
  // prefer a square the piece could step to if capture were not mandatory
  const r = from >> 3; const c = from & 7;
  const stepSquares = [[-1, -1], [-1, 1], [1, -1], [1, 1]].map((d) => [r + d[0], c + d[1]]).filter((p) => p[0] >= 0 && p[0] < 8 && p[1] >= 0 && p[1] < 8).map((p) => p[0] * 8 + p[1]).filter((x) => b[x] === '.' && !targets.has(x));
  const nonTarget = stepSquares.length ? pickOne(stepSquares) : emptyDark.find((x) => !targets.has(x));
  if (nonTarget != null) {
    await clickSq(nonTarget);
    s = await snapshot(info.must ? 'a plain step while a capture is mandatory' : 'a click on a square that is not an arrival square');
    ok(!anySel(s), 'dama ' + label + ': an illegal arrival square clears the selection');
    if (info.must && stepSquares.length) cov.mustStepRefused += 1;
  } else {
    await clickSq(from);
  }
  // select and deselect
  if (!targets.has(from)) {
    await clickSq(from);
    await clickSq(from);
    s = await snapshot('selecting and deselecting a piece');
    ok(!anySel(s), 'dama ' + label + ': a second click deselects');
  }
}

// Plays one complete game. opts: { name, level, policy, switchLevels, first }
async function damaGame(opts, cov, timing) {
  const label = opts.name;
  await clickBtn('.dama .levels', RE_DAMA_NEW);
  await page.click('.dama button[data-level="' + opts.level + '"]');
  let st = await damaState();
  eq([st.b, st.turn, st.over, st.thinking, st.level, st.lsLevel], [START, 'w', null, false, opts.level, JSON.stringify(opts.level)], 'dama ' + label + ': fresh game, white to move, level set and saved');
  const winsBefore = st.lsScore;
  const sfxBefore = await sounds();
  let quiet = 0;
  let plies = 0;
  let humanMoves = 0;
  let result = null;
  let levelNow = opts.level;
  while (plies < 500) {
    const turnLabel = label + ' ply ' + plies;
    const info = checkHumanTurn(st, turnLabel);
    if (!info.moves.length) { ok(false, 'dama ' + turnLabel + ': white has no move but the game is not over'); break; }
    if (info.must && !/ha mangiato/.test(st.msg)) ok(RE_MUST.test(st.msg), 'dama ' + turnLabel + ': the message says that a capture is mandatory ("' + st.msg + '")');
    if (info.must && /ha mangiato/.test(st.msg)) ok(RE_MUST.test(st.msg), 'dama ' + turnLabel + ': after a capture by the CPU the message also says that I must capture now ("' + st.msg + '")');
    if (!info.must && /ha mangiato/.test(st.msg)) ok(!RE_MUST.test(st.msg), 'dama ' + turnLabel + ': no "devi mangiare" after a CPU capture when I have nothing to take');
    if (!info.must) ok(!RE_MUST.test(st.msg), 'dama ' + turnLabel + ': no "Devi mangiare" when there is nothing to capture');
    if (info.must && cov.mustShots < 1) { cov.mustShots += 1; await shot('dama-must-capture'); }
    if (humanMoves < 2 || info.must || rnd() < 0.2) await illegalClicks(st, info, turnLabel, cov);

    // level switch on the human's turn
    if (opts.switchLevels && humanMoves === 2) {
      await page.click('.dama button[data-level="medio"]');
      levelNow = 'medio';
      const s = await damaState();
      eq([s.b, s.turn, s.level, s.lsLevel], [st.b, 'w', 'medio', '"medio"'], 'dama ' + label + ': switching level on my turn keeps the position');
    }

    // ----- the human move: click the piece, then the final square (one click also for multi-jumps)
    const mv = chooseHuman(st.b, info.moves, opts.policy);
    const sameFromTo = info.moves.filter((m) => m.from === mv.from && m.to === mv.to);
    await clickSq(mv.from);
    if (mv.caps.length >= 2 && cov.multiShots < 1) { cov.multiShots += 1; await shot('dama-multi-jump-selected'); }
    if (humanMoves === 0) {
      const s = await damaState();
      ok(s.msg !== st.msg && s.msg.length > 0, 'dama ' + label + ': the message changes after selecting a piece ("' + s.msg + '")');
      if (opts.first) await shot('dama-selected');
    }
    await clickSq(mv.to);
    // Two capture routes with the same start and end: the game asks for the first piece to take.
    const firsts = new Set(sameFromTo.map((m) => m.caps[0]));
    let wanted = sameFromTo;
    if (sameFromTo.length > 1 && firsts.size > 1) {
      const c = await damaState();
      ok(c.b === st.b && c.turn === 'w' && !c.thinking, 'dama ' + turnLabel + ': with two capture routes nothing moves before I choose');
      eq(sortNum(c.sqs.filter((q) => has(q.cls, 'target')).map((q) => q.sq)), sortNum(Array.from(firsts)), 'dama ' + turnLabel + ': the first pieces of both routes are marked');
      ok(/due modi/i.test(c.msg), 'dama ' + turnLabel + ': the message asks which piece to take first ("' + c.msg + '")');
      cov.choices += 1;
      await clickSq(mv.caps[0]);
      wanted = sameFromTo.filter((m) => m.caps[0] === mv.caps[0]);
    }
    await page.evaluate(() => { window.__moveClick = window.__lastClick; });
    const after = await damaState();
    const expected = wanted.map((m) => ruleApply(st.b, m));
    ok(expected.indexOf(after.b) >= 0, 'dama ' + turnLabel + ': my move ' + moveKey(mv) + ' gives the expected position (got ' + after.b + ')');
    if (new Set(expected).size > 1) cov.ambiguous += 1;
    const played = wanted.find((m) => ruleApply(st.b, m) === after.b) || mv;
    eq(sortNum(after.sqs.filter((q) => has(q.cls, 'taken')).map((q) => q.sq)), sortNum(played.caps), 'dama ' + turnLabel + ': the squares of the pieces I took are marked');
    const moverWasMan = st.b[mv.from] === 'w';
    quiet = mv.caps.length || moverWasMan ? 0 : quiet + 1;
    plies += 1;
    humanMoves += 1;
    if (mv.caps.length >= 2) cov.humanMulti += 1;
    if (moverWasMan && after.b[mv.to] === 'W') {
      cov.humanPromo += 1;
      ok(has(after.sqs[mv.to].p, 'damone'), 'dama ' + turnLabel + ': my new Damone is drawn as a Damone');
      if (cov.humanPromo === 1) await shot('dama-human-damone');
    }
    ok(has(after.sqs[mv.from].cls, 'last') && has(after.sqs[mv.to].cls, 'last'), 'dama ' + turnLabel + ': the last move is highlighted');
    const blackMoves = ruleMoves(after.b, 'b');
    if (!blackMoves.length) {
      eq(after.over, 'human', 'dama ' + turnLabel + ': black cannot move, the human wins');
      result = 'human';
      break;
    }
    if (quiet >= 80) {
      eq(after.over, 'draw', 'dama ' + turnLabel + ': 80 quiet plies give a draw');
      result = 'draw';
      break;
    }
    if (!ok(after.over === null && after.turn === 'b', 'dama ' + turnLabel + ': the game goes on with black to move (over=' + after.over + ')')) { result = after.over; break; }
    if (after.thinking) {
      ok(/pensando/i.test(after.msg), 'dama ' + turnLabel + ': thinking message ("' + after.msg + '")');
      ok(!after.sqs.some((q) => q.p && (has(q.p, 'movable') || has(q.p, 'must'))), 'dama ' + turnLabel + ': no piece is offered while the CPU thinks');
      if (cov.thinkShots < 1) { cov.thinkShots += 1; await shot('dama-thinking'); }
      // clicks while the CPU thinks are ignored
      if (humanMoves <= 2 || rnd() < 0.15) {
        const own = [];
        for (let sq = 0; sq < 64; sq++) if (isWhite(after.b[sq])) own.push(sq);
        await clickSq(pickOne(own));
        const s = await damaState();
        if (s.thinking) {
          ok(s.b === after.b && !anySel(s), 'dama ' + turnLabel + ': clicks are ignored while the CPU thinks');
          cov.thinkingClicks += 1;
        } else {
          // the CPU answered before the click arrived: undo a possible selection
          const picked = s.sqs.find((q) => has(q.cls, 'sel'));
          if (picked) await clickSq(picked.sq);
        }
      }
      // level switch while the CPU is thinking
      if (opts.switchLevels && humanMoves === 4) {
        await page.click('.dama button[data-level="difficile"]');
        const s = await damaState();
        if (s.thinking) { ok(s.b === after.b && s.level === 'difficile', 'dama ' + label + ': switching level while the CPU thinks keeps the position'); cov.switchWhileThinking += 1; }
        levelNow = 'difficile';
      }
    }
    const wall = await waitCpu();
    (timing[levelNow] = timing[levelNow] || []).push(wall);
    const cpu = await damaState();
    const cands = blackMoves.filter((m) => ruleApply(after.b, m) === cpu.b);
    if (!ok(cands.length >= 1, 'dama ' + turnLabel + ': the CPU move is legal (' + after.b + ' -> ' + cpu.b + ')')) break;
    const cm = cands[0];
    quiet = cm.caps.length || after.b[cm.from] === 'b' ? 0 : quiet + 1;
    plies += 1;
    if (cm.caps.length >= 2) { cov.cpuMulti += 1; if (cov.cpuMulti === 1) await shot('dama-after-cpu-multi-jump'); }
    if (cm.caps.length && !cpu.over) {
      const said = cpu.msg.match(/ha mangiato (\d+) pezz/);
      ok(said && Number(said[1]) === cm.caps.length, 'dama ' + turnLabel + ': the message tells how many pieces the CPU took ("' + cpu.msg + '")');
    }
    if (after.b[cm.from] === 'b' && cpu.b[cm.to] === 'B') {
      cov.cpuPromo += 1;
      ok(has(cpu.sqs[cm.to].p, 'damone'), 'dama ' + turnLabel + ': the CPU Damone is drawn as a Damone');
      if (cov.cpuPromo === 1) await shot('dama-cpu-damone');
    }
    ok(has(cpu.sqs[cm.from].cls, 'last') && has(cpu.sqs[cm.to].cls, 'last'), 'dama ' + turnLabel + ': the CPU move is highlighted');
    eq(sortNum(cpu.sqs.filter((q) => has(q.cls, 'taken')).map((q) => q.sq)), sortNum(cm.caps), 'dama ' + turnLabel + ': the squares of the pieces the CPU took are marked');
    st = cpu;
    const whiteMoves = ruleMoves(cpu.b, 'w');
    if (!whiteMoves.length) { eq(cpu.over, 'cpu', 'dama ' + turnLabel + ': white cannot move, the CPU wins'); result = 'cpu'; break; }
    if (quiet >= 80) { eq(cpu.over, 'draw', 'dama ' + turnLabel + ': 80 quiet plies give a draw'); result = 'draw'; break; }
    if (!ok(cpu.over === null && cpu.turn === 'w' && !cpu.thinking, 'dama ' + turnLabel + ': my turn again (over=' + cpu.over + ')')) { result = cpu.over; break; }
  }
  if (!ok(result !== null, 'dama ' + label + ': the game ended (plies ' + plies + ')')) return null;
  // ----- game over screen
  st = await damaState();
  checkDamaDom(st, label + ' game over');
  eq(st.over, result, 'dama ' + label + ': result');
  ok(st.msgBig && (result === 'human' ? /Hai vinto/i : result === 'cpu' ? /Ha vinto/i : /Patta/i).test(st.msg), 'dama ' + label + ': end message for "' + result + '" ("' + st.msg + '")');
  eq(st.lsScore, { human: winsBefore.human + (result === 'human' ? 1 : 0), cpu: winsBefore.cpu + (result === 'cpu' ? 1 : 0) }, 'dama ' + label + ': the win is counted once');
  ok(!st.sqs.some((q) => q.p && (has(q.p, 'movable') || has(q.p, 'must'))), 'dama ' + label + ': no piece is offered after the end');
  const sfxAfter = await sounds();
  if (result === 'human') eq([sfxAfter.win - sfxBefore.win, sfxAfter.lose - sfxBefore.lose], [1, 0], 'dama ' + label + ': my win plays the win sound once');
  if (result === 'cpu') eq([sfxAfter.win - sfxBefore.win, sfxAfter.lose - sfxBefore.lose], [0, 1], 'dama ' + label + ': my defeat plays the lose sound once');
  if (result === 'draw') {
    eq(sfxAfter.win - sfxBefore.win, 0, 'dama ' + label + ': a draw does not play the win sound');
    eq(sfxAfter.lose - sfxBefore.lose, 0, 'dama ' + label + ': a draw does not play the defeat sound');
    ok(/senza prese/i.test(st.msg) && /pedina/i.test(st.msg), 'dama ' + label + ': the draw message names both conditions ("' + st.msg + '")');
  }
  if (cov.overShots[result] !== true) { cov.overShots[result] = true; await shot('dama-over-' + result); }
  const pieces = [];
  for (let sq = 0; sq < 64; sq++) if (st.b[sq] !== '.') pieces.push(sq);
  if (pieces.length) await clickSq(pickOne(pieces));
  await sleep(650); // a stray CPU timer would fire in this time
  const end2 = await damaState();
  ok(end2.b === st.b && end2.over === result && !end2.thinking && !anySel(end2), 'dama ' + label + ': nothing moves after the end of the game');
  cov.results.push(opts.level + '/' + opts.policy + ':' + result + '@' + plies);
  console.log('  ' + label + ': ' + result + ' after ' + plies + ' plies');
  return result;
}

// Places a position by writing into debug.board (the only place where this test writes state),
// then redraws with a real click on the level button. list = [[row, col, 'w' | 'W' | 'b' | 'B'], ...].
// Returns the state, or null when the page did not take the position.
async function damaSetUp(list) {
  await clickBtn('.dama .levels', RE_DAMA_NEW);
  await page.evaluate((pieces) => {
    const b = window.RA.current.debug.board;
    for (let i = 0; i < 64; i++) b[i] = null;
    pieces.forEach((p) => { b[p[0] * 8 + p[1]] = { c: p[2].toLowerCase(), d: p[2] !== p[2].toLowerCase() }; });
  }, list);
  await page.click('.dama button[data-level="facile"]');
  const want = new Array(64).fill('.');
  list.forEach((p) => { want[p[0] * 8 + p[1]] = p[2]; });
  const st = await damaState();
  return st.b === want.join('') && st.turn === 'w' && !st.over ? st : null;
}

// Two capture routes with the same start and end square.
async function damaTwoRoutes(cov) {
  const off = DARK === 0 ? 0 : 1; // keeps every piece on a dark square
  const sq = (r, c) => r * 8 + c + off;
  // --- A: a pedina can go left-left or right-right to the same square, taking different pieces
  let st = await damaSetUp([[6, 2 + off, 'w'], [5, 1 + off, 'b'], [3, 1 + off, 'b'], [5, 3 + off, 'b'], [3, 3 + off, 'b'], [0, 6 + off, 'b']]);
  if (!st) { notes.push('dama: the set-up position was not accepted by the page (two-routes check skipped)'); return; }
  let info = checkHumanTurn(st, 'two routes');
  eq(info.moves.length, 2, 'dama two routes: two legal captures');
  const from = sq(6, 2); const to = sq(2, 2);
  const left = info.moves.find((m) => m.caps[0] === sq(5, 1));
  const right = info.moves.find((m) => m.caps[0] === sq(5, 3));
  await clickSq(from);
  eq((await damaState()).sqs.filter((q) => has(q.cls, 'target')).map((q) => q.sq), [to], 'dama two routes: one arrival square');
  await clickSq(to);
  let c = await damaState();
  ok(c.b === st.b && c.turn === 'w', 'dama two routes: nothing moves before the choice');
  eq(sortNum(c.sqs.filter((q) => has(q.cls, 'target')).map((q) => q.sq)), [sq(5, 1), sq(5, 3)], 'dama two routes: the two first pieces are marked');
  ok(/due modi/i.test(c.msg), 'dama two routes: the message asks for the first piece ("' + c.msg + '")');
  await shot('dama-two-routes-choice');
  // a click elsewhere cancels the choice
  await clickSq(sq(4, 6));
  c = await damaState();
  ok(c.b === st.b && c.turn === 'w' && !c.sqs.some((q) => has(q.cls, 'target') || has(q.cls, 'sel')), 'dama two routes: a click on another square cancels the choice and the selection');
  knownBug(!/due modi/i.test(c.msg), 'dama: after the choice between two capture routes is cancelled, the line "Puoi mangiare in due modi…" stays on screen although nothing is selected');
  // choose the right-hand route
  await clickSq(from);
  await clickSq(to);
  await clickSq(sq(5, 3));
  await page.evaluate(() => { window.__moveClick = window.__lastClick; });
  let after = await damaState();
  eq(after.b, ruleApply(st.b, right), 'dama two routes: the clicked route is played (right-hand pieces taken, left-hand pieces stay)');
  eq(sortNum(after.sqs.filter((q) => has(q.cls, 'taken')).map((q) => q.sq)), sortNum(right.caps), 'dama two routes: the taken squares are marked');
  ok(left && ruleApply(st.b, left) !== after.b, 'dama two routes: the other route would have given a different position');
  cov.choices += 1;
  if (after.thinking) {
    await waitCpu();
    const cpu = await damaState();
    ok(ruleMoves(after.b, 'b').some((m) => ruleApply(after.b, m) === cpu.b), 'dama two routes: the CPU answers with a legal move');
  }
  // --- B: a Damone goes round four pieces and comes back; both directions take the same four pieces
  st = await damaSetUp([[4, 2 + off, 'W'], [3, 3 + off, 'b'], [1, 3 + off, 'b'], [1, 1 + off, 'b'], [3, 1 + off, 'b'], [6, 6 + off, 'b']]);
  if (!st) return;
  info = checkHumanTurn(st, 'round trip');
  const home = sq(4, 2);
  ok(info.moves.length === 2 && info.moves.every((m) => m.from === home && m.to === home && m.caps.length === 4), 'dama round trip: two legal captures of four pieces that end on the start square');
  await clickSq(home);
  eq((await damaState()).sqs.filter((q) => has(q.cls, 'target')).map((q) => q.sq), [home], 'dama round trip: the arrival square is the start square');
  await clickSq(home);
  c = await damaState();
  const done = ruleApply(st.b, info.moves[0]);
  ok(ruleApply(st.b, info.moves[1]) === done, 'dama round trip: both directions give the same position');
  if (c.b !== done) {
    knownBug(false, 'dama: when a Damone can go round the same four pieces in two directions, the game still asks "Puoi mangiare in due modi…" although both ways give the same position');
    await clickSq(info.moves[0].caps[0]);
    c = await damaState();
  }
  eq(c.b, done, 'dama round trip: the four pieces are taken and the Damone is back on its square');
  if (c.thinking) { await page.evaluate(() => { window.__moveClick = window.__lastClick; }); await waitCpu(); }
}

async function testDama() {
  console.log('DAMA');
  const cov = { humanMulti: 0, cpuMulti: 0, humanPromo: 0, cpuPromo: 0, mustRefused: 0, mustStepRefused: 0, thinkingClicks: 0, switchWhileThinking: 0, ambiguous: 0, choices: 0, results: [], mustShots: 0, multiShots: 0, thinkShots: 0, overShots: {} };
  const timing = {};
  await page.evaluate(() => { if (!window.__clickSpy) { window.__clickSpy = true; document.addEventListener('click', () => { window.__lastClick = performance.now(); }, true); } });
  await openFromMenu('Dama', '.dama .checker-board .sq[data-sq]');
  const overflow = await checkFits('dama');
  let st = await damaState();
  // which squares are dark: read it from the page, then everything must be consistent with it
  DARK = has(st.sqs[1].cls, 'dark') ? 1 : 0;
  START = startBoard(DARK);
  notes.push('dama: the dark corner square is at the bottom ' + (DARK === 1 ? 'LEFT' : 'RIGHT') + ' of the human player' + (DARK === 1 ? '' : ' (the test brief said bottom left)'));
  eq(st.b, START, 'dama: start position: 12 black pieces on the top three rows, 12 white on the bottom three, all on dark squares');
  eq([st.turn, st.over, st.thinking], ['w', null, false], 'dama: white (human) moves first');
  eq(st.level, 'facile', 'dama: default level is facile');
  eq(ruleMoves(START, 'w').length, 7, 'dama: seven first moves for white');
  await shot('dama-start');

  // ----- complete games, DAMA_GAMES per level
  const levels = ['facile', 'medio', 'difficile'];
  const policies = ['random', 'strong', 'careful'];
  let first = true;
  for (const level of levels) {
    for (let g = 0; g < DAMA_GAMES; g++) {
      await damaGame({ name: level + ' #' + (g + 1), level: level, policy: policies[g % policies.length], first: first }, cov, timing);
      first = false;
    }
  }
  // ----- one more game with level switches in the middle
  await damaGame({ name: 'level switches', level: 'facile', policy: 'careful', switchLevels: true }, cov, timing);
  eq((await damaState()).level, 'difficile', 'dama: the level chosen mid-game is still set at the end');

  // ----- two capture routes with the same start and end (set-up positions)
  await damaTwoRoutes(cov);

  // ----- "Nuova partita" while the CPU timer is running
  const newGame = () => clickBtn('.dama .levels', RE_DAMA_NEW);
  await newGame();
  await page.click('.dama button[data-level="facile"]');
  st = await damaState();
  eq(st.b, START, 'dama: "Nuova partita" after a finished game resets the board');
  let mv = pickOne(ruleMoves(START, 'w'));
  await clickSq(mv.from);
  await clickSq(mv.to);
  st = await damaState();
  ok(st.thinking && st.turn === 'b', 'dama: CPU is thinking after my first move');
  await newGame();
  st = await damaState();
  eq([st.b, st.turn, st.thinking, st.over], [START, 'w', false, null], 'dama: "Nuova partita" during the thinking timer resets at once');
  ok(!st.sqs.some((q) => has(q.cls, 'last')), 'dama: no last-move mark after the reset');
  await sleep(900);
  st = await damaState();
  eq([st.b, st.turn, st.thinking], [START, 'w', false], 'dama: no stray CPU move arrives after "Nuova partita"');
  // move, reset, move again quickly: exactly one CPU answer
  mv = pickOne(ruleMoves(START, 'w'));
  await clickSq(mv.from);
  await clickSq(mv.to);
  await newGame();
  const mv2 = pickOne(ruleMoves(START, 'w'));
  await clickSq(mv2.from);
  await clickSq(mv2.to);
  await page.evaluate(() => { window.__moveClick = window.__lastClick; });
  const afterMine = ruleApply(START, mv2);
  eq((await damaState()).b, afterMine, 'dama: my move after a quick reset is on the board');
  await waitCpu();
  st = await damaState();
  ok(ruleMoves(afterMine, 'b').some((m) => ruleApply(afterMine, m) === st.b), 'dama: exactly one CPU answer after reset + move');
  await sleep(800);
  const later = await damaState();
  ok(later.b === st.b && later.turn === 'w' && !later.thinking, 'dama: no second CPU move from the cancelled timer');
  // Esc while the CPU thinks, then come back
  const m3 = pickOne(ruleMoves(later.b, 'w'));
  await clickSq(m3.from);
  await clickSq(m3.to);
  await page.keyboard.press('Escape');
  await waitMenu();
  await sleep(700);
  await openFromMenu('Dama', '.dama .checker-board .sq[data-sq]');
  st = await damaState();
  eq([st.b, st.turn, st.thinking, st.level], [START, 'w', false, 'facile'], 'dama: leaving during the CPU timer and coming back gives a clean new game with the saved level');
  await page.click('#home');
  await waitMenu();

  // ----- coverage and timing
  ok(cov.humanMulti + cov.cpuMulti >= 1, 'dama: at least one multi-jump was played (human ' + cov.humanMulti + ', CPU ' + cov.cpuMulti + ')');
  ok(cov.humanPromo + cov.cpuPromo >= 1, 'dama: at least one promotion was seen (human ' + cov.humanPromo + ', CPU ' + cov.cpuPromo + ')');
  ok(cov.mustRefused + cov.mustStepRefused >= 1, 'dama: mandatory capture was tested in the UI (' + cov.mustRefused + ' other pieces refused, ' + cov.mustStepRefused + ' plain steps refused)');
  if (!cov.humanMulti) notes.push('dama: no human multi-jump happened in this run (only CPU multi-jumps)');
  if (!cov.humanPromo) notes.push('dama: no human promotion happened in this run');
  const summary = {};
  for (const level of Object.keys(timing)) {
    const t = timing[level];
    const max = Math.max.apply(null, t);
    const avg = t.reduce((x, y) => x + y, 0) / t.length;
    summary[level] = { moves: t.length, avgAnswerMs: Math.round(avg), maxAnswerMs: Math.round(max), maxThinkMs: Math.max(0, Math.round(max - 500)) };
    ok(max < 2500, 'dama ' + level + ': slowest CPU answer ' + Math.round(max) + ' ms (500 ms timer + thinking) is under 2.5 s');
    ok(Math.min.apply(null, t) >= 480, 'dama ' + level + ': the CPU never answers before its 500 ms timer');
  }
  console.log('  results: ' + cov.results.join(', '));
  console.log('  coverage: ' + JSON.stringify({ humanMultiJumps: cov.humanMulti, cpuMultiJumps: cov.cpuMulti, humanPromotions: cov.humanPromo, cpuPromotions: cov.cpuPromo, mustCaptureOtherPieceRefused: cov.mustRefused, mustCaptureStepRefused: cov.mustStepRefused, clicksWhileThinking: cov.thinkingClicks, levelSwitchWhileThinking: cov.switchWhileThinking, routeChoices: cov.choices }));
  console.log('  CPU answer time, click -> move shown (includes the fixed 500 ms timer): ' + JSON.stringify(summary));
  return { cov: cov, timing: summary, overflow: overflow };
}

// =====================================================================================
(async () => {
  const t0 = Date.now();
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1120, height: 812 }, deviceScaleFactor: 1 });
  page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errors.push('console ' + m.type() + ': ' + m.text().split('\n')[0]); });
  // Same games on every run: the page's Math.random is seeded.
  await page.addInitScript((seed) => {
    let a = seed >>> 0;
    Math.random = function () {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }, SEED);
  await page.goto(PAGE_URL);
  await waitMenu();
  ok(errors.length === 0, 'menu: no page errors or console errors while the menu is drawn (' + errors.slice(0, 3).join(' | ') + ')');
  ok((await page.locator('#stage .tile .thumb').count()) === 0 || (await page.evaluate(() => Array.from(document.querySelectorAll('#stage .tile')).filter((t) => /Sudoku|Mahjong|Dama/.test(t.textContent)).every((t) => { const th = t.querySelector('.thumb'); return !th || th.children.length > 0; }))), 'menu: the Sudoku, Mahjong and Dama tiles have a picture');
  await shot('menu');
  const out = {};
  const sections = { sudoku: testSudoku, mahjong: testMahjong, dama: testDama };
  let sectionNo = 0;
  for (const name of Object.keys(sections)) {
    sectionNo += 1;
    if (ONLY.indexOf(name) < 0) continue;
    const before = errors.length;
    try {
      // Every section starts from a freshly loaded page and its own random sequence,
      // so a section plays the same games whether it runs alone or after the others.
      rnd = makeRng(SEED + sectionNo);
      await page.goto(PAGE_URL);
      await waitMenu();
      await installSoundSpy();
      out[name] = await sections[name]();
    } catch (err) {
      failures.push(name + ': test aborted: ' + (err && err.message ? err.message.split('\n')[0] : err));
      console.log('  ABORT: ' + (err && err.stack ? err.stack.split('\n').slice(0, 4).join('\n') : err));
      if (SHOT_DIR) await shot('abort-' + name).catch(() => {});
      await page.evaluate(() => window.RA.showMenu()).catch(() => {});
    }
    ok(errors.length === before, name + ': no page errors or console errors (' + errors.slice(before, before + 5).join(' | ') + ')');
  }
  await browser.close();

  console.log('\n===== boards.e2e summary (seed ' + SEED + ', ' + ((Date.now() - t0) / 1000).toFixed(0) + ' s) =====');
  if (out.sudoku) console.log('Sudoku : ' + out.sudoku.solved + ' puzzles solved (givens ' + JSON.stringify(out.sudoku.givens) + ', grades ' + JSON.stringify(out.sudoku.grades) + '), pad key ' + out.sudoku.key + ' px');
  if (out.mahjong) console.log('Mahjong: ' + out.mahjong.cleared + ' games cleared of ' + out.mahjong.games + ' deals, stuck states ' + out.mahjong.stuckSeen + ', shuffles ' + out.mahjong.shuffles + ', rescues by Mescola ' + out.mahjong.rescues + ', tile size ' + out.mahjong.tile + ' px');
  if (out.dama) {
    console.log('Dama   : ' + out.dama.cov.results.length + ' complete games: ' + out.dama.cov.results.join(', ') + '; page overflow: ' + Math.max(0, out.dama.overflow) + ' px');
    console.log('Dama CPU answer times (ms, incl. 500 ms timer): ' + JSON.stringify(out.dama.timing));
  }
  console.log('Checks : ' + checks + ', failures: ' + failures.length + ', known issues: ' + known.length + (SHOT_DIR ? ', screenshots: ' + shotCount + ' in ' + SHOT_DIR : ''));
  notes.forEach((n) => console.log('NOTE  : ' + n));
  known.forEach((k) => console.log('KNOWN : ' + k));
  failures.forEach((f) => console.log('FAIL  : ' + f));
  console.log(failures.length ? 'RESULT: FAILED' : 'RESULT: OK');
  process.exit(failures.length ? 1 : 0);
})().catch((err) => {
  console.error(err);
  process.exit(2);
});
