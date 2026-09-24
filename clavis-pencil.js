/* ============================================================
 * clavis-pencil.js  ·  Crossing things off
 * ------------------------------------------------------------
 * A finished task gets struck out the way a person strikes one out:
 * not a ruled line through the middle, but a slightly wandering pull
 * of a pencil that overshoots at both ends and goes back over itself
 * once, because the first pass never feels definite enough.
 *
 * Two things carry it:
 *   · the MARK — a path generated per element, seeded off its own
 *     text so the same task always gets the same stroke (stable
 *     across repaints) while two different tasks never match. Drawn
 *     with a graphite texture and an uneven speed curve, because a
 *     real stroke is fast in the middle and slow at the ends.
 *   · the SOUND — synthesised, not a sample: filtered noise whose
 *     amplitude tracks the drawing speed, so the scrape you hear is
 *     the stroke you see. Roughly 180ms, quiet enough to sit under
 *     the UI rather than announce itself.
 *
 * It stays silent until the user has interacted with the page (audio
 * policy), respects prefers-reduced-motion, and can be muted with
 * ClavisPencil.mute(true).
 * ============================================================ */
(function (global) {
  'use strict';

  if (global.ClavisPencil) return;

  var MUTE_KEY = 'clavis_pencil_muted';
  var ctx = null;
  var armed = false;      // audio needs a gesture before it will run
  var noiseBuf = null;

  function reduced() {
    try { return global.matchMedia('(prefers-reduced-motion: reduce)').matches; }
    catch (e) { return false; }
  }
  function muted() {
    try { return localStorage.getItem(MUTE_KEY) === '1'; } catch (e) { return false; }
  }

  ['pointerdown', 'keydown', 'touchstart'].forEach(function (evt) {
    global.addEventListener(evt, function () { armed = true; }, { once: true, passive: true });
  });

  /* ── Sound ────────────────────────────────────────────────
     Graphite on paper is broadband noise shaped by the paper's
     tooth: energy concentrated in the 1.5–4kHz range, with a low
     rumble from the pencil body. Two filtered noise voices plus an
     envelope that dips where the stroke slows gets remarkably close. */
  function audio() {
    if (ctx) return ctx;
    var AC = global.AudioContext || global.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
    return ctx;
  }

  function noise(ac) {
    if (noiseBuf && noiseBuf.sampleRate === ac.sampleRate) return noiseBuf;
    var len = Math.floor(ac.sampleRate * 0.5);
    noiseBuf = ac.createBuffer(1, len, ac.sampleRate);
    var d = noiseBuf.getChannelData(0);
    // Slightly brown-tinted noise: pure white reads as hiss, not paper.
    var last = 0;
    for (var i = 0; i < len; i++) {
      var w = Math.random() * 2 - 1;
      last = (last + 0.035 * w) / 1.035;
      d[i] = w * 0.72 + last * 3.2;
    }
    return noiseBuf;
  }

  function scrape(duration, strength) {
    if (muted() || !armed) return;
    var ac = audio();
    if (!ac) return;
    if (ac.state === 'suspended') { try { ac.resume(); } catch (e) {} }

    var t0 = ac.currentTime;
    var dur = duration || 0.19;
    var amp = (strength == null ? 1 : strength) * 0.075;

    var src = ac.createBufferSource();
    src.buffer = noise(ac);
    src.loop = true;
    src.playbackRate.value = 0.85 + Math.random() * 0.3;

    // Paper tooth
    var band = ac.createBiquadFilter();
    band.type = 'bandpass';
    band.frequency.setValueAtTime(1500, t0);
    band.frequency.linearRampToValueAtTime(3100, t0 + dur * 0.45);
    band.frequency.linearRampToValueAtTime(1900, t0 + dur);
    band.Q.value = 0.85;

    // Take the harshest top off so it sits under the UI.
    var tilt = ac.createBiquadFilter();
    tilt.type = 'highshelf';
    tilt.frequency.value = 5200;
    tilt.gain.value = -9;

    var gain = ac.createGain();
    var g = gain.gain;
    // Fast in, a dip where the hand slows mid-stroke, then a tail —
    // this is what stops it sounding like a single flat "shh".
    g.setValueAtTime(0.0001, t0);
    g.exponentialRampToValueAtTime(amp, t0 + 0.012);
    g.exponentialRampToValueAtTime(amp * 0.55, t0 + dur * 0.4);
    g.exponentialRampToValueAtTime(amp * 0.92, t0 + dur * 0.62);
    g.exponentialRampToValueAtTime(0.0001, t0 + dur);

    src.connect(band); band.connect(tilt); tilt.connect(gain); gain.connect(ac.destination);
    src.start(t0);
    src.stop(t0 + dur + 0.02);
  }

  /* ── The mark ─────────────────────────────────────────────── */

  // Deterministic per-element randomness: the same task redraws the
  // same stroke, so a repaint never makes the line twitch.
  function seeded(str) {
    var h = 2166136261;
    for (var i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return function () {
      h ^= h << 13; h ^= h >>> 17; h ^= h << 5;
      return ((h >>> 0) % 10000) / 10000;
    };
  }

  /* A cross-out drawn by hand is not straight: it starts a touch above
     the midline, sags through the middle where the wrist pivots, and
     runs past the last letter. More control points through a smooth
     quadratic give a gentle, wavy pull — intentionally a little wavy so it
     reads as a hand-drawn line rather than a ruler stroke. */
  function strokePath(w, h, rnd, pass) {
    // The two passes sit slightly apart and cross near the middle,
    // which is what a real double cross-out does — laid exactly on top
    // of each other they just read as one thick line.
    var mid = h * (pass ? 0.60 : 0.50);
    var overshoot = 3 + rnd() * 5;
    var pts = [];
    // More points => a smoother, more legibly wavy curve.
    var n = 9;
    // A slow ~1.5-cycle wave down the length, offset per pass and per
    // element seed so the two strokes ripple differently and no two tasks
    // look identical. Kept small (a gentle wave, not a zig-zag).
    var wavePhase = rnd() * Math.PI * 2;
    var waveCycles = 1.4 + rnd() * 0.5;
    var waveAmp = h * 0.16 * (pass ? 0.82 : 1);
    for (var i = 0; i <= n; i++) {
      var t = i / n;
      var x = -overshoot + t * (w + overshoot * 1.8);
      // Wander, biased to sag in the middle like a real wrist pivot...
      var sag = Math.sin(t * Math.PI) * h * 0.07;
      // ...plus a gentle travelling wave for the wavy look, tapered at the
      // ends (Math.sin(t*PI)) so the stroke enters and leaves cleanly.
      var wave = Math.sin(t * Math.PI) * Math.sin(wavePhase + t * Math.PI * waveCycles) * waveAmp;
      var jitter = (rnd() - 0.5) * h * 0.14;
      pts.push([x, mid + sag + wave + jitter]);
    }
    var d = 'M ' + pts[0][0].toFixed(1) + ' ' + pts[0][1].toFixed(1);
    for (var j = 1; j < pts.length - 1; j++) {
      var cx = pts[j][0], cy = pts[j][1];
      var nx = (pts[j][0] + pts[j + 1][0]) / 2;
      var ny = (pts[j][1] + pts[j + 1][1]) / 2;
      d += ' Q ' + cx.toFixed(1) + ' ' + cy.toFixed(1) + ' ' + nx.toFixed(1) + ' ' + ny.toFixed(1);
    }
    var last = pts[pts.length - 1];
    d += ' T ' + last[0].toFixed(1) + ' ' + last[1].toFixed(1);
    return d;
  }

  var uid = 0;

  /**
   * strike(el) — cross out one element. Idempotent: an element that is
   * already struck is left alone, so repaints are free.
   */
  function strike(el, opts) {
    if (!el || el.dataset.struck === '1') return;
    opts = opts || {};
    el.dataset.struck = '1';
    el.classList.add('cts-struck');

    var rect = el.getBoundingClientRect();
    var w = Math.max(24, Math.round(rect.width));
    var h = Math.max(10, Math.round(rect.height));

    var rnd = seeded((el.textContent || '') + '|' + w);
    var id = 'pen' + (++uid);

    var svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('class', 'cts-pencil');
    svg.setAttribute('width', w + 12);
    svg.setAttribute('height', h);
    svg.setAttribute('viewBox', '0 0 ' + (w + 12) + ' ' + h);
    svg.setAttribute('aria-hidden', 'true');
    svg.innerHTML =
      '<defs>' +
      '  <filter id="' + id + '" x="-10%" y="-40%" width="120%" height="180%">' +
      '    <feTurbulence type="fractalNoise" baseFrequency="0.9 0.55" numOctaves="2" seed="' +
             Math.floor(rnd() * 90) + '" result="n"/>' +
      '    <feDisplacementMap in="SourceGraphic" in2="n" scale="1.6" ' +
             'xChannelSelector="R" yChannelSelector="G"/>' +
      '  </filter>' +
      '</defs>' +
      '<g filter="url(#' + id + ')" fill="none" stroke="currentColor" stroke-linecap="round">' +
      '  <path class="cts-pencil-p1" d="' + strokePath(w, h, rnd, 0) + '" stroke-width="1.9" opacity="0.9"/>' +
      '  <path class="cts-pencil-p2" d="' + strokePath(w, h, rnd, 1) + '" stroke-width="1.35" opacity="0.58"/>' +
      '</g>';

    el.appendChild(svg);

    if (reduced()) {
      svg.classList.add('is-done');
      return;
    }

    // Draw it: dash the path out, then pull the offset back to zero.
    // The second pass starts before the first finishes, which is what
    // a double-strike actually sounds and looks like.
    var p1 = svg.querySelector('.cts-pencil-p1');
    var p2 = svg.querySelector('.cts-pencil-p2');
    [p1, p2].forEach(function (p) {
      var L = p.getTotalLength();
      p.style.strokeDasharray = L;
      p.style.strokeDashoffset = L;
    });

    requestAnimationFrame(function () {
      if (p1.animate) {
        p1.animate([{ strokeDashoffset: p1.getTotalLength() }, { strokeDashoffset: 0 }],
          { duration: 260, easing: 'cubic-bezier(0.3, 0.05, 0.2, 1)', fill: 'forwards' });
        p2.animate([{ strokeDashoffset: p2.getTotalLength() }, { strokeDashoffset: 0 }],
          { duration: 220, delay: 130, easing: 'cubic-bezier(0.4, 0, 0.3, 1)', fill: 'forwards' });
      } else {
        p1.style.strokeDashoffset = 0;
        p2.style.strokeDashoffset = 0;
      }
      scrape(0.2, opts.volume);
      setTimeout(function () { scrape(0.13, (opts.volume == null ? 1 : opts.volume) * 0.6); }, 135);
    });

    // The text itself fades back — struck-through work should recede,
    // not compete with what is still live.
    if (el.animate) {
      el.animate([{ opacity: 1 }, { opacity: 0.45 }],
        { duration: 420, delay: 120, easing: 'ease-out', fill: 'forwards' });
    }
  }

  /**
   * scan(root) — strike everything inside `root` that is marked done
   * and has not been struck yet, staggered so a batch reads as a hand
   * going down the list rather than one simultaneous flash.
   */
  function scan(root) {
    if (!root) return 0;
    var targets = root.querySelectorAll(
      '.cts-pipe-step.is-done .cts-pipe-title:not([data-struck]),' +
      '.cts-pipe-node-wrap.done .cts-pipe-node-label:not([data-struck]),' +
      '.cts-agent-card.done-agent .cts-agent-name:not([data-struck]),' +
      '[data-done="1"]:not([data-struck])'
    );
    Array.prototype.forEach.call(targets, function (t, i) {
      setTimeout(function () { strike(t, { volume: 0.85 }); }, i * 170);
    });
    return targets.length;
  }

  global.ClavisPencil = {
    strike: strike,
    scan: scan,
    sound: scrape,
    mute: function (on) {
      try { localStorage.setItem(MUTE_KEY, on ? '1' : '0'); } catch (e) {}
      return !!on;
    },
    isMuted: muted
  };
})(window);
