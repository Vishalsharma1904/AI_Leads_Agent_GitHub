# Rudra24 Mobile

Google-first login and PC-independent cloud deployment: see [CLOUD-SETUP.md](CLOUD-SETUP.md).
Version 1.2 signs in directly to Supabase. The Android app and PWA no longer
require a backend URL or a Rudra24 password to start Google sign-in. Cloud
operations still need a hosted API; Google login alone does not deploy it.

Independent mobile copy of Rudra24: a Vanilla JS PWA and a native Kotlin / Jetpack Compose Android app. The desktop UI and original AndroidApp wrapper remain preserved.

## v1.1: leads, calling and CRM

Install the updated APK over v1.0; the package ID/signing identity is retained. Update the backend from this source package before using v1.1: mobile call requests now include the owned CRM record ID. No additional database migration is needed for the v1.1 history integration beyond the existing CRM/ElevenLabs/outreach migrations.

Search uses **Apify primary + public Maps fallback** through the backend. Keys stay server-side. The per-query budget uses ceiling division, results are capped to the requested count, and Noida/Gurugram sector searches match exact sector tokens regardless of address order. If sources cannot supply enough contacts, the real partial result/count is retained. Newly saved contacts refresh automatically while no selection is in progress; selecting leads keeps the current batch stable.

Mobile search submissions use account-scoped idempotency keys. A lost submission response blocks another search until job history reconciles the pending request. The backend reserves the requested lead allowance once before starting paid work; repeating the same key never starts a second search or charges the allowance again. Insufficient allowance schedules no provider work. Search allowance is reserved per attempt, not refunded for partial results. Interrupted jobs older than one hour are marked partial/failed with saved contacts retained; they never automatically restart paid work.

Open a lead's Details to edit phone/email/stage, save notes, add dated follow-ups, complete follow-ups, and read activity history. Existing optimistic version checks and Won-deal rules remain authoritative. Refresh history after a timeout before manually retrying a write.

Calls verify agent/outbound-number readiness before showing the review. The backend checks that every supplied CRM ID is owned, the destination matches the stored contact, and phone opt-out is absent. Native concurrency remains one. A background worker reads existing batch statuses and saves provider call status, transcript and summary into the selected CRM record even after the mobile app closes; it never submits or automatically retries a call. Open transcript from batch history for details. Missing provider transcripts remain missing.

WhatsApp mobile batch history now mirrors the saved Meta message status into CRM. Acceptance is distinct from signed-webhook sent/delivered/read evidence; duplicate status fetches do not create duplicate history. Email uses the existing verified Gmail outreach ledger. More → Check connected providers displays configured Apify/Groq/ElevenLabs flags without returning keys; configuration flags do not prove available credits.

## Use

Both clients use your existing authenticated backend. Sign in with your existing email/password. Each account sees its own CRM leads, searches and outreach jobs. Provider keys stay in the existing server vault; family provider grants continue to apply there. Google and WhatsApp sender ownership/consent are still per-account.

- **Home:** active searches and outreach status.
- **Leads:** search, saved contacts, filters, details/history and export of loaded contacts.
- **Outreach:** select leads, enter an N limit (maximum 200), review exact recipients/content, then explicitly submit Calls, Email or WhatsApp.
- **More:** account, CRM/history and backend address.

Email and WhatsApp jobs keep running on the backend after the app closes. Closing an app is not cancellation. Stop remaining recipients from job history. An already in-flight send cannot be recalled. Unknown provider outcomes pause the batch; check provider history before creating a replacement. WhatsApp “accepted” means Meta accepted a request, not delivery; the existing signed-webhook message history is the delivery authority.

## PWA

Serve `pwa/` over HTTPS; do not open index.html as a file. Deploy that folder as a standalone Vercel project. Set `RUDRA_BACKEND_URL` to the real HTTPS backend origin. Its API proxy forwards bearer authentication and does not contain provider keys. Browser menu → Install app / Add to home screen. The shell works offline; account data and outbound actions require the backend and are never service-worker cached.

