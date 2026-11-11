// End-to-end test of the five arcade games and the app shell, in headless Chromium.
// It plays every game on the real page with real keyboard and mouse input (bots), and checks
// the logic state, the text drawn on the canvas (HUD), the overlays, the high scores,
// the navigation and the input layer.
//
// Run:   node tests/e2e/arcade.e2e.js                 (all scenarios, about 4 minutes)
//        SOAK_SECONDS=600 node tests/e2e/arcade.e2e.js soak   (longer random play)
//        node tests/e2e/arcade.e2e.js tetris snake    (only some scenarios)
//        node tests/e2e/arcade.e2e.js --strict        (known bugs count as failures)
//        SHOTS=/some/folder node tests/e2e/arcade.e2e.js   (also saves screenshots there)
//        RA_SRC=/copy/of/src node tests/e2e/arcade.e2e.js  (tests another copy of the app)
// Scenarios: shell, tetris, snake, invaders, pacman, bubbles, framerate, rare, soak.
// Exit code 0 = every check passed. Checks marked "known bug" are printed, and count as
// failures only with --strict (remove a mark once the bug is fixed).
//
// The page is observed with small hooks added before the page scripts run (see OBSERVE):
// they count requestAnimationFrame calls, window key listeners and audio oscillators, and
// record the text drawn on the canvas. They never change the game.
const path = require('path');
const fs = require('fs');
const { chromium } = require('playwright');

// RA_SRC=/other/copy/of/src tests another copy of the app (default: ../../src).
const URL = 'file://' + path.join(process.env.RA_SRC ? path.resolve(process.env.RA_SRC) : path.join(__dirname, '..', '..', 'src'), 'index.html');
const ARGS = process.argv.slice(2);
const STRICT = ARGS.includes('--strict');
const ONLY = ARGS.filter((a) => !a.startsWith('--'));
const SHOTS = process.env.SHOTS || '';
const ARCADE = ['bubbles', 'tetris', 'invaders', 'pacman', 'snake'];

// ---------- Result book-keeping ----------
const results = []; // { scenario, name, ok, detail, known }
const notes = []; // summary lines: scores, rows, waves...
function makeChecker(scenario) {
  const check = function (name, ok, detail) {
    results.push({ scenario: scenario, name: name, ok: !!ok, detail: ok ? '' : (detail === undefined ? '' : String(detail)), known: '' });
    if (!ok) console.log('  FAIL [' + scenario + '] ' + name + (detail === undefined ? '' : ' -> ' + detail));
    return !!ok;
  };
  // A check that fails today because of a bug that was reported. bugId refers to the QA report.
  check.known = function (bugId, name, ok, detail) {
    results.push({ scenario: scenario, name: name, ok: !!ok, detail: ok ? '' : (detail === undefined ? '' : String(detail)), known: bugId });
    if (!ok) console.log('  KNOWN BUG ' + bugId + ' [' + scenario + '] ' + name + (detail === undefined ? '' : ' -> ' + detail));
    return !!ok;
  };
  check.note = function (line) { notes.push('[' + scenario + '] ' + line); };
  return check;
}
const near = (a, b, tol) => Math.abs(a - b) <= tol;
// Builds a page function that returns a state snapshot and the canvas text of the same frame.
// (The page has a strict CSP, so the function is put together here, not in the page.)
// eslint-disable-next-line no-eval
const withTexts = (snapFn) => eval('(() => ({ s: (' + snapFn.toString() + ')(), texts: window.__t.texts.slice() }))');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- Hooks added to the page before its own scripts ----------
function OBSERVE(virtualClock) {
  const T = (window.__t = { raf: 0, frames: 0, texts: [], osc: 0, lastKeyDefault: null });
  // Text drawn on any canvas: T.texts holds the strings of the last complete frame.
  let cur = [];
  const ft = CanvasRenderingContext2D.prototype.fillText;
  CanvasRenderingContext2D.prototype.fillText = function (s) {
    cur.push(String(s));
    return ft.apply(this, arguments);
  };
  const wrap = function (cb) {
    return function (t) {
      T.frames += 1;
      cb(t);
      // Other users of requestAnimationFrame draw nothing: keep the text of the game frame.
      if (cur.length) T.texts = cur;
      cur = [];
    };
  };
  if (virtualClock) {
    // A display that we drive by hand: __vtick(n, ms) shows n frames, ms apart.
    const cbs = new Map();
    let id = 0;
    let now = 1000;
    window.requestAnimationFrame = function (cb) { T.raf += 1; id += 1; cbs.set(id, wrap(cb)); return id; };
    window.cancelAnimationFrame = function (i) { cbs.delete(i); };
    window.__vtick = function (n, ms) {
      for (let i = 0; i < n; i++) {
        now += ms;
        const list = Array.from(cbs.values());
        cbs.clear();
        list.forEach(function (cb) { cb(now); });
      }
    };
  } else {
    const raf = window.requestAnimationFrame.bind(window);
    window.requestAnimationFrame = function (cb) { T.raf += 1; return raf(wrap(cb)); };
  }
  // Listeners on window.
  const sets = { keydown: new Set(), keyup: new Set(), blur: new Set(), resize: new Set() };
  const add = window.addEventListener;
  const rem = window.removeEventListener;
  window.addEventListener = function (type, fn) { if (sets[type]) sets[type].add(fn); return add.apply(this, arguments); };
  window.removeEventListener = function (type, fn) { if (sets[type]) sets[type].delete(fn); return rem.apply(this, arguments); };
  // Listeners on document (the pause listens to visibilitychange there).
  const vis = new Set();
  const dadd = document.addEventListener;
  const drem = document.removeEventListener;
  document.addEventListener = function (type, fn) { if (type === 'visibilitychange') vis.add(fn); return dadd.apply(this, arguments); };
  document.removeEventListener = function (type, fn) { if (type === 'visibilitychange') vis.delete(fn); return drem.apply(this, arguments); };
  T.listeners = function () { return { keydown: sets.keydown.size, keyup: sets.keyup.size, blur: sets.blur.size, resize: sets.resize.size, visibility: vis.size }; };
  // Sound: count the oscillators that the game creates.
  const AC = window.AudioContext || window.webkitAudioContext;
  if (AC) {
    const co = AC.prototype.createOscillator;
    AC.prototype.createOscillator = function () { T.osc += 1; return co.apply(this, arguments); };
  }
  // Was the default action of the last key event prevented? (registered first, read later)
  document.addEventListener('keydown', function (e) { setTimeout(function () { T.lastKeyDefault = { key: e.key, prevented: e.defaultPrevented }; }, 0); });
  // Synthetic key helpers for the in-page bots. They go through the same window listeners.
  window.__key = function (type, key) { window.dispatchEvent(new KeyboardEvent(type, { key: key, bubbles: true, cancelable: true })); };
  window.__tap = function (key) { window.__key('keydown', key); window.__key('keyup', key); };
}

// ---------- Page helpers ----------
async function newPage(browser, opts) {
  const o = opts || {};
  const ctx = await browser.newContext({ viewport: o.viewport || { width: 1120, height: 812 }, deviceScaleFactor: o.dsf || 1 });
  await ctx.addInitScript(OBSERVE, !!o.virtualClock);
  const page = await ctx.newPage();
  page.errors = [];
  const addError = (line) => { const first = line.split('\n')[0]; if (!page.errors.includes(first)) page.errors.push(first); };
  page.on('pageerror', (e) => addError('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') addError('console: ' + m.text()); });
  await page.goto(URL);
  await page.waitForSelector('button.tile');
  return page;
}
const state = (page, fn, arg) => page.evaluate(fn, arg);
const started = (page) => page.evaluate(() => !!(window.RA.current && window.RA.current.debug.started));
const texts = (page) => page.evaluate(() => window.__t.texts.slice());
const hiScore = (page, id) => page.evaluate((k) => JSON.parse(localStorage.getItem('ra.hi.' + k) || '0'), id);
const overlayText = (page) => page.evaluate(() => { const o = document.querySelector('.overlay .card-box'); return o ? o.innerText : null; });
async function shot(page, name) {
  if (!SHOTS) return;
  fs.mkdirSync(SHOTS, { recursive: true });
  await page.screenshot({ path: path.join(SHOTS, name + '.png') });
}
async function openByTile(page, id) {
  const byId = page.locator('button.tile[data-game="' + id + '"]');
  if (await byId.count()) await byId.first().click();
  else {
    const title = await page.evaluate((k) => window.RA.modules[k].meta.title, id);
    await page.locator('button.tile', { hasText: title }).first().click();
  }
  await page.waitForSelector('.arcade-stage canvas');
}
// The wording on the cards and on the HUD may change with the look of the games, so the
// checks below look for the numbers of the state, not for whole sentences.
// Every whole number drawn on the canvas, e.g. ['PUNTI 00120', 'LIV.2'] -> [120, 2].
function hudNums(list) {
  const out = [];
  list.forEach((t) => { (String(t).match(/\d+/g) || []).forEach((d) => out.push(Number(d))); });
  return out;
}
const hudShows = (list, values) => { const n = hudNums(list); return values.every((v) => n.includes(v)); };
const hudBad = (list) => list.filter((t) => /NaN|undefined|null|Infinity/.test(t));
const hasText = (list, re) => list.some((t) => re.test(t));
// A card line such as "Punti: 120" (any separator after it).
const cardHas = (card, label, value) => !!card && new RegExp(label + ':\\s*' + value + '(\\D|$)', 'i').test(card);
const cardButton = (page) => page.locator('.overlay button.big').first();
// Value drawn right after a label, e.g. hudAfter(texts, 'PUNTI') -> '120'.
function hudAfter(list, label) {
  const i = list.indexOf(label);
  return i < 0 ? null : list[i + 1];
}
// The canvas must be completely inside the window and the page must not scroll.
async function layout(page) {
  return page.evaluate(() => {
    const c = document.querySelector('.arcade-stage canvas');
    const r = c.getBoundingClientRect();
    const o = document.querySelector('.overlay .card-box');
    const cr = o ? o.getBoundingClientRect() : null;
    const de = document.documentElement;
    const bar = document.getElementById('topbar').getBoundingClientRect();
    return {
      inside: r.left >= 0 && r.top >= bar.bottom && r.right <= window.innerWidth + 0.5 && r.bottom <= window.innerHeight + 0.5,
      noScroll: de.scrollHeight <= window.innerHeight && de.scrollWidth <= window.innerWidth && window.scrollY === 0 && window.scrollX === 0,
      rect: [r.left, r.top, r.width, r.height].map(Math.round),
      cardInside: cr ? cr.top >= r.top - 0.5 && cr.bottom <= r.bottom + 0.5 && cr.left >= 0 && cr.right <= window.innerWidth : null,
      cardCentred: cr ? Math.abs((cr.left + cr.right) / 2 - (r.left + r.right) / 2) < 2 && Math.abs((cr.top + cr.bottom) / 2 - (r.top + r.bottom) / 2) < 2 : null,
      helpVisible: (function () {
        const h = document.querySelector('.arcade-help');
        if (!h) return null;
        const hr = h.getBoundingClientRect();
        return hr.height > 0 && hr.bottom <= window.innerHeight + 0.5 && hr.top >= r.bottom - 0.5;
      })(),
      backing: [c.width, c.height],
      devicePx: [Math.round(r.width * window.devicePixelRatio), Math.round(r.height * window.devicePixelRatio)],
    };
  });
}

// What must stand still while a game is paused (one line per game, read in the page).
// Turns that a player chooses during the pause (Snake queue, Raccoon-man direction) are not in it.
const frozenSig = () => {
  const s = window.RA.current.debug.state;
  const id = window.RA.currentId;
  if (id === 'tetris') return JSON.stringify([s.cur, s.score, s.lines, s.gravity, s.board.reduce((n, r) => n + r.filter((v) => v !== null).length, 0)]);
  if (id === 'snake') return JSON.stringify([s.snake[0], s.snake.length, s.dir, s.score]);
  if (id === 'invaders') return JSON.stringify([s.px, s.pBullets, s.eBullets, s.fx, s.fy, s.score, s.lives, s.stepAcc]);
  if (id === 'pacman') return JSON.stringify([s.pac.x, s.pac.y, s.pac.p, s.pac.moving, s.ghosts.map((g) => [g.x, g.y, g.p, g.wait]), s.score, s.freeze, s.modeClock]);
  return JSON.stringify([s.moving, s.shots, s.angle, s.score, s.grid.size]);
};
const pausedNow = async (page) => hasText(await texts(page), /^PAUSA$/);
// Is the running game paused and standing still? Looks twice, ms apart.
async function standsStill(page, ms) {
  await page.waitForTimeout(90);
  const a = await page.evaluate(frozenSig);
  const shown = await pausedNow(page);
  await page.waitForTimeout(ms);
  const b = await page.evaluate(frozenSig);
  return { still: a === b, shown: shown, sig: b };
}
async function runsAgain(page) {
  const a = await page.evaluate(frozenSig);
  for (let i = 0; i < 15; i++) {
    await page.waitForTimeout(100);
    if ((await page.evaluate(frozenSig)) !== a) return !(await pausedNow(page));
  }
  return false;
}

// =====================================================================================
// TETRIS
// =====================================================================================
// Placement bot (same idea as tests/arcade.test.js): runs in the page, changes nothing.
function tetrisPlan() {
  const T = window.RA.modules.tetris;
  const s = window.RA.current.debug.state;
  if (!s.cur || s.over) return null;
  let best = null;
  for (let rot = 0; rot < 4; rot++) {
    for (let x = -2; x < T.W; x++) {
      if (T.collides(s.board, s.cur.type, rot, x, s.cur.y)) continue;
      let y = s.cur.y;
      while (!T.collides(s.board, s.cur.type, rot, x, y + 1)) y++;
      let b = s.board.map((r) => r.slice());
      T.cells(s.cur.type, rot, x, y).forEach((p) => { if (p.y >= 0) b[p.y][p.x] = 9; });
      const before = b.length;
      b = b.filter((r) => !r.every((v) => v !== null));
      const lines = before - b.length;
      while (b.length < T.H) b.unshift(new Array(T.W).fill(null));
      let holes = 0;
      let height = 0;
      let bumps = 0;
      const tops = [];
      for (let cx = 0; cx < T.W; cx++) {
        let top = 0;
        for (let cy = 0; cy < T.H; cy++) {
          if (b[cy][cx] !== null) { if (!top) top = T.H - cy; } else if (top) holes++;
        }
        tops.push(top);
        height += top;
      }
      for (let i = 1; i < tops.length; i++) bumps += Math.abs(tops[i] - tops[i - 1]);
      const score = 7.6 * lines - 3.6 * holes - 5.1 * height / 10 - 1.8 * bumps;
      if (!best || score > best.score) best = { score: score, rot: rot, x: x };
    }
  }
  return best && { rot: best.rot, x: best.x, curRot: s.cur.rot, curX: s.cur.x };
}
const tetrisSnap = () => {
  const s = window.RA.current.debug.state;
  const T = window.RA.modules.tetris;
  let ghost = null;
  if (s.cur) {
    ghost = s.cur.y;
    while (!T.collides(s.board, s.cur.type, s.cur.rot, s.cur.x, ghost + 1)) ghost++;
  }
  return {
    cur: s.cur && Object.assign({}, s.cur), ghost: ghost, next: s.next, score: s.score, lines: s.lines, level: s.level, over: s.over,
    blocks: s.board.reduce((n, r) => n + r.filter((v) => v !== null).length, 0),
    fullRows: s.board.filter((r) => r.every((v) => v !== null)).length,
    started: window.RA.current.debug.started, paused: window.RA.current.debug.paused,
  };
};

async function tetrisPlayPiece(page) {
  const plan = await state(page, tetrisPlan);
  if (!plan) return false;
  const turns = (plan.rot - plan.curRot + 4) % 4;
  for (let i = 0; i < turns; i++) await page.keyboard.press('ArrowUp');
  const x = await state(page, () => { const c = window.RA.current.debug.state.cur; return c ? c.x : null; });
  if (x === null) return false;
  const n = plan.x - x;
  for (let i = 0; i < Math.abs(n); i++) await page.keyboard.press(n > 0 ? 'ArrowRight' : 'ArrowLeft');
  await page.keyboard.press(' ');
  return true;
}

