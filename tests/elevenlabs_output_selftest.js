// Bundled Node: node tests/elevenlabs_output_selftest.js. No provider requests.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const root = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const settle = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };

function worklet() {
  let Processor;
  const context = vm.createContext({ Int16Array, sampleRate:24000, AudioWorkletProcessor: class { constructor() { this.port = {}; } },
    registerProcessor: (_name, value) => { Processor = value; } });
  vm.runInContext(read('clavis-pcm-player-worklet.js'), context);
  return new Processor();
}

function jitterBufferRecovery() {
  const player=worklet(); player.port.postMessage=()=>{};
  const send=data=>player.port.onmessage({data});
  const pump=n=>{const out=new Float32Array(n);player.process([],[[out]]);return out;};
  send({type:'begin-stream',playback_id:1});
  send({type:'chunk',audio:new Int16Array(2880).fill(1000).buffer});
  assert.ok(pump(2880).every(v=>v===1000/32768),'120ms starts continuous playback');
  send({type:'chunk',audio:new Int16Array(40).fill(2000).buffer});
  assert.ok(pump(128).every(v=>v===0),'starvation refills instead of playing tiny bursts');
  send({type:'end-stream'});
  assert.ok(pump(40).every(v=>v===2000/32768),'final short tail is retained');
  send({type:'stop'});assert.equal(player.bufferedSamples,0);
}

function voiceHarness({ autoPump = true, deliver = true, fetcher, workletAdd } = {}) {
  const storage = new Map(), requests = [], nodes = [], timers = new Map(), events = new Map();
  let clock = 1000, nextTimer = 0;
  let owner = '';
  const localStorage = { getItem: key => storage.has(key) ? storage.get(key) : null,
    setItem: (key, value) => storage.set(key, String(value)), removeItem: key => storage.delete(key) };
  const window = { addEventListener(name, fn) { events.set(name, [...(events.get(name) || []), fn]); },
    dispatchEvent(event) { for (const fn of events.get(event.type) || []) fn(event); },
    ClavisWorklet: { add: workletAdd || (async () => {}) },
    ClavisWake: { isAwake: () => true }, ClavisVoiceState: { canSpeak: () => true },
    ClavisKeyVault: { ready: async () => {} }, ClavisDirect: { providerConfigured: () => true },
    SupabaseAuth: { getUser: () => owner ? {id: owner} : null, getAccessToken: async () => 'tenant-session' } };
  class Player {
    constructor() {
      this.processor = worklet(); this.messages = []; this.outgoing = [];
      this.port = { postMessage: message => {
        this.messages.push(message);
        this.processor.port.onmessage({ data: message });
        if (autoPump && message.type === 'chunk') this.pump(message.audio.byteLength / 2 + 1);
        if (autoPump && message.type === 'end-stream') this.pump(this.processor.bufferedSamples + 1);
      } };
      this.processor.port.postMessage = message => {
        this.outgoing.push(message);
        if (deliver) queueMicrotask(() => this.port.onmessage?.({ data: message }));
      };
      nodes.push(this);
    }
    pump(samples = 128) {
      const output = new Float32Array(samples);
      this.processor.process([], [[output]]);
      return output;
    }
    connect(value) { return value; }
    deliver(message) { this.port.onmessage?.({ data: message }); }
  }
  class Context {
    constructor() { this.state = 'running'; this.destination = {}; }
    createAnalyser() { return { fftSize: 512, connect: () => this.destination, getFloatTimeDomainData: value => value.fill(0) }; }
    async close() { this.state = 'closed'; }
  }
  const context = vm.createContext({ window, localStorage, document: { getElementById: () => null },
    AudioContext: Context, AudioWorkletNode: Player, AbortController, Uint8Array, Int16Array, Float32Array,
    console, URL, CustomEvent: class { constructor(type, options) { this.type = type; this.detail = options?.detail; } }, Date: { now: () => clock },
    setTimeout: (fn, ms) => { timers.set(++nextTimer, { fn, ms }); return nextTimer; },
    clearTimeout: timer => timers.delete(timer), setInterval: () => 0, clearInterval() {},
    fetch: async (url, options) => { const request = { url, options, body: options.body ? JSON.parse(options.body) : null }; requests.push(request);
      return fetcher ? fetcher(request) : response([new Uint8Array([0, 1])]); } });
  const source = read('clavis-voice.js');
  const marker = '  window.ClavisVoice = {';
  assert.ok(source.includes(marker), 'private hooks attach to the actual voice module');
  vm.runInContext(source.replace(marker, '  window.__voiceTest = { S, ensureAudio, playElevenStream, elevenSettings };\n' + marker), context);
  return { window, context, storage, requests, nodes, timers, hooks: window.__voiceTest,
    advance: value => { clock += value; }, owner: value => { owner = value; },
    emit: (name, detail) => { for (const fn of events.get(name) || []) fn({detail}); } };
}

function response(values, { status = 200, message = 'Provider unavailable' } = {}) {
  let at = 0, cancelled = 0, released = false;
  const reader = { async read() { const item = values[at++]; if (item instanceof Error) throw item;
    return item == null ? { done: true } : { done: false, value: item }; },
  async cancel() { cancelled++; }, releaseLock() { released = true; } };
  return { ok: status === 200, status, headers: { get: name => name === 'content-type' ? 'audio/pcm' : name === 'x-audio-sample-rate' ? '24000' : null }, body: { getReader: () => reader, cancel: () => reader.cancel() },
    json: async () => ({ detail: { message } }), arrayBuffer: async () => new Uint8Array([0, 1]).buffer,
    cancelled: () => cancelled, released: () => released };
}

