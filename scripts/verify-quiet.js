/* Rudra must not talk to an empty room.
 *
 * The symptom was "haan sir, boliye" repeating at nobody and billing a
 * model call each time. Two causes, both guarded here:
 *   1. the wake WORD opened a session off ambient noise, the television,
 *      or Rudra's own voice off the speakers;
 *   2. several proactive layers call ClavisVoice directly, so the model-
 *      level wake gate never saw them.
 * Both leave the UI looking fine, which is why they need a test.
 */
const fs = require('fs');
const path = require('path');
const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
let failures = 0;
const check = (l, ok) => { console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${l}`); if (!ok) failures++; };

const wake = read('clavis-wake.js');
const voice = read('clavis-voice.js');
const canvas = read('clavis-canvas.js');
const vm = require('node:vm');
const timers = new Map(), storage = new Map(); let nextTimer = 0, speech = 0;
const quietWindow = { ClavisVoiceState: { isClavisWorkspace: () => true }, ClavisVoice: { speak: () => speech++ }, addEventListener() {}, dispatchEvent() {} };
vm.runInNewContext(wake, {window: quietWindow, document: {documentElement:{setAttribute(){}},addEventListener(){}},
  localStorage:{getItem:key=>storage.get(key)??null}, setTimeout:(fn,ms)=>{timers.set(++nextTimer,{fn,ms});return nextTimer;},clearTimeout:id=>timers.delete(id)});

check('a wake source must be opted into before it opens a session',
  /function sourceAllowed/.test(wake) && /if \(!opts\.force && !sourceAllowed\(source\)\) return false;/.test(wake));
storage.set('clavis_wake_sources', 'snap,tap,typed,touch');
check('a saved wake-word opt-out refuses voice wake', !quietWindow.ClavisWake.wake('word') && !quietWindow.ClavisWake.isAwake());
storage.delete('clavis_wake_sources');
const input = read('jarvis_ui.js');
const gate = input.slice(input.indexOf('// Authenticate the speaker before wake'), input.indexOf('// ── Wake gate:'));
check('speaker rejection returns before wake or dispatch', /clavisVoiceVerdict\(heard, meta\)/.test(gate) && /if \(!verdict.accept\)/.test(gate) && /return;/.test(gate));
check('a snap is',
  /const DEFAULT_SOURCES = 'snap/.test(wake));
check('speaking is refused while he is asleep',
  /if \(!opts\.unprompted\)/.test(voice) && /W\.isAwake\(\)/.test(voice));
quietWindow.ClavisWake.wake('typed');
const idle = [...timers.values()].find(timer=>timer.ms===45000);
idle?.fn();
check('idle check-in sleeps silently without paid speech', Boolean(idle) && !quietWindow.ClavisWake.isAwake() && speech===0);
check('going to sleep cancels a pending check-in',
  /clearTimeout\(S\.checkTimer\);[\s\S]{0,60}S\.checkedIn = false;/.test(wake));
check('still being there postpones the sleepy line rather than stacking one',
  /armCheckIn\(\);\s*\/\/ he is still here/.test(wake));
check('a pin offers the route he would have asked for next',
  /function offerRouteNext/.test(canvas) && /route bana doon/.test(canvas));
check('it does not offer to route him to where he already is',
  /place\.kind === 'me'/.test(canvas));

if (failures) { console.error(`\n${failures} quiet check(s) failed.`); process.exit(1); }
console.log('\nRudra stays quiet unless spoken to.');
