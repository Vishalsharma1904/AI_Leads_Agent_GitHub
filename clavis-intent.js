/* ============================================================
 * clavis-intent.js · the few words sir actually says
 * ------------------------------------------------------------
 * A tiny, instant intent layer that runs BEFORE the command router
 * and the AI. It exists because the most common things sir says are
 * two or three words long and were going wrong:
 *
 *   "map band karo"      matched the STOP rule — Clavis went quiet
 *                        and the map stayed open.
 *   "close map"          reached the AI, which asked for "more details".
 *   "close close close   must clear CLAVIS's screen (the map, pictures,
 *    everything"         website and the floating window) — never his
 *                        PC apps.
 *   "band karo" / "hatao"  alone: close whatever is on top right now.
 *
 * Also here:
 *   · map control while a map is open ("zoom in", "satellite", "bada karo")
 *   · voice switching ("ladke ki awaaz", "female voice")
 *   · Voice ID ("meri awaaz register karo")
 *   · display skills for the text brain (show_map, show_images,
 *     show_website, close_display, app_command) so typed turns can DO
 *     what the live voice can
 *   · habits: which subjects and words sir uses, learned over time and
 *     handed to the AI as one short line (personalisation)
 *   · screenContext(): what is on screen, so "band karo" / "aur" have
 *     something to refer to.
 *
 * API: window.ClavisIntent.route(text, {source}) -> {handled, spoken, silent}
 *      .screenContext(), .learn(text), .habitsLine(), ._selfTest()
 * ============================================================ */
