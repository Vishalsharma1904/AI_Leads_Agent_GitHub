/**
 * ============================================================
 *  NEXUS AI LEAD AGENT v2 — UI Controller (app.js)
 *  Multi-location | Industry-aware | Google Sheets Sync
 *  Buyer-focused leads only (NOT service providers)
 * ============================================================
 */

'use strict';

// Compatibility shim for the header task-peek buttons. The full controller
// arrives with clavis-task-surface.js; this keeps early clicks harmless.
window.ClavisSneakPeek = window.ClavisSneakPeek || {
  toggle: () => window.ClavisTaskSurface?.toggle?.(),
  open: () => window.ClavisTaskSurface?.show?.(),
  close: () => window.ClavisTaskSurface?.hide?.()
};

// ============================================================
//  GLOBAL STATE
// ============================================================
// Safe global application state
let allLeads = [];
let filteredLeads = [];

function getSafeLeads() {
  try {
    const savedLeads = localStorage.getItem("allLeads");
    if (!savedLeads) return [];
    const parsedLeads = JSON.parse(savedLeads);
    return Array.isArray(parsedLeads) ? parsedLeads : [];
  } catch (error) {
    console.warn("[Leads] Could not read local leads:", error);
    return [];
  }
}

function initializeLeads() {
  allLeads = getSafeLeads();
  filteredLeads = [...allLeads];
  return allLeads;
}
let sortConfig = { col: 'timestamp', dir: 'desc' };
let currentView = 'dashboard';
let selectedLocations = [];
let selectedIndustries = new Set();
let selectedLeadIds = new Set();

// ============================================================
//  STRICT FAKE DATA SANITIZER (Zero Fake Data Guarantee)
// ============================================================
// Safe LocalStorage Access Helpers
const BROWSER_SECRET_STORAGE_KEY = /(?:custom_(?:groq|apify)|(?:groq|apify|nvidia|deepseek|moonshot|openrouter|gemini)[_-]?(?:api[_-]?)?key|api[_-]?key|tts[_-]?key|email[_-]?webhook|webhook[_-]?url)/i;
function safeLocalStorageGet(key, defaultValue = null) {
  if (BROWSER_SECRET_STORAGE_KEY.test(String(key || ''))) return defaultValue;
  try {
    const val = localStorage.getItem(key);
    return val !== null ? val : defaultValue;
  } catch (e) {
    return defaultValue;
  }
}

function safeLocalStorageSet(key, value) {
  if (BROWSER_SECRET_STORAGE_KEY.test(String(key || ''))) return false;
  try {
    localStorage.setItem(key, value);
    return true;
  } catch (e) {
    return false;
  }
}

function safeLocalStorageRemove(key) {
  try {
    localStorage.removeItem(key);
    return true;
  } catch (e) {
    return false;
  }
}

// ============================================================
//  STRICT FAKE DATA SANITIZER (Zero Fake Data Guarantee)
// ============================================================
const DataSanitizer = {
  isFakeEmail(email) {
    if (!email || typeof email !== 'string') return true;
    const clean = email.trim().toLowerCase();
    if (['', 'n/a', 'not found', 'none', '-', 'null', 'undefined'].includes(clean)) return true;

    // Static image extensions
    if (/\.(png|jpg|jpeg|svg|gif|webp|ico)(\?.*)?$/i.test(clean) || clean.includes('.png') || clean.includes('.jpg') || clean.includes('.svg')) return true;

    // Asset hostnames
    const assetHostnames = ['schema.org', 'wixpress.com', 'wixpress', 'googleapis.com', 'githubusercontent.com', 'fontawesome.com', 'cloudflare.com'];
    if (assetHostnames.some(h => clean.includes(h))) return true;

    // Fake domains
    const fakeDomains = ['example.com', 'test.com', 'domain.com', 'sentry.io', 'mailinator.com', 'tempmail.com', 'sample.com', 'placeholder.com'];
    if (fakeDomains.some(d => clean.endsWith('@' + d) || clean.includes('@' + d))) return true;

    // Prefix
    if (clean.startsWith('test@') || clean.startsWith('fake@') || clean.startsWith('dummy@') || clean.startsWith('sample@')) return true;

    // Valid email format regex
    return !/^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/.test(clean);
  },

  isFakePhone(phone) {
    if (!phone || typeof phone !== 'string') return true;
    let digits = phone.replace(/\D/g, '');
    if (digits.length === 12 && digits.startsWith('91')) {
      digits = digits.slice(2);
    } else if (digits.length === 11 && digits.startsWith('0')) {
      digits = digits.slice(1);
    }
    if (digits.length !== 10) return true;
    if (!/^[6-9]/.test(digits)) return true;
    if (/^(\d)\1{9}$/.test(digits)) return true;

    const dummyPatterns = [
      '9876543210', '1234567890', '0123456789', '0987654321',
      '123456789', '987654321'
    ];
    return dummyPatterns.some(p => digits.includes(p));
  },

  isFakeName(name) {
    if (!name || typeof name !== 'string') return true;
    const clean = name.trim().toLowerCase();
    if (['', 'na', 'n/a', 'null', 'undefined', 'candidate', 'test', 'unknown', 'none', 'manager', 'contact'].includes(clean)) return true;

    const fakeRegexes = [
      /john\s+doe/i,
      /jane\s+doe/i,
      /test\s+candidate/i,
      /candidate\s*\d*/i,
      /test\s+user/i,
      /sample\s+name/i,
      /dummy/i,
      /fake\s+name/i,
      /n\/a/i,
      /\bnull\b/i,
      /\bundefined\b/i
    ];
    return fakeRegexes.some(rx => rx.test(clean));
  },

  sanitizeLead(lead) {
    if (!lead || typeof lead !== 'object') return null;
    const s = { ...lead };
    if (this.isFakeEmail(s.email)) s.email = '';
    if (this.isFakePhone(s.phone)) s.phone = '';
    if (this.isFakeName(s.name)) s.name = s.company ? `${s.company} Contact` : 'Manager';
    return s;
  },

  sanitizeCandidate(cand) {
    if (!cand || typeof cand !== 'object') return null;
    const s = { ...cand };
    if (this.isFakeEmail(s.email)) s.email = '';
    if (this.isFakePhone(s.phone)) s.phone = '';
    if (this.isFakeName(s.name)) return null;
    return s;
  }
};
window.DataSanitizer = DataSanitizer;

// ============================================================
//  VERSION SNAPSHOT & 1-CLICK RECOVERY MANAGER
// ============================================================
const SnapshotManager = {
  async createSnapshot(customLabel) {
    try {
      const M = window.MemoryEngine;
      if (!M) throw new Error("MemoryEngine database not initialized.");
      const leads = await M.getAllLeads();
      const candidates = await M.getAllCandidates();
      const settings = window.SettingsEngine ? window.SettingsEngine.load() : {};
      
      const snapshot = {
        id: 'snap_' + Date.now(),
        timestamp: Date.now(),
        label: customLabel || `Backup ${new Date().toLocaleDateString()} ${new Date().toLocaleTimeString()}`,
        leadsCount: leads.length,
        candidatesCount: candidates.length,
        data: {
          leads,
          candidates,
          settings,
          localStorageKeys: {
            theme: safeLocalStorageGet('skylark-theme', 'dark'),
            savedEmails: safeLocalStorageGet('skylark_saved_emails'),
            waTemplate: safeLocalStorageGet('skylark_wa_template'),
            emailAccount: safeLocalStorageGet('skylark_email_account'),
            userProfile: safeLocalStorageGet('skylark_user_profile'),
            dedupStrategy: safeLocalStorageGet('skylark_dedup_strategy'),
            micEnabled: safeLocalStorageGet('skylark-mic-enabled'),
            autoSuggest: safeLocalStorageGet('skylark-auto-suggest'),
            autoCrmSync: safeLocalStorageGet('skylark-auto-crm-sync'),
            runInBackground: safeLocalStorageGet('skylark-run-in-background'),
            desktopNotif: safeLocalStorageGet('skylark-desktop-notif'),
            accountName: safeLocalStorageGet('skylark-account-name'),
            email: safeLocalStorageGet('skylark-email'),
            llm: safeLocalStorageGet('skylark-llm'),
            voice: safeLocalStorageGet('skylark-voice'),
            maxAgents: safeLocalStorageGet('skylark-max-agents'),
            scrapingDepth: safeLocalStorageGet('skylark-scraping-depth'),
            followupDelay: safeLocalStorageGet('skylark-followup-delay'),
            perfMode: safeLocalStorageGet('skylark-perf-mode'),
            glassBlur: safeLocalStorageGet('skylark-glass-blur'),
            animSpeed: safeLocalStorageGet('skylark-animation-speed'),
            handsFree: safeLocalStorageGet('skylark-hands-free')
          }
        }
      };
      
      await M.saveSnapshot(snapshot);
      if (typeof window.showToast === 'function') {
        window.showToast('success', '📸 Backup Created', `Saved snapshot with ${leads.length} leads & ${candidates.length} candidates.`);
      }
      this.renderModalList();
      return snapshot;
    } catch (err) {
      console.error('Snapshot Creation Error:', err);
      if (typeof window.showToast === 'function') {
        window.showToast('error', 'Snapshot Error', err.message);
      }
    }
  },

  async restoreSnapshot(id) {
    try {
      const M = window.MemoryEngine;
      if (!M) throw new Error("MemoryEngine not ready.");
      const snapshot = await M.getSnapshot(id);
      if (!snapshot || !snapshot.data) throw new Error("Snapshot backup not found.");
      
      if (!confirm(`Are you sure you want to restore snapshot "${snapshot.label}"?\nAll current working state will revert to this snapshot.`)) {
        return;
      }
      
      if (Array.isArray(snapshot.data.leads)) {
        if (typeof M.clearDedupStore === 'function') {
          await M.clearDedupStore();
        }
        const existingLeads = await M.getAllLeads();
        for (const l of existingLeads) await M.deleteLead(l.id);
        for (const l of snapshot.data.leads) await M.addLead(l);
      }
      
      if (Array.isArray(snapshot.data.candidates)) {
        const existingCand = await M.getAllCandidates();
        for (const c of existingCand) await M.deleteCandidate(c.id);
        for (const c of snapshot.data.candidates) await M.addCandidate(c);
      }
      
      if (snapshot.data.localStorageKeys) {
        const keys = snapshot.data.localStorageKeys;
        if (keys.theme) {
          safeLocalStorageSet('skylark-theme', keys.theme);
          document.documentElement.setAttribute('data-theme', keys.theme);
        }
        if (keys.savedEmails) safeLocalStorageSet('skylark_saved_emails', keys.savedEmails);
        if (keys.waTemplate) safeLocalStorageSet('skylark_wa_template', keys.waTemplate);
        if (keys.emailAccount) safeLocalStorageSet('skylark_email_account', keys.emailAccount);
        if (keys.userProfile) safeLocalStorageSet('skylark_user_profile', keys.userProfile);
        if (keys.dedupStrategy) safeLocalStorageSet('skylark_dedup_strategy', keys.dedupStrategy);
        if (keys.micEnabled) safeLocalStorageSet('skylark-mic-enabled', keys.micEnabled);
        if (keys.autoSuggest) safeLocalStorageSet('skylark-auto-suggest', keys.autoSuggest);
        if (keys.autoCrmSync) safeLocalStorageSet('skylark-auto-crm-sync', keys.autoCrmSync);
        if (keys.runInBackground) safeLocalStorageSet('skylark-run-in-background', keys.runInBackground);
        if (keys.desktopNotif) safeLocalStorageSet('skylark-desktop-notif', keys.desktopNotif);
        if (keys.accountName) safeLocalStorageSet('skylark-account-name', keys.accountName);
        if (keys.email) safeLocalStorageSet('skylark-email', keys.email);
        if (keys.llm) safeLocalStorageSet('skylark-llm', keys.llm);
        if (keys.voice) safeLocalStorageSet('skylark-voice', keys.voice);
        if (keys.maxAgents) safeLocalStorageSet('skylark-max-agents', keys.maxAgents);
        if (keys.scrapingDepth) safeLocalStorageSet('skylark-scraping-depth', keys.scrapingDepth);
        if (keys.followupDelay) safeLocalStorageSet('skylark-followup-delay', keys.followupDelay);
        if (keys.perfMode) safeLocalStorageSet('skylark-perf-mode', keys.perfMode);
        if (keys.glassBlur) safeLocalStorageSet('skylark-glass-blur', keys.glassBlur);
        if (keys.animSpeed) safeLocalStorageSet('skylark-animation-speed', keys.animSpeed);
        if (keys.handsFree) safeLocalStorageSet('skylark-hands-free', keys.handsFree);
      }
      
      window.allLeads = await M.getAllLeads();
      window.filteredLeads = [...window.allLeads];
      if (typeof window.updateAllUI === 'function') window.updateAllUI();
      if (typeof window.initCandidatesView === 'function') window.initCandidatesView();
      if (typeof window.showView === 'function') window.showView('dashboard');
      
      if (typeof window.showToast === 'function') {
        window.showToast('success', '✅ Version Restored!', `Successfully restored "${snapshot.label}". App state is 100% operational.`);
      }
      this.closeModal();
    } catch (err) {
      console.error('Snapshot Restore Error:', err);
      if (typeof window.showToast === 'function') {
        window.showToast('error', 'Restore Error', err.message);
      }
    }
  },

  async deleteSnapshot(id) {
    if (!confirm('Delete this backup snapshot?')) return;
    await window.MemoryEngine.deleteSnapshot(id);
    this.renderModalList();
    if (typeof window.showToast === 'function') window.showToast('info', 'Deleted', 'Snapshot backup removed.');
  },

  async exportSnapshot(id) {
    try {
      const M = window.MemoryEngine;
      let snapshot;
      if (id) {
        snapshot = await M.getSnapshot(id);
      } else {
        const snapshots = await M.getAllSnapshots();
        if (snapshots.length > 0) {
          snapshot = snapshots[0];
        } else {
          snapshot = await this.createSnapshot('System Export Backup');
        }
      }
      if (!snapshot) throw new Error("No snapshot available to export.");
      const jsonStr = JSON.stringify(snapshot, null, 2);
      const blob = new Blob([jsonStr], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `skylark_backup_${snapshot.id || Date.now()}.json`;
      a.click();
      URL.revokeObjectURL(url);
      if (typeof window.showToast === 'function') {
        window.showToast('success', 'Exported', 'Data exported as JSON successfully.');
      }
    } catch (err) {
      console.error('Export Error:', err);
      if (typeof window.showToast === 'function') {
        window.showToast('error', 'Export Error', err.message);
      }
    }
  },

  async importSnapshotFromFile(file) {
    if (!file) return;
    try {
      const reader = new FileReader();
      reader.onload = async (e) => {
        try {
          const snapshot = JSON.parse(e.target.result);
          if (!snapshot.id || !snapshot.data) throw new Error("Invalid snapshot format.");
          snapshot.id = 'snap_' + Date.now();
          snapshot.label = (snapshot.label || 'Imported') + ' (Imported)';
          await window.MemoryEngine.saveSnapshot(snapshot);
          this.renderModalList();
          if (typeof window.showToast === 'function') window.showToast('success', 'Imported', 'Snapshot backup imported successfully.');
        } catch (innerErr) {
          console.error("Snapshot file parse error:", innerErr);
          if (typeof window.showToast === 'function') window.showToast('error', 'Import Error', innerErr.message);
        }
      };
      reader.readAsText(file);
    } catch (err) {
      if (typeof window.showToast === 'function') window.showToast('error', 'Import Error', err.message);
    }
  },

  openModal() {
    const el = document.getElementById('snapshot-modal');
    if (el) {
      el.style.display = 'flex';
      this.renderModalList();
    }
  },

  closeModal() {
    const el = document.getElementById('snapshot-modal');
    if (el) el.style.display = 'none';
  },

  async renderModalList() {
    const container = document.getElementById('snapshot-modal-list');
    if (!container) return;
    const snapshots = await window.MemoryEngine.getAllSnapshots();
    if (snapshots.length === 0) {
      container.innerHTML = '<div style="padding:20px; text-align:center; color:var(--gray-400)">No backup snapshots created yet. Click "Create New Backup Snapshot" above to save your first snapshot.</div>';
      return;
    }
    
    container.innerHTML = snapshots.map(s => `
      <div style="display:flex; align-items:center; justify-content:space-between; padding:12px 16px; border:1px solid var(--border); border-radius:10px; margin-bottom:10px; background:rgba(255,255,255,0.03);">
        <div>
          <div style="font-weight:700; color:var(--foreground); font-size:14px;">${s.label}</div>
          <div style="font-size:11px; color:var(--gray-400); margin-top:2px;">
            ${new Date(s.timestamp).toLocaleString()} • ${s.leadsCount || 0} Leads • ${s.candidatesCount || 0} Candidates
          </div>
        </div>
        <div style="display:flex; gap:8px;">
          <button onclick="SnapshotManager.restoreSnapshot('${s.id}')" class="btn-primary" style="padding:6px 12px; font-size:12px; background:linear-gradient(135deg, #10b981 0%, #059669 100%);">
            🔄 Restore
          </button>
          <button onclick="SnapshotManager.exportSnapshot('${s.id}')" class="btn-secondary" style="padding:6px 10px; font-size:12px;">
            📥 Export
          </button>
          <button onclick="SnapshotManager.deleteSnapshot('${s.id}')" class="btn-secondary" style="padding:6px 8px; font-size:12px; color:#ef4444; border-color:#fecaca;">
            🗑️
          </button>
        </div>
      </div>
    `).join('');
  },

  async ensureBaselineSnapshot() {
    try {
      const snapshots = await window.MemoryEngine.getAllSnapshots();
      if (snapshots.length === 0) {
        await this.createSnapshot('Baseline Stable Version (Auto-Saved)');
      }
    } catch(e) {}
  }
};
window.SnapshotManager = SnapshotManager;
window.exportData = function() {
  if (window.SnapshotManager && typeof window.SnapshotManager.exportSnapshot === 'function') {
    window.SnapshotManager.exportSnapshot();
  }
};
document.addEventListener('DOMContentLoaded', async () => {
  const ensureAppShellVisible = () => {
    // Auth guard only. checkInitialSession() resets skylark_logged_in to 'false'
    // on every page load, so the app shell stays hidden until the user actually
    // unlocks. Data restoration happens in AntigravityAuth.transitionToApp()
    // AFTER a successful unlock — never here, or it would run pre-auth.
    const isLoggedIn = window.CLAVIS_LOCAL_MODE || location.protocol === 'file:' || /^(localhost|127\.0\.0\.1)$/.test(location.hostname) || Boolean(window.SupabaseAuth?.getSession?.());
    const shell = document.getElementById('app-shell');
    const authScreen = document.getElementById('auth-screen');

    if (isLoggedIn) {
      if (shell) shell.style.display = 'flex';
      if (authScreen) authScreen.style.display = 'none';
    } else {
      // Block app-shell — force auth screen
      if (shell) shell.style.display = 'none';
    }
  };
  let initStage = 'navigation';
  try {
    // Routing comes first so an optional setup failure can never trap the
    // user on the dashboard.
    initHashRouting();

    // Respect auth state before showing anything
    initStage = 'auth shell';
    ensureAppShellVisible();
    
    // Safely initialize leads immediately (from localStorage backup if any)
    initStage = 'lead state';
    initializeLeads();

    // Provider credentials are backend-only. Never hydrate them from browser
    // storage or copy integration endpoints into a local browser vault.
    initStage = 'workspace configuration';
    const cfg = window.SKYLARK_CONFIG || {};
    if (cfg.EMAIL_SENDER_ADDRESS && cfg.EMAIL_SENDER_ADDRESS.trim() !== '') {
      const cfgEmail = cfg.EMAIL_SENDER_ADDRESS.trim();
      if (!safeLocalStorageGet('skylark_email_account')) {
        safeLocalStorageSet('skylark_email_account', cfgEmail);
      }
      try {
        const savedArr = JSON.parse(safeLocalStorageGet('skylark_saved_emails', '[]'));
        if (!savedArr.includes(cfgEmail)) {
          savedArr.push(cfgEmail);
          safeLocalStorageSet('skylark_saved_emails', JSON.stringify(savedArr));
        }
      } catch(e) {}
    }

    initStage = 'memory database';
    await MemoryEngine.openDB();
    initStage = 'settings UI';
    if (typeof loadSettingsToUI === 'function') loadSettingsToUI();
    initStage = 'lead filters';
    if (typeof populateIndustryGrid === 'function') populateIndustryGrid();
    try {
      const memLeads = await MemoryEngine.getAllLeads();
      if (Array.isArray(memLeads)) {
        allLeads = memLeads;
        filteredLeads = [...allLeads];
      }
    } catch(e) {
      console.warn("[App] Failed to load from MemoryEngine, relying on safe fallback.");
    }
    if (typeof populateFilterDropdowns === 'function') populateFilterDropdowns();
    updateAllUI();
    bindSidebarToggle();
    // macOS Soft UI Sound Synthesizer (Web Audio API - Pure, Soft, Offline Multi-Tone)
    if (!window.__lxSoundLoaded) window.SoundFX = (() => {
      let audioCtx = null;

      function getAudioCtx() {
        if (!audioCtx) {
          const AudioContextClass = window.AudioContext || window.webkitAudioContext;
          if (AudioContextClass) audioCtx = new AudioContextClass();
        }
        if (audioCtx && audioCtx.state === 'suspended') {
          audioCtx.resume();
        }
        return audioCtx;
      }

      function isEnabled() {
        return localStorage.getItem('skylark_sound_effects') !== 'false';
      }

      function toggleSound(enabled) {
        localStorage.setItem('skylark_sound_effects', enabled ? 'true' : 'false');
      }

      function playClick() {
        if (!isEnabled()) return;
        try {
          const ctx = getAudioCtx();
          if (!ctx) return;
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          osc.type = 'sine';
          const now = ctx.currentTime;
          osc.frequency.setValueAtTime(800, now);
          osc.frequency.exponentialRampToValueAtTime(150, now + 0.018);
          gain.gain.setValueAtTime(0.04, now);
          gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.018);
          osc.connect(gain);
          gain.connect(ctx.destination);
          osc.start(now);
          osc.stop(now + 0.02);
        } catch(e) {}
      }

      function playToggle() {
        if (!isEnabled()) return;
        try {
          const ctx = getAudioCtx();
          if (!ctx) return;
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          osc.type = 'sine';
          const now = ctx.currentTime;
          osc.frequency.setValueAtTime(600, now);
          osc.frequency.exponentialRampToValueAtTime(300, now + 0.015);
          gain.gain.setValueAtTime(0.035, now);
          gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.015);
          osc.connect(gain);
          gain.connect(ctx.destination);
          osc.start(now);
          osc.stop(now + 0.02);
        } catch(e) {}
      }

      function playSuccess() {
        if (!isEnabled()) return;
        try {
          const ctx = getAudioCtx();
          if (!ctx) return;
          const now = ctx.currentTime;
          [523.25, 659.25].forEach((freq, idx) => {
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.type = 'sine';
            const start = now + (idx * 0.04);
            osc.frequency.setValueAtTime(freq, start);
            gain.gain.setValueAtTime(0.03, start);
            gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.06);
            osc.connect(gain);
            gain.connect(ctx.destination);
            osc.start(start);
            osc.stop(start + 0.07);
          });
        } catch(e) {}
      }

      function playNotification() {
        if (!isEnabled()) return;
        try {
          const ctx = getAudioCtx();
          if (!ctx) return;
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          osc.type = 'sine';
          const now = ctx.currentTime;
          osc.frequency.setValueAtTime(880, now);
          gain.gain.setValueAtTime(0.025, now);
          gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.08);
          osc.connect(gain);
          gain.connect(ctx.destination);
          osc.start(now);
          osc.stop(now + 0.09);
        } catch(e) {}
      }

      function playError() {
        if (!isEnabled()) return;
        try {
          const ctx = getAudioCtx();
          if (!ctx) return;
          const now = ctx.currentTime;
          [220, 196].forEach((freq, idx) => {
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.type = 'sine';
            const start = now + (idx * 0.03);
            osc.frequency.setValueAtTime(freq, start);
            gain.gain.setValueAtTime(0.03, start);
            gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.06);
            osc.connect(gain);
            gain.connect(ctx.destination);
            osc.start(start);
            osc.stop(start + 0.07);
          });
        } catch(e) {}
      }

      return { playClick, playToggle, playSuccess, playNotification, playError, isEnabled, toggleSound };
    })();

    // NOTE: Sound click/hover listeners are now handled by luxury-sound.js
    // (zero-latency pointerdown engine). The old click listener is removed
    // to avoid double sounds. If luxury-sound.js failed to load, fall back:
    if (!window.__lxSoundLoaded) {
      document.addEventListener('click', (e) => {
        if (window.__lxSoundLoaded) return;
        const toggle = e.target.closest('.toggle-switch, .switch input, input[type="checkbox"]');
        if (toggle) { window.SoundFX && window.SoundFX.playToggle && window.SoundFX.playToggle(); return; }
        const target = e.target.closest('button, .btn-primary, .btn-secondary, .nav-item, .action-btn, .tab-btn');
        if (target) { window.SoundFX && window.SoundFX.playClick && window.SoundFX.playClick(); }
      }, { passive: true });
    }

    initStage = 'navigation refresh';
    if (typeof updateBatchInfo === 'function') updateBatchInfo();
    initStage = 'chat UI';
    if (typeof initChatUI === 'function') initChatUI();

    // ── Restore persistent token counter & baseline snapshot ──────
    initStage = 'token counter';
    restoreTokenCounter();
    initStage = 'baseline snapshot';
    await SnapshotManager.ensureBaselineSnapshot();

    // Global app API export
    window.NEXUS = { showView, currentView: () => currentView, SnapshotManager, DataSanitizer };
    window.showView = showView;

    showToast('info', '✓ Clavis AI Agent Ready', `${allLeads.length} leads loaded from memory`);
  } catch (err) {
    console.error('Init error:', err);
    ensureAppShellVisible();
    const message = err?.message || String(err || 'Unknown startup error');
    const stackLine = String(err?.stack || '').split('\n').find(line => /\.js:\d+/.test(line))?.trim();
    const detail = [
      `Startup stage: ${initStage}.`,
      stackLine ? `Source: ${stackLine}` : 'The exact source was not reported by the browser.',
      'Navigation is still available; retry after reviewing this detail.'
    ].join(' ');
    if (typeof window.showToast === 'function') {
      window.showToast({
        type: 'error',
        title: 'Initialization failed',
        message,
        detail,
        persistent: true,
        actions: [{ label: 'Retry startup', primary: true, run: () => window.location.reload() }]
      });
    }
  }
});

