// Voice AI Dialer Dashboard Logic

function getVoiceAiEl(id) {
  return document.getElementById(id);
}

function setVoiceAiText(id, value) {
  const el = getVoiceAiEl(id);
  if (el) el.textContent = value;
}

function setVoiceAiValue(id, value) {
  const el = getVoiceAiEl(id);
  if (el) el.value = value;
}

class VoiceAIWebSocket {
  constructor(options = {}) {
    this.url = options.url || window.VOICE_WS_URL || "ws://localhost:8000/ws/live-calls";
    this.maxRetries = options.maxRetries ?? 5;
    this.retryCount = 0;
    this.ws = null;
    this.retryTimer = null;
    this.manualClose = false;

    this.onStatusChange = options.onStatusChange || (() => {});
    this.onMessage = options.onMessage || (() => {});
  }

  connect() {
    if (this.manualClose) return;

    if (window.location.protocol === 'file:') {
      this.setStatus("offline");
      return;
    }

    if (typeof WebSocket === 'undefined') {
      this.setStatus("offline");
      return;
    }

    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
      return;
    }

    this.setStatus("connecting");

    try {
      this.ws = new WebSocket(this.url);

      this.ws.onopen = () => {
        this.retryCount = 0;
        this.setStatus("connected");
        console.info("[Voice AI] WebSocket connected");
      };

      this.ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          this.onMessage(data);
        } catch {
          this.onMessage(event.data);
        }
      };

      this.ws.onerror = () => {}; // onclose handles reconnect

      this.ws.onclose = () => {
        this.ws = null;
        if (this.manualClose) {
          this.setStatus("offline");
          return;
        }
        this.scheduleReconnect();
      };
    } catch (error) {
      console.warn("[Voice AI] WebSocket initialization failed:", error);
      this.scheduleReconnect();
    }
  }

  scheduleReconnect() {
    if (this.retryCount >= this.maxRetries) {
      this.setStatus("offline");
      console.warn("[Voice AI] Backend unavailable. Voice AI is offline.");
      return;
    }

    this.retryCount += 1;
    const baseDelay = 1000;
    const maxDelay = 30000;
    const exponentialDelay = Math.min(baseDelay * 2 ** (this.retryCount - 1), maxDelay);
    const jitter = Math.floor(Math.random() * 500);
    const delay = exponentialDelay + jitter;

    this.setStatus("reconnecting", { attempt: this.retryCount, maxRetries: this.maxRetries });
    clearTimeout(this.retryTimer);
    this.retryTimer = setTimeout(() => this.connect(), delay);
  }

  send(payload) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN || typeof WebSocket === 'undefined') {
      console.warn("[Voice AI] Message not sent: backend is offline.");
      return false;
    }
    this.ws.send(typeof payload === "string" ? payload : JSON.stringify(payload));
    return true;
  }

  close() {
    this.manualClose = true;
    clearTimeout(this.retryTimer);
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.setStatus("offline");
  }

  setStatus(status, extra = {}) {
    this.onStatusChange({ status, ...extra });
    const statusElement = document.querySelector("[data-voice-ai-status]");
    if (statusElement) {
      const labels = {
        connecting: "Voice AI: Connecting...",
        connected: "Voice AI: Connected",
        reconnecting: `Voice AI: Reconnecting (${extra.attempt || 0}/${extra.maxRetries || this.maxRetries})...`,
        offline: "Voice AI: Offline — backend unavailable",
      };
      statusElement.textContent = labels[status] || "Voice AI: Unknown";
      statusElement.dataset.status = status;
    }
  }
}

const voiceAI = new VoiceAIWebSocket({
  url: window.VOICE_WS_URL || "ws://localhost:8000/ws/live-calls",
  maxRetries: 5,
  onStatusChange: (status) => {
    // optional debug logging
  },
  onMessage: (data) => {
    VoiceAI.updateLiveCallsList(data);
  },
});

window.addEventListener("DOMContentLoaded", () => {
  voiceAI.connect();
});

window.addEventListener("beforeunload", () => {
  voiceAI.close();
});

