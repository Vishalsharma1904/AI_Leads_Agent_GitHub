# ElevenLabs voice implementation plan

> Agentic workers: use the parallel-agent workflow for independent file scopes, then integrate and review in this session.

**Goal:** Make ElevenLabs the usable primary calling and Rudra speech provider while fixing voice lifecycle and repetition.

**Architecture:** Add tenant-secured provider adapters to the existing FastAPI backend. Preserve Vanilla JS controls and AudioWorklet playback; use persistent Scribe input and the existing Groq streamed brain.

**Tech Stack:** Vanilla JS, FastAPI, httpx, WebSocket, AudioWorklet, existing native select.

**Spec:** `docs/superpowers/specs/2026-10-07-elevenlabs-voice-design.md`

## Global constraints

- No framework migration; preserve auth, APIs, orb and current visual identity.
- ElevenLabs credentials remain encrypted in the tenant vault; browser gets a single-use STT token or a signed conversation URL.
- Groq is the LLM, ElevenLabs is primary STT/TTS; Cartesia and Groq Whisper are retained fallbacks.
- No paid provider request or real outbound call during implementation without a test-specific request.
- Claims distinguish mocked/browser verification from live microphone/PSTN proof.

## Review focus

- Stale committed transcripts after stop/account change never send a new turn.
- Interruption cancels queued speech and prevents the full answer replay.
- Explicit provider choice and partial-output fallback cannot change voices mid-answer.
- Cross-tenant agent/conversation/number IDs cannot access another tenant's resources.
- Permission, quota and missing number errors keep a stable actionable UI.

## Tasks

- [x] Backend speech: vault provider registration; `POST /api/speech/elevenlabs-token`; provider metadata; ElevenLabs PCM streaming on `/api/tts`; Groq-only transcription fallback; mocked request/security/error tests.
- [x] Calling studio: `/api/v1/elevenlabs` router and `elevenlabs-studio.js`/CSS; documented agent/tool/knowledge/number/conversation operations; secure live browser protocol test with mocked audio; tests and source notes.
- [x] Rudra input/brain: `clavis-elevenlabs-stt.js`, `jarvis_ui.js`, `jarvis.js`; persistent microphone lifecycle, barge-in/stale-turn tests, bounded responsive Groq reasoning and repetition repair.
- [x] Integration/output: `clavis-voice.js`, `clavis-setup.js`, `index.html`; ElevenLabs first, native minimal settings, remove active Gemini/Fish speech choices; connect routers and assets; cancellation/fallback verification.
- [x] Verification: targeted JS/Python tests, syntax, production-asset browser checks with offline fixture; record key/phone/live-test limitations and exact setup steps in `docs/elevenlabs-verification.md`.
