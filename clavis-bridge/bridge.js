/**
 * ============================================================
 *  CLAVIS LOCAL BRIDGE (clavis-bridge/bridge.js)
 *  A tiny localhost helper that gives Clavis (a browser page) real
 *  OS powers a sandboxed page can never have on its own:
 *    - open an app / file / website          POST /open   {target}
 *    - launch ANY installed app by name       POST /launch {app, names?, exe?, url?}
 *    - save text and open it in Notepad       POST /notepad {text, filename?}
 *    - take a real OS screenshot (all screens) GET  /screenshot
 *    - read the foreground browser tab's URL  GET  /browser-url
 *
 *  Pure Node stdlib — no npm install needed. Run it once:
 *      node bridge.js         (or double-click Start-Bridge.bat)
 *
 *  SECURITY: binds to 127.0.0.1 only and requires a shared token
 *  (header x-clavis-token). Anything that can open apps on your PC is
 *  powerful — keep the token private and don't expose this port.
 *  ponytail: static default token + localhost bind; upgrade to a
 *  per-launch random token shown on start if you want stricter pairing.
 * ============================================================
 */
'use strict';

const http = require('http');
const { exec, execFile, spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const PORT = Number(process.env.CLAVIS_BRIDGE_PORT || 8777);
const TOKEN = process.env.CLAVIS_BRIDGE_TOKEN || 'clavis-local';
const PLATFORM = process.platform; // 'win32' | 'darwin' | 'linux'
// Mouse/keyboard control is a materially bigger grant than "open an app" or
// "take a screenshot" — it can click and type ANYWHERE on the machine. Off
// by default; the person running this bridge has to explicitly turn it on,
// separately from just starting the bridge at all.
const ALLOW_CONTROL = /^(1|true|yes)$/i.test(process.env.CLAVIS_BRIDGE_ALLOW_CONTROL || '');
// The token is a fixed string, so it can't be what keeps other websites out.
// The browser always stamps cross-site requests with their Origin: anything
// from a page that isn't Clavis itself is refused before it can do anything.
// (No Origin at all = a local script/tool, not a web page — allowed.)
const ALLOWED_ORIGINS = new Set((process.env.CLAVIS_BRIDGE_ORIGINS || 'http://localhost:3000,http://127.0.0.1:3000')
  .split(',').map((s) => s.trim()).filter(Boolean));

function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-clavis-token');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
}

function json(res, code, obj) {
  cors(res);
  res.writeHead(code, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(obj));
}

function readBody(req) {
  return new Promise((resolve) => {
    let data = '';
    req.on('data', (c) => { data += c; if (data.length > 8e6) req.destroy(); });
    req.on('end', () => { try { resolve(data ? JSON.parse(data) : {}); } catch { resolve({}); } });
    req.on('error', () => resolve({}));
  });
}

// ── OS actions ────────────────────────────────────────────
function openTarget(target) {
  return new Promise((resolve, reject) => {
    const t = String(target || '').trim();
    if (!t) return reject(new Error('No target given.'));
    if (PLATFORM === 'win32') {
      // `start` is a cmd builtin. The empty "" is the window title arg so paths
      // with spaces/quotes are handled. shell:true so the builtin resolves.
      exec(`start "" "${t.replace(/"/g, '')}"`, { windowsHide: true }, (err) => err ? reject(err) : resolve());
    } else if (PLATFORM === 'darwin') {
      execFile('open', [t], (err) => err ? reject(err) : resolve());
    } else {
      execFile('xdg-open', [t], (err) => err ? reject(err) : resolve());
    }
  });
}

