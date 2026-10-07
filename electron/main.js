'use strict';

const { app, BrowserWindow, dialog, session, shell, Menu, ipcMain } = require('electron');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const { backendOrigin } = require('./runtime-config');

const APP_ORIGIN = 'http://localhost:3210';
const configPath = path.join(__dirname, 'desktop-config.json');
const config = fs.existsSync(configPath) ? JSON.parse(fs.readFileSync(configPath, 'utf8')) : {};
let backendUrl = process.env.CLAVIS_BACKEND_URL || config.backendUrl || (!app.isPackaged ? 'http://localhost:8000' : '');
let supabaseHost = config.supabaseUrl ? new URL(config.supabaseUrl).hostname : '';
let uiServer;
let bridgeServer;
let backendProcess;
let mainWindow;
let backendStarting = false;
let connecting = false;

/* Start the API ourselves when this build points at localhost.
 *
 * The window used to come up and then fail sign-in with "check your internet
 * connection", because nothing was listening on :8000 — the UI server and the
 * bridge were started here, the backend never was. On a developer machine
 * that is just a missing step; a customer build points at an HTTPS backend,
 * where this does nothing at all. */
function isLocalBackend(url) {
  try {
    const host = new URL(url).hostname;
    return host === 'localhost' || host === '127.0.0.1' || host === '::1';
  } catch (_) { return false; }
}

async function startLocalBackend() {
  if (app.isPackaged || backendStarting || backendProcess || !backendUrl || !isLocalBackend(backendUrl)) return;
  backendStarting = true;
  try {
  // Already running (a dev shell, or a previous launch that outlived us)?
  // Starting a second uvicorn would just fail to bind the port.
  if (await backendIsUp(backendUrl, 1200)) return;
  const root = path.join(__dirname, '..');
  const script = path.join(root, 'scripts', 'start-backend.ps1');
  // Customer installers ship no .ps1 at all, so this is also the "am I running
  // from source" test. Nothing to start, nothing to apologise for.
  if (!fs.existsSync(script)) return;

  const port = (() => { try { return new URL(backendUrl).port || '8000'; } catch (_) { return '8000'; } })();
  try {
    backendProcess = spawn(
      'powershell.exe',
      ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', script, '-Port', port],
      { cwd: root, windowsHide: true, stdio: 'ignore', env: { ...process.env, CLAVIS_WARM_KOKORO: 'false' } }
    );
    backendProcess.on('error', (err) => {
      console.error('Local backend could not start:', err.message);
      backendProcess = null;
    });
    backendProcess.on('exit', () => { backendProcess = null; });
  } catch (err) {
    console.error('Local backend could not start:', err.message);
  }
  } finally { backendStarting = false; }
}

if (!app.requestSingleInstanceLock()) app.exit(0);

function isAuthNavigation(rawUrl) {
  try {
    const url = new URL(rawUrl);
    return url.protocol === 'https:' && (
      (supabaseHost && url.hostname === supabaseHost && url.pathname.startsWith('/auth/v1/')) ||
      url.hostname === 'accounts.google.com'
    );
  } catch (_) { return false; }
}

function isAppNavigation(rawUrl) {
  try { return new URL(rawUrl).origin === APP_ORIGIN; } catch (_) { return false; }
}

/* Is the API answering yet?
 *
 * The window used to open straight onto the sign-in screen while the backend
 * was still booting, so the first thing a new user saw was a red failure.
 * Now the window opens on a quiet splash and only swaps to the app once the
 * API answers — which is what "click the icon and it just works" means.
 *
 * Electron 38 ships Node 20, so fetch and AbortSignal.timeout are built in;
 * no dependency for a nine-line health check. */
