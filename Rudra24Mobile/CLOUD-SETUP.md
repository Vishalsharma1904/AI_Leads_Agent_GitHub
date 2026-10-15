# Rudra24 Mobile: Google login aur PC ke bina use

## Ab kya connected hai

- Android/PWA Google login seedha active `CLAVIS A.I` Supabase project se hota hai.
- Login screen par API URL/password bharna compulsory nahi hai. Google account select kijiye.
- Account sync table `public.clavis_user_data` mein `auth.uid()` ownership policies hain.
- Full Python backend ke tables ek naye private `rudra_mobile_backend` schema mein hain.
  CRM, lead jobs, reviewed outreach, provider vault aur billing tables browser clients ko directly accessible nahi hain.
- Existing PC database ka data cloud mein copy nahi kiya gaya. Google sign-in koi provider key ya desktop lead history automatically copy nahi karta.

## Android login configured

Supabase project → **Authentication → URL Configuration → Redirect URLs**:

```
ai.rudra24.mobile://auth/callback
```

Ye URL dashboard mein add/save karke verify ho gaya hai (12 October 2026).
Google provider bhi enabled hai. Is project ke liye ye setup dobara nahi karna hai.
APK v1.2 install/update karke **Continue with Google** dabaiye. Phone ka Chrome/default
browser khulega; Google account select karne ke baad Rudra24 mein wapas aayega.
Password app mein enter nahi karna hai. Code exchange PKCE se protected hai;
session aur pending verifier Android Keystore se encrypted hain.

Google OAuth client ka provider callback Supabase ka URL hi rahe:
`https://lyqnxutvfoytbtnthcrw.supabase.co/auth/v1/callback`.
Android app scheme ko Google Cloud ke Web OAuth client mein add nahi karna hai.
Google account chooser/consent aur phone par return ka real test owner ko complete karna hai.
[Supabase Google setup](https://supabase.com/docs/guides/auth/social-login/auth-google)

## Phone par browser/PWA

`pwa/` folder ko HTTPS host par publish kijiye. Hosting link ko Supabase allowed
Redirect URLs mein exact trailing slash/path ke saath add kijiye. Example:
`https://your-mobile-host.example/`. App current HTTPS page par return hota hai,
PC ke `localhost` par nahi. PWA login public Supabase configuration se chal sakta
hai even when the operations API is unavailable.

Browser menu → Install app / Add to home screen. Email/password alternate login
collapsed hai. Desktop ke sensitive configs, backend folder aur local databases
PWA hosting directory mein upload nahi karne hain.
[Redirect URL configuration](https://supabase.com/docs/guides/auth/redirect-urls)

## Saare operations PC band hone par chalane ke liye

Phone interface aur Supabase login/database tayyar hone ke baad Python API ko
cloud container mein deploy karna hai. Existing scraper browser, durable workers,
encrypted provider vault aur live calling routes isi process mein run hote hain.
Phone ko Python/PC server chalane ki zaroorat nahi hogi.

Required owner setup:

12 October update: the owner selected **Free $0 preview** on Render. The audited
backend is in the private `Vishalsharma1904/rudra24-mobile-backend` repository,
branch `codex/mobile-cloud`, with a root `render.yaml`. Render and Apper are both
signed in under `vishalsharma190405@gmail.com`; ChatGPT Plus remains on the separate
`alsharma2901555@gmail.com` account. The blueprint generates a new encryption key
for this fresh cloud vault, takes its hostname/callback origin from Render's
runtime metadata, and needs the real `DATABASE_URL` entered securely.
Provider keys can be added after the service starts. No PC vault/data migration
has been performed. Free services sleep after 15 minutes without inbound traffic;
use this as a preview, not an uninterrupted outreach worker.
[Render free-service limits](https://render.com/docs/free)

1. Cloud hosting account/project with Docker/container support. `render-supabase.yaml`
   existing backend Dockerfile use karta hai aur doosra database provision nahi karta.
   Hosting plan/cost provider console par choose/approve kijiye; no paid hosting was purchased.
2. Supabase **Connect** se PostgreSQL connection string, password ke saath, hosting
   dashboard ke **secret environment variables** mein. IPv4-only host ke liye
   Session pooler URL select kijiye; host/username guess nahi karna.
3. Existing provider credentials/server vault encryption key hosting secrets mein.
   Keys/passwords app bundle ya chat mein paste karne ki zaroorat nahi hai.

Minimum hosting environment:

```env
APP_ENV=production
DATABASE_URL=postgresql://<copy-real-connection-string>?sslmode=require
PGOPTIONS=-csearch_path=rudra_mobile_backend
PGSSLMODE=require
AUTO_CREATE_SCHEMA=false
SUPABASE_URL=https://lyqnxutvfoytbtnthcrw.supabase.co
SUPABASE_PUBLISHABLE_KEY=<public project key>
SUPABASE_SECRET_KEY=<server-only secret>
SUPABASE_REDIRECT_URL=https://<mobile-host>/
CREDENTIAL_MASTER_KEY=<retain-the-existing-vault-key>
CORS_ORIGINS=https://<mobile-host>
ALLOWED_HOSTS=<api-hostname>
CONNECTOR_PUBLIC_BASE_URL=https://<api-hostname>
CLAVIS_AUTO_INSTALL_BROWSER=false
CLAVIS_WARM_KOKORO=false
```

Use the real URL's existing query separator if it already has query parameters.
The schema selection applies to the backend's existing psycopg2/libpq connections.
Verify `SHOW search_path` and `SELECT count(*) FROM user_accounts` using that
connection before starting jobs. For a later schema change, use a separately
reviewed incremental migration; `Prepare-Cloud.py` intentionally refuses to
overwrite the existing private schema.
[Supabase connection modes](https://supabase.com/docs/guides/database/connecting-to-postgres)
[PostgreSQL PGOPTIONS](https://www.postgresql.org/docs/current/libpq-envars.html)

Provider requirements depend on the features used:

- Lead search: Apify account/token and available quota.
- AI: Groq/OpenRouter or another supported connected provider.
- Calls: ElevenLabs agent + approved outbound phone number + provider account/credits.
- Email: existing Google/Gmail connector authorization and its cloud callback.
- WhatsApp: Meta approved templates/number and HTTPS signed-webhook configuration.

After API deployment: native **More → Connection** mein HTTPS API origin save
kijiye. PWA Vercel proxy ke liye `RUDRA_BACKEND_URL` set kijiye; other static hosts
par More mein API origin enter kijiye and allow the PWA origin in backend CORS.
For an owner-preconfigured APK, set the default API origin before the release build.

## Verification boundary

Mock Google callback/session/reload/logout/replay tests pass at 320, 390 and 820px.
Existing mobile CRM/outreach browser fixtures and real service-worker offline-shell
checks pass. These do not prove an actual Google account signed in on a phone.
No paid provider action was sent. Cloud API deployment, real mobile Google consent,
on-device installation and a reviewed live operation are still required.

The Supabase advisor still reports the existing disabled leaked-password check for
email/password accounts. It does not block the Google-only login flow.
Private backend tables with RLS and no browser policies are deliberately deny-by-default;
the advisor's informational "RLS Enabled No Policy" entries reflect that server-only boundary.
[Password protection settings](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection)

The first broad public-schema migration was rejected by automatic approval review
because it could affect existing client permissions. It was not applied. A fresh,
private-schema migration passed review and was applied instead; existing public
account-data ownership policies remain separate.
