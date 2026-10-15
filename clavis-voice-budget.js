/* ============================================================
 * clavis-voice-budget.js · local estimates and caps for ElevenLabs use
 * ------------------------------------------------------------
 * ElevenLabs bills per character spoken and per second heard, and
 * nothing in the app counted either. One stuck loop, one chatty
 * afternoon, and a month's allowance is gone with no warning.
 *
 * Two local meters: characters sent for synthesis (TTS), and connected
 * listening seconds including streamed silence (STT). These estimates are
 * separate from provider credits/rates and cannot cover other apps/devices.
 * Caps block new requests in this app; cached PCM uses no provider credits.
 *
 * Caps live in localStorage so they can be raised after upgrading
 * the plan, without a rebuild:
 *   clavis_eleven_cap_chars_day    default  4000
 *   clavis_eleven_cap_chars_month  default 90000
 *   clavis_eleven_cap_stt_day      default   900  (seconds)
 *   clavis_eleven_cap_stt_month    default 18000  (seconds)
 *
 * API (window.ClavisVoiceBudget):
 *   allowTTS(chars) -> boolean      noteTTS(chars)
 *   allowSTT()      -> boolean      noteSTT(seconds)
 *   status()        -> meters + caps + what is blocked
 *   reason()        -> '' | human-readable sentence for the UI
 * ============================================================ */
