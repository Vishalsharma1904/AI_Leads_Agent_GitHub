/*
 * Clavis sound activation — a snap (or two claps) wakes Clavis.
 *
 * Why the old detector "never worked", and what changed:
 *   1. It polled an AnalyserNode every 32 ms over a ~21 ms window, so a
 *      10-20 ms clap fell in the gap about a third of the time.
 *      -> detection now runs in an AudioWorklet that sees every sample.
 *   2. Background windows throttle timers to once a second.
 *      -> the audio thread is not throttled.
 *   3. It borrowed the voice mic stream, which has noise suppression and
 *      auto-gain on — both flatten exactly the transient we look for.
 *      -> it opens its own stream with those two off.
 *   4. Any single loud syllable could fire it.
 *      -> an impulse must decay within ~90 ms (speech doesn't), and the
 *         gesture is one crisp isolated snap or two claps 110-650 ms apart.
 *         Three or more in a row (applause, typing) is ignored.
 *   5. Chrome keeps an AudioContext suspended until the first click.
 *      -> it resumes on the first gesture; Start-Clavis.bat also passes
 *         --autoplay-policy=no-user-gesture-required.
 *
 * Public API is unchanged (jarvis_ui.js depends on it): start/stop,
 * running, context, setOptions, isSupported; events 'trigger'
 * {kind, confidence, isDouble, at}, 'error', 'started', 'stopped'.
 * Modes (localStorage 'clavis_clap_mode'):
 *   'auto' (default) — two claps/snaps, OR one crisp, loud, isolated snap
 *                       (nothing else for 1.5 s before or 0.65 s after, so
 *                       typing, music beats and applause don't count);
 *   'double'         — only two claps/snaps;
 *   'single'         — any single clap/snap (most sensitive).
 */
'use strict';

