/**
 * Voice engine for the Clavis chat UI -- speech-to-text and text-to-speech,
 * both via Google Gemini (backend/services/speech/gemini_client.py), through
 * the same worklet/websocket contract this file always used.
 *
 * The class and globals below are still named "LocalSpeechEngine" /
 * "startLocalJarvisVoiceInput" even though nothing runs locally any more --
 * ~20 call sites across jarvis_ui.js, clavis-barge-in.js and
 * clavis-audio-trigger.js already depend on those exact names, and renaming
 * them buys nothing but risk. Only the engine behind the sockets changed:
 * Kokoro (local, ~14s replies, and a standing bug that made every local
 * transcription throw) is gone from this path. Voice output is a
 * per-sentence stream from Gemini instead of segment-level Kokoro audio;
 * voice input is Gemini transcription instead of local faster-whisper.
 */
(function () {
  'use strict';

  const WS_OUTPUT_PATH = '/ws/speech/output';
  const WS_INPUT_PATH = '/ws/speech/input';
  const API_HEALTH_PATH = '/api/speech/health';
  const SHARED_STREAM_KEY = 'clavis_mic_permission_granted';

  function backendBase() {
    const configured = window.SKYLARK_CONFIG?.BACKEND_URL;
    if (configured && !/localhost|127\.0\.0\.1/i.test(location.hostname)) {
      try {
        const url = new URL(configured);
        if (/localhost|127\.0\.0\.1/i.test(url.hostname)) return location.origin;
      } catch (_) {}
    }
    return configured || location.origin;
  }

  function websocketUrl(path) {
    const base = backendBase().replace(/^http/i, 'ws').replace(/\/$/, '');
    return `${base}${path}`;
  }

  function localStatus(message, kind) {
    document.querySelectorAll('[data-clavis-engine-status]').forEach((el) => {
      el.textContent = message;
      el.dataset.status = kind || 'info';
    });
  }

  function microphoneStatus(message, kind) {
    document.querySelectorAll('[data-clavis-mic-status]').forEach((el) => {
      el.textContent = message;
      el.dataset.status = kind || 'info';
    });
  }

  function floatToPcm16(samples) {
    const source = samples instanceof Float32Array ? samples : new Float32Array(samples || []);
    const output = new Int16Array(source.length);
    for (let i = 0; i < source.length; i += 1) {
      const value = Math.max(-1, Math.min(1, source[i] || 0));
      output[i] = value < 0 ? value * 32768 : value * 32767;
    }
    return output.buffer;
  }

  class LocalSpeechEngine {
    constructor() {
      this.audioContext = null;
      this.player = null;
      this.captureNode = null;
      this.captureSource = null;
      this.outputSocket = null;
      this.inputSocket = null;
      this.activeGeneration = null;
      this.outputReady = false;
      this.serverDone = false;
      this.drained = false;
      this.doneResolve = null;
      this.readyResolve = null;
      this.readyReject = null;
      this.sharedStream = null;
      this.healthCache = null;
      this.healthFailureUntil = 0;
    }

    async health(force = false) {
      if (this.healthCache && !force) return this.healthCache;
      if (!force && this.healthFailureUntil > Date.now()) {
        throw new Error('Voice service temporarily unavailable');
      }
      try {
        const response = await fetch(`${backendBase()}${API_HEALTH_PATH}`, { cache: 'no-store' });
        if (!response.ok) throw new Error(`Voice service returned ${response.status}`);
        this.healthCache = await response.json();
        this.healthFailureUntil = 0;
        if (!this.healthCache.tts?.ready) localStatus('Gemini voice not configured', 'loading');
        else localStatus('Gemini voice ready', 'ready');
        return this.healthCache;
      } catch (error) {
        // A protected/missing speech backend should fall back to browser TTS
        // once, not re-hit the endpoint for every sentence and every
        // proactive greeting. Retry after a quiet cooldown.
        this.healthFailureUntil = Date.now() + 30000;
        throw error;
      }
    }

    isBackendUnavailable() { return this.healthFailureUntil > Date.now(); }

    async ensureAudioContext() {
      if (!this.audioContext) {
        this.audioContext = new AudioContext({ latencyHint: 'interactive', sampleRate: 24000 });
        await this.audioContext.audioWorklet.addModule('/clavis-pcm-player-worklet.js?v=3');
        this.player = new AudioWorkletNode(this.audioContext, 'clavis-pcm-player', { outputChannelCount: [1] });
        this.player.connect(this.audioContext.destination);
        this.player.port.onmessage = (event) => {
          if (event.data?.type === 'drained') {
            this.drained = true;
            this.resolveWhenComplete();
          }
        };
      }
      if (this.audioContext.state === 'suspended') await this.audioContext.resume();
    }

    async acquireSharedMicrophone() {
      if (this.sharedStream?.getTracks?.().some((track) => track.readyState === 'live')) return this.sharedStream;
      if (!navigator.mediaDevices?.getUserMedia) throw new Error('This browser cannot access a microphone.');
      this.sharedStream = await navigator.mediaDevices.getUserMedia({
        // One shared raw stream serves speech plus clap/snap detection. Asking
        // for separate streams was the source of repeat permission prompts;
        // browser noise suppression/AGC also flattens short snap transients.
        audio: { echoCancellation: true, noiseSuppression: false, autoGainControl: false, channelCount: 1 },
        video: false,
      });
      localStorage.setItem(SHARED_STREAM_KEY, 'true');
      document.documentElement.dataset.clavisMic = 'granted';
      microphoneStatus('Microphone ready · Hands-Free and Clap / Snap can stay on', 'ready');
      window.dispatchEvent(new CustomEvent('clavis:mic-granted'));
      return this.sharedStream;
    }

    getSharedMicrophone() { return this.sharedStream; }

    resolveWhenComplete() {
      if (this.serverDone && this.drained && this.doneResolve) {
        const resolve = this.doneResolve;
        this.doneResolve = null;
        resolve(true);
      }
    }

    stop() {
      const generationId = this.activeGeneration;
      this.activeGeneration = null;
      this.outputReady = false;
      this.serverDone = false;
      this.drained = false;
      if (this.outputSocket && this.outputSocket.readyState === WebSocket.OPEN && generationId) {
        try { this.outputSocket.send(JSON.stringify({ type: 'cancel', generation_id: generationId })); } catch (_) {}
      }
      try { this.player?.port.postMessage({ type: 'stop' }); } catch (_) {}
      try { this.outputSocket?.close(); } catch (_) {}
      this.outputSocket = null;
      if (this.doneResolve) { const resolve = this.doneResolve; this.doneResolve = null; resolve(false); }
      if (this.readyReject) { const reject = this.readyReject; this.readyReject = null; reject(new Error('Speech cancelled')); }
    }

    async beginSpeech(options = {}) {
      const clean = String(options.text || '').trim();
      this.stop();
      const h = await this.health();
      // No GEMINI_API_KEY in backend/.env: fail in milliseconds so the browser
      // voice speaks instead of the user waiting on a socket that can't talk.
      if (h?.tts && h.tts.ready === false) throw new Error('Backend voice not configured');
      await this.ensureAudioContext();
      const generationId = options.generationId || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
      this.activeGeneration = generationId;
      localStatus('Speaking', 'speaking');
      const socket = new WebSocket(websocketUrl(WS_OUTPUT_PATH));
      this.outputSocket = socket;
      const ready = new Promise((resolve, reject) => { this.readyResolve = resolve; this.readyReject = reject; });
      const voiceSettings = {
        voice: localStorage.getItem('clavis_gemini_voice') || 'Charon',
      };
      socket.onopen = () => socket.send(JSON.stringify({ type: 'start', generation_id: generationId, voice_settings: voiceSettings }));
      socket.onmessage = (event) => {
        if (typeof event.data === 'string') {
          let payload;
          try { payload = JSON.parse(event.data); } catch (_) { return; }
          if (payload.generation_id && payload.generation_id !== this.activeGeneration) return;
          if (payload.type === 'ready') {
            this.outputReady = true;
            const resolve = this.readyResolve; this.readyResolve = null;
            if (resolve) resolve(true);
          } else if (payload.type === 'done') {
            this.serverDone = true;
            this.resolveWhenComplete();
          } else if (payload.type === 'error') {
            const reject = this.readyReject; this.readyReject = null;
            if (reject) reject(new Error(payload.error || 'Gemini voice failed'));
          }
          return;
        }
        const deliver = (audio) => {
          if (this.activeGeneration !== generationId) return;
          try { this.player?.port.postMessage({ type: 'chunk', audio }, [audio]); } catch (_) {}
        };
        if (event.data instanceof ArrayBuffer) deliver(event.data);
        else if (event.data instanceof Blob) event.data.arrayBuffer().then(deliver).catch(() => {});
      };
      socket.onerror = () => {
        localStatus('Gemini voice unavailable — text mode remains available', 'error');
        const reject = this.readyReject; this.readyReject = null;
        if (reject) reject(new Error('Voice WebSocket connection failed'));
        if (this.doneResolve) { const resolve = this.doneResolve; this.doneResolve = null; resolve(false); }
      };
      socket.onclose = () => {
        if (this.activeGeneration === generationId && !this.serverDone) localStatus('Voice connection closed', 'error');
        if (this.activeGeneration === generationId && !this.serverDone && this.doneResolve) {
          const resolve = this.doneResolve; this.doneResolve = null; resolve(false);
        }
      };
      await ready;
      if (clean) await this.pushText(clean);
      return { generationId };
    }

    async pushText(text) {
      if (!this.outputSocket || !this.outputReady || !this.activeGeneration || !String(text || '')) return false;
      this.outputSocket.send(JSON.stringify({ type: 'text_delta', text: String(text), generation_id: this.activeGeneration }));
      return true;
    }

    async finishSpeech() {
      if (!this.outputSocket || !this.outputReady || !this.activeGeneration) return false;
      const generationId = this.activeGeneration;
      const completion = new Promise((resolve) => { this.doneResolve = resolve; });
      this.outputSocket.send(JSON.stringify({ type: 'finish', generation_id: generationId }));
      const result = await completion;
      if (result && this.activeGeneration === generationId) localStatus('Gemini voice ready', 'ready');
      return result;
    }

    async speak(text, options = {}) {
      await this.beginSpeech({ ...options, text });
      await this.finishSpeech();
      return true;
    }

    async startInput(options = {}) {
      if (this.inputSocket) {
        this.stopInput();
        return false;
      }
      await this.ensureAudioContext();
      const stream = await this.acquireSharedMicrophone();
      await this.audioContext.audioWorklet.addModule('/clavis-mic-capture-worklet.js?v=2');
      const generationId = options.generationId || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
      const socket = new WebSocket(websocketUrl(WS_INPUT_PATH));
      socket._generationId = generationId;
      this.inputSocket = socket;
      const ready = new Promise((resolve, reject) => { socket._readyResolve = resolve; socket._readyReject = reject; });
      socket.onopen = () => socket.send(JSON.stringify({
        type: 'start', generation_id: generationId,
        language_hint: options.languageHint || localStorage.getItem('clavis_voice_language') || '',
      }));
      socket.onmessage = (event) => {
        let payload;
        try { payload = JSON.parse(event.data); } catch (_) { return; }
        if (payload.generation_id !== generationId) return;
        if (payload.type === 'ready') socket._readyResolve?.(true);
        if (payload.type === 'vad') options.onVad?.(payload);
        if (payload.type === 'partial') options.onPartial?.(payload.text || '');
        if (payload.type === 'final') {
          options.onFinal?.(payload.text || '');
          if (!options.persistent) this.stopInput();
        }
        if (payload.type === 'error') options.onError?.(new Error(payload.error || 'Speech recognition failed'));
      };
      socket.onerror = () => {
        socket._readyReject?.(new Error('Speech recognition WebSocket connection failed'));
        options.onError?.(new Error('Speech recognition WebSocket connection failed'));
      };
      socket.onclose = () => { if (this.inputSocket === socket) this.inputSocket = null; };
      await ready;
      this.captureSource = this.audioContext.createMediaStreamSource(stream);
      this.captureNode = new AudioWorkletNode(this.audioContext, 'clavis-mic-capture', { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1] });
      this.captureNode.port.onmessage = (event) => {
        if (event.data?.type !== 'pcm' || socket.readyState !== WebSocket.OPEN) return;
        socket.send(floatToPcm16(new Float32Array(event.data.audio)));
      };
      const silent = this.audioContext.createGain();
      silent.gain.value = 0;
      this.captureSource.connect(this.captureNode).connect(silent).connect(this.audioContext.destination);
      const btn = document.getElementById('jarvis-composer-voice-btn') || document.getElementById('jarvis-voice-btn');
      btn?.classList.add('recording');
      microphoneStatus('Listening · speak naturally', 'listening');
      localStatus('Listening', 'listening');
      return true;
    }

    stopInput() {
      const socket = this.inputSocket;
      if (socket?.readyState === WebSocket.OPEN) {
        try { socket.send(JSON.stringify({ type: 'stop', generation_id: socket._generationId })); } catch (_) {}
      }
      try { this.captureNode?.disconnect(); this.captureSource?.disconnect(); } catch (_) {}
      this.captureNode = null;
      this.captureSource = null;
      try { socket?.close(); } catch (_) {}
      this.inputSocket = null;
      if (localStorage.getItem(SHARED_STREAM_KEY) === 'true') microphoneStatus('Microphone ready · Hands-Free and Clap / Snap can stay on', 'ready');
      document.querySelectorAll('.jarvis-composer-mic-btn, #jarvis-voice-btn').forEach((el) => el.classList.remove('recording'));
    }
  }

  window.LocalSpeechEngine = new LocalSpeechEngine();
  window.startLocalJarvisVoiceInput = function (options = {}) {
    const btn = document.getElementById('jarvis-composer-voice-btn') || document.getElementById('jarvis-voice-btn');
    const status = document.getElementById('jarvis-composer-status');
    const onFinal = (text) => {
      btn?.classList.remove('recording');
      if (status) status.textContent = '';
      const value = String(text || '').trim();
      if (value && typeof options.onFinal === 'function') options.onFinal(value);
      else if (value && typeof window.commitJarvisVoiceInput === 'function') window.commitJarvisVoiceInput(value);
    };
    const onError = (error) => {
      btn?.classList.remove('recording');
      if (status) status.textContent = 'Mic/voice unavailable — check permission or Gemini API key.';
      microphoneStatus('Microphone unavailable · allow access and retry', 'error');
      localStatus('Voice input unavailable', 'error');
      console.warn('[Clavis voice]', error);
    };
    if (window.LocalSpeechEngine.inputSocket) {
      window.LocalSpeechEngine.stopInput();
      return;
    }
    window.LocalSpeechEngine.startInput({ ...options, onFinal, onError })
      .then(() => btn?.classList.add('recording'))
      .catch(onError);
  };
})();