(function (window) {
  'use strict';
  if (window.ClavisVoiceBudget) return;

  const KEY = 'clavis_eleven_usage_v1';
  const ownerId = () => String(window.SupabaseAuth?.getUser?.()?.id || '');
  const usageKey = owner => owner ? KEY + ':' + encodeURIComponent(owner) : KEY;
  const CAPS = {
    charsDay: ['clavis_eleven_cap_chars_day', 4000],
    charsMonth: ['clavis_eleven_cap_chars_month', 90000],
    sttDay: ['clavis_eleven_cap_stt_day', 900],
    sttMonth: ['clavis_eleven_cap_stt_month', 18000],
  };

  const ls = (k) => { try { return window.localStorage.getItem(k); } catch (_) { return null; } };
  function cap(name) {
    const [key, fallback] = CAPS[name];
    const raw = ls(key);
    // Number(null) and Number('') are both 0, which is a REAL cap here
    // (stop calling the provider) — so an unset key has to be caught before
    // the number, or every meter reads as spent on a fresh browser.
    if (raw === null || String(raw).trim() === '') return fallback;
    const n = Number(raw);
    return Number.isFinite(n) && n >= 0 ? n : fallback;
  }
  const stamps = () => {
    const d = new Date();
    const month = d.getFullYear() + '-' + (d.getMonth() + 1);
    return { day: month + '-' + d.getDate(), month };
  };

  function load(owner = ownerId()) {
    const { day, month } = stamps();
    let m = {};
    const key = usageKey(owner);
    let raw = ls(key);
    // Keep pre-existing usage when this browser first adopts scoped meters.
    // Later accounts start separately instead of inheriting another tenant's
    // counters. This marker contains only the app account ID, never a key.
    if (owner && raw === null && ls(KEY + ':legacy-owner') === null) {
      try {
        window.localStorage.setItem(KEY + ':legacy-owner', owner);
        raw = ls(KEY);
        if (raw !== null) window.localStorage.setItem(key, raw);
      } catch (_) {}
    }
    try { m = JSON.parse(raw || '{}'); } catch (_) {}
    if (!m || typeof m !== 'object' || Array.isArray(m)) m = {};
    // A new day or month zeroes only its own counters, never the other's.
    if (m.day !== day) { m.day = day; m.charsDay = 0; m.sttDay = 0; }
    if (m.month !== month) { m.month = month; m.charsMonth = 0; m.sttMonth = 0; }
    ['charsDay', 'charsMonth', 'sttDay', 'sttMonth'].forEach((k) => {
      if (!Number.isFinite(m[k]) || m[k] < 0) m[k] = 0;
    });
    return m;
  }
  function save(m, owner = ownerId()) { try { window.localStorage.setItem(usageKey(owner), JSON.stringify(m)); } catch (_) {} }

  function add(dayKey, monthKey, amount, owner = ownerId()) {
    const n = Number(amount);
    if (!Number.isFinite(n) || n <= 0) return;
    const m = load(owner);
    m[dayKey] += n; m[monthKey] += n;
    save(m, owner);
    try { window.dispatchEvent(new CustomEvent('clavis:voice-budget', { detail: status() })); } catch (_) {}
  }

  function allowTTS(chars) {
    const want = Math.max(1, Number(chars) || 1), m = load();
    return m.charsDay + want <= cap('charsDay') && m.charsMonth + want <= cap('charsMonth');
  }
  function allowSTT() {
    const m = load();
    return m.sttDay < cap('sttDay') && m.sttMonth < cap('sttMonth');
  }
  function remainingSTT() {
    const m = load();
    return Math.max(0, Math.min(cap('sttDay') - m.sttDay, cap('sttMonth') - m.sttMonth));
  }

  function status() {
    const m = load();
    return {
      chars: { day: m.charsDay, month: m.charsMonth, capDay: cap('charsDay'), capMonth: cap('charsMonth') },
      stt: { day: m.sttDay, month: m.sttMonth, capDay: cap('sttDay'), capMonth: cap('sttMonth') },
      ttsBlocked: !allowTTS(1), sttBlocked: !allowSTT(),
    };
  }
  function reason(chars = 1) {
    const s = status();
    const ttsBlocked = !allowTTS(chars);
    if (ttsBlocked && s.sttBlocked) return 'App ke local ElevenLabs voice aur listening caps reached. Settings → Voice → Advanced mein caps check kijiye.';
    if (ttsBlocked) return 'App ka local ElevenLabs voice cap reached. Settings → Voice → Advanced mein cap check kijiye.';
    if (s.sttBlocked) return 'App ka local ElevenLabs listening cap reached. Settings → Voice → Advanced mein cap check kijiye.';
    return '';
  }

  window.ClavisVoiceBudget = {
    allowTTS, allowSTT, remainingSTT, status, reason,
    noteTTS: (chars, owner) => add('charsDay', 'charsMonth', chars, owner),
    noteSTT: (seconds, owner) => add('sttDay', 'sttMonth', seconds, owner),
    reset: () => { try { window.localStorage.removeItem(usageKey(ownerId())); } catch (_) {} },
    _selfTest() {
      const key = usageKey(ownerId()), saved = ls(key);
      try {
        window.ClavisVoiceBudget.reset();
        const ok = [
          allowTTS(10) === true,
          (add('charsDay', 'charsMonth', cap('charsDay')), allowTTS(1) === false),
          status().chars.day === cap('charsDay'),
          (window.ClavisVoiceBudget.reset(), allowSTT() === true),
          (add('sttDay', 'sttMonth', cap('sttDay')), allowSTT() === false),
          reason().length > 0,
        ];
        const passed = ok.filter(Boolean).length;
        console[passed === ok.length ? 'log' : 'error'](`ClavisVoiceBudget self-test: ${passed}/${ok.length}`);
        return passed === ok.length;
      } finally {
        try { saved === null ? window.localStorage.removeItem(key) : window.localStorage.setItem(key, saved); } catch (_) {}
      }
    },
  };

  function mountControls() {
    const controls = [['ev-cap-chars-day', 'charsDay', 1], ['ev-cap-chars-month', 'charsMonth', 1],
      ['ev-cap-stt-day', 'sttDay', 60], ['ev-cap-stt-month', 'sttMonth', 60]];
    const render = () => {
      const s = status(), el = window.document?.getElementById('ev-local-usage');
      if (el) el.textContent = `Local estimate: ${Math.ceil(s.chars.day)} characters and ${Math.ceil(s.stt.day / 60)} listening minutes today; ${Math.ceil(s.chars.month)} characters and ${Math.ceil(s.stt.month / 60)} minutes this month.`;
    };
    for (const [id, name, unit] of controls) {
      const el = window.document?.getElementById(id);
      if (!el) continue;
      el.value = String(cap(name) / unit);
      el.addEventListener('change', () => {
        const n = Number(el.value);
        if (!el.value.trim() || !Number.isFinite(n) || n < 0) { el.value = String(cap(name) / unit); return; }
        try { window.localStorage.setItem(CAPS[name][0], String(n * unit)); } catch (_) { return; }
        render();
        window.dispatchEvent(new CustomEvent('clavis:voice-settings-changed', {detail: {kind: 'budget'}}));
      });
    }
    window.addEventListener('clavis:voice-budget', render);
    render();
  }
  if (window.document?.readyState === 'loading') window.document.addEventListener('DOMContentLoaded', mountControls, {once: true});
  else if (window.document) mountControls();
})(window);
