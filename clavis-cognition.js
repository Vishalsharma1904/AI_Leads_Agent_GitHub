/*
 * Clavis cognition guardrails.
 *
 * The fast path: a cheap dedupe gate on raw signals, so one physical event or
 * a double click never becomes multiple assistant turns. The full attention /
 * initiative model lives in clavis-mind.js; this stays deliberately dumb and
 * synchronous because it sits directly in the input handlers.
 */
'use strict';

(() => {
  const recentSignals = new Map();
  let lastTurn = { text: '', at: 0 };

  function normalise(value) {
    return String(value || '').toLowerCase().replace(/\s+/g, ' ').trim();
  }

  function admitSignal(kind, confidence = 0) {
    const key = normalise(kind) || 'unknown';
    const now = Date.now();
    const previous = recentSignals.get(key) || 0;
    if (now - previous < 400) return false;
    // A sound event must be reasonably confident before interrupting speech.
    if ((key === 'clap' || key === 'snap') && Number(confidence) < 0.4) return false;
    recentSignals.set(key, now);
    for (const [name, timestamp] of recentSignals) {
      if (now - timestamp > 5000) recentSignals.delete(name);
    }
    return true;
  }

  function admitTurn(text) {
    const value = normalise(text);
    if (!value) return false;
    const now = Date.now();
    if (value === lastTurn.text && now - lastTurn.at < 1200) return false;
    lastTurn = { text: value, at: now };
    return true;
  }

  function reset() {
    recentSignals.clear();
    lastTurn = { text: '', at: 0 };
  }

  window.ClavisCognition = Object.freeze({ admitSignal, admitTurn, reset });
})();
