/* ============================================================
 * clavis-ear.js · Clavis hears sir — and only sir
 * ------------------------------------------------------------
 * Four small pieces that every voice path shares:
 *
 *  1. SELF-ECHO GUARD. The mic hears Clavis's own reply through
 *     the speakers; the recognizer typed it into the composer and
 *     Clavis answered itself. Every transcript is now compared with
 *     what Clavis said in the last few seconds — by sound, not
 *     spelling ("लीड्स" and "leads" reduce to the same skeleton
 *     "lds") — and dropped when it is just Clavis's own voice.
 *
 *  2. VOICE ID (opt-in, beta). Sir reads one line once; a compact
 *     voiceprint (MFCC means + pitch) is kept in localStorage and
 *     slowly adapts to him over time. In open-mic moments (the
 *     follow-up window after a reply) a voice that clearly isn't
 *     his is ignored — unless it says "Clavis", so anyone may still
 *     call Clavis by name. Honest scope: a room-level heuristic that
 *     filters TV / background chatter, not a security lock.
 *
 *  3. DOUBLE-TALK DETECTOR, used by barge-in and the Live mic gate:
 *     it learns how loud Clavis's own echo is relative to what is
 *     being played, so only a voice ABOVE that echo counts as sir
 *     interrupting. (The old detector learned the floor during the
 *     silent second before speech started, then fired on its own
 *     echo — or never fired at all.)
 *
 *  4. LIVE CAPTION. What sir says appears under the top-right
 *     buttons as open text — no box, no bubble — word by word with
 *     a soft blur-in, like Siri's live transcription. Nothing is
 *     typed into the composer any more.
 *
 * API: window.ClavisEar
 *   noteSpeaking(text) / noteSpoken(text) / noteSpeakingDone()
 *   isSpeaking(), echo(text) -> {score, n, fresh}
 *   judge(text, {openMic, since, source}) -> {accept, reason, barge, text}
 *   caption.live(text) / .final(text, accepted) / .clear()
 *   voiceId.enroll() / .openEnroll() / .enabled() / .clear() / .status()
 *   tap.start(tag) / tap.stop(tag)           (feature tap on the mic)
 *   createDoubleTalk(opts) -> { update(micRms, outRms) }
 * ============================================================ */
