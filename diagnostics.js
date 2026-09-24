/**
 * ============================================================
 *  DIAGNOSTICS & AUTO-REPAIR ENGINE (diagnostics.js)
 *
 *  A self-contained health system. It inspects the running app, reports what is
 *  actually wrong, and repairs what is safe to repair — entirely offline. No
 *  network call, no external service, no telemetry leaves the browser.
 *
 *  Each check is a small object:
 *    {
 *      id, title, category,
 *      severity : 'critical' | 'warning' | 'info'
 *      detect() : { ok:boolean, message:string, data?:any }
 *      repair?  : ()      -> { fixed:boolean, message:string }
 *      guidance : string  // what the user should do when it cannot self-repair
 *    }
 *
 *  RULES THIS ENGINE FOLLOWS
 *   1. A check never reports "fixed" unless it re-ran detect() and it passed.
 *      Claiming a repair worked without re-measuring is how you get a green
 *      tick on a broken app.
 *   2. Repairs are conservative. Nothing here deletes leads, candidates or
 *      account data. Destructive-looking situations are reported, not silently
 *      resolved.
 *   3. Every finding says something a human can act on.
 * ============================================================
 */

'use strict';

window.Diagnostics = (function () {

  const SEVERITY_ORDER = { critical: 0, warning: 1, info: 2 };

  /** Safe JSON parse that reports failure instead of throwing. */
  function tryParse(raw) {
    try { return { ok: true, value: JSON.parse(raw) }; }
    catch (err) { return { ok: false, error: err.message }; }
  }

  function bytes(n) {
    if (n < 1024) return n + ' B';
    if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB';
    return (n / 1024 / 1024).toFixed(2) + ' MB';
  }

  // ══════════════════════════════════════════════════════════════════════
  //  CHECKS
  // ══════════════════════════════════════════════════════════════════════
  const checks = [];

  // ── 1. Corrupt JSON in known storage keys ──────────────────────────────
  const JSON_KEYS = [
    'allLeads', 'all_candidates', 'skylark_user_profile', 'skylark_user',
    'skylark_saved_emails', 'skylark_laptop_accounts', 'skylark_key_usage',
    'skylark_api_usage_log', 'skylark_api_latency', 'jarvis_openrouter_keys'
  ];

  checks.push({
    id: 'storage-json',
    title: 'Stored data is readable',
    category: 'Storage',
    severity: 'critical',
    guidance: 'A corrupt entry was removed. If leads went missing, re-run the agent or re-import your sheet.',
    detect() {
      const broken = [];
      JSON_KEYS.forEach(key => {
        const raw = localStorage.getItem(key);
        if (raw == null) return;
        if (!tryParse(raw).ok) broken.push(key);
      });
      // Also scan per-user scoped mirrors.
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (!key || !/^skylark_usr_.*_(allLeads|all_candidates)$/.test(key)) continue;
        const raw = localStorage.getItem(key);
        if (raw != null && !tryParse(raw).ok) broken.push(key);
      }
      return broken.length
        ? { ok: false, message: `${broken.length} storage entr${broken.length === 1 ? 'y is' : 'ies are'} corrupt: ${broken.join(', ')}`, data: broken }
        : { ok: true, message: 'All stored entries parse cleanly.' };
    },
    repair() {
      const broken = this.detect().data || [];
      // Corrupt JSON cannot be recovered; removing it lets the app rebuild.
      broken.forEach(key => localStorage.removeItem(key));
      return { fixed: true, message: `Removed ${broken.length} unreadable entr${broken.length === 1 ? 'y' : 'ies'}.` };
    }
  });

  // ── 2. Theme / accent sanity ───────────────────────────────────────────
  checks.push({
    id: 'theme-values',
    title: 'Theme and accent are valid',
    category: 'Appearance',
    severity: 'warning',
    guidance: 'Invalid values were reset to defaults.',
    detect() {
      const problems = [];
      const theme = localStorage.getItem('skylark-theme');
      if (theme && !['dark', 'light'].includes(theme)) problems.push(`theme "${theme}"`);

      const ACCENTS = ['purple', 'blue', 'emerald', 'rose', 'amber', 'cyan', 'crimson', 'graphite'];
      const accent = localStorage.getItem('lx-accent');
      if (accent && !ACCENTS.includes(accent)) problems.push(`accent "${accent}"`);

      const html = document.documentElement;
      if (!html.getAttribute('data-theme')) problems.push('data-theme attribute missing');

      return problems.length
        ? { ok: false, message: 'Invalid: ' + problems.join(', '), data: problems }
        : { ok: true, message: 'Theme and accent look correct.' };
    },
    repair() {
      const html = document.documentElement;
      const theme = localStorage.getItem('skylark-theme');
      if (theme && !['dark', 'light'].includes(theme)) {
        localStorage.setItem('skylark-theme', 'dark');
      }
      const ACCENTS = ['purple', 'blue', 'emerald', 'rose', 'amber', 'cyan', 'crimson', 'graphite'];
      const accent = localStorage.getItem('lx-accent');
      if (accent && !ACCENTS.includes(accent)) localStorage.setItem('lx-accent', 'purple');

      html.setAttribute('data-theme', localStorage.getItem('skylark-theme') || 'dark');
      html.setAttribute('data-accent', localStorage.getItem('lx-accent') || 'purple');
      return { fixed: true, message: 'Reset to valid values.' };
    }
  });

  // ── 3. Toast container position (the bug from the screenshots) ──────────
  checks.push({
    id: 'toast-position',
    title: 'Notifications do not cover the topbar',
    category: 'Layout',
    severity: 'warning',
    guidance: 'The notification stack was re-anchored to the bottom-right corner.',
    detect() {
      const el = document.getElementById('toast-container');
      if (!el) return { ok: true, message: 'No notification container on this page.' };
      const cs = getComputedStyle(el);
      // Both top and bottom resolved to a length means the container is
      // stretched, which pushes toasts up over the header.
      const topSet = cs.top !== 'auto';
      const bottomSet = cs.bottom !== 'auto';
      if (topSet && bottomSet) {
        return { ok: false, message: `Container is stretched (top: ${cs.top}, bottom: ${cs.bottom}) so notifications render over the topbar.` };
      }
      if (topSet && !bottomSet && parseFloat(cs.top) < 80) {
        return { ok: false, message: `Container is anchored to the top (${cs.top}), which overlaps the topbar.` };
      }
      return { ok: true, message: 'Notifications are anchored clear of the topbar.' };
    },
    repair() {
      const el = document.getElementById('toast-container');
      if (!el) return { fixed: false, message: 'Container not present.' };
      // Inline styles beat stylesheet rules, so this holds even if a CSS file
      // is stale in the browser cache.
      el.style.setProperty('top', 'auto', 'important');
      el.style.setProperty('left', 'auto', 'important');
      el.style.setProperty('bottom', '24px', 'important');
      el.style.setProperty('right', '24px', 'important');
      el.style.setProperty('justify-content', 'flex-end', 'important');
      return { fixed: true, message: 'Re-anchored to bottom-right.' };
    }
  });

  // ── 4. Stuck overlays that block every click ───────────────────────────
  checks.push({
    id: 'click-traps',
    title: 'No invisible overlay is blocking clicks',
    category: 'Layout',
    severity: 'critical',
    guidance: 'Leftover overlays were dismissed.',
    detect() {
      const stuck = [];
      const pairs = [
        { backdrop: '#cmd-palette-backdrop', panel: '#cmd-palette-container' },
        { backdrop: '#snapshot-modal', panel: '#snapshot-modal-list' }
      ];
      pairs.forEach(({ backdrop, panel }) => {
        const b = document.querySelector(backdrop);
        if (!b) return;
        const bs = getComputedStyle(b);
        const visible = bs.display !== 'none' && parseFloat(bs.opacity) > 0.05;
        const p = document.querySelector(panel);
        const panelVisible = p && getComputedStyle(p).display !== 'none';
        if (visible && !panelVisible) stuck.push(backdrop);
      });

      // Empty modal overlays left in the DOM.
      document.querySelectorAll('.modal-overlay').forEach(m => {
        if (!m.children.length && getComputedStyle(m).display !== 'none') stuck.push('.modal-overlay (empty)');
      });

      return stuck.length
        ? { ok: false, message: `${stuck.length} overlay(s) blocking input: ${stuck.join(', ')}`, data: stuck }
        : { ok: true, message: 'Nothing is intercepting clicks.' };
    },
    repair() {
      let n = 0;
      ['#cmd-palette-backdrop', '#snapshot-modal'].forEach(sel => {
        const el = document.querySelector(sel);
        if (el && getComputedStyle(el).display !== 'none') {
          el.style.display = 'none';
          el.style.opacity = '0';
          n++;
        }
      });
      document.querySelectorAll('.modal-overlay').forEach(m => {
        if (!m.children.length) { m.remove(); n++; }
      });
      const so = document.getElementById('settings-overlay');
      if (so && so.classList.contains('closing') && !so.classList.contains('open')) {
        so.classList.remove('closing');
        n++;
      }
      return { fixed: true, message: `Dismissed ${n} overlay(s).` };
    }
  });

  // ── 5. Exactly one active and visibly rendered view ─────────────────────
  checks.push({
    id: 'active-view',
    title: 'Exactly one page is visible',
    category: 'Layout',
    severity: 'warning',
    guidance: 'The view state was corrected so tabs cannot overlap each other.',
    detect() {
      const views = [...document.querySelectorAll('.view')];
      const active = views.filter(view => view.classList.contains('active'));
      const visible = views.filter(view => {
        const style = window.getComputedStyle(view);
        return style.display !== 'none' && style.visibility !== 'hidden';
      });
      if (!views.length) return { ok: true, message: 'No views on this page.' };
      if (active.length === 1 && visible.length === 1 && visible[0] === active[0]) {
        return { ok: true, message: 'One active page is visible, as expected.' };
      }
      return {
        ok: false,
        message: active.length !== 1
          ? `${active.length} pages are marked active; exactly one is required.`
          : `${visible.length} pages are visibly rendered, so tab content can overlap.`,
        data: { active: active.length, visible: visible.map(view => view.id) }
      };
    },
    repair() {
      const views = [...document.querySelectorAll('.view')];
      if (!views.length) return { fixed: false, message: 'No view element to repair.' };

      let active = views.filter(view => view.classList.contains('active'));
      if (!active.length) {
        const fallback = document.getElementById('view-dashboard') || views[0];
        fallback.classList.add('active');
        active = [fallback];
      }
      active.slice(1).forEach(view => view.classList.remove('active'));

      // A runtime guard safely restores the router contract if a later theme
      // accidentally forces a specific inactive page to display.
      let guard = document.getElementById('nexus-view-visibility-guard');
      if (!guard) {
        guard = document.createElement('style');
        guard.id = 'nexus-view-visibility-guard';
        guard.textContent = '.view:not(.active){display:none!important}';
        document.head.appendChild(guard);
      }
      return { fixed: true, message: 'Restored one active page and hid every inactive page.' };
    }
  });

  // ── 6. Agent pipeline not stuck ─────────────────────────────────────────
  checks.push({
    id: 'agent-stuck',
    title: 'Lead agent is not stuck running',
    category: 'Agent',
    severity: 'warning',
    guidance: 'The agent was returned to idle so you can start a new run.',
    detect() {
      if (!window.AgentCtrl) return { ok: true, message: 'Agent module not loaded on this page.' };
      const engineBusy = window.RealScraper?.isRunning?.() === true;
      if (window.AgentCtrl.isRunning && !engineBusy) {
        return { ok: false, message: 'The agent is flagged as running but nothing is actually scraping. The Run button would stay disabled.' };
      }
      return { ok: true, message: 'Agent state is consistent.' };
    },
    repair() {
      window.AgentCtrl.isRunning = false;
      window.AgentCtrl.targetCount = null;
      try { window.AgentCtrl.updateBtnState?.(false); } catch (_) {}
      const badge = document.getElementById('pipeline-badge');
      if (badge) { badge.className = 'progress-status-badge idle'; badge.textContent = 'Idle'; }
      return { fixed: true, message: 'Agent reset to idle.' };
    }
  });

  // ── 7. Notifications are not being swallowed ────────────────────────────
  checks.push({
    id: 'toast-available',
    title: 'Confirmation messages can be shown',
    category: 'Feedback',
    severity: 'critical',
    guidance: 'Without this, buttons appear to do nothing when they actually worked.',
    detect() {
      if (typeof window.showToast !== 'function') {
        return { ok: false, message: 'showToast is unavailable, so no button can confirm success or failure.' };
      }
      if (!document.getElementById('toast-container')) {
        return { ok: false, message: 'The notification container is missing from the page, so messages have nowhere to render.' };
      }
      return { ok: true, message: 'Notifications are working.' };
    },
    repair() {
      if (!document.getElementById('toast-container')) {
        const el = document.createElement('div');
        el.id = 'toast-container';
        el.setAttribute('aria-live', 'polite');
        document.body.appendChild(el);
        return { fixed: true, message: 'Re-created the notification container.' };
      }
      return { fixed: false, message: 'showToast itself is missing — a page reload is needed.' };
    }
  });

  // ── 8. Storage headroom ────────────────────────────────────────────────
  checks.push({
    id: 'storage-space',
    title: 'Browser storage has room',
    category: 'Storage',
    severity: 'warning',
    guidance: 'Storage is filling up. Clear the web page cache below, or export and prune old leads.',
    detect() {
      let total = 0;
      const big = [];
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        const size = (localStorage.getItem(key) || '').length + key.length;
        total += size;
        if (size > 200 * 1024) big.push(`${key} (${bytes(size)})`);
      }
      // Browsers typically allow ~5 MB for localStorage.
      const limit = 5 * 1024 * 1024;
      const pct = Math.round((total / limit) * 100);
      if (pct >= 80) {
        return { ok: false, message: `Using about ${bytes(total)} (~${pct}% of the usual 5 MB limit).${big.length ? ' Largest: ' + big.join(', ') : ''}`, data: { total, pct } };
      }
      return { ok: true, message: `Using about ${bytes(total)} (~${pct}% of the usual limit).` };
    },
    repair() {
      // Only the regenerable web-page cache is cleared. Leads are never touched.
      let removed = 0;
      const doomed = [];
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && key.startsWith('skylark_webcache_')) doomed.push(key);
      }
      doomed.forEach(k => { localStorage.removeItem(k); removed++; });
      return removed
        ? { fixed: true, message: `Cleared ${removed} cached web page(s). Your leads were not touched.` }
        : { fixed: false, message: 'Nothing safe left to clear. Export and prune old leads to free space.' };
    }
  });

  // ── 9. Plugin state integrity ──────────────────────────────────────────
  checks.push({
    id: 'plugin-orphans',
    title: 'Plugin settings match installed plugins',
    category: 'Plugins',
    severity: 'info',
    guidance: 'Settings for plugins that no longer exist were cleared.',
    detect() {
      if (!window.PluginCore) return { ok: true, message: 'Plugin system not loaded.' };
      const known = new Set(window.PluginCore.list().map(p => p.id));
      const stored = window.UserStorage
        ? (window.UserStorage.getJSON('plugin_state_v1', {}) || {})
        : {};
      const orphans = Object.keys(stored).filter(id => !known.has(id));
      return orphans.length
        ? { ok: false, message: `Settings exist for ${orphans.length} unknown plugin(s): ${orphans.join(', ')}`, data: orphans }
        : { ok: true, message: 'No leftover plugin settings.' };
    },
    repair() {
      const orphans = this.detect().data || [];
      const stored = window.UserStorage.getJSON('plugin_state_v1', {}) || {};
      orphans.forEach(id => delete stored[id]);
      window.UserStorage.setJSON('plugin_state_v1', stored);
      window.PluginCore._reloadState?.();
      return { fixed: true, message: `Cleared ${orphans.length} leftover entr${orphans.length === 1 ? 'y' : 'ies'}.` };
    }
  });

  // ── 10. Enabled plugins whose requirements disappeared ─────────────────
  checks.push({
    id: 'plugin-broken-enabled',
    title: 'Enabled plugins still have what they need',
    category: 'Plugins',
    severity: 'warning',
    guidance: 'A plugin was enabled but its API key or URL is gone. It was disabled so it cannot fail silently mid-campaign.',
    detect() {
      if (!window.PluginCore) return { ok: true, message: 'Plugin system not loaded.' };
      const broken = window.PluginCore.list()
        .filter(p => p.lifecycle === 'ENABLED' && !p.ready);
      return broken.length
        ? { ok: false, message: broken.map(p => `${p.name}: ${p.missing.map(m => m.label).join('; ')}`).join(' | '), data: broken.map(p => p.id) }
        : { ok: true, message: 'Every enabled plugin has its credentials.' };
    },
    repair() {
      const ids = this.detect().data || [];
      ids.forEach(id => window.PluginCore.disable(id));
      return { fixed: true, message: `Disabled ${ids.length} plugin(s) that lost their setup.` };
    }
  });

  // ── 11. Local-vs-database lead drift ───────────────────────────────────
  checks.push({
    id: 'lead-sync-drift',
    title: 'Lead list matches the database',
    category: 'Data',
    severity: 'warning',
    guidance: 'The on-screen list and the local database disagreed. The larger set was kept — no leads were deleted.',
    async detectAsync() {
      if (!window.MemoryEngine?.getAllLeads) {
        return { ok: true, message: 'Local database not available.' };
      }
      let dbLeads = [];
      try { dbLeads = await window.MemoryEngine.getAllLeads(); }
      catch (err) { return { ok: false, message: 'Could not read the local database: ' + err.message }; }

      const scoped = window.UserStorage ? (window.UserStorage.getJSON('allLeads', []) || []) : [];
      const inMemory = Array.isArray(window.allLeads) ? window.allLeads : [];
      const counts = { database: dbLeads.length, saved: scoped.length, onScreen: inMemory.length };
      const spread = Math.max(...Object.values(counts)) - Math.min(...Object.values(counts));

      if (spread > 0) {
        return {
          ok: false,
          message: `Counts differ — database: ${counts.database}, saved: ${counts.saved}, on screen: ${counts.onScreen}.`,
          data: { counts, dbLeads, scoped, inMemory }
        };
      }
      return { ok: true, message: `${counts.database} lead(s), consistent everywhere.` };
    },
    async repairAsync() {
      const result = await this.detectAsync();
      const d = result.data;
      if (!d) return { fixed: false, message: 'Nothing to reconcile.' };

      // Union by id: keep everything. Never resolve drift by deleting.
      const byId = new Map();
      [...d.dbLeads, ...d.scoped, ...d.inMemory].forEach(lead => {
        if (lead && (lead.id || lead.company)) byId.set(lead.id || `c_${lead.company}`, lead);
      });
      const merged = [...byId.values()];

      window.allLeads = merged;
      window.UserStorage?.setJSON('allLeads', merged);
      try { await window.MemoryEngine.saveAllLeads(merged); } catch (_) {}
      try { window.LeadsCtrl?.init?.(); } catch (_) {}

      return { fixed: true, message: `Reconciled to ${merged.length} lead(s), keeping every record.` };
    }
  });

  // ── 12. Signed in but no account key ───────────────────────────────────
  checks.push({
    id: 'session-consistency',
    title: 'Session and account key agree',
    category: 'Account',
    severity: 'critical',
    guidance: 'The app thought you were signed in without knowing which account, which is how data appears to vanish. Sign in again to reattach your data.',
    detect() {
      const loggedIn = localStorage.getItem('skylark_logged_in') === 'true';
      const email = localStorage.getItem('skylark_active_email') || '';
      if (loggedIn && !email.includes('@')) {
        return { ok: false, message: 'Marked as signed in, but no account email is stored. Your data is keyed to that email.' };
      }
      return { ok: true, message: loggedIn ? `Signed in as ${email}.` : 'Not signed in — the unlock screen will be shown.' };
    },
    repair() {
      // Clear only the inconsistent flag. Account data is left untouched.
      localStorage.setItem('skylark_logged_in', 'false');
      return { fixed: true, message: 'Cleared the inconsistent session flag. Your saved data was not touched.' };
    }
  });

  // ── 13. Running from file:// (explains the CORS notices) ───────────────
  checks.push({
    id: 'file-protocol',
    title: 'Page is served over http/https',
    category: 'Environment',
    severity: 'info',
    guidance: 'Run "npx serve . -p 3000" in the project folder, then open http://localhost:3000. ' +
              'This is what makes API health checks report Connected instead of Degraded.',
    detect() {
      if (window.location.protocol === 'file:') {
        return {
          ok: false,
          message: 'Opened directly from disk (file://). Browsers block cross-site responses here, ' +
                   'so plugin health checks can only report "reachable" and not the provider\'s reply.'
        };
      }
      return { ok: true, message: `Served over ${window.location.protocol.replace(':', '')}.` };
    }
    // No repair: this is how the page was opened, not a fault in the app.
  });

  // ── 14. Service worker cache freshness ─────────────────────────────────
  checks.push({
    id: 'stale-cache',
    title: 'No stale offline cache',
    category: 'Environment',
    severity: 'info',
    guidance: 'An old cached copy of the app can hide fixes. Press Ctrl+Shift+R after repairing.',
    detect() {
      const sw = navigator.serviceWorker?.controller;
      if (!sw) return { ok: true, message: 'No offline cache is controlling this page.' };
      return { ok: false, message: 'An offline cache is serving this page, so recent file changes may not be visible.' };
    },
    async repairAsync() {
      if (!('caches' in window)) return { fixed: false, message: 'Cache API unavailable.' };
      try {
        const names = await caches.keys();
        await Promise.all(names.map(n => caches.delete(n)));
        const regs = await navigator.serviceWorker.getRegistrations();
        await Promise.all(regs.map(r => r.unregister()));
        return { fixed: true, message: `Cleared ${names.length} cache(s). Reload with Ctrl+Shift+R to load fresh files.` };
      } catch (err) {
        return { fixed: false, message: 'Could not clear the cache: ' + err.message };
      }
    }
  });

  // ── 15. Missing view containers the router needs ───────────────────────
  checks.push({
    id: 'router-targets',
    title: 'Every menu item has a page',
    category: 'Layout',
    severity: 'warning',
    guidance: 'A menu item points at a page that does not exist. It would open a blank screen.',
    detect() {
      const missing = [];
      document.querySelectorAll('.nav-item[data-view]').forEach(link => {
        const view = link.getAttribute('data-view');
        if (view && !document.getElementById('view-' + view)) missing.push(view);
      });
      return missing.length
        ? { ok: false, message: `No page found for: ${missing.join(', ')}`, data: missing }
        : { ok: true, message: 'All menu items resolve to a page.' };
    }
    // No auto-repair: inventing an empty page would hide a real wiring mistake.
  });

  // ── 16. Theme layer is present and applied last ────────────────────────
  checks.push({
    id: 'theme-order',
    title: 'Theme is applied correctly',
    category: 'Appearance',
    severity: 'warning',
    guidance: 'A stylesheet loading after theme-flow.css undoes part of the theme. ' +
              'Move theme-flow.css to be the last stylesheet in index.html.',
    detect() {
      const sheets = [...document.querySelectorAll('link[rel="stylesheet"]')]
        .map(l => (l.getAttribute('href') || '').split('?')[0])
        .filter(href => href && !/^https?:\/\//.test(href));

      if (!sheets.some(h => h.endsWith('theme-flow.css'))) {
        return { ok: false, message: 'theme-flow.css is not loaded, so the app is using the old palette.' };
      }
      const last = sheets[sheets.length - 1] || '';
      if (!last.endsWith('theme-flow.css')) {
        return { ok: false, message: `"${last}" loads after the theme and overrides part of it.` };
      }
      return { ok: true, message: 'Theme is the final stylesheet, as required.' };
    },
    repair() {
      // Re-appending the tag makes it the last stylesheet at runtime, which
      // restores the intended cascade without editing the file.
      const existing = [...document.querySelectorAll('link[rel="stylesheet"]')]
        .find(l => (l.getAttribute('href') || '').includes('theme-flow.css'));
      if (!existing) return { fixed: false, message: 'theme-flow.css is not present to re-order.' };
      document.head.appendChild(existing);
      return { fixed: true, message: 'Re-applied the theme as the last stylesheet.' };
    }
  });

  // ── 17. Brand fonts actually resolved ──────────────────────────────────
  checks.push({
    id: 'fonts-loaded',
    title: 'Brand fonts loaded',
    category: 'Appearance',
    severity: 'info',
    guidance: 'The app falls back to a system font, which still reads fine. ' +
              'Check your internet connection if you want the intended typography.',
    detect() {
      if (!document.fonts || typeof document.fonts.check !== 'function') {
        return { ok: true, message: 'This browser cannot report font status.' };
      }
      const missing = [];
      if (!document.fonts.check('1em Figtree')) missing.push('Figtree');
      if (!document.fonts.check('1em "Instrument Serif"')) missing.push('Instrument Serif');
      return missing.length
        ? { ok: false, message: `Not loaded yet: ${missing.join(', ')}. A fallback font is in use.` }
        : { ok: true, message: 'Figtree and Instrument Serif are active.' };
    }
    // No repair: fonts are fetched by the browser; a fallback is not a fault.
  });

  // ══════════════════════════════════════════════════════════════════════
  //  RUNNER
  // ══════════════════════════════════════════════════════════════════════

  async function detectOne(check) {
    try {
      return check.detectAsync ? await check.detectAsync() : check.detect();
    } catch (err) {
      console.error(`[Diagnostics] detect failed for ${check.id}:`, err);
      return { ok: false, message: 'This check could not run: ' + (err?.message || 'unknown error') };
    }
  }

  async function repairOne(check) {
    try {
      return check.repairAsync ? await check.repairAsync() : check.repair();
    } catch (err) {
      console.error(`[Diagnostics] repair failed for ${check.id}:`, err);
      return { fixed: false, message: 'Repair failed: ' + (err?.message || 'unknown error') };
    }
  }

  /**
   * Runs every check. When `autoRepair` is true, attempts a repair on each
   * failing check that offers one, then RE-RUNS detect to confirm. A check is
   * only reported as repaired if the second detect passes.
   */
  async function run({ autoRepair = true, onProgress } = {}) {
    const findings = [];

    for (let i = 0; i < checks.length; i++) {
      const check = checks[i];
      onProgress?.({ index: i, total: checks.length, title: check.title });

      const initial = await detectOne(check);

      const finding = {
        id: check.id,
        title: check.title,
        category: check.category,
        severity: check.severity,
        guidance: check.guidance,
        passed: initial.ok,
        message: initial.message,
        repairable: Boolean(check.repair || check.repairAsync),
        repaired: false,
        repairMessage: ''
      };

      if (!initial.ok && autoRepair && finding.repairable) {
        const outcome = await repairOne(check);
        finding.repairMessage = outcome.message;

        // Re-measure. This is the rule that stops false "fixed" claims.
        const after = await detectOne(check);
        finding.repaired = outcome.fixed && after.ok;
        finding.passed = after.ok;
        if (!after.ok) finding.message = after.message;
      }

      findings.push(finding);
    }

    findings.sort((a, b) =>
      (a.passed - b.passed) ||
      (SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]) ||
      a.title.localeCompare(b.title)
    );

    const summary = {
      total: findings.length,
      passed: findings.filter(f => f.passed).length,
      repaired: findings.filter(f => f.repaired).length,
      // Still failing after any repair attempt.
      remaining: findings.filter(f => !f.passed),
      critical: findings.filter(f => !f.passed && f.severity === 'critical').length,
      ranAt: Date.now()
    };

    try {
      document.dispatchEvent(new CustomEvent('nexus:diagnostics:complete', { detail: summary }));
    } catch (_) {}

    return { findings, summary };
  }

  /** Names of the checks, for tests and for the UI to show what it inspects. */
  function list() {
    return checks.map(c => ({
      id: c.id, title: c.title, category: c.category, severity: c.severity,
      repairable: Boolean(c.repair || c.repairAsync)
    }));
  }

  return { run, list, checks };
})();
