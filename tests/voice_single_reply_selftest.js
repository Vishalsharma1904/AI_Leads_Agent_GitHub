const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require('node:path').join(__dirname, '..', 'jarvis_ui.js'), 'utf8');
const speak = source.slice(source.indexOf('async function speakJarvisText('), source.indexOf('\nfunction testJarvisVoice(', source.indexOf('async function speakJarvisText(')));

async function check(result, expected) {
  const calls = [];
  let requestId = 0;
  const context = {
    window: {
      ClavisDirect: { keyFor: () => 'unused', ttsWithFish: async () => { throw Error('retired Fish path must never run'); } },
      ClavisVoice: { speak: async (text, opts) => { calls.push([text, opts.engine]); return result; } },
      LocalSpeechEngine: { speak: async () => { throw Error('partial output must never replay'); } },
      ClavisMind: {}, ClavisEar: {}, ClavisBargeIn: {},
    },
    localStorage: { getItem: () => null },
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
  assert.equal(await context.run('First sentence. Second sentence.', {engine:'elevenlabs'}), result === true);
  assert.deepEqual(calls, expected);
}

(async () => {
  await check(true, [['First sentence. Second sentence.', 'elevenlabs']]);
  await check(false, [['First sentence. Second sentence.', 'elevenlabs']]);
  await check({remaining:'Second sentence.'}, [['First sentence. Second sentence.', 'elevenlabs']]);
  console.log('Single voice handoff: PASS');
})().catch(error => { console.error(error); process.exitCode = 1; });