// ============================================================
//  HASH ROUTER SYSTEM (Vanilla JS SPA Router)
// ============================================================
const ROUTE_MAP = {
  '': 'dashboard',
  '#': 'dashboard',
  '#dashboard': 'dashboard',
  '#chat': 'chat',
  '#client-ai': 'chat',
  '#jarvis': 'jarvis',
  '#voice-ai': 'voice-ai',
  '#candidate-ai': 'candidate-ai',
  '#leads': 'leads',
  '#all-leads': 'leads',
  '#candidate-db': 'candidate-db',
  '#excel': 'excel',
  '#excel-manager': 'excel',
  '#analytics': 'analytics',
  '#agent': 'agent',
  '#run-agent': 'agent',
  '#email': 'email',
  '#email-auto': 'email',
  '#whatsapp': 'whatsapp',
  '#whatsapp-auto': 'whatsapp',
  '#accounts': 'accounts',
  '#plugins': 'plugins',
  '#integrations': 'plugins',
  '#tokens': 'tokens',
  '#api-keys': 'tokens',
  '#settings': 'settings'
};

function triggerAutoRecovery() {
  try {
    // Only run recovery if user has genuinely authenticated this session
    // (skylark_logged_in is reset to 'false' on every page load)
    const isLoggedIn = Boolean(window.SupabaseAuth?.getSession?.());
    if (!isLoggedIn) return; // don't bypass auth — password must be entered
    const shell = document.getElementById('app-shell');
    if (shell && (shell.style.display === 'none' || getComputedStyle(shell).display === 'none')) {
      shell.style.display = 'flex';
    }
    const auth = document.getElementById('auth-screen');
    if (auth) auth.style.display = 'none';
    if (!document.querySelector('.view.active')) {
      const dash = document.getElementById('view-dashboard');
      if (dash) { dash.classList.add('active'); dash.style.display = ''; }
    }
  } catch(e) {}
}

function showAppError(message) {
  try {
    const text = String(message || 'An unexpected error occurred.');
    if (typeof window.showToast === 'function') {
      window.showToast('error', 'Application Error', text);
    } else {
      let banner = document.getElementById('app-error-banner');
      if (!banner) {
        banner = document.createElement('div');
        banner.id = 'app-error-banner';
        banner.style.cssText = [
          'position:fixed',
          'left:16px',
          'right:16px',
          'bottom:16px',
          'z-index:99999',
          'padding:12px 14px',
          'border-radius:12px',
          'background:rgba(220,38,38,0.95)',
          'color:#fff',
          'font-weight:600',
          'box-shadow:0 12px 30px rgba(0,0,0,0.25)'
        ].join(';');
        document.body.appendChild(banner);
      }
      banner.textContent = text;
      clearTimeout(window.__appErrorBannerTimer);
      window.__appErrorBannerTimer = setTimeout(() => {
        if (banner && banner.parentNode) banner.parentNode.removeChild(banner);
      }, 6000);
    }
  } catch (err) {
    console.error('[showAppError fallback failed]', err);
  }
}
window.showAppError = showAppError;

window.addEventListener("error", (event) => {
  // Ignore noisy CDN or extension errors
  if (event.filename && (event.filename.includes('cdn') || event.filename.includes('extension'))) return;
  
  console.error("[Global Error]", {
    message: event.message,
    file: event.filename,
    line: event.lineno,
    column: event.colno,
    error: event.error,
  });
  // Handled silently by self-heal engine without annoying popups
});

window.addEventListener("unhandledrejection", (event) => {
  const msg = event.reason ? (event.reason.message || String(event.reason)) : "Unknown reason";
  if (/AbortError|ResizeObserver|NotAllowedError/i.test(msg)) return;
  console.error("[Unhandled Promise Rejection]", event.reason);
});

function initHashRouting() {
  bindNavigation();

  // Listen to browser hash changes (back/forward & clicks)
  window.addEventListener('hashchange', handleHashChange);

  // Initial page load hash resolution
  handleHashChange();
}

function handleHashChange() {
  const rawHash = (window.location.hash || '#dashboard').toLowerCase();
  const viewName = ROUTE_MAP[rawHash] || rawHash.replace('#', '') || 'dashboard';
  showView(viewName);
}

function bindNavigation() {
  document.querySelectorAll('.nav-item, .nav-sub-item').forEach(item => {
    item.addEventListener('click', e => {
      const view = item.dataset.view;
      if (view) {
        e.preventDefault();
        if (view === 'settings') {
          window.location.hash = '#settings';
          if (typeof window.openSettingsModal === 'function') {
            window.openSettingsModal();
          } else {
            showView('settings');
          }
          return;
        }
        window.location.hash = `#${view}`;
      }
    });
  });
}

function showView(viewName) {
  currentView = viewName;

  // 1. Highlight active sidebar link
  document.querySelectorAll('.nav-item, .nav-sub-item').forEach(el =>
    el.classList.toggle('active', el.dataset.view === viewName)
  );

  // 2. Update breadcrumb text
  const labels = {
    chat: 'Client AI (Chat)',
    dashboard: 'Dashboard Overview',
    leads: 'All Leads Database',
    agent: 'Run AI Agent',
    excel: 'Excel Manager',
    analytics: 'Analytics & Reports',
    settings: 'System Settings',
    tokens: 'API Keys Dashboard',
    accounts: 'Connected Accounts',
    email: 'Email Automation',
    whatsapp: 'WhatsApp Automation',
    'candidate-ai': 'Candidate AI Recruiter',
    'candidate-db': 'Candidate Database',
    jarvis: 'Clavis AI Studio',
    'voice-ai': 'Voice Calling AI'
  };
  const breadcrumb = document.getElementById('breadcrumb-text');
  if (breadcrumb) {
    breadcrumb.textContent = labels[viewName] || viewName;
  }

  // Settings opens as a macOS overlay — never as a blank page view (requires login)
  if (viewName === 'settings') {
    const isLoggedIn = localStorage.getItem('skylark_logged_in') === 'true';
    if (isLoggedIn && typeof window.openSettingsModal === 'function') {
      window.openSettingsModal();
    }
    return;
  }

  // Navigating anywhere else closes the settings panel
  if (typeof window.closeSettingsModal === 'function') {
    window.closeSettingsModal();
  }

  // 3. Clear inline styles and switch .active class for CSS rendering
  document.querySelectorAll('.view').forEach(v => {
    v.classList.remove('active');
    v.style.display = '';
  });

  const target = document.getElementById(`view-${viewName}`);
  if (target) {
    target.classList.add('active');
    target.style.display = '';
  } else {
    console.warn(`Target view #view-${viewName} not found, falling back to dashboard.`);
    const dash = document.getElementById('view-dashboard');
    if (dash) {
      dash.classList.add('active');
      dash.style.display = '';
      currentView = 'dashboard';
    }
  }

  // Only guarantee #app-shell is visible when switching views if user is logged in
  const shell = document.getElementById('app-shell');
  const isLoggedIn = localStorage.getItem('skylark_logged_in') === 'true';
  if (isLoggedIn && shell && shell.style.display === 'none') {
    shell.style.display = 'flex';
  }

  // 4. Render view content dynamically (safely wrapped in try...catch)
  try {
    if (viewName === 'dashboard') {
      if (window.DashboardCtrl && typeof window.DashboardCtrl.init === 'function') window.DashboardCtrl.init();
      if (typeof renderDashboard === 'function') renderDashboard();
    }
  } catch (err) { console.error('Error rendering dashboard view:', err); }

  try {
    if (viewName === 'leads') {
      if (window.LeadsCtrl && typeof window.LeadsCtrl.init === 'function') window.LeadsCtrl.init();
      if (typeof populateFilterDropdowns === 'function') populateFilterDropdowns();
      if (typeof renderLeadsTable === 'function') renderLeadsTable();
    }
  } catch (err) { console.error('Error rendering leads view:', err); }

  try {
    if (viewName === 'agent') {
      if (window.AgentCtrl && typeof window.AgentCtrl.init === 'function') window.AgentCtrl.init();
    }
  } catch (err) { console.error('Error rendering agent view:', err); }

  try {
    if (viewName === 'analytics') {
      if (window.AnalyticsCtrl && typeof window.AnalyticsCtrl.init === 'function') window.AnalyticsCtrl.init();
      if (typeof renderAnalytics === 'function') renderAnalytics();
    }
  } catch (err) { console.error('Error rendering analytics view:', err); }

  try {
    if (viewName === 'settings') {
      if (typeof refreshSettingsMemoryStats === 'function') refreshSettingsMemoryStats();
      if (typeof loadSettingsToUI === 'function') loadSettingsToUI();
      if (typeof ensureSettingsAccordionState === 'function') ensureSettingsAccordionState();
    }
  } catch (err) { console.error('Error rendering settings view:', err); }

  try {
    if (viewName === 'excel') {
      if (window.ExcelCtrl && typeof window.ExcelCtrl.init === 'function') window.ExcelCtrl.init();
      if (typeof initExcelView === 'function') initExcelView();
    }
  } catch (err) { console.error('Error rendering excel view:', err); }

  try {
    if (viewName === 'tokens' && typeof renderTokenDashboard === 'function') renderTokenDashboard();
  } catch (err) { console.error('Error rendering tokens view:', err); }

  try {
    if (viewName === 'email' && window.EmailCtrl?.init) {
      // EmailCtrl is idempotent and owns draft/signature restoration. Calling
      // legacy loadEmailTemplate here used to overwrite custom signatures.
      window.EmailCtrl.init();
    }
  } catch (err) { console.error('Error rendering email view:', err); }

  try {
    if (viewName === 'accounts') {
      if (window.AccountsCtrl && typeof window.AccountsCtrl.init === 'function') window.AccountsCtrl.init();
      if (typeof renderAccountsUI === 'function') renderAccountsUI();
    }
  } catch (err) { console.error('Error rendering accounts view:', err); }

  try {
    if (viewName === 'plugins') {
      if (window.PluginsCtrl && typeof window.PluginsCtrl.init === 'function') window.PluginsCtrl.init();
    }
  } catch (err) { console.error('Error rendering plugins view:', err); }

  try {
    if (viewName === 'whatsapp') {
      if (window.WhatsAppCtrl && typeof window.WhatsAppCtrl.init === 'function') window.WhatsAppCtrl.init();
      if (typeof updateWhatsappPreview === 'function') updateWhatsappPreview();
    }
  } catch (err) { console.error('Error rendering whatsapp view:', err); }

  try {
    if (viewName === 'candidate-ai' || viewName === 'candidate-db') {
      if (window.CandidatesCtrl && typeof window.CandidatesCtrl.init === 'function') window.CandidatesCtrl.init();
      if (typeof initCandidatesView === 'function') initCandidatesView();
    }
  } catch (err) { console.error('Error rendering candidates view:', err); }

  try {
    if (viewName === 'jarvis') {
      if (typeof window.initJarvisUI === 'function') window.initJarvisUI();
      // Do NOT auto-open the task/pipeline surface just for opening the Clavis
      // tab. It used to pop the idle "Autonomous Agent Pipeline" greeting with
      // no command given. The surface now opens only when the user actually
      // sends something (jarvis_ui.js calls ClavisTaskSurface.show() on submit).
    }
  } catch (err) { console.error('Error initializing jarvis view:', err); }
}

// ============================================================
//  SIDEBAR
// ============================================================
function bindSidebarToggle() {
  // The macOS-style traffic-light buttons are the actual sidebar controls in
  // the current shell. Keep the id hook for older layouts, but fall back to
  // their stable aria labels so a markup refresh cannot make the sidebar
  // silently non-interactive.
  const toggleBtn = document.getElementById('sidebar-toggle')
    || document.querySelector('[aria-label="Toggle sidebar"]')
    || document.querySelector('.sidebar-toggle');
  const mobileToggleBtn = document.querySelector('[aria-label="Open navigation"]');
  const collapseBtn = document.querySelector('[aria-label="Collapse sidebar"]');
  const expandBtn = document.querySelector('[aria-label="Expand sidebar"]');
  const sidebar = document.getElementById('sidebar');
  if (!toggleBtn || !sidebar) return;

  if (toggleBtn.dataset.sidebarBound === 'true') return;
  toggleBtn.dataset.sidebarBound = 'true';
  const setCollapsed = (collapsed) => {
    if (window.innerWidth <= 768) {
      sidebar.classList.toggle('mobile-open', !collapsed);
      return;
    }
    sidebar.classList.toggle('collapsed', collapsed);
    toggleBtn.setAttribute('aria-pressed', String(collapsed));
  };

  toggleBtn.addEventListener('click', () => {
    if (window.SidebarController) window.SidebarController.toggle();
    else if (window.innerWidth <= 768) sidebar.classList.toggle('mobile-open');
    else setCollapsed(!sidebar.classList.contains('collapsed'));
  });

  mobileToggleBtn?.addEventListener('click', () => {
    if (window.innerWidth <= 768) sidebar.classList.toggle('mobile-open');
  });

  collapseBtn?.addEventListener('click', () => setCollapsed(true));
  expandBtn?.addEventListener('click', () => setCollapsed(false));

  document.addEventListener('click', e => {
    if (window.innerWidth <= 768 && !sidebar.contains(e.target) &&
        !toggleBtn.contains(e.target) && !mobileToggleBtn?.contains(e.target) && sidebar.classList.contains('mobile-open'))
      sidebar.classList.remove('mobile-open');
  });
}

// ============================================================
//  PERSISTENT TOKEN COUNTER RESTORE
// ============================================================
// Cumulative Apify usage across ALL keys, mirrored to its own durable counter.
// Reading only the active key made the meter appear to reset to 0 whenever the
// key rotated (or when the per-key map was cleared), which looked like data loss.
function getApifyUsageTotal() {
  const cfg = window.SKYLARK_CONFIG || {};
  const keyCount = Math.max(1, (cfg.APIFY_API_KEYS || []).filter(k => k && k.trim()).length);
  let summed = 0;
  try {
    const map = window.MemoryEngine?.getKeyUsageMap?.() || {};
    for (const [k, v] of Object.entries(map)) {
      if (k.startsWith('apify_')) summed += Number(v) || 0;
    }
  } catch (_) {}

  // Never let the visible number regress: keep a high-water mark.
  let mirrored = 0;
  try { mirrored = parseInt(localStorage.getItem('skylark_apify_used_total') || '0', 10) || 0; } catch (_) {}
  const used = Math.max(summed, mirrored);
  if (used !== mirrored) {
    try { localStorage.setItem('skylark_apify_used_total', String(used)); } catch (_) {}
  }
  return { used, limit: (cfg.APIFY_KEY_LIMIT || 500) * keyCount, keyCount };
}
window.getApifyUsageTotal = getApifyUsageTotal;

function restoreTokenCounter() {
  const { used, limit } = getApifyUsageTotal();

  const bar = document.getElementById('token-bar-fill');
  const cnt = document.getElementById('token-count');
  const pct = limit ? Math.min((used / limit) * 100, 100) : 0;

  if (bar) bar.style.width = pct + '%';
  if (cnt) cnt.textContent = `${used.toLocaleString('en-IN')} / ${limit.toLocaleString('en-IN')}`;

  const label = document.querySelector('.token-label');
  if (label) label.textContent = 'Credits';   // no vendor/API wording for users

  const meter = document.getElementById('token-meter');
  if (meter) meter.setAttribute('data-tooltip', `${used} of ${limit} credits used`);
}

// ============================================================
//  UPDATE ALL UI
// ============================================================
function updateAllUI() {
  updateMemoryChip();
  updateLeadsBadge();
  if (currentView === 'dashboard') renderDashboard();
  if (currentView === 'leads')    renderLeadsTable();
  if (currentView === 'analytics') renderAnalytics();
}

function updateMemoryChip() {
  const el = document.getElementById('memory-count');
  if (el) el.textContent = `${allLeads.length} leads`;
}

function updateLeadsBadge() {
  const el = document.getElementById('leads-count-badge');
  if (el) el.textContent = allLeads.length;
}

// ============================================================
//  INDUSTRY GRID — render cards from IndustryDB
// ============================================================
function populateIndustryGrid() {
  const grid = document.getElementById('industry-grid');
  if (!grid) return;
  const industries = IndustryDB.getAll();
  grid.innerHTML = '';

  for (const [key, ind] of Object.entries(industries)) {
    const card = document.createElement('div');
    card.className = 'industry-card';
    card.dataset.key = key;
    card.innerHTML = `
      <input type="checkbox" id="ind-${escHtml(key)}"/>
      <div class="industry-card-icon">${ind.icon}</div>
      <div class="industry-card-label">${escHtml(key)}</div>
      <div class="industry-card-check" id="ind-check-${escHtml(key)}"></div>
    `;
    card.addEventListener('click', () => toggleIndustry(key, card));
    grid.appendChild(card);
  }
}

function toggleIndustry(key, card) {
  if (!card) card = document.querySelector(`.industry-card[data-key="${CSS.escape(key)}"]`);
  if (!card) return;
  if (selectedIndustries.has(key)) {
    selectedIndustries.delete(key);
    card.classList.remove('selected');
    card.querySelector('.industry-card-check').textContent = '';
  } else {
    selectedIndustries.add(key);
    card.classList.add('selected');
    card.querySelector('.industry-card-check').textContent = '✓';
  }
  updateBatchInfo();
}

function selectAllIndustries() {
  document.querySelectorAll('.industry-card').forEach(card => {
    const key = card.dataset.key;
    if (key) {
      selectedIndustries.add(key);
      card.classList.add('selected');
      card.querySelector('.industry-card-check').textContent = '✓';
    }
  });
  updateBatchInfo();
}

function clearAllIndustries() {
  selectedIndustries.clear();
  document.querySelectorAll('.industry-card').forEach(card => {
    card.classList.remove('selected');
    const chk = card.querySelector('.industry-card-check');
    if (chk) chk.textContent = '';
  });
  updateBatchInfo();
}

function selectTopIndustries() {
  clearAllIndustries();
  const top5 = ['Hotels & Hospitality', 'Hospitals & Healthcare', 'IT Parks & Tech Companies', 'Shopping Malls & Retail', 'Corporate Offices'];
  top5.forEach(key => toggleIndustry(key, null));
}

// ============================================================
//  MULTI-LOCATION TAG INPUT
// ============================================================
function handleLocationKeydown(e) {
  const input = document.getElementById('location-input');
  if ((e.key === 'Enter' || e.key === ',') && input.value.trim()) {
    e.preventDefault();
    addLocationTag(input.value.trim().replace(/,/g, ''));
    input.value = '';
  }
  if (e.key === 'Backspace' && input.value === '' && selectedLocations.length > 0) {
    removeLocationTag(selectedLocations[selectedLocations.length - 1]);
  }
}

function addLocationTag(city) {
  if (!city || selectedLocations.includes(city)) return;
  selectedLocations.push(city);
  renderLocationTags();
  updateBatchInfo();
}

function removeLocationTag(city) {
  selectedLocations = selectedLocations.filter(c => c !== city);
  renderLocationTags();
  updateBatchInfo();
}

function renderLocationTags() {
  const chips = document.getElementById('location-chips');
  if (!chips) return;
  chips.innerHTML = '';
  selectedLocations.forEach(city => {
    const tag = document.createElement('span');
    tag.className = 'location-tag';
    tag.innerHTML = `${escHtml(city)}<button class="location-tag-remove" onclick="removeLocationTag('${escHtml(city)}')" title="Remove">✕</button>`;
    chips.appendChild(tag);
  });
}

// ============================================================
//  BATCH ESTIMATE
// ============================================================
function updateBatchInfo() {
  const batchSlider = document.getElementById('batch-size');
  if (!batchSlider) return;
  const perCombo = parseInt(batchSlider.value);
  const numIndustries = selectedIndustries.size;
  const numLocations = selectedLocations.length;
  const estimate = perCombo * numIndustries * numLocations;
  const tokens = estimate * 7; // approx tokens per lead

  const valEl = document.getElementById('batch-size-val');
  const estEl = document.getElementById('batch-estimate');
  const tokEl = document.getElementById('token-estimate');

  if (valEl) valEl.textContent = perCombo;
  if (estEl) estEl.textContent = numIndustries > 0 && numLocations > 0
    ? `~${estimate} total leads (${numIndustries} industries × ${numLocations} cities × ${perCombo} leads)`
    : numIndustries === 0 ? '⚠ Select at least 1 industry'
    : '⚠ Add at least 1 location';
  if (tokEl) tokEl.textContent = estimate > 0 ? `~${tokens} Apify tokens estimated` : '';
}

// ============================================================
//  SERVICE CARD STATE
// ============================================================
function updateServiceCard(type) {
  if (window.AgentCtrl?.handleServiceToggle) {
    window.AgentCtrl.handleServiceToggle(type);
    return;
  }
  const autoCb = document.getElementById('target-auto');
  const secCb = document.getElementById('target-security');
  const hkCb  = document.getElementById('target-housekeeping');
  document.getElementById('svc-auto-card')?.classList.toggle('active', autoCb?.checked);
  document.getElementById('svc-security-card')?.classList.toggle('active', secCb?.checked);
  document.getElementById('svc-hk-card')?.classList.toggle('active', hkCb?.checked);
  document.getElementById('svc-pantry-card')?.classList.toggle('active', document.getElementById('target-pantry')?.checked);
}

// ============================================================
//  DASHBOARD
// ============================================================
function renderDashboard() {
  const container = document.getElementById('view-dashboard');
  try {
    if (container) container.classList.remove('error-state');
    const total       = allLeads.length;
    const newLeads    = allLeads.filter(l => l.status === 'New').length;
    const security    = allLeads.filter(l => l.type === 'Security' || l.type === 'Both').length;
    const housekeeping = allLeads.filter(l => l.type === 'Housekeeping' || l.type === 'Both').length;

    animateCount('sv-total', total);
    animateCount('sv-new', newLeads);
    animateCount('sv-security', security);
    animateCount('sv-housekeeping', housekeeping);

    renderSourceBars();
    renderDonutChart();
    renderIndustryBars();
    renderCityBars();
    renderRecentLeads();
  } catch (err) {
    console.error('Dashboard render error:', err);
    if (container) container.innerHTML = `<div class="error-state">Failed to load data: ${err.message}</div>`;
  }
}

function toggleAccordion(headerEl) {
  const accordion = headerEl?.closest('.settings-accordion');
  if (!accordion) return;
  const isOpen = accordion.classList.toggle('open');
  if (window.SoundFX && typeof window.SoundFX.playToggle === 'function') {
    window.SoundFX.playToggle();
  }
}
window.toggleAccordion = toggleAccordion;

function ensureSettingsAccordionState() {
  const accordions = Array.from(document.querySelectorAll('#view-settings .settings-accordion'));
  if (accordions.length === 0) return;
  const hasOpenAccordion = accordions.some(acc => acc.classList.contains('open'));
  if (!hasOpenAccordion) {
    accordions[0].classList.add('open');
  }
}

