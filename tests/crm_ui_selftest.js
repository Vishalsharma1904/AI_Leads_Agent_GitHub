'use strict';
// Runnable without a browser or new dependencies: node tests/crm_ui_selftest.js
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

async function main() {
  const registry = new Map(), listeners = new Map(), intervals = new Map();
  let user = { id: 'owner-a' }, verified = true, pending = null, bootstrapCount = 0, timerId = 0;
  const calls = [];
  class Element {
    constructor() { this.innerHTML = ''; this.hidden = false; this.nodes = new Map(); this.attrs = new Map(); this.children = []; this.classes = new Set(); this.classList = { add: value => this.classes.add(value), remove: value => this.classes.delete(value), contains: value => this.classes.has(value), toggle: (value, state) => state ? this.classes.add(value) : this.classes.delete(value) }; }
    querySelector(selector) {
      if (selector === '.crm-page' && !this.innerHTML.includes('crm-page')) return null;
      if (!this.nodes.has(selector)) this.nodes.set(selector, new Element());
      return this.nodes.get(selector);
    }
    querySelectorAll() { return []; }
    replaceChildren() { this.innerHTML = ''; this.nodes.clear(); }
    append(el) { registry.set(el.id, el); this.children.push(el); }
    setAttribute(key, value) { this.attrs.set(key, value); }
    removeAttribute(key) { this.attrs.delete(key); }
    focus() { document.activeElement = this; }
    contains(el) { return this === el; }
  }
  ['main-scroll-area', 'app-shell', 'view-crm-overview', 'view-crm-pipeline', 'view-crm-activity'].forEach(id => { const el = new Element(); el.id = id; el.classes.add('active'); registry.set(id, el); });
  const document = {
    body: new Element(), hidden: false, activeElement: null,
    getElementById: id => registry.get(id), createElement: () => new Element(),
    querySelectorAll: selector => selector === '.crm-workspace' ? [...registry.values()].filter(el => el.id?.startsWith('view-crm-')) : [],
    querySelector: () => null,
    addEventListener: (name, fn) => { listeners.set(`document:${name}`, fn); }, dispatchEvent() {}
  };
  const detail = { id: 'record-a', version: 2, stage: 'new', profile: { company: 'Example & Co', additionalContacts: [{ name: 'A', email: 'a@example.com' }] }, deals: [], tasks: [], activities: [] };
  function result(url) {
    if (url.startsWith('/overview')) return { metrics: { leads: 17, conversations: 4, pendingFollowUps: 3, clients: 2, messagesSent: 8, uniqueRecipients: 6, pipelineMonthlyValue: 1200, wonMonthlyValue: 900, incompleteDealValues: 1 }, stages: [{ stage: 'new', count: 17 }], intake: [{ date: '2026-10-01', count: 17 }], outreach: [], recentActivity: [] };
    if (url.startsWith('/usage')) return { days: [{ date: '2026-10-01', sessions: 2, activities: 4 }], historyKnownFrom: '2026-10-01' };
    if (url.startsWith('/records/')) return detail;
    if (url.startsWith('/records?')) return { records: [{ ...detail, profile: { ...detail.profile, company: '<script>unsafe</script>' } }], total: 1 };
    return { activities: [], tasks: [], deals: [], total: 0 };
  }
  const window = {
    SupabaseAuth: { getUser: () => user, getClient: () => ({ auth: { getUser: async () => ({ data: { user: verified ? user : { id: 'wrong-owner' } } }) } }), getAccessToken: () => 'test-token' },
    CRMBridge: { request: async (url, options) => { calls.push({ url, options }); if (pending && url.startsWith('/overview')) return pending; return result(url); }, ensureBootstrap: async () => { bootstrapCount++; }, migrationStatus: { warnings: ['Cloud history temporarily unavailable.'], skippedOwnerless: 2 } },
    matchMedia: () => ({ matches: false }), confirm: () => true,
    addEventListener: (name, fn) => { listeners.set(`window:${name}`, fn); }
  };
  const context = { window, document, AbortController, DOMException, URLSearchParams, Intl, crypto: require('node:crypto').webcrypto, CustomEvent: class { constructor(type, options) { this.type = type; this.detail = options?.detail; } }, requestAnimationFrame: fn => fn(), setInterval: fn => { intervals.set(++timerId, fn); return timerId; }, clearInterval: id => intervals.delete(id), setTimeout: () => ++timerId, clearTimeout() {} };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', 'page-crm.js'), 'utf8'), context);
  const ctrl = window.CRMCtrl;
  await ctrl.init('overview');
  assert.equal(bootstrapCount, 1);
  const overviewRoot = registry.get('view-crm-overview');
  assert.match(overviewRoot.querySelector('[data-crm-content]').innerHTML, /<strong>17<\/strong>/);
  assert.match(overviewRoot.querySelector('[data-crm-content]').innerHTML, /crm-heat-cell/);
  assert.match(overviewRoot.querySelector('[data-crm-migration]').textContent, /ownership evidence/);
  document.hidden = true; const beforeHidden = calls.length; await ctrl.refresh(true); assert.equal(calls.length, beforeHidden, 'hidden tabs must not poll'); document.hidden = false;
  const content = overviewRoot.querySelector('[data-crm-content]'); content.innerHTML = 'focused list stays intact'; document.activeElement = content;
  await ctrl.refresh(true); assert.equal(content.innerHTML, 'focused list stays intact', 'polling must preserve a focused list control'); document.activeElement = null;
  await ctrl.init('pipeline');
  assert.match(registry.get('view-crm-pipeline').querySelector('[data-crm-content]').innerHTML, /&lt;script&gt;unsafe&lt;\/script&gt;/);
  await ctrl.openRecord('record-a');
  const layer = registry.get('crm-record-panel');
  assert.equal(registry.get('app-shell').attrs.has('inert'), true);
  assert.match(layer.querySelector('[data-crm-panel-body]').innerHTML, /name="contactEmail"/);
  const bodyBefore = layer.querySelector('[data-crm-panel-body]').innerHTML;
  await ctrl.refresh(true); assert.equal(layer.querySelector('[data-crm-panel-body]').innerHTML, bodyBefore, 'polling must not redraw the open record');
  listeners.get('document:keydown')({ key: 'Escape', target: { getAttribute: () => null }, preventDefault() {} });
  assert.equal(registry.get('app-shell').attrs.has('inert'), false);
  await ctrl.init('overview');
  let release; pending = new Promise(resolve => { release = resolve; });
  const oldRequest = ctrl.refresh(); await new Promise(resolve => setImmediate(resolve));
  const oldSignal = calls.findLast(call => call.url.startsWith('/overview')).options.signal;
  user = { id: 'owner-b' }; pending = null; ctrl.onAccountChange();
  release({ ...result('/overview'), metrics: { ...result('/overview').metrics, leads: 999999 } }); await oldRequest; await new Promise(resolve => setImmediate(resolve));
  assert.equal(oldSignal.aborted, true, 'account changes must abort old requests');
  assert.doesNotMatch(overviewRoot.querySelector('[data-crm-content]').innerHTML, /999,999|9,99,999/, 'late old-owner results must never render');
  const beforeInvalid = calls.length; verified = false; user = { id: 'owner-c' }; ctrl.onAccountChange(); await new Promise(resolve => setImmediate(resolve));
  assert.equal(calls.length, beforeInvalid, 'unverified ownership must not issue CRM requests');
  assert.match(overviewRoot.querySelector('[data-crm-status]').textContent, /could not be verified/);
  ctrl.dispose(); assert.equal(intervals.size, 0);
  require('postcss').parse(fs.readFileSync(path.join(__dirname, '..', 'crm.css'), 'utf8'));
  console.log('CRM UI self-check passed: verified owners, abort/late responses, hidden/focused polling, panel persistence, escaped records, heatmap, CSS syntax.');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