(function () {
  'use strict';
  if (window.ClavisIntent) return;

  const norm = (s) => String(s || '').toLowerCase().replace(/[.!?,।]+/g, ' ').replace(/\s+/g, ' ').trim();

  // Recognizers often hear "close" as "clothes" / "cloze".
  const CLOSE = /\b(close|closed|clothes|cloze|klose|kloj|band|bandh|bund|hatao|hata\s*do|hata\s*de|hatado|hata|nikalo|gayab|hide|remove|dismiss|clear|exit|quit|khatam|chhupao|chupao|saaf|clean)\b|बंद|हटा|छुपा|गायब|साफ/i;
  const MAP = /\b(map|maps|naksha|nakshe|naksa|google\s*map|location)\b|मैप|नक्शा/i;
  const FLOAT = /\b(floating|float|peek|task\s*window|task\s*panel|panel|popup|pop\s*up|window|windows|chat\s*window)\b|विंडो|पॉपअप/i;
  const MEDIA = /\b(photo|photos|foto|fotos|image|images|picture|pictures|pic|pics|tasveer|tasveere|tasveeren|website|site|display|result|results|document|doc)\b|फोटो|तस्वीर|वेबसाइट/i;
  const ALL = /\b(sab|sabhi|saara|saare|sare|sara|everything|all|screen|poora|pura|puri|poori)\b|सब|सारे|पूरा/i;
  const APPS = /\b(chrome|edge|firefox|brave|opera|notepad|excel|word|powerpoint|ppt|explorer|file\s*manager|files|vs\s*code|vscode|code|spotify|whatsapp\s*desktop|outlook|teams|zoom|telegram|discord|slack|claude\s*app|chatgpt\s*app|photoshop|paint|calculator|cmd|terminal|powershell)\b/i;
  const FILLER = new Set(('close closed clothes cloze klose kloj band bandh bund hatao hata do de hatado nikalo gayab hide remove dismiss clear exit quit khatam chhupao chupao ' +
    'karo kar kardo kariye kijiye it this that isko ise isse ye yeh wo woh please plz na jaldi now abhi the ko bhi sir clavis ji zara').split(' '));

  const pick = (pool, scope) => {
    try { return window.ClavisEmotionalEngine?.pickDifferent?.(pool, scope) || pool[0]; } catch (_) { return pool[0]; }
  };

  /* ── what is on screen ─────────────────────────────────────── */
  function canvasOpen() { try { return !!window.ClavisCanvas?.isOpen?.(); } catch (_) { return false; } }
  function canvasKind() { try { return window.ClavisCanvas?.kind?.() || ''; } catch (_) { return ''; } }
  function floatOpen() {
    const el = document.getElementById('clavis-task-surface');
    return !!(el && (el.classList.contains('is-open') || el.classList.contains('is-visible')) && el.offsetParent !== null);
  }
  function overlayOpen() { return !!document.querySelector('.mac-settings-overlay.active, #settings-overlay.active, .smodal.active, .modal.active, .clx-lightbox.is-open, .clavis-lightbox.is-open'); }
  function screenContext() {
    const bits = [];
    if (canvasOpen()) {
      const k = canvasKind();
      let place = '';
      try { place = window.ClavisCanvas?.place?.()?.name || window.ClavisCanvas?.place?.() || ''; } catch (_) {}
      bits.push(`the Clavis display is open showing ${k || 'something'}${place && typeof place === 'string' ? ` (${place})` : ''}`);
    }
    if (floatOpen()) bits.push('the floating task window is open');
    try { const v = window.currentView || (location.hash || '').replace('#', ''); if (v) bits.push(`current page: ${v}`); } catch (_) {}
    return bits.join('; ') || 'nothing extra is open';
  }

  /* ── closing things ────────────────────────────────────────── */
  function hideCanvas() { try { window.ClavisCanvas?.hide?.(); return true; } catch (_) { return false; } }
  function hideFloat() { try { window.ClavisTaskSurface?.hide?.(); return true; } catch (_) { return false; } }
  function hideOverlays() {
    let n = 0;
    document.querySelectorAll('.mac-settings-overlay.active, #settings-overlay.active').forEach((el) => { el.classList.remove('active'); n++; });
    document.querySelectorAll('.clx-lightbox.is-open .clx-close, .clavis-lightbox.is-open [data-close], .smodal.active .smodal-close, .modal.active .modal-close').forEach((b) => { try { b.click(); n++; } catch (_) {} });
    return n;
  }
  function stopTalking() {
    try { window.interruptClavisSpeech?.(); } catch (_) {}
    try { window.ClavisVoice?.stop?.(); } catch (_) {}
  }
  function clearAll() {
    const had = canvasOpen() || floatOpen() || overlayOpen();
    stopTalking();
    hideCanvas();
    hideFloat();
    hideOverlays();
    try { window.ClavisEar?.caption?.clear?.(600); } catch (_) {}
    return had;
  }

  /* ── voice switching / Voice ID ────────────────────────────── */
  function voiceIntent(t) {
    if (/\b(meri|my)\s+(awaaz|awaz|aawaz|voice)\b.*\b(register|yaad|pehchan|pahchan|save|record|seekh|sikh|learn|set\s*up|setup|enrol+)\b|\bvoice\s*id\b.*\b(set\s*up|setup|register|on|start|chalu)\b|\bregister my voice\b|\blearn my voice\b/.test(t)) {
      if (!window.ClavisEar?.voiceId) return { handled: true, spoken: 'Voice ID abhi load nahi hua, sir.' };
      setTimeout(() => window.ClavisEar.voiceId.openEnroll(), 250);
      return { handled: true, spoken: 'Screen par ek line hai — use normal awaaz me padhiye, sir.' };
    }
    if (/\bvoice\s*id\b.*\b(band|off|disable|hatao)\b/.test(t)) {
      window.ClavisEar?.voiceId?.setEnabled?.(false);
      return { handled: true, spoken: 'Voice ID band kar diya. Ab main har us awaaz ko sunungi jo "Clavis" bolegi.' };
    }
    const SWITCH = /\b(bolo|boliye|karo|kar\s*do|chahiye|use|lagao|laga\s*do|switch|change|badlo|badal\s*do|me\s*baat|speak|talk)\b/;
    const toMale = /\b(male|ladke|ladka|aadmi|mard|jarvis)\b.*\b(voice|awaaz|awaz)\b|\b(voice|awaaz|awaz)\b.*\b(male|ladke|ladka|aadmi|mard)\b/.test(t) && SWITCH.test(t);
    const toFemale = /\b(female|ladki|aurat|lady|girl)\b.*\b(voice|awaaz|awaz)\b|\b(voice|awaaz|awaz)\b.*\b(female|ladki|aurat|lady|girl)\b/.test(t) && SWITCH.test(t);
    if ((toMale || toFemale) && window.ClavisVoice?.setVoice) {
      const v = toMale ? (window.ClavisVoice.fallbackVoice?.() || 'Charon') : 'Kore';
      window.ClavisVoice.setVoice(v);
      return { handled: true, spoken: toMale ? 'Theek hai, ab main male voice me bolunga, sir.' : 'Theek hai sir, ab main female voice me bolungi.' };
    }
    return null;
  }

  /* ── sleep / wake ("thodi der chup ho jao") ────────────────── */
  const SLEEP = /\b(so\s*jao|sojao|so\s*ja|go to sleep|sleep mode|chup\s*(ho\s*ja\w*|hoja\w*|raho|rho|kar\s*ja\w*)|thodi\s*der\s*(chup|shant|aaram|so)|aaram\s*kar\w*|rest\s*kar\w*|shant\s*(ho\s*ja\w*|raho)|abhi\s*mat\s*bolo|shut\s*up|be quiet|take a (nap|rest))\b|सो जाओ|चुप हो|चुप रहो|आराम करो/;
  const SLEPT = 'clavis_slept_at';
  const SLEEP_LINES = [
    'Theek hai sir, main thoda aaram kar leti hoon. Naam lijiyega to haazir.',
    'Ji sir, chup ho gayi. Chutki bajaiye ya "Clavis" boliye, main aa jaungi.',
    'Okay sir, ek chhoti si jhapki. Zarurat ho to bas awaaz dijiye.',
    'Samajh gayi — ab main chup. Taali bajaiye, turant jaag jaungi.',
    'Theek hai. Main yahin hoon, bas shaant. Naam lenge to sun lungi.',
  ];
  const WAKE_LINES = [
    'Hmm… aah… good morning sir! Meri aankh lag gayi thi — boliye, kya karna hai?',
    'Uff, maaf kijiye sir, thodi jhapki aa gayi thi. Haan, boliye.',
    'Aah… main jaag gayi, sir. Kahaan the hum?',
    'Mmm… haan sir, haazir hoon. Bas zara si aankh lag gayi thi — boliye.',
    'Good morning sir… ya shayad good evening? Aankh lag gayi thi. Bataiye, kya karun?',
    'Hmm? Haan sir! Main yahin hoon — bataiye.',
  ];
  function sleep(reason = 'asked') {
    try { localStorage.setItem(SLEPT, JSON.stringify({ at: Date.now(), reason })); } catch (_) {}
    try { window.ClavisProactive?.snooze?.(30); } catch (_) {}
    try { window.ClavisEar?.caption?.clear?.(400); } catch (_) {}
    // Live says its own sleepy line and closes itself after it.
    if (window.ClavisLive?.isActive?.()) { window.ClavisLive.sleep?.({ reason }); return { handled: true, spoken: '', text: 'Going to sleep.' }; }
    try { window.clavisGoToSleep?.(); } catch (_) {}
    return { handled: true, spoken: pick(SLEEP_LINES, 'sleep'), style: 'sleepy' };
  }
  // One-shot: the yawning line after a nap he asked for (legacy voice path;
  // Clavis Live reads the same marker and yawns in its own words).
  function wakeLine() {
    let st = null;
    try { st = JSON.parse(localStorage.getItem(SLEPT) || 'null'); localStorage.removeItem(SLEPT); } catch (_) {}
    if (!st || !st.at || Date.now() - st.at > 12 * 3600e3) return '';
    if (st.reason === 'busy') return pick(['Ji sir, main wapas aa gayi. Boliye.', 'Haan sir, main yahin hoon — boliye.'], 'wake-busy');
    return pick(WAKE_LINES, 'wake');
  }

  /* ── "clap wala band karo", "caption on", "tips off" ──────── */
  const TURN_ON = /\b(on|chalu|chaalu|start|enable|shuru|laga\s*do|lagao|activate|wapas\s*lao|dikhao)\b|चालू|शुरू/;
  const TURN_OFF = /\b(off|band|bandh|bund|stop|disable|hatao|hata\s*do|nahi\s*chahiye|mat\s*dikhao|rok\s*do|roko|mute)\b|बंद/;
  const ls = (k) => { try { return localStorage.getItem(k); } catch (_) { return null; } };
  const isDark = () => { try { return (window.ThemeController?.get?.() || document.documentElement.getAttribute('data-theme')) === 'dark'; } catch (_) { return false; } };
  const SWITCHES = [
    { name: 'Hands-free listening', re: /\b(hands?\s*free|handsfree|always\s*listening|wake\s*word)\b/,
      get: () => ls('jarvis_hands_free') !== 'false', set: (on) => window.toggleJarvisHandsFree?.() },
    { name: 'Clap / snap wake', re: /\b(clap|claps|snap|snaps|taali|tali|taaliyan|chutki|chutkiyan)\b/,
      get: () => !!window.ClavisAudioTrigger?.running, set: () => window.toggleClavisSoundTriggers?.() },
    { name: 'Live caption', re: /\b(caption|captions|subtitle|subtitles|live\s*text|likha\s*hua)\b/,
      get: () => ls('clavis_live_caption') !== 'false', set: (on) => window.ClavisEar?.caption?.setEnabled?.(on) },
    { name: 'Desk pet', re: /\b(desk\s*pet|pet|billi|kitty|cat|puppy)\b/,
      get: () => ls('skylark-pet-enabled') !== 'false', set: (on) => window.NexusPet?.setEnabled?.(on) },
    { name: 'Proactive tips', re: /\b(proactive|tips|tip|sujhav|salah|nudges?)\b/,
      get: () => !!window.ClavisProactive?.status?.().enabled, set: (on) => window.ClavisProactive?.setEnabled?.(on) },
    { name: 'Screen watching', re: /\b(screen\s*(watch\w*|dekhna|dekhte|monitor\w*|awareness)|vision)\b/,
      get: () => !!window.ClavisVision?.isEnabled?.(), set: (on) => window.ClavisVision?.setEnabled?.(on) },
    { name: 'UI sounds', re: /\b(ui\s*sounds?|click\s*sounds?|sound\s*effects?|button\s*sounds?)\b/,
      get: () => !!window.SoundFX?.isEnabled?.(), set: (on) => window.SoundFX?.toggleSound?.(on) },
    { name: 'Voice replies', re: /\b(voice\s*(repl\w*|output|jawab)|bol\s*ke\s*jawab|awaaz\s*(me|mein)\s*jawab|spoken\s*repl\w*|tts)\b/,
      get: () => ls('jarvis_speech_enabled') !== 'false', set: () => window.toggleJarvisSpeech?.() },
    { name: 'Sidebar', re: /\b(side\s*bar|sidebar)\b/,
      get: () => !document.getElementById('sidebar')?.classList.contains('collapsed'), set: () => window.toggleSidebarCollapse?.() },
    { name: 'Dark mode', re: /\b(dark\s*(mode|theme)|night\s*mode|andhera)\b/,
      get: () => isDark(), set: () => window.toggleDayNightTheme?.() },
    { name: 'Light mode', re: /\b(light\s*(mode|theme)|day\s*mode|ujala)\b/,
      get: () => !isDark(), set: () => window.toggleDayNightTheme?.() },
  ];
  async function toggleIntent(t, words) {
    if (words.length > 8) return null;
    const on = TURN_ON.test(t);
    const off = TURN_OFF.test(t);
    if (on === off) return null;           // neither, or both ("on karo, off nahi") — not a switch
    const sw = SWITCHES.find((x) => x.re.test(t));
    if (!sw) return null;
    let was = null;
    try { was = sw.get(); } catch (_) {}
    if (was === on) return { handled: true, spoken: pick([`${sw.name} pehle se ${on ? 'on' : 'off'} hai, sir.`, `Wo already ${on ? 'on' : 'off'} hai, sir.`], 'switch-same') };
    try {
      const r = sw.set(on);
      // Async switches (clap / snap needs the mic) report the truth, not the wish.
      if (r && typeof r.then === 'function') {
        await r;
        let now = null;
        try { now = sw.get(); } catch (_) {}
        if (now !== on) return { handled: true, spoken: `${sw.name} abhi ${on ? 'on' : 'off'} nahi ho paaya, sir${on ? ' — mic ki permission check kar lijiye' : ''}.` };
      }
    } catch (e) { return { handled: true, spoken: `${sw.name} abhi badal nahi paaya, sir.` }; }
    try { window.SoundFX?.playToggle?.('settings'); } catch (_) {}
    return { handled: true, spoken: pick(on
      ? [`${sw.name} on kar diya, sir.`, `Done — ${sw.name} chalu.`, `${sw.name} on hai ab.`]
      : [`${sw.name} band kar diya, sir.`, `Theek hai — ${sw.name} off.`, `${sw.name} off hai ab.`], 'switch') };
  }

  /* ── map control while a map is open ───────────────────────── */
  function mapIntent(t) {
    if (!canvasOpen() || !/map|nearby|place/i.test(canvasKind() || 'map')) return null;
    if (t.split(' ').length > 6) return null;
    const C = window.ClavisCanvas;
    const act = (args, line) => { try { C.mapControl(args); } catch (_) {} return { handled: true, spoken: line, silent: true }; };
    if (/\b(zoom\s*in|paas|pass|nazdeek|kareeb|close\s*up|aur\s*paas)\b/.test(t)) return act({ action: 'zoom_in' }, '');
    if (/\b(zoom\s*out|door|dur|peeche|pichhe|thoda\s*door)\b/.test(t)) return act({ action: 'zoom_out' }, '');
    if (/\b(satellite|satelite|sattelite)\b/.test(t)) return act({ style: 'satellite' }, '');
    if (/\b3\s*d\b|\bthree\s*d\b/.test(t)) return act({ style: '3d' }, '');
    if (/\b(dark\s*map|dark\s*mode\s*map|raat)\b/.test(t)) return act({ style: 'dark' }, '');
    if (/\b(normal\s*map|simple\s*map|flat)\b/.test(t)) return act({ style: 'map' }, '');
    if (/\b(rotate|ghumao|ghuma\s*do)\b/.test(t)) return act({ action: 'rotate' }, '');
    if (/\b(full\s*screen|fullscreen|bada\s*karo|bada\s*kar\s*do|expand|maximi[sz]e)\b/.test(t)) { try { C.expand(); } catch (_) {} return { handled: true, spoken: '', silent: true }; }
    if (/\b(chhota\s*karo|chota\s*karo|chhota\s*kar\s*do|collapse|minimi[sz]e|small)\b/.test(t)) { try { C.collapse(); } catch (_) {} return { handled: true, spoken: '', silent: true }; }
    if (/\b(world\s*view|duniya|globe)\b/.test(t)) return act({ action: 'world' }, '');
    return null;
  }

  /* ── status / capabilities ─────────────────────────────────── */
  async function statusLine() {
    const now = new Date();
    const time = now.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' });
    let total = 0, today = 0;
    try {
      const leads = (await window.MemoryEngine?.getAllLeads?.()) || window.allLeads || [];
      total = leads.length;
      const d = now.toDateString();
      today = leads.filter((l) => new Date(l.createdAt || l.timestamp || l.sourceTimestamp || 0).toDateString() === d).length;
    } catch (_) {}
    let task = '';
    try {
      const c = window.ClavisTask?.current?.();
      if (c && !/completed|failed|idle/.test(c.phase || '')) task = ` Abhi "${String(c.title || 'ek kaam').split(' · ').pop().slice(0, 40)}" chal raha hai.`;
    } catch (_) {}
    const biz = (() => { try { return window.ClavisBusiness?.profile?.().id !== 'security' ? ` Leads ${window.ClavisBusiness.label()} ke hisaab se nikal rahi hain.` : ''; } catch (_) { return ''; } })();
    const screen = canvasOpen() ? ` Display par ${canvasKind() || 'kuch'} khula hai.` : '';
    const nudge = total === 0 ? ' Shuruaat karein? Bas city boliye.' : today === 0 ? ' Aaj abhi tak koi nayi lead nahi — ek search chalaun?' : ' Kuch aur chahiye to boliye.';
    const open = pick([`${time} baj rahe hain, sir.`, `Sir, abhi ${time}.`, `Quick update, sir — ${time}.`], 'status_open');
    const nums = pick([`Database me ${total} leads, aaj ${today} nayi.`, `${total} leads saved, jinme ${today} aaj ki.`, `Aaj ${today} nayi leads, total ${total}.`], 'status_nums');
    return `${open} ${nums}${task}${biz}${screen}${nudge}`;
  }
  const CAPABILITIES = [
    '### Leads & business',
    '- **Leads for any city / industry** — "Gurgaon ki leads", "Pune ke 20 hotels"',
    '- **Your business profile** — "hum solar lagate hain" (competitors filtered automatically)',
    '- **Candidates** — "Noida me 10 security guards chahiye"',
    '- **Export, email, WhatsApp, Google Sheets** — "leads export karo"',
    '',
    '### See things',
    '- **Maps** — "India Gate map pe dikhao", "Cyber Hub ke paas hospitals", "satellite", "zoom in"',
    '- **Photos** — "shiv ji ki photo", "Taj Mahal ki tasveer"',
    '- **Websites** — "stripe.com ke baare me batao" (screenshot + brief + my take)',
    '- **Your screen** — "screen pe kya hai", "is screenshot ko ChatGPT ko do"',
    '',
    '### Your PC',
    '- **Open any app** — Chrome, Excel, Word, Notepad, File Explorer, Claude, ChatGPT',
    '- **Type & automate** — "notepad kholo aur likho …", "YouTube pe Arijit search karo", "scroll karo"',
    '',
    '### Me',
    '- **Talk naturally** — I wait till you finish; interrupt me any time ("ruko", "nahi, Noida ki dikhao")',
    '- **Sleep & wake** — "thodi der chup ho jao"; wake me with "Clavis", a snap or a clap',
    '- **Switch things on/off** — "caption band karo", "clap wala on karo", "tips off", "dark mode on", "pet hatao"',
    '- **Risky things** — before deleting or sending anything I ask once: "kar doon, sir?"',
    '- **Voice** — "ladke ki awaaz me bolo", "female voice"; Voice ID: "meri awaaz register karo"',
    '- **Look** — "accent blue karo", "claude wala theme", "minimal mode on"',
    '- **Clean up** — "map band karo", "close everything"',
    '- **Status** — "Clavis, status" · I remember what you teach me',
  ].join('\n');

  /* ── places: instant, no AI round trip ─────────────────────── */
  // "India Gate map pe dikhao", "show Cyber Hub on map", "map pe Noida",
  // "hospitals near Cyber Hub", "Sector 44 ke paas ATM". Before, these
  // waited for the AI to decide to call its map tool — or never did.
  const NEAR_CATS = { hospital: 'hospital', hospitals: 'hospital', aspatal: 'hospital', clinic: 'clinic', clinics: 'clinic', police: 'police', thana: 'police', school: 'school', schools: 'school', college: 'college', bank: 'bank', banks: 'bank', atm: 'atm', atms: 'atm', hotel: 'hotel', hotels: 'hotel', restaurant: 'restaurant', restaurants: 'restaurant', cafe: 'cafe', cafes: 'cafe', mall: 'mall', malls: 'mall', metro: 'metro', petrol: 'fuel', 'petrol pump': 'fuel', pharmacy: 'pharmacy', chemist: 'pharmacy', gym: 'gym', park: 'park', parking: 'parking', office: 'office', offices: 'office', factory: 'factory', factories: 'factory', warehouse: 'warehouse', mandir: 'worship', temple: 'worship' };
  function placeIntent(raw) {
    const C = window.ClavisCanvas;
    if (!C?.showMap) return null;
    const r = String(raw || '').replace(/[?!.।]+$/g, '').replace(/\s+/g, ' ').trim();
    if (r.split(' ').length > 12) return null;
    const clean = (x) => String(x || '').replace(/^(clavis|please|zara|jara|mujhe|mujhko|hume|sir)\s+/i, '').replace(/\s+(ko|ka|ki|ke|wala|wali)$/i, '').trim();
    // nearby first: "<category> near <place>" / "<place> ke paas <category>"
    let mm = r.match(/^(.*?)\b(hospitals?|aspatal|clinics?|police|thana|schools?|college|banks?|atms?|hotels?|restaurants?|cafes?|malls?|metro|petrol pump|petrol|pharmacy|chemist|gym|park|parking|offices?|factor(?:y|ies)|warehouse|mandir|temple)\b\s+(?:near|nearby|around|close to)\s+(.+)$/i)
      || r.match(/^(.+?)\s+(?:ke|k)\s+(?:paas|pass|aas\s*paas|around)\s+(?:ke\s+|wale\s+|kaun\s+se\s+)?(hospitals?|aspatal|clinics?|police|thana|schools?|college|banks?|atms?|hotels?|restaurants?|cafes?|malls?|metro|petrol pump|petrol|pharmacy|chemist|gym|park|parking|offices?|factor(?:y|ies)|warehouse|mandir|temple)\b/i);
    if (mm) {
      const forward = /near|nearby|around|close to/i.test(r.slice(0, r.length)) && mm.length === 4 && NEAR_CATS[String(mm[2]).toLowerCase()];
      const cat = NEAR_CATS[String(forward ? mm[2] : mm[2]).toLowerCase()] || NEAR_CATS[String(mm[3] || '').toLowerCase()];
      const where = clean(forward ? mm[3] : mm[1]);
      if (cat && where) {
        Promise.resolve(C.showNearby({ category: cat, place: where })).catch(() => {});
        return { handled: true, spoken: pick([`${where} ke aas-paas ke ${String(forward ? mm[2] : mm[2])} dhoondh raha hoon.`, `${where} ke around scan kar raha hoon, sir.`], 'near') };
      }
    }
    mm = r.match(/^(?:show\s+(?:me\s+)?|open\s+)?(.+?)\s+(?:ko\s+)?(?:on\s+(?:the\s+)?)?(?:map|maps|naksha|google\s*maps?)\s*(?:pe|par|me|mein|main)?\s*(?:dikhao|dikha\s*do|dikhaiye|dikha|kholo|khol\s*do|show|open|pe\s+dikhao)?$/i)
      || r.match(/^(?:map|maps|naksha)\s+(?:pe|par|me|mein)?\s*(.+?)\s*(?:dikhao|dikha\s*do|kholo|show)?$/i)
      || r.match(/^(?:show|open)\s+(.+?)\s+on\s+(?:the\s+)?maps?$/i);
    if (mm) {
      const where = clean(mm[1]).replace(/\b(ka|ki|ke)\s*$/i, '').trim();
      if (!where || /^(the|a|my|mera|meri|ye|yeh|is|isko|band|close)$/i.test(where) || CLOSE.test(where)) return null;
      Promise.resolve(C.showMap({ place: where })).catch(() => {});
      return { handled: true, spoken: pick([`${where} map par dikha raha hoon.`, `Yeh raha ${where}, sir.`, `${where} — map par le chalta hoon.`], 'map') };
    }
    return null;
  }

  /* ── the router ────────────────────────────────────────────── */
  async function route(text, opts = {}) {
    const raw = String(text || '').trim();
    const t = norm(raw);
    if (!t) return { handled: false };
    const words = t.split(' ');

    const v = voiceIntent(t);
    if (v) return v;

    // "thodi der chup ho jao" → sleep until his name, a snap or a clap.
    if (SLEEP.test(t) && words.length <= 9 && !/\b(mat|nahi|don'?t)\s+(so|sona|chup)\b/.test(t)) return sleep('asked');

    const sw = await toggleIntent(t, words);
    if (sw) return sw;

    // "accent blue karo", "claude wala theme", "minimal mode on"
    try {
      const said = window.ClavisAppearance?.command?.(t);
      if (said) return { handled: true, spoken: said };
    } catch (_) {}

    // "Hum solar lagate hain" / "mera business IT services hai" → leads,
    // competitor filtering and advice follow what he sells.
    if (window.ClavisBusiness && /\b(mera|meri|hamara|humara|hamari|my|our)\s+(business|kaam|company|dhandha)\b|\b(main|mai|hum|we|i)\b.*\b(provide|bechta|bechte|bechti|sell|supply|lagate|lagata|karte|karta)\b/.test(t) && words.length <= 14) {
      const id = window.ClavisBusiness.detect(t);
      if (id && id !== window.ClavisBusiness.profile().id) {
        window.ClavisBusiness.set(id);
        const p = window.ClavisBusiness.profile();
        return { handled: true, spoken: `Samajh gayi, sir — ab leads ${p.label} ke customers ki niklengi: ${p.buyers.slice(0, 3).join(', ')} aur baaki. Competitors apne aap hat jayenge.` };
      }
    }

    const closing = CLOSE.test(t);
    const repeated = /\b(close|band|hatao|clothes|cloze)\b[\s,]+\b(close|band|hatao|clothes|cloze)\b/.test(t);
    const namesApp = APPS.test(t);

    if (closing && !namesApp) {
      // 1. everything (never PC apps)
      if (ALL.test(t) || repeated) {
        const had = clearAll();
        return { handled: true, spoken: had
          ? pick(['Screen saaf kar di, sir.', 'Sab hata diya, sir.', 'Ho gaya — screen clear hai.'], 'clear_all')
          : pick(['Screen pehle se saaf hai, sir.', 'Abhi kuch khula nahi hai, sir.'], 'clear_none') };
      }
      // 2. the map
      if (MAP.test(t)) {
        if (canvasOpen()) { hideCanvas(); return { handled: true, spoken: pick(['Map band kar diya.', 'Map hata diya, sir.', 'Theek hai, map band.'], 'close_map') }; }
        if (floatOpen()) { hideFloat(); return { handled: true, spoken: 'Map khula nahi tha — floating window hata di.' }; }
        return { handled: true, spoken: 'Map pehle se band hai, sir.' };
      }
      // 3. the floating window (his word for the Peek Task window)
      if (FLOAT.test(t)) {
        if (floatOpen()) { hideFloat(); return { handled: true, spoken: pick(['Floating window hata di — agle kaam par wapas aa jayegi.', 'Window band kar di, sir.'], 'close_float') }; }
        if (canvasOpen()) { hideCanvas(); return { handled: true, spoken: 'Display band kar diya.' }; }
        if (overlayOpen()) { hideOverlays(); return { handled: true, spoken: 'Window band kar di.' }; }
        return { handled: true, spoken: 'Koi window khuli nahi hai, sir.' };
      }
      // 4. pictures / website / whatever the display shows
      if (MEDIA.test(t)) {
        if (canvasOpen()) { hideCanvas(); return { handled: true, spoken: pick(['Display band kar diya.', 'Hata diya, sir.'], 'close_media') }; }
        if (floatOpen()) { hideFloat(); return { handled: true, spoken: 'Hata diya, sir.' }; }
        return { handled: true, spoken: 'Screen par abhi kuch nahi hai, sir.' };
      }
      // 5. a bare "band karo" / "close it" / "hatao": the top-most thing
      if (words.every((w) => FILLER.has(w)) && words.length <= 5) {
        if (canvasOpen()) { hideCanvas(); return { handled: true, spoken: pick(['Band kar diya.', 'Hata diya.'], 'close_top') }; }
        if (floatOpen()) { hideFloat(); return { handled: true, spoken: pick(['Window hata di.', 'Band kar di, sir.'], 'close_top') }; }
        if (overlayOpen()) { hideOverlays(); return { handled: true, spoken: '' , silent: true }; }
        return { handled: false };   // nothing on screen → it was "be quiet"; the STOP rule handles it
      }
    }

    const m = mapIntent(t);
    if (m) return m;

    const place = placeIntent(raw);
    if (place) return place;

    // Jarvis-style status report: numbers first, then the one thing that matters.
    if (words.length <= 7 && /\b(status|briefing|brief me|update do|aaj ka update|kya chal raha|kya ho raha|report do|situation)\b/.test(t) && !/\blead\s+\w+\s+ka\s+status\b/.test(t)) {
      return { handled: true, spoken: await statusLine() };
    }
    // "Tum kya kya kar sakti ho" — show the range, say one line.
    if (/\b(kya\s*kya\s*kar\s*sakt[aei]|what\s+can\s+you\s+do|tum\s+kya\s+kar\s+sakt[aei]|capabilities|features\s+batao|help\s+menu)\b/.test(t)) {
      try { window.ClavisCanvas?.showDocument?.({ title: 'What I can do', markdown: CAPABILITIES }); } catch (_) {}
      return { handled: true, spoken: pick(['Screen par poori list rakh di hai, sir — leads se lekar PC control tak. Kahiye, kahan se shuru karein?', 'Kaafi kuch, sir. List samne hai — bas ek kaam boliye.'], 'caps') };
    }

    return { handled: false };
  }

  /* ── display skills for the text brain ─────────────────────── */
  function registerSkills() {
    const K = window.JarvisSkills;
    const C = () => window.ClavisCanvas;
    if (!K?.register) return false;
    const out = (r, fallback) => (r && typeof r === 'object' ? JSON.stringify(r).slice(0, 1500) : String(r || fallback));
    // Register only what isn't there yet — other modules may already own some.
    const reg = (name, def) => { if (!K.has?.(name)) K.register(name, def); };
    reg('show_map', {
      description: 'Show a place on the Clavis map display (cinematic fly-in + pin). Use for any place, address, city or "where is…".',
      params: { place: 'place name or address, as specific as possible', style: 'optional: map | satellite | dark | 3d' },
      run: async ({ place, style }) => out(await C()?.showMap?.({ place, style }), `Showing ${place} on the map.`),
    });
    reg('show_nearby', {
      description: 'Scan the area around a place on the map and mark everything of one kind (hospital, police, school, bank, hotel, mall, office, factory, metro…).',
      params: { category: 'what to find, e.g. hospital', place: 'optional: around this place', radius_m: 'number (default 1500)' },
      run: async (a) => out(await C()?.showNearby?.(a), 'Scanning the area.'),
    });
    reg('show_images', {
      description: 'Search pictures and show them in the Clavis display. Interpret words the Indian way ("lord" / "bhagwan" = Hindu God).',
      params: { query: 'what to find pictures of (correctly spelled)', count: 'number 3-12 (default 9)' },
      run: async ({ query, count }) => out(await C()?.showImages?.({ query, count }), `Showing pictures of ${query}.`),
    });
    reg('show_website', {
      description: 'Open a website in the Clavis display: a screenshot plus an overview. Then explain it in two or three sentences.',
      params: { url: 'URL or domain', summary: 'optional one-line description' },
      run: async ({ url, summary }) => out(await C()?.showWebsite?.({ url, summary }), `Showing ${url}.`),
    });
    reg('close_display', {
      description: 'Close the Clavis display (map / pictures / website) AND the floating task window. "Close everything / sab band karo" means this — never closing his PC apps.',
      params: {},
      run: async () => { clearAll(); return 'Screen cleared.'; },
    });
    reg('app_command', {
      description: 'Do something in the Clavis app or on the PC that no other tool covers: open an app or website, type into an app, take a screenshot, save a note, scroll, brief a website. Pass his request as one clear sentence.',
      params: { request: 'the command as one clear sentence' },
      run: async ({ request }) => {
        const r = await window.ClavisCommands?.route?.(String(request || ''));
        if (r && r.handled) return String(r.text || r.spoken || 'Done.').slice(0, 1500);
        return 'That command is not available right now.';
      },
    });
    return true;
  }

  /* ── habits: personal over time ────────────────────────────── */
  const HABITS = 'clavis_habits_v1';
  const STOPWORDS = new Set(('the a an and or of to in on for with is are was be me my mujhe mera meri mere hai hain ho karo kar do de ki ka ke ko se par pe me mein aur bhi toh ye yeh wo woh ek kya kaise please sir clavis ji abhi jara zara dikhao batao chahiye kholo band').split(' '));
  function readHabits() { try { return JSON.parse(localStorage.getItem(HABITS) || '{}') || {}; } catch (_) { return {}; } }
  function learn(text) {
    const t = norm(text);
    if (!t || t.length < 3) return;
    const h = readHabits();
    h.topics = h.topics || {};
    h.hours = h.hours || {};
    h.lang = h.lang || { hi: 0, en: 0 };
    t.split(' ').filter((w) => w.length >= 4 && !STOPWORDS.has(w) && !/^\d+$/.test(w)).slice(0, 8).forEach((w) => { h.topics[w] = (h.topics[w] || 0) + 1; });
    const hr = new Date().getHours();
    h.hours[hr] = (h.hours[hr] || 0) + 1;
    let lang = 'en';
    try { lang = window.ClavisEmotionalEngine?.languageOf?.(text) || 'en'; } catch (_) {}
    if (lang === 'en') h.lang.en++; else h.lang.hi++;
    // Forget slowly so today's interests outweigh last month's.
    const entries = Object.entries(h.topics).sort((a, b) => b[1] - a[1]);
    if (entries.length > 120) h.topics = Object.fromEntries(entries.slice(0, 80).map(([k, v]) => [k, Math.max(1, Math.round(v * 0.8))]));
    h.n = (h.n || 0) + 1;
    try { localStorage.setItem(HABITS, JSON.stringify(h)); } catch (_) {}
  }
  function habitsLine() {
    const h = readHabits();
    if (!h.n || h.n < 5) return '';
    const top = Object.entries(h.topics || {}).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([w]) => w);
    const hours = Object.entries(h.hours || {}).sort((a, b) => b[1] - a[1]).slice(0, 2).map(([hr]) => `${hr}:00`);
    const hi = (h.lang?.hi || 0) >= (h.lang?.en || 0);
    return `Sir's habits (learned from ${h.n} requests): talks mostly in ${hi ? 'Hindi/Hinglish' : 'English'}; frequent subjects: ${top.join(', ') || 'various'}; most active around ${hours.join(' and ') || 'various times'}.`;
  }

  /* ── self-test ─────────────────────────────────────────────── */
  async function _selfTest() {
    const saved = { C: window.ClavisCanvas, T: window.ClavisTaskSurface };
    let canvas = true, float = false;
    window.ClavisCanvas = { isOpen: () => canvas, kind: () => 'map', hide: () => { canvas = false; }, mapControl: () => {}, expand() {}, collapse() {} };
    window.ClavisTaskSurface = { hide: () => { float = false; } };
    const r1 = await route('map band karo');
    canvas = true;
    const r2 = await route('close close close everything');
    const clearedAll = !canvas;
    const r3 = await route('Chrome band karo');
    canvas = true;
    const r4 = await route('band karo');
    const r5 = await route('band karo');   // nothing open → falls through to STOP
    canvas = true;
    const r6 = await route('zoom in');
    window.ClavisCanvas = saved.C; window.ClavisTaskSurface = saved.T;
    const savedLive = window.ClavisLive, savedPet = window.NexusPet;
    let petOn = true;
    window.ClavisLive = { isActive: () => false };
    window.NexusPet = { setEnabled: (on) => { petOn = on; } };
    const pk = 'skylark-pet-enabled', prevPet = localStorage.getItem(pk);
    localStorage.setItem(pk, 'true');
    const r7 = await route('pet band karo');
    const r8 = await route('thodi der chup ho jao');
    const woke = wakeLine();
    const r9 = await route('leads ki list dikhao');
    window.ClavisLive = savedLive; window.NexusPet = savedPet;
    if (prevPet == null) localStorage.removeItem(pk); else localStorage.setItem(pk, prevPet);
    const checks = [
      r1.handled && /map/i.test(r1.spoken),
      r2.handled && clearedAll,
      r3.handled === false,
      r4.handled === true,
      r5.handled === false,
      r6.handled === true,
      r7.handled && petOn === false,
      r8.handled && !!r8.spoken && !!woke,
      !r9.handled,
    ];
    const passed = checks.filter(Boolean).length;
    console[passed === checks.length ? 'log' : 'error'](`ClavisIntent self-test: ${passed}/${checks.length}`, checks);
    return passed === checks.length;
  }

  window.ClavisIntent = { route, screenContext, learn, habitsLine, clearAll, registerSkills, sleep, wakeLine, _selfTest };

  // JarvisSkills loads earlier (defer order), but be safe either way.
  if (!registerSkills()) window.addEventListener('DOMContentLoaded', registerSkills, { once: true });
})();