(() => {
  const AudioContextCtor = window.AudioContext || window.webkitAudioContext;
  const SENS = { low: 1.4, medium: 1, high: 0.7 };
  const SETTLE_MS = 650;       // wait this long after the last impulse before judging the pattern
  const MIN_GAP = 110, MAX_GAP = 650;
  const ISOLATION_MS = 1500;   // a lone snap must come out of quiet
  const CRISP_MS = 45, LOUD = 0.08;

  // Pure pattern judgement (covered by _selfTest). group: [{at, ms, level}],
  // quietBefore: ms since the impulse before this group.
  function judge(group, mode, quietBefore) {
    if (group.length === 2) {
      const gap = group[1].at - group[0].at;
      return gap >= MIN_GAP && gap <= MAX_GAP ? 'double' : null;
    }
    if (group.length !== 1) return null;
    if (mode === 'single') return 'single';
    const g = group[0];
    if (mode !== 'double' && quietBefore >= ISOLATION_MS && g.ms <= CRISP_MS && g.level >= LOUD) return 'single';
    return null;
  }

  class ClavisAudioTrigger extends EventTarget {
    constructor() {
      super();
      this.stream = null;
      this.ownsStream = false;
      this.starting = false;
      this.context = null;
      this.node = null;
      this.source = null;
      this.running = false;
      this.group = [];
      this.settleTimer = 0;
      this.cooldownUntil = 0;
      this.lastImpulseAt = 0;      // end of the previous group, for the isolation rule
      this.quietBefore = Infinity;
      this.options = {
        clap: true,
        snap: true,
        sensitivity: localStorage.getItem('clavis_sound_sensitivity') || 'medium',
        cooldownMs: 1500,
      };
      this.resumeOnGesture = () => { if (this.context?.state === 'suspended') this.context.resume().catch(() => {}); };
      document.addEventListener('visibilitychange', this.resumeOnGesture);
    }

    isSupported() {
      return Boolean(window.isSecureContext && navigator.mediaDevices?.getUserMedia && AudioContextCtor && window.AudioWorkletNode);
    }

    setOptions(next = {}) {
      this.options = {
        ...this.options,
        ...next,
        sensitivity: SENS[next.sensitivity] ? next.sensitivity : this.options.sensitivity,
      };
      try { localStorage.setItem('clavis_sound_sensitivity', this.options.sensitivity); } catch (_) {}
      this.node?.port.postMessage({ sens: SENS[this.options.sensitivity] || 1 });
    }

    async start(nextOptions = {}) {
      this.setOptions(nextOptions);
      if (this.running || this.starting) return true;
      this.starting = true;
      if (!this.isSupported()) {
        const insecure = !window.isSecureContext || location.protocol === 'file:';
        this.dispatchEvent(new CustomEvent('error', { detail: {
          code: insecure ? 'SOUND_TRIGGER_INSECURE_ORIGIN' : 'SOUND_TRIGGER_UNSUPPORTED',
          message: insecure
            ? 'Open Clavis from http://localhost, not a file:// URL, for persistent microphone access.'
            : 'Sound triggers need a modern Chrome or Edge browser.',
        } }));
        this.starting = false;
        return false;
      }
      try {
        const sharedEngine = window.LocalSpeechEngine;
        const shared = sharedEngine?.getSharedMicrophone?.();
        if (shared?.getTracks?.().some((track) => track.readyState === 'live')) {
          this.stream = shared;
          this.ownsStream = false;
        } else if (sharedEngine?.acquireSharedMicrophone) {
          this.stream = await sharedEngine.acquireSharedMicrophone();
          this.ownsStream = false;
        } else {
          this.stream = await navigator.mediaDevices.getUserMedia({
            audio: { echoCancellation: true, noiseSuppression: false, autoGainControl: false, channelCount: 1 },
          });
          this.ownsStream = true;
        }
        this.context = new AudioContextCtor({ latencyHint: 'playback' });
        await this.context.audioWorklet.addModule('clavis-clap-worklet.js?v=1');
        this.source = this.context.createMediaStreamSource(this.stream);
        this.node = new AudioWorkletNode(this.context, 'clavis-clap', { numberOfInputs: 1, numberOfOutputs: 0 });
        this.node.port.postMessage({ sens: SENS[this.options.sensitivity] || 1 });
        this.node.port.onmessage = (e) => { if (e.data?.type === 'impulse') this.onImpulse(e.data); };
        this.source.connect(this.node);
        if (this.context.state === 'suspended') {
          this.context.resume().catch(() => {});
          ['pointerdown', 'keydown'].forEach((t) => window.addEventListener(t, this.resumeOnGesture, { once: true, passive: true }));
        }
        this.running = true;
        this.starting = false;
        this.group = [];
        this.dispatchEvent(new CustomEvent('started'));
        return true;
      } catch (error) {
        await this.stop();
        this.starting = false;
        const blocked = error?.name === 'NotAllowedError' || error?.name === 'SecurityError';
        this.dispatchEvent(new CustomEvent('error', { detail: {
          code: blocked ? 'SOUND_TRIGGER_MIC_BLOCKED' : 'SOUND_TRIGGER_UNAVAILABLE',
          message: blocked ? 'Microphone permission is required for clap and snap activation.' : 'Sound triggers could not start.',
          cause: error?.name || 'unknown',
        } }));
        return false;
      }
    }

    async stop() {
      const was = this.running;
      this.running = false;
      clearTimeout(this.settleTimer);
      this.group = [];
      try { this.source?.disconnect(); this.node?.disconnect(); } catch (_) {}
      if (this.ownsStream) {
        for (const track of this.stream?.getTracks?.() || []) track.stop();
      }
      if (this.context) { try { await this.context.close(); } catch (_) {} }
      this.stream = null; this.ownsStream = false; this.context = null; this.node = null; this.source = null;
      if (was) this.dispatchEvent(new CustomEvent('stopped'));
    }

    onImpulse(d) {
      if (!this.running) return;
      const now = Date.now();
      if (now < this.cooldownUntil) return;
      // ponytail: zero-crossing rate is a rough clap/snap split (label only;
      // both wake Clavis). A spectral check would be the upgrade if it matters.
      const kind = d.zcr > 0.3 ? 'snap' : 'clap';
      if (!this.group.length) this.quietBefore = this.lastImpulseAt ? now - this.lastImpulseAt : Infinity;
      this.lastImpulseAt = now;
      this.group.push({ at: now, kind, level: d.level, ms: d.ms });
      clearTimeout(this.settleTimer);
      this.settleTimer = setTimeout(() => this.settle(), SETTLE_MS);
    }

    settle() {
      const group = this.group.splice(0);
      if (!this.running || !group.length) return;
      const saved = localStorage.getItem('clavis_clap_mode');
      const mode = saved === 'single' || saved === 'double' ? saved : 'auto';
      const verdict = judge(group, mode, this.quietBefore);
      if (!verdict) return;
      const snaps = group.filter((g) => g.kind === 'snap').length;
      const kind = snaps * 2 >= group.length ? 'snap' : 'clap';
      if (!this.options[kind]) return;
      this.cooldownUntil = Date.now() + Number(this.options.cooldownMs || 1500);
      const confidence = verdict === 'double' ? 0.92 : 0.7;
      this.dispatchEvent(new CustomEvent('trigger', {
        detail: { kind, confidence, isDouble: verdict === 'double', at: group[group.length - 1].at },
      }));
    }

    // Runnable check for the pattern logic: ClavisAudioTrigger._selfTest()
    _selfTest() {
      const at = (...t) => t.map((x) => ({ at: x, ms: 20, level: 0.3 }));
      const snap = [{ at: 0, ms: 20, level: 0.3 }];
      const ok = [
        judge(at(0, 300), 'auto', Infinity) === 'double',
        judge(at(0, 60), 'auto', Infinity) === null,        // echo / one clap ringing
        judge(at(0, 900), 'auto', Infinity) === null,       // two unrelated sounds
        judge(at(0, 200, 400), 'auto', Infinity) === null,  // applause / typing
        judge(snap, 'auto', Infinity) === 'single',         // one crisp snap out of silence
        judge(snap, 'auto', 400) === null,                  // ...but not mid-typing
        judge([{ at: 0, ms: 80, level: 0.3 }], 'auto', Infinity) === null,   // a thud, not a snap
        judge([{ at: 0, ms: 20, level: 0.05 }], 'auto', Infinity) === null,  // too faint
        judge(snap, 'double', Infinity) === null,
        judge([{ at: 0, ms: 80, level: 0.05 }], 'single', 0) === 'single',
      ];
      const passed = ok.filter(Boolean).length;
      console[passed === ok.length ? 'log' : 'error'](`ClavisAudioTrigger self-test: ${passed}/${ok.length}`);
      return passed === ok.length;
    }
  }

  window.ClavisAudioTrigger = new ClavisAudioTrigger();
})();