function saveAndOpenNote(text, filename) {
  return new Promise((resolve, reject) => {
    let name = String(filename || '').trim() || `clavis-note-${Date.now()}.txt`;
    if (!/\.[a-z0-9]{1,6}$/i.test(name)) name += '.txt';
    name = name.replace(/[\\/:*?"<>|]/g, '_'); // strip illegal filename chars
    const dir = path.join(os.homedir(), 'Documents');
    const target = path.join(fs.existsSync(dir) ? dir : os.homedir(), name);
    fs.writeFile(target, String(text ?? ''), 'utf8', (err) => {
      if (err) return reject(err);
      const editor = PLATFORM === 'win32' ? 'notepad' : PLATFORM === 'darwin' ? 'open' : 'xdg-open';
      const args = PLATFORM === 'win32' ? [target] : [target];
      try { spawn(editor, args, { detached: true, stdio: 'ignore', windowsHide: false }).unref(); } catch (_) {}
      resolve(target);
    });
  });
}

// `start "" "<target>" "<arg>"…` — for a browser opened straight onto a page
// (and in its own window, so Clavis's window isn't hijacked). Quotes are
// stripped from every piece; inside quotes cmd treats & | ^ < > literally.
function startWithArgs(target, args) {
  return new Promise((resolve, reject) => {
    const q = (v) => `"${String(v).replace(/"/g, '')}"`;
    if (PLATFORM !== 'win32') return execFile(PLATFORM === 'darwin' ? 'open' : 'xdg-open', [String(args[args.length - 1] || target)], (err) => err ? reject(err) : resolve());
    exec(`start "" ${q(target)} ${args.map(q).join(' ')}`, { windowsHide: true }, (err) => err ? reject(err) : resolve());
  });
}

// ── Installed apps (POST /launch) ─────────────────────────────
// "Any app installed on his PC" — two sources, merged:
//   - Start-menu shortcuts (.lnk): classic desktop apps (Chrome, Office,
//     VS Code, Claude…), read straight from disk, instant.
//   - Get-StartApps (listapps.ps1): ALSO Store apps (WhatsApp, ChatGPT,
//     Calculator…) which have no .lnk; launched via shell:AppsFolder, the
//     same thing the Start menu does.
// Matching a name against what is actually installed means a missing app
// is reported as missing (so Clavis can open its web version) instead of
// `start` popping a "Windows cannot find…" dialog that blocks until closed.
const APP_CACHE_MS = 10 * 60 * 1000;
const JUNK_APP = /uninstall|read ?me|\bhelp\b|documentation|release notes|licen[cs]e|manual|website|what's new|changelog|\bsetup\b|repair/i;
let appCache = { at: 0, apps: [], ok: false };
let appScan = null;

function scanStartMenu() {
  if (PLATFORM !== 'win32') return [];
  const roots = [
    path.join(process.env.ProgramData || 'C:\\ProgramData', 'Microsoft', 'Windows', 'Start Menu', 'Programs'),
    path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), 'Microsoft', 'Windows', 'Start Menu', 'Programs'),
  ];
  const out = [];
  const walk = (dir, depth) => {
    if (depth > 4) return;
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (_) { return; }
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) walk(full, depth + 1);
      else if (/\.lnk$/i.test(e.name)) out.push({ name: e.name.replace(/\.lnk$/i, ''), target: full, kind: 'lnk' });
    }
  };
  roots.forEach((r) => walk(r, 0));
  return out;
}

function listStartApps() {
  return new Promise((resolve) => {
    if (PLATFORM !== 'win32') return resolve([]);
    execFile('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(__dirname, 'listapps.ps1')],
      { windowsHide: true, timeout: 20000, maxBuffer: 4 * 1024 * 1024 }, (err, stdout) => {
        if (err) return resolve([]);
        try {
          const parsed = JSON.parse(String(stdout || '').trim() || '[]');
          const arr = Array.isArray(parsed) ? parsed : [parsed];
          resolve(arr.filter((a) => a && a.Name && a.AppID && !/^https?:/i.test(String(a.AppID)))
            .map((a) => ({ name: String(a.Name), target: `shell:AppsFolder\\${a.AppID}`, kind: 'startapps' })));
        } catch (_) { resolve([]); }
      });
  });
}

function refreshApps() {
  if (appScan) return appScan;
  appScan = (async () => {
    const lnk = scanStartMenu();
    const store = await listStartApps();
    const seen = new Set();
    const apps = [];
    for (const a of [...store, ...lnk]) {
      const k = a.name.toLowerCase();
      if (JUNK_APP.test(a.name) || seen.has(k)) continue;
      seen.add(k);
      apps.push(a);
    }
    appCache = { at: Date.now(), apps, ok: apps.length > 0 };
    return appCache;
  })().finally(() => { appScan = null; });
  return appScan;
}

async function installedApps(force = false) {
  if (force || !appCache.ok || Date.now() - appCache.at > APP_CACHE_MS) await refreshApps();
  return appCache;
}

const normAppName = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9+#. ]+/g, ' ').replace(/\s+/g, ' ').trim();
// 1 = exact name, 0.9 = "Excel 2016" / "Google Chrome" for "chrome",
// ~0.85→0.65 = every spoken word is in the name, 0.55 = plain substring.
function scoreAppName(appName, query) {
  const a = normAppName(appName), q = normAppName(query);
  if (!a || !q) return 0;
  if (a === q) return 1;
  if (a.startsWith(q + ' ') || a.endsWith(' ' + q)) return 0.9;
  const aw = a.split(' '), qw = q.split(' ');
  if (qw.every((w) => aw.includes(w))) return Math.max(0.65, 0.85 - (aw.length - qw.length) * 0.05);
  if (q.length >= 4 && a.includes(q)) return 0.55;
  return 0;
}
function findInstalledApp(apps, candidates) {
  let best = null;
  candidates.forEach((c, ci) => {
    for (const app of apps) {
      const score = scoreAppName(app.name, c) - ci * 0.01; // the caller's first name is preferred
      if (score > (best ? best.score : 0)) best = { ...app, score };
    }
  });
  return best && best.score >= 0.64 ? best : null;
}

