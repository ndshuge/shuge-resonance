#!/usr/bin/env node
// 行为冒烟测试：在真实的 Chromium 里把这一页从头弹到尾。
//
//   node tools/serve.mjs . 18990        # 另开一个终端
//   node tools/qa/smoke.mjs             # 默认测 http://127.0.0.1:18990/
//   BASE_URL=https://ndshuge.github.io/shuge-resonance/ node tools/qa/smoke.mjs
//
// 需要 Playwright。没装在项目里时，用 PLAYWRIGHT_MODULE_PATH 指到它的 index.mjs。
// 它验证的是行为和状态，不是“好不好听”“在真机上顺不顺”——那两件事只能用人和设备去验。
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const OUT = process.env.QA_OUT || join(here, 'out');
const BASE = process.env.BASE_URL || 'http://127.0.0.1:18990/';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright');

const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok: !!ok, detail: String(detail) }); console.log(`${ok ? '通过' : '失败'}  ${name}${detail ? '  ' + detail : ''}`); };
const launch = () => chromium.launch({
  channel: process.env.QA_CHANNEL || undefined, headless: true,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'],
});
const watch = (page, bag) => {
  page.on('console', (m) => { if (m.type() === 'error') bag.push(m.text()); });
  page.on('pageerror', (e) => bag.push('pageerror: ' + e.message));
  page.on('requestfailed', (r) => bag.push('requestfailed: ' + r.url()));
  page.on('response', (r) => { if (r.status() >= 400) bag.push(`HTTP ${r.status()}: ${r.url()}`); });
};
const live = (page, group, within = 1.5) => page.evaluate(([g, w]) => {
  const r = window.__resonance; const ids = g ? [].concat(r.groups[g]) : r.strings.map((_, i) => i);
  return ids.filter((i) => r.dyn[i * 4 + 2] !== 0 && r.st.time - r.dyn[i * 4] < w).length;
}, [group, within]);
const toSection = (page, id, frac) => page.evaluate(([i, f]) => {
  const el = document.getElementById(i);
  window.scrollTo({ top: el.getBoundingClientRect().top + scrollY - innerHeight * f, behavior: 'instant' });
}, [id, frac]);

await mkdir(OUT, { recursive: true });
const browser = await launch();

