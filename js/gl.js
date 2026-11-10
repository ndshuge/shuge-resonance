// 原生 WebGL2 渲染器：背景（墙与地面）、弦（实例化的带状线）、乒乓球。
// 没有深度缓冲。白天是“墨线压在纸上”的普通混合，夜里是加色发光，
// 两种状态用同一条预乘 alpha 管线连续过渡。

const SEG = 30; // 每根弦沿长度方向的分段

const VS_BG = `#version 300 es
precision highp float;
layout(location=0) in vec2 aPos;
out vec2 vNdc;
void main(){ vNdc = aPos; gl_Position = vec4(aPos, 0.0, 1.0); }`;

const FS_BG = `#version 300 es
precision highp float;
in vec2 vNdc;
uniform mat4 uInvVP;
uniform float uNight, uLift;
uniform vec4 uPool[5];
uniform float uPoolI[5];
out vec4 o;
float hash(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
void main(){
  vec4 p0 = uInvVP * vec4(vNdc, -1.0, 1.0);
  vec4 p1 = uInvVP * vec4(vNdc, 1.0, 1.0);
  vec3 ro = p0.xyz / p0.w;
  vec3 rd = normalize(p1.xyz / p1.w - ro);

  vec3 wallTop = vec3(0.948, 0.955, 0.943);
  vec3 wallLow = vec3(0.882, 0.896, 0.880);
  vec3 floorDay = vec3(0.832, 0.850, 0.832);
  vec3 nightTop = vec3(0.012, 0.016, 0.026);
  vec3 nightLow = vec3(0.040, 0.046, 0.064) + vec3(0.10, 0.07, 0.035) * uLift;
  vec3 floorNight = vec3(0.022, 0.026, 0.038);

  float up = rd.y;
  vec3 dayc = mix(wallLow, wallTop, smoothstep(-0.02, 0.5, up));
  vec3 nightc = mix(nightLow, nightTop, smoothstep(-0.02, 0.42, up));

  if (rd.y < -1e-4) {
    float t = -ro.y / rd.y;
    vec3 hit = ro + rd * t;
    float fog = 1.0 - exp(-t * 0.03);
    float pool = 0.0;
    for (int i = 0; i < 5; i++) {
      vec2 d = hit.xz - uPool[i].xz;
      pool += uPoolI[i] * exp(-dot(d, d) / (uPool[i].w * uPool[i].w));
    }
    vec3 fd = floorDay + vec3(0.085) * pool;
    dayc = mix(fd, wallLow, fog);
    vec3 fn = floorNight + vec3(0.17, 0.12, 0.062) * pool * (1.0 + 1.6 * uLift);
    nightc = mix(fn, nightLow, fog);
  }
  vec3 col = mix(dayc, nightc, uNight);
  float v = length(vNdc * vec2(0.85, 1.0));
  col *= 1.0 - (0.05 + 0.16 * uNight) * smoothstep(0.55, 1.55, v);
  col += (hash(gl_FragCoord.xy) - 0.5) / 160.0;
  o = vec4(col, 1.0);
}`;

