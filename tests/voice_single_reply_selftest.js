const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require('node:path').join(__dirname, '..', 'jarvis_ui.js'), 'utf8');
const speak = source.slice(source.indexOf('async function speakJarvisText('), source.indexOf('\nfunction testJarvisVoice(', source.indexOf('async function speakJarvisText(')));

async function check(provider, googleResult, fishFails, expected) {
  const calls = [];
  let requestId = 0;
  const storage = { clavis_tts_provider: provider, clavis_fish_voice_id: 'voice' };
  const context = {
    window: {
      ClavisDirect: { keyFor: key => key === 'fish_audio' ? 'key' : '', ttsWithFish: async text => { calls.push(['fish', text]); if (fishFails) throw Error('quota'); return 'blob:fish'; } },
      ClavisVoice: { speak: async (text, opts) => { calls.push(['google', text]); return opts.cloudOnly ? googleResult : true; } },
      ClavisMind: {}, ClavisEar: {}, ClavisBargeIn: {},
    },
    localStorage: { getItem: key => storage[key] || null },
    document: { getElementById: () => null },
    Audio: class { play() { queueMicrotask(() => this.onended()); return Promise.resolve(); } pause() {} },
    URL: { revokeObjectURL() {} }, AbortController, DOMException, console,
    clavisSpeakable: text => text, clavisJustSaid: () => false, clavisIsAwake: () => false, clavisHoldSpeech() {}, clavisReleaseSpeech() {},
    clavisWatchFirstAudio() {}, clavisGroqReady: () => false, setJarvisStatus() {}, stopJarvisSpeech() { requestId++; },
    get jarvisSpeechRequestId() { return requestId; }, set jarvisSpeechRequestId(value) { requestId = value; },
    CLAVIS_ASLEEP_LABEL: '', jarvisHandsFree: false, scheduleHandsFreeRelisten() {},
  };
  vm.createContext(context);
  vm.runInContext(`${speak}\nthis.run = speakJarvisText;`, context);
  assert.equal(await context.run('First sentence. Second sentence.'), true);
  assert.deepEqual(calls, expected);
}

(async () => {
  await check('gemini', { remaining: 'Second sentence.' }, false, [['google', 'First sentence. Second sentence.'], ['fish', 'Second sentence.']]);
  await check('fish', false, true, [['fish', 'First sentence. Second sentence.'], ['google', 'First sentence. Second sentence.']]);
  console.log('Single voice handoff: PASS');
})().catch(error => { console.error(error); process.exitCode = 1; });
