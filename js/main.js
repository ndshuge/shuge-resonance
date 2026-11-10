// 谐振 · 主程序：滚动 → 镜头，指针 → 拨弦，以及三件小玩具。
import { Renderer, STATIC_STRIDE, MAX_BALLS } from './gl.js';
import { buildScene, SPACING } from './scene.js';
import { Sound } from './audio.js';
import { WORKS, CATS, CAT_ORDER } from './data.js';
import * as M from './math.js';

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const root = document.documentElement;
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
const { clamp, lerp, smooth } = M;

// ── 场景 ────────────────────────────────────────────────────────
const { strings, groups, centers } = buildScene();
const N = strings.length;
const playableCount = strings.filter((s) => s.kind !== 3).length;
$$('[data-fill="strings"]').forEach((e) => { e.textContent = String(playableCount); });
$$('[data-fill="works"]').forEach((e) => { e.textContent = String(WORKS.length); });

const rgb = (c) => c.map((v) => Math.round(v * 255)).join(' ');
const stat = new Float32Array(N * STATIC_STRIDE);
strings.forEach((s, i) => {
  const o = i * STATIC_STRIDE;
  stat.set(s.a, o); stat.set(s.b, o + 3); stat.set(s.day, o + 6); stat.set(s.night, o + 10);
  stat[o + 14] = s.width; stat[o + 15] = s.kind; stat[o + 16] = s.mode; stat[o + 17] = s.vf;
});
const dyn = new Float32Array(N * 4);
const glow = new Float32Array(N);       // 当前高亮（负数为压暗）
const glowTo = new Float32Array(N);     // 目标
const hov = new Float32Array(N);        // 指针悬停带来的一点亮度
const scr = new Float32Array(N * 4);    // 每根弦两端的屏幕坐标
const scrOK = new Uint8Array(N);

const canvas = $('#stage');
let renderer = null;
try {
  renderer = new Renderer(canvas);
  renderer.setStrings(stat, N);
} catch (err) {
  console.warn('[谐振] 退回到无 3D 版本：', err.message);
  root.classList.add('no-gl');
}

const snd = new Sound();

// ── 状态 ────────────────────────────────────────────────────────
const st = {
  w: 1, h: 1, dpr: 1, mobile: false, vh: 1,
  time: 0, sec: 0, blend: 0, night: 0, nightTo: 0, lift: 0, liftTo: 0,
  entered: false, strummed: false, introT: -1, hoverStr: -1, tipWork: -1, tipUntil: 0,
  filter: 'featured', activeWork: -1, hoverWork: -1, worksAz: 0,
  resolved: false,
};
const ptr = { x: -1, y: -1, t: 0, down: false, dx: 0, dy: 0, dt: 0, moved: 0, nx: 0, ny: 0, type: 'mouse' };
const queue = []; // 定时的拨弦：{ t, i, u, vel, sound }

// ── 镜头 ────────────────────────────────────────────────────────
// 每个章节一个机位：对着哪件雕塑、方位角、仰角、目标高度、需要装进画面的半宽半高
const KF = [
  { sc: 0, az: 0.14, el: 0.05, ty: 2.8, hw: 3.55, hh: 2.95 },
  { sc: 0, az: -0.66, el: 0.13, ty: 2.7, hw: 3.4, hh: 2.95 },
  { sc: 1, az: 0.0, el: 0.11, ty: 2.7, hw: 2.95, hh: 2.9 },
  { sc: 2, az: 0.16, el: 0.06, ty: 3.0, hw: 3.75, hh: 2.95 },
  { sc: 3, az: 0.0, el: 0.03, ty: 2.8, hw: 3.65, hh: 3.05 },
  { sc: 4, az: 0.0, el: 0.035, ty: 3.0, hw: 3.8, hh: 3.25 },
];
const cam = { tx: 0, ty: 2.8, tz: 0, az: 0.14, el: 0.05, D: 16, sx: 0, sy: 0, ready: false };
const view = new Float32Array(16), proj = new Float32Array(16), vp = new Float32Array(16), invVP = new Float32Array(16);
let camPos = [0, 3, 16], projScale = 1000, focus = 16;
const pools = new Float32Array(20), poolI = new Float32Array(5).fill(1);
centers.forEach((c, i) => { pools[i * 4] = c[0]; pools[i * 4 + 1] = 0; pools[i * 4 + 2] = c[2]; pools[i * 4 + 3] = c[3]; });
const LIGHT = M.norm([-0.5, 1.0, -0.62]);
const parts = new Float32Array(8);

const angDiff = (a, b) => { let d = (b - a) % (Math.PI * 2); if (d > Math.PI) d -= Math.PI * 2; if (d < -Math.PI) d += Math.PI * 2; return d; };

