'use strict';
// Run: node scripts/crm-workflow-selftest.js. No provider requests or browser sends.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

async function main() {
  const leads = [{ id: 'q', status: 'Qualified', email: 'q@example.test', phone: '919811100001' },
    { id: 'c', status: 'Client', email: 'c@example.test' }, { id: 'n', status: 'New', email: 'n@example.test' }];
  const updates = [], events = [], nodes = new Map();
  let confirmations = 0;
  const storage = { getJSON: () => leads, setJSON: () => {} };
  const document = { addEventListener() {}, dispatchEvent: e => events.push(e),
    getElementById: id => nodes.get(id) || null, querySelectorAll: () => [] };
  nodes.set('wa-confirm-btn', { disabled: false });
  nodes.set('wa-consent-confirm', { checked: true });
  const window = { UserStorage: storage, allLeads: leads, MemoryEngine: {
    updateLead: async (id, fields) => { assert.equal(typeof id, 'string'); updates.push([id, fields]); }
  }, CRMBridge: { getStage: () => null, stageLabel: stage => stage,
    logWhatsApp: async () => { confirmations++; }, notifyLeads() {} }, open: () => ({}) };
  const context = vm.createContext({ window, document, console, setTimeout() {}, clearTimeout() {},
    localStorage: { getItem: () => null, setItem() {} }, CustomEvent: class { constructor(type) { this.type = type; } } });
  for (const filename of ['page-email.js', 'page-whatsapp.js', 'page-leads.js'])
    vm.runInContext(fs.readFileSync(path.join(__dirname, '..', filename), 'utf8'), context);
  await window.EmailCtrl.markEmailAccepted(leads, leads[0]);
  await window.EmailCtrl.markEmailAccepted(leads, leads[1]);
  await window.EmailCtrl.markEmailAccepted(leads, leads[2]);
  assert.equal(leads[0].status, 'Qualified');
  assert.equal(leads[1].status, 'Client');
  assert.equal(leads[2].status, 'Attempted');
  assert.equal(window.LeadsCtrl.statusOf({ status: 'Closed' }), 'Review required');
  assert.equal(window.LeadsCtrl.statusOf({ status: 'Converted' }), 'Review required');
  assert.equal(window.LeadsCtrl.statusOf({ status: 'Contacted' }), 'Attempted');
  const wa = window.WhatsAppCtrl;
  window.crmSelectedLead = leads[0];
  wa.refreshQueue();
  assert.equal(wa.queue[0].id, 'q');
  wa.queue[0].phoneOptOut = true;
  wa.refreshQueue();
  assert.equal(wa.queue.length, 0);
  leads[0].phoneOptOut = false;
  wa.refreshQueue();
  wa.isBatchRunning = true;
  wa.renderMessage = () => 'hello';
  wa.advance = () => {};
  wa.openCurrent();
  assert.equal(confirmations, 0, 'Opening WhatsApp must not record a send');
  await Promise.all([wa.confirmCurrent(), wa.confirmCurrent()]);
  assert.equal(confirmations, 1, 'Double confirmation must not duplicate outreach');
  assert.equal(leads[0].status, 'Qualified');
  assert.equal(leads[0].whatsappSent, true);
  window.CRMBridge.getStage = id => id === 'q' ? 'qualified' : null;
  window.CRMBridge.stageLabel = stage => stage === 'qualified' ? 'Qualified' : stage;
  leads[0].status = 'New';
  assert.equal(window.LeadsCtrl.statusOf(leads[0]), 'Qualified', 'CRM stage wins over legacy state');
  assert(updates.every(([id]) => typeof id === 'string'));
  console.log('CRM workflow self-check passed: monotonic stages, real updateLead signature, opt-outs, user-confirmed WhatsApp only.');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
