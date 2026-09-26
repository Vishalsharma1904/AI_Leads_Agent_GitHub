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
  /* One clean, straight pencil line through the middle — a hair of
     overshoot at both ends so it reads as drawn, not ruled. (The old
     double wavy scribble looked messy at small sizes.) */
  function strokePath(w, h, rnd) {
    var y = Math.round(h * 0.54) + 0.5;
    var o = 2 + rnd() * 2;
    return 'M ' + (-o).toFixed(1) + ' ' + y + ' L ' + (w + o).toFixed(1) + ' ' + y;
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
      '<path class="cts-pencil-p1" d="' + strokePath(w, h, rnd) + '" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" opacity="0.7"/>';
    void id;

    el.appendChild(svg);

    if (reduced()) {
      svg.classList.add('is-done');
      return;
    }

    // Draw it: dash the path out, then pull the offset back to zero.
    // The second pass starts before the first finishes, which is what
    // a double-strike actually sounds and looks like.
    var p1 = svg.querySelector('.cts-pencil-p1');
    // Already crossed off on an earlier paint: show it at once, silently.
    if (opts.instant) { el.style.opacity = '0.45'; return; }
    var L = p1.getTotalLength();
    p1.style.strokeDasharray = L;
    p1.style.strokeDashoffset = L;

    requestAnimationFrame(function () {
      if (p1.animate) {
        p1.animate([{ strokeDashoffset: L }, { strokeDashoffset: 0 }],
          { duration: 320, easing: 'cubic-bezier(0.3, 0.05, 0.2, 1)', fill: 'forwards' });
      } else {
        p1.style.strokeDashoffset = 0;
      }
      scrape(0.24, opts.volume);        // one stroke, one scrape
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
  // Which steps were already crossed off, per task — a repaint redraws
  // them instantly and silently; only a step that JUST finished gets the
  // animated stroke and the pencil sound.
  var seen = new Set();
  function scan(root, taskId) {
    if (!root) return 0;
    var targets = root.querySelectorAll(
      '.cts-pipe-step.is-done .cts-pipe-title:not([data-struck]),' +
      '.cts-pipe-node-wrap.done .cts-pipe-node-label:not([data-struck]),' +
      '.cts-agent-card.done-agent .cts-agent-name:not([data-struck]),' +
      '[data-done="1"]:not([data-struck])'
    );
    var fresh = 0;
    Array.prototype.forEach.call(targets, function (t) {
      var key = (taskId || '') + '|' + (t.textContent || '').trim();
      if (seen.has(key)) { strike(t, { instant: true }); return; }
      seen.add(key);
      var delay = fresh++ * 220;
      setTimeout(function () { strike(t, { volume: 0.85 }); }, delay);
    });
    if (seen.size > 400) seen.clear();
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
