/**
 * ============================================================
 *  SKYLARK LEAD AGENT — ChatEngine (chat.js)
 *  Multi-Provider API Integration (Groq, NVIDIA, DeepSeek, Moonshot) + Local Hinglish Intent Parsing
 * ============================================================
 */

const ChatEngine = (() => {
  const PROVIDERS = {
    'nvidia': { url: 'https://integrate.api.nvidia.com/v1/chat/completions', prefix: 'nvidia' },
    'deepseek': { url: 'https://api.deepseek.com/chat/completions', prefix: 'deepseek' },
    'moonshot': { url: 'https://api.moonshot.cn/v1/chat/completions', prefix: 'moonshot' },
    'groq': { url: 'https://api.groq.com/openai/v1/chat/completions', prefix: 'groq' },
    'openrouter': { url: 'https://openrouter.ai/api/v1/chat/completions', prefix: 'openrouter' }
  };

  let conversationHistory = [];
  let currentKeyIndex = 0;

  function getProviderDetails(modelName) {
    if (modelName.startsWith('openrouter/')) return { id: 'openrouter', ...PROVIDERS['openrouter'] };
    if (modelName === 'deepseek-chat' || modelName === 'deepseek-coder' || modelName === 'deepseek-reasoner') return { id: 'deepseek', ...PROVIDERS['deepseek'] };
    if (modelName.includes('moonshot')) return { id: 'moonshot', ...PROVIDERS['moonshot'] };
    if (modelName.includes('/')) return { id: 'nvidia', ...PROVIDERS['nvidia'] };
    return { id: 'groq', ...PROVIDERS['groq'] };
  }

  function getApiKey(providerId) {
    // Provider credentials are backend-only; this Android asset never reads
    // keys from localStorage or bundled JavaScript.
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
    return false;
  }  function getSystemPrompt() {
    const leadCount = window.allLeads ? window.allLeads.length : 0;
    const industries = window.IndustryDB ? window.IndustryDB.getNames() : [];
    
    return `You are Skylark AI Assistant — a highly intelligent B2B growth consultant and personal AI companion for "Skylark" (a security & housekeeping provider).

CRITICAL RULE: ACT AS A CONVERSATIONAL AI COMPANION FIRST. Do NOT trigger data generation, extraction, filtering, or syncing UNLESS the user EXPLICITLY asks you to perform those actions (e.g., "find me leads", "scrape data", "filter the database", "sync to sheets", "how many security guards do we need"). 
If the user says "hi", "what can you do", "who are you", or asks a general knowledge question, JUST HAVE A NORMAL CONVERSATION and answer them. Be helpful, proactive, and friendly. You understand Hindi/Hinglish slang perfectly.

Current system state:
- ${leadCount} leads in database
- Available industries: ${industries.join(', ')}
- Available cities: Mumbai, Delhi, Bangalore, Hyderabad, Chennai, Pune, Kolkata, Ahmedabad, Noida, Gurgaon, Jaipur, Lucknow, Surat, Kochi, Chandigarh

ONLY WHEN the user EXPLICITLY asks to GENERATE leads:
- Extract: cities (locations), industries, service type (Security/Housekeeping/Both), and count (default 25 if not specified)
- Respond with a JSON action block that the frontend will parse:
  |||ACTION:{"type":"generate","cities":["Mumbai"],"industries":["Hotels & Hospitality"],"serviceType":["Security"],"count":5}|||
- Then provide a friendly confirmation message.

ONLY WHEN the user EXPLICITLY asks to SHOW/FILTER/FIND existing leads in the database:
- Respond with:
  |||ACTION:{"type":"filter","industry":"Hotels & Hospitality","city":"Mumbai","status":"New"}|||
- Or for showing all: |||ACTION:{"type":"show_all"}|||

ONLY WHEN the user EXPLICITLY asks to EXPORT:
- Respond with: |||ACTION:{"type":"export","format":"csv"}|||

ONLY WHEN the user EXPLICITLY asks to SYNC TO SHEETS:
- Respond with: |||ACTION:{"type":"sync_sheets"}|||

Remember: Use the ACTION blocks ONLY when a specific tool action is requested. Otherwise, just chat normally! Keep responses concise but friendly. Use emojis sparingly. Do NOT output markdown code blocks for the ACTION block, just put it inline like |||ACTION:{...}|||`;
  }

  async function callAI(userMessage, signal) {
    const model = document.getElementById('home-ai-model-select')?.value || 'llama-3.3-70b-versatile';
    const provider = getProviderDetails(model);
    const apiKey = getApiKey(provider.id);

    if (!apiKey) {
      return { 
        text: `⚠️ I need an API key to work! Please add your **${provider.id.toUpperCase()}** API key in the Settings (🔑 icon) so we can chat and generate leads.`, 
        action: null 
      };
    }

    conversationHistory.push({ role: 'user', content: userMessage });

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
      if (provider.id === 'openrouter') {
        headers['HTTP-Referer'] = window.location.href;
        headers['X-Title'] = 'Skylark AI Leads Agent';
      }

      const response = await fetch(provider.url, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          model: requestModel,
          messages,
          temperature: 0.7,
          max_tokens: 2048,
          stream: false,
        }),
        signal: signal
      });

      if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        if (response.status === 429) { 
          if (handleKeyExhaustion(provider.id)) {
            console.log(`${provider.id} API Key quota exhausted. Switching to next key...`);
            conversationHistory.pop(); 
            return callAI(userMessage);
          }
        }
        if (response.status === 401) {
          return { text: `❌ Invalid ${provider.id.toUpperCase()} API key. Please update it in Settings.`, action: null };
        }
        throw new Error(err.error?.message || `API error: ${response.status}`);
      }

      const data = await response.json();
      
      // Track Tokens
      if (data.usage && data.usage.total_tokens) {
        if (window.MemoryEngine) {
          window.MemoryEngine.addTokensUsed(data.usage.total_tokens);
          window.MemoryEngine.addKeyUsage(provider.id, (provider.id === 'groq' ? currentKeyIndex : 0), data.usage.total_tokens);
          if (typeof window.updateRealtimeTokenCounters === 'function') {
            window.updateRealtimeTokenCounters();
          }
        }
      }
      
      const reply = data.choices?.[0]?.message?.content || 'Sorry, I could not process that.';

      conversationHistory.push({ role: 'assistant', content: reply });

      const action = extractAction(reply);
      const cleanText = reply.replace(/\|\|\|ACTION:\{[^}]+\}\|\|\|/g, '').trim();

      return { text: cleanText, action };
    } catch (err) {
      console.error(`${provider.id} API error:`, err);
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

  function localParse(message) {
    const msg = message.toLowerCase();
    const allCities = ['mumbai','delhi','bangalore','hyderabad','chennai','pune','kolkata','ahmedabad','noida','gurgaon','gurugram','jaipur','lucknow','surat','kochi','chandigarh'];

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
    if (msg.includes('security') || msg.includes('guard') || msg.includes('suraksha')) serviceType.push('Security');
    if (msg.includes('housekeeping') || msg.includes('cleaning') || msg.includes('safai') || msg.includes('facility')) serviceType.push('Housekeeping');
    if (serviceType.length === 0) serviceType = ['Security', 'Housekeeping'];

    const countMatch = msg.match(/(\d+)\s*(lead|company|compani)/);
    const count = countMatch ? parseInt(countMatch[1]) : 25;

    const isGenerate = msg.includes('generate') || msg.includes('find') || msg.includes('get') || msg.includes('chahiye') || msg.includes('chahie') || msg.includes('do') || msg.includes('nikalo') || msg.includes('dhundho') || msg.includes('search') || msg.includes('dedo') || msg.includes('batao') || cities.length > 0 || detectedIndustries.size > 0;
    const isExport = msg.includes('export') || msg.includes('csv') || msg.includes('download') || msg.includes('excel');
    const isSync = msg.includes('sync') || msg.includes('sheet') || msg.includes('google');
    const isShow = msg.includes('show') || msg.includes('dikhao') || msg.includes('list') || msg.includes('all leads');
    const isStats = msg.includes('how many') || msg.includes('kitne') || msg.includes('count') || msg.includes('stats') || msg.includes('status');
    const isHelp = msg.includes('help') || msg.includes('kya kar') || msg.includes('kaise') || msg.includes('how to');

    if (isHelp) {
      return {
        text: `🤝 Here\'s what I can do for you:\n\n🔍 **Generate Leads** — "Find 10 hotel leads in Mumbai for security"\n📊 **Show Data** — "Show all uncontacted leads"\n📥 **Export** — "Export all leads to CSV"\n📋 **Sync** — "Sync leads to Google Sheets"\n📈 **Stats** — "How many leads do I have?"\n\nYou can speak in Hindi or English — I understand both! Just tell me what you need. 🎯`,
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

    if (isGenerate && (cities.length > 0 || detectedIndustries.size > 0)) {
      const defaultCity = window.SKYLARK_CONFIG?.DEFAULT_CITY || 'Gurugram';
      const finalCities = cities.length > 0 ? cities : [defaultCity];
      const finalIndustries = detectedIndustries.size > 0 ? [...detectedIndustries] : ['Hotels & Hospitality', 'Hospitals & Healthcare', 'IT Parks & Tech Companies'];

      return {
        text: `🚀 Generating **${count} leads per combo** for:\n- 📍 Cities: **${finalCities.join(', ')}**\n- 🏭 Industries: **${finalIndustries.join(', ')}**\n- 🛡️ Service: **${serviceType.join(' + ')}**\n\nStarting pipeline now...`,
        action: {
          type: 'generate',
          cities: finalCities,
          industries: finalIndustries,
          serviceType,
          count
        }
      };
    }

    return {
      text: 'I\'m not sure what you mean. Try asking me to generate leads, show data, or export to CSV!',
      action: null
    };
  }

  async function sendMessage(text, signal) {
    if (!text.trim()) return null;
    return await callAI(text.trim(), signal);
  }

  function clearHistory() {
    conversationHistory = [];
  }

  return {
    sendMessage,
    clearHistory,
    getApiKey,
    setApiKey,
    getProviderDetails
  };
})();

window.ChatEngine = ChatEngine;
