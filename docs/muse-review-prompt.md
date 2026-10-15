# Prompt for Muse AI

Act as an independent senior engineer reviewing my existing Rudra24 AI application. Work from the latest `main` at:

https://github.com/Vishalsharma1904/AI_Leads_Agent_GitHub

Record `git rev-parse HEAD` before reviewing. The app repair commit is `0a736a7`; compare it with `8f40ac9`. Later documentation commits may follow it. Do not review only the older `ab197b0` clone.

Read `AGENTS.md`, `MUSE_HANDOFF.md`, `docs/voice-assistant-repair-2026-10-15.md`, `docs/backend-audit-2026-10-15.md` and `docs/desktop-hosting-2026-10-15.md` first. Some older overview comments describe retired routing: confirm actual loaded scripts and callers before relying on them.

Keep the existing Vanilla JS interface, Supabase authentication, FastAPI backend and Electron packaging. ElevenLabs is the primary voice provider and Groq is the LLM. Do not migrate frameworks, redesign the interface, delete legacy code without unused-code evidence, weaken account isolation, or introduce a new dependency just to simplify your review.

First audit and reproduce; do not edit code during this initial review. Trace the actual frontend-to-backend flow. Prioritize these acceptance cases:

1. **Voice lifecycle:** Setup/status -> signed session -> microphone/worklet -> WebSocket -> transcription -> Groq/tools -> streamed audio -> preview -> Stop. Test permission denial and late permission resolution, backend failure, interrupted startup, repeated start/stop, barge-in, reconnect after Stop, account switching, resource cleanup and duplicate tool IDs. Hindi must use the selected account voice with matching grammar; the preview must stay readable at small widths.
2. **Assistant behavior:** Reload restores only the selected conversation; New Chat is empty; another account cannot inherit context, late results or actions. Native tool calls preserve IDs and tool-result envelopes. Malformed/duplicate calls fail before execution; sideband fallback must not duplicate a native action. Information questions cannot launch mutating work. Spoken answers stream complete sentences without reading tool JSON or private reasoning aloud. Claims of success must match real results.
3. **Lead intent:** `Fetch me five leads for Garziba` must preserve Garziba and request five, never city Fetch. Also test `Give me twenty one hotel leads in Delhi`, `Find five leads for solar services in Noida`, `Fetch me five leads for all industries`, `Do not fetch me five leads`, `Can you fetch me five leads for Garziba?`, `show my saved leads`, and capability questions. Preserve exact areas, requested totals and manual industry selection. Do not silently correct an uncertain town to another city or trigger a paid search from a question.
4. **Accounts/providers:** Review Google account chooser, verified owner authorization, credential setup for Groq/ElevenLabs/Apify, explicit individual/shared/disabled assignment, block/expiry enforcement, quotas, payment replay and cross-account isolation. Existing allowance checks must remain server-enforced. Report cost/usage estimates as estimates.
5. **Desktop/deployment:** An unconfigured 1.0.9 installer is not an activated release. Verify the customer-build configuration guard, offline reopen, safe updates and rollback. Check real HTTPS backend/database readiness before recommending a customer build. GitHub source publication does not deploy the FastAPI service. Render free is a sleeping preview, not an always-on customer backend.

Run the existing checks in the available local Python/Node environment:

```text
node scripts/run-all-checks.js
node scripts/check-installer-contents.js --strict
node tests/login_voice_release_selftest.js
node tests/desktop_runtime_selftest.js
python backend/scripts/check_backend.py test_rudra_voice_assistant.py test_elevenlabs_calling.py test_voice_chat_recovery.py test_elevenlabs_speech.py test_voice_quotas.py
```

The backend runner isolates databases and blocks external providers. If a check fails, distinguish a product failure from missing dependencies or sandbox restrictions. Do not change tests merely to hide a failure. Use an authenticated frontend/browser session where available; label synthetic fixtures clearly. Real device performance and physical Hindi microphone/pronunciation checks require actual devices and observed evidence.

Known pending live setup: the owner's ElevenLabs provider account has an existing tenant ownership conflict, and a working hosted FastAPI/PostgreSQL deployment has not been established. Do not bypass ownership, switch tenants, expose keys, reset the vault master key, or call these problems fixed because mocked tests pass. Report the precise prerequisite needed. Do not print secrets or upload private `.env`, family-provider files, databases or recordings. Do not place calls, send outreach, launch paid scraping, deploy a paid service, or modify production data during this audit.

Return an evidence-based report:

- Tested commit and commands actually run, with outcomes.
- Only reproducible findings, ordered by severity, with `file:line`, triggering input/steps, impact and the smallest safe proposed fix.
- What was tested, what was not tested, and why.
- Separate code defects from provider/account/hosting configuration gaps.
- Any regression introduced by the latest repair versus a pre-existing issue.
- A short prioritized next-work list. If no new regression is found, say so with the review's limits. Do not call the entire application perfect, flawless or production-ready without live acceptance evidence.

Propose a failing regression check for each confirmed code defect. Wait for my follow-up before implementing changes, publishing a release or pushing another commit.
