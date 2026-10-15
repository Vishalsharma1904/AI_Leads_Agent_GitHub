# Workspace size cleanup — 12 October 2026

Immediately after cleanup the workspace occupied **1,966,861,705 bytes (1.967 GB / 1.832 GiB)**. After preparing the private cloud deployment snapshot, the final scan measured **1,970,415,809 bytes (about 1.970 GB / 1.835 GiB)**, still below both decimal 2 GB and binary 2 GiB. Both scans reported no errors. External Python environment junctions were preserved and excluded from the workspace measurement.

Approximately 3.79 GB of generated Android build tools, downloaded installer archives, build caches, and duplicate unpacked application runtimes were removed. Source, Git history, installed application dependencies, user data, exports, packaged installers, Android platform-tools, and the final Android APK were preserved.

The APK remains **9,625,120 bytes**. Its SHA-256 is unchanged:
`73eb68375b76e7ec7ee332c0193dc83cd4e1ab77d70286be86bea5de23bd00b0`.

Recovery evidence is in `work/cleanup-recovery-20261012/`:

- `packaged-app-resources.zip`: verified recovery archive of removed packaged application resources.
- `preservation.json`: resource hashes and protected source/APK hashes.
- `cleanup-plan.json`: exact removed paths, counts, and bytes.
- `size-after.json`: final measured size and preserved external links.
- `size-final.json`: measurement including the subsequent cloud deployment work.

The duplicate Dad runtime was checked against the preserved original ZIP before removal. Standard Electron runtimes and Android tools can be downloaded again; application resources were backed up separately before deletion.

`scripts/compact-workspace.ps1` audits by default. Its `-Apply` option removes only the generated allowlist and refuses tracked files, credentials, databases, signing keys, nested junctions, or paths outside this workspace. Do not use it to remove actual source or user data.

The strict source installer-content check and the mobile Google-auth, contract, and proxy checks passed after cleanup. The old unpacked package fixture was outdated and was not counted as a passing package audit.

The existing `Rudra24Mobile/Build-Android.ps1` downloads missing build tools on the next build. Rebuilding can temporarily increase workspace size; installing or using the existing APK does not require these PC tools.
