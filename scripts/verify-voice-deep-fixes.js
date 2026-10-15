/* Deep voice-pipeline repairs (2026-10-11) — source-contract checks.
 *
 * A spoken turn must never die on plumbing:
 *   - an idle Scribe socket dropping right after the follow-up window closes
 *     must not switch the mic off (a network blip used to hard-stop it);
 *   - a provider change in Settings must reach a live session (the 'stt'
 *     listener existed, but nothing ever dispatched it);
 *   - falling asleep must ABORT a Groq capture instead of clearing a global
 *     the recorder never reads (the closure chunks paid for a transcription);
 *   - the ear module must not carry calls to functions that do not exist.
 * And the four-things window rule gains its two missing gates: a spoken
 * website brief and the spoken capabilities answer stay in the voice.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');

let failures = 0;
const check = (label, ok) => { console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}`); if (!ok) failures++; };

const ui = read('jarvis_ui.js');
const settings = read('clavis-elevenlabs-settings.js');
const ear = read('clavis-ear.js');
const engine = read('jarvis.js');
const intent = read('clavis-intent.js');

// ── 1. an idle-socket drop while asleep must not switch the mic off ──────
const onErrorStart = ui.indexOf('onError(error) {');
const onErrorEnd = ui.indexOf('});', onErrorStart);
const onErrorBlock = ui.slice(onErrorStart, onErrorEnd);
const guardAt = onErrorBlock.indexOf('if (transient && !clavisIsAwake())');
const muteAt = onErrorBlock.indexOf('setMicEnabled(false');
check('an idle-socket drop while asleep does not switch the mic off',
  guardAt >= 0 && muteAt > guardAt &&
  /if \(transient && !clavisIsAwake\(\)\) \{[\s\S]{0,220}return;/.test(onErrorBlock));
check('the asleep drop resets the fallback flags so the next wake retries fresh',
  guardAt >= 0 &&
  /if \(transient && !clavisIsAwake\(\)\) \{[\s\S]{0,220}clavisRealtimeInput\.fallback = false; clavisRealtimeInput\.blocked = false;/.test(onErrorBlock));

// ── 2. saving the STT provider must notify a live session ───────────────
check("saving the STT provider dispatches the 'stt' settings event",
  /if \(key === 'clavis_stt_provider'\)[\s\S]{0,320}clavis:voice-settings-changed[\s\S]{0,90}kind: 'stt'/.test(settings));

// ── 3. falling asleep must abort the Groq capture, not orphan it ────────
const sleepStart = ui.indexOf('function clavisOnFellAsleep');
const sleepEnd = ui.indexOf('\nfunction ', sleepStart + 10);
const sleepBlock = ui.slice(sleepStart, sleepEnd);
const stopGroqStart = ui.indexOf('function stopGroqCapture');
const stopGroqBlock = ui.slice(stopGroqStart, stopGroqStart + 260);
check('falling asleep aborts the Groq capture through the tested helper',
  /stopGroqCapture\(\);/.test(sleepBlock) &&
  /groqCapture\.cancel\?\.\(\);/.test(stopGroqBlock) && /groqCapture\.generation\+\+/.test(stopGroqBlock));
check('the asleep path no longer clears the global the recorder never reads',
  !/groqAudioChunks = \[\]/.test(sleepBlock));

// ── 4. the ear module must not call what does not exist ─────────────────
check('the ear module has no reference it cannot run',
  !/CONVO_RE/.test(ear) && !/latestTwoSentences/.test(ear));

// ── 5. a fresh-fact question is forced to search before it answers ─────
check('a fresh-fact question is detected before the prompt is sent',
  /const CLAVIS_FRESH_FACT_RE = /.test(engine) &&
  /answerOnly && !elaborate && CLAVIS_FRESH_FACT_RE\.test\(effectiveText\)/.test(engine));
check('the fresh-fact directive demands the search tool as the entire first reply',
  /answerOnly && !elaborate && CLAVIS_FRESH_FACT_RE\.test\(effectiveText\)[\s\S]{0,700}ENTIRE first reply must be exactly one \|\|\|TOOL:\{"skill":"search_web"/.test(engine));
check('a fresh-fact turn gets reasoning room for the tool decision',
  /freshFactTurn \? 700 : 320/.test(engine));

// ── 6. a spoken website brief stays off the floating window ─────────────
check('on a spoken turn only an image result opens the window from the command path',
  /const cmdVisual = requestSource === 'voice' \? \/<img\/i\.test\(cmd\.bubbleHtml \|\| ''\) :/.test(ui));

// ── 7. the spoken capabilities answer is spoken only ────────────────────
const capsAt = intent.indexOf('kya\\s*kya\\s*kar\\s*sakt');
check('the capabilities answer opens the document only on a non-voice turn',
  capsAt >= 0 &&
  /if \(opts\.source !== 'voice'\) \{[\s\S]{0,260}showDocument/.test(intent.slice(capsAt - 80, capsAt + 700)));

if (failures) { console.error(`\n${failures} deep voice check(s) failed.`); process.exit(1); }
console.log('\nDeep voice-pipeline checks passed.');
