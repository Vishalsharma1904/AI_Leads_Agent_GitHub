/**
 * dev-mode.js
 * Hides every credential surface from normal users and unlocks it only via a
 * hidden gesture: tap the Build row 7 times in Settings → About (like Android's
 * build-number tap). Nothing advertises that the gesture exists.
 *
 * When locked:  API Keys + Lead Scraper settings are removed from the DOM flow,
 *               the sidebar "Apify Cloud" wording becomes neutral, and the
 *               API-key dashboard route is blocked — only a plain credit counter
 *               remains, so no key can leak over a shared screen.
 */
'use strict';

(function DevModeModule() {
  const KEY = 'skylark_dev_mode';
  const TAPS_REQUIRED = 7;
  const TAP_WINDOW_MS = 4000;

  const isOn = () => localStorage.getItem(KEY) === 'true';

  function apply() {
    const on = isOn();
    document.documentElement.classList.toggle('dev-mode', on);
    document.documentElement.classList.toggle('dev-locked', !on);

    // Keep the visible toggle in sync (it only exists while unlocked)
    const sw = document.getElementById('sm-dev-mode');
    if (sw) sw.checked = on;

    // If a hidden section is currently open, bounce back to a safe one
    if (!on) {
      const active = document.querySelector('#settings-overlay .smodal-section.active');
      if (active && /smsc-(api|scraper)$/.test(active.id)) {
        window.settingsNavTo?.('appearance',
          document.querySelector('.smodal-nav-item[data-section="appearance"]'));
      }
      // Block the developer-only API dashboard route
      if ((location.hash || '').toLowerCase() === '#tokens') {
        window.showView?.('dashboard');
      }
    }
    document.dispatchEvent(new CustomEvent('nexus:devmodechange', { detail: { on } }));
  }

  function set(on) {
    localStorage.setItem(KEY, String(!!on));
    apply();
    window.showToast?.(on ? 'success' : 'info',
      on ? '🔓 Developer Mode On' : 'Developer Mode Off',
      on ? 'API key sections are now visible in Settings.' : 'Credential sections are hidden again.');
  }

  /* ── Hidden unlock gesture on the Build row ── */
  function bindTapGesture() {
    const row = document.getElementById('build-tap-row');
    if (!row || row.__devBound) return;
    row.__devBound = true;

    let taps = 0, first = 0;
    row.addEventListener('click', () => {
      const t = Date.now();
      if (t - first > TAP_WINDOW_MS) { taps = 0; first = t; }
      taps++;

      if (isOn()) {
        // Already unlocked: 7 more taps locks it again.
        if (taps >= TAPS_REQUIRED) { taps = 0; set(false); }
        return;
      }
      const left = TAPS_REQUIRED - taps;
      // Stay silent for the first few taps so it is not discoverable by accident
      if (left <= 3 && left > 0) {
        window.showToast?.('info', 'Almost there', `${left} more ${left === 1 ? 'tap' : 'taps'}…`);
      }
      if (taps >= TAPS_REQUIRED) {
        taps = 0;
        set(true);
        window.settingsNavTo?.('api', document.querySelector('.smodal-nav-item[data-section="api"]'));
      }
    });
  }

  /* ── Route guard: block #tokens for normal users ── */
  function guardRoutes() {
    const orig = window.showView;
    if (typeof orig === 'function' && !orig.__devGuarded) {
      const guarded = function (id) {
        if (id === 'tokens' && !isOn()) {
          window.showToast?.('info', 'Not available', 'API diagnostics are developer-only.');
          return orig('dashboard');
        }
        return orig(id);
      };
      guarded.__devGuarded = true;
      window.showView = guarded;
    }
    window.addEventListener('hashchange', () => {
      if ((location.hash || '').toLowerCase() === '#tokens' && !isOn()) window.showView?.('dashboard');
    });
  }

  window.DevMode = { isOn, set, toggle: () => set(!isOn()), apply };

  function boot() {
    apply();
    bindTapGesture();
    guardRoutes();
    // The settings modal is built once, but re-bind defensively when it opens
    const ov = document.getElementById('settings-overlay');
    if (ov) new MutationObserver(() => { bindTapGesture(); apply(); })
      .observe(ov, { attributes: true, attributeFilter: ['class'] });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
