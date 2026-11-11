// End-to-end test of the three card games (Scopa, Briscola, Solitario) in headless Chromium.
// It plays through the real interface with real clicks. The read-only debug hook of each game
// (window.RA.current.debug) is used only to read the state and to decide what to click.
// The debug.state setter of Solitario is used only to load prepared positions (near-won games,
// blocked games, positions for the double click checks).
//
// Run:  node tests/e2e/cards.e2e.js [--seed N] [--matches 2] [--hands 5] [--games 4]
//                                   [--shots DIR] [--src DIR] [--verbose]
//   --seed N     seed for Math.random in the page and for the test player (default 7)
//   --shots DIR  save screenshots into DIR
//   --src DIR    test another copy of the app (folder that holds index.html)
// Exit code: 0 when every check passes, 1 when a check fails, 2 when the run aborts.
// A full run takes about 90 seconds. The first 15 seconds run in real time, the rest drives
// the page clock (page.clock), so the 0.7 to 1.5 second pauses of the opponent cost no time.
//
// Defects found by earlier runs are covered by ordinary checks: double clicks (one action only),
// the pause before the Scopa points table, the layout of long Solitario columns in low windows,
// a blocked Solitario game, "Completa da solo" stopped by a new game or an undo.
//
// The rules are checked against an independent implementation written in this file,
// not against the game modules. Texts are checked with loose patterns (card names, numbers,
// key words), so a change of wording does not break the test.
//
// Parts of the page this test relies on:
//   [data-card="id"] on every face-up card, .pcard.back on face-down cards,
//   .hand.me / .hand.cpu / .felt / .slot / .slot-name / .slot.winner / .played / .selected / .disabled,
//   .msg, .pill, .actions button, .overlay with one button,
//   Solitario: [data-role="stock|waste|found-N"], .col[data-col], .dest, .hinted.
const path = require('path');
const fs = require('fs');
const { chromium } = require('playwright');

const argv = process.argv.slice(2);
function opt(name, dflt) {
  const i = argv.indexOf('--' + name);
  if (i < 0) return dflt;
  const v = argv[i + 1];
  return v === undefined || v.indexOf('--') === 0 ? true : v;
}
const SEED = Number(opt('seed', 7));
const MATCHES = Number(opt('matches', 2));
const HANDS = Number(opt('hands', 5));
const GAMES = Number(opt('games', 4));
const SHOTS = opt('shots', null);
const VERBOSE = !!opt('verbose', false);
const SRC = opt('src', null);
const URL = 'file://' + path.resolve(SRC || path.join(__dirname, '..', '..', 'src'), 'index.html');

// ---------- small helpers ----------
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
const rnd = makeRng(SEED * 7919 + 13);
const pick = (arr) => arr[Math.floor(rnd() * arr.length)];
const J = (x) => JSON.stringify(x);
const ids = (cards) => cards.map((c) => c.id);
const sortNum = (a) => a.slice().sort((x, y) => x - y);
const sameSet = (a, b) => J(sortNum(a)) === J(sortNum(b));
const nums = (text) => ((text || '').match(/\d+/g) || []).map(Number);

const SUIT_NAMES = ['Coppe', 'Denari', 'Spade', 'Bastoni'];
const RANK_NAMES = { 1: 'Asso', 8: 'Fante', 9: 'Cavallo', 10: 'Re' };
const cardName = (c) => (RANK_NAMES[c.rank] || String(c.rank)) + ' di ' + SUIT_NAMES[c.suit];
const mk = (suit, rank) => ({ id: suit * 10 + rank - 1, suit: suit, rank: rank });
const byId = (id) => mk(Math.floor(id / 10), (id % 10) + 1);
const OPPONENT = /chihuahua|avversario|computer|gatto/i;

const stats = {
  checks: 0,
  scopa: { matches: 0, rounds: 0, humanPlays: 0, cpuPlays: 0, multiChoice: 0, tableChoice: 0, cancels: 0, scope: [0, 0], ignoredClicks: 0, doubleClicks: 0, finals: [] },
  briscola: { hands: 0, tricks: 0, ignoredClicks: 0, doubleClicks: 0, results: [], minShownMs: Infinity },
  solitario: { games: 0, clicks: 0, moves: 0, draws: 0, recycles: 0, undos: 0, multiDest: 0, foundationMoves: 0, hintsShown: 0, refused: 0, naturalWins: 0, blocked: 0, preparedWins: 0 },
  escapes: 0,
};
const failures = new Map(); // key -> { count, first }
const pageErrors = [];

function check(cond, key, detail) {
  stats.checks += 1;
  if (cond) return true;
  const f = failures.get(key) || { count: 0, first: typeof detail === 'function' ? detail() : detail };
  f.count += 1;
  failures.set(key, f);
  if (VERBOSE) console.log('  FAIL ' + key + (f.first !== undefined ? ' :: ' + J(f.first) : ''));
  return false;
}

let browser;
let page;
let fast = false;

async function tick(ms) {
  if (fast) await page.clock.runFor(ms);
  else await page.waitForTimeout(ms);
}
// Polls a page function. Returns its value, or null after maxMs of game time.
async function waitUntil(fn, maxMs, arg) {
  const step = fast ? 100 : 40;
  for (let t = 0; t <= maxMs; t += step) {
    const v = await page.evaluate(fn, arg);
    if (v) return v;
    await tick(step);
  }
  return null;
}
async function goFast() {
  if (fast) return;
  const now = await page.evaluate(() => Date.now());
  await page.clock.pauseAt(now + 50);
  fast = true;
}
async function shot(name) {
  if (!SHOTS) return;
  await page.screenshot({ path: path.join(SHOTS, name + '.png') });
}
async function openFromMenu(title) {
  await page.locator('button.tile', { has: page.locator('.tile-title', { hasText: new RegExp('^' + title + '$') }) }).click();
  const ok = await page.evaluate(() => !!(window.RA.current && window.RA.current.debug));
  if (!ok) {
    const text = await page.evaluate(() => document.getElementById('stage').textContent.slice(0, 300));
    throw new Error(title + ' does not start: ' + text + ' ' + pageErrors.slice(0, 2).join(' | '));
  }
}
async function clickAt(box, fx, fy) {
  await page.mouse.click(box.x + box.width * (fx == null ? 0.5 : fx), box.y + box.height * (fy == null ? 0.5 : fy));
}
// Bounding box of the first match, or null when there is none (never waits).
async function boxOf(sel) {
  const l = page.locator(sel);
  if (!(await l.count())) return null;
  return l.first().boundingBox();
}
function noErrors(where) {
  check(pageErrors.length === 0, 'page/console errors (' + where + ')', () => pageErrors.slice(0, 5));
}
// Checks shared by the three games: pictures load, nothing sticks out of the window.
function layoutChecks(game, lay, where) {
  check(lay.broken.length === 0, game + ': every picture loads', () => ({ where, broken: lay.broken.slice(0, 4) }));
  check(lay.scrollW <= lay.innerW, game + ': the page is not wider than the window', () => ({ where, scrollW: lay.scrollW, innerW: lay.innerW }));
  check(lay.outside === 0, game + ': no card is cut off at the left or right edge of the window', () => ({ where, outside: lay.outside }));
}
// Installed in the page before its scripts run. Shared layout facts and the visible text of a panel.
function installLayoutProbe() {
  window.__e2eResizes = 0;
  window.addEventListener('resize', function () { window.__e2eResizes += 1; });
  // Text of a game panel without the cards and without the overlay; pieces are joined with ' | '.
  window.__e2eText = function (panel) {
    const out = [];
    const w = document.createTreeWalker(panel, NodeFilter.SHOW_TEXT);
    for (let n = w.nextNode(); n; n = w.nextNode()) {
      const t = n.nodeValue.trim();
      if (t && !n.parentElement.closest('.pcard, .overlay')) out.push(t);
    }
    return out.join(' | ');
  };
  window.__e2eLayout = function () {
    const imgs = Array.from(document.querySelectorAll('#stage img'));
    const cards = Array.from(document.querySelectorAll('#stage .pcard'));
    return {
      broken: imgs.filter((i) => i.complete && i.naturalWidth === 0).map((i) => i.getAttribute('src')),
      scrollW: document.documentElement.scrollWidth,
      innerW: window.innerWidth,
      innerH: window.innerHeight,
      outside: cards.filter((c) => { const r = c.getBoundingClientRect(); return r.left < -1 || r.right > window.innerWidth + 1; }).length,
    };
  };
}

// =====================================================================================
// SCOPA
// =====================================================================================
const PRIMIERA = { 7: 21, 6: 18, 1: 16, 5: 15, 4: 14, 3: 13, 2: 12, 8: 10, 9: 10, 10: 10 };

// Independent rule: a single card of the same value has priority over sums.
function scopaOptions(table, rank) {
  const singles = table.filter((c) => c.rank === rank);
  if (singles.length) return singles.map((c) => [c.id]);
  const out = [];
  (function walk(i, left, chosen) {
    if (left === 0) { if (chosen.length) out.push(chosen); return; }
    if (i >= table.length || left < 0) return;
    if (table[i].rank <= left) walk(i + 1, left - table[i].rank, chosen.concat(table[i].id));
    walk(i + 1, left, chosen);
  })(0, rank, []);
  return out;
}
function scopaScore(captured, scope) {
  const pts = [0, 0];
  const count = captured.map((c) => c.length);
  if (count[0] !== count[1]) pts[count[0] > count[1] ? 0 : 1] += 1;
  const den = captured.map((c) => c.filter((x) => x.suit === 1).length);
  if (den[0] !== den[1]) pts[den[0] > den[1] ? 0 : 1] += 1;
  const sette = captured.map((c) => c.some((x) => x.suit === 1 && x.rank === 7));
  if (sette[0]) pts[0] += 1;
  if (sette[1]) pts[1] += 1;
  const prim = captured.map((c) => [0, 1, 2, 3].reduce((sum, s) => sum + Math.max(0, ...c.filter((x) => x.suit === s).map((x) => PRIMIERA[x.rank])), 0));
  if (prim[0] !== prim[1]) pts[prim[0] > prim[1] ? 0 : 1] += 1;
  pts[0] += scope[0];
  pts[1] += scope[1];
  return { pts, count, den, sette, prim };
}

function scopaSnap() {
  return page.evaluate(() => {
    const g = window.RA.current.debug;
    const q = (sel) => Array.from(document.querySelectorAll(sel));
    const panel = document.querySelector('#stage .scopa');
    const ov = panel.querySelector('.overlay');
    const hand = panel.querySelector('.hand.me');
    const hr = hand ? hand.getBoundingClientRect() : null;
    return {
      state: JSON.parse(JSON.stringify(g.state)),
      match: JSON.parse(JSON.stringify(g.match)),
      busy: g.busy,
      lay: window.__e2eLayout(),
      dom: {
        panels: q('#stage .game-panel').length,
        text: window.__e2eText(panel),
        pills: q('.scopa .pill').map((e) => e.textContent),
        table: q('.scopa .felt [data-card]:not(.played)').map((e) => ({ id: Number(e.dataset.card), selected: e.classList.contains('selected'), disabled: e.classList.contains('disabled') })),
        played: q('.scopa .felt .played[data-card]').map((e) => Number(e.dataset.card)),
        hand: q('.scopa .hand.me [data-card]').map((e) => ({ id: Number(e.dataset.card), disabled: e.classList.contains('disabled'), selected: e.classList.contains('selected') })),
        handBottom: hr ? hr.bottom + window.scrollY : null,
        cpuBacks: q('.scopa .hand.cpu .pcard.back').length,
        msg: (panel.querySelector('.msg') || {}).textContent,
        buttons: q('.scopa .actions button').map((e) => e.textContent),
        overlay: ov ? {
          h2: (ov.querySelector('h2') || {}).textContent,
          rows: Array.from(ov.querySelectorAll('tr')).map((tr) => Array.from(tr.children).map((td) => td.textContent)),
          buttons: Array.from(ov.querySelectorAll('button')).map((b) => b.textContent),
        } : null,
      },
    };
  });
}

