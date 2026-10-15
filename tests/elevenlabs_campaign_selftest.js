/* Offline provider fixture: no real calls or credits. */
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require('node:path').join(__dirname, '../elevenlabs-campaign.js'), 'utf8');
const flush = async () => { for (let i = 0; i < 24; i++) await Promise.resolve(); };
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
function fixture(options = {}) {
  const store = options.store || new Map(), lockSet = options.lockSet || new Set(), events = new Map(), timers = new Map();
  let user = options.user || 'tenant-a', now = 100000, timerId = 0, callId = 0;
  const calls = [], conversationStates = new Map();
  const window = { SupabaseAuth: { getUser: () => user ? { id: user } : null, getAccessToken: () => user ? 'auth-' + user : '' },
    SKYLARK_CONFIG: { BACKEND_URL: 'https://backend.test' }, addEventListener(name, fn) { events.set(name, fn); },
    navigator: { locks: { async request(name, _opts, run) {
      if (lockSet.has(name)) return run(null);
      lockSet.add(name); try { return await run({ name }); } finally { lockSet.delete(name); }
    } } } };
  async function fetch(url, request) {
    const path = new URL(url).pathname;
    calls.push({ path, auth: request.headers.Authorization, method: request.method || 'GET', body: request.body && JSON.parse(request.body) });
    if (options.fetch) { const response = await options.fetch(path, request, calls); if (response) return response; }
    if (path.endsWith('/calling-readiness')) return Response.json({ ready: true, missing: [], max_duration_seconds: 60 });
    if (path.endsWith('/calls')) {
      const id = 'conv-' + (++callId); conversationStates.set(id, 'in-progress');
      return Response.json({ success: true, conversation_id: id });
    }
    const id = path.split('/').pop();
    return Response.json({ conversation_id: id, agent_id: 'agent-a', status: conversationStates.get(id) || 'done', transcript: [{ role: 'user', message: 'Hello' }] });
  }
  const localStorage = { getItem: key => store.get(key) || null, setItem: (key, value) => { if (options.storageError) throw Error('Blocked'); store.set(key, value); } };
  class Clock extends Date { static now() { return now; } }
  vm.runInNewContext(source, { window, location: { hostname: 'localhost', port: '3000', protocol: 'http:' }, localStorage, fetch, AbortController, DOMException, Date: Clock,
    setTimeout(fn, ms) { const id = ++timerId; timers.set(id, { fn, ms }); return id; }, clearTimeout(id) { timers.delete(id); } });
  return { api: window.ElevenLabsCampaign, calls, store, conversationStates, timers, lockSet,
    async advance() { now += 3000; for (const [id, timer] of [...timers]) if (timer.ms === 3000) { timers.delete(id); timer.fn(); } await flush(); },
    switchUser(id) { user = id; events.get('rudra:auth-state')(); },
    outbound: () => calls.filter(call => call.path.endsWith('/calls')) };
}
const config = { agentId: 'agent-a', phoneNumberId: 'phone-a', confirmed: true, limit: 100 };
const leads = [{ id: 'a', company: 'Hotel A', phone: '9876543210' }, { id: 'b', company: 'Hotel B', phone: '+919876543211' }];
(async () => {
  {
    const f = fixture(); let renders = 0; const off = f.api.on(() => { renders++; });
    assert.equal(f.api.enqueue([...leads, leads[0], { phone: '12345' }]).added, 2);
    assert.equal(f.api.snapshot().items[0].lead.phone, '+919876543210'); off();
    const before = renders; f.api.pause(); assert.equal(renders, before, 'on returns unsubscribe');
    await assert.rejects(f.api.start({ ...config, confirmed: false }), /Confirm/);
    assert.equal(f.outbound().length, 0, 'No calls before explicit confirmation');
    await f.api.start({ ...config, limit: 1000 }); await flush();
    assert.equal(f.outbound().length, 1, 'Only one accepted call at a time');
    assert.equal(f.api.snapshot().limit, 100);
    assert.equal(f.api.snapshot().currentId, 'a');
    assert.equal(f.api.snapshot().items[0].status, 'in-progress');
    f.api.pause(); f.conversationStates.set('conv-1', 'done'); await f.advance();
    assert.equal(f.outbound().length, 1, 'Pause tracks existing call and prevents next');
    assert.equal(f.api.snapshot().currentId, null);
    assert.equal(f.api.snapshot().items[0].detail.transcript[0].message, 'Hello');
    await f.api.resume(config); await flush(); assert.equal(f.outbound().length, 2);
    f.api.stop(); f.conversationStates.set('conv-2', 'done'); await f.advance();
    assert.equal(f.api.snapshot().running, false);
  }
  {
    const f = fixture({ fetch: async path => path.endsWith('/calls') ? Response.json({ detail: 'Outcome lost' }, { status: 502 }) : null });
    f.api.enqueue(leads); await f.api.start(config); await flush();
    assert.equal(f.api.snapshot().items[0].status, 'unknown');
    await assert.rejects(f.api.resume(config), /active or unknown/);
    await assert.rejects(f.api.refreshActive(), /No conversation ID/);
    const reloaded = fixture({ store: f.store });
    assert.equal(reloaded.api.snapshot().items[0].status, 'unknown');
    assert.equal(reloaded.outbound().length, 0, 'Reload never redials uncertain request');
    assert.throws(() => reloaded.api.clear(), /resolve active/);
    assert.throws(() => reloaded.api.resolveUnknown({ id: 'a', confirmedReviewed: false }), /reviewed provider history/);
    reloaded.api.resolveUnknown({ id: 'a', confirmedReviewed: true });
    assert.equal(reloaded.api.snapshot().items[0].status, 'skipped');
    assert.equal(reloaded.outbound().length, 0, 'Reconciliation never redials the uncertain contact');
  }
  {
    const gate = deferred();
    const f = fixture({ fetch: async path => path.endsWith('/calling-readiness') ? gate.promise : null });
    f.api.enqueue(leads); const pending = f.api.start(config); f.api.stop();
    gate.resolve(Response.json({ ready: true })); await pending; await flush();
    assert.equal(f.outbound().length, 0, 'Stop during readiness prevents paid request');
  }
  {
    const gate = deferred();
    const f = fixture({ fetch: async path => path.endsWith('/calling-readiness') ? gate.promise : null });
    f.api.enqueue(leads); const pending = f.api.start(config);
    f.switchUser('tenant-b'); gate.resolve(Response.json({ ready: true }));
    await assert.rejects(pending, /Account changed/); await flush();
    assert.equal(f.outbound().length, 0, 'Old readiness cannot dial under new account');
    assert.equal(f.api.snapshot().items.length, 0);
    f.switchUser('tenant-a'); assert.equal(f.api.snapshot().items.length, 2, 'Queue remains scoped to its tenant');
    assert.equal(f.api.snapshot().running, false, 'Original tenant must explicitly restart');
  }
  {
    const gate = deferred();
    const f = fixture({ fetch: async path => path.endsWith('/calls') ? gate.promise : null });
    f.api.enqueue(leads); await f.api.start(config); await flush();
    assert.equal(f.api.snapshot().items[0].status, 'dialing');
    f.switchUser('tenant-b'); gate.resolve(Response.json({ success: true, conversation_id: 'late-call' })); await flush();
    assert.equal(f.api.snapshot().items.length, 0, 'Late response never writes another tenant');
    assert.equal(f.outbound().length, 1, 'Account switch prevents next lead');
    f.switchUser('tenant-a'); assert.equal(f.api.snapshot().items[0].status, 'unknown', 'Interrupted request retained for review');
  }
  {
    const f = fixture(); f.api.enqueue(leads);
    const before = JSON.stringify(f.api.snapshot().items);
    const demo = await f.api.demoCall({ ...config, phone: '9876543222' }); await flush();
    assert.equal(demo.conversationId, 'conv-1');
    assert.equal(f.outbound()[0].body.to_number, '+919876543222');
    assert.equal(JSON.stringify(f.api.snapshot().items), before, 'Demo never consumes selected lead queue');
    await assert.rejects(f.api.start(config), /active or unknown/);
    f.conversationStates.set('conv-1', 'done'); await f.advance();
    assert.equal(f.api.snapshot().demo.status, 'done');
  }
  {
    const store = new Map(), lockSet = new Set();
    const first = fixture({ store, lockSet }); first.api.enqueue(leads); await first.api.start(config); await flush();
    const second = fixture({ store, lockSet });
    // A different selected lead cannot open a second session in another tab.
    second.api.snapshot(); await assert.rejects(second.api.start(config), /active or unknown/);
    const third = fixture({ lockSet }); third.api.enqueue(leads); await assert.rejects(third.api.start(config), /Another calling session/);
    assert.equal(third.outbound().length, 0);
    first.api.stop(); first.conversationStates.set('conv-1', 'done'); await first.advance();
  }
  {
    const store = new Map(), lockSet = new Set(), gate = deferred();
    const first = fixture({ store, lockSet }); first.api.enqueue(leads);
    const stale = fixture({ store, lockSet, fetch: async path => path.endsWith('/calling-readiness') ? gate.promise : null });
    const waiting = stale.api.start({ ...config, limit: 1 });
    await first.api.start({ ...config, limit: 1 }); await flush();
    first.conversationStates.set('conv-1', 'done'); await first.advance();
    gate.resolve(Response.json({ ready: true })); await waiting; await flush();
    assert.equal(stale.outbound().length, 1);
    assert.equal(stale.outbound()[0].body.to_number, leads[1].phone, 'Stale readiness reloads progress under lock and never redials finished contact');
    stale.api.stop(); stale.conversationStates.set('conv-1', 'done'); await stale.advance();
  }
  {
    const f = fixture({ fetch: async path => path.endsWith('/calls') ? Response.json({ success: true }) : path.endsWith('/verify-call') ? Response.json({ verified: true, conversation: { status: 'done', conversation_id: 'recovered' } }) : null });
    f.api.enqueue(leads); await f.api.start(config); await flush();
    await f.api.linkConversation({ id: 'a', conversationId: 'recovered' });
    assert.equal(f.api.snapshot().items[0].status, 'done');
    assert.equal(f.api.snapshot().currentId, null); assert.equal(f.outbound().length, 1);
  }
  {
    const f = fixture({ storageError: true });
    assert.throws(() => f.api.enqueue(leads), /could not be saved/);
    await assert.rejects(f.api.start(config), /could not be saved/); await flush();
    assert.equal(f.outbound().length, 0, 'Do not dial without saving an attempt first');
  }
  {
    const f = fixture(); f.api.enqueue(leads); await f.api.start({ ...config, limit: 1 }); await flush();
    f.conversationStates.set('conv-1', 'processing'); await f.advance();
    assert.equal(f.api.snapshot().currentId, 'a', 'Processing does not prove call completed');
    f.conversationStates.set('conv-1', 'done'); await f.advance();
    assert.equal(f.outbound().length, 1, 'Batch stops at explicitly confirmed limit');
    assert.equal(f.api.snapshot().items[1].status, 'pending');
  }
  {
    const f = fixture({ fetch: async path => path.endsWith('/calls') ? Response.json({ detail: 'Provider allowance exhausted' }, { status: 429 }) : null });
    f.api.enqueue(leads); await f.api.start(config); await flush(); await f.advance();
    assert.equal(f.api.snapshot().items[0].status, 'pending', 'Explicit quota response stays available for manual retry');
    assert.equal(f.api.snapshot().running, false);
    assert.equal(f.outbound().length, 1, 'Quota never creates automatic dispatch retry');
  }
  {
    const f = fixture({ fetch: async path => path.endsWith('/calls') ? Response.json({ success: true, call_id: 'provider-reference' }) : null });
    f.api.enqueue(leads); await f.api.start(config); await flush();
    assert.equal(f.api.snapshot().items[0].status, 'unknown', 'Accepted without review ID cannot authorize next lead');
    assert.equal(f.outbound().length, 1);
  }
  console.log('PASS ElevenLabs campaign: confirmation, bounded sequential queue, pause/resume/stop, uncertain outcomes, account isolation, separate demo, tab lock, durable attempts');
})().catch(error => { console.error(error); process.exitCode = 1; });