function camGoal() {
  const a = KF[st.sec], b = KF[Math.min(KF.length - 1, st.sec + 1)], t = st.blend;
  const ca = centers[a.sc], cb = centers[b.sc];
  const azA = st.sec === 2 ? st.worksAz : a.az;
  const azB = st.sec + 1 === 2 ? st.worksAz : b.az;
  const aspect = st.w / st.h;
  const fov = (aspect < 0.8 ? 44 : aspect < 1.25 ? 38 : 30) * Math.PI / 180;
  const tan = Math.tan(fov / 2);
  const availX = st.mobile ? 0.9 : 0.56, availY = st.mobile ? 0.37 : 0.74;
  const hw = lerp(a.hw, b.hw, t), hh = lerp(a.hh, b.hh, t);
  let D = Math.max(hw / (tan * aspect * availX), hh / (tan * availY));
  const arc = Math.sin(Math.PI * t);
  const moving = a.sc !== b.sc ? arc : 0;
  D *= 1 + 0.16 * moving;
  let sx = 0, sy = st.mobile ? 0.42 : 0.0;
  if (!st.mobile) { const pos = [0.22, 0.34, 0.36, 0.40, 0.36, 0.26]; sx = lerp(pos[st.sec], pos[Math.min(5, st.sec + 1)], t); }
  const g = {
    tx: lerp(ca[0], cb[0], t), ty: lerp(a.ty, b.ty, t), tz: lerp(ca[2], cb[2], t),
    az: azA + angDiff(azA, azB) * t, el: lerp(a.el, b.el, t) + 0.05 * moving, D, sx, sy, fov,
  };
  if (st.resolved && st.sec === 5) { g.D *= 1.32; g.el += 0.13; g.ty += 0.25; }
  // 入场：镜头从稍远、稍偏的地方推近
  if (st.introT >= 0) { const q = 1 - smooth(0, 3.2, st.time - st.introT); g.D *= 1 + 0.26 * q; g.az += 0.42 * q; g.el += 0.07 * q; }
  else { g.D *= 1.26; g.az += 0.42; g.el += 0.07; }
  // 缓慢的呼吸和指针视差
  if (!reduced) g.az += 0.05 * Math.sin(st.time * 0.17) + ptr.nx * 0.11;
  g.el += -ptr.ny * 0.035;
  return g;
}

function updateCamera(dt) {
  const g = camGoal();
  const k = cam.ready ? 1 - Math.exp(-dt * 4.2) : 1;
  cam.tx += (g.tx - cam.tx) * k; cam.ty += (g.ty - cam.ty) * k; cam.tz += (g.tz - cam.tz) * k;
  cam.az += angDiff(cam.az, g.az) * k; cam.el += (g.el - cam.el) * k;
  cam.D += (g.D - cam.D) * k; cam.sx += (g.sx - cam.sx) * k; cam.sy += (g.sy - cam.sy) * k;
  cam.ready = true;
  const ce = Math.cos(cam.el);
  camPos = [cam.tx + cam.D * Math.sin(cam.az) * ce, cam.ty + cam.D * Math.sin(cam.el), cam.tz + cam.D * Math.cos(cam.az) * ce];
  M.lookAt(view, camPos, [cam.tx, cam.ty, cam.tz]);
  M.perspective(proj, g.fov, st.w / st.h, 0.3, 240, cam.sx, cam.sy);
  M.mul(vp, proj, view);
  M.invert(invVP, vp);
  projScale = 0.5 * st.h * st.dpr / Math.tan(g.fov / 2);
  focus = cam.D;
}

function projectStrings() {
  for (let i = 0; i < N; i++) {
    const s = strings[i];
    if (!s.play) { scrOK[i] = 0; continue; }
    const a = M.project(vp, s.a, st.w, st.h), b = M.project(vp, s.b, st.w, st.h);
    const ok = a[2] > 0.5 && b[2] > 0.5 && a[2] < 46;
    scrOK[i] = ok ? 1 : 0;
    if (ok) { const o = i * 4; scr[o] = a[0]; scr[o + 1] = a[1]; scr[o + 2] = b[0]; scr[o + 3] = b[1]; }
  }
}

// ── 拨弦 ────────────────────────────────────────────────────────
function panOf(i) { const o = i * 4; return clamp(((scr[o] + scr[o + 2]) * 0.5 / st.w) * 2 - 1, -1, 1) * 0.75; }

function pluck(i, u = 0.3, vel = 0.6, sound = true, dir = 1) {
  const s = strings[i];
  if (!s || s.kind !== 0) return;
  const o = i * 4, t = st.time;
  const resid = Math.abs(dyn[o + 2]) * Math.exp(-Math.max(0, t - dyn[o]) * 1.0);
  const amp = Math.min(0.36, (0.05 + 0.115 * vel) * Math.pow(Math.min(1.5, s.len / 3.2), 0.7) + resid * 0.4);
  dyn[o] = t; dyn[o + 1] = clamp(u, 0.07, 0.93); dyn[o + 2] = amp * (dir < 0 ? -1 : 1);
  if (sound) snd.pluck(s.midi, vel, panOf(i));
}