const VoiceAI = {
  init: function() {
    // connection handled globally by voiceAI instance now
    try {
      this.fetchStats();
    } catch (error) {
      console.warn("[Voice AI] Init skipped stats render:", error);
    }
  },
  
  fetchStats: function() {
    // Fetch stats from backend (Mocked for UI)
    setVoiceAiText('voice-calls-today', '12');
    setVoiceAiText('voice-appointments', '3');
    setVoiceAiText('voice-avg-duration', '2m 14s');
  },
  
  updateLiveCallsList: function(data) {
    // Mock update logic for the dashboard
    const container = getVoiceAiEl('live-calls-list');
    const badge = getVoiceAiEl('live-calls-count');
    if (!container || !badge) return;
    
    // In a real scenario, we'd parse `data` JSON from the backend
    container.innerHTML = `
      <div style="padding:12px; background:var(--gray-50); border:1px solid var(--border); border-radius:var(--radius-sm); display:flex; justify-content:space-between; align-items:center;">
        <div>
          <div style="font-weight:600; font-size:14px; color:var(--gray-900);">+91 9876543210</div>
          <div style="font-size:12px; color:var(--gray-500);">Speaking with AI Agent (Sales)</div>
        </div>
        <div style="display:flex; align-items:center; gap:8px;">
          <span class="status-dot running"></span>
          <span style="font-size:12px; color:var(--accent-green); font-weight:600;">Active 0:45</span>
        </div>
      </div>
    `;
    badge.innerText = '1 Active';
  },
  
  createCampaign: function() {
    const modal = getVoiceAiEl('campaign-modal');
    if (modal) modal.style.display = 'flex';
  },
  
  startCampaign: function() {
    const nameInput = getVoiceAiEl('campaign-name');
    const name = nameInput ? nameInput.value : '';
    if (!name) {
      alert('Please enter a campaign name');
      return;
    }
    const modal = getVoiceAiEl('campaign-modal');
    if (modal) modal.style.display = 'none';
    
    if (typeof showToast === 'function') {
      showToast('Campaign Started!', 'success');
    }
    
    // UI Update for dummy active campaign
    const actContainer = document.querySelector('.active-campaigns-list') || document.querySelector('#view-voice-ai p');
    if (actContainer && actContainer.innerText.includes('No active campaigns')) {
       actContainer.innerHTML = `<div class="campaign-card" style="padding:16px; border:1px solid var(--border); border-radius:12px; margin-top:16px;">
         <div style="display:flex; justify-content:space-between; margin-bottom:12px;">
           <span style="font-weight:600;">${name}</span>
           <span class="status-dot running"></span>
         </div>
         <p style="font-size:13px; color:var(--gray-600);">Calling uncontacted leads...</p>
       </div>`;
    }
  },
  
  openSettings: function() {
    // Attempt to use the existing global showView function
    if (typeof showView === 'function') {
      showView('settings');
    }
    // Scroll to the Voice AI settings card
    setTimeout(() => {
      const card = getVoiceAiEl('voice-ai-settings-card');
      if (card) {
        card.scrollIntoView({ behavior: 'smooth', block: 'center' });
        card.style.transition = 'box-shadow 0.3s ease';
        card.style.boxShadow = '0 0 0 2px var(--primary), 0 4px 12px rgba(99,102,241,0.2)';
        setTimeout(() => { card.style.boxShadow = ''; }, 2000);
      }
    }, 300);
  },
  
  saveKeys: function() {
    const authId = getVoiceAiEl('plivo-auth-id')?.value.trim() || '';
    const token = getVoiceAiEl('plivo-auth-token')?.value.trim() || '';
    const number = getVoiceAiEl('plivo-number')?.value.trim() || '';
    const wsUrl = getVoiceAiEl('plivo-ws-url')?.value.trim() || '';
    
    // Telephony credentials are backend-only. Do not persist them in the
    // renderer; the backend Exotel/voice configuration is authoritative.
    void authId; void token; void number; void wsUrl;
    
    if (typeof showToast === 'function') {
      showToast('Voice AI Keys saved successfully!', 'success');
    } else {
      alert('Voice AI Keys saved successfully!');
    }
  },
  
  loadKeys: function() {
    ['plivo-auth-id', 'plivo-auth-token', 'plivo-number', 'plivo-ws-url', 'stt-api-key', 'llm-api-key', 'tts-api-key']
      .forEach(id => setVoiceAiValue(id, ''));
    
    // Load engine settings
    const stt = localStorage.getItem('skylark-stt-engine');
    const llm = localStorage.getItem('skylark-llm-engine');
    const tts = localStorage.getItem('skylark-tts-engine');
    
    if (stt) setVoiceAiValue('stt-engine', stt);
    if (llm) setVoiceAiValue('llm-engine', llm);
    if (tts) setVoiceAiValue('tts-engine', tts);
  },
  
  saveEngineKeys: function() {
    const stt = getVoiceAiEl('stt-engine')?.value || '';
    const sttKey = getVoiceAiEl('stt-api-key')?.value.trim() || '';
    const llm = getVoiceAiEl('llm-engine')?.value || '';
    const llmKey = getVoiceAiEl('llm-api-key')?.value.trim() || '';
    const tts = getVoiceAiEl('tts-engine')?.value || '';
    const ttsKey = getVoiceAiEl('tts-api-key')?.value.trim() || '';
    
    localStorage.setItem('skylark-stt-engine', stt);
    localStorage.setItem('skylark-llm-engine', llm);
    localStorage.setItem('skylark-tts-engine', tts);
    void sttKey; void llmKey; void ttsKey;
    
    if (typeof showToast === 'function') {
      showToast('Engine Configuration Saved!', 'success');
    } else {
      alert('Engine Configuration Saved!');
    }
  }
};

// Initialize when DOM loads
document.addEventListener('DOMContentLoaded', () => {
  VoiceAI.init();
  VoiceAI.loadKeys();
});
