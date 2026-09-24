/**
 * ============================================================
 *  CLAVIS DIRECT (clavis-direct.js)
 *  Browser-side "bring your own key" brain. Calls the AI provider
 *  DIRECTLY from the page using a key the user pasted — no login,
 *  no backend, no vault. This is what makes "my own key works"
 *  actually true again.
 *
 *  - OpenAI-compatible providers: OpenRouter, Groq, OpenAI, DeepSeek
 *  - Gemini (its own schema) special-cased
 *  - OpenRouter multi-key + multi-model rotation on 429/402/5xx
 *  - Vision (screen understanding): images passed to a vision model
 *
 *  Returns an OpenAI-style { choices:[{message:{content}}], usage, model }
 *  so jarvis.js can consume it exactly like the old backend reply.
 * ============================================================
 */
'use strict';

(() => {
  const KEYS_STORE = 'clavis_provider_keys';        // { provider: key }
  const OR_ARRAY_STORE = 'jarvis_openrouter_keys';  // legacy array (kept working)
  const DEFAULT_PROVIDER_STORE = 'clavis_ai_provider';

  // Provider order used when the user hasn't picked a default. OpenRouter first:
  // best free tier + free vision models.
  const PREFERENCE = ['groq', 'openrouter', 'gemini', 'openai', 'deepseek', 'mistral', 'together', 'fireworks', 'xai', 'cerebras', 'perplexity'];

  const PROVIDERS = {
    openrouter: {
      url: 'https://openrouter.ai/api/v1/chat/completions',
      modelsUrl: 'https://openrouter.ai/api/v1/models',
      schema: 'openai',
      test: (k) => /^sk-or-\S{10,}$/.test(k),
      textModel: 'meta-llama/llama-3.3-70b-instruct:free',
      visionModel: 'meta-llama/llama-3.2-90b-vision-instruct:free',
      vision: true,
      // OpenRouter wants a real http(s) referer; file:// origin is "null" and gets rejected.
      extraHeaders: () => ({ 'HTTP-Referer': /^https?:/.test(location.origin) ? location.origin : 'https://clavis.app', 'X-Title': 'Clavis AI Assistant' }),
    },
    groq: {
      url: 'https://api.groq.com/openai/v1/chat/completions',
      schema: 'openai',
      test: (k) => /^gsk_\S{10,}$/.test(k),
      textModel: 'openai/gpt-oss-120b',
      // Groq deprecates/renames models fairly often. If the primary text model
      // 404s ("does not exist or you do not have access to it"), fall through
      // this list instead of dead-ending the whole reply.
      // NOTE: qwen/qwen3-32b was retired from Groq — leaving it here surfaced
      // "The model `qwen/qwen3-32b` does not exist or you do not have access to
      // it." and dead-ended lead generation. Only currently-live Groq
      // production models are listed; discoverModels() self-heals any rename.
      // Each Groq model has its OWN per-minute token bucket (8K TPM on the
      // free tier), so these double as rate-limit overflow, not only renames.
      textModelFallbacks: ['openai/gpt-oss-20b', 'qwen/qwen3.8-27b'],
      // Groq renames/retires vision models often. These are candidates, not
      // guarantees — discoverModels() below asks the account what is actually
      // live and rewrites this list at runtime, so a rename never dead-ends.
      visionModel: 'meta-llama/llama-4-scout-17b-16e-instruct',
      visionModelFallbacks: [
        'meta-llama/llama-4-maverick-17b-128e-instruct',
        'llama-3.2-90b-vision-preview',
        'llama-3.2-11b-vision-preview',
      ],
      modelsUrl: 'https://api.groq.com/openai/v1/models',
      vision: false,   // Sept 2026: Groq serves no vision chat model; images go to AI Studio
    },
    openai: {
      url: 'https://api.openai.com/v1/chat/completions',
      modelsUrl: 'https://api.openai.com/v1/models',
      schema: 'openai',
      test: (k) => /^sk-\S{10,}$/.test(k),
      textModel: 'gpt-4o-mini',
      visionModel: 'gpt-4o-mini',
      vision: true,
    },
    deepseek: {
      url: 'https://api.deepseek.com/chat/completions',
      schema: 'openai',
      test: (k) => /^sk-\S{10,}$/.test(k),
      textModel: 'deepseek-chat',
      visionModel: null,
      vision: false,
    },
    gemini: {
      url: 'https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent',
      modelsUrl: 'https://generativelanguage.googleapis.com/v1beta/models',
      schema: 'gemini',
      test: (k) => /^AIza\S{10,}$/.test(k),
      textModel: 'gemini-3.8-flash',
      textModelFallbacks: ['gemini-3.5-flash', 'gemini-3.5-flash-lite', 'gemini-2.5-flash'],
      visionModel: 'gemini-3.8-flash',
      visionModelFallbacks: ['gemini-3.5-flash', 'gemini-2.5-flash'],
      vision: true,
    },
    mistral:  { url: 'https://api.mistral.ai/v1/chat/completions', schema: 'openai', test: (k) => /^\S{20,}$/.test(k), textModel: 'mistral-small-latest', vision: false },
    together: { url: 'https://api.together.xyz/v1/chat/completions', schema: 'openai', test: (k) => /^\S{20,}$/.test(k), textModel: 'meta-llama/Llama-3.3-70B-Instruct-Turbo-Free', vision: false },
    xai:      { url: 'https://api.x.ai/v1/chat/completions', schema: 'openai', test: (k) => /^xai-\S{10,}$/.test(k), textModel: 'grok-2-latest', visionModel: 'grok-2-vision-latest', vision: true },
    perplexity:{ url: 'https://api.perplexity.ai/chat/completions', schema: 'openai', test: (k) => /^pplx-\S{10,}$/.test(k), textModel: 'sonar', vision: false },
    fireworks:{ url: 'https://api.fireworks.ai/inference/v1/chat/completions', schema: 'openai', test: (k) => /^\S{16,}$/.test(k), textModel: 'accounts/fireworks/models/llama-v3p3-70b-instruct', vision: false },
    cerebras: { url: 'https://api.cerebras.ai/v1/chat/completions', schema: 'openai', test: (k) => /^csk-\S{10,}$/.test(k), textModel: 'llama-3.3-70b', vision: false },
  };

  // ── Key storage ───────────────────────────────────────────
  function readMap() {
    try { const m = JSON.parse(localStorage.getItem(KEYS_STORE) || '{}'); return (m && typeof m === 'object') ? m : {}; }
    catch { return {}; }
  }
  function writeMap(m) { try { localStorage.setItem(KEYS_STORE, JSON.stringify(m)); } catch (_) {} }

  function legacyOrKeys() {
    try { const a = JSON.parse(localStorage.getItem(OR_ARRAY_STORE) || '[]'); return Array.isArray(a) ? a.filter(k => k && k.trim()) : []; }
    catch { return []; }
  }

  // All OpenRouter keys (map + legacy array + config), de-duplicated.
  function openRouterKeys() {
    const map = readMap();
    const cfg = (window.SKYLARK_CONFIG?.OPENROUTER_API_KEYS || []).filter(k => k && k.trim());
    let vaulted = [];
    try { vaulted = (window.ClavisKeyVault && window.ClavisKeyVault.all('openrouter')) || []; } catch (_) {}
    return [...new Set([...vaulted, map.openrouter, ...legacyOrKeys(), ...cfg].filter(k => k && String(k).trim()))];
  }

  function keyFor(provider) {
    // Settings restoration may call getApiKey() without a provider. Use the
    // lead-generation default instead of letting undefined.toUpperCase()
    // abort the whole application bootstrap.
    provider = String(provider || 'groq').toLowerCase();
    if (!PROVIDERS[provider]) return '';

    // The vault is the real home for keys: encrypted at rest, never sitting
    // in localStorage as readable text. Everything below it is legacy
    // storage kept working so nobody has to re-paste after upgrading.
    try {
      const vaulted = window.ClavisKeyVault && window.ClavisKeyVault.use(provider);
      if (vaulted) return vaulted;
    } catch (_) {}

    if (provider === 'openrouter') return openRouterKeys()[0] || '';
    const mapKey = (readMap()[provider] || '').trim();
    if (mapKey) return mapKey;

    // Direct localstorage and config fallbacks for all providers
    const p1 = (localStorage.getItem(`skylark_${provider}_key`) || '').trim();
    if (p1) return p1;
    const p2 = (localStorage.getItem(`skylark_custom_${provider}`) || '').trim();
    if (p2) return p2;

    if (provider === 'groq') {
      const g2 = (localStorage.getItem('skylark-llm-key') || '').trim();
      const engine = localStorage.getItem('skylark-llm-engine');
      if (g2 && (engine === 'groq' || engine === 'groq_llama' || g2.startsWith('gsk_'))) return g2;
      const cfg = (window.SKYLARK_CONFIG?.GROQ_API_KEYS || []).filter(k => k && k.trim());
      if (cfg[0]) return cfg[0].trim();
    }
    const envKey = (window.SKYLARK_CONFIG?.[`${provider.toUpperCase()}_API_KEYS`] || []).filter(k => k && k.trim());
    if (envKey[0]) return envKey[0].trim();

    return '';
  }

  function setKey(provider, key) {
    provider = String(provider || '').toLowerCase();
    key = String(key || '').trim();
    if (!PROVIDERS[provider]) throw new Error(`Unknown provider: ${provider}`);
    const map = readMap();
    if (key) map[provider] = key; else delete map[provider];
    writeMap(map);
    if (provider === 'openrouter' && key) {
      // keep the legacy array (used by rotation) in sync
      const arr = legacyOrKeys();
      if (!arr.includes(key)) arr.unshift(key);
      try { localStorage.setItem(OR_ARRAY_STORE, JSON.stringify(arr.slice(0, 5))); } catch (_) {}
    }
    if (key) localStorage.setItem(DEFAULT_PROVIDER_STORE, provider);
  }

  function removeKey(provider) {
    const map = readMap(); delete map[provider]; writeMap(map);
    if (provider === 'openrouter') { try { localStorage.removeItem(OR_ARRAY_STORE); } catch (_) {} }
  }

  function configuredProviders() {
    return PREFERENCE.filter(p => keyFor(p));
  }

  function hasKey() { return configuredProviders().length > 0; }

  function defaultProvider() {
    const saved = localStorage.getItem(DEFAULT_PROVIDER_STORE);
    if (saved && keyFor(saved)) return saved;
    return configuredProviders()[0] || '';
  }

  function supportsVision() {
    return configuredProviders().some(p => PROVIDERS[p]?.vision);
  }
  function visionProvider() {
    // Prefer a configured provider that can see images.
    return configuredProviders().find(p => PROVIDERS[p]?.vision) || '';
  }

  function freeModels() {
    try { const a = JSON.parse(localStorage.getItem('jarvis_free_models') || '[]'); if (Array.isArray(a) && a.length) return a; } catch (_) {}
    return window.SKYLARK_CONFIG?.CLAVIS_FREE_MODELS || [PROVIDERS.openrouter.textModel];
  }

  // ── Message shaping ───────────────────────────────────────
  // Attach images to the last user message for OpenAI-schema vision.
  function withImagesOpenAI(messages, images) {
    if (!images || !images.length) return messages;
    const out = messages.map(m => ({ ...m }));
    let lastUser = -1;
    for (let i = out.length - 1; i >= 0; i--) if (out[i].role === 'user') { lastUser = i; break; }
    if (lastUser === -1) { out.push({ role: 'user', content: '' }); lastUser = out.length - 1; }
    const textPart = { type: 'text', text: typeof out[lastUser].content === 'string' ? out[lastUser].content : '' };
    out[lastUser].content = [textPart, ...images.map(url => ({ type: 'image_url', image_url: { url } }))];
    return out;
  }

  function toGemini(messages, images) {
    const sys = messages.filter(m => m.role === 'system').map(m => m.content).join('\n\n');
    const contents = [];
    for (const m of messages) {
      if (m.role === 'system') continue;
      contents.push({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: String(m.content || '') }] });
    }
    if (images && images.length) {
      let lastUser = null;
      for (let i = contents.length - 1; i >= 0; i--) if (contents[i].role === 'user') { lastUser = contents[i]; break; }
      if (!lastUser) { lastUser = { role: 'user', parts: [{ text: '' }] }; contents.push(lastUser); }
      for (const url of images) {
        const m = /^data:(.*?);base64,(.*)$/.exec(url);
        if (m) lastUser.parts.push({ inline_data: { mime_type: m[1], data: m[2] } });
      }
    }
    const body = { contents };
    if (sys) body.systemInstruction = { parts: [{ text: sys }] };
    return body;
  }

  // Groq's reasoning models think before answering; for a live assistant
  // "low" effort is the difference between ~1 s and several seconds.
  function reasoningParams(provider, model) {
    if (provider !== 'groq') return {};
    if (/gpt-oss/.test(model)) return { reasoning_effort: 'low', include_reasoning: false };
    if (/qwen3/.test(model)) return { reasoning_effort: 'none', reasoning_format: 'hidden' };
    return {};
  }

  // Per-model cooldown after a per-minute limit ("try again in 12.9s").
  const cooling = new Map();   // "provider:model" -> until (ms)
  function retryAfterMs(err) {
    const m = /try again in\s*(?:(\d+)m)?\s*([\d.]+)\s*(ms|s)\b/i.exec(String(err?.message || ''));
    if (!m) return 8000;
    const ms = (Number(m[1] || 0) * 60 + Number(m[2])) * (m[3].toLowerCase() === 'ms' ? 1 : 1000);
    return Math.min(90000, Math.max(500, ms));
  }
  const coolKey = (provider, model) => provider + ':' + model;
  const isCooling = (provider, model) => (cooling.get(coolKey(provider, model)) || 0) > Date.now();
  function soonestCooldown(provider, models) {
    const until = models.map((m) => cooling.get(coolKey(provider, m)) || 0).filter((t) => t > Date.now());
    return until.length ? Math.min(...until) - Date.now() : 0;
  }

  // ── Core call ─────────────────────────────────────────────
  async function callOpenAISchema(provider, key, { messages, model, temperature, max_tokens, images }, signal) {
    const p = PROVIDERS[provider];
    const outputBudget = provider === 'groq'
      ? Math.min(Number(max_tokens) || 1200, 1200)
      : (Number(max_tokens) || 1600);
    const res = await fetch(p.url, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${key}`, 'Content-Type': 'application/json', ...(p.extraHeaders ? p.extraHeaders() : {}) },
      body: JSON.stringify({
        model,
        messages: withImagesOpenAI(messages, images),
        temperature: temperature ?? 0.7,
        max_tokens: outputBudget,
        ...reasoningParams(provider, model),
      }),
      signal,
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      const e = new Error(err?.error?.message || err?.message || `${provider} error ${res.status}`);
      e.status = res.status;
      throw e;
    }
    return res.json();
  }

  async function callGemini(key, { messages, model, temperature, max_tokens, images }, signal) {
    const url = PROVIDERS.gemini.url.replace('{model}', model) + `?key=${encodeURIComponent(key)}`;
    const body = toGemini(messages, images);
    body.generationConfig = { temperature: temperature ?? 0.7, maxOutputTokens: max_tokens ?? 1600 };
    const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      const e = new Error(err?.error?.message || `Gemini error ${res.status}`);
      e.status = res.status;
      throw e;
    }
    const data = await res.json();
    const text = (data.candidates?.[0]?.content?.parts || []).map(pt => pt.text || '').join('').trim();
    return { choices: [{ message: { content: text } }], usage: data.usageMetadata, model };
  }

  /* ── Live model discovery ──────────────────────────────────
     Providers retire and rename models without warning (this is exactly
     how "The model `meta-llama/llama-4-maverick-...` does not exist"
     happens). Rather than hard-coding a name and hoping, we ask the
     account which models it can actually see, score them, and cache the
     winner for the session. A rename becomes a non-event. */
  const MODEL_CACHE = 'clavis_live_models';

  function cacheRead() {
    try { return JSON.parse(sessionStorage.getItem(MODEL_CACHE) || '{}') || {}; }
    catch { return {}; }
  }
  function cacheWrite(provider, kind, model) {
    try {
      const c = cacheRead();
      c[provider + ':' + kind] = { model, at: Date.now() };
      sessionStorage.setItem(MODEL_CACHE, JSON.stringify(c));
    } catch (_) {}
  }
  function cacheGet(provider, kind) {
    const hit = cacheRead()[provider + ':' + kind];
    if (!hit) return '';
    // A cached pick is good for an hour; providers change, but not that fast.
    if (Date.now() - (hit.at || 0) > 3600e3) return '';
    return hit.model || '';
  }

  // Heuristics that survive renames: prefer bigger/newer/vision-capable ids.
  function scoreModel(id, wantsVision) {
    const t = String(id).toLowerCase();
    if (/whisper|tts|embed|guard|moderation|safety|rerank|image|dall|imagen|veo|音/.test(t)) return -1;
    let score = 0;
    const visionish = /vision|scout|maverick|vl|omni|multimodal|gpt-4o|gemini|pixtral|llava/.test(t);
    if (wantsVision) {
      if (!visionish) return -1;
      score += 40;
    }
    if (/gemini-2\.5|gpt-5|llama-4|qwen3|gpt-oss/.test(t)) score += 22;
    if (/gemini-2\.0|llama-3\.3|gpt-4o/.test(t)) score += 15;
    if (/instruct|versatile|chat|flash|turbo/.test(t)) score += 8;
    if (/70b|120b|90b|large/.test(t)) score += 10;
    if (/preview|experimental|exp-|deprecated/.test(t)) score -= 6;
    if (/lite|mini|8b|small|nano/.test(t)) score -= 4;
    if (/:free/.test(t)) score += 6;
    return score;
  }

  async function discoverModels(provider, key, wantsVision) {
    const p = PROVIDERS[provider];
    if (!p || !p.modelsUrl) return '';
    try {
      const url = provider === 'gemini'
        ? `${p.modelsUrl}?key=${encodeURIComponent(key)}`
        : p.modelsUrl;
      const headers = provider === 'gemini'
        ? {}
        : { 'Authorization': `Bearer ${key}`, ...(p.extraHeaders ? p.extraHeaders() : {}) };
      const res = await fetch(url, { headers });
      if (!res.ok) return '';
      const data = await res.json();
      const raw = data.data || data.models || [];
      const ids = raw.map(m => {
        const id = m.id || m.name || '';
        // Gemini returns "models/gemini-2.5-flash"; the call wants the bare id.
        return String(id).replace(/^models\//, '');
      }).filter(Boolean);
      if (!ids.length) return '';
      let best = '', bestScore = 0;
      for (const id of ids) {
        const sc = scoreModel(id, wantsVision);
        if (sc > bestScore) { bestScore = sc; best = id; }
      }
      if (best) cacheWrite(provider, wantsVision ? 'vision' : 'text', best);
      return best;
    } catch (_) { return ''; }
  }

  /* ── Failure classification ───────────────────────────────
     Three different things get treated very differently:
       · model gone      → try the next model, then ask the provider
                           what is live, then move on
       · key exhausted   → this KEY is done; tell the vault so it can
                           surface a refuel card, and move to the next
                           provider immediately
       · key rejected    → same, but nothing will fix it except a new key */
  function classify(err) {
    const status = err && err.status;
    const msg = String((err && err.message) || '').toLowerCase();
    if (status === 404 || (status === 400 && /model|not found|does not exist|decommission|deprecat/.test(msg))) return 'model';
    // "tokens per minute" / "try again in 12s" / request too big for this
    // model's TPM: this MODEL is busy for a few seconds, the key is fine.
    if ((status === 429 || status === 413) && /per minute|\(tpm\)|\(rpm\)|try again in|request too large|tokens per/.test(msg) && !/per day|\(tpd\)|\(rpd\)/.test(msg)) return 'ratelimit';
    if (status === 429 || /quota|rate limit|exceeded|insufficient|out of credit|billing/.test(msg)) return 'exhausted';
    if (status === 401 || status === 403) return 'rejected';
    if (status === 402) return 'exhausted';
    if (status >= 500) return 'transient';
    return 'other';
  }

  function announce(kind, provider, err) {
    try {
      window.dispatchEvent(new CustomEvent('clavis:key-' + kind, {
        detail: { provider, message: (err && err.message) || '', status: err && err.status }
      }));
      if (window.ClavisKeyVault && typeof window.ClavisKeyVault.report === 'function') {
        window.ClavisKeyVault.report(provider, kind, err);
      }
    } catch (_) {}
  }

  /* Build the ordered model list for one provider: an explicit override
     wins outright; otherwise a session-discovered live model leads, then
     the built-in default, then its fallbacks. Duplicates removed. */
  function modelsFor(provider, wantsVision, override) {
    const p = PROVIDERS[provider];
    if (override && override.startsWith(provider + '/')) {
      // e.g. "groq/openai/gpt-oss-20b": that model first, the rest as overflow.
      // (Before, any "provider/…" override was silently ignored, so every
      // small helper call landed on the big model and ate its TPM.)
      const own = override.slice(provider.length + 1);
      const rest = [wantsVision ? (p.visionModel || p.textModel) : p.textModel, ...((wantsVision ? p.visionModelFallbacks : p.textModelFallbacks) || [])];
      return [...new Set([own, ...rest].filter(Boolean))];
    }
    if (override && !(override.includes('/') && provider !== 'openrouter')) return [override];
    // Keep Groq's known-good product default ahead of a cached high-token
    // model. Discovery still happens after these candidates fail.
    const discovered = provider === 'groq' ? '' : cacheGet(provider, wantsVision ? 'vision' : 'text');
    const base = wantsVision ? (p.visionModel || p.textModel) : p.textModel;
    const extra = (wantsVision ? p.visionModelFallbacks : p.textModelFallbacks) || [];
    return [...new Set([discovered, base, ...extra].filter(Boolean))];
  }

  async function callOnce(provider, key, payload, model, signal) {
    return provider === 'gemini'
      ? callGemini(key, { ...payload, model }, signal)
      : callOpenAISchema(provider, key, { ...payload, model }, signal);
  }

  /* One provider, every key it has, every model worth trying.
     Returns a result, or throws with .fatalForProvider set when the
     caller should stop wasting time here and move to the next provider. */
  async function tryProvider(provider, payload, wantsVision, signal) {
    const p = PROVIDERS[provider];
    const keys = provider === 'openrouter' ? openRouterKeys() : [keyFor(provider)].filter(Boolean);
    if (!keys.length) throw Object.assign(new Error(`${provider}: no key`), { fatalForProvider: true });

    let models = wantsVision && !p.vision ? [] : modelsFor(provider, wantsVision, payload.model);
    if (!models.length) throw Object.assign(new Error(`${provider} cannot do this`), { fatalForProvider: true });

    let lastErr, discovered = false;
    for (const key of keys) {
      for (let i = 0; i < models.length; i++) {
        if (isCooling(provider, models[i])) { lastErr = lastErr || Object.assign(new Error(`${models[i]} is cooling down`), { status: 429, ratelimited: true }); continue; }
        try {
          const data = await callOnce(provider, key, payload, models[i], signal);
          trackUsage(data);
          // Remember what worked so the next call skips the dead names.
          cacheWrite(provider, wantsVision ? 'vision' : 'text', models[i]);
          return data;
        } catch (err) {
          if (err.name === 'AbortError') throw err;
          lastErr = err;
          const kind = classify(err);

          if (kind === 'model') {
            // Out of guesses? Ask the provider what it actually serves,
            // once, then try that. This is the self-healing path.
            if (i === models.length - 1 && !discovered) {
              discovered = true;
              const live = await discoverModels(provider, key, wantsVision);
              if (live && !models.includes(live)) { models = [...models, live]; }
            }
            continue;
          }
          if (kind === 'transient') continue;
          if (kind === 'ratelimit') {
            // Only this model's minute bucket is full: park it, try the next model.
            cooling.set(coolKey(provider, models[i]), Date.now() + retryAfterMs(err));
            err.ratelimited = true;
            continue;
          }
          if (kind === 'exhausted' || kind === 'rejected') {
            announce(kind, provider, err);
            break;  // this key is spent — next key, or next provider
          }
          throw err;  // a real error worth showing the user
        }
      }
    }
    throw Object.assign(lastErr || new Error(`${provider} unavailable`), { fatalForProvider: true });
  }

  /**
   * complete() — the single entry point jarvis.js calls.
   *
   * Walks every configured provider in preference order rather than
   * betting the whole reply on one. Groq runs dry or renames a model →
   * AI Studio (Gemini) picks it up → OpenRouter after that. The user
   * sees an answer, not an error card.
   */
  async function complete(payload, signal) {
    if (!hasKey()) {
      throw Object.assign(new Error('No AI key connected'), { code: 'AI_CREDENTIAL_MISSING' });
    }
    const wantsVision = !!(payload.images && payload.images.length);

    // Preference order, with the user's default first and (for images)
    // anything that cannot see filtered out entirely.
    let chain = configuredProviders();
    if (wantsVision) chain = chain.filter(pr => PROVIDERS[pr] && PROVIDERS[pr].vision);
    const preferred = wantsVision ? visionProvider() : defaultProvider();
    if (preferred) chain = [preferred, ...chain.filter(pr => pr !== preferred)];

    if (!chain.length) {
      throw Object.assign(
        new Error(wantsVision
          ? 'None of your connected keys can read images. Add a Groq or AI Studio key.'
          : 'No AI key connected'),
        { code: 'AI_CREDENTIAL_MISSING' });
    }

    let lastErr;
    for (let pass = 0; pass < 2; pass++) {
      for (const provider of chain) {
        try {
          return await tryProvider(provider, payload, wantsVision, signal);
        } catch (err) {
          if (err.name === 'AbortError') throw err;
          lastErr = err;
          if (!err.fatalForProvider) throw err;
        }
      }
      // Everything is merely in a per-minute cooldown: wait for the first
      // bucket to refill (only if that's soon) and go once more.
      if (pass || !lastErr?.ratelimited) break;
      const wait = Math.min(...chain.map((pr) => soonestCooldown(pr, modelsFor(pr, wantsVision, payload.model))).filter((w) => w > 0), 99999);
      if (!(wait < 16000)) break;
      window.dispatchEvent(new CustomEvent('clavis:ai-waiting', { detail: { ms: wait } }));
      await new Promise((resolve, reject) => {
        const t = setTimeout(resolve, wait + 250);
        signal?.addEventListener?.('abort', () => { clearTimeout(t); reject(Object.assign(new Error('Aborted'), { name: 'AbortError' })); }, { once: true });
      });
    }
    if (lastErr?.ratelimited) {
      lastErr.code = 'AI_BUSY';
      lastErr.message = 'Clavis is getting a lot of requests right now — the free AI limit refills every minute.';
      throw lastErr;
    }
    // Everything is spent: make that unmistakable so the UI can offer refuel.
    const out = lastErr || new Error('All AI providers are unavailable');
    if (classify(out) === 'exhausted' || /no key|unavailable/i.test(out.message || '')) {
      out.code = out.code || 'AI_ALL_PROVIDERS_EXHAUSTED';
      announce('exhausted', chain[chain.length - 1], out);
    }
    throw out;
  }

  function trackUsage(data) {
    try {
      const t = data?.usage?.total_tokens || data?.usage?.totalTokenCount;
      if (t && window.MemoryEngine?.addTokensUsed) window.MemoryEngine.addTokensUsed(t);
    } catch (_) {}
  }

  // Lightweight browser-side key verification (one tiny request).
  async function verify(provider, key) {
    provider = String(provider || '').toLowerCase();
    const p = PROVIDERS[provider];
    if (!p) return { ok: false, error: 'Unknown provider' };
    if (p.test && !p.test(key)) return { ok: false, error: 'Key format looks wrong for this provider.' };
    try {
      const ping = { messages: [{ role: 'user', content: 'ping' }], model: provider === 'openrouter' ? p.textModel : undefined, max_tokens: 5 };
      if (provider === 'gemini') { await callGemini(key, { ...ping, model: p.textModel }, undefined); return { ok: true }; }
      await callOpenAISchema(provider, key, { ...ping, model: p.textModel }, undefined);
      return { ok: true };
    } catch (err) {
      if (err.status === 401 || err.status === 403) return { ok: false, error: 'The provider rejected this key.' };
      // Network/CORS/rate-limit — accept the key but warn; it may still work.
      return { ok: true, warn: err.message };
    }
  }

  
  /**
   * transcribeWithGroq(audioBlob) — Superfast, ultra-accurate STT
   * using Groq Whisper-large-v3-turbo (< 300ms latency, bilingual Hindi/English).
   */
  async function transcribeWithGroq(audioBlob) {
    const key = keyFor('groq');
    if (!key) throw new Error('NO_GROQ_KEY');

    const formData = new FormData();
    const fileExt = audioBlob.type.includes('mp4') ? 'm4a' : (audioBlob.type.includes('ogg') ? 'ogg' : 'webm');
    formData.append('file', audioBlob, `speech.${fileExt}`);
    formData.append('model', 'whisper-large-v3-turbo');
    formData.append('temperature', '0');
    formData.append('response_format', 'json');
    formData.append('prompt', 'Hindi, English, Hinglish speech transcript for Clavis AI executive assistant.');

    const res = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${key}`
      },
      body: formData
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err?.error?.message || `Groq Whisper error ${res.status}`);
    }

    const data = await res.json();
    return (data.text || '').trim();
  }

  /**
   * transcribeWithOpenAI(audioBlob) — Whisper transcription via OpenAI API
   */
  async function transcribeWithOpenAI(audioBlob) {
    const key = keyFor('openai');
    if (!key) throw new Error('NO_OPENAI_KEY');

    const formData = new FormData();
    const fileExt = audioBlob.type.includes('mp4') ? 'm4a' : (audioBlob.type.includes('ogg') ? 'ogg' : 'webm');
    formData.append('file', audioBlob, `speech.${fileExt}`);
    formData.append('model', 'whisper-1');
    formData.append('prompt', 'Hindi, English, Hinglish speech transcript for Clavis AI executive assistant.');

    const res = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${key}` },
      body: formData
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err?.error?.message || `OpenAI Whisper error ${res.status}`);
    }
    const data = await res.json();
    return (data.text || '').trim();
  }

  /**
   * ttsWithOpenAI(text, voice) — Studio quality voice speech via OpenAI TTS
   */
  async function ttsWithOpenAI(text, voice) {
    const key = keyFor('openai');
    if (!key) throw new Error('NO_OPENAI_KEY');

    const res = await fetch('https://api.openai.com/v1/audio/speech', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${key}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'tts-1',
        input: String(text || '').slice(0, 4000),
        voice: voice || 'alloy'
      })
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err?.error?.message || `OpenAI TTS error ${res.status}`);
    }
    const blob = await res.blob();
    return URL.createObjectURL(blob);
  }

  window.ClavisDirect = {
    hasKey, setKey, removeKey, keyFor, configuredProviders,
    defaultProvider, supportsVision, visionProvider,
    complete, verify, PROVIDERS, transcribeWithGroq,
    transcribeWithOpenAI, ttsWithOpenAI,
    discoverModels, classifyError: classify
  };

  // Keys live in localStorage, which is scoped per ORIGIN. Opening index.html
  // directly gives a file:// origin with its own empty storage — which is why
  // keys "disappear" and have to be pasted again. It ALSO changes microphone
  // permission behavior (re-prompts more, some browsers restrict it further)
  // and can silently block AI/vision fetches on some setups. A corner toast
  // was too easy to miss and only mentioned the keys half of this — this is
  // a standing top banner naming everything it affects, until fixed.
  if (location.protocol === 'file:') {
    console.warn('[Clavis] Running from file:// — keys won\'t persist, microphone permission is less reliable, and some AI requests can be blocked. Use Start-Clavis.bat (http://localhost:3000).');
    window.addEventListener('DOMContentLoaded', () => {
      const bar = document.createElement('div');
      bar.id = 'clavis-file-protocol-banner';
      bar.setAttribute('role', 'alert');
      bar.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:99999;display:flex;align-items:center;justify-content:center;gap:10px;padding:9px 16px;background:#7c2d12;color:#fff;font:600 12.5px/1.4 -apple-system,Segoe UI,sans-serif;text-align:center;box-shadow:0 2px 10px rgba(0,0,0,.25);';
      bar.innerHTML = `<span>⚠️ Ye file:// se khula hai — keys save nahi rahengi, mic permission baar-baar maangega, aur kuch AI requests block ho sakti hain. Sahi tarika: <b>Start-Clavis.bat</b> chalayein, phir <b>http://localhost:3000</b> kholein.</span>
        <button type="button" style="background:rgba(255,255,255,.18);border:1px solid rgba(255,255,255,.35);color:#fff;border-radius:6px;padding:3px 10px;font:inherit;cursor:pointer;flex:none;">Samajh gaya</button>`;
      bar.querySelector('button').onclick = () => bar.remove();
      document.body.prepend(bar);
      document.body.style.paddingTop = `${bar.offsetHeight}px`;
    });
  }
})();
