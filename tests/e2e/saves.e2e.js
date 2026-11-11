// Browser test of the saved games. For each of the 11 games it plays a little, leaves with Esc,
// comes back and checks: the menu marks the game, the game asks "resume or new", "resume"
// gives back exactly the same position, and "new" starts over and forgets the old game.
// It also checks that closing the page (a reload) keeps the game in progress.
// Run: node tests/e2e/saves.e2e.js      Exit code 0 = all checks passed.
const path = require('path');
const { chromium } = require('playwright');

const URL = 'file://' + path.join(__dirname, '..', '..', 'src', 'index.html');
const TABLE = ['scopa', 'briscola', 'solitario', 'sudoku', 'mahjong', 'dama'];
const ARCADE = ['tetris', 'snake', 'invaders', 'pacman', 'bubbles'];
let page;
let checks = 0;
const failures = [];
function check(name, ok, detail) {
  checks += 1;
  if (!ok) {
    failures.push(name);
    console.log('  FAIL: ' + name + (detail ? ' -> ' + detail : ''));
  }
}
const debug = (fn, arg) => page.evaluate(fn, arg);
const ready = (fn) => page.waitForFunction(fn, null, { timeout: 15000 });

// ---- how to make some progress in each game (with real clicks and keys) ----
const PLAY = {
  async scopa() {
    for (let i = 0; i < 2; i++) {
      await ready(() => { const d = window.RA.current.debug; return d.state && !d.busy && d.state.turn === 0 && !d.state.ended; });
      await page.locator('.hand.me .pcard').first().click();
      const option = page.locator('.actions .btn:not(.ghost)').first();
      if (await option.count()) await option.click();
    }
    await ready(() => { const d = window.RA.current.debug; return !d.busy && d.state.turn === 0; });
  },
  async briscola() {
    for (let i = 0; i < 2; i++) {
      await ready(() => { const d = window.RA.current.debug; return d.state && !d.busy && d.state.turn === 0; });
      await page.locator('.hand.me .pcard').first().click();
    }
    await ready(() => { const d = window.RA.current.debug; return !d.busy && d.state.turn === 0; });
  },
  async solitario() {
    await page.locator('[data-role="stock"]').click();
    await page.locator('[data-role="stock"]').click();
  },
  async sudoku() {
    const cells = await debug(() => {
      const d = window.RA.current.debug;
      const out = [];
      for (let i = 0; i < 81 && out.length < 3; i++) if (d.board[i] !== d.game.solution[i]) out.push([i, d.game.solution[i]]);
      return out;
    });
    for (const [i, v] of cells) {
      await page.locator('.cell[data-i="' + i + '"]').click();
      await page.keyboard.press(String(v));
    }
  },
  async mahjong() {
    for (let i = 0; i < 2; i++) {
      const pair = await debug(() => { const p = window.RA.current.debug.findPair(); return [p[0].id, p[1].id]; });
      await page.locator('.mj-tile[data-id="' + pair[0] + '"]').click();
      await page.locator('.mj-tile[data-id="' + pair[1] + '"]').click();
    }
  },
  async dama() {
    const mv = await debug(() => window.RA.current.debug.legalMoves()[0]);
    await page.locator('.sq[data-sq="' + mv.from + '"]').click();
    await page.locator('.sq[data-sq="' + mv.to + '"]').click();
    await ready(() => { const d = window.RA.current.debug; return d.turn === 'w' && !d.thinking; });
  },
  async tetris() {
    await page.keyboard.press('ArrowLeft');
    await page.keyboard.press(' ');
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press(' ');
    await page.waitForTimeout(200);
  },
  async snake() {
    await page.keyboard.press('ArrowUp');
    await page.waitForTimeout(500);
  },
  async invaders() {
    await page.keyboard.down(' ');
    await page.keyboard.down('ArrowLeft');
    await page.waitForTimeout(900);
    await page.keyboard.up('ArrowLeft');
    await page.keyboard.up(' ');
  },
  async pacman() {
    await page.waitForTimeout(1300);
    await page.keyboard.press('ArrowLeft');
    await page.waitForTimeout(900);
  },
  async bubbles() {
    const box = await page.locator('canvas').boundingBox();
    await page.mouse.move(box.x + box.width * 0.3, box.y + box.height * 0.3);
    await page.mouse.down();
    await page.mouse.up();
    await ready(() => !window.RA.current.debug.state.moving);
  },
};

