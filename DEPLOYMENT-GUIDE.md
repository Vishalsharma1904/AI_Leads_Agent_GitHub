# Secure deployment guide

This application uses a browser UI with a server-side security boundary. Do
not distribute provider credentials in `config.js`, `secrets.local.js`,
Android assets, frontend bundles, localStorage, or downloaded customer files.

## Backend setup

1. Copy `backend/.env.example` to `backend/.env`.
2. Set strong random session/JWT secrets, database settings, CORS origins and
   provider credentials only in the backend environment or encrypted vault.
3. Run the backend and serve the UI over `http://localhost:3000` (HTTPS in
   production). The UI calls authenticated `/api` routes.
4. Rotate any provider key that was ever present in an old frontend, Android
   asset, backup, or shared deployment. Revocation must happen at the vendor.

## Customer provisioning

The old browser provisioning flow that generated `secrets.local.js` is
disabled. It now exposes metadata only. Customer access and provider
credentials must be created by an authenticated server/admin workflow, with a
separate account and least-privilege credentials per customer.

## Pre-ship checklist

- `backend/.env` is present only on the server and is excluded by
  `.dockerignore` and `.gitignore`.
- No secrets exist in frontend, Android, backups, generated bundles, or
  browser storage.
- `APP_ENV=production`, explicit `CORS_ORIGINS`, `ALLOWED_HOSTS`, HTTPS and a
  production database are configured.
- Provider credentials were rotated after any historical exposure.
- Run `npm test`, the backend compile check, and browser QA for login, lead
  jobs, AI chat, email/SMS and voice states.