To preview locally: `python -m http.server 4173 --directory Rudra24Mobile/pwa`. Enter your running local backend URL in the PWA connection form. localhost HTTP is allowed for development only. A remote phone cannot use your PC's localhost address; use HTTPS deployment.

## Android APK

Run `powershell -NoProfile -ExecutionPolicy Bypass -File Rudra24Mobile/Build-Android.ps1` from the desktop checkout. The script downloads official JDK 17, Gradle 8.11.1 and Android SDK tools into ignored `.toolchain/`, accepts SDK licenses and builds a debug APK. Output: `android/app/build/outputs/apk/debug/app-debug.apk`. Android 8+ required. This is native Compose; no WebView or bundled legacy assets.

On first launch choose Continue with Google. The Android callback is configured in Supabase. Connect the hosted HTTPS operations API later from More → Connection. Tokens are encrypted with Android Keystore; leads are held in memory and cleared on logout/backend change. APK export uses Android's document picker. `-Release` produces an unsigned release artifact; configure your own protected signing key before production distribution. Keep the same signing key for future updates. No Play Store publication is performed.

## Backend deployment

Use the root Render blueprint and PostgreSQL database. Apply the existing migrations and `backend/migrations/20261012_mobile_outreach.sql` before deploying this version. Keep `AUTO_CREATE_SCHEMA=false` in production. Configure:

```
APP_ENV=production
DATABASE_URL=<existing PostgreSQL URL>
CORS_ORIGINS=https://<PWA host>,http://localhost:3210,http://localhost:3000
ALLOWED_HOSTS=<backend hostname>
CONNECTOR_PUBLIC_BASE_URL=https://<backend hostname>
SUPABASE_URL=https://<project>.supabase.co
SUPABASE_PUBLISHABLE_KEY=<public key>
SUPABASE_SECRET_KEY=<server only>
SUPABASE_REDIRECT_URL=https://<PWA host>/
```

Retain the existing credential master key; replacing it makes stored provider keys unreadable. Configure production provider keys/approved family access server-side. Configure Google/Meta callback and webhook URLs as described in existing connector docs. Add the PWA origin to Supabase's allowed redirects for recovery/confirmation links. Native v1.2 supports Google OAuth via the system browser, PKCE code exchange, encrypted session persistence and the Android callback. Email/password remains an optional alternate sign-in.

The API starts a durable outreach worker. Pending recipients resume on the next worker pass. A process crash during a send leaves a reservation that becomes unknown after three minutes; it pauses remaining recipients and never automatically resends. There is deliberately no automatic failed/unknown resend endpoint. Lead searches use the existing background lead pipeline; backend process restarts during an active search still require review of that search's saved partial results.

Public additions: `GET /api/v1/lead-jobs`; authenticated `POST/GET /api/v1/outreach-jobs`, `GET /api/v1/outreach-jobs/{id}`, `POST /api/v1/outreach-jobs/{id}/cancel`. Email/WhatsApp create accepts channel, request_id, record_ids, confirmed and reviewed content/template fields. Recipient destinations are resolved from the account's CRM records on the server. ElevenLabs native batch APIs remain unchanged.

## Checks

```
node Rudra24Mobile/tests/contract.test.mjs
node Rudra24Mobile/tests/proxy.test.mjs
backend/.venv312/Scripts/python.exe backend/tests/test_mobile_jobs.py
backend/.venv312/Scripts/python.exe backend/tests/test_mobile_pipeline.py
backend/.venv312/Scripts/python.exe Rudra24Mobile/tests/browser_check.py
backend/.venv312/Scripts/python.exe Rudra24Mobile/tests/offline_check.py
```

Browser fixtures test 390px phone and 820px tablet, login, lead selection/details, N limit, confirmation, cancel, one submit, logout isolation and overflow. They use mock provider responses and never send real calls/messages. Run Android build separately. A real HTTPS host, on-device Android checks, PWA installation and real provider delivery must be verified before describing the release as live-ready.
