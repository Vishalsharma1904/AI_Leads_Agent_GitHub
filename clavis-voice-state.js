/* ============================================================
 * clavis-voice-state.js · one voice state machine, one mic owner
 * ------------------------------------------------------------
 * Loaded right after clavis-wake.js, before jarvis_ui.js.
 *
 *   SLEEPING → LISTENING → USER_SPEAKING → PROCESSING → EXECUTING
 *            → ASSISTANT_SPEAKING → LISTENING …   (+ SILENT_MODE, ERROR)
 *
 * ClavisWake still decides awake/asleep (and the continuous session);
 * this module:
 *   · holds the explicit state (set() refuses transitions not in T),
 *   · owns the microphone: exactly ONE recognizer at a time (mic.claim),
 *   · runs a watchdog that restarts listening when a recognizer died while
 *     Clavis should be listening, and reconciles the state with reality so
 *     it can never stick in PROCESSING / ASSISTANT_SPEAKING,
 *   · semantic endpointing (endpointDelay), hold / release phrases,
 *   · stop / sleep / silent-for-N-minutes and yes/no parsing,
 *   · [[directive]] stripping for anything shown or spoken,
 *   · per-turn latency telemetry (metrics()) + Ctrl+Shift+D debug panel.
 * Pure helpers work in node (see tests/voice_state_selftest.js).
 * ============================================================ */
