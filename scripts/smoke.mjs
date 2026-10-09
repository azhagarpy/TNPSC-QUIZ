// UI smoke test in demo mode: builds the app without any .env keys into
// smoke-output/dist, serves it with `vite preview`, drives a phone-sized
// browser through language pick → home → a solo set → result, and fails on
// any page error. Screenshots go to the output folder.
//
//   node scripts/smoke.mjs [outDir]
// Uses an installed Chrome or Edge (no browser download).
import { build, preview } from 'vite';
import { chromium } from 'playwright-core';
import { mkdirSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const out = process.argv[2] ?? 'smoke-output';
mkdirSync(out, { recursive: true });
const outDir = resolve(out, 'dist');
const noEnv = mkdtempSync(join(tmpdir(), 'g4-noenv-')); // no .env files → demo mode
for (const k of Object.keys(process.env)) if (k.startsWith('VITE_')) delete process.env[k];

await build({ envDir: noEnv, logLevel: 'warn', build: { outDir, emptyOutDir: true } });
const server = await preview({ envDir: noEnv, build: { outDir }, preview: { port: 4173, strictPort: true }, logLevel: 'silent' });
const base = 'http://localhost:4173';

let browser;
for (const channel of ['chrome', 'msedge']) {
  try {
    browser = await chromium.launch({ channel, headless: true });
    break;
  } catch {
    /* try the next installed browser */
  }
}
if (!browser) throw new Error('Install Chrome or Edge to run the smoke test');

const errors = [];
const context = await browser.newContext({
  viewport: { width: 360, height: 740 },
  deviceScaleFactor: 2,
  isMobile: true,
  hasTouch: true,
  locale: 'ta-IN',
});
const page = await context.newPage();
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
page.on('console', (m) => m.type() === 'error' && errors.push(`console: ${m.text()}`));
const shot = (name) => page.screenshot({ path: join(out, `${name}.png`), fullPage: true });
const step = (s) => console.log(`  • ${s}`);
async function playSet(prefix) {
  for (let i = 0; i < 10; i++) {
    const options = page.locator('[role=group] button');
    await options.first().waitFor();
    if (i === 0 && prefix) await shot(`${prefix}-question`);
    await options.nth(i % 4).click();
    const next = page.getByRole('button', { name: i === 9 ? 'முடிவைப் பார்' : 'அடுத்து' });
    await next.waitFor();
    await next.click();
  }
}

try {
  await page.goto(base);
  await page.getByRole('button', { name: 'தமிழ்' }).click();
  step('language picked');
  await page.getByText('வணக்கம்').waitFor();
  await shot('1-home');
  step('home rendered');

  await page.getByRole('button', { name: /தனிப் பயிற்சி/ }).first().click();
  await page.getByText('10 வினாக்களைத் தொடங்கு').waitFor();
  await shot('2-solo-setup');
  step('solo setup rendered');

  await page.getByRole('button', { name: /10 வினாக்களைத் தொடங்கு/ }).click();
  for (let i = 0; i < 10; i++) {
    const options = page.locator('[role=group] button');
    await options.first().waitFor();
    if (i === 0) await shot('3-question');
    await options.nth(i % 4).click();
    const next = page.getByRole('button', { name: i === 9 ? 'முடிவைப் பார்' : 'அடுத்து' });
    await next.waitFor();
    if (i === 0) await shot('4-reveal');
    await next.click();
  }
  await page.getByText('பயிற்சி முடிந்தது').waitFor();
  await shot('5-result');
  step('played a 10-question set to the result screen');

  await page.goto(`${base}/terms`);
  await page.getByText('Coins are free game points').waitFor();
  step('terms page rendered');

  await page.goto(`${base}/profile`);
  await page.getByText('அமைப்புகள்').waitFor();
  await shot('6-profile');
  step('profile rendered');

  await page.goto(base);
  await page.getByRole('button', { name: /விரைவுப் போட்டி/ }).click();
  await page.getByText('பயிற்சி பாட் · நுழைவுத் தொகை இல்லை').first().waitFor();
  await playSet('8-bot');
  await page.getByText(/பாட்டை வென்றீர்கள்|இந்த முறை பாட் வென்றது|சமநிலை/).waitFor();
  await shot('9-bot-result');
  step('quick match → practice bot played to the result');

  await context.close();
  const en = await browser.newContext({ viewport: { width: 360, height: 740 }, isMobile: true, hasTouch: true, colorScheme: 'dark' });
  const p2 = await en.newPage();
  p2.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  await p2.goto(base);
  await p2.getByRole('button', { name: 'English' }).click();
  await p2.getByText('Vanakkam').waitFor();
  await p2.screenshot({ path: join(out, '7-home-en-dark.png'), fullPage: true });
  const overflow = await p2.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  if (overflow) errors.push('horizontal scroll at 360 px');
  step('English + dark theme rendered, no horizontal scroll at 360 px');
} finally {
  await browser.close();
  await server.close();
}

if (errors.length) {
  console.error('\nErrors:\n' + errors.join('\n'));
  process.exit(1);
}
console.log(`\nSmoke test passed. Screenshots in ${out}/`);
