/**
 * ============================================================
 *  CLAVIS UI CONTROLLER (jarvis_ui.js)
 *  Wires the Clavis view to the existing compatibility APIs.
 *  - Chat rendering, Gemini voice input/output, spoken replies
 *  - Call script generator modal
 *  - Long-term memory panel
 * ============================================================
 */

'use strict';

let jarvisSpeechEnabled = false;
let jarvisController = null;
let jarvisRecognition = null;
let isJarvisSpeaking = false;
let currentPlayingAudio = null;
let jarvisSpeechAbortController = null;
let jarvisSpeechRequestId = 0;
let jarvisSpeechSafetyTimer = null;
let jarvisSpeechAudioUrl = '';

// ── Hands-free / wake-word state ──────────────────────────────
let jarvisHandsFree = false;      // master toggle for "always listening"
let wakeRecognition = null;       // background recognizer listening for Clavis wake phrases
let commandRecognition = null;    // active recognizer capturing a command after wake
let jarvisAwake = false;          // true while actively taking a command
let relistenTimer = null;
let jarvisVoiceSession = 0;
let wakeRestartTimer = null;
let wakeStopRequested = false;
let clavisSoundTriggerBound = false;

async function refreshClavisConnectionStatus() {
  // A local (bring-your-own) key is enough — no backend needed.
  if (window.ClavisDirect?.hasKey?.()) { setJarvisStatus('online', 'Clavis Ready'); return; }
  const aiProviders = new Set(['openrouter', 'gemini', 'groq', 'openai', 'deepseek', 'mistral', 'together', 'fireworks', 'xai', 'cerebras', 'perplexity']);
  try {
    const result = await window.NexusAIChat?.getCredentials?.();
    const configured = (result?.credentials || []).some(item => item.configured && aiProviders.has(item.provider));
        setJarvisStatus(configured ? 'online' : 'offline', configured ? 'Clavis Ready' : 'Needs setup');
  } catch (_) {
    setJarvisStatus('offline', 'Needs setup');
  }
}

// Ask for microphone access once per browser origin. The stream is immediately
// released; the actual recorder still starts only after a deliberate user action.
// Reads the real microphone permission and keeps the saved flag honest.
// 'prompt' -> ask once right away (Chrome shows its bar; one click = on for good).
async function syncClavisMicPermission() {
  let state = '';
  try {
    const status = await navigator.permissions?.query?.({ name: 'microphone' });
    state = status?.state || '';
    if (status && !status.__clavisBound) {
      status.__clavisBound = true;
      status.onchange = () => {
        if (status.state === 'granted') {
          localStorage.setItem('clavis_mic_permission_granted', 'true');
          window.dispatchEvent(new CustomEvent('clavis:mic-granted'));
        } else {
          localStorage.setItem('clavis_mic_permission_granted', 'false');
          setJarvisStatus('online', 'Mic setup needed');
        }
      };
    }
  } catch (_) {}
  if (state === 'granted') localStorage.setItem('clavis_mic_permission_granted', 'true');
  else if (state === 'denied') localStorage.setItem('clavis_mic_permission_granted', 'false');
  else if (state === 'prompt') localStorage.setItem('clavis_mic_permission_granted', 'false');
  return state;
}

// Click on the "Mic setup needed" pill: a real user gesture, so Chrome will
// always show its prompt; if the mic is blocked, say exactly where to fix it.
async function clavisMicPillClicked() {
  try {
    if (location.protocol === 'file:' || !window.isSecureContext) {
      showToast({ type: 'warning', title: 'Open Clavis in browser mode', message: 'Microphone access needs http://localhost:3000. The file:// page cannot keep this permission.' });
      return;
    }
    const permission = await navigator.permissions?.query?.({ name: 'microphone' });
    if (permission?.state === 'granted') {
      localStorage.setItem('clavis_mic_permission_granted', 'true');
      window.dispatchEvent(new CustomEvent('clavis:mic-granted'));
      return;
    }
    if (permission?.state === 'denied') {
      showToast({ type: 'warning', title: 'Microphone blocked', message: 'Address bar ke left icon par click karke Microphone → Allow kijiye, phir yahan retry kijiye.' });
      return;
    }
    if (window.LocalSpeechEngine?.acquireSharedMicrophone) await window.LocalSpeechEngine.acquireSharedMicrophone();
    else {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach((t) => t.stop());
    }
    localStorage.setItem('clavis_mic_permission_granted', 'true');
    window.dispatchEvent(new CustomEvent('clavis:mic-granted'));
    showToast({ type: 'success', title: 'Mic on', message: 'Snap, clap or say "Clavis" — main sun raha hoon.' });
  } catch (_) {
    showToast({ type: 'warning', title: 'Mic blocked in this browser', message: 'Address bar ke left wale icon par click karke Microphone → Allow kijiye, phir page reload kijiye.' });
  }
}
window.clavisMicPillClicked = clavisMicPillClicked;

async function requestClavisMicrophoneOnce() {
  if (!navigator.mediaDevices?.getUserMedia) return false;
  if (location.protocol === 'file:' || !window.isSecureContext) return false;
  try {
    const permission = await navigator.permissions?.query?.({ name: 'microphone' });
    if (permission?.state === 'granted') {
      localStorage.setItem('clavis_mic_permission_granted', 'true');
      return true;
    }
    if (permission?.state === 'denied') return false;

    // This function is called from a deliberate click/tap. Do not permanently
    // blacklist a prompt after a failed non-gesture attempt or page reload.
    if (window.LocalSpeechEngine?.acquireSharedMicrophone) await window.LocalSpeechEngine.acquireSharedMicrophone();
    else {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      stream.getTracks().forEach(track => track.stop());
    }
    localStorage.setItem('clavis_mic_permission_granted', 'true');
    localStorage.setItem('clavis_mic_permission_requested', 'true');
    return true;
  } catch (error) {
    console.info('[Clavis] Microphone permission not granted:', error?.name || 'unknown');
    return false;
  }
}

async function initJarvisUI() {
  const input = document.getElementById('jarvis-input');
  if (input) {
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleJarvisSend();
      }
    });
    input.addEventListener('input', () => {
      autoGrowJarvisInput();
      updateComposerTypingState();
    });
  }

  // Ensure clicking anywhere on the composer card focuses the input
  const composerCard = document.querySelector('.jarvis-luxury-composer');
  if (composerCard) {
    composerCard.addEventListener('click', (e) => {
      if (!e.target.closest('button') && !e.target.closest('.jarvis-composer-dropdown') && !e.target.closest('.jarvis-tool-menu-wrapper')) {
        const inp = document.getElementById('jarvis-input');
        if (inp) inp.focus();
      }
    });
  }

  // Bind screenshot paste handler (Ctrl+V anywhere in Clavis view)
  bindJarvisComposerPaste();

  jarvisSpeechEnabled = localStorage.getItem('jarvis_speech_enabled') === 'true';
  updateJarvisSpeechIcon();

  // The voice path is intentionally Gemini only. Do not unlock or
  // enumerate browser SpeechSynthesis voices; that used to create a slow
  // Microsoft/Google fallback race and a second audible persona.

  // Restore greeting with owner's name - uses ClavisBootGreet for time-aware variation
  if (window.ClavisBootGreet?.updateVisualGreeting) {
    window.ClavisBootGreet.updateVisualGreeting();
  } else {
    const greetEl = document.getElementById('jarvis-welcome-text');
    if (greetEl) {
      const honorific = window.UserProfileManager?.getHonorificName?.() || 'Sir';
      const h = new Date().getHours();
      const timeGreet = h < 5 ? 'Late night' : h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : h < 21 ? 'Good evening' : 'Good night';
      greetEl.textContent = timeGreet + ', ' + honorific + '!';
    }
  }

  // Load any persisted Dev-Mode custom skills so they're callable this session
  if (window.JarvisSkills?.loadCustomSkills) {
    try { await window.JarvisSkills.loadCustomSkills(); } catch (e) { console.warn(e); }
  }

  // Load persisted history + facts, render them (skip if a specific conversation
  // was just rendered by Chat History / New Chat, so it doesn't get overridden)
  // Load facts into memory engine; keep the hero stage clean with centered orb on refresh
  if (window.JarvisEngine) {
    try { await window.JarvisEngine.loadFacts(); } catch (e) { console.warn(e); }
    // Start in the clean hero state on page load/refresh.
    // All conversations remain safely preserved in Chat History (Ctrl+Shift+H).
    const container = document.getElementById('jarvis-messages');
    if (container) container.innerHTML = '';
    updateJarvisChatStage(false);
  }
  refreshJarvisSidePanels();
  renderJarvisSkillsList();
  renderClavisBrainState();   // show "connect a free AI key" card if Clavis has no brain yet
  initClavisSoundTriggers();
  // Do not prompt on page load. The first Tap & Talk / Hands-Free / Clap action
  // is the explicit permission gate; after one successful grant the shared
  // microphone stream restores both hands-free features automatically.
  const micGranted = localStorage.getItem('clavis_mic_permission_granted') === 'true';
  const micCaption = document.getElementById('clavis-voice-caption');
  if (micCaption) micCaption.textContent = micGranted ? 'Mic ready · Tap to speak' : 'Tap the mic once to enable voice';

  // file:// cannot provide reliable persistent microphone permission. When the
  // normal local browser server is already running, move to that origin
  // automatically instead of repeating a permission flow on every refresh.
  if (location.protocol === 'file:') {
    setJarvisStatus('offline', 'Open on localhost');
    const existingWarn = document.getElementById('clavis-file-warning');
    if (existingWarn) existingWarn.remove();
    try {
      const localUrl = 'http://localhost:3000/index.html#jarvis';
      await fetch(localUrl, { method: 'HEAD', mode: 'no-cors', cache: 'no-store' });
      location.replace(localUrl);
      return;
    } catch (_) {}
    if (typeof window.showToast === 'function') window.showToast('warning', 'Open the browser version', 'Use http://localhost:3000 for one-time persistent microphone access. A file:// page cannot keep voice permissions.', 8000);
  }

  // Reflect Dev Mode + hands-free state on the toggle buttons
  const devBtn = document.getElementById('jarvis-dev-btn');
  if (devBtn) devBtn.classList.toggle('active', localStorage.getItem('jarvis_dev_mode') === 'true');

  // One-time reset so hands-free, clap/snap and voice replies start ON for
  // everyone after this update (older builds could leave them stuck off).
  if (!localStorage.getItem('clavis_defaults_v3')) {
    ['jarvis_hands_free', 'clavis_sound_trigger_enabled', 'jarvis_speech_enabled', 'clavis_mic_permission_requested']
      .forEach((k) => localStorage.removeItem(k));
    localStorage.setItem('clavis_defaults_v3', '1');
  }
  // The browser is the truth about the mic, not a flag saved months ago.
  await syncClavisMicPermission();

  // Hands-free is ON by default (user request): Clavis is live the moment the
  // app opens. It stays on until the user explicitly turns it off - the stored
  // value is only consulted to honour an explicit 'false'.
  jarvisHandsFree = localStorage.getItem('clavis_mic_permission_granted') === 'true'
    && localStorage.getItem('jarvis_hands_free') !== 'false';
  const hfBtn = document.getElementById('jarvis-handsfree-btn');
  if (hfBtn) {
    hfBtn.classList.toggle('active', jarvisHandsFree);
    hfBtn.setAttribute('aria-pressed', String(jarvisHandsFree));
  }

  if (!jarvisSpeechEnabled) {
    jarvisSpeechEnabled = true;
    localStorage.setItem('jarvis_speech_enabled', 'true');
    updateJarvisSpeechIcon();
  }

  // Just checks Gemini is configured; there is no local model to warm up.
  window.LocalSpeechEngine?.health?.().catch(() => {});

  // Start listening: Hands-free and Snap/Clap sound triggers are ON by default!
  const activateAudioAndSensors = () => {
    if (localStorage.getItem('clavis_mic_permission_granted') !== 'true') return;
    if (localStorage.getItem('clavis_sound_trigger_enabled') !== 'false') {
      startClavisSoundTriggers();
    }
    if (jarvisHandsFree) {
      startWakeListener();
      setJarvisStatus('listening', 'Sun raha hoon — bolo "Clavis"');
    }
    if (window.ClavisAudioTrigger?.context?.state === 'suspended') {
      window.ClavisAudioTrigger.context.resume().catch(() => {});
    }
  };

  setTimeout(activateAudioAndSensors, 500);

  window.addEventListener('clavis:mic-granted', () => {
    localStorage.setItem('clavis_mic_permission_granted', 'true');
    jarvisHandsFree = localStorage.getItem('jarvis_hands_free') !== 'false';
    localStorage.setItem('jarvis_hands_free', 'true');
    localStorage.setItem('clavis_sound_trigger_enabled', 'true');
    const handsFreeButton = document.getElementById('jarvis-handsfree-btn');
    handsFreeButton?.classList.add('active');
    handsFreeButton?.setAttribute('aria-pressed', 'true');
    updateClavisSoundTriggerButton(true);
    setJarvisStatus(window.currentJarvisStatus || 'online', window.currentJarvisStatus === 'listening' ? 'Sun raha hoon — bolo "Clavis"' : 'Mic ready · voice controls restored');
    if (!window.LocalSpeechEngine?.inputSocket && !isJarvisSpeaking) {
      setTimeout(() => {
        if (!window.LocalSpeechEngine?.inputSocket && !isJarvisSpeaking) activateAudioAndSensors();
      }, 900);
    }
  }, { once: false });

  // Guarantee instant unlock on first user gesture anywhere if browser autoplay policy was restrictive
  ['pointerdown', 'keydown', 'click', 'focus'].forEach(evt => {
    window.addEventListener(evt, () => {
      activateAudioAndSensors();
    }, { once: true, passive: true });
  });

  if (!jarvisHandsFree) {
    setJarvisStatus('online', 'Clavis Online');
  }

  // Right side panel: default CLOSED unless the user previously opened it.
  const panel = document.getElementById('jarvis-side-panel');
  if (panel) {
    const closed = localStorage.getItem('jarvis_side_closed');
    const isClosed = closed === null ? true : closed === 'true';
    panel.classList.toggle('closed', isClosed);
    document.getElementById('jarvis-panel-toggle')?.classList.toggle('active', !isClosed);
  }

  checkJarvisKeys();
  initJarvisBackground();
  // Voice settings are rendered by the Gemini-only panel. Never populate it
  // from browser SpeechSynthesis or a separate cloud voice inventory.
  initClavisLocalVoiceControls();
  
  // Guarantee every button has reliable click feedback and direct listener
  bindJarvisUIButtons();
  refreshClavisConnectionStatus();
  startClavisTipTicker();

  // Attach click handler on orb for instant interactive talk/stop
  const orb = document.getElementById('orb-container');
  if (orb) {
    orb.onclick = handleOrbClick;
  }
  const hasExisting = document.querySelectorAll('#jarvis-messages .chat-message').length > 0;
  updateJarvisChatStage(hasExisting);
}

// ── Interactive Orb Click Handler (talk/interrupt toggle) ──
function handleOrbClick() {
  if (isJarvisSpeaking) {
    stopJarvisGeneration();
  } else {
    startJarvisVoiceInput();
  }
}
window.handleOrbClick = handleOrbClick;

// ── Clavis Dynamic Stage: Orb stays full-size & centered; output routes to floating surface ──
function updateJarvisChatStage(hasMessages) {
  const view = document.getElementById('view-jarvis');
  const stage = document.querySelector('.jarvis-hero-stage');
  const welcome = document.getElementById('jarvis-welcome');
  
  // Clavis tab: Orb and welcome stay permanently visible and full-sized.
  // Responses route exclusively to the floating task surface (#clavis-task-surface).
  view?.classList.remove('has-messages');
  stage?.classList.remove('has-messages');
  if (welcome) welcome.style.display = 'flex';
}
window.updateJarvisChatStage = updateJarvisChatStage;

// ── Screenshot 2 Luxury Composer Helpers ──────────────────────
function clearJarvisInputText() {
  const input = document.getElementById('jarvis-input');
  if (input) {
    input.value = '';
    autoGrowJarvisInput();
    updateComposerTypingState();
    input.focus();
  }
}
window.clearJarvisInputText = clearJarvisInputText;

// ── Dynamic Short Feature Tips Ticker (Overview of features) ──
const CLAVIS_FEATURE_TIPS = [
  { icon: '👏', text: 'Clap twice or snap fingers to talk' },
  { icon: '🎙️', text: 'Bolo: "Analyze today\'s top leads"' },
  { icon: '⚡', text: 'Say "Clavis" anytime hands-free' },
  { icon: '📞', text: 'Bolo: "Generate high-converting call script"' },
  { icon: '💬', text: 'Ask: "Draft WhatsApp follow-up for leads"' },
  { icon: '⌨️', text: 'Press Ctrl + \\ to toggle memory & tools' },
  { icon: '✨', text: 'Tap the orb anytime to start speaking' },
  { icon: '💡', text: 'Ask: "Summarize pending pipeline follow-ups"' }
];

let clavisTipIndex = 0;
let clavisTipTimer = null;

function cycleClavisFeatureTip() {
  clavisTipIndex = (clavisTipIndex + 1) % CLAVIS_FEATURE_TIPS.length;
  const item = CLAVIS_FEATURE_TIPS[clavisTipIndex];
  const iconEl = document.getElementById('clavis-tip-icon');
  const textEl = document.getElementById('clavis-tip-text');
  const pillEl = document.getElementById('clavis-feature-tip-pill');
  if (pillEl) {
    pillEl.style.opacity = '0';
    pillEl.style.transform = 'translateY(3px)';
    setTimeout(() => {
      if (iconEl) iconEl.textContent = item.icon;
      if (textEl) textEl.textContent = item.text;
      pillEl.style.opacity = '1';
      pillEl.style.transform = 'translateY(0)';
    }, 180);
  }
}
window.cycleClavisFeatureTip = cycleClavisFeatureTip;

function startClavisTipTicker() {
  if (clavisTipTimer) clearInterval(clavisTipTimer);
  clavisTipTimer = setInterval(cycleClavisFeatureTip, 4200);
}

function focusJarvisComposer(e) {
  if (e && e.target && (e.target.closest('button') || e.target.closest('.jarvis-composer-dropdown'))) return;
  const input = document.getElementById('jarvis-input');
  if (input) {
    input.focus();
  }
}
window.focusJarvisComposer = focusJarvisComposer;


function updateComposerTypingState() {
  const input = document.getElementById('jarvis-input');
  const text = input ? input.value.trim() : '';
  const hasText = text.length > 0;
  
  const clearBtn = document.getElementById('jarvis-composer-clear-btn');
  const activeDot = document.getElementById('jarvis-composer-active-dot');
  const sendBtn = document.getElementById('jarvis-send-btn');
  
  if (clearBtn) clearBtn.style.display = hasText ? 'inline-flex' : 'none';
  if (activeDot) activeDot.style.display = hasText ? 'block' : 'none';
  if (sendBtn) sendBtn.classList.toggle('has-text', hasText);
}
window.updateComposerTypingState = updateComposerTypingState;

function toggleComposerAddMenu(force) {
  const dd = document.getElementById('jarvis-composer-add-dropdown');
  if (!dd) return;
  const show = typeof force === 'boolean' ? force : dd.hidden;
  dd.hidden = !show;
  if (show) {
    toggleComposerInspirationMenu(false);
    toggleComposerModelMenu(false);
  }
}
window.toggleComposerAddMenu = toggleComposerAddMenu;

function toggleComposerInspirationMenu(force) {
  const dd = document.getElementById('jarvis-composer-insp-dropdown');
  if (!dd) return;
  const show = typeof force === 'boolean' ? force : dd.hidden;
  dd.hidden = !show;
  if (show) {
    toggleComposerAddMenu(false);
    toggleComposerModelMenu(false);
  }
}
window.toggleComposerInspirationMenu = toggleComposerInspirationMenu;

function toggleComposerModelMenu(force) {
  const dd = document.getElementById('jarvis-composer-model-dropdown');
  if (!dd) return;
  const show = typeof force === 'boolean' ? force : dd.hidden;
  dd.hidden = !show;
  if (show) {
    toggleComposerAddMenu(false);
    toggleComposerInspirationMenu(false);
  }
}
window.toggleComposerModelMenu = toggleComposerModelMenu;

