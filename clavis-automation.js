/**
 * ============================================================
 *  CLAVIS AUTOMATION (clavis-automation.js)
 *  Clavis's hands OUTSIDE the app — open / type into / close desktop
 *  apps, run small multi-step tasks, and brief sir on any website.
 *
 *    "chrome kholo" · "file manager kholo" · "claude khol do"
 *    "notepad kholo aur likho kal 5 baje meeting" · "word me likho …"
 *    "open excel and type …" · "notepad kholo aur ek leave application likho"
 *    "chrome kholo aur youtube pe arijit singh search karo"
 *    "amazon pe office chair search karo" · "website neeche scroll karo"
 *    "notepad band karo"  (named app only, one-line confirm first)
 *    "is website ke baare me batao" · "brief me about stripe.com"
 *
 *  How a request runs:
 *    parse()        local regex planner → { kind: plan | brief | close }
 *    planWithAI()   anything else that smells like PC automation →
 *                   ClavisDirect JSON plan, validated against STEP_TYPES
 *    runPlan()      steps: open | focus | wait | type | key | hotkey |
 *                   scroll | search-web | open-url — each with a bridge
 *                   path and an honest browser-only fallback
 *    briefWebsite() page text → a TEXT brief for the screen + a different,
 *                   deeper SPOKEN take, and a screenshot via ClavisCanvas
 *
 *  Needs the bridge (clavis-bridge/) for real desktop control; typing,
 *  keys, focus and close also need Start-Bridge-With-Control.bat. With the
 *  bridge off: web versions open in a tab, text goes to the clipboard.
 *
 *  Wiring: ClavisCommands.route() calls handle(text). A narrow priority
 *  gate (installGate) also puts handle() in front of the other routers for
 *  the phrases they would misread ("excel kholo" is the desktop app, not
 *  the Excel Manager page; "chrome kholo aur youtube pe …" is one task).
 *  It NEVER claims "close everything / sab band karo" — those belong to
 *  clavis-intent.js — and never closes an app he didn't name.
 * ============================================================
 */
'use strict';

