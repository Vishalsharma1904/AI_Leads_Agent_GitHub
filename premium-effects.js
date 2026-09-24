/**
 * premium-effects.js
 * ============================================================
 * Premium UI Effects System — v1.0
 * - Card blur/focus depth effect (items blur, hover = sharp)
 * - Enhanced 3D card tilt with spring physics
 * - Mic permission: ask only ONCE, persist in localStorage
 * - Sidebar mouse hover animations
 * - Login-page style glow effects throughout the app
 * - Hover effect variants (settings se toggle)
 * ============================================================
 */
'use strict';

// ══════════════════════════════════════════════════════════════
//  SECTION 1: SETTINGS / PREFERENCES
// ══════════════════════════════════════════════════════════════
const PremiumFX = {
  // Read a setting from localStorage with a default fallback
  getSetting(key, defaultVal) {
    const v = localStorage.getItem('pfx_' + key);
    if (v === null) return defaultVal;
    if (v === 'true') return true;
    if (v === 'false') return false;
    return v;
  },
  setSetting(key, val) {
    localStorage.setItem('pfx_' + key, String(val));
  },

  // All toggleable features (disabled for clean Apple HIG)
  isCardBlurEnabled()     { return false; },
  isCard3DTiltEnabled()   { return false; },
  isCursorGlowEnabled()   { return false; },
  isSidebarGlowEnabled()  { return false; },
  isParticleEnabled()     { return false; },
  getHoverVariant()       { return 'minimal'; }, // minimal clean Apple styling
};

window.PremiumFX = PremiumFX;

// ══════════════════════════════════════════════════════════════
//  SECTION 2: MIC PERMISSION — ASK ONLY ONCE
// ══════════════════════════════════════════════════════════════
(function patchMicPermission() {
  const MIC_KEY = 'skylark-mic-permission-granted';
  const MIC_DENIED_KEY = 'skylark-mic-permission-denied';

  // Patch AudioAnalyzer.init so it only fires the browser dialog once
  // and thereafter reads from localStorage
  const _origGetUserMedia = navigator.mediaDevices && navigator.mediaDevices.getUserMedia
    ? navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices)
    : null;

  if (!_origGetUserMedia) return;

  navigator.mediaDevices.getUserMedia = async function(constraints) {
    if (constraints && constraints.audio) {
      // If we already have denial recorded, throw immediately — no browser popup
      if (localStorage.getItem(MIC_DENIED_KEY) === 'true') {
        throw new DOMException('Microphone access was previously denied.', 'NotAllowedError');
      }
      // If we already have permission, skip the redundant check
      if (localStorage.getItem(MIC_KEY) === 'true') {
        try {
          const stream = await _origGetUserMedia(constraints);
          return stream;
        } catch(e) {
          if (e.name === 'NotAllowedError' || e.name === 'PermissionDeniedError') {
            localStorage.setItem(MIC_DENIED_KEY, 'true');
            localStorage.setItem(MIC_KEY, 'false');
          }
          throw e;
        }
      }
      // First time — request permission
      try {
        const stream = await _origGetUserMedia(constraints);
        localStorage.setItem(MIC_KEY, 'true');
        localStorage.removeItem(MIC_DENIED_KEY);
        return stream;
      } catch(e) {
        if (e.name === 'NotAllowedError' || e.name === 'PermissionDeniedError') {
          localStorage.setItem(MIC_DENIED_KEY, 'true');
          localStorage.setItem(MIC_KEY, 'false');
        }
        throw e;
      }
    }
    return _origGetUserMedia(constraints);
  };

  // Also patch Web Speech API's SpeechRecognition to avoid permission re-ask
  const origSpeechRec = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!origSpeechRec) return;

  // Wrap SpeechRecognition so denied users see a clear toast instead of browser prompt
  const PatchedSpeechRec = function(...args) {
    const instance = new origSpeechRec(...args);
    const _origStart = instance.start.bind(instance);
    instance.start = function() {
      if (localStorage.getItem(MIC_DENIED_KEY) === 'true') {
        const settingsEnabled = localStorage.getItem('skylark-mic-enabled') === 'true';
        if (!settingsEnabled) {
          if (typeof showToast === 'function') {
            showToast('warning', 'Microphone Blocked',
              'Mic access denied. Settings → Voice AI → Enable Microphone.');
          }
          return;
        }
      }
      _origStart();
    };
    return instance;
  };
  PatchedSpeechRec.prototype = origSpeechRec.prototype;
  try {
    window.SpeechRecognition = PatchedSpeechRec;
    window.webkitSpeechRecognition = PatchedSpeechRec;
  } catch(e) { /* read-only in some environments */ }

  console.info('[PremiumFX] Mic permission: one-time grant system active.');
})();

