import { useState, useRef, useEffect, useCallback } from 'react';

/* ── API Keys (from config.js) ── */
const GROQ_KEYS = [];

const MODELS = [
  { value: 'llama-3.3-70b-versatile', label: 'Llama 3.3 70B (Groq)', badge: '⭐ TOP', flagship: true },
  { value: 'deepseek-chat',           label: 'DeepSeek V3 (DeepSeek API)', badge: '🔥 PRO', flagship: true },
  { value: 'deepseek-reasoner',       label: 'DeepSeek R1 (DeepSeek API)', badge: '🔥 PRO', flagship: true },
  { value: 'moonshot-v1-8k',          label: 'Kimi (Moonshot API)', badge: '🔥 PRO', flagship: true },
  { value: 'mixtral-8x7b-32768',      label: 'Mixtral 8x7B (Groq)', flagship: false },
  { value: 'openrouter/meta-llama/llama-3.3-70b-instruct', label: 'Llama 3.3 70B (OpenRouter)', badge: '🌐 OR', flagship: true },
  { value: 'openrouter/deepseek/deepseek-chat', label: 'DeepSeek V3 (OpenRouter)', badge: '🌐 OR', flagship: true },
  { value: 'openrouter/google/gemini-2.5-pro',  label: 'Gemini 2.5 Pro (OpenRouter)', badge: '🌐 OR', flagship: true },
];

const QUICK_CHIPS = [
  { icon: '💰', label: 'Hotels (Gurugram)', msg: 'Mujhe 25 hotel leads chahiye Gurugram mein security ke liye' },
  { icon: '🏥', label: 'Hospitals (Delhi)',  msg: 'Find 25 hospital leads in Delhi for housekeeping staff' },
  { icon: '💻', label: 'IT Parks (Bangalore)', msg: '25 IT park leads in Bangalore for security guards' },
  { icon: '📄', label: 'Export Excel', msg: 'Export all leads to excel' },
];

function getUserName() {
  try {
    const p = JSON.parse(localStorage.getItem('skylark_user_profile') || '{}');
    const name = p.name || 'Sir';
    return name.split(' ')[0];
  } catch { return 'Sir'; }
}

function getGroqKey(idx) {
  return '';
}

function parseMarkdown(text) {
  return text
    .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.*?)\*/g, '<em>$1</em>')
    .replace(/`(.*?)`/g, '<code>$1</code>')
    .replace(/\n/g, '<br/>');
}

