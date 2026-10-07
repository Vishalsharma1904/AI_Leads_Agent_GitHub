const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const values = new Map([['clavis_provider_keys', JSON.stringify({ fish_audio: 'fish-test-key-12345', gemini: 'gemini-test-key-12345' })], ['clavis_fish_voice_id', 'voice-id']]);
const requests = [];
const context = {
  window: {}, location: { protocol: 'http:', origin: 'http://localhost:3000' },
  AbortController, setTimeout, clearTimeout,
  localStorage: { getItem: k => values.get(k) || null, setItem: (k, v) => values.set(k, v) },
  Blob, FormData, Uint8Array, btoa, URL: { createObjectURL: () => 'blob:test' },
  fetch: async (url, options) => {
    requests.push({ url, options });
    if (url.endsWith('/v1/asr')) return { ok: true, json: async () => ({ text: 'hello sir' }) };
    if (url.includes(':generateContent')) return { ok: true, json: async () => ({ candidates: [{ content: { parts: [{ text: 'नमस्ते' }] } }] }) };
    if (url.endsWith('/v1/tts')) return { ok: true, blob: async () => new Blob(['audio']) };
    throw new Error(`Unexpected request: ${url}`);
  },
};
vm.createContext(context);
vm.runInContext(fs.readFileSync(require('node:path').join(__dirname, '..', 'clavis-direct.js'), 'utf8'), context);

(async () => {
  const direct = context.window.ClavisDirect;
  const audio = new Blob(['audio'], { type: 'audio/webm;codecs=opus' });
  assert.equal(await direct.transcribeWithFish(audio), 'hello sir');
  assert.equal(requests[0].options.headers.model, 'transcribe-1');
  assert.equal(await direct.transcribeWithGemini(audio), 'नमस्ते');
  assert.equal(requests[1].options.headers['x-goog-api-key'], 'gemini-test-key-12345');
  assert.equal(JSON.parse(requests[1].options.body).contents[0].parts[1].inline_data.mime_type, 'audio/webm');
  assert.equal(await direct.ttsWithFish('Hello'), 'blob:test');
  assert.equal(JSON.parse(requests[2].options.body).reference_id, 'voice-id');
  assert.equal(requests.length, 3);
  let source;
  class FakeSource extends EventTarget {
    static isTypeSupported = type => type === 'audio/mpeg';
    constructor() { super(); this.readyState = 'open'; source = this; this.chunks = []; }
    addSourceBuffer() {
      const parent = this;
      return new class extends EventTarget {
        appendBuffer(chunk) { parent.chunks.push(chunk); queueMicrotask(() => this.dispatchEvent(new Event('updateend'))); }
      }();
    }
    endOfStream() { this.readyState = 'ended'; }
  }
  context.MediaSource = FakeSource;
  context.URL.createObjectURL = () => 'blob:stream';
  context.fetch = async () => ({ ok: true, body: { getReader: () => {
    let sent = false;
    return { read: async () => sent ? { done: true } : (sent = true, { done: false, value: new Uint8Array([1, 2, 3]) }) };
  } } });
  assert.equal(await direct.ttsWithFish('Stream'), 'blob:stream');
  source.dispatchEvent(new Event('sourceopen'));
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(source.chunks.length, 1);
  assert.equal(source.readyState, 'ended');
  console.log('Fish ASR, Google ASR fallback, Fish TTS streaming: PASS');
})().catch(error => { console.error(error); process.exitCode = 1; });
