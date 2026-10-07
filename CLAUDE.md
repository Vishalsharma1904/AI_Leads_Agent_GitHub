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