// 指针从 (x0,y0) 划到 (x1,y1)，途中跨过的弦都拨一下
function strum(x0, y0, x1, y1, ms) {
  const dx = x1 - x0, dy = y1 - y0, dist = Math.hypot(dx, dy);
  if (dist < 0.5 || dist > 260) return;
  const vel = clamp(0.22 + (dist / Math.max(4, ms)) * 0.42, 0.22, 1);
  const limitY = st.mobile ? st.h * 0.56 : 1e9;
  const hits = [];
  for (let i = 0; i < N; i++) {
    if (!scrOK[i]) continue;
    const o = i * 4, ax = scr[o], ay = scr[o + 1], bx = scr[o + 2], by = scr[o + 3];
    const ex = bx - ax, ey = by - ay;
    const den = dx * ey - dy * ex;
    if (Math.abs(den) < 1e-6) continue;
    const s = ((ax - x0) * ey - (ay - y0) * ex) / den;   // 指针路径上的位置
    const u = ((ax - x0) * dy - (ay - y0) * dx) / den;   // 弦上的位置
    if (s < 0 || s > 1 || u < 0 || u > 1) continue;
    if (y0 + dy * s > limitY) continue;
    hits.push([s, i, u, den > 0 ? 1 : -1]);
  }
  if (!hits.length) return;
  hits.sort((p, q) => p[0] - q[0]);
  const n = Math.min(hits.length, 16);
  for (let k = 0; k < n; k++) pluck(hits[k][1], hits[k][2], vel, true, hits[k][3]);
  if (!st.strummed) { st.strummed = true; $('#hint').classList.add('done'); }
}

function nearestString(x, y, maxPx, worksOnly = false) {
  let best = -1, bd = maxPx, bu = 0.5;
  for (let i = 0; i < N; i++) {
    if (!scrOK[i] || (worksOnly && strings[i].work < 0)) continue;
    const o = i * 4, ax = scr[o], ay = scr[o + 1], ex = scr[o + 2] - ax, ey = scr[o + 3] - ay;
    const L2 = ex * ex + ey * ey; if (L2 < 1) continue;
    const u = clamp(((x - ax) * ex + (y - ay) * ey) / L2, 0, 1);
    const d = Math.hypot(ax + ex * u - x, ay + ey * u - y);
    if (d < bd) { bd = d; best = i; bu = u; }
  }
  return best < 0 ? null : { i: best, u: bu };
}

// ── 指针 ────────────────────────────────────────────────────────
addEventListener('pointermove', (e) => {
  if (e.pointerType === 'touch' && !ptr.down) return;
  const x = e.clientX, y = e.clientY;
  if (ptr.x >= 0 && st.entered) strum(ptr.x, ptr.y, x, y, e.timeStamp - ptr.t);
  if (ptr.x >= 0) ptr.moved += Math.hypot(x - ptr.x, y - ptr.y);
  ptr.x = x; ptr.y = y; ptr.t = e.timeStamp; ptr.type = e.pointerType;
  if (e.pointerType !== 'touch') {
    ptr.nx = (x / st.w) * 2 - 1; ptr.ny = (y / st.h) * 2 - 1;
    const overUI = e.target.closest && e.target.closest('a, button, input, .gate');
    // 在塔前面，优先认作品的弦（衬在后面的细线不算）
    let near = st.entered && !overUI ? nearestString(x, y, 15, st.sec === 2) : null;
    if (!near && st.entered && !overUI && st.sec === 2) near = nearestString(x, y, 15);
    st.hoverStr = near ? near.i : -1;
    const w = near ? strings[near.i].work : -1;
    if (w >= 0 && st.sec === 2) showTip(w, x, y, false); else if (st.time > st.tipUntil) hideTip();
  }
}, { passive: true });
addEventListener('pointerdown', (e) => {
  ptr.down = true; ptr.x = e.clientX; ptr.y = e.clientY; ptr.t = e.timeStamp; ptr.moved = 0;
  ptr.downT = e.timeStamp; ptr.type = e.pointerType;
}, { passive: true });
addEventListener('pointerup', (e) => {
  const tap = ptr.down && ptr.moved < 9 && e.timeStamp - ptr.downT < 380;
  ptr.down = false;
  if (tap && st.entered && !e.target.closest('a, button, input, label, .gate')) onTap(e.clientX, e.clientY);
  if (e.pointerType === 'touch') ptr.x = -1;
}, { passive: true });
addEventListener('pointercancel', () => { ptr.down = false; ptr.x = -1; }, { passive: true });
document.addEventListener('pointerleave', () => { ptr.x = -1; });

// 塔上的弦各是一件作品：指到哪根，就把它的名字挂在旁边
const tip = $('#tip'), tipT = $('#tip-t');
function showTip(w, x, y, sticky) {
  st.tipWork = w;
  tipT.textContent = WORKS[w].t;
  tip.href = WORKS[w].u;
  tip.style.setProperty('--hue-d', rgb(CATS[WORKS[w].c].day));
  tip.style.setProperty('--hue-n', rgb(CATS[WORKS[w].c].night));
  const tw = Math.min(280, tip.offsetWidth || 200);
  tip.style.transform = `translate(${Math.round(clamp(x + 16, 8, st.w - tw - 8))}px, ${Math.round(clamp(y + (sticky ? -58 : 20), 56, st.h - 50))}px)`;
  tip.classList.add('show');
  tip.classList.toggle('sticky', sticky);
  if (sticky) st.tipUntil = st.time + 4;
}
function hideTip() { if (st.tipWork < 0) return; st.tipWork = -1; tip.classList.remove('show', 'sticky'); }
document.addEventListener('click', (e) => {
  if (st.tipWork < 0 || tip.classList.contains('sticky') || ptr.type !== 'mouse') return;
  if (e.target.closest('a, button, input, label, .gate')) return;
  window.open(WORKS[st.tipWork].u, '_blank', 'noopener');
});