/* ═══════════════════════════════════════════════════════
   CLIENT AI CHAT PAGE — Exact match of view-chat from index.html
═══════════════════════════════════════════════════════ */
export function ClientAIChat() {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [modelOpen, setModelOpen] = useState(false);
  const [model, setModel] = useState('llama-3.3-70b-versatile');
  const [groqKeyIdx, setGroqKeyIdx] = useState(0);
  const [tokenCount, setTokenCount] = useState(0);
  const [conversationHistory, setConversationHistory] = useState([]);
  const messagesEndRef = useRef(null);
  const textareaRef = useRef(null);
  const abortRef = useRef(null);
  const firstName = getUserName();

  const showWelcome = messages.length === 0 && !loading;

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, loading]);

  const addMessage = useCallback((role, html) => {
    setMessages(prev => [...prev, { role, html, id: Date.now() + Math.random() }]);
  }, []);

  const handleSend = useCallback(async (text) => {
    const query = (text || input).trim();
    if (!query || loading) return;
    setInput('');
    if (textareaRef.current) textareaRef.current.style.height = 'auto';

    const groqKey = getGroqKey(groqKeyIdx);
    if (!groqKey) { addMessage('ai', '⚠️ No Groq API key configured.'); return; }

    addMessage('user', query);
    setLoading(true);

    const sysPrompt = `You are Skylark AI, an intelligent lead generation assistant for Indian B2B sales teams.
You help users find business leads (hotels, hospitals, IT companies, export firms) and manage their CRM data.
You understand both English and Hinglish. When user asks for leads, respond with a structured JSON action.
Format: If user wants leads, output exactly: |||ACTION:{"type":"generate_leads","query":"<role>","city":"<city>","count":<n>}|||
Otherwise, respond helpfully in the user's language. Keep responses concise.`;

    const history = [...conversationHistory, { role: 'user', content: query }];

    try {
      const ctrl = new AbortController();
      abortRef.current = ctrl;

      const resp = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        signal: ctrl.signal,
        headers: { 'Authorization': `Bearer ${groqKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: model.startsWith('openrouter') ? 'llama-3.3-70b-versatile' : model,
          messages: [{ role: 'system', content: sysPrompt }, ...history.slice(-10)],
          temperature: 0.7,
          max_tokens: 1024,
        }),
      });

      if (resp.status === 429) {
        setGroqKeyIdx(i => i + 1);
        setLoading(false);
        await handleSend(query);
        return;
      }
      if (!resp.ok) throw new Error(`API Error: ${resp.status}`);

      const data = await resp.json();
      const aiText = data.choices?.[0]?.message?.content || '';
      const usedTokens = data.usage?.total_tokens || 0;
      setTokenCount(t => t + usedTokens);

      setConversationHistory([...history, { role: 'assistant', content: aiText }]);
      setLoading(false);

      // Parse for actions
      const actionMatch = aiText.match(/\|\|\|ACTION:(.*?)\|\|\|/s);
      if (actionMatch) {
        try {
          const action = JSON.parse(actionMatch[1]);
          const beforeAction = aiText.replace(/\|\|\|ACTION:.*?\|\|\|/s, '').trim();
          if (beforeAction) addMessage('ai', parseMarkdown(beforeAction));
          addMessage('ai', `🔍 Generating ${action.count || 25} leads for <strong>${action.query}</strong> in <strong>${action.city || 'Gurugram'}</strong>... <em>Please open the Data Hub to view results.</em>`);
        } catch {
          addMessage('ai', parseMarkdown(aiText));
        }
      } else {
        addMessage('ai', parseMarkdown(aiText));
      }
    } catch (err) {
      if (err.name === 'AbortError') return;
      setLoading(false);
      addMessage('ai', `⚠️ Error: ${err.message}`);
    }
  }, [input, loading, model, groqKeyIdx, conversationHistory, addMessage]);

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); }
  };

  const stopGeneration = () => {
    abortRef.current?.abort();
    setLoading(false);
  };

  const selectedModel = MODELS.find(m => m.value === model) || MODELS[0];

  return (
    /* claude-ui-wrapper */
    <div style={{
      backgroundColor: '#09090b',
      height: '100%',
      minHeight: '100%',
      flex: 1,
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      position: 'relative',
      fontFamily: "'Inter', -apple-system, sans-serif",
      overflow: 'hidden',
      padding: '0 20px 20px',
      width: '100%',
      boxSizing: 'border-box',
      color: '#f1f5f9',
    }}>

      {/* Token counter badge (top-right) */}
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
            marginTop:'15vh',marginBottom:24,opacity:1,
          }}>
            <h1 style={{
              fontFamily:"'Newsreader', 'Georgia', 'Times New Roman', serif",
              fontSize:38,fontWeight:400,color:'#f1f5f9',
              textAlign:'center',letterSpacing:'-0.02em',margin:0,
            }}>
              Welcome back {firstName} sir
            </h1>
          </div>
        )}

        {/* Messages area */}
        {messages.length > 0 && (
          <div style={{
            flex:1,overflowY:'auto',padding:'20px 0',
            display:'flex',flexDirection:'column',gap:16,
          }}>
            {messages.map(msg => (
              <ChatMessage key={msg.id} msg={msg} />
            ))}
            {loading && <TypingIndicator />}
            <div ref={messagesEndRef} />
          </div>
        )}
        {!loading && messages.length > 0 && <div ref={messagesEndRef} />}

        {/* claude-input-container */}
        <div style={{
          width:'100%',
          background:'#121215',
          border:'1px solid rgba(255,255,255,0.12)',
          borderRadius:16,
          boxShadow:'0 4px 20px rgba(0,0,0,0.4)',
          display:'flex',flexDirection:'column',
          padding:'12px 16px',
          marginTop:'auto',
          marginBottom: showWelcome ? 0 : 4,
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
            placeholder="How can I help you today?"
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
            {/* Left: + Upload */}
            <div style={{ display:'flex',alignItems:'center',gap:8 }}>
              <button style={iconBtnStyle} title="Add context">
                <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2">
                  <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
                </svg>
              </button>
              <button style={iconBtnStyle} title="Upload CSV">
                <svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" strokeWidth="2" fill="none">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                  <polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/>
                </svg>
              </button>
            </div>
            {/* Right: model selector + voice + stop + send */}
            <div style={{ display:'flex',alignItems:'center',gap:8,position:'relative' }}>
              {/* Model dropdown */}
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
                    listStyle:'none',padding:6,margin:0,width:'max-content',minWidth:220,
                    zIndex:100,
                  }}>
                    {MODELS.map(m => (
                      <li
                        key={m.value}
                        onClick={() => { setModel(m.value); setModelOpen(false); }}
                        style={{
                          padding:'8px 12px',borderRadius:6,cursor:'pointer',
                          fontSize:13,
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

              {/* Voice btn */}
              <button style={iconBtnStyle} title="Voice Input">
                <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"/>
                  <path d="M19 10v2a7 7 0 0 1-14 0v-2"/>
                  <line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/>
                </svg>
              </button>

              {/* Stop btn (visible when loading) */}
              {loading && (
                <button onClick={stopGeneration} style={{ ...iconBtnStyle, color:'#ef4444' }} title="Stop generating">
                  <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor">
                    <rect x="6" y="6" width="12" height="12" rx="2"/>
                  </svg>
                </button>
              )}

              {/* Send btn */}
              {!loading && (
                <button
                  onClick={() => handleSend()}
                  disabled={!input.trim()}
                  title="Send message"
                  style={{
                    ...iconBtnStyle,
                    background: input.trim() ? '#f0efe9' : 'rgba(255,255,255,0.05)',
                    color: input.trim() ? '#1a1a1a' : '#475569',
                    cursor: input.trim() ? 'pointer' : 'not-allowed',
                  }}
                >
                  <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2">
                    <line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/>
                  </svg>
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Quick Chips */}
        <div style={{
          display:'flex',flexWrap:'wrap',gap:8,
          padding:'12px 0 8px',
          borderTop:'1px solid rgba(255,255,255,0.06)',
        }}>
          {QUICK_CHIPS.map((chip, i) => (
            <button
              key={i}
              onClick={() => handleSend(chip.msg)}
              disabled={loading}
              style={{
                display:'inline-flex',alignItems:'center',gap:5,
                padding:'7px 14px',
                background:'rgba(255,255,255,0.04)',
                border:'1.5px solid rgba(255,255,255,0.1)',
                borderRadius:9999,
                fontSize:12,fontWeight:600,color:'rgba(255,255,255,0.7)',
                cursor:'pointer',whiteSpace:'nowrap',
              }}
            >
              <span style={{ fontSize:13 }}>{chip.icon}</span>
              {chip.label}
            </button>
          ))}
        </div>

        <div style={{ textAlign:'center',fontSize:11,color:'rgba(255,255,255,0.3)',marginTop:4 }}>
          Skylark AI can make mistakes. Always verify lead data.
        </div>
      </div>
    </div>
  );
}

/* ── Shared icon button style (matches .claude-icon-btn) ── */
const iconBtnStyle = {
  background:'transparent',border:'none',color:'#6b6965',
  cursor:'pointer',padding:8,borderRadius:8,
  display:'flex',alignItems:'center',justifyContent:'center',
};

/* ── Chat message component ── */
function ChatMessage({ msg }) {
  const isUser = msg.role === 'user';
  return (
    <div style={{
      display:'flex',gap:12,maxWidth:720,
      flexDirection: isUser ? 'row-reverse' : 'row',
      marginLeft: isUser ? 'auto' : undefined,
      animation:'chatMsgIn 0.3s ease',
    }}>
      <div style={{
        width:32,height:32,borderRadius:'50%',flexShrink:0,
        display:'flex',alignItems:'center',justifyContent:'center',fontSize:14,
        background: isUser ? '#6C5CE7' : 'rgba(108,92,231,0.15)',
        color: isUser ? '#fff' : '#a855f7',
      }}>
        {isUser ? 'U' : '✦'}
      </div>
      <div style={{
        padding:'14px 18px',
        background: isUser ? '#6C5CE7' : 'rgba(255,255,255,0.04)',
        border: isUser ? 'none' : '1px solid rgba(255,255,255,0.08)',
        borderRadius: isUser ? '16px 16px 4px 16px' : '16px 16px 16px 4px',
        fontSize:14,lineHeight:1.6,
        color: isUser ? '#fff' : 'rgba(255,255,255,0.9)',
        maxWidth:600,wordWrap:'break-word',
      }}
        dangerouslySetInnerHTML={{ __html: isUser ? msg.html : msg.html }}
      />
    </div>
  );
}

/* ── Typing indicator ── */
function TypingIndicator() {
  return (
    <div style={{ display:'flex',gap:12,maxWidth:720 }}>
      <div style={{
        width:32,height:32,borderRadius:'50%',flexShrink:0,
        display:'flex',alignItems:'center',justifyContent:'center',
        background:'rgba(108,92,231,0.15)',color:'#a855f7',fontSize:14,
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
  );
}
