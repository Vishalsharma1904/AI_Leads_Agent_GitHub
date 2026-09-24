/**
 * nexus-experience.js
 * 1. Time-aware greeting with the owner's name
 * 2. Automatic day/night theme with a smooth transition
 * 3. Google-AI-Studio-style inline ghost suggestions (Tab to accept),
 *    synced to what this agent actually does: B2B lead acquisition.
 */
'use strict';

/* ═══════════════ 1. TIME-AWARE GREETING ═══════════════ */
(function NexusGreeting() {
  function partOfDay(h) {
    if (h < 5)  return 'Working late';
    if (h < 12) return 'Good morning';
    if (h < 17) return 'Good afternoon';
    if (h < 21) return 'Good evening';
    return 'Good night';
  }

  // Placeholder identities used by guest/demo sessions — never greet these by name.
  const PLACEHOLDER = /^(demo|demo user|guest|guest user|user|test|admin|your workspace|enterprise|ai leads demo)$/i;

  function honorificName() {
    try {
      if (window.UserProfileManager?.getHonorificName) {
        return window.UserProfileManager.getHonorificName();
      }
      const p = window.UserProfileManager?.getProfile?.() || {};
      const isDemo = localStorage.getItem('skylark_demo_mode') === 'true' ||
                     localStorage.getItem('skylark_guest') === 'true';
      const raw = (p.name || '').trim();
      if (!isDemo && raw && !PLACEHOLDER.test(raw)) {
        const clean = raw.replace(/[0-9]/g, '').trim();
        const first = clean.split(/\s+/)[0];
        return first ? `${first} Sir` : 'Sir';
      }
    } catch (_) {}
    return 'Sir';   // demo / guest / placeholder → respectful fallback
  }

  function render() {
    const el = document.getElementById('welcome-greeting');
    if (!el) return;
    const name = honorificName();
    const greet = partOfDay(new Date().getHours());
    el.innerHTML = name
      ? `${greet}, <span class="lx-greet-name">${name}</span>`
      : greet;
  }

  window.NexusGreeting = { render };
  document.addEventListener('DOMContentLoaded', () => { render(); setInterval(render, 60000); });
  document.addEventListener('nexus:profilechange', render);
})();


/* ═══════════════ 2. AUTOMATIC DAY / NIGHT THEME ═══════════════ */
(function NexusAutoTheme() {
  const KEY = 'skylark-theme-auto';
  const isAuto = () => localStorage.getItem(KEY) !== 'false';   // on by default
  const themeForNow = () => {
    const h = new Date().getHours();
    return (h >= 7 && h < 18) ? 'light' : 'dark';
  };

  function apply(reason) {
    if (!isAuto()) return;
    const want = themeForNow();
    if ((document.documentElement.getAttribute('data-theme') || 'dark') === want) return;
    document.documentElement.classList.add('lx-theme-morphing');
    window.ThemeController?.set(want, { animate: true });
    setTimeout(() => document.documentElement.classList.remove('lx-theme-morphing'), 900);
    if (reason === 'tick') {
      window.showToast?.('info', want === 'light' ? 'Switched to Day Mode' : 'Switched to Night Mode',
        'Auto theme follows your local time. Turn it off in Settings → Appearance.');
    }
  }

  window.NexusAutoTheme = {
    isEnabled: isAuto,
    setEnabled(on) {
      localStorage.setItem(KEY, String(!!on));
      if (on) apply('manual');
    }
  };

  document.addEventListener('DOMContentLoaded', () => {
    setTimeout(() => apply('boot'), 300);
    setInterval(() => apply('tick'), 5 * 60 * 1000);
  });

  // A manual toggle from the user opts out of auto for the rest of the session
  document.addEventListener('nexus:themechange', (e) => {
    if (e.detail?.manual) localStorage.setItem(KEY, 'false');
  });
})();


