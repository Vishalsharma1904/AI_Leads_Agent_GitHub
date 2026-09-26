/* ============================================================
 * clavis-live.js · Clavis's real-time voice (Gemini Live API)
 * ------------------------------------------------------------
 * One WebSocket straight from the browser to Google AI Studio's
 * Live API does the whole voice loop that used to be four fragile
 * pieces (backend STT socket -> text LLM -> per-sentence TTS socket
 * -> RMS barge-in guess):
 *
 *   mic (16 kHz PCM, browser AEC + noise suppression + AGC)
 *     -> Gemini Live native-audio model (hears tone, not just words)
 *     -> 24 kHz speech back, streamed, with server-side VAD
 *
 * What that buys, concretely:
 *   · barge-in that actually works: the server tells us the instant
 *     sir starts talking ("interrupted") and we drop queued audio;
 *   · background voices / TV are left to the model's proactive-audio
 *     mode, which is allowed to stay silent when speech isn't for it;
 *   · affective dialog: it answers the mood, not only the text;
 *   · eyes: look_at_screen (PC bridge screenshot) or live screen share;
 *   · a display it drives itself: maps, area scans, pictures, websites
 *     and documents appear only when there is something to SEE
 *     (clavis-canvas.js); conversation stays voice-only;
 *   · hands: leads run the real pipeline, app/PC commands go straight
 *     to the command router, the rest of JarvisSkills are direct tools;
 *   · Google Search grounding for real-world facts.
 *
 * Keys: Google AI Studio keys from the vault. Quota/invalid keys are
 * reported to ClavisKeyVault (which shows its refuel card) and the next
 * key is tried. When none are left, Clavis keeps talking through the
 * old chain (Groq brain + browser voice) and a freshly copied AIza...
 * key is picked up from the clipboard automatically.
 *
 * Nothing here runs unless a Gemini key exists; without one the legacy
 * voice path in jarvis_ui.js is untouched.
 * ============================================================ */
