// tests/eleven_live_voice_test.js — runs the real clavis-live.js against a fake
// ElevenLabs Agents server (same message shapes as the live API) and checks
// every voice behaviour end to end: start, hearing, leads, map, barge-in,
// reconnect, app events, sleep and setup errors. No network.
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let passed = 0, total = 0;
async function test(name, fn) {
  total++;
  try { await fn(); passed++; console.log('  PASS  ' + name); }
  catch (e) { console.error('  FAIL  ' + name); console.error(e); process.exitCode = 1; }
}

/* ── fake browser + app ─────────────────────────────────────── */
const store = {};
const events = {};
const calls = { fetch: [], toast: [], setup: [], leads: [], map: [], hide: 0, sleep: [], touch: 0, busy: [], wake: [], legacyResume: 0, chime: 0, captionLive: [], captionFinal: [] };
const sockets = [];
let fetchReply = (url) => String(url).includes('/image') ? ({ ok: true, status: 200, json: async () => ({ file_id: 'file_abc' }) }) : ({ ok: true, status: 200, json: async () => ({ signed_url: 'wss://api.elevenlabs.io/v1/convai/conversation?conversation_signature=x', custom_llm_extra_body: { reasoning_effort: 'low', include_reasoning: false } }) });
let playerMsgs = [];

function node() { return { connect(n) { return n || node(); }, disconnect() {} }; }
class FakeWS {
  constructor(url) { this.url = url; this.readyState = 0; this.sent = []; sockets.push(this); setTimeout(() => { this.readyState = 1; this.onopen && this.onopen(); }, 5); }
  send(d) { this.sent.push(JSON.parse(d)); }
  close(code, reason) { this.readyState = 3; this.closedWith = code; }
  // server side helpers
  emit(m) { this.onmessage && this.onmessage({ data: JSON.stringify(m) }); }
  drop(code = 1006, reason = '') { this.readyState = 3; this.onclose && this.onclose({ code, reason }); }
  json(type) { return this.sent.filter((m) => m.type === type); }
  chunks() { return this.sent.filter((m) => m.user_audio_chunk).length; }
}
FakeWS.OPEN = 1;

