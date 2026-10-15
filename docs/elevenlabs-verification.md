# ElevenLabs voice and workspace verification

8 October 2026. Changes are in the existing root Vanilla JS app and FastAPI backend.

## Verified

- 28 ElevenLabs backend tests: tenant key storage, protected tokens, stream/error/fallback behavior, agent/phone/tool/knowledge ownership, provider payloads, source content preview and validation.
- 5 existing login/security tests.
- 7 executable PCM output/settings checks; persistent Scribe/input/brain checks; calling lifecycle/source/selection/timeout/account checks; shared microphone lifecycle checks; existing settings round-trip checks.
- All 20 realtime pipeline checks passed. Existing voice and lead verifiers passed during integration.
- Browser checks used real production scripts and the full actual stylesheet stack with explicitly mocked provider/audio responses. Agent save, Text and Website source creation, content preview/Escape, attach/save source selections, Tools actions/save, native dropdowns, keyboard tab switching, Calling handoff and call confirmation were exercised.
- Desktop 1280px and mobile 390px; no horizontal overflow. Dark-theme input text/background were readable. Selected tabs and source switches use transparent backgrounds, straight borders, zero radius and no shadow. Setup has no tag badges or nested provider cards; mobile dialog fits the viewport and Escape restores focus.

## Limits

No real ElevenLabs/Groq key, physical microphone conversation, paid generation or PSTN call was used. Latency, acoustics, account plan eligibility and carrier routing need the user's live test. The restarted local backend advertises the new calling, Scribe-token and source-preview routes in its OpenAPI schema; unauthenticated source-preview access returns 401. Other deployments must restart to load the new routes; deployments with AUTO_CREATE_SCHEMA disabled must apply the included ElevenLabs resource migration.

The broad repository runner is not green: its middleware CommonJS syntax check, existing theme-flow stylesheet-order check, sidebar contract and quiet/wake contract checks fail. These are distinct from the passing targeted feature tests; the complete runner log is tests/artifacts/elevenlabs-full-checks.log. Parallel Claude changes to budget/wake/sidebar files were preserved.

An older parallel edit overwrote the studio during work. The restored reviewed version was tested again and retained at tests/artifacts/elevenlabs-studio-reviewed.js for recovery. The stable studio source and reviewed copy matched after final integration.
