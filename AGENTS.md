# Nexus AI Leads Agent — Project Context

## Overview
This repo now contains **two products**:

1. **Nexus AI B2B Lead Generation Agent** (original) — a browser-based app that finds companies needing security guards/housekeeping staff (Hotels, Hospitals, IT Parks, Malls). Runs entirely in the browser, no server required.
2. **Jarvis AI** (new) — a personal/business assistant, also browser-based, accessible from its own sidebar entry ("Jarvis AI"), separate from the lead-gen "Chat AI". Jarvis handles general conversation, persistent long-term memory, and call-script generation. It's powered primarily by **OpenRouter** (free-tier models, auto key+model rotation — see `jarvis.js`), with Groq/DeepSeek/Moonshot/NVIDIA as fallback.
   - For **real outbound phone calls**, there's a separate FastAPI backend in `backend/` using **Exotel** (India-focused telephony — chosen over Twilio for DLT/TRAI compliance and INR billing) + OpenRouter for the live voice pipeline (STT: faster-whisper, TTS: Piper). This backend must be run separately (`uvicorn main:app`) and requires its own `.env` (see `backend/.env.example`). It is NOT required for Jarvis's in-browser chat/voice-input mode to work.

## Tech Stack
- **Frontend**: Vanilla HTML + CSS + JavaScript (no framework)
- **AI Chat**: Groq API (LLM for natural language lead queries)
- **Lead Scraping**: Apify API (Google Maps scraper)
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
- `APIFY_API_KEYS[]` — up to 10 keys for lead scraping
- `GROQ_API_KEYS[]` — up to 5 keys for AI chat
- `SHEETS_WEB_APP_URL` — Google Sheets sync endpoint
- `EMAIL_WEBHOOK_URL` — Email automation webhook
- `DEFAULT_CITY` — Default search city (Gurugram)

## Important Notes
- Primary language in codebase is **Hinglish** (Hindi + English mix)
- The app is designed for a security & housekeeping agency business
- All changes should maintain browser-only compatibility (no Node.js server)
- Maintain existing API key rotation and error handling patterns
- Keep the premium glassmorphism UI design aesthetic
