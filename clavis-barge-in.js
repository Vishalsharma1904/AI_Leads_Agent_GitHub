/**
 * ============================================================
 *  CLAVIS BARGE-IN (clavis-barge-in.js)
 *  Free, browser-native "stop talking when the user speaks".
 *
 *  The hard part is echo: the mic hears Clavis's own TTS through the
 *  speakers, so a naive detector makes Clavis interrupt ITSELF. We defend
 *  against that three ways, all local and free:
 *    1. echoCancellation on the capture stream (browser AEC removes most
 *       of the speaker signal),
 *    2. a per-utterance WARM-UP that measures the residual echo/ambient
 *       floor before we start listening for the user, and
 *    3. the user's voice must beat that learned floor by a margin, and stay
 *       above it for ~200ms (so a click/cough is ignored).
 *
 *  Usage (see jarvis_ui.js speakJarvisText / doneSpeaking):
 *    ClavisBargeIn.arm(onBargeCallback)  // when Clavis starts speaking
 *    ClavisBargeIn.disarm()              // when Clavis stops
 * ============================================================
 */
'use strict';

window.ClavisBargeIn = (() => {
  let stream = null, ctx = null, analyser = null, buf = null;
  let timer = null, armed = false, onBarge = null;
  let voiceFrames = 0, warmFrames = 0, baseline = 0;

  const FRAME_MS       = 40;   // sampling period
  const WARMUP_FRAMES  = 8;    // ~320ms: learn this utterance's echo/ambient floor first
  const VOICE_FRAMES   = 5;    // ~200ms sustained speech = a real interruption
  const MARGIN         = 2.2;  // user voice must beat the learned floor by this factor

  // ponytail: fixed RMS floor; every mic/room differs, so it's tunable via
  // localStorage 'clavis_bargein_threshold' without touching code.
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
    analyser.fftSize = 512;
    buf = new Uint8Array(analyser.fftSize);
    src.connect(analyser);
  }

  function rms() {
    analyser.getByteTimeDomainData(buf);
    let s = 0;
    for (let i = 0; i < buf.length; i++) { const x = (buf[i] - 128) / 128; s += x * x; }
    return Math.sqrt(s / buf.length);
  }

  function tick() {
    if (!armed) return;
    const level = rms();
    if (warmFrames < WARMUP_FRAMES) {          // learn the echo/ambient floor first
      warmFrames++;
      baseline = Math.max(baseline, level);
      return;
    }
    if (isVoice(level, baseline, floor())) {
      if (++voiceFrames >= VOICE_FRAMES) {      // sustained → real barge-in
        const cb = onBarge;
        disarm();
        if (typeof cb === 'function') cb();
      }
    } else {
      voiceFrames = 0;
    }
  }

  async function arm(cb) {
    if (localStorage.getItem('clavis_bargein_enabled') === 'false') return false;
    // FIX (2026-09-04): arm() used to unconditionally start a new setInterval.
    // If it was ever called again before the previous disarm() landed (e.g. a
    // fast back-to-back reply, or disarm() racing an in-flight ensureGraph()
    // await), the old interval was never cleared -> two tick() loops running
    // at once, doubling CPU work and corrupting the warmup/baseline math
    // (both loops write the same module-level voiceFrames/warmFrames/baseline).
    // Clearing any existing timer first makes arm() safe to call repeatedly.
    if (timer) { clearInterval(timer); timer = null; }
    onBarge = cb; voiceFrames = 0; warmFrames = 0; baseline = 0;
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
    onBarge = null; voiceFrames = 0; warmFrames = 0; baseline = 0;
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

  return { arm, disarm, computeTrigger, isVoice, _selfTest, _isArmed: () => armed };
})();
