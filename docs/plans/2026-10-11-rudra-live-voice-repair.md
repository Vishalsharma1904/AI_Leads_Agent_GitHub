---
title: Rudra live voice reliability repair
date: 2026-10-11
type: fix
artifact_contract: ce-unified-plan/v1
artifact_readiness: implementation-ready
product_contract_source: ce-plan-bootstrap
execution: code
---

# Rudra live voice reliability repair

## Goal Capsule

Objective: A user can ask consecutive questions in Rudra AI, see what it hears, and receive a spoken answer without repeatedly restarting the microphone.
Means: Repair the existing ElevenLabs Scribe / Groq / ElevenLabs streaming path (KTD1).
Authority: The user's request and repository instructions govern scope; retain existing changes and the original interface. Implementation and verification continue in this session under the user's explicit instruction to fix the app.
Stop conditions: Account sign-in or physical microphone access may limit live verification; report the exact limit and complete independent repairs. No production deployment or outbound calling is part of this work.

## Product Contract

### Summary

Keep the conversation listening between turns, recover from transient input failures, and reliably reveal live/final captions in the existing Rudra AI tab.

### Problem Frame

The user reports delayed replies, listening stopping after one or two turns, and intermittent transcript previews despite connecting Groq and ElevenLabs. Existing offline checks do not establish physical microphone performance.
Current research found a 9-second default follow-up, a separate 45-second sleep timer overriding continuous mode, incomplete classification of recoverable Scribe errors, and a hidden caption class retained on final-only transcripts.

### Requirements

- R1: Consecutive spoken questions and short follow-ups should work in a live conversation; explicit mute, sleep, route/account changes and local budget limits remain authoritative.
- R2: Show the changing partial transcript and final transcript, including segments delivered without a partial.
- R3: Recover from transient provider/network errors with bounded retries; expose credential, permission and quota errors without repeatedly opening paid sessions.
- R4: Preserve Groq LLM, ElevenLabs input/output, existing auth, tools, cancellation and the original Vanilla JS interface.
- R5: Test repeat turns, silence, interruption, recovery and cancellation; separate simulated checks from signed-in provider and physical microphone evidence.

## Planning Contract

### Key Technical Decisions

- KTD1: Reuse the existing Scribe socket, tenant token endpoint, Groq stream, PCM player and regression harnesses. A provider migration would not fix the demonstrated lifecycle/visibility defects (R4).
- KTD2: Make continuous voice the default while retaining an explicit stored opt-out and bounded inactivity timeout. Its separate check-in timer must not override the selected conversation duration (R1).
- KTD3: Fix caption visibility in the shared caption renderer; make final-only segments remove the same hidden state as live partials (R2).
- KTD4: Treat activity/transport errors as recoverable, retaining auth/quota guards and bounded retries. Silence audio continues through normal thinking/playback; no invented heartbeat replaces microphone capture (R3).
- KTD5: Only make additional latency changes supported by the traced path; retain VAD patience, hidden-reasoning exclusion, streaming and account/cancellation guards (R4).

### Assumptions

The intended live session can sleep after the existing three-minute inactivity period; the user can change the existing setting. Actual microphone/device and provider allowance remain execution-time facts.

## Implementation Units

### U1. Listening lifecycle and recovery

Files: `clavis-wake.js`, `clavis-voice-state.js`, `clavis-elevenlabs-stt.js`, `jarvis_ui.js`.
Covers R1/R3/R4; follows KTD1/KTD2/KTD4.
Use the existing wake clock, mic owner and retry state. Characterize real timer callbacks, not only advancing a clock with timers stubbed away.
Tests: `tests/voice_state_selftest.js`, `tests/elevenlabs_input_selftest.js`, `tests/voice_ui_recovery_selftest.js`.
Scenarios: live session survives 45 seconds; expires at configured idle duration; short mode and typed turns remain bounded; explicit sleep is never revived by old work; activity/queue/session errors recover; auth/quota errors do not loop; microphone stop and late grants retain cleanup.

### U2. Captions and conversational interruption

Files: `clavis-ear.js`, `jarvis_ui.js`.
Covers R1/R2/R4; follows KTD1/KTD3. Independent of U1 except continuous-mode semantics.
Tests: `tests/realtime_voice_pipeline_test.js`, `tests/voice_single_reply_selftest.js`.
Scenarios: clear then committed-only transcript becomes visible; final caption receives its current placement; natural immediate short follow-up is accepted in a live session; actual output echo remains rejected; one accepted segment produces one reply; cancellation keeps the next turn alive.

### U3. Latency and integration verification

Files: inspect `jarvis.js`, `clavis-voice.js`, `backend/api/ai_chat.py` and their existing tests; edit only demonstrated defects. Refresh changed script cache revisions in `index.html`.
Covers R4/R5; depends on U1/U2. Follow KTD5.
Tests: existing voice verification script, targeted backend voice tests when backend code changes, and signed-in browser checks.
Scenarios: repeated questions, 20-second silence, reply/interruption, mute/unmute, route exit, network failure, first visible response and first played audio. Record the actual browser, provider responses and hardware limitations.

## Verification Contract

Run `scripts/verify-clavis-voice.js` after targeted regressions, syntax-check edited JavaScript and review the scoped diff. Use existing backend unittest checks if backend changes. Validate visible browser behavior on the running local app after reload and sign-in. A simulated transcript or successful typed response must not be described as physical spoken-input proof.

## Definition of Done

The demonstrated lifecycle, recovery and caption defects are repaired, regression checks pass, changed scripts are served with refreshed revisions, and live verification results or the precise remaining access/device limitation are recorded. No guarantee of zero bugs or Gemini-equivalent hardware/network latency is inferred from unit tests.

## Sources and Research

- Current flow: `clavis-elevenlabs-stt.js`, `jarvis_ui.js`, `clavis-wake.js`, `clavis-ear.js`; prior local verification notes: `docs/voice-repair-2026-10-10.md`, `docs/voice-login-verification-2026-10-11.md`.
- [ElevenLabs commit/keepalive contract](https://elevenlabs.io/docs/eleven-api/guides/how-to/speech-to-text/realtime/transcripts-and-commit-strategies): audio must continue, timestamp events are metadata, and VAD is appropriate for live microphone input.
- [ElevenLabs errors](https://elevenlabs.io/docs/eleven-api/guides/how-to/speech-to-text/realtime/event-reference): distinguish activity/queue failures from auth/quota problems.
- [Groq reasoning](https://console.groq.com/docs/reasoning): retain low reasoning effort and reasoning exclusion for interactive replies.

Planning confidence: high for the reproduced code defects; physical microphone/provider latency remains unverified. ce-doc-review did not run: no skill-invocation tool is exposed by this host. A scoped evidence review is retained above; implementation proceeds because the user explicitly requested it.
