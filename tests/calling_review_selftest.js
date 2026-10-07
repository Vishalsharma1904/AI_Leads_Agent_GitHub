'use strict';
const assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm');
const records = new Map(), requests = [], storage = new Map();
let owner = 'tenant-a', polls = 0, aiRequests = 0;
const request = value => { const r = {}; queueMicrotask(() => { r.result = value; r.onsuccess?.(); }); return r; };
const indexedDB = { open(name) {
  if (!records.has(name)) records.set(name, new Map());
  const table = records.get(name), database = { transaction() {
    const tx = { objectStore: () => ({ put(t) { table.set(t.id, structuredClone(t)); queueMicrotask(() => tx.oncomplete?.()); },
      getAll: () => request([...table.values()]), delete(id) { table.delete(id); queueMicrotask(() => tx.oncomplete?.()); } }) };
    return tx;
  } }; return request(database);
} };
let engine;
const window = { SupabaseAuth: { getAccessToken: () => 'test-token', getUser: () => ({ id: owner }) },
  SKYLARK_CONFIG: { BACKEND_URL: 'http://test.invalid' },
  dispatchEvent(e) { if (e.type === 'sarvam:thread' && e.detail.thread.status === 'dialing') engine.stop(); },
  ClavisDirect: { hasKey: () => true, async complete() { aiRequests++;
    return { choices: [{ message: { content: JSON.stringify({ summary: 'Customer wants a site visit.', outcome: 'interested',
      review: { en: { title: 'Site visit requested', overview: 'Customer wants a site visit.', keyPoints: ['Two guards needed.'], nextSteps: ['No date agreed.'] },
        hi: { title: 'साइट विज़िट का अनुरोध', overview: 'ग्राहक ने साइट विज़िट मांगी।', keyPoints: ['दो गार्ड चाहिए।'], nextSteps: ['तारीख तय नहीं हुई।'] } } }) } }] };
  } } };
const fetch = async (url, options = {}) => {
  requests.push({ url, options }); let data = {};
  if (url.endsWith('/status')) data = { connected: true };
  if (url.endsWith('/calls')) data = { attempt_id: 'demo-1' };
  if (url.includes('/attempts?')) { polls++; data = { items: [{ attempt_id: 'demo-1', interaction_id: 'i-1', connectivity_status: 'connected',
    ...(polls > 1 ? { end_datetime: '2026-10-07T10:30:00Z' } : {}) }] }; }
  if (url.includes('/transcripts/')) data = { data: { messages: [{ role: 'user', text: 'दो गार्ड चाहिए।', en_text: 'Two guards needed.' }] } };
  if (url.includes('/recordings/')) data = { data: { audio_url: 'https://example.com/recording.wav' } };
  return { ok: true, status: 200, json: async () => data };
};
vm.runInNewContext(fs.readFileSync('sarvam-calling.js','utf8'), { window, indexedDB, fetch, URL, URLSearchParams, Date,
  localStorage: { getItem: k => storage.get(k) || null, setItem: (k,v) => storage.set(k,v) },
  location: { port:'3000', protocol:'http:' }, CustomEvent: class { constructor(type,{detail}) { this.type=type; this.detail=detail; } },
  setTimeout: (f,ms) => { if (ms !== 400) queueMicrotask(f); return 1; }, clearTimeout() {}, console });
engine = window.SarvamCalling;
(async () => {
  engine.setConfig({ orgId:'org', workspaceId:'ws', appId:'agent', connectionId:'connection', agentPhoneNumber:'+919811111111', businessName:'Test business', businessWhatWeSell:'Security' });
  engine.enqueue([{ id:'lead-1', company:'Untouched lead', phone:'+919822222222' }]);
  await assert.rejects(engine.demoCall('abc'), /valid mobile/);
  await assert.rejects(engine.demoCall('+919811111111'), /Caller ID/);
  assert.equal(requests.filter(r=>r.url.endsWith('/calls')).length,0);
  await engine.demoCall('9876543210');
  const dialled = requests.filter(r=>r.url.endsWith('/calls'));
  assert.equal(dialled.length,1); assert.equal(JSON.parse(dialled[0].options.body).phone_number,'+919876543210');
  assert.equal(engine.queueSnapshot()[0].status,'pending', 'Demo must not consume the lead queue');
  assert(polls >= 2,'Stopping the queue must not stop tracking the active call');
  const thread = (await engine.allThreads())[0]; assert.equal(thread.status,'done');
  assert.equal(thread.transcript[0].text,'दो गार्ड चाहिए।'); assert.equal(thread.recordingUrl,'https://example.com/recording.wav');
  await Promise.all([engine.summarizeThread(thread),engine.summarizeThread(thread)]);
  assert(thread.review.en.overview && thread.review.hi.overview);
  assert(aiRequests <= 2,'Concurrent clicks must share the summary request');
  await engine.flagThread(thread.id,'Review interruption');
  assert.equal((await engine.allThreads())[0].escalation.note,'Review interruption');
  owner='tenant-b'; assert.equal((await engine.allThreads()).length,0,'Call history must not leak across sign-ins');
  await assert.rejects(engine.putThread(thread),/Account badal gaya/); owner='tenant-a';
  assert.equal(engine.mediaUrl('javascript:alert(1)'), ''); assert.equal(engine.mapStatus('connected'),'connected');
  assert.equal(engine.attemptStatus({connectivity_status:'connected',end_datetime:'2026-10-07T10:30:00Z'}),'done');
  window.ClavisDirect.hasKey=()=>false;
  await assert.rejects(engine.summarizeThread(thread),/AI provider key/);
  assert(thread.review.hi.overview,'A failed regeneration must preserve the previous review');
  console.log('PASS: isolated one-call demo, continued tracking, recording, original transcript, bilingual review, error recovery and tenant isolation.');
})().catch(e=>{ console.error(e); process.exitCode=1; });