async function launchApp({ app, names, exe, system, url, newWindow } = {}) {
  const label = String(app || '').trim().slice(0, 80);
  if (!label) throw new Error('No app given.');
  // Only bare shell names / protocols ("winword", "spotify:") — never a command line.
  const safeExe = /^[a-z0-9._-]+:?$/i.test(String(exe || '')) ? String(exe) : '';
  const cleanUrl = typeof url === 'string' && /^https?:\/\/[^\s"]+$/i.test(url) ? url : '';
  const urlArgs = cleanUrl ? [...(newWindow ? ['--new-window'] : []), cleanUrl] : [];
  if (PLATFORM !== 'win32') { await openTarget(cleanUrl || safeExe || label); return { via: 'open', match: label }; }
  // Built-into-Windows tools (notepad, explorer, calc…) need no lookup.
  if (system && safeExe && !cleanUrl) { await openTarget(safeExe); return { via: 'system', match: label }; }
  const candidates = [...new Set([label, ...(Array.isArray(names) ? names : [])].map((n) => String(n).slice(0, 80)).filter(Boolean))].slice(0, 6);
  let cache = await installedApps();
  let hit = findInstalledApp(cache.apps, candidates);
  if (!hit && cache.ok) { cache = await installedApps(true); hit = findInstalledApp(cache.apps, candidates); } // installed since the last scan?
  if (hit) {
    if (urlArgs.length) {
      // A browser straight onto a page: its shell name takes arguments, a
      // .lnk does too; a Store AppsFolder id does not.
      if (safeExe && !safeExe.endsWith(':')) {
        try { await startWithArgs(safeExe, urlArgs); return { via: 'exe+url', match: hit.name }; } catch (_) { /* try the shortcut */ }
      }
      if (hit.kind === 'lnk') { await startWithArgs(hit.target, urlArgs); return { via: 'lnk+url', match: hit.name }; }
    }
    await openTarget(hit.target);
    if (cleanUrl) await openTarget(cleanUrl);
    return { via: hit.kind, match: hit.name };
  }
  // No app list at all (scan blocked) — the shell name is the best guess left.
  if (!cache.ok && safeExe) {
    if (urlArgs.length && !safeExe.endsWith(':')) await startWithArgs(safeExe, urlArgs);
    else await openTarget(safeExe);
    return { via: 'exe', match: label };
  }
  const err = new Error(`No installed app matches "${label}" (not installed).`);
  err.code = 'NOT_INSTALLED';
  throw err;
}

// URL in a browser window's address bar, via UI Automation (browserurl.ps1)
// — read-only: no keystrokes, no clipboard. Foreground window by default.
function browserUrl(handle) {
  return new Promise((resolve) => {
    if (PLATFORM !== 'win32') return resolve('');
    const args = ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(__dirname, 'browserurl.ps1')];
    if (/^\d{1,20}$/.test(String(handle || ''))) args.push('-Handle', String(handle));
    execFile('powershell', args, { windowsHide: true, timeout: 15000 }, (err, stdout) => {
      if (err) return resolve('');
      resolve(String(stdout || '').trim().split(/\r?\n/)[0].slice(0, 2000));
    });
  });
}

// clipboard=true also copies the image to the OS clipboard. The temp file is
// always deleted after it is read, so no screenshot is ever left on disk.
function screenshot(clipboard = true) {
  return new Promise((resolve, reject) => {
    const out = path.join(os.tmpdir(), `clavis-shot-${Date.now()}.png`);
    const done = () => {
      fs.readFile(out, (err, buf) => {
        if (err) return reject(new Error('Screenshot capture failed.'));
        fs.unlink(out, () => {});
        resolve(`data:image/png;base64,${buf.toString('base64')}`);
      });
    };
    if (PLATFORM === 'win32') {
      const args = ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(__dirname, 'screenshot.ps1'), '-Out', out];
      if (clipboard) args.push('-Clipboard');
      execFile('powershell', args, { windowsHide: true }, (err) => err ? reject(err) : done());
    } else if (PLATFORM === 'darwin') {
      const cmd = clipboard ? `screencapture -x "${out}" && osascript -e 'set the clipboard to (read (POSIX file "${out}") as JPEG picture)'` : `screencapture -x "${out}"`;
      exec(cmd, (err) => err ? reject(err) : done());
    } else {
      // Try common Linux tools in order.
      exec(`gnome-screenshot -f "${out}" || import -window root "${out}" || scrot "${out}"`, (err) => {
        if (err) return reject(err);
        if (clipboard) exec(`xclip -selection clipboard -t image/png -i "${out}"`, () => done());
        else done();
      });
    }
  });
}

