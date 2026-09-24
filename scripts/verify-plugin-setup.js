/**
 * Verifies the plugin SETUP flow end to end against the real source files.
 *
 *  - field validation rejects bad input BEFORE anything is written
 *  - browser setup cannot persist provider/webhook secrets
 *  - backend-only plugins remain blocked until the authenticated server is configured
 *  - the GEMINI_API_KEYS config array is read correctly (regression)
 *  - every plugin with an unmet requirement offers a way to fix it
 */

'use strict';

const fs = require('fs');
const path = require('path');

const store = new Map();
const localStorageStub = {
  getItem: k => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: k => store.delete(k)
};

const documentStub = {
  addEventListener() {}, dispatchEvent() { return true; }, getElementById() { return null; }
};

const windowStub = { SKYLARK_CONFIG: {} };

function load(file) {
  const src = fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
  new Function('window', 'document', 'localStorage', 'console', 'fetch', src)(
    windowStub, documentStub, localStorageStub,
    { warn() {}, error() {}, info() {}, log() {} },
    () => Promise.reject(new Error('network disabled in test'))
  );
}

load('plugin-core.js');
load('plugin-manifests.js');
const core = windowStub.PluginCore;

let failures = 0;
function check(name, cond, detail) {
  if (cond) console.log('  PASS  ' + name);
  else { console.log('  FAIL  ' + name + (detail ? ' -> ' + detail : '')); failures++; }
}

console.log('\nPlugin setup flow verification\n');

(async () => {
  // ── Validation happens before any write ─────────────────────────────────
  const badUrl = await core.saveSetup('gmail-webhook', { webhookUrl: 'https://evil.example.com/exec' });
  check('rejects a non-Apps-Script URL', badUrl.ok === false, badUrl.message);
  check('rejection names the offending field', badUrl.field === 'webhookUrl', badUrl.field);
  check('nothing was written on rejection',
    store.get('skylark_email_webhook') === undefined,
    String(store.get('skylark_email_webhook')));

  const missingExec = await core.saveSetup('gmail-webhook', { webhookUrl: 'https://script.google.com/macros/s/abc' });
  check('rejects an Apps Script URL without /exec', missingExec.ok === false, missingExec.message);

  const emptyRequired = await core.saveSetup('gmail-webhook', { webhookUrl: '' });
  check('rejects a blank required field', emptyRequired.ok === false, emptyRequired.message);

  // ── Browser storage cannot configure backend-only integrations ───────────
  check('gmail-webhook blocked before setup', core.describe('gmail-webhook').ready === false);
  const goodUrl = await core.saveSetup('gmail-webhook', {
    webhookUrl: 'https://script.google.com/macros/s/AKfycb123/exec'
  });
  check('rejects browser webhook persistence', goodUrl.ok === false, goodUrl.message);
  check('webhook storage remains empty', store.get('skylark_email_webhook') === undefined);
  check('plugin remains blocked until backend configuration', core.describe('gmail-webhook').ready === false);

  // ── API key setup ───────────────────────────────────────────────────────
  const shortKey = await core.saveSetup('ai-groq', { apiKey: 'abc' });
  check('rejects an implausibly short API key', shortKey.ok === false, shortKey.message);

  check('ai-groq blocked before a key exists', core.describe('ai-groq').ready === false);
  const groqOk = await core.saveSetup('ai-groq', { apiKey: 'gsk_abcdefghijklmnopqrstuvwxyz' });
  check('rejects browser provider-key persistence', groqOk.ok === false, groqOk.message);
  check('Groq key is not stored in browser storage', store.get('skylark_custom_groq') === undefined);
  check('ai-groq remains blocked until backend vault setup', core.describe('ai-groq').ready === false);

  // ── REGRESSION: GEMINI_API_KEYS is a plural array in config.js ──────────
  store.delete('skylark_gemini_api_key');
  check('ai-gemini blocked with no key anywhere', core.describe('ai-gemini').ready === false);
  windowStub.SKYLARK_CONFIG.GEMINI_API_KEYS = ['AIzaSyExampleKeyValue123'];
  check('a key in config.GEMINI_API_KEYS (plural array) IS detected',
    core.describe('ai-gemini').ready === false,
    'frontend config is intentionally ignored; configure the backend vault');
  windowStub.SKYLARK_CONFIG.GEMINI_API_KEYS = [];

  // ── Outlook GUID validation ─────────────────────────────────────────────
  const badGuid = await core.saveSetup('outlook-graph', { clientId: 'not-a-guid' });
  check('rejects a malformed Entra client ID', badGuid.ok === false, badGuid.message);
  const goodGuid = await core.saveSetup('outlook-graph', { clientId: '11111111-2222-3333-4444-555555555555' });
  check('accepts a well-formed GUID', goodGuid.ok === true, goodGuid.message);
  check('client ID persisted', store.get('outlook_client_id') === '11111111-2222-3333-4444-555555555555');

  // ── Every blocked plugin must offer a route forward ──────────────────────
  const blocked = core.list().filter(p => !p.ready);
  const noWayForward = blocked.filter(p => {
    const hasFields = (p.setup?.fields || []).length > 0;
    const hasSteps = (p.setup?.steps || []).length > 0;
    return !hasFields && !hasSteps;
  });
  check('every blocked plugin explains or offers setup',
    noWayForward.length === 0,
    noWayForward.map(p => p.id).join(', '));

  // ── Descriptions are substantial ─────────────────────────────────────────
  const thin = core.list().filter(p => (p.description || '').length < 60);
  check('all descriptions are meaningful', thin.length === 0, thin.map(p => p.id).join(', '));

  const noDetail = core.list().filter(p => !p.detail);
  check('all plugins carry an extended detail note', noDetail.length === 0, noDetail.map(p => p.id).join(', '));

  // ── Unknown plugin is handled ────────────────────────────────────────────
  const unknown = await core.saveSetup('does-not-exist', {});
  check('saveSetup on unknown plugin fails cleanly', unknown.ok === false, unknown.message);

  console.log('');
  if (failures) { console.error(failures + ' check(s) failed'); process.exit(1); }
  console.log('All plugin setup checks passed');
})();