// ══════════════════════════════════════════════════════════════
//  SECTION 3: CARD DEPTH BLUR ENGINE
//  Cards appear slightly blurred / soft-focus when idle.
//  On mouse hover the hovered card becomes crystal clear while
//  neighbouring cards stay softly blurred — premium depth effect.
// ══════════════════════════════════════════════════════════════
function initCardDepthBlur() {
  if (!PremiumFX.isCardBlurEnabled()) return;

  const style = document.createElement('style');
  style.id = 'pfx-card-blur-style';
  style.textContent = `
    /* ── CARD DEPTH BLUR SYSTEM ── */
    /* NOTE: .agent-config-card / .agent-progress-card / .pipeline-node are
       deliberately EXCLUDED — they are large layout containers, and applying
       depth-blur to them made the non-hovered card visibly dim (looked like
       one card reacting to the other). */
    .stat-card, .do-stat-card, .chart-card, .do-chart-wrap,
    .analytics-card, .recent-leads-card, .do-activity-feed {
      opacity: 0.96;
      transform: translateZ(0);
      transition: opacity 0.35s cubic-bezier(0.23,1,0.32,1),
                  transform 0.35s cubic-bezier(0.23,1,0.32,1),
                  box-shadow 0.35s cubic-bezier(0.23,1,0.32,1),
                  border-color 0.25s ease !important;
    }

    /* Hovered card becomes fully sharp & pops forward */
    .stat-card:hover, .do-stat-card:hover, .chart-card:hover, .do-chart-wrap:hover,
    .analytics-card:hover, .recent-leads-card:hover, .do-activity-feed:hover {
      opacity: 1 !important;
      transform: translateY(-3px) translateZ(0) scale(1.005) !important;
      z-index: 10 !important;
    }

    /* Sibling-dimming REMOVED — hovering one card must never visually
       alter another card. That behaviour read as a bug. */
  `;
  document.head.appendChild(style);
}

