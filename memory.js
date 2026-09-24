/**
 * ============================================================
 *  NEXUS AI — Memory Engine (memory.js)
 *  Persistent IndexedDB storage + token counter per key
 *  Data persists across browser restarts permanently.
 * ============================================================
 */

'use strict';

const MemoryEngine = (() => {
  const DB_NAME     = 'skylark_agent_db';
  const DB_VERSION  = 8;
  const LEADS_STORE = 'leads';
  const CANDIDATES_STORE = 'candidates';
  const META_STORE  = 'meta';
  const DEDUP_STORE = 'dedup_index';
  const CLIENT_CHAT_STORE     = 'client_chat_messages';
  const CANDIDATE_CHAT_STORE  = 'candidate_chat_messages';
  const JARVIS_MSG_STORE      = 'jarvis_messages';
  const JARVIS_FACT_STORE     = 'jarvis_facts';
  const JARVIS_SCRIPT_STORE   = 'jarvis_scripts';
  const JARVIS_SKILL_STORE    = 'jarvis_custom_skills';
  const JARVIS_TASK_STORE     = 'jarvis_tasks';
  const SNAPSHOTS_STORE       = 'snapshots';
  let db = null;

  // ─── Persistent token counter (localStorage) ──────────────
  const TOKEN_TOTAL_KEY    = 'skylark_total_tokens';
  const TOKEN_SESSION_KEY  = 'skylark_session_tokens';
  const KEY_USAGE_KEY      = 'skylark_key_usage';      // per-key usage map
  const ACTIVE_APIFY_KEY   = 'skylark_active_apify_idx';
  const ACTIVE_GROQ_KEY    = 'skylark_active_groq_idx';
  const WARNED_KEYS_KEY    = 'skylark_warned_keys';

  function getTotalTokensUsed()   { return parseInt(localStorage.getItem(TOKEN_TOTAL_KEY)   || '0'); }
  function getSessionTokens()     { return parseInt(localStorage.getItem(TOKEN_SESSION_KEY) || '0'); }

  function addTokensUsed(n) {
    const total   = getTotalTokensUsed() + n;
    const session = getSessionTokens() + n;
    localStorage.setItem(TOKEN_TOTAL_KEY,   String(total));
    localStorage.setItem(TOKEN_SESSION_KEY, String(session));
    if (typeof window.restoreTokenCounter === 'function') {
      window.restoreTokenCounter();
    }
    return total;
  }

  function resetSessionTokens() { localStorage.setItem(TOKEN_SESSION_KEY, '0'); }
  function resetTokenCounter()  {
    localStorage.setItem(TOKEN_TOTAL_KEY,   '0');
    localStorage.setItem(TOKEN_SESSION_KEY, '0');
  }

  // ─── Per-key usage tracking ───────────────────────────────
  function getKeyUsageMap() {
    try { return JSON.parse(localStorage.getItem(KEY_USAGE_KEY) || '{}'); }
    catch { return {}; }
  }

  function addKeyUsage(keyType, keyIndex, amount) {
    const map = getKeyUsageMap();
    const k   = `${keyType}_${keyIndex}`;
    map[k]    = (map[k] || 0) + amount;
    localStorage.setItem(KEY_USAGE_KEY, JSON.stringify(map));
    
    // Live UI Update
    if (typeof window.updateRealtimeTokenCounters === 'function') {
      window.updateRealtimeTokenCounters();
    }
    
    return map[k];
  }

  function getKeyUsage(keyType, keyIndex) {
    return getKeyUsageMap()[`${keyType}_${keyIndex}`] || 0;
  }

  function resetKeyUsage() { localStorage.removeItem(KEY_USAGE_KEY); }

  // ─── Active key index management & Rotation ───────────────
  const LAST_API_ERROR_KEY = 'skylark_last_api_error';
  const API_USAGE_LOG_KEY  = 'skylark_api_usage_log';
  const WEB_CACHE_KEY_PREFIX = 'skylark_webcache_';

  function getActiveApifyIdx() { return parseInt(localStorage.getItem(ACTIVE_APIFY_KEY) || '0'); }
  function setActiveApifyIdx(i){ localStorage.setItem(ACTIVE_APIFY_KEY, String(i)); }
  function getActiveGroqIdx()  { return parseInt(localStorage.getItem(ACTIVE_GROQ_KEY)  || '0'); }
  function setActiveGroqIdx(i) { localStorage.setItem(ACTIVE_GROQ_KEY,  String(i)); }

  // Record API Error for health status display
  function recordApiError(keyType, keyIndex, errorMsg) {
    const errorRecord = {
      timestamp: Date.now(),
      keyType,
      keyIndex,
      message: String(errorMsg || 'Unknown API Error')
    };
    localStorage.setItem(LAST_API_ERROR_KEY, JSON.stringify(errorRecord));
    
    // Add to usage log
    addApiUsageLog({
      type: keyType,
      index: keyIndex,
      status: 'error',
      message: errorRecord.message,
      timestamp: Date.now()
    });
  }

  function getLastApiError() {
    try { return JSON.parse(localStorage.getItem(LAST_API_ERROR_KEY) || 'null'); }
    catch { return null; }
  }

  function addApiUsageLog(logEntry) {
    try {
      const logs = JSON.parse(localStorage.getItem(API_USAGE_LOG_KEY) || '[]');
      logs.unshift(logEntry);
      if (logs.length > 100) logs.pop(); // Keep last 100 entries
      localStorage.setItem(API_USAGE_LOG_KEY, JSON.stringify(logs));
    } catch(e) {}
  }

  function getApiUsageLogs() {
    try { return JSON.parse(localStorage.getItem(API_USAGE_LOG_KEY) || '[]'); }
    catch { return []; }
  }

  // Auto-rotate to next Apify key on error / exhaustion
  function rotateToNextApifyKey(reason = 'Rate limit or error encountered') {
    const cfg = window.SKYLARK_CONFIG || {};
    const keys = (cfg.APIFY_API_KEYS || []).filter(k => k && k.trim());
    if (keys.length <= 1) return getActiveApifyIdx();

    const currentIdx = getActiveApifyIdx();
    const nextIdx = (currentIdx + 1) % keys.length;
    setActiveApifyIdx(nextIdx);
    
    addApiUsageLog({
      type: 'apify',
      index: nextIdx,
      status: 'rotated',
      message: `Rotated from Key ${currentIdx + 1} to Key ${nextIdx + 1}. Reason: ${reason}`,
      timestamp: Date.now()
    });
    
    if (typeof window.showToast === 'function') {
      window.showToast('info', '🔄 API Key Rotated', `Switched to Apify Key #${nextIdx + 1} (${reason})`);
    }
    
    return nextIdx;
  }

  // Web caching helpers for crawler
  function getCachedWebPage(url) {
    if (!url) return null;
    try {
      const cleanUrl = url.trim().toLowerCase();
      const raw = localStorage.getItem(WEB_CACHE_KEY_PREFIX + cleanUrl);
      if (!raw) return null;
      const data = JSON.parse(raw);
      // Cache valid for 7 days
      if (Date.now() - data.timestamp > 7 * 24 * 60 * 60 * 1000) {
        localStorage.removeItem(WEB_CACHE_KEY_PREFIX + cleanUrl);
        return null;
      }
      return data.content;
    } catch { return null; }
  }

  function setCachedWebPage(url, content) {
    if (!url || !content) return;
    try {
      const cleanUrl = url.trim().toLowerCase();
      const payload = { timestamp: Date.now(), content };
      localStorage.setItem(WEB_CACHE_KEY_PREFIX + cleanUrl, JSON.stringify(payload));
    } catch { /* storage limit safety */ }
  }

  // ─── Warning dedup ────────────────────────────────────────
  function getWarnedKeys() {
    try { return JSON.parse(localStorage.getItem(WARNED_KEYS_KEY) || '[]'); }
    catch { return []; }
  }
  function markKeyWarned(keyId) {
    const warned = getWarnedKeys();
    if (!warned.includes(keyId)) { warned.push(keyId); localStorage.setItem(WARNED_KEYS_KEY, JSON.stringify(warned)); }
  }
  function isKeyWarned(keyId)   { return getWarnedKeys().includes(keyId); }

  // ─── Key health check (call this after adding usage) ──────
  function checkKeyHealth(keyType, keyIndex) {
    const cfg   = window.SKYLARK_CONFIG || {};
    const limit = keyType === 'apify'
      ? (cfg.APIFY_KEY_LIMIT || 400)
      : (cfg.GROQ_KEY_LIMIT  || 14400);
    const used  = getKeyUsage(keyType, keyIndex);
    const pct   = (used / limit) * 100;
    const keyId = `${keyType}_${keyIndex}`;

    let status = 'Active';
    if (pct >= 100) status = 'Exhausted';
    else if (pct >= 85) status = 'Degraded';

    const lastErr = getLastApiError();
    if (lastErr && lastErr.keyType === keyType && lastErr.keyIndex === keyIndex && (Date.now() - lastErr.timestamp < 300000)) {
      status = 'Error';
    }

    if (pct >= 90 && !isKeyWarned(keyId)) {
      markKeyWarned(keyId);
      return { warn: true, pct: Math.round(pct), keyType, keyIndex, used, limit, status };
    }
    return { warn: false, pct: Math.round(pct), status, used, limit };
  }

  // ─── Best available key (skip exhausted ones) ─────────────
  function getBestApifyKey() {
    const cfg    = window.SKYLARK_CONFIG || {};
    const keys   = (cfg.APIFY_API_KEYS || []).filter(k => k && k.trim());
    const limit  = cfg.APIFY_KEY_LIMIT || 400;
    if (keys.length === 0) return { key: null, index: -1 };

    let idx = getActiveApifyIdx();
    if (idx >= keys.length) idx = 0;

    // Try current key first
    if (getKeyUsage('apify', idx) < limit * 0.95) return { key: keys[idx], index: idx };
    // Rotate to a key with capacity
    for (let i = 0; i < keys.length; i++) {
      if (getKeyUsage('apify', i) < limit * 0.95) {
        setActiveApifyIdx(i);
        return { key: keys[i], index: i };
      }
    }
    // All keys are nearly exhausted — use least-used one
    let bestIdx = 0, bestUsage = Infinity;
    keys.forEach((_, i) => { const u = getKeyUsage('apify', i); if (u < bestUsage) { bestUsage = u; bestIdx = i; } });
    setActiveApifyIdx(bestIdx);
    return { key: keys[bestIdx], index: bestIdx, allExhausted: true };
  }

  function addApifyUsage(n) {
    const idx = getActiveApifyIdx();
    addKeyUsage('apify', idx, n);
    addApiUsageLog({ type: 'apify', index: idx, status: 'success', message: `Used ${n} credits`, timestamp: Date.now() });
    return checkKeyHealth('apify', idx);
  }

  // ─── Multi-User Dynamic Database Scoping ─────────────────
  let currentOpenDBName = null;

  function getCurrentDBName() {
    let uid = 'usr_default';
    try {
      if (window.UserStorage && typeof window.UserStorage.getUserId === 'function') {
        uid = window.UserStorage.getUserId();
      } else if (window.UserProfileManager && typeof window.UserProfileManager.getCurrentUserId === 'function') {
        uid = window.UserProfileManager.getCurrentUserId();
      }
    } catch (_) {}
    return `skylark_agent_db_${uid}`;
  }

  function switchUser(newUserId) {
    if (db) {
      try { db.close(); } catch (_) {}
      db = null;
      currentOpenDBName = null;
    }
    return openDB();
  }

  // ─── IndexedDB Setup ──────────────────────────────────────
  async function openDB() {
    const targetDBName = getCurrentDBName();
    if (db && currentOpenDBName === targetDBName) return db;

    if (db && currentOpenDBName !== targetDBName) {
      try { db.close(); } catch(_) {}
      db = null;
      currentOpenDBName = null;
    }

    return new Promise((resolve, reject) => {
      try {
        const req = indexedDB.open(targetDBName, DB_VERSION);
        req.onupgradeneeded = (e) => {
          const D = e.target.result;
          if (!D.objectStoreNames.contains(LEADS_STORE)) {
            const s = D.createObjectStore(LEADS_STORE, { keyPath: 'id' });
            s.createIndex('timestamp', 'timestamp', { unique: false });
            s.createIndex('source',    'source',    { unique: false });
            s.createIndex('type',      'type',      { unique: false });
            s.createIndex('status',    'status',    { unique: false });
            s.createIndex('city',      'city',      { unique: false });
            s.createIndex('industry',  'industry',  { unique: false });
          }
          if (!D.objectStoreNames.contains(CANDIDATES_STORE)) {
            const s = D.createObjectStore(CANDIDATES_STORE, { keyPath: 'id' });
            s.createIndex('timestamp', 'timestamp', { unique: false });
            s.createIndex('role', 'role', { unique: false });
            s.createIndex('city', 'city', { unique: false });
          }
          if (!D.objectStoreNames.contains(META_STORE))
            D.createObjectStore(META_STORE, { keyPath: 'key' });
          if (!D.objectStoreNames.contains(DEDUP_STORE))
            D.createObjectStore(DEDUP_STORE, { keyPath: 'hash' });
          if (!D.objectStoreNames.contains(CLIENT_CHAT_STORE)) {
            const s = D.createObjectStore(CLIENT_CHAT_STORE, { keyPath: 'id' });
            s.createIndex('timestamp', 'timestamp', { unique: false });
          }
          if (!D.objectStoreNames.contains(CANDIDATE_CHAT_STORE)) {
            const s = D.createObjectStore(CANDIDATE_CHAT_STORE, { keyPath: 'id' });
            s.createIndex('timestamp', 'timestamp', { unique: false });
          }
          if (!D.objectStoreNames.contains(JARVIS_MSG_STORE)) {
            const s = D.createObjectStore(JARVIS_MSG_STORE, { keyPath: 'id' });
            s.createIndex('timestamp', 'timestamp', { unique: false });
          }
          if (!D.objectStoreNames.contains(JARVIS_FACT_STORE))
            D.createObjectStore(JARVIS_FACT_STORE, { keyPath: 'key' });
          if (!D.objectStoreNames.contains(JARVIS_SCRIPT_STORE)) {
            const s = D.createObjectStore(JARVIS_SCRIPT_STORE, { keyPath: 'id' });
            s.createIndex('timestamp', 'timestamp', { unique: false });
          }
          if (!D.objectStoreNames.contains(JARVIS_SKILL_STORE)) {
            const s = D.createObjectStore(JARVIS_SKILL_STORE, { keyPath: 'name' });
            s.createIndex('createdAt', 'createdAt', { unique: false });
          }
          if (!D.objectStoreNames.contains(JARVIS_TASK_STORE)) {
            const s = D.createObjectStore(JARVIS_TASK_STORE, { keyPath: 'id' });
            s.createIndex('timestamp', 'timestamp', { unique: false });
          }
          if (!D.objectStoreNames.contains(SNAPSHOTS_STORE)) {
            const s = D.createObjectStore(SNAPSHOTS_STORE, { keyPath: 'id' });
            s.createIndex('timestamp', 'timestamp', { unique: false });
          }
        };
        req.onblocked = e => {
          console.warn("IndexedDB upgrade blocked by another connection:", e);
        };
        req.onsuccess = e => {
          db = e.target.result;
          currentOpenDBName = targetDBName;
          resolve(db);
        };
        req.onerror   = e => {
          console.error("IndexedDB Error:", e.target.error);
          reject(e.target.error);
        };
      } catch (err) {
        console.error("IndexedDB Initialization Error:", err);
        reject(err);
      }
    });
  }

  // ─── Latency & Health Stats ───────────────────────────────
  const API_LATENCY_KEY = 'skylark_api_latency';

  function recordApiLatency(keyType, keyIndex, ms) {
    try {
      const map = JSON.parse(localStorage.getItem(API_LATENCY_KEY) || '{}');
      map[`${keyType}_${keyIndex}`] = Math.round(ms);
      localStorage.setItem(API_LATENCY_KEY, JSON.stringify(map));
    } catch(e) {}
  }

  function getApiLatency(keyType, keyIndex) {
    try {
      const map = JSON.parse(localStorage.getItem(API_LATENCY_KEY) || '{}');
      return map[`${keyType}_${keyIndex}`] || null;
    } catch(e) { return null; }
  }

  function rotateProviderKey(keyType = 'apify', reason = 'Quota or Rate Limit') {
    if (keyType === 'apify') return rotateToNextApifyKey(reason);
    
    // Generic provider key rotation logger
    const activeKeyName = `skylark_active_${keyType}_idx`;
    const currentIdx = parseInt(localStorage.getItem(activeKeyName) || '0');
    const nextIdx = currentIdx + 1;
    localStorage.setItem(activeKeyName, String(nextIdx));
    
    addApiUsageLog({
      type: keyType,
      index: nextIdx,
      status: 'rotated',
      message: `Rotated ${keyType.toUpperCase()} Key to #${nextIdx + 1}. Reason: ${reason}`,
      timestamp: Date.now()
    });
    
    if (typeof window.showToast === 'function') {
      window.showToast('info', `🔄 ${keyType.toUpperCase()} Key Rotated`, `Switched to key #${nextIdx + 1} (${reason})`);
    }
    return nextIdx;
  }

  // ─── Smart Multi-Criteria Dedup & Merging ────────────────
  function extractDomain(url) {
    if (!url) return '';
    try {
      let u = url.trim().toLowerCase();
      if (!u.startsWith('http://') && !u.startsWith('https://')) u = 'https://' + u;
      const parsed = new URL(u);
      return parsed.hostname.replace(/^www\./, '');
    } catch { return ''; }
  }

  function extractDigits(phone) {
    if (!phone) return '';
    const digits = String(phone).replace(/\D/g, '');
    return digits.length >= 10 ? digits.slice(-10) : digits;
  }

  function genDedupHashes(lead) {
    const n = s => (s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    const hashes = [];

    // 1. Domain hash
    const dom = extractDomain(lead.website);
    if (dom && dom.length > 3) hashes.push(`domain:${dom}`);

    // 2. Phone hash
    const ph = extractDigits(lead.phone);
    if (ph && ph.length === 10) hashes.push(`phone:${ph}`);

    // 3. Company + City hash
    const compCity = `${n(lead.company)}_${n(lead.city)}`;
    if (compCity.length > 3) hashes.push(`compcity:${compCity}`);

    return hashes;
  }

  async function findExistingDuplicate(lead) {
    const database = await openDB();
    const hashes = genDedupHashes(lead);
    if (hashes.length === 0) return null;

    for (const h of hashes) {
      const match = await new Promise(resolve => {
        const tx = database.transaction(DEDUP_STORE, 'readonly');
        const req = tx.objectStore(DEDUP_STORE).get(h);
        req.onsuccess = () => resolve(req.result);
        req.onerror   = () => resolve(null);
      });
      if (match && match.leadId) {
        // Fetch existing lead by ID
        const existingLead = await new Promise(resolve => {
          const tx = database.transaction(LEADS_STORE, 'readonly');
          const req = tx.objectStore(LEADS_STORE).get(match.leadId);
          req.onsuccess = () => resolve(req.result || null);
          req.onerror   = () => resolve(null);
        });
        if (existingLead) return { existingLead, hash: h };
      }
    }
    return null;
  }

  function mergeLeadObjects(existing, incoming) {
    const merged = { ...existing };

    merged.officialEmail = incoming.officialEmail || existing.officialEmail || incoming.email || existing.email || '';
    merged.hrEmail       = incoming.hrEmail       || existing.hrEmail       || '';
    merged.adminEmail    = incoming.adminEmail    || existing.adminEmail    || '';
    merged.purchaseEmail = incoming.purchaseEmail || existing.purchaseEmail || '';
    merged.vendorEmail   = incoming.vendorEmail   || existing.vendorEmail   || '';
    merged.facilityEmail = incoming.facilityEmail || existing.facilityEmail || '';
    merged.email         = merged.officialEmail || merged.hrEmail || merged.adminEmail || merged.purchaseEmail || merged.facilityEmail || merged.vendorEmail || '';

    merged.phone = incoming.phone || existing.phone || '';
    merged.website     = incoming.website     || existing.website     || '';
    merged.sourceUrl   = incoming.sourceUrl   || existing.sourceUrl   || merged.website || '';
    merged.vendorPage  = incoming.vendorPage  || existing.vendorPage  || '';
    merged.tenderPage  = incoming.tenderPage  || existing.tenderPage  || '';
    merged.linkedinUrl = incoming.linkedinUrl || existing.linkedinUrl || '';

    if (incoming.googleRating) merged.googleRating = incoming.googleRating;
    if (incoming.reviewCount)  merged.reviewCount  = Math.max(incoming.reviewCount || 0, existing.reviewCount || 0);

    merged.securityScore     = Math.max(incoming.securityScore || 0, existing.securityScore || 0);
    merged.housekeepingScore = Math.max(incoming.housekeepingScore || 0, existing.housekeepingScore || 0);
    merged.leadScore         = Math.max(incoming.leadScore || 0, existing.leadScore || 0);

    const reasons = new Set([...(existing.scoreReasons || []), ...(incoming.scoreReasons || [])]);
    merged.scoreReasons = Array.from(reasons);
    merged.updatedAt = Date.now();

    return merged;
  }

  async function checkDuplicate(lead) {
    const dupMatch = await findExistingDuplicate(lead);
    const hashes = genDedupHashes(lead);
    const primaryHash = hashes[0] || `comp_${(lead.company || '').toLowerCase().replace(/[^a-z0-9]/g, '')}`;
    return { isDuplicate: !!dupMatch, hash: primaryHash, existingLead: dupMatch?.existingLead || null };
  }

  async function batchDedupCheck(leads) {
    const results = [];
    for (const lead of leads) {
      const { isDuplicate, hash, existingLead } = await checkDuplicate(lead);
      results.push({ lead, hash, isDuplicate, existingLead });
    }
    return results;
  }

  async function clearDedupStore() {
    const database = await openDB();
    return new Promise((resolve, reject) => {
      const tx = database.transaction(DEDUP_STORE, 'readwrite');
      tx.objectStore(DEDUP_STORE).clear();
      tx.oncomplete = () => resolve();
      tx.onerror    = e => reject(e.target.error);
    });
  }

  // ─── CRUD WITH SMART MERGING ──────────────────────────────
  async function addLead(lead) {
    if (window.DataSanitizer && typeof window.DataSanitizer.sanitizeLead === 'function') {
      lead = window.DataSanitizer.sanitizeLead(lead);
    }
    if (!lead) return { success: false, reason: 'invalid_lead' };

    const database = await openDB();
    const dupMatch = await findExistingDuplicate(lead);

    if (dupMatch && dupMatch.existingLead) {
      // Smart merge into existing lead
      const mergedLead = mergeLeadObjects(dupMatch.existingLead, lead);
      await updateLead(mergedLead.id, mergedLead);
      await incrementMeta('dupes_blocked');
      return { success: true, merged: true, id: mergedLead.id };
    }

    const hashes = genDedupHashes(lead);
    const primaryHash = hashes[0] || `comp_${(lead.company || '').toLowerCase().replace(/[^a-z0-9]/g, '')}`;

    return new Promise((resolve, reject) => {
      const tx = database.transaction([LEADS_STORE, DEDUP_STORE], 'readwrite');
      tx.objectStore(LEADS_STORE).add(lead);
      hashes.forEach(h => {
        tx.objectStore(DEDUP_STORE).put({ hash: h, leadId: lead.id, timestamp: lead.timestamp });
      });
      tx.oncomplete = () => {
        if (window.CloudSyncManager && typeof window.CloudSyncManager.schedulePush === 'function') {
          window.CloudSyncManager.schedulePush();
        }
        resolve({ success: true, id: lead.id });
      };
      tx.onerror    = e => reject(e.target.error);
    });
  }

  async function getAllLeads() {
    const database = await openDB();
    return new Promise((resolve, reject) => {
      const tx  = database.transaction(LEADS_STORE, 'readonly');
      const req = tx.objectStore(LEADS_STORE).getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror   = e => reject(e.target.error);
    });
  }

  async function updateLead(id, updates) {
    const database = await openDB();
    return new Promise((resolve, reject) => {
      const tx    = database.transaction(LEADS_STORE, 'readwrite');
      const store = tx.objectStore(LEADS_STORE);
      const getR  = store.get(id);
      getR.onsuccess = () => {
        if (!getR.result) return reject(new Error('Lead not found'));
        const updated = { ...getR.result, ...updates, updatedAt: Date.now() };
        store.put(updated);
        tx.oncomplete = () => {
          if (window.CloudSyncManager && typeof window.CloudSyncManager.schedulePush === 'function') {
            window.CloudSyncManager.schedulePush();
          }
          resolve(updated);
        };
        tx.onerror    = e => reject(e.target.error);
      };
    });
  }

  async function deleteLead(id) {
    const database = await openDB();
    return new Promise((resolve, reject) => {
      const tx = database.transaction(LEADS_STORE, 'readwrite');
      tx.objectStore(LEADS_STORE).delete(id);
      tx.oncomplete = () => {
        if (window.CloudSyncManager && typeof window.CloudSyncManager.schedulePush === 'function') {
          window.CloudSyncManager.schedulePush();
        }
        resolve();
      };
      tx.onerror    = e => reject(e.target.error);
    });
  }

  async function saveAllLeads(leadsList) {
    if (!Array.isArray(leadsList)) return;
    const database = await openDB();
    return new Promise((resolve, reject) => {
      const tx = database.transaction(LEADS_STORE, 'readwrite');
      const store = tx.objectStore(LEADS_STORE);
      store.clear();
      leadsList.forEach(lead => {
        if (lead && lead.id) {
          try { store.put(lead); } catch(_) {}
        }
      });
      tx.oncomplete = () => resolve();
      tx.onerror = e => reject(e.target.error);
    });
  }

  async function saveAllCandidates(candidatesList) {
    if (!Array.isArray(candidatesList)) return;
    const database = await openDB();
    return new Promise((resolve, reject) => {
      const tx = database.transaction(CANDIDATES_STORE, 'readwrite');
      const store = tx.objectStore(CANDIDATES_STORE);
      store.clear();
      candidatesList.forEach(cand => {
        if (cand && cand.id) {
          try { store.put(cand); } catch(_) {}
        }
      });
      tx.oncomplete = () => resolve();
      tx.onerror = e => reject(e.target.error);
    });
  }

  // ─── CANDIDATES CRUD ──────────────────────────────────────
  async function addCandidate(candidate) {
    if (window.DataSanitizer && typeof window.DataSanitizer.sanitizeCandidate === 'function') {
      candidate = window.DataSanitizer.sanitizeCandidate(candidate);
    }
    if (!candidate) return { success: false, reason: 'invalid_candidate' };
    const database = await openDB();
    return new Promise((resolve, reject) => {
      const tx = database.transaction(CANDIDATES_STORE, 'readwrite');
      tx.objectStore(CANDIDATES_STORE).put(candidate);
      tx.oncomplete = () => {
        if (window.CloudSyncManager && typeof window.CloudSyncManager.schedulePush === 'function') {
          window.CloudSyncManager.schedulePush();
        }
        resolve({ success: true, id: candidate.id });
      };
      tx.onerror    = e => reject(e.target.error);
    });
  }

  async function getAllCandidates() {
    const database = await openDB();
    return new Promise((resolve, reject) => {
      const tx  = database.transaction(CANDIDATES_STORE, 'readonly');
      const req = tx.objectStore(CANDIDATES_STORE).getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror   = e => reject(e.target.error);
    });
  }

  async function deleteCandidate(id) {
    const database = await openDB();
    return new Promise((resolve, reject) => {
      const tx = database.transaction(CANDIDATES_STORE, 'readwrite');
      tx.objectStore(CANDIDATES_STORE).delete(id);
      tx.oncomplete = () => {
        if (window.CloudSyncManager && typeof window.CloudSyncManager.schedulePush === 'function') {
          window.CloudSyncManager.schedulePush();
        }
        resolve();
      };
      tx.onerror    = e => reject(e.target.error);
    });
  }

  // ─── Meta ─────────────────────────────────────────────────
  async function getMeta(key) {
    const database = await openDB();
    return new Promise(resolve => {
      const tx  = database.transaction(META_STORE, 'readonly');
      const req = tx.objectStore(META_STORE).get(key);
      req.onsuccess = () => resolve(req.result ? req.result.value : null);
      req.onerror   = () => resolve(null);
    });
  }

  async function setMeta(key, value) {
    const database = await openDB();
    return new Promise((resolve, reject) => {
      const tx = database.transaction(META_STORE, 'readwrite');
      tx.objectStore(META_STORE).put({ key, value });
      tx.oncomplete = () => resolve();
      tx.onerror    = e => reject(e.target.error);
    });
  }

  async function incrementMeta(key) {
    const current = (await getMeta(key)) || 0;
    await setMeta(key, current + 1);
  }

  async function clearAll() {
    const database = await openDB();
    return new Promise((resolve, reject) => {
      const tx = database.transaction([LEADS_STORE, CANDIDATES_STORE, META_STORE, DEDUP_STORE], 'readwrite');
      tx.objectStore(LEADS_STORE).clear();
      tx.objectStore(CANDIDATES_STORE).clear();
      tx.objectStore(META_STORE).clear();
      tx.objectStore(DEDUP_STORE).clear();
      tx.oncomplete = () => { resetTokenCounter(); resetKeyUsage(); resolve(); };
      tx.onerror    = e => reject(e.target.error);
    });
  }

  async function getStats() {
    const [total, dupes, sessions, pushed] = await Promise.all([
      getMeta('total_leads').then(v   => v || 0),
      getMeta('dupes_blocked').then(v => v || 0),
      getMeta('sessions_run').then(v  => v || 0),
      getMeta('sheets_pushed').then(v => v || 0),
    ]);
    return { total, dupes, sessions, pushed, tokens: getTotalTokensUsed() };
  }

  // ============================================================
  //  CLIENT AI (CHAT) — dedicated standalone chat history
  // ============================================================
  async function addClientChatMessage(msg) {
    const database = await openDB();
    return new Promise((resolve, reject) => {
      const tx = database.transaction(CLIENT_CHAT_STORE, 'readwrite');
      tx.objectStore(CLIENT_CHAT_STORE).put(msg);
      tx.oncomplete = () => resolve(msg);
      tx.onerror    = e => reject(e.target.error);
    });
  }

  async function getClientChatHistory(limit = 100) {
    const database = await openDB();
    return new Promise((resolve, reject) => {
      const tx  = database.transaction(CLIENT_CHAT_STORE, 'readonly');
      const req = tx.objectStore(CLIENT_CHAT_STORE).getAll();
      req.onsuccess = () => {
        const all = (req.result || []).sort((a, b) => a.timestamp - b.timestamp);
        resolve(all.slice(-limit));
      };
      req.onerror = e => reject(e.target.error);
    });
  }

  async function clearClientChatHistory() {
    const database = await openDB();
    return new Promise((resolve, reject) => {
      const tx = database.transaction(CLIENT_CHAT_STORE, 'readwrite');
      tx.objectStore(CLIENT_CHAT_STORE).clear();
      tx.oncomplete = () => resolve();
      tx.onerror    = e => reject(e.target.error);
    });
  }

  // ============================================================
  //  CANDIDATE AI — dedicated standalone chat history
  // ============================================================
  async function addCandidateChatMessage(msg) {
    const database = await openDB();
    return new Promise((resolve, reject) => {
      const tx = database.transaction(CANDIDATE_CHAT_STORE, 'readwrite');
      tx.objectStore(CANDIDATE_CHAT_STORE).put(msg);
      tx.oncomplete = () => resolve(msg);
      tx.onerror    = e => reject(e.target.error);
    });
  }

  async function getCandidateChatHistory(limit = 100) {
    const database = await openDB();
    return new Promise((resolve, reject) => {
      const tx  = database.transaction(CANDIDATE_CHAT_STORE, 'readonly');
      const req = tx.objectStore(CANDIDATE_CHAT_STORE).getAll();
      req.onsuccess = () => {
        const all = (req.result || []).sort((a, b) => a.timestamp - b.timestamp);
        resolve(all.slice(-limit));
      };
      req.onerror = e => reject(e.target.error);
    });
  }

  async function clearCandidateChatHistory() {
    const database = await openDB();
    return new Promise((resolve, reject) => {
      const tx = database.transaction(CANDIDATE_CHAT_STORE, 'readwrite');
      tx.objectStore(CANDIDATE_CHAT_STORE).clear();
      tx.oncomplete = () => resolve();
      tx.onerror    = e => reject(e.target.error);
    });
  }

  // ============================================================
  //  JARVIS — persistent chat history, long-term memory & scripts
  // ============================================================
  async function addJarvisMessage(msg) {
    const database = await openDB();
    return new Promise((resolve, reject) => {
      const tx = database.transaction(JARVIS_MSG_STORE, 'readwrite');
      tx.objectStore(JARVIS_MSG_STORE).put(msg);
      tx.oncomplete = () => resolve(msg);
      tx.onerror    = e => reject(e.target.error);
    });
  }

  async function getJarvisHistory(limit = 200) {
    const database = await openDB();
    return new Promise((resolve, reject) => {
      const tx  = database.transaction(JARVIS_MSG_STORE, 'readonly');
      const req = tx.objectStore(JARVIS_MSG_STORE).getAll();
      req.onsuccess = () => {
        const all = (req.result || []).sort((a, b) => a.timestamp - b.timestamp);
        resolve(all.slice(-limit));
      };
      req.onerror = e => reject(e.target.error);
    });
  }

  async function clearJarvisHistory() {
    const database = await openDB();
    return new Promise((resolve, reject) => {
      const tx = database.transaction(JARVIS_MSG_STORE, 'readwrite');
      tx.objectStore(JARVIS_MSG_STORE).clear();
      tx.oncomplete = () => resolve();
      tx.onerror    = e => reject(e.target.error);
    });
  }

  // ── Chat-history support: fetch ALL messages (not limited) ──────
  async function getAllJarvisMessages() {
    const database = await openDB();
    return new Promise((resolve, reject) => {
      const tx  = database.transaction(JARVIS_MSG_STORE, 'readonly');
      const req = tx.objectStore(JARVIS_MSG_STORE).getAll();
      req.onsuccess = () => {
        const all = (req.result || []).sort((a, b) => a.timestamp - b.timestamp);
        resolve(all);
      };
      req.onerror = e => reject(e.target.error);
    });
  }

  async function getJarvisMessage(id) {
    const database = await openDB();
    return new Promise((resolve, reject) => {
      const tx  = database.transaction(JARVIS_MSG_STORE, 'readonly');
      const req = tx.objectStore(JARVIS_MSG_STORE).get(id);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror   = e => reject(e.target.error);
    });
  }

  async function deleteJarvisMessage(id) {
    const database = await openDB();
    return new Promise((resolve, reject) => {
      const tx = database.transaction(JARVIS_MSG_STORE, 'readwrite');
      tx.objectStore(JARVIS_MSG_STORE).delete(id);
      tx.oncomplete = () => resolve();
      tx.onerror    = e => reject(e.target.error);
    });
  }

  async function deleteJarvisMessages(ids) {
    if (!Array.isArray(ids) || !ids.length) return;
    const database = await openDB();
    return new Promise((resolve, reject) => {
      const tx = database.transaction(JARVIS_MSG_STORE, 'readwrite');
      const store = tx.objectStore(JARVIS_MSG_STORE);
      ids.forEach(id => { try { store.delete(id); } catch (e) {} });
      tx.oncomplete = () => resolve();
      tx.onerror    = e => reject(e.target.error);
    });
  }

  // Long-term "facts" memory — durable key facts about the user/business
  // that Jarvis should recall across every future session (not just recent chat).
  async function setJarvisFact(key, value) {
    const database = await openDB();
    return new Promise((resolve, reject) => {
      const tx = database.transaction(JARVIS_FACT_STORE, 'readwrite');
      tx.objectStore(JARVIS_FACT_STORE).put({ key, value, updatedAt: Date.now() });
      tx.oncomplete = () => resolve();
      tx.onerror    = e => reject(e.target.error);
    });
  }

  async function getAllJarvisFacts() {
    const database = await openDB();
    return new Promise((resolve, reject) => {
      const tx  = database.transaction(JARVIS_FACT_STORE, 'readonly');
      const req = tx.objectStore(JARVIS_FACT_STORE).getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror   = e => reject(e.target.error);
    });
  }

  async function deleteJarvisFact(key) {
    const database = await openDB();
    return new Promise((resolve, reject) => {
      const tx = database.transaction(JARVIS_FACT_STORE, 'readwrite');
      tx.objectStore(JARVIS_FACT_STORE).delete(key);
      tx.oncomplete = () => resolve();
      tx.onerror    = e => reject(e.target.error);
    });
  }

  // Call scripts Jarvis generates for outbound client calls
  async function saveJarvisScript(script) {
    const database = await openDB();
    return new Promise((resolve, reject) => {
      const tx = database.transaction(JARVIS_SCRIPT_STORE, 'readwrite');
      tx.objectStore(JARVIS_SCRIPT_STORE).put(script);
      tx.oncomplete = () => resolve(script);
      tx.onerror    = e => reject(e.target.error);
    });
  }

  async function getAllJarvisScripts() {
    const database = await openDB();
    return new Promise((resolve, reject) => {
      const tx  = database.transaction(JARVIS_SCRIPT_STORE, 'readonly');
      const req = tx.objectStore(JARVIS_SCRIPT_STORE).getAll();
      req.onsuccess = () => resolve((req.result || []).sort((a, b) => b.timestamp - a.timestamp));
      req.onerror   = e => reject(e.target.error);
    });
  }

  async function deleteJarvisScript(id) {
    const database = await openDB();
    return new Promise((resolve, reject) => {
      const tx = database.transaction(JARVIS_SCRIPT_STORE, 'readwrite');
      tx.objectStore(JARVIS_SCRIPT_STORE).delete(id);
      tx.oncomplete = () => resolve();
      tx.onerror    = e => reject(e.target.error);
    });
  }

  // ── Dev Mode: custom skills Jarvis writes for itself at runtime ────
  async function saveCustomSkill(skill) {
    const database = await openDB();
    return new Promise((resolve, reject) => {
      const tx = database.transaction(JARVIS_SKILL_STORE, 'readwrite');
      tx.objectStore(JARVIS_SKILL_STORE).put(skill);
      tx.oncomplete = () => resolve(skill);
      tx.onerror    = e => reject(e.target.error);
    });
  }

  async function getAllCustomSkills() {
    const database = await openDB();
    return new Promise((resolve, reject) => {
      const tx  = database.transaction(JARVIS_SKILL_STORE, 'readonly');
      const req = tx.objectStore(JARVIS_SKILL_STORE).getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror   = e => reject(e.target.error);
    });
  }

  async function deleteCustomSkill(name) {
    const database = await openDB();
    return new Promise((resolve, reject) => {
      const tx = database.transaction(JARVIS_SKILL_STORE, 'readwrite');
      tx.objectStore(JARVIS_SKILL_STORE).delete(name);
      tx.oncomplete = () => resolve();
      tx.onerror    = e => reject(e.target.error);
    });
  }

  // ── Task run log (for the multi-step task runner / transparency) ────
  async function saveTaskRun(task) {
    const database = await openDB();
    return new Promise((resolve, reject) => {
      const tx = database.transaction(JARVIS_TASK_STORE, 'readwrite');
      tx.objectStore(JARVIS_TASK_STORE).put(task);
      tx.oncomplete = () => resolve(task);
      tx.onerror    = e => reject(e.target.error);
    });
  }

  async function getAllTaskRuns(limit = 50) {
    const database = await openDB();
    return new Promise((resolve, reject) => {
      const tx  = database.transaction(JARVIS_TASK_STORE, 'readonly');
      const req = tx.objectStore(JARVIS_TASK_STORE).getAll();
      req.onsuccess = () => resolve((req.result || []).sort((a, b) => b.timestamp - a.timestamp).slice(0, limit));
      req.onerror   = e => reject(e.target.error);
    });
  }

  // ─── VERSION SNAPSHOTS CRUD ────────────────────────────────
  async function saveSnapshot(snapshot) {
    const database = await openDB();
    return new Promise((resolve, reject) => {
      const tx = database.transaction(SNAPSHOTS_STORE, 'readwrite');
      tx.objectStore(SNAPSHOTS_STORE).put(snapshot);
      tx.oncomplete = () => resolve({ success: true, id: snapshot.id });
      tx.onerror    = e => reject(e.target.error);
    });
  }

  async function getAllSnapshots() {
    const database = await openDB();
    return new Promise((resolve, reject) => {
      const tx  = database.transaction(SNAPSHOTS_STORE, 'readonly');
      const req = tx.objectStore(SNAPSHOTS_STORE).getAll();
      req.onsuccess = () => resolve((req.result || []).sort((a, b) => b.timestamp - a.timestamp));
      req.onerror   = e => reject(e.target.error);
    });
  }

  async function getSnapshot(id) {
    const database = await openDB();
    return new Promise((resolve, reject) => {
      const tx  = database.transaction(SNAPSHOTS_STORE, 'readonly');
      const req = tx.objectStore(SNAPSHOTS_STORE).get(id);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror   = e => reject(e.target.error);
    });
  }

  async function deleteSnapshot(id) {
    const database = await openDB();
    return new Promise((resolve, reject) => {
      const tx = database.transaction(SNAPSHOTS_STORE, 'readwrite');
      tx.objectStore(SNAPSHOTS_STORE).delete(id);
      tx.oncomplete = () => resolve();
      tx.onerror    = e => reject(e.target.error);
    });
  }

  async function clearAllSnapshots() {
    const database = await openDB();
    return new Promise((resolve, reject) => {
      const tx = database.transaction(SNAPSHOTS_STORE, 'readwrite');
      tx.objectStore(SNAPSHOTS_STORE).clear();
      tx.oncomplete = () => resolve();
      tx.onerror    = e => reject(e.target.error);
    });
  }

  return {
    openDB, switchUser, getCurrentDBName, addLead, getAllLeads, saveAllLeads, updateLead, deleteLead,
    addCandidate, getAllCandidates, saveAllCandidates, deleteCandidate,
    getMeta, setMeta, incrementMeta, clearAll, getStats,
    batchDedupCheck, checkDuplicate, clearDedupStore,
    // Snapshot Management
    saveSnapshot, getAllSnapshots, getSnapshot, deleteSnapshot, clearAllSnapshots,
    // Token & key management
    getTotalTokensUsed, getSessionTokens, addTokensUsed,
    resetTokenCounter,  resetSessionTokens,
    // Key usage & rotation
    addKeyUsage, getKeyUsage, getKeyUsageMap, resetKeyUsage,
    checkKeyHealth, getBestApifyKey, addApifyUsage,
    getActiveApifyIdx, setActiveApifyIdx, getActiveGroqIdx, setActiveGroqIdx,
    recordApiError, getLastApiError, getApiUsageLogs, rotateToNextApifyKey, rotateProviderKey,
    recordApiLatency, getApiLatency,
    getCachedWebPage, setCachedWebPage,
    // Client AI memory
    addClientChatMessage, getClientChatHistory, clearClientChatHistory,
    // Candidate AI memory
    addCandidateChatMessage, getCandidateChatHistory, clearCandidateChatHistory,
    // Jarvis memory
    addJarvisMessage, getJarvisHistory, clearJarvisHistory,
    getAllJarvisMessages, getJarvisMessage, deleteJarvisMessage, deleteJarvisMessages,
    setJarvisFact, getAllJarvisFacts, deleteJarvisFact,
    saveJarvisScript, getAllJarvisScripts, deleteJarvisScript,
    saveCustomSkill, getAllCustomSkills, deleteCustomSkill,
    saveTaskRun, getAllTaskRuns,
  };
})();

window.MemoryEngine = MemoryEngine;
