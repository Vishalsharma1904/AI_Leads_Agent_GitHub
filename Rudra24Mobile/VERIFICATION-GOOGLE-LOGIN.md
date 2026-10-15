# Rudra24 Mobile v1.2 Google login — 12 October 2026

## Verified

- Final `assembleDebug` completed successfully: version 1.2.0 / version code 3,
  package `ai.rudra24.mobile`, minimum Android 8/API 26, target API 35.
- APK signature verified with v2; final artifact is 9,625,120 bytes.
- Google-first Android and PWA login no longer depends on a PC API/public-config request.
- Supabase public auth settings returned `external.google=true` and signup enabled.
- Real Supabase authorize request returned HTTP 302 to `accounts.google.com` with
  the Android redirect and PKCE challenge. No user account/consent was submitted.
- Supabase dashboard Android callback was added and visibly confirmed:
  `ai.rudra24.mobile://auth/callback`. Screenshot: `artifacts/supabase-android-redirect.png`.
- PKCE unit checks passed: random verifier/challenge, callback origin/project/age,
  replay/cancel rejection, token minimization and callback URL cleanup.
- Chromium fixtures at **320, 390 and 820px** passed Google callback → account,
  reload persistence, logout and rejected callback replay with the operations API unavailable.
  No horizontal overflow or JavaScript errors. These used mocked auth accounts.
- Existing phone/tablet CRM and reviewed outreach fixtures passed, including account
  cleanup, late refresh isolation, provider readiness, selection and CRM follow-ups.
- Real service-worker offline shell test passed; API/user data are excluded from caches.
- Existing contract/proxy checks and JavaScript syntax check passed.
- Supabase `public.clavis_user_data` created with four ownership policies and no anonymous access.
- A new private `rudra_mobile_backend` schema has **36 backend tables**. SQL verification
  confirmed all have RLS enabled and neither anonymous nor authenticated browser roles
  have direct SELECT privileges. Queries against the new schema execute.
- The pre-existing event-trigger function's public execution grants were removed;
  the advisor's privileged-function warnings cleared.

## Still required for full cloud operation

- Hosted Python API/container, Supabase PostgreSQL connection string in hosting secrets,
  schema selection from `render-supabase.yaml`, and provider credentials/connections.
  No paid hosting service was bought or deployed.
- Real phone installation, Google account chooser/consent and return to the Android app.
  A compiled APK and browser fixtures do not prove a real on-device sign-in.
  `adb devices -l` returned no connected phones in the final device check.
- Reviewed live lead/call/email/WhatsApp action against that hosted API. No provider
  calls or messages were sent during this verification.
- APK is signed for debug/sideload testing. Production release signing uses the
  owner's protected key; no Play Store release was published.
- Supabase advisor reports informational no-policy entries for deliberately private
  backend tables and the existing disabled leaked-password check for password accounts.
  See CLOUD-SETUP.md for details and linked remediation guidance.

The broad public-schema migration was rejected by automatic approval review and
not applied. The replacement creates a fresh private schema, refuses to overwrite
an existing schema, and passed review. This preserves public account-data ownership policies.

User selected Android APK only; no separate Netlify mobile site was created.