// ══════════════════════════════════════════════════════════════
//  SECTION 4: ENHANCED 3D CARD TILT WITH SPRING PHYSICS
//  Better than basic mousemove — uses spring interpolation
//  for a buttery natural feel like the login card.
// ══════════════════════════════════════════════════════════════
function initCard3DTilt() {
  if (!PremiumFX.isCard3DTiltEnabled()) return;

  const TILT_STRENGTH = 8;    // max tilt degrees
  const SPRING = 0.1;         // spring interpolation factor (lower = slower)
  const PERSPECTIVE = 900;

  const tiltState = new Map(); // card → { tx, ty, x, y, raf, glowX, glowY }

  function attachTilt(card) {
    if (tiltState.has(card)) return;
    const state = { tx: 0, ty: 0, x: 0, y: 0, raf: null, glowX: 50, glowY: 50 };
    tiltState.set(card, state);

    // Add glow layer if variant is not minimal
    const variant = PremiumFX.getHoverVariant();
    if (variant !== 'minimal') {
      if (!card.querySelector('.pfx-card-glow')) {
        const glow = document.createElement('div');
        glow.className = 'pfx-card-glow';
        card.style.position = 'relative';
        card.style.overflow = 'hidden';
        card.appendChild(glow);
      }
    }

    card.addEventListener('mousemove', (e) => {
      const rect = card.getBoundingClientRect();
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;
      state.tx = ((e.clientX - cx) / (rect.width / 2)) * TILT_STRENGTH;
      state.ty = ((e.clientY - cy) / (rect.height / 2)) * -TILT_STRENGTH;
      state.glowX = ((e.clientX - rect.left) / rect.width) * 100;
      state.glowY = ((e.clientY - rect.top) / rect.height) * 100;

      // Update glow position
      const glowEl = card.querySelector('.pfx-card-glow');
      if (glowEl) {
        glowEl.style.setProperty('--gx', state.glowX + '%');
        glowEl.style.setProperty('--gy', state.glowY + '%');
        glowEl.style.opacity = '1';
      }

      if (!state.raf) {
        state.raf = requestAnimationFrame(function tick() {
          state.x += (state.tx - state.x) * SPRING;
          state.y += (state.ty - state.y) * SPRING;
          card.style.transform = `perspective(${PERSPECTIVE}px) rotateY(${state.x.toFixed(3)}deg) rotateX(${state.y.toFixed(3)}deg) translateY(-3px) scale(1.005)`;
          const diff = Math.abs(state.x - state.tx) + Math.abs(state.y - state.ty);
          state.raf = diff > 0.01 ? requestAnimationFrame(tick) : null;
        });
      }
    });

    card.addEventListener('mouseleave', () => {
      state.tx = 0;
      state.ty = 0;
      const glowEl = card.querySelector('.pfx-card-glow');
      if (glowEl) glowEl.style.opacity = '0';
      if (!state.raf) {
        state.raf = requestAnimationFrame(function tick() {
          state.x += (0 - state.x) * SPRING;
          state.y += (0 - state.y) * SPRING;
          card.style.transform = `perspective(${PERSPECTIVE}px) rotateY(${state.x.toFixed(3)}deg) rotateX(${state.y.toFixed(3)}deg)`;
          const diff = Math.abs(state.x) + Math.abs(state.y);
          if (diff > 0.01) {
            state.raf = requestAnimationFrame(tick);
          } else {
            state.x = 0; state.y = 0;
            card.style.transform = '';
            state.raf = null;
          }
        });
      }
    });
  }

  // Attach to current cards.
  // Excluded on purpose: .agent-config-card, .agent-progress-card,
  // .email-sidebar-card, .gmail-compose-card — these are full-height layout
  // panels. 3D-rotating them looked broken, not premium.
  function attachAll() {
    document.querySelectorAll(
      '.stat-card, .do-stat-card, .chart-card, .do-chart-wrap, .analytics-card'
    ).forEach(attachTilt);
  }
  attachAll();

  // Re-attach after view changes using MutationObserver
  const observer = new MutationObserver(() => attachAll());
  observer.observe(document.getElementById('main-scroll-area') || document.body, {
    childList: true, subtree: true
  });

  // Inject glow CSS per hover variant
  injectGlowCSS();
}

function injectGlowCSS() {
  const variant = PremiumFX.getHoverVariant();
  if (document.getElementById('pfx-glow-style')) document.getElementById('pfx-glow-style').remove();
  const style = document.createElement('style');
  style.id = 'pfx-glow-style';

  const glowMap = {
    aurora: `radial-gradient(circle 200px at var(--gx, 50%) var(--gy, 50%),
               rgba(108,92,231,0.22) 0%, rgba(168,85,247,0.10) 40%, transparent 70%)`,
    neon:   `radial-gradient(circle 180px at var(--gx, 50%) var(--gy, 50%),
               rgba(0,210,255,0.28) 0%, rgba(0,122,255,0.12) 40%, transparent 70%)`,
    minimal:`none`,
    frost:  `radial-gradient(circle 200px at var(--gx, 50%) var(--gy, 50%),
               rgba(255,255,255,0.18) 0%, rgba(200,220,255,0.08) 50%, transparent 70%)`,
  };

  style.textContent = `
    .pfx-card-glow {
      position: absolute;
      inset: 0;
      pointer-events: none;
      background: ${glowMap[variant] || glowMap.aurora};
      opacity: 0;
      transition: opacity 0.25s ease;
      z-index: 1;
      border-radius: inherit;
    }
  `;
  document.head.appendChild(style);
}

