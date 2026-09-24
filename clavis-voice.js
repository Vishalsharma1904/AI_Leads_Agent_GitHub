/* ============================================================
 * clavis-voice.js · how Clavis sounds when it speaks a reply
 * ------------------------------------------------------------
 * Why it sounded "like an angrez reading Hindi": the saved browser
 * voice was "Google UK English Male", and every reply — Hindi,
 * Hinglish or English — was read by that one English voice.
 *
 * Now, in order:
 *  1. Google AI Studio TTS (gemini-3.1-flash-tts-preview, then
 *     gemini-2.5-flash-preview-tts) whenever an AI Studio key is
 *     connected: one natural voice (default "Charon") that speaks
 *     Hindi, Hinglish and English properly. The first sentence is
 *     synthesised on its own so speech starts in about a second, and
 *     the next part is fetched while the first one plays.
 *  2. No key (or quota spent): the browser voices, chosen PER
 *     SENTENCE — Devanagari or Hinglish goes to the Hindi voice
 *     ("Google हिन्दी"), after Hinglish in Roman letters is
 *     transliterated to Devanagari (Google Input Tools), so it is
 *     pronounced like Hindi instead of spelled out in English; pure
 *     English goes to the English voice.
 *
 * API: ClavisVoice.speak(text, {signal}) -> Promise<boolean>
 *      ClavisVoice.stop(), .setVoice(name), .status()
 * localStorage: clavis_gemini_voice (voice name), clavis_voice_engine
 * ('auto' | 'browser'), clavis_voice_rate (browser rate, default 1).
 * ============================================================ */