function onTap(x, y) {
  if (st.mobile && y > st.h * 0.56) return;
  if (st.sec === 4 && st.blend < 0.5) {
    const hit = planePoint(x, y, 0);
    if (hit && Math.abs(hit[0] - centers[3][0]) < 3.6 && hit[1] > 0.4) { dropBall(hit[0] - centers[3][0], Math.max(hit[1], 3.2)); return; }
  }
  const reach = st.mobile ? 34 : 26;
  const near = (st.sec === 2 && nearestString(x, y, reach, true)) || nearestString(x, y, reach);
  if (!near) { if (ptr.type === 'touch') hideTip(); return; }
  pluck(near.i, near.u, 0.78);
  if (!st.strummed) { st.strummed = true; $('#hint').classList.add('done'); }
  const w = strings[near.i].work;
  if (ptr.type === 'touch') { if (w >= 0 && st.sec === 2) showTip(w, x, y, true); else hideTip(); }
}

// 屏幕点 → 世界里 z = planeZ 平面上的点
function planePoint(x, y, planeZ) {
  const r = M.unprojectDir(invVP, x, y, st.w, st.h);
  if (Math.abs(r.dir[2]) < 1e-5) return null;
  const t = (planeZ - r.origin[2]) / r.dir[2];
  if (t < 0) return null;
  return [r.origin[0] + r.dir[0] * t, r.origin[1] + r.dir[1] * t, planeZ];
}

// ── 滚动 → 章节 ─────────────────────────────────────────────────
const secs = $$('.sec');
let tops = [];
let itemY = [];   // 作品清单每一行中线的文档坐标
let itemIdx = []; // 对应的作品序号
function measure() {
  st.vh = innerHeight;
  const sy = scrollY;
  tops = secs.map((s) => s.getBoundingClientRect().top + sy);
  tops.push(root.scrollHeight);
  itemY = []; itemIdx = [];
  for (const li of $$('#worklist .work')) {
    const r = li.getBoundingClientRect();
    itemY.push(r.top + sy + r.height / 2); itemIdx.push(+li.dataset.i);
  }
}
const navLinks = $$('.bar-nav a');
let lastSec = -1;
function updateScroll() {
  const y = scrollY, anchor = y + st.vh * (st.mobile ? 0.62 : 0.5);
  let i = 0;
  while (i < secs.length - 1 && anchor >= tops[i + 1]) i++;
  st.sec = i;
  if (i < secs.length - 1) {
    // 等这一章的内容基本滚出去了，镜头才动身去下一件雕塑
    const T = Math.min(st.vh * (st.mobile ? 0.5 : 0.45), (tops[i + 1] - tops[i]) * 0.5);
    st.blend = smooth(0, 1, (anchor - (tops[i + 1] - T)) / T);
  } else st.blend = 0;
  st.nightTo = i >= 5 ? 1 : i === 4 ? smooth(0.25, 1, st.blend) : 0;
  if (i !== lastSec) {
    lastSec = i;
    navLinks.forEach((a, k) => a.classList.toggle('on', k === i - 1));
    root.classList.toggle('past-cover', i > 0);
    if (i === 4) onEnterEnsemble();
    if (i !== 5) tuneIdle(true);
  }
  // 作品清单：离“拨片”最近的那一行
  if (st.hoverWork < 0 && itemY.length) {
    const py = y + st.vh * (st.mobile ? 0.76 : 0.52);
    let best = -1, bd = 90;
    if (py > itemY[0] - 90 && py < itemY[itemY.length - 1] + 90) {
      let lo = 0, hi = itemY.length - 1;
      while (lo < hi) { const mid = (lo + hi) >> 1; if (itemY[mid] < py) lo = mid + 1; else hi = mid; }
      for (const k of [lo - 1, lo]) { if (k >= 0 && Math.abs(itemY[k] - py) < bd) { bd = Math.abs(itemY[k] - py); best = itemIdx[k]; } }
    }
    setActiveWork(best, true);
  }
}

// ── 白天 / 夜晚 的界面颜色 ──────────────────────────────────────
const DAY = { ink: [20, 24, 27], paper: [231, 234, 230], accent: [198, 60, 39] };
const NIGHT = { ink: [240, 232, 217], paper: [7, 9, 14], accent: [255, 140, 108] };
let cssNight = -1;
const themeMeta = $('meta[name="theme-color"]');
function applyTheme() {
  if (Math.abs(st.night - cssNight) < 0.004) return;
  cssNight = st.night;
  const mix = (a, b) => a.map((v, i) => Math.round(lerp(v, b[i], st.night)));
  const ink = mix(DAY.ink, NIGHT.ink), paper = mix(DAY.paper, NIGHT.paper), accent = mix(DAY.accent, NIGHT.accent);
  root.style.setProperty('--ink-rgb', ink.join(' '));
  root.style.setProperty('--paper-rgb', paper.join(' '));
  root.style.setProperty('--accent-rgb', accent.join(' '));
  root.classList.toggle('night', st.night > 0.5);
  if (themeMeta) themeMeta.content = `rgb(${paper.join(',')})`;
}

