# Desktop service connection and voice repair — 15 October 2026

The supported customer route is the existing Electron installer plus a hosted FastAPI service. Customers install once and open the desktop shortcut. Packaged mode never installs Python or runs a BAT/PowerShell backend. The source/approved family portable launcher remains a separate local testing route.

## Hostinger shared hosting

Hostinger shared/WordPress hosting can serve the existing website and a tiny public connection JSON. It cannot run this Python/FastAPI service. Run the existing `backend/Dockerfile` on an always-on HTTPS container/VPS service; no new Node/PHP backend is needed. No hosting purchase or deployment was performed for this change.

Keep account, vault, subscription and usage state in the configured PostgreSQL/Supabase database. Keep shared hosting limited to public website/assets/configuration; never upload the backend `.env`, encrypted private family bundle or user database into `public_html`. Existing user sync and local caches are retained. This change does not erase or relocate existing data.

Deployment order:

1. Deploy the existing backend container. Use `backend/.env.example` and `docs/developer-control-2026-10-13.md` for managed access, authentication, database migrations and vault setup. Back up before migrations. Preserve the existing credential master key when restoring an existing vault. Set the exact API hostname in `ALLOWED_HOSTS`, HTTPS public base URL and desktop origins in `CORS_ORIGINS`. Allow `http://localhost:3210/` as a Supabase auth redirect. The backend already serves `/api/public-config`.
2. Verify `GET /health` returns `status: healthy` and `services.db: ok`; verify `/api/public-config` contains the correct public Supabase URL and publishable key. Authenticated provider setup and account operations still require their live acceptance checks.
3. On Hostinger publish `rudra24-service.json` with the following shape, replacing the example with the verified API URL. This file contains no provider keys or user data. Serve it over HTTPS without redirection, as JSON; prefer `Cache-Control: no-cache`.

```json
{"schema":1,"backendUrl":"https://api.example.org"}
```

4. Build a connected customer installer using the actual public JSON URL:

```powershell
$env:CLAVIS_SERVICE_CONFIG_URL = 'https://YOUR-WEBSITE/rudra24-service.json'
npm run dist:customer
```

Alternatively supply both `CLAVIS_BACKEND_URL` and `CLAVIS_SUPABASE_URL` when building. `dist:customer` refuses a build with neither route configured. `dist:win` permits a setup-only owner review build; it must not be described as an activated customer release.

First launch discovers the configured service, checks API/database/sign-in setup, and saves the validated connection atomically. Normal users see retry/open-workspace controls; manual server entry is inside closed administrator settings. An existing saved connection opens cached UI immediately when offline. Published JSON cannot silently move an existing installation to another workspace. Explicit server changes still require confirmation because they clear local drafts/session/cache.

Signed native updates and signed UI releases still require the existing update trust configuration and production signing credentials. Hostinger JSON is connection data, not an executable update feed.

## Fixes and evidence

- Packaging root cause: the local server requires three API modules and two JSON dependencies which were missing from the old installer file list. All five are now explicitly packaged and part of the mandatory archive check. Earlier 1.0.8 archive checks covered fewer dependencies and did not establish working startup.
- Hindi root cause: an English default voice, Roman-only speech prompting and missing native-script normalization on the ElevenLabs path. Auto voice selection now ranks Hindi-native/Indian-accent account voices above multilingual support alone; manual/custom choices remain explicit. Voice replies use Hindi script for Hindi words and retain English/names. Existing Roman Hindi tokens are normalized locally. No paid transliteration service was added.
- Account voice metadata refresh no longer fabricates user change events or overwrites selected voices. Settings persist immediately into the active account's preference record. Account switches clear provider metadata. Keep-original grammar remains supported.
- Preview root cause: the caption sat inside the compact orb's fixed-height rail and could not receive scroll events. It now has a separate bounded, scrollable area with keyboard access and the existing colors/type/visual system. No theme redesign was introduced.
- Real Chrome preview verification: four viewport sizes, both themes, full app styles, long Hindi caption, no clipping and keyboard access to the last lines (`node tests/voice_preview_browser.js`).
- Real Chrome connection verification: desktop/small widths, friendly retry, closed advanced settings, failed/manual recovery and opening a saved workspace (`node tests/desktop_setup_browser.js`). The Electron bridge is simulated; native authorization and persistence are separately checked by `tests/desktop_runtime_selftest.js` and `tests/desktop_discovery_selftest.js`.
- Provider evidence: the owner's real ElevenLabs account returned 22 voices, including one Indian-accent candidate. A single 103-character Hindi sample through the actual backend produced a 24 kHz mono WAV (309,892 bytes; 6.46 seconds) using account credits. This proves synthesis and valid output, not physical microphone quality, a PSTN call or a human pronunciation assessment. File: `tests/artifacts/voice-preview/hindi-owner-sample.wav`.

The current 1.0.9 build is an unsigned owner review build with no live backend/connection URL embedded. No production database migration, customer activation, live payment, broad rollout or physical 4 GB/8 GB performance result is claimed. The older Dad ZIP does not contain these later voice/desktop changes.

Final verification: 32 frontend suites and 157 root script syntax checks passed; 20 speech-output checks and 26 backend speech/quota/login tests passed. The actual 1.0.9 archive passed the 35-required-file check and isolated runtime startup/HTTP smoke check, with exact source parity for the changed voice, UI and desktop entry points. The native interrupted-public-config case also passed: it shows a recoverable message and saves no incomplete connection. The customer build guard correctly refused an unconfigured release.

Review artifact: `release/Rudra24-AI-Setup-1.0.9.exe`, 135,397,559 bytes; Authenticode status `NotSigned`; SHA-256 `7dd2ab3765c6ae6d25b870abf6967d84dd3c8bc374342447353ce39eb6f56ebc`. This is not an activated customer installer.

Live hosting inspection on 15 October: Render was signed in as `vishalsharma190405@gmail.com`; its workspace selector listed only My Workspace, and Overview showed zero services. Hostinger redirected to its login screen, so account-level VPS availability could not be verified there. The user confirmed shared/WordPress hosting. No service, paid plan, new database or credentials were created or uploaded. A backend URL was not invented.

References: [Hostinger supported runtimes](https://www.hostinger.com/support/which-programming-languages-and-frameworks-are-supported-at-hostinger/), [ElevenLabs accent/language guidance](https://elevenlabs.io/docs/help-center/troubleshooting/why-does-my-voice-change-accent-or-language).