async function scenarioTetris(browser) {
  const check = makeChecker('tetris');
  const page = await newPage(browser);
  await page.evaluate(() => localStorage.clear());
  await openByTile(page, 'tetris');
  let s = await state(page, tetrisSnap);
  check('start card is shown and the game waits', !s.started && /tetris/i.test(await overlayText(page)) && (await cardButton(page).count()) === 1);
  // Keys before the start must not move the piece.
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press(' ');
  await page.keyboard.press('p');
  await page.waitForTimeout(300);
  let s2 = await state(page, tetrisSnap);
  check('keys do nothing while the start card is shown', s2.cur.x === s.cur.x && s2.cur.y === s.cur.y && s2.score === 0 && !s2.paused, JSON.stringify(s2.cur));
  await page.keyboard.press('Enter');
  check('Enter starts the game', await started(page));
  check('start card is removed', (await overlayText(page)) === null);

  // Gravity in real time: level 1 moves one row every 0.8 s.
  s = await state(page, tetrisSnap);
  await page.waitForTimeout(2450);
  s2 = await state(page, tetrisSnap);
  check('gravity is about 1 row per 0.8 s at level 1', s2.cur.y - s.cur.y >= 2 && s2.cur.y - s.cur.y <= 4, 'rows in 2.45 s: ' + (s2.cur.y - s.cur.y));

  // A tap moves one column. A held key repeats (the page gets no repeat events from Playwright,
  // so the repeat is the game's own).
  s = await state(page, tetrisSnap);
  await page.keyboard.press('ArrowLeft');
  s2 = await state(page, tetrisSnap);
  check('one tap on ← moves one column', s2.cur.x === s.cur.x - 1, s.cur.x + ' -> ' + s2.cur.x);
  await page.keyboard.down('ArrowRight');
  await page.waitForTimeout(130);
  const afterFirst = await state(page, tetrisSnap);
  await page.waitForTimeout(800);
  await page.keyboard.up('ArrowRight');
  const afterHold = await state(page, tetrisSnap);
  check('held → moves once at first (no repeat before 0.2 s)', afterFirst.cur.x === s2.cur.x + 1, s2.cur.x + ' -> ' + afterFirst.cur.x);
  const wallX = await state(page, () => { const T = window.RA.modules.tetris; const st = window.RA.current.debug.state; return T.collides(st.board, st.cur.type, st.cur.rot, st.cur.x + 1, st.cur.y); });
  check('held → repeats until the wall', wallX && afterHold.cur.x >= afterFirst.cur.x + 2, 'x=' + afterHold.cur.x);
  await page.waitForTimeout(250);
  const afterUp = await state(page, tetrisSnap);
  check('releasing the key stops the repeat', afterUp.cur.x === afterHold.cur.x);
  // OS auto-repeat events (repeat keydown) must not add moves or rotations.
  s = await state(page, tetrisSnap);
  await page.keyboard.down('ArrowUp');
  for (let i = 0; i < 6; i++) await page.keyboard.down('ArrowUp');
  await page.keyboard.up('ArrowUp');
  s2 = await state(page, tetrisSnap);
  check('auto-repeat of ↑ rotates only once', s2.cur.rot === (s.cur.rot + 1) % 4 || s.cur.type === 1, s.cur.rot + ' -> ' + s2.cur.rot);

  // Soft drop.
  s = await state(page, tetrisSnap);
  if (s.ghost - s.cur.y >= 8) {
    await page.keyboard.down('ArrowDown');
    await page.waitForTimeout(420);
    await page.keyboard.up('ArrowDown');
    s2 = await state(page, tetrisSnap);
    const rows = s2.cur.y - s.cur.y;
    check('held ↓ drops fast (about 20 rows per second after 0.2 s)', rows >= 4 && rows <= 8 && s2.score - s.score >= rows - 1, 'rows ' + rows + ', score +' + (s2.score - s.score));
  }

  // Pause.
  await page.keyboard.press('p');
  s = await state(page, tetrisSnap);
  check('P pauses', s.paused);
  await page.waitForTimeout(1300);
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('ArrowUp');
  await page.keyboard.press(' ');
  s2 = await state(page, tetrisSnap);
  check('nothing moves while paused', JSON.stringify(s2.cur) === JSON.stringify(s.cur) && s2.score === s.score && s2.blocks === s.blocks, JSON.stringify(s.cur) + ' / ' + JSON.stringify(s2.cur));
  check('the pause text is drawn', (await texts(page)).includes('PAUSA'));
  await shot(page, 'tetris-pause');
  await page.keyboard.press('p');
  await page.waitForTimeout(80);
  s = await state(page, tetrisSnap);
  check('P resumes', !s.paused && !(await texts(page)).includes('PAUSA'));
  await page.keyboard.press('P'); // capital letter (Caps Lock)
  check('capital P pauses too', (await state(page, tetrisSnap)).paused);
  await page.keyboard.press('P');

  // Hard drop: lands on the ghost row, 2 points per row, one piece per key press.
  s = await state(page, tetrisSnap);
  await page.keyboard.down(' ');
  for (let i = 0; i < 5; i++) await page.keyboard.down(' '); // auto-repeat events
  await page.waitForTimeout(200);
  await page.keyboard.up(' ');
  s2 = await state(page, tetrisSnap);
  const dist = s.ghost - s.cur.y;
  check('Space drops exactly one piece, also when held', s2.blocks === s.blocks + 4 - 10 * (s2.lines - s.lines), 'blocks ' + s.blocks + ' -> ' + s2.blocks);
  check('hard drop scores 2 points per row', s2.lines !== s.lines || (s2.score - s.score <= dist * 2 && s2.score - s.score >= dist * 2 - 4), 'dist ' + dist + ', score +' + (s2.score - s.score));
  check('the next piece becomes the current piece', s2.cur && s2.cur.type === s.next);

  // The bot plays with real key presses until 22 rows are cleared (level 3).
  let pieces = 0;
  let maxClear = 0;
  let prev = await state(page, tetrisSnap);
  let scoreOk = true;
  const table = [0, 100, 300, 500, 800];
  while (pieces < 400) {
    if (!(await tetrisPlayPiece(page))) break;
    pieces += 1;
    const now = await state(page, tetrisSnap);
    const cleared = now.lines - prev.lines;
    maxClear = Math.max(maxClear, cleared);
    const gain = now.score - prev.score - table[cleared] * prev.level;
    if (gain < 0 || gain > 40 || gain % 2 !== 0) scoreOk = false;
    if (now.fullRows) scoreOk = false;
    prev = now;
    if (now.over || now.lines >= 22) break;
    if (pieces === 12) await shot(page, 'tetris-play');
  }
  s = await state(page, tetrisSnap);
  check('the bot clears at least 22 rows with real key presses', s.lines >= 22, 'rows ' + s.lines + ' after ' + pieces + ' pieces');
  const botRows = s.lines;
  check('score = drop points + row points x level, no full row stays', scoreOk);
  check('level = rows / 10 + 1', s.level === Math.floor(s.lines / 10) + 1, 'level ' + s.level + ', rows ' + s.lines);
  await page.waitForTimeout(80);
  let snapT = await page.evaluate(withTexts(tetrisSnap));
  s = snapT.s;
  let hud = snapT.texts;
  check('HUD shows score, record, level and rows of the state',
    Number(hudAfter(hud, 'PUNTI')) === s.score && Number(hudAfter(hud, 'RECORD')) === s.score && Number(hudAfter(hud, 'LIVELLO')) === s.level && Number(hudAfter(hud, 'RIGHE')) === s.lines,
    JSON.stringify(hud.filter((t) => /^[A-Z0-9]+$/.test(t))));
  await shot(page, 'tetris-level3');
  // Gravity at level 3 is 0.66 s per row.
  const g0 = await state(page, tetrisSnap);
  await page.waitForTimeout(2000);
  const g1 = await state(page, tetrisSnap);
  if (g0.level === 3 && g1.blocks === g0.blocks) check('gravity is faster at level 3 (0.66 s per row)', g1.cur.y - g0.cur.y === 3 || g1.cur.y - g0.cur.y === 2 || g1.cur.y - g0.cur.y === 4, 'rows in 2 s: ' + (g1.cur.y - g0.cur.y));

  // Game over: drop pieces in the middle until the board is full.
  for (let i = 0; i < 60 && !(await state(page, tetrisSnap)).over; i++) await page.keyboard.press(' ');
  s = await state(page, tetrisSnap);
  const finalScore = s.score;
  check('the game ends when a new piece has no room', s.over && !s.started);
  let card = await overlayText(page);
  check('game-over card shows score, rows and record', cardHas(card, 'Punti', finalScore) && cardHas(card, 'Righe', s.lines) && cardHas(card, 'Record', finalScore), card);
  check('high score is saved', (await hiScore(page, 'tetris')) === finalScore, await hiScore(page, 'tetris'));
  const lay = await layout(page);
  check('game-over card is inside and centred on the canvas', lay.cardInside && lay.cardCentred, JSON.stringify(lay));
  await shot(page, 'tetris-gameover');
  // Keys other than Enter must not restart or change the finished game.
  await page.keyboard.press(' ');
  await page.keyboard.press('p');
  await page.keyboard.press('ArrowLeft');
  s2 = await state(page, tetrisSnap);
  check('game keys do nothing on the game-over card', s2.over && !s2.started && !s2.paused && s2.score === finalScore);
  await cardButton(page).click();
  s = await state(page, tetrisSnap);
  check('"Gioca ancora" starts a new game', s.started && !s.over && s.score === 0 && s.lines === 0 && s.level === 1 && s.blocks === 0);
  await page.waitForTimeout(100);
  hud = await texts(page);
  check('the record stays on the HUD in the new game', Number(hudAfter(hud, 'RECORD')) === finalScore, hudAfter(hud, 'RECORD'));
  // Space right after a click on the card button must act in the game (no focused button left).
  s = await state(page, tetrisSnap);
  await page.keyboard.press(' ');
  s2 = await state(page, tetrisSnap);
  check('Space after clicking the card button drops a piece', s2.blocks === s.blocks + 4 && s2.started);

  // Leaving in the middle of a game with a new record: is the record kept?
  await page.evaluate(() => localStorage.setItem('ra.hi.tetris', '0'));
  await page.keyboard.press('Escape');
  await openByTile(page, 'tetris');
  await page.keyboard.press('Enter');
  for (let i = 0; i < 6; i++) await tetrisPlayPiece(page);
  await page.waitForTimeout(80);
  snapT = await page.evaluate(withTexts(tetrisSnap));
  const mid = snapT.s;
  hud = snapT.texts;
  await page.keyboard.press('Escape');
  check('a record made in a game that is left with Esc is saved (HUD showed RECORD ' + hudAfter(hud, 'RECORD') + ')', mid.score > 0 && (await hiScore(page, 'tetris')) === mid.score, 'score ' + mid.score + ', saved ' + (await hiScore(page, 'tetris')));
  await openByTile(page, 'tetris');
  await page.waitForTimeout(120);
  check('that record is on the HUD when the game is opened again', Number(hudAfter(await texts(page), 'RECORD')) === mid.score, hudAfter(await texts(page), 'RECORD'));
  // ↓ still held when a piece locks: the next piece must not rush down at once.
  await page.keyboard.press('Enter');
  const b0 = (await state(page, tetrisSnap)).blocks;
  await page.keyboard.down('ArrowDown');
  await page.waitForFunction((n) => window.RA.current.debug.state.board.reduce((k, r) => k + r.filter((v) => v !== null).length, 0) > n, b0, { timeout: 6000 });
  const n0 = await state(page, tetrisSnap);
  await page.waitForTimeout(220);
  const n1 = await state(page, tetrisSnap);
  await page.waitForTimeout(600);
  const n2 = await state(page, tetrisSnap);
  await page.keyboard.up('ArrowDown');
  check('↓ still held after a lock: the new piece waits about 0.3 s before it drops fast', n1.cur.y - n0.cur.y <= 1 && (n2.cur.y - n1.cur.y >= 5 || n2.blocks > n1.blocks), 'rows in the first 0.22 s: ' + (n1.cur.y - n0.cur.y) + ', in the next 0.6 s: ' + (n2.cur.y - n1.cur.y));
  await page.keyboard.press('Escape');
  check.note(botRows + ' rows cleared by the bot with ' + pieces + ' pieces (best clear: ' + maxClear + ' rows at once), level 3 reached, final score ' + finalScore);
  check('no page errors', page.errors.length === 0, page.errors.join(' | '));
  await page.context().close();
}

// =====================================================================================
// SNAKE
// =====================================================================================
// In-page bot. It reads the state and sends key events to window. It never writes the state.
function snakeBotInstall() {
  const Sn = window.RA.modules.snake;
  const DIRS = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] };
  const OPP = { up: 'down', down: 'up', left: 'right', right: 'left' };
  const KEY = { up: 'ArrowUp', down: 'ArrowDown', left: 'ArrowLeft', right: 'ArrowRight' };
  let lastSeen = '';
  const B = (window.__snakeBot = { stepTimes: [], keys: 0, lastHead: '' });
  const area = function (sx, sy, blocked) {
    const seen = new Set([sx + ',' + sy]);
    const q = [[sx, sy]];
    for (let i = 0; i < q.length; i++) {
      for (const d of Object.keys(DIRS)) {
        const nx = q[i][0] + DIRS[d][0];
        const ny = q[i][1] + DIRS[d][1];
        const k = nx + ',' + ny;
        if (nx < 0 || ny < 0 || nx >= Sn.COLS || ny >= Sn.ROWS || blocked.has(k) || seen.has(k)) continue;
        seen.add(k);
        q.push([nx, ny]);
      }
    }
    return seen.size;
  };
  B.timer = setInterval(function () {
    const cur = window.RA.current;
    if (!cur || window.RA.currentId !== 'snake' || !cur.debug.started) return;
    const s = cur.debug.state;
    const head = s.snake[0];
    const hk = head.x + ',' + head.y;
    if (hk !== B.lastHead) { B.lastHead = hk; B.stepTimes.push(performance.now()); }
    if (!s.alive || s.queue.length) return;
    const sig = hk + ':' + s.dir + ':' + s.eaten;
    if (sig === lastSeen) return;
    lastSeen = sig;
    const body = new Set(s.snake.slice(0, -1).map((p) => p.x + ',' + p.y));
    // Shortest way to the fish.
    const queue = [[head.x, head.y, null]];
    const seen = new Set([hk]);
    let toFood = null;
    for (let i = 0; i < queue.length && !toFood; i++) {
      for (const d of Object.keys(DIRS)) {
        if (i === 0 && d === OPP[s.dir]) continue;
        const nx = queue[i][0] + DIRS[d][0];
        const ny = queue[i][1] + DIRS[d][1];
        const k = nx + ',' + ny;
        if (nx < 0 || ny < 0 || nx >= Sn.COLS || ny >= Sn.ROWS || body.has(k) || seen.has(k)) continue;
        seen.add(k);
        if (nx === s.food.x && ny === s.food.y) { toFood = queue[i][2] || d; break; }
        queue.push([nx, ny, queue[i][2] || d]);
      }
    }
    // Room that each move leaves.
    let roomy = null;
    let roomBest = -1;
    const rooms = {};
    Object.keys(DIRS).forEach(function (d) {
      if (d === OPP[s.dir]) return;
      const nx = head.x + DIRS[d][0];
      const ny = head.y + DIRS[d][1];
      if (nx < 0 || ny < 0 || nx >= Sn.COLS || ny >= Sn.ROWS || body.has(nx + ',' + ny)) return;
      const blocked = new Set(body);
      blocked.add(hk);
      rooms[d] = area(nx, ny, blocked);
      if (rooms[d] > roomBest) { roomBest = rooms[d]; roomy = d; }
    });
    let want = toFood && rooms[toFood] >= Math.min(s.snake.length + 2, roomBest) ? toFood : roomy;
    if (B.suicide) want = null;
    if (want && want !== s.dir) { B.keys += 1; window.__tap(KEY[want]); }
  }, 4);
}
const snakeSnap = () => {
  const s = window.RA.current.debug.state;
  return { head: Object.assign({}, s.snake[0]), len: s.snake.length, dir: s.dir, queue: s.queue.slice(), food: s.food && Object.assign({}, s.food), score: s.score, eaten: s.eaten, alive: s.alive, won: s.won, started: window.RA.current.debug.started,
    foodOnBody: !!s.food && s.snake.some((p) => p.x === s.food.x && p.y === s.food.y) };
};

