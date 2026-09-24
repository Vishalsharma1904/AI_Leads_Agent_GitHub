/**
 * ============================================================
 *  CLAVIS PC (clavis-pc.js)
 *  Browser client for the local bridge (clavis-bridge/bridge.js) plus
 *  safe browser-only fallbacks. Every action tries the native bridge
 *  first (real OS control) and degrades gracefully if it isn't running:
 *    - open()       bridge → else window.open (new tab)
 *    - saveNote()   bridge → else download a .txt file
 *    - screenshot() bridge (whole OS) → else getDisplayMedia (pick a screen)
 * ============================================================
 */
'use strict';

(() => {
  const url = () => localStorage.getItem('clavis_bridge_url') || 'http://127.0.0.1:8777';
  const token = () => localStorage.getItem('clavis_bridge_token') || 'clavis-local';

  let onlineCache = { at: 0, up: false };
  let displayStream = null; // cached getDisplayMedia stream (browser fallback)

  async function ping(force = false) {
    if (!force && Date.now() - onlineCache.at < 4000) return onlineCache.up;
    let up = false;
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 900);
      const res = await fetch(`${url()}/ping`, { signal: ctrl.signal });
      clearTimeout(t);
      up = res.ok;
    } catch (_) { up = false; }
    onlineCache = { at: Date.now(), up };
    return up;
  }
  function available() { return onlineCache.up; }

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

  async function open(target) {
    await ping();
    if (available()) {
      // Native: can open apps ("notepad", "spotify"), files, or URLs.
      const web = resolveWebTarget(target);
      await bridge('/open', 'POST', { target: web || target });
      return { ok: true, native: true };
    }
    const web = resolveWebTarget(target);
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
    await bridge('/pc-window', 'POST', { action: 'focus', ...windowTarget(target) });
    return { ok: true };
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

  window.ClavisPC = {
    ping, available, open, saveNote, screenshot, peek, activeWindow, copyImage, copyText, download, resolveWebTarget,
    controlAvailable, screenSize, moveMouse, click, scroll, drag, typeText, pressKeys,
    listWindows, getCursorPosition, minimizeWindow, maximizeWindow, restoreWindow, focusWindow, closeWindow,
    listFiles, searchFiles, readFile, writeFile, deleteFile, moveFile, createFolder, runPythonScript,
  };
  // No eager probe at load: every command awaits ping() before acting, so the
  // bridge status is checked lazily only when a PC feature is actually used.
})();