function switchJarvisModel(modelKey, label) {
  localStorage.setItem('jarvis_preferred_model', modelKey);
  const labelEl = document.getElementById('jarvis-current-model-label');
  if (labelEl) {
    labelEl.textContent = label.includes('(') ? label.split('(')[0].trim() : label;
  }
  if (typeof window.showToast === 'function') {
    window.showToast('info', 'AI Model Active', label);
  }
}
window.switchJarvisModel = switchJarvisModel;

// Auto close composer dropdowns on outside click
document.addEventListener('click', (e) => {
  if (!e.target.closest('#jarvis-composer-add-btn') && !e.target.closest('#jarvis-composer-add-dropdown')) {
    toggleComposerAddMenu(false);
  }
  if (!e.target.closest('#jarvis-composer-inspiration-btn') && !e.target.closest('#jarvis-composer-insp-dropdown')) {
    toggleComposerInspirationMenu(false);
  }
  if (!e.target.closest('#jarvis-composer-model-btn') && !e.target.closest('#jarvis-composer-model-dropdown')) {
    toggleComposerModelMenu(false);
  }
});

window.quickSendJarvis = quickSendJarvis;

function renderJarvisHistory(history) {
  const container = document.getElementById('jarvis-messages');
  if (!container || !history?.length) {
    updateJarvisChatStage(false);
    return;
  }
  container.innerHTML = '';
  updateJarvisChatStage(true);
  history.forEach(h => {
    appendJarvisBubble(h.role === 'user' ? 'user' : 'assistant', '<p>' + escHtml(h.text).replace(/\n/g, '<br>') + '</p>', false);
  });
  scrollJarvisToBottom();
}
// Staggered reveal when opening a saved conversation from Chat History
function renderJarvisConversation(msgs) {
  window.__jarvisRenderedAt = Date.now();
  const container = document.getElementById('jarvis-messages');
  const welcome = document.getElementById('jarvis-welcome');
  if (!container) return;
  if (welcome) welcome.style.display = 'none';
  container.innerHTML = '';
  (msgs || []).forEach((m, i) => {
    const msgDiv = document.createElement('div');
    msgDiv.className = `chat-message ${m.role === 'user' ? 'user' : 'assistant'} conv-reveal`;
    msgDiv.style.animationDelay = `${Math.min(i * 42, 640)}ms`;

    const avatar = document.createElement('div');
    avatar.className = 'chat-avatar';
    if (m.role === 'user') {
    avatar.innerHTML = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>';
  } else {
    avatar.innerHTML = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="10" rx="2"/><circle cx="12" cy="5" r="2"/><path d="M12 7v4"/><line x1="8" y1="16" x2="8.01" y2="16"/><line x1="16" y1="16" x2="16.01" y2="16"/></svg>';
  }

    const bubble = document.createElement('div');
    bubble.className = 'chat-bubble';
    bubble.innerHTML = `<p>${escHtml(m.text || '').replace(/\n/g, '<br>')}</p>`;

    msgDiv.appendChild(avatar);
    msgDiv.appendChild(bubble);
    container.appendChild(msgDiv);
  });
  scrollJarvisToBottom();
}

// Start a brand-new conversation (keeps old chats saved in history)
async function newJarvisChat() {
  window.__jarvisRenderedAt = Date.now();
  if (window.JarvisEngine && window.JarvisEngine.startNewConversation) {
    try { await window.JarvisEngine.startNewConversation(); } catch (e) { console.warn(e); }
  }
  const container = document.getElementById('jarvis-messages');
  if (container) container.innerHTML = '';
  updateJarvisChatStage(false);
  setJarvisStatus('online', 'Clavis Online');
  if (typeof window.showToast === 'function') {
    window.showToast('success', '✨ New Chat', 'Nayi conversation shuru ho gayi.');
  }
  return true;
}
window.newJarvisChat = newJarvisChat;

function scrollJarvisToBottom(options = {}) {
  const jc = document.getElementById('jarvis-chat-scroll') || document.querySelector('.jarvis-chat-container');
  if (!jc) return;
  const force = options === true || options.force === true;
  const nearBottom = jc.scrollHeight - jc.scrollTop - jc.clientHeight < 64;
  if (force || nearBottom) jc.scrollTop = jc.scrollHeight;
}

function quickSendJarvis(text) {
  const input = document.getElementById('jarvis-input');
  if (input) {
    input.value = text;
    handleJarvisSend();
  }
}

// Smoothly grow the input from a compact default up to a max, then scroll.
// We measure scrollHeight while height = 'auto' (so the browser wraps text),
// then immediately restore a px value so the CSS transition can animate.
function autoGrowJarvisInput() {
  const el = document.getElementById('jarvis-input');
  if (!el) return;
  // Temporarily collapse so scrollHeight reflects actual content height
  const prev = el.style.height;
  el.style.height = 'auto';
  const target = Math.max(30, Math.min(el.scrollHeight, 200));
  // Restore immediately so the CSS transition fires from prev → target
  el.style.height = prev || '30px';
  // rAF lets the browser paint the restored value, then transitions to target
  requestAnimationFrame(() => {
    el.style.height = target + 'px';
    el.style.overflowY = el.scrollHeight > 200 ? 'auto' : 'hidden';
  });
}

function appendJarvisBubble(role, html, animate = true) {
  const container = document.getElementById('jarvis-messages');
  if (!container) return null;
  const welcome = document.getElementById('jarvis-welcome');
  if (welcome) welcome.style.display = 'none';

  const msgDiv = document.createElement('div');
  msgDiv.className = `chat-message ${role}`;
  if (!animate) msgDiv.style.animation = 'none';

  const avatar = document.createElement('div');
  avatar.className = 'chat-avatar';
  if (role === 'user') {
    avatar.innerHTML = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>';
  } else {
    avatar.innerHTML = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="10" rx="2"/><circle cx="12" cy="5" r="2"/><path d="M12 7v4"/><line x1="8" y1="16" x2="8.01" y2="16"/><line x1="16" y1="16" x2="16.01" y2="16"/></svg>';
  }

  const bubble = document.createElement('div');
  bubble.className = 'chat-bubble';
  bubble.innerHTML = html;

  msgDiv.appendChild(avatar);
  msgDiv.appendChild(bubble);
  container.appendChild(msgDiv);
  scrollJarvisToBottom();
  return bubble;
}

function showJarvisTyping() {
  const container = document.getElementById('jarvis-messages');
  if (!container) return;
  const typing = document.createElement('div');
  typing.className = 'typing-indicator';
  typing.id = 'jarvis-typing-indicator';
  typing.innerHTML = `
    <div class="chat-avatar" style="width:24px;height:24px;font-size:10px;margin-right:12px;">J</div>
    <div style="display:flex;align-items:center;gap:8px;background:var(--gray-50);padding:10px 16px;border-radius:12px;">
      <span style="font-size:13px;color:var(--gray-600);font-weight:500;">Clavis is thinking</span>
      <div class="typing-dot"></div><div class="typing-dot"></div><div class="typing-dot"></div>
    </div>`;
  container.appendChild(typing);
  scrollJarvisToBottom();
}

function hideJarvisTyping() {
  document.getElementById('jarvis-typing-indicator')?.remove();
}

// ── Clavis "brain" (AI key) onboarding ────────────────────────────────────
// Without an LLM key Clavis literally cannot reply — this makes that state
// obvious and fixable in one paste, instead of a silent/cryptic failure.
function renderClavisBrainState() {
  const welcome = document.getElementById('jarvis-welcome');
  const has = window.JarvisEngine?.hasBrain?.() ?? true;
  const existing = document.getElementById('clavis-brain-card');
  if (has) { existing?.remove(); return; }
  if (existing || !welcome) return;
  const card = document.createElement('div');
  card.id = 'clavis-brain-card';
  card.style.cssText = 'margin:14px auto 0;max-width:440px;background:rgba(99,102,241,.06);border:1px solid rgba(99,102,241,.28);border-radius:14px;padding:14px 16px;text-align:left;';
  card.innerHTML = `
    <div style="font-weight:700;font-size:14px;color:var(--gray-800,#1f2430);margin-bottom:4px;">⚡ Connect Clavis's brain to start talking</div>
    <div style="font-size:12.5px;color:var(--gray-600,#5b616e);line-height:1.5;margin-bottom:10px;">
      Clavis needs a <b>Groq</b> AI key to think (free tier, no OpenAI account required):
      open <a href="https://console.groq.com/keys" target="_blank" rel="noopener" style="color:#6366f1;font-weight:600;">console.groq.com/keys</a> → Create key → paste it below.
    </div>
    <div style="display:flex;gap:8px;">
      <input id="clavis-brain-key" type="password" placeholder="Paste Groq key (gsk_...)" autocomplete="off"
        style="flex:1;padding:9px 11px;border:1px solid rgba(0,0,0,.15);border-radius:9px;font-size:12.5px;background:#fff;color:#1f2430;">
      <button id="clavis-brain-save" onclick="saveClavisBrainKey()"
        style="padding:9px 16px;border:none;border-radius:9px;background:#6366f1;color:#fff;font-weight:600;font-size:12.5px;cursor:pointer;white-space:nowrap;">Connect</button>
    </div>
    <div id="clavis-brain-msg" style="font-size:11.5px;margin-top:6px;min-height:14px;"></div>`;
  welcome.appendChild(card);
  document.getElementById('clavis-brain-key')?.addEventListener('keydown', (e) => { if (e.key === 'Enter') saveClavisBrainKey(); });
}

function saveClavisBrainKey() {
  openClavisCredentialDialog();
}
window.saveClavisBrainKey = saveClavisBrainKey;
window.renderClavisBrainState = renderClavisBrainState;

let clavisCredentialPreviousFocus = null;

const CLAVIS_PROVIDER_UI = {
  groq: { label: 'Groq API key', link: 'https://console.groq.com/keys', linkText: 'Get a free key from Groq', placeholder: 'gsk_...' },
  gemini: { label: 'Google AI Studio API key', link: 'https://aistudio.google.com/app/apikey', linkText: 'Get a key from Google AI Studio (ai.google.dev)', placeholder: 'AIza...' },
  openai: { label: 'OpenAI API key', link: 'https://platform.openai.com/api-keys', linkText: 'Get a key from OpenAI', placeholder: 'sk-...' },
  openrouter: { label: 'OpenRouter API key', link: 'https://openrouter.ai/keys', linkText: 'Get a key from OpenRouter', placeholder: 'sk-or-v1-...' },
  deepseek: { label: 'DeepSeek API key', link: 'https://platform.deepseek.com/api_keys', linkText: 'Get a key from DeepSeek', placeholder: 'sk-...' },
  mistral: { label: 'Mistral API key', link: 'https://console.mistral.ai/api-keys', linkText: 'Get a key from Mistral', placeholder: '...' },
  together: { label: 'Together AI API key', link: 'https://api.together.ai/settings/api-keys', linkText: 'Get a key from Together AI', placeholder: '...' },
  fireworks: { label: 'Fireworks AI API key', link: 'https://fireworks.ai/account/api-keys', linkText: 'Get a key from Fireworks AI', placeholder: 'fw_...' },
  xai: { label: 'Grok (xAI) API key', link: 'https://console.x.ai/', linkText: 'Get a Grok key from xAI', placeholder: 'xai-...' },
  cerebras: { label: 'Cerebras API key', link: 'https://cloud.cerebras.ai/platform', linkText: 'Get a key from Cerebras', placeholder: 'csk-...' },
  perplexity: { label: 'Perplexity API key', link: 'https://www.perplexity.ai/settings/api', linkText: 'Get a key from Perplexity', placeholder: 'pplx-...' }
};

function updateClavisProviderHelp() {
  const provider = document.getElementById('clavis-provider-select')?.value || 'groq';
  const meta = CLAVIS_PROVIDER_UI[provider] || CLAVIS_PROVIDER_UI.groq || CLAVIS_PROVIDER_UI.openrouter;
  const link = document.getElementById('clavis-provider-link');
  const label = document.getElementById('clavis-key-label');
  const input = document.getElementById('clavis-credential-input');
  if (link) {
    link.href = meta.link;
    link.innerHTML = `${meta.linkText} <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="display:inline-block;vertical-align:middle;margin-left:4px;"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path><polyline points="15 3 21 3 21 9"></polyline><line x1="10" y1="14" x2="21" y2="3"></line></svg>`;
  }
  if (label) label.textContent = meta.label;
  if (input) input.placeholder = meta.placeholder;
}

// Which provider(s) are connected right now, which one is active, and how
// much has been used — reuses MemoryEngine's existing token counter instead
// of adding new tracking. ponytail: token count only, not per-provider cost
// breakdown — add that if the user asks to see spend by provider.
function updateClavisConnectionStatus() {
  const el = document.getElementById('clavis-connection-status');
  if (!el || !window.ClavisDirect) return;
  const configured = window.ClavisDirect.configuredProviders();
  const shortLabel = (p) => (CLAVIS_PROVIDER_UI[p]?.label || p).replace(' API key', '');
  if (!configured.length) {
    el.textContent = 'No AI key connected yet.';
    return;
  }
  const active = window.ClavisDirect.defaultProvider();
  const tokens = window.MemoryEngine?.getTotalTokensUsed?.() || 0;
  el.textContent = `Connected: ${configured.map(shortLabel).join(', ')} (${configured.length}) — active: ${shortLabel(active)} Â· ${tokens.toLocaleString('en-IN')} tokens used so far.`;
}

function normalizeClavisCredential(value) {
  return String(value || '')
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .replace(/\s+/g, '')
    .trim();
}

function setClavisCredentialValue(value) {
  const input = document.getElementById('clavis-credential-input');
  if (!input) return;
  input.value = normalizeClavisCredential(value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.focus();
}

async function pasteClavisCredential() {
  const input = document.getElementById('clavis-credential-input');
  if (!input) return;
  try {
    const value = await navigator.clipboard.readText();
    if (!value) throw new Error('Clipboard is empty');
    setClavisCredentialValue(value);
    showToast({ type: 'success', title: 'Key pasted', message: 'Review the key, then select Connect & verify.', timeoutMs: 4500 });
  } catch (_) {
    input.focus();
    showToast({ type: 'info', title: 'Paste permission needed', message: 'Click the key field and press Ctrl+V. Spaces and line breaks will be removed automatically.', timeoutMs: 6500 });
  }
}

function openClavisCredentialDialog(provider) {
  const dialog = document.getElementById('clavis-credential-dialog');
  if (!dialog) return;
  clavisCredentialPreviousFocus = document.activeElement;
  dialog.inert = false;
  dialog.removeAttribute('inert');
  dialog.hidden = false;
  dialog.setAttribute('aria-hidden', 'false');
  document.body.classList.add('clavis-modal-open');
  const providerSelect = document.getElementById('clavis-provider-select');
  const targetProvider = provider || localStorage.getItem('clavis_ai_provider') || 'groq';
  if (providerSelect && providerSelect.querySelector(`option[value="${targetProvider}"]`)) {
    providerSelect.value = targetProvider;
  }
  updateClavisProviderHelp();
  updateClavisConnectionStatus();
  const input = document.getElementById('clavis-credential-input');
  const error = document.getElementById('clavis-credential-error');
  if (error) { error.hidden = true; error.textContent = ''; }
  if (input && !input.dataset.clavisPasteBound) {
    input.addEventListener('paste', (event) => {
      const value = event.clipboardData?.getData('text') || '';
      if (!value) return;
      event.preventDefault();
      setClavisCredentialValue(value);
    });
    input.dataset.clavisPasteBound = 'true';
  }
  requestAnimationFrame(() => input?.focus());
}

function closeClavisCredentialDialog() {
  const dialog = document.getElementById('clavis-credential-dialog');
  const error = document.getElementById('clavis-credential-error');
  if (!dialog) return;
  dialog.hidden = true;
  dialog.setAttribute('aria-hidden', 'true');
  document.body.classList.remove('clavis-modal-open');
  if (error) { error.hidden = true; error.textContent = ''; }
  if (clavisCredentialPreviousFocus?.focus) clavisCredentialPreviousFocus.focus();
  clavisCredentialPreviousFocus = null;
}

function toggleClavisCredentialVisibility() {
  const input = document.getElementById('clavis-credential-input');
  const toggle = document.querySelector('.clavis-key-toggle');
  if (!input) return;
  const visible = input.type === 'text';
  input.type = visible ? 'password' : 'text';
  if (toggle) { toggle.textContent = visible ? 'Show' : 'Hide'; toggle.setAttribute('aria-label', visible ? 'Show API key' : 'Hide API key'); }
}

async function saveClavisCredential() {
  const input = document.getElementById('clavis-credential-input');
  const submit = document.getElementById('clavis-credential-submit');
  const error = document.getElementById('clavis-credential-error');
  const provider = document.getElementById('clavis-provider-select')?.value || 'groq';
  const key = normalizeClavisCredential(input?.value);
  if (input) input.value = key;
  const valid = provider === 'openrouter' ? /^sk-or-\S{10,}$/.test(key)
    : provider === 'groq' ? /^gsk_\S{10,}$/.test(key)
    : provider === 'gemini' ? /^AIza\S{10,}$/.test(key)
    : provider === 'openai' ? /^sk-\S{10,}$/.test(key)
    : /^\S{10,}$/.test(key);
  if (!valid) {
    if (error) { error.hidden = false; error.textContent = `Enter a valid ${CLAVIS_PROVIDER_UI[provider]?.label || 'provider'} starting with the expected prefix.`; }
    input?.focus();
    return;
  }
  if (submit) { submit.disabled = true; submit.textContent = 'Verifying...'; }
  try {
    // Bring-your-own-key: verify straight from the browser and store the key
    // locally — no login, no backend. The authenticated vault is still used
    // when the user signed in instead of pasting a key, so both paths work.
    if (window.ClavisDirect?.setKey) {
      const check = await window.ClavisDirect.verify(provider, key);
      if (!check.ok) throw new Error(check.error || 'This key could not be verified.');
      window.ClavisDirect.setKey(provider, key);
      localStorage.setItem(`skylark_${provider}_key`, key);
      localStorage.setItem(`skylark_custom_${provider}`, key);
      if (provider === 'groq') {
        localStorage.setItem('skylark-llm-key', key);
        localStorage.setItem('skylark-llm-engine', 'groq');
      }
      if (window.JarvisEngine?.addProviderKey) {
        window.JarvisEngine.addProviderKey(provider, key);
      }
      localStorage.setItem('clavis_ai_provider', provider);
      if (input) input.value = '';
      closeClavisCredentialDialog();
      document.getElementById('clavis-brain-card')?.remove();
      renderClavisBrainState();
      setJarvisStatus('online', 'Clavis Ready');
      showToast('success', 'Clavis connected', check.warn ? 'Key saved. Try your message.' : 'Your AI key was verified. Try your message again.');
    } else if (window.NexusAIChat?.saveCredential) {
      await window.NexusAIChat.saveCredential(provider, key);
      localStorage.setItem(`skylark_${provider}_key`, key);
      localStorage.setItem(`skylark_custom_${provider}`, key);
      localStorage.setItem('clavis_ai_provider', provider);
      if (input) input.value = '';
      closeClavisCredentialDialog();
      document.getElementById('clavis-brain-card')?.remove();
      renderClavisBrainState();
      setJarvisStatus('online', 'Clavis Ready');
      showToast('success', 'Clavis connected', 'Your AI key was verified and stored securely. Try your message again.');
    } else {
      throw new Error('No way to save this key: neither the local brain nor the backend vault is available.');
    }
  } catch (err) {
    if (error) { error.hidden = false; error.textContent = err.message || 'This key could not be verified.'; }
  } finally {
    if (submit) { submit.disabled = false; submit.textContent = 'Connect & verify'; }
  }
}
window.openClavisCredentialDialog = openClavisCredentialDialog;
window.closeClavisCredentialDialog = closeClavisCredentialDialog;
window.toggleClavisCredentialVisibility = toggleClavisCredentialVisibility;
window.pasteClavisCredential = pasteClavisCredential;
window.updateClavisProviderHelp = updateClavisProviderHelp;
window.saveClavisCredential = saveClavisCredential;

// ── Voice-first presenter ─────────────────────────────────────────
// Clavis answers out loud. The floating window opens only when there is
// something worth reading or seeing: a list/table/draft/research answer,
// an attachment, a task pipeline, or when speech is off. Small talk and
// quick answers stay in the voice and never flash the window.
// Only requests whose answer is genuinely worth READING. A bare "dikhao" /
// "show" / "detail" used to open it too — so "map dikhao" flashed both the
// map and the window. Places, pictures and websites belong to the display.
const CLAVIS_SHOW_RE = /\b(list|table|compare|comparison|research|report|summar\w*|draft|write|plan|step by step|steps|code|script|export|breakdown|analy[sz]\w*|document|pdf|itinerary|schedule|chart|graph)\b|\blikh(o|do|kar|iye)\b|\b(email|mail|letter|application)\s+(likh\w*|draft|banao|bana do|write)/i;
const CLAVIS_DISPLAY_RE = /\b(map|maps|naksha|photo|photos|foto|image|images|tasveer\w*|picture|pictures|pics?|website|site|nearby|location|kahan\s+hai|where\s+is)\b/i;
function clavisSetDisplay(taskId, mode) {
  const t = taskId && window.ClavisTask?.Store?.get?.(taskId);
  if (t) t.display = mode;
}
function clavisDisplayOf(taskId) {
  return (taskId && window.ClavisTask?.Store?.get?.(taskId)?.display) || 'auto';
}
function clavisWantsWindow(text, ctx = {}) {
  if (!jarvisSpeechEnabled) return true;        // nothing would be heard, so show it
  if (ctx.attachments || ctx.images) return true;
  const t = String(text || '');
  if (CLAVIS_DISPLAY_RE.test(t) && !CLAVIS_SHOW_RE.test(t)) return false;   // the display shows it
  return CLAVIS_SHOW_RE.test(t);
}
function clavisAnswerWantsWindow(reply) {
  const t = String(reply || '');
  if (t.length > 520) return true;
  if (/```|^\s*\|.*\|\s*$|^#{1,4}\s/m.test(t)) return true;
  if ((t.match(/^\s*([-*•]|\d+[.)])\s+/gm) || []).length >= 3) return true;
  return /https?:\/\//.test(t) && t.length > 220;   // a single link in a short answer stays spoken
}
function clavisReveal(taskId) {
  if (clavisDisplayOf(taskId) === 'window') window.ClavisTaskSurface?.show?.();
}
// When the answer is on screen, the voice says the gist — not the whole page.
function clavisSpokenSummary(text) {
  // Say the intro line, not the list/table itself — that is what the window is for.
  const intro = String(text || '').split(/\n\s*\n/).map((p) => p.trim())
    .find((p) => p && !/^([-*•]|\d+[.)]|#{1,4}\s|\|)/.test(p) && !/^```/.test(p));
  if (!intro && /^\s*([-*•]|\d+[.)]|\|)/m.test(String(text || ''))) return 'Sir, poori list screen par rakh di hai.';
  if (intro && intro !== String(text || '').trim()) text = intro;
  const plain = String(text || '').replace(/```[\s\S]*?```/g, ' ').replace(/^\s*\|.*$/gm, ' ')
    .replace(/[#*_`>]/g, '').replace(/https?:\/\/\S+/g, '').replace(/\s+/g, ' ').trim();
  const parts = plain.match(/[^.!?।]+[.!?।]+/g) || [plain];
  let out = '';
  for (const s of parts) { if (out && (out + s).length > 240) break; out += s; }
  return (out || plain.slice(0, 220)).trim();
}
const CLAVIS_EMOJI_RE = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}]/gu;

