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

check('a wake source must be opted into before it opens a session',
  /function sourceAllowed/.test(wake) && /if \(!opts\.force && !sourceAllowed\(source\)\) return false;/.test(wake));
check('the wake WORD is not in the default sources',
  /const DEFAULT_SOURCES = '([^']+)'/.test(wake) &&
  !/const DEFAULT_SOURCES = '[^']*\bword\b/.test(wake));
check('a snap is',
  /const DEFAULT_SOURCES = 'snap/.test(wake));
check('speaking is refused while he is asleep',
  /if \(!opts\.unprompted\)/.test(voice) && /W\.isAwake\(\)/.test(voice));
check('the sleepy check-in is the single exception, and fires once per wake',
  /CHECK_IN_LINES/.test(wake) && /S\.checkedIn = true;/.test(wake) && /unprompted: true/.test(wake));
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
