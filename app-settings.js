/**
 * app-settings.js
 * One store for the user-facing operational settings, with a single
 * load → apply → save path. Every control here genuinely changes behaviour:
 * the scraper, the chat defaults and the exporter all read from this store.
 */
'use strict';

(function AppSettingsModule() {
  const KEY = 'skylark_app_settings_v1';

  const DEFAULTS = {
    defaultCount: 20,
    maxPerRun: 100,
    warnLarge: true,
    defaultCity: 'Gurugram',
    reqWebsite: true,
    reqEmail: true,
    reqPhone: true,
    autoExcel: true,
    skipDupes: true,
    depth: 3,
    defaultService: 'all',
    // Reuse real scraped data for identical searches / already-seen websites
    // within this window, so repeat runs are faster and spend no extra credits.
    cacheEnabled: true,
    cacheDays: 21
  };

  let state = load();

  function load() {
    try { return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) || '{}') }; }
    catch (_) { return { ...DEFAULTS }; }
  }

  function persist() {
    try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (_) {}
  }

  const NUMERIC = new Set(['defaultCount', 'maxPerRun', 'depth', 'cacheDays']);

  // Hard product floor/ceiling for a run: never fewer than 20 leads, never
  // more than 100. Everything that parses a count funnels through clampCount.
  const MIN_LEADS = 20;
  const MAX_LEADS = 100;

  function set(key, value) {
    if (!(key in DEFAULTS)) return;
    state[key] = NUMERIC.has(key) ? (parseInt(value, 10) || DEFAULTS[key])
               : (typeof DEFAULTS[key] === 'boolean' ? !!value : String(value).trim() || DEFAULTS[key]);
    if (key === 'defaultCount' || key === 'maxPerRun') {
      state[key] = Math.max(MIN_LEADS, Math.min(MAX_LEADS, state[key]));
    }
    persist();
    apply();
    syncUI();
    document.dispatchEvent(new CustomEvent('nexus:settingschange', { detail: { ...state } }));
  }

  /** Push values into the systems that consume them. */
  function apply() {
    // Chat + agent defaults
    if (window.SKYLARK_CONFIG) window.SKYLARK_CONFIG.DEFAULT_CITY = state.defaultCity;

    // Service-line default used when the user names none
    const map = {
      all: ['All relevant requirements'],
      security: ['Security'],
      housekeeping: ['Housekeeping'],
      pantry: ['Pantry Boy']
    };
    window.SKYLARK_DEFAULT_SERVICES = map[state.defaultService] || map.all;

    // Mirror every service checkbox, including the `all` state. Previously the
    // all-three path skipped this write and left a stale single selection.
    const svc = window.SKYLARK_DEFAULT_SERVICES;
    if (window.AgentCtrl?.setSelectedServiceTypes) {
      window.AgentCtrl.setSelectedServiceTypes(svc);
    } else {
      const chk = (id, on) => { const el = document.getElementById(id); if (el) el.checked = on; };
      chk('target-security', svc.includes('Security'));
      chk('target-housekeeping', svc.includes('Housekeeping'));
      chk('target-pantry', svc.includes('Pantry Boy'));
      chk('target-auto', svc.includes('All relevant requirements'));
    }
    const autoExcel = document.getElementById('auto-download-excel');
    if (autoExcel) autoExcel.checked = state.autoExcel;
  }

  /** Reflect stored values back into the controls. */
  function syncUI() {
    const v = (id, val) => { const el = document.getElementById(id); if (el && el.value !== String(val)) el.value = val; };
    const c = (id, on) => { const el = document.getElementById(id); if (el) el.checked = !!on; };
    const t = (id, txt) => { const el = document.getElementById(id); if (el) el.textContent = txt; };

    v('sm-default-count', state.defaultCount); t('sm-default-count-val', state.defaultCount);
    v('sm-max-run', state.maxPerRun);          t('sm-max-run-val', state.maxPerRun);
    c('sm-warn-large', state.warnLarge);
    v('sm-default-city', state.defaultCity);
    c('sm-req-website', state.reqWebsite);
    c('sm-req-email', state.reqEmail);
    c('sm-req-phone', state.reqPhone);
    c('sm-auto-excel', state.autoExcel);
    c('sm-skip-dupes', state.skipDupes);
    v('sm-depth', state.depth);
    v('sm-default-service', state.defaultService);
    c('sm-cache-enabled', state.cacheEnabled);
    v('sm-cache-days', state.cacheDays); t('sm-cache-days-val', state.cacheDays);

    // Live usage figures
    try {
      const u = window.getApifyUsageTotal?.() || { used: 0, limit: 0 };
      t('usage-credits', u.used.toLocaleString('en-IN'));
      t('usage-remaining', Math.max(0, u.limit - u.used).toLocaleString('en-IN'));
      const leads = JSON.parse(localStorage.getItem('allLeads') || '[]');
      t('usage-leads', leads.length.toLocaleString('en-IN'));
      t('usage-runs', localStorage.getItem('skylark_run_count') || '0');
    } catch (_) {}
  }

  window.AppSettings = {
    get: (k) => (k ? state[k] : { ...state }),
    set,
    save() { persist(); apply(); window.showToast?.('success', 'Settings saved', 'Your preferences are active.'); },
    reset() {
      state = { ...DEFAULTS }; persist(); apply(); syncUI();
      window.showToast?.('info', 'Settings reset', 'Back to recommended defaults.');
    },
    // Consumed by the scraper / chat
    requiredFields: () => ({ website: state.reqWebsite, email: state.reqEmail, phone: state.reqPhone }),
    rounds: () => Math.max(1, Math.min(3, state.depth)),
    /**
     * The single count policy: no number given → exactly the stored default
     * (20); a number given → clamped into 20…100. Callers pass whatever the
     * user typed and get a safe, in-range target back.
     */
    clampCount(n) {
      const ceiling = Math.max(MIN_LEADS, Math.min(MAX_LEADS, state.maxPerRun));
      const parsed = parseInt(n, 10);
      const want = Number.isFinite(parsed) && parsed > 0 ? parsed : state.defaultCount;
      return Math.max(MIN_LEADS, Math.min(ceiling, want));
    },
    defaultCount: () => Math.max(MIN_LEADS, Math.min(MAX_LEADS, state.defaultCount)),
    limits: () => ({ min: MIN_LEADS, max: MAX_LEADS })
  };

  function boot() { apply(); syncUI(); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
  document.addEventListener('settingsOpened', syncUI);
  const ov = () => document.getElementById('settings-overlay');
  const bind = () => {
    const o = ov();
    if (!o) return;
    new MutationObserver(() => { if (o.classList.contains('open')) syncUI(); })
      .observe(o, { attributes: true, attributeFilter: ['class'] });
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bind); else bind();
})();
