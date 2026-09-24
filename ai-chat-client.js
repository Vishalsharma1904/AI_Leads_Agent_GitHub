/* Authenticated browser client for the server-side AI proxy. */
(function () {
  'use strict';
  const DEFAULT_TIMEOUT = 50000;
  function token() { return window.SupabaseAuth?.getAccessToken?.() || ''; }
  function createError(code, message, retryable, action, status) {
    const error = new Error(message || 'AI service request failed');
    error.code = code || 'AI_BACKEND_UNAVAILABLE';
    error.retryable = Boolean(retryable);
    error.action = action || 'RETRY';
    error.status = status || 0;
    return error;
  }
  async function complete(payload, signal) {
    if (!token()) throw createError('AI_AUTH_REQUIRED', 'Sign in before using AI chat', false, 'SIGN_IN', 401);
    const base = window.SKYLARK_CONFIG?.BACKEND_URL || 'http://localhost:8000';
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort('timeout'), DEFAULT_TIMEOUT);
    const abort = () => controller.abort(signal?.reason || 'cancelled');
    signal?.addEventListener('abort', abort, { once: true });
    let response;
    try {
      response = await fetch(`${base}/api/v1/ai/chat`, {
        method: 'POST', signal: controller.signal,
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token()}` },
        body: JSON.stringify(payload)
      });
    } catch (error) {
      if (signal?.aborted) throw createError('AI_CANCELLED', 'Request cancelled', false, 'NONE', 0);
      if (controller.signal.aborted) throw createError('AI_TIMEOUT', 'The AI request timed out', true, 'RETRY', 504);
      throw createError('AI_BACKEND_UNAVAILABLE', 'Clavis backend is unavailable', true, 'RETRY', 0);
    } finally {
      clearTimeout(timeout);
      signal?.removeEventListener('abort', abort);
    }
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const detail = data?.detail;
      if (detail && typeof detail === 'object') {
        throw createError(detail.code, detail.message, detail.retryable, detail.action, response.status);
      }
      throw createError(response.status === 401 ? 'AI_AUTH_REQUIRED' : 'AI_BACKEND_UNAVAILABLE',
        typeof detail === 'string' ? detail : 'AI service request failed', response.status >= 500, 'RETRY', response.status);
    }
    if (!Array.isArray(data.choices) || !data.choices[0]?.message?.content) {
      throw createError('AI_EMPTY_RESPONSE', 'Clavis received an empty reply', true, 'RETRY', 502);
    }
    return data;
  }
  async function saveCredential(provider, secret) {
    if (!token()) throw createError('AI_AUTH_REQUIRED', 'Sign in before connecting a key', false, 'SIGN_IN', 401);
    const base = window.SKYLARK_CONFIG?.BACKEND_URL || 'http://localhost:8000';
    const response = await fetch(`${base}/api/credentials`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token()}` },
      body: JSON.stringify({ provider, secret })
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw createError(data?.detail?.code, data?.detail?.message || data?.detail || 'Credential could not be saved', false, 'OPEN_CREDENTIAL_SETUP', response.status);
    const verifiableProviders = new Set(['openrouter', 'gemini', 'groq', 'openai', 'deepseek', 'mistral', 'together', 'fireworks', 'xai', 'cerebras', 'perplexity']);
    if (verifiableProviders.has(provider)) {
      const verification = await fetch(`${base}/api/credentials/verify/${encodeURIComponent(provider)}`, {
        method: 'POST', headers: { Authorization: `Bearer ${token()}` }
      });
      const verificationData = await verification.json().catch(() => ({}));
      if (!verification.ok) {
        await fetch(`${base}/api/credentials/${encodeURIComponent(provider)}`, { method: 'DELETE', headers: { Authorization: `Bearer ${token()}` } }).catch(() => {});
        throw createError(verificationData?.detail?.code, verificationData?.detail?.message || 'The provider rejected this key', false, 'OPEN_CREDENTIAL_SETUP', verification.status);
      }
      return verificationData;
    }
    return data;
  }
  async function getCredentials() {
    if (!token()) return { credentials: [] };
    const base = window.SKYLARK_CONFIG?.BACKEND_URL || 'http://localhost:8000';
    const response = await fetch(`${base}/api/credentials`, {
      headers: { Authorization: `Bearer ${token()}` }
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw createError(response.status === 401 ? 'AI_AUTH_REQUIRED' : 'AI_BACKEND_UNAVAILABLE', 'Could not read provider status', true, 'RETRY', response.status);
    return data;
  }
  window.NexusAIChat = { complete, saveCredential, getCredentials };
})();
