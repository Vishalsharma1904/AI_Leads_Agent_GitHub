/* =====================================================================
   APPLE-POLISH  —  interaction & repair layer for Clavis
   Loaded BEFORE jarvis_ui.js (its shims must exist first) and does its
   DOM work after the document is ready. Purely additive.
   ===================================================================== */
(function () {
  'use strict';

  /* ==================================================================
     PART 1 — REPAIR SHIMS  (must run before jarvis_ui.js executes)

     jarvis_ui.js line 1867 runs `window.toggleJarvisVoicePanel =
     toggleJarvisVoicePanel;` but that function no longer exists, so the
     bare identifier threw a ReferenceError and killed the remaining 506
     lines of the file. That silently disabled: the command palette,
     the Jarvis side-panel toggle, the "more" menu, file upload +
     drag-and-drop, the whole Excel enrichment flow, and
     bindJarvisUIButtons() itself.

     Defining these as window properties first makes line 1867 a
     harmless self-assignment, so the rest of the file runs again.
     ================================================================== */

  /* Split text into speakable sentences. Handles Latin punctuation and
     the Devanagari danda, and keeps chunks short enough that the speech
     engine doesn't truncate them. */
  if (typeof window.splitSentences !== 'function') {
    window.splitSentences = function splitSentences(text) {
      if (!text) return [];
      var parts = String(text)
        .replace(/\s+/g, ' ')
        .split(/(?<=[.!?।])\s+|(?<=\n)/)
        .map(function (s) { return s.trim(); })
        .filter(Boolean);
      var out = [];
      parts.forEach(function (p) {
        if (p.length <= 220) { out.push(p); return; }
        var buf = '';
        p.split(/,\s*/).forEach(function (clause) {
          if ((buf + ' ' + clause).trim().length > 220) { if (buf) out.push(buf.trim()); buf = clause; }
          else { buf = buf ? buf + ', ' + clause : clause; }
        });
        if (buf.trim()) out.push(buf.trim());
      });
      return out.length ? out : [String(text)];
    };
  }

  /* Show / hide the voice settings panel (#jarvisVoicePanel exists in
     index.html but nothing was toggling it any more). */
  var _voicePanelDocClickHandler = null;
  var _voicePanelEscHandler = null;

  window.toggleJarvisVoicePanel = function toggleJarvisVoicePanel(force) {
    var el = document.getElementById('jarvisVoicePanel');
    if (!el) return;
    var isCurrentlyOpen = el.style.display !== 'none' && el.getAttribute('aria-hidden') !== 'true';
    var open = (typeof force === 'boolean') ? force : !isCurrentlyOpen;

    if (open) {
      el.style.display = '';
      el.setAttribute('aria-hidden', 'false');
      if (typeof window.loadJarvisVoices === 'function') {
        try { window.loadJarvisVoices(); } catch (e) {}
      }

      if (_voicePanelDocClickHandler) {
        document.removeEventListener('pointerdown', _voicePanelDocClickHandler, true);
        _voicePanelDocClickHandler = null;
      }
      if (_voicePanelEscHandler) {
        document.removeEventListener('keydown', _voicePanelEscHandler);
        _voicePanelEscHandler = null;
      }

      setTimeout(function () {
        if (el.style.display === 'none') return;
        _voicePanelDocClickHandler = function (e) {
          var triggerBtn = document.getElementById('jarvis-voice-config-btn');
          if (!el.contains(e.target) && (!triggerBtn || !triggerBtn.contains(e.target))) {
            window.toggleJarvisVoicePanel(false);
          }
        };
        _voicePanelEscHandler = function (e) {
          if (e.key === 'Escape') {
            window.toggleJarvisVoicePanel(false);
          }
        };
        document.addEventListener('pointerdown', _voicePanelDocClickHandler, true);
        document.addEventListener('keydown', _voicePanelEscHandler);
      }, 50);
    } else {
      el.style.display = 'none';
      el.setAttribute('aria-hidden', 'true');
      if (_voicePanelDocClickHandler) {
        document.removeEventListener('pointerdown', _voicePanelDocClickHandler, true);
        _voicePanelDocClickHandler = null;
      }
      if (_voicePanelEscHandler) {
        document.removeEventListener('keydown', _voicePanelEscHandler);
        _voicePanelEscHandler = null;
      }
    }
  };

  /* Re-render the Jarvis side panel cards (Memory / Call Scripts /
     Skills). jarvis_skills.js calls this after every mutation. */
  if (typeof window.refreshJarvisSidePanels !== 'function') {
    window.refreshJarvisSidePanels = function refreshJarvisSidePanels() {
      ['renderJarvisSkillsList', 'renderJarvisHistory', 'renderClavisBrainState']
        .forEach(function (fn) {
          if (typeof window[fn] === 'function') { try { window[fn](); } catch (e) {} }
        });
      try {
        document.dispatchEvent(new CustomEvent('jarvis:sidepanels-refresh'));
      } catch (e) {}
    };
  }

  /* ---- voice settings panel -------------------------------------
     index.html wires six handlers to the voice panel's controls; none
     of them existed, so every slider and filter in that panel was a
     no-op and the panel could not even be opened. */
  var LS = {
    get: function (k, d) { try { var v = localStorage.getItem(k); return v === null ? d : v; } catch (e) { return d; } },
    set: function (k, v) { try { localStorage.setItem(k, v); } catch (e) {} }
  };

  function voiceGender(v) {
    var n = ((v && v.name) || '').toLowerCase();
    if (/female|woman|zira|susan|samantha|karen|moira|tessa|veena|heera|swara|aditi|neerja|priya|salli|joanna|kendra/.test(n)) return 'female';
    if (/male|man|david|mark|george|daniel|rishi|hemant|prabhat|alex|fred|matthew|brian/.test(n)) return 'male';
    return 'all';
  }

  if (typeof window.loadJarvisVoices !== 'function') {
    window.loadJarvisVoices = function loadJarvisVoices() {
      // Clavis uses the Gemini voice inventory; browser voices are not part of
      // the production path and must never be rendered into settings.
      return;
      /* legacy browser voice picker retained below for old cached documents */
      var box = document.getElementById('jarvisVoiceOptions');
      if (!box || !('speechSynthesis' in window)) return;
      var voices = [];
      try { voices = window.speechSynthesis.getVoices() || []; } catch (e) {}
      if (!voices.length) {
        box.innerHTML = '<div class="vo-empty">Loading system voices…</div>';
        window.speechSynthesis.onvoiceschanged = function () {
          window.speechSynthesis.onvoiceschanged = null;
          window.loadJarvisVoices();
        };
        return;
      }
      var chosen = LS.get('jarvis_voice_name', '');
      // Indian / Hindi voices first — this app speaks Hinglish
      voices = voices.slice().sort(function (a, b) {
        var ai = /(^|\W)(hi|en)-IN/i.test(a.lang) ? 0 : 1;
        var bi = /(^|\W)(hi|en)-IN/i.test(b.lang) ? 0 : 1;
        return ai - bi || a.name.localeCompare(b.name);
      });
      box.innerHTML = '';
      voices.forEach(function (v) {
        var row = document.createElement('button');
        row.type = 'button';
        row.className = 'vo-row' + (v.name === chosen ? ' vo-row-active' : '');
        row.dataset.gender = voiceGender(v);
        row.dataset.name = v.name;
        row.setAttribute('aria-pressed', v.name === chosen ? 'true' : 'false');
        row.innerHTML = '<span class="vo-name"></span><span class="vo-lang"></span>';
        row.querySelector('.vo-name').textContent = v.name;
        row.querySelector('.vo-lang').textContent = v.lang;
        row.addEventListener('click', function () {
          LS.set('jarvis_voice_name', v.name);
          LS.set('jarvis_voice_lang', v.lang);
          box.querySelectorAll('.vo-row').forEach(function (r) {
            r.classList.toggle('vo-row-active', r === row);
            r.setAttribute('aria-pressed', r === row ? 'true' : 'false');
          });
          if (typeof window.testJarvisVoice === 'function') { try { window.testJarvisVoice(); } catch (e) {} }
        });
        box.appendChild(row);
      });
      var g = LS.get('jarvis_voice_gender', 'all');
      if (g && g !== 'all') window.filterJarvisVoices(g, null);
    };
  }

  if (typeof window.filterJarvisVoices !== 'function') {
    window.filterJarvisVoices = function filterJarvisVoices(gender, btn) {
      LS.set('jarvis_voice_gender', gender || 'all');
      var box = document.getElementById('jarvisVoiceOptions');
      if (box) {
        box.querySelectorAll('.vo-row').forEach(function (r) {
          r.hidden = !(gender === 'all' || !gender || r.dataset.gender === gender);
        });
      }
      var group = (btn && btn.parentElement) || document.querySelector('.gender-filter');
      if (group) {
        group.querySelectorAll('.gf-btn').forEach(function (b) {
          var on = btn ? b === btn : new RegExp('^\\s*' + (gender || 'all'), 'i').test(b.textContent.trim());
          b.classList.toggle('active', !!on);
          b.setAttribute('aria-pressed', on ? 'true' : 'false');
        });
      }
    };
  }

  function bindSlider(fnName, lsKey, valueId, format) {
    if (typeof window[fnName] === 'function') return;
    window[fnName] = function (value) {
      var v = parseFloat(value);
      if (isNaN(v)) return;
      LS.set(lsKey, String(v));
      var out = document.getElementById(valueId);
      if (out) out.textContent = format(v);
    };
  }
  bindSlider('updateJarvisVoiceRate', 'jarvis_voice_rate', 'jarvisRateVal', function (v) { return v.toFixed(1).replace(/\.0$/, '') + 'x'; });
  bindSlider('updateJarvisVoicePitch', 'jarvis_voice_pitch', 'jarvisPitchVal', function (v) { return v.toFixed(1).replace(/\.0$/, ''); });
  bindSlider('updateJarvisVoiceVolume', 'jarvis_voice_volume', 'jarvisVolumeVal', function (v) { return Math.round(v * 100) + '%'; });

  /* ---- speech prosody --------------------------------------------
     speakSequence() reads emotion.rateMultiplier / pitchMultiplier /
     volume / pauseAfter. detectEmotion() returned undefined, so every
     spoken sentence threw. Wrap any existing one and guarantee shape. */
  (function () {
    var prev = typeof window.detectEmotion === 'function' ? window.detectEmotion : null;
    function fallback(sentence) {
      var s = String(sentence || '');
      var e = { rateMultiplier: 1, pitchMultiplier: 1, volume: 1, pauseAfter: 140 };
      if (/[!]{1,}\s*$/.test(s)) { e.rateMultiplier = 1.05; e.pitchMultiplier = 1.04; e.pauseAfter = 170; }
      else if (/\?\s*$/.test(s)) { e.pitchMultiplier = 1.06; e.pauseAfter = 200; }
      else if (/[,;:]\s*$/.test(s)) { e.pauseAfter = 90; }
      else if (s.length > 160) { e.rateMultiplier = 0.97; e.pauseAfter = 180; }
      return e;
    }
    window.detectEmotion = function detectEmotion(sentence) {
      if (prev) {
        try {
          var r = prev(sentence);
          if (r && typeof r === 'object' && typeof r.rateMultiplier === 'number') {
            if (typeof r.pitchMultiplier !== 'number') r.pitchMultiplier = 1;
            if (typeof r.volume !== 'number') r.volume = 1;
            return r;
          }
        } catch (e) {}
      }
      return fallback(sentence);
    };
  })();

  /* ---- side-panel renderers & modal openers ----------------------
     renderJarvisSkillsList() threw inside initJarvisUI(), aborting the
     rest of Jarvis initialisation — which is why the Memory, Call
     Scripts and Skills cards all rendered as empty boxes. */
  if (typeof window.renderJarvisSkillsList !== 'function') {
    window.renderJarvisSkillsList = function renderJarvisSkillsList() {
      var box = document.getElementById('jarvis-skills-list');
      if (!box) return;
      var skills = [];
      try { skills = (window.JarvisSkills && window.JarvisSkills.list()) || []; } catch (e) {}
      if (!skills.length) {
        box.innerHTML = '<p class="ap-side-empty">No skills registered yet.</p>';
        return;
      }
      box.innerHTML = '';
      skills.forEach(function (s) {
        var row = document.createElement('div');
        row.className = 'ap-skill-row';
        var name = document.createElement('span');
        name.className = 'ap-skill-name';
        name.textContent = String(s.name || '').replace(/_/g, ' ');
        var desc = document.createElement('span');
        desc.className = 'ap-skill-desc';
        desc.textContent = s.description || '';
        row.appendChild(name); row.appendChild(desc);
        if (s.description) row.title = s.description;
        box.appendChild(row);
      });
    };
  }

  if (typeof window.openJarvisScriptModal !== 'function') {
    window.openJarvisScriptModal = function openJarvisScriptModal() {
      var m = document.getElementById('jarvis-script-modal');
      if (!m) return;
      m.style.display = '';
      m.setAttribute('aria-hidden', 'false');
      var first = m.querySelector('input, textarea, select, button');
      if (first) setTimeout(function () { first.focus(); }, 60);
    };
  }
  if (typeof window.closeJarvisScriptModal !== 'function') {
    window.closeJarvisScriptModal = function closeJarvisScriptModal() {
      var m = document.getElementById('jarvis-script-modal');
      if (!m) return;
      m.style.display = 'none';
      m.setAttribute('aria-hidden', 'true');
    };
  }
  if (typeof window.openJarvisMemoryPanel !== 'function') {
    window.openJarvisMemoryPanel = function openJarvisMemoryPanel() {
      if (typeof window.toggleJarvisSidePanel === 'function') {
        try { window.toggleJarvisSidePanel(true); } catch (e) {}
      }
      var card = document.getElementById('jarvis-facts-list');
      if (card && card.scrollIntoView) card.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      if (typeof window.refreshJarvisSidePanels === 'function') window.refreshJarvisSidePanels();
    };
  }
  if (typeof window.openKeySettings !== 'function') {
    window.openKeySettings = function openKeySettings() {
      if (typeof window.openSettingsModal === 'function') { try { return window.openSettingsModal('ai-models'); } catch (e) {} }
      if (typeof window.showView === 'function') { try { return window.showView('tokens'); } catch (e) {} }
      location.hash = '#tokens';
    };
  }
  if (typeof window.checkJarvisKeys !== 'function') {
    window.checkJarvisKeys = function checkJarvisKeys() {
      try {
        var c = window.SKYLARK_CONFIG || {};
        return !!((c.OPENROUTER_API_KEYS || c.GROQ_API_KEYS || []).filter(Boolean).length);
      } catch (e) { return false; }
    };
  }
  if (typeof window.initJarvisBackground !== 'function') {
    window.initJarvisBackground = function initJarvisBackground() {};
  }
  if (typeof window.getOfflineResponse !== 'function') {
    window.getOfflineResponse = function getOfflineResponse() {
      return 'Main abhi offline hoon — koi AI key connect nahi hai. Settings → AI Models mein ek free key add kar dijiye.';
    };
  }


  /* ==================================================================
     PART 2 — UI LAYER
     ================================================================== */
  var reduced = false;
  try { reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) {}

  function ready(fn) {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', fn, { once: true });
    else fn();
  }

  /* ---------- 2a · Tooltips for icon-only controls ----------------
     The sidebar collapses to a 62px icon rail with no labels and no
     title attributes, so nothing identifies the icons. Build a real
     macOS-style tooltip from each control's own text.              */
  var tip = null, tipTimer = null, tipTarget = null, tipViaFocus = false, lastX = 0, lastY = 0;

  /* a control that is hidden or click-through must never tooltip */
  function isReachable(el) { try { return !unreachable(el); } catch (e) { return true; } }

  function ensureTip() {
    if (tip && tip.isConnected) return tip;
    tip = document.createElement('div');
    tip.className = 'ap-tip';
    tip.setAttribute('role', 'tooltip');
    document.body.appendChild(tip);
    return tip;
  }

  function labelFor(el) {
    var explicit = el.getAttribute('data-ap-tip') || el.getAttribute('aria-label') || el.getAttribute('title');
    if (explicit && explicit.trim()) return explicit.trim();
    // pull the visually-hidden label text the control already carries
    var t = '';
    el.querySelectorAll('span, .nav-label, .nav-text, label').forEach(function (n) {
      if (t) return;
      var s = (n.textContent || '').trim();
      if (s && s.length < 60) t = s;
    });
    if (!t) t = (el.textContent || '').trim();
    t = t.replace(/\s+/g, ' ').trim();
    return t && t.length < 60 ? t : '';
  }

  function showTip(el) {
    if (!el.isConnected || !isReachable(el)) return;
    var text = labelFor(el);
    if (!text) return;
    // Strip native [title] so browser tooltip doesn't double with our custom one.
    if (el.hasAttribute('title') && !el.hasAttribute('data-ap-tip')) {
      el.setAttribute('data-ap-tip', el.getAttribute('title'));
      el.removeAttribute('title');
    }
    var n = ensureTip();
    n.textContent = text;
    n.removeAttribute('data-side');
    n.classList.remove('ap-tip-in');
    // measure, then place
    n.style.left = '-9999px'; n.style.top = '0px';
    var r = el.getBoundingClientRect();
    var tr = n.getBoundingClientRect();
    var gap = 8, x, y, side = 'right';
    if (r.right + gap + tr.width < window.innerWidth - 8) {
      x = r.right + gap; y = r.top + (r.height - tr.height) / 2;
    } else if (r.bottom + gap + tr.height < window.innerHeight - 8) {
      side = 'bottom'; x = r.left + (r.width - tr.width) / 2; y = r.bottom + gap;
    } else {
      side = 'top'; x = r.left + (r.width - tr.width) / 2; y = r.top - tr.height - gap;
    }
    x = Math.max(8, Math.min(x, window.innerWidth - tr.width - 8));
    y = Math.max(8, Math.min(y, window.innerHeight - tr.height - 8));
    if (side !== 'right') n.setAttribute('data-side', side);
    n.style.left = Math.round(x) + 'px';
    n.style.top = Math.round(y) + 'px';
    requestAnimationFrame(function () { n.classList.add('ap-tip-in'); });
    tipTarget = el;
  }

  function hideTip() {
    clearTimeout(tipTimer);
    tipTimer = null;
    tipTarget = null;
    tipViaFocus = false;
    if (tip) tip.classList.remove('ap-tip-in');
  }

  var TIP_SELECTOR = [
    '.sidebar .nav-item',
    '.claude-icon-btn', '.icon-btn', '.topbar-icon-btn',
    '.jarvis-composer-btn', '.jarvis-icon-pill',
    '.mac-dot', '.smodal-dot'
  ].join(',');

  function isIconOnly(el) {
    if (el.matches('.sidebar .nav-item')) {
      var side = document.documentElement.getAttribute('data-sidebar-state');
      if (side === 'expanded') return false;
      return true;
    }
    // a control whose text is not actually visible
    var r = el.getBoundingClientRect();
    return r.width <= 46;
  }

  /* Accessible names only — the hover behaviour is delegated below so
     it survives the app re-rendering the sidebar and toolbars. */
  function bindTooltips(root) {
    (root || document).querySelectorAll(TIP_SELECTOR).forEach(function (el) {
      if (el.__apTip) return;
      el.__apTip = true;
      if (!el.getAttribute('aria-label')) {
        var l = labelFor(el);
        if (l) el.setAttribute('aria-label', l);
      }
    });
  }

  /* Delegated hover. Per-element mouseenter listeners were being lost
     every time the app re-rendered a toolbar, which cancelled the
     pending tooltip before its delay elapsed. */
  document.addEventListener('mouseover', function (e) {
    var t = e.target.closest && e.target.closest(TIP_SELECTOR);
    if (!t) { if (tipTarget) hideTip(); return; }
    if (t === tipTarget) return;
    if (!isIconOnly(t)) { if (tipTarget) hideTip(); return; }
    clearTimeout(tipTimer);
    var warm = !!tipTarget;
    if (warm) hideTip();
    /* 380ms felt like lag on a toolbar you are scanning; 260ms is the
       macOS-ish threshold that still avoids firing on a pass-through. */
    tipTimer = setTimeout(function () { showTip(t); }, warm ? 55 : 800);
  }, true);

  /* The app re-renders its toolbars while the pointer is stationary,
     which makes the browser emit a mouseout with a null relatedTarget
     even though the cursor never moved. Confirm against the real
     pointer position before dismissing. */
  document.addEventListener('mouseout', function (e) {
    var t = e.target.closest && e.target.closest(TIP_SELECTOR);
    if (!t) return;
    var to = e.relatedTarget;
    if (to && to.closest && to.closest(TIP_SELECTOR) === t) return;
    var under = document.elementFromPoint(lastX, lastY);
    if (under && under.closest && under.closest(TIP_SELECTOR) === t) return;
    hideTip();
  }, true);

  /* Re-arm while the pointer rests on a control: if a re-render swapped
     the node out from under an armed timer, the next move puts it back. */
  document.addEventListener('mousemove', function (e) {
    lastX = e.clientX; lastY = e.clientY;
    if (tipTarget || tipTimer) return;
    var t = e.target.closest && e.target.closest(TIP_SELECTOR);
    if (t && isIconOnly(t)) tipTimer = setTimeout(function () { showTip(t); }, 800);
  }, true);

  document.addEventListener('focusin', function (e) {
    var t = e.target.closest && e.target.closest(TIP_SELECTOR);
    if (!t || !isIconOnly(t)) return;
    if (tipTarget && !tipViaFocus) return;          // don't clobber a hover tooltip
    if (!t.matches(':focus-visible')) return;        // keyboard focus only
    showTip(t); tipViaFocus = true;
  });
  /* Dismiss on blur only when focus is what opened it AND it is that
     exact anchor losing focus. The app moves focus between toolbar
     controls several times a second; a blanket handler here tore down
     every tooltip ~300ms after it appeared. */
  document.addEventListener('focusout', function (e) {
    if (tipViaFocus && e.target === tipTarget) hideTip();
  });
  document.addEventListener('pointerdown', hideTip, true);

  /* A tooltip should dismiss when the USER scrolls. This app also
     scrolls programmatically (chat autoscroll, marquees, view mounts)
     several times a second, which was tearing every tooltip down about
     300ms after it appeared. Gate dismissal on real scroll intent. */
  var lastScrollIntent = 0;
  ['wheel', 'touchmove', 'keydown'].forEach(function (ev) {
    window.addEventListener(ev, function () { lastScrollIntent = Date.now(); }, { passive: true, capture: true });
  });
  window.addEventListener('scroll', function () {
    if (tipTarget && Date.now() - lastScrollIntent < 500) hideTip();
  }, true);
  window.addEventListener('resize', function () { if (tipTarget) hideTip(); });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') hideTip(); });


  /* ---------- 2b · Keyboard safety for closed overlays -------------
     Tab used to land inside the closed Settings modal — its window
     dots were the first three tab stops on the whole page.        */
  var FOCUSABLE = 'a[href],button,input,select,textarea,summary,' +
    '[tabindex]:not([tabindex="-1"]),[contenteditable="true"]';
  var parked = new Set();

  /* Cheap per-element reachability test. `pointer-events` and
     `visibility` inherit, and checkVisibility() covers display, opacity
     and content-visibility — so no ancestor walk is needed in the hot
     path. The pointer-events check is what catches this app's Settings
     modal, which stays fully painted at 920x590 while closed and is
     disabled purely by switching its subtree to pointer-events:none. */
  function unreachable(el) {
    var r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) return true;
    /* Deliberately NOT parking anything merely below the fold — that is
       ordinary scrollable content and must stay keyboard-reachable.
       Only genuinely off-canvas surfaces (slid-out drawers) qualify. */
    if (r.right < -200 || r.left > window.innerWidth + 200 || r.bottom < -400) return true;
    if (el.checkVisibility &&
        !el.checkVisibility({ opacityProperty: true, visibilityProperty: true, contentVisibilityAuto: true })) return true;
    if (getComputedStyle(el).pointerEvents === 'none') return true;
    if (el.closest('[aria-hidden="true"]')) return true;
    return false;
  }

  /* Park un-reachable controls out of the tab order and restore them the
     moment their surface opens. Before this, Tab from the page landed
     straight on the closed Settings modal's window buttons. */
  function syncInert() {
    var seen = new Set();
    var active = document.activeElement;
    /* Include .ap-inert in the sweep: parking sets tabindex="-1", which
       makes an element stop matching the FOCUSABLE selector — without
       this it could never be un-parked when its surface reopens. */
    document.querySelectorAll(FOCUSABLE + ',.ap-inert').forEach(function (el) {
      seen.add(el);
      if (el === active) return;               // never park what the user is on
      var hide = unreachable(el);
      /* Two strikes before parking: entrance animations (the sidebar's
         .stagger-in runs opacity 0 -> 1) would otherwise be caught
         mid-flight and parked while they are perfectly usable. */
      if (hide && !parked.has(el)) {
        if (!el.__apStrike) { el.__apStrike = 1; return; }
      }
      if (!hide) el.__apStrike = 0;
      if (hide) {
        if (parked.has(el)) return;
        el.__apPrevTab = el.hasAttribute('tabindex') ? el.getAttribute('tabindex') : null;
        el.setAttribute('tabindex', '-1');
        el.classList.add('ap-inert');
        parked.add(el);
      } else if (parked.has(el)) {
        if (el.__apPrevTab === null) el.removeAttribute('tabindex');
        else el.setAttribute('tabindex', el.__apPrevTab);
        el.classList.remove('ap-inert');
        parked.delete(el);
      }
    });
    parked.forEach(function (el) { if (!seen.has(el) || !el.isConnected) parked.delete(el); });
  }


  /* ---------- 2b2 · Escape closes every popover --------------------
     The Client AI and Candidate AI source pickers bind Escape, but the
     three Clavis composer dropdowns (add / inspiration / model) never
     did — once open, only an outside click dismissed them. Escape is
     the expected way out of a transient surface.                    */
  var COMPOSER_MENUS = [
    ['jarvis-composer-add-dropdown', 'toggleComposerAddMenu'],
    ['jarvis-composer-insp-dropdown', 'toggleComposerInspirationMenu'],
    ['jarvis-composer-model-dropdown', 'toggleComposerModelMenu']
  ];
  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Escape') return;
    var closedAny = false;
    COMPOSER_MENUS.forEach(function (pair) {
      var el = document.getElementById(pair[0]);
      if (!el || el.hidden) return;
      if (typeof window[pair[1]] === 'function') { try { window[pair[1]](false); } catch (err) { el.hidden = true; } }
      else el.hidden = true;
      closedAny = true;
    });
    // any other open popover this layer knows about
    document.querySelectorAll('.jarvis-composer-dropdown:not([hidden]), .cand-source-menu:not([hidden])').forEach(function (el) {
      el.hidden = true; closedAny = true;
      var picker = el.closest('.client-source-picker, .candidate-source-picker');
      if (picker) picker.classList.remove('is-open');
    });
    if (closedAny) {
      e.stopPropagation();
      var composer = document.querySelector('#view-jarvis textarea, #view-chat textarea, #view-candidate-ai textarea');
      if (composer && composer.offsetParent !== null) composer.focus();
    }
  }, true);

  /* ---------- 2c · Origin-aware menus -----------------------------
     Popovers faded in from nowhere. Give each one a transform-origin
     matching the control that opened it, so it grows out of its
     source the way a macOS menu does.                              */
  function setMenuOrigin(trigger) {
    if (!trigger) return;
    var r = trigger.getBoundingClientRect();
    var ox = (r.left + r.width / 2) < window.innerWidth / 2 ? 'left' : 'right';
    var oy = (r.top + r.height / 2) < window.innerHeight / 2 ? 'top' : 'bottom';
    document.documentElement.style.setProperty('--ap-origin', oy + ' ' + ox);
  }
  document.addEventListener('pointerdown', function (e) {
    var t = e.target.closest('button, [role="button"], .nav-item, .jarvis-tool-menu-wrapper');
    if (t) setMenuOrigin(t);
  }, true);


  /* ---------- 2d · Tactile press feedback -------------------------
     Adds a class on pointerdown so CSS can respond instantly, even on
     controls whose own :active rule was overwritten somewhere in the
     stylesheet stack.                                              */
  var PRESS_SELECTOR = 'button, [role="button"], .nav-item, a.btn, .btn, ' +
    '.quick-action, .action-btn, .do-quick-btn, .topbar-btn, .chip, ' +
    '.smodal-nav-item, .menu-item, .dropdown-item, .vo-row, .gf-btn, ' +
    '.jarvis-qa-btn, .jarvis-icon-pill, label[for]';
  document.addEventListener('pointerdown', function (e) {
    var t = e.target.closest(PRESS_SELECTOR);
    if (!t || t.disabled || t.getAttribute('aria-disabled') === 'true') return;
    t.classList.add('ap-pressed');
  }, true);
  ['pointerup', 'pointercancel', 'pointerleave', 'blur'].forEach(function (ev) {
    document.addEventListener(ev, function () {
      document.querySelectorAll('.ap-pressed').forEach(function (n) { n.classList.remove('ap-pressed'); });
    }, true);
  });


  /* ---------- 2e · Skip link --------------------------------------- */
  function addSkipLink() {
    if (document.querySelector('.ap-skip')) return;
    var main = document.querySelector('#appShell .content, .main-content, main, #appShell');
    if (!main) return;
    if (!main.id) main.id = 'ap-main';
    var a = document.createElement('a');
    a.className = 'ap-skip';
    a.href = '#' + main.id;
    a.textContent = 'Skip to content';
    document.body.insertBefore(a, document.body.firstChild);
  }


  /* ---------- 2f · Scroll position per view ------------------------ */
  var scrollMemory = Object.create(null);
  function scroller() {
    return document.querySelector('#appShell .content, .main-content, .view-scroll') || document.scrollingElement;
  }
  var lastHash = location.hash;
  window.addEventListener('hashchange', function () {
    var el = scroller();
    if (el) scrollMemory[lastHash] = el.scrollTop;
    lastHash = location.hash;
    requestAnimationFrame(function () {
      var e2 = scroller();
      if (e2) e2.scrollTop = scrollMemory[location.hash] || 0;
    });
  });


  /* ---------- 2g · Empty states for the side-panel lists ------------
     Memory and Call Scripts rendered as hollow boxes with a heading and
     nothing inside when they had no rows. */
  var SIDE_EMPTY = {
    'jarvis-facts-list': 'Nothing remembered yet — tell Clavis something to keep.',
    'jarvis-scripts-list': 'No call scripts yet — generate one from Quick Actions.',
    'jarvis-skills-list': 'No skills registered yet.'
  };
  function fillSideEmpties() {
    Object.keys(SIDE_EMPTY).forEach(function (id) {
      var el = document.getElementById(id);
      if (!el) return;
      var real = 0, ph = null;
      Array.prototype.forEach.call(el.children, function (c) {
        if (c.classList.contains('ap-side-empty')) ph = c; else real++;
      });
      if (real === 0 && !ph) {
        var p = document.createElement('p');
        p.className = 'ap-side-empty';
        p.textContent = SIDE_EMPTY[id];
        el.appendChild(p);
      } else if (real > 0 && ph) {
        ph.remove();
      }
    });
  }
  document.addEventListener('jarvis:sidepanels-refresh', function () {
    setTimeout(fillSideEmpties, 30);
  });

  /* ---------- 2h · Legibility floor --------------------------------
     A handful of views still rendered 9-10px body text. A blanket CSS
     rule is unsafe here (elements using font-size:0 as a layout hack
     would break), so only elements that actually carry a text node are
     raised, and only when they are genuinely below the floor. */
  var MIN_PX = 10.5;
  function raiseTinyText(root) {
    var nodes = (root || document).querySelectorAll('body *:not(svg):not(path):not(script):not(style)');
    for (var i = 0; i < nodes.length; i++) {
      var el = nodes[i];
      if (el.__apSized) continue;
      var hasText = false;
      for (var j = 0; j < el.childNodes.length; j++) {
        var n = el.childNodes[j];
        if (n.nodeType === 3 && n.textContent.trim()) { hasText = true; break; }
      }
      if (!hasText) continue;
      var fs = parseFloat(getComputedStyle(el).fontSize);
      if (!(fs > 0) || fs >= MIN_PX) { el.__apSized = true; continue; }
      el.style.setProperty('font-size', MIN_PX + 'px', 'important');
      el.style.setProperty('line-height', '1.32', 'important');
      el.__apSized = true;
    }
  }

  /* ---------- 2i · Geometry & tracking normalisation ----------------
     The audit found 13 distinct corner radii and a dozen arbitrary
     letter-spacing values still resolving on a single screen, spread
     across nine stylesheets whose selectors outrank anything a later
     sheet can reasonably write. Snapping the computed values is both
     safer and more thorough than another specificity war.

     Circles and pills are left exactly as they are — only the muddle
     between 3px and 18px is collapsed onto the radius scale. */
  var RADII = [6, 8, 10, 14, 18];
  function snapRadius(v) {
    var best = RADII[0], d = Infinity;
    for (var i = 0; i < RADII.length; i++) {
      var dd = Math.abs(RADII[i] - v);
      if (dd < d) { d = dd; best = RADII[i]; }
    }
    return best;
  }
  function trackingFor(fs, upper) {
    if (upper) return '0.055em';
    if (fs >= 28) return '-0.022em';
    if (fs >= 18) return '-0.018em';
    if (fs >= 13) return '-0.006em';
    return '-0.002em';
  }
  function normaliseGeometry(root) {
    var nodes = (root || document).querySelectorAll('body *:not(svg):not(path):not(script):not(style)');
    for (var i = 0; i < nodes.length; i++) {
      var el = nodes[i];
      if (el.__apGeom) continue;
      var b = el.getBoundingClientRect();
      if (b.width < 4 || b.height < 4) continue;
      var cs = getComputedStyle(el);
      el.__apGeom = true;

      /* radius: one uniform value, %, and pill radii are left alone */
      var r = cs.borderRadius;
      if (r && r.indexOf('%') === -1 && r.indexOf(' ') === -1 && r.indexOf('/') === -1) {
        var px = parseFloat(r);
        if (px > 0 && px < 22) {
          var snapped = snapRadius(px);
          if (snapped !== px) el.style.setProperty('border-radius', snapped + 'px', 'important');
        }
      }

      /* tracking: only where the element owns text */
      var hasText = false;
      for (var j = 0; j < el.childNodes.length; j++) {
        var n = el.childNodes[j];
        if (n.nodeType === 3 && n.textContent.trim()) { hasText = true; break; }
      }
      if (!hasText) continue;
      var fs = parseFloat(cs.fontSize);
      if (!(fs > 0)) continue;
      var upper = cs.textTransform === 'uppercase';
      el.style.setProperty('letter-spacing', trackingFor(fs, upper), 'important');
    }
  }

  /* ---------- 2j · Orb state wiring --------------------------------
     #orb-container carries data-orb-state="IDLE" in the markup and no
     code ever changes it, so every state-reactive orb rule in the
     stylesheets was dead. setJarvisStatus() is a file-local function
     (not on window), so mirror the state it *does* publish — the
     status pill's class and label — onto the orb.                  */
  var ORB_STATES = { listening: 'LISTENING', awake: 'LISTENING', thinking: 'THINKING', speaking: 'SPEAKING', error: 'ERROR' };
  function syncOrbState() {
    var orb = document.getElementById('orb-container');
    if (!orb) return;
    var next = 'IDLE';
    if (window.isJarvisSpeaking) next = 'SPEAKING';
    else {
      var pill = document.querySelector('.jarvis-status-pill');
      if (pill) {
        for (var k in ORB_STATES) {
          if (pill.classList.contains(k)) { next = ORB_STATES[k]; break; }
        }
      }
      if (next === 'IDLE') {
        var txt = document.getElementById('jarvis-status-text');
        var label = txt ? txt.textContent.trim().toLowerCase() : '';
        if (ORB_STATES[label]) next = ORB_STATES[label];
      }
    }
    if (orb.getAttribute('data-orb-state') !== next) orb.setAttribute('data-orb-state', next);
  }

  function watchOrbState() {
    var pill = document.querySelector('.jarvis-status-pill');
    if (!pill || pill.__apOrbWatched) return;
    pill.__apOrbWatched = true;
    new MutationObserver(syncOrbState).observe(pill, {
      attributes: true, attributeFilter: ['class'], childList: true, subtree: true, characterData: true
    });
    syncOrbState();
  }

  /* ---------- 2k · Quiet mode during layout transitions -------------
     Blur and shadow are what starve the frame budget (see the numbers
     in apple-polish.css §29). Flag the moments the layout is actually
     moving so those effects can stand down for the duration. */
  var quietTimer = null;
  function quietFor(ms) {
    document.documentElement.classList.add('ap-quiet');
    clearTimeout(quietTimer);
    quietTimer = setTimeout(function () {
      document.documentElement.classList.remove('ap-quiet');
    }, ms || 320);
  }
  window.addEventListener('hashchange', function () { quietFor(360); });

  /* ---------- 2k2 · Orb voice reactivity ---------------------------
     The orb answers to the room. Two numbers are published as custom
     properties on #orb-container and apple-polish.css §37 does the
     rest:

       --orb-level  0…1  loudness      → size, halo, blob swell
       --orb-warm   0…1  brightness    → amber ⇄ sapphire palette

     The mic is NOT opened here. clavis-audio-trigger.js already runs
     an AnalyserNode (fftSize 1024) off the hands-free stream, and a
     second getUserMedia would be both a duplicate permission prompt
     and a second audio graph. This reads the analyser that exists.
     When the trigger isn't running — hands-free off — the orb simply
     stays on its idle drift, which is the honest behaviour.

     While Clavis is SPEAKING there is no analyser to read at all
     (that audio is speechSynthesis, which exposes no signal), so the
     envelope is synthesised from two incommensurable sines: it reads
     as speech rhythm without pretending to be the actual waveform. */
  var ORB_RATE = { IDLE: 1, LISTENING: 0.72, THINKING: 1.5, SPEAKING: 1.9, ERROR: 0.5 };
  var orbRAF = null, orbLevel = 0, orbWarm = 0.5, orbLast = 0;

  function orbLive() {
    var t = window.ClavisAudioTrigger;
    if (!t || !t.analyser || !t.frequencyData || t.running === false || t.suspended) return null;
    return t;
  }

  /* Loudness and spectral centroid in one pass over the spectrum.
     512 bins ≈ 20µs — cheaper than the getByteTimeDomainData copy. */
  function orbRead(t) {
    t.analyser.getByteFrequencyData(t.frequencyData);
    var f = t.frequencyData, n = f.length, top = Math.min(n, 96);  // ≈ 0-4.5kHz
    var sum = 0, weighted = 0, peak = 0;
    for (var i = 1; i < top; i++) {
      var v = f[i];
      sum += v; weighted += v * i;
      if (v > peak) peak = v;
    }
    if (sum < 260) return null;                 // below the noise floor
    return {
      level: Math.min(1, (sum / top) / 78),     // 78/255 ≈ conversational
      warm: Math.min(1, (weighted / sum) / 26)  // centroid bin → 0…1
    };
  }

  function orbTick(now) {
    orbRAF = requestAnimationFrame(orbTick);
    if (now - orbLast < 32) return;             // 30fps is plenty for this
    orbLast = now;

    var orb = document.getElementById('orb-container');
    if (!orb) return;
    var state = orb.getAttribute('data-orb-state') || 'IDLE';
    var target = 0, warmTarget = 0.5;

    if (state === 'SPEAKING') {
      var s = now / 1000;
      target = 0.28 + 0.34 * Math.abs(Math.sin(s * 3.1))
                    + 0.20 * Math.abs(Math.sin(s * 7.27 + 1.1));
      warmTarget = 0.74;                        // speaking runs warm
    } else if (state === 'LISTENING' || state === 'THINKING') {
      var r = orbLive() && orbRead(orbLive());
      if (r) { target = r.level; warmTarget = r.warm; }
      else if (state === 'THINKING') target = 0.18 + 0.12 * Math.sin(now / 620);
    }

    /* asymmetric smoothing: rises quickly enough to feel connected to
       the voice, falls slowly enough that the orb never flickers */
    var k = target > orbLevel ? 0.34 : (state === 'SPEAKING' ? 0.17 : 0.09);
    orbLevel += (target - orbLevel) * k;
    orbWarm += (warmTarget - orbWarm) * 0.06;   // palette always drifts

    if (orbLevel < 0.002) orbLevel = 0;
    orb.style.setProperty('--orb-level', orbLevel.toFixed(3));
    orb.style.setProperty('--orb-warm', orbWarm.toFixed(3));

    /* Drift speed is a per-STATE value, not a per-frame one. Writing
       animation-duration every frame would restart the blobs' progress
       (progress = currentTime / duration) and the liquid would jitter
       instead of drifting. State changes are rare, so this is free. */
    var rate = ORB_RATE[state] || 1;
    if (orb.__apRate !== rate) {
      orb.__apRate = rate;
      orb.style.setProperty('--orb-rate', String(rate));
    }
  }

  /* Runs only when the orb can be seen. Everything else — hidden tab,
     another view, reduced motion — and both the rAF loop and the CSS
     animations stop. Four blurred composited layers are the single
     most expensive thing on this screen. */
  function orbVisible() {
    if (reduced) return false;
    if (document.hidden) return false;
    var v = document.getElementById('view-jarvis');
    return !!(v && v.classList.contains('active') && v.offsetParent !== null);
  }

  function syncOrbLoop() {
    var on = orbVisible();
    document.documentElement.classList.toggle('ap-orb-idle', !on);
    if (on && orbRAF === null) orbRAF = requestAnimationFrame(orbTick);
    if (!on && orbRAF !== null) {
      cancelAnimationFrame(orbRAF); orbRAF = null;
      var orb = document.getElementById('orb-container');
      if (orb) { orb.style.setProperty('--orb-level', '0'); orbLevel = 0; }
    }
  }

  /* ---------- 2l · Deferred maintenance passes ----------------------
     raiseTinyText() and normaliseGeometry() each walk the document and
     read computed styles — about 48ms for a full pass. Running them
     straight off the MutationObserver put that on the critical path
     during chat rendering and view changes. Coalesce instead, and
     never run while a layout transition is in flight. */
  var maintTimer = null;
  var idle = window.requestIdleCallback || function (fn) { return setTimeout(function () { fn({ timeRemaining: function () { return 8; } }); }, 200); };
  function scheduleMaintenance() {
    clearTimeout(maintTimer);
    maintTimer = setTimeout(function () {
      if (document.documentElement.classList.contains('ap-quiet') ||
          document.documentElement.classList.contains('sidebar-animating')) {
        scheduleMaintenance();
        return;
      }
      idle(function () {
        bindTooltips(document);
        raiseTinyText(document);
        normaliseGeometry(document);
        watchOrbState();
      });
    }, 240);
  }

  /* ---------- 2m · Notification centre behaviour --------------------
     Two things the CSS cannot do on its own: know that a toast is on a
     timer, and let you flick it away. Both hook the app's existing
     notification DOM without touching notifications.js beyond its exit
     duration. Dismissal always routes through the card's own close
     button so the app clears its timer and restacks the pile — never
     by removing the node here. */
  function stampToast(card) {
    if (card.__apToast) return;
    card.__apToast = true;
    // mirrors notifications.js: errors and actionable toasts wait for a
    // human, everything else auto-dismisses at 4500ms
    var timed = !card.classList.contains('notif-error') &&
                !card.querySelector('.desktop-notif-actions');
    if (timed) {
      card.style.setProperty('--ap-toast-ms', '4500ms');
      card.classList.add('ap-timed');
    }
    makeSwipeable(card);
  }

  function makeSwipeable(card) {
    var startX = 0, dx = 0, dragging = false, pid = null;
    card.addEventListener('pointerdown', function (e) {
      if (e.button !== 0) return;
      if (e.target.closest('button, a, input, textarea')) return;
      dragging = true; startX = e.clientX; dx = 0; pid = e.pointerId;
      card.classList.add('ap-swiping');
      try { card.setPointerCapture(pid); } catch (err) {}
    });
    card.addEventListener('pointermove', function (e) {
      if (!dragging) return;
      dx = e.clientX - startX;
      if (dx < 0) dx = dx / 4;                       // resist the wrong way
      card.style.translate = dx + 'px 0';   // individual prop: leaves the
                                            // stack's inline transform alone
      card.style.opacity = String(Math.max(0.25, 1 - Math.abs(dx) / 260));
    });
    function end() {
      if (!dragging) return;
      dragging = false;
      card.classList.remove('ap-swiping');
      try { card.releasePointerCapture(pid); } catch (err) {}
      if (dx > 90) {
        var close = card.querySelector('.desktop-notif-close-btn');
        if (close) { close.click(); return; }        // app clears its timer
      }
      card.style.translate = '';
      card.style.opacity = '';
    }
    card.addEventListener('pointerup', end);
    card.addEventListener('pointercancel', end);
  }

  function watchToasts() {
    var box = document.querySelector('.desktop-notification-container');
    if (!box || box.__apWatched) return;
    box.__apWatched = true;
    box.querySelectorAll('.desktop-notification-card').forEach(stampToast);
    new MutationObserver(function (recs) {
      recs.forEach(function (r) {
        Array.prototype.forEach.call(r.addedNodes, function (n) {
          if (n.nodeType === 1 && n.classList.contains('desktop-notification-card')) stampToast(n);
        });
      });
    }).observe(box, { childList: true });
  }

  /* ---------- boot ------------------------------------------------- */
  ready(function () {
    addSkipLink();
    bindTooltips(document);
    syncInert();
    fillSideEmpties();
    raiseTinyText(document);
    normaliseGeometry(document);
    watchOrbState();
    watchToasts();
    syncOrbLoop();
    setInterval(syncOrbState, 700);
    setInterval(syncOrbLoop, 900);
    document.addEventListener('visibilitychange', syncOrbLoop);
    window.addEventListener('hashchange', function () { setTimeout(syncOrbLoop, 80); });
    setInterval(watchToasts, 2000);   // the container is created lazily
    setInterval(fillSideEmpties, 1500);
    window.addEventListener('hashchange', function () { scheduleMaintenance(); });

    var mo = new MutationObserver(function (records) {
      var needTips = false;
      records.forEach(function (r) {
        r.addedNodes && r.addedNodes.forEach && r.addedNodes.forEach(function (n) {
          if (n.nodeType === 1) needTips = true;
        });
      });
      if (needTips) scheduleMaintenance();
    });
    try {
      mo.observe(document.body, { childList: true, subtree: true });
    } catch (e) {}

    // overlays open/close through many different code paths — poll cheaply
    setInterval(syncInert, 500);
    window.addEventListener('hashchange', function () { setTimeout(syncInert, 60); });
    document.addEventListener('click', function () { setTimeout(syncInert, 120); }, true);

    document.documentElement.classList.add('ap-ready');
  });

  window.ApplePolish = {
    version: '1.0',
    refreshTooltips: function () { bindTooltips(document); },
    showTip: showTip,
    hideTip: hideTip,
    syncInert: syncInert,
    reducedMotion: reduced
  };
})();