(function () {
  'use strict';
  if (window.ClavisEar && window.ClavisEar.version) return;

  const now = () => Date.now();
  const LS = {
    print: 'clavis_voiceprint_v1', vid: 'clavis_voice_id_enabled', caption: 'clavis_live_caption',
    k: 'clavis_echo_k',
  };
  const lsGet = (k) => { try { return localStorage.getItem(k); } catch (_) { return null; } };
  const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch (_) {} };

  /* ── 1. text → sound skeleton ──────────────────────────────── */
  const CONS = {
    'क': 'k', 'ख': 'kh', 'ग': 'g', 'घ': 'gh', 'ङ': 'n', 'च': 'ch', 'छ': 'chh', 'ज': 'j', 'झ': 'jh', 'ञ': 'n',
    'ट': 't', 'ठ': 'th', 'ड': 'd', 'ढ': 'dh', 'ण': 'n', 'त': 't', 'थ': 'th', 'द': 'd', 'ध': 'dh', 'न': 'n',
    'प': 'p', 'फ': 'f', 'ब': 'b', 'भ': 'bh', 'म': 'm', 'य': 'y', 'र': 'r', 'ल': 'l', 'व': 'v', 'श': 'sh',
    'ष': 'sh', 'स': 's', 'ह': 'h', 'ळ': 'l', 'क़': 'k', 'ख़': 'kh', 'ग़': 'g', 'ज़': 'z', 'ड़': 'r', 'ढ़': 'rh', 'फ़': 'f', 'य़': 'y',
  };
  const VOW = { 'अ': 'a', 'आ': 'aa', 'इ': 'i', 'ई': 'ee', 'उ': 'u', 'ऊ': 'oo', 'ऋ': 'ri', 'ए': 'e', 'ऐ': 'ai', 'ओ': 'o', 'औ': 'au', 'ऑ': 'o', 'ॲ': 'e' };
  const MATRA = { 'ा': 'a', 'ि': 'i', 'ी': 'i', 'ु': 'u', 'ू': 'u', 'ृ': 'ri', 'े': 'e', 'ै': 'ai', 'ो': 'o', 'ौ': 'au', 'ॉ': 'o', 'ॅ': 'e', 'ं': 'n', 'ँ': 'n', 'ः': 'h', '्': '', '़': '' };
  function deva2latin(s) {
    let out = '';
    for (const ch of String(s || '')) {
      if (CONS[ch]) out += CONS[ch] + 'a';
      else if (VOW[ch]) out += VOW[ch];
      else if (ch in MATRA) out = out.replace(/a$/, '') + MATRA[ch];
      else out += ch;
    }
    return out;
  }
  function words(text) {
    return deva2latin(String(text || '').toLowerCase())
      .replace(/[’'`]/g, '')
      .split(/[^a-z0-9]+/)
      .filter(Boolean);
  }
  function skel(w) {
    let s = String(w || '').toLowerCase();
    if (/^\d+$/.test(s)) return s;
    s = s.replace(/ch/g, 'C').replace(/ph/g, 'f').replace(/sh/g, 's').replace(/([kgjtdpbC])h/g, '$1')
      .replace(/ck/g, 'k').replace(/c(?=[eiy])/g, 's').replace(/c/g, 'k').replace(/C/g, 'c')
      .replace(/q/g, 'k').replace(/x/g, 'ks').replace(/w/g, 'v').replace(/z/g, 'j');
    const first = s[0] || '';
    const rest = s.slice(1).replace(/[aeiouyh]/g, '');
    return (first + rest).replace(/(.)\1+/g, '$1');
  }
  function lev1(a, b) {
    // "within one edit" without building a matrix.
    if (a === b) return true;
    const la = a.length, lb = b.length;
    if (Math.abs(la - lb) > 1) return false;
    let i = 0, j = 0, edits = 0;
    while (i < la && j < lb) {
      if (a[i] === b[j]) { i++; j++; continue; }
      if (++edits > 1) return false;
      if (la > lb) i++; else if (lb > la) j++; else { i++; j++; }
    }
    return edits + (la - i) + (lb - j) <= 1;
  }

  /* ── speech bookkeeping ────────────────────────────────────── */
  const said = { speaking: false, since: 0, endedAt: 0, items: [], lastText: '' };
  function remember(text) {
    const t = String(text || '').trim();
    if (!t) return;
    const sk = words(t).map(skel).filter((s) => s.length >= 1);
    if (!sk.length) return;
    said.items.push({ at: now(), sk: new Set(sk) });
    const cutoff = now() - 45000;
    while (said.items.length && (said.items[0].at < cutoff || said.items.length > 40)) said.items.shift();
  }
  function noteSpeaking(text) {
    said.speaking = true;
    if (text) said.lastText = String(text);
    // Safety net: a voice engine that never reports "done" must not leave
    // Clavis deaf. ~85 ms per character is slower than any real voice.
    said.maxUntil = now() + Math.min(90000, Math.max(6000, String(text || '').length * 85 + 5000));
    said.since = now();
    remember(text);
    tap.start('speaking');
  }
  function noteSpoken(text) {
    remember(text);
    if (said.speaking) said.maxUntil = Math.max(said.maxUntil || 0, now() + Math.min(30000, String(text || '').length * 85 + 4000));
  }
  function noteSpeakingDone() {
    if (said.speaking) said.endedAt = now();
    said.speaking = false;
    tap.stop('speaking');
  }
  let testing = false;
  function enginesSpeaking() {
    if (testing) return false;
    try { if (window.ClavisVoice?.isSpeaking?.()) return true; } catch (_) {}
    try { if (window.speechSynthesis?.speaking) return true; } catch (_) {}
    return false;
  }
  function isSpeaking() {
    if (said.speaking && !testing && now() > (said.maxUntil || 0) && !enginesSpeaking()) noteSpeakingDone();
    return said.speaking || enginesSpeaking();
  }
  function msSinceSpoke() { return isSpeaking() ? 0 : now() - (said.endedAt || 0); }

  function echo(text, windowMs = 12000) {
    const tokens = words(text).map(skel).filter((s) => s.length >= 1);
    if (!tokens.length) return { score: 0, n: 0, fresh: 0 };
    const cutoff = now() - windowMs;
    const pool = new Set();
    said.items.forEach((it) => { if (it.at >= cutoff || said.speaking) it.sk.forEach((s) => pool.add(s)); });
    if (!pool.size) return { score: 0, n: tokens.length, fresh: tokens.length };
    const poolArr = [...pool];
    let hit = 0;
    tokens.forEach((t) => {
      if (pool.has(t) || (t.length >= 3 && poolArr.some((p) => p.length >= 3 && lev1(p, t)))) hit++;
    });
    return { score: hit / tokens.length, n: tokens.length, fresh: tokens.length - hit };
  }

  /* ── what counts as "for Clavis" ───────────────────────────── */
  const NAME_RE = /\b(clavis|klavis|clevis|klevis|clavish|claves|clavice|jarvis|hey buddy|hi pal)\b|क्ल[ेैा]विस|क्लेविज़|जार्विस/i;
  const STOP_RE = /\b(stop|wait|ruko|ruk ja|ruk jao|bas|bas karo|chup|chup karo|shut up|hold on|one sec|ek (?:min|minute|second)|suno|sunno|listen|nahi nahi|no no|cancel)\b|रुको|बस|चुप|सुनो/i;
  const ASK_RE = /\b(karo|kar do|kardo|kariye|kijiye|karna|dikhao|dikha do|dikhaiye|batao|bata do|bataiye|kholo|khol do|band|hatao|hata do|chalao|chala do|nikalo|nikal do|bhejo|bhej do|likho|likh do|search|find|show|open|close|tell|play|pause|stop|start|call|send|make|create|give|get|find|check|explain|summari[sz]e|translate|remind|set|go|zoom|scroll|type|read|what|what's|whats|which|who|whom|whose|why|how|when|where|kya|kyaa|kaise|kab|kahan|kaha|kitna|kitne|kitni|kaun|kyun|kyu|kis|konsa|kaunsa|can you|could you|would you|will you|please|plz|pls|zara|jara|chahiye|lao|le aao|de do|do na|suno|next|aur|agla|pichla|wapas|haan|han|nahi|nahin|yes|yeah|yep|no|nope|ok|okay|theek|thik|done|sure|bilkul|leads?|map|photo|photos|image|images|website|email|excel|whatsapp)\b|करो|दिखाओ|बताओ|खोलो|बंद|हटाओ|क्या|कैसे|कब|कहाँ|कितने|कौन|क्यों/i;
  function named(text) { return NAME_RE.test(String(text || '')); }
  function looksLikeRequest(text) {
    const t = String(text || '').trim();
    if (!t) return false;
    if (/\?\s*$/.test(t)) return true;
    return ASK_RE.test(t);
  }
  function clavisJustAsked() {
    return now() - (said.endedAt || 0) < 15000 && /\?\s*$/.test(String(said.lastText || '').trim());
  }

  // The one decision every recognizer path goes through.
  function judge(text, ctx = {}) {
    const t = String(text || '').replace(/\s+/g, ' ').trim();
    if (!t) return { accept: false, reason: 'empty', text: '' };
    const byName = named(t);
    const speakingNow = isSpeaking();
    const gap = msSinceSpoke();
    const e = echo(t, 12000);

    // Clavis is talking (or just stopped — recognizers deliver finals late).
    if (speakingNow || gap < 2600) {
      if (e.n >= 2 ? e.score >= 0.55 : e.score >= 1) return { accept: false, reason: 'echo', text: t, echo: e };
      if (STOP_RE.test(t)) return { accept: true, barge: true, reason: 'stop-word', text: t };
      if (byName && e.fresh >= 1) return { accept: true, barge: true, reason: 'named', text: t };
      // New words over Clavis's voice interrupt it only when they are for
      // Clavis — a request/question, or (once enrolled) sir's own voice.
      // A conversation in the room shouldn't cut Clavis off.
      // Other new words interrupt only when they are HIS voice (Voice ID) —
      // a video or people in the room must never cut Clavis off.
      const his = voiceId.enabled() && voiceId.verdict(ctx.since || now() - 4000).verdict === 'owner';
      if (e.fresh >= 2 && his) return { accept: true, barge: true, reason: 'his-voice', text: t };
      return { accept: false, reason: 'unsure-while-speaking', text: t, echo: e };
    }
    // A recognizer can also deliver Clavis's words many seconds late.
    const late = echo(t, 9000);
    if (late.n >= 3 && late.score >= 0.8) return { accept: false, reason: 'late-echo', text: t, echo: late };

    // Open mic (no "Clavis" said): only his registered voice counts. "Sounds
    // like a request" was not enough — "I'm going to go to the next video"
    // from a video in the room passed that test and opened photos.
    if (ctx.openMic && !byName) {
      const v = voiceId.enabled() ? voiceId.verdict(ctx.since || now() - 6000) : { verdict: 'unknown' };
      if (v.verdict !== 'owner') return { accept: false, reason: voiceId.enabled() ? 'not-owner' : 'not-addressed', text: t, voice: v };
    }
    return { accept: true, barge: false, reason: 'ok', text: t };
  }

  /* ── 2. mic feature tap (MFCC + pitch) ─────────────────────── */
  const MEL_BANDS = 24, NCEP = 12, FRAME_MS = 32, KEEP_MS = 20000;
  const tap = {
    users: new Set(), stream: null, ctx: null, an: null, timer: 0, fbuf: null, tbuf: null, mel: null, frames: [],
    floor: 0.006, lastRms: 0, starting: null,
    async ensure() {
      if (this.an) return true;
      if (this.starting) return this.starting;
      this.starting = (async () => {
        try {
          this.stream = await (window.LocalSpeechEngine?.acquireSharedMicrophone?.() || navigator.mediaDevices.getUserMedia({
            audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 },
          }));
          this.ctx = new (window.AudioContext || window.webkitAudioContext)();
          const src = this.ctx.createMediaStreamSource(this.stream);
          this.an = this.ctx.createAnalyser();
          this.an.fftSize = 1024;
          this.an.smoothingTimeConstant = 0;
          src.connect(this.an);
          this.fbuf = new Float32Array(this.an.frequencyBinCount);
          this.tbuf = new Float32Array(this.an.fftSize);
          this.mel = melBank(this.ctx.sampleRate, this.an.fftSize);
          return true;
        } catch (err) {
          this.an = null;
          return false;
        } finally { this.starting = null; }
      })();
      return this.starting;
    },
    async start(tag) {
      // Never ask for the mic just to listen for echo; only reuse a granted one.
      if (lsGet('clavis_mic_permission_granted') !== 'true' && tag !== 'enroll') return false;
      this.users.add(tag);
      if (!(await this.ensure())) { this.users.delete(tag); return false; }
      if (this.ctx.state === 'suspended') { try { await this.ctx.resume(); } catch (_) {} }
      if (!this.timer && this.users.size) this.timer = setInterval(() => this.tick(), FRAME_MS);
      return true;
    },
    stop(tag) {
      this.users.delete(tag);
      if (!this.users.size && this.timer) { clearInterval(this.timer); this.timer = 0; }
    },
    level() { return this.lastRms; },
    tick() {
      if (!this.an) return;
      this.an.getFloatTimeDomainData(this.tbuf);
      let s = 0;
      for (let i = 0; i < this.tbuf.length; i++) s += this.tbuf[i] * this.tbuf[i];
      const r = Math.sqrt(s / this.tbuf.length);
      this.lastRms = r;
      if (r < this.floor * 1.6) this.floor = this.floor * 0.97 + r * 0.03;
      else this.floor = Math.min(0.05, this.floor * 1.0005);
      const t = now();
      const cutoff = t - KEEP_MS;
      while (this.frames.length && this.frames[0].t < cutoff) this.frames.shift();
      if (r < Math.max(0.01, this.floor * 2.5)) return;
      const p = pitchOf(this.tbuf, this.ctx.sampleRate);
      if (!p || p.clarity < 0.45) return;
      this.an.getFloatFrequencyData(this.fbuf);
      const v = mfcc(this.fbuf, this.mel);
      if (!v) return;
      v.push(3 * Math.log2(p.hz / 150));
      this.frames.push({ t, v, r });
    },
    since(t0, t1 = now()) { return this.frames.filter((f) => f.t >= t0 && f.t <= t1).map((f) => f.v); },
  };

  function melBank(rate, fft) {
    const hzToMel = (h) => 2595 * Math.log10(1 + h / 700);
    const melToHz = (m) => 700 * (Math.pow(10, m / 2595) - 1);
    const lo = hzToMel(90), hi = hzToMel(4200);
    const pts = [];
    for (let i = 0; i < MEL_BANDS + 2; i++) pts.push(melToHz(lo + (hi - lo) * i / (MEL_BANDS + 1)));
    const binHz = rate / fft;
    return pts.slice(1, -1).map((c, i) => ({ lo: pts[i] / binHz, c: c / binHz, hi: pts[i + 2] / binHz }));
  }
  function mfcc(dbSpectrum, bank) {
    const logE = new Array(bank.length);
    for (let b = 0; b < bank.length; b++) {
      const f = bank[b];
      let e = 0;
      const a = Math.max(0, Math.floor(f.lo)), z = Math.min(dbSpectrum.length - 1, Math.ceil(f.hi));
      for (let k = a; k <= z; k++) {
        const w = k < f.c ? (k - f.lo) / (f.c - f.lo) : (f.hi - k) / (f.hi - f.c);
        if (w <= 0) continue;
        const db = dbSpectrum[k];
        if (!Number.isFinite(db)) continue;
        e += w * Math.pow(10, db / 10);
      }
      logE[b] = Math.log(e + 1e-12);
    }
    const out = [];
    const n = logE.length;
    for (let c = 1; c <= NCEP; c++) {
      let s = 0;
      for (let b = 0; b < n; b++) s += logE[b] * Math.cos(Math.PI * c * (b + 0.5) / n);
      out.push(s / n);
    }
    return out.every(Number.isFinite) ? out : null;
  }
  function pitchOf(buf, rate) {
    const minLag = Math.floor(rate / 400), maxLag = Math.min(Math.floor(rate / 70), buf.length - 64);
    let r0 = 0;
    for (let i = 0; i < buf.length; i++) r0 += buf[i] * buf[i];
    if (r0 <= 0) return null;
    let best = -1, bestLag = 0;
    for (let lag = minLag; lag <= maxLag; lag += 2) {
      let s = 0;
      for (let i = 0; i + lag < buf.length; i++) s += buf[i] * buf[i + lag];
      s /= r0 * (buf.length - lag) / buf.length;
      if (s > best) { best = s; bestLag = lag; }
    }
    return bestLag ? { hz: rate / bestLag, clarity: best } : null;
  }

  /* ── voice id ──────────────────────────────────────────────── */
  function stats(vs) {
    const d = vs[0].length;
    const mu = new Array(d).fill(0), sd = new Array(d).fill(0);
    vs.forEach((v) => v.forEach((x, i) => { mu[i] += x; }));
    for (let i = 0; i < d; i++) mu[i] /= vs.length;
    vs.forEach((v) => v.forEach((x, i) => { sd[i] += (x - mu[i]) * (x - mu[i]); }));
    for (let i = 0; i < d; i++) sd[i] = Math.max(Math.sqrt(sd[i] / vs.length), i === d - 1 ? 0.25 : 0.05);
    return { mu, sd };
  }
  function meanOf(vs) {
    const d = vs[0].length, m = new Array(d).fill(0);
    vs.forEach((v) => v.forEach((x, i) => { m[i] += x; }));
    return m.map((x) => x / vs.length);
  }
  function dist(m, p) {
    let s = 0;
    for (let i = 0; i < m.length; i++) {
      const w = i === m.length - 1 ? 1.6 : 1;   // pitch weighs a little more
      s += w * Math.pow((m[i] - p.mu[i]) / p.sd[i], 2);
    }
    return Math.sqrt(s / m.length);
  }
  const voiceId = {
    profile() { try { return JSON.parse(lsGet(LS.print) || 'null'); } catch (_) { return null; } },
    enabled() { return !!this.profile() && lsGet(LS.vid) !== 'false'; },
    setEnabled(on) { lsSet(LS.vid, on ? 'true' : 'false'); return this.enabled(); },
    clear() { try { localStorage.removeItem(LS.print); } catch (_) {} },
    status() {
      const p = this.profile();
      return p ? { enrolled: true, enabled: this.enabled(), frames: p.n, threshold: p.thr, since: p.at } : { enrolled: false, enabled: false };
    },
    verdict(t0, t1) {
      const p = this.profile();
      if (!p) return { verdict: 'unknown', reason: 'not-enrolled' };
      const vs = tap.since(t0, t1);
      if (vs.length < 12) return { verdict: 'unknown', reason: 'too-short', frames: vs.length };
      const d = dist(meanOf(vs), p);
      const verdict = d <= p.thr ? 'owner' : d > p.thr * 1.35 ? 'other' : 'unsure';
      // Personalises over time: confident matches nudge the print toward
      // how sir sounds now (mic, room, time of day), never an impostor.
      if (verdict === 'owner' && d < p.thr * 0.7 && vs.length >= 20) {
        const m = meanOf(vs);
        p.mu = p.mu.map((x, i) => x * 0.96 + m[i] * 0.04);
        p.adapted = (p.adapted || 0) + 1;
        lsSet(LS.print, JSON.stringify(p));
      }
      return { verdict, distance: +d.toFixed(3), threshold: p.thr, frames: vs.length };
    },
    async enroll({ seconds = 9, onProgress } = {}) {
      const ok = await tap.start('enroll');
      if (!ok) throw new Error('Microphone nahi mila — permission allow karein.');
      const t0 = now();
      try {
        await new Promise((resolve) => {
          const iv = setInterval(() => {
            const voiced = tap.since(t0).length;
            const el = now() - t0;
            onProgress?.(Math.min(1, Math.max(voiced / 150, el / (seconds * 1000) * 0.6)), voiced);
            if (voiced >= 150 || el > seconds * 1000) { clearInterval(iv); resolve(); }
          }, 150);
        });
      } finally { tap.stop('enroll'); }
      const vs = tap.since(t0);
      if (vs.length < 60) throw new Error('Awaaz kam aayi — thoda paas aakar, normal awaaz me dobara boliye.');
      const base = stats(vs);
      // Calibrate: how far do sir's OWN chunks fall from his print?
      const q = Math.floor(vs.length / 4);
      let worst = 0;
      for (let c = 0; c < 4; c++) {
        const chunk = vs.slice(c * q, (c + 1) * q);
        const rest = vs.slice(0, c * q).concat(vs.slice((c + 1) * q));
        worst = Math.max(worst, dist(meanOf(chunk), stats(rest)));
      }
      const p = { v: 1, at: now(), n: vs.length, mu: base.mu, sd: base.sd, thr: +Math.min(1.6, Math.max(0.55, worst * 2.5)).toFixed(3) };
      lsSet(LS.print, JSON.stringify(p));
      lsSet(LS.vid, 'true');
      return this.status();
    },
    openEnroll() { return enrollSheet(); },
  };

  /* ── 3. double-talk detector ───────────────────────────────── */
  let sharedK = Number(lsGet(LS.k)) || 0.3;
  function createDoubleTalk(opts = {}) {
    const margin = opts.margin || 2.2, min = opts.min || 0.018;
    let k = opts.k0 || sharedK, floor = 0.004, hot = 0, outHold = 0, saveAt = 0;
    return {
      update(mic, out) {
        outHold = Math.max(out, outHold * 0.86);            // echo lags the output by 20-150 ms
        if (outHold < 0.004) floor = mic < floor * 1.6 ? floor * 0.95 + mic * 0.05 : floor * 1.001;
        const thr = Math.max(min, floor * 3, k * outHold * margin);
        const loud = mic > thr;
        if (!loud && outHold > 0.008) {
          const r = mic / (outHold + 1e-4);
          // Echo-sized wobble moves k quickly; a bigger jump only creeps, so a
          // voice ramping up under the threshold can't drag it along — while a
          // real volume change on the speakers is still learned in ~1 s.
          if (r <= k) k = Math.max(0.02, Math.max(r, k * 0.985));
          else if (r < k * 1.5) k = Math.min(r, k * 1.1);
          else k *= 1.03;
          if (now() - saveAt > 5000) { saveAt = now(); sharedK = k; lsSet(LS.k, k.toFixed(4)); }
        }
        hot = loud ? hot + 1 : Math.max(0, hot - 1);
        return { loud, hot, thr, k, floor };
      },
      k: () => k,
    };
  }

  /* ── 4. live caption (Siri-style, top right, open text) ────── */
  const cap = { el: null, line: null, words: [], hideTimer: 0, finalAt: 0 };
  function capEnabled() { return lsGet(LS.caption) !== 'false'; }
  function capEnsure() {
    if (cap.el && document.body.contains(cap.el)) return cap.el;
    const el = document.createElement('div');
    el.id = 'clavis-ear-caption';
    el.setAttribute('aria-live', 'polite');
    el.setAttribute('role', 'status');
    el.innerHTML = '<span class="ce-dot" aria-hidden="true"></span><div class="ce-clip"><p class="ce-line"></p></div>';
    document.body.appendChild(el);
    cap.el = el;
    cap.line = el.querySelector('.ce-line');
    place();
    return el;
  }
  function place() {
    if (!cap.el) return;
    const bar = document.querySelector('.topbar-right') || document.querySelector('.topbar');
    const r = bar?.getBoundingClientRect?.();
    if (r && r.bottom > 0 && r.bottom < 140) {
      let top = r.bottom + 10;
      // A page's own icon row right under the top bar (the Clavis page has
      // one): sit below it instead of writing over its buttons.
      document.querySelectorAll('.jarvis-hero-actions, .view.active .view-header-actions, #do-live-time').forEach((el) => {
        const b = el.getBoundingClientRect();
        if (b.width && b.height && b.top < top + 44 && b.bottom < 180 && b.right > window.innerWidth - 520) top = Math.max(top, b.bottom + 8);
      });
      cap.el.style.top = Math.round(top) + 'px';
      cap.el.style.right = Math.max(12, Math.round(window.innerWidth - r.right)) + 'px';
    }
  }
  window.addEventListener('resize', () => place(), { passive: true });

  function render(text, settled) {
    capEnsure();
    const next = String(text || '').replace(/\s+/g, ' ').trim().split(' ').filter(Boolean);
    // Keep the words that didn't change; only the new tail animates in.
    let same = 0;
    while (same < cap.words.length && same < next.length && cap.words[same].w.toLowerCase() === next[same].toLowerCase()) same++;
    for (let i = cap.words.length - 1; i >= same; i--) { cap.words[i].el.remove(); cap.words.pop(); }
    for (let i = same; i < next.length; i++) {
      const s = document.createElement('span');
      s.className = 'ce-w';
      s.textContent = next[i];
      s.style.animationDelay = Math.min(0.28, (i - same) * 0.045) + 's';
      cap.line.appendChild(s);
      cap.line.appendChild(document.createTextNode(' '));
      cap.words.push({ w: next[i], el: s });
    }
    // Long speech: only the latest ~18 words (two lines) stay (the mask fades older ones).
    while (cap.words.length > 18) {
      const first = cap.words.shift();
      const sp = first.el.nextSibling;
      first.el.remove();
      if (sp && sp.nodeType === 3) sp.remove();
    }
    cap.el.classList.toggle('is-settled', !!settled);
  }
  const caption = {
    live(text) {
      if (!capEnabled()) return;
      const t = String(text || '').trim();
      if (!t) return;
      // Clavis's own words never show up as "what sir said".
      if (isSpeaking()) { const e = echo(t, 12000); if (e.n >= 2 ? e.score >= 0.55 : e.score >= 1) return; }
      clearTimeout(cap.hideTimer);
      place();
      render(t, false);
      cap.el.classList.remove('is-out', 'is-dropped');
      cap.el.classList.add('is-in', 'is-listening');
      caption._touched = now();
    },
    final(text, accepted = true) {
      if (!capEnabled()) return;
      if (!accepted) {
        if (!cap.el) return;
        cap.el.classList.add('is-dropped');
        this.clear(260);
        return;
      }
      if (text) render(text, true);
      if (!cap.el) return;
      cap.el.classList.remove('is-listening', 'is-dropped');
      cap.el.classList.add('is-in', 'is-settled');
      clearTimeout(cap.hideTimer);
      cap.hideTimer = setTimeout(() => this.clear(), 4200);   // long enough to read
    },
    listening(on) {
      if (!capEnabled()) return;
      capEnsure();
      cap.el.classList.toggle('is-listening', !!on);
      if (on && !cap.words.length) cap.el.classList.add('is-in', 'is-idle');
      if (!on) cap.el.classList.remove('is-idle');
    },
    clear(delay = 0) {
      clearTimeout(cap.hideTimer);
      const go = () => {
        if (!cap.el) return;
        cap.el.classList.add('is-out');
        cap.el.classList.remove('is-in', 'is-listening', 'is-idle');
        setTimeout(() => {
          if (!cap.el || !cap.el.classList.contains('is-out')) return;
          cap.line.textContent = '';
          cap.words = [];
          cap.el.classList.remove('is-settled', 'is-dropped');
        }, 520);
      };
      if (delay) cap.hideTimer = setTimeout(go, delay); else go();
    },
    setEnabled(on) { lsSet(LS.caption, on ? 'true' : 'false'); if (!on) this.clear(); },
  };

  /* ── enrolment sheet ───────────────────────────────────────── */
  function enrollSheet() {
    if (document.getElementById('clavis-voiceid-sheet')) return Promise.resolve(null);
    const owner = (() => { try { return window.AuthSystem?.getProfile?.()?.firstName || ''; } catch (_) { return ''; } })();
    const line = `Clavis, main ${owner || 'aapka owner'} hoon. Meri awaaz yaad rakhna — leads nikalni ho, map dekhna ho ya koi bhi kaam, sirf mere kehne par karna.`;
    const el = document.createElement('div');
    el.id = 'clavis-voiceid-sheet';
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-label', 'Voice ID setup');
    el.innerHTML = `
      <div class="cv-card">
        <div class="cv-ring"><svg viewBox="0 0 44 44" aria-hidden="true"><circle cx="22" cy="22" r="19" class="cv-track"/><circle cx="22" cy="22" r="19" class="cv-fill"/></svg><span class="cv-mic" aria-hidden="true">●</span></div>
        <h3>Voice ID</h3>
        <p class="cv-sub">Yeh line normal awaaz me padhiye. Clavis aapki awaaz pehchanega aur background ki baaton ko ignore karega.</p>
        <p class="cv-line">“${line.replace(/[<>&]/g, '')}”</p>
        <p class="cv-status" aria-live="polite">Tayyar hone par Start dabaiye.</p>
        <div class="cv-actions"><button type="button" class="cv-cancel">Cancel</button><button type="button" class="cv-start">Start</button></div>
      </div>`;
    document.body.appendChild(el);
    requestAnimationFrame(() => el.classList.add('is-in'));
    const status = el.querySelector('.cv-status');
    const fill = el.querySelector('.cv-fill');
    const close = () => { el.classList.remove('is-in'); setTimeout(() => el.remove(), 320); };
    return new Promise((resolve) => {
      el.querySelector('.cv-cancel').onclick = () => { close(); resolve(null); };
      el.querySelector('.cv-start').onclick = async (ev) => {
        ev.currentTarget.disabled = true;
        el.classList.add('is-recording');
        status.textContent = 'Sun raha hoon… line padhiye.';
        try {
          const res = await voiceId.enroll({ onProgress: (p) => { fill.style.strokeDashoffset = String(119.4 * (1 - p)); } });
          status.textContent = 'Ho gaya — ab main aapki awaaz pehchanta hoon.';
          el.classList.remove('is-recording');
          el.classList.add('is-done');
          setTimeout(close, 1300);
          resolve(res);
        } catch (err) {
          el.classList.remove('is-recording');
          status.textContent = err?.message || 'Record nahi ho paya — dobara try karein.';
          ev.currentTarget.disabled = false;
        }
      };
    });
  }

  /* ── self-test (pure parts) ────────────────────────────────── */
  function _selfTest() {
    testing = true;
    const savedState = { speaking: said.speaking, endedAt: said.endedAt, lastText: said.lastText };
    const saved = said.items.slice();
    said.items = [];
    remember('Theek hai sir, Delhi NCR ki 20 leads nikal raha hoon.');
    said.speaking = true;
    const checks = [
      skel('leads') === skel(deva2latin('लीड्स')),
      skel('theek') === skel(deva2latin('ठीक')),
      skel('clavis') === skel(deva2latin('क्लेविस')),
      echo('delhi ncr ki leads nikal raha').score >= 0.8,
      echo('दिल्ली एनसीआर की लीड्स').score >= 0.5,
      judge('theek hai sir delhi ncr ki leads').reason === 'echo',
      judge('ruko ruko').barge === true,
      judge('nahi mujhe Noida ki hospital list chahiye').accept === true,
      judge('mummy ne khana bana liya hai').accept === false,
    ];
    said.speaking = false; said.endedAt = 0; said.items = [];
    checks.push(
      judge('mummy ne khana bana liya', { openMic: true }).accept === false,
      judge('Clavis mummy ko call karo', { openMic: true }).accept === true,
      judge('map band karo', { openMic: true }).accept === false,
      judge("I'm going to go to the next video", { openMic: true }).accept === false,
      judge('photos dikhao').accept === true,
    );
    said.items = saved;
    Object.assign(said, savedState);
    testing = false;
    const dt = createDoubleTalk({ k0: 0.3 });
    let fired = false;
    for (let i = 0; i < 60; i++) fired = dt.update(0.02, 0.1).loud || fired;   // echo only
    const bargeHit = dt.update(0.2, 0.1).loud;                                   // sir talks over it
    checks.push(!fired, bargeHit);
    const passed = checks.filter(Boolean).length;
    console[passed === checks.length ? 'log' : 'error'](`ClavisEar self-test: ${passed}/${checks.length}`, checks);
    return passed === checks.length;
  }

  // Settings panel: reflect the stored Voice ID / caption state.
  function syncUi() {
    const st = voiceId.status();
    const t = document.getElementById('sm-voiceid-toggle');
    if (t) { t.checked = st.enabled; t.disabled = !st.enrolled; }
    const b = document.getElementById('sm-voiceid-btn');
    if (b) b.textContent = st.enrolled ? 'Re-register voice' : 'Register my voice';
    const h = document.getElementById('sm-voiceid-hint');
    if (h && st.enrolled) h.textContent = 'Registered — background voices are ignored unless they say “Clavis”.';
    const c = document.getElementById('sm-live-caption-toggle');
    if (c) c.checked = capEnabled();
  }
  window.clavisSyncVoiceIdUi = syncUi;

  /* ── one-time permission (first launch only) ───────────────── */
  // Sir asked to grant everything ONCE and never press a button again.
  // One card on first launch; the choice is saved, the browser remembers
  // the mic for this origin, and every later launch starts hands-free,
  // screen awareness and proactive help on its own.
  const CONSENT = 'clavis_consent_v1';
  async function grantAll(card) {
    let mic = false;
    try { mic = await (window.requestClavisMicrophoneOnce?.() ?? Promise.resolve(false)); } catch (_) {}
    if (mic) {
      lsSet('jarvis_hands_free', 'true');
      lsSet('clavis_sound_trigger_enabled', 'true');
      try { window.dispatchEvent(new CustomEvent('clavis:mic-granted')); } catch (_) {}
    }
    try { window.ClavisVision?.setEnabled?.(true); window.ClavisVision?.start?.(); } catch (_) {}
    try { window.ClavisProactive?.setEnabled?.(true); } catch (_) {}
    lsSet(CONSENT, JSON.stringify({ at: now(), mic, screen: true, proactive: true }));
    card?.querySelector('.cv-status') && (card.querySelector('.cv-status').textContent = mic
      ? 'Ho gaya, sir. Ab bas app kholiye aur boliye — main sun rahi hoon.'
      : 'Mic browser ne block kiya hai — address bar ke mic icon se allow kar dijiye.');
    setTimeout(() => { card?.classList.remove('is-in'); setTimeout(() => card?.remove(), 320); }, mic ? 1500 : 3200);
  }
  function consentCard() {
    if (lsGet(CONSENT) || document.getElementById('clavis-voiceid-sheet')) return;
    if (lsGet('clavis_mic_permission_granted') === 'true') { lsSet(CONSENT, JSON.stringify({ at: now(), mic: true, inferred: true })); return; }
    if (location.protocol === 'file:') return;   // the mic can't be kept on file:// pages
    const el = document.createElement('div');
    el.id = 'clavis-voiceid-sheet';
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-label', 'Clavis permissions');
    el.innerHTML = `
      <div class="cv-card">
        <h3>Clavis ko ek baar ijazat dijiye</h3>
        <p class="cv-sub">Sirf pehli baar. Uske baad app kholte hi Clavis sunegi, screen dekh kar madad offer karegi — koi button nahi.</p>
        <p class="cv-line" style="font-style:normal;text-align:left;line-height:1.9">🎙️ Mic — hands-free, "Clavis" bolte hi<br>🖥️ Screen samajh kar sahi waqt pe suggestions<br>💡 Khud se yaad dilana aur help offer karna</p>
        <p class="cv-status" aria-live="polite">Aap Settings me kabhi bhi band kar sakte hain.</p>
        <div class="cv-actions"><button type="button" class="cv-cancel">Baad me</button><button type="button" class="cv-start">Sab allow karein</button></div>
      </div>`;
    document.body.appendChild(el);
    requestAnimationFrame(() => el.classList.add('is-in'));
    el.querySelector('.cv-cancel').onclick = () => { el.classList.remove('is-in'); setTimeout(() => el.remove(), 320); };
    el.querySelector('.cv-start').onclick = (ev) => { ev.currentTarget.disabled = true; grantAll(el); };
  }
  setTimeout(() => { try { consentCard(); } catch (_) {} }, 2600);
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', syncUi, { once: true }); else setTimeout(syncUi, 0);

  window.ClavisEar = {
    version: '1.0',
    noteSpeaking, noteSpoken, noteSpeakingDone, isSpeaking, msSinceSpoke,
    echo, judge, named, looksLikeRequest,
    caption, voiceId, tap, createDoubleTalk,
    _skel: skel, _deva2latin: deva2latin, _selfTest,
  };
})();
