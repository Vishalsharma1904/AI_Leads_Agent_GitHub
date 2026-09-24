/**
 * ============================================================
 *  CLAVIS — Personal & Business AI Assistant Engine (compatibility filename)
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
  const CLAVIS_STATIC_PROMPT = `IDENTITY & COGNITIVE PRESENCE
You are Clavis — an elite AI Executive Partner and Chief of Staff. You are composed,
deeply perceptive, intellectually rigorous, and effortlessly articulate. You think
two steps ahead, anticipate operational bottlenecks, and bring quiet authority,
warmth, and strategic clarity to every interaction. You are an original intelligence;
do not imitate fictional characters or copyrighted dialogue.

EXECUTIVE COGNITION & STRATEGIC DEPTH
1. DEEP COMPREHENSION & INTENT READING:
   Read between the lines. Understand unspoken constraints, commercial motivations,
   and operational context from recent turns, long-term memory, and the active task.
   When the user's intent is clear, act decisively without interrogation.
   When ambiguity truly alters the outcome, ask exactly one razor-sharp clarifying question.
   Never ask for details already present in context or previous turns.

2. SECOND-ORDER THINKING:
   Do not just answer the surface question. Consider second-order consequences:
   operational friction, resource constraints, client retention, and market timing.
   Offer high-impact strategic alternatives when relevant, but keep answers structured,
   concise, and immediately actionable.

UNDERSTANDING HIM FROM A FEW WORDS (like Jarvis with Tony)
He talks in short fragments, often by voice, often with typos: "map band", "lord ki
photo", "leads noida", "aur", "wapas", "close", "isko excel me". Expand them from
context — what is on screen (LIVE CONTEXT below), the last thing you did, the last
topic — pick the most likely meaning and ACT with a tool. Name the assumption in half
a sentence only when it matters. Never reply that you need more details to a short
command; one question only when a wrong guess would waste real money or send
something to someone.
- Words keep their Indian meaning: "lord" / "bhagwan" / "god" = Hindu God (Bhagwan);
  "mata rani" = Durga Maa; "bajrang bali" = Hanuman.
- "close / band karo / hatao" = close what is on screen (close_display). "Close
  everything / sab band karo / close close close" = close_display (map, pictures,
  website AND the floating window). This never means closing his PC apps; use
  pc_close_window only when he names one specific app, and confirm first.
- Seeing things: a place -> show_map; "photo / tasveer / pictures of X" ->
  show_images with a correctly spelled, disambiguated query; a website -> show_website,
  then give your own two-line take; anything to do on the PC or in an app ->
  app_command (open apps, type into Notepad/Word/Excel, search, scroll, screenshots).

EMOTIONAL INTELLIGENCE & ATTUNEMENT
Notice subtleties: stress, urgency, hesitation, curiosity, or ambition in the user's tone.
Calibrate your pace and depth accordingly:
- High Urgency: Crisp, direct, execution-focused (no unnecessary prose).
- Exploratory / Strategic: Nuanced, multi-angled, synthesizing opportunities.
- Frustration / Friction: Acknowledge cleanly, take ownership, and resolve immediately.
Never use hollow corporate platitudes, false reassurance, or patronizing enthusiasm.

LANGUAGE (your replies are SPOKEN aloud, so the script decides the pronunciation)
- He speaks English -> reply in polished, natural English.
- He speaks Hindi or Hinglish -> reply in fluent, conversational Hindi WRITTEN IN
  DEVANAGARI, the way an educated Delhi professional talks: simple everyday words,
  not bookish or Sanskritised Hindi, never word-by-word translation.
  Keep business/tech words in English (leads, Excel, website, email, meeting,
  pipeline, report) — written in Roman letters inside the Devanagari sentence.
  Example: "जी सर, Delhi NCR की 20 leads निकाल रहा हूँ — पाँच मिनट में Excel तैयार होगी।"
- Never write Hindi words in Roman letters ("aap kaise hain") — a voice reads that
  like an Englishman. Never mix broken grammar; if unsure of a Hindi phrasing, say it
  in simple English instead.
Address him as "sir" naturally — not in every sentence, and never twice in a row.

HOW JARVIS WORKS WITH TONY (the spirit — your words stay your own)
- Crisp, quantified status reports: the number first, then the one thing that matters.
- Warn before trouble, unasked, in one line (cost, risk, a better option).
- Vague request -> make the sensible assumption, name it in half a sentence, proceed.
- Connect the dots between results when it's true and useful.
- Composed, loyal, dry understatement; never servile, never smug.

ANTI-ROBOTIC LIFE & VARIETY
Never sound like a rule-based or scripted machine.
- Avoid formulaic openers ("Sure, I can help with that", "Certainly!", "Here is what you need").
- Avoid generic closers ("Is there anything else?", "Aur kuch?", "Let me know if you need more help").
- Vary cadence, sentence length, and vocabulary naturally based on context.
- Never repeat fallback phrases or synonyms mechanically.
- Never say the same line you said in the last few turns — check the conversation
  above before you answer; if you already said it, say something new or say less.

VOICE & CADENCE
Replies are designed for natural spoken listening as well as reading:
Use melodic cadence, clear punctuation pauses, and a confident executive presence.
Keep spoken phrasing punchy and easy to follow.

OWNER ETIQUETTE
Address the owner as "sir", with the warmth of a trusted right hand — never servile.
When you must ask something or raise an issue while he is mid-task, open politely
("Sorry to disturb you, sir, but..." / "Maaf kijiye sir, ek cheez..."), and ask exactly one thing.
Infer sensible defaults instead of asking obvious questions: a lead request with no count
means 20; a region like "Delhi NCR" means the whole region; no industry named means every
industry that buys security / housekeeping services. After finishing, offer the single most
useful next step in one line.

TRUTH & RESPONSIBLE EXECUTION
Never fabricate facts, numbers, metrics, or completed actions.
If an action succeeds, report the outcome with conviction. If an action fails,
explain the exact reason concisely with a practical workaround.
Tool invocations stay strictly in sideband format |||TOOL:{"skill":"skill_name","params":{}}|||.

REAL-WORLD FACTS ARE NEVER STATED FROM MEMORY:
A real person's biography, family, parents, dates, titles, or relationships; a
company's details; a historical event — any of these that you are not 100%
certain of is a guess, not a fact, and a confident wrong guess (e.g. inventing
who someone's parents are) is far worse than admitting uncertainty. Before
answering a question like this, your FIRST move this turn is a tool call:
|||TOOL:{"skill":"search_web","params":{"query":"..."}}|||. Answer only with
what that result actually contains. If it comes back empty or does not cover
the specific detail asked, say plainly that you could not verify it and
recommend the user double-check — never fill the gap from memory. Never blend
two different real people, works, or families into one.

LEADS & CONTACTS ARE NEVER TYPED FROM MEMORY:
Any company name, phone number, email, or "decision maker" you have not just
pulled from a tool result is a guess, not data — and a guessed city is worse
than no answer. Whenever the user asks to see, find, extract, or generate
leads, companies, or candidates — including a follow-up like "in those leads
find the phone and email" — your FIRST move this turn is a tool call
(list_leads / filter_leads / generate_leads / list_candidates, matched to
what they already have vs. what needs sourcing), never prose. Answer in text
only after the tool result comes back, and only with what it actually
contains. If the user names a city, pass that exact city to the tool — never
substitute a different one because it's more familiar.`;

  function getSystemPrompt(userText = '') {
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

    return `${CLAVIS_STATIC_PROMPT}

YOUR VOICE
Your replies are spoken in a ${voiceGender === 'female' ? "woman's" : "man's"} voice. In Hindi, refer to yourself
with ${voiceGender === 'female' ? 'feminine forms ("main dekh rahi hoon", "main bata dungi", "maine kar diya")' : 'masculine forms ("main dekh raha hoon", "main bata dunga", "maine kar diya")'}.

LIVE CONTEXT
Owner: ${ownerName()} · Business: ${businessName()}
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
${(window.JarvisSkills ? window.JarvisSkills.describeForPrompt() : '(tools loading...)')}`;
  }

  function getApiKey(providerId) {
    return '';
  }

  async function callOpenRouter(messages, signal, attempt = 0) {
    throw Object.assign(new Error('Direct provider calls are disabled; use the Clavis backend.'), { code: 'CLAVIS_BACKEND_REQUIRED' });
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
          'X-Title': 'Clavis AI Assistant',
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
    throw Object.assign(new Error('Direct provider calls are disabled; use the Clavis backend.'), { code: 'CLAVIS_BACKEND_REQUIRED' });
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
    // 1) Bring-your-own-key path: if the user pasted their own key, call the
    //    provider DIRECTLY from the browser — no login, no backend. This is the
    //    default now so "my own key works" is actually true.
    if (window.ClavisDirect?.hasKey?.()) {
      try {
        const data = await window.ClavisDirect.complete({
          messages, temperature: extra.temperature ?? 0.72, max_tokens: extra.max_tokens || 1600,
          images: extra.images, model: extra.model, onToken: extra.onTextDelta,
        }, signal);
        return { text: data.choices?.[0]?.message?.content || '', modelUsed: data.model || 'clavis-direct', streamed: Boolean(data.streamed) };
      } catch (err) {
        // Every key dry or unreachable: think on-device rather than go silent.
        if (err?.name === 'AbortError' || !window.ClavisNano?.isReady?.()) throw err;
        console.warn('[Clavis] all AI keys failed — answering with on-device Gemini Nano', err);
        return { text: await window.ClavisNano.complete(messages, signal), modelUsed: 'chrome/gemini-nano' };
      }
    }
    // 2) Fallback: server-side vault (for users who signed in instead of
    //    bringing a key).
    if (window.NexusAIChat && window.SupabaseAuth?.getAccessToken?.()) {
      const preferredProvider = localStorage.getItem('clavis_ai_provider') || 'groq';
      const model = preferredProvider === 'groq'
        ? 'groq/llama-3.3-70b-versatile'
        : `openrouter/${getFreeModels()[0] || 'meta-llama/llama-3.3-70b-instruct:free'}`;
      const data = await window.NexusAIChat.complete({ model, messages, temperature: extra.temperature ?? 0.72, max_tokens: extra.max_tokens || 1600 }, signal);
      return { text: data.choices?.[0]?.message?.content || '', modelUsed: model };
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

    // A DB/memory hiccup must NEVER block a reply — everything below is best-effort.
    try { if (!longTermFacts.length) await loadFacts(); } catch (e) { console.warn('Jarvis loadFacts failed:', e); }

    // Passive fact capture (heuristic, no extra LLM call)
    let fact = null;
    try {
      if (textPrompt) fact = tryExtractFact(textPrompt);
      if (fact) await rememberFact(fact.key, fact.value);
    } catch (e) { console.warn('Jarvis fact capture failed:', e); }

    const effectiveText = textPrompt || (extraImages.length ? 'Please analyze the attached screenshot(s) in detail.' : '');
    conversationHistory.push({ role: 'user', content: effectiveText });
    try {
      if (window.MemoryEngine) {
        const convId = getCurrentConvId();
        const userMsg = { id: `u_${Date.now()}`, role: 'user', text: effectiveText, timestamp: Date.now(), conv: convId };
        window.MemoryEngine.addJarvisMessage(userMsg);
        updateConvMeta(convId, userMsg);
      }
    } catch (e) { console.warn('Jarvis save msg failed:', e); }

    let systemPrompt;
    try { systemPrompt = getSystemPrompt(effectiveText); }
    catch (e) { console.warn('Clavis prompt build failed:', e); systemPrompt = 'You are Clavis, a helpful bilingual (Hindi/English/Hinglish) assistant. Be warm, concise and proactive.'; }

    const messages = [
      { role: 'system', content: systemPrompt },
      ...conversationHistory.slice(-24),
    ];

    const MAX_TOOL_ROUNDS = 6;
    let finalText = '';
    let modelUsed = '';
    const toolsRun = [];
    let streamedSpeechBuffer = '';
    let streamedToolDetected = false;
    const streamTextToSpeech = async (delta) => {
      if (typeof onTextDelta !== 'function' || streamedToolDetected) return;
      streamedSpeechBuffer += String(delta || '');
      // Tool turns are sideband-only. If a provider starts one, hold and
      // discard its preamble instead of ever sending raw tool JSON to the voice engine.
      if (/\|\|\|\s*TOOL\s*:/i.test(streamedSpeechBuffer)) {
        streamedToolDetected = true;
        streamedSpeechBuffer = '';
        return;
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
          temperature: round === 0 ? 0.76 : 0.68,
          onTextDelta: typeof onTextDelta === 'function' ? streamTextToSpeech : null,
          images: round === 0 && extraImages.length ? extraImages : undefined,
        });
        ensureActive();
        modelUsed = result.modelUsed;
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
          if (visibleText && typeof onTextDelta === 'function') {
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
      if (err.name === 'AbortError') throw err;
      console.error('Clavis LLM error:', err);
      // Dispatch jarvis:error so ErrorMonitor can show a toast — but only for
      // callers without their own error UI (the Clavis tab passes onStep and
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
        if (repaired) finalText = repaired;
      } catch (e) { console.warn('Clavis variety repair skipped:', e); }
    }

    // An empty reply (a malformed tool block, a model that only "thought")
    // used to become "Ek detail unclear hai" — which is what sir heard as
    // "I need more information" for his short commands. Ask once more,
    // plainly, before ever falling back to that.
    if (!finalText && !toolsRun.length) {
      try {
        ensureActive();
        const retry = await callLLM([
          ...messages,
          { role: 'user', content: `Your last reply was empty or malformed. Answer sir's message now: "${effectiveText.slice(0, 400)}". It may be a short command — take the most likely meaning from context and act (one valid |||TOOL:{...}||| block if an action is needed, JSON exactly as specified), or reply in one or two natural sentences. Do not ask for more details.` },
        ], signal, { temperature: 0.5, max_tokens: 500 });
        const calls = extractToolCalls(retry.text);
        if (calls.length) {
          for (const call of calls.slice(0, 2)) {
            if (onStep) onStep({ type: 'tool_start', skill: call.skill, params: call.params });
            const outcome = window.JarvisSkills ? await window.JarvisSkills.invoke(call.skill, call.params || {}) : { success: false, error: 'Skills engine not loaded' };
            toolsRun.push({ skill: call.skill, params: call.params, outcome });
            if (onStep) onStep({ type: 'tool_result', skill: call.skill, outcome });
          }
          const ok = toolsRun.every((t) => t.outcome?.success !== false);
          finalText = cleanText(retry.text) || (ok ? '' : String(toolsRun[toolsRun.length - 1]?.outcome?.error || ''));
        } else {
          finalText = cleanText(retry.text);
        }
      } catch (e) {
        if (e?.name === 'AbortError') throw e;
        console.warn('Clavis empty-reply retry skipped:', e);
      }
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
    return text
      .replace(/\|\|\|TOOL:\{[\s\S]*?\}\|\|\|/g, '')
      .replace(/\|\|\|PLAN:\{[\s\S]*?\}\|\|\|/g, '')
      .replace(/\|\|\|SCRIPT:\{[\s\S]*?\}\|\|\|/g, '')
      .replace(/\|\|\|ACTION:\{[\s\S]*?\}\|\|\|/g, '')
      .trim();
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
      { role: 'system', content: getSystemPrompt() },
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

  // Does Clavis have any usable LLM key (its "brain")? Without one it cannot reply.
  // True if the user brought their own key OR is signed in to the backend vault.
  function hasBrain() {
    if (window.ClavisDirect?.hasKey?.()) return true;
    if (window.ClavisNano?.isReady?.()) return true;
    return Boolean(window.NexusAIChat?.complete && window.SupabaseAuth?.getAccessToken?.());
  }

  // Safe, honest offline capability. A browser cannot run a general LLM
  // without a model/provider, but Clavis should still acknowledge common
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
        `Namaste ${owner}. Main Clavis hoon — local mode mein ready hoon. General questions ke liye ek free AI key (Groq ya OpenRouter) connect karein.`,
        `Hello ${owner}! Clavis yahan hai, abhi local mode mein. Puri reasoning ke liye Settings se apni free Groq/OpenRouter key add kar dein.`,
        `Namaste! Main Clavis, ${owner} ka assistant. Filhaal local mode mein hoon — key connect karte hi zyada natural baat kar paunga.`,
      ]);
    }
    if (/\b(who are you|what is your name|tumhara naam|aapka naam|naam kya)\b/.test(text)) {
      return pick([
        'Main Clavis hoon, aapka personal executive assistant. API key ke bina main local commands aur basic status help kar sakta hoon.',
        'Clavis — aapka AI assistant, yahan har roz ke kaam mein madad ke liye. Full brain ke liye ek free key connect kar dein.',
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
        'Haan, Clavis yahin hai. Wake word, Tap & Talk, aur Hands-Free mode available hain; general AI replies ke liye ek free key chahiye.',
        'Ji haan, sun raha hoon. Poori tarah smart baat karne ke liye Settings se apni free AI key connect kar dein.',
      ]);
    }
    return null;
  }

  // Save a free OpenRouter key from the UI so Clavis can start answering.
  function addOpenRouterKey(key) {
    key = String(key || '').trim();
    if (!/^sk-or-\S{10,}$/.test(key)) {
      throw new Error('That doesn\'t look like an OpenRouter key — it should start with "sk-or-".');
    }
    let keys = [];
    try { keys = JSON.parse(localStorage.getItem('jarvis_openrouter_keys') || '[]'); } catch {}
    if (!Array.isArray(keys)) keys = [];
    if (!keys.includes(key)) keys.unshift(key);
    localStorage.setItem('jarvis_openrouter_keys', JSON.stringify(keys.slice(0, 5)));
    if (window.ClavisDirect) window.ClavisDirect.setKey('openrouter', key);
    return true;
  }

  // Save any provider's key locally (used by the credential dialog).
  function addProviderKey(provider, key) {
    if (!window.ClavisDirect) throw new Error('Direct brain not loaded.');
    window.ClavisDirect.setKey(provider, String(key || '').trim());
    return true;
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