// ── 桌面 ────────────────────────────────────────────────────────
{
  const errors = [];
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage(); watch(page, errors);
  await page.goto(BASE, { waitUntil: 'load' });
  await page.waitForTimeout(800);
  check('桌面：WebGL2 起来了', await page.evaluate(() => !document.documentElement.classList.contains('no-gl') && !!window.__resonance));
  check('桌面：入场前正文不可操作', await page.evaluate(() => document.getElementById('main').inert === true));
  await page.click('#enter-sound');
  await page.waitForTimeout(2600);
  check('桌面：入场后大幕收起', await page.evaluate(() => document.getElementById('gate').classList.contains('gone') && !document.getElementById('main').inert));
  check('桌面：音频上下文在运行', await page.evaluate(() => window.__resonance.snd.on), await page.textContent('#sound-level'));
  check('桌面：开场琶音拨动了竖琴', (await live(page, 'hero', 4)) >= 20, `${await live(page, 'hero', 4)} 根`);
  await page.waitForTimeout(2200);
  await page.mouse.move(700, 450); await page.mouse.move(1250, 470, { steps: 16 });
  await page.waitForTimeout(150);
  check('桌面：鼠标划过会拨弦', (await live(page, 'hero', 2.5)) >= 6 && await page.evaluate(() => window.__resonance.st.strummed), `${await live(page, 'hero', 2.5)} 根`);
  await page.screenshot({ path: join(OUT, 'desktop-hero.png') });

  await toSection(page, 'works', 0.12); await page.waitForTimeout(1600);
  check('桌面：默认列出 15 件精选', (await page.locator('#worklist .work').count()) === 15);
  await page.click('.chip[data-f="all"]'); await page.waitForTimeout(500);
  check('桌面：“全部”列出 53 件', (await page.locator('#worklist .work').count()) === 53);
  const bad = await page.evaluate(() => [...document.querySelectorAll('#worklist a')].filter((a) => !/^https:\/\/(ndshuge\.github\.io|github\.com\/ndshuge)\//.test(a.href)).length);
  check('桌面：作品链接都指向 ndshuge 自己的站点或仓库', bad === 0);
  await page.click('.chip[data-f="featured"]'); await page.waitForTimeout(300);
  await page.evaluate(() => window.scrollBy({ top: 520, behavior: 'instant' })); await page.waitForTimeout(900);
  check('桌面：滚动清单会点亮一行', await page.evaluate(() => window.__resonance.st.activeWork >= 0 && !!document.querySelector('#worklist .work.on')));
  await page.mouse.move(900, 300); await page.mouse.move(985, 420, { steps: 8 }); await page.waitForTimeout(300);
  check('桌面：指到塔上的弦会挂出作品名', await page.evaluate(() => document.getElementById('tip').classList.contains('show')), await page.textContent('#tip-t'));
  await page.screenshot({ path: join(OUT, 'desktop-works.png') });

  await toSection(page, 'overtones', 0.12); await page.waitForTimeout(1500);
  await page.click('#modes-all'); await page.waitForTimeout(900);
  check('桌面：八个泛音全开', await page.evaluate(() => document.querySelectorAll('#modes .mode[aria-pressed="true"]').length === 8), await page.textContent('#modes-note'));
  await page.screenshot({ path: join(OUT, 'desktop-overtones.png') });

  await toSection(page, 'ensemble', 0.12); await page.waitForTimeout(1500);
  await page.click('#drop-many'); await page.waitForTimeout(3200);
  check('桌面：球落在弦板上会拨弦', (await live(page, 'pegs', 4)) >= 2, `${await live(page, 'pegs', 4)} 根`);
  await page.screenshot({ path: join(OUT, 'desktop-ensemble.png') });

  await toSection(page, 'toy-tune', 0.45); await page.waitForTimeout(2200);
  check('桌面：尾声灯暗下来', await page.evaluate(() => document.documentElement.classList.contains('night')));
  await page.focus('#tune');
  for (let i = 0; i < 20; i++) await page.keyboard.press('ArrowRight');
  await page.waitForTimeout(500);
  check('桌面：拧动时有拍音', await page.evaluate(() => !!window.__resonance.snd.tune && !window.__resonance.st.resolved), `${await page.textContent('#beat')} 次/秒`);
  await page.evaluate(() => { const t = document.getElementById('tune'); t.value = '0'; t.dispatchEvent(new Event('input', { bubbles: true })); });
  await page.waitForTimeout(4200);
  check('桌面：调到 440 Hz 后谐振', await page.evaluate(() => window.__resonance.st.resolved && !document.getElementById('resolved').hidden), `${await page.textContent('#hz')} Hz`);
  check('桌面：共鸣弦跟着响', (await live(page, 'choir', 6)) >= 60, `${await live(page, 'choir', 6)} 根`);
  await page.screenshot({ path: join(OUT, 'desktop-resolved.png') });
  check('桌面：全程没有报错和加载失败', errors.length === 0, errors.slice(0, 3).join(' | '));
  await ctx.close();
}

// ── 手机 ────────────────────────────────────────────────────────
{
  const errors = [];
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const page = await ctx.newPage(); watch(page, errors);
  await page.goto(BASE, { waitUntil: 'load' });
  await page.waitForTimeout(800);
  await page.tap('#enter-mute'); await page.waitForTimeout(4200);
  const cdp = await ctx.newCDPSession(page);
  const swipe = async (x0, y0, x1, y1, steps = 12) => {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: x0, y: y0 }] });
    for (let i = 1; i <= steps; i++) { await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x0 + (x1 - x0) * i / steps, y: y0 + (y1 - y0) * i / steps }] }); await page.waitForTimeout(16); }
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  };
  await swipe(60, 250, 340, 262);
  check('手机：横向滑过舞台会拨弦，页面不动', (await live(page, 'hero', 1.2)) >= 6 && (await page.evaluate(() => scrollY)) === 0, `${await live(page, 'hero', 1.2)} 根`);
  await page.screenshot({ path: join(OUT, 'phone-hero.png') });
  await swipe(200, 700, 200, 300, 14); await page.waitForTimeout(600);
  check('手机：纵向滑动照常滚动', (await page.evaluate(() => scrollY)) > 150);
  check('手机：没有横向溢出', await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
  await toSection(page, 'works', 0.3); await page.waitForTimeout(1600);
  await page.evaluate(() => window.scrollBy({ top: 900, behavior: 'instant' })); await page.waitForTimeout(900);
  await page.screenshot({ path: join(OUT, 'phone-works.png') });
  check('手机：清单滚动点亮作品', await page.evaluate(() => !!document.querySelector('#worklist .work.on')));
  check('手机：全程没有报错和加载失败', errors.length === 0, errors.slice(0, 3).join(' | '));
  await ctx.close();
}

// ── 没有 WebGL 时 ───────────────────────────────────────────────
{
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage();
  await page.addInitScript(() => { const g = HTMLCanvasElement.prototype.getContext; HTMLCanvasElement.prototype.getContext = function (t, ...a) { return t === 'webgl2' ? null : g.call(this, t, ...a); }; });
  await page.goto(BASE, { waitUntil: 'load' });
  await page.waitForTimeout(600);
  await page.click('#enter-mute'); await page.waitForTimeout(600);
  check('降级：没有 WebGL2 时文字和清单仍在', await page.evaluate(() => document.documentElement.classList.contains('no-gl') && document.querySelectorAll('#worklist .work').length === 15 && !document.getElementById('main').inert));
  await ctx.close();
}

await browser.close();
const failed = results.filter((r) => !r.ok);
await writeFile(join(OUT, 'smoke.json'), JSON.stringify({ base: BASE, at: new Date().toISOString(), passed: results.length - failed.length, total: results.length, results }, null, 2));
console.log(`\n${results.length - failed.length} / ${results.length} 通过`);
process.exit(failed.length ? 1 : 0);
