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
  /* A model that answers with nothing is the one failure worth retrying by
     itself: the request was fine, the turn just came back blank, and the
     user only sees "could not reply". Nothing was streamed to the screen in
     that case, so one clean re-ask is invisible — and it is one re-ask, not
     a loop, so a model that is truly stuck still surfaces its error. */
  async function complete(payload, signal, onToken) {
    try {
      return await attempt(payload, signal, onToken);
    } catch (error) {
      if (error?.code !== 'AI_EMPTY_RESPONSE' || signal?.aborted) throw error;
      await new Promise(function (r) { setTimeout(r, 400); });
      if (signal?.aborted) throw error;
      return attempt(payload, signal, onToken);
    }
  }

  async function attempt(payload, signal, onToken) {
    if (!token()) throw createError('AI_AUTH_REQUIRED', 'Sign in before using AI chat', false, 'SIGN_IN', 401);
    const base = window.SKYLARK_CONFIG?.BACKEND_URL || 'http://localhost:8000';
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort('timeout'), DEFAULT_TIMEOUT);
    const abort = () => controller.abort(signal?.reason || 'cancelled');
    if (signal?.aborted) abort();
    else signal?.addEventListener('abort', abort, { once: true });
    try {
      const response = await fetch(`${base}/api/v1/ai/chat`, {
        method: 'POST', signal: controller.signal,
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token()}` },
        body: JSON.stringify(typeof onToken === 'function' ? { ...payload, stream: true } : payload)
      });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        const detail = data?.detail;
        if (detail && typeof detail === 'object') {
          throw createError(detail.code, detail.message, detail.retryable, detail.action, response.status);
        }
        throw createError(response.status === 401 ? 'AI_AUTH_REQUIRED' : 'AI_BACKEND_UNAVAILABLE',
          typeof detail === 'string' ? detail : 'AI service request failed', response.status >= 500, 'RETRY', response.status);
      }

      if (typeof onToken === 'function' && response.headers.get('content-type')?.includes('text/event-stream') && response.body?.getReader) {
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '', dataLines = [], fullText = '', done = false;
        // Assembled from the stream's tool_calls frames. A tool turn has no
        // text at all, so without these the reply looks empty.
        const toolCalls = [];
        let delivery = Promise.resolve(), deliveryError;
        const frame = async () => {
          if (!dataLines.length) return;
          const raw = dataLines.join('\n'); dataLines = [];
          if (raw === '[DONE]') { done = true; return; }
          let message;
          try { message = JSON.parse(raw); } catch (_) { return; }
          if (message.error) {
            const error = message.error;
            throw createError(error.code, error.message, error.retryable, error.action, error.status);
          }
          if (Array.isArray(message.tool_calls)) {
            // OpenAI streams a call in fragments: the first carries the name,
            // later ones append argument text to the same index.
            message.tool_calls.forEach((frag) => {
              const i = Number(frag.index) || 0;
              const slot = toolCalls[i] || (toolCalls[i] = { id: '', type: 'function', function: { name: '', arguments: '' } });
              if (frag.id) slot.id = frag.id;
              if (frag.function?.name) slot.function.name = frag.function.name;
              if (typeof frag.function?.arguments === 'string') slot.function.arguments += frag.function.arguments;
            });
            return;
          }
          if (typeof message.text === 'string' && message.text) {
            fullText += message.text;
            // UI/TTS work must not block the network reader. Preserve delivery order.
            const text = message.text;
            delivery = delivery.then(() => {
              if (!controller.signal.aborted && !deliveryError) return onToken(text);
            }).catch(error => { deliveryError = error; });
          }
        };
        const line = async (value) => {
          value = value.replace(/\r$/, '');
          if (!value) return frame();
          if (value.startsWith('data:')) dataLines.push(value.slice(5).replace(/^\s/, ''));
        };
        try {
          while (!done) {
            const part = await reader.read();
            buffer += decoder.decode(part.value || new Uint8Array(), { stream: !part.done });
            const lines = buffer.split('\n'); buffer = lines.pop() || '';
            for (const value of lines) { await line(value); if (done) break; }
            if (part.done) { if (buffer) await line(buffer); await frame(); break; }
          }
        } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
        await delivery;
        if (deliveryError) throw deliveryError;
        if (controller.signal.aborted) throw createError(signal?.aborted ? 'AI_CANCELLED' : 'AI_TIMEOUT', 'AI stream stopped', false, 'RETRY', 0);
        const calls = toolCalls.filter(Boolean);
        // Empty text AND no tool call is a genuinely empty answer. Empty text
        // WITH a tool call is the normal shape of "do this" — not an error.
        if (!fullText.trim() && !calls.length) throw createError('AI_EMPTY_RESPONSE', 'Rudra24 AI received an empty reply', true, 'RETRY', 502);
        const msg = { role: 'assistant', content: fullText };
        if (calls.length) msg.tool_calls = calls;
        return { success: true, choices: [{ message: msg }], streamed: true };
      }

      const data = await response.json().catch(() => ({}));
      if (!Array.isArray(data.choices) || !data.choices[0]?.message?.content) {
        throw createError('AI_EMPTY_RESPONSE', 'Rudra24 AI received an empty reply', true, 'RETRY', 502);
      }
      return data;
    } catch (error) {
      if (error?.code) throw error;
      if (signal?.aborted) throw createError('AI_CANCELLED', 'Request cancelled', false, 'NONE', 0);
      if (controller.signal.aborted) throw createError('AI_TIMEOUT', 'The AI request timed out', true, 'RETRY', 504);
      throw createError('AI_BACKEND_UNAVAILABLE', 'Rudra24 AI backend is unavailable', true, 'RETRY', 0);
    } finally {
      clearTimeout(timeout);
      signal?.removeEventListener('abort', abort);
    }
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
    // PUT verifies before replacing an existing credential. Never delete a
    // previously working key because a later provider check timed out.
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