window.pfxSetHoverVariant = function(variant) {
  PremiumFX.setSetting('hover_variant', variant);
  document.documentElement.dataset.hoverGlow = variant;
};

// ══════════════════════════════════════════════════════════════
//  SECTION 5: CURSOR GLOW THROUGHOUT THE APP
//  Like the login page spotlight — follows cursor inside main content
// ══════════════════════════════════════════════════════════════
function initCursorGlow() {
  if (!PremiumFX.isCursorGlowEnabled()) return;

  const glow = document.createElement('div');
  glow.id = 'pfx-cursor-glow';
  document.body.appendChild(glow);

  const style = document.createElement('style');
  style.textContent = `
    #pfx-cursor-glow {
      position: fixed;
      width: 500px;
      height: 500px;
      border-radius: 50%;
      pointer-events: none;
      z-index: 0;
      transform: translate(-50%, -50%);
      background: radial-gradient(
        circle,
        rgba(108, 92, 231, 0.07) 0%,
        rgba(168, 85, 247, 0.04) 40%,
        transparent 70%
      );
      filter: blur(30px);
      transition: opacity 0.3s ease;
      opacity: 0;
    }
    [data-theme="light"] #pfx-cursor-glow {
      background: radial-gradient(
        circle,
        rgba(99,102,241,0.08) 0%,
        rgba(139,92,246,0.04) 40%,
        transparent 70%
      );
    }
  `;
  document.head.appendChild(style);

  let raf = null;
  let tx = 0, ty = 0, cx = 0, cy = 0;

  document.addEventListener('mousemove', (e) => {
    // Only show inside main content, not on auth
    const authScreen = document.getElementById('auth-screen');
    if (authScreen && authScreen.style.display !== 'none') { glow.style.opacity = '0'; return; }
    tx = e.clientX; ty = e.clientY;
    glow.style.opacity = '1';
    if (!raf) {
      raf = requestAnimationFrame(function move() {
        cx += (tx - cx) * 0.08;
        cy += (ty - cy) * 0.08;
        glow.style.left = cx + 'px';
        glow.style.top = cy + 'px';
        const diff = Math.abs(cx - tx) + Math.abs(cy - ty);
        raf = diff > 0.5 ? requestAnimationFrame(move) : null;
      });
    }
  }, { passive: true });

  document.addEventListener('mouseleave', () => { glow.style.opacity = '0'; });
}

// ══════════════════════════════════════════════════════════════
//  SECTION 6: SIDEBAR HOVER ANIMATIONS
//  Premium micro-animations on nav items
// ══════════════════════════════════════════════════════════════
function initSidebarAnimations() {
  if (!PremiumFX.isSidebarGlowEnabled()) return;

  const style = document.createElement('style');
  style.textContent = `
    /* Nav items: slide-in shimmer on hover */
    .nav-item, .nav-sub-item {
      position: relative;
      overflow: hidden;
    }
    .nav-item::after, .nav-sub-item::after {
      content: '';
      position: absolute;
      inset: 0;
      background: linear-gradient(
        105deg,
        transparent 30%,
        rgba(255,255,255,0.06) 50%,
        transparent 70%
      );
      transform: translateX(-100%);
      transition: transform 0s;
      pointer-events: none;
    }
    .nav-item:hover::after, .nav-sub-item:hover::after {
      transform: translateX(100%);
      transition: transform 0.5s cubic-bezier(0.23,1,0.32,1);
    }

    /* Active nav item: left accent glow bar */
    .nav-item.active::before, .nav-sub-item.active::before {
      content: '';
      position: absolute;
      left: 0; top: 20%; bottom: 20%;
      width: 2.5px;
      border-radius: 0 3px 3px 0;
      background: linear-gradient(180deg, #6C5CE7 0%, #a855f7 100%);
      box-shadow: 0 0 8px rgba(108,92,231,0.7);
    }
    [data-theme="light"] .nav-item.active::before,
    [data-theme="light"] .nav-sub-item.active::before {
      background: linear-gradient(180deg, #0063CF 0%, #0096c7 100%);
      box-shadow: 0 0 8px rgba(0,99,207,0.5);
    }

    /* Sidebar logo hover effect */
    .logo-mark {
      transition: transform 0.3s cubic-bezier(0.34,1.56,0.64,1),
                  box-shadow 0.3s ease !important;
    }
    .logo-mark:hover {
      transform: scale(1.12) rotate(5deg) !important;
      box-shadow: 0 4px 16px rgba(108,92,231,0.3) !important;
    }

    /* Sidebar footer items glow on hover */
    .footer-apify-row:hover .apify-badge-icon {
      color: #30D158 !important;
      filter: drop-shadow(0 0 6px rgba(48,209,88,0.6));
    }

    /* Nav section labels: fade in subtly */
    .nav-section-label {
      letter-spacing: 0.1em !important;
    }
  `;
  document.head.appendChild(style);
}

