/* ============================================================
 * clavis-wake.js · ek hi "jaaga hai ya nahi" state — sab isko poochte hain
 * ------------------------------------------------------------
 * Pehle Rudra24 AI kamre ki har baat sun kar LLM ko bhej deta tha (aur Gemini
 * Live 10 min tak mic stream karta rehta tha) — API keys ek ghante me
 * khatam. Ab rule simple hai:
 *
 *   SOYA (default)  → mic sirf wake word / snap / clap dhoondhta hai,
 *                     koi LLM call nahi, koi Live stream nahi.
 *   JAAGA           → "Rudra", "Hey Rudra", "Hey Buddy", "Hey Clay",
 *                     snap, clap, orb/mic tap ya typed message se.
 *                     Rudra24 AI ke jawab ke baad FOLLOW_MS (default 9 s) tak
 *                     bina naam liye follow-up bol sakte hain.
 *   BUSY            → soch raha / bol raha ho to window expire nahi hoti.
 *
 * Window khatam → wapas SOYA, aur 'clavis:wake-change' event fire hota hai
 * (jarvis_ui / clavis-live us par mic band / Live session stop karte hain).
 *
 * API (window.ClavisWake):
 *   isAwake()            → boolean
 *   wake(source, {ms})   → jaga do (source: 'word'|'snap'|'clap'|'tap'|'typed'|…)
 *   touch(ms)            → window aage badhao (accepted turn / reply ke baad)
 *   busy(on, who)        → soch/bol raha hai — expire mat karo ('who' alag
 *                          holders ke liye; max 90 s per hold, phir khud chhoot)
 *   sleep(reason)        → turant sula do
 *   match(text)          → {phrase, rest} agar wake word hai, warna null
 *   named(text)          → text me Rudra24 AI ka naam / wake phrase hai?
 *   allowBackground()    → proactive / vision / mind jaise background LLM
 *                          calls ki ijazat (sirf jaage hue ho to, ya
 *                          clavis_background_ai === 'on')
 *   on(fn)               → state change listener, returns unsubscribe
 *   state()              → {awake, until, source, busy}
 * localStorage: clavis_followup_ms, clavis_wake_words (extra phrases),
 *               clavis_background_ai ('auto' default | 'on' | 'off').
 * ============================================================ */
