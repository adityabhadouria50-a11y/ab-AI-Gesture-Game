// Screenshots of every game in GPU headless Chrome, played by the built-in bot, so you (or your coding agent) can
// check the arcade without a webcam.
//   npm run capture                 hub + all three games (intro, early, late, results), asserts each bot scored
//   npm run capture -- mobile       the same at phone size (390x844, touch)
//   npm run capture -- fruit        just one game (starfall | shooter | fruit)
// Needs the dev server running (npm run dev). URL=http://localhost:5173/ by default.
// Look at every image in captures/: a test passing does not mean the game looks right.
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'captures');
mkdirSync(out, { recursive: true });
const BASE = process.env.URL || 'http://localhost:5173/';
const args = process.argv.slice(2);
const mobile = args.includes('mobile');
const only = ['starfall', 'shooter', 'fruit'].filter((g) => args.includes(g));
const games = only.length ? only : ['starfall', 'shooter', 'fruit'];
const tag = mobile ? 'm-' : '';

const gpu = process.platform === 'darwin' ? ['--use-gl=angle', '--use-angle=metal'] : ['--use-gl=angle'];
const browser = await chromium.launch({ executablePath: process.env.CHROME || undefined, args: [...gpu, '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required', '--mute-audio'] });
const ctx = await browser.newContext(mobile
  ? { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true }
  : { viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
const errors = [];
page.on('console', (m) => { if (m.type() === 'error' || /GL_INVALID/.test(m.text())) errors.push(m.text()); });
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
const shot = async (name) => { await page.screenshot({ path: join(out, `${tag}${name}.png`) }); console.log('saved', `captures/${tag}${name}.png`); };
const game = () => page.evaluate(() => window.__game.snapshot());

await page.goto(BASE + '?mute=1&seed=3');
await page.waitForTimeout(1500);
await shot('hub');

const results = {};
let ok = true;
for (const g of games) {
  await page.goto(BASE + `?game=${g}&mute=1&seed=3`);
  await page.waitForTimeout(1500);
  await shot(`${g}-intro`);

  // starfall rounds are timed; shooter and fruit end when the bot runs out of shield / lives (or we stop looking)
  await page.goto(BASE + `?bot=1&game=${g}&mute=1&seed=3&round=16`);
  await page.waitForTimeout(5000);
  await shot(`${g}-early`);
  await page.waitForTimeout(9000);
  await shot(`${g}-late`);
  const snap = await game();
  results[g] = snap;
  const scored = (snap.score ?? 0) > 0;
  if (!scored) ok = false;
  console.log(g, JSON.stringify(snap));
  if (g === 'starfall') {
    const reached = await page.waitForFunction(() => window.__game.phase === 'results', null, { timeout: 15000 }).then(() => true, () => false);
    await page.waitForTimeout(500);
    await shot(`${g}-results`);
    const restarted = await page.waitForFunction(() => window.__game.phase === 'play', null, { timeout: 8000 }).then(() => true, () => false);
    if (!reached || !restarted) ok = false;
    console.log(`  results reached: ${reached}, bot restarted: ${restarted}`);
  }
}

if (errors.length) {
  ok = false;
  console.log('errors:\n  ' + errors.join('\n  '));
}
console.log(ok ? `OK: every bot scored (${games.map((g) => `${g} ${results[g].score}`).join(', ')}), no console errors` : 'FAILED');
process.exitCode = ok ? 0 : 1;
await browser.close();