function controlledResponse() {
  const waiting = [], values = [];
  let cancelled = 0, released = false;
  const reader = { read() { if (values.length) return Promise.resolve(values.shift()); const next = deferred(); waiting.push(next.resolve); return next.promise; },
    async cancel() { cancelled++; while (waiting.length) waiting.shift()({ done: true }); }, releaseLock() { released = true; } };
  const push = item => waiting.length ? waiting.shift()(item) : values.push(item);
  return { ok: true, status: 200, headers: { get: name => name === 'content-type' ? 'audio/pcm' : name === 'x-audio-sample-rate' ? '24000' : null }, body: { getReader: () => reader },
    chunk: value => push({ done: false, value }), end: () => push({ done: true }),
    cancelled: () => cancelled, released: () => released };
}

async function pcmAlignmentAndGap() {
  const h = voiceHarness({ autoPump: false }); await h.hooks.ensureAudio();
  const source = controlledResponse(), signal = new AbortController().signal;
  const progress = { started: false }; h.hooks.S.gen = 7;
  let finished = false;
  const result = h.hooks.playElevenStream(source, 7, signal, progress).then(value => { finished = true; return value; });
  source.chunk(new Uint8Array([1])); await settle();
  assert.equal(progress.started, false, 'one transport byte is not an audible PCM sample');
  assert.equal(h.nodes[0].messages.filter(m => m.type === 'chunk').length, 0);
  source.chunk(new Uint8Array([2, 3, 4, 5])); await settle();
  assert.equal(progress.started, true);
  const first = h.nodes[0].pump(3);
  assert.deepEqual(Array.from(first), [0, 0, 0], 'small packets wait for jitter buffer');
  h.nodes[0].pump(128);
  assert.equal(h.nodes[0].outgoing.filter(m => m.type === 'drained').length, 0, 'network starvation is silence while a stream remains open');
  assert.equal(finished, false);
  source.chunk(new Uint8Array([6, 7, 8])); source.end(); await settle();
  const last = h.nodes[0].pump(5); await settle();
  assert.deepEqual(Array.from(last), [513 / 32768, 1027 / 32768, 1541 / 32768, 2055 / 32768, 0], 'end-stream flushes short audio without dropping samples');
  assert.equal(await result, true); assert.equal(source.released(), true);
  assert.equal(h.nodes[0].outgoing.filter(m => m.type === 'drained').length, 1);
  const playback = h.nodes[0].messages.find(message => message.type === 'begin-stream').playback_id;
  assert.ok(playback != null, 'stream playback has an identity independent of transport chunks');
  assert.ok(h.nodes[0].messages.filter(message => ['chunk', 'end-stream'].includes(message.type))
    .every(message => message.playback_id === playback));
  assert.equal(h.nodes[0].outgoing.at(-1).playback_id, playback, 'the actual worklet echoes the matching playback identity');
}

async function cancellationAndGeneration() {
  const h = voiceHarness({ autoPump: false }); await h.hooks.ensureAudio();
  const source = controlledResponse(), controller = new AbortController(); h.hooks.S.gen = 1;
  const result = h.hooks.playElevenStream(source, 1, controller.signal, { started: false });
  source.chunk(new Uint8Array([1, 2])); await settle();
  const before = h.nodes[0].messages.filter(m => m.type === 'chunk').length;
  h.window.ClavisVoice.stop(); controller.abort(); source.chunk(new Uint8Array([3, 4])); source.end();
  assert.equal(await result, false); assert.ok(source.cancelled() > 0); assert.equal(source.released(), true);
  assert.equal(h.nodes[0].messages.filter(m => m.type === 'chunk').length, before, 'stale transport bytes cannot queue after stop');
  assert.equal(h.nodes[0].processor.queue.length, 0); assert.equal(h.nodes[0].processor.current, null);
  const stale = response([new Uint8Array([9, 10])]);
  assert.equal(await h.hooks.playElevenStream(stale, 1, new AbortController().signal, { started: false }), false);
  assert.ok(stale.cancelled() > 0, 'a late response is closed without touching the next generation');
}

async function fallbackAndExplicitProvider() {
  const failed = request => request.body.engine === 'elevenlabs'
    ? response([], { status: 429, message: 'Credits exhausted' }) : response([new Uint8Array([0, 1])]);
  const automatic = voiceHarness({ fetcher: failed }); await automatic.hooks.ensureAudio();
  assert.equal(await automatic.window.ClavisVoice.speak('A useful reply.', { engine: 'auto' }), true);
  assert.deepEqual(automatic.requests.map(r => r.body.engine), ['elevenlabs', 'cartesia'], 'auto may fall back before any audible output');
  assert.ok(automatic.requests.every(r => r.options.headers.Authorization === 'Bearer tenant-session'));
  const explicit = voiceHarness({ fetcher: failed }); await explicit.hooks.ensureAudio();
  assert.equal(await explicit.window.ClavisVoice.speak('A useful reply.', { engine: 'elevenlabs' }), false);
  assert.deepEqual(explicit.requests.map(r => r.body.engine), ['elevenlabs'], 'explicit ElevenLabs never changes providers');
  const cartesia = voiceHarness(); await cartesia.hooks.ensureAudio();
  assert.equal(await cartesia.window.ClavisVoice.speak('A useful reply.', { engine: 'cartesia' }), true);
  assert.deepEqual(cartesia.requests.map(r => r.body.engine), ['cartesia']);
  const partial = voiceHarness({ fetcher: () => response([new Uint8Array([0, 1]), new Error('Transport closed')]) });
  await partial.hooks.ensureAudio();
  assert.equal(await partial.window.ClavisVoice.speak('First sentence. Second sentence.', { engine: 'auto' }), false);
  assert.equal(partial.requests.length, 1, 'partly audible replies never switch providers or fetch a repeated complete answer');
  assert.equal(partial.nodes[0].processor.queue.length, 0);
}