(function () {
  'use strict';
  if (window.ClavisWake) return;

  let clock = () => Date.now();   // tests inject a clock (ClavisWake._setClock)
  const now = () => clock();
  const ls = (k, d) => { try { const v = localStorage.getItem(k); return v == null ? d : v; } catch (_) { return d; } };

  // Continuous conversation (clavis_continuous, default ON — owner's ask,
  // 2026-09-25): once woken Rudra24 AI stays in the conversation, no name needed,
  // until "so jao / bas karo / stop listening…" or SESSION_MS without an
  // accepted turn. Off → the old 10 s first window + ~9 s follow-up.
  const continuous = () => ls('clavis_continuous', 'true') !== 'false';
  const sessionMs = () => Math.min(15 * 60000, Math.max(30000, Number(ls('clavis_session_idle_ms', 180000)) || 180000));
  const firstMs = () => (continuous() ? sessionMs() : 10000);   // wake ke baad bolna shuru karne ka time
  const shortFollowMs = () => Math.min(30000, Math.max(4000, Number(ls('clavis_followup_ms', 9000)) || 9000));
  // A typed turn is not a voice conversation: it keeps the short follow-up.
  const followMs = () => (continuous() && S.source !== 'typed' ? sessionMs() : shortFollowMs());

  // Recognizers "Rudra" ko kaise-kaise likhte hain (en-IN + hi-IN dono).
  const RUDRA_VARIANTS = /(?:रुद्र(?:ा)?|rudhra|rudra)/gi;
  const DEFAULT_PHRASES = [
    'hey rudra', 'hi rudra', 'ok rudra', 'okay rudra', 'rudra',
    'हे rudra', 'हेलो rudra'
  ];

  function phrases() {
    let extra = [];
    try {
      const saved = JSON.parse(ls('clavis_wake_words', 'null'));
      if (Array.isArray(saved)) extra = saved.map(String).map(s => s.trim().toLowerCase()).filter(Boolean).slice(0, 8);
    } catch (_) {}
    // "hi pal" was an old default that fired on normal speech — drop it.
    extra = extra.filter(p => !/clavis|clevis|klavis|buddy|clay|hi pal|क्लैविस|क्लेविस/i.test(p)).map(norm);
    return Array.from(new Set(DEFAULT_PHRASES.concat(extra))).sort((a, b) => b.length - a.length);
  }

  function norm(text) {
    return String(text || '').toLowerCase()
      .replace(RUDRA_VARIANTS, 'rudra')
      .replace(/[^\p{L}\p{N}\s']/gu, ' ')
      .replace(/\s+/g, ' ').trim();
  }

  // Word-boundary match (Unicode-safe). "clay" alone doesn't count — only
  // "hey clay" — so "clay pot" / "display" never wake it.
  function match(text) {
    const n = ' ' + norm(text) + ' ';
    for (const p of phrases()) {
      const idx = n.indexOf(' ' + p + ' ');
      if (idx >= 0) {
        const rest = n.slice(idx + p.length + 2).trim();
        return { phrase: p, rest, before: n.slice(0, idx).trim() };
      }
    }
    return null;
  }
  const named = (text) => !!match(text);

  /* ── state ─────────────────────────────────────────────── */
  const S = { awake: false, until: 0, source: '', busy: false, timer: null, checkTimer: null, checkedIn: false };
  const subs = new Set();

  function emit() {
    const snap = state();
    subs.forEach(fn => { try { fn(snap); } catch (_) {} });
    try { window.dispatchEvent(new CustomEvent('clavis:wake-change', { detail: snap })); } catch (_) {}
    try { document.documentElement.setAttribute('data-clavis-awake', snap.awake ? (snap.busy ? 'busy' : 'awake') : 'asleep'); } catch (_) {}
  }

  function arm() {
    clearTimeout(S.timer);
    if (!S.awake || S.busy) return;
    const left = S.until - now();
    if (left <= 0) { sleep('window'); return; }
    S.timer = setTimeout(arm, Math.min(left + 30, 60000));
  }

  /* WHICH SOURCES MAY WAKE HIM.
   *
   * The wake word is off by default now. A recogniser listening for
   * "Rudra" in a room also hears the television, a passing conversation,
   * and — despite the echo guard — Rudra's own voice coming back off the
   * speakers. Every one of those false wakes opened a session, and an open
   * session is what produced "haan sir, boliye" at nobody, repeatedly, and
   * billed a model call for it.
   *
   * A snap cannot happen by accident. That is the whole point of it.
   * Re-enable the word with: clavis_wake_sources = 'snap,tap,typed,touch,word'
   */
  const DEFAULT_SOURCES = 'snap,clap,tap,typed,touch,orb,mic';
  function allowedSources() {
    let raw;
    try { raw = localStorage.getItem('clavis_wake_sources'); } catch (_) {}
    return String(raw || DEFAULT_SOURCES).toLowerCase().split(/[,\s]+/).filter(Boolean);
  }
  function sourceAllowed(src) {
    const list = allowedSources();
    if (list.indexOf('all') !== -1) return true;
    return list.indexOf(String(src || '').toLowerCase()) !== -1;
  }

  function wake(source = 'word', opts = {}) {
    if (window.ClavisVoiceState && !window.ClavisVoiceState.isClavisWorkspace()) return false;
    // A source he has not opted into must not open a session at all — not
    // even a short one, because an open session is what lets the proactive
    // layers speak.
    if (!opts.force && !sourceAllowed(source)) return false;
    const was = S.awake;
    S.awake = true;
    // A voice wake upgrades a typed one into a spoken session (not vice versa).
    if (!was || S.source === 'typed' || source !== 'typed') S.source = String(source || 'word');
    S.until = Math.max(S.until, now() + (Number(opts.ms) || (S.source === 'typed' ? shortFollowMs() : firstMs())));
    arm();
    armCheckIn();
    if (!was) emit();
    return true;
  }

  /* THE ONE THING HE IS ALLOWED TO SAY UNPROMPTED.
   *
   * Woken, then silence. Rather than sit there with an open session (and
   * the proactive layers free to talk), he asks once, quietly, and goes to
   * sleep. One line per wake — never a second, never a loop. */
  const CHECK_IN_MS = 75000;    // a little over a minute of nothing
  const CHECK_IN_LINES = [
    'Sir? … main hoon abhi bhi.',
    'Sir, aap gaye kya? Main so jaata hoon phir.',
    'Koi kaam nahi hai toh main chup ho jaata hoon, sir.',
  ];
  function armCheckIn() {
    clearTimeout(S.checkTimer);
    S.checkedIn = false;
    S.checkTimer = setTimeout(async () => {
      if (!S.awake || S.busy || S.checkedIn) return;
      S.checkedIn = true;
      try {
        const speechOn = localStorage.getItem('jarvis_speech_enabled') !== 'false'
          && localStorage.getItem('clavis_voice_muted') !== '1';
        if (speechOn) {
          const line = CHECK_IN_LINES[Math.floor(Math.random() * CHECK_IN_LINES.length)];
          await window.ClavisVoice?.speak?.(line, { unprompted: true });
        }
      } catch (_) {}
      sleep('no-reply');
    }, CHECK_IN_MS);
  }

  // touch() used to be a no-op while asleep, so typing in the composer never
  // actually woke Rudra24 AI — and every background caller stayed blocked behind
  // allowBackground(). Sir touching the composer IS sir talking to Rudra24 AI.
  function touch(ms, source) {
    const span = Number(ms) || followMs();
    if (!S.awake) { wake(source || 'touch', { ms: span }); return true; }
    S.until = Math.max(S.until, now() + span);
    arm();
    armCheckIn();   // he is still here; the sleepy line waits another round
    return true;
  }

  // busy(on, who): kai log ek saath busy ho sakte hain (jarvis_ui ka turn,
  // Rudra24 AI Live ka jawab) — har 'who' apna hold rakhta hai, sab chhodein tab
  // follow-up window shuru. Safety: koi hold BUSY_MAX_MS se zyada nahi
  // tikta, taaki ek bhula hua busy(true) Rudra24 AI ko hamesha jaaga na rakhe.
  const BUSY_MAX_MS = 90000;
  const holds = new Map();   // who -> safety timer
  function busy(on, who = 'main') {
    const b = !!on;
    const key = String(who || 'main');
    if (b) {
      clearTimeout(holds.get(key));
      holds.set(key, setTimeout(() => { if (holds.has(key)) busy(false, key); }, BUSY_MAX_MS));
    } else if (holds.has(key)) {
      clearTimeout(holds.get(key));
      holds.delete(key);
    }
    const nb = holds.size > 0;
    if (nb === S.busy) { if (!nb && !b) touch(); return; }
    S.busy = nb;
    if (nb) { clearTimeout(S.timer); if (!S.awake) { S.awake = true; S.source = S.source || 'busy'; } }
    else { S.until = now() + followMs(); arm(); }
    emit();
  }

  function sleep(reason = 'manual') {
    if (!S.awake && !S.busy) return;
    S.awake = false; S.busy = false; S.until = 0; S.source = '';
    holds.forEach((t) => clearTimeout(t)); holds.clear();
    clearTimeout(S.timer);
    clearTimeout(S.checkTimer);
    S.checkedIn = false;
    S.lastSleep = { reason, at: now() };
    emit();
  }

  function isAwake() {
    if (S.busy) return true;
    if (S.awake && now() > S.until) { sleep('window'); return false; }
    return S.awake;
  }

  /* Background AI policy.
   *
   *   'off'  — only while Rudra24 AI is properly awake. That was the default, and
   *            it is why background replies never arrived: the awake window is
   *            about nine seconds after a reply, so proactive lines, vision
   *            and the mind loop almost never got a turn.
   *   'on'   — always allowed.
   *   'auto' — the default now. Allowed while sir is actually AT the app: this
   *            tab visible, the window focused, and some input in the last few
   *            minutes. Every background caller still enforces its own gap and
   *            per-hour cap, so key burn stays bounded — this only stops the
   *            blanket refusal that made Rudra24 AI mute.
   */
  const PRESENT_MS = 240000;    // "still at the desk" window
  let lastSeenAt = now();
  ['pointerdown', 'keydown', 'wheel', 'touchstart'].forEach((ev) => {
    try { window.addEventListener(ev, () => { lastSeenAt = now(); }, { passive: true, capture: true }); } catch (_) {}
  });
  try {
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') lastSeenAt = now();
    });
  } catch (_) {}

  function present() {
    try {
      if (document.visibilityState === 'hidden') return false;
      if (typeof document.hasFocus === 'function' && !document.hasFocus()) return false;
    } catch (_) {}
    return now() - lastSeenAt < PRESENT_MS;
  }

  function allowBackground() {
    if (!window.ClavisVoiceState?.isClavisWorkspace?.()) return false;
    const mode = ls('clavis_background_ai', 'auto');
    if (mode === 'on') return true;
    if (isAwake()) return true;
    if (mode === 'off') return false;
    return present();
  }

  function state() { return { awake: isAwakeNoSide(), until: S.until, source: S.source, busy: S.busy, holders: Array.from(holds.keys()), lastSleep: S.lastSleep || null, followMs: followMs(), continuous: continuous() }; }
  function isAwakeNoSide() { return S.busy || (S.awake && now() <= S.until); }

  function on(fn) { subs.add(fn); return () => subs.delete(fn); }

  // Typing in any composer = he's talking to Rudra24 AI.
  document.addEventListener('keydown', (e) => {
    const t = e.target;
    if (!t || !(t.matches?.('textarea, input[type="text"], [contenteditable="true"]'))) return;
    if (t.closest?.('#view-jarvis, #jarvis-view, #clavis-task-surface, .jarvis-input-wrap, .clavis-composer, #jarvis-input, .clavis-chat-composer')) touch(15000, 'typed');
  }, true);

  try { document.documentElement.setAttribute('data-clavis-awake', 'asleep'); } catch (_) {}

  window.ClavisWake = { isAwake, wake, touch, busy, sleep, match, named, norm, phrases, allowBackground, present, on, state, followMs, continuous, sessionMs,
    sources: allowedSources, sourceAllowed,
    _setClock: (fn) => { clock = typeof fn === 'function' ? fn : () => Date.now(); } };
})();
