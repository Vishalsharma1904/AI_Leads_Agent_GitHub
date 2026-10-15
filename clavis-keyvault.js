/* Account-scoped server vault. Provider secrets never come back to the browser. */
(function (global) {
  'use strict';
  if (global.ClavisKeyVault) return;
  var PROVIDER_INFO = {
    elevenlabs: {
      label: 'ElevenLabs',
      note: 'Primary voice, realtime listening and calling. Account credits apply.',
      console: 'https://elevenlabs.io/app/settings/api-keys',
      test: /^\S{16,1800}$/
    },
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
      /* AI Studio issues both shapes now: classic "AIza…" and current "AQ.…".
         Both authenticate the same way on generativelanguage.googleapis.com. */
      test: /^(?:AIza\S{30,}|AQ\.\S{20,})$/
    },
    fish_audio: {
      label: 'Fish Audio',
      note: 'Voice output + fallback speech transcription.',
      console: 'https://fish.audio/app/api-keys/'
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
    },
    /* Voice calling. Yeh LLM CHAIN ka hissa NAHI hai — Sarvam se sirf
       phone calls jaati hain, chat nahi. */
    sarvam: {
      label: 'Sarvam AI',
      note: 'Voice calling agent — asli phone calls.',
      console: 'https://dashboard.sarvam.ai/admin'
    },
    /* Rudra ki awaaz. Yeh bhi LLM CHAIN me NAHI hai — Cartesia sirf bolta
       hai, sochta nahi. Key server vault me rehti hai, browser kabhi nahi
       dekhta; synthesis backend /api/tts karta hai. */
    cartesia: {
      label: 'Cartesia',
      note: 'Rudra ki asli awaaz — emotions ke saath, Hindi aur English dono.',
      console: 'https://play.cartesia.ai/keys'
    }
  };


  // Gemini is out: AI Studio requires billing now, so it only ever errored.
  var CHAIN = ['groq', 'openrouter', 'openai', 'deepseek', 'xai'];
  var providers = {}, listeners = [], generation = 0, account = '', connectionError = '';
  function token() { return global.SupabaseAuth?.getAccessToken?.() || ''; }
  function identity() { return global.SupabaseAuth?.getUser?.()?.id || token(); }
  function base() { return (global.SKYLARK_CONFIG?.BACKEND_URL || 'http://localhost:8000').trim().replace(/\/+$/, ''); }
  async function request(path, options) {
    var auth = token();
    if (!auth) throw new Error('Sign in before managing provider keys.');
    var url;
    try { url = new URL(base()); } catch (_) { throw new Error('App server address is missing or invalid. Open connection settings and reconnect.'); }
    if (url.username || url.password || url.search || url.hash || url.pathname !== '/') throw new Error('Use the server address without an API path, credentials or query.');
    var local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
    if (url.protocol !== 'https:' && !(local && url.protocol === 'http:')) throw new Error('Provider setup requires HTTPS.');
    var controller = new AbortController();
    var timer = setTimeout(function () { controller.abort(); }, 45000);
    try {
      var response;
      try {
        response = await fetch(url.origin + '/api/credentials' + path, {
          ...options, cache: 'no-store', signal: controller.signal,
          headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + auth }
        });
      } catch (_) {
        throw new Error(controller.signal.aborted
          ? 'Server took too long to respond. Refresh connected providers before retrying; the key may already be saved.'
          : local ? 'Rudra24 backend is not reachable. Restart the app or start its backend, then retry. Your key was not verified.'
          : 'App server could not be reached. Check your connection and server setup, then retry. Your key was not verified.');
      }
      var data = await response.json().catch(function () { return null; });
      if (!response.ok) throw new Error(typeof data?.detail === 'string' ? data.detail : data?.detail?.message || 'Credential request failed (HTTP ' + response.status + '). Check the app server connection.');
      if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('App server returned an invalid API response. Check the backend address and API routing.');
      return data;
    } finally { clearTimeout(timer); }
  }
  function status() {
    var out = { providers: {}, connected: [], anyKey: false, allSpent: false, chain: CHAIN.slice(), connectionError: connectionError };
    Object.keys(PROVIDER_INFO).concat(Object.keys(providers)).forEach(function (p) {
      var info = PROVIDER_INFO[p] || { label: p };
      var connected = !!token() && !!providers[p];
      out.providers[p] = { ...info, count: connected ? 1 : 0, healthy: connected ? 1 : 0,
        masks: connected ? ['Server vault'] : [], health: connected ? ['ok'] : [], state: connected ? 'live' : 'empty' };
      if (connected && !out.connected.includes(p)) out.connected.push(p);
    });
    out.anyKey = out.connected.length > 0;
    return out;
  }
  function emit(changeType, provider) {
    var snap = status();
    listeners.forEach(function (fn) { try { fn(snap); } catch (_) {} });
    // Inventory reads happen before normal AI/voice turns. Consumers can
    // distinguish those from a successful secret replacement/removal without
    // receiving any secret or credential fingerprint.
    global.dispatchEvent(new CustomEvent('clavis:vault-changed', {
      detail: { ...snap, changeType: changeType || 'refresh', ...(provider ? { provider: provider } : {}) }
    }));
  }
  async function refresh() {
    var current = ++generation;
    if (account !== identity()) { providers = {}; account = identity(); connectionError = ''; }
    if (!token()) { emit(); return false; }
    try {
      var data = await request('');
      if (current !== generation || !token()) return false;
      if (!Array.isArray(data.credentials)) throw new Error('App server did not return provider connection status. Check API routing.');
      providers = {}; connectionError = '';
      data.credentials.forEach(function (r) { if (r.configured) providers[r.provider] = true; });
      emit(); return true;
    } catch (error) { if (current === generation) { connectionError = error.message; emit(); } return false; }
  }
  /* Three outcomes, not two. The server only refuses a key when the provider
     actually said the key is bad; if the check could not be completed the key
     is stored and reported unverified, so a provider being slow or moving an
     endpoint never looks like a wrong key. */
  async function add(provider, key) {
    provider = String(provider || '').toLowerCase();
    key = String(key || '').trim();
    if (!key) throw new Error('Paste a complete provider key.');
    var info = PROVIDER_INFO[provider] || {};
    if (info.test && !info.test.test(key)) {
      throw new Error((info.label || provider) + ' keys start with "' + (info.prefix || '') +
        '". Check you pasted the key and not an ID.');
    }
    var current = identity();
    var data = await request('', { method: 'PUT', body: JSON.stringify({ provider: provider, secret: key }) });
    if (current !== identity() || !token()) throw new Error('Account changed while saving. Refresh provider status in the current account.');
    ++generation; account = current; connectionError = ''; providers[provider] = true;
    emit('credential', provider);
    return {
      ok: true, synced: true, provider: provider, mask: 'Server vault',
      verified: !!(data && data.verified),
      note: (data && data.note) || '',
      console: (data && data.console) || info.console || ''
    };
  }
  async function verify(provider) {
    var data = await request('/verify/' + encodeURIComponent(String(provider || '').toLowerCase()), { method: 'POST' });
    return { verified: !!(data && data.verified), note: (data && data.note) || '' };
  }
  async function remove(provider) {
    var current = generation;
    await request('/' + encodeURIComponent(provider), { method: 'DELETE' });
    if (current === generation) delete providers[provider];
    emit('credential', String(provider || '').toLowerCase());
    await refresh(); return true;
  }
  // Old device keys are not unlocked or auto-assigned to a different account.
  async function purgeLegacy() {
    var names = ['clavis_provider_keys', 'jarvis_openrouter_keys', 'skylark-llm-key',
      'clavis_vault_meta', 'clavis_live_spent', 'clavis_gemini_quota_exhausted'];
    Object.keys(PROVIDER_INFO).concat(['apify', 'nvidia', 'moonshot', 'mistral', 'together', 'fireworks', 'cerebras', 'perplexity']).forEach(function (p) {
      names.push('skylark_' + p + '_key', 'skylark_custom_' + p);
    });
    names.forEach(function (n) { localStorage.removeItem(n); });
    if (global.indexedDB) await new Promise(function (resolve, reject) {
      var req = indexedDB.deleteDatabase('clavis-vault');
      req.onsuccess = resolve; req.onerror = function () { reject(req.error); };
      req.onblocked = function () { reject(new Error('Close other Rudra tabs, then retry removing legacy keys.')); };
    });
    return true;
  }
  global.ClavisKeyVault = {
    boot: refresh, ready: refresh, refresh: refresh, use: function () { return ''; }, all: function () { return []; },
    add: add, verify: verify, remove: remove, status: status, report: function () {}, info: PROVIDER_INFO, chain: CHAIN,
    purgeLegacy: purgeLegacy,
    onChange: function (fn) { listeners.push(fn); fn(status()); return function () { listeners = listeners.filter(function (f) { return f !== fn; }); }; },
    audit: status
  };
  global.addEventListener('rudra:auth-state', refresh);
})(window);