async function delayedResponseAfterStop() {
  const pending = deferred(), late = response([new Uint8Array([0, 1])]);
  const h = voiceHarness({ fetcher: () => pending.promise }); await h.hooks.ensureAudio();
  const result = h.window.ClavisVoice.speak('An old answer.', { engine: 'elevenlabs' }); await settle();
  h.window.ClavisVoice.stop(); pending.resolve(late);
  assert.equal(await result, false); assert.ok(late.cancelled() > 0);
  assert.equal(h.nodes[0].messages.filter(m => m.type === 'chunk').length, 0);
}

async function longRepliesAndRealFirstAudio() {
  const short = voiceHarness();
  const shortText = 'A CRM keeps your customer records. It tracks follow-ups. You can see the next action.';
  assert.equal(await short.window.ClavisVoice.speak(shortText, { engine: 'elevenlabs' }), true);
  assert.equal(short.requests.length, 1, 'a complete short answer preserves prosody in one synthesis request');
  assert.equal(short.requests[0].body.text, shortText, 'sentence joining preserves the complete short answer');
  const first = deferred(), h = voiceHarness({ fetcher: request => h.requests.length === 1 ? first.promise : response([new Uint8Array([0, 1])]) });
  const text = 'Aapke liye yeh complete report taiyar hai ' + 'longword'.repeat(400) + ' with the final details';
  const result = h.window.ClavisVoice.speak(text, { engine: 'elevenlabs' }); await settle();
  assert.equal(h.window.ClavisVoice.isSpeaking(), true);
  assert.equal(h.window.ClavisVoice.isPlaying(), false, 'synthesis wait is not first audio');
  assert.ok(h.requests[0].body.text.length <= 600, 'a sentence without punctuation stays within the request limit');
  assert.equal(h.requests[0].body.lang, 'hi', 'Normalized Hindi uses Hindi pronunciation');
  first.resolve(response([new Uint8Array([0, 1])]));
  assert.equal(await result, true);
  assert.ok(h.requests.length > 1);
  assert.ok(h.requests.every(request => request.body.text.length <= 600));
  const spoken = h.requests.map(request => request.body.text).join('').replace(/\s/g, '');
  assert.ok(spoken.startsWith('आपकेलिए'), 'Known Roman Hindi is normalized');
  assert.ok(spoken.endsWith(('longword'.repeat(400) + 'withthefinaldetails')), 'Chunk bounds retain every unknown/English word');
  assert.equal(h.window.ClavisVoice.isPlaying(), false, 'playing ends at the complete drain');
  assert.equal(h.window.ClavisVoice.genderize('Main kar sakti hoon, dikhaungi.', 'neutral'), 'Main kar sakti hoon, dikhaungi.', 'Keep original wording does not convert first-person Hindi');
}

async function malformedAudioIsRejectedAndClosed() {
  const pcm = response([new Uint8Array([1])]);
  const h = voiceHarness({ fetcher: () => pcm });
  assert.equal(await h.window.ClavisVoice.speak('Hello.', { engine: 'elevenlabs' }), false);
  assert.match(h.window.ClavisVoice.status().lastError, /incomplete PCM/);
  assert.ok(pcm.cancelled() > 0, 'a malformed stream closes its reader');
  assert.equal(h.window.ClavisVoice.isPlaying(), false);
  const rate = response([new Uint8Array([0, 1])]);
  let closed = false;
  rate.headers.get = name => name === 'content-type' ? 'audio/pcm' : '44100';
  rate.body.cancel = async () => { closed = true; };
  const unsupported = voiceHarness({ fetcher: () => rate });
  assert.equal(await unsupported.window.ClavisVoice.speak('Hello.', { engine: 'elevenlabs' }), false);
  assert.match(unsupported.window.ClavisVoice.status().lastError, /sample rate/);
  assert.equal(closed, true);
}

async function stalledSetupAndAudioSettle() {
  const worklet = deferred(), player = voiceHarness({ workletAdd: () => worklet.promise });
  const playerResult = player.window.ClavisVoice.speak('Hello.', { engine: 'elevenlabs' }); await settle();
  Array.from(player.timers.values()).find(timer => timer.ms === 15000).fn();
  assert.equal(await playerResult, false, 'a stalled player setup cannot leave synthesis active');
  assert.match(player.window.ClavisVoice.status().lastError, /player setup timed out/);
  assert.equal(player.requests.length, 0);
  worklet.resolve(); await settle();
  assert.equal(player.requests.length, 0, 'late audio setup cannot issue a paid request');
  const setup = voiceHarness({ fetcher: () => new Promise(() => {}) });
  const setupResult = setup.window.ClavisVoice.speak('Hello.', { engine: 'elevenlabs' }); await settle();
  assert.equal(setup.window.ClavisVoice.isSpeaking(), true);
  assert.equal(setup.window.ClavisVoice.isPlaying(), false);
  Array.from(setup.timers.values()).find(timer => timer.ms === 30000).fn();
  assert.equal(await setupResult, false);
  assert.equal(setup.requests[0].options.signal.aborted, true, 'setup deadline closes the actual request');
  assert.match(setup.window.ClavisVoice.status().lastError, /did not start in time/);
  assert.equal(setup.window.ClavisVoice.isSpeaking(), false);
  const source = controlledResponse(), audio = voiceHarness({ fetcher: () => source });
  const audioResult = audio.window.ClavisVoice.speak('Hello.', { engine: 'elevenlabs' }); await settle();
  source.chunk(new Uint8Array([0, 1])); await settle();
  Array.from(audio.timers.values()).find(timer => timer.ms === 30000).fn();
  assert.equal(await audioResult, false, 'a silent hanging tail cannot be treated as completed audio');
  assert.match(audio.window.ClavisVoice.status().lastError, /audio stalled/);
  assert.ok(source.cancelled() > 0);
  assert.equal(audio.requests[0].options.signal.aborted, true);
  assert.equal(audio.window.ClavisVoice.isSpeaking(), false);
  const signIn = deferred(), auth = voiceHarness();
  auth.window.SupabaseAuth.getAccessToken = () => signIn.promise;
  const authResult = auth.window.ClavisVoice.speak('Hello.', { engine: 'elevenlabs' }); await settle();
  auth.window.ClavisVoice.stop(); assert.equal(await authResult, false, 'Stop settles even if sign-in never returns');
  signIn.resolve('late-session'); await settle();
  assert.equal(auth.requests.length, 0, 'late auth cannot spend credits after Stop');
}

