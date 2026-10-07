const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

function load(file, elements, leads, fetchImpl = async () => ({ ok: true, json: async () => ({ status: 'success', messageId: 'gmail-1' }) })) {
  const store = { allLeads: JSON.stringify(leads) };
  const localStorage = {
    getItem: key => store[key] || null,
    setItem: (key, value) => { store[key] = value; }
  };
  const document = {
    getElementById: id => elements[id] || null,
    addEventListener: () => {},
    dispatchEvent: () => {},
    createElement: () => ({ innerHTML: '', querySelectorAll: () => [] })
  };
  const window = {
    allLeads: leads,
    localStorage,
    SKYLARK_CONFIG: { BACKEND_URL: 'http://localhost:8000' },
    SupabaseAuth: { getAccessToken: () => 'test-token' },
    UserStorage: {
      getJSON: (key, fallback) => JSON.parse(store[key] || 'null') || fallback,
      setJSON: (key, value) => { store[key] = JSON.stringify(value); }
    },
    open: () => ({ opener: null }),
    showToast: () => {}
  };
  const context = vm.createContext({ window, document, localStorage, fetch: fetchImpl,
    setTimeout, clearTimeout, console, CustomEvent: class CustomEvent {} });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'), context);
  return { context, window, store };
}

(async () => {
  const emailElements = {
    'email-batch-size': { value: '10' },
    'email-target': { value: 'uncontacted' }
  };
  const email = load('page-email.js', emailElements, [
    { email: 'one@example.com', status: 'Contacted', emailContactedAt: '2026-10-01T00:00:00Z' },
    { email: 'one@example.com', status: 'New' },
    { email: 'ONE@example.com', status: 'New' },
    { email: 'two@example.com', status: 'New' }
  ]);
  const controller = vm.runInContext('EmailCtrl', email.context);
  assert.equal(controller.getFilteredAudience().length, 2, 'dedupe after already-emailed filter');
  // A suggestion must transfer only its current search, even when the database is larger.
  email.window.SupabaseAuth.getSession = () => ({ user: { id: 'account-one' } });
  emailElements['email-target'].querySelector = () => null;
  emailElements['email-target'].add = () => {};
  email.context.Option = class Option {};
  controller.showTab = () => {};
  controller.updateAudienceStats = () => {};
  controller.setLeadAudience([{ id: 'batch-one', email: 'two@example.com' }, { id: 'no-email' }]);
  assert.equal(emailElements['email-target'].value, 'current-search');
  assert.equal(controller.getFilteredAudience().length, 1, 'current search excludes unrelated saved leads');
  assert.equal(controller.getFilteredAudience()[0].id, 'batch-one');
  email.window.SupabaseAuth.getSession = () => ({ user: { id: 'account-two' } });
  assert.equal(controller.getFilteredAudience().length, 0, 'a previous account cannot transfer its batch');
  const sent = await controller._sendOne({ to: 'one@example.com', subject: 'Hello', htmlBody: '<p>Hi</p>' });
  assert.equal(sent.success, true);
  assert.equal(sent.messageId, 'gmail-1');

  const unknown = load('page-email.js', emailElements, [], async () => { throw new TypeError('Failed to fetch'); });
  const failed = await vm.runInContext('EmailCtrl', unknown.context)._sendOne({
    to: 'one@example.com', subject: 'Hello', htmlBody: 'Hi'
  });
  assert.equal(failed.success, false, 'network error cannot be marked sent');
  assert.equal(failed.uncertain, true);

  const waElements = {
    'whatsapp-body': { value: 'Hello {Company}' },
    'wa-batch-size': { value: '2' },
    'wa-queue-ui': { style: {} },
    'wa-start-batch-btn': { style: {} },
    'wa-queue-status': { textContent: '' },
    'wa-queue-current-lead': { textContent: '' },
    'wa-progress-bar': { style: {} },
    'wa-confirm-btn': { disabled: true },
    'wa-open-btn': { disabled: true },
    'wa-consent-confirm': { checked: false },
    'whatsapp-preview-box': { textContent: '', style: {} },
    'wa-eligible-count': { textContent: '' }
  };
  const wa = load('page-whatsapp.js', waElements, [{ id: 'lead-1', company: 'Example', phone: '9876543210', status: 'New', whatsappOptIn: true }]);
  const queue = vm.runInContext('WhatsAppCtrl', wa.context);
  queue.startBatch();
  queue.openCurrent();
  assert.equal(JSON.parse(wa.store.allLeads)[0].whatsappSent, undefined, 'opening chat is not a send');
  await queue.confirmCurrent();
  assert.equal(JSON.parse(wa.store.allLeads)[0].whatsappSent, true, 'explicit confirmation updates lead');
  console.log('Outreach self-test passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