function scopaInvariants(s, where) {
  const st = s.state;
  const all = ids(st.deck).concat(ids(st.table), ids(st.hands[0]), ids(st.hands[1]), ids(st.captured[0]), ids(st.captured[1]));
  check(all.length === 40 && new Set(all).size === 40, 'scopa: 40 different cards accounted for', () => ({ where, n: all.length, uniq: new Set(all).size }));
  check([30, 24, 18, 12, 6, 0].indexOf(st.deck.length) >= 0, 'scopa: deck size is a multiple of 6', st.deck.length);
  check(st.hands[0].length <= 3 && st.hands[1].length <= 3, 'scopa: at most 3 cards in hand');
  check(Math.abs(st.hands[0].length - st.hands[1].length) <= 1, 'scopa: hands differ by at most one card');
  check(s.dom.panels === 1, 'scopa: exactly one game panel in the stage', s.dom.panels);
  const pause = st.ended && !s.dom.overlay; // the last table may stay on screen before the points table
  if (!pause) check(J(ids(s.dom.table)) === J(ids(st.table)), 'scopa: table on screen equals table in state', () => ({ where, dom: ids(s.dom.table), st: ids(st.table) }));
  check(J(ids(s.dom.hand)) === J(ids(st.hands[0])), 'scopa: hand on screen equals hand in state', () => ({ where }));
  check(s.dom.cpuBacks + s.dom.played.length === st.hands[1].length, 'scopa: opponent card backs equal opponent hand size', () => ({ where, backs: s.dom.cpuBacks, played: s.dom.played, hand: st.hands[1].length }));
  const pillText = s.dom.pills.join(' | ');
  const sc = /Tu\s+(\d+)\D+?(\d+)/.exec(pillText);
  check(sc && Number(sc[1]) === s.match.scores[0] && Number(sc[2]) === s.match.scores[1], 'scopa: score on screen equals match score', pillText);
  check(new RegExp('Mano\\s+' + s.match.round + '\\b').test(pillText), 'scopa: round number on screen', pillText);
  check(/Si vince a 11/.test(pillText), 'scopa: target score on screen', pillText);
  check(new RegExp('Mazzo:?\\s*' + st.deck.length + '\\b').test(pillText), 'scopa: deck count on screen', pillText);
  // Captured cards and scope: opponent first, then the human, as on the screen (top to bottom).
  const scopeNums = (s.dom.text.match(/Scope:\s*\d+/g) || []).map((x) => nums(x)[0]);
  check(J(scopeNums) === J([st.scope[1], st.scope[0]]), 'scopa: scope counters on screen', () => ({ where, scopeNums, scope: st.scope }));
  const capNums = (s.dom.text.match(/Prese:\s*\d+|\d+\s+cart[ae]\s+pres[ae]/g) || []).map((x) => nums(x)[0]);
  check(J(capNums) === J([st.captured[1].length, st.captured[0].length]), 'scopa: captured card counters on screen', () => ({ where, capNums }));
  const myTurn = !s.busy && !st.ended && st.turn === 0;
  check(s.dom.hand.every((h) => h.disabled === !myTurn), 'scopa: hand cards are marked disabled exactly when it is not the human turn', () => ({ where, myTurn, hand: s.dom.hand }));
  if (!myTurn) check(s.dom.buttons.length === 0, 'scopa: no capture buttons when it is not the human turn', s.dom.buttons);
  if (!pause && !st.table.length && !s.dom.played.length) check(/tavolo.*vuoto/i.test(s.dom.text), 'scopa: empty table note');
  if (!s.dom.buttons.length) check(s.dom.table.every((t) => t.disabled), 'scopa: table cards are not clickable outside the choice of a capture', () => ({ where }));
  if (st.ended && !s.dom.overlay) check(/Mano finita/i.test(s.dom.msg || ''), 'scopa: the message says that the round is finished while the table is still shown', s.dom.msg);
  layoutChecks('scopa', s.lay, where);
  if (s.dom.handBottom !== null && s.lay.innerH >= 800) {
    const over = Math.round(s.dom.handBottom - s.lay.innerH);
    scopaInvariants.worst = Math.max(scopaInvariants.worst, over);
    check(over <= 0, 'scopa: the human hand is fully visible without scrolling (window 1120 x 812)', () => ({ where, pxBelowWindow: over, tableCards: st.table.length, buttons: s.dom.buttons.length }));
  }
}
scopaInvariants.worst = -Infinity;

// Checks one play (pre -> post) against the rules. tr = test side tracker.
function verifyScopaPlay(pre, post, player, cardId, takeIds, tr) {
  const a = pre.state;
  const b = post.state;
  const who = player === 0 ? 'human' : 'opponent';
  const card = a.hands[player].find((c) => c.id === cardId);
  if (!check(!!card, 'scopa: played card was in the hand (' + who + ')', { cardId })) return;
  const opts = scopaOptions(a.table, card.rank);
  if (takeIds.length === 0) check(opts.length === 0, 'scopa: a card was laid down although a capture was possible (' + who + ')', () => ({ card, table: a.table }));
  else check(opts.some((o) => sameSet(o, takeIds)), 'scopa: capture is legal (' + who + ')', () => ({ card, takeIds, table: a.table }));

  const handAfter = a.hands[player].length - 1;
  const otherAfter = a.hands[1 - player].length;
  const dealEmpty = handAfter === 0 && otherAfter === 0;
  const roundOver = dealEmpty && a.deck.length === 0;
  const tableAfter = a.table.filter((c) => takeIds.indexOf(c.id) < 0);
  if (takeIds.length) tr.lastTaker = player;
  else tableAfter.push(card);
  const expectScopa = takeIds.length > 0 && tableAfter.length === 0 && !roundOver;
  if (expectScopa) { tr.scope[player] += 1; stats.scopa.scope[player] += 1; }
  check(J(b.scope) === J(tr.scope), 'scopa: scope counters follow the rules (no scopa on the last card)', () => ({ state: b.scope, expected: tr.scope }));
  check(b.last && b.last.card.id === cardId && b.last.player === player && sameSet(ids(b.last.taken), takeIds) && b.last.scopa === expectScopa, 'scopa: state.last describes the play', () => b.last);
  check(b.ended === roundOver, 'scopa: round ends exactly when deck and both hands are empty', { ended: b.ended, roundOver });

  if (takeIds.length) {
    const cap = ids(b.captured[player]);
    check(takeIds.concat(cardId).every((id) => cap.indexOf(id) >= 0), 'scopa: captured cards go to the capturing player');
  }
  if (roundOver) {
    tr.leftAtEnd = ids(tableAfter);
    check(b.table.length === 0, 'scopa: table is empty at the end of the round', ids(b.table));
    if (tr.lastTaker !== null) {
      const cap = ids(b.captured[tr.lastTaker]);
      check(tableAfter.every((c) => cap.indexOf(c.id) >= 0), 'scopa: last cards on the table go to the last taker', () => ({ lastTaker: tr.lastTaker, left: ids(tableAfter) }));
      check(b.captured[0].length + b.captured[1].length === 40, 'scopa: all 40 cards are captured at the end of the round');
    }
  } else {
    check(J(ids(b.table)) === J(ids(tableAfter)), 'scopa: table after the play', () => ({ got: ids(b.table), expected: ids(tableAfter) }));
    check(b.turn === 1 - player, 'scopa: turn passes to the other player');
    if (dealEmpty) {
      check(b.hands[0].length === 3 && b.hands[1].length === 3 && b.deck.length === a.deck.length - 6, 'scopa: three new cards each when both hands are empty');
      const top6 = ids(a.deck.slice(0, 6));
      check(sameSet(top6, ids(b.hands[0]).concat(ids(b.hands[1]))), 'scopa: new cards come from the top of the deck');
    } else {
      check(b.hands[player].length === handAfter && b.hands[1 - player].length === otherAfter && b.deck.length === a.deck.length, 'scopa: hand sizes after the play');
    }
  }
  // Message text.
  const msg = post.dom.msg || '';
  const taken = a.table.filter((c) => takeIds.indexOf(c.id) >= 0);
  let ok = player === 0 ? /^Hai\b/.test(msg) : (!/^Hai\b/.test(msg) && OPPONENT.test(msg));
  if (takeIds.length) ok = ok && /preso/.test(msg) && taken.every((c) => msg.indexOf(cardName(c)) >= 0) && msg.indexOf('con ' + cardName(card)) >= 0;
  else ok = ok && msg.indexOf('posato ' + cardName(card)) >= 0;
  ok = ok && /scopa!/i.test(msg) === expectScopa;
  if (player === 1 && !roundOver) ok = ok && /Tocca a te/.test(msg);
  if (roundOver) ok = ok && /Mano finita/i.test(msg);
  check(ok, 'scopa: message describes the play (' + who + ')', () => ({ got: msg, card: cardName(card), taken: taken.map(cardName), expectScopa }));
}

// Watches one opponent turn: clicks must be ignored while it thinks and while it shows its card.
async function scopaCpuTurn(tr) {
  const pre = await scopaSnap();
  scopaInvariants(pre, 'opponent turn start');
  check(pre.busy === true && pre.state.turn === 1, 'scopa: busy while the opponent is to move', { busy: pre.busy, turn: pre.state.turn });
  const handBox = await boxOf('.scopa .hand.me [data-card]');
  if (handBox) {
    await clickAt(handBox);
    await clickAt(handBox);
    const s2 = await scopaSnap();
    check(J(s2.state) === J(pre.state), 'scopa: clicks on the hand are ignored while the opponent thinks');
    stats.scopa.ignoredClicks += 2;
  }
  const shown = await waitUntil(() => !!document.querySelector('.scopa .felt .played'), 1500);
  check(!!shown, 'scopa: the opponent shows its card before it plays');
  if (shown) {
    const p = await scopaSnap();
    scopaInvariants(p, 'opponent preview');
    check(J(p.state) === J(pre.state), 'scopa: state does not change while the opponent card is shown');
    check(ids(pre.state.hands[1]).indexOf(p.dom.played[0]) >= 0, 'scopa: the shown opponent card comes from its hand');
    check(OPPONENT.test(p.dom.msg || '') && (p.dom.msg || '').indexOf(cardName(byId(p.dom.played[0]))) >= 0, 'scopa: message names the card the opponent plays', p.dom.msg);
    if (tr.wantShot && SHOTS) { tr.wantShot = false; await shot('scopa-opponent-preview'); }
    if (handBox) await clickAt(handBox);
    const tBox = await boxOf('.scopa .felt [data-card]');
    if (tBox) await clickAt(tBox);
    const p2 = await scopaSnap();
    check(J(p2.state) === J(pre.state), 'scopa: clicks are ignored while the opponent card is shown');
    stats.scopa.ignoredClicks += 2;
    tr.previewMarked = ids(p.dom.table.filter((c) => c.selected));
  }
  const done = await waitUntil(() => {
    const g = window.RA.current.debug;
    return !g.busy || g.state.ended;
  }, 4000);
  if (!check(!!done, 'scopa: the opponent finishes its turn within 4 seconds')) throw new Error('scopa: opponent turn did not finish');
  const post = await scopaSnap();
  scopaInvariants(post, 'after opponent play');
  const last = post.state.last;
  if (check(last && last.player === 1, 'scopa: the opponent made exactly one play', last)) {
    verifyScopaPlay(pre, post, 1, last.card.id, ids(last.taken), tr);
    if (shown) check(sameSet(tr.previewMarked, ids(last.taken)), 'scopa: the cards highlighted during the preview are the ones the opponent takes');
    stats.scopa.cpuPlays += 1;
  }
  check(pre.state.hands[0].length === post.state.hands[0].length || post.state.hands[0].length === 3, 'scopa: human hand untouched by the opponent turn');
}

// Finds the button of one capture: it names every card of the capture, and no other card.
function captureButtonIndex(buttons, cards) {
  const found = [];
  buttons.forEach((text, i) => {
    if (/annulla/i.test(text)) return;
    const n = (text.match(/ di /g) || []).length;
    if (n === cards.length && cards.every((c) => text.indexOf(cardName(c)) >= 0)) found.push(i);
  });
  return found.length === 1 ? found[0] : -1;
}

async function scopaHumanTurn(tr) {
  const pre = await scopaSnap();
  scopaInvariants(pre, 'human turn');
  const st = pre.state;
  check(!pre.busy && st.turn === 0, 'scopa: not busy on the human turn');
  check(/Tocca a te|Scegli una carta/.test(pre.dom.msg || ''), 'scopa: the message tells the human it is his turn', pre.dom.msg);
  const choices = st.hands[0].map((c) => ({ card: c, opts: scopaOptions(st.table, c.rank) }));
  const multi = choices.filter((c) => c.opts.length > 1);
  const cap = choices.filter((c) => c.opts.length >= 1);
  let ch;
  if (multi.length && rnd() < 0.85) ch = pick(multi);
  else if (cap.length && rnd() < 0.8) ch = pick(cap);
  else ch = pick(choices);
  const loc = page.locator('.scopa .hand.me [data-card="' + ch.card.id + '"]');
  // The human plays the last card of the round (rounds started by the opponent).
  const lastPlay = st.deck.length === 0 && st.hands[0].length === 1 && st.hands[1].length === 0;
  let take = [];
  let dbl = false;
  if (ch.opts.length <= 1) {
    take = ch.opts[0] || [];
    if (lastPlay || rnd() < 0.3) {
      dbl = true;
      // Fast double click: only one card may be played.
      await loc.dblclick();
      stats.scopa.doubleClicks += 1;
    } else {
      await loc.click();
    }
  } else {
    // A double click opens the choice like one click: it must not play anything.
    // With three or more captures the buttons take two rows, so the double click is always tried there.
    const openDbl = ch.opts.length >= 3 || rnd() < 0.4;
    if (openDbl) { await loc.dblclick(); stats.scopa.doubleClicks += 1; } else await loc.click();
    let c = await scopaSnap();
    let accidental = false;
    if (openDbl) {
      accidental = J(c.state) !== J(pre.state);
      check(!accidental && c.dom.buttons.length > 0, 'scopa: a double click on a hand card with several captures opens the choice and does nothing else',
        () => ({ card: cardName(ch.card), captures: ch.opts.length, choiceStillOpen: c.dom.buttons.length > 0, playedByTheSecondClick: accidental ? c.state.last.taken.map(cardName) : null, message: c.dom.msg }));
      if (!accidental && !c.dom.buttons.length) { await loc.click(); c = await scopaSnap(); }
    }
    if (accidental) {
      // The second click pressed a capture button. Go on with the capture the game made.
      take = ids(c.state.last.taken);
    } else {
    scopaInvariants(c, 'choosing');
    check(J(c.state) === J(pre.state), 'scopa: nothing is played before the capture is chosen');
    const optCards = ch.opts.map((o) => st.table.filter((x) => o.indexOf(x.id) >= 0));
    const idx = optCards.map((cards) => captureButtonIndex(c.dom.buttons, cards));
    check(idx.every((i) => i >= 0) && new Set(idx).size === idx.length && c.dom.buttons.length === ch.opts.length + 1 && c.dom.buttons.some((t) => /annulla/i.test(t)),
      'scopa: one button for every legal capture plus Annulla', () => ({ got: c.dom.buttons, expected: optCards.map((x) => x.map(cardName)) }));
    check((c.dom.msg || '').indexOf(cardName(ch.card)) >= 0 && /prese|scegli/i.test(c.dom.msg || ''), 'scopa: message asks to choose a capture', c.dom.msg);
    check(c.dom.hand.filter((h) => h.selected).map((h) => h.id).join() === String(ch.card.id), 'scopa: the chosen hand card is highlighted');
    const union = [].concat.apply([], ch.opts);
    check(sameSet(ids(c.dom.table.filter((t) => t.selected)), Array.from(new Set(union))), 'scopa: all cards that can be taken are highlighted');
    if (!tr.shotChoose && SHOTS) { tr.shotChoose = true; await shot('scopa-choose-capture'); }
    if (rnd() < 0.35) {
      await page.locator('.scopa .actions button', { hasText: /annulla/i }).click();
      c = await scopaSnap();
      check(J(c.state) === J(pre.state) && c.dom.buttons.length === 0 && /Scegli una carta/.test(c.dom.msg || ''), 'scopa: Annulla closes the choice and plays nothing', c.dom.msg);
      stats.scopa.cancels += 1;
      await loc.click();
      c = await scopaSnap();
    }
    // A table card that belongs to exactly one capture can be clicked to choose that capture.
    const inOpts = (id) => ch.opts.filter((o) => o.indexOf(id) >= 0).length;
    check(c.dom.table.every((t) => t.disabled === (inOpts(t.id) !== 1)), 'scopa: during the choice, exactly the table cards of one single capture are clickable', () => c.dom.table.map((t) => ({ id: t.id, disabled: t.disabled, captures: inOpts(t.id) })));
    const dead = c.dom.table.filter((t) => inOpts(t.id) !== 1);
    if (dead.length) {
      await page.locator('.scopa .felt [data-card="' + pick(dead).id + '"]').click();
      const d = await scopaSnap();
      check(J(d.state) === J(pre.state) && d.dom.buttons.length === c.dom.buttons.length, 'scopa: during the choice, a click on a table card of no capture or of several captures changes nothing');
      stats.scopa.ignoredClicks += 1;
    }
    const k = Math.floor(rnd() * ch.opts.length);
    take = ch.opts[k];
    const own = take.filter((id) => inOpts(id) === 1);
    if (own.length && rnd() < 0.6) {
      await page.locator('.scopa .felt [data-card="' + pick(own) + '"]').dblclick();
      stats.scopa.tableChoice += 1;
    } else {
      if (idx[k] < 0) throw new Error('scopa: capture button not found: ' + J(optCards[k].map(cardName)) + ' in ' + J(c.dom.buttons));
      await page.locator('.scopa .actions button').nth(idx[k]).click();
    }
    stats.scopa.multiChoice += 1;
    }
  }
  const post = await scopaSnap();
  if (lastPlay) {
    // The table stays on screen first: a double click on the last card must not reach the points table.
    check(post.state.ended && !post.dom.overlay && post.match.round === pre.match.round, 'scopa: after the last card (also with a double click) the round is over and the points table is not yet shown',
      () => ({ ended: post.state.ended, overlay: !!post.dom.overlay, round: post.match.round }));
  }
  scopaInvariants(post, 'after human play');
  check(post.state.last && post.state.last.player === 0 && post.state.last.card.id === ch.card.id, 'scopa: one click (or a double click) plays exactly the clicked card', () => post.state.last);
  verifyScopaPlay(pre, post, 0, ch.card.id, take, tr);
  stats.scopa.humanPlays += 1;
}

