# Nexus AI Leads Agent — Project Context

## Overview
This repo now contains **two products**:

1. **Nexus AI B2B Lead Generation Agent** (original) — a browser-based app that finds companies needing security guards/housekeeping staff (Hotels, Hospitals, IT Parks, Malls). Runs entirely in the browser, no server required.
2. **Jarvis AI** (new) — a personal/business assistant, also browser-based, accessible from its own sidebar entry ("Jarvis AI"), separate from the lead-gen "Chat AI". Jarvis handles general conversation, persistent long-term memory, and call-script generation. It's powered primarily by **OpenRouter** (free-tier models, auto key+model rotation — see `jarvis.js`), with Groq/DeepSeek/Moonshot/NVIDIA as fallback.
   - For **real outbound phone calls**, there's a separate FastAPI backend in `backend/` using **Exotel** (India-focused telephony — chosen over Twilio for DLT/TRAI compliance and INR billing) + OpenRouter for the live voice pipeline (STT: faster-whisper, TTS: Piper). This backend must be run separately (`uvicorn main:app`) and requires its own `.env` (see `backend/.env.example`). It is NOT required for Jarvis's in-browser chat/voice-input mode to work.

## Tech Stack
- **Frontend**: Vanilla HTML + CSS + JavaScript (no framework)
- **AI Chat**: Groq API (LLM for natural language lead queries)
- **Lead Scraping**: Scrapling (keyless, self-hosted Google Maps discovery — see `backend/services/leads/maps_scraper.py`, exposed at `POST /api/v1/leads/maps-search`), plus the existing Crawlee+Playwright website-contact enrichment (`POST /api/v1/leads/enrich-websites`). Apify is no longer required for lead-gen (2026-09 — replaced per owner request; see `backend/requirements.txt` for the `scrapling install` step).
- **Data Export**: Excel (.xlsx), CSV, Google Sheets sync
- **Email**: Google Apps Script webhook for email automation
- **Styling**: Custom CSS; final look = `clavis-claude.css` (Geist + Source Serif 4, Claude-inspired minimal)

## Project Structure
```
├── index.html          # Main single-page application
├── styles.css          # All CSS styles (glassmorphism, dark theme)
├── app.js              # Core application logic, UI controllers (lead-gen)
├── agent.js            # Lead generation agent (Apify integration)
├── chat.js             # Lead-gen chat interface (Groq/multi-provider)
├── jarvis.js           # Jarvis AI engine — OpenRouter-first, memory, call scripts
├── jarvis_ui.js         # Jarvis UI controller (chat rendering, voice, modals)
├── memory.js            # IndexedDB persistence (leads, candidates, Jarvis memory/scripts)
├── auth.js              # Client-side-only auth (NOT secure — see security notes below)
├── config.js            # API keys, webhook URLs, settings
├── email_script_gas.js # Google Apps Script for email automation
├── README.md            # User documentation (Hinglish)
├── clavis-ear.js        # Hearing: self-echo guard, Voice ID (opt-in), double-talk barge-in, Siri-style live caption
├── clavis-intent.js     # Instant local intents (close map / close everything / map control / voice switch), habits, display skills
├── clavis-voice.js      # TTS: female-first (Gemini TTS, key+model rotation, emotion styles) → male fallback that speaks Hindi
├── clavis-automation.js # PC + website automation (open apps, type into them, multi-step tasks, website brief)
├── clavis-olive.css     # Rich olive-green primary buttons + send button (tokens: --olive-*, --cream)
├── clavis-business.js   # Business profile (what the owner sells): lead search list, competitor filter, fit score, prompts
├── clavis-appearance.js # Settings → Appearance: themes, accent, surface/text colours, fonts, minimal (loaded in <head>)
├── clavis-perf.js       # Graphics tiers Auto/Smooth/Max (orb DPR/fps/glass, blur) — loaded in <head> before the orb
├── clavis-silk.css      # Slow expo-out motion for menus, dialogs, chat bubbles, buttons
├── clavis-claude.css    # LAST layer: Claude-inspired look — --cc-* tokens, ivory/serif, dialogs, menus, motion
├── clavis-claude.js     # Claude-style hover cards on the sidebar rail
├── clavis-icons.js      # Feather icon set (MIT) + runtime swap of old icons/emoji → Feather
├── sarvam-calling.js    # Sarvam voice calling ENGINE — config, REST client, sequential call queue, threads (own IndexedDB `clavis-calls`)
├── sarvam-calling-ui.js # Calling Agent page (#calling) — queue, per-contact chat threads, master-agent setup sheet, email/meeting handoff
├── sarvam-calling.css   # Its look, built only from clavis-claude.css `--cc-*` tokens
├── fonts/               # Bundled Geist (UI) + Source Serif 4 (headlines) woff2 — OFL licensed
├── AndroidApp/          # Android WebView wrapper
└── backend/             # Separate FastAPI voice-calling server (Exotel + OpenRouter)
    ├── main.py                              # API entrypoint incl. /ws/audio, /api/calls/outbound
    ├── services/llm/openrouter.py           # Cloud LLM brain for live calls
    ├── services/telephony/exotel_adapter.py # India telephony — real outbound calls
    ├── services/conversation/orchestrator.py# STT -> LLM -> TTS pipeline w/ VAD buffering
    └── websocket/audio_handler.py           # Exotel AgentStream protocol (raw PCM16)
```

