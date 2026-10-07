/**
 * ============================================================
 *  RUDRA24 AI DIRECT (clavis-direct.js)
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

  // Text uses Groq first; image requests still select a vision-capable provider.
  // 'gemini' deliberately absent — see geminiAllowed() below. Groq leads.
  const PREFERENCE = ['groq', 'openrouter', 'openai', 'deepseek', 'mistral', 'together', 'fireworks', 'xai', 'cerebras', 'perplexity'];

  const PROVIDERS = {
    // Voice-only provider. Deliberately absent from PREFERENCE so text/chat
    // routing never attempts Fish Audio's speech endpoints as an LLM.
    fish_audio: { test: (k) => /^\S{12,}$/.test(k), voiceOnly: true },
    openrouter: {
      url: 'https://openrouter.ai/api/v1/chat/completions',
      modelsUrl: 'https://openrouter.ai/api/v1/models',
      schema: 'openai',
      test: (k) => /^sk-or-\S{10,}$/.test(k),
      textModel: 'meta-llama/llama-3.3-70b-instruct:free',
      visionModel: 'meta-llama/llama-3.2-90b-vision-instruct:free',
      vision: true,
      // OpenRouter wants a real http(s) referer; file:// origin is "null" and gets rejected.
      extraHeaders: () => ({ 'HTTP-Referer': /^https?:/.test(location.origin) ? location.origin : 'https://clavis.app', 'X-Title': 'Rudra24 AI Assistant' }),
    },
    groq: {
      url: 'https://api.groq.com/openai/v1/chat/completions',
      schema: 'openai',
      test: (k) => /^gsk_\S{10,}$/.test(k),
      textModel: 'openai/gpt-oss-20b',
      // Groq deprecates/renames models fairly often. If the primary text model
      // 404s ("does not exist or you do not have access to it"), fall through
      // this list instead of dead-ending the whole reply.
      // NOTE: qwen/qwen3-32b was retired from Groq — leaving it here surfaced
      // "The model `qwen/qwen3-32b` does not exist or you do not have access to
      // it." and dead-ended lead generation. Only currently-live Groq
      // production models are listed; discoverModels() self-heals any rename.
      // Each Groq model has its OWN per-minute token bucket (8K TPM on the
      // free tier), so these double as rate-limit overflow, not only renames.
      // Probed against this account 2026-10-04: Groq serves the gpt-oss pair
      // and refuses everything else that used to be here (llama-3.3-70b,
      // llama-3.1-8b, llama-4-scout, qwen3-32b, kimi-k2). A refused name is
      // not harmless — it burned a request and fell through to a dead
      // provider, which is what "kabhi jawab milta hai, kabhi nahi" was.
      textModelFallbacks: ['openai/gpt-oss-120b'],
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
      test: (k) => /^(?:AIza|AQ\.)\S{10,}$/.test(k),
      textModel: 'gemini-3.5-flash-lite',
      textModelFallbacks: ['gemini-3.8-flash'],
      visionModel: 'gemini-3.8-flash',
      visionModelFallbacks: ['gemini-3.7-flash', 'gemini-3.5-flash'],
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
  // Vault me key async (encrypt + persist) jaati hai; tab tak is session ke
  // liye memory me rakho taaki setKey() ke turant baad keyFor() khaali na mile.
  // Ye kabhi localStorage me nahi jaata.
  const sessionKeys = {};
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
  function openRouterKeys() { return []; }
  function keyFor() { return ''; }
  function setKey(provider, key) {
    const vault = window.ClavisKeyVault;
    if (!vault) return Promise.reject(new Error('Server credential vault is unavailable.'));
    return key ? vault.add(provider, key) : vault.remove(provider);
  }
  function removeKey(provider) { return window.ClavisKeyVault?.remove(provider); }
  /* Google AI Studio is OFF.
   *
   * AI Studio made billing mandatory, so every Gemini call now fails: the
   * Live voice socket 403s, Gemini TTS errors on each sentence, and the
   * brain wasted a round trip before falling through. Rather than patch
   * eight call sites, it is switched off at the single place they all ask
   * — providerConfigured(). With this false, geminiKeys() in clavis-live
   * returns empty so Live never dials, clavis-voice skips Gemini TTS, and
   * jarvis_skills' groundedSearch goes straight to Groq's own web search.
   *
   * Groq is PREFERENCE[0], so defaultProvider() now lands on Groq.
   * Reversible: localStorage clavis_gemini_off = '0' to allow it again. */
  function geminiAllowed() {
    try { return localStorage.getItem('clavis_gemini_off') === '0'; } catch (_) { return false; }
  }
  function providerConfigured(provider) {
    if (provider === 'gemini' && !geminiAllowed()) return false;
    return !!window.SupabaseAuth?.getAccessToken?.() && !!window.ClavisKeyVault?.status().providers[provider]?.count;
  }

  function configuredProviders() {
    return PREFERENCE.filter(p => providerConfigured(p));
  }

  function hasKey() { return configuredProviders().length > 0; }

  function defaultProvider() {
    const saved = localStorage.getItem(DEFAULT_PROVIDER_STORE);
    if (saved && !PROVIDERS[saved]?.voiceOnly && providerConfigured(saved)) return saved;
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
  // "try again in 19m52.32s" / "1h2m3s" → ms, for a model's daily bucket.
  function dayRetryMs(err) {
    const m = /try again in\s*(?:(\d+)h)?\s*(?:(\d+)m)?\s*(?:([\d.]+)s)?/i.exec(String(err?.message || ''));
    const ms = m ? ((Number(m[1] || 0) * 60 + Number(m[2] || 0)) * 60 + Number(m[3] || 0)) * 1000 : 0;
    return Math.min(24 * 3600e3, Math.max(60e3, ms || 3600e3));
  }
  const coolKey = (provider, model) => provider + ':' + model;
  const dailySpent = new Set();   // cooling keys parked for a DAILY limit (not a minute one)
  const isCooling = (provider, model) => (cooling.get(coolKey(provider, model)) || 0) > Date.now();
  function soonestCooldown(provider, models) {
    const until = models.map((m) => cooling.get(coolKey(provider, m)) || 0).filter((t) => t > Date.now());
    return until.length ? Math.min(...until) - Date.now() : 0;
  }

  // ── Core call ─────────────────────────────────────────────
  async function readSse(response, onEvent) {
    if (!response.body?.getReader) return null;
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let eventType = '', dataLines = [], receivedContent = false;
    const dispatch = () => {
      if (!dataLines.length) { eventType = ''; return; }
      const raw = dataLines.join('\n');
      dataLines = [];
      const type = eventType;
      eventType = '';
      if (raw === '[DONE]') return;
      let event;
      try { event = JSON.parse(raw); }
      catch (err) {
        if (type === 'error') throw Object.assign(new Error(raw || 'Stream error'), { status: 502 });
        throw Object.assign(new Error('Invalid provider stream response'), { status: 502, cause: err });
      }
      if (type === 'error' || event?.error) {
        const detail = event.error || event;
        throw Object.assign(new Error(detail.message || 'Provider stream error'), { status: Number(detail.code) || 502 });
      }
      if (onEvent(event)) receivedContent = true;
    };
    try { while (true) {
      const { value, done } = await reader.read();
      buffer += decoder.decode(value || new Uint8Array(), { stream: !done });
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() || '';
      for (const line of lines) {
        if (!line.trim()) { dispatch(); continue; }
        if (line.startsWith('event:')) eventType = line.slice(6).trim();
        else if (line.startsWith('data:')) dataLines.push(line.slice(5).trimStart());
      }
      if (done) break;
    }
    if (buffer.startsWith('data:')) dataLines.push(buffer.slice(5).trimStart());
    dispatch();
    if (!receivedContent) throw Object.assign(new Error('Provider returned an empty stream'), { status: 502 });
    return true;
    } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
  }

  function emitToken(onToken, text) {
    if (!text || typeof onToken !== 'function') return;
    try { Promise.resolve(onToken(text)).catch(() => {}); } catch (_) {}
  }

  async function callOpenAISchema(provider, key, { messages, model, temperature, max_tokens, images, onToken }, signal) {
    const p = PROVIDERS[provider];
    const outputBudget = provider === 'groq'
      ? Math.min(Number(max_tokens) || 1200, 1200)
      : (Number(max_tokens) || 1600);
    const streaming = typeof onToken === 'function';
    const request = new AbortController();
    const abort = () => request.abort(signal.reason);
    if (signal?.aborted) abort();
    else signal?.addEventListener('abort', abort, { once: true });
    let timedOut = false, timeout;
    const armTimeout = () => {
      clearTimeout(timeout);
      timeout = setTimeout(() => { timedOut = true; request.abort(); }, 12000);
    };
    armTimeout();
    try {
    const res = await fetch(p.url, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${key}`, 'Content-Type': 'application/json', ...(p.extraHeaders ? p.extraHeaders() : {}) },
      body: JSON.stringify({
        model,
        messages: withImagesOpenAI(messages, images),
        temperature: temperature ?? 0.7,
        max_tokens: outputBudget,
        ...(streaming ? { stream: true } : {}),
        ...reasoningParams(provider, model),
      }),
      signal: request.signal,
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      const e = new Error(err?.error?.message || err?.message || `${provider} error ${res.status}`);
      e.status = res.status;
      throw e;
    }
    if (!streaming) return res.json();
    let text = '', usage = null, usedModel = model;
    const streamed = await readSse(res, (event) => {
      const delta = event.choices?.[0]?.delta?.content;
      if (typeof delta === 'string' && delta) { text += delta; emitToken(onToken, delta); armTimeout(); }
      if (event.usage) usage = event.usage;
      if (event.model) usedModel = event.model;
      return !!delta;
    });
    if (!streamed) return res.json();
    return { choices: [{ message: { content: text } }], usage, model: usedModel, streamed: true };
    } catch (err) {
      if (timedOut && !signal?.aborted) throw Object.assign(new Error(`${provider} response timed out`), { status: 503 });
      throw err;
    } finally { clearTimeout(timeout); signal?.removeEventListener('abort', abort); }
  }

  async function callGemini(key, { messages, model, temperature, max_tokens, images, onToken }, signal) {
    const streaming = typeof onToken === 'function';
    const base = PROVIDERS.gemini.url.replace('{model}', model);
    const url = streaming
      ? base.replace(':generateContent', ':streamGenerateContent') + `?alt=sse&key=${encodeURIComponent(key)}`
      : base + `?key=${encodeURIComponent(key)}`;
    const body = toGemini(messages, images);
    body.generationConfig = { temperature: temperature ?? 0.7, maxOutputTokens: max_tokens ?? 1600 };
    if (streaming && /^gemini-3\./.test(model)) body.generationConfig.thinkingConfig = { thinkingLevel: 'low' };
    const request = new AbortController();
    if (signal?.aborted) request.abort(signal.reason);
    const abort = () => request.abort(signal.reason);
    if (!signal?.aborted) signal?.addEventListener('abort', abort, { once: true });
    let timedOut = false, timeout;
    const armTimeout = (ms) => {
      clearTimeout(timeout);
      timeout = setTimeout(() => { timedOut = true; request.abort(); }, ms);
    };
    armTimeout(15000);
    try {
      const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: request.signal });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        const e = new Error(err?.error?.message || `Gemini error ${res.status}`);
        e.status = res.status;
        throw e;
      }
      if (!streaming) {
        const data = await res.json();
        const text = (data.candidates?.[0]?.content?.parts || []).map(pt => pt.text || '').join('').trim();
        return { choices: [{ message: { content: text } }], usage: data.usageMetadata, model };
      }
      let text = '', usage = null;
      const streamed = await readSse(res, (event) => {
        const delta = (event.candidates?.[0]?.content?.parts || []).map(pt => pt.text || '').join('');
        if (delta) { text += delta; emitToken(onToken, delta); armTimeout(12000); }
        if (event.usageMetadata) usage = event.usageMetadata;
        return !!delta;
      });
      if (!streamed) return res.json();
      return { choices: [{ message: { content: text } }], usage, model, streamed: true };
    } catch (err) {
      if (timedOut && !signal?.aborted) throw Object.assign(new Error('Gemini response timed out'), { status: 503 });
      throw err;
    } finally { clearTimeout(timeout); signal?.removeEventListener('abort', abort); }
  }

  /* ── Live model discovery ──────────────────────────────────
     Providers retire and rename models without warning (this is exactly
     how "The model `meta-llama/llama-4-maverick-...` does not exist"
     happens). Rather than hard-coding a name and hoping, we ask the
     account which models it can actually see, score them, and cache the
     winner for the session. A rename becomes a non-event. */
  const MODEL_CACHE = 'clavis_live_models';
  const requestStats = { completions: 0, providerCalls: 0, providerErrors: 0, modelSkips: 0, discoveryCalls: 0, discoveryCacheHits: 0, helperCacheHits: 0 };
  const requestTimings = [];

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
    if (/gemini-3\.[5-8]|gpt-5|llama-4|qwen3|gpt-oss/.test(t)) score += 22;
    if (/llama-3\.3|gpt-4o/.test(t)) score += 15;
    if (/instruct|versatile|chat|flash|turbo/.test(t)) score += 8;
    if (/70b|120b|90b|large/.test(t)) score += 10;
    if (/preview|experimental|exp-|deprecated/.test(t)) score -= 6;
    if (/lite|mini|8b|small|nano/.test(t)) score -= 4;
    if (/:free/.test(t)) score += 6;
    return score;
  }

  const discovery = new Map();
  function discoverModels(provider, key, wantsVision) {
    // Key stays in memory only. Different accounts never share discoveries.
    const id = JSON.stringify([provider, key, !!wantsVision]);
    const hit = discovery.get(id);
    if (hit && hit.until > Date.now()) { requestStats.discoveryCacheHits++; return hit.promise; }
    const entry = { until: Date.now() + 30000 };
    entry.promise = discoverModelsFresh(provider, key, wantsVision).then(model => {
      entry.until = Date.now() + (model ? 3600000 : 30000);
      return model;
    });
    discovery.set(id, entry);
    if (discovery.size > 24) discovery.delete(discovery.keys().next().value);
    return entry.promise;
  }

  async function discoverModelsFresh(provider, key, wantsVision) {
    const p = PROVIDERS[provider];
    if (!p || !p.modelsUrl) return '';
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 4000);
    try {
      const url = provider === 'gemini'
        ? `${p.modelsUrl}?key=${encodeURIComponent(key)}`
        : p.modelsUrl;
      const headers = provider === 'gemini'
        ? {}
        : { 'Authorization': `Bearer ${key}`, ...(p.extraHeaders ? p.extraHeaders() : {}) };
      requestStats.discoveryCalls++;
      const res = await fetch(url, { headers, signal: controller.signal });
      if (!res.ok) return '';
      const data = await res.json();
      const raw = data.data || data.models || [];
      const ids = raw.filter(m => provider !== 'gemini' || m.supportedGenerationMethods?.includes('generateContent')).map(m => {
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
    finally { clearTimeout(timeout); }
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
    // Google galat Gemini key par 401 nahi, HTTP 400 "API key not valid" deta hai.
    if (status === 400 && /api key not valid|api_key_invalid|invalid api key|api key expired/.test(msg)) return 'rejected';
    if (status === 404 || (status === 400 && /model|not found|does not exist|decommission|deprecat/.test(msg))) return 'model';
    // "tokens per minute" / "try again in 12s" / request too big for this
    // model's TPM: this MODEL is busy for a few seconds, the key is fine.
    if ((status === 429 || status === 413) && /per minute|\(tpm\)|\(rpm\)|try again in|request too large|tokens per/.test(msg) && !/per day|\(tpd\)|\(rpd\)/.test(msg)) return 'ratelimit';
    // Groq's DAILY limits are per model ("Rate limit reached for model `x` …
    // tokens per day"): the key's other models still have their own quota.
    if (status === 429 && /for model/.test(msg) && /per day|\(tpd\)|\(rpd\)/.test(msg)) return 'modelday';
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
    const overrideProvider = String(override || '').split('/')[0];
    if (override && !PROVIDERS[overrideProvider] && !(override.includes('/') && provider !== 'openrouter')) return [override];
    // Keep Groq's known-good product default ahead of a cached high-token
    // model. Discovery still happens after these candidates fail.
    const cached = provider === 'groq' ? '' : cacheGet(provider, wantsVision ? 'vision' : 'text');
    const discovered = provider === 'gemini' && !/^gemini-3\./.test(cached) ? '' : cached;
    const base = wantsVision ? (p.visionModel || p.textModel) : p.textModel;
    const extra = (wantsVision ? p.visionModelFallbacks : p.textModelFallbacks) || [];
    return [...new Set((provider === 'gemini' ? [base, discovered, ...extra] : [discovered, base, ...extra]).filter(Boolean))];
  }

  async function callOnce(provider, key, payload, model, signal) {
    if (signal?.aborted) throw Object.assign(new Error('Cancelled'), { name: 'AbortError' });
    requestStats.providerCalls++;
    let emitted = false;
    const timing = { provider, model, startedAt: Date.now(), firstTokenMs: null, totalMs: null };
    const onToken = typeof payload.onToken === 'function' ? text => {
      emitted = true;
      if (timing.firstTokenMs == null) timing.firstTokenMs = Date.now() - timing.startedAt;
      return payload.onToken(text);
    } : undefined;
    try {
      return await (provider === 'gemini'
        ? callGemini(key, { ...payload, model, onToken }, signal)
        : callOpenAISchema(provider, key, { ...payload, model, onToken }, signal));
    } catch (err) {
      requestStats.providerErrors++;
      // Starting another model after visible/spoken content repeats or contradicts it.
      if (emitted) err.partialResponse = true;
      throw err;
    } finally {
      timing.totalMs = Date.now() - timing.startedAt;
      requestTimings.push(timing);
      if (requestTimings.length > 20) requestTimings.shift();
    }
  }

  const unavailableModels = new Map();

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
        if (signal?.aborted) throw Object.assign(new Error('Cancelled'), { name: 'AbortError' });
        const modelKey = JSON.stringify([provider, key, models[i]]);
        if ((unavailableModels.get(modelKey) || 0) > Date.now()) { requestStats.modelSkips++; continue; }
        if (isCooling(provider, models[i])) {
          const daily = dailySpent.has(coolKey(provider, models[i]));
          lastErr = lastErr || Object.assign(new Error(`${models[i]} is cooling down`), { status: 429, ratelimited: !daily, dailySpent: daily });
          continue;
        }
        try {
          const data = await callOnce(provider, key, payload, models[i], signal);
          trackUsage(data);
          // Remember what worked so the next call skips the dead names.
          cacheWrite(provider, wantsVision ? 'vision' : 'text', models[i]);
          return data;
        } catch (err) {
          if (err.name === 'AbortError' || err.partialResponse) throw err;
          lastErr = err;
          const kind = classify(err);

          if (kind === 'model') {
            unavailableModels.set(modelKey, Date.now() + 300000);
            if (unavailableModels.size > 100) unavailableModels.delete(unavailableModels.keys().next().value);
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
          if (kind === 'modelday') {
            // This model's daily quota is used up: park it till it refills, next model.
            cooling.set(coolKey(provider, models[i]), Date.now() + dayRetryMs(err));
            dailySpent.add(coolKey(provider, models[i]));
            err.dailySpent = true;
            continue;
          }
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
  // Background callers (proactive nudge, screen vision, mind loop, boot, chips)
  // ko khud ko tag karna hota hai. Soye hue Rudra24 AI ke liye ye calls network tak
  // pahunchti hi nahi — isi se keys ghante bhar me khatam ho rahi thi.
  const BACKGROUND_PURPOSES = ['proactive', 'vision', 'mind', 'boot', 'chips', 'suggest'];
  function isBackground(payload) {
    return !!payload && (payload.background === true || BACKGROUND_PURPOSES.includes(String(payload.purpose || '')));
  }
  function asleepError() {
    return Object.assign(new Error('Rudra24 AI is asleep — background AI call skipped'), { code: 'asleep', background: true });
  }

  const helperCache = new Map();
  window.addEventListener('rudra:auth-state', () => helperCache.clear());
  function complete(payload = {}, signal) {
    if (!window.SupabaseAuth?.getAccessToken?.()) return Promise.reject(Object.assign(new Error('Sign in before using AI.'), { code: 'AI_AUTH_REQUIRED' }));
    if (signal?.aborted) return Promise.reject(Object.assign(new Error('Cancelled'), { name: 'AbortError' }));
    if (isBackground(payload) && /^(LISTENING|USER_SPEAKING|PROCESSING_AUDIO|TRANSCRIBING|PROCESSING|THINKING|EXECUTING_TOOL|EXECUTING|ASSISTANT_SPEAKING|SPEAKING)$/.test(window.ClavisVoiceState?.state?.())) {
      return Promise.reject(Object.assign(new Error('Conversation has priority — background AI skipped'), {code:'asleep',background:true}));
    }
    requestStats.completions++;
    // Cache only pure suggestion helpers, never conversation, tools, or images.
    const reusable = !signal && !payload.onToken && !payload.images?.length && ['chips', 'suggest'].includes(payload.purpose);
    if (!reusable) return completeFresh(payload, signal);
    if (window.ClavisWake?.allowBackground && !window.ClavisWake.allowBackground()) return Promise.reject(asleepError());
    const id = JSON.stringify([payload, configuredProviders().map(p => [p, keyFor(p)]), defaultProvider()]);
    const hit = helperCache.get(id);
    if (hit && hit.until > Date.now()) { requestStats.helperCacheHits++; return hit.promise.then(data => JSON.parse(JSON.stringify(data))); }
    const entry = { until: Infinity };
    entry.promise = completeFresh(payload, signal).then(data => { entry.until = Date.now() + 30000; return data; }, err => { helperCache.delete(id); throw err; });
    helperCache.set(id, entry);
    if (helperCache.size > 24) helperCache.delete(helperCache.keys().next().value);
    return entry.promise.then(data => JSON.parse(JSON.stringify(data)));
  }

  function serverOnlyAI() {
    return true;
  }

  async function completeFresh(payload, signal) {
    payload = payload || {};
    const background = isBackground(payload);
    if (background) {
      try {
        if (window.ClavisWake && typeof window.ClavisWake.allowBackground === 'function' && !window.ClavisWake.allowBackground()) {
          throw asleepError();
        }
      } catch (e) { if (e && e.code === 'asleep') throw e; }
      // Provider ko ye extra fields nahi bhejne (callers ...payload spread karte hain).
      const { background: _bg, purpose: _pp, ...rest } = payload;
      payload = rest;
    }
    // CUSTOMER BUILD = SERVER-ONLY AI.
    // Browser se seedha provider call karne ka matlab hai key browser me —
    // F12, Network tab, key gayi; aur backend ki daily limit bhi bypass.
    // Hosted backend (https) hi customer build ki pehchaan hai, isliye koi
    // nayi config nahi: dev localhost par jaisa tha waisa hi chalta rahega.
    // Guard yahan hai kyunki har LLM caller (20 files) isi se guzarta hai.
    if (serverOnlyAI()) {
      if (!window.NexusAIChat?.complete) throw new Error('Authenticated AI service is unavailable.');
      const { onToken, ...rest } = payload;
      const model = rest.model || (rest.images?.length ? 'gemini/gemini-3.8-flash' : 'groq/openai/gpt-oss-20b');
      return window.NexusAIChat.complete({ ...rest, model }, signal, onToken);
    }
    if (!hasKey()) {
      throw Object.assign(new Error('No AI key connected'), { code: 'AI_CREDENTIAL_MISSING' });
    }
    const wantsVision = !!(payload.images && payload.images.length);

    // Preference order, with the user's default first and (for images)
    // anything that cannot see filtered out entirely.
    let chain = configuredProviders();
    if (wantsVision) chain = chain.filter(pr => PROVIDERS[pr] && PROVIDERS[pr].vision);
    const explicitProvider = String(payload.model || '').split('/')[0];
    const preferred = wantsVision ? visionProvider()
      : chain.includes(explicitProvider) ? explicitProvider : defaultProvider();
    if (preferred) chain = [preferred, ...chain.filter(pr => pr !== preferred)];
    // Background call: sirf pehla healthy provider — ek nudge ke liye saare
    // providers ki keys jalana band. Fail hua to chup-chaap chhod do.
    if (background && chain.length > 1) {
      const healthy = chain.find(pr => {
        try {
          const st = window.ClavisKeyVault?.status?.()?.providers?.[pr]?.state;
          return st !== 'spent' && st !== 'rejected';
        } catch (_) { return true; }
      });
      chain = [healthy || chain[0]];
    }

    if (!chain.length) {
      throw Object.assign(
        new Error(wantsVision
          // Groq serves no vision model at all (see its entry above), so the
          // old text sent people to a key that could never have worked.
          ? 'None of your connected keys can read images. Add an OpenRouter key — it has a free vision model.'
          : 'No AI key connected'),
        { code: 'AI_CREDENTIAL_MISSING' });
    }

    let lastErr;
    for (let pass = 0; pass < (background ? 1 : 2); pass++) {
      for (const provider of chain) {
        try {
          return await tryProvider(provider, payload, wantsVision, signal);
        } catch (err) {
          if (err.name === 'AbortError' || err.partialResponse) throw err;
          lastErr = err;
          if (!err.fatalForProvider) throw err;
        }
      }
      // Everything is merely in a per-minute cooldown: wait for the first
      // bucket to refill (only if that's soon) and go once more.
      if (pass || !lastErr?.ratelimited) break;
      const wait = Math.min(...chain.map((pr) => soonestCooldown(pr, modelsFor(pr, wantsVision, payload.model))).filter((w) => w > 0), 99999);
      // A foreground voice turn must not sit silently for up to 16 seconds.
      // Rotate immediately; only a very short bucket refill is worth waiting for.
      if (!(wait < 2500)) break;
      window.dispatchEvent(new CustomEvent('clavis:ai-waiting', { detail: { ms: wait } }));
      await new Promise((resolve, reject) => {
        const t = setTimeout(resolve, wait + 250);
        signal?.addEventListener?.('abort', () => { clearTimeout(t); reject(Object.assign(new Error('Aborted'), { name: 'AbortError' })); }, { once: true });
      });
    }
    if (lastErr?.ratelimited && !lastErr?.dailySpent) {
      lastErr.code = 'AI_BUSY';
      lastErr.message = 'Rudra24 AI is getting a lot of requests right now — the free AI limit refills every minute.';
      throw lastErr;
    }
    // Everything is spent: make that unmistakable so the UI can offer refuel.
    const out = lastErr || new Error('All AI providers are unavailable');
    if (out.dailySpent || ['exhausted', 'modelday'].includes(classify(out)) || /no key|unavailable|cooling down/i.test(out.message || '')) {
      out.code = out.code || 'AI_ALL_PROVIDERS_EXHAUSTED';
      // A raw provider dump ("Rate limit reached for model … org_…") helps
      // nobody; say what happened and what fixes it.
      out.detail = out.message;
      const hasGemini = !!keyFor('gemini');
      out.message = hasGemini
        ? 'Aaj ki free AI limit sab keys par khatam ho gayi hai, sir. Thodi der me apne aap wapas chalu ho jayega — ya ek aur key jod dijiye.'
        : 'Groq ki aaj ki free limit khatam ho gayi hai, sir. Google AI Studio ki free key jod dijiye — Clavis turant usi par chalega.';
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

  /* Key verification — quota-free "list models" / "key info" GET, koi
     generateContent / chat completion nahi (wo har verify par free quota
     khata tha). Google galat key par HTTP 400 "API key not valid" deta hai,
     sirf 401/403 dekhne se wo "ok" maan liya jaata tha.
     Returns {ok:true} | {ok:false, reason, error} | {ok:true, warn}. */
  const VERIFY_URLS = {
    gemini: (k) => ({ url: `https://generativelanguage.googleapis.com/v1beta/models?pageSize=1&key=${encodeURIComponent(k)}`, headers: {} }),
    groq: (k) => ({ url: 'https://api.groq.com/openai/v1/models', headers: { 'Authorization': `Bearer ${k}` } }),
    openrouter: (k) => ({ url: 'https://openrouter.ai/api/v1/key', headers: { 'Authorization': `Bearer ${k}` } }),
    openai: (k) => ({ url: 'https://api.openai.com/v1/models', headers: { 'Authorization': `Bearer ${k}` } }),
  };
  function rejected(reason) { return { ok: false, reason, error: reason }; }

  async function verify(provider, key) {
    try { await window.ClavisKeyVault.add(provider, key); return { ok: true }; }
    catch (error) { return rejected(error.message || 'Could not verify this key securely.'); }
  }

  /**
   * Authenticated bilingual transcription; output accent never forces input language.
   */
  async function transcribeWithGroq(audioBlob, signal) {
    const token = await window.SupabaseAuth?.getAccessToken?.();
    if (!token) throw new Error('Sign in before using Groq speech recognition.');
    const formData = new FormData();
    const fileExt = audioBlob.type.includes('mp4') ? 'm4a' : (audioBlob.type.includes('ogg') ? 'ogg' : 'webm');
    formData.append('file', audioBlob, `speech.${fileExt}`);
    const base = (window.SKYLARK_CONFIG?.BACKEND_URL || 'http://localhost:8000').replace(/\/$/, '');
    // The saved voice accent is not the spoken language: Hindi/English turns
    // must remain automatic even when an English output voice is selected.
    const res = await fetch(base + '/api/speech/transcribe?provider=groq', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: formData, signal
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw Object.assign(new Error(err?.detail || `Groq Whisper error ${res.status}`), { status: res.status });
    }

    const data = await res.json();
    if (data.reason) throw Object.assign(new Error('Awaaz saaf samajh nahi aayi. Mic check karke dobara boliye.'), {code:'SPEECH_UNCLEAR'});
    return (data.text || '').trim();
  }

  async function fishFetch(url, options, signal) {
    const controller = new AbortController();
    signal?.addEventListener('abort', () => controller.abort(), { once: true });
    const timeout = setTimeout(() => controller.abort(), 10000);
    try { return await fetch(url, { ...options, signal: controller.signal }); }
    finally { clearTimeout(timeout); }
  }

  async function transcribeWithFish(audioBlob) {
    const key = keyFor('fish_audio');
    if (!key) throw new Error('NO_FISH_AUDIO_KEY');
    const form = new FormData();
    const ext = audioBlob.type.includes('mp4') ? 'm4a' : (audioBlob.type.includes('ogg') ? 'ogg' : 'webm');
    form.append('audio', audioBlob, `speech.${ext}`);
    form.append('ignore_timestamps', 'true');
    const res = await fishFetch('https://api.fish.audio/v1/asr', {
      method: 'POST', headers: { Authorization: `Bearer ${key}`, model: 'transcribe-1' }, body: form
    });
    if (!res.ok) throw new Error(`Fish Audio transcription error ${res.status}`);
    return String((await res.json()).text || '').trim();
  }

  async function transcribeWithGemini(audioBlob) {
    const key = keyFor('gemini');
    if (!key) throw new Error('NO_GEMINI_KEY');
    const bytes = new Uint8Array(await audioBlob.arrayBuffer());
    let binary = '';
    for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    const res = await fetch('https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
      body: JSON.stringify({ contents: [{ parts: [
        { text: 'Transcribe this speech verbatim in its original language. Return only the spoken words.' },
        { inline_data: { mime_type: (audioBlob.type || 'audio/webm').split(';')[0], data: btoa(binary) } }
      ] }], generationConfig: { temperature: 0 } })
    });
    if (!res.ok) throw new Error(`Google transcription error ${res.status}`);
    const data = await res.json();
    return String(data.candidates?.[0]?.content?.parts?.map(p => p.text || '').join(' ') || '').trim();
  }

  async function ttsWithFish(text, signal) {
    const key = keyFor('fish_audio');
    const referenceId = localStorage.getItem('clavis_fish_voice_id')?.trim();
    if (!key) throw new Error('NO_FISH_AUDIO_KEY');
    if (!referenceId) throw new Error('FISH_AUDIO_VOICE_ID_REQUIRED');
    const res = await fishFetch('https://api.fish.audio/v1/tts', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', model: 's2.1-pro-free' },
      body: JSON.stringify({ text: String(text || '').slice(0, 1200), reference_id: referenceId, format: 'mp3', latency: 'low', chunk_length: 180, normalize: true }),
    }, signal);
    if (!res.ok) throw new Error(`Fish Audio speech error ${res.status}`);
    if (res.body && typeof MediaSource !== 'undefined' && MediaSource.isTypeSupported?.('audio/mpeg')) {
      const source = new MediaSource();
      const url = URL.createObjectURL(source);
      source.addEventListener('sourceopen', async () => {
        try {
          const buffer = source.addSourceBuffer('audio/mpeg');
          const reader = res.body.getReader();
          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            if (!value?.length) continue;
            buffer.appendBuffer(value);
            await new Promise((resolve, reject) => {
              const done = () => { buffer.removeEventListener('error', fail); resolve(); };
              const fail = () => { buffer.removeEventListener('updateend', done); reject(new Error('Fish audio stream failed')); };
              buffer.addEventListener('updateend', done, { once: true });
              buffer.addEventListener('error', fail, { once: true });
            });
          }
          if (source.readyState === 'open') source.endOfStream();
        } catch (_) {
          if (source.readyState === 'open') try { source.endOfStream('network'); } catch (_) {}
        }
      }, { once: true });
      return url;
    }
    return URL.createObjectURL(await res.blob());
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
    formData.append('prompt', 'Hindi, English, Hinglish speech transcript for Rudra24 AI executive assistant.');

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
    hasKey, setKey, removeKey, keyFor, configuredProviders, providerConfigured,
    defaultProvider, supportsVision, visionProvider,
    complete, verify, PROVIDERS, transcribeWithGroq, transcribeWithFish, transcribeWithGemini,
    transcribeWithOpenAI, ttsWithOpenAI, ttsWithFish,
    discoverModels, classifyError: classify,
    // Counts only. Never expose credentials, prompts, transcripts or full URLs.
    requestDiagnostics: () => ({ ...requestStats, helperEntries: helperCache.size, discoveryEntries: discovery.size, timings: requestTimings.map(t => ({ ...t })) })
  };

  // Keys live in localStorage, which is scoped per ORIGIN. Opening index.html
  // directly gives a file:// origin with its own empty storage — which is why
  // keys "disappear" and have to be pasted again. It ALSO changes microphone
  // permission behavior (re-prompts more, some browsers restrict it further)
  // and can silently block AI/vision fetches on some setups. A corner toast
  // was too easy to miss and only mentioned the keys half of this — this is
  // a standing top banner naming everything it affects, until fixed.
  if (location.protocol === 'file:') {
    console.warn('[Rudra24 AI] Running from file:// — keys won\'t persist, microphone permission is less reliable, and some AI requests can be blocked. Use Start-Clavis.bat (http://localhost:3000).');
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