// ── Persistent Windows helper processes ──────────────────────
// Measured on this machine: a FRESH `powershell -File ...` that does
// `Add-Type` (even just -AssemblyName, no C# compile) reliably takes 7-9.5s
// to start — not a one-off cold-boot cost, every single spawn pays it.
// A 4s per-call timeout (the original design) meant /active-window silently
// failed on every real call. Spawning ONE long-lived PowerShell process per
// helper and reusing it (activewindow.ps1's -Loop mode was already built for
// this, just never wired up; pccontrol.ps1 gets the same treatment below)
// pays that startup cost exactly once instead of once per request.
let activeWindowProc = null;
let activeWindowLatest = { title: '', process: '', idleMs: 0 };
function ensureActiveWindowLoop() {
  if (activeWindowProc && !activeWindowProc.killed) return;
  activeWindowProc = spawn('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(__dirname, 'activewindow.ps1'), '-Loop', '-IntervalMs', '1000'],
    { windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] });
  let buf = '';
  activeWindowProc.stdout.on('data', (chunk) => {
    buf += chunk.toString();
    let nl;
    while ((nl = buf.indexOf('\n')) !== -1) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (!line) continue;
      try { activeWindowLatest = JSON.parse(line); } catch (_) { /* keep last good value */ }
    }
  });
  activeWindowProc.on('exit', () => { activeWindowProc = null; });
  activeWindowProc.on('error', () => { activeWindowProc = null; });
}

// Read-only awareness: which window/tab is in front, and how long the user has
// been idle. This is what lets Clavis be proactive without watching pixels.
function activeWindow() {
  return new Promise((resolve, reject) => {
    if (PLATFORM === 'win32') {
      ensureActiveWindowLoop();
      // The loop process needs ~7-9s to report its first line after a cold
      // spawn; poll the cache briefly instead of blocking the whole request
      // on that first sample, and fail fast (not silently) if it never comes.
      const start = Date.now();
      const poll = () => {
        if (activeWindowLatest.title || activeWindowLatest.process || Date.now() - start > 12000) {
          return resolve(activeWindowLatest);
        }
        setTimeout(poll, 200);
      };
      poll();
    } else if (PLATFORM === 'darwin') {
      const script = 'tell application "System Events" to get {name of first application process whose frontmost is true}';
      execFile('osascript', ['-e', script], { timeout: 4000 }, (err, stdout) => {
        if (err) return reject(new Error('Active window read failed.'));
        const proc = String(stdout).trim();
        resolve({ title: proc, process: proc, idleMs: 0 });
      });
    } else {
      exec('xdotool getactivewindow getwindowname', { timeout: 4000 }, (err, stdout) => {
        if (err) return reject(new Error('Active window read failed (install xdotool).'));
        const title = String(stdout).trim();
        resolve({ title, process: '', idleMs: 0 });
      });
    }
  });
}

// Real screen bounds (can start at a negative x/y when a monitor sits left of
// the primary one) so the browser can clamp/translate coordinates before
// asking us to click somewhere.
function screenSize() {
  return new Promise((resolve, reject) => {
    if (PLATFORM !== 'win32') return reject(new Error('screen-size is currently Windows-only.'));
    // A .ps1 file, like every other bridge action, rather than an inline
    // -Command string — Node's execFile has to reconstruct a single Windows
    // command line from the args array, which mis-quotes strings that mix
    // semicolons and embedded double quotes (that bit us here in testing).
    // Cold PowerShell + Add-Type(System.Windows.Forms) startup measured ~7s on
    // a plain build of this machine — a 4s timeout was killing it before it
    // could ever answer. 12s gives real headroom; a warm run is near-instant.
    execFile('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(__dirname, 'screensize.ps1')],
      { windowsHide: true, timeout: 12000 }, (err, stdout, stderr) => {
        if (err) return reject(new Error(stderr || 'Could not read screen size.'));
        const [left, top, width, height] = String(stdout).trim().split(',').map(Number);
        resolve({ left, top, width, height });
      });
  });
}

// One mouse/keyboard action, described as JSON, sent as a line to the
// persistent pccontrol.ps1 process (see the note above ensureActiveWindowLoop
// for why persistent — a fresh spawn per action would cost several seconds
// EACH, which is unusable for "click here, then type this"). Requests are
// serialised (one in flight at a time) since stdout lines would otherwise be
// impossible to correlate to the right caller.
let pcControlProc = null;
let pcControlReady = null; // Promise that resolves once the child prints {"ready":true}
let pcControlQueue = Promise.resolve();
let pcControlLineBuf = '';
let pcControlPendingResolvers = []; // FIFO — one per in-flight line, since requests are serialised

