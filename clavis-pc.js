/**
 * ============================================================
 *  CLAVIS PC (clavis-pc.js)
 *  Browser client for the local bridge (clavis-bridge/bridge.js) plus
 *  safe browser-only fallbacks. Every action tries the native bridge
 *  first (real OS control) and degrades gracefully if it isn't running:
 *    - open()       bridge → else window.open (new tab)
 *    - saveNote()   bridge → else download a .txt file
 *    - screenshot() bridge (whole OS) → else getDisplayMedia (pick a screen)
 *    - launchApp()  bridge /launch (any installed app, Start-menu match)
 *                   → else the app's web version (office.com, claude.ai…)
 *  APPS is the shared desktop-app catalog (names Hinglish speech uses, how
 *  Windows launches each, its window's process name, its web version) —
 *  clavis-automation.js and clavis-commands.js read it from here.
 * ============================================================
 */
'use strict';

(() => {
  const url = () => localStorage.getItem('clavis_bridge_url') || 'http://127.0.0.1:8777';
  const token = () => localStorage.getItem('clavis_bridge_token') || 'clavis-local';

  let onlineCache = { at: 0, up: false, info: null };
  let displayStream = null; // cached getDisplayMedia stream (browser fallback)

  async function ping(force = false) {
    if (!force && Date.now() - onlineCache.at < 4000) return onlineCache.up;
    let up = false, info = null;
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 900);
      const res = await fetch(`${url()}/ping`, { signal: ctrl.signal });
      clearTimeout(t);
      up = res.ok;
      // /ping also says what this bridge can do (version, features, whether
      // mouse/keyboard control is on). Keeping it here means a bridge that
      // was restarted WITH control is noticed without reloading Clavis.
      if (up) info = await res.json().catch(() => null);
    } catch (_) { up = false; }
    onlineCache = { at: Date.now(), up, info };
    if (info && typeof info.controlEnabled === 'boolean') controlEnabledCache = info.controlEnabled;
    return up;
  }
  function available() { return onlineCache.up; }
  // What the running bridge supports: { version, features[], controlEnabled }.
  // An older bridge (no `features`) still works through /open.
  function bridgeInfo() { return onlineCache.up ? (onlineCache.info || {}) : null; }
  function hasFeature(name) { return Boolean(onlineCache.up && (onlineCache.info?.features || []).includes(name)); }

  async function bridge(pathname, method, body) {
    const res = await fetch(`${url()}${pathname}`, {
      method,
      headers: { 'Content-Type': 'application/json', 'x-clavis-token': token() },
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.ok) throw new Error(data.error || `Bridge ${pathname} failed (${res.status}).`);
    return data;
  }

  // Turn "youtube" / "gmail" into a real URL; leave app names/paths alone.
  const SITE_ALIASES = {
    youtube: 'https://youtube.com', gmail: 'https://mail.google.com', google: 'https://google.com',
    wikipedia: 'https://en.wikipedia.org', whatsapp: 'https://web.whatsapp.com', maps: 'https://maps.google.com',
    chatgpt: 'https://chatgpt.com', claude: 'https://claude.ai', gemini: 'https://gemini.google.com',
    github: 'https://github.com', twitter: 'https://twitter.com', x: 'https://x.com',
    linkedin: 'https://linkedin.com', instagram: 'https://instagram.com', facebook: 'https://facebook.com',
    spotify: 'https://open.spotify.com', reddit: 'https://reddit.com', amazon: 'https://amazon.in',
    flipkart: 'https://flipkart.com', netflix: 'https://netflix.com', prime: 'https://primevideo.com',
    canva: 'https://canva.com', figma: 'https://figma.com', drive: 'https://drive.google.com',
    docs: 'https://docs.google.com', sheets: 'https://sheets.google.com', keep: 'https://keep.google.com',
    calendar: 'https://calendar.google.com', meet: 'https://meet.google.com', zoom: 'https://zoom.us',
    calculator: 'https://www.google.com/search?q=calculator',
    calc: 'https://www.google.com/search?q=calculator',
    weather: 'https://www.google.com/search?q=weather',
    news: 'https://news.google.com'
  };
  function resolveWebTarget(target) {
    const t = String(target || '').trim().toLowerCase();
    if (SITE_ALIASES[t]) return SITE_ALIASES[t];
    if (/^https?:\/\//i.test(target)) return target;
    if (/^[\w-]+\.[a-z]{2,}(\/\S*)?$/i.test(t)) return `https://${target}`;
    // YouTube search pattern: "youtube ...", "play ... on youtube"
    if (/\byoutube\b/.test(t)) {
      const q = t.replace(/\byoutube\b/g, '').replace(/\b(par|pe|me|search|karo|play|chalao|gaana|song|video)\b/g, ' ').trim();
      return q ? `https://www.youtube.com/results?search_query=${encodeURIComponent(q)}` : 'https://youtube.com';
    }
    // Google search pattern: "google ...", "search ... on google"
    if (/\bgoogle\b/.test(t)) {
      const q = t.replace(/\bgoogle\b/g, '').replace(/\b(par|pe|me|search|karo|dhoondo|dhundo)\b/g, ' ').trim();
      return q ? `https://www.google.com/search?q=${encodeURIComponent(q)}` : 'https://google.com';
    }
    // Wikipedia search pattern: "wikipedia ..."
    if (/\bwikipedia\b/.test(t)) {
      const q = t.replace(/\bwikipedia\b/g, '').replace(/\b(par|pe|me|search|dekho|padho)\b/g, ' ').trim();
      return q ? `https://en.wikipedia.org/wiki/Special:Search?search=${encodeURIComponent(q)}` : 'https://en.wikipedia.org';
    }
    return null;
  }

  // ── Desktop app catalog ─────────────────────────────────────
  // key → how he says it (regex source, Hinglish spellings too), the
  // Start-menu names the bridge should match, the shell name/protocol
  // Windows already knows (exe), the window process names (for focus /
  // close), and the web version used when the bridge is off or the app
  // isn't installed. Flags:
  //   system  always present on Windows → safe to launch by exe directly
  //   browser can take a URL on launch     office  shows a Start screen first
  //   chat    typing lands in a prompt box messaging  Enter would SEND
  //   inApp   this phrase means Clavis's own page, not the desktop app
  //   cue     only counts as the desktop app when this also appears
  //           (plain "whatsapp kholo" stays the in-app WhatsApp page)
  const APPS = {
    chrome: { label: 'Chrome', say: 'google chrome|chrome|crome|krome', names: ['Google Chrome', 'Chrome'], exe: 'chrome', proc: ['chrome'], web: 'https://www.google.com', browser: true },
    edge: { label: 'Edge', say: 'microsoft edge|edge browser|ms edge|edge', names: ['Microsoft Edge'], exe: 'msedge', proc: ['msedge'], web: 'https://www.bing.com', browser: true, system: true },
    firefox: { label: 'Firefox', say: 'mozilla firefox|firefox|mozilla', names: ['Firefox', 'Mozilla Firefox'], exe: 'firefox', proc: ['firefox'], web: 'https://www.google.com', browser: true },
    brave: { label: 'Brave', say: 'brave browser|brave', names: ['Brave'], exe: 'brave', proc: ['brave'], web: 'https://www.google.com', browser: true },
    explorer: { label: 'File Explorer', say: 'file explorer|file manager|file manger|files explorer|windows explorer|explorer|my computer|this pc', names: ['File Explorer'], exe: 'explorer', proc: ['explorer'], system: true },
    notepad: { label: 'Notepad', say: 'notepad|note pad|notepaad', names: ['Notepad'], exe: 'notepad', proc: ['notepad'], system: true },
    excel: { label: 'Excel', say: 'microsoft excel|ms excel|excel', names: ['Excel', 'Microsoft Excel'], exe: 'excel', proc: ['excel'], web: 'https://www.office.com/launch/excel', office: true,
      inApp: /\bexcel\s*(manager|page|tab|section|view|sheet\s*manager)\b|\b(export|download|nikalo|nikaal)\b/ },
    word: { label: 'Word', say: 'microsoft word|ms word|word', names: ['Word', 'Microsoft Word'], exe: 'winword', proc: ['winword'], web: 'https://www.office.com/launch/word', office: true },
    powerpoint: { label: 'PowerPoint', say: 'microsoft powerpoint|power point|powerpoint|ppt', names: ['PowerPoint', 'Microsoft PowerPoint'], exe: 'powerpnt', proc: ['powerpnt'], web: 'https://www.office.com/launch/powerpoint', office: true },
    outlook: { label: 'Outlook', say: 'outlook', names: ['Outlook', 'Microsoft Outlook', 'Outlook (new)'], exe: 'outlook', proc: ['outlook', 'olk'], web: 'https://outlook.live.com/mail/', messaging: true },
    vscode: { label: 'VS Code', say: 'visual studio code|vs code|vscode|code editor', names: ['Visual Studio Code', 'VS Code'], exe: 'code', proc: ['code'], web: 'https://vscode.dev' },
    claude: { label: 'Claude', say: 'claude app|claude desktop|claude', names: ['Claude'], proc: ['claude'], web: 'https://claude.ai', chat: true },
    chatgpt: { label: 'ChatGPT', say: 'chatgpt app|chat gpt|chatgpt|chat gbt|chatgbt', names: ['ChatGPT'], proc: ['chatgpt'], web: 'https://chatgpt.com', chat: true },
    spotify: { label: 'Spotify', say: 'spotify', names: ['Spotify'], exe: 'spotify:', proc: ['spotify'], web: 'https://open.spotify.com' },
    whatsapp: { label: 'WhatsApp', say: 'whats app|whatsapp', names: ['WhatsApp'], exe: 'whatsapp:', proc: ['whatsapp', 'whatsapp.root'], web: 'https://web.whatsapp.com', chat: true, messaging: true,
      cue: /\b(desktop|app|application|pc|computer|laptop|web)\b/ },
    telegram: { label: 'Telegram', say: 'telegram', names: ['Telegram Desktop', 'Telegram'], proc: ['telegram'], web: 'https://web.telegram.org', chat: true, messaging: true },
    teams: { label: 'Teams', say: 'microsoft teams|ms teams|teams', names: ['Microsoft Teams', 'Teams'], proc: ['ms-teams', 'teams'], web: 'https://teams.microsoft.com', messaging: true },
    calculator: { label: 'Calculator', say: 'calculator', names: ['Calculator'], exe: 'calc', proc: ['calculatorapp', 'calculator'], system: true, web: 'https://www.google.com/search?q=calculator' },
    paint: { label: 'Paint', say: 'ms paint|paint', names: ['Paint'], exe: 'mspaint', proc: ['mspaint'], system: true },
    terminal: { label: 'Terminal', say: 'command prompt|terminal|cmd|powershell', names: ['Terminal', 'Windows Terminal', 'Command Prompt'], exe: 'cmd', proc: ['windowsterminal', 'cmd', 'powershell'], system: true },
    taskmgr: { label: 'Task Manager', say: 'task manager', names: ['Task Manager'], exe: 'taskmgr', proc: ['taskmgr'], system: true },
    controlpanel: { label: 'Control Panel', say: 'control panel', names: ['Control Panel'], exe: 'control', system: true },
    pcsettings: { label: 'Windows Settings', say: '(?:windows|pc|computer|laptop|system) settings?', names: ['Settings'], exe: 'ms-settings:', proc: ['systemsettings'], system: true },
    vlc: { label: 'VLC', say: 'vlc player|vlc', names: ['VLC media player'], proc: ['vlc'] },
  };
  Object.keys(APPS).forEach((k) => { APPS[k].key = k; APPS[k].re = new RegExp(`\\b(?:${APPS[k].say})\\b`, 'i'); });

  // Every catalog app named in a sentence, in the order they appear.
  // In-app phrasings ("excel manager kholo") and cue-less ones ("whatsapp
  // kholo" = the in-app page) are left out unless opts.loose.
  function matchApps(text, opts = {}) {
    const t = String(text || '').toLowerCase();
    const out = [];
    for (const app of Object.values(APPS)) {
      const m = app.re.exec(t);
      if (!m) continue;
      if (!opts.loose && app.inApp && app.inApp.test(t)) continue;
      if (!opts.loose && app.cue && !app.cue.test(t)) continue;
      // "google chrome" must not also count as a bare "google" site etc.;
      // and "edge" inside "knowledge" is already excluded by \b.
      out.push({ key: app.key, app, index: m.index, said: m[0] });
    }
    // Longest mention wins where two overlap ("microsoft word" vs "word").
    out.sort((a, b) => a.index - b.index || b.said.length - a.said.length);
    return out.filter((m, i) => !out.slice(0, i).some((p) => m.index < p.index + p.said.length && p.index < m.index + m.said.length));
  }
  function matchApp(text, opts) { return matchApps(text, opts)[0] || null; }
  function appFor(keyOrName) {
    if (!keyOrName) return null;
    if (typeof keyOrName === 'object') return keyOrName;
    const k = String(keyOrName).toLowerCase().trim();
    return APPS[k] || matchApp(k, { loose: true })?.app || null;
  }

  // Launch a desktop app. Bridge /launch finds ANY installed app by its
  // Start-menu name (Store apps too); an older bridge gets the shell name
  // through /open. Returns { ok, native, web?, notInstalled?, name }.
  // opts.url: for a browser, open straight onto this page; opts.newWindow
  // keeps it out of the window Clavis itself lives in.
  async function launchApp(keyOrName, opts = {}) {
    const app = appFor(keyOrName);
    const name = app ? app.label : String(keyOrName || '').trim();
    if (!name) throw new Error('Kaunsa app kholun?');
    await ping();
    if (available()) {
      if (hasFeature('launch')) {
        try {
          const r = await bridge('/launch', 'POST', {
            app: name, names: app ? app.names : [name], exe: app?.exe || '', system: Boolean(app?.system),
            url: app?.browser && opts.url ? opts.url : undefined, newWindow: Boolean(opts.newWindow),
          });
          return { ok: true, native: true, name, via: r.via, match: r.match };
        } catch (err) {
          if (!/not.installed|not found|no installed app/i.test(err.message)) throw err;
          // Not on this PC → its web version, in the default browser.
          if (app?.web) { await bridge('/open', 'POST', { target: opts.url || app.web }); return { ok: true, native: true, web: true, notInstalled: true, name }; }
          return { ok: false, native: true, notInstalled: true, name };
        }
      }
      // Old bridge (no /launch): the shell name Windows knows, else the web.
      const target = app?.browser && opts.url ? opts.url : (app?.exe || (app?.web) || name);
      await bridge('/open', 'POST', { target });
      return { ok: true, native: true, name, web: !app?.exe && Boolean(app?.web) };
    }
    // Browser only: the web version, if the app has one.
    const web = opts.url || app?.web;
    if (web) { window.open(web, '_blank', 'noopener'); return { ok: true, native: false, web: true, name }; }
    return { ok: false, native: false, name, needsBridge: true };
  }

  // Windows whose process (or title) matches an app — bridge + control only.
  function windowMatches(w, app, opts = {}) {
    const proc = String(w.process || '').toLowerCase();
    const title = String(w.title || '');
    if (opts.exclude && opts.exclude.has(String(w.handle))) return false;
    if (opts.title && !title.toLowerCase().includes(String(opts.title).toLowerCase())) return false;
    if (opts.skipClavis && isClavisTitle(title)) return false;
    if (!app) return Boolean(opts.title);
    if ((app.proc || []).includes(proc)) return true;
    // Store apps often run under a generic host process — fall back to the title.
    if (!app.proc?.length || proc === 'applicationframehost') return app.re.test(title);
    return false;
  }
  function isClavisTitle(title) {
    const t = String(title || '');
    const mine = String(document.title || '').trim();
    return (mine && t.includes(mine)) || /\b(clavis|nexus ai)\b/i.test(t);
  }
  async function findWindows(keyOrName, opts = {}) {
    const app = keyOrName ? appFor(keyOrName) : null;
    const all = await listWindows();
    return all.filter((w) => windowMatches(w, app, opts));
  }
  // Poll until a matching window exists (new ones first when `exclude` is a
  // snapshot of handles taken before launching). Resolves null on timeout.
  async function waitForWindow(keyOrName, opts = {}) {
    const deadline = Date.now() + (opts.timeoutMs || 15000);
    let fallback = null;
    while (Date.now() < deadline) {
      try {
        const fresh = await findWindows(keyOrName, opts);
        if (fresh.length) return fresh[0];
        if (opts.exclude && opts.allowExisting !== false && !fallback) {
          const any = await findWindows(keyOrName, { ...opts, exclude: null });
          if (any.length) fallback = { w: any[0], at: Date.now() };
        }
        // Single-instance apps (Spotify, WhatsApp…) just re-show their old
        // window instead of making a new one — accept it after a grace period.
        if (fallback && Date.now() - fallback.at > (opts.graceMs || 3500)) return fallback.w;
      } catch (_) { /* helper warming up — keep polling */ }
      await new Promise((r) => setTimeout(r, 600));
    }
    return fallback ? fallback.w : null;
  }

  async function open(target) {
    await ping();
    if (available()) {
      // Native: can open apps ("notepad", "spotify"), files, or URLs.
      const web = resolveWebTarget(target);
      // A known desktop app (or any bare app name) goes through /launch so
      // "claude" / "excel" open the installed app, not a browser tab.
      const looksLikePath = /[\\/:]/.test(String(target || ''));
      if (!web && !looksLikePath && hasFeature('launch')) {
        try {
          const r = await launchApp(target);
          if (r.ok) return { ok: true, native: true, web: r.web };
        } catch (_) { /* fall through to the plain shell open */ }
      }
      await bridge('/open', 'POST', { target: web || appFor(target)?.exe || target });
      return { ok: true, native: true };
    }
    const app = appFor(target);
    const web = resolveWebTarget(target) || app?.web;
    if (web) { window.open(web, '_blank', 'noopener'); return { ok: true, native: false }; }
    // Graceful web fallback for desktop apps when bridge is offline:
    const webFallback = `https://www.google.com/search?q=${encodeURIComponent(target)}`;
    window.open(webFallback, '_blank', 'noopener');
    return { ok: true, native: false, note: 'Opened in web' };
  }

  async function saveNote(text, filename) {
    await ping();
    if (available()) {
      const r = await bridge('/notepad', 'POST', { text, filename });
      return { ok: true, native: true, path: r.path };
    }
    const name = (filename && /\.[a-z0-9]+$/i.test(filename)) ? filename : `${filename || 'clavis-note'}.txt`;
    const blob = new Blob([String(text ?? '')], { type: 'text/plain' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    return { ok: true, native: false };
  }

  // Returns a PNG data URL. Native bridge grabs the whole OS instantly;
  // browser fallback asks the user to pick a screen once, then reuses it.
  // Always lands on the clipboard and nowhere else — never written to disk.
  // The native bridge copies it OS-side (works even when Chrome isn't focused);
  // the browser fallback uses the async clipboard API.
  async function screenshot() {
    await ping();
    if (available()) {
      const r = await bridge('/screenshot', 'GET');
      if (!r.clipboard) await copyImage(r.dataUrl);
      return { dataUrl: r.dataUrl, native: true, clipboard: true };
    }
    const dataUrl = await browserCapture();
    const copied = await copyImage(dataUrl);
    return { dataUrl, native: false, clipboard: copied };
  }

  // Foreground window/tab title + process + OS idle time. Bridge-only:
  // a sandboxed page cannot see outside itself, so this returns null when
  // the bridge is off rather than pretending.
  async function activeWindow() {
    await ping();
    if (!available()) return null;
    try { return await bridge('/active-window', 'GET'); }
    catch (_) { return null; }
  }

  async function ensureDisplayStream() {
    if (displayStream && displayStream.getVideoTracks()[0]?.readyState === 'live') return displayStream;
    if (!navigator.mediaDevices?.getDisplayMedia) throw new Error('Screen capture needs Chrome/Edge over http(s).');
    displayStream = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: 4 }, audio: false });
    displayStream.getVideoTracks()[0].addEventListener('ended', () => { displayStream = null; });
    return displayStream;
  }

  async function browserCapture() {
    const stream = await ensureDisplayStream();
    const track = stream.getVideoTracks()[0];
    // ImageCapture where supported, else a video+canvas frame grab.
    try {
      if (window.ImageCapture) {
        const bitmap = await new ImageCapture(track).grabFrame();
        const c = document.createElement('canvas'); c.width = bitmap.width; c.height = bitmap.height;
        c.getContext('2d').drawImage(bitmap, 0, 0);
        return c.toDataURL('image/png');
      }
    } catch (_) { /* fall through */ }
    const video = document.createElement('video');
    video.srcObject = stream; video.muted = true;
    await video.play();
    await new Promise(r => setTimeout(r, 120));
    const c = document.createElement('canvas');
    c.width = video.videoWidth || 1280; c.height = video.videoHeight || 720;
    c.getContext('2d').drawImage(video, 0, 0, c.width, c.height);
    video.pause(); video.srcObject = null;
    return c.toDataURL('image/png');
  }

  async function copyImage(dataUrl) {
    try {
      const blob = await (await fetch(dataUrl)).blob();
      await navigator.clipboard.write([new ClipboardItem({ [blob.type]: blob })]);
      return true;
    } catch (_) { return false; }
  }
  async function copyText(text) {
    try { await navigator.clipboard.writeText(String(text ?? '')); return true; } catch (_) { return false; }
  }

  function download(dataUrl, name) {
    const a = document.createElement('a');
    a.href = dataUrl; a.download = name || `clavis-screenshot-${Date.now()}.png`;
    document.body.appendChild(a); a.click(); a.remove();
  }

  // ── Mouse / keyboard control (native bridge only — no browser fallback
  //    exists for this, a sandboxed page can never move the OS cursor) ──
  let controlEnabledCache = null; // from /ping's controlEnabled flag
  async function controlAvailable() {
    await ping();
    if (!available()) return false;
    if (controlEnabledCache !== null) return controlEnabledCache;
    try {
      const res = await fetch(`${url()}/ping`);
      const data = await res.json().catch(() => ({}));
      controlEnabledCache = Boolean(data.controlEnabled);
    } catch (_) { controlEnabledCache = false; }
    return controlEnabledCache;
  }
  function requireControl() {
    if (!available()) throw new Error('Clavis bridge is not running — PC control needs it (Start-Bridge.bat).');
    if (controlEnabledCache === false) throw new Error('Mouse/keyboard control is off on this bridge. Run Start-Bridge-With-Control.bat to enable it.');
  }
  // Screenshot for Clavis's own eyes: bridge only, and it leaves the
  // clipboard alone (screenshot() copies, which would clobber whatever
  // sir just copied). null when the bridge is off.
  async function peek() {
    await ping();
    if (!available()) return null;
    const r = await bridge('/screenshot?clipboard=0', 'GET');
    return r.dataUrl || null;
  }

  async function screenSize() {
    await ping();
    if (!available()) return null;
    try { return await bridge('/screen-size', 'GET'); } catch (_) { return null; }
  }
  async function moveMouse(x, y) {
    await controlAvailable(); requireControl();
    await bridge('/pc-control', 'POST', { action: 'move', x: Math.round(x), y: Math.round(y) });
    return { ok: true };
  }
  async function click(x, y, opts = {}) {
    await controlAvailable(); requireControl();
    await bridge('/pc-control', 'POST', { action: 'click', x: Math.round(x), y: Math.round(y), button: opts.button || 'left', double: Boolean(opts.double) });
    return { ok: true };
  }
  async function scroll(amount, x, y) {
    await controlAvailable(); requireControl();
    await bridge('/pc-control', 'POST', { action: 'scroll', amount: Math.round(amount), x: x != null ? Math.round(x) : undefined, y: y != null ? Math.round(y) : undefined });
    return { ok: true };
  }
  async function drag(x, y, x2, y2) {
    await controlAvailable(); requireControl();
    await bridge('/pc-control', 'POST', { action: 'drag', x: Math.round(x), y: Math.round(y), x2: Math.round(x2), y2: Math.round(y2) });
    return { ok: true };
  }
  async function typeText(text) {
    await controlAvailable(); requireControl();
    await bridge('/pc-control', 'POST', { action: 'type', text: String(text ?? '') });
    return { ok: true };
  }
  async function pressKeys(keys) {
    await controlAvailable(); requireControl();
    await bridge('/pc-control', 'POST', { action: 'key', keys: String(keys ?? '') });
    return { ok: true };
  }

  // ── Window management (native bridge only, same ALLOW_CONTROL gate as
  //    mouse/keyboard — a separate helper process on the bridge side, see
  //    windowcontrol.ps1). A window is identified by an exact handle (as
  //    returned by listWindows) or a title substring.
  function windowTarget(target) {
    if (target && typeof target === 'object') return target;
    const t = String(target ?? '').trim();
    return /^\d+$/.test(t) ? { handle: t } : { title: t };
  }
  async function listWindows() {
    await controlAvailable(); requireControl();
    const r = await bridge('/pc-window', 'POST', { action: 'list' });
    return r.windows || [];
  }
  async function getCursorPosition() {
    await controlAvailable(); requireControl();
    const r = await bridge('/pc-window', 'POST', { action: 'cursor' });
    return { x: r.x, y: r.y };
  }
  async function minimizeWindow(target) {
    await controlAvailable(); requireControl();
    await bridge('/pc-window', 'POST', { action: 'minimize', ...windowTarget(target) });
    return { ok: true };
  }
  async function maximizeWindow(target) {
    await controlAvailable(); requireControl();
    await bridge('/pc-window', 'POST', { action: 'maximize', ...windowTarget(target) });
    return { ok: true };
  }
  async function restoreWindow(target) {
    await controlAvailable(); requireControl();
    await bridge('/pc-window', 'POST', { action: 'restore', ...windowTarget(target) });
    return { ok: true };
  }
  async function focusWindow(target) {
    await controlAvailable(); requireControl();
    const r = await bridge('/pc-window', 'POST', { action: 'focus', ...windowTarget(target) });
    // Newer bridges report whether Windows actually let it come to the front
    // (it can refuse); undefined on older ones.
    return { ok: true, focused: r.focused };
  }
  async function closeWindow(target) {
    await controlAvailable(); requireControl();
    await bridge('/pc-window', 'POST', { action: 'close', ...windowTarget(target) });
    return { ok: true };
  }

  // ── File operations (native bridge only, same ALLOW_CONTROL gate). ──
  async function listFiles(dirPath) { await controlAvailable(); requireControl(); return bridge('/files', 'POST', { action: 'list', path: dirPath }); }
  async function searchFiles(dirPath, query) { await controlAvailable(); requireControl(); const r = await bridge('/files', 'POST', { action: 'search', path: dirPath, query }); return r.results; }
  async function readFile(filePath) { await controlAvailable(); requireControl(); return bridge('/files', 'POST', { action: 'read', path: filePath }); }
  async function writeFile(filePath, content) { await controlAvailable(); requireControl(); return bridge('/files', 'POST', { action: 'write', path: filePath, content }); }
  async function deleteFile(targetPath) { await controlAvailable(); requireControl(); return bridge('/files', 'POST', { action: 'delete', path: targetPath }); }
  async function moveFile(fromPath, toPath) { await controlAvailable(); requireControl(); return bridge('/files', 'POST', { action: 'move', from: fromPath, to: toPath }); }
  async function createFolder(dirPath) { await controlAvailable(); requireControl(); return bridge('/files', 'POST', { action: 'mkdir', path: dirPath }); }
  async function runPythonScript(code, args) { await controlAvailable(); requireControl(); return bridge('/files', 'POST', { action: 'run_python', code, args }); }

  // URL in the foreground browser window's address bar — or in the window
  // `handle` (from listWindows) — via the bridge (v3, read-only UI
  // Automation: no keystrokes, no clipboard). null when unknown.
  async function browserUrl(handle) {
    await ping();
    if (!available() || !hasFeature('browser-url')) return null;
    const q = /^\d+$/.test(String(handle ?? '')) ? `?handle=${handle}` : '';
    try { const r = await bridge(`/browser-url${q}`, 'GET'); return r.url ? r : null; }
    catch (_) { return null; }
  }

  window.ClavisPC = {
    ping, available, bridgeInfo, hasFeature, open, saveNote, screenshot, peek, activeWindow, copyImage, copyText, download, resolveWebTarget,
    APPS, matchApps, matchApp, appFor, launchApp, findWindows, waitForWindow, isClavisTitle, browserUrl,
    controlAvailable, screenSize, moveMouse, click, scroll, drag, typeText, pressKeys,
    listWindows, getCursorPosition, minimizeWindow, maximizeWindow, restoreWindow, focusWindow, closeWindow,
    listFiles, searchFiles, readFile, writeFile, deleteFile, moveFile, createFolder, runPythonScript,
  };
  // No eager probe at load: every command awaits ping() before acting, so the
  // bridge status is checked lazily only when a PC feature is actually used.
})();