const win = {
  console, setTimeout, clearTimeout, setInterval, clearInterval, Promise, Date, Math, JSON, Number, String, Object, Array, Set, Map, RegExp, Error,
  Float32Array, Int16Array, Uint8Array, AbortController, AbortSignal, atob, btoa,
  localStorage: { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: (k) => { delete store[k]; } },
  sessionStorage: { getItem: () => null, setItem() {}, removeItem() {} },
  addEventListener: (t, f) => { (events[t] = events[t] || []).push(f); },
  requestAnimationFrame: () => 1, cancelAnimationFrame() {}, requestIdleCallback: () => {},
  document: { readyState: 'complete', addEventListener: (t, f) => { (events['doc:' + t] = events['doc:' + t] || []).push(f); }, querySelector: () => null, getElementById: () => null,
    createElement: (tag) => tag === 'canvas' ? { width: 0, height: 0, getContext: () => ({ drawImage() {} }), toDataURL: () => 'data:image/jpeg;base64,/9j/4AAQ' } : ({ classList: { add() {}, remove() {}, toggle() {} }, setAttribute() {}, addEventListener() {}, appendChild() {}, querySelector: () => null, style: { setProperty() {} }, dataset: {} }),
    body: { appendChild() {} } },
  WebSocket: FakeWS,
  Image: class { set src(v) { this.naturalWidth = 1920; this.naturalHeight = 1080; setTimeout(() => this.onload && this.onload(), 1); } },
  ClavisPC: { peek: async () => 'data:image/png;base64,AAAA', screenSize: async () => ({ width: 1920, height: 1080 }) },
  AudioContext: function () {
    return { state: 'running', currentTime: 0, destination: node(), createGain: () => Object.assign(node(), { gain: { value: 1, setTargetAtTime() {} } }),
      createAnalyser: () => Object.assign(node(), { fftSize: 512, getFloatTimeDomainData() {} }), createMediaStreamSource: () => node(), resume: async () => {}, close: async () => {} };
  },
  AudioWorkletNode: function (ctx, name) {
    const n = Object.assign(node(), { port: { onmessage: null, postMessage: (m) => { if (name === 'clavis-pcm-player') playerMsgs.push(m); } } });
    if (name === 'clavis-mic-capture') win.__mic = n;
    return n;
  },
  navigator: { mediaDevices: { getUserMedia: async () => ({ getTracks: () => [{ stop() {} }], getAudioTracks: () => [{ addEventListener() {} }] }) } },
  fetch: async (url, opts) => { calls.fetch.push({ url: String(url), body: opts && opts.body ? JSON.parse(opts.body) : null, auth: opts?.headers?.Authorization, signal: opts?.signal }); return fetchReply(url); },
  SKYLARK_CONFIG: { BACKEND_URL: 'http://localhost:3000' },
  SupabaseAuth: { getAccessToken: () => 'jwt-test', getUser: () => ({ id: 'u1' }) },
  ClavisWorklet: { add: async () => {} },
  showToast: (t) => calls.toast.push(t),
  ClavisSetup: { open: (o) => calls.setup.push(o) },
  playWakeChime: () => calls.chime++,
  scheduleHandsFreeRelisten: () => calls.legacyResume++,
  ClavisVoiceState: { canProcessMic: () => true, mark() {}, set() {}, notePartial() {}, mic: { claim() {}, release() {} }, parseStop: () => null },
  ClavisEar: { caption: { live: (t) => calls.captionLive.push(t), final: (t) => calls.captionFinal.push(t), clear() {} }, noteSpoken() {}, noteSpeaking() {}, noteSpeakingDone() {} },
  ClavisWake: (() => { let awake = false; return {
    isAwake: () => awake, wake: (s) => { awake = true; calls.wake.push(s); return true; }, touch: () => { calls.touch++; awake = true; return true; },
    busy: (on, who) => calls.busy.push([on, who]), sleep: (r) => { awake = false; calls.sleep.push(r); }, sessionMs: () => 180000, allowBackground: () => true,
  }; })(),
  ClavisCanvas: { isOpen: () => calls.map.length > 0, showMap: async (a) => { calls.map.push(a); return { ok: true, name: a.place }; }, hide: () => { calls.hide++; } },
  ChatEngine: { sendMessage: async (t) => { calls.leads.push(t); return { text: 'Noida me 20 leads dhoondh raha hoon', action: { type: 'generate' } }; } },
  ClavisTask: { current: () => null },
  JarvisSkills: {
    _r: { list_leads: { name: 'list_leads', description: 'List saved leads', params: { limit: 'number of leads (default 10)' }, builtin: true } },
    get(n) { return this._r[n]; }, has(n) { return !!this._r[n]; }, list() { return Object.values(this._r); },
    invoke: async (n, p) => ({ success: true, result: `${n} ok ${JSON.stringify(p)}` }),
  },
  ClavisAppMap: { resolve: (t) => (/leads page/i.test(t) ? { run: () => 'Opened Leads.' } : null), guide: { context: () => '' }, describe: () => '' },
  ClavisIntent: { route: async () => ({ handled: false }), screenContext: () => 'Leads page', habitsLine: () => '', learn() {} },
  ClavisCommands: { route: async () => ({ handled: false }) },
  AuthSystem: { getProfile: () => ({ firstName: 'Vishal' }) },
};
win.window = win;
const ctx = vm.createContext(win);
vm.runInContext(fs.readFileSync(path.join(ROOT, 'clavis-live.js'), 'utf8'), ctx, { filename: 'clavis-live.js' });
const Live = win.ClavisLive;
const mic = (n) => { for (let i = 0; i < n; i++) win.__mic.port.onmessage({ data: { type: 'pcm', audio: new Float32Array(512).fill(0.02).buffer } }); };
const last = () => sockets[sockets.length - 1];
const ready = (ws, id = 'conv_1') => ws.emit({ type: 'conversation_initiation_metadata', conversation_initiation_metadata_event: { conversation_id: id, agent_output_audio_format: 'pcm_24000' } });
const pcm = (n = 480) => Buffer.from(new Int16Array(n).buffer).toString('base64');