async function scopaRoundEnd(tr) {
  let s = await scopaSnap();
  if (!s.dom.overlay) {
    // The table and the last play stay visible for about 1.5 seconds. Clicks do nothing meanwhile.
    scopaInvariants(s, 'pause at the end of the round');
    check(s.state.ended && s.busy, 'scopa: busy during the pause at the end of the round');
    if (tr.leftAtEnd && tr.leftAtEnd.length) {
      check(tr.leftAtEnd.every((id) => ids(s.dom.table).indexOf(id) >= 0), 'scopa: during the pause after the last card, the cards left on the table are still shown (they go to the last taker)',
        () => ({ leftOnTheTable: tr.leftAtEnd.map((id) => cardName(byId(id))), shown: s.dom.table.length, text: s.dom.msg }));
    }
    if (SHOTS && !scopaRoundEnd.shot) { scopaRoundEnd.shot = true; await shot('scopa-round-end-pause'); }
    await page.mouse.click(560, 600);
    await page.mouse.click(560, 600);
    await tick(1000);
    const mid = await scopaSnap();
    check(!mid.dom.overlay && J(mid.state) === J(s.state) && J(mid.match) === J(s.match), 'scopa: the points table does not appear in the first second after the last card, and clicks change nothing');
    const up = await waitUntil(() => !!document.querySelector('.scopa .overlay'), 1500);
    if (!check(!!up, 'scopa: the points table appears within 2.5 seconds after the last card')) throw new Error('scopa: no points table');
    s = await scopaSnap();
  }
  const st = s.state;
  stats.scopa.rounds += 1;
  const exp = scopaScore(st.captured, tr.scope);
  tr.scores[0] += exp.pts[0];
  tr.scores[1] += exp.pts[1];
  const over = Math.max(tr.scores[0], tr.scores[1]) >= 11 && tr.scores[0] !== tr.scores[1];
  check(st.ended && s.busy, 'scopa: round end overlay only when the round is over');
  check(J(st.result.points) === J(exp.pts), 'scopa: points of the round', () => ({ got: st.result.points, expected: exp.pts }));
  check(J(s.match.scores) === J(tr.scores), 'scopa: match score is the sum of the rounds', () => ({ got: s.match.scores, expected: tr.scores }));
  check(s.match.over === over, 'scopa: match is over at 11 or more with different scores', { scores: tr.scores, over: s.match.over });
  const row = (re) => (s.dom.overlay.rows.find((r) => re.test(r[0])) || []).slice(1);
  const want = [
    [/^Carte/i, [String(exp.count[0]), String(exp.count[1])]],
    [/^Denari/i, [String(exp.den[0]), String(exp.den[1])]],
    [/^Primiera/i, [String(exp.prim[0]), String(exp.prim[1])]],
    [/^Scope/i, [String(tr.scope[0]), String(tr.scope[1])]],
    [/^Totale/i, [String(tr.scores[0]), String(tr.scores[1])]],
  ];
  want.forEach((w) => check(J(row(w[0])) === J(w[1]), 'scopa: score table of the round, row ' + w[0], () => ({ got: row(w[0]), expected: w[1], rows: s.dom.overlay.rows })));
  const sb = row(/^Settebello/i);
  check(sb.length === 2 && (sb[0].trim() !== '') === exp.sette[0] && (sb[1].trim() !== '') === exp.sette[1], 'scopa: score table marks who holds the settebello', sb);
  const pr = row(/^Punti/i);
  check(J(pr.map((x) => nums(x)[0])) === J(exp.pts), 'scopa: score table shows the points of the round', pr);
  const head = s.dom.overlay.rows[0] || [];
  check(/^Tu$/i.test((head[1] || '').trim()) && OPPONENT.test(head[2] || ''), 'scopa: score table columns are Tu and the opponent', head);
  const h2 = s.dom.overlay.h2 || '';
  if (!over) check(new RegExp('mano\\s+' + tr.round + '\\b', 'i').test(h2), 'scopa: round end title names the round', h2);
  else if (tr.scores[0] > tr.scores[1]) check(/^Hai vinto/i.test(h2), 'scopa: match end title when the human wins', h2);
  else check(OPPONENT.test(h2) && !/^Hai vinto/i.test(h2), 'scopa: match end title when the opponent wins', h2);
  check(s.dom.overlay.buttons.length === 1 && (over ? /Nuova partita/i : /Prossima/i).test(s.dom.overlay.buttons[0]), 'scopa: round end button', s.dom.overlay.buttons);
  const box = await page.locator('.scopa .overlay > *').first().boundingBox();
  const vp = page.viewportSize();
  const scrollY = await page.evaluate(() => window.scrollY);
  check(box.y + scrollY >= 0 && box.y + scrollY + box.height <= vp.height && box.x >= 0 && box.x + box.width <= vp.width, 'scopa: round end box is fully visible without scrolling', () => ({ box, scrollY }));
  if (SHOTS && (tr.round === 1 || over)) await shot(over ? 'scopa-match-end-' + (stats.scopa.matches + 1) : 'scopa-round-end');
  // When the human starts the next round, the button is pressed with a double click:
  // the second click must not play a card of the new hand.
  const humanNext = over || (tr.round + 1) % 2 === 1;
  if (humanNext) await page.locator('.scopa .overlay button').dblclick();
  else await page.locator('.scopa .overlay button').click();
  const n = await scopaSnap();
  check(!n.dom.overlay, 'scopa: the overlay closes');
  const unwanted = n.state.last && n.state.last.player === 0 ? n.state.last : null;
  if (humanNext) {
    check(!unwanted && n.dom.buttons.length === 0, 'scopa: a double click on "Prossima mano" or "Nuova partita" does not play a card of the new hand',
      () => ({ afterRound: tr.round, matchOver: over, cardPlayedByTheSecondClick: unwanted ? cardName(unwanted.card) : null, taken: unwanted ? unwanted.taken.map(cardName) : null, choiceButtons: n.dom.buttons }));
  }
  if (over) {
    stats.scopa.matches += 1;
    stats.scopa.finals.push(tr.scores.slice());
    tr.scores = [0, 0];
    tr.round = 1;
    check(J(n.match.scores) === '[0,0]' && n.match.round === 1 && !n.match.over, 'scopa: Nuova partita starts a new match from 0 - 0');
  } else {
    tr.round += 1;
    check(n.match.round === tr.round, 'scopa: Prossima mano starts the next round', n.match.round);
  }
  tr.scope = [0, 0];
  tr.lastTaker = null;
  if (unwanted) {
    // A card was played by the second click. Keep the test tracker in step with the game.
    if (unwanted.taken.length) tr.lastTaker = 0;
    if (unwanted.scopa) { tr.scope[0] += 1; stats.scopa.scope[0] += 1; }
    stats.scopa.humanPlays += 1;
    check(n.state.deck.length === 30 && n.state.hands[0].length === 2 && n.state.hands[1].length === 3, 'scopa: deal is 4 on the table and 3 each');
  } else {
    check(n.state.turn === (tr.round % 2 === 1 ? 0 : 1), 'scopa: the first player alternates every round', { round: tr.round, turn: n.state.turn });
    check(n.state.deck.length === 30 && n.state.table.length === 4 && n.state.hands[0].length === 3 && n.state.hands[1].length === 3, 'scopa: deal is 4 on the table and 3 each');
    check(n.state.table.filter((c) => c.rank === 10).length < 3, 'scopa: a deal never has 3 or 4 Re on the table', () => n.state.table);
    if (!n.dom.buttons.length) check(n.state.turn === 0 ? /Tocca a te/.test(n.dom.msg || '') : (OPPONENT.test(n.dom.msg || '') && !/Tocca a te/.test(n.dom.msg || '')), 'scopa: first message of the round says who starts', n.dom.msg);
  }
  scopaInvariants(n, 'new round');
}

// Plays until `stop(tr)` says so.
async function scopaLoop(tr, stop) {
  for (let guard = 0; guard < 5000; guard++) {
    const s = await page.evaluate(() => {
      const g = window.RA.current.debug;
      return { overlay: !!document.querySelector('.scopa .overlay'), turn: g.state.turn, busy: g.busy, ended: g.state.ended };
    });
    if (stop(tr, s)) return;
    if (s.overlay || s.ended) await scopaRoundEnd(tr);
    else if (s.turn === 1) await scopaCpuTurn(tr);
    else await scopaHumanTurn(tr);
    noErrors('scopa');
  }
  throw new Error('scopa: loop guard reached');
}

function newScopaTracker() {
  return { scope: [0, 0], lastTaker: null, scores: [0, 0], round: 1, wantShot: true, shotChoose: false };
}

// =====================================================================================
// BRISCOLA
// =====================================================================================
const BR_POINTS = { 1: 11, 3: 10, 10: 4, 9: 3, 8: 2 };
const BR_ORDER = [2, 4, 5, 6, 7, 8, 9, 10, 3, 1]; // weakest to strongest
const brPts = (c) => BR_POINTS[c.rank] || 0;
// True when the second card beats the first.
function secondWins(first, second, trump) {
  if (second.suit === first.suit) return BR_ORDER.indexOf(second.rank) > BR_ORDER.indexOf(first.rank);
  return second.suit === trump;
}

function brSnap() {
  return page.evaluate(() => {
    const g = window.RA.current.debug;
    const q = (sel) => Array.from(document.querySelectorAll(sel));
    const panel = document.querySelector('#stage .briscola');
    const ov = panel.querySelector('.overlay');
    // Face-up cards that are neither in the human hand nor in a trick slot: the briscola card.
    const extra = q('.briscola [data-card]').filter((e) => !e.closest('.hand.me') && !e.closest('.slot'));
    const hand = panel.querySelector('.hand.me');
    const hr = hand ? hand.getBoundingClientRect() : null;
    return {
      state: JSON.parse(JSON.stringify(g.state)),
      busy: g.busy,
      wins: g.wins.slice(),
      seenAt: Date.now(),
      lay: window.__e2eLayout(),
      dom: {
        panels: q('#stage .game-panel').length,
        text: window.__e2eText(panel),
        extra: extra.map((e) => {
          let op = 1;
          for (let n = e; n && n !== panel; n = n.parentElement) op *= parseFloat(getComputedStyle(n).opacity);
          return { id: Number(e.dataset.card), opacity: op };
        }),
        cpuBacks: q('.briscola .hand.cpu .pcard.back').length,
        slots: q('.briscola .felt .slot').map((e) => {
          const c = e.querySelector('[data-card]');
          return { name: (e.querySelector('.slot-name') || {}).textContent, card: c ? Number(c.dataset.card) : null, winner: e.classList.contains('winner') };
        }),
        msg: (panel.querySelector('.msg') || {}).textContent,
        hand: q('.briscola .hand.me [data-card]').map((e) => ({ id: Number(e.dataset.card), disabled: e.classList.contains('disabled') })),
        handBottom: hr ? hr.bottom + window.scrollY : null,
        overlay: ov ? { h2: (ov.querySelector('h2') || {}).textContent, text: ov.textContent, buttons: Array.from(ov.querySelectorAll('button')).map((b) => b.textContent) } : null,
      },
    };
  });
}