async function handleJarvisSend(options) {
  const input = document.getElementById('jarvis-input');
  // Voice transcripts use this same composer, so keep their origin explicit.
  // Otherwise a spoken answer is promoted into the text task window.
  const requestSource = options && typeof options === 'object' && options.source === 'voice'
    ? 'voice'
    : 'composer';
  let text = (options && typeof options === 'string' ? options : (options && options.text) || input?.value || '').trim();
  
  // Attachments snapshot
  const rawAtts = (options && options.attachments) || window.clavisComposerAttachments || [];
  const attachments = Array.isArray(rawAtts) ? rawAtts.slice() : [];
  const images = (options && options.images) || attachments.map(a => a.dataUrl || a.url).filter(Boolean);

  if (!text && !attachments.length && !images.length) return;

  if (window.ClavisCognition && text && !window.ClavisCognition.admitTurn(text)) return;

  // The user engaged, so proactive nudges are clearly welcome — clear backoff.
  window.ClavisProactive?.acknowledge?.();

  // If only screenshot(s) were attached without text prompt
  if (!text && (attachments.length || images.length)) {
    text = 'Please inspect the attached screenshot(s) and provide a detailed analysis, key data points, and recommended actions.';
  }

  // Clear composer state immediately — unless this turn came by voice and
  // the composer holds a separate draft he is still typing.
  if (input && (requestSource !== 'voice' || !input.value.trim() || input.value.trim() === text)) {
    input.value = '';
    autoGrowJarvisInput();
  }
  clearClavisScreenshots();

  window.__clavisLastUserText = text;   // the voice's mood follows his (ClavisVoice)
  try { window.ClavisIntent?.learn?.(text); } catch (_) {}

  // ── The few words he says most: "map band karo", "close everything",
  //    "band karo", "zoom in", "ladke ki awaaz me bolo" — instant and local,
  //    before the STOP rule (which used to swallow "map band karo") and the AI.
  if (!attachments.length && !images.length) {
    try {
      const quick = await window.ClavisIntent?.route?.(text, { source: requestSource });
      if (quick && quick.handled) {
        if (quick.spoken) {
          window.ClavisMind?.noteClavisTurn?.(quick.spoken);
          if (jarvisSpeechEnabled && !quick.silent) speakJarvisText(quick.spoken);
          else setJarvisStatus('online', 'Clavis Online');
        } else {
          setJarvisStatus('online', 'Clavis Online');
        }
        if (jarvisHandsFree) scheduleHandsFreeRelisten();
        return;
      }
    } catch (e) { console.warn('Clavis intent route failed:', e); }
  }

  // ── "Shut up" / "chup" — silence Clavis instantly, don't echo or call AI. ──
  if (window.ClavisCommands?.isStop?.(text) && text.trim().split(/\s+/).length <= 4) {
    stopJarvisGeneration();
    window.ClavisLive?.hush?.();
    window.LocalSpeechEngine?.stopInput?.();
    isJarvisSpeaking = false;
    if (currentPlayingAudio) { try { currentPlayingAudio.pause(); } catch (_) {} currentPlayingAudio = null; }
    window.ClavisBargeIn?.disarm?.();
    window.ClavisMind?.noteSpeakingStopped?.(); window.ClavisEar?.noteSpeakingDone?.();
    window.ClavisProactive?.snooze?.(30);
    window.ClavisMind?.social?.suppress?.(30 * 60000);
    setJarvisStatus('online', 'Chup — bolo jab chahiye');
    if (jarvisHandsFree) scheduleHandsFreeRelisten();
    return;
  }

  // Feed the cognitive core
  window.ClavisMind?.noteUserTurn?.(text);

  // The window is not opened here any more: clavisReveal() opens it only
  // when this turn turns out to have something worth showing.
  const taskId = window.ClavisTask ? window.ClavisTask.begin(text, {
    source: requestSource,
    attachments: attachments,
    images: images,
    onCancel: () => stopJarvisGeneration()
  }) : null;
  clavisSetDisplay(taskId, clavisWantsWindow(text, { attachments: attachments.length, images: images.length }) ? 'window' : 'voice');
  clavisReveal(taskId);

  if (taskId && window.ClavisTask) {
    if (images.length) {
      window.ClavisTask.toolStart(taskId, 'image', `Analyzing ${images.length} screenshot(s)`);
    } else {
      window.ClavisTask.event(taskId, { type: 'thinking', label: 'Analyzing request' });
    }
  }

  // ── Device commands (screenshot, read screen, open app, save note...) ──
  try {
    const cmd = await window.ClavisCommands?.route(text);
    if (cmd && cmd.handled) {
      // `text` (screen) and `spoken` (voice) may differ on purpose — e.g. a
      // website brief shows a tidy summary and SAYS a deeper take on it.
      const replyContent = cmd.text || cmd.spoken || cmd.bubbleHtml?.replace(/<[^>]+>/g, '') || 'Command completed successfully.';
      if (cmd.display === 'window' || cmd.text || /<img|<table/i.test(cmd.bubbleHtml || '') || !cmd.spoken) clavisSetDisplay(taskId, 'window');
      if (taskId && window.ClavisTask) {
        window.ClavisTask.complete(taskId, {
          type: 'answer',
          text: replyContent,
          summary: (cmd.summary || cmd.spoken || 'Command executed').slice(0, 160)
        });
      }
      clavisReveal(taskId);

      if (cmd.spoken) {
        window.ClavisMind?.noteClavisTurn?.(cmd.spoken);
        if (jarvisSpeechEnabled && !cmd.silent) speakJarvisText(cmd.spoken);
        else setJarvisStatus('online', 'Clavis Online');
      } else {
        setJarvisStatus('online', 'Clavis Online');
      }
      if (jarvisHandsFree) scheduleHandsFreeRelisten();
      return;
    }
  } catch (e) { console.warn('Clavis command route failed:', e); }

  // ── Lead / candidate searches go straight into the real pipeline ──
  // (deterministic plan, no LLM round trip, so no rate limit and no invented
  // rows). Its live progress is exactly what the window is for.
  try {
    const plan = window.LeadCandidateDomain?.parseRequest?.(text);
    if (plan?.isSearch && !images.length && !attachments.length && window.ChatEngine?.sendMessage
        && !/\b(export|download|sync|show|list|stats?)\b/i.test(text)) {
      clavisSetDisplay(taskId, 'window');
      clavisReveal(taskId);
      setJarvisStatus('thinking', 'Starting the lead search...');
      const resp = await window.ChatEngine.sendMessage(text);
      const line = String(resp?.text || '').replace(CLAVIS_EMOJI_RE, '').replace(/[*_#`]/g, '').trim();
      if (line) {
        window.ClavisMind?.noteClavisTurn?.(line);
        if (jarvisSpeechEnabled) speakJarvisText(clavisSpokenSummary(line));
      }
      if (jarvisHandsFree) scheduleHandsFreeRelisten();
      return;
    }
  } catch (e) { console.warn('Clavis lead fast-path failed, using the AI path:', e); }

  // Check AI brain availability
  if (window.JarvisEngine && !window.JarvisEngine.hasBrain()) {
    const offlineReply = window.JarvisEngine?.getOfflineResponse?.(text);
    if (offlineReply) {
      if (taskId && window.ClavisTask) {
        window.ClavisTask.complete(taskId, {
          type: 'answer',
          text: offlineReply,
          summary: 'Local Mode Response'
        });
      }
      clavisReveal(taskId);
      window.ClavisMind?.noteClavisTurn?.(offlineReply);
      setJarvisStatus('online', 'Clavis local mode');
      if (jarvisSpeechEnabled) speakJarvisText(offlineReply);
      if (jarvisHandsFree) scheduleHandsFreeRelisten();
      return;
    }

    const setupMsg = images.length > 0
      ? `Screenshot receive ho gaya hai! Poori vision reasoning aur text extraction ke liye ek **free AI key** (Groq ya OpenRouter) connect karein.`
      : `Main abhi poori tarah soch nahi sakta, ${escHtml((window.AuthSystem?.getProfile?.().firstName) || 'sir')} — smart replies aur reasoning ke liye ek **free AI key** (Groq ya OpenRouter) connect karein. Yeh 100% free hai aur sirf 10 second me connect ho jaati hai!`;

    if (taskId && window.ClavisTask) {
      window.ClavisTask.complete(taskId, {
        type: 'answer',
        text: setupMsg,
        summary: 'AI Setup Required'
      }, [
        { id: 'connect', label: '🔑 Connect Free Key (10s)', primary: true, run: () => openKeySettings() }
      ]);
    }
    renderClavisBrainState();
    setJarvisStatus('offline', 'Needs setup');
    // The inline brain card already explains the one missing action. Opening
    // a second modal here caused repeated popups and made voice turns look
    // like failed floating replies. Give voice-enabled users a spoken,
    // concise explanation instead.
    if (jarvisSpeechEnabled) speakJarvisText(setupMsg);
    if (jarvisHandsFree) scheduleHandsFreeRelisten();
    return;
  }

  showJarvisTyping();
  setJarvisStatus('thinking', 'Clavis is processing...');

  const stopBtn = document.getElementById('jarvis-stop-btn');
  const sendBtn = document.getElementById('jarvis-send-btn');
  if (stopBtn) stopBtn.style.display = 'flex';
  if (sendBtn) sendBtn.style.display = 'none';

  jarvisController = new AbortController();

  const onStep = (step) => {
    if (taskId && window.ClavisTask) {
      if (step.type === 'tool_start') {
        window.ClavisTask.toolStart(taskId, step.skill || 'tool', step.detail || '');
      } else if (step.type === 'tool_result') {
        window.ClavisTask.toolResult(taskId, step.skill || 'tool', step.outcome);
      }
    }
  };

  let voiceStream = null;
  let voiceStreamFailed = false;
  const onTextDelta = async (delta) => {
    if (window.ClavisLive?.isActive?.()) return;
    if (clavisDisplayOf(taskId) === 'window') return;   // on screen -> spoken summary at the end
    if (!jarvisSpeechEnabled || voiceStreamFailed || !window.LocalSpeechEngine) return;
    try {
      if (!voiceStream) {
        isJarvisSpeaking = true;
        setJarvisStatus('speaking', 'Clavis is preparing a reply...');
        voiceStream = window.LocalSpeechEngine.beginSpeech({});
        await voiceStream;
        window.ClavisBargeIn?.arm?.(handleClavisBargeIn).catch?.(() => {});
      }
      await window.LocalSpeechEngine.pushText(delta);
    } catch (error) {
      voiceStreamFailed = true;
      voiceStream = null;
      window.LocalSpeechEngine.stop();
      isJarvisSpeaking = false;
      console.warn('[Clavis streaming voice]', error);
    }
  };

  try {
    const response = await window.JarvisEngine.sendMessage(text, jarvisController.signal, onStep, onTextDelta, {
      images: images,
      attachments: attachments
    });
    hideJarvisTyping();
    if (response) {
      if (clavisDisplayOf(taskId) !== 'window' && (clavisAnswerWantsWindow(response.text) || (response.toolsRun || []).some((t) => !/^(search_web|remember_fact|get_lead_stats|get_candidate_stats|navigate_to_page|pc_|show_)/.test(t.skill || '')))) {
        clavisSetDisplay(taskId, 'window');
      }
      if (taskId && window.ClavisTask) {
        window.ClavisTask.complete(taskId, {
          type: 'answer',
          text: response.text,
          summary: response.text.slice(0, 120).replace(/\n/g, ' ') + (response.text.length > 120 ? '...' : '')
        });
      }
      clavisReveal(taskId);
      const onScreen = clavisDisplayOf(taskId) === 'window';

      window.ClavisMind?.noteClavisTurn?.(response.text);
      refreshJarvisSidePanels();

      if (jarvisSpeechEnabled && voiceStream && !voiceStreamFailed) {
        await window.LocalSpeechEngine.finishSpeech();
        isJarvisSpeaking = false;
        window.ClavisMind?.noteSpeakingStopped?.(); window.ClavisEar?.noteSpeakingDone?.();
        window.ClavisBargeIn?.disarm?.();
        setJarvisStatus('listening', 'Sun raha hoon — bolo "Clavis"');
      } else if (jarvisSpeechEnabled) {
        speakJarvisText(onScreen ? clavisSpokenSummary(response.text) : response.text);
      } else {
        setJarvisStatus('listening', 'Sun raha hoon — bolo "Clavis"');
      }
      if (jarvisHandsFree) scheduleHandsFreeRelisten();
    }
  } catch (err) {
    hideJarvisTyping();
    setJarvisStatus('online', 'Clavis Online');
    if (err.name === 'AbortError' || err.code === 'AI_CANCELLED') {
      if (taskId && window.ClavisTask) {
        window.ClavisTask.fail(taskId, { message: 'Stopped by user', code: 'CANCELLED', cancelled: true });
      }
    } else {
      const code = err.code || '';
      const credentialIssue = code === 'AI_CREDENTIAL_MISSING' || code === 'AI_CREDENTIAL_INVALID' || err.status === 401 || err.status === 403;
      setJarvisStatus(credentialIssue ? 'offline' : 'error', credentialIssue ? 'Needs setup' : 'Unavailable');

      const busy = code === 'AI_BUSY' || err.status === 429 || /rate limit|per minute|try again in/i.test(err.message || '');
      if (taskId && window.ClavisTask) {
        window.ClavisTask.fail(taskId, busy ? { message: 'The free AI limit is refilling — ask again in a few seconds.', code: 'AI_BUSY' } : err);
      }
      clavisReveal(taskId);
      if (!credentialIssue && jarvisSpeechEnabled && clavisDisplayOf(taskId) !== 'window') {
        speakJarvisText(busy ? 'Ek pal, sir — AI thoda busy hai. Das second me phir se puchiye.' : 'Sorry sir, is baar jawab nahi aa paaya. Ek baar phir boliye?');
      }

      if (credentialIssue) {
        showToast({
          type: 'warning',
          title: 'Groq/OpenRouter Key Chahiye',
          message: 'Free API key se Clavis super-fast chalega.',
          action: { label: 'Connect Key', onClick: () => openKeySettings() }
        });
        setTimeout(() => { openKeySettings(); }, 900);
      } else {
        if (busy) showToast({ type: 'info', title: 'Clavis is catching its breath', message: 'The free AI limit refills every minute — try again in a few seconds.' });
        else showToast({ type: 'error', title: 'Clavis could not reply', message: err.message || 'Please try again.', errorCode: code });
      }
    }
  } finally {
    if (stopBtn) stopBtn.style.display = 'none';
    if (sendBtn) sendBtn.style.display = 'flex';
    jarvisController = null;
    if (jarvisHandsFree) scheduleHandsFreeRelisten();
  }
}

// Small inline "step" chips showing live tool execution inside the chat
function appendJarvisToolChip(label, state) {
  const container = document.getElementById('jarvis-messages');
  if (!container) return;
  const chip = document.createElement('div');
  chip.className = `jarvis-tool-step ${state}`;
  chip.innerHTML = `<span class="jarvis-tool-dot"></span>${escHtml(label)}`;
  container.appendChild(chip);
  scrollJarvisToBottom();
}

function updateLastToolChip(label, state) {
  const chips = document.querySelectorAll('#jarvis-messages .jarvis-tool-step.running');
  const last = chips[chips.length - 1];
  if (last) {
    last.className = `jarvis-tool-step ${state}`;
    last.innerHTML = `<span class="jarvis-tool-dot"></span>${escHtml(label)}`;
  }
}

function stopJarvisGeneration() {
  if (jarvisController) {
    jarvisController.abort();
    jarvisController = null;
  }
  jarvisVoiceSession++;
  jarvisVoiceStopRequested = true;
  clearTimeout(jarvisVoiceCommitTimer);
  try { jarvisRecognition?.stop(); } catch (_) {}
  jarvisRecognition = null;
  document.getElementById('jarvis-voice-btn')?.classList.remove('recording');
  window.stopJarvisSpeech?.();
  window.LocalSpeechEngine?.stopInput?.();
  isJarvisSpeaking = false;
  if (currentPlayingAudio) {
    try { currentPlayingAudio.pause(); } catch {}
    currentPlayingAudio = null;
  }
}

function sendQuickJarvis(text) {
  const input = document.getElementById('jarvis-input');
  if (input) {
    input.value = text;
    handleJarvisSend();
  }
}

function clearJarvisChat() {
  if (!confirm('Clear this conversation? Long-term memory facts will be kept.')) return;
  window.JarvisEngine?.clearAll();
  const container = document.getElementById('jarvis-messages');
  if (container) container.innerHTML = '';
  const welcome = document.getElementById('jarvis-welcome');
  if (welcome) welcome.style.display = 'flex';
}

// ── Voice input (push-to-talk, wake word, clap and snap) ───────
let jarvisVoiceFinalTranscript = '';
let jarvisVoiceCommitTimer = null;
let jarvisVoiceStopRequested = false;

let groqMediaRecorder = null;
let groqAudioChunks = [];
let isGroqRecording = false;

async function legacyStartGroqWhisperVoiceInput(options = {}) {
  const btn = document.getElementById('jarvis-composer-voice-btn') || document.getElementById('jarvis-voice-btn');
  const composerStatus = document.getElementById('jarvis-composer-status');

  // If already recording with Groq, tapping mic again immediately STOPS and transcribes!
  if (isGroqRecording && groqMediaRecorder) {
    if (groqMediaRecorder.state !== 'inactive') {
      groqMediaRecorder.stop();
    }
    return;
  }

  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }
    });
    groqAudioChunks = [];
    isGroqRecording = true;
    const groqStartedAt = Date.now();
    window.ClavisEar?.tap?.start?.('groq');
    window.ClavisEar?.caption?.listening(true);

    let mimeType = 'audio/webm;codecs=opus';
    if (!MediaRecorder.isTypeSupported(mimeType)) {
      mimeType = MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm' : (MediaRecorder.isTypeSupported('audio/mp4') ? 'audio/mp4' : '');
    }

    groqMediaRecorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);

    groqMediaRecorder.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) {
        groqAudioChunks.push(e.data);
      }
    };

    groqMediaRecorder.onstop = async () => {
      isGroqRecording = false;
      window.ClavisEar?.tap?.stop?.('groq');
      window.ClavisEar?.caption?.listening(false);
      btn?.classList.remove('recording');
      stream.getTracks().forEach(track => track.stop());

      if (!groqAudioChunks.length) {
        setJarvisStatus('online', 'Clavis Online');
        return;
      }

      const audioBlob = new Blob(groqAudioChunks, { type: groqMediaRecorder.mimeType || 'audio/webm' });
      if (audioBlob.size < 1000) {
        setJarvisStatus('online', 'Kuch boliyega...');
        return;
      }

      setJarvisStatus('thinking', 'Groq Whisper se samajh raha hoon...');
      if (composerStatus) composerStatus.textContent = '⚡ Groq Whisper transcribing...';

      try {
        const text = await window.ClavisDirect.transcribeWithGroq(audioBlob);
        if (composerStatus) composerStatus.textContent = '';
        if (text && text.trim()) {
          commitJarvisVoiceInput(text.trim(), {
            since: groqStartedAt, source: 'groq',
            requireWake: Boolean(options.handsFreeCapture && !options.awakeCapture && !options.soundTrigger && !jarvisAwake),
          });
        } else {
          setJarvisStatus('online', 'Kuch boliyega...');
        }
      } catch (err) {
        console.warn('Groq Whisper notice:', err);
        if (composerStatus) composerStatus.textContent = '';
        setJarvisStatus('online', 'Clavis Online');
        // Fallback to browser recognition
        legacyStartNativeSpeechRecognition(options);
      }
    };

    btn?.classList.add('recording');
    setJarvisStatus(options.handsFreeCapture ? 'awake' : 'listening', 'Bolte rahiye... (Tap to send)');
    if (composerStatus) composerStatus.textContent = '⚡ Groq Whisper listening...';
    groqMediaRecorder.start(200);

    // Auto-stop safety after 20s
    setTimeout(() => {
      if (isGroqRecording && groqMediaRecorder && groqMediaRecorder.state !== 'inactive') {
        groqMediaRecorder.stop();
      }
    }, 20000);

  } catch (err) {
    console.warn('Microphone permission error or MediaRecorder unsupported:', err);
    isGroqRecording = false;
    btn?.classList.remove('recording');
    legacyStartNativeSpeechRecognition(options);
  }
}