async function scenarioSnake(browser) {
  const check = makeChecker('snake');
  const page = await newPage(browser);
  await page.evaluate(() => localStorage.clear());
  await openByTile(page, 'snake');
  let s = await state(page, snakeSnap);
  check('start card is shown and the snake waits', !s.started && /snake/i.test(await overlayText(page)) && (await cardButton(page).count()) === 1);
  await page.keyboard.press('ArrowUp');
  await page.waitForTimeout(400);
  let s2 = await state(page, snakeSnap);
  check('nothing moves before the start', s2.head.x === s.head.x && s2.head.y === s.head.y && s2.queue.length === 0);
  // Start with a click, then check the speed in real time and the turn rules with real keys.
  await cardButton(page).click();
  check('the button starts the game', await started(page));
  const t0 = Date.now();
  s = await state(page, snakeSnap);
  await page.waitForTimeout(1000);
  s2 = await state(page, snakeSnap);
  const steps = s2.head.x - s.head.x;
  check('first speed is about 6.7 steps per second (0.15 s per step)', steps >= 6 && steps <= 8, steps + ' steps in ' + (Date.now() - t0) + ' ms');
  // Reverse turn is ignored; quick double turn is kept in order.
  await page.keyboard.press('ArrowLeft');
  s = await state(page, snakeSnap);
  check('a reverse turn is ignored', s.queue.length === 0 && s.dir === 'right' && s.alive);
  await page.keyboard.press('ArrowUp');
  await page.keyboard.press('ArrowLeft');
  await page.waitForTimeout(450);
  s = await state(page, snakeSnap);
  check('two quick turns (↑ then ←) are both done', s.dir === 'left' && s.alive, s.dir + ' alive ' + s.alive);
  await page.keyboard.press('s'); // WASD also works
  await page.waitForTimeout(300);
  s = await state(page, snakeSnap);
  check('S turns down like ↓', s.dir === 'down' || !s.alive, s.dir);
  // Run into a wall: the game ends.
  await page.waitForFunction(() => !window.RA.current.debug.state.alive, null, { timeout: 8000 });
  s = await state(page, snakeSnap);
  let card = await overlayText(page);
  check('hitting the wall ends the game with a card', !s.alive && !s.started && !s.won && cardHas(card, 'Punti', s.score), card);
  await shot(page, 'snake-dead');

  // The bot plays with key events. Up to 6 games; we want one with 15 fish or more.
  await page.evaluate(snakeBotInstall);
  let best = { eaten: -1 };
  let games = 0;
  let hudOk = true;
  let foodOk = true;
  let scoreOk = true;
  for (let g = 0; g < 6 && best.eaten < 15; g++) {
    await page.keyboard.press('Enter');
    games += 1;
    s = await state(page, snakeSnap);
    if (g === 0) check('Enter on the game-over card starts a new game', s.started && s.alive && s.score === 0 && s.len === 3);
    let shotDone = false;
    for (;;) {
      await page.waitForTimeout(250);
      const snap = await page.evaluate(withTexts(snakeSnap));
      s = snap.s;
      if (s.foodOnBody) foodOk = false;
      // Score: 10 x (1 + fish/5) per fish.
      let exp = 0;
      for (let i = 0; i < s.eaten; i++) exp += 10 * (1 + Math.floor(i / 5));
      if (s.score !== exp) scoreOk = false;
      // The frame may be one step older than the state: accept the score before the last fish too.
      if (s.started && !hudShows(snap.texts, [s.score]) && !hudShows(snap.texts, [s.score - 10 * (1 + Math.floor((s.eaten - 1) / 5))])) hudOk = false;
      if (hudBad(snap.texts).length) hudOk = false;
      if (!shotDone && s.eaten >= 8) { shotDone = true; await shot(page, 'snake-play'); }
      if (!s.alive) break;
      if (s.eaten >= 18) { await page.evaluate(() => { window.__snakeBot.suicide = true; }); }
    }
    if (s.eaten > best.eaten) best = s;
  }
  check('the bot eats 15 fish or more in one game', best.eaten >= 15, 'best ' + best.eaten + ' in ' + games + ' games');
  check('the snake grows by one per fish', best.len === 3 + best.eaten, 'len ' + best.len + ', eaten ' + best.eaten);
  check('score follows the rule 10 x (1 + fish / 5)', scoreOk);
  check('the fish is never placed on the snake', foodOk);
  check('HUD shows the score of the state', hudOk);
  // Step speed late in the game: 0.15 - 0.003 x fish, never under 0.09 s.
  const times = await page.evaluate(() => window.__snakeBot.stepTimes.slice(-12));
  const gaps = times.slice(1).map((t, i) => t - times[i]).sort((a, b) => a - b);
  const median = gaps[Math.floor(gaps.length / 2)];
  const wantGap = Math.max(0.09, 0.15 - 0.003 * best.eaten) * 1000;
  if (s.eaten === best.eaten && gaps.length >= 8) check('late speed follows max(0.09, 0.15 - 0.003 x fish)', near(median, wantGap, 22), 'median gap ' + Math.round(median) + ' ms, expected ' + Math.round(wantGap) + ' ms at ' + best.eaten + ' fish');
  card = await overlayText(page);
  const hi = await hiScore(page, 'snake');
  check('game-over card shows the result', cardHas(card, 'Punti', s.score) && cardHas(card, '(Pesci|Bocconi)', s.eaten) && cardHas(card, 'Record', hi), card);
  check('high score is saved', hi >= best.score && hi > 0, 'hi ' + hi + ', best ' + best.score);
  await shot(page, 'snake-gameover');
  // The record is shown after leaving and coming back.
  await page.keyboard.press('Escape');
  await openByTile(page, 'snake');
  await page.waitForTimeout(100);
  check('the record is on the HUD after coming back', hudShows(await texts(page), [hi]), (await texts(page)).join(','));
  await page.evaluate(() => clearInterval(window.__snakeBot.timer));
  check.note('best game: ' + best.eaten + ' fish, ' + best.score + ' points (' + games + ' bot games); last step gaps ms: ' + times.slice(1).map((t, i) => Math.round(t - times[i])).join(','));
  check('no page errors', page.errors.length === 0, page.errors.join(' | '));
  await page.context().close();
}

// =====================================================================================
// RACCOON DEFENDER
// =====================================================================================
function invadersBotInstall() {
  const I = window.RA.modules.invaders;
  const held = { ArrowLeft: false, ArrowRight: false, ' ': false };
  const set = function (key, on) {
    if (held[key] === on) return;
    held[key] = on;
    window.__key(on ? 'keydown' : 'keyup', key);
  };
  const B = (window.__invBot = { mode: 'play', log: [] });
  B.timer = setInterval(function () {
    const cur = window.RA.current;
    if (!cur || window.RA.currentId !== 'invaders' || !cur.debug.started || B.mode === 'off') {
      set('ArrowLeft', false); set('ArrowRight', false); set(' ', false);
      return;
    }
    const s = cur.debug.state;
    let left = false;
    let right = false;
    let fire = true;
    if (B.mode === 'play') {
      let target = s.px;
      let bestD = Infinity;
      s.invaders.forEach(function (i) {
        if (!i.alive) return;
        const x = s.fx + i.col * 40;
        if (Math.abs(x - s.px) < bestD) { bestD = Math.abs(x - s.px); target = x; }
      });
      left = target < s.px - 3;
      right = target > s.px + 3;
      const bone = s.eBullets.find(function (b) { return Math.abs(b.x - s.px) < 30 && b.y > 330 && b.y < 570; });
      if (bone) {
        left = bone.x >= s.px ? s.px > 40 : s.px > I.W - 40;
        right = !left;
      }
    } else if (B.mode === 'lose') {
      // Walk under the lowest bone, do not shoot.
      fire = false;
      let low = null;
      s.eBullets.forEach(function (b) { if (!low || b.y > low.y) low = b; });
      if (low) { left = low.x < s.px - 3; right = low.x > s.px + 3; }
    }
    set('ArrowLeft', left); set('ArrowRight', right); set(' ', fire);
  }, 8);
}
const invSnap = () => {
  const s = window.RA.current.debug.state;
  return { px: s.px, pBullets: s.pBullets.map((b) => ({ x: b.x, y: b.y })), eBullets: s.eBullets.length, alive: s.invaders.filter((i) => i.alive).length,
    fx: s.fx, fy: s.fy, dir: s.dir, shieldCells: s.shields.reduce((n, b) => n + b.filter((c) => c.alive).length, 0), score: s.score, lives: s.lives, wave: s.wave,
    over: s.over, invuln: s.invuln, started: window.RA.current.debug.started };
};

async function scenarioInvaders(browser) {
  const check = makeChecker('invaders');
  const page = await newPage(browser);
  await page.evaluate(() => localStorage.clear());
  await openByTile(page, 'invaders');
  let s = await state(page, invSnap);
  check('start card is shown and the game waits', !s.started && /defender/i.test(await overlayText(page)) && (await cardButton(page).count()) === 1);
  await page.keyboard.down('ArrowLeft');
  await page.keyboard.press(' ');
  await page.waitForTimeout(300);
  await page.keyboard.up('ArrowLeft');
  let s2 = await state(page, invSnap);
  check('keys do nothing while the start card is shown', s2.px === s.px && s2.pBullets.length === 0 && s2.fx === s.fx);
  await page.keyboard.press('Enter');
  check('Enter starts the game', await started(page));

  // Real-time speed: 240 px per second.
  s = await state(page, invSnap);
  const t0 = Date.now();
  await page.keyboard.down('ArrowLeft');
  await page.waitForTimeout(500);
  s2 = await state(page, invSnap);
  const dt = (Date.now() - t0) / 1000;
  await page.keyboard.up('ArrowLeft');
  check('the raccoon moves left at about 240 px per second', near(s.px - s2.px, 240 * dt, 30), (s.px - s2.px).toFixed(1) + ' px in ' + dt.toFixed(3) + ' s');
  await page.waitForTimeout(120);
  const stopped = await state(page, invSnap);
  await page.waitForTimeout(150);
  check('it stops when the key is released', (await state(page, invSnap)).px === stopped.px);
  // The left wall stops the raccoon; D moves right.
  await page.keyboard.down('a');
  await page.waitForTimeout(1300);
  await page.keyboard.up('a');
  s = await state(page, invSnap);
  check('the raccoon stops at the left wall (A key)', s.px === 20, s.px);
  // Firing: one bullet per 0.35 s, never more than 2 in the air, bullets fly up.
  await page.keyboard.down(' ');
  await page.waitForTimeout(60);
  s = await state(page, invSnap);
  check('Space fires a bullet', s.pBullets.length === 1, JSON.stringify(s.pBullets));
  let maxBullets = 0;
  for (let i = 0; i < 12; i++) { await page.waitForTimeout(80); maxBullets = Math.max(maxBullets, (await state(page, invSnap)).pBullets.length); }
  await page.keyboard.up(' ');
  check('held Space keeps firing, never more than 2 bullets', maxBullets === 2, 'max ' + maxBullets);
  // A tap shorter than one frame (key down and up at once) must still fire.
  let tapsFired = 0;
  for (let i = 0; i < 6; i++) {
    await page.waitForFunction(() => window.RA.current.debug.state.pBullets.length === 0 && window.RA.current.debug.state.cooldown <= 0, null, { timeout: 5000 });
    await page.keyboard.press(' ');
    await page.waitForTimeout(60);
    if ((await state(page, invSnap)).pBullets.length === 1) tapsFired += 1;
  }
  check('a Space tap shorter than a frame fires one bullet', tapsFired === 6, tapsFired + ' of 6');
  // Shields: a shot from under a shield breaks one cell of it. The first shield is at x 50-98.
  await page.waitForFunction(() => window.RA.current.debug.state.pBullets.length === 0, null, { timeout: 4000 });
  await page.keyboard.down('ArrowRight');
  await page.waitForFunction(() => window.RA.current.debug.state.px >= 70, null, { timeout: 3000 });
  await page.keyboard.up('ArrowRight');
  s = await state(page, invSnap);
  await page.keyboard.press(' ', { delay: 60 }); // fire is read once per frame: a tap must last a frame
  await page.waitForTimeout(100);
  await page.waitForFunction(() => window.RA.current.debug.state.pBullets.length === 0, null, { timeout: 3000 });
  s2 = await state(page, invSnap);
  check('a shot from under a shield breaks one shield cell', s2.shieldCells === s.shieldCells - 1, s.shieldCells + ' -> ' + s2.shieldCells);
  let hud = await texts(page);
  check('HUD shows score, wave and record', hudShows(hud, [s2.score, 1]) && hasText(hud, /ondata\s*1/i) && hasText(hud, /record/i), hud.filter((t) => t.length > 2).join(','));
  await shot(page, 'invaders-start');

  // The bot plays: clear wave 1 (up to 3 games).
  await page.evaluate(invadersBotInstall);
  let reachedWave2 = false;
  let games = 0;
  let livesSeen = new Set();
  let formationMoved = false;
  const fyStart = await page.evaluate(() => window.RA.modules.invaders.newGame(1).fy);
  let hudOk = true;
  let hits = 0;
  let safeAfterHit = 0;
  let prevLives = null;
  for (let g = 0; g < 3 && !reachedWave2; g++) {
    games += 1;
    if (g > 0) await page.keyboard.press('Enter');
    let shotDone = false;
    const t1 = Date.now();
    for (;;) {
      await page.waitForTimeout(300);
      const snap = await page.evaluate(withTexts(invSnap));
      s = snap.s;
      if (prevLives !== null && s.lives < prevLives && !s.over) { hits += 1; if (s.invuln > 0) safeAfterHit += 1; }
      prevLives = s.over ? null : s.lives;
      livesSeen.add(s.lives);
      if (s.fy > fyStart) formationMoved = true;
      if (s.started && (!hasText(snap.texts, new RegExp('ondata\\s*' + s.wave, 'i')) || hudBad(snap.texts).length)) hudOk = false;
      if (!shotDone && s.alive <= 25) { shotDone = true; await shot(page, 'invaders-play'); }
      if (s.wave >= 2) { reachedWave2 = true; break; }
      if (s.over) break;
      if (Date.now() - t1 > 200000) break;
    }
  }
  check('the bot clears wave 1', reachedWave2, 'games ' + games + ', last: ' + JSON.stringify({ alive: s.alive, lives: s.lives, wave: s.wave }));
  check('the formation moves down over time', formationMoved);
  check('HUD shows the wave of the state, no broken text', hudOk);
  if (reachedWave2) {
    const w = await state(page, invSnap);
    check('wave 2 starts with 45 new invaders and a 100 point bonus', w.alive >= 43 && w.wave === 2 && w.score >= 45 * 10 + 100, JSON.stringify({ alive: w.alive, score: w.score }));
    await shot(page, 'invaders-wave2');
  }
  // Now lose on purpose: walk under the bones.
  await page.evaluate(() => { window.__invBot.mode = 'lose'; });
  const t2 = Date.now();
  for (;;) {
    await page.waitForTimeout(100);
    s = await state(page, invSnap);
    if (prevLives !== null && s.lives < prevLives && !s.over) { hits += 1; if (s.invuln > 0) safeAfterHit += 1; }
    prevLives = s.over ? null : s.lives;
    if (s.over || Date.now() - t2 > 150000) break;
  }
  check('bones take lives until the game ends', s.over && !s.started && (s.lives === 0 || s.alive > 0), JSON.stringify({ lives: s.lives, over: s.over }));
  if (hits) check('after each hit the raccoon is safe for a moment', safeAfterHit === hits, safeAfterHit + ' of ' + hits);
  const card = await overlayText(page);
  const hi = await hiScore(page, 'invaders');
  check('game-over card shows score, wave and record', cardHas(card, 'Punti', s.score) && cardHas(card, 'Ondata', s.wave) && cardHas(card, 'Record', hi), card);
  check('high score is saved', hi === s.score && hi > 0, 'hi ' + hi + ' score ' + s.score);
  await shot(page, 'invaders-gameover');
  const finalScore = s.score;
  const finalWave = s.wave;
  await page.evaluate(() => { window.__invBot.mode = 'off'; });
  await page.waitForTimeout(50);
  await cardButton(page).click();
  s = await state(page, invSnap);
  check('"Gioca ancora" starts a new game with 3 lives, wave 1 and whole shields', s.started && s.lives === 3 && s.wave === 1 && s.score === 0 && s.alive === 45 && s.shieldCells === 80, JSON.stringify(s));
  await page.waitForTimeout(100);
  check('the record is on the HUD of the new game', hudShows(await texts(page), [hi]), (await texts(page)).join(','));
  await page.evaluate(() => clearInterval(window.__invBot.timer));
  check.note('wave reached ' + finalWave + ', score ' + finalScore + ' (' + games + ' bot game' + (games > 1 ? 's' : '') + '), lives seen ' + Array.from(livesSeen).sort().join('/'));
  check('no page errors', page.errors.length === 0, page.errors.join(' | '));
  await page.context().close();
}

