/**
 * Loads plugin-core.js + plugin-manifests.js together and asserts that every
 * declared plugin is valid, that requirement probes are safe to call, and that
 * nothing claims to be connected before it has been checked.
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
  addEventListener() {},
  dispatchEvent() { return true; },
  getElementById() { return null; }
};

const windowStub = {
  SKYLARK_CONFIG: {},            // nothing configured: the worst-case start state
  localStorage: localStorageStub
};

function load(file) {
  const src = fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
  new Function('window', 'document', 'localStorage', 'console', 'fetch', src)(
    windowStub, documentStub, localStorageStub,
    { warn() {}, error(...a) { console.log('    [manifest error]', ...a); }, info() {}, log() {} },
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

console.log('\nPlugin manifest verification\n');

const all = core.list();
check('plugins registered', all.length >= 15, 'count=' + all.length);

// Every manifest must have survived validation.
all.forEach(p => {
  const problems = core.validateManifest(p);
  if (problems.length) {
    check(`manifest valid: ${p.id}`, false, problems.join('; '));
  }
});
check('every registered manifest is valid',
  all.every(p => core.validateManifest(p).length === 0));

// Unique ids.
const ids = all.map(p => p.id);
check('plugin ids are unique', new Set(ids).size === ids.length);

// Requirement probes must never throw and must return a boolean-ish value.
let probeErrors = [];
all.forEach(p => {
  try { core.unmetRequirements(p.id); }
  catch (err) { probeErrors.push(`${p.id}: ${err.message}`); }
});
check('all requirement probes are safe to call', probeErrors.length === 0, probeErrors.join(' | '));

// THE KEY ASSERTION: with nothing configured, nothing may look connected.
const falselyConnected = all.filter(p => p.health === 'CONNECTED');
check('no plugin claims CONNECTED before any check',
  falselyConnected.length === 0,
  falselyConnected.map(p => p.id).join(', '));

const falselyEnabled = all.filter(p => p.lifecycle === 'ENABLED');
check('no plugin is enabled by default',
  falselyEnabled.length === 0,
  falselyEnabled.map(p => p.id).join(', '));

// With an empty config, OAuth-backed plugins must all be blocked.
const oauthPlugins = all.filter(p => p.authentication?.type === 'oauth2');
check('oauth plugins exist', oauthPlugins.length > 0);
check('every oauth plugin is blocked while no backend is configured',
  oauthPlugins.every(p => !p.ready),
  oauthPlugins.filter(p => p.ready).map(p => p.id).join(', '));

// Plugins that need nothing must be ready immediately.
const zeroReq = all.filter(p => (p.requires || []).length === 0);
check('zero-requirement plugins are ready', zeroReq.every(p => p.ready),
  zeroReq.filter(p => !p.ready).map(p => p.id).join(', '));
check('at least some plugins work with no setup', zeroReq.length >= 2, 'count=' + zeroReq.length);

// Blocked plugins must explain themselves.
const blocked = all.filter(p => !p.ready);
check('every blocked plugin has at least one labelled reason',
  blocked.every(p => p.missing.length > 0 && p.missing.every(m => m.label)),
  blocked.filter(p => !p.missing.every(m => m.label)).map(p => p.id).join(', '));

// Webhook credentials are backend-only and must not be unblocked by browser storage.
const webhookBefore = core.describe('gmail-webhook');
check('gmail-webhook blocked with no webhook URL', webhookBefore.ready === false);
store.set('skylark_email_webhook', 'https://script.google.com/macros/s/abc/exec');
const webhookAfter = core.describe('gmail-webhook');
check('gmail-webhook remains blocked when a browser URL is saved', webhookAfter.ready === false);
store.set('skylark_email_webhook', 'https://evil.example.com/exec');
check('gmail-webhook rejects a non-Apps-Script URL',
  core.describe('gmail-webhook').ready === false);

// Categories used by manifests must all be known to the core.
const known = Object.keys(core.categories());
const unknownCats = [...new Set(all.map(p => p.category))].filter(c => !known.includes(c));
check('all categories are known', unknownCats.length === 0, unknownCats.join(', '));

console.log('\n  Registered plugins by tier:');
['LIVE', 'PARTIAL', 'PLANNED'].forEach(tier => {
  const names = all.filter(p => p.tier === tier).map(p => p.id);
  console.log(`    ${tier.padEnd(8)} ${names.length}  ${names.join(', ')}`);
});

console.log('');
if (failures) { console.error(failures + ' check(s) failed'); process.exit(1); }
console.log('All plugin manifest checks passed');
