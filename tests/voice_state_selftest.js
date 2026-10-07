// node tests/voice_state_selftest.js — pure checks for clavis-voice-state.js + clavis-wake.js
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

// These session tests explicitly opt into wake words; ordinary boot keeps them off.
const store = { clavis_wake_sources: 'snap,clap,tap,typed,touch,word' };
const doc = {
  readyState: 'complete',
  documentElement: { setAttribute() {} },
  addEventListener() {},
  getElementById() { return null; },
};
const win = {
  localStorage: { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); } },
  document: doc,
  dispatchEvent() {},
  CustomEvent: function () {},
  setTimeout: () => 0, clearTimeout() {}, setInterval: () => 0, clearInterval() {},
  console,
};
win.window = win;
const ctx = vm.createContext(Object.assign(win, { Date, Math, Number, String, JSON, Set, Map, Array, Object, RegExp, Error, Infinity }));
for (const f of ['clavis-wake.js', 'clavis-voice-state.js']) vm.runInContext(fs.readFileSync(path.join(__dirname, '..', f), 'utf8'), ctx, { filename: f });
const VS = win.ClavisVoiceState, W = win.ClavisWake;
let t = 1e12;
const clock = () => t;
VS._setClock(clock); W._setClock(clock);

// ── endpointing ──
assert.strictEqual(VS.decide('Open Chrome and', 1199), 'wait', 'connector keeps a longer pause');
assert.strictEqual(VS.decide('mujhe gurgaon ki', 1199), 'wait');
assert.strictEqual(VS.decide('Open Chrome and', 1200), 'commit');
assert.strictEqual(VS.decide('gurgaon ki leads dikhao', 220), 'commit');
assert.strictEqual(VS.decide('gurgaon ki leads dikhao', 219), 'wait');
assert.strictEqual(VS.decide('what is the weather today?', 700), 'commit');
assert.strictEqual(VS.decide('open chrome', 449), 'wait');
assert.strictEqual(VS.decide('open chrome', 450), 'commit');
assert.ok(W.named('Hey Rudra leads dikhao'));
assert.ok(W.named('रुद्र leads dikhao'));
assert.strictEqual(W.named('Hey Clavis'), false);   // purana naam ab nahi jagata
assert.strictEqual(VS.parseStop('Rudra chup').kind, 'hush');
assert.strictEqual(VS.decide('wait', 5000), 'hold', '"wait" holds');
assert.strictEqual(VS.decide('ek minute ruko', 9000), 'hold');
assert.strictEqual(VS.decide('mujhe leads chahiye', 9000, { holding: true }), 'hold', 'held until release');
assert.strictEqual(VS.decide('ruko mujhe leads chahiye ab batao', 0, { holding: true }), 'commit', 'release commits');
assert.strictEqual(VS.stripHold('ruko mujhe leads chahiye ab batao'), 'mujhe leads chahiye');
assert.strictEqual(VS.decide('wait', VS.HOLD_MAX_MS + 1), 'drop');
assert.strictEqual(VS.decide('wait for five minutes then remind me', 1300), 'commit', 'wait inside a sentence is not a hold');

// ── stop / silent / sleep ──
assert.strictEqual(JSON.stringify(VS.parseStop('be silent for 5 minutes')), JSON.stringify({ kind: 'silent', ms: 300000 }));
assert.strictEqual(JSON.stringify(VS.parseStop('5 minute chup raho')), JSON.stringify({ kind: 'silent', ms: 300000 }));
assert.strictEqual(JSON.stringify(VS.parseStop('chup raho das minute')), JSON.stringify({ kind: 'silent', ms: 600000 }));
assert.strictEqual(VS.parseStop('bas karo').kind, 'sleep');
assert.strictEqual(VS.parseStop('stop listening').kind, 'sleep');
assert.strictEqual(VS.parseStop('so jao').kind, 'sleep');
assert.strictEqual(VS.parseStop("that's all").kind, 'sleep');
assert.strictEqual(VS.parseStop('goodbye').kind, 'sleep');
assert.strictEqual(VS.parseStop('shut up').kind, 'hush');
assert.strictEqual(VS.parseStop('chup').kind, 'hush');
assert.strictEqual(VS.parseStop('stop talking').kind, 'hush');
assert.strictEqual(VS.parseStop('be quiet').kind, 'hush');
for (const command of ['चुप', 'चुप रहो', 'रुको', 'बोलना बंद करो', 'रुद्र चुप करो']) assert.strictEqual(VS.parseStop(command).kind, 'hush', command);
assert.strictEqual(VS.parseStop('रुको का मतलब क्या होता है'), null);
assert.strictEqual(VS.parseStop('stop the lead search in noida'), null);
assert.strictEqual(VS.parseStop('gurgaon ki leads dikhao'), null);

