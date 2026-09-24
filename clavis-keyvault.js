/* ============================================================
 * clavis-keyvault.js  ·  Encrypted provider-key vault
 * ------------------------------------------------------------
 * The problem this solves, plainly:
 *   Keys pasted into the UI used to land in localStorage as readable
 *   text. Anyone with the machine — or DevTools open for two seconds —
 *   could read them, and a copied project folder carried them along.
 *
 * What happens instead:
 *   · a non-extractable AES-GCM CryptoKey is generated once per device
 *     and kept in IndexedDB. The browser will hand it to this page to
 *     encrypt and decrypt with, but will NOT hand over its bytes — not
 *     to script, not to DevTools, not to a copied folder.
 *   · every provider key is stored only as ciphertext under that key.
 *   · the UI is given a MASK ("gsk_••••4f2a") and a health state. It is
 *     never given the secret. Only ClavisDirect.keyFor() gets the real
 *     thing, and only in memory, at call time.
 *   · when a backend vault is reachable and signed in, the key is
 *     pushed there too and the local copy becomes a warm cache.
 *
 * Refuelling:
 *   Providers say "quota exceeded" in a dozen different ways. The AI
 *   layer classifies that and calls report(). The vault marks the key
 *   spent, rotates to the next key for that provider, and — when a
 *   provider is fully dry — raises a refuel card: one click to the
 *   right console page, paste, verified, live. No config files.
 * ============================================================ */
