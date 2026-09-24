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
- **Styling**: Custom CSS with Inter + Lora fonts, glassmorphism design

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
- Every recognizer transcript goes through `ClavisEar.judge()` (via `commitJarvisVoiceInput`) so Clavis never answers its own voice.
- "Close / close everything" clears Clavis's own screen (display + floating window) — never the user's PC apps.
- Clavis Live is patient (END_SENSITIVITY_LOW, `clavis_live_patience_ms`, default 1100 ms) and keeps the mic open: after ~2.5 s of silence it sends `audioStreamEnd` and holds ~0.4 s of audio until the next voice, so sessions stay open ~10 min cheaply.
- Sleep: "thodi der chup ho jao" → `go_to_sleep` / `ClavisIntent.sleep()`; `clavis_slept_at` makes the next wake (name / snap / clap) a one-time sleepy "meri aankh lag gayi thi" greeting.
- Risky actions (delete, send, overwrite, bulk, closing PC apps, spending) are confirmed once in his language; harmless ones (show, open, search, on/off switches) just happen.

## Important Notes
- Primary language in codebase is **Hinglish** (Hindi + English mix)
- The app is designed for a security & housekeeping agency business
- All changes should maintain browser-only compatibility (no Node.js server)
- Maintain existing API key rotation and error handling patterns
- Keep the premium glassmorphism UI design aesthetic
