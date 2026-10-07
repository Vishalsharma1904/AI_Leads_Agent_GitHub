/**
 * ============================================================
 *  RUDRA24 AI UI CONTROLLER (jarvis_ui.js)
 *  Wires the Rudra24 AI view to the existing compatibility APIs.
 *  - Chat rendering, Gemini voice input/output, spoken replies
 *  - Call script generator modal
 *  - Long-term memory panel
 * ============================================================
 */

'use strict';

// HTTP 429 can mean a daily allowance, and 503 is a service failure.
// Do not invent a minute-long reset time when the server did not give one.
function clavisAIErrorFeedback(err) {
  const message = String(err.message || '');
  const daily = /daily|per day|\(tpd\)|\(rpd\)|aaj ki.*limit/i.test(message);
  if (err.code === 'AI_PROVIDER_DAILY_LIMIT') return {busy:false,title:'Provider daily limit reached',message:'Your connected provider has reached its daily allowance. Check the provider dashboard in Setup.',spoken:'Connected AI provider ki daily limit poori ho gayi hai.'};
  const quota = /monthly|per month|out of credit|insufficient.*credit|billing|quota exhausted/i.test(message);
  if (daily) return { busy: false, title: 'Daily AI limit reached', message: 'Your daily AI allowance is used up. Check Usage & Limits for your allowance.', spoken: 'Aaj ki AI limit poori ho gayi hai. Usage aur Limits mein check kijiye.' };
  if (quota) return { busy: false, title: 'AI provider quota reached', message: 'Check your connected provider\'s quota or credits in Setup.', spoken: 'AI provider ki quota ya credits check kijiye.' };
  const busy = err.code === 'AI_BUSY' || err.code === 'AI_RATE_LIMITED' || err.status === 429 || /rate limit|per minute|high demand|cooling down/i.test(message);
  if (busy) return { busy: true, title: 'AI provider limit reached', message: 'The provider is limiting requests. Try again later, or check your connected providers in Setup.', spoken: 'AI provider ki limit aa gayi hai. Thodi der baad koshish kijiye, ya Setup mein provider check kijiye.' };
  if (err.status === 503) return { busy: false, title: 'AI service unavailable', message: message || 'The AI service is unavailable. Please try again later.', spoken: 'AI service abhi available nahi hai. Thodi der baad koshish kijiye.' };
  return { busy: false, title: 'Rudra24 AI could not reply', message: message || 'Please try again.', spoken: 'Is baar jawab nahi aa paaya. Ek baar phir boliye?' };
}

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
let wakeRecognition = null;       // background recognizer listening for Rudra24 AI wake phrases
let commandRecognition = null;    // active recognizer capturing a command after wake
let jarvisAwake = false;          // sirf ClavisWake ka local mirror — khud true mat karo, clavisWakeUp() use karo
let relistenTimer = null;
let jarvisVoiceSession = 0;
let wakeRestartTimer = null;
let wakeStopRequested = false;
let clavisSoundTriggerBound = false;

// ── Jaaga hai ya soya: ClavisWake hi single source of truth ────────
// Pehle jarvisAwake bina expiry ke true reh jaata tha, aur kamre ki har
// baat LLM tak jaati thi (keys ek ghante me khatam). Ab:
//   soya  → sirf wake word / snap / clap / tap / typing se jaagta hai
//   jaaga → command lo, jawab do, phir ~9 s follow-up, phir wapas soya
const CLAVIS_ASLEEP_LABEL = 'Bolo "Rudra"';
function clavisIsAwake() {
  const W = window.ClavisWake;
  return W ? W.isAwake() : jarvisAwake;
}
// Naam / snap / clap / tap ke baad pehla voice turn = command (koi bhi baat
// chalegi). Uske baad ke turns follow-up hain: sirf request / sawaal / naam /
// Voice ID owner. Typing ke baad bhi voice = follow-up.
let clavisFreshWake = false;
function clavisWakeUp(source, opts) {
  window.ClavisWake?.wake?.(source || 'word', opts || {});
  jarvisAwake = true;
  clavisFreshWake = source !== 'typed';
  clavisFollowUpUntil = 0;   // naya wake = command window, follow-up nahi
  if (source !== 'typed') window.StrandsOrb?.instance?.pulse?.();
}
function clavisOpenMic() {
  return clavisIsAwake() && !clavisFreshWake;
}
// Ek accepted turn ke dauraan Rudra24 AI busy rehta hai (window expire nahi
// hoti); jawab bol chuka → busy(false) → follow-up window shuru.
let clavisTurnHeld = false;
function clavisHoldTurn() {
  if (!window.ClavisWake) return;
  clavisTurnHeld = true;
  window.ClavisWake.busy(true, 'turn');
}
function clavisReleaseTurn() {
  if (!clavisTurnHeld) return;
  clavisTurnHeld = false;
  window.ClavisWake?.busy?.(false, 'turn');
}
// Bolte waqt window expire na ho — lekin sirf tab jab pehle se jaaga ho
// (proactive / boot ki awaaz soye hue Rudra24 AI ko nahi jagati).
let clavisSpeechHeld = false;
function clavisHoldSpeech() {
  if (!window.ClavisWake || clavisSpeechHeld || !clavisIsAwake()) return;
  clavisSpeechHeld = true;
  window.ClavisWake.busy(true, 'speech');
}
function clavisReleaseSpeech() {
  if (!clavisSpeechHeld) return;
  clavisSpeechHeld = false;
  window.ClavisWake?.busy?.(false, 'speech');
}
// clavis-task-controller.js / clavis-luxe.js window.jarvisHandsFree padhte hain.
try {
  Object.defineProperty(window, 'jarvisHandsFree', {
    configurable: true,
    get: () => jarvisHandsFree,
    set: (v) => { jarvisHandsFree = Boolean(v); },
  });
} catch (_) {}

async function refreshClavisConnectionStatus() {
  // A local (bring-your-own) key is enough — no backend needed.
  if (window.ClavisDirect?.hasKey?.()) { setJarvisStatus('online', 'Rudra24 AI Ready'); return; }
  const aiProviders = new Set(['openrouter', 'gemini', 'groq', 'openai', 'deepseek', 'mistral', 'together', 'fireworks', 'xai', 'cerebras', 'perplexity']);
  try {
    const result = await window.NexusAIChat?.getCredentials?.();
    const configured = (result?.credentials || []).some(item => item.configured && aiProviders.has(item.provider));
        setJarvisStatus(configured ? 'online' : 'offline', configured ? 'Rudra24 AI Ready' : 'Needs setup');
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
      showToast({ type: 'warning', title: 'Open Rudra24 AI in browser mode', message: 'Microphone access needs http://localhost:3000. The file:// page cannot keep this permission.' });
      return;
    }
    const permission = await navigator.permissions?.query?.({ name: 'microphone' });
    if (permission?.state === 'granted') {
      localStorage.setItem('clavis_mic_permission_granted', 'true');
      window.dispatchEvent(new CustomEvent('clavis:mic-granted'));
      return;
    }
    if (permission?.state === 'denied') {
      showToast({ type: 'warning', title: 'Microphone blocked', message: location.port === '3210'
        ? 'Windows Settings → Privacy & security → Microphone me desktop app access on karke retry kijiye.'
        : 'Address bar ke left icon par click karke Microphone → Allow kijiye, phir yahan retry kijiye.' });
      return;
    }
    if (window.LocalSpeechEngine?.acquireSharedMicrophone) await window.LocalSpeechEngine.acquireSharedMicrophone();
    else {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach((t) => t.stop());
    }
    localStorage.setItem('clavis_mic_permission_granted', 'true');
    window.dispatchEvent(new CustomEvent('clavis:mic-granted'));
    showToast({ type: 'success', title: 'Mic on', message: 'Snap, clap or say "Rudra" — main sun raha hoon.' });
  } catch (_) {
    showToast({ type: 'warning', title: 'Microphone blocked', message: location.port === '3210'
      ? 'Windows Settings → Privacy & security → Microphone me desktop app access on karke retry kijiye.'
      : 'Address bar ke left wale icon par click karke Microphone → Allow kijiye, phir page reload kijiye.' });
  }
}
window.clavisMicPillClicked = clavisMicPillClicked;

async function requestClavisMicrophoneOnce() {
  if (!window.ClavisVoiceState?.isClavisWorkspace?.()) return false;
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
    console.info('[Rudra24 AI] Microphone permission not granted:', error?.name || 'unknown');
    return false;
  }
}