async function drainWatchdogExcludesNetworkGap() {
  const h = voiceHarness({ autoPump: false }); await h.hooks.ensureAudio(); h.hooks.S.gen = 1;
  const source = controlledResponse();
  const result = h.hooks.playElevenStream(source, 1, new AbortController().signal, { started: false });
  source.chunk(new Uint8Array([0, 1])); await settle(); h.nodes[0].pump(2);
  h.advance(8000); source.chunk(new Uint8Array(480000)); source.end(); await settle();
  const remainingSamples = h.nodes[0].processor.queue.reduce((total, audio) => total + audio.length, 0);
  const watchdog = Array.from(h.timers.values()).at(-1);
  assert.ok(watchdog.ms >= remainingSamples / 24, 'network gaps must not shorten the drain watchdog below queued audio duration');
  h.nodes[0].pump(remainingSamples + 1); await result;
}

async function missingDrainCannotClaimPlaybackSuccess() {
  const h = voiceHarness({ autoPump: false });
  const result = h.window.ClavisVoice.speak('This should finish playing.', { engine: 'elevenlabs' }); await settle();
  assert.equal(h.window.ClavisVoice.isPlaying(), true);
  const watchdog = Array.from(h.timers.values()).at(-1); watchdog.fn();
  assert.equal(await result, false, 'the safety timeout is a playback failure, never a delivered voice');
  assert.match(h.window.ClavisVoice.status().lastError, /playback did not finish/);
  assert.equal(h.nodes[0].processor.queue.length, 0, 'a timed-out tail cannot play over the next answer');
  assert.equal(h.window.ClavisVoice.isPlaying(), false);
}

async function oldDrainCannotFinishNewGeneration() {
  const h = voiceHarness({ autoPump: false, deliver: false }); await h.hooks.ensureAudio(); h.hooks.S.gen = 1;
  const first = h.hooks.playElevenStream(response([new Uint8Array([0, 1])]), 1, new AbortController().signal, { started: false });
  await settle(); h.nodes[0].pump(2);
  const oldDrain = h.nodes[0].outgoing.at(-1); assert.equal(oldDrain.type, 'drained');
  assert.ok(oldDrain.playback_id != null);
  h.window.ClavisVoice.stop(); assert.equal(await first, false);
  const generation = h.hooks.S.gen; let finished = false;
  const second = h.hooks.playElevenStream(response([new Uint8Array([2, 3])]), generation, new AbortController().signal, { started: false })
    .then(value => { finished = true; return value; });
  await settle(); h.nodes[0].deliver(oldDrain); await settle();
  assert.equal(finished, false, 'a posted drain event from the cancelled generation cannot resolve the next stream');
  h.nodes[0].pump(2);
  assert.notEqual(h.nodes[0].outgoing.at(-1).playback_id, oldDrain.playback_id);
  h.nodes[0].deliver(h.nodes[0].outgoing.at(-1)); assert.equal(await second, true);
}

class Element {
  constructor(tagName = 'SELECT', type = '') { this.tagName = tagName; this.type = type; this.options = []; this.listeners = {}; this._value = ''; this.checked = false; this.disabled = false; this.textContent = ''; }
  get value() { return this._value; }
  set value(value) { this._value = this.tagName !== 'SELECT' || this.options.some(option => option.value === String(value)) ? String(value) : ''; }
  append(option) { this.options.push(option); if (this.options.length === 1) this._value = option.value; }
  replaceChildren() { this.options = []; this._value = ''; }
  get selectedOptions() { return this.options.filter(option => option.value === this.value); }
  addEventListener(type, fn) { (this.listeners[type] ||= []).push(fn); }
  dispatchEvent(event) { for (const fn of this.listeners[event.type] || []) fn(event); }
}

function settingsHarness() {
  let owner = 'tenant-a', next = null, count = 1;
  const storage = new Map([['clavis_elevenlabs_setup_version', '1']]), callbacks = {}, elements = {};
  for (const id of ['sm-elevenlabs-voice', 'clavis-elevenlabs-voice', 'sm-elevenlabs-model']) elements[id] = new Element();
  elements['sm-elevenlabs-style'] = new Element('INPUT', 'range');
  elements['sm-elevenlabs-speaker-boost'] = new Element('INPUT', 'checkbox');
  elements['sm-elevenlabs-status'] = new Element('DIV');
  const window = { SupabaseAuth: { getUser: () => ({ id: owner }), getAccessToken: async () => owner + '-session' },
    ClavisKeyVault: { status: () => ({ providers: { elevenlabs: { count } } }) }, ClavisVoice: { resetQuota() {} },
    addEventListener: (type, fn) => { (callbacks[type] ||= []).push(fn); } };
  const context = vm.createContext({ window,
    localStorage: { getItem: key => storage.has(key) ? storage.get(key) : null, setItem: (key, value) => storage.set(key, String(value)) },
    document: { readyState: 'complete', getElementById: id => elements[id] || null, createElement: tag => new Element(tag.toUpperCase()) },
    Event: class { constructor(type) { this.type = type; } }, AbortSignal,
    fetch: async () => ({ ok: true, json: async () => next ? next.promise : metadata(owner) }) });
  vm.runInContext(read('clavis-elevenlabs-settings.js'), context);
  return { window, elements, storage, emit: type => (callbacks[type] || []).forEach(fn => fn()),
    owner: value => { owner = value; }, count: value => { count = value; }, wait: value => { next = value; } };
}