// =====================================================================================
// RACCOON-MAN
// =====================================================================================
function pacBotInstall() {
  const P = window.RA.modules.pacman;
  const KEY = { up: 'ArrowUp', down: 'ArrowDown', left: 'ArrowLeft', right: 'ArrowRight' };
  const names = ['up', 'left', 'down', 'right'];
  const B = (window.__pacBot = { mode: 'play', ghostsEaten: 0, deaths: 0, powers: 0, wraps: 0, maxScared: 0, lastLives: null, lastX: null, target: null, log: [] });
  const pacBot = function (s) {
    const pac = s.pac;
    const from = pac.moving ? P.nextTile(pac.x, pac.y, pac.dir) : { x: pac.x, y: pac.y };
    const maps = s.ghosts.filter((g) => !g.eaten).map((g) => P.distanceMap(s.grid, g.x, g.y));
    const nearG = (x, y) => maps.reduce((m, d) => Math.min(m, d[y][x]), Infinity);
    const hunted = s.scared <= 1;
    if (hunted && pac.moving && nearG(from.x, from.y) <= 1) return { up: 'down', down: 'up', left: 'right', right: 'left' }[pac.dir];
    // While the chasers are afraid (and there is time left), go and catch the nearest one.
    const prey = s.scared > 2.5 && !B.target ? s.ghosts.filter((g) => !g.eaten && g.wait <= 0).map((g) => (g.moving ? P.nextTile(g.x, g.y, g.dir) : { x: g.x, y: g.y })) : [];
    const queue = [[from.x, from.y, null]];
    const seen = new Set([from.x + ',' + from.y]);
    for (let i = 0; i < queue.length; i++) {
      const x = queue[i][0];
      const y = queue[i][1];
      const first = queue[i][2];
      const goal = B.target ? (x === B.target.x && y === B.target.y) : prey.length ? prey.some((t) => t.x === x && t.y === y) : (s.grid[y][x] === '.' || s.grid[y][x] === 'o');
      if (i > 0 && goal) return first;
      for (const d of names) {
        if (!P.canMove(s.grid, x, y, d)) continue;
        const n = P.nextTile(x, y, d);
        const k = n.x + ',' + n.y;
        if (seen.has(k) || (hunted && nearG(n.x, n.y) <= 3)) continue;
        seen.add(k);
        queue.push([n.x, n.y, first || d]);
      }
    }
    let want = null;
    let bestD = -1;
    names.forEach(function (d) {
      if (!P.canMove(s.grid, from.x, from.y, d)) return;
      const n = P.nextTile(from.x, from.y, d);
      if (nearG(n.x, n.y) > bestD) { bestD = nearG(n.x, n.y); want = d; }
    });
    return want;
  };
  B.timer = setInterval(function () {
    const cur = window.RA.current;
    if (!cur || window.RA.currentId !== 'pacman' || !cur.debug.started) return;
    const s = cur.debug.state;
    // Observations.
    if (B.lastLives !== null && s.lives < B.lastLives) B.deaths += 1;
    B.lastLives = s.lives;
    if (B.lastX !== null && Math.abs(s.pac.x - B.lastX) > 5 && s.pac.y === 7 && B.lastY === 7) B.wraps += 1;
    B.lastX = s.pac.x;
    B.lastY = s.pac.y;
    B.maxScared = Math.max(B.maxScared, s.scared);
    const eatenNow = s.ghosts.filter((g) => g.eaten).length;
    if (eatenNow > (B.eatenPrev || 0)) B.ghostsEaten += eatenNow - (B.eatenPrev || 0);
    B.eatenPrev = eatenNow;
    if (B.mode !== 'play' || s.over) return;
    let want;
    if (B.target && s.pac.x === B.target.x && s.pac.y === B.target.y && !s.pac.moving) want = B.targetThen;
    else want = pacBot(s);
    if (want && want !== s.pac.want) window.__tap(KEY[want]);
  }, 8);
}
const pacSnap = () => {
  const s = window.RA.current.debug.state;
  return { pac: Object.assign({}, s.pac), ghosts: s.ghosts.map((g) => ({ x: g.x, y: g.y, eaten: g.eaten, wait: g.wait, moving: g.moving })), score: s.score, lives: s.lives, level: s.level,
    acornsLeft: s.acornsLeft, scared: s.scared, freeze: s.freeze, over: s.over, won: s.won, start: s.start, house: s.house, started: window.RA.current.debug.started,
    counted: s.grid.reduce((n, r) => n + r.filter((c) => c === '.' || c === 'o').length, 0) };
};

async function scenarioPacman(browser) {
  const check = makeChecker('pacman');
  const page = await newPage(browser);
  await page.evaluate(() => localStorage.clear());
  await openByTile(page, 'pacman');
  let s = await state(page, pacSnap);
  check('start card is shown and the game waits', !s.started && /raccoon-man/i.test(await overlayText(page)) && (await cardButton(page).count()) === 1);
  await page.keyboard.press('ArrowLeft');
  await page.waitForTimeout(300);
  let s2 = await state(page, pacSnap);
  check('keys do nothing while the start card is shown', s2.pac.want === null && s2.pac.x === s.pac.x && !s2.pac.moving && s2.freeze === s.freeze);
  await page.keyboard.press('Enter');
  check('Enter starts the game', await started(page));
  await page.waitForTimeout(100);
  check('"Pronti!" is drawn during the start pause', hasText(await texts(page), /pronti/i));
  await shot(page, 'pacman-pronti');
  s = await state(page, pacSnap);
  check('the raccoon is on the start tile with 3 lives', s.pac.x === s.start.x && s.pac.y === s.start.y && s.lives === 3 && s.level === 1);
  check('3 chasers wait in the house on level 1', s.ghosts.length === 3 && s.ghosts.every((g) => Math.abs(g.x - s.house.x) <= 1 && Math.abs(g.y - s.house.y) <= 1));
  // The raccoon waits for a key, then walks at about 6.25 tiles per second.
  await page.waitForFunction(() => window.RA.current.debug.state.freeze <= 0, null, { timeout: 4000 });
  await page.waitForTimeout(200);
  s = await state(page, pacSnap);
  check('the raccoon stands still until a key is pressed', s.pac.x === s.start.x && !s.pac.moving);
  check('"Pronti!" goes away after the pause', !hasText(await texts(page), /pronti/i));

  // The bot plays level 1. First it walks to the left end of the tunnel and goes through it.
  await page.evaluate(pacBotInstall);
  await page.evaluate(() => { const B = window.__pacBot; B.target = { x: 0, y: 7 }; B.targetThen = 'left'; });
  let wrapped = false;
  try {
    await page.waitForFunction(() => window.__pacBot.wraps > 0 || window.RA.current.debug.state.lives < 3, null, { timeout: 25000 });
    wrapped = await page.evaluate(() => window.__pacBot.wraps > 0);
  } catch (e) { /* reported below */ }
  s = await state(page, pacSnap);
  check('the tunnel leads from the left edge to the right edge', wrapped, JSON.stringify(s.pac));
  await shot(page, 'pacman-after-tunnel');
  await page.evaluate(() => { window.__pacBot.target = null; });

  let games = 1;
  let wonLevel = false;
  let hudOk = true;
  let acornOk = true;
  let sawPronti = false;
  let shotScared = false;
  const t1 = Date.now();
  for (;;) {
    await page.waitForTimeout(200);
    const snap = await page.evaluate(withTexts(pacSnap));
    s = snap.s;
    if (s.acornsLeft !== s.counted) acornOk = false;
    if (s.started) {
      // The frame may be one step older than the state: accept the score before the last acorn too.
      const okText = hasText(snap.texts, new RegExp('liv(ello)?\\.?\\s*' + s.level + '$', 'i')) && (hudShows(snap.texts, [s.score]) || hudShows(snap.texts, [s.score - 10]) || hudShows(snap.texts, [s.score - 50]));
      if (!okText || hudBad(snap.texts).length) hudOk = false;
      if (hasText(snap.texts, /pronti/i) && s.lives < 3) sawPronti = true;
    }
    if (!shotScared && s.scared > 3) { shotScared = true; await shot(page, 'pacman-scared'); }
    if (s.over && s.won) { wonLevel = true; break; }
    if (s.over) {
      if (games >= 3) break;
      games += 1;
      await page.keyboard.press('Enter');
      await page.evaluate(() => { window.__pacBot.lastLives = null; });
    }
    if (Date.now() - t1 > 400000) break;
  }
  const bot = await page.evaluate(() => Object.assign({}, window.__pacBot, { timer: 0 }));
  check('the bot finishes level 1', wonLevel, 'games ' + games + ', acorns left ' + s.acornsLeft + ', lives ' + s.lives);
  check('the acorn counter always matches the maze', acornOk);
  check('HUD shows the score and level of the state', hudOk);
  check('a pizza scares the chasers for 7 seconds', bot.maxScared > 6 && bot.maxScared <= 7, 'max scared ' + bot.maxScared);
  check.note('level 1: score ' + s.score + ', lives left ' + s.lives + ', chasers caught ' + bot.ghostsEaten + ', deaths ' + bot.deaths + ', tunnel passes ' + bot.wraps + ', games ' + games);
  if (wonLevel) {
    const card = await overlayText(page);
    const hi = await hiScore(page, 'pacman');
    check('level card shows the score and offers level 2', cardHas(card, 'Punti', s.score) && /livello 2/i.test(await cardButton(page).innerText()), card);
    check('high score is saved at the end of the level', hi === s.score, 'hi ' + hi);
    await shot(page, 'pacman-level-done');
    const scoreBefore = s.score;
    const livesBefore = s.lives;
    await page.keyboard.press('Enter');
    s = await state(page, pacSnap);
    check('level 2 keeps score and lives, new maze full of acorns', s.started && s.level === 2 && s.score === scoreBefore && s.lives === livesBefore && s.acornsLeft > 100 && !s.over, JSON.stringify({ level: s.level, score: s.score, lives: s.lives }));
    await page.waitForTimeout(150);
    check('"Pronti!" is drawn at the start of level 2', hasText(await texts(page), /pronti/i));
  }

  // Catch a scared chaser (the bot does it while it plays; play on until it happened once).
  for (const tEnd = Date.now() + 120000; Date.now() < tEnd;) {
    if (await page.evaluate(() => window.__pacBot.ghostsEaten > 0)) break;
    if (!(await started(page))) { await page.keyboard.press('Enter'); await page.evaluate(() => { window.__pacBot.lastLives = null; }); }
    await page.waitForTimeout(250);
  }
  const eaten = await page.evaluate(() => window.__pacBot.ghostsEaten);
  check('the raccoon catches a scared chaser at least once', eaten > 0, 'caught ' + eaten);

  // Death: stop the bot and hold a key. A chaser arrives; the positions are reset.
  if ((await state(page, pacSnap)).over) await page.keyboard.press('Enter');
  await page.evaluate(() => { window.__pacBot.mode = 'idle'; });
  s = await state(page, pacSnap);
  const livesBefore = s.lives;
  await page.keyboard.down('ArrowLeft');
  const t3 = Date.now();
  let died = null;
  while (Date.now() - t3 < 120000) {
    for (let i = 0; i < 3; i++) await page.keyboard.down('ArrowLeft'); // what the OS sends for a held key
    await page.waitForTimeout(30);
    const snap = await page.evaluate(withTexts(pacSnap));
    if (snap.s.lives < livesBefore || snap.s.over) { died = snap; break; }
  }
  check('a chaser catches the raccoon', !!died);
  if (died && !died.s.over) {
    s = died.s;
    check('after a catch: one life less, raccoon on the start tile, chasers in the house, start pause', s.lives === livesBefore - 1 && s.pac.x === s.start.x && s.pac.y === s.start.y && s.freeze > 0 && s.scared === 0 && s.ghosts.every((g) => Math.abs(g.x - s.house.x) <= 1 && Math.abs(g.y - s.house.y) <= 1), JSON.stringify(s.pac));
    await page.waitForTimeout(60);
    check('"Pronti!" is drawn after a catch', hasText(await texts(page), /pronti/i));
    await shot(page, 'pacman-after-death');
    // The ← key is still held (the OS keeps sending repeat events).
    await page.waitForFunction(() => window.RA.current.debug.state.freeze <= 0, null, { timeout: 4000 });
    for (let i = 0; i < 10; i++) { await page.keyboard.down('ArrowLeft'); await page.waitForTimeout(30); }
    s2 = await state(page, pacSnap);
    const canLeft = await page.evaluate(() => { const st = window.RA.current.debug.state; return window.RA.modules.pacman.canMove(st.grid, st.start.x, st.start.y, 'left'); });
    check('a direction key that is held during the catch still moves the raccoon after "Pronti!"', !canLeft || s2.pac.x !== s2.start.x || s2.pac.moving || s2.lives < s.lives, 'want=' + s2.pac.want + ' moving=' + s2.pac.moving);
  }
  await page.keyboard.up('ArrowLeft');
  // Lose every life: game over card, restart from level 1.
  try { await page.waitForFunction(() => window.RA.current.debug.state.over, null, { timeout: 150000 }); } catch (e) { /* below */ }
  s = await state(page, pacSnap);
  const card = await overlayText(page);
  const hi = await hiScore(page, 'pacman');
  check('the game ends when the lives are finished', s.over && !s.won && s.lives === 0 && !s.started, JSON.stringify({ over: s.over, lives: s.lives }));
  check('game-over card shows score, level and record', cardHas(card, 'Punti', s.score) && cardHas(card, 'Livello', s.level) && cardHas(card, 'Record', hi), card);
  check('high score is saved', hi >= s.score && hi > 0);
  await shot(page, 'pacman-gameover');
  await cardButton(page).click();
  s = await state(page, pacSnap);
  check('"Gioca ancora" starts again from level 1 with 3 lives and 0 points', s.started && s.level === 1 && s.lives === 3 && s.score === 0 && s.ghosts.length === 3);
  await page.waitForTimeout(150);
  check('the record is shown on the HUD during play', hi > 3 && hasText(await texts(page), new RegExp('record\\D*0*' + hi + '$', 'i')), 'record ' + hi + ', HUD: ' + (await texts(page)).join(' | '));
  await page.evaluate(() => clearInterval(window.__pacBot.timer));
  check('no page errors', page.errors.length === 0, page.errors.join(' | '));
  await page.context().close();
}

