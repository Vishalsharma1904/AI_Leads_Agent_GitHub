// ============================================================
// NEXUS AI — CLIENT ACQUISITION PLATFORM
// GLOBAL CONFIGURATION & TARGET METADATA
// ============================================================

window.SKYLARK_CONFIG = {
  // ─── PLATFORM BRANDING ─────────────────────────────────────
  PLATFORM_NAME: 'Clavis',
  TAGLINE: 'B2B AI Client Acquisition Engine',
  TARGET_SERVICES: ['Security Guards', 'Housekeeping Staff'],

  // ─── CRAWLER DEEP SUB-PAGES TO SCRAPE ───────────────────────
  CRAWL_SUBPAGES: [
    '/contact', '/contact-us', '/contactus',
    '/about', '/about-us', '/aboutus',
    '/careers', '/jobs', '/work-with-us',
    '/procurement', '/vendors', '/vendor-registration',
    '/facilities', '/facility-management', '/administration',
    '/tenders', '/rfp', '/bids',
    '/security', '/housekeeping', '/support'
  ],

  // ─── APIFY API KEYS (up to 10) ────────────────────────────
  // System rotates automatically when quota is near exhaustion or error occurs.
  APIFY_API_KEYS: [],

  // 🪙🪙🪙 GROQ API KEYS (up to 5) 🪙🪙🪙
  GROQ_API_KEYS: [],

  // xAI / Grok keys are optional. Prefer the credential dialog so keys stay
  // in the browser's local origin storage rather than source control.
  XAI_API_KEYS: [],

  // 🪙🪙🪙 NVIDIA NIM API KEYS 🪙🪙🪙
  NVIDIA_API_KEYS: [],
  
  // 🪙🪙🪙 GOOGLE GEMINI API KEYS (AI STUDIO) 🪙🪙🪙
  GEMINI_API_KEYS: [],

  // 🪙🪙🪙 DEEPSEEK API KEYS 🪙🪙🪙
  DEEPSEEK_API_KEYS: [],

  // 🪙🪙🪙 MOONSHOT API KEYS 🪙🪙🪙
  MOONSHOT_API_KEYS: [],

  // 🪙🪙🪙 OPENROUTER API KEYS (up to 5) 🪙🪙🪙
  OPENROUTER_API_KEYS: [],

  CLAVIS_FREE_MODELS: [
    'meta-llama/llama-3.3-70b-instruct:free',
    'deepseek/deepseek-chat-v3.1:free',
    'deepseek/deepseek-r1:free',
    'qwen/qwen-2.5-72b-instruct:free',
    'google/gemini-2.0-flash-exp:free',
    'mistralai/mistral-nemo:free',
    'nousresearch/hermes-3-llama-3.1-405b:free',
  ],

  // ✉️✉️✉️ GOOGLE SHEETS WEB APP URL ✉️✉️✉️
  SHEETS_WEB_APP_URL: '',

  // ✉️✉️✉️ EMAIL AUTOMATION WEBHOOK URL ✉️✉️✉️
  EMAIL_WEBHOOK_URL: '',

  EMAIL_SENDER_ADDRESS: '',

  // Outlook Graph is configured in the Email Auto page (stored locally per browser).
  OUTLOOK_CLIENT_ID: '',
  BACKEND_URL: 'http://localhost:8000',
  // Public OAuth configuration is supplied by the backend at runtime.
  // Never load a credentials file into this static application.
  GOOGLE_CLIENT_ID: '',

  DEFAULT_CITY: 'Gurugram',

  // 🪙🪙🪙 CREDIT / TOKEN LIMITS (per key) 🪙🪙🪙
  APIFY_KEY_LIMIT: 500,
  GROQ_KEY_LIMIT:  100000,
  NVIDIA_KEY_LIMIT: 100000,
  GEMINI_KEY_LIMIT: 1000000,
  DEEPSEEK_KEY_LIMIT: 500000,
  MOONSHOT_KEY_LIMIT: 500000,
  OPENROUTER_KEY_LIMIT: 1000000,
};

// Compatibility alias for legacy code
window.CONFIG = window.SKYLARK_CONFIG;
