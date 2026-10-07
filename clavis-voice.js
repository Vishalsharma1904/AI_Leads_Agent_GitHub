/* ============================================================
 * clavis-voice.js · how Rudra24 AI sounds when it speaks a reply
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
 *  3. (Only when its health is already known-good — never awaited.)
 *  4. ONE free browser voice for the whole reply (Hindi, Hinglish, English):
 *     Swara Online (Edge) → Google हिन्दी (Chrome) → Kalpana/Hemant → any
 *     hi voice; Madhur Online only if a male voice was chosen. Roman
 *     Hinglish → Devanagari (word-list + Google Input Tools batch + rules),
 *     ≤170-char chunks, per-utterance watchdog, Chrome keep-alive.
 *     Override: clavis_browser_voice (Settings → Browser voice).
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
  const TTS_MODELS = ['gemini-3.8-flash-lite-tts', 'gemini-3.8-flash-tts'];
  const FEMALE = ['Kore', 'Sulafat', 'Aoede', 'Leda', 'Zephyr', 'Despina', 'Achernar', 'Callirrhoe', 'Autonoe', 'Erinome', 'Laomedeia', 'Gacrux', 'Pulcherrima', 'Vindemiatrix'];
  const MALE = ['Charon', 'Orus', 'Iapetus', 'Puck', 'Fenrir', 'Algieba', 'Schedar', 'Achird', 'Rasalgethi', 'Sadaltager', 'Alnilam', 'Enceladus', 'Umbriel', 'Algenib', 'Zubenelgenubi', 'Sadachbia'];
  const VOICES = [...FEMALE, ...MALE];
  const DEFAULT_FEMALE = 'Kore', DEFAULT_MALE = 'Charon';
  // He asked for a JARVIS-style male voice as the default. Charon is the
  // steady low one and handles Hindi + English in the same sentence.
  const DEFAULT_VOICE = DEFAULT_MALE;
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
  /* v3: back to a male default (JARVIS). Only moves someone who never chose
     a voice themselves, or who is still on the v2 auto-set female. */
  (function migrateMale() {
    try {
      if (localStorage.getItem('clavis_voice_v3') === '1') return;
      const saved = localStorage.getItem('clavis_gemini_voice');
      if (!saved || saved === DEFAULT_FEMALE) localStorage.setItem('clavis_gemini_voice', DEFAULT_MALE);
      localStorage.setItem('clavis_voice_v3', '1');
    } catch (_) {}
  })();
  const genderOf = (v) => (FEMALE.includes(v) ? 'female' : MALE.includes(v) ? 'male' : '');
  function primaryVoice() {
    const v = localStorage.getItem('clavis_gemini_voice') || DEFAULT_VOICE;
    return VOICES.includes(v) ? v : DEFAULT_VOICE;
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
    return [...new Set(out.filter((k) => /^(?:AIza|AQ\.)\S{10,}$/.test(String(k || ''))))];
  }
  const restKey = (k, m) => `${String(k).slice(-6)}|${m || '*'}`;
  const resting = (k, m) => (S.rest.get(restKey(k, m)) || 0) > Date.now() || (S.rest.get(restKey(k)) || 0) > Date.now();
  const rest = (k, m, ms) => S.rest.set(restKey(k, m), Date.now() + ms);
  function anyGemini() { return keys().some((k) => !resting(k) && TTS_MODELS.some((m) => !resting(k, m))); }

  /* ── text shaping ─────────────────────────────────────────── */
  // . ! ? । ke baad space/newline par todo — "4.5", "10:30", "site.com" nahi tootte.
  function sentences(text) {
    return String(text || '').split(/(?<=[.!?।॥])\s+|(?<=[।॥])|\n+/).map((s) => s.trim()).filter(Boolean);
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
  // Gemini 3.8 reads text verbatim; delivery direction belongs in speech_metadata.
  const FEEL = [
    ['sleepy', /\b(jhapki|aankh lag|so gayi|so gaya|neend|good morning sir|jaag gayi|jaag gaya|yawn)\b|^(hmm|aah|mmm)…/i,
      'sleepy and slow, like someone who just woke from a short nap — a soft yawn at the start, then warm and a little embarrassed'],
    ['laugh', /\b(haha+|hehe+|lol|mazaa aa gaya|kamaal|funny|mazedaar)\b|😄|😂|🤣/i,
      'amused and warm, with a genuine light laugh in the voice'],
    ['sad', /\b(sorry|maaf|afsos|dukh|bura laga|unfortunately|sadly|nahi ho paaya|nahi mil (paaya|payi|saka|saki)|fail ho gaya|khatam ho gayi)\b/i,
      'soft, a little lower and slower, genuinely sorry — sad but steady'],
    ['fear', /\b(risky|risk|khatra|khatarnak|dhyan (dijiye|rakhiye|se)|careful|warning|saavdhaan|dar lag|danger|delete kar doon|pakka\?)\b/i,
      'concerned and careful, a little tense and quicker, like someone gently raising a real worry'],
    ['anger', /\b(bilkul galat|ye theek nahi|bardasht|hadd hai|ridiculous|unacceptable|bekaar|ghatiya)\b|\buff+\b/i,
      'firm, clipped and annoyed at the situation (never at him), controlled'],
    ['excited', /\b(wow|shandaar|zabardast|badhai|congratulations|congrats|mubarak|amazing|kya baat|done ho gaya|mil gay[ae]|ready hai)\b|🎉|!{2,}/i,
      'excited and bright, energy and a smile in the voice'],
  ];
  function feelingOf(text, hint) {
    const byHint = FEEL.find(([k]) => k === hint);
    if (byHint) return byHint[2];
    const hit = FEEL.find(([, re]) => re.test(String(text || '')));
    return hit ? hit[2] : '';
  }
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
    // What the reply itself feels like wins: a joke gets a real little laugh,
    // bad news a softer voice, a warning real concern — like a person.
    const felt = feelingOf(text, S.style);
    const mood = felt || byUser[user] || byReply[reply] || byReply.composed;
    const lang = langOf(text);
    const accent = lang === 'en'
      ? 'natural Indian English'
      : 'natural conversational Hindi the way an educated Delhi professional speaks it — Hindi words with a native Hindi accent, English words (leads, email, website) in natural English';
    return `Trusted personal assistant, ${mood}; ${accent}; human rhythm with natural pauses, never robotic.`;
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
    if (S.audioReady) { await S.audioReady; return wake(); }
    if (S.ctx && S.ctx.state !== 'closed' && S.player) return wake();
    if (!S.audioReady) S.audioReady = (async () => {
      const ctx = S.ctx = new AudioContext({ sampleRate: 24000, latencyHint: 'interactive' });
      try {
        await window.ClavisWorklet.add(ctx, 'clavis-pcm-player-worklet.js?v=3');
        S.player = new AudioWorkletNode(ctx, 'clavis-pcm-player', { outputChannelCount: [1] });
        // Metered output: barge-in compares the mic with what is playing NOW.
        S.analyser = ctx.createAnalyser();
        S.analyser.fftSize = 512;
        S.lvlBuf = new Float32Array(S.analyser.fftSize);
        S.player.connect(S.analyser).connect(ctx.destination);
        S.player.port.onmessage = (e) => { if (e.data?.type === 'drained' && S.drained) { const r = S.drained; S.drained = null; r(); } };
      } catch (error) {
        try { await ctx.close(); } catch (_) {}
        S.ctx = S.player = S.analyser = null;
        throw error;
      }
    })().finally(() => { S.audioReady = null; });
    await S.audioReady;
    return wake();
  }
  // The worklet fetch + AudioContext resume are dead time in front of the very
  // first reply. Pay them at load (no gesture needed to load a module) and
  // again on the first real gesture, which is what unlocks playback.
  (function prewarmAudio() {
    if (typeof window === 'undefined') return;
    try { ensureAudio().catch(() => {}); } catch (_) {}
    ['pointerdown', 'keydown', 'touchstart'].forEach((ev) => {
      window.addEventListener(ev, () => { ensureAudio().catch(() => {}); }, { once: true, passive: true });
    });
  })();
  function outputLevel() {
    if (!S.speaking || !S.analyser || !['google-tts', 'cartesia'].includes(S.lastEngine)) return null;
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
        contents: [{ parts: [{ text: genderize(text, genderOf(voice) || 'female'), speech_metadata: { style: styleFor(text) } }] }],
        generationConfig: { responseModalities: ['AUDIO'], responseFormat: { audio: { mimeType: 'AUDIO_L16', sampleRate: 24000 } }, speechConfig: { voiceConfig: { voice } } },
      }),
    });
    if (res.ok) {
      const data = await res.json();
      const part = (data.candidates?.[0]?.content?.parts || []).find((p) => p.inlineData?.data);
      if (!part) throw Object.assign(new Error('No audio in the reply'), { status: 0, kind: 'content' });
      return b64ToBuffer(part.inlineData.data);
    }
    const body = await res.json().catch(() => ({}));
    if (res.status === 429) {
      // Din ka quota (PerDay) → is session me dobara mat try karo; per-minute → retryDelay.
      const raw = JSON.stringify(body || {});
      const delay = Number((raw.match(/"retryDelay":"(\d+(?:\.\d+)?)s"/) || [])[1]) || 60;
      throw Object.assign(new Error(body?.error?.message || 'TTS 429'), { status: 429, kind: 'quota', restMs: /PerDay|per day|daily/i.test(raw) ? Infinity : Math.max(60, delay) * 1000 });
    }
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
          // Sirf TTS ka key+model rest hota hai (S.rest yahin ka hai) — Live/chat par asar nahi.
          if (e.kind === 'quota') rest(k, model, e.restMs || 60000);
          else if (e.kind === 'key') { rest(k, null, 10 * 60000); break; }
          else if (e.kind === 'model') rest(k, model, 30 * 60000);
          else if (e.kind === 'content') throw e; // same invalid request will fail every model/key
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

  /* ── vault voice: his own Google key, held server-side ────────
     The vault never hands a secret back to the page (that is what makes it
     a vault), so `keys()` above comes back empty for anyone who saved their
     key the normal way — and every reply quietly fell through to the robotic
     built-in browser voice. The key is on the server, so ask the SERVER to
     speak: POST /api/tts synthesises with that user's own key and returns a
     WAV. Same Google voices, no secret in the browser. */
  let vaultTtsOff = 0;           // 503/no-key → stop asking for a while
  /* ── Cartesia Sonic — the voice he actually picked ──────────
   * Goes FIRST. AI Studio made billing mandatory, so the Gemini step below
   * now fails on every reply and the chain was landing on the browser's
   * built-in voice — the robotic one he has been complaining about.
   *
   * Three things make this sound human rather than read-aloud:
   *   · emotion is sent per sentence, taken from ClavisEmotionalEngine, so
   *     the voice tracks HIS mood, not the text's punctuation;
   *   · speed moves with it — slower when he is low, a touch quicker when
   *     he is excited;
   *   · the audio comes back as headerless pcm_s16le @24kHz, which is
   *     exactly what the AudioWorklet player already eats, so there is no
   *     decode between the response and the speaker.
   *
   * The key stays in the server vault. The browser never sees it. */
  let cartesiaOff = 0;

  /* ClavisEmotionalEngine's vocabulary -> Cartesia's. His feeling leads;
     the reply's own prosody only fills in when he gave nothing away. */
  const CART_BY_USER = {
    frustrated: ['calm', 0.96], anxious: ['calm', 0.94], sad: ['sympathetic', 0.92],
    excited: ['excited', 1.06], happy: ['happy', 1.02], grateful: ['grateful', 1.0],
    curious: ['curious', 1.0],
  };
  const CART_BY_REPLY = {
    bright: ['happy', 1.03], reassuring: ['calm', 0.96], alert: ['determined', 1.0],
    curious: ['curious', 1.0], composed: ['neutral', 1.0],
  };
  function cartesiaMood(text) {
    const E = window.ClavisEmotionalEngine;
    let user = '', reply = '';
    try { user = E?.inferUserEmotion?.(window.__clavisLastUserText || '')?.name || ''; } catch (_) {}
    try { reply = E?.speechProsody?.(text)?.name || ''; } catch (_) {}
    const hit = CART_BY_USER[user] || CART_BY_REPLY[reply] || ['neutral', 1.0];
    return { emotion: hit[0], speed: hit[1] };
  }

  function cartesiaOn() {
    if (Date.now() < cartesiaOff) return false;
    if (localStorage.getItem('clavis_tts_engine') === 'browser') return false;
    return localStorage.getItem('clavis_cartesia_off') !== '1';
  }

  async function cartesiaFetch(text, signal) {
    const base = (window.SKYLARK_CONFIG?.BACKEND_URL || 'http://localhost:8000').replace(/\/$/, '');
    let token = '';
    try { token = await window.SupabaseAuth?.getAccessToken?.(); } catch (_) {}
    if (!token) return null;
    const mood = cartesiaMood(text);
    const res = await fetch(base + '/api/tts', {
      method: 'POST', signal,
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
      body: JSON.stringify({
        text, lang: langOf(text) === 'en' ? 'en' : 'hi',
        engine: 'cartesia', fmt: 'pcm',
        emotion: mood.emotion, speed: mood.speed,
        voice_id: localStorage.getItem('clavis_cartesia_voice') || '',
      }),
    });
    if (!res.ok) {
      // Missing setup rests; a transient provider error must not mute fresh turns for two minutes.
      if (res.status !== 401) cartesiaOff = Date.now() + (res.status === 429 ? 15000 : window.ClavisDirect?.providerConfigured?.('cartesia') ? 2000 : 120000);
      throw Object.assign(new Error('cartesia ' + res.status), { status: res.status });
    }
    if (!res.headers.get('content-type')?.startsWith('audio/pcm')) throw new Error('Cartesia returned an unexpected audio format');
    return res.arrayBuffer();
  }

  async function speakCartesia(parts, id, signal, progress) {
    if (!cartesiaOn()) return false;
    await ensureAudio();
    S.lastEngine = 'cartesia';
    // Sonic 3.6 understands Roman Hinglish; no transliteration network call needed.
    const lines = parts.map(text => Promise.resolve(text));
    // The voice has a gender; the sentence has to agree with it. The brain
    // writes Hindi in the masculine ("sun raha hoon") because the persona is
    // male, so a female Cartesia voice was saying male lines — the one thing
    // that makes a voice sound wrong no matter how good it is.
    // genderize() already exists for the old TTS path; the Cartesia path
    // never ran it. clavis_cartesia_gender: 'female' | 'male'.
    // The persona is male and the brain writes "raha hoon", so male is the
    // floor. A voice he picked himself still decides; only the unset case
    // changed — it used to default female, which is why one reply sounded
    // male and the next female.
    const vg = (() => {
      try {
        return localStorage.getItem('clavis_cartesia_gender')
            || genderOf(fallbackVoice())
            || 'male';
      } catch (_) { return 'male'; }
    })();
    const fetchAt = (i) => lines[i]
      .then((t) => cartesiaFetch(genderize(t, vg), signal));
    // Sentence N+1 is fetched while sentence N is still playing, so only the
    // very first one costs the user any wait.
    let next = fetchAt(progress.i);
    for (let i = progress.i; i < parts.length; i++) {
      if (id !== S.gen) return false;
      progress.i = i;
      let buf;
      try { buf = await next; } catch (e) {
        if (i === 0) throw e;        // never started — let the chain fall through
        return false;                 // mid-reply: stop, do not swap voices
      }
      if (id !== S.gen || signal?.aborted) return false;
      if (!buf || !buf.byteLength) { if (i === 0) throw new Error('cartesia empty'); return false; }
      next = i + 1 < parts.length ? fetchAt(i + 1).catch(() => null) : null;
      await play(buf);
      if (id !== S.gen) return false;
    }
    progress.i = parts.length;
    return true;
  }

  async function speakVault(parts, id, signal, progress, voice) {
    if (Date.now() < vaultTtsOff) return false;
    const base = (typeof window !== 'undefined' && window.SKYLARK_CONFIG?.BACKEND_URL) || 'http://localhost:8000';
    let token = '';
    try { token = await window.SupabaseAuth?.getAccessToken?.(); } catch (_) {}
    if (!token) return false;

    for (let i = progress.i; i < parts.length; i++) {
      progress.i = i;
      let blob;
      try {
        const res = await fetch(base + '/api/tts', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
          body: JSON.stringify({ text: parts[i], voice: voice || '', lang: 'hi' }),
          signal,
        });
        if (!res.ok) {
          // No key / quota / backend down — don't hammer it on every sentence.
          if (res.status !== 401) vaultTtsOff = Date.now() + 120000;
          S.lastError = 'vault tts ' + res.status;
          return false;
        }
        blob = await res.blob();
      } catch (e) {
        if (id !== S.gen) return false;
        vaultTtsOff = Date.now() + 60000;
        S.lastError = e?.message || String(e);
        return false;
      }
      if (id !== S.gen) return false;
      S.lastEngine = 'google-tts';
      S.lastVoice = voice || 'Charon';
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      S.player = audio;
      try {
        await new Promise((done, fail) => {
          audio.onended = done;
          audio.onerror = () => fail(new Error('audio play failed'));
          signal?.addEventListener?.('abort', () => { try { audio.pause(); } catch (_) {} done(); }, { once: true });
          audio.play().catch(fail);
        });
      } catch (_) {
        URL.revokeObjectURL(url);
        return false;
      }
      URL.revokeObjectURL(url);
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

  /* ── browser voice: ONE free voice for every reply ────────── */
  // Bina key ke bhi Hindi saaf honi chahiye. Ek hi awaaz sab bolti hai —
  // Hindi, Hinglish aur English — taaki do log baari-baari na lagein.
  // Best free Hindi: Edge → "Microsoft Swara Online (Natural)", Chrome →
  // "Google हिन्दी" (network), Windows SAPI → Kalpana / Hemant.
  // localStorage: clavis_browser_voice (exact voice name, '' = Auto).
  const MALE_NAME = /\b(male|madhur|hemant|prabhat|ravi|rishi|david|mark|guy|ryan|christopher|eric|andrew|brian|george|daniel|james|thomas)\b/i;
  const FEMALE_NAME = /\b(female|swara|kalpana|heera|neerja|zira|aria|jenny|sonia|libby|hazel|susan|samantha|victoria|karen|moira|tessa|veena|lekha)\b/i;
  const BV = { voice: null, ready: null, bad: new Set(), utters: [], pending: new Set(), keepAlive: 0, cancelledAt: 0 };
  const synthApi = () => (typeof window.speechSynthesis !== 'undefined' && typeof SpeechSynthesisUtterance !== 'undefined' ? window.speechSynthesis : null);
  const allVoices = () => { try { return synthApi()?.getVoices?.() || []; } catch (_) { return []; } };
  const isHiVoice = (v) => /^hi\b|^hi[-_]/i.test(v?.lang || '') || /hindi|हिन्दी|हिंदी/i.test(v?.name || '');
  const voiceGender = (v) => (!v ? 'female' : MALE_NAME.test(v.name) && !FEMALE_NAME.test(v.name) ? 'male' : 'female');
  const isNetworkVoice = (v) => Boolean(v) && (v.localService === false || /google|online/i.test(v.name));
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  // Voices Chrome me der se aati hain — ek baar (max ~1.2 s) intezaar, phir cache.
  function voicesReady() {
    if (allVoices().length) return Promise.resolve(true);
    if (BV.ready) return BV.ready;
    const api = synthApi();
    if (!api) return Promise.resolve(false);
    BV.ready = new Promise((resolve) => {
      const done = () => { try { api.removeEventListener?.('voiceschanged', done); } catch (_) {} resolve(allVoices().length > 0); };
      try { api.addEventListener?.('voiceschanged', done); } catch (_) {}
      setTimeout(done, 1200);
    }).then((ok) => { if (!ok) BV.ready = null; return ok; });   // agli baar phir koshish
    return BV.ready;
  }
  // Nayi voices aayin (ya Chrome ne list dobara banayi) → dobara chuno.
  try { synthApi()?.addEventListener?.('voiceschanged', () => { BV.voice = null; refreshBrowserRow(); }); } catch (_) {}

  function chooseVoice() {
    const vs = allVoices().filter((v) => !BV.bad.has(v.name));
    if (!vs.length) return null;
    const saved = (() => { try { return localStorage.getItem('clavis_browser_voice') || ''; } catch (_) { return ''; } })();
    const named = saved && vs.find((v) => v.name === saved);
    if (named) return named;
    const natural = /natural|online|neural/i;
    const wantMale = genderOf(primaryVoice()) === 'male';
    // Gender preference has to hold down the WHOLE ladder, not just the first
    // rung. It used to check Madhur, and on a machine without him dropped
    // straight to Swara — so "male voice" quietly became a female voice on
    // most Windows installs.
    const want = wantMale ? 'male' : 'female';
    const other = wantMale ? 'female' : 'male';
    const pick = (g) => (
         vs.find((v) => (g === 'male' ? /madhur/i : /swara/i).test(v.name) && natural.test(v.name))
      || vs.find((v) => isHiVoice(v) && natural.test(v.name) && voiceGender(v) === g)
      || vs.find((v) => v.name === 'Google हिन्दी' && voiceGender(v) === g)
      || vs.find((v) => /google/i.test(v.name) && isHiVoice(v) && voiceGender(v) === g)
      || vs.find((v) => (g === 'male' ? /hemant|prabhat|ravi/i : /kalpana|heera/i).test(v.name))
      || vs.find((v) => isHiVoice(v) && voiceGender(v) === g)
      || vs.find((v) => /en[-_]IN/i.test(v.lang) && voiceGender(v) === g)
    );
    // Hindi still outranks gender: a male en-US voice mangles Devanagari,
    // so a Hindi voice of the wrong gender is the better of two bad options.
    return pick(want)
      || vs.find((v) => isHiVoice(v) && natural.test(v.name))
      || pick(other)
      || vs.find(isHiVoice)
      || vs.find((v) => /en[-_]IN/i.test(v.lang))
      || vs.find((v) => v.default) || vs[0];
  }
  function browserVoiceObj() {
    let saved = '';
    try { saved = localStorage.getItem('clavis_browser_voice') || ''; } catch (_) {}
    if (BV.voice && (!saved || BV.voice.name === saved) && allVoices().includes(BV.voice) && !BV.bad.has(BV.voice.name)) return BV.voice;
    BV.voice = chooseVoice();
    return BV.voice;
  }
  function listHindiVoices() {
    return allVoices().filter((v) => isHiVoice(v) || /en[-_]IN/i.test(v.lang)).map((v) => ({
      name: v.name, lang: v.lang, hindi: isHiVoice(v), local: v.localService !== false, gender: voiceGender(v),
    })).sort((a, b) => (b.hindi - a.hindi) || a.name.localeCompare(b.name));
  }

  /* ── text for the ear: no emojis, markdown, [[silent]], "e.g." ── */
  function cleanForSpeech(text, hindiish) {
    return String(text || '')
      .replace(/\[\[[^\]]*\]\]/g, ' ')
      .replace(/```[\s\S]*?```/g, ' ')
      .replace(/!?\[([^\]]+)\]\([^)]*\)/g, '$1')                    // [label](url) → label
      .replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE0F}\u{200D}\u{20E3}]/gu, ' ')
      .replace(/[*_#~`>|]+/g, ' ')
      .replace(/(^|\s)[•·▪▸►✓✔✗→←↑↓–-]\s+/g, '$1')                   // bullets / arrows
      .replace(/\be\.g\.,?/gi, hindiish ? 'jaise' : 'for example')
      .replace(/\bi\.e\.,?/gi, hindiish ? 'yaani' : 'that is')
      .replace(/\betc\./gi, 'etc')
      .replace(/\b(Mr|Mrs|Ms|Dr|No|vs|approx|Rs)\.(?=\s|\d)/gi, '$1')
      .replace(/\bRs\s*(?=\d)/gi, '₹')
      .replace(/\s*\n+\s*/g, '. ')
      .replace(/\.(\s*\.)+/g, '.')
      .replace(/\s{2,}/g, ' ')
      .replace(/\s+([.,!?।])/g, '$1')
      .trim();
  }
  // Sentence → chunks of ≤170 chars (Chrome ki Google voice ~15 s par kat jaati hai):
  // pehle clause (, ; : — ।) par, phir space par.
  const MAX_CHUNK = 170;
  function splitLong(s) {
    if (s.length <= MAX_CHUNK) return [s];
    const out = [];
    let cur = '';
    const push = () => { if (cur.trim()) out.push(cur.trim()); cur = ''; };
    for (const piece of s.split(/(?<=[,;:—–।])\s*/)) {
      if (piece.length > MAX_CHUNK) {
        push();
        for (const w of piece.split(/\s+/)) {
          if (cur && (cur + ' ' + w).length > MAX_CHUNK) push();
          cur = cur ? cur + ' ' + w : w;
        }
        continue;
      }
      if (cur && (cur + ' ' + piece).length > MAX_CHUNK) push();
      cur = cur ? cur + ' ' + piece : piece;
    }
    push();
    return out;
  }
  const speechChunks = (text) => sentences(text).flatMap(splitLong);

  /* ── Roman Hinglish → Devanagari (hi-IN voice ko Roman padhna nahi aata) ── */
  // 1) chhoti offline word-list (sabse aam ~330 shabd, sahi spelling),
  // 2) Google Input Tools (baaki shabd, ek batch me, cache ke saath),
  // 3) rule-based akshar-transliteration (jab network na ho).
  const WORDS = {};
  ('hai:है hain:हैं hoon:हूँ hun:हूँ hu:हूँ ho:हो tha:था thi:थी the:थे hoga:होगा hogi:होगी honge:होंगे hua:हुआ hui:हुई hue:हुए hona:होना hota:होता hoti:होती hote:होते ' +
   'main:मैं mai:मैं mein:में me:में mujhe:मुझे mujhse:मुझसे mujhko:मुझको mera:मेरा meri:मेरी mere:मेरे maine:मैंने maina:मैंने hum:हम humne:हमने humein:हमें hame:हमें humse:हमसे hamara:हमारा hamari:हमारी hamare:हमारे ' +
   'aap:आप aapka:आपका aapki:आपकी aapke:आपके aapko:आपको aapne:आपने aapse:आपसे tum:तुम tumhe:तुम्हें tumhara:तुम्हारा tumhari:तुम्हारी woh:वो wo:वो vo:वो yeh:ये ye:ये yah:यह is:इस us:उस ' +
   'isko:इसको usko:उसको inhe:इन्हें unhe:उन्हें unhein:उन्हें inko:इनको unko:उनको iska:इसका iski:इसकी iske:इसके uska:उसका uski:उसकी uske:उसके unka:उनका unki:उनकी unke:उनके inka:इनका inki:इनकी inke:इनके unse:उनसे inse:इनसे isse:इससे usse:उससे ' +
   'koi:कोई kuch:कुछ kuchh:कुछ sab:सब sabhi:सभी sabse:सबसे sabko:सबको khud:खुद apna:अपना apni:अपनी apne:अपने kaun:कौन kaunsa:कौनसा kaunsi:कौनसी kaunse:कौनसे kis:किस kisi:किसी kise:किसे jo:जो jis:जिस jab:जब tab:तब ab:अब abhi:अभी kab:कब kabhi:कभी ' +
   'kahan:कहाँ kaha:कहा yahan:यहाँ yaha:यहाँ wahan:वहाँ waha:वहाँ kya:क्या kyu:क्यों kyun:क्यों kyon:क्यों kyunki:क्योंकि kaise:कैसे kaisa:कैसा kaisi:कैसी kitna:कितना kitne:कितने kitni:कितनी itna:इतना itne:इतने itni:इतनी ' +
   'aisa:ऐसा aisi:ऐसी aise:ऐसे jaisa:जैसा jaisi:जैसी jaise:जैसे waise:वैसे yahi:यही wahi:वही ' +
   'ka:का ki:की ke:के ko:को se:से ne:ने par:पर pe:पे tak:तक bhi:भी hi:ही to:तो toh:तो na:ना nahi:नहीं nahin:नहीं nhi:नहीं mat:मत haan:हाँ han:हाँ ha:हाँ ji:जी aur:और ya:या lekin:लेकिन magar:मगर agar:अगर phir:फिर fir:फिर ' +
   'isliye:इसलिए taaki:ताकि bas:बस sirf:सिर्फ bahut:बहुत bohot:बहुत bahot:बहुत zyada:ज़्यादा jyada:ज़्यादा thoda:थोड़ा thodi:थोड़ी thode:थोड़े kam:कम aaj:आज kal:कल parso:परसों subah:सुबह shaam:शाम raat:रात din:दिन ' +
   'pehle:पहले baad:बाद saath:साथ sath:साथ liye:लिए liya:लिया li:ली lo:लो le:ले lena:लेना lijiye:लीजिए loon:लूँ lunga:लूँगा lungi:लूँगी ' +
   'kar:कर karo:करो karna:करना karne:करने karta:करता karti:करती karte:करते karke:करके kiya:किया kiye:किए karenge:करेंगे karega:करेगा karegi:करेगी karunga:करूँगा karungi:करूँगी karoon:करूँ karu:करूँ karun:करूँ kijiye:कीजिए kariye:करिए ' +
   'raha:रहा rahi:रही rahe:रहे raho:रहो rahiye:रहिए gaya:गया gayi:गई gaye:गए gai:गई gae:गए ja:जा jaa:जा jao:जाओ jana:जाना jaana:जाना jaata:जाता jata:जाता jayega:जाएगा jaayega:जाएगा jayegi:जाएगी jaayegi:जाएगी jaiye:जाइए jaaye:जाए jaye:जाए ' +
   'aa:आ aao:आओ aaya:आया aayi:आई aaye:आए aana:आना aaiye:आइए de:दे do:दो diya:दिया di:दी diye:दिए dena:देना dijiye:दीजिए doon:दूँ du:दूँ dun:दूँ dunga:दूँगा dungi:दूँगी doonga:दूँगा doongi:दूँगी ' +
   'sakta:सकता sakti:सकती sakte:सकते sake:सके sakenge:सकेंगे chahiye:चाहिए chahte:चाहते chahta:चाहता chahti:चाहती dekh:देख dekho:देखो dekhiye:देखिए dekha:देखा dekhna:देखना dekhte:देखते ' +
   'dikha:दिखा dikhao:दिखाओ dikhaiye:दिखाइए dikhata:दिखाता dikhati:दिखाती dikhaya:दिखाया dikhayi:दिखाई dikhaun:दिखाऊँ dikhaunga:दिखाऊँगा dikhaungi:दिखाऊँगी ' +
   'bata:बता batao:बताओ bataiye:बताइए bataya:बताया batana:बताना bataun:बताऊँ bataunga:बताऊँगा bataungi:बताऊँगी bol:बोल bolo:बोलो boliye:बोलिए bola:बोला boli:बोली sun:सुन suno:सुनो suniye:सुनिए ' +
   'samajh:समझ samjha:समझा samjhi:समझी samjhe:समझे mil:मिल mila:मिला mili:मिली mile:मिले milega:मिलेगा milegi:मिलेगी milenge:मिलेंगे ' +
   'dhoondh:ढूंढ dhoond:ढूंढ dhundh:ढूंढ dhund:ढूंढ dhoondha:ढूंढा dhoondhi:ढूंढी dhoondhe:ढूंढे dhoondhne:ढूंढने dhundhne:ढूंढने dhoondhna:ढूंढना dhundhna:ढूंढना dhoondhu:ढूंढूँ dhoondhun:ढूंढूँ ' +
   'bhej:भेज bhejo:भेजो bheja:भेजा bheji:भेजी bheje:भेजे bhejiye:भेजिए bhejna:भेजना bhejne:भेजने bhejun:भेजूँ bhejoon:भेजूँ bhejunga:भेजूँगा bhejungi:भेजूँगी ' +
   'khol:खोल kholo:खोलो khola:खोला kholi:खोली kholiye:खोलिए kholta:खोलता kholti:खोलती band:बंद rakh:रख rakha:रखा rakhi:रखी rakhe:रखे rakhiye:रखिए chal:चल chalo:चलो chaliye:चलिए chala:चला chali:चली chalu:चालू ' +
   'soch:सोच socha:सोचा lag:लग laga:लगा lagi:लगी lage:लगे lagta:लगता lagti:लगती bana:बना banao:बनाओ banaya:बनाया banayi:बनाई banaiye:बनाइए padh:पढ़ padha:पढ़ा likh:लिख likha:लिखा ruk:रुक ruko:रुको chup:चुप ' +
   'theek:ठीक thik:ठीक accha:अच्छा acha:अच्छा achha:अच्छा achchha:अच्छा acchi:अच्छी achi:अच्छी acche:अच्छे ache:अच्छे bilkul:बिल्कुल zaroor:ज़रूर zarur:ज़रूर shukriya:शुक्रिया dhanyavaad:धन्यवाद dhanyawad:धन्यवाद ' +
   'namaste:नमस्ते namaskar:नमस्कार sir:सर madam:मैडम sahab:साहब bhai:भाई kaam:काम baat:बात cheez:चीज़ log:लोग logon:लोगों ghar:घर paisa:पैसा paise:पैसे rupaye:रुपये rupay:रुपये ' +
   'naya:नया nayi:नई naye:नए purana:पुराना bada:बड़ा badi:बड़ी bade:बड़े chhota:छोटा chhoti:छोटी sahi:सही galat:ग़लत pakka:पक्का ek:एक teen:तीन char:चार paanch:पाँच das:दस sau:सौ hazaar:हज़ार hazar:हज़ार lakh:लाख ' +
   'pehla:पहला dusra:दूसरा doosra:दूसरा agla:अगला pichla:पिछला dono:दोनों har:हर baar:बार dobara:दोबारा hamesha:हमेशा matlab:मतलब samay:समय zaroorat:ज़रूरत zarurat:ज़रूरत madad:मदद sawaal:सवाल sawal:सवाल jawab:जवाब ' +
   'turant:तुरंत jaldi:जल्दी dhyan:ध्यान pata:पता maloom:मालूम shayad:शायद sach:सच yaad:याद khush:खुश pareshan:परेशान baje:बजे wala:वाला wali:वाली wale:वाले taiyaar:तैयार tayyar:तैयार tayar:तैयार ' +
   'khatam:ख़त्म shuru:शुरू poora:पूरा pura:पूरा puri:पूरी poori:पूरी aage:आगे peeche:पीछे upar:ऊपर neeche:नीचे niche:नीचे andar:अंदर bahar:बाहर paas:पास bina:बिना lagbhag:लगभग aankh:आँख neend:नींद ghanta:घंटा ghante:घंटे ' +
   'list:लिस्ट leads:लीड्स lead:लीड email:ईमेल emails:ईमेल्स mail:मेल website:वेबसाइट websites:वेबसाइट्स excel:एक्सेल sheet:शीट sheets:शीट्स export:एक्सपोर्ट report:रिपोर्ट data:डेटा file:फ़ाइल files:फ़ाइलें ' +
   'call:कॉल calls:कॉल्स phone:फ़ोन number:नंबर numbers:नंबर्स message:मैसेज whatsapp:व्हाट्सऐप map:मैप maps:मैप्स google:गूगल search:सर्च company:कंपनी companies:कंपनियाँ ' +
   'hotel:होटल hotels:होटल्स hospital:हॉस्पिटल hospitals:हॉस्पिटल्स mall:मॉल malls:मॉल्स security:सिक्योरिटी guard:गार्ड guards:गार्ड्स housekeeping:हाउसकीपिंग office:ऑफ़िस client:क्लाइंट clients:क्लाइंट्स ' +
   'meeting:मीटिंग ready:रेडी done:डन update:अपडेट screen:स्क्रीन settings:सेटिंग्स setting:सेटिंग voice:वॉइस open:ओपन sorry:सॉरी please:प्लीज़ thanks:थैंक्स thank:थैंक you:यू ok:ओके okay:ओके ' +
   'time:टाइम minute:मिनट minutes:मिनट second:सेकंड total:टोटल contact:कॉन्टैक्ट contacts:कॉन्टैक्ट्स details:डिटेल्स detail:डिटेल city:सिटी area:एरिया gurugram:गुरुग्राम gurgaon:गुड़गाँव delhi:दिल्ली noida:नोएडा india:इंडिया ' +
   'business:बिज़नेस service:सर्विस services:सर्विसेज़ team:टीम check:चेक test:टेस्ट internet:इंटरनेट online:ऑनलाइन app:ऐप browser:ब्राउज़र download:डाउनलोड send:सेंड chat:चैट clavis:क्लैविस jarvis:जार्विस ' +
   'key:की task:टास्क tasks:टास्क्स plan:प्लान price:प्राइस follow:फ़ॉलो up:अप hello:हैलो profile:प्रोफ़ाइल link:लिंक save:सेव ' +
   'payment:पेमेंट pending:पेंडिंग delete:डिलीट try:ट्राई badhiya:बढ़िया uthaya:उठाया uthao:उठाओ unhone:उन्होंने inhone:इन्होंने dila:दिला dilana:दिलाना thanda:ठंडा rakhna:रखना rakho:रखो ' +
   'baithe:बैठे baitho:बैठो padhna:पढ़ना padhiye:पढ़िए chhod:छोड़ chhodo:छोड़ो chhodiye:छोड़िए jod:जोड़ jodo:जोड़ो jodiye:जोड़िए hata:हटा hatao:हटाओ hataiye:हटाइए ' +
   'ladka:लड़का ladki:लड़की sadak:सड़क padega:पड़ेगा padegi:पड़ेगी pade:पड़े pada:पड़ा padi:पड़ी')
    .split(/\s+/).forEach((p) => { const i = p.indexOf(':'); if (i > 0) WORDS[p.slice(0, i)] = p.slice(i + 1); });

  /* ── Devanagari → Roman Hinglish (ULTA) ──────────────────────────────────
     Caption aur screen par hamesha EK hi script dikhni chahiye. Model kabhi
     Devanagari nikaal de to use wapas Roman me laate hain — pehle usi
     word-list se (sahi spelling), warna akshar-by-akshar. */
  const BACK = {};
  Object.keys(WORDS).forEach((lat) => { const dev = WORDS[lat]; if (dev && !BACK[dev]) BACK[dev] = lat; });
  // Naam aur brand: hamesha sahi spelling, rules se nahi.
  Object.assign(BACK, {
    '\u0930\u0941\u0926\u094d\u0930': 'Rudra', '\u0930\u0941\u0926\u094d\u0930\u093e': 'Rudra',
    '\u0938\u0930': 'sir', '\u0938\u0930\u094d': 'sir', '\u091c\u0940': 'ji',
    '\u0932\u0940\u0921\u094d\u0938': 'leads', '\u0908\u092e\u0947\u0932': 'email',
    '\u0930\u093f\u092a\u094b\u0930\u094d\u091f': 'report', '\u0921\u0948\u0936\u092c\u094b\u0930\u094d\u0921': 'dashboard',
  });

  const D_CONS = {
    'क':'k','ख':'kh','ग':'g','घ':'gh','ङ':'n','च':'ch','छ':'chh','ज':'j','झ':'jh','ञ':'n',
    'ट':'t','ठ':'th','ड':'d','ढ':'dh','ण':'n','त':'t','थ':'th','द':'d','ध':'dh','न':'n',
    'प':'p','फ':'ph','ब':'b','भ':'bh','म':'m','य':'y','र':'r','ल':'l','ळ':'l','व':'v',
    'श':'sh','ष':'sh','स':'s','ह':'h',
    'क़':'q','ख़':'kh','ग़':'g','ज़':'z','ड़':'r','ढ़':'rh','फ़':'f','य़':'y',
  };
  const D_VOW  = { 'अ':'a','आ':'aa','इ':'i','ई':'ee','उ':'u','ऊ':'oo','ए':'e','ऐ':'ai','ओ':'o','औ':'au','ऋ':'ri','ॠ':'ri' };
  const D_MAT  = { 'ा':'aa','ि':'i','ी':'ee','ु':'u','ू':'oo','े':'e','ै':'ai','ो':'o','ौ':'au','ृ':'ri' };

  function devaWordToLatin(w) {
    if (BACK[w]) return BACK[w];
    let out = '';
    for (let i = 0; i < w.length; i++) {
      let ch = w[i];
      if (w[i + 1] === '़' && D_CONS[ch + '़']) { ch += '़'; i++; }
      const cons = D_CONS[ch];
      if (cons) {
        out += cons;
        const nx = w[i + 1];
        if (nx === '्') { i++; continue; }          // halant → koi swar nahi
        if (D_MAT[nx]) { out += D_MAT[nx]; i++; continue; }
        if (nx === 'ं' || nx === 'ँ') { out += 'an'; i++; continue; }
        out += 'a';                                  // inherent swar
        continue;
      }
      if (D_VOW[ch]) { out += D_VOW[ch]; continue; }
      if (D_MAT[ch]) { out += D_MAT[ch]; continue; }
      if (ch === 'ं' || ch === 'ँ') { out += 'n'; continue; }
      if (ch === 'ः') { out += 'h'; continue; }
      if (ch === '्' || ch === '़' || ch === '॰') continue;
      out += ch;
    }
    return out.replace(/([bcdfghjklmnpqrstvwxyz])a$/, '$1');   // schwa deletion: कर → kar
  }

  const DEVA_RE = /[ऀ-ॿ]/;
  // Ek hi baat do zabaan me ("Main taiyaar hoon. मैं तैयार हूँ।") -> ek hi baar.
  function dropEcho(text) {
    const parts = String(text).split(/(?<=[.!?…])\s+/);
    const seen = new Set(); const out = [];
    for (const p of parts) {
      const key = p.toLowerCase().replace(/[^a-z0-9]+/g, '');
      if (!key) { out.push(p); continue; }
      if (seen.has(key)) continue;
      seen.add(key); out.push(p);
    }
    return out.join(' ');
  }
  const DEVA_DIGITS = '०१२३४५६७८९';
  function toHinglish(text, preserve = false) {
    let t = String(text == null ? '' : text);
    if (!DEVA_RE.test(t)) return preserve ? t : dropEcho(t);
    // Pehle Devanagari viraam aur ank hata do — warna ye shabd ka hissa ban
    // jaate hain ("सर।" -> "sara." instead of "sir.").
    t = t.replace(/[।॥]/g, '.')
         .replace(/[०-९]/g, (d) => String(DEVA_DIGITS.indexOf(d)))
         .replace(/[ऀ-ॣ॰-ॿ]+/g, (w) => devaWordToLatin(w))
         .replace(/([.!?,:;])(?=[A-Za-z])/g, '$1 ')
         .replace(/\s+([.,!?;:])/g, '$1')
         .replace(/[ \t]{2,}/g, ' ')
         .trim();
    t = (preserve ? t : dropEcho(t))
      .replace(/([.!?\u2026]\s+)([a-z])/g, (m, p1, p2) => p1 + p2.toUpperCase());
    return t.charAt(0).toUpperCase() + t.slice(1);
  }


  const VOW = [['aa', 'आ', 'ा'], ['ai', 'ऐ', 'ै'], ['au', 'औ', 'ौ'], ['ee', 'ई', 'ी'], ['ii', 'ई', 'ी'], ['oo', 'ऊ', 'ू'], ['uu', 'ऊ', 'ू'], ['ou', 'औ', 'ौ'],
    ['ei', 'ए', 'े'], ['ae', 'ए', 'े'], ['a', 'अ', ''], ['i', 'इ', 'ि'], ['u', 'उ', 'ु'], ['e', 'ए', 'े'], ['o', 'ओ', 'ो']];
  const CON = [['chh', 'छ'], ['cch', 'च्छ'], ['ksh', 'क्ष'], ['kh', 'ख'], ['gh', 'घ'], ['ch', 'च'], ['jh', 'झ'], ['th', 'थ'], ['dh', 'ध'], ['ph', 'फ'], ['bh', 'भ'], ['sh', 'श'], ['ck', 'क'],
    ['k', 'क'], ['g', 'ग'], ['j', 'ज'], ['t', 'त'], ['d', 'द'], ['n', 'न'], ['p', 'प'], ['b', 'ब'], ['m', 'म'], ['y', 'य'], ['r', 'र'], ['l', 'ल'], ['v', 'व'], ['w', 'व'],
    ['s', 'स'], ['h', 'ह'], ['f', 'फ़'], ['z', 'ज़'], ['q', 'क'], ['x', 'क्स'], ['c', 'क']];
  // English jaisa shabd (report, update, city…) → ट/ड, 'c'+e/i → स, double letters single.
  const ENGLISHY = /(tion|sion|ment|ness|ing$|ght|ck|w[^aeiouh]|x|q|(?<!c)c(?![ch])|[^aeiou]ll|ss$|[^e]er$|ies$|[^aeiou]ed$|[^aeiou]y$)/;
  function ruleDeva(word) {
    let s = String(word || '').toLowerCase().replace(/[^a-z]/g, '');
    if (!s) return '';
    const eng = ENGLISHY.test(s);
    if (eng) s = s.replace(/([bcdfgklmnprstz])\1/g, '$1').replace(/c(?=[eiy])/g, 's').replace(/([^aeiou])y$/, '$1ee').replace(/(?<=[aeiou][^aeiou]{1,2})e$/, '');
    let out = '', i = 0, prevCons = false;
    while (i < s.length) {
      const v = VOW.find(([r]) => s.startsWith(r, i));
      if (v) {
        const end = i + v[0].length >= s.length;
        if (prevCons) {
          out += end && v[0] === 'a' ? 'ा' : end && v[0] === 'i' ? 'ी' : end && v[0] === 'u' ? 'ू' : v[2];
        } else {
          out += end && out && v[0] === 'a' ? 'आ' : end && out && v[0] === 'i' ? 'ई' : v[1];
        }
        prevCons = false; i += v[0].length; continue;
      }
      const ch = s[i], nx = s[i + 1];
      // 'n' / 'm' ke baad vyanjan → anusvaar (andar → अंदर, sambhal → संभाल)
      if (out && !prevCons && nx && !VOW.some(([r]) => s.startsWith(r, i + 1))
          && ((ch === 'n' && !'hyvwrlmn'.includes(nx)) || (ch === 'm' && 'bp'.includes(nx)))) {
        out += 'ं'; i += 1; continue;
      }
      const c = CON.find(([r]) => s.startsWith(r, i));
      if (!c) { i += 1; continue; }
      let deva = c[1];
      if (eng && c[0] === 't') deva = 'ट';
      if (eng && c[0] === 'd') deva = 'ड';
      out += (prevCons ? '्' : '') + deva;
      prevCons = true; i += c[0].length;
    }
    return out;
  }
  // Ek shabd: ALL-CAPS (AI, CRM, PDF) jaisa hai waisa, word-list, cache (Input Tools), phir rules.
  function wordToDeva(w, cache) {
    if (/^[A-Z]{2,6}s?$/.test(w)) return w;
    const k = w.toLowerCase();
    if (WORDS[k]) return WORDS[k];
    const hit = cache && cache.get(k);
    if (hit) return hit;
    return ruleDeva(k) || w;
  }
  const TOKEN = /(https?:\/\/\S+|www\.\S+|[\w.+-]+@[\w-]+\.[\w.]+|[A-Za-z]+(?:'[A-Za-z]+)?|[^A-Za-z]+)/g;
  const GREET = { hi: 'हाय', hey: 'हे', hello: 'हैलो' };
  function translitOffline(sentence, cache) {
    let first = true;
    return (String(sentence || '').match(TOKEN) || []).map((t) => {
      if (!/^[A-Za-z]+(?:'[A-Za-z]+)?$/.test(t)) return t;
      const lead = first; first = false;
      if (lead && GREET[t.toLowerCase()]) return GREET[t.toLowerCase()];   // "Hi sir" ≠ "ही सर"
      return wordToDeva(t.replace(/'/g, ''), cache);
    }).join('');
  }
  const romanWords = (sentence) => (String(sentence || '').match(TOKEN) || []).filter((t) => /^[A-Za-z]+$/.test(t) && !/^[A-Z]{2,6}s?$/.test(t)).map((t) => t.toLowerCase());

  // Input Tools cache: memory + localStorage (clavis_translit_v1, ~600 shabd, LRU-jaisa).
  const TL = { map: null, saveT: 0, downUntil: 0 };
  function tlCache() {
    if (TL.map) return TL.map;
    TL.map = new Map();
    try { (JSON.parse(localStorage.getItem('clavis_translit_v1') || '[]') || []).forEach(([k, v]) => { if (k && v) TL.map.set(k, v); }); } catch (_) {}
    return TL.map;
  }
  const tlGet = { get(k) { const m = tlCache(); const v = m.get(k); if (v) { m.delete(k); m.set(k, v); } return v; } };
  function tlPut(k, v) {
    const m = tlCache();
    m.delete(k); m.set(k, v);
    while (m.size > 600) m.delete(m.keys().next().value);
    clearTimeout(TL.saveT);
    TL.saveT = setTimeout(() => { try { localStorage.setItem('clavis_translit_v1', JSON.stringify([...m])); } catch (_) {} }, 1500);
  }
  async function inputTools(words, signal) {
    const url = `https://inputtools.google.com/request?text=${encodeURIComponent(words.join(' '))}&itc=hi-t-i0-und&num=1&cp=0&cs=1&ie=utf-8&oe=utf-8`;
    const data = await fetch(url, { signal }).then((r) => r.json());
    if (data?.[0] !== 'SUCCESS') throw new Error('translit failed');
    const out = (data?.[1] || []).map((seg) => seg?.[1]?.[0] || '').join(' ').trim().split(/\s+/);
    if (out.length !== words.length) throw new Error('translit word count mismatch');
    words.forEach((w, i) => { if (DEVANAGARI.test(out[i]) && !/[A-Za-z]/.test(out[i])) tlPut(w, out[i]); });
  }
  // Poore reply ke anjaan shabd EK saath (20-20 ke batch, parallel), 2.5 s max.
  // Fail hua to 3 min tak service chhod do — offline rules turant chalenge.
  function prefetchTranslit(sents) {
    const cache = tlCache();
    const unknown = [...new Set(sents.flatMap(romanWords))].filter((w) => !WORDS[w] && !cache.has(w));
    if (!unknown.length || TL.downUntil > Date.now() || (typeof navigator !== 'undefined' && navigator.onLine === false)) return Promise.resolve();
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 2500);
    const groups = [];
    for (let i = 0; i < unknown.length; i += 20) groups.push(unknown.slice(i, i + 20));
    return Promise.all(groups.map((g) => inputTools(g, ctl.signal).catch(() => { TL.downUntil = Date.now() + 3 * 60000; })))
      .finally(() => clearTimeout(t));
  }
  // Har sentence ka bolne-layak roop (promises, taaki pehla sentence jaldi shuru ho).
  function prepareLines(lines, hindiVoice) {
    if (!hindiVoice) return lines.map((x) => Promise.resolve(x));
    const roman = lines.map((x) => !DEVANAGARI.test(x) && langOf(x) === 'hinglish');
    const batch = prefetchTranslit(lines.filter((_, i) => roman[i]));
    const cache = tlCache();
    return lines.map((x, i) => {
      if (!roman[i]) return Promise.resolve(x);
      const needsNet = romanWords(x).some((w) => !WORDS[w] && !cache.has(w));
      return (needsNet ? batch : Promise.resolve()).then(() => translitOffline(x, tlGet));
    });
  }

  /* ── one utterance, with watchdog + Chrome keep-alive ─────── */
  function utter(text, voice, prosody, id) {
    return new Promise((resolve) => {
      const api = synthApi();
      if (!api || id !== S.gen) return resolve(false);
      const u = new SpeechSynthesisUtterance(text);
      if (voice) u.voice = voice;
      u.lang = voice?.lang || 'hi-IN';
      const sapi = voice && voice.localService !== false && /microsoft/i.test(voice.name) && !/online|natural/i.test(voice.name);
      const override = Number(localStorage.getItem('clavis_voice_rate'));
      const base = override > 0 ? override : sapi ? 0.95 : 1;
      u.rate = Math.max(0.85, Math.min(1.15, base * (prosody?.rateMultiplier || 1)));
      u.pitch = Math.max(0.95, Math.min(1.05, prosody?.pitchMultiplier || 1));
      let settled = false, started = false, startT = 0, endT = 0;
      const finish = (ok) => {
        if (settled) return;
        settled = true;
        clearTimeout(startT); clearTimeout(endT);
        BV.pending.delete(finish);
        BV.utters = BV.utters.filter((x) => x !== u);
        resolve(ok);
      };
      // Watchdog: onend kabhi na aaye (Chrome bug) to 1500 + chars×110 ms baad aage badho.
      const budget = 1500 + (text.length * 110) / u.rate;
      let endFired = false;
      const armEnd = () => { endT = setTimeout(() => { if (started || api.speaking) finish(true); else endFired = true; }, budget); };
      u.onstart = () => { if (started) return; started = true; clearTimeout(startT); if (endFired) armEnd(); };
      u.onend = () => finish(true);
      u.onerror = (e) => {
        const code = e?.error || '';
        if (code === 'interrupted' || code === 'canceled') return finish(false);
        if (code === 'not-allowed') return finish('blocked');   // Chrome: page par pehla click abhi nahi hua
        finish(started ? true : 'error');
      };
      BV.utters.push(u);            // Chrome GC bug: reference na rahe to onend kabhi nahi aata
      BV.pending.add(finish);
      armEnd();
      // Network voice 5 s me shuru hi nahi hui → atak gayi maano.
      startT = setTimeout(() => { if (!started && !api.speaking) finish('error'); }, 5000);
      try { api.speak(u); } catch (_) { finish('error'); }
    });
  }
  function keepAlive(on) {
    clearInterval(BV.keepAlive);
    BV.keepAlive = 0;
    if (!on) return;
    // Chrome ki Google (network) voice lambi baat par chup ho jaati hai — har 10 s halka pause/resume.
    BV.keepAlive = setInterval(() => {
      const api = synthApi();
      if (!api || !api.speaking || api.paused) return;
      try { api.pause(); api.resume(); } catch (_) {}
    }, 10000);
  }

  async function speakBrowser(text, id) {
    const api = synthApi();
    if (!api) return false;
    if (!(await voicesReady()) || id !== S.gen) return false;   // koi voice hi nahi (headless / WebView)
    let voice = browserVoiceObj();
    if (!voice) return false;
    // Do not read Hindi/Hinglish through the generic English or old SAPI
    // voice. Keep the text visible until a natural Hindi voice/key is ready.
    if (langOf(text) !== 'en' && (!isHiVoice(voice) || !/natural|online|google/i.test(voice.name))) return false;
    S.lastEngine = 'browser';
    const gender = voiceGender(voice);
    const hindiish = isHiVoice(voice) || langOf(text) !== 'en';
    const clean = cleanForSpeech(genderize(text, gender), hindiish);
    const lines = speechChunks(clean);
    if (!lines.length) return true;
    let prosody = null;
    try { prosody = window.ClavisEmotionalEngine?.speechProsody?.(clean); } catch (_) {}
    const ready = prepareLines(lines, isHiVoice(voice));
    // cancel() ke turant baad speak() Chrome me kabhi-kabhi gum ho jaata hai.
    const since = Date.now() - BV.cancelledAt;
    if (since < 80) await sleep(80 - since);
    if (id !== S.gen) return false;
    S.lastVoice = voice.name;
    keepAlive(isNetworkVoice(voice));
    const preparedHi = isHiVoice(voice);
    let spoke = 0, fails = 0;
    try {
      for (let i = 0; i < lines.length; i++) {
        const prepared = await ready[i];
        if (id !== S.gen) return false;
        const line = isHiVoice(voice) === preparedHi ? prepared : lines[i];
        let r = await utter(line, voice, prosody, id);
        if (id !== S.gen) return false;
        if (r === 'blocked') break;
        if (r === 'error') {
          // Google voice ko internet chahiye — atki to is session me local voice.
          if (isNetworkVoice(voice) && !localStorage.getItem('clavis_browser_voice')) {
            BV.bad.add(voice.name);
            BV.voice = null;
            const next = browserVoiceObj();
            if (next && next !== voice) {
              console.warn(`[ClavisVoice] ${voice.name} failed — switching to ${next.name}.`);
              voice = next;
              S.lastVoice = voice.name;
              keepAlive(isNetworkVoice(voice));
              r = await utter(isHiVoice(voice) === preparedHi ? prepared : lines[i], voice, prosody, id);
              if (id !== S.gen) return false;
            }
          }
        }
        if (r === true) { spoke++; fails = 0; } else if (++fails >= 2) break;   // voice chal hi nahi rahi
      }
    } finally { keepAlive(false); }
    return spoke > 0;
  }

  /* ── public ───────────────────────────────────────────────── */
  async function speak(text, opts = {}) {
    const clean = String(text || '').replace(/\[\[[^\]]*\]\]/g, ' ').trim();
    if (!clean) return false;
    if (opts.signal?.aborted) return false;
    if (typeof window !== 'undefined' && window.ClavisVoiceState && !window.ClavisVoiceState.canSpeak()) return false;
    // The top-bar mute. Checked here, not at the call sites, so there is one
    // place that decides whether Rudra has the floor.
    try { if (localStorage.getItem('clavis_voice_muted') === '1') return false; } catch (_) {}
    // NOTHING SPEAKS INTO AN EMPTY ROOM.
    //
    // ClavisWake already gates the model callers, but several proactive
    // layers reach ClavisVoice directly, and a stray wake was enough to let
    // them greet nobody — repeatedly, and bill a model call each time. One
    // check here covers every caller, however it got in.
    //
    // isAwake() is true while a turn is in flight (busy holds), so a slow
    // reply to something he actually said is never cut off. opts.unprompted
    // is the single exception: the sleepy "sir?" check-in, which is allowed
    // exactly once per wake by clavis-wake.
    if (!opts.unprompted) {
      try {
        const W = window.ClavisWake;
        if (W && typeof W.isAwake === 'function' && !W.isAwake()) {
          S.lastError = 'asleep';
          return false;
        }
      } catch (_) {}
    }
    stop();
    const id = ++S.gen;
    S.style = opts.style || '';
    S.aborter = new AbortController();
    S.speaking = true;
    const cancel = () => { if (id === S.gen) stop(); };
    opts.signal?.addEventListener?.('abort', cancel, { once: true });
    try {
      const parts = chunks(clean);
      const progress = { i: 0 };
      const remaining = () => parts.slice(progress.i).join(' ');   // never repeat what was already said
      const browserOnly = opts.engine === 'browser' || engine() === 'browser';
      // One engine at a time. On 'cartesia' nothing hands over: a failure is
      // reported and the turn stays silent, because a reply that finishes in
      // a different voice is worse than one that does not finish.
      const cartesiaOnly = opts.engine === 'cartesia' || engine() === 'cartesia' || (!browserOnly && window.ClavisDirect?.providerConfigured?.('cartesia'));
      // His own voice first. Everything below is fallback now.
      if (!browserOnly) {
        try {
          if (await speakCartesia(parts, id, S.aborter.signal, progress)) {
            S.lastError = '';
            S.lastEngine = 'cartesia';
            return id === S.gen;
          }
          if (id !== S.gen) return false;
          if (cartesiaOnly) return false;
        } catch (e) {
          if (id !== S.gen) return false;
          S.lastError = e?.message || String(e);
          if (cartesiaOnly) {
            console.warn('[ClavisVoice] Cartesia only: ' + S.lastError + ' — staying silent instead of changing voice.');
            return false;
          }
        }
      }
      const hasKey = anyGemini();
      if (!browserOnly && hasKey) {
        const first = VOICES.includes(opts.voice) ? opts.voice : primaryVoice();
        try {
          const done = await speakGemini(parts, id, S.aborter.signal, progress, first);
          S.lastError = '';
          return done && id === S.gen;
        } catch (e) {
          if (id !== S.gen) return false;   // stopped on purpose (every stop bumps gen)
          S.lastError = e?.message || String(e);
          console.warn(`[ClavisVoice] ${first} unavailable (${S.lastError}) — handing over.`);
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
      // No key in THIS browser, but one may sit in his server vault — that
      // is the normal case now, and it is why the robotic voice kept winning.
      if (!browserOnly && !hasKey) {
        const v = VOICES.includes(opts.voice) ? opts.voice : primaryVoice();
        if (await speakVault(parts, id, S.aborter.signal, progress, v)) return id === S.gen;
        if (id !== S.gen) return false;
      }
      if (opts.cloudOnly) return { remaining: remaining() };
      // Backend voice sirf tab jab uski health PEHLE se pata ho (cached true).
      // Band localhost ka intezaar kabhi reply ke raaste me nahi — check peeche chalta hai.
      const L = window.LocalSpeechEngine;
      const health = L?.healthCached?.();
      if (!browserOnly && health == null && L?.health) L.health().catch(() => {});
      if (!browserOnly && progress.i === 0 && health === true && await speakBackend(remaining(), id, S.aborter.signal)) return true;
      if (id !== S.gen) return false;
      return await speakBrowser(remaining(), id);
    } finally {
      opts.signal?.removeEventListener?.('abort', cancel);
      if (id === S.gen) S.speaking = false;
    }
  }

  function stop() {
    S.gen++;
    S.speaking = false;
    keepAlive(false);
    BV.cancelledAt = Date.now();
    [...BV.pending].forEach((finish) => finish(false));   // atke hue utter() promises chhod do
    BV.utters = [];
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
      mountFishKeyRow();
      if (!row || document.getElementById('sm-gemini-voice-male')) { mountBrowserRow(row); return; }
      const male = document.createElement('div');
      male.className = 'smodal-field';
      male.innerHTML = `<div class="smodal-field-left"><label class="smodal-label" for="sm-gemini-voice-male">Male voice</label><span class="smodal-hint">Takes over only when her quota runs out — same Hindi + English.</span></div>
        <div style="display:flex;gap:8px;align-items:center"><select id="sm-gemini-voice-male" class="smodal-select">${MALE.map(opt).join('')}</select><button type="button" class="smodal-btn-primary" id="sm-voice-preview" title="Hear the selected voices">▶ Preview</button></div>`;
      row.after(male);
      const ms = male.querySelector('select');
      ms.value = fallbackVoice();
      ms.addEventListener('change', () => window.ClavisVoice.setFallbackVoice(ms.value));
      mountBrowserRow(row);
      male.querySelector('#sm-voice-preview').addEventListener('click', async () => {
        const f = sel.value, m = ms.value;
        await speak('Namaste sir, main Rudra24 AI hoon. Aapki leads, map aur PC — sab sambhal loongi.', { voice: f });
        if (genderOf(f) !== 'male') await speak('Aur main male voice hoon — jab zaroorat ho, main sambhal lunga.', { voice: m });
      });
    });
  }
  // Free browser voice (bina key): Auto ya koi bhi Hindi voice, ▶ Test ke saath.
  function mountBrowserRow(voiceRow) {
    if (!voiceRow || document.getElementById('sm-browser-voice')) return;
    const anchor = document.getElementById('sm-gemini-voice-male')?.closest('.smodal-field') || voiceRow;
    const box = document.createElement('div');
    box.className = 'smodal-field';
    box.innerHTML = `<div class="smodal-field-left"><label class="smodal-label" for="sm-browser-voice">Browser voice (free)</label>
      <span class="smodal-hint" id="sm-browser-voice-hint">Bina key ke yahi ek awaaz Hindi + English bolti hai.</span></div>
      <div style="display:flex;gap:8px;align-items:center"><select id="sm-browser-voice" class="smodal-select"></select>
      <button type="button" class="smodal-btn-primary" id="sm-browser-voice-test">▶ Test</button></div>`;
    anchor.after(box);
    const sel = box.querySelector('select');
    sel.addEventListener('change', () => {
      try { if (sel.value) localStorage.setItem('clavis_browser_voice', sel.value); else localStorage.removeItem('clavis_browser_voice'); } catch (_) {}
      BV.voice = null; BV.bad.clear();
      refreshBrowserRow();
    });
    box.querySelector('#sm-browser-voice-test').addEventListener('click', () => {
      speak('Namaste sir, main Rudra24 AI hoon. Aaj kaunse leads dhoondhne hain?', { engine: 'browser' });
    });
    refreshBrowserRow();
    voicesReady().then(refreshBrowserRow);
  }
  function refreshBrowserRow() {
    const sel = typeof document !== 'undefined' && document.getElementById('sm-browser-voice');
    if (!sel) return;
    let saved = '';
    try { saved = localStorage.getItem('clavis_browser_voice') || ''; } catch (_) {}
    const list = listHindiVoices();
    const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
    const optn = (v) => `<option value="${esc(v.name)}">${esc(v.name)} · ${v.lang}${v.local ? '' : ' · online'}</option>`;
    const hi = list.filter((v) => v.hindi), en = list.filter((v) => !v.hindi);
    const pick = browserVoiceObj();
    sel.innerHTML = `<option value="">Auto (best)${pick && !saved ? ' — ' + esc(pick.name) : ''}</option>`
      + (hi.length ? `<optgroup label="Hindi">${hi.map(optn).join('')}</optgroup>` : '')
      + (en.length ? `<optgroup label="Indian English">${en.map(optn).join('')}</optgroup>` : '');
    sel.value = list.some((v) => v.name === saved) ? saved : '';
    const hint = document.getElementById('sm-browser-voice-hint');
    if (hint && allVoices().length && !hi.length) hint.textContent = 'Is PC par Hindi voice nahi mili — Edge (Swara Online) ya Chrome (Google हिन्दी) behtar Hindi bolte hain.';
  }

  // A plain, visible place to paste the Google AI Studio key — the only
  // other way in was a dialog that appeared when something else failed.
  function mountKeyRow(voiceRow) {
    if (!voiceRow || document.getElementById('sm-gemini-key')) return;
    const box = document.createElement('div');
    box.className = 'smodal-field';
    const has = keys().length > 0;
    box.innerHTML = `<div class="smodal-field-left"><label class="smodal-label" for="sm-gemini-key">Google AI Studio key</label>
      <span class="smodal-hint" id="sm-gemini-key-hint">${has ? 'Connected — Rudra24 AI speaks with Google voices.' : 'Free key → natural Hindi + English voices and live talk. <a href="https://aistudio.google.com/app/apikey" target="_blank" rel="noopener">Get a key ↗</a>'}</span></div>
      <div style="display:flex;gap:8px;align-items:center"><input id="sm-gemini-key" type="password" autocomplete="off" spellcheck="false" placeholder="${has ? '•••••• connected — paste to add another' : 'AIza…'}" style="width:220px;padding:8px 10px;border-radius:10px;border:1px solid rgba(127,127,127,.3);background:transparent;color:inherit;font:inherit">
      <button type="button" class="smodal-btn-primary" id="sm-gemini-key-save">Save &amp; test</button></div>`;
    voiceRow.before(box);
    const input = box.querySelector('#sm-gemini-key');
    const hint = box.querySelector('#sm-gemini-key-hint');
    box.querySelector('#sm-gemini-key-save').addEventListener('click', async (ev) => {
      const btn = ev.currentTarget;
      const k = String(input.value || '').trim();
      if (!/^(?:AIza|AQ\.)\S{20,}$/.test(k)) { hint.textContent = 'Yeh Google AI Studio key nahi lagti — "AIza…" ya "AQ.…" se shuru hoti hai.'; return; }
      btn.disabled = true; hint.textContent = 'Check kar raha hoon…';
      const prevBrain = localStorage.getItem('clavis_ai_provider');
      try {
        // Same check + save + honest quota test as the setup popup.
        const r = window.ClavisSetup?.saveKey
          ? await window.ClavisSetup.saveKey('gemini', k)
          : (window.ClavisDirect?.setKey?.('gemini', k), { saved: true, status: 'unknown', message: '' });
        // A voice key must not quietly replace the chat brain he chose.
        if (prevBrain && prevBrain !== 'gemini') localStorage.setItem('clavis_ai_provider', prevBrain);
        if (!r.saved) { hint.textContent = r.message; return; }
        S.rest.clear();   // nayi key → TTS phir se try (session wala quota-rest bhi hata)
        input.value = '';
        input.placeholder = `Saved: ${r.mask || 'key'} — paste to add another`;
        if (r.status !== 'ok') { hint.textContent = r.message; return; }
        hint.textContent = 'Key chal rahi hai — test awaaz chal rahi hai…';
        const ok = await speak('Namaste sir, main Rudra24 AI hoon. Ab main Google ki awaaz me Hindi aur English dono bolti hoon.');
        const st = window.ClavisVoice.status();
        hint.textContent = st.engine === 'google-tts' && ok
          ? `Connected ✓ — ${st.lastVoice} bol rahi hai (${st.model}).`
          : `Key saved, lekin Google voice abhi nahi chali: ${st.lastError || 'quota/limit'} — browser voice chal rahi hai.`;
      } catch (err) {
        hint.textContent = 'Key save nahi hui: ' + (err?.message || err);
      } finally { btn.disabled = false; }
    });
  }

  function mountFishKeyRow() {
    const google = document.getElementById('sm-gemini-key')?.closest('.smodal-field');
    if (!google || document.getElementById('sm-fish-key')) return;
    const box = document.createElement('div');
    box.className = 'smodal-field';
    box.innerHTML = `<div class="smodal-field-left"><label class="smodal-label" for="sm-fish-key">Fish Audio API key</label>
      <span class="smodal-hint" id="sm-fish-key-hint">${window.ClavisDirect?.keyFor?.('fish_audio') ? 'Connected — voice and transcription ready.' : 'Add once for voice and transcription. <a href="https://fish.audio/app/api-keys/" target="_blank" rel="noopener">Get a key ↗</a>'}</span></div>
      <div style="display:flex;gap:8px;align-items:center"><input id="sm-fish-key" type="password" autocomplete="off" spellcheck="false" placeholder="Paste Fish Audio key" style="width:220px;padding:8px 10px;border-radius:10px;border:1px solid rgba(127,127,127,.3);background:transparent;color:inherit;font:inherit">
      <button type="button" class="smodal-btn-primary" id="sm-fish-key-save">Save</button></div>`;
    google.after(box);
    const input = box.querySelector('#sm-fish-key');
    const hint = box.querySelector('#sm-fish-key-hint');
    box.querySelector('#sm-fish-key-save').addEventListener('click', async (event) => {
      const key = String(input.value || '').trim();
      if (!/^\S{12,}$/.test(key)) { hint.textContent = 'Valid Fish Audio key paste kijiye.'; return; }
      const button = event.currentTarget;
      button.disabled = true;
      hint.textContent = 'Saving…';
      try {
        await window.ClavisKeyVault.add('fish_audio', key);
        input.value = '';
        hint.textContent = 'Saved ✓ — Fish voice and transcription ready. Voice model ID bhi set kijiye.';
      } catch (error) { hint.textContent = error?.message || 'Key save nahi hui.'; }
      finally { button.disabled = false; }
    });
  }

  document.addEventListener('click', () => setTimeout(mountPickers, 80), { passive: true });
  // Backend voice ki health pehle hi pata ho, taaki pehla reply ek awaaz me aur baaki doosri me na ho.
  window.addEventListener('load', () => setTimeout(() => { try { window.LocalSpeechEngine?.health?.().catch(() => {}); } catch (_) {} }, 1500), { once: true });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mountPickers, { once: true }); else setTimeout(mountPickers, 0);

  window.ClavisVoice = {
    speak, stop, outputLevel, primaryVoice, fallbackVoice, genderOf, genderize,
    /* 'cartesia' = only his own voice; 'browser' = only the system voice;
       'auto' = try them in order. */
    useEngine(name) {
      const ok = ['auto', 'cartesia', 'browser'];
      if (!ok.includes(name)) throw new Error('engine must be one of ' + ok.join(', '));
      try { localStorage.setItem('clavis_voice_engine', name); } catch (_) {}
      return name;
    },
    engineInUse: () => engine(),
    toHinglish,
    isSpeaking: () => S.speaking,
    resetQuota: () => { S.rest.clear(); },   // a freshly saved key → TTS tries every key again
    browserVoice: () => browserVoiceObj()?.name || '',
    listHindiVoices,
    _translitOffline: (t) => translitOffline(t, null),
    _speechChunks: speechChunks,
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
      model: S.ttsModel || null, voice: primaryVoice(), browserVoice: BV.voice?.name || '', fallback: fallbackVoice(), lastVoice: S.lastVoice,
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
