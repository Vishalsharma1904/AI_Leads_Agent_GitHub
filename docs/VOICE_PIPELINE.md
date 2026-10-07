# Rudra24 AI voice pipeline — map and root causes (2026-09-25)

## Current Groq / Cartesia audit (2026-10-05)

The configured chain is Groq Whisper → Groq LLM → Cartesia PCM playback.
When Groq is configured, awake microphone turns use the authenticated server
vault transcription endpoint instead of requiring an exposed browser API key
or silently selecting Gemini/native transcription. Output accents do not force
English transcription: Hindi/English speech remains automatic.

Root causes corrected:

- Ordinary wake/relisten no longer schedules a canned “Haan sir/boliye” reply.
  Information prompts answer directly; short contextual follow-ups use the same
  compact prompt and recent conversation instead of the full tool catalogue.
- A repeated short opener cannot discard the rest of a streamed answer. Each
  turn waits for its audio queue, and cancellation prevents late chunks or
  transcripts from starting another answer. Account changes invalidate capture.
- The top-bar and speech toggle now update the same playback capability. Audio
  prewarming waits for the worklet player, shares pending initialization, and
  retries after a failed load instead of leaving an unusable context forever.
- Configured Cartesia output does not replay a failed reply through another
  voice. Its endpoint preserves raw PCM format and reports errors; the playback
  meter now measures Cartesia output for the echo-aware interruption detector.
- For Groq interruptions, recording starts on the first detected speech frame
  while sustained speech is confirmed. The cloned stream, recorder and initial
  chunks transfer to the next turn; false candidates are discarded. Saved
  listening patience applies to Groq silence detection too (600–3000 ms).
- Local hush/confirmation handling recognizes Hindi transcripts such as
  “चुप”, “रुको”, “हाँ” and “नहीं”; a negative answer does not approve an action.
- Microphone endpointing resumes its audio context and requires sustained pitched
  speech, rather than accepting a single loud click. The Groq path also samples
  enrolled Voice ID, matching the native recognizer's ownership checks.