function startJarvisVoiceInput(options = {}) {
  window._clavisLastInputSource = 'voice';

  // Clavis Live (Gemini Live API) owns voice whenever a Google AI Studio key
  // is connected. Background wake listening (handsFreeCapture without a wake)
  // stays on the cheap legacy recognizer so an always-open Live session
  // doesn't burn quota; the moment sir wakes Clavis, Live takes over.
  const live = window.ClavisLive;
  if (live && !options.forceLegacy) {
    if (live.isActive()) {
      if (!options.handsFreeCapture && !options.soundTrigger) live.stop({ reason: 'user' });
      return;
    }
    const woke = !options.handsFreeCapture || options.awakeCapture || options.soundTrigger;
    if (woke && live.isAvailable()) {
      const trigger = options.soundTrigger ? 'clap' : options.awakeCapture ? 'wake word' : 'button';
      live.start({ trigger, initialText: options.initialText || '' }).then((ok) => { if (!ok) startJarvisVoiceInput({ ...options, forceLegacy: true }); });
      return;
    }
    if (!options.handsFreeCapture && !options.soundTrigger) live.promptKey?.();
  }

  // Tier 1: If backend LocalSpeechEngine is running and has active input socket, use it
  if (window.startLocalJarvisVoiceInput && window.LocalSpeechEngine?.inputSocket) {
    const localOptions = { ...options, persistent: Boolean(options.persistent) };
    localOptions.onFinal = (rawText) => {
      const text = String(rawText || '').trim();
      if (!text) return;
      if (options.handsFreeCapture && !options.awakeCapture) {
        const wake = clavisWakeMatch(text);
        if (!wake) return;
        if (!wake.remainder) {
          jarvisAwake = true;
          window.LocalSpeechEngine.stopInput();
          setJarvisStatus('awake', 'Haan sir, boliye...');
          setTimeout(() => startJarvisVoiceInput({ handsFreeCapture: true, awakeCapture: true, persistent: true }), 120);
          return;
        }
        commitJarvisVoiceInput(wake.remainder);
        return;
      }
      commitJarvisVoiceInput(text);
    };
    window.startLocalJarvisVoiceInput(localOptions);
    return;
  }

  // Tier 2: Groq Whisper STT (Superfast ~300ms, accurate Hindi/English)
  if (window.ClavisDirect?.keyFor?.('groq')) {
    legacyStartGroqWhisperVoiceInput(options);
    return;
  }

  // Tier 3: Native Browser SpeechRecognition (works 100% locally offline)
  legacyStartNativeSpeechRecognition(options);
}

function legacyStartNativeSpeechRecognition(options = {}) {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) {
    const unsupportedStatus = document.getElementById('jarvis-composer-status');
    if (unsupportedStatus) unsupportedStatus.textContent = 'Voice input is not supported here.';
    showToast('error', 'Not Supported', 'Voice input isn\'t supported in this browser. Try Chrome.');
    return;
  }
  const btn = document.getElementById('jarvis-composer-voice-btn') || document.getElementById('jarvis-voice-btn');
  const composerStatus = document.getElementById('jarvis-composer-status');
  if (composerStatus) composerStatus.textContent = '';
  if (jarvisRecognition) {
    jarvisVoiceStopRequested = true;
    clearTimeout(jarvisVoiceCommitTimer);
    jarvisRecognition.stop();
    jarvisRecognition = null;
    btn?.classList.remove('recording');
    return;
  }

  const session = ++jarvisVoiceSession;
  const recognition = new SpeechRecognition();
  recognition.lang = localStorage.getItem('clavis_voice_language')
    || localStorage.getItem('jarvis_voice_lang')
    || 'hi-IN';
  recognition.interimResults = true;
  recognition.continuous = true;
  jarvisRecognition = recognition;
  const initialText = String(options.initialText || '').trim();
  let hasFinalSpeech = false;
  let utterStartAt = 0;
  const commitMeta = () => ({
    since: utterStartAt || Date.now() - 6000, source: 'native', openMic: Boolean(options.followUp),
    requireWake: Boolean(options.handsFreeCapture && !options.awakeCapture && !options.soundTrigger && !jarvisAwake),
  });
  jarvisVoiceFinalTranscript = initialText;
  jarvisVoiceStopRequested = false;

  btn?.classList.add('recording');
  setJarvisStatus(options.handsFreeCapture ? 'awake' : 'listening', options.handsFreeCapture ? 'Haan sir, boliye...' : 'Sun raha hoon...');
  if (window.ClavisEar?.voiceId?.enabled?.()) window.ClavisEar.tap.start('native');
  window.ClavisEar?.caption?.listening(true);
  recognition.onresult = (e) => {
    if (session !== jarvisVoiceSession) return;
    let finalText = jarvisVoiceFinalTranscript;
    let interimText = '';
    for (let i = e.resultIndex || 0; i < e.results.length; i++) {
      const result = e.results[i];
      if (!result?.[0]) continue;
      if (result.isFinal) {
        hasFinalSpeech = true;
        finalText += ` ${result[0].transcript.trim()}`;
      }
      else interimText += `${result[0].transcript.trim()} `;
    }
    if (finalText.trim()) jarvisVoiceFinalTranscript = finalText.trim();
    const transcript = `${jarvisVoiceFinalTranscript} ${interimText}`.trim();
    if (!utterStartAt && transcript) utterStartAt = Date.now() - 700;
    // His words preview in the Siri-style caption (top right), never in the
    // composer: the composer stays his, and Clavis's own voice can't land there.
    clavisShowVoicePreview(transcript);
    clearTimeout(jarvisVoiceCommitTimer);
    if (/\b(go for it|that's it|thats it|backseat|done|over)\.?\s*$/i.test(transcript)) {
      commitJarvisVoiceInput(transcript, commitMeta());
    } else if (hasFinalSpeech) {
      const pauseMs = options.handsFreeCapture ? 1500 : 1300;
      jarvisVoiceCommitTimer = setTimeout(() => commitJarvisVoiceInput(jarvisVoiceFinalTranscript, commitMeta()), pauseMs);
    }
  };
  recognition.onerror = (event) => {
    if (session !== jarvisVoiceSession) return;
    if (['aborted', 'no-speech'].includes(event.error)) return;
    if (event.error === 'network') {
      // Chrome's SpeechRecognition service can briefly lose its network while
      // the microphone is still healthy. onend() already restarts it; do not
      // turn this transient condition into a repeated red notification.
      if (composerStatus) composerStatus.textContent = options.handsFreeCapture
        ? 'Wake word reconnecting…'
        : 'Voice service reconnecting…';
      jarvisVoiceStopRequested = false;
      clearTimeout(jarvisVoiceCommitTimer);
      return;
    }
    const reason = event.error || 'unknown browser voice error';
    clearTimeout(jarvisVoiceCommitTimer);
    jarvisVoiceStopRequested = true;
    btn?.classList.remove('recording');
    jarvisRecognition = null;
    if (composerStatus) composerStatus.textContent = event.error === 'not-allowed'
      ? 'Microphone blocked — allow it in browser settings, then retry.'
      : `Voice input stopped (${reason}) — try again.`;
    showToast('error', 'Voice input error', event.error === 'not-allowed'
      ? 'Microphone permission is blocked. Allow it in the browser address bar.'
      : `Browser voice recognition reported “${reason}”. Check the microphone and try again.`);
  };
  recognition.onend = () => {
    if (session !== jarvisVoiceSession) return;
    if (jarvisRecognition === recognition) jarvisRecognition = null;
    btn?.classList.remove('recording');
    if (jarvisVoiceStopRequested) { window.ClavisEar?.tap?.stop?.('native'); window.ClavisEar?.caption?.listening(false); return; }
    if (hasFinalSpeech && jarvisVoiceFinalTranscript.trim()) {
      clearTimeout(jarvisVoiceCommitTimer);
      // Chrome may end its service during a perfectly valid pause. Give the
      // user the same pause window instead of submitting half a sentence.
      jarvisVoiceCommitTimer = setTimeout(() => commitJarvisVoiceInput(jarvisVoiceFinalTranscript, commitMeta()), options.handsFreeCapture ? 1500 : 1300);
    } else {
      window.setTimeout(() => {
        if (session !== jarvisVoiceSession || jarvisVoiceStopRequested || jarvisRecognition) return;
        try { recognition.start(); jarvisRecognition = recognition; btn?.classList.add('recording'); } catch (_) {}
      }, 180);
    }
  };
  try { recognition.start(); } catch (error) {
    jarvisRecognition = null;
    btn?.classList.remove('recording');
    if (composerStatus) composerStatus.textContent = 'Microphone could not start — try again.';
    showToast('error', 'Voice input error', 'Microphone could not start. Please try again.');
  }
}

// Live preview of what sir is saying. The caption owns it; the composer is
// only a fallback for a build without clavis-ear.js.
function clavisShowVoicePreview(text) {
  if (!text) return;
  if (window.ClavisEar?.caption) { window.ClavisEar.caption.live(text); return; }
  const input = document.getElementById('jarvis-input');
  if (input) { input.value = text; input.dispatchEvent(new Event('input')); }
}

// Stop Clavis mid-sentence because sir spoke over it. Capture is NOT
// restarted here — callers that already hold his words just use them.
function interruptClavisSpeech() {
  if (!isJarvisSpeaking && !window.ClavisEar?.isSpeaking?.()) return false;
  try { jarvisController?.abort('barge-in'); } catch (_) {}
  jarvisController = null;
  stopJarvisSpeech();
  isJarvisSpeaking = false;
  window.ClavisBargeIn?.disarm?.();
  window.ClavisMind?.noteInterrupted?.();
  window.ClavisEar?.noteSpeakingDone?.();
  setJarvisStatus('interrupted', 'Aap boliye...');
  return true;
}
window.interruptClavisSpeech = interruptClavisSpeech;

function commitJarvisVoiceInput(transcript, meta = {}) {
  const input = document.getElementById('jarvis-input');
  let finalText = clavisCommitCommand(String(transcript || '').trim());
  clearTimeout(jarvisVoiceCommitTimer);
  if (!finalText) return;
  if (meta && meta.requireWake) {
    const wake = clavisWakeMatch(finalText);
    if (!wake) { window.ClavisEar?.caption?.final(finalText, false); jarvisVoiceFinalTranscript = ''; return; }
    finalText = wake.remainder;
    if (!finalText) {
      jarvisAwake = true;
      playWakeChime();
      setJarvisStatus('awake', 'Haan sir, boliye...');
      window.ClavisEar?.caption?.listening(true);
      return;
    }
  }
  // One gate for every recognizer: Clavis's own voice (echo), background
  // chatter in open-mic moments, and — once enrolled — voices that aren't his.
  const verdict = window.ClavisEar?.judge?.(finalText, meta || {}) || { accept: true };
  if (!verdict.accept) {
    console.info('[ClavisEar] ignored (' + verdict.reason + '):', finalText);
    window.ClavisEar?.caption?.final(finalText, false);
    jarvisVoiceFinalTranscript = '';
    return;
  }
  if (verdict.barge) interruptClavisSpeech();
  window.ClavisEar?.tap?.stop?.('native');
  window.ClavisEar?.caption?.final(finalText, true);
  // "Clavis, get me leads..." in one breath: hand the command straight to Live.
  if (window.ClavisLive?.isAvailable?.() && !window.ClavisLive.isActive()) {
    jarvisVoiceFinalTranscript = '';
    jarvisVoiceSession++;
    window.LocalSpeechEngine?.stopInput?.();
    try { jarvisRecognition?.stop(); } catch {}
    jarvisRecognition = null;
    window.ClavisLive.start({ trigger: 'wake word', initialText: finalText });
    return;
  }
  if (!window.ClavisEar && input) {
    input.value = finalText;
    input.dispatchEvent(new Event('input'));
  }
  jarvisVoiceFinalTranscript = '';
  jarvisVoiceStopRequested = true;
  jarvisVoiceSession++;
  window.LocalSpeechEngine?.stopInput?.();
  try { jarvisRecognition?.stop(); } catch {}
  jarvisRecognition = null;
  document.getElementById('jarvis-voice-btn')?.classList.remove('recording');
  handleJarvisSend({ source: 'voice', text: finalText });
}

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
//  HANDS-FREE MODE — configurable "Clavis" wake word + continuous conversation
//  Works like "Hey Google": a background recognizer keeps listening;
//  when it hears "Jarvis", Jarvis wakes, chimes, and captures the
//  next command. Barge-in supported: speaking cancels current TTS.
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
let wakeResultIndex = -1;
let clavisFinalTranscript = '';
let clavisCaptureStartAt = 0;     // when the current spoken command began (voice ID scores from here)
let clavisFollowUpUntil = 0;      // open-mic window after a reply: no wake word needed
let clavisFollowUpTimer = null;

function getClavisWakeWords() {
  try {
    const saved = JSON.parse(localStorage.getItem('clavis_wake_words') || 'null');
    if (Array.isArray(saved) && saved.length) return saved.map(String).map(s => s.trim().toLowerCase()).filter(Boolean).slice(0, 8);
  } catch (_) {}
  return ['clavis', 'hey clavis', 'hey buddy', 'hi pal'];
}

function clavisWakeMatch(text) {
  const normalized = String(text || '').toLowerCase()
    // How recognizers actually spell "Clavis" out loud.
    .replace(/क्ल[ेैा]विस|क्लेविज़|klavis|clevis|klevis|clavish|claves|clavice|clavis/g, 'clavis')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim();
  const phrase = getClavisWakeWords().sort((a, b) => b.length - a.length).find(word => normalized.includes(word));
  return phrase ? { phrase, remainder: normalized.slice(normalized.indexOf(phrase) + phrase.length).trim() } : null;
}