function ensurePcControlLoop() {
  if (pcControlProc && !pcControlProc.killed) return pcControlReady;
  pcControlLineBuf = '';
  pcControlPendingResolvers = [];
  pcControlProc = spawn('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(__dirname, 'pccontrol.ps1')],
    { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
  pcControlReady = new Promise((resolveReady) => {
    let readyResolved = false;
    pcControlProc.stdout.on('data', (chunk) => {
      pcControlLineBuf += chunk.toString();
      let nl;
      while ((nl = pcControlLineBuf.indexOf('\n')) !== -1) {
        const line = pcControlLineBuf.slice(0, nl).trim();
        pcControlLineBuf = pcControlLineBuf.slice(nl + 1);
        if (!line) continue;
        let parsed; try { parsed = JSON.parse(line); } catch (_) { continue; }
        if (parsed.ready && !readyResolved) { readyResolved = true; resolveReady(); continue; }
        const resolver = pcControlPendingResolvers.shift();
        if (resolver) resolver(parsed);
      }
    });
    pcControlProc.on('exit', () => {
      pcControlProc = null; pcControlReady = null;
      // Any request still waiting on this dead process must not hang forever.
      for (const resolver of pcControlPendingResolvers.splice(0)) resolver({ ok: false, error: 'pc-control helper exited unexpectedly.' });
    });
    pcControlProc.on('error', () => { pcControlProc = null; pcControlReady = null; });
    // Cold Add-Type C# compile measured several seconds on this class of
    // machine; give it real room rather than assuming it's instant.
    setTimeout(() => { if (!readyResolved) { readyResolved = true; resolveReady(); } }, 15000);
  });
  return pcControlReady;
}

function pcControl(payload) {
  if (PLATFORM !== 'win32') return Promise.reject(new Error('PC control is currently Windows-only.'));
  const action = String(payload?.action || '');
  if (!['move', 'click', 'scroll', 'drag', 'type', 'key'].includes(action)) {
    return Promise.reject(new Error(`Unknown action: ${action}`));
  }
  // Chain onto the queue so two near-simultaneous requests (e.g. the model
  // clicking then immediately typing) never interleave on the shared pipe.
  const run = pcControlQueue.then(async () => {
    await ensurePcControlLoop();
    if (!pcControlProc) throw new Error('PC control helper is not running.');
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        const idx = pcControlPendingResolvers.indexOf(onResult);
        if (idx !== -1) pcControlPendingResolvers.splice(idx, 1);
        reject(new Error('PC control action timed out.'));
      }, 5000);
      function onResult(result) {
        clearTimeout(timer);
        if (result?.ok) resolve(); else reject(new Error(result?.error || 'PC control action failed.'));
      }
      pcControlPendingResolvers.push(onResult);
      pcControlProc.stdin.write(JSON.stringify(payload) + '\n');
    });
  });
  // Keep the queue alive even after a rejection, and don't let one caller's
  // catch block swallow a later caller's turn.
  pcControlQueue = run.catch(() => {});
  return run;
}

// One window-management action, described as JSON, sent to the persistent
// windowcontrol.ps1 process. Deliberately a SEPARATE process from
// pcControl above (see windowcontrol.ps1's header comment for why).
let windowControlProc = null;
let windowControlReady = null;
let windowControlQueue = Promise.resolve();
let windowControlLineBuf = '';
let windowControlPendingResolvers = [];

