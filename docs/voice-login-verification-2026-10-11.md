# Voice and login verification — 11 October 2026

The existing signed-in orb/calling interface remains in place. The requested login layout keeps authentication on the left, the preview on the right, and a centered headline/subtitle.

## Repairs

- Blank, role-only or malformed upstream streams no longer commit a successful response before a usable answer/tool event. Configured provider/model fallback runs before partial output; the browser does not blindly repeat the complete candidate chain.
- Completed short ElevenLabs PCM clips are reused in tab memory for the same app account and effective voice/model/settings/text. The cache expires after five minutes and stays within eight entries/two MB. Failed, interrupted and partial clips are excluded. Ordinary vault inventory refreshes preserve clips; real credential/account changes invalidate them.
- Usage estimates are scoped to the app account. They remain app estimates/caps, separate from ElevenLabs credits.
- Microphone acquisition now has a 30-second deadline; a pending permission dialog settles startup without automatically opening another paid session, and late permission grants are disposed. Existing network/worklet setup deadlines remain separate.
- An ended microphone track closes the paid socket and clears listening state. Device loss/revoked access asks for an explicit reconnect/retry rather than looping new paid connections.
- Every skill checks cancellation/account ownership before execution and after its safety gate. The brain checks between consecutive tools. Stop/account changes during an email confirmation cannot send after a late approval. Already-issued actions cannot be undone by cancellation.
- An older turn's completion cannot release the newer conversation hold or reset its processing state. Tool acknowledgement timers/counts reset with their owning turn. Repeated deliberate deterministic commands can speak their result again.
- Explicit failed skill results and declined email confirmation remain failures. Empty final narration after a failed tool no longer defaults to a success acknowledgement.
- Public login prefers its local public configuration and a single shared auth initialization. Auth dependencies and saved appearance initialize before workspace stylesheet gates. The auth controller loads asynchronously after its own markup, while the private workspace still waits for a verified non-recovery session and completed workspace initialization.
- Logo handoff waits for the real login stylesheet before measuring its destination. Late async startup and an already-failed stylesheet do not strand the login flow.
- Restored verified identity is reconciled before accepting an already-visible shell. Another account's cached profile/leads/candidates are cleared before its verified metadata and workspace are loaded; stale callback metadata cannot override the current identity.
- The preview uses the existing narrated 1080p master without another synthesis request. Native controls, the wrapper border/shadow and letterbox bands are removed. Volume is 18%; blocked audible autoplay falls back to muted playback until a trusted interaction. Splash/workspace/background/reduced-motion states pause playback; stale play rejections cannot revive it.
- Installer policy now includes the local Supabase SDK and checks the login media/fonts/styles. No installer executable was rebuilt or deployed.

## Evidence

- `node scripts/verify-clavis-voice.js`: all 14 JavaScript suites passed, including task cancellation/late confirmation checks, 18 output regressions and 20 pipeline scenarios.
- `node tests/intent_engine_selftest.js`: information questions, execution permissions and concise voice budgets passed after the task guards changed.
- `node tests/login_bootstrap_selftest.js`, `node tests/login_media_selftest.js`, and `node tests/account_auth_selftest.js`: passed after the final startup scheduling changes.
- Backend `.venv312/Scripts/python.exe -m unittest tests.test_voice_chat_recovery tests.test_elevenlabs_speech tests.test_voice_providers -q`: 29 tests passed. The backend was restarted after the AI repair.
- Installer contents policy: 19 sensitive paths excluded and 30 required paths included. Focused syntax and whitespace checks passed.
- Earlier signed-in browser checks produced two typed Groq replies and successful ElevenLabs PCM responses. Those checks exposed the vault-refresh cache miss, which was subsequently repaired and covered with the real vault module in the output regression. A final live cache-repeat check remains unverified because browser/computer control became unavailable.
- Narrated MP4 has its `moov` metadata before media data; its local HTTP range request returned 206 with the expected bytes/content type.

## Remaining verification/material

The user supplied the narrated MP4 and confirmed they do not know its editable Claude project. The app uses the same full-HD video/audio streams in a fast-start container. The recorded soft shadows and background differences remain inside those pixels; page CSS removes the player/wrapper shadows but cannot recover editable layers. Removing the recorded shadows without harming text requires recreating the film. Physical microphone quality, final cold-refresh timing, a fresh live cache repeat and PSTN calls are not claimed verified. Computer control timed out during final verification. No PSTN calls were made.

Realtime Scribe parameter/event compatibility was checked against the [official ElevenLabs API reference](https://elevenlabs.io/docs/api-reference/speech-to-text/v-1-speech-to-text-realtime). No new premium transcription options were enabled.

The pre-final screenshot at `work/login-design-proof/final-fast-login.png` documents the requested visual layout. The subsequent changes affect startup scheduling, not that layout.
