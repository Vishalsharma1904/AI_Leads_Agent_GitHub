/**
 * ============================================================
 *  SKYLARK — Memory Engine (memory.js)
 *  Persistent IndexedDB storage + token counter per key
 *  Data persists across browser restarts permanently.
 * ============================================================
 */

'use strict';

const MemoryEngine = (() => {
  const DB_NAME     = 'skylark_agent_db';
  const DB_VERSION  = 7;
  const LEADS_STORE = 'leads';
  const CANDIDATES_STORE = 'candidates';
  const META_STORE  = 'meta';
  const DEDUP_STORE = 'dedup_index';
  const JARVIS_MSG_STORE  = 'jarvis_messages';
  const JARVIS_FACT_STORE = 'jarvis_facts';
  const JARVIS_SCRIPT_STORE = 'jarvis_scripts';
  const JARVIS_SKILL_STORE = 'jarvis_custom_skills';
  const JARVIS_TASK_STORE  = 'jarvis_tasks';
  const SNAPSHOTS_STORE    = 'snapshots';
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

  // ─── Active key index management ─────────────────────────
  function getActiveApifyIdx() { return parseInt(localStorage.getItem(ACTIVE_APIFY_KEY) || '0'); }
  function setActiveApifyIdx(i){ localStorage.setItem(ACTIVE_APIFY_KEY, String(i)); }
  function getActiveGroqIdx()  { return parseInt(localStorage.getItem(ACTIVE_GROQ_KEY)  || '0'); }
  function setActiveGroqIdx(i) { localStorage.setItem(ACTIVE_GROQ_KEY,  String(i)); }

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

    if (pct >= 90 && !isKeyWarned(keyId)) {
      markKeyWarned(keyId);
      return { warn: true, pct: Math.round(pct), keyType, keyIndex, used, limit };
    }
    return { warn: false, pct: Math.round(pct) };
  }

  // ─── Best available key (skip exhausted ones) ─────────────
  function getBestApifyKey() {
    const cfg    = window.SKYLARK_CONFIG || {};
    const keys   = (cfg.APIFY_API_KEYS || []).filter(k => k && k.trim());
    const limit  = cfg.APIFY_KEY_LIMIT || 400;
    if (keys.length === 0) return { key: null, index: -1 };

    let idx = getActiveApifyIdx();
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
    return checkKeyHealth('apify', idx);
  }

  // ─── IndexedDB Setup ──────────────────────────────────────
  async function openDB() {
    if (db) return db;
    return new Promise((resolve, reject) => {
      try {
        const req = indexedDB.open(DB_NAME, DB_VERSION);
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
          if (typeof showToast === 'function') showToast('warning', 'Database Blocked', 'Database upgrade blocked. Please close other open tabs of this app.');
        };
        req.onsuccess = e => { db = e.target.result; resolve(db); };
        req.onerror   = e => {
          console.error("IndexedDB Error:", e.target.error);
          if (typeof showToast === 'function') showToast('error', 'Database Error', 'Could not open local database. Please allow storage access.');
          reject(e.target.error);
        };
      } catch (err) {
        console.error("IndexedDB Initialization Error:", err);
        if (typeof showToast === 'function') showToast('error', 'Database Error', 'IndexedDB is blocked or unsupported in this browser/mode.');
        reject(err);
      }
    });
  }

  // ─── Dedup ────────────────────────────────────────────────
  function genDedupHash(lead, strategy = 'company+type') {
    const n = s => (s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    if (strategy === 'email')   return n(lead.email)   || `${n(lead.company)}_noemail`;
    if (strategy === 'company') return n(lead.company);
    if (strategy === 'phone')   return n(lead.phone)   || `${n(lead.company)}_nophone`;
    return `${n(lead.company)}_${n(lead.type)}_${n(lead.city)}`;
  }

  async function checkDuplicate(lead) {
    const database = await openDB();
    const strategy = localStorage.getItem('skylark_dedup_strategy') || 'company+type';
    const hash     = genDedupHash(lead, strategy);
    return new Promise(resolve => {
      const tx  = database.transaction(DEDUP_STORE, 'readonly');
      const req = tx.objectStore(DEDUP_STORE).get(hash);
      req.onsuccess = () => resolve({ isDuplicate: !!req.result, hash });
      req.onerror   = () => resolve({ isDuplicate: false, hash });
    });
  }

  async function batchDedupCheck(leads) {
    const database = await openDB();
    const strategy = localStorage.getItem('skylark_dedup_strategy') || 'company+type';
    const results  = [];
    for (const lead of leads) {
      const hash  = genDedupHash(lead, strategy);
      const isDup = await new Promise(resolve => {
        const tx  = database.transaction(DEDUP_STORE, 'readonly');
        const req = tx.objectStore(DEDUP_STORE).get(hash);
        req.onsuccess = () => resolve(!!req.result);
        req.onerror   = () => resolve(false);
      });
      results.push({ lead, hash, isDuplicate: isDup });
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

  // ─── CRUD ─────────────────────────────────────────────────
  async function addLead(lead) {
    if (window.DataSanitizer && typeof window.DataSanitizer.sanitizeLead === 'function') {
      lead = window.DataSanitizer.sanitizeLead(lead);
    }
    if (!lead) return { success: false, reason: 'invalid_lead' };
    const database = await openDB();
    const { isDuplicate, hash } = await checkDuplicate(lead);
    if (isDuplicate) { await incrementMeta('dupes_blocked'); return { success: false, reason: 'duplicate' }; }
    return new Promise((resolve, reject) => {
      const tx = database.transaction([LEADS_STORE, DEDUP_STORE], 'readwrite');
      tx.objectStore(LEADS_STORE).add(lead);
      tx.objectStore(DEDUP_STORE).add({ hash, leadId: lead.id, timestamp: lead.timestamp });
      tx.oncomplete = () => resolve({ success: true, id: lead.id });
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
        tx.oncomplete = () => resolve(updated);
        tx.onerror    = e => reject(e.target.error);
      };
    });
  }

  async function deleteLead(id) {
    const database = await openDB();
    return new Promise((resolve, reject) => {
      const tx = database.transaction(LEADS_STORE, 'readwrite');
      tx.objectStore(LEADS_STORE).delete(id);
      tx.oncomplete = () => resolve();
      tx.onerror    = e => reject(e.target.error);
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
      tx.objectStore(CANDIDATES_STORE).add(candidate);
      tx.oncomplete = () => resolve({ success: true, id: candidate.id });
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
      tx.oncomplete = () => resolve();
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
    openDB, addLead, getAllLeads, updateLead, deleteLead,
    addCandidate, getAllCandidates, deleteCandidate,
    getMeta, setMeta, incrementMeta, clearAll, getStats,
    batchDedupCheck, checkDuplicate, clearDedupStore,
    // Snapshot Management
    saveSnapshot, getAllSnapshots, getSnapshot, deleteSnapshot, clearAllSnapshots,
    // Token & key management
    getTotalTokensUsed, getSessionTokens, addTokensUsed,
    resetTokenCounter,  resetSessionTokens,
    // Key usage
    addKeyUsage, getKeyUsage, getKeyUsageMap, resetKeyUsage,
    checkKeyHealth, getBestApifyKey, addApifyUsage,
    getActiveApifyIdx, setActiveApifyIdx, getActiveGroqIdx, setActiveGroqIdx,
    // Jarvis memory
    addJarvisMessage, getJarvisHistory, clearJarvisHistory,
    setJarvisFact, getAllJarvisFacts, deleteJarvisFact,
    saveJarvisScript, getAllJarvisScripts, deleteJarvisScript,
    saveCustomSkill, getAllCustomSkills, deleteCustomSkill,
    saveTaskRun, getAllTaskRuns,
  };
})();

window.MemoryEngine = MemoryEngine;
