/**
 * Executes the real plugin-core.js against a minimal DOM/localStorage stub and
 * asserts the behaviour that matters:
 *
 *  - manifest validation actually rejects bad manifests
 *  - lifecycle transitions persist
 *  - a plugin with an UNMET requirement CANNOT be enabled  <-- the anti-fake rule
 *  - a plugin with a met requirement enables and reports its real health
 *  - a throwing healthCheck becomes ERROR, not a silent success
 *  - state is scoped per user
 *  - stats reflect reality
 */

'use strict';

const fs = require('fs');
const path = require('path');

// ── Stubs ─────────────────────────────────────────────────────────────────
const store = new Map();
const localStorageStub = {
  getItem: k => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: k => store.delete(k)
};

const docListeners = {};
const documentStub = {
  addEventListener: (t, fn) => { docListeners[t] = fn; },
  dispatchEvent: () => true
};

let currentUser = 'usr_a';
const windowStub = {
  UserStorage: {
    getJSON(key, fallback) {
      const raw = store.get(`${currentUser}:${key}`);
      return raw ? JSON.parse(raw) : fallback;
    },
    setJSON(key, value) { store.set(`${currentUser}:${key}`, JSON.stringify(value)); }
  }
};

const source = fs.readFileSync(path.join(__dirname, '..', 'plugin-core.js'), 'utf8');
new Function('window', 'document', 'localStorage', 'console', source)(
  windowStub, documentStub, localStorageStub,
  { warn() {}, error() {}, info() {}, log() {} }
);

const core = windowStub.PluginCore;

// ── Harness ───────────────────────────────────────────────────────────────
let failures = 0;
function check(name, cond, detail) {
  if (cond) console.log('  PASS  ' + name);
  else { console.log('  FAIL  ' + name + (detail ? ' -> ' + detail : '')); failures++; }
}

console.log('\nPlugin core verification\n');

// ── Manifest validation ───────────────────────────────────────────────────
check('rejects manifest with no id',
  core.validateManifest({ name: 'x', version: '1', category: 'ai' }).length > 0);
check('rejects unknown category',
  core.validateManifest({ id: 'a', name: 'x', version: '1', category: 'nope' }).length > 0);
check('rejects non-function healthCheck',
  core.validateManifest({ id: 'a', name: 'x', version: '1', category: 'ai', healthCheck: 'no' }).length > 0);
check('accepts a valid manifest',
  core.validateManifest({ id: 'a', name: 'x', version: '1', category: 'ai' }).length === 0);
check('register() refuses an invalid manifest',
  core.register({ name: 'no id' }).ok === false);

// ── Fixtures ──────────────────────────────────────────────────────────────
let requirementMet = false;

core.register({
  id: 'test-blocked',
  name: 'Blocked Plugin',
  version: '1.0.0',
  category: 'ai',
  capabilities: ['generate_text'],
  requires: [{ id: 'needs_key', label: 'no API key saved', check: () => requirementMet }],
  healthCheck: async () => ({ state: 'CONNECTED', message: 'should not be reached while blocked' })
});

core.register({
  id: 'test-open',
  name: 'Open Plugin',
  version: '1.0.0',
  category: 'storage',
  capabilities: ['export_csv'],
  requires: [],
  healthCheck: async () => ({ state: 'CONNECTED', message: 'all good' })
});

core.register({
  id: 'test-throws',
  name: 'Throwing Plugin',
  version: '1.0.0',
  category: 'storage',
  requires: [],
  healthCheck: async () => { throw new Error('provider exploded'); }
});

core.register({
  id: 'test-nohealth',
  name: 'No Health Plugin',
  version: '1.0.0',
  category: 'crm',
  requires: []
});