/* ═══════════════ 3. INLINE GHOST SUGGESTIONS (Tab to accept) ═══════════════ */
(function NexusSuggest() {
  const CITIES = ['Gurugram', 'Delhi', 'Noida', 'Mumbai', 'Bangalore', 'Hyderabad', 'Pune',
    'Chennai', 'Kolkata', 'Ahmedabad', 'Jaipur', 'Faridabad', 'Ghaziabad', 'Greater Noida', 'Manesar'];

  function industries() {
    const fromDb = window.IndustryDB?.getNames?.();
    if (fromDb && fromDb.length) return fromDb;
    return ['Hotels & Hospitality', 'Hospitals & Healthcare', 'Corporate IT Parks',
      'Malls & Retail Chains', 'Factories & Manufacturing', 'Schools & Colleges'];
  }

  // Full-sentence intents the agent can genuinely execute
  function templates() {
    const city = window.SKYLARK_CONFIG?.DEFAULT_CITY || 'Gurugram';
    const inds = industries();
    const short = inds.map(i => i.split(/[&,]/)[0].trim().toLowerCase());
    const t = [];

    // Open-vocabulary staffing suggestions, not just security/housekeeping.
    const roles = ['cooks', 'chefs', 'delivery executives', 'drivers', 'nurses',
      'receptionists', 'sales executives', 'software developers', 'accountants',
      'electricians', 'plumbers', 'teachers', 'waiters', 'security guards',
      'housekeeping staff'];
    short.slice(0, 6).forEach(ind => {
      roles.slice(0, 7).forEach(role => {
        t.push(`Find 20 ${ind} companies in ${city} needing ${role} with phone, email and website`);
      });
    });
    CITIES.slice(0, 8).forEach(c => {
      t.push(`Find 20 leads in ${c} for security guards with verified phone and email`);
      t.push(`Get 100 companies in ${c} needing housekeeping services`);
    });
    t.push(`Mujhe ${city} mein 20 companies chahiye jinhe cooks ki requirement hai with phone number aur email`);
    t.push('Mujhe 50 hospital leads chahiye Delhi mein nurses ke liye');
    t.push('Find companies hiring delivery executives in Mumbai with public contact details');

    // Data / analysis / export
    t.push('Show all uncontacted leads');
    t.push('Show me all leads with a verified email and phone number');
    t.push('How many leads do I have in the database?');
    t.push('Export all leads to Excel');
    t.push('Export all leads to CSV');
    t.push('Sync all leads to Google Sheets');
    t.push('Which city has the most leads right now?');
    t.push('What can you do for my business?');
    return t;
  }

  // Longest-sensible completion for the current input
  function complete(value) {
    const v = value.replace(/\s+$/, ' ');
    if (v.trim().length < 2) return '';
    const lower = v.toLowerCase();

    // 1 — full-sentence prefix match (best UX, most accurate)
    const prefixHits = templates().filter(t => t.toLowerCase().startsWith(lower) && t.length > v.length);
    if (prefixHits.length) {
      const hit = prefixHits[Math.floor(Math.random() * prefixHits.length)];
      return hit.slice(v.length);
    }

    // 2 — token completion for the word being typed (city / industry)
    const m = v.match(/([A-Za-z&]{2,})$/);
    if (m) {
      const frag = m[1].toLowerCase();
      const pool = [...CITIES, ...industries()];
      const wordHits = pool.filter(w => w.toLowerCase().startsWith(frag) && w.length > frag.length);
      const word = wordHits[Math.floor(Math.random() * wordHits.length)];
      if (word) return word.slice(frag.length);
    }

    // 3 — contextual next-phrase nudges
    if (/\b(in|from)\s+$/i.test(v)) {
      const cities = ['Gurugram', 'Delhi', 'Mumbai', 'Bengaluru', 'Noida'];
      return cities[Math.floor(Math.random() * cities.length)];
    }
    if (/\b(leads?|companies|clients)\s+$/i.test(v)) {
      const next = ['in Gurugram for cooks with phone, email and website',
        'in Delhi for nurses with public company contacts',
        'in Mumbai for delivery executives with verified websites'];
      return next[Math.floor(Math.random() * next.length)];
    }
    if (/\b(need|needs|needing|require|requiring|requirement|hiring)\s+$/i.test(v)) {
      const roleNext = ['cooks in Gurugram with public phone, email and website',
        'nurses in Delhi with public company contacts',
        'drivers in Mumbai with verified websites'];
      return roleNext[Math.floor(Math.random() * roleNext.length)];
    }
    if (/\b(cooks?|chefs?|nurses?|drivers?|developers?|receptionists?|accountants?)\s+$/i.test(v)) {
      const detailNext = ['in Gurugram with public company contact details',
        'in Delhi with phone, email and website',
        'in Mumbai with current public job signals'];
      return detailNext[Math.floor(Math.random() * detailNext.length)];
    }
    if (/\bfor\s+$/i.test(v)) return 'security guards with verified phone and email';
    if (/\b\d+\s+$/.test(v)) return 'leads in Gurugram with phone, email and website';
    return '';
  }

  const MIRROR = ['fontStyle','fontVariant','fontWeight','fontStretch','fontSize','fontFamily',
    'lineHeight','letterSpacing','wordSpacing','textIndent','textTransform',
    'paddingTop','paddingRight','paddingBottom','paddingLeft',
    'borderTopWidth','borderRightWidth','borderBottomWidth','borderLeftWidth',
    'boxSizing','whiteSpace','wordWrap','wordBreak','tabSize'];

  function attach(ta) {
    if (ta.__lxSuggestBound) return;
    ta.__lxSuggestBound = true;

    const host = ta.parentElement;
    if (host && getComputedStyle(host).position === 'static') host.style.position = 'relative';

    const ghost = document.createElement('div');
    ghost.className = 'lx-ghost';
    ghost.setAttribute('aria-hidden', 'true');
    ta.insertAdjacentElement('beforebegin', ghost);

    const hint = document.createElement('span');
    hint.className = 'lx-tab-hint';
    hint.innerHTML = `<kbd>Tab</kbd><span>to accept</span>`;
    ghost.insertAdjacentElement('afterend', hint);

    let current = '';
    let idleTimer = null;
    const IDLE_MS = 2600;   // calm pause without making the composer feel stuck

    function sync() {
      const cs = getComputedStyle(ta);
      MIRROR.forEach(p => { ghost.style[p] = cs[p]; });
      ghost.style.width = ta.clientWidth + 'px';
      ghost.style.height = ta.clientHeight + 'px';
      ghost.style.top = ta.offsetTop + 'px';
      ghost.style.left = ta.offsetLeft + 'px';
      ghost.scrollTop = ta.scrollTop;
    }

    function clear() {
      current = '';
      ghost.innerHTML = '';
      hint.classList.remove('show');
    }

    // Reveal the suggestion only once typing has genuinely paused.
    function reveal() {
      const val = ta.value;
      if (document.activeElement !== ta) return;
      const atEnd = ta.selectionStart === val.length && ta.selectionEnd === val.length;
      current = atEnd ? complete(val) : '';
      if (!current) { clear(); return; }
      sync();
      ghost.innerHTML =
        `<span class="lx-ghost-typed">${escapeHtml(val)}</span><span class="lx-ghost-sugg">${escapeHtml(current)}</span>`;
      hint.classList.add('show');
    }

    // Every keystroke hides the old hint and restarts the idle countdown.
    function schedule() {
      clear();
      clearTimeout(idleTimer);
      if (ta.value.trim().length < 2) return;
      idleTimer = setTimeout(reveal, IDLE_MS);
    }

    function accept() {
      if (!current) return false;
      const added = current;
      clear();
      clearTimeout(idleTimer);
      ta.value += added;
      ta.setSelectionRange(ta.value.length, ta.value.length);
      ta.dispatchEvent(new Event('input', { bubbles: true }));
      ta.classList.add('lx-accepted');
      setTimeout(() => ta.classList.remove('lx-accepted'), 320);
      return true;
    }

    ta.addEventListener('input', schedule);
    ta.addEventListener('click', schedule);
    ta.addEventListener('scroll', () => { ghost.scrollTop = ta.scrollTop; }, { passive: true });
    ta.addEventListener('blur', () => { clearTimeout(idleTimer); clear(); });
    window.addEventListener('resize', () => { if (current) { sync(); } }, { passive: true });

    ta.addEventListener('keydown', (e) => {
      if (e.key === 'Tab' && current) { e.preventDefault(); accept(); return; }
      // ArrowRight at the very end also accepts (like Studio / Copilot)
      if (e.key === 'ArrowRight' && current && ta.selectionStart === ta.value.length) { e.preventDefault(); accept(); return; }
      if (e.key === 'Escape' && current) { clear(); clearTimeout(idleTimer); return; }
      // Any other key restarts the pause timer
      if (e.key !== 'Tab' && e.key !== 'Shift') { clear(); clearTimeout(idleTimer); }
    });
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
  }

  function scan() {
    document.querySelectorAll('.claude-input-container textarea').forEach(attach);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', scan);
  else scan();
  new MutationObserver(scan).observe(document.body, { childList: true, subtree: true });
})();
