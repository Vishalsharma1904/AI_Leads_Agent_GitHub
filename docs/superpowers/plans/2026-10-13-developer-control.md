# Rudra24 Developer Control Implementation Plan

> For agentic workers: use subagent-driven-development or executing-plans task-by-task.

**Goal:** Implement the user-approved in-app owner control specification in this conversation.
**Architecture:** Extend the Vanilla JS developer surface and authenticated FastAPI/Supabase backend. Server owns access, encrypted provider assignments and metering; clients receive only capabilities and revisions. Signed releases and bounded adaptive rendering preserve the installed product.
**Tech Stack:** Vanilla JS, Python/FastAPI/SQLAlchemy, Supabase, Electron NSIS.
**Spec:** User-approved five-section plan in the 2026-10-13 conversation; decisions: shared and individual keys; disclosed app data; verified payment plus owner controls; cached UI plus cloud.

## Global constraints
- Preserve existing unrelated dirty work, routes, provider rotation, Supabase authentication and glassmorphism styling. No React migration, secret export, automatic deployment or purchase.
- Implement against this existing checkout since user explicitly requests changes to the existing app; do not discard uncommitted work or create an empty worktree from stale HEAD.
- Existing pricing remains Starter INR 499 / Growth INR 1499. No additional signup data is invented.

## Review focus
- User A cannot read or mutate User B; frontend email cannot grant owner rights.
- Duplicate/cross-user payments never activate twice or activate the wrong user.
- Disabled providers and blocked sessions cannot bypass controls through legacy endpoints.
- Offline/account switch cannot leak cached account data or overwrite newer revisions.
- Interrupted/tampered updates preserve previous working UI; active operations are not reloaded.

## Tasks
- [x] 1. Backend control: add owner auth, account policy, provider assignments, audit/usage/release APIs and production migration. Tests: negative identities, block/revoke, provider isolation, quota concurrency, release cohorts.
- [x] 2. Payment protection: verified authoritative order/payment binding and transactional receipt idempotency. Tests: callback/webhook replay, amount/status mismatch, foreign buyer.
- [x] 3. Owner UI and client controls: searchable paginated users, account/setup/content/audit views, shared providers, releases; disclosure, revision notifications and cache cleanup. Tests: safe text rendering, account switch, offline reconnect.
- [x] 4. Update delivery: signed desktop bundles and NSIS updater; controlled PWA activation; artifact validation and rollout/rollback. Tests: signature/tamper, compatibility, atomic fallback and active-work deferral.
- [x] 5. Performance: native hardware hints, measured adaptive tier, remove repeated sizing/route work, bounded rendering. Tests: unknown memory, hysteresis, 300 messages / 1000 rows and listener lifecycle.
- [x] 6. Integration review and documentation: targeted regression suites, installer checks, deployment prerequisites and explicit real-device/live-account limitations.

## Progress
Ruling: User explicitly requested implementation of the approved plan; proceed without another design approval. Use narrowly scoped tasks and no commit of unrelated existing changes.

Local implementation complete for tasks 1-5. Task 6 local verification is complete; final evidence is in docs/developer-control-2026-10-13.md. Production migrations, real deployment/signing and physical device checks remain explicit activation prerequisites.

Final local evidence at initial implementation: root gate 29 suites; backend control/login/speech/calling 57 tests; additional billing fixtures; isolated Chrome panel; installer and mobile contract checks. Owner/provider and billing task reviews found issues that were addressed and regression-tested. Production rollout/signing and physical device checks remain unverified; Android compilation passed in the continuation below.

## 2026-10-14 continuation
Ruling: finish a new first-run Windows baseline build locally without inventing a cloud URL or production signing identity. Live publishing remains separate from building the reviewable artifact.
Fresh review found and fixed delayed account-switch cloud reads/writes, in-flight pulls overwriting newly edited local work, cloud settings overriding device connection URLs, disabled shared providers appearing configured, and missing sync activity reporting. A failing-then-passing cloud isolation self-check now joins the root gate. Current evidence: 30 frontend suites; 12 control integration tests; final isolated Chrome panel, account auth/sync and desktop runtime checks pass.

Dad-machine priority: previously sent portable ZIP predated startup fixes. Corrected package includes backend dependencies, same-origin API routing, API readiness and old-server repair. Final gate: 31 frontend suites; 26 control/voice/login tests; 43 voice/login/calling tests; existing ElevenLabs speech checks; actual Setup and owner-panel Chrome fixtures; and three live non-billing credential probes passed. Android debug compilation and APK v2 signature verification passed. Final exact-ZIP fresh extraction/startup passed, reaching healthy API/database in 124.0 seconds after extraction; source/credential parity and all entry CRCs passed. Voice allowance controls and their additive production migration are included. Live shared owner controls still require the common hosted HTTPS backend, production migration/signing and physical-device acceptance; no URL or signing identity has been invented.