// ── 第一乐章：作品清单 ──────────────────────────────────────────
const chipsEl = $('#chips'), listEl = $('#worklist');
const FILTERS = [
  { id: 'featured', name: '精选', n: WORKS.filter((w) => w.f).length },
  ...CAT_ORDER.map((c) => ({ id: c, name: CATS[c].name, n: WORKS.filter((w) => w.c === c).length })),
  { id: 'all', name: '全部', n: WORKS.length },
];
const inFilter = (w) => st.filter === 'all' || (st.filter === 'featured' ? !!w.f : w.c === st.filter);

function buildChips() {
  for (const f of FILTERS) {
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'chip'; b.dataset.f = f.id;
    b.setAttribute('aria-pressed', String(f.id === st.filter));
    if (CATS[f.id]) { b.style.setProperty('--hue-d', rgb(CATS[f.id].day)); b.style.setProperty('--hue-n', rgb(CATS[f.id].night)); }
    b.append(f.name + ' ');
    const n = document.createElement('b'); n.textContent = String(f.n); b.append(n);
    b.addEventListener('click', () => {
      st.filter = f.id;
      $$('.chip', chipsEl).forEach((c) => c.setAttribute('aria-pressed', String(c === b)));
      buildList(); measure(); st.activeWork = -1;
      // 换一组作品时，把这一组的弦顺着扫一遍
      let k = 0;
      WORKS.forEach((w, i) => { if (inFilter(w)) queue.push({ t: st.time + 0.05 + (k++) * (st.filter === 'all' ? 0.022 : 0.05), i: groups.works[i], u: 0.35, vel: 0.5, sound: k % (st.filter === 'all' ? 3 : 1) === 0 }); });
    });
    chipsEl.append(b);
  }
}

function buildList() {
  listEl.textContent = '';
  WORKS.forEach((w, i) => {
    if (!inFilter(w)) return;
    const li = document.createElement('li');
    li.className = 'work'; li.dataset.i = String(i);
    li.style.setProperty('--hue-d', rgb(CATS[w.c].day)); li.style.setProperty('--hue-n', rgb(CATS[w.c].night));
    const a = document.createElement('a');
    a.href = w.u; a.target = '_blank'; a.rel = 'noopener';
    const t = document.createElement('span'); t.className = 'w-title'; t.textContent = w.t;
    const o = document.createElement('span'); o.className = 'w-open'; o.textContent = w.u.includes('github.com') ? '看仓库' : '打开';
    const d = document.createElement('span'); d.className = 'w-desc'; d.textContent = w.d;
    a.append(t, o, d); li.append(a);
    li.addEventListener('pointerenter', (e) => { if (e.pointerType === 'mouse') { st.hoverWork = i; setActiveWork(i, false); } });
    li.addEventListener('pointerleave', (e) => { if (e.pointerType === 'mouse') st.hoverWork = -1; });
    a.addEventListener('focus', () => setActiveWork(i, false));
    listEl.append(li);
  });
  // 不在这一组里的弦压暗
  WORKS.forEach((w, i) => { glowTo[groups.works[i]] = inFilter(w) ? 0 : (st.filter === 'featured' ? -0.5 : -0.9); });
}

function setActiveWork(i, fromScroll) {
  if (i === st.activeWork) return;
  const prev = st.activeWork;
  st.activeWork = i;
  if (prev >= 0) { const s = groups.works[prev]; glowTo[s] = inFilter(WORKS[prev]) ? 0 : glowTo[s]; }
  for (const li of listEl.children) li.classList.toggle('on', +li.dataset.i === i);
  if (i < 0) return;
  const si = groups.works[i], s = strings[si];
  glowTo[si] = 1;
  // 让镜头转到这根弦的正面：像八音盒的滚筒
  const c = centers[1];
  const mx = (s.a[0] + s.b[0]) / 2 - c[0], mz = (s.a[2] + s.b[2]) / 2 - c[2];
  const target = Math.atan2(mx, mz);
  st.worksAz += angDiff(st.worksAz, target);
  if (st.entered && (st.sec === 2 || st.sec === 1)) pluck(si, 0.32, fromScroll ? 0.5 : 0.62);
}

