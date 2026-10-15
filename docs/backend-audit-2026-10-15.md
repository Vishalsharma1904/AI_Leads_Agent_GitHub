# Backend audit — 15 October 2026

Checked the existing Vanilla JS/FastAPI app. The fixes below are local source changes; no production database, payment, outreach or calling operation was performed.

## Confirmed bugs repaired

- **Account access:** the control gateway missed the actual `/api/v1/ai/`, `/api/v1/web/`, `/api/v1/lead-jobs` and `/api/v1/candidate-jobs` paths. Expired accounts are now rejected before paid work begins. Queued candidate jobs recheck account access and pause when blocked or out of allowance.
- **Web reader:** the router now requires authentication. Its three existing frontend callers send the current bearer token to the backend.
- **Credential errors:** an unreadable encrypted credential now returns an actionable `503 CREDENTIAL_UNREADABLE`, without exposing the secret or silently selecting another billing account.
- **Candidate spending:** the requested total is divided across selected sources instead of being requested independently from every source. Jobs reserve quota first, settle the actual returned count and release unused allowance. Finished workers cannot run again; a replay with changed search parameters returns `409`.
- **Streaming resources:** realtime releases the request's SQL connection and closes each polling transaction before yielding a frame. Provider admission also ends its transaction while preserving the loaded user snapshot. The regression uses a pool with just one connection. Expired stream claims return `401`.
- **Lead timeout:** cancellation cleanup respects a short configured timeout instead of always adding a full second; the regression covers a crawler that resists cancellation.
- **Call allowance:** Tough Tongue checks scenario ownership and input before consuming allowance. Definite failures use the existing refund path; uncertain submitted outcomes retain their separate usage state.
- **Cloud voice runtime:** the launcher no longer skips required `faster-whisper`/`onnxruntime` dependencies. The ONNX speech gate works without importing Torch or downloading transcription weights. Optional local synthesis remains optional.
- **Schema control:** startup respects `AUTO_CREATE_SCHEMA=false`; it no longer runs additive schema repairs when explicitly disabled. Required production migrations remain a separate deployment step.
- **Hosting config:** `render.yaml` accepts the existing Supabase PostgreSQL connection and vault master key. It no longer provisions a second database or automatically substitutes a new master key for saved credentials.

## Verification

Completed verification:

- Comprehensive backend run: **35/35 files passed**, recorded in `work/backend-audit-final.log`. The old loader included imported test classes more than once; its case count is not a count of unique tests.
- After the final provider-connection release fix: **16/16 focused cases passed** across developer control, realtime resources and actual server startup. Logs: `work/backend-checks/run-4op0dcyh/`.
- The full CRM suite, including import/pagination of **10,502 tenant-owned records**, also passed in the isolated diagnostic run: `work/backend-crm-trace.log`. No physical-device timing result is inferred from this run.
- **34/34 frontend suites passed**: `work/backend-audit-frontend-verified.log`.
- Real Chrome API-setup check passed for Groq, ElevenLabs and Apify with fixture credentials, intercepted network requests, backend failure/recovery, authenticated saves and no plaintext browser storage.
- Required-package probe passed against the clean desktop runtime, including rejection of missing/incompatible ONNX speech dependencies. Deployment YAML parsed successfully and its existing-database/vault configuration checks passed. Scoped whitespace checks passed.

The subsequent combined rerun is not reported as a completed passing gate; the completed runs above are the verification evidence. The runner now excludes imported test classes from duplicate execution and uses a longer aggregate allowance for large data fixtures without reducing datasets or assertions.

The new backend gate runs every test file in a fresh process and temporary database. It disables dotenv loading and rejects non-loopback socket connections, so backend regression tests cannot consume live provider credits. Existing fixtures were updated to use real isolated SQL sessions and valid audio, preserving the current authentication and allowance checks.

Re-run with an installed backend Python:

```powershell
python backend/scripts/check_backend.py
node scripts/run-all-checks.js
node tests/dad_setup_browser.js
python tests/backend_dependency_probe_selftest.py
```

The gate prints its unique log directory. On this machine the restricted execution sandbox denied temporary-file renames and loopback sockets; those affected checks were rerun with normal local access. No application safeguard was removed to make a test pass.

## Live provider evidence and delivery boundary

Read-only requests through the owner's existing local credential resolver returned **HTTP 200 for Groq, ElevenLabs and Apify** on 15 October. No key values or provider response bodies were printed. This verifies the stored keys and provider reachability from this machine; it does not prove network access from the father's laptop, a generated AI answer, speech recognition or a real phone call.

The current desktop connection file still has neither a backend URL nor a public connection-file URL. A working hosted HTTPS backend must be connected before a normal customer installation can use server features without a local backend. Hostinger shared hosting can serve the public connection JSON and static assets; it does not run this FastAPI container.

Existing installer `1.0.9` and the older Dad ZIP predate this backend audit and do not contain these latest fixes. No new installer, live deployment, database migration, signing result, physical-device benchmark or zero-error guarantee is claimed here. Build a new connected installer after applying the verified backend release and its production configuration.