- Transcription now uses `whisper-large-v3`. Provider segment confidence,
  silence and repetition metadata reject uncertain decoding before dispatch;
  a rejected recording pauses the mic instead of creating a retry loop. Hindi
  captions use the existing Roman Hinglish converter, preserving repetitions;
  raw transcripts remain available to intent/echo checks and English stays intact.
  Metadata/model reference: [Groq speech documentation](https://console.groq.com/docs/speech-to-text).
- A real provider probe hallucinated text from a zero-filled WAV despite the
  segment checks. Audio now decodes locally (bounded to 60 seconds), passes
  the already-installed Silero VAD, trims leading/trailing silence, and reaches
  Groq as 16 kHz mono WAV only when speech is present. Silent/noise rejection
  happens before a provider request. Local validation failure is explicit.
- Missing keys, failed providers and empty streams do not consume the app's
  daily AI allowance. Reservations are atomic; refunds retain their original
  day. Partial delivered replies remain charged. Provider allowance remains
  separate and cannot be refunded by this app.
- Limit/key failures pause voice capture; background helper AI requests yield
  while listening/processing/speaking. Provider daily and per-minute failures
  have different labels, without exposing raw provider error bodies.

Verified evidence:

- `node tests/groq_cartesia_voice_selftest.js`: actual queue, recorder ownership,
  account/cancel guards, compact follow-ups, mute synchronization, worklet
  recovery, early interruption audio and late microphone acquisition checks.
- `node tests/realtime_voice_pipeline_test.js`: 20/20 scenarios passed.
- From `backend`: `.\.venv312\Scripts\python.exe -m unittest tests.test_voice_providers tests.test_speech_core`: 12 passed.
- Real saved-provider two-turn synthetic audio check: Groq STT 0.80–1.20 s,
  Groq LLM 0.89–1.36 s, Cartesia synthesis 0.87–1.99 s. The follow-up retained
  Delhi. These are separate service timings, not a microphone latency benchmark.
- A separate real Cartesia raw PCM check returned 24 kHz mono signed 16-bit
  audio, 3.84 seconds long, in 1.51 seconds. No provider secrets were printed.
- After audio validation was added, a bounded real-provider probe recognized
  “I work in Delhi. Please explain CRM in two sentences.” exactly and the Hindi
  sample “आपने अभी दिल्ली का जिक्र किया था”. Silence returned `no_speech`;
  the single LLM answer spent exactly one app allowance and Cartesia generated
  its audio. Local audio validation measured 0.616 s cold / 0.047 s warm on a
  four-second synthetic clip. A temporary connection failure preceded the
  successful probe; no automatic retry was added to the product.

Still unverified: the user's refreshed authenticated browser microphone,
speaker echo/interruption quality and sustained natural conversation. Browser
control could not attach to the current Chrome tab. Observed old-tab requests
still used `language_hint=en-GB`, and several Groq requests received HTTP 429;
these do not prove the new build was loaded or that playback succeeded. Batch
Whisper supplies a final transcript after silence, not live partial transcripts.
Do not claim Gemini-equivalent hardware latency from these checks.

## Historical live audit (2026-10-01)

- Text/chat now requests Groq `openai/gpt-oss-20b` (low reasoning), with the existing provider/model fallback. Vision remains on a vision-capable provider. Explicit provider prefixes take precedence over a saved default.
- Gemini Live keeps the microphone, transcription, turn-taking and streamed speech. When a Groq key is connected, its read-only `consult_brain` tool supplies substantive answers; greetings and direct app/lead commands skip that extra round trip. This hybrid has two provider hops and is not inherently faster than native Gemini conversation.
- Removed the extra 32 ms mic batching; bounded otherwise-unlimited direct text requests; cancelled pending brain calls on interruption/disconnect. Website contacts now publish before enrichment, with a 25 s enrichment budget and retained partial findings.
- Writing preview no longer waits for a full sentence. Backend stream reading does not wait for UI/TTS callbacks. Preview updates are capped at one per 80 ms.
- Long text sessions had a concrete contract bug: 12 history turns could produce 25 messages, exceeding the backend's 20-message validation limit. Requests now preserve the system instruction and newest 19 messages; past chat history has a 6,000-character budget while the current question is retained intact.
- Native voice context compresses at 24,000 tokens to 12,000. This bounds long-session growth, but compression itself can briefly add latency. The saved listening patience still applies, so mid-sentence pauses are not forcibly cut short.
- **Actual provider check:** the configured Gemini key listed Live models successfully, but both tested Live models closed with project access denied. This is a Google project-access problem, not proof of a slow model. Access denials now stop retries promptly. No working voice timing or physical microphone benchmark was obtained.
- Backend credential flags at this audit: Gemini configured; Groq and Apify absent. Add these through Rudra Setup while signed in. Never paste keys into a public issue or commit them.
- Chrome was not connected to browser control. The existing in-app browser was inspected with CDP instead: logged-out Live state was off, console had no errors, and local page load was approximately 7.9 s. This does not benchmark the user's Chrome or sustained speech.
- The health endpoint's false "lead browser missing" report came from calling synchronous Playwright in its async event loop. The browser actually existed; health now checks it in a worker thread.

DevTools diagnostics (no keys/transcripts in the brain timing list):

```js
ClavisDirect.requestDiagnostics().timings
ClavisVoiceState.metrics()
ClavisLive.status()
```

Runnable checks: `tests/realtime_voice_pipeline_test.js`, `tests/request_efficiency_selftest.js`, `tests/voice_state_selftest.js`, `tests/voice_single_reply_selftest.js`, `scripts/verify-lead-pipeline.js`, and `backend/tests/test_apify_pipeline.py`.

Provider references: [Groq reasoning](https://console.groq.com/docs/reasoning), [Gemini session management](https://ai.google.dev/gemini-api/docs/live-api/session-management), [Gemini Live protocol](https://ai.google.dev/api/live).

## Map (before this change)

```
            ┌──────────── SLEEPING (ClavisWake asleep) ────────────┐
 mic ──► wake listener (Web Speech #1, en-IN)   clap/snap worklet (raw shared stream)
            │ "Rudra24 AI…"                              │
            ▼                                        ▼
 startJarvisVoiceInput ─► Live (Gemini Live, own VAD 1.1 s)   if a Google key
                       ├► LocalSpeechEngine socket (:8000)     if backend up
                       ├► Groq Whisper MediaRecorder           if a Groq key   ← no endpoint, 20 s cap
                       └► native recognizer (Web Speech #2, hi-IN)
                               │ interim → caption.live · final → clavisPauseFor timer (0.9–2.4 s)
                               ▼
 commitJarvisVoiceInput (ClavisEar.judge, wake strip, fragment) → handleJarvisSend → clavisHandleSendCore
                               │ recognizer STOPPED here
                               ▼
 reply → speakJarvisText (whole reply, after the LLM finished) → onSpeechFinished
      → scheduleHandsFreeRelisten (+700 ms) → wake listener again, now as the
        follow-up "command" recognizer (en-IN, other language, other timer)
```

## Why "sometimes it hears, sometimes it doesn't"

1. **Two Web Speech instances fight.** Chrome runs one SpeechRecognition at a
   time. The wake listener and the command recognizer were started and
   stopped by independent timers (120 ms / 180 ms / 500 ms / 700 ms restarts in
   `onend`, `scheduleHandsFreeRelisten`, the barge-in path). Whichever started
   last aborted the other; `onend` restarts guarded by `jarvisRecognition`
   then sometimes left **neither** running (dead mic until the next reload or tap).
2. **Deaf gap after every reply.** The command recognizer was stopped at
   commit, nothing listened while Rudra24 AI spoke, and listening resumed only
   700 ms after TTS ended plus recogniser warm-up (~300–800 ms). The first
   words of a quick follow-up were lost.
3. **Follow-ups ran on a different recognizer.** Turn 1 = hi-IN command
   recognizer; turn 2+ = en-IN wake listener with its own pause timer
   (`clavisPauseFor(…,1500)`), so the same sentence was transcribed and
   timed differently turn to turn.
4. **Follow-up judge dropped English.** In the open-mic window
   `ClavisEar.judge` accepted only a *Hindi/Hinglish* request
   (`convoRequest` requires `CONVO_RE`), so "open the leads page" or "what's
   the weather" after a reply was silently discarded.
5. **9 s follow-up window.** Any pause longer than ~9 s after a reply put
   Rudra24 AI back to sleep; the next sentence needed the wake word again.
6. **Side talk slept the session.** A `[[silent]]` verdict called
   `ClavisWake.sleep('side-talk')`, ending the conversation.

## Why "sometimes no preview"

7. **Groq path had no partials and no endpoint.** With a Groq key and no
   Gemini key every wake went to the MediaRecorder → Whisper path: nothing in
   the caption while speaking, and the turn ended only on a second tap or the
   **20 s** safety cap — the "random big delay".
8. The caption `tidy()` added punctuation/capitalised "i" on every partial,
   so words visibly changed under him (not verbatim).
9. Echo-guarded partials during TTS were silently dropped (correct), but the
   caption was never re-armed after speech when the recognizer was restarted.

## Why "sometimes fast, sometimes slow"

10. **Fixed silence timer** (`clavisPauseFor`): 0.9 s after a *final* result,
    +0.3–1.5 s by ending word. It only armed after Chrome's final result
    (which itself lags 0.3–1 s), and it cut him off at any ≥1 s pause.
11. **TTS waited for the whole LLM reply** unless the optional backend
    (LocalSpeechEngine :8000) was up — normally it is not, so first audio =
    full generation + TTS.
12. Groq 20 s cap (7) and the 700 ms relisten delay (2).

## Fixes (this change)

| # | Fix |
|---|-----|
| 1,2,3,9 | `clavis-voice-state.js` owns the mic: exactly one recognizer at a time (`mic.claim/release`). While awake, ONE persistent native recognizer (the "command ear") stays open across turns and during TTS; the wake listener runs only while SLEEPING. A 1.5 s watchdog restarts whichever should be running if it died (`onend` without restart, `no-speech`, `network`, `aborted`). |
| 4 | Open-mic judge accepts any request/question (English too) with ≥2 words; side talk is still filtered by echo guard + `[[silent]]`. |
| 5,6 | Continuous session (`clavis_continuous`, default ON): awake until a stop phrase or 3 min without an accepted turn. `[[silent]]` in a session is ignored, not slept on. |
| 7 | Native recognizer is preferred whenever it exists (live partials); Groq only without Web Speech, and it now has an RMS endpoint instead of 20 s. |
| 8 | Caption partials are verbatim (capital first letter only); punctuation only on the final line. |
| 10 | Semantic endpointing (`ClavisVoiceState.endpointDelay`): 0.7 s after a finished sentence, 1.3 s neutral, 2.8 s after a dangling word/filler; "wait / ruko / let me finish" holds until "done / bas itna / ab batao / go ahead". Measured from the last partial, not the final. |
| 11 | First streamed sentence is spoken immediately via ClavisVoice; the rest follows as one call. |
| — | Deterministic voice fast path (<300 ms): hush, sleep, silent-for-N-minutes handled before routing. Background-tab confirmation gate for voice actions. Per-turn telemetry + Ctrl+Shift+D panel. |

## States

`SLEEPING → LISTENING → USER_SPEAKING → PROCESSING → (EXECUTING) → ASSISTANT_SPEAKING → LISTENING`;
`SILENT_MODE` (listens, never speaks) and `ERROR` (watchdog recovers) reachable from any
awake state; `SLEEPING` reachable from anywhere. The watchdog also reconciles the state
with reality (asleep ⇒ SLEEPING, nothing speaking for 2 s ⇒ leaves ASSISTANT_SPEAKING,
PROCESSING/EXECUTING > 45 s ⇒ LISTENING) so it can never stick.

## Not verifiable headless

Real Chrome recognizer timing/accuracy, AEC quality during barge-in, Gemini Live
VAD behaviour with the new patience, TTS first-audio on a real network.