// ── yes / no ──
for (const y of ['haan', 'ha', 'yes', 'kar do', 'ok', 'theek hai', 'haan ji kar do', 'Haan.']) assert.strictEqual(VS.parseYesNo(y), 'yes', y);
for (const n of ['na', 'nahi', 'no', 'mat karo', 'rehne do', 'cancel', 'nahi rehne do', 'haan mat karo']) assert.strictEqual(VS.parseYesNo(n), 'no', n);
assert.strictEqual(VS.parseYesNo('gurgaon ki leads'), null);
assert.strictEqual(VS.parseYesNo('Haan ya na?'), null, 'own question is not an answer');
for (const answer of ['हाँ', 'हां', 'जी हाँ कर दो', 'ठीक है']) assert.strictEqual(VS.parseYesNo(answer), 'yes', answer);
for (const answer of ['नहीं', 'रहने दो', 'हाँ लेकिन भेजो मत']) assert.strictEqual(VS.parseYesNo(answer), 'no', answer);
assert.strictEqual(VS.parseYesNo('हाँ या ना?'), null, 'Hindi echo is not confirmation');

// ── [[directive]] stripping ──
assert.strictEqual(VS.stripDirectives('Sir, kya error aa raha hai?]]'), 'Sir, kya error aa raha hai?');
assert.strictEqual(VS.stripDirectives('[[silent]]'), '');
assert.strictEqual(VS.stripDirectives('[[Haan sir]]'), 'Haan sir');
assert.strictEqual(VS.stripDirectives('[[Sir, kya error aa raha hai?'), 'Sir, kya error aa raha hai?');
assert.strictEqual(VS.stripDirectives('Dekhiye [docs](https://x.y/z) yahan.'), 'Dekhiye [docs](https://x.y/z) yahan.');
assert.strictEqual(VS.stripDirectives('Ok [[pause]] done'), 'Ok done');
assert.strictEqual(VS.stripDirectives('run:\n```\nif [[ -f a ]]; then x; fi\n```'), 'run:\n```\nif [[ -f a ]]; then x; fi\n```');

// ── state machine ──
assert.strictEqual(VS.state(), 'SLEEPING');
assert.strictEqual(VS.set('ASSISTANT_SPEAKING'), false, 'no speaking while asleep');
assert.strictEqual(VS.set('LISTENING'), true);
assert.strictEqual(VS.set('USER_SPEAKING'), true);
assert.strictEqual(VS.set('PROCESSING'), true);
assert.strictEqual(VS.set('EXECUTING'), true);
assert.strictEqual(VS.set('ASSISTANT_SPEAKING'), true);
assert.strictEqual(VS.set('USER_SPEAKING'), true, 'barge-in');
assert.strictEqual(VS.set('ERROR'), true);
assert.strictEqual(VS.set('USER_SPEAKING'), false);
assert.strictEqual(VS.set('SLEEPING'), true);

// ── continuous session: 3 min without a turn → SLEEPING (injectable clock) ──
W.wake('word');
VS._tick();
assert.strictEqual(VS.state(), 'LISTENING');
t += 170000; assert.ok(W.isAwake(), 'still awake at 2:50');
W.busy(true, 'turn'); t += 20000; W.busy(false, 'turn');     // an accepted turn resets the 3 min
t += 170000; assert.ok(W.isAwake(), 'turn extended the session');
t += 11000; VS._tick();
assert.ok(!W.isAwake(), 'asleep 3 min after the last turn');
assert.strictEqual(VS.state(), 'SLEEPING');
// typed turn keeps the short follow-up
W.wake('typed'); t += 12000; assert.ok(!W.isAwake(), 'typed wake is short');
// continuous off → old 10 s window
store.clavis_continuous = 'false'; W.wake('word'); t += 11000; assert.ok(!W.isAwake()); delete store.clavis_continuous;

// ── silent mode ──
W.wake('word'); VS._tick();
VS.silence(300000); assert.strictEqual(VS.state(), 'SILENT_MODE'); assert.ok(VS.isSilent());
t += 299000; VS._tick(); assert.strictEqual(VS.state(), 'SILENT_MODE');
t += 2000; VS._tick(); assert.strictEqual(VS.state(), 'LISTENING');

// ── watchdog revives a dead mic ──
let alive = false, revived = 0;
VS.configure({ shouldListen: () => true, alive: () => alive, revive: () => { revived++; alive = true; } });
VS._tick(); assert.strictEqual(revived, 0, 'grace period');
t += 1600; VS._tick(); assert.strictEqual(revived, 1);
alive = false; t += 800; VS._tick(); t += 1600; VS._tick(); assert.strictEqual(revived, 2);
// stuck PROCESSING recovers
W.wake('word'); VS._tick(); VS.set('PROCESSING'); t += 46000; VS.configure({ alive: () => true }); VS._tick(); assert.strictEqual(VS.state(), 'LISTENING');

// ── metrics ──
VS.mark('first_partial', t); VS.mark('last_voice', t + 1000); VS.mark('endpoint', t + 1700); VS.mark('dispatch', t + 1750);
const m = VS.metrics();
assert.strictEqual(m.last.endpoint_wait, 700); assert.strictEqual(m.last.dispatch, 50); assert.strictEqual(m.spans.dispatch.p95, 50);

console.log('voice_state_selftest: all passed');