function metadata(owner) {
  return { configured: true, voices: [{ voice_id: owner + '-voice', name: owner + ' private voice', labels: { gender: 'female' } }],
    models: [{ model_id: owner + '-model', name: owner + ' private model', can_do_text_to_speech: true, can_use_style: false, can_use_speaker_boost: false }],
    subscription: { tier: 'free', character_count: 20, character_limit: 100, remaining_characters: 80 } };
}

async function metadataOwnershipAndCapabilities() {
  const h = settingsHarness(); await h.window.ClavisElevenVoiceSettings.refresh();
  assert.match(h.elements['sm-elevenlabs-status'].textContent, /80 credits remaining/);
  h.elements['sm-elevenlabs-voice'].value = 'tenant-a-voice'; h.elements['sm-elevenlabs-voice'].dispatchEvent({ type: 'change' });
  assert.equal(h.elements['clavis-elevenlabs-voice'].value, 'tenant-a-voice', 'both voice dropdowns stay synchronized');
  h.elements['sm-elevenlabs-model'].value = 'tenant-a-model'; h.elements['sm-elevenlabs-model'].dispatchEvent({ type: 'change' });
  const saved = JSON.parse(h.storage.get('rudra_voice_preferences:tenant-a'));
  assert.equal(saved.clavis_elevenlabs_voice, 'tenant-a-voice', 'Selection persists immediately, before reload or account switching');
  assert.equal(saved.clavis_elevenlabs_voice_manual, 'true');
  assert.equal(saved.clavis_elevenlabs_model, 'tenant-a-model');
  assert.equal(h.elements['sm-elevenlabs-style'].disabled, true); assert.equal(h.elements['sm-elevenlabs-speaker-boost'].disabled, true);
  const voice = voiceHarness(); voice.window.ClavisElevenVoiceSettings = h.window.ClavisElevenVoiceSettings;
  voice.storage.set('clavis_elevenlabs_model', 'tenant-a-model');
  const settings = voice.hooks.elevenSettings();
  assert.equal(Object.hasOwn(settings, 'style'), false); assert.equal(Object.hasOwn(settings, 'use_speaker_boost'), false);
  const old = deferred(); h.wait(old); const pending = h.window.ClavisElevenVoiceSettings.refresh(); await settle();
  h.owner('tenant-b'); h.emit('rudra:auth-state'); old.resolve(metadata('tenant-a')); await pending;
  assert.equal(h.window.ClavisElevenVoiceSettings.voices().length, 0, 'late account metadata cannot reenter the cache');
  for (const id of ['sm-elevenlabs-voice', 'clavis-elevenlabs-voice', 'sm-elevenlabs-model'])
    assert.ok(h.elements[id].options.every(option => !option.textContent.includes('tenant-a private')), 'prior-account voice/model labels must leave visible dropdowns');
  h.wait(null); await h.window.ClavisElevenVoiceSettings.refresh(); h.count(0); h.emit('clavis:vault-changed');
  for (const id of ['sm-elevenlabs-voice', 'clavis-elevenlabs-voice', 'sm-elevenlabs-model'])
    assert.ok(h.elements[id].options.every(option => !option.textContent.includes('tenant-b private')), 'key removal clears provider-derived dropdowns');
}

async function retiredModelAndScopeErrorsAreVisible() {
  const h = settingsHarness(); h.storage.set('clavis_elevenlabs_model', 'retired-model');
  const data = metadata('tenant-a');
  data.errors = { voices: { code: 'ELEVENLABS_PERMISSION', message: 'Allow voice list permission.' } };
  const ready = deferred(); ready.resolve(data); h.wait(ready);
  await h.window.ClavisElevenVoiceSettings.refresh();
  assert.equal(h.storage.get('clavis_elevenlabs_model'), 'tenant-a-model', 'a removed model recovers to an available account model');
  assert.match(h.elements['sm-elevenlabs-status'].textContent, /Switched to/);
  assert.match(h.elements['sm-elevenlabs-status'].textContent, /Allow voice list permission/);
}

