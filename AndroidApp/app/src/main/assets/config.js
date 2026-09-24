// ============================================================
// SKYLARK AI — GLOBAL CONFIGURATION FILE
// ============================================================
// Edit this file once to set up everything. Works on any computer!
// You can add up to 10 Apify keys — system auto-switches when one runs out.

window.SKYLARK_CONFIG = {

  // ─── APIFY API KEYS (up to 10) ────────────────────────────
  // System rotates automatically when quota is near exhaustion.
  // Leave unused slots as empty string ''.
  APIFY_API_KEYS: [],

  // 🪙🪙🪙 GROQ API KEYS (up to 5) 🪙🪙🪙🪙🪙🪙🪙🪙🪙🪙🪙🪙🪙🪙🪙🪙🪙🪙🪙🪙🪙🪙🪙🪙🪙🪙🪙🪙🪙🪙
  // Chat AI keys — auto-rotates on rate limit (429 error).
  GROQ_API_KEYS: [],

  // 🪙🪙🪙 NVIDIA NIM API KEYS 🪙🪙🪙
  // For models like Nemotron, Llama 3 70B
  NVIDIA_API_KEYS: [],

  // 🪙🪙🪙 DEEPSEEK API KEYS 🪙🪙🪙
  // For DeepSeek V3/V4
  DEEPSEEK_API_KEYS: [
    '', // Paste your DeepSeek API Key here
  ],

  // 🪙🪙🪙 MOONSHOT API KEYS 🪙🪙🪙
  // For Kimi K2.5 / K2.6 models
  MOONSHOT_API_KEYS: [
    '', // Paste your Moonshot API Key here
  ],

  // ✉️✉️✉️ GOOGLE SHEETS WEB APP URL ✉️✉️✉️
  // Deploy Apps Script as Web App and paste the URL here:
  SHEETS_WEB_APP_URL: '',

  // ✉️✉️✉️ EMAIL AUTOMATION WEBHOOK URL ✉️✉️✉️
  // AAPKO YE KARNA HAI (ONE TIME ONLY):
  // 1. script.google.com par jaao → New Project → email_script_gas.js ka code paste karo
  // 2. Deploy karein as Web App → Copy the URL
  // 3. Wo URL niche paste karo (quotes ke beech mein):
  EMAIL_WEBHOOK_URL: '',
  //              ↑↑ YAHAN APNA APPS SCRIPT URL PASTE KARO ↑↑
  // Example: EMAIL_WEBHOOK_URL: 'https://script.google.com/macros/s/ABCD1234.../exec',

  // ✉️✉️✉️ PAPA KI EMAIL (AUTOMATIC PRE-FILL) ✉️✉️✉️
  // Yahan papa ka email daalo — app khud hi automatically fill kar dega:
  EMAIL_SENDER_ADDRESS: '',
  //                    ↑↑ YAHAN PAPA KA EMAIL DAALO ↑↑
  // Example: EMAIL_SENDER_ADDRESS: 'vishalsharma90405@gmail.com',

  // ✉️✉️✉️ DEFAULT CITY FOR CHAT AI ✉️✉️✉️─────────────────────────────
  DEFAULT_CITY: 'Gurugram',

  // 🪙🪙🪙 TOKEN LIMITS (per key, estimated) 🪙🪙🪙🪙🪙🪙🪙🪙🪙🪙🪙🪙🪙🪙🪙🪙🪙🪙🪙🪙
  // Apify free tier = ~500 credits/month per account
  // Set 500 to get warned before hitting the hard limit
  APIFY_KEY_LIMIT: 500,
  GROQ_KEY_LIMIT:  100000, // Groq free = ~100000 tokens/day per key
  NVIDIA_KEY_LIMIT: 100000,
  DEEPSEEK_KEY_LIMIT: 500000,
  MOONSHOT_KEY_LIMIT: 500000,
  OPENROUTER_KEY_LIMIT: 1000000,
};
