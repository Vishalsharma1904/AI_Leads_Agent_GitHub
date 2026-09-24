import { Renderer, Program, Mesh, Color, Triangle, RenderTarget } from 'ogl';

const MAX_STRANDS = 12;
const MAX_COLORS = 8;

const VERT = `#version 300 es
in vec2 position;
void main() {
  gl_Position = vec4(position, 0.0, 1.0);
}
`;

const FRAG = `#version 300 es
precision highp float;

uniform float uTime;
uniform vec2 uResolution;
uniform vec3 uColors[${MAX_COLORS}];
uniform int uColorCount;
uniform int uStrandCount;
uniform float uSpeed;
uniform float uAmplitude;
uniform float uWaviness;
uniform float uThickness;
uniform float uGlow;
uniform float uTaper;
uniform float uSpread;
uniform float uHueShift;
uniform float uIntensity;
uniform float uOpacity;
uniform float uScale;
uniform float uSaturation;

out vec4 fragColor;

const float PI = 3.14159265;

vec3 spectrum(float t) {
  return 0.5 + 0.5 * cos(2.0 * PI * (t + vec3(0.00, 0.33, 0.67)));
}

vec3 samplePalette(float t) {
  t = fract(t);
  float scaled = t * float(uColorCount);
  int idx = int(floor(scaled));
  float blend = fract(scaled);
  int nextIdx = idx + 1;
  if (nextIdx >= uColorCount) nextIdx = 0;
  return mix(uColors[idx], uColors[nextIdx], blend);
}

vec3 strandColor(float t) {
  if (uColorCount > 0) return samplePalette(t);
  return spectrum(t);
}

void main() {
  vec2 uv = (gl_FragCoord.xy - 0.5 * uResolution) / uResolution.y;
  uv /= max(uScale, 0.0001);

  float e = 0.06 + uIntensity * 0.94;
  float env = pow(max(cos(uv.x * PI * 1.3), 0.0), uTaper);

  vec3 col = vec3(0.0);

  for (int i = 0; i < ${MAX_STRANDS}; i++) {
    if (i >= uStrandCount) break;

    float fi = float(i);
    float ph = fi * 1.7 * uSpread;
    float freq = (2.0 + fi * 0.35) * uWaviness;
    float spd = 1.4 + fi * 1.2;

    float tt = uTime * uSpeed;
    float w = sin(uv.x * freq + tt * spd + ph) * 0.60
            + sin(uv.x * freq * 1.1 - tt * spd * 0.7 + ph * 1.7) * 0.40;

    float amp = (0.1 + 0.02 * e) * env * uAmplitude;
    float y = w * amp;

    float d = abs(uv.y - y);
    float thick = (0.001 + 0.05 * e) * (0.35 + env) * uThickness;
    float g = thick / (d + thick * 0.45);
    g = g * g;

    float h = fi / float(uStrandCount) + uv.x * 0.30 + uTime * 0.04 + uHueShift;
    col += strandColor(h) * g * env;
  }

  col *= 0.45 + 0.7 * e;
  col = 1.0 - exp(-col * uGlow);

  float gray = dot(col, vec3(0.2126, 0.7152, 0.0722));
  col = max(mix(vec3(gray), col, uSaturation), 0.0);

  float lum = max(max(col.r, col.g), col.b);
  float alpha = clamp(lum, 0.0, 1.0) * uOpacity;

  fragColor = vec4(col * uOpacity, alpha);
}
`;

const GLASS_FRAG = `#version 300 es
precision highp float;

uniform sampler2D uScene;
uniform vec2 uResolution;
uniform float uRadius;
uniform float uRefraction;
uniform float uDispersion;

out vec4 fragColor;

vec2 toUv(vec2 p) {
  return p * (uResolution.y / uResolution) + 0.5;
}

void main() {
  vec2 p = (gl_FragCoord.xy - 0.5 * uResolution) / uResolution.y;
  float d = length(p);
  float r = uRadius;

  float edge = fwidth(d) * 1.5;
  float mask = 1.0 - smoothstep(r - edge, r + edge, d);
  if (mask <= 0.0) {
    fragColor = vec4(0.0);
    return;
  }

  // sphere height: 0 at the rim, 1 at the center
  float z = sqrt(max(r * r - d * d, 0.0)) / r;
  float nd = d / r; // 0 at the center, 1 at the rim

  // refraction is confined to a narrow band near the rim; the rest stays undistorted
  vec2 dir = d > 0.0 ? p / d : vec2(0.0);
  float lens = smoothstep(0.85, 1.0, nd) * pow(nd, 6.0);
  vec2 offset = -dir * lens * uRefraction * 0.15;
  vec2 disp = -dir * lens * uDispersion * 0.012;

  vec3 light;
  light.r = texture(uScene, toUv(p + offset - disp)).r;
  light.g = texture(uScene, toUv(p + offset)).g;
  light.b = texture(uScene, toUv(p + offset + disp)).b;

  // neutral fresnel rim (no color tint so the glass stays clear)
  float fres = pow(1.0 - z, 3.0);
  vec3 rim = vec3(1.0) * fres * 0.18;

  // specular highlight from the upper-left
  vec2 lightDir = normalize(vec2(-0.55, 0.6));
  float spec = pow(max(dot(p / max(r, 1e-4), lightDir), 0.0), 6.0);
  spec *= smoothstep(r, r * 0.55, d);

  vec3 emissive = light + rim + vec3(spec) * 0.4;
  float emissiveA = clamp(max(max(emissive.r, emissive.g), emissive.b), 0.0, 1.0);

  // almost clear glass body: only a faint neutral darkening, mostly near the rim
  float bodyA = 0.05 + fres * 0.05;

  // composite emissive light over the clear body (premultiplied)
  float outA = emissiveA + bodyA * (1.0 - emissiveA);
  vec3 outRGB = emissive;

  outRGB *= mask;
  outA *= mask;

  fragColor = vec4(outRGB, outA);
}
`;