// showing = the finished trick is expected to be on the table.
function brInvariants(s, where, showing) {
  const st = s.state;
  const tbl = st.table.filter(Boolean);
  const all = ids(st.deck).concat(ids(st.hands[0]), ids(st.hands[1]), ids(tbl), ids(st.pile[0]), ids(st.pile[1]));
  check(all.length === 40 && new Set(all).size === 40, 'briscola: 40 different cards accounted for', () => ({ where, n: all.length }));
  check(s.dom.panels === 1, 'briscola: exactly one game panel in the stage');
  const pts = st.pile.map((p) => p.reduce((sum, c) => sum + brPts(c), 0));
  const text = s.dom.text;
  // Either "Punti: tu 12 · Chihuahua 30" or "Avversario | 30 punti ... Tu | 12 punti".
  let shownPts = null;
  const pm = /Punti:?\s*tu\s+(\d+)\D+?(\d+)/i.exec(text);
  if (pm) shownPts = [Number(pm[1]), Number(pm[2])];
  else {
    const me = /\bTu\b[\s|:]*(\d+)\s*punti/.exec(text);
    const op = /(?:Avversario|Chihuahua|Computer|Gatto)[\s|:]*(\d+)\s*punti/.exec(text);
    if (me && op) shownPts = [Number(me[1]), Number(op[1])];
  }
  check(shownPts && J(shownPts) === J(pts), 'briscola: points on screen equal the points in the piles', () => ({ where, shownPts, pts, text: text.slice(0, 200) }));
  const wm = /Partite[^\d]*(\d+)\D+?(\d+)/i.exec(text);
  check(wm && Number(wm[1]) === s.wins[0] && Number(wm[2]) === s.wins[1], 'briscola: won hands on screen', () => ({ where, found: wm && wm[0], wins: s.wins }));
  const dm = /mazzo:?\s*(\d+)/i.exec(s.dom.text);
  check(dm ? Number(dm[1]) === st.deck.length : (st.deck.length === 0 && /mazzo finito/i.test(s.dom.text)), 'briscola: deck count on screen', () => ({ where, deck: st.deck.length, found: dm && dm[0] }));
  check(st.pile[0].length % 2 === 0 && st.pile[1].length % 2 === 0, 'briscola: piles hold whole tricks');
  if (st.deck.length) {
    check(st.deck[st.deck.length - 1].id === st.trumpCard.id, 'briscola: the briscola card is the last card of the deck');
    check(s.dom.extra.length === 1 && s.dom.extra[0].id === st.trumpCard.id && s.dom.extra[0].opacity > 0.99, 'briscola: the briscola card is shown while the deck has cards', s.dom.extra);
  } else {
    check(s.dom.extra.length === 0, 'briscola: once drawn, the briscola card is no longer shown on the table', s.dom.extra);
  }
  const tm = /Briscola:?[\s|]*(Coppe|Denari|Spade|Bastoni)/.exec(s.dom.text);
  check(tm && tm[1] === SUIT_NAMES[st.trumpSuit] && st.trumpSuit === st.trumpCard.suit, 'briscola: the briscola suit is named on screen', () => ({ found: tm && tm[0], suit: SUIT_NAMES[st.trumpSuit] }));
  check(s.dom.cpuBacks === st.hands[1].length, 'briscola: opponent card backs equal opponent hand size', { backs: s.dom.cpuBacks, hand: st.hands[1].length });
  check(J(ids(s.dom.hand)) === J(ids(st.hands[0])), 'briscola: hand on screen equals hand in state');
  check(s.dom.slots.length === 2 && OPPONENT.test(s.dom.slots[0].name || '') && /^Tu$/.test((s.dom.slots[1].name || '').trim()), 'briscola: two named slots, opponent then Tu', s.dom.slots);
  const myTurn = !s.busy && !st.ended && st.turn === 0;
  check(s.dom.hand.every((h) => h.disabled === !myTurn), 'briscola: hand cards are marked disabled exactly when it is not the human turn', () => ({ where, myTurn }));
  if (showing) {
    const lt = st.lastTrick;
    check(s.dom.slots[0].card === lt.cards[1].id && s.dom.slots[1].card === lt.cards[0].id, 'briscola: the finished trick stays on the table, each card in the slot of its player', () => ({ where, slots: s.dom.slots, cards: ids(lt.cards) }));
    check(s.dom.slots[0].winner === (lt.winner === 1) && s.dom.slots[1].winner === (lt.winner === 0), 'briscola: only the slot of the trick winner is highlighted', s.dom.slots);
  } else {
    check(s.dom.slots[0].card === (st.table[1] ? st.table[1].id : null) && s.dom.slots[1].card === (st.table[0] ? st.table[0].id : null), 'briscola: each slot shows the card of its player', () => ({ where, slots: s.dom.slots, table: st.table }));
    check(!s.dom.slots[0].winner && !s.dom.slots[1].winner, 'briscola: no winner highlight outside a finished trick');
  }
  layoutChecks('briscola', s.lay, where);
  if (s.dom.handBottom !== null && s.lay.innerH >= 800) {
    const over = Math.round(s.dom.handBottom - s.lay.innerH);
    brInvariants.worst = Math.max(brInvariants.worst, over);
    check(over <= 0, 'briscola: the human hand is fully visible without scrolling (window 1120 x 812)', () => ({ where, pxBelowWindow: over }));
  }
}
brInvariants.worst = -Infinity;

// Checks a finished trick. pre = snapshot before the second card, post = snapshot right after it.
function verifyTrick(pre, post, secondPlayer, secondCardId) {
  const a = pre.state;
  const b = post.state;
  const leader = a.leader;
  check(secondPlayer === 1 - leader, 'briscola: the second card is played by the non-leader');
  const first = a.table[leader];
  const second = a.hands[secondPlayer].find((c) => c.id === secondCardId);
  if (!check(!!first && !!second, 'briscola: both trick cards are known', { first, secondCardId })) return;
  const winner = secondWins(first, second, a.trumpSuit) ? secondPlayer : leader;
  const points = brPts(first) + brPts(second);
  const lt = b.lastTrick;
  check(lt && lt.winner === winner && lt.points === points, 'briscola: trick winner and points follow the rules', () => ({ first, second, trump: a.trumpSuit, got: lt && { w: lt.winner, p: lt.points }, expected: { winner, points } }));
  check(lt && lt.cards[leader].id === first.id && lt.cards[secondPlayer].id === second.id, 'briscola: lastTrick holds the two cards by player');
  check(b.pile[winner].length === a.pile[winner].length + 2 && b.pile[1 - winner].length === a.pile[1 - winner].length, 'briscola: the winner takes both cards');
  const msg = post.dom.msg || '';
  check((winner === 0 ? /Prendi tu/i.test(msg) : (/Prende/i.test(msg) && OPPONENT.test(msg))) && nums(msg)[0] === points, 'briscola: message names the trick winner and the points', msg);
  // Draw order: winner first, then the loser. The briscola card is drawn last.
  if (a.deck.length >= 2) {
    check(b.deck.length === a.deck.length - 2, 'briscola: two cards are drawn after a trick');
    check(ids(b.hands[winner]).indexOf(a.deck[0].id) >= 0 && ids(b.hands[1 - winner]).indexOf(a.deck[1].id) >= 0, 'briscola: the trick winner draws first');
    if (a.deck.length === 2) check(ids(b.hands[1 - winner]).indexOf(a.trumpCard.id) >= 0, 'briscola: the loser of the trick draws the briscola card last');
    check(b.hands[0].length === 3 && b.hands[1].length === 3, 'briscola: three cards each while the deck has cards');
  } else {
    check(b.deck.length === 0 && b.hands[0].length === b.hands[1].length, 'briscola: no draw when the deck is empty');
  }
  check(b.leader === winner && b.turn === winner, 'briscola: the trick winner leads the next trick');
  check(b.ended === (b.hands[0].length === 0 && b.hands[1].length === 0), 'briscola: the hand ends when both hands are empty');
  stats.briscola.tricks += 1;
}

// After the second card: the trick must stay visible, clicks are ignored, then the table clears.
async function brWatchShown(post, tr) {
  // post.seenAt is the moment the test first saw the finished trick (a little after it appeared).
  const t0 = post.seenAt;
  brInvariants(post, 'trick shown', true);
  check(post.busy, 'briscola: busy while the finished trick is shown');
  if (tr.wantShot && SHOTS) { tr.wantShot = false; await shot('briscola-trick-shown'); }
  const handBox = await boxOf('.briscola .hand.me [data-card]');
  if (handBox) {
    await clickAt(handBox);
    await clickAt(handBox);
    const s2 = await brSnap();
    check(J(s2.state) === J(post.state), 'briscola: clicks are ignored while the finished trick is shown');
    brInvariants(s2, 'trick shown after clicks', true);
    stats.briscola.ignoredClicks += 2;
  }
  const spent = (await page.evaluate(() => Date.now())) - t0;
  await tick(Math.max(0, 1000 - spent));
  const mid = await brSnap();
  check(mid.dom.slots[0].card !== null && mid.dom.slots[1].card !== null && J(mid.state) === J(post.state), 'briscola: the finished trick is still visible after 1 second');
  const gone = await waitUntil(() => document.querySelectorAll('.briscola .felt .slot.winner').length === 0, 2500);
  check(!!gone, 'briscola: the finished trick is cleared within 2.5 seconds');
  const t1 = await page.evaluate(() => Date.now());
  stats.briscola.minShownMs = Math.min(stats.briscola.minShownMs, t1 - t0);
}

async function brCpuThinks(pre, msgRe) {
  check(pre.busy && pre.state.turn === 1, 'briscola: busy while the opponent is to move', { busy: pre.busy, turn: pre.state.turn });
  if (msgRe) check(msgRe.test(pre.dom.msg || '') && !/Tocca a te/.test(pre.dom.msg || ''), 'briscola: message while the opponent is to move', pre.dom.msg);
  const handBox = await boxOf('.briscola .hand.me [data-card]');
  if (handBox) {
    await clickAt(handBox);
    await clickAt(handBox);
    const s2 = await brSnap();
    check(J(s2.state) === J(pre.state), 'briscola: clicks are ignored while the opponent thinks');
    stats.briscola.ignoredClicks += 2;
  }
}

function brPickCard(st, smart) {
  const hand = st.hands[0];
  if (!smart) return pick(hand);
  const lead = st.table[1];
  const cost = (c) => brPts(c) * 10 + (c.suit === st.trumpSuit ? 50 : 0) + BR_ORDER.indexOf(c.rank);
  const sorted = hand.slice().sort((x, y) => cost(x) - cost(y));
  if (!lead) return sorted[0];
  const winners = sorted.filter((c) => secondWins(lead, c, st.trumpSuit));
  if (winners.length && (brPts(lead) > 0 || winners[0].suit !== st.trumpSuit)) return winners[0];
  return sorted[0];
}

// One step of a Briscola hand. Returns 'end' when the final overlay is up.
async function brStep(tr) {
  let s = await brSnap();
  if (s.dom.overlay) return 'end';
  if (s.state.turn === 1) {
    // The opponent leads (start of a hand, or after it won a trick).
    brInvariants(s, 'opponent leads', false);
    await brCpuThinks(s, null);
    const ok = await waitUntil(() => !window.RA.current.debug.busy, 2000);
    if (!check(!!ok, 'briscola: the opponent leads within 2 seconds')) throw new Error('briscola: opponent did not lead');
    const after = await brSnap();
    check(after.state.table[1] && ids(s.state.hands[1]).indexOf(after.state.table[1].id) >= 0 && after.state.hands[1].length === s.state.hands[1].length - 1, 'briscola: the opponent leads one card from its hand');
    check(/^Tocca a te/.test(after.dom.msg || '') && /Rispondi/i.test(after.dom.msg || ''), 'briscola: message after the opponent leads', after.dom.msg);
    s = after;
  }
  brInvariants(s, 'human turn', false);
  const st = s.state;
  check(!s.busy && st.turn === 0, 'briscola: not busy on the human turn');
  check(/^Tocca a te/.test(s.dom.msg || ''), 'briscola: the message tells the human it is his turn', s.dom.msg);
  const card = brPickCard(st, tr.smart);
  const loc = page.locator('.briscola .hand.me [data-card="' + card.id + '"]');
  if (rnd() < 0.3) { await loc.dblclick(); stats.briscola.doubleClicks += 1; } else await loc.click();
  const post = await brSnap();
  if (st.leader === 0) {
    // Human led. The card waits in the slot "Tu" while the opponent thinks.
    check(post.state.table[0] && post.state.table[0].id === card.id && post.state.hands[0].length === st.hands[0].length - 1 && post.state.hands[1].length === st.hands[1].length, 'briscola: exactly one card is played by a click (also a double click)', () => ({ table: post.state.table }));
    brInvariants(post, 'human led', false);
    await brCpuThinks(post, OPPONENT);
    const done = await waitUntil((n) => window.RA.current.debug.state.pile[0].length + window.RA.current.debug.state.pile[1].length > n, 2000, st.pile[0].length + st.pile[1].length);
    if (!check(!!done, 'briscola: the opponent answers within 2 seconds')) throw new Error('briscola: opponent did not answer');
    const after = await brSnap();
    const lt = after.state.lastTrick;
    verifyTrick(post, after, 1, lt.cards[1].id);
    await brWatchShown(after, tr);
  } else {
    // Human answered the opponent card: the trick is complete.
    check(post.state.pile[0].length + post.state.pile[1].length === st.pile[0].length + st.pile[1].length + 2, 'briscola: exactly one trick is completed by a click (also a double click)');
    verifyTrick(s, post, 0, card.id);
    await brWatchShown(post, tr);
  }
  noErrors('briscola');
  return 'next';
}

