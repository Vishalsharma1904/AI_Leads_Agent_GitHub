# Rudra24 AI Windows desktop release

The customer installs `Rudra24 AI Setup*.exe` and opens Rudra24 AI from the Start menu
or desktop shortcut. Electron includes its own Node runtime. The local UI server
and PC Bridge start inside the app and close with it. The customer does not run
Node.js, Python, PowerShell, or a `.bat` file.

## Cloud layout

- Supabase hosts authentication and PostgreSQL data.
- The existing FastAPI app runs as a long-lived Docker service on a Python
  container host. Supabase Edge Functions use Deno, so they cannot run this
  FastAPI/Playwright/Kokoro application unchanged.
- The desktop UI calls the FastAPI service through a public HTTPS URL. Keep
  `backend/.env`, database credentials, service-role keys, and provider keys
  on that server only. The installer contains only public backend/Supabase URLs.
- PC Bridge remains local to each customer's machine. The desktop window starts
  it automatically; mouse/keyboard and file control remain disabled by default.

## Server release

1. Create the Supabase project, apply the SQL migrations in `backend/migrations`,
   and get its PostgreSQL connection URL and Auth publishable key.
2. Deploy `backend/Dockerfile` on a container host with HTTPS and WebSocket
   support (the included `render.yaml` is a starting Blueprint). Set
   `APP_ENV=production`, `DATABASE_URL` (Supabase PostgreSQL),
   `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_JWKS_URL`,
   `CREDENTIAL_MASTER_KEY`, and any provider keys in host secret settings.
   Keep `CREDENTIAL_MASTER_KEY` a stable secret of at least 32 characters across
   deployments: changing it makes existing saved API keys unreadable.
   Set `CORS_ORIGINS=http://localhost:3000,http://localhost:3210` and
   `ALLOWED_HOSTS` to the API hostname. Set
   `CLAVIS_WARM_KOKORO=false` (now the default). Cloud Groq/Cartesia voice
   keeps its shared ONNX speech gate, without local Kokoro/PyTorch models.
   Legacy Exotel local synthesis requires the full local requirements.
3. Verify `https://YOUR-API/health` reports API, database, and lead browser
   ready. Configure Supabase Auth redirect allow-list for
   `http://localhost:3210/**` for desktop (and `http://localhost:3000/**`
   for browser mode) if Google sign-in is enabled.

## Windows installer

On the build machine only, install Node.js, run `npm ci`, then:

```powershell
npm run dist:win
```

This makes `release/Rudra24-AI-Setup-1.0.5.exe` with first-run connection
setup. The assisted installer includes the app runtime, desktop and Start menu
shortcuts; recipients need no administrator, Python/Node installation or BAT.
The owner must deploy the authenticated backend before recipients can use
AI/leads. Enter its public HTTPS address and press **Connect workspace** once.
Setup checks the API, database and public sign-in configuration before saving
only public URLs in the Windows user profile. Private provider keys and the
database stay on the server.

For a release that skips first-run connection setup, bake the deployed URLs in:

```powershell
./installer/build-clavis-bundle.ps1 `
  -BackendUrl 'https://api.your-domain.com' `
  -SupabaseUrl 'https://your-project.supabase.co'
```

The NSIS installer appears in `release/`. Install it on a clean Windows
computer and check sign-in, a lead search, AI chat, microphone, and PC Bridge.
Reopen connection setup with **Ctrl+Shift+,** or **Alt → Rudra24 AI → Connection
setup**. Changing servers asks for confirmation before clearing the previous
local session/cache: export unsynced local work first. Cancel or a failed
connection check keeps the previous
configuration. The app opens its local UI without waiting for server health;
offline errors remain visible in the existing app. Closing the window quits
the app and releases its local servers, rather than keeping a hidden renderer.

This installer is unsigned; a publisher signing certificate was not available.
It excludes Python/backend source, databases, environment/provider-key files,
build scripts and source maps. Frontend and bridge JavaScript are inside ASAR,
with packaged DevTools disabled, embedded ASAR integrity enabled and Node/debug
injection fuses disabled. ASAR is packaging, **not encryption**: client JavaScript
can still be extracted. Small PowerShell helpers for optional local PC actions
remain normal resource files; they contain no backend secrets.

The local `Rudra24-AI-Preview-Setup.exe` is a packaging check only. It targets
`http://localhost:8000`, requires the developer backend on this PC, and is
not a customer release.

## Verification on 2026-10-05

- `node tests/desktop_runtime_selftest.js`: URL validation, main-frame-only IPC,
  no packaged Python child, configuration persistence, offline reopen, failed DB
  checks and cache isolation on server change passed.
- `node scripts/check-installer-contents.js --strict --archive release/win-unpacked/resources/app.asar`:
  actual packaged contents and required files audited; no detected private keys,
  backend/database files or setup scripts in ASAR. Binary fuse values verified.
- Backend desktop runtime checks (2), speech/provider checks (12), existing
  frontend voice pipeline checks (20) and capture/ownership check passed.
- `backend/.venv312/Scripts/python.exe scripts/benchmark-desktop-backend.py`:
  isolated API startup was 18.98 seconds on this busy Windows machine; idle
  private committed memory was 327 MB / resident 161 MB, and after ONNX VAD was
  357 MB / resident 197 MB. PyTorch did not load. The older running worker
  measured 1,763 MB private memory. The benchmark uses an ephemeral localhost
  port and exits itself; it does not replace the live worker.
- Chrome preview verified local fonts/logo, hairline input and cursor-only
  focus without horizontal overflow. Connection handlers were checked with a
  mocked Electron runtime, not through that ordinary browser preview.

The live backend was not restarted: automatic execution review blocked stopping
it. Restart the developer backend normally to apply the memory changes.
Clean-PC installation, authenticated hosted-server use, 4 GB hardware under a
real lead workload and two-second desktop launch remain unverified. Hosted
processing removes Python/model RAM from recipients' PCs; internet and server
availability still affect responses. No public backend was deployed in this run.

Primary references: [Electron ASAR](https://www.electronjs.org/docs/latest/tutorial/asar-archives),
[Electron performance](https://www.electronjs.org/docs/latest/tutorial/performance),
[NSIS installer](https://www.electron.build/docs/nsis/).
