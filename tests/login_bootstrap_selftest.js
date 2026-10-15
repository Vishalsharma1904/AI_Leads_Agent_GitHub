'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

(async () => {
  const requests = [];
  let created = 0;
  const window = {
    location: { protocol: 'http:', hostname: 'localhost', port: '3000', origin: 'http://localhost:3000' },
    SKYLARK_CONFIG: { BACKEND_URL: 'http://localhost:8000' },
    dispatchEvent() {},
    supabase: { createClient() {
      created++;
      return { auth: { onAuthStateChange() {}, getSession: async () => ({ data: { session: null } }) } };
    } }
  };
  vm.runInNewContext(fs.readFileSync('supabase-auth.js', 'utf8'), {
    window, console, AbortController, setTimeout, clearTimeout,
    CustomEvent: class {},
    fetch: async url => {
      requests.push(url);
      if (url !== '/api/public-config') throw new Error('Calling backend is stopped');
      return { ok: true, json: async () => ({ supabase_url: 'https://example.supabase.co', supabase_publishable_key: 'public-test-key' }) };
    }
  });
  const results = await Promise.all([window.SupabaseAuth.init(), window.SupabaseAuth.init()]);
  assert.equal(requests[0], '/api/public-config', 'Local sign-in must not wait for the separate calling backend');
  assert.equal(requests.length, 1);
  assert.equal(created, 1);
  assert.ok(results.every(result => result.success));
  assert.equal(window.SupabaseAuth.getSession(), null, 'Fast public login must never manufacture a session');

  const timers = [];
  const elements = new Map();
  function element(id) {
    const classes = new Set(id === 'auth-screen' ? ['is-checking'] : []);
    return { style: {}, hidden: false, textContent: '', addEventListener() {}, setAttribute() {},
      classList: { add: value => classes.add(value), remove: value => classes.delete(value), contains: value => classes.has(value) } };
  }
  for (const id of ['auth-screen', 'app-shell', 'ag-auth-stage', 'ag-auth-form', 'ag-segmented-tabs']) elements.set(id, element(id));
  const document = { readyState: 'loading', getElementById: id => elements.get(id) || null,
    querySelectorAll: () => [], querySelector: () => null, addEventListener() {} };
  const authWindow = { document, addEventListener() {}, dispatchEvent() {},
    SupabaseAuth: { init: () => new Promise(() => {}), getSession: () => null },
    showView() {}, JarvisEngine: { sendMessage() {} }, bindJarvisUIButtons() {},
    ClavisVoiceState: { canProcessMic() {} }, ClavisEar: { judge() {} },
    ClavisVoice: { speak() {} }, ClavisElevenSTT: { start() {} },
    matchMedia: () => ({ matches: true }) };
  const storage = { getItem: () => null, setItem() {}, removeItem() {} };
  vm.runInNewContext(fs.readFileSync('auth-antigravity.js', 'utf8'), {
    window: authWindow, document, localStorage: storage, console, Event,
    setTimeout: (fn, ms) => { timers.push({ fn, ms }); return timers.length; }, clearTimeout() {}
  });
  const reveal = timers.find(timer => timer.ms < 500);
  assert.ok(reveal, 'Login reveal must not remain blocked for 2.5 seconds');
  reveal.fn();
  await Promise.resolve();
  assert.equal(elements.get('auth-screen').classList.contains('is-checking'), false);
  assert.equal(elements.get('app-shell').style.display, 'none', 'Unverified app remains locked');
  authWindow.SupabaseAuth.getSession = () => ({ user: { id: 'verified-owner' } });
  authWindow.AntigravityAuth.transitionToApp();
  assert.equal(authWindow.AntigravityAuth._pendingWorkspace, true);
  assert.equal(elements.get('app-shell').style.display, 'none', 'A restored session waits for workspace modules');
  authWindow.SupabaseAuth.getSession = () => null;
  authWindow.AntigravityAuth._modulesReady = true;
  authWindow.AntigravityAuth.transitionToApp();
  assert.equal(elements.get('app-shell').style.display, 'none', 'Sign-out during startup cannot reveal a queued workspace');
  const skinListeners = {};
  const skin = { sheet: null, addEventListener: (name, fn) => skinListeners[name] = fn };
  document.querySelector = () => skin;
  elements.get('auth-screen').classList.add('is-checking');
  authWindow.AntigravityAuth.revealLogin();
  assert.equal(elements.get('auth-screen').classList.contains('is-checking'), true, 'Logo measurements wait for the actual login layout');
  skin.sheet = {}; skinListeners.load();
  assert.equal(elements.get('auth-screen').classList.contains('is-checking'), false);
  elements.get('auth-screen').classList.add('is-checking');
  skin.sheet = null; skin.dataset = { loadFailed: '1' };
  authWindow.AntigravityAuth.revealLogin();
  assert.equal(elements.get('auth-screen').classList.contains('is-checking'), false, 'A stylesheet failure before auth initialization cannot strand the splash');
  document.querySelector = () => null;
  document.readyState = 'interactive';
  const lateWindow = { ...authWindow, SupabaseAuth: { init: () => new Promise(() => {}), getSession: () => null } };
  vm.runInNewContext(fs.readFileSync('auth-antigravity.js', 'utf8'), {
    window: lateWindow, document, localStorage: storage, console, Event,
    performance: { mark() {}, getEntriesByType: () => [{ domContentLoadedEventEnd: 1 }] },
    setTimeout: () => 1, clearTimeout() {}
  });
  assert.equal(lateWindow.AntigravityAuth._modulesReady, true, 'An async auth script arriving after DOM ready cannot strand a restored workspace');
  const restoredSession = { access_token: 'fixture-session', user: { id: 'current-owner', email: 'current@example.test', user_metadata: { full_name: 'Current Owner' } } };
  const savedProfile = new Map([
    ['skylark_active_email', 'old@example.test'],
    ['skylark_user_profile', JSON.stringify({ id: 'old-owner', email: 'old@example.test', name: 'Old Owner', phone: 'old private phone', privateField: 'old private value' })]
  ]);
  const lateTimers = [];
  const restoredWindow = { ...authWindow, allLeads: [{ id: 'old-lead' }], all_candidates: [{ id: 'old-candidate' }],
    SupabaseAuth: { init: async () => ({ success: true }), getSession: () => restoredSession, getUser: () => restoredSession.user, isRecoveryMode: () => false } };
  elements.get('app-shell').style.display = 'flex';
  elements.get('auth-screen').classList.add('ag-hidden');
  document.body = { appendChild() {} };
  document.createElement = () => ({ style: {}, remove() {} });
  elements.get('app-shell').removeAttribute = () => {};
  vm.runInNewContext(fs.readFileSync('auth-antigravity.js', 'utf8'), {
    window: restoredWindow, document, console, Event,
    localStorage: { getItem: key => savedProfile.get(key) || null, setItem: (key, value) => savedProfile.set(key, value), removeItem: key => savedProfile.delete(key) },
    performance: { mark() {}, getEntriesByType: () => [{ domContentLoadedEventEnd: 1 }] },
    setTimeout: (fn, ms) => { lateTimers.push({ fn, ms }); return lateTimers.length; }, clearTimeout() {}, requestAnimationFrame() {}
  });
  await Promise.resolve();
  assert.equal(restoredWindow.UserProfileManager.getProfile().id, 'current-owner', 'Already-visible late auth must reconcile the cached verified identity');
  assert.equal(savedProfile.get('skylark_active_email'), 'current@example.test');
  assert.equal(restoredWindow.UserProfileManager.getProfile().privateField, undefined, 'Another account profile cannot merge into the restored owner');
  assert.equal(restoredWindow.allLeads.length, 0); assert.equal(restoredWindow.all_candidates.length, 0);
  const workspaceBoots = lateTimers.filter(timer => timer.ms === 60).length;
  assert.equal(workspaceBoots, 1, 'A changed restored owner reloads only its own workspace once');
  await restoredWindow.AntigravityAuth.checkInitialSession();
  await restoredWindow.AntigravityAuth.handleSupabaseSession(restoredSession);
  assert.equal(lateTimers.filter(timer => timer.ms === 60).length, workspaceBoots, 'Repeated cached/session notifications must not initialize the workspace twice');
  await restoredWindow.AntigravityAuth.handleSupabaseSession({ user: { id: 'old-owner', email: 'old@example.test' } });
  assert.equal(savedProfile.get('skylark_active_email'), 'current@example.test', 'A late stale callback cannot overwrite verified current identity');
  await restoredWindow.AntigravityAuth.handleSupabaseSession({ user: { id: 'current-owner', email: 'old@example.test' } });
  assert.equal(savedProfile.get('skylark_active_email'), 'current@example.test', 'Current verified email takes precedence over a stale same-user callback');
  restoredWindow.SupabaseAuth.isRecoveryMode = () => true;
  await restoredWindow.AntigravityAuth.handleSupabaseSession(restoredSession);
  assert.equal(lateTimers.filter(timer => timer.ms === 60).length, workspaceBoots, 'Recovery mode cannot initialize the normal workspace');
  restoredWindow.SupabaseAuth.isRecoveryMode = () => false;
  elements.get('app-shell').style.display = 'none'; elements.get('auth-screen').classList.remove('ag-hidden');
  savedProfile.set('skylark_user_profile', JSON.stringify({id:'old-owner',email:'old@example.test'}));
  savedProfile.set('skylark_active_email', 'old@example.test');
  await restoredWindow.AntigravityAuth.checkInitialSession();
  assert.equal(restoredWindow.UserProfileManager.getProfile().id, 'current-owner', 'Cached init also reconciles identity before revealing a hidden workspace');
  assert.equal(lateTimers.filter(timer => timer.ms === 60).length, workspaceBoots + 1);

  function bootFixture(state, modulesReady, performance) {
    const bootElements = new Map();
    for (const id of ['auth-screen', 'app-shell', 'ag-auth-stage', 'ag-auth-form', 'ag-segmented-tabs', 'ag-auth-feedback', 'ag-auth-progress']) {
      const node = element(id); node.removeAttribute = () => {};
      bootElements.set(id, node);
    }
    bootElements.get('app-shell').style.display = 'none';
    const message = { textContent: '' };
    bootElements.get('ag-auth-feedback').querySelector = () => message;
    const docListeners = {}, winListeners = {}, bootTimers = [];
    const add = (listeners, type, fn) => (listeners[type] ||= []).push(fn);
    const bootDocument = { ...document, readyState: state,
      getElementById: id => bootElements.get(id) || null,
      addEventListener: (type, fn) => add(docListeners, type, fn), querySelector: () => null };
    let session = restoredSession, recovery = false, reloads = 0;
    const bootWindow = { ...authWindow, document: bootDocument,
      location: { reload: () => reloads++ },
      addEventListener: (type, fn) => add(winListeners, type, fn),
      SupabaseAuth: { init: async () => ({ success: true }), getSession: () => session,
        getUser: () => session?.user, isRecoveryMode: () => recovery } };
    if (!modulesReady) delete bootWindow.bindJarvisUIButtons;
    const bootStorage = new Map();
    vm.runInNewContext(fs.readFileSync('auth-antigravity.js', 'utf8'), {
      window: bootWindow, document: bootDocument, console, Event, performance,
      localStorage: { getItem: key => bootStorage.get(key) || null, setItem: (key, value) => bootStorage.set(key, value), removeItem: key => bootStorage.delete(key) },
      setTimeout: (fn, ms) => { bootTimers.push({ fn, ms }); return bootTimers.length; }, clearTimeout() {}, requestAnimationFrame() {}
    });
    return { window: bootWindow, document: bootDocument, elements: bootElements, timers: bootTimers, message,
      fire: (type, event = {}) => [...(docListeners[type] || []), ...(winListeners[type] || [])].forEach(fn => fn({ type, ...event })),
      setSession: value => { session = value; }, setRecovery: value => { recovery = value; }, reloads: () => reloads };
  }
  for (const timing of [undefined, { mark() {}, getEntriesByType: () => [] }, { mark() {}, getEntriesByType: () => [{ domContentLoadedEventEnd: 0 }] }]) {
    const late = bootFixture('interactive', true, timing);
    await new Promise(setImmediate);
    assert.equal(late.window.AntigravityAuth._modulesReady, true, 'Actual workspace exports, not optional DOM timing, prove readiness');
    assert.equal(late.elements.get('app-shell').style.display, 'flex', 'Cached verified session opens when an auth script arrives late');
    const count = late.timers.filter(timer => timer.ms === 60).length;
    late.document.readyState = 'complete'; late.fire('load'); late.fire('DOMContentLoaded');
    assert.equal(late.timers.filter(timer => timer.ms === 60).length, count, 'Repeated readiness notifications do not boot the workspace twice');
  }
  const pending = bootFixture('loading', false);
  await new Promise(setImmediate);
  assert.equal(pending.window.AntigravityAuth._pendingWorkspace, true);
  pending.window.bindJarvisUIButtons = () => {};
  pending.document.readyState = 'complete'; pending.fire('readystatechange');
  assert.equal(pending.elements.get('app-shell').style.display, 'flex', 'Completion releases a verified pending workspace even if DCL was missed');
  for (const boundary of ['sign-out', 'recovery']) {
    const blocked = bootFixture('loading', false);
    await new Promise(setImmediate);
    if (boundary === 'sign-out') blocked.setSession(null); else blocked.setRecovery(true);
    blocked.window.bindJarvisUIButtons = () => {};
    blocked.document.readyState = 'complete'; blocked.fire('load');
    assert.equal(blocked.elements.get('app-shell').style.display, 'none', boundary + ' during startup must not open the normal workspace');
  }
  const missing = bootFixture('interactive', false);
  await new Promise(setImmediate);
  missing.fire('DOMContentLoaded');
  assert.equal(missing.window.AntigravityAuth._modulesReady, false, 'DCL cannot prove a failed required script is usable');
  assert.equal(missing.elements.get('app-shell').style.display, 'none');
  assert.equal(missing.elements.get('ag-auth-feedback').hidden, false);
  assert.match(missing.message.textContent, /Retry connection/);
  await missing.window.AntigravityAuth.checkInitialSession();
  assert.equal(missing.reloads(), 1, 'Existing Retry connection reloads failed scripts instead of repeating OAuth');
  const failed = bootFixture('loading', false);
  failed.fire('error', { target: { src: 'http://localhost:3000/jarvis_ui.js?v=test' } });
  failed.window.bindJarvisUIButtons = () => {};
  failed.document.readyState = 'complete'; failed.fire('load');
  assert.equal(failed.elements.get('app-shell').style.display, 'none', 'A runtime/resource failure is not cleared by a partial export');
  assert.equal(failed.elements.get('ag-auth-feedback').hidden, false);

  const markup = fs.readFileSync('index.html', 'utf8');
  const ordered = ['desktop-config.js', 'config.js?v=', 'vendor/supabase/supabase.js', 'supabase-auth.js', 'auth-antigravity.js'];
  const positions = ordered.map(name => markup.indexOf('src="' + name));
  assert.ok(positions.every((value, index) => value >= 0 && (!index || value > positions[index - 1])), 'Local auth dependencies precede optional workspace libraries');
  assert.ok(positions[3] < markup.indexOf('rel="stylesheet"'), 'Auth dependencies cannot wait behind workspace stylesheets');
  assert.ok(positions[4] > markup.indexOf('id="rl-film-video"') && positions[4] < markup.indexOf('id="app-shell"'), 'Sign-in initializes as soon as its own DOM exists, before the workspace DOM/scripts');
  assert.match(markup, /src="auth-antigravity\.js[^\"]*" async><\/script>/, 'Public auth controller must not wait behind stylesheet-blocked classic scripts');
  const head = markup.slice(0, markup.indexOf('</head>'));
  assert.ok(!/<script(?:\s[^>]*)?>/.test(head.slice(head.indexOf('rel="stylesheet"'))), 'No inline classic head script may stall public DOM parsing behind workspace CSS');
  console.log('Fast login: local config first, one auth client, early public reveal, verified workspace gate passed.');
})().catch(error => { console.error(error); process.exitCode = 1; });
