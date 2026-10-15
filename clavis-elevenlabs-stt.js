/* One Scribe connection owns live input until sleep, mute, route or account change.
   API keys stay in the tenant vault; only a single-use token reaches this socket. */
(function (window) {
  'use strict';
  if (window.ClavisElevenSTT) return;
  const S = { generation: 0, state: 'idle', starting: null, lastError: '', session: null };
  const configured = () => Boolean(window.ClavisDirect?.providerConfigured?.('elevenlabs'));
  // Paid per second of audio. Over the cap this reports false, which is the
  // same answer as 'not connected' — jarvis_ui then uses Groq Whisper.
  const shouldUse = () => configured() && window.localStorage.getItem('clavis_stt_provider') !== 'groq'
    && (window.ClavisVoiceBudget?.allowSTT?.() !== false);
  const isActive = () => S.state === 'connecting' || S.state === 'listening';
  const owner = () => window.SupabaseAuth?.getUser?.()?.id;
  const allowed = () => !window.ClavisVoiceState || window.ClavisVoiceState.canProcessMic();
  const aborted = () => Object.assign(new Error('Voice input cancelled'), { name: 'AbortError' });

  function stop(reason = 'stopped') {
    S.generation++;
    const session = S.session;
    // Count the seconds this socket actually stayed open, before it is dropped.
    if (session?.openedAt) {
      window.ClavisVoiceBudget?.noteSTT?.(Math.max(0, (Date.now() - session.openedAt) / 1000), session.owner);
      session.openedAt = 0;
    }
    S.session = null; S.state = 'idle'; S.starting = null;
    if (!session) return;
    session.controller.abort(); clearTimeout(session.timeout); clearTimeout(session.budgetTimer);
    session.resolveStopped?.(false);
    session.rejectReady?.(aborted());
    if (session.worklet) session.worklet.port.onmessage = null;
    try { session.source?.disconnect(); session.worklet?.disconnect(); } catch (_) {}
    try { session.socket?.close(1000, reason.slice(0, 80)); } catch (_) {}
    session.stream?.getTracks().forEach(track => {
      track.removeEventListener?.('ended', session.micEnded);
      track.stop();
    });
    try { session.context?.close()?.catch?.(() => {}); } catch (_) {}
    window.ClavisEar?.tap?.stop?.('elevenlabs');
    window.ClavisVoiceState?.mic?.release?.('elevenlabs');
  }

  function fail(session, error) {
    if (S.session !== session) return;
    S.lastError = error.message;
    const callback = session.callbacks.onError;
    stop('provider failure'); S.state = 'error';
    callback?.(error);
  }

  function armBudget(session) {
    clearTimeout(session.budgetTimer);
    if (S.session !== session || !session.openedAt) return;
    const remaining = Number(window.ClavisVoiceBudget?.remainingSTT?.());
    if (!Number.isFinite(remaining)) { session.budgetDeadline = 0; return; }
    // The persisted meter does not include this live socket until stop().
    const left = remaining - Math.max(0, Date.now() - session.openedAt) / 1000;
    session.budgetDeadline = Date.now() + Math.max(0, left) * 1000;
    if (left <= 0) {
      fail(session, Object.assign(new Error('App ka local ElevenLabs listening cap reached. Settings → Voice → Advanced mein cap check kijiye.'), { code: 'STT_BUDGET', fallback: true }));
      return;
    }
    session.budgetTimer = setTimeout(() => armBudget(session), Math.min(2147483647, Math.ceil(left * 1000)));
  }

  function sendAudio(session, frames) {
    if (S.session !== session || S.state !== 'listening' || session.socket.readyState !== 1) return;
    // Background tabs can delay timers; never stream past their deadline.
    if (session.budgetDeadline && Date.now() >= session.budgetDeadline) {
      armBudget(session);
      if (S.session !== session) return;
    }
    if (session.socket.bufferedAmount > 1048576) {
      fail(session, Object.assign(new Error('Live speech connection is too slow. Retry the microphone.'), { code: 'STT_NETWORK', fallback: true }));
      return;
    }
    const bytes = new Uint8Array(frames.length * 2), view = new DataView(bytes.buffer);
    for (let i = 0; i < frames.length; i++) {
      const value = Math.max(-1, Math.min(1, frames[i]));
      view.setInt16(i * 2, Math.round(value * (value < 0 ? 32768 : 32767)), true);
    }
    let binary = '';
    for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
    try {
      session.socket.send(JSON.stringify({ message_type: 'input_audio_chunk', audio_base_64: window.btoa(binary), sample_rate: 16000 }));
    } catch (_) {
      fail(session, Object.assign(new Error('Live speech connection disconnected. Retry the microphone.'), { code: 'STT_NETWORK', fallback: true }));
    }
  }

  async function connect(callbacks) {
    const session = { generation: ++S.generation, owner: owner(), callbacks, controller: new AbortController(),
      partial: '', committed: '', committedAt: 0, hadPartial: false, sequence: 0, since: 0, frames: [] };
    S.session = session; S.state = 'connecting'; S.lastError = '';
    const current = () => S.session === session && session.generation === S.generation && session.owner === owner() && allowed();
    const check = () => { if (!current()) throw aborted(); };
    try {
      check();
      if (!configured()) throw Object.assign(new Error('Connect ElevenLabs in Setup to enable live speech.'), { code: 'STT_CREDENTIAL_MISSING', fallback: false });
      if (window.ClavisVoiceBudget?.allowSTT?.() === false) {
        throw Object.assign(new Error(window.ClavisVoiceBudget.reason() || 'ElevenLabs live speech budget reached.'), { code: 'STT_BUDGET', fallback: true });
      }
      // Readiness includes auth + token delivery; a hung backend is not a live mic.
      session.timeout = setTimeout(() => fail(session, Object.assign(new Error('Live speech setup timed out. Check the backend connection.'), { code: 'STT_NETWORK', fallback: true })), 15000);
      const token = await window.SupabaseAuth?.getAccessToken?.();
      check();
      if (!token) throw Object.assign(new Error('Sign in again before starting live speech.'), { code: 'STT_AUTH', fallback: false });
      const base = (window.SKYLARK_CONFIG?.BACKEND_URL || 'http://localhost:8000').replace(/\/$/, '');
      let response;
      try {
        response = await fetch(base + '/api/speech/elevenlabs-token', {
          method: 'POST', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
          body: '{}', signal: session.controller.signal,
        });
      } catch (error) {
        if (error.name === 'AbortError') throw error;
        throw Object.assign(new Error('Speech server is unreachable. Check the backend connection.'), { code: 'STT_NETWORK', fallback: true });
      }
      check();
      const data = await response.json().catch(() => ({}));
      check();
      clearTimeout(session.timeout);
      if (!response.ok || !data.token) {
        const message = typeof data.detail === 'string' ? data.detail : data.detail?.message || 'ElevenLabs live speech could not connect. Check your key and allowance in Setup.';
        throw Object.assign(new Error(message), { code: 'STT_PROVIDER', status: response.status, fallback: response.status === 429 || response.status >= 500 });
      }
      // A browser permission dialog cannot be aborted; settle our startup and
      // dispose a late grant rather than leaving the voice UI connecting forever.
      session.timeout = setTimeout(() => fail(session, Object.assign(new Error('Microphone permission is still pending. Allow access, then retry the microphone.'), { code: 'STT_MIC_TIMEOUT', fallback: false })), 30000);
      const microphone = window.LocalSpeechEngine?.acquireVoiceMicrophone
        ? await window.LocalSpeechEngine.acquireVoiceMicrophone()
        : await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: false, channelCount: 1 }, video: false });
      // The shared processed stream also serves Voice ID; stop only our clone.
      session.stream = window.LocalSpeechEngine?.acquireVoiceMicrophone ? microphone.clone() : microphone;
      check();
      clearTimeout(session.timeout);
      const tracks = session.stream.getTracks();
      session.micEnded = () => fail(session, Object.assign(new Error('Microphone disconnected or access was revoked. Reconnect it, then retry the microphone.'), { code: 'STT_MIC_ENDED', fallback: false }));
      if (!tracks.length || tracks.some(track => track.readyState === 'ended')) throw Object.assign(new Error('Microphone is unavailable. Reconnect it, then retry.'), { code: 'STT_MIC_ENDED', fallback: false });
      tracks.forEach(track => track.addEventListener?.('ended', session.micEnded));
      if (window.ClavisVoiceState?.mic?.claim?.('elevenlabs', () => stop('mic released')) === false) throw aborted();
      session.timeout = setTimeout(() => fail(session, Object.assign(new Error('ElevenLabs live speech connection timed out.'), { code: 'STT_NETWORK', fallback: true })), 15000);
      await window.ClavisEar?.tap?.start?.('elevenlabs', session.stream);
      check();
      const Context = window.AudioContext || window.webkitAudioContext;
      if (!Context || !window.AudioWorkletNode) throw new Error('This browser needs AudioWorklet support for live speech.');
      session.context = new Context({ latencyHint: 'interactive' });
      await window.ClavisWorklet.add(session.context, 'clavis-mic-capture-worklet.js');
      check();
      if (session.context.state === 'suspended') await session.context.resume();
      check();
      session.source = session.context.createMediaStreamSource(session.stream);
      session.worklet = new window.AudioWorkletNode(session.context, 'clavis-mic-capture');
      const params = new URLSearchParams({ token: data.token, model_id: 'scribe_v2_realtime', audio_format: 'pcm_16000',
        commit_strategy: 'vad', vad_silence_threshold_secs: String(Math.min(2, Math.max(0.3, (Number(window.localStorage.getItem('clavis_live_patience_ms')) || 600) / 1000))),
        min_speech_duration_ms: '120', min_silence_duration_ms: '100', include_timestamps: 'false', filter_background_audio: 'true' });
      // Interface language is not microphone language. Default this Hinglish
      // assistant to Hindi plus English rather than unconstrained detection.
      const spokenLanguage = window.localStorage.getItem('clavis_voice_language') || 'hi';
      if (spokenLanguage !== 'auto') {
        const primary = spokenLanguage.split('-')[0];
        params.set('language_code', primary);
        if (primary === 'hi' || primary === 'en') params.append('secondary_languages', primary === 'hi' ? 'en' : 'hi');
      }
      session.socket = new window.WebSocket('wss://api.elevenlabs.io/v1/speech-to-text/realtime?' + params);
      await new Promise((resolve, reject) => {
        session.rejectReady = reject;
        session.socket.onmessage = event => {
          if (!current()) { if (S.session === session) stop('session changed'); return; }
          let message; try { message = JSON.parse(event.data); } catch (_) { return; }
          if (message.message_type === 'session_started') {
            if (S.state !== 'connecting') return;
            clearTimeout(session.timeout);
            S.state = 'listening'; session.id = message.session_id || String(session.generation);
            window.ClavisEar?.tap?.consume?.();
            session.openedAt = Date.now();
            armBudget(session);
            if (!current()) return;
            session.rejectReady = null;
            resolve(); callbacks.onReady?.(); return;
          }
          if (message.message_type === 'partial_transcript') {
            const text = String(message.text || '').trim();
            if (!text || text === session.partial) return;
            const voiceEvidence = window.ClavisEar?.voiceId?.capture?.(session.since || undefined);
            if (!session.hadPartial) { session.since = voiceEvidence?.since || Date.now(); callbacks.onSpeechStart?.(text); }
            session.hadPartial = true; session.partial = text;
            callbacks.onPartial?.(text, { since: session.since, until: voiceEvidence?.until, voiceEvidence }); return;
          }
          if (message.message_type === 'committed_transcript') {
            const text = String(message.text || '').trim();
            // Delayed timestamp/entity events are not user turns. An identical
            // new segment with a partial is intentional repetition, not a retry.
            if (!text || (!session.hadPartial && text === session.committed && Date.now() - session.committedAt < 1500)) return;
            // The first partial may have only a few frames, and the speaker can
            // change before VAD commits. Verify the complete acoustic interval.
            const voiceEvidence = window.ClavisEar?.voiceId?.capture?.(session.since || undefined);
            const since = voiceEvidence?.since || session.since;
            session.committed = text; session.committedAt = Date.now(); session.partial = ''; session.hadPartial = false; session.since = 0;
            callbacks.onCommit?.(text, { since, until: voiceEvidence?.until, voiceEvidence, turnId: 'eleven-' + session.id + '-' + (++session.sequence), fromEar: true, source: 'elevenlabs' });
            window.ClavisEar?.tap?.consume?.();
            return;
          }
          if (message.message_type === 'warning') return;
          if (message.error || /error|rate_limited|quota_exceeded|throttled|resource_exhausted|queue_overflow|insufficient_audio_activity|session_time_limit/.test(message.message_type || '')) {
            const code = message.message_type || 'STT_PROVIDER';
            const fallback = /quota|rate_limited|throttled|resource_exhausted|session_time_limit|transcriber|queue_overflow|insufficient_audio_activity/.test(code);
            fail(session, Object.assign(new Error(String(message.error || 'ElevenLabs live speech rejected the connection.')), { code, fallback }));
          }
        };
        session.socket.onerror = () => { if (current()) fail(session, Object.assign(new Error('ElevenLabs live speech connection failed.'), { code: 'STT_NETWORK', fallback: true })); };
        session.socket.onclose = () => { if (current()) fail(session, Object.assign(new Error('ElevenLabs live speech disconnected. Retry the microphone.'), { code: 'STT_NETWORK', fallback: true })); };
      });
      check();
      session.worklet.port.onmessage = event => {
        if (!current() || event.data?.type !== 'pcm') return;
        session.frames.push(...new Float32Array(event.data.audio));
        if (session.frames.length >= 1024) { sendAudio(session, session.frames); session.frames = []; }
      };
      session.source.connect(session.worklet); session.worklet.connect(session.context.destination);
      return true;
    } catch (error) {
      if (S.session === session) {
        if (error.name === 'AbortError') stop('cancelled');
        else fail(session, error);
      } else {
        // Permission/acquisition can resolve after mute or an account change.
        // Release that late clone without touching the new session's stream.
        session.stream?.getTracks().forEach(track => track.stop());
        try { session.context?.close()?.catch?.(() => {}); } catch (_) {}
      }
      return false;
    }
  }

  function start(callbacks = {}) {
    if (S.starting) return S.starting;
    if (S.state === 'listening') return Promise.resolve(true);
    const connecting = connect(callbacks), session = S.session;
    // getUserMedia/resume cannot be aborted by the browser. Settle the UI now;
    // connect's generation checks dispose any permission grant that arrives later.
    const pending = session ? Promise.race([connecting, new Promise(resolve => { session.resolveStopped = resolve; })]) : connecting;
    S.starting = pending;
    pending.finally(() => { if (S.starting === pending) S.starting = null; });
    return pending;
  }
  window.ClavisVoiceState?.registerAudioCleanup?.(stop);
  window.addEventListener('rudra:auth-state', () => { if (S.session && S.session.owner !== owner()) stop('account changed'); });
  window.addEventListener('clavis:workspace-change', () => { if (!window.ClavisVoiceState?.isClavisWorkspace?.()) stop('view changed'); });
  window.addEventListener('clavis:voice-settings-changed', event => {
    if (event.detail?.kind === 'budget' && S.session && S.state === 'listening') armBudget(S.session);
  });
  window.ClavisElevenSTT = { start, stop, isActive, configured, shouldUse,
    status: () => ({ state: S.state, lastError: S.lastError, provider: 'elevenlabs', model: 'scribe_v2_realtime' }) };
})(window);
