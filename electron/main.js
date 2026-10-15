'use strict';

const { app, BrowserWindow, dialog, session, shell, Menu, ipcMain } = require('electron');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const { backendOrigin, discoverWorkspace } = require('./runtime-config');
const { UIUpdates } = require('./ui-updates');
const updateTrust = require('./update-trust.json');

const APP_ORIGIN = 'http://localhost:3210';
const configPath = path.join(__dirname, 'desktop-config.json');
let config = {};
try { if (fs.existsSync(configPath)) config = JSON.parse(fs.readFileSync(configPath, 'utf8')); }
catch (_) { console.warn('Desktop configuration is unreadable; connection recovery is available.'); }
const serviceUrl = process.env.CLAVIS_SERVICE_CONFIG_URL || config.serviceConfigUrl || '';
let backendUrl = process.env.CLAVIS_BACKEND_URL || config.backendUrl || (!app.isPackaged ? 'http://127.0.0.1:8000' : '');
let supabaseHost = '';
try { if (config.supabaseUrl) supabaseHost = new URL(config.supabaseUrl).hostname; } catch (_) {}
let uiServer;
let bridgeServer;
let backendProcess;
let mainWindow;
let backendStarting = false;
let connecting = false;
let uiUpdates;
let staticServer;
let bootTimer;
let googleLoginUntil = 0;

function recoverUI() {
  if (!uiUpdates?.state.attempting) return;
  clearTimeout(bootTimer);
  staticServer.setUIRoot(uiUpdates.fallback());
  mainWindow?.loadURL(`${APP_ORIGIN}/index.html#jarvis`);
}

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
      autoplayPolicy: 'no-user-gesture-required', // login film may start with its soft narration
      preload: path.join(__dirname, 'preload.js'), devTools: !app.isPackaged }
  });
  mainWindow.once('ready-to-show', () => mainWindow.show());
  mainWindow.webContents.on('render-process-gone', recoverUI);
  mainWindow.webContents.on('did-fail-load', (_event, code, _description, _url, isMainFrame) => {
    if (isMainFrame && code !== -3) recoverUI();
  });
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
  // A renderer that never acknowledges boot is reverted on next launch. A timer
  // must not reload a window that may already contain a draft or active call.
  if (uiUpdates?.state.attempting && backendUrl) bootTimer = setTimeout(() => {
    console.warn('UI update did not confirm startup; previous UI will be used on next launch.');
  }, 90000);
}

app.on('second-instance', () => {
  if (!mainWindow) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.focus();
});

