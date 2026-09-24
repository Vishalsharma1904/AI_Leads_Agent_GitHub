/**
 * CLAVIS EMOTIONAL ENGINE
 *
 * A small deterministic companion to the LLM.  The model still owns meaning
 * and decisions; this module supplies the social context that models cannot
 * reliably police by themselves: the user's current affect, language mode,
 * speech prosody, and a mechanical anti-repetition buffer.
 *
 * No network, audio, or secret access lives here.  That keeps it usable in
 * browser-only mode and makes its behaviour easy to regression-test.
 */
'use strict';

(() => {
  const STORE = 'clavis_emotional_memory';
  const MAX_RECENT = 8;
  const HINGLISH = new Set([
    'hai', 'hoon', 'hun', 'raha', 'rahi', 'rahe', 'kya', 'kaise', 'kaun',
    'kahan', 'kab', 'kyun', 'kyu', 'nahi', 'nahin', 'haan', 'bhi', 'abhi',
    'sirf', 'bas', 'thoda', 'bahut', 'bohot', 'zyada', 'jyada', 'kam',
    'chahiye', 'chahta', 'chahti', 'karo', 'kariye', 'karna', 'karenge',
    'kijiye', 'dijiye', 'dena', 'lena', 'aap', 'aapka', 'aapki', 'aapko',
    'tum', 'tumhe', 'tumhara', 'main', 'mera', 'meri', 'mujhe', 'hum',
    'humein', 'hamara', 'sir', 'ji', 'acha', 'accha', 'theek', 'thik',
    'sahi', 'galat', 'bata', 'batao', 'bataiye', 'suniye', 'suno', 'kuch',
    'koi', 'sab', 'sabhi', 'wala', 'wali', 'wale', 'yeh', 'ye', 'woh', 'wo',
    'iska', 'uska', 'iske', 'uske', 'namaste', 'shukriya', 'maaf', 'matlab',
    'samajh', 'samjha', 'kar', 'do', 'de', 'lo', 'ho', 'gaya', 'gayi', 'rahega'
  ]);

  const EMOTION_PATTERNS = {
    frustrated: /\b(frustrat(?:ed|ing)|irritat(?:ed|ing)|annoy(?:ed|ing)|gussa|pareshan|tang|bakwaas|bekaar|kharaab|broken|not working|doesn't work|nahi chal|problem|issue|hate|fed up|ugh)\b|[!]{2,}|[?]{3,}/i,
    anxious: /\b(worried|scared|afraid|nervous|tension|chinta|darr|dar|ghabra|deadline|urgent|jaldi|fikar)\b/i,
    sad: /\b(sad|low|dukhi|udaas|akela|lonely|demotivated|thak gaya|thak gayi)\b/i,
    excited: /\b(excited|awesome|amazing|wow|yay|let's go|shandar|शानदार|zabardast|maza aa|khush|happy|great news)\b|!{1,}/i,
    curious: /\?|\b(why|how|what|kya|kaise|kyun|samjhao|explain|batao)\b/i,
  };

  function text(value) { return String(value || '').replace(/\s+/g, ' ').trim(); }

  function read() {
    try {
      const value = JSON.parse(localStorage.getItem(STORE) || '{}');
      return value && typeof value === 'object' ? value : {};
    } catch (_) { return {}; }
  }

  function write(value) {
    try { localStorage.setItem(STORE, JSON.stringify(value)); } catch (_) {}
  }

  function languageOf(value) {
    const input = text(value);
    if (!input) return 'en';
    if (/[ऀ-ॿ]/.test(input)) return 'hi';
    const words = input.toLowerCase().match(/[a-z']+/g) || [];
    const hits = words.filter(word => HINGLISH.has(word)).length;
    if (hits && hits / Math.max(words.length, 1) >= 0.15) return 'hinglish';
    return 'en';
  }

  function inferUserEmotion(value) {
    const input = text(value);
    if (!input) return { name: 'neutral', confidence: 0.35, arousal: 0.35, warmth: 0.5 };
    for (const [name, pattern] of Object.entries(EMOTION_PATTERNS)) {
      if (pattern.test(input)) {
        const confidence = name === 'curious' ? 0.7 : 0.78;
        return {
          name,
          confidence,
          arousal: name === 'sad' ? 0.25 : name === 'anxious' ? 0.6 : name === 'frustrated' ? 0.72 : 0.68,
          warmth: name === 'frustrated' || name === 'anxious' || name === 'sad' ? 0.9 : 0.6,
        };
      }
    }
    return { name: 'neutral', confidence: 0.42, arousal: 0.4, warmth: 0.55 };
  }

  function speechProsody(value) {
    const input = text(value);
    const lower = input.toLowerCase();
    const p = {
      name: 'composed', pitchMultiplier: 1, rateMultiplier: 1, volume: 1,
      pauseAfter: 145, tag: '',
    };
    if (/[?]$/.test(input) || /\b(kya|kaise|kyun|should i|can i|would you)\b/i.test(lower)) {
      p.name = 'curious'; p.pitchMultiplier = 1.04; p.rateMultiplier = 0.98; p.pauseAfter = 190;
    } else if (/\b(chinta mat|tension mat|don't worry|no worries|aram se|i understand|samajh)\b/i.test(lower)) {
      p.name = 'reassuring'; p.pitchMultiplier = 0.96; p.rateMultiplier = 0.93; p.volume = 0.98; p.pauseAfter = 185; p.tag = '<soft>';
    } else if (/\b(error|warning|savdhan|caution|danger|failed|blocked|issue|problem)\b/i.test(lower)) {
      p.name = 'alert'; p.pitchMultiplier = 0.95; p.rateMultiplier = 0.9; p.volume = 1.02; p.pauseAfter = 205; p.tag = '<lower-pitch>';
    } else if (/[!]$/.test(input) || /\b(shandar|zabardast|great|excellent|done|ho gaya|perfect|bilkul)\b/i.test(lower)) {
      p.name = 'bright'; p.pitchMultiplier = 1.025; p.rateMultiplier = 1.025; p.volume = 1.02; p.pauseAfter = 135; p.tag = '<emphasis>';
    } else if (/\b(soch raha|analyz|checking|dekh raha|one moment|scanning|calculating)\b/i.test(lower)) {
      p.name = 'thoughtful'; p.pitchMultiplier = 0.97; p.rateMultiplier = 0.91; p.volume = 0.97; p.pauseAfter = 215; p.tag = '<soft>';
    }
    return p;
  }

  function opener(value) {
    const input = text(value).replace(/^[-*•\s]+/, '');
    if (!input) return '';
    const first = input.split(/[.!?\n]/)[0].trim();
    return first.split(/\s+/).slice(0, 6).join(' ').toLowerCase();
  }

  function acknowledgement(value) {
    const input = text(value).replace(/^[-*•\s]+/, '');
    if (!input) return '';
    const first = input.split(/[,:.!?\n]/)[0].trim();
    const words = first.split(/\s+/).slice(0, 3).join(' ');
    return /^(haan|ji|bilkul|theek|samajh|got it|sure|understood|of course|right|okay|ok|yes|no)\b/i.test(words)
      ? words.toLowerCase() : '';
  }

  function recent() {
    const value = read();
    return {
      openers: Array.isArray(value.openers) ? value.openers.slice(-3) : [],
      acknowledgements: Array.isArray(value.acknowledgements) ? value.acknowledgements.slice(-2) : [],
      replies: Array.isArray(value.replies) ? value.replies.slice(-MAX_RECENT) : [],
      repetitionRate: Number(value.repetitionRate || 0),
      turns: Number(value.turns || 0),
    };
  }

  function rememberAssistant(value) {
    const reply = text(value);
    if (!reply) return recent();
    const valueStore = read();
    const previous = recent();
    const nextOpener = opener(reply);
    const nextAck = acknowledgement(reply);
    const repeated = Boolean(
      (nextOpener && previous.openers.includes(nextOpener)) ||
      (nextAck && previous.acknowledgements.includes(nextAck)) ||
      previous.replies.includes(reply)
    );
    const turns = previous.turns + 1;
    valueStore.openers = [...previous.openers, nextOpener].filter(Boolean).slice(-3);
    valueStore.acknowledgements = [...previous.acknowledgements, nextAck].filter(Boolean).slice(-2);
    valueStore.replies = [...previous.replies, reply].slice(-MAX_RECENT);
    valueStore.turns = turns;
    valueStore.repetitionRate = ((previous.repetitionRate * (turns - 1)) + (repeated ? 1 : 0)) / turns;
    write(valueStore);
    return { ...recent(), repeated };
  }

  function doNotReuse() {
    const value = recent();
    return [...value.openers, ...value.acknowledgements].filter(Boolean).slice(-5);
  }

  function pickDifferent(pool, scope = 'default') {
    const choices = Array.isArray(pool) ? pool.filter(Boolean) : [];
    if (choices.length <= 1) return choices[0] || '';
    const memory = read();
    const last = memory.picks && memory.picks[scope];
    const candidates = choices.filter(item => item !== last);
    const choice = candidates[Math.floor(Math.random() * candidates.length)] || choices[0];
    memory.picks = { ...(memory.picks || {}), [scope]: choice };
    write(memory);
    return choice;
  }

  function shouldRewrite(value) {
    const candidate = text(value);
    if (!candidate) return false;
    const state = recent();
    return Boolean(state.replies.includes(candidate) || (opener(candidate) && state.openers.includes(opener(candidate))));
  }

  function buildPromptContext(userText = '') {
    const emotion = inferUserEmotion(userText);
    const language = languageOf(userText);
    const avoid = doNotReuse();
    return [
      `USER_LANGUAGE: ${language}`,
      `USER_EMOTION: ${emotion.name} (confidence ${emotion.confidence.toFixed(2)})`,
      `EMOTIONAL_RESPONSE: ${emotion.name === 'frustrated' ? 'acknowledge briefly, stay calm, fix the issue' : emotion.name === 'anxious' ? 'reassure without false promises' : emotion.name === 'sad' ? 'be gentle and unhurried' : emotion.name === 'excited' ? 'match the energy with measured warmth' : 'stay attentive and natural'}`,
      `DO_NOT_REUSE_OPENERS: ${JSON.stringify(avoid)}`,
      'VARIETY_RULE: Change cadence and structure when the context changes. Never add a generic offer just to fill silence.',
    ].join('\n');
  }

  function decorateSpeech(value) {
    const input = text(value);
    if (!input) return '';
    const parts = input.split(/(?<=[.!?।])\s+/).filter(Boolean);
    return parts.map((part, index) => {
      const prosody = speechProsody(part);
      const tag = prosody.tag;
      const wrapped = tag ? `${tag}${part}${tag.replace('<', '</')}` : part;
      const pause = index < parts.length - 1 ? (prosody.name === 'alert' ? '[long-pause]' : '[pause]') : '';
      return `${wrapped}${pause}`;
    }).join(' ');
  }

  function reset() { try { localStorage.removeItem(STORE); } catch (_) {} }

  window.ClavisEmotionalEngine = Object.freeze({
    languageOf,
    inferUserEmotion,
    speechProsody,
    buildPromptContext,
    rememberAssistant,
    recent,
    doNotReuse,
    pickDifferent,
    shouldRewrite,
    decorateSpeech,
    reset,
  });
})();