// ── 第二乐章：泛音 ──────────────────────────────────────────────
const F0 = 146.83; // D3
const modeOn = [true, false, false, false, false, false, false, false];
const modesEl = $('#modes'), modesNote = $('#modes-note');
function buildModes() {
  for (let n = 1; n <= 8; n++) {
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'mode' + (n === 1 ? ' cn' : ''); b.dataset.n = String(n);
    b.textContent = n === 1 ? '基音' : String(n);
    b.setAttribute('aria-label', n === 1 ? '基音' : `第 ${n} 泛音，${n} 倍频`);
    b.setAttribute('aria-pressed', String(modeOn[n - 1]));
    b.addEventListener('click', () => { modeOn[n - 1] = !modeOn[n - 1]; if (modeOn[n - 1]) snd.partial(F0, n); syncModes(); });
    modesEl.append(b);
  }
  $('#modes-all').addEventListener('click', () => {
    for (let n = 1; n <= 8; n++) { modeOn[n - 1] = true; snd.partial(F0, n, (n - 1) * 0.085, 0.7); }
    snd.pluck(50, 0.85, 0, 0.8);
    syncModes();
  });
  $('#modes-one').addEventListener('click', () => { modeOn.fill(false); modeOn[0] = true; snd.partial(F0, 1); syncModes(); });
  syncModes();
}
function syncModes() {
  $$('.mode', modesEl).forEach((b, k) => b.setAttribute('aria-pressed', String(modeOn[k])));
  const n = modeOn.filter(Boolean).length;
  modesNote.textContent = n === 0 ? '全关了。一根不动的弦。'
    : n === 8 ? '八个全开：叠出来的那道折线，就是手指拨开琴弦的那一下。'
    : n === 1 && modeOn[0] ? '现在只有基音：一条最简单的正弦。'
    : `亮着 ${n} 个。越往上的泛音振得越快。`;
}
function updateModes(dt) {
  const k = 1 - Math.exp(-dt * 5);
  for (let n = 1; n <= 8; n++) {
    parts[n - 1] += ((modeOn[n - 1] ? 1 : 0) - parts[n - 1]) * k;
    const si = groups.modes[n], o = si * 4;
    dyn[o + 2] = lerp(0.016, 0.24 / Math.pow(n, 0.55), parts[n - 1]);
    glowTo[si] = modeOn[n - 1] ? 0.55 : -0.45;
  }
  dyn[groups.modes[0] * 4 + 2] = 0.42;
}

// ── 第三乐章：乒乓球 ────────────────────────────────────────────
const balls = [];
const ballData = new Float32Array(MAX_BALLS * 5);
const BALL_R = 0.105, GRAV = -8.2;
let lastAutoDrop = -99;
function dropBall(x = (Math.random() - 0.5) * 4.6, y = 5.9) {
  if (balls.length >= MAX_BALLS) balls.shift();
  balls.push({ x: clamp(x, -2.9, 2.9), y: Math.min(6.1, y + 0.4), vx: (Math.random() - 0.5) * 0.5, vy: 0, life: 1, rest: 0, cool: new Map() });
}
function onEnterEnsemble() {
  if (reduced || st.time - lastAutoDrop < 9) return;
  lastAutoDrop = st.time;
  queueFn(0.9, () => { if (st.sec === 4) dropBall(-1.9, 5.8); });
}
const fnQueue = [];
function queueFn(delay, fn) { fnQueue.push({ t: st.time + delay, fn }); }

function updateBalls(dt) {
  if (!balls.length) return;
  const cx = centers[3][0];
  const sub = 4, h = dt / sub;
  for (const b of balls) {
    for (let s = 0; s < sub; s++) {
      b.vy += GRAV * h; b.x += b.vx * h; b.y += b.vy * h;
      for (const si of groups.pegs) {
        const g = strings[si];
        const ax = g.a[0] - cx, ay = g.a[1], ex = g.b[0] - g.a[0], ey = g.b[1] - g.a[1];
        const L2 = ex * ex + ey * ey;
        const u = clamp(((b.x - ax) * ex + (b.y - ay) * ey) / L2, 0, 1);
        const px = ax + ex * u, py = ay + ey * u;
        let nx = b.x - px, ny = b.y - py; const d = Math.hypot(nx, ny);
        if (d >= BALL_R || d < 1e-6) continue;
        nx /= d; ny /= d;
        const vn = b.vx * nx + b.vy * ny;
        b.x = px + nx * BALL_R; b.y = py + ny * BALL_R;
        if (vn >= 0) continue;
        b.vx -= 1.58 * vn * nx; b.vy -= 1.58 * vn * ny;
        b.vx += nx * 0.3; b.vy += ny * 0.3;     // 弦把球弹回去的那一下
        const last = b.cool.get(si) || -9;
        if (st.time - last > 0.09) {
          b.cool.set(si, st.time);
          const vel = clamp(-vn / 6.5, 0.25, 1);
          pluck(si, u, vel, true, ny > 0 ? -1 : 1);
          snd.tock(vel * 0.45, clamp(b.x / 4, -0.7, 0.7));
        }
      }
      if (b.x < -3.3 + BALL_R) { b.x = -3.3 + BALL_R; b.vx = Math.abs(b.vx) * 0.8; }
      if (b.x > 3.3 - BALL_R) { b.x = 3.3 - BALL_R; b.vx = -Math.abs(b.vx) * 0.8; }
      if (b.y < BALL_R) {
        b.y = BALL_R;
        if (b.vy < -0.5) { snd.tock(clamp(-b.vy / 7, 0.12, 0.9), clamp(b.x / 4, -0.7, 0.7)); b.vy = -b.vy * 0.8; b.vx *= 0.97; }
        else { b.vy = 0; b.vx *= 0.9; b.rest += h; }
      }
    }
    if (b.rest > 0.25) b.life -= dt * 1.1;
  }
  for (let i = balls.length - 1; i >= 0; i--) if (balls[i].life <= 0) balls.splice(i, 1);
  balls.forEach((b, i) => { const o = i * 5; ballData[o] = cx + b.x; ballData[o + 1] = b.y; ballData[o + 2] = 0; ballData[o + 3] = BALL_R; ballData[o + 4] = clamp(b.life, 0, 1); });
}

