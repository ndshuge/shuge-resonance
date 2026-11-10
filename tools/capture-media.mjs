#!/usr/bin/env node
// 生成 README 用的截图和动图帧。页面时钟被换成手动步进的，所以无论机器多慢，录出来都是匀速的。
//
//   node tools/serve.mjs . 18990
//   node tools/capture-media.mjs            # 帧和截图写到 tools/qa/out/media/
//   python tools/pack-media.py              # 压成 docs/media/ 里的 webp / jpg
import { mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const OUT = join(here, 'qa', 'out', 'media');
const BASE = process.env.BASE_URL || 'http://127.0.0.1:18990/';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright');
await mkdir(OUT, { recursive: true });

const browser = await chromium.launch({
  channel: process.env.QA_CHANNEL || undefined, headless: true,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});

const VIRTUAL_CLOCK = () => {
  let vt = 0; const cbs = [];
  performance.now = () => vt;
  window.requestAnimationFrame = (cb) => { cbs.push(cb); return cbs.length; };
  window.cancelAnimationFrame = () => {};
  window.__step = (ms) => { vt += ms; for (const cb of cbs.splice(0)) cb(vt); };
};

async function open(width, height, dpr, mobile = false) {
  const ctx = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: dpr, isMobile: mobile, hasTouch: mobile, reducedMotion: 'no-preference' });
  const page = await ctx.newPage();
  await page.addInitScript(VIRTUAL_CLOCK);
  await page.addInitScript(() => { const s = document.createElement('style'); s.textContent = 'html{scroll-behavior:auto!important}'; document.addEventListener('DOMContentLoaded', () => document.head.append(s)); });
  await page.goto(BASE, { waitUntil: 'load' });
  await page.evaluate(() => document.fonts.ready);
  const step = (ms, n = 1) => page.evaluate(([m, k]) => { for (let i = 0; i < k; i++) window.__step(m); }, [ms, n]);
  const run = (seconds) => step(1000 / 30, Math.round(seconds * 30));
  const to = async (id, frac) => { await page.evaluate(([i, f]) => { const el = document.getElementById(i); window.scrollTo(0, el.getBoundingClientRect().top + scrollY - innerHeight * f); }, [id, frac]); };
  await step(33, 10);
  return { ctx, page, step, run, to };
}
const shot = (page, name) => page.screenshot({ path: join(OUT, name) });
const strum = async (p, x0, y0, x1, y1, frames, prefix, k0) => {
  // 鼠标一帧走一小段，每走一段就录一帧
  await p.page.mouse.move(x0, y0);
  for (let i = 1; i <= frames; i++) {
    await p.page.mouse.move(x0 + (x1 - x0) * i / frames, y0 + (y1 - y0) * i / frames);
    await p.step(1000 / 20);
    if (prefix) await shot(p.page, `${prefix}-${String(k0 + i).padStart(3, '0')}.png`);
  }
  return k0 + frames;
};

// ── 动图 1：入场、开场琶音、划弦 ─────────────────────────────────
{
  const p = await open(960, 600, 1);
  await p.page.click('#enter-mute');
  let k = 0;
  for (let i = 0; i < 64; i++) { await p.step(1000 / 20); await shot(p.page, `hero-${String(++k).padStart(3, '0')}.png`); }
  k = await strum(p, 470, 300, 800, 318, 14, 'hero', k);
  for (let i = 0; i < 16; i++) { await p.step(1000 / 20); await shot(p.page, `hero-${String(++k).padStart(3, '0')}.png`); }
  k = await strum(p, 800, 260, 480, 240, 12, 'hero', k);
  for (let i = 0; i < 24; i++) { await p.step(1000 / 20); await shot(p.page, `hero-${String(++k).padStart(3, '0')}.png`); }
  await p.ctx.close();
}

// ── 动图 2：尾声，调到 440 Hz ────────────────────────────────────
{
  const p = await open(960, 600, 1);
  await p.page.click('#enter-mute'); await p.run(4);
  await p.to('toy-tune', 0.42); await p.run(5);
  let k = 0;
  const set = (v) => p.page.evaluate((x) => { const t = document.getElementById('tune'); t.value = String(x); t.dispatchEvent(new Event('input', { bubbles: true })); }, v);
  for (let i = 0; i <= 26; i++) { await set(-38 + 38 * (i / 26)); await p.step(1000 / 20); await shot(p.page, `coda-${String(++k).padStart(3, '0')}.png`); }
  for (let i = 0; i < 96; i++) { await p.step(1000 / 20); await shot(p.page, `coda-${String(++k).padStart(3, '0')}.png`); }
  await p.ctx.close();
}

// ── 静态截图：桌面 ──────────────────────────────────────────────
{
  const p = await open(1440, 900, 2);
  await p.page.click('#enter-mute'); await p.run(1.6);
  await shot(p.page, 'still-hero.png');
  await p.run(4);
  await p.to('works', 0.12); await p.run(3);
  await p.page.evaluate(() => window.scrollBy(0, 560)); await p.run(2.5);
  await shot(p.page, 'still-tower.png');
  await p.to('overtones', 0.12); await p.run(3.5);
  await p.page.click('#modes-all'); await p.run(1.3);
  await shot(p.page, 'still-overtones.png');
  await p.to('ensemble', 0.12); await p.run(3.5);
  await p.page.click('#drop-many'); await p.run(2.6);
  await shot(p.page, 'still-ensemble.png');
  await p.to('toy-tune', 0.42); await p.run(5);
  await p.page.evaluate(() => { const t = document.getElementById('tune'); t.value = '0'; t.dispatchEvent(new Event('input', { bubbles: true })); });
  await p.run(4.6);
  await shot(p.page, 'still-resonance.png');
  await p.ctx.close();
}

// ── 封面（分享卡片）─────────────────────────────────────────────
{
  const p = await open(1200, 630, 1);
  await p.page.click('#enter-mute'); await p.run(1.7);
  await shot(p.page, 'still-cover.png');
  await p.ctx.close();
}

// ── 静态截图：手机 ──────────────────────────────────────────────
{
  const p = await open(390, 844, 3, true);
  await p.page.tap('#enter-mute'); await p.run(1.6);
  await shot(p.page, 'phone-hero.png');
  await p.run(4);
  await p.to('works', 0.3); await p.run(3);
  await p.page.evaluate(() => window.scrollBy(0, 1180)); await p.run(2.5);
  await shot(p.page, 'phone-tower.png');
  await p.to('toy-tune', 0.62); await p.run(5);
  await p.page.evaluate(() => { const t = document.getElementById('tune'); t.value = '0'; t.dispatchEvent(new Event('input', { bubbles: true })); });
  await p.run(4.6);
  await shot(p.page, 'phone-resonance.png');
  await p.ctx.close();
}

await browser.close();
console.log('帧和截图在', OUT);