async function shortClipsSaveRequestsWithoutCrossingBoundaries() {
  const h = voiceHarness(); h.owner('tenant-a');
  let blocked = false, billed = 0;
  h.window.ClavisVoiceBudget = { allowTTS: () => !blocked, reason: () => 'Local cap reached.', noteTTS: count => { billed += count; } };
  const speak = text => h.window.ClavisVoice.speak(text, { engine: 'elevenlabs' });
  const phrase = 'Yes, I can hear you clearly.';
  assert.equal(await speak(phrase), true);
  assert.equal(await speak(phrase), true);
  assert.equal(h.requests.length, 1, 'same short exact clip reuses completed PCM without another synthesis');
  assert.equal(billed, phrase.length, 'local meter counts only generated text, not replayed PCM');
  blocked = true;
  assert.equal(await speak(phrase), true, 'cached playback does not spend provider credits even at local cap');
  assert.equal(await speak('An uncached reply.'), false);
  assert.equal(h.requests.length, 1);
  blocked = false;
  h.storage.set('skylark-speech-speed', '1.1'); assert.equal(await speak(phrase), true);
  assert.equal(h.requests.length, 2, 'changed acoustic settings regenerate the clip');
  h.storage.set('clavis_elevenlabs_voice', 'another-voice'); assert.equal(await speak(phrase), true);
  assert.equal(h.requests.length, 3, 'voice selection is part of the cache identity');
  h.storage.set('clavis_elevenlabs_model', 'eleven_multilingual_v2'); assert.equal(await speak(phrase), true);
  assert.equal(h.requests.length, 4, 'model selection is part of the cache identity');
  h.owner('tenant-b'); assert.equal(await speak(phrase), true);
  assert.equal(h.requests.length, 5, 'another account never hears cached audio from prior account');
  h.owner('tenant-a'); assert.equal(await speak(phrase), true);
  assert.equal(h.requests.length, 6, 'account change cleared prior clips');
  h.emit('clavis:vault-changed'); assert.equal(await speak(phrase), true);
  assert.equal(h.requests.length, 7, 'reconnecting credentials invalidates clip reuse');
  h.advance(5 * 60 * 1000); assert.equal(await speak(phrase), true);
  assert.equal(h.requests.length, 8, 'short session cache expires');
  h.owner(''); assert.equal(await speak(phrase), true); assert.equal(await speak(phrase), true);
  assert.equal(h.requests.length, 10, 'unknown account identity disables audio reuse');
}

async function incompleteClipsCannotSaveOrReplayPaidAudio() {
  const source = controlledResponse(); let calls = 0;
  const h = voiceHarness({ fetcher: () => ++calls === 1 ? source : response([new Uint8Array([1, 2])]) }); h.owner('tenant-a');
  const phrase = 'This answer was interrupted.';
  const first = h.window.ClavisVoice.speak(phrase, { engine: 'elevenlabs' }); await settle();
  source.chunk(new Uint8Array([1, 2])); await settle(); h.window.ClavisVoice.stop();
  assert.equal(await first, false);
  assert.equal(await h.window.ClavisVoice.speak(phrase, { engine: 'elevenlabs' }), true);
  assert.equal(h.requests.length, 2, 'partial canceled PCM cannot be treated as a complete cached answer');
  assert.equal(await h.window.ClavisVoice.speak(phrase, { engine: 'elevenlabs' }), true);
  assert.equal(h.requests.length, 2);
  const signIn = deferred(), auth = voiceHarness(); auth.owner('tenant-a');
  auth.window.SupabaseAuth.getAccessToken = () => signIn.promise;
  const pending = auth.window.ClavisVoice.speak(phrase, {engine:'elevenlabs'}); await settle();
  auth.owner('tenant-b'); signIn.resolve('new-account-session');
  assert.equal(await pending, false);
  assert.equal(auth.requests.length, 0, 'late token cannot charge synthesis to a changed account');
}

async function shortClipCacheRemainsBounded() {
  const h = voiceHarness(); h.owner('tenant-a');
  for (let i = 0; i < 9; i++) await h.window.ClavisVoice.speak('Acknowledgement number ' + i + '.', {engine:'elevenlabs'});
  await h.window.ClavisVoice.speak('Acknowledgement number 0.', {engine:'elevenlabs'});
  assert.equal(h.requests.length, 10, 'oldest short clip is evicted after eight entries');
  const long = 'A'.repeat(301);
  await h.window.ClavisVoice.speak(long, {engine:'elevenlabs'}); await h.window.ClavisVoice.speak(long, {engine:'elevenlabs'});
  assert.equal(h.requests.length, 12, 'long/personal answers are not cached');
  const repeated = voiceHarness(); repeated.owner('tenant-a');
  assert.equal(await repeated.window.ClavisVoice.speak('Done. Done.', {engine:'elevenlabs'}), true);
  assert.equal(repeated.requests.length, 1, 'the complete short utterance uses one synthesis');
  assert.equal(repeated.requests[0].body.text, 'Done. Done.', 'requested repetitions remain in the complete synthesized utterance');
  assert.equal(repeated.nodes[0].messages.filter(message => message.type === 'end-stream').length, 1, 'the complete repeated phrase drains once');
}