// ══════════════════════════════════════════════════════════════
//  SECTION 7: TOPBAR & BUTTON HOVER EFFECTS
// ══════════════════════════════════════════════════════════════
function initTopbarEffects() {
  const style = document.createElement('style');
  style.textContent = `
    /* Topbar right buttons — glow on hover */
    .generate-btn:hover {
      box-shadow: 0 4px 16px rgba(99,102,241,0.35) !important;
    }

    /* Table rows premium hover */
    .leads-table tbody tr:hover td {
      background: rgba(108,92,231,0.06) !important;
    }
    [data-theme="light"] .leads-table tbody tr:hover td {
      background: rgba(99,102,241,0.05) !important;
    }

    /* Quick chips hover glow */
    .chat-chip {
      transition: all 0.2s cubic-bezier(0.23,1,0.32,1) !important;
    }
    .chat-chip:hover {
      transform: translateY(-2px) !important;
      box-shadow: 0 4px 12px rgba(99,102,241,0.2) !important;
    }

    /* Do-quick-btn hover */
    .do-quick-btn:hover {
      box-shadow: 0 4px 14px rgba(0,0,0,0.12) !important;
    }

    /* Nav badge pulse */
    .nav-badge.green {
      animation: pfxBadgePulse 2s ease-in-out infinite;
    }
    @keyframes pfxBadgePulse {
      0%, 100% { box-shadow: 0 0 0 0 rgba(48,209,88,0.3); }
      50% { box-shadow: 0 0 0 4px rgba(48,209,88,0); }
    }

    /* Stat card shimmer on hover */
    .stat-card::after, .do-stat-card::after {
      content: '';
      position: absolute;
      top: 0; left: -60%; width: 40%; height: 100%;
      background: linear-gradient(
        90deg,
        transparent,
        rgba(255,255,255,0.04),
        transparent
      );
      transform: skewX(-20deg);
      transition: none;
      pointer-events: none;
    }
    .stat-card:hover::after, .do-stat-card:hover::after {
      animation: pfxShimmer 0.6s ease forwards;
    }
    @keyframes pfxShimmer {
      to { left: 120%; }
    }
  `;
  document.head.appendChild(style);
}

// ══════════════════════════════════════════════════════════════
//  SECTION 8: SETTINGS PANEL INTEGRATION
//  Expose toggles so the settings page can wire them up
// ══════════════════════════════════════════════════════════════
function initSettingsBindings() {
  // Load saved states into settings UI when settings opens
  document.addEventListener('settingsOpened', () => syncSettingsToggles());

  // Also fire when settings overlay opens
  const settingsOverlay = document.getElementById('settings-overlay');
  if (settingsOverlay) {
    const observer = new MutationObserver(() => {
      if (settingsOverlay.classList.contains('open')) syncSettingsToggles();
    });
    observer.observe(settingsOverlay, { attributes: true, attributeFilter: ['class'] });
  }
}