const VS_STR = `#version 300 es
precision highp float;
layout(location=0) in vec2 aUV;      // x: 沿弦 0..1，y: 带的两侧 -1 / +1
layout(location=1) in vec3 aA;
layout(location=2) in vec3 aB;
layout(location=3) in vec4 aDay;
layout(location=4) in vec4 aNight;
layout(location=5) in vec4 aParam;   // 粗细（世界单位）、类型、模态 n、可视频率
layout(location=6) in vec4 aDyn;     // 拨动时刻、拨点、振幅、高亮
uniform mat4 uVP;
uniform vec3 uCam;
uniform vec2 uRes;
uniform vec3 uLight;
uniform float uTime, uNight, uFocus, uProj, uPx, uPass, uDof, uWidth;
uniform vec2 uFog;
uniform float uPart[8];
out float vD;
out float vCore;
out float vSoft;
out float vHaloR;
out float vHaloA;
out float vHaloE;
out float vU;
out vec2 vEnd;
out vec2 vMask;
out vec4 vDay;
out vec4 vNight;
const float PI = 3.14159265;

void main(){
  float kind = aParam.y;
  float u = aUV.x;
  float y = 0.0;
  float energy = 0.0;
  if (kind < 0.5) {
    // 拨弦：三角形初始形状的前 6 个本征模，各自衰减
    float t = uTime - aDyn.x;
    float amp = aDyn.z;
    if (amp != 0.0 && t >= 0.0) {
      float p = aDyn.y;
      float w = 6.2831853 * aParam.w;
      for (int n = 1; n <= 6; n++) {
        float fn = float(n);
        y += sin(fn * PI * p) / (fn * fn) * sin(fn * PI * u) * cos(w * fn * t) * exp(-t * (0.5 + 0.55 * fn));
      }
      y *= amp * 1.2 * smoothstep(0.0, 0.04, t);
      energy = clamp(abs(amp) * exp(-t * 1.1) * 7.0, 0.0, 1.0);
    }
  } else if (kind < 1.5) {
    // 单一驻波
    float fn = aParam.z;
    y = aDyn.z * sin(fn * PI * u) * cos(6.2831853 * aParam.w * fn * uTime + aDyn.y);
    energy = clamp(abs(aDyn.z) * 5.0, 0.0, 1.0);
  } else if (kind < 2.5) {
    // 叠加弦：把点亮的泛音加起来
    float w = 6.2831853 * aParam.w;
    for (int n = 1; n <= 8; n++) {
      float fn = float(n);
      y += uPart[n - 1] * sin(fn * PI * 0.27) / (fn * fn) * sin(fn * PI * u) * cos(w * fn * uTime);
    }
    y *= aDyn.z;
    energy = 0.5;
  }

  vec3 axis = aB - aA;
  vec3 dir = normalize(axis);
  vec3 mid = 0.5 * (aA + aB);
  vec3 side = cross(dir, uCam - mid);
  float sl = length(side);
  side = sl > 1e-4 ? side / sl : vec3(1.0, 0.0, 0.0);

  vec3 P = mix(aA, aB, u) + side * y;
  float h = max(P.y, 0.0);
  vec3 T = dir;
  if (uPass > 0.5 && uPass < 1.5) {
    P.xz -= uLight.xz * (P.y / uLight.y); P.y = 0.0;
    T.xz -= uLight.xz * (T.y / uLight.y); T.y = 0.0;
  } else if (uPass > 1.5) {
    P.y = -P.y; T.y = -T.y;
  }

  vec4 clip = uVP * vec4(P, 1.0);
  vec4 clip2 = uVP * vec4(P + T * 0.06, 1.0);
  float depth = max(clip.w, 0.05);
  vec2 td = (clip2.xy / max(clip2.w, 0.05) - clip.xy / depth) * uRes;
  float tl = length(td);
  td = tl > 1e-5 ? td / tl : vec2(0.0, 1.0);
  vec2 nrm = vec2(-td.y, td.x);

  // 哪一头需要淡出：弦两头都要；骨架只有折线真正的端点要
  vec2 mask = kind > 2.5 ? vec2(mod(aParam.z, 2.0), floor(aParam.z * 0.5)) : vec2(1.0);
  float hi = max(aDyn.w, 0.0);            // 高亮
  float dim = clamp(-aDyn.w, 0.0, 1.0);   // 负值表示压暗
  float lit = clamp(hi + energy * 0.7, 0.0, 1.6);
  float wpx = aParam.x * uWidth * uProj / depth * (1.0 + 0.9 * hi);
  float core = wpx * 0.5;
  float coc = min(uDof * abs(1.0 / depth - 1.0 / uFocus) * uProj, 30.0 * uPx);
  float soft = 0.75 * uPx + coc;

  float fade = smoothstep(0.5, 2.2, clip.w) * (1.0 - 0.9 * smoothstep(uFog.x, uFog.y, depth)) * (1.0 - 0.82 * dim);
  vec4 day = vec4(aDay.rgb, min(1.0, aDay.a * (1.0 + 1.4 * lit)) * fade);
  vec4 night = vec4(aNight.rgb * (1.0 + 1.05 * lit), aNight.a * fade);
  float haloR = (core * 2.0 + 4.0 * uPx) * (1.0 + coc * 0.12);
  float haloA = 0.10 + 0.42 * lit;

  if (uPass > 0.5 && uPass < 1.5) {
    // 落在地面上的影子：离地越高越虚
    soft += h * 0.045 * uProj / depth;
    // 带子只在横向是虚的，两端得自己淡出去，不然影子会被齐刷刷切断
    float fl = clamp(h * 0.14 / max(length(axis), 0.1), 0.02, 0.4);
    float ends = mix(1.0, smoothstep(0.0, fl, u), mask.x) * mix(1.0, smoothstep(0.0, fl, 1.0 - u), mask.y);
    day = vec4(0.10, 0.13, 0.14, aDay.a * 0.36 * exp(-h * 0.3) * fade * ends);
    night.a = 0.0; haloA = 0.0;
  } else if (uPass > 1.5) {
    // 夜里漆面地板上的倒影
    soft += h * 0.03 * uProj / depth;
    day.a = 0.0;
    night.a *= 0.30 * exp(-h * 0.34) * (kind > 2.5 ? 1.0 : smoothstep(0.0, 0.08, 1.0 - u));
    haloA *= 0.5;
  }

  float haloE = haloR * 4.0;
  float ext = max(core + soft, haloE * uNight) + 1.0;
  // 带子只在横向是虚的；两端按虚化的宽度自己淡出，免得光晕被切成方块
  float lenPx = max(length(axis) * uProj / depth, 1.0);
  vEnd = vec2(clamp(soft * 1.2 / lenPx, 1e-4, 0.9), clamp(haloE * 0.6 / lenPx, 1e-4, 0.9));
  vMask = mask;
  vU = u; vHaloE = haloE;
  vD = aUV.y * ext;
  vCore = core; vSoft = soft; vHaloR = haloR; vHaloA = haloA;
  vDay = day; vNight = night;
  clip.xy += nrm * (aUV.y * ext) * 2.0 / uRes * clip.w;
  gl_Position = clip;
}`;