## Security Notes (unresolved — flag before any production deploy)
- `config.js` has hardcoded API keys committed to source. Rotate and move to env/gitignored config before pushing this repo anywhere public.
- `auth.js` stores passwords in plaintext in localStorage with no server-side verification — do not rely on it to gate anything sensitive (e.g. real calling credentials) until replaced with real backend auth (bcrypt/PyJWT are already in `backend/requirements.txt` but unused).
- `backend/.env` (once created from `.env.example`) will hold real Exotel/OpenRouter secrets — never commit it.

## Key Architecture
- **No build tools** — open `index.html` directly in browser
- **Multi-API key rotation** — auto-switches on quota exhaustion (429 errors)
- **Smart local parser** — fallback when Groq API unavailable
- **LocalStorage** — all data persisted client-side via `memory.js`

## Configuration
All API keys and settings are in `config.js` via `window.SKYLARK_CONFIG`:
- `APIFY_API_KEYS[]` — legacy, no longer used by lead scraping (see Tech Stack above)
- `GROQ_API_KEYS[]` — up to 5 keys for AI chat
- `SHEETS_WEB_APP_URL` — Google Sheets sync endpoint
- `EMAIL_WEBHOOK_URL` — Email automation webhook
- `DEFAULT_CITY` — Default search city (Gurugram)

## Voice pipeline rules (2026-09)
- Spoken words are NEVER typed into the composer — they preview in the live caption (`ClavisEar.caption`).
- Every recognizer transcript goes through `ClavisEar.judge()` (via `commitJarvisVoiceInput`) so Rudra24 AI never answers its own voice.
- "Close / close everything" clears Rudra24 AI's own screen (display + floating window) — never the user's PC apps.
- Wake gating (clavis-wake.js, 2026-09-24): Rudra24 AI is ASLEEP by default — no LLM call and no Live stream until "Rudra" / "Hey Buddy" / "Hey Clay", snap, clap, orb/mic tap or typing. After a reply a ~9 s follow-up window (`clavis_followup_ms`), then back to sleep. Every background AI caller must check `ClavisWake.allowBackground()`; `ClavisDirect.complete({background:true})` rejects with code 'asleep'. Side talk → the LLM replies `[[silent]]` and the UI hides it and sleeps.
- Orb = clavis-orb.js (single-pass WebGL1, round by construction; same `window.StrandsOrb` API). strands-orb.js is no longer loaded.
- Key onboarding = clavis-setup.js (`ClavisSetup.open()`); free browser voice prefers Swara Online / Google हिन्दी with Roman→Devanagari transliteration (clavis-voice.js).
- Sleep: "thodi der chup ho jao" → `go_to_sleep` / `ClavisIntent.sleep()`; `clavis_slept_at` makes the next wake (name / snap / clap) a one-time sleepy "meri aankh lag gayi thi" greeting.
- Risky actions (delete, send, overwrite, bulk, closing PC apps, spending) are confirmed once in his language; harmless ones (show, open, search, on/off switches) just happen.

