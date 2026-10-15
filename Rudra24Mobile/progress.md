# Rudra24 Mobile implementation ledger

Approved specification: native Kotlin/Compose Android APK and independent installable PWA; Home, Leads, Outreach, More; reviewed batches continue on the server.

Ruling: use Rudra24Mobile as the independent mobile copy, retain original AndroidApp and desktop UI — preserving prior work and preventing desktop packaging changes.

Ruling: reuse authenticated CRM records as the selectable lead source, existing lead jobs, ElevenLabs batches, connected Gmail sender, and Meta approved-template sender. Add durable email/WhatsApp orchestration only.

Ruling: interrupted or uncertain sends pause the batch for review; never automatically resend. No paid provider actions during checks.

Backend regression test first failed because mobile_jobs did not exist. Implemented owner-scoped jobs and atomic per-recipient claims. Verification pending.

Frontend contract check passes: recipient validation, duplicate destinations, N limit, review payload, escaping and HTTPS origin validation.

Android toolchain bootstrapped in ignored .toolchain. Final native build successful: 35 tasks, APK 9,400,070 bytes, v2 signature verified. No Android device attached; on-device behavior remains unverified.

Final: backend/mobile fixture, phone/tablet browser, refresh-race cleanup, service-worker offline shell, contract and proxy checks pass. Existing frontend 24 suites, calling 29 cases and WhatsApp mock suites pass. Review fixes: epoch guards, call-request reconciliation, definitive validation cleanup, query-preserving pagination and hidden review cleanup. Source ZIP excludes secrets/data/runtimes. Actual HTTPS deployment and provider sends remain pending, as documented in VERIFICATION.md.

v1.1 final: App versionCode 2, APK 9,592,424 bytes, v2 signature verified; incremental build 1m58s. Apify ceiling budget and exact-sector filtering repaired; clients use Apify/Maps sources and auto-refresh new leads without disturbing selections. Added CRM editing/notes/follow-up completion, verified calling readiness and owned CRM destination/opt-out checks. Server persists call statuses/transcripts/summaries after app closes and mirrors signed Meta message statuses into CRM without duplicate events. Fixed provider-form response races and non-submit action button types. Mobile search uses stable account-scoped request keys and one quota reservation; lost responses reconcile through history. Interrupted old searches recover without paid retries. Tests: CRM 10, calling 29, pipeline 6, expanded phone/tablet flow, offline shell, durable jobs and frontend 24 suites pass. Updated local backend healthy in hidden process. No real outbound provider actions, HTTPS deployment or physical-phone validation performed.
