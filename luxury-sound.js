/**
 * ============================================================
 *  NEXUS AUDIO ENGINE  v4 (Soothing & Ambient)
 *  Fully synthesised (zero assets) spatial UI sound design.
 *
 *  Signal chain
 *    voice → zone bus (tone shaping) ─┬→ master → soft-clip → comp → out
 *                                     └→ reverb send → convolver ─┘
 *
 *  Design Principles:
 *   · Warm fundamental frequencies (260–660 Hz), never piercing 1.2–3.5 kHz
 *   · 8-note harmonic pentatonic variations for organic, musical feel
 *   · Multi-layered acoustic synthesis (fundamental + warm body + velvet transient)
 *   · Smooth 6–12 ms attack to eliminate digital edge/clicks
 *   · Generated plate-reverb IR creates a serene, ambient spatial room
 *   · Zero harsh frequencies: band-limited low-pass filters on all buses
 *   · Event deduplication ensures single, crisp, satisfying feedback
 *
 *  Sonic zones
 *   · settings  — warm felt/marimba tap, wooden body, ambient reverb
 *   · ui        — soothing kalimba/water-drop tap, 8 harmonic variations
 *   · sidebar   — muted bamboo tap, gentle and non-fatiguing
 *   · composer  — soft tactile acoustic tap
 *   · pet       — organic creature: chirps, wingbeats, trills
 *
 *  Preserves the entire window.SoundFX API used throughout the application.
 * ============================================================
 */
'use strict';

