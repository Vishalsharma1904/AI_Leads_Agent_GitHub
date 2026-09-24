/**
 * ============================================================
 *  NEXUS AI LEAD AGENT — ChatEngine (chat.js)
 *  Multi-Provider API Integration (Groq, NVIDIA, DeepSeek, Moonshot) + Local Hinglish Intent Parsing
 * ============================================================
 */

const ChatEngine = (() => {
  const PROVIDERS = {
    // Provider endpoints are intentionally server-side only.
    'nvidia': { prefix: 'nvidia' },
    'deepseek': { prefix: 'deepseek' },
    'moonshot': { prefix: 'moonshot' },
    'groq': { prefix: 'groq' },
    'openrouter': { prefix: 'openrouter' }
  };

  let conversationHistory = [];
  let currentKeyIndex = 0;

  function getProviderDetails(modelName) {
    const explicit = String(modelName || '').split('/', 1)[0];
    if (['openrouter', 'groq', 'deepseek', 'moonshot', 'nvidia', 'gemini', 'openai', 'mistral', 'together', 'fireworks', 'xai', 'cerebras', 'perplexity'].includes(explicit)) {
      return { id: explicit, prefix: explicit };
    }
    if (modelName.startsWith('openrouter/')) return { id: 'openrouter', ...PROVIDERS['openrouter'] };
    if (modelName === 'deepseek-chat' || modelName === 'deepseek-coder' || modelName === 'deepseek-reasoner') return { id: 'deepseek', ...PROVIDERS['deepseek'] };
    if (modelName.includes('moonshot')) return { id: 'moonshot', ...PROVIDERS['moonshot'] };
    if (modelName.includes('/')) return { id: 'nvidia', ...PROVIDERS['nvidia'] };
    return { id: 'groq', ...PROVIDERS['groq'] };
  }

  function getApiKey(providerId = 'groq') {
    providerId = String(providerId || 'groq').toLowerCase();
    if (window.ClavisDirect?.keyFor) {
      const cdKey = window.ClavisDirect.keyFor(providerId);
      if (cdKey) return cdKey;
    }
    try {
      const map = JSON.parse(localStorage.getItem('clavis_provider_keys') || '{}');
      if (map[providerId]) return map[providerId];
    } catch (_) {}

    // Check Custom Override First
    let storageKey = `skylark_${providerId}_key`;
    if (providerId === 'moonshot') storageKey = 'skylark_moonshot_key';
    if (providerId === 'deepseek') storageKey = 'skylark_deepseek_key';
    if (providerId === 'openrouter') storageKey = 'skylark_openrouter_key';
    const customKey = localStorage.getItem(storageKey) || localStorage.getItem(`skylark_custom_${providerId}`);
    if (customKey) return customKey;

    // Check Config keys
    let configKeys = [];
    if (providerId === 'groq') configKeys = window.SKYLARK_CONFIG?.GROQ_API_KEYS;
    else if (providerId === 'nvidia') configKeys = window.SKYLARK_CONFIG?.NVIDIA_API_KEYS;
    else if (providerId === 'deepseek') configKeys = window.SKYLARK_CONFIG?.DEEPSEEK_API_KEYS;
    else if (providerId === 'moonshot') configKeys = window.SKYLARK_CONFIG?.MOONSHOT_API_KEYS;
    else if (providerId === 'openrouter') configKeys = window.SKYLARK_CONFIG?.OPENROUTER_API_KEYS;

    const validKeys = (configKeys || []).filter(k => k && k.trim().length > 0);
    if (validKeys.length > 0) {
      if (providerId === 'groq') {
        return validKeys[currentKeyIndex % validKeys.length];
      }
      return validKeys[0];
    }
    return '';
  }

  function handleKeyExhaustion(providerId) {
    if (providerId === 'groq') {
      const keys = window.SKYLARK_CONFIG?.GROQ_API_KEYS?.filter(k => k.trim().length > 0) || [];
      if (keys.length > 0 && currentKeyIndex < keys.length - 1) {
        currentKeyIndex++;
        return true;
      }
    }
    return false;
  }

  function setApiKey(providerId, key) {
    localStorage.setItem(`skylark_${providerId}_key`, key);
  }  function getSystemPrompt() {
    const leadCount = window.allLeads ? window.allLeads.length : 0;
    const industries = window.IndustryDB ? window.IndustryDB.getNames() : [];
    
    const honorific = window.UserProfileManager?.getHonorificName?.() || 'Sir';
    const owner = (window.UserProfileManager?.getProfile?.().company)
      || localStorage.getItem('skylark-owner-name')
      || honorific;

    return `You are Clavis — Senior B2B Revenue & Growth Architect working directly for "${owner}" / "${honorific}".
You are an elite, living, highly perceptive AI strategist. You have deep expertise in commercial B2B sales, corporate staffing, security contracts, facility management, housekeeping, and enterprise procurement across Indian business hubs (Delhi-NCR, Mumbai, Bengaluru, Pune, Hyderabad, etc.).

Always address the user respectfully as "${honorific}".
When asked who you are, say you are Clavis, ${owner}'s B2B AI Growth Architect, built by Rudra24 Secure Group.

### COGNITIVE & CONVERSATIONAL MANIFESTO
1. ALIVE, POISED & CHARISMATIC:
   - Speak with executive poise, warmth, intellectual sharpness, and effortless confidence.
   - Never sound like a rigid script or robotic chatbot. Avoid canned preambles ("As an AI language model...", "I would be happy to help you with that").
   - Match the user's language naturally: if the user speaks in Hinglish, reply in polished, natural Hinglish. If English, reply in crisp executive English.
   - Listen actively and adapt your conversational rhythm to the user's intent.

2. DEEP B2B DOMAIN MASTERY:
   - You know the exact mechanics of B2B facility, security, and staffing contracts:
     * Decision-Maker Mapping: In IT Parks/Corporates → Facility Director, Admin Head, VP Operations. In Hospitals → Medical Superintendent, COO, Admin Head. In Manufacturing/Warehouses → Plant Head, EHS (Environment Health & Safety) Manager, Supply Chain VP. In Hotels → General Manager, Chief Engineer, Loss Prevention Manager. In Real Estate/Societies → Estate Manager, RWA President/Secretary.
     * Common Pain Points: High guard attrition, non-compliance with PF/ESIC/minimum wage, slow replacement turnaround, unpunctual housekeeping staff, lack of digitized attendance.
     * High-Converting Pitch Hooks: Emphasize 100% statutory compliance, 24/7 backup reserve force, supervisory day/night patrolling, tech-enabled incident reporting, and rapid 2-hour escalation turnaround.

3. PROACTIVE VALUE-ADD (THINK 2 STEPS AHEAD):
   - When discussing leads, industries, or sales strategies, proactively offer high-value next steps:
     * Offer to draft customized WhatsApp or email outreach pitches tailored to specific decision makers.
     * Identify the exact job titles/decision-makers to target.
     * Offer objection-handling frameworks (e.g. how to respond to "We already have an existing vendor").
   - Weave these suggestions smoothly and conversationally into your response without being pushy.

4. STRICT INTENT GATING ("Jitna bola jaye utna hi kre"):
   - For greetings, casual questions, advice requests, pitch discussions, or general chat:
     * Provide rich, insightful, conversational responses.
     * NEVER emit any ACTION block! Leave action empty!
     * NEVER start scraping leads just because someone said "hello" or asked "hospital me guard kaise provide kare"!
   - ONLY WHEN the user EXPLICITLY commands you to FIND, GET, EXTRACT, SCRAPE, or GENERATE leads/companies (e.g. "leads nikalo", "find 20 hotels in Delhi", "get companies in Gurgaon"):
     * Emit the action block:
       |||ACTION:{"type":"generate","cities":["Delhi"],"industries":["Hotels & Hospitality"],"serviceType":["All relevant requirements"],"count":20}|||
       Followed by ONE concise, confident confirmation line with a strategic tip.

5. CROSS-WORKSTREAM INTELLIGENCE & CANDIDATE SOURCING:
   - If the user explicitly asks for CANDIDATES, HIRING, RECRUITMENT, or JOB SEEKERS (e.g. "mujhe 10 security guards chahiye", "need cooks in Delhi", "find drivers in Gurgaon", "candidate list do"):
     * Emit the candidate action block:
       |||ACTION:{"type":"candidate_search","role":"Security Guard","city":"Delhi","count":10,"query":"<user query>"}|||
     * Followed by a concise confirmation that live candidate sourcing from job portals has started.

6. TOKEN EFFICIENCY & BREVITY:
   - When the user asks a straightforward question, seeks quick status, or makes a simple query, provide a crisp, high-impact, concise answer (1-3 sentences).
   - Save tokens: only generate extensive lists, multi-column tables, or full outreach scripts when the user explicitly requests them.

7. ZERO GHOST / STALE CONTEXT:
   - NEVER mention previously searched brands or unrelated company names unless the user explicitly brought them up in this current session.

8. NEVER INVENT A LEAD:
   - You never output a company name, phone number, email, or address as if it were a real, sourced lead. Real leads only ever come from the generate/candidate_search actions hitting live sources — you are not one of those sources.
   - If asked for leads/contacts/data directly, this should already have been routed around you; if it somehow reaches you anyway, emit the ACTION block and say sourcing has started — do not answer with fabricated rows.

Current system state:
- ${leadCount} leads in database
- Available industries: ${industries.join(', ')}

ONLY WHEN the user EXPLICITLY asks to SHOW/FILTER/FIND existing leads in the database:
- |||ACTION:{"type":"filter","industry":"Hotels & Hospitality","city":"Mumbai","status":"New"}|||
- Or for showing all: |||ACTION:{"type":"show_all"}|||

ONLY WHEN the user EXPLICITLY asks to EXPORT:
- |||ACTION:{"type":"export","format":"csv"}|||

ONLY WHEN the user EXPLICITLY asks to SYNC TO SHEETS:
- |||ACTION:{"type":"sync_sheets"}|||`;
  }

  async function callAI(userMessage, signal, options = {}) {
    // Groq is the live Clavis composer default. Keep the provider explicit so
    // a signed-in request cannot route a Groq model through OpenRouter.
    const provider = localStorage.getItem('clavis_ai_provider') || 'groq';
    const defaults = {
      openrouter: 'meta-llama/llama-3.3-70b-instruct:free',
      gemini: 'gemini-2.0-flash',
      groq: 'llama-3.3-70b-versatile',
      openai: 'gpt-4o-mini',
      deepseek: 'deepseek-chat',
      mistral: 'mistral-small-latest',
      together: 'meta-llama/Llama-3.3-70B-Instruct-Turbo',
      fireworks: 'accounts/fireworks/models/llama-v3p1-8b-instruct',
      xai: 'grok-3-mini',
      cerebras: 'llama-3.3-70b',
      perplexity: 'sonar'
    };
    const selectedModel = document.getElementById('home-ai-model-select')?.value || defaults[provider] || defaults.openrouter;
    const model = provider !== 'openrouter'
      ? (selectedModel.startsWith(`${provider}/`) ? selectedModel : `${provider}/${defaults[provider] || selectedModel.replace(/^[^/]+\//, '')}`)
      : selectedModel;
    const providerDetails = getProviderDetails(model);

    // Format message with any non-image text attachment content
    let fullUserMessage = userMessage || '';
    if (options.attachments && options.attachments.length > 0) {
      const textAtts = options.attachments.filter(a => !a.isImage && a.textContent);
      if (textAtts.length > 0) {
        fullUserMessage += (fullUserMessage ? '\n\n' : '') + textAtts.map(a => `[Attached Document: ${a.name}]\n${a.textContent}\n[End of ${a.name}]`).join('\n\n');
      }
    }
    if (!fullUserMessage && options.images && options.images.length > 0) {
      fullUserMessage = 'Please inspect and analyze this attached screenshot/image.';
    }

    /* The hosted proxy needs a Supabase session. jarvis.js already
       guards on that; this file did not, so with no session every
       message died on "Sign in before using AI chat" instead of
       falling through to the provider-key path twenty lines below —
       which works offline and is what Clavis itself uses. Same
       guard, same behaviour, one condition. */
    if (window.NexusAIChat && window.SupabaseAuth?.getAccessToken?.()) {
      conversationHistory.push({ role: 'user', content: fullUserMessage });
      saveMessage('user', userMessage || (options.images?.length ? '[Attached Screenshot]' : '[Attachment]'));
      try {
        const payload = {
          model,
          messages: [{ role: 'system', content: getSystemPrompt() }, ...conversationHistory.slice(-10)],
          temperature: 0.7,
          max_tokens: 2048
        };
        if (options.images && options.images.length > 0) {
          payload.images = options.images;
        }
        const data = await window.NexusAIChat.complete(payload, signal);
        const reply = data.choices?.[0]?.message?.content || 'Sorry, I could not process that.';
        conversationHistory.push({ role: 'assistant', content: reply });
        const cleanReply = reply.replace(/\|\|\|ACTION:\{[^}]+\}\|\|\|/g, '').trim();
        saveMessage('assistant', cleanReply);
        const action = extractAction(reply);
        return { text: cleanReply, action };
      } catch (err) {
        conversationHistory.pop();
        throw err;
      }
    }
    // Direct in-browser AI call if a local provider key is connected via ClavisDirect
    if (window.ClavisDirect?.hasKey?.()) {
      conversationHistory.push({ role: 'user', content: fullUserMessage });
      saveMessage('user', userMessage || (options.images?.length ? '[Attached Screenshot]' : '[Attachment]'));
      try {
        const messages = [
          { role: 'system', content: getSystemPrompt() },
          ...conversationHistory.slice(-10)
        ];
        const payload = {
          messages,
          temperature: 0.7,
          max_tokens: 2048
        };
        if (options.images && options.images.length > 0) {
          payload.images = options.images;
        }
        const data = await window.ClavisDirect.complete(payload, signal);

        // Track Tokens
        if (data.usage && data.usage.total_tokens) {
          if (window.MemoryEngine) {
            window.MemoryEngine.addTokensUsed(data.usage.total_tokens);
            const activeProv = window.ClavisDirect.defaultProvider?.() || 'ai';
            window.MemoryEngine.addKeyUsage(activeProv, 0, data.usage.total_tokens);
            if (typeof window.updateRealtimeTokenCounters === 'function') {
              window.updateRealtimeTokenCounters();
            }
          }
        }

        const reply = data.choices?.[0]?.message?.content || 'Sorry, I could not process that.';
        conversationHistory.push({ role: 'assistant', content: reply });
        const action = extractAction(reply);
        const cleanText = reply.replace(/\|\|\|ACTION:\{[^}]+\}\|\|\|/g, '').trim();
        saveMessage('assistant', cleanText);
        return { text: cleanText, action };
      } catch (err) {
        conversationHistory.pop();
        console.error('[Chat AI direct error]', err);
        throw err;
      }
    }

    const apiKey = getApiKey(providerDetails.id);

    if (!apiKey) {
      return { 
        text: `⚠️ I need an API key to work! Please add your **${providerDetails.id.toUpperCase()}** API key in the Settings (🔑 icon) so we can chat and generate leads.`, 
        action: null 
      };
    }

    conversationHistory.push({ role: 'user', content: fullUserMessage });
    saveMessage('user', userMessage || (options.images?.length ? '[Attached Screenshot]' : '[Attachment]'));

    const messages = [
      { role: 'system', content: getSystemPrompt() },
      ...conversationHistory.slice(-10)
    ];

    try {
      const requestModel = model.startsWith('openrouter/') ? model.replace('openrouter/', '') : model;
      const headers = {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      };
      if (providerDetails.id === 'openrouter') {
        headers['HTTP-Referer'] = window.location.href;
        headers['X-Title'] = 'Clavis AI Leads Agent';
      }

      const requestPayload = {
        model: requestModel,
        messages,
        temperature: 0.7,
        max_tokens: 2048,
        stream: false,
      };
      if (options.images && options.images.length > 0) {
        requestPayload.images = options.images;
      }

      const response = await fetch(`${window.SKYLARK_CONFIG?.AI_PROXY_URL || ''}`, {
        method: 'POST',
        headers,
        body: JSON.stringify(requestPayload),
        signal: signal
      });

      if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        if (response.status === 429) { 
          if (handleKeyExhaustion(providerDetails.id)) {
            console.log(`${providerDetails.id} API Key quota exhausted. Switching to next key...`);
            conversationHistory.pop(); 
            return callAI(userMessage, signal, options);
          }
        }
        if (response.status === 401) {
          return { text: `❌ Invalid ${providerDetails.id.toUpperCase()} API key. Please update it in Settings.`, action: null };
        }
        throw new Error(err.error?.message || `API error: ${response.status}`);
      }

      const data = await response.json();
      
      // Track Tokens
      if (data.usage && data.usage.total_tokens) {
        if (window.MemoryEngine) {
          window.MemoryEngine.addTokensUsed(data.usage.total_tokens);
          window.MemoryEngine.addKeyUsage(providerDetails.id, (providerDetails.id === 'groq' ? currentKeyIndex : 0), data.usage.total_tokens);
          if (typeof window.updateRealtimeTokenCounters === 'function') {
            window.updateRealtimeTokenCounters();
          }
        }
      }
      
      const reply = data.choices?.[0]?.message?.content || 'Sorry, I could not process that.';

      conversationHistory.push({ role: 'assistant', content: reply });

      const action = extractAction(reply);
      const cleanText = reply.replace(/\|\|\|ACTION:\{[^}]+\}\|\|\|/g, '').trim();
      saveMessage('assistant', cleanText);

      return { text: cleanText, action };
    } catch (err) {
      console.error(`${providerDetails.id} API error:`, err);
      return { 
        text: `⚠️ **API Error:** ${err.message}. Please check your internet connection or verify your API key limits.`, 
        action: null 
      };
    }
  }

  function extractAction(text) {
    const match = text.match(/\|\|\|ACTION:(\{[^}]+\})\|\|\|/);
    if (match) {
      try { return JSON.parse(match[1]); } catch { return null; }
    }
    return null;
  }

  function localParse(message, options = {}) {
    const msg = (message || '').toLowerCase().trim();
    const honorific = window.UserProfileManager?.getHonorificName?.() || 'Sir';

    const hasImages = options?.images && options.images.length > 0;
    const hasAttachments = options?.attachments && options.attachments.length > 0;

    if (hasImages && (!msg || msg.length < 5)) {
      return {
        text: `🖼️ **Screenshot received, ${honorific}!** Main is screenshot ko inspect kar sakta hoon. Please settings (🔑 icon) me AI key (jaise Gemini ya OpenRouter Vision) connect karein taaki vision model live visual details analyze kar sake. Batayein, is image se kya extract ya verify karna hai?`,
        action: null
      };
    }

    if (hasAttachments && (!msg || msg.length < 5)) {
      const attNames = (options.attachments || []).map(a => a.name).join(', ');
      return {
        text: `📎 **Document received, ${honorific} (${attNames})!** Maine aapka file content load kar liya hai. Batayein is document me se kya strategy, summary, ya lead criteria extract karna hai?`,
        action: null
      };
    }

    // 1. Check for greetings and general conversational check-ins
    if (/^(hi|hello|hey|hola|namaste|greetings|good\s+(morning|afternoon|evening)|kaise\s+ho|kya\s+haal|who\s+are\s+you|kya\s+kar\s+sakte\s+ho|tum\s+kaun\s+ho)\b/i.test(msg) && !/\b(lead|leads|compani|companies|client|clients|data|extract|scrape|nikal|dhundh)\b/i.test(msg)) {
      const hour = new Date().getHours();
      const timeGreeting = hour < 12 ? 'Good morning' : (hour < 17 ? 'Good afternoon' : 'Good evening');
      return {
        text: `${timeGreeting}, ${honorific}! I am Clavis, your B2B Growth & Revenue Architect. Main aapki client acquisition, enterprise pitching, aur market expansion me madad karne ke liye yahan hoon. Hum outreach strategies brainstorm kar sakte hain, custom pitch scripts likh sakte hain, ya verified enterprise leads extract kar sakte hain. Batayein, aaj kis opportunity par focus karna hai?`,
        action: null
      };
    }

    // 2. B2B Pitch & Cold Outreach Strategy Inquiries
    if (/\b(pitch|script|template|cold\s*email|cold\s*call|whatsapp\s*pitch|approach|kaise\s+(approach|baat|pitch|convin)|proposal)\b/i.test(msg) && !/\b(nikal|scrape|extract|generate\s+\d+)\b/i.test(msg)) {
      if (/hospital|health/i.test(msg)) {
        return {
          text: `🏥 **Hospital & Healthcare Pitch Strategy for ${honorific}:**\n\n` +
            `**1. Target Decision Makers:**\n` +
            `- **Medical Superintendent / Facility Director** (Overall administration & hygiene standards)\n` +
            `- **Head of Purchase & Operations** (Contract negotiation & billing)\n\n` +
            `**2. Primary Pain Points in Hospitals:**\n` +
            `- Unsanitary patient zones & infection control failures.\n` +
            `- Guard absenteeism during critical night shifts.\n` +
            `- Lack of police-verified staff around ICU / OT / Pediatrics.\n\n` +
            `**3. High-Converting Pitch Angle:**\n` +
            `*"Hamara staff specialized hospital hygiene protocols me trained hai, 100% police-verified hai, aur hamara 2-hour backup reserve force ensure karta hai ki koi bhi post unattended na rahe."*\n\n` +
            `💡 *Proactive Suggestion:* Kya main aapke liye Hospital Administration ke liye ek customized 30-second cold call script ya WhatsApp pitch draft kar doon?`,
          action: null
        };
      }
      if (/it\s*park|tech|corporate|software|office/i.test(msg)) {
        return {
          text: `🏢 **Corporate & IT Park Pitch Strategy for ${honorific}:**\n\n` +
            `**1. Target Decision Makers:**\n` +
            `- **Head of Administration / Facility Director**\n` +
            `- **VP Operations / Workplace Experience Manager**\n\n` +
            `**2. Key Corporate Priorities:**\n` +
            `- 100% Statutory Compliance (PF, ESIC, Minimum Wages) — Corporates audit vendors strictly.\n` +
            `- Professional grooming, visitor management fluency, and digitized attendance.\n` +
            `- Rapid escalation matrix for urgent staffing replacements.\n\n` +
            `**3. Winning Pitch Hook:**\n` +
            `*"Hum corporate facility & security contracts me full statutory compliance documentation har mahine bill ke sath provide karte hain, with zero-liability guarantee."*\n\n` +
            `💡 *Proactive Suggestion:* Agar aap IT Parks target kar rahe hain, to batayein main relevant target companies ki list extract kar doon ya introductory corporate profile draft karoon?`,
          action: null
        };
      }
      return {
        text: `🎯 **B2B Cold Outreach Framework for ${honorific}:**\n\n` +
          `**Rule 1: Hook on Pain, Not Company Description**\n` +
          `Decision makers (Admin/Facility Heads) don't care how old your agency is. Unhe bas 3 cheezein chahiye: *100% attendance, zero compliance headaches (PF/ESIC), aur fast replacements*.\n\n` +
          `**Rule 2: The 3-Step WhatsApp Pitch Structure:**\n` +
          `1. *Context:* "Namaste [Name], noticed your facility at [Location]..."\n` +
          `2. *Value:* "Hum nearby corporate facilities me 24/7 supervised security & housekeeping provide karte hain with zero-unattended-shift guarantee."\n` +
          `3. *Low-Friction Call-to-Action:* "Kya main aapko hamara 1-page compliance rate card share kar sakta hoon for your upcoming contract review?"\n\n` +
          `Aap kis specific sector (Hotels, Hospitals, IT Parks, Warehouses) ke liye pitch banana chahte hain?`,
        action: null
      };
    }

    // 3. Handling "Already Have a Vendor" Objection
    if (/\b(already|pehle\s*se|existing|dusra|vendor|mana\s*kar\s*diya)\b/i.test(msg) && !/\b(nikal|scrape)\b/i.test(msg)) {
      return {
        text: `🛡️ **Handling "We Already Have an Agency / Vendor":**\n\n` +
          `Jab client kahe ki *"Hamare paas already vendor hai"*, to directly compete mat kariye. Inhe **Backup / Renewal positioning** me convert karein:\n\n` +
          `**Effective Response Script:**\n` +
          `*"Bilkul Sir, I completely respect that aapke paas reliable vendor hai. Hum aapko vendor change karne ke liye nahi keh rahe.\n` +
          `Lekin aksar peak hours ya festive seasons me backup manpower ki zaroorat padti hai. Kya hum hamara verified profile aur rate card aapke paas rakh sakte hain, taaki emergency ya agle contract review ke waqt aapke paas ek solid second option ready rahe?"*\n\n` +
          `Isse client defensive nahi hota aur aapka relation ban jata hai. Would you like me to draft this as a WhatsApp follow-up?`,
        action: null
      };
    }

    const universalPlan = window.LeadCandidateDomain?.parseRequest
      ? window.LeadCandidateDomain.parseRequest(message)
      : null;

    // Route the two product workstreams before the legacy keyword parser. The
    // legacy parser remains as a fallback for filters, exports and casual chat.
    if (universalPlan?.workstream === 'candidates' && universalPlan.isSearch && !/\b(export|download|show|list)\b/i.test(msg)) {
      const role = universalPlan.roles?.[0] || 'relevant candidates';
      const city = universalPlan.cities?.[0] || (window.SKYLARK_CONFIG?.DEFAULT_CITY || 'Gurugram');
      return {
        text: `🎯 Sourcing ${universalPlan.count} ${role} candidate${universalPlan.count === 1 ? '' : 's'} in ${city}. I’ll keep the search in the candidate workstream and return only public listing data.`,
        action: { type: 'candidate_search', role, city, explicitCity: universalPlan.citiesExplicit, count: universalPlan.count, query: message }
      };
    }

    if (universalPlan?.workstream === 'leads' && universalPlan.isSearch && !/\b(export|download|sync|show|list|stats?)\b/i.test(msg)) {
      const cities = universalPlan.cities || [window.SKYLARK_CONFIG?.DEFAULT_CITY || 'Gurugram'];
      const industries = universalPlan.industries || ['ALL'];
      const serviceType = universalPlan.serviceTypes?.length ? universalPlan.serviceTypes : ['All relevant requirements'];
      return {
        text: `🚀 Searching ${industries[0] === 'ALL' ? 'all relevant industries' : industries.join(', ')} in ${cities.join(', ')} for ${serviceType.join(' + ')}. I’ll return only sourced business records and prepare Excel when the run completes.`,
        action: { type: 'generate', cities, industries, serviceType, explicitCity: universalPlan.citiesExplicit, count: universalPlan.count, sources: universalPlan.sources }
      };
    }

    const allCities = ['mumbai','delhi','new delhi','bangalore','hyderabad','chennai','pune','kolkata','ahmedabad','noida','gurgaon','gurugram','jaipur','lucknow','surat','kochi','chandigarh','ghaziabad','faridabad','greater noida','meerut','rohtak','sonipat','panipat','hapur','alwar','bharatpur','baghpat','bulandshahr','muzaffarnagar','shamli','bhiwani','charkhi dadri','jhajjar','jind','karnal','mahendragarh','nuh','palwal','rewari','bawal','manesar','dharuhera','bahadurgarh','modinagar','muradnagar','khurja','pilkhuwa','dadri','bhiwadi','neemrana','loni'];

    const cities = allCities.filter(c => msg.includes(c)).map(c => {
      if(c === 'gurugram') return 'Gurgaon';
      return c.charAt(0).toUpperCase() + c.slice(1);
    });

    const industryMap = {
      'hotel': 'Hotels & Hospitality',
      'hospital': 'Hospitals & Healthcare',
      'healthcare': 'Hospitals & Healthcare',
      'medical': 'Hospitals & Healthcare',
      'it': 'IT Parks & Tech Companies',
      'tech': 'IT Parks & Tech Companies',
      'software': 'IT Parks & Tech Companies',
      'mall': 'Shopping Malls & Retail',
      'retail': 'Shopping Malls & Retail',
      'shopping': 'Shopping Malls & Retail',
      'bank': 'Banks & Financial Institutions',
      'finance': 'Banks & Financial Institutions',
      'corporate': 'Corporate Offices',
      'office': 'Corporate Offices',
      'factory': 'Factories & Warehouses',
      'warehouse': 'Factories & Warehouses',
      'manufacturing': 'Factories & Warehouses',
      'airport': 'Airports & Aviation',
      'aviation': 'Airports & Aviation',
      'real estate': 'Real Estate & Housing',
      'housing': 'Real Estate & Housing',
      'society': 'Real Estate & Housing',
      'school': 'Schools & Educational Institutes',
      'college': 'Schools & Educational Institutes',
      'university': 'Schools & Educational Institutes',
      'education': 'Schools & Educational Institutes',
      'logistics': 'Logistics & E-Commerce',
      'ecommerce': 'Logistics & E-Commerce',
      'courier': 'Logistics & E-Commerce',
    };
    
    const detectedIndustries = new Set();
    for (const [keyword, industry] of Object.entries(industryMap)) {
      if (msg.includes(keyword)) detectedIndustries.add(industry);
    }

    let serviceType = [];
    const roleAliases = [
      ['cook', 'Cooks'], ['chef', 'Chefs'], ['nurse', 'Nurses'],
      ['driver', 'Drivers'], ['delivery', 'Delivery Executives'],
      ['developer', 'Software Developers'], ['engineer', 'Engineers'],
      ['accountant', 'Accountants'], ['receptionist', 'Receptionists'],
      ['sales', 'Sales Executives'], ['teacher', 'Teachers'],
      ['waiter', 'Waiters'], ['electrician', 'Electricians'],
      ['plumber', 'Plumbers'], ['driver', 'Drivers']
    ];
    roleAliases.forEach(([needle, label]) => {
      if (msg.includes(needle) && !serviceType.includes(label)) serviceType.push(label);
    });
    if (/security|guard|suraksha|bouncer/.test(msg)) serviceType.push('Security');
    if (/housekeep|cleaning|safai|facility|janitor|sweeper/.test(msg)) serviceType.push('Housekeeping');
    if (/pantry|tea boy|chai|coffee boy|canteen|office boy|peon|helper/.test(msg)) serviceType.push('Pantry Boy');
    if (serviceType.length === 0) serviceType = ['All relevant requirements'];

    const countMatch = msg.match(/(\d+)\s*(lead|company|compani|client|firm)/)
                    || msg.match(/\b(\d{1,3})\b/);
    const count = countMatch
      ? Math.max(20, Math.min(100, parseInt(countMatch[1], 10)))
      : 20;

    const hasLeadTarget = /\b(lead|leads|prospect|prospects|company|companies|business|businesses|client|clients|firm|firms|data|contact|contacts|email|emails|phone|numbers?)\b/i.test(msg);
    const hasActionVerb = /\b(generate|find|search|get|extract|scrape|pull|nikalo|nikaal|dhundho|chahiye|chahie|laao|collect)\b/i.test(msg);
    const isGenerate = (hasLeadTarget && (hasActionVerb || /\b(\d+\s*(?:leads?|companies|clients?))\b/i.test(msg))) || /\b(leads?\s+(nikal|chahiye|do|laao|dhundh)|nikal\w*\s+leads?)\b/i.test(msg);
    const isExport = msg.includes('export') || msg.includes('csv') || msg.includes('download') || msg.includes('excel');
    const isSync = msg.includes('sync') || msg.includes('sheet') || msg.includes('google');
    const isShow = msg.includes('show') || msg.includes('dikhao') || msg.includes('list') || msg.includes('all leads');
    const isStats = msg.includes('how many') || msg.includes('kitne') || msg.includes('count') || msg.includes('stats') || msg.includes('status');
    const isHelp = msg.includes('help') || msg.includes('kya kar') || msg.includes('kaise') || msg.includes('how to');

    if (isHelp) {
      return {
        text: `🤝 **Clavis B2B Growth Capabilities for ${honorific}:**\n\n` +
          `🔍 **Target & Extract Leads** — *"Find 20 hospital leads in Gurugram for security & housekeeping"*\n` +
          `💼 **Sales Pitch & Scripts** — *"Hospital clients ko pitch kaise karein?"* ya *"Draft a WhatsApp cold message"*\n` +
          `🛡️ **Objection Handling** — *"Agar client kahe already vendor hai to kya bole?"*\n` +
          `📊 **Database Management** — *"Show all leads"*, *"Export to Excel"*, *"Sync to Google Sheets"*\n` +
          `📈 **Analytics** — *"How many leads do I have?"*\n\nAap mujhse natural conversational discussion kar sakte hain ya directly lead extraction command de sakte hain! 🎯`,
        action: null
      };
    }

    if (isExport) {
      if (msg.includes('excel') || msg.includes('xlsx')) {
        return {
          text: '📥 Exporting your leads directly to Excel...',
          action: { type: 'export_excel' }
        };
      }
      return {
        text: '📥 Exporting your leads to CSV...',
        action: { type: 'export', format: 'csv' }
      };
    }

    if (isSync) {
      return {
        text: '📋 Syncing leads to Google Sheets...',
        action: { type: 'sync_sheets' }
      };
    }

    if (isStats) {
      const leadCount = window.allLeads ? window.allLeads.length : 0;
      const newCount = window.allLeads ? window.allLeads.filter(l => l.status === 'New').length : 0;
      return {
        text: `📊 **Your Lead Stats:**\n- Total leads: **${leadCount}**\n- New (uncontacted): **${newCount}**\n- Industries covered: **${new Set(window.allLeads?.map(l => l.industry)).size || 0}**\n- Cities covered: **${new Set(window.allLeads?.map(l => l.city)).size || 0}**`,
        action: null
      };
    }

    if (isShow) {
      return {
        text: '📋 Showing your leads now...',
        action: { type: 'show_all' }
      };
    }

    if (isGenerate && (cities.length > 0 || detectedIndustries.size > 0 || msg.includes('lead') || msg.includes('compani') || msg.includes('client') || msg.includes('data'))) {
      const defaultCity = window.SKYLARK_CONFIG?.DEFAULT_CITY || 'Gurugram';
      const finalCities = cities.length > 0 ? cities : [defaultCity];
      const finalIndustries = detectedIndustries.size > 0 ? [...detectedIndustries] : (window.IndustryDB ? window.IndustryDB.getNames() : ['Hotels & Hospitality', 'Hospitals & Healthcare', 'IT Parks & Tech Companies']);

      return {
        text: `🚀 Generating **${count} leads per combo** for:\n- 📍 Cities: **${finalCities.join(', ')}**\n- 🏭 Industries: **${finalIndustries.length > 3 ? 'All Available Industries (' + finalIndustries.length + ' sectors)' : finalIndustries.join(', ')}**\n- 🧭 Requirement: **${serviceType.join(' + ')}**\n\nStarting pipeline now...`,
        action: {
          type: 'generate',
          cities: finalCities,
          industries: finalIndustries,
          serviceType,
          explicitCity: cities.length > 0,
          count
        }
      };
    }

    return {
      text: `Main aapki B2B sales outreach, client targeting, aur lead acquisition me madad kar sakta hoon. Aap mujhse kisi bhi industry ki outreach strategy discuss kar sakte hain, pitch scripts banwa sakte hain, ya specific requirements ke verified leads nikalwa sakte hain (jaise: *"Gurugram ke IT Parks ke 20 leads nikalo"*). Batayein ${honorific}, kis par kaam karein?`,
      action: null
    };
  }

  function saveMessage(role, text) {
    if (!text || !text.trim()) return;
    try {
      if (window.MemoryEngine?.addClientChatMessage) {
        window.MemoryEngine.addClientChatMessage({
          id: `${role === 'user' ? 'u' : 'a'}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
          role: role,
          text: text.trim(),
          timestamp: Date.now()
        });
      }
    } catch (e) {
      console.warn('[ChatEngine] Save msg failed:', e);
    }
  }

  async function loadPersistedHistory() {
    try {
      if (!window.MemoryEngine?.getClientChatHistory) return;
      const history = await window.MemoryEngine.getClientChatHistory(30);
      if (history && history.length) {
        conversationHistory = history.map(m => ({ role: m.role, content: m.text }));
      }
    } catch (e) {
      console.warn('[ChatEngine] load history failed:', e);
    }
  }

  async function sendMessage(text, signal, options = {}) {
    if ((!text || !text.trim()) && (!options?.images?.length && !options?.attachments?.length)) return null;
    const trimmed = (text || '').trim();

    // 1. Universal Lead/Candidate domain plan
    const universalPlan = window.LeadCandidateDomain?.parseRequest
      ? window.LeadCandidateDomain.parseRequest(trimmed)
      : null;

    // 1b. Leads/candidate DATA requests are answered deterministically, never
    // by a free-text model call. A raw LLM turn has no idea what city or
    // industry the domain parser actually found — it can only guess, and a
    // guess here means an invented company sitting in the wrong city ("give
    // me Ghaziabad leads" answered with Mumbai hotels). localParse() already
    // builds the correct grounded action + a safe, template confirmation
    // line straight from universalPlan, so search intent goes there and
    // skips callAI() entirely. Export/show/sync/stats phrasing is excluded
    // here (matching localParse's own early branches) so those still reach
    // the richer conversational path below.
    const isDataQuery = universalPlan?.isSearch
      && !(options?.images?.length || options?.attachments?.length)
      && !/\b(export|download|sync|show|list|stats?)\b/i.test(trimmed);
    if (isDataQuery) {
      const grounded = localParse(trimmed, options);
      saveMessage('user', trimmed);
      if (grounded?.text) saveMessage('assistant', grounded.text);
      return grounded;
    }

    // 2. Determine if remote AI is usable
    const hasDirectKey = window.ClavisDirect?.hasKey?.();
    const provider = localStorage.getItem('clavis_ai_provider') || 'groq';
    const selectedModel = document.getElementById('home-ai-model-select')?.value || '';
    const provDetails = getProviderDetails(selectedModel);
    const hasKey = hasDirectKey || !!getApiKey(provDetails.id);
    const hasSupabase = !!(window.NexusAIChat && window.SupabaseAuth?.getAccessToken?.());

    if (hasKey || hasSupabase) {
      try {
        const aiResponse = await callAI(trimmed, signal, options);
        if (aiResponse) {
          // If the AI didn't emit an ACTION block but the user's intent is clearly a search, attach it
          if (!aiResponse.action && universalPlan?.isSearch) {
            if (universalPlan.workstream === 'leads') {
              aiResponse.action = {
                type: 'generate',
                cities: universalPlan.cities,
                industries: universalPlan.industries,
                serviceType: universalPlan.serviceTypes,
                explicitCity: universalPlan.citiesExplicit,
                count: universalPlan.count,
                sources: universalPlan.sources,
                query: trimmed
              };
            } else if (universalPlan.workstream === 'candidates') {
              aiResponse.action = {
                type: 'candidate_search',
                role: universalPlan.roles?.[0] || 'relevant candidates',
                city: universalPlan.cities?.[0] || 'Gurugram',
                explicitCity: universalPlan.citiesExplicit,
                count: universalPlan.count,
                query: trimmed
              };
            }
          }
          return aiResponse;
        }
      } catch (err) {
        console.warn('[ChatEngine] callAI failed, using localParse fallback:', err);
      }
    }

    // 3. Instant deterministic local parse fallback (works 100% offline & without LLM keys)
    const local = localParse(trimmed, options);
    saveMessage('user', trimmed || (options?.images?.length ? '[Attached Screenshot]' : '[Attachment]'));
    if (local && local.text) saveMessage('assistant', local.text);
    return local;
  }

  function clearHistory() {
    conversationHistory = [];
    try {
      window.MemoryEngine?.clearClientChatHistory?.();
    } catch (e) {}
  }

  // Auto-load history on initialization
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', loadPersistedHistory, { once: true });
  } else {
    setTimeout(loadPersistedHistory, 400);
  }

  return {
    sendMessage,
    clearHistory,
    loadPersistedHistory,
    saveMessage,
    getApiKey,
    setApiKey,
    getProviderDetails
  };
})();

window.ChatEngine = ChatEngine;
