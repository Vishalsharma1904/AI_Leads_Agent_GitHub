/* ============================================================
 * clavis-orb.js · v4 — the Rudra24 AI orb, round by construction
 * ------------------------------------------------------------
 * Replaces strands-orb.js. The old orb drew full-rectangle strands
 * and only became round in a second "glass lens" pass (render to
 * texture + circle mask). When that pass failed on an integrated
 * GPU the raw square showed. This one can't do that:
 *
 *   · ONE WebGL1 draw, one fragment shader. No render targets, no
 *     float textures, no WebGL2, no extensions. Old Intel HD is fine.
 *   · The shader itself writes alpha 0 outside a circle, with a soft
 *     one-pixel antialiased edge. Premultiplied alpha. Nothing here
 *     relies on CSS to look round.
 *   · No WebGL at all (or the shader won't compile)? A DOM fallback:
 *     soft radial-gradient blobs inside a border-radius:50% clip,
 *     driven by the same JS clock. Still round.
 *
 * Look: a glass sphere with slow aurora strands and soft colour
 * blobs (coral · violet · cyan · pink), inner glass shading, a faint
 * fresnel rim and a gentle specular.
 *
 * States (eased, never jump): idle · listening · thinking · speaking
 * (+ error). Idle goes dim and slow when <html data-clavis-awake=
 * "asleep">. clavis-live.js feeds setProps({speed, amplitude,
 * intensity}) ~20x a second while audio plays; those become a live
 * "level" that swells the sphere and quickens the strands.
 *
 * Public API — identical to strands-orb.js:
 *   window.StrandsOrb = { create(el|id, opts), instance, init(el|id, opts) }
 *   instance.setProps(obj) · instance.setState(str) · instance.destroy()
 *   window.ClavisOrb === window.StrandsOrb
 * Auto-inits into #orb-container 50 ms after DOMContentLoaded and
 * follows its data-orb-state attribute (IDLE/LISTENING/THINKING/
 * SPEAKING/ERROR). init() again destroys the old one (clavis-perf.js
 * does this when the graphics tier changes).
 * ============================================================ */