async function initJarvisUI() {
  const input = document.getElementById('jarvis-input');
  if (input) {
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey && !e.isComposing && e.keyCode !== 229) {
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

  // Bind screenshot paste handler (Ctrl+V anywhere in Rudra24 AI view)
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
  renderClavisBrainState();   // show "connect a free AI key" card if Rudra24 AI has no brain yet
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

  // Hands-free is ON by default (user request): Rudra24 AI is live the moment the
  // app opens. It stays on until the user explicitly turns it off - the stored
  // value is only consulted to honour an explicit 'false'.
  jarvisHandsFree = localStorage.getItem('clavis_mic_permission_granted') === 'true'
    && localStorage.getItem('jarvis_hands_free') !== 'false';
  const hfBtn = document.getElementById('jarvis-handsfree-btn');
  if (hfBtn) {
    hfBtn.classList.toggle('active', jarvisHandsFree);
    hfBtn.setAttribute('aria-pressed', String(jarvisHandsFree));
  }

  jarvisSpeechEnabled = localStorage.getItem('jarvis_speech_enabled') !== 'false'
    && localStorage.getItem('clavis_voice_muted') !== '1';
  CLAVIS_VS.setVoiceOutputEnabled(jarvisSpeechEnabled, 'restore speech preference');
  updateJarvisSpeechIcon();

  // Just checks Gemini is configured; there is no local model to warm up.
  window.LocalSpeechEngine?.health?.().catch(() => {});

  // Start listening: Hands-free and Snap/Clap sound triggers are ON by default!
  const activateAudioAndSensors = () => {
    if (!CLAVIS_VS.isClavisWorkspace()) return;
    if (localStorage.getItem('clavis_mic_permission_granted') !== 'true') return;
    if (localStorage.getItem('clavis_sound_trigger_enabled') !== 'false') {
      startClavisSoundTriggers();
    }
    if (jarvisHandsFree) {
      startWakeListener();
      setJarvisStatus('listening', 'Sun raha hoon — bolo "Rudra"');
    }
    if (window.ClavisAudioTrigger?.context?.state === 'suspended') {
      window.ClavisAudioTrigger.context.resume().catch(() => {});
    }
  };

  setTimeout(activateAudioAndSensors, 500);

  window.addEventListener('clavis:mic-granted', () => {
    localStorage.setItem('clavis_mic_permission_granted', 'true');
    jarvisHandsFree = localStorage.getItem('jarvis_hands_free') !== 'false';
    if (localStorage.getItem('jarvis_hands_free') === null) localStorage.setItem('jarvis_hands_free', 'true');
    if (localStorage.getItem('clavis_sound_trigger_enabled') === null) localStorage.setItem('clavis_sound_trigger_enabled', 'true');
    const handsFreeButton = document.getElementById('jarvis-handsfree-btn');
    handsFreeButton?.classList.toggle('active', jarvisHandsFree);
    handsFreeButton?.setAttribute('aria-pressed', String(jarvisHandsFree));
    updateClavisSoundTriggerButton(localStorage.getItem('clavis_sound_trigger_enabled') !== 'false');
    setJarvisStatus(window.currentJarvisStatus || 'online', window.currentJarvisStatus === 'listening' ? 'Sun raha hoon — bolo "Rudra"' : 'Mic ready · voice controls restored');
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
    setJarvisStatus('online', 'Rudra24 AI Online');
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

// ── Interactive Orb Click Handler (interrupt only) ──
// The orb used to also START listening on click, but it's a huge hit
// target — an incidental click near it woke Rudra24 AI unasked. Owner wants
// wake to come only from clap/snap/name, never a click. The dedicated
// mic buttons (#jarvis-voice-btn, #jarvis-composer-voice-btn) still start
// voice input on purpose; the orb now only interrupts while it's talking.
function handleOrbClick() {
  if (isJarvisSpeaking) {
    stopJarvisGeneration();
  }
}
window.handleOrbClick = handleOrbClick;

// ── Rudra24 AI Dynamic Stage: Orb stays full-size & centered; output routes to floating surface ──
function updateJarvisChatStage(hasMessages) {
  const view = document.getElementById('view-jarvis');
  const stage = document.querySelector('.jarvis-hero-stage');
  const welcome = document.getElementById('jarvis-welcome');
  
  // Rudra24 AI tab: Orb and welcome stay permanently visible and full-sized.
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
  { icon: '⚡', text: 'Say "Rudra" anytime hands-free' },
  { icon: '📞', text: 'Bolo: "Generate high-converting call script"' },
  { icon: '💬', text: 'Ask: "Draft WhatsApp follow-up for leads"' },
  { icon: '⌨️', text: 'Press Ctrl + \\ to toggle memory & tools' },
  { icon: '✨', text: 'Use the mic or wake word to start speaking' },
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
  
  if (clearBtn && clearBtn.style.display !== (hasText ? 'inline-flex' : 'none')) clearBtn.style.display = hasText ? 'inline-flex' : 'none';
  if (activeDot && activeDot.style.display !== (hasText ? 'block' : 'none')) activeDot.style.display = hasText ? 'block' : 'none';
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
  setJarvisStatus('online', 'Rudra24 AI Online');
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
// Shared sizing measures an offscreen mirror and preserves growth easing.
function autoGrowJarvisInput() {
  const el = document.getElementById('jarvis-input');
  window.ClavisComposerSizing?.request(el);
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
      <span style="font-size:13px;color:var(--gray-600);font-weight:500;">Rudra24 AI is thinking</span>
      <div class="typing-dot"></div><div class="typing-dot"></div><div class="typing-dot"></div>
    </div>`;
  container.appendChild(typing);
  scrollJarvisToBottom();
}

function hideJarvisTyping() {
  document.getElementById('jarvis-typing-indicator')?.remove();
}

// ── Rudra24 AI "brain" (AI key) onboarding ────────────────────────────────────
// Without an LLM key Rudra24 AI literally cannot reply — this makes that state
// obvious and fixable in one paste, instead of a silent/cryptic failure.
function renderClavisBrainState() {
  const welcome = document.getElementById('jarvis-welcome');
  const has = window.JarvisEngine?.hasBrain?.() ?? true;
  const existing = document.getElementById('clavis-brain-card');
  if (has) { existing?.remove(); return; }
  if (existing || !welcome) return;
  const card = document.createElement('button');
  card.type = 'button';
  card.id = 'clavis-brain-card';
  card.className = 'cx-brain-card';
  card.innerHTML = `<span class="cx-brain-dot" aria-hidden="true"></span>
    <span class="cx-brain-text"><b>Rudra24 AI ko jagane ke liye ek free key chahiye</b><small>2 minute ka setup — link, paste, ho gaya.</small></span>
    <span class="cx-brain-cta">Setup karein</span>`;
  card.addEventListener('click', saveClavisBrainKey);
  welcome.appendChild(card);
}

// Key judte hi card hata do.
['clavis:keys-ready', 'clavis:vault-changed'].forEach((ev) => window.addEventListener(ev, () => setTimeout(renderClavisBrainState, 50)));

function saveClavisBrainKey() {
  if (window.ClavisSetup?.open) return window.ClavisSetup.open({ reason: 'manual' });
  openClavisCredentialDialog();
}
window.saveClavisBrainKey = saveClavisBrainKey;
window.renderClavisBrainState = renderClavisBrainState;

let clavisCredentialPreviousFocus = null;

const CLAVIS_PROVIDER_UI = {
  groq: { label: 'Groq API key', link: 'https://console.groq.com/keys', linkText: 'Get a free key from Groq', placeholder: 'gsk_...' },
  gemini: { label: 'Google AI Studio API key', link: 'https://aistudio.google.com/app/apikey', linkText: 'Get a key from Google AI Studio (ai.google.dev)', placeholder: 'AIza...' },
  fish_audio: { label: 'Fish Audio API key', link: 'https://fish.audio/app/api-keys/', linkText: 'Get a Fish Audio API key', placeholder: 'Paste your Fish Audio key', voiceOnly: true },
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
  const desc = document.getElementById('clavis-credential-desc');
  if (link) {
    link.href = meta.link;
    link.innerHTML = `${meta.linkText} <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="display:inline-block;vertical-align:middle;margin-left:4px;"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path><polyline points="15 3 21 3 21 9"></polyline><line x1="10" y1="14" x2="21" y2="3"></line></svg>`;
  }
  if (label) label.textContent = meta.label;
  if (input) input.placeholder = meta.placeholder;
  if (desc && meta.voiceOnly) desc.textContent = 'Fish Audio is for speech only (voice output and batch transcription). Connect a text AI provider too if you want generated assistant replies.';
  else if (desc) desc.textContent = 'Choose a provider and paste its key. Your key is verified and stored locally in this browser only — no login, no server. It never leaves your device except to call that provider directly.';
}

// Which provider(s) are connected right now, which one is active, and how
// much has been used — reuses MemoryEngine's existing token counter instead
// of adding new tracking. ponytail: token count only, not per-provider cost
// breakdown — add that if the user asks to see spend by provider.
function updateClavisConnectionStatus() {
  const el = document.getElementById('clavis-connection-status');
  if (!el || !window.ClavisDirect) return;
  const configured = window.ClavisDirect.configuredProviders();
  if (window.ClavisDirect.keyFor('fish_audio')) configured.push('fish_audio');
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
  dialog.__rudraMotionTicket = (dialog.__rudraMotionTicket || 0) + 1;
  dialog.__rudraAnimation?.cancel?.();
  dialog.__rudraAnimation = window.RudraMotionUI?.surface(dialog.querySelector('.clavis-credential-card'), true, .72);
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
  if (dialog.hidden) return;
  const ticket = dialog.__rudraMotionTicket = (dialog.__rudraMotionTicket || 0) + 1;
  dialog.__rudraAnimation?.cancel?.();
  const finish = () => {
    if (ticket !== dialog.__rudraMotionTicket) return;
    dialog.hidden = true;
    dialog.setAttribute('aria-hidden', 'true');
    document.body.classList.remove('clavis-modal-open');
    if (error) { error.hidden = true; error.textContent = ''; }
    if (clavisCredentialPreviousFocus?.focus) clavisCredentialPreviousFocus.focus();
    clavisCredentialPreviousFocus = null;
  };
  dialog.__rudraAnimation = window.RudraMotionUI?.surface(dialog.querySelector('.clavis-credential-card'), false, .48);
  if (dialog.__rudraAnimation) dialog.__rudraAnimation.finished.then(finish, finish); else finish();
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
    : provider === 'gemini' ? /^(?:AIza|AQ\.)\S{10,}$/.test(key)
    : provider === 'openai' ? /^sk-\S{10,}$/.test(key)
    : provider === 'fish_audio' ? /^\S{12,}$/.test(key)
    : /^\S{10,}$/.test(key);
  if (!valid) {
    if (error) { error.hidden = false; error.textContent = provider === 'fish_audio' ? 'Enter a Fish Audio API key (at least 12 characters, no spaces).' : `Enter a valid ${CLAVIS_PROVIDER_UI[provider]?.label || 'provider'} starting with the expected prefix.`; }
    input?.focus();
    return;
  }
  if (submit) { submit.disabled = true; submit.textContent = 'Verifying...'; }
  try {
    await window.ClavisKeyVault.add(provider, key);
    if (provider !== 'fish_audio') localStorage.setItem('clavis_ai_provider', provider);
    if (input) input.value = '';
    closeClavisCredentialDialog();
    document.getElementById('clavis-brain-card')?.remove();
    renderClavisBrainState();
    setJarvisStatus('online', 'Rudra24 AI Ready');
    showToast('success', 'Rudra24 AI connected', 'API key stored in your encrypted server vault.');
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
// Rudra24 AI answers out loud. The floating window opens only when there is
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
  if (window.ClavisVoiceState?.isSilent?.()) return true;   // silent mode: the answer is read, not heard
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

// Side-talk token: jab LLM ko lage ki baat Rudra24 AI se thi hi nahi (sir kisi
// aur se baat kar rahe the / TV), woh sirf `[[silent]]` lautata hai.
const CLAVIS_SILENT_TOKEN_RE = /\[\[\s*silent\s*\]\]/gi;
const CLAVIS_SILENT_HEAD_RE = /^\s*\[\[\s*silent\s*\]\]/i;
// Every [[…]] directive (and a stray leading "[[" / trailing "]]") is removed
// from anything shown or spoken — see ClavisVoiceState.stripDirectives.
function clavisStripSilent(text) {
  return window.ClavisVoiceState?.stripDirectives
    ? window.ClavisVoiceState.stripDirectives(text)
    : String(text || '').replace(CLAVIS_SILENT_TOKEN_RE, '').replace(/[ \t]{2,}/g, ' ').trim();
}
window.clavisStripSilent = clavisStripSilent;

// Overheard baat par chup: koi bubble nahi, koi awaaz nahi, task hata do, so jao.
function clavisSideTalk(taskId, text, turnStartedAt) {
  try {
    const T = window.ClavisTask;
    if (T) {
      if (taskId) T.clear(taskId);
      // JarvisEngine wrapper (clavis-task-controller) apna alag task bhi banata hai.
      (T.Store?.all?.() || []).forEach((t) => {
        if (t && t._text === text && (t.startedAt || 0) >= turnStartedAt - 50) T.clear(t.id);
      });
    }
  } catch (e) { console.warn('[Rudra24 AI side-talk] task clear failed', e); }
  try { window.JarvisEngine?.forgetLastTurn?.(); } catch (_) {}
  try { window.ClavisEar?.caption?.clear?.(); } catch (_) {}
  if (window.ClavisWake?.continuous?.() && window.ClavisWake.state().source !== 'typed') {
    // Continuous conversation: side talk is ignored, the session goes on.
    console.info('[ClavisWake] side-talk — ignored, still listening:', text);
    window.ClavisVoiceState?.rest?.('side talk');
    return;
  }
  console.info('[ClavisWake] side-talk — not for Rudra24 AI, going back to sleep:', text);
  window.ClavisWake?.sleep?.('side-talk');
  setJarvisStatus('idle', CLAVIS_ASLEEP_LABEL);
}

let clavisTurnSeq = 0;
async function handleJarvisSend(options) {
  const isVoice = Boolean(options && typeof options === 'object' && options.source === 'voice');
  const W = window.ClavisWake;
  if (W) {
    if (isVoice) {
      // Backstop: soye hue Rudra24 AI tak koi voice turn nahi pahunchna chahiye.
      if (!W.isAwake()) {
        console.info('[ClavisWake] voice turn dropped (asleep):', options && options.text);
        return;
      }
    } else {
      const draft = (typeof options === 'string' ? options : (options && options.text) || document.getElementById('jarvis-input')?.value || '').trim();
      const hasAtt = Boolean((options && (options.attachments?.length || options.images?.length)) || window.clavisComposerAttachments?.length);
      if (!draft && !hasAtt) return;
      clavisWakeUp('typed');
    }
  }
  clavisTurnSeq++;
  clavisHoldTurn();
  const VS = window.ClavisVoiceState;
  if (isVoice) VS?.mark?.('dispatch');
  VS?.set?.('PROCESSING', isVoice ? 'voice turn' : 'typed turn');
  try {
    return await clavisHandleSendCore(options);
  } finally {
    // Bol raha ho to 'speech' hold window ko zinda rakhta hai; turn ka hold
    // hamesha yahin chhootta hai — koi path busy me atka nahi reh sakta.
    clavisReleaseTurn();
    if (VS && !isJarvisSpeaking && /^(PROCESSING|EXECUTING)$/.test(VS.state())) VS.rest('turn done');
  }
}

async function clavisHandleSendCore(options) {
  const turnStartedAt = Date.now();
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

  const answerOnly = Boolean(options?.answerOnly || window.ClavisRequestIntent?.classify(text).answerOnly);
  const appGuidance = Boolean(options?.guideTopicIds?.length || window.ClavisAppMap?.guide?.isQuestion(text));
  const elaborate = Boolean(options?.elaborate);
  window.__clavisLastUserText = text;   // the voice's mood follows his (ClavisVoice)
  try { window.ClavisIntent?.learn?.(text); } catch (_) {}

  // Active turn operation to prevent race conditions and stale overwrites (TEST 9)
  const VS = window.ClavisVoiceState;
  const op = VS?.createOperation ? VS.createOperation('turn', { source: requestSource, text }) : null;
  if (jarvisController && !jarvisController.signal?.aborted) {
    try { jarvisController.abort('superceded'); } catch (_) {}
  }

  // ── The few words he says most: "map band karo", "close everything",
  //    "band karo", "zoom in", "ladke ki awaaz me bolo" — instant and local,
  //    before the STOP rule (which used to swallow "map band karo") and the AI.
  if (!answerOnly && !attachments.length && !images.length) {
    try {
      const quick = await window.ClavisIntent?.route?.(text, { source: requestSource });
      if (op && VS && !VS.isOperationCurrent(op.id)) return;
      if (quick && quick.handled) {
        // Typed commands get a small visible confirmation too (this page
        // shows no chat bubbles); spoken ones stay voice-only.
        if (requestSource !== 'voice' && (quick.spoken || quick.text)) {
          try { showToast('success', 'Rudra', String(quick.text || quick.spoken)); } catch (_) {}
        }
        if (quick.spoken) {
          window.ClavisMind?.noteClavisTurn?.(quick.spoken);
          if (jarvisSpeechEnabled && !quick.silent) speakJarvisText(quick.spoken, { style: quick.style });
          else setJarvisStatus('online', 'Rudra24 AI Online');
        } else {
          setJarvisStatus('online', 'Rudra24 AI Online');
        }
        if (jarvisHandsFree) scheduleHandsFreeRelisten();
        return;
      }
    } catch (e) { console.warn('Rudra24 AI intent route failed:', e); }
  }

  // ── App first: tabs, top-bar buttons, Settings sections, floating windows,
  //    mute / mic (clavis-app-map.js). "candidate tab kholo" opens the tab —
  //    only "PC me …" / "MS Excel" / a website goes on to the PC below.
  //    "A aur B": app/map parts run now; a leftover part goes on as `text`.
  if (!answerOnly && !attachments.length && !images.length && window.ClavisAppMap?.handle) {
    try {
      const app = await window.ClavisAppMap.handle(text);
      if (op && VS && !VS.isOperationCurrent(op.id)) return;
      if (app && app.handled) {
        if (requestSource !== 'voice' && app.spoken) {
          try { showToast('success', 'Rudra', String(app.spoken)); } catch (_) {}
        }
        if (!app.rest) {
          if (app.spoken) {
            window.ClavisMind?.noteClavisTurn?.(app.spoken);
            if (jarvisSpeechEnabled) speakJarvisText(app.spoken);
            else setJarvisStatus('online', 'Rudra24 AI Online');
          } else setJarvisStatus('online', 'Rudra24 AI Online');
          if (jarvisHandsFree) scheduleHandsFreeRelisten();
          return;
        }
        text = app.rest;   // the rest of a compound command → normal pipeline
      }
    } catch (e) { console.warn('Rudra24 AI app map failed:', e); }
  }

  // ── "Shut up" / "chup" — silence Rudra24 AI instantly, don't echo or call AI. ──
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
  clavisSetDisplay(taskId, (answerOnly && requestSource !== 'voice') || clavisWantsWindow(text, { attachments: attachments.length, images: images.length }) ? 'window' : 'voice');
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
    const cmd = answerOnly ? null : await window.ClavisCommands?.route(text);
    if (op && VS && !VS.isOperationCurrent(op.id)) return;
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
        else setJarvisStatus('online', 'Rudra24 AI Online');
      } else {
        setJarvisStatus('online', 'Rudra24 AI Online');
      }
      if (jarvisHandsFree) scheduleHandsFreeRelisten();
      return;
    }
  } catch (e) { console.warn('Rudra24 AI command route failed:', e); }

  // ── Lead / candidate searches go straight into the real pipeline ──
  // (deterministic plan, no LLM round trip, so no rate limit and no invented
  // rows). Its live progress is exactly what the window is for.
  try {
    const plan = window.LeadCandidateDomain?.parseRequest?.(text);
    if (!answerOnly && plan?.isSearch && !images.length && !attachments.length && window.ChatEngine?.sendMessage
        // About leads he already HAS (report / summary / count / analysis)
        // is a question for the brain's lead tools, not a new scrape.
        && !/\b(export|download|sync|show|list|stats?|report|summary|summari\w*|analy\w*|kitni|kitne|count|total|breakdown|status|saved|purani|existing)\b/i.test(text)) {
      clavisSetDisplay(taskId, 'window');
      clavisReveal(taskId);
      setJarvisStatus('executing', 'Starting the lead search...');
      const resp = await window.ChatEngine.sendMessage(text);
      if (op && VS && !VS.isOperationCurrent(op.id)) return;
      const line = String(resp?.text || '').replace(CLAVIS_EMOJI_RE, '').replace(/[*_#`]/g, '').trim();
      if (line) {
        window.ClavisMind?.noteClavisTurn?.(line);
        if (jarvisSpeechEnabled) speakJarvisText(clavisSpokenSummary(line));
      }
      if (jarvisHandsFree) scheduleHandsFreeRelisten();
      return;
    }
  } catch (e) { console.warn('Rudra24 AI lead fast-path failed, using the AI path:', e); }

  // Check AI brain availability
  if (!appGuidance && window.JarvisEngine && !window.JarvisEngine.hasBrain()) {
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
      setJarvisStatus('online', 'Rudra24 AI local mode');
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
  setJarvisStatus('thinking', 'Rudra24 AI is processing...');

  const stopBtn = document.getElementById('jarvis-stop-btn');
  const sendBtn = document.getElementById('jarvis-send-btn');
  if (stopBtn) stopBtn.style.display = 'flex';
  if (sendBtn) sendBtn.style.display = 'none';

  jarvisController = new AbortController();
  const turnController = jarvisController;
  if (op?.signal) {
    op.signal.addEventListener('abort', () => {
      try { turnController.abort(op.signal.reason); } catch (_) {}
    }, { once: true });
  }

  const turnSignal = jarvisController.signal;   // aborted by barge-in / "chup" / a newer turn
  const clavisStream = clavisStreamSpeaker(turnSignal);
  const onStep = (step) => {
    clavisToolAck(step, requestSource, () => clavisStream.spoke);
    if (taskId && window.ClavisTask) {
      if (step.type === 'tool_start') {
        window.ClavisTask.toolStart(taskId, step.skill || 'tool', step.detail || '');
      } else if (step.type === 'tool_result') {
        window.ClavisTask.toolResult(taskId, step.skill || 'tool', step.outcome);
      } else if (step.type === 'text_preview' && clavisDisplayOf(taskId) === 'window') {
        window.ClavisTask.event(taskId, { type: 'writing', label: step.text });
      }
    }
  };

  // `[[silent]]` kabhi bola na jaaye: shuru ke chars tab tak roko jab tak
  // pakka na ho ki yeh token nahi hai.
  let deltaHead = '';
  let deltaDecided = false;
  let silentReply = false;
  let writingPreview = '';
  const onTextDelta = async (rawDelta) => {
    if (appGuidance) return; // Full written reply follows; voice reads its short highlight once.
    let delta = String(rawDelta || '');
    if (!deltaDecided) {
      deltaHead += delta;
      const head = deltaHead.trimStart().toLowerCase();
      if ('[[silent]]'.startsWith(head)) return;   // abhi pata nahi — ruko
      deltaDecided = true;
      if (CLAVIS_SILENT_HEAD_RE.test(head)) { silentReply = true; return; }
      delta = deltaHead;
      deltaHead = '';
    }
    if (silentReply) return;
    delta = clavisStripSilent(delta);
    if (!delta) return;
    window.ClavisVoiceState?.mark?.('llm_first_token');
    if (window.ClavisLive?.isActive?.()) return;
    if (clavisDisplayOf(taskId) === 'window') {
      writingPreview = `${writingPreview} ${delta}`.trim().slice(-120);
      try { if (taskId) window.ClavisTask?.event?.(taskId, { type: 'writing', label: writingPreview }); } catch (_) {}
      return;
    }
    if (!jarvisSpeechEnabled || window.ClavisVoiceState?.isSilent?.()) return;
    // One speech owner preserves the selected provider and cancellation.
    clavisStream.push(delta);
  };

  try {
    const response = await window.JarvisEngine.sendMessage(text, jarvisController.signal, onStep, onTextDelta, {
      images: images,
      attachments: attachments,
      source: requestSource, answerOnly, elaborate, guideTopicIds: options?.guideTopicIds
    });
    if (op && VS && !VS.isOperationCurrent(op.id)) return;
    if (turnSignal.aborted) return;
    hideJarvisTyping();
    // Typed message hamesha Rudra24 AI ke liye hai — wahan [[silent]] sirf strip hota hai.
    if (requestSource === 'voice' && response && (silentReply || CLAVIS_SILENT_HEAD_RE.test(String(response.text || '')))) {
      // Baat Rudra24 AI se thi hi nahi — chup, bubble nahi, wapas so jao.
      clavisSideTalk(taskId, text, turnStartedAt);
      return;
    }
    if (response && typeof response.text === 'string') response.text = clavisStripSilent(response.text);
    if (response) {
      if (clavisDisplayOf(taskId) !== 'window' && (clavisAnswerWantsWindow(response.text) || (response.toolsRun || []).some((t) => !/^(search_web|remember_fact|get_lead_stats|get_candidate_stats|navigate_to_page|pc_|show_)/.test(t.skill || '')))) {
        clavisSetDisplay(taskId, 'window');
      }
      if (taskId && window.ClavisTask) {
        window.ClavisTask.complete(taskId, {
          type: 'answer',
          text: response.text,
          summary: response.text.slice(0, 120).replace(/\n/g, ' ') + (response.text.length > 120 ? '...' : '')
        }, answerOnly ? [{ id: 'elaborate-answer', label: 'Elaborate this', run: () => handleJarvisSend({ text: 'Explain in more detail: ' + text, answerOnly: true, elaborate: true, guideTopicIds: response.guideTopicIds }) }, ...(response.guideTopicIds ? [{ id: 'app-manual', label: 'Read in Manual', run: () => window.ClavisAppMap.guide.open(response.guideTopicIds[0]) }] : [])] : undefined);
      }
      clavisReveal(taskId);
      const onScreen = clavisDisplayOf(taskId) === 'window';

      window.ClavisMind?.noteClavisTurn?.(response.text);
      refreshJarvisSidePanels();

      if (clavisStream.spoke) {
        await clavisStream.finish();
      } else if (jarvisSpeechEnabled && !turnSignal.aborted) {
        await speakJarvisText(response.spoken || (onScreen ? clavisSpokenSummary(response.text) : response.text), { signal: turnSignal, forceRepeat: true });
      } else {
        setJarvisStatus('listening', 'Sun raha hoon — bolo "Rudra"');
      }
      if (jarvisHandsFree) scheduleHandsFreeRelisten();
    }
  } catch (err) {
    if (op && VS && !VS.isOperationCurrent(op.id)) return;
    hideJarvisTyping();
    setJarvisStatus('online', 'Rudra24 AI Online');
    if (err.name === 'AbortError' || err.code === 'AI_CANCELLED') {
      if (taskId && window.ClavisTask) {
        window.ClavisTask.fail(taskId, { message: 'Stopped by user', code: 'CANCELLED', cancelled: true });
      }
    } else {
      const code = err.code || '';
      const credentialIssue = code === 'AI_CREDENTIAL_MISSING' || code === 'AI_CREDENTIAL_INVALID' || err.status === 401 || err.status === 403;
      setJarvisStatus(credentialIssue ? 'offline' : 'error', credentialIssue ? 'Needs setup' : 'Unavailable');

      const feedback = clavisAIErrorFeedback(err);
      const busy = feedback.busy;
      if (requestSource === 'voice' && (credentialIssue || busy || /limit|quota/i.test(feedback.title))) {
        CLAVIS_VS.setMicEnabled(false, 'AI unavailable; automatic voice requests stopped');
      }
      if (taskId && window.ClavisTask) {
        window.ClavisTask.fail(taskId, credentialIssue ? err : { message: feedback.message, code: busy ? 'AI_BUSY' : code || 'AI_BACKEND_UNAVAILABLE', status: err.status, retryable: err.retryable, action: err.action });
      }
      clavisReveal(taskId);
      if (!credentialIssue && requestSource !== 'voice' && jarvisSpeechEnabled && clavisDisplayOf(taskId) !== 'window') {
        speakJarvisText(feedback.spoken, { engine: 'browser' });
      }

      if (credentialIssue) {
        showToast({
          type: 'warning',
          title: 'Groq/OpenRouter Key Chahiye',
          message: 'Free API key se Rudra24 AI super-fast chalega.',
          action: { label: 'Connect Key', onClick: () => openKeySettings() }
        });
        setTimeout(() => { openKeySettings(); }, 900);
      } else {
        showToast({ type: busy ? 'info' : 'error', title: feedback.title, message: feedback.message, errorCode: code });
      }
    }
  } finally {
    if (jarvisController?.signal === turnSignal) {
      if (stopBtn) stopBtn.style.display = 'none';
      if (sendBtn) sendBtn.style.display = 'flex';
      jarvisController = null;
      if (clavisIsAwake()) scheduleHandsFreeRelisten();
    }
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
  // Stops the answer (generation + voice) — not the listening: the command
  // ear stays open so he can say the next thing right away.
  if (typeof CLAVIS_VS !== 'undefined' && CLAVIS_VS.cancelActiveOperation) {
    CLAVIS_VS.cancelActiveOperation('stop generation');
  }
  if (jarvisController) {
    jarvisController.abort();
    jarvisController = null;
  }
  window.stopJarvisSpeech?.();
  isJarvisSpeaking = false;
  if (currentPlayingAudio) {
    try { currentPlayingAudio.pause(); } catch {}
    currentPlayingAudio = null;
  }
  window.ClavisEar?.noteSpeakingDone?.();
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
// One recognizer at a time (ClavisVoiceState.mic). While Rudra24 AI is awake a
// single native recognizer — the "command ear" — stays open across turns AND
// while Rudra24 AI speaks (echo-guarded barge-in); the wake listener runs only
// while asleep. See docs/VOICE_PIPELINE.md for why (the old wake/command/
// relisten recognizers aborted each other and left gaps where nothing heard).
const CLAVIS_VS = window.ClavisVoiceState;
let jarvisVoiceFinalTranscript = '';
let jarvisVoiceCommitTimer = null;
let jarvisVoiceStopRequested = false;

let groqMediaRecorder = null;
let groqAudioChunks = [];
let isGroqRecording = false;
const groqCapture = { generation: 0, starting: false, cancel: null };
const clavisGroqReady = () => Boolean(window.ClavisDirect?.providerConfigured?.('groq'));
function stopGroqCapture() {
  groqCapture.cancel?.();
  groqCapture.generation++;
  groqCapture.cancel = null;
  groqCapture.starting = false;
  isGroqRecording = false;
}
window.addEventListener('rudra:auth-state', stopGroqCapture);
CLAVIS_VS.registerAudioCleanup?.(stopGroqCapture);

// A batch recognizer (Groq Whisper) has no partials, so the turn ends on real
// silence measured on the mic (RMS) — not a fixed 20 s cap.
function clavisSilenceWatch(stream, onEnd, silenceMs = 850, heardAlready = false) {
  let ctx = null, iv = 0, spoke = heardAlready;
  try {
    ctx = new (window.AudioContext || window.webkitAudioContext)();
    const an = ctx.createAnalyser();
    an.fftSize = 1024;
    ctx.createMediaStreamSource(stream).connect(an);
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
    const buf = new Float32Array(an.fftSize);
    let floor = 0.004, quietSince = 0, voiceFrames = 0;
    iv = setInterval(() => {
      an.getFloatTimeDomainData(buf);
      let s = 0; for (let i = 0; i < buf.length; i++) s += buf[i] * buf[i];
      const r = Math.sqrt(s / buf.length);
      const loud = r > Math.max(0.015, floor * 3);
      const voice = loud && (window.ClavisBargeIn?.hasPitch?.(buf, ctx.sampleRate) ?? true);
      if (!loud) floor = floor * 0.95 + r * 0.05;
      // A click/brief noise must not launch a paid transcription and AI turn.
      voiceFrames = voice ? voiceFrames + 1 : Math.max(0, voiceFrames - 1);
      if (voiceFrames >= 4) spoke = true;
      if (loud && spoke) { quietSince = 0; CLAVIS_VS.mark('last_voice'); return; }
      if (!spoke) return;
      if (!quietSince) quietSince = Date.now();
      else if (Date.now() - quietSince >= silenceMs) { stop(); onEnd(); }
    }, 50);
  } catch (_) {}
  function stop() { clearInterval(iv); iv = 0; try { ctx?.close(); } catch (_) {} ctx = null; }
  stop.heard = () => spoke;
  return stop;
}

async function legacyStartGroqWhisperVoiceInput(options = {}) {
  if (groqCapture.starting || isGroqRecording || clavisSpeakingNow()) return;
  const generation = ++groqCapture.generation;
  groqCapture.starting = true;
  const controller = new AbortController();
  const owner = window.SupabaseAuth?.getUser?.()?.id;
  const active = () => generation === groqCapture.generation && !controller.signal.aborted
    && owner === window.SupabaseAuth?.getUser?.()?.id && CLAVIS_VS.canProcessMic();
  const btn = document.getElementById('jarvis-composer-voice-btn');
  const status = document.getElementById('jarvis-composer-status');
  let stream, recorder, stopVad = () => {}, cap = 0;
  const capture = options.capture;
  const chunks = capture?.chunks || [];
  const cleanup = () => {
    stopVad(); clearTimeout(cap);
    window.ClavisEar?.tap?.stop?.('groq');
    stream?.getTracks().forEach(track => track.stop());
    if (generation === groqCapture.generation) {
      isGroqRecording = false; groqCapture.starting = false;
      btn?.classList.remove('recording');
      if (status) status.textContent = '';
    }
  };
  groqCapture.cancel = () => {
    controller.abort(); chunks.length = 0;
    if (recorder?.state === 'recording') recorder.stop();
    cleanup();
  };
  try {
    stream = capture?.stream || await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:true,noiseSuppression:true,autoGainControl:true}});
    if (capture && capture.owner !== owner) { capture.recorder.stop(); cleanup(); return; }
    if (!active()) { cleanup(); return; }
    if (window.ClavisEar?.voiceId?.enabled?.()) await window.ClavisEar.tap.start('groq');
    if (!active()) { cleanup(); return; }
    localStorage.setItem('clavis_mic_permission_granted', 'true');
    CLAVIS_VS.mic.claim('groq', () => { if (recorder?.state !== 'inactive') stopGroqCapture(); });
    const since = capture?.since || Date.now();
    const mimeType = ['audio/webm;codecs=opus','audio/webm','audio/mp4'].find(type => MediaRecorder.isTypeSupported(type));
    recorder = capture?.recorder || new MediaRecorder(stream, mimeType ? {mimeType} : undefined);
    groqMediaRecorder = recorder;
    recorder.ondataavailable = event => { if (active() && event.data.size) chunks.push(event.data); };
    recorder.onstop = async () => {
      cleanup(); CLAVIS_VS.mic.release('groq');
      // Keep ownership through transcription, preventing the watchdog from starting a second recorder.
      if (active()) groqCapture.starting = true;
      try {
        if (!active() || !chunks.length || (stopVad.heard && !stopVad.heard())) return;
        const audio = new Blob(chunks, {type: recorder.mimeType || 'audio/webm'});
        chunks.length = 0;
        if (audio.size < 1000) return;
        CLAVIS_VS.mark('endpoint'); setJarvisStatus('transcribing','Awaaz samajh raha hoon…');
        const text = await window.ClavisDirect.transcribeWithGroq(audio, controller.signal);
        if (!active() || !text.trim()) return;
        CLAVIS_VS.mark('final'); clavisShowVoicePreview(text.trim());
        await commitJarvisVoiceInput(text.trim(), {since,source:'groq',turnId:'groq-' + generation});
      } catch (error) {
        if (active() && error.name !== 'AbortError') {
          setJarvisStatus('error',error.message || 'Groq speech unavailable');
          window.showToast?.({type:'error',title:'Voice transcription',message:error.message});
          // No silent provider switch or retry loop against a rejected/rate-limited key.
          CLAVIS_VS.setMicEnabled(false,'Groq transcription failed');
        }
      } finally {
        if (generation === groqCapture.generation) {
          groqCapture.starting = false; groqCapture.cancel = null;
          if (active() && clavisIsAwake()) scheduleHandsFreeRelisten();
        }
      }
    };
    const patience = Math.min(3000, Math.max(600, Number(localStorage.getItem('clavis_live_patience_ms')) || 850));
    stopVad = clavisSilenceWatch(stream, () => { if (active() && recorder.state === 'recording') recorder.stop(); }, patience, Boolean(capture));
    cap = setTimeout(() => { if (active() && recorder.state === 'recording') recorder.stop(); },45000);
    isGroqRecording = true; groqCapture.starting = false;
    window.ClavisEar?.caption?.listening(true);
    btn?.classList.add('recording'); setJarvisStatus('listening','Sun raha hoon…');
    if (status) status.textContent = 'Groq Whisper · listening';
    if (recorder.state !== 'recording') recorder.start(200);
  } catch (error) {
    const current = active();
    cleanup(); CLAVIS_VS.mic.release('groq');
    if (current) {
      setJarvisStatus('error',error.message || 'Microphone unavailable');
      CLAVIS_VS.setMicEnabled(false,'microphone unavailable');
    }
  }
}

function startJarvisVoiceInput(options = {}) {
  if (!CLAVIS_VS.isClavisWorkspace()) return;
  window._clavisLastInputSource = 'voice';

  // Manual button click / shortcut toggle: If already recording/listening, clicking again toggles OFF
  const isDirectManualTrigger = !options.handsFreeCapture && !options.soundTrigger && !options.initialText;
  const isCurrentlyRecording = Boolean(
    isGroqRecording || groqCapture.starting ||
    window.ClavisLive?.isActive?.() ||
    (clavisEar.rec && clavisEarAlive()) ||
    document.getElementById('jarvis-composer-voice-btn')?.classList.contains('recording')
  );

  if (isDirectManualTrigger && isCurrentlyRecording) {
    clearTimeout(clavisEar.timer);
    clavisEarConsumeAll();
    clavisEar.holding = false;
    clavisEar.utterStartAt = 0;
    clavisEar.heard = '';
    clavisEar.lastFull = '';
    jarvisVoiceFinalTranscript = '';
    CLAVIS_VS.setMicEnabled(false, 'manual toggle off');
    if (window.ClavisLive?.isActive?.()) {
      try { window.ClavisLive.stop({ reason: 'user' }); } catch (_) {}
    }
    stopCommandEar();
    stopWakeListener();
    try { window.LocalSpeechEngine?.stopInput?.(); } catch (_) {}
    try { stopClavisSoundTriggers(); } catch (_) {}
    try { window.ClavisEar?.caption?.clear?.(); } catch (_) {}
    document.querySelectorAll('#jarvis-voice-btn, #jarvis-composer-voice-btn').forEach((b) => b.classList.remove('recording'));
    setJarvisStatus('stopped', 'Mic off');
    return;
  }

  // Toggling ON or starting: ensure mic capability is active
  CLAVIS_VS.setMicEnabled(true, 'start voice input');

  // Orb / mic button / keyboard shortcut = sir ne khud bulaya → jaago.
  // (Wake word aur clap/snap apne handler me pehle hi jaga chuke hote hain.)
  if (!options.handsFreeCapture && !options.soundTrigger && !window.ClavisLive?.isActive?.()) clavisWakeUp('tap');
  clavisPrewarm();

  // Rudra24 AI Live (Gemini Live API) owns voice whenever a Google AI Studio key
  // is connected. Background wake listening (handsFreeCapture without a wake)
  // stays on the cheap legacy recognizer so an always-open Live session
  // doesn't burn quota; the moment sir wakes Rudra24 AI, Live takes over.
  const live = window.ClavisLive;
  const fishVoiceReady = Boolean(localStorage.getItem('clavis_tts_provider') !== 'gemini' && window.ClavisDirect?.keyFor?.('fish_audio') && localStorage.getItem('clavis_fish_voice_id')?.trim());
  if (fishVoiceReady && live?.isActive?.()) live.stop({ reason: 'Fish Audio voice selected' });
  if (live && !options.forceLegacy && !fishVoiceReady && !clavisGroqReady()) {
    if (live.isActive()) {
      if (!options.handsFreeCapture && !options.soundTrigger) live.stop({ reason: 'user' });
      return;
    }
    const woke = (!options.handsFreeCapture || options.awakeCapture || options.soundTrigger) && clavisIsAwake();
    if (woke && live.isAvailable() && !CLAVIS_VS.isSilent()) {
      const trigger = options.soundTrigger ? 'clap' : options.awakeCapture ? 'wake word' : 'button';
      stopCommandEar();
      live.start({ trigger, initialText: options.initialText || '' }).then((ok) => { if (!ok) startJarvisVoiceInput({ ...options, forceLegacy: true }); });
      return;
    }
    if (!options.handsFreeCapture && !options.soundTrigger) live.promptKey?.();
  }

  // Tier 1: If backend LocalSpeechEngine is running and has active input socket, use it
  if (!clavisGroqReady() && window.startLocalJarvisVoiceInput && window.LocalSpeechEngine?.inputSocket) {
    const localOptions = { ...options, persistent: Boolean(options.persistent) };
    CLAVIS_VS.mic.claim('local', () => window.LocalSpeechEngine?.stopInput?.());
    // The backend streams partial transcripts: preview them verbatim.
    localOptions.onPartial = (t) => { if (t) { CLAVIS_VS.mark('first_partial'); CLAVIS_VS.mark('last_voice'); clavisShowVoicePreview(t); } };
    localOptions.onFinal = (rawText) => {
      const text = String(rawText || '').trim();
      if (!text) return;
      CLAVIS_VS.mark('endpoint');
      if (options.handsFreeCapture && !options.awakeCapture && !clavisIsAwake()) {
        const wake = clavisWakeMatch(text);
        if (!wake) { window.ClavisEar?.caption?.clear?.(); return; }   // soya hai — sirf naam sunta hai
        if (clavisWordCount(wake.remainder) < 2) {
          clavisWakeUp('word');
          playWakeChime();
          window.LocalSpeechEngine.stopInput();
          setJarvisStatus('awake', 'Haan sir, boliye...');
          setTimeout(() => startJarvisVoiceInput({ handsFreeCapture: true, awakeCapture: true, persistent: true }), 120);
          return;
        }
        commitJarvisVoiceInput(text, { source: 'local' });   // naam + command ek saath
        return;
      }
      commitJarvisVoiceInput(text, { source: 'local', openMic: clavisOpenMic() });
    };
    window.startLocalJarvisVoiceInput(localOptions);
    return;
  }

  // Soye hue Rudra24 AI ke liye room audio ko cloud STT (Groq) par bhejna = keys
  // khatam. Background wake sirf free local recognizer / clap / snap / tap se.
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  const backgroundOnly = Boolean(options.handsFreeCapture && !options.awakeCapture && !options.soundTrigger && !clavisIsAwake());
  if (backgroundOnly && !SR) {
    setJarvisStatus('idle', CLAVIS_ASLEEP_LABEL);
    return;
  }

  // Tier 2: the browser recognizer — live partials in the caption, semantic
  // endpointing, stays open across turns. Groq Whisper (batch, no partials)
  // is only the fallback for a browser without Web Speech.
  if (clavisGroqReady() && !backgroundOnly) {
    stopCommandEar();
    stopWakeListener();
    if (live?.isActive?.()) live.stop({ reason: 'Groq speech selected' });
    if (String(options.initialText || '').trim()) {
      Promise.resolve(commitJarvisVoiceInput(options.initialText, { source: 'groq' }))
        .finally(() => { if (CLAVIS_VS.canProcessMic() && clavisIsAwake()) clavisEnsureListening(); });
      return;
    }
    legacyStartGroqWhisperVoiceInput(options);
    return;
  }
  if ((fishVoiceReady || !SR) && (window.ClavisDirect?.keyFor?.('fish_audio') || window.ClavisDirect?.keyFor?.('gemini')) && !backgroundOnly) {
    legacyStartGroqWhisperVoiceInput(options);
    return;
  }
  legacyStartNativeSpeechRecognition(options);
}

// ── The command ear ────────────────────────────────────────────
const clavisEar = {
  rec: null, session: 0, running: false, startedAt: 0, stopRequested: false,
  seed: '', consumed: 0, lastLen: 0, heard: '', holding: false, lastVoiceAt: 0,
  timer: null, options: {}, utterStartAt: 0,
  tail: null,   // the still-open (interim) result: {idx, words}
  skip: null,   // words already used from result idx (he may keep talking in it)
};
// Everything heard so far is used up (committed / echo / "chup"). An interim
// result can still grow, so it is skipped by word count, not dropped whole.
function clavisEarConsumeAll() {
  const ear = clavisEar;
  if (ear.tail) { ear.consumed = ear.tail.idx; ear.skip = { ...ear.tail }; }
  else { ear.consumed = ear.lastLen; ear.skip = null; }
  ear.seed = ''; ear.heard = '';
}
// One language for wake + command so the wake recognizer can simply become
// the command ear (no restart gap). en-IN writes Hinglish in Roman script,
// which is what the command parsers and the caption expect.
function clavisEarLang() {
  return localStorage.getItem('clavis_voice_language') || localStorage.getItem('jarvis_voice_lang') || 'en-IN';
}
function clavisWakeLang() {
  return localStorage.getItem('clavis_wake_lang') || clavisEarLang();
}
function clavisEarAlive() {
  return Boolean(clavisEar.rec && !clavisEar.stopRequested && (clavisEar.running || Date.now() - clavisEar.startedAt < 1500));
}
// Is Rudra24 AI audibly speaking right now? ClavisEar tracks every voice engine
// (with a safety expiry); the bare isJarvisSpeaking flag could stay stuck
// true after a cut-off reply and leave the ear treating him as echo.
function clavisSpeakingNow() {
  if (!window.ClavisEar) return Boolean(isJarvisSpeaking);
  return Boolean(window.ClavisEar.isSpeaking() || (isJarvisSpeaking && window.LocalSpeechEngine?.outputSocket));
}

function stopCommandEar() {
  stopGroqCapture();
  const ear = clavisEar;
  clearTimeout(ear.timer); clearTimeout(jarvisVoiceCommitTimer);
  ear.stopRequested = true; jarvisVoiceStopRequested = true;
  ear.session++; jarvisVoiceSession++;
  const rec = ear.rec;
  ear.rec = null; ear.running = false;
  if (jarvisRecognition === rec) jarvisRecognition = null;
  ear.seed = ''; ear.heard = ''; ear.holding = false; ear.consumed = 0; ear.utterStartAt = 0; ear.tail = null; ear.skip = null;
  jarvisVoiceFinalTranscript = '';
  if (rec) {
    try { rec.onend = null; rec.onresult = null; rec.onerror = null; rec.onstart = null; } catch (_) {}
    try { if (typeof rec.abort === 'function') rec.abort(); else rec.stop(); } catch (_) {}
  }
  CLAVIS_VS.mic.release('command');
  document.getElementById('jarvis-voice-btn')?.classList.remove('recording');
  document.getElementById('jarvis-composer-voice-btn')?.classList.remove('recording');
  window.ClavisEar?.tap?.stop?.('native');
}
window.clavisStopCommandEar = stopCommandEar;

// Wire a recognizer as the command ear (a fresh one, or the running wake
// recognizer adopted in place — see startWakeListener).
function clavisEarBind(rec, options, startIndex = 0) {
  const ear = clavisEar;
  CLAVIS_VS.mic.claim('command', stopCommandEar);
  ear.stopRequested = false; jarvisVoiceStopRequested = false;
  const session = ++ear.session; jarvisVoiceSession++;
  ear.options = options || {};
  ear.rec = rec; jarvisRecognition = rec;
  ear.consumed = startIndex; ear.lastLen = startIndex; ear.holding = false; ear.utterStartAt = 0; ear.tail = null; ear.skip = null;
  ear.startedAt = startIndex ? Date.now() : 0;   // an adopted recognizer is already running
  const composerStatus = document.getElementById('jarvis-composer-status');
  rec.onstart = () => { if (session === ear.session) { ear.running = true; if (composerStatus?.textContent) composerStatus.textContent = ''; } };
  rec.onspeechstart = () => { if (session === ear.session && !clavisSpeakingNow()) CLAVIS_VS.mark('speech_start'); };
  rec.onresult = (e) => { if (session === ear.session) clavisEarResult(e); };
  rec.onerror = (ev) => {
    if (session !== ear.session) return;
    const err = ev?.error;
    if (err === 'not-allowed' || err === 'service-not-allowed') {
      stopCommandEar();
      CLAVIS_VS.set('ERROR', 'mic blocked');
      if (composerStatus) composerStatus.textContent = 'Microphone blocked — allow it in browser settings, then retry.';
      showToast('error', 'Voice input error', 'Microphone permission is blocked. Allow it in the browser address bar.');
      return;
    }
    if (err === 'audio-capture') CLAVIS_VS.set('ERROR', 'audio-capture');
    // no-speech / aborted / network: onend reopens it (and the watchdog backs that up).
    if (err === 'network' && composerStatus) composerStatus.textContent = 'Voice service reconnecting…';
  };
  rec.onend = () => {
    if (session !== ear.session) return;
    ear.running = false;
    if (ear.stopRequested) return;
    // Chrome closes continuous sessions by itself (silence, network, ~60 s).
    // Keep what he already said as the seed so no word is lost; reopen now.
    const lastStart = ear.startedAt;
    ear.seed = ear.heard; ear.consumed = 0; ear.lastLen = 0; ear.tail = null; ear.skip = null;
    ear.startedAt = 0;   // not alive until a start() succeeds (the watchdog counts from here)
    setTimeout(() => {
      if (session !== ear.session || ear.stopRequested || ear.running) return;
      try { rec.start(); ear.startedAt = Date.now(); } catch (_) { /* watchdog retries */ }
    }, clavisReopenDelay('ear', lastStart));
  };
  document.getElementById('jarvis-composer-voice-btn')?.classList.add('recording');
  if (window.ClavisEar?.voiceId?.enabled?.()) window.ClavisEar.tap.start('native');
  window.ClavisEar?.caption?.listening(true);
  CLAVIS_VS.rest('ear open');
  return session;
}

function legacyStartNativeSpeechRecognition(options = {}) {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) {
    const unsupportedStatus = document.getElementById('jarvis-composer-status');
    if (unsupportedStatus) unsupportedStatus.textContent = 'Voice input is not supported here.';
    showToast('error', 'Not Supported', 'Voice input isn\'t supported in this browser. Try Chrome.');
    return;
  }
  const ear = clavisEar;
  const initialText = String(options.initialText || '').trim();
  // Already open: a wake remainder joins the turn; a tap means "that's it, send".
  if (ear.rec && clavisEarAlive()) {
    if (initialText) { ear.seed = `${ear.seed} ${initialText}`.trim(); ear.heard = `${ear.heard} ${initialText}`.trim(); clavisShowVoicePreview(ear.heard); clavisEarSchedule(); }
    else if (!options.handsFreeCapture && ear.heard.trim()) clavisEarCommit('tap');
    window.ClavisEar?.caption?.listening(true);
    return;
  }
  if (ear.rec) stopCommandEar();
  stopWakeListener(true);

  const recognition = new SpeechRecognition();
  recognition.lang = clavisEarLang();
  recognition.interimResults = true;
  recognition.continuous = true;
  recognition.maxAlternatives = 1;
  clavisEarBind(recognition, options, 0);
  ear.seed = initialText; ear.heard = initialText;
  setJarvisStatus(options.handsFreeCapture ? 'awake' : 'listening', options.handsFreeCapture ? 'Haan sir, boliye...' : 'Sun raha hoon...');
  // "Rudra24 AI, leads dikhao" ek hi saans me: wake ke saath command aa chuka hai.
  if (initialText) { clavisShowVoicePreview(initialText); CLAVIS_VS.mark('first_partial'); CLAVIS_VS.mark('last_voice'); clavisEarSchedule(); }
  try { recognition.start(); ear.startedAt = Date.now(); } catch (error) {
    // Another recognizer still closing — the watchdog reopens this in ~1.5 s.
    console.info('[Rudra24 AI ear] start deferred:', error?.message || error);
  }
}