app.whenReady().then(async () => {
  if (app.isPackaged) process.env.CLAVIS_MANAGED_ACCESS = 'true';
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

  staticServer = require('../serve-clavis.js');
  staticServer.setAuthCallback(url => {
    if (!googleLoginUntil || Date.now() > googleLoginUntil || url.origin !== APP_ORIGIN || url.pathname !== '/') return false;
    const code = url.searchParams.get('code');
    const denied = url.searchParams.has('error');
    if ((!code || code.length > 4096 || /[\r\n]/.test(code)) && !denied) return false;
    googleLoginUntil = 0;
    const query = denied ? 'error=access_denied&error_description=Google%20sign-in%20was%20cancelled'
      : 'code=' + encodeURIComponent(code);
    mainWindow.loadURL(`${APP_ORIGIN}/index.html?${query}#jarvis`);
    mainWindow.show(); mainWindow.focus();
    return true;
  });
  uiUpdates = new UIUpdates(path.join(app.getPath('userData'), 'ui-releases'), path.join(__dirname, '..'), app.getVersion(), updateTrust);
  staticServer.setUIRoot(uiUpdates.start());
  uiServer = staticServer.server;
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
  function workspaceCaller(event) {
    if (!mainWindow || event.sender !== mainWindow.webContents || event.senderFrame !== event.sender.mainFrame ||
        new URL(event.senderFrame.url).origin !== APP_ORIGIN || new URL(event.senderFrame.url).pathname !== '/index.html') {
      throw new Error('Desktop updates are available only in the workspace.');
    }
  }
  ipcMain.handle('desktop:google-sign-in', async (event, rawUrl) => {
    workspaceCaller(event);
    const url = new URL(rawUrl);
    const expectedHost = supabaseHost || new URL(require('../public-auth-config.json').supabase_url).hostname;
    if (url.protocol !== 'https:' || url.hostname !== expectedHost || url.port || url.username || url.password || url.hash ||
        url.pathname !== '/auth/v1/authorize' || url.searchParams.get('provider') !== 'google' ||
        url.searchParams.get('prompt') !== 'select_account' || url.searchParams.get('redirect_to') !== APP_ORIGIN + '/' ||
        url.searchParams.get('code_challenge_method') !== 's256' || !/^[A-Za-z0-9_-]{43,128}$/.test(url.searchParams.get('code_challenge') || '')) {
      throw new Error('Google sign-in must use this workspace and its PKCE callback.');
    }
    googleLoginUntil = Date.now() + 10 * 60 * 1000;
    try { await shell.openExternal(url.href); }
    catch (error) { googleLoginUntil = 0; throw error; }
    return true;
  });
  ipcMain.handle('desktop:hardware', event => {
    workspaceCaller(event);
    const os = require('node:os');
    return { memoryGB: os.totalmem() / 1024 ** 3, cores: os.cpus().length };
  });
  ipcMain.handle('desktop:update-status', event => { workspaceCaller(event); return uiUpdates.status(); });
  ipcMain.handle('desktop:update-stage', async (event, token) => {
    workspaceCaller(event);
    if (typeof token !== 'string' || token.length < 8 || token.length > 8192 || /[\r\n]/.test(token)) return { error: 'Invalid authenticated session' };
    try {
      const origin = backendOrigin(backendUrl, !app.isPackaged);
      const response = await fetch(origin + '/api/control/release?platform=desktop-ui', {
        headers: {Authorization: 'Bearer ' + token}, redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(15000)
      });
      if (!response.ok) throw new Error('Release discovery unavailable');
      const raw = await response.text();
      if (raw.length > 16000) throw new Error('Release metadata too large');
      const data = JSON.parse(raw);
      if (!data.release && data.rollback_from) return uiUpdates.rollbackToPrevious(data.rollback_from);
      return await uiUpdates.stage(data.release || null);
    } catch (error) { return { ...uiUpdates.status(), error: error.message }; }
  });
  ipcMain.handle('desktop:update-ready', event => {
    workspaceCaller(event); clearTimeout(bootTimer); uiUpdates.healthy(); return true;
  });
  ipcMain.handle('desktop:configuration', (event) => {
    setupCaller(event);
    return { backendUrl, localAllowed: !app.isPackaged, automaticAvailable: !!serviceUrl };
  });
  ipcMain.handle('desktop:workspace', (event) => {
    setupCaller(event);
    if (!backendUrl) return false;
    mainWindow.loadURL(`${APP_ORIGIN}/index.html#jarvis`);
    return true;
  });
  async function connectWorkspace(rawUrl) {
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
    } catch (error) {
      const offline = ['TypeError', 'AbortError', 'TimeoutError'].includes(error.name);
      return { ok: false, error: offline
        ? 'The service is temporarily unavailable. Check your internet connection and try again.'
        : error.message };
    }
    finally { connecting = false; }
  }
  ipcMain.handle('desktop:connect', (event, rawUrl) => {
    setupCaller(event);
    return connectWorkspace(rawUrl);
  });
  ipcMain.handle('desktop:auto-connect', async event => {
    setupCaller(event);
    if (backendUrl) return {ok:await backendIsUp(backendUrl, 10000),error:'Your service is temporarily unavailable. Your saved connection is unchanged.'};
    if (!serviceUrl) return {ok:false,error:'Your workspace owner has not connected the service yet. Your app is installed; no local setup is needed.'};
    try { return await connectWorkspace(await discoverWorkspace(serviceUrl, fetch)); }
    catch (_) { return {ok:false,error:'Rudra24 could not reach its service. Check your connection and try again shortly.'}; }
  });
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { label: 'Rudra24 AI', submenu: [
      { label: 'Connection setup', accelerator: 'CmdOrCtrl+Shift+,', click: () => mainWindow?.loadURL(`${APP_ORIGIN}/desktop-setup.html`) },
      { type: 'separator' }, { role: 'quit' }
    ] },
    { role: 'editMenu' },
    { label: 'View', submenu: [{ role: 'reload' }, { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' }, { role: 'togglefullscreen' }] }
  ]));
  // Optional signed NSIS shell updates are staged now and applied on a later launch.
  let nativeStartup = true;
  const nativeCheck = require('./native-updates').startNativeUpdates(app, updateTrust, () => nativeStartup && !mainWindow)
    .catch(error => console.warn('Native updates unavailable:', error.message));
  if (updateTrust.native?.enabled && fs.existsSync(path.join(app.getPath('userData'), 'native-update.json'))) {
    // ponytail: two-second startup budget; slow/offline feeds defer to another launch.
    await Promise.race([nativeCheck, new Promise(resolve => setTimeout(resolve, 2000))]);
  }
  nativeStartup = false;
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
