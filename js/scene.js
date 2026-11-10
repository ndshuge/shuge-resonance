// 五件弦雕塑的几何。所有弦都是空间里的直线段，曲面是直线织出来的（直纹面）。
import { WORKS, CATS } from './data.js';
import { len, sub } from './math.js';

export const SPACING = 16;
const INK = [0.085, 0.10, 0.115];
const WARM = [1.0, 0.86, 0.64];
const FRAME_DAY = [0.07, 0.085, 0.10];
const FRAME_NIGHT = [0.82, 0.60, 0.30];

// D 大调
const MAJOR = [2, 4, 6, 7, 9, 11, 13];
const PENTA = [2, 4, 6, 9, 11];
export const major = (deg, base = 36) => base + 12 * Math.floor(deg / 7) + MAJOR[((deg % 7) + 7) % 7];
export const penta = (deg, base = 36) => base + 12 * Math.floor(deg / 5) + PENTA[((deg % 5) + 5) % 5];

// kind: 0 可拨的弦  1 单一驻波  2 泛音叠加  3 骨架（不振动）
export function buildScene() {
  const S = [];
  const add = (o) => {
    const s = Object.assign({
      kind: 0, mode: 1, width: 0.012, day: [...INK, 0.8], night: [...WARM, 0.75],
      midi: 62, sc: 0, work: -1, play: true,
    }, o);
    s.len = len(sub(s.b, s.a));
    if (s.vf === undefined) s.vf = Math.min(7, Math.max(1.7, 2.3 * Math.sqrt(3.2 / s.len)));
    if (s.kind === 3) s.play = false;
    s.index = S.length;
    S.push(s);
    return s.index;
  };
  // 骨架是首尾相接的折线。mode 记下这一段哪一头是真正的端点（1 起点，2 终点），只有端点才需要淡出
  const frame = (pts, sc, width = 0.034) => {
    const n = pts.length - 1;
    const closed = len(sub(pts[0], pts[n])) < 1e-6;
    for (let i = 0; i < n; i++) {
      const ends = closed ? 0 : (i === 0 ? 1 : 0) + (i === n - 1 ? 2 : 0);
      add({ a: pts[i], b: pts[i + 1], kind: 3, mode: ends, width, sc, day: [...FRAME_DAY, 0.92], night: [...FRAME_NIGHT, 0.55] });
    }
  };
  const groups = { hero: [], veil: [], works: [], lattice: [], modes: [], pegs: [], choir: [], main: -1, ref: -1 };
  const centers = [];

  // ── 0 序：一架扭转的竖琴 ─────────────────────────────────────────
  {
    const cx = 0;
    centers.push([cx, 0, 0, 5.2]);
    const N = 56;
    const top = (s) => [cx - 2.9 + 5.8 * s, 5.25 - 3.35 * Math.pow(s, 1.2) + 0.22 * Math.sin(s * Math.PI), 1.0 * Math.sin((s - 0.5) * 2.3)];
    const bot = (s) => [cx - 1.95 + 4.4 * s, 0.32 + 0.55 * s * s, -1.0 * Math.sin((s - 0.5) * 2.3)];
    for (let i = 0; i < N; i++) {
      const s = i / (N - 1);
      const note = Math.floor(i / 2); // 两根一组，同一个音，像钢琴的同度弦
      const midi = major(note + 4, 36); // 从 A2 往上四个八度
      const pc = ((midi % 12) + 12) % 12;
      // 竖琴的规矩：主音的弦染红，属音的弦染蓝，手才找得到位置
      let day = [...INK, 0.82], night = [...WARM, 0.8];
      if (pc === 2) { day = [...CATS.game.day, 0.95]; night = [...CATS.game.night, 0.95]; }
      else if (pc === 9) { day = [...CATS.agent.day, 0.95]; night = [...CATS.agent.night, 0.95]; }
      groups.hero.push(add({ a: bot(s), b: top(s), midi, sc: 0, day, night, width: 0.0125 - 0.004 * s }));
    }
    const neck = [], base = [];
    for (let i = 0; i <= 28; i++) { const s = -0.03 + 1.06 * (i / 28); neck.push(top(s)); base.push(bot(s)); }
    frame(neck, 0, 0.04); frame(base, 0, 0.04);
    const cTop = [cx - 3.22, 5.42, top(0)[2] + 0.1], cBot = [cx - 2.3, 0.02, bot(0)[2] - 0.08];
    frame([cTop, cBot], 0, 0.05);
    frame([cTop, top(-0.03)], 0, 0.04);
    frame([cBot, bot(-0.03)], 0, 0.04);
    // 琴柱和琴颈之间的一片薄纱：直线包络出的曲线
    const M = 22;
    for (let i = 0; i < M; i++) {
      const q = 0.1 + 0.62 * (i / (M - 1));
      const c = [cTop[0] + (cBot[0] - cTop[0]) * (1 - q), cTop[1] + (cBot[1] - cTop[1]) * (1 - q), cTop[2] + (cBot[2] - cTop[2]) * (1 - q)];
      groups.veil.push(add({ a: c, b: top(q * 0.5), midi: penta(20 + (i % 10), 36), sc: 0, width: 0.005, day: [...INK, 0.26], night: [...WARM, 0.22] }));
    }
  }

  // ── 1 造物：一座双曲面塔，每件作品一根弦 ───────────────────────────
  {
    const cx = SPACING, cz = -1;
    centers.push([cx, 0, cz, 4.6]);
    const N = WORKS.length;
    const Rb = 2.45, Rt = 2.05, y0 = 0.28, y1 = 5.1, tw = 1.9;
    for (let i = 0; i < N; i++) {
      const th = (i / N) * Math.PI * 2;
      const c = CATS[WORKS[i].c];
      // 清单从头滚到尾，是一段缓慢爬升又落下的琶音
      const k = i % 28, up = k < 14 ? k : 27 - k;
      const deg = 5 + Math.floor(up / 2) + [0, 2, 4, 2][i % 4];
      groups.works.push(add({
        a: [cx + Rb * Math.cos(th), y0, cz + Rb * Math.sin(th)],
        b: [cx + Rt * Math.cos(th + tw), y1, cz + Rt * Math.sin(th + tw)],
        midi: penta(deg, 36), sc: 1, work: i, width: 0.0135,
        day: [...c.day, 0.9], night: [...c.night, 0.85], theta: th + tw / 2,
      }));
    }
    for (let i = 0; i < N; i++) {
      const th = ((i + 0.5) / N) * Math.PI * 2;
      groups.lattice.push(add({
        a: [cx + Rb * Math.cos(th), y0, cz + Rb * Math.sin(th)],
        b: [cx + Rt * Math.cos(th - tw), y1, cz + Rt * Math.sin(th - tw)],
        midi: penta(15 + (i % 10), 36), sc: 1, width: 0.006,
        day: [...INK, 0.26], night: [...WARM, 0.2],
      }));
    }
    const ring = (R, y) => { const p = []; for (let i = 0; i <= 56; i++) { const t = (i / 56) * Math.PI * 2; p.push([cx + R * Math.cos(t), y, cz + R * Math.sin(t)]); } return p; };
    frame(ring(Rb, y0), 1, 0.045); frame(ring(Rt, y1), 1, 0.04);
  }

  // ── 2 泛音：九根横弦，一根叠加弦和它的前八个本征模 ─────────────────
  {
    const cx = SPACING * 2;
    centers.push([cx, 0, 0.1, 4.8]);
    const hues = ['game', 'art', 'learn', 'agent', 'life'];
    for (let k = 0; k <= 8; k++) {
      const y = 0.8 + k * 0.52, z = -0.55 + k * 0.15;
      const c = k === 0 ? null : CATS[hues[(k - 1) % 5]];
      groups.modes.push(add({
        a: [cx - 3.1, y, z], b: [cx + 3.1, y, z], sc: 2,
        kind: k === 0 ? 2 : 1, mode: Math.max(1, k), vf: 0.55, width: k === 0 ? 0.021 : 0.013,
        day: c ? [...c.day, 0.62] : [...INK, 0.95],
        night: c ? [...c.night, 0.6] : [...WARM, 0.95],
        midi: 50, play: false,
      }));
    }
    frame([[cx - 3.1, 0, -0.62], [cx - 3.1, 5.35, 0.78]], 2, 0.04);
    frame([[cx + 3.1, 0, -0.62], [cx + 3.1, 5.35, 0.78]], 2, 0.04);
  }

  // ── 3 合奏：一面给乒乓球的弦板 ───────────────────────────────────
  {
    const cx = SPACING * 3;
    centers.push([cx, 0, 0, 4.6]);
    const hues = ['game', 'art', 'learn', 'agent', 'life'];
    let n = 0;
    for (let r = 0; r < 6; r++) {
      const y = 4.62 - r * 0.76;
      const xs = r % 2 === 0 ? [-2.4, -0.8, 0.8, 2.4] : [-1.6, 0, 1.6];
      xs.forEach((x, j) => {
        const tilt = ((r + j) % 2 === 0 ? 1 : -1) * 0.17;
        const hl = 0.55;
        const c = CATS[hues[n % 5]];
        groups.pegs.push(add({
          a: [cx + x - hl * Math.cos(tilt), y - hl * Math.sin(tilt), 0],
          b: [cx + x + hl * Math.cos(tilt), y + hl * Math.sin(tilt), 0],
          midi: penta(19 - r * 2 - (j % 3), 36), sc: 3, width: 0.017, vf: 5.2,
          day: [...c.day, 0.95], night: [...c.night, 0.9],
        }));
        n++;
      });
    }
    frame([[cx - 3.3, 0, 0], [cx - 3.3, 5.5, 0]], 3, 0.045);
    frame([[cx + 3.3, 0, 0], [cx + 3.3, 5.5, 0]], 3, 0.045);
  }

  // ── 4 尾声：一根要调的弦，一根标准音，和围成一圈的共鸣弦 ─────────────
  {
    const cx = SPACING * 4;
    centers.push([cx, 0, 0, 6.5]);
    groups.main = add({ a: [cx, 0.12, 0], b: [cx, 5.8, 0], sc: 4, kind: 1, mode: 1, vf: 2.6, width: 0.02, play: false, day: [...INK, 0.95], night: [1.0, 0.9, 0.72, 1.0] });
    groups.ref = add({ a: [cx + 0.55, 0.12, -0.35], b: [cx + 0.55, 5.8, -0.35], sc: 4, kind: 1, mode: 1, vf: 2.6, width: 0.009, play: false, day: [...INK, 0.4], night: [0.62, 0.74, 1.0, 0.6] });
    const N = 108, R = 6.3;
    for (let i = 0; i < N; i++) {
      const ph = (i / N) * Math.PI * 2;
      const h = 2.3 + 1.1 * Math.sin(ph * 3 + 0.6) + 0.7 * Math.sin(ph * 7 + 2.0) + 0.35 * Math.sin(ph * 13);
      const w = WORKS[i % WORKS.length];
      const c = i % 2 === 0 ? CATS[w.c] : null;
      groups.choir.push(add({
        a: [cx + R * Math.cos(ph), 0.1, R * Math.sin(ph)],
        b: [cx + (R - 0.25) * Math.cos(ph), 0.1 + Math.max(1.2, h), (R - 0.25) * Math.sin(ph)],
        sc: 4, midi: penta(8 + (i * 3) % 14, 36), width: 0.011, phi: ph,
        day: c ? [...c.day, 0.55] : [...INK, 0.4],
        night: c ? [...c.night, 0.2] : [...WARM, 0.14],
      }));
    }
  }

  return { strings: S, groups, centers };
}