const buildPalette = colors => {
  const filled = colors && colors.length ? colors : ['#ffffff'];
  const padded = [];
  for (let i = 0; i < MAX_COLORS; i++) {
    const hex = filled[i] ?? filled[filled.length - 1];
    const c = new Color(hex);
    padded.push([c.r, c.g, c.b]);
  }
  return padded;
};

// Default props exactly as specified by user
const DEFAULT_CONFIG = {
  colors: ["#ec6248", "#7C3AED", "#06B6D4"],
  count: 7,
  speed: 0.2,
  amplitude: 1.4,
  waviness: 2.7,
  thickness: 4,
  glow: 0.85,
  taper: 1.8,
  spread: 1.6,
  intensity: 0.3,
  saturation: 1.5,
  opacity: 1,
  scale: 2,
  glass: true,
  refraction: 0.15,
  dispersion: 0.35,
  glassSize: 0.41,
  hueShift: 1
};

function createStrandsOrb(container, userProps = {}) {
  const ctn = typeof container === 'string' ? document.getElementById(container) : container;
  if (!ctn) return null;

  const props = Object.assign({}, DEFAULT_CONFIG, userProps);

  let renderer;
  try {
    renderer = new Renderer({
      alpha: true,
      premultipliedAlpha: true,
      antialias: true,
      dpr: Math.min(window.devicePixelRatio || 1, 2)
    });
  } catch (err) {
    console.warn('[StrandsOrb] WebGL2 not supported or failed to init:', err);
    return null;
  }

  const gl = renderer.gl;
  gl.clearColor(0, 0, 0, 0);
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
  gl.canvas.style.backgroundColor = 'transparent';
  gl.canvas.style.width = '100%';
  gl.canvas.style.height = '100%';
  gl.canvas.style.display = 'block';

  const geometry = new Triangle(gl);
  if (geometry.attributes.uv) {
    delete geometry.attributes.uv;
  }

  const width = Math.max(ctn.offsetWidth || 220, 220);
  const height = Math.max(ctn.offsetHeight || 220, 220);

  const program = new Program(gl, {
    vertex: VERT,
    fragment: FRAG,
    uniforms: {
      uTime: { value: 0 },
      uResolution: { value: [width, height] },
      uColors: { value: buildPalette(props.colors) },
      uColorCount: { value: Math.min(props.colors.length, MAX_COLORS) },
      uStrandCount: { value: Math.min(props.count, MAX_STRANDS) },
      uSpeed: { value: props.speed },
      uAmplitude: { value: props.amplitude },
      uWaviness: { value: props.waviness },
      uThickness: { value: props.thickness },
      uGlow: { value: props.glow },
      uTaper: { value: props.taper },
      uSpread: { value: props.spread },
      uHueShift: { value: props.hueShift },
      uIntensity: { value: props.intensity },
      uOpacity: { value: props.opacity },
      uScale: { value: props.scale },
      uSaturation: { value: props.saturation }
    }
  });

  const mesh = new Mesh(gl, { geometry, program });

  const renderTarget = new RenderTarget(gl, {
    width: width,
    height: height
  });

  // Calculate radius: fill canvas edge-to-edge (~0.46) so the sphere is large (200px+) matching Image 2
  const calcRadius = (gs) => 0.46 * (gs >= 0.9 ? gs : 1.0);

  const glassProgram = new Program(gl, {
    vertex: VERT,
    fragment: GLASS_FRAG,
    uniforms: {
      uScene: { value: renderTarget.texture },
      uResolution: { value: [width, height] },
      uRadius: { value: calcRadius(props.glassSize) },
      uRefraction: { value: props.refraction },
      uDispersion: { value: props.dispersion }
    }
  });
  const glassMesh = new Mesh(gl, { geometry, program: glassProgram });

  // Clear previous elements inside container and remove any border/background
  while (ctn.firstChild) {
    ctn.removeChild(ctn.firstChild);
  }
  ctn.style.background = 'transparent';
  ctn.style.backgroundColor = 'transparent';
  ctn.style.border = 'none';
  ctn.style.boxShadow = 'none';
  ctn.style.outline = 'none';

  gl.canvas.style.backgroundColor = 'transparent';
  gl.canvas.style.border = 'none';
  gl.canvas.style.boxShadow = 'none';
  gl.canvas.style.outline = 'none';
  ctn.appendChild(gl.canvas);

  function resize() {
    if (!ctn) return;
    const w = Math.max(ctn.offsetWidth || 220, 220);
    const h = Math.max(ctn.offsetHeight || 220, 220);
    renderer.setSize(w, h);
    program.uniforms.uResolution.value = [w, h];
    renderTarget.setSize(w, h);
    glassProgram.uniforms.uResolution.value = [w, h];
  }

  window.addEventListener('resize', resize);
  resize();

  let animateId = 0;
  let running = true;

  const update = t => {
    if (!running) return;
    animateId = requestAnimationFrame(update);

    program.uniforms.uTime.value = t * 0.001;
    program.uniforms.uColors.value = buildPalette(props.colors);
    program.uniforms.uColorCount.value = Math.min(props.colors.length, MAX_COLORS);
    program.uniforms.uStrandCount.value = Math.min(Math.max(Math.round(props.count), 1), MAX_STRANDS);
    program.uniforms.uSpeed.value = props.speed;
    program.uniforms.uAmplitude.value = props.amplitude;
    program.uniforms.uWaviness.value = props.waviness;
    program.uniforms.uThickness.value = props.thickness;
    program.uniforms.uGlow.value = props.glow;
    program.uniforms.uTaper.value = props.taper;
    program.uniforms.uSpread.value = props.spread;
    program.uniforms.uHueShift.value = props.hueShift;
    program.uniforms.uIntensity.value = props.intensity;
    program.uniforms.uOpacity.value = props.opacity;
    program.uniforms.uScale.value = props.scale;
    program.uniforms.uSaturation.value = props.saturation;

    if (props.glass) {
      renderer.render({ scene: mesh, target: renderTarget });
      glassProgram.uniforms.uScene.value = renderTarget.texture;
      glassProgram.uniforms.uRefraction.value = props.refraction;
      glassProgram.uniforms.uDispersion.value = props.dispersion;
      glassProgram.uniforms.uRadius.value = calcRadius(props.glassSize);
      renderer.render({ scene: glassMesh });
    } else {
      renderer.render({ scene: mesh });
    }
  };
  animateId = requestAnimationFrame(update);

  const controller = {
    setProps: (newProps) => {
      Object.assign(props, newProps);
    },
    setState: (state) => {
      const s = (state || '').toLowerCase();
      if (s === 'speaking') {
        props.speed = 0.38;
        props.intensity = 0.48;
        props.amplitude = 1.8;
      } else if (s === 'listening') {
        props.speed = 0.28;
        props.intensity = 0.40;
        props.amplitude = 1.6;
      } else if (s === 'thinking') {
        props.speed = 0.42;
        props.intensity = 0.45;
        props.amplitude = 1.7;
      } else {
        props.speed = DEFAULT_CONFIG.speed;
        props.intensity = DEFAULT_CONFIG.intensity;
        props.amplitude = DEFAULT_CONFIG.amplitude;
      }
    },
    destroy: () => {
      running = false;
      if (observer) observer.disconnect();
      cancelAnimationFrame(animateId);
      window.removeEventListener('resize', resize);
      if (ctn && gl.canvas.parentNode === ctn) {
        ctn.removeChild(gl.canvas);
      }
      gl.getExtension('WEBGL_lose_context')?.loseContext();
    }
  };

  // Sync automatically with data-orb-state on container
  const observer = typeof MutationObserver !== 'undefined' ? new MutationObserver((mutations) => {
    for (const m of mutations) {
      if (m.type === 'attributes' && m.attributeName === 'data-orb-state') {
        const state = ctn.getAttribute('data-orb-state') || 'IDLE';
        controller.setState(state);
      }
    }
  }) : null;
  if (observer) {
    observer.observe(ctn, { attributes: true, attributeFilter: ['data-orb-state'] });
  }

  return controller;
}

window.StrandsOrb = {
  create: createStrandsOrb,
  instance: null,
  init: function(targetId = 'orb-container', config = {}) {
    if (window.StrandsOrb.instance) {
      window.StrandsOrb.instance.destroy();
      window.StrandsOrb.instance = null;
    }
    const inst = createStrandsOrb(targetId, config);
    window.StrandsOrb.instance = inst;
    return inst;
  }
};

// Auto-initialize when DOM is ready
if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      setTimeout(() => {
        if (document.getElementById('orb-container')) {
          window.StrandsOrb.init('orb-container');
        }
      }, 50);
    });
  } else {
    setTimeout(() => {
      if (document.getElementById('orb-container')) {
        window.StrandsOrb.init('orb-container');
      }
    }, 50);
  }
}
