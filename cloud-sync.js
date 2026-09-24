/**
 * cloud-sync.js
 * High-Performance Cross-Device Cloud Data Synchronization Engine
 * Guarantees strict per-ID data isolation and cross-device synchronization by Email.
 */
'use strict';

window.CloudSyncManager = (function () {
  // Backend API URL detection (works with local uvicorn on :8000, serve on :3000, or same origin)
  const isLocalDev = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
  const API_BASE = isLocalDev && window.location.port !== '8000'
    ? 'http://localhost:8000/api'
    : '/api';

  const ACTIVE_EMAIL_KEY = 'skylark_active_email';
  const LAST_SYNC_KEY = 'skylark_last_cloud_sync';
  const SYNC_STATUS_KEY = 'skylark_sync_status';
  const SESSION_TOKEN_KEY = 'skylark_session_token';
  const SENSITIVE_SETTING = /(api[_-]?key|access[_-]?key|token|secret|password|credential|webhook|proxy)/i;
  let pushDebounceTimer = null;
  let isSyncing = false;
  // Per-email timestamp guard. restoreCloudBundle() re-invokes the page
  // controllers' init(), which call loadLeads() → pullLatest() again. Without
  // this guard that forms an infinite init⇄pull loop that pins the main thread
  // and makes the entire UI unclickable. See pullLatest().
  const _pullGuard = {};

  // Cloud snapshots must never become a second secret store. Only bounded
  // primitive UI preferences are synchronized; provider credentials, URLs
  // carrying credentials, and arbitrary objects are deliberately excluded.
  function sanitizeSettings(raw) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
    const safe = {};
    for (const [key, value] of Object.entries(raw)) {
      if (SENSITIVE_SETTING.test(key)) continue;
      if (!['string', 'number', 'boolean'].includes(typeof value)) continue;
      if (typeof value === 'string' && value.length > 500) continue;
      safe[key] = value;
    }
    return safe;
  }

  function getSessionToken() {
    return window.SupabaseAuth?.getAccessToken?.() || '';
  }

  // Supabase owns session persistence and refresh. Never copy its tokens into
  // localStorage/sessionStorage or log them from this module.
  function saveSessionToken() {}

  function authHeaders(extra = {}) {
    const token = getSessionToken();
    return token ? { ...extra, Authorization: `Bearer ${token}` } : extra;
  }

  function getActiveEmail() {
    try {
      const email = localStorage.getItem(ACTIVE_EMAIL_KEY);
      // Only return real user emails — never return placeholder/default emails
      if (email && email.trim() && email.includes('@')
          && email !== 'default@aileads.ai' && email !== 'demo@aileads.ai') {
        return email.trim().toLowerCase();
      }
      const prof = window.UserProfileManager?.getProfile?.();
      if (prof && prof.email && prof.email.trim() && prof.email.includes('@')
          && prof.email !== 'default@aileads.ai' && prof.email !== 'demo@aileads.ai') {
        return prof.email.trim().toLowerCase();
      }
    } catch (_) {}
    return ''; // Return empty — never pre-fill fake/default email
  }

  function setActiveEmail(email) {
    if (email && email.includes('@')) {
      const clean = email.trim().toLowerCase();
      localStorage.setItem(ACTIVE_EMAIL_KEY, clean);
      return clean;
    }
    return '';
  }

  function getVaultKey(email) {
    const clean = (email || getActiveEmail()).trim().toLowerCase().replace(/[^a-z0-9]/g, '_');
    return `skylark_vault_${clean}`;
  }

  function updateStatusUI(status, message) {
    try {
      localStorage.setItem(SYNC_STATUS_KEY, status);
      const badges = document.querySelectorAll('.ag-cloud-sync-status, #topbar-sync-status, #settings-sync-status, .cloud-sync-pill');
      badges.forEach(badge => {
        if (!badge) return;
        if (status === 'synced') {
          badge.innerHTML = `<span class="ag-sync-dot ag-sync-ok" style="display:inline-block; width:8px; height:8px; border-radius:50%; background:#10b981; margin-right:6px; box-shadow:0 0 6px #10b981;"></span><span style="font-size:11px; font-weight:600; color:var(--gray-700, #374151);">Cloud Synced</span>`;
          badge.title = message || 'All data safely synchronized to your account';
        } else if (status === 'syncing') {
          badge.innerHTML = `<span class="ag-sync-dot ag-sync-busy" style="display:inline-block; width:8px; height:8px; border-radius:50%; background:#f59e0b; margin-right:6px; animation:pulse 1s infinite;"></span><span style="font-size:11px; font-weight:600; color:var(--gray-700, #374151);">Syncing…</span>`;
          badge.title = 'Synchronizing changes with cloud storage…';
        } else if (status === 'offline') {
          badge.innerHTML = `<span class="ag-sync-dot ag-sync-off" style="display:inline-block; width:8px; height:8px; border-radius:50%; background:#6b7280; margin-right:6px;"></span><span style="font-size:11px; font-weight:600; color:var(--gray-700, #374151);">Offline Vault</span>`;
          badge.title = 'Working locally in isolated account vault. Will sync when backend connects.';
        } else {
          badge.innerHTML = `<span class="ag-sync-dot"></span><span>${status}</span>`;
        }
      });
    } catch (_) {}
  }

  /**
   * Restores a cloud data bundle (leads, candidates, settings, profile) into local memory & DB.
   */
  async function restoreCloudBundle(data, userProfile) {
    if (!data && !userProfile) return;
    updateStatusUI('syncing', 'Restoring account data…');

    try {
      const email = (userProfile?.email || getActiveEmail()).trim().toLowerCase();
      const snapshot = (data && data.full_snapshot) ? data.full_snapshot : (data || {});

      // 1. Restore Profile
      const profToSave = userProfile || snapshot.profile;
      if (profToSave && window.UserProfileManager) {
        window.UserProfileManager.saveProfile(profToSave);
      }

      // 2. Restore Leads into IndexedDB
      const leads = snapshot.leads || (Array.isArray(data) ? data : []);
      if (Array.isArray(leads)) {
        window.allLeads = leads;
        if (window.UserStorage) {
          window.UserStorage.setJSON('allLeads', leads);
        }
        if (window.MemoryEngine && typeof window.MemoryEngine.saveAllLeads === 'function') {
          await window.MemoryEngine.saveAllLeads(leads);
        }
      }

      // 3. Restore Candidates into IndexedDB
      const candidates = snapshot.candidates || [];
      if (Array.isArray(candidates)) {
        window.all_candidates = candidates;
        if (window.UserStorage) {
          window.UserStorage.setJSON('all_candidates', candidates);
        }
        if (window.MemoryEngine && typeof window.MemoryEngine.saveAllCandidates === 'function') {
          await window.MemoryEngine.saveAllCandidates(candidates);
        }
      }

      // 4. Restore Settings & API Keys
      const settings = sanitizeSettings(snapshot.settings);
      if (settings && typeof settings === 'object') {
        try {
          const cfg = window.SKYLARK_CONFIG || {};
          Object.assign(cfg, settings);
          window.SKYLARK_CONFIG = cfg;
          localStorage.setItem('skylark_config_v2', JSON.stringify(cfg));
          if (typeof window.populateSettingsUI === 'function') {
            window.populateSettingsUI();
          }
        } catch (_) {}
      }

      // 5. Restore Jarvis Facts
      const facts = snapshot.jarvis_facts;
      if (Array.isArray(facts) && window.MemoryEngine) {
        for (const f of facts) {
          if (f && f.key && f.value) {
            try { await window.MemoryEngine.setJarvisFact(f.key, f.value); } catch (_) {}
          }
        }
      }

      // 6. Save snapshot into isolated local account vault cache
      try {
        localStorage.setItem(getVaultKey(email), JSON.stringify({
          leads,
          candidates,
          settings,
          profile: profToSave,
          jarvis_facts: facts,
          timestamp: Date.now()
        }));
      } catch (_) {}

      // 7. Refresh UI components
      if (typeof window.LeadsCtrl !== 'undefined' && typeof window.LeadsCtrl.init === 'function') {
        window.LeadsCtrl.init();
      }
      if (typeof window.CandidatesCtrl !== 'undefined' && typeof window.CandidatesCtrl.init === 'function') {
        window.CandidatesCtrl.init();
      }
      if (typeof window.DashboardCtrl !== 'undefined' && typeof window.DashboardCtrl.init === 'function') {
        window.DashboardCtrl.init();
      }
      if (typeof window.UserProfileManager !== 'undefined' && typeof window.UserProfileManager.syncUI === 'function') {
        window.UserProfileManager.syncUI();
      }
      if (typeof window.updateAllUI === 'function') {
        window.updateAllUI();
      }

      localStorage.setItem(LAST_SYNC_KEY, String(Date.now()));
      updateStatusUI('synced', `Synced as ${email}`);
      console.log(`✅ [CloudSync] Account (${email}) successfully synchronized with ${leads.length} leads.`);
    } catch (err) {
      console.warn('⚠️ [CloudSync] Error restoring cloud bundle:', err);
      updateStatusUI('synced', 'Local cache active');
    }
  }

  /**
   * Pulls the latest cloud data for a given email address.
   */
  async function pullLatest(email) {
    const targetEmail = (email || getActiveEmail() || '').trim().toLowerCase();
    if (!targetEmail || !targetEmail.includes('@')) return null;

    // ── Re-entrancy guard (prevents init⇄pull infinite loop) ──────────────
    // restoreCloudBundle() calls LeadsCtrl/CandidatesCtrl/DashboardCtrl.init(),
    // and those init()s call loadLeads() → pullLatest() again. If we let a pull
    // re-enter for the same email straight away, it loops forever and freezes
    // the UI. The first pass has already restored the data, so any pull that
    // re-enters within a short window is a no-op.
    const _nowTs = Date.now();
    if (_pullGuard[targetEmail] && (_nowTs - _pullGuard[targetEmail]) < 4000) {
      return null;
    }
    _pullGuard[targetEmail] = _nowTs;

    updateStatusUI('syncing', 'Checking for updates…');
    try {
      // On file:// there is no reachable backend — a relative /api fetch
      // resolves to file:///C:/api/... and fails with a CORS/ERR_FAILED error.
      // Skip the network call and fall back to the local vault directly.
      if (window.location.protocol === 'file:') {
        // file:// has no backend. Stay local and never issue a file:///api fetch.
        updateStatusUI('offline', 'Local-only mode');
        const vaultRaw = localStorage.getItem(getVaultKey(targetEmail));
        if (vaultRaw) {
          const vaultData = JSON.parse(vaultRaw);
          await restoreCloudBundle(vaultData, vaultData.profile);
          return vaultData;
        }
        return null;
      }
      const resp = await fetch(`${API_BASE}/sync/pull?email=${encodeURIComponent(targetEmail)}`, {
        method: 'GET',
        headers: authHeaders({ 'Content-Type': 'application/json' })
      });

      if (resp.ok) {
        const res = await resp.json();
        if (res.success && res.data) {
          await restoreCloudBundle(res.data, res.user);
          return res.data;
        }
      }
    } catch (e) {
      console.log('ℹ️ [CloudSync] Server pull offline, restoring from account vault:', e.message);
    }

    // Fallback: Restore from isolated account vault
    try {
      const vaultRaw = localStorage.getItem(getVaultKey(targetEmail));
      if (vaultRaw) {
        const vaultData = JSON.parse(vaultRaw);
        await restoreCloudBundle(vaultData, vaultData.profile);
        updateStatusUI('synced', `Restored from device vault (${targetEmail})`);
        return vaultData;
      }
    } catch (_) {}

    updateStatusUI('synced', `Ready (${targetEmail})`);
    return null;
  }

  /**
   * Gathers all local leads, settings, profile, and pushes to backend cloud storage.
   */
  async function pushNow() {
    const email = getActiveEmail();
    if (!email || !email.includes('@')) return false;
    if (isSyncing) return false;
    isSyncing = true;

    updateStatusUI('syncing', 'Saving changes to cloud…');

    try {
      // 1. Gather all leads from MemoryEngine or in-memory state
      let leads = [];
      let candidates = [];
      let facts = [];
      if (window.MemoryEngine) {
        try { leads = await window.MemoryEngine.getAllLeads(10000); } catch (_) {}
        try { candidates = await window.MemoryEngine.getAllCandidates(10000); } catch (_) {}
        try { facts = await window.MemoryEngine.getAllJarvisFacts(); } catch (_) {}
      }
      if (!leads || leads.length === 0) {
        leads = window.allLeads || (window.UserStorage ? window.UserStorage.getJSON('allLeads', []) : []);
      }
      if (!candidates || candidates.length === 0) {
        candidates = window.all_candidates || (window.UserStorage ? window.UserStorage.getJSON('all_candidates', []) : []);
      }

      // 2. Gather settings
      const settings = sanitizeSettings(window.SKYLARK_CONFIG || {});

      // 3. Gather profile
      const profile = window.UserProfileManager?.getProfile?.() || {};

      // 4. Save into isolated local vault immediately
      const bundle = {
        leads: leads || [],
        candidates: candidates || [],
        settings: settings || {},
        profile: profile || {},
        jarvis_facts: facts || [],
        timestamp: Date.now()
      };
      try {
        localStorage.setItem(getVaultKey(email), JSON.stringify(bundle));
      } catch (_) {}

      // file:// mode is intentionally offline. The vault above is the
      // complete local save; do not attempt a file:///api network request.
      if (window.location.protocol === 'file:') {
        updateStatusUI('offline', 'Saved locally');
        return true;
      }

      // 5. Send payload to Backend SQLite Cloud Database
      const resp = await fetch(`${API_BASE}/sync/push`, {
        method: 'POST',
        headers: authHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({
          email,
          data_type: 'full_snapshot',
          payload: bundle
        })
      });

      if (resp.ok) {
        localStorage.setItem(LAST_SYNC_KEY, String(Date.now()));
        updateStatusUI('synced', `Synced to cloud at ${new Date().toLocaleTimeString()}`);
      } else {
        updateStatusUI('synced', 'Saved to account vault');
      }
    } catch (e) {
      console.log('ℹ️ [CloudSync] Cloud push offline (saved to local vault):', e.message);
      updateStatusUI('synced', 'Saved to account vault');
    } finally {
      isSyncing = false;
    }
    return true;
  }

  /**
   * Debounced push scheduler — triggers automatic push when leads/settings change.
   */
  function schedulePush(delayMs = 1200) {
    if (pushDebounceTimer) clearTimeout(pushDebounceTimer);
    pushDebounceTimer = setTimeout(() => {
      pushNow();
    }, delayMs);
  }

  /**
   * Switches active account, purging old in-memory leads and loading target user's silo.
   */
  async function switchAccount(newEmail, profileUpdates = {}) {
    if (!newEmail || !newEmail.includes('@')) return;
    const cleanEmail = newEmail.trim().toLowerCase();
    const oldEmail = getActiveEmail();

    // 1. Flush any unpushed changes for old account
    if (oldEmail && oldEmail !== cleanEmail) {
      try { await pushNow(); } catch (_) {}
    }

    // 2. Set new active email
    setActiveEmail(cleanEmail);

    // 3. Switch User Storage and IndexedDB
    const uid = window.UserStorage ? window.UserStorage.emailToUserId(cleanEmail) : `usr_${cleanEmail.replace(/[^a-z0-9]/g, '_')}`;
    if (window.MemoryEngine && typeof window.MemoryEngine.switchUser === 'function') {
      await window.MemoryEngine.switchUser(uid);
    }

    // 4. Clear in-memory leads & candidates to prevent leaking between accounts
    window.allLeads = [];
    window.all_candidates = [];
    if (typeof window.filteredLeads !== 'undefined') window.filteredLeads = [];

    // 5. Update profile
    const baseName = cleanEmail.split('@')[0].replace(/[._-]/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
    const profile = {
      id: uid,
      email: cleanEmail,
      name: profileUpdates.name || baseName,
      company: profileUpdates.company || 'Enterprise',
      phone: profileUpdates.phone || '',
      role: profileUpdates.role || 'Owner',
      ...profileUpdates
    };
    if (window.UserProfileManager) {
      window.UserProfileManager.saveProfile(profile);
    }

    // 6. Pull and hydrate target user's data from cloud backend / local vault
    await pullLatest(cleanEmail);

    console.log(`🔀 [CloudSync] Switched active account to: ${cleanEmail}`);
  }

  /**
   * Log in user via Backend Auth API & Pull all cross-device data.
   */
  async function login(email, password) {
    return { success: false, error: 'Email/password login is disabled. Continue with Google.' };
  }

  /**
   * Register user via Backend Auth API & Initialize cloud storage.
   */
  async function register(userData) {
    return { success: false, error: 'Password registration is disabled. Continue with Google.' };
  }

  /**
   * One-click Google Login flow & Cross-device sync.
   */
  async function googleLogin(googleData) {
    return { success: false, error: 'Use the Supabase Google sign-in button.' };
  }

  /**
   * Generates a 1-click cross-device sync token to paste on any computer/phone.
   */
  async function exportSyncToken() {
    if (!getSessionToken()) throw new Error('Sign in before exporting cloud data');
    const email = getActiveEmail();
    let leads = [];
    let candidates = [];
    if (window.MemoryEngine) {
      try { leads = await window.MemoryEngine.getAllLeads(10000); } catch (_) {}
      try { candidates = await window.MemoryEngine.getAllCandidates(10000); } catch (_) {}
    }
    if (!leads || leads.length === 0) leads = window.allLeads || [];
    if (!candidates || candidates.length === 0) candidates = window.all_candidates || [];

    const payload = {
      v: 2,
      email,
      leads,
      candidates,
      profile: window.UserProfileManager?.getProfile?.() || {},
      exportedAt: Date.now()
    };

    try {
      const json = JSON.stringify(payload);
      return btoa(unescape(encodeURIComponent(json)));
    } catch (e) {
      return JSON.stringify(payload);
    }
  }

  /**
   * Imports a 1-click cross-device sync token.
   */
  async function importSyncToken(tokenStr) {
    if (!getSessionToken()) throw new Error('Sign in before importing cloud data');
    if (!tokenStr || typeof tokenStr !== 'string') throw new Error('Invalid token string');
    let data = null;
    try {
      const decoded = decodeURIComponent(escape(atob(tokenStr.trim())));
      data = JSON.parse(decoded);
    } catch (_) {
      data = JSON.parse(tokenStr.trim());
    }

    const activeEmail = getActiveEmail();
    if (!data || !data.email || !activeEmail || data.email.toLowerCase() !== activeEmail.toLowerCase()) {
      throw new Error('Sync token account does not match the signed-in account');
    }
    await restoreCloudBundle(data, data.profile);
    await pushNow();
    return data;
  }

  /**
   * Logout and clear local session.
   */
  function logout() {
    localStorage.removeItem('skylark_logged_in');
    void window.SupabaseAuth?.signOut?.();
    const authScreen = document.getElementById('auth-screen');
    const appShell = document.getElementById('app-shell');
    if (appShell) appShell.style.display = 'none';
    if (authScreen) {
      authScreen.classList.remove('ag-hidden');
      authScreen.classList.add('ag-auth-screen');
      authScreen.style.display = '';
    }
    if (window.AntigravityAuth && typeof window.AntigravityAuth.switchTab === 'function') {
      window.AntigravityAuth.switchTab('login');
    }
  }

  // Periodic background cloud sync (every 60s)
  setInterval(() => {
    if (window.SupabaseAuth?.getSession?.() && getActiveEmail()) {
      pullLatest();
    }
  }, 60000);

  // Sync on tab focus when switching back from another window/device
  window.addEventListener('focus', () => {
    if (window.SupabaseAuth?.getSession?.() && getActiveEmail()) {
      pullLatest();
    }
  });

  return {
    getActiveEmail,
    setActiveEmail,
    restoreCloudBundle,
    pullLatest,
    pushNow,
    schedulePush,
    switchAccount,
    login,
    register,
    googleLogin,
    exportSyncToken,
    importSyncToken,
    logout,
    updateStatusUI
  };
})();

window.CloudSyncManager = CloudSyncManager;