function ensureWindowControlLoop() {
  if (windowControlProc && !windowControlProc.killed) return windowControlReady;
  windowControlLineBuf = '';
  windowControlPendingResolvers = [];
  windowControlProc = spawn('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(__dirname, 'windowcontrol.ps1')],
    { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
  windowControlReady = new Promise((resolveReady) => {
    let readyResolved = false;
    windowControlProc.stdout.on('data', (chunk) => {
      windowControlLineBuf += chunk.toString();
      let nl;
      while ((nl = windowControlLineBuf.indexOf('\n')) !== -1) {
        const line = windowControlLineBuf.slice(0, nl).trim();
        windowControlLineBuf = windowControlLineBuf.slice(nl + 1);
        if (!line) continue;
        let parsed; try { parsed = JSON.parse(line); } catch (_) { continue; }
        if (parsed.ready && !readyResolved) { readyResolved = true; resolveReady(); continue; }
        const resolver = windowControlPendingResolvers.shift();
        if (resolver) resolver(parsed);
      }
    });
    windowControlProc.on('exit', () => {
      windowControlProc = null; windowControlReady = null;
      for (const resolver of windowControlPendingResolvers.splice(0)) resolver({ ok: false, error: 'window-control helper exited unexpectedly.' });
    });
    windowControlProc.on('error', () => { windowControlProc = null; windowControlReady = null; });
    setTimeout(() => { if (!readyResolved) { readyResolved = true; resolveReady(); } }, 15000);
  });
  return windowControlReady;
}

function windowControl(payload) {
  if (PLATFORM !== 'win32') return Promise.reject(new Error('Window control is currently Windows-only.'));
  const action = String(payload?.action || '');
  if (!['list', 'minimize', 'maximize', 'restore', 'close', 'focus', 'cursor'].includes(action)) {
    return Promise.reject(new Error(`Unknown action: ${action}`));
  }
  const run = windowControlQueue.then(async () => {
    await ensureWindowControlLoop();
    if (!windowControlProc) throw new Error('Window control helper is not running.');
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        const idx = windowControlPendingResolvers.indexOf(onResult);
        if (idx !== -1) windowControlPendingResolvers.splice(idx, 1);
        reject(new Error('Window control action timed out.'));
      }, 5000);
      function onResult(result) {
        clearTimeout(timer);
        if (result?.ok) resolve(result); else reject(new Error(result?.error || 'Window control action failed.'));
      }
      windowControlPendingResolvers.push(onResult);
      windowControlProc.stdin.write(JSON.stringify(payload) + '\n');
    });
  });
  windowControlQueue = run.catch(() => {});
  return run;
}

// ── File operations (native bridge only, same ALLOW_CONTROL gate as
//    mouse/keyboard and window control — reading, writing or deleting
//    arbitrary files is at least as big a grant). Every call is a plain
//    one-shot fs Promise, no persistent helper process needed. ────────
const MAX_READ_BYTES = 512 * 1024; // plenty for text/code/config, keeps binaries out of chat
const MAX_SEARCH_RESULTS = 200;
const MAX_SEARCH_DEPTH = 6;

function resolveFsPath(p) {
  const t = String(p || '').trim();
  if (!t || t === '~') return os.homedir();
  const expanded = (t.startsWith('~/') || t.startsWith('~\\')) ? path.join(os.homedir(), t.slice(2)) : t;
  return path.resolve(expanded);
}

async function listDir(dirPath) {
  const abs = resolveFsPath(dirPath || os.homedir());
  const dirents = await fs.promises.readdir(abs, { withFileTypes: true });
  const entries = dirents.map((e) => {
    let size = null, mtime = null;
    try { const st = fs.statSync(path.join(abs, e.name)); size = st.size; mtime = st.mtimeMs; } catch (_) {}
    return { name: e.name, type: e.isDirectory() ? 'dir' : e.isSymbolicLink() ? 'link' : 'file', size, mtime };
  });
  return { path: abs, entries };
}

async function searchFiles(rootPath, query) {
  const abs = resolveFsPath(rootPath || os.homedir());
  const q = String(query || '').toLowerCase();
  if (!q) throw new Error('No search query given.');
  const results = [];
  async function walk(dir, depth) {
    if (results.length >= MAX_SEARCH_RESULTS || depth > MAX_SEARCH_DEPTH) return;
    let entries;
    try { entries = await fs.promises.readdir(dir, { withFileTypes: true }); } catch (_) { return; }
    for (const e of entries) {
      if (results.length >= MAX_SEARCH_RESULTS) return;
      const full = path.join(dir, e.name);
      if (e.name.toLowerCase().includes(q)) results.push(full);
      if (e.isDirectory()) await walk(full, depth + 1);
    }
  }
  await walk(abs, 0);
  return { results };
}

async function readTextFile(filePath) {
  const abs = resolveFsPath(filePath);
  const st = await fs.promises.stat(abs);
  if (st.isDirectory()) throw new Error('That is a folder, not a file.');
  if (st.size > MAX_READ_BYTES) throw new Error(`File is too large to read here (${Math.round(st.size / 1024)}KB, limit ${MAX_READ_BYTES / 1024}KB).`);
  const content = await fs.promises.readFile(abs, 'utf8');
  return { path: abs, content };
}

async function writeTextFile(filePath, content) {
  const abs = resolveFsPath(filePath);
  await fs.promises.mkdir(path.dirname(abs), { recursive: true });
  await fs.promises.writeFile(abs, String(content ?? ''), 'utf8');
  return { path: abs };
}

async function deleteFileOrFolder(targetPath) {
  const abs = resolveFsPath(targetPath);
  const st = await fs.promises.stat(abs);
  if (st.isDirectory()) await fs.promises.rm(abs, { recursive: true });
  else await fs.promises.unlink(abs);
  return { path: abs };
}

