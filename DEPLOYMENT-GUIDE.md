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

## Shipping it as a normal app (hosted API + Electron shell)

This is the architecture the product is built for, and it is what makes the
installer behave like any other desktop app: the customer double-clicks the
icon and it works. No Python on their machine, no venv, no `.bat` or `.ps1`
to trigger, nothing to configure — because none of that is on their side.

It is also the only arrangement in which the two promises actually hold:

* **The customer never sees an API key.** Keys live in this server's vault
  (`api/credentials.py`) or its environment, are used server-side, and are
  never serialised into any response. A key shipped inside an EXE can always
  be extracted by whoever owns the machine — obfuscation only changes how long
  it takes.
* **The customer cannot raise their own limits.** Daily leads/calls are
  counted in `tenant_limits` on this server. A limit enforced inside the app
  can be edited, patched, or sidestepped by calling the API directly.

### 1. Deploy the API

`render.yaml` in the repo root describes the whole thing — Docker service plus
Postgres. In Render: **New → Blueprint**, point it at this repo, then fill the
values marked `sync: false` (Supabase, admin e-mails, platform API keys,
Razorpay). Any Docker host works; Render is just the shortest path.

The image already installs Playwright's Chromium, so lead scraping works on
the server from the first request — this is the same missing browser that made
leads come back with no phone and no e-mail locally.

### 2. Create the tables

Production does not auto-create schema (`AUTO_CREATE_SCHEMA=false`). Apply
`backend/migrations/*.sql` once against the Postgres database, in filename
order. Skipping this is why a fresh deploy 500s on anything that touches
Sarvam, billing or limits.

### 3. Point Supabase at the app

Supabase → Authentication → URL Configuration → Redirect URLs, add:

```
http://localhost:3210/
```

The desktop app serves its own UI on that port, so that is the origin Google
sign-in comes back to. Email/password works without it; Google does not.

### 4. Build the customer installer

```
installer\build-clavis-bundle.ps1 -BackendUrl https://your-api.example.com -SupabaseUrl https://xxxx.supabase.co
```

`electron/prepare-build.js` refuses anything that is not a real HTTPS host, so
an installer can never ship pointed at a laptop. With a remote URL the app
skips its local-backend path entirely — it opens on the splash, waits for the
API, and goes straight into the product.

Hand the customer the one `.exe` from `release/`. They install it, click the
icon, sign in. That is the whole of their setup.

### Keeping a local backend for yourself

Development is unchanged: `desktop-config.json` pointing at
`http://localhost:8000` makes `electron/main.js` start the API itself (hidden,
no console window) and stop it on quit. That path exists for your machine, and
ships to nobody — customer installers contain no `.ps1` at all.