const FS_STR = `#version 300 es
precision highp float;
in float vD;
in float vCore;
in float vSoft;
in float vHaloR;
in float vHaloA;
in float vHaloE;
in float vU;
in vec2 vEnd;
in vec2 vMask;
in vec4 vDay;
in vec4 vNight;
uniform float uNight;
out vec4 o;
void main(){
  float d = abs(vD);
  float endS = mix(1.0, smoothstep(0.0, vEnd.x, vU), vMask.x) * mix(1.0, smoothstep(0.0, vEnd.x, 1.0 - vU), vMask.y);
  float endH = mix(1.0, smoothstep(0.0, vEnd.y, vU), vMask.x) * mix(1.0, smoothstep(0.0, vEnd.y, 1.0 - vU), vMask.y);
  float a = (1.0 - smoothstep(vCore - vSoft, vCore + vSoft, d)) * endS;
  float halo = vHaloA * exp(-d / vHaloR) * (1.0 - smoothstep(vHaloE * 0.45, vHaloE, d)) * endH;
  float ad = a * vDay.a * (1.0 - uNight);
  vec3 nightRgb = vNight.rgb * (a + halo) * vNight.a * uNight;
  o = vec4(vDay.rgb * ad + nightRgb, ad);
}`;

const VS_BALL = `#version 300 es
precision highp float;
layout(location=0) in vec2 aCorner;
layout(location=1) in vec4 aBall;   // xyz, 半径
layout(location=2) in float aLife;
uniform mat4 uVP;
uniform vec3 uCamRight, uCamUp, uLight;
uniform float uShadow;
out vec2 vUV;
out float vLife;
out float vH;
void main(){
  vUV = aCorner; vLife = aLife;
  vec3 P;
  if (uShadow > 0.5) {
    vec3 c = aBall.xyz;
    c.xz -= uLight.xz * (c.y / uLight.y);
    float s = aBall.w * (1.5 + c.y * 0.5);
    vH = aBall.y;
    P = vec3(c.x + aCorner.x * s, 0.002, c.z + aCorner.y * s);
  } else {
    vH = 0.0;
    P = aBall.xyz + (uCamRight * aCorner.x + uCamUp * aCorner.y) * aBall.w;
  }
  gl_Position = uVP * vec4(P, 1.0);
}`;

