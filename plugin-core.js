/**
 * ============================================================
 *  PLUGIN CORE (plugin-core.js)
 *
 *  Phase 1 of the plugin platform: Registry, Manifest validation, Lifecycle,
 *  Requirement probing, Health checks, per-user persistence and events.
 *
 *  DESIGN RULE THAT MATTERS MOST
 *  A plugin's displayed status is always DERIVED from a real check. Nothing here
 *  lets a plugin claim CONNECTED because a flag was flipped. If a plugin needs
 *  something that does not exist yet (a backend, OAuth credentials, an API key),
 *  the registry reports exactly what is missing instead of pretending.
 *
 *  Lifecycle state  (does the user want it on?)   NOT_INSTALLED | DISABLED | ENABLED
 *  Health state     (does it actually work?)      CONNECTED | DEGRADED | AUTH_EXPIRED
 *                                                | RATE_LIMITED | ERROR | DISCONNECTED
 *  These are separate on purpose: an enabled plugin can still be unhealthy.
 * ============================================================
 */

'use strict';

window.PluginCore = (function () {

  const STORAGE_KEY = 'plugin_state_v1';

  const LIFECYCLE = {
    NOT_INSTALLED: 'NOT_INSTALLED',
    DISABLED: 'DISABLED',
    ENABLED: 'ENABLED'
  };

  const HEALTH = {
    CONNECTED: 'CONNECTED',
    DEGRADED: 'DEGRADED',
    AUTH_EXPIRED: 'AUTH_EXPIRED',
    RATE_LIMITED: 'RATE_LIMITED',
    ERROR: 'ERROR',
    DISCONNECTED: 'DISCONNECTED'
  };

  const CATEGORIES = {
    communication: 'Communication',
    recruitment: 'Recruitment',
    google: 'Google Workspace',
    microsoft: 'Microsoft 365',
    ai: 'AI Providers',
    storage: 'Storage',
    crm: 'CRM',
    security: 'Security'
  };

  /** id -> manifest */
  const registry = new Map();
  /** id -> { installed, enabled, config, health, healthMessage, checkedAt } */
  let state = {};

  // ── Persistence (scoped to the signed-in user) ─────────────────────────
  // UserStorage namespaces by account, so one user's plugin setup never leaks
  // into another's. Falls back to plain localStorage only if it is unavailable.
  function loadState() {
    try {
      if (window.UserStorage) {
        state = window.UserStorage.getJSON(STORAGE_KEY, null) || {};
        return;
      }
      state = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
    } catch (_) {
      state = {};
    }
  }

  function persist() {
    try {
      if (window.UserStorage) window.UserStorage.setJSON(STORAGE_KEY, state);
      else localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (err) {
      console.warn('[PluginCore] could not persist plugin state:', err);
      return false;
    }
    return true;
  }

  function entry(id) {
    if (!state[id]) {
      state[id] = { installed: false, enabled: false, config: {}, health: null, healthMessage: '', checkedAt: null };
    }
    return state[id];
  }

  // ── Manifest validation ────────────────────────────────────────────────
  const REQUIRED_FIELDS = ['id', 'name', 'version', 'category'];

  function validateManifest(manifest) {
    const problems = [];
    if (!manifest || typeof manifest !== 'object') {
      return ['manifest is not an object'];
    }
    REQUIRED_FIELDS.forEach(field => {
      if (!manifest[field]) problems.push(`missing "${field}"`);
    });
    if (manifest.category && !CATEGORIES[manifest.category]) {
      problems.push(`unknown category "${manifest.category}"`);
    }
    if (manifest.capabilities && !Array.isArray(manifest.capabilities)) {
      problems.push('"capabilities" must be an array');
    }
    if (manifest.permissions && !Array.isArray(manifest.permissions)) {
      problems.push('"permissions" must be an array');
    }
    if (manifest.requires && !Array.isArray(manifest.requires)) {
      problems.push('"requires" must be an array');
    }
    if (manifest.healthCheck && typeof manifest.healthCheck !== 'function') {
      problems.push('"healthCheck" must be a function');
    }
    return problems;
  }

  function register(manifest) {
    const problems = validateManifest(manifest);
    if (problems.length) {
      console.error(`[PluginCore] rejected manifest ${manifest && manifest.id}: ${problems.join('; ')}`);
      return { ok: false, problems };
    }
    if (registry.has(manifest.id)) {
      console.warn(`[PluginCore] plugin "${manifest.id}" already registered — replacing.`);
    }
    registry.set(manifest.id, Object.freeze({
      permissions: [],
      capabilities: [],
      requires: [],
      description: '',
      vendor: '',
      authentication: { type: 'none' },
      ...manifest
    }));
    return { ok: true };
  }

  // ── Requirement probing ────────────────────────────────────────────────
  // Each `requires` item declares a `check()` that returns true when satisfied.
  // This is what keeps the UI honest: unmet requirements are reported verbatim.
  function unmetRequirements(id) {
    const manifest = registry.get(id);
    if (!manifest) return [];
    return (manifest.requires || []).filter(req => {
      try {
        return typeof req.check === 'function' ? !req.check() : false;
      } catch (err) {
        console.warn(`[PluginCore] requirement probe failed for ${id}:`, err);
        return true;
      }
    });
  }

  function isReady(id) {
    return unmetRequirements(id).length === 0;
  }

  // ── Lifecycle ──────────────────────────────────────────────────────────
  function lifecycleOf(id) {
    const st = state[id];
    if (!st || !st.installed) return LIFECYCLE.NOT_INSTALLED;
    return st.enabled ? LIFECYCLE.ENABLED : LIFECYCLE.DISABLED;
  }

  function install(id) {
    if (!registry.has(id)) return { ok: false, message: 'Unknown plugin.' };
    const st = entry(id);
    st.installed = true;
    st.enabled = false;
    if (!persist()) return { ok: false, message: 'Could not save — browser storage is full or blocked.' };
    emit('installed', id);
    return { ok: true, message: 'Installed.' };
  }

  function uninstall(id) {
    if (!registry.has(id)) return { ok: false, message: 'Unknown plugin.' };
    delete state[id];
    if (!persist()) return { ok: false, message: 'Could not save — browser storage is full or blocked.' };
    emit('uninstalled', id);
    return { ok: true, message: 'Removed.' };
  }

  async function enable(id) {
    if (!registry.has(id)) return { ok: false, message: 'Unknown plugin.' };

    const missing = unmetRequirements(id);
    if (missing.length) {
      // Refuse rather than showing a green state the plugin cannot honour.
      return {
        ok: false,
        message: `Cannot enable yet — ${missing.map(m => m.label).join('; ')}.`,
        missing
      };
    }

    const st = entry(id);
    st.installed = true;
    st.enabled = true;
    if (!persist()) return { ok: false, message: 'Could not save — browser storage is full or blocked.' };
    emit('enabled', id);

    const health = await checkHealth(id);
    return { ok: true, message: 'Enabled.', health };
  }

  function disable(id) {
    if (!registry.has(id)) return { ok: false, message: 'Unknown plugin.' };
    const st = entry(id);
    st.enabled = false;
    st.health = null;
    st.healthMessage = '';
    st.checkedAt = null;
    if (!persist()) return { ok: false, message: 'Could not save — browser storage is full or blocked.' };
    emit('disabled', id);
    return { ok: true, message: 'Disabled.' };
  }

  function configure(id, config) {
    if (!registry.has(id)) return { ok: false, message: 'Unknown plugin.' };
    const st = entry(id);
    st.config = { ...st.config, ...(config || {}) };
    if (!persist()) return { ok: false, message: 'Could not save — browser storage is full or blocked.' };
    emit('configured', id);
    return { ok: true, message: 'Saved.', config: st.config };
  }

  function getConfig(id) {
    return { ...(state[id]?.config || {}) };
  }

  /**
   * Applies the values a user typed into a plugin's setup form.
   *
   * The plugin's own `applySetup` owns persistence, because each provider writes
   * to a different place (an existing localStorage key, SKYLARK_CONFIG, a DOM
   * field). After it runs we RE-PROBE the requirements, so the returned
   * `ready` flag is measured rather than assumed.
   */
  async function saveSetup(id, values) {
    const manifest = registry.get(id);
    if (!manifest) return { ok: false, message: 'Unknown plugin.' };

    const fields = manifest.setup?.fields || [];

    // Validate before writing anything, so a bad value never half-applies.
    for (const field of fields) {
      const raw = (values?.[field.key] ?? '').toString().trim();
      if (field.required && !raw) {
        return { ok: false, message: `${field.label} is required.`, field: field.key };
      }
      if (raw && typeof field.validate === 'function') {
        const problem = field.validate(raw);
        if (problem) return { ok: false, message: problem, field: field.key };
      }
    }

    if (typeof manifest.applySetup === 'function') {
      try {
        const result = await manifest.applySetup(values || {});
        if (result && result.ok === false) return result;
      } catch (err) {
        console.error(`[PluginCore] applySetup failed for ${id}:`, err);
        return { ok: false, message: shorten(err?.message || 'Could not save.') };
      }
    }

    // Keep a non-secret copy of anything the plugin marked as safe to remember.
    const safeValues = {};
    fields.filter(f => f.persistInConfig).forEach(f => {
      if (values?.[f.key] !== undefined) safeValues[f.key] = values[f.key];
    });
    if (Object.keys(safeValues).length) configure(id, safeValues);

    const missing = unmetRequirements(id);
    emit('setup', id);
    return {
      ok: true,
      ready: missing.length === 0,
      missing,
      message: missing.length
        ? `Saved, but still blocked: ${missing.map(m => m.label).join('; ')}.`
        : 'Saved.'
    };
  }

  // ── Health ─────────────────────────────────────────────────────────────
  /**
   * Runs the plugin's own healthCheck. Never invents a result:
   *  - not enabled            -> DISCONNECTED, "Not enabled"
   *  - requirements unmet     -> DISCONNECTED, lists what is missing
   *  - no healthCheck defined -> DEGRADED, says it cannot be verified
   *  - healthCheck throws     -> ERROR with the reason
   */
  async function checkHealth(id) {
    const manifest = registry.get(id);
    if (!manifest) return { state: HEALTH.ERROR, message: 'Unknown plugin.' };

    const st = entry(id);

    if (!st.enabled) {
      return record(id, HEALTH.DISCONNECTED, 'Not enabled.');
    }

    const missing = unmetRequirements(id);
    if (missing.length) {
      return record(id, HEALTH.DISCONNECTED, missing.map(m => m.label).join('; '));
    }

    if (typeof manifest.healthCheck !== 'function') {
      return record(id, HEALTH.DEGRADED, 'This plugin does not report health yet, so it cannot be verified.');
    }

    try {
      const result = await manifest.healthCheck({
        config: getConfig(id),
        manifest
      });
      const nextState = HEALTH[result?.state] || HEALTH.ERROR;
      return record(id, nextState, String(result?.message || ''));
    } catch (err) {
      console.error(`[PluginCore] healthCheck threw for ${id}:`, err);
      return record(id, HEALTH.ERROR, shorten(err?.message || 'Health check failed.'));
    }
  }

  function record(id, healthState, message) {
    const st = entry(id);
    st.health = healthState;
    st.healthMessage = message;
    st.checkedAt = Date.now();
    persist();
    emit('health', id, { state: healthState, message });
    return { state: healthState, message, checkedAt: st.checkedAt };
  }

  async function checkAllEnabled() {
    const results = {};
    for (const id of registry.keys()) {
      if (lifecycleOf(id) === LIFECYCLE.ENABLED) {
        results[id] = await checkHealth(id);
      }
    }
    return results;
  }

  function shorten(text) {
    const raw = String(text || '');
    return raw.length > 120 ? raw.slice(0, 117) + '…' : raw;
  }

  // ── Events ─────────────────────────────────────────────────────────────
  function emit(action, id, detail) {
    try {
      document.dispatchEvent(new CustomEvent(`nexus:plugin:${action}`, {
        detail: { pluginId: id, ...(detail || {}) }
      }));
      document.dispatchEvent(new CustomEvent('nexus:plugin:changed', {
        detail: { pluginId: id, action, ...(detail || {}) }
      }));
    } catch (_) { /* CustomEvent unavailable — non-fatal */ }
  }

  // ── Read API for the UI ────────────────────────────────────────────────
  /** Full view model for one plugin: manifest + lifecycle + health + gaps. */
  function describe(id) {
    const manifest = registry.get(id);
    if (!manifest) return null;
    const st = state[id] || {};
    const missing = unmetRequirements(id);
    return {
      ...manifest,
      categoryLabel: CATEGORIES[manifest.category] || manifest.category,
      lifecycle: lifecycleOf(id),
      ready: missing.length === 0,
      missing,
      health: st.health || null,
      healthMessage: st.healthMessage || '',
      checkedAt: st.checkedAt || null,
      config: { ...(st.config || {}) }
    };
  }

  function list() {
    return [...registry.keys()].map(describe);
  }

  function categories() {
    return { ...CATEGORIES };
  }

  function stats() {
    const all = list();
    return {
      total: all.length,
      enabled: all.filter(p => p.lifecycle === LIFECYCLE.ENABLED).length,
      connected: all.filter(p => p.health === HEALTH.CONNECTED).length,
      needsSetup: all.filter(p => !p.ready).length,
      problems: all.filter(p => [HEALTH.ERROR, HEALTH.AUTH_EXPIRED, HEALTH.RATE_LIMITED].includes(p.health)).length
    };
  }

  // Reload state when the account changes, so plugin setup follows the user.
  document.addEventListener('nexus:profilechange', loadState);

  loadState();

  return {
    LIFECYCLE, HEALTH, CATEGORIES,
    register, validateManifest,
    install, uninstall, enable, disable, configure, getConfig, saveSetup,
    checkHealth, checkAllEnabled,
    unmetRequirements, isReady,
    describe, list, categories, stats,
    lifecycleOf,
    _reloadState: loadState
  };
})();