function clavisCommitCommand(text) {
  return String(text || '').replace(/\b(go for it|that's it|thats it|backseat|done|over)\.?\s*$/i, '').trim();
}

function initClavisSoundTriggers() {
  if (clavisSoundTriggerBound || !window.ClavisAudioTrigger) return;
  clavisSoundTriggerBound = true;
  window.ClavisAudioTrigger.addEventListener('trigger', (event) => {
    const kind = event.detail?.kind === 'snap' ? 'Snap' : 'Clap';
    if (window.ClavisCognition && !window.ClavisCognition.admitSignal(kind.toLowerCase(), event.detail?.confidence)) return;
    const detectorStopped = stopClavisSoundTriggers();
    if (currentPlayingAudio) { try { currentPlayingAudio.pause(); } catch (_) {} currentPlayingAudio = null; }
    window.ClavisBargeIn?.disarm?.();
    window.ClavisMind?.noteInterrupted?.();
    isJarvisSpeaking = false;
    stopWakeListener(true);
    jarvisAwake = true;
    clavisFinalTranscript = '';
    playWakeChime();
    setJarvisStatus('awake', `${kind} detected — boliye...`);
    Promise.resolve(detectorStopped).finally(() => {
      window.setTimeout(() => startJarvisVoiceInput({ soundTrigger: true, handsFreeCapture: true, awakeCapture: true, persistent: true }), 120);
    });
  });
  window.ClavisAudioTrigger.addEventListener('error', (event) => {
    const code = event.detail?.code;
    // Only a toggle the user just pressed deserves a toast; at boot the mic
    // pill already says "Mic setup needed" and is clickable.
    if (Date.now() - (window._clavisSoundToggleAt || 0) > 5000) { updateClavisSoundTriggerButton(false); return; }
    if (code === 'SOUND_TRIGGER_MIC_BLOCKED') {
      showToast({ type: 'warning', title: 'Sound triggers need microphone access', message: 'Allow the microphone in your browser, then enable Clap / Snap again.', errorCode: code });
    } else if (code === 'SOUND_TRIGGER_INSECURE_ORIGIN') {
      showToast({ type: 'warning', title: 'Open Clavis in browser mode', message: 'Clap / Snap needs http://localhost:3000; file:// pages cannot keep microphone access.', errorCode: code });
    } else if (code) {
      showToast({ type: 'warning', title: 'Sound triggers unavailable', message: 'Wake word and Tap & Talk are still available.', errorCode: code });
    }
    updateClavisSoundTriggerButton(false);
  });
  updateClavisSoundTriggerButton(localStorage.getItem('clavis_sound_trigger_enabled') !== 'false');
}

function updateClavisSoundTriggerButton(enabled) {
  const button = document.getElementById('jarvis-sound-trigger-btn');
  if (!button) return;
  button.classList.toggle('active', Boolean(enabled));
  button.setAttribute('aria-pressed', String(Boolean(enabled)));
  button.title = enabled ? 'Clap and snap activation is on' : 'Enable clap and snap activation';
}

async function startClavisSoundTriggers() {
  if (!window.ClavisAudioTrigger || isJarvisSpeaking) return false;
  initClavisSoundTriggers();
  const started = await window.ClavisAudioTrigger.start({ clap: true, snap: true });
  if (started) updateClavisSoundTriggerButton(true);
  return started;
}

function stopClavisSoundTriggers() {
  try { return window.ClavisAudioTrigger?.stop?.(); } catch (_) { return null; }
}

async function toggleClavisSoundTriggers() {
  window._clavisSoundToggleAt = Date.now();
  const isRunning = window.ClavisAudioTrigger?.running;
  if (isRunning) {
    localStorage.setItem('clavis_sound_trigger_enabled', 'false');
    stopClavisSoundTriggers();
    updateClavisSoundTriggerButton(false);
    showToast('info', 'Sound triggers off', 'Wake word and Tap & Talk remain available.');
    return;
  }
  localStorage.setItem('clavis_sound_trigger_enabled', 'true');
  const started = await startClavisSoundTriggers();
  if (started) showToast('success', 'Clap / Snap on', 'Clavis will activate immediately on a clap or snap.');
  else localStorage.setItem('clavis_sound_trigger_enabled', 'false');
}

function toggleJarvisHandsFree() {
  jarvisHandsFree = !jarvisHandsFree;
  localStorage.setItem('jarvis_hands_free', String(jarvisHandsFree));
  const btn = document.getElementById('jarvis-handsfree-btn');
  if (btn) {
    btn.classList.toggle('active', jarvisHandsFree);
    btn.setAttribute('aria-pressed', String(jarvisHandsFree));
  }
  const settingsToggle = document.getElementById('hands-free-toggle');
  if (settingsToggle) settingsToggle.checked = jarvisHandsFree;
  if (jarvisHandsFree) {
    if (!jarvisSpeechEnabled) {
      jarvisSpeechEnabled = true;
      localStorage.setItem('jarvis_speech_enabled', 'true');
      updateJarvisSpeechIcon();
    }
    if (localStorage.getItem('clavis_mic_permission_granted') !== 'true') {
      requestClavisMicrophoneOnce().then((granted) => {
        if (!granted) {
          jarvisHandsFree = false;
          localStorage.setItem('jarvis_hands_free', 'false');
          btn?.classList.remove('active');
          setJarvisStatus('unavailable', 'Microphone permission required');
          return;
        }
        startWakeListener();
        startClavisSoundTriggers();
      });
      setJarvisStatus('listening', 'Microphone permission required');
      return;
    }
    startWakeListener();
    localStorage.setItem('clavis_sound_trigger_enabled', localStorage.getItem('clavis_sound_trigger_enabled') || 'true');
    startClavisSoundTriggers();
    setJarvisStatus('listening', 'Sun raha hoon — bolo "Clavis"');
    appendJarvisBubble('assistant', `<p>Hands-free on hai, sir. ðŸŽ™ï¸ Bas <b>"Clavis"</b>, "Hey buddy" ya saved wake phrase boliye — main sun lunga.</p>`);
    showToast('success', 'Hands-Free On', 'Bolo "Clavis" — main sun raha hoon.');
  } else {
    stopWakeListener();
    stopClavisSoundTriggers();
    window.LocalSpeechEngine?.stopInput?.();
    isJarvisSpeaking = false;
    if (currentPlayingAudio) {
      currentPlayingAudio.pause();
      currentPlayingAudio = null;
    }
    setJarvisStatus('online', 'Clavis Online');
    showToast('info', 'Hands-Free Off', '');
  }
}

function setJarvisStatus(state, label) {
  // Keep the canvas renderer and DOM status pill on the same state machine.
  window.currentJarvisStatus = state;
  window.isJarvisSpeaking = isJarvisSpeaking;
  const txt = document.getElementById('jarvis-status-text');
  const pill = document.querySelector('.jarvis-status-pill');
  const micStatus = document.getElementById('clavis-mic-live-status');
  const micLabel = document.getElementById('clavis-mic-live-label');
  const micGranted = localStorage.getItem('clavis_mic_permission_granted') === 'true';
  if (micStatus && micLabel) {
    const listening = state === 'listening' || state === 'awake';
    micLabel.textContent = !micGranted ? 'Mic setup needed' : listening ? 'Mic listening' : 'Mic ready';
    micStatus.dataset.state = !micGranted ? 'needed' : listening ? 'listening' : 'ready';
    micStatus.title = !micGranted ? 'Tap the microphone once to grant access' : listening ? 'Clavis is listening locally' : 'Microphone permission is ready';
  }
  if (txt) {
    let shortLabel = 'Online';
    if (state === 'listening') shortLabel = 'Listening';
    else if (state === 'awake') shortLabel = 'Awake';
    else if (state === 'speaking') shortLabel = 'Speaking';
    else if (state === 'thinking') shortLabel = 'Thinking';
    else if (state === 'unavailable') shortLabel = 'Unavailable';
    else if (state === 'interrupted') shortLabel = 'Interrupted';
    else shortLabel = (label && label.length <= 15) ? label : 'Online';
    txt.textContent = shortLabel;
  }
  const voiceCaption = document.getElementById('clavis-voice-caption');
  if (voiceCaption) voiceCaption.textContent = state === 'speaking' ? 'Clavis is speaking...' : label;
  if (pill) {
    pill.classList.remove('listening', 'awake', 'thinking');
    if (state !== 'online') pill.classList.add(state);
  }

  // Update Futuristic Voice HUD
  const hud = document.getElementById('jarvis-hud');
  const subText = document.getElementById('jarvis-subtitle-text');
  const subLabel = document.getElementById('jarvis-subtitle-label');
  
  if (hud) {
    hud.className = `jarvis-hud-container ${state}`;
  }
  if (subLabel) {
    if (state === 'listening') subLabel.textContent = 'STATUS';
    else if (state === 'awake') subLabel.textContent = 'YOU';
    else if (state === 'thinking') subLabel.textContent = 'JARVIS';
    else if (state === 'speaking') subLabel.textContent = 'JARVIS';
  }
  if (subText && state !== 'speaking') {
    subText.textContent = label;
  }

  // Update Strands Orb state and sizing attribute
  const orbContainer = document.getElementById('orb-container');
  if (orbContainer) {
    let orbState = 'IDLE';
    if (state === 'listening' || state === 'awake') orbState = 'LISTENING';
    else if (state === 'speaking') orbState = 'SPEAKING';
    else if (state === 'thinking') orbState = 'THINKING';
    orbContainer.setAttribute('data-orb-state', orbState);
    if (window.StrandsOrb?.instance?.setState) {
      window.StrandsOrb.instance.setState(orbState);
    }
  }
}

function startWakeListener() {
  if (!jarvisHandsFree || localStorage.getItem('clavis_mic_permission_granted') !== 'true') return;
  // With Clavis Live connected, hands-free means a REAL wake word on the free
  // browser recognizer: nothing is sent anywhere as a command until sir says
  // "Clavis" (the old path treated every overheard sentence as a command).
  // Only the wake opens a Live session, so idle listening costs no quota.
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  // The free browser recognizer is the wake-word detector whenever it exists
  // (with or without Live). Before, without a Gemini key the fallback tiers
  // treated EVERY overheard sentence as a command.
  if (!SR) {
    if (!window.LocalSpeechEngine) {
      setJarvisStatus('unavailable', 'Local speech service unavailable');
      return;
    }
    if (!window.LocalSpeechEngine.inputSocket) {
      startJarvisVoiceInput({ handsFreeCapture: true, persistent: true });
    }
    return;
  }
  if (window.ClavisLive?.isActive?.() || wakeRecognition) return;
  wakeStopRequested = false;
  // Voice ID scores the follow-up window from this tap (only once enrolled).
  if (window.ClavisEar?.voiceId?.enabled?.()) window.ClavisEar.tap.start('wake');

  wakeRecognition = new SR();
  // en-IN writes "Clavis" (and Hinglish) in Latin script; hi-IN tends to
  // write it in Devanagari, which the wake matcher would miss.
  wakeRecognition.lang = localStorage.getItem('clavis_wake_lang') || 'en-IN';
  wakeRecognition.continuous = true;
  wakeRecognition.interimResults = true;

  wakeRecognition.onresult = (e) => {
    const latest = e.results[e.results.length - 1];
    const latestText = String(latest?.[0]?.transcript || '').trim();

    // Clavis is talking. The recognizer hears its voice too, so nothing here
    // is a command — unless it is sir talking OVER it (a stop word, his own
    // new words, or its name), which is a real barge-in.
    if (isJarvisSpeaking || window.ClavisEar?.isSpeaking?.()) {
      clearTimeout(relistenTimer);
      const v = latestText ? window.ClavisEar?.judge?.(latestText) : null;
      if (v?.accept && v.barge) {
        interruptClavisSpeech();
        jarvisAwake = true;
        clavisFollowUpUntil = 0;
        clavisCaptureStartAt = Date.now() - 800;
        // Keep what he said as the start of the command, minus the wake name.
        const wake = clavisWakeMatch(latestText);
        clavisFinalTranscript = (!latest.isFinal || window.ClavisCommands?.isStop?.(latestText)) ? '' : (wake ? wake.remainder : latestText);
        wakeResultIndex = e.results.length - 1;
        clavisShowVoicePreview(clavisFinalTranscript || latestText);
        setJarvisStatus('awake', 'Haan sir, boliye...');
      }
      return;
    }

    if (!jarvisAwake) {
      // Waiting for wake word
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const t = e.results[i][0].transcript;
        const wake = clavisWakeMatch(t);
        // Clavis saying its own name ("Main Clavis hoon") must not wake it.
        if (wake && window.ClavisEar && window.ClavisEar.msSinceSpoke() < 4000 && !window.ClavisEar.judge(t).accept) continue;
        if (wake) {
          jarvisAwake = true;
          wakeResultIndex = i;
          clavisFinalTranscript = wake.remainder;
          clavisFollowUpUntil = 0;
          clavisCaptureStartAt = Date.now() - 800;

          window.LocalSpeechEngine?.stopInput?.();
          if (currentPlayingAudio) {
            currentPlayingAudio.pause();
            currentPlayingAudio = null;
          }
          isJarvisSpeaking = false;

          playWakeChime();
          setJarvisStatus('awake', 'Haan sir, boliye...');
          const remainder = wake.remainder;
          stopWakeListener(true);
          clearTimeout(relistenTimer);
          // Fresh session: the wake recognizer must never also be the command
          // recognizer, otherwise Chrome can replay partial interim results.
          window.setTimeout(() => startJarvisVoiceInput({ initialText: remainder, handsFreeCapture: true, awakeCapture: true }), 120);
          break;
        }
      }
    } else if (!jarvisRecognition) {
      // Capturing command (after a barge-in, or in the follow-up window)
      let captured = clavisFinalTranscript;
      let interim = '';

      for (let i = e.resultIndex; i < e.results.length; i++) {
        if (!e.results[i]) continue;
        const t = e.results[i][0].transcript;
        if (e.results[i].isFinal) {
          // A late final of Clavis's own last sentence is not part of his command.
          const v = window.ClavisEar?.judge?.(t);
          if (v && !v.accept && /echo/.test(v.reason)) continue;
          captured += t + ' ';
        } else {
          interim += t;
        }
      }

      const fullText = (captured + interim).trim();
      clavisFinalTranscript = captured.trim();
      if (fullText && !clavisCaptureStartAt) clavisCaptureStartAt = Date.now() - 800;
      if (fullText) {
        clavisShowVoicePreview(fullText);
        clearTimeout(clavisFollowUpTimer);
      }
      const subText = document.getElementById('jarvis-subtitle-text');
      if (subText && fullText) {
        subText.textContent = fullText;
      }

      const openMic = Date.now() < clavisFollowUpUntil;
      const commit = (value) => {
        const finalText = clavisCommitCommand(value);
        clavisFinalTranscript = '';
        jarvisAwake = false;
        clavisFollowUpUntil = 0;
        const since = clavisCaptureStartAt;
        clavisCaptureStartAt = 0;
        if (!finalText) return;
        document.getElementById('jarvis-voice-btn')?.classList.remove('recording');
        commitJarvisVoiceInput(finalText, { openMic, since, source: 'wake' });
      };
      clearTimeout(relistenTimer);
      relistenTimer = setTimeout(() => commit(fullText), 1600); // natural pause, without 3 s of dead air before every reply
      if (/\b(go for it|that's it|thats it|backseat|done|over)\.?\s*$/i.test(fullText)) {
        clearTimeout(relistenTimer);
        commit(fullText);
      }
    }
  };

  wakeRecognition.onerror = (ev) => {
    if (ev.error === 'not-allowed' || ev.error === 'service-not-allowed') {
      showToast('error', 'Mic Blocked', 'Please allow microphone access for hands-free mode.');
      jarvisHandsFree = false;
      const handsFreeButton = document.getElementById('jarvis-handsfree-btn');
      handsFreeButton?.classList.remove('active');
      handsFreeButton?.setAttribute('aria-pressed', 'false');
      const settingsToggle = document.getElementById('hands-free-toggle');
      if (settingsToggle) settingsToggle.checked = false;
    }
  };

  wakeRecognition.onend = () => {
    if (!jarvisHandsFree || wakeStopRequested) return;
    clearTimeout(wakeRestartTimer);
    const recognizer = wakeRecognition;
    wakeRestartTimer = setTimeout(() => {
      if (!jarvisHandsFree || wakeStopRequested || wakeRecognition !== recognizer || jarvisRecognition) return;
      try { recognizer.start(); } catch (_) {
        wakeRestartTimer = setTimeout(() => {
          if (!jarvisHandsFree || wakeStopRequested || wakeRecognition !== recognizer || jarvisRecognition) return;
          try { recognizer.start(); } catch (_) {}
        }, 500);
      }
    }, 180);
  };

  try { wakeRecognition.start(); } catch { /* ignore */ }
}

function stopWakeListener(keepAwake = false) {
  window.ClavisEar?.tap?.stop?.('wake');
  if (window.LocalSpeechEngine) window.LocalSpeechEngine.stopInput?.();
  if (wakeRecognition) {
    wakeStopRequested = true;
    clearTimeout(wakeRestartTimer);
    try { wakeRecognition.onend = null; wakeRecognition.stop(); } catch {}
    wakeRecognition = null;
  }
  if (!keepAwake) jarvisAwake = false;
  const btn = document.getElementById('jarvis-voice-btn');
  btn?.classList.remove('recording');
}

function scheduleHandsFreeRelisten() {
  clearTimeout(relistenTimer);
  relistenTimer = setTimeout(() => {
    if (jarvisHandsFree && isJarvisSpeaking) {
      scheduleHandsFreeRelisten();
    } else if (jarvisHandsFree) {
      // Like a person in a conversation: for a few seconds after a reply he
      // can just answer, no "Clavis" needed. Words in this window still pass
      // ClavisEar (not echo, sounds like a request, his voice if enrolled);
      // silence or chatter drops back to wake-word listening.
      const followUp = localStorage.getItem('clavis_followup_window') !== 'false'
        && !window.ClavisLive?.isActive?.() && Boolean(window.SpeechRecognition || window.webkitSpeechRecognition);
      jarvisAwake = followUp;
      clavisFinalTranscript = '';
      clavisCaptureStartAt = 0;
      clavisFollowUpUntil = followUp ? Date.now() + 7000 : 0;
      clearTimeout(clavisFollowUpTimer);
      if (followUp) {
        clavisFollowUpTimer = setTimeout(() => {
          if (jarvisAwake && !clavisFinalTranscript && Date.now() >= clavisFollowUpUntil) {
            jarvisAwake = false;
            clavisFollowUpUntil = 0;
            window.ClavisEar?.caption?.listening(false);
            setJarvisStatus('listening', 'Sun raha hoon — bolo "Clavis"');
          }
        }, 7100);
        window.ClavisEar?.caption?.listening(true);
      }
      startWakeListener();
      if (localStorage.getItem('clavis_sound_trigger_enabled') !== 'false') startClavisSoundTriggers();
      setJarvisStatus(followUp ? 'awake' : 'listening', followUp ? 'Boliye, sir…' : 'Sun raha hoon — bolo "Clavis"');
    }
  }, 700);
}

// Soft two-tone chime so the user knows Jarvis is now listening.
function playWakeChime() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const now = ctx.currentTime;
    [ [880, 0], [1320, 0.12] ].forEach(([freq, t]) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.frequency.value = freq;
      osc.type = 'sine';
      gain.gain.setValueAtTime(0.0001, now + t);
      gain.gain.exponentialRampToValueAtTime(0.25, now + t + 0.03);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + t + 0.18);
      osc.connect(gain); gain.connect(ctx.destination);
      osc.start(now + t); osc.stop(now + t + 0.2);
    });
    setTimeout(() => ctx.close(), 600);
  } catch { /* audio not available */ }
}

// xAI's neural voices are provider voices, so they do not appear in the
// browser's SpeechSynthesisVoice list. Rex is the default masculine executive
// voice; Leo and Sal provide warmer alternatives.
const CLAVIS_CLOUD_VOICES = [
  ['rex', 'Rex', 'deep · executive'],
  ['leo', 'Leo', 'grounded · confident'],
  ['sal', 'Sal', 'warm · conversational'],
  ['ara', 'Ara', 'clear · balanced'],
  ['eve', 'Eve', 'bright · expressive'],
];

function renderClavisCloudVoiceOptions() {
  return;
  /* Cloud/browser voice inventory intentionally retired; Gemini is the only voice engine. */
  const browserOptions = document.getElementById('jarvisVoiceOptions');
  if (!browserOptions || document.getElementById('clavisCloudVoiceOptions')) return;

  const section = document.createElement('div');
  section.id = 'clavisCloudVoiceOptions';
  section.className = 'clavis-cloud-voice-section';
  section.innerHTML = `
    <div class="clavis-cloud-voice-heading">
      <span>Neural voice</span>
        <small>Grok / xAI Neural TTS</small>
    </div>
    <div class="clavis-cloud-voice-list">
      ${CLAVIS_CLOUD_VOICES.map(([id, name, note]) => `
        <button type="button" class="clavis-cloud-voice-option" data-voice="${id}"
          onclick="selectClavisCloudVoice('${id}', this)">
          <span><strong>${name}</strong><small>${note}</small></span>
          <span class="clavis-cloud-voice-check" aria-hidden="true">✓</span>
        </button>`).join('')}
    </div>
    <p class="clavis-cloud-voice-help">Choose Grok Neural Voice in System Settings, or leave Auto enabled when your xAI key is connected. Without a key, Clavis safely falls back to the browser voice.</p>`;
  browserOptions.parentNode.insertBefore(section, browserOptions);
  syncClavisCloudVoiceSelection();
}

function syncClavisCloudVoiceSelection() {
  const selected = localStorage.getItem('clavis_xai_voice') || 'rex';
  document.querySelectorAll('.clavis-cloud-voice-option').forEach((button) => {
    const active = button.dataset.voice === selected;
    button.classList.toggle('selected', active);
    button.setAttribute('aria-pressed', String(active));
  });
}

function selectClavisCloudVoice(voice, button) {
  if (!CLAVIS_CLOUD_VOICES.some(([id]) => id === voice)) return;
  localStorage.setItem('clavis_xai_voice', voice);
  syncClavisCloudVoiceSelection();
  showToast('success', 'Grok voice selected', `${voice} will be used for expressive Clavis replies.`);
}

function renderClavisRecognitionLanguage() {
  return;
  /* Local STT accepts auto/en/hi hints; it is not browser recognition. */
  const browserOptions = document.getElementById('jarvisVoiceOptions');
  if (!browserOptions || document.getElementById('clavisRecognitionLanguage')) return;
  const wrap = document.createElement('div');
  wrap.id = 'clavisRecognitionLanguage';
  wrap.className = 'clavis-recognition-language';
  wrap.innerHTML = `
    <label for="clavisRecognitionLanguageSelect">Speech input language</label>
    <select id="clavisRecognitionLanguageSelect" onchange="selectClavisRecognitionLanguage(this.value)">
      <option value="hi-IN">Hindi / Hinglish</option>
      <option value="en-IN">English (India)</option>
      <option value="en-US">English (US)</option>
    </select>
    <small>Chrome uses one recognition language per session; Clavis TTS can still speak mixed Hindi-English in one voice.</small>`;
  browserOptions.parentNode.insertBefore(wrap, browserOptions);
  const select = wrap.querySelector('select');
  if (select) select.value = localStorage.getItem('clavis_voice_language') || localStorage.getItem('jarvis_voice_lang') || 'hi-IN';
}