(function (global) {
  'use strict';

  if (global.ClavisKeyVault) return;

  var DB_NAME = 'clavis-vault';
  var DB_STORE = 'v1';
  var WRAP_ID = '__wrapping_key__';
  var LS_META = 'clavis_vault_meta';     // masks + health only, never secrets
  var LS_MIGRATED = 'clavis_vault_migrated';

  /* Where a person actually goes to get or top up a key. This is the
     whole "refuel in a few clicks" promise — the right page, not a
     search result. */
  // PROVIDER_INFO[*].test is a RegExp. It used to be called like a function
  // (info.test(key)) — a TypeError that made every vault save fail.
  function keyShapeOk(info, key) {
    var t = info && info.test;
    if (!t) return true;
    return typeof t === 'function' ? !!t(key) : t.test(String(key || ''));
  }

  var PROVIDER_INFO = {
    groq: {
      label: 'Groq',
      note: 'Fastest. Free tier resets daily.',
      console: 'https://console.groq.com/keys',
      prefix: 'gsk_',
      test: /^gsk_\S{10,}$/
    },
    gemini: {
      label: 'Google AI Studio',
      note: 'Generous free tier. Reads images.',
      console: 'https://aistudio.google.com/apikey',
      prefix: 'AIza',
      test: /^AIza\S{10,}$/
    },
    openrouter: {
      label: 'OpenRouter',
      note: 'Many free models behind one key.',
      console: 'https://openrouter.ai/keys',
      prefix: 'sk-or-',
      test: /^sk-or-\S{10,}$/
    },
    openai: {
      label: 'OpenAI', note: 'Paid.', console: 'https://platform.openai.com/api-keys',
      prefix: 'sk-', test: /^sk-\S{10,}$/
    },
    deepseek: {
      label: 'DeepSeek', note: 'Cheap, strong at reasoning.', console: 'https://platform.deepseek.com/api_keys',
      prefix: 'sk-', test: /^sk-\S{10,}$/
    },
    xai: {
      label: 'xAI Grok', note: 'Paid.', console: 'https://console.x.ai/',
      prefix: 'xai-', test: /^xai-\S{10,}$/
    }
  };

  /* Fallback order. Groq first because it is fastest and free; AI Studio
     second because its free tier is the most forgiving and it can see
     images. This is the "ek khatam to dusra chale" chain. */
  var CHAIN = ['groq', 'gemini', 'openrouter', 'openai', 'deepseek', 'xai'];

  /* ── Plaintext lives here and nowhere else ────────────────
     A closure variable, populated at unlock, never serialised. */
  var unlocked = {};          // provider -> [key, key, ...]
  var meta = {};              // provider -> { masks:[], health:[], added }
  var ready = null;
  var listeners = [];

  /* ── IndexedDB ───────────────────────────────────────────── */
  function idb() {
    return new Promise(function (resolve, reject) {
      var req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = function () {
        if (!req.result.objectStoreNames.contains(DB_STORE)) req.result.createObjectStore(DB_STORE);
      };
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { reject(req.error); };
    });
  }

  function idbGet(key) {
    return idb().then(function (db) {
      return new Promise(function (resolve, reject) {
        var r = db.transaction(DB_STORE, 'readonly').objectStore(DB_STORE).get(key);
        r.onsuccess = function () { resolve(r.result); };
        r.onerror = function () { reject(r.error); };
      });
    });
  }

  function idbPut(key, value) {
    return idb().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction(DB_STORE, 'readwrite');
        tx.objectStore(DB_STORE).put(value, key);
        tx.oncomplete = function () { resolve(true); };
        tx.onerror = function () { reject(tx.error); };
      });
    });
  }

  /* ── The wrapping key ─────────────────────────────────────
     extractable:false is the load-bearing word in this file. */
  function wrappingKey() {
    return idbGet(WRAP_ID).then(function (existing) {
      if (existing) return existing;
      return crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'])
        .then(function (k) { return idbPut(WRAP_ID, k).then(function () { return k; }); });
    });
  }

  function b64(buf) {
    var bytes = new Uint8Array(buf), s = '';
    for (var i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
    return btoa(s);
  }
  function unb64(str) {
    var s = atob(str), out = new Uint8Array(s.length);
    for (var i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
    return out;
  }

  function encrypt(plain) {
    return wrappingKey().then(function (k) {
      var iv = crypto.getRandomValues(new Uint8Array(12));
      return crypto.subtle.encrypt({ name: 'AES-GCM', iv: iv }, k, new TextEncoder().encode(plain))
        .then(function (ct) { return { iv: b64(iv), ct: b64(ct) }; });
    });
  }

  function decrypt(rec) {
    return wrappingKey().then(function (k) {
      return crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(rec.iv) }, k, unb64(rec.ct))
        .then(function (pt) { return new TextDecoder().decode(pt); });
    });
  }

  /* ── Masks & metadata (safe to persist in the clear) ─────── */
  function mask(key) {
    var s = String(key || '');
    if (s.length < 10) return '••••';
    var info = Object.keys(PROVIDER_INFO).map(function (p) { return PROVIDER_INFO[p].prefix; })
      .filter(function (pre) { return s.indexOf(pre) === 0; })[0] || '';
    return (info || s.slice(0, 3)) + '••••' + s.slice(-4);
  }

  function loadMeta() {
    try { meta = JSON.parse(localStorage.getItem(LS_META) || '{}') || {}; }
    catch (_) { meta = {}; }
    return meta;
  }
  function saveMeta() {
    try { localStorage.setItem(LS_META, JSON.stringify(meta)); } catch (_) {}
  }

  function metaFor(provider) {
    if (!meta[provider]) meta[provider] = { masks: [], health: [], added: 0 };
    return meta[provider];
  }

  function emit() {
    var snap = status();
    listeners.forEach(function (fn) { try { fn(snap); } catch (_) {} });
    try { global.dispatchEvent(new CustomEvent('clavis:vault-changed', { detail: snap })); } catch (_) {}
  }

  /* ── Persist / restore ────────────────────────────────────── */
  function persist(provider) {
    var keys = unlocked[provider] || [];
    if (!keys.length) {
      return idbPut('keys:' + provider, null).then(function () {
        delete meta[provider]; saveMeta(); return true;
      });
    }
    return Promise.all(keys.map(encrypt)).then(function (recs) {
      return idbPut('keys:' + provider, recs);
    }).then(function () {
      var m = metaFor(provider);
      m.masks = keys.map(mask);
      // keep health array the same length as keys
      m.health = keys.map(function (_, i) { return m.health[i] || 'unknown'; });
      m.added = m.added || Date.now();
      saveMeta();
      return true;
    });
  }

  function restore() {
    loadMeta();
    var providers = Object.keys(PROVIDER_INFO);
    return Promise.all(providers.map(function (p) {
      return idbGet('keys:' + p).then(function (recs) {
        if (!Array.isArray(recs) || !recs.length) return null;
        return Promise.all(recs.map(function (r) {
          return decrypt(r).catch(function () { return ''; });
        })).then(function (keys) {
          keys = keys.filter(Boolean);
          if (keys.length) unlocked[p] = keys;
        });
      }).catch(function () { return null; });
    }));
  }

  /* ── One-time migration off plaintext localStorage ────────
     Anyone upgrading has keys sitting in the clear right now. Pull them
     into the vault and scrub the originals, silently, once. */
  function migrateLegacy() {
    if (localStorage.getItem(LS_MIGRATED)) return Promise.resolve();
    var found = [];

    function take(provider, value) {
      var v = String(value || '').trim();
      if (!v) return;
      var info = PROVIDER_INFO[provider];
      if (info && !keyShapeOk(info, v)) return;
      found.push({ provider: provider, key: v });
    }

    try {
      var map = JSON.parse(localStorage.getItem('clavis_provider_keys') || '{}') || {};
      Object.keys(map).forEach(function (p) { take(p, map[p]); });
    } catch (_) {}
    try {
      var arr = JSON.parse(localStorage.getItem('jarvis_openrouter_keys') || '[]') || [];
      arr.forEach(function (k) { take('openrouter', k); });
    } catch (_) {}
    Object.keys(PROVIDER_INFO).forEach(function (p) {
      take(p, localStorage.getItem('skylark_' + p + '_key'));
      take(p, localStorage.getItem('skylark_custom_' + p));
    });
    take('groq', localStorage.getItem('skylark-llm-key'));

    if (!found.length) {
      try { localStorage.setItem(LS_MIGRATED, '1'); } catch (_) {}
      return Promise.resolve();
    }

    found.forEach(function (f) {
      unlocked[f.provider] = unlocked[f.provider] || [];
      if (unlocked[f.provider].indexOf(f.key) === -1) unlocked[f.provider].push(f.key);
    });

    var providers = [...new Set(found.map(function (f) { return f.provider; }))];
    return Promise.all(providers.map(persist)).then(function () {
      // Scrub the plaintext now that ciphertext exists.
      ['clavis_provider_keys', 'jarvis_openrouter_keys', 'skylark-llm-key'].forEach(function (k) {
        try { localStorage.removeItem(k); } catch (_) {}
      });
      Object.keys(PROVIDER_INFO).forEach(function (p) {
        try { localStorage.removeItem('skylark_' + p + '_key'); } catch (_) {}
        try { localStorage.removeItem('skylark_custom_' + p); } catch (_) {}
      });
      try { localStorage.setItem(LS_MIGRATED, '1'); } catch (_) {}
      console.info('[Vault] Moved ' + found.length + ' key(s) out of plaintext storage into the encrypted vault.');
    });
  }

  /* ── Optional backend mirror ──────────────────────────────
     When the FastAPI vault is up and the user is signed in, the key is
     also stored server-side (AES-GCM, tenant-scoped) so it survives a
     new browser. Failure here is never fatal — local encryption already
     satisfies "don't leave it lying around in the open". */
  function pushToBackend(provider, key) {
    var base = (global.SKYLARK_CONFIG && global.SKYLARK_CONFIG.BACKEND_URL) || '';
    var token = '';
    try { token = localStorage.getItem('clavis_access_token') || localStorage.getItem('skylark_token') || ''; } catch (_) {}
    if (!base || !token) return Promise.resolve({ synced: false, reason: 'offline' });
    return fetch(base.replace(/\/$/, '') + '/api/credentials', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
      body: JSON.stringify({ provider: provider, secret: key })
    }).then(function (r) {
      return { synced: r.ok, reason: r.ok ? '' : 'http ' + r.status };
    }).catch(function () { return { synced: false, reason: 'unreachable' }; });
  }

  /* ── Health ───────────────────────────────────────────────── */
  function markHealth(provider, index, state) {
    var m = metaFor(provider);
    m.health[index] = state;
    if (state === 'spent') m.spentAt = Date.now();
    saveMeta();
  }

  /* Quota resets. A key marked spent yesterday is very likely fine now,
     so it is given back its chance rather than staying dead forever. */
  function thawStale() {
    var now = Date.now();
    Object.keys(meta).forEach(function (p) {
      var m = meta[p];
      if (!m.spentAt || now - m.spentAt < 6 * 3600e3) return;
      m.health = (m.health || []).map(function (h) { return h === 'spent' ? 'unknown' : h; });
      delete m.spentAt;
    });
    saveMeta();
  }

  /* Healthy keys first, unknown next, spent last but still tried —
     "probably out of quota" is a guess, and a guess should not be the
     reason a reply fails. */
  function ordered(provider) {
    var keys = unlocked[provider] || [];
    var m = metaFor(provider);
    var rank = { ok: 0, unknown: 1, spent: 2, rejected: 3 };
    return keys.map(function (k, i) { return { k: k, r: rank[m.health[i]] === undefined ? 1 : rank[m.health[i]] }; })
      .sort(function (a, b) { return a.r - b.r; })
      .map(function (x) { return x.k; });
  }

  /* ── Public surface ───────────────────────────────────────── */

  /** The secret, synchronously, for the AI layer only. */
  function use(provider) {
    return ordered(String(provider || '').toLowerCase())[0] || '';
  }

  /** Every key for a provider, best-first (OpenRouter rotation wants this). */
  function all(provider) {
    return ordered(String(provider || '').toLowerCase()).slice();
  }

  /** What the UI is allowed to know. Masks and health — no secrets. */
  function status() {
    var out = { providers: {}, connected: [], anyKey: false, allSpent: false, chain: CHAIN.slice() };
    Object.keys(PROVIDER_INFO).forEach(function (p) {
      var keys = unlocked[p] || [];
      var m = metaFor(p);
      var healthy = keys.filter(function (_, i) { return m.health[i] !== 'spent' && m.health[i] !== 'rejected'; }).length;
      out.providers[p] = {
        label: PROVIDER_INFO[p].label,
        note: PROVIDER_INFO[p].note,
        console: PROVIDER_INFO[p].console,
        count: keys.length,
        healthy: healthy,
        masks: (m.masks || []).slice(),
        health: (m.health || []).slice(),
        state: !keys.length ? 'empty' : (healthy ? 'live' : 'spent')
      };
      if (keys.length) { out.connected.push(p); out.anyKey = true; }
    });
    out.allSpent = out.anyKey && out.connected.every(function (p) { return out.providers[p].state === 'spent'; });
    return out;
  }

  /** Add a key. Verifies it before it is trusted, then encrypts it. */
  function add(provider, key, opts) {
    provider = String(provider || '').toLowerCase();
    key = String(key || '').trim();
    opts = opts || {};
    var info = PROVIDER_INFO[provider];
    if (!info) return Promise.reject(new Error('Unknown provider: ' + provider));
    if (!keyShapeOk(info, key)) {
      return Promise.reject(new Error('That does not look like a ' + info.label + ' key (expected it to start with "' + info.prefix + '").'));
    }

    var verify = opts.skipVerify || !global.ClavisDirect
      ? Promise.resolve({ ok: true })
      : global.ClavisDirect.verify(provider, key).catch(function () { return { ok: true, warn: 'could not reach provider' }; });

    return verify.then(function (res) {
      if (!res.ok) throw new Error(res.error || 'The provider rejected this key.');
      unlocked[provider] = unlocked[provider] || [];
      if (unlocked[provider].indexOf(key) === -1) unlocked[provider].unshift(key);
      var m = metaFor(provider);
      m.health.unshift('ok');
      return persist(provider).then(function () {
        return pushToBackend(provider, key);
      }).then(function (sync) {
        try { localStorage.setItem('clavis_ai_provider', provider); } catch (_) {}
        emit();
        return { ok: true, provider: provider, mask: mask(key), synced: sync.synced, warn: res.warn };
      });
    });
  }

  /** Forget one key (by index) or every key for a provider. */
  function remove(provider, index) {
    provider = String(provider || '').toLowerCase();
    if (!unlocked[provider]) return Promise.resolve(false);
    if (typeof index === 'number') {
      unlocked[provider].splice(index, 1);
      metaFor(provider).health.splice(index, 1);
      if (!unlocked[provider].length) delete unlocked[provider];
    } else {
      delete unlocked[provider];
    }
    return persist(provider).then(function () { emit(); return true; });
  }

  /**
   * report() — the AI layer tells the vault what a provider just did.
   * 'exhausted' spends the key and rotates; 'rejected' retires it.
   */
  function report(provider, kind, err) {
    provider = String(provider || '').toLowerCase();
    var keys = ordered(provider);
    if (!keys.length) return;
    var live = keys[0];
    var idx = (unlocked[provider] || []).indexOf(live);
    if (idx < 0) return;

    if (kind === 'exhausted') markHealth(provider, idx, 'spent');
    else if (kind === 'rejected') markHealth(provider, idx, 'rejected');
    else return;

    var snap = status();
    var p = snap.providers[provider];
    // Only shout when this provider has nothing left AND nothing else does.
    if (p && p.state === 'spent') {
      var anyLive = snap.connected.some(function (o) { return snap.providers[o].state === 'live'; });
      try {
        global.dispatchEvent(new CustomEvent('clavis:refuel-needed', {
          detail: { provider: provider, label: p.label, console: p.console, anyLive: anyLive, message: (err && err.message) || '' }
        }));
      } catch (_) {}
    }
    emit();
  }

  function onChange(fn) {
    if (typeof fn === 'function') { listeners.push(fn); try { fn(status()); } catch (_) {} }
    return function () { listeners = listeners.filter(function (f) { return f !== fn; }); };
  }

  /* ── Boot ─────────────────────────────────────────────────── */
  function boot() {
    if (ready) return ready;
    if (!global.crypto || !global.crypto.subtle || !global.indexedDB) {
      console.warn('[Vault] WebCrypto/IndexedDB unavailable — falling back to legacy storage.');
      ready = Promise.resolve(false);
      return ready;
    }
    ready = restore()
      .then(migrateLegacy)
      .then(thawStale)
      .then(function () { emit(); return true; })
      .catch(function (e) { console.warn('[Vault] unlock failed', e); return false; });
    return ready;
  }

  global.ClavisKeyVault = {
    boot: boot,
    ready: function () { return boot(); },
    use: use,
    all: all,
    add: add,
    remove: remove,
    status: status,
    report: report,
    onChange: onChange,
    info: PROVIDER_INFO,
    chain: CHAIN,
    /* Handy in the console: ClavisKeyVault.audit() */
    audit: function () {
      var s = status();
      console.table(Object.keys(s.providers).map(function (p) {
        var v = s.providers[p];
        return { provider: p, state: v.state, keys: v.count, healthy: v.healthy, masks: v.masks.join(', ') };
      }));
      return s.anyKey ? 'Vault unlocked.' : 'No keys yet — open Key Vault to add one.';
    }
  };

  boot();
})(window);