async function onlyEffectiveProviderSettingsMissClipCache() {
  const h = voiceHarness(); h.owner('tenant-a');
  const phrase = 'The report is ready.';
  assert.equal(await h.window.ClavisVoice.speak(phrase, {engine:'elevenlabs',style:'calm'}), true);
  assert.equal(await h.window.ClavisVoice.speak(phrase, {engine:'elevenlabs',style:'composed'}), true);
  assert.equal(h.requests.length, 1, 'internal mood is not an ElevenLabs request field');
  assert.equal(h.requests[0].body.model_id, 'eleven_flash_v2_5');
  assert.equal(h.requests[0].body.style, 0);
  h.window.ClavisElevenVoiceSettings = { model: () => ({can_use_style:false,can_use_speaker_boost:false}) };
  assert.equal(await h.window.ClavisVoice.speak(phrase, {engine:'elevenlabs',style:'neutral'}), true);
  assert.equal(h.requests.length, 1, 'late metadata reindexes existing audio by effective supported controls');
  h.storage.set('clavis_elevenlabs_style', '.9'); h.storage.set('clavis_elevenlabs_speaker_boost', 'true');
  assert.equal(await h.window.ClavisVoice.speak(phrase, {engine:'elevenlabs'}), true);
  assert.equal(h.requests.length, 1, 'unsupported provider controls do not change the audio identity');
  h.storage.set('clavis_elevenlabs_stability', '.7');
  assert.equal(await h.window.ClavisVoice.speak(phrase, {engine:'elevenlabs'}), true);
  assert.equal(h.requests.length, 2, 'an effective supported setting still regenerates audio');
  h.window.ClavisElevenVoiceSettings.model = () => ({can_use_style:true,can_use_speaker_boost:false});
  assert.equal(await h.window.ClavisVoice.speak(phrase, {engine:'elevenlabs'}), true);
  assert.equal(h.requests.length, 3, 'provider-supported style is an effective setting');
  h.storage.set('clavis_elevenlabs_style', '.8');
  assert.equal(await h.window.ClavisVoice.speak(phrase, {engine:'elevenlabs'}), true);
  assert.equal(h.requests.length, 4, 'real provider style changes regenerate audio');

  const v4 = voiceHarness(); v4.owner('tenant-a'); v4.storage.set('clavis_elevenlabs_model', 'eleven_v4');
  assert.equal(await v4.window.ClavisVoice.speak(phrase, {engine:'elevenlabs'}), true);
  v4.storage.set('skylark-speech-speed', '1.2'); v4.storage.set('clavis_elevenlabs_style', '.8');
  assert.equal(await v4.window.ClavisVoice.speak(phrase, {engine:'elevenlabs'}), true);
  assert.equal(v4.requests.length, 1, 'backend-discarded v4 pacing/style fields cannot miss the cache');
  v4.storage.set('clavis_elevenlabs_similarity', '.9');
  assert.equal(await v4.window.ClavisVoice.speak(phrase, {engine:'elevenlabs'}), true);
  assert.equal(v4.requests.length, 2, 'v4 supported similarity changes still regenerate');

  const v3 = voiceHarness(); v3.owner('tenant-a'); v3.storage.set('clavis_elevenlabs_model', 'eleven_v3');
  v3.storage.set('clavis_elevenlabs_stability', '.4');
  assert.equal(await v3.window.ClavisVoice.speak(phrase, {engine:'elevenlabs'}), true);
  v3.storage.set('clavis_elevenlabs_stability', '.6'); v3.storage.set('clavis_elevenlabs_similarity', '.9');
  assert.equal(await v3.window.ClavisVoice.speak(phrase, {engine:'elevenlabs'}), true);
  assert.equal(v3.requests.length, 1, 'v3 quantizes both requests to the same supported stability mode');
  v3.storage.set('clavis_elevenlabs_stability', '1');
  assert.equal(await v3.window.ClavisVoice.speak(phrase, {engine:'elevenlabs'}), true);
  assert.equal(v3.requests.length, 2, 'a distinct v3 stability mode regenerates audio');
}

async function ordinaryVaultRefreshKeepsClipsButMutationInvalidates() {
  let connected = true, failSave = false;
  const h = voiceHarness({ fetcher: request => {
    if (!request.url.includes('/api/credentials')) return response([new Uint8Array([0, 1])]);
    if (request.options.method === 'PUT' && failSave) return { ok:false, json:async () => ({detail:'Save failed'}) };
    if (request.options.method === 'DELETE') connected = false;
    if (request.options.method === 'PUT') connected = true;
    return { ok:true, json:async () => ({credentials:connected ? [{provider:'elevenlabs',configured:true}] : []}) };
  } });
  h.owner('tenant-a'); h.window.SKYLARK_CONFIG = {BACKEND_URL:'http://localhost:8000'};
  delete h.window.ClavisKeyVault;
  vm.runInContext(read('clavis-keyvault.js'), h.context);
  h.window.ClavisDirect.providerConfigured = provider => !!h.window.ClavisKeyVault.status().providers[provider]?.count;
  const phrase = 'Your connection is working.';
  const paid = () => h.requests.filter(request => request.body?.engine === 'elevenlabs').length;
  assert.equal(await h.window.ClavisVoice.speak(phrase, {engine:'elevenlabs'}), true);
  assert.equal(await h.window.ClavisVoice.speak(phrase, {engine:'elevenlabs'}), true);
  assert.equal(paid(), 1, 'actual KeyVault.ready inventory refresh before each turn cannot erase completed audio');
  await h.window.ClavisKeyVault.refresh();
  assert.equal(await h.window.ClavisVoice.speak(phrase, {engine:'elevenlabs'}), true);
  assert.equal(paid(), 1);
  const fake = 'test_fixture_not_a_real_provider_key';
  await h.window.ClavisKeyVault.add('elevenlabs', fake);
  assert.equal(await h.window.ClavisVoice.speak(phrase, {engine:'elevenlabs'}), true);
  assert.equal(paid(), 2, 'successful same-provider key rotation invalidates old audio');
  failSave = true; await assert.rejects(h.window.ClavisKeyVault.add('elevenlabs', fake)); failSave = false;
  assert.equal(await h.window.ClavisVoice.speak(phrase, {engine:'elevenlabs'}), true);
  assert.equal(paid(), 2, 'failed replacement preserves unchanged working credentials and audio');
  await h.window.ClavisKeyVault.remove('elevenlabs');
  await h.window.ClavisKeyVault.add('elevenlabs', fake);
  assert.equal(await h.window.ClavisVoice.speak(phrase, {engine:'elevenlabs'}), true);
  assert.equal(paid(), 3, 'removal/reconnect cannot replay prior credential audio');
  h.owner('tenant-b'); h.emit('rudra:auth-state'); await settle();
  assert.equal(await h.window.ClavisVoice.speak(phrase, {engine:'elevenlabs'}), true);
  assert.equal(paid(), 4, 'account changes remain isolated across refreshed inventory');
}

