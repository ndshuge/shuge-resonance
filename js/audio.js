// 声音全部现场合成，没有任何音频文件。
// 拨弦用 Karplus–Strong：一小段噪声在延迟线里循环，每圈过一次低通，
// 延迟线的长度决定音高。每个音高预先算好一段缓冲，播放时再配上力度和声像。

const midiHz = (m) => 440 * Math.pow(2, (m - 69) / 12);

export function renderPluck(freq, sr) {
  const dur = Math.min(4.2, Math.max(1.6, 5.2 - Math.log2(freq / 110) * 0.75));
  const N = Math.floor(dur * sr);
  const out = new Float32Array(N);
  const period = sr / freq;
  // 环路低通 y = (1-S)·x[n] + S·x[n-1]，低频相位延迟约 S 个采样
  const S = Math.min(0.5, Math.max(0.18, 0.5 - (Math.log2(freq / 110)) * 0.055));
  let L = Math.floor(period - S);
  let frac = period - S - L;
  if (frac < 0.12) { L -= 1; frac += 1; }
  const ap = (1 - frac) / (1 + frac); // 分数延迟全通，让音准对上
  const dl = new Float32Array(L);
  // 激励：低通过的噪声，再按拨点位置做一次梳状滤波
  let seed = (Math.floor(freq * 977) % 2147483647) || 1;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 2 - 1;
  let lp = 0;
  const bright = Math.min(0.9, 0.32 + 180 / freq * 0.25);
  for (let i = 0; i < L; i++) { lp += (rnd() - lp) * bright; dl[i] = lp; }
  for (let k = 0; k < 2; k++) { let q = dl[L - 1]; for (let i = 0; i < L; i++) { q += (dl[i] - q) * 0.62; dl[i] = q; } }
  const pick = Math.max(1, Math.round(L * 0.21));
  const tmp = dl.slice();
  for (let i = 0; i < L; i++) dl[i] = tmp[i] - 0.82 * tmp[(i - pick + L) % L];
  let peak = 0, mean = 0;
  for (let i = 0; i < L; i++) mean += dl[i];
  mean /= L;
  for (let i = 0; i < L; i++) { dl[i] -= mean; peak = Math.max(peak, Math.abs(dl[i])); }
  for (let i = 0; i < L; i++) dl[i] /= peak || 1;

  const t60 = Math.min(6.5, Math.max(1.3, 4.6 - Math.log2(freq / 110) * 0.8));
  const g = Math.pow(10, -3 / (t60 * freq));
  let idx = 0, xPrev = 0, apIn = 0, apOut = 0;
  for (let n = 0; n < N; n++) {
    const x = dl[idx];
    const lpv = (1 - S) * x + S * xPrev; xPrev = x;
    const y = ap * lpv + apIn - ap * apOut; apIn = lpv; apOut = y;
    dl[idx] = y * g;
    out[n] = x;
    idx++; if (idx >= L) idx = 0;
  }
  const a = Math.floor(0.002 * sr), r = Math.floor(0.25 * sr);
  for (let i = 0; i < a; i++) out[i] *= i / a;
  for (let i = 0; i < r; i++) out[N - 1 - i] *= i / r;
  return out;
}

function renderTock(sr) {
  // 乒乓球落在硬东西上的那一声
  const N = Math.floor(0.09 * sr);
  const out = new Float32Array(N);
  let seed = 4242;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 2 - 1;
  let b1 = 0, b2 = 0;
  for (let i = 0; i < N; i++) {
    const t = i / sr;
    const env = Math.exp(-t * 95);
    const tone = Math.sin(2 * Math.PI * 1480 * t) * 0.6 + Math.sin(2 * Math.PI * 2890 * t) * 0.3;
    const nz = rnd();
    b1 += (nz - b1) * 0.5; b2 += (b1 - b2) * 0.35;
    out[i] = (tone + (b1 - b2) * 1.6) * env * Math.min(1, i / 12);
  }
  return out;
}

