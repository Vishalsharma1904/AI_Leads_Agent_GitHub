/** Offline regression checks for Clavis's strict local speech contract. */
'use strict';

const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const store = new Map();
const localStorageStub = {
  getItem: key => (store.has(key) ? store.get(key) : null),
  setItem: (key, value) => store.set(key, String(value)),
  removeItem: key => store.delete(key),
};
const windowStub = {};
const read = name => fs.readFileSync(path.join(ROOT, name), 'utf8');
new Function('window', 'localStorage', read('clavis-emotional-engine.js'))(windowStub, localStorageStub);
const engine = windowStub.ClavisEmotionalEngine;
let failures = 0;
function check(name, condition, detail = '') {
  if (condition) console.log('  PASS  ' + name);
  else { console.log('  FAIL  ' + name + (detail ? ' -> ' + detail : '')); failures++; }
}

console.log('\nClavis local Kokoro voice verification\n');
check('emotional engine exposes its public contract',
  ['languageOf', 'inferUserEmotion', 'speechProsody', 'rememberAssistant', 'pickDifferent', 'decorateSpeech']
    .every(name => typeof engine[name] === 'function'));
check('detects Devanagari Hindi', engine.languageOf('मुझे यह समझ नहीं आ रहा') === 'hi');
check('detects Latin Hinglish', engine.languageOf('Mujhe ye samajh nahi aa raha sir') === 'hinglish');
check('detects frustration', engine.inferUserEmotion('This is broken and I am frustrated').name === 'frustrated');
check('maps reassurance to softer prosody', engine.speechProsody('Chinta mat kijiye, I understand').tag === '<soft>');
engine.reset();
engine.rememberAssistant('Haan sir, main dekh raha hoon.');
const repeated = engine.rememberAssistant('Haan sir, main dekh raha hoon.');
check('remembers recent openers and replies', engine.recent().openers.length === 2 && engine.recent().replies.length === 2);
check('flags exact conversational repetition', repeated.repeated === true && engine.recent().repetitionRate > 0);
check('selects non-repeat fallback', engine.pickDifferent(['same', 'different'], 'test') !== engine.pickDifferent(['same', 'different'], 'test'));

const ui = read('jarvis_ui.js');
const localSpeech = read('clavis-local-speech.js');
const scheduler = read('backend/services/speech/scheduler.py');
const brain = read('jarvis.js');
const direct = read('clavis-direct.js');
const html = read('index.html');
const settings = html.slice(html.indexOf('id="smsc-voice-settings"'), html.indexOf('id="smsc-notifications"'));
const activeSpeak = ui.slice(ui.lastIndexOf('async function speakJarvisText'));
check('loads local speech and AudioWorklets', html.includes('clavis-local-speech.js') && localSpeech.includes('audioWorklet.addModule') && localSpeech.includes('WS_INPUT_PATH'));
check('uses local Kokoro for voice input', ui.includes('window.startLocalJarvisVoiceInput') && ui.includes('LocalSpeechEngine'));
check('active renderer has no browser/cloud fallback', !activeSpeak.includes('speechSynthesis') && !activeSpeak.includes('synthesizeWithXai') && !activeSpeak.includes('Piper'));
check('voice settings expose approved engine', (settings.includes('value="gemini"') || (settings.includes('value="kokoro"') && settings.includes('bm_george') && settings.includes('hm_omega'))) && !settings.includes('value="piper"') && !settings.includes('value="xai"'));
check('streaming output has start, delta, finish, cancel', localSpeech.includes("type: 'start'") && localSpeech.includes("type: 'text_delta'") && localSpeech.includes("type: 'finish'") && localSpeech.includes("type: 'cancel'"));
check('brain can feed safe clause deltas before completion without direct provider calls',
  brain.includes('streamTextToSpeech') && brain.includes('result.streamed') &&
  brain.includes('NexusAIChat.complete') && direct.includes('authenticated backend') &&
  !direct.includes('Authorization') && !direct.includes('callOpenAISchemaStream'));
check('bounded scheduler preserves a two-item queue', scheduler.includes('asyncio.Queue(maxsize=2)') && scheduler.includes('_stable_prefix') && scheduler.includes('_STOP'));
check('barge-in cancels the active generation', ui.includes("jarvisController?.abort('barge-in')") && ui.includes('window.LocalSpeechEngine?.stop?.()'));
check('hands-free waits for one permission then restores', ui.includes('clavis_mic_permission_granted') && ui.includes('requestClavisMicrophoneOnce'));

if (failures) {
  console.error(`\n${failures} Clavis local voice check(s) failed.`);
  process.exit(1);
}
console.log('\nAll Clavis local voice checks passed.');