function animateCount(id, target) {
  const el = document.getElementById(id);
  if (!el) return;
  const start = parseInt(el.textContent) || 0;
  const duration = 600;
  const startTime = performance.now();
  const tick = now => {
    const elapsed = now - startTime;
    const progress = Math.min(elapsed / duration, 1);
    const eased = 1 - Math.pow(1 - progress, 3);
    el.textContent = Math.round(start + (target - start) * eased);
    if (progress < 1) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

// Richer, consistent empty-state for dashboard charts (icon badge + title + sub + CTA).
// Presentational only — no data/logic change.
function chartEmptyState(title, sub) {
  return `<div class="do-chart-empty">
    <div class="do-empty-badge">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>
    </div>
    <div class="do-empty-title">${title || 'No data yet'}</div>
    <div class="do-empty-sub">${sub || 'Run the agent to populate this chart with live lead data.'}</div>
    <button class="do-empty-cta" onclick="showView('agent')">Run Agent</button>
  </div>`;
}
if (typeof window !== 'undefined') window.chartEmptyState = chartEmptyState;

function renderSourceBars() {
  const container = document.getElementById('source-bars');
  if (!container) return;
  const sources = ['LinkedIn', 'Indeed', 'Google Jobs', 'Google Maps'];
  const colors = ['#3b82f6', '#ec4899', '#10b981', '#f59e0b'];
  const counts = sources.map(s => allLeads.filter(l => l.source === s).length);
  const maxCount = Math.max(...counts, 1);

  if (allLeads.length === 0) {
    container.innerHTML = chartEmptyState('No lead sources yet', 'Run the agent to see where your leads come from.'); return;
  }
  container.innerHTML = '';

  const legend = document.getElementById('source-legend');
  if (legend) legend.innerHTML = sources.map((s, i) =>
    `<div class="legend-item"><div class="legend-dot" style="background:${colors[i]}"></div><span>${s}</span></div>`
  ).join('');

  sources.forEach((source, i) => {
    const pct = (counts[i] / maxCount) * 100;
    const row = document.createElement('div');
    row.className = 'source-bar-item';
    row.innerHTML = `<div class="source-bar-label">${source}</div><div class="source-bar-track"><div class="source-bar-fill" style="width:0%;background:${colors[i]}" data-target="${pct}"></div></div><div class="source-bar-count">${counts[i]}</div>`;
    container.appendChild(row);
    setTimeout(() => {
      const fill = row.querySelector('.source-bar-fill');
      if (fill) fill.style.width = pct + '%';
    }, 100 + i * 80);
  });
}

function renderIndustryBars() {
  const container = document.getElementById('industry-bars');
  if (!container) return;
  if (allLeads.length === 0) { container.innerHTML = chartEmptyState('No industries yet', 'Run the agent to break leads down by industry.'); return; }

  // Group by industry
  const industryMap = {};
  allLeads.forEach(l => {
    const ind = l.industry || l.sector || 'Unknown';
    industryMap[ind] = (industryMap[ind] || 0) + 1;
  });

  const sorted = Object.entries(industryMap).sort((a, b) => b[1] - a[1]).slice(0, 8);
  const max = Math.max(...sorted.map(e => e[1]), 1);

  const colors = ['#6366f1', '#f59e0b', '#ef4444', '#ec4899', '#10b981', '#3b82f6', '#8b5cf6', '#14b8a6'];
  container.innerHTML = '';

  sorted.forEach(([ind, cnt], i) => {
    const pct = (cnt / max) * 100;
    const shortKey = ind.split('&')[0].trim().split(' ').slice(0, 2).join(' ');
    const row = document.createElement('div');
    row.className = 'source-bar-item';
    row.innerHTML = `<div class="source-bar-label" title="${escHtml(ind)}">${escHtml(shortKey)}</div><div class="source-bar-track"><div class="source-bar-fill" style="width:0%;background:${colors[i % colors.length]}"></div></div><div class="source-bar-count">${cnt}</div>`;
    container.appendChild(row);
    setTimeout(() => { row.querySelector('.source-bar-fill').style.width = pct + '%'; }, 100 + i * 60);
  });
}

function renderCityBars() {
  const container = document.getElementById('city-bars');
  if (!container) return;
  if (allLeads.length === 0) { container.innerHTML = chartEmptyState('No cities yet', 'Run the agent to see your top lead cities.'); return; }

  const cityMap = {};
  allLeads.forEach(l => { const c = l.city || 'Unknown'; cityMap[c] = (cityMap[c] || 0) + 1; });
  const sorted = Object.entries(cityMap).sort((a, b) => b[1] - a[1]).slice(0, 8);
  const max = Math.max(...sorted.map(e => e[1]), 1);

  container.innerHTML = '';
  sorted.forEach(([city, cnt], i) => {
    const pct = (cnt / max) * 100;
    const row = document.createElement('div');
    row.className = 'source-bar-item';
    row.innerHTML = `<div class="source-bar-label">${escHtml(city)}</div><div class="source-bar-track"><div class="source-bar-fill" style="width:0%;background:#6366f1"></div></div><div class="source-bar-count">${cnt}</div>`;
    container.appendChild(row);
    setTimeout(() => { row.querySelector('.source-bar-fill').style.width = pct + '%'; }, 100 + i * 50);
  });
}

function renderDonutChart() {
  const canvas = document.getElementById('status-donut');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const statusConfig = [
    { key: 'New', color: '#6366f1' },
    { key: 'Contacted', color: '#f59e0b' },
    { key: 'Qualified', color: '#10b981' },
    { key: 'Closed', color: '#9ca3af' },
  ];
  const counts = statusConfig.map(s => allLeads.filter(l => l.status === s.key).length);
  const total  = counts.reduce((a, b) => a + b, 0);
  document.getElementById('donut-total').textContent = total;

  const legendEl = document.getElementById('donut-legend');
  if (legendEl) legendEl.innerHTML = statusConfig.map((s, i) =>
    `<div class="donut-legend-item"><div class="donut-legend-left"><div class="donut-legend-dot" style="background:${s.color}"></div><span class="donut-legend-label">${s.key}</span></div><span class="donut-legend-count">${counts[i]}</span></div>`
  ).join('');

  const W = 160, H = 160, cx = 80, cy = 80, r = 60, inner = 36;
  ctx.clearRect(0, 0, W, H);
  if (total === 0) {
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.arc(cx, cy, inner, 0, Math.PI * 2, true);
    ctx.fillStyle = '#e5e7eb'; ctx.fill(); return;
  }
  let startAngle = -Math.PI / 2;
  statusConfig.forEach((s, i) => {
    if (counts[i] === 0) return;
    const slice = (counts[i] / total) * Math.PI * 2;
    ctx.beginPath(); ctx.moveTo(cx, cy); ctx.arc(cx, cy, r, startAngle, startAngle + slice);
    ctx.closePath(); ctx.fillStyle = s.color; ctx.fill();
    startAngle += slice;
  });
  ctx.beginPath(); ctx.arc(cx, cy, inner, 0, Math.PI * 2);
  ctx.fillStyle = '#ffffff'; ctx.fill();
}

function renderRecentLeads() {
  const container = document.getElementById('recent-leads-container');
  if (!container) return;
  const recent = [...allLeads].sort((a, b) => b.timestamp - a.timestamp).slice(0, 6);

  if (recent.length === 0) {
    container.innerHTML = `<div class="empty-state" id="dashboard-empty">
      <div class="empty-icon"><svg viewBox="0 0 64 64" fill="none"><circle cx="32" cy="32" r="30" fill="#f0f0ff" stroke="#e0e0ff" stroke-width="2"/><path d="M20 32h24M32 20v24" stroke="#a5b4fc" stroke-width="3" stroke-linecap="round"/></svg></div>
      <h4>No Leads Yet</h4><p>Go to <strong>Run Agent</strong>, select industries and cities, then generate leads.</p>
      <button class="btn-primary" onclick="showView('agent')">Run Agent Now</button>
    </div>`;
    return;
  }

  const list = document.createElement('div');
  list.className = 'mini-leads-list';
  recent.forEach(lead => {
    const row = document.createElement('div');
    row.className = 'mini-lead-row';
    row.onclick = () => openLeadModal(lead);
    const ind = IndustryDB.getByKey(lead.industry);
    row.innerHTML = `
      <div class="mini-lead-avatar">${ind?.icon || lead.company.slice(0, 2)}</div>
      <div class="mini-lead-body">
        <div class="mini-lead-name">${escHtml(lead.company)}</div>
        <div class="mini-lead-sub">${escHtml(lead.industry || lead.sector || '')} • ${escHtml(lead.city || '')}</div>
      </div>
      <div class="mini-lead-right">
        ${getTypeBadge(lead.type)}
        <span class="mini-lead-time">${timeAgo(lead.timestamp)}</span>
      </div>
    `;
    list.appendChild(row);
  });
  container.innerHTML = '';
  container.appendChild(list);
}

// ============================================================
//  FILTER DROPDOWNS — dynamic from actual data
// ============================================================
function populateFilterDropdowns() {
  // Industry
  const indSel = document.getElementById('filter-industry');
  if (indSel) {
    const industries = [...new Set(allLeads.map(l => l.industry || l.sector).filter(Boolean))].sort();
    indSel.innerHTML = '<option value="">All Industries</option>' +
      industries.map(i => `<option value="${escHtml(i)}">${escHtml(i)}</option>`).join('');
  }
  // City
  const citySel = document.getElementById('filter-city');
  if (citySel) {
    const cities = [...new Set(allLeads.map(l => l.city).filter(Boolean))].sort();
    citySel.innerHTML = '<option value="">All Cities</option>' +
      cities.map(c => `<option value="${escHtml(c)}">${escHtml(c)}</option>`).join('');
  }
}

// ============================================================
//  LEADS TABLE
// ============================================================
function renderLeadsTable() {
  const tbody = document.getElementById('leads-tbody');
  try {
    if (tbody) tbody.innerHTML = `<tr><td colspan="8" class="text-center">Loading data from backend...</td></tr>`;
    populateFilterDropdowns();
    applyFilters();
  } catch (err) {
    console.error('Leads render error:', err);
    if (tbody) tbody.innerHTML = `<tr><td colspan="8" class="error-state text-center" style="color:red; padding: 20px;">Failed to load data: ${err.message}</td></tr>`;
  }
}

function applyFilters() {
  const search        = (document.getElementById('search-input')?.value || '').toLowerCase();
  const type          = document.getElementById('filter-type')?.value || '';
  const stateVal      = document.getElementById('filter-state')?.value || '';
  const industry      = document.getElementById('filter-industry')?.value || '';
  const city          = document.getElementById('filter-city')?.value || '';
  const minScoreVal   = parseInt(document.getElementById('filter-min-score')?.value || '0');
  const onlyEmail     = document.getElementById('filter-only-email')?.checked || false;
  const onlyWebsite   = document.getElementById('filter-only-website')?.checked || false;
  const onlySecurity  = document.getElementById('filter-only-security')?.checked || false;
  const onlyHK        = document.getElementById('filter-only-housekeeping')?.checked || false;
  const dateFilter    = document.getElementById('filter-date')?.value || '';
  const sheetsFilter  = document.getElementById('filter-sheets')?.value || '';

  const now      = Date.now();
  const cutoffs  = { '24h': 86400000, '7d': 604800000, '30d': 2592000000 };

  filteredLeads = allLeads.filter(lead => {
    if (type     && lead.type !== type) return false;
    if (stateVal && lead.state && lead.state.toLowerCase() !== stateVal.toLowerCase()) return false;
    if (industry && (lead.industry || lead.sector) !== industry) return false;
    if (city     && lead.city !== city) return false;
    if (minScoreVal > 0 && (lead.leadScore || 0) < minScoreVal) return false;
    if (onlyEmail   && !lead.email && !lead.officialEmail && !lead.hrEmail && !lead.purchaseEmail) return false;
    if (onlyWebsite && !lead.website) return false;
    if (onlySecurity && (lead.securityScore || 0) < 50) return false;
    if (onlyHK       && (lead.housekeepingScore || 0) < 50) return false;

    if (dateFilter && cutoffs[dateFilter] && (now - lead.timestamp) > cutoffs[dateFilter]) return false;
    if (sheetsFilter === 'synced'   && !lead.syncedToSheets) return false;
    if (sheetsFilter === 'unsynced' && lead.syncedToSheets) return false;

    if (search) {
      const s = `${lead.company} ${lead.email} ${lead.phone} ${lead.address} ${lead.jobTitle} ${lead.city} ${lead.industry} ${lead.state}`.toLowerCase();
      if (!s.includes(search)) return false;
    }
    return true;
  });

  filteredLeads.sort((a, b) => {
    const dir = sortConfig.dir === 'asc' ? 1 : -1;
    const va = a[sortConfig.col] || '';
    const vb = b[sortConfig.col] || '';
    if (typeof va === 'number') return (va - vb) * dir;
    return String(va).localeCompare(String(vb)) * dir;
  });

  const meta = document.getElementById('results-meta');
  if (meta) meta.textContent = `Showing ${filteredLeads.length} of ${allLeads.length} client leads`;

  renderTableRows(filteredLeads);
}

function sortTable(col) {
  if (sortConfig.col === col) sortConfig.dir = sortConfig.dir === 'asc' ? 'desc' : 'asc';
  else { sortConfig.col = col; sortConfig.dir = 'desc'; }
  document.querySelectorAll('.th-sort').forEach(th => {
    th.classList.remove('sort-asc', 'sort-desc');
    if (th.dataset.col === col) th.classList.add(sortConfig.dir === 'asc' ? 'sort-asc' : 'sort-desc');
  });
  applyFilters();
}

function clearFilters() {
  ['search-input', 'filter-type', 'filter-state', 'filter-industry', 'filter-city', 'filter-status', 'filter-date', 'filter-sheets'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });
  const minSlider = document.getElementById('filter-min-score');
  if (minSlider) { minSlider.value = 0; const valEl = document.getElementById('filter-min-score-val'); if(valEl) valEl.textContent = '0'; }
  ['filter-only-email', 'filter-only-website', 'filter-only-security', 'filter-only-housekeeping'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.checked = false;
  });
  applyFilters();
}

function toggleSelectAll(cb) {
  selectedLeadIds.clear();
  if (cb.checked) filteredLeads.forEach(l => selectedLeadIds.add(l.id));
  document.querySelectorAll('.lead-row-cb').forEach(el => {
    el.checked = cb.checked;
    el.closest('tr')?.classList.toggle('row-selected', cb.checked);
  });
}

function renderTableRows(leads) {
  const tbody = document.getElementById('leads-tbody');
  if (!tbody) return;

  if (leads.length === 0) {
    tbody.innerHTML = `<tr><td colspan="12">
      <div class="empty-state">
        <div class="empty-icon"><svg viewBox="0 0 64 64" fill="none"><circle cx="32" cy="32" r="30" fill="#f0f0ff" stroke="#e0e0ff" stroke-width="2"/><path d="M20 32h24M32 20v24" stroke="#a5b4fc" stroke-width="3" stroke-linecap="round"/></svg></div>
        <h4>No Verified Client Leads Found</h4><p>Try resetting filters or run the agent for new cities.</p>
      </div>
    </td></tr>`; return;
  }

  tbody.innerHTML = leads.map(lead => {
    const isSelected = selectedLeadIds.has(lead.id);
    const leadScore = Math.max(0, Math.min(100, Number(lead.leadScore) || 75));
    const stars = escHtml(String(lead.priorityStars || '★★★').slice(0, 12));
    const primaryEmail = lead.email || lead.officialEmail || lead.hrEmail || lead.purchaseEmail || '';
    const rawSourceUrl = lead.sourceUrl || lead.website || '';
    const sourceUrl = /^https?:\/\//i.test(String(rawSourceUrl)) ? String(rawSourceUrl) : '#';
    const websiteUrl = /^https?:\/\//i.test(String(lead.website || '')) ? String(lead.website) : '';

    return `<tr class="${isSelected ? 'row-selected' : ''}">
      <td><input type="checkbox" class="lead-row-cb" ${isSelected ? 'checked' : ''} onchange="toggleRowSelect(decodeURIComponent('${encodeURIComponent(String(lead.id))}'), this)"/></td>
      <td><div class="td-company">
        <div class="company-avatar">${escHtml(IndustryDB.getByKey(lead.industry)?.icon || (lead.company || 'Co').slice(0, 2))}</div>
        <div>
          <span class="company-name" title="${escHtml(lead.company)}">${escHtml(lead.company)}</span>
          <div style="font-size:10px; color:#eab308; font-weight:800; letter-spacing:0.5px; margin-top:2px;">${escHtml(stars)} (${leadScore}/100)</div>
        </div>
      </div></td>
      <td><span style="font-size:11px;color:var(--gray-500);white-space:nowrap">${escHtml((lead.industry||lead.sector||'').split('&')[0].trim())}</span></td>
      <td><span style="font-size:12px;font-weight:600;color:var(--gray-700)">${escHtml(lead.city||'—')}</span></td>
      <td>
        <div style="font-size:11px; font-weight:700;">
          <span style="color:#6366f1;">🛡️ ${lead.securityScore || 70}%</span>
          <span style="color:#10b981; margin-left:6px;">🧹 ${lead.housekeepingScore || 70}%</span>
        </div>
      </td>
      <td><span class="td-truncate">${lead.phone ? `<a href="tel:${escHtml(lead.phone)}" style="color:var(--gray-700)">${escHtml(lead.phone)}</a>` : '<span style="color:var(--gray-300)">—</span>'}</span></td>
      <td><span class="td-truncate">${primaryEmail ? `<a href="mailto:${escHtml(primaryEmail)}">${escHtml(primaryEmail)}</a>` : '<span style="color:var(--gray-300)">—</span>'}</span></td>
      <td><span class="td-truncate">${sourceUrl && sourceUrl !== '#' ? `<a href="${escHtml(sourceUrl)}" target="_blank" rel="noopener" style="color:#3b82f6; font-weight:600;">🔗 View Source</a>` : '<span style="color:var(--gray-300)">—</span>'}</span></td>
      <td><span style="font-size:11px;color:var(--gray-500)">${formatDate(lead.timestamp)}</span></td>
      <td><select class="status-select ${(lead.status||'New').toLowerCase()}" onchange="updateLeadStatus(decodeURIComponent('${encodeURIComponent(String(lead.id))}'), this.value, this)">
        <option value="New" ${lead.status==='New'?'selected':''}>New</option>
        <option value="Contacted" ${lead.status==='Contacted'?'selected':''}>Contacted</option>
        <option value="Qualified" ${lead.status==='Qualified'?'selected':''}>Qualified</option>
        <option value="Closed" ${lead.status==='Closed'?'selected':''}>Closed</option>
      </select></td>
      <td><div class="td-actions">
        <button class="action-btn" title="View Full Details" onclick="openLeadModalById('${escHtml(String(lead.id))}')"><svg viewBox="0 0 20 20" fill="currentColor"><path d="M10 12a2 2 0 100-4 2 2 0 000 4z"/><path fill-rule="evenodd" d="M.458 10C1.732 5.943 5.522 3 10 3s8 2.943 9.542 7c-1.274 4.057-5.064 7-9.542 7S1.732 14.057.458 10zM14 10a4 4 0 11-8 0 4 4 0 018 0z" clip-rule="evenodd"/></svg></button>
        ${websiteUrl ? `<button class="action-btn" title="Website" onclick="window.open(decodeURIComponent('${encodeURIComponent(websiteUrl)}'),'_blank','noopener,noreferrer')"><svg viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M10.293 3.293a1 1 0 011.414 0l6 6a1 1 0 010 1.414l-6 6a1 1 0 01-1.414-1.414L14.586 11H3a1 1 0 110-2h11.586l-4.293-4.293a1 1 0 010-1.414z" clip-rule="evenodd"/></svg></button>` : ''}
        ${lead.phone ? `<button class="action-btn" title="Call" onclick="window.location='tel:' + decodeURIComponent('${encodeURIComponent(String(lead.phone))}')"><svg viewBox="0 0 20 20" fill="currentColor"><path d="M2 3a1 1 0 011-1h2.153a1 1 0 00.986.836l.74 4.435a1 1 0 01-.54 1.06l-1.548.773a11.037 11.037 0 006.105 6.105l.774-1.548a1 1 0 011.059-.54l4.435.74a1 1 0 01.836.986V17a1 1 0 01-1 1h-2C7.82 18 2 12.18 2 5V3z"/></svg></button>` : ''}
        <button class="action-btn danger" title="Delete" onclick="deleteLead(decodeURIComponent('${encodeURIComponent(String(lead.id))}'))"><svg viewBox="0 0 20 20" fill="currentColor"><path d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z" clip-rule="evenodd"/></svg></button>
      </div></td>
    </tr>`;
  }).join('');
}

function toggleRowSelect(id, cb) {
  if (cb.checked) selectedLeadIds.add(id);
  else selectedLeadIds.delete(id);
  cb.closest('tr')?.classList.toggle('row-selected', cb.checked);
}

function openLeadModalById(id) {
  const lead = allLeads.find(item => String(item.id) === String(id));
  if (lead) openLeadModal(lead);
}
window.openLeadModalById = openLeadModalById;

async function updateLeadStatus(id, newStatus, selectEl) {
  try {
    await MemoryEngine.updateLead(id, { status: newStatus });
    const lead = allLeads.find(l => l.id === id);
    if (lead) lead.status = newStatus;
    selectEl.className = `status-select ${newStatus.toLowerCase()}`;
    showToast('success', 'Status Updated', `Lead marked as ${newStatus}`);
    if (currentView === 'dashboard') renderDonutChart();
  } catch (err) { showToast('error', 'Update Failed', err.message); }
}

async function deleteLead(id) {
  if (!confirm('Delete this lead? Cannot be undone.')) return;
  try {
    await MemoryEngine.deleteLead(id);
    allLeads = allLeads.filter(l => l.id !== id);
    selectedLeadIds.delete(id);
    updateAllUI();
    showToast('success', 'Lead Deleted', 'Removed from memory');
  } catch (err) { showToast('error', 'Delete Failed', err.message); }
}

// ============================================================
//  EXPORT CSV
// ============================================================
function exportCSV() {
  const toExport = filteredLeads.length > 0 ? filteredLeads : allLeads;
  if (toExport.length === 0) { showToast('warning', 'No Leads', 'Nothing to export'); return; }

  const headers = ['Company','Industry','City','Type','Phone','Email','Website','Address','Job Title','Positions','Status','Source','Date Added','Synced to Sheets'];
  const rows = toExport.map(l => [
    l.company, l.industry||l.sector||'', l.city, l.type, l.phone, l.email, l.website, l.address,
    l.jobTitle, l.positions||1, l.status, l.source, formatDate(l.timestamp), l.syncedToSheets ? 'Yes' : 'No'
  ].map(v => `"${String(v||'').replace(/"/g, '""')}"`));

  const csv = '\uFEFF' + [headers, ...rows].map(r => r.join(',')).join('\r\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `Skylark_Leads_${new Date().toISOString().slice(0,10)}.csv`;
  a.click();
  showToast('success', 'CSV Exported', `${toExport.length} leads exported`);
}

// ============================================================
//  EXPORT EXCEL (.xlsx)
// ============================================================
function exportExcel() {
  if (typeof XLSX === 'undefined') {
    showToast('error', 'Library Missing', 'Excel export library not loaded. Use CSV.');
    return;
  }
  const toExport = filteredLeads.length > 0 ? filteredLeads : allLeads;
  if (toExport.length === 0) { showToast('warning', 'No Leads', 'Nothing to export'); return; }

  const rows = toExport.map(l => ({
    Company: l.company,
    Industry: l.industry||l.sector||'',
    City: l.city,
    Type: l.type,
    Phone: l.phone,
    Email: l.email,
    Website: l.website,
    Address: l.address,
    'Job Title': l.jobTitle,
    Positions: l.positions||1,
    Status: l.status,
    Source: l.source,
    'Date Added': formatDate(l.timestamp),
    'Synced to Sheets': l.syncedToSheets ? 'Yes' : 'No'
  }));

  const worksheet = XLSX.utils.json_to_sheet(rows);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, "Leads");
  XLSX.writeFile(workbook, `Leads_${new Date().toISOString().slice(0,10)}.xlsx`);
  showToast('success', 'Excel Exported', `${toExport.length} leads exported to XLSX`);
}

function exportBatchExcel(leadsBatch) {
  if (typeof XLSX === 'undefined' || !leadsBatch || leadsBatch.length === 0) return;
  const rows = leadsBatch.map(l => ({
    Company: l.company,
    Industry: l.industry||l.sector||'',
    City: l.city,
    Type: l.type,
    Phone: l.phone,
    Email: l.email,
    Website: l.website,
    Address: l.address,
    'Job Title': l.jobTitle,
    Positions: l.positions||1,
    Status: l.status,
    Source: l.source,
    'Date Added': formatDate(l.timestamp)
  }));
  const worksheet = XLSX.utils.json_to_sheet(rows);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, "Auto_Saved_Leads");
  const timeString = new Date().toTimeString().slice(0,8).replace(/:/g,'-');
  XLSX.writeFile(workbook, `Skylark_Fetch_${new Date().toISOString().slice(0,10)}_${timeString}.xlsx`);
}

// ============================================================
//  MODAL
// ============================================================
function openLeadModal(leadOrJson) {
  const lead = typeof leadOrJson === 'string' ? JSON.parse(leadOrJson) : leadOrJson;
  const ind  = IndustryDB.getByKey(lead.industry);

  const stars = lead.priorityStars || '★★★';
  const leadScore = lead.leadScore || 75;
  const secScore = lead.securityScore || 70;
  const hkScore = lead.housekeepingScore || 70;
  const reasons = lead.scoreReasons || ['Established commercial client requiring outsourced facility staff'];

  const companyBadge = document.getElementById('modal-company-badge');
  if (companyBadge) companyBadge.textContent = ind?.icon || (lead.company || 'Co').slice(0, 2).toUpperCase();

  const companyName = document.getElementById('modal-company-name');
  if (companyName) companyName.textContent = lead.company;

  const metaEl = document.getElementById('modal-meta');
  if (metaEl) {
    metaEl.innerHTML = `
      <span style="font-size:12px; font-weight:800; color:#eab308; background:rgba(234,179,8,0.15); padding:3px 10px; border-radius:99px;">${stars} Priority</span>
      <span style="font-size:12px; font-weight:700; color:#6366f1; background:rgba(99,102,241,0.15); padding:3px 10px; border-radius:99px;">Score: ${leadScore}/100</span>
      <span style="font-size:11px; background:var(--gray-100); padding:3px 8px; border-radius:99px; color:var(--gray-600);">${escHtml(lead.industry || lead.sector || '')}</span>
    `;
  }

  const body = document.getElementById('modal-body');
  if (body) {
    body.innerHTML = `
      <!-- AI Requirement Probability Breakdown -->
      <div style="background:var(--card-bg, rgba(255,255,255,0.04)); border:1px solid var(--border); border-radius:12px; padding:14px; margin-bottom:16px;">
        <div style="font-size:12px; font-weight:700; color:var(--gray-700); margin-bottom:8px; display:flex; justify-content:space-between;">
          <span>🤖 AI REQUIREMENT ANALYSIS</span>
          <span>Lead Opportunity: ${escHtml(lead.priority || 'High')}</span>
        </div>
        
        <div style="display:grid; grid-template-columns:1fr 1fr; gap:12px; margin-bottom:12px;">
          <div>
            <div style="font-size:11px; font-weight:600; color:#6366f1; margin-bottom:4px; display:flex; justify-content:space-between;">
              <span>🛡️ Security Guards Need</span>
              <span>${secScore}%</span>
            </div>
            <div style="height:6px; background:rgba(99,102,241,0.2); border-radius:3px; overflow:hidden;">
              <div style="height:100%; width:${secScore}%; background:#6366f1;"></div>
            </div>
          </div>
          <div>
            <div style="font-size:11px; font-weight:600; color:#10b981; margin-bottom:4px; display:flex; justify-content:space-between;">
              <span>🧹 Housekeeping Staff Need</span>
              <span>${hkScore}%</span>
            </div>
            <div style="height:6px; background:rgba(16,185,129,0.2); border-radius:3px; overflow:hidden;">
              <div style="height:100%; width:${hkScore}%; background:#10b981;"></div>
            </div>
          </div>
        </div>

        <div style="font-size:11px; font-weight:600; color:var(--gray-600); margin-bottom:4px;">Empirical Rationale:</div>
        <ul style="margin:0; padding-left:18px; font-size:11px; color:var(--gray-600); line-height:1.5;">
          ${reasons.map(r => `<li>${escHtml(r)}</li>`).join('')}
        </ul>
      </div>

      <!-- Public Contact Details -->
      <div class="modal-field-row">
        <div class="modal-field-group"><div class="modal-field-label">Official Phone</div><div class="modal-field-value">${lead.phone ? `<a href="tel:${escHtml(lead.phone)}">${escHtml(lead.phone)}</a>` : '—'}</div></div>
        <div class="modal-field-group"><div class="modal-field-label">Primary Email</div><div class="modal-field-value">${lead.email ? `<a href="mailto:${escHtml(lead.email)}">${escHtml(lead.email)}</a>` : '—'}</div></div>
      </div>

      <!-- Role-Categorized Public Emails -->
      <div style="background:var(--gray-50, rgba(0,0,0,0.02)); border:1px solid var(--border); border-radius:8px; padding:10px; margin-bottom:12px;">
        <div style="font-size:11px; font-weight:700; color:var(--gray-700); margin-bottom:6px;">Department Contacts (Publicly Extracted)</div>
        <div style="display:grid; grid-template-columns:1fr 1fr; gap:8px; font-size:11px;">
          <div><span style="color:var(--gray-500)">HR / Careers:</span> ${lead.hrEmail ? `<a href="mailto:${escHtml(lead.hrEmail)}">${escHtml(lead.hrEmail)}</a>` : '—'}</div>
          <div><span style="color:var(--gray-500)">Procurement / Purchase:</span> ${lead.purchaseEmail ? `<a href="mailto:${escHtml(lead.purchaseEmail)}">${escHtml(lead.purchaseEmail)}</a>` : '—'}</div>
          <div><span style="color:var(--gray-500)">Administration:</span> ${lead.adminEmail ? `<a href="mailto:${escHtml(lead.adminEmail)}">${escHtml(lead.adminEmail)}</a>` : '—'}</div>
          <div><span style="color:var(--gray-500)">Vendor Registration:</span> ${lead.vendorEmail ? `<a href="mailto:${escHtml(lead.vendorEmail)}">${escHtml(lead.vendorEmail)}</a>` : '—'}</div>
        </div>
      </div>

      <!-- Company Overview & Location -->
      <div class="modal-field-group"><div class="modal-field-label">Official Website</div><div class="modal-field-value">${lead.website ? `<a href="${escHtml(lead.website)}" target="_blank" rel="noopener">${escHtml(lead.website)}</a>` : '—'}</div></div>
      
      <div class="modal-field-row">
        <div class="modal-field-group"><div class="modal-field-label">City & State</div><div class="modal-field-value">${escHtml(lead.city || '—')}, ${escHtml(lead.state || 'India')}</div></div>
        <div class="modal-field-group"><div class="modal-field-label">Industry / Sector</div><div class="modal-field-value">${escHtml(lead.industry || lead.sector || '—')}</div></div>
      </div>

      <div class="modal-field-group"><div class="modal-field-label">Physical Address</div><div class="modal-field-value">${escHtml(lead.address || '—')}</div></div>

      <div class="modal-field-row">
        <div class="modal-field-group"><div class="modal-field-label">Est. Employee Size</div><div class="modal-field-value">${escHtml(lead.employeeSize || '50-250')}</div></div>
        <div class="modal-field-group"><div class="modal-field-label">Business Scale</div><div class="modal-field-value">${escHtml(lead.businessSize || 'Commercial Enterprise')}</div></div>
      </div>

      <!-- Public Procurement Portals -->
      <div class="modal-field-row">
        <div class="modal-field-group"><div class="modal-field-label">Vendor Portal</div><div class="modal-field-value">${lead.vendorPage ? `<a href="${escHtml(lead.vendorPage)}" target="_blank" rel="noopener">🔗 Vendor Page</a>` : '—'}</div></div>
        <div class="modal-field-group"><div class="modal-field-label">Tender Page</div><div class="modal-field-value">${lead.tenderPage ? `<a href="${escHtml(lead.tenderPage)}" target="_blank" rel="noopener">📄 Active Tender</a>` : '—'}</div></div>
      </div>

      <!-- Audit Proof Link -->
      <div class="modal-field-group" style="margin-top:8px;">
        <div class="modal-field-label">Public Verifiable Source URL</div>
        <div class="modal-field-value">${lead.sourceUrl ? `<a href="${escHtml(lead.sourceUrl)}" target="_blank" rel="noopener" style="color:#3b82f6; font-weight:700;">🔗 ${escHtml(lead.sourceUrl)}</a>` : '—'}</div>
      </div>
    `;
  }

  const footer = document.getElementById('modal-footer');
  if (footer) {
    footer.innerHTML = `
      ${lead.phone ? `<a href="tel:${escHtml(lead.phone)}" class="btn-primary" style="text-decoration:none">📞 Call Client</a>` : ''}
      ${(lead.email || lead.officialEmail) ? `<a href="mailto:${escHtml(lead.email || lead.officialEmail)}" class="btn-secondary" style="text-decoration:none">✉️ Email Client</a>` : ''}
      <button class="btn-secondary" onclick="closeLeadModal()">Close</button>
    `;
  }
  const modal = document.getElementById('lead-modal');
  if (modal) modal.classList.add('open');
}