function clavisEarResult(e) {
  const ear = clavisEar;
  let fin = '', interim = '';
  const n = e.results.length;
  // Web Speech keeps every result in a continuous session. Only scan results
  // that have not already been folded into the seed; the old zero-based scan
  // made a long utterance progressively slower (O(n²)).
  const start = Math.max(0, Math.min(ear.consumed, n));
  for (let i = start; i < n; i++) {
    const r = e.results[i];
    let t = String(r?.[0]?.transcript || '').trim();
    if (ear.skip && i === ear.skip.idx) t = t.split(/\s+/).slice(ear.skip.words).join(' ');
    if (!t) continue;
    if (r.isFinal) fin += ' ' + t; else interim += ' ' + t;
  }
  ear.lastLen = n;
  const lastR = e.results[n - 1];
  ear.tail = lastR && !lastR.isFinal ? { idx: n - 1, words: clavisWordCount(lastR[0]?.transcript) } : null;
  if (fin) ear.seed = `${ear.seed} ${fin}`.replace(/\s+/g, ' ').trim();
  // Final results are immutable; advance past them and retain only the one
  // open interim tail so the next event touches a bounded slice of results.
  ear.consumed = Math.max(ear.consumed, ear.tail ? ear.tail.idx : n);
  if (ear.skip && ear.skip.idx < ear.consumed) ear.skip = null;
  const heard = `${ear.seed} ${interim}`.replace(/\s+/g, ' ').trim();
  if (!heard) return;

  // Rudra24 AI is talking: only a real barge-in counts, never its own echo.
  if (clavisSpeakingNow()) {
    const v = window.ClavisEar?.judge?.(heard, { since: Date.now() - 3000 }) || { accept: false };
    if (!(v.accept && v.barge)) {
      // Echo / room noise: forget it so it never prefixes his next command.
      clavisEarConsumeAll();
      return;
    }
    interruptClavisSpeech();
    const stop = CLAVIS_VS.parseStop(heard);
    if (stop && stop.kind === 'hush') {
      // "chup" / "stop" / "wait" over Rudra24 AI: quiet instantly, keep listening.
      clavisEarConsumeAll();
      CLAVIS_VS.mark('first_partial'); CLAVIS_VS.mark('endpoint'); CLAVIS_VS.mark('dispatch');
      window.ClavisEar?.caption?.clear?.();
      if (/\b(wait|ruko|ruk jao)\b/i.test(heard)) ear.holding = true;
      CLAVIS_VS.rest('hushed');
      return;
    }
  }

  ear.heard = heard;
  if (!ear.utterStartAt) ear.utterStartAt = Date.now() - 700;
  CLAVIS_VS.mark('first_partial'); CLAVIS_VS.mark('last_voice'); CLAVIS_VS.notePartial();
  if (fin) CLAVIS_VS.mark('final');
  CLAVIS_VS.set('USER_SPEAKING', 'partial');
  // Bolte-bolte window expire na ho.
  if (clavisIsAwake() && (!ear.options.followUp || window.ClavisEar?.looksLikeRequest?.(heard) || window.ClavisWake?.named?.(heard))) {
    window.ClavisWake?.touch?.(6000);
  }
  // His words, verbatim, in the caption (never in the composer).
  clavisShowVoicePreview(heard);
  if (!ear.holding && CLAVIS_VS.isHold(heard)) ear.holding = true;
  clavisEarSchedule(fin);
}

