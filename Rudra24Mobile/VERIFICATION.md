# Rudra24 Mobile v1.1 verification — 12 October 2026

## Passed

- Native Kotlin/Jetpack Compose Android `assembleDebug`: **BUILD SUCCESSFUL**, 35 tasks, 1m 58s for the final incremental build. APK size: **9,592,424 bytes**. This is build time, not app startup latency.
- APK signature: verified with APK Signature Scheme v2. Package `ai.rudra24.mobile`, version 1.1.0/code 2, minimum Android 8/API 26, target API 35. Network permissions only, plus AndroidX's non-exported receiver permission. No camera, microphone, contacts or SMS permission requested.
- Existing desktop/frontend gate: **24 suites passed** (`work/mobile-full-checks.log`).
- Existing ElevenLabs mock calling regression: **29 tests passed**. Existing WhatsApp mock suites passed tenant/vault binding, consent/template checks, quotas, concurrent idempotency, signed receipts and unknown outcomes.
- Existing CRM backend regression: **10 tests passed**. New pipeline **6 tests passed**, covering Apify ceiling budget/count/CRM persistence, exact sector matching, stale-job recovery, once-only quota reservations/idempotent search conflicts, owned/opt-out-safe calling and background transcript persistence, and WhatsApp receipt/CRM idempotency. All provider APIs were mocked.
- Mobile backend check: review required, owner/guest isolation, invalid recipients, idempotency conflicts, durable worker execution, cancellation, uncertain stop and stale in-flight reservation handling passed.
- PWA phone **390 × 844** and tablet **820 × 1180** fixtures: sign-in, lead selection/details, first-N limit, review before submit, back/cancel, one confirmed submit, logout cleanup, late refresh isolation, no horizontal overflow and no JavaScript errors passed.
- Extended browser flow passed: incomplete outbound setup blocks review/submission, confirmed calls carry CRM IDs, call recipients/transcripts open, CRM contact/stage edits and notes save, follow-ups complete, Apify jobs auto-refresh leads, and provider checks do not accidentally submit the backend/settings form.
- Real service-worker check: first-install page control, offline shell, install icons and exclusion of API/account data from caches passed.
- Node checks: HTTPS proxy configuration, bearer/idempotency forwarding, unavailable backend, recipient validation, duplicate prevention, payload limits and HTML escaping passed. Changed Python modules compile.
- Final source archive is tested for ZIP integrity and excludes local databases, sessions, encrypted family-provider envelope, provider environment files, signing keys and downloaded toolchains.
- Updated local backend loaded in a hidden process after confirming no active lead/call jobs or connected clients. `/health` reports healthy API/database and ready lead browser; mobile outreach routes and CRM recipient schema are present. One obsolete interrupted lead job was recovered; no contacts deleted. Approved family accounts resolve configured Apify/Groq/ElevenLabs credentials server-side; this does not verify credit balances or provider delivery.

## Release requirements still pending

- No production HTTPS backend/PWA host was supplied or deployed. Configure the existing Render backend, apply the new migration, configure the mobile Vercel proxy, public Supabase auth settings and allowed origins using README.md.
- No Android device was attached (`adb devices -l` returned an empty list). APK installation, native screen interactions, Android Keystore/session recovery and on-device startup performance remain unverified.
- Phone home-screen PWA installation remains unverified; the real service-worker install/offline shell was tested in Chromium.
- No real paid calls, emails, WhatsApp messages or lead searches were sent. Provider delivery and credentials must be checked against the deployed backend with reviewed recipients.
- APK is a signed debug build for sideload testing. A production release needs the operator's protected release signing key. Keep the same key for future updates.

The earlier network/download and Windows Gradle cache-rename failures were resolved. Core icons replace the larger extended icon bundle. One deprecated Send icon warning and an unstripped AndroidX native-library notice did not prevent successful assembly.
