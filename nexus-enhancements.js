/**
 * nexus-enhancements.js v2.0
 * ─────────────────────────────────────────────────────────────
 * 1. Dynamic User Branding: "[FirstName]'s A.I Agent"
 * 2. High-Performance Custom Dropdowns (Chat & Candidate AI Model Select)
 * 3. Draggable Resizable Sidebar with Snap-to-Collapse
 * 4. macOS Traffic Light Controls with Centered Hover Symbols
 * 5. Multi-Style Sound Synthesizer (Ambient, Crystal, Minimal, Sci-Fi)
 * 6. Interactive Animation & Sound Pickers injected into Settings Modal
 * ─────────────────────────────────────────────────────────────
 */
(function NexusEnhancements() {
  'use strict';

  var ANIM_LABELS = { spring: 'Spring', smooth: 'Smooth', snappy: 'Snappy', none: 'None' };
  var ANIM_ICONS  = { spring: '🌊', smooth: '✨', snappy: '⚡', none: '⏸' };

  var SOUND_LABELS = { ambient: 'Ambient', crystal: 'Crystal', minimal: 'Minimal', futuristic: 'Sci-Fi', off: 'Off' };
  var SOUND_ICONS  = { ambient: '🎵', crystal: '🔔', minimal: '💧', futuristic: '🚀', off: '🔇' };

  function getAnimStyle()  { return localStorage.getItem('nx-anim-style')  || 'spring'; }
  function getSoundStyle() { return localStorage.getItem('nx-sound-style') || 'ambient'; }

  /* ══════════════════════════════════════════════════════════════
     1. DYNAMIC USER BRANDING
     ══════════════════════════════════════════════════════════════ */
  function getFirstName() {
    try {
      var ud = JSON.parse(localStorage.getItem('skylark_user_profile') || '{}');
      if (ud.firstName) return ud.firstName;
      if (ud.name) return ud.name.split(' ')[0];
      var au = JSON.parse(localStorage.getItem('skylark_auth_user') || '{}');
      if (au.firstName) return au.firstName;
      if (au.displayName) return au.displayName.split(' ')[0];
      if (au.name) return au.name.split(' ')[0];
      if (au.email) {
        var lp = au.email.split('@')[0];
        return lp.charAt(0).toUpperCase() + lp.slice(1).split(/[._]/)[0];
      }
      var em = localStorage.getItem('skylark_logged_in_email') || localStorage.getItem('skylark_email');
      if (em) {
        var lp2 = em.split('@')[0];
        return lp2.charAt(0).toUpperCase() + lp2.slice(1).split(/[._]/)[0];
      }
    } catch (e) {}
    return null;
  }

  function updateBranding() {
    var el = document.getElementById('logo-brand-text');
    if (el) {
      el.textContent = 'Clavis AI';
    }
    var sub = document.querySelector('#sidebar .logo-sub');
    if (sub) {
      sub.textContent = 'Clavis AI Agent';
    }
  }

  /* ══════════════════════════════════════════════════════════════
     2. SOUND SYNTHESIZER ENGINE
     ══════════════════════════════════════════════════════════════ */
  var _audioCtx = null;

  function getCtx() {
    var C = window.AudioContext || window.webkitAudioContext;
    if (!C) return null;
    if (!_audioCtx) _audioCtx = new C();
    if (_audioCtx.state === 'suspended') _audioCtx.resume();
    return _audioCtx;
  }

  function buildPlayer(style) {
    if (style === 'off') return function() {};
    return function() {
      try {
        var ctx = getCtx();
        if (!ctx || localStorage.getItem('skylark_sound_effects') === 'false') return;
        var now = ctx.currentTime;

        if (style === 'ambient') {
          var o = ctx.createOscillator(), g = ctx.createGain();
          o.type = 'sine';
          o.frequency.setValueAtTime(440, now);
          o.frequency.exponentialRampToValueAtTime(220, now + 0.06);
          g.gain.setValueAtTime(0.04, now);
          g.gain.exponentialRampToValueAtTime(0.0001, now + 0.06);
          o.connect(g); g.connect(ctx.destination);
          o.start(now); o.stop(now + 0.07);

        } else if (style === 'crystal') {
          [1047, 1319].forEach(function(freq, i) {
            var o2 = ctx.createOscillator(), g2 = ctx.createGain(), s = now + i * 0.03;
            o2.type = 'triangle';
            o2.frequency.setValueAtTime(freq, s);
            g2.gain.setValueAtTime(0.025, s);
            g2.gain.exponentialRampToValueAtTime(0.0001, s + 0.1);
            o2.connect(g2); g2.connect(ctx.destination);
            o2.start(s); o2.stop(s + 0.11);
          });

        } else if (style === 'minimal') {
          var om = ctx.createOscillator(), gm = ctx.createGain();
          om.type = 'sine';
          om.frequency.setValueAtTime(800, now);
          om.frequency.exponentialRampToValueAtTime(150, now + 0.018);
          gm.gain.setValueAtTime(0.025, now);
          gm.gain.exponentialRampToValueAtTime(0.0001, now + 0.018);
          om.connect(gm); gm.connect(ctx.destination);
          om.start(now); om.stop(now + 0.02);

        } else if (style === 'futuristic') {
          var of2 = ctx.createOscillator(), gf = ctx.createGain();
          of2.type = 'sawtooth';
          of2.frequency.setValueAtTime(200, now);
          of2.frequency.linearRampToValueAtTime(1200, now + 0.03);
          gf.gain.setValueAtTime(0.03, now);
          gf.gain.exponentialRampToValueAtTime(0.0001, now + 0.04);
          of2.connect(gf); gf.connect(ctx.destination);
          of2.start(now); of2.stop(now + 0.05);
        }
      } catch (e) {}
    };
  }

  var _player = null;

  function applySoundStyle(style) {
    localStorage.setItem('nx-sound-style', style);
    _player = buildPlayer(style);
    var snd = (style === 'off') ? 'false' : 'true';
    localStorage.setItem('skylark_sound_effects', snd);
    if (window.SoundFX && typeof window.SoundFX.setTheme === 'function') {
      window.SoundFX.setTheme(style);
    }
    var smCb = document.getElementById('sm-sounds');
    if (smCb) smCb.checked = (style !== 'off');
    var stEl = document.getElementById('sm-sound-theme');
    if (stEl && ['ambient', 'crystal', 'minimal', 'off'].includes(style)) stEl.value = style;
  }

  function playSound() {
    if (window.SoundFX && typeof window.SoundFX.playClick === 'function') {
      window.SoundFX.playClick();
      return;
    }
    if (_player) { _player(); }
  }

  /* ══════════════════════════════════════════════════════════════
     3. ANIMATION STYLE CONTROLLER
     ══════════════════════════════════════════════════════════════ */
  function applyAnimStyle(style) {
    localStorage.setItem('nx-anim-style', style);
    var root = document.documentElement;
    var T = {
      spring: { e: 'cubic-bezier(0.65, 0, 0.35, 1)', n: 'cubic-bezier(0.34, 1.56, 0.64, 1)', d: '0.32s' },
      smooth: { e: 'cubic-bezier(0.4, 0, 0.2, 1)',   n: 'cubic-bezier(0.23, 1, 0.32, 1)',     d: '0.35s' },
      snappy: { e: 'cubic-bezier(0.77, 0, 0.175, 1)', n: 'cubic-bezier(0.77, 0, 0.175, 1)',   d: '0.15s' },
      none:   { e: 'linear', n: 'linear', d: '0.001s' }
    };
    var t = T[style] || T.spring;
    root.style.setProperty('--nx-sidebar-ease', t.e);
    root.style.setProperty('--nx-nav-ease', t.n);
    root.style.setProperty('--nx-duration', t.d);
    if (style === 'none') root.setAttribute('data-reduce-motion', '');
    else root.removeAttribute('data-reduce-motion');
  }

  /* ══════════════════════════════════════════════════════════════
     4. CUSTOM DROPDOWNS CONTROLLER (Model Selectors)
     ══════════════════════════════════════════════════════════════ */
  function initCustomDropdowns() {
    var dropdowns = document.querySelectorAll('.custom-dropdown');
    dropdowns.forEach(function(dd) {
      if (dd.__nxBound) return;
      dd.__nxBound = true;

      var header = dd.querySelector('.custom-dropdown-header');
      var list = dd.querySelector('.custom-dropdown-list');
      var textEl = dd.querySelector('.custom-dropdown-text');
      var hiddenInput = dd.querySelector('input[type="hidden"]');

      if (!header || !list) return;

      header.addEventListener('click', function(e) {
        e.stopPropagation();
        var wasOpen = dd.classList.contains('open');
        // Close other dropdowns
        document.querySelectorAll('.custom-dropdown.open').forEach(function(other) {
          other.classList.remove('open');
        });
        if (!wasOpen) {
          dd.classList.add('open');
          playSound();
        }
      });

      // Item selection
      var items = list.querySelectorAll('li');
      items.forEach(function(li) {
        li.addEventListener('click', function(e) {
          e.stopPropagation();
          var val = li.getAttribute('data-value');
          var text = li.innerText.trim();

          if (textEl) {
            // Clean text without badge for header
            var clone = li.cloneNode(true);
            var badges = clone.querySelectorAll('.flagship-badge');
            badges.forEach(function(b) { b.remove(); });
            textEl.innerText = clone.innerText.trim();
          }
          if (hiddenInput) {
            hiddenInput.value = val;
            hiddenInput.dispatchEvent(new Event('change', { bubbles: true }));
          }

          items.forEach(function(it) { it.classList.remove('active'); });
          li.classList.add('active');

          dd.classList.remove('open');
          playSound();
        });
      });
    });

    // Close on click outside
    document.addEventListener('click', function(e) {
      if (!e.target.closest('.custom-dropdown')) {
        document.querySelectorAll('.custom-dropdown.open').forEach(function(dd) {
          dd.classList.remove('open');
        });
      }
    });

    // Close on Escape
    document.addEventListener('keydown', function(e) {
      if (e.key === 'Escape') {
        document.querySelectorAll('.custom-dropdown.open').forEach(function(dd) {
          dd.classList.remove('open');
        });
      }
    });
  }

  /* ══════════════════════════════════════════════════════════════
     5. DRAGGABLE RESIZABLE SIDEBAR CONTROLLER
     ══════════════════════════════════════════════════════════════ */
  function initSidebarResizer() {
    var sidebar = document.getElementById('sidebar');
    var resizer = document.getElementById('sidebar-resizer');
    var root = document.documentElement;
    if (!sidebar || !resizer) return;

    var dragging = false;

    function setCollapsed(collapsed) {
      if (window.innerWidth <= 768) {
        sidebar.classList.remove('collapsed');
        sidebar.classList.toggle('mobile-open', !collapsed);
        root.dataset.sidebarState = 'mobile';
        return;
      }
      sidebar.classList.toggle('collapsed', collapsed);
      root.dataset.sidebarState = collapsed ? 'collapsed' : 'expanded';
      // Sync CSS variable for main-content margin-left tracking
      var targetW = collapsed ? '62px' : (root.style.getPropertyValue('--sidebar-expanded') || '220px');
      root.style.setProperty('--sidebar-current', targetW);
      root.style.setProperty('--main-left', targetW);
      localStorage.setItem('lx-sidebar-collapsed', String(collapsed));
      updateBranding();
    }

    function setWidth(w) {
      var clamped = Math.max(210, Math.min(230, w || 220));
      // FIXED: Do NOT write inline sidebar.style.width — inline styles override
      // all CSS !important rules including our authoritative geometry block.
      // CSS variables are the sole source of truth for sidebar width.
      sidebar.style.removeProperty('width');
      sidebar.style.removeProperty('min-width');
      sidebar.style.removeProperty('max-width');
      root.style.setProperty('--sidebar-expanded', clamped + 'px');
      root.style.setProperty('--sidebar-width', clamped + 'px');
      root.style.setProperty('--sidebar-current', clamped + 'px');
      localStorage.setItem('do-sidebar-width', String(clamped));
    }

    resizer.addEventListener('pointerdown', function(e) {
      if (window.innerWidth < 768) return;
      dragging = true;
      resizer.setPointerCapture?.(e.pointerId);
      document.body.classList.add('sidebar-dragging');
      root.classList.add('sidebar-resizing');
      e.preventDefault();
    });

    window.addEventListener('pointermove', function(e) {
      if (!dragging) return;
      var clientX = e.clientX;

      if (clientX < 110) {
        // Snap to collapsed rail
        if (!sidebar.classList.contains('collapsed')) {
          setCollapsed(true);
          playSound();
        }
      } else {
        // Snap to expanded & resize
        if (sidebar.classList.contains('collapsed')) {
          setCollapsed(false);
          playSound();
        }
        setWidth(clientX);
      }
    });

    window.addEventListener('pointerup', function(e) {
      if (!dragging) return;
      dragging = false;
      resizer.releasePointerCapture?.(e.pointerId);
      document.body.classList.remove('sidebar-dragging');
      root.classList.remove('sidebar-resizing');
    });

    // Mac Traffic Lights direct binding
    var dotClose = document.querySelector('.mac-close');
    var dotMin = document.querySelector('.mac-minimize');
    var dotMax = document.querySelector('.mac-maximize');

    if (dotClose) {
      dotClose.addEventListener('click', function(e) {
        e.stopPropagation();
        var isColl = window.innerWidth <= 768
          ? sidebar.classList.contains('mobile-open')
          : sidebar.classList.contains('collapsed');
        setCollapsed(!isColl);
        playSound();
      });
    }

    if (dotMin) {
      dotMin.addEventListener('click', function(e) {
        e.stopPropagation();
        setCollapsed(true);
        playSound();
      });
    }

    if (dotMax) {
      dotMax.addEventListener('click', function(e) {
        e.stopPropagation();
        setCollapsed(false);
        var savedW = parseInt(localStorage.getItem('do-sidebar-width'), 10);
        if (!savedW || savedW > 240) savedW = 220;
        setWidth(savedW);
        playSound();
      });
    }
  }

  /* ══════════════════════════════════════════════════════════════
     6. SETTINGS MODAL INTERACTIVE GRID INJECTION
     ══════════════════════════════════════════════════════════════ */
  var _injected = false;

  function injectSettingsOptions() {
    if (_injected) return;
    var soundThemeEl = document.getElementById('sm-sound-theme');
    if (!soundThemeEl) return;
    var soundRow = soundThemeEl.closest('.smodal-field');
    if (!soundRow) return;
    _injected = true;

    function makeGrid(id, labelMap, iconMap, selected, cbName, title, hint) {
      var wrap = document.createElement('div');
      wrap.className = 'smodal-field';
      var cells = Object.keys(labelMap).map(function(key) {
        var sel = (selected === key) ? ' selected' : '';
        return '<div class="nx-style-option' + sel + '" onclick="NxEnhance.' + cbName + '(\'' + key + '\',this)">' +
          '<span class="nx-style-option-icon">' + iconMap[key] + '</span>' +
          '<span class="nx-style-option-label">' + labelMap[key] + '</span>' +
          '</div>';
      }).join('');
      wrap.innerHTML =
        '<div class="smodal-field-left">' +
          '<label class="smodal-label">' + title + '</label>' +
          '<span class="smodal-hint">' + hint + '</span>' +
        '</div>' +
        '<div class="nx-style-grid" id="' + id + '">' + cells + '</div>';
      return wrap;
    }

    // Sound Style grid
    var sg = makeGrid('nx-sound-grid', SOUND_LABELS, SOUND_ICONS, getSoundStyle(), 'setSoundStyle',
      'Sound Style', 'Tactile interaction & click sounds');
    soundRow.after(sg);

    // Animation Style grid
    var reduceCb = document.getElementById('sm-reduce-motion');
    if (reduceCb) {
      var reduceRow = reduceCb.closest('.smodal-field');
      if (reduceRow) {
        var ag = makeGrid('nx-anim-grid', ANIM_LABELS, ANIM_ICONS, getAnimStyle(), 'setAnimStyle',
          'Animation Style', 'Transition feel for UI & navigation');
        reduceRow.before(ag);
      }
    }
  }

  /* ══════════════════════════════════════════════════════════════
     7. SIDEBAR & NAV CLICK SOUNDS
     ══════════════════════════════════════════════════════════════ */
  function initNavSounds() {
    document.addEventListener('pointerdown', function(e) {
      if (e.target.closest('.nav-item, .nav-sub-item, .mac-dot, .chat-chip, .btn-luxury, .claude-icon-btn')) {
        playSound();
      }
    }, { passive: true });
  }

  /* ══════════════════════════════════════════════════════════════
     8. PUBLIC INTERFACE & EXPORTS
     ══════════════════════════════════════════════════════════════ */
  window.NxEnhance = {
    setAnimStyle: function(style, el) {
      applyAnimStyle(style);
      document.querySelectorAll('#nx-anim-grid .nx-style-option').forEach(function(o) {
        o.classList.remove('selected');
      });
      if (el) el.classList.add('selected');
      playSound();
    },
    setSoundStyle: function(style, el) {
      applySoundStyle(style);
      document.querySelectorAll('#nx-sound-grid .nx-style-option').forEach(function(o) {
        o.classList.remove('selected');
      });
      if (el) el.classList.add('selected');
      playSound();
    },
    refreshBranding: updateBranding,
    playSound: playSound,
    injectSettings: injectSettingsOptions
  };

  /* ══════════════════════════════════════════════════════════════
     9. INITIALIZATION
     ══════════════════════════════════════════════════════════════ */
  function init() {
    updateBranding();
    applyAnimStyle(getAnimStyle());
    applySoundStyle(getSoundStyle());
    initCustomDropdowns();
    // luxury-ui.js owns sidebar resize/collapse. Do not bind a second controller
    // here: duplicate pointer and traffic-light handlers cause width jitter.
    // initSidebarResizer();
    initNavSounds();

    // Re-check branding periodically or on storage/auth events
    var tries = 0;
    var poll = setInterval(function() {
      updateBranding();
      if (++tries > 25) clearInterval(poll);
    }, 400);

    window.addEventListener('storage', updateBranding);
    window.addEventListener('nexus:auth:login', function() {
      setTimeout(updateBranding, 200);
    });

    // Observer for Settings Modal opening
    var obs = new MutationObserver(function(muts) {
      muts.forEach(function(m) {
        if (m.type === 'attributes') {
          var t = m.target;
          if (t && t.classList && t.classList.contains('mac-settings-overlay') && t.classList.contains('active')) {
            _injected = false;
            setTimeout(injectSettingsOptions, 120);
          }
        }
      });
    });
    obs.observe(document.body, { attributes: true, attributeFilter: ['class'], subtree: true });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
