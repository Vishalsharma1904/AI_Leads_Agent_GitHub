/* Run: node tests/crm_bridge_selftest.js */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const events = new Map(), sent = [];
let account = { id: 'owner-a' }, responseResolver, nextReadPending = false, clears = 0;
const window = {
  SupabaseAuth: { getUser: () => account, getAccessToken: () => account ? 'test-token' : '' },
  CRMCtrl: { onAccountChange: () => clears++ },
  MemoryEngine: { getAllLeads: async () => [{ id: 'safe', ownerUserId: 'owner-a' }, { id: 'legacy' }, { id: 'foreign', ownerUserId: 'owner-b' }] },
  addEventListener: (key, callback) => events.set(key, callback),
};
const context = vm.createContext({ window, console, URL, DOMException, AbortController, setTimeout, clearTimeout,
  localStorage: { getItem: () => null, setItem: () => {} },
  location: { hash: '#crm-overview' },
  document: { addEventListener: () => {}, dispatchEvent: () => {}, getElementById: () => null }, CustomEvent: class {},
  fetch: async (url, options) => {
    const body = options.body ? JSON.parse(options.body) : null; sent.push({ url, body });
    if (nextReadPending) { nextReadPending = false; return new Promise(resolve => responseResolver = resolve); }
    return { ok: true, json: async () => url.includes('/bootstrap') ? { complete: true } : { records: [{ id: 'crm-a', stage: 'qualified', version: 3, sourceIds: [{ source: 'backend', sourceId: 'safe' }] }], total: 1 } };
  },
});
vm.runInContext(fs.readFileSync(require('node:path').join(__dirname, '../crm-bridge.js'), 'utf8'), context);
(async () => {
  await window.CRMBridge.ensureBootstrap();
  const local = sent.find(item => item.body?.source === 'local');
  assert.deepEqual(JSON.parse(JSON.stringify(local.body.records)), [{ id: 'safe', ownerUserId: 'owner-a' }]);
  assert.equal(window.CRMBridge.getStage('safe'), 'qualified');
  assert.equal(window.CRMBridge.getRecordId('safe'), 'crm-a');
  window.CRMBridge.invalidate();
  nextReadPending = true;
  const readA = window.CRMBridge.request('/reports'), readB = window.CRMBridge.request('/reports');
  const count = sent.length;
  responseResolver({ ok: true, json: async () => ({ totals: 4 }) });
  assert.equal((await readA).totals, 4); assert.equal((await readB).totals, 4);
  await window.CRMBridge.request('/reports'); assert.equal(sent.length, count);
  await window.CRMBridge.request('/deals/a', { method: 'PATCH', body: '{}' });
  await window.CRMBridge.request('/reports'); assert.equal(sent.length, count + 2);
  window.CRMBridge.invalidate(); nextReadPending = true;
  const stale = window.CRMBridge.request('/clients');
  window.CRMBridge.invalidate();
  responseResolver({ ok: true, json: async () => ({ totals: 999 }) });
  await assert.rejects(stale, error => error.name === 'AbortError');
  nextReadPending = true;
  const inFlight = window.CRMBridge.request('/overview');
  account = { id: 'owner-b' }; events.get('clavis:workspace-change')();
  responseResolver({ ok: true, json: async () => ({ secret: 'owner-a-data' }) });
  await assert.rejects(inFlight, error => error.name === 'AbortError');
  assert.equal(window.CRMBridge.getStage('safe'), undefined);
  account = null; events.get('clavis:workspace-change')();
  await assert.rejects(window.CRMBridge.ensureBootstrap(), /Sign in/);
  assert.ok(clears >= 3);
  console.log('CRM bridge ownership, legacy exclusion, source mapping and stale-request checks passed.');
})().catch(error => { console.error(error); process.exitCode = 1; });
