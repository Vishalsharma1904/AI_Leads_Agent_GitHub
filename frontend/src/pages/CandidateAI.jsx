import { useState, useRef, useEffect, useCallback } from 'react';

/* ── API Keys ── */
const GROQ_KEYS = [];
const APIFY_KEYS = [];

const MODELS = [
  { value: 'llama-3.3-70b-versatile', label: 'Llama 3.3 70B (Groq)', badge: '⭐ TOP', flagship: true },
  { value: 'deepseek-chat',           label: 'DeepSeek V3 (DeepSeek API)', badge: '🔥 PRO', flagship: true },
  { value: 'deepseek-reasoner',       label: 'DeepSeek R1 (DeepSeek API)', badge: '🔥 PRO', flagship: true },
  { value: 'moonshot-v1-8k',          label: 'Kimi (Moonshot API)', badge: '🔥 PRO', flagship: true },
  { value: 'mixtral-8x7b-32768',      label: 'Mixtral 8x7B (Groq)', flagship: false },
];

const CANDIDATE_SYSTEM_PROMPT = `You are a helpful AI assistant for candidate recruitment. Analyze the user's input carefully.

IF the user is explicitly asking for candidate data, profiles, job seekers, or to find/hire someone (e.g., 'mujhe pune me react developer chahiye 5 log', 'find 10 security guards in Delhi'), output EXACTLY a JSON object:
{"intent": "scrape", "role": "Job Role Here", "city": "City Name Here", "quantity": <number>}
If city is not mentioned, use 'Gurugram'. If quantity is not mentioned, use 10.

HOWEVER, IF the user is asking a general question, greeting you, or talking about anything else (e.g., 'what is react?', 'hello', 'how to hire?'), output EXACTLY a JSON object:
{"intent": "chat", "reply": "Your conversational, helpful response here in the user's language."}

Your ENTIRE response MUST be valid JSON only. Do not add any extra text outside the JSON.`;

function getGroqKey(idx) {
  return '';
}
function getApifyKey(idx) {
  return '';
}

function parseMarkdown(text) {
  return text
    .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.*?)\*/g, '<em>$1</em>')
    .replace(/\n/g, '<br/>');
}