// Semantic endpoint: ~0.7 s after a finished sentence, 1.3 s neutral, 2.8 s
// after a dangling word; "wait / ruko" holds until "done / ab batao".
function clavisEarSchedule(isFinal) {
  const ear = clavisEar;
  clearTimeout(ear.timer);
  ear.lastVoiceAt = Date.now();
  let d = CLAVIS_VS.endpointDelay(ear.heard, { holding: ear.holding });
  if (d === 0) { clavisEarCommit('release'); return; }
  // Chrome only emits a final result after its OWN silence detection has
  // fired. Waiting the whole window again on top of that was pure lag.
  // Only shortcut when the sentence already reads as finished — a final on
  // a dangling word still gets its full window.
  if (isFinal && d !== Infinity && d <= 450 && !ear.holding) d = 120;
  ear.timer = setTimeout(clavisEarCheck, d === Infinity ? 1000 : d);
}
function clavisEarCheck() {
  const ear = clavisEar;
  if (!ear.heard) return;
  const silence = Date.now() - ear.lastVoiceAt;
  const verdict = CLAVIS_VS.decide(ear.heard, silence, { holding: ear.holding });
  if (verdict === 'commit') { clavisEarCommit('endpoint'); return; }
  if (verdict === 'drop') {
    clavisEarConsumeAll(); ear.holding = false; ear.utterStartAt = 0;
    window.ClavisEar?.caption?.clear?.();
    CLAVIS_VS.rest('hold expired');
    return;
  }
  ear.timer = setTimeout(clavisEarCheck, 140);
}
function clavisEarCommit(reason) {
  const ear = clavisEar;
  clearTimeout(ear.timer);
  const raw = ear.heard;
  clavisEarConsumeAll(); ear.holding = false;
  const since = ear.utterStartAt || Date.now() - 6000;
  ear.utterStartAt = 0;
  const text = CLAVIS_VS.stripHold(raw);
  if (!text) { window.ClavisEar?.caption?.clear?.(); CLAVIS_VS.rest('empty'); return; }
  CLAVIS_VS.mark('endpoint');
  const o = ear.options || {};
  commitJarvisVoiceInput(text, {
    since, source: 'native', fromEar: true, reason,
    openMic: Boolean(o.followUp),
    requireWake: Boolean(o.handsFreeCapture && !o.awakeCapture && !o.soundTrigger && !clavisIsAwake()),
  });
}

