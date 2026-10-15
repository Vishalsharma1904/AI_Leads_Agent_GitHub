# Update delivery implementation and verification

## Delivered behavior

The existing Electron shell continues to launch the local cached application. It discovers owner-published UI releases through the authenticated backend, downloads a manifest and compressed JSON asset bundle in the background, and switches the static UI directory before creating a window on the next launch. Running chats, calls, lead searches and drafts are never reloaded by an update timer. The original installed UI remains the immutable fallback.

`electron/ui-updates.js` verifies an Ed25519 signature over the exact manifest bytes against a public key bundled with the shell. It verifies SHA256 for the manifest, compressed bundle and every decoded asset, checks the shell compatibility interval, and accepts only exact allowlisted HTTPS hosts without credentials, alternate ports or redirects. Bounds are 1 MiB manifest, 64 MiB compressed bundle, 128 MiB expanded JSON and decoded assets, and 5,000 files. File paths exclude traversal, absolute paths, Windows device names, alternate data streams, shell/backend directories and executable extensions. Extraction writes only new regular files into a temporary directory under the app's `userData/ui-releases`; rename and atomic state replacement happen after verification. Downloaded files are served to the sandboxed renderer, never required as privileged Node code.

Each startup verifies cached files again. An unacknowledged first boot, renderer crash or failed main-frame load falls back to the previous verified UI, then the installed UI. The renderer acknowledges a boot after thirty seconds with the main surface and auth controller available and no captured error event. A ninety-second watchdog only records the missing acknowledgement; it never reloads an active window. Closing a newly updated app before acknowledgement conservatively reverts it on the next launch. Unreferenced release directories are removed after a healthy boot, retaining the current, previous and pending releases. Failed hashes are quarantined; publish a corrected artifact with a different signed manifest to retry.

`update-client.js` checks after auth/capability events, reconnect and periodically. It announces a staged update and leaves application until the next launch. This is the conservative idle policy: no attempt to infer that an untracked voice session or unsaved form is safe to reload. A successful online discovery returning no release clears pending delivery. Pause stops new discovery, but an already staged offline release cannot learn about a subsequent pause until the next successful online check. Active offline UI also cannot learn about remote account revocation until the API is reached; backend authorization remains authoritative for work.

The preload exposes only hardware hints, update status, validated release staging and boot acknowledgement; it exposes no filesystem, signing key, arbitrary IPC or shell method. Existing sandbox and context isolation remain enabled. Packaged launches set `CLAVIS_MANAGED_ACCESS=true` for backend-only credential access.

## Signed desktop UI contract

`GET /api/control/release?platform=desktop-ui` uses the user's bearer token and returns `{release:null}` or a release with `version`, `platform:'desktop-ui'`, `status:'published'`, and `manifest:{url,sha256,signature,tested,compatibility}`. Database release IDs and signed artifact IDs are separate. SHA256 values are lowercase hex; signature is base64 Ed25519 over the downloaded manifest's exact bytes.

The manifest is:

```json
{
  "schema": 1,
  "id": "artifact UUID",
  "platform": "desktop-ui",
  "version": "1.0.7",
  "compatibility": {"minShell": "1.0.6", "maxShell": "1.0.6"},
  "bundle": {"url": "https://trusted.example/ui/bundle.json.gz", "sha256": "64 lowercase hex characters", "bytes": 12345},
  "files": [{"path": "index.html", "sha256": "64 lowercase hex characters", "bytes": 123}]
}
```

Versions are stable three-part numeric versions; this client intentionally rejects prereleases. `files` must include `index.html` and `update-client.js`. The gzip bundle contains `{files:[{path,data}]}` with canonical base64 data. It contains UI code/assets only. The local API/proxy server, Electron main/preload, PC Bridge, credentials and desktop connection page stay in the installed shell. A shell-compatible bundle cannot introduce a new privileged IPC/API operation; that requires a native shell release.

Rollback discovery may return a prior published release plus `rollback_from` referencing the rolled-back database release. The client accepts a downgrade only to its exact previous cached, signed manifest hash/version, or its immutable installed version when that was the previous fallback. An arbitrary lower artifact is rejected. Rollback therefore needs no new private-key operation for an already verified prior release. A client that did not cache the selected previous release retains its current UI and requires a newly published forward version or a native reinstall.

## Provisioning and build

UI update trust is deliberately unprovisioned in `electron/update-trust.json`: no production signing key was generated and no host was invented. Provision an Ed25519 public key and exact artifact host allowlist into the first updated shell build using `RUDRA_UI_PUBLIC_KEY` and `RUDRA_UPDATE_HOSTS` (comma-separated hostnames). `electron/prepare-build.js` refuses a private key or non-Ed25519 public key. Existing customer installers that lack this updater need one installer upgrade before they can receive UI bundles.

Run `node scripts/build-ui-release.js` / `npm run build:ui-release` in release CI with:

- `RUDRA_UI_SIGNING_KEY`: private PEM supplied through the CI secret environment only.
- `RUDRA_UI_VERSION`, `RUDRA_UI_BASE_URL`, `RUDRA_UI_MIN_SHELL`, `RUDRA_UI_MAX_SHELL`.
- `RUDRA_UI_NOTES` optionally; `RUDRA_UI_TESTED=true` only after testing the actual candidate.