// ── 尾声：调音 ──────────────────────────────────────────────────
const tuneEl = $('#tune'), hzEl = $('#hz'), beatEl = $('#beat');
const A4 = 440;
let tuneHz = A4 * Math.pow(2, -38 / 1200), tuneLockT = 0, tuneLast = -99, tuneTouched = false, tuneDragging = false;
function readTune() {
  const c = parseFloat(tuneEl.value);
  tuneHz = A4 * Math.pow(2, c / 1200);
  hzEl.textContent = tuneHz.toFixed(1);
  beatEl.textContent = Math.abs(tuneHz - A4).toFixed(1);
}
function tuneIdle(force) {
  if (snd.tune && (force || st.time - tuneLast > 7)) snd.tuneStop(force ? 0.4 : 1.2);
}
async function onTuneInput() {
  if (st.resolved) return;
  tuneTouched = true; tuneLast = st.time;
  readTune();
  if (snd.on) { if (!snd.tune) snd.tuneStart(A4, tuneHz); else snd.tuneSet(tuneHz); }
}
tuneEl.addEventListener('input', onTuneInput);
tuneEl.addEventListener('pointerdown', () => { tuneDragging = true; onTuneInput(); });
addEventListener('pointerup', () => {
  if (!tuneDragging) return;
  tuneDragging = false;
  // 差得很近时松手，就轻轻吸到位
  if (!st.resolved && Math.abs(parseFloat(tuneEl.value)) <= 2.5) { tuneEl.value = '0'; onTuneInput(); }
});
function updateTune(dt) {
  const beat = Math.abs(tuneHz - A4);
  const mo = groups.main * 4, ro = groups.ref * 4;
  if (st.resolved) {
    dyn[mo + 2] = lerp(dyn[mo + 2], 0.2, 1 - Math.exp(-dt * 3));
    dyn[ro + 2] = lerp(dyn[ro + 2], 0.07, 1 - Math.exp(-dt * 3));
    return;
  }
  // 拍音：两个频率相差多少，振幅每秒就鼓起多少次
  const env = tuneTouched ? 0.3 + 0.7 * Math.abs(Math.cos(Math.PI * beat * st.time)) : 0.5;
  const live = tuneTouched && st.time - tuneLast < 7 ? 1 : 0.4;
  dyn[mo + 2] = lerp(dyn[mo + 2], 0.13 * env * live, 1 - Math.exp(-dt * 30));
  dyn[ro + 2] = 0.05 * live;
  if (tuneTouched && beat < 0.3) {
    tuneLockT += dt;
    if (tuneLockT > 0.65) resolve();
  } else tuneLockT = 0;
  tuneIdle(false);
}
function resolve() {
  if (st.resolved) return;
  st.resolved = true; st.liftTo = 1;
  tuneEl.disabled = true;
  $('#tune-say').textContent = '440.0 Hz。拍音消失了。';
  $('#resolved').hidden = false;
  snd.tuneStop(2.4);
  // 共鸣：一圈弦从正面开始，一根接一根跟着响
  [50, 57, 62, 66, 69, 74].forEach((m, k) => snd.pluck(m, 0.8, (k % 2 ? 0.3 : -0.3), 0.05 + k * 0.11));
  groups.choir.forEach((si, k) => {
    const d = Math.abs(angDiff(strings[si].phi, Math.PI / 2)) / Math.PI;   // 离镜头正面的角距离
    queue.push({ t: st.time + 0.25 + d * 2.2, i: si, u: 0.3 + 0.3 * Math.random(), vel: 0.55, sound: k % 4 === 0 });
    glowTo[si] = 0.9;
  });
  queueFn(4.5, () => { st.liftTo = 0.42; });
  queueFn(0.4, measure);
}
$('#retune').addEventListener('click', () => {
  st.resolved = false; st.liftTo = 0; tuneLockT = 0; tuneTouched = false;
  tuneEl.disabled = false; tuneEl.value = String(-20 - Math.round(Math.random() * 30));
  readTune();
  $('#tune-say').textContent = '拖动滑块，把中间这根弦调到 440 Hz。听拍音：它越慢，你越近。';
  $('#resolved').hidden = true;
  groups.choir.forEach((si) => { glowTo[si] = 0; });
  measure();
  tuneEl.focus();
});

// ── 入场与声音 ──────────────────────────────────────────────────
const gate = $('#gate'), soundBtn = $('#sound'), soundLv = $('#sound-level');
const LEVELS = [['关', true], ['p', false], ['mf', false], ['f', false]];
const LEVEL_NAME = ['关', '弱', '中', '强'];
function showLevel() {
  const l = snd.on ? snd.level : 0;
  soundLv.textContent = LEVELS[l][0];
  soundLv.classList.toggle('cn', LEVELS[l][1]);
  soundBtn.setAttribute('aria-label', `声音：${LEVEL_NAME[l]}。点按切换音量`);
}
soundBtn.addEventListener('click', async () => {
  if (!snd.on) {
    if (snd.level === 0) snd.setLevel(2);
    const ok = await snd.start();
    if (ok) { snd.warm(strings.filter((s) => s.kind === 0).map((s) => s.midi)); snd.pluck(62, 0.6); }
  } else {
    snd.setLevel((snd.level + 1) % 4);
    if (snd.level > 0) queueFn(0.06, () => snd.pluck(62, 0.6));
  }
  showLevel();
});