async function backendIsUp(url, timeoutMs = 2500) {
  try {
    const res = await fetch(`${url.replace(/\/+$/, '')}/health`, { signal: AbortSignal.timeout(timeoutMs), redirect: 'error' });
    const health = await res.json();
    return res.ok && health.status === 'healthy' && health.services?.db === 'ok';
  } catch (_) { return false; }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1380,
    height: 900,
    minWidth: 640,
    minHeight: 480,
    show: false,
    autoHideMenuBar: true,
    title: 'Rudra24 AI',
    icon: path.join(__dirname, '..', 'assets', 'rudra24-icon.png'),
    webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true,
      preload: path.join(__dirname, 'preload.js'), devTools: !app.isPackaged }
  });
  mainWindow.once('ready-to-show', () => mainWindow.show());
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) shell.openExternal(url);
    return { action: 'deny' };
  });
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (isAppNavigation(url) || isAuthNavigation(url)) return;
    event.preventDefault();
    if (url.startsWith('https://')) shell.openExternal(url);
  });
  // Render immediately. A sleeping/offline API must never hold the window
  // behind a 45–180 second health check. Existing auth handles availability.
  mainWindow.loadURL(`${APP_ORIGIN}/${backendUrl ? 'index.html#jarvis' : 'desktop-setup.html'}`);
}

app.on('second-instance', () => {
  if (!mainWindow) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.focus();
});

