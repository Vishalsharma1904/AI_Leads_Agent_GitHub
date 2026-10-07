# Rudra24 AI — Real-Time Voice & Interaction Pipeline Architecture

## 1. Executive Summary & Objective

**Rudra24 AI**'s interaction and voice pipeline has been upgraded from a brittle, latency-prone chat wrapper to a low-latency, hard-gated real-time voice system comparable to Gemini Live and modern voice assistants.

The pipeline achieves:
- **Sub-50ms deterministic command routing** for navigational, control, system, and web actions without touching cloud LLMs.
- **True hardware/software microphone gating**: When listening or the microphone is toggled OFF, MediaStream tracks are physically stopped, AudioContexts closed, AudioWorklet nodes disconnected, speech recognition halted, and watchdog revival blocked.
- **Zero accidental turn commits**: Tapping the mic button while speaking terminates cleanly without firing unwanted AI requests.
- **Race condition immunity**: Superceded commands (Command A immediately followed by Command B) abort stale async operations and reject out-of-order completions.
- **Instant voice output cancellation**: Disabling voice output or uttering stop words instantly halts speech synthesis and audio buffers.
- **Verified browser tab management**: Native `WindowProxy` tracking enables reliable tab reuse and honest popup-blocker detection without hallucinating success.
- **Preserved brand identity**: Absolute fidelity for "Rudra24 Secure" (`https://rudra24secure.com`) and "Rudra24 Jobs" (`https://rudra24jobs.com`).

---

## 2. Architectural Blueprint

```
                      [ USER SPEECH / INPUT ]
                                 │
                 ┌───────────────┴───────────────┐
                 ▼                               ▼
       [ Push-to-Talk / Mic ]          [ Hands-Free / Wake / Clap ]
                 │                               │
                 └───────────────┬───────────────┘
                                 │
                                 ▼
                     ┌───────────────────────┐
                     │   ClavisVoiceState    │◄─── [ HARD GATE ]
                     │ (State & Mic Owner)   │     (canProcessMic?)
                     └───────────┬───────────┘
                                 │
                 ┌───────────────┼───────────────┐
                 │ (if OFF)      │ (if ON)       │
                 ▼               ▼               ▼
          [ Release All ]   [ ClavisEar ]   [ ClavisIntent ]
          - Audio Tracks    - AEC / NS      - Local Regex & Entities
          - AudioContext    - Double-talk   - <50ms Fast-Path
          - Worklets        - Throttle      - Past-Tense Spoken Reply
          - Watchdog Off    - Caption       │
                                 │          │ (Matched)
                                 │          ├──────────────────┐
                                 │          ▼                  ▼
                                 │   [ Direct Action ]   [ Browser Mgr ]
                                 │   - Mic ON/OFF        - Tab reuse
                                 │   - Stop/Cancel       - No duplicate
                                 │   - Vol/Lang/Pet      - Verified focus
                                 │
                                 ▼ (Unmatched)
                     ┌───────────────────────┐
                     │   Async Execution     │
                     │  (ClavisAppMap,       │
                     │   ChatEngine, LLM)    │
                     └───────────┬───────────┘
                                 │
                         [ Currency Check ]
                     (isOperationCurrent(id)?)
                                 │
                        ┌────────┴────────┐
                        ▼                 ▼
                  (Superceded)        (Current)
                    [ DROP ]        [ TTS / Render ]
                                          │
                                    [ canSpeak? ]
                                          │
                                   ┌──────┴──────┐
                                   ▼             ▼
                               [ Audio ]     [ Silent ]
```

---

## 3. What Was Wrong in the Prior Attempt & How It Was Fixed

### Issue 1: Popup Blocker False Positive Bug in `clavis-browser.js`
- **Input**: User requested to open a website or app (`BrowserActionManager.open('https://rudra24secure.com')`).
- **Expected**: Tab opens, reference is saved, subsequent requests focus the existing tab, and honest error only when blocked.
- **Actual**: Always reported `POPUP_BLOCKED` even when the window opened successfully; tab reuse was broken.
- **Root Cause**: The prior code called `root.open(resolved.url, tabName, 'noopener')`. Under the WHATWG HTML standard, `'noopener'` explicitly forces `window.open` to return `null` in Chromium-based browsers, which the code misinterpreted as a popup-blocker failure.
- **Fix**: Removed `'noopener'` from the window features parameter while maintaining secure proxy handling.

### Issue 2: Missing STOP / CANCEL / Web Search in `clavis-intent.js`
- **Input**: User said "Stop.", "Cancel.", "Ruko ruko", "Chup ho jao", or "Search Google for X".
- **Expected**: Deterministic local handling in <50ms without cloud LLM roundtrips.
- **Actual**: Fell through to cloud LLM or did nothing (`{ handled: false }`).
- **Root Cause**: `clavis-intent.js` lacked deterministic regex cases and handlers for `STOP`, `CANCEL`, and `SEARCH_WEB`.
- **Fix**: Added explicit handlers in `deterministicIntent()` that immediately cancel active operations, transition `ClavisVoiceState` to `STOPPED`, and halt audio.

### Issue 3: Tapping Mic OFF While Speaking Triggered Unwanted Voice Query
- **Input**: User speaking into microphone taps mic button to turn it OFF.
- **Expected**: Microphone turns off silently, partial speech is discarded, no request sent.
- **Actual**: `clavisEarCommit('tap')` was invoked, committing incomplete speech as a full query.
- **Root Cause**: `jarvis_ui.js` line 1658 checked `if (clavisEar.heard && clavisEar.heard.trim()) { clavisEarCommit('tap'); return; }`.
- **Fix**: Replaced with clean discard logic: `clearTimeout(clavisEar.timer)`, `clavisEarConsumeAll()`, `ear.holding = false`, `ear.heard = ''`, and `setMicEnabled(false)`.

