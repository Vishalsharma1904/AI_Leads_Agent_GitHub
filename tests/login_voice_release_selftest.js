'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { execFileSync } = require('node:child_process');
const source = f => process.env.CHECK_BASELINE
  ? execFileSync('git', ['show', `HEAD:${f}`], { encoding: 'utf8' })
  : fs.readFileSync(f, 'utf8');

const elements = {
  'auth-screen': { classList: { contains: () => true }, style: { display: 'none' } },
  'app-shell': { style: {} },
  'view-jarvis': { classList: { contains: () => true } }
};
const document = { getElementById: id => elements[id] || null, readyState: 'loading',
  addEventListener() {}, documentElement: { setAttribute() {} }, hasFocus: () => true };
const store = { clavis_wake_sources: 'all', clavis_background_ai: 'on' };
const window = { document, localStorage: { getItem: k => store[k] ?? null, setItem: (k,v) => store[k] = v },
  addEventListener() {}, dispatchEvent() {}, console };
const ctx = vm.createContext({ window, document, console, AbortController,
  CustomEvent: class { constructor(type, options) { this.type = type; this.detail = options?.detail; } },
  setTimeout: () => 0, clearTimeout() {}, setInterval: () => 0, clearInterval() {} });
for (const file of ['clavis-wake.js', 'clavis-voice-state.js']) vm.runInContext(source(file), ctx);
const voice = window.ClavisVoiceState;
assert.equal(voice.isClavisWorkspace(), false, 'Fail closed before the auth adapter is loaded');
assert.equal(window.ClavisWake.wake('tap', { force: true }), false, 'A login click cannot wake voice');
assert.equal(window.ClavisWake.allowBackground(), false, 'Stored background preference cannot bypass login');
let session = { user: { id: 'verified-test-user' } };
window.SupabaseAuth = { getSession: () => session, isRecoveryMode: () => false };
assert.equal(voice.isClavisWorkspace(), true);
assert.equal(window.ClavisWake.wake('tap'), true, 'Signed-in workspace retains voice controls');
session = null;
assert.equal(voice.canSpeak(), false, 'Sign-out blocks speech immediately');
assert.equal(voice.canProcessMic(), false, 'Sign-out blocks microphone processing');
assert.equal(window.ClavisWake.allowBackground(), false);

const publicConfig = require('../api/public-config');
const savedEnv = { url: process.env.SUPABASE_URL, key: process.env.SUPABASE_PUBLISHABLE_KEY };
function response() { return { headers: {}, setHeader(k,v) { this.headers[k] = v; }, status(n) { this.code=n; return this; }, json(v) { this.body=v; return this; } }; }
try {
  process.env.SUPABASE_URL = 'https://example.supabase.co';
  process.env.SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_test';
  let res = response(); publicConfig({ method: 'GET' }, res);
  assert.equal(res.code, 200);
  assert.equal(res.body.supabase_redirect_url, '');
  assert.equal(res.headers['Cache-Control'], 'no-store');
  process.env.SUPABASE_PUBLISHABLE_KEY = 'sb_secret_do_not_expose';
  res = response(); publicConfig({ method: 'GET' }, res);
  assert.equal(res.code, 503);
  assert.ok(!JSON.stringify(res.body).includes('sb_secret'));
  res = response(); publicConfig({ method: 'POST' }, res); assert.equal(res.code, 405);
} finally {
  for (const [name, value] of [['SUPABASE_URL',savedEnv.url],['SUPABASE_PUBLISHABLE_KEY',savedEnv.key]]) {
    if (value === undefined) delete process.env[name]; else process.env[name]=value;
  }
}
console.log('Login/voice release checks passed: auth race, sign-out, wake gate, public config and secret rejection.');