async function moveFileOrFolder(fromPath, toPath) {
  const from = resolveFsPath(fromPath);
  const to = resolveFsPath(toPath);
  await fs.promises.mkdir(path.dirname(to), { recursive: true });
  await fs.promises.rename(from, to);
  return { from, to };
}

async function createFolder(dirPath) {
  const abs = resolveFsPath(dirPath);
  await fs.promises.mkdir(abs, { recursive: true });
  return { path: abs };
}

// Runs a short Python script and returns its captured output. Tries the
// `python` command first, falling back to the Windows `py` launcher if
// that one isn't on PATH.
// ponytail: no sandboxing beyond the OS's own file permissions -- this runs
// with the same rights as whoever started the bridge. The confirm-before-
// every-call gate (see clavis-mind.js RISKY) is the real guard here, not
// the process itself; a locked-down sandbox is future work if ever needed.
function runPythonScript(code, args) {
  return new Promise((resolve, reject) => {
    const tmp = path.join(os.tmpdir(), `clavis-script-${Date.now()}.py`);
    fs.writeFile(tmp, String(code ?? ''), 'utf8', (err) => {
      if (err) return reject(err);
      const cleanup = () => fs.unlink(tmp, () => {});
      const argv = [tmp, ...(Array.isArray(args) ? args.map(String) : [])];
      const runWith = (cmd) => execFile(cmd, argv, { timeout: 30000, maxBuffer: 2 * 1024 * 1024 }, (error, stdout, stderr) => {
        if (error && error.code === 'ENOENT' && cmd === 'python') { runWith('py'); return; }
        cleanup();
        if (error && !stdout && !stderr) return reject(new Error(error.message));
        resolve({ stdout: String(stdout || ''), stderr: String(stderr || ''), exitError: error ? error.message : null });
      });
      runWith('python');
    });
  });
}

// ── Router ────────────────────────────────────────────────
// Advertised on /ping so the browser knows which endpoints this build has
// (an older bridge without them still works through /open).
const FEATURES = ['launch', 'apps', 'browser-url', 'focus-verify'];