async function enter(withSound) {
  if (st.entered) return;
  if (withSound) {
    const ok = await snd.start();
    if (ok) snd.warm(strings.filter((s) => s.kind === 0).map((s) => s.midi));
  }
  showLevel();
  st.entered = true; st.introT = st.time;
  gate.classList.add('gone');
  document.body.classList.remove('locked');
  for (const el of [$('#main'), $('.bar')]) el.inert = false;
  // 开场：从最长的弦到最短的弦，扫一遍
  groups.hero.forEach((si, k) => {
    queue.push({ t: st.time + 0.55 + k * 0.026 + (k / 56) * (k / 56) * 0.5, i: si, u: 0.3, vel: 0.42 + 0.3 * (k / 56), sound: true });
  });
}
$('#enter-sound').addEventListener('click', () => enter(true));
$('#enter-mute').addEventListener('click', () => enter(false));
$('#drop').addEventListener('click', () => dropBall());
$('#drop-many').addEventListener('click', () => { for (let k = 0; k < 5; k++) queueFn(k * 0.28, () => dropBall()); });

// ── 尺寸 ────────────────────────────────────────────────────────
let slowFrames = 0, dprCap = 2;
function resize() {
  const w = innerWidth, h = canvas.clientHeight || innerHeight;
  st.mobile = w < 900;
  let dpr = Math.min(devicePixelRatio || 1, dprCap);
  dpr = Math.min(dpr, Math.sqrt((st.mobile ? 2.6e6 : 4.4e6) / (w * h)));
  st.w = w; st.h = h; st.dpr = dpr;
  if (renderer) renderer.resize(Math.round(w * dpr), Math.round(h * dpr));
  measure();
}
addEventListener('resize', resize);
if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => measure());
addEventListener('load', () => measure());

// ── 主循环 ──────────────────────────────────────────────────────
const t0 = performance.now();
let lastT = 0, raf = 0;
function frame(now) {
  raf = requestAnimationFrame(frame);
  const t = (now - t0) / 1000;
  const dt = clamp(t - lastT, 0.001, 0.05);
  if (st.entered && lastT > 2 && t - lastT > 0.034) { if (++slowFrames > 50 && dprCap > 1) { dprCap = Math.max(1, dprCap * 0.75); slowFrames = 0; resize(); } }
  else slowFrames = Math.max(0, slowFrames - 0.25);
  lastT = t; st.time = t;

  updateScroll();
  st.night += (st.nightTo - st.night) * (1 - Math.exp(-dt * 3.2));
  st.lift += (st.liftTo - st.lift) * (1 - Math.exp(-dt * 1.4));
  applyTheme();

  while (queue.length && queue[0].t <= t) { const q = queue.shift(); pluck(q.i, q.u, q.vel, q.sound); }
  for (let i = fnQueue.length - 1; i >= 0; i--) if (fnQueue[i].t <= t) { const f = fnQueue.splice(i, 1)[0]; f.fn(); }

  if (!renderer) return;
  updateCamera(dt);
  projectStrings();
  updateModes(dt);
  updateBalls(dt);
  updateTune(dt);
  const gk = 1 - Math.exp(-dt * 7);
  if (st.tipWork >= 0 && tip.classList.contains('sticky') && t > st.tipUntil) hideTip();
  for (let i = 0; i < N; i++) {
    glow[i] += (glowTo[i] - glow[i]) * gk;
    hov[i] += ((i === st.hoverStr ? 0.55 : 0) - hov[i]) * gk;
    dyn[i * 4 + 3] = glow[i] < 0 ? glow[i] * (1 - hov[i]) + hov[i] : glow[i] + hov[i];
  }

  renderer.render({
    vp, invVP, cam: camPos, time: t, night: st.night, lift: st.lift,
    focus, proj: projScale, px: st.dpr, dof: st.mobile ? 0.085 : 0.11,
    widthScale: st.mobile ? 1.55 : 1.0, fog: st.mobile ? [34, 70] : [24, 56],
    pools, poolI, parts, dyn, light: LIGHT,
    balls: ballData, ballCount: balls.length,
    camRight: [view[0], view[4], view[8]], camUp: [view[1], view[5], view[9]],
  });
}
document.addEventListener('visibilitychange', () => {
  if (document.hidden) { cancelAnimationFrame(raf); raf = 0; }
  else if (!raf) { lastT = (performance.now() - t0) / 1000; raf = requestAnimationFrame(frame); }
});

// 定时队列按时间排好
const _push = queue.push.bind(queue);
queue.push = (...items) => { const r = _push(...items); queue.sort((a, b) => a.t - b.t); return r; };

// ── 启动 ────────────────────────────────────────────────────────
buildChips();
buildList();
buildModes();
readTune();
showLevel();
document.body.classList.add('locked');
for (const el of [$('#main'), $('.bar')]) el.inert = true;
resize();
raf = requestAnimationFrame(frame);
$('#enter-sound').focus({ preventScroll: true });

// 调试和自动化测试用
window.__resonance = { st, strings, groups, pluck, dropBall, snd, cam, resolve, dyn, scr, scrOK, ptr, queue };
