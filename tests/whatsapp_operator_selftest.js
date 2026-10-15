const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const input = value => ({ value, checked: false, handlers: {}, addEventListener(name, fn) { this.handlers[name] = fn; } });
const fields = { leads_per_day: input('50'), calls_per_day: input('25'), whatsapp_per_day: input('20'), blocked: input('') };
const preset = input('20'), save = input('');
const card = { dataset: { i: '0' }, querySelector(selector) {
  if (selector === '.op-save') return save;
  if (selector === '[data-wa-plan]') return preset;
  return fields[selector.match(/data-set="([^"]+)"/)[1]];
} };
const list = { innerHTML: '', querySelectorAll: () => [card] };
const nodes = { 'op-list': list, 'op-msg': {}, 'op-sub': {} };
let patch;
const context = {
  window: { SupabaseAuth: { getAccessToken: () => 'test-account-jwt' } },
  location: { port: '8000' }, document: { getElementById: id => nodes[id], addEventListener() {} },
  setTimeout() {}, clearTimeout,
  fetch: async (url, options) => {
    assert.equal(options.headers.Authorization, 'Bearer test-account-jwt');
    if (options.method === 'PATCH') { patch = JSON.parse(options.body); return { ok: true, json: async () => ({ success: true }) }; }
    return { ok: true, json: async () => ({ day: '2026-10-08', tenants: [{ owner_user_id: 'client-a', email: 'a@test.example', leads: {used:0,limit:50,total:0}, calls:{used:0,limit:25,total:0}, whatsapp:{used:3,limit:20,total:3} }] }) };
  }
};
vm.runInNewContext(fs.readFileSync(require.resolve('../clavis-operator.js'), 'utf8'), context);
(async () => {
  await context.window.ClavisOperator.load();
  assert.match(list.innerHTML, /Basic · 20\/day/);
  assert.match(list.innerHTML, /3 \/ 20 today/);
  preset.value = '100'; preset.handlers.change(); assert.equal(fields.whatsapp_per_day.value, '100');
  fields.whatsapp_per_day.value = '30'; fields.whatsapp_per_day.handlers.input(); assert.equal(preset.value, 'custom');
  await save.handlers.click();
  assert.equal(patch.whatsapp_per_day, 30);
  assert.equal(patch.leads_per_day, 50);
  assert.equal(patch.calls_per_day, 25);
  console.log('PASS: operator WhatsApp presets, custom quota and authenticated server patch');
})().catch(error => { console.error(error); process.exitCode = 1; });
