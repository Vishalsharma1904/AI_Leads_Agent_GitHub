/**
 * ============================================================
 *  CLAVIS VOICE NAVIGATION (clavis-voice-nav.js)
 *  In-app navigation & verbal control — Hindi/English/Hinglish
 *  Handles app page switching, lead generation, filtering,
 *  exporting, settings, theme toggle, image fetch, and task surface.
 *  route(text) → { handled, spoken?, navigate?, action? }
 * ============================================================
 */
'use strict';

(() => {
  const norm = (s) => String(s || '').toLowerCase().replace(/[.!?,]+$/g, '').replace(/\s+/g, ' ').trim();

  // Helper: animate element entrance
  function animateEntrance(el) {
    if (!el) return;
    el.classList.remove('au-spring-in');
    void el.offsetWidth;
    el.classList.add('au-spring-in');
  }

  // ---- Navigation & Action command patterns ----
  const NAV_COMMANDS = [
    // 1. Dashboard
    {
      name: 'dashboard',
      patterns: [
        /^(?:(?:go to|open|show)\s+)?(dashboard|home|home page|main page|overview)(?:\s+(?:pe|par|kholo|jao|dikhao|chalo|page))?$/i,
        /\b(dashboard (pe|par|me|ko|kholo|jao|dikhao|dikha)|go to dashboard|open dashboard|show dashboard|home page (pe|par) (jao|chalo))\b/i
      ],
      speak: 'Dashboard khol raha hoon.',
      action: () => switchToView('dashboard')
    },

    // 2. Leads Database
    {
      name: 'leads',
      patterns: [
        /\b(leads? (page|tab|section|pe|par|me|ko|dikhao|dikha|kholo|jao|le jao)|go to leads?|open leads?|show leads?|leads? dekhna|leads? dikhao)\b/i,
        /\b(lead database|lead list|my leads?|data dikhao|sari leads)\b/i
      ],
      speak: 'Leads page par ja raha hoon.',
      action: () => switchToView('leads')
    },

    // 3. Clavis AI Studio / Jarvis
    {
      name: 'clavis',
      patterns: [
        /\b(clavis (tab|ai|studio|page|pe|par|me|ko|kholo|jao|open karo)|open clavis|go to clavis|clavis open|ai studio)\b/i,
        /\b(jarvis tab|ai tab|assistant tab|chat tab|chat kholo)\b/i
      ],
      speak: 'Clavis AI Studio khol raha hoon.',
      action: () => switchToView('jarvis')
    },

    // 4. Analytics
    {
      name: 'analytics',
      patterns: [
        /^(?:(?:go to|open|show)\s+)?(analytics|statistics)(?:\s+(?:pe|par|kholo|jao|dikhao|page))?$/i,
        /\b(analytics (pe|par|dikhao|kholo|jao|page)|go to analytics|open analytics|show analytics|analytics page)\b/i
      ],
      speak: 'Analytics page par ja raha hoon.',
      action: () => switchToView('analytics')
    },

    // 5. Email Outreach
    {
      name: 'email',
      patterns: [
        /\b(email (page|tab|section|pe|par|me|kholo|jao)|go to email|open email|show emails?)\b/i,
        /\b(email (compose|manager|outreach)|mailbox|inbox)\b/i
      ],
      speak: 'Email page khol raha hoon.',
      action: () => switchToView('email')
    },

    // 6. WhatsApp
    {
      name: 'whatsapp',
      patterns: [
        /\b(whatsapp (page|tab|kholo|jao|pe|par)|go to whatsapp|open whatsapp (tab|page)?)\b/i
      ],
      speak: 'WhatsApp page par ja raha hoon.',
      action: () => switchToView('whatsapp')
    },

    // 7. Plugins
    {
      name: 'plugins',
      patterns: [
        /\b(plugins? (page|tab|kholo|jao|pe|par)|go to plugins?|open plugins?)\b/i
      ],
      speak: 'Plugins page khol raha hoon.',
      action: () => switchToView('plugins')
    },

    // 8. Settings
    {
      name: 'settings',
      patterns: [
        /\b(settings? (kholo|open|pe|par|jao|dikhao)|open settings?|go to settings?|settings? page)\b/i,
        /^(settings|configuration|preferences?|setup kholo)$/i
      ],
      speak: 'Settings khol raha hoon.',
      action: () => openSettings()
    },

    // 9. Close Settings / Close Modals
    {
      name: 'close_modal',
      patterns: [
        /\b(settings? (band|close) karo|modal (band|close) karo|close settings?)\b/i,
        /\b(popup band karo|close popup)\b/i
      ],
      speak: 'Window band kar di.',
      action: () => closeOverlays()
    },

    // 10. Dark Theme
    {
      name: 'theme_dark',
      patterns: [
        /\b(dark (mode|theme)|dark mode (on|karo|lagao|enable)|raat wala theme|dark theme lagao)\b/i,
        /\b(andhera (karo|mode)|night mode (on|karo)?)\b/i
      ],
      speak: 'Dark mode laga raha hoon.',
      action: () => setTheme('dark')
    },

    // 11. Light Theme
    {
      name: 'theme_light',
      patterns: [
        /\b(light (mode|theme)|light mode (on|karo|lagao|enable)|din wala theme|light theme lagao)\b/i,
        /\b(ujala (karo|mode)|day mode|white mode (on|karo)?)\b/i
      ],
      speak: 'Light mode laga raha hoon.',
      action: () => setTheme('light')
    },

    // 12. Theme Toggle
    {
      name: 'theme_toggle',
      patterns: [
        /\b(theme (badlo|change karo|toggle|switch)|toggle theme|change theme|theme switch)\b/i,
        /\b(dark light (switch|toggle|badlo)|theme toggle karo)\b/i
      ],
      speak: 'Theme switch kar raha hoon.',
      action: () => {
        if (typeof window.toggleDayNightTheme === 'function') {
          window.toggleDayNightTheme();
        } else if (window.ThemeController) {
          const cur = window.ThemeController.get?.() || document.documentElement.getAttribute('data-theme') || 'dark';
          setTheme(cur === 'dark' ? 'light' : 'dark');
        }
      }
    },

    // 13. Export Leads
    {
      name: 'export_leads',
      patterns: [
        /\b(export (leads?|data|csv|excel)|(leads?|data) (export|download) karo|(csv|excel) (mein|me) (nikalo|export karo))\b/i,
        /\b(download (leads?|data|csv)|file download karo)\b/i
      ],
      speak: 'Leads file export kar raha hoon.',
      action: () => triggerExport()
    },

    // 14. Show All Leads / Reset Filter
    {
      name: 'show_all_leads',
      patterns: [
        /\b(show (all )?leads?|saare leads? dikhao|all leads? dikhao|leads? list dikhao)\b/i,
        /\b(saari leads?|show all|dikhao saare|filter hatao|clear filter)\b/i
      ],
      speak: 'Saari leads dikha raha hoon.',
      action: () => triggerShowAll()
    },

    // 15. Task Window / Floating Panel Toggle
    {
      name: 'task_window',
      patterns: [
        /\b(task (window|panel|surface) (kholo|open|dikhao|band karo)|open task|floating (window|panel) (kholo|open|dikhao))\b/i,
        /\b(clavis task|task status|kya ho raha hai|progress dikhao)\b/i
      ],
      speak: 'Floating task window khol raha hoon.',
      action: () => {
        if (window.ClavisTaskSurface) {
          window.ClavisTaskSurface.toggle();
          const p = document.getElementById('clavis-task-surface');
          if (p && p.classList.contains('is-open')) animateEntrance(p);
        }
      }
    },

    // 16. Fetch Images via Chat / Voice
    {
      name: 'fetch_images',
      patterns: [
        /(?:ki\s+)?(?:purani\s+|naya\s+|new\s+|old\s+)?(?:photo|image|photos|images|tasveer|tasveerein|picture|pics?)\s+(?:dikhao|dihao|dehao|dikhaye|lao|fetch|search|dhundho|bhejo|chahiye)/i,
        /(?:fetch|search|show|find)\s+(?:images?|photos?|pictures?)\s+(?:of|for)?\s*(.+)/i
      ],
      actionWithMatch: (match, raw) => {
        let topic = '';
        const m1 = raw.match(/(.+?)\s+(?:ki\s+)?(?:purani\s+|naya\s+|new\s+|old\s+)?(?:photo|image|photos|images|tasveer|tasveerein|picture|pics?)\s*(?:dikhao|dihao|dehao|dikhaye|lao|fetch|search|dhundho|bhejo|chahiye)?/i);
        if (m1 && m1[1]) topic = m1[1].trim();
        else {
          const m2 = raw.match(/(?:fetch|search|show|find)\s+(?:images?|photos?|pictures?)\s+(?:of|for)?\s*(.+)/i);
          if (m2 && m2[1]) topic = m2[1].trim();
        }
        if (!topic) topic = raw;
        // Clean prefixes & suffixes
        topic = topic.replace(/^(mujhe|humein|please|can you|zara)\s+/i, '').replace(/\s+(ki|ka|ke)$/i, '').trim();

        // Say what was actually understood ("lord" → Hindu deities,
        // "shiv ji" → Lord Shiva), not the raw word he typed.
        let said = topic;
        try {
          const q = window.ClavisLuxe?.understandImageQuery?.(raw);
          if (q && (q.name || q.subject)) said = q.name || q.subject;
        } catch (e) {}

        // Forward to Clavis Luxe research or composer
        if (window.ClavisLuxe && typeof window.ClavisLuxe.researchImages === 'function') {
          window.ClavisLuxe.researchImages(topic);
          return { handled: true, spoken: `${said} ki photos dikha raha hoon.` };
        }

        // Send into chat input
        submitChatPrompt(`Search and show images of ${topic}`);
        return { handled: true, spoken: `${topic} ki images search kar raha hoon.` };
      }
    },

    // 17. Lead generation by voice
    {
      name: 'generate_leads',
      patterns: [
        /(\d+)?\s*(?:leads?|contacts?|companies?)\s*(?:nikalo|generate karo|dhundho|search karo|lao|chahiye)\s*(?:in\s+|mein\s+)?([a-zA-Z\s]+)?/i,
        /(?:generate|find|get)\s*(\d+)?\s*(?:leads?|contacts?)\s*(?:in\s+|for\s+)?([a-zA-Z\s]+)?/i
      ],
      actionWithMatch: (match, raw) => {
        submitChatPrompt(raw);
        return { handled: true, spoken: 'Aapki lead request process kar raha hoon.' };
      }
    }
  ];

  // ---- Helper: Switch view with smooth transition ----
  function switchToView(viewName) {
    const viewMap = {
      'dashboard': ['view-dashboard', 'dashboard'],
      'leads': ['view-leads', 'leads'],
      'jarvis': ['view-jarvis', 'jarvis', 'clavis', 'ai-studio'],
      'analytics': ['view-analytics', 'analytics'],
      'email': ['view-email', 'email'],
      'plugins': ['view-plugins', 'plugins'],
      'whatsapp': ['view-whatsapp', 'whatsapp']
    };
    const ids = viewMap[viewName] || [viewName];

    // Method 1: window.showView or window.switchView
    if (typeof window.showView === 'function') {
      for (const id of ids) {
        try {
          window.showView(id);
          const target = document.getElementById(id) || document.getElementById(`view-${id}`);
          animateEntrance(target);
          return;
        } catch(e) {}
      }
    }
    if (typeof window.switchView === 'function') {
      for (const id of ids) {
        try {
          window.switchView(id);
          const target = document.getElementById(id) || document.getElementById(`view-${id}`);
          animateEntrance(target);
          return;
        } catch(e) {}
      }
    }

    // Method 2: Click matching sidebar nav element
    for (const id of ids) {
      const navBtn = document.querySelector(
        `[data-view="${id}"], [data-page="${id}"], .nav-item[href*="${id}"], .nav-item[data-id*="${id}"], #nav-${id}`
      );
      if (navBtn) {
        navBtn.click();
        const target = document.getElementById(id) || document.getElementById(`view-${id}`);
        animateEntrance(target);
        return;
      }
    }

    // Method 3: Direct class manipulation
    for (const id of ids) {
      const viewEl = document.getElementById(`view-${id}`) || document.getElementById(id);
      if (viewEl) {
        document.querySelectorAll('.view, [id^="view-"]').forEach(v => v.classList.remove('active'));
        viewEl.classList.add('active');
        animateEntrance(viewEl);
        return;
      }
    }
  }

  // ---- Helper: Open settings with animation ----
  function openSettings() {
    if (typeof window.openSettings === 'function') {
      window.openSettings();
      const w = document.querySelector('.mac-settings-window');
      animateEntrance(w);
      return;
    }
    if (typeof window.openSettingsModal === 'function') {
      window.openSettingsModal();
      const w = document.querySelector('.mac-settings-window');
      animateEntrance(w);
      return;
    }
    const settingsOverlay = document.querySelector('.mac-settings-overlay, #settings-overlay');
    if (settingsOverlay) {
      settingsOverlay.classList.remove('closing');
      settingsOverlay.classList.add('active');
      const w = settingsOverlay.querySelector('.mac-settings-window');
      animateEntrance(w);
      return;
    }
    const settingsBtn = document.querySelector('#settings-btn, .settings-btn, [data-action="settings"]');
    if (settingsBtn) settingsBtn.click();
  }

  // ---- Helper: Close overlays / settings ----
  function closeOverlays() {
    const settingsOverlay = document.querySelector('.mac-settings-overlay.active, #settings-overlay.active');
    if (settingsOverlay) {
      settingsOverlay.classList.add('closing');
      setTimeout(() => {
        settingsOverlay.classList.remove('active', 'closing');
      }, 200);
      return;
    }
    const closeBtns = document.querySelectorAll('.mac-settings-close, .modal-close, .smodal-close');
    if (closeBtns.length) closeBtns[0].click();
  }

  // ---- Helper: Set theme atomically ----
  function setTheme(theme) {
    if (window.ThemeController && typeof window.ThemeController.set === 'function') {
      window.ThemeController.set(theme, { animate: true, manual: true });
      return;
    }
    document.documentElement.setAttribute('data-theme', theme);
    try { localStorage.setItem('skylark-theme', theme); } catch(e) {}
  }

  // ---- Helper: Export leads ----
  function triggerExport() {
    if (typeof window.exportLeadsToCSV === 'function') { window.exportLeadsToCSV(); return; }
    if (typeof window.exportLeads === 'function') { window.exportLeads(); return; }
    submitChatPrompt('export leads to csv');
  }

  // ---- Helper: Show all leads ----
  function triggerShowAll() {
    switchToView('leads');
    setTimeout(() => {
      if (typeof window.showAllLeads === 'function') { window.showAllLeads(); return; }
      const showAllBtn = document.querySelector('[data-filter="all"], .show-all-btn, .filter-all, #leads-filter-all');
      if (showAllBtn) showAllBtn.click();
    }, 280);
  }

  // ---- Helper: Submit prompt into chat engine ----
  function submitChatPrompt(promptText) {
    const input = document.querySelector('#home-chat-input, #jarvis-input, .jarvis-composer-input, textarea.chat-input');
    if (input) {
      input.value = promptText;
      input.dispatchEvent(new Event('input', { bubbles: true }));
      const sendBtn = document.querySelector('#home-chat-send, #jarvis-send, .jarvis-composer-send, .chat-send-btn');
      if (sendBtn) {
        setTimeout(() => sendBtn.click(), 60);
      }
    }
  }

  // ---- Variety: the same command never gets the same sentence twice ----
  // Jarvis never answers "Dashboard khol raha hoon" word for word every time.
  const VARIANTS = {
    dashboard: ['Dashboard khol raha hoon.', 'Yeh raha aapka dashboard, sir.', 'Dashboard par chalte hain.', 'Overview samne hai, sir.'],
    leads: ['Leads page par ja raha hoon.', 'Aapki leads yeh rahi.', 'Leads khol di, sir.', 'Leads database samne hai.'],
    clavis: ['Clavis Studio khol raha hoon.', 'Main yahin hoon, sir.', 'Studio samne hai.'],
    analytics: ['Analytics khol raha hoon.', 'Numbers yeh rahe, sir.', 'Analytics par chalte hain.'],
    email: ['Email page khol raha hoon.', 'Inbox samne hai, sir.', 'Email outreach khol diya.'],
    whatsapp: ['WhatsApp page par ja raha hoon.', 'WhatsApp khol diya, sir.'],
    plugins: ['Plugins khol raha hoon.', 'Plugins samne hain.'],
    settings: ['Settings khol raha hoon.', 'Settings yeh rahi, sir.', 'Settings khol di.'],
    close_modal: ['Band kar diya.', 'Hata diya, sir.', 'Window band.'],
    theme_dark: ['Dark mode laga raha hoon.', 'Andhera kar diya, sir — aankhon ko aaram.', 'Dark mode on.'],
    theme_light: ['Light mode laga raha hoon.', 'Ujala kar diya, sir.', 'Light mode on.'],
    theme_toggle: ['Theme badal diya.', 'Theme switch kar diya, sir.'],
    export_leads: ['Leads export kar raha hoon.', 'File taiyar kar raha hoon, sir.', 'Export shuru — ek pal.'],
    show_all_leads: ['Saari leads dikha raha hoon.', 'Filter hata diya — sab leads samne hain.', 'Poori list yeh rahi, sir.'],
    task_window: ['Task window khol raha hoon.', 'Floating window samne hai.'],
  };
  function vary(cmd) {
    const pool = VARIANTS[cmd.name];
    if (!pool) return cmd.speak || '';
    try { return window.ClavisEmotionalEngine?.pickDifferent?.(pool, 'nav_' + cmd.name) || pool[Math.floor(Math.random() * pool.length)]; }
    catch (e) { return pool[0]; }
  }

  // ---- Main Route function ----
  function route(text) {
    const raw = String(text || '').trim();
    const t = norm(raw);
    if (!t) return { handled: false };

    for (const cmd of NAV_COMMANDS) {
      if (cmd.actionWithMatch) {
        for (const pattern of cmd.patterns) {
          const m = t.match(pattern);
          if (m) {
            try {
              const res = cmd.actionWithMatch(m, raw);
              return res || { handled: true, spoken: cmd.speak || '' };
            } catch(e) {
              console.warn('[ClavisVoiceNav] match error for', cmd.name, e);
            }
          }
        }
      } else if (cmd.action) {
        for (const pattern of cmd.patterns) {
          if (pattern.test(t)) {
            try {
              cmd.action();
            } catch(e) {
              console.warn('[ClavisVoiceNav] action error for', cmd.name, e);
            }
            return { handled: true, spoken: vary(cmd), navigate: cmd.name };
          }
        }
      }
    }

    return { handled: false };
  }

  window.ClavisVoiceNav = { route, switchToView, openSettings, setTheme, animateEntrance };
})();
