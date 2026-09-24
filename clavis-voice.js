/* ============================================================
 * clavis-voice.js · how Clavis sounds when it speaks a reply
 * ------------------------------------------------------------
 * Sir's rule: a FEMALE voice first, speaking Hindi AND English, with
 * feeling. Only when her quota runs out (or she can't say it
 * properly) does the MALE voice step in — and he must speak Hindi too.
 *
 * In order:
 *  1. Google AI Studio TTS, female voice (default "Kore"), every
 *     connected AI Studio key × both TTS models (each model has its
 *     own free quota, so a 429 on one is not the end). One natural
 *     voice for Hindi, Hinglish and English. The first sentence is
 *     synthesised on its own so speech starts in about a second, and
 *     the next part is fetched while the first one plays. The style
 *     line follows the moment: warm when he's happy, calm and steady
 *     when he's stressed, gentle when he's low (ClavisEmotionalEngine).
 *  2. Same TTS, male voice ("Charon") — when she failed on the text
 *     itself (no audio back, a server error), not on quota.
 *  3. The local backend voice (its own key and quota) in the male voice.
 *  4. Browser voices, male first, chosen PER SENTENCE: a Hindi male
 *     voice (Madhur / Hemant) for Hindi and Hinglish (transliterated to
 *     Devanagari so it's pronounced as Hindi), an Indian-English male
 *     voice for English. If the PC has no Hindi male voice, Hindi goes
 *     to the Hindi voice it does have — correct Hindi beats the gender.
 *
 * API: ClavisVoice.speak(text, {signal}) -> Promise<boolean>
 *      ClavisVoice.stop(), .setVoice(name), .status(), .isSpeaking(),
 *      .outputLevel() (RMS of what is playing — barge-in uses it),
 *      .primaryVoice(), .fallbackVoice(), .genderOf(name)
 * localStorage: clavis_gemini_voice (primary voice), clavis_voice_male
 * (fallback voice), clavis_voice_engine ('auto' | 'browser'),
 * clavis_voice_rate (browser rate, default 1).
 * ============================================================ */
