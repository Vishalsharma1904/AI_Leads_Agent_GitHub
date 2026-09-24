/**
 * ============================================================
 *  SELF-HEALING GUARD v1.0
 *  Catches small runtime errors and repairs them automatically
 *  instead of letting the UI break.
 *
 *  Handles:
 *   - Missing global functions called from inline onclick=""
 *   - Null-element access in known UI helpers
 *   - Broken theme / accent / sound state in localStorage
 *   - Stuck "running" flags on the agent pipeline
 *   - Orphaned modal backdrops blocking clicks
 *   - Corrupt localStorage JSON
 * ============================================================
 */
'use strict';

(function SelfHeal() {

  const log = (...a) => console.info('%c[SelfHeal]', 'color:#7C6AF7;font-weight:700', ...a);
  const seen = new Map();      // message -> count (throttle repeats)
  let repairCount = 0;

  // ── 1. Safe no-op shims for inline handlers that may not exist ──
  // Prevents "X is not defined" from breaking a whole click.
  const EXPECTED_GLOBALS = [
    'showView','applyFilters','clearFilters','exportCSV','exportExcel',
    'toggleSelectAll','sortTable','closeModal','closeLeadModal',
    'saveSettings','clearAllData','toggleApiKey','toggleGroqKey',
    'saveCustomKeys','resetAllKeyUsage','pushSelectedToSheets',
    'handleFileUpload','handleExcelImport','processExcelImport',
    'exportToExcel','exportToCSV','saveEmailTemplate','startEmailAutomation',
    'updateEmailPreview','toggleCcBccFields','formatEmailText','formatEmailLink',
    'handleEmailAttachments','handleBodyImage','handleSignatureImage',
    'toggleFormattingBar','resizeSelectedImage','removeSelectedImage',
    'saveWhatsappTemplate','startWhatsappBatch','processWhatsappQueueNext',
    'stopWhatsappQueue','openWhatsappWeb','saveEmailWebhook','switchSavedEmail',
    'removeSavedEmail','exportCandidatesCSV','exportCandidatesExcel',
    'clearAllCandidates','handleCandidateChatSend','sendQuickChat',
    'startVoiceInput','stopChatGeneration','closeMacUploadModal',
    'handleMacFileSelect','closeMacDialog','updateServiceCard',
    'handleLocationKeydown','selectAllIndustries','clearAllIndustries',
    'selectTopIndustries','updateBatchInfo','startAgentPipeline','clearLog',
    // Legacy overlays/buttons remain safe when their optional controller is
    // not loaded in a reduced build. The shim prevents an inline click from
    // breaking the rest of the page and surfaces a visible info toast.
    'clavisConfirmAnswer','toggleClavisVision','toggleClavisPcControlHelp',
    'toggleJarvisDevMode','generateJarvisScript','copyJarvisScript',
    'closeJarvisMemoryPanel','addManualJarvisFact'
  ];

  function installShims() {
    let added = 0;
    EXPECTED_GLOBALS.forEach(name => {
      if (typeof window[name] !== 'function') {
        window[name] = function shim() {
          console.warn(`[SelfHeal] "${name}()" was called but is not implemented yet.`);
          if (typeof window.showToast === 'function') {
            window.showToast('info', 'Not Available',
              `That action isn't wired up yet. Nothing was broken.`);
          }
        };
        added++;
      }
    });
    if (added) log(`installed ${added} safe shims for missing handlers`);
  }

  // ── 2. Repair corrupt localStorage values ──────────────────
  function repairStorage() {
    const jsonKeys = ['allLeads','skylark_user_profile','skylark_user',
                      'skylark_saved_emails','jarvis_openrouter_keys','jarvis_free_models'];
    jsonKeys.forEach(k => {
      const raw = localStorage.getItem(k);
      if (raw == null) return;
      try { JSON.parse(raw); }
      catch {
        log(`corrupt JSON in "${k}" → resetting`);
        localStorage.removeItem(k);
        repairCount++;
      }
    });

    // Theme must be a known value
    const theme = localStorage.getItem('skylark-theme');
    if (theme && !['dark','light'].includes(theme)) {
      localStorage.setItem('skylark-theme', 'dark');
      document.documentElement.setAttribute('data-theme', 'dark');
      log('invalid theme value → reset to dark');
      repairCount++;
    }

    // Accent must be a known palette
    const ACCENTS = ['purple','blue','emerald','rose','amber','cyan','crimson','graphite'];
    const accent = localStorage.getItem('lx-accent');
    if (accent && !ACCENTS.includes(accent)) {
      localStorage.setItem('lx-accent', 'purple');
      document.documentElement.setAttribute('data-accent', 'purple');
      log('invalid accent → reset to purple');
      repairCount++;
    }

    // Sound theme must be known
    const SOUNDS = ['ambient','crystal','minimal','off'];
    const st = localStorage.getItem('lx_sound_theme');
    if (st && !SOUNDS.includes(st)) {
      localStorage.setItem('lx_sound_theme', 'ambient');
      repairCount++;
    }

    // Volume must be 0..1
    const vol = parseFloat(localStorage.getItem('lx_sound_volume'));
    if (localStorage.getItem('lx_sound_volume') != null && (!Number.isFinite(vol) || vol < 0 || vol > 1)) {
      localStorage.setItem('lx_sound_volume', '0.6');
      repairCount++;
    }
  }

  // ── 3. Ensure theme + accent attributes are always present ──
  function repairThemeAttrs() {
    const html = document.documentElement;
    if (!html.getAttribute('data-theme')) {
      html.setAttribute('data-theme', localStorage.getItem('skylark-theme') || 'dark');
      repairCount++;
    }
    if (!html.getAttribute('data-accent')) {
      html.setAttribute('data-accent', localStorage.getItem('lx-accent') || 'purple');
      repairCount++;
    }
  }

  // ── 4. Clear orphaned overlays that block the whole UI ──────
  function repairStuckOverlays() {
    // A visible backdrop with no visible dialog = click trap
    const traps = [
      { backdrop: '#cmd-palette-backdrop', panel: '#cmd-palette-container' },
      { backdrop: '#snapshot-modal',       panel: '#snapshot-modal-list' }
    ];
    traps.forEach(({ backdrop, panel }) => {
      const b = document.querySelector(backdrop);
      const p = document.querySelector(panel);
      if (!b) return;
      const bVisible = getComputedStyle(b).display !== 'none' && parseFloat(getComputedStyle(b).opacity) > 0.05;
      const pVisible = p && getComputedStyle(p).display !== 'none';
      if (bVisible && !pVisible) {
        b.style.display = 'none';
        b.style.opacity = '0';
        log(`cleared stuck overlay ${backdrop}`);
        repairCount++;
      }
    });

    // Settings overlay left in 'closing' state
    const so = document.getElementById('settings-overlay');
    if (so && so.classList.contains('closing') && !so.classList.contains('open')) {
      so.classList.remove('closing');
    }
  }

  // ── 5. Unstick the agent pipeline if it crashed mid-run ─────
  function repairPipelineFlag() {
    const btn = document.getElementById('generate-btn');
    const badge = document.getElementById('pipeline-badge');
    if (!window.AgentCtrl) return;

    const engineBusy = window.RealScraper?.isRunning?.() === true;
    if (window.AgentCtrl.isRunning && !engineBusy) {
      window.AgentCtrl.isRunning = false;
      window.AgentCtrl.targetCount = null;
      if (typeof window.AgentCtrl.updateBtnState === 'function') {
        window.AgentCtrl.updateBtnState(false);
      }
      if (badge) { badge.className = 'progress-status-badge idle'; badge.textContent = 'Idle'; }
      log('agent pipeline flag was stuck → reset to idle');
      repairCount++;
    }
  }

  // ── 6. Global error interception ────────────────────────────
  function shouldThrottle(msg) {
    const n = (seen.get(msg) || 0) + 1;
    seen.set(msg, n);
    return n > 3;   // stop reacting after 3 identical errors
  }

  function handle(msg, source) {
    if (!msg) return;
    const text = String(msg);
    if (shouldThrottle(text)) return;

    log(`caught: ${text}`);

    // "X is not defined" / "X is not a function" → install a shim on the fly
    const undef = text.match(/(\w+) is not defined/) || text.match(/(\w+) is not a function/);
    if (undef) {
      const name = undef[1];
      if (typeof window[name] !== 'function') {
        window[name] = function autoShim() {
          console.warn(`[SelfHeal] auto-shimmed "${name}()"`);
        };
        log(`auto-shimmed missing function "${name}"`);
        repairCount++;
      }
    }

    // Null property access → run the general repair sweep
    if (/of null|of undefined|Cannot read propert/.test(text)) {
      runRepairs('null-access');
    }

    // Storage quota → trim the leads cache
    if (/quota|QuotaExceeded/i.test(text)) {
      try {
        const leads = JSON.parse(localStorage.getItem('allLeads') || '[]');
        localStorage.setItem('allLeads', JSON.stringify(leads.slice(0, 500)));
        log('storage quota hit → trimmed cached leads to 500');
        repairCount++;
      } catch { localStorage.removeItem('allLeads'); }
    }
  }

  window.addEventListener('error', (e) => {
    handle(e.message || e.error?.message, e.filename);
  });
  window.addEventListener('unhandledrejection', (e) => {
    handle(e.reason?.message || e.reason);
  });

  // ── Repair sweep ───────────────────────────────────────────
  function runRepairs(reason) {
    try {
      repairStorage();
      repairThemeAttrs();
      repairStuckOverlays();
      repairPipelineFlag();
    } catch (err) {
      console.warn('[SelfHeal] repair sweep failed:', err);
    }
  }

  // ── Boot ───────────────────────────────────────────────────
  function boot() {
    repairStorage();
    repairThemeAttrs();
    installShims();
    log('active — auto-repairing minor runtime issues');

    // Periodic light sweep (cheap: only DOM reads + flag checks)
    setInterval(() => runRepairs('interval'), 8000);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }

  // Expose for manual use / debugging
  window.SelfHeal = {
    run: () => { runRepairs('manual'); return repairCount; },
    stats: () => ({ repairs: repairCount, errors: [...seen.entries()] })
  };
})();