(function NexusAudioEngine() {

  const LS = { enabled: 'lx-sound-enabled', theme: 'lx-sound-theme', volume: 'lx-sound-volume' };

  const isEnabled = () => localStorage.getItem(LS.enabled) !== 'false';
  const getTheme  = () => localStorage.getItem(LS.theme) || 'ambient';
  const getVolume = () => {
    const v = parseFloat(localStorage.getItem(LS.volume));
    return Number.isFinite(v) ? v : 0.6;
  };

  let ctx = null, master = null, comp = null, reverb = null, reverbGain = null;
  let audioUnlocked = false;
  const BUS = {};
  let voices = 0;
  const MAX_VOICES = 14;

  /* ── Soft-clip curve: rounds peaks instead of squaring them off ── */
  function softClipCurve() {
    const n = 1024, c = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const x = (i / (n - 1)) * 2 - 1;
      c[i] = Math.tanh(x * 1.6) * 0.86;
    }
    return c;
  }

  /* ── Generated plate-reverb impulse: noise with an exponential tail ── */
  function makeIR(seconds, decay, damp) {
    const len = Math.max(1, Math.floor(ctx.sampleRate * seconds));
    const buf = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      let lp = 0;
      for (let i = 0; i < len; i++) {
        const env = Math.pow(1 - i / len, decay);
        const white = Math.random() * 2 - 1;
        lp += (white - lp) * damp;              // one-pole LP → dark, silky tail
        d[i] = lp * env * (ch ? 0.92 : 1);      // slight stereo asymmetry
      }
    }
    return buf;
  }

  function bus({ type = 'lowpass', freq = 1600, q = 0.7, gain = 0.5, send = 0.25, pan = 0 }) {
    const g = ctx.createGain(); g.gain.value = gain;
    const f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
    const p = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
    if (p) p.pan.value = pan;
    const s = ctx.createGain(); s.gain.value = send;
    f.connect(g);
    if (p) { g.connect(p); p.connect(master); } else { g.connect(master); }
    g.connect(s); s.connect(reverbGain);
    return { input: f, gain: g };
  }

  function init() {
    if (ctx) return true;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return false;
    ctx = new AC();

    master = ctx.createGain();
    master.gain.value = getVolume() * 0.55;         // headroom: never blares

    const shaper = ctx.createWaveShaper();
    shaper.curve = softClipCurve();
    shaper.oversample = '4x';

    comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -22; comp.knee.value = 26;
    comp.ratio.value = 3.2; comp.attack.value = 0.004; comp.release.value = 0.22;

    master.connect(shaper); shaper.connect(comp); comp.connect(ctx.destination);

    reverb = ctx.createConvolver();
    reverb.buffer = makeIR(2.2, 2.8, 0.22);
    reverbGain = ctx.createGain(); reverbGain.gain.value = 1;
    const wet = ctx.createGain(); wet.gain.value = 0.44;
    const wetLP = ctx.createBiquadFilter(); wetLP.type = 'lowpass'; wetLP.frequency.value = 2400;
    reverbGain.connect(reverb); reverb.connect(wetLP); wetLP.connect(wet); wet.connect(master);

    // Zone character — warm, organic, soothing acoustic profile (zero shrill frequencies)
    BUS.settings = bus({ type: 'lowpass', freq: 1400, q: 0.5, gain: 0.48, send: 0.36, pan:  0.00 });
    BUS.ui       = bus({ type: 'lowpass', freq: 2100, q: 0.5, gain: 0.40, send: 0.26, pan:  0.02 });
    BUS.sidebar  = bus({ type: 'lowpass', freq: 1150, q: 0.5, gain: 0.28, send: 0.18, pan: -0.22 });
    BUS.composer = bus({ type: 'lowpass', freq: 1650, q: 0.5, gain: 0.32, send: 0.22, pan:  0.08 });
    BUS.pet      = bus({ type: 'bandpass', freq: 2000, q: 0.7, gain: 0.36, send: 0.24, pan:  0.20 });
    return true;
  }

  const unlock = () => {
    audioUnlocked = true;
    if (!init()) return;
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
  };
  ['pointerdown', 'keydown', 'touchstart'].forEach(ev =>
    window.addEventListener(ev, unlock, { once: false, passive: true, capture: true }));

  /* ── Voice helpers ─────────────────────────────────────────── */
  const rand = (a, b) => a + Math.random() * (b - a);
  const now = () => ctx.currentTime;

  function claim() {
    if (voices >= MAX_VOICES) return false;
    voices++;
    return true;
  }
  function release(node, at) {
    node.onended = () => { voices = Math.max(0, voices - 1); };
    setTimeout(() => { voices = Math.max(0, voices - 1); }, Math.max(60, at * 1000 + 120));
  }

  /**
   * One shaped partial. attack keeps the edge off; the exponential release
   * gives the illusion of physical acoustic resonance.
   */
  function partial(busName, { freq, type = 'sine', dur = 0.18, gain = 0.3, attack = 0.008,
                              bend = 0, delay = 0, detune = 0 }) {
    const b = BUS[busName] || BUS.ui;
    const t0 = now() + delay;
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    if (bend) osc.frequency.exponentialRampToValueAtTime(Math.max(40, freq * bend), t0 + dur);
    if (detune && osc.detune) osc.detune.value = detune;

    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.linearRampToValueAtTime(gain, t0 + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);

    osc.connect(g); g.connect(b.input);
    osc.start(t0); osc.stop(t0 + dur + 0.02);
    release(osc, delay + dur);
    return osc;
  }

  function noise(busName, { dur = 0.12, gain = 0.2, from = 1200, to = 400, q = 1.1, delay = 0, attack = 0.006 }) {
    const b = BUS[busName] || BUS.ui;
    const t0 = now() + delay;
    const len = Math.max(1, Math.floor(ctx.sampleRate * dur));
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = ctx.createBufferSource(); src.buffer = buf;

    const f = ctx.createBiquadFilter();
    f.type = 'bandpass'; f.Q.value = q;
    f.frequency.setValueAtTime(from, t0);
    f.frequency.exponentialRampToValueAtTime(Math.max(80, to), t0 + dur);

    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.linearRampToValueAtTime(gain, t0 + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);

    src.connect(f); f.connect(g); g.connect(b.input);
    src.start(t0); src.stop(t0 + dur + 0.02);
    release(src, delay + dur);
  }

  /* ── Round-robin so consecutive presses differ, like real sample libs ── */
  const rr = {};
  function nextVariant(key, count) {
    rr[key] = ((rr[key] || 0) + 1) % count;
    return rr[key];
  }

  /* ══════════════ THE SOUNDS ══════════════ */

  // Scales for soothing, harmonically pleasant micro-variations
  const SCALE_AMBIENT = [329.63, 369.99, 392.00, 440.00, 493.88, 523.25, 587.33, 659.25]; // E4, F#4, G4, A4, B4, C5, D5, E5
  const SCALE_CRYSTAL = [587.33, 659.25, 783.99, 880.00, 987.77, 1046.50];                // D5, E5, G5, A5, B5, C6
  const SCALE_SETTINGS = [261.63, 293.66, 329.63, 392.00, 440.00];                          // C4, D4, E4, G4, A4
  const SCALE_SIDEBAR  = [392.00, 440.00, 493.88, 523.25];                                  // G4, A4, B4, C5

  // General UI: warm, organic, tactile acoustic tap with 8-note pentatonic variations
  function uiTick(zone) {
    const theme = getTheme();
    const b = zone || 'ui';

    if (theme === 'crystal') {
      const v = nextVariant('crys', SCALE_CRYSTAL.length);
      const base = SCALE_CRYSTAL[v] * rand(0.996, 1.004);
      partial(b, { freq: base,        type: 'sine', dur: 0.15, gain: 0.14 * rand(0.92, 1.08), attack: 0.008, bend: 0.992 });
      partial(b, { freq: base * 1.5,  type: 'sine', dur: 0.08, gain: 0.035, attack: 0.006, delay: 0.012 });
      return;
    }

    if (theme === 'minimal') {
      const base = [280, 310, 260, 330][nextVariant('min', 4)] * rand(0.995, 1.005);
      partial(b, { freq: base, type: 'sine', dur: 0.045, gain: 0.14 * rand(0.92, 1.08), attack: 0.005, bend: 0.97 });
      return;
    }

    // Default & Flagship: Ambient — warm wooden/kalimba tap with subtle tactile transient
    const v = nextVariant('ui', SCALE_AMBIENT.length);
    const base = SCALE_AMBIENT[v] * rand(0.995, 1.005);

    // Layer 1: Warm fundamental body
    partial(b, { freq: base,        type: 'sine',     dur: 0.078, gain: 0.22 * rand(0.92, 1.08), attack: 0.007, bend: 0.985 });
    // Layer 2: Acoustic body undertone (felt depth)
    partial(b, { freq: base * 0.5,  type: 'triangle', dur: 0.052, gain: 0.038, attack: 0.010 });
    // Layer 3: Subtle harmonic overtone (hollow wood/glass bloom)
    partial(b, { freq: base * 2.01, type: 'sine',     dur: 0.038, gain: 0.028, attack: 0.006 });
    // Layer 4: Soft velvet contact transient (gentle finger pad touch, non-harsh)
    noise(b,   { dur: 0.022, gain: 0.016, from: 650, to: 260, q: 0.8, attack: 0.004 });
  }

  // Settings: warm felt-covered marimba tap with 5-note tonal variation
  function settingsTap() {
    const v = nextVariant('set', SCALE_SETTINGS.length);
    const base = SCALE_SETTINGS[v] * rand(0.995, 1.005);
    partial('settings', { freq: base,        type: 'sine',     dur: 0.18, gain: 0.24 * rand(0.93, 1.07), attack: 0.009, bend: 0.988 });
    partial('settings', { freq: base * 0.5,  type: 'triangle', dur: 0.13, gain: 0.045, attack: 0.012 });
    partial('settings', { freq: base * 2.98, type: 'sine',     dur: 0.07, gain: 0.028, attack: 0.007 });
    noise('settings',   { dur: 0.028, gain: 0.018, from: 850, to: 340, q: 0.7, attack: 0.005 });
  }

  // Toggle switch: gentle ascending/descending two-note ambient chime
  function settingsToggle(on) {
    if (on) {
      partial('settings', { freq: 392.00, type: 'sine', dur: 0.18, gain: 0.16, attack: 0.008, delay: 0 });
      partial('settings', { freq: 587.33, type: 'sine', dur: 0.24, gain: 0.18, attack: 0.009, delay: 0.028 });
      partial('settings', { freq: 783.99, type: 'sine', dur: 0.12, gain: 0.032, attack: 0.008, delay: 0.036 });
    } else {
      partial('settings', { freq: 587.33, type: 'sine', dur: 0.16, gain: 0.15, attack: 0.008, delay: 0 });
      partial('settings', { freq: 392.00, type: 'sine', dur: 0.20, gain: 0.15, attack: 0.009, delay: 0.028 });
      partial('settings', { freq: 196.00, type: 'triangle', dur: 0.10, gain: 0.035, attack: 0.010, delay: 0.036 });
    }
  }

  // Sidebar: very soft, muted bamboo tap that stays unobtrusive
  function sidebarTick() {
    const v = nextVariant('sb', SCALE_SIDEBAR.length);
    const base = SCALE_SIDEBAR[v] * rand(0.994, 1.006);
    partial('sidebar', { freq: base,       type: 'sine',     dur: 0.09, gain: 0.16, attack: 0.008, bend: 0.96 });
    partial('sidebar', { freq: base * 2.0, type: 'triangle', dur: 0.05, gain: 0.028, attack: 0.007 });
  }

  function sidebarHover() {
    partial('sidebar', { freq: rand(620, 700), type: 'sine', dur: 0.045, gain: 0.020, attack: 0.010 });
  }

  function composerTick() {
    const COMP_SCALE = [440.00, 493.88, 523.25];
    const base = COMP_SCALE[nextVariant('comp', 3)] * rand(0.995, 1.005);
    partial('composer', { freq: base, type: 'sine', dur: 0.09, gain: 0.16, attack: 0.009, bend: 0.98 });
    noise('composer',   { dur: 0.025, gain: 0.015, from: 750, to: 300, q: 0.7, attack: 0.005 });
  }

  // Success: serene 4-note ascending celestial ambient arpeggio (E4, G4, B4, E5)
  function success() {
    [329.63, 392.00, 493.88, 659.25].forEach((f, i) =>
      partial('settings', { freq: f, type: 'sine', dur: 0.38, gain: 0.13, attack: 0.011, delay: i * 0.065 }));
  }

  // Error: polite, soft low double-tap (155 Hz -> 115 Hz, zero harsh buzzer)
  function error() {
    partial('settings', { freq: 155, type: 'triangle', dur: 0.18, gain: 0.13, attack: 0.014, bend: 0.82 });
    partial('settings', { freq: 115, type: 'sine',     dur: 0.18, gain: 0.10, attack: 0.014, delay: 0.055, bend: 0.85 });
  }

  // Notification: gentle two-note Tibetan singing bowl chime (C5 -> G5)
  function notify() {
    partial('ui', { freq: 523.25, type: 'sine', dur: 0.30, gain: 0.12, attack: 0.011 });
    partial('ui', { freq: 783.99, type: 'sine', dur: 0.38, gain: 0.10, attack: 0.011, delay: 0.075 });
  }

  /* ══════════════ PENGUIN VOICE ══════════════
     Small, breathy and organic. Pitch is high but band-limited and quiet,
     so it reads as "cute creature" rather than "beeping gadget". */
  const PET = {
    flap() {
      noise('pet', { dur: 0.13, gain: 0.10, from: 900,  to: 260, q: 0.7, attack: 0.010 });
      noise('pet', { dur: 0.09, gain: 0.05, from: 1500, to: 500, q: 1.0, attack: 0.008, delay: 0.055 });
    },
    flapRun() {
      for (let i = 0; i < 6; i++) {
        noise('pet', { dur: 0.10, gain: 0.075 - i * 0.008, from: rand(850, 1000), to: 260, q: 0.7, attack: 0.008, delay: i * 0.105 });
      }
    },
    chirp() {
      const f = rand(1500, 1750);
      partial('pet', { freq: f,        type: 'sine', dur: 0.075, gain: 0.11, attack: 0.007, bend: 1.28 });
      partial('pet', { freq: f * 1.34, type: 'sine', dur: 0.055, gain: 0.045, attack: 0.006, delay: 0.075, bend: 1.1 });
    },
    chirpTwice() { PET.chirp(); setTimeout(() => PET.chirp(), 110); },
    trill() {
      const base = rand(1350, 1500);
      [1, 1.18, 1.4, 1.6].forEach((m, i) =>
        partial('pet', { freq: base * m, type: 'sine', dur: 0.09, gain: 0.085, attack: 0.006, delay: i * 0.062, bend: 1.06 }));
    },
    giggle() {
      for (let i = 0; i < 4; i++)
        partial('pet', { freq: rand(1500, 1800), type: 'sine', dur: 0.05, gain: 0.065, attack: 0.005, delay: i * 0.075, bend: 1.15 });
    },
    hop() {
      partial('pet', { freq: rand(620, 700), type: 'sine', dur: 0.09, gain: 0.085, attack: 0.007, bend: 1.35 });
    },
    land() {
      noise('pet', { dur: 0.07, gain: 0.055, from: 500, to: 160, q: 0.6, attack: 0.006 });
    },
    peck() {
      partial('pet', { freq: rand(2100, 2400), type: 'sine', dur: 0.032, gain: 0.055, attack: 0.004, bend: 0.85 });
    },
    coo() {
      partial('pet', { freq: rand(620, 700), type: 'sine', dur: 0.30, gain: 0.075, attack: 0.030, bend: 0.9 });
    },
    sad() {
      partial('pet', { freq: 700, type: 'sine', dur: 0.34, gain: 0.085, attack: 0.020, bend: 0.62 });
    },
    sleep() {
      noise('pet', { dur: 0.40, gain: 0.030, from: 420, to: 200, q: 0.5, attack: 0.090 });
    }
  };

  /* ══════════════ ROUTING ══════════════ */
  function zoneOf(el) {
    if (!el || !el.closest) return 'ui';
    if (el.closest('#settings-overlay, .settings-modal, .mac-settings-overlay')) return 'settings';
    if (el.closest('#sidebar, .sidebar')) return 'sidebar';
    if (el.closest('.claude-input-container')) return 'composer';
    return 'ui';
  }

  let lastPlayTime = 0;
  let lastPlayEvt = '';

  function play(evt, zone) {
    if (!isEnabled() || getTheme() === 'off') return;
    // Hover/pointerover is not a trusted user gesture. Do not create or
    // resume Web Audio there; wait until the first real pointer/key gesture.
    if (!audioUnlocked) return;
    if (!init()) return;
    if (ctx.state === 'suspended') { ctx.resume().catch(() => {}); return; }

    const t = performance.now();
    // Prevent duplicate rapid triggers from simultaneous pointerdown + click or event bubbling
    if (t - lastPlayTime < 38 && lastPlayEvt === evt) return;
    lastPlayTime = t;
    lastPlayEvt = evt;

    if (!claim()) return;
    voices = Math.max(0, voices - 1);   // partials manage their own counting

    const quiet = getTheme() === 'minimal';
    try {
      switch (evt) {
        case 'click':
          if (zone === 'settings') settingsTap();
          else if (zone === 'sidebar') sidebarTick();
          else if (zone === 'composer') composerTick();
          else uiTick(zone);
          break;
        case 'toggle':
          if (zone === 'sidebar') sidebarTick();
          else settingsToggle(true);
          break;
        case 'hover':  if (!quiet) sidebarHover(); break;
        case 'success': success(); break;
        case 'error':   error();   break;
        case 'notify':  notify();  break;
        default: uiTick(zone);
      }
    } catch (_) {}
  }

  /* ── Public API — unchanged surface, new engine underneath ── */
  window.SoundFX = {
    playClick:        (z) => play('click', z),
    playToggle:       (z) => play('toggle', z),
    playSuccess:      () => play('success'),
    playError:        () => play('error'),
    playNotification: () => play('notify'),
    playHover:        () => play('hover'),
    isEnabled,
    toggleSound: (on) => { localStorage.setItem(LS.enabled, on ? 'true' : 'false'); if (on) play('toggle', 'settings'); },
    setTheme: (t) => { localStorage.setItem(LS.theme, t); if (t !== 'off') play('toggle', 'settings'); },
    getTheme,
    setVolume: (v) => {
      localStorage.setItem(LS.volume, String(v));
      if (master) master.gain.value = parseFloat(v) * 0.55;
    },
    getVolume,
    preview: (t) => {
      const prev = getTheme();
      localStorage.setItem(LS.theme, t);
      play('success');
      localStorage.setItem(LS.theme, prev);
    }
  };

  // Flag that luxury-sound is active and loaded
  window.__lxSoundLoaded = true;

  window.NexusAudio = {
    play, zoneOf,
    pet: (kind) => {
      if (!isEnabled() || getTheme() === 'off') return;
      if (!audioUnlocked) return;
      if (!init()) return;
      if (ctx.state === 'suspended') { ctx.resume().catch(() => {}); return; }
      try { (PET[kind] || PET.chirp)(); } catch (_) {}
    },
    get ready() { return !!ctx; }
  };

  /* ── Global listeners: one capture-phase pointerdown, zone-aware ── */
  document.addEventListener('pointerdown', (e) => {
    const t = e.target;
    if (!t || !t.closest) return;
    if (t.closest('.nexus-pet')) return;                  // the pet has its own voice
    const zone = zoneOf(t);

    const toggle = t.closest('.smodal-switch, .mac-toggle, input[type="checkbox"], .lx-theme-toggle');
    if (toggle) {
      const input = toggle.querySelector?.('input[type="checkbox"]') || (toggle.type === 'checkbox' ? toggle : null);
      if (zone === 'settings') settingsToggle(!(input && input.checked));
      else play('toggle', zone);
      return;
    }
    const btn = t.closest([
      'button', '.btn-primary', '.btn-secondary', '.nav-item', '.nav-sub-item',
      '.action-btn', '.chat-chip', '.do-quick-btn', '.lx-palette-swatch',
      '.claude-icon-btn', '.smodal-nav-item', '.custom-dropdown-header',
      '.custom-dropdown-list li', '.pet-tip-act', '.lx-suggestion-btn', '.tbl-action-btn'
    ].join(','));
    if (btn) play('click', zone);
  }, { passive: true, capture: true });

  // Nav hover ticks — sidebar only, heavily throttled so it stays pleasant
  let lastHover = 0;
  document.addEventListener('pointerover', (e) => {
    const item = e.target.closest?.('.nav-item, .nav-sub-item, .smodal-nav-item, .lx-palette-swatch');
    if (!item) return;
    const t = performance.now();
    if (t - lastHover < 90) return;
    lastHover = t;
    play('hover', zoneOf(item));
  }, { passive: true });

  // Range sliders: a soft detented tick as the value moves
  let lastSlide = 0;
  document.addEventListener('input', (e) => {
    if (!e.target.matches?.('input[type="range"]')) return;
    const t = performance.now();
    if (t - lastSlide < 55) return;
    lastSlide = t;
    if (!audioUnlocked || !isEnabled() || getTheme() === 'off' || !init()) return;
    partial(zoneOf(e.target) === 'settings' ? 'settings' : 'ui',
      { freq: rand(440, 520), type: 'sine', dur: 0.035, gain: 0.030, attack: 0.005 });
  }, { passive: true });

  console.info('[NexusAudio v4] ambient soothing UI sound engine ready');
})();