app.whenReady().then(async () => {
  const savedPath = path.join(app.getPath('userData'), 'connection.json');
  if (fs.existsSync(savedPath)) {
    try {
      const saved = JSON.parse(fs.readFileSync(savedPath, 'utf8'));
      backendUrl = backendOrigin(saved.backendUrl, !app.isPackaged);
      supabaseHost = saved.supabaseUrl ? new URL(saved.supabaseUrl).hostname : '';
    } catch (_) { backendUrl = ''; }
  }
  if (backendUrl) {
    try { backendUrl = backendOrigin(backendUrl, !app.isPackaged); }
    catch (_) { backendUrl = ''; }
  }
  process.env.CLAVIS_DESKTOP_BACKEND_URL = backendUrl;
  process.env.CLAVIS_BRIDGE_TOKEN = crypto.randomBytes(32).toString('hex');
  process.env.CLAVIS_BRIDGE_ORIGINS = APP_ORIGIN;
  process.env.CLAVIS_BRIDGE_PORT = '8778';
  session.defaultSession.setPermissionRequestHandler((contents, permission, callback, details) => {
    callback(permission === 'media' && isAppNavigation(contents.getURL()) &&
      (!details.securityOrigin || isAppNavigation(details.securityOrigin)) &&
      (!details.mediaTypes || details.mediaTypes.every(type => type === 'audio')));
  });
  session.defaultSession.setPermissionCheckHandler((_contents, permission, requestingOrigin, details) => {
    return permission === 'media' && details.mediaType !== 'video' &&
      isAppNavigation(requestingOrigin) &&
      (!details.securityOrigin || isAppNavigation(details.securityOrigin)) &&
      (!details.embeddingOrigin || isAppNavigation(details.embeddingOrigin));
  });

  uiServer = require('../serve-clavis.js').server;
  try {
    await new Promise((resolve, reject) => {
      uiServer.once('error', reject);
      uiServer.listen(3210, '127.0.0.1', resolve);
    });
  } catch (error) {
    dialog.showErrorBox('Rudra24 AI could not start', `Local app port 3210 is unavailable: ${error.message}`);
    app.quit();
    return;
  }

  const bridgePath = path.join(__dirname, '..', 'clavis-bridge', 'bridge.js');
  if (app.isPackaged) process.env.CLAVIS_BRIDGE_HELPERS_DIR = path.join(process.resourcesPath, 'clavis-bridge');
  bridgeServer = require(bridgePath).server;
  bridgeServer.listen(8778, '127.0.0.1');
  bridgeServer.on('error', error => console.error('PC Bridge:', error.message));

  function setupCaller(event) {
    if (!mainWindow || event.sender !== mainWindow.webContents ||
        event.senderFrame !== event.sender.mainFrame ||
        event.senderFrame.url !== `${APP_ORIGIN}/desktop-setup.html`) {
      throw new Error('Connection setup is available only in the desktop setup page.');
    }
  }
  ipcMain.handle('desktop:configuration', (event) => {
    setupCaller(event);
    return { backendUrl, localAllowed: !app.isPackaged };
  });
  ipcMain.handle('desktop:workspace', (event) => {
    setupCaller(event);
    if (!backendUrl) return false;
    mainWindow.loadURL(`${APP_ORIGIN}/index.html#jarvis`);
    return true;
  });
  ipcMain.handle('desktop:connect', async (event, rawUrl) => {
    setupCaller(event);
    if (connecting) return { ok: false, error: 'A connection check is already running.' };
    connecting = true;
    try {
      const candidate = backendOrigin(rawUrl, !app.isPackaged);
      if (!(await backendIsUp(candidate, 10000))) throw new Error('Server or database is unavailable. Check the address and try again.');
      const response = await fetch(`${candidate}/api/public-config`, { signal: AbortSignal.timeout(10000), redirect: 'error' });
      if (!response.ok) throw new Error('Server authentication setup is unavailable.');
      const publicConfig = await response.json();
      const supabaseUrl = backendOrigin(publicConfig.supabase_url);
      const key = publicConfig.supabase_publishable_key;
      if (typeof key !== 'string' || !key.trim()) throw new Error('Server has no public sign-in key configured.');
      const saved = { backendUrl: candidate, supabaseUrl };
      const temp = `${savedPath}.tmp`;
      // Check that configuration can be saved before touching local drafts.
      fs.writeFileSync(temp, JSON.stringify(saved) + '\n');
      // Validate before touching the current origin. Switching servers must
      // not carry one tenant's local drafts/session/cache to another server.
      if (backendUrl && backendUrl !== candidate) {
        const decision = await dialog.showMessageBox(mainWindow, {
          type: 'warning', title: 'Change workspace?',
          message: 'Changing servers signs you out and clears local drafts and cached data.',
          detail: 'Export unsynced work first. Server-saved records are unaffected.',
          buttons: ['Cancel', 'Change workspace'], defaultId: 0, cancelId: 0
        });
        if (decision.response !== 1) {
          fs.unlinkSync(temp);
          return { ok: false, error: 'Workspace change cancelled. Your current connection is unchanged.' };
        }
        await session.defaultSession.clearStorageData();
        await session.defaultSession.clearCache();
      }
      fs.renameSync(temp, savedPath);
      backendUrl = candidate;
      supabaseHost = new URL(supabaseUrl).hostname;
      process.env.CLAVIS_DESKTOP_BACKEND_URL = backendUrl;
      return { ok: true };
    } catch (error) { return { ok: false, error: error.message }; }
    finally { connecting = false; }
  });
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { label: 'Rudra24 AI', submenu: [
      { label: 'Connection setup', accelerator: 'CmdOrCtrl+Shift+,', click: () => mainWindow?.loadURL(`${APP_ORIGIN}/desktop-setup.html`) },
      { type: 'separator' }, { role: 'quit' }
    ] },
    { role: 'editMenu' },
    { label: 'View', submenu: [{ role: 'reload' }, { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' }, { role: 'togglefullscreen' }] }
  ]));
  createWindow();
  // Source checkout only. Customer builds never spawn Python/PowerShell.
  void startLocalBackend();
}).catch(error => {
  dialog.showErrorBox('Rudra24 AI could not start', error.message);
  app.quit();
});

app.on('window-all-closed', () => app.quit());
app.on('before-quit', () => {
  uiServer?.close();
  bridgeServer?.close();
  // Kill the TREE, not just PowerShell. start-backend.ps1 runs uvicorn as its
  // child, and killing only the parent leaves python alive holding :8000 and
  // sitting in the user's Task Manager long after the app was closed.
  if (backendProcess) {
    const pid = backendProcess.pid;
    try {
      if (process.platform === 'win32' && pid) {
        spawn('taskkill', ['/PID', String(pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
      } else {
        backendProcess.kill();
      }
    } catch (_) {}
    backendProcess = null;
  }
});