### Issue 4: Voice Output Toggle Audio Leak
- **Input**: User toggled voice output off while Rudra24 AI was speaking.
- **Expected**: Audio playback halts immediately and queued speech is dropped.
- **Actual**: Audio continued playing until completion; `ClavisVoiceState` capability was out of sync.
- **Root Cause**: `toggleJarvisSpeech()` only flipped a local boolean variable without stopping active audio nodes or notifying `ClavisVoiceState`.
- **Fix**: Updated `toggleJarvisSpeech()` to invoke `CLAVIS_VS.setVoiceOutputEnabled(false)` and `stopJarvisSpeech()`, which cancels SpeechSynthesis, Web Audio nodes, and HTMLAudioElements.

### Issue 5: Microphone Audio Leaks & Inactive Listeners
- **Input**: Mic disabled via `ClavisVoiceState.setMicEnabled(false)`.
- **Expected**: All MediaStream tracks stopped, AudioContexts closed, AudioWorklets disconnected.
- **Actual**: `ClavisBargeIn`, `ClavisEar.tap`, `ClavisAudioTrigger`, and `LocalSpeechEngine` held onto audio context and tracks or acquired them even when mic was OFF.
- **Root Cause**: Missing `canProcessMic()` gates and missing cleanup registrations.
- **Fix**: Added `canProcessMic()` guards across all 4 modules and registered cleanup routines with `ClavisVoiceState.registerAudioCleanup()`.

### Issue 6: Race Condition on Rapid Commands (Command A vs Command B)
- **Input**: User says Command A, then quickly says Command B before Command A completes.
- **Expected**: Command A's response is dropped; Command B is processed and presented.
- **Actual**: Command A's async callback could complete after Command B, overwriting UI and speaking stale answers.
- **Root Cause**: No operation sequencing or currency checks across async execution paths.
- **Fix**: Integrated monotonic operation tokens (`createOperation('turn')`) and abort signals. All async continuations check `isOperationCurrent(op.id)` and abort on stale turns.

### Issue 7: Spoken Feedback Brand and Verb Fidelity
- **Input**: User asks to open Rudra24 Secure.
- **Expected**: "Opened Rudra24 Secure." (past tense, confirmed).
- **Actual**: "Opening Rudra24 Secure." (present progressive, even after verified opening).
- **Root Cause**: Hardcoded present tense string in routing response.
- **Fix**: Changed spoken responses to confirmed past tense ("Opened Rudra24 Secure.", "Opened Rudra24 Jobs.").

---

## 4. Modified Files Summary

| File | Changes Made |
| :--- | :--- |
| `clavis-browser.js` | Removed `'noopener'` feature string to retain `WindowProxy` for tab reuse and blocker verification. |
| `clavis-intent.js` | Added deterministic handlers for `STOP`, `CANCEL`, `SEARCH_WEB`, `MIC_OFF`, `MIC_ON`, and updated spoken feedback to past tense. |
| `clavis-barge-in.js` | Added `canProcessMic()` gating on `arm()`, implemented `cleanup()`, and registered with `ClavisVoiceState`. |
| `clavis-ear.js` | Added `canProcessMic()` gating on `tap.start()` and `tap.ensure()`; preserved layout throttles. |
| `clavis-audio-trigger.js` | Added `canProcessMic()` gating on `start()` and registered audio cleanup. |
| `clavis-local-speech.js` | Added `canProcessMic()` gating on mic acquisition and `startInput()`, implemented `releaseMicrophone()`, registered cleanup. |
| `clavis-voice-state.js` | Extended `KEYS` and `SPANS` to symmetrically support `intent_detected`, `first_audio_output`, `final_transcript`. |
| `jarvis_ui.js` | Discarded speech on manual mic-off toggle, synchronized `toggleJarvisSpeech()`, and wired operation currency guards. |
| `tests/realtime_voice_pipeline_test.js` | Added Scenarios 14–19 verifying STOP/CANCEL, Web Search, BargeIn cleanup, Rapid toggles, and Race condition protection. |

---

## 5. Mental Model & Thinking Framework for Future Engineering

When extending or maintaining Rudra24 AI, follow this decision tree:

1. **State Ownership**:
   - `ClavisVoiceState` is the single source of truth for voice state and hardware capabilities.
   - Never query or mutate raw `SpeechRecognition` or `AudioContext` without consulting `ClavisVoiceState.canProcessMic()` or `ClavisVoiceState.canSpeak()`.

2. **Deterministic Fast-Path (<50ms) First**:
   - If an intent can be resolved locally (apps, system switches, specific websites, calculations), resolve it immediately in `clavis-intent.js` or `clavis-commands.js`.
   - Never make an LLM network roundtrip for navigation, volume, tab closing, or hardware controls.

3. **Cancellation & Async Currency**:
   - Every asynchronous operation (network fetch, scraping, LLM stream) MUST hold an `operationId`.
   - Before taking any user-facing action after an `await`, check `ClavisVoiceState.isOperationCurrent(op.id)`. If false, silently return.

4. **Zero Lingering Media**:
   - Web Audio and MediaStream tracks hold OS microphone indicators (the orange dot in Windows/macOS/Android).
   - "OFF" must mean 0 active tracks and closed or suspended contexts.

---

## 6. Verification Record

- **Test Suite Execution**:
  - `node tests/realtime_voice_pipeline_test.js`: **19/19 PASSED**
  - `node tests/voice_state_selftest.js`: **PASSED**
  - `node scripts/run-all-checks.js`: **11/11 SUITES PASSED (116 scripts parsed)**