## UI design rules (owner's standing request, 2026-09-24)
- Every new screen, dialog or component takes its look from **claude.com first** and **Wispr Flow (wisprflow.ai) second**: minimal, calm, soothing.
- The look lives in `clavis-claude.css` (loaded last) + `clavis-claude.js` (sidebar hover cards). Use its `--cc-*` tokens for anything new — never hard-code colours:
  - ground: `--cc-shell` (sidebar/top bar), `--cc-sheet` (ivory page #FAF9F5), `--cc-surface` (white cards/dialogs/menus), `--cc-sunk` (wells, tags, user bubble)
  - ink: `--cc-ink` #141413, `--cc-ink-2`, `--cc-mute`, `--cc-faint`; lines: `--cc-line`, `--cc-line-2`, `--cc-line-3`
  - one flat green accent `--cc-accent` (no gradients, no glow); `--cc-on-accent`, `--cc-accent-soft`
  - type: `--cc-serif` (Source Serif 4 — headlines, greetings, big numbers, dialog titles) + `--cc-sans` (Geist — all UI text). Both are bundled in `fonts/` so they work offline.
  - corners: buttons/inputs/menu items 8px, cards 12–14px, dialogs 16px, composer 20px
  - shadows only on things that float: `--cc-sh-pop` (menus, toasts, hover cards), `--cc-sh-dlg` (dialogs). Resting cards are flat with a hairline.
  - motion: `--cc-ease` (expo-out) 420–640 ms in, ~200 ms out; dialogs/menus ease in with opacity + a small scale + blur→clear. Animate opacity/translate/scale/filter only; honour `prefers-reduced-motion`.
- Icons: **Feather only** (bundled in `clavis-icons.js`). New markup: `<i data-fi="map-pin"></i>` or `ClavisIcons.svg('map-pin')`. Old SVG icons and emoji-as-icons are converted at runtime by label (see `RULES` / `EMOJI` in clavis-icons.js — add a rule there when a new control gets the wrong icon). Icon tiles are one calm tone (`--cc-sunk`), never coloured.
- No emoji in UI, no sparkle/"AI" icons, no rainbow icon tiles, no fake window chrome.
- 60 fps rules (2026-09-25): animate only transform / translate / scale / opacity / clip-path. Never transition width, height, top/left, margin or padding on anything big — lay out once, then move with FLIP (see the sheet slide in clavis-claude.js, map expand in clavis-canvas.js, Peek window in clavis-task-surface.js). The rail peek floats OVER the page. No full-screen backdrop blur, no blur on large windows. Pollers/observers must write to the DOM only when a value actually changed (a same-value classList.add/textContent write still fires observers and a full-page style recalc, ~40–60 ms on this page).
- Settings → Appearance overrides the `--cc-*` tokens with a 9-id selector (clavis-appearance.js), so user picks still win.

## Lead generation — how it really runs (2026-09-30)
- **One parser for every surface**: `lead-candidate-domain.js` (`window.LeadCandidateDomain.parseRequest`) turns free text into `{cities, industries, serviceTypes, count, isSearch}`. Voice, Client AI chat, Gemini Live, app-map and commands all route through it. Widen intent HERE, never per-surface.
- **One live engine**: `page-agent.js` overwrites `window.startAgentPipeline` with `RealScraper.run()`, so every entry point lands in `real-scraper.js` → backend `POST /api/v1/leads/maps-search` (Scrapling) then `POST /api/v1/leads/enrich-websites` (Crawlee visits `/contact`, `/about`, team pages). `agent.js PipelineEngine` is orphaned in the web app but still live in `AndroidApp/`.
- **City spelling is load-bearing.** One canonical name per city, and it must be the spelling Google Maps prints in an address — `real-scraper.js matchesRequestedLocation` filters on it. `Gurgaon` vs `Gurugram` used to drop *every* lead in a run and report "no businesses found in this area". Matching now goes through `LeadCandidateDomain.aliasesFor(city)`; add new spellings to `CITY_ALIASES` and nowhere else.
- **Never rewrite a town he named.** The fuzzy typo matcher is capped at edit distance 1; at 2 it turned "shimla" into Shamli and "udaipur" into Jaipur. An unrecognised town keeps his spelling and goes to the scraper as-is.
- **The competitor filter reads the company's OWN name and Google's own category only** (`lead.company` + `lead.mapsCategory`). It must never see `industry`/`category` (derived from our own search query) or `address` — including them made "Facility Management Companies in Noida" and any lead on "Manpower Chowk" delete the whole run. `mapsCategory` is set in both lead-construction sites in `real-scraper.js`.
- **A dead backend reports itself.** When every Maps batch fails, `discoverFromMaps` throws the reachability error instead of falling through to `NO_LEADS_FOUND` — "no businesses in this area" sent him hunting for another city while the server was simply off.
- **Nothing is invented.** No placeholder contact names, no vendor/hiring/staff-size strings guessed from a review count, no `status: 'Verified Client Lead'`. A field nobody observed stays blank. `real-scraper.js` never fabricated; `app.js DataSanitizer` and `agent.js AIScoringEngine` did, and no longer do.
- **Contacts**: mobile primary, landline secondary, toll-free last (`website_crawler.merge_phones`). One crawl per domain, but **every** record on that domain receives the result — keeping only the first left sibling listings permanently blank and marked as already-read.
- **Rudra24 AI never asks for lead details.** "leads chahiye" / "aur leads" / "<any town> ki leads" runs immediately with defaults (count 20, all buyer sectors, his city). The prompts that enforce this: `jarvis.js` and `clavis-live.js` — both carry the line `LEADS ARE NEVER AMBIGUOUS`. Only a question about leads he ALREADY has (`ABOUT_EXISTING_RE`) stays out of the pipeline.
- Checks: `node scripts/verify-lead-pipeline.js` (registered in `npm test`).

## Listening latency (2026-09-30)
- Endpointing lives in `clavis-voice-state.js endpointDelay()`. A trailing vocative ("…dikhao sir", "…nikalo Rudra24 AI") is stripped before the dangling-word test — it used to score as dangling and buy **2.5 s** of silence on his most natural phrasing. Windows now: finished 220 ms, dangling 1200, fragment 700, neutral 450.
- `jarvis_ui.js clavisEarSchedule(isFinal)` commits in 120 ms on Chrome's *final* result when the sentence already reads as finished — Chrome has done its own endpointing by then, and re-waiting the full window on top was pure lag. A final on a dangling word still gets its full window.
- Caption typewriter `CE_CHAR_MS` is 12 (was 34 — the last letter of a 9-char word landed ~470 ms late and read as "it is slow to hear me").
- Ctrl+Shift+D opens the span panel (`speech_start → first_partial → endpoint → dispatch → llm_first_token → tts_first_audio`) — measure there before changing any of these numbers.

## Voice calling agent — Sarvam (2026-09-30)
- **Provider is Sarvam only.** `sarvam-calling.js` talks to `https://apps.sarvam.ai` directly from the browser and falls back to the same-origin proxy `/sarvam-api/*` in `serve-clavis.js` when CORS blocks it. Whichever route answers first is cached for the session — that is the "no delay" requirement. Do not add a second provider to this path.
- Endpoints in use: `POST /api/outbounds/v1/orgs/{org}/workspaces/{ws}/outbounds` (instant outbound → `attempt_id`), `GET /api/app-authoring/v1/orgs/{org}/workspaces/{ws}/deployments` (auto-fills `app_id` / version / phone), and `GET /api/analytics/v1/{org}/{ws}/{app}/{attempts|transcripts/{id}|recordings/{id}}`. Auth header `api-subscription-key` (analytics also takes `X-API-Key`; both are sent).
- **No call audio ever plays in the app.** Sarvam places the real PSTN call, so the browser only polls for status, transcript and the recording URL. The `<audio>` element is `preload="none"` and only the owner can press play. Never add autoplay or a live audio stream here.
- The key lives in **ClavisKeyVault under provider `sarvam`** (encrypted, IndexedDB). It is deliberately **not** in `CHAIN` — Sarvam is not an LLM fallback. `config.js` has an empty `SARVAM_API_KEYS` only as a last-resort fallback; never commit a key there.
- **Nothing dials on its own.** After a lead run (`nexus:scrapedone`, or the manual agent's `onComplete`) Rudra24 AI shows the "sir, calling agent ko de doon?" card and speaks it — leads move only on a yes. `SarvamCalling.start()` refuses on an incomplete setup, a missing key, or outside the owner's call window.
- **Email is drafted, never sent.** The post-call LLM pass writes a personalised draft; the owner edits it and presses "Gmail me kholo". Meetings are handed off as a Google Calendar template link + `.ics` — no OAuth, no stored tokens.
- Rudra24 AI skills: `send_leads_to_calling_agent`, `start_calling`, `calling_status`. Queue runs strictly one call at a time with `gapSeconds` between.
- Master-agent fields (`FIELDS` in `sarvam-calling-ui.js`) are what makes the app resellable — one company per browser fills them and the agent becomes theirs. Adding a field: add it to `DEFAULTS` in the engine, to `FIELDS` in the UI, and to `callVariables()` / `buildAgentPrompt()` if the agent should hear it.
- Checks: `node scripts/verify-sarvam-calling.js` (registered in `npm test`).

## Important Notes
- Primary language in codebase is **Hinglish** (Hindi + English mix)
- The app is designed for a security & housekeeping agency business
- All changes should maintain browser-only compatibility (no Node.js server)
- Maintain existing API key rotation and error handling patterns
- Keep the minimal Claude-inspired aesthetic (see UI design rules above)

## Sign-in, rail, history, theme (2026-10-10)
- **One sign-in screen**: markup in `index.html` (`#auth-screen.rl-screen`), look in `rudra-login.css` (loaded in `<head>`, 14-id prefix). `auth-antigravity.css` and `rudra-auth-claude.css` are no longer loaded (the pair painted the login twice). The topbar profile badge/menu rules moved from auth-antigravity.css into the bottom of rudra-login.css.
- Sign-in look (v3, owner's request): always-light page; LEFT the product film `assets/login/login-film.mp4` in its own 16:9 — 1280x720 60fps (lanczos + light unsharp so text stays crisp at ~620px), 49 s loop cut straight from the launch film (no crop, no zoom, no frame), rounded 16px, hairline border, NO shadow, compact Claude-like proportions (stage max 1120px: film 620px + sign-in 380px); RIGHT a calm sign-in column (serif headline, one card: Google, email, password, near-black button, "Create an account" text link). Brand mark top-left only, no top nav. Film plays only while visible (IntersectionObserver in auth-antigravity.js).
- The login sits behind a quiet splash (`is-checking`) until `SupabaseAuth.init()` answers; a signed-in owner never sees it. `checkInitialSession()` finishes the hand-off itself when another module (grok/omni studio) initialised Supabase first — that race used to leave the login over a valid session.
- **Rail**: `rudra-rail.css` owns the clock (`--csb-rail` 650ms, `--csb-spring` cubic-bezier(.32,.72,0,1)). Owner wants the original behaviour kept — peek and pin both push the page — only slower/smoother; don't make the peek float. The orb resizes its GL buffer on a 140 ms trailing timer so a width animation doesn't reallocate it every frame.
- **Chat History** look: `chat-history.css` (cc-* tokens, no avatars, plain close).
- **Floating window drag** (clavis-aurora.js `glideStep`): the window glides after the pointer on a damped spring (`GLIDE_TAU` 0.13 s) and lands exactly where released — the owner wants this slow, soft follow. Never use a CSS transform transition for it (re-started every frame = stutter).
- **Theme**: a theme swap costs ~0.5–1.2 s of style recalc on this page (87 sheets). The reveal (clavis-luxe.js) is now ~0.6–0.8 s expo-out, the switch flips first, and every helper class on `<html>` leaves in one write in `settle()` — each `<html>` class write is a full-page recalc, so never toggle classes on `<html>`/`<body>` during an interaction.

### Sign-in intro (2026-10-11)
`revealLogin()` in auth-antigravity.js: logo alone centred 2 s (`rl-wait` hides the stage) → one straight eased glide to the corner (720 ms) → name appears letter-by-letter blur→sharp (~0.5 s) → `rl-wait` removed: stage pops (`rl-pop`, 900 ms) and the film starts at once (film play gate also checks `rl-wait`; `load()` warms it during the hold). Layout is title left above card, film right. Audio fade 2.2 s to VOL 0.32; the file's own first seconds are ambience before the voice.

## Voice-first assistant (2026-10-11)
- **Window rule (spoken turns):** Rudra answers out loud. Leads, maps, photos, research, requested detailed briefs/comparisons and file/table/chart/document results may open a useful visual result. Length or a URL alone does not open it. General spoken turns preserve an already-open result. Typed turns retain text interaction. Check: `node scripts/verify-voice-routing.js`.
- **Live hearing:** Chrome's Web Speech ear (live partials, free) leads; Groq Whisper is the fallback (`clavisUseGroq()`), used in Electron / when Chrome's speech service errors (`network`×2, `service-not-allowed`) or `clavis_stt_provider=groq`. ElevenLabs Scribe still wins when configured.
- **Tokens:** the full action prompt was ~14.5k chars (55-tool menu ≈ 9.7k) — Groq free gpt-oss is 8k tokens/min, so after 1–2 turns replies came back EMPTY (`AI_EMPTY_RESPONSE`). Now: static prompt + tool menu first (cacheable prefix; cached tokens don't count toward the limit), live context after; spoken turns drop `pc_*` tools unless he talks about the PC (~11k chars), 6 turns / 3k chars of history. Don't cap gpt-oss `max_tokens` low — it reasons inside that budget and returns empty.
- `window.jarvisSpeechEnabled` is now a live getter/setter over jarvis_ui's `let` — other scripts used to read `undefined`, so "awaaz on karo" could flip voice OFF. A muted voice (`jarvis_speech_enabled=false`) sends every reply to the window — check that first when "it shows instead of speaking".
- Failed spoken turns now say one short line instead of going silent.

## Calling lead import repair (2026-10-12)
- Calling Agent exposes Fetch leads for ElevenLabs and Sarvam. It reads current account scoped storage/IndexedDB; Send to Voice Calling from Leads preserves `LeadsCtrl.filtered`, including zero matches. Pending imports are discarded on account change; repeated clicks share one read.
- The shared queue deduplicates normalized destinations as well as lead IDs. Import never starts a call; checkboxes, N cap 200 and exact destination confirmation still gate submission.
- Initial batch history uses one list request. Refresh jobs explicitly reconciles active jobs; 404 now explains that backend code needs reloading. The local backend was restarted from this checkout; batch list/detail/cancel routes are now present in OpenAPI.
- Checks: `node tests/calling_batch_ui_selftest.js`, `node scripts/verify-sarvam-calling.js`, `backend/.venv312/Scripts/python.exe tests/calling_leads_browser_check.py`; backend `python -m unittest tests.test_elevenlabs_calling` (28 tests). Browser fixture mocks provider submission and does not make phone calls.
- The real DOM browser check also caught N resetting after cancel; the limit now persists across selection/re-render/cancel. It verified two valid unique imports, repeat import dedupe, cancel blocking submission and one selected destination per N=1.
- Full `scripts/run-all-checks.js` is not green: middleware ESM parser, stylesheet order, sidebar width, voice grounding fixture and quiet-mode assertions fail outside this calling patch. Signed-in customer browser/provider dialing remains unverified; reload the app to receive the bumped calling script versions.

### Full-suite follow-up (2026-10-12)
- `node scripts/run-all-checks.js` now passes all 20 suites, including syntax for 154 root scripts. The runner validates Vercel middleware as ESM. Integrity allows the actual feature overlays after the base theme; sidebar/theme fixtures now check the active width and two-frame freeze/settle contract; quiet checks execute silent idle expiry and respect wake-source opt-outs and speaker rejection.
- Fixed live-fact classification for "Why does rain happen?"; general rain explanations no longer spend a browser-search request. Fresh-engine grounding test uses a separate VM context rather than redeclaring a const engine in the same VM.
- ElevenLabs rechecks account status after late authenticated session restoration. Logout still aborts pending provider work and clears tenant state. Regression: `node tests/elevenlabs_studio_lifecycle_test.js`.
- Actual Chrome app Calling Agent navigation and Fetch leads were exercised: current account showed no saved leads and no outbound line. Provider credentials, saved agent and own receiving destination are required for a paid call test; no real call has been submitted.

## Session speaker and spoken output (2026-10-12)
- Default speaker policy is first speaker after deliberate mic/orb activation. Final utterance audio contributes at least 60 voiced frames to an ephemeral account/device-bound acoustic reference. Insufficient audio retains the initial command and asks for more speech. Repeated evidence cannot enroll twice; checks never adapt the profile. Registered owner remains an optional account-scoped mode; saved profiles are preserved.
- Sleep, mute, logout, device/account changes and mic disconnect clear the reference. Pending enrollment text is also cleared on sleep, mute, account and device changes. Passive wake listening cannot claim the main speaker.
- Existing echo, speaker and barge-in gates use the session profile. Only accepted finals receive committed turn IDs. An addressed guest can ask an answer-only question; guest actions enter the existing main-speaker confirmation gate. Background speech cannot bypass that gate.
- Mic status uses capture, speaker, permission and provider states rather than showing permission as listening readiness. The mic status button starts/retries listening. Concise voice prompts request 1–3 sentences and at most one relevant suggestion; existing memory/Ahead and paid-action confirmation remain in place. This is context/prompt engineering, not model fine-tuning.
- Checks: `node scripts/run-all-checks.js` (20 suites), `tests/session_speaker_selftest.js`, `tests/voice_ui_recovery_selftest.js`, existing echo/interruption/streaming/provider fixtures. Logs: `logs/speaker-plan-full-checks.log`. Synthetic acoustic vectors do not prove speaker separation, real TV/overlap filtering, audible playback or physical interruption timings. Single-mic acoustic matching is best-effort. Live browser was minimized during final verification; ten real turns and microphone latency measurements remain pending.
- Live follow-up: user confirmed both transcript and audible reply after mic activation. Browser inspection observed the updated Speaker needed badge rather than Mic ready. Repeated-turn and interruption checks were requested; physical timings, TV/guest/overlap evidence remain pending. Backend mock-suite rerun stalled and is being investigated; do not treat the frontend full-suite result as backend/provider certification.
- Query follow-up: a real "leads dikhao" was mistranscribed into Cyrillic and started sourcing. Scribe now defaults to Hindi with English as secondary language, independent of English UI; explicit `clavis_voice_language` overrides remain. Unexpected Cyrillic in Hindi/English mode is rejected before enrollment/dispatch. "Leads dikhao", saved-list variants and "show leads" deterministically open the existing Leads page without LLM/sourcing. The blanket lead-generation prompt was removed. ElevenLabs realtime language parameters verified against https://elevenlabs.io/docs/api-reference/speech-to-text/v-1-speech-to-text-realtime .
- PCM streaming now holds 120ms initially and refills after starvation to avoid tiny packet bursts. End-stream flushes short tails; stop clears buffered audio. Regression fixtures exercise the actual worklet. This buffering improves tolerance to packet jitter; real audible smoothness and whole-app lag still require customer retesting, and prolonged provider/network stalls can still pause speech.
- Acoustic DCT coefficients are precomputed once per microphone setup instead of 288 cosine calls each voiced frame. `voice_features_efficiency_selftest.js` verifies identical output at 16/44.1/48kHz; no matching thresholds or profile formats changed. Backend rerun was interrupted after stalling; diagnostic traceback showed slow Python dependency imports, so backend certification remains incomplete in this run.

## Private family edition and adaptive island (2026-10-12)
- Island is collapsed to a 380px pill by default; click reveals the description/actions. Entry/exit use transform/opacity with a restrained 900ms spring and reduced-motion support. Startup replays suggestions delivered before React effects subscribed. Source `src/rudra-motion-ui.jsx`, rebuild `node scripts/build-motion-ui.js`.
- `ClavisAhead` persists action/view frequencies and explicitly remembered preferences under verified account-ID keys. Action ordering adapts within useful task results; concise voice receives a bounded preference excerpt. Learning can be disabled/reset. New accounts start blank; late action completions cannot learn into a different account. No automatic code modification or paid outreach.
- All Leads no longer falls back to unscoped localStorage/in-memory records. Empty own datasets stay empty. Scoped reads/saves and async completion checks prevent cross-account repaint/persistence; auth changes clear controller and global state. Existing legacy records are preserved in storage but not assigned to another user. Tests: `lead_account_isolation_selftest.js`, `ahead_selftest.js`.
- Local storage/IndexedDB now use the verified Supabase account ID rather than lossy punctuation-normalized email IDs; email helper encoding is collision-free. Ambiguous legacy scopes are not automatically migrated. Verified cloud sync restores the same account only, preserving its auth subject in profile metadata. A newly populated own IndexedDB remains loadable even if an earlier own cache was empty. Test: `storage_identity_selftest.js`.
- Conversation metadata, shortcut history titles, business profile, learned habits and structured Mind memories are account-scoped too. Late fact/history completions cannot repopulate another account's working cache. `personal_memory_isolation_selftest.js` covers separate business/context/history/memory. Final suite now includes 24 groups.
- Private family build explicitly authorizes `alsharma2901@gmail.com` and `alsharma2901555@gmail.com` for Groq/Apify/ElevenLabs access copied from the latter's own vault. It includes an encrypted local provider envelope, a fresh vault master key, public Supabase config and optional portable runtimes, never original DB, sessions, passwords, service-role or JWT-signing secrets. Local-machine owners can extract these provider keys: this ZIP is private family distribution, not public-client packaging. Default share/installer checks remain secret-free.
- Explicit Remove stores an empty credential marker so shared/platform access cannot reconnect that account automatically. Family members may share provider account credits; agents/calls/phone resources remain tenant-bound, and unbound historical upstream listings are hidden for family-key users. Auth still verifies JWTs; legacy HS256 without a signing secret is verified with Supabase Auth `/user` using the public key. No email-string login bypass.
- Build: `backend/.venv312/Scripts/python.exe scripts/build-share-zip.py --family --node-runtime <node.exe> --python-runtime <portable Python root>`. ZIP lives under `exports/`. First launch installs backend packages via the bundled Python, then reuses the local venv. Carrier/outbound line and provider quotas still apply; a fresh Dad-PC installation/live paid calling has not been verified.
- Validation: full frontend suite 24/24; six selected backend JWT/credential/family isolation and portable-auth/family-resource checks pass. Actual bundled island browser fixture passes compact dimensions, disclosure and dismissal (`logs/island-browser-check.log`). Extracted portable Node/Python run successfully with SSL, venv and pip bootstrap. Local backend restarted hidden and reached application startup complete. Live Dad-PC login/dialing remains unverified.

## Rudra24 Mobile (2026-10-12)
- Independent `Rudra24Mobile/` copy: Vanilla JS installable PWA and native Kotlin/Jetpack Compose Android client with Home, Leads, Outreach, More. Original desktop UI and AndroidApp are preserved.
- Both clients use existing Supabase auth and account-owned CRM/API data. Native persistent tokens use Android Keystore encryption; PWA caches shell assets only. Logout/account/backend changes clear working data and reject stale completions.
- New authenticated email/WhatsApp outreach jobs resolve recipients from owned CRM records, require batch review/confirmation and persist per-recipient evidence. Existing Gmail/Meta senders retain consent, template, quota and idempotency checks. Unknown/crashed sends pause remaining work without automatic resend. Existing ElevenLabs native batches remain unchanged.
- Apply `backend/migrations/20261012_mobile_outreach.sql` before production release. Configure HTTPS API/PWA hosts and the mobile Vercel proxy; no actual host was supplied or deployed.
- Final native debug APK builds successfully, 9,400,070 bytes, v2 signature verified. Existing frontend 24 suites and calling 29 mock tests pass; WhatsApp, mobile jobs, phone/tablet browser, logout race, proxy and real offline-shell checks pass. No Android device attached; live install/startup and real provider sends remain unverified.
- Deliverables and evidence: `Rudra24Mobile/artifacts/`, `Rudra24Mobile/VERIFICATION.md`. Source ZIP excludes provider secrets, user databases, sessions, signing keys and toolchain downloads. Production Android release needs the operator's protected signing key.

## Rudra24 Mobile v1.1 lead/calling/CRM hardening (2026-10-12)
- Mobile clients select Apify + Maps fallback and refresh saved CRM leads after job count/state changes without disturbing a selected batch. Apify per-query ceilings avoid short budgets; exact sector matches tolerate address order while rejecting neighboring sectors.
- Mobile CRM now supports phone/email/stage edits with existing version checks, idempotent notes, dated follow-ups/completion, and activity/call history. Shared provider-loading guards prevent stale responses resetting outreach fields; action buttons no longer accidentally submit settings/forms.
- Batch recipients optionally carry owned CRM IDs; server rejects foreign records, phone mismatches and phone opt-outs before provider calls. IDs stay local and are not sent in provider payloads. Existing legacy batch response/signature behavior is preserved.
- A read-only background calling worker saves provider statuses and available transcripts/summaries into CRM; it never submits/retries calls. Meta acceptance and signed-receipt statuses reach CRM as distinct idempotent events; failed delivery needs review. No data/profile or API keys removed.
- Native APK v1.1/code 2 builds and verifies, 9,591,521 bytes. CRM 10 tests, calling 29, pipeline 4, extended phone/tablet browser, offline shell, durable jobs and frontend 24 suites pass. Real provider actions, production HTTPS hosting and physical Android use remain unverified. Updated source/deployment ZIP and README under Rudra24Mobile/artifacts.

Mobile v1.1 final: native APK code2/1.1.0, 9,592,424 bytes, v2 signature verified. Account-scoped lead request keys reconcile uncertain submissions; backend reserves requested search quota once before provider work. Old interrupted jobs recover with partial contacts retained and no paid retries. Pipeline6, CRM10, calling29, frontend24, mobile browser/offline checks passed. Hidden local backend updated and health verified; production HTTPS/mobile-device/paid-provider evidence remains pending. See Rudra24Mobile/VERIFICATION.md.

## Voice mode = ElevenLabs Agents only (2026-10-15)
- Every deliberate voice start (mic, orb, shortcut, wake word "Rudra", clap/snap) goes to `clavis-live.js` (`window.ClavisLive`), routed at the top of `jarvis_ui.js startJarvisVoiceInput`. The old Scribe→Groq→TTS chain is only the fallback when Live is unavailable (signed out / backend down).
- One WebSocket to an ElevenLabs agent does hearing (Scribe realtime, turn_v3), voice (eleven_flash_v2_5, pcm_24000) and barge-in (server `interruption` → playback dropped; audio with event_id ≤ interruption id ignored). BRAIN = owner's Groq key (owner's choice, 2026-10-15): agent `llm: custom-llm` → api.groq.com chat/completions, model `openai/gpt-oss-120b` (override localStorage `rudra_voice_groq_model`), key stored as an ElevenLabs workspace secret via `_groq_secret`, `backup_llm_config` disabled (no silent Gemini fallback), gpt-oss gets `custom_llm_extra_body` reasoning_effort low. No Gemini in voice.
- Screen vision: `look_at_screen` → PC-bridge screenshot → `POST /api/v1/elevenlabs/assistant/conversations/{id}/image` (backend uploads to ElevenLabs) → `multimodal_message` with the file_id. Agent has `file_input` enabled.
- Prompt size per brain call ≈ 7k tokens (persona ~8.7k chars + 43 tools ~17.6k chars); relies on Groq prompt caching for gpt-oss. On the free Groq tier, heavy back-to-back talking can hit the per-minute token limit.
- Fake-server checks: `node tests/eleven_live_voice_test.js` (22), `node tests/voice_entry_routing_test.js` (7); backend `tests/test_rudra_voice_assistant.py`.
- Backend `POST /api/v1/elevenlabs/assistant/session` (backend/api/elevenlabs.py) receives persona + client tools from the browser, syncs workspace client tools + one agent per account by hash (row kind `assistant`), returns a signed URL. Unchanged persona/tools = zero provider writes. Test: `backend/tests/test_rudra_voice_assistant.py`.
- Persona is static (cached in the agent); time / on-screen / memory / last turns go in as a `contextual_update` on every connect. App events go in as `user_message` "[SYSTEM EVENT] …".
- Tools = display (show_map, map_control, show_nearby, show_images, show_website, show_document, close_display), find_leads, app_command, go_to_sleep, open_app_or_website, read_website + JarvisSkills (DIRECT_SKILLS + dev-mode custom skills). All run in the browser via `runTool`; risky ones still pass JarvisSkills' risk gate.
- Removed on purpose (they blocked commands / barge-in): regex "addressed to Rudra" tool guard, map/picture/close word guards, echo gate, quiet stream pause, Web Speech side caption, Gemini key rotation. Live screen-share streaming is not in voice mode; look_at_screen (one screenshot per ask) is.
- Session stays open across turns; ends after ClavisWake idle window (≥2 min of no activity), "so jao", or End. Wake word / clap / orb opens it again.

## Lead timeout + calm floating window (2026-10-15)
- `lead_jobs.py` Maps discovery uses `_gather_within(coros, budget)`: finished searches are kept, overrunning ones are cancelled. It used to be `wait_for(gather(...))`, which threw away Apify + finished Maps leads when the slowest query overran ("The browser lead source timed out"). Budget = 65 s × waves of 3, capped at 240 s. Any `failed` job with saved LeadRecords is finalised as `partial`. Test: `backend/tests/test_lead_source_budget.py`.
- `lead-jobs-client.js run()` retries ONCE on a timeout-type failure with zero leads: ≤3 categories, sources maps+apify only. Test: `tests/lead_job_retry_selftest.js`.
- Floating window: progress labels carry no "· Ns elapsed" (that changed the body every second); elapsed time is the header `.cts-clock` on its own 1 s timer. `reconcile()` is keyed (tag + first class), so a stat appearing no longer replaces and re-animates every later sibling. Live-phase resizes are quiet (<48 px width held, <40 px travel not animated). `show()` writes nothing when already open. The "search needs a review" island stays quiet while the window already shows the failure.
