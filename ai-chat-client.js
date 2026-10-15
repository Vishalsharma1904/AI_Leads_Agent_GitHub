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
  // The backend tries configured candidates before sending the first usable
  // event. Repeating the whole request here repeats charges and cannot safely
  // recover a partially received tool turn.
  const complete = (payload, signal, onToken) => attempt(payload, signal, onToken);
  function responseText(content) {
    if (typeof content === 'string') return content;
    return Array.isArray(content) ? content.filter(part => ['text', 'output_text'].includes(part?.type) && typeof part.text === 'string').map(part => part.text).join('') : '';
  }
  function usableTools(calls) {
    if (!Array.isArray(calls) || !calls.length || calls.length > 64) return false;
    return calls.every(call => {
      if (typeof call?.function?.name !== 'string' || !call.function.name.trim() || typeof call.function.arguments !== 'string') return false;
      try { const value = JSON.parse(call.function.arguments); return value !== null && typeof value === 'object' && !Array.isArray(value); } catch (_) { return false; }
    });
  }

  async function attempt(payload, signal, onToken) {
    if (!token()) throw createError('AI_AUTH_REQUIRED', 'Sign in before using AI chat', false, 'SIGN_IN', 401);
    if (signal?.aborted) throw createError('AI_CANCELLED', 'Request cancelled', false, 'NONE', 0);
    const owner = window.SupabaseAuth?.getUser?.()?.id;
    const auth = token();
    const checkAccount = () => {
      if (!token() || (owner ? owner !== window.SupabaseAuth?.getUser?.()?.id : auth !== token())) {
        throw createError('AI_CANCELLED', 'Account changed; request cancelled', false, 'NONE', 0);
      }
    };
    const base = window.SKYLARK_CONFIG?.BACKEND_URL || 'http://localhost:8000';
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort('timeout'), DEFAULT_TIMEOUT);
    const abort = () => controller.abort(signal?.reason || 'cancelled');
    let receivedPartial = false;
    if (signal?.aborted) abort();
    else signal?.addEventListener('abort', abort, { once: true });
    try {
      const response = await fetch(`${base}/api/v1/ai/chat`, {
        method: 'POST', signal: controller.signal,
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${auth}` },
        body: JSON.stringify(typeof onToken === 'function' ? { ...payload, stream: true } : payload)
      });
      checkAccount();
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        const detail = data?.detail;
        if (detail && typeof detail === 'object') {
          const error = createError(detail.code, detail.message, detail.retryable, detail.action, response.status);
          const retry = Number(detail.retry_after_seconds);
          if (Number.isFinite(retry) && retry > 0 && retry <= 86400) error.retryAfterSeconds = retry;
          throw error;
        }
        throw createError(response.status === 401 ? 'AI_AUTH_REQUIRED' : 'AI_BACKEND_UNAVAILABLE',
          typeof detail === 'string' ? detail : 'AI service request failed', response.status >= 500, 'RETRY', response.status);
      }

      if (response.headers.get('content-type')?.includes('text/event-stream') && response.body?.getReader) {
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
          checkAccount();
          if (!message || typeof message !== 'object') return;
          if (message.error) {
            const error = message.error;
            throw createError(error.code, error.message, error.retryable, error.action, error.status);
          }
          if (Array.isArray(message.tool_calls)) {
            // OpenAI streams a call in fragments: the first carries the name,
            // later ones append argument text to the same index.
            message.tool_calls.forEach((frag) => {
              if (!frag || typeof frag !== 'object' || !frag.function || typeof frag.function !== 'object') return;
              const i = frag.index === undefined ? 0 : frag.index;
              if (!Number.isInteger(i) || i < 0 || i >= 64) return;
              if (![frag.id, frag.function.name, frag.function.arguments].some(value => typeof value === 'string' && value)) return;
              receivedPartial = true;
              const slot = toolCalls[i] || (toolCalls[i] = { id: '', type: 'function', function: { name: '', arguments: '' } });
              if (typeof frag.id === 'string' && frag.id) slot.id = frag.id;
              if (typeof frag.function.name === 'string' && frag.function.name) slot.function.name += frag.function.name;
              if (typeof frag.function?.arguments === 'string') slot.function.arguments += frag.function.arguments;
            });
          }
          if (typeof message.text === 'string' && message.text) {
            receivedPartial = true;
            fullText += message.text;
            // UI/TTS work must not block the network reader. Preserve delivery order.
            const text = message.text;
            delivery = delivery.then(() => {
              checkAccount();
              if (!controller.signal.aborted && !deliveryError && typeof onToken === 'function') return onToken(text);
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
        checkAccount();
        if (deliveryError) throw deliveryError;
        if (controller.signal.aborted) throw createError(signal?.aborted ? 'AI_CANCELLED' : 'AI_TIMEOUT', 'AI stream stopped', false, 'RETRY', 0);
        const calls = toolCalls.filter(Boolean);
        if (calls.length && !usableTools(calls)) throw createError('AI_INVALID_RESPONSE', 'The AI provider returned an incomplete tool request. Please retry this turn.', true, 'RETRY', 502);
        // Empty text AND no tool call is a genuinely empty answer. Empty text
        // WITH a tool call is the normal shape of "do this" — not an error.
        if (!fullText.trim() && !calls.length) throw createError('AI_EMPTY_RESPONSE', 'Rudra24 AI received an empty reply', true, 'RETRY', 502);
        const msg = { role: 'assistant', content: fullText };
        if (calls.length) msg.tool_calls = calls;
        return { success: true, choices: [{ message: msg }], streamed: true };
      }

      const data = await response.json().catch(() => ({}));
      checkAccount();
      const message = data.choices?.[0]?.message;
      const text = responseText(message?.content);
      if (!Array.isArray(data.choices) || !(text.trim() || usableTools(message?.tool_calls))) {
        throw createError('AI_EMPTY_RESPONSE', 'Rudra24 AI received an empty reply', true, 'RETRY', 502);
      }
      if (message?.tool_calls?.length && !usableTools(message.tool_calls)) throw createError('AI_INVALID_RESPONSE', 'The AI provider returned an incomplete tool request. Please retry this turn.', true, 'RETRY', 502);
      message.content = text || null;
      return data;
    } catch (error) {
      let failure = error;
      if (!error?.code) {
        failure = signal?.aborted ? createError('AI_CANCELLED', 'Request cancelled', false, 'NONE', 0)
          : controller.signal.aborted ? createError('AI_TIMEOUT', 'The AI request timed out', true, 'RETRY', 504)
          : createError('AI_BACKEND_UNAVAILABLE', 'Rudra24 AI backend is unavailable', true, 'RETRY', 0);
      }
      // Cancel queued token delivery before the UI handles a broken stream.
      controller.abort('request failed');
      if (receivedPartial) failure.partialResponse = true;
      throw failure;
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
