/* ============================================================
 * clavis-voice-button.js · Voice control, one tap from the top bar.
 * ------------------------------------------------------------
 * Everything about how Rudra sounds used to live three clicks deep in
 * Settings. The two things actually reached mid-conversation — shut up,
 * and slow down — now sit next to the globe.
 *
 * Click  = mute / unmute instantly (and cut off whatever is being said).
 * Menu   = engine, voice, speed.
 *
 * The icon is the state: three bars that animate only while he is
 * actually speaking, so a glance tells you whether Rudra has the floor.
 * ============================================================ */
(function () {
  'use strict';
  if (window.ClavisVoiceButton) return;

  var btn = null, menu = null, poll = 0;

  var MUTE_KEY = 'clavis_voice_muted';
  var ENGINE_KEY = 'clavis_voice_engine';
  var RATE_KEY = 'clavis_voice_rate';

  function get(k, d) { try { return localStorage.getItem(k) || d; } catch (_) { return d; } }
  function set(k, v) { try { localStorage.setItem(k, v); } catch (_) {} }
  var muted = function () { return get(MUTE_KEY, '0') === '1' || get('jarvis_speech_enabled', 'true') === 'false'; };

  /* ---------- the button ---------- */

  function build() {
    var b = document.createElement('button');
    b.type = 'button';
    b.className = 'rf-voice-btn';
    b.id = 'rf-voice-btn';
    b.title = 'Voice (V) · right-click for options';
    b.innerHTML =
      '<span class="rf-vwave" aria-hidden="true"><i></i><i></i><i></i></span>' +
      '<svg class="rf-vmute" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" aria-hidden="true">' +
      '<path d="M4 5l15 14"/></svg>';
    b.addEventListener('click', function (e) { e.preventDefault(); toggleMute(); });
    b.addEventListener('contextmenu', function (e) { e.preventDefault(); openMenu(); });
    return b;
  }

  function mount() {
    if (document.getElementById('rf-voice-btn')) return true;
    // beside the globe, same cluster as the other display tools
    var anchor = document.getElementById('rf-globe-btn')
              || document.querySelector('.tb-history-btn')
              || document.querySelector('.tb-shortcuts-btn');
    if (!anchor || !anchor.parentNode) return false;
    btn = build();
    anchor.parentNode.insertBefore(btn, anchor);
    sync();
    return true;
  }

  function toggleMute() {
    var now = !muted();
    if (window.toggleJarvisSpeech) {
      window.toggleJarvisSpeech(!now);
      sync();
      return;
    }
    set(MUTE_KEY, now ? '1' : '0');
    set('jarvis_speech_enabled', String(!now));
    window.ClavisVoiceState?.setVoiceOutputEnabled?.(!now, 'top bar voice');
    if (now) { try { window.ClavisVoice?.stop?.(); } catch (_) {} }
    sync();
    try {
      window.showToast?.(now ? 'info' : 'success',
        now ? 'Voice off' : 'Voice on',
        now ? 'Rudra ab chup rahega — text me jawab dega.' : 'Rudra ab bolega.');
    } catch (_) {}
  }

  /* The bars animate only while he speaks. A permanently animating icon in
     a top bar is noise, and it also keeps a compositor layer alive forever. */
  function sync() {
    if (!btn) return;
    var off = muted();
    var speaking = false;
    try { speaking = !off && !!window.ClavisVoice?.isSpeaking?.(); } catch (_) {}
    if (btn.classList.contains('is-off') !== off) btn.classList.toggle('is-off', off);
    if (btn.classList.contains('is-live') !== speaking) btn.classList.toggle('is-live', speaking);
    var label = off ? 'Voice is off — click to turn on' : 'Voice is on — click to mute';
    if (btn.getAttribute('aria-label') !== label) btn.setAttribute('aria-label', label);
  }

  /* ---------- the menu ---------- */

  function row(label, html) {
    return '<div class="rf-vrow"><span class="rf-vlabel">' + label + '</span>' + html + '</div>';
  }

  function openMenu() {
    closeMenu();
    var engine = get(ENGINE_KEY, 'auto');
    var rate = parseFloat(get(RATE_KEY, '1')) || 1;
    var voices = [];
    try { voices = window.ClavisVoice?.listHindiVoices?.() || []; } catch (_) {}
    var current = '';
    try { current = localStorage.getItem('clavis_browser_voice') || ''; } catch (_) {}

    menu = document.createElement('div');
    menu.className = 'rf-vmenu';
    menu.setAttribute('role', 'menu');
    menu.innerHTML =
      '<div class="rf-vhead">Voice</div>' +
      row('Engine',
        '<div class="rf-vseg" data-k="engine">' +
        '<button type="button" data-v="auto"' + (engine !== 'browser' ? ' class="on"' : '') + '>Best</button>' +
        '<button type="button" data-v="browser"' + (engine === 'browser' ? ' class="on"' : '') + '>Free</button>' +
        '</div>') +
      row('Speed',
        '<input class="rf-vrange" type="range" min="0.7" max="1.4" step="0.05" value="' + rate + '" data-k="rate">' +
        '<span class="rf-vval" data-for="rate">' + rate.toFixed(2) + '×</span>') +
      (voices.length
        ? row('Free voice',
            '<select class="rf-vsel" data-k="bvoice"><option value="">Auto</option>' +
            voices.map(function (v) {
              var nm = v.name || v;
              return '<option value="' + esc(nm) + '"' + (nm === current ? ' selected' : '') + '>' + esc(nm) + '</option>';
            }).join('') + '</select>')
        : '') +
      '<button type="button" class="rf-vmore" data-k="setup">Voice keys & more…</button>';

    document.body.appendChild(menu);
    place();
    menu.addEventListener('click', onMenuClick);
    menu.addEventListener('input', onMenuInput);
    menu.addEventListener('change', onMenuInput);
    setTimeout(function () { document.addEventListener('pointerdown', outside, true); }, 0);
    if (menu.animate) {
      menu.animate([{ opacity: 0, transform: 'translateY(-6px) scale(.97)' },
                    { opacity: 1, transform: 'none' }],
        { duration: 260, easing: 'cubic-bezier(.16,1,.3,1)' });
    }
  }

  function esc(v) {
    return String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function place() {
    if (!menu || !btn) return;
    var r = btn.getBoundingClientRect();
    menu.style.top = Math.round(r.bottom + 8) + 'px';
    // right-aligned to the button, but never off the left edge
    var right = Math.max(12, Math.round(window.innerWidth - r.right));
    menu.style.right = right + 'px';
  }

  function outside(e) {
    if (!menu) return;
    if (menu.contains(e.target) || (btn && btn.contains(e.target))) return;
    closeMenu();
  }

  function closeMenu() {
    document.removeEventListener('pointerdown', outside, true);
    if (!menu) return;
    var m = menu;
    menu = null;
    if (m.animate) {
      m.animate([{ opacity: 1 }, { opacity: 0, transform: 'translateY(-4px)' }],
        { duration: 150, easing: 'cubic-bezier(.4,0,1,1)', fill: 'forwards' })
        .finished.catch(function () {}).then(function () { m.remove(); });
    } else { m.remove(); }
  }

  function onMenuClick(e) {
    var seg = e.target.closest('.rf-vseg button');
    if (seg) {
      set(ENGINE_KEY, seg.dataset.v);
      seg.parentNode.querySelectorAll('button').forEach(function (b) { b.classList.toggle('on', b === seg); });
      return;
    }
    if (e.target.closest('[data-k="setup"]')) {
      closeMenu();
      try { window.ClavisSetup?.open?.(); } catch (_) {}
    }
  }

  function onMenuInput(e) {
    var k = e.target.dataset && e.target.dataset.k;
    if (k === 'rate') {
      var v = parseFloat(e.target.value) || 1;
      set(RATE_KEY, String(v));
      var out = menu && menu.querySelector('[data-for="rate"]');
      if (out) out.textContent = v.toFixed(2) + '×';
    } else if (k === 'bvoice') {
      set('clavis_browser_voice', e.target.value || '');
    }
  }

  /* ---------- wiring ---------- */

  function ready() {
    if (!mount()) {
      var tries = 0;
      var t = setInterval(function () { if (mount() || ++tries > 40) clearInterval(t); }, 250);
    }
    // 400ms is enough for the bars to read as live without being a timer
    // that costs anything; sync() only writes when a value actually changed.
    poll = setInterval(sync, 400);
    window.addEventListener('resize', place);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', ready);
  else ready();

  // V mutes, unless the caret is somewhere typeable
  document.addEventListener('keydown', function (e) {
    if (e.key !== 'v' && e.key !== 'V') return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    var t = e.target;
    if (t && (t.isContentEditable || /^(input|textarea|select)$/i.test(t.tagName))) return;
    e.preventDefault();
    toggleMute();
  });

  window.ClavisVoiceButton = {
    toggle: toggleMute,
    isMuted: muted,
    open: openMenu,
    close: closeMenu,
    sync: sync,
  };
})();
