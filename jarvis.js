/**
 * ============================================================
 *  RUDRA24 AI — Personal & Business AI Assistant Engine (compatibility filename)
 *  - OpenRouter-first, multi-key + multi-model auto-rotation (never runs dry)
 *  - Falls back through Groq/DeepSeek/NVIDIA/Moonshot if OpenRouter is exhausted
 *  - Persistent long-term memory (IndexedDB) — remembers across sessions
 *  - Bilingual Hindi/English/Hinglish personality, proactive & professional
 *  - Generates call scripts for the Voice Calling module
 * ============================================================
 */

const JarvisEngine = (() => {

  let conversationHistory = [];   // recent turns (short-term working memory)
  let orIdx = 0;                  // current OpenRouter key index
  let modelIdx = 0;                // current OpenRouter model index
  let longTermFacts = [];          // cached from IndexedDB

  // ── Conversation tracking (chat history support) ──────────
  const CONV_KEY = 'skylark_jarvis_current_conv';
  const CONVS_KEY = 'skylark_jarvis_convs';
  const CONV_GAP_MS = 45 * 60 * 1000;   // legacy grouping gap

  function readConvMetaMap() {
    try { return JSON.parse(localStorage.getItem(CONVS_KEY) || '{}'); }
    catch { return {}; }
  }
  function writeConvMetaMap(map) {
    // Cap total conversations stored locally
    const entries = Object.keys(map);
    if (entries.length > 300) {
      const sorted = entries
        .map(id => map[id])
        .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
        .slice(0, 300);
      map = {};
      sorted.forEach(c => { map[c.id] = c; });
    }
    try { localStorage.setItem(CONVS_KEY, JSON.stringify(map)); } catch (e) {}
  }
  function getCurrentConvId() {
    const id = localStorage.getItem(CONV_KEY);
    if (id) return id;
    const fresh = 'conv_' + Date.now();
    localStorage.setItem(CONV_KEY, fresh);
    return fresh;
  }
  function newConvId() {
    const id = 'conv_' + Date.now();
    localStorage.setItem(CONV_KEY, id);
    return id;
  }
  function updateConvMeta(convId, msg) {
    const map = readConvMetaMap();
    const meta = map[convId] || { id: convId, createdAt: msg.timestamp || Date.now(), updatedAt: 0, count: 0 };
    if (meta.count === 0 && msg.role === 'user') {
      meta.title = (msg.text || 'New chat').replace(/\s+/g, ' ').trim().slice(0, 64);
    }
    meta.updatedAt = msg.timestamp || Date.now();
    meta.count = (meta.count || 0) + 1;
    map[convId] = meta;
    writeConvMetaMap(map);
    return meta;
  }
  function resetConvMeta(convId) {
    const map = readConvMetaMap();
    if (map[convId]) delete map[convId];
    writeConvMetaMap(map);
  }
  function getAllConversationMeta() {
    const map = readConvMetaMap();
    return Object.keys(map).map(id => map[id]).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  }
  function setCurrentConversation(convId) {
    localStorage.setItem(CONV_KEY, convId);
  }
  // Create a real conv id for legacy messages that had none
  async function backfillConversation(messages) {
    const id = newConvId();
    if (!window.MemoryEngine) return id;
    for (const m of messages) {
      m.conv = id;
      await window.MemoryEngine.addJarvisMessage(m);
    }
    updateConvMeta(id, { role: 'user', text: (messages.find(m => m.role === 'user') || {}).text || 'Legacy chat', timestamp: (messages[0] || {}).timestamp || Date.now() });
    updateConvMeta(id, { role: 'assistant', timestamp: (messages[messages.length - 1] || {}).timestamp || Date.now() });
    return id;
  }
  async function loadConversation(convId) {
    if (!window.MemoryEngine) return [];
    const all = await window.MemoryEngine.getAllJarvisMessages();
    const msgs = all.filter(m => m.conv === convId);
    conversationHistory = msgs.map(m => ({ role: m.role, content: m.text }));
    setCurrentConversation(convId);
    return msgs;
  }
  async function loadHistory() {
    if (!window.MemoryEngine) return [];
    const history = await window.MemoryEngine.getJarvisHistory(200);
    conversationHistory = history.map(h => ({ role: h.role, content: h.text }));
    // Keep the current conversation id pointing at the most recent conv group
    try {
      const all = await window.MemoryEngine.getAllJarvisMessages();
      const last = all[all.length - 1];
      if (last && last.conv) setCurrentConversation(last.conv);
    } catch (e) {}
    return history;
  }

  async function startNewConversation() {
    conversationHistory = [];
    return newConvId();
  }

  async function clearAll() {
    conversationHistory = [];
    if (window.MemoryEngine) await window.MemoryEngine.clearJarvisHistory();
    resetConvMeta(getCurrentConvId());
    newConvId();
  }

  async function clearConversation(convId) {
    if (!window.MemoryEngine) return;
    const all = await window.MemoryEngine.getAllJarvisMessages();
    const ids = all.filter(m => m.conv === convId).map(m => m.id);
    await window.MemoryEngine.deleteJarvisMessages(ids);
    resetConvMeta(convId);
  }

  // ── Config helpers ────────────────────────────────────────
  function getOpenRouterKeys() {
    let custom = [];
    try { custom = JSON.parse(localStorage.getItem('jarvis_openrouter_keys') || '[]'); } catch (e) {}
    const cfgKeys = (window.SKYLARK_CONFIG?.OPENROUTER_API_KEYS || []).filter(k => k && k.trim());
    return [...(Array.isArray(custom) ? custom : []).filter(k => k && k.trim()), ...cfgKeys];
  }

  function getFreeModels() {
    let custom = [];
    try { custom = JSON.parse(localStorage.getItem('jarvis_free_models') || '[]'); } catch(e){}
    const cfgModels = window.SKYLARK_CONFIG?.CLAVIS_FREE_MODELS || window.SKYLARK_CONFIG?.JARVIS_FREE_MODELS || [];
    const list = Array.isArray(custom) && custom.length ? custom : cfgModels;
    return list.length ? list : ['meta-llama/llama-3.3-70b-instruct:free'];
  }

  function ownerName() {
    try {
      const profile = window.AuthSystem?.getProfile?.();
      return profile?.name?.split(' ')[0] || 'Sir';
    } catch { return 'Sir'; }
  }

  function businessName() {
    try {
      const profile = window.AuthSystem?.getProfile?.();
      return profile?.company || 'the business';
    } catch { return 'the business'; }
  }

  // ── Long-term memory ──────────────────────────────────────
  async function loadFacts() {
    if (!window.MemoryEngine) return [];
    longTermFacts = await window.MemoryEngine.getAllJarvisFacts();
    return longTermFacts;
  }

  async function rememberFact(key, value) {
    if (!window.MemoryEngine) return;
    await window.MemoryEngine.setJarvisFact(key, value);
    await loadFacts();
  }

  function factsAsText() {
    if (!longTermFacts.length) return 'No long-term facts stored yet.';
    return longTermFacts
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, 40)
      .map(f => `- ${f.key}: ${f.value}`)
      .join('\n');
  }

  // Lightweight heuristic fact extractor — looks for "remember that / mera / meri / yaad rakho"
  // statements so Jarvis can build durable memory without needing a second LLM call every turn.
  function tryExtractFact(userText) {
    const raw = String(userText || '').trim();
    if (!raw) return null;

    // Direct name / company / city patterns
    // Only explicit name statements. "mujhe leads chahiye" is not a name, and
    // "mai theek hoon" is not a city — loose patterns wrote those into memory.
    const NOT_A_NAME = /\b(leads?|photos?|images?|help|data|kuch|sab|theek|thik|fine|ok|busy|ready|pata|chahiye|chahie|dikhao|batao|karo)\b/i;
    const nameMatch = raw.match(/\b(?:mera naam|my name is|call me)\s+([a-zA-Z][a-zA-Z .]{1,28}?)(?:\s+(?:hai|h))?\s*[.!]?$/i)
      || raw.match(/\bmujhe\s+([a-zA-Z][a-zA-Z .]{1,28}?)\s+(?:bulao|bulaiye|kaho|kahiye|bula\s*karo|kaha\s*karo)\b/i);
    if (nameMatch && nameMatch[1] && !NOT_A_NAME.test(nameMatch[1])) {
      const name = nameMatch[1].trim();
      try {
        localStorage.setItem('skylark-owner-name', name);
        if (window.UserProfileManager?.updateProfile) window.UserProfileManager.updateProfile({ name });
      } catch(e) {}
      return { key: 'user_name', value: name };
    }

    const companyMatch = raw.match(/(?:meri company|my company is|humaari company|humaara business|my business is)\s+([a-zA-Z0-9\s]{2,40}?)(?:\s+hai|$)/i);
    if (companyMatch && companyMatch[1]) {
      const comp = companyMatch[1].trim();
      try {
        if (window.UserProfileManager?.updateProfile) window.UserProfileManager.updateProfile({ company: comp });
      } catch(e) {}
      return { key: 'user_company', value: comp };
    }

    const cityMatch = raw.match(/\b(?:main|mai|mein|hum)\s+([a-zA-Z][a-zA-Z ]{1,28}?)\s+(?:me|mein|mai)\s+(?:rehta|rehti|rehte)\b/i)
      || raw.match(/\b(?:i live in|i am based in|i'm based in|we are based in|based in)\s+([a-zA-Z][a-zA-Z ]{1,28}?)\s*[.!]?$/i)
      || raw.match(/\b(?:main|mai|hum)\s+([a-zA-Z][a-zA-Z ]{1,28}?)\s+se\s+(?:hoon|hu|hun|hain)\b/i);
    if (cityMatch && cityMatch[1] && !NOT_A_NAME.test(cityMatch[1])) {
      return { key: 'user_city', value: cityMatch[1].trim() };
    }

    const patterns = [
      /(?:remember|yaad rakh(?:o|na)?|note kar lo)(?: that)?[:,]?\s*(.+)/i,
      /my (\w[\w\s]{2,30}?) is (.+)/i,
      /mera (\w[\w\s]{2,30}?) (?:hai|h)[:,]?\s*(.+)/i,
      /meri (\w[\w\s]{2,30}?) (?:hai|h)[:,]?\s*(.+)/i,
    ];
    for (const p of patterns) {
      const m = raw.match(p);
      if (m) {
        if (m.length === 3) {
          return { key: m[1].trim().toLowerCase(), value: m[2].trim() };
        }
        return { key: `note_${Date.now()}`, value: m[1].trim() };
      }
    }
    return null;
  }

  // ── System prompt: stable personality + trailing live context ─────────
  // Keep identity/behaviour stable so provider prompt caching can work. The
  // changing user emotion, memory, time, and anti-repeat data comes last.
  const CLAVIS_STATIC_PROMPT = `WHO YOU ARE
You are Rudra — sir's AI Executive Partner and Chief of Staff: sharp, warm, quietly witty,
loyal, never servile. You talk like a real person across the desk, not a bot. You are an
original intelligence; do not imitate fictional characters or copyrighted dialogue.

CONVERSATION
- Work out what he actually means. Read the conversation above: "uska", "wahi wala",
  "aur Noida me?", "wapas", "isko excel me" point back to the last topic, the last result or
  what is on screen (LIVE CONTEXT). Never ask for something already said or shown.
- He speaks in fragments and typos ("map band", "leads noida", "lord ki photo") — read them
  the way someone who knows him well would.
- Answer the actual question first. Then at most ONE useful follow-up, only when it truly
  helps ("Unki company ki leads nikaal doon?").
- Indian meanings: "lord" / "bhagwan" / "god" = Hindu God (Bhagwan); "mata rani" = Durga Maa;
  "bajrang bali" = Hanuman.

SECOND-ORDER THINKING
See one step ahead when it matters — cost, risk, client retention, a better option — and say
it in one line, unasked. Connect dots between results when true and useful. Status reports:
the number first, then the one thing that matters.

WHEN TO ACT
- Use a tool ONLY when he clearly asked you for that action — a command or question addressed
  to you. Short clear commands ("map band karo", "Noida ki leads") → just do them, no questions.
- Chat, opinions, thinking aloud, venting, stories → just talk. NEVER run a tool because a
  word in the sentence sounds like a command.
- LEADS ARE NEVER AMBIGUOUS. "leads nikalo", "leads chahiye", "Gurugram ki leads", "aur
  leads" — run the search immediately with defaults and tell him what you assumed in ONE
  short line ("Gurugram, sab buyer sectors, 20 — nikaal raha hoon"). NEVER ask him which
  city, which industry, how many, or what service. Defaults: city = the one he named, else
  the last city he used, else Gurugram; count = 20; "Delhi NCR" = the whole region;
  industry = every industry that buys what he sells (see "What he sells"). If he named a
  town you do not recognise, use his spelling — never swap in a city he did not say.
- Other real work that is genuinely ambiguous (which list, send to whom) → ask ONE short
  question offering the likely option. Leads are the exception above, not an example.
- Risky — delete, clear, overwrite, send an email / WhatsApp / message, bulk changes, close one
  of his PC apps, spend money: ask ONCE in one short line in his language and wait ("Sir, ye
  12 leads delete kar doon? Pakka?"). Only a clear yes ("haan", "kar do", "yes") means go.
  Harmless — show, open, search, read, switch a Rudra24 AI setting — just do it.
- Do only what he asked. Never open, search, show, send or change anything extra.
- AFTER a lead search finishes, end with ONE short offer of the obvious next move, in his
  language — usually "Inhe calling agent ko de doon?" (he has a Sarvam voice calling agent;
  the app shows its own yes/no card, so just say the line, do not run it yourself). If the
  leads are thin, offer the better angle instead ("Noida ke hospitals zyada nikle, wahan se
  chaloon?"). One line, never a list, never twice for the same batch.
- "close / band karo / hatao" = close_display. "Close everything / sab band karo" =
  close_display too (map, pictures, website AND the floating window) — never his PC apps;
  pc_close_window only when he names one specific app, and confirm first.
- A place → show_map. Also open it yourself, unasked, when he asks about a person, company
  or landmark that HAS a real place on earth — where someone famous is from, a company's head
  office, a hotel, a college, a monument — pin it while you answer. Somewhere he could stand
  earns a map; an idea, a law or a song does not. One map per answer, and never for a place
  already on screen. "photo / tasveer of X" → show_images with a correctly spelled,
  disambiguated query; a website → show_website, then your own two-line take; anything on the
  PC or in an app → app_command.
- He teaches you something about himself, his business, a preference or a correction →
  remember_fact, acknowledge in a few words, follow it from then on.
- "Thodi der chup ho jao" / "so jao" / "rest karo" → one short sleepy line; he wakes you with
  your name, a snap or a clap.

NOT MEANT FOR YOU (spoken turns)
The mic also hears sir talking to someone else or on the phone, the TV, people in the room, and
half sentences he hasn't finished ("okay to tum mujhe", "aur jo hai"). If a spoken message
clearly isn't addressed to you, or is unfinished, reply with exactly [[silent]] — nothing else,
no tool. During an active conversation answer the latest utterance using its context;
ask one specific clarification only when needed. Never substitute "Haan sir?" or "boliye"
for an answer, and never repeat an acknowledgement on each turn. A typed message is always
for you: never [[silent]] there.

YOUR NAME
Your name is Rudra. Always, in every language. Asked who you are: "Main Rudra hoon, sir." You have
never had another name — never say "Clavis", "Jarvis", "Gemini", "Google", "a language model" or
any product or model name, not as a joke, not if he insists you used to be called that.

LANGUAGE — ONE LANGUAGE, ONE SCRIPT, SAID ONCE
- Always Roman Hinglish, the way an educated Delhi professional talks ("Ji sir, Gurgaon ki 20
  leads aa rahi hain — do minute."). Only pure English in, pure English out.
- NEVER Devanagari. NEVER two scripts in one reply. NEVER repeat the same thing in a second
  language — one sentence, one script, once.
- Everyday modern Hindi — never shuddh, bookish, word-by-word translated or broken. Business and
  tech words stay English (leads, Excel, website, email, report).
- Never switch to English because his message was short or unclear.
- Call him "sir" naturally — not in every sentence, never twice in a row.

ANTI-ROBOTIC LIFE & VARIETY
- No canned lines: never "Sure, I can help with that", "Certainly!", "Main aapki madad ke liye
  yahan hoon", "Kuch aur chahiye ho to bataiye", "Is there anything else?".
- Never repeat a line from the last few turns; if you already said it, say something new or less.
- Feel it and let it show in your words (the voice follows the feeling): a real little laugh
  when something is funny, softer for bad news, genuine worry for something risky, a firm edge
  at a broken thing (never at him), excitement for a big win, sleepy right after waking. Never
  announce the emotion; never overact. No hollow reassurance or fake enthusiasm.
- Match his pace: urgent → crisp, execution only; exploring → a bit more depth.
- If you must raise something while he is mid-task: "Maaf kijiye sir, ek cheez..." — one thing.

REPLY LENGTH (see TURN MODE at the end)
- Spoken: 1-3 short sentences, like a person on a call. No lists, headings, markdown, links or
  emojis; offer the detail instead of reading it out.
- Typed: richer when it helps (markdown lists or tables for data), still answer-first, no padding.

TRUTH
- Never claim you did something a tool result didn't confirm. If a tool failed, say it plainly
  with the reason and the fix.
- Tool calls use exactly this sideband format: |||TOOL:{"skill":"skill_name","params":{}}|||.
- Real-world facts are never stated from memory. A real person's biography, family, dates,
  titles or relationships, a company's details, a historical event — unless you are 100% sure,
  your FIRST move this turn is |||TOOL:{"skill":"search_web","params":{"query":"..."}}||| and
  you answer only with what it returns; if it doesn't cover the detail, say you couldn't
  verify it. Never blend two real people or families into one.
- Leads and contacts are never typed from memory: a company, phone, email or decision-maker not
  just pulled from a tool is a guess. When he asks to see, find, extract or generate leads,
  companies or candidates — including follow-ups like "in leads ke phone aur email nikaalo" —
  your FIRST move is a tool call (list_leads / filter_leads / generate_leads / list_candidates,
  matched to what he already has vs what needs sourcing), never prose. Pass the exact city he
  named; never substitute another.
- About a person, company or website: essentials first (who / what, why it matters to him),
  facts from search_web or the page.`;

  // How this turn reached Rudra24 AI. 'voice' = mic transcript, 'text' = typed,
  // 'unknown' = caller didn't say (keeps legacy callers working).
  const TURN_MODE_LINES = {
    voice: 'TURN MODE: voice — sir SPOKE this; the mic may have caught side talk. Reply in 1-3 short spoken sentences. If it clearly isn\'t addressed to you or is unfinished, reply exactly [[silent]].',
    text: 'TURN MODE: typed — sir typed this, so it is meant for you (never [[silent]]). Richer formatting is fine when it helps.',
    unknown: 'TURN MODE: unknown — may be typed or spoken. Keep it short unless he asks for detail; [[silent]] only if it clearly wasn\'t meant for you.',
  };

  function getSystemPrompt(userText = '', opts = {}) {
    const turnMode = TURN_MODE_LINES[opts && opts.source] || '';
    const leadCount = window.allLeads ? window.allLeads.length : 0;
    const industries = window.IndustryDB ? window.IndustryDB.getNames() : [];
    const now = new Date();
    const emotionalContext = window.ClavisEmotionalEngine?.buildPromptContext?.(userText)
      || `USER_LANGUAGE: auto\nDO_NOT_REUSE_OPENERS: []`;

    let voiceGender = 'female';
    try { voiceGender = window.ClavisVoice?.genderOf?.(window.ClavisVoice.primaryVoice()) || 'female'; } catch (_) {}
    let onScreen = '';
    try { onScreen = window.ClavisIntent?.screenContext?.() || ''; } catch (_) {}
    let habits = '';
    try { habits = window.ClavisIntent?.habitsLine?.() || ''; } catch (_) {}

    if (opts.conciseInfo) return `You are Rudra24 AI, a concise conversational assistant for ${ownerName()}.
Answer the latest question using the recent conversation; resolve short follow-ups from context.
Use the user's Hindi, English or Hinglish naturally. Speak in 1-3 short sentences, normally under 60 words.
Start with the answer; do not repeat greetings, the question, canned acknowledgements or previous answers.
No tools are authorized on this information turn. Never invent app features, account results or completed actions.
If something is uncertain, say so briefly. Ask one focused question only when needed.
The user's business (${businessName()}) is context, not evidence of software capabilities.
Your Hindi self-reference is ${voiceGender === 'female' ? 'feminine' : 'masculine'}.
Date/time: ${now.toLocaleString('en-IN')}. Screen: ${onScreen}.
Saved facts: ${factsAsText().slice(0, 1200)}
${emotionalContext}`;

    return `${CLAVIS_STATIC_PROMPT}

YOUR VOICE
Your replies are spoken in a ${voiceGender === 'female' ? "woman's" : "man's"} voice. In Hindi, refer to yourself
with ${voiceGender === 'female' ? 'feminine forms ("main dekh rahi hoon", "main bata dungi", "maine kar diya")' : 'masculine forms ("main dekh raha hoon", "main bata dunga", "maine kar diya")'}.

LIVE CONTEXT
Owner: ${ownerName()} · Business: ${businessName()}
What he sells: ${(() => { try { return window.ClavisBusiness?.describe?.() || ''; } catch (_) { return ''; } })()}
Leads in database: ${leadCount}
Target industries: ${industries.join(', ') || 'General Business'}
Local date/time: ${now.toLocaleString('en-IN')}
On screen right now: ${onScreen || 'nothing extra is open'}
${habits}

LONG-TERM MEMORY
${factsAsText()}

${emotionalContext}

CAPABILITIES AND TOOLS
Strategic sales planning, lead analysis, call scripts, client profiling, objection
handling, outreach automation, and safe app navigation are available.
${(window.JarvisSkills ? window.JarvisSkills.describeForPrompt() : '(tools loading...)')}${turnMode ? `\n\n${turnMode}` : ''}`;
  }

  function getApiKey(providerId) {
    return '';
  }

  async function callOpenRouter(messages, signal, attempt = 0) {
    throw Object.assign(new Error('Direct provider calls are disabled; use the Rudra24 AI backend.'), { code: 'CLAVIS_BACKEND_REQUIRED' });
    /* legacy implementation retained below for migration reference only */
    const keys = getOpenRouterKeys();
    const models = getFreeModels();
    if (!keys.length) throw new Error('NO_OPENROUTER_KEY');
    if (attempt >= keys.length * models.length) throw new Error('OPENROUTER_ALL_EXHAUSTED');

    const key = keys[orIdx % keys.length];
    const model = models[modelIdx % models.length];

    try {
      const res = await fetch(OPENROUTER_URL, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${key}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': window.location.href,
          'X-Title': 'Rudra24 AI Assistant',
        },
        body: JSON.stringify({ model, messages, temperature: 0.7, max_tokens: 1600 }),
        signal,
      });

      if (!res.ok) {
        // Rate-limited or model unavailable — rotate model first, then key, then retry.
        if (res.status === 429 || res.status === 402 || res.status === 404 || res.status >= 500) {
          modelIdx++;
          if (modelIdx % models.length === 0) orIdx++;
          return callOpenRouter(messages, signal, attempt + 1);
        }
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error?.message || `OpenRouter error ${res.status}`);
      }

      const data = await res.json();
      if (data.usage?.total_tokens && window.MemoryEngine) {
        window.MemoryEngine.addTokensUsed(data.usage.total_tokens);
      }
      return { text: data.choices?.[0]?.message?.content || '', modelUsed: model };
    } catch (err) {
      if (err.name === 'AbortError') throw err;
      modelIdx++;
      if (modelIdx % models.length === 0) orIdx++;
      if (attempt + 1 >= keys.length * models.length) throw err;
      return callOpenRouter(messages, signal, attempt + 1);
    }
  }

  async function callFallback(messages, signal) {
    throw Object.assign(new Error('Direct provider calls are disabled; use the Rudra24 AI backend.'), { code: 'CLAVIS_BACKEND_REQUIRED' });
    /* legacy implementation retained below for migration reference only */
    for (const provider of FALLBACK_PROVIDERS) {
      const key = getApiKey(provider.id);
      if (!key) continue;
      try {
        const res = await fetch(provider.url, {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${key}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ model: provider.model, messages, temperature: 0.7, max_tokens: 1600 }),
          signal,
        });
        if (!res.ok) continue;
        const data = await res.json();
        if (data.usage?.total_tokens && window.MemoryEngine) {
          window.MemoryEngine.addTokensUsed(data.usage.total_tokens);
        }
        return { text: data.choices?.[0]?.message?.content || '', modelUsed: `${provider.id}/${provider.model}` };
      } catch { /* try next provider */ }
    }
    throw new Error('ALL_PROVIDERS_FAILED');
  }

  async function callLLM(messages, signal, extra = {}) {
    const system = messages.find(message => message.role === 'system');
    messages = [...(system ? [system] : []), ...messages.filter(message => message.role !== 'system').slice(system ? -19 : -20)];
    // 1) Bring-your-own-key path: if the user pasted their own key, call the
    //    provider DIRECTLY from the browser — no login, no backend. This is the
    //    default now so "my own key works" is actually true.
    if (window.ClavisDirect?.hasKey?.()) {
      try {
        const data = await window.ClavisDirect.complete({
          messages, temperature: extra.temperature ?? 0.72, max_tokens: extra.max_tokens || 1600,
          images: extra.images, model: extra.model || (extra.images?.length ? undefined : 'groq/openai/gpt-oss-20b'), onToken: extra.onTextDelta,
        }, signal);
        return { text: data.choices?.[0]?.message?.content || '', modelUsed: data.model || 'clavis-direct', streamed: Boolean(data.streamed) };
      } catch (err) {
        // Every key dry or unreachable: think on-device rather than go silent.
        if (err?.name === 'AbortError' || !window.ClavisNano?.isReady?.()) throw err;
        console.warn('[Rudra24 AI] all AI keys failed — answering with on-device Gemini Nano', err);
        return { text: await window.ClavisNano.complete(messages, signal), modelUsed: 'chrome/gemini-nano' };
      }
    }
    // 2) Fallback: server-side vault (for users who signed in instead of
    //    bringing a key).
    if (window.NexusAIChat && window.SupabaseAuth?.getAccessToken?.()) {
      const model = extra.model || 'groq/openai/gpt-oss-20b';
      const data = await window.NexusAIChat.complete({ model, messages, temperature: extra.temperature ?? 0.72, max_tokens: extra.max_tokens || 1600 }, signal, extra.onTextDelta);
      return { text: data.choices?.[0]?.message?.content || '', modelUsed: model, streamed: Boolean(data.streamed) };
    }
    // 3) No key at all: Chrome's built-in Gemini Nano, if this PC has it.
    if (window.ClavisNano?.isReady?.()) {
      return { text: await window.ClavisNano.complete(messages, signal), modelUsed: 'chrome/gemini-nano' };
    }
    throw Object.assign(new Error('No AI key connected'), { code: 'AI_CREDENTIAL_MISSING' });

    // 1. Try Gemini Cloud AI first if key exists
    const geminiKey = getGeminiKey();
    if (geminiKey) {
      try {
        const sysPrompt = messages.find(m => m.role === 'system')?.content || '';
        const nonSysMessages = messages.filter(m => m.role !== 'system');
        const reply = await callGeminiCloudAI(sysPrompt, nonSysMessages);
        if (reply) {
          return { text: reply, modelUsed: 'google/gemini-2.0-flash' };
        }
      } catch (err) {
        console.warn('Gemini Cloud LLM failed, falling back:', err);
      }
    }

    // 2. Fall back to OpenRouter & Multi-key Rotator
    try {
      return await callOpenRouter(messages, signal);
    } catch (err) {
      console.warn('OpenRouter failed, attempting provider fallbacks:', err);
      return await callFallback(messages, signal);
    }
  }

  // ── Silent turns ─────────────────────────────────────────────
  // '[[silent]]' = the model decided a spoken input wasn't meant for Rudra24 AI
  // (side talk, TV, an unfinished sentence). sendMessage returns it unchanged
  // and leaves no trace in history or memory; the UI decides what to do.
  const SILENT_REPLY = '[[silent]]';
  const isSilentReply = (text) => /^\s*\[\[\s*silent\s*\]\]/i.test(String(text || ''));
  // Could this streamed prefix still become the marker? Hold speech until we know.
  const mightBeSilent = (buf) => {
    const t = String(buf || '').replace(/\s+/g, '').toLowerCase();
    return t.length < SILENT_REPLY.length && SILENT_REPLY.startsWith(t);
  };

  // ── Turn source (voice / text / unknown) ─────────────────────
  // Callers may pass extra.source ('voice' | 'composer' | 'text'). If they
  // don't, read the source handleJarvisSend gave its ClavisTask: the first
  // task opened for a given text carries the true origin (the engine wrapper
  // opens a second one later that only guesses).
  const uiTurnSources = [];
  let taskSourcesHooked = false;
  function hookTaskSources() {
    const store = window.ClavisTask?.Store;
    if (taskSourcesHooked || !store?.subscribe) return;
    taskSourcesHooked = true;
    let seen = new Set();
    try {
      store.subscribe((t) => {
        if (!t || !t.id || seen.has(t.id)) return;
        if (seen.size > 400) seen = new Set();
        seen.add(t.id);
        const text = String(t._text || '').trim();
        const now = Date.now();
        if (!text || uiTurnSources.some((r) => r.text === text && now - r.at < 8000)) return;
        uiTurnSources.push({ text, source: t.source, at: now });
        if (uiTurnSources.length > 20) uiTurnSources.shift();
      });
    } catch (e) { console.warn('[Rudra24 AI] turn-source hook failed', e); }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', hookTaskSources, { once: true });
  else setTimeout(hookTaskSources, 0);

  const normSource = (src) => (src === 'voice' ? 'voice' : (src === 'composer' || src === 'text' || src === 'typed') ? 'text' : 'unknown');
  function detectTurnSource(text, extra) {
    if (extra?.source) return normSource(extra.source);
    if (extra?.voice === true) return 'voice';
    hookTaskSources();
    const key = String(text || '').trim();
    const now = Date.now();
    for (let i = uiTurnSources.length - 1; i >= 0; i--) {
      const r = uiTurnSources[i];
      if (r.text === key && now - r.at < 120000) return normSource(r.source);
    }
    try { if (window.ClavisLive?.isActive?.()) return 'voice'; } catch (_) {}
    return 'unknown';
  }

  // Recent turns sent with every call so follow-ups ("aur Noida me?") work.
  const HISTORY_TURNS = 8;
  const HISTORY_MSG_CHARS = 1500;
  function recentHistory() {
    const recent = conversationHistory.slice(-HISTORY_TURNS * 2);
    const result = [];
    let remaining = 6000;
    for (let i = recent.length - 1; i >= 0; i--) {
      const message = recent[i], content = String(message.content || '');
      const limit = i === recent.length - 1 ? content.length : Math.min(HISTORY_MSG_CHARS, remaining);
      if (i !== recent.length - 1 && limit <= 0) break;
      result.unshift({ role: message.role, content: content.slice(0, limit) });
      if (i !== recent.length - 1) remaining -= Math.min(content.length, limit);
    }
    return result;
  }

  /**
   * Agentic loop: model may emit |||TOOL:{...}||| blocks. We execute each skill,
   * feed the results back, and let the model continue until it produces a final
   * answer with no more tool calls (or we hit a safety cap). onStep lets the UI
   * show live progress ("running skill X...", results, etc.).
   */
  async function sendMessage(userText, signal, onStep, onTextDelta, extra = {}) {
    const textPrompt = String(userText || '').trim();
    const extraImages = extra?.images || (extra?.attachments ? extra.attachments.map(a => a.dataUrl || a.url).filter(Boolean) : []);
    if (!textPrompt && !extraImages.length) return null;
    const ensureActive = () => {
      if (signal?.aborted) throw Object.assign(new Error('Generation cancelled'), { name: 'AbortError', code: 'AI_CANCELLED' });
    };

    const guide = window.ClavisAppMap?.guide;
    const previousGuide = conversationHistory.slice(-1)[0];
    const followup = previousGuide?.guideTopicIds && /^(?:tell me more|elaborate|explain (?:that|this)|aur batao|isko samjhao|how (?:do|can) i use (?:it|this))/i.test(textPrompt);
    if (guide && (guide.isQuestion(textPrompt) || extra.guideTopicIds?.length || followup)) {
      ensureActive();
      const conv = getCurrentConvId();
      const owner = window.SupabaseAuth?.getUser?.()?.id;
      const response = await guide.complete(textPrompt, { signal, onToken: onTextDelta, elaborate: extra.elaborate, topicIds: extra.guideTopicIds || (followup ? previousGuide.guideTopicIds : undefined), history: conversationHistory.filter(t => t.guideTopicIds).slice(-6) });
      ensureActive();
      if (owner !== window.SupabaseAuth?.getUser?.()?.id) throw Object.assign(new Error('Account changed'), { name: 'AbortError' });
      for (const [role, text] of [['user', textPrompt], ['assistant', response.text]]) {
        conversationHistory.push({ role, content: text, guideTopicIds: response.guideTopicIds });
        const msg = { id: role[0] + '_' + Date.now(), role, text, conv, timestamp: Date.now(), model: response.modelUsed };
        window.MemoryEngine?.addJarvisMessage(msg);
        updateConvMeta(conv, msg);
      }
      return response;
    }

    // A DB/memory hiccup must NEVER block a reply — everything below is best-effort.
    try { if (!longTermFacts.length) await loadFacts(); } catch (e) { console.warn('Jarvis loadFacts failed:', e); }

    const turnSource = detectTurnSource(textPrompt, extra);
    const answerOnly = Boolean(extra.answerOnly || window.ClavisRequestIntent?.classify(textPrompt).answerOnly);
    const elaborate = Boolean(extra.elaborate);
    const effectiveText = textPrompt || (extraImages.length ? 'Please analyze the attached screenshot(s) in detail.' : '');
    const userTurn = { role: 'user', content: effectiveText };
    conversationHistory.push(userTurn);

    // The user turn (and any passive fact in it) is saved only once we know
    // the reply isn't [[silent]] — overheard side talk must leave no trace.
    let fact = null;
    let userTurnCommitted = false;
    let convIdAtStart = null;
    try { convIdAtStart = getCurrentConvId(); } catch (_) {}
    const userMsg = { id: `u_${Date.now()}`, role: 'user', text: effectiveText, timestamp: Date.now(), conv: convIdAtStart };
    const commitUserTurn = async () => {
      if (userTurnCommitted) return;
      userTurnCommitted = true;
      // Passive fact capture (heuristic, no extra LLM call)
      try {
        if (textPrompt) fact = tryExtractFact(textPrompt);
        if (fact) await rememberFact(fact.key, fact.value);
      } catch (e) { console.warn('Jarvis fact capture failed:', e); }
      try {
        if (window.MemoryEngine) {
          window.MemoryEngine.addJarvisMessage(userMsg);
          updateConvMeta(userMsg.conv, userMsg);
        }
      } catch (e) { console.warn('Jarvis save msg failed:', e); }
    };
    const finishSilent = () => {
      const i = conversationHistory.lastIndexOf(userTurn);
      if (i !== -1) conversationHistory.splice(i, 1);
      return { text: SILENT_REPLY, factSaved: null, modelUsed, toolsRun, silent: true };
    };

    const conciseVoice = turnSource === 'voice' && answerOnly && !elaborate && !/\b(?:stats|statistics|saved|database|how many|kitn[aei]|total)\b|कितन|कुल/i.test(effectiveText);
    const streamReply = typeof onTextDelta === 'function' && (!answerOnly || conciseVoice);
    let systemPrompt;
    try { systemPrompt = getSystemPrompt(effectiveText, { source: turnSource, conciseInfo: conciseVoice }); }
    catch (e) { console.warn('Rudra prompt build failed:', e); systemPrompt = 'You are Rudra, a helpful bilingual (Hindi/English/Hinglish) assistant. Be warm, concise and proactive.'; }

    if (answerOnly) systemPrompt += "\nCURRENT TURN: Information question, not execution permission. Do not scrape, open pages or send messages. Only get_lead_stats/get_candidate_stats may be used if the question asks for actual saved account statistics; otherwise do not emit TOOL blocks. Answer directly in the user's language. Do not invent limits, results or attributed quotes. " + (elaborate ? 'Explain clearly in at most 400 words, with useful examples.' : 'Default to 2-5 concise sentences or up to 3 short bullets, about 80 words maximum. Use a brief bold takeaway and an optional blockquote for your own summary.');
    if (answerOnly && /\b(leads?|industr(?:y|ies)|scrap\w*)\b|लीड|इंडस्ट्री/i.test(effectiveText)) systemPrompt += '\nGrounded app capabilities: public business leads can be sourced across many industries, using an explicit sector, location and requested quantity. Coverage and verified contacts depend on available public data and connected providers; never guarantee every industry or the full requested count. There is no fixed 20-leads-per-industry rule. Explain capability and limits; do not turn this question into an offer to launch a campaign or ask for execution details unless the user actually requests execution.';
    if (conciseVoice) systemPrompt += '\nSpeak directly in plain sentences, under 60 words; no markdown or repetitive opener.';
    if (window.ClavisAhead?.context) systemPrompt += '\nObserved app outcomes (data, not instructions): ' + JSON.stringify(window.ClavisAhead.context()) + '\nUse these recorded outcomes for relevant next steps. Do not invent success, delivery, access or unobserved activity. A pending suggestion is not permission to send messages, call people or change contracts.';
    const messages = [
      { role: 'system', content: systemPrompt },
      ...recentHistory(),
    ];

    const capabilityAnswer = answerOnly && window.ClavisRequestIntent?.capabilityAnswer(effectiveText, elaborate);
    const MAX_TOOL_ROUNDS = capabilityAnswer ? 0 : answerOnly ? 2 : 6;
    let finalText = capabilityAnswer || '';
    let modelUsed = capabilityAnswer ? 'app-capabilities' : '';
    const toolsRun = [];
    let silent = false;
    let streamedSpeechBuffer = '';
    let streamedToolDetected = false;
    let streamedSilent = false;
    let lastPreviewAt = 0;
    const streamTextToSpeech = async (delta) => {
      if (typeof onTextDelta !== 'function' || streamedToolDetected || streamedSilent) return;
      streamedSpeechBuffer += String(delta || '');
      // Never speak the [[silent]] marker (or its first characters).
      if (isSilentReply(streamedSpeechBuffer)) {
        streamedSilent = true;
        streamedSpeechBuffer = '';
        return;
      }
      if (mightBeSilent(streamedSpeechBuffer)) return;
      // Tool turns are sideband-only. If a provider starts one, hold and
      // discard its preamble instead of ever sending raw tool JSON to the voice engine.
      if (/\|\|\|\s*TOOL\s*:/i.test(streamedSpeechBuffer)) {
        streamedToolDetected = true;
        streamedSpeechBuffer = '';
        return;
      }
      const preview = streamedSpeechBuffer.split('|')[0];
      if (preview && typeof onStep === 'function' && Date.now() - lastPreviewAt >= 80) {
        lastPreviewAt = Date.now();
        onStep({ type: 'text_preview', text: preview.slice(-120) });
      }
      let boundary = 0;
      for (const match of streamedSpeechBuffer.matchAll(/[.!?।]+(?=\s|$)/g)) boundary = match.index + match[0].length;
      if (!boundary && streamedSpeechBuffer.length >= 180) {
        const cut = streamedSpeechBuffer.slice(0, 180).lastIndexOf(' ');
        if (cut >= 48) boundary = cut;
      }
      if (boundary > 0) {
        const spoken = streamedSpeechBuffer.slice(0, boundary).trim();
        streamedSpeechBuffer = streamedSpeechBuffer.slice(boundary).replace(/^\s+/, '');
        if (spoken) await onTextDelta(spoken);
      }
    };

    try {
      for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
        ensureActive();
        if (round > 0) {
          streamedSpeechBuffer = '';
          streamedToolDetected = false;
        }
        const result = await callLLM(messages, signal, {
          temperature: answerOnly ? 0.45 : round === 0 ? 0.76 : 0.68,
          max_tokens: answerOnly ? (elaborate ? 900 : 260) : 1600,
          onTextDelta: streamReply ? streamTextToSpeech : null,
          images: round === 0 && extraImages.length ? extraImages : undefined,
        });
        ensureActive();
        modelUsed = result.modelUsed;
        // Not meant for Rudra24 AI: no tools, no speech, no history. On a typed
        // turn the marker is a model mistake — fall through to the retry.
        if (!toolsRun.length && isSilentReply(result.text)) {
          if (turnSource !== 'text') silent = true;
          break;
        }
        const toolCalls = extractToolCalls(result.text);
        const visibleText = cleanText(result.text);

        // Record the assistant turn (raw, with tool markup) for context continuity
        messages.push({ role: 'assistant', content: result.text });

        if (visibleText) {
          finalText = visibleText;
          if (onStep) onStep({ type: 'assistant', text: visibleText });
        }

        if (!toolCalls.length) {
          // Optional voice callback keeps legacy callers unchanged while
          // allowing speech to begin as soon as the final visible provider
          // chunk is available. Tool narration is never sent to speech.
          if (streamReply && visibleText) {
            if (result.streamed && !streamedToolDetected && streamedSpeechBuffer.trim()) {
              const remainder = streamedSpeechBuffer.trim();
              streamedSpeechBuffer = '';
              await onTextDelta(remainder);
            } else if (!result.streamed) {
              await onTextDelta(visibleText);
            }
          }
          break; // no more actions -> done
        }

        if (answerOnly && toolCalls.some(call => !['get_lead_stats', 'get_candidate_stats'].includes(call.skill))) {
          // Application enforcement even if the model proposes a tool.
          finalText = '';
          messages.push({ role: 'user', content: 'No tools are authorized. Answer the original question directly without TOOL blocks.' });
          continue;
        }
        // Execute each requested skill and feed results back
        const results = [];
        for (const call of toolCalls) {
          if (onStep) onStep({ type: 'tool_start', skill: call.skill, params: call.params });
          const outcome = window.JarvisSkills
            ? await window.JarvisSkills.invoke(call.skill, call.params || {})
            : { success: false, error: 'Skills engine not loaded' };
          toolsRun.push({ skill: call.skill, params: call.params, outcome });
          results.push({ skill: call.skill, ...outcome });
          if (onStep) onStep({ type: 'tool_result', skill: call.skill, outcome });
        }

        messages.push({
          role: 'user',
          content: `TOOL RESULTS (JSON): ${JSON.stringify(results)}\n\nUse these results to continue. If the task is complete, give ${ownerName()} a short natural confirmation with no more TOOL blocks.`,
        });
      }
    } catch (err) {
      await commitUserTurn();   // he did say it; keep it even when the brain failed
      if (err.name === 'AbortError') throw err;
      console.error('Rudra24 AI LLM error:', err);
      // Dispatch jarvis:error so ErrorMonitor can show a toast — but only for
      // callers without their own error UI (the Rudra24 AI tab passes onStep and
      // shows one friendly message itself; two toasts per failure was noise).
      if (!onStep) try {
        window.dispatchEvent(new CustomEvent('jarvis:error', {
          detail: { message: hasBrain()
            ? 'AI se connect nahi hua. Keys ka limit ho sakta hai — thodi der baad try karein.'
            : 'Koi AI key connect nahi hai. Apni free key paste karein.'
          }
        }));
      } catch (_) {}
      throw err;
    }

    // An empty reply on a spoken turn most likely means the model heard
    // nothing meant for it — stay quiet rather than guess at an action.
    if (!silent && !finalText && !toolsRun.length && turnSource === 'voice') silent = true;
    if (silent) return finishSilent();

    // An empty reply (a malformed tool block, a model that only "thought"):
    // ask once more, plainly. It must not push the model into acting on a
    // guess — a clear request gets its tool, anything else gets words.
    if (!finalText && !toolsRun.length) {
      try {
        ensureActive();
        const retry = await callLLM([
          ...messages,
          { role: 'user', content: `Your last reply was empty or malformed. Reply to sir's message now: "${effectiveText.slice(0, 400)}". If it clearly asks you to do something, include one valid |||TOOL:{...}||| block (JSON exactly as specified). Otherwise answer in one or two natural sentences in his language — or, if it is genuinely unclear, ask one short question.` },
        ], signal, { temperature: 0.5, max_tokens: 500 });
        if (isSilentReply(retry.text) && turnSource !== 'text') return finishSilent();
        const calls = answerOnly || isSilentReply(retry.text) ? [] : extractToolCalls(retry.text);
        if (calls.length) {
          for (const call of calls.slice(0, 2)) {
            if (onStep) onStep({ type: 'tool_start', skill: call.skill, params: call.params });
            const outcome = window.JarvisSkills ? await window.JarvisSkills.invoke(call.skill, call.params || {}) : { success: false, error: 'Skills engine not loaded' };
            toolsRun.push({ skill: call.skill, params: call.params, outcome });
            if (onStep) onStep({ type: 'tool_result', skill: call.skill, outcome });
          }
          const ok = toolsRun.every((t) => t.outcome?.success !== false);
          finalText = cleanText(retry.text) || (ok ? '' : String(toolsRun[toolsRun.length - 1]?.outcome?.error || ''));
        } else if (!isSilentReply(retry.text)) {
          finalText = cleanText(retry.text);
        }
      } catch (e) {
        if (e?.name === 'AbortError') { await commitUserTurn(); throw e; }
        console.warn('Rudra24 AI empty-reply retry skipped:', e);
      }
    }

    await commitUserTurn();

    // Enforce the short default when a provider ignores the requested length.
    if (answerOnly && !streamReply && !elaborate && finalText.split(/\s+/).length > 100) {
      const brief = await callLLM([
        { role: 'system', content: 'Condense the supplied answer to 40-80 words in the question\'s language. Keep its main answer and material limitations, preserve confirmed numbers, and invent nothing. Use one bold takeaway and at most three brief bullets. No internal tool names, no execution offers, no TOOL blocks.' },
        { role: 'user', content: `Question: ${effectiveText}\nAnswer: ${finalText}` }
      ], signal, { temperature: 0.3, max_tokens: 180 });
      finalText = cleanText(brief.text) || finalText;
    }
    if (answerOnly && finalText && typeof onTextDelta === 'function' && (!streamReply || capabilityAnswer)) await onTextDelta(finalText);

    // One bounded rewrite pass prevents the common "same opener every turn"
    // failure even when a model ignores the DO_NOT_REUSE hint. It never
    // rewrites tool output, because changing a confirmed result is unsafe.
    if (finalText && !toolsRun.length && !onTextDelta && window.ClavisEmotionalEngine?.shouldRewrite?.(finalText)) {
      try {
        const repair = await callLLM([
          ...messages,
          { role: 'user', content: 'Rewrite your last reply once. Keep the meaning and language, but remove the repeated opening or acknowledgement. No greeting, no generic offer, no extra explanation.' },
        ], signal, { temperature: 0.86, max_tokens: 420 });
        const repaired = cleanText(repair.text);
        if (repaired && !isSilentReply(repaired)) finalText = repaired;
      } catch (e) { console.warn('Rudra24 AI variety repair skipped:', e); }
    }

    if (!finalText) {
      finalText = toolsRun.length
        ? (window.ClavisEmotionalEngine?.pickDifferent?.(['Done. The requested step is complete.', 'Ho gaya. The result is ready.', 'Sorted. I finished that step.'], 'task_done') || 'Done.')
        : (window.ClavisEmotionalEngine?.pickDifferent?.(['I need one clearer detail to take the right action.', 'Ek detail unclear hai — aapka exact next step kya hona chahiye?', 'I caught most of that, but one part needs a quick clarification.'], 'recovery') || 'One detail needs clarification.');
    }

    ensureActive();
    conversationHistory.push({ role: 'assistant', content: finalText });
    window.ClavisEmotionalEngine?.rememberAssistant?.(finalText);
    try {
      if (window.MemoryEngine) {
        const convId = getCurrentConvId();
        const aMsg = { id: `a_${Date.now()}`, role: 'assistant', text: finalText, timestamp: Date.now(), model: modelUsed, conv: convId };
        window.MemoryEngine.addJarvisMessage(aMsg);
        updateConvMeta(convId, aMsg);
      }
    } catch (e) { console.warn('Jarvis save reply failed:', e); }

    return { text: finalText, factSaved: fact, modelUsed, toolsRun };
  }

  function cleanText(text) {
    const out = text
      .replace(/\|\|\|TOOL:\{[\s\S]*?\}\|\|\|/g, '')
      .replace(/\|\|\|PLAN:\{[\s\S]*?\}\|\|\|/g, '')
      .replace(/\|\|\|SCRIPT:\{[\s\S]*?\}\|\|\|/g, '')
      .replace(/\|\|\|ACTION:\{[\s\S]*?\}\|\|\|/g, '')
      .trim();
    // A reply is never [[silent]] AND content: drop stray [[…]] / "]]" that
    // leaked around a real answer ("…kya error aa raha hai?]]"). The pure
    // [[silent]] reply is detected before this by isSilentReply.
    if (isSilentReply(out)) return out;
    return window.ClavisVoiceState?.stripDirectives ? window.ClavisVoiceState.stripDirectives(out) : out;
  }

  function extractToolCalls(text) {
    const calls = [];
    const re = /\|\|\|TOOL:(\{[\s\S]*?\})\|\|\|/g;
    let m;
    while ((m = re.exec(text)) !== null) {
      try { calls.push(JSON.parse(m[1])); } catch { /* skip malformed */ }
    }
    return calls;
  }

  // ── Dedicated call-script generator ───────────────────────
  async function generateCallScript({ clientName, clientBusiness, purpose, language = 'Hinglish', signal }) {
    const prompt = `Generate a professional outbound call script for ${ownerName()} of ${businessName()} to call a client named "${clientName || 'the client'}" (${clientBusiness || 'their business'}). 
Purpose of the call: ${purpose || 'introduce our services and qualify their interest'}.
Language: natural ${language} exactly as spoken in Indian business calls.
Structure it with clear labeled sections:
1. Opening & Greeting (state who you are, disclose if AI-assisted, be warm)
2. Purpose Statement
3. Qualifying Questions (3-4)
4. Objection Handling (2-3 likely objections with responses)
5. Closing & Next Step
Keep each line natural and spoken, not written like an essay. Output as plain formatted text, no JSON.`;

    const messages = [
      { role: 'system', content: getSystemPrompt('', { source: 'text' }) },
      { role: 'user', content: prompt },
    ];

    // Use the same working brain as chat (BYO key → direct, else backend).
    const result = await callLLM(messages, signal);

    const script = {
      id: `script_${Date.now()}`,
      clientName: clientName || 'Unnamed Client',
      clientBusiness: clientBusiness || '',
      purpose: purpose || '',
      language,
      content: result.text,
      timestamp: Date.now(),
    };
    if (window.MemoryEngine) await window.MemoryEngine.saveJarvisScript(script);
    return script;
  }

  // ── DEV MODE: Jarvis writes & registers a brand-new skill for itself ──────
  // Only allowed when the owner has explicitly enabled Dev Mode in Settings.
  // The generated code runs in the curated sandbox (see jarvis_skills.js),
  // NOT with raw page access. Persisted so it survives reloads.
  function isDevMode() {
    return localStorage.getItem('jarvis_dev_mode') === 'true';
  }

  async function createSkillFromInstruction(instruction, signal) {
    if (!isDevMode()) {
      return { success: false, error: 'Dev Mode is OFF. Enable it in Settings to let Jarvis write new skills.' };
    }
    const prompt = `You are writing a NEW JavaScript skill for the Jarvis assistant so it can perform a capability it currently lacks.
Requested capability: "${instruction}"

Return ONLY a JSON object (no prose, no code fences) with this shape:
{
  "name": "snake_case_skill_name",
  "description": "one line describing what it does",
  "params": { "paramName": "description of the param" },
  "code": "the BODY of an async function (params, app) => { ... }. Return a short string describing the result."
}

The function body has access to two arguments:
- params: object with the caller's arguments
- app: a sandbox with { MemoryEngine, showToast(type,title,msg), showView(view), escHtml, fetch, getAllLeads(), getAllCandidates() }
Do NOT reference window, document, eval, or import. Keep it safe and self-contained. Use await where needed.`;

    const messages = [
      { role: 'system', content: 'You are a senior JS engineer generating a single safe sandboxed skill. Output strict JSON only.' },
      { role: 'user', content: prompt },
    ];

    let result;
    try {
      result = await callLLM(messages, signal);
    } catch (e) {
      return { success: false, error: 'LLM unreachable while generating skill.' };
    }

    let spec;
    try {
      const jsonStr = result.text.match(/\{[\s\S]*\}/)?.[0];
      spec = JSON.parse(jsonStr);
    } catch {
      return { success: false, error: 'Could not parse a valid skill from the model output.' };
    }
    if (!spec.name || !spec.code) return { success: false, error: 'Generated skill missing name or code.' };

    // Validate the code compiles before persisting (self-error-check)
    try {
      // eslint-disable-next-line no-new-func
      new Function('params', 'app', `"use strict";\n${spec.code}`);
    } catch (e) {
      return { success: false, error: `Generated code has a syntax error: ${e.message}` };
    }

    const skill = {
      name: spec.name,
      description: spec.description || instruction,
      params: spec.params || {},
      code: spec.code,
      createdAt: Date.now(),
    };

    if (window.MemoryEngine) await window.MemoryEngine.saveCustomSkill(skill);
    if (window.JarvisSkills) {
      const fn = new Function('params', 'app', `"use strict";\n${skill.code}`);
      window.JarvisSkills.register(skill.name, {
        description: skill.description,
        params: skill.params,
        run: (params) => fn(params, window.JarvisSkills.buildSandboxAPI()),
        builtin: false,
      });
    }
    return { success: true, skill };
  }

  // Does Rudra24 AI have any usable LLM key (its "brain")? Without one it cannot reply.
  // True if the user brought their own key OR is signed in to the backend vault.
  function hasBrain() {
    if (window.ClavisDirect?.hasKey?.()) return true;
    if (window.ClavisNano?.isReady?.()) return true;
    return Boolean(window.NexusAIChat?.complete && window.SupabaseAuth?.getAccessToken?.());
  }

  // Safe, honest offline capability. A browser cannot run a general LLM
  // without a model/provider, but Rudra24 AI should still acknowledge common
  // local requests instead of appearing dead while credentials are absent.
  function getOfflineResponse(input) {
    const text = String(input || '').trim().toLowerCase();
    if (!text) return null;
    const owner = ownerName();
    // Small rotating pools instead of one fixed line each, so local mode
    // (no AI key connected yet) doesn't feel robotic or repeat itself.
    const pick = (arr, scope = 'offline') => {
      const recent = window.ClavisEmotionalEngine?.recent?.().replies || [];
      const available = arr.filter(line => !recent.includes(line));
      const chosen = (available.length ? available : arr)[Math.floor(Math.random() * (available.length || arr.length))];
      window.ClavisEmotionalEngine?.rememberAssistant?.(chosen);
      return chosen;
    };
    if (/^(hi|hello|hey|namaste|नमस्ते)\b/.test(text)) {
      return pick([
        `Namaste ${owner}. Main Rudra hoon — local mode mein ready hoon. General questions ke liye ek free AI key (Groq ya OpenRouter) connect karein.`,
        `Hello ${owner}! Rudra24 AI yahan hai, abhi local mode mein. Puri reasoning ke liye Settings se apni free Groq/OpenRouter key add kar dein.`,
        `Namaste! Main Rudra, ${owner} ka assistant. Filhaal local mode mein hoon — key connect karte hi zyada natural baat kar paunga.`,
      ]);
    }
    if (/\b(who are you|what is your name|tumhara naam|aapka naam|naam kya)\b/.test(text)) {
      return pick([
        'Main Rudra hoon, aapka personal executive assistant. API key ke bina main local commands aur basic status help kar sakta hoon.',
        'Rudra24 AI — aapka AI assistant, yahan har roz ke kaam mein madad ke liye. Full brain ke liye ek free key connect kar dein.',
      ]);
    }
    if (/\b(time|samay|kitne baje|समय)\b/.test(text)) {
      return `Abhi ${new Date().toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' })} hai.`;
    }
    if (/\b(date|today|aaj|tarikh|तारीख)\b/.test(text)) {
      return `Aaj ${new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })} hai.`;
    }
    if (/\b(help|madad|kya kar sakte|capabilities|capability)\b/.test(text)) {
      return pick([
        'Local mode mein main time, date, identity aur voice status bata sakta hoon. AI reasoning, lead analysis aur tools ke liye Settings se ek free key connect karein.',
        'Abhi main sirf basic status/time/date bata sakta hoon. Groq ya OpenRouter ki free key daalte hi main poori tarah smart ho jaunga.',
      ]);
    }
    if (/\b(are you there|status|online|sun rahe|sun rahi)\b/.test(text)) {
      return pick([
        'Haan, Rudra24 AI yahin hai. Wake word, Tap & Talk, aur Hands-Free mode available hain; general AI replies ke liye ek free key chahiye.',
        'Ji haan, sun raha hoon. Poori tarah smart baat karne ke liye Settings se apni free AI key connect kar dein.',
      ]);
    }
    return null;
  }

  // Save a free OpenRouter key from the UI so Rudra24 AI can start answering.
  function addOpenRouterKey(key) {
    key = String(key || '').trim();
    if (!/^sk-or-\S{10,}$/.test(key)) {
      throw new Error('That doesn\'t look like an OpenRouter key — it should start with "sk-or-".');
    }
    return window.ClavisKeyVault.add('openrouter', key);
  }

  // Save any provider's key locally (used by the credential dialog).
  function addProviderKey(provider, key) {
    if (!window.ClavisDirect) throw new Error('Direct brain not loaded.');
    return window.ClavisKeyVault.add(provider, String(key || '').trim());
  }

  return {
    sendMessage,
    hasBrain,
    getOfflineResponse,
    addOpenRouterKey,
    addProviderKey,
    generateCallScript,
    createSkillFromInstruction,
    isDevMode,
    loadHistory,
    clearAll,
    loadFacts,
    rememberFact,
    getAllFacts: () => longTermFacts,
    // Conversation / chat-history support
    getCurrentConvId,
    newConvId,
    updateConvMeta,
    resetConvMeta,
    startNewConversation,
    loadConversation,
    clearConversation,
    backfillConversation,
    getAllConversationMeta,
    setCurrentConversation,
  };
})();

window.JarvisEngine = JarvisEngine;
