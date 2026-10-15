# Rudra24 developer control — implementation and activation

The existing `#developer` surface now includes Users, Shared providers and Releases. Owner permission requires verified Supabase Google identity and the server allowlist for `vishalsharma190405@gmail.com`; changing a browser profile/email cannot grant access.

## Using the panel

1. Sign in with the owner Google account and open Developer → Users.
2. Open a user workspace. Grant trial/manual access or let a verified Razorpay payment activate paid services. Set expiry, feature switches and daily/monthly quotas. Block or revoke sessions when needed.
3. In Shared providers, save Groq, ElevenLabs or Apify credentials into the encrypted server vault, enable the provider and set a request ceiling. An optional INR reservation ceiling requires a conservative maximum INR per request. These are owner-configured reservations, not a reconciled provider bill.
4. In the user's Setup area select shared, individual or disabled. Individual secrets remain tenant-scoped. A disconnected individual key never silently switches to a shared key.
5. Review usage/audit, last synced app data and available ElevenLabs call records. User acknowledgement is required before content views. Data still offline on a user's device cannot appear before sync.
6. Create a tested release from signed artifact metadata, publish to the owner cohort and promote through 5%, 25% and 100%. Pause/resume and rollback are available. Desktop UI changes are staged for the next launch; active work is never automatically reloaded.

## Server activation

- Deploy the updated FastAPI application against the existing configured PostgreSQL database. Back up first, then apply `backend/migrations/20261013_developer_control.sql`, `20261013_payment_receipts.sql` and `20261015_voice_allowances.sql` using the backend's actual search path. These migrations were generated locally and have not been applied to production.
- Set `CLAVIS_MANAGED_ACCESS=true`, `DEVELOPER_EMAILS`, the existing Supabase authentication settings, stable `CREDENTIAL_MASTER_KEY`, Razorpay key/webhook settings and `CLAVIS_RELEASE_HOSTS`. Keep all secrets server-side. The control tables are not directly granted to browser users.
- The root hosted web gateway now reads `RUDRA_BACKEND_URL` rather than a placeholder rewrite. Configure the same HTTPS backend for the desktop installer, root hosted app and mobile app; no destination was invented or silently deployed. The proxy forwards authorization and streams responses; private API data is not cached.
- Owner synced-content reads require server-only Supabase service credentials and the existing `clavis_user_data` table. Clients keep their original own-row RLS policies. Owner reads go through the audited backend.
- Reconcile any historical payment IDs overwritten by the former subscription schema before production; the migration and runtime protect the latest legacy payment and all newly recorded receipts.

## Updates and devices

See `docs/superpowers/update-delivery-report.md` for the signed manifest and release build commands. A baseline installer must embed the trusted public verification key, exact HTTPS artifact hosts, backend and public auth URL. Private signing keys stay in release CI. Native NSIS updates additionally require the configured signing publisher and native update feed. No trust key, certificate, paid service or live deployment was provisioned automatically.

Desktop sends only RAM/CPU hints through a narrow preload method. Browser Auto chooses lite when RAM is unknown or constrained and measures frame responsiveness with recovery hysteresis. Lite reduces graphics resolution/expensive blur while full preserves richer effects. Composer metrics reuse one sizing owner and detached mirrors/observers are cleaned up. Saved and live Jarvis message rendering is bounded to 80/120 rows with navigation to persisted earlier messages; lead lists retain their existing paging. Android native screens already use lazy lists.

PWA and Android source now share the control endpoint, acknowledgement and coarse device heartbeat with the owner panel. Android native changes need a rebuilt, signed APK/store release. The Android debug build passed locally on 2026-10-14 using JDK 17, Gradle 8.11.1 and Android SDK 35; on-device behavior and production signing remain unverified.

## Evidence and limits

- Root JS verification, updater fixtures, adaptive-performance fixtures, composer sizing, secret-free vault responses and installer-content checks are run locally.
- Control API integration uses isolated file-backed SQLite with real dependencies: owner identity, tenant isolation, disclosure, block/revoke, monthly concurrency, paid call-period concurrency, exactly-once usage/refunds, shared budget and staged releases.
- Billing fixtures exercise authoritative buyer/amount/currency/status binding, callback/webhook replay and races, failed attempts, refunds, legacy receipts and manual expiry. Login and ElevenLabs voice/calling regressions run separately.
- Isolated Chrome browser checks exercise shipped owner-control scripts, acknowledgement, safe text rendering, remote limit writes, usage/provider/release views, narrow mobile viewport and logout cleanup. These use mocked provider/auth services and are not proof of the live owner-to-customer flow.
- The raw account-data snapshot is stored as one bounded JSON row; content responses are paginated but the backend reads the selected user's snapshot. It does not load every user's content. Large-scale normalization remains a separate optimization.
- Realtime policy invalidation uses private bearer-authorized SSE with reconnect/backoff, not an unauthenticated Supabase broadcast. Expiry/block enforcement runs independently on backend admission. Active app streams recheck access; already-issued vendor realtime tokens/connections can only expire or be terminated by that provider. Queued local work is paused/cancelled; remote batch cancellation is attempted and audited, and uncertain cancellation requires provider-history review.
- No real 4 GB/8 GB performance measurements, live Razorpay/PSTN calls, PostgreSQL stress run, signed customer installation, production PWA rollout or live provider-bill reconciliation is claimed. Real devices must meet the approved p95 targets before a broad release.

