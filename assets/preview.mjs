// node preview.mjs scene.html cueA,cueB,... [D]: fake evenly spaced cues, lint, frames 0.9s after each cue.
import { chromium } from 'playwright';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
const [scene, names, Darg] = process.argv.slice(2);
const list = names.split(',');
const D = Number(Darg || 26000);
const cues = Object.fromEntries(list.map((n, i) => [n, Math.round(1500 + (i * (D - 4000)) / list.length)]));
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 2560, height: 1440 } });
page.on('pageerror', (e) => console.log('PAGE ERROR', e.message));
page.on('console', (m) => m.type() === 'error' && console.log('console', m.text()));
await page.addInitScript(({ c, d }) => { window.__CUES = c; window.__DURATION_MS = d; window.__LEAD_MS = 900; }, { c: cues, d: D });
await page.goto(pathToFileURL(path.resolve(scene)).href, { waitUntil: 'networkidle' });
await page.evaluate(() => document.fonts.ready);
const probs = await page.evaluate(() => { window.setup?.(); return window.K.lint(); });
console.log('lint:', probs.length ? probs : 'clean');
await page.evaluate(() => { window.__tl = window.timeline(); window.__tl.pause(0); });
const base = path.basename(scene, '.html');
const shots = [...list.map((n) => [n, cues[n] + 900]), ['end', D - 100]];
for (const [n, ms] of shots) {
  await page.evaluate((t) => { window.__tl.seek(t / 1000, false); }, ms);
  await page.screenshot({ path: `preview/${base}-${n}.jpg`, type: 'jpeg', quality: 70, scale: 'css' });
}
console.log('frames', shots.map((s) => s[0]).join(' '));
await browser.close();
