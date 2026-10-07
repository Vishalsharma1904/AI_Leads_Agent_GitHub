/**
 * ============================================================
 *  RUDRA24 AI BARGE-IN (clavis-barge-in.js)
 *  Free, browser-native "stop talking when the user speaks".
 *
 *  The hard part is echo: the mic hears Rudra24 AI's own TTS through the
 *  speakers, so a naive detector makes Rudra24 AI interrupt ITSELF. We defend
 *  against that, all local and free:
 *    1. echoCancellation on the capture stream (browser AEC removes most
 *       of the speaker signal),
 *    2. a DOUBLE-TALK detector (ClavisEar.createDoubleTalk): it learns how
 *       loud the leftover echo is RELATIVE to what Rudra24 AI is playing right
 *       now (ClavisVoice.outputLevel), so only a voice above that echo
 *       counts. v1 learned a fixed floor in the first 320 ms — usually the
 *       silence before the first TTS chunk arrived — then fired on its own
 *       echo, or, with a loud echo, never fired at all.
 *    3. the voice must be periodic (a pitch — claps, clicks and keyboard
 *       noise have none) and sustained for ~220 ms.
 *    4. semantic barge-in lives in jarvis_ui.js: while Rudra24 AI talks, the
 *       wake recognizer's words go through ClavisEar.judge — a stop word
 *       or new words that aren't Rudra24 AI's own echo interrupt it too.
 *
 *  Usage (see jarvis_ui.js speakJarvisText / handleClavisBargeIn):
 *    ClavisBargeIn.arm(onBargeCallback)  // when Rudra24 AI starts speaking
 *    ClavisBargeIn.disarm()              // when Rudra24 AI stops
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
  let generation = 0, candidate = null, graphReady = null;

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
    if (graphReady) return graphReady;
    graphReady = (async () => {
    // Processed voice stream (AEC + NS + AGC), not the raw clap/snap stream.
    stream = await (window.LocalSpeechEngine?.acquireVoiceMicrophone?.() || navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }
    }));
    ctx = new (window.AudioContext || window.webkitAudioContext)();
    const src = ctx.createMediaStreamSource(stream);
    analyser = ctx.createAnalyser();
    analyser.fftSize = 1024;
    analyser.smoothingTimeConstant = 0;
    buf = new Float32Array(analyser.fftSize);
    src.connect(analyser);
    })().finally(() => { graphReady = null; });
    return graphReady;
  }

  function frame() {
    analyser.getFloatTimeDomainData(buf);
    let s = 0;
    for (let i = 0; i < buf.length; i++) s += buf[i] * buf[i];
    return Math.sqrt(s / buf.length);
  }

  // Cheap periodicity check: is there a pitch between 80 and 400 Hz?
  function voiced(samples = buf, rate = ctx.sampleRate) {
    const minLag = Math.floor(rate / 400), maxLag = Math.min(Math.floor(rate / 80), samples.length - 64);
    let mean = 0;
    for (const sample of samples) mean += sample;
    mean /= samples.length;
    let r0 = 0;
    for (let i = 0; i < samples.length; i++) r0 += (samples[i] - mean) ** 2;
    if (r0 <= 0) return false;
    let best = 0;
    for (let lag = minLag; lag <= maxLag; lag += 3) {
      let s = 0;
      for (let i = 0; i + lag < samples.length; i++) s += (samples[i] - mean) * (samples[i + lag] - mean);
      s /= r0 * (samples.length - lag) / samples.length;
      if (s > best) best = s;
    }
    return best > 0.4;
  }

  function outputLevel() {
    try { const v = window.ClavisVoice?.outputLevel?.(); return Number.isFinite(v) ? v : null; } catch (_) { return null; }
  }

  function discardCandidate() {
    const capture = candidate; candidate = null;
    if (!capture) return;
    try { if (capture.recorder.state === 'recording') capture.recorder.stop(); } catch (_) {}
    capture.chunks.length = 0;
    capture.stream.getTracks().forEach(track => track.stop());
  }

  function captureCandidate() {
    if (candidate || !window.ClavisDirect?.providerConfigured?.('groq') || typeof MediaRecorder !== 'function' || !stream?.clone) return;
    const ownedStream = stream.clone();
    try {
      const mimeType = ['audio/webm;codecs=opus','audio/webm','audio/mp4'].find(type => MediaRecorder.isTypeSupported(type));
      const recorder = new MediaRecorder(ownedStream, mimeType ? {mimeType} : undefined);
      const capture = {stream:ownedStream,recorder,chunks:[],since:Date.now(),owner:window.SupabaseAuth?.getUser?.()?.id};
      recorder.ondataavailable = event => { if (candidate === capture && event.data.size) capture.chunks.push(event.data); };
      candidate = capture;
      recorder.start(200);
    } catch (_) {
      candidate = null;
      ownedStream.getTracks().forEach(track => track.stop());
    }
  }

  function fire() {
    const cb = onBarge;
    const capture = candidate; candidate = null;
    disarm();
    if (typeof cb === 'function') cb(capture);
    else if (capture) { candidate = capture; discardCandidate(); }
  }

  function tick() {
    if (!armed) return;
    const level = frame();
    if (warmFrames < WARMUP_FRAMES) { warmFrames++; baseline = Math.max(baseline * 0.8, level); return; }

    const out = outputLevel();
    let loud;
    if (out != null && dt) {
      // Output-referenced: we know how loud Rudra24 AI is right now.
      loud = dt.update(level, out).loud;
    } else {
      // Browser speechSynthesis can't be measured: slow-adapting floor.
      if (!isVoice(level, baseline, floor())) baseline = baseline * 0.97 + level * 0.03;
      loud = isVoice(level, baseline, floor());
    }
    if (loud && voiced()) {
      captureCandidate(); // Retain the first words while confirming sustained speech.
      if (++voiceFrames >= VOICE_FRAMES) fire();
    } else {
      voiceFrames = Math.max(0, voiceFrames - (loud ? 0 : 2));
      if (!voiceFrames) discardCandidate();
    }
  }

  async function arm(cb) {
    if (typeof window !== 'undefined' && window.ClavisVoiceState && !window.ClavisVoiceState.canProcessMic()) return false;
    if (localStorage.getItem('clavis_bargein_enabled') === 'false') return false;
    // arm() is safe to call repeatedly: an old interval is always cleared
    // first so two tick() loops never share the same counters.
    disarm();
    const current = generation;
    onBarge = cb; voiceFrames = 0; warmFrames = 0; baseline = 0; armedAt = Date.now();
    dt = window.ClavisEar?.createDoubleTalk?.({ margin: 2.4, min: 0.02 }) || null;
    try { await ensureGraph(); }
    catch (e) { if (current === generation || !onBarge) cleanup(); console.warn('[BargeIn] mic unavailable — barge-in off:', e && (e.name || e)); return false; }
    if (current !== generation) { if (!onBarge) cleanup(); return false; }
    if (window.ClavisVoiceState && !window.ClavisVoiceState.canProcessMic()) { cleanup(); return false; }
    if (ctx.state === 'suspended') { try { await ctx.resume(); } catch (_) {} }
    if (current !== generation) return false;
    armed = true;
    timer = setInterval(tick, FRAME_MS);
    return true;
  }

  function disarm() {
    generation++;
    discardCandidate();
    armed = false;
    if (timer) { clearInterval(timer); timer = null; }
    onBarge = null; voiceFrames = 0; warmFrames = 0; baseline = 0; dt = null;
    // Keep stream/ctx alive for instant re-arm; they're idle when not sampling.
  }

  function cleanup() {
    disarm();
    if (stream) {
      try {
        const tracks = stream.getTracks ? stream.getTracks() : [];
        tracks.forEach(t => { try { t.stop(); } catch (_) {} });
      } catch (_) {}
      stream = null;
    }
    if (ctx) {
      try { ctx.close(); } catch (_) {}
      ctx = null;
    }
    analyser = null;
    buf = null;
  }

  if (typeof window !== 'undefined' && window.ClavisVoiceState?.registerAudioCleanup) {
    window.ClavisVoiceState.registerAudioCleanup(() => cleanup());
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

  return { arm, disarm, cleanup, computeTrigger, isVoice, hasPitch: voiced, _selfTest, _isArmed: () => armed, _armedFor: () => (armed ? Date.now() - armedAt : 0) };
})();