const FS_BALL = `#version 300 es
precision highp float;
in vec2 vUV;
in float vLife;
in float vH;
uniform float uNight, uShadow;
out vec4 o;
void main(){
  float r2 = dot(vUV, vUV);
  if (uShadow > 0.5) {
    float a = exp(-r2 * 3.2) * 0.30 * exp(-vH * 0.35) * vLife * (1.0 - uNight * 0.6);
    o = vec4(vec3(0.07, 0.09, 0.10) * a, a);
    return;
  }
  if (r2 > 1.0) discard;
  vec3 n = vec3(vUV, sqrt(1.0 - r2));
  vec3 l = normalize(vec3(-0.45, 0.75, 0.55));
  float dif = max(dot(n, l), 0.0);
  float rim = pow(1.0 - n.z, 2.5);
  vec3 base = vec3(0.965, 0.52, 0.10);
  vec3 dayc = base * (0.50 + 0.62 * dif) + vec3(1.0) * pow(max(dot(reflect(-l, n), vec3(0.0, 0.0, 1.0)), 0.0), 24.0) * 0.35 + vec3(0.20, 0.10, 0.02) * rim;
  vec3 nightc = base * (0.30 + 0.85 * dif) + vec3(1.0, 0.6, 0.25) * rim * 0.5;
  float edge = 1.0 - smoothstep(0.90, 1.0, r2);
  float a = edge * vLife;
  o = vec4(mix(dayc, nightc, uNight) * a, a);
}`;

function compile(gl, type, src) {
  const s = gl.createShader(type);
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
    throw new Error('着色器编译失败：' + gl.getShaderInfoLog(s));
  }
  return s;
}
function program(gl, vs, fs) {
  const p = gl.createProgram();
  gl.attachShader(p, compile(gl, gl.VERTEX_SHADER, vs));
  gl.attachShader(p, compile(gl, gl.FRAGMENT_SHADER, fs));
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
    throw new Error('着色器链接失败：' + gl.getProgramInfoLog(p));
  }
  const u = {};
  const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
  for (let i = 0; i < n; i++) {
    const info = gl.getActiveUniform(p, i);
    const name = info.name.replace(/\[0\]$/, '');
    u[name] = gl.getUniformLocation(p, info.name);
  }
  return { p, u };
}

export const STATIC_STRIDE = 18; // aA3 aB3 aDay4 aNight4 aParam4
export const MAX_BALLS = 10;

export class Renderer {
  constructor(canvas) {
    const gl = canvas.getContext('webgl2', {
      antialias: false, alpha: false, depth: false, stencil: false,
      powerPreference: 'high-performance', preserveDrawingBuffer: false,
    });
    if (!gl) throw new Error('这个浏览器没有 WebGL2');
    this.gl = gl;
    this.canvas = canvas;
    this.bg = program(gl, VS_BG, FS_BG);
    this.str = program(gl, VS_STR, FS_STR);
    this.ball = program(gl, VS_BALL, FS_BALL);

    // 背景：一个盖满屏幕的三角形
    this.bgVao = gl.createVertexArray();
    gl.bindVertexArray(this.bgVao);
    const tri = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, tri);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