// =====================================================================================
// BOLLE PROCIONI
// =====================================================================================
// Finds the best angle by playing the shot on a copy of the state. The real state is not touched.
function bubblesPlan() {
  const Bu = window.RA.modules.bubbles;
  const s = window.RA.current.debug.state;
  if (s.over || s.moving) return null;
  const clone = function () {
    const c = Object.assign({}, s);
    c.grid = new Map(s.grid);
    c.rnd = function () { return 0.5; };
    c.events = [];
    c.gone = [];
    c.moving = null;
    c.rowsLeft = 0;
    return c;
  };
  let best = { gain: -Infinity, angle: 0 };
  for (let a = -1.3; a <= 1.3001; a += 0.025) {
    const c = clone();
    c.angle = a;
    Bu.fire(c);
    let t = 0;
    while (c.moving && t++ < 600) Bu.update(c, 1 / 60);
    let gain = (s.grid.size + 1 - c.grid.size) * 10;
    let low = 0;
    if (gain === 0) {
      c.grid.forEach(function (kind, k) {
        if (s.grid.has(k)) return;
        const cell = k.split(',').map(Number);
        low = cell[0] - c.base;
        Bu.neighbours(cell[0], cell[1], c.base).forEach(function (n) { if (c.grid.get(n[0] + ',' + n[1]) === kind) gain += 1; });
      });
      gain -= low * 0.2;
    }
    if (c.over && !c.won) gain -= 1000;
    // Prefer shots that still pop when the angle is a little off.
    if (gain > best.gain + 1e-9) best = { gain: gain, angle: a, popped: s.grid.size + 1 - c.grid.size, score: c.score, size: c.grid.size };
  }
  return best;
}
const bubSnap = () => {
  const s = window.RA.current.debug.state;
  const Bu = window.RA.modules.bubbles;
  let low = 0;
  s.grid.forEach((v, k) => { const c = k.split(',').map(Number); low = Math.max(low, Bu.posOf(c[0], c[1], s.base).y); });
  return { size: s.grid.size, base: s.base, angle: s.angle, moving: !!s.moving, cur: s.cur, next: s.next, shots: s.shots, rowsLeft: s.rowsLeft, score: s.score, level: s.level, kinds: s.kinds,
    over: s.over, won: s.won, lowestY: low, started: window.RA.current.debug.started, present: Array.from(new Set(s.grid.values())) };
};
// Page coordinates of a logical canvas point.
async function canvasPoint(page, lx, ly) {
  return page.evaluate((p) => {
    const r = document.querySelector('.arcade-stage canvas').getBoundingClientRect();
    return { x: r.left + (p[0] / 360) * r.width, y: r.top + (p[1] / 610) * r.height };
  }, [lx, ly]);
}
// Moves the mouse to a whole pixel on the aim line of the given angle (inside the canvas).
// Returns the angle that this pixel means, computed here from the canvas rectangle.
async function aimMouse(page, angle) {
  const d = Math.min(200, 165 / Math.max(0.001, Math.abs(Math.sin(angle))));
  const p = await canvasPoint(page, 180 + Math.sin(angle) * d, 548 - Math.cos(angle) * d);
  const px = Math.round(p.x);
  const py = Math.round(p.y);
  await page.mouse.move(px, py);
  return page.evaluate((q) => {
    const r = document.querySelector('.arcade-stage canvas').getBoundingClientRect();
    const x = ((q[0] - r.left) / r.width) * 360;
    const y = ((q[1] - r.top) / r.height) * 610;
    return Math.max(-1.35, Math.min(1.35, Math.atan2(x - 180, Math.max(10, 548 - y))));
  }, [px, py]);
}
async function waitLanded(page) {
  await page.waitForFunction(() => { const c = window.RA.current; return !c.debug.state.moving; }, null, { timeout: 5000 });
}

async function scenarioBubbles(browser) {
  const check = makeChecker('bubbles');
  const page = await newPage(browser);
  await page.evaluate(() => localStorage.clear());
  await openByTile(page, 'bubbles');
  let s = await state(page, bubSnap);
  check('start card is shown and the game waits', !s.started && /bolle/i.test(await overlayText(page)) && (await cardButton(page).count()) === 1);
  await page.keyboard.press(' ');
  await page.keyboard.press('ArrowUp');
  await page.waitForTimeout(200);
  check('keys do not shoot while the start card is shown', !(await state(page, bubSnap)).moving && (await state(page, bubSnap)).shots === 0);
  await cardButton(page).click();
  check('the button starts the game', await started(page));
  s = await state(page, bubSnap);
  check('level 1 starts with 5 rows, 4 kinds and 5 rows to come', s.size === 48 && s.kinds === 4 && s.rowsLeft === 5 && s.level === 1, JSON.stringify(s));

  // Mouse aim: the angle follows the pointer exactly.
  let aimOk = true;
  for (const a of [-1.2, -0.6, 0, 0.45, 1.1]) {
    const want = await aimMouse(page, a);
    const got = (await state(page, bubSnap)).angle;
    if (!near(got, want, 1e-6) || !near(got, a, 0.02)) { aimOk = false; check('mouse aim gives the angle of the pointer', false, 'want ' + want + ' got ' + got); }
  }
  if (aimOk) check('mouse aim gives the angle of the pointer', true);
  // The aim never goes past the limit, also with the pointer under the raccoon.
  let p = await canvasPoint(page, 5, 600);
  await page.mouse.move(p.x, p.y);
  check('the aim stops at the limit angle', near((await state(page, bubSnap)).angle, -1.35, 1e-9));
  // Keyboard aim: slow (0.45 rad/s) for the first 0.25 s of a press, then 1.3 rad/s.
  p = await canvasPoint(page, 180, 300);
  await page.mouse.move(p.x, p.y);
  const a0 = (await state(page, bubSnap)).angle;
  const t0 = Date.now();
  await page.keyboard.down('ArrowRight');
  await page.waitForTimeout(500);
  const a1 = (await state(page, bubSnap)).angle;
  const dt = (Date.now() - t0) / 1000;
  await page.keyboard.up('ArrowRight');
  const wantTurn = 0.45 * Math.min(dt, 0.25) + 1.3 * Math.max(0, dt - 0.25);
  check('held → turns the aim slowly at first (0.45 rad/s), then at 1.3 rad/s', near(a1 - a0, wantTurn, 0.07), (a1 - a0).toFixed(3) + ' rad in ' + dt.toFixed(3) + ' s, expected ' + wantTurn.toFixed(3));
  const a2 = (await state(page, bubSnap)).angle;
  await page.keyboard.press('ArrowLeft'); // key down and up at once
  await page.waitForTimeout(60);
  const a3 = (await state(page, bubSnap)).angle;
  check('a very short tap on ← turns the aim by one small step', a2 - a3 > 0.004 && a2 - a3 < 0.03, (a2 - a3).toFixed(4) + ' rad');
  await shot(page, 'bubbles-aim');

  // The mouse works on the whole game area, with the main button only.
  const rectC = await page.evaluate(() => { const r = document.querySelector('.arcade-stage canvas').getBoundingClientRect(); return [r.left, r.top, r.width, r.height]; });
  await page.mouse.move(Math.round(rectC[0] + rectC[2] / 2), Math.round(rectC[1] + rectC[3] * 0.5));
  await page.mouse.down({ button: 'right' });
  await page.mouse.up({ button: 'right' });
  await page.mouse.down({ button: 'middle' });
  await page.mouse.up({ button: 'middle' });
  check('the right and middle mouse buttons do not fire', !(await state(page, bubSnap)).moving && (await state(page, bubSnap)).shots === 0);
  const m0 = await page.evaluate(() => window.RA.audio.isMuted());
  await page.locator('#mute').click();
  await page.locator('#mute').click();
  check('a click on a top-bar button does not fire', !(await state(page, bubSnap)).moving && (await state(page, bubSnap)).shots === 0 && (await page.evaluate(() => window.RA.audio.isMuted())) === m0);
  const outX = Math.round(rectC[0] - 40);
  const outY = Math.round(rectC[1] + rectC[3] * 0.6);
  await page.mouse.move(outX, outY);
  const wantOut = await page.evaluate((q) => {
    const r = document.querySelector('.arcade-stage canvas').getBoundingClientRect();
    return Math.max(-1.35, Math.min(1.35, Math.atan2(((q[0] - r.left) / r.width) * 360 - 180, Math.max(10, 548 - ((q[1] - r.top) / r.height) * 610))));
  }, [outX, outY]);
  check('the mouse aims also from outside the canvas', near((await state(page, bubSnap)).angle, wantOut, 1e-6), 'want ' + wantOut + ' got ' + (await state(page, bubSnap)).angle);
  await page.mouse.down();
  await page.mouse.up();
  check('a click outside the canvas (in the game area) fires', (await state(page, bubSnap)).moving || (await state(page, bubSnap)).shots === 1);
  await waitLanded(page);
  // Paused: the mouse and the Space bar must do nothing.
  await page.keyboard.press('p');
  let st = await standsStill(page, 300);
  check('P pauses Bolle and shows "PAUSA"', st.still && st.shown);
  await aimMouse(page, 0.8);
  await page.mouse.down();
  await page.mouse.up();
  const afterMouse = await page.evaluate(frozenSig);
  check('the mouse does not aim or fire while paused', afterMouse === st.sig, st.sig + ' / ' + afterMouse);
  await page.keyboard.press(' ', { delay: 40 });
  await page.keyboard.press('ArrowLeft', { delay: 60 });
  const afterKeys = await page.evaluate(frozenSig);
  check.known('P1', 'Space and the arrows do nothing while Bolle is paused', afterKeys === afterMouse, afterMouse + ' / ' + afterKeys);
  await page.keyboard.press('p');
  await page.waitForTimeout(120);
  check('P resumes Bolle', !(await pausedNow(page)));
  await waitLanded(page);

  // Play: odd shots with the mouse (move + click), even shots with the keyboard (← → + Space).
  let shots = 0;
  let mouseShots = 0;
  let keyShots = 0;
  let pops = 0;
  let falls = 0;
  let rowsAdded = 0;
  let predicted = 0;
  let predictedOk = 0;
  let hudOk = true;
  let countdownShown = true;
  let kindOk = true;
  let level2 = null;
  let scoreBeforeLast = 0;
  let lastGain = 0;
  let lostOnce = false;
  let games = 1;
  let shotDone = false;
  const t1 = Date.now();
  while (Date.now() - t1 < 330000) {
    s = await state(page, bubSnap);
    if (s.over) {
      if (s.won) break;
      lostOnce = true;
      const card = await overlayText(page);
      check('loss card shows score and record', cardHas(card, 'Punti', s.score) && cardHas(card, 'Record', await hiScore(page, 'bubbles')), card);
      await shot(page, 'bubbles-lost');
      if (games >= 3) break;
      games += 1;
      await page.keyboard.press('Enter');
      continue;
    }
    const plan = await state(page, bubblesPlan);
    if (!plan) { await page.waitForTimeout(50); continue; }
    const before = s;
    const useMouse = shots % 2 === 0;
    if (useMouse) {
      const want = await aimMouse(page, plan.angle);
      const got = (await state(page, bubSnap)).angle;
      if (!near(got, want, 1e-6) || !near(got, plan.angle, 0.02)) aimOk = false;
      await page.mouse.down();
      await page.mouse.up();
      mouseShots += 1;
    } else {
      const key = plan.angle < before.angle ? 'ArrowLeft' : 'ArrowRight';
      if (Math.abs(plan.angle - before.angle) > 0.012) {
        await page.keyboard.down(key);
        await page.waitForFunction((arg) => {
          const a = window.RA.current.debug.state.angle;
          return arg.key === 'ArrowLeft' ? a <= arg.target + 0.011 : a >= arg.target - 0.011;
        }, { key: key, target: plan.angle }, { timeout: 5000, polling: 'raf' });
        await page.keyboard.up(key);
      }
      await page.keyboard.press(' ');
      keyShots += 1;
    }
    const flying = await state(page, bubSnap);
    if (!flying.moving && flying.shots === before.shots) { check('a click or Space fires the bubble', false, JSON.stringify(flying)); break; }
    const firedAngle = flying.angle;
    await waitLanded(page);
    shots += 1;
    const snap = await page.evaluate(withTexts(bubSnap));
    const after = snap.s;
    const rowCame = after.base < before.base;
    if (rowCame) rowsAdded += 1;
    // The 100 points for a finished level are added to the score with the last shot.
    const gained = after.score - before.score - (after.won ? 100 : 0);
    if (gained > 0) pops += 1;
    // Bubbles that fell: score = 10 per popped + 20 per fallen.
    const removed = before.size + 1 + (rowCame ? (after.base % 2 === 0 ? 10 : 9) : 0) - after.size;
    if (gained > 0 && gained > removed * 10) falls += 1;
    if (gained > 0 && (gained < removed * 10 || gained > removed * 20 || removed < 3)) check('score is 10 per popped bubble and 20 per fallen bubble', false, 'gained ' + gained + ' removed ' + removed);
    scoreBeforeLast = before.score;
    lastGain = gained;
    if (near(firedAngle, plan.angle, 0.003)) { predicted += 1; if (gained === plan.score - before.score) predictedOk += 1; }
    if (!after.over) {
      if (!after.present.includes(after.cur)) kindOk = false;
      const t = snap.texts;
      if (!hudShows(t, [after.score, after.level]) || hudBad(t).length) hudOk = false;
      // Shots left before the next row (a row comes every 7 shots), or a line that says no more rows come.
      if (after.rowsLeft && !t.some((x) => /tir[io]/i.test(x) && hudNums([x]).includes(7 - (after.shots % 7)))) countdownShown = false;
      if (!after.rowsLeft && !hasText(t, /niente/i)) countdownShown = false;
    }
    if (!shotDone && shots === 14) { shotDone = true; await shot(page, 'bubbles-play'); }
  }
  s = await state(page, bubSnap);
  check('mouse shots and keyboard shots both work', mouseShots >= 5 && keyShots >= 5, mouseShots + ' mouse, ' + keyShots + ' keyboard');
  check('the mouse aim stayed exact during play', aimOk);
  check('groups of 3 pop', pops >= 5, 'pops ' + pops);
  check('hanging bubbles fall (extra points)', falls >= 1, 'falls ' + falls);
  check('a new row comes every 7 shots (5 rows on level 1)', rowsAdded >= 1 && rowsAdded <= 5 * games, 'rows ' + rowsAdded);
  check('the waiting bubble is always a kind that is on the board', kindOk);
  check('HUD shows the score and level of the state', hudOk);
  check('HUD tells how many shots are left before the next row comes down', countdownShown);
  check('shots land where the aim line says (same result as a copy of the game)', predicted > 0 && predictedOk >= predicted * 0.9, predictedOk + ' of ' + predicted);
  check('level 1 ends: cleared, or lost after the rows reached the line', s.over, JSON.stringify(s));
  check.note('level 1 ' + (s.won ? 'cleared' : 'not cleared') + ': ' + shots + ' shots (' + mouseShots + ' mouse, ' + keyShots + ' keyboard), ' + pops + ' pops, ' + falls + ' with falling bubbles, ' + rowsAdded + ' new rows, score ' + s.score + ', games ' + games);
  if (s.over && s.won) {
    const card = await overlayText(page);
    check('win card offers level 2 and shows the score with the 100 point prize', cardHas(card, 'Punti', s.score) && /100/.test(card) && s.score === scoreBeforeLast + lastGain + 100 && /livello 2/i.test(await cardButton(page).innerText()), card + ' score ' + s.score + ' before ' + scoreBeforeLast + ' gain ' + lastGain);
    const hi = await hiScore(page, 'bubbles');
    check('the saved record includes the 100 point prize shown on the win card', hi === s.score, 'card says ' + s.score + ', saved ' + hi);
    await shot(page, 'bubbles-won');
    await page.keyboard.press('Enter');
    level2 = await state(page, bubSnap);
    check('level 2 starts with the score of the card, 5 rows, 4 kinds, 6 rows to come', level2.started && level2.level === 2 && level2.score === s.score && level2.size === 48 && level2.kinds === 4 && level2.rowsLeft === 6, JSON.stringify(level2));
    await page.waitForTimeout(100);
    await shot(page, 'bubbles-level2');
  }
  // Lose on purpose (only if it did not happen): shoot straight up until the bubbles reach the line.
  if (!lostOnce) {
    if (!(await started(page))) await page.keyboard.press('Enter');
    p = await canvasPoint(page, 181, 200);
    await page.mouse.move(p.x, p.y);
    let n = 0;
    for (; n < 200; n++) {
      s = await state(page, bubSnap);
      if (s.over) break;
      // Aim at a column that does not pop: straight up or slightly to the side, alternating.
      p = await canvasPoint(page, 180 + ((n % 5) - 2) * 14, 200);
      await page.mouse.move(p.x, p.y);
      await page.mouse.down();
      await page.mouse.up();
      await waitLanded(page);
    }
    s = await state(page, bubSnap);
    if (s.over && s.won) { check.note('the random shots cleared the level; loss not reached this run'); } else {
      check('the game is lost when a bubble reaches the red line', s.over && !s.won && s.lowestY >= 470, JSON.stringify({ over: s.over, lowestY: s.lowestY, n: n }));
      const card = await overlayText(page);
      const hi = await hiScore(page, 'bubbles');
      check('loss card shows score and record', cardHas(card, 'Punti', s.score) && cardHas(card, 'Record', hi), card);
      await shot(page, 'bubbles-lost');
      await cardButton(page).click();
      s = await state(page, bubSnap);
      check('"Gioca ancora" starts level 1 again with 0 points', s.started && s.level === 1 && s.score === 0 && s.shots === 0 && s.size === 48);
      await page.waitForTimeout(150);
      check('the record is on the HUD of the new game', hi > 6 && hudShows(await texts(page), [hi]), 'record ' + hi + ', HUD: ' + (await texts(page)).join(' | '));
    }
  }
  check('no page errors', page.errors.length === 0, page.errors.join(' | '));
  await page.context().close();
}

