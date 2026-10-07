# Developer insights and bug reports

The Rudra24 AI sidebar exposes **Developer** only after the backend verifies a Supabase Google session for an email in `DEVELOPER_EMAILS`. The default allowlist contains `vishalsharma190405@gmail.com`; set `DEVELOPER_EMAILS` in the backend environment to change it. Users can find **Report a bug** and **Developer login** under Settings. Developer login uses the existing Supabase Google OAuth flow, including on the localhost shell.

The developer dashboard reads `/api/insights/dashboard`, which requires a verified Google OAuth token and the server allowlist. The frontend never grants developer access from a local profile, email field, or URL. Reports can be marked Open, In progress, or Resolved. Signed-in users submit reports to `/api/insights/bugs`.

Telemetry begins after this feature is deployed and a user has signed in. A heartbeat records a pseudonymous device ID, coarse platform, browser timezone, and visible session duration. No precise location or raw IP is stored in these tables. JavaScript signals contain only the error type and current app route; stack traces, user input, API keys, and request URLs are omitted. Reports include the text users choose to submit, so the form tells them to avoid secrets.

**Metric meanings:** lifetime users and first seen today come from verified backend account records. First seen is a signup proxy, since Supabase signup events are not currently ingested. Signed in today counts distinct verified users seen in an app session today, with app opens alongside it; it is not an OAuth login event count. Active means a heartbeat in the previous two minutes. Peak hours use each session's browser timezone. Usage time is accumulated from visible heartbeats. Device rows show devices that have been observed since this feature launched; they do not list or revoke every Supabase refresh token.

For production PostgreSQL with `AUTO_CREATE_SCHEMA=false`, apply [`20260929_product_insights.sql`](../backend/migrations/20260929_product_insights.sql) before deploying the backend. Development SQLite creates the tables automatically. The frontend still loads without the backend, but reports and shared metrics require the backend and Supabase Auth.

Checks:

```powershell
backend\.venv312\Scripts\python.exe -m unittest backend.tests.test_developer_insights -v
backend\.venv312\Scripts\python.exe tests\developer_insights_ui.py
node scripts/verify-app-integrity.js
```
