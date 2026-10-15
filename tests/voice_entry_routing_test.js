// tests/voice_entry_routing_test.js — every voice entry point (mic button,
// wake word with a command, clap, hands-free relisten) reaches the
// ElevenLabs live session; only the sleeping wake listener stays local.
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const src = fs.readFileSync(path.join(__dirname, '..', 'jarvis_ui.js'), 'utf8');
const start = src.indexOf('function startJarvisVoiceInput(');
const end = src.indexOf('// ── The command ear', start);
assert.ok(start > 0 && end > start, 'startJarvisVoiceInput found');

function run(options, { available = true, active = false, awake = false } = {}) {
  const log = { start: [], stop: 0, legacy: 0, micOn: 0 };
  const ctx = vm.createContext({
    window: { ClavisLive: { isAvailable: () => available, isActive: () => active, start: (o) => log.start.push(o), stop: () => log.stop++ },
      ClavisElevenSTT: { isActive: () => false }, ClavisEar: {}, SpeechRecognition: function () {} },
    document: { getElementById: () => null, querySelectorAll: () => [] },
    CLAVIS_VS: { isClavisWorkspace: () => true, setMicEnabled: (on) => { if (on) log.micOn++; } },
    clavisIsAwake: () => awake, setJarvisStatus() {}, isGroqRecording: false, groqCapture: {}, clavisEar: {},
    clavisEarAlive: () => false, clavisWakeUp() {}, clavisPrewarm() {}, clavisElevenReady: () => false,
    clavisRealtimeInput: {}, clavisUseGroq: () => false, clavisClearAIBackoff() {}, clavisScribeRetry: {},
    legacyStartNativeSpeechRecognition: () => log.legacy++, startClavisElevenInput: () => log.legacy++,
    stopCommandEar() {}, stopWakeListener() {}, stopClavisSoundTriggers() {}, clavisEarConsumeAll() {}, clearTimeout, setTimeout, Boolean, String,
  });
  vm.runInContext(src.slice(start, end) + '\nstartJarvisVoiceInput(' + JSON.stringify(options) + ');', ctx);
  return log;
}

let r = run({});
assert.strictEqual(JSON.stringify(r.start), JSON.stringify([{ trigger: 'button', initialText: '' }]), 'mic button opens live voice');
assert.strictEqual(r.micOn, 1);
r = run({}, { active: true });
assert.strictEqual(r.stop, 1, 'mic button while live = turn off');
assert.strictEqual(r.start.length, 0);
r = run({ initialText: 'leads nikalo', handsFreeCapture: true, awakeCapture: true });
assert.strictEqual(JSON.stringify(r.start), JSON.stringify([{ trigger: 'wake word', initialText: 'leads nikalo' }]), 'wake word command reaches the agent');
r = run({ soundTrigger: true });
assert.strictEqual(r.start[0].trigger, 'clap');
r = run({ handsFreeCapture: true }, { awake: false });
assert.strictEqual(r.start.length, 0, 'sleeping wake listener stays local');
assert.strictEqual(r.legacy, 1);
r = run({ handsFreeCapture: true }, { awake: true });
assert.strictEqual(r.start.length, 1, 'awake hands-free relisten keeps the live session');
r = run({}, { available: false });
assert.strictEqual(r.start.length, 0, 'fallback when live voice is unavailable');
assert.strictEqual(r.legacy, 1);
console.log('voice entry routing: 7 checks passed');
