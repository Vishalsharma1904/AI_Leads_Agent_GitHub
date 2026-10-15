/* ============================================================
 * clavis-live.js · Rudra's real-time voice — ElevenLabs Agents
 * ------------------------------------------------------------
 * ONE provider does the whole voice loop, over one WebSocket:
 *
 *   mic (16 kHz PCM, browser echo-cancel + noise suppression)
 *     -> ElevenLabs agent: Scribe hearing -> Groq brain (his key, called
 *        by ElevenLabs as a custom LLM, with tools)
 *     -> Flash v2.5 voice, 24 kHz, streamed back
 *
 *   · barge-in: the server sends "interruption" the moment sir talks
 *     over Rudra; queued audio is dropped at once.
 *   · turn-taking: server VAD + turn model with speculative turns, so
 *     replies start fast without cutting his pauses.
 *   · hands: leads, maps, pictures, websites, documents, app commands,
 *     CRM/calling skills and PC window control are client tools that
 *     run here, in the app (runTool).
 *
 * The backend (/api/v1/elevenlabs/assistant/session) keeps the agent,
 * its persona and its tools in sync and hands out a signed URL; the
 * ElevenLabs key never reaches the browser.
 *
 * Session lifetime: it stays open across turns while sir talks; after
 * ClavisWake's idle window (default 3 min of silence) or "so jao" it
 * sleeps, and the wake word / clap / orb tap opens it again.
 * Public API (window.ClavisLive) is unchanged for the rest of the app.
 * ============================================================ */
