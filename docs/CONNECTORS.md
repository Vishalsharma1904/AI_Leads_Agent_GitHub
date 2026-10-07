# Rudra24 AI connectors

Connectors live in the app sidebar. They use the signed-in Supabase account; OAuth tokens and Telegram bot tokens are encrypted in the FastAPI database, never stored in browser localStorage. The page shows the real provider state, not a simulated connection.

## What works after setup

| App | Connection | Available action |
| --- | --- | --- |
| Google Workspace | Gmail asks for send and read; Workspace connect can additionally authorize Sheets, Calendar and Drive | Gmail send and on-demand inbox read; existing Sheets lead sync |
| Slack | Slack OAuth bot | Channel message |
| GitHub | GitHub OAuth App | Issue in a public repository |
| Telegram | Bot token verified with Telegram | Chat/channel message |
| Facebook Pages | Meta OAuth | Page text post |
| Instagram | Same Meta OAuth, linked Professional account | Photo post from a public HTTPS image URL |
| WhatsApp Business, YouTube | Setup information only | Not implemented; no Connect button or posting claim |

Calendar and Drive are authorized in the Google consent, but do not yet have an action in this page. Other providers such as Outlook or LinkedIn are not connected by this release. Scheduled actions run in the backend worker every 30 seconds; the service must remain awake. A failed/uncertain send is **not automatically retried**, to avoid duplicate posts. Check Recent actions before manually retrying.

## 1. Deploy the API and database

The old Google Apps Script account screen is separate and does not connect these apps. Deploy `render.yaml` as a Render Blueprint with a persistent PostgreSQL database and an always-on web service (the Blueprint uses Starter). Supabase remains the auth provider; do not put provider secrets in the desktop app. Before accepting users, run `backend/bootstrap_supabase.py` once with the production `DATABASE_URL` from a trusted environment; it creates the connector table and applies `backend/migrations/20261001_connectors.sql`. Then leave `AUTO_CREATE_SCHEMA=false`. Set the desktop `BACKEND_URL` to the deployed HTTPS API URL.

In Render Environment, set `CONNECTOR_PUBLIC_BASE_URL=https://YOUR-API-HOST` without a trailing slash. Also set `CREDENTIAL_MASTER_KEY` once and keep it backed up; changing it makes saved connections unreadable. `SUPABASE_URL`, Supabase publishable key/JWKS settings and database credentials must already be configured for login. Never place client secrets or bot tokens in `config.js` or Electron files.

The provider callback pattern is:

`https://YOUR-API-HOST/api/v1/connectors/oauth/PROVIDER/callback`

Use `google_workspace`, `slack`, `github` or `meta` for `PROVIDER`. For local development the default base is `http://localhost:8000`; production requires HTTPS. Use exactly the same callback in each provider developer console and Render's `CONNECTOR_PUBLIC_BASE_URL`.

## 2. Register developer apps