function renderIR(ctx, seconds = 3.1) {
  const sr = ctx.sampleRate, N = Math.floor(seconds * sr);
  const buf = ctx.createBuffer(2, N, sr);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    let seed = 1337 + ch * 7919;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 2 - 1;
    let lp = 0;
    for (let i = 0; i < N; i++) {
      const t = i / sr;
      // 越往后越暗：混响尾巴里的高频先没
      const cut = 0.55 * Math.exp(-t * 1.5) + 0.06;
      lp += (rnd() - lp) * cut;
      const env = Math.pow(1 - i / N, 1.6) * Math.exp(-t * 1.05);
      d[i] = lp * env * (t < 0.012 ? t / 0.012 : 1);
    }
    for (let k = 0; k < 7; k++) { // 几次早期反射
      const at = Math.floor((0.011 + 0.013 * k + 0.004 * ch + 0.003 * ((k * 7) % 5)) * sr);
      if (at < N) d[at] += (k % 2 ? -1 : 1) * 0.5 / (1 + k * 0.6);
    }
  }
  return buf;
}

export class Sound {
  constructor() {
    this.ctx = null;
    this.level = 2;            // 0 关  1 弱  2 中  3 强
    this.gains = [0, 0.32, 0.62, 1.0];
    this.buffers = new Map();
    this.active = [];          // 正在响的拨弦，按开始的先后排
    this.lastNote = new Map();
    this.tune = null;
  }

  get on() { return !!this.ctx && this.level > 0 && this.ctx.state === 'running'; }
  get voices() { return this.active.length; }