// Kept for other callers: the endpoint rules now live in ClavisVoiceState.
const CLAVIS_DONE_END = CLAVIS_VS.DONE_END;
const CLAVIS_DANGLING_END = CLAVIS_VS.DANGLING_END;
function clavisIsFragment(text) { return CLAVIS_VS.isFragment(text); }

// Live preview of what sir is saying. The caption owns it; the composer is
// only a fallback for a build without clavis-ear.js.
function clavisShowVoicePreview(text) {
  if (!text) return;
  if (window.ClavisEar?.caption && localStorage.getItem('clavis_live_caption') !== 'false') { window.ClavisEar.caption.live(text); return; }
  const input = document.getElementById('jarvis-input');
  if (input) { input.value = window.ClavisVoice?.toHinglish?.(text, true) || text; input.dispatchEvent(new Event('input')); }
}

// Stop Rudra24 AI mid-sentence because sir spoke over it. Capture is NOT
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
  CLAVIS_VS.set('USER_SPEAKING', 'barge-in');
  setJarvisStatus('interrupted', 'Aap boliye...');
  return true;
}
window.interruptClavisSpeech = interruptClavisSpeech;

// Quiet now (voice "chup" / "stop" / silent mode) without touching the mic.
function clavisHushNow() {
  if (jarvisController) { try { jarvisController.abort('hush'); } catch (_) {} jarvisController = null; }
  stopJarvisSpeech();
  try { window.ClavisLive?.hush?.(); } catch (_) {}
  isJarvisSpeaking = false;
  window.ClavisBargeIn?.disarm?.();
  window.ClavisMind?.noteSpeakingStopped?.();
  window.ClavisEar?.noteSpeakingDone?.();
}
// A new spoken turn replaces whatever the last one was still doing.
function clavisCancelStaleTurn() {
  clavisGateClear();
  if (jarvisController) { try { jarvisController.abort('superseded'); } catch (_) {} jarvisController = null; }
  if (clavisSpeakingNow()) {
    stopJarvisSpeech();
    isJarvisSpeaking = false;
    window.ClavisBargeIn?.disarm?.();
    window.ClavisEar?.noteSpeakingDone?.();
  }
}

// Deterministic voice commands — decided locally in < 1 ms, never via the LLM:
// hush ("chup", "shut up"), sleep ("so jao", "bas karo", "stop listening"),
// silent-for-N ("5 minute chup raho").
function clavisVoiceFastPath(text) {
  const cmd = CLAVIS_VS.parseStop(text);
  if (!cmd) return false;
  CLAVIS_VS.mark('dispatch');
  window.ClavisEar?.caption?.final(text, true);
  clavisHushNow();
  if (cmd.kind === 'hush') {
    CLAVIS_VS.rest('hush');
    setJarvisStatus('awake', 'Chup — boliye jab chahiye');
    return true;
  }
  if (cmd.kind === 'silent') {
    const min = Math.max(1, Math.round(cmd.ms / 60000));
    if (window.ClavisLive?.isActive?.()) { try { window.ClavisLive.stop({ reason: 'silent' }); } catch (_) {} }
    CLAVIS_VS.silence(cmd.ms);
    window.ClavisProactive?.snooze?.(Math.ceil(cmd.ms / 60000));
    setJarvisStatus('awake', `Chup hoon — ${min} min`);
    try { showToast('info', 'Silent mode', `Rudra24 AI ${min} min tak nahi bolega — sun raha hai, jawab screen par.`); } catch (_) {}
    clavisEnsureListening();
    return true;
  }
  // sleep
  CLAVIS_VS.unsilence();
  clavisGateClear();
  const r = window.ClavisIntent?.sleep?.('asked');   // sleeps (or lets Live say its line first)
  if (!r) { window.ClavisWake?.sleep?.('asked'); window.clavisGoToSleep?.(); }
  if (r?.spoken && jarvisSpeechEnabled) speakJarvisText(r.spoken, { style: r.style });
  return true;
}

// ── Background-tab gate: he's on another tab, so a spoken ACTION is asked
//    first ("Sir, aap dusre tab par hain — kya main '…' kar doon? Haan ya na?").
//    Answers and typed turns are never gated.
const clavisGate = { pending: null };
function clavisTabAway() {
  try { return Boolean(document.hidden || !document.hasFocus()); } catch (_) { return false; }
}
const CLAVIS_ACTION_RE = /\b(karo|kar do|kardo|kariye|kijiye|kholo|khol do|band karo|band kar do|bhejo|bhej do|hatao|hata do|chalao|chala do|nikalo|nikal do|likho|likh do|mita do|bana do|banao|dikhao|dikha do|lagao|chalu karo|open|close|send|delete|remove|start|run|play|pause|call|create|add|export|download|sync|save|type|search|show|find|go to|navigate|switch)\b/i;
const CLAVIS_QUESTION_RE = /\?\s*$|^(kya|kaise|kyun|kyon|kab|kahan|kaun|kitn[aei]|what|why|how|when|where|who|which|is|are|do you|does)\b|\b(kya hai|kaun hai|kahan hai|kaise hai|batao|bataiye|bata do|samjhao|explain|tell me)\b/i;
function clavisLooksLikeAction(text) {
  const t = String(text || '').trim();
  return CLAVIS_ACTION_RE.test(t) && !CLAVIS_QUESTION_RE.test(t);
}
function clavisGateClear(answer) {
  const p = clavisGate.pending;
  if (!p) return;
  clavisGate.pending = null;
  clearTimeout(p.timer);
  if (answer !== 'yes') { try { p.onNo?.(); } catch (_) {} }
}
function clavisAskBeforeActing(text, run, onNo) {
  clavisGateClear();
  const task = text.length > 70 ? text.slice(0, 67) + '…' : text;
  const q = `Sir, aap dusre tab par hain — kya main "${task}" kar doon? Haan ya na?`;
  const p = { text, run: run || (() => { clavisCancelStaleTurn(); handleJarvisSend({ source: 'voice', text }); }), onNo };
  // ~12 s to answer after the question has been said.
  p.timer = setTimeout(() => {
    if (clavisGate.pending !== p) return;
    console.info('[Rudra24 AI gate] no answer — not done:', text);
    clavisGateClear();
    window.ClavisEar?.caption?.clear?.();
  }, 12000 + q.length * 70);
  clavisGate.pending = p;
  window.ClavisWake?.touch?.(30000);
  window.ClavisEar?.caption?.final(text, true);
  if (jarvisSpeechEnabled && !CLAVIS_VS.isSilent()) speakJarvisText(q, { force: true });
  else { try { showToast('info', 'Rudra', q); } catch (_) {} }
}
// A spoken yes / no for the pending question. Returns true when consumed.
function clavisGateOffer(text) {
  const p = clavisGate.pending;
  if (!p) return false;
  const yn = CLAVIS_VS.parseYesNo(text);
  if (!yn) return false;   // not an answer (or its own question heard back)
  clavisGateClear(yn);
  window.ClavisEar?.caption?.final(text, true);
  CLAVIS_VS.mark('dispatch');
  if (yn === 'yes') p.run();
  else {
    CLAVIS_VS.rest('gate: no');
    if (jarvisSpeechEnabled) speakJarvisText('Theek hai sir, nahi karta.');
  }
  return true;
}
window.clavisGateOffer = clavisGateOffer;
// For Rudra24 AI Live's action tools: resolves true right away when he's on this
// tab; otherwise asks aloud and resolves with his answer.
window.clavisBackgroundGate = function clavisBackgroundGate(label) {
  if (!clavisTabAway()) return Promise.resolve(true);
  return new Promise((resolve) => clavisAskBeforeActing(String(label || 'yeh kaam'), () => resolve(true), () => resolve(false)));
};

// Open the connections the next turn will need while he is still talking.
let clavisPrewarmed = false;
function clavisPrewarm() {
  if (clavisPrewarmed) return;
  clavisPrewarmed = true;
  try {
    // AI Studio is off, so warming its DNS was pure waste.
    ['https://api.groq.com', 'https://openrouter.ai'].forEach((href) => {
      const l = document.createElement('link');
      l.rel = 'preconnect'; l.href = href; l.crossOrigin = 'anonymous';
      document.head.appendChild(l);
    });
  } catch (_) {}
}

function clavisWordCount(text) {
  return String(text || '').trim().split(/\s+/).filter(Boolean).length;
}

async function commitJarvisVoiceInput(transcript, meta = {}) {
  const input = document.getElementById('jarvis-input');
  meta = meta || {};
  const heard = clavisCommitCommand(String(transcript || '').trim());
  let finalText = heard;
  clearTimeout(jarvisVoiceCommitTimer);
  if (!finalText) return;

  // ── Wake gate: soya hai to sirf naam se jaagta hai ─────────────
  const wake = clavisWakeMatch(finalText);
  // Rudra24 AI ka apna naam uski apni awaaz me ("Main Rudra24 AI hoon") wake nahi hai.
  const selfName = Boolean(wake && window.ClavisEar && window.ClavisEar.msSinceSpoke?.() < 4000 && !window.ClavisEar.judge(finalText).accept);
  const byName = Boolean(wake && !selfName);
  if (!clavisIsAwake() || meta.requireWake) {
    if (!byName) {
      // Overheard — koi LLM nahi, koi task nahi, caption bhi saaf.
      console.info('[ClavisWake] asleep, ignored:', finalText);
      window.ClavisEar?.caption?.clear?.();
      jarvisVoiceFinalTranscript = '';
      return;
    }
  }
  if (byName) {
    clavisWakeUp('word');
    finalText = wake.remainder;
    // "Gurugram ki leads dikhao, Rudra24 AI" — naam aakhir me, command pehle.
    if (clavisWordCount(finalText) < 2 && clavisWordCount(wake.before) >= 2) finalText = wake.before;
    const stopOnly = window.ClavisCommands?.isStop?.(finalText) || CLAVIS_VS.parseStop(finalText);
    if (clavisWordCount(finalText) < 2 && !stopOnly) {
      // Sirf "Rudra" / "Hey Rudra" — jaag gaya, ab command suno.
      jarvisVoiceFinalTranscript = '';
      playWakeChime();
      clavisYawnIfSlept();
      setJarvisStatus('awake', 'Haan sir, boliye...');
      window.ClavisEar?.caption?.listening(true);
      CLAVIS_VS.rest('named');
      clavisEnsureListening();
      return;
    }
  }
  // A yes / no for the background-tab question (said after the question ended).
  if (clavisGate.pending && !clavisSpeakingNow() && clavisGateOffer(finalText)) return;

  const openMic = !byName && Boolean(meta.openMic || clavisOpenMic());
  const session = Boolean(window.ClavisWake?.continuous?.() && clavisIsAwake());

  // One gate for every recognizer: Rudra24 AI's own voice (echo), background
  // chatter in open-mic moments, and — once enrolled — voices that aren't his.
  const verdict = window.ClavisEar?.judge?.(byName ? heard : finalText, { ...meta, openMic, session }) || { accept: true };
  if (!verdict.accept) {
    console.info('[ClavisEar] ignored (' + verdict.reason + '):', finalText);
    window.ClavisEar?.caption?.final(finalText, false);
    jarvisVoiceFinalTranscript = '';
    CLAVIS_VS.rest('ignored');
    return;
  }
  // Follow-up (bina naam, no continuous session) me sirf wahi jo sach me
  // Rudra24 AI se maanga gaya ho: request/sawaal, ya Voice ID se pakka sir ki awaaz.
  // In a continuous session the LLM's [[silent]] filters side talk instead.
  if (openMic && !verdict.barge && !session) {
    const ear = window.ClavisEar;
    const owner = Boolean(ear?.voiceId?.enabled?.() && verdict.reason === 'ok');
    if (!(window.ClavisWake?.named?.(finalText) || ear?.looksLikeRequest?.(finalText) || owner || !ear)) {
      console.info('[ClavisWake] follow-up ignored (not a request):', finalText);
      window.ClavisEar?.caption?.final(finalText, false);
      jarvisVoiceFinalTranscript = '';
      CLAVIS_VS.rest('ignored');
      return;
    }
  }
  if (verdict.barge) interruptClavisSpeech();
  // "okay to tum mujhe…" — he hasn't said it yet. The ear already waited
  // for him (semantic endpoint); other recognizers keep the old rule.
  if (!meta.fromEar && clavisIsFragment(finalText)) {
    window.ClavisEar?.caption?.final(finalText, false);
    jarvisVoiceFinalTranscript = '';
    if (clavisIsAwake()) {
      window.ClavisWake?.touch?.(6000);
      setJarvisStatus('awake', 'Haan sir, boliye…');
    }
    return;
  }
  CLAVIS_VS.mark('intent');
  if (clavisVoiceFastPath(finalText)) return;

  // FAST ROUTE (<50ms): Deterministic commands (Open website, open app, stop, mic control)
  // must NEVER wait for or wake Gemini Live or call cloud LLMs!
  try {
    setJarvisStatus(window.ClavisAppMap?.resolve?.(finalText) ? 'executing' : 'thinking', 'Command samajh raha hoon...');
    let det = null;
    if (window.ClavisIntent?.route) {
      det = await window.ClavisIntent.route(finalText, { source: 'voice' });
    }
    if (!det?.handled && window.ClavisCommands?.route) {
      det = await window.ClavisCommands.route(finalText);
    }
    if (det && det.handled) {
      CLAVIS_VS.mark('speech_to_intent');
      CLAVIS_VS.mark('tool_started');
      CLAVIS_VS.mark('tool_finished');
      window.ClavisEar?.tap?.stop?.('native');
      window.ClavisEar?.caption?.final(finalText, true);
      clavisFreshWake = false;
      window.__clavisLastVoiceAt = Date.now();
      jarvisVoiceFinalTranscript = '';
      if (det.spoken && jarvisSpeechEnabled && !CLAVIS_VS.isSilent()) {
        speakJarvisText(det.spoken);
      }
      if (det.text) {
        appendJarvisBubble('assistant', det.text);
      }
      CLAVIS_VS.rest('intent handled');
      return;
    }
  } catch (err) {
    console.warn('[ClavisVoice] deterministic route error:', err);
  }

  window.ClavisEar?.tap?.stop?.('native');
  window.ClavisEar?.caption?.final(finalText, true);
  // Accepted voice turn: agle turns follow-up hain; task controller isse
  // pehchaanta hai ki yeh bola gaya tha.
  clavisFreshWake = false;
  window.__clavisLastVoiceAt = Date.now();
  jarvisVoiceFinalTranscript = '';
  // He's on another tab: an action is asked first; an answer just happens.
  if (clavisTabAway() && clavisLooksLikeAction(finalText)) {
    clavisAskBeforeActing(finalText);
    return;
  }
  // "Rudra24 AI, get me leads..." in one breath: hand the command straight to Live.
  if (!clavisGroqReady() && window.ClavisLive?.isAvailable?.() && !window.ClavisLive.isActive() && !CLAVIS_VS.isSilent()) {
    stopCommandEar();
    window.LocalSpeechEngine?.stopInput?.();
    clavisHoldTurn();   // Live jawab dega — tab tak window expire na ho
    Promise.resolve(window.ClavisLive.start({ trigger: 'wake word', initialText: finalText }))
      .then((ok) => {
        clavisReleaseTurn();
        if (ok === false && clavisIsAwake()) { clavisEnsureListening(); handleJarvisSend({ source: 'voice', text: finalText }); }
      })
      .catch(() => { clavisReleaseTurn(); clavisEnsureListening(); });
    return;
  }
  if (!window.ClavisEar && input) {
    input.value = finalText;
    input.dispatchEvent(new Event('input'));
  }
  // The ear stays open (continuous + barge-in); only this turn is handed on.
  clavisCancelStaleTurn();
  return handleJarvisSend({ source: 'voice', text: finalText });
}

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
//  HANDS-FREE MODE — configurable "Rudra" wake word + continuous conversation
//  Works like "Hey Google": a background recognizer keeps listening;
//  when it hears "Jarvis", Jarvis wakes, chimes, and captures the
//  next command. Barge-in supported: speaking cancels current TTS.
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
let wakeResultIndex = -1;
let clavisFinalTranscript = '';
let clavisCaptureStartAt = 0;     // when the current spoken command began (voice ID scores from here)
let clavisFollowUpUntil = 0;      // open-mic window after a reply: no wake word needed
let clavisFollowUpTimer = null;

