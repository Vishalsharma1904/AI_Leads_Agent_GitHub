# Login and API Key Security

Audit and hardening: 2026-10-01. This is not an "unhackable" certification.

- Setup, Settings and the credential dialog save keys to the authenticated,
  account-scoped AES-GCM backend vault. Browser key getters return no secret.
- AI chat and image requests use the authenticated backend. Gemini Live gets
  a model-restricted, single-use token: one minute to connect, ten minutes of validity.
- The unauthenticated Gemini environment-write endpoint is retired (410).
- Speech/dashboard WebSockets require an allowed Origin and a valid Supabase
  bearer token in their first frame. Exotel streams require a shared stream token.
- OAuth uses PKCE. JWT signatures, issuer, audience, expiry and authenticated
  role are checked. A changed subject cannot take over an account by email.
- Local static serving blocks environment files, credential files, databases,
  archives, tests and backend code. Installer preparation rejects obvious key literals.

## Before Selling

1. Deploy the backend on HTTPS (Render), with PostgreSQL, restricted CORS/hosts
   and a private CREDENTIAL_MASTER_KEY. Do not bundle backend .env or databases.
2. Rotate any key previously used in browser code, logs, source or Git history.
   Removing a local copy cannot revoke a key that somebody already copied.
3. In Setup, use **Remove old device keys** on each previously used browser/device.
   This needs explicit confirmation; it does not delete the backend credentials.
4. Enable Supabase email confirmation, appropriate auth rate limits, CAPTCHA and
   operator-account MFA. Dashboard access is required to configure these.
5. Run an independent penetration test before distributing the product.

## Limits

Supabase publishable/anon configuration is intentionally public, unlike provider
keys and Supabase secret/service-role keys. Session tokens and short-lived Live
tokens remain observable in the browser. XSS, malicious extensions or a compromised
device can still steal sessions or see a key while its owner types it. Legacy
inline handlers prevent a strict script CSP; the current CSP is containment only.
The in-process IP rate limiter is per worker, not a distributed production limiter.
Legacy local credentials remain until the user confirms removal. End-to-end Google
OAuth and Live provisioning require a real signed-in user/provider project and are
not claimed verified by the mocked tests.

Checks: `node tests/vault_security_selftest.js` and, from backend,
`python -m unittest tests.test_login_security`.

References: [Gemini ephemeral tokens](https://ai.google.dev/gemini-api/docs/live-api/ephemeral-tokens),
[Supabase public keys](https://supabase.com/docs/guides/getting-started/api-keys),
[Supabase PKCE](https://supabase.com/docs/guides/auth/sessions/pkce-flow).
