'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

class Element {
  constructor(id = '') {
    this.id = id; this.innerHTML = ''; this.textContent = ''; this.value = ''; this.hidden = false;
    this.dataset = {}; this.listeners = {}; this.classList = { contains: name => id === 'view-calling' && name === 'active', toggle() {} };
  }
  addEventListener(name, fn) { this.listeners[name] = fn; }
  querySelector(selector) {
    if (selector === 'audio') return null;
    if (selector === 'button') return this.retryButton ||= new Element('retry');
    if (selector === 'span') return this.statusLabel ||= new Element('status');
    return null;
  }
  querySelectorAll() { return []; }
  setAttribute() {}
  matches(selector) { return selector === '[data-select-lead]' && Boolean(this.dataset.selectLead); }
}

function harness() {
  const ids = new Map();
  const element = id => { if (!ids.has(id)) ids.set(id, new Element(id)); return ids.get(id); };
  const root = element('view-calling');
  const calls = { confirms: [], submitted: [], refreshed: [], cancelled: [], removed: [], imported: [], loadCalls: 0 };
  const events = {};
  const leads = Array.from({ length: 205 }, (_, i) => ({
    id: `lead-${i + 1}`, status: 'pending', lead: { company: `Company ${i + 1}`, phone: `+91900000${String(i + 1).padStart(4, '0')}` },
  }));
  const window = {
    addEventListener(name, handler) { events[name] = handler; }, dispatchEvent() {}, showToast() {},
    VoiceProvider: { current: () => 'elevenlabs' },
    ElevenLabsStudio: {
      mountCalling() {}, batchConfiguration: () => ({ agentReady: true, phoneNumberId: 'phone-a' }),
      async submitBatch(batch) { calls.submitted.push(batch); return { request_id: 'request-a', batch_id: 'batch-a', uncertain: false }; },
      async loadBatchCalls() { calls.loadCalls++; return { batch_calls: [] }; },
      async refreshBatchCall(id) { calls.refreshed.push(id); return { request_id: id, uncertain: false }; },
      async cancelBatchCall(id) { calls.cancelled.push(id); },
    },
    ClavisIcons: { apply() {} },
  };
  const document = {
    readyState: 'complete', hidden: false, addEventListener() {},
    getElementById: element,
    querySelector(selector) { return selector.startsWith('#') ? element(selector.slice(1)) : null; },
    querySelectorAll() { return []; },
  };
  window.confirm = message => { calls.confirms.push(message); return true; };
  const S = {
    queueSnapshot: () => leads.slice(), allThreads: async () => [], getConfig: () => ({ batchSize: 10, gapSeconds: 20 }),
    STATUS: {}, removeFromQueue: id => calls.removed.push(id), normalizePhone: value => value,
    enqueue(rows) { calls.imported.push(rows); return { added: rows.length, skipped: 0 }; },
  };
  const source = fs.readFileSync(path.join(__dirname, '../sarvam-calling-ui.js'), 'utf8').split('/* ============================================================\n *  VoiceProvider')[0];
  const context = vm.createContext({
    window, document, location: { port: '3000', hash: '#calling' }, localStorage: { getItem: () => null },
    setTimeout: () => 1, clearTimeout() {}, setInterval: () => 1, requestAnimationFrame: fn => fn(),
    fetch: async () => ({ ok: true, json: async () => ({ message: 'Jarvis Voice Calling Agent API is running' }) }),
    AbortController, console,
  });
  window.SarvamCalling = S;
  vm.runInContext(source, context, { filename: 'sarvam-calling-ui.js' });
  return { calls, leads, root, element, events, window, ui: window.SarvamCallingUI };
}