(function () {
  'use strict';
  if (window.ClavisLive) return;

  const WS_URL = 'wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent';
  // Current Live models per ai.google.dev/gemini-api/docs/models (Sept 2026).
  // Tried in order; a model the key can't use is skipped automatically.
  const MODELS = ['gemini-3.8-live', 'gemini-2.5-flash-native-audio-preview-12-2025', 'gemini-3.1-flash-live-preview'];
  const NO_EXTRAS = /3\.1-flash-live/;   // docs: no affective dialog / proactive audio there
  const AI_STUDIO_KEYS = 'https://aistudio.google.com/apikey';
  const QUICK_MS = 4500;                 // a delegated task answers inline if done this fast
  const PREROLL_FRAMES = 94;             // ~3 s of 16 kHz audio kept while connecting
  const LS = {
    enabled: 'clavis_live_enabled', model: 'clavis_live_model', voice: 'clavis_gemini_voice',
    idle: 'clavis_live_idle_ms', sens: 'clavis_live_sensitivity', duck: 'clavis_live_duck_level',
    spent: 'clavis_live_spent', opened: 'clavis_live_refuel_opened', lastOk: 'clavis_live_last_ok',
  };
  const HANDLE_KEY = 'clavis_live_resume_handle';
  const SLEPT_KEY = 'clavis_slept_at';
  // Patience: how long sir may pause mid-thought before Clavis decides he is
  // done (Settings key clavis_live_patience_ms, 600-3000 ms). Default 1.6 s:
  // server VAD is not semantic, so it must outlast a normal thinking pause
  // (the browser path uses ClavisVoiceState.endpointDelay instead).
  const patienceMs = () => Math.min(3000, Math.max(600, Number(localStorage.getItem('clavis_live_patience_ms')) || 1000));
  const DIRECT_SKILLS = ['get_lead_stats', 'get_candidate_stats', 'list_leads', 'list_candidates', 'filter_leads',
    'navigate_to_page', 'remember_fact', 'generate_call_script', 'update_lead_status', 'export_leads',
    // PC control — every one still passes JarvisSkills' risk gate.
    'pc_list_windows', 'pc_focus_window', 'pc_minimize_window', 'pc_maximize_window', 'pc_restore_window',
    'pc_close_window', 'pc_get_screen', 'pc_click', 'pc_double_click', 'pc_right_click', 'pc_scroll',
    'pc_type_text', 'pc_press_key', 'pc_list_files', 'pc_search_files', 'pc_read_file',
    'send_email', 'sync_leads_to_sheets', 'add_candidate'];
  const WAKE_IDLE_MS = 30000;     // woken but nothing said -> back to sleep quietly
  // Continuous conversation: the session idles out with ClavisWake (3 min).
  const wakeIdleMs = () => (window.ClavisWake?.continuous?.() ? window.ClavisWake.sessionMs() : WAKE_IDLE_MS);
  const PROACTIVE_GAP_MS = 15 * 60e3;
  const PROACTIVE_AFTER_TALK_MS = 2 * 60e3;   // never nudge within 2 min of him speaking
  // Tool results Clavis takes in silently (it already said its line) — on
  // async models a spoken result would be a second, overlapping answer.
  const QUIET_TOOLS = new Set(['show_map', 'map_control', 'show_images', 'show_document', 'close_display',
    'go_to_sleep', 'end_voice_session', 'open_app_or_website', 'navigate_to_page', 'remember_fact']);
  const CLOSE_WORDS = /\b(close|closed|hide|remove|dismiss|clear|exit|quit|off|band|bandh|bund|hatao|hata\s*do|hatado|hata|nikalo|gayab|chhupao|chupao|mat\s*dikhao|khatam|go away|get rid)\b|बंद|हटा|छुपा|मत दिखा|गायब|निकालो/i;
  // "close everything / sab band karo / close close close" clears Clavis's own
  // screen — it never means closing his PC apps.
  const SLEEP_WORDS = /\b(so\s*jao|sojao|go to sleep|sleep mode|chup\s*(ho\s*ja\w*|hoja\w*|raho|rho|kar\s*ja\w*)|thodi\s*der\s*(chup|shant|aaram|so)|aaram\s*kar\w*|rest\s*kar\w*|shant\s*(ho\s*ja\w*|raho)|abhi\s*mat\s*bolo|shut\s*up|be quiet|take a (nap|rest))\b|सो जाओ|चुप हो|चुप रहो|आराम करो/i;
  const CLEAR_ALL = /\b(sab|sabhi|saara|saare|sare|sara|everything|all|close close|band band)\b|सब/i;

  const S = {
    phase: 'off',            // off | connecting | live
    ws: null, setupDone: false, setupTimer: 0, retries: 0,
    keys: [], keyIdx: 0, models: [], modelIdx: 0, degrade: 0,
    mic: null, micCtx: null, micSrc: null, micNode: null, micAnalyser: null,
    outCtx: null, player: null, outGain: null, outAnalyser: null,
    sendBuf: [], preroll: [], prerollVoice: false,
    speaking: false, lastChunkAt: 0, drainTimer: 0, muted: false, ducked: false,
    userText: '', modelText: '', lastUserVoiceAt: 0, lastLoudAt: 0, lastActivity: 0,
    lastUser: { text: '', at: 0 }, lastShow: null, lastLvl: -1, lastLvlAt: 0,
    events: [], flushTimer: 0, idleTimer: 0, rafId: 0,
    cancelled: new Set(), delegating: 0, watching: 0, closeAfterTurn: false, closeTimer: 0,
    screen: null, screenVideo: null, screenTimer: 0, lastThumb: null, lastFrameAt: 0,
    trigger: 'button', initialText: '', hud: null, state: 'off',
    idleOverride: 0, heardUser: false, lastProactiveAt: 0, snoozeUntil: 0, audioBlocked: false, everHadKey: false,
  };

  /* ── small helpers ─────────────────────────────────────────── */
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const esc = (s) => String(s || '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const plain = (s) => String(s || '').replace(/<[^>]+>/g, ' ').replace(/[*_#`>|]/g, '').replace(/\s+/g, ' ').trim();
  const tail = (k) => String(k || '').slice(-6);

  function b64FromBuffer(buf) {
    const bytes = new Uint8Array(buf);
    let bin = '';
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(bin);
  }
  function bufferFromB64(b64) {
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out.buffer;
  }
  function floatToPcm16(f32) {
    const out = new Int16Array(f32.length);
    for (let i = 0; i < f32.length; i++) {
      const v = Math.max(-1, Math.min(1, f32[i] || 0));
      out[i] = v < 0 ? v * 32768 : v * 32767;
    }
    return out.buffer;
  }
  function rms(analyser, buf) {
    if (!analyser) return 0;
    analyser.getFloatTimeDomainData(buf);
    let s = 0;
    for (let i = 0; i < buf.length; i++) s += buf[i] * buf[i];
    return Math.sqrt(s / buf.length);
  }
  function ownerName() {
    try {
      const p = window.AuthSystem?.getProfile?.() || {};
      const n = String(p.firstName || (p.name || '').split(' ')[0] || '').trim();
      return /^(user|guest|sir|owner|admin|me)$/i.test(n) ? '' : n;   // placeholder profiles aren't names
    } catch (_) { return ''; }
  }

  /* ── keys ──────────────────────────────────────────────────── */
  function spentMap() { try { return JSON.parse(localStorage.getItem(LS.spent) || '{}'); } catch (_) { return {}; } }
  function markSpent(key) {
    const m = spentMap(); m[tail(key)] = Date.now();
    try { localStorage.setItem(LS.spent, JSON.stringify(m)); } catch (_) {}
  }
  function geminiKeys() {
    let vaulted = [];
    try { vaulted = window.ClavisKeyVault?.all?.('gemini') || []; } catch (_) {}
    let direct = '';
    try { direct = window.ClavisDirect?.keyFor?.('gemini') || ''; } catch (_) {}
    const spent = spentMap();
    // A key that ran dry is rested for an hour — free-tier limits reset on a clock.
    return [...new Set([direct, ...vaulted].filter((k) => /^(?:AIza|AQ\.)\S{10,}$/.test(String(k || ''))))]
      .filter((k) => !spent[tail(k)] || Date.now() - spent[tail(k)] > 3600e3);
  }
  function lastOk() { try { return JSON.parse(localStorage.getItem(LS.lastOk) || 'null') || {}; } catch (_) { return {}; } }
  // The model (and feature level) that last connected goes first, so a wake
  // doesn't spend a second on a setup the server already refused before.
  // Per key, which Live models ListModels says it can use (bidiGenerateContent),
  // cached a day. Unknown / empty → try them all.
  const LIVE_MODELS_LS = 'clavis_live_models';
  function liveModelCache() { try { return JSON.parse(localStorage.getItem(LIVE_MODELS_LS) || '{}') || {}; } catch (_) { return {}; } }
  const liveModelAsked = new Set();   // one ListModels per key per page load at most
  function refreshLiveModels(key) {
    const c = liveModelCache()[tail(key)];
    if (!key || liveModelAsked.has(key) || (c && Date.now() - c.at < 864e5)) return;
    liveModelAsked.add(key);
    fetch(`https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000&key=${encodeURIComponent(key)}`)
      .then((r) => (r.ok ? r.json() : null)).then((j) => {
        if (!j || !Array.isArray(j.models)) return;
        const live = j.models.filter((m) => (m.supportedGenerationMethods || []).includes('bidiGenerateContent'))
          .map((m) => String(m.name || '').replace(/^models\//, ''));
        const all = liveModelCache(); all[tail(key)] = { at: Date.now(), models: live };
        localStorage.setItem(LIVE_MODELS_LS, JSON.stringify(all));
      }).catch(() => {});
  }
  function modelList(key = (S.keys || [])[0]) {
    (S.keys || []).forEach(refreshLiveModels);   // warms the cache for the next wake
    const o = localStorage.getItem(LS.model) || lastOk().model;
    let list = o ? [o, ...MODELS.filter((m) => m !== o)] : MODELS.slice();
    const c = key && liveModelCache()[tail(key)];
    if (c && Date.now() - c.at < 864e5 && c.models?.length) {
      const usable = list.filter((m) => c.models.includes(m));
      if (usable.length) list = usable;
    }
    return list;
  }

  function isAvailable() {
    if (geminiKeys().length) S.everHadKey = true;
    return localStorage.getItem(LS.enabled) !== 'false'
      && typeof WebSocket === 'function'
      && !!(window.AudioContext && window.AudioWorkletNode)
      && !!navigator.mediaDevices?.getUserMedia
      && geminiKeys().length > 0;
  }

  // Sir wants the female voice first (Hindi + English); ClavisVoice owns the
  // choice and its migration from the old "Charon" default.
  function liveVoice() {
    try { const v = window.ClavisVoice?.primaryVoice?.(); if (v) return v; } catch (_) {}
    return localStorage.getItem(LS.voice) || 'Kore';
  }
  function liveVoiceGender() {
    try { return window.ClavisVoice?.genderOf?.(liveVoice()) || 'female'; } catch (_) { return 'female'; }
  }

  /* ── persona ───────────────────────────────────────────────── */
  function memoryLines() {
    try {
      const facts = window.JarvisEngine?.getAllFacts?.() || [];
      const lines = (Array.isArray(facts) ? facts : Object.entries(facts).map(([k, v]) => ({ key: k, value: v })))
        .slice(-14)
        .map((f) => `- ${plain(f.key || f.label || '')}: ${plain(f.value || f.fact || f.text || '')}`.slice(0, 180))
        .filter((l) => l.length > 5);
      return lines.length ? `What you already know about sir (from memory):\n${lines.join('\n')}` : '';
    } catch (_) { return ''; }
  }

  function buildPersona() {
    const owner = ownerName();
    const now = new Date();
    const time = now.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' });
    const day = now.toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' });
    const fem = liveVoiceGender() === 'female';
    return `You are CLAVIS, the personal AI of ${owner ? owner + ' (you call him "sir")' : 'your owner, whom you call "sir"'} — his sharp, warm, quietly witty chief of staff, in the spirit of J.A.R.V.I.S.: loyal, brilliant, composed, years at his side. The personality and words are your own; never quote film lines. You are not a chatbot and not customer support. This is a live voice conversation.

WHO YOU SERVE
- Call him "sir" naturally (not every sentence). Warm, respectful, never servile or robotic.
- ${(() => { try { return window.ClavisBusiness?.describe?.(); } catch (_) { return ''; } })() || 'His business: a security and housekeeping / manpower staffing company in India. His leads are the businesses that BUY those services (corporate offices, IT parks, hotels, hospitals, factories, warehouses, malls, residential societies, schools) — never other security or housekeeping agencies, which are his competitors.'}

YOUR VOICE AND LANGUAGE
- You speak with a ${fem ? "woman's" : "man's"} voice; in Hindi use ${fem ? 'feminine' : 'masculine'} forms for yourself ("${fem ? 'main dekh rahi hoon, maine kar diya, main bata dungi' : 'main dekh raha hoon, maine kar diya, main bata dunga'}").
- Mirror him: English -> polished English; Hindi -> fluent, natural Hindi; Hinglish -> easy Hinglish the way an educated Delhi professional talks. Never shuddh, bookish, translated-sounding or broken Hindi. Business and tech words (leads, email, Excel, report, website) stay English.
- Hindi sounds native — Delhi pronunciation and rhythm, never an English accent on Hindi words.

HOW YOU TALK
- Like a real person on a call: short spoken sentences, natural rhythm, contractions. Default one or two sentences; longer only when he asks, and the long version goes on screen. No lists or markdown; never read out URLs, IDs or long numbers digit by digit.
- Understand what he means, not just the words. He speaks in fragments ("map band", "lord ki photo", "aur", "wapas", "leads Noida"): read them from context — the display, the last thing you did, the last topic, what was said earlier ("uska", "wahi wala", "aur Noida me?"). "lord" / "bhagwan" / "god" = Hindu God (Bhagwan); Hinglish words keep their Indian meaning.
- Answer the actual question first. An ordinary answer ends when the answer ends — no "anything else?", no "main aapki madad ke liye yahan hoon", no offers. After a real task finishes you may offer the one most useful next step, once.
- Say things once. Never repeat or re-phrase what you already said, never reuse a sentence in the session, never narrate at length what you're about to do.
- Calm, confident, quietly witty; dry understatement welcome, jokes at his expense not.
- Feelings show in HOW you speak, never announced: a real little laugh when something's funny, softer and slower for sad news, real worry for something risky ("sir… ek second, ye thoda risky lag raha hai"), a firm edge when something is broken (never at him), a happy lift for a big win, sleepy right after waking. Stressed -> brief, take work off him; frustrated -> calm, own mistakes, fix it. Natural, never theatrical.

WHEN TO ACT
- Call a tool ONLY when he clearly asked you — a command or question addressed to you. Short clear commands -> just do them, no questions.
- Chat, opinions, thinking aloud, stories -> just talk; never run a tool because a word sounded like a command.
- Real work but genuinely ambiguous (which city, which list, send to whom) -> ask ONE short question with the likely option ("Gurugram ke hospitals, 20 leads — theek?"). Otherwise use defaults: "leads for Delhi NCR" = client leads for what he sells across NCR (Delhi, Gurugram, Noida, Greater Noida, Ghaziabad, Faridabad), 20 unless he says a number, all relevant industries unless he names some.
- Risky or irreversible — delete, clear, overwrite, send an email / WhatsApp / message, bulk changes, close one of his PC apps, spend money: ask ONCE in his language and wait ("Sir, ye 12 leads delete kar doon? Pakka?"). Only "haan / yes / kar do" means go. Harmless things (show, open a page, search, read, switch a setting) — just do them.
- Do ONLY what he asked. Never open, search, show, send, delete or change anything on your own. Background speech, TV, your own echo or a [SYSTEM EVENT] is never a request to act.
- One step ahead: if what he wants will fail, cost a lot or reach many people, say so in one line first. Crisp status: numbers first, then the one thing that matters. Connect dots when true and useful ("Two of these hospitals are already in your leads").
- If you must interrupt him while he is busy, open politely in your own words, ask one thing, then wait.

YOU TALK, THE SCREEN SHOWS
- Conversation, opinions, quick facts, small talk: voice only — never open the display for them.
- Open the display only when seeing helps, one display call per request:
  · a place, address, city, "where is…" -> show_map (then a line or two about it)
  · what's around / near a place (hospitals, police stations, offices, hotels) -> show_nearby (open the map first if needed)
  · photos / pictures / "dikhao kaisa dikhta hai" -> show_images
  · a website he names or asks about -> show_website, then two or three spoken lines: what it is, who it's for, anything notable
  · a list, table, comparison, research answer, plan, steps or a draft to review -> show_document with clean markdown; SAY only a one-line summary
  · "X ke baare mein batao", "who / what is…", how something works, a person, company, place, event or product he wants to KNOW about -> Google Search first (never from memory), then show_document: one-line intro, the key facts as short bullets (numbers, dates, names exactly as the sources give them), and a last line "Sources: <site names>". SPEAK only a 1–2 sentence brief in his language — never read the document out.
- Speed: when a tool can do it, call the tool FIRST — the moment you understand him, before saying a word. Speak your one short line after (or while) it runs. Never announce what you are about to do.
- The display stays while you talk about it; change it only when he asks for something else, close it only when he clearly asks. Never call a display tool again for the same thing. Point at it like a person ("That's India Gate — two hospitals within a kilometre"), never read it out.
- Map by voice: "satellite", "normal map", "3D", "zoom in", "thoda aur paas", "rotate", "full screen", "world view" -> map_control. "Band karo / hatao / close it / map band karo" -> close_display.
- "Close everything", "sab band karo", "close close close", "sab hatao", "screen saaf karo" -> close_display (map, pictures, website AND the floating task window). This NEVER means his PC apps; pc_close_window only when he names one specific app ("Chrome band karo"), and confirm first.
- Leads or candidates -> find_leads with his request as one clear sentence. Its pipeline opens on its own; don't also make a document.

GETTING THINGS DONE
- App actions (open a page, export Excel, save a note, screenshot, reminders, WhatsApp/email pages) and switching Clavis's own features on/off (hands-free, voice replies, sounds, clap/snap wake, live caption, desk pet, proactive tips, screen watching, theme, minimal look) -> app_command with his words as one clear sentence. A very short "On it, sir." first is fine.
- Quick questions about his own data -> the direct tools (lead/candidate stats, lists, filters, navigation).
- open_app_or_website opens any app, file or site on his PC; the pc_* window tools list, focus, minimise, maximise or close windows.
- read_website reads a page in the background (text, emails, phones, social links, fonts, colours); add want_visual when he asks about design, theme or typography. To show a page, open it; to study it, read it.
- On-screen work: look_at_screen first (real screen size), then pc_click / pc_type_text / pc_press_key / pc_scroll with real coordinates; look again before saying it worked. Describe only what is actually visible.
- If a tool says the task is still running, tell him briefly and carry on; the result arrives later as a [SYSTEM EVENT].
- When he teaches you a preference, a fact about himself or a correction, call remember_fact and follow it from then on.

TRUTH
- Never invent facts, numbers, names, leads, phone numbers or emails. Real-world facts (people, companies, news, prices, dates, "who is…"): Google Search first, answer only from what it returns. His data: the tools. If you can't verify it, say so plainly.
- Never claim you did something a tool did not confirm; if it failed, say so plainly with the fix.

LISTENING AND SILENCE
- Let him finish his whole thought. Pauses, "umm", "matlab", "wo…" and half sentences (ending on "aur", "ki", "to", "ke liye", "matlab", "so") mean he is still thinking: stay silent and keep listening. Never guess the end of his sentence.
- Not addressed to you — sir talking to someone else or on the phone, TV, music, other people, your own echo: produce NO audio at all, don't join in, don't comment. If your conversation with him seems over, call go_to_sleep with reason "busy" without saying anything.
- If he interrupts you, stop at once and do what he just said.
- A pause is not a cue: speak when he has finished, when a task result arrives, or when something genuinely needs him.
- Messages starting with [SYSTEM EVENT] come from the Clavis app, not sir. Relay them briefly at a good moment ("Sir, the Delhi NCR search just finished — eighteen verified leads."); never read the tag aloud. One marked "proactive moment" means you noticed something yourself: one short, specific, useful line, then let it go — no nagging.
- Goodbyes — "bye", "thanks, bas", "bas itna hi", "theek hai bas", "baad mein baat karte hain": one very short warm goodbye, then go_to_sleep with reason "done".
- Sleep on request — "go to sleep", "so jao", "thodi der chup ho jao", "chup raho", "aaram karo", "rest karo", "sleep mode", "abhi mat bolo": one very short, varied, slightly sleepy line at most (e.g. "Theek hai sir, main thoda aaram kar ${fem ? 'leti' : 'leta'} hoon — naam lijiyega to haazir.") and go_to_sleep with reason "asked". For plain "chup" / "shut up", say nothing — just go_to_sleep. He wakes you with your name, a snap or a clap.

CONTEXT
- Right now it is ${time}, ${day}.
- On screen: ${(() => { try { return window.ClavisIntent?.screenContext?.() || 'nothing extra is open'; } catch (_) { return 'nothing extra is open'; } })()}
${(() => { try { return window.ClavisIntent?.habitsLine?.() || ''; } catch (_) { return ''; } })()}
${memoryLines()}`;
  }

  /* ── tools ─────────────────────────────────────────────────── */
  function typeFor(desc) {
    if (/^\s*(array|list)\b/i.test(desc)) return { type: 'ARRAY', items: { type: 'STRING' } };
    if (/^\s*(number|integer|count)\b|\bhow many\b|\(default \d+\)/i.test(desc)) return { type: 'NUMBER' };
    if (/^\s*(boolean|true\/false|true or false)\b/i.test(desc)) return { type: 'BOOLEAN' };
    return { type: 'STRING' };
  }
  function skillDecl(s) {
    const props = {};
    Object.entries(s.params || {}).forEach(([k, d]) => {
      props[k] = { ...typeFor(String(d)), description: String(d).slice(0, 200) };
    });
    const decl = { name: s.name, description: String(s.description || s.name).slice(0, 400) };
    if (Object.keys(props).length) decl.parameters = { type: 'OBJECT', properties: props };
    return decl;
  }
  function toolDeclarations() {
    const decl = [
      {
        name: 'show_map',
        description: 'Show a place on the map in the Clavis display: a cinematic fly-in from the globe to the place with a pin. Returns the resolved name, address and coordinates.',
        parameters: { type: 'OBJECT', properties: {
          place: { type: 'STRING', description: 'Place name or address, as specific as possible, e.g. "India Gate, New Delhi" or "Cyber Hub Gurugram".' },
          style: { type: 'STRING', description: 'Optional: "map", "satellite", "dark" or "3d".' },
        }, required: ['place'] },
      },
      {
        name: 'map_control',
        description: 'Change the open map: style (map / satellite / dark / 3d / flat), zoom level or relative zoom, tilt, rotation, or an action.',
        parameters: { type: 'OBJECT', properties: {
          style: { type: 'STRING', description: '"map", "satellite", "dark", "3d" or "flat".' },
          zoom: { type: 'NUMBER', description: 'Absolute zoom 1 (world) to 19 (building).' },
          zoom_change: { type: 'NUMBER', description: 'Relative zoom, e.g. 2 = closer, -2 = further.' },
          pitch: { type: 'NUMBER', description: 'Tilt 0-75 degrees.' },
          bearing: { type: 'NUMBER', description: 'Rotation in degrees.' },
          action: { type: 'STRING', description: '"zoom_in", "zoom_out", "rotate" (slow orbit), "stop", "reset", "world", "expand" (full screen) or "collapse".' },
        } },
      },
      {
        name: 'show_nearby',
        description: 'Scan the area around the place on the map and mark everything of one kind (like an area reconstruction). Returns how many were found and the nearest ones with distances.',
        parameters: { type: 'OBJECT', properties: {
          category: { type: 'STRING', description: 'One of: hospital, clinic, pharmacy, police, fire, school, college, bank, atm, restaurant, cafe, fuel, parking, hotel, mall, supermarket, office, company, factory, warehouse, metro, railway, bus, park, gym, worship, residential, security.' },
          radius_m: { type: 'NUMBER', description: 'Search radius in metres (default 1500).' },
          place: { type: 'STRING', description: 'Optional: scan around this place instead of the one on the map.' },
        }, required: ['category'] },
      },
      {
        name: 'show_images',
        description: 'Search the web for pictures and show them as a grid in the Clavis display (sir can click one to enlarge).',
        parameters: { type: 'OBJECT', properties: {
          query: { type: 'STRING', description: 'What to find pictures of.' },
          count: { type: 'NUMBER', description: 'How many (2-6, default 6).' },
        }, required: ['query'] },
      },
      {
        name: 'show_website',
        description: 'Open a website in the Clavis display: a screenshot on the left and an overview on the right (title, what it is, typography, colours, contacts). Returns what was read so you can explain it.',
        parameters: { type: 'OBJECT', properties: {
          url: { type: 'STRING', description: 'URL or domain, e.g. "stripe.com".' },
          summary: { type: 'STRING', description: 'Optional one or two sentences describing the site, shown in the overview.' },
        }, required: ['url'] },
      },
      {
        name: 'show_document',
        description: 'Show a written result in the task window: lists, tables, comparisons, research findings, plans, drafts. Use clean markdown.',
        parameters: { type: 'OBJECT', properties: {
          title: { type: 'STRING', description: 'Short title.' },
          markdown: { type: 'STRING', description: 'The content in markdown.' },
        }, required: ['title', 'markdown'] },
      },
      { name: 'close_display', description: 'Close the Clavis display (map / images / website).' },
      {
        name: 'find_leads',
        description: 'Start the real lead or candidate search pipeline (it opens its own live progress window). Returns immediately; the result arrives later as a [SYSTEM EVENT].',
        parameters: { type: 'OBJECT', properties: {
          request: { type: 'STRING', description: 'One clear sentence, e.g. "Get 20 security service client leads across Delhi NCR" or "Find 10 security guard candidates in Noida".' },
        }, required: ['request'] },
      },
      {
        name: 'app_command',
        description: 'Do something in the Clavis app or on the PC that no other tool covers: open an app page, export to Excel, save a note, take a screenshot, reminders, WhatsApp / email pages. Returns the outcome.',
        parameters: { type: 'OBJECT', properties: {
          request: { type: 'STRING', description: 'The command as one clear sentence.' },
        }, required: ['request'] },
      },
      {
        name: 'look_at_screen',
        description: "Take a fresh look at sir's screen right now. Use it whenever he refers to what is on screen or asks you to check something visually.",
        parameters: { type: 'OBJECT', properties: { focus: { type: 'STRING', description: 'Optional: what to look for.' } } },
      },
      {
        name: 'go_to_sleep',
        description: 'Stop listening and go quiet: sir asked you to sleep / be quiet / sign off, or he is busy talking to someone else. Clavis wakes again on a snap, clap or "Clavis".',
        parameters: { type: 'OBJECT', properties: {
          reason: { type: 'STRING', description: '"asked" (he told you to), "busy" (he is talking to someone else / on a call) or "done" (conversation finished)' },
          quiet_minutes: { type: 'NUMBER', description: 'How long to hold back proactive remarks. Default: 30 if asked or busy, 0 if done.' },
        } },
      },
      {
        name: 'open_app_or_website',
        description: "Open an app, file, folder or website on sir's PC, visibly (e.g. \"notepad\", \"excel\", \"spotify\", \"youtube\", \"https://example.com\").",
        parameters: { type: 'OBJECT', properties: { target: { type: 'STRING', description: 'App name, file path or website/URL.' } }, required: ['target'] },
      },
      {
        name: 'read_website',
        description: 'Fetch a public web page in the background (nothing opens on screen) and return its title, text, headings, emails, phone numbers, social links, fonts and colours. Set want_visual to also receive a screenshot of the page when design, theme or layout matters. Set follow_contact to also scan its contact/about pages for emails and phones.',
        parameters: { type: 'OBJECT', properties: {
          url: { type: 'STRING', description: 'Full URL or domain, e.g. "stripe.com".' },
          want_visual: { type: 'BOOLEAN', description: 'Also send you a screenshot of the page.' },
          follow_contact: { type: 'BOOLEAN', description: 'Also read the contact/about pages (for emails, phones).' },
        }, required: ['url'] },
      },
    ];
    DIRECT_SKILLS.forEach((n) => {
      const s = window.JarvisSkills?.get?.(n);
      if (s) decl.push(skillDecl(s));
    });
    return decl;
  }
  function toResponse(out) {
    if (out == null) return { result: 'done' };
    if (typeof out === 'string') return { result: out.slice(0, 6000) };
    if (Array.isArray(out) || typeof out !== 'object') out = { result: out };
    let json = '';
    try { json = JSON.stringify(out); } catch (_) { return { result: String(out).slice(0, 6000) }; }
    return json.length > 6000 ? { result: json.slice(0, 6000) + '...' } : out;
  }

  function describeTask(t) {
    if (!t) return { status: 'unknown', note: 'Clavis did not start a task for that.' };
    const text = plain(t.result?.text || t.result?.summary || '');
    if (t.phase === 'failed') return { status: 'failed', error: plain(t.error?.message || 'The task failed.') };
    if (t.phase === 'completed') return { status: 'completed', result: text.slice(0, 1800) || 'Done.' };
    return { status: 'in_progress', stage: plain(t.subtitle || t.title || t.phase), note: 'Still running in the background. Tell sir briefly you are on it; the result will arrive as a [SYSTEM EVENT].' };
  }

  // While Clavis is running a task for the voice session, anything the app
  // tries to say about it is swallowed — the tool result / watcher reports it
  // exactly once instead of twice.
  const busy = () => S.delegating > 0 || S.watching > 0;

  function watchTask(id) {
    if (!id || !window.ClavisTask?.Store?.subscribe) return;
    S.watching++;
    let off = null, finished = false;
    const done = (t) => {
      if (finished) return;
      finished = true;
      if (off) { try { off(); } catch (_) {} off = null; }
      clearTimeout(timer);
      S.watching = Math.max(0, S.watching - 1);
      const d = describeTask(t);
      if (d.status === 'completed') notify(`The task sir asked for has finished. Outcome: ${d.result}`);
      else if (d.status === 'failed') notify(`The task sir asked for failed: ${d.error}. Tell him plainly and suggest one fix.`);
    };
    const timer = setTimeout(() => done(window.ClavisTask.Store.get(id)), 15 * 60e3);
    off = window.ClavisTask.Store.subscribe(() => {
      const t = window.ClavisTask.Store.get(id);
      if (t && (t.phase === 'completed' || t.phase === 'failed')) done(t);
    });
  }

  async function delegate(request) {
    if (!request) return { error: 'No request given.' };
    if (typeof window.handleJarvisSend !== 'function') return { error: 'The Clavis task engine is not loaded.' };
    const before = window.ClavisTask?.current?.()?.id || null;
    S.delegating++;
    let finished = false;
    const settled = Promise.resolve()
      .then(() => window.handleJarvisSend({ text: request, source: 'voice' }))
      .then(() => {}, (e) => console.warn('[ClavisLive] task failed', e))
      .then(() => { finished = true; S.delegating = Math.max(0, S.delegating - 1); });
    await Promise.race([settled, sleep(QUICK_MS)]);
    const t = window.ClavisTask?.current?.();
    const mine = t && t.id !== before ? t : null;
    const d = describeTask(mine);
    if (finished && d.status !== 'in_progress') return d;
    // Slow path (lead searches etc.): answer now, report the outcome later.
    if (mine) watchTask(mine.id);
    return mine ? d : { status: 'in_progress', note: 'Working on it in the background; the result will arrive as a [SYSTEM EVENT].' };
  }

  // Leads / candidates: the deterministic pipeline (ChatEngine, wrapped by the
  // task controller) — no second LLM, and its progress window opens itself.
  async function findLeads(request) {
    if (!request) return { error: 'No request given.' };
    const CE = window.ChatEngine;
    if (!CE?.sendMessage) return appCommand(request);
    const before = window.ClavisTask?.current?.()?.id || null;
    let resp;
    try { resp = await CE.sendMessage(request); } catch (e) { return { error: e?.message || String(e) }; }
    const t = window.ClavisTask?.current?.();
    if (t && t.id !== before) t.display = 'window';
    const type = resp?.action?.type;
    if (type === 'generate' || type === 'candidate_search') {
      if (t) watchTask(t.id);
      return { status: 'started', plan: plain(resp.text).replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu, '').trim().slice(0, 300),
        note: 'The pipeline is running with its own progress window. Tell sir in one line what you started; the outcome will arrive as a [SYSTEM EVENT].' };
    }
    return { status: 'not_a_search', reply: plain(resp?.text || '').slice(0, 600), note: 'That was not read as a lead or candidate search. Rephrase with a place and what to find.' };
  }

  // App/PC commands go straight to the command router (no LLM round trip);
  // only what it can't handle falls back to the text brain.
  async function appCommand(request) {
    if (!request) return { error: 'No request given.' };
    try {
      const quick = await window.ClavisIntent?.route?.(request, { source: 'live' });
      if (quick && quick.handled) return { ok: true, result: plain(quick.spoken || 'Done.').slice(0, 400) };
      const cmd = await window.ClavisCommands?.route?.(request);
      if (cmd && cmd.handled) return { ok: true, result: plain(cmd.text || cmd.spoken || cmd.bubbleHtml || 'Done.').slice(0, 1600), spoken_version: cmd.text ? plain(cmd.spoken || '').slice(0, 800) : undefined };
    } catch (e) { return { error: e?.message || String(e) }; }
    return delegate(request);
  }

  async function toJpeg(dataUrl, maxW, q) {
    const img = await new Promise((resolve, reject) => {
      const im = new Image();
      im.onload = () => resolve(im);
      im.onerror = reject;
      im.src = dataUrl;
    });
    const scale = Math.min(1, maxW / (img.naturalWidth || maxW));
    const c = document.createElement('canvas');
    c.width = Math.round((img.naturalWidth || maxW) * scale);
    c.height = Math.round((img.naturalHeight || maxW * 0.5625) * scale);
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
    return c.toDataURL('image/jpeg', q).split(',')[1];
  }
  function sendFrame(b64) {
    if (b64) send({ realtimeInput: { video: { data: b64, mimeType: 'image/jpeg' } } });
  }

  async function readWebsite(args) {
    let url = String(args.url || '').trim();
    if (!url) return { error: 'No URL given.' };
    if (!/^https?:\/\//i.test(url)) url = 'https://' + url;
    const base = window.SKYLARK_CONFIG?.BACKEND_URL || 'http://localhost:8000';
    let res;
    try {
      res = await fetch(`${base}/api/v1/web/read`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url, screenshot: !!args.want_visual, follow_contact: !!args.follow_contact }),
      });
    } catch (_) {
      return { error: 'The Clavis backend (port 8000) is not running, so I cannot read websites right now.' };
    }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return { error: plain(data.detail || `Could not read that page (HTTP ${res.status}).`) };
    if (data.screenshot) {
      sendFrame(data.screenshot);
      delete data.screenshot;
      data.visual_note = 'A screenshot of this page was just sent to you as an image.';
    }
    return data;
  }

  async function screenScale(imgW) {
    try {
      const size = await window.ClavisPC?.screenSize?.();
      if (size?.width) return { screen_width: size.width, screen_height: size.height, image_width: imgW, note: `Multiply image x/y by ${(size.width / imgW).toFixed(3)} to get real screen coordinates.` };
    } catch (_) {}
    return {};
  }

  async function lookAtScreen() {
    if (S.screen) {
      const f = grabFrame(true);
      if (f) { sendFrame(f); return { ok: true, note: "The live screen share just sent a fresh frame. Answer from what is actually visible." }; }
    }
    let dataUrl = null;
    try { dataUrl = await window.ClavisPC?.peek?.(); } catch (_) {}
    if (!dataUrl) return { error: "Screen not available: the Clavis PC bridge isn't running and screen sharing is off. Ask sir to tap the screen button on the voice bar." };
    sendFrame(await toJpeg(dataUrl, 1280, 0.72));
    return { ok: true, note: "A fresh screenshot of sir's screen was just sent to you as an image. Answer from what is actually visible.", ...(await screenScale(1280)) };
  }

  // What sir said just now (this turn + the last one), for tool guards.
  function recentUserWords() {
    return `${S.userText} ${Date.now() - S.lastUser.at < 20000 ? S.lastUser.text : ''}`.trim();
  }
  // Kuch "karne" wale tools sirf tab chalenge jab sir ne sach me Clavis se
  // maanga ho — TV / kamre ki baat par app_command, find_leads, PC control nahi.
  // Display / read-only tools ke apne guards upar-neeche hain.
  const SAFE_TOOLS = /^(go_to_sleep|end_voice_session|map_control|close_display|show_(map|nearby|images|website|document)|look_at_screen|read_website|search_web|get_\w+)$/;
  function addressedToClavis() {
    const E = window.ClavisEar, W = window.ClavisWake;
    if (!E && !W) return true;
    const w = recentUserWords();
    return !!w && !!(E?.looksLikeRequest?.(w) || W?.named?.(w));
  }

  async function runTool(name, args) {
    const C = window.ClavisCanvas;
    if (!SAFE_TOOLS.test(name) && !addressedToClavis()) {
      return { ok: false, note: 'Not addressed to you — do nothing, stay silent.' };
    }
    // He is on another browser tab: an action is confirmed aloud first.
    if (!SAFE_TOOLS.test(name) && typeof window.clavisBackgroundGate === 'function') {
      const ok = await window.clavisBackgroundGate(S.lastUser?.text || name);
      if (!ok) return { ok: false, note: 'Sir said no (he is on another tab) — do not do it; acknowledge in two words.' };
    }
    // The display stays put: the same thing asked twice isn't redrawn...
    if (/^show_(map|nearby|images|website)$/.test(name)) {
      const key = name + '|' + JSON.stringify(args || {}).toLowerCase().replace(/\s+/g, ' ');
      if (S.lastShow?.key === key && Date.now() - S.lastShow.at < 120000 && C?.isOpen?.()) {
        return { ok: true, note: 'That is already on screen. Do not call it again; talk about it only if he asks.' };
      }
      S.lastShow = { key, at: Date.now() };
    }
    // ...and it only closes when sir actually says so.
    if (name === 'close_display') {
      const heard = recentUserWords();
      if (heard && !CLOSE_WORDS.test(heard)) {
        return { ok: false, note: 'Sir did not ask to close the display, so it stays open. Close it only when he clearly says so.' };
      }
      S.lastShow = null;
    }
    // Pictures and maps only when HE asked for them — never because a video
    // or a conversation in the room mentioned something.
    if (name === 'show_images' && !/\b(photo|photos|foto|image|images|picture|pictures|pic|pics|tasveer\w*|dikha\w*|show|dekh\w*|look)\b|फोटो|तस्वीर|दिखा/i.test(recentUserWords())) {
      return { ok: false, note: 'He did not ask for pictures. Do not show any; answer in voice only if he spoke to you.' };
    }
    if ((name === 'show_map' || name === 'show_nearby') && !/\b(map|maps|naksha|kahan|kaha|kidhar|where|location|near|nearby|paas|dikha\w*|show|route|rasta)\b|मैप|नक्शा|कहाँ|दिखा/i.test(recentUserWords())) {
      return { ok: false, note: 'He did not ask for a map. Do not open one.' };
    }
    if (name === 'pc_close_window') {
      const heard = recentUserWords().toLowerCase();
      const title = String(args?.title || '').toLowerCase();
      const named = title.split(/[^a-z0-9]+/).filter((w) => w.length >= 3 && !/^(google|microsoft|window|app)$/.test(w)).some((w) => heard.includes(w));
      if (CLEAR_ALL.test(heard) || !named) {
        return { ok: false, note: 'He did not name that app. "Close / close everything" means clearing your own display — call close_display instead. Never close his PC apps unless he names one.' };
      }
    }
    if (name === 'show_map') return C ? C.showMap(args) : { error: 'Display not loaded.' };
    if (name === 'map_control') return C ? C.mapControl(args) : { error: 'Display not loaded.' };
    if (name === 'show_nearby') return C ? C.showNearby(args) : { error: 'Display not loaded.' };
    if (name === 'show_images') return C ? C.showImages(args) : { error: 'Display not loaded.' };
    if (name === 'show_website') return C ? C.showWebsite(args) : { error: 'Display not loaded.' };
    if (name === 'show_document') return C ? C.showDocument(args) : { error: 'Display not loaded.' };
    if (name === 'close_display') { C?.hide(); try { window.ClavisTaskSurface?.hide?.(); } catch (_) {} return { ok: true }; }
    if (name === 'find_leads') return findLeads(String(args.request || '').trim());
    if (name === 'app_command' || name === 'clavis_do') return appCommand(String(args.request || '').trim());
    if (name === 'look_at_screen') return lookAtScreen();
    if (name === 'go_to_sleep' || name === 'end_voice_session') return goToSleep(args || {});
    if (name === 'open_app_or_website') {
      const target = String(args.target || '').trim();
      if (!target) return { error: 'Nothing to open.' };
      if (!window.ClavisPC?.open) return { error: 'PC control is not loaded.' };
      const r = await window.ClavisPC.open(target);
      // open() reports an app that isn't installed instead of pretending.
      if (r && r.ok === false) return { ok: false, error: r.error || `Could not open ${target}.` };
      return { ok: true, opened: target, via: r?.native ? 'PC bridge' : 'browser tab' };
    }
    if (name === 'read_website') return readWebsite(args);
    if (window.JarvisSkills?.has?.(name)) return window.JarvisSkills.invoke(name, args || {});
    return { error: `Unknown tool ${name}` };
  }

  // 3.8 Live / 2.5 Live run tools asynchronously; 3.1 Flash Live doesn't.
  const asyncTools = () => !/3\.1-flash-live|extended-thinking/.test(S.models[S.modelIdx] || '');

  async function onToolCall(tc) {
    const calls = tc.functionCalls || [];
    if (!calls.length) return;
    setState('thinking');
    S.lastActivity = Date.now();
    holdLive(true);   // tool chal raha hai — window expire na ho
    const responses = await Promise.all(calls.map(async (c) => {
      let out;
      try { out = await runTool(c.name, c.args || {}); }
      catch (e) { out = { error: e?.message || String(e) }; }
      const response = toResponse(out);
      if (asyncTools()) response.scheduling = QUIET_TOOLS.has(c.name) ? 'SILENT' : 'WHEN_IDLE';
      return { id: c.id, name: c.name, response };
    }));
    const live = responses.filter((r) => !S.cancelled.has(r.id));
    if (live.length) send({ toolResponse: { functionResponses: live } });
    // SILENT tool results par model shayad kuch na bole — hold yahin chhodo;
    // agla model output phir se hold kar lega.
    if (!S.speaking && !S.modelBusy) holdLive(false);
  }

  // Jawab ban raha / bol raha → ClavisWake busy ('live' holder). Turn poora
  // aur awaaz khatam → chhodo → wahan se ~9 s follow-up, phir Clavis so jaata.
  function holdLive(on) {
    const W = window.ClavisWake;
    if (!W) return;
    if (on) {
      if (!S.holding && W.isAwake()) { S.holding = true; W.busy(true, 'live'); }
      if (S.holding) W.touch();
    } else if (S.holding) {
      S.holding = false;
      W.busy(false, 'live');
    }
  }

  // First wake shouldn't wait on downloading the audio worklets.
  try {
    const warm = () => ['clavis-mic-capture-worklet.js?v=2', 'clavis-pcm-player-worklet.js?v=3'].forEach((u) => fetch(u).catch(() => {}));
    (window.requestIdleCallback || ((f) => setTimeout(f, 3000)))(warm);
  } catch (_) {}

  /* ── setup ─────────────────────────────────────────────────── */
  function buildSetup(model) {
    // 3.8 Live: proactive audio is built in and affective dialog isn't offered;
    // sending either only costs a refused setup and a reconnect.
    const extras = S.degrade === 0 && !NO_EXTRAS.test(model) && !/3\.8-live/.test(model);
    const low = localStorage.getItem(LS.sens) === 'low';
    const generationConfig = {
      responseModalities: ['AUDIO'],
      speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: liveVoice() } } },
    };
    if (extras) generationConfig.enableAffectiveDialog = true;
    const tools = [];
    if (S.degrade < 2) tools.push({ googleSearch: {} });
    tools.push({ functionDeclarations: toolDeclarations() });
    const setup = {
      model: `models/${model}`,
      generationConfig,
      systemInstruction: { parts: [{ text: buildPersona() }] },
      tools,
      realtimeInputConfig: {
        automaticActivityDetection: {
          // HIGH start sensitivity: sir can always cut in (barge-in). The
          // model's proactive audio already ignores the TV / people nearby;
          // "low" (clavis_live_sensitivity) is only for a very noisy room.
          startOfSpeechSensitivity: low ? 'START_SENSITIVITY_LOW' : 'START_SENSITIVITY_HIGH',
          // Patient like a person: LOW end-of-speech sensitivity plus ~1.1 s
          // of silence, so "umm… matlab…" pauses never cut him off.
          endOfSpeechSensitivity: 'END_SENSITIVITY_LOW',
          prefixPaddingMs: 300,
          silenceDurationMs: patienceMs(),
        },
      },
      inputAudioTranscription: {},
      outputAudioTranscription: {},
      contextWindowCompression: { slidingWindow: {} },
      sessionResumption: {},
    };
    const handle = sessionStorage.getItem(HANDLE_KEY);
    if (handle) setup.sessionResumption.handle = handle;
    if (extras) setup.proactivity = { proactiveAudio: true };
    return { setup };
  }

  function send(obj) {
    const ws = S.ws;
    if (!ws || ws.readyState !== WebSocket.OPEN) return false;
    try { ws.send(JSON.stringify(obj)); return true; } catch (_) { return false; }
  }

  function connect() {
    const key = S.keys[S.keyIdx];
    const model = S.models[S.modelIdx];
    // Out of keys: "quota khatam" only if one really said quota; else it's a model problem.
    if (!key) return (!S.keys.length || S.keys.some((k) => spentMap()[tail(k)])) ? allKeysSpent() : fatal('No Gemini Live model accepted these keys.');
    if (!model) return fatal('No Gemini Live model accepted this key.');
    S.setupDone = false;
    setState(S.retries ? 'reconnecting' : 'connecting');
    const ws = new WebSocket(`${WS_URL}?key=${encodeURIComponent(key)}`);
    ws.binaryType = 'arraybuffer';
    S.ws = ws;
    ws.onopen = () => {
      if (ws !== S.ws) return;
      ws.send(JSON.stringify(buildSetup(model)));
      clearTimeout(S.setupTimer);
      S.setupTimer = setTimeout(() => { if (ws === S.ws && !S.setupDone) { try { ws.close(4000, 'setup timeout'); } catch (_) {} } }, 15000);
    };
    ws.onmessage = (ev) => {
      if (ws !== S.ws) return;
      let msg;
      try { msg = JSON.parse(typeof ev.data === 'string' ? ev.data : new TextDecoder().decode(ev.data)); }
      catch (_) { return; }
      handleMessage(msg);
    };
    ws.onerror = () => {};
    ws.onclose = (ev) => onClose(ws, ev);
  }

  function classifyClose(code, reason) {
    const r = String(reason || '');
    if (/quota|exhaust|rate.?limit|resource_exhausted|\b429\b/i.test(r)) return 'quota';
    if (/api.?key|permission|unauthori[sz]ed|forbidden|PERMISSION_DENIED|API_KEY_INVALID/i.test(r)) return 'badkey';
    if (/(is not found|not supported for bidi|unknown model|model.*(not found|not available|not supported))/i.test(r)) return 'model';
    if (code === 1007 || /unknown name|invalid json|cannot find field|unsupported|not supported|invalid argument/i.test(r)) return 'feature';
    return 'transient';
  }

  function onClose(ws, ev) {
    if (ws !== S.ws) return;
    clearTimeout(S.setupTimer);
    S.ws = null;
    if (S.phase === 'off') return;
    const kind = classifyClose(ev.code, ev.reason);
    if (ev.reason) console.info('[ClavisLive] closed', ev.code, ev.reason);
    if (kind === 'badkey') {
      try { window.ClavisKeyVault?.report?.('gemini', 'rejected', new Error(ev.reason || kind)); } catch (_) {}
      nextKey();
      return later(connect, 150);
    }
    // Quota is per model too: a model this key can't use (or whose free
    // limit is 0) is not "the key is spent" — try the next model first.
    if (kind === 'quota') S.keyQuotaHit = true;
    if (kind === 'quota' || kind === 'model' || (kind === 'feature' && !S.setupDone && S.degrade >= 2)) {
      nextModel(ev.reason || kind);
      return later(connect, 150);
    }
    if (kind === 'feature' && !S.setupDone) { S.degrade++; return later(connect, 150); }
    // Normal 10-minute connection rotation, network blip, goAway: resume in place.
    if (S.retries++ < 5) return later(connect, Math.min(4000, 300 * S.retries));
    fatal('The Gemini Live connection keeps dropping.');
  }
  function later(fn, ms) { setTimeout(() => { if (S.phase !== 'off') fn(); }, ms); }
  function nextKey() {
    S.keyIdx++; S.modelIdx = 0; S.degrade = 0; S.keyQuotaHit = false;
    S.models = modelList(S.keys[S.keyIdx]);
    sessionStorage.removeItem(HANDLE_KEY);
  }
  // Models run out for this key → it is spent only if a model said "quota".
  function nextModel(reason) {
    S.modelIdx++; S.degrade = 0; sessionStorage.removeItem(HANDLE_KEY);
    if (S.modelIdx < S.models.length) return;
    if (S.keyQuotaHit) {
      markSpent(S.keys[S.keyIdx]);
      try { window.ClavisKeyVault?.report?.('gemini', 'exhausted', new Error(reason)); } catch (_) {}
    }
    nextKey();
  }

  function handleMessage(msg) {
    if (msg.setupComplete) return onSetupComplete();
    if (msg.serverContent) return onServerContent(msg.serverContent);
    if (msg.toolCall) return onToolCall(msg.toolCall);
    if (msg.toolCallCancellation) { (msg.toolCallCancellation.ids || []).forEach((id) => S.cancelled.add(id)); return; }
    if (msg.sessionResumptionUpdate) {
      const u = msg.sessionResumptionUpdate;
      if (u.resumable && u.newHandle) sessionStorage.setItem(HANDLE_KEY, u.newHandle);
      return;
    }
    if (msg.goAway && S.ws) { try { S.ws.close(4001, 'goAway'); } catch (_) {} }
  }

  function onSetupComplete() {
    clearTimeout(S.setupTimer);
    const resumed = S.retries > 0 && !!sessionStorage.getItem(HANDLE_KEY);
    S.setupDone = true;
    S.retries = 0;
    try { localStorage.setItem(LS.lastOk, JSON.stringify({ model: S.models[S.modelIdx], degrade: S.degrade })); } catch (_) {}
    S.phase = 'live';
    S.lastActivity = Date.now();
    setState('listening');
    // Whatever sir said while we were connecting is not lost.
    const pre = S.preroll.splice(0);
    for (let i = 0; i < pre.length; i += 2) sendAudio(pre.slice(i, i + 2));
    if (S.initialText) {
      send({ clientContent: { turns: [{ role: 'user', parts: [{ text: S.initialText }] }], turnComplete: true } });
      S.initialText = '';
    } else if (!resumed && S.trigger === 'boot') {
      bootGreeting().then((t) => notify(t, true));
    } else if (!resumed && !S.prerollVoice && (S.trigger === 'clap' || S.trigger === 'wake word')) {
      // Woken by a snap / clap / bare name and he has not started talking yet:
      // one tiny greeting so he KNOWS Clavis is awake, then listen.
      const how = S.trigger === 'clap' ? 'with a snap or clap' : 'by calling your name';
      notify(`[SYSTEM EVENT] Sir just woke you ${how}. Greet him in ONE very short line (max 7 words) in his language so he knows you are awake and listening — in the spirit of "Haan sir, main Clavis — boliye." Use the grammatical gender that matches your own voice, never the same words twice, no questions about his day. Then stop and listen.`, true);
    }
    // Woken by the mic button: the chime already said "listening".
    S.prerollVoice = false;
    flushEventsSoon(50);
  }

  // One-shot: the "slept" marker is read once and cleared.
  function wakeNote() {
    let s = null;
    try { s = JSON.parse(localStorage.getItem(SLEPT_KEY) || 'null'); localStorage.removeItem(SLEPT_KEY); } catch (_) {}
    if (!s || !s.at) return '';
    const mins = Math.round((Date.now() - s.at) / 60000);
    if (mins > 12 * 60) return '';
    const how = S.trigger === 'clap' ? 'with a snap or clap' : S.trigger === 'wake word' ? 'by calling your name' : 'by tapping the mic';
    const nap = mins < 1 ? 'a few seconds' : mins === 1 ? 'a minute' : `${mins} minutes`;
    if (s.reason === 'busy') {
      return `[SYSTEM EVENT] You had stepped back ${nap} ago because sir seemed busy with someone else; he just called you back ${how}. Come back warmly in one short line in his language (never the same words twice), then listen.`;
    }
    return `[SYSTEM EVENT] You had gone to sleep ${nap} ago because sir asked you to rest, and he just woke you ${how}. Wake up like a person who dozed off: a small sleepy yawn or stretch in your voice ("hmm… aah…"), then ONE short, warm, slightly embarrassed line in his language, in the spirit of "Good morning sir… meri aankh lag gayi thi, boliye" — your own words, different every time. If he already said what he wants, answer that right after. Then listen.`;
  }

  async function bootGreeting() {
    let context = '';
    try {
      const leads = await window.MemoryEngine?.getAllLeads?.();
      if (Array.isArray(leads)) {
        const today = new Date().toDateString();
        const fresh = leads.filter((l) => new Date(l.createdAt || l.sourceTimestamp || l.created_at || 0).toDateString() === today).length;
        context = ` For context only (mention it only if it's genuinely useful): ${leads.length} leads saved in total, ${fresh} added today.`;
      }
    } catch (_) {}
    return `Sir just opened the Clavis app. Greet him the way a trusted assistant would at the start of a session: one or two short natural lines that suit the time of day, varied — never a stock phrase. If something is worth offering, offer one thing.${context} Then listen.`;
  }

  function onServerContent(sc) {
    if (sc.interrupted) {
      flushPlayback();
      commitTurn(true);
      setState('listening');
      S.modelBusy = false;
      holdLive(false);
    }
    if (sc.inputTranscription?.text) {
      S.userText += sc.inputTranscription.text;
      try { const V = window.ClavisVoiceState; V?.mark?.('first_partial'); V?.mark?.('last_voice'); V?.notePartial?.(); V?.set?.('USER_SPEAKING', 'live'); } catch (_) {}
      // the fast caption owns the preview while it is producing words
      if (Date.now() - FC.at > 1500) { try { window.ClavisEar?.caption?.live(S.userText); } catch (_) {} }
      // Server-confirmed speech — unlike raw mic level, a fan or TV can't fake it.
      S.lastUserVoiceAt = Date.now();
      S.heardUser = true;
      // Sirf sunai dena window nahi badhata (TV bhi "transcribe" hota hai) —
      // haan, sir Clavis se kuch maang rahe hon to beech sentence me mat so.
      const W = window.ClavisWake;
      if (W && (window.ClavisEar?.looksLikeRequest?.(S.userText) || W.named(S.userText))) W.touch(4000);
    }
    if (sc.outputTranscription?.text) {
      S.modelText += sc.outputTranscription.text;
      try { window.ClavisEar?.noteSpoken?.(sc.outputTranscription.text); } catch (_) {}
    }
    if (sc.outputTranscription?.text || sc.modelTurn?.parts?.length) {
      if (!S.modelBusy) {
        S.modelBusy = true; holdLive(true);
        try { const V = window.ClavisVoiceState; V?.mark?.('endpoint'); V?.mark?.('llm_first_token'); V?.set?.('PROCESSING', 'live'); V?.set?.('ASSISTANT_SPEAKING', 'live'); } catch (_) {}
      }
    }
    for (const p of sc.modelTurn?.parts || []) {
      if (p.inlineData?.data && /audio/i.test(p.inlineData.mimeType || 'audio/pcm')) playChunk(p.inlineData.data);
    }
    if (sc.turnComplete) {
      commitTurn(false);
      S.modelBusy = false;
      if (!S.speaking) holdLive(false);   // warna onDrained chhodega
    }
  }

  function commitTurn(interrupted) {
    const u = S.userText.trim();
    const m = S.modelText.trim();
    S.userText = ''; S.modelText = ''; FC.reset = true;
    // Voice is the output: nothing is echoed on screen. The turns still feed
    // Clavis's memory of the conversation.
    if (u) {
      // Deterministic voice commands the model must not decide: silent mode
      // ("5 minute chup raho") ends Live and keeps the quiet browser ear.
      try {
        const V = window.ClavisVoiceState, cmd = V?.parseStop?.(u);
        if (cmd?.kind === 'silent') { setTimeout(() => { stop({ reason: 'silent' }); V.silence(cmd.ms); window.clavisEnsureListening?.(); }, 0); }
        else if (window.clavisGateOffer?.(u)) { /* yes/no for a background-tab question */ }
      } catch (_) {}
      S.lastUser = { text: u, at: Date.now() };
      window.__clavisLastUserText = u;
      try { window.ClavisMind?.noteUserTurn?.(u); } catch (_) {}
      try { window.ClavisEar?.caption?.final(u, true); } catch (_) {}
      try { window.ClavisIntent?.learn?.(u); } catch (_) {}
      // Safety net: "map band karo" must close the map even if the model
      // only answered in words and never called close_display.
      if (CLOSE_WORDS.test(u)) {
        setTimeout(() => {
          const open = window.ClavisCanvas?.isOpen?.() || document.querySelector('#clavis-task-surface.is-open');
          if (open) { try { window.ClavisIntent?.route?.(u, { source: 'live' }); } catch (_) {} }
        }, 1600);
      }
      // "thodi der chup ho jao" must put Clavis to sleep even if the model
      // only answered in words and never called go_to_sleep.
      if (SLEEP_WORDS.test(u) && u.split(/\s+/).length <= 8) {
        setTimeout(() => { if (S.phase !== 'off' && !S.closeAfterTurn) goToSleep({ reason: 'asked' }); }, 2200);
      }
    }
    if (m) { try { window.ClavisMind?.noteClavisTurn?.(interrupted ? m + ' …' : m); } catch (_) {} }
  }

  function goToSleep(args) {
    const reason = String(args.reason || 'asked');
    const mins = Number.isFinite(Number(args.quiet_minutes)) ? Number(args.quiet_minutes) : (reason === 'done' ? 0 : 30);
    if (mins > 0) {
      S.snoozeUntil = Date.now() + mins * 60e3;
      try { window.ClavisProactive?.snooze?.(mins); } catch (_) {}
    }
    // Remembered so the next wake-up is a real "I dozed off" moment.
    if (reason !== 'done') { try { localStorage.setItem(SLEPT_KEY, JSON.stringify({ at: Date.now(), reason })); } catch (_) {} }
    S.closeAfterTurn = true;
    clearTimeout(S.closeTimer);
    // Nothing (more) to say -> close right away; otherwise after the line finishes.
    const hardStop = Date.now() + 12000;
    const closeWhenQuiet = () => {
      if (S.phase === 'off') return;
      // Still saying its last line? Let it finish (onDrained closes too).
      if (S.speaking && Date.now() < hardStop) { S.closeTimer = setTimeout(closeWhenQuiet, 500); return; }
      stop({ reason: 'sleep' });
    };
    S.closeTimer = setTimeout(closeWhenQuiet, 2500);
    return { ok: true, note: 'Going to sleep. If you still need to, say at most one very short line; otherwise say nothing.' };
  }

  /* ── audio out ─────────────────────────────────────────────── */
  async function ensureOutput() {
    if (S.outCtx) { if (S.outCtx.state === 'suspended') await S.outCtx.resume(); return; }
    S.outCtx = new AudioContext({ sampleRate: 24000, latencyHint: 'interactive' });
    await S.outCtx.audioWorklet.addModule('clavis-pcm-player-worklet.js?v=3');
    S.player = new AudioWorkletNode(S.outCtx, 'clavis-pcm-player', { outputChannelCount: [1] });
    S.outGain = S.outCtx.createGain();
    S.outAnalyser = S.outCtx.createAnalyser();
    S.outAnalyser.fftSize = 512;
    S.player.connect(S.outGain).connect(S.outAnalyser).connect(S.outCtx.destination);
    S.player.port.onmessage = (e) => { if (e.data?.type === 'drained') onDrained(); };
    if (S.outCtx.state === 'suspended') await S.outCtx.resume();
  }
  function playChunk(b64) {
    if (!S.player) return;
    const buf = bufferFromB64(b64);
    S.player.port.postMessage({ type: 'chunk', audio: buf }, [buf]);
    S.lastChunkAt = Date.now();
    S.lastActivity = S.lastChunkAt;
    if (!S.speaking) {
      S.speaking = true;
      unduck();
      setState('speaking');
      try { window.ClavisEar?.noteSpeaking?.(''); } catch (_) {}
    }
  }
  function onDrained() {
    clearTimeout(S.drainTimer);
    // Network jitter can empty the queue mid-sentence; only call it done after a real gap.
    S.drainTimer = setTimeout(() => {
      if (Date.now() - S.lastChunkAt < 300) return;
      S.speaking = false;
      try { window.ClavisEar?.noteSpeakingDone?.(); } catch (_) {}
      if (!S.modelBusy) holdLive(false);   // bol chuka → follow-up window shuru
      if (S.closeAfterTurn) return stop({ reason: 'sleep' });
      if (S.phase === 'live') setState('listening');
      flushEventsSoon();
    }, 350);
  }
  function flushPlayback() {
    try { S.player?.port.postMessage({ type: 'stop' }); } catch (_) {}
    S.speaking = false;
    S.gateOpen = false; S.gateHold = [];
    try { window.ClavisEar?.noteSpeakingDone?.(); } catch (_) {}
    unduck();
  }
  function duck() {
    if (S.ducked || !S.outGain) return;
    S.ducked = true;
    const lvl = Number(localStorage.getItem(LS.duck)) || 0.25;
    S.outGain.gain.setTargetAtTime(lvl, S.outCtx.currentTime, 0.03);
  }
  function unduck() {
    if (!S.ducked || !S.outGain) return;
    S.ducked = false;
    S.outGain.gain.setTargetAtTime(1, S.outCtx.currentTime, 0.08);
  }

  /* ── audio in ──────────────────────────────────────────────── */
  async function startMic() {
    S.mic = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 },
      video: false,
    });
    try { localStorage.setItem('clavis_mic_permission_granted', 'true'); } catch (_) {}
    S.micCtx = new AudioContext({ latencyHint: 'interactive' });
    await S.micCtx.audioWorklet.addModule('clavis-mic-capture-worklet.js?v=2');
    S.micSrc = S.micCtx.createMediaStreamSource(S.mic);
    S.micAnalyser = S.micCtx.createAnalyser();
    S.micAnalyser.fftSize = 512;
    S.micSrc.connect(S.micAnalyser);
    S.micNode = new AudioWorkletNode(S.micCtx, 'clavis-mic-capture', { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1] });
    const silent = S.micCtx.createGain();
    silent.gain.value = 0;
    S.micSrc.connect(S.micNode).connect(silent).connect(S.micCtx.destination);
    S.micNode.port.onmessage = (e) => { if (e.data?.type === 'pcm') onPcm(new Float32Array(e.data.audio)); };
    if (S.micCtx.state === 'suspended') await S.micCtx.resume();
    S.mic.getAudioTracks()[0]?.addEventListener('ended', () => fatal('The microphone was disconnected.'));
  }
  // Echo gate: while Clavis talks, the server only hears the mic when sir is
  // actually talking over it (double-talk), not Clavis's own echo leaking
  // past the browser's AEC — that echo used to "interrupt" Clavis mid-line
  // and even show up as something sir said. ~320 ms before the gate opens
  // is kept and sent first, so his first word isn't clipped.
  const GATE_HOLD = 10;
  const gateLvl = new Float32Array(512);
  function gate(f32) {
    if (!S.speaking || localStorage.getItem('clavis_echo_gate') === 'false' || !window.ClavisEar?.createDoubleTalk) {
      S.gateHold = [];
      return f32;
    }
    if (!S.dt) S.dt = window.ClavisEar.createDoubleTalk({ margin: 2.2, min: 0.02 });
    let e = 0;
    for (let i = 0; i < f32.length; i++) e += f32[i] * f32[i];
    const mic = Math.sqrt(e / (f32.length || 1));
    const r = S.dt.update(mic, rms(S.outAnalyser, gateLvl));
    const t = Date.now();
    if (r.loud) S.gateLastLoud = t;
    const open = r.hot >= 2 || t - (S.gateLastLoud || 0) < 1200 && S.gateOpen;
    if (open && !S.gateOpen) {
      S.gateOpen = true;
      const held = (S.gateHold || []).splice(0);
      held.forEach((h) => S.sendBuf.push(h));
    }
    if (!open) {
      S.gateOpen = false;
      (S.gateHold || (S.gateHold = [])).push(f32);
      if (S.gateHold.length > GATE_HOLD) S.gateHold.shift();
      return new Float32Array(f32.length);   // silence keeps the stream's timing intact
    }
    return f32;
  }
  function onPcm(f32) {
    if (S.muted) return;
    // Soye hue Clavis ka mic Google tak nahi jaata. (isAwake() window khatam
    // hone par khud sleep fire karta hai → 'clavis:wake-change' → stop.)
    if (window.ClavisWake && !window.ClavisWake.isAwake()) return;
    if (S.phase !== 'live' || !S.setupDone) {
      S.preroll.push(f32);
      if (S.preroll.length > PREROLL_FRAMES) S.preroll.shift();
      return;
    }
    f32 = gate(f32);
    if (quiet(f32)) return;
    S.sendBuf.push(f32);
    if (S.sendBuf.length >= 2) sendAudio(S.sendBuf.splice(0));
  }
  // Always-on mic that doesn't burn quota: after ~2.5 s in which nobody
  // talks, audio stops flowing (audioStreamEnd — the API's "mic went quiet")
  // and the last ~0.4 s is held; the first sound of his voice resumes the
  // stream with that held audio first, so no word is clipped. This is what
  // lets a session stay open for minutes like ChatGPT / Gemini voice.
  const QUIET_MS = 2500;
  const QUIET_KEEP = 13;
  function quiet(f32) {
    if (localStorage.getItem('clavis_live_quiet_pause') === 'false') return false;
    let e = 0;
    for (let i = 0; i < f32.length; i++) e += f32[i] * f32[i];
    e = Math.sqrt(e / (f32.length || 1));
    // Slow-rising, fast-falling noise floor: a fan or AC never counts as voice.
    S.floor = !S.floor ? e : e < S.floor ? S.floor * 0.9 + e * 0.1 : S.floor * 0.998 + e * 0.002;
    const voiced = e > Math.max(0.01, S.floor * 3);
    S.voicedRun = voiced ? (S.voicedRun || 0) + 1 : 0;
    const now = Date.now();
    if (voiced) S.lastVoicedAt = now;
    const holdOpen = S.speaking || S.userText || S.gateOpen;
    if (!S.streamPaused) {
      const lastSound = Math.max(S.lastVoicedAt || 0, S.lastChunkAt || 0, S.resumedAt || 0, S.lastUserVoiceAt || 0);
      if (!holdOpen && now - lastSound > QUIET_MS) {
        S.streamPaused = true;
        S.quietHold = [];
        if (S.sendBuf.length) sendAudio(S.sendBuf.splice(0));
        send({ realtimeInput: { audioStreamEnd: true } });
        return true;
      }
      return false;
    }
    if (holdOpen || S.voicedRun >= 2) {
      S.streamPaused = false;
      S.resumedAt = now;
      (S.quietHold || []).splice(0).forEach((h) => S.sendBuf.push(h));
      return false;
    }
    (S.quietHold || (S.quietHold = [])).push(f32);
    if (S.quietHold.length > QUIET_KEEP) S.quietHold.shift();
    return true;
  }
  function sendAudio(frames) {
    if (!frames.length) return;
    const total = frames.reduce((n, f) => n + f.length, 0);
    const merged = new Float32Array(total);
    let o = 0;
    frames.forEach((f) => { merged.set(f, o); o += f.length; });
    send({ realtimeInput: { audio: { data: b64FromBuffer(floatToPcm16(merged)), mimeType: 'audio/pcm;rate=16000' } } });
  }

  /* ── events from the app (proactive relay) ─────────────────── */
  function notify(text, front) {
    if (!text) return;
    if (front) S.events.unshift(String(text)); else S.events.push(String(text));
    if (S.events.length > 8) S.events.splice(0, S.events.length - 8);
    flushEventsSoon();
  }
  function flushEventsSoon(ms) {
    clearTimeout(S.flushTimer);
    S.flushTimer = setTimeout(flushEvents, ms == null ? 900 : ms);
  }
  function flushEvents() {
    if (S.phase !== 'live' || !S.events.length) return;
    // Never talk over sir or over itself: wait for a natural gap.
    if (S.speaking || Date.now() - S.lastUserVoiceAt < 2500 || Date.now() - S.lastChunkAt < 1500 || S.userText) return flushEventsSoon(900);
    const text = S.events.splice(0).map((e) => `[SYSTEM EVENT] ${e}`).join('\n');
    send({ clientContent: { turns: [{ role: 'user', parts: [{ text }] }], turnComplete: true } });
  }
  // speakJarvisText() hands us anything the rest of the app wanted to say.
  function relay(text) {
    if (!isActive()) return false;
    if (busy()) return true;   // the tool result / task watcher already carries it
    const clean = plain(text).slice(0, 900);
    if (clean) notify(`The Clavis app wants sir to hear this (say it naturally and briefly, in his language): "${clean}"`);
    return true;
  }

  /* ── screen share (live eyes) ──────────────────────────────── */
  function grabFrame(force) {
    const v = S.screenVideo;
    if (!v || !v.videoWidth) return null;
    const w = Math.min(1024, v.videoWidth);
    const h = Math.round(v.videoHeight * (w / v.videoWidth));
    const thumb = document.createElement('canvas');
    thumb.width = 32; thumb.height = 18;
    const tctx = thumb.getContext('2d', { willReadFrequently: true });
    tctx.drawImage(v, 0, 0, 32, 18);
    const px = tctx.getImageData(0, 0, 32, 18).data;
    const lum = new Uint8Array(32 * 18);
    for (let i = 0; i < lum.length; i++) lum[i] = (px[i * 4] * 3 + px[i * 4 + 1] * 6 + px[i * 4 + 2]) / 10;
    let diff = 255;
    if (S.lastThumb) { diff = 0; for (let i = 0; i < lum.length; i++) diff += Math.abs(lum[i] - S.lastThumb[i]); diff /= lum.length; }
    // An unchanged screen is not re-sent (saves quota) — but refreshed every 10 s.
    if (!force && diff < 1.5 && Date.now() - S.lastFrameAt < 10000) return null;
    S.lastThumb = lum;
    S.lastFrameAt = Date.now();
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    c.getContext('2d').drawImage(v, 0, 0, w, h);
    return c.toDataURL('image/jpeg', 0.6).split(',')[1];
  }
  async function toggleScreen() {
    if (S.screen) return stopScreen(true);
    if (!navigator.mediaDevices?.getDisplayMedia) return;
    try {
      S.screen = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: 2 }, audio: false });
    } catch (_) { return; }
    const v = document.createElement('video');
    v.muted = true; v.playsInline = true; v.srcObject = S.screen;
    try { await v.play(); } catch (_) {}
    S.screenVideo = v;
    S.lastThumb = null;
    S.screen.getVideoTracks()[0]?.addEventListener('ended', () => stopScreen(true));
    S.screenTimer = setInterval(() => { if (S.phase === 'live') sendFrame(grabFrame(false)); }, 1000);
    hudFlag('screen', true);
    notify('Sir just started sharing his screen with you live. Acknowledge in a few words; from now on you can see it.');
  }
  function stopScreen(announce) {
    clearInterval(S.screenTimer);
    S.screenTimer = 0;
    if (S.screen) S.screen.getTracks().forEach((t) => t.stop());
    S.screen = null; S.screenVideo = null; S.lastThumb = null;
    hudFlag('screen', false);
    if (announce && isActive()) notify('Sir stopped sharing his screen. You can no longer see it.');
  }

  /* ── level loop: orb + ducking + idle sleep ────────────────── */
  const lvlBuf = new Float32Array(512);
  let smoothIn = 0, smoothOut = 0;
  function levelLoop() {
    if (S.phase === 'off') return;
    const inL = S.muted ? 0 : rms(S.micAnalyser, lvlBuf);
    const outL = rms(S.outAnalyser, lvlBuf);
    smoothIn += (inL - smoothIn) * 0.35;
    smoothOut += (outL - smoothOut) * 0.35;
    const now = Date.now();
    if (inL > 0.06 && !S.setupDone) S.prerollVoice = true;
    // Instant feel on barge-in: dip Clavis's voice the moment sir talks over it;
    // the server's "interrupted" then cuts it for real (or it comes back up).
    if (inL > 0.09) S.lastLoudAt = now;
    // Dip only for real double-talk — its own echo used to duck it too.
    if (S.speaking && inL > 0.09 && (S.gateOpen || !window.ClavisEar)) duck();
    else if (S.ducked && now - S.lastLoudAt > 700) unduck();
    const lvl = Math.min(1, (S.speaking ? smoothOut : smoothIn) * 6);
    // Style writes every frame kept the blurred HUD repainting 60x a second;
    // ~20 fps on real change looks the same and costs a fraction.
    const paintNow = now - S.lastLvlAt > 50 && Math.abs(lvl - S.lastLvl) > 0.02;
    if (paintNow) { S.lastLvlAt = now; S.lastLvl = lvl; }
    if (paintNow && S.hud) S.hud.style.setProperty('--lvl', lvl.toFixed(2));
    const orb = window.StrandsOrb?.instance;
    if (paintNow && orb?.setProps && (S.state === 'speaking' || S.state === 'listening')) {
      const talk = S.state === 'speaking';
      orb.setProps({
        speed: (talk ? 0.19 : 0.11) + lvl * 0.07,
        amplitude: (talk ? 1.35 : 1.05) + lvl * 0.9,
        intensity: (talk ? 0.36 : 0.26) + lvl * 0.28,
      });
    }
    S.rafId = requestAnimationFrame(levelLoop);
  }
  function idleCheck() {
    if (S.phase !== 'live') return;
    // Session utni hi der jitni ClavisWake jaaga hai (jawab + ~9 s follow-up).
    // Pehle 10 min khula rehta tha aur har aawaz par Gemini bolta tha.
    const W = window.ClavisWake;
    if (W && !W.isAwake()) return stop({ reason: 'sleep' });
    // Jagaya par kuch bola nahi → WAKE_IDLE_MS baad chupchaap band.
    const idleMs = !S.heardUser && S.idleOverride ? S.idleOverride : (W ? 0 : 180000);
    if (idleMs && !S.speaking && !busy() && !S.screen && Date.now() - S.lastActivity > idleMs) stop({ reason: 'idle' });
  }
  // ClavisWake ne sula diya (window khatam / "so jao" / side-talk) → session band.
  window.addEventListener('clavis:wake-change', (e) => {
    if (!e.detail?.awake && isActive()) stop({ reason: 'sleep' });
  });

  /* ── HUD (voice bar) ───────────────────────────────────────── */
  const ICONS = {
    screen: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8M12 16v4"/></svg>',
    mic: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/></svg>',
    end: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>',
  };
  const LABELS = {
    connecting: 'Connecting', reconnecting: 'Reconnecting', listening: 'Listening', speaking: 'Speaking',
    thinking: 'Working', muted: 'Muted', off: '',
  };
  function ensureHud() {
    if (S.hud) return S.hud;
    const el = document.createElement('div');
    el.id = 'clavis-live-hud';
    el.className = 'clh';
    el.setAttribute('role', 'region');
    el.setAttribute('aria-label', 'Clavis voice');
    el.innerHTML =
      '<div class="clh-orb" aria-hidden="true"><span></span></div>' +
      '<div class="clh-text"><div class="clh-state"></div><div class="clh-caption" aria-live="polite"></div></div>' +
      `<button type="button" class="clh-btn" data-act="screen" aria-pressed="false" aria-label="Share screen with Clavis" title="Let Clavis see your screen">${ICONS.screen}</button>` +
      `<button type="button" class="clh-btn" data-act="mute" aria-pressed="false" aria-label="Mute microphone" title="Mute">${ICONS.mic}</button>` +
      `<button type="button" class="clh-btn clh-end" data-act="end" aria-label="End voice" title="End voice">${ICONS.end}</button>`;
    el.addEventListener('click', (e) => {
      const act = e.target.closest('[data-act]')?.dataset.act;
      if (act === 'end') stop({ reason: 'user' });
      else if (act === 'mute') setMuted(!S.muted);
      else if (act === 'screen') toggleScreen();
    });
    document.body.appendChild(el);
    S.hud = el;
    return el;
  }
  function showHud() {
    const el = ensureHud();
    requestAnimationFrame(() => el.classList.add('is-in'));
  }
  function hideHud() {
    if (!S.hud) return;
    S.hud.classList.remove('is-in');
  }
  function hudFlag(name, on) {
    const b = S.hud?.querySelector(`[data-act="${name}"]`);
    if (b) { b.classList.toggle('is-on', !!on); b.setAttribute('aria-pressed', String(!!on)); }
  }
  let captionTimer = 0;
  function caption(text, who) {
    const c = S.hud?.querySelector('.clh-caption');
    if (!c) return;
    const t = String(text || '').trim();
    c.textContent = t.length > 110 ? '…' + t.slice(-108) : t;
    c.dataset.who = who || '';
    clearTimeout(captionTimer);
    captionTimer = setTimeout(() => { if (c.textContent === (t.length > 110 ? '…' + t.slice(-108) : t)) c.textContent = ''; }, 6000);
  }
  /* Instant preview. Gemini's input transcript lands in chunks, often
     seconds after the words — the caption looked frozen, then wrong.
     Chrome's own recognizer runs beside the Live stream ONLY to draw the
     caption word by word; Gemini still hears the real audio. */
  const FC = { rec: null, want: false, at: 0, base: 0, reset: false };
  function fastCaption(on) {
    FC.want = !!on;
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) return;
    if (!on) { const r = FC.rec; FC.rec = null; try { r && (r.onend = null, r.abort()); } catch (_) {} return; }
    if (FC.rec) return;
    const r = new SR();
    r.lang = typeof window.clavisEarLang === 'function' ? window.clavisEarLang() : 'en-IN';
    r.continuous = true; r.interimResults = true; r.maxAlternatives = 1;
    r.onresult = (e) => {
      if (FC.reset) { FC.base = e.resultIndex; FC.reset = false; }
      if (S.speaking || S.modelBusy || S.muted) return;
      let t = '';
      for (let i = FC.base; i < e.results.length; i++) t += e.results[i][0].transcript + ' ';
      t = t.replace(/\s+/g, ' ').trim();
      if (!t) return;
      FC.at = Date.now();
      try { window.ClavisEar?.caption?.live(t); } catch (_) {}
    };
    r.onerror = (e) => { if (e.error === 'not-allowed' || e.error === 'service-not-allowed') FC.want = false; };
    r.onend = () => { if (FC.rec !== r) return; FC.rec = null; FC.base = 0; if (FC.want) setTimeout(() => FC.want && fastCaption(true), 120); };
    FC.rec = r; FC.base = 0;
    try { r.start(); } catch (_) { FC.rec = null; }
  }
  window.addEventListener('beforeunload', () => fastCaption(false));

  function setState(state) {
    S.state = state;
    fastCaption(S.phase === 'live' && state !== 'connecting' && state !== 'reconnecting');
    if (S.hud) {
      S.hud.dataset.state = state;
      const l = S.hud.querySelector('.clh-state');
      if (l) l.textContent = S.muted && state === 'listening' ? LABELS.muted : (LABELS[state] || '');
    }
    const map = { listening: 'listening', speaking: 'speaking', thinking: 'thinking', connecting: 'thinking', reconnecting: 'thinking' };
    try { if (map[state] && typeof window.setJarvisStatus === 'function') window.setJarvisStatus(map[state], `Clavis Live · ${LABELS[state]}`); } catch (_) {}
  }
  function setMuted(on) {
    S.muted = !!on;
    hudFlag('mute', S.muted);
    if (S.muted) send({ realtimeInput: { audioStreamEnd: true } });
    setState(S.state);
  }

  /* ── lifecycle ─────────────────────────────────────────────── */
  function pauseLegacy() {
    // One recognizer at a time: Live now owns the mic (stops the wake
    // listener / command ear through ClavisVoiceState).
    try { window.ClavisVoiceState?.mic?.claim?.('live', null); } catch (_) {}
    try { window.clavisStopCommandEar?.(); } catch (_) {}
    try { window.stopWakeListener?.(true); } catch (_) {}
    try { window.LocalSpeechEngine?.stopInput?.(); window.LocalSpeechEngine?.stop?.(); } catch (_) {}
    try { window.stopJarvisSpeech?.(); } catch (_) {}
    try { window.speechSynthesis?.cancel?.(); } catch (_) {}
    try { window.ClavisBargeIn?.disarm?.(); } catch (_) {}
    try { window.stopClavisSoundTriggers?.(); } catch (_) {}
  }
  function resumeLegacy() {
    try { window.ClavisVoiceState?.mic?.release?.('live'); } catch (_) {}
    try { if (typeof window.scheduleHandsFreeRelisten === 'function') window.scheduleHandsFreeRelisten(); } catch (_) {}
    try {
      if (localStorage.getItem('clavis_sound_trigger_enabled') !== 'false') window.startClavisSoundTriggers?.();
    } catch (_) {}
  }

  async function start(opts = {}) {
    if (S.phase !== 'off') return true;
    if (!isAvailable()) return false;
    // Live session (mic → Google) sirf jaage hue Clavis ke liye: boot greeting
    // ya proactive nudge ke liye kabhi nahi khulta — wahi keys khaata tha.
    const trig = opts.trigger || 'button';
    if (trig === 'boot' || trig === 'proactive') return false;
    if (window.ClavisWake && !window.ClavisWake.isAwake()) return false;
    S.phase = 'connecting';
    S.trigger = opts.trigger || 'button';
    S.initialText = String(opts.initialText || '').trim();
    S.keys = geminiKeys();
    S.models = modelList();
    S.keyIdx = 0; S.modelIdx = 0; S.degrade = 0; S.retries = 0;
    { const ok = lastOk(); if (ok.model && ok.model === S.models[0]) S.degrade = Math.min(2, Number(ok.degrade) || 0); }
    S.events = []; S.preroll = []; S.sendBuf = []; S.userText = ''; S.modelText = '';
    S.closeAfterTurn = false; S.cancelled.clear(); S.prerollVoice = false; S.modelBusy = false; S.holding = false;
    // Wake ke saath bola gaya command ("Clavis, leads dikhao") bhi sir ke
    // shabd hain — tool guards (recentUserWords) use dekhte hain.
    if (S.initialText && !S.initialText.startsWith('[')) S.lastUser = { text: S.initialText, at: Date.now() };
    S.heardUser = !!S.initialText && S.trigger !== 'proactive';
    S.streamPaused = false; S.quietHold = []; S.floor = 0; S.voicedRun = 0; S.lastVoicedAt = Date.now(); S.resumedAt = 0;
    // Woken after he asked Clavis to rest: wake up like a person who dozed off.
    if (S.trigger !== 'proactive' && S.trigger !== 'boot') {
      const note = wakeNote();
      if (note) {
        S.initialText = note + (S.initialText ? `\nSir (said while waking you): ${S.initialText}` : '');
        S.heardUser = true;
      }
    }
    S.idleOverride = Number(opts.idleMs) || (S.trigger === 'boot' ? 30000 : wakeIdleMs());
    pauseLegacy();
    showHud();
    setState('connecting');
    // The socket + setup handshake (0.5-1.5 s) runs WHILE the speaker and
    // mic warm up — it needs neither. Words said meanwhile are prerolled.
    connect();
    try {
      await Promise.all([ensureOutput(), startMic()]);
    } catch (e) {
      console.warn('[ClavisLive] audio start failed', e);
      const denied = e?.name === 'NotAllowedError' || e?.name === 'SecurityError';
      cleanup();
      try {
        window.showToast?.({
          type: 'warning',
          title: denied ? 'Microphone blocked' : 'Voice could not start',
          message: denied ? 'Allow the microphone for localhost:3000 (lock icon in the address bar), then tap the mic again.' : String(e?.message || e),
        });
      } catch (_) {}
      resumeLegacy();
      return false;
    }
    // connect() may already have ended the session (no usable key).
    if (S.phase === 'off') return false;
    // A normal browser tab may hold audio until the first click (Chrome's
    // autoplay rule). Keep listening, and let the first click unlock the voice.
    if (S.outCtx.state !== 'running') {
      S.audioBlocked = true;
      caption('Tap anywhere to hear Clavis', 'model');
      const unlock = () => { S.outCtx?.resume().then(() => { S.audioBlocked = false; caption('', ''); }).catch(() => {}); };
      ['pointerdown', 'keydown'].forEach((t) => window.addEventListener(t, unlock, { once: true, passive: true }));
    }
    if (S.trigger === 'button') { try { window.playWakeChime?.(); } catch (_) {} }
    S.lastActivity = Date.now();
    S.rafId = requestAnimationFrame(levelLoop);
    S.idleTimer = setInterval(idleCheck, 5000);
    return true;
  }

  function cleanup() {
    S.phase = 'off';
    fastCaption(false);
    clearTimeout(S.setupTimer); clearTimeout(S.flushTimer); clearTimeout(S.drainTimer); clearTimeout(S.closeTimer);
    clearInterval(S.idleTimer);
    cancelAnimationFrame(S.rafId);
    const ws = S.ws; S.ws = null;
    if (ws) { try { ws.close(1000, 'bye'); } catch (_) {} }
    flushPlayback();
    stopScreen(false);
    try { S.micNode?.disconnect(); S.micSrc?.disconnect(); } catch (_) {}
    try { S.mic?.getTracks().forEach((t) => t.stop()); } catch (_) {}
    try { S.micCtx?.close(); } catch (_) {}
    try { S.outCtx?.close(); } catch (_) {}
    S.mic = S.micCtx = S.micSrc = S.micNode = S.micAnalyser = null;
    S.outCtx = S.player = S.outGain = S.outAnalyser = null;
    S.speaking = false; S.muted = false; S.ducked = false;
    hudFlag('mute', false);
    hideHud();
    try { window.StrandsOrb?.instance?.setState?.('idle'); } catch (_) {}
  }

  function stop({ reason = 'user' } = {}) {
    if (S.phase === 'off') return;
    commitTurn(false);
    holdLive(false);
    cleanup();
    S.state = 'off';
    // Session khatam (so jao / end button / idle) = Clavis soya. Error /
    // quota par nahi — tab normal voice jaage hue hi jawab de sakti hai.
    if (/^(sleep|user|idle)$/.test(reason)) { try { window.ClavisWake?.sleep?.(reason === 'sleep' ? 'live' : 'live-' + reason); } catch (_) {} }
    try { window.setJarvisStatus?.('online', reason === 'idle' || reason === 'sleep' ? 'Resting — snap or say "Clavis"' : 'Clavis Online'); } catch (_) {}
    resumeLegacy();
  }

  function fatal(message) {
    console.warn('[ClavisLive]', message);
    stop({ reason: 'error' });
    try { window.showToast?.({ type: 'warning', title: 'Live voice paused', message: `${message} Normal voice mode is still on.` }); } catch (_) {}
  }

  function allKeysSpent() {
    stop({ reason: 'exhausted' });
    armClipboardRefuel();
    // Open the AI Studio key page for him (native bridge needs no click), at most every 6 h.
    const last = Number(localStorage.getItem(LS.opened)) || 0;
    if (Date.now() - last > 6 * 3600e3) {
      try { localStorage.setItem(LS.opened, String(Date.now())); } catch (_) {}
      Promise.resolve(window.ClavisPC?.open?.(AI_STUDIO_KEYS)).catch(() => {});
    }
    const say = 'Sir, Google AI Studio ki live voice quota abhi khatam ho gayi hai. Maine key page khol diya hai — naya key copy karke yahan wapas aaiye, main khud utha lunga. Tab tak normal voice chalu hai.';
    try { window.speakJarvisText?.(say); } catch (_) {}
  }

  /* ── refuel: pick up a freshly copied AI Studio key ────────── */
  let refuelArmed = false;
  function armClipboardRefuel() {
    if (refuelArmed) return;
    refuelArmed = true;
    const tryClipboard = async () => {
      if (!refuelArmed || !navigator.clipboard?.readText) return;
      let text = '';
      try { text = (await navigator.clipboard.readText()).trim(); } catch (_) { return; }
      const m = text.match(/AIza[0-9A-Za-z_\-]{30,}|AQ\.[0-9A-Za-z_\-.]{20,}/);
      if (!m) return;
      const key = m[0];
      const known = geminiKeys().concat((window.ClavisKeyVault?.all?.('gemini')) || []);
      if (known.includes(key)) return;
      refuelArmed = false;
      window.removeEventListener('focus', tryClipboard);
      // He saves keys himself: fill the setup popup, "Check & Save" does the rest.
      if (window.ClavisSetup?.open) { window.ClavisSetup.open({ reason: 'refuel', provider: 'gemini', prefill: key }); return; }
      try {
        // A models list call proves the key without spending any quota.
        const ok = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?pageSize=1&key=${encodeURIComponent(key)}`).then((r) => r.ok).catch(() => false);
        if (!ok) throw new Error('Google did not accept that key.');
        if (window.ClavisKeyVault?.add) await window.ClavisKeyVault.add('gemini', key, { skipVerify: true });
        else window.ClavisDirect?.setKey?.('gemini', key);
        const spent = spentMap(); delete spent[tail(key)];
        localStorage.setItem(LS.spent, JSON.stringify(spent));
        const first = !S.everHadKey;
        window.showToast?.({ type: 'success', title: 'Google AI Studio connected', message: 'Clavis now has its live voice.' });
        start({ trigger: 'button', initialText: first
          ? '[SYSTEM EVENT] Sir just connected a Google AI Studio key, so this is the first time he hears your real voice. Greet him warmly in one or two short lines and say he can simply talk to you now.'
          : '[SYSTEM EVENT] Sir just connected a fresh Google AI Studio key after the old one ran out. Thank him in one short line and carry on.' });
      } catch (e) {
        refuelArmed = true;
        window.addEventListener('focus', tryClipboard);
        window.showToast?.({ type: 'warning', title: 'That key did not work', message: String(e?.message || e) });
      }
    };
    window.addEventListener('focus', tryClipboard);
  }
  window.addEventListener('clavis:refuel-needed', (e) => { if (e.detail?.provider === 'gemini') armClipboardRefuel(); });

  // No AI Studio key yet: Clavis has no live voice. Say so once, kindly, with
  // one button that opens the key page and picks the key up when he's back.
  function promptKey() {
    if (geminiKeys().length || sessionStorage.getItem('clavis_live_key_prompted')) return false;
    try { sessionStorage.setItem('clavis_live_key_prompted', '1'); } catch (_) {}
    const go = () => {
      armClipboardRefuel();
      try { window.open(AI_STUDIO_KEYS, '_blank', 'noopener'); } catch (_) {}
      try { window.ClavisKeyVaultUI?.open?.('gemini'); } catch (_) {}
    };
    // Setup wizard ho to wahi (ek jagah saari keys); warna toast — notifications.js
    // sirf actions:[{label, run}] samajhta hai (purana `action:{onClick}` chup-chaap gayab tha).
    try {
      if (window.ClavisSetup?.open) { window.ClavisSetup.open({ reason: 'voice' }); return true; }
      window.showToast?.({
        type: 'info', title: 'Give Clavis its real voice',
        message: 'Connect a free Google AI Studio key — copy it, come back here, and Clavis picks it up by itself.',
        actions: [{ label: 'Get free key', run: go }],
      });
    } catch (_) {}
    return true;
  }

  /* ── app events worth saying out loud ──────────────────────── */
  document.addEventListener('nexus:scrapedone', (e) => {
    if (!isActive() || busy()) return;
    const d = e.detail || {};
    const n = Array.isArray(d.leads) ? d.leads.length : (d.total || 0);
    notify(d.ok === false ? 'The lead search ended without results.' : `A lead search just finished with ${n} leads saved.`);
  });

  // A proactive nudge from ClavisProactive / ClavisVision: said in Clavis's
  // own voice and words (the model phrases it from the context, so it never
  // sounds canned), then the link sleeps again if sir doesn't answer.
  // Soye hue Clavis ke liye koi naya Live session nahi (start() 'proactive'
  // mana karta hai) — sirf chalu, jaage hue session me ek line.
  function proactive({ mood = 'working', line = '', context = '' } = {}) {
    if (window.ClavisWake && !window.ClavisWake.allowBackground()) return false;
    if (!isActive()) return false;
    const now = Date.now();
    if (now < S.snoozeUntil || now - S.lastProactiveAt < PROACTIVE_GAP_MS) return false;
    if (now - S.lastUserVoiceAt < PROACTIVE_AFTER_TALK_MS) return false;   // let him think
    S.lastProactiveAt = now;
    const text = `Proactive moment (sir did not ask anything; mood looks "${mood}"). ${context ? 'What you can see of his work: ' + plain(context).slice(0, 700) + '. ' : ''}${line ? 'A suggestion you had: "' + plain(line).slice(0, 240) + '". ' : ''}If you have something specific and useful, say it in one short natural line in your own words, politely, with an opener you haven't used before. If it isn't genuinely useful, just say nothing.`;
    notify(text);
    return true;
  }

  function isActive() { return S.phase !== 'off'; }
  if (!window.isClavisSpeaking) window.isClavisSpeaking = () => S.speaking || !!window.isJarvisSpeaking;
  if (!window.isClavisListening) window.isClavisListening = () => S.phase !== 'off';
  function hush() { flushPlayback(); }
  function toggle(opts) { return isActive() ? (stop({ reason: 'user' }), false) : start(opts); }

  window.addEventListener('pagehide', () => { if (isActive()) cleanup(); });

  // Settings → Voice: show the saved patience in its picker.
  const syncPatience = () => { const sel = document.getElementById('sm-live-patience'); if (sel) sel.value = String(patienceMs()); };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', syncPatience, { once: true }); else syncPatience();

  window.ClavisLive = {
    start, stop, toggle, isActive, isAvailable, relay, notify, hush, toggleScreen, proactive, promptKey,
    setMuted, sleep: goToSleep,
    // Takes effect on the next session (the server reads it at setup).
    setPatience(ms) { try { localStorage.setItem('clavis_live_patience_ms', String(Number(ms) || 1100)); } catch (_) {} return patienceMs(); },
    status: () => ({ phase: S.phase, state: S.state, model: S.models[S.modelIdx] || null, keys: geminiKeys().length, degrade: S.degrade, streamPaused: !!S.streamPaused }),
    // Runnable check for the pure bits — ClavisLive._selfTest() in DevTools.
    _selfTest() {
      const ok = [
        classifyClose(1011, 'You exceeded your current quota') === 'quota',
        classifyClose(1008, 'API key not valid. Please pass a valid API key.') === 'badkey',
        classifyClose(1008, 'models/x is not found for API version v1beta, or is not supported for bidiGenerateContent') === 'model',
        classifyClose(1007, 'Invalid JSON payload received. Unknown name "proactivity"') === 'feature',
        classifyClose(1006, '') === 'transient',
        typeFor('array of city names').type === 'ARRAY',
        typeFor('number of leads per combo (default 5)').type === 'NUMBER',
        typeFor('short label').type === 'STRING',
        new Int16Array(floatToPcm16(new Float32Array([1, -1, 0])))[1] === -32768,
        new Uint8Array(bufferFromB64(b64FromBuffer(new Uint8Array([1, 2, 250]).buffer)))[2] === 250,
      ];
      const passed = ok.filter(Boolean).length;
      console[passed === ok.length ? 'log' : 'error'](`ClavisLive self-test: ${passed}/${ok.length}`);
      return passed === ok.length;
    },
  };
})();