(function () {
  'use strict';

  const TAU = Math.PI * 2;
  // Every oscillator in the shader uses a frequency that is a multiple of
  // 0.05, so the clock can wrap at 2π·20 without a visible jump — and stays
  // small enough for mediump GPUs after hours of uptime.
  const WRAP = TAU * 20;

  const DEFAULT_COLORS = ['#ec6248', '#7C3AED', '#06B6D4', '#F472B6'];

  /* Targets per state. Everything is eased toward these every frame. */
  const LOOKS = {
    idle:      { rate: 0.50, energy: 0.22, radius: 0.900, swirl: 0.00, spin: 0.06, bright: 1.00, sat: 1.00, strands: 0.85, breath: 1.0 },
    asleep:    { rate: 0.24, energy: 0.08, radius: 0.880, swirl: 0.00, spin: 0.03, bright: 0.96, sat: 0.84, strands: 0.55, breath: 0.7 },
    listening: { rate: 0.85, energy: 0.58, radius: 0.945, swirl: 0.00, spin: 0.10, bright: 1.05, sat: 1.10, strands: 1.05, breath: 0.6 },
    thinking:  { rate: 1.00, energy: 0.50, radius: 0.920, swirl: 1.00, spin: 1.35, bright: 1.03, sat: 1.06, strands: 1.15, breath: 0.4 },
    speaking:  { rate: 1.10, energy: 0.78, radius: 0.930, swirl: 0.12, spin: 0.22, bright: 1.07, sat: 1.14, strands: 1.20, breath: 0.3 },
    error:     { rate: 0.35, energy: 0.15, radius: 0.890, swirl: 0.00, spin: 0.04, bright: 0.96, sat: 0.70, strands: 0.60, breath: 0.8 },
  };
  const KEYS = Object.keys(LOOKS.idle);

  /* ── helpers ───────────────────────────────────────────────── */
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const num = (v, d) => (typeof v === 'number' && isFinite(v) ? v : d);
  function hexToRgb(hex) {
    const s = String(hex || '').trim().replace('#', '');
    const h = s.length === 3 ? s.split('').map((c) => c + c).join('') : s;
    const n = parseInt(h, 16);
    if (!/^[0-9a-f]{6}$/i.test(h) || !isFinite(n)) return [1, 1, 1];
    return [(n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255];
  }
  function palette(colors) {
    const src = Array.isArray(colors) && colors.length ? colors : DEFAULT_COLORS;
    const out = [];
    for (let i = 0; i < 4; i++) out.push(hexToRgb(src[i] ?? DEFAULT_COLORS[i]));
    return out;
  }
  const maxDpr = () => Math.max(1, Math.min(window.devicePixelRatio || 1, num(window.__clavisMaxDpr, 2)));
  const reducedMotion = () => { try { return matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (_) { return false; } };
  const isAsleep = () => document.documentElement.getAttribute('data-clavis-awake') === 'asleep';
  const isDark = () => document.documentElement.getAttribute('data-theme') === 'dark';

  /* ── shaders ───────────────────────────────────────────────── */
  const VERT = `
attribute vec2 aPos;
void main() { gl_Position = vec4(aPos, 0.0, 1.0); }
`;

  const FRAG = `
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
uniform vec2  uRes;
uniform float uTime;    /* wrapped clock, see WRAP */
uniform float uSpin;    /* accumulated rotation, wrapped at 2pi */
uniform float uEnergy;
uniform float uRadius;
uniform float uSwirl;
uniform float uBright;
uniform float uSat;
uniform float uStrands;
uniform float uLevel;   /* live audio level 0..1 */
uniform float uDark;    /* 0 light theme, 1 dark theme */
uniform vec3  uC0;      /* coral  */
uniform vec3  uC1;      /* violet */
uniform vec3  uC2;      /* cyan   */
uniform vec3  uC3;      /* pink   */

float hash(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}
float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x),
             mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
}
vec2 rot(vec2 p, float a) {
  float c = cos(a), s = sin(a);
  return vec2(c * p.x - s * p.y, s * p.x + c * p.y);
}
float blob(vec2 q, vec2 c, float s) {
  vec2 d = q - c;
  return exp(-dot(d, d) / (s * s));
}

void main() {
  float m  = min(uRes.x, uRes.y);
  vec2  p  = (gl_FragCoord.xy - 0.5 * uRes) / (0.5 * m);   /* -1..1, y up */
  float r  = length(p);
  float px = 2.0 / m;                                        /* one device pixel */
  float t  = uTime;

  float R = uRadius + 0.035 * uLevel;
  R = min(R, 1.0 - 2.0 * px);

  /* Antialiased disc — the orb is round because THIS is round. */
  float disc = clamp((R - r) / (1.25 * px) + 0.5, 0.0, 1.0);

  /* Soft halo in the ring between the sphere and the canvas edge.
     Reaches exactly 0 before r = 1, so the canvas corners stay empty. */
  float ring = 1.0 - smoothstep(R, 0.995, r);
  float haloA = ring * ring * (0.10 + 0.12 * uEnergy + 0.10 * uLevel) * (1.0 - disc);
  vec3  haloC = mix(mix(uC1, uC0, 0.5 + 0.5 * p.x / max(r, 0.001)), uC2, 0.5 - 0.5 * p.y / max(r, 0.001));

  if (disc <= 0.0 && haloA <= 0.001) { gl_FragColor = vec4(0.0); return; }

  /* Sphere space */
  vec2  s  = p / R;
  float rr = min(length(s), 1.0);
  float z  = sqrt(max(1.0 - rr * rr, 0.0));
  vec3  n  = vec3(s, z);

  /* Glass lens: the centre magnifies, the rim compresses. */
  vec2 q = s * (1.0 - 0.32 * z);

  /* Rotation (accumulated) + a thinking-state twist toward the core. */
  q = rot(q, uSpin + uSwirl * 1.5 * (1.0 - rr));

  /* Domain warp through a slow circular path in noise space. */
  vec2 o1 = vec2(cos(t * 0.35), sin(t * 0.45)) * 1.6;
  vec2 o2 = vec2(sin(t * 0.30 + 1.0), cos(t * 0.40 + 2.0)) * 1.6;
  vec2 w  = vec2(noise(q * 1.45 + o1), noise(q * 1.45 + o2 + 4.0)) - 0.5;
  q += w * (0.50 + 0.55 * uEnergy + 0.35 * uLevel);

  /* Colour blobs drifting on lissajous paths */
  float sg = 0.50 + 0.10 * uEnergy + 0.08 * uLevel;
  float a0 = blob(q, 0.52 * vec2(cos(t * 0.50),       sin(t * 0.65)),       sg);
  float a1 = blob(q, 0.52 * vec2(cos(t * 0.40 + 2.1), sin(t * 0.55 + 1.3)), sg);
  float a2 = blob(q, 0.52 * vec2(cos(t * 0.60 + 4.2), sin(t * 0.45 + 3.7)), sg);
  float a3 = blob(q, 0.46 * vec2(cos(t * 0.35 + 5.0), sin(t * 0.50 + 0.4)), sg * 0.9);
  float sum = a0 + a1 + a2 + a3 + 1e-4;
  vec3  bc  = (uC0 * a0 + uC1 * a1 + uC2 * a2 + uC3 * a3) / sum;

  vec3 baseL = vec3(0.975, 0.962, 0.995);   /* pearl */
  vec3 baseD = vec3(0.105, 0.080, 0.175);   /* night violet */
  vec3 base  = mix(baseL, baseD, uDark);
  float cover = smoothstep(0.0, 1.1, sum) * (0.72 + 0.18 * uDark);
  vec3 col = mix(base, bc, cover);

  /* Aurora strands — three thin glowing ribbons */
  vec3 sc = vec3(0.0);
  float amp = 0.20 + 0.16 * uEnergy + 0.18 * uLevel;
  float wid = 0.030 + 0.014 * uEnergy + 0.012 * uLevel;
  for (int k = 0; k < 3; k++) {
    float fk = float(k);
    float y = q.y
      + amp * sin(q.x * 2.1 + t * (0.60 + 0.15 * fk) + fk * 2.3)
      + 0.09 * sin(q.x * 4.6 - t * (0.90 - 0.10 * fk) + fk * 1.7);
    float d = abs(y - (fk - 1.0) * 0.30);
    float b = wid / (d + wid);
    b = b * b;
    vec3 kc = k == 0 ? mix(uC3, uC2, 0.35) : (k == 1 ? mix(uC1, vec3(1.0), 0.25) : mix(uC0, uC3, 0.3));
    sc += kc * b;
  }
  /* strands fade toward the rim, like light inside glass */
  sc *= uStrands * (0.35 + 0.65 * z);
  col = col + sc * (0.42 + 0.18 * uDark) * (1.0 - 0.35 * col);

  /* Inner glass shading */
  vec3  L    = normalize(vec3(-0.45, 0.55, 0.72));
  float diff = dot(n, L);
  col *= 0.90 + 0.14 * diff;
  float edge = pow(1.0 - z, 2.0);
  col = mix(col, uC1 * (0.75 + 0.25 * uDark), edge * (0.22 - 0.06 * uDark));
  /* coral bounce light from below-right */
  col += uC0 * 0.14 * smoothstep(0.25, 1.0, dot(s, vec2(0.55, -0.70))) * (0.6 + 0.4 * z);

  /* Fresnel rim + specular */
  float fres = pow(1.0 - z, 3.2);
  vec3  rimC = mix(vec3(1.0, 0.985, 1.0), vec3(0.86, 0.84, 1.0), uDark);
  col = mix(col, rimC, fres * (0.45 + 0.12 * uDark));
  vec3  h    = normalize(L + vec3(0.0, 0.0, 1.0));
  float spec = pow(max(dot(n, h), 0.0), 38.0);
  col += vec3(1.0) * spec * 0.22;
  /* broad soft sheen, top-left */
  vec2  sh = s - vec2(-0.30, 0.42);
  col += vec3(1.0) * 0.10 * exp(-dot(sh, sh) * 5.0);

  /* Grade */
  float lum = dot(col, vec3(0.299, 0.587, 0.114));
  col = mix(vec3(lum), col, uSat) * uBright;
  col = clamp(col, 0.0, 1.0);

  /* Premultiplied out: sphere over halo */
  float a = disc;
  vec3  pc = col * a + haloC * haloA;
  float pa = a + haloA;
  gl_FragColor = vec4(pc, pa);
}
`;

  /* ── fallback styles (injected once) ───────────────────────── */
  const FB_CSS = `
html:not(#_):not(#_):not(#_) body:not(#_):not(#_):not(#_) .cxo-fb {
  position: absolute !important; inset: 5% !important; border-radius: 50% !important;
  overflow: hidden !important; clip-path: circle(50% at 50% 50%) !important;
  -webkit-mask-image: -webkit-radial-gradient(white, black) !important;
  isolation: isolate; pointer-events: none;
  background: radial-gradient(circle at 50% 42%, #fdfbff 0%, #f1ebfb 55%, #e2d6f6 100%) !important;
  box-shadow: inset 0 0 0 1px rgba(255,255,255,.55), inset 0 -14px 30px rgba(124,58,237,.18), inset 0 10px 22px rgba(255,255,255,.55) !important;
  transform: scale(var(--cxo-s, 1)); will-change: transform;
}
html[data-theme="dark"]:not(#_):not(#_):not(#_) body:not(#_):not(#_):not(#_) .cxo-fb {
  background: radial-gradient(circle at 50% 42%, #2b2140 0%, #1b1430 60%, #120c22 100%) !important;
  box-shadow: inset 0 0 0 1px rgba(220,210,255,.18), inset 0 -14px 30px rgba(124,58,237,.30) !important;
}
html:not(#_):not(#_):not(#_) body:not(#_):not(#_):not(#_) .cxo-fb > i {
  position: absolute !important; left: 15%; top: 15%; width: 70%; height: 70%;
  border-radius: 50% !important; overflow: visible !important; will-change: transform, opacity;
}
html:not(#_):not(#_):not(#_) body:not(#_):not(#_):not(#_) .cxo-fb > .b0 { background: radial-gradient(closest-side, rgba(236,98,72,.85), rgba(236,98,72,.35) 55%, rgba(236,98,72,0)); }
html:not(#_):not(#_):not(#_) body:not(#_):not(#_):not(#_) .cxo-fb > .b1 { background: radial-gradient(closest-side, rgba(124,58,237,.80), rgba(124,58,237,.32) 55%, rgba(124,58,237,0)); }
html:not(#_):not(#_):not(#_) body:not(#_):not(#_):not(#_) .cxo-fb > .b2 { background: radial-gradient(closest-side, rgba(6,182,212,.80), rgba(6,182,212,.30) 55%, rgba(6,182,212,0)); }
html:not(#_):not(#_):not(#_) body:not(#_):not(#_):not(#_) .cxo-fb > .b3 { background: radial-gradient(closest-side, rgba(244,114,182,.80), rgba(244,114,182,.30) 55%, rgba(244,114,182,0)); }
html:not(#_):not(#_):not(#_) body:not(#_):not(#_):not(#_) .cxo-fb > .gl {
  left: 0; top: 0; width: 100%; height: 100%;
  background:
    radial-gradient(ellipse 42% 30% at 34% 24%, rgba(255,255,255,.78), rgba(255,255,255,0) 70%),
    radial-gradient(circle at 50% 50%, rgba(255,255,255,0) 62%, rgba(255,255,255,.55) 97%, rgba(255,255,255,.2) 100%);
}
`;
  function injectFallbackCss() {
    if (document.getElementById('cxo-style')) return;
    const st = document.createElement('style');
    st.id = 'cxo-style';
    st.textContent = FB_CSS;
    (document.head || document.documentElement).appendChild(st);
  }

  /* ── GL setup ──────────────────────────────────────────────── */
  function compile(gl, type, src) {
    const sh = gl.createShader(type);
    if (!sh) return null;
    gl.shaderSource(sh, src);
    gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS) && !gl.isContextLost()) {
      console.warn('[ClavisOrb] shader compile failed:', gl.getShaderInfoLog(sh));
      gl.deleteShader(sh);
      return null;
    }
    return sh;
  }
  function buildGL(canvas) {
    const attrs = {
      alpha: true, premultipliedAlpha: true, antialias: false, depth: false, stencil: false,
      preserveDrawingBuffer: false, powerPreference: 'low-power', failIfMajorPerformanceCaveat: false,
    };
    let gl = null;
    try { gl = canvas.getContext('webgl', attrs) || canvas.getContext('experimental-webgl', attrs); } catch (_) { gl = null; }
    if (!gl) return null;
    const vs = compile(gl, gl.VERTEX_SHADER, VERT);
    const fs = compile(gl, gl.FRAGMENT_SHADER, FRAG);
    if (!vs || !fs) return null;
    const prog = gl.createProgram();
    gl.attachShader(prog, vs);
    gl.attachShader(prog, fs);
    gl.bindAttribLocation(prog, 0, 'aPos');
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS) && !gl.isContextLost()) {
      console.warn('[ClavisOrb] program link failed:', gl.getProgramInfoLog(prog));
      return null;
    }
    gl.useProgram(prog);
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    // One oversized triangle covers the viewport — no seam down the diagonal.
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.disable(gl.BLEND);
    gl.disable(gl.DEPTH_TEST);
    gl.clearColor(0, 0, 0, 0);
    const U = {};
    ['uRes', 'uTime', 'uSpin', 'uEnergy', 'uRadius', 'uSwirl', 'uBright', 'uSat', 'uStrands', 'uLevel', 'uDark', 'uC0', 'uC1', 'uC2', 'uC3']
      .forEach((k) => { U[k] = gl.getUniformLocation(prog, k); });
    return { gl, prog, buf, U };
  }

  /* ── the orb ───────────────────────────────────────────────── */
  function createOrb(target, userOpts = {}) {
    const host = typeof target === 'string' ? document.getElementById(target) : target;
    if (!host) return null;
    const opts = Object.assign({ colors: DEFAULT_COLORS }, userOpts || {});

    let alive = true;
    let state = 'idle', pulseUntil = 0;
    let cols = palette(opts.colors);
    const cur = Object.assign({}, LOOKS.idle, { dark: isDark() ? 1 : 0, level: 0 });
    let phase = Math.random() * 40;        // start somewhere different each time
    let spin = 0;
    let breathPh = 0;
    let levelTarget = 0;
    let lastPropsAt = 0;
    let speedMul = 1;
    let lastT = 0;
    let lastDraw = 0;
    let raf = 0;
    let visible = true;
    let mode = 'webgl';
    let ctx = null;
    let canvas = null;
    let fb = null;
    let bw = 0, bh = 0;

    // Clean the host the same way the old orb did.
    while (host.firstChild) host.removeChild(host.firstChild);
    host.style.background = 'transparent';
    host.style.border = 'none';
    host.style.boxShadow = 'none';
    host.style.outline = '';
    if (getComputedStyle(host).position === 'static') host.style.position = 'relative';
    if (!host.hasAttribute('tabindex')) host.setAttribute('tabindex', '0');
    if (!host.hasAttribute('role')) host.setAttribute('role', 'button');
    if (!host.hasAttribute('aria-label')) host.setAttribute('aria-label', 'Rudra24 AI — click to speak or interrupt');

    /* ---- WebGL path ---- */
    function startWebGL() {
      canvas = document.createElement('canvas');
      canvas.className = 'cxo-canvas';
      canvas.setAttribute('aria-hidden', 'true');
      canvas.style.cssText = 'display:block;width:100%;height:100%;background:transparent;border:none;box-shadow:none;outline:none;border-radius:50%;';
      ctx = buildGL(canvas);
      if (!ctx) { canvas = null; return false; }
      canvas.addEventListener('webglcontextlost', onLost, false);
      canvas.addEventListener('webglcontextrestored', onRestored, false);
      host.appendChild(canvas);
      mode = 'webgl';
      host.setAttribute('data-orb-mode', 'webgl');
      resize();
      return true;
    }
    function onLost(e) {
      e.preventDefault();
      cancelAnimationFrame(raf); raf = 0;
      ctx = null;
    }
    function onRestored() {
      if (!alive || !canvas) return;
      ctx = buildGL(canvas);
      if (!ctx) { teardownCanvas(); startFallback(); }
      bw = bh = 0;
      resize();
      kick();
    }
    function teardownCanvas() {
      if (!canvas) return;
      canvas.removeEventListener('webglcontextlost', onLost);
      canvas.removeEventListener('webglcontextrestored', onRestored);
      try { ctx?.gl.getExtension('WEBGL_lose_context')?.loseContext(); } catch (_) {}
      canvas.remove();
      canvas = null; ctx = null;
    }

    /* ---- fallback path ---- */
    function startFallback() {
      injectFallbackCss();
      fb = document.createElement('div');
      fb.className = 'cxo-fb';
      fb.setAttribute('aria-hidden', 'true');
      fb.innerHTML = '<i class="b0"></i><i class="b1"></i><i class="b2"></i><i class="b3"></i><i class="gl"></i>';
      host.appendChild(fb);
      mode = 'fallback';
      host.setAttribute('data-orb-mode', 'fallback');
    }

    /* ---- sizing ----
     * The host's size comes from the ResizeObserver below, which is HANDED
     * the box — reading it costs nothing. host.clientWidth is a layout read
     * and is only the cold-start fallback; calling it every frame forced a
     * full reflow whenever anything else on the page moved (measured at
     * 57ms/frame while dragging a window). */
    let hostW = 0, hostH = 0;
    function resize() {
      if (!canvas || !ctx) return;
      const w = hostW || host.clientWidth, h = hostH || host.clientHeight;
      if (!w || !h) return;
      const d = maxDpr();
      const nw = Math.max(1, Math.round(w * d)), nh = Math.max(1, Math.round(h * d));
      if (nw === bw && nh === bh) return;
      bw = nw; bh = nh;
      canvas.width = nw; canvas.height = nh;
      ctx.gl.viewport(0, 0, nw, nh);
    }

    /* ---- frame ---- */
    function lookTarget() {
      if (state === 'idle' && isAsleep()) return LOOKS.asleep;
      return LOOKS[state] || LOOKS.idle;
    }
    function step(now) {
      const dt = lastT ? Math.min(0.1, Math.max(0, (now - lastT) / 1000)) : 1 / 60;
      lastT = now;
      const tgt = lookTarget();
      // Critically-damped-ish easing: ~420 ms to settle between states.
      const k = 1 - Math.exp(-dt / 0.24);
      for (const key of KEYS) cur[key] += (tgt[key] - cur[key]) * k;
      cur.dark += ((isDark() ? 1 : 0) - cur.dark) * (1 - Math.exp(-dt / 0.35));
      // Live level: quick attack, softer release; decays if the feed stops.
      if (now - lastPropsAt > 450) { levelTarget = 0; speedMul += (1 - speedMul) * k; }
      const targetLevel = Math.max(levelTarget, now < pulseUntil ? 0.9 : 0);
      const lk = 1 - Math.exp(-dt / (targetLevel > cur.level ? 0.06 : 0.22));
      cur.level += (targetLevel - cur.level) * lk;

      const calm = reducedMotion() ? 0.35 : 1;
      const rate = cur.rate * speedMul * (1 + 0.55 * cur.level) * calm;
      phase = (phase + dt * rate) % WRAP;
      spin = (spin + dt * cur.spin * calm) % TAU;
      breathPh = (breathPh + dt * (TAU / 5.2)) % TAU;   // one calm breath ≈ 5 s
      return Math.sin(breathPh) * 0.012 * cur.breath * calm;
    }
    function drawGL(breath) {
      const { gl, U } = ctx;
      if (gl.isContextLost()) return;
      gl.viewport(0, 0, bw, bh);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.uniform2f(U.uRes, bw, bh);
      gl.uniform1f(U.uTime, phase);
      gl.uniform1f(U.uSpin, spin);
      gl.uniform1f(U.uEnergy, cur.energy);
      gl.uniform1f(U.uRadius, cur.radius * (1 + breath));
      gl.uniform1f(U.uSwirl, cur.swirl);
      gl.uniform1f(U.uBright, cur.bright);
      gl.uniform1f(U.uSat, cur.sat);
      gl.uniform1f(U.uStrands, cur.strands);
      gl.uniform1f(U.uLevel, cur.level);
      gl.uniform1f(U.uDark, cur.dark);
      gl.uniform3fv(U.uC0, cols[0]);
      gl.uniform3fv(U.uC1, cols[1]);
      gl.uniform3fv(U.uC2, cols[2]);
      gl.uniform3fv(U.uC3, cols[3]);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }
    const PATHS = [[0.50, 0.65, 0.0, 0.0], [0.40, 0.55, 2.1, 1.3], [0.60, 0.45, 4.2, 3.7], [0.35, 0.50, 5.0, 0.4]];
    function drawFallback(breath) {
      if (!fb) return;
      const t = phase;
      const spread = 24 + 10 * cur.energy + 8 * cur.level;
      const kids = fb.children;
      for (let i = 0; i < 4; i++) {
        const [fx, fy, px, py] = PATHS[i];
        const x = Math.cos(t * fx + px + spin) * spread;
        const y = Math.sin(t * fy + py + spin) * spread;
        kids[i].style.transform = `translate3d(${x.toFixed(2)}%, ${(-y).toFixed(2)}%, 0) scale(${(1 + 0.12 * cur.energy).toFixed(3)})`;
      }
      const s = (cur.radius / 0.9) * (1 + breath) + 0.035 * cur.level;
      fb.style.setProperty('--cxo-s', s.toFixed(4));
      fb.style.opacity = String(clamp(0.72 + 0.28 * cur.bright, 0, 1).toFixed(3));
    }
    function frame(now) {
      raf = 0;
      if (!alive) return;
      if (!visible || document.hidden) { lastT = 0; return; }   // resumes via kick()
      raf = requestAnimationFrame(frame);
      // Cap at 60 fps on high-refresh screens (and honour a legacy per-state cap).
      const legacy = window.__clavisOrbFps && window.__clavisOrbFps[state === 'idle' ? 'idle' : 'active'];
      const cap = Math.min(60, num(legacy, 60));
      if (lastDraw && now - lastDraw < 1000 / cap - 2) return;
      lastDraw = now;
      const breath = step(now);
      if (mode === 'webgl' && ctx) {
        if (hostW && hostH) {
          const d = maxDpr();
          if (Math.round(hostW * d) !== bw || Math.round(hostH * d) !== bh) resize();
        } else if (!bw || !bh) {
          resize();   // cold start: no size known yet, observer not fired
        }
        drawGL(breath);
      }
      else if (mode === 'fallback') drawFallback(breath);
    }
    function kick() {
      if (!alive || raf) return;
      if (!visible || document.hidden) return;
      lastT = 0;
      raf = requestAnimationFrame(frame);
    }

    /* ---- observers ---- */
    const onVis = () => kick();
    document.addEventListener('visibilitychange', onVis);
    const onWinResize = () => { resize(); kick(); };
    window.addEventListener('resize', onWinResize);
    let ro = null;
    if (typeof ResizeObserver !== 'undefined') {
      ro = new ResizeObserver((entries) => {
        const box = entries[0] && entries[0].contentRect;
        if (box && box.width && box.height) { hostW = box.width; hostH = box.height; }
        resize(); kick();
      });
      ro.observe(host);
    }
    let io = null;
    if (typeof IntersectionObserver !== 'undefined') {
      io = new IntersectionObserver((ents) => {
        visible = !!ents[ents.length - 1]?.isIntersecting;
        if (visible) kick();
      });
      io.observe(host);
    }
    let mo = null;
    if (typeof MutationObserver !== 'undefined') {
      mo = new MutationObserver((muts) => {
        for (const m of muts) {
          if (m.type === 'attributes' && m.attributeName === 'data-orb-state') {
            api.setState(host.getAttribute('data-orb-state') || 'IDLE');
          }
        }
      });
      mo.observe(host, { attributes: true, attributeFilter: ['data-orb-state'] });
    }
    // Keyboard: Enter / Space act like a click (the focus ring is in CSS).
    const onKey = (e) => {
      if (e.target !== host) return;
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); host.click(); }
    };
    host.addEventListener('keydown', onKey);

    /* ---- API ---- */
    const api = {
      pulse() { pulseUntil = performance.now() + 650; kick(); },
      setProps(p) {
        if (!p || typeof p !== 'object') return;
        if (Array.isArray(p.colors)) cols = palette(p.colors);
        const hasAmp = typeof p.amplitude === 'number', hasInt = typeof p.intensity === 'number', hasSpd = typeof p.speed === 'number';
        if (!hasAmp && !hasInt && !hasSpd) return;
        // clavis-live.js sends speaking {speed .19–.26, amplitude 1.35–2.25,
        // intensity .36–.64} and listening {.11–.18, 1.05–1.95, .26–.54}.
        const talk = state === 'speaking';
        const baseAmp = talk ? 1.35 : 1.05, baseInt = talk ? 0.36 : 0.26, baseSpd = talk ? 0.19 : 0.11;
        let lv = 0, nlv = 0;
        if (hasAmp) { lv += clamp((p.amplitude - baseAmp) / 0.9, 0, 1); nlv++; }
        if (hasInt) { lv += clamp((p.intensity - baseInt) / 0.28, 0, 1); nlv++; }
        if (nlv) levelTarget = clamp(lv / nlv, 0, 1) * (talk ? 1 : 0.6);
        if (hasSpd) speedMul = clamp(p.speed / baseSpd, 0.6, 1.6);
        lastPropsAt = performance.now();
        kick();
      },
      setState(s) {
        let v = String(s || '').toLowerCase();
        if (v === 'awake') v = 'listening';
        if (!LOOKS[v] || v === 'asleep') v = 'idle';
        if (v !== state) {
          state = v;
          if (v !== 'speaking' && v !== 'listening') { levelTarget = 0; speedMul = 1; }
        }
        host.setAttribute('data-orb-look', v);
        kick();
      },
      destroy() {
        if (!alive) return;
        alive = false;
        cancelAnimationFrame(raf); raf = 0;
        io && io.disconnect(); ro && ro.disconnect(); mo && mo.disconnect();
        document.removeEventListener('visibilitychange', onVis);
        window.removeEventListener('resize', onWinResize);
        host.removeEventListener('keydown', onKey);
        teardownCanvas();
        fb && fb.remove(); fb = null;
        host.removeAttribute('data-orb-mode');
      },
      get state() { return state; },
      get mode() { return mode; },
    };

    if (!startWebGL()) startFallback();
    api.setState(host.getAttribute('data-orb-state') || 'IDLE');
    kick();
    return api;
  }

  /* ── global ────────────────────────────────────────────────── */
  const Orb = {
    create: createOrb,
    instance: null,
    init(target = 'orb-container', opts = {}) {
      if (Orb.instance) { try { Orb.instance.destroy(); } catch (_) {} Orb.instance = null; }
      const inst = createOrb(target, opts);
      Orb.instance = inst;
      return inst;
    },
    version: '4.0',
  };
  window.StrandsOrb = Orb;
  window.ClavisOrb = Orb;

  if (typeof document !== 'undefined') {
    const boot = () => setTimeout(() => {
      if (document.getElementById('orb-container') && !Orb.instance) Orb.init('orb-container');
    }, 50);
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true });
    else boot();
  }
})();
