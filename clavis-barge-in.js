/**
 * ============================================================
 *  CLAVIS BARGE-IN (clavis-barge-in.js)
 *  Free, browser-native "stop talking when the user speaks".
 *
 *  The hard part is echo: the mic hears Clavis's own TTS through the
 *  speakers, so a naive detector makes Clavis interrupt ITSELF. We defend
 *  against that, all local and free:
 *    1. echoCancellation on the capture stream (browser AEC removes most
 *       of the speaker signal),
 *    2. a DOUBLE-TALK detector (ClavisEar.createDoubleTalk): it learns how
 *       loud the leftover echo is RELATIVE to what Clavis is playing right
 *       now (ClavisVoice.outputLevel), so only a voice above that echo
 *       counts. v1 learned a fixed floor in the first 320 ms — usually the
 *       silence before the first TTS chunk arrived — then fired on its own
 *       echo, or, with a loud echo, never fired at all.
 *    3. the voice must be periodic (a pitch — claps, clicks and keyboard
 *       noise have none) and sustained for ~220 ms.
 *    4. semantic barge-in lives in jarvis_ui.js: while Clavis talks, the
 *       wake recognizer's words go through ClavisEar.judge — a stop word
 *       or new words that aren't Clavis's own echo interrupt it too.
 *
 *  Usage (see jarvis_ui.js speakJarvisText / handleClavisBargeIn):
 *    ClavisBargeIn.arm(onBargeCallback)  // when Clavis starts speaking
 *    ClavisBargeIn.disarm()              // when Clavis stops
 *  localStorage: clavis_bargein_enabled ('false' = off),
 *                clavis_bargein_threshold (min RMS, default 0.045 for the
 *                browser voice, which can't be measured).
 * ============================================================
 */
'use strict';

window.ClavisBargeIn = (() => {
  let stream = null, ctx = null, analyser = null, buf = null;
  let timer = null, armed = false, onBarge = null, armedAt = 0;
  let voiceFrames = 0, warmFrames = 0, baseline = 0, dt = null;

  const FRAME_MS       = 30;   // sampling period
  const WARMUP_FRAMES  = 6;    // ~180ms: ignore the click of playback starting
  const VOICE_FRAMES   = 7;    // ~210ms sustained speech = a real interruption
  const MARGIN         = 2.2;  // (no output reference) voice must beat the floor by this factor

  function floor() {
    const v = parseFloat(localStorage.getItem('clavis_bargein_threshold'));
    return Number.isFinite(v) ? v : 0.045;
  }

  // Pure decision helpers (covered by _selfTest).
  function computeTrigger(base, flr) { return Math.max(flr, base * MARGIN); }
  function isVoice(level, base, flr) { return level > computeTrigger(base, flr); }

  async function ensureGraph() {
    if (analyser) return;
    stream = await (window.LocalSpeechEngine?.acquireSharedMicrophone?.() || navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }
    }));
    ctx = new (window.AudioContext || window.webkitAudioContext)();
    const src = ctx.createMediaStreamSource(stream);
    analyser = ctx.createAnalyser();
    analyser.fftSize = 1024;
    analyser.smoothingTimeConstant = 0;
    buf = new Float32Array(analyser.fftSize);
    src.connect(analyser);
  }

  function frame() {
    analyser.getFloatTimeDomainData(buf);
    let s = 0;
    for (let i = 0; i < buf.length; i++) s += buf[i] * buf[i];
    return Math.sqrt(s / buf.length);
  }

  // Cheap periodicity check: is there a pitch between 80 and 400 Hz?
  function voiced() {
    const rate = ctx.sampleRate;
    const minLag = Math.floor(rate / 400), maxLag = Math.min(Math.floor(rate / 80), buf.length - 64);
    let r0 = 0;
    for (let i = 0; i < buf.length; i++) r0 += buf[i] * buf[i];
    if (r0 <= 0) return false;
    let best = 0;
    for (let lag = minLag; lag <= maxLag; lag += 3) {
      let s = 0;
      for (let i = 0; i + lag < buf.length; i++) s += buf[i] * buf[i + lag];
      s /= r0 * (buf.length - lag) / buf.length;
      if (s > best) best = s;
    }
    return best > 0.4;
  }

  function outputLevel() {
    try { const v = window.ClavisVoice?.outputLevel?.(); return Number.isFinite(v) ? v : null; } catch (_) { return null; }
  }

  function fire() {
    const cb = onBarge;
    disarm();
    if (typeof cb === 'function') cb();
  }

  function tick() {
    if (!armed) return;
    const level = frame();
    if (warmFrames < WARMUP_FRAMES) { warmFrames++; baseline = Math.max(baseline * 0.8, level); return; }

    const out = outputLevel();
    let loud;
    if (out != null && dt) {
      // Output-referenced: we know how loud Clavis is right now.
      loud = dt.update(level, out).loud;
    } else {
      // Browser speechSynthesis can't be measured: slow-adapting floor.
      if (!isVoice(level, baseline, floor())) baseline = baseline * 0.97 + level * 0.03;
      loud = isVoice(level, baseline, floor());
    }
    if (loud && voiced()) {
      if (++voiceFrames >= VOICE_FRAMES) fire();
    } else {
      voiceFrames = Math.max(0, voiceFrames - (loud ? 0 : 2));
    }
  }

  async function arm(cb) {
    if (localStorage.getItem('clavis_bargein_enabled') === 'false') return false;
    // arm() is safe to call repeatedly: an old interval is always cleared
    // first so two tick() loops never share the same counters.
    if (timer) { clearInterval(timer); timer = null; }
    onBarge = cb; voiceFrames = 0; warmFrames = 0; baseline = 0; armedAt = Date.now();
    dt = window.ClavisEar?.createDoubleTalk?.({ margin: 2.4, min: 0.02 }) || null;
    try { await ensureGraph(); }
    catch (e) { console.warn('[BargeIn] mic unavailable — barge-in off:', e && (e.name || e)); return false; }
    if (ctx.state === 'suspended') { try { await ctx.resume(); } catch (_) {} }
    armed = true;
    timer = setInterval(tick, FRAME_MS);
    return true;
  }

  function disarm() {
    armed = false;
    if (timer) { clearInterval(timer); timer = null; }
    onBarge = null; voiceFrames = 0; warmFrames = 0; baseline = 0; dt = null;
    // Keep stream/ctx alive for instant re-arm; they're idle when not sampling.
  }

  // Runnable check for the pure decision logic — run ClavisBargeIn._selfTest().
  function _selfTest() {
    const checks = [
      computeTrigger(0.02, 0.045) === 0.045,        // low echo → floor dominates
      Math.abs(computeTrigger(0.05, 0.045) - 0.11) < 1e-9, // high echo → margin dominates (0.05*2.2)
      isVoice(0.03, 0.02, 0.045) === false,    // quiet residual echo does NOT trigger
      isVoice(0.12, 0.02, 0.045) === true,     // close user voice DOES trigger
      isVoice(0.09, 0.05, 0.045) === false,    // voice below echo*margin (0.11) is ignored
    ];
    const passed = checks.filter(Boolean).length;
    console[passed === checks.length ? 'log' : 'error'](`ClavisBargeIn self-test: ${passed}/${checks.length} passed`);
    return passed === checks.length;
  }

  return { arm, disarm, computeTrigger, isVoice, _selfTest, _isArmed: () => armed, _armedFor: () => (armed ? Date.now() - armedAt : 0) };
})();
