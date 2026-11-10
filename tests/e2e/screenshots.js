// Takes a screenshot of the menu and of every game in the middle of a game.
// Run: node tests/e2e/screenshots.js [output folder]
// Uses the Playwright package that is already installed on the machine.
const path = require('path');
const fs = require('fs');
const { chromium } = require('playwright');

const OUT = path.resolve(process.argv[2] || path.join(__dirname, '..', '..', 'screenshots'));
const URL = 'file://' + path.join(__dirname, '..', '..', 'src', 'index.html');

// Each entry prepares a game so the picture shows real play.
const GAMES = {
  async scopa(page) {
    // Play a few cards with real clicks.
    for (let i = 0; i < 5; i++) {
      await page.waitForFunction(() => {
        const d = window.RA.current.debug;
        return !d.busy && d.state.turn === 0 && !d.state.ended;
      });
      const option = page.locator('.actions .btn:not(.ghost)').first();
      if (await option.count()) await option.click();
      else await page.locator('.hand.me .pcard').first().click();
    }
    await page.waitForFunction(() => !window.RA.current.debug.busy);
  },
  async briscola(page) {
    for (let i = 0; i < 4; i++) {
      await page.waitForFunction(() => {
        const d = window.RA.current.debug;
        return !d.busy && d.state.turn === 0;
      });
      await page.locator('.hand.me .pcard').first().click();
    }
    // Stop while a finished trick is on the table.
    await page.waitForSelector('.slot.winner', { timeout: 5000 }).catch(() => {});
  },
  async solitario(page) {
    for (let i = 0; i < 60; i++) {
      const hint = await page.evaluate(() => {
        const h = window.RA.current.debug.findHint();
        if (!h) return null;
        if (h.draw) return { draw: true };
        return h.src;
      });
      if (!hint) break;
      if (hint.draw) await page.locator('[data-role="stock"]').click();
      else if (hint.type === 'waste') await page.locator('[data-role="waste"]').click();
      // Click the top strip of the card: the rest can be under the next card of the column.
      else await page.locator('.col[data-col="' + hint.col + '"] .pcard').nth(hint.idx).click({ position: { x: 30, y: 8 } });
      const dest = page.locator('.pcard.dest, .col.dest').first();
      if (await dest.count()) await dest.click();
    }
  },
  async sudoku(page) {
    const cells = await page.evaluate(() => {
      const g = window.RA.current.debug.game;
      const out = [];
      for (let i = 0; i < 81 && out.length < 14; i += 3) if (!g.givens[i]) out.push([i, g.solution[i]]);
      return out;
    });
    for (const [i, v] of cells) {
      await page.locator('.cell[data-i="' + i + '"]').click();
      await page.keyboard.press(String(v));
    }
  },
  async mahjong(page) {
    for (let i = 0; i < 24; i++) {
      const pair = await page.evaluate(() => {
        const p = window.RA.current.debug.findPair();
        return p ? [p[0].id, p[1].id] : null;
      });
      if (!pair) break;
      await page.locator('.mj-tile[data-id="' + pair[0] + '"]').click();
      await page.locator('.mj-tile[data-id="' + pair[1] + '"]').click();
    }
    const last = await page.evaluate(() => {
      const p = window.RA.current.debug.findPair();
      return p ? p[0].id : null;
    });
    if (last !== null) await page.locator('.mj-tile[data-id="' + last + '"]').click();
  },
  async dama(page) {
    for (let i = 0; i < 14; i++) {
      await page.waitForFunction(() => {
        const d = window.RA.current.debug;
        return d.over || (d.turn === 'w' && !d.thinking);
      });
      const mv = await page.evaluate(() => {
        const d = window.RA.current.debug;
        if (d.over) return null;
        const moves = d.legalMoves();
        // Prefer captures, then the move that goes farthest forward.
        moves.sort((a, b) => b.caps.length - a.caps.length || a.to - b.to);
        return moves[0];
      });
      if (!mv) break;
      await page.locator('.sq[data-sq="' + mv.from + '"]').click();
      await page.locator('.sq[data-sq="' + mv.to + '"]').click();
    }
    await page.waitForFunction(() => {
      const d = window.RA.current.debug;
      return d.over || (d.turn === 'w' && !d.thinking);
    });
    const from = await page.evaluate(() => {
      const d = window.RA.current.debug;
      return d.over ? null : d.legalMoves()[0].from;
    });
    if (from !== null) await page.locator('.sq[data-sq="' + from + '"]').click();
  },
  async bubbles(page) {
    await page.locator('.overlay button.big').click();
    const box = await page.locator('canvas').boundingBox();
    for (const fx of [0.2, 0.8, 0.35, 0.65, 0.5, 0.1, 0.9]) {
      await page.mouse.move(box.x + box.width * fx, box.y + box.height * 0.3);
      await page.mouse.down();
      await page.mouse.up();
      await page.waitForFunction(() => !window.RA.current.debug.state.moving);
    }
    await page.mouse.move(box.x + box.width * 0.3, box.y + box.height * 0.45);
  },
  async tetris(page) {
    await page.locator('.overlay button.big').click();
    const keys = ['ArrowLeft', 'ArrowLeft', 'ArrowLeft', 'Space', 'ArrowRight', 'ArrowRight', 'ArrowRight', 'ArrowRight', 'Space',
      'ArrowUp', 'Space', 'ArrowLeft', 'ArrowUp', 'Space', 'ArrowRight', 'ArrowRight', 'Space', 'ArrowUp', 'ArrowLeft', 'ArrowLeft', 'Space'];
    for (const k of keys) {
      await page.keyboard.press(k === 'Space' ? ' ' : k);
      await page.waitForTimeout(60);
    }
    await page.waitForTimeout(500);
  },
  async invaders(page) {
    await page.locator('.overlay button.big').click();
    await page.keyboard.down(' ');
    for (const k of ['ArrowLeft', 'ArrowRight', 'ArrowRight', 'ArrowLeft']) {
      await page.keyboard.down(k);
      await page.waitForTimeout(900);
      await page.keyboard.up(k);
    }
    await page.keyboard.up(' ');
  },
  async pacman(page) {
    await page.locator('.overlay button.big').click();
    await page.waitForTimeout(1300);
    for (const k of ['ArrowLeft', 'ArrowUp', 'ArrowLeft', 'ArrowUp', 'ArrowRight']) {
      await page.keyboard.press(k);
      await page.waitForTimeout(700);
    }
  },
  async snake(page) {
    await page.locator('.overlay button.big').click();
    // A small bot goes to each fish, so the picture shows a longer tail.
    await page.evaluate(() => new Promise((resolve) => {
      const send = (key) => {
        window.dispatchEvent(new KeyboardEvent('keydown', { key: key, bubbles: true }));
        window.dispatchEvent(new KeyboardEvent('keyup', { key: key, bubbles: true }));
      };
      const timer = setInterval(() => {
        const d = window.RA.current && window.RA.current.debug;
        if (!d || !d.started || d.state.eaten >= 8) {
          clearInterval(timer);
          return resolve();
        }
        const s = d.state;
        const head = s.snake[0];
        const want = [];
        if (s.food.x > head.x) want.push('ArrowRight');
        if (s.food.x < head.x) want.push('ArrowLeft');
        if (s.food.y > head.y) want.push('ArrowDown');
        if (s.food.y < head.y) want.push('ArrowUp');
        const opposite = { right: 'ArrowLeft', left: 'ArrowRight', up: 'ArrowDown', down: 'ArrowUp' }[s.dir];
        const pick = want.filter((k) => k !== opposite)[0] || (want.length ? (s.dir === 'left' || s.dir === 'right' ? 'ArrowUp' : 'ArrowLeft') : null);
        if (pick && !s.queue.length) send(pick);
      }, 30);
    }));
  },
};

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 832 }, deviceScaleFactor: 2 });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto(URL);
  await page.waitForSelector('.tile');
  await page.screenshot({ path: path.join(OUT, '00-menu.png') });
  let n = 1;
  for (const id of Object.keys(GAMES)) {
    await page.evaluate((g) => window.RA.openGame(g), id);
    await page.waitForTimeout(200);
    try {
      await GAMES[id](page);
    } catch (e) {
      errors.push(id + ': ' + e.message.split('\n')[0]);
    }
    await page.waitForTimeout(150);
    const file = String(n++).padStart(2, '0') + '-' + id + '.png';
    await page.screenshot({ path: path.join(OUT, file) });
    console.log('saved ' + file);
  }
  await browser.close();
  if (errors.length) {
    console.log('ERRORS:\n' + errors.join('\n'));
    process.exit(1);
  }
  console.log('OK: ' + n + ' screenshots in ' + OUT);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