async function lateCapabilityAliasesKeepBoundedByteAccounting() {
  const h = voiceHarness({fetcher:() => response([new Uint8Array(512 * 1024)])}); h.owner('tenant-a');
  const phrase = 'A short preview.';
  const speak = text => h.window.ClavisVoice.speak(text, {engine:'elevenlabs'});
  assert.equal(await speak(phrase), true);
  h.storage.set('clavis_elevenlabs_style', '.9'); assert.equal(await speak(phrase), true);
  assert.equal(h.requests.length, 2, 'unknown capabilities keep distinct requested styles separate');
  h.window.ClavisElevenVoiceSettings = {model:() => ({can_use_style:false,can_use_speaker_boost:false})};
  assert.equal(await speak(phrase), true); assert.equal(await speak(phrase), true);
  for (const text of ['Second preview.', 'Third preview.', 'Fourth preview.']) assert.equal(await speak(text), true);
  assert.equal(h.requests.length, 5);
  assert.equal(await speak(phrase), true);
  assert.equal(h.requests.length, 5, 'collapsed aliases cannot leave phantom bytes that evict audio while four 512KB clips fit the 2MB bound');
}

async function hindiSpeechUsesNativeScriptAndResolvedAccountVoice() {
  const h = voiceHarness(); h.owner('tenant-a');
  h.window.ClavisElevenVoiceSettings = {
    resolveVoice: () => ({ voice_id: 'native-hindi-account-voice', labels: { gender: 'male' } }),
    model: () => null,
  };
  assert.equal(await h.window.ClavisVoice.speak('Namaste sir. Main aapki leads dekh raha hoon.', {engine:'elevenlabs'}), true);
  const body = h.requests[0].body;
  assert.equal(body.voice_id, 'native-hindi-account-voice');
  assert.equal(body.lang, 'hi');
  assert.match(body.text, /मैं/); assert.match(body.text, /हूँ/);
  assert.ok(h.requests.every(request => request.url.endsWith('/api/tts')), 'No third-party transliteration request');
  assert.equal(await h.window.ClavisVoice.speak('Your saved leads are ready.', {engine:'elevenlabs'}), true);
  assert.equal(h.requests.at(-1).body.text, 'Your saved leads are ready.');
  assert.equal(h.requests.at(-1).body.lang, 'en');
  h.storage.set('clavis_elevenlabs_gender', 'neutral');
  assert.equal(await h.window.ClavisVoice.speak('मैं कर सकती हूँ।', {engine:'elevenlabs'}), true);
  assert.equal(h.requests.at(-1).body.text, 'मैं कर सकती हूँ।', 'Keep-original preference wins over inferred voice gender');
}

async function automaticVoicePrefersHindiWithoutReplacingManualSelection() {
  const h = settingsHarness();
  const data = metadata('tenant-a');
  data.voices.push({voice_id:'hindi-native',name:'Native Hindi',labels:{language:'hi',gender:'male'}});
  data.voices.unshift({voice_id:'english-multilingual',name:'English voice',labels:{language:'en',accent:'american'},verified_languages:[{language:'hi'}]});
  const ready = deferred(); ready.resolve(data); h.wait(ready);
  await h.window.ClavisElevenVoiceSettings.refresh();
  assert.equal(h.window.ClavisElevenVoiceSettings.resolveVoice().voice_id, 'hindi-native');
  data.voices = data.voices.filter(voice => voice.voice_id !== 'hindi-native');
  data.voices.push({voice_id:'indian-accent',name:'Indian voice',labels:{language:'en',accent:'en-indian',gender:'male'}});
  await h.window.ClavisElevenVoiceSettings.refresh();
  assert.equal(h.window.ClavisElevenVoiceSettings.resolveVoice().voice_id, 'indian-accent', 'Native/Indian accent outranks multilingual support alone');
  h.storage.set('clavis_elevenlabs_voice', 'explicit-custom-voice');
  assert.equal(h.window.ClavisElevenVoiceSettings.resolveVoice().voice_id, 'explicit-custom-voice');
  h.owner('tenant-b'); h.emit('rudra:auth-state');
  assert.notEqual(h.window.ClavisElevenVoiceSettings.resolveVoice().voice_id, 'hindi-native', 'Account switches clear native voice metadata');
}

(async () => {
  jitterBufferRecovery();
  const failures = [];
  for (const check of [pcmAlignmentAndGap, cancellationAndGeneration, fallbackAndExplicitProvider, delayedResponseAfterStop,
                      longRepliesAndRealFirstAudio, malformedAudioIsRejectedAndClosed, stalledSetupAndAudioSettle, drainWatchdogExcludesNetworkGap,
                      missingDrainCannotClaimPlaybackSuccess, oldDrainCannotFinishNewGeneration, metadataOwnershipAndCapabilities, retiredModelAndScopeErrorsAreVisible,
                      shortClipsSaveRequestsWithoutCrossingBoundaries, incompleteClipsCannotSaveOrReplayPaidAudio, shortClipCacheRemainsBounded,
                      onlyEffectiveProviderSettingsMissClipCache, ordinaryVaultRefreshKeepsClipsButMutationInvalidates,
                      lateCapabilityAliasesKeepBoundedByteAccounting, hindiSpeechUsesNativeScriptAndResolvedAccountVoice,
                      automaticVoicePrefersHindiWithoutReplacingManualSelection]) {
    try { await check(); console.log(check.name + ': PASS'); }
    catch (error) { failures.push(check.name); console.error(check.name + ': FAIL — ' + error.message); }
  }
  if (failures.length) throw new Error('ElevenLabs output regressions: ' + failures.join(', '));
  console.log('ElevenLabs PCM output, account settings, Hindi routing and short clip efficiency: 20/20 PASS');
})().catch(error => { console.error(error.message); process.exitCode = 1; });