function syncSettingsToggles() {
  const map = {
    'pfx-toggle-blur':     ['card_blur', true],
    'pfx-toggle-tilt':     ['card_tilt', true],
    'pfx-toggle-cursor':   ['cursor_glow', true],
    'pfx-toggle-sidebar':  ['sidebar_glow', true],
    'mic-enabled-toggle':  null, // special case
  };
  for (const [id, cfg] of Object.entries(map)) {
    const el = document.getElementById(id);
    if (!el) continue;
    if (cfg) {
      el.checked = PremiumFX.getSetting(cfg[0], cfg[1]);
    } else if (id === 'mic-enabled-toggle') {
      // Mic is enabled unless explicitly set to false
      const micDenied = localStorage.getItem('skylark-mic-permission-denied') === 'true';
      const micExplicit = localStorage.getItem('skylark-mic-enabled');
      el.checked = micExplicit === null ? true : micExplicit !== 'false';
      if (micDenied && el.checked) {
        // Show denied state visually
        el.parentElement.style.opacity = '0.6';
        el.title = 'Mic permission denied in browser. Reload page and allow to re-enable.';
      }
    }
  }

  // Hover variant selector
  const variantSel = document.getElementById('pfx-hover-variant');
  if (variantSel) variantSel.value = PremiumFX.getHoverVariant();
}

window.pfxToggleSetting = function(key, val) {
  PremiumFX.setSetting(key, val);
  // Live update: re-init affected systems
  if (key === 'hover_variant') {
    window.pfxSetHoverVariant(val);
    return;
  }
  if (key === 'card_blur') {
    document.documentElement.toggleAttribute('data-card-depth', Boolean(val));
    document.getElementById('pfx-card-blur-style')?.remove();
    return;
  }
  if (key === 'cursor_glow') document.documentElement.dataset.cursorGlow = String(Boolean(val));
  if (key === 'card_tilt') document.documentElement.dataset.cardLift = String(Boolean(val));
  if (key === 'sidebar_glow') document.documentElement.dataset.sidebarGlow = String(Boolean(val));
};

window.pfxToggleMic = function(enabled) {
  localStorage.setItem('skylark-mic-enabled', String(enabled));
  if (!enabled) {
    // Stop any active wake listener
    if (typeof stopWakeListener === 'function') stopWakeListener();
    if (typeof jarvisHandsFree !== 'undefined' && jarvisHandsFree) {
      if (typeof toggleJarvisHandsFree === 'function') toggleJarvisHandsFree();
    }
    if (typeof showToast === 'function') {
      showToast('info', 'Microphone Disabled', 'Clavis will not use the mic until re-enabled.');
    }
  } else {
    // Reset denial flag so permission can be requested again
    localStorage.removeItem('skylark-mic-permission-denied');
    if (typeof showToast === 'function') {
      showToast('success', 'Microphone Enabled', 'Clavis can now use voice input.');
    }
  }
};

// ══════════════════════════════════════════════════════════════
//  INIT ALL EFFECTS
// ══════════════════════════════════════════════════════════════
function initAllPremiumEffects() {
  // Pointer/card transforms are owned by luxury-ui.js. Keeping a single
  // engine prevents lag, offset glows and neighbouring-card reactions.
  document.getElementById('pfx-cursor-glow')?.remove();
  document.querySelectorAll('.pfx-card-glow').forEach(el => el.remove());
  document.documentElement.dataset.hoverGlow = PremiumFX.getHoverVariant();
  document.documentElement.dataset.cursorGlow = String(PremiumFX.isCursorGlowEnabled());
  document.documentElement.dataset.cardLift = String(PremiumFX.isCard3DTiltEnabled());
  document.documentElement.dataset.sidebarGlow = String(PremiumFX.isSidebarGlowEnabled());
  document.documentElement.toggleAttribute('data-card-depth', PremiumFX.isCardBlurEnabled());
  initSidebarAnimations();
  initTopbarEffects();
  initSettingsBindings();
  console.info('[PremiumFX] Settings and static polish initialized; pointer effects delegated to LuxuryUI.');
}

// Public API for settings sync
window.pfxSyncSettings = syncSettingsToggles;

// Run after DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initAllPremiumEffects);
} else {
  // DOM already ready
  initAllPremiumEffects();
}