async function brHandEnd(tr) {
  const s = await brSnap();
  const st = s.state;
  const pts = st.pile.map((p) => p.reduce((sum, c) => sum + brPts(c), 0));
  check(st.ended && st.deck.length === 0 && st.pile[0].length + st.pile[1].length === 40, 'briscola: all 40 cards are in the piles at the end');
  check(pts[0] + pts[1] === 120, 'briscola: the points add up to 120', pts);
  if (pts[0] > 60) tr.wins[0] += 1;
  else if (pts[1] > 60) tr.wins[1] += 1;
  check(J(s.wins) === J(tr.wins), 'briscola: wins counter (61 or more wins, 60 - 60 is a draw)', { got: s.wins, expected: tr.wins });
  const h2 = s.dom.overlay.h2 || '';
  if (pts[0] > 60) check(/^Hai vinto/i.test(h2), 'briscola: final title when the human wins', h2);
  else if (pts[1] > 60) check(OPPONENT.test(h2) && !/^Hai vinto/i.test(h2), 'briscola: final title when the opponent wins', h2);
  else check(/Pareggio/i.test(h2), 'briscola: final title for 60 - 60', h2);
  const rest = s.dom.overlay.text.replace(h2, '');
  const pm = /Tu:?\s*(\d+)\D+?(\d+)/.exec(rest);
  check(pm && Number(pm[1]) === pts[0] && Number(pm[2]) === pts[1], 'briscola: final points text', rest);
  const wm = /vinte:?\s*tu\s*(\d+)\D+?(\d+)/i.exec(rest);
  check(wm && Number(wm[1]) === tr.wins[0] && Number(wm[2]) === tr.wins[1], 'briscola: final wins text', rest);
  check(s.dom.overlay.buttons.length === 1 && /Nuova partita/i.test(s.dom.overlay.buttons[0]), 'briscola: final button', s.dom.overlay.buttons);
  stats.briscola.hands += 1;
  stats.briscola.results.push(pts[0] + '-' + pts[1]);
  if (SHOTS && stats.briscola.hands === 1) await shot('briscola-hand-end');
  tr.hand += 1;
  await page.locator('.briscola .overlay button').dblclick();
  const n = await brSnap();
  check(!n.dom.overlay, 'briscola: the overlay closes');
  check(n.state.table[0] === null && n.state.hands[0].length === 3, 'briscola: a double click on Nuova partita does not play a card of the new hand');
  check(n.state.deck.length === 34 && n.state.hands[0].length === 3 && n.state.hands[1].length === 3 && n.state.pile[0].length === 0 && n.state.pile[1].length === 0, 'briscola: Nuova partita deals a new hand');
  check(n.state.leader === (tr.hand % 2 === 1 ? 0 : 1), 'briscola: the first player alternates every hand', { hand: tr.hand, leader: n.state.leader });
  check(n.state.turn === 0 ? /^Tocca a te/.test(n.dom.msg || '') : (OPPONENT.test(n.dom.msg || '') && !/Tocca a te/.test(n.dom.msg || '')), 'briscola: first message of the hand says who starts', n.dom.msg);
  brInvariants(n, 'new hand', false);
}

// =====================================================================================
// SOLITARIO
// =====================================================================================
const grp = (c) => (c.suit < 2 ? 0 : 1);

function solSnap() {
  return page.evaluate(() => {
    const g = window.RA.current.debug;
    const q = (sel) => Array.from(document.querySelectorAll(sel));
    const panel = document.querySelector('#stage .solitario');
    const role = (r) => panel.querySelector('[data-role="' + r + '"]');
    const info = (e) => ({ id: e.dataset.card === undefined ? null : Number(e.dataset.card), cls: e.className });
    const ov = panel.querySelector('.overlay');
    const stock = role('stock');
    // Hit test: points on the visible part of every face-up card of a column must belong to that card.
    const miss = [];
    const strips = [];
    q('.solitario .col').forEach((col) => {
      const all = Array.from(col.children);
      all.forEach((k, i) => {
        if (k.dataset.card === undefined) return;
        const r = k.getBoundingClientRect();
        const next = all[i + 1];
        const visH = next ? next.getBoundingClientRect().top - r.top : r.height;
        if (next) strips.push(visH);
        if (visH < 1) { miss.push({ card: Number(k.dataset.card), visH: Math.round(visH * 10) / 10, why: 'covered' }); return; }
        [0.15, 0.35, 0.5, 0.65, 0.85].forEach((fx) => {
          const x = r.left + r.width * fx;
          const y = r.top + Math.min(visH, r.height) / 2;
          if (y < 62 || y > window.innerHeight - 2 || x < 0 || x > window.innerWidth) return;
          const e = document.elementFromPoint(x, y);
          const c = e && e.closest('[data-card]');
          if (c !== k) miss.push({ card: Number(k.dataset.card), fx: fx, visH: Math.round(visH), hit: c ? Number(c.dataset.card) : (e ? e.className : null) });
        });
      });
    });
    return {
      state: JSON.parse(JSON.stringify(g.state)),
      won: g.won,
      hintNow: JSON.parse(JSON.stringify(g.findHint())),
      lay: window.__e2eLayout(),
      dom: {
        panels: q('#stage .game-panel').length,
        stock: Object.assign(info(stock), { sign: !!stock.querySelector('.recycle') || stock.textContent.trim() !== '' }),
        waste: info(role('waste')),
        found: [0, 1, 2, 3].map((s) => info(role('found-' + s))),
        cols: q('.solitario .col').map((c) => ({ cls: c.className, cards: Array.from(c.children).map(info) })),
        msg: (panel.querySelector('.msg') || {}).textContent,
        text: panel.textContent,
        buttons: q('.solitario .actions button').map((e) => e.textContent),
        overlay: ov ? { h2: (ov.querySelector('h2') || {}).textContent, text: ov.textContent, buttons: Array.from(ov.querySelectorAll('button')).map((b) => b.textContent) } : null,
        cascade: !!panel.querySelector('canvas'),
        miss: miss,
        minStrip: strips.length ? Math.min.apply(null, strips) : null,
        bottom: panel.getBoundingClientRect().bottom + window.scrollY,
      },
    };
  });
}

function solInvariants(s, where) {
  const st = s.state;
  const all = [];
  st.tableau.forEach((col) => col.forEach((x) => all.push(x.card.id)));
  st.stock.forEach((x) => all.push(x.card.id));
  st.waste.forEach((x) => all.push(x.card.id));
  st.foundation.forEach((p) => p.forEach((c) => all.push(c.id)));
  check(all.length === 40 && new Set(all).size === 40, 'solitario: 40 different cards accounted for', () => ({ where, n: all.length, uniq: new Set(all).size }));
  check(s.dom.panels === 1, 'solitario: exactly one game panel in the stage');
  check(st.stock.every((x) => !x.up) && st.waste.every((x) => x.up), 'solitario: stock is face down, waste is face up');
  st.foundation.forEach((p, suit) => {
    check(p.every((c, i) => c.suit === suit && c.rank === i + 1), 'solitario: final piles go up by suit from the Asso', () => ({ where, suit, p }));
  });
  st.tableau.forEach((col, ci) => {
    let seenUp = false;
    let okOrder = true;
    let okRun = true;
    col.forEach((x, i) => {
      if (x.up) {
        if (seenUp) {
          const prev = col[i - 1].card;
          if (!(prev.rank === x.card.rank + 1 && grp(prev) !== grp(x.card))) okRun = false;
        }
        seenUp = true;
      } else if (seenUp) okOrder = false;
    });
    check(okOrder, 'solitario: face-down cards are never above face-up cards', { where, ci });
    check(okRun, 'solitario: face-up cards of a column go down by one with alternate colour groups', () => ({ where, ci, col }));
    if (col.length) check(col[col.length - 1].up, 'solitario: the top card of a column is face up', { where, ci });
  });
  // Screen equals state.
  check(/back/.test(s.dom.stock.cls) === st.stock.length > 0, 'solitario: stock shows a card back only when it has cards');
  if (st.stock.length === 0 && st.waste.length > 0) check(s.dom.stock.sign, 'solitario: the empty stock shows a sign that it can be turned over');
  check(s.dom.waste.id === (st.waste.length ? st.waste[st.waste.length - 1].card.id : null), 'solitario: waste shows its top card');
  st.foundation.forEach((p, suit) => {
    check(s.dom.found[suit].id === (p.length ? p[p.length - 1].id : null), 'solitario: final pile shows its top card');
  });
  st.tableau.forEach((col, ci) => {
    const dom = s.dom.cols[ci].cards;
    if (!col.length) check(dom.length === 1 && /empty/.test(dom[0].cls), 'solitario: an empty column shows a placeholder');
    else check(dom.length === col.length && col.every((x, i) => (x.up ? dom[i].id === x.card.id : dom[i].id === null && /back/.test(dom[i].cls))), 'solitario: column on screen equals column in state', () => ({ where, ci }));
  });
  const done = st.foundation.reduce((n, p) => n + p.length, 0);
  const mm = /Mosse:\s*(\d+)/.exec(s.dom.text);
  const dm = /(\d+)\s+su\s+40/.exec(s.dom.text);
  check(mm && Number(mm[1]) === st.moves && dm && Number(dm[1]) === done, 'solitario: move counter and final-pile counter on screen', () => ({ moves: st.moves, done, mm: mm && mm[0], dm: dm && dm[0] }));
  check(s.won === (done === 40), 'solitario: won exactly when the 40 cards are in the final piles');
  check((!!s.dom.overlay || s.dom.cascade) === s.won, 'solitario: the win screen shows exactly when the game is won', () => ({ where, won: s.won, overlay: !!s.dom.overlay, cascade: s.dom.cascade }));
  layoutChecks('solitario', s.lay, where);
  check(s.dom.miss.length === 0, 'solitario: a click on the visible part of any face-up card of a column reaches that card', () => ({ where, miss: s.dom.miss.slice(0, 3) }));
  if (s.dom.minStrip !== null) check(s.dom.minStrip >= 23.5, 'solitario: every covered face-up card shows a strip of 24 px or more', () => ({ where, minStrip: s.dom.minStrip, innerH: s.lay.innerH }));
  if (s.dom.minStrip !== null) solInvariants.minStrip = Math.min(solInvariants.minStrip, s.dom.minStrip);
  solInvariants.maxBottom = Math.max(solInvariants.maxBottom, s.dom.bottom - s.lay.innerH);
}
solInvariants.minStrip = Infinity;
solInvariants.maxBottom = -Infinity;

function solSourceCards(st, src) {
  if (src.type === 'waste') return st.waste.length ? [st.waste[st.waste.length - 1]] : null;
  if (src.type === 'found') { const p = st.foundation[src.suit]; return p.length ? [{ card: p[p.length - 1], up: true }] : null; }
  const col = st.tableau[src.col];
  if (!col[src.idx] || !col[src.idx].up) return null;
  return col.slice(src.idx);
}
// Independent list of the places a source can go (empty columns count once).
function solDests(st, src) {
  const cards = solSourceCards(st, src);
  if (!cards) return [];
  const first = cards[0].card;
  const out = [];
  if (src.type !== 'found' && cards.length === 1 && st.foundation[first.suit].length === first.rank - 1) out.push({ type: 'found', suit: first.suit });
  let emptySeen = false;
  for (let c = 0; c < 7; c++) {
    if (src.type === 'tab' && src.col === c) continue;
    const t = st.tableau[c];
    if (!t.length) {
      if (first.rank !== 10 || emptySeen || (src.type === 'tab' && src.idx === 0)) continue;
      emptySeen = true;
      out.push({ type: 'tab', col: c });
    } else {
      const top = t[t.length - 1];
      if (top.up && grp(top.card) !== grp(first) && top.card.rank === first.rank + 1) out.push({ type: 'tab', col: c });
    }
  }
  return out;
}
function solApply(st0, src, dst) {
  const st = JSON.parse(J(st0));
  let cards;
  if (src.type === 'waste') cards = [st.waste.pop()];
  else if (src.type === 'found') cards = [{ card: st.foundation[src.suit].pop(), up: true }];
  else cards = st.tableau[src.col].splice(src.idx);
  if (dst.type === 'found') st.foundation[dst.suit].push(cards[0].card);
  else st.tableau[dst.col] = st.tableau[dst.col].concat(cards.map((c) => ({ card: c.card, up: true })));
  if (src.type === 'tab') { const col = st.tableau[src.col]; if (col.length) col[col.length - 1].up = true; }
  st.moves += 1;
  return st;
}
// True when no card can move anywhere, whatever is drawn from the stock.
function solDead(st) {
  for (let c = 0; c < 7; c++) {
    for (let i = 0; i < st.tableau[c].length; i++) {
      if (st.tableau[c][i].up && solDests(st, { type: 'tab', col: c, idx: i }).length) return false;
    }
  }
  for (let s = 0; s < 4; s++) if (solDests(st, { type: 'found', suit: s }).length) return false;
  const pool = st.stock.concat(st.waste);
  for (const x of pool) {
    const fake = Object.assign({}, st, { waste: [{ card: x.card, up: true }] });
    if (solDests(fake, { type: 'waste' }).length) return false;
  }
  return true;
}