(() => {
  const PC = () => window.ClavisPC;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const norm = (s) => String(s || '').toLowerCase().replace(/[’`]/g, "'").replace(/[.!?।]+$/g, '').replace(/\s+/g, ' ').trim();
  const enc = encodeURIComponent;
  const cap = (s) => String(s || '').charAt(0).toUpperCase() + String(s || '').slice(1);
  function withTimeout(promise, ms, label) {
    let t;
    return Promise.race([
      Promise.resolve(promise).finally(() => clearTimeout(t)),
      new Promise((_, reject) => { t = setTimeout(() => reject(new Error(`${label || 'Step'} timed out`)), ms); }),
    ]);
  }

  // What Clavis did last — so "is website ko scroll karo" / "is site ke
  // baare me batao" know which site, and the gate knows scrolling means
  // the website, not the Clavis page.
  const state = { lastSite: null, lastWindow: null, inflight: new Map() };
  const RECENT_MS = 10 * 60 * 1000;
  function rememberSite(url, title) { if (url) state.lastSite = { url, title: title || '', at: Date.now() }; }

  const BROWSER_PROCS = ['chrome', 'msedge', 'firefox', 'brave', 'opera', 'vivaldi', 'iexplore'];
  const isBrowserProc = (p) => BROWSER_PROCS.includes(String(p || '').toLowerCase());

  // ── Vocabulary ───────────────────────────────────────────────
  const OPEN_VERB = /\b(open|launch|start|khol(?:o|na|iye|ein|en)?|khol\s*(?:do|de|dijiye|dena|na)|chalu\s*kar(?:o|do|de)?|chala(?:o|do|de)|start\s*kar(?:o|do|de)?|open\s*kar(?:o|do|de)?|launch\s*kar(?:o|do|de)?)\b/;
  const GO_VERB = /\b(go\s*to|jao|jaao|pe\s*jao|par\s*jao|switch\s*(?:to|kar(?:o|do)?)|saamne\s*la(?:o|do))\b/;
  const CLOSE_VERB = /\b(close|quit|exit|band\s*kar(?:o|do|de|dijiye|na)?|bandh\s*kar(?:o|do|de)?|band|bandh)\b/;
  const SEARCH_VERB = /\b(search|dhoond(?:o|ho|na)?|dhund(?:o|ho|na)?|khoj(?:o|na)?|find|look\s*up|chala(?:o|do)?|play|bajao|baja\s*do|sun(?:a|ao|ao\s*na)?)\b/;
  const SCROLL_WORD = /\b(scroll|page\s*down|page\s*up)\b/;
  const KEY_VERB = /\b(press|dabao|daba\s*do|daba\s*dijiye|hit)\b/;
  const WAIT_RE = /\b(?:wait|ruko|ruk\s*jao|intezaar)\b[^\d]*(\d{1,2})?\s*(?:sec|second|seconds|s)?\b|\b(\d{1,2})\s*(?:sec|second|seconds)\s*(?:wait|ruko|ruk)\b/;
  const ALL_RE = /\b(everything|sab|sabhi|saare|sare|sab\s*kuch|sabkuch|all|saari|sari)\b/;
  const NEVER_RE = /\b(screenshot|screen\s?shot|prompt)\b/;
  const GIVE_RE = /\b(is(?:e|ko)?|ye|yeh|this)\b.*\b(chatgpt|chat gpt|claude|gemini|perplexity)\b.*\b(do|de do|bhej|bhejo|give|send|paste)\b/;
  const CONNECTOR = /\s*(?:,|;|\s(?:aur\s+(?:phir|fir|uske\s+baad)|and\s+then|aur|and|then|phir|fir|uske\s+baad|after\s+that|&)\s)\s*/i;
  // Verbs that mean "write this text there". Bare "type"/"write" only count
  // right after a connector or at the start ("open excel and type …"), so
  // "what type of…" never turns into typing.
  const TYPE_VERB = String.raw`likh(?:o|do|de|iye|na|ein|en)?|likh\s+(?:do|de|dijiye|dena)|type\s+kar(?:o|do|de|dijiye)?|(?:(?<=^)|(?<=\b(?:and|aur|then|phir|fir|&)\s))(?:type|write)`;
  const TYPE_AT = new RegExp(String.raw`(?:^|\b)(?:${TYPE_VERB})\b`, 'i');

  // Searchable sites: "<site> pe <query> search karo". Maps are left to the
  // in-app map (ClavisCanvas); lead words are left to the lead pipeline.
  const SEARCH_SITES = {
    youtube: { label: 'YouTube', say: 'you\\s?tube|yt', url: (q) => `https://www.youtube.com/results?search_query=${enc(q)}`, home: 'https://www.youtube.com' },
    google: { label: 'Google', say: 'google(?!\\s+chrome)|internet|web|online', url: (q) => `https://www.google.com/search?q=${enc(q)}`, home: 'https://www.google.com' },
    wikipedia: { label: 'Wikipedia', say: 'wikipedia|wiki', url: (q) => `https://en.wikipedia.org/wiki/Special:Search?search=${enc(q)}`, home: 'https://en.wikipedia.org' },
    amazon: { label: 'Amazon', say: 'amazon', url: (q) => `https://www.amazon.in/s?k=${enc(q)}`, home: 'https://www.amazon.in' },
    flipkart: { label: 'Flipkart', say: 'flipkart', url: (q) => `https://www.flipkart.com/search?q=${enc(q)}`, home: 'https://www.flipkart.com' },
    spotify: { label: 'Spotify', say: 'spotify', url: (q) => `https://open.spotify.com/search/${enc(q)}`, home: 'https://open.spotify.com' },
    github: { label: 'GitHub', say: 'github|git hub', url: (q) => `https://github.com/search?q=${enc(q)}`, home: 'https://github.com' },
    linkedin: { label: 'LinkedIn', say: 'linkedin|linked in', url: (q) => `https://www.linkedin.com/search/results/all/?keywords=${enc(q)}`, home: 'https://www.linkedin.com' },
    twitter: { label: 'X', say: 'twitter', url: (q) => `https://x.com/search?q=${enc(q)}`, home: 'https://x.com' },
    reddit: { label: 'Reddit', say: 'reddit', url: (q) => `https://www.reddit.com/search/?q=${enc(q)}`, home: 'https://www.reddit.com' },
    bing: { label: 'Bing', say: 'bing', url: (q) => `https://www.bing.com/search?q=${enc(q)}`, home: 'https://www.bing.com' },
    chatgpt: { label: 'ChatGPT', say: 'chat\\s?gpt', url: (q) => `https://chatgpt.com/?q=${enc(q)}`, home: 'https://chatgpt.com' },
    perplexity: { label: 'Perplexity', say: 'perplexity', url: (q) => `https://www.perplexity.ai/search?q=${enc(q)}`, home: 'https://www.perplexity.ai' },
    indiamart: { label: 'IndiaMART', say: 'india\\s?mart', url: (q) => `https://dir.indiamart.com/search.mp?ss=${enc(q)}`, home: 'https://www.indiamart.com' },
    stackoverflow: { label: 'Stack Overflow', say: 'stack\\s?overflow', url: (q) => `https://stackoverflow.com/search?q=${enc(q)}`, home: 'https://stackoverflow.com' },
    gmail: { label: 'Gmail', say: 'gmail', url: (q) => `https://mail.google.com/mail/u/0/#search/${enc(q)}`, home: 'https://mail.google.com' },
  };
  const SITE_ALT = Object.values(SEARCH_SITES).map((s) => s.say).join('|');
  Object.keys(SEARCH_SITES).forEach((k) => { SEARCH_SITES[k].key = k; SEARCH_SITES[k].re = new RegExp(`\\b(?:${SEARCH_SITES[k].say})\\b`, 'i'); });
  function siteFor(word) {
    const w = String(word || '').toLowerCase();
    return Object.values(SEARCH_SITES).find((s) => s.re.test(w)) || null;
  }

  // SendKeys names for the keys a step may press.
  const KEYS = {
    enter: '{ENTER}', return: '{ENTER}', tab: '{TAB}', esc: '{ESC}', escape: '{ESC}', space: ' ', spacebar: ' ',
    backspace: '{BACKSPACE}', delete: '{DELETE}', del: '{DELETE}', up: '{UP}', down: '{DOWN}', left: '{LEFT}', right: '{RIGHT}',
    home: '{HOME}', end: '{END}', pageup: '{PGUP}', pagedown: '{PGDN}', pgup: '{PGUP}', pgdn: '{PGDN}',
  };
  for (let i = 1; i <= 12; i++) KEYS[`f${i}`] = `{F${i}}`;
  const MODS = { ctrl: '^', control: '^', shift: '+', alt: '%' };
  // Closing / deleting shortcuts: allowed only after a yes.
  const RISKY_KEYS = /^(alt\+f4|ctrl\+w|ctrl\+f4|ctrl\+q|ctrl\+shift\+w|ctrl\+shift\+q|shift\+delete|ctrl\+shift\+delete|delete|del)$/;

  function keyToSendKeys(combo) {
    const parts = String(combo || '').toLowerCase().replace(/\s+/g, '').split('+').filter(Boolean);
    if (!parts.length || parts.length > 4) return null;
    const key = parts.pop();
    let mods = '';
    for (const p of parts) { if (!MODS[p]) return null; if (!mods.includes(MODS[p])) mods += MODS[p]; }
    let k = KEYS[key.replace(/[\s_-]/g, '')];
    if (!k && /^[a-z0-9]$/.test(key)) k = key;
    if (!k) return null;
    return mods + k;
  }

  // ── Parsing ──────────────────────────────────────────────────
  const URL_RE = /\b((?:https?:\/\/)?(?:www\.)?[a-z0-9][a-z0-9-]*(?:\.[a-z0-9-]+)*\.(?:com|in|org|net|io|ai|co|app|dev|me|us|uk|info|biz|edu|gov|xyz|tech|store|shop|site|online|live|so|gg|tv|ly|to|cloud|digital|agency|services|solutions)(?:\.[a-z]{2})?(?:\/[^\s"'<>]*)?)/i;
  function extractUrl(text) {
    const m = String(text || '').match(URL_RE);
    if (!m) return '';
    const u = m[1].replace(/[),.;!?]+$/, '');
    return /^https?:\/\//i.test(u) ? u : `https://${u}`;
  }
  function hostOf(u) { try { return new URL(u).hostname.replace(/^www\./, ''); } catch (_) { return String(u || ''); } }

  const cleanQuery = (q) => String(q || '')
    .replace(/^(?:ke\s+liye|for|about|ki|ka|ke|the|pe|par|me|mein)\s+/i, '')
    .replace(/(?:\s+(?:karo|kar\s*do|kariye|kijiye|please|pls|zara|jara|na|do|de|dijiye|search|results?))+\s*$/i, '')
    .replace(/^["'“”]+|["'“”]+$/g, '')
    .trim();

  // "<site> pe <q> search karo" · "search <q> on <site>" · "<q> <site> pe search karo"
  function parseSearch(clause) {
    const c = String(clause || '').replace(/\bgoogle\s+chrome\b/gi, 'chrome');
    const low = c.toLowerCase();
    if (!SEARCH_VERB.test(low)) return null;
    const SV = String.raw`(?:search|dhoond\w*|dhund\w*|khoj\w*|find|look\s*up|chala\w*|play|bajao|baja\s*do|sun\w*|dekh\w*)`;
    const S = `(${SITE_ALT})`;
    let m = c.match(new RegExp(String.raw`\b${S}\s+(?:pe|par|pr|me|mein|main|on|in)\s+(.+?)\s+${SV}\b`, 'i'));
    if (m) return mkSearch(m[1], m[2]);
    m = c.match(new RegExp(String.raw`\b${SV}\s+(?:for\s+|karo\s+|kar\s+do\s+)?(.+?)\s+(?:on|in|at|par|pe)\s+${S}\b`, 'i'));
    if (m) return mkSearch(m[2], m[1]);
    m = c.match(new RegExp(String.raw`^(.+?)\s+${S}\s+(?:pe|par|pr|me|mein|on)\s+${SV}\b`, 'i'));
    if (m) return mkSearch(m[2], m[1]);
    m = c.match(new RegExp(String.raw`\b${S}\s+(?:search|khojo|pe\s+search)\s+(?:karo\s+|kar\s+do\s+)?(.+)$`, 'i'));
    if (m) return mkSearch(m[1], m[2]);
    return null;
  }
  function mkSearch(siteWord, q) {
    const site = siteFor(siteWord);
    const query = cleanQuery(q);
    if (!site || !query || query.length > 200) return null;
    return { type: 'search-web', site: site.key, query };
  }

  function parseScroll(clause) {
    const t = norm(clause);
    const hasScroll = SCROLL_WORD.test(t);
    const hasDir = /\b(neeche|niche|nichey|upar|oopar|upper|down|up|top|bottom)\b/.test(t);
    if (!hasScroll && !(hasDir && /\b(website|site|web\s*page|webpage|browser)\b/.test(t) && /\b(karo|kar\s*do|jao|le\s*jao|chalo)\b/.test(t))) return null;
    const direction = /\b(sabse\s+upar|top|shuru)\b/.test(t) ? 'top'
      : /\b(sabse\s+neeche|bottom|aakhir|end\s+tak)\b/.test(t) ? 'bottom'
        : /\b(upar|oopar|upper|up|page\s*up)\b/.test(t) ? 'up' : 'down';
    const n = t.match(/\b(\d{1,2})\s*(?:baar|bar|times|pages?|page)\b/);
    const pages = n ? Math.min(20, Number(n[1])) : /\b(thoda|thodi|little|bit|halka)\b/.test(t) ? 1 : /\b(bahut|zyada|jyada|poora|pura|lot)\b/.test(t) ? 5 : 2;
    const explicit = /\b(website|web\s*site|site|web\s*page|webpage|browser|chrome|edge|firefox|youtube|us\s+page)\b/.test(t);
    return { type: 'scroll', direction, pages, explicit };
  }

  function parseKey(clause) {
    const t = norm(clause);
    if (!KEY_VERB.test(t) && !/\b(enter|tab|escape|esc)\s+(?:key\s+)?(?:press|dabao|daba\s*do)\b/.test(t)) return null;
    const combo = t.match(/\b((?:(?:ctrl|control|alt|shift)\s*[+\s]\s*)+[a-z0-9]{1,9})\b/);
    if (combo) {
      const keys = combo[1].replace(/\s*[+\s]\s*/g, '+');
      if (keyToSendKeys(keys)) return { type: 'hotkey', keys };
    }
    const k = t.match(/\b(enter|return|tab|esc|escape|space|backspace|delete|page\s*down|page\s*up|home|end|up|down|left|right|f\d{1,2})\b/);
    if (!k) return null;
    return { type: 'key', key: k[1].replace(/\s+/g, '') };
  }

  const FOLDERS = { download: 'shell:Downloads', downloads: 'shell:Downloads', document: 'shell:Personal', documents: 'shell:Personal', desktop: 'shell:Desktop', pictures: 'shell:My Pictures', photos: 'shell:My Pictures', music: 'shell:My Music', video: 'shell:My Video', videos: 'shell:My Video' };
  function parseFolder(t) {
    const f = t.match(/\b(downloads?|documents?|desktop|pictures|photos|music|videos?)\s+(?:folder|directory)\b/);
    if (f) return { target: FOLDERS[f[1]], label: `${cap(f[1])} folder` };
    const d = t.match(/\b([a-z])\s*drive\b/);
    if (d && d[1] !== 'a' && d[1] !== 'b') return { target: `${d[1].toUpperCase()}:\\`, label: `${d[1].toUpperCase()} drive` };
    return null;
  }

  // One clause → steps (null when it isn't an action we know).
  function parseClause(clause, opts = {}) {
    const P = PC();
    const t = norm(clause);
    if (!t) return null;
    const search = parseSearch(clause);
    if (search) {
      // "chrome me youtube pe … search karo" names the browser too.
      const browser = P?.matchApps(t).find((a) => a.app.browser);
      return browser ? [{ type: 'open', app: browser.key }, search] : [search];
    }
    const scroll = parseScroll(clause);
    if (scroll) return [scroll];
    const key = parseKey(clause);
    if (key) return [key];
    const w = t.match(WAIT_RE);
    if (w && t.split(' ').length <= 5) return [{ type: 'wait', ms: Math.min(8000, Math.max(300, Number(w[1] || w[2] || 2) * 1000)) }];
    const apps = P ? P.matchApps(t) : [];
    if (OPEN_VERB.test(t) || (GO_VERB.test(t) && (apps.length || URL_RE.test(t)))) {
      if (apps.length) return apps.map((a) => ({ type: 'open', app: a.key }));
      const folder = parseFolder(t);
      if (folder) return [{ type: 'open-url', url: folder.target, label: folder.label, local: true }];
      const url = extractUrl(clause);
      if (url) return [{ type: 'open-url', url }];
      const site = Object.values(SEARCH_SITES).find((s) => (s.key === 'google' ? /\bgoogle\b/.test(t) : s.re.test(t)));
      if (site) return [{ type: 'open-url', url: site.home, label: site.label }];
      if (opts.allowGeneric) {
        const target = t.replace(OPEN_VERB, ' ').replace(/\b(please|zara|jara|na|app|application|ko|mera|meri|mere)\b/g, ' ').replace(/\s+/g, ' ').trim();
        if (target && target.split(' ').length <= 4) return [{ type: 'open', app: target, generic: true }];
      }
    }
    if (GO_VERB.test(t) && apps.length) return [{ type: 'focus', app: apps[0].key }];
    return null;
  }

  // Split off "…likho <text>" / "<app> me <text> likho" — the text is taken
  // verbatim (original case), never split on "aur".
  const TRAIL_SAVE = /\s+(?:aur|and|phir|then|fir)\s+(?:(?:use|ise|isko|file)\s+)?save\s*(?:karo|kar\s*do|kar\s*dena|kardo|it|this|bhi\s*karo)?\s*[.!]?$/i;
  const TRAIL_ENTER = /\s+(?:aur|and|phir|then|fir)\s+(?:enter\s*(?:dabao|daba\s*do|press\s*karo)|press\s+enter|hit\s+enter|bhej\s*do|send\s*(?:it|karo)?)\s*[.!]?$/i;
  function splitTypePayload(raw) {
    const s = String(raw || '').trim().replace(/[.!]+$/, '');
    const P = PC();
    if (!P) return null;
    const endRe = new RegExp(String.raw`^([\s\S]*?\b(?:me|mein|main|mai|par|pe|pr|usme|usmein|isme|ismein|in|on)\s+)([\s\S]+?)\s+(?:${TYPE_VERB})(?:\s+(?:do|de|dijiye|please|na))?\s*$`, 'i');
    let m = s.match(endRe);
    if (m && P.matchApp(m[1]) && !TYPE_AT.test(m[1])) return finishPayload(m[1], m[2]);
    const at = new RegExp(String.raw`(?:${TYPE_VERB})\b\s*(?:ki\s+|ke\s+|that\s+|[:\-–—]\s*)?`, 'i');
    m = at.exec(s);
    if (!m) return null;
    const verbatim = /[:\-–—]\s*$/.test(m[0]) || /^\s*["'“]/.test(s.slice(m.index + m[0].length));
    // "notepad kholo aur ek leave application likho" — verb last, the text
    // is the clause right before it.
    if (!s.slice(m.index + m[0].length).trim()) {
      const parts = s.slice(0, m.index).trim().split(CONNECTOR).filter(Boolean);
      if (parts.length >= 2) { const body = parts.pop(); return finishPayload(parts.join(' aur '), body, false); }
    }
    return finishPayload(s.slice(0, m.index), s.slice(m.index + m[0].length), verbatim);
  }
  function finishPayload(prefix, payload, verbatim) {
    const trailing = [];
    let body = String(payload || '').trim();
    for (let i = 0; i < 2; i++) {
      if (TRAIL_SAVE.test(body)) { body = body.replace(TRAIL_SAVE, ''); trailing.unshift({ type: 'hotkey', keys: 'ctrl+s' }); }
      if (TRAIL_ENTER.test(body)) { body = body.replace(TRAIL_ENTER, ''); trailing.unshift({ type: 'key', key: 'enter' }); }
    }
    // "likho hello world notepad me" / "type hello in word" — the app named
    // at the end (only with in/on or me/par, so "likho hello chrome" stays text).
    let tailApp = null;
    const P = PC();
    if (!String(prefix || '').trim()) {
      const words = body.split(/\s+/);
      for (let n = 2; n <= Math.min(4, words.length - 1); n++) {
        const tail = words.slice(-n).join(' ');
        if (!/^(?:in|on)\s/i.test(tail) && !/\s(?:me|mein|main|par|pe)$/i.test(tail)) continue;
        const core = tail.replace(/^(?:in|on)\s+/i, '').replace(/\s+(?:me|mein|main|par|pe)$/i, '');
        const a = P?.matchApp(core);
        if (a && norm(core) === norm(a.said)) { tailApp = a.key; body = words.slice(0, -n).join(' '); break; }
      }
    }
    body = body.trim().replace(/[,;:\s]+$/, '').replace(/^["'“”]+|["'“”]+$/g, '').trim();
    return {
      prefix: String(prefix || '').replace(/\s*\b(and|aur|then|phir|fir|&)\s*$/i, '').trim(),
      payload: body, trailing, tailApp, verbatim: Boolean(verbatim),
    };
  }

  // "ek leave application", "a poem about rain" → write it, don't type the
  // instruction itself. A colon or quotes after the verb means verbatim.
  const COMPOSE_RE = /^(?:(?:ek|a|an|one|koi|mere\s+liye|meri|mera|apni|hamari)\s+)?(?:(?:short|chhota|chhoti|choti|formal|professional|achha|acchi|accha|sundar|nice|simple|detailed|quick|polite|romantic|funny|motivational)\s+)*(?:poem|kavita|shayari|email|e-mail|mail|letter|application|leave\s+application|essay|story|kahani|paragraph|summary|to-?do\s+list|article|report|description|bio|post|caption|speech|quotation|proposal|agenda|invoice|resume|cv|script|joke|quote|message|msg)\b/i;
  const needsCompose = (payload, verbatim) => !verbatim && COMPOSE_RE.test(String(payload || '').trim());

  // Clauses on "aur / and / phir / ,". A chunk with no verb of its own is
  // glued to its neighbour ("chrome aur notepad kholo", "search X and Y on
  // youtube"); `extra` keeps that glued text so the planner can tell when a
  // step silently ignored part of what he said.
  function splitClauses(prefix) {
    const parts = String(prefix || '').split(CONNECTOR).map((p) => p.trim()).filter(Boolean);
    const out = [];
    let pending = '';
    const acts = (c) => OPEN_VERB.test(norm(c)) || GO_VERB.test(norm(c)) || SEARCH_VERB.test(norm(c)) || SCROLL_WORD.test(norm(c)) || KEY_VERB.test(norm(c)) || WAIT_RE.test(norm(c));
    for (const p of parts) {
      if (!acts(p)) { pending = pending ? `${pending} aur ${p}` : p; continue; }
      out.push({ text: pending ? `${pending} aur ${p}` : p, extra: pending });
      pending = '';
    }
    if (pending) {
      if (out.length) { const last = out[out.length - 1]; last.text += ` aur ${pending}`; last.extra = last.extra ? `${last.extra} aur ${pending}` : pending; }
      else out.push({ text: pending, extra: '' });
    }
    return out;
  }
  // Glued text that is only app names / filler ("chrome aur notepad") is fine;
  // anything else ("usme A1 me 500") was ignored by a key/scroll/open step.
  function ignoredText(extra, steps) {
    if (!extra) return false;
    if (steps.some((s) => s.type === 'search-web' || s.type === 'type')) return false;
    let rest = norm(extra);
    (PC()?.matchApps(rest, { loose: true }) || []).forEach((a) => { rest = rest.replace(a.said, ' '); });
    rest = rest.replace(/\b(aur|and|bhi|also|phir|then|ko|me|mein|pe|par|please|zara)\b/g, ' ').trim();
    return rest.length > 0;
  }

  // The local planner. Returns { kind:'plan', steps, priority, contextual,
  // complex } — or null when this isn't a PC/website action it knows.
  function planLocal(raw, opts = {}) {
    const P = PC();
    if (!P) return null;
    const t = norm(raw);
    const ty = splitTypePayload(raw);
    const steps = [];
    let unparsed = 0;
    let typeTarget = null;
    const clauses = splitClauses(ty ? ty.prefix : raw);
    for (const { text: c, extra } of clauses) {
      const st = parseClause(c, { allowGeneric: Boolean(ty) || clauses.length > 1 || opts.allowGeneric });
      if (st) { steps.push(...st); if (ignoredText(extra, st)) unparsed++; continue; }
      const a = ty ? P.matchApp(c) : null;          // "word me" — a target, no verb
      if (a) { typeTarget = a.key; continue; }
      unparsed++;
    }
    if (ty) {
      if (!ty.payload) {
        const target = ty.tailApp || typeTarget || [...steps].reverse().find((s) => s.type === 'open' && s.app)?.app;
        if (!target) return null;
        return { kind: 'ask', priority: true, spoken: `Kya likhun, sir? Jaise "${P.appFor(target)?.label || target} me likho: kal 5 baje meeting".` };
      }
      if (/\?\s*$/.test(String(raw)) || /\b(kya|kaise|kyun|kyu|what|how|why)\s*(hai|hain|ho|is|are)?\s*$/.test(t)) return null;
      const target = ty.tailApp || typeTarget || [...steps].reverse().find((s) => (s.type === 'open' || s.type === 'focus') && s.app)?.app;
      if (!target) return null;
      if (!steps.some((s) => s.type === 'open' && s.app === target)) steps.push({ type: 'open', app: target, reuse: true });
      steps.push({ type: 'focus', app: target });
      steps.push({ type: 'type', app: target, text: ty.payload, compose: needsCompose(ty.payload, ty.verbatim) });
      steps.push(...ty.trailing);
    }
    if (!steps.length) return null;
    const catalogApp = steps.some((s) => s.app && !s.generic && P.APPS[s.app]);
    const single = steps.length === 1 ? steps[0] : null;
    if (single && single.type === 'open' && single.generic && !opts.allowGeneric) return null;  // route step 5 owns "X kholo"
    const plan = { kind: 'plan', steps, complex: unparsed > 0, priority: false, contextual: false };
    if (single && single.type === 'scroll') {
      plan.priority = single.explicit;
      plan.contextual = !single.explicit;
    } else if (single && (single.type === 'search-web' || single.type === 'open-url' || single.type === 'key' || single.type === 'wait')) {
      plan.priority = false;   // the other routers already do these well
      if (single.type === 'key' || single.type === 'wait') return null;
    } else {
      plan.priority = catalogApp || steps.length >= 2 || steps.some((s) => s.type === 'type');
    }
    return plan;
  }

  // "is website ke baare me batao" · "brief me about stripe.com" ·
  // "show me about this website" · "is site ka overview do"
  const BRIEF_VERB = /\b(?:ke|ki|ka)\s+(?:baare|bare|baarey)\s+(?:me|mein|main|mai|mei)\b|\babout\b|\bbrief\b|\boverview\b|\bsummar(?:y|ise|ize)\b|\banaly[sz](?:e|is)\b|\breview\b|\bexplain\b|\bsamjhao\b|\bsamjha\s+do\b|\bdetails?\b|\bjaankari\b|\bjankari\b|\bkya\s+(?:karti|karta|karte|bechti|bechte|offer)\b|\bwhat\s+(?:is|does)\b|\btell\s+me\b|\binsights?\b|\bbreakdown\b/;
  const SHOW_VERB = /\b(dikhao|dikha\s*do|show)\b/;
  const THIS_SITE = /\b(?:is|iss|ye|yeh|this|current|isi|us|is\s+wali|ye\s+wali|abhi\s+wali|khuli\s+hui|open)\s+(?:website|web\s*site|site|web\s*page|webpage)\b/;
  const THIS_PAGE = /\b(?:is|iss|ye|yeh|this|current|isi|us)\s+(?:page|tab)\b/;
  function parseBrief(raw) {
    const t = norm(raw);
    if (t.length > 240) return null;
    if (OPEN_VERB.test(t.replace(/\bshow\b/g, '')) && !/\b(batao|bataiye|brief|overview|summar\w*|analy[sz]\w*|review)\b/.test(t)) return null;  // "about us page kholo" opens it
    const url = extractUrl(raw);
    const briefish = BRIEF_VERB.test(t) || SHOW_VERB.test(t);
    if (url && briefish && !OPEN_VERB.test(t.replace(/\bshow\b/, ''))) return { kind: 'brief', url, priority: true };
    if (!BRIEF_VERB.test(t) && !(SHOW_VERB.test(t) && /\b(about|overview|brief)\b/.test(t))) return null;
    // "stripe ki website ke baare me batao" — a named site without a TLD.
    const named = t.match(/\b([a-z][a-z0-9-]{1,30})\s+(?:ki|ka|ke|ki\s+official)\s+(?:website|web\s*site|site)\b/);
    if (named && !/^(is|iss|ye|yeh|us|apni|meri|mera|hamari|kis|kaunsi|kisi|company|kampani|firm|business|hotel|unki|inki|uski|iski|client|lead|office|agency|official)$/.test(named[1])) {
      const alias = PC()?.resolveWebTarget?.(named[1]);
      return { kind: 'brief', url: alias || `https://${named[1]}.com`, guessed: !alias, priority: true };
    }
    if (THIS_SITE.test(t) || /^(?:website|site)\s+(?:ke|ka|ki)\b/.test(t) || /\b(?:about|brief|overview)\s+(?:the\s+)?(?:website|site)\b/.test(t)) return { kind: 'brief', url: '', priority: true };
    if (THIS_PAGE.test(t)) return { kind: 'brief', url: '', contextual: true };
    return null;
  }

  // "notepad band karo" · "close chrome" — only apps he NAMES.
  function parseClose(raw) {
    const t = norm(raw);
    if (!CLOSE_VERB.test(t) || OPEN_VERB.test(t) || TYPE_AT.test(raw)) return null;
    // "chrome ka tab band karo" / "spotify ka gaana band karo" aren't "quit the app".
    if (/\b(tabs?|gaana|gaane|song|songs|music|video|awaaz|awaz|sound|volume|notification|notifications|popup)\b/.test(t)) return null;
    const P = PC();
    const apps = P ? P.matchApps(t) : [];
    if (!apps.length) return null;                   // "close everything" etc. are not ours
    return { kind: 'close', apps: apps.map((a) => a.key), priority: true };
  }

  function parse(raw, opts = {}) {
    const text = String(raw || '').trim();
    const t = norm(text);
    if (!t || t.length > 1200 || !PC()) return null;
    if (NEVER_RE.test(t) || GIVE_RE.test(t)) return null;           // screenshot / prompt-master flows
    if (window.ClavisPromptMaster?.isMatch?.(text)) return null;
    if (ALL_RE.test(t) && CLOSE_VERB.test(t) && !PC().matchApps(t).length) return null;  // lead's clavis-intent.js
    return parseBrief(text) || parseClose(text) || planLocal(text, opts);
  }

  // Does this sound like PC automation the local planner couldn't place?
  function looksLikeAutomation(raw) {
    const t = norm(raw);
    if (!t || t.length > 400 || NEVER_RE.test(t)) return false;
    if (/\b(leads?|candidates?|contacts?|companies|clients?|prospects?)\b/.test(t)) return false;
    const thing = (PC()?.matchApps(t).length) || /\b(pc|computer|laptop|desktop|browser|tab|window|chrome)\b/.test(t);
    const act = OPEN_VERB.test(t) || TYPE_AT.test(t) || KEY_VERB.test(t) || SCROLL_WORD.test(t) || /\b(new\s+tab|naya\s+tab|save\s+karo|minimi[sz]e|maximi[sz]e)\b/.test(t);
    return Boolean(thing && act);
  }

  // ── LLM planner (JSON only, allow-listed steps) ─────────────
  const STEP_TYPES = ['open', 'focus', 'wait', 'type', 'key', 'hotkey', 'scroll', 'search-web', 'open-url'];
  function validatePlan(obj, request) {
    const P = PC();
    // A model may "helpfully" add Alt+F4 / Ctrl+W: closing shortcuts only
    // survive when he himself asked to close something (and still get a yes).
    const askedToClose = CLOSE_VERB.test(norm(request || '')) && !ALL_RE.test(norm(request || ''));
    const raw = Array.isArray(obj) ? obj : obj?.steps;
    if (!Array.isArray(raw)) return null;
    const steps = [];
    const safeName = (v) => String(v || '').replace(/[^\w .+#-]/g, '').trim().slice(0, 40);
    for (const s of raw.slice(0, 8)) {
      if (!s || typeof s !== 'object' || !STEP_TYPES.includes(s.type)) continue;
      if (s.type === 'open' || s.type === 'focus') {
        const name = safeName(s.app);
        if (!name) continue;
        const a = P?.appFor(name);
        steps.push({ type: s.type, app: a ? a.key : name.toLowerCase(), generic: !a });
      } else if (s.type === 'open-url') {
        const u = String(s.url || '').trim();
        if (!/^https?:\/\/[^\s"'<>]+$/i.test(u) || u.length > 2000) continue;
        steps.push({ type: 'open-url', url: u });
      } else if (s.type === 'search-web') {
        const site = SEARCH_SITES[String(s.site || 'google').toLowerCase()] ? String(s.site || 'google').toLowerCase() : 'google';
        const query = String(s.query || '').trim().slice(0, 200);
        if (!query) continue;
        steps.push({ type: 'search-web', site, query });
      } else if (s.type === 'wait') {
        steps.push({ type: 'wait', ms: Math.min(8000, Math.max(100, Number(s.ms) || 1000)) });
      } else if (s.type === 'type') {
        const text = String(s.text ?? '').slice(0, 4000);
        if (!text) continue;
        steps.push({ type: 'type', text });
      } else if (s.type === 'key') {
        const key = String(s.key || '').toLowerCase().replace(/[\s_-]/g, '');
        if (!KEYS[key] || (RISKY_KEYS.test(key) && !askedToClose)) continue;
        steps.push({ type: 'key', key });
      } else if (s.type === 'hotkey') {
        const keys = String(s.keys || '').toLowerCase().replace(/\s+/g, '');
        if (!keyToSendKeys(keys) || (RISKY_KEYS.test(keys) && !askedToClose)) continue;
        steps.push({ type: 'hotkey', keys });
      } else if (s.type === 'scroll') {
        const direction = ['down', 'up', 'top', 'bottom'].includes(s.direction) ? s.direction : 'down';
        steps.push({ type: 'scroll', direction, pages: Math.min(20, Math.max(1, Number(s.pages) || 2)), explicit: true });
      }
    }
    if (!steps.length) return null;
    return { kind: 'plan', steps, priority: true, ai: true, summary: String(obj?.summary || '').slice(0, 160) };
  }
  function extractJson(text) {
    const s = String(text || '').replace(/```(?:json)?/gi, '');
    const a = s.indexOf('{'), b = s.lastIndexOf('}');
    if (a < 0 || b <= a) return null;
    try { return JSON.parse(s.slice(a, b + 1)); } catch (_) { return null; }
  }
  async function planWithAI(raw) {
    if (!window.ClavisDirect?.hasKey?.()) return null;
    const apps = Object.keys(PC()?.APPS || {}).join(', ');
    const sys = [
      'You turn ONE request into a short plan of Windows PC automation steps for Clavis. Reply with JSON ONLY, no prose, no markdown:',
      '{"steps":[ ... ],"summary":"<one short Hinglish line of what you will do>"}',
      'Allowed step objects — nothing else exists (no mouse clicks):',
      `{"type":"open","app":"<name>"}  known apps: ${apps}; any other installed app by its plain name`,
      '{"type":"open-url","url":"https://..."}',
      `{"type":"search-web","site":"<${Object.keys(SEARCH_SITES).join('|')}>","query":"..."}`,
      '{"type":"focus","app":"<name>"}  bring that app\'s window to the front',
      '{"type":"wait","ms":1500}',
      '{"type":"type","text":"..."}  types into the focused window',
      '{"type":"key","key":"enter|tab|esc|pagedown|pageup|home|end|up|down|left|right|backspace|f1..f12"}',
      '{"type":"hotkey","keys":"ctrl+s"}  ctrl/alt/shift + one key',
      '{"type":"scroll","direction":"down|up|top|bottom","pages":2}',
      'Rules: at most 8 steps; open before typing into an app; never close apps, delete anything, or send/submit a message or form unless the user explicitly asked for exactly that.',
      'If the request is not a PC / app / website action, reply {"steps":[]}.',
    ].join('\n');
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 12000);
    try {
      const data = await window.ClavisDirect.complete({
        messages: [{ role: 'system', content: sys }, { role: 'user', content: String(raw).slice(0, 600) }],
        max_tokens: 500, temperature: 0,
      }, ctrl.signal);
      return validatePlan(extractJson(data?.choices?.[0]?.message?.content), raw);
    } catch (err) {
      console.warn('[ClavisAutomation] AI planner:', err?.message || err);
      return null;
    } finally { clearTimeout(timer); }
  }

  // Write the thing he asked for ("ek leave application") before typing it.
  async function composeText(request, appLabel) {
    if (!window.ClavisDirect?.hasKey?.()) return null;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 25000);
    try {
      const data = await window.ClavisDirect.complete({
        messages: [
          { role: 'system', content: `Write exactly what the user asks for, ready to be typed into ${appLabel || 'a document'}. Plain text only: no markdown, no quotes around it, no preamble or sign-off notes. Formal documents (emails, letters, applications) in clear English unless he asks otherwise; casual things in his own language (Hinglish is fine). Keep it reasonably short.` },
          { role: 'user', content: String(request).slice(0, 800) },
        ], max_tokens: 700, temperature: 0.6,
      }, ctrl.signal);
      const out = String(data?.choices?.[0]?.message?.content || '').replace(/^```\w*\n?|```$/g, '').trim();
      return out || null;
    } catch (_) { return null; } finally { clearTimeout(timer); }
  }

  // ── Safety: one-line yes before anything that closes or sends ──
  // Same boundary as JarvisSkills' risk gate (ClavisMind.safety): the tool's
  // risk level against the owner's configured threshold, then clavisConfirm.
  async function confirmRisky(toolName, args, line) {
    const safety = window.ClavisMind?.safety;
    let level = 3, threshold = 3;
    try { if (safety?.assess) level = safety.assess(toolName, args || {}); } catch (_) {}
    try { if (safety?.threshold) threshold = safety.threshold(); } catch (_) {}
    if (level < threshold) return true;
    const ask = window.clavisConfirm || ((m) => Promise.resolve(window.confirm(m)));
    try {
      window.ClavisMind?.emit?.({ type: 'safety.confirmation_required', source: 'tool', importance: 0.85, metadata: { tool: toolName, riskLevel: level } });
      const ok = Boolean(await ask(line, { title: 'Pakka, sir?', okLabel: 'Haan', cancelLabel: 'Nahi', danger: level >= 4 }));
      window.ClavisMind?.emit?.({ type: 'safety.confirmation_resolved', source: 'tool', importance: 0.4, metadata: { tool: toolName, approved: ok } });
      return ok;
    } catch (_) { return false; }
  }

  // ── Progress (ClavisTask) ────────────────────────────────────
  // Typed turns already have a task (jarvis_ui.js began it with this text)
  // — reuse it and let the caller complete it. Voice turns get our own.
  function taskFor(raw) {
    const T = window.ClavisTask;
    if (!T?.begin) return { id: null, mine: false };
    try {
      const cur = T.current?.();
      if (cur && cur._text === String(raw) && Date.now() - cur.startedAt < 5000 && cur.phase !== 'completed' && cur.phase !== 'failed') return { id: cur.id, mine: false };
      const id = T.begin(String(raw), { source: 'voice' });
      const t = T.Store?.get?.(id);
      if (t) t.display = 'voice';        // a desktop action is a glance, not a document
      return { id, mine: true };
    } catch (_) { return { id: null, mine: false }; }
  }
  function progress(task, label) {
    try { if (task?.id) window.ClavisTask.event(task.id, { type: 'executing', label }); } catch (_) {}
    try { window.setJarvisStatus?.('thinking', label); } catch (_) {}
  }
  function finishTask(task, result) {
    if (!task?.mine || !task.id) return;
    try {
      const T = window.ClavisTask;
      const t = T.Store?.get?.(task.id);
      if (t && result.display === 'window') t.display = 'window';
      T.complete(task.id, { type: 'answer', text: result.text || result.spoken || 'Done', summary: result.spoken || '' });
    } catch (_) {}
  }

  // ── Capabilities ─────────────────────────────────────────────
  async function capabilities() {
    const P = PC();
    if (!P) return { bridge: false, control: false };
    let bridge = false;
    try { bridge = await P.ping(); } catch (_) { bridge = false; }
    let control = false;
    if (bridge) { try { control = await P.controlAvailable(); } catch (_) { control = false; } }
    return { bridge, control };
  }

  // ── Executor ─────────────────────────────────────────────────
  // Rewrites the plan for what this machine can do right now, then runs it.
  function adaptPlan(steps, caps) {
    const P = PC();
    const INTERACTIVE = ['scroll', 'type', 'key', 'hotkey'];
    const merged = [];
    for (let i = 0; i < steps.length; i++) {
      const s = { ...steps[i] };
      const next = steps[i + 1];
      const app = s.app ? P.appFor(s.app) : null;
      // A browser opened straight onto the page (one launch, not two) — in its
      // own window when Clavis will keep working on it, so Clavis's window
      // is never the one being scrolled or typed into.
      if (s.type === 'open' && app?.browser && next && (next.type === 'search-web' || (next.type === 'open-url' && !next.local))) {
        const interactive = steps.slice(i + 2).some((x) => INTERACTIVE.includes(x.type));
        merged.push({ ...s, url: urlOf(next), via: next, newWindow: interactive });
        i++;
        continue;
      }
      merged.push(s);
    }
    // Something was just opened and the next step acts on it: wait for its
    // window and bring it to the front first.
    const out = [];
    merged.forEach((s, i) => {
      out.push(s);
      const next = merged[i + 1];
      const opened = s.type === 'open' || ((s.type === 'open-url' || s.type === 'search-web') && !s.local);
      if (opened && next && ['scroll', 'key', 'hotkey'].includes(next.type)) {
        out.push({ type: 'focus', app: s.type === 'open' ? s.app : null });
        out.push({ type: 'wait', ms: 1800 });
      }
    });
    // Typing into Notepad: a fresh, already-named file, so nothing he had open
    // is ever typed over. No control → the bridge's /notepad (save + open),
    // or a download + clipboard copy with the bridge off.
    const typeIdx = out.findIndex((s) => s.type === 'type');
    if (typeIdx >= 0 && P.appFor(out[typeIdx].app || '')?.key === 'notepad') {
      const typeStep = out[typeIdx];
      const isNotepadOpen = (s) => (s.type === 'open' || s.type === 'focus') && P.appFor(s.app || '')?.key === 'notepad';
      const before = out.slice(0, typeIdx).filter((s) => !isNotepadOpen(s));
      const after = out.slice(typeIdx + 1);
      if (caps.control) return [...before, { type: 'open', app: 'notepad', freshFile: true }, { type: 'focus', app: 'notepad' }, typeStep, ...after];
      return [...before, { type: 'note', text: typeStep.text, compose: typeStep.compose }];
    }
    return out;
  }
  function urlOf(step) {
    if (step.type === 'search-web') return (SEARCH_SITES[step.site] || SEARCH_SITES.google).url(step.query);
    return step.url;
  }

  async function runPlan(plan, ctxIn = {}) {
    const P = PC();
    const caps = ctxIn.caps || await capabilities();
    const ctx = { caps, results: [], app: null, window: null, before: null, webFallback: false, raw: ctxIn.raw || '', task: ctxIn.task || null };
    const steps = adaptPlan(plan.steps || [], caps);
    for (let i = 0; i < steps.length; i++) {
      const step = steps[i];
      progress(ctx.task, stepLabel(step));
      let r;
      try { r = await withTimeout(runStep(step, ctx, steps.slice(i + 1)), stepBudget(step), stepLabel(step)); }
      catch (err) { r = { ok: false, say: `${stepNoun(step)} nahi ho paya (${err?.message || err})` }; }
      ctx.results.push({ step, ...r });
      if (r && r.stop) break;
      if (r && r.ok === false && r.fatal !== false && step.type !== 'wait') {
        // Stopped before typing? Don't lose his text — it goes to the clipboard.
        const pending = steps.slice(i + 1).find((x) => x.type === 'type' && !x.compose);
        if (pending) {
          const copied = await P.copyText(pending.text).catch(() => false);
          if (copied) r.say += ' — text clipboard me copy kar diya, Ctrl+V dabaiye';
        }
        break;
      }
    }
    return ctx;
  }
  function stepBudget(step) {
    if (step.type === 'type') return 90000;                 // compose + long text
    if (step.type === 'focus') return 35000;                // Office cold start
    if (step.type === 'open' || step.type === 'note') return 30000;
    return 20000;
  }
  function stepLabel(step) {
    const P = PC();
    const label = step.app ? (P.appFor(step.app)?.label || step.app) : 'Window';
    switch (step.type) {
      case 'open': return step.url ? `${label} me page khol raha hoon` : `${label} khol raha hoon`;
      case 'focus': return `${label} ki window saamne la raha hoon`;
      case 'type': return step.compose ? 'Likhne ke liye text bana raha hoon' : 'Likh raha hoon';
      case 'note': return 'Notepad me likh raha hoon';
      case 'search-web': return `${SEARCH_SITES[step.site]?.label || 'Web'} pe search kar raha hoon`;
      case 'open-url': return `${step.label || hostOf(step.url)} khol raha hoon`;
      case 'scroll': return 'Scroll kar raha hoon';
      case 'key': case 'hotkey': return `${step.key || step.keys} daba raha hoon`;
      case 'wait': return 'Ek second…';
      default: return 'Kaam kar raha hoon';
    }
  }

  // "Excel kholna nahi ho paya (…)" — for failures.
  function stepNoun(step) {
    const P = PC();
    const label = step.app ? (P.appFor(step.app)?.label || step.app) : '';
    switch (step.type) {
      case 'open': return `${label} kholna`;
      case 'focus': return `${label || 'Window'} ko saamne laana`;
      case 'type': return 'Likhna';
      case 'note': return 'Notepad me likhna';
      case 'search-web': return 'Search';
      case 'open-url': return `${step.label || hostOf(step.url)} kholna`;
      case 'scroll': return 'Scroll';
      case 'key': case 'hotkey': return `${step.key || step.keys} dabana`;
      default: return 'Ye step';
    }
  }

  async function runStep(step, ctx, rest) {
    switch (step.type) {
      case 'open': return doOpen(step, ctx, rest);
      case 'focus': return doFocus(step, ctx);
      case 'wait': await sleep(step.ms || 1000); return { ok: true };
      case 'type': return doType(step, ctx, rest);
      case 'note': return doNote(step, ctx);
      case 'key': case 'hotkey': return doKey(step, ctx);
      case 'scroll': return doScroll(step, ctx);
      case 'search-web': case 'open-url': return doOpenUrl(step, ctx, rest);
      default: return { ok: false, say: 'ye step samajh nahi aaya' };
    }
  }

  async function snapshotWindows(ctx) {
    if (!ctx.caps.control) return null;
    try { return new Set((await PC().listWindows()).map((w) => String(w.handle))); } catch (_) { return null; }
  }

  async function doOpen(step, ctx, rest) {
    const P = PC();
    const app = P.appFor(step.app);
    const label = app?.label || cap(step.app);
    ctx.app = app || { label, key: step.app, re: new RegExp(`\\b${String(step.app).replace(/[^\w ]/g, '')}\\b`, 'i'), proc: [] };
    ctx.window = null;
    ctx.webFallback = false;
    // Notepad for typing: an empty, named file → a window we can find for sure.
    if (step.freshFile) {
      const stamp = new Date().toTimeString().slice(0, 8).replace(/:/g, '-');
      ctx.expectTitle = `Clavis Note ${stamp}`;
      ctx.before = await snapshotWindows(ctx);
      await P.saveNote('', `${ctx.expectTitle}.txt`);
      return { ok: true, say: `${label} khola`, kind: 'open', label };
    }
    ctx.expectTitle = null;
    // "word me likho" — his Word window already open? Use it.
    if (step.reuse && ctx.caps.control && app) {
      try {
        const wins = await P.findWindows(app.key, { skipClavis: app.browser });
        if (wins.length) { ctx.window = wins[0]; ctx.before = null; return { ok: true, kind: 'reuse', label }; }
      } catch (_) { /* fall through to launching */ }
    }
    ctx.before = await snapshotWindows(ctx);
    const r = await P.launchApp(step.app, { url: step.url, newWindow: step.newWindow });
    if (step.url) rememberSite(step.url);
    if (!r.ok) {
      if (r.needsBridge) return { ok: false, say: `${label} kholne ke liye PC bridge chahiye — Start-Bridge.bat chala dijiye`, kind: 'open', label };
      return { ok: false, say: `${label} is PC pe install nahi mila`, kind: 'open', label };
    }
    ctx.webFallback = Boolean(r.web);
    const what = step.via?.type === 'search-web'
      ? `${label} me ${SEARCH_SITES[step.via.site]?.label} pe "${step.via.query}" search kar diya`
      : step.via ? `${label} me ${hostOf(step.url)} khol diya` : `${label} khol diya`;
    if (!r.native) {
      // Already in a browser: a browser "app" is just a new tab here.
      if (app?.browser) return { ok: true, say: step.url ? what.replace(`${label} me `, '') : 'naya tab khol diya', kind: 'open', label, web: true };
      return { ok: true, say: `bridge band hai, isliye ${label} ka web version browser me khol diya`, kind: 'open', label, web: true };
    }
    if (r.notInstalled) return { ok: true, say: `${label} PC pe nahi mila, isliye uska web version khol diya`, kind: 'open', label, web: true };
    return { ok: true, say: what, kind: 'open', label };
  }

  async function findBrowserWindow(ctx) {
    const P = PC();
    const all = await P.listWindows();
    const cands = all.filter((w) => isBrowserProc(w.process) && !P.isClavisTitle(w.title));
    const fresh = ctx.before ? cands.filter((w) => !ctx.before.has(String(w.handle))) : [];
    return fresh[0] || cands[0] || null;
  }

  async function doFocus(step, ctx) {
    const P = PC();
    if (!ctx.caps.control) return { ok: true, skipped: true };
    const app = P.appFor(step.app) || ctx.app;
    const label = app?.label || step.app;
    let w = ctx.window;
    if (!w) {
      if (ctx.webFallback) {
        const deadline = Date.now() + 12000;
        while (!w && Date.now() < deadline) { try { w = await findBrowserWindow(ctx); } catch (_) {} if (!w) await sleep(700); }
      } else {
        const known = Boolean(P.APPS[app?.key]);
        w = await P.waitForWindow(known ? app.key : null, {
          exclude: ctx.before, title: ctx.expectTitle || (known ? undefined : String(app?.label || step.app || '')), skipClavis: Boolean(app?.browser),
          timeoutMs: app?.office ? 30000 : 15000, graceMs: app?.office ? 9000 : 3500,
        });
      }
    }
    if (!w) return { ok: false, say: `${label} ki window nahi mili` };
    ctx.window = w;
    let r = await P.focusWindow({ handle: String(w.handle) }).catch(() => ({ focused: false }));
    if (r.focused === false) { await sleep(500); r = await P.focusWindow({ handle: String(w.handle) }).catch(() => ({ focused: false })); }
    await sleep(350);
    state.lastWindow = { handle: String(w.handle), app: app?.key || step.app, title: w.title, at: Date.now() };
    if (r.focused === false) return { ok: false, say: `${label} ki window saamne nahi aa payi`, fatal: true };
    return { ok: true };
  }

  async function doType(step, ctx, rest) {
    const P = PC();
    const app = P.appFor(step.app || '') || ctx.app;
    const label = app?.label || 'window';
    let text = String(step.text || '');
    if (step.compose) {
      progress(ctx.task, 'Likhne ke liye text bana raha hoon');
      const made = await composeText(text, label);
      if (made) { text = made; ctx.composed = true; } else ctx.composeFailed = true;
    }
    if (!text) return { ok: false, say: 'likhne ko kuch mila nahi' };
    ctx.typedText = text;
    if (!ctx.caps.control) {
      const copied = await P.copyText(text);
      return { ok: true, kind: 'clip', say: copied ? 'text clipboard me copy kar diya — wahan Ctrl+V dabaiye' : 'text copy nahi ho paya (browser ne clipboard block kiya)', copied };
    }
    if (!ctx.window) {
      const f = await doFocus({ type: 'focus', app: app?.key }, ctx);
      if (!f.ok) return clipFallback(text, f.say);
    }
    const handle = String(ctx.window.handle);
    // Office opens on its Start screen (window title is just "Word"/"Excel"):
    // Esc there gives a blank document/workbook.
    if (app?.office && /^(excel|word|powerpoint)$/i.test(String(ctx.window.title || '').trim())) {
      await P.pressKeys('{ESC}').catch(() => {});
      await sleep(1500);
    }
    if (app?.chat || ctx.webFallback) await sleep(1500);           // prompt box / page still loading
    const f = await P.focusWindow({ handle }).catch(() => ({ focused: false }));
    if (f.focused === false) return clipFallback(text, `${label} ki window saamne nahi aa payi`);
    // Line by line: Enter between lines — Shift+Enter in chat apps, where a
    // bare Enter would SEND the message.
    const newline = app?.chat || app?.messaging ? '+{ENTER}' : '{ENTER}';
    const lines = text.replace(/\r\n?/g, '\n').split('\n');
    for (let i = 0; i < lines.length; i++) {
      for (let j = 0; j < lines[i].length; j += 160) await P.typeText(lines[i].slice(j, j + 160));
      if (i < lines.length - 1) await P.pressKeys(newline);
    }
    const willSend = (rest || []).some((s) => s.type === 'key' && /^(enter|return)$/i.test(s.key));
    return { ok: true, kind: 'type', say: app?.chat && !willSend ? 'likh diya — bhejna ho to Enter dabaiye' : 'likh diya', label };
  }
  async function clipFallback(text, why) {
    const copied = await PC().copyText(text).catch(() => false);
    return { ok: false, kind: 'clip', say: `${why} — ${copied ? 'text clipboard me copy kar diya, Ctrl+V dabaiye' : 'text copy bhi nahi ho paya'}` };
  }

  async function doNote(step, ctx) {
    const P = PC();
    let text = String(step.text || '');
    if (step.compose) { const made = await composeText(text, 'Notepad'); if (made) { text = made; ctx.composed = true; } }
    ctx.typedText = text;
    const r = await P.saveNote(text);
    if (r.native) return { ok: true, kind: 'note', say: 'Notepad me likh ke save kar diya', path: r.path };
    const copied = await P.copyText(text).catch(() => false);
    return { ok: true, kind: 'note', say: `bridge band tha, isliye text file download kar di${copied ? ' aur clipboard me bhi copy kar diya' : ''}` };
  }

  async function doKey(step, ctx) {
    const P = PC();
    const combo = step.type === 'hotkey' ? step.keys : step.key;
    const sk = keyToSendKeys(combo);
    if (!sk) return { ok: false, say: `"${combo}" key samajh nahi aayi` };
    if (!ctx.caps.control) return { ok: false, say: 'keys dabane ke liye bridge ka control mode chahiye (Start-Bridge-With-Control.bat)' };
    const app = ctx.app;
    const sends = /^(enter|return)$/i.test(combo) && (app?.messaging || app?.chat);
    if (RISKY_KEYS.test(String(combo).toLowerCase()) || sends) {
      const ok = await confirmRisky('pc_press_key', { keys: combo }, sends ? `${app.label} me message bhej doon (Enter)?` : `${combo} dabaun? Isse window/tab band ho sakta hai.`);
      if (!ok) return { ok: true, say: sends ? 'message nahi bheja, likh ke chhod diya hai' : `${combo} nahi dabaya`, stop: true };
    }
    if (ctx.window) await P.focusWindow({ handle: String(ctx.window.handle) }).catch(() => {});
    await P.pressKeys(sk);
    const said = /^ctrl\+s$/i.test(combo) ? 'save kar diya' : `${combo} daba diya`;
    return { ok: true, say: said };
  }

  async function scrollTarget(ctx) {
    const P = PC();
    if (ctx.window) return ctx.window;
    let fg = null;
    try { fg = await withTimeout(P.activeWindow(), 4000, 'active window'); } catch (_) {}
    if (fg && isBrowserProc(fg.process) && !P.isClavisTitle(fg.title)) return { foreground: true, title: fg.title };
    const wins = await P.listWindows().catch(() => []);
    const last = state.lastWindow && Date.now() - state.lastWindow.at < RECENT_MS && wins.find((w) => String(w.handle) === state.lastWindow.handle);
    if (last) return last;
    return wins.find((w) => isBrowserProc(w.process) && !P.isClavisTitle(w.title)) || null;
  }

  async function doScroll(step, ctx) {
    const P = PC();
    if (!ctx.caps.bridge) return { ok: false, say: 'dusri website scroll karne ke liye PC bridge chahiye — browser se main sirf Clavis ka page scroll kar sakta hoon' };
    if (!ctx.caps.control) return { ok: false, say: 'scroll ke liye bridge ka control mode chahiye (Start-Bridge-With-Control.bat)' };
    const target = await scrollTarget(ctx);
    if (!target) return { ok: false, say: 'kaunsi website scroll karun? Pehle site kholiye' };
    if (target.handle) {
      const r = await P.focusWindow({ handle: String(target.handle) }).catch(() => ({ focused: false }));
      if (r.focused === false) return { ok: false, say: 'website ki window saamne nahi aa payi' };
      await sleep(250);
    }
    const key = { down: '{PGDN}', up: '{PGUP}', top: '^{HOME}', bottom: '^{END}' }[step.direction] || '{PGDN}';
    const times = step.direction === 'top' || step.direction === 'bottom' ? 1 : Math.max(1, Math.min(20, step.pages || 2));
    for (let i = 0; i < times; i++) { await P.pressKeys(key); if (i < times - 1) await sleep(380); }
    const said = { down: 'neeche scroll kar diya', up: 'upar scroll kar diya', top: 'page ke sabse upar le gaya', bottom: 'page ke sabse neeche le gaya' }[step.direction];
    return { ok: true, say: said };
  }

  // Default browser for a page Clavis will keep working on: Chrome, else Edge.
  async function openInBrowser(url, newWindow) {
    const P = PC();
    for (const b of ['chrome', 'edge']) {
      try { const r = await P.launchApp(b, { url, newWindow }); if (r.ok && !r.notInstalled) return { ...r, browser: P.APPS[b] }; } catch (_) {}
    }
    const r = await P.open(url);
    return { ...r, browser: null };
  }

  async function doOpenUrl(step, ctx, rest) {
    const P = PC();
    const url = urlOf(step);
    const interactive = (rest || []).some((s) => ['scroll', 'type', 'key', 'hotkey'].includes(s.type));
    const say = step.type === 'search-web'
      ? `${SEARCH_SITES[step.site]?.label || 'Google'} pe "${step.query}" search kar diya`
      : `${step.label || hostOf(url)} khol diya`;
    if (step.local) {                                     // a folder / drive
      if (!ctx.caps.bridge) return { ok: false, say: `${step.label} kholne ke liye PC bridge chahiye` };
      await P.open(url);
      return { ok: true, say };
    }
    rememberSite(url);
    if (ctx.caps.bridge && interactive) {
      ctx.before = await snapshotWindows(ctx);
      const r = await openInBrowser(url, true);
      ctx.app = r.browser || { label: 'Browser', key: 'browser', proc: BROWSER_PROCS, re: /./ };
      ctx.window = null;
      ctx.webFallback = !r.browser;
      return { ok: true, say };
    }
    const r = await P.open(url);
    return { ok: true, say: r.native ? say : say };
  }

  // Close apps he named — confirm first; never Clavis's own window.
  async function runClose(intent) {
    const P = PC();
    const caps = await capabilities();
    const labels = intent.apps.map((k) => P.APPS[k]?.label || k);
    const names = labels.join(' aur ');
    if (!caps.bridge) return { handled: true, spoken: `Browser se PC ke apps band nahi kar sakta, sir — ${names} band karne ke liye PC bridge (control mode) chahiye.` };
    if (!caps.control) return { handled: true, spoken: `${names} band karne ke liye bridge ka control mode chahiye, sir — Start-Bridge-With-Control.bat chala dijiye.` };
    const targets = [];
    for (const k of intent.apps) {
      const wins = await P.findWindows(k).catch(() => []);
      wins.filter((w) => !P.isClavisTitle(w.title)).forEach((w) => targets.push({ key: k, w }));
    }
    if (!targets.length) return { handled: true, spoken: `${names} abhi khula hi nahi hai, sir.` };
    const n = targets.length;
    const ok = await confirmRisky('pc_close_window', { title: names }, `${names} band kar doon${n > 1 ? ` (${n} windows)` : ''}? Unsaved kaam ho to app save karne ka poochega.`);
    if (!ok) return { handled: true, spoken: `Theek hai, ${names} band nahi kiya.` };
    let closed = 0;
    for (const { w } of targets) { try { await P.closeWindow({ handle: String(w.handle) }); closed++; } catch (_) {} }
    if (!closed) return { handled: true, spoken: `${names} band nahi ho paya, sir.` };
    return { handled: true, spoken: `${names} band kar diya, sir.` };
  }

  // Spoken outcome from what actually happened (never claims a failed step).
  function summarize(plan, ctx) {
    const res = ctx.results;
    const fail = res.find((r) => r.ok === false);
    const says = [];
    for (const r of res) {
      if (!r.say || r.ok === false) continue;
      if (r.kind === 'reuse') continue;
      if (r.kind === 'type') {
        const last = says[says.length - 1] || '';
        if (/ khol(a| diya)$/.test(last)) { says[says.length - 1] = last.replace(/ khol(a| diya)$/, ' khol ke'); says.push(r.say); }
        else says.push(`${r.label || 'window'} me ${r.say}`);
        continue;
      }
      says.push(r.say.replace(/ khola$/, ' khol diya'));
    }
    let line = says.length ? says.join(' aur ').replace(/ khol ke aur likh diya/, ' khol ke likh diya') : '';
    if (!line && !fail) line = 'Ho gaya';
    if (ctx.composeFailed) line += ' (AI key nahi thi, isliye jo bola wahi likha)';
    if (fail) line = line ? `${line}, par ${fail.say}` : cap(fail.say);
    line = cap(line.trim());
    return /[.?!]$/.test(line) ? line : `${line}${fail ? '.' : ', sir.'}`;
  }
  function checklist(ctx) {
    const rows = ctx.results.filter((r) => r.say && r.kind !== 'reuse').map((r) => `- ${r.ok === false ? '✗' : '✓'} ${cap(r.say)}`);
    let md = rows.join('\n');
    if (ctx.composed && ctx.typedText) md += `\n\n**Likha gaya text**\n\n${ctx.typedText.split('\n').map((l) => `> ${l}`).join('\n')}`;
    return md;
  }

  async function runIntent(intent, raw) {
    const task = taskFor(raw);
    let result;
    try {
      if (intent.kind === 'ask') result = { handled: true, spoken: intent.spoken };
      else if (intent.kind === 'close') result = await runClose(intent);
      else if (intent.kind === 'brief') result = await briefWebsite({ url: intent.url, text: raw, guessed: intent.guessed, task });
      else {
        let plan = intent;
        if (plan.complex && !plan.ai) {
          // Part of it didn't parse locally — let the AI planner have a go,
          // keeping the local plan if it can't do better.
          progress(task, 'Plan bana raha hoon');
          const ai = await planWithAI(raw);
          if (ai && ai.steps.length >= plan.steps.length) plan = ai;
        }
        const ctx = await runPlan(plan, { raw, task });
        result = { handled: true, spoken: summarize(plan, ctx) };
        if (plan.steps.length > 1 || ctx.composed) result.text = checklist(ctx);
      }
    } catch (err) {
      console.warn('[ClavisAutomation]', err);
      result = { handled: true, spoken: `Sir, ye kaam poora nahi ho paya: ${err?.message || err}.` };
    }
    try { window.setJarvisStatus?.('online', 'Clavis Online'); } catch (_) {}
    if (result) finishTask(task, result);
    return result;
  }

  // ── Website brief ────────────────────────────────────────────
  function cleanForeignUrl(u) {
    let s = String(u || '').trim();
    if (!s) return '';
    if (!/^https?:\/\//i.test(s)) s = `https://${s}`;
    try {
      const h = new URL(s).hostname;
      if (!h || /^(localhost|127\.0\.0\.1|0\.0\.0\.0)$/.test(h) || h === location.hostname) return '';
      return s;
    } catch (_) { return ''; }
  }
  function recentSite() {
    // The website ClavisCanvas is showing right now (voice tool or ours).
    try {
      const a = document.querySelector('.ccv-site') && document.querySelector('a.ccv-link[href]');
      if (a?.href) return { url: a.href, source: 'display' };
    } catch (_) {}
    if (state.lastSite && Date.now() - state.lastSite.at < RECENT_MS) return { url: state.lastSite.url, source: 'recent' };
    return null;
  }
  // "this website" = the page in his foreground browser tab, else the site
  // Clavis showed/opened last, else another browser window's page.
  async function resolveThisWebsite(opts = {}) {
    const P = PC();
    if (P && await P.ping().catch(() => false)) {
      let fg = null;
      try { fg = await withTimeout(P.activeWindow(), opts.fast ? 3000 : 10000, 'active window'); } catch (_) {}
      if (fg && isBrowserProc(fg.process) && !P.isClavisTitle(fg.title)) {
        const r = await withTimeout(P.browserUrl(), 12000, 'browser url').catch(() => null);
        const u = cleanForeignUrl(r?.url) || cleanForeignUrl(extractUrl(fg.title));
        if (u) return { url: u, source: 'tab', title: String(fg.title || '').replace(/\s+[-–—]\s+(Google Chrome|Microsoft​? Edge|Mozilla Firefox|Brave)$/i, '') };
      }
    }
    const recent = recentSite();
    if (recent) return recent;
    if (!opts.fast && P && P.available() && await P.controlAvailable().catch(() => false)) {
      try {
        const wins = (await P.listWindows()).filter((w) => isBrowserProc(w.process) && !P.isClavisTitle(w.title));
        for (const w of wins.slice(0, 2)) {
          const r = await withTimeout(P.browserUrl(w.handle), 12000, 'browser url').catch(() => null);
          const u = cleanForeignUrl(r?.url);
          if (u) return { url: u, source: 'window', title: w.title };
        }
      } catch (_) {}
    }
    return null;
  }

  // Page text: the Clavis backend reader (same endpoint clavis-live.js and
  // ClavisCanvas use), else r.jina.ai (CORS-friendly reader), else the raw
  // HTML through allorigins (the proxy clavis-enrichment-engine.js uses).
  const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,24}/g;
  const PHONE_RE = /(?:\+91[\s-]?)?[6-9]\d{4}[\s-]?\d{5}\b|(?:\+\d{1,3}[\s-]?)?\(?\d{2,4}\)?[\s-]\d{3,4}[\s-]\d{3,4}\b/g;
  const uniq = (a) => [...new Set(a)];
  function contactsFrom(text) {
    const emails = uniq((String(text).match(EMAIL_RE) || []).map((e) => e.toLowerCase()).filter((e) => !/\.(png|jpe?g|gif|svg|webp)$|example\.|sentry|wixpress/.test(e))).slice(0, 5);
    const phones = uniq((String(text).match(PHONE_RE) || []).map((p) => p.trim())).filter((p) => p.replace(/\D/g, '').length >= 10).slice(0, 4);
    return { emails, phones };
  }
  async function fetchFromBackend(url) {
    const base = window.SKYLARK_CONFIG?.BACKEND_URL || 'http://localhost:8000';
    const res = await withTimeout(fetch(`${base}/api/v1/web/read`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url, follow_contact: true }),
    }), 15000, 'backend read');
    if (!res.ok) throw new Error(`backend ${res.status}`);
    const d = await res.json();
    return { url: d.url || url, title: d.title || '', description: d.description || '', headings: d.headings || [], text: String(d.text || ''), emails: d.emails || [], phones: d.phones || [], social: d.social || [], source: 'backend' };
  }
  async function fetchFromJina(url) {
    const res = await withTimeout(fetch(`https://r.jina.ai/${url}`, { headers: { Accept: 'text/plain' } }), 15000, 'reader');
    if (!res.ok) throw new Error(`reader ${res.status}`);
    const body = await res.text();
    const title = (body.match(/^Title:\s*(.+)$/m) || [])[1] || '';
    const content = (body.split(/^Markdown Content:\s*$/m)[1] || body);
    const headings = uniq((content.match(/^#{1,3}\s+(.+)$/gm) || []).map((h) => h.replace(/^#+\s+/, '').replace(/[*_[\]]/g, '').trim())).filter(Boolean).slice(0, 12);
    const text = content.replace(/!\[[^\]]*\]\([^)]*\)/g, ' ').replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
      .replace(/^\s{0,3}(?:#{1,6}|>|[-*+]|\d+\.)\s+/gm, '').replace(/[#>*_`|-]{2,}/g, ' ').replace(/(?:^|\n)([^\n.!?]{3,120})(?=\n)/g, '$1.').replace(/\s+/g, ' ').replace(/\.\./g, '.').trim();
    return { url, title: title.trim(), description: '', headings, text: text.slice(0, 12000), ...contactsFrom(content), social: [], source: 'reader' };
  }
  async function fetchFromProxy(url) {
    const res = await withTimeout(fetch(`https://api.allorigins.win/raw?url=${enc(url)}`), 10000, 'proxy');
    if (!res.ok) throw new Error(`proxy ${res.status}`);
    const html = await res.text();
    const doc = new DOMParser().parseFromString(html, 'text/html');
    doc.querySelectorAll('script,style,noscript,svg,template,iframe').forEach((n) => n.remove());
    const meta = (n) => doc.querySelector(`meta[name="${n}"],meta[property="${n}"]`)?.getAttribute('content') || '';
    const headings = uniq([...doc.querySelectorAll('h1,h2,h3')].map((h) => h.textContent.replace(/\s+/g, ' ').trim()).filter((h) => h && h.length < 160)).slice(0, 12);
    const text = (doc.body?.textContent || '').replace(/\s+/g, ' ').trim();
    return { url, title: (doc.title || meta('og:title')).trim(), description: meta('description') || meta('og:description'), headings, text: text.slice(0, 12000), ...contactsFrom(html), social: [], source: 'proxy' };
  }
  async function fetchSite(url) {
    const backend = fetchFromBackend(url).catch(() => null);
    const reader = fetchFromJina(url).catch(() => null);
    const good = (d) => d && (d.text.length > 200 || d.title);
    const b = await backend;
    if (good(b)) return b;
    const r = await reader;
    if (good(r)) return { ...r, description: r.description || b?.description || '' };
    const p = await fetchFromProxy(url).catch(() => null);
    if (good(p)) return p;
    return { url, title: hostOf(url), description: '', headings: [], text: '', emails: [], phones: [], social: [], failed: true };
  }

  // Is this site a potential client / a competitor for his agency?
  const CLIENT_RE = /\b(hotels?|resorts?|hospitals?|clinics?|healthcare|malls?|retail|it\s*park|tech\s*park|offices?|co-?working|real\s*estate|builders?|developers?|residential|apartments?|societ(?:y|ies)|schools?|colleges?|universit(?:y|ies)|factor(?:y|ies)|manufactur\w*|warehous\w*|logistics|banks?|restaurants?|events?|corporate|campus)\b/i;
  const RIVAL_RE = /\b(security\s+(?:services?|guards?|agency|company)|guarding|bouncers?|housekeeping|facility\s+management|facilities\s+management|manpower|staffing|integrated\s+facility)\b/i;
  function relevance(page) {
    const blob = `${page.title} ${page.description} ${page.headings.join(' ')} ${page.text.slice(0, 4000)}`;
    if (RIVAL_RE.test(blob)) return { kind: 'rival', word: (blob.match(RIVAL_RE) || [])[0] };
    const m = blob.match(CLIENT_RE);
    return m ? { kind: 'client', word: m[0].toLowerCase() } : null;
  }
  function quickSummary(page) {
    const d = String(page.description || '').trim();
    if (d) return d.slice(0, 220);
    const s = String(page.text || '').match(/[^.!?]{40,220}[.!?]/);
    return s ? s[0].trim() : '';
  }

  function fallbackBrief(page, url) {
    const host = hostOf(page.url || url);
    const name = String(page.title || host).split(/\s+[|–—-]\s+/)[0].trim() || host;
    const lines = [`### ${name}`, `[${host}](${page.url || url})`, ''];
    const desc = quickSummary(page);
    if (desc) lines.push(desc, '');
    if (page.headings.length) { lines.push('**Page pe kya hai**'); page.headings.slice(0, 6).forEach((h) => lines.push(`- ${h}`)); lines.push(''); }
    if (page.emails.length || page.phones.length) { lines.push('**Contact**'); page.emails.slice(0, 3).forEach((e) => lines.push(`- ${e}`)); page.phones.slice(0, 2).forEach((p) => lines.push(`- ${p}`)); lines.push(''); }
    if (page.failed) lines.push('_Site ka text padh nahi paya (shayad automated readers block hain) — screenshot display me hai._');
    else lines.push('_Ye summary AI ke bina bani hai — sirf page ka title, description aur headings._');
    const rel = relevance(page);
    const said = [];
    said.push(page.failed ? `${name} ki site khul to rahi hai, sir, par uska text main padh nahi paya — screenshot display me rakh diya hai.`
      : desc ? `${name} ki site dekh li, sir — ye khud ko kuch aise describe karte hain: ${desc.split(/[.!?]/)[0].slice(0, 140)}.` : `${name} ki site dekh li, sir, par unhone apne baare me zyada saaf nahi likha.`);
    if (page.headings.length >= 2) said.push(`Page pe zyada focus "${page.headings[0].slice(0, 60)}" aur "${page.headings[1].slice(0, 60)}" pe hai.`);
    if (rel?.kind === 'client') said.push(`Hamare kaam ke hisaab se ye ek possible lead lagti hai — ${rel.word} jaisi jagahon ko security aur housekeeping staff ki zarurat rehti hai.`);
    if (rel?.kind === 'rival') said.push('Ye hamare hi field ke player lagte hain — inki offerings aur pricing pe nazar rakhna faydemand hoga.');
    if (!page.failed) said.push(page.emails.length || page.phones.length ? 'Unke public contact details bhi screen pe daal diye hain.' : 'Public contact details site pe nahi mile.');
    if (!window.ClavisDirect?.hasKey?.()) said.push('Gehri analysis ke liye ek AI key connect kar dijiye.');
    return { text: lines.join('\n').trim(), spoken: said.join(' ') };
  }

  async function aiBrief(page, url, request, rel) {
    if (!window.ClavisDirect?.hasKey?.() || page.failed) return null;
    const sys = [
      'You are Clavis, a sharp business analyst for sir — he runs a security guard & housekeeping staffing agency in Gurugram, India, and speaks Hinglish.',
      'You get the scraped content of ONE website. Produce TWO different outputs, exactly in this format:',
      '===SCREEN===',
      'A concise markdown brief for the screen (max ~140 words): first line **Name** — what it is in one line; then bullets: **Kya hai**, **Kiske liye**, **Offerings**, **Notable** (facts: locations, scale, clients, pricing, awards — only if present), **Contact** (only emails/phones/address actually in the content). Facts only, no opinions.',
      '===SPOKEN===',
      '3-5 natural spoken sentences in Hinglish (Roman script), said TO sir. Do NOT read the brief back or list offerings. Give your take instead: how they position themselves, one real strength, one weakness or gap you notice, and — only when it genuinely applies — what it means for his security/housekeeping business (potential client? competitor? partner?). No markdown, no emojis, no URLs.',
      'Never invent facts that are not in the content. If the content is thin, say so briefly.',
    ].join('\n');
    const content = [
      `URL: ${page.url || url}`, `Title: ${page.title}`, page.description ? `Meta description: ${page.description}` : '',
      page.headings.length ? `Headings: ${page.headings.slice(0, 12).join(' | ')}` : '',
      page.emails.length ? `Emails: ${page.emails.join(', ')}` : '', page.phones.length ? `Phones: ${page.phones.join(', ')}` : '',
      rel ? `Local hint: this looks like a ${rel.kind === 'rival' ? 'competitor (staffing/security/facility)' : `possible client (${rel.word})`}.` : '',
      `Sir asked: "${String(request || '').slice(0, 200)}"`,
      '', 'Page text:', page.text.slice(0, 6000),
    ].filter(Boolean).join('\n');
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 30000);
    try {
      const data = await window.ClavisDirect.complete({ messages: [{ role: 'system', content: sys }, { role: 'user', content }], max_tokens: 900, temperature: 0.5 }, ctrl.signal);
      const out = String(data?.choices?.[0]?.message?.content || '');
      const screen = (out.split(/===\s*SCREEN\s*===/i)[1] || '').split(/===\s*SPOKEN\s*===/i)[0].trim();
      const spoken = (out.split(/===\s*SPOKEN\s*===/i)[1] || '').replace(/[*#_`>]/g, '').replace(/https?:\/\/\S+/g, '').replace(/\s+/g, ' ').trim();
      if (!screen || !spoken) return null;
      return { text: screen, spoken };
    } catch (err) {
      console.warn('[ClavisAutomation] brief AI:', err?.message || err);
      return null;
    } finally { clearTimeout(timer); }
  }

  async function briefWebsite(opts = {}) {
    const task = opts.task || null;
    let url = opts.url ? cleanForeignUrl(opts.url) : '';
    let source = opts.url ? 'said' : '';
    if (!url) {
      progress(task, 'Dekh raha hoon kaunsi website khuli hai');
      const found = await resolveThisWebsite();
      if (found) { url = found.url; source = found.source; }
    }
    if (!url) return { handled: true, spoken: 'Kaunsi website, sir? Uska naam ya URL boliye — jaise "brief me about stripe.com".' };
    rememberSite(url);
    progress(task, `${hostOf(url)} padh raha hoon`);
    // Screenshot + overview in the Clavis display (clavis-canvas.js). Shown
    // with our quick summary once the text is in, or after 2.5s regardless.
    let shown = false;
    const show = (summary) => {
      if (shown) return;
      shown = true;
      try { Promise.resolve(window.ClavisCanvas?.showWebsite?.({ url, summary: summary || undefined })).catch(() => {}); } catch (_) {}
    };
    const early = setTimeout(() => show(''), 2500);
    const page = await fetchSite(url);
    clearTimeout(early);
    show(quickSummary(page));
    if (page.title) rememberSite(url, page.title);
    progress(task, 'Brief taiyaar kar raha hoon');
    const rel = page.failed ? null : relevance(page);
    const brief = (await aiBrief(page, url, opts.text, rel)) || fallbackBrief(page, url);
    let text = brief.text;
    if (opts.guessed) text += `\n\n_URL andaaze se liya: ${hostOf(url)} — galat ho to poora address boliye._`;
    if (source === 'recent' || source === 'window') text += `\n\n_Ye ${hostOf(url)} ka brief hai (jo site abhi khuli thi)._`;
    return { handled: true, spoken: brief.spoken, text, display: 'window', url };
  }

  // ── Entry points ─────────────────────────────────────────────
  // phase 'gate': only what the other routers would get wrong.
  // phase 'route': everything this module knows, plus the AI planner.
  async function handle(raw, opts = {}) {
    const text = String(raw || '').trim();
    if (!text) return null;
    const phase = opts.phase || 'route';
    let intent = null;
    try { intent = parse(text, { allowGeneric: false }); } catch (err) { console.warn('[ClavisAutomation] parse', err); return null; }
    if (!intent) {
      // Nothing local fits, but it sounds like PC work: ask the AI planner
      // (route phase only — the gate never waits on a model).
      if (phase !== 'route' || !looksLikeAutomation(text) || !window.ClavisDirect?.hasKey?.()) return null;
      window.setJarvisStatus?.('thinking', 'Plan bana raha hoon');
      intent = await planWithAI(text);
      if (!intent) { window.setJarvisStatus?.('online', 'Clavis Online'); return null; }
    }
    if (intent.contextual) {
      // "is page ko scroll karo" / "is page ke baare me batao" mean the
      // website only when one is actually in play; otherwise the Clavis page.
      const ctxSite = await externalContext(intent.kind === 'brief').catch(() => null);
      if (!ctxSite) return null;
    } else if (phase === 'gate' && !intent.priority) return null;
    const key = norm(text);
    if (state.inflight.has(key)) return state.inflight.get(key);
    const p = runIntent(intent, text).finally(() => setTimeout(() => state.inflight.delete(key), 1200));
    state.inflight.set(key, p);
    return p;
  }
  async function externalContext(forBrief) {
    const P = PC();
    if (state.lastWindow && Date.now() - state.lastWindow.at < RECENT_MS) return state.lastWindow;
    if (forBrief) { const r = recentSite(); if (r) return r; }
    if (!P || !(await P.ping().catch(() => false))) return null;
    let fg = null;
    // Short wait: this runs in front of every "scroll …" phrase, and a cold
    // bridge takes seconds for its first active-window sample.
    try { fg = await withTimeout(P.activeWindow(), 1500, 'active window'); } catch (_) {}
    if (fg && isBrowserProc(fg.process) && !P.isClavisTitle(fg.title)) return fg;
    return null;
  }

  // Priority gate: in front of the whole ClavisCommands.route chain
  // (clavis-luxe.js / clavis-task-controller.js wrap it too, and luxe would
  // read "excel kholo" as the in-app Excel Manager page). Only claims what
  // parse() marks priority; everything else goes through untouched.
  function installGate() {
    const C = window.ClavisCommands;
    if (!C || typeof C.route !== 'function') return false;
    if (C.route.__clavisAuto) return true;
    const inner = C.route;
    const gated = async function (text) {
      if (api.gateEnabled !== false) {
        try {
          const mine = await handle(text, { phase: 'gate' });
          if (mine && mine.handled) return mine;
        } catch (err) { console.warn('[ClavisAutomation] gate', err); }
      }
      return inner.apply(C, arguments);
    };
    gated.__clavisAuto = true;
    C.route = gated;
    return true;
  }

  const api = {
    handle, parse, planLocal, planWithAI, validatePlan, runPlan, briefWebsite, resolveThisWebsite,
    claims: (text) => Boolean(parse(text)?.priority),
    installGate, gateEnabled: true, SEARCH_SITES, STEP_TYPES, _state: state,
    _internals: { splitTypePayload, splitClauses, parseSearch, parseScroll, parseKey, parseBrief, parseClose, keyToSendKeys, adaptPlan, summarize, fallbackBrief, extractUrl, relevance },
  };
  window.ClavisAutomation = api;

  // Other modules wrap route() on load/DOM-ready; re-check a few times so
  // the gate stays in front even if one of them wraps after us.
  installGate();
  const recheck = () => { try { if (window.ClavisCommands && !window.ClavisCommands.route.__clavisAuto) installGate(); } catch (_) {} };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', recheck, { once: true });
  setTimeout(recheck, 1500);
  setTimeout(recheck, 5000);
})();