  // 必须在用户手势里调用
  async start() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return false;
      try { if (navigator.audioSession) navigator.audioSession.type = 'playback'; } catch (e) { /* iOS 静音键兼容，失败无妨 */ }
      const ctx = this.ctx = new AC({ latencyHint: 'interactive' });
      this.master = ctx.createGain();
      this.master.gain.value = this.gains[this.level];
      const comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -16; comp.knee.value = 18; comp.ratio.value = 3.2;
      comp.attack.value = 0.004; comp.release.value = 0.24;
      this.master.connect(comp); comp.connect(ctx.destination);
      this.dry = ctx.createGain(); this.dry.gain.value = 0.82; this.dry.connect(this.master);
      this.wet = ctx.createGain(); this.wet.gain.value = 0.85;
      const conv = ctx.createConvolver(); conv.buffer = renderIR(ctx);
      this.wet.connect(conv); conv.connect(this.master);
      const tb = ctx.createBuffer(1, Math.floor(0.09 * ctx.sampleRate), ctx.sampleRate);
      tb.getChannelData(0).set(renderTock(ctx.sampleRate));
      this.tockBuf = tb;
    }
    if (this.ctx.state !== 'running') { try { await this.ctx.resume(); } catch (e) { return false; } }
    return this.ctx.state === 'running';
  }

  setLevel(l) {
    this.level = l;
    if (this.ctx) this.master.gain.setTargetAtTime(this.gains[l], this.ctx.currentTime, 0.05);
  }

  // 提前把一批音高算好，免得第一次划过时卡一下
  warm(midis) {
    if (!this.ctx) return;
    const list = [...new Set(midis)].filter((m) => !this.buffers.has(m));
    const step = () => {
      const t0 = performance.now();
      while (list.length && performance.now() - t0 < 7) this._buffer(list.pop());
      if (list.length) setTimeout(step, 16);
    };
    step();
  }

  _buffer(midi) {
    let b = this.buffers.get(midi);
    if (!b) {
      const sr = this.ctx.sampleRate;
      const data = renderPluck(midiHz(midi), sr);
      b = this.ctx.createBuffer(1, data.length, sr);
      b.getChannelData(0).set(data);
      this.buffers.set(midi, b);
    }
    return b;
  }

  // 拨一根弦。vel 0..1，pan -1..1，delay 秒
  pluck(midi, vel = 0.6, pan = 0, delay = 0) {
    if (!this.on) return;
    const ctx = this.ctx, now = ctx.currentTime;
    const last = this.lastNote.get(midi) || 0;
    if (delay === 0 && now - last < 0.07) return;   // 同一个音连着触发就略过
    // 复音数有上限：满了就让最早的那个音很快收掉，把位置让出来
    while (this.active.length >= 34) {
      const v = this.active.shift();
      v.g.gain.cancelScheduledValues(now);
      v.g.gain.setTargetAtTime(0, now, 0.02);
      try { v.src.stop(now + 0.15); } catch (e) { /* 还没开始的音 */ }
    }
    this.lastNote.set(midi, now + delay);
    const src = ctx.createBufferSource();
    src.buffer = this._buffer(midi);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass'; lp.Q.value = 0.4;
    lp.frequency.value = Math.min(16000, 900 + Math.pow(vel, 1.4) * 8200 + midiHz(midi) * 2.2);
    const g = ctx.createGain();
    g.gain.value = 0.14 + 0.42 * vel * vel;
    src.connect(lp); lp.connect(g);
    let out = g;
    if (ctx.createStereoPanner) {
      const p = ctx.createStereoPanner(); p.pan.value = Math.max(-0.85, Math.min(0.85, pan));
      g.connect(p); out = p;
    }
    out.connect(this.dry); out.connect(this.wet);
    const voice = { src, g };
    this.active.push(voice);
    src.onended = () => { const k = this.active.indexOf(voice); if (k >= 0) this.active.splice(k, 1); out.disconnect(); };
    src.start(now + delay);
  }

  tock(vel = 0.5, pan = 0) {
    if (!this.on) return;
    const ctx = this.ctx;
    const src = ctx.createBufferSource(); src.buffer = this.tockBuf;
    src.playbackRate.value = 0.92 + Math.random() * 0.16;
    const g = ctx.createGain(); g.gain.value = 0.12 + 0.5 * vel;
    src.connect(g);
    let out = g;
    if (ctx.createStereoPanner) { const p = ctx.createStereoPanner(); p.pan.value = pan; g.connect(p); out = p; }
    out.connect(this.dry); out.connect(this.wet);
    src.onended = () => out.disconnect();
    src.start();
  }

  // 一个纯泛音：基频 f0 的第 n 个分音
  partial(f0, n, delay = 0, gain = 1) {
    if (!this.on) return;
    const ctx = this.ctx, t = ctx.currentTime + delay;
    const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = f0 * n;
    const g = ctx.createGain();
    const peak = (0.2 / Math.pow(n, 0.72)) * gain;
    const dur = 2.6 - n * 0.14;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(peak, t + 0.018);
    g.gain.exponentialRampToValueAtTime(0.0008, t + dur);
    o.connect(g); g.connect(this.dry); g.connect(this.wet);
    o.onended = () => g.disconnect();
    o.start(t); o.stop(t + dur + 0.05);
  }

  // 调音：一个固定的标准音，一个可以拧的音。两者接近时能听到拍音。
  tuneStart(freqRef, freqMine) {
    if (!this.on || this.tune) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const bus = ctx.createGain(); bus.gain.value = 0;
    bus.gain.setTargetAtTime(1, t, 0.25);
    bus.connect(this.dry);
    const wetSend = ctx.createGain(); wetSend.gain.value = 0.5; bus.connect(wetSend); wetSend.connect(this.wet);
    const voice = (f, pan, amp) => {
      const oscs = [], g = ctx.createGain(); g.gain.value = amp;
      [[1, 1], [2, 0.22], [3, 0.07]].forEach(([n, a]) => {
        const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = f * n;
        const og = ctx.createGain(); og.gain.value = a;
        o.connect(og); og.connect(g); o.start(); oscs.push([o, n]);
      });
      let out = g;
      if (ctx.createStereoPanner) { const p = ctx.createStereoPanner(); p.pan.value = pan; g.connect(p); out = p; }
      out.connect(bus);
      return { oscs, g };
    };
    this.tune = { bus, ref: voice(freqRef, 0.18, 0.12), mine: voice(freqMine, -0.18, 0.12) };
  }

  tuneSet(freqMine) {
    if (!this.tune) return;
    const t = this.ctx.currentTime;
    for (const [o, n] of this.tune.mine.oscs) o.frequency.setTargetAtTime(freqMine * n, t, 0.03);
  }

  tuneStop(fade = 0.5) {
    if (!this.tune) return;
    const tn = this.tune, ctx = this.ctx, t = ctx.currentTime;
    this.tune = null;
    tn.bus.gain.cancelScheduledValues(t);
    tn.bus.gain.setTargetAtTime(0, t, fade / 3);
    setTimeout(() => {
      for (const v of [tn.ref, tn.mine]) for (const [o] of v.oscs) { try { o.stop(); } catch (e) { /* 已停 */ } }
      tn.bus.disconnect();
    }, fade * 1000 + 400);
  }
}