// Clicks a card of a column on the middle of its visible part.
async function solClickTab(col, idx) {
  const cards = page.locator('.solitario .col[data-col="' + col + '"] > .pcard');
  const n = await cards.count();
  const box = await cards.nth(idx).boundingBox();
  let visH = box.height;
  if (idx < n - 1) visH = (await cards.nth(idx + 1).boundingBox()).y - box.y;
  await cards.nth(idx).click({ position: { x: box.width * 0.82, y: Math.max(1, visH / 2) } });
  stats.solitario.clicks += 1;
}
async function solClickSrc(st, src) {
  if (src.type === 'waste') await page.locator('.solitario [data-role="waste"]').click();
  else if (src.type === 'found') await page.locator('.solitario [data-role="found-' + src.suit + '"]').click();
  else return solClickTab(src.col, src.idx);
  stats.solitario.clicks += 1;
}
async function solClickDst(dst) {
  if (dst.type === 'found') await page.locator('.solitario [data-role="found-' + dst.suit + '"]').click();
  else await page.locator('.solitario .col[data-col="' + dst.col + '"] > .pcard').last().click();
  stats.solitario.clicks += 1;
}
const sameDst = (a, b) => a.type === b.type && a.col === b.col && a.suit === b.suit;
const solBtn = (re) => page.locator('.solitario .actions button', { hasText: re });

// Performs a move through clicks and checks every intermediate screen. Returns the new snapshot.
async function solDoMove(pre, src, dst) {
  const st = pre.state;
  const dests = solDests(st, src);
  check(dests.some((d) => sameDst(d, dst)), 'solitario: the suggested move is legal by the rules', () => ({ src, dst, dests }));
  await solClickSrc(st, src);
  if (dests.length > 1 || src.type === 'found') {
    const sel = await solSnap();
    solInvariants(sel, 'selection');
    check(J(sel.state) === J(st), 'solitario: with several destinations the first click only selects');
    check(/scegli|più posti|dove|illuminata/i.test(sel.dom.msg || ''), 'solitario: message asks for the destination', sel.dom.msg);
    const marked = [];
    sel.dom.found.forEach((f, suit) => { if (/\bdest\b/.test(f.cls)) marked.push({ type: 'found', suit: suit }); });
    sel.dom.cols.forEach((c, ci) => { if (/\bdest\b/.test(c.cls)) marked.push({ type: 'tab', col: ci }); });
    check(marked.length === dests.length && dests.every((d) => marked.some((m) => sameDst(m, d))), 'solitario: every legal destination is highlighted, and nothing else', () => ({ marked, dests }));
    let selOk;
    if (src.type === 'waste') selOk = /selected/.test(sel.dom.waste.cls);
    else if (src.type === 'found') selOk = /selected/.test(sel.dom.found[src.suit].cls);
    else selOk = sel.dom.cols[src.col].cards.every((c, i) => /selected/.test(c.cls) === (i >= src.idx));
    check(selOk, 'solitario: the selected cards are highlighted');
    if (SHOTS && !solDoMove.shot) { solDoMove.shot = true; await shot('solitario-choose-destination'); }
    if (rnd() < 0.3) {
      // A second click on the same card removes the selection.
      await solClickSrc(st, src);
      const un = await solSnap();
      check(J(un.state) === J(st) && !un.dom.cols.some((c) => /\bdest\b/.test(c.cls)) && !un.dom.found.some((f) => /\bdest\b/.test(f.cls)), 'solitario: clicking the selected card again removes the selection');
      check(!/più posti|illuminata/i.test(un.dom.msg || ''), 'solitario: once the selection is removed, the message no longer asks to choose a place', un.dom.msg);
      await solClickSrc(st, src);
    }
    await solClickDst(dst);
    stats.solitario.multiDest += 1;
  } else {
    check(sameDst(dests[0] || {}, dst), 'solitario: single destination is the suggested one');
  }
  const post = await solSnap();
  const exp = solApply(st, src, dst);
  check(J(post.state) === J(exp), 'solitario: the move changes the state as the rules say', () => ({ src, dst }));
  solInvariants(post, 'after move');
  stats.solitario.moves += 1;
  if (dst.type === 'found') stats.solitario.foundationMoves += 1;
  return post;
}

async function solDraw(pre) {
  const st = pre.state;
  await page.locator('.solitario [data-role="stock"]').click();
  stats.solitario.clicks += 1;
  const post = await solSnap();
  const b = post.state;
  if (st.stock.length) {
    check(b.stock.length === st.stock.length - 1 && b.waste.length === st.waste.length + 1 && b.waste[b.waste.length - 1].card.id === st.stock[st.stock.length - 1].card.id, 'solitario: one click on the stock turns exactly one card');
    stats.solitario.draws += 1;
  } else if (st.waste.length) {
    check(b.waste.length === 0 && J(b.stock.map((x) => x.card.id)) === J(st.waste.map((x) => x.card.id).reverse()), 'solitario: recycling the waste keeps the order of the cards');
    stats.solitario.recycles += 1;
  } else {
    check(J(b) === J(st), 'solitario: click on an empty stock with empty waste does nothing');
  }
  check(J(b.tableau) === J(st.tableau) && J(b.foundation) === J(st.foundation), 'solitario: drawing does not touch columns or final piles');
  solInvariants(post, 'after draw');
  return post;
}

const HINT_NONE = /non vedo|nessuna mossa|bloccat|non ci sono/i;
async function solPressHint(pre) {
  await solBtn(/Suggerimento/).click();
  stats.solitario.clicks += 1;
  stats.solitario.hintsShown += 1;
  const s = await solSnap();
  const h = pre.hintNow;
  check(J(s.state) === J(pre.state), 'solitario: Suggerimento does not change the game');
  if (!h) check(HINT_NONE.test(s.dom.msg || ''), 'solitario: hint text when there is no move', s.dom.msg);
  else if (h.draw) check(/hinted/.test(s.dom.stock.cls), 'solitario: the hint to draw highlights the stock', s.dom.msg);
  else {
    let lit;
    if (h.src.type === 'waste') lit = /hinted/.test(s.dom.waste.cls);
    else lit = /hinted/.test(s.dom.cols[h.src.col].cards[h.src.idx].cls);
    check(lit && /illuminata|spostare/i.test(s.dom.msg || ''), 'solitario: hint highlights the card to move', s.dom.msg);
    if (SHOTS && !solPressHint.shot) { solPressHint.shot = true; await shot('solitario-hint'); }
  }
  return s;
}

async function solUndoCheck(before, after) {
  await solBtn(/Annulla/).click();
  stats.solitario.clicks += 1;
  stats.solitario.undos += 1;
  const s = await solSnap();
  check(J(s.state) === J(before.state), 'solitario: Annulla restores the position before the move (also the move counter)', () => ({ movesBefore: before.state.moves, movesNow: s.state.moves, after: after.state.moves }));
  check(/annullata/i.test(s.dom.msg || ''), 'solitario: Annulla message', s.dom.msg);
  solInvariants(s, 'after undo');
  return s;
}

// Clicks that must do nothing.
async function solNegativeClicks(pre) {
  const st = pre.state;
  // A face-down card.
  const downs = [];
  st.tableau.forEach((col, c) => col.forEach((x, i) => { if (!x.up) downs.push({ type: 'tab', col: c, idx: i }); }));
  if (downs.length) {
    const d = pick(downs);
    await solClickTab(d.col, d.idx);
    const s = await solSnap();
    check(J(s.state) === J(st), 'solitario: a click on a face-down card does nothing');
  }
  // A face-up card that cannot go anywhere.
  const blocked = [];
  st.tableau.forEach((col, c) => col.forEach((x, i) => { if (x.up && !solDests(st, { type: 'tab', col: c, idx: i }).length) blocked.push({ type: 'tab', col: c, idx: i }); }));
  if (blocked.length) {
    const b = pick(blocked);
    await solClickSrc(st, b);
    const s = await solSnap();
    check(J(s.state) === J(st) && /non si può spostare/i.test(s.dom.msg || ''), 'solitario: a card with no destination is refused with a message',
      () => ({ msg: s.dom.msg, clicked: b, card: st.tableau[b.col][b.idx].card, changed: J(s.state) !== J(st) }));
    stats.solitario.refused += 1;
  }
  // Empty waste and empty final piles.
  if (!st.waste.length) {
    await page.locator('.solitario [data-role="waste"]').click();
    const s = await solSnap();
    check(J(s.state) === J(st), 'solitario: a click on the empty waste does nothing');
  }
  const emptyFound = [0, 1, 2, 3].filter((x) => !st.foundation[x].length);
  if (emptyFound.length) {
    await page.locator('.solitario [data-role="found-' + pick(emptyFound) + '"]').click();
    const s = await solSnap();
    check(J(s.state) === J(st), 'solitario: a click on an empty final pile does nothing');
  }
}

// Waits for the win box (a win animation may run first; a click on it must skip it).
async function solWinBox(skipByClick) {
  let s = await solSnap();
  if (!s.dom.overlay && s.dom.cascade) {
    if (skipByClick) {
      await tick(600);
      const box = await page.locator('.solitario').boundingBox();
      await page.mouse.click(box.x + box.width / 2, box.y + Math.min(box.height, 500) / 2);
    } else {
      await waitUntil(() => !!document.querySelector('.solitario .overlay'), 15000);
    }
    s = await solSnap();
  }
  check(!!s.dom.overlay, 'solitario: the win box appears (after the animation, or at once after a click on it)', { skipByClick });
  return s;
}

// Plays one game with the hint engine through the interface. Returns 'won' | 'blocked' | 'cap'.
async function solPlayGame(maxSteps) {
  let s = await solSnap();
  solInvariants(s, 'new game');
  check(s.state.tableau.every((col, i) => col.length === i + 1) && s.state.stock.length === 12 && s.state.moves === 0, 'solitario: deal is 7 columns of 1 to 7 cards and 12 cards in the stock');
  let idleDraws = 0;
  for (let step = 0; step < maxSteps; step++) {
    if (s.won) return 'won';
    const h = s.hintNow;
    if (rnd() < 0.12) s = await solPressHint(s);
    if (rnd() < 0.06) { await solNegativeClicks(s); s = await solSnap(); }
    if (!h) return 'blocked';
    if (h.draw) {
      const cycle = s.state.stock.length + s.state.waste.length + 1;
      if (idleDraws > 2 * cycle) {
        // Two full passes through the stock without any other suggestion.
        if (SHOTS && !solPlayGame.shot) { solPlayGame.shot = true; await shot('solitario-no-progress'); }
        return solDead(s.state) ? 'blocked' : 'cap';
      }
      const before = s;
      s = await solDraw(s);
      idleDraws += 1;
      if (rnd() < 0.08) { s = await solUndoCheck(before, s); s = await solDraw(s); }
    } else {
      idleDraws = 0;
      const before = s;
      s = await solDoMove(s, h.src, h.dst);
      if (rnd() < 0.15 && !s.won) { s = await solUndoCheck(before, s); s = await solDoMove(s, h.src, h.dst); }
    }
    noErrors('solitario');
  }
  return 'cap';
}

const up = (c) => ({ card: c, up: true });
const down = (c) => ({ card: c, up: false });
function solEmptyState() {
  return { tableau: [[], [], [], [], [], [], []], stock: [], waste: [], foundation: [[], [], [], []], moves: 0 };
}
function fillFoundation(st, upTo) {
  for (let s = 0; s < 4; s++) for (let r = 1; r <= upTo; r++) st.foundation[s].push(mk(s, r));
}
// Puts every card that is not yet in the position face down into the stock.
function restToStock(st) {
  const used = new Set();
  st.tableau.forEach((col) => col.forEach((x) => used.add(x.card.id)));
  st.waste.forEach((x) => used.add(x.card.id));
  st.foundation.forEach((p) => p.forEach((c) => used.add(c.id)));
  for (let id = 0; id < 40; id++) if (!used.has(id)) st.stock.push(down(byId(id)));
  return st;
}
async function solLoad(st) {
  await page.evaluate((x) => { window.RA.current.debug.state = x; }, st);
  return solSnap();
}
// 24 cards left in four complete columns, the final piles hold Asso to 4.
function solDeepState() {
  const d = solEmptyState();
  fillFoundation(d, 4);
  [[0, 2], [2, 0], [1, 3], [3, 1]].forEach(function (pair, i) {
    for (let r = 10; r >= 5; r--) d.tableau[i].push(up(mk(pair[(10 - r) % 2], r)));
  });
  return d;
}