(function () {
  'use strict';
  if (window.ClavisVoice) return;

  const API = 'https://generativelanguage.googleapis.com/v1beta/models/';
  const TTS_MODELS = ['gemini-3.1-flash-tts-preview', 'gemini-2.5-flash-preview-tts'];
  const VOICES = ['Charon', 'Iapetus', 'Orus', 'Sadaltager', 'Algieba', 'Schedar', 'Achird', 'Rasalgethi', 'Kore', 'Sulafat', 'Gacrux', 'Alnilam', 'Puck', 'Fenrir', 'Zephyr', 'Aoede', 'Leda', 'Despina', 'Erinome', 'Vindemiatrix', 'Umbriel', 'Callirrhoe', 'Autonoe', 'Enceladus', 'Algenib', 'Achernar', 'Laomedeia', 'Zubenelgenubi', 'Sadachbia', 'Pulcherrima'];
  const STYLE = 'Say this in a calm, warm, confident, natural voice, like a trusted personal assistant — unhurried, clear, never robotic';
  const DEVANAGARI = /[ऀ-ॿ]/;
  // Distinctly Hindi words only (no "to", "me", "the", "par" that English shares).
  const HI = new Set(('hai hain hoon hun tha thi kya kyu kyun kyon kaise kaisa kaisi kab kahan kaha kitna kitne kitni kuch koi aap aapka aapki aapke ' +
    'mera meri mere mujhe mujhse hum humein tum tumhe tera teri yeh woh wo nahi nahin haan ji karo karna karta karti karte karke raha rahi rahe ' +
    'gaya gayi gaye diya diye liya liye dekho dekhiye bolo boliye batao bataiye chahiye chaliye chalo abhi phir fir bhi toh lekin aur matlab ' +
    'accha acha achha theek thik bilkul zaroor zarur shukriya dhanyavaad namaste samajh sakta sakte sakti wala wali wale mein hoga hogi honge ' +
    'kijiye dijiye lijiye jaiye aaiye rakhiye suniye sir-ji thoda zyada jyada sab sabhi kaam din raat subah shaam kal aaj yahan wahan ' +
    'maine ki ka ke ko se di rakh rakha rakhi kar ho jo jab tab agar kyunki isliye unka uska iska inka wahi yahi kaun kis kisi kuchh bahut bohot ' +
    'sabse pehle baad saath tak hua hui hue karenge karunga dunga lunga raha gaye jaayega jayega chahte chahta dikha dikhao dikhaiye').split(/\s+/));

  const S = { gen: 0, ctx: null, player: null, drained: null, aborter: null, ttsModel: '', coolUntil: 0, lastError: '', translitCache: new Map() };

  /* ── keys / prefs ─────────────────────────────────────────── */
  function key() {
    try {
      const k = window.ClavisDirect?.keyFor?.('gemini') || (window.ClavisKeyVault?.all?.('gemini') || [])[0] || '';
      return /^AIza\S{10,}$/.test(k) ? k : '';
    } catch (_) { return ''; }
  }
  const voiceName = () => {
    const v = localStorage.getItem('clavis_gemini_voice') || 'Charon';
    return VOICES.includes(v) ? v : 'Charon';
  };
  const engine = () => localStorage.getItem('clavis_voice_engine') || 'auto';

  /* ── text shaping ─────────────────────────────────────────── */
  function sentences(text) {
    return (String(text || '').match(/[^.!?।]+[.!?।]*\s*/g) || [String(text || '')]).map((s) => s.trim()).filter(Boolean);
  }
  // First chunk = first sentence (fast start); then chunks of ~260 chars.
  function chunks(text) {
    const out = [];
    let cur = '';
    for (const s of sentences(text)) {
      if (!out.length && !cur) { out.push(s); continue; }
      if (cur && (cur + ' ' + s).length > 260) { out.push(cur); cur = s; }
      else cur = cur ? cur + ' ' + s : s;
    }
    if (cur) out.push(cur);
    return out;
  }
  function langOf(sentence) {
    if (DEVANAGARI.test(sentence)) return 'hi';
    const words = sentence.toLowerCase().match(/[a-z]+/g) || [];
    if (!words.length) return 'en';
    const hits = words.filter((w) => HI.has(w)).length;
    return hits / words.length >= 0.18 || hits >= 3 ? 'hinglish' : 'en';
  }

  /* ── audio out (24 kHz PCM, same worklet as the live voice) ── */
  // Chrome keeps an AudioContext suspended until the first click/key, and
  // resume() then just waits — so give up after a moment and let the
  // browser voice speak instead of going silent.
  async function wake() {
    if (S.ctx.state !== 'running') await Promise.race([S.ctx.resume(), new Promise((r) => setTimeout(r, 400))]);
    if (S.ctx.state !== 'running') throw new Error('Audio is locked until the first click on the page');
  }
  async function ensureAudio() {
    if (S.ctx && S.ctx.state !== 'closed') return wake();
    S.ctx = new AudioContext({ sampleRate: 24000, latencyHint: 'interactive' });
    await S.ctx.audioWorklet.addModule('clavis-pcm-player-worklet.js?v=3');
    S.player = new AudioWorkletNode(S.ctx, 'clavis-pcm-player', { outputChannelCount: [1] });
    S.player.connect(S.ctx.destination);
    S.player.port.onmessage = (e) => { if (e.data?.type === 'drained' && S.drained) { const r = S.drained; S.drained = null; r(); } };
    return wake();
  }
  function b64ToBuffer(b64) {
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out.buffer;
  }
  function play(buffer) {
    if (!S.player || !buffer || !buffer.byteLength) return Promise.resolve();
    const ms = (buffer.byteLength / 2 / 24000) * 1000 + 1500;   // safety net if "drained" never arrives
    return new Promise((resolve) => {
      const t = setTimeout(() => { if (S.drained === done) S.drained = null; resolve(); }, ms);
      const done = () => { clearTimeout(t); resolve(); };
      S.drained = done;
      S.player.port.postMessage({ type: 'chunk', audio: buffer }, [buffer]);
    });
  }

  /* ── Google AI Studio TTS ─────────────────────────────────── */
  async function synth(text, k, signal) {
    const models = S.ttsModel ? [S.ttsModel, ...TTS_MODELS.filter((m) => m !== S.ttsModel)] : (localStorage.getItem('clavis_tts_model') ? [localStorage.getItem('clavis_tts_model'), ...TTS_MODELS] : TTS_MODELS);
    let lastErr;
    for (const model of [...new Set(models)]) {
      const res = await fetch(`${API}${model}:generateContent?key=${encodeURIComponent(k)}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, signal,
        body: JSON.stringify({
          contents: [{ parts: [{ text: `${STYLE}: ${text}` }] }],
          generationConfig: { responseModalities: ['AUDIO'], speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: voiceName() } } } },
        }),
      });
      if (res.ok) {
        const data = await res.json();
        const part = (data.candidates?.[0]?.content?.parts || []).find((p) => p.inlineData?.data);
        if (!part) { lastErr = new Error('No audio in the reply'); continue; }
        S.ttsModel = model;
        try { localStorage.setItem('clavis_tts_model', model); } catch (_) {}
        return b64ToBuffer(part.inlineData.data);
      }
      const body = await res.json().catch(() => ({}));
      lastErr = Object.assign(new Error(body?.error?.message || `TTS ${res.status}`), { status: res.status });
      if (res.status === 429 || res.status === 401 || res.status === 403) break;   // quota / bad key: no point trying other models
    }
    throw lastErr || new Error('TTS failed');
  }

  async function speakGemini(parts, id, signal, progress) {
    const k = key();
    await ensureAudio();
    let pending = synth(parts[0], k, signal);
    for (let i = 0; i < parts.length; i++) {
      progress.i = i;
      const pcm = await pending;
      if (id !== S.gen) return false;
      if (i + 1 < parts.length) { pending = synth(parts[i + 1], k, signal); pending.catch(() => {}); }   // fetch ahead while this plays
      await play(pcm);
      if (id !== S.gen) return false;
    }
    return true;
  }

  /* ── browser voices, chosen per sentence ──────────────────── */
  function pickVoice(lang) {
    const voices = window.speechSynthesis?.getVoices?.() || [];
    if (lang === 'hi') {
      return voices.find((v) => /hi[-_]IN/i.test(v.lang) && /google/i.test(v.name))
        || voices.find((v) => /hi[-_]IN/i.test(v.lang) && /natural|online|madhur|swara/i.test(v.name))
        || voices.find((v) => /^hi/i.test(v.lang)) || null;
    }
    const saved = localStorage.getItem('jarvis_voice_name');
    const savedVoice = saved && voices.find((v) => v.name === saved && /^en/i.test(v.lang));
    return savedVoice
      || voices.find((v) => /en[-_]IN/i.test(v.lang) && /natural|online|google|prabhat|ravi/i.test(v.name))
      || voices.find((v) => /Google UK English Male/i.test(v.name))
      || voices.find((v) => /^en/i.test(v.lang) && /natural|online/i.test(v.name))
      || voices.find((v) => /^en/i.test(v.lang)) || null;
  }
  async function toDevanagari(sentence) {
    const cached = S.translitCache.get(sentence);
    if (cached) return cached;
    try {
      const url = `https://inputtools.google.com/request?text=${encodeURIComponent(sentence)}&itc=hi-t-i0-und&num=1&cp=0&cs=1&ie=utf-8&oe=utf-8`;
      const ctl = new AbortController();
      const t = setTimeout(() => ctl.abort(), 1800);
      const data = await fetch(url, { signal: ctl.signal }).then((r) => r.json()).finally(() => clearTimeout(t));
      const out = (data?.[1] || []).map((seg) => seg?.[1]?.[0] || seg?.[0] || '').join(' ').trim();
      if (data?.[0] === 'SUCCESS' && out) { S.translitCache.set(sentence, out); return out; }
    } catch (_) {}
    return sentence;
  }
  function utter(text, voice, lang) {
    return new Promise((resolve) => {
      const u = new SpeechSynthesisUtterance(text);
      if (voice) u.voice = voice;
      u.lang = voice?.lang || (lang === 'hi' ? 'hi-IN' : 'en-IN');
      u.rate = Math.max(0.8, Math.min(1.2, Number(localStorage.getItem('clavis_voice_rate')) || (lang === 'hi' ? 0.98 : 1)));
      u.pitch = lang === 'hi' ? 1 : 0.96;
      u.onend = () => resolve(true);
      u.onerror = () => resolve(false);
      try { window.speechSynthesis.resume?.(); window.speechSynthesis.speak(u); } catch (_) { resolve(false); }
    });
  }
  async function speakBrowser(text, id) {
    if (!window.speechSynthesis || typeof SpeechSynthesisUtterance === 'undefined') return false;
    if (!(window.speechSynthesis.getVoices() || []).length) {
      await new Promise((r) => { window.speechSynthesis.onvoiceschanged = r; setTimeout(r, 900); });
    }
    try { window.speechSynthesis.cancel(); } catch (_) {}
    const list = sentences(text).map((s) => ({ s, lang: langOf(s) }));
    // Transliterate all Hinglish sentences in parallel before the first word is spoken.
    const ready = list.map((x) => (x.lang === 'hinglish' ? toDevanagari(x.s).then((d) => ({ s: d, lang: 'hi' })) : Promise.resolve({ s: x.s, lang: x.lang })));
    for (const p of ready) {
      const { s, lang } = await p;
      if (id !== S.gen) return false;
      await utter(s, pickVoice(lang), lang);
      if (id !== S.gen) return false;
    }
    return true;
  }

  /* ── public ───────────────────────────────────────────────── */
  async function speak(text, opts = {}) {
    const clean = String(text || '').trim();
    if (!clean) return false;
    stop();
    const id = ++S.gen;
    S.aborter = new AbortController();
    opts.signal?.addEventListener?.('abort', () => { if (id === S.gen) stop(); }, { once: true });
    let rest = clean;
    if (key() && engine() !== 'browser' && Date.now() > S.coolUntil) {
      const parts = chunks(clean);
      const progress = { i: 0 };
      try {
        const done = await speakGemini(parts, id, S.aborter.signal, progress);
        S.lastError = '';
        return done && id === S.gen;
      } catch (e) {
        if (id !== S.gen) return false;   // stopped on purpose (every stop bumps gen)
        S.lastError = e?.message || String(e);
        console.warn('[ClavisVoice] Google TTS unavailable, using browser voice:', S.lastError);
        if (e?.status === 429) S.coolUntil = Date.now() + 60000;   // quota: rest a minute
        if (e?.status === 401 || e?.status === 403 || e?.status === 400) S.coolUntil = Date.now() + 10 * 60000;
        rest = parts.slice(progress.i).join(' ');   // never repeat what was already said
      }
    }
    return speakBrowser(rest, id);
  }

  function stop() {
    S.gen++;
    try { S.aborter?.abort(); } catch (_) {}
    try { S.player?.port.postMessage({ type: 'stop' }); } catch (_) {}
    if (S.drained) { const r = S.drained; S.drained = null; r(); }
    try { window.speechSynthesis?.cancel(); } catch (_) {}
  }

  window.ClavisVoice = {
    speak, stop,
    setVoice(name) { if (VOICES.includes(name)) { localStorage.setItem('clavis_gemini_voice', name); return true; } return false; },
    voices: () => VOICES.slice(),
    status: () => ({ engine: key() && engine() !== 'browser' ? 'google-tts' : 'browser', model: S.ttsModel || null, voice: voiceName(), coolingFor: Math.max(0, S.coolUntil - Date.now()), lastError: S.lastError }),
    _selfTest() {
      const ok = [
        langOf('Aap kaise hain sir, sab theek hai?') === 'hinglish',
        langOf('The report is ready, sir.') === 'en',
        langOf('आप कैसे हैं') === 'hi',
        langOf('Maine leads ki list screen par rakh di hai.') === 'hinglish',
        chunks('One. Two is here. Three.').length === 2 && chunks('One. Two is here. Three.')[0] === 'One.',
        sentences('Hello sir. आप कैसे हैं? Fine!').length === 3,
      ];
      const passed = ok.filter(Boolean).length;
      console[passed === ok.length ? 'log' : 'error'](`ClavisVoice self-test: ${passed}/${ok.length}`);
      return passed === ok.length;
    },
  };
})();