function selectClavisRecognitionLanguage(language) {
  if (!['hi-IN', 'en-IN', 'en-US'].includes(language)) return;
  localStorage.setItem('clavis_voice_language', language);
  localStorage.setItem('jarvis_voice_lang', language);
  showToast('success', 'Speech language updated', `${language} will be used the next time you tap Speech.`);
}

// ── Spoken replies (Web Speech Synthesis & Neural TTS) ─────────────────────
function toggleJarvisSpeech() {
  jarvisSpeechEnabled = !jarvisSpeechEnabled;
  localStorage.setItem('jarvis_speech_enabled', String(jarvisSpeechEnabled));
  updateJarvisSpeechIcon();
  showToast('info', jarvisSpeechEnabled ? 'Voice Replies On' : 'Voice Replies Off', jarvisSpeechEnabled ? 'Clavis will speak its replies aloud.' : '');
}

function updateJarvisSpeechIcon() {
  const btn = document.getElementById('jarvis-speak-toggle');
  if (btn) {
    btn.classList.toggle('active', jarvisSpeechEnabled);
    btn.setAttribute('aria-pressed', String(jarvisSpeechEnabled));
  }
}

// Most of Clavis's replies are Hinglish written in LATIN script ("Sun raha
// hoon", "aapko chahiye"), not Devanagari — so a Devanagari-only check almost
// always misses it and hands the sentence to an English voice, which then
// mispronounces every Hindi word with English phonetics. That mispronunciation
// is the actual "bekar awaaz, Hindi mistake" the user is hearing. This scores
// a sentence against common romanized Hindi/Hinglish tokens as well as actual
// Devanagari, so Hindi-heavy sentences get routed to a Hindi voice instead.
const HINGLISH_MARKERS = new Set(['hai','hoon','hun','raha','rahi','rahe','kya','kaise','kaun','kahan','kab','kyun','kyu',
  'nahi','nahin','haan','han','bhi','abhi','sirf','bas','thoda','bahut','bohot','zyada','jyada','kam',
  'chahiye','chahta','chahti','karo','kariye','karna','karenge','kijiye','kijie','dijiye','dijie','dena','lena',
  'aap','aapka','aapki','aapko','tum','tumhe','tumhara','main','mera','meri','mujhe','hum','humein','hamara',
  'sir','madam','ji','acha','accha','theek','thik','sahi','galat','bata','batao','bataiye','suniye','suno',
  'kuch','koi','sab','sabhi','wala','wali','wale','yeh','ye','woh','wo','iska','uska','iske','uske',
  'namaste','shukriya','dhanyavaad','maaf','matlab','samajh','samjha']);
