/**
 * ============================================================
 *  CLAVIS PROACTIVE ENGINE (clavis-proactive.js)
 *
 *  Clavis stops waiting to be asked. It watches WHAT you are working on
 *  (foreground window/tab title + OS idle time, read from the local bridge)
 *  and speaks first when that pattern says you could use help.
 *
 *  HONEST SCOPE — read this before trusting it:
 *    - It reads the *title* of your active window and your OS idle time.
 *      It does NOT read your screen contents, keystrokes or files. A browser
 *      window title is the active tab's title, which is how it knows the tab.
 *    - It needs clavis-bridge running for OS-wide awareness. Without the
 *      bridge it degrades to in-app signals only (tab visibility, typing).
 *    - "Emotion" here is BEHAVIOURAL inference (switch rate, dwell, idle,
 *      time of day) — not real affect detection. Named honestly as `mood`.
 *
 *  Annoyance budget is the whole design: a proactive assistant that talks
 *  too much gets muted. Gaps, per-hour caps, focus protection and an
 *  ignore-backoff are all enforced before a single word is spoken.
 * ============================================================
 */
'use strict';

(() => {
  const LS = {
    enabled:  'clavis_proactive_enabled',
    gapMs:    'clavis_proactive_gap_ms',
    perHour:  'clavis_proactive_per_hour',
    privacy:  'clavis_proactive_share_titles',
  };

  const POLL_MS       = 2000;    // how often we sample the foreground window
  const HISTORY_MAX   = 80;
  const DEFAULT_GAP   = 600000;  // 10 min between proactive lines
  const MIN_GAP       = 300000;  // never closer than 5 min, whatever is saved
  const DEFAULT_HOUR  = 3;       // max proactive lines per hour
  const AWAY_MS       = 180000;  // 3 min idle = away from desk
  const DEEP_FOCUS_MS = 300000;  // 5 min on one thing = protect it
  const STUCK_MS      = 150000;  // 2.5 min on one thing = maybe stuck
  const ERROR_RE      = /\b(error|exception|failed|failure|crash|fatal|syntaxerror|typeerror|referenceerror|traceback|404|500|bug|issue|stackoverflow|debug|terminal|powershell|cmd\.exe|bash)\b/i;  // 15 min on one thing = maybe stuck

  // Window titles can carry private things. Anything matching this never
  // leaves the machine and is replaced with a neutral label.
  const SENSITIVE = /bank|netbank|paytm|phonepe|upi|\botp\b|password|passwd|credential|wallet|incognito|private browsing|aadhaar|pan card|salary|payslip/i;

  const state = {
    running: false,
    timer: null,
    history: [],          // [{ app, title, at, ms }]
    current: null,        // { app, title, since }
    idleMs: 0,
    // Give the user a quiet landing. Proactivity begins only after the
    // normal budget window or a meaningful context change.
    lastSpokeAt: Date.now(),
    spokenAt: [],         // timestamps, for the per-hour cap
    snoozeUntil: 0,
    ignoredStreak: 0,
    lastMood: '',
    lastMoodAt: 0,
    bridgeUp: false,
    bridgeWarned: false,
    lastUserActivityAt: Date.now(),
  };

  // ── settings ────────────────────────────────────────────
  const num = (k, d) => { const v = Number(localStorage.getItem(k)); return Number.isFinite(v) && v > 0 ? v : d; };
  const isEnabled   = () => localStorage.getItem(LS.enabled) !== 'false';   // default ON
  const shareTitles = () => localStorage.getItem(LS.privacy) !== 'false';   // default ON
  const gapMs       = () => Math.max(MIN_GAP, num(LS.gapMs, DEFAULT_GAP));
  const perHour     = () => Math.min(4, num(LS.perHour, DEFAULT_HOUR));

  function safeTitle(t) {
    const s = String(t || '').trim();
    if (!s) return '';
    if (!shareTitles()) return '[hidden]';
    return SENSITIVE.test(s) ? '[private window]' : s.slice(0, 120);
  }

  // ── sampling ────────────────────────────────────────────
  async function sample() {
    let info = null;
    try { info = await window.ClavisPC?.activeWindow?.(); } catch (_) { info = null; }

    state.bridgeUp = Boolean(info);
    if (!info) {
      // Browser-only fallback: we at least know if this tab is focused.
      info = { title: document.hasFocus() ? 'Clavis' : '', process: 'browser', idleMs: 0 };
      if (!state.bridgeWarned) {
        state.bridgeWarned = true;
        console.info('[ClavisProactive] Bridge off — OS-wide awareness disabled, using in-app signals only.');
      }
    }

    state.idleMs = Number(info.idleMs) || 0;
    if (state.idleMs < 4000) state.lastUserActivityAt = Date.now();

    const app = String(info.process || '').toLowerCase();
    const title = safeTitle(info.title);
    const now = Date.now();

    const changed = !state.current || state.current.app !== app || state.current.title !== title;
    if (changed) {
      if (state.current) {
        state.history.push({ ...state.current, ms: now - state.current.since, at: state.current.since });
        if (state.history.length > HISTORY_MAX) state.history.shift();
      }
      state.current = { app, title, since: now };
    }
  }

  // ── behavioural read ────────────────────────────────────
  function signals() {
    const now = Date.now();
    const dwell = state.current ? now - state.current.since : 0;
    const recent = state.history.filter(h => now - h.at < 120000);   // last 2 min
    const switches = recent.length;
    const distinct = new Set(recent.map(h => h.app + '|' + h.title)).size;
    const hour = new Date().getHours();

    // Bouncing between a small set of things many times = scattered.
    const bouncing = switches >= 8 && distinct <= 4;

    return {
      dwell, switches, distinct, bouncing,
      idleMs: state.idleMs,
      away: state.idleMs > AWAY_MS,
      lateNight: hour >= 23 || hour < 5,
      longSession: now - (state.history[0]?.at || now) > 5400000, // ~90 min
      app: state.current?.app || '',
      title: state.current?.title || '',
    };
  }

  // Behavioural mood — proactively detects stuck/debugging states.
  function readMood(s) {
    if (s.away) return 'away';
    // If active window indicates an error, exception, or debugging site for > 35 seconds
    const hasError = ERROR_RE.test(`${s.app || ''} ${s.title || ''}`);
    if (hasError && s.dwell > 35000) return 'stuck';
    if (s.bouncing) return 'scattered';
    if (s.dwell > STUCK_MS) return 'stuck';
    if (s.lateNight && s.longSession) return 'tired';
    if (s.dwell > DEEP_FOCUS_MS) return 'focused';
    return 'working';
  }

  // ── budget gates ────────────────────────────────────────
  function maySpeak(mood) {
    const now = Date.now();
    if (!isEnabled()) return false;
    if (now < state.snoozeUntil) return false;
    if (window.isClavisSpeaking?.()) return false;
    if (window.isClavisListening?.()) return false;
    if (document.hidden && !state.bridgeUp) return false;

    // Never interrupt real focus, and never nag someone who stepped away.
    if (mood === 'focused' || mood === 'away') return false;

    if (now - state.lastSpokeAt < gapMs() * (1 + state.ignoredStreak)) return false;

    state.spokenAt = state.spokenAt.filter(t => now - t < 3600000);
    if (state.spokenAt.length >= perHour()) return false;

    // One nudge per mood transition, not per tick.
    if (mood === state.lastMood && now - state.lastMoodAt < 180000) return false;

    return Boolean(window.ClavisCognition?.admitSignal?.('proactive:' + mood, 1));
  }

  // ── what to say ─────────────────────────────────────────
  // Works with NO api key via templates; upgrades to the LLM when a key exists.
  const FALLBACK = {
    scattered: [
      'Sir, aap kaafi tabs ke beech switch kar rahe hain. Bataiye kya karna hai — main ek jagah list bana deta hoon.',
      'Sir, dhyan bat raha hai lagta hai. Ek kaam chunte hain aur baaki main note kar leta hoon?',
    ],
    stuck: [
      'Sir, kya main kuch help karoon? Lagta hai aap yahan atak gaye hain — bataiye kya problem aa rahi hai.',
      'Sir, main dekh raha hoon aap thoda phas gaye lagte hain. Agar aap bolenge toh main screen dekh kar solution sochta hoon.',
      'Sir, kya main help karu? Aap bolenge toh page ka screenshot lekar analyze kar deta hoon ya prompt taiyaar kar doon.',
      'Sir, lagta hai koi issue aa raha hai. Kya main screenshot lekar ChatGPT ya Claude ke liye prompt bana doon?',
    ],
    tired: [
      'Sir, raat kaafi ho gayi hai aur aap kaafi der se kaam par hain. Thoda break le lijiye — main yahin hoon.',
      'Sir, itni der baad thakan aa jati hai. Paani pi lijiye, phir main aage sambhal leta hoon.',
    ],
    working: [
      'Sir, kuch chahiye ho to bata dijiye — main dekh raha hoon.',
      'Sir, kuch kaam ho toh boliye — main free hoon.',
      'Sir, koi help chahiye toh batayein, main hoon.',
      'Sir, agar kuch karna hai toh bol dijiye — ready hoon.',
      'Sir, main yahan hoon — aap boliye bass.',
      'Sir, agar leads chahiye ya data, toh bol dijiye.',
    ],
  };

  function pick(arr, scope = 'proactive') {
    return window.ClavisEmotionalEngine?.pickDifferent?.(arr, scope)
      || arr[Math.floor(Math.random() * arr.length)];
  }

  function contextDigest(s) {
    const recent = state.history.slice(-6)
      .map(h => `${h.app || '?'}: ${h.title || '?'} (${Math.round((h.ms || 0) / 1000)}s)`)
      .join('\n');
    return [
      `Current: ${s.app || '?'} — ${s.title || '?'} (${Math.round(s.dwell / 1000)}s)`,
      `Switches in last 2 min: ${s.switches}`,
      `Idle: ${Math.round(s.idleMs / 1000)}s`,
      `Local time: ${new Date().toLocaleTimeString()}`,
      recent ? `Recent:\n${recent}` : '',
    ].filter(Boolean).join('\n');
  }

  async function composeLine(mood, s) {
    const canLLM = Boolean(window.ClavisDirect?.complete && window.ClavisDirect.hasKey?.());
    if (!canLLM) return pick(FALLBACK[mood] || FALLBACK.working);

    const sys = [
      'You are Clavis, a proactive personal AI assistant for one user.',
      'You always address the user as "sir", warmly and respectfully.',
      'You speak Hinglish (Hindi written in Latin script mixed with English) unless the context is clearly English.',
      'You were NOT asked a question. You noticed something in the user\'s work pattern and are speaking first.',
      'Rules: ONE or TWO short sentences, max ~28 words. Be concretely useful, not generic.',
      'Offer a specific next action you can actually do (make a list, take a screenshot, open something, summarise, remind).',
      'Never claim to read their screen contents or files — you only see window titles.',
      'Do not greet, do not introduce yourself, do not use emoji. Just say the helpful thing.',
    ].join(' ');

    const moodHint = {
      scattered: 'They are switching between many windows rapidly — likely distracted or juggling.',
      stuck:     'They have been on the same window a very long time — possibly stuck or grinding.',
      tired:     'It is late at night and they have worked a long session — likely tired.',
      working:   'Normal working state — only speak if genuinely useful.',
    }[mood] || '';

    try {
      const data = await window.ClavisDirect.complete({
        messages: [
          { role: 'system', content: sys },
          { role: 'user', content: `Observed state: ${mood}. ${moodHint}\n\n${contextDigest(s)}\n\nSay your one proactive line now.` },
        ],
        max_tokens: 90,
      });
      const text = String(data?.choices?.[0]?.message?.content || '').trim();
      return text || pick(FALLBACK[mood] || FALLBACK.working);
    } catch (_) {
      return pick(FALLBACK[mood] || FALLBACK.working);
    }
  }

  // Shared delivery path for ANY proactive line, regardless of what noticed
  // it (window-title mood, or ClavisVision's screen understanding). Keeping
  // one path means one set of anti-spam bookkeeping and one speech-priority
  // queue — a vision-sourced nudge can't land on top of a real answer any
  // more than a title-sourced one can.
  function deliver(line, mood) {
    let outgoing = String(line || '').trim();
    if (!outgoing) return;
    // A model-generated nudge must obey the same anti-repeat rule as a normal
    // answer. If it repeats a recent opener, use a contextual local line
    // instead of making the user hear the same offer twice.
    if (window.ClavisEmotionalEngine?.shouldRewrite?.(outgoing)) {
      outgoing = pick(FALLBACK[mood] || FALLBACK.working, `proactive:${mood}`);
    }
    window.ClavisEmotionalEngine?.rememberAssistant?.(outgoing);
    // A vision-sourced idea goes through Clavis Live too (its own words).
    if (window.ClavisLive?.isAvailable?.()) {
      const live = () => { if (window.ClavisLive.proactive({ mood, line: outgoing })) book(mood); };
      if (window.ClavisMind?.speech) window.ClavisMind.speech.request({ source: 'casual_initiative', deliver: live });
      else live();
      return;
    }
    const say = () => {
      const now = Date.now();
      state.lastSpokeAt = now;
      state.spokenAt.push(now);
      state.lastMood = mood;
      state.lastMoodAt = now;
      state.ignoredStreak = Math.min(state.ignoredStreak + 1, 3); // reset on any user reply

      try { window.appendJarvisBubble?.('assistant', escapeHtml(outgoing)); window.scrollJarvisToBottom?.(); } catch (_) {}
      try { window.speakJarvisText?.(outgoing); } catch (_) {}
      window.dispatchEvent(new CustomEvent('clavis:proactive', { detail: { mood, line: outgoing } }));
    };
    if (window.ClavisMind?.speech) window.ClavisMind.speech.request({ source: 'casual_initiative', deliver: say });
    else say();
  }

  async function intervene(mood, s) {
    // Live voice available: skip the template/LLM line and hand Clavis the
    // real context, so what it says is specific and never sounds scripted.
    if (window.ClavisLive?.isAvailable?.()) {
      const digest = contextDigest(s);
      if (mood === 'working' && !s.title) return;   // nothing specific to offer
      const say = () => {
        if (!window.ClavisLive.proactive({ mood, context: digest })) return;
        book(mood);
      };
      if (window.ClavisMind?.speech) window.ClavisMind.speech.request({ source: 'casual_initiative', deliver: say });
      else say();
      return;
    }
    const line = await composeLine(mood, s);
    deliver(line, mood);
  }

  function book(mood) {
    const now = Date.now();
    state.lastSpokeAt = now;
    state.spokenAt.push(now);
    state.lastMood = mood;
    state.lastMoodAt = now;
    state.ignoredStreak = Math.min(state.ignoredStreak + 1, 3);
  }

  // Same budget/etiquette gate `intervene` uses, exposed so another signal
  // source (ClavisVision) asks permission before speaking instead of having
  // its own separate — and easily out-of-sync — anti-spam rules.
  function canSpeak(mood = 'working') { return maySpeak(mood); }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  // ── main loop ───────────────────────────────────────────
  async function tick() {
    try {
      await sample();
      const s = signals();
      const mood = readMood(s);
      if (maySpeak(mood)) await intervene(mood, s);
    } catch (err) {
      console.warn('[ClavisProactive] tick failed:', err);
    }
  }

  function start() {
    if (state.running) return true;
    state.running = true;
    state.timer = window.setInterval(tick, POLL_MS);
    tick();
    return true;
  }

  function stop() {
    state.running = false;
    if (state.timer) { clearInterval(state.timer); state.timer = null; }
  }

  // The user engaging resets the ignore-backoff — they clearly don't mind.
  function acknowledge() { state.ignoredStreak = 0; }
  function snooze(minutes = 30) {
    state.snoozeUntil = Date.now() + minutes * 60000;
    return state.snoozeUntil;
  }
  function setEnabled(on) {
    localStorage.setItem(LS.enabled, on ? 'true' : 'false');
    if (on) start(); else stop();
    return on;
  }

  function status() {
    const s = signals();
    return {
      running: state.running,
      enabled: isEnabled(),
      bridgeUp: state.bridgeUp,
      mood: readMood(s),
      signals: s,
      spokenLastHour: state.spokenAt.filter(t => Date.now() - t < 3600000).length,
      snoozedFor: Math.max(0, Math.round((state.snoozeUntil - Date.now()) / 1000)),
      ignoredStreak: state.ignoredStreak,
    };
  }

  window.ClavisProactive = { start, stop, status, snooze, setEnabled, acknowledge, tick, deliver, canSpeak };

  // Autostart once the page is ready (default ON, per user request).
  const boot = () => { if (isEnabled()) start(); };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
