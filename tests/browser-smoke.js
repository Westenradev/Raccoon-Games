// Browser smoke test: opens every game in headless Chromium, presses keys and clicks at random,
// and reports any page error. Run: node tests/browser-smoke.js [rounds]
// Uses the Playwright package that is already installed on this machine.
const path = require('path');
const { chromium } = require('playwright');

const GAMES = ['Scopa', 'Briscola', 'Solitario', 'Sudoku', 'Mahjong', 'Dama', 'Bolle Procioni', 'Tetris', 'Raccoon Defender', 'Raccoon-man', 'Snake'];
const KEYS = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', ' ', 'a', 'd', 'w', 's', 'p', '1', '5', '9', 'Backspace'];
const ROUNDS = Number(process.argv[2] || 40);

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1120, height: 840 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  const url = 'file://' + path.join(__dirname, '..', 'src', 'index.html');
  await page.goto(url);
  await page.waitForSelector('.tile');
  const report = [];

  for (const title of GAMES) {
    const before = errors.length;
    await page.locator('.tile', { hasText: title }).first().click();
    await page.waitForTimeout(300);
    // Start overlays: click the first big button of the overlay.
    for (let i = 0; i < 3; i++) {
      const start = page.locator('.overlay button.big').first();
      if (await start.count()) { await start.click().catch(() => {}); await page.waitForTimeout(150); }
    }
    let clicks = 0;
    for (let r = 0; r < ROUNDS; r++) {
      const k = KEYS[Math.floor(Math.random() * KEYS.length)];
      await page.keyboard.down(k).catch(() => {});
      await page.waitForTimeout(60 + Math.random() * 120);
      await page.keyboard.up(k).catch(() => {});
      if (r % 3 === 0) {
        // Click a random clickable element from the current game.
        const targets = page.locator('#stage .pcard:not(.back):not(.empty), #stage .cell, #stage .sq.dark, #stage .mj-tile.free, #stage .col, #stage .num, #stage .btn:not(.ghost), #stage .tableau .col');
        const n = await targets.count();
        if (n) {
          const idx = Math.floor(Math.random() * n);
          await targets.nth(idx).click({ timeout: 800, force: true }).then(() => clicks++).catch(() => {});
        }
      }
      if (r % 7 === 0) {
        const box = await page.locator('#stage canvas').first().boundingBox().catch(() => null);
        if (box) await page.mouse.click(box.x + box.width * Math.random(), box.y + box.height * Math.random()).catch(() => {});
      }
      if (r % 10 === 0) {
        // Restart if a game over screen appears.
        const again = page.locator('.overlay button.big').first();
        if (await again.count()) await again.click().catch(() => {});
      }
    }
    const bad = await page.locator('text=Ops! Questo gioco non si avvia.').count();
    if (bad) errors.push(title + ': mount failed');
    report.push({ game: title, clicks: clicks, newErrors: errors.length - before });
    await page.locator('#home').click().catch(() => {});
    await page.waitForTimeout(100);
  }

  await browser.close();
  console.log(JSON.stringify(report, null, 1));
  if (errors.length) {
    console.log('ERRORS:\n' + errors.slice(0, 40).join('\n'));
    process.exit(1);
  }
  console.log('OK: no page errors in ' + GAMES.length + ' games.');
})().catch((e) => { console.error(e); process.exit(1); });
