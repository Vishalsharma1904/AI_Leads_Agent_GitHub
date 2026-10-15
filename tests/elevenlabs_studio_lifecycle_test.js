'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const nodes = new Map();
function node() { return { hidden: false, textContent: '', dataset: {}, children: [], attributes: {}, open: false,
  classList: { contains: () => false }, replaceChildren(...children) { this.children = children; }, append(...children) { this.children.push(...children); },
  setAttribute(name, value) { this.attributes[name] = value; }, addEventListener() {}, querySelectorAll: () => [], querySelector: () => null,
  close() { this.open = false; }, showModal() { this.open = true; }, reset() {}, focus() {}, remove() {},
  get firstElementChild() { return this.children[0]; } }; }
function element(id) {
  if (!nodes.has(id)) nodes.set(id, node());
  return nodes.get(id);
}
const document = { readyState: 'loading', addEventListener() {}, getElementById: element,
  createElement: node };
let mediaResolve, sockets = [], tracksStopped = 0, contextsClosed = 0, token = 'tenant-token', navigations = [];
class AudioContext {
  constructor() { this.sampleRate = 16000; this.destination = {}; }
  resume() { return Promise.resolve(); }
  close() { contextsClosed++; return Promise.resolve(); }
  createMediaStreamSource() { return { connect() {}, disconnect() {} }; }
}
class AudioWorkletNode {
  constructor() { this.messages = []; this.port = { postMessage: message => this.messages.push(message) }; }
  connect() {} disconnect() {}
}
class WebSocket {
  static OPEN = 1;
  constructor(url) { this.url = url; this.readyState = 1; this.sent = []; this.bufferedAmount = 0; sockets.push(this); }
  send(message) { this.sent.push(JSON.parse(message)); }
  close() { this.readyState = 3; this.onclose?.(); }
  receive(message) { this.onmessage({ data: JSON.stringify(message) }); }
}
const events = new Map();
const window = { document, AudioContext, AudioWorkletNode, isSecureContext: true,
  addEventListener(name, handler) { events.set(name, handler); }, SupabaseAuth: { getAccessToken: () => token },
  ClavisWorklet: { add: async () => {} }, showView: page => navigations.push(page) };
const context = vm.createContext({ window, document, navigator: { mediaDevices: { getUserMedia: () => new Promise(resolve => { mediaResolve = resolve; }) } },
  location: { port: '3000', hash: '#voice-ai' }, WebSocket, AudioWorkletNode, DOMException, URL, AbortController, setTimeout, clearTimeout,
  fetch: async () => ({ ok: true, json: async () => ({ signed_url: 'wss://api.elevenlabs.io/v1/convai/conversation?conversation_signature=fixture', custom_llm_extra_body: { reasoning_effort: 'low', include_reasoning: false } }) }),
  btoa: text => Buffer.from(text, 'binary').toString('base64'), atob: text => Buffer.from(text, 'base64').toString('binary'),
  console, Float32Array, Int16Array, Uint8Array, Option: class { constructor(text, value) { this.text = text; this.value = value; } } });
vm.runInContext(fs.readFileSync(require('node:path').join(__dirname, '../elevenlabs-studio.js'), 'utf8'), context);
const studio = window.ElevenLabsStudio, hooks = studio._selfTest;
const flush = async () => { for (let n = 0; n < 20; n++) await Promise.resolve(); };
const stream = () => ({ getTracks: () => [{ stop: () => tracksStopped++ }] });