function hinglishScore(sentence) {
  if (/[\u0900-\u097F]/.test(sentence)) return 1; // real Devanagari — unambiguous
  const words = sentence.toLowerCase().match(/[a-z']+/g) || [];
  if (!words.length) return 0;
  const hits = words.filter(w => HINGLISH_MARKERS.has(w)).length;
  return hits / words.length;
}
function isHindiishText(sentence) {
  return hinglishScore(sentence) >= 0.18; // ~1 in 5 words is a Hindi marker
}

/**
 * Expressive Emotional Prosody Engine for JARVIS
 * Analyzes sentence intent, punctuation, emotional tone, and phrasing
 * Modulates pitch, speech rate, volume, and natural breath pauses dynamically
 * so the assistant sounds alive, engaged, and empathetic — zero robotic flatness.
 */
function detectEmotion(sentence) {
  const s = String(sentence || '').trim().toLowerCase();
  
  // 1. Inquisitive / Asking question / Checking in on the user
  if (s.endsWith('?') || /\b(kya|kaise|kaun|kahan|kyun|shall i|should i|would you like|can i help|kya karun|theek hai|kya main)\b/i.test(s)) {
    return {
      name: 'inquisitive',
      pitchMultiplier: 1.05,
      rateMultiplier: 1.01,
      volume: 1.0,
      pauseAfter: 175
    };
  }
  
  // 2. Confident / Triumphant / Task Accomplished / Enthusiastic
  if (s.endsWith('!') || /\b(shandar|badhiya|ho gaya|done|sorted|perfect|certainly|right away|bilkul sir|success|excellent|consider it done|khol diya)\b/i.test(s)) {
    return {
      name: 'confident',
      pitchMultiplier: 1.03,
      rateMultiplier: 1.05,
      volume: 1.04,
      pauseAfter: 130
    };
  }

  // 3. Empathetic / Warm / Reassuring / Caring
  if (/\b(chinta mat|tension mat|aram se|don't worry|relax|take it easy|take care|madad|koi baat nahi|fret not|main dekh raha)\b/i.test(s)) {
    return {
      name: 'reassuring',
      pitchMultiplier: 0.96,
      rateMultiplier: 0.94,
      volume: 0.98,
      pauseAfter: 180
    };
  }

  // 4. Alert / Warning / Error detected / Problem identified
  if (/\b(warning|error|dhyan|savdhan|caution|problem|issue|atak|phas|fail|failed|blocked|danger)\b/i.test(s)) {
    return {
      name: 'alert',
      pitchMultiplier: 0.98,
      rateMultiplier: 1.04,
      volume: 1.05,
      pauseAfter: 155
    };
  }

  // 5. Reflective / Analytical / Computing / Observing
  if (/\b(dekh raha hoon|analyzing|inspecting|checking|calculating|soch raha hoon|lagta hai|one moment|scanning|crafting)\b/i.test(s)) {
    return {
      name: 'analytical',
      pitchMultiplier: 0.97,
      rateMultiplier: 0.93,
      volume: 0.97,
      pauseAfter: 205
    };
  }

  // Default: Suave, measured, executive Jarvis cadence
  return {
    name: 'jarvis_cadence',
    pitchMultiplier: 1.0,
    rateMultiplier: 1.0,
    volume: 1.0,
    pauseAfter: 135
  };
}
window.detectEmotion = detectEmotion;

async function legacySpeakJarvisTextV1(text) {
  // Legacy browser voice renderer retained only for migration inspection.
  // so Clavis speaks naturally like a human instead of reading symbols.
  const clean = text
    .replace(/\|\|[\s\S]*?\|\|/g, '')
    .replace(/https?:\/\/\S+/g, '')
    .replace(/[*_#~>]/g, '')
    .replace(/^\s*[-*•]\s+/gm, '')
    .replace(/\n+/g, '. ')
    .replace(/\s{2,}/g, ' ')
    .trim();

  if (!clean) return;

  isJarvisSpeaking = true;
  stopClavisSoundTriggers();
  setJarvisStatus('speaking', clean.slice(0, 48) + (clean.length > 48 ? '...' : ''));
  window.ClavisMind?.noteSpeakingStarted?.(clean);
  window.ClavisEar?.noteSpeaking?.(clean);
  const subText = document.getElementById('jarvis-subtitle-text');
  if (subText) subText.textContent = clean;

  const doneSpeaking = () => {
    isJarvisSpeaking = false;
    clearTimeout(speechSafetyTimer);
    currentPlayingAudio = null;
    window.ClavisMind?.noteSpeakingStopped?.(); window.ClavisEar?.noteSpeakingDone?.();
    if (window.ClavisBargeIn) window.ClavisBargeIn.disarm();
    if (jarvisAwake) setJarvisStatus('awake', 'Haan sir, boliye...');
    else setJarvisStatus('listening', 'Sun raha hoon — bolo "Clavis"');
  };

  let speechSafetyTimer = setTimeout(() => {
    doneSpeaking();
  }, 25000);

  const ttsEngine = localStorage.getItem('skylark-tts-engine')
    || localStorage.getItem('skylark-tts-model')
    || 'native';
  const ttsKey = localStorage.getItem('skylark-tts-key')
    || localStorage.getItem('skylark_tts_key')
    || localStorage.getItem('setting-tts-key');
  const speechRate = Math.max(0.85, Math.min(1.2, parseFloat(
    localStorage.getItem('jarvis_voice_rate') || localStorage.getItem('skylark-speech-speed') || '1'
  )));

  // 1. OpenAI TTS (if user configured an OpenAI TTS key)
  if (ttsEngine === 'openai' && ttsKey) {
    (async () => {
      try {
        const response = await fetch('https://api.openai.com/v1/audio/speech', {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${ttsKey}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: 'gpt-4o-mini-tts',
            input: clean,
            voice: localStorage.getItem('clavis_tts_voice') || 'onyx',
            speed: speechRate,
            instructions: 'Speak warmly and naturally as JARVIS, an ultra-smart, charismatic executive AI assistant.'
          })
        });
        if (response.ok) {
          const blob = await response.blob();
          const url = URL.createObjectURL(blob);
          if (currentPlayingAudio) try { currentPlayingAudio.pause(); } catch {}
          currentPlayingAudio = new Audio(url);
          currentPlayingAudio.onended = doneSpeaking;
          currentPlayingAudio.onerror = doneSpeaking;
          await currentPlayingAudio.play();
          if (window.ClavisBargeIn && jarvisHandsFree) window.ClavisBargeIn.arm(handleClavisBargeIn);
          return;
        }
      } catch (err) {
        console.warn('OpenAI TTS error, falling through:', err);
      }
    })();
  }

  // 2. High-Definition Native Neural Synthesis with LOCKED PERSONA
  if (!window.speechSynthesis) {
    doneSpeaking();
    return;
  }

  try { window.speechSynthesis.resume?.(); } catch (_) {}
  window.speechSynthesis.cancel();

  const sentences = splitSentences(clean);
  const storedPitch = Math.max(0.85, Math.min(1.15, parseFloat(localStorage.getItem('jarvis_voice_pitch') || '1')));
  const storedVolume = Math.max(0, Math.min(1, parseFloat(localStorage.getItem('jarvis_voice_volume') || '1')));
  const overallWantsHindi = isHindiishText(clean);
  // Default to MALE persona (JARVIS) unless user explicitly saved 'female'
  const selectedGender = localStorage.getItem('jarvis_voice_gender') || 'male';

  // --- LOCKED CONSISTENT PERSONA RESOLUTION ---
  // Resolves the voice ONCE for the message to maintain a locked, uniform persona.
  const getLockedPersonaVoice = () => {
    const voices = window.speechSynthesis.getVoices() || [];
    if (!voices.length) return null;

    // Check user manual selection first if available
    const stored = localStorage.getItem('jarvis_voice_name');
    if (stored) {
      const match = voices.find(v => v.name === stored);
      if (match) return match;
    }

    // Filter out robotic legacy desktop SAPI voices (Microsoft David Desktop, Zira, Ravi)
    const isModernVoice = (v) => !v.name.toLowerCase().includes('desktop');

    if (selectedGender === 'male') {
      // ── JARVIS MALE PERSONA PRIORITY ──
      if (overallWantsHindi) {
        // High-definition Indian male voices (Madhur or Prabhat)
        const mHi = voices.find(v => (v.lang.includes('hi') || v.lang.includes('IN')) && (v.name.includes('Madhur') || v.name.includes('Prabhat')));
        if (mHi) return mHi;
        const mHiAny = voices.find(v => v.lang.includes('hi') && (v.name.includes('Male') || v.name.includes('Google') || !v.name.includes('Zira')));
        if (mHiAny) return mHiAny;
      }
      // 1. British English Natural Male (Iconic Paul Bettany / JARVIS tone)
      const mJarvisUK = voices.find(v => (v.lang.includes('en-GB') || v.lang.includes('en_GB')) && (v.name.includes('Ryan') || v.name.includes('George') || v.name.includes('Natural') || v.name.includes('Male')));
      if (mJarvisUK) return mJarvisUK;
      // 2. Google UK English Male
      const mGoogleUK = voices.find(v => v.name.includes('Google') && v.name.includes('UK') && v.name.includes('Male'));
      if (mGoogleUK) return mGoogleUK;
      // 3. Indian / US Natural Male (Prabhat, Guy, Ryan)
      const mNatural = voices.find(v => (v.name.includes('Prabhat') || v.name.includes('Guy') || v.name.includes('Ryan') || (v.name.includes('Natural') && v.name.includes('Male'))));
      if (mNatural) return mNatural;
      // 4. Any modern male voice
      const mModern = voices.find(v => (v.name.includes('Male') || v.name.includes('George') || v.name.includes('David') || v.name.includes('Mark')) && isModernVoice(v));
      if (mModern) return mModern;
      const mAny = voices.find(v => v.name.includes('Male') || v.name.includes('George') || v.name.includes('David') || v.name.includes('Prabhat') || v.name.includes('Madhur'));
      if (mAny) return mAny;
    } else {
      // FEMALE PERSONA PRIORITY
      if (overallWantsHindi) {
        const f1 = voices.find(v => v.lang.includes('hi') && v.name.includes('Swara'));
        if (f1) return f1;
        const fGoogleHi = voices.find(v => v.lang.includes('hi') && (v.name.includes('Google') || !v.name.includes('Desktop')));
        if (fGoogleHi) return fGoogleHi;
        const fHiAny = voices.find(v => v.lang.includes('hi') && isModernVoice(v));
        if (fHiAny) return fHiAny;
      }
      const fNeerja = voices.find(v => (v.lang.includes('en-IN') || v.lang.includes('en_IN')) && v.name.includes('Neerja'));
      if (fNeerja) return fNeerja;
      const fGoogleEn = voices.find(v => v.name.includes('Google') && (v.name.includes('Female') || v.lang.includes('en-GB') || v.lang.includes('en-US')));
      if (fGoogleEn) return fGoogleEn;
      const fNatural = voices.find(v => (v.name.includes('Natural') || v.name.includes('Online')) && isModernVoice(v));
      if (fNatural) return fNatural;
      const fFemale = voices.find(v => v.name.includes('Female') || v.name.includes('Zira'));
      if (fFemale) return fFemale;
    }

    // Fallback: Best available natural voice
    return voices.find(v => (v.name.includes('Natural') || v.name.includes('Online')))
      || voices.find(v => v.lang.startsWith('hi'))
      || voices.find(v => v.lang.startsWith('en'))
      || voices[0];
  };

  const lockedVoice = getLockedPersonaVoice();
  const lockedLang = (lockedVoice && lockedVoice.lang) ? lockedVoice.lang : (overallWantsHindi ? 'hi-IN' : 'en-IN');

  const speakSequence = (sentences, idx) => {
    if (idx >= sentences.length || !isJarvisSpeaking) {
      doneSpeaking();
      return;
    }

    const sentence = sentences[idx].trim();
    if (!sentence) {
      speakSequence(sentences, idx + 1);
      return;
    }

    const utter = new SpeechSynthesisUtterance(sentence);
    // Locked voice and consistent language persona across all sentences!
    if (lockedVoice) utter.voice = lockedVoice;
    utter.lang = lockedLang;

    const emotion = detectEmotion(sentence);
    // Conversational, warm, natural human pacing
    utter.rate = speechRate * 0.98 * emotion.rateMultiplier;
    let pitchMod = storedPitch * emotion.pitchMultiplier;
    if (selectedGender === 'male' && lockedVoice && (lockedVoice.name.includes('Google') || (!lockedVoice.name.toLowerCase().includes('madhur') && !lockedVoice.name.toLowerCase().includes('prabhat') && !lockedVoice.name.toLowerCase().includes('ryan') && !lockedVoice.name.toLowerCase().includes('george')))) {
      pitchMod *= 0.91; // Deeper executive male acoustic resonance
    }
    utter.pitch = Math.max(0.75, Math.min(1.25, pitchMod));
    utter.volume = emotion.volume * storedVolume;

    utter.onend = () => {
      // Natural human pause between sentences (120ms - 180ms)
      const pause = emotion.pauseAfter || 130;
      setTimeout(() => speakSequence(sentences, idx + 1), pause);
    };

    utter.onerror = (err) => {
      console.warn('Utterance notice:', err?.error || err);
      speakSequence(sentences, idx + 1);
    };

    try {
      window.speechSynthesis.resume?.();
      window.speechSynthesis.speak(utter);
    } catch (_) {
      doneSpeaking();
    }
  };

  speakSequence(sentences, 0);
}

// ── Clavis voice director v2 ─────────────────────────────────────────────
// Defined after the legacy renderer above so the runtime uses this single
// implementation. It fixes the old cloud/native race and gives xAI's current
// expressive TTS first priority when an xAI key is available.
function stopJarvisSpeech() {
  try { window.ClavisVoice?.stop?.(); } catch (_) {}
  jarvisSpeechRequestId += 1;
  try { jarvisSpeechAbortController?.abort('speech-cancelled'); } catch (_) {}
  jarvisSpeechAbortController = null;
  clearTimeout(jarvisSpeechSafetyTimer);
  try { window.LocalSpeechEngine?.stop?.(); } catch (_) {}
  if (currentPlayingAudio) {
    try { currentPlayingAudio.pause(); } catch (_) {}
    currentPlayingAudio = null;
  }
  if (jarvisSpeechAudioUrl) {
    try { URL.revokeObjectURL(jarvisSpeechAudioUrl); } catch (_) {}
    jarvisSpeechAudioUrl = '';
  }
}

function initClavisLocalVoiceControls() {
  const voice = window.ClavisVoice?.primaryVoice?.() || localStorage.getItem('clavis_gemini_voice') || 'Kore';
  ['clavis-gemini-voice', 'sm-gemini-voice'].forEach((id) => { const el = document.getElementById(id); if (el) el.value = voice; });
}

// One interruption path for native, Piper, and xAI playback. The detector
// itself disarms before invoking this callback; restart capture only in
// hands-free mode so a normal tap-to-talk session stays predictable.
function handleClavisBargeIn() {
  if (!interruptClavisSpeech()) return;
  // He is talking right now, so listen — in every mode, not just hands-free
  // (before, a tap-to-talk user who interrupted was simply not heard).
  // In hands-free the running wake recognizer is already hearing him.
  if (wakeRecognition && jarvisHandsFree) {
    jarvisAwake = true;
    clavisFinalTranscript = '';
    clavisFollowUpUntil = 0;
    clavisCaptureStartAt = Date.now() - 600;
    window.ClavisEar?.caption?.listening(true);
    setJarvisStatus('awake', 'Haan sir, boliye...');
    return;
  }
  setTimeout(() => {
    if (!isJarvisSpeaking && !jarvisRecognition && !isGroqRecording) {
      startJarvisVoiceInput({ handsFreeCapture: true, awakeCapture: true, persistent: false });
    }
  }, 60);
}
window.handleClavisBargeIn = handleClavisBargeIn;

async function legacySpeakJarvisTextV2(text) {
  const clean = String(text || '')
    .replace(/\|\|\|[\s\S]*?\|\|\|/g, '')
    .replace(/https?:\/\/\S+/g, '')
    .replace(/[*_#~>]/g, '')
    .replace(/^\s*[-*•]\s+/gm, '')
    .replace(/\n+/g, '. ')
    .replace(/\s{2,}/g, ' ')
    .trim();
  if (!clean) return false;

  stopJarvisSpeech();
  const requestId = ++jarvisSpeechRequestId;
  const controller = new AbortController();
  jarvisSpeechAbortController = controller;
  const active = () => requestId === jarvisSpeechRequestId && !controller.signal.aborted;
  const revokeAudioUrl = () => {
    if (jarvisSpeechAudioUrl) { try { URL.revokeObjectURL(jarvisSpeechAudioUrl); } catch (_) {} jarvisSpeechAudioUrl = ''; }
  };
  let finished = false;
  const doneSpeaking = () => {
    if (finished) return;
    finished = true;
    clearTimeout(jarvisSpeechSafetyTimer);
    revokeAudioUrl();
    if (!active()) return;
    jarvisSpeechAbortController = null;
    currentPlayingAudio = null;
    isJarvisSpeaking = false;
    window.ClavisMind?.noteSpeakingStopped?.(); window.ClavisEar?.noteSpeakingDone?.();
    window.ClavisBargeIn?.disarm?.();
    if (jarvisAwake) setJarvisStatus('awake', 'Haan sir, boliye...');
    else setJarvisStatus('listening', 'Sun raha hoon — bolo "Clavis"');
  };

  isJarvisSpeaking = true;
  stopClavisSoundTriggers();
  setJarvisStatus('speaking', clean.slice(0, 48) + (clean.length > 48 ? '...' : ''));
  window.ClavisMind?.noteSpeakingStarted?.(clean);
  window.ClavisEar?.noteSpeaking?.(clean);
  const subText = document.getElementById('jarvis-subtitle-text');
  if (subText) subText.textContent = clean;
  jarvisSpeechSafetyTimer = setTimeout(doneSpeaking, Math.max(25000, Math.min(90000, clean.length * 180)));

  const ttsEngine = localStorage.getItem('skylark-tts-engine') || localStorage.getItem('skylark-tts-model') || 'native';
  const xaiKey = window.ClavisDirect?.keyFor?.('xai');
  const autoNeural = localStorage.getItem('clavis_auto_neural_voice') !== 'false';
  const useXai = Boolean(window.ClavisDirect?.synthesizeWithXai && xaiKey && (ttsEngine === 'xai' || (ttsEngine === 'native' && autoNeural)));
  const speechRate = Math.max(0.85, Math.min(1.2, parseFloat(localStorage.getItem('jarvis_voice_rate') || localStorage.getItem('skylark-speech-speed') || '1')));
  const languageMode = window.ClavisEmotionalEngine?.languageOf?.(clean) || (isHindiishText(clean) ? 'hinglish' : 'en');
  const language = languageMode === 'hi' || languageMode === 'hinglish' ? 'hi' : 'en';

  // xAI's Voice API supplies the expressive masculine voice and supports
  // [pause]/[breath] plus <lower-pitch>/<soft>/<emphasis> tags. Awaiting this
  // call is important: the previous implementation played native TTS while
  // the cloud request was still running, so both voices could speak together.
  if (useXai) {
    try {
      const styled = window.ClavisEmotionalEngine?.decorateSpeech?.(clean) || clean;
      const result = await window.ClavisDirect.synthesizeWithXai(styled, {
        language,
        voiceId: localStorage.getItem('clavis_xai_voice') || 'rex',
        speed: speechRate,
      }, controller.signal);
      if (!active()) return false;
      jarvisSpeechAudioUrl = URL.createObjectURL(result.blob);
      currentPlayingAudio = new Audio(jarvisSpeechAudioUrl);
      currentPlayingAudio.preload = 'auto';
      currentPlayingAudio.onended = doneSpeaking;
      currentPlayingAudio.onerror = () => { revokeAudioUrl(); doneSpeaking(); };
      await currentPlayingAudio.play();
      if (active() && window.ClavisBargeIn && jarvisHandsFree) window.ClavisBargeIn.arm(handleClavisBargeIn);
      return true;
    } catch (error) {
      if (!active()) return false;
      console.warn('xAI Neural TTS unavailable; using local fallback:', error);
      revokeAudioUrl(); currentPlayingAudio = null;
    }
  }

  // Piper is already part of this project and is the no-key path when its
  // binary and model are installed. Keep it opt-in so an uninstalled backend
  // never slows down normal browser fallback.
  if (ttsEngine === 'piper') {
    try {
      const base = window.SKYLARK_CONFIG?.BACKEND_URL || 'http://localhost:8000';
      const response = await fetch(`${base}/api/tts`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: clean, lang: language }), signal: controller.signal,
      });
      if (!response.ok) throw new Error(`Piper TTS ${response.status}`);
      if (!active()) return false;
      jarvisSpeechAudioUrl = URL.createObjectURL(await response.blob());
      currentPlayingAudio = new Audio(jarvisSpeechAudioUrl);
      currentPlayingAudio.onended = doneSpeaking;
      currentPlayingAudio.onerror = doneSpeaking;
      await currentPlayingAudio.play();
      if (window.ClavisBargeIn && jarvisHandsFree) window.ClavisBargeIn.arm(handleClavisBargeIn);
      return true;
    } catch (error) {
      if (!active()) return false;
      console.warn('Local Piper unavailable; using browser voice:', error);
      revokeAudioUrl(); currentPlayingAudio = null;
    }
  }

  if (!window.speechSynthesis || typeof SpeechSynthesisUtterance === 'undefined') {
    doneSpeaking();
    return false;
  }
  try { window.speechSynthesis.resume?.(); window.speechSynthesis.cancel(); } catch (_) {}

  const sentences = (window.splitSentences ? window.splitSentences(clean) : clean.split(/(?<=[.!?।])\s+/)).filter(Boolean);
  const storedPitch = Math.max(0.85, Math.min(1.15, parseFloat(localStorage.getItem('jarvis_voice_pitch') || '1')));
  const storedVolume = Math.max(0, Math.min(1, parseFloat(localStorage.getItem('jarvis_voice_volume') || '1')));
  const wantsHindi = isHindiishText(clean);
  const selectedGender = localStorage.getItem('jarvis_voice_gender') || 'male';
  const voices = window.speechSynthesis.getVoices() || [];
  const selectedName = localStorage.getItem('jarvis_voice_name');
  const selectedVoice = selectedName && voices.find(v => v.name === selectedName);
  const feminine = (voice) => /zira|swara|neerja|female|woman|susan|heera/i.test(voice.name || '');
  const masculine = (voice) => /madhur|prabhat|ravi|male|man|david|mark|george|guy|ryan|daniel|alex|fred|matthew|brian|natural/i.test(voice.name || '');
  const modern = voices.filter(v => !/desktop/i.test(v.name || ''));
  const languageVoices = modern.filter(v => wantsHindi ? /^hi(?:-|_|$)/i.test(v.lang) : /^en(?:-|_|$)/i.test(v.lang));
  const ranked = (languageVoices.length ? languageVoices : modern).slice().sort((a, b) => {
    const score = (v) => (masculine(v) && selectedGender === 'male' ? 6 : 0) + (feminine(v) && selectedGender === 'female' ? 6 : 0) + (/natural|online|google/i.test(v.name || '') ? 3 : 0) + (/IN/i.test(v.lang || '') ? 2 : 0) - (feminine(v) && selectedGender === 'male' ? 8 : 0);
    return score(b) - score(a);
  });
  const lockedVoice = selectedVoice || ranked[0] || voices[0] || null;
  const lockedLang = lockedVoice?.lang || (wantsHindi ? 'hi-IN' : 'en-IN');
  const speakSequence = (index) => {
    if (!active()) return;
    if (index >= sentences.length) { doneSpeaking(); return; }
    const sentence = sentences[index].trim();
    if (!sentence) { speakSequence(index + 1); return; }
    const utter = new SpeechSynthesisUtterance(sentence);
    if (lockedVoice) utter.voice = lockedVoice;
    utter.lang = lockedLang;
    const emotion = window.ClavisEmotionalEngine?.speechProsody?.(sentence) || detectEmotion(sentence);
    utter.rate = speechRate * 0.98 * emotion.rateMultiplier;
    let pitch = storedPitch * emotion.pitchMultiplier;
    if (selectedGender === 'male' && lockedVoice && !masculine(lockedVoice)) pitch *= 0.91;
    utter.pitch = Math.max(0.75, Math.min(1.25, pitch));
    utter.volume = Math.max(0, Math.min(1, emotion.volume * storedVolume));
    utter.onend = () => { if (active()) setTimeout(() => speakSequence(index + 1), emotion.pauseAfter || 145); };
    utter.onerror = () => { if (active()) speakSequence(index + 1); };
    try { window.speechSynthesis.resume?.(); window.speechSynthesis.speak(utter); } catch (_) { doneSpeaking(); }
  };
  speakSequence(0);
  return true;
}

window.stopJarvisSpeech = stopJarvisSpeech;

// Single production voice path: Google Gemini over the cancellable PCM socket.
// The old browser/cloud renderers remain named legacy* above so no call site
// can accidentally reintroduce a second voice persona.
async function speakJarvisText(text) {
  const clean = String(text || '')
    .replace(/\|\|\|[\s\S]*?\|\|\|/g, '')
    .replace(/https?:\/\/\S+/g, '')
    .replace(/[*_#~>`]/g, '')
    .replace(/^\s*[-*•]\s+/gm, '')
    .replace(/\n+/g, '. ')
    .replace(/\s{2,}/g, ' ')
    .trim();
  if (!clean) return false;
  // During a Live session there is one voice: Clavis Live says it.
  if (window.ClavisLive?.isActive?.()) return window.ClavisLive.relay(clean);

  stopJarvisSpeech();
  const requestId = ++jarvisSpeechRequestId;
  const controller = new AbortController();
  jarvisSpeechAbortController = controller;
  const active = () => requestId === jarvisSpeechRequestId && !controller.signal.aborted;
  isJarvisSpeaking = true;
  setJarvisStatus('speaking', clean.slice(0, 48) + (clean.length > 48 ? '...' : ''));
  window.ClavisMind?.noteSpeakingStarted?.(clean);
  window.ClavisEar?.noteSpeaking?.(clean);
  window.ClavisBargeIn?.arm?.(handleClavisBargeIn).catch?.(() => {});
  const subtitle = document.getElementById('jarvis-subtitle-text');
  if (subtitle) subtitle.textContent = clean;

  const onSpeechFinished = () => {
    if (!active()) return;
    isJarvisSpeaking = false;
    jarvisSpeechAbortController = null;
    window.ClavisMind?.noteSpeakingStopped?.(); window.ClavisEar?.noteSpeakingDone?.();
    window.ClavisBargeIn?.disarm?.();
    if (jarvisAwake) setJarvisStatus('awake', 'Haan sir, boliye...');
    else setJarvisStatus('online', 'Clavis Ready');
    if (jarvisHandsFree) scheduleHandsFreeRelisten();
  };

  // Tier 0: ClavisVoice — Google AI Studio TTS (natural Hindi + English) when
  // a key is connected; otherwise the right browser voice per sentence, so
  // Hindi is read by the Hindi voice instead of "Google UK English Male".
  if (window.ClavisVoice) {
    try {
      const ok = await window.ClavisVoice.speak(clean, { signal: controller.signal });
      if (ok) { onSpeechFinished(); return true; }
      if (!active()) return false;
    } catch (e) { console.warn('[ClavisVoice]', e); }
  }

  // Tier 1: Local backend speech engine (if present & running)
  if (!window.LocalSpeechEngine?.isBackendUnavailable?.()
      && (window.LocalSpeechEngine?.outputSocket || window.LocalSpeechEngine?.speak)) {
    try {
      await window.LocalSpeechEngine.speak(clean, { signal: controller.signal });
      onSpeechFinished();
      return true;
    } catch (e) {
      console.warn('[Clavis speech] Local engine failed, falling back:', e);
    }
  }

  // Tier 2: OpenAI TTS (Human-like studio quality speech via alloy/nova)
  if (window.ClavisDirect?.keyFor?.('openai') && window.ClavisDirect?.ttsWithOpenAI) {
    try {
      const audioUrl = await window.ClavisDirect.ttsWithOpenAI(clean, 'alloy');
      if (!active()) return false;
      const audio = new Audio(audioUrl);
      currentPlayingAudio = audio;
      audio.onended = () => {
        URL.revokeObjectURL(audioUrl);
        currentPlayingAudio = null;
        onSpeechFinished();
      };
      audio.onerror = () => {
        URL.revokeObjectURL(audioUrl);
        currentPlayingAudio = null;
        onSpeechFinished();
      };
      await audio.play();
      return true;
    } catch (err) {
      console.warn('[Clavis OpenAI TTS fallback]:', err);
    }
  }

  // Tier 3: Browser SpeechSynthesis (works 100% offline, native Indian English / Hindi voices)
  try {
    // The legacy renderer was deliberately kept under its migration name;
    // calling the removed alias made every browser fallback fail before a
    // SpeechSynthesis utterance was ever queued.
    const spoke = await legacySpeakJarvisTextV1(clean);
    return spoke;
  } catch (err) {
    console.warn('[Clavis browser voice fallback failed]:', err);
    onSpeechFinished();
    return false;
  }
}

function testJarvisVoice() {
  const honorific = window.UserProfileManager?.getHonorificName?.() || 'Sir';
  speakJarvisText(`Namaste ${honorific}! Main Clavis hoon. Aapki awaaz settings ab test ho rahi hain — sab kuch sahi lag raha hai?`);
}

// Exports
function toggleJarvisVoicePanel(force) {
  if (typeof window.toggleJarvisVoicePanel === 'function' && window.toggleJarvisVoicePanel !== toggleJarvisVoicePanel) {
    return window.toggleJarvisVoicePanel(force);
  }
  const el = document.getElementById('jarvisVoicePanel');
  if (!el) return;
  const isCurrentlyOpen = el.style.display !== 'none' && el.getAttribute('aria-hidden') !== 'true';
  const open = typeof force === 'boolean' ? force : !isCurrentlyOpen;
  el.style.display = open ? '' : 'none';
  el.setAttribute('aria-hidden', open ? 'false' : 'true');
}
if (typeof window.toggleJarvisVoicePanel !== 'function') {
  window.toggleJarvisVoicePanel = toggleJarvisVoicePanel;
}

function toggleCommandPalette(force) {
  const backdrop = document.getElementById('cmd-palette-backdrop');
  const container = document.getElementById('cmd-palette-container');
  if (!backdrop || !container) return;
  const open = typeof force === 'boolean'
    ? force
    : backdrop.style.display === 'none' || !backdrop.style.display;
  if (open) {
    backdrop.style.display = 'block';
    container.style.display = 'flex';
    container.style.pointerEvents = 'auto';
    requestAnimationFrame(() => {
      backdrop.style.opacity = '1';
      container.style.opacity = '1';
      container.style.transform = 'scale(1) translateY(0)';
    });
    document.getElementById('cmd-search-input')?.focus();
  } else {
    closeCommandPalette();
  }
}

function closeCommandPalette() {
  const backdrop = document.getElementById('cmd-palette-backdrop');
  const container = document.getElementById('cmd-palette-container');
  if (!backdrop || !container) return;
  backdrop.style.opacity = '0';
  container.style.opacity = '0';
  container.style.transform = 'scale(0.95) translateY(-10px)';
  setTimeout(() => {
    backdrop.style.display = 'none';
    container.style.display = 'none';
  }, 200);
}
window.closeCommandPalette = closeCommandPalette;

function toggleJarvisSidePanel(forceOpen) {
  const panel = document.getElementById('jarvis-side-panel');
  const backdrop = document.getElementById('jarvis-side-backdrop');
  if (!panel) return;
  const currentlyOpen = !panel.classList.contains('closed');
  const open = typeof forceOpen === 'boolean' ? forceOpen : !currentlyOpen;
  const closed = !open;
  panel.classList.toggle('closed', closed);
  backdrop?.classList.toggle('active', open);
  backdrop?.setAttribute('aria-hidden', String(!open));
  document.getElementById('jarvis-panel-toggle')?.classList.toggle('active', open);
  document.getElementById('jarvis-header-panel-toggle')?.classList.toggle('active', open);
  localStorage.setItem('jarvis_side_closed', String(closed));
  window.dispatchEvent(new CustomEvent('clavis:side-panel-toggle', { detail: { open } }));
}
window.toggleJarvisSidePanel = toggleJarvisSidePanel;


let _jarvisMoreDocClickHandler = null;
let _jarvisMoreEscHandler = null;

function toggleJarvisMoreMenu(force) {
  const menu = document.getElementById('jarvis-more-menu');
  const panel = document.getElementById('jarvis-more-panel');
  const btn = document.getElementById('jarvis-more-btn');
  if (!menu || !panel || !btn) return;

  const isCurrentlyOpen = menu.classList.contains('open') && !panel.hidden && panel.style.display !== 'none';
  const open = typeof force === 'boolean' ? force : !isCurrentlyOpen;

  panel.hidden = !open;
  panel.style.display = open ? 'flex' : 'none';
  menu.classList.toggle('open', open);
  panel.classList.toggle('open', open);
  btn.setAttribute('aria-expanded', String(open));

  if (_jarvisMoreDocClickHandler) {
    document.removeEventListener('click', _jarvisMoreDocClickHandler);
    _jarvisMoreDocClickHandler = null;
  }
  if (_jarvisMoreEscHandler) {
    document.removeEventListener('keydown', _jarvisMoreEscHandler);
    _jarvisMoreEscHandler = null;
  }

  if (open) {
    setTimeout(() => {
      _jarvisMoreDocClickHandler = (e) => {
        if (!menu.contains(e.target) && !panel.contains(e.target)) {
          toggleJarvisMoreMenu(false);
        }
      };
      _jarvisMoreEscHandler = (e) => {
        if (e.key === 'Escape') toggleJarvisMoreMenu(false);
      };
      document.addEventListener('click', _jarvisMoreDocClickHandler);
      document.addEventListener('keydown', _jarvisMoreEscHandler);
    }, 20);
  }
}
window.toggleJarvisMoreMenu = toggleJarvisMoreMenu;

// ══════════════════════════════════════════════════════════
//  CLAVIS COMPANY ENRICHMENT CHAT INTEGRATION
// ══════════════════════════════════════════════════════════
const clavisEnrichmentJobs = new Map();

function escapeEnrHtml(str) {
  return String(str == null ? '' : str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

let clavisComposerAttachments = [];
window.clavisComposerAttachments = clavisComposerAttachments;

function triggerClavisImagePicker() {
  const inp = document.getElementById('clavis-image-upload');
  if (inp) {
    inp.value = '';
    inp.click();
  }
}
window.triggerClavisImagePicker = triggerClavisImagePicker;

async function handleClavisImageUpload(event) {
  const files = event?.target?.files;
  if (!files || !files.length) return;
  for (let i = 0; i < files.length; i++) {
    addClavisScreenshot(files[i]);
  }
}
window.handleClavisImageUpload = handleClavisImageUpload;

function addClavisScreenshot(file) {
  if (!file) return;
  const isImg = (file.type && file.type.startsWith('image/')) || /\.(png|jpe?g|webp|gif|bmp|svg)$/i.test(file.name || '');
  if (!isImg) return;

  const dock = document.getElementById('clavis-composer-attachment-dock');
  if (!dock) return;

  const reader = new FileReader();
  reader.onload = function(e) {
    const dataUrl = e.target.result;
    const cleanName = file.name && file.name !== 'image.png' && file.name !== 'blob'
      ? file.name
      : `Screenshot ${clavisComposerAttachments.length + 1}.png`;
    const sizeKb = (file.size / 1024).toFixed(0);

    const att = {
      id: 'att_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5),
      file: file,
      name: cleanName,
      size: file.size,
      sizeKb: sizeKb,
      dataUrl: dataUrl
    };

    clavisComposerAttachments.push(att);
    window.clavisComposerAttachments = clavisComposerAttachments;

    // Render thumbnail card
    const card = document.createElement('div');
    card.className = 'clavis-att-card';
    card.id = att.id;
    card.innerHTML = `
      <div class="clavis-att-thumb-wrap" title="Click to view full image">
        <img class="clavis-att-thumb" src="${dataUrl}" alt="${escapeEnrHtml(cleanName)}" />
      </div>
      <div class="clavis-att-info">
        <span class="clavis-att-name" title="${escapeEnrHtml(cleanName)}">${escapeEnrHtml(cleanName)}</span>
        <span class="clavis-att-badge"><span class="clavis-att-badge-dot"></span>${sizeKb} KB · Ready</span>
      </div>
      <button type="button" class="clavis-att-close" title="Remove screenshot" aria-label="Remove screenshot">
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
      </button>
    `;

    card.querySelector('.clavis-att-close').addEventListener('click', (ev) => {
      ev.stopPropagation();
      removeClavisScreenshot(att.id);
    });

    card.querySelector('.clavis-att-thumb-wrap').addEventListener('click', () => {
      if (window.ClavisTaskSurface && typeof window.ClavisTaskSurface.openLightbox === 'function') {
        window.ClavisTaskSurface.openLightbox(dataUrl, cleanName);
      }
    });

    dock.appendChild(card);
    dock.classList.add('has-items');

    // Visual haptic/spring feedback on composer
    const composer = document.querySelector('.jarvis-luxury-composer');
    if (composer) {
      composer.classList.add('composer-accepting');
      setTimeout(() => composer.classList.remove('composer-accepting'), 500);
    }

    const input = document.getElementById('jarvis-input');
    if (input) input.focus();
  };
  reader.readAsDataURL(file);
}
window.addClavisScreenshot = addClavisScreenshot;

function removeClavisScreenshot(id) {
  const card = document.getElementById(id);
  if (card) {
    card.classList.add('is-removing');
    setTimeout(() => {
      card.remove();
      clavisComposerAttachments = clavisComposerAttachments.filter(a => a.id !== id);
      window.clavisComposerAttachments = clavisComposerAttachments;
      const dock = document.getElementById('clavis-composer-attachment-dock');
      if (dock && clavisComposerAttachments.length === 0) {
        dock.classList.remove('has-items');
      }
    }, 200);
  } else {
    clavisComposerAttachments = clavisComposerAttachments.filter(a => a.id !== id);
    window.clavisComposerAttachments = clavisComposerAttachments;
  }
}
window.removeClavisScreenshot = removeClavisScreenshot;

function clearClavisScreenshots() {
  clavisComposerAttachments = [];
  window.clavisComposerAttachments = clavisComposerAttachments;
  const dock = document.getElementById('clavis-composer-attachment-dock');
  if (dock) {
    dock.innerHTML = '';
    dock.classList.remove('has-items');
  }
}
window.clearClavisScreenshots = clearClavisScreenshots;

function bindJarvisComposerPaste() {
  const composer = document.querySelector('.jarvis-luxury-composer');
  const input = document.getElementById('jarvis-input');
  const target = input || composer;
  if (target && target.dataset.pasteBound !== 'true') {
    target.dataset.pasteBound = 'true';

    target.addEventListener('paste', (e) => {
      const clip = e.clipboardData || window.clipboardData;
      if (!clip) return;

      const items = clip.items;
      let imagePasted = false;

      if (items && items.length) {
        for (let i = 0; i < items.length; i++) {
          const item = items[i];
          if (item.type && item.type.indexOf('image') !== -1) {
            const blob = item.getAsFile();
            if (blob) {
              e.preventDefault();
              imagePasted = true;
              addClavisScreenshot(blob);
            }
          }
        }
      }

      if (imagePasted && window.showToast) {
        window.showToast('Screenshot attached. Ask Clavis to inspect or analyze it.', 'info');
      }
    });
  }

  // Global window paste handler when Clavis tab is active
  if (!window.__clavisGlobalPasteBound) {
    window.__clavisGlobalPasteBound = true;
    window.addEventListener('paste', (e) => {
      const jarvisView = document.getElementById('view-jarvis');
      if (!jarvisView || jarvisView.classList.contains('hidden') || jarvisView.style.display === 'none') return;
      if (e.target && (e.target.id === 'jarvis-input' || e.target.closest?.('.jarvis-luxury-composer'))) return;
      if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.isContentEditable)) return;

      const clip = e.clipboardData || window.clipboardData;
      if (!clip) return;
      const items = clip.items;
      if (items && items.length) {
        for (let i = 0; i < items.length; i++) {
          const item = items[i];
          if (item.type && item.type.indexOf('image') !== -1) {
            const blob = item.getAsFile();
            if (blob) {
              e.preventDefault();
              addClavisScreenshot(blob);
              if (window.showToast) {
                window.showToast('Screenshot attached. Ask Clavis to inspect or analyze it.', 'info');
              }
              break;
            }
          }
        }
      }
    });
  }
}
window.bindJarvisComposerPaste = bindJarvisComposerPaste;

function triggerJarvisFilePicker() {
  const inp = document.getElementById('jarvis-file-upload');
  if (inp) {
    inp.value = '';
    inp.click();
  }
}
window.triggerJarvisFilePicker = triggerJarvisFilePicker;

async function handleJarvisFileUpload(event) {
  const file = event?.target?.files?.[0];
  if (!file) return;
  await processUploadedCompanyFile(file);
}
window.handleJarvisFileUpload = handleJarvisFileUpload;

function bindJarvisDragAndDrop() {
  const composer = document.querySelector('.jarvis-luxury-composer');
  if (!composer || composer.dataset.dragBound === 'true') return;
  composer.dataset.dragBound = 'true';

  composer.addEventListener('dragover', (e) => {
    e.preventDefault();
    e.stopPropagation();
    composer.classList.add('is-dragover');
  });

  ['dragleave', 'dragend', 'drop'].forEach(evt => {
    composer.addEventListener(evt, (e) => {
      e.preventDefault();
      e.stopPropagation();
      composer.classList.remove('is-dragover');
    });
  });

  composer.addEventListener('drop', async (e) => {
    const files = e.dataTransfer?.files;
    if (files && files.length > 0) {
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        const ext = file.name.split('.').pop().toLowerCase();
        if (['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp', 'svg'].includes(ext) || (file.type && file.type.startsWith('image/'))) {
          addClavisScreenshot(file);
        } else if (['xlsx', 'xls', 'csv'].includes(ext)) {
          await processUploadedCompanyFile(file);
        } else {
          if (window.showToast) window.showToast('Please upload an image or Excel (.xlsx, .csv) file.', 'warning');
        }
      }
    }
  });
}
window.bindJarvisDragAndDrop = bindJarvisDragAndDrop;

async function processUploadedCompanyFile(file) {
  if (!file) return;
  const ext = file.name.split('.').pop().toLowerCase();
  if (['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp', 'svg'].includes(ext) || (file.type && file.type.startsWith('image/'))) {
    addClavisScreenshot(file);
    return;
  }
  if (!window.ClavisEnrichmentEngine) {
    if (window.showToast) window.showToast('Enrichment engine is still initializing. Please try again.', 'warning');
    return;
  }

  // Ensure stage switches to conversation mode
  updateJarvisChatStage(true);

  // Append user bubble
  const fileSizeKb = (file.size / 1024).toFixed(1);
  appendJarvisBubble('user', `📎 <strong>Attached Company List:</strong> ${escapeEnrHtml(file.name)} <span style="font-size:11px;opacity:0.75;">(${fileSizeKb} KB)</span>`);

  showJarvisTyping();

  try {
    const parsed = await window.ClavisEnrichmentEngine.parseFile(file, file.name);
    hideJarvisTyping();

    if (!parsed.totalRows) {
      appendJarvisBubble('assistant', `⚠️ The uploaded file <strong>${escapeEnrHtml(file.name)}</strong> appears to be empty or contains no valid company records.`);
      return;
    }

    const cardId = 'enr_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6);
    const batchCount = Math.ceil(parsed.totalRows / 50);

    clavisEnrichmentJobs.set(cardId, {
      file,
      parsed,
      batchCount,
      enrichedData: null,
      excelBlob: null
    });

    const colChips = [];
    if (parsed.detectedColumns.company) colChips.push(`<span class="enr-col-chip">🏢 Company: <strong>${escapeEnrHtml(parsed.detectedColumns.company)}</strong></span>`);
    if (parsed.detectedColumns.city) colChips.push(`<span class="enr-col-chip">📍 City: <strong>${escapeEnrHtml(parsed.detectedColumns.city)}</strong></span>`);
    if (parsed.detectedColumns.state) colChips.push(`<span class="enr-col-chip">🗺️ State: <strong>${escapeEnrHtml(parsed.detectedColumns.state)}</strong></span>`);
    if (parsed.detectedColumns.industry) colChips.push(`<span class="enr-col-chip">🏭 Industry: <strong>${escapeEnrHtml(parsed.detectedColumns.industry)}</strong></span>`);

    const cardHtml = `
      <div class="clavis-enrichment-card" id="${cardId}">
        <div class="enr-card-header">
          <div class="enr-file-icon">📊</div>
          <div class="enr-file-details">
            <h4>${escapeEnrHtml(file.name)}</h4>
            <p>${parsed.totalRows} Companies Detected · ${batchCount} ${batchCount === 1 ? 'Batch' : 'Batches of 50'}</p>
          </div>
          <span class="enr-batch-badge">${batchCount} ${batchCount === 1 ? 'batch' : 'batches of 50'}</span>
        </div>
        <div class="enr-detected-cols">
          ${colChips.join('')}
        </div>
        <div class="enr-card-body">
          Clavis is ready to run deep contact discovery:
          <ol style="margin:6px 0 0 18px; padding:0; font-size:12px; line-height:1.6;">
            <li>Search each company on <strong>Google Maps</strong> to find official website, phone, address, and ratings.</li>
            <li>Deep-scrape each company's website to extract verified <strong>direct emails, phone numbers, and leadership contacts</strong>.</li>
            <li>Process in reliable <strong>50-row batches</strong> and compile all data into <strong>one single consolidated Excel file</strong>.</li>
          </ol>
        </div>
        <div class="enr-card-actions" id="${cardId}-actions">
          <button class="enr-btn-primary" onclick="startClavisEnrichment('${cardId}')">
            ⚡ Start Deep Enrichment (${batchCount} ${batchCount === 1 ? 'batch' : 'batches of 50'})
          </button>
          <button class="enr-btn-secondary" onclick="previewUploadedCompanies('${cardId}')">
            👁️ Preview First 5 Companies
          </button>
        </div>
      </div>
    `;

    appendJarvisBubble('assistant', cardHtml);

  } catch (err) {
    hideJarvisTyping();
    appendJarvisBubble('assistant', `⚠️ Could not parse <strong>${escapeEnrHtml(file.name)}</strong>: ${escapeEnrHtml(err.message)}`);
  }
}
window.processUploadedCompanyFile = processUploadedCompanyFile;

function previewUploadedCompanies(cardId) {
  const job = clavisEnrichmentJobs.get(cardId);
  if (!job) return;
  const sample = (job.parsed.rows || []).slice(0, 5);
  const rowsHtml = sample.map((r, i) => `
    <tr style="border-bottom:1px solid var(--do-border, #e5e7eb);">
      <td style="padding:6px 8px; font-weight:600;">${i + 1}</td>
      <td style="padding:6px 8px; font-weight:600; color:var(--do-t1,#111);">${escapeEnrHtml(r.company)}</td>
      <td style="padding:6px 8px; color:var(--do-t2,#666);">${escapeEnrHtml(r.city || '—')}</td>
      <td style="padding:6px 8px; color:var(--do-t2,#666);">${escapeEnrHtml(r.state || '—')}</td>
      <td style="padding:6px 8px; color:var(--do-t2,#666);">${escapeEnrHtml(r.industry || 'Corporate')}</td>
    </tr>
  `).join('');

  const previewHtml = `
    <div style="margin:10px 0; background:var(--do-t4, rgba(0,0,0,0.03)); border-radius:8px; padding:10px; overflow-x:auto;">
      <div style="font-size:11px; font-weight:700; text-transform:uppercase; color:var(--do-t3, #9ca3af); margin-bottom:6px;">Sample Preview (First 5 of ${job.parsed.totalRows})</div>
      <table style="width:100%; border-collapse:collapse; font-size:12px;">
        <thead>
          <tr style="border-bottom:1.5px solid var(--do-border, #d1d5db); text-align:left; font-size:11px; color:var(--do-t2, #4b5563);">
            <th style="padding:4px 8px;">#</th>
            <th style="padding:4px 8px;">Company Name</th>
            <th style="padding:4px 8px;">City</th>
            <th style="padding:4px 8px;">State</th>
            <th style="padding:4px 8px;">Industry</th>
          </tr>
        </thead>
        <tbody>
          ${rowsHtml}
        </tbody>
      </table>
    </div>
  `;

  const card = document.getElementById(cardId);
  if (card && !card.querySelector('.enr-sample-table')) {
    const container = document.createElement('div');
    container.className = 'enr-sample-table';
    container.innerHTML = previewHtml;
    const actions = document.getElementById(`${cardId}-actions`);
    if (actions) card.insertBefore(container, actions);
    else card.appendChild(container);
  }
}
window.previewUploadedCompanies = previewUploadedCompanies;

async function startClavisEnrichment(cardId) {
  const job = clavisEnrichmentJobs.get(cardId);
  if (!job) return;

  const card = document.getElementById(cardId);
  const actionsEl = document.getElementById(`${cardId}-actions`);
  if (actionsEl) actionsEl.style.display = 'none';

  let progressWrap = card?.querySelector('.enr-live-progress');
  if (!progressWrap && card) {
    progressWrap = document.createElement('div');
    progressWrap.className = 'enr-live-progress';
    card.appendChild(progressWrap);
  }

  const updateProgressUI = ({ batchIndex, totalBatches, processedCount, totalCount, percent, currentCompany, stats }) => {
    if (!progressWrap) return;
    progressWrap.innerHTML = `
      <div class="enr-progress-wrap">
        <div style="display:flex; justify-content:space-between; align-items:center; font-size:12px; font-weight:600;">
          <span>Batch ${batchIndex} of ${totalBatches} · Processing company ${processedCount}/${totalCount}</span>
          <span style="color:var(--do-blue, #6366f1); font-weight:700;">${percent}%</span>
        </div>
        <div class="enr-progress-bar">
          <div class="enr-progress-fill" style="width:${percent}%;"></div>
        </div>
        ${currentCompany ? `<div style="font-size:11.5px; color:var(--do-t2, #6b7280); overflow:hidden; text-overflow:ellipsis; white-space:nowrap; margin-top:3px;">🏢 Current: <strong>${escapeEnrHtml(currentCompany)}</strong></div>` : ''}
        <div class="enr-stats-row">
          <span class="enr-stats-item">🌐 Websites: <strong>${stats?.websitesFound || 0}</strong></span>
          <span class="enr-stats-item">📞 Phones: <strong>${stats?.phonesFound || 0}</strong></span>
          <span class="enr-stats-item">✉️ Emails: <strong>${stats?.emailsFound || 0}</strong></span>
        </div>
      </div>
    `;
    scrollJarvisToBottom();
  };

  try {
    await window.ClavisEnrichmentEngine.runEnrichmentPipeline({
      parsedData: job.parsed,
      onProgress: (p) => {
        updateProgressUI(p);
      },
      onBatchComplete: (b) => {
        if (window.showToast) {
          window.showToast(`Batch ${b.batchIndex}/${b.totalBatches} completed (${b.totalEnrichedSoFar} leads ready)`, 'info');
        }
      },
      onComplete: (c) => {
        job.enrichedData = c.results;
        job.excelBlob = c.excelBlob;

        if (progressWrap) {
          progressWrap.innerHTML = `
            <div style="background:rgba(16,185,129,0.08); border:1px solid rgba(16,185,129,0.25); border-radius:8px; padding:14px; margin-top:8px;">
              <div style="display:flex; align-items:center; gap:8px; color:#10b981; font-weight:700; font-size:13px;">
                <span>✅</span> Deep Enrichment Complete! (${c.totalRecords} Companies Processed)
              </div>
              <p style="font-size:12px; color:var(--do-t2, #4b5563); margin:6px 0 12px 0;">
                All <strong>${job.batchCount} batches</strong> have been merged into <strong>one single consolidated Excel spreadsheet</strong>. Newly enriched leads have also been synced directly into your Leads Database.
              </p>
              <div class="enr-stats-row" style="margin-bottom:14px;">
                <span class="enr-stats-item">🌐 <strong>${c.stats.websitesFound}</strong> Websites</span>
                <span class="enr-stats-item">📞 <strong>${c.stats.phonesFound}</strong> Phone Numbers</span>
                <span class="enr-stats-item">✉️ <strong>${c.stats.emailsFound}</strong> Verified Emails</span>
              </div>
              <div style="display:flex; gap:8px; flex-wrap:wrap;">
                <button class="enr-btn-primary" onclick="downloadConsolidatedExcel('${cardId}')">
                  📥 Download Consolidated Excel (.xlsx)
                </button>
                <button class="enr-btn-secondary" onclick="showView('leads')">
                  👥 View in Leads Database (${c.totalRecords})
                </button>
              </div>
            </div>
          `;
        }

        if (window.showToast) {
          window.showToast('✅ All Batches Enriched & Exported to Single Excel!', 'success');
        }
      },
      onError: (err) => {
        if (progressWrap) {
          progressWrap.innerHTML = `
            <div style="color:#ef4444; font-size:12px; padding:10px; background:rgba(239,68,68,0.1); border-radius:6px;">
              ⚠️ Enrichment stopped: ${escapeEnrHtml(err.message)}
            </div>
          `;
        }
      }
    });

  } catch (err) {
    console.error('startClavisEnrichment error:', err);
  }
}
window.startClavisEnrichment = startClavisEnrichment;

function downloadConsolidatedExcel(cardId) {
  const job = clavisEnrichmentJobs.get(cardId);
  if (!job || !job.enrichedData) return;
  window.ClavisEnrichmentEngine.generateConsolidatedExcel(job.enrichedData, job.file.name);
}
window.downloadConsolidatedExcel = downloadConsolidatedExcel;


function bindJarvisUIButtons() {
  /* One wire per button.

     `removeEventListener` was being handed a brand-new arrow every call,
     so it removed nothing: this function runs once on load and again from
     initJarvisUI(), and every extra run stacked another listener on top of
     the onclick="…" the markup already carries. Each click then ran the
     handler three or four times. For an idempotent handler that is merely
     wasteful; for a toggle it is fatal — an even number of calls opens and
     closes the More menu inside one click, which is why pressing it did
     nothing. New Chat was clearing the thread three times over.

     So: if the markup already wires the button, leave it alone. Otherwise
     keep the handler on the element itself, which is a reference we can
     actually remove next time. */
  const attach = (selector, handler) => {
    document.querySelectorAll(selector).forEach(el => {
      if (el.hasAttribute('onclick')) return;
      if (el.__jarvisClick) el.removeEventListener('click', el.__jarvisClick);
      el.__jarvisClick = handler;
      el.addEventListener('click', handler);
    });
  };

  // Top header actions
  attach('#jarvis-handsfree-btn', () => toggleJarvisHandsFree());
  attach('#jarvis-sound-trigger-btn', () => toggleClavisSoundTriggers());
  attach('#jarvis-speak-toggle', () => toggleJarvisSpeech());
  attach('.jarvis-newchat-pill', () => newJarvisChat());
  attach('#jarvis-more-btn', (e) => { e.stopPropagation(); toggleJarvisMoreMenu(); });

  // Dropdown items
  attach('#jarvis-history-pill', () => { window.ChatHistory?.open?.(); toggleJarvisMoreMenu(false); });
  attach('#jarvis-panel-toggle', () => { toggleJarvisSidePanel(); toggleJarvisMoreMenu(false); });
  attach('#jarvis-voice-config-btn', () => { toggleJarvisVoicePanel(); toggleJarvisMoreMenu(false); });
  attach('#jarvis-ai-config-btn', () => { openKeySettings(); toggleJarvisMoreMenu(false); });

  // Center stage & composer
  attach('#jarvis-voice-btn', () => startJarvisVoiceInput());
  attach('#jarvis-composer-voice-btn', () => startJarvisVoiceInput());
  attach('#jarvis-composer-attach-btn', () => triggerJarvisFilePicker());
  attach('#jarvis-send-btn', () => handleJarvisSend());
  attach('#jarvis-stop-btn', () => stopJarvisGeneration());

  // Side panel close & actions
  attach('#jarvis-side-close-btn', (e) => { e.stopPropagation(); toggleJarvisSidePanel(false); });
  attach('#jarvis-side-backdrop', () => toggleJarvisSidePanel(false));
  attach('#jarvis-manage-memory-btn', () => openJarvisMemoryPanel());
  attach('#qa-lead-overview-btn', () => sendQuickJarvis('Leads ka overview do'));
  attach('#qa-call-script-btn', () => openJarvisScriptModal());
  attach('#qa-clear-chat-btn', () => clearJarvisChat());

  // Bind drag and drop & screenshot paste
  bindJarvisDragAndDrop();
  bindJarvisComposerPaste();
}
window.bindJarvisUIButtons = bindJarvisUIButtons;

// Ensure bound on load
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', bindJarvisUIButtons);
} else {
  bindJarvisUIButtons();
}