/* ═══════════════════════════════════════════════════════
   CANDIDATE AI PAGE — Exact match of view-candidate-ai from index.html
═══════════════════════════════════════════════════════ */
export function CandidateAI() {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [scraping, setScraping] = useState(false);
  const [statusText, setStatusText] = useState('');
  const [modelOpen, setModelOpen] = useState(false);
  const [model, setModel] = useState('llama-3.3-70b-versatile');
  const [groqKeyIdx, setGroqKeyIdx] = useState(0);
  const [apifyKeyIdx, setApifyKeyIdx] = useState(0);
  const [tokenCount, setTokenCount] = useState(0);
  const [conversationHistory, setConversationHistory] = useState([]);
  const [candidates, setCandidates] = useState([]);
  const messagesEndRef = useRef(null);
  const textareaRef = useRef(null);

  const showWelcome = messages.length === 0 && !loading && !scraping;

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, loading, scraping]);

  const addMessage = useCallback((role, html, data = null) => {
    setMessages(prev => [...prev, { role, html, data, id: Date.now() + Math.random() }]);
  }, []);

  const handleSend = useCallback(async (text) => {
    const query = (text || input).trim();
    if (!query || loading || scraping) return;
    setInput('');
    if (textareaRef.current) textareaRef.current.style.height = 'auto';

    const groqKey = getGroqKey(groqKeyIdx);
    if (!groqKey) { addMessage('ai', '⚠️ No Groq API key configured.'); return; }

    addMessage('user', query);
    setLoading(true);
    setStatusText('Understanding your request...');

    const history = [...conversationHistory, { role: 'user', content: query }];

    try {
      const resp = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${groqKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'llama-3.3-70b-versatile',
          messages: [{ role: 'system', content: CANDIDATE_SYSTEM_PROMPT }, ...history.slice(-5)],
          temperature: 0.3,
        }),
      });

      if (resp.status === 429) {
        setGroqKeyIdx(i => i + 1);
        setLoading(false);
        setStatusText('');
        await handleSend(query);
        return;
      }
      if (!resp.ok) throw new Error(`Groq error ${resp.status}`);

      const data = await resp.json();
      const raw = data.choices?.[0]?.message?.content || '{}';
      setTokenCount(t => t + (data.usage?.total_tokens || 0));
      setLoading(false);

      let intent;
      const jsonMatch = raw.match(/\{[\s\S]*\}/);
      if (!jsonMatch) throw new Error('Could not parse AI intent.');
      intent = JSON.parse(jsonMatch[0]);

      if (intent.intent === 'chat') {
        setStatusText('');
        addMessage('ai', parseMarkdown(intent.reply || "I'm here to help!"));
        setConversationHistory([...history, { role: 'assistant', content: intent.reply }]);
        return;
      }

      // SCRAPE
      const apifyKey = getApifyKey(apifyKeyIdx);
      if (!apifyKey) {
        addMessage('ai', '⚠️ No Apify API key configured. Please add one in API Keys settings.');
        setStatusText('');
        return;
      }

      const role = intent.role || 'professional';
      const city = intent.city || 'Gurugram';
      const quantity = Math.min(intent.quantity || 10, 20);

      addMessage('ai', `🔍 Searching for <strong>${quantity} ${role}</strong> candidates in <strong>${city}</strong>...`);
      setScraping(true);
      setStatusText(`Scraping LinkedIn & Indeed for ${role} in ${city}...`);

      const searchQuery = `(site:linkedin.com/in OR site:indeed.com/r) "${role}" "${city}" -intitle:hiring -intitle:recruiter`;

      let results = [];
      let apifyAttempts = 0;

      while (apifyAttempts < APIFY_KEYS.length) {
        const currentKey = getApifyKey(apifyKeyIdx + apifyAttempts);
        const apifyResp = await fetch(
          `https://api.apify.com/v2/acts/apify~google-search-scraper/run-sync-get-dataset-items?token=${currentKey}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              queries: searchQuery,
              resultsPerPage: quantity,
              maxPagesPerQuery: 1,
            }),
          }
        );

        if (apifyResp.status === 402 || apifyResp.status === 403 || apifyResp.status === 429) {
          setApifyKeyIdx(i => i + 1);
          apifyAttempts++;
          setStatusText(`Rotating API key... (attempt ${apifyAttempts + 1})`);
          continue;
        }
        if (!apifyResp.ok) throw new Error(`Apify error ${apifyResp.status}`);

        const apifyData = await apifyResp.json();
        results = apifyData?.[0]?.organicResults || [];
        if (results.length > quantity) results = results.slice(0, quantity);
        break;
      }

      setScraping(false);
      setStatusText('');

      if (results.length === 0) {
        addMessage('ai', `No candidates found for "${role}" in "${city}". Try different keywords.`);
        return;
      }

      // Parse results
      const parsed = results.map((r, idx) => {
        const nameMatch = r.title?.split(/[-|]/)[0]?.trim() || `Candidate ${idx + 1}`;
        const snippet = r.description || '';
        const phoneMatch = snippet.match(/(?:(?:\+|0{0,2})91[\s-]?)?[6789]\d{9}/);
        const emailMatch = snippet.match(/([a-zA-Z0-9._-]+@[a-zA-Z0-9._-]+\.[a-zA-Z0-9_-]+)/);
        const cand = {
          id: `cand_${Date.now()}_${idx}`,
          name: nameMatch,
          role, city,
          phone: phoneMatch?.[0] || '',
          email: emailMatch?.[0] || '',
          description: snippet,
          url: r.url || '#',
        };
        return (window.DataSanitizer && typeof window.DataSanitizer.sanitizeCandidate === 'function')
          ? window.DataSanitizer.sanitizeCandidate(cand)
          : cand;
      }).filter(Boolean);

      setCandidates(prev => [...prev, ...parsed]);
      addMessage('ai',
        `✅ Found <strong>${parsed.length} ${role}</strong> candidates in <strong>${city}</strong>! Results shown below.`,
        parsed
      );
      setConversationHistory([...history, { role: 'assistant', content: `Scraped ${parsed.length} candidates.` }]);

    } catch (err) {
      setLoading(false);
      setScraping(false);
      setStatusText('');
      addMessage('ai', `⚠️ Error: ${err.message}`);
    }
  }, [input, loading, scraping, conversationHistory, model, groqKeyIdx, apifyKeyIdx, addMessage]);

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); }
  };

  const exportCSV = () => {
    if (!candidates.length) return;
    const headers = ['Name', 'Role', 'City', 'Phone', 'Email', 'URL'];
    const rows = candidates.map(c => [c.name, c.role, c.city, c.phone, c.email, c.url]);
    const csv = [headers, ...rows].map(r => r.join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `candidates_${Date.now()}.csv`; a.click();
  };

  const selectedModel = MODELS.find(m => m.value === model) || MODELS[0];

  return (
    <div style={{
      backgroundColor: '#09090b',
      height: '100%', minHeight: '100%', flex: 1,
      display: 'flex', flexDirection: 'column', alignItems: 'center',
      position: 'relative',
      fontFamily: "'Inter', -apple-system, sans-serif",
      overflow: 'hidden',
      padding: '0 20px 20px',
      width: '100%', boxSizing: 'border-box',
      color: '#f1f5f9',
    }}>

      {/* Token counter badge */}
      <div style={{
        position:'absolute',top:20,right:20,
        padding:'6px 12px',background:'rgba(255,255,255,0.06)',
        border:'1px solid rgba(255,255,255,0.1)',borderRadius:20,
        boxShadow:'0 4px 6px -1px rgba(0,0,0,0.2)',
        display:'flex',alignItems:'center',gap:6,
        fontFamily:"'SFMono-Regular', Consolas, monospace",
        fontSize:13,fontWeight:600,color:'#f59e0b',zIndex:10,
      }}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <circle cx="12" cy="8" r="7"/><polyline points="8.21 13.89 7 23 12 20 17 23 15.79 13.88"/>
        </svg>
        <span>{tokenCount} / 400</span>
      </div>

      {/* chat-container */}
      <div style={{
        width:'100%',maxWidth:768,display:'flex',flexDirection:'column',
        flex:1,minHeight:0,height:'100%',position:'relative',zIndex:2,
      }}>

        {/* Welcome (claude-greeting-container) */}
        {showWelcome && (
          <div style={{
            display:'flex',alignItems:'center',justifyContent:'center',
            marginTop:'15vh',marginBottom:24,
          }}>
            <h1 style={{
              fontFamily:"'Newsreader','Georgia','Times New Roman',serif",
              fontSize:38,fontWeight:400,color:'#f1f5f9',
              textAlign:'center',letterSpacing:'-0.02em',margin:0,
            }}>
              Candidate AI Ready
            </h1>
          </div>
        )}

        {/* Messages */}
        {messages.length > 0 && (
          <div style={{
            flex:1,overflowY:'auto',padding:'20px 0',
            display:'flex',flexDirection:'column',gap:16,
          }}>
            {messages.map(msg => (
              <CandidateMessage key={msg.id} msg={msg} />
            ))}
            {(loading || scraping) && <TypingIndicator statusText={statusText} />}
            <div ref={messagesEndRef} />
          </div>
        )}

        {/* Input container */}
        <div style={{
          width:'100%',
          background:'#121215',
          border:'1px solid rgba(255,255,255,0.12)',
          borderRadius:16,
          boxShadow:'0 4px 20px rgba(0,0,0,0.4)',
          display:'flex',flexDirection:'column',
          padding:'12px 16px',
          marginTop:'auto',
        }}>
          <textarea
            ref={textareaRef}
            value={input}
            onChange={e => {
              setInput(e.target.value);
              e.target.style.height = 'auto';
              e.target.style.height = Math.min(e.target.scrollHeight, 200) + 'px';
            }}
            onKeyDown={handleKeyDown}
            disabled={scraping}
            placeholder="Ask AI... (e.g., 'Mujhe Mumbai me HR Admin chahiye 10 candidates ki list')"
            rows={1}
            style={{
              width:'100%',border:'none',background:'transparent',
              fontFamily:'inherit',fontSize:16,color:'#ffffff',
              resize:'none',outline:'none',
              minHeight:48,maxHeight:200,
              padding:'8px 0',lineHeight:1.5,
            }}
          />
          {/* Toolbar */}
          <div style={{ display:'flex',justifyContent:'space-between',alignItems:'center',marginTop:8 }}>
            <div style={{ display:'flex',alignItems:'center',gap:8 }}>
              <button style={iconBtnStyle} title="Add context">
                <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2">
                  <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
                </svg>
              </button>
            </div>
            <div style={{ display:'flex',alignItems:'center',gap:8,position:'relative' }}>
              {/* Model selector */}
              <div style={{ position:'relative' }}>
                <button
                  onClick={() => setModelOpen(o => !o)}
                  style={{
                    ...iconBtnStyle,
                    display:'flex',alignItems:'center',gap:6,
                    padding:'8px 12px',fontSize:13,fontWeight:500,color:'#94a3b8',
                  }}
                >
                  <span>{selectedModel.label.split(' (')[0]}</span>
                  <svg viewBox="0 0 24 24" width="14" height="14" stroke="currentColor" strokeWidth="2" fill="none">
                    <polyline points="6 9 12 15 18 9"/>
                  </svg>
                </button>
                {modelOpen && (
                  <ul style={{
                    position:'absolute',bottom:'110%',right:0,
                    background:'rgba(20,20,24,0.98)',border:'1px solid rgba(255,255,255,0.12)',
                    borderRadius:12,boxShadow:'0 10px 25px rgba(0,0,0,0.5)',
                    listStyle:'none',padding:6,margin:0,width:'max-content',minWidth:220,zIndex:100,
                  }}>
                    {MODELS.map(m => (
                      <li
                        key={m.value}
                        onClick={() => { setModel(m.value); setModelOpen(false); }}
                        style={{
                          padding:'8px 12px',borderRadius:6,cursor:'pointer',fontSize:13,
                          color: m.value === model ? '#a855f7' : '#e2e8f0',
                          background: m.value === model ? 'rgba(168,85,247,0.12)' : 'transparent',
                          display:'flex',justifyContent:'space-between',alignItems:'center',
                        }}
                      >
                        <span>{m.label}</span>
                        {m.badge && (
                          <span style={{
                            fontSize:9,background:'linear-gradient(135deg,#d27b5e,#f59e0b)',
                            color:'#fff',padding:'2px 5px',borderRadius:4,fontWeight:800,marginLeft:8,
                          }}>{m.badge}</span>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              {/* Send btn */}
              <button
                onClick={() => handleSend()}
                disabled={!input.trim() || loading || scraping}
                title="Send message"
                style={{
                  ...iconBtnStyle,
                  background: input.trim() && !loading && !scraping ? '#f0efe9' : 'rgba(255,255,255,0.05)',
                  color: input.trim() && !loading && !scraping ? '#1a1a1a' : '#475569',
                  cursor: input.trim() && !loading && !scraping ? 'pointer' : 'not-allowed',
                }}
              >
                <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2">
                  <line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/>
                </svg>
              </button>
            </div>
          </div>
        </div>

        {/* Status text */}
        {statusText && (
          <div style={{ marginTop:8,textAlign:'center',fontSize:13,color:'#94a3b8' }}>
            {statusText}
          </div>
        )}

        {/* Export CSV btn */}
        {candidates.length > 0 && (
          <div style={{ display:'flex',justifyContent:'center',marginTop:8 }}>
            <button
              onClick={exportCSV}
              style={{
                display:'inline-flex',alignItems:'center',gap:6,
                padding:'8px 16px',
                background:'rgba(16,185,129,0.1)',
                border:'1px solid rgba(16,185,129,0.3)',borderRadius:8,
                fontSize:13,fontWeight:600,color:'#10b981',cursor:'pointer',
              }}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                <polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>
              </svg>
              Export {candidates.length} Candidates CSV
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

/* ── Icon btn style ── */
const iconBtnStyle = {
  background:'transparent',border:'none',color:'#6b6965',
  cursor:'pointer',padding:8,borderRadius:8,
  display:'flex',alignItems:'center',justifyContent:'center',
};

/* ── Message bubble ── */
function CandidateMessage({ msg }) {
  const isUser = msg.role === 'user';
  return (
    <div style={{ display:'flex',flexDirection:'column',gap:8 }}>
      <div style={{
        display:'flex',gap:12,maxWidth:720,
        flexDirection: isUser ? 'row-reverse' : 'row',
        marginLeft: isUser ? 'auto' : undefined,
      }}>
        <div style={{
          width:32,height:32,borderRadius:'50%',flexShrink:0,
          display:'flex',alignItems:'center',justifyContent:'center',fontSize:14,
          background: isUser ? '#6C5CE7' : 'rgba(168,85,247,0.15)',
          color: isUser ? '#fff' : '#a855f7',
        }}>
          {isUser ? 'U' : '✦'}
        </div>
        <div
          style={{
            padding:'14px 18px',
            background: isUser ? '#6C5CE7' : 'rgba(255,255,255,0.04)',
            border: isUser ? 'none' : '1px solid rgba(255,255,255,0.08)',
            borderRadius: isUser ? '16px 16px 4px 16px' : '16px 16px 16px 4px',
            fontSize:14,lineHeight:1.6,
            color: isUser ? '#fff' : 'rgba(255,255,255,0.9)',
            maxWidth:600,wordWrap:'break-word',
          }}
          dangerouslySetInnerHTML={{ __html: msg.html }}
        />
      </div>

      {/* Candidates table */}
      {msg.data && msg.data.length > 0 && (
        <CandidatesTable candidates={msg.data} />
      )}
    </div>
  );
}

/* ── Candidates results table ── */
function CandidatesTable({ candidates }) {
  return (
    <div style={{
      width:'100%',marginTop:4,
      border:'1px solid rgba(255,255,255,0.08)',
      borderRadius:12,overflow:'hidden',
      background:'rgba(255,255,255,0.02)',
    }}>
      <div style={{
        padding:'10px 16px',borderBottom:'1px solid rgba(255,255,255,0.06)',
        display:'flex',justifyContent:'space-between',alignItems:'center',
      }}>
        <span style={{ fontSize:12,fontWeight:600,color:'rgba(255,255,255,0.7)' }}>
          {candidates.length} Candidates Found
        </span>
        <span style={{ fontSize:10,color:'rgba(255,255,255,0.3)' }}>Scraped from LinkedIn & Indeed</span>
      </div>
      <div style={{ overflowX:'auto' }}>
        <table style={{ width:'100%',borderCollapse:'collapse',fontSize:12 }}>
          <thead>
            <tr style={{ borderBottom:'1px solid rgba(255,255,255,0.05)' }}>
              {['#','Name','Phone','Email','City','Profile'].map(h => (
                <th key={h} style={{ textAlign:'left',padding:'8px 12px',color:'rgba(255,255,255,0.4)',fontWeight:600 }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {candidates.map((c, idx) => (
              <tr key={c.id} style={{ borderBottom:'1px solid rgba(255,255,255,0.03)' }}>
                <td style={{ padding:'8px 12px',color:'rgba(255,255,255,0.3)' }}>{idx+1}</td>
                <td style={{ padding:'8px 12px',color:'rgba(255,255,255,0.85)',fontWeight:500,maxWidth:120,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap' }}>{c.name}</td>
                <td style={{ padding:'8px 12px',color:'rgba(255,255,255,0.6)' }}>{c.phone || '—'}</td>
                <td style={{ padding:'8px 12px',color:'rgba(255,255,255,0.6)',maxWidth:140,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap' }}>{c.email || '—'}</td>
                <td style={{ padding:'8px 12px',color:'rgba(255,255,255,0.6)' }}>{c.city}</td>
                <td style={{ padding:'8px 12px' }}>
                  {c.url && c.url !== '#' ? (
                    <a href={c.url} target="_blank" rel="noopener noreferrer"
                      style={{ color:'#818cf8',textDecoration:'none',display:'flex',alignItems:'center',gap:4 }}>
                      View
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>
                        <polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/>
                      </svg>
                    </a>
                  ) : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ── Typing/Scraping indicator ── */
function TypingIndicator({ statusText }) {
  return (
    <div style={{ display:'flex',flexDirection:'column',gap:6 }}>
      <div style={{ display:'flex',gap:12,maxWidth:720 }}>
        <div style={{
          width:32,height:32,borderRadius:'50%',flexShrink:0,
          display:'flex',alignItems:'center',justifyContent:'center',
          background:'rgba(168,85,247,0.15)',color:'#a855f7',fontSize:14,
        }}>✦</div>
        <div style={{
          padding:'14px 18px',background:'rgba(255,255,255,0.04)',
          border:'1px solid rgba(255,255,255,0.08)',
          borderRadius:'16px 16px 16px 4px',
          display:'flex',gap:5,alignItems:'center',
        }}>
          {[0,1,2].map(i => (
            <div key={i} style={{
              width:8,height:8,borderRadius:'50%',background:'rgba(255,255,255,0.3)',
              animation:`typingBounce 1.2s infinite ${i*0.15}s`,
            }}/>
          ))}
        </div>
      </div>
      {statusText && (
        <div style={{ fontSize:12,color:'#94a3b8',paddingLeft:44 }}>{statusText}</div>
      )}
    </div>
  );
}
