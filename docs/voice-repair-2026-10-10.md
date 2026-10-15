# Rudra voice repair — 10 October 2026

Latest user direction: restore the original UI and retain voice engine repairs only. The inline transcript, campaign workspace, renamed navigation and added cap fields have been rolled back. Jarvis again uses its original centered orb and floating task surface. Calling pages use their previous studio layout. Voice input/output, retry, cancellation, duplicate-request ownership and backend safety fixes remain. The current voice verification runs 13 JavaScript suites and passes after this rollback. A reversible copy of the removed UI work is under `work/voice-ui-before-restore`; the earlier follow-up section below describes the superseded UI work.

The existing Vanilla JS voice interface now uses ElevenLabs Scribe input and ElevenLabs voice output with Groq as the language model. Existing auth, tenant credentials, routes and task execution remain in place. Two agents audited input and output, implemented regressions, and reviewed each other's changes; the root agent reviewed and repaired the chat/UI integration.

## Problems repaired

- The backend deduplicated fallback candidates by provider, skipping the second Groq model after the first reached its limit. Candidates now use provider + model and reserve app allowance once per turn.
- Tool-only JSON replies were rejected as empty. They now reach the execution caller; provider retry timing also reaches the UI.
- A temporary AI rate error permanently switched off microphone capability. Automatic cloud input now pauses with bounded local backoff; an explicit mic retry clears that pause. Quota/auth problems do not trigger repeated paid speech connections.
- Pending microphone, authentication, worklet and playback setup could outlive Stop/mute/account/route changes. Generation guards, deadlines, cleanup and stream ownership now cover those paths.
- Sleeping during a busy turn could reopen paid listening after the turn finished. Sleep remains authoritative; continuous mode has a consistent explicit setting.
- Long voice replies, malformed PCM, stale drain events, delayed setup/read responses and missing playback completion could truncate or falsely succeed. Streaming output now bounds chunks, validates audio, cancels stale work and requires completion.
- Preview now requests the selected provider explicitly. Muted or failed voice responses reveal their written answer. First-audio timing uses actual playback rather than a pending synthesis request.
- Account models and voice permissions now repair stale selections and show scope failures. Supported model settings and neutral Hindi wording are preserved.
- Local app caps were described as provider quota and could fail silently when a reply exceeded the remaining allowance. The source is now explicit; caps and estimated usage are available under Settings → Voice → Advanced. Active listening enforces its remaining time, including cap changes and delayed browser timers.

## Validation

- `node scripts/verify-clavis-voice.js`: contract checks and 15 focused JavaScript suites passed, including 12 output regressions, 20 pipeline scenarios, inline replies, calling workspace, campaign dispatch and studio lifecycle.
- Final input, shared microphone, voice state and local-budget suites passed again after active-session cap enforcement.
- From `backend`: `.venv312/Scripts/python.exe -m unittest tests.test_voice_chat_recovery tests.test_voice_providers tests.test_elevenlabs_speech tests.test_elevenlabs_calling -q` — 42 tests passed.
- ElevenLabs studio lifecycle, task surface, visible-state, sign-in voice release, JavaScript syntax and focused whitespace checks passed.
- Local backend was restarted to load the new code. Frontend voice scripts have new cache revisions.

## Live verification still required

These are code and local service checks, not proof of physical microphone quality, live provider audio, latency, or real phone calls. Chrome control disconnected before authenticated microphone/playback testing. The local vault contains multiple voice workspaces, so an automatic live provider probe was skipped to avoid choosing another workspace's account. No PSTN calls were made.

On the signed-in Rudra tab, reload, turn on Voice Replies, use Hear a sample, then test one spoken Hindi/Hinglish question, interruption, Stop, mic off/on and a simple reversible app navigation command. Provider account quotas and key permissions remain provider-controlled. App local caps are separately adjustable; increasing a local cap does not increase provider credits.

Official compatibility references: [ElevenLabs realtime commits](https://elevenlabs.io/docs/eleven-api/guides/how-to/speech-to-text/realtime/transcripts-and-commit-strategies), [ElevenLabs streaming output](https://elevenlabs.io/docs/api-reference/text-to-speech/stream), [ElevenLabs model settings](https://elevenlabs.io/docs/eleven-creative/playground/text-to-speech), [Groq rate limits](https://console.groq.com/docs/rate-limits).

## Calling and floating reply follow-up

- `#voice-ai` now keeps agent setup, knowledge, tools and browser testing. `#calling` has a separate operational workspace: exact-area lead sourcing through the existing engine, saved/selected contacts, reviewed queue, batch controls and conversation review.
- Lead import/search never dials. Explicit confirmed batches run sequentially, up to 100 selected contacts. Pause/Stop blocks the next dispatch and continues tracking an accepted call; it does not claim to hang up a phone call.
- Per-account queues persist attempts before dispatch. Modern browser locks and lock-time saved-state reconciliation prevent another tab from redialling stale pending contacts. Reload never automatically resumes.
- Uncertain responses block further dispatch. Matching terminal provider history can be verified against agent, destination and start time. A user can instead explicitly confirm history review and skip the contact; this never marks an uncertain call successful or automatically redials it. Demo calls stay separate from the queue.
- Foreign individual phone/conversation resources are hidden without breaking a list refresh. Whole provider-account ownership remains protected; a clear conflict message directs the user to the original app account or a separate provider account. No ownership rows or credentials were reassigned.
- Ordinary typed and voice conversations stream inline in the existing chat. Muting/audio failure does not select a floating task window. Explicit window requests, approvals and useful structured task/data results retain the task surface. Exact task ownership removes duplicate completion/metrics.
- Browser inspection confirmed distinct calling and setup surfaces in the actual local app. The original setup-navigation hash mismatch was also repaired. After the backend restart, authenticated status and phones requests still returned the protected whole-account ownership conflict. A different ElevenLabs email from the Rudra email is supported; this conflict concerns a previous Rudra account binding. No ownership was transferred and no real lead phone calls were placed.
- Two legacy stylesheets permanently hid the transcript even after reply generation succeeded. Their hiding now applies only to the empty stage. Delayed fact initialization no longer clears replies or opened history; returning to the page does not stack Enter handlers. Opened history scrolls to the latest reply. These defects were found through live browser verification after the first mocked checks passed.
- Live Groq responses to `Hear me?` were generated, then verified inline through the saved conversation after the layout fixes. Proof: `work/voice-repair-proof/inline-chat.png`. Voice Replies was restored to its initial ON setting after the muted presentation check. Physical spoken input and provider audio remain unverified.
- One rerun hit a scheduling-sensitive 50 ms routing assertion at 87 ms. The complete unchanged suite passed on the next run; this is not a hardware latency guarantee.
- [ElevenLabs conversation states](https://elevenlabs.io/docs/eleven-agents/api-reference/conversations/get) are checked during sequential tracking; `processing` is kept unresolved until `done` or `failed`.

The browser queue runs while its tab is open. Long-running unattended campaigns need a server worker; this change preserves the current browser architecture.
