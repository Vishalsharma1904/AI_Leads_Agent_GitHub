/**
 * ============================================================
 *  CLAVIS VISION (clavis-vision.js)
 *  The proactive engine (clavis-proactive.js) infers what you're doing
 *  from window TITLES only — it explicitly never looks at screen content.
 *  This module is the opt-in upgrade: it periodically takes a real
 *  screenshot (via the native bridge), asks a vision-capable model what
 *  you appear to be doing, and — through the SAME budget/etiquette gate
 *  ClavisProactive already uses — offers to help. It never guesses in
 *  silence and acts: it always speaks as a polite question/offer, never
 *  as a claim of certainty, and never triggers a tool call on its own.
 *
 *  OFF by default. Turning it on requires:
 *    1. the native bridge running (screenshots aren't possible without it
 *       in any privacy-respecting way — no silent webcam/screen capture)
 *    2. a vision-capable AI key connected
 *    3. the user explicitly enabling it (toggleClavisVision() / Settings)
 *
 *  Privacy guards:
 *    - skips a cycle entirely if the foreground window looks sensitive
 *      (banking/OTP/password managers — same regex clavis-proactive.js
 *      already uses for window titles)
 *    - skips while the tab is hidden or the user is away/idle
 *    - screenshots are analysed in memory and never written to disk or
 *      sent anywhere except the user's own configured AI provider
 *    - a visible "Clavis is watching your screen" indicator whenever a
 *      cycle is about to run (see updateVisionIndicator)
 * ============================================================
 */
'use strict';