(function (root) {
  'use strict';
  if (root.ClavisVoiceState) return;

  let clock = () => Date.now();
  const now = () => clock();
  const ls = (k, d) => { try { const v = root.localStorage?.getItem(k); return v == null ? d : v; } catch (_) { return d; } };

  /* ── state machine ─────────────────────────────────────── */
  const STATES = ['SLEEPING', 'LISTENING', 'USER_SPEAKING', 'PROCESSING', 'EXECUTING', 'ASSISTANT_SPEAKING', 'SILENT_MODE', 'ERROR'];
  // SLEEPING and ERROR are reachable from anywhere.
  const T = {
    SLEEPING: ['LISTENING', 'USER_SPEAKING', 'PROCESSING'],
    LISTENING: ['USER_SPEAKING', 'PROCESSING', 'EXECUTING', 'ASSISTANT_SPEAKING', 'SILENT_MODE'],
    USER_SPEAKING: ['LISTENING', 'PROCESSING', 'EXECUTING', 'ASSISTANT_SPEAKING', 'SILENT_MODE'],
    PROCESSING: ['EXECUTING', 'ASSISTANT_SPEAKING', 'LISTENING', 'USER_SPEAKING', 'SILENT_MODE'],
    EXECUTING: ['PROCESSING', 'ASSISTANT_SPEAKING', 'LISTENING', 'USER_SPEAKING', 'SILENT_MODE'],
    ASSISTANT_SPEAKING: ['LISTENING', 'USER_SPEAKING', 'PROCESSING', 'SILENT_MODE'],
    SILENT_MODE: ['LISTENING', 'USER_SPEAKING', 'PROCESSING', 'EXECUTING'],
    ERROR: ['LISTENING'],
  };
  const S = { state: 'SLEEPING', since: now(), why: '', history: [], silentUntil: 0 };
  const subs = new Set();

  function set(next, why = '') {
    if (next === S.state) return true;
    if (!T[next]) return false;
    if (next !== 'SLEEPING' && next !== 'ERROR' && !T[S.state].includes(next)) return false;
    S.history.push({ from: S.state, to: next, why, at: now() });
    if (S.history.length > 40) S.history.shift();
    S.state = next; S.since = now(); S.why = why;
    subs.forEach((fn) => { try { fn(next, why); } catch (_) {} });
    try { root.document?.documentElement?.setAttribute('data-clavis-voice', next.toLowerCase()); } catch (_) {}
    return true;
  }
  // Where an awake Clavis rests between turns.
  const rest = (why) => {
    const w = root.ClavisWake;
    if (w && !w.isAwake()) return set('SLEEPING', why || 'asleep');
    return set(isSilent() ? 'SILENT_MODE' : 'LISTENING', why || 'rest');
  };

  /* ── silent mode ("5 minute chup raho") ────────────────── */
  function isSilent() { return now() < S.silentUntil; }
  function silence(ms) {
    S.silentUntil = now() + Math.max(0, Number(ms) || 0);
    try { root.ClavisWake?.touch?.(ms + 5000); } catch (_) {}
    set('SILENT_MODE', 'silent ' + Math.round(ms / 60000) + ' min');
  }
  function unsilence() { S.silentUntil = 0; if (S.state === 'SILENT_MODE') set('LISTENING', 'silence over'); }

  /* ── mic ownership: one recognizer at a time ───────────── */
  const mic = {
    owner: null, stopFn: null, since: 0, restarts: 0, lastRevive: 0,
    claim(owner, stopFn) {
      if (this.owner && this.owner !== owner) {
        const f = this.stopFn;
        this.owner = null; this.stopFn = null;
        try { if (typeof f === 'function') f(); } catch (_) {}
      }
      this.owner = owner; this.stopFn = stopFn || null; this.since = now();
    },
    release(owner) { if (this.owner === owner) { this.owner = null; this.stopFn = null; } },
  };

  /* ── endpointing ───────────────────────────────────────── */
  // Moved from jarvis_ui.js (it aliases them): finished command / dangling word.
  const DONE_END = /(\b(karo|kardo|kar do|kariye|kijiye|karein|karna hai|dikhao|dikha do|dikhaiye|batao|bata do|bataiye|samjhao|kholo|khol do|band karo|band kar do|hatao|hata do|nikalo|nikal do|bhejo|bhej do|likho|likh do|chahiye|chalao|chala do|dhundho|dhoondho|lao|le aao|sunao|bolo|ruko|bas|chup|stop|please|thanks|thank you|shukriya|done|ho gaya|theek hai|hai na|kya hai|kaun hai|kahan hai|kaise ho|hai|hain|hoon|hun|tha|thi|hoga|hogi|sakte ho|sakta hai|do na|dena)|[?!.।])\s*$/i;
  const DANGLING_END = /\b(ki|ke|ka|ko|se|me|mein|par|pe|aur|ya|ki jo|jo|jaise|matlab|yaani|mtlb|like|um+|uh+|hmm+|toh|to|phir|fir|abhi|bhi|ek|koi|kuch|mujhe|mujhko|muje|tum|tumhe|tumko|aap|aapko|hum|hame|humko|main|mai|mera|meri|mere|apna|apni|and|or|but|the|a|an|for|of|in|with|my|your|this|that|okay|ok|so|well|actually|basically|because|then|clavis|sir)$/i;
  function isFragment(text) {
    const t = String(text || '').trim().toLowerCase().replace(/[.,!?।]+$/g, '');
    const words = t.split(/\s+/).filter(Boolean);
    if (!words.length) return true;
    if (words.length > 6) return false;
    if (DONE_END.test(t)) return false;
    if (/\b(karo|kar|kijiye|dikhao|dikha|batao|bata|kholo|khol|band|hatao|nikalo|nikal|bhejo|likho|likh|chahiye|chalao|dhundho|lao|search|open|close|show|find|send|write|play|call|leads?|map|photo|photos)\b/.test(t) && !DANGLING_END.test(t)) return false;
    if (words.length <= 3 && /^(aur|to|toh|phir|fir|matlab|and|so|or|ya)\b/.test(t)) return true;
    return DANGLING_END.test(t);
  }
  // English "remind me / tell me" ends a sentence; Hindi "gurgaon me" does not.
  const dangles = (t) => DANGLING_END.test(t) && !/\b(tell|remind|call|show|give|help|send|text|email|ping|excuse|let|wake|for) me$/i.test(t);
  const HOLD_RE = /(^|\s)(wait|wait wait|ruko|ruk jao|ruk ja|ek (?:minute|min|mint|second|sec|sec(?:ond)?)(?: ruko)?|let me finish|let me think|abhi mat bolo|mat bolo abhi|hold on|one sec(?:ond)?|sochne do|bolne do)$/i;
  const RELEASE_RE = /(^|\s)(done|bas itna(?: hi)?|ab batao|ab bolo|go ahead|ho gaya|that'?s it|over)$/i;
  const HOLD_MAX_MS = 15000;
  const bare = (t) => String(t || '').toLowerCase().replace(/[,.!?।…]+/g, ' ').replace(/\s+/g, ' ').trim();
  const isHold = (t) => HOLD_RE.test(bare(t));
  const isRelease = (t) => RELEASE_RE.test(bare(t));
  // Silence (ms, measured from the last partial) needed before the turn ends.
  function endpointDelay(text, o = {}) {
    const raw = String(text || '').trim();
    const t = bare(raw);
    if (!t) return Infinity;
    if (isRelease(t)) return stripHold(raw) ? 0 : Infinity;
    if (o.holding || isHold(t)) return Infinity;
    if (dangles(t) || (isFragment(t) && !/ me$/.test(t))) return 2800;
    if (DONE_END.test(raw.toLowerCase()) || DONE_END.test(t)) return 450;
    return 850;
  }
  // 'commit' | 'wait' | 'hold' for text after silenceMs of quiet.
  function decide(text, silenceMs, o = {}) {
    const d = endpointDelay(text, o);
    if (d === Infinity) {
      if ((o.holding || isHold(text)) && silenceMs >= HOLD_MAX_MS) return stripHold(text) ? 'commit' : 'drop';
      return bare(text) ? 'hold' : 'wait';
    }
    return silenceMs >= d ? 'commit' : 'wait';
  }
  function stripHold(text) {
    let t = String(text || '').trim(), prev;
    const HEAD = /^(wait|wait wait|ruko|ruk jao|ruk ja|ek (?:minute|min|mint|second|sec)(?: ruko)?|let me finish|let me think|abhi mat bolo|mat bolo abhi|hold on|one sec(?:ond)?|sochne do|bolne do)\b[,.!…]*\s*/i;
    const TAIL = /\s*[,.]?\s*\b(done|bas itna(?: hi)?|ab batao|ab bolo|go ahead|ho gaya|that'?s it|over|wait|ruko|ruk jao|ek (?:minute|min|second|sec)|hold on|let me finish|abhi mat bolo)[.!…]*$/i;
    do { prev = t; t = t.replace(HEAD, '').replace(TAIL, '').trim(); } while (t !== prev);
    return t;
  }

  /* ── stop / sleep / silent / yes-no ────────────────────── */
  const NUM = { ek: 1, one: 1, do: 2, two: 2, teen: 3, three: 3, char: 4, chaar: 4, four: 4, paanch: 5, panch: 5, five: 5, das: 10, dus: 10, ten: 10, pandrah: 15, fifteen: 15, bees: 20, twenty: 20, tees: 30, thirty: 30, aadha: 0.5, half: 0.5 };
  const DUR_RE = /(\d+(?:\.\d+)?|ek|one|do|two|teen|three|char|chaar|four|paanch|panch|five|das|dus|ten|pandrah|fifteen|bees|twenty|tees|thirty|aadha|half)\s*(?:an?\s*)?(sec(?:ond)?s?|min(?:ute)?s?|mint|ghant[ae]|hours?|hrs?)\b/i;
  const QUIET_RE = /\b(silent|silence|quiet|chup|shaant|shant|mute|shut up|mat bolo|mat bolna)\b/i;
  const SLEEP_RE = /\b(stop listening|listening band|sunna band|so jao|sojao|go to sleep|sleep mode|that'?s all|bas karo|conversation band(?: karo)?|baat band(?: karo)?|goodbye|good bye|bye bye|bye clavis|good night|thodi der (?:chup|so|aaram)\w*)\b|सो जाओ|बस करो/i;
  const HUSH_RE = /^(?:please |clavis |arre |arey )?(shut up|stop talking|stop it|stop|chup|chup karo|chup ho jao|chup raho|be quiet|quiet|wait|ruko|ruk jao|bas|enough|khamosh)(?: please| sir| clavis| yaar| na)?$/i;
  function parseStop(text) {
    const t = bare(text);
    if (!t) return null;
    const words = t.split(' ').length;
    const d = t.match(DUR_RE);
    if (d && QUIET_RE.test(t) && words <= 10) {
      const n = NUM[d[1].toLowerCase()] ?? Number(d[1]);
      const u = d[2].toLowerCase();
      const unit = /^sec/.test(u) ? 1000 : /^(ghant|hour|hr)/.test(u) ? 3600000 : 60000;
      const ms = Math.min(2 * 3600000, Math.max(5000, n * unit));
      if (ms) return { kind: 'silent', ms };
    }
    if (SLEEP_RE.test(t) && words <= 6) return { kind: 'sleep' };
    if (HUSH_RE.test(t)) return { kind: 'hush' };
    return null;
  }
  const YES_RE = /^(haan|han|ha|haa|haanji|haan ji|ji haan|ji|yes|yeah|yep|yup|kar do|kardo|karo|kar dijiye|ok|okay|theek hai|thik hai|sure|bilkul|chalo|go ahead|do it|please do)\b/i;
  const NO_RE = /^(na|naa|nah|nahi|nahin|nai|no|nope|mat karo|mat|rehne do|rahne do|cancel|mat kar|nahi karna|don'?t)\b/i;
  const NO_ANY = /\b(nahi|nahin|mat karo|rehne do|rahne do|cancel|don'?t)\b/i;
  function parseYesNo(text) {
    const t = bare(text).replace(/^(sir|clavis|arre|arey|hmm+|um+)\s+/, '');
    if (!t) return null;
    // Its own question heard back ("… haan ya na?") is not an answer.
    if (/\b(haan|yes)\b.*\b(ya|or)\b.*\b(na|nahi|no)\b/.test(t)) return null;
    if (NO_RE.test(t)) return 'no';
    if (YES_RE.test(t)) return NO_ANY.test(t) ? 'no' : 'yes';
    if (NO_ANY.test(t)) return 'no';
    return null;
  }

  /* ── [[directive]] stripping (shown + spoken text) ─────── */
  // [[silent]] / [[pause]] … are removed; any other [[words]] is a real line the
  // model wrapped by mistake → unwrap. Orphan leading "[[" / trailing "]]" go.
  // Code fences are left alone (bash has [[ -f x ]]); [text](url) is untouched.
  const DIRECTIVE_RE = /\[\[\s*(?:silent|pause|stop|end|sleep|noop|none|wait|listen|continue|break|skip|mute|no[_ -]?reply)\s*\]\]/gi;
  function stripDirectives(text) {
    const parts = String(text == null ? '' : text).split(/(```[\s\S]*?```)/);
    for (let i = 0; i < parts.length; i += 2) {
      let t = parts[i];
      t = t.replace(DIRECTIVE_RE, '');
      t = t.replace(/\[\[([^\[\]\n]*)\]\]/g, '$1');
      if (i === 0) t = t.replace(/^\s*\[\[\s*/, '');
      if (i === parts.length - 1) t = t.replace(/\s*\]\]\s*$/, '');
      t = t.replace(/([.?!।…"'”])\]\](?!\()/g, '$1');
      t = t.replace(/[ \t]{2,}/g, ' ');
      parts[i] = t;
    }
    return parts.join('').trim();
  }

  /* ── telemetry ─────────────────────────────────────────── */
  const KEYS = ['speech_start', 'first_partial', 'last_voice', 'final', 'endpoint', 'intent', 'dispatch', 'llm_first_token', 'tts_first_audio'];
  const SPANS = {
    'partial_lag': ['speech_start', 'first_partial'],
    'endpoint_wait': ['last_voice', 'endpoint'],
    'intent': ['endpoint', 'intent'],
    'dispatch': ['endpoint', 'dispatch'],
    'llm_first_token': ['endpoint', 'llm_first_token'],
    'tts_first_audio': ['endpoint', 'tts_first_audio'],
    'reply_after_speech': ['last_voice', 'tts_first_audio'],
  };
  const ring = [];
  let cur = null;
  function mark(key, t) {
    if (!KEYS.includes(key)) return;
    const at = t == null ? now() : t;
    if ((key === 'speech_start' || key === 'first_partial') && (!cur || cur.endpoint != null)) {
      cur = {}; ring.push(cur); if (ring.length > 60) ring.shift();
    }
    if (!cur) return;
    // What happens after the turn ended belongs to it only once it has ended
    // (a greeting / an earlier reply must not count as this turn's audio).
    if (KEYS.indexOf(key) > KEYS.indexOf('endpoint') && cur.endpoint == null) return;
    if (key === 'first_partial' && cur.speech_start == null) cur.speech_start = at;
    if (key === 'last_voice') { cur.last_voice = at; return; }
    if (cur[key] == null) cur[key] = at;
  }
  function pct(sorted, p) { return sorted.length ? sorted[Math.min(sorted.length - 1, Math.ceil(p / 100 * sorted.length) - 1)] : null; }
  function metrics() {
    const spans = {};
    const last = {};
    Object.entries(SPANS).forEach(([name, [a, b]]) => {
      const vals = ring.filter((r) => r[a] != null && r[b] != null && r[b] >= r[a]).map((r) => r[b] - r[a]);
      const s = vals.slice().sort((x, y) => x - y);
      spans[name] = { n: s.length, p50: pct(s, 50), p90: pct(s, 90), p95: pct(s, 95) };
      if (vals.length) last[name] = vals[vals.length - 1];
    });
    return { turns: ring.length, spans, last, raw: ring.slice(-10) };
  }

  /* ── watchdog ──────────────────────────────────────────── */
  // hooks from jarvis_ui.js: shouldListen(), alive(), revive(), busyTurn()
  const hooks = { shouldListen: () => false, alive: () => true, revive: () => {}, busyTurn: () => false, speaking: () => false };
  const W = { deadSince: 0, lastPartialAt: 0, timer: 0 };
  function tick() {
    const wake = root.ClavisWake;
    const awake = wake ? wake.isAwake() : true;
    const st = S.state;
    if (!awake && st !== 'SLEEPING') set('SLEEPING', 'wake window closed');
    else if (awake && st === 'SLEEPING') rest('woken');
    else if (st === 'SILENT_MODE' && !isSilent()) set('LISTENING', 'silence over');
    else if (st === 'ASSISTANT_SPEAKING' && !hooks.speaking() && now() - S.since > 2000) rest('speech ended');
    else if ((st === 'PROCESSING' || st === 'EXECUTING') && !hooks.busyTurn() && now() - S.since > 45000) rest('turn timeout');
    else if (st === 'USER_SPEAKING' && now() - Math.max(S.since, W.lastPartialAt) > 20000) rest('no speech');
    else if (st === 'ERROR' && now() - S.since > 1500) rest('recover');
    // A dead mic while Clavis should be listening → restart it.
    let should = false, alive = true;
    try { should = !!hooks.shouldListen(); alive = !!hooks.alive(); } catch (_) {}
    if (should && !alive) {
      if (!W.deadSince) W.deadSince = now();
      if (now() - W.deadSince >= 1500 && now() - mic.lastRevive >= 1500) {
        mic.lastRevive = now(); mic.restarts++;
        try { hooks.revive(); } catch (e) { console.warn('[ClavisVoiceState] revive failed', e); }
      }
    } else W.deadSince = 0;
  }
  function configure(h) {
    Object.assign(hooks, h || {});
    if (!W.timer && typeof root.setInterval === 'function') W.timer = root.setInterval(tick, 750);
  }
  function notePartial() { W.lastPartialAt = now(); }

  /* ── debug panel (Ctrl+Shift+D) ────────────────────────── */
  const dbg = { el: null, timer: 0, last: '' };
  function fmt(v) { return v == null ? '–' : Math.round(v) + ' ms'; }
  function panelText() {
    const m = metrics();
    const w = root.ClavisWake?.state?.() || {};
    const ext = (() => { try { return hooks.debug?.() || {}; } catch (_) { return {}; } })();
    const row = (k, v) => `<div><span>${k}</span><b>${v}</b></div>`;
    let h = row('state', S.state) + row('mic', (mic.owner || 'none') + (mic.restarts ? ` · ${mic.restarts} restarts` : ''))
      + row('wake', w.awake ? `awake · ${Math.max(0, Math.round(((w.until || 0) - now()) / 1000))} s${w.busy ? ' · busy' : ''}` : 'asleep')
      + row('session', ls('clavis_continuous', 'true') !== 'false' ? 'continuous' : 'follow-up only')
      + row('ASR', ext.asr || '–') + row('LLM', ext.llm || '–') + row('TTS', ext.tts || '–');
    if (isSilent()) h += row('silent', Math.round((S.silentUntil - now()) / 1000) + ' s');
    h += '<hr>';
    Object.entries(m.spans).forEach(([k, s]) => { h += row(k, `${fmt(m.last[k])} · p50 ${fmt(s.p50)} · p95 ${fmt(s.p95)}`); });
    return h;
  }
  function panelTick() {
    if (!dbg.el) return;
    const h = panelText();
    if (h !== dbg.last) { dbg.last = h; dbg.el.querySelector('.cvs-body').innerHTML = h; }
  }
  function togglePanel(force) {
    const doc = root.document;
    if (!doc) return;
    const on = force == null ? !dbg.el : !!force;
    if (!on) { dbg.el?.remove(); dbg.el = null; clearInterval(dbg.timer); dbg.timer = 0; return; }
    if (dbg.el) return;
    if (!doc.getElementById('cvs-style')) {
      const st = doc.createElement('style');
      st.id = 'cvs-style';
      st.textContent = '#clavis-voice-debug{position:fixed;left:16px;bottom:16px;z-index:2147483000;width:340px;max-width:calc(100vw - 32px);'
        + 'background:var(--cc-surface,#fff);color:var(--cc-ink,#141413);border:1px solid var(--cc-line,rgba(0,0,0,.1));border-radius:12px;'
        + 'box-shadow:var(--cc-sh-pop,0 8px 24px rgba(0,0,0,.12));font:12px/1.5 var(--cc-sans,system-ui,sans-serif);padding:10px 12px;'
        + 'animation:cvs-in .42s var(--cc-ease,cubic-bezier(.16,1,.3,1))}'
        + '#clavis-voice-debug .cvs-head{display:flex;justify-content:space-between;font-weight:600;margin-bottom:6px;color:var(--cc-ink-2,#3d3d3a)}'
        + '#clavis-voice-debug .cvs-body div{display:flex;justify-content:space-between;gap:12px}'
        + '#clavis-voice-debug .cvs-body span{color:var(--cc-mute,#73726c)}#clavis-voice-debug b{font-weight:500;font-variant-numeric:tabular-nums;text-align:right}'
        + '#clavis-voice-debug hr{border:0;border-top:1px solid var(--cc-line,rgba(0,0,0,.1));margin:6px 0}'
        + '@keyframes cvs-in{from{opacity:0;transform:translateY(6px) scale(.98)}to{opacity:1;transform:none}}'
        + '@media (prefers-reduced-motion:reduce){#clavis-voice-debug{animation:none}}';
      doc.head.appendChild(st);
    }
    const el = doc.createElement('div');
    el.id = 'clavis-voice-debug';
    el.setAttribute('role', 'status');
    el.innerHTML = '<div class="cvs-head"><span>Clavis voice</span><span>Ctrl+Shift+D</span></div><div class="cvs-body"></div>';
    doc.body.appendChild(el);
    dbg.el = el; dbg.last = '';
    panelTick();
    dbg.timer = setInterval(panelTick, 250);
  }
  try {
    root.document?.addEventListener?.('keydown', (e) => {
      if (e.ctrlKey && e.shiftKey && !e.altKey && (e.key === 'D' || e.key === 'd' || e.code === 'KeyD')) { e.preventDefault(); togglePanel(); }
    }, true);
  } catch (_) {}

  /* ── settings toggle (continuous conversation) ─────────── */
  function injectSetting() {
    const doc = root.document;
    const anchor = doc?.getElementById('sm-live-patience')?.closest('.smodal-field');
    if (!anchor || doc.getElementById('sm-continuous-toggle')) return;
    const f = doc.createElement('div');
    f.className = 'smodal-field';
    f.innerHTML = '<div class="smodal-field-left"><label class="smodal-label" for="sm-continuous-toggle">Continuous conversation</label>'
      + '<span class="smodal-hint">After you wake Clavis, keep talking without its name until you say "so jao" / "bas karo", or 3 minutes of quiet</span></div>'
      + '<label class="smodal-switch"><input type="checkbox" id="sm-continuous-toggle"><span class="smodal-switch-track"><span class="smodal-switch-thumb"></span></span></label>';
    anchor.after(f);
    const cb = f.querySelector('input');
    cb.checked = ls('clavis_continuous', 'true') !== 'false';
    cb.addEventListener('change', () => { try { root.localStorage.setItem('clavis_continuous', cb.checked ? 'true' : 'false'); } catch (_) {} });
  }
  try {
    if (root.document) {
      if (root.document.readyState === 'loading') root.document.addEventListener('DOMContentLoaded', injectSetting, { once: true });
      else setTimeout(injectSetting, 0);
    }
  } catch (_) {}

  root.ClavisVoiceState = {
    STATES, T,
    state: () => S.state, since: () => S.since, history: () => S.history.slice(), set, rest, on: (fn) => { subs.add(fn); return () => subs.delete(fn); },
    isSilent, silence, unsilence, silentUntil: () => S.silentUntil,
    mic, configure, notePartial,
    DONE_END, DANGLING_END, isFragment, endpointDelay, decide, isHold, isRelease, stripHold, HOLD_MAX_MS,
    parseStop, parseYesNo, stripDirectives,
    mark, metrics, togglePanel,
    continuous: () => ls('clavis_continuous', 'true') !== 'false',
    _tick: tick, _setClock: (fn) => { clock = typeof fn === 'function' ? fn : () => Date.now(); },
  };
})(typeof window !== 'undefined' ? window : globalThis);