| Provider | Console and minimum setup | Render environment |
| --- | --- | --- |
| Google | [Google Cloud Console](https://console.cloud.google.com/): OAuth web application, enable Gmail API and add redirect for `google_workspace`. Gmail connection requests `openid`, `email`, `gmail.send`, `gmail.readonly`; other Workspace connections may request `spreadsheets`, `calendar.events`, `drive.file`. | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` |
| Slack | [Slack app settings](https://api.slack.com/apps): bot scope `chat:write`, redirect for `slack`; install the bot in a workspace and invite it to the target channel. | `SLACK_CLIENT_ID`, `SLACK_CLIENT_SECRET` |
| GitHub | [GitHub OAuth Apps](https://github.com/settings/developers): create OAuth App, set callback for `github`. The app requests `public_repo`; private repository issues are intentionally unsupported. | `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET` |
| Meta | [Meta for Developers](https://developers.facebook.com/apps/): Business app with Facebook Login, redirect for `meta`, Pages permissions and Instagram Graph API permissions. Connect an Instagram Professional account to a Facebook Page. | `META_APP_ID`, `META_APP_SECRET` |
| Telegram | Create a bot with [@BotFather](https://t.me/BotFather), add it to your chat/channel with posting permission; enter bot token and chat ID in the in-app dialog. | No shared developer key |

Google's `gmail.send` is a sensitive scope and `gmail.readonly` is restricted. Public distribution may require Google verification and a security assessment. Meta permissions often require App Review/Business Verification before people outside app roles can use them. Development-mode connections for test users do not mean production approval. Slack and GitHub installs require consent from each workspace/account owner. Provider rate limits, consent policies and billing remain with those providers.

## 3. Connect and test

1. Sign in to Rudra24 AI, open **Connectors** in the left sidebar, and press **Refresh**. An offline/backend error means API deployment or login must be fixed first.
2. Use **Connect** on a configured app. Complete consent in the system browser; the page polls for the linked account. For Telegram, use **Setup** to save and verify the bot token and destination chat ID.
3. Try a low-risk destination you control: send a Telegram message, a Slack message, or a Gmail email. For Meta, use a test Page/account; Instagram requires a directly accessible HTTPS image URL. Check **Recent actions** for succeeded/failed status.
4. To schedule, fill **Schedule** with a local date and time. Cancel queued actions from **Recent actions**. Do not run production campaigns before testing permissions, recipients, rate limits and opt-out compliance.

If a provider is not configured, the card says **Developer setup required**. If the API is offline, it says **Backend offline**. WhatsApp/YouTube cards intentionally say **Provider setup required** because they are guides only. If a connection expires, reconnect it. Render Free services sleep, so use an always-on service for scheduled posts.

## Current limits

This is an outbound-actions foundation, not a general no-code automation engine. Incoming events, triggers, multi-step flows, analytics and provider-specific rate limiting need a separate design. OAuth credentials and app reviews cannot be created by Rudra24 AI on your behalf; the account owner must complete provider consoles and consent. Keep the backend and database private, use a stable HTTPS domain, and review permissions before selling the app to customers.

---

# Google connector — step by step (Oct 2026 console)

The connector code is already written (`backend/api/connectors.py`). Nothing to
build; this is the one-time registration of YOUR developer app so that each
customer only ever sees "Sign in with Google → Allow".

Two different keys, do not confuse them:

| | Who holds it | Where it lives |
| --- | --- | --- |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | You, once, for the whole product | Backend environment only — never in `config.js`, Electron, or the .exe |
| Per-user refresh token | Each customer, created by their own sign-in | Encrypted in your DB by `CREDENTIAL_MASTER_KEY` |

## 0. Decide this first: do you need to READ inboxes?

`backend/api/email_sender.py` has a Gmail read path (`_gmail_get`), which needs
the `gmail.readonly` scope. That one scope is **restricted** by Google: it
forces an annual CASA security assessment (paid, repeated every year) on top of
normal verification, and can add weeks.

Everything else you use — `gmail.send`, `spreadsheets`, `drive.file`,
`calendar.events` — is lighter: verification yes, CASA no.

If reading the inbox is not needed for launch, drop `gmail.readonly` from
`GMAIL_SCOPES` in `connectors.py` (and the `required` set in the callback, and
the `can_read` checks in `email_sender.py`). Add it back later as its own
release when the feature actually ships.

## 1. Audience → External

The screen asks Internal or External.

- **Internal** only works if every customer is inside your own Google Workspace
  organisation. It is not your case.
- **External** is the right answer. The app starts in Testing mode: only Google
  accounts you list as test users can connect (a few hundred max). That is fine
  for the first customers; public launch needs verification.

## 2. Branding

Verification will be refused without these, so fill them properly now:

- App name and logo (the customer sees this on the consent screen)
- App home page — a real public URL
- Privacy policy URL and Terms of service URL — real, reachable pages
- **Authorized domains** — the bare domain of your API host, e.g. `example.com`
  for `https://api.example.com`. A raw Cloud Run `*.run.app` URL cannot be used
  as an authorized domain, so map a custom domain before verification.

## 3. Data access → Add scopes

Add exactly what the code asks for, nothing more. Every extra scope is another
thing the reviewer makes you justify.

```
openid
email
https://www.googleapis.com/auth/gmail.send
https://www.googleapis.com/auth/spreadsheets
https://www.googleapis.com/auth/calendar.events
https://www.googleapis.com/auth/drive.file
```

Plus `https://www.googleapis.com/auth/gmail.readonly` ONLY if you kept inbox
reading in step 0.

## 4. Audience → Test users

Add your own Gmail address and any early customer's. In Testing mode nobody
else can connect — a missing test user shows up as "access blocked", not as a
code bug.

## 5. Enable the APIs

APIs & Services → Library → enable: **Gmail API**, **Google Sheets API**,
**Google Calendar API**, **Google Drive API**. Scopes without the matching API
enabled fail at call time, not at consent time, so this is easy to miss.

## 6. Clients → Create client → Web application

Authorized redirect URI — exactly this, no trailing slash:

```
https://YOUR-API-HOST/api/v1/connectors/oauth/google_workspace/callback
```

Local testing also accepts `http://localhost:8000/...`. The value must match
`CONNECTOR_PUBLIC_BASE_URL` character for character; a mismatch gives
`redirect_uri_mismatch`.

The same pattern covers the other providers — swap the last-but-one segment for
`slack`, `github` or `meta`.

Copy the Client ID and Client secret at the end.

## 7. Backend environment

```
GOOGLE_CLIENT_ID=...apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=...
CONNECTOR_PUBLIC_BASE_URL=https://YOUR-API-HOST
CREDENTIAL_MASTER_KEY=<32+ characters, random>
```

`CREDENTIAL_MASTER_KEY` encrypts every stored token. Back it up: change it and
every existing connection becomes unreadable, with no way to recover them.
`CONNECTOR_PUBLIC_BASE_URL` must be HTTPS in production — the code refuses
plain HTTP for anything but localhost.

Restart the backend.

## 8. Check it

`GET /api/v1/connectors/status` must now show:

```json
{ "configured": { "google_workspace": true } }
```

`false` means the two env vars did not reach the process. Then press Connect in
the app: Google sign-in → Allow → the callback page says connected, and
`status` shows the account email.

## 9. Verification (before public launch)

Submit from the Verification centre once branding and scopes are final. Brand
verification is a couple of days; scope verification is weeks; a restricted
scope adds the CASA assessment on top. Start it well before you need it — this
is the step that decides your launch date, not the code.