(async () => {
  const h = harness();
  assert.equal(typeof h.ui.refreshBatchJobs, 'function', 'refresh button must have a public handler');
  assert.equal(typeof h.ui.cancelBatchJob, 'function', 'cancel button must have a public handler');
  await h.ui.refreshBatchJobs();
  const loadsBeforeConcurrentRefresh = h.calls.loadCalls;
  await Promise.all([h.ui.refreshBatchJobs(), h.ui.refreshBatchJobs()]);
  assert.equal(h.calls.loadCalls - loadsBeforeConcurrentRefresh, 1, 'concurrent refresh clicks share one list request');
  assert.equal(h.calls.refreshed.length, 0, 'completed/empty history does not trigger per-job provider refreshes');
  await h.ui.cancelBatchJob('batch-a');
  assert.deepEqual(h.calls.cancelled, ['batch-a'], 'cancel control reaches the provider and refreshes saved jobs');
  h.element('sc-batch-n').value = '999';
  h.root.listeners.change({ target: { id: 'sc-select-all', checked: true } });

  // A second click while the confirmation dialog is open must be ignored.
  const confirmsBeforeConcurrentClick = h.calls.confirms.length;
  let reentrant;
  h.window.confirm = message => {
    h.calls.confirms.push(message);
    reentrant = h.ui.start();
    return false;
  };
  await h.ui.start();
  await reentrant;
  assert.equal(h.calls.submitted.length, 0, 'declining confirmation sends no batch');
  assert.equal(h.calls.confirms.length, confirmsBeforeConcurrentClick + 1, 'concurrent click cannot open a second confirmation');

  h.window.confirm = message => { h.calls.confirms.push(message); return true; };
  const prompt = `${200} real phone calls ElevenLabs batch`;
  const result = await h.ui.start();
  assert.equal(h.calls.submitted.length, 1);
  assert.equal(h.calls.submitted[0].length, 200, 'N is capped at 200');
  const batchPrompt = h.calls.confirms.find(message => message.startsWith('200 real phone calls'));
  assert.match(batchPrompt, new RegExp(prompt));
  assert.match(batchPrompt, /Company 1 — \+919000000001/);
  assert.match(batchPrompt, /Company 200 — \+919000000200/);
  assert.doesNotMatch(batchPrompt, /Company 201/);
  assert.equal(h.calls.removed.length, 200);
  assert.equal(typeof result, 'undefined');

  h.window.ElevenLabsStudio.submitBatch = async batch => {
    h.calls.submitted.push(batch);
    return { request_id: 'uncertain-a', uncertain: true };
  };
  await h.ui.start();
  assert.equal(h.calls.submitted.length, 2);
  await h.ui.start();
  assert.equal(h.calls.submitted.length, 2, 'uncertain submission is refreshed, never automatically resubmitted');
  assert.ok(h.calls.refreshed.includes('uncertain-a'));

  const fractional = harness();
  fractional.element('sc-batch-n').value = '1.5';
  for (const lead of fractional.leads.slice(0, 2)) {
    fractional.root.listeners.change({ target: { checked: true, dataset: { selectLead: lead.id }, matches: () => true } });
  }
  await fractional.ui.start();
  assert.equal(fractional.calls.submitted[0].length, 1, 'fractional N is floored before confirmation and slicing');
  assert.match(fractional.calls.confirms[0], /^1 real phone call/);
  assert.match(fractional.calls.confirms[0], /Company 1 — \+919000000001/);
  assert.doesNotMatch(fractional.calls.confirms[0], /Company 2/);
  const importer = harness();
  assert.match(importer.root.innerHTML, /id="sc-fetch-leads"/, 'ElevenLabs page exposes Fetch leads');
  importer.window.allLeads = [{ id: 'stale', phone: '+919876543210' }];
  importer.window.UserStorage = { getUserId: () => 'owner-a', getJSON: () => [{ id: 'saved', phone: '+919876543211' }] };
  await importer.ui.pullLeads();
  assert.equal(importer.calls.imported[0][0].id, 'saved', 'fetch prefers current account scoped contacts');
  assert.equal(importer.calls.submitted.length, 0, 'import never dials');
  importer.element('view-leads').classList.contains = name => name === 'active';
  importer.window.LeadsCtrl = { filtered: [] };
  await importer.ui.pullLeads();
  assert.equal(importer.calls.imported.length, 1, 'zero-result filter does not import all contacts');
  importer.window.LeadsCtrl.filtered = [{ id: 'filtered', phone: '+919876543212' }];
  await importer.ui.pullLeads();
  assert.equal(importer.calls.imported[1][0].id, 'filtered');
  importer.element('view-leads').classList.contains = () => false;
  importer.window.UserStorage.getJSON = () => null;
  let resolveLeads, reads = 0;
  importer.window.MemoryEngine = { getAllLeads() { reads++; return new Promise(resolve => { resolveLeads = resolve; }); } };
  const firstFetch = importer.ui.pullLeads(), secondFetch = importer.ui.pullLeads();
  assert.equal(reads, 1, 'repeated clicks share the pending read');
  importer.events['rudra:auth-state']();
  resolveLeads([{ id: 'previous-owner', phone: '+919876543213' }]);
  await Promise.all([firstFetch, secondFetch]);
  assert.equal(importer.calls.imported.length, 2, 'account change discards pending old-owner contacts');
  assert.equal(importer.element('sc-fetch-leads').disabled, false);
  console.log('PASS Calling batch UI handles manual/select-all selection, integer N limits, exact destination confirmation, uncertain-submit protection and refresh controls.');
})().catch(error => { console.error(error); process.exitCode = 1; });
