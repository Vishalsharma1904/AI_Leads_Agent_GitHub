/**
 * ============================================================
 *  RUDRA24 AI BOOT GREETING (clavis-boot-greet.js)
 *
 *  When the app opens, Rudra24 AI greets the user proactively with a
 *  time-aware, context-aware spoken + chat-bubble greeting.
 *
 *  DESIGN GOALS:
 *    - Feel like a real, attentive personal assistant — not a bot
 *    - 100+ unique combinations: time slot × opening phrase × offer line
 *    - Remembers last greeting to NEVER repeat the same one back-to-back
 *    - Uses day-of-week, return frequency, and session gap for context
 *    - One greeting per app-open session (won't re-greet on page nav)
 *    - 2026-09: boot par koi LLM / Rudra24 AI Live nahi — ek chhoti local line,
 *      din me ek baar (clavis_boot_greet_day). Keys bachani hain.
 * ============================================================
 */
'use strict';

window.ClavisBootGreet = (() => {
  const LS_LAST_GREET     = 'clavis_boot_greet_last';
  const LS_LAST_VISIT     = 'clavis_boot_last_visit';
  const LS_VISIT_COUNT    = 'clavis_boot_visit_count';
  const LS_GREETED_SESSION = 'clavis_boot_greeted_session';

  // ── TIME SLOTS ──────────────────────────────────────────
  // Each slot has a name and multiple opening phrases for that time
  function getTimeSlot(h) {
    if (h >= 4  && h < 6)  return 'early_morning';
    if (h >= 6  && h < 9)  return 'morning';
    if (h >= 9  && h < 12) return 'late_morning';
    if (h >= 12 && h < 14) return 'afternoon';
    if (h >= 14 && h < 17) return 'late_afternoon';
    if (h >= 17 && h < 20) return 'evening';
    if (h >= 20 && h < 23) return 'night';
    return 'late_night';
  }

  // ── OPENING PHRASES (time-based, pure greeting) ─────────
  // Each array has 8-12 options for natural variety
  const OPENINGS = {
    early_morning: [
      'Sir, subah subah aap aa gaye — dedication dikha diya!',
      'Itni jaldi, sir? Aapki mehnat salute hai.',
      'Sir, abhi toh suraj bhi nahi nikla — lekin aap ready hain!',
      'Good morning sir, early bird advantage aapka hai.',
      'Sir, aaj bahut jaldi shuru kiya — shandaar!',
      'Arre sir, itni subah? Koi nahi, main bhi ready hoon.',
      'Sir, subah subah aapki energy top-level hai!',
      'Early start, sir! Aaj ka din productive hoga.',
    ],
    morning: [
      'Good morning, sir! Batayein kya help chahiye.',
      'Suprabhat sir, aaj ka plan kya hai?',
      'Sir, good morning! Chai pi li? Ab kaam shuru karte hain.',
      'Morning sir! Fresh day, fresh leads — shuru karein?',
      'Sir, good morning! Aaj kya karna hai, bataiye.',
      'Good morning sir, main ready hoon — aap boliye.',
      'Sir, aaj subah kaisa feel ho raha hai? Kaam pe chalein?',
      'Morning sir! Aapka assistant hazir hai, boliye.',
      'Sir, subah ki chai ke saath kuch kaam nipta lein?',
      'Good morning sir! Batayein, kahan se shuru karein aaj.',
    ],
    late_morning: [
      'Sir, kaise hain aap? Kuch chahiye toh batayein.',
      'Sir, aaj ka kaam shuru ho gaya? Main madad ke liye hoon.',
      'Hello sir, mid-morning ho gaya — kuch pending hai toh bataiye.',
      'Sir, good morning! Ab tak kya hua aaj? Main help karun?',
      'Sir, day chal raha hai — koi kaam hai jisme main haath bataun?',
      'Sir, late morning ho gayi — kuch important baaki hai?',
      'Sir, batayein kya chahiye — main ready hoon.',
      'Hello sir! Kuch bhi ho, aap boliye — main hoon.',
    ],
    afternoon: [
      'Sir, dopahar ho gayi — kuch kaam hai toh bataiye.',
      'Good afternoon sir! Lunch ke baad thoda productive ho jayein?',
      'Sir, dopahar mein main fresh hoon — aap boliye.',
      'Afternoon sir! Kuch leads pe kaam karein?',
      'Sir, lunch break ke baad ab full speed — boliye kya chahiye.',
      'Good afternoon sir, main hazir hoon.',
      'Sir, dopahar ka time productive hota hai — shuru karein?',
      'Sir, afternoon hai — batayein kya help chahiye aapko.',
      'Good afternoon sir! Aapka assistant tayyar hai.',
    ],
    late_afternoon: [
      'Sir, shaam hone wali hai — koi last minute kaam?',
      'Sir, day almost wrap ho raha hai — kuch pending hai?',
      'Hello sir! Thodi der mein shaam ho jayegi — kuch complete karna hai?',
      'Sir, afternoon ka end — kuch important reh gaya toh bata dijiye.',
      'Sir, shaam aa rahi hai — quick mein kuch kaam nipta lein?',
      'Sir, day end pe hain — koi task baaki hai?',
      'Hello sir, late afternoon ho gaya — main help ke liye hoon.',
      'Sir, shaam se pehle kuch karna hai toh boliye.',
    ],
    evening: [
      'Good evening sir! Aaj kaisa raha din?',
      'Sir, shaam ho gayi — aaram se bataiye kya chahiye.',
      'Good evening sir, abhi bhi kaam? Dedication hai aapki.',
      'Sir, good evening! Kuch kaam hai toh batayein, warna relax karein.',
      'Evening sir! Agar kuch pending hai toh nipta lete hain.',
      'Sir, shaam ka time hai — kuch help chahiye?',
      'Good evening sir! Main hoon, boliye.',
      'Sir, shaam mein bhi main aapke saath hoon — batayein.',
      'Sir, good evening! Kuch kaam ya phir sirf check-in?',
    ],
    night: [
      'Sir, raat ho gayi — itni dedication kamaal hai.',
      'Good night sir! Abhi bhi kaam? Main saath hoon.',
      'Sir, raat ka time hai — jaldi niptatein hain jo karna hai.',
      'Sir, late ho raha hai — kuch important hai toh batayein.',
      'Raat ho gayi sir, lekin main fresh hoon — boliye.',
      'Sir, itni raat tak kaam — respect hai aapke liye.',
      'Sir, night shift? Main bhi ready — boliye kya chahiye.',
      'Sir, raat mein bhi aapka assistant online hai.',
    ],
    late_night: [
      'Sir, bahut raat ho gayi — sab theek hai?',
      'Sir, itni raat? Jaldi kaam khatam karein aur rest karein.',
      'Sir, late night hai — main hoon toh jaldi nipta lete hain.',
      'Sir, aapki health bhi zaroori hai — jaldi khatam karein!',
      'Sir, bahut late ho gaya — kuch urgent hai toh bataiye warna so jaiye.',
      'Sir, midnight past — dedication toh hai, lekin rest bhi lo.',
      'Sir, itni raat ko bhi main ready hoon — boliye.',
      'Sir, late night session? Jaldi karein — main full speed pe hoon.',
    ],
  };

  // ── OFFER LINES (what help Rudra24 AI is offering) ──────────
  // These are the "how may I help you" variations — the real soul of the feature
  const OFFERS = [
    'Boliye sir, kaise madad karun?',
    'Batayein, kya karna hai — main ready hoon.',
    'Aap boliye, main sun raha hoon.',
    'Kuch bhi chahiye toh bas bol dijiye.',
    'Aaj mein kya help kar sakta hoon aapki?',
    'Koi kaam ho toh bataiye — main hoon.',
    'Sir, aapke liye kya karun? Leads, data, calls — jo chahiye.',
    'Main yahan hoon sir — aap boliye bass.',
    'Bataiye sir, kahan se shuru karein aaj.',
    'Aapka assistant ready hai — order dijiye.',
    'Jo bhi chahiye — leads, contacts, data — bol dijiye sir.',
    'Aap command dijiye, main execute karunga.',
    'Main tayyar hoon sir, aap boliye kya karna hai.',
    'Kuch bhi ho sir — main ek call pe hoon.',
    'Boliye sir, kya plan hai aaj?',
    'Leads chahiye? Data chahiye? Jo bhi ho — boliye.',
    'Main aapka kaam aasan karne ke liye hoon — bataiye.',
    'Sir, mujhe lagayein kaam pe — batayein kya karna hai.',
    'Aaj ka target kya hai sir? Main set kar deta hoon.',
    'Main hoon na sir — aap relax rahein, kaam mujhe de dijiye.',
    'Sir aap bas boliye — baaki main sambhal lunga.',
    'Kuch naya kaam ya puraana pending — jo bhi ho bataiye sir.',
    'Aapke liye kya karun aaj sir? Leads, analysis, calls?',
    'Main full ready hoon sir, command dijiye bass.',
    'Kuch help chahiye ya phir sirf check-in? Jo bhi ho, main hoon.',
  ];

  // ── CONTEXT-AWARE EXTRAS (returning user, weekend, etc.) ──
  const RETURN_QUICK = [
    'Wapas aa gaye sir, achha laga!',
    'Sir, phir se aaye — shandaar!',
    'Welcome back sir!',
    'Sir, aap wapas aaye — main ready tha.',
    'Phir se hazir sir! Good to see you.',
  ];
  const RETURN_AFTER_LONG = [
    'Sir, kaafi din ho gaye — sab theek?',
    'Bahut din baad aaye sir — miss kiya!',
    'Sir, kaafi time baad! Koi nahi, main waise bhi aapka wait kar raha tha.',
    'Arre sir, kahan the? Chaliye kaam pe lagte hain.',
    'Long time no see, sir! Ab aa gaye toh full speed pe chalein.',
  ];
  const WEEKEND_LINES = [
    'Weekend hai sir, phir bhi dedication — respect!',
    'Sir, chutti ke din bhi kaam? Salaam hai aapko.',
    'Weekend grind, sir! Achha hai.',
    'Sir, aaj toh aaram ka din hai — phir bhi kaam?',
  ];

  // ── CONNECTOR WORDS (to join opening + offer naturally) ──
  const CONNECTORS = [
    '', // sometimes no connector feels more natural
    ' ',
    ' Toh, ',
    ' Achha, ',
    ' Chaliye, ',
    ' Ab, ',
    ' Waise, ',
  ];

  // ── PICK WITH ANTI-REPEAT ──────────────────────────────
  function pick(arr) {
    return arr[Math.floor(Math.random() * arr.length)];
  }

  function pickDifferent(arr, lastUsed) {
    if (arr.length <= 1) return arr[0] || '';
    let tries = 0;
    let choice;
    do {
      choice = arr[Math.floor(Math.random() * arr.length)];
      tries++;
    } while (choice === lastUsed && tries < 10);
    return choice;
  }

  // ── COMPOSE THE FULL GREETING ──────────────────────────
  function compose() {
    const now = new Date();
    const h = now.getHours();
    const dayOfWeek = now.getDay(); // 0=Sun, 6=Sat
    const slot = getTimeSlot(h);
    const lastGreet = localStorage.getItem(LS_LAST_GREET) || '';
    const lastVisit = parseInt(localStorage.getItem(LS_LAST_VISIT) || '0', 10);
    const visitCount = parseInt(localStorage.getItem(LS_VISIT_COUNT) || '0', 10) + 1;
    const hoursSinceVisit = lastVisit ? (Date.now() - lastVisit) / 3600000 : 999;
    const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;

    // Pick opening (time-based)
    const openings = OPENINGS[slot] || OPENINGS.morning;
    const opening = pickDifferent(openings, lastGreet.split('|||')[0]);

    // Pick offer
    const offer = pickDifferent(OFFERS, lastGreet.split('|||')[1]);

    // Possibly add a context-aware prefix
    let contextLine = '';
    if (hoursSinceVisit > 72 && visitCount > 2) {
      contextLine = pick(RETURN_AFTER_LONG) + ' ';
    } else if (hoursSinceVisit < 2 && visitCount > 1) {
      contextLine = pick(RETURN_QUICK) + ' ';
    } else if (isWeekend && Math.random() < 0.4) {
      contextLine = pick(WEEKEND_LINES) + ' ';
    }

    // Pick connector (sometimes empty for variety)
    const connector = Math.random() < 0.3 ? '' : pick(CONNECTORS);

    // Build final greeting
    let greeting;
    if (contextLine && Math.random() < 0.6) {
      // Context-first format: "Welcome back sir! Good morning! Boliye..."
      greeting = `${contextLine}${opening}${connector}${offer}`;
    } else {
      // Normal format: "Good morning sir! Boliye..."
      greeting = `${opening}${connector}${offer}`;
    }

    // Store for anti-repeat
    localStorage.setItem(LS_LAST_GREET, `${opening}|||${offer}`);
    localStorage.setItem(LS_LAST_VISIT, String(Date.now()));
    localStorage.setItem(LS_VISIT_COUNT, String(visitCount));

    return greeting.replace(/\s{2,}/g, ' ').trim();
  }

  // ── VISUAL GREETING UPDATE (for the #jarvis-welcome-text) ──
  function updateVisualGreeting() {
    const h = new Date().getHours();
    const slot = getTimeSlot(h);
    const honorific = window.UserProfileManager?.getHonorificName?.() || 'Sir';

    // Time-based visual titles (shorter, for the h2 heading)
    const VISUAL_TITLES = {
      early_morning: [
        `Subah subah, ${honorific}! Main hoon.`,
        `Early start, ${honorific}! Rudra24 AI ready.`,
        `${honorific}, itni subah? Respect!`,
      ],
      morning: [
        `Good morning, ${honorific}!`,
        `Suprabhat, ${honorific}!`,
        `Morning, ${honorific}! Ready hoon.`,
        `Namaste ${honorific}!`,
      ],
      late_morning: [
        `Hello ${honorific}!`,
        `${honorific}, kaise hain?`,
        `Hey ${honorific}! Ready hoon.`,
      ],
      afternoon: [
        `Good afternoon, ${honorific}!`,
        `Namaste ${honorific}!`,
        `${honorific}, dopahar mein bhi ready!`,
      ],
      late_afternoon: [
        `Hello ${honorific}!`,
        `${honorific}, shaam ho rahi hai!`,
        `${honorific}, ab tak chal raha hai? Nice!`,
      ],
      evening: [
        `Good evening, ${honorific}!`,
        `Shaam ho gayi, ${honorific}!`,
        `${honorific}, good evening!`,
      ],
      night: [
        `Good night, ${honorific}!`,
        `${honorific}, raat ho gayi!`,
        `Late session, ${honorific}!`,
      ],
      late_night: [
        `${honorific}, bahut raat ho gayi!`,
        `Late night, ${honorific}!`,
        `${honorific}, rest bhi zaroori hai!`,
      ],
    };

    const titles = VISUAL_TITLES[slot] || VISUAL_TITLES.morning;
    const title = pick(titles);

    const el = document.getElementById('jarvis-welcome-text');
    if (el) el.textContent = title;

    // Also update the subgreeting with a varied line
    const SUB_LINES = [
      'Aapka personal AI executive assistant.',
      'Main aapki madad ke liye hoon.',
      'Boliye sir, kya karna hai?',
      'Aapka assistant tayyar hai.',
      'Bass boliye, main sun raha hoon.',
      'Leads, data, analysis — jo chahiye.',
    ];
    const subEl = document.getElementById('jarvis-subgreeting') ||
                  document.querySelector('.jarvis-subgreeting');
    if (subEl) subEl.textContent = pick(SUB_LINES);
  }

  // ── DELIVER THE SPOKEN BOOT GREETING ───────────────────
  // Boot par ab koi LLM call nahi, aur ClavisLive.start({trigger:'boot'}) bhi
  // nahi (wo mic stream khol deta tha aur 10 min tak quota khata tha). Bas ek
  // chhoti local line, din me ek hi baar, aur batata hai ki jagana kaise hai.
  const LS_GREET_DAY = 'clavis_boot_greet_day';
  const SHORT_LINES = {
    morning: [
      'Good morning sir, main yahin hoon — kaam ho to bas \'Rudra\' boliye.',
      'Suprabhat sir. Jab chahiye, \'Rudra\' boliye — main sun lunga.',
    ],
    afternoon: [
      'Good afternoon sir, main yahin hoon — kaam ho to bas \'Rudra\' boliye.',
      'Namaste sir. Kuch chahiye to \'Rudra\' bol dijiye.',
    ],
    evening: [
      'Good evening sir, main yahin hoon — kaam ho to bas \'Rudra\' boliye.',
      'Shaam ho gayi sir. Jab zaroorat ho, \'Rudra\' boliye.',
    ],
    night: [
      'Sir, raat ho gayi — main yahin hoon, kaam ho to \'Rudra\' boliye.',
      'Good night sir. Kuch chahiye to bas \'Rudra\' boliye.',
    ],
  };
  function shortLine() {
    const h = new Date().getHours();
    const part = h >= 4 && h < 12 ? 'morning' : h < 17 && h >= 12 ? 'afternoon' : h >= 17 && h < 21 ? 'evening' : 'night';
    return pick(SHORT_LINES[part]);
  }
  function todayKey() {
    const d = new Date();
    return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
  }

  let _greeted = false;

  async function deliverBootGreeting() {
    // Only greet once per page session
    if (_greeted) return;
    if (sessionStorage.getItem(LS_GREETED_SESSION) === 'true') return;
    if (!window.ClavisVoiceState?.isClavisWorkspace?.()) return;
    _greeted = true;
    sessionStorage.setItem(LS_GREETED_SESSION, 'true');

    // Visual heading har open par (local, free).
    updateVisualGreeting();

    // Opening or signing in to the app is not a request for spoken audio.
    if (localStorage.getItem('clavis_spoken_boot_greeting') !== 'true') return;

    // Bolna sirf din me ek baar.
    let spokeToday = false;
    try { spokeToday = localStorage.getItem(LS_GREET_DAY) === todayKey(); } catch (_) {}
    if (spokeToday) return;

    const greeting = shortLine();
    // Small delay to let the page settle and feel natural
    await new Promise(r => setTimeout(r, 1800));

    if (!window.ClavisVoiceState?.isClavisWorkspace?.()) {
      _greeted = false;
      sessionStorage.removeItem(LS_GREETED_SESSION);
      return;
    }

    const speechEnabled = localStorage.getItem('jarvis_speech_enabled') !== 'false';
    if (!speechEnabled) return;
    try { localStorage.setItem(LS_GREET_DAY, todayKey()); } catch (_) {}
    try { window.speakJarvisText?.(greeting); } catch (_) {}

    // Feed cognitive core (local only)
    try { window.ClavisMind?.noteClavisTurn?.(greeting); } catch (_) {}
    console.debug('[ClavisBootGreet] Delivered:', greeting);
  }

  // ── AUTO-TRIGGER ───────────────────────────────────────
  function init() {
    // Wait for DOM + other modules to initialize
    const boot = () => {
      // Delay to let jarvis_ui.js finish its init and speech get unlocked
      setTimeout(deliverBootGreeting, 2500);
    };

    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', boot);
    } else {
      boot();
    }
    window.addEventListener('clavis:workspace-change', deliverBootGreeting);
  }

  init();

  return {
    deliverBootGreeting,
    updateVisualGreeting,
    compose, // for testing
  };
})();