async function solPreparedTests() {
  // --- 1. Near-won position: the four Re are the only cards left. Win by four clicks.
  let st = solEmptyState();
  fillFoundation(st, 9);
  for (let s = 0; s < 4; s++) st.tableau[s + 1].push(up(mk(s, 10)));
  let s = await solLoad(st);
  solInvariants(s, 'prepared near-won');
  check(s.dom.buttons.some((t) => /Completa da solo/.test(t)), 'solitario: "Completa da solo" is offered when only final-pile moves are left', s.dom.buttons);
  for (let suit = 0; suit < 4; suit++) {
    const before = s;
    s = await solDoMove(s, { type: 'tab', col: suit + 1, idx: 0 }, { type: 'found', suit: suit });
    if (suit === 1) { s = await solUndoCheck(before, s); s = await solDoMove(s, { type: 'tab', col: 2, idx: 0 }, { type: 'found', suit: 1 }); }
  }
  check(s.won, 'solitario: the game is won after the last card');
  const wonAt = await page.evaluate(() => Date.now());
  if (s.dom.cascade) {
    check(/saltare/i.test(s.dom.text), 'solitario: the win animation says that a click skips it');
    await tick(1500);
    await shot('solitario-win-animation');
  }
  s = await solWinBox(false);
  const boxAfter = (await page.evaluate(() => Date.now())) - wonAt;
  check(boxAfter <= 9000, 'solitario: the win box appears at most 9 seconds after the last card', boxAfter);
  check(s.dom.overlay && /vinto|riuscito|complimenti/i.test(s.dom.overlay.h2 || ''), 'solitario: win title', s.dom.overlay);
  check(s.dom.overlay && new RegExp('Mosse:\\s*' + s.state.moves + '\\b').test(s.dom.overlay.text), 'solitario: win text shows the moves', s.dom.overlay && s.dom.overlay.text);
  await shot('solitario-win');
  // The win layer covers the buttons of the game: nothing under it can be reached with the mouse.
  const covered = await page.evaluate(() => Array.from(document.querySelectorAll('.solitario .actions button, .solitario [data-role="stock"]')).every((b) => {
    const r = b.getBoundingClientRect();
    const e = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return !!e && !!e.closest('.overlay');
  }));
  check(covered, 'solitario: after the win the win box layer covers the buttons and the stock');
  let after = await solSnap();
  await page.locator('.solitario .overlay button').dblclick();
  s = await solSnap();
  check(!s.won && !s.dom.overlay && s.state.moves === 0 && s.state.stock.length === 12 && s.state.tableau.every((col, i) => col.length === i + 1), 'solitario: Nuova partita after the win deals a new game (a double click on it moves nothing)');
  solInvariants(s, 'new game after win');
  stats.solitario.preparedWins += 1;

  // --- 2. "Completa da solo" from a deeper position: 24 cards in four full columns.
  s = await solLoad(solDeepState());
  solInvariants(s, 'prepared auto-finish');
  await shot('solitario-autofinish-ready');
  await solBtn(/Completa da solo/).click();
  const fin = await waitUntil(() => window.RA.current.debug.won, 6000);
  s = await solSnap();
  check(!!fin && s.won && s.state.moves === 24, 'solitario: "Completa da solo" finishes the game in 24 moves', { won: s.won, moves: s.state.moves });
  solInvariants(s, 'after auto-finish');
  s = await solWinBox(true);
  await page.locator('.solitario .overlay button').click();
  stats.solitario.preparedWins += 1;

  // --- 3. "Nuova partita" and "Annulla" stop a running "Completa da solo".
  let leaked = null;
  for (let attempt = 0; attempt < 6 && !leaked; attempt++) {
    await solLoad(solDeepState());
    await solBtn(/Completa da solo/).click();
    await solBtn(/Nuova partita/).click();
    const fresh = await solSnap();
    check(fresh.state.stock.length === 12 && fresh.state.moves === 0, 'solitario: Nuova partita during "Completa da solo" deals a new game');
    await tick(1500);
    const later = await solSnap();
    if (J(later.state) !== J(fresh.state)) leaked = { movesMadeByItself: later.state.moves, cardsInFinalPiles: later.state.foundation.map((p) => p.length) };
    solInvariants(later, 'after new game during auto-finish');
  }
  check(!leaked, 'solitario: "Nuova partita" stops a running "Completa da solo" (the new game does not move by itself)', leaked);
  await solLoad(solDeepState());
  await solBtn(/Completa da solo/).click();
  await tick(300);
  const running = await solSnap();
  check(running.state.moves >= 2 && !running.won, 'test setup: "Completa da solo" is running', running.state.moves);
  await solBtn(/Annulla/).click();
  const undone = await solSnap();
  await tick(1500);
  after = await solSnap();
  check(undone.state.moves === running.state.moves - 1 && J(after.state) === J(undone.state) && !after.won, 'solitario: "Annulla" stops a running "Completa da solo"', () => ({ running: running.state.moves, undone: undone.state.moves, later: after.state.moves }));

  // --- 4. Several destinations: final pile or one of two columns.
  st = solEmptyState();
  st.foundation[0].push(mk(0, 1));
  st.tableau[0].push(up(mk(2, 3)));
  st.tableau[1].push(up(mk(3, 3)));
  st.tableau[2].push(down(mk(1, 5)), up(mk(1, 4)));
  st.waste.push(up(mk(0, 2)));
  restToStock(st);
  s = await solLoad(st);
  solInvariants(s, 'prepared multi-destination');
  check(solDests(s.state, { type: 'waste' }).length === 3, 'test setup: three destinations');
  const pre4 = s;
  s = await solDoMove(s, { type: 'waste' }, { type: 'tab', col: 1 });
  s = await solUndoCheck(pre4, s);
  s = await solDoMove(s, { type: 'waste' }, { type: 'found', suit: 0 });
  // Selection, then a click on a column that is not a destination: nothing may move there.
  s = await solLoad(st);
  await page.locator('.solitario [data-role="waste"]').click();
  await page.locator('.solitario .col[data-col="5"]').click({ position: { x: 30, y: 30 } });
  after = await solSnap();
  check(J(after.state) === J(s.state), 'solitario: with a selection, a click on a column that is not a destination moves nothing');
  // Selection, then a double click on a destination: the card moves once and nothing else moves.
  s = await solLoad(st);
  await page.locator('.solitario [data-role="waste"]').click();
  await page.locator('.solitario .col[data-col="1"] > .pcard').last().dblclick();
  after = await solSnap();
  check(J(after.state) === J(solApply(s.state, { type: 'waste' }, { type: 'tab', col: 1 })), 'solitario: a double click on a destination moves the selected card once');

  // --- 5. A blocked game. Every face-up card and every stock card is Coppe or Denari
  // and no Asso is reachable, so nothing can ever move. The hint must say so.
  const blockedState = function () {
    const b = solEmptyState();
    const warm = [];
    for (let suit = 0; suit < 2; suit++) for (let r = 2; r <= 10; r++) warm.push(mk(suit, r));
    const cool = [mk(0, 1), mk(1, 1)];
    for (let suit = 2; suit < 4; suit++) for (let r = 1; r <= 10; r++) cool.push(mk(suit, r));
    for (let c = 0; c < 7; c++) {
      for (let i = 0; i < (c < 1 ? 4 : 3); i++) b.tableau[c].push(down(cool.pop()));
      b.tableau[c].push(up(warm.pop()));
    }
    warm.forEach((c) => b.stock.push(down(c)));
    return b;
  };
  st = blockedState();
  s = await solLoad(st);
  solInvariants(s, 'prepared blocked game');
  check(solDead(s.state), 'test setup: the position is blocked');
  let h = await solPressHint(s);
  await shot('solitario-blocked-hint');
  check(s.hintNow === null && HINT_NONE.test(h.dom.msg || '') && !/hinted/.test(h.dom.stock.cls), 'solitario: in a blocked game Suggerimento says that there are no more moves', { hint: s.hintNow, msg: h.dom.msg });
  s = await solDraw(h);
  h = await solPressHint(s);
  check(HINT_NONE.test(h.dom.msg || ''), 'solitario: in a blocked game the hint stays "no more moves" after a card is turned', h.dom.msg);
  // The same position, but one card at the bottom of the stock fits a column: the hint must say "turn a card"
  // until that card comes up, then show it.
  st = blockedState();
  let swapped = false;
  st.tableau.forEach((col) => col.forEach((x) => {
    if (!swapped && !x.up && x.card.id === mk(2, 3).id) { const t = st.stock[0].card; st.stock[0].card = x.card; x.card = t; swapped = true; }
  }));
  s = await solLoad(st);
  check(swapped && s.hintNow && s.hintNow.draw === true, 'solitario: the hint says to turn a card when a card deeper in the stock has a destination', s.hintNow);
  let turns = 0;
  while (s.hintNow && s.hintNow.draw && turns < 20) {
    if (turns === 0) { h = await solPressHint(s); check(/girare|pescare/i.test(h.dom.msg || ''), 'solitario: text of the hint to turn a card', h.dom.msg); }
    s = await solDraw(s);
    turns += 1;
  }
  check(turns === st.stock.length && s.hintNow && s.hintNow.src && s.hintNow.src.type === 'waste', 'solitario: after the useful card is turned, the hint shows it', { turns, hint: s.hintNow });
  if (s.hintNow && s.hintNow.src) s = await solDoMove(s, s.hintNow.src, s.hintNow.dst);
  stats.solitario.blocked += 1;

  // A position where the hint finds nothing, although two legal moves put a card on a final pile:
  // 8 di Bastoni + 7 di Coppe go onto the 9 di Coppe, then the 9 di Denari goes to its final pile.
  st = solEmptyState();
  [5, 8, 8, 5].forEach((n, suit) => { for (let r = 1; r <= n; r++) st.foundation[suit].push(mk(suit, r)); });
  st.tableau[0].push(up(mk(1, 10)), up(mk(3, 9)));
  st.tableau[1].push(up(mk(3, 10)), up(mk(1, 9)), up(mk(3, 8)), up(mk(0, 7)));
  st.tableau[3].push(up(mk(2, 10)), up(mk(0, 9)));
  st.tableau[4].push(down(mk(0, 6)), down(mk(0, 10)), down(mk(3, 6)), up(mk(2, 9)), up(mk(0, 8)), up(mk(3, 7)));
  s = await solLoad(st);
  solInvariants(s, 'prepared position with a two-move way to a final pile');
  h = await solPressHint(s);
  const gaveUp = HINT_NONE.test(h.dom.msg || '');
  s = await solDoMove(h, { type: 'tab', col: 1, idx: 2 }, { type: 'tab', col: 3 });
  s = await solDoMove(s, { type: 'tab', col: 1, idx: 1 }, { type: 'found', suit: 1 });
  check(!gaveUp, 'solitario: Suggerimento does not say "no more moves" while two legal moves put a card on a final pile', { hintText: h.dom.msg, movesThenPlayed: ['8 di Bastoni + 7 di Coppe onto 9 di Coppe', '9 di Denari to its final pile'], cardsInFinalPileDenari: s.state.foundation[1].length });

  // --- 6. Double clicks: the second click is ignored.
  st = solEmptyState();
  st.tableau[0].push(up(mk(2, 3)));
  st.foundation[0].push(mk(0, 1));
  st.waste.push(up(mk(1, 1)), up(mk(0, 2)));
  restToStock(st);
  s = await solLoad(st);
  await page.locator('.solitario [data-role="waste"]').dblclick();
  after = await solSnap();
  check(J(after.state) === J(s.state) && /selected/.test(after.dom.waste.cls) && /\bdest\b/.test(after.dom.found[0].cls) && /\bdest\b/.test(after.dom.cols[0].cls),
    'solitario: a double click on a card with several destinations selects it (the second click does not remove the selection)', { waste: after.dom.waste.cls, moves: after.state.moves });
  st = solEmptyState();
  st.waste.push(up(mk(1, 1)), up(mk(0, 1)));
  restToStock(st);
  s = await solLoad(st);
  await page.locator('.solitario [data-role="waste"]').dblclick();
  after = await solSnap();
  check(after.state.moves === 1 && J(after.state.foundation.map((p) => p.length)) === '[1,0,0,0]', 'solitario: a double click on the waste moves one card only', { moves: after.state.moves, finalPiles: after.state.foundation.map((p) => p.length) });
  solInvariants(after, 'after double click on the waste');
  st = solEmptyState();
  st.tableau[0].push(down(mk(1, 1)), up(mk(0, 1)));
  restToStock(st);
  s = await solLoad(st);
  await page.locator('.solitario .col[data-col="0"] > .pcard').last().dblclick();
  after = await solSnap();
  check(after.state.moves === 1 && after.state.tableau[0].length === 1 && after.state.tableau[0][0].up, 'solitario: a double click on a column card moves one card only (the card turned over stays)', { moves: after.state.moves });
  solInvariants(after, 'after double click on a column');

  // --- 7. A card of a final pile: the first click only selects it, the second click on the column moves it.
  st = solEmptyState();
  st.foundation[0].push(mk(0, 1), mk(0, 2));
  st.tableau[0].push(up(mk(2, 3)));
  restToStock(st);
  s = await solLoad(st);
  await page.locator('.solitario [data-role="found-0"]').click();
  after = await solSnap();
  check(J(after.state) === J(s.state) && /selected/.test(after.dom.found[0].cls) && /\bdest\b/.test(after.dom.cols[0].cls), 'solitario: one click on a final pile only selects its top card', { cardsInFinalPileCoppe: after.state.foundation[0].length });
  await page.locator('.solitario [data-role="found-0"]').click();
  after = await solSnap();
  check(J(after.state) === J(s.state) && !/selected/.test(after.dom.found[0].cls), 'solitario: a second click on the final pile removes the selection');
  s = await solDoMove(after, { type: 'found', suit: 0 }, { type: 'tab', col: 0 });
  check(s.state.foundation[0].length === 1 && s.state.tableau[0].length === 2, 'solitario: a card of a final pile can be taken back to a column in two clicks');
  await page.locator('.solitario [data-role="found-0"]').click();
  after = await solSnap();
  check(J(after.state) === J(s.state) && /non si può spostare/i.test(after.dom.msg || ''), 'solitario: a final-pile card with no column to go to is refused with a message', after.dom.msg);

  // --- 8. Long columns: 6 face-down cards and a run from the Re to the Asso; 5 face-down and Re to 4.
  const colSteps = () => page.evaluate(() => Array.from(document.querySelectorAll('.solitario .col')).map((col) => {
    const kids = Array.from(col.children);
    return kids.slice(1).map((k, i) => ({ up: kids[i].dataset.card !== undefined, px: Math.round((k.getBoundingClientRect().top - kids[i].getBoundingClientRect().top) * 10) / 10 }));
  }));
  const longState = function () {
    const l = solEmptyState();
    [2, 3, 4, 5, 6, 7].forEach((r) => l.tableau[6].push(down(mk(1, r))));
    for (let r = 10; r >= 1; r--) l.tableau[6].push(up(mk(r % 2 === 0 ? 0 : 2, r)));
    [1, 9, 10].forEach((r) => l.tableau[5].push(down(mk(1, r))));
    l.tableau[5].push(down(mk(3, 1)), down(mk(3, 2)));
    for (let r = 10; r >= 4; r--) l.tableau[5].push(up(mk(r % 2 === 0 ? 3 : 0, r)));
    l.tableau[2] = [up(mk(1, 8))];
    return restToStock(l);
  };
  const layoutOk = async function (label) {
    const snap = await solSnap();
    const steps = await colSteps();
    const ups = [].concat.apply([], steps).filter((x) => x.up).map((x) => x.px);
    check(ups.length > 0 && Math.min.apply(null, ups) >= 23.5 && [].concat.apply([], steps).every((x) => x.px > 0), 'solitario: long columns keep a step of 24 px or more between face-up cards (' + label + ')', () => ({ min: Math.min.apply(null, ups), steps: steps[6].map((x) => x.px) }));
    check(snap.dom.miss.length === 0, 'solitario: every covered face-up card of a long column can be clicked (' + label + ')', () => snap.dom.miss.slice(0, 3));
    layoutChecks('solitario', snap.lay, label);
    return { snap, steps };
  };
  s = await solLoad(longState());
  solInvariants(s, 'prepared long columns');
  await shot('solitario-long-column');
  await layoutOk('window 1120 x 812');
  // A covered card far down the long column is reached by a real click (the page may have to scroll).
  s = await solDoMove(s, { type: 'tab', col: 6, idx: 9 }, { type: 'tab', col: 2 });
  check(s.state.tableau[2].length === 8 && s.state.tableau[6].length === 9, 'solitario: a run taken from the middle of a long column moves as a whole');

  // --- 9. Lower and smaller windows, and a new layout when the window is resized.
  for (const size of [[1120, 640], [700, 600], [480, 560]]) {
    await page.setViewportSize({ width: size[0], height: size[1] });
    s = await solLoad(longState());
    if (size[1] === 640) await shot('solitario-low-window');
    await layoutOk('window ' + size[0] + ' x ' + size[1]);
  }
  await page.setViewportSize({ width: 1120, height: 640 });
  s = await solLoad(longState());
  const low = await colSteps();
  const eventsBefore = await page.evaluate(() => window.__e2eResizes);
  await page.setViewportSize({ width: 1120, height: 812 });
  // The browser delivers the resize event in real time, whatever the page clock says.
  let resizeEvents = 0;
  for (let i = 0; i < 60 && !resizeEvents; i++) {
    await new Promise((r) => setTimeout(r, 50));
    resizeEvents = (await page.evaluate(() => window.__e2eResizes)) - eventsBefore;
  }
  await tick(100);
  const resized = await colSteps();
  s = await solLoad(longState());
  const freshLayout = await colSteps();
  check(J(resized) === J(freshLayout) && J(resized) !== J(low), 'solitario: the columns are laid out again when the window is resized', () => ({ resizeEventsSeenByThePage: resizeEvents, low: low[5].map((x) => x.px), resized: resized[5].map((x) => x.px), fresh: freshLayout[5].map((x) => x.px) }));
  solInvariants(s, 'back to the normal window');
  noErrors('solitario prepared');
}

