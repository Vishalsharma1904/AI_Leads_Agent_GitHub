# Rudra24 AI — current handoff

Continue this existing application; do not replace the Vanilla JS interface or remove working voice, account isolation or provider setup.

- Latest repair: `docs/voice-assistant-repair-2026-10-15.md`. Shared lead parsing now handles English “fetch me” and spoken counts; explicit searches use defaults without a mandatory industry picker. Native Jarvis tool calls execute with standard result envelopes and input validation. Selected conversation restoration, streamed voice statistics and live Hindi/provider selection are repaired. Voice startup/reconnect/Stop paths discard stale asynchronous work; web reads carry account authorization. Review the report's live activation blockers before describing the app as deployed or working on another laptop.

- Root app: `index.html`, `app.js`, `auth-antigravity.js`, `supabase-auth.js`; Electron desktop in `electron/`; separate mobile product in `Rudra24Mobile/`.
- Current voice stack prioritizes ElevenLabs STT/TTS/realtime and Groq intelligence. Trace `clavis-live.js`, `clavis-voice.js`, `clavis-elevenlabs-stt.js` and `backend/api/elevenlabs.py` before changing routing. The older overview in `AGENTS.md` predates these changes.
- Authentication is Supabase, not the old local-password mechanism. Desktop Google sign-in opens the default browser's account chooser. The loopback server hands a one-use code back to the app; Supabase exchanges it using the app's PKCE verifier. No email hint filters the account chooser.
- Keep `http://localhost:3210/` in the Supabase redirect allowlist. Web/PWA sign-in keeps its normal browser redirect. Static hosting can use `public-auth-config.json` if the public-config API is absent; only public Supabase settings belong there.
- Frontend account labels come from the verified session. Owner permissions, subscriptions, quotas, provider assignments and encrypted credentials are enforced by FastAPI; editable local profiles do not grant admin access.
- Real read-only checks confirmed the current Supabase project is reachable, Google is enabled, and authorize redirects to `accounts.google.com` with `select_account` and S256 PKCE. This does not establish that a person completed consent/login on a physical installed app.
- The hosted HTTPS FastAPI backend is still a deployment prerequisite. Hostinger shared/WordPress hosting serves static files/public connection JSON, not this Python container. Use the existing Supabase database and preserve its credential master key. Do not provision another database or reset the vault key casually.
- Review `docs/backend-audit-2026-10-15.md`, `docs/desktop-hosting-2026-10-15.md` and `docs/developer-control-2026-10-13.md` for exact completed checks and remaining deployment/signing/device acceptance work. Older installer/ZIP artifacts do not contain the latest source fixes.
- Private `.env`, family provider bundle, user databases, local runtimes, exports and old backups stay local/gitignored. They are intentionally absent from GitHub. Configure secrets privately in the deployment environment; do not paste them into source or prompts.

Useful checks:

```text
node scripts/run-all-checks.js
node tests/account_auth_selftest.js
node tests/login_bootstrap_selftest.js
node tests/login_voice_release_selftest.js
node tests/desktop_runtime_selftest.js
python backend/scripts/check_backend.py
```

The backend runner uses isolated databases/processes and blocks external provider connections. Live microphone, payment, PSTN, 4 GB/8 GB performance and production rollback acceptance require their own real verification; do not infer them from mocked tests.
