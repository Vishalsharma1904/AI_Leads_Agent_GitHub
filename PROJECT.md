# Project: Nexus AI - B2B Client Acquisition Platform

## Architecture
- **Target Audience**: Exclusively discovers REAL, publicly verifiable B2B client companies requiring **Security Guards** and **Housekeeping Staff** (Hotels, Hospitals, Factories, Warehouses, IT Parks, Schools, Malls, Banks, Residential Societies, etc.).
- **Data Verifiability & Zero Fake Policy**: Strict enforcement of authentic public records only (`DataSanitizer`). Every lead is accompanied by an authoritative `Source URL`.
- **Multi-Stage Discovery & Deep Web Crawler**: Crawls sub-pages (`/contact`, `/careers`, `/procurement`, `/facilities`, `/vendor-registration`, `/tenders`) and categorizes role-based emails (*Official, HR, Admin, Purchase, Vendor, Facility*).
- **AI Opportunity Scoring & 5-Star Priority Engine**: Calculates *Security Requirement Probability %*, *Housekeeping Requirement Probability %*, and *Lead Score (0-100)* with 5-Star ratings (★★★★★ to ★) and empirical AI rationale.
- **Advanced API Key Rotation**: Automatic key failover on HTTP 429 rate limits or errors, live credit counter, remaining credits meter, health status monitor, and failover history logging.

## Milestones
| # | Name | Scope | Dependencies | Status |
|---|------|-------|-------------|--------|
| 1 | UI Visibility & Safe View Rendering | Ensure all 15 views render without freezes or syntax errors; appShell always visible. | None | DONE |
| 2 | Authentic Client & Candidate Data Enforcement | DataSanitizer & Apify extraction; filter out dummy phone/email/name records. | M1 | DONE |
| 3 | Version Snapshot & 1-Click Recovery System | SnapshotManager module, IndexedDB v7 schema backup/restore/export/baseline. | M1 | DONE |
| 4 | E2E Integration & Verification Audit | Full integration verification across R1, R2, R3 with forensic integrity audit. | M1, M2, M3 | DONE |
| 5 | AI Client Acquisition Transformation | B2B scoring engine, role email categorization, API key rotation, deep sub-page crawler, multi-criteria filtering, and live progress visualizer. | M1, M2, M3, M4 | DONE |

## Interface Contracts
- `ViewRouter`: Navigates to hash routes (`#<view>`), mounts view headers, widgets, controls safely with `try...catch` wrappers around all 15 view renderers.
- `DataSanitizer`: `isFakeEmail(email)`, `isFakePhone(phone)`, `isFakeName(name)`, `sanitizeLead(lead)`, `sanitizeCandidate(cand)`.
- `AIScoringEngine`: `scoreCompanyLead(lead)` calculates securityScore, housekeepingScore, leadScore (0-100), priorityStars, and scoreReasons.
- `MemoryEngine`: `recordApiError()`, `getLastApiError()`, `getApiUsageLogs()`, `rotateToNextApifyKey()`, `getCachedWebPage()`, `setCachedWebPage()`.

## Code Layout
- Root files: `config.js`, `memory.js`, `agent.js`, `app.js`, `auth.js`, `index.html`
- React components: `frontend/src/pages/CandidateAI.jsx`
- Android Webview Assets: `AndroidApp/app/src/main/assets/memory.js`
- Metadata: `.agents/` directory