// =====================================================================================
// Leaving a game with Esc in the middle of an animation
// =====================================================================================
async function escapeTests() {
  const leave = async function (label, viaButton) {
    await page.evaluate(() => { window.__old = window.RA.current; window.__oldState = JSON.stringify(window.RA.current.debug.state); });
    if (viaButton) await page.locator('#home').click();
    else await page.keyboard.press('Escape');
    stats.escapes += 1;
    const m = await page.evaluate(() => ({ tiles: document.querySelectorAll('#stage button.tile').length, panels: document.querySelectorAll('#stage .game-panel').length, cur: window.RA.current === null, homeHidden: document.getElementById('home').hidden }));
    check(m.tiles >= 3 && m.panels === 0 && m.cur && m.homeHidden, 'esc: the menu is shown and the game is removed (' + label + ')', m);
    await tick(4000);
    const same = await page.evaluate(() => JSON.stringify(window.__old.debug.state) === window.__oldState && document.querySelectorAll('#stage .game-panel, #stage .overlay').length === 0);
    check(same, 'esc: no timer of the closed game runs after leaving (' + label + ')');
    noErrors('esc ' + label);
  };
  const playFirstCard = async function () {
    await page.locator('.scopa .hand.me [data-card]').first().click();
    if (await page.locator('.scopa .actions button').count()) await page.locator('.scopa .actions button').first().click();
  };

  // Scopa: leave while the opponent thinks, re-enter, leave while it shows its card.
  await openFromMenu('Scopa');
  await playFirstCard();
  await tick(200);
  await leave('scopa, opponent thinking', false);
  await openFromMenu('Scopa');
  let s = await scopaSnap();
  check(s.match.round === 1 && J(s.match.scores) === '[0,0]' && s.state.deck.length === 30 && s.state.turn === 0 && !s.busy, 'esc: re-entering Scopa starts a clean match');
  scopaInvariants(s, 're-enter');
  await playFirstCard();
  await waitUntil(() => !!document.querySelector('.scopa .felt .played'), 1500);
  await leave('scopa, opponent card shown', true);
  // Re-enter and play two full exchanges to prove the game still works.
  await openFromMenu('Scopa');
  const tr = newScopaTracker();
  tr.wantShot = false;
  tr.shotChoose = true;
  const base = stats.scopa.humanPlays;
  await scopaLoop(tr, () => stats.scopa.humanPlays >= base + 2);
  // Play on to the end of the round and leave during the pause before the points table.
  await scopaLoop(tr, (t, now) => now.ended && !now.overlay);
  await leave('scopa, pause before the points table', false);

  // Briscola: leave while the opponent thinks and while the finished trick is shown.
  await openFromMenu('Briscola');
  await page.locator('.briscola .hand.me [data-card]').first().click();
  await tick(300);
  await leave('briscola, opponent thinking', false);
  await openFromMenu('Briscola');
  let b = await brSnap();
  check(b.state.deck.length === 34 && b.state.turn === 0 && !b.busy && J(b.wins) === '[0,0]', 'esc: re-entering Briscola starts a clean hand');
  await page.locator('.briscola .hand.me [data-card]').first().click();
  await waitUntil(() => !!document.querySelector('.briscola .slot.winner'), 2000);
  b = await brSnap();
  check(b.dom.slots.some((x) => x.winner), 'esc: a finished trick is on the table before leaving');
  await leave('briscola, finished trick shown', true);

  // Solitario: leave while "Completa da solo" is running.
  await openFromMenu('Solitario');
  await solLoad(solDeepState());
  await solBtn(/Completa da solo/).click();
  await leave('solitario, auto-finish running', false);

  // Quick open and close of the three games.
  for (const t of ['Scopa', 'Briscola', 'Solitario', 'Scopa', 'Briscola']) {
    await openFromMenu(t);
    await page.keyboard.press('Escape');
  }
  await tick(3000);
  const m = await page.evaluate(() => ({ tiles: document.querySelectorAll('#stage button.tile').length, panels: document.querySelectorAll('#stage .game-panel').length }));
  check(m.tiles >= 3 && m.panels === 0, 'esc: quick open and close leaves only the menu', m);
  noErrors('esc quick');
}

// =====================================================================================
// Main
// =====================================================================================
(async () => {
  if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });
  browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1120, height: 812 }, deviceScaleFactor: 1 });
  await context.addInitScript((seed) => {
    let a = seed >>> 0;
    Math.random = function () {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }, SEED);
  await context.addInitScript(installLayoutProbe);
  page = await context.newPage();
  page.on('pageerror', (e) => pageErrors.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') pageErrors.push('console: ' + m.text()); });
  await page.clock.install();
  await page.goto(URL);
  await page.waitForSelector('button.tile');
  const t0 = Date.now();
  const log = (msg) => console.log('[' + ((Date.now() - t0) / 1000).toFixed(1) + 's] ' + msg);
  await shot('menu');

  // ---- Phase 1: real time (timers run as for a real user) ----
  await openFromMenu('Scopa');
  await shot('scopa-start');
  let tr = newScopaTracker();
  await scopaLoop(tr, () => stats.scopa.humanPlays >= 3 && stats.scopa.cpuPlays >= 3);
  log('scopa in real time: ' + stats.scopa.humanPlays + ' human plays, ' + stats.scopa.cpuPlays + ' opponent plays');
  await page.keyboard.press('Escape');

  await openFromMenu('Briscola');
  await shot('briscola-start');
  let btr = { wins: [0, 0], hand: 1, smart: false, wantShot: true };
  while (stats.briscola.tricks < 3) await brStep(btr);
  log('briscola in real time: ' + stats.briscola.tricks + ' tricks, finished trick visible for at least ' + stats.briscola.minShownMs + ' ms');
  check(stats.briscola.minShownMs >= 1300, 'briscola: in real time the finished trick stays visible for about 1.5 seconds', stats.briscola.minShownMs);
  await page.keyboard.press('Escape');

  // ---- Phase 2: the page clock is driven by the test (same code paths, no waiting) ----
  await goFast();
  const realTricks = stats.briscola.tricks;

  await openFromMenu('Scopa');
  tr = newScopaTracker();
  tr.wantShot = false;
  await scopaLoop(tr, () => stats.scopa.matches >= MATCHES);
  log('scopa: ' + stats.scopa.matches + ' matches ' + J(stats.scopa.finals) + ', ' + stats.scopa.rounds + ' rounds');
  check(stats.scopa.multiChoice >= 1, 'coverage: the multi-capture choice buttons were used at least once', stats.scopa.multiChoice);
  check(stats.scopa.rounds >= 2 * MATCHES, 'coverage: several rounds per Scopa match', stats.scopa.rounds);
  await page.keyboard.press('Escape');

  await openFromMenu('Briscola');
  btr = { wins: [0, 0], hand: 1, smart: false, wantShot: false };
  while (stats.briscola.hands < HANDS) {
    btr.smart = stats.briscola.hands % 2 === 1;
    const r = await brStep(btr);
    if (r === 'end') await brHandEnd(btr);
  }
  log('briscola: ' + stats.briscola.hands + ' hands ' + J(stats.briscola.results) + ', ' + (stats.briscola.tricks - realTricks) + ' tricks');
  check(stats.briscola.tricks - realTricks === 20 * HANDS, 'briscola: 20 tricks per hand', stats.briscola.tricks - realTricks);
  await page.keyboard.press('Escape');

  await escapeTests();
  log('esc: left a running game ' + stats.escapes + ' times');

  await openFromMenu('Solitario');
  await shot('solitario-start');
  for (let g = 0; g < GAMES; g++) {
    const res = await solPlayGame(700);
    stats.solitario.games += 1;
    if (res === 'won') {
      stats.solitario.naturalWins += 1;
      const s = await solWinBox(g % 2 === 0);
      check(s.dom.overlay && /vinto|riuscito|complimenti/i.test(s.dom.overlay.h2 || ''), 'solitario: win box after a game won by play');
      await page.locator('.solitario .overlay button').click();
    } else {
      if (res === 'blocked') stats.solitario.blocked += 1;
      if (g === 0) await shot('solitario-late-game');
      await solBtn(/Nuova partita/).click();
    }
  }
  log('solitario: ' + stats.solitario.games + ' games, ' + stats.solitario.clicks + ' clicks, ' + stats.solitario.moves + ' moves');
  check(stats.solitario.recycles >= 1 && stats.solitario.undos >= 1 && stats.solitario.foundationMoves >= 1, 'coverage: stock recycling, undo and final-pile moves were used', stats.solitario);
  await solPreparedTests();
  check(stats.solitario.multiDest >= 1, 'coverage: the choose-a-destination flow was used', stats.solitario.multiDest);
  await page.keyboard.press('Escape');
  noErrors('end');

  await browser.close();

  // ---- Summary ----
  console.log('\n=== cards e2e summary (seed ' + SEED + ') ===');
  console.log('checks run: ' + stats.checks);
  console.log('scopa: ' + J(stats.scopa));
  console.log('briscola: ' + J(stats.briscola));
  console.log('solitario: ' + J(stats.solitario));
  console.log('layout at 1120 x 812: scopa hand ' + scopaInvariants.worst + ' px below the window at worst, briscola hand ' + brInvariants.worst + ' px (0 or less = fully visible)');
  console.log('solitario layout: smallest visible strip of a covered face-up card ' + Math.round(solInvariants.minStrip * 10) / 10 + ' px; panel bottom ' + Math.round(solInvariants.maxBottom) + ' px below the window at worst');
  console.log('games left with Esc or Menu: ' + stats.escapes + ', page errors: ' + pageErrors.length);
  let bad = failures.size;
  if (failures.size) {
    console.log('\nFAILED CHECKS (' + failures.size + '):');
    failures.forEach((f, key) => console.log(' - ' + key + ' (x' + f.count + ')' + (f.first !== undefined ? ' :: ' + J(f.first) : '')));
  }
  if (pageErrors.length) console.log('\nPAGE ERRORS:\n' + pageErrors.slice(0, 20).join('\n'));
  console.log(bad ? '\nRESULT: FAIL (' + bad + ')' : '\nRESULT: OK');
  process.exit(bad ? 1 : 0);
})().catch(async (e) => {
  console.error('ABORTED: ' + (e && e.stack ? e.stack : e));
  if (failures.size) failures.forEach((f, key) => console.error(' - ' + key + ' (x' + f.count + ')' + (f.first !== undefined ? ' :: ' + J(f.first) : '')));
  if (pageErrors.length) console.error('PAGE ERRORS:\n' + pageErrors.slice(0, 10).join('\n'));
  if (browser) await browser.close().catch(() => {});
  process.exit(2);
});