(function () {
  'use strict';
  if (window.ClavisVoice) return;

  const API = 'https://generativelanguage.googleapis.com/v1beta/models/';
  const TTS_MODELS = ['gemini-3.1-flash-tts-preview', 'gemini-2.5-flash-preview-tts'];
  const FEMALE = ['Kore', 'Sulafat', 'Aoede', 'Leda', 'Zephyr', 'Despina', 'Achernar', 'Callirrhoe', 'Autonoe', 'Erinome', 'Laomedeia', 'Gacrux', 'Pulcherrima', 'Vindemiatrix'];
  const MALE = ['Charon', 'Orus', 'Iapetus', 'Puck', 'Fenrir', 'Algieba', 'Schedar', 'Achird', 'Rasalgethi', 'Sadaltager', 'Alnilam', 'Enceladus', 'Umbriel', 'Algenib', 'Zubenelgenubi', 'Sadachbia'];
  const VOICES = [...FEMALE, ...MALE];
  const DEFAULT_FEMALE = 'Kore', DEFAULT_MALE = 'Charon';
  const DEVANAGARI = /[ऀ-ॿ]/;
  // Distinctly Hindi words only (no "to", "me", "the", "par" that English shares).
  const HI = new Set(('hai hain hoon hun tha thi kya kyu kyun kyon kaise kaisa kaisi kab kahan kaha kitna kitne kitni kuch koi aap aapka aapki aapke ' +
    'mera meri mere mujhe mujhse hum humein tum tumhe tera teri yeh woh wo nahi nahin haan ji karo karna karta karti karte karke raha rahi rahe ' +
    'gaya gayi gaye diya diye liya liye dekho dekhiye bolo boliye batao bataiye chahiye chaliye chalo abhi phir fir bhi toh lekin aur matlab ' +
    'accha acha achha theek thik bilkul zaroor zarur shukriya dhanyavaad namaste samajh sakta sakte sakti wala wali wale mein hoga hogi honge ' +
    'kijiye dijiye lijiye jaiye aaiye rakhiye suniye sir-ji thoda zyada jyada sab sabhi kaam din raat subah shaam kal aaj yahan wahan ' +
    'maine ki ka ke ko se di rakh rakha rakhi kar ho jo jab tab agar kyunki isliye unka uska iska inka wahi yahi kaun kis kisi kuchh bahut bohot ' +
    'sabse pehle baad saath tak hua hui hue karenge karunga dunga lunga raha gaye jaayega jayega chahte chahta dikha dikhao dikhaiye').split(/\s+/));

  const S = {
    gen: 0, ctx: null, player: null, analyser: null, lvlBuf: null, drained: null, aborter: null,
    ttsModel: '', rest: new Map(), lastError: '', lastVoice: '', lastEngine: '', translitCache: new Map(), speaking: false,
  };

  /* ── voices / prefs ───────────────────────────────────────── */
  // One-time move to the female-first voice sir asked for. The old
  // default "Charon" becomes the male fallback, not the first voice.
  (function migrate() {
    try {
      if (localStorage.getItem('clavis_voice_v2') === '1') return;
      const saved = localStorage.getItem('clavis_gemini_voice');
      if (saved && MALE.includes(saved)) localStorage.setItem('clavis_voice_male', saved);
      if (!saved || MALE.includes(saved)) localStorage.setItem('clavis_gemini_voice', DEFAULT_FEMALE);
      localStorage.setItem('clavis_voice_v2', '1');
    } catch (_) {}
  })();
  const genderOf = (v) => (FEMALE.includes(v) ? 'female' : MALE.includes(v) ? 'male' : '');
  function primaryVoice() {
    const v = localStorage.getItem('clavis_gemini_voice') || DEFAULT_FEMALE;
    return VOICES.includes(v) ? v : DEFAULT_FEMALE;
  }
  function fallbackVoice() {
    const p = primaryVoice();
    const m = localStorage.getItem('clavis_voice_male');
    if (genderOf(p) === 'male') return p;
    return MALE.includes(m) ? m : DEFAULT_MALE;
  }
  const engine = () => localStorage.getItem('clavis_voice_engine') || 'auto';

  /* ── keys (every connected AI Studio key, rested ones skipped) ── */
  function keys() {
    const out = [];
    try { const k = window.ClavisDirect?.keyFor?.('gemini'); if (k) out.push(k); } catch (_) {}
    try { (window.ClavisKeyVault?.all?.('gemini') || []).forEach((k) => out.push(k)); } catch (_) {}
    return [...new Set(out.filter((k) => /^AIza\S{10,}$/.test(String(k || ''))))];
  }
  const restKey = (k, m) => `${String(k).slice(-6)}|${m || '*'}`;
  const resting = (k, m) => (S.rest.get(restKey(k, m)) || 0) > Date.now() || (S.rest.get(restKey(k)) || 0) > Date.now();
  const rest = (k, m, ms) => S.rest.set(restKey(k, m), Date.now() + ms);
  function anyGemini() { return keys().some((k) => !resting(k) && TTS_MODELS.some((m) => !resting(k, m))); }

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

  /* ── first-person Hindi follows the voice's gender ────────── */
  // App lines were written for a male assistant ("khol raha hoon", "bata
  // dunga"). Said by her voice that sounds wrong, and the reverse when he
  // takes over — so only first-person forms (…a/…i hoon, …unga/…ungi) are
  // flipped, right before speaking. Nothing about other people changes.
  function genderize(text, gender) {
    const f = gender === 'female';
    let t = String(text || '');
    t = t.replace(/\b(rah|gay|chuk|aay|sakt|chaht|[a-z]{2,}t)(a|i)(\s+(?:hoon|hun|hu|hoo)\b)/gi, (m, stem, v, tail) => stem + (f ? 'i' : 'a') + tail);
    t = t.replace(/\b([a-z]{1,12}?(?:u|oo))ng(a|i)\b/gi, (m, stem) => stem + 'ng' + (f ? 'i' : 'a'));
    t = t.replace(/(^|[\s,(])(गया|गई|गयी)(\s+हू[ँं])/g, (m, pre, w, tail) => pre + (f ? 'गई' : 'गया') + tail);
    t = t.replace(/(रह|चुक|सकत|चाहत|[ऀ-ॿ]{1,6}त)(ा|ी)(\s+हू[ँं])/g, (m, stem, v, tail) => stem + (f ? 'ी' : 'ा') + tail);
    t = t.replace(/(ू[ँं]|ऊ[ँं])(गा|गी)/g, (m, nas) => nas + (f ? 'गी' : 'गा'));
    return t;
  }

  /* ── feeling → speaking style ─────────────────────────────── */
  // The TTS model takes a short natural-language direction before the
  // text ("Say warmly: …"). It follows sir's mood first, then the reply's.
  function styleFor(text) {
    const E = window.ClavisEmotionalEngine;
    let user = 'neutral', reply = 'composed';
    try { user = E?.inferUserEmotion?.(window.__clavisLastUserText || '')?.name || 'neutral'; } catch (_) {}
    try { reply = E?.speechProsody?.(text)?.name || 'composed'; } catch (_) {}
    const byUser = {
      frustrated: 'calm, steady and genuinely empathetic, like someone quietly taking the problem off his hands',
      anxious: 'calm, reassuring and grounded, unhurried',
      sad: 'soft, gentle and caring, a little slower',
      excited: 'bright and warm, sharing his excitement with a smile in the voice',
      happy: 'warm and cheerful, with a smile in the voice',
      grateful: 'warm and gracious',
      curious: 'warm and engaged, lightly curious',
    };
    const byReply = {
      bright: 'warm and upbeat, with a smile in the voice',
      reassuring: 'gentle and reassuring',
      alert: 'calm but clearly serious and attentive',
      curious: 'warm and inquisitive',
      thoughtful: 'thoughtful and unhurried',
      composed: 'calm, warm and confident',
    };
    const mood = byUser[user] || byReply[reply] || byReply.composed;
    const lang = langOf(text);
    const accent = lang === 'en'
      ? 'natural Indian English'
      : 'natural conversational Hindi the way an educated Delhi professional speaks it — Hindi words with a native Hindi accent, English words (leads, email, website) in natural English';
    return `Speak as a trusted personal assistant, ${mood}; ${accent}; human rhythm with natural pauses, never robotic. Say`;
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
    // Metered output: barge-in compares the mic with what is playing NOW.
    S.analyser = S.ctx.createAnalyser();
    S.analyser.fftSize = 512;
    S.lvlBuf = new Float32Array(S.analyser.fftSize);
    S.player.connect(S.analyser).connect(S.ctx.destination);
    S.player.port.onmessage = (e) => { if (e.data?.type === 'drained' && S.drained) { const r = S.drained; S.drained = null; r(); } };
    return wake();
  }
  function outputLevel() {
    if (!S.speaking || !S.analyser || S.lastEngine !== 'google-tts') return null;
    S.analyser.getFloatTimeDomainData(S.lvlBuf);
    let s = 0;
    for (let i = 0; i < S.lvlBuf.length; i++) s += S.lvlBuf[i] * S.lvlBuf[i];
    return Math.sqrt(s / S.lvlBuf.length);
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
  async function synthOnce(text, k, model, voice, signal) {
    const res = await fetch(`${API}${model}:generateContent?key=${encodeURIComponent(k)}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, signal,
      body: JSON.stringify({
        contents: [{ parts: [{ text: `${styleFor(text)}: ${genderize(text, genderOf(voice) || 'female')}` }] }],
        generationConfig: { responseModalities: ['AUDIO'], speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } } } },
      }),
    });
    if (res.ok) {
      const data = await res.json();
      const part = (data.candidates?.[0]?.content?.parts || []).find((p) => p.inlineData?.data);
      if (!part) throw Object.assign(new Error('No audio in the reply'), { status: 0, kind: 'content' });
      return b64ToBuffer(part.inlineData.data);
    }
    const body = await res.json().catch(() => ({}));
    const kind = res.status === 429 ? 'quota' : (res.status === 401 || res.status === 403) ? 'key' : res.status === 404 ? 'model' : res.status >= 500 ? 'server' : 'content';
    throw Object.assign(new Error(body?.error?.message || `TTS ${res.status}`), { status: res.status, kind });
  }
  // Every key × model for one voice. Quota/auth failures rest that key
  // (or key+model) so the next sentence doesn't hit the same wall.
  async function synth(text, voice, signal) {
    const order = S.ttsModel ? [S.ttsModel, ...TTS_MODELS.filter((m) => m !== S.ttsModel)] : TTS_MODELS;
    let lastErr, contentErr = false;
    for (const k of keys()) {
      if (resting(k)) continue;
      for (const model of order) {
        if (resting(k, model)) continue;
        try {
          const pcm = await synthOnce(text, k, model, voice, signal);
          S.ttsModel = model;
          return pcm;
        } catch (e) {
          if (e?.name === 'AbortError') throw e;
          lastErr = e;
          if (e.kind === 'quota') rest(k, model, 60000);
          else if (e.kind === 'key') { rest(k, null, 10 * 60000); break; }
          else if (e.kind === 'model') rest(k, model, 30 * 60000);
          else contentErr = true;
        }
      }
    }
    throw Object.assign(lastErr || new Error('TTS failed'), { contentErr });
  }

  async function speakGemini(parts, id, signal, progress, voice) {
    await ensureAudio();
    let pending = synth(parts[progress.i], voice, signal);
    for (let i = progress.i; i < parts.length; i++) {
      progress.i = i;
      const pcm = await pending;
      if (id !== S.gen) return false;
      if (i + 1 < parts.length) { pending = synth(parts[i + 1], voice, signal); pending.catch(() => {}); }   // fetch ahead while this plays
      S.lastEngine = 'google-tts';
      S.lastVoice = voice;
      await play(pcm);
      if (id !== S.gen) return false;
    }
    return true;
  }

  /* ── backend voice (own key + quota), male ────────────────── */
  async function speakBackend(text, id, signal) {
    const L = window.LocalSpeechEngine;
    if (!L?.speak || L.isBackendUnavailable?.()) return false;
    try {
      S.lastEngine = 'backend';
      S.lastVoice = fallbackVoice();
      await L.speak(genderize(text, genderOf(fallbackVoice()) || 'male'), { signal, voice: fallbackVoice() });
      return id === S.gen;
    } catch (_) { return false; }
  }

  /* ── browser voices, male first, chosen per sentence ──────── */
  const MALE_NAME = /\b(male|madhur|hemant|prabhat|ravi|rishi|david|mark|guy|ryan|christopher|eric|andrew|brian|george|daniel|james|thomas)\b/i;
  const FEMALE_NAME = /\b(female|swara|kalpana|heera|neerja|zira|aria|jenny|sonia|libby|hazel|susan|samantha|victoria|karen|moira|tessa|veena|lekha)\b/i;
  function pickVoice(lang, gender = 'male') {
    const voices = window.speechSynthesis?.getVoices?.() || [];
    const isHi = (v) => /^hi/i.test(v.lang);
    const want = (v) => (gender === 'male' ? MALE_NAME.test(v.name) && !FEMALE_NAME.test(v.name) : !MALE_NAME.test(v.name));
    if (lang === 'hi') {
      return voices.find((v) => isHi(v) && want(v) && /natural|online/i.test(v.name))
        || voices.find((v) => isHi(v) && want(v))
        || voices.find((v) => isHi(v) && /google/i.test(v.name))
        || voices.find((v) => isHi(v) && /natural|online|madhur|swara/i.test(v.name))
        || voices.find(isHi) || null;
    }
    const saved = localStorage.getItem('jarvis_voice_name');
    const savedVoice = saved && voices.find((v) => v.name === saved && /^en/i.test(v.lang) && (gender === 'male' ? !FEMALE_NAME.test(v.name) : !MALE_NAME.test(v.name)));
    return savedVoice
      || voices.find((v) => /en[-_]IN/i.test(v.lang) && want(v) && /natural|online/i.test(v.name))
      || voices.find((v) => /en[-_]IN/i.test(v.lang) && want(v))
      || (gender === 'male' ? voices.find((v) => /Google UK English Male/i.test(v.name)) : null)
      || voices.find((v) => /^en/i.test(v.lang) && want(v) && /natural|online/i.test(v.name))
      || voices.find((v) => /^en/i.test(v.lang) && want(v))
      || voices.find((v) => /^en/i.test(v.lang)) || null;
  }
  const hasHindiMale = () => (window.speechSynthesis?.getVoices?.() || []).some((v) => /^hi/i.test(v.lang) && MALE_NAME.test(v.name) && !FEMALE_NAME.test(v.name));
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
      let prosody = null;
      try { prosody = window.ClavisEmotionalEngine?.speechProsody?.(text); } catch (_) {}
      const base = Number(localStorage.getItem('clavis_voice_rate')) || (lang === 'hi' ? 0.98 : 1);
      u.rate = Math.max(0.8, Math.min(1.2, base * (prosody?.rateMultiplier || 1)));
      u.pitch = Math.max(0.8, Math.min(1.2, (lang === 'hi' ? 1 : 0.96) * (prosody?.pitchMultiplier || 1)));
      u.onend = () => resolve(true);
      u.onerror = () => resolve(false);
      try { window.speechSynthesis.resume?.(); window.speechSynthesis.speak(u); } catch (_) { resolve(false); }
    });
  }
  // ONE voice for the whole reply. Picking per sentence gave a male
  // English voice for English lines and the female Hindi voice for Hindi
  // lines — two people talking in turn, and Hinglish read with an English
  // accent. Now: any Hindi in the reply → a real Hindi voice for all of it
  // (Chrome's is female, so the browser fallback stays female); pure
  // English → one English voice.
  async function speakBrowser(text, id) {
    if (!window.speechSynthesis || typeof SpeechSynthesisUtterance === 'undefined') return false;
    if (!(window.speechSynthesis.getVoices() || []).length) {
      await new Promise((r) => { window.speechSynthesis.onvoiceschanged = r; setTimeout(r, 900); });
    }
    try { window.speechSynthesis.cancel(); } catch (_) {}
    S.lastEngine = 'browser';
    const hindiReply = sentences(text).some((x) => langOf(x) !== 'en');
    const want = genderOf(primaryVoice()) || 'female';
    // A male Hindi voice only if this PC really has one (Edge: Madhur).
    const gender = hindiReply && want === 'male' && !hasHindiMale() ? 'female' : want;
    const lang = hindiReply ? 'hi' : 'en';
    const voice = pickVoice(lang, gender);
    S.lastVoice = voice?.name || '';
    const list = sentences(genderize(text, gender));
    const ready = list.map((x) => (lang === 'hi' && langOf(x) === 'hinglish' ? toDevanagari(x) : Promise.resolve(x)));
    for (const p of ready) {
      const line = await p;
      if (id !== S.gen) return false;
      await utter(line, voice, lang);
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
    S.speaking = true;
    opts.signal?.addEventListener?.('abort', () => { if (id === S.gen) stop(); }, { once: true });
    try {
      const parts = chunks(clean);
      const progress = { i: 0 };
      const remaining = () => parts.slice(progress.i).join(' ');   // never repeat what was already said
      if (engine() !== 'browser' && anyGemini()) {
        const first = VOICES.includes(opts.voice) ? opts.voice : primaryVoice();
        try {
          const done = await speakGemini(parts, id, S.aborter.signal, progress, first);
          S.lastError = '';
          return done && id === S.gen;
        } catch (e) {
          if (id !== S.gen) return false;   // stopped on purpose (every stop bumps gen)
          S.lastError = e?.message || String(e);
          console.warn(`[ClavisVoice] ${first} unavailable (${S.lastError}) — handing over to the male voice.`);
          // She failed on the text itself (not quota): he tries the same TTS —
          // but only before a word was said, never swapping voices mid-reply.
          const male = fallbackVoice();
          if (e?.contentErr && progress.i === 0 && male !== first && anyGemini()) {
            try {
              const done = await speakGemini(parts, id, S.aborter.signal, progress, male);
              return done && id === S.gen;
            } catch (e2) { if (id !== S.gen) return false; S.lastError = e2?.message || String(e2); }
          }
        }
      }
      // The male backend voice takes a reply from its start only; a reply
      // that already began in her voice is finished by the browser voice.
      if (progress.i === 0 && engine() !== 'browser' && await speakBackend(remaining(), id, S.aborter.signal)) return true;
      if (id !== S.gen) return false;
      return await speakBrowser(remaining(), id);
    } finally {
      if (id === S.gen) S.speaking = false;
    }
  }

  function stop() {
    S.gen++;
    S.speaking = false;
    try { S.aborter?.abort(); } catch (_) {}
    try { S.player?.port.postMessage({ type: 'stop' }); } catch (_) {}
    if (S.drained) { const r = S.drained; S.drained = null; r(); }
    try { window.speechSynthesis?.cancel(); } catch (_) {}
  }

  /* ── Settings: every AI Studio voice, female + male, with preview ── */
  const TRAITS = { Zephyr: 'bright', Puck: 'upbeat', Charon: 'informative, Jarvis-like', Kore: 'firm, clear', Fenrir: 'excitable', Leda: 'youthful', Orus: 'firm', Aoede: 'breezy', Callirrhoe: 'easy-going', Autonoe: 'bright', Enceladus: 'breathy', Iapetus: 'clear', Umbriel: 'easy-going', Algieba: 'smooth', Despina: 'smooth', Erinome: 'clear', Algenib: 'gravelly', Rasalgethi: 'informative', Laomedeia: 'upbeat', Achernar: 'soft', Alnilam: 'firm', Schedar: 'even', Gacrux: 'mature', Pulcherrima: 'forward', Achird: 'friendly', Zubenelgenubi: 'casual', Vindemiatrix: 'gentle', Sadachbia: 'lively', Sadaltager: 'knowledgeable', Sulafat: 'warm' };
  const opt = (v) => `<option value="${v}">${v} · ${TRAITS[v] || ''}</option>`;
  function mountPickers() {
    ['sm-gemini-voice', 'clavis-gemini-voice'].forEach((id) => {
      const sel = document.getElementById(id);
      if (!sel || sel.dataset.full) return;
      sel.dataset.full = '1';
      sel.innerHTML = `<optgroup label="Female · Hindi + English (speaks first)">${FEMALE.map(opt).join('')}</optgroup><optgroup label="Male · Hindi + English">${MALE.map(opt).join('')}</optgroup>`;
      sel.value = primaryVoice();
      sel.addEventListener('change', () => window.ClavisVoice.setVoice(sel.value));
      if (id !== 'sm-gemini-voice') return;
      const row = sel.closest('.smodal-field');
      mountKeyRow(row);
      if (!row || document.getElementById('sm-gemini-voice-male')) return;
      const male = document.createElement('div');
      male.className = 'smodal-field';
      male.innerHTML = `<div class="smodal-field-left"><label class="smodal-label" for="sm-gemini-voice-male">Male voice</label><span class="smodal-hint">Takes over only when her quota runs out — same Hindi + English.</span></div>
        <div style="display:flex;gap:8px;align-items:center"><select id="sm-gemini-voice-male" class="smodal-select">${MALE.map(opt).join('')}</select><button type="button" class="smodal-btn-primary" id="sm-voice-preview" title="Hear the selected voices">▶ Preview</button></div>`;
      row.after(male);
      const ms = male.querySelector('select');
      ms.value = fallbackVoice();
      ms.addEventListener('change', () => window.ClavisVoice.setFallbackVoice(ms.value));
      male.querySelector('#sm-voice-preview').addEventListener('click', async () => {
        const f = sel.value, m = ms.value;
        await speak('Namaste sir, main Clavis hoon. Aapki leads, map aur PC — sab sambhal loongi.', { voice: f });
        if (genderOf(f) !== 'male') await speak('Aur main male voice hoon — jab zaroorat ho, main sambhal lunga.', { voice: m });
      });
    });
  }
  // A plain, visible place to paste the Google AI Studio key — the only
  // other way in was a dialog that appeared when something else failed.
  function mountKeyRow(voiceRow) {
    if (!voiceRow || document.getElementById('sm-gemini-key')) return;
    const box = document.createElement('div');
    box.className = 'smodal-field';
    const has = keys().length > 0;
    box.innerHTML = `<div class="smodal-field-left"><label class="smodal-label" for="sm-gemini-key">Google AI Studio key</label>
      <span class="smodal-hint" id="sm-gemini-key-hint">${has ? 'Connected — Clavis speaks with Google voices.' : 'Free key → natural Hindi + English voices and live talk. <a href="https://aistudio.google.com/app/apikey" target="_blank" rel="noopener">Get a key ↗</a>'}</span></div>
      <div style="display:flex;gap:8px;align-items:center"><input id="sm-gemini-key" type="password" autocomplete="off" spellcheck="false" placeholder="${has ? '•••••• connected — paste to add another' : 'AIza…'}" style="width:220px;padding:8px 10px;border-radius:10px;border:1px solid rgba(127,127,127,.3);background:transparent;color:inherit;font:inherit">
      <button type="button" class="smodal-btn-primary" id="sm-gemini-key-save">Save &amp; test</button></div>`;
    voiceRow.before(box);
    const input = box.querySelector('#sm-gemini-key');
    const hint = box.querySelector('#sm-gemini-key-hint');
    box.querySelector('#sm-gemini-key-save').addEventListener('click', async (ev) => {
      const btn = ev.currentTarget;
      const k = String(input.value || '').trim();
      if (!/^AIza\S{20,}$/.test(k)) { hint.textContent = 'Yeh Google AI Studio key nahi lagti — "AIza…" se shuru hoti hai.'; return; }
      btn.disabled = true; hint.textContent = 'Check kar raha hoon…';
      const prevBrain = localStorage.getItem('clavis_ai_provider');
      try {
        if (window.ClavisKeyVault?.add) await window.ClavisKeyVault.add('gemini', k);
        else window.ClavisDirect?.setKey?.('gemini', k);
        // A voice key must not quietly replace the chat brain he chose.
        if (prevBrain && prevBrain !== 'gemini') localStorage.setItem('clavis_ai_provider', prevBrain);
        S.rest.clear();
        input.value = '';
        hint.textContent = 'Key saved — test awaaz chal rahi hai…';
        const ok = await speak('Namaste sir, main Clavis hoon. Ab main Google ki awaaz me Hindi aur English dono bolti hoon.');
        const st = window.ClavisVoice.status();
        hint.textContent = st.engine === 'google-tts' && ok
          ? `Connected ✓ — ${st.lastVoice} bol rahi hai (${st.model}).`
          : `Key saved, lekin Google voice abhi nahi chali: ${st.lastError || 'quota/limit'} — browser voice chal rahi hai.`;
      } catch (err) {
        hint.textContent = 'Key save nahi hui: ' + (err?.message || err);
      } finally { btn.disabled = false; }
    });
  }

  document.addEventListener('click', () => setTimeout(mountPickers, 80), { passive: true });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mountPickers, { once: true }); else setTimeout(mountPickers, 0);

  window.ClavisVoice = {
    speak, stop, outputLevel, primaryVoice, fallbackVoice, genderOf, genderize,
    isSpeaking: () => S.speaking,
    setVoice(name) {
      if (!VOICES.includes(name)) return false;
      localStorage.setItem('clavis_gemini_voice', name);
      if (genderOf(name) === 'male') localStorage.setItem('clavis_voice_male', name);
      return true;
    },
    setFallbackVoice(name) { if (MALE.includes(name)) { localStorage.setItem('clavis_voice_male', name); return true; } return false; },
    voices: () => VOICES.slice(),
    femaleVoices: () => FEMALE.slice(),
    maleVoices: () => MALE.slice(),
    status: () => ({
      engine: S.lastEngine || (anyGemini() && engine() !== 'browser' ? 'google-tts' : 'browser'),
      model: S.ttsModel || null, voice: primaryVoice(), fallback: fallbackVoice(), lastVoice: S.lastVoice,
      keys: keys().length, resting: [...S.rest.entries()].filter(([, t]) => t > Date.now()).length, lastError: S.lastError,
    }),
    _selfTest() {
      const ok = [
        langOf('Aap kaise hain sir, sab theek hai?') === 'hinglish',
        langOf('The report is ready, sir.') === 'en',
        langOf('आप कैसे हैं') === 'hi',
        langOf('Maine leads ki list screen par rakh di hai.') === 'hinglish',
        chunks('One. Two is here. Three.').length === 2 && chunks('One. Two is here. Three.')[0] === 'One.',
        sentences('Hello sir. आप कैसे हैं? Fine!').length === 3,
        genderOf('Kore') === 'female' && genderOf('Charon') === 'male',
        /Hindi/.test(styleFor('Aap kaise hain sir?')),
        genderize('Dashboard khol raha hoon, main bata dunga.', 'female') === 'Dashboard khol rahi hoon, main bata dungi.',
        genderize('Main kar sakti hoon, dikhaungi.', 'male') === 'Main kar sakta hoon, dikhaunga.',
        genderize('मैं देख रहा हूँ, बता दूँगा', 'female') === 'मैं देख रही हूँ, बता दूँगी',
        genderize('Main ek AI hoon, woh aa rahi hai.', 'male') === 'Main ek AI hoon, woh aa rahi hai.',
        genderize('मैं समझ गया हूँ', 'female') === 'मैं समझ गई हूँ' && genderize('मैं समझ गई हूँ', 'male') === 'मैं समझ गया हूँ',
      ];
      const passed = ok.filter(Boolean).length;
      console[passed === ok.length ? 'log' : 'error'](`ClavisVoice self-test: ${passed}/${ok.length}`);
      return passed === ok.length;
    },
  };
})();