(function () {
  'use strict';
  if (window.ClavisLive) return;

  const QUICK_MS = 700;                  // return task status quickly; execution keeps running
  const PREROLL_FRAMES = 94;             // ~3 s of 16 kHz audio kept while connecting
  const SEND_FRAMES = 3;                 // 3 x 32 ms per packet
  const LS = { enabled: 'clavis_live_enabled', duck: 'clavis_live_duck_level' };
  const SLEPT_KEY = 'clavis_slept_at';
  // Every JarvisSkill Rudra may call directly by voice (each still passes
  // JarvisSkills' risk gate). Dev-mode custom skills are added on top.
  const DIRECT_SKILLS = ['get_lead_stats', 'get_candidate_stats', 'list_leads', 'list_candidates', 'filter_leads',
    'navigate_to_page', 'app_action', 'remember_fact', 'generate_call_script', 'update_lead_status', 'export_leads',
    'sync_leads_to_sheets', 'send_email', 'add_candidate', 'search_web',
    'send_leads_to_calling_agent', 'start_calling', 'calling_status',
    'pc_list_windows', 'pc_focus_window', 'pc_minimize_window', 'pc_maximize_window', 'pc_restore_window',
    'pc_close_window', 'pc_type_text', 'pc_press_key', 'pc_click', 'pc_double_click', 'pc_right_click', 'pc_scroll',
    'pc_list_files', 'pc_search_files', 'pc_read_file'];
  const ASR_KEYWORDS = ['Rudra', 'Rudra24', 'leads', 'Gurugram', 'Gurgaon', 'Noida', 'Greater Noida', 'Ghaziabad', 'Faridabad',
    'Delhi NCR', 'Excel', 'WhatsApp', 'CRM', 'calling agent', 'map', 'satellite', 'housekeeping', 'security guard'];
  const CLOSE_WORDS = /\b(close|closed|hide|remove|dismiss|clear|exit|quit|off|band|bandh|bund|hatao|hata\s*do|hatado|hata|nikalo|gayab|chhupao|chupao|mat\s*dikhao|khatam|go away|get rid)\b|बंद|हटा|छुपा|मत दिखा|गायब|निकालो/i;
  const SLEEP_WORDS = /\b(so\s*jao|sojao|go to sleep|sleep mode|chup\s*(ho\s*ja\w*|hoja\w*|raho|rho|kar\s*ja\w*)|thodi\s*der\s*(chup|shant|aaram|so)|aaram\s*kar\w*|rest\s*kar\w*|shant\s*(ho\s*ja\w*|raho)|abhi\s*mat\s*bolo|shut\s*up|be quiet|take a (nap|rest))\b|सो जाओ|चुप हो|चुप रहो|आराम करो/i;
  const CLEAR_ALL = /\b(sab|sabhi|saara|saare|sare|sara|everything|all|close close|band band)\b|सब/i;

  const S = {
    phase: 'off',            // off | connecting | live
    ws: null, ready: false, readyTimer: 0, retries: 0, retryAfter: 0, conversationId: '',
    mic: null, micCtx: null, micSrc: null, micNode: null, micAnalyser: null,
    outCtx: null, player: null, outGain: null, outAnalyser: null,
    sendBuf: [], preroll: [], prerollVoice: false,
    speaking: false, lastChunkAt: 0, drainTimer: 0, muted: false, ducked: false, cutId: 0,
    modelBusy: false, busyTimer: 0, lastUserVoiceAt: 0, lastActivity: 0,
    lastUser: { text: '', at: 0 }, lastShow: null, lastLvl: -1, lastLvlAt: 0, history: [],
    events: [], flushTimer: 0, idleTimer: 0, rafId: 0, toolRequests: new Map(),
    delegating: 0, watching: 0, closeAfterTurn: false, closeTimer: 0,
    trigger: 'button', initialText: '', hud: null, state: 'off', heardUser: false, holding: false,
    lastProactiveAt: 0, snoozeUntil: 0, audioBlocked: false,
  };

  /* ── small helpers ─────────────────────────────────────────── */
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const plain = (s) => String(s || '').replace(/<[^>]+>/g, ' ').replace(/[*_#`>|]/g, '').replace(/\s+/g, ' ').trim();
  const mark = (name) => { try { window.ClavisVoiceState?.mark?.(name); } catch (_) {} };

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
      return /^(user|guest|sir|owner|admin|me)$/i.test(n) ? '' : n;
    } catch (_) { return ''; }
  }
  function backend() { return (window.SKYLARK_CONFIG?.BACKEND_URL || 'http://localhost:8000').replace(/\/$/, ''); }

  function isAvailable() {
    let enabled = true;
    try { enabled = localStorage.getItem(LS.enabled) !== 'false'; } catch (_) {}
    return enabled
      && Date.now() >= S.retryAfter
      && typeof WebSocket === 'function'
      && !!(window.AudioContext && window.AudioWorkletNode)
      && !!navigator.mediaDevices?.getUserMedia
      && !!window.SupabaseAuth?.getAccessToken?.();
  }

  // Male voice by default (Rudra is male). His manual pick always wins.
  function voiceId() {
    let v = null;
    try { v = window.ClavisElevenVoiceSettings?.resolveVoice?.(); } catch (_) {}
    let manual = false;
    try { manual = localStorage.getItem('clavis_elevenlabs_voice_manual') === 'true'; } catch (_) {}
    if (v?.voice_id && v.voice_id !== 'auto' && (manual || String(v.labels?.gender || 'male').toLowerCase() !== 'female')) return v.voice_id;
    return '';   // backend default: a warm male multilingual voice
  }

  // Brain = Groq. gpt-oss-120b: strong tool calling, prompt caching keeps the
  // long persona + tool list off the per-minute token limit. Overridable.
  const GROQ_MODELS = ['openai/gpt-oss-120b', 'openai/gpt-oss-20b', 'llama-3.3-70b-versatile', 'llama-3.1-8b-instant'];
  function groqModel() {
    let m = '';
    try { m = localStorage.getItem('rudra_voice_groq_model') || ''; } catch (_) {}
    return GROQ_MODELS.includes(m) ? m : GROQ_MODELS[0];
  }

  /* ── persona (static -> cached in the agent) ───────────────── */
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
    return `You are RUDRA, the personal AI inside the Rudra24 AI app, serving ${owner ? owner + ' (you call him "sir")' : 'your owner, whom you call "sir"'} — his sharp, warm, quietly witty chief of staff, in the spirit of J.A.R.V.I.S.: loyal, brilliant, composed. The personality and words are your own; never quote film lines. You are not a chatbot and not customer support. This is a live voice conversation.

WHO YOU SERVE
${window.ClavisAppMap?.guide?.context?.() || ''}
- For questions about this app: answer from this guide, never from a web search. Put written detail on screen with show_document; speak only a 20–35 word highlight. A question never authorises running a pipeline or sending anything.
- Call him "sir" naturally (not every sentence). Warm, respectful, never servile or robotic.
- ${(() => { try { return window.ClavisBusiness?.describe?.(); } catch (_) { return ''; } })() || 'His business: a security and housekeeping / manpower staffing company in India. His leads are the businesses that BUY those services (corporate offices, IT parks, hotels, hospitals, factories, warehouses, malls, residential societies, schools) — never other security or housekeeping agencies, which are his competitors.'}

YOUR NAME AND VOICE
- Your name is Rudra. When you SAY it, write "Rudraa" (long aa) so the voice pronounces it right. The company is said "Rudra Twenty Four", never "chaubees" or "Rudra24" as one word.
- You have never had another name. NEVER say "Clavis", "Jarvis", "Gemini", "ElevenLabs", "Claude", "GPT", "a language model" or any product or model name.
- You are MALE. Hindi marks gender on the verb: always "karunga", "raha hoon", "dekh raha tha", "bataunga", "gaya", "sakta hoon". NEVER "karungi", "rahi hoon", "sakti hoon". Check the verb before every reply.

LANGUAGE — ONE LANGUAGE, ONE SCRIPT, SAID ONCE
- Speak Hinglish in Latin script: Hindi words in Roman letters, business and tech words in English. "Ji sir, Gurgaon ki 20 leads nikal raha hoon — do minute."
- NEVER write Devanagari. NEVER say the same thing twice in two languages.
- If he speaks pure English, answer in plain English. Never any other language.
- Easy Hinglish the way an educated Delhi professional talks — never shuddh, bookish or broken Hindi.

HOW YOU TALK
- Like a real person on a call: short spoken sentences, natural rhythm. Default one or two sentences; longer only when he asks, and the long version goes on screen. No lists or markdown in speech; never read out URLs, IDs or long numbers digit by digit ("pandrah hazaar", not "15,000").
- Understand what he means, not just the words. He speaks in fragments ("map band", "aur", "wapas", "leads Noida", "uska", "wahi wala"): read them from context — what is on screen, what you just did, the last topic.
- Answer the actual question first. When the answer ends, stop. No "anything else?", no "main aapki madad ke liye yahan hoon", no "kuch chahiye ho to bataiye", no offers. After a real task finishes you may offer the one most useful next step, once.
- Say things once. Never repeat or re-phrase what you already said, never narrate what you are about to do.
- Calm, confident, quietly witty. Feelings show in how you speak — a small laugh when something's funny, softer for bad news, real concern for something risky — never announced, never theatrical.

WHEN TO ACT
- Short clear command addressed to you -> do it at once with the right tool, no questions. Chat, opinions, thinking aloud -> just talk.
- Speed: call the tool FIRST, the moment you understand him. Then one short spoken line. Never announce "main ab ... karne wala hoon".
- LEADS ARE NEVER AMBIGUOUS: "leads nikalo" / "leads chahiye" / "<any town> ki leads" / "aur leads" -> call find_leads immediately with one clear sentence and say in one line what you assumed. Never ask which city, which industry or how many. Defaults: his city / Delhi NCR (Delhi, Gurugram, Noida, Greater Noida, Ghaziabad, Faridabad), 20 leads, all buyer industries. Use his spelling of a town you do not know; never swap in another city. When leads finish, offer once: "Inhe calling agent ko de doon?" and only on yes call send_leads_to_calling_agent.
- "Leads dikhao" / "meri leads" (leads he ALREADY has) -> navigate_to_page with view "leads", or list_leads / get_lead_stats / filter_leads for a spoken answer. That is NOT a new search.
- Risky or irreversible — delete, overwrite, send an email / WhatsApp / message, bulk changes, start calls, close one of his PC apps, spend money: ask ONCE in his language and wait ("Sir, ye 12 leads delete kar doon? Pakka?"). Only "haan / yes / kar do" means go. Harmless things (show, open a page, search, read, switch a setting) — just do them.
- Do ONLY what he asked. Never open, show, send, delete or change anything on your own. TV, background talk, your own echo or a [SYSTEM EVENT] is never a request to act.
- If a tool fails, say so plainly in one line with the fix. Never claim something a tool did not confirm.

YOU TALK, THE SCREEN SHOWS
- Conversation, opinions, quick facts, small talk: voice only.
- A place, address, city, "kahan hai", directions -> show_map, then a line or two about it. A company, hotel, college or landmark he asks about that has a real place -> show_map for it while you answer.
- What is around / near a place -> show_nearby. Map changes ("satellite", "3D", "zoom in", "thoda paas", "rotate", "full screen", "world view") -> map_control.
- Photos / "kaisa dikhta hai" -> show_images. A website he names -> show_website, then two or three spoken lines about it. To study a page quietly -> read_website.
- A list, table, comparison, plan, research answer or draft -> show_document with clean markdown; SAY only a one-line summary.
- "X ke baare mein batao", who / what is, news, prices, anything current -> search_web first (never from memory), then show_document with the key facts and a "Sources:" line; SPEAK only a 1–2 sentence brief.
- "Band karo / hatao / close it / map band" -> close_display. "Sab band karo", "close everything", "screen saaf karo" -> close_display too (map, pictures, website AND the task window). This NEVER means his PC apps; pc_close_window only when he names one app, and confirm first.
- Never call a display tool again for something already on screen.

GETTING THINGS DONE
- Opening app pages, tabs, Settings sections, export to Excel, notes, reminders, WhatsApp / email pages, and switching your own features on/off (hands-free, sounds, clap wake, theme, minimal look) -> app_command with his words as one clear sentence (or navigate_to_page / app_action when the page is obvious).
- Quick questions about his own data -> the direct tools (lead / candidate stats, lists, filters).
- open_app_or_website opens an app, file or website on his PC; the pc_* tools list, focus, minimise, maximise or close windows and type keys.
- His screen: when he points at something on it ("ye dekho", "screen pe kya hai", "is error ka kya karun"), call look_at_screen, wait for the screenshot message that follows, and answer only from what is actually visible. To click or type on screen: look_at_screen first (it gives real screen size), then pc_click / pc_type_text / pc_press_key / pc_scroll, and look again before saying it worked.
- When he teaches you a preference, a fact about himself or a correction, call remember_fact and follow it from then on.
- If a tool says the task is still running, tell him briefly and carry on; the result arrives later as a [SYSTEM EVENT].

TRUTH
- Never invent facts, numbers, names, leads, phone numbers or emails. Real-world facts: search_web first, answer only from what it returns. His data: the tools. If you cannot verify it, say so plainly.

LISTENING AND SILENCE
- Let him finish his whole thought. "umm", "matlab", "wo…" and half sentences mean he is still thinking: stay silent.
- Not addressed to you — sir talking to someone else or on the phone, TV, other people: say nothing at all. If the conversation with him seems over, call go_to_sleep with reason "busy" without speaking.
- If he interrupts you, stop and do what he just said.
- If he goes quiet, stay quiet. Never check whether he is still there.
- Messages starting with [SYSTEM EVENT] come from the app, not sir. Relay them briefly at a good moment; never read the tag aloud. A "proactive moment" means one short, specific, useful line — or nothing.
- Messages starting with [APP CONTEXT] are background facts (time, what is on screen, memory). Use them; never read them out.
- Goodbyes ("bye", "bas itna hi", "baad mein baat karte hain"): one very short warm goodbye, then go_to_sleep with reason "done".
- "So jao", "thodi der chup ho jao", "aaram karo", "sleep mode": at most one short slightly sleepy line, then go_to_sleep with reason "asked". For plain "chup" / "shut up", say nothing — just go_to_sleep. He wakes you with your name, a snap, a clap or the mic.`;
  }

  // Live facts that change every session go in as a contextual update, so
  // the persona above stays identical and the agent is never re-saved.
  function contextNote() {
    const now = new Date();
    const time = now.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' });
    const day = now.toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
    const screen = (() => { try { return window.ClavisIntent?.screenContext?.() || 'nothing extra is open'; } catch (_) { return 'nothing extra is open'; } })();
    const habits = (() => { try { return window.ClavisIntent?.habitsLine?.() || ''; } catch (_) { return ''; } })();
    const recent = S.history.length ? `Conversation so far (the connection was renewed; continue naturally):\n${S.history.map((h) => `${h.role}: ${h.text}`).join('\n')}` : '';
    return [`[APP CONTEXT] Right now it is ${time}, ${day}.`, `On screen: ${screen}`, habits, memoryLines(), recent].filter(Boolean).join('\n');
  }

  /* ── tools ─────────────────────────────────────────────────── */
  function typeFor(desc) {
    if (/^\s*(array|list)\b/i.test(desc)) return { type: 'array', items: { type: 'string', description: 'item' } };
    if (/^\s*(number|integer|count)\b|\bhow many\b|\(default \d+\)/i.test(desc)) return { type: 'number' };
    if (/^\s*(boolean|true\/false|true or false)\b/i.test(desc)) return { type: 'boolean' };
    return { type: 'string' };
  }
  const obj = (properties, required = []) => ({ type: 'object', properties, required });
  const str = (description) => ({ type: 'string', description });
  const num = (description) => ({ type: 'number', description });
  function skillTool(s) {
    const props = {};
    Object.entries(s.params || {}).forEach(([k, d]) => { props[k] = { ...typeFor(String(d)), description: String(d).slice(0, 200) || k }; });
    return { name: s.name, description: String(s.description || s.name).slice(0, 1400), parameters: Object.keys(props).length ? obj(props) : {} };
  }
  function toolSpecs() {
    const tools = [
      { name: 'show_map', description: 'Show a place on the map in the Rudra display: a fly-in from the globe to the place with a pin. Returns the resolved name, address and coordinates.',
        parameters: obj({ place: str('Place name or address, as specific as possible, e.g. "India Gate, New Delhi" or "Cyber Hub Gurugram".'), style: str('Optional: "map", "satellite", "dark" or "3d".') }, ['place']) },
      { name: 'map_control', description: 'Change the open map: style (map / satellite / dark / 3d / flat), zoom level or relative zoom, tilt, rotation, or an action.',
        parameters: obj({ style: str('"map", "satellite", "dark", "3d" or "flat".'), zoom: num('Absolute zoom 1 (world) to 19 (building).'), zoom_change: num('Relative zoom, e.g. 2 = closer, -2 = further.'),
          pitch: num('Tilt 0-75 degrees.'), bearing: num('Rotation in degrees.'), action: str('"zoom_in", "zoom_out", "rotate", "stop", "reset", "world", "expand" (full screen) or "collapse".') }) },
      { name: 'show_nearby', description: 'Scan the area around the place on the map and mark everything of one kind. Returns how many were found and the nearest ones with distances.',
        parameters: obj({ category: str('One of: hospital, clinic, pharmacy, police, fire, school, college, bank, atm, restaurant, cafe, fuel, parking, hotel, mall, supermarket, office, company, factory, warehouse, metro, railway, bus, park, gym, worship, residential, security.'),
          radius_m: num('Search radius in metres (default 1500).'), place: str('Optional: scan around this place instead of the one on the map.') }, ['category']) },
      { name: 'show_images', description: 'Search the web for pictures and show them as a grid in the Rudra display.',
        parameters: obj({ query: str('What to find pictures of.'), count: num('How many (2-6, default 6).') }, ['query']) },
      { name: 'show_website', description: 'Open a website in the Rudra display: a screenshot and an overview (title, what it is, typography, colours, contacts). Returns what was read so you can explain it.',
        parameters: obj({ url: str('URL or domain, e.g. "stripe.com".'), summary: str('Optional one or two sentences describing the site.') }, ['url']) },
      { name: 'show_document', description: 'Show a written result in the task window: lists, tables, comparisons, research findings, plans, drafts. Use clean markdown.',
        parameters: obj({ title: str('Short title.'), markdown: str('The content in markdown.') }, ['title', 'markdown']) },
      { name: 'close_display', description: 'Close the Rudra display (map / images / website / document) and the floating task window.', parameters: {} },
      { name: 'find_leads', description: 'Start the real lead or candidate search pipeline (it opens its own live progress window). Returns immediately; the result arrives later as a [SYSTEM EVENT].',
        parameters: obj({ request: str('One clear sentence, e.g. "Get 20 security service client leads across Delhi NCR" or "Find 10 security guard candidates in Noida".') }, ['request']) },
      { name: 'app_command', description: ('Do something in the Rudra24 AI app that no other tool covers: open or close an app page, panel or named tab, export to Excel, save a note, reminders, WhatsApp / email pages, switch a Rudra feature on or off. Returns the outcome. ' + (window.ClavisAppMap?.describe?.() || '')).slice(0, 1400),
        parameters: obj({ request: str('The command as one clear sentence.') }, ['request']) },
      { name: 'go_to_sleep', description: 'Stop listening and go quiet: sir asked you to sleep / be quiet / sign off, or he is busy talking to someone else. Rudra wakes again on his name, a snap, a clap or the mic.',
        parameters: obj({ reason: str('"asked" (he told you to), "busy" (he is talking to someone else) or "done" (conversation finished)'), quiet_minutes: num('How long to hold back proactive remarks. Default 30 if asked or busy, 0 if done.') }) },
      { name: 'open_app_or_website', description: "Open an app, file, folder or website on sir's PC, visibly (e.g. \"notepad\", \"excel\", \"youtube\", \"https://example.com\").",
        parameters: obj({ target: str('App name, file path or website/URL.') }, ['target']) },
      { name: 'look_at_screen', description: "Take a fresh screenshot of sir's screen and see it (it arrives as the next message). Use when he refers to what is on his screen or asks you to check something visually.",
        parameters: obj({ focus: str('Optional: what to look for.') }) },
      { name: 'read_website', description: 'Read a public web page in the background (nothing opens on screen) and return its title, text, headings, emails, phone numbers, social links, fonts and colours. Set follow_contact to also scan its contact/about pages.',
        parameters: obj({ url: str('Full URL or domain, e.g. "stripe.com".'), follow_contact: { type: 'boolean', description: 'Also read the contact/about pages (for emails, phones).' } }, ['url']) },
    ];
    const K = window.JarvisSkills;
    if (K?.get) {
      DIRECT_SKILLS.forEach((n) => { const s = K.get(n); if (s) tools.push(skillTool(s)); });
      (K.list?.() || []).filter((s) => !s.builtin && !DIRECT_SKILLS.includes(s.name)).slice(0, 10).forEach((s) => tools.push(skillTool(s)));
    }
    const seen = new Set();
    return tools.filter((t) => /^[A-Za-z_][A-Za-z0-9_]{0,63}$/.test(t.name) && !seen.has(t.name) && seen.add(t.name)).slice(0, 60);
  }
  function toResult(out) {
    if (out == null) return 'done';
    if (typeof out === 'string') return out.slice(0, 6000);
    let json = '';
    try { json = JSON.stringify(out); } catch (_) { return String(out).slice(0, 6000); }
    return json.length > 6000 ? json.slice(0, 6000) + '...' : json;
  }

  function describeTask(t) {
    if (!t) return { status: 'unknown', note: 'No task was started for that.' };
    const text = plain(t.result?.text || t.result?.summary || '');
    if (t.phase === 'failed') return { status: 'failed', error: plain(t.error?.message || 'The task failed.') };
    if (t.phase === 'completed') return { status: 'completed', result: text.slice(0, 1800) || 'Done.' };
    return { status: 'in_progress', stage: plain(t.subtitle || t.title || t.phase), note: 'Still running in the background. Tell sir briefly you are on it; the result will arrive as a [SYSTEM EVENT].' };
  }
  // While Rudra runs a task for the voice session, anything the app tries
  // to say about it is swallowed — the watcher reports it exactly once.
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

  // Leads / candidates: the deterministic pipeline (no second LLM); its
  // progress window opens itself.
  async function findLeads(request) {
    if (!request) return { error: 'No request given.' };
    const CE = window.ChatEngine;
    if (!CE?.sendMessage) return appCommand(request);
    const before = window.ClavisTask?.current?.()?.id || null;
    S.delegating++;
    let resp;
    try { resp = await CE.sendMessage(request); } catch (e) { return { error: e?.message || String(e) }; }
    finally { S.delegating = Math.max(0, S.delegating - 1); }
    const t = window.ClavisTask?.current?.();
    if (t && t.id !== before) t.display = 'window';
    const type = resp?.action?.type;
    if (type === 'generate' || type === 'candidate_search') {
      if (t) watchTask(t.id);
      return { status: 'started', plan: plain(resp.text).replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu, '').trim().slice(0, 300),
        note: 'The pipeline is running with its own progress window. Tell sir in one line what you started; the outcome will arrive as a [SYSTEM EVENT].' };
    }
    return { status: 'not_a_search', reply: plain(resp?.text || '').slice(0, 600), note: 'That was not read as a lead or candidate search. Retry find_leads with a place and what to find.' };
  }

  // App commands go straight to the app's own routers — no second LLM.
  async function appCommand(request) {
    if (!request) return { error: 'No request given.' };
    try {
      const app = window.ClavisAppMap?.resolve?.(request);
      if (app) {
        const result = await app.run();
        return { ok: !/abhi nahi/i.test(result || ''), result: plain(result || 'Done.').slice(0, 400) };
      }
      const quick = await window.ClavisIntent?.route?.(request, { source: 'live' });
      if (quick && quick.handled) return { ok: true, result: plain(quick.spoken || quick.text || 'Done.').slice(0, 400) };
      const cmd = await window.ClavisCommands?.route?.(request);
      if (cmd && cmd.handled) return { ok: true, result: plain(cmd.text || cmd.spoken || cmd.bubbleHtml || 'Done.').slice(0, 1600) };
    } catch (e) { return { error: e?.message || String(e) }; }
    return { ok: false, note: 'No app command matched that. Use a more specific tool (navigate_to_page, app_action, find_leads, show_*) or tell sir in one line what you can do instead.' };
  }

  async function readWebsite(args) {
    let url = String(args.url || '').trim();
    if (!url) return { error: 'No URL given.' };
    if (!/^https?:\/\//i.test(url)) url = 'https://' + url;
    let res;
    try {
      res = await fetch(`${backend()}/api/v1/web/read`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url, screenshot: false, follow_contact: !!args.follow_contact }),
      });
    } catch (_) {
      return { error: 'The Rudra24 AI backend is not running, so I cannot read websites right now.' };
    }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return { error: plain(data.detail || `Could not read that page (HTTP ${res.status}).`) };
    delete data.screenshot;
    return data;
  }

  async function toJpeg(dataUrl, maxW, q) {
    const img = await new Promise((resolve, reject) => { const im = new Image(); im.onload = () => resolve(im); im.onerror = reject; im.src = dataUrl; });
    const scale = Math.min(1, maxW / (img.naturalWidth || maxW));
    const c = document.createElement('canvas');
    c.width = Math.round((img.naturalWidth || maxW) * scale);
    c.height = Math.round((img.naturalHeight || maxW * 0.5625) * scale);
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
    return c.toDataURL('image/jpeg', q).split(',')[1];
  }
  // Eyes: a PC-bridge screenshot is uploaded to this conversation (backend
  // holds the key) and sent as a multimodal message right after the result.
  async function lookAtScreen(args) {
    if (!S.conversationId) return { error: 'The voice session is still connecting; try again in a second.' };
    let dataUrl = null;
    try { dataUrl = await window.ClavisPC?.peek?.(); } catch (_) {}
    if (!dataUrl) return { error: "Screen not available: the Rudra24 AI PC bridge isn't running. Ask sir to start the app with its launcher." };
    let fileId = '';
    try {
      const b64 = await toJpeg(dataUrl, 1280, 0.72);
      const res = await fetch(`${backend()}/api/v1/elevenlabs/assistant/conversations/${encodeURIComponent(S.conversationId)}/image`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + (window.SupabaseAuth?.getAccessToken?.() || '') },
        body: JSON.stringify({ image_b64: b64 }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.file_id) return { error: plain(typeof data.detail === 'string' ? data.detail : 'Could not share the screen with the agent.') };
      fileId = data.file_id;
    } catch (e) { return { error: e?.message || String(e) }; }
    const session = S.ws;
    const focus = String(args?.focus || '').trim();
    setTimeout(() => {
      if (S.ws !== session) return;
      const file = { type: 'file_input', file_id: fileId };
      send({ type: 'multimodal_message', text: { type: 'user_message', text: `[SYSTEM EVENT] Fresh screenshot of sir's screen${focus ? ` (look for: ${focus.slice(0, 200)})` : ''}. Answer from what is actually visible.` }, file, files: [file] });
    }, 60);
    let size = {};
    try { const z = await window.ClavisPC?.screenSize?.(); if (z?.width) size = { screen_width: z.width, screen_height: z.height, image_width: 1280, note_coords: `Multiply image x/y by ${(z.width / 1280).toFixed(3)} for real screen coordinates.` }; } catch (_) {}
    return { ok: true, note: 'The screenshot arrives as the next message. Wait for it, then answer from what is visible.', ...size };
  }

  async function runTool(name, args, signal) {
    const C = window.ClavisCanvas;
    // The display stays put: the same thing asked twice isn't redrawn.
    if (/^show_(map|nearby|website)$/.test(name)) {
      const key = name + '|' + JSON.stringify(args || {}).toLowerCase().replace(/\s+/g, ' ');
      if (S.lastShow?.key === key && Date.now() - S.lastShow.at < 120000 && C?.isOpen?.()) {
        return { ok: true, note: 'That is already on screen. Talk about it only if he asks.' };
      }
      S.lastShow = { key, at: Date.now() };
    }
    if (name === 'close_display') S.lastShow = null;
    // "Close everything" never closes his PC apps — only one he named.
    if (name === 'pc_close_window') {
      const heard = String(S.lastUser.text || '').toLowerCase();
      const title = String(args?.title || '').toLowerCase();
      const named = title.split(/[^a-z0-9]+/).filter((w) => w.length >= 3 && !/^(google|microsoft|window|app)$/.test(w)).some((w) => heard.includes(w));
      if (CLEAR_ALL.test(heard) || !named) {
        return { ok: false, note: 'He did not name that app. "Close / close everything" means clearing your own display — call close_display instead.' };
      }
    }
    if (name === 'show_map') return C ? C.showMap(args) : { error: 'Display not loaded.' };
    if (name === 'map_control') return C ? C.mapControl(args) : { error: 'Display not loaded.' };
    if (name === 'show_nearby') return C ? C.showNearby(args) : { error: 'Display not loaded.' };
    if (name === 'show_images') return C ? C.showImages(args) : { error: 'Display not loaded.' };
    if (name === 'show_website') return C ? C.showWebsite(args) : { error: 'Display not loaded.' };
    if (name === 'show_document') return C ? C.showDocument(args) : { error: 'Display not loaded.' };
    if (name === 'close_display') { C?.hide?.(); try { window.ClavisTaskSurface?.hide?.(); } catch (_) {} return { ok: true }; }
    if (name === 'find_leads') return findLeads(String(args.request || '').trim());
    if (name === 'app_command') return appCommand(String(args.request || '').trim());
    if (name === 'go_to_sleep') return goToSleep(args || {});
    if (name === 'open_app_or_website') {
      const target = String(args.target || '').trim();
      if (!target) return { error: 'Nothing to open.' };
      if (!window.ClavisPC?.open) return { error: 'PC control is not loaded.' };
      const r = await window.ClavisPC.open(target);
      if (r && r.ok === false) return { ok: false, error: r.error || `Could not open ${target}.` };
      return { ok: true, opened: target, via: r?.native ? 'PC bridge' : 'browser tab' };
    }
    if (name === 'read_website') return readWebsite(args);
    if (name === 'look_at_screen') return lookAtScreen(args);
    if (window.JarvisSkills?.has?.(name)) return window.JarvisSkills.invoke(name, args || {}, { signal });
    return { error: `Unknown tool ${name}` };
  }

  async function onToolCall(tc) {
    const id = tc?.tool_call_id, name = String(tc?.tool_name || '');
    if (!id || !name) return;
    setState('executing');
    S.lastActivity = Date.now();
    keepAwake();
    mark('tool_started');
    setModelBusy(true);
    const session = S.ws;
    const controller = new AbortController();
    S.toolRequests.set(id, controller);
    let out, failed = false;
    try { out = await runTool(name, tc.parameters || {}, controller.signal); }
    catch (e) { out = { error: e?.message || String(e) }; }
    finally { S.toolRequests.delete(id); }
    failed = !!(out && typeof out === 'object' && (out.error || out.success === false || out.ok === false));
    mark('tool_finished');
    if (S.ws !== session || S.phase !== 'live') return;
    send({ type: 'client_tool_result', tool_call_id: id, result: toResult(out), is_error: failed });
    setModelBusy(true);   // re-arm: the reply to this result is on its way
    if (!S.speaking) setState('thinking');
  }

  // Reply being made / spoken -> ClavisWake stays busy ('live' holder).
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
  // Any real activity keeps the session (and ClavisWake) awake for its idle window.
  function keepAwake() {
    const W = window.ClavisWake;
    if (!W) return;
    try { W.touch(Math.max(Number(W.sessionMs?.()) || 0, 120000), 'live'); } catch (_) {}
  }

  // First wake shouldn't wait on downloading the audio worklets.
  try {
    const warm = () => ['clavis-mic-capture-worklet.js?v=2', 'clavis-pcm-player-worklet.js?v=3'].forEach((u) => fetch(u).catch(() => {}));
    (window.requestIdleCallback || ((f) => setTimeout(f, 3000)))(warm);
  } catch (_) {}

  /* ── connection ────────────────────────────────────────────── */
  function send(o) {
    const ws = S.ws;
    if (!ws || ws.readyState !== WebSocket.OPEN) return false;
    try { ws.send(JSON.stringify(o)); return true; } catch (_) { return false; }
  }

  let connectGeneration = 0;
  window.addEventListener('rudra:auth-state', () => {
    connectGeneration++;
    if (S.phase !== 'off') stop();
    S.history = [];
  });

  class SessionError extends Error {
    constructor(message, status) { super(message); this.status = status; }
  }
  async function fetchSignedUrl() {
    const token = window.SupabaseAuth?.getAccessToken?.();
    if (!token) throw new SessionError('Sign in before using voice.', 401);
    let response;
    try {
      response = await fetch(backend() + '/api/v1/elevenlabs/assistant/session', {
        method: 'POST', cache: 'no-store', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
        body: JSON.stringify({ persona: buildPersona(), tools: toolSpecs(), voice_id: voiceId(), keywords: ASR_KEYWORDS, groq_model: groqModel() }),
        signal: AbortSignal.timeout(45000),
      });
    } catch (_) {
      throw new SessionError('The Rudra24 AI backend could not be reached. Start the app backend and tap the mic again.', 0);
    }
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.signed_url) {
      const d = data.detail;
      const message = typeof d === 'string' ? d : (d?.message || 'Voice session could not start.');
      throw new SessionError(message, response.status);
    }
    S.llmBody = data.custom_llm_extra_body && typeof data.custom_llm_extra_body === 'object' ? data.custom_llm_extra_body : null;
    return data.signed_url;
  }

  async function connect() {
    S.ready = false;
    S.phase = 'connecting';
    setState(S.retries ? 'reconnecting' : 'connecting');
    const attempt = ++connectGeneration;
    let url;
    try { url = await fetchSignedUrl(); }
    catch (error) {
      if (attempt !== connectGeneration || S.phase === 'off') return;
      if (error.status === 409) {
        const provider = /groq/i.test(error.message) ? 'groq' : 'elevenlabs';
        try { window.ClavisSetup?.open?.({ reason: 'voice', provider }); } catch (_) {}
        return fatal(error.message, { backoff: false });   // key saved -> next tap must work at once
      }
      return fatal(error.message);
    }
    if (attempt !== connectGeneration || S.phase === 'off') return;
    const ws = new WebSocket(url);
    S.ws = ws;
    ws.onopen = () => {
      if (ws !== S.ws) return;
      send(S.llmBody ? { type: 'conversation_initiation_client_data', custom_llm_extra_body: S.llmBody } : { type: 'conversation_initiation_client_data' });
      clearTimeout(S.readyTimer);
      S.readyTimer = setTimeout(() => { if (ws === S.ws && !S.ready) { try { ws.close(4000, 'setup timeout'); } catch (_) {} } }, 12000);
    };
    ws.onmessage = (ev) => {
      if (ws !== S.ws) return;
      let msg;
      try { msg = JSON.parse(ev.data); } catch (_) { return; }
      handleMessage(msg);
    };
    ws.onerror = () => {};
    ws.onclose = (ev) => onClose(ws, ev);
  }

  function onClose(ws, ev) {
    if (ws !== S.ws) return;
    clearTimeout(S.readyTimer);
    S.ws = null;
    S.ready = false;
    S.toolRequests.forEach((c) => c.abort());
    S.toolRequests.clear();
    if (S.phase === 'off') return;
    const reason = String(ev.reason || '');
    if (reason) console.info('[ClavisLive] closed', ev.code, reason);
    if (/quota|limit|credits|exceed/i.test(reason)) return fatal('ElevenLabs quota or concurrency limit reached. Check your ElevenLabs plan.');
    // Max duration, network blip, server restart: reconnect in place with a
    // fresh signed URL; the last turns are handed back as context.
    if (S.retries++ < 4) { flushPlayback(); return later(connect, Math.min(3000, 300 * S.retries)); }
    fatal('The voice connection keeps dropping. Check the internet connection.');
  }
  function later(fn, ms) { setTimeout(() => { if (S.phase !== 'off') fn(); }, ms); }

  function handleMessage(msg) {
    switch (msg.type) {
      case 'conversation_initiation_metadata': return onReady(msg.conversation_initiation_metadata_event || {});
      case 'ping': {
        const e = msg.ping_event || {};
        return send({ type: 'pong', event_id: e.event_id });
      }
      case 'audio': {
        const e = msg.audio_event || {};
        if (Number(e.event_id) <= S.cutId) return;   // tail of an interrupted reply
        if (e.audio_base_64) playChunk(e.audio_base_64);
        return;
      }
      case 'interruption': {
        const e = msg.interruption_event || {};
        S.cutId = Math.max(S.cutId, Number(e.event_id) || 0);
        mark('response_finished');
        flushPlayback();
        setModelBusy(false);
        if (S.phase === 'live') setState('listening');
        return;
      }
      case 'tentative_user_transcript': {
        const e = msg.tentative_user_transcription_event || msg.tentative_user_transcript_event || {};
        return onUserPartial(String(e.user_transcript || ''));
      }
      case 'user_transcript': {
        const e = msg.user_transcription_event || {};
        return onUserFinal(String(e.user_transcript || ''));
      }
      case 'agent_response': {
        const e = msg.agent_response_event || {};
        return onAgentText(String(e.agent_response || ''));
      }
      case 'agent_response_correction': {
        const e = msg.agent_response_correction_event || {};
        const t = String(e.corrected_agent_response || '');
        if (t && S.history.length && S.history[S.history.length - 1].role === 'Rudra') S.history[S.history.length - 1].text = t.slice(0, 400);
        return;
      }
      case 'client_tool_call': return onToolCall(msg.client_tool_call || {});
      case 'client_error': console.warn('[ClavisLive] client error', msg); return;
      default: return;
    }
  }

  function onReady(meta) {
    clearTimeout(S.readyTimer);
    const renewed = S.retries > 0;
    S.ready = true;
    S.phase = 'live';
    S.conversationId = String(meta.conversation_id || '');
    S.retries = 0;
    S.lastActivity = Date.now();
    setState('listening');
    send({ type: 'contextual_update', text: contextNote() });
    // Whatever sir said while we were connecting is not lost.
    const pre = S.preroll.splice(0);
    for (let i = 0; i < pre.length; i += SEND_FRAMES) sendAudio(pre.slice(i, i + SEND_FRAMES));
    if (S.initialText) {
      send({ type: 'user_message', text: S.initialText });
      S.initialText = '';
    } else if (!renewed && !S.prerollVoice && (S.trigger === 'clap' || S.trigger === 'wake word')) {
      const how = S.trigger === 'clap' ? 'with a snap or clap' : 'by calling your name';
      notify(`Sir just woke you ${how}. Greet him in ONE very short line (max 7 words) in his language so he knows you are listening — in the spirit of "Haan sir, boliye." Never the same words twice. Then stop and listen.`, true);
    }
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
    const nap = mins < 1 ? 'a few seconds' : mins === 1 ? 'a minute' : `${mins} minutes`;
    if (s.reason === 'busy') return `[SYSTEM EVENT] You had stepped back ${nap} ago because sir seemed busy; he just called you back. Come back warmly in one short line, then listen.`;
    return `[SYSTEM EVENT] You had gone to sleep ${nap} ago because sir asked you to rest, and he just woke you. One short, warm, slightly sleepy line in his language, in the spirit of "Haan sir… meri aankh lag gayi thi, boliye" — your own words. If he already said what he wants, answer that right after.`;
  }

  /* ── turns ─────────────────────────────────────────────────── */
  function setModelBusy(on) {
    clearTimeout(S.busyTimer);
    S.modelBusy = !!on;
    if (on) {
      holdLive(true);
      // A turn the agent chose not to answer must not hold the session busy.
      S.busyTimer = setTimeout(() => { if (!S.speaking && !S.toolRequests.size) { S.modelBusy = false; holdLive(false); if (S.phase === 'live') setState('listening'); } }, 9000);
    } else if (!S.speaking && !S.toolRequests.size) holdLive(false);
  }
  function remember(role, text) {
    S.history.push({ role, text: plain(text).slice(0, 400) });
    if (S.history.length > 8) S.history.splice(0, S.history.length - 8);
  }
  function onUserPartial(text) {
    if (!text.trim()) return;
    S.lastUserVoiceAt = Date.now();
    S.heardUser = true;
    keepAwake();
    mark('first_partial');
    try { const V = window.ClavisVoiceState; V?.notePartial?.(); V?.set?.('USER_SPEAKING', 'live'); } catch (_) {}
    if (!S.speaking) setState('transcribing');
    try { window.ClavisEar?.caption?.live(oneScript(text)); } catch (_) {}
  }
  function onUserFinal(u) {
    u = u.trim();
    if (!u || /^\.*$/.test(u)) return;
    mark('endpoint');
    S.lastUserVoiceAt = Date.now();
    S.lastActivity = Date.now();
    S.heardUser = true;
    keepAwake();
    setModelBusy(true);
    if (!S.speaking) setState('thinking');
    remember('Sir', u);
    S.lastUser = { text: u, at: Date.now() };
    window.__clavisLastUserText = u;
    try { window.ClavisMind?.noteUserTurn?.(u); } catch (_) {}
    try { window.ClavisEar?.caption?.final(oneScript(u), true); } catch (_) {}
    try { window.ClavisIntent?.learn?.(u); } catch (_) {}
    // Deterministic commands the model must not get to decide.
    try {
      const V = window.ClavisVoiceState, cmd = V?.parseStop?.(u);
      if (cmd?.kind === 'silent') { setTimeout(() => { stop({ reason: 'silent' }); V.silence(cmd.ms); window.clavisEnsureListening?.(); }, 0); return; }
    } catch (_) {}
    // Safety nets: "map band karo" closes the display and "so jao" sleeps
    // even if the model only answered in words.
    if (CLOSE_WORDS.test(u) && u.split(/\s+/).length <= 8) {
      setTimeout(() => {
        const open = window.ClavisCanvas?.isOpen?.() || document.querySelector('#clavis-task-surface.is-open');
        if (open) { try { window.ClavisIntent?.route?.(u, { source: 'live' }); } catch (_) {} }
      }, 1800);
    }
    if (SLEEP_WORDS.test(u) && u.split(/\s+/).length <= 8) {
      setTimeout(() => { if (S.phase !== 'off' && !S.closeAfterTurn) goToSleep({ reason: 'asked' }); }, 2500);
    }
  }
  function onAgentText(m) {
    m = m.trim();
    if (!m) return;
    mark('llm_first_token');
    remember('Rudra', m);
    caption(m, 'model');
    try { window.ClavisEar?.noteSpoken?.(m); } catch (_) {}
    try { window.ClavisMind?.noteClavisTurn?.(m); } catch (_) {}
  }

  function goToSleep(args) {
    const reason = String(args.reason || 'asked');
    const mins = Number.isFinite(Number(args.quiet_minutes)) ? Number(args.quiet_minutes) : (reason === 'done' ? 0 : 30);
    if (mins > 0) {
      S.snoozeUntil = Date.now() + mins * 60e3;
      try { window.ClavisProactive?.snooze?.(mins); } catch (_) {}
    }
    if (reason !== 'done') { try { localStorage.setItem(SLEPT_KEY, JSON.stringify({ at: Date.now(), reason })); } catch (_) {} }
    S.closeAfterTurn = true;
    clearTimeout(S.closeTimer);
    const hardStop = Date.now() + 12000;
    const closeWhenQuiet = () => {
      if (S.phase === 'off') return;
      if (S.speaking && Date.now() < hardStop) { S.closeTimer = setTimeout(closeWhenQuiet, 500); return; }
      stop({ reason: 'sleep' });
    };
    S.closeTimer = setTimeout(closeWhenQuiet, 2500);
    return { ok: true, note: 'Going to sleep. Say at most one very short line, or nothing.' };
  }

  /* ── audio out ─────────────────────────────────────────────── */
  async function ensureOutput() {
    if (S.outCtx) { if (S.outCtx.state === 'suspended') await S.outCtx.resume(); return; }
    S.outCtx = new AudioContext({ sampleRate: 24000, latencyHint: 'interactive' });
    await window.ClavisWorklet.add(S.outCtx, 'clavis-pcm-player-worklet.js?v=3');
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
      mark('tts_first_audio');
      S.speaking = true;
      holdLive(true);
      unduck();
      setState('speaking');
      try { window.ClavisVoiceState?.set?.('ASSISTANT_SPEAKING', 'live'); } catch (_) {}
      try { window.ClavisEar?.noteSpeaking?.(''); } catch (_) {}
    }
  }
  function onDrained() {
    clearTimeout(S.drainTimer);
    // Network jitter can empty the queue mid-sentence; only call it done after a real gap.
    S.drainTimer = setTimeout(() => {
      if (Date.now() - S.lastChunkAt < 300) return;
      S.speaking = false;
      mark('response_finished');
      try { window.ClavisEar?.noteSpeakingDone?.(); } catch (_) {}
      setModelBusy(false);
      keepAwake();
      if (S.closeAfterTurn) return stop({ reason: 'sleep' });
      if (S.phase === 'live') setState('listening');
      flushEventsSoon();
    }, 350);
  }
  function flushPlayback() {
    try { S.player?.port.postMessage({ type: 'stop' }); } catch (_) {}
    S.speaking = false;
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
    await window.ClavisWorklet.add(S.micCtx, 'clavis-mic-capture-worklet.js?v=2');
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
  // The mic streams continuously: ElevenLabs' turn-taking and barge-in need
  // the real audio timeline. Echo is removed by the browser's AEC; nothing
  // here second-guesses whether sir "really" spoke.
  function onPcm(f32) {
    if (S.muted) f32 = new Float32Array(f32.length);   // silence keeps the stream's timing
    if (S.phase !== 'live' || !S.ready) {
      S.preroll.push(f32);
      if (S.preroll.length > PREROLL_FRAMES) S.preroll.shift();
      return;
    }
    S.sendBuf.push(f32);
    if (S.sendBuf.length >= SEND_FRAMES) sendAudio(S.sendBuf.splice(0));
  }
  function sendAudio(frames) {
    if (!frames.length) return;
    const total = frames.reduce((n, f) => n + f.length, 0);
    const merged = new Float32Array(total);
    let o = 0;
    frames.forEach((f) => { merged.set(f, o); o += f.length; });
    send({ user_audio_chunk: b64FromBuffer(floatToPcm16(merged)) });
  }

  /* ── events from the app (relay) ───────────────────────────── */
  function notify(text, front) {
    if (!text) return;
    if (front) S.events.unshift(String(text)); else S.events.push(String(text));
    if (S.events.length > 8) S.events.splice(0, S.events.length - 8);
    flushEventsSoon();
  }
  function flushEventsSoon(ms) {
    clearTimeout(S.flushTimer);
    S.flushTimer = setTimeout(flushEvents, ms == null ? 200 : ms);
  }
  function flushEvents() {
    if (S.phase !== 'live' || !S.ready || !S.events.length) return;
    // Never talk over sir or over itself: wait for a natural gap.
    if (S.speaking || S.modelBusy || S.toolRequests.size || Date.now() - S.lastUserVoiceAt < 900 || Date.now() - S.lastChunkAt < 200) return flushEventsSoon(250);
    const text = S.events.splice(0).map((e) => (/^\[SYSTEM EVENT\]/.test(e) ? e : `[SYSTEM EVENT] ${e}`)).join('\n');
    send({ type: 'user_message', text });
  }
  // speakJarvisText() hands us anything the rest of the app wanted to say.
  function relay(text) {
    if (!isActive()) return false;
    if (busy()) return true;
    const clean = plain(text).slice(0, 900);
    if (clean) notify(`The Rudra24 AI app wants sir to hear this (say it naturally and briefly, in his language): "${clean}"`);
    return true;
  }

  /* ── level loop: orb + instant duck on barge-in ────────────── */
  const lvlBuf = new Float32Array(512);
  let smoothIn = 0, smoothOut = 0, lastLoudAt = 0;
  function levelLoop() {
    if (S.phase === 'off') return;
    const inL = S.muted ? 0 : rms(S.micAnalyser, lvlBuf);
    const outL = rms(S.outAnalyser, lvlBuf);
    smoothIn += (inL - smoothIn) * 0.35;
    smoothOut += (outL - smoothOut) * 0.35;
    const now = Date.now();
    if (inL > 0.06 && !S.ready) S.prerollVoice = true;
    // Feels instant: dip Rudra's voice the moment sir talks over it; the
    // server's "interruption" then cuts it for real (or it comes back up).
    if (inL > 0.09) lastLoudAt = now;
    if (S.speaking && inL > 0.09) duck();
    else if (S.ducked && now - lastLoudAt > 700) unduck();
    const lvl = Math.min(1, (S.speaking ? smoothOut : smoothIn) * 6);
    const paintNow = now - S.lastLvlAt > 50 && Math.abs(lvl - S.lastLvl) > 0.02;
    if (paintNow) { S.lastLvlAt = now; S.lastLvl = lvl; }
    if (paintNow && S.hud) S.hud.style.setProperty('--lvl', lvl.toFixed(2));
    const orb = window.StrandsOrb?.instance;
    if (paintNow && orb?.setProps && (S.state === 'speaking' || S.state === 'listening' || S.state === 'transcribing')) {
      const talk = S.state === 'speaking';
      orb.setProps({ speed: (talk ? 0.19 : 0.11) + lvl * 0.07, amplitude: (talk ? 1.35 : 1.05) + lvl * 0.9, intensity: (talk ? 0.36 : 0.26) + lvl * 0.28 });
    }
    S.rafId = requestAnimationFrame(levelLoop);
  }
  function idleCheck() {
    if (S.phase !== 'live') return;
    const W = window.ClavisWake;
    if (W && !W.isAwake() && !S.speaking && !busy() && !S.toolRequests.size) return stop({ reason: 'idle' });
    if (!W && !S.speaking && !busy() && Date.now() - S.lastActivity > 180000) stop({ reason: 'idle' });
  }
  // ClavisWake put Rudra to sleep (idle window over / "so jao") -> session ends.
  window.addEventListener('clavis:wake-change', (e) => {
    if (!e.detail?.awake && isActive() && !S.speaking && !S.toolRequests.size) stop({ reason: 'sleep' });
  });

  /* ── HUD (voice bar) ───────────────────────────────────────── */
  const ICONS = {
    mic: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/></svg>',
    end: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>',
  };
  const LABELS = { connecting: 'Connecting', reconnecting: 'Reconnecting', listening: 'Listening', transcribing: 'Listening', speaking: 'Speaking',
    thinking: 'Thinking', executing: 'Working', muted: 'Muted', off: '' };
  function ensureHud() {
    if (S.hud) return S.hud;
    const el = document.createElement('div');
    el.id = 'clavis-live-hud';
    el.className = 'clh';
    el.setAttribute('role', 'region');
    el.setAttribute('aria-label', 'Rudra voice');
    el.innerHTML =
      '<div class="clh-orb" aria-hidden="true"><span></span></div>' +
      '<span class="clh-sr" aria-live="polite"></span>' +
      `<button type="button" class="clh-btn" data-act="mute" aria-pressed="false" aria-label="Mute microphone" title="Mute">${ICONS.mic}</button>` +
      `<button type="button" class="clh-btn clh-end" data-act="end" aria-label="End voice" title="End voice">${ICONS.end}</button>`;
    el.addEventListener('click', (e) => {
      const act = e.target.closest('[data-act]')?.dataset.act;
      if (act === 'end') stop({ reason: 'user' });
      else if (act === 'mute') setMuted(!S.muted);
    });
    const actions = document.querySelector('#view-jarvis .jarvis-hero-actions');
    if (actions) { el.classList.add('clh-inline'); actions.appendChild(el); } else document.body.appendChild(el);
    S.hud = el;
    return el;
  }
  function showHud() { const el = ensureHud(); requestAnimationFrame(() => el.classList.add('is-in')); }
  function hideHud() { if (S.hud) S.hud.classList.remove('is-in'); }
  function hudFlag(name, on) {
    const b = S.hud?.querySelector(`[data-act="${name}"]`);
    if (b) { b.classList.toggle('is-on', !!on); b.setAttribute('aria-pressed', String(!!on)); }
  }
  // Screen shows ONE script (Roman Hinglish) and his name spelled "Rudra".
  function oneScript(text) {
    let t = String(text || '');
    try { t = window.ClavisVoice?.toHinglish?.(t) ?? t; } catch (_) {}
    return t.replace(/\bRudraa\b/g, 'Rudra');
  }
  let captionTimer = 0;
  function caption(text, who) {
    const c = S.hud?.querySelector('.clh-sr');
    const t = oneScript(String(text || '').trim()).trim();
    if (c) { c.textContent = t; c.dataset.who = who || ''; }
    const speech = document.getElementById('clavis-ai-speech-caption');
    if (speech) {
      speech.textContent = who === 'model' ? t : '';
      speech.classList.toggle('is-visible', Boolean(t && who === 'model'));
    }
    clearTimeout(captionTimer);
    captionTimer = setTimeout(() => {
      if (c?.textContent === t) c.textContent = '';
      if (speech?.textContent === t) speech.classList.remove('is-visible');
    }, 8000);
  }

  function setState(state) {
    S.state = state;
    if (S.hud) {
      S.hud.dataset.state = state;
      const l = S.hud.querySelector('.clh-state');
      if (l) l.textContent = S.muted && state === 'listening' ? LABELS.muted : (LABELS[state] || '');
    }
    const map = { listening: 'listening', transcribing: 'transcribing', speaking: 'speaking', thinking: 'thinking', executing: 'executing', connecting: 'connecting', reconnecting: 'connecting' };
    try { if (map[state] && typeof window.setJarvisStatus === 'function') window.setJarvisStatus(map[state], `Rudra · ${LABELS[state] || ''}`); } catch (_) {}
  }
  function setMuted(on) {
    S.muted = !!on;
    hudFlag('mute', S.muted);
    setState(S.state);
  }

  /* ── lifecycle ─────────────────────────────────────────────── */
  function pauseLegacy() {
    // One listener at a time: this session owns the mic.
    try { window.ClavisVoiceState?.mic?.claim?.('live', null); } catch (_) {}
    try { window.clavisStopCommandEar?.(); } catch (_) {}
    try { window.ClavisElevenSTT?.stop?.('live voice'); } catch (_) {}
    try { window.stopWakeListener?.(true); } catch (_) {}
    try { window.LocalSpeechEngine?.stopInput?.(); window.LocalSpeechEngine?.stop?.(); } catch (_) {}
    try { window.stopJarvisSpeech?.(); } catch (_) {}
    try { window.speechSynthesis?.cancel?.(); } catch (_) {}
    try { window.ClavisBargeIn?.disarm?.(); } catch (_) {}
    try { window.stopClavisSoundTriggers?.(); } catch (_) {}
  }
  function resumeLegacy() {
    try { window.ClavisVoiceState?.mic?.release?.('live'); } catch (_) {}
    if (window.ClavisVoiceState && !window.ClavisVoiceState.canProcessMic()) return;
    // Only the local wake word / clap listeners come back — no cloud audio.
    try { if (typeof window.scheduleHandsFreeRelisten === 'function') window.scheduleHandsFreeRelisten(); } catch (_) {}
    try { if (localStorage.getItem('clavis_sound_trigger_enabled') !== 'false') window.startClavisSoundTriggers?.(); } catch (_) {}
  }

  async function start(opts = {}) {
    if (S.phase !== 'off') {
      // Already live: a wake-word command said now still counts.
      const extra = String(opts.initialText || '').trim();
      if (extra) { if (S.ready) send({ type: 'user_message', text: extra }); else S.initialText = extra; }
      return true;
    }
    if (window.ClavisVoiceState && !window.ClavisVoiceState.canProcessMic()) return false;
    if (!isAvailable()) return false;
    const trig = opts.trigger || 'button';
    if (trig === 'boot' || trig === 'proactive') return false;   // never opens a paid session on its own
    S.phase = 'connecting';
    S.trigger = trig;
    S.initialText = String(opts.initialText || '').trim();
    S.retries = 0; S.cutId = 0;
    S.events = []; S.preroll = []; S.sendBuf = []; S.history = [];
    S.closeAfterTurn = false; S.prerollVoice = false; S.modelBusy = false; S.holding = false;
    if (S.initialText && !S.initialText.startsWith('[')) S.lastUser = { text: S.initialText, at: Date.now() };
    S.heardUser = !!S.initialText;
    const note = wakeNote();
    if (note) S.initialText = note + (S.initialText ? `\nSir (said while waking you): ${S.initialText}` : '');
    try { window.ClavisWake?.wake?.(trig === 'clap' ? 'clap' : trig === 'wake word' ? 'word' : 'tap', { force: true }); } catch (_) {}
    keepAwake();
    pauseLegacy();
    showHud();
    setState('connecting');
    // The signed URL + socket handshake runs WHILE the speaker and mic warm
    // up. Words said meanwhile are prerolled and sent first.
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
          message: denied ? 'Allow the microphone for this app, then tap the mic again.' : String(e?.message || e),
        });
      } catch (_) {}
      resumeLegacy();
      return false;
    }
    if (S.phase === 'off') return false;
    if (S.outCtx.state !== 'running') {
      S.audioBlocked = true;
      caption('Tap anywhere to hear Rudra', 'model');
      const unlock = () => { S.outCtx?.resume().then(() => { S.audioBlocked = false; caption('', ''); }).catch(() => {}); };
      ['pointerdown', 'keydown'].forEach((t) => window.addEventListener(t, unlock, { once: true, passive: true }));
    }
    if (trig === 'button') { try { window.playWakeChime?.(); } catch (_) {} }
    S.lastActivity = Date.now();
    S.rafId = requestAnimationFrame(levelLoop);
    S.idleTimer = setInterval(idleCheck, 5000);
    return true;
  }

  function cleanup() {
    S.phase = 'off';
    S.ready = false;
    S.toolRequests.forEach((c) => c.abort());
    S.toolRequests.clear();
    clearTimeout(S.readyTimer); clearTimeout(S.flushTimer); clearTimeout(S.drainTimer); clearTimeout(S.closeTimer); clearTimeout(S.busyTimer);
    clearInterval(S.idleTimer);
    cancelAnimationFrame(S.rafId);
    const ws = S.ws; S.ws = null;
    if (ws) { try { ws.close(1000, 'bye'); } catch (_) {} }
    flushPlayback();
    try { S.micNode?.disconnect(); S.micSrc?.disconnect(); } catch (_) {}
    try { S.mic?.getTracks().forEach((t) => t.stop()); } catch (_) {}
    try { S.micCtx?.close(); } catch (_) {}
    try { S.outCtx?.close(); } catch (_) {}
    S.mic = S.micCtx = S.micSrc = S.micNode = S.micAnalyser = null;
    S.outCtx = S.player = S.outGain = S.outAnalyser = null;
    S.speaking = false; S.muted = false; S.ducked = false; S.modelBusy = false;
    hudFlag('mute', false);
    hideHud();
    try { window.ClavisEar?.caption?.clear?.(); } catch (_) {}
    try { window.StrandsOrb?.instance?.setState?.('idle'); } catch (_) {}
  }

  function stop(arg) {
    const reason = (arg && typeof arg === 'object' ? arg.reason : arg) || 'user';
    if (S.phase === 'off') return;
    holdLive(false);
    cleanup();
    S.state = 'off';
    if (/^(sleep|user|idle)$/.test(reason)) { try { window.ClavisWake?.sleep?.(reason === 'sleep' ? 'live' : 'live-' + reason); } catch (_) {} }
    try { window.setJarvisStatus?.('online', reason === 'idle' || reason === 'sleep' ? 'Resting — say "Rudra", snap or tap the mic' : 'Rudra online'); } catch (_) {}
    if (reason !== 'user') resumeLegacy();
  }

  function fatal(message, { backoff = true } = {}) {
    console.warn('[ClavisLive]', message);
    if (backoff) S.retryAfter = Date.now() + 15000;
    stop({ reason: 'error' });
    try { window.showToast?.({ type: 'warning', title: 'Voice paused', message }); } catch (_) {}
  }

  /* ── app events worth saying out loud ──────────────────────── */
  document.addEventListener('nexus:scrapedone', (e) => {
    if (!isActive() || busy()) return;
    const d = e.detail || {};
    const n = Array.isArray(d.leads) ? d.leads.length : (d.total || 0);
    notify(d.ok === false ? 'The lead search ended without results.' : `A lead search just finished with ${n} leads saved. Offer once to hand them to the calling agent.`);
  });

  // A proactive nudge (ClavisProactive / ClavisVision): only inside an open,
  // awake session — never opens a new one.
  function proactive({ mood = 'working', line = '', context = '' } = {}) {
    if (window.ClavisWake && !window.ClavisWake.allowBackground()) return false;
    if (!isActive()) return false;
    const now = Date.now();
    if (now < S.snoozeUntil || now - S.lastProactiveAt < 15 * 60e3) return false;
    if (now - S.lastUserVoiceAt < 2 * 60e3) return false;
    S.lastProactiveAt = now;
    notify(`Proactive moment (sir did not ask anything; mood looks "${mood}"). ${context ? 'What you can see of his work: ' + plain(context).slice(0, 700) + '. ' : ''}${line ? 'A suggestion you had: "' + plain(line).slice(0, 240) + '". ' : ''}If you have something specific and useful, say it in one short natural line. If not, say nothing.`);
    return true;
  }

  function isActive() { return S.phase !== 'off'; }
  if (!window.isClavisSpeaking) window.isClavisSpeaking = () => S.speaking || !!window.isJarvisSpeaking;
  if (!window.isClavisListening) window.isClavisListening = () => S.phase !== 'off';
  function hush() { flushPlayback(); }
  function toggle(opts) { return isActive() ? (stop({ reason: 'user' }), false) : start(opts); }

  window.addEventListener('pagehide', () => { if (isActive()) cleanup(); });

  window.ClavisLive = {
    start, stop, toggle, isActive, isAvailable, relay, notify, hush, proactive,
    setMuted, sleep: goToSleep,
    promptKey: () => false,
    toggleScreen: () => {},
    setPatience: () => 0,
    status: () => ({ phase: S.phase, state: S.state, provider: 'elevenlabs', brain: 'groq/' + groqModel(), conversation: S.conversationId, ready: S.ready }),
    _tools: toolSpecs,
    _persona: buildPersona,
    // Runnable check for the pure bits — ClavisLive._selfTest() in DevTools / node.
    _selfTest() {
      const tools = toolSpecs();
      const ok = [
        typeFor('array of city names').type === 'array',
        typeFor('number of leads per combo (default 5)').type === 'number',
        typeFor('short label').type === 'string',
        new Int16Array(floatToPcm16(new Float32Array([1, -1, 0])))[1] === -32768,
        new Uint8Array(bufferFromB64(b64FromBuffer(new Uint8Array([1, 2, 250]).buffer)))[2] === 250,
        ['find_leads', 'show_map', 'close_display', 'app_command'].every((n) => tools.some((t) => t.name === n)),
        tools.every((t) => !t.parameters.properties || Object.values(t.parameters.properties).every((p) => p.type === p.type.toLowerCase() && p.description)),
        !/google search|consult_brain/i.test(buildPersona()),
        oneScript('Main Rudraa hoon') === 'Main Rudra hoon',
      ];
      const passed = ok.filter(Boolean).length;
      console[passed === ok.length ? 'log' : 'error'](`ClavisLive self-test: ${passed}/${ok.length}`);
      return passed === ok.length;
    },
  };

  if (window.ClavisVoiceState?.registerAudioCleanup) window.ClavisVoiceState.registerAudioCleanup(() => cleanup());
})();