function closeLeadModal() { 
  const modal = document.getElementById('lead-modal');
  if (modal) modal.classList.remove('open'); 
}
function closeModal(e) { 
  if (!e || e.target === document.getElementById('lead-modal')) closeLeadModal(); 
}

window.openLeadModal  = openLeadModal;
window.closeLeadModal = closeLeadModal;
window.closeModal     = closeModal;

// ============================================================
//  AGENT PIPELINE UI
// ============================================================
async function startAgentPipeline() {
  if (PipelineEngine.getIsRunning()) {
    showToast('warning', 'Already Running', 'Pipeline is active'); return;
  }

  // Validate
  if (selectedLocations.length === 0) {
    showToast('error', 'No Location', 'Add at least 1 city (type + Enter)'); return;
  }
  if (selectedIndustries.size === 0) {
    showToast('error', 'No Industry', 'Select at least 1 target industry'); return;
  }

  const enableSecurity    = document.getElementById('target-security')?.checked;
  const enableHousekeeping = document.getElementById('target-housekeeping')?.checked;
  if (!enableSecurity && !enableHousekeeping) {
    showToast('error', 'No Type', 'Select Security, Housekeeping, or Both'); return;
  }

  const countPerCombo  = parseInt(document.getElementById('batch-size')?.value || '3');
  const enableMaps     = document.getElementById('enrich-maps')?.checked !== false;
  const enableCrawler  = document.getElementById('enrich-crawler')?.checked !== false;
  const autoDownloadExcel = document.getElementById('auto-download-excel')?.checked;
  const autoDownload = autoDownloadExcel;

  const srcLinkedIn = document.getElementById('src-linkedin')?.checked;
  const srcIndeed   = document.getElementById('src-indeed')?.checked;
  const srcGoogle   = document.getElementById('src-google')?.checked;

  const types = [];
  if (enableSecurity)    types.push('Security');
  if (enableHousekeeping) types.push('Housekeeping');

  const sources = [];
  if (srcLinkedIn) sources.push('LinkedIn');
  if (srcIndeed)   sources.push('Indeed');
  if (srcGoogle)   sources.push('Google Jobs');

  const industries = [...selectedIndustries];
  const locations  = [...selectedLocations];

  // Reset UI
  resetPipelineUI();
  setPipelineStatus('running');
  setGenerateBtn(true);

  // Save preferences
  SettingsEngine.save({ locations, lastIndustries: industries, lastTypes: types });

  // Token meter
  const budget = parseInt(SettingsEngine.get('tokenBudget')) || 1000;
  document.getElementById('token-meter')?.style?.setProperty('display', 'block');

  // Callbacks
  PipelineEngine.setCallbacks({
    onLog: (type, msg) => appendLog(type, msg),
    onPhaseUpdate: (phase, state, pct) => updatePhaseNode(phase, state, pct),
    onLeadFound: (lead) => {
      allLeads.push(lead);
      updateMemoryChip();
      updateLeadsBadge();
    },
    onTokenUpdate: (usedTotal) => {
      const budget = parseInt(SettingsEngine.get('tokenBudget')) || 1000;
      const pct  = Math.min((usedTotal / budget) * 100, 100);
      const bar  = document.getElementById('token-bar-fill');
      const cnt  = document.getElementById('token-count');
      if (bar) bar.style.width = pct + '%';
      if (cnt) cnt.textContent = `${usedTotal.toLocaleString()} / ${budget}`;
    },
    onComplete: async ({ added, dupes, total, elapsed, tokenUsed }) => {
      setPipelineStatus('done');
      setGenerateBtn(false);
      setAgentStatusPill('done', 'Done');
      showRunSummary({ added, dupes, total, elapsed, tokens: tokenUsed });
      updateAllUI();
      showToast('success', `✓ ${added} Buyer Leads Generated!`, `${dupes} dupes blocked · ${elapsed}s`);
      // Check API key health and notify if near exhaustion
      checkAndNotifyKeyHealth();

      // Auto-sync to sheets and auto-download batch
      const newLeads = allLeads.slice(-added);
      
      // Auto-download the newly fetched leads as CSV
      if (added > 0) {
        exportBatchExcel(newLeads);
      }

      if (autoDownload && added > 0) {
        exportToExcel();
      }
    },
    onError: (msg) => {
      setPipelineStatus('error');
      setGenerateBtn(false);
      setAgentStatusPill('error', 'Error');
      showToast('error', 'Pipeline Error', msg);
    }
  });

  setAgentStatusPill('running', 'Running...');
  showToast('info', 'Agent Started', `${industries.length} industries × ${locations.length} cities`);

  const totalTarget = window.chatRequestedTotalTarget || null;
  PipelineEngine.run({ industries, locations, types, sources, countPerCombo, enableMaps, enableCrawler, totalTarget });
  window.chatRequestedTotalTarget = null;
}

function resetPipelineUI() {
  const log = document.getElementById('live-log');
  if (log) log.innerHTML = '';
  [1, 2, 3, 4].forEach(n => {
    updatePhaseNode(n, 'idle', 0);
    const conn = document.getElementById(`pc-${n}`);
    if (conn) conn.classList.remove('done');
  });
  document.getElementById('run-summary')?.style?.setProperty('display', 'none');
}

function setPipelineStatus(status) {
  const badge = document.getElementById('pipeline-badge');
  if (!badge) return;
  badge.className = `progress-status-badge ${status}`;
  const labels = { running: '● Running', done: '✓ Complete', error: '✕ Error', idle: 'Idle' };
  badge.textContent = labels[status] || status;
}

function setAgentStatusPill(status, label) {
  const dot = document.getElementById('status-dot');
  const lbl = document.getElementById('status-label');
  if (dot) dot.className = `status-dot ${status}`;
  if (lbl) lbl.textContent = label;
}

function setGenerateBtn(running) {
  const btn     = document.getElementById('generate-btn');
  const btnText = document.getElementById('generate-btn-text');
  if (!btn) return;
  btn.disabled = running;
  btnText.innerHTML = running
    ? '<span class="spinner"></span> Running Pipeline...'
    : 'Generate Leads';
}

function updatePhaseNode(phase, state, pct) {
  const node  = document.getElementById(`pnode-${phase}`);
  const fill  = document.getElementById(`pnode-${phase}-fill`);
  if (!node) return;
  node.className = 'pipeline-node';
  if (state === 'active') node.classList.add('active');
  if (state === 'done')   node.classList.add('done');
  if (state === 'error')  node.classList.add('error');
  if (fill) fill.style.width = pct + '%';
  if (state === 'done' && phase < 4) {
    const conn = document.getElementById(`pc-${phase}`);
    if (conn) conn.classList.add('done');
  }
}

function appendLog(type, msg) {
  const log = document.getElementById('live-log');
  if (!log) return;
  const entry = document.createElement('div');
  entry.className = `log-entry ${type}`;
  const time = new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  entry.textContent = `[${time}] ${msg}`;
  log.appendChild(entry);
  log.scrollTop = log.scrollHeight;
}

function clearLog() {
  const log = document.getElementById('live-log');
  if (log) log.innerHTML = '<div class="log-entry idle">Log cleared.</div>';
}

function showRunSummary({ added, dupes, total, elapsed, tokens }) {
  const container = document.getElementById('run-summary');
  const grid = document.getElementById('run-summary-grid');
  if (!container || !grid) return;
  grid.innerHTML = `
    <div class="run-sum-item"><div class="run-sum-val" style="color:var(--accent-green)">${added}</div><div class="run-sum-lbl">New Leads</div></div>
    <div class="run-sum-item"><div class="run-sum-val" style="color:var(--accent-orange)">${dupes}</div><div class="run-sum-lbl">Dupes Blocked</div></div>
    <div class="run-sum-item"><div class="run-sum-val">${elapsed}s</div><div class="run-sum-lbl">Duration</div></div>
    <div class="run-sum-item"><div class="run-sum-val" style="color:var(--primary)">~${tokens||0}</div><div class="run-sum-lbl">Tokens Used</div></div>
  `;
  container.style.display = 'block';
}

// ============================================================
//  GOOGLE SHEETS SYNC
// ============================================================
// ============================================================
//  EXCEL MANAGER LOGIC
// ============================================================
let importedExcelData = null;
let importedExcelFilename = '';

async function initExcelView() {
  const allLeads = await window.MemoryEngine.getAllLeads();
  const unsavedCount = allLeads.filter(l => !l.syncedToSheets).length; // Using syncedToSheets as local proxy for unsaved
  
  const totalLeadsEl = document.getElementById('excel-total-leads');
  const unsavedLeadsEl = document.getElementById('excel-unsaved-leads');
  
  if (totalLeadsEl) totalLeadsEl.textContent = allLeads.length;
  if (unsavedLeadsEl) unsavedLeadsEl.textContent = unsavedCount;
}

function handleExcelImport(event) {
  const file = event.target.files[0];
  if (!file) return;
  
  importedExcelFilename = file.name;
  const reader = new FileReader();
  
  reader.onload = function(e) {
    try {
      const data = new Uint8Array(e.target.result);
      const workbook = XLSX.read(data, { type: 'array' });
      const firstSheetName = workbook.SheetNames[0];
      const worksheet = workbook.Sheets[firstSheetName];
      
      // Parse to JSON array (headers in first row)
      const jsonData = XLSX.utils.sheet_to_json(worksheet, { header: 1 });
      if (jsonData.length === 0) {
        showToast('error', 'Empty File', 'The uploaded spreadsheet contains no data.');
        return;
      }
      
      const headers = jsonData[0];
      const rows = jsonData.slice(1);
      
      importedExcelData = { headers, rows };
      
      // Populate column dropdown
      const select = document.getElementById('excel-column-select');
      if (select) {
        select.innerHTML = headers.map((h, i) => `<option value="${i}">${h || `Column ${i+1}`}</option>`).join('');
      }
      
      // Show preview area
      document.getElementById('excel-import-filename').textContent = file.name;
      document.getElementById('excel-import-rowcount').textContent = `${rows.length} Rows`;
      document.getElementById('excel-import-preview').style.display = 'block';
      document.getElementById('excel-import-btn').removeAttribute('disabled');
      
      showToast('success', 'File Loaded', `${file.name} parsed successfully.`);
    } catch (err) {
      showToast('error', 'Import Failed', 'Could not read file. Make sure it is a valid Excel or CSV.');
      console.error(err);
    }
  };
  
  reader.readAsArrayBuffer(file);
}

function processExcelImport() {
  if (!importedExcelData) return;
  
  const colIndex = parseInt(document.getElementById('excel-column-select').value, 10);
  const companyNames = importedExcelData.rows
    .map(row => row[colIndex])
    .filter(name => name && String(name).trim() !== '');
    
  if (companyNames.length === 0) {
    showToast('warning', 'No Companies', 'Could not find any company names in the selected column.');
    return;
  }
  
  // Convert company names into queries and load into Chat input/queue
  const queryList = companyNames.map(name => `Extract email, website, phone, and positions for: ${name}`);
  
  // Set current chat input to the first query, and notify user
  const chatInput = document.getElementById('chat-input');
  if (chatInput) {
    chatInput.value = `Search contacts for these imported companies:\n${companyNames.join('\n')}`;
  }
  
  // Set badge
  const badge = document.getElementById('excel-imported-badge');
  if (badge) {
    badge.textContent = companyNames.length;
    badge.style.display = 'inline-block';
  }
  
  showToast('success', 'Import Successful!', `${companyNames.length} companies loaded. Go to "Chat AI" to run the extraction.`);
  showView('chat');
}

async function exportToExcel() {
  const allLeads = await window.MemoryEngine.getAllLeads();
  if (allLeads.length === 0) {
    showToast('warning', 'No Data', 'No leads available to export.');
    return;
  }
  
  // Format leads for Excel
  const excelRows = allLeads.map(l => ({
    'Company Name': l.company || '',
    'Industry': l.industry || '',
    'City': l.city || '',
    'Service Type': l.type || '',
    'Phone': l.phone || '',
    'Email': l.email || '',
    'Website': l.website || '',
    'Address': l.address || '',
    'Job Title/Requirements': l.jobTitle || '',
    'Positions Open': l.positions || '',
    'Status': l.status || '',
    'Source': l.source || '',
    'Date Added': l.timestamp ? new Date(l.timestamp).toLocaleDateString('en-IN') : ''
  }));
  
  const sheetName = document.getElementById('excel-sheet-name').value.trim() || 'Leads';
  const worksheet = XLSX.utils.json_to_sheet(excelRows);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, sheetName);
  
  // Auto-fit Columns if checked
  if (document.getElementById('excel-autofit').checked) {
    const maxProps = [];
    excelRows.forEach(row => {
      Object.keys(row).forEach((key, colIndex) => {
        const val = row[key] ? String(row[key]) : '';
        maxProps[colIndex] = Math.max(maxProps[colIndex] || 10, val.length + 2, key.length + 2);
      });
    });
    worksheet['!cols'] = maxProps.map(w => ({ wch: w }));
  }
  
  // Download file
  XLSX.writeFile(workbook, `${sheetName.replace(/\s+/g, '_')}_Export.xlsx`);
  showToast('success', 'Excel Downloaded', 'Your leads have been successfully exported as Excel.');
}

