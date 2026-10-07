/* ============================================================
 * clavis-app-map.js  ·  "Is app me kya kya hai" — app-first commands
 * ------------------------------------------------------------
 * A runtime map of the app, read from the DOM (sidebar [data-view] items,
 * Settings sections) plus the fixed top-bar buttons, floating windows and
 * the mute / mic controls, with Hinglish / English / Devanagari names.
 *
 * "candidate tab kholo", "client AI ka page kholo", "settings me voice
 * kholo", "mute", "mic band" resolve here — before anything goes to the
 * PC. The PC gets "X kholo" only with a PC cue ("PC me excel kholo",
 * "MS Excel", "chrome me …", a .com) or when the app has no such thing.
 *
 * API: window.ClavisAppMap = {
 *   resolve(text, {loose}) → { kind, id, label, run() → spoken } | null
 *   handle(text) → Promise<{ handled, spoken, rest }>   (compound "A aur B")
 *   list(), describe(), _selfTest()
 * }
 * ============================================================ */
(function () {
  'use strict';
  if (window.ClavisAppMap) return;

  var norm = function (s) {
    return String(s || '').toLowerCase().replace(/[.!?,;:।"'“”]+/g, ' ').replace(/\s+/g, ' ').trim();
  };

  /* ── names he uses for each place ─────────────────────────── */
  var VIEW_SYN = {
    jarvis: ['clavis', 'clavis ai', 'clavis studio', 'clavis ai studio', 'ai studio', 'assistant', 'jarvis', 'क्लैविस', 'क्लेविस'],
    chat: ['client', 'client ai', 'clients', 'client chat', 'leads chat', 'lead chat', 'chat', 'chat ai', 'क्लाइंट', 'क्लाइंट एआई'],
    'voice-ai': ['voice ai', 'voice calling', 'voice calling ai', 'dialer', 'calling ai', 'call ai'],
    'candidate-ai': ['candidate', 'candidate ai', 'candidates ai', 'recruiter', 'recruiter ai', 'कैंडिडेट', 'कैंडिडेट एआई'],
    dashboard: ['dashboard', 'home', 'overview', 'डैशबोर्ड'],
    leads: ['leads', 'lead', 'leads database', 'lead database', 'all leads', 'data hub', 'lead hub', 'लीड्स', 'लीड'],
    'candidate-db': ['candidate database', 'candidates database', 'candidate db', 'candidate data', 'candidate list', 'candidates list'],
    excel: ['excel', 'excel manager', 'spreadsheet', 'sheets', 'एक्सेल'],
    'crm-overview': ['crm', 'crm overview', 'relationship workspace'],
    'crm-pipeline': ['crm pipeline', 'deals pipeline'],
    'crm-activity': ['crm activity', 'follow ups', 'follow-ups'],
    'crm-reports': ['crm reports', 'contract reports', 'sales reports'],
    'crm-clients': ['clients and contracts', 'clients contracts', 'crm clients', 'renewals'],
    analytics: ['analytics', 'reports', 'report', 'statistics', 'analytics report'],
    agent: ['run agent', 'agent', 'scraping agent', 'scraper', 'ai agent', 'lead agent'],
    email: ['email', 'emails', 'mail', 'email automation', 'inbox', 'ईमेल'],
    whatsapp: ['whatsapp', 'whats app', 'whatsapp automation', 'व्हाट्सएप'],
    accounts: ['accounts', 'connected accounts', 'account'],
    plugins: ['plugins', 'plugin', 'integrations'],
    tokens: ['api keys', 'api key', 'keys', 'tokens', 'token', 'api dashboard'],
    settings: ['settings', 'setting', 'preferences', 'सेटिंग्स', 'सेटिंग'],
    manual: ['manual', 'app guide', 'user guide', 'help guide', 'मैनुअल']
  };
  var SECTION_SYN = {
    profile: ['profile', 'user profile', 'mera profile'],
    appearance: ['appearance', 'look', 'theme settings', 'colors', 'colours'],
    dashboard: ['dashboard settings'],
    usage: ['usage', 'limits', 'usage limits', 'credits'],
    leadrules: ['lead rules', 'rules'],
    scraper: ['lead scraper', 'scraper settings'],
    provision: ['provisioning', 'client provisioning'],
    api: ['api settings', 'api keys settings'],
    'ai-models': ['ai models', 'models', 'ai model', 'brain'],
    'voice-settings': ['voice', 'voice settings', 'voice ai settings', 'awaaz', 'awaaz settings', 'awaz settings'],
    notifications: ['notifications', 'notification', 'alerts'],
    security: ['security', 'password'],
    performance: ['performance', 'graphics', 'speed'],
    about: ['about', 'version']
  };
  function call(path) {
    var parts = path.split('.'), o = window;
    for (var i = 0; i < parts.length - 1; i++) { o = o && o[parts[i]]; }
    var fn = o && o[parts[parts.length - 1]];
    if (typeof fn !== 'function') return false;
    fn.call(o);
    return true;
  }
  var BUTTONS = [
    { id: 'manual', label: 'Manual', syn: ['manual', 'app guide', 'user guide'], run: function () { window.ClavisAppMap?.guide?.open(); return !!window.ClavisAppMap?.guide; } },
    { id: 'history', label: 'Chat History', syn: ['history', 'chat history', 'purani chats', 'purani chat', 'old chats', 'हिस्ट्री'], fn: 'ChatHistory.open' },
    { id: 'shortcuts', label: 'Shortcuts', syn: ['shortcuts', 'shortcut', 'keyboard shortcuts', 'command palette'], fn: 'Shortcuts.open' },
    { id: 'peek', label: 'Peek Tasks', syn: ['peek', 'peek tasks', 'peek task', 'task peek', 'sneak peek', 'tasks'], fn: 'ClavisSneakPeek.open' },
    { id: 'sidebar', label: 'Sidebar', syn: ['sidebar', 'side bar', 'side menu'], fn: 'SidebarController.expand' },
    { id: 'theme', label: 'Theme', syn: ['theme', 'theme toggle', 'dark light'], fn: 'toggleDayNightTheme', verbs: /\b(badlo|badal|change|toggle|switch|palto)\b/ },
    { id: 'task-window', label: 'Task window', syn: ['task window', 'floating window', 'task panel', 'floating panel', 'floating'], run: function () {
      var T = window.ClavisTaskSurface;
      if (T && T.show) { T.show({ user: true }); return true; }
      return false;
    } },
    { id: 'display-expand', label: 'Display', syn: ['display', 'canvas'], verbs: /\b(bada|badi|expand|full|maximi[sz]e|phaila)\b/, run: function () {
      var C = window.ClavisCanvas;
      if (C && C.isOpen && C.isOpen() && C.expand) { C.expand(); return true; }
      return false;
    } }
  ];

  /* ── controls: speech output + Live mic (real toggles only) ─ */
  function speechOn() {
    try { if (typeof jarvisSpeechEnabled !== 'undefined') return !!jarvisSpeechEnabled; } catch (_) {}   // eslint-disable-line no-undef
    try { return localStorage.getItem('jarvis_speech_enabled') === 'true'; } catch (_) { return false; }
  }
  function setSpeech(on) {
    if (speechOn() !== on && typeof window.toggleJarvisSpeech === 'function') window.toggleJarvisSpeech();
    if (!on) { try { window.ClavisCommands && window.ClavisCommands.cancelSpeech && window.ClavisCommands.cancelSpeech(); } catch (_) {} }
  }
  function liveOn() { try { return !!(window.ClavisLive && window.ClavisLive.isActive && window.ClavisLive.isActive()); } catch (_) { return false; } }
  var CONTROLS = [
    { id: 'mute', label: 'Awaaz band', rx: /^(?:please )?(?:mute|mute (?:karo|kar do|kardo|ho jao)|(?:voice|speaker|sound|awaaz|awaz|aawaz|आवाज़|आवाज) (?:band|bandh|off|mute)(?: (?:karo|kar do|kardo|kijiye))?|(?:reply|jawab) (?:ki )?awaaz band(?: karo)?|म्यूट(?: करो)?|आवाज़? बंद(?: करो)?)$/,
      run: function () { setSpeech(false); return 'Awaaz band kar di. Wapas chahiye to "unmute" boliye.'; } },
    { id: 'unmute', label: 'Awaaz chalu', rx: /^(?:please )?(?:unmute|unmute (?:karo|kar do)|(?:voice|speaker|sound|awaaz|awaz|aawaz|आवाज़|आवाज) (?:chalu|chaalu|on|wapas)(?: (?:karo|kar do|kijiye))?|bol ke jawab do|अनम्यूट(?: करो)?|आवाज़? चालू(?: करो)?)$/,
      run: function () { setSpeech(true); return 'Awaaz chalu kar di.'; } },
    { id: 'mic-off', label: 'Mic band', rx: /^(?:please )?(?:mic|mike|microphone|माइक) (?:band|bandh|off|mute|बंद)(?: (?:karo|kar do|kardo|kijiye|करो))?$|^mute (?:the )?(?:mic|mike|microphone)$/,
      run: function () {
        if (window.ClavisVoiceState) window.ClavisVoiceState.setMicEnabled(false, 'command');
        if (liveOn() && window.ClavisLive.setMuted) { window.ClavisLive.setMuted(true); return 'Mic band — main sun nahi rahi. "Mic chalu" boliye ya HUD ka mic dabaiye.'; }
        try { window.clavisStopCommandEar && window.clavisStopCommandEar(); } catch (_) {}
        try { window.stopWakeListener && window.stopWakeListener(); } catch (_) {}
        try { window.LocalSpeechEngine && window.LocalSpeechEngine.stopInput && window.LocalSpeechEngine.stopInput(); } catch (_) {}
        try { window.stopClavisSoundTriggers && window.stopClavisSoundTriggers(); } catch (_) {}
        return 'Mic band kar diya.';
      } },
    { id: 'mic-on', label: 'Mic chalu', rx: /^(?:please )?(?:mic|mike|microphone|माइक) (?:chalu|chaalu|on|unmute|चालू)(?: (?:karo|kar do|kardo|kijiye|करो))?$|^unmute (?:the )?(?:mic|mike|microphone)$/,
      run: function () {
        if (window.ClavisVoiceState) window.ClavisVoiceState.setMicEnabled(true, 'command');
        if (liveOn() && window.ClavisLive.setMuted) { window.ClavisLive.setMuted(false); return 'Mic chalu — boliye.'; }
        if (typeof window.startJarvisVoiceInput === 'function') { window.startJarvisVoiceInput(); return 'Mic chalu — boliye.'; }
        return 'Mic ka button neeche composer me hai.';
      } }
  ];

  /* ── grammar ──────────────────────────────────────────────── */
  var OPEN = { kholo: 1, kholiye: 1, kholna: 1, khol: 1, kholdo: 1, open: 1, jao: 1, chalo: 1, dikhao: 1, dikhaiye: 1, dikha: 1, show: 1, go: 1, switch: 1, chalao: 1, 'खोलो': 1, 'खोल': 1, 'दिखाओ': 1, 'जाओ': 1, 'चलो': 1 };
  var CLOSE = /\b(close|hide|dismiss|band|bandh|hatao|hatado|chhupao)\b|बंद|हटाओ|छुपाओ/;
  var FILLER = { do: 1, de: 1, dijiye: 1, karo: 1, kar: 1, to: 1, the: 1, le: 1, lo: 1, pe: 1, par: 1, pr: 1, me: 1, mein: 1, main: 1, mai: 1, ka: 1, ki: 1, ke: 1, ko: 1, wala: 1, wali: 1, wale: 1, tab: 1, tabs: 1, page: 1, section: 1, screen: 1, please: 1, zara: 1, jara: 1, sir: 1, ji: 1, my: 1, mera: 1, meri: 1, mere: 1, on: 1, na: 1, now: 1, abhi: 1, jaldi: 1, hey: 1, buddy: 1, clay: 1,
    // button verbs — the button itself checks it was one of ITS verbs
    badlo: 1, badal: 1, change: 1, toggle: 1, palto: 1, bada: 1, badi: 1, expand: 1, full: 1,
    'टैब': 1, 'पेज': 1, 'का': 1, 'की': 1, 'के': 1, 'पर': 1, 'पे': 1, 'में': 1, 'दो': 1, 'करो': 1 };
  // "PC me …", "MS Excel", "chrome me …", "website", "abc.com" — the PC, not the app.
  var PC_CUE = /\b(pc|computer|laptop|desktop|system|browser|website|web|site|chrome|edge|firefox|windows|ms|microsoft|office|software)\b|\.(com|in|org|net|io|co)\b|कंप्यूटर|लैपटॉप/;

  function sidebarViews() {
    var out = {};
    try {
      var els = document.querySelectorAll('[data-view]');
      for (var i = 0; i < els.length; i++) {
        var id = els[i].getAttribute('data-view');
        if (!id || out[id]) continue;
        var label = els[i].getAttribute('data-tooltip') || norm(els[i].textContent) || id;
        out[id] = String(label).trim();
      }
    } catch (_) {}
    return out;
  }
  function settingsSections() {
    var out = {};
    try {
      var els = document.querySelectorAll('.smodal-nav-item[data-section]');
      for (var i = 0; i < els.length; i++) {
        var id = els[i].getAttribute('data-section');
        var sp = els[i].querySelector('span');
        out[id] = String((sp && sp.textContent) || id).trim();
      }
    } catch (_) {}
    return out;
  }

  function openView(id) {
    if (id === 'settings') return openSection(null);
    if (typeof window.showView === 'function') window.showView(id);
    else if (window.ClavisVoiceNav && window.ClavisVoiceNav.switchToView) window.ClavisVoiceNav.switchToView(id);
    try { if (location.hash !== '#' + id) history.replaceState(null, '', '#' + id); } catch (_) {}
    return true;
  }
  function openSection(section) {
    if (typeof window.openSettingsModal === 'function') window.openSettingsModal();
    if (section && typeof window.settingsNavTo === 'function') {
      window.settingsNavTo(section, document.querySelector('.smodal-nav-item[data-section="' + section + '"]'));
    }
    return true;
  }

  /** Every place in the app, live from the DOM. */
  function list() {
    var items = [];
    var views = sidebarViews();
    Object.keys(views).forEach(function (id) {
      var syn = (VIEW_SYN[id] || []).concat([norm(views[id]), id.replace(/-/g, ' ')]);
      items.push({ kind: 'view', id: id, label: views[id], syn: syn });
    });
    var secs = settingsSections();
    Object.keys(secs).forEach(function (id) {
      items.push({ kind: 'settings', id: id, label: 'Settings › ' + secs[id], syn: (SECTION_SYN[id] || []).concat([norm(secs[id])]) });
    });
    BUTTONS.forEach(function (b) { items.push({ kind: 'button', id: b.id, label: b.label, syn: b.syn, verbs: b.verbs, _b: b }); });
    CONTROLS.forEach(function (c) { items.push({ kind: 'control', id: c.id, label: c.label, rx: c.rx, _c: c }); });
    return items;
  }

  function hit(item) {
    return {
      kind: item.kind, id: item.id, label: item.label,
      run: function () {
        if (item.kind === 'control') return item._c.run();
        if (item.kind === 'settings') { openSection(item.id); return item.label.replace('Settings › ', '') + ' settings khol di.'; }
        if (item.kind === 'view') { openView(item.id); return item.label + ' khol diya.'; }
        var b = item._b, ok = b.run ? b.run() : call(b.fn);
        return ok ? b.label + ' khol diya.' : b.label + ' abhi nahi khul paya.';
      }
    };
  }

  function closeHit(item) {
    return {
      kind: item.kind, id: item.id, label: item.label,
      run: function () {
        var id = item.id, ok = false;
        var overlay = (item.kind === 'settings' || id === 'settings') ? 'settings-overlay'
          : id === 'history' ? 'history-overlay' : id === 'shortcuts' ? 'shortcuts-overlay' : '';
        if (overlay && !document.getElementById(overlay)?.classList.contains('open')) return item.label + ' abhi khula nahi hai.';
        if (id === 'task-window' && !document.getElementById('clavis-task-surface')?.classList.contains('is-open')) return item.label + ' abhi khula nahi hai.';
        if (item.kind === 'settings' || id === 'settings') ok = call('closeSettingsModal');
        else if (id === 'history') ok = call('ChatHistory.close');
        else if (id === 'shortcuts') ok = call('Shortcuts.close');
        else if (id === 'peek') ok = call('ClavisSneakPeek.close');
        else if (id === 'sidebar') ok = call('SidebarController.collapse');
        else if (id === 'task-window') ok = call('ClavisTaskSurface.hide');
        else if (item.kind === 'view' && location.hash === '#' + id) { openView('dashboard'); ok = true; }
        return ok ? item.label + ' band kar diya.' : item.label + ' abhi khula nahi hai.';
      }
    };
  }

  function stripClavis(words) {
    while (words.length > 1 && /^(clavis|क्लैविस|hey|buddy|clay|ok|okay|acha|achha)$/.test(words[0])) words = words.slice(1);
    return words;
  }

  /**
   * resolve("candidate tab kholo") → { kind:'view', id:'candidate-ai', … }.
   * opts.loose: a bare name ("candidate tab", "voice settings") is enough —
   * for the LLM skill, which already decided it's an app action.
   */
  function resolve(text, opts) {
    opts = opts || {};
    var t = norm(text);
    if (!t) return null;
    var items = list();
    var c, i;
    for (i = 0; i < items.length; i++) {
      c = items[i];
      if (c.kind === 'control' && c.rx.test(t.replace(/^(clavis|hey clavis)\s+/, ''))) return hit(c);
    }
    if (PC_CUE.test(t)) return null;
    try {
      var plan = window.LeadCandidateDomain && window.LeadCandidateDomain.parseRequest && window.LeadCandidateDomain.parseRequest(text);
      if (plan && plan.isSearch && plan.citiesExplicit) return null;   // "Ghaziabad ki leads nikalo" is a search, not a tab
    } catch (_) {}

    var words = t.split(' ');
    var hasOpen = words.some(function (w) { return OPEN[w]; }) || /\bgo to\b|\ble (chalo|jao)\b|\bpe (jao|chalo)\b/.test(t);
    var hasClose = CLOSE.test(t);
    var hasPlace = /\b(tab|page|section|window)\b|टैब|पेज/.test(t);
    var core = words.filter(function (w) { return !OPEN[w] && !FILLER[w] && !CLOSE.test(w); });
    if (!core.length) return null;

    function match(phrase, withSettingsWord) {
      for (var j = 0; j < items.length; j++) {
        var it = items[j];
        if (!it.syn) continue;
        if (withSettingsWord && it.kind !== 'settings') continue;
        if (it.syn.indexOf(phrase) === -1) continue;
        if (it.kind === 'button' && it.verbs) {
          if (it.verbs.test(t)) return it;
          continue;
        }
        if (hasOpen || hasClose || hasPlace || opts.loose) return it;
      }
      return null;
    }
    var tries = [core, stripClavis(core)];
    for (i = 0; i < tries.length; i++) {
      var w = tries[i];
      var phrase = w.join(' ');
      // "settings me voice kholo" / "voice settings kholo" → that section
      var si = w.filter(function (x) { return !/^(settings?|सेटिंग्स?)$/.test(x); });
      if (si.length && si.length < w.length) {
        var s = match(si.join(' '), true);
        if (s) return hasClose ? closeHit(s) : hit(s);
      }
      var m = match(phrase, false);
      if (m) return hasClose ? closeHit(m) : hit(m);
      // a section name alone ("notifications kholo") when no tab has that name
      var sec = match(phrase, true);
      if (sec) return hasClose ? closeHit(sec) : hit(sec);
    }
    // One trailing verb that isn't an open verb ("excel kholo na") is handled by FILLER;
    // anything else (a PC app, a website, a question) is not ours.
    return null;
  }

  /* ── compound commands: "candidate tab kholo aur mute karo" ── */
  var SEARCH_VERB = /\b(nikalo|nikal|dhundho|dhoondho|dhundo|search|find|generate|chahiye|chahie|lao|scrape|khojo)\b|निकालो|ढूंढो|चाहिए/;
  var SPLIT =/\s*(?:,|\s(?:aur|and|phir|fir|then|uske baad|uske bad|us ke baad|और|फिर)\s)\s*/i;
  async function handle(text) {
    var raw = String(text || '').trim();
    if (!raw) return { handled: false };
    var one = resolve(raw);
    if (one) return { handled: true, spoken: one.run(), rest: '' };
    var parts = raw.split(SPLIT).map(function (p) { return p.trim(); }).filter(Boolean);
    if (parts.length < 2) return { handled: false };
    // A lead search owns its "aur map pe dikhao" — never split it. (isSearch
    // alone fires on any "leads"/"candidate" word, so also need a city or a
    // search verb: "candidate tab kholo aur mute karo" still splits.)
    try {
      var plan = window.LeadCandidateDomain && window.LeadCandidateDomain.parseRequest && window.LeadCandidateDomain.parseRequest(raw);
      if (plan && plan.isSearch && (plan.citiesExplicit || SEARCH_VERB.test(norm(raw)))) return { handled: false };
    } catch (_) {}
    var hits = parts.map(function (p) { return resolve(p); });
    if (!hits.some(Boolean)) return { handled: false };
    var said = [], rest = [];
    for (var i = 0; i < parts.length; i++) {
      if (hits[i]) { said.push(hits[i].run()); continue; }
      var q = null;
      try { q = window.ClavisIntent && window.ClavisIntent.route ? await window.ClavisIntent.route(parts[i], { source: 'composer' }) : null; } catch (_) {}
      if (q && q.handled) { if (q.spoken || q.text) said.push(String(q.spoken || q.text)); continue; }
      rest.push(parts[i]);
    }
    return { handled: true, spoken: said.join(' '), rest: rest.join(' aur ') };
  }

  function describe() {
    var items = list();
    var by = function (k) { return items.filter(function (x) { return x.kind === k; }); };
    return 'Tabs: ' + by('view').map(function (x) { return x.id + ' (' + x.label + ')'; }).join(', ') +
      '. Settings sections: ' + by('settings').map(function (x) { return x.id; }).join(', ') +
      '. Buttons/windows: ' + by('button').map(function (x) { return x.label; }).join(', ') +
      '. Controls: mute, unmute, mic band, mic chalu.';
  }

  function _selfTest() {
    var cases = [
      ['candidate tab kholo', 'candidate-ai'], ['Candidate AI kholo', 'candidate-ai'], ['clavis tab kholo', 'jarvis'],
      ['Rudra24 AI, candidate tab kholo', 'candidate-ai'], ['client tab kholo', 'chat'], ['client AI ka page kholo', 'chat'],
      ['client ai kholo', 'chat'], ['open clients page', 'chat'], ['leads kholo', 'leads'], ['leads page pe jao', 'leads'],
      ['candidate database kholo', 'candidate-db'], ['excel kholo', 'excel'], ['excel manager dikhao', 'excel'],
      ['API keys kholo', 'tokens'], ['run agent kholo', 'agent'], ['go to dashboard', 'dashboard'],
      ['settings kholo', 'settings'], ['settings me voice kholo', 'voice-settings'], ['voice settings kholo', 'voice-settings'],
      ['appearance settings kholo', 'appearance'], ['history kholo', 'history'], ['shortcuts kholo', 'shortcuts'],
      ['peek tasks kholo', 'peek'], ['theme badlo', 'theme'], ['mute', 'mute'], ['mute karo', 'mute'],
      ['awaaz band karo', 'mute'], ['unmute', 'unmute'], ['mic band karo', 'mic-off'], ['mic chalu karo', 'mic-on'],
      ['क्लाइंट टैब खोलो', 'chat'], ['कैंडिडेट टैब खोलो', 'candidate-ai'], ['whatsapp kholo', 'whatsapp'],
      ['floating window kholo', 'task-window'],
      // negatives: PC, searches, questions, the wake word alone
      ['PC me excel kholo', null], ['MS Excel kholo', null], ['chrome me youtube kholo', null], ['notepad kholo', null],
      ['google.com kholo', null], ['Ghaziabad ki leads nikalo', null], ['leads kya hoti hain', null], ['Rudra', null],
      ['excel', null], ['candidate', null], ['laptop pe whatsapp kholo', null], ['mute ka matlab kya hai', null]
    ];
    var fails = [];
    cases.forEach(function (c) {
      var r = resolve(c[0]);
      var got = r ? r.id : null;
      // a tab that isn't in this DOM (tests on a partial page) can't resolve — skip it
      if (got !== c[1]) fails.push(c[0] + ' → ' + got + ' (want ' + c[1] + ')');
    });
    var ok = fails.length === 0;
    console[ok ? 'log' : 'error']('ClavisAppMap self-test: ' + (cases.length - fails.length) + '/' + cases.length + (ok ? '' : '\n' + fails.join('\n')));
    return { ok: ok, total: cases.length, fails: fails };
  }

  window.ClavisAppMap = { resolve: resolve, handle: handle, list: list, describe: describe, _selfTest: _selfTest };
})();
