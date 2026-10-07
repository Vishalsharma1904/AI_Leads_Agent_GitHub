/**
 * cloud-sync.js
 * High-Performance Cross-Device Cloud Data Synchronization Engine
 * Syncs the signed-in user's working data to a Supabase row protected by RLS.
 */
'use strict';

window.CloudSyncManager = (function () {
  const ACTIVE_EMAIL_KEY = 'skylark_active_email';
  const LAST_SYNC_KEY = 'skylark_last_cloud_sync';
  const SYNC_STATUS_KEY = 'skylark_sync_status';
  const PENDING_PREFIX = 'skylark_pending_cloud_';
  const SENSITIVE_SETTING = /(api[_-]?key|access[_-]?key|token|secret|password|credential|webhook|proxy)/i;
  let pushDebounceTimer = null;
  let isSyncing = false;
  let isRestoring = false;
  let changeVersion = 0;
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

  function getActiveEmail() {
    // Local storage is editable by the browser user; the verified session owns identity.
    return String(window.SupabaseAuth?.getUser?.()?.email || '').trim().toLowerCase();
  }

  function hasPendingChanges(email) {
    return localStorage.getItem(PENDING_PREFIX + email) === '1';
  }

  function setPendingChanges(email, pending) {
    if (!email) return;
    if (pending) localStorage.setItem(PENDING_PREFIX + email, '1');
    else localStorage.removeItem(PENDING_PREFIX + email);
  }

  function setActiveEmail(email) {
    if (email && email.trim().toLowerCase() === getActiveEmail()) {
      const clean = email.trim().toLowerCase();
      localStorage.setItem(ACTIVE_EMAIL_KEY, clean);
      return clean;
    }
    return '';
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
          badge.title = message || 'Cloud sync is unavailable. Changes remain on this device.';
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
    isRestoring = true;
    updateStatusUI('syncing', 'Restoring account data…');

    try {
      const email = (userProfile?.email || getActiveEmail()).trim().toLowerCase();
      const snapshot = (data && data.full_snapshot) ? data.full_snapshot : (data || {});

      // 1. Restore Profile
      const profToSave = (userProfile || snapshot.profile)
        ? { ...(userProfile || snapshot.profile), email }
        : null;
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
          localStorage.setItem('skylark_config_v2', JSON.stringify(settings));
          if (typeof window.populateSettingsUI === 'function') {
            window.populateSettingsUI();
          }
        } catch (_) {}
      }

      // 5. Replace account-scoped chat, memory, scripts and task records together.
      await window.MemoryEngine?.replaceCloudCollections?.(snapshot);

      // 6. Refresh UI components. IndexedDB remains the offline cache.
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
      updateStatusUI('offline', 'Cloud data could not be restored');
      throw err;
    } finally {
      isRestoring = false;
    }
  }

  /**
   * Pulls the latest cloud data for a given email address.
   */
  async function pullLatest(email) {
    const targetEmail = (email || getActiveEmail() || '').trim().toLowerCase();
    const authenticatedUser = window.SupabaseAuth?.getUser?.();
    const client = window.SupabaseAuth?.getClient?.();
    if (!authenticatedUser?.id || !client || targetEmail !== getActiveEmail()) return null;
    if (pushDebounceTimer || isSyncing) return null;
    if (hasPendingChanges(targetEmail) && !await pushNow()) return null;

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
      const { data, error } = await client.from('clavis_user_data')
        .select('payload,updated_at')
        .eq('user_id', authenticatedUser.id)
        .maybeSingle();
      if (error) throw error;
      if (data?.payload) {
        await restoreCloudBundle(data.payload, null);
        window.CRMBridge?.notifyCloud?.();
        return data.payload;
      }
      await pushNow(); // First sign-in seeds only this verified account's local silo.
      return null;
    } catch (e) {
      console.warn('[CloudSync] Cloud read failed:', e.message);
      updateStatusUI('offline', 'Cloud sync unavailable; local data remains on this device');
      return null;
    }
  }

  /**
   * Gathers all local leads, settings, profile, and pushes to backend cloud storage.
   */
  async function pushNow() {
    const email = getActiveEmail();
    const authenticatedUser = window.SupabaseAuth?.getUser?.();
    const client = window.SupabaseAuth?.getClient?.();
    if (!authenticatedUser?.id || !client || !email) return false;
    if (isSyncing) return false;
    isSyncing = true;
    const startedVersion = changeVersion;
    let saved = false;

    updateStatusUI('syncing', 'Saving changes to cloud…');

    try {
      // 1. Gather all leads from MemoryEngine or in-memory state
      let leads = [];
      let candidates = [];
      let facts = [];
      let clientChat = [];
      let candidateChat = [];
      let jarvisMessages = [];
      let jarvisScripts = [];
      let jarvisSkills = [];
      let jarvisTasks = [];
      if (window.MemoryEngine) {
        try { leads = await window.MemoryEngine.getAllLeads(10000); } catch (_) {}
        try { candidates = await window.MemoryEngine.getAllCandidates(10000); } catch (_) {}
        try { facts = await window.MemoryEngine.getAllJarvisFacts(); } catch (_) {}
        try { clientChat = await window.MemoryEngine.getClientChatHistory(100000); } catch (_) {}
        try { candidateChat = await window.MemoryEngine.getCandidateChatHistory(100000); } catch (_) {}
        try { jarvisMessages = await window.MemoryEngine.getAllJarvisMessages(); } catch (_) {}
        try { jarvisScripts = await window.MemoryEngine.getAllJarvisScripts(); } catch (_) {}
        try { jarvisSkills = await window.MemoryEngine.getAllCustomSkills(); } catch (_) {}
        try { jarvisTasks = await window.MemoryEngine.getAllTaskRuns(100000); } catch (_) {}
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

      // 4. Keep the account's working copy in IndexedDB; cloud writes use RLS.
      const bundle = {
        leads: leads || [],
        candidates: candidates || [],
        settings: settings || {},
        profile: profile || {},
        jarvis_facts: facts || [],
        client_chat: clientChat || [],
        candidate_chat: candidateChat || [],
        jarvis_messages: jarvisMessages || [],
        jarvis_scripts: jarvisScripts || [],
        jarvis_skills: jarvisSkills || [],
        jarvis_tasks: jarvisTasks || [],
        timestamp: Date.now()
      };
      const { error } = await client.from('clavis_user_data').upsert({
        user_id: authenticatedUser.id,
        payload: bundle,
        updated_at: new Date().toISOString()
      }, { onConflict: 'user_id' });
      if (error) throw error;
      setPendingChanges(email, changeVersion !== startedVersion);
      saved = true;
      localStorage.setItem(LAST_SYNC_KEY, String(Date.now()));
      updateStatusUI('synced', `Saved to ${email} at ${new Date().toLocaleTimeString()}`);
      return true;
    } catch (e) {
      setPendingChanges(email, true);
      console.warn('[CloudSync] Cloud save failed:', e.message);
      updateStatusUI('offline', 'Cloud save failed; data remains on this device');
      return false;
    } finally {
      isSyncing = false;
      if (saved && hasPendingChanges(email) && !pushDebounceTimer) schedulePush();
    }
  }

  /**
   * Debounced push scheduler — triggers automatic push when leads/settings change.
   */
  function schedulePush(delayMs = 1200) {
    if (isRestoring || !window.SupabaseAuth?.getUser?.()) return;
    setPendingChanges(getActiveEmail(), true);
    changeVersion += 1;
    if (pushDebounceTimer) clearTimeout(pushDebounceTimer);
    pushDebounceTimer = setTimeout(() => {
      pushDebounceTimer = null;
      pushNow();
    }, delayMs);
  }

  /**
   * Switches active account, purging old in-memory leads and loading target user's silo.
   */
  async function switchAccount(newEmail, profileUpdates = {}) {
    if (!newEmail || newEmail.trim().toLowerCase() !== getActiveEmail()) {
      throw new Error('Sign in to the requested account first.');
    }
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
      ...profileUpdates,
      id: uid,
      email: cleanEmail,
      name: profileUpdates.name || baseName,
      company: profileUpdates.company || 'Enterprise',
      phone: profileUpdates.phone || '',
      role: profileUpdates.role || 'Owner'
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
