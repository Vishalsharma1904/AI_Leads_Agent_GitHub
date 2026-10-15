'use strict';
const assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm'), path = require('node:path');
const nodes = new Map(), listeners = {};
function node() { return { value: '', checked: false, disabled: false, hidden: false, textContent: '', children: [], listeners: {},
  append(...items) { this.children.push(...items); }, replaceChildren(...items) { this.children = items; this.value = items[0]?.value || ''; },
  querySelectorAll() { return this.children.flatMap(item => item.children || []).filter(item => item.tag === 'input'); },
  addEventListener(type, fn) { this.listeners[type] = fn; }, reset() {} }; }
const $ = id => { if (!nodes.has(id)) nodes.set(id, node()); return nodes.get(id); };
let user = 'tenant-a', pending, calls = [];
const document = { readyState: 'complete', getElementById: $, createElement: tag => Object.assign(node(), { tag }), addEventListener() {}, head: node() };
const window = { document, SupabaseAuth: { getUser: () => user ? { id: user } : null, getAccessToken: () => user ? 'app-token' : '' },
  allLeads: [{ company: '<img src=x onerror=alert(1)>', city: 'Delhi', phone: '9876543210' }, { phone: '9876543210' }, { phone: '9876543211', phoneOptOut: true }],
  addEventListener: (name, fn) => { listeners[name] = fn; } };
const context = vm.createContext({ window, document, location: { protocol: 'https:', hostname: 'fixture.test', port: '', hash: '#whatsapp' },
  Option: class { constructor(text, value) { this.textContent = text; this.value = value; } }, DOMException, URL, AbortController, crypto: { randomUUID: () => 'fixed-idempotency-key' }, setTimeout, clearTimeout,
  fetch: async (url, options) => { calls.push({ url, options }); if (pending) { const response = pending; pending = null; return response; }
    const result = url.endsWith('/connection') ? { connected: true, display_phone_number: '+91 9000000000', quota: { used: 0, limit: 20, left: 20 } } :
      url.endsWith('/templates') ? { templates: [{ name: 'hello', language: 'en', status: 'APPROVED', components: [{ type: 'BODY', text: 'Hi {{1}} in {{2}}' }] }, { name: 'unsafe', language: 'en', status: 'PENDING' }] } :
      url.endsWith('/messages/template') ? { status: 'accepted' } : { messages: [{ to: '919876543210', template: 'hello', status: 'accepted', created_at: 'now' }] };
    return { ok: true, json: async () => result }; } });
vm.runInContext(fs.readFileSync(path.join(__dirname, '../whatsapp-cloud.js'), 'utf8'), context);
const flush = async () => { for (let n = 0; n < 35; n++) await Promise.resolve(); };
(async () => {
  await flush(); const hooks = window.WhatsAppCloud._selfTest;
  assert.equal(hooks.leads().length, 1); assert.equal($('wa-cloud-template').children.length, 2);
  $('wa-cloud-template').value = 'hello:en'; $('wa-cloud-template').listeners.change();
  $('wa-cloud-recipient').value = '0'; $('wa-cloud-recipient').listeners.change();
  $('wa-cloud-param-1'); // parameter nodes are created by the DOM stub, not getElementById.
  const inputs = $('wa-cloud-params').querySelectorAll('input'); inputs[0].value = '{Company}'; inputs[1].value = '{City}';
  $('wa-cloud-consent').checked = true; $('wa-cloud-consent').listeners.change();
  assert.equal($('wa-cloud-send').disabled, false); assert.match($('wa-cloud-preview').textContent, /<img/);
  await $('wa-cloud-send').listeners.click(); await flush();
  const send = calls.find(call => call.url.endsWith('/messages/template')), payload = JSON.parse(send.options.body);
  assert.equal(payload.opt_in, true); assert.equal(payload.to, '919876543210'); assert.equal(payload.body_params[1], 'Delhi');
  assert.equal(payload.idempotency_key, 'fixed-idempotency-key'); assert.equal(payload.owner_id, undefined);
  assert.match($('wa-cloud-status').textContent, /accepted/); assert.equal($('wa-cloud-consent').checked, false);
  assert.equal(hooks.supported({ components: [{ type: 'HEADER', format: 'IMAGE' }] }), false);
  let resolve; pending = new Promise(done => { resolve = done; });
  const old = hooks.request('/connection'); user = 'tenant-b'; listeners['rudra:auth-state']();
  resolve({ ok: true, json: async () => ({ connected: true, display_phone_number: 'OLD TENANT' }) });
  await assert.rejects(old, error => error.name === 'AbortError'); await flush();
  assert.doesNotMatch($('wa-cloud-status').textContent, /OLD TENANT/);
  user = ''; pending = null; listeners['rudra:auth-state'](); await assert.rejects(hooks.request('/connection'), /Sign in/);
  assert.equal($('wa-cloud-history').children.length, 0); assert.equal($('wa-cloud-send').disabled, true);
  console.log('WhatsApp Cloud self-check passed: tenant isolation, approved templates, opt-in, personalized send and truthful status.');
})().catch(error => { console.error(error); process.exitCode = 1; });