// =====================================================================================
// APP SHELL AND INPUT LAYER
// =====================================================================================
// A value that changes while the game of the given instance runs.
const pulse = (inst) => {
  const d = inst.debug;
  const s = d.state;
  return JSON.stringify([s.gravity, s.cur, s.snake && s.snake[0], s.stepAcc, s.fx, s.px, s.modeClock, s.freeze, s.moving, s.angle, s.score, d.started]);
};
// eslint-disable-next-line no-eval
const pulseOld = eval('(() => { const f = ' + pulse.toString() + '; return { p: f(window.__old), raf: window.__t.raf, l: window.__t.listeners(), noCurrent: window.RA.current === null }; })');

async function scenarioShell(browser) {
  const check = makeChecker('shell');
  const page = await newPage(browser);
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.waitForSelector('button.tile');

  // Menu.
  const tiles = await page.locator('button.tile').allInnerTexts();
  check('the menu shows 11 games', tiles.length === 11, tiles.length);
  check('the Menu button is hidden on the menu', await page.locator('#home').isHidden());
  const base = await page.evaluate(() => window.__t.listeners());
  await page.waitForTimeout(300);
  const raf0 = await page.evaluate(() => window.__t.raf);
  await page.waitForTimeout(300);
  check('no animation loop runs on the menu', (await page.evaluate(() => window.__t.raf)) === raf0);

  // Open and close every arcade game many times, in every way.
  let cycleOk = true;
  let leakOk = true;
  let stateFrozen = true;
  for (let round = 0; round < 3; round++) {
    for (const id of ARCADE) {
      await openByTile(page, id);
      const visible = await page.locator('#home').isVisible();
      const hasCard = (await page.locator('.overlay button.big').count()) === 1;
      if (!visible || !hasCard) { cycleOk = false; check('open ' + id, false, 'menu button ' + visible + ', card ' + hasCard); }
      if (round > 0) {
        // Start and play a little, so the game is running when we leave.
        await page.keyboard.press('Enter');
        await page.keyboard.down(['ArrowLeft', 'ArrowRight', ' ', 'ArrowDown'][(round + id.length) % 4]);
        await page.waitForTimeout(200);
      }
      await page.evaluate(() => { window.__old = window.RA.current; });
      if (round === 2) await page.locator('#home').click(); else await page.keyboard.press('Escape');
      await page.keyboard.up('ArrowLeft'); await page.keyboard.up('ArrowRight'); await page.keyboard.up(' '); await page.keyboard.up('ArrowDown');
      const onMenu = (await page.locator('button.tile').count()) === 11 && (await page.locator('#home').isHidden()) && (await page.locator('.arcade-stage canvas').count()) === 0;
      if (!onMenu) { cycleOk = false; check('back to the menu from ' + id, false); }
      // The old game must be dead: no frames, no state change, no listeners left after one key.
      await page.keyboard.press('Shift');
      const a = await page.evaluate(pulseOld);
      await page.waitForTimeout(250);
      const b = await page.evaluate(pulseOld);
      if (a.p !== b.p || a.raf !== b.raf) { stateFrozen = false; check('the closed game ' + id + ' stops (round ' + round + ')', false, a.p + ' / ' + b.p + ' raf ' + a.raf + '/' + b.raf); }
      if (JSON.stringify(a.l) !== JSON.stringify(base) || !a.noCurrent) { leakOk = false; check('no listeners left after ' + id + ' (round ' + round + ')', false, JSON.stringify(a.l) + ' base ' + JSON.stringify(base)); }
    }
  }
  check('every arcade game opens with a start card and closes with Esc and with the Menu button (15 cycles)', cycleOk);
  check('a closed game stops: no frames are requested and its state does not change', stateFrozen);
  check('a closed game leaves no key or blur listeners on the window', leakOk);

  // Stale card: Enter on the menu after leaving a game must not start the old game.
  await openByTile(page, 'snake');
  await page.evaluate(() => { window.__old = window.RA.current; });
  await page.keyboard.press('Escape');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(200);
  check('Enter on the menu does not start a game that was closed', await page.evaluate(() => !window.__old.debug.started && window.RA.current === null && document.querySelectorAll('button.tile').length === 11));
  // Old card + new card: Enter starts only the new game.
  await openByTile(page, 'snake');
  await page.evaluate(() => { window.__old = window.RA.current; });
  await page.keyboard.press('Escape');
  await openByTile(page, 'tetris');
  await page.keyboard.press('Enter');
  check('Enter starts only the game on screen', await page.evaluate(() => !window.__old.debug.started && window.RA.current.debug.started && window.RA.currentId === 'tetris'));
  await page.keyboard.press('Escape');

  // Keys do not leak from one game to the next.
  await openByTile(page, 'invaders');
  await page.keyboard.press('Enter');
  await page.keyboard.down('ArrowLeft');
  await page.keyboard.down(' ');
  await page.waitForTimeout(200);
  await page.keyboard.press('Escape'); // keys are still held
  await openByTile(page, 'tetris');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(500);
  let t = await state(page, tetrisSnap);
  check('keys held in the last game do not act in the next game', t.cur.x === 3 && t.blocks === 0 && t.score === 0, JSON.stringify(t.cur) + ' blocks ' + t.blocks);
  await page.keyboard.up('ArrowLeft');
  await page.keyboard.up(' ');
  await page.waitForTimeout(100);
  t = await state(page, tetrisSnap);
  check('releasing those keys later does nothing', t.cur.x === 3 && t.blocks === 0);
  // Keys of a running game do not reach a closed game.
  await page.evaluate(() => { window.__old = window.RA.current; window.__oldPulse = null; });
  await page.keyboard.press('Escape');
  await openByTile(page, 'snake');
  await page.keyboard.press('Enter');
  const oldBefore = (await page.evaluate(pulseOld)).p;
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press(' ');
  await page.keyboard.press('ArrowLeft');
  const oldAfter = (await page.evaluate(pulseOld)).p;
  check('keys pressed in Snake do not change the closed Tetris game', oldBefore === oldAfter);
  await page.keyboard.press('Escape');

  // Lost focus with a key held: the key must not stay stuck.
  await openByTile(page, 'invaders');
  await page.keyboard.press('Enter');
  await page.keyboard.down('ArrowRight');
  await page.waitForTimeout(200);
  let i1 = await state(page, invSnap);
  await page.evaluate(() => window.dispatchEvent(new Event('blur')));
  await page.waitForTimeout(80);
  const i2 = await state(page, invSnap);
  await page.waitForTimeout(300);
  const i3 = await state(page, invSnap);
  check('the raccoon was moving before the window lost focus', i1.px > 240);
  check('when the window loses focus the game pauses and the held key is released', i3.px === i2.px && (await pausedNow(page)), i2.px + ' -> ' + i3.px);
  await page.keyboard.up('ArrowRight');
  await page.keyboard.press('p');
  await page.waitForTimeout(250);
  const i3b = await state(page, invSnap);
  check('after P the key that was held before does not act any more', i3b.px === i3.px && !(await pausedNow(page)), i3.px + ' -> ' + i3b.px);
  await page.keyboard.down('ArrowLeft');
  await page.waitForTimeout(150);
  const i4 = await state(page, invSnap);
  await page.keyboard.up('ArrowLeft');
  check('keys work again after the focus comes back and P is pressed', i4.px < i3.px);

  // Modifier keys: Cmd/Ctrl + key is not a game key.
  i1 = await state(page, invSnap);
  await page.keyboard.down('Control');
  await page.keyboard.down('ArrowLeft');
  await page.waitForTimeout(150);
  await page.keyboard.up('ArrowLeft');
  await page.keyboard.up('Control');
  check('Ctrl + arrow does not move the raccoon', (await state(page, invSnap)).px === i1.px);
  // A key is held, then a key press with Cmd arrives (macOS sends no key-up after that):
  // every held key must be dropped, so nothing stays stuck.
  await page.keyboard.down('ArrowRight');
  await page.waitForTimeout(120);
  await page.evaluate(() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Meta', metaKey: true, bubbles: true })));
  await page.waitForTimeout(60);
  const c1 = await state(page, invSnap);
  await page.waitForTimeout(300);
  const c2 = await state(page, invSnap);
  await page.keyboard.up('ArrowRight');
  check('a key press with Cmd releases the held keys (no stuck key)', c2.px === c1.px && c1.px > i1.px, c1.px + ' -> ' + c2.px);

  // Space, Enter and the arrows must not scroll the page or press a focused button again.
  await page.setViewportSize({ width: 700, height: 600 });
  let prevented = true;
  for (const k of ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', ' ']) {
    await page.keyboard.press(k);
    await page.waitForTimeout(20);
    const d = await page.evaluate(() => window.__t.lastKeyDefault);
    if (!d || !d.prevented) { prevented = false; check('default action of "' + k + '" is prevented in a game', false, JSON.stringify(d)); }
  }
  check('arrows and Space never scroll the page in a game (default prevented)', prevented && (await page.evaluate(() => window.scrollY === 0 && window.scrollX === 0)));
  await page.setViewportSize({ width: 1120, height: 812 });
  // Mute with the mouse, then Space and Enter: the mute button must not be pressed again.
  const muted0 = await page.evaluate(() => window.RA.audio.isMuted());
  const label0 = await page.locator('#mute').innerText();
  await page.locator('#mute').click();
  const muted1 = await page.evaluate(() => window.RA.audio.isMuted());
  check('a click on the speaker toggles the sound', muted1 === !muted0);
  const label1 = await page.locator('#mute').innerText();
  check('the sound button label and the saved setting follow', label1 !== label0 && label1.length > 0 && (await page.evaluate(() => JSON.parse(localStorage.getItem('ra.muted')))) === muted1, label0 + ' -> ' + label1);
  for (const k of [' ', 'Enter', ' ', 'ArrowUp']) await page.keyboard.press(k);
  check('Space and Enter after the click do not toggle the sound again', (await page.evaluate(() => window.RA.audio.isMuted())) === muted1);
  check('the speaker button does not keep the focus', await page.evaluate(() => document.activeElement !== document.getElementById('mute')));
  // Sound: muted = no oscillators are made; unmuted = shots make sound.
  await page.evaluate(() => { window.__t.osc = 0; });
  await page.keyboard.down(' ');
  await page.waitForTimeout(900);
  await page.keyboard.up(' ');
  const oscMuted = await page.evaluate(() => window.__t.osc);
  await page.locator('#mute').click();
  await page.keyboard.down(' ');
  await page.waitForTimeout(900);
  await page.keyboard.up(' ');
  const oscOn = await page.evaluate(() => window.__t.osc);
  check('no sound is made while muted, sound comes back after unmute (during play)', oscMuted === 0 && oscOn >= 2, 'muted ' + oscMuted + ', on ' + oscOn);
  check('the game keeps running after the mute clicks', await started(page));
  // The mute setting survives a reload.
  await page.locator('#mute').click();
  await page.reload();
  await page.waitForSelector('button.tile');
  check('the mute setting is kept after a restart', (await page.evaluate(() => window.RA.audio.isMuted())) === true && (await page.locator('#mute').innerText()) === label1);
  await page.locator('#mute').click();

  // Keyboard-only use: Tab to the speaker, then play. Space in the game must not toggle it.
  await openByTile(page, 'invaders');
  await page.keyboard.press('Enter');
  await page.locator('#mute').focus();
  const m0 = await page.evaluate(() => window.RA.audio.isMuted());
  await page.keyboard.press(' ', { delay: 80 });
  await page.keyboard.press('ArrowUp', { delay: 30 });
  await page.waitForTimeout(50);
  check('Space in a game does not press a focused top-bar button', (await page.evaluate(() => window.RA.audio.isMuted())) === m0 && (await state(page, invSnap)).pBullets.length >= 1);
  await page.evaluate(() => document.activeElement && document.activeElement.blur());
  await page.keyboard.press('Escape');

  // Esc in every phase: start card, running, paused, game-over card.
  await openByTile(page, 'tetris');
  await page.keyboard.press('Enter');
  await page.keyboard.press('p');
  await page.keyboard.press('Escape');
  check('Esc leaves a paused Tetris', (await page.locator('button.tile').count()) === 11);
  await openByTile(page, 'tetris');
  await page.keyboard.press('Enter');
  check('a new Tetris after a paused one is not paused', !(await state(page, tetrisSnap)).paused);
  for (let i = 0; i < 40 && !(await state(page, tetrisSnap)).over; i++) await page.keyboard.press(' ');
  check('Tetris ended (set-up for the next check)', (await state(page, tetrisSnap)).over);
  await page.evaluate(() => { window.__old = window.RA.current; });
  await page.keyboard.press('Escape');
  await page.keyboard.press('Enter');
  check('Esc on a game-over card goes to the menu, Enter then does nothing', await page.evaluate(() => !window.__old.debug.started && window.RA.current === null));
  // Esc on the menu does nothing bad.
  await page.keyboard.press('Escape');
  check('Esc on the menu keeps the menu', (await page.locator('button.tile').count()) === 11);

  // Pause in every game (P, lost focus, hidden window) and the record after leaving with Esc.
  for (const id of ARCADE) {
    await page.evaluate((k) => localStorage.removeItem('ra.hi.' + k), id);
    await openByTile(page, id);
    await page.keyboard.press('p'); // on the start card P must do nothing
    await page.keyboard.press('Enter');
    await page.waitForTimeout(100);
    check(id + ': P on the start card does not pause the game that starts next', (await started(page)) && !(await pausedNow(page)));
    await page.keyboard.press('p');
    let st = await standsStill(page, 500);
    check(id + ': P pauses the game and the canvas shows "PAUSA"', st.still && st.shown && hasText(await texts(page), /premi p/i), 'still ' + st.still + ', text ' + st.shown);
    if (id === 'tetris') { await page.keyboard.press('ArrowLeft'); await page.keyboard.press('ArrowUp'); await page.keyboard.press(' ', { delay: 30 }); }
    if (id === 'snake') await page.keyboard.press('ArrowUp');
    if (id === 'invaders') { await page.keyboard.press('ArrowLeft', { delay: 100 }); await page.keyboard.press(' ', { delay: 40 }); }
    if (id === 'pacman') { await page.keyboard.press('ArrowLeft'); await page.keyboard.press('ArrowRight'); }
    if (id === 'bubbles') { await page.keyboard.press('ArrowLeft', { delay: 80 }); await page.keyboard.press(' ', { delay: 40 }); }
    await page.waitForTimeout(80);
    const sigKeys = await page.evaluate(frozenSig);
    (id === 'bubbles' ? (n, ok, d) => check.known('P1', n, ok, d) : check)(id + ': game keys do nothing while paused', sigKeys === st.sig, st.sig + ' / ' + sigKeys);
    await page.keyboard.press('P'); // capital letter
    check(id + ': P again resumes the game', await runsAgain(page));
    await page.evaluate(() => window.dispatchEvent(new Event('blur')));
    st = await standsStill(page, 400);
    check(id + ': the game pauses by itself when the window loses focus', st.still && st.shown);
    await page.keyboard.press('p');
    check(id + ': P resumes after a lost focus', await runsAgain(page));
    await page.evaluate(() => {
      Object.defineProperty(document, 'hidden', { get: function () { return true; }, configurable: true });
      document.dispatchEvent(new Event('visibilitychange'));
      delete document.hidden;
    });
    st = await standsStill(page, 400);
    check(id + ': the game pauses by itself when the window is hidden', st.still && st.shown);
    await page.keyboard.press('p');
    check(id + ': P resumes after the window was hidden', await runsAgain(page));
    // Make some points, leave with Esc: the record must be saved and shown next time.
    const scoreNow = () => page.evaluate(() => window.RA.current.debug.state.score);
    if (id === 'tetris') {
      await page.keyboard.press(' ');
    } else if (id === 'invaders') {
      await page.keyboard.down(' ');
      await page.waitForFunction(() => window.RA.current.debug.state.score > 0, null, { timeout: 20000 }).catch(() => {});
      await page.keyboard.up(' ');
    } else if (id === 'pacman') {
      const dir = await page.evaluate(() => { const st2 = window.RA.current.debug.state; return ['left', 'right', 'up'].find((d) => window.RA.modules.pacman.canMove(st2.grid, st2.pac.x, st2.pac.y, d)); });
      await page.keyboard.press({ left: 'ArrowLeft', right: 'ArrowRight', up: 'ArrowUp' }[dir]);
      await page.waitForFunction(() => window.RA.current.debug.state.score > 0, null, { timeout: 10000 }).catch(() => {});
    } else if (id === 'snake') {
      for (let i = 0; i < 500; i++) {
        const q = await page.evaluate(() => { const z = window.RA.current.debug.state; return { h: z.snake[0], f: z.food, d: z.dir, e: z.eaten, alive: z.alive, q: z.queue.length }; });
        if (q.e >= 1) break;
        if (!q.alive) { await page.keyboard.press('Enter'); continue; }
        let want = null;
        if (q.f.x > q.h.x && q.d !== 'left') want = 'ArrowRight';
        else if (q.f.x < q.h.x && q.d !== 'right') want = 'ArrowLeft';
        else if (q.f.y > q.h.y && q.d !== 'up') want = 'ArrowDown';
        else if (q.f.y < q.h.y && q.d !== 'down') want = 'ArrowUp';
        else if (q.f.x !== q.h.x) want = q.h.y > 2 ? 'ArrowUp' : 'ArrowDown';
        else want = q.h.x > 2 ? 'ArrowLeft' : 'ArrowRight';
        if (want && !q.q) await page.keyboard.press(want);
        await page.waitForTimeout(40);
      }
    } else {
      for (let i = 0; i < 15 && (await scoreNow()) === 0; i++) {
        const plan = await state(page, bubblesPlan);
        if (plan) { await aimMouse(page, plan.angle); await page.mouse.down(); await page.mouse.up(); }
        await waitLanded(page);
      }
    }
    await page.waitForTimeout(80);
    const made = await page.evaluate(withTexts(() => window.RA.current.debug.state.score));
    await page.keyboard.press('Escape');
    const saved = await hiScore(page, id);
    check(id + ': a record made in a game that is left with Esc is saved', made.s > 0 && saved === made.s && hudShows(made.texts, [made.s]), 'score ' + made.s + ', saved ' + saved);
    await openByTile(page, id);
    await page.waitForTimeout(120);
    const hudBack = await texts(page);
    check(id + ': that record is on the HUD when the game is opened again', hasText(hudBack, /record/i) && hudShows(hudBack, [made.s]), hudBack.join(' | '));
    await page.keyboard.press('Escape');
  }

  // Sizes: every game, 4 window sizes, canvas visible, no scrolling, start card inside the canvas.
  const SIZES = [[700, 600], [1120, 812], [1440, 900], [1728, 1117]];
  let sizeOk = true;
  let cardOk = true;
  let aimOk = true;
  let helpOk = true;
  for (const id of ARCADE) {
    await openByTile(page, id);
    for (const size of SIZES) {
      await page.setViewportSize({ width: size[0], height: size[1] });
      await page.waitForTimeout(60);
      const l = await layout(page);
      if (!l.inside || !l.noScroll) { sizeOk = false; check(id + ' fits in ' + size.join('x'), false, JSON.stringify(l)); }
      if (l.helpVisible === false) { helpOk = false; check(id + ' help line under the canvas is visible at ' + size.join('x'), false, JSON.stringify(l)); }
      if (!l.cardInside || !l.cardCentred) { cardOk = false; check(id + ' start card inside and centred at ' + size.join('x'), false, JSON.stringify(l)); }
      await shot(page, 'size-' + id + '-' + size.join('x') + '-card');
    }
    await page.keyboard.press('Enter');
    // Resize while the game runs.
    for (const size of SIZES) {
      await page.setViewportSize({ width: size[0], height: size[1] });
      await page.keyboard.press('ArrowLeft');
      await page.waitForTimeout(250);
      const l = await layout(page);
      if (!l.inside || !l.noScroll) { sizeOk = false; check(id + ' fits in ' + size.join('x') + ' while running', false, JSON.stringify(l)); }
      await shot(page, 'size-' + id + '-' + size.join('x') + '-play');
      if (id === 'bubbles') {
        // Mouse aim stays exact after a resize.
        for (const a of [-0.9, 0.3, 1.2]) {
          const want = await aimMouse(page, a);
          const got = (await state(page, bubSnap)).angle;
          if (!near(got, want, 1e-6) || !near(got, a, 0.03)) { aimOk = false; check('Bolle mouse aim after resize to ' + size.join('x'), false, 'want ' + want + ' got ' + got); }
        }
      }
    }
    await page.setViewportSize({ width: 1120, height: 812 });
    await page.keyboard.press('Escape');
  }
  check('every canvas is fully visible without scrolling at 700x600, 1120x812, 1440x900 and 1728x1117', sizeOk);
  check('every start card is inside the canvas and centred at those sizes', cardOk);
  check('the help line under the canvas (if the game has one) is visible at those sizes', helpOk);
  check('Bolle mouse aim is exact after each resize', aimOk);
  check('no page errors', page.errors.length === 0, page.errors.join(' | '));
  await page.context().close();

  // Retina: is the canvas backing store as large as the pixels it covers?
  const retina = await newPage(browser, { viewport: { width: 1440, height: 900 }, dsf: 2 });
  let sharp = true;
  const soft = [];
  for (const id of ARCADE) {
    for (const size of [[1440, 900], [1728, 1117], [1120, 812]]) {
      // The first size is the one the game is opened at; the others are window resizes.
      await retina.setViewportSize({ width: size[0], height: size[1] });
      if (size[0] === 1440) await retina.evaluate((k) => window.RA.openGame(k), id);
      await retina.waitForTimeout(120);
      const l = await layout(retina);
      if (l.backing[0] < l.devicePx[0] - 2 || l.backing[1] < l.devicePx[1] - 2) { sharp = false; soft.push(id + ' at ' + size.join('x') + ': ' + l.backing.join('x') + ' drawn on ' + l.devicePx.join('x')); }
      // The picture must still be drawn in the whole canvas after the backing store changed.
      const drawn = await retina.evaluate((w) => {
        const c = document.querySelector('.arcade-stage canvas');
        const t = c.getContext('2d').getTransform();
        return { scale: t.a, ok: t.a === t.d && t.a * w === c.width };
      }, { bubbles: 360, tetris: 470, invaders: 480, pacman: 630, snake: 740 }[id]);
      if (!drawn.ok || drawn.scale < 2) { sharp = false; soft.push(id + ' transform ' + JSON.stringify(drawn)); }
    }
  }
  check('on a Retina screen (@2x) the canvas has at least as many pixels as it covers, also after a resize', sharp, soft.join('; '));
  await retina.context().close();
}

// =====================================================================================
// FRAME RATE (the display is simulated: frames are shown by hand at a chosen rate)
// =====================================================================================
async function scenarioFramerate(browser) {
  const check = makeChecker('framerate');
  const page = await newPage(browser, { virtualClock: true });
  const measure = async function (hz, jitter) {
    return page.evaluate((arg) => {
      const RA = window.RA;
      const out = {};
      const frames = function (seconds) {
        const n = Math.round(seconds * arg.hz);
        if (!arg.jitter) { window.__vtick(n, 1000 / arg.hz); return; }
        // Uneven frames: alternate short and long, same average.
        for (let i = 0; i < n; i++) window.__vtick(1, (1000 / arg.hz) * (i % 2 ? 1.6 : 0.4));
      };
      // Invaders: raccoon speed and formation steps.
      RA.openGame('invaders');
      window.__tap('Enter');
      frames(0.05);
      let s = RA.current.debug.state;
      const fx0 = s.fx;
      const fy0 = s.fy;
      window.__key('keydown', 'ArrowLeft');
      const px0 = s.px;
      frames(0.5);
      out.invPx = px0 - s.px;
      window.__key('keyup', 'ArrowLeft');
      frames(6.5);
      out.invSteps = (s.fx - fx0) / 12 + (s.fy - fy0) / 16;
      // Tetris: gravity rows in 4 s at level 1 (0.8 s per row).
      RA.openGame('tetris');
      window.__tap('Enter');
      s = RA.current.debug.state;
      const y0 = s.cur.y;
      frames(4.1);
      out.tetRows = s.cur.y - y0;
      // Snake: steps in 2 s (0.14 s per step). The snake starts 19 cells from the wall.
      RA.openGame('snake');
      window.__tap('Enter');
      s = RA.current.debug.state;
      const x0 = s.snake[0].x;
      frames(2.03);
      out.snakeSteps = s.snake[0].x - x0;
      // Raccoon-man: tiles walked in 2 s after the start pause, on the bottom corridor.
      RA.openGame('pacman');
      window.__tap('Enter');
      s = RA.current.debug.state;
      frames(1.25);
      out.pacFreeze = s.freeze;
      const P = RA.modules.pacman;
      let dir = P.canMove(s.grid, s.pac.x, s.pac.y, 'left') ? 'left' : 'right';
      window.__tap(dir === 'left' ? 'ArrowLeft' : 'ArrowRight');
      const clock0 = s.modeClock;
      frames(1);
      out.pacClock = s.modeClock - clock0;
      // Bolle: flight time of a straight shot is distance / 760.
      RA.openGame('bubbles');
      window.__tap('Enter');
      s = RA.current.debug.state;
      window.__tap(' ');
      let n = 0;
      while (s.moving && n < 2000) { window.__vtick(1, 1000 / arg.hz); n += 1; }
      out.bubFlight = n / arg.hz;
      RA.showMenu();
      return out;
    }, { hz: hz, jitter: !!jitter });
  };
  const ref = await measure(60, false);
  check('60 Hz reference: 120 px in 0.5 s, 5 Tetris rows in 4.1 s, 13 Snake steps in 2.03 s', near(ref.invPx, 120, 5) && ref.tetRows === 5 && ref.snakeSteps === 13, JSON.stringify(ref));
  const rows = ['60Hz ' + JSON.stringify(ref)];
  for (const cfg of [[30, false], [50, false], [75, false], [120, false], [144, false], [240, false], [120, true], [60, true]]) {
    const m = await measure(cfg[0], cfg[1]);
    rows.push(cfg[0] + 'Hz' + (cfg[1] ? ' uneven ' : ' ') + JSON.stringify(m));
    const same = near(m.invPx, ref.invPx, 9) && Math.abs(m.invSteps - ref.invSteps) <= 1 && Math.abs(m.tetRows - ref.tetRows) <= 1 && Math.abs(m.snakeSteps - ref.snakeSteps) <= 1 && near(m.pacClock, ref.pacClock, 0.04) && near(m.bubFlight, ref.bubFlight, Math.max(0.04, 2 / cfg[0]));
    check('game speed at ' + cfg[0] + ' Hz' + (cfg[1] ? ' with uneven frames' : '') + ' is the same as at 60 Hz', same, JSON.stringify(m) + ' vs ' + JSON.stringify(ref));
  }
  // A very slow display (5 frames per second): the game slows down, it must not jump or crash.
  const slow = await measure(5, false);
  check('at 5 frames per second the game runs slower, without errors', slow.invPx > 20 && slow.invPx <= ref.invPx + 5, JSON.stringify(slow));
  // The window was hidden for 5 seconds (no frames), then comes back: the game must not jump.
  const gap = await page.evaluate(() => {
    const RA = window.RA;
    RA.openGame('snake');
    window.__tap('Enter');
    window.__vtick(30, 1000 / 60);
    const s = RA.current.debug.state;
    const x0 = s.snake[0].x;
    window.__vtick(1, 5000);
    const jump = s.snake[0].x - x0;
    RA.showMenu();
    return { jump: jump, alive: s.alive };
  });
  check('after 5 s without frames (hidden window) the game moves on by one step at most', gap.alive && gap.jump <= 1, JSON.stringify(gap));
  if (process.env.VERBOSE) rows.forEach((r) => console.log('  ' + r));
  check('no page errors', page.errors.length === 0, page.errors.join(' | '));
  await page.context().close();
}

// =====================================================================================
// RARE SITUATIONS. Here, and only here, the test writes the game state to reach a situation
// that would need a very long game. Each write is marked "STATE WRITE".
// =====================================================================================
async function scenarioRare(browser) {
  const check = makeChecker('rare');
  const page = await newPage(browser);
  await page.evaluate(() => localStorage.clear());

  // Snake: the field is full after the last fish.
  await page.evaluate(() => window.RA.openGame('snake'));
  await page.keyboard.press('Enter');
  await page.evaluate(() => {
    // STATE WRITE: a snake that covers the whole field except the cell in front of its head.
    const s = window.RA.current.debug.state;
    const path = [];
    for (let y = 0; y < 18; y++) {
      for (let i = 0; i < 24; i++) path.push({ x: y % 2 ? 23 - i : i, y: y });
    }
    // The path ends at (0, 17). The head is on the cell before the end and moves left.
    const food = path.pop();
    s.snake = path.reverse();
    s.dir = 'left';
    s.queue = [];
    s.food = food;
  });
  await page.waitForFunction(() => !window.RA.current.debug.started, null, { timeout: 3000 });
  let r = await page.evaluate(() => { const s = window.RA.current.debug.state; return { won: s.won, alive: s.alive, len: s.snake.length, food: s.food }; });
  let card = await overlayText(page);
  check('Snake: a full field is a win with its own card', r.won && r.len === 432 && r.food === null && !!card && !/NaN|undefined|null/.test(card), JSON.stringify(r) + ' ' + card);
  await page.waitForTimeout(100);
  await shot(page, 'rare-snake-full');
  await page.keyboard.press('Enter');
  check('Snake: a new game starts after the win', await page.evaluate(() => window.RA.current.debug.started && window.RA.current.debug.state.snake.length === 3));

  // Raccoon Defender: the invaders reach the raccoon row.
  await page.evaluate(() => window.RA.openGame('invaders'));
  await page.keyboard.press('Enter');
  await page.evaluate(() => { /* STATE WRITE: formation near the bottom */ window.RA.current.debug.state.fy = 380; });
  await page.waitForFunction(() => window.RA.current.debug.state.over, null, { timeout: 20000 });
  r = await state(page, invSnap);
  card = await overlayText(page);
  check('Defender: the game ends when the invaders reach the raccoon row, with lives left', r.over && r.lives > 0 && cardHas(card, 'Punti', r.score), JSON.stringify({ lives: r.lives, fy: r.fy }));
  check('Defender: invaders that pass over the shelters break them', r.shieldCells < 40, 'shelter cells left: ' + r.shieldCells);
  await page.waitForTimeout(100);
  await shot(page, 'rare-invaders-landed');

  // Raccoon Defender: wave 2 keeps the broken shields.
  await page.keyboard.press('Enter');
  await page.evaluate(() => {
    // STATE WRITE: one invader left, half of the shields broken.
    const s = window.RA.current.debug.state;
    s.invaders.forEach((inv, i) => { inv.alive = i === 40; });
    s.shields.forEach((b) => b.forEach((c, i) => { if (i % 2) c.alive = false; }));
  });
  await page.keyboard.down(' ');
  try { await page.waitForFunction(() => window.RA.current.debug.state.wave === 2 || window.RA.current.debug.state.over, null, { timeout: 20000 }); } catch (e) { /* below */ }
  await page.keyboard.up(' ');
  r = await state(page, invSnap);
  check('Defender: shooting the last invader starts wave 2', r.wave === 2, JSON.stringify({ wave: r.wave, over: r.over }));
  check('Defender: the shelters are rebuilt for the new wave', r.shieldCells === 80, 'shelter cells at the start of wave 2: ' + r.shieldCells + ' of 80');

  // Raccoon-man: level 3 has 4 chasers; the HUD has room for the text.
  await page.evaluate(() => window.RA.openGame('pacman'));
  await page.keyboard.press('Enter');
  for (let level = 1; level <= 2; level++) {
    await page.evaluate(() => {
      // STATE WRITE: leave only the acorn next to the raccoon, so the level ends with one step.
      const s = window.RA.current.debug.state;
      const P = window.RA.modules.pacman;
      const dir = ['left', 'right', 'up'].find((d) => P.canMove(s.grid, s.pac.x, s.pac.y, d));
      const n = P.nextTile(s.pac.x, s.pac.y, dir);
      for (let y = 0; y < P.H; y++) for (let x = 0; x < P.W; x++) if (s.grid[y][x] === '.' || s.grid[y][x] === 'o') s.grid[y][x] = ' ';
      s.grid[n.y][n.x] = '.';
      s.acornsLeft = 1;
      s.score = 99990;
      s.freeze = 0;
      window.__tap({ left: 'ArrowLeft', right: 'ArrowRight', up: 'ArrowUp' }[dir]);
    });
    await page.waitForFunction(() => !window.RA.current.debug.started, null, { timeout: 5000 });
    await page.keyboard.press('Enter');
  }
  r = await state(page, pacSnap);
  check('Raccoon-man: level 3 has 4 chasers, score and lives are kept', r.level === 3 && r.ghosts.length === 4 && r.lives === 3 && r.score === 100000, JSON.stringify({ level: r.level, ghosts: r.ghosts.length, score: r.score }));
  await page.waitForTimeout(150);
  await shot(page, 'rare-pacman-level3-bigscore');

  // Raccoon-man: raccoon and chaser cross in the tunnel.
  const cross = await page.evaluate(() => {
    // STATE WRITE: raccoon at the left end of the tunnel going left, one chaser at the right end going right.
    const s = window.RA.current.debug.state;
    s.freeze = 0;
    s.scared = 0;
    s.pac.x = 0; s.pac.y = 7; s.pac.dir = 'left'; s.pac.want = 'left'; s.pac.p = 0; s.pac.moving = false;
    s.ghosts.forEach((g, i) => { g.wait = 999; g.eaten = false; g.moving = false; g.x = 10; g.y = 7; });
    const g = s.ghosts[0];
    g.wait = 0; g.x = 20; g.y = 7; g.dir = 'right'; g.p = 0.5; g.moving = true;
    return { lives: s.lives };
  });
  await page.waitForTimeout(500);
  r = await state(page, pacSnap);
  check('Raccoon-man: a chaser and the raccoon that cross in the tunnel meet', r.lives < cross.lives || r.over, 'lives ' + cross.lives + ' -> ' + r.lives + ', raccoon x=' + r.pac.x + ', chaser x=' + r.ghosts[0].x);

  // Raccoon-man: catching a scared chaser.
  if (!(await started(page))) await page.keyboard.press('Enter');
  const before = await page.evaluate(() => {
    // STATE WRITE: chasers afraid, one of them stands on the tile next to the raccoon.
    const s = window.RA.current.debug.state;
    const P = window.RA.modules.pacman;
    s.freeze = 0;
    s.scared = 7;
    s.eatChain = 0;
    s.pac.x = s.start.x; s.pac.y = s.start.y; s.pac.p = 0; s.pac.moving = false; s.pac.want = null;
    const dir = ['left', 'right', 'up'].find((d) => P.canMove(s.grid, s.pac.x, s.pac.y, d));
    const n = P.nextTile(s.pac.x, s.pac.y, dir);
    s.ghosts.forEach((g) => { g.wait = 999; g.eaten = false; g.moving = false; g.p = 0; g.x = s.house.x; g.y = s.house.y; });
    s.ghosts[0].x = n.x; s.ghosts[0].y = n.y;
    window.__tap({ left: 'ArrowLeft', right: 'ArrowRight', up: 'ArrowUp' }[dir]);
    return { score: s.score, lives: s.lives };
  });
  await page.waitForTimeout(400);
  r = await page.evaluate(() => { const s = window.RA.current.debug.state; return { eaten: s.ghosts[0].eaten, score: s.score, lives: s.lives, over: s.over }; });
  check('Raccoon-man: touching a scared chaser catches it (200 points, no life lost)', r.eaten && r.score - before.score >= 200 && r.score - before.score <= 220 && r.lives === before.lives, JSON.stringify(before) + ' -> ' + JSON.stringify(r));

  // Bolle: last rows. No more rows come.
  await page.evaluate(() => window.RA.openGame('bubbles'));
  await page.keyboard.press('Enter');
  await page.evaluate(() => {
    // STATE WRITE: no rows left, two bubbles of the kind in the shooter on the ceiling, in front of it.
    const s = window.RA.current.debug.state;
    s.rowsLeft = 0;
    s.grid.clear();
    s.grid.set('0,4', s.cur);
    s.grid.set('0,5', s.cur);
  });
  await page.waitForTimeout(100);
  const hud = await texts(page);
  check('Bolle: with no rows left the HUD says that no more rows come, no broken text', hasText(hud, /niente/i) && !hasText(hud, /tir[io]/i) && hudBad(hud).length === 0, hud.filter((t) => t.length > 3).join(','));
  await shot(page, 'rare-bubbles-last');
  const p = await canvasPoint(page, 180, 100);
  await page.mouse.move(p.x, p.y);
  await page.mouse.down();
  await page.mouse.up();
  await page.waitForFunction(() => !window.RA.current.debug.started, null, { timeout: 5000 });
  r = await state(page, bubSnap);
  card = await overlayText(page);
  check('Bolle: popping the last bubbles wins the level (30 points + 100 prize)', r.won && r.size === 0 && r.score === 130 && cardHas(card, 'Punti', 130), JSON.stringify(r) + card);

  // Tetris at a high level: gravity 0.05 s per row; the game stays playable and stable.
  await page.evaluate(() => window.RA.openGame('tetris'));
  await page.keyboard.press('Enter');
  await page.evaluate(() => { /* STATE WRITE: level 15 */ const s = window.RA.current.debug.state; s.lines = 140; s.level = 15; });
  await page.waitForTimeout(1500);
  r = await state(page, tetrisSnap);
  check('Tetris: at level 15 pieces fall and lock by gravity alone', r.blocks >= 4 && !r.fullRows, JSON.stringify({ blocks: r.blocks, over: r.over }));
  await shot(page, 'rare-tetris-level15');
  check('no page errors', page.errors.length === 0, page.errors.join(' | '));
  await page.context().close();
}


// =====================================================================================
// SOAK: many games with random keys and clicks on the simulated display (fast). It checks
// that nothing throws, the cards always come and go, and the state stays inside its limits.
// =====================================================================================
function soakRun(arg) {
  const RA = window.RA;
  const id = arg.id;
  let seed = arg.seed;
  const rnd = function () { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  const KEYS = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', ' ', 'a', 'd', 'w', 's', 'x'];
  let pausedByMe = false;
  let pausedScore = 0;
  const held = {};
  const problems = [];
  const stats = { games: 0, best: 0, frames: 0, wins: 0, pauses: 0 };
  const bad = function (msg) { if (problems.length < 8 && problems.indexOf(msg) < 0) problems.push(msg); };
  if (RA.currentId !== id) RA.openGame(id);
  const canvas = document.querySelector('.arcade-stage canvas');
  const frames = Math.round(arg.seconds * 60);
  let lastScore = 0;
  for (let f = 0; f < frames; f++) {
    const d = RA.current.debug;
    const cards = document.querySelectorAll('.overlay').length;
    if (cards > 1) bad('two cards at once');
    if (!d.started) {
      if (cards !== 1) bad('game stopped without a card');
      // Start with Enter or with the button, after a short random wait.
      if (rnd() < 0.2) {
        if (rnd() < 0.5) window.__tap('Enter'); else document.querySelector('.overlay button.big').click();
        if (!RA.current.debug.started) bad('the card did not start the game');
        if (document.querySelectorAll('.overlay').length !== 0) bad('the card stayed after the start');
        stats.games += 1;
        lastScore = RA.current.debug.state.score;
      }
    } else {
      // Random keys: press and release at random.
      if (rnd() < 0.12) {
        const k = KEYS[Math.floor(rnd() * KEYS.length)];
        if (held[k]) { held[k] = false; window.__key('keyup', k); } else { held[k] = true; window.__key('keydown', k); }
      }
      // Now and then: pause with P, stay paused for some frames (keys keep coming), resume with P.
      if (!pausedByMe && rnd() < 0.004) {
        window.__tap('p');
        pausedByMe = true;
        stats.pauses += 1;
        pausedScore = d.state.score;
      } else if (pausedByMe) {
        if (window.__t.texts.indexOf('PAUSA') < 0) bad('no PAUSA text while paused');
        if (d.state.score !== pausedScore) bad('score changed while paused');
        if (rnd() < 0.08) { window.__tap('p'); pausedByMe = false; }
      }
      if (id === 'bubbles' && rnd() < 0.05) {
        const r = canvas.getBoundingClientRect();
        const init = { clientX: r.left + rnd() * r.width, clientY: r.top + rnd() * r.height * 0.8, bubbles: true };
        canvas.dispatchEvent(new MouseEvent('mousemove', init));
        if (rnd() < 0.7) canvas.dispatchEvent(new MouseEvent('mousedown', init));
      }
    }
    window.__vtick(1, 1000 / 60);
    stats.frames += 1;
    // Limits of the state.
    const s = RA.current.debug.state;
    if (typeof s.score !== 'number' || !isFinite(s.score) || s.score < 0) bad('score ' + s.score);
    if (RA.current.debug.started && s.score < lastScore) bad('score went down ' + lastScore + ' -> ' + s.score);
    lastScore = s.score;
    stats.best = Math.max(stats.best, s.score);
    if (s.won && !RA.current.debug.started && !s.counted) { s.counted = true; stats.wins += 1; }
    if (id === 'tetris') {
      const T = RA.modules.tetris;
      if (s.board.some((r) => r.every((v) => v !== null))) bad('full row not cleared');
      if (s.cur && T.collides(s.board, s.cur.type, s.cur.rot, s.cur.x, s.cur.y)) bad('piece overlaps the board');
      if (s.level !== Math.floor(s.lines / 10) + 1) bad('level');
    } else if (id === 'snake') {
      const keys = s.snake.map((p) => p.x + ',' + p.y);
      if (new Set(keys).size !== keys.length) bad('snake overlaps itself');
      if (s.food && keys.indexOf(s.food.x + ',' + s.food.y) >= 0) bad('food on the snake');
      if (s.snake.some((p) => p.x < 0 || p.y < 0 || p.x >= 24 || p.y >= 18)) bad('snake outside the field');
    } else if (id === 'invaders') {
      if (s.px < 20 || s.px > 460) bad('player outside ' + s.px);
      if (s.lives < 0 || s.lives > 3) bad('lives ' + s.lives);
      if (s.pBullets.length > 2) bad('more than 2 bullets');
      if (s.eBullets.length > 40) bad('too many enemy shots ' + s.eBullets.length);
    } else if (id === 'pacman') {
      let n = 0;
      s.grid.forEach((r) => r.forEach((c) => { if (c === '.' || c === 'o') n += 1; }));
      if (n !== s.acornsLeft) bad('dot counter ' + s.acornsLeft + ' vs ' + n);
      if (s.grid[s.pac.y][s.pac.x] === '#') bad('player in a wall');
      if (s.ghosts.some((g) => s.grid[g.y][g.x] === '#')) bad('ghost in a wall');
      if (s.lives < 0 || s.lives > 3) bad('lives ' + s.lives);
    } else if (id === 'bubbles') {
      if (!s.moving && !s.over && s.grid.size && !new Set(s.grid.values()).has(s.cur)) bad('shooter holds a kind that is not on the board');
      if (Math.abs(s.angle) > 1.35 + 1e-9) bad('angle ' + s.angle);
      s.grid.forEach((v, k) => { if (Number(k.split(',')[0]) < s.base) bad('bubble above the ceiling'); });
    }
    if (f % 30 === 0) {
      const t = window.__t.texts;
      for (let i = 0; i < t.length; i++) if (/NaN|undefined|null|Infinity/.test(t[i])) bad('HUD text "' + t[i] + '"');
    }
  }
  Object.keys(held).forEach((k) => { if (held[k]) window.__key('keyup', k); });
  if (pausedByMe) window.__tap('p');
  return { stats: stats, problems: problems, seed: seed };
}

async function scenarioSoak(browser) {
  const check = makeChecker('soak');
  const page = await newPage(browser, { virtualClock: true });
  const SECONDS = Number(process.env.SOAK_SECONDS || 120); // simulated seconds per game
  for (const id of ARCADE) {
    const total = { games: 0, best: 0, frames: 0, wins: 0, pauses: 0 };
    const problems = [];
    let seed = 12345 + id.length * 977;
    for (let done = 0; done < SECONDS; done += 20) {
      const r = await page.evaluate(soakRun, { id: id, seconds: 20, seed: seed });
      seed = r.seed;
      total.games += r.stats.games;
      total.frames += r.stats.frames;
      total.wins += r.stats.wins;
      total.pauses += r.stats.pauses;
      total.best = Math.max(total.best, r.stats.best);
      r.problems.forEach((p) => { if (!problems.includes(p)) problems.push(p); });
    }
    check(id + ': ' + SECONDS + ' s of random play (' + total.games + ' games) keeps the state and the cards in order', problems.length === 0, problems.join('; '));
    check(id + ': random play started several games and paused some of them', total.games >= 2 && total.pauses >= 2, JSON.stringify(total));
    check.note(id + ': ' + total.games + ' games, best score ' + total.best + (total.wins ? ', levels won ' + total.wins : ''));
    await page.evaluate(() => window.RA.showMenu());
  }
  check('no page errors', page.errors.length === 0, page.errors.join(' | '));
  await page.context().close();
}

// =====================================================================================
const SCENARIOS = {
  shell: scenarioShell,
  tetris: scenarioTetris,
  snake: scenarioSnake,
  invaders: scenarioInvaders,
  pacman: scenarioPacman,
  bubbles: scenarioBubbles,
  framerate: scenarioFramerate,
  rare: scenarioRare,
  soak: scenarioSoak,
};

(async () => {
  const names = Object.keys(SCENARIOS).filter((n) => !ONLY.length || ONLY.includes(n));
  const unknown = ONLY.filter((n) => !SCENARIOS[n]);
  if (unknown.length) { console.error('Unknown scenario: ' + unknown.join(', ') + '. Known: ' + Object.keys(SCENARIOS).join(', ')); process.exit(2); }
  const t0 = Date.now();
  const browser = await chromium.launch();
  // The scenarios run side by side, each in its own browser context (own storage).
  // The ones that play in real time go first; the ones on the simulated display use a lot
  // of processor time, so they run afterwards and do not slow the real-time games down.
  const HEAVY = ['framerate', 'soak'];
  const runAll = (list) => Promise.all(list.map(async (n) => {
    const t = Date.now();
    try {
      await SCENARIOS[n](browser);
    } catch (e) {
      results.push({ scenario: n, name: 'scenario crashed', ok: false, detail: String(e && e.stack ? e.stack.split('\n').slice(0, 4).join(' / ') : e), known: '' });
      console.log('  CRASH [' + n + '] ' + (e && e.message));
    }
    console.log('  done: ' + n + ' (' + Math.round((Date.now() - t) / 1000) + ' s)');
  }));
  await runAll(names.filter((n) => !HEAVY.includes(n)));
  await runAll(names.filter((n) => HEAVY.includes(n)));
  await browser.close();

  const failed = results.filter((r) => !r.ok && !r.known);
  const known = results.filter((r) => !r.ok && r.known);
  const fixed = results.filter((r) => r.ok && r.known);
  console.log('\n===== Arcade e2e summary =====');
  names.forEach((n) => {
    const rs = results.filter((r) => r.scenario === n);
    console.log(n.padEnd(10) + rs.filter((r) => r.ok).length + '/' + rs.length + ' checks passed');
  });
  notes.forEach((l) => console.log(l));
  if (known.length) {
    console.log('\nKnown bugs still present (' + known.length + '):');
    known.forEach((r) => console.log('  ' + r.known + ' [' + r.scenario + '] ' + r.name + (r.detail ? ' -> ' + r.detail : '')));
  }
  if (fixed.length) console.log('\nKnown-bug checks that pass now (remove the mark): ' + fixed.map((r) => r.known + ' [' + r.scenario + ']').join(', '));
  if (failed.length) {
    console.log('\nFAILED (' + failed.length + '):');
    failed.forEach((r) => console.log('  [' + r.scenario + '] ' + r.name + (r.detail ? ' -> ' + r.detail : '')));
  }
  const bad = failed.length + (STRICT ? known.length : 0);
  console.log('\n' + (bad ? 'RESULT: FAIL' : 'RESULT: OK') + ' - ' + results.length + ' checks, ' + failed.length + ' failed, ' + known.length + ' known bugs, ' + Math.round((Date.now() - t0) / 1000) + ' s');
  process.exit(bad ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
