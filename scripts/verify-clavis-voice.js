/** Offline regression checks for Rudra24 AI's ElevenLabs/Groq speech contract. */
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

console.log('\nRudra24 AI ElevenLabs voice verification\n');
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
const input = read('clavis-elevenlabs-stt.js');
const output = read('clavis-voice.js');
const brain = read('jarvis.js');
const direct = read('clavis-direct.js');
const html = read('index.html');
const settings = html.slice(html.indexOf('id="smsc-voice-settings"'), html.indexOf('id="smsc-notifications"'));
const activeSpeak = ui.slice(ui.lastIndexOf('async function speakJarvisText'),ui.indexOf('\nfunction testJarvisVoice',ui.lastIndexOf('async function speakJarvisText')));
const activeInput = ui.slice(ui.indexOf('function startJarvisVoiceInput'),ui.indexOf('// ── The command ear'));
check('loads Scribe input after the shared voice state and worklet loader', html.includes('clavis-elevenlabs-stt.js') && html.indexOf('clavis-voice-state.js') < html.indexOf('clavis-elevenlabs-stt.js') && html.indexOf('clavis-worklet.js') < html.indexOf('clavis-elevenlabs-stt.js'));
check('Scribe obtains a single-use token and sends resampled PCM', input.includes('/api/speech/elevenlabs-token') && input.includes('scribe_v2_realtime') && input.includes("commit_strategy: 'vad'") && input.includes('clavis-mic-capture-worklet.js'));
check('one active voice owner has no retired Fish/Gemini/local replay path', activeSpeak.includes('window.ClavisVoice.speak') && !activeSpeak.includes('ttsWithFish') && !activeSpeak.includes('ClavisLive.relay') && !activeSpeak.includes('LocalSpeechEngine.speak') && !activeSpeak.includes('legacySpeakJarvisText'));
check('deliberate voice starts ElevenLabs live; Scribe and Groq remain available fallbacks', activeInput.includes('liveVoice.start(') && activeInput.indexOf('liveVoice.start(') < activeInput.indexOf('startClavisElevenInput(options)') && activeInput.indexOf('startClavisElevenInput(options)') < activeInput.indexOf('legacyStartGroqWhisperVoiceInput(options)'));
check('voice settings expose ElevenLabs and Cartesia, with a Groq STT backup', settings.includes('value="elevenlabs"') && settings.includes('value="cartesia"') && settings.includes('id="sm-stt-provider"') && settings.includes('value="groq"') && !settings.includes('value="gemini"') && !settings.includes('value="fish_audio"'));
check('sentence speech is cancellable and does not replay a partial provider answer', ui.includes('clavisStreamSpeaker') && ui.includes('signal, forceRepeat: true') && activeSpeak.includes('partial provider failure must never replay') && output.includes('elevenlabs'));
check('brain can feed safe clause deltas before completion',
  brain.includes('streamTextToSpeech') && brain.includes('result.streamed') &&
  brain.includes('NexusAIChat.complete') && typeof direct === 'string' && direct.length > 0);
check('barge-in cancels generation while persistent input keeps microphone ownership', ui.includes("jarvisController?.abort('barge-in')") && ui.includes('window.ClavisElevenSTT?.isActive?.()') && ui.includes('verdict.barge'));
check('hands-free waits for one permission then restores', ui.includes('clavis_mic_permission_granted') && ui.includes('requestClavisMicrophoneOnce'));

if (failures) {
  console.error(`\n${failures} Rudra24 AI voice check(s) failed.`);
  process.exit(1);
}
const {execFileSync} = require('node:child_process');
for (const test of ['voice_features_efficiency_selftest.js','voice_query_intent_selftest.js','session_speaker_selftest.js','elevenlabs_input_selftest.js','elevenlabs_output_selftest.js','voice_state_selftest.js',
  'shared_microphone_lifecycle_selftest.js','voice_single_reply_selftest.js','groq_cartesia_voice_selftest.js',
  'voice_chat_client_recovery_selftest.js','voice_ui_recovery_selftest.js','voice_task_cancellation_selftest.js','voice_budget_selftest.js',
  'ai_error_feedback_selftest.js','realtime_voice_pipeline_test.js',
  'elevenlabs_campaign_selftest.js','elevenlabs_studio_lifecycle_test.js']) {
  execFileSync(process.execPath,[path.join(ROOT,'tests',test)],{stdio:'inherit'});
}
console.log('\nAll Rudra24 AI ElevenLabs voice checks passed.');