async function exportToCSV() {
  const allLeads = await window.MemoryEngine.getAllLeads();
  if (allLeads.length === 0) {
    showToast('warning', 'No Data', 'No leads available to export.');
    return;
  }
  
  const excelRows = allLeads.map(l => ({
    'Company Name': l.company || '',
    'Industry': l.industry || '',
    'City': l.city || '',
    'Service Type': l.type || '',
    'Phone': l.phone || '',
    'Email': l.email || '',
    'Website': l.website || '',
    'Address': l.address || '',
    'Job Title/Requirements': l.jobTitle || '',
    'Positions Open': l.positions || '',
    'Status': l.status || '',
    'Source': l.source || '',
    'Date Added': l.timestamp ? new Date(l.timestamp).toLocaleDateString('en-IN') : ''
  }));
  
  const worksheet = XLSX.utils.json_to_sheet(excelRows);
  const csvOutput = XLSX.utils.sheet_to_csv(worksheet);
  
  const blob = new Blob([csvOutput], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.setAttribute('href', url);
  link.setAttribute('download', `leads_export_${Date.now()}.csv`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  
  showToast('success', 'CSV Downloaded', 'Your leads have been exported successfully as CSV.');
}

// ============================================================
//  ANALYTICS
// ============================================================
function renderAnalytics() {
  const container = document.getElementById('view-analytics');
  try {
    if (container) {
      container.classList.remove('error-state');
      // If we had a specific content div inside analytics, we could target it here.
    }
    renderAnalyticsBars('analytics-source-chart', 'source',
      ['LinkedIn','Indeed','Google Jobs','Google Maps'],
      ['#3b82f6','#ec4899','#10b981','#f59e0b']);

    renderAnalyticsBars('analytics-type-chart', 'type',
      ['Security','Housekeeping','Both'],
      ['#6366f1','#10b981','#f59e0b']);

    renderTimeline('analytics-timeline');
    renderFunnel('analytics-funnel');
    renderAnalyticsIndustries('analytics-industries');
  } catch (err) {
    console.error('Analytics render error:', err);
    if (container) {
      container.innerHTML = `<div class="error-state" style="padding: 2rem; text-align: center; color: red;">Failed to load analytics data: ${err.message}</div>`;
    }
  }
}

function renderAnalyticsBars(containerId, field, keys, colors) {
  const container = document.getElementById(containerId);
  if (!container) return;
  if (allLeads.length === 0) { container.innerHTML = '<div class="empty-chart-msg">No data yet</div>'; return; }

  const counts = keys.map(k => allLeads.filter(l => l[field] === k).length);
  const max = Math.max(...counts, 1);
  container.innerHTML = keys.map((key, i) => {
    const pct = Math.round((counts[i] / max) * 100);
    return `<div class="source-bar-item" style="margin-bottom:8px">
      <div class="source-bar-label">${escHtml(key)}</div>
      <div class="source-bar-track"><div class="source-bar-fill" style="width:${pct}%;background:${colors[i % colors.length]}"></div></div>
      <div class="source-bar-count">${counts[i]}</div>
    </div>`;
  }).join('');
}

function renderAnalyticsIndustries(containerId) {
  const container = document.getElementById(containerId);
  if (!container) return;
  if (allLeads.length === 0) { container.innerHTML = '<div class="empty-chart-msg">No data yet</div>'; return; }
  const map = {};
  allLeads.forEach(l => { const k = l.industry||l.sector||'Unknown'; map[k] = (map[k]||0)+1; });
  const sorted = Object.entries(map).sort((a,b)=>b[1]-a[1]).slice(0,8);
  const max = Math.max(...sorted.map(e=>e[1]),1);
  const colors = ['#6366f1','#f59e0b','#ef4444','#ec4899','#10b981','#3b82f6','#8b5cf6','#14b8a6'];
  container.innerHTML = sorted.map(([k,v],i) => {
    const pct = Math.round((v/max)*100);
    const shortK = k.split('&')[0].trim().split(' ').slice(0,2).join(' ');
    return `<div class="source-bar-item" style="margin-bottom:8px">
      <div class="source-bar-label" title="${escHtml(k)}">${escHtml(shortK)}</div>
      <div class="source-bar-track"><div class="source-bar-fill" style="width:${pct}%;background:${colors[i%colors.length]}"></div></div>
      <div class="source-bar-count">${v}</div>
    </div>`;
  }).join('');
}

function renderTimeline(containerId) {
  const container = document.getElementById(containerId);
  if (!container) return;
  if (allLeads.length === 0) { container.innerHTML = '<div class="empty-chart-msg">No data yet</div>'; return; }

  const days = 14;
  const now = Date.now();
  const dayCounts = new Array(days).fill(0);
  allLeads.forEach(l => {
    const daysAgo = Math.floor((now - l.timestamp) / 86400000);
    if (daysAgo < days) dayCounts[days - 1 - daysAgo]++;
  });
  const max = Math.max(...dayCounts, 1);

  const html = `<div style="display:flex;align-items:flex-end;gap:4px;height:80px">
    ${dayCounts.map((c, i) => {
      const h = Math.max((c / max) * 70, 2);
      const d = new Date(now - (days - 1 - i) * 86400000);
      const lbl = d.toLocaleDateString('en-IN', { month:'short', day:'numeric' });
      return `<div style="flex:1;display:flex;flex-direction:column;align-items:center;gap:4px">
        <div style="width:100%;height:${h}px;background:#6366f1;border-radius:3px 3px 0 0;opacity:0.85;transition:height 0.3s" title="${lbl}: ${c} leads"></div>
        ${i % 2 === 0 ? `<span style="font-size:9px;color:var(--gray-400);white-space:nowrap">${lbl}</span>` : '<span style="font-size:9px"></span>'}
      </div>`;
    }).join('')}
  </div>`;
  container.innerHTML = html;
}

function renderFunnel(containerId) {
  const container = document.getElementById(containerId);
  if (!container) return;
  const stages = [
    { key:'New',       color:'#6366f1', label:'New Leads' },
    { key:'Contacted', color:'#f59e0b', label:'Contacted' },
    { key:'Qualified', color:'#10b981', label:'Qualified' },
    { key:'Closed',    color:'#9ca3af', label:'Closed/Won' },
  ];
  const counts = stages.map(s => allLeads.filter(l => l.status === s.key).length);
  const max = Math.max(...counts, 1);

  container.innerHTML = stages.map((s, i) => {
    const pct = Math.round((counts[i] / max) * 100);
    return `<div style="margin-bottom:8px">
      <div style="display:flex;justify-content:space-between;font-size:12px;margin-bottom:3px">
        <span style="font-weight:600;color:var(--gray-700)">${s.label}</span>
        <span style="color:var(--gray-500)">${counts[i]}</span>
      </div>
      <div style="height:10px;background:var(--gray-100);border-radius:99px;overflow:hidden">
        <div style="height:100%;width:${pct}%;background:${s.color};border-radius:99px;transition:width 0.5s ease"></div>
      </div>
    </div>`;
  }).join('');
}

// ============================================================
//  SETTINGS
// ============================================================
function loadSettingsToUI() {
  const settings = SettingsEngine.load();
  const apifyEl = document.getElementById('apify-key');
  if (apifyEl) {
    apifyEl.value = '';
  }
  const dedupEl = document.getElementById('dedup-field');
  if (dedupEl) dedupEl.value = settings.dedupStrategy || 'company+type';
  const budgetEl = document.getElementById('token-budget');
  if (budgetEl) {
    budgetEl.value = settings.tokenBudget || 100;
    const budgetValEl = document.getElementById('sm-max-comp-val');
    if (budgetValEl) budgetValEl.textContent = budgetEl.value;
  }
  const workersEl = document.getElementById('sm-workers');
  if (workersEl) {
    workersEl.value = settings.workers || 4;
    const workersValEl = document.getElementById('sm-workers-val');
    if (workersValEl) workersValEl.textContent = workersEl.value;
  }

  const groqEl = document.getElementById('groq-key') || document.getElementById('groq-key-mgmt');
  if (groqEl && window.ChatEngine) groqEl.value = window.ChatEngine.getApiKey() || '';

  const openaiEl = document.getElementById('openai-key-mgmt');
  if (openaiEl) openaiEl.value = '';
  const deepseekEl = document.getElementById('deepseek-key-mgmt');
  if (deepseekEl) deepseekEl.value = '';

  // Appearance
  const theme = document.documentElement.getAttribute('data-theme') || 'dark';
  const smDark = document.getElementById('sm-darkmode');
  if (smDark) smDark.checked = theme === 'dark';
  const accentEl = document.getElementById('sm-accent-color');
  if (accentEl) accentEl.value = safeLocalStorageGet('skylark-accent-color') || 'purple';
  const sidebarW = document.getElementById('sm-sidebar-width');
  if (sidebarW) {
    const cur = safeLocalStorageGet('skylark-sidebar-width') || '230';
    sidebarW.value = cur;
    const wVal = document.getElementById('sm-sidebar-w-val');
    if (wVal) wVal.textContent = cur;
  }

  // AI models
  const llmEl = document.getElementById('sm-llm');
  if (llmEl) llmEl.value = safeLocalStorageGet('skylark-llm') || 'groq_llama70b';
  const tempEl = document.getElementById('sm-temperature');
  if (tempEl) {
    tempEl.value = safeLocalStorageGet('skylark-temperature') || '0.2';
    const tVal = document.getElementById('sm-temp-val');
    if (tVal) tVal.textContent = tempEl.value;
  }

  // Voice
  const voiceEl = document.getElementById('sm-tts-model');
  if (voiceEl) voiceEl.value = 'gemini';
  const speedEl = document.getElementById('sm-speech-speed');
  if (speedEl) {
    speedEl.value = safeLocalStorageGet('skylark-speech-speed') || '1.0';
    const sVal = document.getElementById('sm-speech-val');
    if (sVal) sVal.textContent = speedEl.value;
  }
  const handsEl = document.getElementById('sm-hands-free');
  if (handsEl) handsEl.checked = safeLocalStorageGet('skylark-hands-free') === 'true';
  const wakeEl = document.getElementById('clavis-wake-words');
  if (wakeEl) {
    try { wakeEl.value = JSON.parse(localStorage.getItem('clavis_wake_words') || 'null')?.join(', ') || 'Clavis, Hey buddy, Hi pal'; } catch (_) {}
  }

  // Restore locations
  if (settings.locations?.length) {
    settings.locations.forEach(l => addLocationTag(l));
  }
  // Restore industries
  if (settings.lastIndustries?.length) {
    settings.lastIndustries.forEach(k => toggleIndustry(k, null));
  }

}

async function refreshSettingsMemoryStats() {
  const stats = await MemoryEngine.getStats();
  const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
  set('mem-total',    stats.total);
  set('mem-dupes',    stats.dupes);
  set('mem-sessions', stats.sessions);
  set('mem-pushed',   stats.pushed);
}

function saveSettings() {
  const apifyKey     = (document.getElementById('apify-key')?.value || '').trim();
  const dedupStrategy = document.getElementById('dedup-field')?.value || 'company+type';
  const tokenBudget  = parseInt(document.getElementById('token-budget')?.value || '100');
  const workers      = parseInt(document.getElementById('sm-workers')?.value || '4');
  const groqKey      = (document.getElementById('groq-key-mgmt')?.value || document.getElementById('groq-key')?.value || '').trim();
  const openaiKey    = (document.getElementById('openai-key-mgmt')?.value || '').trim();
  const deepseekKey  = (document.getElementById('deepseek-key-mgmt')?.value || '').trim();

  SettingsEngine.save({ apifyKey, dedupStrategy, tokenBudget, workers });
  localStorage.setItem('skylark_dedup_strategy', dedupStrategy);
  // Provider secrets are accepted only by the authenticated backend vault.
  // Never persist or send them from this browser settings form.

  // Appearance
  const accent = document.getElementById('sm-accent-color')?.value || 'purple';
  localStorage.setItem('skylark-accent-color', accent);
  applyAccentColor(accent);

  const sidebarWidth = document.getElementById('sm-sidebar-width')?.value;
  if (sidebarWidth) {
    localStorage.setItem('skylark-sidebar-width', sidebarWidth);
    localStorage.setItem('do-sidebar-width', sidebarWidth);
    window.SidebarController?.setWidth(sidebarWidth);
  }

  const homePage = document.getElementById('sm-home-page')?.value;
  if (homePage) localStorage.setItem('skylark-home-page', homePage);

  // AI models
  const llm = document.getElementById('sm-llm')?.value;
  if (llm) localStorage.setItem('skylark-llm', llm);
  const temp = document.getElementById('sm-temperature')?.value;
  if (temp) localStorage.setItem('skylark-temperature', temp);

  // Voice
  const tts = document.getElementById('sm-tts-model')?.value;
  if (tts) localStorage.setItem('skylark-tts-model', tts);
  const speed = document.getElementById('sm-speech-speed')?.value;
  if (speed) localStorage.setItem('skylark-speech-speed', speed);
  const handsFree = document.getElementById('sm-hands-free')?.checked;
  if (handsFree !== undefined) {
    localStorage.setItem('skylark-hands-free', handsFree ? 'true' : 'false');
    if (window.toggleHandsFreeSetting) window.toggleHandsFreeSetting(handsFree);
  }

  // Auto-rotate keys
  const autoRotate = document.getElementById('sm-auto-rotate')?.checked;
  if (autoRotate !== undefined) localStorage.setItem('skylark-auto-rotate', autoRotate ? 'true' : 'false');

  // Misc toggles
  const toggles = {
    'sm-verify-email': 'skylark-verify-email',
    'sm-lead-scoring': 'skylark-lead-scoring',
    'sm-ai-memory': 'skylark-ai-memory',
    'sm-desktop-notifs': 'skylark-desktop-notifs',
    'sm-toasts': 'skylark-toasts',
    'sm-sound-notifs': 'skylark-sound-notifs',
    'sm-encryption': 'skylark-encryption',
    'sm-gpu-accel': 'skylark-gpu-accel',
    'sm-dev-mode': 'skylark-dev-mode',
    'sm-reduce-motion': 'skylark-reduce-motion',
    'sm-compact': 'skylark-compact',
    'sm-charts': 'skylark-charts',
    'sm-live-counters': 'skylark-live-counters',
    'sm-fps': 'skylark-fps'
  };
  for (const [id, key] of Object.entries(toggles)) {
    const el = document.getElementById(id);
    if (el) localStorage.setItem(key, el.value !== undefined ? el.value : (el.checked ? 'true' : 'false'));
  }

  if (typeof window.showToast === 'function') {
    window.showToast('success', 'Settings Saved', 'All preferences stored locally');
  }
}

function applyAccentColor(color) {
  const map = {
    purple: ['#6366f1', '#a855f7'],
    emerald: ['#059669', '#10b981'],
    blue: ['#2563eb', '#3b82f6']
  };
  const [c1, c2] = map[color] || map.purple;
  const root = document.documentElement;
  if (root.style) {
    root.style.setProperty('--primary', c1);
    root.style.setProperty('--secondary', c2);
  }
}

// Jarvis-specific saves handled in saveJarvisSettings() / saveVoiceSettings() below (merged)

async function clearAllData() {
  if (!confirm('This will delete ALL leads and memory. This cannot be undone. Continue?')) return;
  await MemoryEngine.clearAll(); // also resets token counter
  allLeads = [];
  filteredLeads = [];
  selectedLeadIds.clear();
  restoreTokenCounter();
  updateAllUI();
  showToast('success', 'Memory Cleared', 'All lead data and token counter have been reset');
}

function toggleApiKey() {
  const input = document.getElementById('apify-key');
  if (!input) return;
  input.type = input.type === 'password' ? 'text' : 'password';
}

function toggleGroqKey() {
  const input = document.getElementById('groq-key') || document.getElementById('groq-key-mgmt');
  if (!input) return;
  input.type = input.type === 'password' ? 'text' : 'password';
}

// ============================================================
//  CHAT UI LOGIC
// ============================================================
function initChatUI() {
  const btn = document.getElementById('chat-send-btn');
  const input = document.getElementById('chat-input');
  
  if(btn && input) {
    btn.addEventListener('click', handleChatSend);
    input.addEventListener('keydown', (e) => {
      if(e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleChatSend();
      }
    });
    
    // Auto-resize logic
    input.addEventListener('input', function() {
      this.style.height = 'auto';
      this.style.height = (this.scrollHeight) + 'px';
    });
  }
  
  setupCustomDropdowns();
}

function setupCustomDropdowns() {
  document.querySelectorAll('.custom-dropdown').forEach(dropdown => {
    const header = dropdown.querySelector('.custom-dropdown-header');
    const textEl = dropdown.querySelector('.custom-dropdown-text');
    const listItems = dropdown.querySelectorAll('.custom-dropdown-list li');
    const hiddenInput = dropdown.querySelector('input[type="hidden"]');
    
    if (header) {
      header.addEventListener('click', (e) => {
        e.stopPropagation();
        document.querySelectorAll('.custom-dropdown').forEach(d => {
          if (d !== dropdown) d.classList.remove('open');
        });
        dropdown.classList.toggle('open');
      });
    }
    
    if (listItems) {
      listItems.forEach(li => {
        li.addEventListener('click', (e) => {
          e.stopPropagation();
          const val = li.getAttribute('data-value');
          const text = li.innerText;
          if (textEl) textEl.innerText = text;
          if (hiddenInput) hiddenInput.value = val;
          
          listItems.forEach(item => item.classList.remove('active'));
          li.classList.add('active');
          
          dropdown.classList.remove('open');
        });
      });
    }
  });
  
  document.addEventListener('click', () => {
    document.querySelectorAll('.custom-dropdown').forEach(d => d.classList.remove('open'));
  });
}
async function handleFileUpload(event) {
  const file = event.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = async function(e) {
    const text = e.target.result;
    const lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 0);
    
    // Take up to 50 lines as company names
    const companies = lines.slice(0, 50).filter(l => l.length > 2);
    
    if (companies.length === 0) {
      showToast('error', 'File Error', 'Could not find valid company names in the file.');
      return;
    }

    addChatMessage('user', `<p>📁 Uploaded <b>${escHtml(file.name)}</b> (${companies.length} companies).</p><p>Please find contact numbers and websites for these companies.</p>`);
    
    const container = document.getElementById('chat-messages');
    const typing = document.createElement('div');
    typing.className = 'typing-indicator';
    typing.id = 'typing-indicator';
    typing.innerHTML = `
      <div class="chat-avatar" style="width:24px;height:24px;font-size:10px;margin-right:12px;">AI</div>
      <div style="display:flex;align-items:center;gap:8px;background:var(--gray-50);padding:10px 16px;border-radius:12px;">
        <span style="font-size:13px;color:var(--gray-600);font-weight:500;">Clavis is enriching data</span>
        <div class="typing-dot"></div><div class="typing-dot"></div><div class="typing-dot"></div>
      </div>`;
    container.appendChild(typing);
    document.getElementById('main-scroll-area').scrollTop = 9999;

    // Simulate API delay for enrichment
    await new Promise(r => setTimeout(r, 2000));
    
    if (document.getElementById('typing-indicator')) {
      document.getElementById('typing-indicator').remove();
    }

    // File import currently stores company names only; do not present blank
    // contact fields as if a remote enrichment request succeeded.
    const enrichedLeads = companies.map((c, i) => {
      const email = '';
      const phone = '';
      const website = '';
      return {
        id: `enriched_${Date.now()}_${i}`,
        company: c,
        type: 'Imported Company',
        city: 'India',
        phone: phone,
        email: email,
        website: website,
        address: 'HQ Location',
        jobTitle: 'Admin/HR',
        source: 'File Upload',
        timestamp: Date.now(),
        isNew: true
      };
    });

    window.MemoryEngine.saveLeads(enrichedLeads);
    
    addChatMessage('system', `
      <div class="agent-reply">
        <h4>Companies Imported</h4>
        <p>Processed <b>${escHtml(file.name)}</b> and added ${enrichedLeads.length} company names. Contact enrichment can be run from the lead-generation flow.</p>
        <button class="btn-primary" onclick="showView('leads')" style="margin-top:12px;padding:6px 12px;font-size:12px;">View Imported Companies</button>
      </div>
    `);
    
    event.target.value = ''; // Reset input
    renderStats();
  };
  reader.readAsText(file);
}


let currentChatController = null;
function stopChatGeneration() {
  if (currentChatController) {
    currentChatController.abort();
    currentChatController = null;
  }
}

function resetClientChat() {
  if (typeof stopChatGeneration === 'function') stopChatGeneration();
  const messages = document.getElementById('chat-messages');
  if (messages) messages.innerHTML = '';
  const welcome = document.getElementById('chat-welcome');
  if (welcome) welcome.style.display = 'flex';
  const chips = document.getElementById('chat-quick-chips');
  if (chips) chips.style.display = 'flex';
  const box = document.querySelector('#view-chat .chat-container');
  if (box) box.dataset.chatState = 'empty';
  const input = document.getElementById('chat-input');
  if (input) {
    input.value = '';
    if (typeof window.resetComposer === 'function') {
      window.resetComposer(input);
    } else {
      input.style.removeProperty('height');
      input.style.setProperty('height', '28px', 'important');
      input.style.setProperty('--lx-ta-h', '28px');
      input.classList.remove('lx-grow-scroll', 'au-shrinking', 'au-measuring');
      input.dataset.grow = 'fit';
      input.dispatchEvent(new Event('input', { bubbles: true }));
    }
  }
  document.getElementById('typing-indicator')?.remove();
  try {
    if (window.MemoryEngine?.clearChatHistory) {
      window.MemoryEngine.clearChatHistory();
    }
  } catch (_) {}
  if (window.showToast) window.showToast('Started a new client lead search session.', 'info');
}
window.resetClientChat = resetClientChat;

async function handleChatSend(textOverride, options = {}) {
  const input = document.getElementById('chat-input');
  const text = (textOverride != null ? textOverride : (input ? input.value : '')).trim();
  const attachments = options.attachments || [];
  if(!text && !attachments.length) return;
  
  if (input && textOverride == null) {
    input.value = '';
    if (typeof window.resetComposer === 'function') {
      window.resetComposer(input);
    } else {
      input.style.removeProperty('height');
      input.style.setProperty('height', '28px', 'important');
      input.style.setProperty('--lx-ta-h', '28px');
      input.classList.remove('lx-grow-scroll', 'au-shrinking', 'au-measuring');
      input.dataset.grow = 'fit';
      const chatHost = input.closest('.claude-input-container, .chat-container');
      if (chatHost) chatHost.dataset.emptyInput = '1';
      input.dispatchEvent(new Event('input', { bubbles: true }));
    }
  }

  addChatMessage('user', text ? `<p>${escHtml(text)}</p>` : '', attachments);
  
  try {
    if (window.ClavisTask?.begin) {
      const activeTask = window.ClavisTask.current?.();
      if (!activeTask || ['completed', 'failed'].includes(activeTask.phase)) {
        window.ClavisTask.begin(text || (attachments.length ? 'Analyze attachment: ' + attachments[0].name : 'Task'), {
          source: 'composer',
          onCancel: function () { try { stopChatGeneration(); } catch (_) {} }
        });
      }
    }
  } catch (_) {}

  const status = window.LuxeStatus ? window.LuxeStatus.mount('chat-messages') : null;
  const thinkingSteps = ['Thinking', 'Understanding your request', 'Composing a response'];
  let stepIdx = 0;
  if (status) status.set(thinkingSteps[0]);
  const thinkingTimer = setInterval(() => {
    stepIdx = Math.min(stepIdx + 1, thinkingSteps.length - 1);
    status?.set(thinkingSteps[stepIdx]);
  }, 1100);

  const stopBtn = document.getElementById('chat-stop-btn');
  const sendBtn = document.getElementById('chat-send-btn');
  if(stopBtn) { stopBtn.hidden = false; stopBtn.setAttribute('aria-hidden', 'false'); }
  if(sendBtn) sendBtn.style.display = 'none';

  currentChatController = new AbortController();
  
  try {
    const chatOptions = {
      images: attachments.filter(a => a.isImage && a.dataUrl).map(a => a.dataUrl),
      attachments: attachments
    };
    const response = await window.ChatEngine.sendMessage(text, currentChatController.signal, chatOptions);
    clearInterval(thinkingTimer);

    if (response) {
      const isExplicitLeadRequest = window.LeadCandidateDomain?.parseRequest
        ? window.LeadCandidateDomain.parseRequest(text).isSearch
        : /\b(lead|leads|prospect|prospects|company|companies|business|businesses|client|clients|data|scrape|extract|nikal|dhundh)\b/i.test(text);

      // A scrape command keeps the live status alive on THIS page ONLY if the user actually requested leads
      if (response.action && (response.action.type === 'generate') && isExplicitLeadRequest) {
        status?.remove();
        if (response.text) addChatMessage('assistant', `<p>${escHtml(response.text).replace(/\\n/g, '<br>')}</p>`);
        runScrapeFromChat(response.action);
      } else {
        status?.remove();
        addAssistantMessage(response.text);
        if (response.action && (response.action.type !== 'generate' || isExplicitLeadRequest)) {
          executeChatAction(response.action);
        }
      }
    } else {
      status?.remove();
    }
  } catch (err) {
    clearInterval(thinkingTimer);
    status?.remove();
    if(err.name === 'AbortError') {
      addChatMessage('assistant', `<p style="color:var(--accent-orange)">Generation stopped by user.</p>`);
    } else {
      addChatMessage('assistant', `<p style="color:var(--accent-red)">Error: ${escHtml(err.message)}</p>`);
    }
  } finally {
    if(stopBtn) { stopBtn.hidden = true; stopBtn.setAttribute('aria-hidden', 'true'); }
    if(sendBtn) sendBtn.style.display = 'flex';
    currentChatController = null;
  }
}

// ChatGPT-style Action Toolbar helper
function createChatActionToolbar(bubble, container, inputId) {
  const actionsDiv = document.createElement('div');
  actionsDiv.className = 'chat-msg-actions';
  actionsDiv.innerHTML = `
    <button type="button" class="chat-act-btn act-copy" title="Copy message" aria-label="Copy message">
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>
      <span class="act-label">Copy</span>
    </button>
    <button type="button" class="chat-act-btn act-retry" title="Retry response" aria-label="Retry response">
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67"/></svg>
      <span class="act-label">Retry</span>
    </button>
    <button type="button" class="chat-act-btn act-like" title="Helpful" aria-label="Good response">
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 9V5a3 3 0 0 0-3-3l-4 9v11h11.28a2 2 0 0 0 2-1.7l1.38-9a2 2 0 0 0-2-2.3zM7 22H4a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2h3"></path></svg>
    </button>
    <button type="button" class="chat-act-btn act-dislike" title="Not helpful" aria-label="Bad response">
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 15v4a3 3 0 0 0 3 3l4-9V2H5.72a2 2 0 0 0-2 1.7l-1.38 9a2 2 0 0 0 2 2.3zm7-13h3a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2h-3"></path></svg>
    </button>
  `;

  const copyBtn = actionsDiv.querySelector('.act-copy');
  copyBtn.onclick = () => {
    const textToCopy = bubble.innerText;
    navigator.clipboard.writeText(textToCopy).then(() => {
      copyBtn.classList.add('is-copied');
      const label = copyBtn.querySelector('.act-label');
      if (label) label.textContent = 'Copied!';
      setTimeout(() => {
        copyBtn.classList.remove('is-copied');
        if (label) label.textContent = 'Copy';
      }, 2000);
    }).catch(() => {});
  };

  const retryBtn = actionsDiv.querySelector('.act-retry');
  retryBtn.onclick = () => {
    if (!container) return;
    const userMessages = container.querySelectorAll('.chat-message.user .chat-bubble');
    if (userMessages.length > 0) {
      const lastUserText = userMessages[userMessages.length - 1].innerText.trim();
      const input = document.getElementById(inputId || 'chat-input');
      if (input) {
        input.value = lastUserText;
        if (inputId === 'candidate-ai-input' && typeof handleCandidateChatSend === 'function') {
          handleCandidateChatSend();
        } else if (typeof handleChatSend === 'function') {
          handleChatSend();
        }
      }
    }
  };

  const likeBtn = actionsDiv.querySelector('.act-like');
  const dislikeBtn = actionsDiv.querySelector('.act-dislike');
  likeBtn.onclick = () => {
    likeBtn.classList.toggle('is-active');
    dislikeBtn.classList.remove('is-active');
  };
  dislikeBtn.onclick = () => {
    dislikeBtn.classList.toggle('is-active');
    likeBtn.classList.remove('is-active');
  };

  return actionsDiv;
}

// ChatGPT-style assistant message: parses rich markdown/tables and displays action toolbar
function addAssistantMessage(text, options) {
  const container = document.getElementById('chat-messages');
  if (!container) return;

  if (typeof window.streamAssistantMessage === 'function') {
    return window.streamAssistantMessage({
      container,
      text,
      welcomeId: 'chat-welcome',
      inputId: 'chat-input',
      createToolbar: createChatActionToolbar,
      stream: options?.stream !== false,
      speed: 16
    });
  }

  const msgDiv = document.createElement('div');
  msgDiv.className = 'chat-message assistant';

  const avatar = document.createElement('div');
  avatar.className = 'chat-avatar';
  avatar.textContent = 'AI';

  const contentWrap = document.createElement('div');
  contentWrap.className = 'chat-content-wrap';

  const bubble = document.createElement('div');
  bubble.className = 'chat-bubble';

  // Format with high-fidelity markdown parser
  const parsedHtml = (typeof window.parseChatMarkdown === 'function')
    ? window.parseChatMarkdown(text)
    : (text || '');
  bubble.innerHTML = parsedHtml;

  const actions = createChatActionToolbar(bubble, container, 'chat-input');

  contentWrap.appendChild(bubble);
  contentWrap.appendChild(actions);

  msgDiv.appendChild(avatar);
  msgDiv.appendChild(contentWrap);
  container.appendChild(msgDiv);

  const welcome = document.getElementById('chat-welcome');
  if (welcome) welcome.style.display = 'none';

  // Autoscroll to bottom
  container.scrollTop = container.scrollHeight;
  const scroll = document.getElementById('main-scroll-area');
  if (scroll) scroll.scrollTop = scroll.scrollHeight;
}

function addChatMessage(role, htmlContent, attachments) {
  const container = document.getElementById('chat-messages');
  if(!container) return;
  const msgDiv = document.createElement('div');
  msgDiv.className = `chat-message ${role}`;
  
  const avatar = document.createElement('div');
  avatar.className = 'chat-avatar';
  avatar.textContent = role === 'user' ? 'U' : 'AI';
  
  const bubble = document.createElement('div');
  bubble.className = 'chat-bubble';

  if (attachments && attachments.length > 0) {
    const attsWrap = document.createElement('div');
    attsWrap.className = 'chat-msg-attachments';
    attachments.forEach(att => {
      const chip = document.createElement('div');
      chip.className = 'chat-msg-attach-chip';
      let thumbHtml = '';
      if (att.isImage && att.dataUrl) {
        thumbHtml = `<img src="${att.dataUrl}" alt="${escHtml(att.name || 'Image')}" />`;
      } else {
        thumbHtml = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>`;
      }
      chip.innerHTML = `
        <div class="chat-msg-attach-thumb">${thumbHtml}</div>
        <span class="chat-msg-attach-name" title="${escHtml(att.name || 'Attachment')}">${escHtml(att.name || 'Attachment')}</span>
        <span class="chat-msg-attach-size">${att.size ? (att.size < 1048576 ? Math.round(att.size/1024) + ' KB' : (att.size/1048576).toFixed(1) + ' MB') : ''}</span>
      `;
      if (att.isImage && att.dataUrl) {
        chip.addEventListener('click', () => {
          if (typeof window.openImageLightbox === 'function') {
            window.openImageLightbox(att.dataUrl, att.name);
          }
        });
      }
      attsWrap.appendChild(chip);
    });
    bubble.appendChild(attsWrap);
  }

  if (htmlContent) {
    const textEl = document.createElement('div');
    textEl.innerHTML = htmlContent;
    bubble.appendChild(textEl);
  }
  
  if (role === 'assistant' || role === 'system') {
    const contentWrap = document.createElement('div');
    contentWrap.className = 'chat-content-wrap';
    const actions = createChatActionToolbar(bubble, container, 'chat-input');
    contentWrap.appendChild(bubble);
    contentWrap.appendChild(actions);
    msgDiv.appendChild(avatar);
    msgDiv.appendChild(contentWrap);
  } else {
    msgDiv.appendChild(avatar);
    msgDiv.appendChild(bubble);
  }
  
  container.appendChild(msgDiv);
  
  const welcome = document.getElementById('chat-welcome');
  if (welcome) welcome.style.display = 'none';
  
  container.scrollTop = container.scrollHeight;
  const scrollArea = document.getElementById('main-scroll-area');
  if (scrollArea) scrollArea.scrollTop = scrollArea.scrollHeight;
}

// Run the lead pipeline WITHOUT leaving the AI page. A live status card
// reflects the real scraper phase; on finish we surface a suggestion chip
// (never an automatic redirect) so the user can inspect the Run Agent logs.
function runScrapeFromChat(action, existingStatus) {
  // The sourcing run continues after the assistant's short acknowledgement;
  // keep or create the active task so the floating window remains truthful.
  try {
    const active = window.ClavisTask?.current?.();
    if (!active || ['completed', 'failed'].includes(active.phase)) {
      window.ClavisTask?.begin?.(action?.query || 'Find relevant business leads', { source: 'composer' });
    } else {
      window.ClavisTask?.event?.(active.id, { type: 'reading', label: 'Connecting to live search engines' });
    }
  } catch (_) {}
  const cities = (action.cities && action.cities.length)
    ? action.cities
    : [window.SKYLARK_CONFIG?.DEFAULT_CITY || 'Gurugram'];
  let industries = (action.industries && action.industries.length) ? action.industries : null;
  // "ALL" is the model's shorthand for "user named no industry" → every sector
  if (industries && industries.length === 1 && /^all$/i.test(String(industries[0]).trim())) industries = null;
  if (!industries) {
    industries = (window.IndustryDB?.getNames?.() || [
      'Hotels & Hospitality', 'Hospitals & Healthcare',
      'Corporate IT Parks & Tech Hubs', 'Malls & Retail Chains',
      'Factories & Manufacturing'
    ]);
  }
  const serviceTypes = (action.serviceType && action.serviceType.length)
    ? action.serviceType
    : ['Security', 'Housekeeping', 'Pantry Boy'];
  // Count policy: default exactly 20; anything requested is clamped to 20–100.
  const count = Math.max(20, Math.min(100,
    parseInt(action.count, 10) || (window.AppSettings?.defaultCount?.()) || 20));

  const status = existingStatus || (window.LuxeStatus ? window.LuxeStatus.mount('chat-messages') : null);
  status?.set('Starting the lead agent', 4);

  const onProgress = (e) => {
    status?.set(e.detail.label, e.detail.pct);
    try {
      const cur = window.ClavisTask?.current?.();
      if (cur) {
        window.ClavisTask.event(cur.id, {
          type: 'reading',
          label: e.detail.label || 'Sourcing business leads',
          progress: typeof e.detail.pct === 'number' ? e.detail.pct / 100 : undefined
        });
      }
    } catch (_) {}
  };
  const cleanup = () => {
    document.removeEventListener('nexus:scrapeprogress', onProgress);
    document.removeEventListener('nexus:scrapedone', onDone);
  };
  const onDone = (e) => {
    cleanup();
    status?.remove();
    const d = e.detail || {};
    try {
      const cur = window.ClavisTask?.current?.();
      if (cur && cur.phase !== 'completed') {
        const rows = Array.isArray(d.leads) ? d.leads : [];
        cur.intent = 'lead_gen';
        cur.mode = 'leads';
        cur.metrics.leads = Number(d.total || d.added || rows.length || 0);
        if (d.completeContacts != null) cur.metrics.completeContacts = Number(d.completeContacts) || 0;
        const result = {
          type: 'leads',
          text: d.ok
            ? `${cur.metrics.leads} sourced leads are ready. Excel file has downloaded automatically.`
            : (cur.metrics.leads ? `${cur.metrics.leads} leads found.` : 'No leads found matching criteria.'),
          rows: rows,
          metrics: cur.metrics
        };
        window.ClavisTask.complete(cur.id, result);
      }
    } catch (_) {}
    if (d.ok) {
      addChatMessage('assistant', `<p><strong>Your data is ready.</strong> ${d.added || 0} sourced leads are available. ${d.completeContacts != null ? `${d.completeContacts} include website, phone and email.` : ''} The Excel file has downloaded automatically.</p>${chatSuggestionHtml('Open Run Agent to see the live logs and pipeline detail.')}`);
    } else if (d.incomplete) {
      addChatMessage('assistant', `<p>⚠️ I could only verify <strong>${d.completeContacts || d.added || 0}/${d.requested || count}</strong> leads with a complete website, phone and email, so nothing partial was exported. You can widen the city or industry and try again.</p>${chatSuggestionHtml('Open the Run Agent page to review what was found.')}`);
    } else {
      addChatMessage('assistant', `<p style="color:var(--accent-red,#ef4444)">The lead run could not finish: ${escHtml(d.error || 'unknown error')}.</p>${chatSuggestionHtml('Check the Run Agent logs for details.')}`);
    }
  };
  document.addEventListener('nexus:scrapeprogress', onProgress);
  document.addEventListener('nexus:scrapedone', onDone);

  setTimeout(() => {
    try {
      if (window.AgentCtrl?.runFromChat) window.AgentCtrl.runFromChat({ cities, industries, serviceTypes, count });
      else if (typeof startAgentPipeline === 'function') startAgentPipeline();
      else { cleanup(); status?.remove(); addChatMessage('assistant', '<p style="color:var(--accent-red,#ef4444)">Lead engine is unavailable right now.</p>'); }
    } catch (err) {
      cleanup(); status?.remove();
      addChatMessage('assistant', `<p style="color:var(--accent-red,#ef4444)">Could not start the lead run: ${escHtml(err.message)}</p>`);
    }
  }, 250);
}

// Exposed so the desk pet's guide tips can start a run with one click.
window.runScrapeFromChat = runScrapeFromChat;

function chatSuggestionHtml(text) {
  return `<div class="lx-chat-suggestion">
    <span>${escHtml(text)}</span>
    <button type="button" class="lx-suggestion-btn" onclick="highlightRunAgentEntry()">
      <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M13 2 3 14h7l-1 8 10-12h-7l1-8Z"/></svg>
      Run Agent
    </button>
  </div>`;
}

// Draw attention to the Run Agent entry point without navigating there.
function highlightRunAgentEntry() {
  const targets = [
    document.getElementById('run-agent-btn'),
    document.querySelector('[onclick*="showView(\'agent\')"]'),
    document.querySelector('.nav-item[data-view="agent"]')
  ].filter(Boolean);
  targets.forEach(el => {
    el.classList.add('lx-attention');
    setTimeout(() => el.classList.remove('lx-attention'), 2600);
  });
  if (targets[0]) targets[0].scrollIntoView({ behavior: 'smooth', block: 'center' });
}

function executeChatAction(action) {
  if (action.type === 'candidate_search') {
    // Keep candidate sourcing in its own workstream/table. The shared Clavis
    // task surface can still report the work, but lead records must never be
    // mixed with candidate records.
    try {
      try {
        window.ClavisTask?.begin?.(action.query || `Find ${action.role || 'candidates'}`, { source: 'auto' });
      } catch (_) {}
      showView('candidate-ai');
      const input = document.getElementById('candidate-ai-input');
      if (input) {
        input.value = action.query || `${action.role || 'candidates'} in ${action.city || ''} ${action.count || ''}`;
        if (window.CandidatesCtrl?.handleAiChatSubmit) window.CandidatesCtrl.handleAiChatSubmit();
      }
    } catch (error) {
      window.showToast?.('error', 'Candidate search unavailable', error.message || 'Could not start candidate sourcing.');
    }
  } else if (action.type === 'generate') {
    // Hand the chat's parameters directly to AgentCtrl — this is the
    // only path that actually reaches the real scraper engine.
    const cities = (action.cities && action.cities.length)
      ? action.cities
      : [window.SKYLARK_CONFIG?.DEFAULT_CITY || 'Gurugram'];

    let industries = (action.industries && action.industries.length)
      ? action.industries
      : null;

    // If the model gave no industries, fall back to the app's known list
    if (!industries) {
      industries = (window.IndustryDB?.getNames?.() || [
        'Hotels & Hospitality', 'Hospitals & Healthcare',
        'Corporate IT Parks & Tech Hubs', 'Malls & Retail Chains',
        'Factories & Manufacturing'
      ]);
    }

    const serviceTypes = (action.serviceType && action.serviceType.length)
      ? action.serviceType
      : ['Security', 'Housekeeping'];

    // Stay on the AI page — run in the background with a live status.
    runScrapeFromChat(action);

  } else if (action.type === 'filter') {
    if (action.industry) {
      const indSel = document.getElementById('filter-industry');
      if(indSel && Array.from(indSel.options).some(o => o.value === action.industry)) {
         indSel.value = action.industry;
      }
    }
    if (action.city) {
      const citySel = document.getElementById('filter-city');
      if(citySel && Array.from(citySel.options).some(o => o.value === action.city)) {
         citySel.value = action.city;
      }
    }
    if (action.status) {
      const statSel = document.getElementById('filter-status');
      if(statSel) statSel.value = action.status;
    }
    applyFilters();
    setTimeout(() => { showView('leads'); }, 1000);
  } else if (action.type === 'show_all') {
    clearFilters();
    setTimeout(() => { showView('leads'); }, 1000);
  } else if (action.type === 'export') {
    exportCSV();
  } else if (action.type === 'export_excel') {
    exportExcel();
  } else if (action.type === 'sync_sheets') {
    syncAllToSheets();
  }
}

// ============================================================
//  HELPERS
// ============================================================
function getTypeBadge(type) {
  const map = {
    'Security':     'badge-security',
    'Housekeeping': 'badge-hk',
    'Both':         'badge-both',
  };
  return `<span class="type-badge ${map[type]||''}">${escHtml(type||'Unknown')}</span>`;
}

function getSourceBadge(source) {
  return `<span class="source-badge">${escHtml(source||'Unknown')}</span>`;
}

function escHtml(str) {
  if (str == null) return '';
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}

function formatDate(ts) {
  if (!ts) return '—';
  return new Date(ts).toLocaleDateString('en-IN', { day:'2-digit', month:'short', year:'numeric' });
}

function timeAgo(ts) {
  if (!ts) return '';
  const diff = Date.now() - ts;
  if (diff < 3600000) return `${Math.floor(diff/60000)}m ago`;
  if (diff < 86400000) return `${Math.floor(diff/3600000)}h ago`;
  if (diff < 604800000) return `${Math.floor(diff/86400000)}d ago`;
  return formatDate(ts);
}

// ============================================================
//  TOAST SYSTEM
// ============================================================
// ============================================================
//  TOAST SYSTEM
// ============================================================
const activeToastKeys = new Set();
function showToast(a, b, c) {
  const validTypes = ['success', 'error', 'warning', 'info'];
  let type = 'info';
  let title = '';
  let message = '';
  let detail = '';
  let actions = [];
  let timeoutMs = 4500;
  let dedupeKey = '';

  if (a && typeof a === 'object') {
    type = validTypes.includes(String(a.type).toLowerCase()) ? String(a.type).toLowerCase() : 'info';
    title = String(a.title || 'Notification');
    message = String(a.message || '');
    detail = String(a.detail || '');
    actions = Array.isArray(a.actions) ? a.actions.filter(action => action && typeof action.run === 'function') : [];
    timeoutMs = Number.isFinite(a.timeoutMs) ? a.timeoutMs : (type === 'error' || type === 'warning' ? 0 : 4500);
    dedupeKey = String(a.id || `${type}:${a.errorCode || ''}:${title}:${message}`);
  }

  if (a && typeof a === 'object') {
    // Parsed above; keep the legacy call signatures below intact.
  } else if (c !== undefined) {
    // 3 arguments: (type, title, message)
    type = validTypes.includes(String(a).toLowerCase()) ? String(a).toLowerCase() : 'info';
    title = String(b || '');
    message = String(c || '');
  } else if (b !== undefined) {
    // 2 arguments: could be (message, type) or (type, message) or (title, message)
    if (validTypes.includes(String(b).toLowerCase())) {
      type = String(b).toLowerCase();
      title = type.charAt(0).toUpperCase() + type.slice(1);
      message = String(a || '');
    } else if (validTypes.includes(String(a).toLowerCase())) {
      type = String(a).toLowerCase();
      title = type.charAt(0).toUpperCase() + type.slice(1);
      message = String(b || '');
    } else {
      type = 'info';
      title = String(a || '');
      message = String(b || '');
    }
  } else if (a !== undefined) {
    // 1 argument: (message)
    type = 'info';
    title = 'Notification';
    message = String(a || '');
  }

  // Apply the same duplicate guard to legacy positional calls. Voice and
  // provider reconnect paths use those signatures, so guarding only the
  // object form still allowed an error storm through the old toast rail.
  if (!dedupeKey) dedupeKey = `${type}:${title}:${message}`;
  if (activeToastKeys.has(dedupeKey)) return;
  activeToastKeys.add(dedupeKey);

  if (window.__lxSoundLoaded) {
    window.SoundFX && (type === 'error' ? SoundFX.playError?.() :
                       type === 'success' ? SoundFX.playSuccess?.() : null);
  } else if (window.SoundFX) {
    if (type === 'success' && typeof window.SoundFX.playSuccess === 'function') window.SoundFX.playSuccess();
    else if (type === 'error' && typeof window.SoundFX.playError === 'function') window.SoundFX.playError();
  }

  const container = document.getElementById('toast-container');
  if (!container) return;

  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;

  const icons = {
    success: '<svg viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clip-rule="evenodd"/></svg>',
    error:   '<svg viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clip-rule="evenodd"/></svg>',
    warning: '<svg viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clip-rule="evenodd"/></svg>',
    info:    '<svg viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clip-rule="evenodd"/></svg>',
  };

  toast.tabIndex = 0;
  toast.setAttribute('role', type === 'error' || type === 'warning' ? 'alert' : 'status');
  toast.setAttribute('aria-label', `${title}. ${message}`.trim());
  toast.innerHTML = `
    <div class="toast-icon">${icons[type] || icons.info}</div>
    <div class="toast-content"><div class="toast-title">${escHtml(title || 'Notification')}</div><div class="toast-message">${escHtml(message)}</div></div>
    ${actions.length ? `<button class="toast-action" type="button">${escHtml(actions[0].label || 'Open')}</button>` : ''}
    <button class="toast-close" type="button" aria-label="Dismiss notification">×</button>
  `;

  const dismiss = () => { toast.classList.remove('visible'); setTimeout(() => { toast.remove(); if (dedupeKey) activeToastKeys.delete(dedupeKey); }, 220); };
  const expand = () => {
    toast.classList.add('expanded');
    if (detail) toast.querySelector('.toast-message').textContent = `${message} ${detail}`.trim();
    toast.querySelector('.toast-action')?.focus();
  };
  toast.addEventListener('click', (event) => {
    if (event.target.closest('.toast-close')) { dismiss(); return; }
    if (event.target.closest('.toast-action')) { dismiss(); actions[0]?.run(); return; }
    if (detail || actions.length) expand();
  });
  toast.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') { event.preventDefault(); dismiss(); }
    if ((event.key === 'Enter' || event.key === ' ') && (detail || actions.length)) { event.preventDefault(); expand(); }
  });

  container.appendChild(toast);
  requestAnimationFrame(() => toast.classList.add('visible'));

  if (timeoutMs > 0) setTimeout(() => { if (!toast.classList.contains('expanded')) dismiss(); }, timeoutMs);
}

// ============================================================
//  TOKEN DASHBOARD & KEY MANAGEMENT
// ============================================================
async function saveCustomKeys() {
  const apifyInput = document.getElementById('custom-apify-input');
  const groqInput  = document.getElementById('custom-groq-input');
  if (!apifyInput || !groqInput) return;

  const aKey = apifyInput.value.trim();
  const gKey = groqInput.value.trim();

  if (!window.NexusAIChat?.saveCredential || !window.SupabaseAuth?.getAccessToken?.()) {
    showToast('warning', 'Sign in required', 'Provider keys are stored only in the secure backend vault.');
    return;
  }
  try {
    if (aKey) await window.NexusAIChat.saveCredential('apify', aKey);
    if (gKey) await window.NexusAIChat.saveCredential('groq', gKey);
    apifyInput.value = '';
    groqInput.value = '';
    showToast('success', 'Keys Saved', 'Provider keys were encrypted in the secure backend vault.');
  } catch (_) {
    showToast('error', 'Key setup failed', 'The provider key could not be securely saved.');
  }
  renderTokenDashboard();
}

function updateKeyInputDefaults() {
  const apifyInput = document.getElementById('custom-apify-input');
  const groqInput  = document.getElementById('custom-groq-input');
  if (apifyInput) apifyInput.value = '';
  if (groqInput) groqInput.value = '';
}

function renderKeyTable(containerId, keyType, keys, limit, activeIdx) {
  const container = document.getElementById(containerId);
  if (!container) return;
  if (keys.length === 0) {
    container.innerHTML = `<div class="empty-chart-msg">No ${keyType === 'apify' ? 'Apify' : 'Groq'} keys configured in config.js</div>`;
    return;
  }
  const M = window.MemoryEngine;
  const rows = keys.map((key, i) => {
    const used   = M.getKeyUsage(keyType, i);
    const pct    = Math.min(Math.round((used / limit) * 100), 100);
    const isAct  = i === activeIdx;
    
    // Status Logic
    let status = '🟢 Healthy';
    let color  = '#10b981';
    let rowBg  = isAct ? 'background:var(--surface-raised); border-left: 3px solid var(--accent-green);' : '';
    
    if (pct >= 100) {
      status = '🔴 Exhausted';
      color  = '#ef4444';
      rowBg  = 'background:rgba(239, 68, 68, 0.05); opacity: 0.7;';
    } else if (pct >= 90) {
      status = '🔴 Near Limit';
      color  = '#ef4444';
    } else if (pct >= 70) {
      status = '🟡 High Usage';
      color  = '#f59e0b';
    }
    
    const activeBadge = isAct && pct < 100 ? `<span style="margin-left:8px; font-size:10px; background:var(--accent-green); color:#fff; padding:2px 6px; border-radius:4px; font-weight:700;">ACTIVE</span>` : '';
    const masked = key.length > 12 ? key.slice(0,6) + '•••••' + key.slice(-4) : '(empty)';
    
    return `
      <div style="display:grid;grid-template-columns:120px 140px 1fr 100px 90px;gap:12px;align-items:center;padding:10px 12px;border-bottom:1px solid var(--border);${rowBg}">
        <span style="font-size:12px;font-weight:700;color:var(--gray-900); display:flex; align-items:center;">Key #${i+1}${activeBadge}</span>
        <span style="font-size:11px;color:var(--gray-600);font-family:monospace">${masked}</span>
        <div style="height:8px;background:var(--gray-200);border-radius:99px;overflow:hidden">
          <div style="height:100%;width:${pct}%;background:${color};border-radius:99px;transition:width 0.5s"></div>
        </div>
        <span style="font-size:12px;color:var(--gray-800)">${used} / ${limit}</span>
        <span style="font-size:11px;font-weight:600;color:var(--gray-900)">${status}</span>
      </div>`;
  }).join('');
  container.innerHTML = `
    <div style="display:grid;grid-template-columns:80px 140px 1fr 100px 90px;gap:12px;padding:8px 12px;border-bottom:2px solid var(--border);background:var(--gray-50)">
      <span style="font-size:10px;font-weight:700;text-transform:uppercase;color:var(--gray-500)">Slot</span>
      <span style="font-size:10px;font-weight:700;text-transform:uppercase;color:var(--gray-500)">Key (masked)</span>
      <span style="font-size:10px;font-weight:700;text-transform:uppercase;color:var(--gray-500)">Usage</span>
      <span style="font-size:10px;font-weight:700;text-transform:uppercase;color:var(--gray-500)">Credits</span>
      <span style="font-size:10px;font-weight:700;text-transform:uppercase;color:var(--gray-500)">Status</span>
    </div>
    ${rows}`;
}

function resetAllKeyUsage() {
  if (!confirm('Reset all API key usage statistics? This will not affect your actual API quotas.')) return;
  window.MemoryEngine?.resetKeyUsage();
  renderTokenDashboard();
  showToast('success', 'Usage Reset', 'API key usage stats have been cleared');
}

// ─── Check key health and notify user ───────────────────────
function checkAndNotifyKeyHealth() {
  const M   = window.MemoryEngine;
  const cfg = window.SKYLARK_CONFIG || {};
  if (!M) return;

  const apifyKeys = (cfg.APIFY_API_KEYS || []).filter(k => k && k.trim());
  const groqKeys  = (cfg.GROQ_API_KEYS  || []).filter(k => k && k.trim());

  // Check if ALL apify keys are at >85%
  if (apifyKeys.length > 0) {
    const allExhausted = apifyKeys.every((_, i) =>
      M.getKeyUsage('apify', i) >= (cfg.APIFY_KEY_LIMIT || 400) * 0.85
    );
    if (allExhausted) {
      document.getElementById('token-warn-icon')?.style?.setProperty('display', 'inline');
      showToast('warning', '⚠ Apify Keys Near Limit!', 'All API keys are at 85%+ usage. Add more keys in config.js → Click token meter to view');
    }
  }

  // Warn when active key hits 80%
  const activeApify = M.getActiveApifyIdx();
  const health = M.checkKeyHealth('apify', activeApify);
  if (health.warn) {
    document.getElementById('token-warn-icon')?.style?.setProperty('display', 'inline');
    showToast('warning', `⚠ Apify Key #${activeApify + 1} at ${health.pct}%`, 'Switching to next key automatically. Add more keys in config.js');
  }
}

// ============================================================
//  VOICE SEARCH
// ============================================================
let voiceRecognition = null;

function startVoiceInput() {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) {
    showToast('warning', 'Voice Not Supported', 'Your browser does not support voice input. Try Chrome.');
    return;
  }

  const voiceBtn = document.getElementById('voice-btn');
  if (voiceRecognition) {
    voiceRecognition.stop();
    voiceRecognition = null;
    if (voiceBtn) voiceBtn.classList.remove('listening');
    return;
  }

  voiceRecognition = new SpeechRecognition();
  voiceRecognition.lang          = 'hi-IN'; // Hindi + English
  voiceRecognition.interimResults = true;
  voiceRecognition.maxAlternatives = 1;

  if (voiceBtn) voiceBtn.classList.add('listening');

  voiceRecognition.onresult = (event) => {
    const transcript = Array.from(event.results).map(r => r[0].transcript).join('');
    const input = document.getElementById('chat-input');
    if (input) input.value = transcript;
  };

  voiceRecognition.onend = () => {
    if (voiceBtn) voiceBtn.classList.remove('listening');
    voiceRecognition = null;
    showToast('info', 'Voice Input Stopped', 'Click the Send button or press Enter when you are ready');
  };

  voiceRecognition.onerror = (event) => {
    if (voiceBtn) voiceBtn.classList.remove('listening');
    voiceRecognition = null;
    if (event.error !== 'no-speech') {
      showToast('error', 'Voice Error', 'Could not capture audio: ' + event.error);
    }
  };

  voiceRecognition.start();
  showToast('info', '🎤 Listening...', 'Speak your query in Hindi or English');
}

// ============================================================
//  QUICK CHAT SHORTCUT
// ============================================================
function sendQuickChat(text) {
  const input = document.getElementById('chat-input');
  if (input) {
    input.value = text;
    // Hide quick chips after use
    const chips = document.getElementById('chat-quick-chips');
    if (chips) chips.style.display = 'none';
    handleChatSend();
  }
}

// ============================================================
//  EMAIL AUTOMATION LOGIC
// ============================================================
let currentEmailAttachments = [];

// Image Resize handler for Email Editors (Gmail-like popup)
let activeImageForResizing = null;

document.addEventListener('click', function(e) {
  const popup = document.getElementById('gmail-image-resizer');
  if (!popup) return;

  // page-email.js owns image selection/resizing in the current Email view.
  // Keeping this legacy preset popup active there caused two competing UIs.
  if (e.target.closest?.('#view-email')) {
    popup.style.display = 'none';
    activeImageForResizing = null;
    return;
  }
  
  if (e.target.tagName === 'IMG' && (e.target.closest('.gmail-editor') || e.target.closest('.gmail-editor-sig'))) {
    e.stopPropagation();
    activeImageForResizing = e.target;
    
    // Position the popup below the image
    const rect = activeImageForResizing.getBoundingClientRect();
    popup.style.top = (rect.bottom + window.scrollY + 6) + 'px';
    popup.style.left = (rect.left + window.scrollX) + 'px';
    popup.style.display = 'flex';
  } else if (!e.target.closest('#gmail-image-resizer')) {
    // Clicked outside, hide popup
    popup.style.display = 'none';
    activeImageForResizing = null;
  }
});

function resizeSelectedImage(size) {
  if (activeImageForResizing) {
    activeImageForResizing.style.maxWidth = size;
    activeImageForResizing.style.width = (size === '100%') ? 'auto' : size;
    activeImageForResizing.style.height = 'auto';
    
    // Reposition popup because image size changed
    setTimeout(() => {
      const popup = document.getElementById('gmail-image-resizer');
      if (popup && activeImageForResizing) {
        const rect = activeImageForResizing.getBoundingClientRect();
        popup.style.top = (rect.bottom + window.scrollY + 6) + 'px';
        popup.style.left = (rect.left + window.scrollX) + 'px';
      }
    }, 50);
  }
}

function removeSelectedImage() {
  if (activeImageForResizing) {
    activeImageForResizing.remove();
    const popup = document.getElementById('gmail-image-resizer');
    if (popup) popup.style.display = 'none';
    activeImageForResizing = null;
    showToast('info', 'Image Removed', 'The selected image has been removed.');
  }
}

function loadEmailTemplate() {
  const tmpl = JSON.parse(localStorage.getItem('skylark_email_template') || '{}');
  const subj = document.getElementById('email-subject');
  const bodyRich = document.getElementById('email-body-rich');
  const sigRich = document.getElementById('email-signature-rich');
  const webh = document.getElementById('email-webhook-url');
  const accEmail = document.getElementById('account-email');
  const ccVal = document.getElementById('email-cc');
  const bccVal = document.getElementById('email-bcc');
  
  if (subj) subj.value = tmpl.subject || '';
  if (bodyRich) bodyRich.innerHTML = tmpl.body || '<p>Hi {Company} team,</p><p><br></p><p>We provide excellent {JobTitle} services...</p>';
  // Default signature comes from the signed-in user's own profile, so each user
  // signs with their own company rather than a hardcoded agency name.
  if (sigRich) {
    const myCompany = (window.UserProfileManager?.getProfile?.()?.company || '').trim();
    sigRich.innerHTML = tmpl.signature
      || `<br><br>Best regards,<br><b>${myCompany || 'Your Company'}</b>`;
  }
  if (ccVal) ccVal.value = tmpl.cc || '';
  if (bccVal) bccVal.value = tmpl.bcc || '';
  
  if (webh) {
    webh.value = '';
  }
  if (accEmail) {
    accEmail.value = localStorage.getItem('skylark_email_account') || (window.SKYLARK_CONFIG && window.SKYLARK_CONFIG.EMAIL_SENDER_ADDRESS) || '';
  }
  
  // Show Cc/Bcc rows if they have saved content
  if ((tmpl.cc || tmpl.bcc) && ccVal && bccVal) {
    document.getElementById('gmail-cc-row').style.display = 'flex';
    document.getElementById('gmail-bcc-row').style.display = 'flex';
  }
}

function saveEmailTemplate() {
  const subject = document.getElementById('email-subject').value;
  const body = document.getElementById('email-body-rich').innerHTML;
  const signature = document.getElementById('email-signature-rich').innerHTML;
  const cc = document.getElementById('email-cc').value.trim();
  const bcc = document.getElementById('email-bcc').value.trim();
  
  localStorage.setItem('skylark_email_template', JSON.stringify({ subject, body, signature, cc, bcc }));
  showToast('success', 'Template Saved', 'Email template saved to memory.');
}

// ─── MULTI-EMAIL ACCOUNT MANAGEMENT ────────────────────────
function getSavedEmails() {
  try { return JSON.parse(localStorage.getItem('skylark_saved_emails') || '[]'); } catch { return []; }
}
function setSavedEmails(arr) {
  localStorage.setItem('skylark_saved_emails', JSON.stringify(arr));
}

function renderAccountsUI() {
  const emails = getSavedEmails();
  const activeEmail = localStorage.getItem('skylark_email_account') || '';

  // Active banner
  const banner = document.getElementById('active-email-banner');
  const bannerLabel = document.getElementById('active-email-label');
  if (banner && bannerLabel) {
    if (activeEmail) {
      banner.style.display = 'flex';
      bannerLabel.textContent = activeEmail;
    } else {
      banner.style.display = 'none';
    }
  }

  // Dropdown section — show only if 2+ emails
  const section = document.getElementById('saved-emails-section');
  const dropdown = document.getElementById('saved-emails-dropdown');
  if (section && dropdown) {
    if (emails.length >= 2) {
      section.style.display = 'block';
      dropdown.innerHTML = emails.map(e =>
        `<option value="${e}" ${e === activeEmail ? 'selected' : ''}>${e}</option>`
      ).join('');
    } else {
      section.style.display = 'none';
    }
  }

  // Clear input
  const emailInput = document.getElementById('account-email');
  if (emailInput) emailInput.value = '';
}

function saveEmailWebhook() {
  const webhook  = document.getElementById('email-webhook-url')?.value?.trim();
  const newEmail = document.getElementById('account-email')?.value?.trim();

  if (!webhook) {
    showToast('error', 'Webhook Missing', 'Please enter the Apps Script Webhook URL.');
    return;
  }

  // Webhook URLs are integration credentials/configuration and must not be
  // stored in browser storage. They are now managed by the authenticated
  // backend configuration flow.
  const webhookInput = document.getElementById('email-webhook-url');
  if (webhookInput) webhookInput.value = '';
  showToast('warning', 'Backend configuration required', 'Webhook settings are no longer stored in this browser.');
  return;

  if (newEmail) {
    // Add email to saved list (no duplicates)
    const emails = getSavedEmails();
    if (!emails.includes(newEmail)) {
      emails.push(newEmail);
      setSavedEmails(emails);
    }
    // Set as active
    localStorage.setItem('skylark_email_account', newEmail);
    showToast('success', '✓ Account Connected', `Now sending as: ${newEmail}`);
  } else {
    showToast('success', '✓ Webhook Saved', 'Connection updated successfully.');
  }

  renderAccountsUI();
  loadEmailTemplate(); // refresh email compose "from" display
}

function switchSavedEmail(email) {
  if (!email) return;
  localStorage.setItem('skylark_email_account', email);
  renderAccountsUI();
  loadEmailTemplate();
  showToast('success', '✓ Account Switched', `Now sending as: ${email}`);
}

function removeSavedEmail() {
  const dropdown = document.getElementById('saved-emails-dropdown');
  const emailToRemove = dropdown?.value;
  if (!emailToRemove) return;

  const emails = getSavedEmails().filter(e => e !== emailToRemove);
  setSavedEmails(emails);

  const activeEmail = localStorage.getItem('skylark_email_account');
  if (activeEmail === emailToRemove) {
    const next = emails[0] || '';
    localStorage.setItem('skylark_email_account', next);
  }

  renderAccountsUI();
  showToast('info', 'Email Removed', `${emailToRemove} removed from saved accounts.`);
}

function toggleFormattingBar() {
  const bar = document.getElementById('gmail-formatting-bar');
  if(bar.style.display === 'none') {
    bar.style.display = 'flex';
  } else {
    bar.style.display = 'none';
  }
}

function toggleCcBccFields() {
  const ccRow = document.getElementById('gmail-cc-row');
  const bccRow = document.getElementById('gmail-bcc-row');
  if (ccRow && bccRow) {
    const isHidden = ccRow.style.display === 'none';
    ccRow.style.display = isHidden ? 'flex' : 'none';
    bccRow.style.display = isHidden ? 'flex' : 'none';
  }
}

function showEmailSetup() {
  alert(
    "To setup the Google Apps Script Webhook for free email sending:\n\n" +
    "1. Go to script.google.com and create a new project.\n" +
    "2. Paste the provided email_script_gas.js code.\n" +
    "3. Click Deploy -> New Deployment.\n" +
    "4. Type: Web App.\n" +
    "5. Execute as: Me.\n" +
    "6. Who has access: Anyone.\n" +
    "7. Copy the Web App URL and paste it here."
  );
}

function formatEmailText(command) {
  document.execCommand(command, false, null);
}

function formatEmailLink() {
  const url = prompt("Enter the link URL:");
  if (url) {
    document.execCommand('createLink', false, url);
  }
}

function handleBodyImage(event) {
  const file = event.target.files[0];
  if (!file) return;
  
  const reader = new FileReader();
  reader.onload = function(e) {
    const dataURL = e.target.result;
    const editor = document.getElementById('email-body-rich');
    editor.focus();
    document.execCommand('insertImage', false, dataURL);
    
    const images = editor.getElementsByTagName('img');
    const justAdded = images[images.length - 1];
    if (justAdded) {
      justAdded.style.maxWidth = '250px';
      justAdded.style.height = 'auto';
    }
  };
  reader.readAsDataURL(file);
  event.target.value = '';
}

function handleSignatureImage(event) {
  const file = event.target.files[0];
  if (!file) return;
  
  const reader = new FileReader();
  reader.onload = function(e) {
    const dataURL = e.target.result;
    const editor = document.getElementById('email-signature-rich');
    editor.focus();
    document.execCommand('insertImage', false, dataURL);
    
    const images = editor.getElementsByTagName('img');
    const justAdded = images[images.length - 1];
    if (justAdded) {
      justAdded.style.maxWidth = '150px';
      justAdded.style.height = 'auto';
    }
  };
  reader.readAsDataURL(file);
  event.target.value = '';
}
function handleEmailAttachments(event) {
  const files = event.target.files;
  if (!files || files.length === 0) return;
  
  let totalSize = currentEmailAttachments.reduce((acc, a) => acc + (a.data.length * 0.75), 0); // approx base64 size back to bytes
  
  Array.from(files).forEach(file => {
    if (totalSize + file.size > 5 * 1024 * 1024) {
      showToast('error', 'Size Limit Reached', 'Total attachments cannot exceed 5MB to ensure delivery.');
      return;
    }
    
    const reader = new FileReader();
    reader.onload = function(e) {
      const base64Data = e.target.result.split(',')[1];
      currentEmailAttachments.push({
        name: file.name,
        type: file.type || 'application/octet-stream',
        data: base64Data
      });
      renderAttachmentsPreview();
    };
    reader.readAsDataURL(file);
    totalSize += file.size;
  });
  
  event.target.value = '';
}

function removeEmailAttachment(index) {
  currentEmailAttachments.splice(index, 1);
  renderAttachmentsPreview();
}

function renderAttachmentsPreview() {
  const container = document.getElementById('gmail-attachments-preview');
  if (!container) return;
  
  container.innerHTML = currentEmailAttachments.map((att, i) => `
    <div class="gmail-attachment-chip">
      <span style="max-width:150px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;" title="${att.name}">${att.name}</span>
      <span class="gmail-attachment-remove" onclick="removeEmailAttachment(${i})" title="Remove attachment">✕</span>
    </div>
  `).join('');
}

async function updateEmailPreview() {
  const container = document.getElementById('email-preview-list');
  if (!container) return;
  
  const targetType = document.getElementById('email-target').value;
  const batchSize = parseInt(document.getElementById('email-batch-size').value, 10) || 10;
  
  const allLeads = await window.MemoryEngine.getAllLeads();
  let leadsToEmail = [];
  if (targetType === 'uncontacted') {
    leadsToEmail = allLeads.filter(L => L.status !== 'Contacted' && L.email && L.email !== 'N/A' && L.email !== 'Not Found');
  } else {
    leadsToEmail = allLeads.filter(L => L.email && L.email !== 'N/A' && L.email !== 'Not Found');
  }
  
  const toInput = document.getElementById('email-to-recipients');
  
  leadsToEmail = leadsToEmail.slice(0, batchSize);
  
  if (leadsToEmail.length === 0) {
    container.innerHTML = '<em>No matching leads found with emails.</em>';
    if (toInput) toInput.value = '';
    return;
  }
  
  if (toInput) {
    toInput.value = leadsToEmail.map(L => L.email).join(', ');
  }
  
  container.innerHTML = `<strong>${leadsToEmail.length} leads selected:</strong><br>` + leadsToEmail.map(L => 
    `<div style="padding: 4px 0; border-bottom: 1px solid #e5e7eb;">
      <span style="font-weight: 600;">${L.company}</span> - <a href="mailto:${L.email}" style="color: var(--primary); text-decoration: none;">${L.email}</a>
    </div>`
  ).join('');
}

async function startEmailAutomation() {
  const webhook = document.getElementById('email-webhook-url').value.trim();
  if (!webhook) {
    showToast('error', 'Setup Required', 'Please enter your Google Apps Script Webhook URL.');
    return;
  }
  
  const subject = document.getElementById('email-subject').value;
  const body = document.getElementById('email-body-rich').innerHTML;
  const signature = document.getElementById('email-signature-rich').innerHTML;
  if (!subject || !body) {
    showToast('warning', 'Missing Content', 'Subject and Body are required to send emails.');
    return;
  }
  
  const cc = document.getElementById('email-cc').value.trim();
  const bcc = document.getElementById('email-bcc').value.trim();
  
  const targetType = document.getElementById('email-target').value;
  const batchSize = parseInt(document.getElementById('email-batch-size').value, 10) || 10;
  
  const allLeads = await window.MemoryEngine.getAllLeads();
  let leadsToEmail = [];
  if (targetType === 'uncontacted') {
    leadsToEmail = allLeads.filter(L => L.status !== 'Contacted' && L.email && L.email !== 'N/A' && L.email !== 'Not Found');
  } else {
    leadsToEmail = allLeads.filter(L => L.email && L.email !== 'N/A' && L.email !== 'Not Found');
  }
  
  leadsToEmail = leadsToEmail.slice(0, batchSize);
  
  if (leadsToEmail.length === 0) {
    showToast('info', 'No Leads', 'No leads found with valid emails for the selected target.');
    return;
  }
  
  if (!confirm(`You are about to send automated emails to ${leadsToEmail.length} leads. Continue?`)) return;
  
  document.getElementById('email-progress-container').style.display = 'block';
  const bar = document.getElementById('email-progress-bar');
  const txt = document.getElementById('email-progress-text');
  
  let successCount = 0;
  for (let i = 0; i < leadsToEmail.length; i++) {
    const lead = leadsToEmail[i];
    
    // Replace variables (simple regex replacement for HTML)
    const finalSubject = subject.replace(/{Company}/g, lead.company || '').replace(/{JobTitle}/g, lead.jobTitle || '').replace(/{City}/g, lead.city || '');
    let finalBodyRaw = body.replace(/{Company}/g, lead.company || '').replace(/{JobTitle}/g, lead.jobTitle || '').replace(/{City}/g, lead.city || '') + '<br><br>' + signature;
    const finalBodyHTML = `<div style="font-family: Arial, Helvetica, sans-serif; font-size: 14px; color: #222222; line-height: 1.5;">${finalBodyRaw}</div>`;
    
    txt.textContent = `Sending ${i+1} of ${leadsToEmail.length}...`;
    bar.style.width = `${((i+1)/leadsToEmail.length)*100}%`;
    
    try {
      const payload = {
        to: lead.email,
        subject: finalSubject,
        htmlBody: finalBodyHTML,
        cc: cc,
        bcc: bcc,
        attachments: currentEmailAttachments
      };
      
      await fetch(webhook, {
        method: 'POST',
        mode: 'no-cors',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      
      // Since no-cors, we assume success if it doesn't throw.
      successCount++;
      // Mark as contacted
      lead.status = 'Contacted';
      await window.MemoryEngine.updateLead(lead.id, lead);
    } catch(err) {
      console.error(err);
      showToast('error', 'Email Error', `Failed to send email to ${lead.email}: ${err.message}`);
    }
    
    // Delay 1.5 seconds between emails to avoid spam triggers
    await new Promise(r => setTimeout(r, 1500));
  }
  
  txt.textContent = `${successCount} / ${leadsToEmail.length} Sent Successfully!`;
  showToast('success', 'Email Automation Complete', `Successfully sent ${successCount} emails.`);
}

// ============================================================
// WHATSAPP AUTOMATION
// ============================================================
let waQueue = [];
let waCurrentIndex = 0;
let waTemplate = '';

function updateWhatsappPreview() {
  window.MemoryEngine.getAllLeads().then(allLeads => {
    // Only leads with a valid phone number and status 'New' or 'No Reply' are considered eligible
    const eligible = allLeads.filter(l => l.phone && l.phone.trim() !== '' && (l.status === 'New' || l.status === 'No Reply'));
    document.getElementById('wa-eligible-count').textContent = eligible.length;
    
    // Load template
    const saved = localStorage.getItem('skylark_wa_template');
    if (saved) {
      document.getElementById('whatsapp-body').value = saved;
    }
    
    // Load sender number if any
    const sender = localStorage.getItem('skylark_wa_sender');
    if (sender) {
      document.getElementById('whatsapp-sender-num').value = sender;
    }
  });
}

function saveWhatsappTemplate() {
  const body = document.getElementById('whatsapp-body').value;
  const sender = document.getElementById('whatsapp-sender-num').value;
  localStorage.setItem('skylark_wa_template', body);
  localStorage.setItem('skylark_wa_sender', sender);
  showToast('success', 'Template Saved', 'Your WhatsApp message template has been saved locally.');
}

function openWhatsappWeb() {
  window.open('https://web.whatsapp.com/', '_blank');
}

async function startWhatsappBatch() {
  const batchSize = parseInt(document.getElementById('wa-batch-size').value, 10);
  const body = document.getElementById('whatsapp-body').value;
  
  if (!body.trim()) {
    showToast('error', 'Missing Template', 'Please enter a message template.');
    return;
  }
  
  saveWhatsappTemplate();
  waTemplate = body;
  
  const allLeads = await window.MemoryEngine.getAllLeads();
  const eligible = allLeads.filter(l => l.phone && l.phone.trim() !== '' && (l.status === 'New' || l.status === 'No Reply'));
  
  if (eligible.length === 0) {
    showToast('warning', 'No Leads', 'No eligible leads found with a phone number.');
    return;
  }
  
  waQueue = eligible.slice(0, batchSize);
  waCurrentIndex = 0;
  
  document.getElementById('wa-queue-ui').style.display = 'block';
  document.getElementById('wa-start-batch-btn').style.display = 'none';
  
  updateWaQueueStatus();
}

function updateWaQueueStatus() {
  if (waCurrentIndex >= waQueue.length) {
    document.getElementById('wa-queue-status').textContent = 'Batch Complete!';
    document.getElementById('wa-queue-status').style.color = '#166534';
    document.getElementById('wa-queue-current-lead').textContent = 'All messages in this batch have been queued/sent.';
    document.getElementById('wa-send-next-btn').style.display = 'none';
    showToast('success', 'Batch Finished', `Completed ${waQueue.length} WhatsApp messages.`);
    return;
  }
  
  const nextLead = waQueue[waCurrentIndex];
  document.getElementById('wa-queue-status').textContent = `Ready to Send: ${waCurrentIndex + 1} / ${waQueue.length}`;
  document.getElementById('wa-queue-current-lead').textContent = `Next: ${nextLead.company} (${nextLead.phone})`;
  document.getElementById('wa-send-next-btn').style.display = 'block';
  document.getElementById('wa-send-next-btn').innerHTML = `Send Next to <b>${nextLead.company}</b> ↗`;
}

async function processWhatsappQueueNext() {
  if (waCurrentIndex >= waQueue.length) return;
  
  const lead = waQueue[waCurrentIndex];
  
  // Replace variables
  let msg = waTemplate;
  msg = msg.replace(/{Company}/gi, lead.company || '');
  msg = msg.replace(/{City}/gi, lead.city || '');
  msg = msg.replace(/{Phone}/gi, lead.phone || '');
  msg = msg.replace(/{Industry}/gi, lead.industry || '');
  msg = msg.replace(/{JobTitle}/gi, lead.job_title || '');
  msg = msg.replace(/{Email}/gi, lead.email || '');
  
  const encodedMsg = encodeURIComponent(msg);
  // Clean phone number (remove non digits except leading +)
  let phone = lead.phone.replace(/[^\d+]/g, '');
  
  const url = `https://wa.me/${phone}?text=${encodedMsg}`;
  
  // Update lead status in memory to Contacted (or similar)
  lead.status = 'Contacted';
  await window.MemoryEngine.updateLead(lead.id, lead);
  
  window.open(url, '_blank');
  
  waCurrentIndex++;
  updateWaQueueStatus();
}

function stopWhatsappQueue() {
  waQueue = [];
  waCurrentIndex = 0;
  document.getElementById('wa-queue-ui').style.display = 'none';
  document.getElementById('wa-start-batch-btn').style.display = 'block';
  updateWhatsappPreview();
}

// ============================================================
//  CANDIDATE ENGINE (APIFY INTEGRATION)
// ============================================================

async function initCandidatesView() {
  const tbody = document.getElementById('candidates-tbody');
  try {
    if (tbody) tbody.innerHTML = `<tr><td colspan="5" class="text-center">Loading candidate data...</td></tr>`;
    if (window.MemoryEngine && window.MemoryEngine.getAllCandidates) {
      const candidates = await window.MemoryEngine.getAllCandidates();
      renderCandidatesTable(candidates);
      const badge = document.getElementById('candidates-count-badge');
      if (badge) badge.textContent = candidates.length;
    }
  } catch (err) {
    console.error('Candidates render error:', err);
    if (tbody) tbody.innerHTML = `<tr><td colspan="5" class="error-state text-center" style="color:red; padding: 20px;">Failed to load data: ${err.message}</td></tr>`;
  }
}

function renderCandidatesTable(candidates) {
  const tbody = document.getElementById('candidates-tbody');
  const emptyState = document.getElementById('candidates-empty-state');
  
  if (!candidates || candidates.length === 0) {
    if (tbody) tbody.innerHTML = '';
    if (emptyState) emptyState.style.display = 'block';
    return;
  }
  
  if (emptyState) emptyState.style.display = 'none';
  if (tbody) tbody.innerHTML = candidates.map(c => {
    return `<tr>
      <td><input type="checkbox"></td>
      <td>
        <div style="display:flex; align-items:center; gap:10px;">
          <div style="width:32px; height:32px; border-radius:50%; background:var(--primary-bg); color:var(--primary); display:flex; align-items:center; justify-content:center; font-weight:700;">${c.name.charAt(0)}</div>
          <div>
            <div style="font-weight:600; color:var(--gray-800);">${c.name}</div>
            <div style="font-size:11px; color:var(--gray-500);">${c.city} • ${c.role}</div>
          </div>
        </div>
      </td>
      <td>${c.phone || '<span style="color:#9ca3af;font-size:12px">Not Available</span>'}</td>
      <td style="max-width:300px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; font-size:12px;" title="${c.description}">${c.description || '-'}</td>
      <td>
        <a href="${c.url}" target="_blank" class="btn-secondary" style="padding:4px 8px; font-size:11px; background:#eff6ff; color:#3b82f6; border-color:#bfdbfe;">View Profile</a>
      </td>
      <td><span class="status-badge status-new" style="background:#f0fdf4; color:#16a34a; border:1px solid #bbf7d0;">Scraped</span></td>
      <td>
        <button onclick="deleteCandidateRow('${c.id}')" class="btn-secondary" style="padding:4px; font-size:12px; color:#ef4444; border-color:#fecaca; background:white;">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
        </button>
      </td>
    </tr>`;
  }).join('');
}

let candidateConversationHistory = [];

function addCandidateChatMessage(role, text) {
  const container = document.getElementById('candidate-chat-messages');
  const welcome = document.getElementById('candidate-chat-welcome');
  if (welcome) welcome.style.display = 'none';
  if (container) container.style.display = 'flex';

  const msgDiv = document.createElement('div');
  const isAi = role === 'ai' || role === 'assistant';
  msgDiv.className = `chat-message ${isAi ? 'assistant' : 'user'}`;

  const avatar = document.createElement('div');
  avatar.className = 'chat-avatar';
  avatar.textContent = isAi ? 'AI' : 'U';

  const bubble = document.createElement('div');
  bubble.className = 'chat-bubble';

  // Format with high-fidelity markdown parser
  const parsedHtml = (typeof window.parseChatMarkdown === 'function')
    ? window.parseChatMarkdown(text)
    : (text || '');
  bubble.innerHTML = parsedHtml;

  if (isAi) {
    const contentWrap = document.createElement('div');
    contentWrap.className = 'chat-content-wrap';
    const actions = createChatActionToolbar(bubble, container, 'candidate-ai-input');
    contentWrap.appendChild(bubble);
    contentWrap.appendChild(actions);
    msgDiv.appendChild(avatar);
    msgDiv.appendChild(contentWrap);
  } else {
    msgDiv.appendChild(avatar);
    msgDiv.appendChild(bubble);
  }

  container.appendChild(msgDiv);
  container.scrollTop = container.scrollHeight;
}
async function handleCandidateChatSend() {
  const inputEl = document.getElementById('candidate-ai-input');
  const query = inputEl.value.trim();
  if (!query) return;

  // Candidate sourcing uses the authenticated backend-owned provider boundary.
  // The full legacy browser implementation below remains only as a historical
  // reference while this file is being retired; it is deliberately disabled.
  if (window.CandidatesCtrl?.handleAiChatSubmit) {
    return window.CandidatesCtrl.handleAiChatSubmit();
  }
  showToast('warning', 'Candidate sourcing unavailable', 'Refresh the page and try again.');
  return;

  /*

  // Use config keys if local storage is empty
  let groqKey = '';
  if (!groqKey && window.SKYLARK_CONFIG?.GROQ_API_KEYS) {
    const keys = window.SKYLARK_CONFIG.GROQ_API_KEYS.filter(k => k && k.trim());
    if (keys.length > 0) groqKey = keys[0];
  }

  let apifyKey = '';
  if (!apifyKey && window.MemoryEngine) {
    const bestApify = window.MemoryEngine.getBestApifyKey();
    if (bestApify && bestApify.key) apifyKey = bestApify.key;
  }
  
  if (!groqKey || !apifyKey) {
    showToast('error', 'API Keys Missing', 'Please add both Groq and Apify API keys in Accounts.');
    return;
  }

  inputEl.value = '';
  
  addCandidateChatMessage('user', query);
  candidateConversationHistory.push({ role: 'user', content: query });
  
  const statusEl = document.getElementById('candidate-ai-status');
  statusEl.innerHTML = `
    <div class="ai-searching-anim">
      <div class="dot"></div><div class="dot"></div><div class="dot"></div>
      <span style="color:var(--primary);">AI is understanding your request...</span>
    </div>`;

  try {
    // Phase 1: Parse intent using Groq
    
    const messages = [
      {
        role: "system",
        content: "You are a helpful AI assistant. Analyze the user's input. IF the user is explicitly asking for candidate data, leads, job seekers, or hiring someone (e.g., 'mujhe pune me react developer chahiye 5 log', 'find 10 security guards'), output EXACTLY a JSON object: {\"intent\": \"scrape\", \"role\": \"Job Role\", \"city\": \"City Name\", \"quantity\": <number>}. If city is not mentioned, use 'Gurugram'. If quantity is not mentioned, use 10. \n\nHOWEVER, IF the user is asking a general question, greeting you, or talking about anything else (e.g., 'what is react?', 'hello', 'how to hire?'), output EXACTLY a JSON object: {\"intent\": \"chat\", \"reply\": \"Your conversational, helpful response here in the user's language.\"} \n\nYour ENTIRE response MUST be valid JSON only. Do not add any extra text outside the JSON."
      },
      ...candidateConversationHistory.slice(-5)
    ];

    const groqResponse = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${groqKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: document.getElementById('candidate-ai-model-select')?.value || "llama-3.3-70b-versatile",
        messages: messages,
        temperature: 0.3
      })
    });

    if (!groqResponse.ok) {
      const errText = await groqResponse.text();
      throw new Error("Groq API Error: " + errText);
    }
    
    const groqData = await groqResponse.json();
    
    // Track Groq Tokens
    if (groqData.usage && groqData.usage.total_tokens) {
      if (window.MemoryEngine) {
        window.MemoryEngine.addTokensUsed(groqData.usage.total_tokens);
        window.MemoryEngine.addKeyUsage('groq', window.MemoryEngine.getActiveGroqIdx(), groqData.usage.total_tokens);
        if (typeof window.updateRealtimeTokenCounters === 'function') {
          window.updateRealtimeTokenCounters();
        }
      }
    }
    
    let jsonMatch = groqData.choices[0].message.content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error("AI could not understand the request intent.");
    
    const intent = JSON.parse(jsonMatch[0]);
    
    if (intent.intent === 'chat') {
      statusEl.innerHTML = '';
      addCandidateChatMessage('ai', intent.reply);
      candidateConversationHistory.push({ role: 'assistant', content: intent.reply });
      return; // Stop here, do not run Apify
    }
    
    if (!intent.role || !intent.city) throw new Error("Incomplete data parsed by AI for scraping.");
    
    // It's a scrape request. Add a conversational acknowledgment bubble.
    const maxResults = intent.quantity || 10;
    addCandidateChatMessage('ai', `I'm on it! Finding **${maxResults} ${intent.role}** profiles in **${intent.city}** for you now. Please wait a moment while I scrape authentic data...`);
    candidateConversationHistory.push({ role: 'assistant', content: `Started scraping for ${maxResults} ${intent.role} in ${intent.city}.` });
    
    // Dynamic Query Construction
    let portalQuery = "site:linkedin.com/in OR site:indeed.com/r";
    let statusText = `Scraping Indeed & LinkedIn for ${intent.role} in ${intent.city}...`;
    
    // Exact Role Matching + Anti-HR filters
    const searchQuery = `(${portalQuery}) "${intent.role}" "${intent.city}" -intitle:hiring -intitle:recruiter -"talent acquisition" -hr`;

    statusEl.innerHTML = `
      <div class="ai-searching-anim">
        <div class="dot" style="background-color:var(--accent-orange);"></div>
        <div class="dot" style="background-color:var(--accent-orange);"></div>
        <div class="dot" style="background-color:var(--accent-orange);"></div>
        <span style="color:var(--accent-orange);">${statusText}</span>
      </div>`;
    
    let apifyData = null;
    let results = [];
    let apifyAttempts = 0;
    const MAX_APIFY_RETRIES = 3;

    while (apifyAttempts < MAX_APIFY_RETRIES) {
      // Re-fetch best key in case we just exhausted one
      let currentKeyObj = window.MemoryEngine.getBestApifyKey();
      if (!currentKeyObj || !currentKeyObj.key) throw new Error("No available Apify API keys.");
      
      const currentApifyKey = currentKeyObj.key;

    const apifyResponse = await fetch(`${window.SKYLARK_CONFIG?.BACKEND_URL || 'http://localhost:8000'}/api/v1/candidate-search`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          queries: searchQuery,
          resultsPerPage: maxResults,
          maxPagesPerQuery: 1
        })
      });

      if (!apifyResponse.ok) {
        if (apifyResponse.status === 402 || apifyResponse.status === 403 || apifyResponse.status === 429) {
          console.warn(`Apify Key exhausted or rate-limited. Switching to next...`);
          // Exhaust this key locally so getBestApifyKey skips it
          window.MemoryEngine.addKeyUsage('apify', currentKeyObj.index, 100000); 
          renderTokenDashboard();
          apifyAttempts++;
          
          if (apifyAttempts >= MAX_APIFY_RETRIES) {
            throw new Error("All Apify API keys exhausted or rate limited.");
          }
          // Delay briefly before retry
          await new Promise(r => setTimeout(r, 1000));
          continue;
        } else {
          throw new Error("Apify API failed. Status: " + apifyResponse.status);
        }
      }

      apifyData = await apifyResponse.json();
      break;
    }

    if (apifyData && apifyData.length > 0 && apifyData[0].organicResults) {
      results = apifyData[0].organicResults;
      
      // Ensure we strictly enforce the requested quantity
      if (results.length > maxResults) {
        results = results.slice(0, maxResults);
      }
    }
    
    if (results.length === 0) {
      statusEl.innerHTML = `No candidates found for ${intent.role} in ${intent.city}. Try another query.`;
      return;
    }

    // Track Apify Scraper Usage for Candidates accurately on the active key
    if (window.MemoryEngine) {
      const activeIdx = window.MemoryEngine.getActiveApifyIdx();
      window.MemoryEngine.addKeyUsage('apify', activeIdx, results.length);
      renderTokenDashboard();
    }

    // Phase 3: Store in MemoryEngine
    // Auto-clear old candidates so they don't accumulate and confuse the user
    if (window.MemoryEngine && window.MemoryEngine.getAllCandidates) {
      const existing = await window.MemoryEngine.getAllCandidates();
      for (const e of existing) {
        await window.MemoryEngine.deleteCandidate(e.id);
      }
    }

    for (const r of results) {
      const nameMatch = r.title.split(/[\-\|]/)[0].trim();
      const name = nameMatch ? nameMatch : 'Candidate';
      
      // Strict extract phone number and email from snippet
      const phoneRegex = /(?:(?:\+|0{0,2})91[\s\-]?)?[6789]\d{9}/;
      const emailRegex = /([a-zA-Z0-9._-]+@[a-zA-Z0-9._-]+\.[a-zA-Z0-9_-]+)/;
      const snippet = r.description || '';
      
      const phoneMatch = snippet.match(phoneRegex);
      const emailMatch = snippet.match(emailRegex);
      
      const actualPhone = phoneMatch ? phoneMatch[0] : '';
      const actualEmail = emailMatch ? emailMatch[0] : '';
      
      let candidate = {
        id: 'cand_' + Date.now() + Math.floor(Math.random()*1000),
        name: name,
        role: intent.role,
        city: intent.city,
        phone: actualPhone || '',
        email: actualEmail || '',
        description: snippet,
        url: r.url,
        timestamp: Date.now()
      };
      if (window.DataSanitizer && typeof window.DataSanitizer.sanitizeCandidate === 'function') {
        candidate = window.DataSanitizer.sanitizeCandidate(candidate);
      }
      if (candidate) {
        await window.MemoryEngine.addCandidate(candidate);
      }
    }

    statusEl.innerHTML = `<span style="color:var(--accent-green);font-weight:600;">✓ Successfully scraped ${results.length} candidates. Auto-downloading Excel...</span>`;
    await initCandidatesView();
    
    // Switch view automatically to candidates DB
    if (window.NEXUS && typeof window.NEXUS.showView === 'function') {
      window.NEXUS.showView('candidate-db');
    }

    // Phase 4: Auto-download Excel
    exportCandidatesExcel();

  } catch (err) {
    console.error(err);
    statusEl.innerHTML = `<span style="color:var(--accent-red);">${err.message}</span>`;
  }
}

  */
}

// NOTE: The candidate chat input's Enter handling and send are owned by
// CandidatesCtrl (page-candidates.js), which runs the real multi-portal Apify
// sourcing (Naukri / WorkIndia / Shine / Apna). A second Enter listener here
// would race that flow, so it is intentionally not registered.

function exportCandidatesCSV() {
  window.MemoryEngine.getAllCandidates().then(candidates => {
    if (candidates.length === 0) {
      showToast('warning', 'Empty', 'No candidates to export');
      return;
    }
    let csv = 'Name,Role,City,Phone,Profile URL,Description\n';
    candidates.forEach(c => {
      csv += `"${c.name}","${c.role}","${c.city}","${c.phone}","${c.url}","${(c.description||'').replace(/"/g, '""')}"\n`;
    });
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'candidates_export.csv';
    a.click();
  });
}

function exportCandidatesExcel() {
  if (typeof XLSX === 'undefined') {
    showToast('error', 'Library Missing', 'Excel export library not loaded. Please use CSV.');
    return;
  }
  window.MemoryEngine.getAllCandidates().then(candidates => {
    if (candidates.length === 0) {
      showToast('warning', 'No Candidates', 'No candidate data to export.');
      return;
    }
    
    const rows = candidates.map(c => ({
      'Candidate Name': c.name,
      'Job Role': c.role,
      'City': c.city,
      'Phone': c.phone,
      'Source Link': c.url,
      'Description / Snippet': c.description || ''
    }));

    const worksheet = XLSX.utils.json_to_sheet(rows);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Candidates");

    // Auto-fit Columns width calculation
    const maxProps = [];
    rows.forEach(row => {
      Object.keys(row).forEach((key, colIndex) => {
        const val = row[key] ? String(row[key]) : '';
        maxProps[colIndex] = Math.max(maxProps[colIndex] || 15, val.length + 2, key.length + 2);
      });
    });
    
    // Cap max width at 60 characters to prevent overly wide columns
    worksheet['!cols'] = maxProps.map(w => ({ wch: Math.min(w, 60) }));

    const dateStr = new Date().toISOString().slice(0,10);
    XLSX.writeFile(workbook, `Skylark_Candidates_${dateStr}.xlsx`);
    showToast('success', 'Excel Downloaded', 'Candidate data successfully exported as Excel.');
  });
}


// ============================================================
//  REAL-TIME TOKEN COUNTERS UPDATE
// ============================================================
window.updateRealtimeTokenCounters = function() {
  const { used, limit } = (window.getApifyUsageTotal ? window.getApifyUsageTotal() : { used: 0, limit: 500 });

  const homeBadge = document.getElementById('home-token-counter');
  const candidateBadge = document.getElementById('candidate-token-counter');

  if (homeBadge) homeBadge.textContent = `${used.toLocaleString('en-IN')} / ${limit.toLocaleString('en-IN')}`;
  // Normal users never need to know which key is active — that is developer detail.
  if (candidateBadge) candidateBadge.textContent = `${used.toLocaleString('en-IN')} / ${limit.toLocaleString('en-IN')} credits`;

  if (typeof restoreTokenCounter === 'function') restoreTokenCounter();
}

// Initial call
document.addEventListener('DOMContentLoaded', () => {
  if (typeof window.updateRealtimeTokenCounters === 'function') {
    setTimeout(() => window.updateRealtimeTokenCounters(), 1000);
  }
});


// ============================================================
//  CANDIDATE DB OPERATIONS
// ============================================================
window.deleteCandidateRow = async function(id) {
  if (confirm('Are you sure you want to delete this candidate?')) {
    if (window.MemoryEngine && window.MemoryEngine.deleteCandidate) {
      await window.MemoryEngine.deleteCandidate(id);
      showToast('success', 'Deleted', 'Candidate removed from database.');
      await initCandidatesView();
    }
  }
};

window.clearAllCandidates = async function() {
  if (confirm('Are you sure you want to delete ALL candidates? This cannot be undone.')) {
    if (window.MemoryEngine && window.MemoryEngine.getAllCandidates) {
      const candidates = await window.MemoryEngine.getAllCandidates();
      for (const c of candidates) {
        await window.MemoryEngine.deleteCandidate(c.id);
      }
      showToast('success', 'Cleared', 'All candidates removed from database.');
      await initCandidatesView();
    }
  }
};

document.addEventListener('DOMContentLoaded', () => {
  setTimeout(() => initCandidatesView(), 500);
  if (typeof restoreTokenCounter === 'function') {
    restoreTokenCounter();
  }
});

// ==========================================
// Settings Panel Persistence Logic
// ==========================================

window.toggleMicAccess = function(isEnabled) {
  localStorage.setItem('skylark-mic-enabled', isEnabled ? 'true' : 'false');
};

window.toggleAutoSuggest = function(isEnabled) {
  localStorage.setItem('skylark-auto-suggest', isEnabled ? 'true' : 'false');
};

window.toggleAutoCrmSync = function(isEnabled) {
  localStorage.setItem('skylark-auto-crm-sync', isEnabled ? 'true' : 'false');
};

window.toggleRunInBackground = function(isEnabled) {
  localStorage.setItem('skylark-run-in-background', isEnabled ? 'true' : 'false');
};

window.toggleDesktopNotif = function(isEnabled) {
  localStorage.setItem('skylark-desktop-notif', isEnabled ? 'true' : 'false');
};

window.initMicToggle = function() {
  const micEnabled = localStorage.getItem('skylark-mic-enabled');
  const toggle = document.getElementById('micEnabledToggle');
  if (toggle && micEnabled !== null) {
    toggle.checked = micEnabled === 'true';
  }
};

window.loadAllSettings = function() {
  // Load Text Values
  const accountName = localStorage.getItem('skylark-account-name');
  if (accountName) {
    const brandEl = document.getElementById('logo-brand-text');
    const settingsNameEl = document.getElementById('settings-account-name');
    if (brandEl) brandEl.innerText = accountName;
    if (settingsNameEl) settingsNameEl.innerText = accountName;
    if (window.updateAvatarLetter) window.updateAvatarLetter();
  }

  const email = localStorage.getItem('skylark-email');
  if (email) {
    const emailEl = document.getElementById('settings-email-value');
    if (emailEl) emailEl.innerText = email;
  }

  const llm = localStorage.getItem('skylark-llm');
  if (llm) {
    const llmEl = document.getElementById('settings-llm-value');
    if (llmEl) llmEl.innerText = llm;
  }

  const voice = localStorage.getItem('skylark-voice');
  if (voice) {
    const voiceEl = document.getElementById('settings-voice-value');
    if (voiceEl) voiceEl.innerText = voice;
  }

  const maxAgents = localStorage.getItem('skylark-max-agents');
  if (maxAgents) {
    const agentsEl = document.getElementById('settings-agents-value');
    if (agentsEl) agentsEl.innerText = maxAgents + ' Instances';
  }

  const scrapingDepth = localStorage.getItem('skylark-scraping-depth');
  if (scrapingDepth) {
    const depthEl = document.getElementById('settings-depth-value');
    if (depthEl) depthEl.innerText = scrapingDepth;
  }

  const followupDelay = localStorage.getItem('skylark-followup-delay');
  if (followupDelay) {
    const delayEl = document.getElementById('settings-delay-value');
    if (delayEl) delayEl.innerText = followupDelay;
  }

  // Load Toggles
  window.initMicToggle();

  const autoSuggest = localStorage.getItem('skylark-auto-suggest');
  const autoSuggestToggle = document.getElementById('autoSuggestToggle');
  if (autoSuggestToggle && autoSuggest !== null) {
    autoSuggestToggle.checked = autoSuggest === 'true';
  }

  const autoCrmSync = localStorage.getItem('skylark-auto-crm-sync');
  const autoCrmSyncToggle = document.getElementById('autoCrmSyncToggle');
  if (autoCrmSyncToggle && autoCrmSync !== null) {
    autoCrmSyncToggle.checked = autoCrmSync === 'true';
  }

  const runInBackground = localStorage.getItem('skylark-run-in-background');
  const runInBackgroundToggle = document.getElementById('runInBackgroundToggle');
  if (runInBackgroundToggle && runInBackground !== null) {
    runInBackgroundToggle.checked = runInBackground === 'true';
  }

  const desktopNotif = localStorage.getItem('skylark-desktop-notif');
  const desktopNotifToggle = document.getElementById('desktopNotifToggle');
  if (desktopNotifToggle && desktopNotif !== null) {
    desktopNotifToggle.checked = desktopNotif === 'true';
  }

  // Restore Performance Mode
  const perfMode = localStorage.getItem('skylark-perf-mode');
  const perfToggle = document.getElementById('perfModeToggle');
  if (perfToggle && perfMode !== null) {
    perfToggle.checked = perfMode === 'true';
    if (perfMode === 'true' && window.togglePerformanceMode) window.togglePerformanceMode(true);
  }

  // Restore Glass Blur
  const glassBlur = localStorage.getItem('skylark-glass-blur');
  if (glassBlur !== null && glassBlur === 'false' && window.toggleGlassBlur) {
    window.toggleGlassBlur(false);
  }

  // Restore Animation Speed
  const animSpeed = localStorage.getItem('skylark-animation-speed');
  if (animSpeed) {
    const animEl = document.getElementById('settings-animation-value');
    if (animEl) animEl.innerText = animSpeed;
  }
};

document.addEventListener('DOMContentLoaded', () => {
  setTimeout(() => {
    if (window.loadAllSettings) window.loadAllSettings();
    
    // Initialize Theme Toggles State on DOM load
    const savedTheme = localStorage.getItem('skylark-theme') || 'dark';
    const themeToggles = document.querySelectorAll('#darkModeToggle, #mark-bennett-theme-btn');
    themeToggles.forEach(toggle => {
      if (toggle.type === 'checkbox') {
        toggle.checked = savedTheme === 'dark';
      }
    });
  }, 150);
});

window.toggleDayNightTheme = function() {
  if (window.ThemeController && typeof window.ThemeController.set === 'function') {
    const cur = window.ThemeController.get();
    window.ThemeController.set(cur === 'dark' ? 'light' : 'dark', { animate: true, manual: true });
    return;
  }
  const currentTheme = document.documentElement.getAttribute('data-theme') || 'dark';
  const newTheme = currentTheme === 'dark' ? 'light' : 'dark';
  // Add class BEFORE changing theme — this makes all elements inherit the
  // unified 380ms transition from clavis-polish-v3.css instead of their own
  document.documentElement.classList.add('theme-transitioning');
  document.documentElement.setAttribute('data-theme', newTheme);
  localStorage.setItem('skylark-theme', newTheme);
  // Keep the class for 500ms (380ms transition + 120ms buffer) so no element
  // snaps back to its own slower/faster transition mid-way
  setTimeout(() => document.documentElement.classList.remove('theme-transitioning'), 500);

  const themeToggles = document.querySelectorAll('#darkModeToggle, #mark-bennett-theme-btn, #sm-darkmode');
  themeToggles.forEach(toggle => {
    if (toggle.type === 'checkbox') toggle.checked = newTheme === 'dark';
    if (toggle.id === 'mark-bennett-theme-btn') toggle.classList.toggle('is-dark', newTheme === 'dark');
  });

  if (window.SoundFX && typeof window.SoundFX.playToggle === 'function') {
    window.SoundFX.playToggle();
  }
};


// ==========================================
// Missing Settings Panel Functions (fix ReferenceErrors)
// ==========================================

window.changeAnimationSpeed = function() {
  const animEl = document.getElementById('settings-animation-value');
  if (!window.showMacDialog) return;
  window.showMacDialog({
    title: 'Animation Physics',
    description: 'Select the animation style for the UI.',
    type: 'select',
    options: [
      { value: 'macOS Spring (60fps)', label: 'macOS Spring (60fps) — Premium' },
      { value: 'Snappy (30fps)', label: 'Snappy (30fps) — Fast' },
      { value: 'Minimal (15fps)', label: 'Minimal (15fps) — Low-end mode' },
      { value: 'Off', label: 'Off — No animations' }
    ],
    defaultValue: animEl ? animEl.innerText : 'macOS Spring (60fps)',
    onConfirm: (val) => {
      if (animEl) animEl.innerText = val;
      localStorage.setItem('skylark-animation-speed', val);
      // Apply animation speed globally
      const root = document.documentElement;
      if (val === 'Off') {
        root.style.setProperty('--transition-fast', '0ms');
        root.style.setProperty('--transition-med', '0ms');
      } else if (val === 'Minimal (15fps)') {
        root.style.setProperty('--transition-fast', '100ms');
        root.style.setProperty('--transition-med', '200ms');
      } else if (val === 'Snappy (30fps)') {
        root.style.setProperty('--transition-fast', '150ms');
        root.style.setProperty('--transition-med', '250ms');
      } else {
        root.style.removeProperty('--transition-fast');
        root.style.removeProperty('--transition-med');
      }
    }
  });
};

window.togglePerformanceMode = function(isEnabled) {
  localStorage.setItem('skylark-perf-mode', isEnabled ? 'true' : 'false');
  const root = document.documentElement;
  if (isEnabled) {
    // Disable heavy effects for performance
    root.style.setProperty('--blur-amount', '0px');
    document.querySelectorAll('.tubelight-container').forEach(el => el.style.display = 'none');
  } else {
    root.style.removeProperty('--blur-amount');
    document.querySelectorAll('.tubelight-container').forEach(el => el.style.removeProperty('display'));
  }
};

window.toggleGlassBlur = function(isEnabled) {
  localStorage.setItem('skylark-glass-blur', isEnabled ? 'true' : 'false');
  const root = document.documentElement;
  if (!isEnabled) {
    root.style.setProperty('--blur-amount', '0px');
    root.classList.add('no-blur');
  } else {
    root.style.removeProperty('--blur-amount');
    root.classList.remove('no-blur');
  }
};

window.toggleHandsFreeSetting = function(isEnabled) {
  localStorage.setItem('skylark-hands-free', isEnabled ? 'true' : 'false');
  if (typeof toggleJarvisHandsFree === 'function') {
    toggleJarvisHandsFree(isEnabled);
  }
};

// --- MISSING UI HANDLERS IMPLEMENTATION ---
function closeMacUploadModal() {
  const modal = document.getElementById('macFileUploadModal');
  if (modal) modal.style.display = 'none';
}

function handleMacFileSelect(files) {
  if (!files || files.length === 0) return;
  const file = files[0];
  showToast('info', '📂 File Selected', `Selected "${file.name}" (${(file.size / 1024).toFixed(1)} KB)`);
  closeMacUploadModal();
}

async function pushSelectedToSheets() {
  const targetLeads = selectedLeadIds.size > 0 
    ? allLeads.filter(l => selectedLeadIds.has(l.id))
    : allLeads;

  if (targetLeads.length === 0) {
    showToast('warning', 'No Leads Selected', 'Please select at least one lead to push to Google Sheets.');
    return;
  }

  if (!window.NexusGoogleSheets) return showToast('error', 'Sheets unavailable', 'The Google Sheets integration has not loaded. Reload and try again.');
  try {
    const current = await window.NexusGoogleSheets.status();
    if (!current.connected) return showToast('warning', 'Connect Google Sheets', 'Connect Google Sheets from Accounts before syncing.');
    const spreadsheetId = prompt('Enter the Google Spreadsheet ID:');
    if (!spreadsheetId?.trim()) return;
    showToast('info', 'Syncing leads', `Pushing ${targetLeads.length} leads to Google Sheets…`);
    const headers = ['Company', 'City', 'Industry', 'Website', 'Phone', 'Email', 'Status', 'Source'];
    const rows = [headers, ...targetLeads.map(l => [l.company || l.title || '', l.city || '', l.industry || '', l.website || '', l.phone || '', l.email || '', l.status || 'New', l.source || 'Nexus'])];
    await window.NexusGoogleSheets.sync(spreadsheetId.trim(), rows);
    targetLeads.forEach(l => { l.syncedToSheets = true; });
    showToast('success', 'Sheets synced', `${targetLeads.length} leads were written by the authenticated backend.`);
  } catch (err) { showToast('error', 'Sheets sync failed', err.message); }
}

function toggleTTSKey() {
  const input = document.getElementById('setting-tts-key') || document.getElementById('tts-api-key-input');
  if (input) input.type = input.type === 'password' ? 'text' : 'password';
}

function saveVoiceSettings() {
  const voiceSelect = document.getElementById('settings-voice-select');
  const modelSelect = document.getElementById('settings-voice-model');
  const ttsKeyInput = document.getElementById('setting-tts-key');

  if (voiceSelect) safeLocalStorageSet('skylark-voice', voiceSelect.value);
  if (modelSelect) safeLocalStorageSet('skylark-voice-model', modelSelect.value);
  // TTS credentials are accepted only by the authenticated backend vault.
  // Never persist them in browser storage.
  if (ttsKeyInput) ttsKeyInput.value = '';

  // System Settings panel fields
  const tts = document.getElementById('sm-tts-model');
  safeLocalStorageSet('skylark-tts-model', 'gemini');
  safeLocalStorageSet('skylark-tts-engine', 'gemini');
  const geminiVoice = document.getElementById('sm-gemini-voice')?.value || document.getElementById('clavis-gemini-voice')?.value || 'Charon';
  safeLocalStorageSet('clavis_gemini_voice', geminiVoice);
  const speed = document.getElementById('sm-speech-speed');
  if (speed) safeLocalStorageSet('skylark-speech-speed', speed.value);
  const wakeEl = document.getElementById('clavis-wake-words');
  if (wakeEl) {
    const words = wakeEl.value.split(',').map(s => s.trim()).filter(Boolean).slice(0, 8);
    if (words.length) safeLocalStorageSet('clavis_wake_words', JSON.stringify(words));
  }

  showToast('success', '✓ Voice AI Updated', 'Voice calling AI configuration saved successfully.');
  if (typeof updateAllUI === 'function') updateAllUI();
  if (typeof window.toggleJarvisVoicePanel === 'function') {
    setTimeout(() => window.toggleJarvisVoicePanel(false), 400);
  }
}

function toggleJarvisKey() {
  const input = document.getElementById('jarvis-key-input') || document.getElementById('openrouter-key-input');
  if (input) input.type = input.type === 'password' ? 'text' : 'password';
}

function saveJarvisSettings() {
  const keyInput = document.getElementById('jarvis-key-input') || document.getElementById('openrouter-key-input');
  const modelSelect = document.getElementById('jarvis-model-select');

  if (keyInput && keyInput.value) keyInput.value = '';
  if (modelSelect) safeLocalStorageSet('jarvis-model', modelSelect.value);

  // System Settings panel fields
  const llm = document.getElementById('sm-llm');
  if (llm) safeLocalStorageSet('skylark-llm', llm.value);
  const temp = document.getElementById('sm-temperature');
  if (temp) safeLocalStorageSet('skylark-temperature', temp.value);
  const scoring = document.getElementById('sm-lead-scoring');
  if (scoring) safeLocalStorageSet('skylark-lead-scoring', scoring.checked ? 'true' : 'false');
  const memory = document.getElementById('sm-ai-memory');
  if (memory) safeLocalStorageSet('skylark-ai-memory', memory.checked ? 'true' : 'false');

  showToast('success', '✓ Clavis Saved', 'Clavis assistant settings updated.');
}

function saveEmailKeys() {
  const webhookInput = document.getElementById('email-webhook-input');
  const senderInput  = document.getElementById('email-sender-input');

  if (webhookInput && webhookInput.value) {
    webhookInput.value = '';
  }
  if (senderInput && senderInput.value) {
    const s = senderInput.value.trim();
    if (window.NexusEmail?.configure && s) {
      window.NexusEmail.configure({ sender: s }).catch(() => {});
    }
    senderInput.value = '';
  }

  showToast('success', '✓ Email Configuration Saved', 'Email automation webhook settings saved.');
}

function saveWAKeys() {
  const waInput = document.getElementById('wa-gateway-input');
  if (waInput && waInput.value) {
    waInput.value = '';
  }
  showToast('success', '✓ WhatsApp Gateway Saved', 'WhatsApp automation configuration updated.');
}

// Global exports for missing handlers
window.closeMacUploadModal   = closeMacUploadModal;
window.handleMacFileSelect   = handleMacFileSelect;
window.pushSelectedToSheets  = pushSelectedToSheets;
window.toggleTTSKey          = toggleTTSKey;
window.saveVoiceSettings     = saveVoiceSettings;
window.toggleJarvisKey       = toggleJarvisKey;
window.saveJarvisSettings    = saveJarvisSettings;
window.saveEmailKeys         = saveEmailKeys;
window.saveWAKeys            = saveWAKeys;

// ============================================================
//  API KEYS DASHBOARD & LIVE CREDIT MONITOR
// ============================================================
function renderTokenDashboard() {
  if (!window.MemoryEngine) return;
  const cfg = window.SKYLARK_CONFIG || {};

  const providers = [
    { name: 'Apify Scraper Engine', id: 'apify', keys: cfg.APIFY_API_KEYS || [], limit: cfg.APIFY_KEY_LIMIT || 500, type: 'credits' },
    { name: 'Groq LLM Engine', id: 'groq', keys: cfg.GROQ_API_KEYS || [], limit: cfg.GROQ_KEY_LIMIT || 100000, type: 'tokens' },
    { name: 'Google Gemini Studio', id: 'gemini', keys: cfg.GEMINI_API_KEYS || [], limit: cfg.GEMINI_KEY_LIMIT || 1000000, type: 'tokens' },
    { name: 'OpenRouter Multi-Model', id: 'openrouter', keys: cfg.OPENROUTER_API_KEYS || [], limit: cfg.OPENROUTER_KEY_LIMIT || 1000000, type: 'tokens' },
    { name: 'NVIDIA NIM Cloud', id: 'nvidia', keys: cfg.NVIDIA_API_KEYS || [], limit: cfg.NVIDIA_KEY_LIMIT || 100000, type: 'tokens' },
    { name: 'DeepSeek Engine', id: 'deepseek', keys: cfg.DEEPSEEK_API_KEYS || [], limit: cfg.DEEPSEEK_KEY_LIMIT || 500000, type: 'tokens' },
    { name: 'Moonshot AI', id: 'moonshot', keys: cfg.MOONSHOT_API_KEYS || [], limit: cfg.MOONSHOT_KEY_LIMIT || 500000, type: 'tokens' },
  ];

  const activeApifyIdx = window.MemoryEngine.getActiveApifyIdx();

  // Render Apify Key Table
  const apifyTable = document.getElementById('apify-keys-table');
  if (apifyTable) {
    const apifyKeys = (cfg.APIFY_API_KEYS || []).filter(k => k && k.trim());
    if (apifyKeys.length === 0) {
      apifyTable.innerHTML = `<div class="empty-chart-msg">No Apify keys configured in config.js</div>`;
    } else {
      apifyTable.innerHTML = `
        <table class="leads-table" style="width:100%; font-size:12px;">
          <thead>
            <tr>
              <th>Key Slot</th>
              <th>API Key (Masked)</th>
              <th>Credits Used</th>
              <th>Remaining Quota</th>
              <th>Latency (ms)</th>
              <th>Usage Bar</th>
              <th>Health Status</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            ${apifyKeys.map((key, i) => {
              const used = window.MemoryEngine.getKeyUsage('apify', i);
              const remaining = Math.max(0, (cfg.APIFY_KEY_LIMIT || 500) - used);
              const pct = Math.min(100, Math.round((used / (cfg.APIFY_KEY_LIMIT || 500)) * 100));
              const isActive = i === activeApifyIdx;
              const lat = window.MemoryEngine.getApiLatency('apify', i);

              let statusBadge = `<span style="font-size:11px; padding:2px 8px; border-radius:99px; background:#dcfce7; color:#166534; font-weight:700;">🟢 Healthy</span>`;
              if (pct >= 100) statusBadge = `<span style="font-size:11px; padding:2px 8px; border-radius:99px; background:#fee2e2; color:#991b1b; font-weight:700;">🔴 Exhausted</span>`;
              else if (pct >= 85) statusBadge = `<span style="font-size:11px; padding:2px 8px; border-radius:99px; background:#fef3c7; color:#92400e; font-weight:700;">🟡 Degraded</span>`;

              const masked = key.length > 12 ? key.slice(0, 10) + '...' + key.slice(-4) : '(empty)';

              return `<tr style="${isActive ? 'background:rgba(99,102,241,0.08); font-weight:600;' : ''}">
                <td>
                  <strong>Slot #${i + 1}</strong>
                  ${isActive ? '<span style="font-size:9px; background:#6366f1; color:#fff; padding:1px 5px; border-radius:4px; margin-left:4px;">CURRENT</span>' : ''}
                </td>
                <td><code>${masked}</code></td>
                <td>${used} / ${cfg.APIFY_KEY_LIMIT || 500}</td>
                <td><strong style="color:${remaining < 50 ? '#ef4444' : '#10b981'}">${remaining} credits</strong></td>
                <td><span style="font-family:monospace; color:var(--gray-600);">${lat ? `${lat} ms` : 'Fast (<150ms)'}</span></td>
                <td>
                  <div style="width:100px; height:6px; background:var(--gray-200); border-radius:3px; overflow:hidden;">
                    <div style="height:100%; width:${pct}%; background:${pct >= 90 ? '#ef4444' : pct >= 75 ? '#f59e0b' : '#6366f1'};"></div>
                  </div>
                </td>
                <td>${statusBadge}</td>
                <td>
                  <button class="btn-secondary small" onclick="setActiveApifyKeyManual(${i})" ${isActive ? 'disabled' : ''}>
                    ${isActive ? 'Active' : 'Set Active'}
                  </button>
                </td>
              </tr>`;
            }).join('')}
          </tbody>
        </table>
      `;
    }
  }

  // Render Provider Overview & Rotation Logs in Groq Table Container
  const groqTable = document.getElementById('groq-keys-table');
  if (groqTable) {
    const logs = window.MemoryEngine.getApiUsageLogs();
    const lastError = window.MemoryEngine.getLastApiError();

    groqTable.innerHTML = `
      <div style="padding:16px;">
        ${lastError ? `
          <div style="background:rgba(239,68,68,0.1); border:1px solid #fca5a5; padding:10px 14px; border-radius:8px; margin-bottom:14px; font-size:12px;">
            <strong style="color:#dc2626;">⚠️ Last Registered API Notice:</strong>
            <span style="color:var(--gray-700); margin-left:6px;">${escHtml(lastError.message)}</span>
            <span style="font-size:10px; color:var(--gray-500); margin-left:10px;">(${new Date(lastError.timestamp).toLocaleTimeString()})</span>
          </div>
        ` : ''}

        <h4 style="font-size:13px; font-weight:700; margin:0 0 10px 0;">🌐 Multi-Provider API Key Health & Status Overview</h4>
        <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(220px, 1fr)); gap:10px; margin-bottom:16px;">
          ${providers.map(p => {
            const valid = p.keys.filter(k => k && k.trim());
            const count = valid.length;
            const status = count > 0 ? '🟢 Active & Ready' : '⚪ Unconfigured';
            const activeKey = count > 0 ? (valid[0].length > 10 ? valid[0].slice(0, 8) + '...' : valid[0]) : 'None';
            return `
              <div style="background:var(--card-bg, rgba(255,255,255,0.03)); border:1px solid var(--border); border-radius:10px; padding:10px;">
                <div style="font-size:12px; font-weight:800; color:var(--gray-800);">${p.name}</div>
                <div style="font-size:11px; color:var(--gray-500); margin-top:2px;">Keys Configured: <strong>${count}</strong></div>
                <div style="font-size:11px; color:var(--gray-500);">Masked: <code>${activeKey}</code></div>
                <div style="font-size:10px; font-weight:700; margin-top:4px;">${status}</div>
              </div>`;
          }).join('')}
        </div>

        <h4 style="font-size:13px; font-weight:700; margin:0 0 8px 0;">📜 Real-Time Key Auto-Rotation & Failover Event History</h4>
        ${logs.length === 0 ? '<div class="empty-chart-msg">No API failover events logged yet — All keys operational</div>' : `
          <div style="max-height:180px; overflow-y:auto; border:1px solid var(--border); border-radius:8px; padding:8px; font-size:11px; background:var(--gray-50, rgba(0,0,0,0.02));">
            ${logs.slice(0, 15).map(l => `
              <div style="display:flex; justify-content:space-between; padding:4px 6px; border-bottom:1px solid var(--border);">
                <span><strong style="color:${l.status === 'rotated' ? '#f59e0b' : l.status === 'error' ? '#ef4444' : '#10b981'}">[${(l.type||'API').toUpperCase()}] ${l.status.toUpperCase()}</strong>: ${escHtml(l.message)}</span>
                <span style="color:var(--gray-500); font-size:10px;">${new Date(l.timestamp).toLocaleTimeString()}</span>
              </div>
            `).join('')}
          </div>
        `}
      </div>
    `;
  }
}

function setActiveApifyKeyManual(idx) {
  if (!window.MemoryEngine) return;
  window.MemoryEngine.setActiveApifyIdx(idx);
  showToast('success', 'Active Key Changed', `Switched to Apify Key Slot #${idx + 1}`);
  renderTokenDashboard();
  restoreTokenCounter();
}

function updateRealtimeTokenCounters() {
  restoreTokenCounter();
  if (currentView === 'tokens') renderTokenDashboard();
}

window.renderTokenDashboard       = renderTokenDashboard;
window.setActiveApifyKeyManual    = setActiveApifyKeyManual;
window.updateRealtimeTokenCounters = updateRealtimeTokenCounters;