    // 弦：一条三角形带，实例化
    const strip = new Float32Array((SEG + 1) * 4);
    for (let j = 0; j <= SEG; j++) {
      strip[j * 4] = j / SEG; strip[j * 4 + 1] = -1;
      strip[j * 4 + 2] = j / SEG; strip[j * 4 + 3] = 1;
    }
    this.strVao = gl.createVertexArray();
    gl.bindVertexArray(this.strVao);
    const sb = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, sb);
    gl.bufferData(gl.ARRAY_BUFFER, strip, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    this.staticBuf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.staticBuf);
    const B = 4 * STATIC_STRIDE;
    const attr = (loc, size, off) => {
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, size, gl.FLOAT, false, B, off * 4);
      gl.vertexAttribDivisor(loc, 1);
    };
    attr(1, 3, 0); attr(2, 3, 3); attr(3, 4, 6); attr(4, 4, 10); attr(5, 4, 14);
    this.dynBuf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.dynBuf);
    gl.enableVertexAttribArray(6);
    gl.vertexAttribPointer(6, 4, gl.FLOAT, false, 16, 0);
    gl.vertexAttribDivisor(6, 1);
    this.count = 0;

    // 球
    this.ballVao = gl.createVertexArray();
    gl.bindVertexArray(this.ballVao);
    const qb = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, qb);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    this.ballBuf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.ballBuf);
    gl.bufferData(gl.ARRAY_BUFFER, MAX_BALLS * 5 * 4, gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 4, gl.FLOAT, false, 20, 0);
    gl.vertexAttribDivisor(1, 1);
    gl.enableVertexAttribArray(2);
    gl.vertexAttribPointer(2, 1, gl.FLOAT, false, 20, 16);
    gl.vertexAttribDivisor(2, 1);
    gl.bindVertexArray(null);

    gl.disable(gl.DEPTH_TEST);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
  }

  setStrings(staticData, count) {
    const gl = this.gl;
    this.count = count;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.staticBuf);
    gl.bufferData(gl.ARRAY_BUFFER, staticData, gl.STATIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.dynBuf);
    gl.bufferData(gl.ARRAY_BUFFER, count * 16, gl.DYNAMIC_DRAW);
  }

  updateStatic(staticData) {
    const gl = this.gl;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.staticBuf);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, staticData);
  }

  resize(w, h) {
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w; this.canvas.height = h;
    }
  }

  render(f) {
    const gl = this.gl;
    const W = this.canvas.width, H = this.canvas.height;
    gl.viewport(0, 0, W, H);

    // 背景
    gl.disable(gl.BLEND);
    gl.useProgram(this.bg.p);
    gl.uniformMatrix4fv(this.bg.u.uInvVP, false, f.invVP);
    gl.uniform1f(this.bg.u.uNight, f.night);
    gl.uniform1f(this.bg.u.uLift, f.lift);
    gl.uniform4fv(this.bg.u.uPool, f.pools);
    gl.uniform1fv(this.bg.u.uPoolI, f.poolI);
    gl.bindVertexArray(this.bgVao);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.enable(gl.BLEND);

    // 弦
    const s = this.str;
    gl.useProgram(s.p);
    gl.uniformMatrix4fv(s.u.uVP, false, f.vp);
    gl.uniform3fv(s.u.uCam, f.cam);
    gl.uniform2f(s.u.uRes, W, H);
    gl.uniform3fv(s.u.uLight, f.light);
    gl.uniform1f(s.u.uTime, f.time);
    gl.uniform1f(s.u.uNight, f.night);
    gl.uniform1f(s.u.uFocus, f.focus);
    gl.uniform1f(s.u.uProj, f.proj);
    gl.uniform1f(s.u.uPx, f.px);
    gl.uniform1f(s.u.uDof, f.dof);
    gl.uniform1f(s.u.uWidth, f.widthScale);
    gl.uniform2f(s.u.uFog, f.fog[0], f.fog[1]);
    gl.uniform1fv(s.u.uPart, f.parts);
    gl.bindVertexArray(this.strVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.dynBuf);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, f.dyn);
    const n = (SEG + 1) * 2;
    if (f.night < 0.98) {
      gl.uniform1f(s.u.uPass, 1);
      gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, n, this.count);
    }
    if (f.night > 0.02) {
      gl.uniform1f(s.u.uPass, 2);
      gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, n, this.count);
    }

    // 球的影子压在弦的影子上、弦的下面
    const nb = f.ballCount || 0;
    if (nb > 0) {
      const b = this.ball;
      gl.useProgram(b.p);
      gl.uniformMatrix4fv(b.u.uVP, false, f.vp);
      gl.uniform3fv(b.u.uCamRight, f.camRight);
      gl.uniform3fv(b.u.uCamUp, f.camUp);
      gl.uniform3fv(b.u.uLight, f.light);
      gl.uniform1f(b.u.uNight, f.night);
      gl.bindVertexArray(this.ballVao);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.ballBuf);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, f.balls, 0, nb * 5);
      gl.uniform1f(b.u.uShadow, 1);
      gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, nb);
      gl.useProgram(s.p);
      gl.bindVertexArray(this.strVao);
    }

    gl.uniform1f(s.u.uPass, 0);
    gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, n, this.count);

    if (nb > 0) {
      const b = this.ball;
      gl.useProgram(b.p);
      gl.bindVertexArray(this.ballVao);
      gl.uniform1f(b.u.uShadow, 0);
      gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, nb);
    }
    gl.bindVertexArray(null);
  }
}