## Final local verification record

- Root gate: `node scripts/run-all-checks.js` — all 29 suites passed; 157 root scripts parsed.
- Control API: 10 integration tests passed, including concurrent paid call ceilings and retry/refund identity.
- Login: 6 tests passed. ElevenLabs speech: 12 tests passed. ElevenLabs calling: 29 tests passed. Together with control tests, 57 backend tests passed; billing fixtures are additional.
- Standalone billing control fixtures passed, including both channels, concurrent renewal/replay and delayed failed attempts.
- Chrome owner-panel fixture passed; mobile contract/PKCE, adaptive graphics, composer and updater tests passed.
- Strict installer check passed: 19 secret paths excluded and 30 required files present.
- Web snapshot 1.0.7 was generated locally: 286 files, approximately 53 MiB. It is a static release candidate, not a deployed website. Any further changes to root assets require rebuilding `web-assets.json` before deployment.

## 2026-10-14 verified baseline

- Windows NSIS installer `release/Rudra24-AI-Setup-1.0.8.exe` was built locally (135,379,787 bytes). Actual `app.asar` passed the strict archive inspection and matched the source at build time. The later Dad portable-launcher/proxy corrections belong to the separate corrected ZIP and are not claimed in this earlier installer.
- Authenticode status is `NotSigned`. This is a first-run connection build with no preconfigured cloud backend and no production update trust. It must not be advertised as a signed production rollout.
- Latest frontend gate passed all 30 suites. Control integration passed 12 tests. Chrome owner-panel, cloud account-switch/new-edit isolation, auth/sync and desktop runtime checks passed.
- Web snapshot is now 1.0.8. Review fixes preserve device connection configuration, reject late account data, preserve edits made during cloud reads, report sync state and reflect disabled shared providers correctly.
- The approved Dad ZIP is a separate portable local package with explicitly approved existing family provider access. It is not the production installer or update feed.
- Android `Build-Android.ps1` debug build passed all 35 tasks without source changes. `Rudra24Mobile/android/app/build/outputs/apk/debug/app-debug.apk` is 9,450,217 bytes; APK v2 signature verification passed. Package `ai.rudra24.mobile` is version 1.2.0/code 3, requires Android 8+ and targets SDK 35. SHA-256: `16951109c4da4267021a9f51c9cbbd8eb112f295c10ff23e520bb09f4e5cfd82`. This is a debuggable local build, not a production release or device test.

## 2026-10-15 remaining-work verification

- Owner quotas now include TTS characters, submitted uploaded-audio seconds rounded up, and issued realtime/agent-preview sessions. Existing daily/monthly atomic admission applies to shared and individual assignments. Voice feature disablement also gates these meters. Existing plan prices are unchanged.
- Confirmed provider rejection refunds a reservation exactly once and records a failed attempt. Timeout, cancellation and interrupted audio retain an `unknown` reservation. Groq-reported transcription seconds are a separate `provider_reported` measure, not the submitted-seconds allowance. A signed provider token/preview URL does not give this server a hard duration ceiling on that vendor connection; the panel and responses disclose that boundary.
- Default daily voice ceilings are 50,000 submitted TTS characters, 3,600 uploaded-audio seconds and 100 session tokens, editable by the owner. Existing local/family testing mode continues to count usage without enforcing paid-plan caps. Production requires managed access and the additive voice-allowance migration above.
- `tests.test_voice_quotas`, control and login: 26 tests passed. Voice quotas, login and ElevenLabs calling: 43 tests passed. Existing ElevenLabs speech checks also passed in the preceding 37-test control/voice/login/speech run. Fixtures use isolated databases and mocked providers; no paid speech or phone call was made.
- Full frontend gate passed all 31 suites. Real Chrome owner-panel checks verified the new daily/monthly voice fields; Chrome Setup checks verified Groq/ElevenLabs/Apify save/error behavior. Web snapshot 1.0.8 was regenerated for the panel changes.
- The final Dad archive contains matching current source, both runtimes, included SQL migrations, unchanged explicitly approved family credentials and no user database. SHA-256: `bd3b809bc1a7f12b932194911035106bce8dd4fa1150e50f5d779a7e38902fec`; 274,650,126 bytes. Cold-launch evidence is recorded in `docs/api-key-fix-2026-10-14.md` after the final extracted-package gate.