// ---- a text that describes the position of a game, to compare before and after ----
const SIG = {
  scopa: () => { const d = window.RA.current.debug; const s = d.state; return JSON.stringify([d.match.scores, d.match.round, s.deck.length, s.table.map((c) => c.id), s.hands.map((h) => h.map((c) => c.id)), s.captured.map((c) => c.length), s.scope, s.turn]); },
  briscola: () => { const s = window.RA.current.debug.state; return JSON.stringify([s.deck.map((c) => c.id), s.trumpSuit, s.hands.map((h) => h.map((c) => c.id)), s.pile.map((p) => p.length), s.turn, s.leader, window.RA.current.debug.wins]); },
  solitario: () => JSON.stringify(window.RA.current.debug.state),
  sudoku: () => { const d = window.RA.current.debug; return JSON.stringify([d.board, d.game.solution, d.level]); },
  mahjong: () => JSON.stringify(window.RA.current.debug.tiles.map((t) => [t.id, t.x, t.y, t.l, t.type, t.face])),
  dama: () => { const d = window.RA.current.debug; return JSON.stringify([d.board, d.turn, d.level]); },
  tetris: () => { const s = window.RA.current.debug.state; return JSON.stringify([s.board, s.cur, s.next, s.score, s.lines, s.level]); },
  snake: () => { const s = window.RA.current.debug.state; return JSON.stringify([s.snake, s.dir, s.food, s.score, s.eaten]); },
  invaders: () => { const s = window.RA.current.debug.state; return JSON.stringify([s.invaders, s.fx, s.fy, s.score, s.lives, s.wave, s.shields, Math.round(s.px)]); },
  pacman: () => { const s = window.RA.current.debug.state; return JSON.stringify([s.grid, s.score, s.lives, s.level, s.acornsLeft, s.pac.x, s.pac.y, s.ghosts.map((g) => [g.x, g.y, g.eaten])]); },
  bubbles: () => { const s = window.RA.current.debug.state; return JSON.stringify([Array.from(s.grid.entries()), s.base, s.cur, s.next, s.shots, s.rowsLeft, s.score, s.level]); },
};

const isArcade = (id) => ARCADE.indexOf(id) >= 0;
const open = async (id) => { await page.locator('button.tile[data-game="' + id + '"]').click(); await page.waitForTimeout(150); };
const hasSave = (id) => page.evaluate((k) => { const raw = localStorage.getItem('ra.save.' + k); return !!raw && raw !== 'null'; }, id);
const badge = (id) => page.locator('button.tile[data-game="' + id + '"] .tile-badge').count();
const asks = () => page.locator('[data-save="new"]').count();
const resumeButton = (id) => (isArcade(id) ? page.locator('.overlay button.big') : page.locator('[data-save="resume"]'));
// Arcade games are stopped with P before the position is read, so nothing moves in between.
async function freeze(id) {
  if (!isArcade(id)) return;
  await page.keyboard.press('p');
  await page.waitForTimeout(120);
}

