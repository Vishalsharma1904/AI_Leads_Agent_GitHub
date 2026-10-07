# Lead sources, contact quality and hosting

## What this update does

Client AI's Sources menu starts with Sulekha and Justdial. Selected directory
sources discover **publicly indexed company candidates**, not hidden phone
numbers or authenticated directory pages. Candidates must independently match
the company's business listing and requested location. The original discovery
evidence stays in the backend lead payload; customer results, CRM and exports
receive neutral source labels. Map tile attribution remains visible.

Sulekha can use virtual phone numbers. Directory numbers are never copied onto
a named person. Names/roles observed on company pages are kept separately from
company phones. A phone belongs to a named contact only when that exact Person
record publishes it. Missing website/contact information remains blank.
Official-site recovery requires the site's own page to name the company and
requested location. Alternate observed emails are preserved; company-domain
email is preferred. Search snippets are review candidates, not confirmed people.

Public search indexes can challenge requests or return no candidates. The live
probe during this change returned a challenge (202); directory contribution is
therefore **not confirmed live**. Existing discovery remains available. Direct
directory scraping/republication requires an authorized arrangement: see
[Sulekha terms](https://www.sulekha.com/collateral/terms) and
[Justdial terms](https://www.justdial.com/Terms-of-Use).

Map: labeled, keyboard-accessible company pins; company contact popup; explicit
Get route A → B control; ordinary clicks do not create endpoints. Spoken/named
routes still use the existing route/distance helpers. Expansion uses a centered
square, 720ms reversible movement, blur/dim backdrop and reduced-motion support.

## Hosting choice

Use the existing domain as **api.your-domain.com**, backed by a compute server.
A domain is an address; it does not run Python or Chromium. Supabase remains
appropriate for login, PostgreSQL and storage. Managed Edge Functions use a
Deno-compatible runtime and have 256MB memory / 2s request CPU limits, so they
cannot host this existing FastAPI + browser crawler unchanged:
[runtime](https://supabase.com/docs/guides/functions),
[limits](https://supabase.com/docs/guides/functions/limits).

For an easy supported deployment, use the existing backend Dockerfile on an
always-on **x86-64 container/VM** with Supabase PostgreSQL. Size RAM against
actual concurrent Chromium searches; do not assume a 512MB service is enough.
Render supports the existing Docker image, but its free service sleeps after
15 idle minutes and takes about a minute to wake, unsuitable for fast reopening:
[Docker deployment](https://render.com/docs/docker),
[free limits](https://render.com/docs/free).

For a zero-compute-cost attempt, Oracle Always Free currently documents
**2 OCPUs / 12GB total A1 ARM**, capacity permitting. Idle instances can be
reclaimed. Build/test the Python audio and Chromium dependencies on ARM before
choosing it for customers; the existing image has not been verified on ARM:
[official limits](https://docs.oracle.com/en-us/iaas/Content/FreeTier/freetier_topic-Always_Free_Resources.htm).

## Deployment steps

1. Obtain the compute instance/container. Keep the code repository private.
2. Deploy `backend/Dockerfile`; configure production secrets and Supabase DB
   exactly as in [desktop release guide](DESKTOP_RELEASE.md). Apply additive SQL
   migrations before enabling production; do not put provider keys in DNS/app.
3. Add the `api` DNS record to the server IP, or the container provider's given
   hostname. Serve HTTPS with the platform certificate or a reverse proxy.
   Keep the raw backend port private; expose HTTPS only.
4. Set allowed hosts, desktop CORS origins, OAuth callback URLs and verify
   `/health` (database OK) and `/api/public-config` without disclosing secrets.
5. Enter `https://api.your-domain.com` in the **installed desktop app** connection
   screen. That screen in an ordinary browser is only a preview and cannot save
   the native application's connection.

No hosting account, domain DNS or server was changed by this task. Backend
changes require the next normal backend restart/deployment. The UI source
changes load after refresh; an older packaged installer needs a rebuilt app.
The updated unsigned Windows installer is `release/Rudra24-AI-Setup-1.0.6.exe`.
Its packaged archive was audited to exclude backend code and private credentials.

## Verification

Run `tests/test_directory_discovery.py`, `tests/lead_map_selftest.js`,
`backend/tests/test_directory_pipeline.py`, and existing Apify/Stop/location/
polling tests. Component browser checks use `tests/serve-lead-map-preview.js`:
loopback only, test companies only, no account writes or paid lead searches.