// Wake phrases ab ClavisWake me rehte hain (ek hi list, word-boundary match:
// "Rudra", "Hey Rudra", "Hey Buddy", "Hey Clay" + saved extra phrases).
// Yeh do functions purane callers ke liye naam se bache hain.
function getClavisWakeWords() {
  if (window.ClavisWake?.phrases) return window.ClavisWake.phrases();
  return ['hey rudra', 'hi rudra', 'ok rudra', 'rudra'];
}

function clavisWakeMatch(text) {
  if (window.ClavisWake?.match) {
    const m = window.ClavisWake.match(text);
    return m ? { phrase: m.phrase, remainder: String(m.rest || '').trim(), before: m.before || '' } : null;
  }
  const normalized = ' ' + String(text || '').toLowerCase()
    .replace(/रुद्रा?|rudhra|roodra|rudra/gi, 'rudra')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim() + ' ';
  const phrase = getClavisWakeWords().sort((a, b) => b.length - a.length).find(word => normalized.includes(' ' + word + ' '));
  if (!phrase) return null;
  const at = normalized.indexOf(' ' + phrase + ' ');
  return { phrase, remainder: normalized.slice(at + phrase.length + 2).trim(), before: normalized.slice(0, at).trim() };
}

function clavisCommitCommand(text) {
  return String(text || '').replace(/\b(go for it|that's it|thats it|backseat|done|over)\.?\s*$/i, '').trim();
}

function initClavisSoundTriggers() {
  if (clavisSoundTriggerBound || !window.ClavisAudioTrigger) return;
  clavisSoundTriggerBound = true;
  window.ClavisAudioTrigger.addEventListener('trigger', (event) => {
    // The toolbar switch is the authority: off means off, whatever restarted the detector.
    if (localStorage.getItem('clavis_sound_trigger_enabled') === 'false') { stopClavisSoundTriggers(); return; }
    const kind = event.detail?.kind === 'snap' ? 'Snap' : 'Clap';
    if (window.ClavisCognition && !window.ClavisCognition.admitSignal(kind.toLowerCase(), event.detail?.confidence)) return;
    const detectorStopped = stopClavisSoundTriggers();
    if (currentPlayingAudio) { try { currentPlayingAudio.pause(); } catch (_) {} currentPlayingAudio = null; }
    window.ClavisBargeIn?.disarm?.();
    window.ClavisMind?.noteInterrupted?.();
    isJarvisSpeaking = false;
    stopWakeListener(true);
    clavisWakeUp(kind.toLowerCase());   // 'snap' | 'clap'
    clavisFinalTranscript = '';
    playWakeChime();
    setJarvisStatus('awake', `${kind} detected — boliye...`);
    clavisYawnIfSlept();
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
      showToast({ type: 'warning', title: 'Open Rudra24 AI in browser mode', message: 'Clap / Snap needs http://localhost:3000; file:// pages cannot keep microphone access.', errorCode: code });
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
  if (!CLAVIS_VS.canProcessMic()) return false;
  if (!window.ClavisAudioTrigger || isJarvisSpeaking) return false;
  if (localStorage.getItem('clavis_sound_trigger_enabled') === 'false') return false;
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
  const isOn = localStorage.getItem('clavis_sound_trigger_enabled') !== 'false';
  if (isOn) {
    localStorage.setItem('clavis_sound_trigger_enabled', 'false');
    stopClavisSoundTriggers();
    updateClavisSoundTriggerButton(false);
    showToast('info', 'Sound triggers off', 'Wake word and Tap & Talk remain available.');
    return;
  }
  localStorage.setItem('clavis_sound_trigger_enabled', 'true');
  const started = await startClavisSoundTriggers();
  if (started) showToast('success', 'Clap / Snap on', 'Rudra24 AI will activate immediately on a clap or snap.');
  else localStorage.setItem('clavis_sound_trigger_enabled', 'false');
}

// "Thodi der chup ho jao" without Rudra24 AI Live: drop the conversation window
// and any capture; the wake listener keeps waiting for "Rudra" / a clap.
window.clavisGoToSleep = function clavisGoToSleep() {
  window.ClavisWake?.sleep?.('asked');
  jarvisAwake = false;
  clavisFollowUpUntil = 0;
  clearTimeout(clavisFollowUpTimer);
  clavisFinalTranscript = '';
  window.ClavisEar?.caption?.listening(false);
  setJarvisStatus('idle', CLAVIS_ASLEEP_LABEL);
};

// ClavisWake ne sula diya (window khatam / "chup ho jao" / side-talk):
// command capture band, Live band, sirf sasta local wake listener chalta rahe.
function clavisOnFellAsleep() {
  jarvisAwake = false;
  clavisFreshWake = false;
  clavisFollowUpUntil = 0;
  clearTimeout(clavisFollowUpTimer);
  clearTimeout(relistenTimer);
  clavisFinalTranscript = '';
  clavisCaptureStartAt = 0;
  clavisTurnHeld = false;
  clavisSpeechHeld = false;
  // Command ear — soye hue me kuch capture nahi hona chahiye.
  stopCommandEar();
  clavisGateClear();
  CLAVIS_VS.unsilence();
  CLAVIS_VS.set('SLEEPING', 'asleep');
  // Groq recorder — chunks phenk do taaki onstop kuch transcribe na kare.
  if (isGroqRecording && groqMediaRecorder && groqMediaRecorder.state !== 'inactive') {
    groqAudioChunks = [];
    try { groqMediaRecorder.stop(); } catch (_) {}
  }
  if (window.ClavisLive?.isActive?.()) {
    try { window.ClavisLive.stop({ reason: 'sleep' }); } catch (_) {}
  }
  window.ClavisEar?.caption?.listening(false);
  if (!isJarvisSpeaking) setJarvisStatus('idle', CLAVIS_ASLEEP_LABEL);
  // Wake listener hamesha chalta rahe (local, koi LLM nahi) — also while the
  // sleep line is being said, so "Rudra" right after it still wakes.
  if (jarvisHandsFree) {
    setTimeout(() => {
      if (!jarvisHandsFree || clavisIsAwake()) return;
      if (!wakeRecognition) startWakeListener();
      if (localStorage.getItem('clavis_sound_trigger_enabled') !== 'false' && !window.ClavisAudioTrigger?.running) startClavisSoundTriggers();
    }, 120);
  }
}
window.addEventListener('clavis:wake-change', (ev) => {
  const d = ev?.detail || {};
  if (d.awake) { jarvisAwake = true; return; }
  clavisOnFellAsleep();
});
// Woken after a nap he asked for: a sleepy, varied "meri aankh lag gayi thi".
function clavisYawnIfSlept() {
  if (window.ClavisLive?.isAvailable?.()) return;   // Live greets in its own words
  const line = window.ClavisIntent?.wakeLine?.();
  // The chime acknowledges ordinary activation. Speak only after an explicit nap,
  // and never let a delayed greeting interrupt a question already being answered.
  if (line) setTimeout(() => {
    if (clavisFreshWake && !groqCapture.starting && !jarvisController && !clavisSpeakingNow()) speakJarvisText(line, { style: 'sleepy' });
  }, 450);
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
    window.ClavisVoiceState?.setCapability?.('autoListenEnabled', true, 'handsfree on');
    window.ClavisVoiceState?.setMicEnabled?.(true, 'handsfree on');
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
    setJarvisStatus('listening', 'Sun raha hoon — bolo "Rudra"');
    appendJarvisBubble('assistant', `<p>Hands-free on hai, sir. 🎙️ Bas <b>"Rudra"</b>, "Hey buddy" ya saved wake phrase boliye — main sun lunga.</p>`);
    showToast('success', 'Hands-Free On', 'Bolo "Rudra" — main sun raha hoon.');
  } else {
    window.ClavisVoiceState?.setCapability?.('autoListenEnabled', false, 'handsfree off');
    window.ClavisVoiceState?.setMicEnabled?.(false, 'handsfree off');
    stopWakeListener();
    stopCommandEar();
    stopClavisSoundTriggers();
    window.LocalSpeechEngine?.stopInput?.();
    isJarvisSpeaking = false;
    if (currentPlayingAudio) {
      currentPlayingAudio.pause();
      currentPlayingAudio = null;
    }
    document.querySelectorAll('#jarvis-voice-btn, #jarvis-composer-voice-btn').forEach((b) => b.classList.remove('recording'));
    setJarvisStatus('stopped', 'Mic off');
    showToast('info', 'Hands-Free Off', '');
  }
}

function setJarvisStatus(state, label) {
  // Soya hua Rudra24 AI "Listening" nahi dikhata — pill wahi bataye jo sach hai:
  //   soya → Bolo "Rudra" · jaaga → Sun raha hoon · Soch raha hoon · Bol raha hoon
  const wakeState = window.ClavisWake?.state?.();
  const asleep = Boolean(wakeState && !wakeState.awake);
  const handsFreeOn = jarvisHandsFree && localStorage.getItem('clavis_mic_permission_granted') === 'true';
  if (asleep && handsFreeOn && (state === 'listening' || state === 'awake' || state === 'online')) state = 'idle';
  // Keep the canvas renderer and DOM status pill on the same state machine.
  window.currentJarvisStatus = state;
  window.isJarvisSpeaking = isJarvisSpeaking;
  const txt = document.getElementById('jarvis-status-text');
  const pill = document.querySelector('.jarvis-status-pill');
  const micStatus = document.getElementById('clavis-mic-live-status');
  const micLabel = document.getElementById('clavis-mic-live-label');
  const micGranted = localStorage.getItem('clavis_mic_permission_granted') === 'true';
  if (micStatus && micLabel) {
    const listening = !asleep && (state === 'listening' || state === 'awake');
    const wakeOnly = asleep && handsFreeOn;
    micLabel.textContent = !micGranted ? 'Mic setup needed' : listening ? 'Mic listening' : wakeOnly ? 'Wake word on' : 'Mic ready';
    micStatus.dataset.state = !micGranted ? 'needed' : listening ? 'listening' : wakeOnly ? 'wake' : 'ready';
    micStatus.title = !micGranted ? 'Tap the microphone once to grant access'
      : listening ? 'Rudra24 AI is listening to you'
      : wakeOnly ? 'Rudra24 AI so raha hai — sirf "Rudra", snap ya clap sunta hai (local, koi AI call nahi)'
      : 'Microphone permission is ready';
  }
  if (txt) {
    let shortLabel = 'Online';
    if (state === 'idle') shortLabel = handsFreeOn ? CLAVIS_ASLEEP_LABEL : 'Online';
    else if (state === 'listening' || state === 'awake') shortLabel = 'Sun raha hoon';
    else if (state === 'speaking') shortLabel = 'Bol raha hoon';
    else if (state === 'thinking') shortLabel = 'Soch raha hoon';
    else if (state === 'connecting') shortLabel = 'Connect ho raha hai';
    else if (state === 'transcribing') shortLabel = 'Sun kar likh raha hoon';
    else if (state === 'executing') shortLabel = 'Kaam kar raha hoon';
    else if (state === 'unavailable') shortLabel = 'Unavailable';
    else if (state === 'interrupted') shortLabel = 'Sun raha hoon';
    else if (state === 'online' && asleep && handsFreeOn) shortLabel = CLAVIS_ASLEEP_LABEL;
    else shortLabel = (label && label.length <= 15) ? label : 'Online';
    txt.textContent = shortLabel;
  }
  const voiceCaption = document.getElementById('clavis-voice-caption');
  if (voiceCaption) voiceCaption.textContent = state === 'speaking' ? 'Rudra24 AI is speaking...' : label;
  if (pill) {
    pill.classList.remove('listening', 'awake', 'thinking', 'connecting', 'transcribing', 'executing', 'idle', 'speaking', 'interrupted', 'offline', 'error', 'unavailable');
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
    else if (state === 'thinking' || state === 'connecting' || state === 'executing') orbState = 'THINKING';
    else if (state === 'transcribing') orbState = 'LISTENING';
    orbContainer.setAttribute('data-orb-state', orbState);
    if (window.StrandsOrb?.instance?.setState) {
      window.StrandsOrb.instance.setState(orbState);
    }
  }
}

let wakeRunning = false;
let wakeStartedAt = 0;
function startWakeListener() {
  if (!CLAVIS_VS.canProcessMic()) return;
  if (localStorage.getItem('clavis_mic_permission_granted') !== 'true') return;
  // Awake = the command ear listens, not the wake listener (one recognizer).
  if (clavisIsAwake()) { clavisEnsureListening(); return; }
  if (!jarvisHandsFree) return;
  // With Rudra24 AI Live connected, hands-free means a REAL wake word on the free
  // browser recognizer: nothing is sent anywhere as a command until sir says
  // "Rudra" (the old path treated every overheard sentence as a command).
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
  CLAVIS_VS.mic.claim('wake', () => stopWakeListener(true));
  wakeStopRequested = false;
  // Voice ID scores the follow-up window from this tap (only once enrolled).
  if (window.ClavisEar?.voiceId?.enabled?.()) window.ClavisEar.tap.start('wake');

  const recognizer = new SR();
  wakeRecognition = recognizer;
  // en-IN writes "Rudra" (and Hinglish) in Latin script; hi-IN tends to
  // write it in Devanagari, which the wake matcher would miss.
  recognizer.lang = clavisWakeLang();
  recognizer.continuous = true;
  recognizer.interimResults = true;
  recognizer.onstart = () => { if (wakeRecognition === recognizer) wakeRunning = true; };

  recognizer.onresult = (e) => {
    if (wakeRecognition !== recognizer) return;
    const latest = e.results[e.results.length - 1];
    const latestText = String(latest?.[0]?.transcript || '').trim();

    // Rudra24 AI is talking (a proactive line / its sleep line while asleep). The
    // recognizer hears its voice too, so nothing here is a command — unless it
    // is sir talking OVER it (a stop word or its name): a real barge-in.
    if (clavisSpeakingNow()) {
      const v = latestText ? window.ClavisEar?.judge?.(latestText) : null;
      if (v?.accept && v.barge) {
        // Barge-in sirf awaaz rokta hai. Jagata tabhi hai jab naam liya ho.
        const wake = clavisWakeMatch(latestText);
        interruptClavisSpeech();
        if (!wake) { setJarvisStatus('idle', CLAVIS_ASLEEP_LABEL); CLAVIS_VS.set('SLEEPING', 'barge while asleep'); return; }
        clavisWakeUp('word');
        clavisFreshWake = true;
        clavisAdoptWakeRecognizer(recognizer, e, e.results.length - 1);
      }
      return;
    }

    for (let i = e.resultIndex; i < e.results.length; i++) {
      const t = e.results[i][0].transcript;
      const wake = clavisWakeMatch(t);
      // Rudra24 AI saying its own name ("Main Rudra24 AI hoon") must not wake it.
      if (wake && window.ClavisEar && window.ClavisEar.msSinceSpoke() < 4000 && !window.ClavisEar.judge(t).accept) continue;
      if (!wake && !clavisIsAwake()) continue;
      // Wake-word recognition is local; the configured Groq pipeline owns the conversation.
      // Wait for the final wake transcript so "Rudra, <question>" is not discarded mid-breath.
      if (clavisGroqReady()) {
        if (!e.results[i].isFinal) continue;
        if (wake) { clavisWakeUp('word'); playWakeChime(); }
        const remainder = wake ? wake.remainder : String(t || '').trim();
        stopWakeListener(true);
        startJarvisVoiceInput({ initialText: remainder, handsFreeCapture: true, awakeCapture: true });
        return;
      }
      if (wake) {
        clavisWakeUp('word');
        playWakeChime();
        setJarvisStatus('awake', 'Haan sir, boliye...');
        if (!wake.remainder) clavisYawnIfSlept();
      }
      clavisCaptureStartAt = Date.now() - 800;
      window.LocalSpeechEngine?.stopInput?.();
      clearTimeout(relistenTimer);
      // Rudra24 AI Live takes the conversation when a Gemini key exists.
      if (window.ClavisLive?.isAvailable?.() && !CLAVIS_VS.isSilent()) {
        const remainder = wake ? wake.remainder : String(t || '').trim();
        stopWakeListener(true);
        window.setTimeout(() => startJarvisVoiceInput({ initialText: remainder, handsFreeCapture: true, awakeCapture: true }), 60);
        return;
      }
      // Otherwise this very recognizer becomes the command ear — no restart
      // gap, so "Rudra24 AI, Gurgaon ki leads dikhao" in one breath is heard whole.
      clavisAdoptWakeRecognizer(recognizer, e, i);
      return;
    }
  };

  recognizer.onerror = (ev) => {
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

  recognizer.onend = () => {
    if (wakeRecognition !== recognizer) return;
    wakeRunning = false;
    if (!jarvisHandsFree || wakeStopRequested) return;
    clearTimeout(wakeRestartTimer);
    const lastStart = wakeStartedAt;
    wakeRestartTimer = setTimeout(() => {
      if (!jarvisHandsFree || wakeStopRequested || wakeRecognition !== recognizer) return;
      try { recognizer.start(); wakeStartedAt = Date.now(); } catch (_) { /* watchdog restarts it */ }
    }, clavisReopenDelay('wake', lastStart));
  };

  wakeStartedAt = Date.now();
  try { recognizer.start(); } catch { /* watchdog restarts it */ }
}

// The wake recognizer heard "Rudra24 AI …": keep it running and make it the
// command ear from the result that holds the name (the name is stripped at
// commit). Different wake/command languages → a fresh ear instead.
function clavisAdoptWakeRecognizer(recognizer, e, index) {
  wakeRecognition = null;
  wakeRunning = false;
  wakeStopRequested = true;
  clearTimeout(wakeRestartTimer);
  window.ClavisEar?.tap?.stop?.('wake');
  CLAVIS_VS.mic.release('wake');
  if (recognizer.lang !== clavisEarLang()) {
    const text = String(e.results[index]?.[0]?.transcript || '').trim();
    const wake = clavisWakeMatch(text);
    try { recognizer.onend = null; recognizer.onresult = null; recognizer.abort ? recognizer.abort() : recognizer.stop(); } catch (_) {}
    setTimeout(() => startJarvisVoiceInput({ initialText: wake ? wake.remainder : text, handsFreeCapture: true, awakeCapture: true, forceLegacy: true }), 60);
    return;
  }
  if (clavisEar.rec) stopCommandEar();
  clavisEarBind(recognizer, { handsFreeCapture: true, awakeCapture: true, persistent: true }, index);
  clavisEar.running = true;
  clavisEar.seed = ''; clavisEar.heard = '';
  setJarvisStatus('awake', 'Haan sir, boliye...');
  clavisEarResult(e);
}

function stopWakeListener(keepAwake = false) {
  window.ClavisEar?.tap?.stop?.('wake');
  if (window.LocalSpeechEngine && CLAVIS_VS.mic.owner === 'local') window.LocalSpeechEngine.stopInput?.();
  if (wakeRecognition) {
    wakeStopRequested = true;
    clearTimeout(wakeRestartTimer);
    const r = wakeRecognition;
    wakeRecognition = null;
    wakeRunning = false;
    try { r.onend = null; r.onresult = null; r.abort ? r.abort() : r.stop(); } catch {}
  }
  CLAVIS_VS.mic.release('wake');
  if (!keepAwake) jarvisAwake = clavisIsAwake();   // mirror only — ClavisWake decides
}

// After a turn / a Live session / a sleep: make sure the RIGHT recognizer is
// listening right now (no 700 ms relisten delay any more — the command ear
// stays open through the reply, so a quick follow-up is never missed).
function scheduleHandsFreeRelisten() {
  clearTimeout(relistenTimer);
  relistenTimer = setTimeout(clavisEnsureListening, 0);
}

/* Chrome ends a speech session for two very different reasons: normal
   (silence, its own ~60 s cap) and broken (no network, no audio device, the
   service refusing). Both landed in the same `setTimeout(start, 50)`, so a
   broken one was reopened twenty times a second — that is the mic icon
   flicking on and off by itself, and the CPU burn behind the laggy feel.
   A session that LIVED a few seconds was healthy, so reopen at once; one
   that died instantly backs off, a little further each time. */
const clavisReopen = { ear: 0, wake: 0 };
function clavisReopenDelay(which, startedAt) {
  const lived = startedAt ? Date.now() - startedAt : 0;
  if (lived > 4000) { clavisReopen[which] = 0; return 50; }
  const n = Math.min(clavisReopen[which]++, 5);
  return Math.min(140 * Math.pow(2, n), 3000);
}
function clavisShouldListen() {
  if (window.ClavisVoiceState && !window.ClavisVoiceState.canProcessMic()) return false;
  if (localStorage.getItem('clavis_mic_permission_granted') !== 'true') return false;
  if (!clavisGroqReady() && !(window.SpeechRecognition || window.webkitSpeechRecognition)) return false;
  if (!clavisIsAwake()) return jarvisHandsFree;
  // Awake: listen for the conversation (a typed turn opens the mic only in hands-free).
  return jarvisHandsFree || window.ClavisWake?.state?.().source !== 'typed';
}
function clavisMicAlive() {
  if (window.ClavisLive?.isActive?.()) return true;
  if (isGroqRecording || window.LocalSpeechEngine?.inputSocket) return true;
  if (clavisIsAwake()) return clavisEarAlive();
  return Boolean(wakeRecognition && (wakeRunning || Date.now() - wakeStartedAt < 3000));
}
function clavisEnsureListening() {
  if (window.ClavisVoiceState && !window.ClavisVoiceState.canProcessMic()) {
    if (clavisEar.rec) stopCommandEar();
    if (wakeRecognition) stopWakeListener();
    return;
  }
  if (clavisIsAwake()) {
    if (window.ClavisLive?.isActive?.()) return;
    if (clavisGroqReady() && (clavisSpeakingNow() || groqCapture.starting || jarvisController && !jarvisController.signal.aborted)) return;
    if (clavisShouldListen() && !clavisMicAlive()) {
      if (clavisGroqReady()) legacyStartGroqWhisperVoiceInput({ handsFreeCapture: true, awakeCapture: true, persistent: true });
      else legacyStartNativeSpeechRecognition({ handsFreeCapture: true, awakeCapture: true, persistent: true, followUp: !clavisFreshWake });
    }
    if (clavisEarAlive()) window.ClavisEar?.caption?.listening(true);
    if (!clavisSpeakingNow() && clavisEar.rec) setJarvisStatus('awake', CLAVIS_VS.isSilent() ? 'Chup hoon — sun raha hoon' : 'Boliye, sir…');
  } else {
    if (clavisEar.rec) stopCommandEar();
    if (jarvisHandsFree && !wakeRecognition) startWakeListener();
    if (!clavisSpeakingNow()) setJarvisStatus('idle', CLAVIS_ASLEEP_LABEL);
  }
  if (jarvisHandsFree && localStorage.getItem('clavis_sound_trigger_enabled') !== 'false' && !window.ClavisAudioTrigger?.running) startClavisSoundTriggers();
}
window.clavisEnsureListening = clavisEnsureListening;

function syncClavisWorkspaceAudio() {
  if (CLAVIS_VS.isClavisWorkspace()) {
    if (jarvisHandsFree || clavisGroqReady() && clavisIsAwake()) scheduleHandsFreeRelisten();
    return;
  }
  clearTimeout(relistenTimer);
  window.ClavisLive?.stop?.({ reason: 'view' });
  stopCommandEar();
  stopWakeListener(true);
  stopClavisSoundTriggers();
  stopJarvisSpeech();
  window.ClavisEar?.caption?.clear?.();
  document.getElementById('clavis-ai-speech-caption')?.classList.remove('is-visible');
}
window.addEventListener('clavis:workspace-change', syncClavisWorkspaceAudio);
window.addEventListener('rudra:auth-state', syncClavisWorkspaceAudio);

// The watchdog: never a dead mic, never stuck busy (clavis-voice-state.js).
CLAVIS_VS.configure({
  shouldListen: () => clavisShouldListen() && !isGroqRecording,
  alive: clavisMicAlive,
  revive: () => { console.info('[Rudra24 AI voice] mic was not listening — restarting'); clavisEnsureListening(); },
  busyTurn: () => Boolean(jarvisController) || clavisTurnHeld,
  speaking: clavisSpeakingNow,
  debug: () => ({
    asr: window.ClavisLive?.isActive?.() ? 'Gemini Live' : clavisEar.rec ? `web speech ${clavisEarLang()}${clavisEar.running ? '' : ' (reopening)'}` : wakeRecognition ? `wake ${clavisWakeLang()}` : isGroqRecording ? 'groq' : 'off',
    llm: jarvisController ? 'generating' : 'idle',
    tts: clavisSpeakingNow() ? 'speaking' : CLAVIS_VS.isSilent() ? 'silent mode' : 'idle',
  }),
});

// Soft two-tone chime so the user knows Jarvis is now listening.
/* Wake chime — a soft glass bell, not a beep: three rising notes (E·G#·B,
   a bright major arpeggio), each a sine + quiet octave partial with a 10 ms
   attack and a long natural decay, through a gentle low-pass and one faint
   echo. ~0.9 s, quiet enough to sit under speech. One shared AudioContext,
   so it starts instantly instead of spinning up a new one each wake.
   The orb answers with a single soft ripple at the same moment. */
let clavisChimeCtx = null;
function playWakeChime() {
  try {
    const orb = document.getElementById('orb-container');
    const reduce = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (orb && orb.offsetWidth && !reduce && orb.animate) {
      // two soft rings breathe out from the orb, like a held breath let go
      const r = orb.getBoundingClientRect();
      [0, 180].forEach((delay) => {
        const ring = document.createElement('span');
        ring.className = 'clavis-wake-ring';
        ring.style.left = Math.round(r.left + r.width / 2) + 'px';
        ring.style.top = Math.round(r.top + r.height / 2) + 'px';
        ring.style.width = Math.round(Math.min(r.width, r.height)) + 'px';
        document.body.appendChild(ring);   // outside the orb, so nothing clips it
        const a = ring.animate([
          { transform: 'translate(-50%, -50%) scale(0.72)', opacity: 0.55 },
          { transform: 'translate(-50%, -50%) scale(1.45)', opacity: 0 },
        ], { duration: 1100, delay, easing: 'cubic-bezier(.16,1,.3,1)', fill: 'both' });
        a.onfinish = () => ring.remove();
      });
      orb.animate([{ transform: 'scale(1)' }, { transform: 'scale(1.045)' }, { transform: 'scale(1)' }],
        { duration: 620, easing: 'cubic-bezier(.32,.72,0,1)' });
    }
  } catch (_) {}
  try {
    if (localStorage.getItem('clavis_wake_chime') === 'false') return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    if (!clavisChimeCtx || clavisChimeCtx.state === 'closed') clavisChimeCtx = new AC({ latencyHint: 'interactive' });
    const ctx = clavisChimeCtx;
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
    const now = ctx.currentTime + 0.01;
    const master = ctx.createGain();
    master.gain.value = 0.16;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass'; lp.frequency.value = 5200; lp.Q.value = 0.4;
    const echo = ctx.createDelay(0.5); echo.delayTime.value = 0.19;
    const echoGain = ctx.createGain(); echoGain.gain.value = 0.18;
    master.connect(lp); lp.connect(ctx.destination);
    lp.connect(echo); echo.connect(echoGain); echoGain.connect(ctx.destination);
    [[659.25, 0], [830.61, 0.085], [987.77, 0.17]].forEach(([f, t], i) => {
      [[1, 1], [2, 0.18]].forEach(([mult, amp]) => {
        const o = ctx.createOscillator(), g = ctx.createGain();
        o.type = 'sine';
        o.frequency.value = f * mult;
        const peak = amp * (i === 2 ? 0.9 : 0.7);
        const tail = i === 2 ? 0.95 : 0.55;
        g.gain.setValueAtTime(0.0001, now + t);
        g.gain.exponentialRampToValueAtTime(peak, now + t + 0.012);
        g.gain.exponentialRampToValueAtTime(0.0001, now + t + tail);
        o.connect(g); g.connect(master);
        o.start(now + t); o.stop(now + t + tail + 0.05);
      });
    });
  } catch (_) { /* audio not available */ }
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
    <p class="clavis-cloud-voice-help">Choose Grok Neural Voice in System Settings, or leave Auto enabled when your xAI key is connected. Without a key, Rudra24 AI safely falls back to the browser voice.</p>`;
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
  showToast('success', 'Grok voice selected', `${voice} will be used for expressive Rudra24 AI replies.`);
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
    <small>Chrome uses one recognition language per session; Rudra24 AI TTS can still speak mixed Hindi-English in one voice.</small>`;
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
function toggleJarvisSpeech(enabled) {
  jarvisSpeechEnabled = typeof enabled === 'boolean' ? enabled : !jarvisSpeechEnabled;
  localStorage.setItem('jarvis_speech_enabled', String(jarvisSpeechEnabled));
  localStorage.setItem('clavis_voice_muted', jarvisSpeechEnabled ? '0' : '1');
  if (typeof CLAVIS_VS !== 'undefined' && CLAVIS_VS.setVoiceOutputEnabled) {
    CLAVIS_VS.setVoiceOutputEnabled(jarvisSpeechEnabled, 'speech toggle');
  }
  if (!jarvisSpeechEnabled) {
    stopJarvisSpeech();
  }
  updateJarvisSpeechIcon();
  showToast('info', jarvisSpeechEnabled ? 'Voice Replies On' : 'Voice Replies Off', jarvisSpeechEnabled ? 'Rudra24 AI will speak its replies aloud.' : '');
}

function updateJarvisSpeechIcon() {
  const btn = document.getElementById('jarvis-speak-toggle');
  if (btn) {
    btn.classList.toggle('active', jarvisSpeechEnabled);
    btn.setAttribute('aria-pressed', String(jarvisSpeechEnabled));
  }
}

// Most of Rudra24 AI's replies are Hinglish written in LATIN script ("Sun raha
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
  // so Rudra24 AI speaks naturally like a human instead of reading symbols.
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
  const statusLine = (() => { try { return window.ClavisVoice?.toHinglish?.(clean) || clean; } catch (_) { return clean; } })();
  setJarvisStatus('speaking', statusLine.slice(0, 48) + (statusLine.length > 48 ? '...' : ''));
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
    clavisReleaseSpeech();
    if (clavisIsAwake()) setJarvisStatus('awake', 'Haan sir, boliye...');
    else setJarvisStatus('idle', CLAVIS_ASLEEP_LABEL);
    if (jarvisHandsFree || clavisGroqReady() && clavisIsAwake()) scheduleHandsFreeRelisten();
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

// ── Rudra24 AI voice director v2 ─────────────────────────────────────────────
// Defined after the legacy renderer above so the runtime uses this single
// implementation. It fixes the old cloud/native race and gives xAI's current
// expressive TTS first priority when an xAI key is available.
function stopJarvisSpeech() {
  clavisReleaseSpeech();
  document.getElementById('clavis-ai-speech-caption')?.classList.remove('is-visible');
  // Whoever stops the voice also clears "speaking" (speakJarvisText sets it
  // again right after when it starts the next line).
  isJarvisSpeaking = false;
  window.ClavisEar?.noteSpeakingDone?.();
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
  const fishVoice = document.getElementById('sm-fish-voice-id');
  if (fishVoice) fishVoice.value = localStorage.getItem('clavis_fish_voice_id') || '';
  const ttsModel = document.getElementById('sm-tts-model');
  if (ttsModel) ttsModel.value = localStorage.getItem('clavis_tts_provider') || 'fish_audio';
}

// One interruption path for native, Piper, and xAI playback. The detector
// itself disarms before invoking this callback; restart capture only in
// hands-free mode so a normal tap-to-talk session stays predictable.
function handleClavisBargeIn(capture) {
  const discard = () => {
    if (!capture) return;
    try { if (capture.recorder.state === 'recording') capture.recorder.stop(); } catch (_) {}
    capture.stream.getTracks().forEach(track => track.stop());
  };
  if (!interruptClavisSpeech()) { discard(); return; }
  // Barge-in sirf awaaz rokta hai — soye hue Rudra24 AI ko jagata ya window
  // badhata nahi (proactive awaaz ke beech TV/koi aur bola to so hi raho).
  if (!clavisIsAwake()) {
    discard();
    CLAVIS_VS.set('SLEEPING', 'barge while asleep');
    setJarvisStatus('idle', CLAVIS_ASLEEP_LABEL);
    return;
  }
  // The command ear is already open and hearing him; just make sure.
  window.ClavisEar?.caption?.listening(true);
  setJarvisStatus('awake', 'Haan sir, boliye...');
  if (capture && clavisGroqReady()) {
    stopGroqCapture();
    startJarvisVoiceInput({handsFreeCapture:true,capture});
    return;
  }
  discard();
  clavisEnsureListening();
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
    clavisReleaseSpeech();
    if (clavisIsAwake()) setJarvisStatus('awake', 'Haan sir, boliye...');
    else setJarvisStatus('idle', CLAVIS_ASLEEP_LABEL);
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
// What the voice may say: no [[directives]], no markdown, no links/URLs.
/* Written "Rudra", spoken "Rudraa".
   Two separate problems, one place to fix both:
   - "Rudra24 AI" is the product's name on screen. Said out loud a TTS engine
     reads the number as a word — "Rudra chobis AI".
   - Plain "Rudra" comes out clipped, closer to "Rudr". The long vowel is what
     makes the engine hold it.
   Screen text is never touched; only what goes to the voice. */
const CLAVIS_SPOKEN_NAME_RE = /\bRudra\s*-?\s*24(?:\s*(?:AI\b|A\.\s?I\.))?|\bRudra\b/gi;

function clavisSpeakable(text) {
  return clavisStripSilent(text)
    .replace(CLAVIS_SPOKEN_NAME_RE, 'Rudraa')
    .replace(/\|\|\|[\s\S]*?\|\|\|/g, '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/https?:\/\/\S+/g, '')
    .replace(/[*_#~>`]/g, '')
    .replace(/^\s*([-*•]|\d+[.)])\s+/gm, '')
    .replace(CLAVIS_EMOJI_RE, '')
    .replace(/\n+/g, '. ')
    .replace(/([.?!।])\s*\.\s/g, '$1 ')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

// Marks tts_first_audio when the voice engine actually starts playing.
function clavisWatchFirstAudio(requestId) {
  const t0 = Date.now();
  const iv = setInterval(() => {
    if (requestId !== jarvisSpeechRequestId || Date.now() - t0 > 15000) { clearInterval(iv); return; }
    let on = false;
    try { on = Boolean(window.ClavisVoice?.isSpeaking?.() || window.speechSynthesis?.speaking || (currentPlayingAudio && !currentPlayingAudio.paused)); } catch (_) {}
    if (on) { window.ClavisVoiceState?.mark?.('tts_first_audio'); clearInterval(iv); }
  }, 40);
}

// Speaks a streamed reply sentence by sentence: the first sentence starts
// while the LLM is still writing; sentences that arrive meanwhile are said
// together next. A barge-in / new turn aborts `signal` and the queue stops.
function clavisStreamSpeaker(signal) {
  const q = [];
  let pump = null, spoke = false, cut = false;
  const run = async () => {
    while (q.length && !signal?.aborted && !cut) {
      const chunk = q.splice(0, q.length).join(' ');
      spoke = true;
      // Cut off (barge-in / "chup" / a new turn) → the rest is not said either.
      if (await speakJarvisText(chunk, { stream: true, signal, forceRepeat: true }) === false) cut = true;
    }
    pump = null;
  };
  return {
    push(sentence) { if (signal?.aborted || cut) return; q.push(sentence); if (!pump) pump = run(); },
    async finish() { while (pump) await pump; },
    get spoke() { return spoke; },
  };
}

// A tool that takes more than 1.5 s gets a short spoken "Ek second…" (voice
// turns only, once, and never over something already being said).
let clavisToolsRunning = 0;
let clavisAckTimer = null;
function clavisToolAck(step, source, spoke) {
  if (step.type === 'tool_start') {
    clavisToolsRunning++;
    window.ClavisVoiceState?.set?.('EXECUTING', step.skill || 'tool');
    if (source !== 'voice' || !jarvisSpeechEnabled || clavisAckTimer || spoke()) return;
    const ctl = jarvisController;
    clavisAckTimer = setTimeout(() => {
      clavisAckTimer = null;
      if (clavisToolsRunning > 0 && !spoke() && !clavisSpeakingNow() && ctl && ctl === jarvisController && !ctl.signal.aborted && !window.ClavisVoiceState?.isSilent?.()) {
        const lines = ['Ek second, sir…', 'Bas ek pal, sir…', 'Dekh raha hoon, sir…'];
        speakJarvisText(lines[Math.floor(Math.random() * lines.length)]);
      }
    }, 1500);
  } else if (step.type === 'tool_result') {
    clavisToolsRunning = Math.max(0, clavisToolsRunning - 1);
    if (!clavisToolsRunning) { clearTimeout(clavisAckTimer); clavisAckTimer = null; window.ClavisVoiceState?.set?.('PROCESSING', 'tool done'); }
  }
}

// "Say things once." Chhoti canned line (hmm, ji sir, ek second sir, kuch aur
// chahiye) model se baar-baar nikal jaati thi aur bot jaisa lagta tha. Ek hi
// line 60 sec me dobara nahi bolegi. Lambe jawab par ye laagu nahi hota —
// wo kabhi-kabhi sach me dohrane padte hain — aur opts.force hamesha bolta hai.
const clavisSaidAt = new Map();
const CLAVIS_ECHO_MS = 60000;
const CLAVIS_ECHO_MAX_LEN = 90;
function clavisJustSaid(line) {
  const key = String(line).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
  if (!key || key.length > CLAVIS_ECHO_MAX_LEN) return false;
  const now = Date.now();
  for (const [k, t] of clavisSaidAt) if (now - t > CLAVIS_ECHO_MS) clavisSaidAt.delete(k);
  const seen = clavisSaidAt.get(key);
  clavisSaidAt.set(key, now);
  return seen !== undefined && now - seen < CLAVIS_ECHO_MS;
}

async function speakJarvisText(text, opts = {}) {
  const clean = clavisSpeakable(text);
  if (!clean) return false;
  if (opts.signal?.aborted) return false;
  if (!opts.force && !opts.forceRepeat && clavisJustSaid(clean)) return false;
  if (window.ClavisVoiceState && !window.ClavisVoiceState.isClavisWorkspace?.()) return false;
  // Silent mode ("5 minute chup raho"): listens, shows, never speaks.
  if (window.ClavisVoiceState?.isSilent?.() && !opts.force) return false;
  if (window.ClavisVoiceState && !window.ClavisVoiceState.canSpeak() && !opts.force) return false;
  // During a Live session there is one voice: Rudra24 AI Live says it.
  if (window.ClavisLive?.isActive?.()) {
    stopJarvisSpeech();
    return window.ClavisLive.relay(clean);
  }

  stopJarvisSpeech();
  const requestId = ++jarvisSpeechRequestId;
  const controller = new AbortController();
  const abortSpeech = () => { controller.abort(); if (requestId === jarvisSpeechRequestId) stopJarvisSpeech(); };
  opts.signal?.addEventListener('abort', abortSpeech, { once: true });
  jarvisSpeechAbortController = controller;
  const active = () => requestId === jarvisSpeechRequestId && !controller.signal.aborted;
  isJarvisSpeaking = true;
  clavisHoldSpeech();   // jaaga ho to bolte waqt window expire na ho
  if (clavisIsAwake()) window.ClavisVoiceState?.set?.('ASSISTANT_SPEAKING', 'tts');
  clavisWatchFirstAudio(requestId);
  setJarvisStatus('speaking', clean.slice(0, 48) + (clean.length > 48 ? '...' : ''));
  window.ClavisMind?.noteSpeakingStarted?.(clean);
  window.ClavisEar?.noteSpeaking?.(clean);
  window.ClavisBargeIn?.arm?.(handleClavisBargeIn).catch?.(() => {});
  // Bolne ke liye `clean` (TTS khud Devanagari banata hai jahan chahiye),
  // par screen par hamesha ek hi script — Roman Hinglish.
  const shown = (() => {
    try { return window.ClavisVoice?.toHinglish?.(clean) || clean; } catch (_) { return clean; }
  })();
  const subtitle = document.getElementById('jarvis-subtitle-text');
  if (subtitle) subtitle.textContent = shown;
  const speechCaption = document.getElementById('clavis-ai-speech-caption');
  if (speechCaption) { speechCaption.textContent = shown; speechCaption.classList.add('is-visible'); }

  const onSpeechFinished = () => {
    opts.signal?.removeEventListener('abort', abortSpeech);
    if (!active()) return;
    speechCaption?.classList.remove('is-visible');
    isJarvisSpeaking = false;
    jarvisSpeechAbortController = null;
    window.ClavisMind?.noteSpeakingStopped?.(); window.ClavisEar?.noteSpeakingDone?.();
    window.ClavisBargeIn?.disarm?.();
    clavisReleaseSpeech();   // bol chuka → follow-up window yahin se shuru
    if (window.ClavisVoiceState?.state?.() === 'ASSISTANT_SPEAKING') window.ClavisVoiceState.rest('spoke');
    if (clavisIsAwake()) setJarvisStatus('awake', 'Haan sir, boliye...');
    else setJarvisStatus('idle', CLAVIS_ASLEEP_LABEL);
    if (jarvisHandsFree) scheduleHandsFreeRelisten();
  };

  // Tier 0: ClavisVoice — Google AI Studio TTS (natural Hindi + English) when
  // a key is connected; otherwise the right browser voice per sentence, so
  // Hindi is read by the Hindi voice instead of "Google UK English Male".
  const fishReady = opts.engine !== 'browser' && window.ClavisDirect?.keyFor?.('fish_audio')
    && localStorage.getItem('clavis_fish_voice_id')?.trim() && window.ClavisDirect?.ttsWithFish;
  const preferGoogle = localStorage.getItem('clavis_tts_provider') === 'gemini';
  let remainingText = clean;
  if (fishReady && preferGoogle && window.ClavisVoice) {
    try {
      const result = await window.ClavisVoice.speak(remainingText, { signal: controller.signal, style: opts.style, cloudOnly: true });
      if (result === true) {
        onSpeechFinished(); return true;
      }
      if (result?.remaining) remainingText = result.remaining;
    } catch (error) { console.warn('[Google TTS] Switching to Fish Audio:', error); }
    if (!active()) return false;
  }
  if (fishReady) {
    let fishUrl = '';
    let fishAudio = null;
    try {
      fishUrl = await window.ClavisDirect.ttsWithFish(remainingText, controller.signal);
      if (!active()) { URL.revokeObjectURL(fishUrl); return false; }
      fishAudio = new Audio(fishUrl);
      currentPlayingAudio = fishAudio;
      await new Promise((resolve, reject) => {
        const abort = () => reject(new DOMException('Speech canceled', 'AbortError'));
        fishAudio.onended = resolve;
        fishAudio.onerror = () => reject(new Error('Fish Audio returned audio the browser could not play.'));
        controller.signal.addEventListener('abort', abort, { once: true });
        fishAudio.play().catch(reject);
      });
      URL.revokeObjectURL(fishUrl);
      if (currentPlayingAudio === fishAudio) currentPlayingAudio = null;
      if (active()) onSpeechFinished();
      return true;
    } catch (e) {
      if (fishUrl) URL.revokeObjectURL(fishUrl);
      if (fishAudio && currentPlayingAudio === fishAudio) currentPlayingAudio = null;
      try { fishAudio?.pause(); } catch (_) {}
      if (!active()) return false;
      if (fishAudio?.currentTime > 0) { onSpeechFinished(); return false; }
      console.warn('[Fish Audio TTS] Falling back to Gemini/browser speech:', e);
    }
  }

  if (window.ClavisVoice) {
    try {
      const ok = await window.ClavisVoice.speak(remainingText, { signal: controller.signal, style: opts.style, engine: opts.engine });
      if (ok === true) { onSpeechFinished(); return true; }
      if (!active()) return false;
      // A partial provider failure must never replay the response in another voice.
      onSpeechFinished();
      if (window.ClavisVoice.status?.().lastError) {
        setJarvisStatus('error', 'Voice unavailable — written reply is ready');
        window.showToast?.({ type: 'warning', title: 'Voice playback unavailable', message: 'The written reply is ready. Check your voice provider in Setup, or retry shortly.' });
      }
      return false;
    } catch (e) { console.warn('[ClavisVoice]', e); onSpeechFinished(); return false; }
  }

  // Tier 1: Local backend speech engine (if present & running)
  if (!window.LocalSpeechEngine?.isBackendUnavailable?.()
      && (window.LocalSpeechEngine?.outputSocket || window.LocalSpeechEngine?.speak)) {
    try {
      await window.LocalSpeechEngine.speak(remainingText, { signal: controller.signal });
      onSpeechFinished();
      return true;
    } catch (e) {
      console.warn('[Rudra24 AI speech] Local engine failed, falling back:', e);
    }
  }

  // Tier 2: OpenAI TTS (Human-like studio quality speech via alloy/nova)
  if (window.ClavisDirect?.keyFor?.('openai') && window.ClavisDirect?.ttsWithOpenAI) {
    try {
      const audioUrl = await window.ClavisDirect.ttsWithOpenAI(remainingText, 'alloy');
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
      console.warn('[Rudra24 AI OpenAI TTS fallback]:', err);
    }
  }

  // Tier 3: Browser SpeechSynthesis (works 100% offline, native Indian English / Hindi voices)
  // ClavisVoice already tried natural Hindi voices. The old generic browser
  // renderer mispronounces Hinglish, so never reintroduce it on that path.
  if (isHindiishText(remainingText)) { onSpeechFinished(); return false; }
  try {
    // The legacy renderer was deliberately kept under its migration name;
    // calling the removed alias made every browser fallback fail before a
    // SpeechSynthesis utterance was ever queued.
    const spoke = await legacySpeakJarvisTextV1(remainingText);
    return spoke;
  } catch (err) {
    console.warn('[Rudra24 AI browser voice fallback failed]:', err);
    onSpeechFinished();
    return false;
  }
}

function testJarvisVoice() {
  const honorific = window.UserProfileManager?.getHonorificName?.() || 'Sir';
  speakJarvisText(`Namaste ${honorific}! Main Rudra24 AI hoon. Aapki awaaz settings ab test ho rahi hain — sab kuch sahi lag raha hai?`);
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
//  RUDRA24 AI COMPANY ENRICHMENT CHAT INTEGRATION
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
        window.showToast('Screenshot attached. Ask Rudra24 AI to inspect or analyze it.', 'info');
      }
    });
  }

  // Global window paste handler when Rudra24 AI tab is active
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
                window.showToast('Screenshot attached. Ask Rudra24 AI to inspect or analyze it.', 'info');
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
          Rudra24 AI is ready to run deep contact discovery:
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
