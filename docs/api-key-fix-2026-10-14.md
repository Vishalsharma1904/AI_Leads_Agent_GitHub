# API setup repair — 2026-10-14

- Local backend is bound to IPv4. The live `localhost` request timed out while `127.0.0.1` returned healthy/database OK; local app defaults and desktop connection normalization now use IPv4.
- All Setup providers, including Apify, save through the authenticated encrypted server vault. Apify no longer reports a browser-only token as a successful server connection.
- Saving an individual key also creates its individual assignment, so managed-mode operations can resolve it. Existing shared/disabled assignments still reject self-service replacement.
- Key requests have a bounded timeout, clear connection/routing errors, and reject non-JSON success responses. Failed refreshes preserve the current account's configured providers; account changes clear them. Unverified saved keys are shown as verification pending.

Verification: all 8 existing stored Groq/ElevenLabs/Apify keys accepted by their live non-billing verification endpoints; secrets were not printed. Live IPv4 health/database OK, credential PUT preflight 200, unauthenticated save 401. Control integration 11 tests, ElevenLabs output/settings 18 checks, vault/Setup checks and desktop runtime checks pass. Full frontend runner passed 29 suites. Web asset snapshot rebuilt as 1.0.8.

These are workspace changes. An already installed copy on another device needs the updated build or deployment. No new installer, production deployment, or real paid chat/call/scraping operation was performed for this repair.

## Dad portable package follow-up

The previously sent 95.7 MiB ZIP did not contain the later startup/proxy fixes. Its launcher opened the UI before backend readiness, and fresh dependency setup included heavyweight local voice and scraper-browser downloads. A running older copy could also continue serving old source after extraction.

The corrected package is `exports/Rudra24-AI-Dad-API-Fixed-2026-10-14.zip`. It bundles the clean tested Python backend dependencies, prefers that bundled runtime over an incomplete old venv, defers optional local-model/browser installation, waits for healthy API/database before opening, and includes `Fix-API.bat` to stop the previous local app and launch the updated folder. The Node UI proxies API/health/voice requests through its own origin; a public runtime marker selects this route, while the static-server fallback retains direct IPv4 access. Existing explicitly approved Dad provider access is preserved.

Current evidence: clean portable Python `pip check` passed; Groq, ElevenLabs and Apify credential PUT/save and live non-billing provider probes passed using an isolated test DB and mocked authenticated identity; 18 control/login tests passed on the bundled dependency versions; real Chrome Setup checks passed; local HTTP proxy checks and the full 31-suite frontend gate passed. Fresh extracted-ZIP launch verification is recorded after the final artifact check.

The launcher now checks installed requirement metadata/versions instead of importing the full application in a preflight and then importing it again in Uvicorn. Actual API/database health still gates opening the app. The probe's positive, missing-package, incompatible-version and optional-model/marker cases passed. Earlier cold-launch attempts exceeded readiness on a host at 100% CPU; those attempts are not reported as passes. A later existing extracted-folder diagnostic reached healthy API/database in 43.4 seconds, with same-origin credential 401 and runtime marker checks passing. This is a warm-folder result, not a physical-device performance claim.

Final archive source/credential verification passed on 2026-10-15: 274,650,126 bytes; SHA-256 `bd3b809bc1a7f12b932194911035106bce8dd4fa1150e50f5d779a7e38902fec`. The final fresh extraction validates every ZIP entry CRC and starts the bundled runtimes without downloading dependencies.

Final fresh-folder gate **passed**: `work/dad-clean-venv/Scripts/python.exe tests/dad_package_selftest.py` extracted this exact archive into a new folder, validated entry CRCs, launched its bundled Node/Python with the shipped startup script, and reached healthy API/database in **124.0 seconds** after extraction. Same-origin credential PUT returned the expected unauthenticated 401, the dynamic runtime proxy marker was present, and no dependency venv/download was needed. The test stopped only its owned process trees. This replaces the pending final-package check above; Dad's actual laptop and real Google login remain unverified.

Usage: extract this corrected ZIP into a new Windows folder, close the previous app windows, then run `Fix-API.bat` once. Later use the shortcut created from this updated folder. A successful local package check does not substitute for confirmation on Dad's actual laptop, and the portable local API is separate from the production shared HTTPS backend required for remote owner controls.