(async () => {
  console.log('\n--- ElevenLabs live voice (fake server) ---\n');

  await test('Self-test of pure helpers passes', () => assert.strictEqual(Live._selfTest(), true));

  await test('Live Hindi prompt and voice use the account selection', () => {
    win.ClavisElevenVoiceSettings = { resolveVoice: () => ({ voice_id: 'hindi-voice', labels: { gender: 'female' } }) };
    assert.match(Live._persona(), /Hindi words in Devanagari/);
    assert.match(Live._persona(), /female voice/);
    assert.ok(!Live._persona().includes('NEVER write Devanagari'));
  });

  await test('Start: signed session fetched with persona + tools, socket opens, chime plays', async () => {
    assert.strictEqual(await Live.start({ trigger: 'button' }), true);
    const req = calls.fetch.find((c) => c.url.endsWith('/api/v1/elevenlabs/assistant/session'));
    assert.ok(req, 'session endpoint called');
    assert.strictEqual(req.auth, 'Bearer jwt-test');
    assert.ok(req.body.persona.includes('RUDRA') && req.body.persona.length > 3000);
    assert.ok(['find_leads', 'show_map', 'list_leads', 'app_command'].every((n) => req.body.tools.some((t) => t.name === n)));
    assert.ok(req.body.keywords.includes('Gurugram'));
    assert.strictEqual(req.body.voice_id, 'hindi-voice');
    await wait(20);
    assert.ok(last().url.startsWith('wss://api.elevenlabs.io/'));
    assert.strictEqual(req.body.groq_model, 'openai/gpt-oss-120b', 'brain is Groq');
    const init = last().json('conversation_initiation_client_data');
    assert.strictEqual(init.length, 1);
    assert.strictEqual(init[0].custom_llm_extra_body.reasoning_effort, 'low');
    assert.strictEqual(calls.chime, 1);
    assert.strictEqual(Live.status().phase, 'connecting');
  });

  await test('Words said while connecting are kept (preroll) and sent first', async () => {
    mic(10);
    assert.strictEqual(last().chunks(), 0, 'nothing sent before the agent is ready');
    ready(last());
    assert.ok(last().chunks() >= 3, 'preroll flushed');
    const ctxMsg = last().json('contextual_update')[0];
    assert.ok(ctxMsg && /\[APP CONTEXT\]/.test(ctxMsg.text) && /Leads page/.test(ctxMsg.text));
    assert.strictEqual(Live.status().ready, true);
  });

  await test('Mic streams continuously in ~96 ms packets', () => {
    const before = last().chunks();
    mic(9);
    assert.strictEqual(last().chunks() - before, 3);
  });

  await test('Live caption from tentative transcript; final turn keeps Rudra awake', () => {
    const t0 = calls.touch;
    last().emit({ type: 'tentative_user_transcript', tentative_user_transcription_event: { user_transcript: 'Noida ki leads' } });
    assert.strictEqual(calls.captionLive.pop(), 'Noida ki leads');
    last().emit({ type: 'user_transcript', user_transcription_event: { user_transcript: 'Noida ki 20 leads nikalo' } });
    assert.ok(calls.touch > t0);
    assert.strictEqual(calls.captionFinal.pop(), 'Noida ki 20 leads nikalo');
  });

  await test('find_leads tool runs the real lead pipeline and reports "started"', async () => {
    last().emit({ type: 'client_tool_call', client_tool_call: { tool_name: 'find_leads', tool_call_id: 'c1', parameters: { request: 'Get 20 security client leads in Noida' } } });
    await wait(30);
    assert.deepStrictEqual(calls.leads, ['Get 20 security client leads in Noida']);
    const r = last().json('client_tool_result').find((m) => m.tool_call_id === 'c1');
    assert.ok(r && !r.is_error && /"status":"started"/.test(r.result));
    last().emit({ type: 'client_tool_call', client_tool_call: { tool_name: 'find_leads', tool_call_id: 'c1', parameters: { request: 'Get 20 security client leads in Noida' } } });
    await wait(5);
    assert.strictEqual(calls.leads.length, 1, 'replayed provider tool id does not dispatch a second paid search');
  });

  await test('Voice web reading forwards account authorization and its cancellation signal', async () => {
    const original = fetchReply;
    fetchReply = () => ({ ok: true, status: 200, json: async () => ({ text: 'Public company website.' }) });
    last().emit({ type: 'client_tool_call', client_tool_call: { tool_name: 'read_website', tool_call_id: 'c-web', parameters: { url: 'example.com' } } });
    await wait(20);
    const req = calls.fetch.find(c => c.url.endsWith('/api/v1/web/read'));
    assert.strictEqual(req.auth, 'Bearer jwt-test');
    assert.ok(req.signal && !req.signal.aborted);
    fetchReply = original;
  });

  await test('show_map opens the map; asking the same again is not redrawn', async () => {
    last().emit({ type: 'client_tool_call', client_tool_call: { tool_name: 'show_map', tool_call_id: 'c2', parameters: { place: 'Cyber Hub Gurugram' } } });
    await wait(20);
    last().emit({ type: 'client_tool_call', client_tool_call: { tool_name: 'show_map', tool_call_id: 'c3', parameters: { place: 'Cyber Hub Gurugram' } } });
    await wait(20);
    assert.strictEqual(calls.map.length, 1);
    assert.ok(/already on screen/.test(last().json('client_tool_result').find((m) => m.tool_call_id === 'c3').result));
  });

  await test('JarvisSkills tools and app commands run; unknown tool is reported as an error', async () => {
    last().emit({ type: 'client_tool_call', client_tool_call: { tool_name: 'list_leads', tool_call_id: 'c4', parameters: { limit: 5 } } });
    last().emit({ type: 'client_tool_call', client_tool_call: { tool_name: 'app_command', tool_call_id: 'c5', parameters: { request: 'open the leads page' } } });
    last().emit({ type: 'client_tool_call', client_tool_call: { tool_name: 'app_command', tool_call_id: 'c6', parameters: { request: 'do a backflip' } } });
    last().emit({ type: 'client_tool_call', client_tool_call: { tool_name: 'nope', tool_call_id: 'c7', parameters: {} } });
    await wait(30);
    const res = (id) => last().json('client_tool_result').find((m) => m.tool_call_id === id);
    assert.ok(/list_leads ok/.test(res('c4').result) && !res('c4').is_error);
    assert.ok(/Opened Leads/.test(res('c5').result) && !res('c5').is_error);
    assert.ok(/No app command matched/.test(res('c6').result) && res('c6').is_error);
    assert.ok(res('c7').is_error);
  });

  await test('"Close everything" never closes a PC app he did not name', async () => {
    last().emit({ type: 'user_transcript', user_transcription_event: { user_transcript: 'sab band karo' } });
    last().emit({ type: 'client_tool_call', client_tool_call: { tool_name: 'pc_close_window', tool_call_id: 'c8', parameters: { title: 'Google Chrome' } } });
    await wait(20);
    assert.ok(/close_display instead/.test(last().json('client_tool_result').find((m) => m.tool_call_id === 'c8').result));
  });

  await test('Rudra speaks: audio plays, caption shows "Rudra" (spoken "Rudraa")', () => {
    playerMsgs = [];
    last().emit({ type: 'agent_response', agent_response_event: { agent_response: 'Ji sir, main Rudraa — Noida ki leads nikal raha hoon.' } });
    last().emit({ type: 'audio', audio_event: { audio_base_64: pcm(), event_id: 3 } });
    last().emit({ type: 'audio', audio_event: { audio_base_64: pcm(), event_id: 4 } });
    assert.strictEqual(playerMsgs.filter((m) => m.type === 'chunk').length, 2);
    assert.strictEqual(Live.status().state, 'speaking');
  });

  await test('Barge-in: interruption stops audio at once and drops the cut reply\'s tail', () => {
    playerMsgs = [];
    last().emit({ type: 'interruption', interruption_event: { event_id: 4 } });
    assert.ok(playerMsgs.some((m) => m.type === 'stop'), 'player told to stop');
    assert.strictEqual(Live.status().state, 'listening');
    last().emit({ type: 'audio', audio_event: { audio_base_64: pcm(), event_id: 4 } });   // late tail of the old reply
    assert.strictEqual(playerMsgs.filter((m) => m.type === 'chunk').length, 0);
    last().emit({ type: 'audio', audio_event: { audio_base_64: pcm(), event_id: 5 } });   // the new reply
    assert.strictEqual(playerMsgs.filter((m) => m.type === 'chunk').length, 1);
  });

  await test('Ping is answered with pong', () => {
    last().emit({ type: 'ping', ping_event: { event_id: 42, ping_ms: 10 } });
    assert.deepStrictEqual(last().json('pong').pop(), { type: 'pong', event_id: 42 });
  });

  await test('App event (lead search finished) is spoken at the next quiet moment', async () => {
    win.__mic.port.onmessage({ data: { type: 'pcm', audio: new Float32Array(512).buffer } });
    win.ClavisLive.hush();                       // audio finished
    events['doc:nexus:scrapedone'].forEach((f) => f({ detail: { leads: new Array(18) } }));
    await wait(1500);
    const m = last().json('user_message').pop();
    assert.ok(m && /\[SYSTEM EVENT\].*18 leads/.test(m.text));
  });

  await test('Connection drop: reconnects with a fresh signed URL and the last turns as context', async () => {
    const n = sockets.length, f = calls.fetch.length;
    last().drop(1006);
    await wait(400);
    assert.strictEqual(sockets.length, n + 1);
    assert.strictEqual(calls.fetch.length, f + 1);
    ready(last(), 'conv_2');
    const c = last().json('contextual_update')[0].text;
    assert.ok(/Conversation so far/.test(c) && /Noida ki 20 leads nikalo/.test(c));
    assert.strictEqual(Live.status().conversation, 'conv_2');
  });

  await test('Wake-word command said while already live goes straight in', async () => {
    await Live.start({ trigger: 'wake word', initialText: 'Gurgaon ka map dikhao' });
    assert.strictEqual(last().json('user_message').pop().text, 'Gurgaon ka map dikhao');
  });

  await test('Eyes: look_at_screen uploads a screenshot and shows it to the agent', async () => {
    last().emit({ type: 'client_tool_call', client_tool_call: { tool_name: 'look_at_screen', tool_call_id: 'cS', parameters: { focus: 'error' } } });
    await wait(150);
    const up = calls.fetch.filter((c) => /\/assistant\/conversations\/conv_2\/image$/.test(c.url)).pop();
    assert.ok(up && up.body.image_b64 === '/9j/4AAQ');
    const r = last().json('client_tool_result').find((m) => m.tool_call_id === 'cS');
    assert.ok(!r.is_error && /1\.500/.test(r.result));
    const mm = last().json('multimodal_message').pop();
    assert.strictEqual(mm.file.file_id, 'file_abc');
    assert.ok(/screenshot/.test(mm.text.text) && mm.text.type === 'user_message');
  });

  await test('"So jao": go_to_sleep ends the session, wake listener comes back', async () => {
    const r0 = calls.legacyResume;
    last().emit({ type: 'client_tool_call', client_tool_call: { tool_name: 'go_to_sleep', tool_call_id: 'c9', parameters: { reason: 'asked' } } });
    await wait(2800);
    assert.strictEqual(Live.status().phase, 'off');
    assert.ok(calls.sleep.includes('live'));
    assert.ok(calls.legacyResume > r0, 'local wake listener resumed');
    assert.ok(store.clavis_slept_at, 'next wake is a "dozed off" wake');
  });

  await test('Next wake after sleep greets like waking up, then listens', async () => {
    await Live.start({ trigger: 'clap' });
    await wait(20);
    ready(last());
    const m = last().json('user_message')[0];
    assert.ok(m && /gone to sleep/.test(m.text));
    assert.ok(!store.clavis_slept_at, 'marker used once');
    Live.stop({ reason: 'user' });
  });

  await test('Mute sends silence (keeps timing) instead of his voice', async () => {
    await Live.start({ trigger: 'button' });
    await wait(20); ready(last());
    Live.setMuted(true);
    const before = last().sent.length;
    mic(3);
    const pkt = last().sent.slice(before).find((m) => m.user_audio_chunk);
    assert.ok(Buffer.from(pkt.user_audio_chunk, 'base64').every((b) => b === 0));
    Live.stop({ reason: 'user' });
  });

  await test('No ElevenLabs key: voice opens Setup on ElevenLabs and says why', async () => {
    fetchReply = () => ({ ok: false, status: 409, json: async () => ({ detail: { code: 'ELEVENLABS_KEY_MISSING', message: 'Connect your ElevenLabs API key in Setup first.' } }) });
    await Live.start({ trigger: 'button' });
    await wait(30);
    assert.strictEqual(Live.status().phase, 'off');
    assert.strictEqual(calls.setup.pop().provider, 'elevenlabs');
    assert.ok(/ElevenLabs API key/.test(calls.toast.pop().message));
  });

  await test('No Groq key: voice opens Setup on Groq, and the next tap works at once', async () => {
    fetchReply = () => ({ ok: false, status: 409, json: async () => ({ detail: 'Connect your Groq key in Rudra AI Setup before saving an ElevenLabs agent' }) });
    await Live.start({ trigger: 'button' });
    await wait(30);
    assert.strictEqual(calls.setup.pop().provider, 'groq');
    assert.strictEqual(Live.isAvailable(), true, 'no 15 s lock-out after a setup error');
  });

  await test('Never opens a paid session on its own (boot / proactive)', async () => {
    assert.strictEqual(await Live.start({ trigger: 'boot' }), false);
    assert.strictEqual(await Live.start({ trigger: 'proactive' }), false);
  });

  await test('Validation failures explain the affected field instead of the generic startup toast', async () => {
    fetchReply = () => ({ ok: false, status: 422, json: async () => ({ detail: [{ loc: ['body', 'tools', 0, 'description'], type: 'string_too_long', input: 'PRIVATE INPUT' }] }) });
    await Live.start({ trigger: 'button' }); await wait(20);
    const message = calls.toast.at(-1).message;
    assert.match(message, /tools/); assert.ok(!message.includes('PRIVATE INPUT'));
    assert.strictEqual(Live.status().phase, 'off');
    assert.strictEqual(Live.isAvailable(), true, 'corrected setup can retry immediately');
  });

  await test('Account ownership conflict does not send the user into a repeated paste-key loop', async () => {
    const count = calls.setup.length;
    fetchReply = () => ({ ok: false, status: 409, json: async () => ({ detail: { code: 'ELEVENLABS_ACCOUNT_OWNERSHIP', message: 'This provider account is connected elsewhere. Ask the owner to assign shared access.' } }) });
    await Live.start({ trigger: 'button' }); await wait(20);
    assert.strictEqual(calls.setup.length, count);
    assert.match(calls.toast.at(-1).message, /assign shared access/);
    assert.strictEqual(Live.status().phase, 'off');
  });

  await test('Stopping while microphone permission is pending releases its late stream', async () => {
    let release, stopped = 0;
    const original = win.navigator.mediaDevices.getUserMedia;
    win.navigator.mediaDevices.getUserMedia = () => new Promise(resolve => { release = resolve; });
    fetchReply = () => ({ ok: true, status: 200, json: async () => ({ signed_url: 'wss://api.elevenlabs.io/v1/convai/conversation?conversation_signature=x' }) });
    const pending = Live.start({ trigger: 'button' });
    Live.stop({ reason: 'user' });
    release({ getTracks: () => [{ stop() { stopped++; } }], getAudioTracks: () => [] });
    assert.strictEqual(await pending, false);
    assert.strictEqual(stopped, 1, 'late microphone cannot stay recording after Stop');
    win.navigator.mediaDevices.getUserMedia = original;
    assert.strictEqual(Live.status().phase, 'off');
  });

  await test('A previous session reconnect timer cannot replace a restarted live session', async () => {
    await Live.start({ trigger: 'button' }); await wait(20); ready(last());
    last().drop(1006);
    Live.stop({ reason: 'user' });
    await Live.start({ trigger: 'button' }); await wait(20); ready(last());
    const count = sockets.length, session = last();
    await wait(350);
    assert.strictEqual(sockets.length, count, 'old retry cannot create an extra paid socket');
    assert.strictEqual(last(), session);
    assert.strictEqual(Live.status().phase, 'live');
    Live.stop({ reason: 'user' });
  });

  console.log(`\n${passed}/${total} ElevenLabs live voice checks passed\n`);
  process.exit(passed === total ? 0 : 1);
})();