The builder checks that the private key matches the already bundled public verification key, excludes non-UI paths and likely secrets, and emits a signed manifest, gzip bundle and owner release JSON under `release/ui`. It does not upload, publish, mark a real candidate tested, generate a key, or execute a deployment. Upload artifacts to immutable versioned HTTPS URLs and configure backend `CLAVIS_RELEASE_HOSTS` to agree with the shell allowlist. Register the release JSON through the existing owner endpoint, test the owner cohort, then promote through its existing 5%, 25% and 100% stages. Pausing and rolling back remain owner actions.

## Native Windows releases

`electron-updater@6.6.8` is installed with the package lock and existing electron-builder 26/NSIS packaging. `electron/native-updates.js` remains disabled until the build provisions `RUDRA_NATIVE_FEED` and `RUDRA_NATIVE_PUBLISHER` along with the public trust configuration. Signed NSIS releases require real Authenticode signing, an `app-update.yml` containing exactly the trusted publisher name, an allowlisted HTTPS generic feed, `latest.yml`, its verified installer/checksum and standard updater artifacts. Signature verification and web-installer rejection remain enabled. UI signing and Windows Authenticode signing are separate keys.

The library verifies installer SHA512 and Authenticode publisher. Native metadata file URLs must match the embedded host allowlist and advertise a size at most 256 MiB; progress over the limit cancels the download. The native library manages its transport/cache and redirect handling; the custom UI-bundle downloader rejects redirects outright. Native update files are not applied on app quit. A completed download writes a pending marker; a later launch rechecks and verifies the installer before a silent install/restart, only while no app window exists. A two-second startup budget defers a slow/offline feed to another launch, so cloud availability cannot hold the cached UI indefinitely. No native signing, native feed, installer download or live installation was tested here.

## Web, PWA and Android

The PWA service worker now uses a versioned complete shell snapshot (`rudra24-mobile-v4`) and serves cached shell assets consistently instead of replacing each file independently from the network. Bump `VERSION` for every PWA release and deploy the complete asset set atomically. Auth configuration, query-bearing auth callbacks, external requests and API responses are never cached. Login configuration is fetched live, so offline shell rendering does not imply offline authentication.

An installed waiting worker is applied only through the update button with no busy state, edited draft, review/transcript dialog or active known job. A second app tab causes deferral. Closing all app tabs also lets the browser activate the waiting version naturally. There is no forced update reload during active work.

The root web application now has its own controlled worker in `sw.js`. Run `npm run build:web-release` with `RUDRA_WEB_VERSION=X.Y.Z` to generate `web-assets.json` and stamp the exact manifest SHA256/version into the worker. This uses the same static asset inventory and secret/path exclusion as the desktop builder, without requiring a desktop private signing key. The worker verifies the pinned manifest digest and every asset hash/size before installation, with bounded streaming reads, and caches an entire version consistently. Same-version builds with changed assets receive distinct manifest-hash cache namespaces. It deletes only its own `rudra24-web-` caches. Dynamic desktop connection configuration, bearer requests, API/auth paths and callback queries bypass caching. Cached installation is deliberately unprovisioned in this source checkout until the release build/deployment runs. No real `web-assets.json` or live web release was created here; the fixture builder was tested.

The root web client announces a waiting worker and lets it activate after all app tabs close. It never reloads a browser session automatically. The worker also enforces a single-client check if an explicit activation is requested. Deploy the complete static snapshot and generated manifest atomically; changing a cached asset in place without rebuilding the manifest causes installation to fail safely. HTTPS hosting is the web worker's trust boundary; its pinned digest provides snapshot integrity, while the desktop independently verifies its private-key signature. Hosted root registration uses `updateViaCache:'none'`; localhost desktop/source launches still unregister browser workers.

Android native code, permissions and Compose screens require a signed APK/store update; a JavaScript bundle cannot replace them. No Play Store update API, sideload installer bypass or silent Android native updater is claimed or added. The PWA shell can update its own web assets through its worker; hosted backend behavior remains server-controlled.

## Verification evidence

- `node tests/update_delivery_selftest.js` passed with ephemeral in-memory signing fixtures: hash/signature rejection, URL/path/byte bounds, compatible staging, no immediate switch, restart activation, failed-start fallback, local tamper fallback, immutable installed rollback, previous cached rollback, paused pending clearing, PWA auth exclusions/explicit activation, and generated root web snapshots with hash verification, version-consistent assets and preservation of unrelated caches.
- Node syntax checks passed for the updater, build script, Electron main/preload/prepare-build, desktop client, and PWA files.
- `node scripts/check-installer-contents.js --strict` passed.
- Existing mobile contract and Google OAuth PKCE suites passed.

These are local contract/fixture checks. Production signed artifacts, release CDN, authenticated owner-to-customer rollout, a newly built customer installer, real offline Windows restart/recovery, real Windows signing/install, deployed PWA cross-tab behavior and physical Android/store delivery still require their own authorized verification.

### 2026-10-14 baseline follow-up
Windows installer 1.0.8 is now built and its actual archive inspected; packaged source bytes matched the source at build time. Later Dad portable-launcher/proxy fixes are in the separate corrected ZIP, not this earlier installer. Its Authenticode status is NotSigned, with first-run backend connection and empty production update trust. Root web snapshot 1.0.8 is generated locally. These replace the earlier statements that no real web snapshot/customer build had been created; live publication, signed update trust and physical installation tests remain pending.
