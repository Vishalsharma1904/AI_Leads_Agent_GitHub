'use strict';
// Run: node tests/desktop_runtime_selftest.js (no GUI/provider calls).
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { backendOrigin } = require('../electron/runtime-config');
const source = fs.readFileSync(path.join(__dirname, '../electron/main.js'), 'utf8');

for (const value of ['http://api.example.org', 'https://localhost', 'https://127.1',
  'https://[::1]', 'https://10.0.0.1', 'https://192.168.0.2', 'https://server.local',
  'https://api.example.org/path', 'https://user:pass@api.example.org',
  'https://api.example.org/?key=x', 'https://api.example.org/#x', 'file:///app']) {
  assert.throws(() => backendOrigin(value), value);
}
assert.equal(backendOrigin('https://api.example.org/'), 'https://api.example.org');
assert.equal(backendOrigin('http://127.0.0.1:8000', true), 'http://127.0.0.1:8000');

async function desktop(dataPath) {
  const handlers = {}, menus = [], metrics = { spawned: 0, fetches: 0, storageClears: 0 };
  let window, ready;
  const fakeServer = { once() {}, listen(_port, _host, done) { done?.(); }, on() {}, close() {} };
  const session = { setPermissionRequestHandler() {}, setPermissionCheckHandler() {},
    async clearStorageData() { metrics.storageClears++; }, async clearCache() {} };
  const app = { isPackaged: true, requestSingleInstanceLock: () => true,
    getPath: () => dataPath, on() {}, quit() {},
    whenReady: () => ({ then(fn) { ready = Promise.resolve().then(fn); return ready; } }) };
  class BrowserWindow {
    constructor(options) {
      window = this; this.options = options; this.url = '';
      this.webContents = { mainFrame: { url: '' }, setWindowOpenHandler() {}, on() {}, getURL: () => this.url };
    }
    once() {} show() {} focus() {} isMinimized() { return false; }
    loadURL(url) { this.url = url; this.webContents.mainFrame.url = url; return Promise.resolve(); }
  }
  let healthy = true;
  let approveSwitch = false;
  const fakeFetch = async (url) => {
    metrics.fetches++;
    return { ok: true, json: async () => url.endsWith('/health')
      ? { status: 'healthy', services: { db: healthy ? 'ok' : 'error' } }
      : { supabase_url: 'https://project.supabase.co', supabase_publishable_key: 'sb_publishable_demo' } };
  };
  vm.runInNewContext(source, {
    __dirname: path.join(__dirname, '../electron'), URL, AbortSignal, console, setTimeout,
    process: { env: {}, platform: 'win32', resourcesPath: dataPath }, fetch: fakeFetch,
    require(name) {
      if (name === 'electron') return { app, BrowserWindow, session: { defaultSession: session },
        shell: { openExternal() {} }, dialog: {
          showErrorBox() { assert.fail('Unexpected startup error'); },
          showMessageBox: async () => ({ response: approveSwitch ? 1 : 0 }) },
        Menu: { buildFromTemplate: (menu) => menu, setApplicationMenu: (menu) => menus.push(menu) },
        ipcMain: { handle: (name, fn) => { handlers[name] = fn; } } };
      if (name === 'node:child_process') return { spawn() { metrics.spawned++; assert.fail('Packaged app started a child runtime'); } };
      if (name === '../serve-clavis.js' || name.endsWith('clavis-bridge/bridge.js') || name.endsWith('clavis-bridge\\bridge.js')) return { server: fakeServer };
      if (name === './runtime-config') return { backendOrigin };
      return require(name);
    }
  }, { filename: 'electron/main.js' });
  await ready;
  return { handlers, metrics, window, menus, setHealthy: (value) => { healthy = value; },
    approveSwitch: () => { approveSwitch = true; },
    event: () => ({ sender: window.webContents, senderFrame: window.webContents.mainFrame }) };
}

(async () => {
  const dataPath = fs.mkdtempSync(path.join(os.tmpdir(), 'rudra-desktop-test-'));
  try {
    const first = await desktop(dataPath);
    assert.equal(first.window.url, 'http://localhost:3210/desktop-setup.html');
    assert.equal(first.metrics.fetches, 0, 'Opening the window must not wait for a network request');
    assert.equal(first.window.options.webPreferences.devTools, false);
    assert.equal(first.window.options.webPreferences.sandbox, true);
    assert.throws(() => first.handlers['desktop:configuration']({ sender: {}, senderFrame: {} }));
    const iframe = { sender: first.window.webContents, senderFrame: { url: first.window.url } };
    assert.throws(() => first.handlers['desktop:configuration'](iframe), 'Subframes may not change the connection');
    let result = await first.handlers['desktop:connect'](first.event(), 'http://localhost:8000');
    assert.equal(result.ok, false);
    assert.equal(first.metrics.fetches, 0);
    result = await first.handlers['desktop:connect'](first.event(), 'https://api.example.org');
    assert.equal(result.ok, true);
    const saved = JSON.parse(fs.readFileSync(path.join(dataPath, 'connection.json'), 'utf8'));
    assert.deepEqual(Object.keys(saved).sort(), ['backendUrl', 'supabaseUrl']);
    assert.equal(saved.backendUrl, 'https://api.example.org');
    assert.equal(first.metrics.spawned, 0);
    await first.handlers['desktop:workspace'](first.event());
    assert.equal(first.window.url, 'http://localhost:3210/index.html#jarvis');
    assert.throws(() => first.handlers['desktop:configuration'](first.event()), 'Workspace cannot invoke privileged connection IPC');

    const reopened = await desktop(dataPath);
    assert.equal(reopened.window.url, 'http://localhost:3210/index.html#jarvis');
    assert.equal(reopened.metrics.fetches, 0, 'A saved connection opens immediately even when offline');
    reopened.window.loadURL('http://localhost:3210/desktop-setup.html');
    reopened.setHealthy(false);
    result = await reopened.handlers['desktop:connect'](reopened.event(), 'https://other.example.org');
    assert.equal(result.ok, false);
    assert.equal(reopened.metrics.storageClears, 0);
    assert.equal(JSON.parse(fs.readFileSync(path.join(dataPath, 'connection.json'))).backendUrl, saved.backendUrl);
    reopened.setHealthy(true);
    result = await reopened.handlers['desktop:connect'](reopened.event(), 'https://other.example.org');
    assert.equal(result.ok, false, 'Default Cancel must preserve local drafts');
    assert.equal(reopened.metrics.storageClears, 0);
    assert.equal(JSON.parse(fs.readFileSync(path.join(dataPath, 'connection.json'))).backendUrl, saved.backendUrl);
    reopened.approveSwitch();
    result = await reopened.handlers['desktop:connect'](reopened.event(), 'https://other.example.org');
    assert.equal(result.ok, true);
    assert.equal(reopened.metrics.storageClears, 1, 'Changing server must clear the previous tenant cache');
    console.log('PASS desktop URL/IPC isolation, setup persistence, offline reopen, failed database check and no local child runtimes');
  } finally {
    for (const name of fs.readdirSync(dataPath)) fs.unlinkSync(path.join(dataPath, name));
    fs.rmdirSync(dataPath);
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