(() => {
  const LS_ENABLED = 'clavis_vision_enabled';
  const LS_INTERVAL = 'clavis_vision_interval_ms';
  const MIN_INTERVAL = 30000;   // don't hammer the vision API / the user's quota
  const DEFAULT_INTERVAL = 180000;   // a calm look every 3 min (was 45 s)
  const MAX_WIDTH = 960;        // downscale before sending — cheaper + faster, plenty for UI understanding

  const SENSITIVE = /bank|netbank|paytm|phonepe|upi|\botp\b|password|passwd|credential|wallet|incognito|private browsing|aadhaar|pan card|salary|payslip|keychain|1password|bitwarden/i;

  const state = { running: false, timer: null, busy: false, lastAt: 0, lastActivity: '' };

  function isEnabled() { return localStorage.getItem(LS_ENABLED) !== 'false'; } // Default ON for proactive awareness
  function intervalMs() {
    const v = Number(localStorage.getItem(LS_INTERVAL));
    return Number.isFinite(v) && v >= MIN_INTERVAL ? v : DEFAULT_INTERVAL;
  }

  function updateVisionIndicator(active) {
    const btn = document.getElementById('jarvis-vision-btn');
    if (btn) btn.classList.toggle('active', Boolean(isEnabled()));
    const dot = document.getElementById('jarvis-vision-live-dot');
    if (dot) dot.style.display = active ? 'inline-block' : 'none';
  }

  // Downscale in-memory (canvas), never touching disk — keeps the vision
  // call cheap and fast without giving up enough detail to read UI text.
  function downscale(dataUrl) {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        const scale = Math.min(1, MAX_WIDTH / img.width);
        const w = Math.round(img.width * scale);
        const h = Math.round(img.height * scale);
        const c = document.createElement('canvas');
        c.width = w; c.height = h;
        c.getContext('2d').drawImage(img, 0, 0, w, h);
        resolve(c.toDataURL('image/jpeg', 0.72)); // jpeg: screenshots don't need lossless
      };
      img.onerror = () => resolve(dataUrl);
      img.src = dataUrl;
    });
  }

  function parseModelJson(text) {
    const m = String(text || '').match(/\{[\s\S]*\}/);
    if (!m) return null;
    try { return JSON.parse(m[0]); } catch (_) { return null; }
  }

  async function shouldSkipThisCycle() {
    if (window.isClavisSpeaking?.() || window.isClavisListening?.()) return 'Clavis busy';
    if (!window.ClavisPC) return 'ClavisPC missing';
    const up = await window.ClavisPC.ping();
    if (!up) {
      if (document.hidden) return 'tab hidden and bridge not running';
      return 'bridge not running';
    }
    // With bridge running, Clavis can observe across all desktop windows even when tab is in background!
    if (!window.ClavisDirect?.hasKey?.() || !window.ClavisDirect.supportsVision?.()) return 'no vision-capable key';
    if (!window.ClavisProactive?.canSpeak?.('vision')) return 'proactive budget/etiquette gate closed';
    try {
      const aw = await window.ClavisPC.activeWindow();
      if (aw?.idleMs > 180000) return 'user away';
      if (SENSITIVE.test(`${aw?.title || ''} ${aw?.process || ''}`)) return 'sensitive window — skipped for privacy';
    } catch (_) { /* active-window is best-effort */ }
    return null;
  }

  async function analyzeOnce({ forceSpeak = false } = {}) {
    if (state.busy) return null;
    state.busy = true;
    updateVisionIndicator(true);
    try {
      const skipReason = forceSpeak ? null : await shouldSkipThisCycle();
      if (skipReason) return { skipped: skipReason };

      const { dataUrl } = await window.ClavisPC.screenshot();
      const small = await downscale(dataUrl);

      const sys = [
        'You are Clavis, a proactive AI assistant who can see the user\'s screen once every cycle.',
        'You will be shown ONE screenshot. Infer what the user is likely doing, in one short phrase.',
        'Then decide: is there ONE concrete, specific, genuinely useful thing you could offer to help with right now?',
        'Be conservative — most of the time the honest answer is "nothing to offer, they are fine".',
        'NEVER claim certainty about private details (accounts, balances, messages) even if partially visible — describe only what is clearly work-relevant.',
        'If you do have something useful, phrase it as a short, warm, POLITE QUESTION OFFERING help — never a command, never a claim that you already did something.',
        'Speak Hinglish (Hindi in Latin script mixed with English), address the user as "sir".',
        'Respond with STRICT JSON only, no markdown fences: {"activity":"...", "suggestion":"... or empty string","ask":true|false,"confidence":0.0-1.0}',
      ].join(' ');

      const data = await window.ClavisDirect.complete({
        messages: [
          { role: 'system', content: sys },
          { role: 'user', content: 'Yeh raha screenshot. Bataiye kya kar raha/rahi hoon, aur agar kuch madad ka mauka dikhe to ek chhota sa polite sawal suggest kijiye.' },
        ],
        images: [small],
        max_tokens: 220,
      });

      const text = data?.choices?.[0]?.message?.content || '';
      const parsed = parseModelJson(text) || {};
      state.lastAt = Date.now();
      state.lastActivity = String(parsed.activity || '').slice(0, 200);

      const confidence = Number(parsed.confidence) || 0;
      const suggestion = String(parsed.suggestion || '').trim();
      if ((forceSpeak || (parsed.ask && confidence >= 0.7)) && suggestion) {
        if (forceSpeak || window.ClavisProactive?.canSpeak?.('vision')) {
          window.ClavisProactive?.deliver?.(suggestion, 'vision');
        }
      }
      window.dispatchEvent(new CustomEvent('clavis:vision', { detail: parsed }));
      return parsed;
    } catch (err) {
      console.warn('[ClavisVision] cycle failed:', err);
      return { error: err?.message || String(err) };
    } finally {
      state.busy = false;
      updateVisionIndicator(false);
    }
  }

  function tick() { analyzeOnce().catch(() => {}); }

  function start() {
    if (state.running) return true;
    if (!isEnabled()) return false;
    state.running = true;
    state.timer = window.setInterval(tick, intervalMs());
    // First look happens after one full interval, not immediately — no need
    // to rush a screen read the instant it's turned on.
    return true;
  }

  function stop() {
    state.running = false;
    if (state.timer) { clearInterval(state.timer); state.timer = null; }
    updateVisionIndicator(false);
  }

  function setEnabled(on) {
    localStorage.setItem(LS_ENABLED, on ? 'true' : 'false');
    if (on) start(); else stop();
    updateVisionIndicator(false);
    return on;
  }

  function status() {
    return { enabled: isEnabled(), running: state.running, busy: state.busy, lastAt: state.lastAt, lastActivity: state.lastActivity, intervalMs: intervalMs() };
  }

  window.ClavisVision = { start, stop, setEnabled, isEnabled, status, analyzeOnce };

  function initVision() {
    if (isEnabled()) start();
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initVision);
  } else {
    initVision();
  }
})();