(async () => {
  const decoded = new Int16Array(hooks.decodePcm(hooks.pcmBase64(new Float32Array([-1, 0, 1]).buffer)));
  assert.deepEqual([...decoded], [-32768, 0, 32767]);
  hooks.state.selected = 'agent-a'; hooks.state.dirty = false;
  const pending = hooks.startPreview();
  studio.stop(); mediaResolve(stream());
  await assert.rejects(pending, error => error.name === 'AbortError');
  assert.equal(tracksStopped, 1); assert.equal(sockets.length, 0);

  const running = hooks.startPreview(); mediaResolve(stream()); await flush();
  assert.equal(sockets.length, 1);
  const socket = sockets[0]; socket.onopen();
  assert.equal(socket.sent[0].custom_llm_extra_body.include_reasoning, false);
  socket.receive({ type: 'conversation_initiation_metadata', conversation_initiation_metadata_event: { user_input_audio_format: 'pcm_16000', agent_output_audio_format: 'pcm_16000' } });
  await running;
  const session = hooks.state.session, audio = Buffer.from([1, 0, 2, 0]).toString('base64');
  socket.receive({ type: 'audio', audio_event: { audio_base_64: audio, event_id: 5 } });
  assert.equal(session.player.messages.filter(message => message.type === 'chunk').length, 1);
  socket.receive({ type: 'interruption', interruption_event: { event_id: 5 } });
  socket.receive({ type: 'audio', audio_event: { audio_base_64: audio, event_id: 5 } });
  assert.equal(session.player.messages.filter(message => message.type === 'chunk').length, 1);
  socket.receive({ type: 'audio', audio_event: { audio_base_64: audio, event_id: 6 } });
  assert.equal(session.player.messages.filter(message => message.type === 'chunk').length, 2);
  socket.receive({ type: 'ping', ping_event: { event_id: 42 } });
  assert.equal(socket.sent.at(-1).type, 'pong');
  session.mic.port.onmessage({ data: { type: 'pcm', audio: new Float32Array([0, 0.5]).buffer } });
  assert.ok(socket.sent.at(-1).user_audio_chunk);
  const tool = { tool_call_id: 'tool-call-a', tool_name: 'unknown_action', parameters: {} };
  hooks.handleTool(session, tool); const sentCount = socket.sent.length; hooks.handleTool(session, tool);
  assert.equal(socket.sent.length, sentCount); assert.equal(socket.sent.at(-1).is_error, true);
  hooks.handleTool(session, { tool_call_id: 'tool-call-b', tool_name: 'open_page', parameters: { page: 'leads' } });
  assert.deepEqual(navigations, ['leads']); assert.equal(hooks.state.session, null);
  assert.equal(tracksStopped, 2); assert.equal(contextsClosed, 2);
  socket.receive({ type: 'user_transcript', user_transcription_event: { user_transcript: 'Stale transcript' } });
  assert.equal(element('el-live-log').children.length, 0);
  studio.stop(); assert.equal(tracksStopped, 2);

  assert.equal(hooks.sourcePayload('text', { name: ' Services ', text: 'Security guards', url: 'https://unused.example' }).text, 'Security guards');
  assert.equal(hooks.sourcePayload('url', { name: ' Website ', text: 'unused draft', url: 'https://example.com/services' }).url, 'https://example.com/services');
  for (const values of [{ name: '', text: 'Facts' }, { name: 'Services', text: ' ' }]) assert.throws(() => hooks.sourcePayload('text', values));
  for (const url of ['example.com', 'http://example.com', 'https://user:password@example.com']) assert.throws(() => hooks.sourcePayload('url', { name: 'Website', url }));
  hooks.chooseSource('doc-a', true); assert.ok(hooks.state.knowledge.has('doc-a'));
  hooks.chooseSource('doc-a', false); assert.equal(hooks.state.knowledge.size, 0);
  assert.ok(hooks.state.dirty); assert.match(element('el-source-selection').textContent, /0 sources/);

  const fields = {};
  for (const name of ['name', 'instructions', 'voice_id']) fields[name] = { value: '', tagName: name === 'voice_id' ? 'SELECT' : 'INPUT', type: 'text', options: [],
    replaceChildren(...options) { this.options = options; }, add(option) { this.options.push(option); } };
  element('el-agent-form').elements = { namedItem: name => fields[name] || null };
  element('el-agent-form').reset = () => { for (const field of Object.values(fields)) field.value = ''; };
  let resolveAgentA;
  const response = data => ({ ok: true, json: async () => data });
  context.fetch = async url => {
    if (url.endsWith('/agents/agent-a')) return new Promise(resolve => { resolveAgentA = resolve; });
    if (url.endsWith('/agents/agent-b')) return response({ config: { name: 'Latest B', instructions: 'Business B instructions', voice_id: 'voice-b' } });
    if (url.endsWith('/agents')) return response({ agents: [] });
    if (url.endsWith('/knowledge')) return response({ documents: [] });
    if (url.endsWith('/tools')) return response({ tools: [] });
    return response({ conversations: [] });
  };
  const olderAgent = hooks.openAgent('agent-a');
  await hooks.openAgent('agent-b');
  resolveAgentA(response({ config: { name: 'Old A', instructions: 'Business A instructions', voice_id: 'voice-a' } }));
  await olderAgent;
  assert.equal(hooks.state.selected, 'agent-b'); assert.equal(fields.name.value, 'Latest B');
  let resolveVoices;
  context.fetch = async () => new Promise(resolve => { resolveVoices = resolve; });
  const loadingVoices = hooks.loadVoices();
  fields.voice_id.value = 'user-choice'; hooks.state.revision++;
  resolveVoices(response({ voices: [{ voice_id: 'voice-a', name: 'A' }] })); await loadingVoices;
  assert.equal(fields.voice_id.value, 'user-choice');

  let cancelledSource = false;
  context.fetch = async (url, options) => new Promise((resolve, reject) => options.signal.addEventListener('abort', () => { cancelledSource = true; reject(new DOMException('Cancelled', 'AbortError')); }, { once: true }));
  const preview = hooks.previewSource({ id: 'doc-a', name: 'Services', type: 'text' });
  hooks.closeSource(); await preview;
  assert.ok(cancelledSource); assert.equal(element('el-source-preview').open, false); assert.equal(element('el-source-preview-text').textContent, '');

  let timeoutCallback, timerCleared = false;
  context.setTimeout = callback => { timeoutCallback = callback; return 1; };
  context.clearTimeout = () => { timerCleared = true; };
  const timeout = hooks.request('/api/v1/elevenlabs/status'); timeoutCallback();
  await assert.rejects(timeout, /took too long/);
  assert.ok(timerCleared); assert.equal(hooks.state.requests.size, 0);
  context.setTimeout = setTimeout; context.clearTimeout = clearTimeout;
  let resolveRecording;
  context.fetch = async () => ({ ok: true, blob: () => new Promise(resolve => { resolveRecording = resolve; }) });
  const recording = hooks.request('/api/v1/elevenlabs/conversations/conv-a/audio', { binary: true }); await flush();
  token = 'new-tenant-token'; resolveRecording({});
  await assert.rejects(recording, error => error.name === 'AbortError');
  hooks.state.batchRequestId = 'old-tenant-request';
  element('el-call-form').elements = { phone_number_id: { replaceChildren() {} } };
  element('el-phone-form').elements = { provider: { value: 'exotel' } };
  hooks.resetAccount();
  assert.equal(hooks.state.batchRequestId, '');
  const authRequests = [];
  context.fetch = async url => { authRequests.push(url); return response({connected:false}); };
  events.get('rudra:auth-state')({detail:{signedIn:true}}); await flush();
  assert.equal(authRequests.length, 1, 'late authenticated session refreshes provider readiness once');
  assert.ok(authRequests[0].endsWith('/status'));
  assert.match(element('el-status').textContent, /Connect your ElevenLabs API key/);
  token = '';
  events.get('rudra:auth-state')({detail:{signedIn:false}}); await flush();
  assert.equal(authRequests.length, 1, 'logout does not refresh provider resources');
  assert.match(element('el-status').textContent, /Sign in/);
  token = 'new-tenant-token';
  hooks.state.batchRequestId = 'uncertain-request';
  context.fetch = async () => response({ batch_id: 'batch-confirmed', uncertain: false });
  const recoveredBatch = await studio.refreshBatchCall('uncertain-request');
  assert.equal(recoveredBatch.batch_id, 'batch-confirmed');
  assert.equal(hooks.state.batchRequestId, '');
  console.log('PASS ElevenLabs PCM/live lifecycle, source validation, tenant reset, two-agent race, late voice list, cancellable preview and bounded request timeout.');
})().catch(error => { console.error(error); process.exitCode = 1; });