const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') { cors(res); res.writeHead(204); return res.end(); }

  const url = new URL(req.url, `http://127.0.0.1:${PORT}`);

  const origin = req.headers.origin;
  if (origin && !ALLOWED_ORIGINS.has(origin)) return json(res, 403, { ok: false, error: 'This page is not allowed to use the Clavis bridge.' });

  // /ping is unauthenticated so the browser can detect the bridge is up.
  if (url.pathname === '/ping') return json(res, 200, { ok: true, platform: PLATFORM, name: 'clavis-bridge', version: 3, controlEnabled: ALLOW_CONTROL, features: FEATURES });

  if ((req.headers['x-clavis-token'] || '') !== TOKEN) return json(res, 401, { ok: false, error: 'Bad or missing bridge token.' });

  try {
    if (url.pathname === '/open' && req.method === 'POST') {
      const { target } = await readBody(req);
      await openTarget(target);
      return json(res, 200, { ok: true, opened: target });
    }
    if (url.pathname === '/launch' && req.method === 'POST') {
      // Same grant as /open (start an app) — no ALLOW_CONTROL needed.
      try {
        const r = await launchApp(await readBody(req));
        return json(res, 200, { ok: true, ...r });
      } catch (err) {
        return json(res, err.code === 'NOT_INSTALLED' ? 404 : 500, { ok: false, error: err.message || String(err) });
      }
    }
    if (url.pathname === '/apps' && req.method === 'GET') {
      const { apps } = await installedApps(url.searchParams.get('refresh') === '1');
      return json(res, 200, { ok: true, apps: apps.map((a) => a.name).slice(0, 500) });
    }
    if (url.pathname === '/browser-url' && req.method === 'GET') {
      // Read-only like /active-window: which page is in front, nothing clicked.
      const found = await browserUrl(url.searchParams.get('handle'));
      return json(res, 200, { ok: true, url: found, title: activeWindowLatest.title || '', process: activeWindowLatest.process || '' });
    }
    if (url.pathname === '/notepad' && req.method === 'POST') {
      const { text, filename } = await readBody(req);
      const saved = await saveAndOpenNote(text, filename);
      return json(res, 200, { ok: true, path: saved });
    }
    if (url.pathname === '/screenshot' && req.method === 'GET') {
      // Clipboard by default; pass ?clipboard=0 to skip it.
      const wantClip = url.searchParams.get('clipboard') !== '0';
      const dataUrl = await screenshot(wantClip);
      return json(res, 200, { ok: true, dataUrl, clipboard: wantClip });
    }
    if (url.pathname === '/active-window' && req.method === 'GET') {
      const info = await activeWindow();
      return json(res, 200, { ok: true, ...info });
    }
    if (url.pathname === '/screen-size' && req.method === 'GET') {
      const size = await screenSize();
      return json(res, 200, { ok: true, ...size });
    }
    if (url.pathname === '/pc-control' && req.method === 'POST') {
      if (!ALLOW_CONTROL) {
        return json(res, 403, { ok: false, error: 'Mouse/keyboard control is turned off on this bridge. Set CLAVIS_BRIDGE_ALLOW_CONTROL=1 (see Start-Bridge.bat) to enable it, then restart the bridge.' });
      }
      const payload = await readBody(req);
      await pcControl(payload);
      return json(res, 200, { ok: true, action: payload.action });
    }
    if (url.pathname === '/pc-window' && req.method === 'POST') {
      if (!ALLOW_CONTROL) {
        return json(res, 403, { ok: false, error: 'Window control is turned off on this bridge. Set CLAVIS_BRIDGE_ALLOW_CONTROL=1 (see Start-Bridge.bat) to enable it, then restart the bridge.' });
      }
      const payload = await readBody(req);
      const result = await windowControl(payload);
      return json(res, 200, { ok: true, action: payload.action, ...result });
    }
    if (url.pathname === '/files' && req.method === 'POST') {
      if (!ALLOW_CONTROL) {
        return json(res, 403, { ok: false, error: 'File access is turned off on this bridge. Set CLAVIS_BRIDGE_ALLOW_CONTROL=1 (see Start-Bridge.bat) to enable it, then restart the bridge.' });
      }
      const payload = await readBody(req);
      const action = String(payload.action || '');
      let result;
      if (action === 'list') result = await listDir(payload.path);
      else if (action === 'search') result = await searchFiles(payload.path, payload.query);
      else if (action === 'read') result = await readTextFile(payload.path);
      else if (action === 'write') result = await writeTextFile(payload.path, payload.content);
      else if (action === 'delete') result = await deleteFileOrFolder(payload.path);
      else if (action === 'move') result = await moveFileOrFolder(payload.from, payload.to);
      else if (action === 'mkdir') result = await createFolder(payload.path);
      else if (action === 'run_python') result = await runPythonScript(payload.code, payload.args);
      else return json(res, 400, { ok: false, error: `Unknown file action: ${action}` });
      return json(res, 200, { ok: true, action, ...result });
    }
    return json(res, 404, { ok: false, error: 'Unknown endpoint.' });
  } catch (err) {
    return json(res, 500, { ok: false, error: err.message || String(err) });
  }
});

// Only listen when run directly (`node bridge.js` / the .bat files); a
// `require()` from a test gets the pure helpers below without a server.
if (require.main === module) {
  server.listen(PORT, '127.0.0.1', () => {
    console.log(`\n  Clavis bridge running → http://127.0.0.1:${PORT}`);
    console.log(`  Platform: ${PLATFORM}   Token: ${TOKEN === 'clavis-local' ? 'clavis-local (default)' : '(custom)'}`);
    console.log('  Endpoints: POST /open, POST /launch, POST /notepad, GET /screenshot, GET /active-window, GET /browser-url, GET /screen-size, GET /apps');
    console.log(`  Mouse/keyboard control (POST /pc-control): ${ALLOW_CONTROL ? 'ENABLED — Clavis can move the mouse and type on this PC.' : 'off (set CLAVIS_BRIDGE_ALLOW_CONTROL=1 to enable)'}`);
    console.log('  Keep this window open. Close it to revoke Clavis\'s PC access.\n');
    // Warm the installed-app list so the first "excel kholo" is instant.
    if (PLATFORM === 'win32') setTimeout(() => { refreshApps().catch(() => {}); }, 1500);
  });
  server.on('error', (e) => {
    if (e.code === 'EADDRINUSE') console.error(`  Port ${PORT} is busy — the bridge may already be running.`);
    else console.error('  Bridge error:', e.message);
  });
}
module.exports = { scoreAppName, findInstalledApp, launchApp, FEATURES, server };

// "Close this window to revoke Clavis's access" must be true for the helper
// processes too, not just the HTTP server — kill them on any exit path.
function killHelpers() {
  try { activeWindowProc?.kill(); } catch (_) {}
  try { pcControlProc?.kill(); } catch (_) {}
  try { windowControlProc?.kill(); } catch (_) {}
}
process.on('exit', killHelpers);
process.on('SIGINT', () => { killHelpers(); process.exit(0); });
process.on('SIGTERM', () => { killHelpers(); process.exit(0); });
