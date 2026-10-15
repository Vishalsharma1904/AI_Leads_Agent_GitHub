# Rudra24 voice and assistant repair — 15 October 2026

Scope: the existing root Vanilla JS/FastAPI application, continuing commit `8f40ac9`. The supplied flaws report audited the older `ab197b0`; its master prompt was evaluated as advice, not copied as executable instructions.

## Repaired behavior

| Failure | Change |
| --- | --- |
| “Fetch me five leads for Garziba” searched in “Fetch” for the default quantity | The shared parser distinguishes the English pronoun “me” from a Hindi location marker, preserves unknown locations, and understands spoken English quantities. Explicit locations, saved defaults and requested totals remain authoritative. |
| An explicit new search stopped at an industry picker | Broad searches use the saved/default buyer scope. Explicit manual scope selection remains available; capability questions and saved-lead views do not authorize a paid search. |
| Reloaded conversations were visible but absent from model context | Before a turn, the engine restores the selected conversation only. New chats stay empty; account/conversation changes invalidate stale restores and pending turns. Context remains bounded, with the existing persistent facts store. |
| Native provider tool calls were ignored | Registered skills are sent as native function tools. Calls retain their IDs and standard assistant/tool result envelopes. The legacy text format remains a compatibility fallback. Duplicate IDs, malformed JSON, invalid argument objects and invalid call lists fail before any action. Information questions expose only the existing read-only allowlist. |
| Spoken statistics waited for the entire answer | Voice answers can deliver complete sentence chunks while the provider streams. Tool JSON and reasoning markers remain outside spoken output. |
| Live Hindi prompt contradicted the speech settings | Live voice uses the account's Hindi-aware/manual voice selection, loads metadata on first use, writes Hindi speech in Devanagari and follows the selected voice's gender. The app guide supplies feature facts without injecting its help-only tool ban into every live turn. |
| Generic “Voice session could not start” hid validation failures | Safe field names identify invalid setup without echoing request contents. Gateway/network failures produce a recoverable error. Ownership conflicts retain their explanation instead of repeatedly reopening the key-paste form. |
| Stop during permission/startup could leave a microphone or HUD behind | Session-generation guards discard late streams/worklets, stop tracks, abort session requests, and prevent obsolete reconnect timers or animation callbacks reopening a stopped session. Hidden voice controls are inert. |
| Voice website reading returned unauthorized | The live website reader forwards the verified account bearer and cancellation signal. A late screenshot cannot enter another account/session. Repeated voice tool-call IDs reuse a bounded result cache instead of starting another paid search. |
| Tool schemas made `double: "false"` truthy | Boolean flags and optional argument lists have boolean/array schemas in both tool paths. |

The fallback after exhausting action rounds now reports that a final answer was not reached; it does not invent a successful completion.

## Verification

- Root gate: `node scripts/run-all-checks.js` — **39 suites passed**, with all 157 root scripts parsing. It includes the new parser, selected-history/native-tools, app-guide, intent and client-scope checks.
- Focused live voice: **28/28**, plus **13/13** pure helper checks, cover startup, audio packets, barge-in, reconnect, stale timers, pending permission, tool replay, setup errors and cancellation. Assistant context: **9/9**, covering restore isolation, native tool results, malformed calls, schemas and streamed speech. Older budget assertions were refreshed against the existing reasoning-aware output budget; production token limits were not lowered just to satisfy a stale test.
- Backend gate uses isolated databases and blocks external provider connections: `python backend/scripts/check_backend.py test_rudra_voice_assistant.py test_elevenlabs_calling.py test_voice_chat_recovery.py test_elevenlabs_speech.py test_voice_quotas.py` — **70 cases passed**. After the final ownership-message clarification, the affected voice/calling subset passed again (**33 cases**).
- Installer content, desktop runtime and login/voice release contract checks passed. No new customer EXE was published.
- Actual Chrome used the real app markup/styles and current voice controller with an explicitly labelled synthetic account/audio/provider fixture: invalid setup → corrected retry → listening → stop. This verifies frontend lifecycle, not physical microphone quality or a live ElevenLabs conversation. Screenshot: `work/voice-repair-browser-proof.jpg` (local, ignored).
- Owner-only Groq smoke: two small synthetic requests through the actual backend gateway returned a native `get_lead_stats` request and a nonempty answer grounded in its supplied test result. No leads, messages, phone calls or microphone audio were generated by this check. Provider output remains nondeterministic; this is a bounded smoke check, not a quality guarantee.

## Remaining activation prerequisites

1. **ElevenLabs ownership:** the owner's connected ElevenLabs account is already bound to another local app account. A valid key does not transfer that binding. Use the original sign-in, a separate provider account, or explicit Shared providers plus user assignment in the existing Developer Panel. No other tenant's configuration or resource ownership was changed. A cross-account live sync was declined by automatic approval review and was not bypassed.
2. **Hosted backend:** both the signed-in Render dashboard and connector inspection found no service in the owner's workspace. Local backend configuration contains a local database address, not a usable cloud PostgreSQL connection. The root `render.yaml` now defaults to a free preview; it does not provision a new database. Configure the existing Supabase database connection and original credential-vault key privately before deployment. Free preview sleeping is incompatible with an always-on customer service.
3. **Downloaded desktop:** the existing 1.0.9 installer has no hosted backend/service-config URL. Its setup screen cannot be resolved by publishing source to GitHub. After the HTTPS backend passes health/auth/database checks, build `npm run dist:customer` with the verified backend/public connection URL. The customer-build guard intentionally refuses an unconfigured release. Existing installers do not acquire these source fixes automatically.
4. **Real acceptance:** physical mic/Hindi pronunciation, installed-app login/account switching, live payment/PSTN, signed update rollout/rollback and real 4 GB/8 GB performance remain separate acceptance work. No zero-error or production-ready claim is made.

No new memory-summary service, scheduler, provider dependency, architecture migration or speculative deletion of legacy files was introduced. Automatic summarization of the entire conversation archive is not implemented; selected recent history and explicit stored facts are the current memory contract.

Provider contract references: [official ElevenLabs SDK](https://github.com/elevenlabs/elevenlabs-python/blob/main/reference.md), [Render FastAPI deployment](https://render.com/docs/deploy-fastapi).