(async () => {
  // ── The anti-fake rule ──────────────────────────────────────────────────
  check('blocked plugin starts NOT_INSTALLED',
    core.lifecycleOf('test-blocked') === 'NOT_INSTALLED');
  check('blocked plugin reports its unmet requirement',
    core.unmetRequirements('test-blocked').length === 1);
  check('isReady() false while requirement unmet',
    core.isReady('test-blocked') === false);

  const blockedEnable = await core.enable('test-blocked');
  check('enable() REFUSED while requirement unmet', blockedEnable.ok === false, JSON.stringify(blockedEnable));
  check('refusal names what is missing',
    /no API key saved/.test(blockedEnable.message || ''), blockedEnable.message);
  check('blocked plugin did NOT become enabled',
    core.lifecycleOf('test-blocked') === 'NOT_INSTALLED');

  // Satisfy the requirement, then it should enable.
  requirementMet = true;
  check('isReady() true once requirement met', core.isReady('test-blocked') === true);
  const nowOk = await core.enable('test-blocked');
  check('enable() succeeds once requirement met', nowOk.ok === true, JSON.stringify(nowOk));
  check('health came from the plugin healthCheck',
    nowOk.health && nowOk.health.state === 'CONNECTED', JSON.stringify(nowOk.health));

  // ── Normal lifecycle ────────────────────────────────────────────────────
  const openEnable = await core.enable('test-open');
  check('open plugin enables', openEnable.ok === true);
  check('lifecycle is ENABLED', core.lifecycleOf('test-open') === 'ENABLED');

  const desc = core.describe('test-open');
  check('describe() exposes health', desc.health === 'CONNECTED', desc.health);
  check('describe() exposes category label', desc.categoryLabel === 'Storage', desc.categoryLabel);

  core.disable('test-open');
  check('disable() sets DISABLED', core.lifecycleOf('test-open') === 'DISABLED');
  check('disable() clears stale health', core.describe('test-open').health === null);

  // ── Health honesty ──────────────────────────────────────────────────────
  await core.enable('test-throws');
  const thrown = await core.checkHealth('test-throws');
  check('throwing healthCheck becomes ERROR', thrown.state === 'ERROR', thrown.state);
  check('error message is surfaced', /provider exploded/.test(thrown.message), thrown.message);

  await core.enable('test-nohealth');
  const noHealth = await core.checkHealth('test-nohealth');
  check('missing healthCheck becomes DEGRADED, not CONNECTED',
    noHealth.state === 'DEGRADED', noHealth.state);

  const notEnabled = await core.checkHealth('test-open'); // disabled above
  check('disabled plugin health is DISCONNECTED',
    notEnabled.state === 'DISCONNECTED', notEnabled.state);

  // ── Config ──────────────────────────────────────────────────────────────
  core.configure('test-open', { sheetName: 'Leads' });
  check('configure() persists values',
    core.getConfig('test-open').sheetName === 'Leads');
  core.configure('test-open', { delay: 5 });
  check('configure() merges rather than replaces',
    core.getConfig('test-open').sheetName === 'Leads' && core.getConfig('test-open').delay === 5);

  // ── Stats ───────────────────────────────────────────────────────────────
  const stats = core.stats();
  check('stats.total counts registered plugins', stats.total === 4, 'total=' + stats.total);
  check('stats.enabled counts only enabled',
    stats.enabled === 3, 'enabled=' + stats.enabled);

  // ── Per-user isolation ──────────────────────────────────────────────────
  const userAEnabled = core.lifecycleOf('test-blocked');
  currentUser = 'usr_b';
  core._reloadState();
  check('a different user starts with a clean plugin state',
    core.lifecycleOf('test-blocked') === 'NOT_INSTALLED',
    core.lifecycleOf('test-blocked'));

  currentUser = 'usr_a';
  core._reloadState();
  check('original user state is restored on switch back',
    core.lifecycleOf('test-blocked') === userAEnabled,
    core.lifecycleOf('test-blocked'));

  console.log('');
  if (failures) { console.error(failures + ' check(s) failed'); process.exit(1); }
  console.log('All plugin core checks passed');
})();