async function oneGame(id) {
  console.log(id);
  // 1. fresh start: no question, no mark on the menu
  check(id + ': no saved game at the beginning', !(await hasSave(id)) && (await badge(id)) === 0);
  await open(id);
  check(id + ': a first start does not ask about a saved game', (await asks()) === 0);
  if (isArcade(id)) await page.locator('.overlay button.big').click();
  await PLAY[id]();
  await freeze(id);
  const before = await debug(SIG[id]);

  // 2. leave with Esc: the game is kept and the menu shows it
  await page.keyboard.press('Escape');
  await page.waitForSelector('button.tile');
  check(id + ': leaving with Esc keeps the game', await hasSave(id));
  check(id + ': the menu marks the game as waiting', (await badge(id)) === 1);

  // 3. open again, then leave without answering: the saved game must still be there
  await open(id);
  check(id + ': the game asks "resume or new"', (await asks()) === 1 && (await resumeButton(id).count()) === 1);
  await page.keyboard.press('Escape');
  check(id + ': leaving at the question keeps the saved game', await hasSave(id));

  // 4. resume: the position is exactly the one that was left
  await open(id);
  await resumeButton(id).click();
  await page.waitForTimeout(isArcade(id) ? 250 : 150);
  const after = await debug(SIG[id]);
  check(id + ': "resume" gives back the same position', after === before, 'before ' + before.slice(0, 160) + ' / after ' + after.slice(0, 160));
  if (isArcade(id)) {
    // The game moves again after the "PRONTI!" pause.
    // (Snake gets a shorter wait, so it does not reach the hedge.)
    await page.waitForTimeout(id === 'snake' ? 1750 : 2600);
    if (id === 'bubbles') {
      const box = await page.locator('canvas').boundingBox();
      await page.mouse.click(box.x + box.width * 0.6, box.y + box.height * 0.3);
      await page.waitForFunction(() => { const s = window.RA.current.debug.state; return !s.moving && s.shots >= 2; }, null, { timeout: 8000 });
    }
    if (id === 'tetris') await page.keyboard.press(' ');
    if (id === 'pacman') { await page.keyboard.press('ArrowRight'); await page.waitForTimeout(600); }
    check(id + ': the resumed game runs', (await debug(SIG[id])) !== before);
  } else {
    await PLAY[id]();
    check(id + ': the resumed game can be played on', (await debug(SIG[id])) !== before);
  }

  // 5. closing the page keeps the game too
  await freeze(id);
  const beforeReload = await debug(SIG[id]);
  await page.reload();
  await page.waitForSelector('button.tile');
  check(id + ': closing the page keeps the game', (await hasSave(id)) && (await badge(id)) === 1);
  await open(id);
  await resumeButton(id).click();
  await page.waitForTimeout(250);
  check(id + ': the game comes back after the page was closed', (await debug(SIG[id])) === beforeReload);

  // 6. "new game" starts over and forgets the old game
  await page.keyboard.press('Escape');
  await open(id);
  await page.locator('[data-save="new"]').click();
  await page.waitForTimeout(250);
  check(id + ': "new game" forgets the saved game', !(await hasSave(id)));
  const fresh = await debug(SIG[id]);
  check(id + ': "new game" starts a different game', fresh !== beforeReload);
  await page.keyboard.press('Escape');
  await page.waitForSelector('button.tile');
  if (isArcade(id)) {
    // A new arcade game that was started is in progress, so it is kept.
    check(id + ': a new game left in the middle is kept in turn', (await badge(id)) === 1);
    await open(id);
    await page.locator('[data-save="new"]').click();
    await page.waitForTimeout(100);
    // Lose on purpose where it is quick, to check that a finished game is not kept.
  } else {
    check(id + ': an untouched new game is not kept', (await badge(id)) === 0, 'badge shown');
  }
  await page.evaluate((k) => localStorage.removeItem('ra.save.' + k), id);
  await page.reload();
  await page.waitForSelector('button.tile');
}

(async () => {
  const browser = await chromium.launch();
  page = await browser.newPage({ viewport: { width: 1120, height: 812 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  await page.goto(URL);
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.waitForSelector('button.tile');
  const only = process.argv.slice(2).filter((a) => !a.startsWith('-'));
  for (const id of TABLE.concat(ARCADE)) {
    if (only.length && only.indexOf(id) < 0) continue;
    try {
      await oneGame(id);
    } catch (e) {
      failures.push(id + ': test aborted');
      console.log('  FAIL: ' + id + ': test aborted: ' + String(e.message).split('\n')[0]);
      await page.evaluate(() => localStorage.clear()).catch(() => {});
      await page.goto(URL);
    }
  }

  // A finished game is not kept: lose a Snake game on purpose.
  if (!only.length || only.indexOf('snake') >= 0) {
    await open('snake');
    await page.locator('.overlay button.big').click();
    await page.waitForFunction(() => !window.RA.current.debug.state.alive, null, { timeout: 20000 });
    await page.keyboard.press('Escape');
    await page.waitForSelector('button.tile');
    check('snake: a finished game is not kept', !(await hasSave('snake')) && (await badge('snake')) === 0);
  }

  await browser.close();
  check('no page errors', errors.length === 0, errors.slice(0, 5).join(' | '));
  console.log('\nsaves e2e: ' + checks + ' checks, ' + failures.length + ' failed');
  console.log(failures.length ? 'RESULT: FAIL' : 'RESULT: OK');
  process.exit(failures.length ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
