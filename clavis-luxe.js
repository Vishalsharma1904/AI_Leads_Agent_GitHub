/* ============================================================
 * clavis-luxe.js — the finishing layer's runtime
 * ------------------------------------------------------------
 *   1 · ThemeReveal   the new theme spreads out of the switch
 *   2 · Header        the gliding hover highlight, tip glyphs
 *   3 · Rail          mirrors the peek onto <html> so the page
 *                     moves with the rail instead of under it
 *   4 · Surface       follow-ups that work: rows, smart titles,
 *                     and the in-panel Deep Dive
 *   5 · Research      AI brain + Wikipedia / Wikimedia Commons
 *   6 · Viewer        an image lightbox that grows out of the
 *                     thumbnail and settles back into it
 *   7 · Answers       images written into replies become images
 *
 * Nothing here replaces an app module. It wraps two public entry
 * points (ThemeController.set, toggleDayNightTheme) and listens to
 * the DOM. Every hook is guarded: if a piece is missing, that
 * feature quietly stays off and the rest keeps working.
 *
 * Self-check in the console: ClavisLuxe.selfTest()
 * ============================================================ */
(function (global) {
  'use strict';

  var doc = global.document;
  var root = doc.documentElement;

  function ready(fn) {
    if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', fn, { once: true });
    else fn();
  }
  function reducedMotion() {
    try { return global.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) { return false; }
  }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function inline(s) {
    return esc(s)
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/`([^`]+)`/g, '<code>$1</code>');
  }
  function clip(s, n) {
    s = String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
    return s.length > n ? s.slice(0, n - 1).replace(/\s+\S*$/, '') + '…' : s;
  }
  function wait(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

  /* ── Line icons (Lucide geometry, stroke only) ─────────────── */
  var I = {
    arrowLeft: '<path d="m12 19-7-7 7-7"/><path d="M19 12H5"/>',
    arrowRight: '<path d="M5 12h14"/><path d="m12 5 7 7-7 7"/>',
    arrowUpRight: '<path d="M7 7h10v10"/><path d="M7 17 17 7"/>',
    cornerDownRight: '<path d="m15 10 5 5-5 5"/><path d="M4 4v7a4 4 0 0 0 4 4h12"/>',
    copy: '<rect width="14" height="14" x="8" y="8" rx="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/>',
    check: '<path d="M20 6 9 17l-5-5"/>',
    chatText: '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/><path d="M13 8H7"/><path d="M17 12H7"/>',
    bookOpen: '<path d="M12 7v14"/><path d="M3 18a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h5a4 4 0 0 1 4 4 4 4 0 0 1 4-4h5a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1h-6a3 3 0 0 0-3 3 3 3 0 0 0-3-3z"/>',
    list: '<path d="M3 12h.01"/><path d="M3 18h.01"/><path d="M3 6h.01"/><path d="M8 12h13"/><path d="M8 18h13"/><path d="M8 6h13"/>',
    listChecks: '<path d="m3 17 2 2 4-4"/><path d="m3 7 2 2 4-4"/><path d="M13 6h8"/><path d="M13 12h8"/><path d="M13 18h8"/>',
    feather: '<path d="M12.67 19a2 2 0 0 0 1.416-.588l6.154-6.172a6 6 0 0 0-8.49-8.49L5.586 9.914A2 2 0 0 0 5 11.328V18a1 1 0 0 0 1 1z"/><path d="M16 8 2 22"/><path d="M17.5 15H9"/>',
    calculator: '<rect width="16" height="20" x="4" y="2" rx="2"/><path d="M8 6h8"/><path d="M16 14v4"/><path d="M16 10h.01"/><path d="M12 10h.01"/><path d="M8 10h.01"/><path d="M12 14h.01"/><path d="M8 14h.01"/><path d="M12 18h.01"/><path d="M8 18h.01"/>',
    table: '<path d="M12 3v18"/><rect width="18" height="18" x="3" y="3" rx="2"/><path d="M3 9h18"/><path d="M3 15h18"/>',
    penLine: '<path d="M12 20h9"/><path d="M16.376 3.622a1 1 0 0 1 3.002 3.002L7.368 18.635a2 2 0 0 1-.855.506l-2.872.838a.5.5 0 0 1-.62-.62l.838-2.872a2 2 0 0 1 .506-.854z"/>',
    images: '<path d="M18 22H4a2 2 0 0 1-2-2V6"/><path d="m22 13-1.296-1.296a2.41 2.41 0 0 0-3.408 0L11 18"/><circle cx="12" cy="8" r="2"/><rect width="16" height="16" x="6" y="2" rx="2"/>',
    zap: '<path d="M4 14a1 1 0 0 1-.78-1.63l9.9-10.2a.5.5 0 0 1 .86.46l-1.92 6.02A1 1 0 0 0 13 10h7a1 1 0 0 1 .78 1.63l-9.9 10.2a.5.5 0 0 1-.86-.46l1.92-6.02A1 1 0 0 0 11 14z"/>',
    lightbulb: '<path d="M15 14c.2-1 .7-1.7 1.5-2.5 1-.9 1.5-2.2 1.5-3.5A6 6 0 0 0 6 8c0 1 .2 2.2 1.5 3.5.7.7 1.3 1.5 1.5 2.5"/><path d="M9 18h6"/><path d="M10 22h4"/>',
    alert: '<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"/><path d="M12 9v4"/><path d="M12 17h.01"/>',
    quote: '<path d="M16 3a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2 1 1 0 0 1 1 1v1a2 2 0 0 1-2 2 1 1 0 0 0-1 1v2a1 1 0 0 0 1 1 6 6 0 0 0 6-6V5a2 2 0 0 0-2-2z"/><path d="M5 3a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2 1 1 0 0 1 1 1v1a2 2 0 0 1-2 2 1 1 0 0 0-1 1v2a1 1 0 0 0 1 1 6 6 0 0 0 6-6V5a2 2 0 0 0-2-2z"/>',
    mapPin: '<path d="M20 10c0 4.993-5.539 10.193-7.399 11.799a1 1 0 0 1-1.202 0C9.539 20.193 4 14.993 4 10a8 8 0 0 1 16 0"/><circle cx="12" cy="10" r="3"/>',
    x: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
    chevronLeft: '<path d="m15 18-6-6 6-6"/>',
    chevronRight: '<path d="m9 18 6-6-6-6"/>',
    external: '<path d="M15 3h6v6"/><path d="M10 14 21 3"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>',
    zoomIn: '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/><path d="M11 8v6"/><path d="M8 11h6"/>',
    globe: '<circle cx="12" cy="12" r="10"/><path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20"/><path d="M2 12h20"/>',
    sparkles: '<path d="M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z"/><path d="M20 3v4"/><path d="M22 5h-4"/>',
    radio: '<path d="M4.9 19.1C1 15.2 1 8.8 4.9 4.9"/><path d="M7.8 16.2c-2.3-2.3-2.3-6.1 0-8.5"/><circle cx="12" cy="12" r="2"/><path d="M16.2 7.8c2.3 2.3 2.3 6.1 0 8.5"/><path d="M19.1 4.9C23 8.8 23 15.1 19.1 19"/>',
    mic: '<path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><path d="M12 19v3"/>',
    phone: '<path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/>',
    message: '<path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z"/>',
    keyboard: '<path d="M10 8h.01"/><path d="M12 12h.01"/><path d="M14 8h.01"/><path d="M16 12h.01"/><path d="M18 8h.01"/><path d="M6 8h.01"/><path d="M7 16h10"/><path d="M8 12h.01"/><rect width="20" height="16" x="2" y="4" rx="2"/>',
    key: '<path d="M2.586 17.414A2 2 0 0 0 2 18.828V21a1 1 0 0 0 1 1h3a1 1 0 0 0 1-1v-1a1 1 0 0 1 1-1h1a1 1 0 0 0 1-1v-1a1 1 0 0 1 1-1h.172a2 2 0 0 0 1.414-.586l.814-.814a6.5 6.5 0 1 0-4-4z"/><circle cx="16.5" cy="7.5" r="1"/>',
    plus: '<path d="M5 12h14"/><path d="M12 5v14"/>',
    volume: '<path d="M11 4.702a.705.705 0 0 0-1.203-.498L6.413 7.587A1.4 1.4 0 0 1 5.416 8H3a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h2.416a1.4 1.4 0 0 1 .997.413l3.383 3.384A.705.705 0 0 0 11 19.298z"/><path d="M16 9a5 5 0 0 1 0 6"/><path d="M19.364 18.364a9 9 0 0 0 0-12.728"/>',
    stopSq: '<rect width="14" height="14" x="5" y="5" rx="2.5"/>',
    maximize: '<path d="M15 3h6v6"/><path d="m21 3-7 7"/><path d="m3 21 7-7"/><path d="M9 21H3v-6"/>',
    minimize: '<path d="m14 10 7-7"/><path d="M20 10h-6V4"/><path d="m3 21 7-7"/><path d="M4 14h6v6"/>',
    arrowUp: '<path d="m5 12 7-7 7 7"/><path d="M12 19V5"/>',
    search: '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>',
    clock: '<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>',
    user: '<circle cx="12" cy="8" r="5"/><path d="M20 21a8 8 0 0 0-16 0"/>',
    history: '<path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/><path d="M12 7v5l4 2"/>',
    refresh: '<path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M8 16H3v5"/>'
  };
  function icon(name, size, sw) {
    return '<svg width="' + (size || 16) + '" height="' + (size || 16) + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="' +
      (sw || 1.75) + '" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + (I[name] || '') + '</svg>';
  }

  /* ============================================================
   * 1 · THEME REVEAL
   * ------------------------------------------------------------
   * The switch is the light source: the new theme grows out of
   * wherever the change was asked for (the switch, the menu item,
   * the settings checkbox) and spreads over the window with a soft
   * feathered edge. Auto day/night, which nobody clicked, gets a
   * quiet crossfade instead.
   * ============================================================ */
  var ThemeReveal = (function () {
    var busy = false;
    var lastPointer = { x: 0, y: 0, t: -1e9, onSwitch: false };

    doc.addEventListener('pointerdown', function (e) {
      var sw = e.target && e.target.closest ? e.target.closest('#mark-bennett-theme-btn') : null;
      lastPointer = { x: e.clientX, y: e.clientY, t: performance.now(), onSwitch: !!sw };
    }, true);
    doc.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' || e.key === ' ') lastPointer.t = -1e9;   // keyboard: use the switch itself
    }, true);

    function visible(r) { return r && r.width > 0 && r.bottom > 0 && r.top < global.innerHeight && r.right > 0 && r.left < global.innerWidth; }

    function origin() {
      var sw = doc.getElementById('mark-bennett-theme-btn');
      var fresh = performance.now() - lastPointer.t < 1600;
      if (sw && (lastPointer.onSwitch || !fresh)) {
        var knob = sw.querySelector('.luxe-switch-knob') || sw;
        var r = knob.getBoundingClientRect();
        if (visible(r)) return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
      }
      if (fresh && (lastPointer.x || lastPointer.y)) return { x: lastPointer.x, y: lastPointer.y };
      return { x: global.innerWidth - 48, y: 24 };
    }

    // Apple spring asymmetric curve: gentle, dense 60+ FPS progression from switch (0-80%),
    // followed by an ultra-slow, buttery, critically damped glide for the final 20%
    var EASE = 'cubic-bezier(0.18, 0.76, 0.22, 1)';

    function run(next, apply, opts) {
      opts = opts || {};
      var current = root.getAttribute('data-theme') || 'dark';
      if (busy || next === current || !doc.body) { apply(); return; }
      var manual = !!opts.manual;

      if (reducedMotion() || !manual) {
        if (!doc.startViewTransition) { apply(); return; }
        root.classList.add('lx-vt-fade');
        busy = true;
        try {
          doc.startViewTransition(function () { swapTheme(apply); })
            .finished.catch(function () {}).then(settle);
        } catch (e) { root.classList.remove('lx-vt-fade', 'lx-theme-busy'); busy = false; apply(); }
        return;
      }

      var o = origin();
      var far = Math.hypot(Math.max(o.x, global.innerWidth - o.x), Math.max(o.y, global.innerHeight - o.y)) + 32;
      // Stately, luxurious Apple duration: ~1650ms total
      var dur = Math.round(clamp(1500 + far * 0.22, 1600, 1920));

      if (!doc.startViewTransition) { fallbackWave(next, apply, o, far, dur); return; }

      /* Only pseudo-element rules hang off lx-vt-wave, so adding it is
         free. lx-theme-busy (transitions off) restyles everything, so it
         rides along with the theme change inside the update callback —
         one full style pass instead of three — and comes off only after
         the reveal has finished moving. */
      root.classList.add('lx-vt-wave');
      busy = true;
      var vt;
      try {
        vt = doc.startViewTransition(function () { swapTheme(apply); });
      } catch (e) {
        root.classList.remove('lx-vt-wave', 'lx-theme-busy');
        busy = false;
        apply();
        return;
      }
      vt.ready.then(function () {
        try {
          root.animate({
            clipPath: [
              'circle(0px at ' + o.x + 'px ' + o.y + 'px)',
              'circle(' + far + 'px at ' + o.x + 'px ' + o.y + 'px)'
            ]
          }, {
            duration: dur,
            easing: EASE,
            pseudoElement: '::view-transition-new(root)',
            fill: 'both'
          });
        } catch (e) {}
      }).catch(function () {});
      vt.finished.catch(function () {}).then(settle);
    }

    /* Everything must land in the new colours in the SAME frame the
       new snapshot is taken. lx-theme-busy outranks every transition rule.
       We flag __themeTransitioning to postpone non-critical canvas/chart
       rerenders so the main thread remains 100% free for 120fps wave animation. */
    function swapTheme(apply) {
      window.__themeTransitioning = true;
      root.classList.add('lx-theme-busy');
      apply();
      root.classList.remove('theme-transitioning');
    }

    function settle() {
      root.classList.remove('lx-vt-wave', 'lx-vt-fade');
      busy = false;
      window.__themeTransitioning = false;
      doc.dispatchEvent(new CustomEvent('nexus:themechange:settled'));
      setTimeout(function () { if (!busy) root.classList.remove('lx-theme-busy'); }, 90);
    }

    /* No View Transitions: a disc of the new ground grows from the
       same origin, the theme swaps underneath it, and it dissolves. */
    function fallbackWave(next, apply, o, far, dur) {
      var wave = doc.createElement('div');
      wave.className = 'lx-theme-wave';
      wave.style.setProperty('--lxe-wave-bg', next === 'dark' ? '#0F0B0E' : '#FAF7F1');
      doc.body.appendChild(wave);
      busy = true;
      var done = function () {
        apply();
        requestAnimationFrame(function () {
          var fade = wave.animate({ opacity: [1, 0] }, { duration: 500, easing: 'ease-out', fill: 'forwards' });
          fade.onfinish = function () { wave.remove(); busy = false; settle(); };
        });
      };
      try {
        var a = wave.animate({
          clipPath: ['circle(0px at ' + o.x + 'px ' + o.y + 'px)', 'circle(' + far + 'px at ' + o.x + 'px ' + o.y + 'px)']
        }, { duration: Math.round(dur * 0.85), easing: EASE, fill: 'forwards' });
        a.onfinish = done;
      } catch (e) { wave.remove(); busy = false; apply(); settle(); }
    }

    function install() {
      var TC = global.ThemeController;
      if (!TC || typeof TC.set !== 'function') return false;
      if (TC.__lx) return true;
      var originalSet = TC.set;
      TC.set = function (theme, options) {
        var o = options || {};
        var next = theme === 'light' ? 'light' : 'dark';
        if (o.animate === false) return originalSet.call(TC, theme, options);
        var out = next;
        run(next, function () { out = originalSet.call(TC, theme, options); }, o);
        return out;
      };
      TC.__lx = true;
      global.toggleDayNightTheme = function () {
        var cur = TC.get ? TC.get() : (root.getAttribute('data-theme') || 'dark');
        TC.set(cur === 'dark' ? 'light' : 'dark', { animate: true, manual: true });
      };
      syncSwitch();
      doc.addEventListener('nexus:themechange', syncSwitch);
      return true;
    }

    function syncSwitch() {
      var sw = doc.getElementById('mark-bennett-theme-btn');
      if (!sw) return;
      var dark = (root.getAttribute('data-theme') || 'dark') === 'dark';
      sw.setAttribute('aria-checked', String(dark));
      sw.setAttribute('aria-label', 'Dark mode');
      sw.title = dark ? 'Switch to light · Ctrl ⇧ D' : 'Switch to dark · Ctrl ⇧ D';
    }

    return { install: install, run: run, get busy() { return busy; } };
  })();

  /* ============================================================
   * 2 · HEADER — the gliding highlight and the tip glyph
   * ============================================================ */
  function installGlide() {
    var row = doc.querySelector('#view-jarvis .jarvis-hero-actions');
    if (!row) return false;
    if (row.__lxGlide) return true;
    row.__lxGlide = true;
    var fine = true;
    try { fine = global.matchMedia('(hover: hover) and (pointer: fine)').matches; } catch (e) {}
    if (!fine) return true;

    var g = doc.createElement('span');
    g.className = 'lx-glide';
    g.setAttribute('aria-hidden', 'true');
    row.insertBefore(g, row.firstChild);
    row.classList.add('has-glide');

    var on = false, hideTimer = 0;
    function place(btn) {
      var rr = row.getBoundingClientRect();
      var br = btn.getBoundingClientRect();
      if (!br.width) return;
      if (!on) g.classList.add('is-instant');
      row.style.setProperty('--lxe-gx', (br.left - rr.left).toFixed(1) + 'px');
      row.style.setProperty('--lxe-gw', br.width.toFixed(1) + 'px');
      if (!on) {
        void g.offsetWidth;
        g.classList.remove('is-instant');
        g.classList.add('is-on');
        on = true;
      }
    }
    row.addEventListener('pointerover', function (e) {
      var b = e.target.closest && e.target.closest('.jarvis-icon-pill, .jarvis-newchat-pill');
      if (!b || !row.contains(b)) return;
      clearTimeout(hideTimer);
      hoverBtn = b;
      place(b);
    });
    row.addEventListener('pointerleave', function () {
      clearTimeout(hideTimer);
      hoverBtn = null;
      hideTimer = setTimeout(function () { g.classList.remove('is-on'); on = false; }, 70);
    });
    return true;
  }

  /* apple-polish.js places its tooltip to the right of an icon when
     there is room — right for a rail, wrong for a toolbar, where it
     lands on top of the next icon. For the studio toolbar it goes
     underneath, centred, the way toolbar tooltips sit everywhere else. */
  var hoverBtn = null;
  /* ============================================================
   * 2b · TOOLTIPS — one kind, on purpose
   * ------------------------------------------------------------
   * Buttons were showing two tooltips at once: the browser's own
   * `title` box and apple-polish's .ap-tip (the rail had a third,
   * a CSS ::after). Now there is one. It waits for intent — the
   * pointer rests ~3s before the first one appears — and once one
   * has shown, neighbours answer at once, the way macOS does.
   * A `title` becomes data-lx-tip the moment the pointer arrives,
   * before the browser's own tooltip can use it, so no text is lost.
   * ============================================================ */
  var TIP_FIRST = 3000, TIP_WARM = 110, TIP_WARM_FOR = 1500;
  function installTips() {
    if (installTips.done) return true;
    if (!doc.body) return false;
    installTips.done = true;
    var tipEl = doc.createElement('div');
    tipEl.className = 'lx-tip';
    tipEl.setAttribute('role', 'tooltip');
    tipEl.innerHTML = '<span class="lx-tip-text"></span><span class="lx-tip-keys"></span>';
    doc.body.appendChild(tipEl);
    var textEl = tipEl.firstChild, keysEl = tipEl.lastChild;
    var target = null, timer = 0, visible = false, lastHide = -1e9;
    var CAND = '[data-lx-tip], [data-ap-tip], button[aria-label], [role="button"][aria-label], a[aria-label]';

    function adoptTitles(node) {
      for (var n = node; n && n.nodeType === 1 && n !== doc.body; n = n.parentElement) {
        var t = n.getAttribute('title');
        if (t == null) continue;
        if (t.trim() && !n.hasAttribute('data-lx-tip')) n.setAttribute('data-lx-tip', t.trim());
        n.removeAttribute('title');
      }
    }
    function labelOf(el) {
      if (el.closest('#sidebar .sidebar-nav, .lx-lb')) return '';   // the rail shows its labels on peek
      var t = (el.getAttribute('data-lx-tip') || el.getAttribute('data-ap-tip') || '').trim();
      if (t) return t;
      var aria = (el.getAttribute('aria-label') || '').trim();
      if (!aria) return '';
      /* a button that already says it on screen needs no tooltip */
      var shown = (el.textContent || '').replace(/\s+/g, ' ').trim().toLowerCase();
      return shown.length > 2 && aria.toLowerCase().indexOf(shown) === 0 ? '' : aria;
    }
    function place(el) {
      var r = el.getBoundingClientRect();
      var tw = tipEl.offsetWidth, th = tipEl.offsetHeight, gap = 9, vw = global.innerWidth, vh = global.innerHeight;
      var side = r.top < vh * 0.22 ? 'bottom' : (r.bottom > vh * 0.72 ? 'top' : (r.right + gap + tw < vw - 8 ? 'right' : 'top'));
      var x, y;
      if (side === 'bottom') { x = r.left + r.width / 2 - tw / 2; y = r.bottom + gap; }
      else if (side === 'top') { x = r.left + r.width / 2 - tw / 2; y = r.top - th - gap; }
      else { x = r.right + gap; y = r.top + r.height / 2 - th / 2; }
      tipEl.setAttribute('data-side', side);
      tipEl.style.left = Math.round(clamp(x, 8, vw - tw - 8)) + 'px';
      tipEl.style.top = Math.round(clamp(y, 8, vh - th - 8)) + 'px';
    }
    function show(el) {
      var label = labelOf(el);
      if (!label || !el.isConnected) return;
      var m = label.match(/^(.*?)\s*[(（]\s*((?:ctrl|cmd|⌘|alt|option|shift|⇧|esc|enter|tab|space|[a-z0-9]|f\d{1,2}|[+\/·,\s])+)\s*[)）]\s*$/i);
      textEl.textContent = m ? m[1] : label;
      keysEl.textContent = m ? m[2].replace(/\s*\+\s*/g, ' ') : '';
      keysEl.hidden = !m;
      tipEl.classList.remove('is-in');
      place(el);
      visible = true;
      requestAnimationFrame(function () { if (visible) tipEl.classList.add('is-in'); });
    }
    function hide() {
      clearTimeout(timer);
      if (visible) lastHide = performance.now();
      visible = false;
      target = null;
      tipEl.classList.remove('is-in');
    }
    doc.addEventListener('pointerover', function (e) {
      if (e.pointerType === 'touch') return;
      adoptTitles(e.target);
      var el = e.target.closest ? e.target.closest(CAND) : null;
      if (el === target) return;
      clearTimeout(timer);
      if (!el || !labelOf(el)) { if (visible) hide(); target = null; return; }
      var warm = visible || performance.now() - lastHide < TIP_WARM_FOR;
      if (visible) { visible = false; tipEl.classList.remove('is-in'); lastHide = performance.now(); }
      target = el;
      timer = setTimeout(function () { if (target === el) show(el); }, warm ? TIP_WARM : TIP_FIRST);
    }, true);
    doc.addEventListener('pointerout', function (e) {
      if (!target) return;
      var to = e.relatedTarget;
      if (to && target.contains(to)) return;
      if (target === e.target || target.contains(e.target)) hide();
    }, true);
    ['pointerdown', 'keydown', 'wheel'].forEach(function (ev) { doc.addEventListener(ev, hide, true); });
    doc.addEventListener('scroll', hide, true);
    global.addEventListener('blur', hide);
    return true;
  }

  var TIP_GLYPHS = { '👏': 'radio', '🎙️': 'mic', '🎙': 'mic', '⚡': 'zap', '📞': 'phone', '💬': 'message', '⌨️': 'keyboard', '⌨': 'keyboard', '✨': 'sparkles', '💡': 'lightbulb' };
  function installTipGlyph() {
    var pill = doc.getElementById('clavis-feature-tip-pill');
    var emoji = doc.getElementById('clavis-tip-icon');
    if (!pill || !emoji) return false;
    if (pill.__lxGlyph) return true;
    pill.__lxGlyph = true;
    var glyph = doc.createElement('span');
    glyph.className = 'lx-tip-glyph';
    glyph.setAttribute('aria-hidden', 'true');
    pill.insertBefore(glyph, emoji);
    pill.classList.add('has-lx-glyph');
    function sync() {
      var key = (emoji.textContent || '').trim();
      var name = TIP_GLYPHS[key] || TIP_GLYPHS[key.replace(/️/g, '')] || 'sparkles';
      if (glyph.dataset.name === name) return;
      glyph.dataset.name = name;
      glyph.innerHTML = icon(name, 14, 1.9);
    }
    new MutationObserver(sync).observe(emoji, { childList: true, characterData: true, subtree: true });
    sync();
    return true;
  }

  /* ============================================================
   * 3 · PERF — keep style work local
   * ------------------------------------------------------------
   * A handful of :has() rules anchored on <html>, <main> and the
   * studio view (plus one on the composer buttons that tests
   * `:not(:empty)`) made EVERY tiny DOM change — a status word, a
   * tooltip, a typed letter — restyle all ~4,000 elements: ~60ms of
   * main thread, several times a second. That was the jitter under
   * every animation. The same rules keyed off a class kept in sync
   * here cost ~0.3ms. Each replacement has exactly the specificity
   * of the :has() it replaces, so the cascade does not change.
   * ============================================================ */
  var HAS_SWAPS = [
    [/:not\(:has\(#sidebar\.collapsed\)\)/g, ':not(.lx-hs-rail):not(#lx-z)'],
    [/(:root|html):has\(#sidebar\.collapsed\)/g, '$1.lx-hs-rail:not(#lx-z)'],
    [/#main-content:has\(#view-jarvis\.active\)/g, '#main-content.lx-hs-jarvis:not(#lx-z)'],
    [/#view-jarvis\.active:has\(\.jarvis-side:not\(\.closed\)\)/g, '#view-jarvis.active.lx-hs-side:not(.lx-z)'],
    [/\.jarvis-composer-btn:has\(> span:not\(:empty\)\)/g, '.jarvis-composer-btn.lx-hs-label:not(lx-z)'],
    [/#settings-overlay:has\(#settings-modal\.minimized\)/g, '#settings-overlay.lx-hs-min:not(#lx-z)'],
    [/\.jarvis-tool-menu-wrapper:has\(#jarvis-composer-model-btn\)/g, '.jarvis-tool-menu-wrapper:where(.lx-hs-model):not(#lx-z)'],
    [/\.jarvis-tool-menu-wrapper:has\(#jarvis-composer-inspiration-btn\)/g, '.jarvis-tool-menu-wrapper:where(.lx-hs-insp):not(#lx-z)'],
    [/label:has\(input:checked\)/g, 'label.lx-hs-checked:not(lx-z)'],
    /* Not :has(), same disease: these flags restyle `body *` when they
       go on AND when they come off — mid-motion, since their timers are
       shorter than the motions they guard. The effects they switched
       off (blur, backdrop) are no longer on this page. */
    [/html\.sidebar-animating/g, 'html.lx-off-sidebar-animating'],
    [/html\.ap-quiet/g, 'html.lx-off-ap-quiet']
  ];
  var SWAP_TEST = /:has\(|html\.sidebar-animating|html\.ap-quiet/;

  function hasText(node) {
    for (var c = node.firstChild; c; c = c.nextSibling) if (c.nodeType === 1 || c.nodeType === 3) return true;
    return false;
  }
  function syncHasFlags() {
    root.classList.toggle('lx-hs-rail', !!doc.querySelector('#sidebar.collapsed'));
    var main = doc.getElementById('main-content');
    var view = doc.getElementById('view-jarvis');
    if (main) main.classList.toggle('lx-hs-jarvis', !!(view && view.classList.contains('active') && main.contains(view)));
    if (view) view.classList.toggle('lx-hs-side', !!view.querySelector('.jarvis-side:not(.closed)'));
    var btns = doc.querySelectorAll('.jarvis-composer-btn');
    for (var i = 0; i < btns.length; i++) {
      var on = false;
      for (var k = btns[i].firstElementChild; k; k = k.nextElementSibling) if (k.tagName === 'SPAN' && hasText(k)) { on = true; break; }
      btns[i].classList.toggle('lx-hs-label', on);
    }
    var nav = doc.getElementById('sidebar-nav-scroll');
    if (nav) nav.classList.toggle('lx-ghosted', !!doc.getElementById('au-nav-ghost'));
    var overlay = doc.getElementById('settings-overlay');
    if (overlay) overlay.classList.toggle('lx-hs-min', !!doc.querySelector('#settings-modal.minimized'));
  }
  function syncStaticFlags() {
    doc.querySelectorAll('.jarvis-tool-menu-wrapper').forEach(function (w) {
      w.classList.toggle('lx-hs-model', !!w.querySelector('#jarvis-composer-model-btn'));
      w.classList.toggle('lx-hs-insp', !!w.querySelector('#jarvis-composer-inspiration-btn'));
    });
    syncChecked();
  }
  function syncChecked() {
    doc.querySelectorAll('.gender-select-pill label').forEach(function (l) {
      l.classList.toggle('lx-hs-checked', !!l.querySelector('input:checked'));
    });
  }

  function rewriteHas() {
    var changed = 0;
    function walk(list) {
      for (var i = 0; i < list.length; i++) {
        var r = list[i];
        if (r.cssRules && !r.selectorText) { walk(r.cssRules); continue; }
        var s = r.selectorText;
        if (!s || !SWAP_TEST.test(s)) continue;
        var t = s;
        for (var k = 0; k < HAS_SWAPS.length; k++) t = t.replace(HAS_SWAPS[k][0], HAS_SWAPS[k][1]);
        if (t === s) continue;
        r.selectorText = t;
        if (r.selectorText !== s) changed++;
      }
    }
    var sheets = doc.styleSheets;
    for (var i = 0; i < sheets.length; i++) {
      if (sheets[i].__lxHas) continue;
      try { walk(sheets[i].cssRules); sheets[i].__lxHas = true; } catch (e) { /* cross-origin font CSS */ }
    }
    return changed;
  }

  /* apple-polish.js writes --ap-origin (a menu's transform-origin) onto
     <html> on every pointerdown. Each new value restyles the whole
     document right as the click lands. Give it to the menus instead. */
  var MENU_SEL = '.dropdown-menu, .menu, .popover, .context-menu, .cand-source-menu, .jarvis-tool-menu, [role="menu"], .jarvis-composer-dropdown, #jarvis-more-panel, .custom-dropdown-list';
  function localiseMenuOrigin() {
    var style = root.style;
    if (style.__lxOrigin) return;
    var native = style.setProperty;
    style.__lxOrigin = true;
    style.setProperty = function (name, value, priority) {
      if (name !== '--ap-origin') return native.call(style, name, value, priority);
      var menus = doc.querySelectorAll(MENU_SEL);
      for (var i = 0; i < menus.length; i++) {
        if (menus[i].closest('.client-source-picker, .candidate-source-picker')) continue;   // those pin their own origin
        if (menus[i].style.getPropertyValue('--ap-origin') !== value) menus[i].style.setProperty('--ap-origin', value);
      }
    };
    style.removeProperty('--ap-origin');
  }

  function installPerf() {
    if (installPerf.done) return true;
    var rail = doc.getElementById('sidebar');
    var view = doc.getElementById('view-jarvis');
    if (!rail || !view) { rewriteHas(); return false; }
    installPerf.done = true;
    syncHasFlags();
    syncStaticFlags();
    rewriteHas();
    localiseMenuOrigin();
    doc.addEventListener('change', function (e) { if (e.target && e.target.closest && e.target.closest('.gender-select-pill')) syncChecked(); }, true);
    var mo = new MutationObserver(syncHasFlags);
    mo.observe(rail, { attributes: true, attributeFilter: ['class'] });
    mo.observe(view, { attributes: true, attributeFilter: ['class'], subtree: true });
    doc.querySelectorAll('.jarvis-composer-btn').forEach(function (b) {
      mo.observe(b, { childList: true, characterData: true, subtree: true });
    });
    var nav = doc.getElementById('sidebar-nav-scroll');
    if (nav) mo.observe(nav, { childList: true });
    var modal = doc.getElementById('settings-modal');
    if (modal) mo.observe(modal, { attributes: true, attributeFilter: ['class'] });
    /* Stylesheets that arrive later (lazy <link>, injected <style>). */
    function later() { syncHasFlags(); syncStaticFlags(); rewriteHas(); }
    var sheetWatch = new MutationObserver(function (records) {
      records.forEach(function (r) {
        r.addedNodes.forEach(function (n) {
          if (n.tagName === 'STYLE') later();
          else if (n.tagName === 'LINK' && /stylesheet/i.test(n.rel)) n.addEventListener('load', later, { once: true });
        });
      });
    });
    sheetWatch.observe(doc.head, { childList: true });
    sheetWatch.observe(doc.body, { childList: true });
    global.addEventListener('load', later);
    setTimeout(later, 1500);
    setTimeout(later, 5000);
    return true;
  }

  /* ============================================================
   * 3c · RAIL HOVER — one continuous liquid pill that glides like butter
   * ------------------------------------------------------------
   * Pure Apple & Emil Kowalski fluid dynamics:
   * 1. Single persistent liquid element that morphs and glides up/down
   * 2. Never disappears or snaps when moving between adjacent tabs or section labels
   * 3. Seamlessly morphs width, height, and border-radius on sub-tabs
   * 4. Batched on requestAnimationFrame to eliminate layout thrashing
   * 5. Forgiving 200ms grace period on pointerleave so brief exits don't flicker
   * ============================================================ */
  function installNavPill() {
    var nav = doc.getElementById('sidebar-nav-scroll');
    var rail = doc.getElementById('sidebar');
    if (!nav || !rail) return false;
    if (nav.__lxPill) return true;
    nav.__lxPill = true;
    var pill = doc.createElement('div');
    pill.className = 'lx-nav-pill';
    pill.setAttribute('aria-hidden', 'true');
    nav.appendChild(pill);
    nav.classList.add('lx-pill-on');
    var cur = null, shown = false, hideT = 0;
    var mouseX = 0, mouseY = 0, mouseInside = false;
    var currentW = 0, currentH = 0;
    var rafPending = 0;
    var pendingItem = null, pendingInstant = false;

    function usable() {
      return !rail.classList.contains('collapsed') || rail.classList.contains('au-peek');
    }

    function computeGeometry(item) {
      if (!item || !item.getBoundingClientRect) return null;
      var nr = nav.getBoundingClientRect(), ir = item.getBoundingClientRect();
      return {
        x: Math.round(ir.left - nr.left + nav.scrollLeft),
        y: Math.round(ir.top - nr.top + nav.scrollTop),
        w: Math.round(ir.width),
        h: Math.round(ir.height),
        isSub: item.classList.contains('nav-sub-item')
      };
    }

    function applyGeometry(geo, instant) {
      if (!geo) return;
      if (instant) {
        pill.classList.add('is-instant');
        if (geo.isSub) {
          pill.style.left = geo.x + 'px';
          pill.style.width = geo.w + 'px';
        } else {
          pill.style.left = '8px';
          pill.style.width = 'calc(100% - 16px)';
        }
        pill.style.transform = 'translate3d(0,' + geo.y + 'px,0)';
        pill.style.height = geo.h + 'px';
        pill.style.borderRadius = geo.isSub ? '7px' : '8px';
        currentW = geo.w;
        currentH = geo.h;
        var _ = pill.offsetHeight;
        requestAnimationFrame(function () {
          pill.classList.remove('is-instant');
        });
      } else {
        if (geo.isSub) {
          pill.style.left = geo.x + 'px';
          if (Math.abs(currentW - geo.w) > 1) {
            currentW = geo.w;
            pill.style.width = geo.w + 'px';
          }
        } else {
          pill.style.left = '8px';
          pill.style.width = 'calc(100% - 16px)';
          currentW = 0;
        }
        pill.style.transform = 'translate3d(0,' + geo.y + 'px,0)';
        if (Math.abs(currentH - geo.h) > 1) {
          currentH = geo.h;
          pill.style.height = geo.h + 'px';
        }
        pill.style.borderRadius = geo.isSub ? '7px' : '8px';
      }
    }

    function place(item, instant) {
      if (!item) return;
      var geo = computeGeometry(item);
      applyGeometry(geo, instant);
    }

    function schedulePlace(item, instant) {
      pendingItem = item;
      if (instant) pendingInstant = true;
      if (rafPending) return;
      rafPending = requestAnimationFrame(function () {
        rafPending = 0;
        if (pendingItem && usable()) {
          place(pendingItem, pendingInstant);
          pendingInstant = false;
        }
      });
    }

    function hide() {
      shown = false;
      cur = null;
      pill.classList.remove('is-on');
    }

    function onPointerAction(e) {
      if (e.pointerType === 'touch' || !usable()) return;
      mouseInside = true;
      mouseX = e.clientX;
      mouseY = e.clientY;
      clearTimeout(hideT);

      var item = e.target.closest && e.target.closest('.nav-item, .nav-sub-item');
      if (!item || !nav.contains(item) || item.offsetHeight === 0) return;
      if (item === cur && shown) return;

      var wasShown = shown;
      shown = true;
      cur = item;

      if (!wasShown) {
        place(item, true);
        requestAnimationFrame(function () {
          if (shown) pill.classList.add('is-on');
        });
      } else {
        schedulePlace(item, false);
      }
    }

    nav.addEventListener('pointerenter', function (e) {
      mouseInside = true;
      mouseX = e.clientX;
      mouseY = e.clientY;
      clearTimeout(hideT);
    }, { passive: true });

    nav.addEventListener('pointerover', onPointerAction, { passive: true });
    nav.addEventListener('pointermove', onPointerAction, { passive: true });

    nav.addEventListener('pointerleave', function () {
      mouseInside = false;
      clearTimeout(hideT);
      hideT = setTimeout(hide, 200);
    });

    nav.addEventListener('pointerdown', function () {
      if (cur) pill.classList.add('is-press');
    });
    doc.addEventListener('pointerup', function () {
      pill.classList.remove('is-press');
    });

    if (typeof ResizeObserver !== 'undefined') {
      var ro = new ResizeObserver(function () {
        if (shown && cur && usable()) {
          if (cur.classList.contains('nav-sub-item')) {
            schedulePlace(cur, false);
          }
        }
      });
      ro.observe(nav);
    }

    new MutationObserver(function () {
      if (!usable()) hide();
    }).observe(rail, { attributes: true, attributeFilter: ['class'] });

    rail.addEventListener('transitionend', function (e) {
      if (e.target === rail && /width/.test(e.propertyName) && shown && cur && usable()) {
        place(cur, false);
      }
    });

    // Butter-smooth scroll tracking:
    var scrollRaf = 0;
    nav.addEventListener('scroll', function () {
      if (!shown || !mouseInside || !usable()) return;
      if (scrollRaf) return;
      scrollRaf = requestAnimationFrame(function () {
        scrollRaf = 0;
        if (!mouseInside || !shown) return;
        var elAtPoint = doc.elementFromPoint(mouseX, mouseY);
        var item = elAtPoint && elAtPoint.closest && elAtPoint.closest('.nav-item, .nav-sub-item');
        if (item && nav.contains(item) && item !== cur && item.offsetHeight > 0) {
          cur = item;
          schedulePlace(item, false);
        }
      });
    }, { passive: true });

    return true;
  }

  /* Main Content: macOS-style overlay auto-hiding scrollbar active tracking */
  function installMainScrollbarHelper() {
    if (doc.__lxScrollHelper) return true;
    doc.__lxScrollHelper = true;
    var scrollTimers = typeof WeakMap !== 'undefined' ? new WeakMap() : null;
    var fallbackTimer = 0;
    doc.addEventListener('scroll', function (e) {
      var target = e.target;
      if (!target || target === doc || target === window) return;
      if (target.classList && (target.classList.contains('view') || target.classList.contains('views-container') || target.id === 'main-scroll-area')) {
        target.classList.add('is-scrolling');
        if (scrollTimers) {
          var prev = scrollTimers.get(target);
          if (prev) clearTimeout(prev);
          var t = setTimeout(function () {
            target.classList.remove('is-scrolling');
            scrollTimers.delete(target);
          }, 700);
          scrollTimers.set(target, t);
        } else {
          clearTimeout(fallbackTimer);
          fallbackTimer = setTimeout(function () {
            target.classList.remove('is-scrolling');
          }, 700);
        }
      }
    }, { capture: true, passive: true });
    return true;
  }

  /* Settings: the accent palette is gone (the owner asked); the rest
     of the sheet gets a small glide when switching sections. */
  function installSettingsPolish() {
    var overlay = doc.getElementById('settings-overlay');
    if (!overlay) return false;
    if (overlay.__lx) return true;
    overlay.__lx = true;
    Array.prototype.forEach.call(overlay.querySelectorAll('.smodal-label'), function (l) {
      if (/^\s*accent colou?r\s*$/i.test(l.textContent || '')) {
        var field = l.closest('.smodal-field');
        if (field) field.classList.add('lx-gone');
      }
    });
    var nav = typeof global.settingsNavTo === 'function' ? global.settingsNavTo : null;
    if (nav && !nav.__lx) {
      var wrapped = function (section, btn) {
        var r = nav.apply(this, arguments);
        var active = overlay.querySelector('.smodal-section.active');
        if (active && !reducedMotion()) {
          active.classList.remove('lx-sec-in');
          void active.offsetWidth;
          active.classList.add('lx-sec-in');
        }
        return r;
      };
      wrapped.__lx = true;
      global.settingsNavTo = wrapped;
    }
    return true;
  }

  /* ============================================================
   * 3b · COMPOSER — one height, measured in a twin
   * ------------------------------------------------------------
   * Two scripts resized #jarvis-input on every keystroke with
   * different minimums (26px / 30px), through an overshooting
   * height transition: the field bounced with every letter. The
   * stylesheet now reads one custom property; this is its only
   * writer, and it changes only when the number of lines does.
   * ============================================================ */
  var TWIN_PROPS = ['font-family', 'font-size', 'font-weight', 'font-style', 'font-stretch', 'letter-spacing', 'line-height',
    'text-transform', 'text-indent', 'word-spacing', 'word-break', 'overflow-wrap', 'tab-size', 'font-feature-settings', 'font-variation-settings'];
  function installComposerGrow() {
    var found = 0;
    ['jarvis-input', 'chat-input', 'candidate-ai-input'].forEach(function (id) {
      var ta = doc.getElementById(id);
      if (ta && ta.tagName === 'TEXTAREA') { found++; growOne(ta); }
    });
    return found > 0;
  }
  function growOne(ta) {
    if (ta.__lxGrow) return;
    ta.__lxGrow = true;
    /* A div, not a textarea: global textarea rules (padding, width,
       heights, all !important) would otherwise reach the twin too. */
    var twin = doc.createElement('div');
    twin.setAttribute('aria-hidden', 'true');
    doc.body.appendChild(twin);
    var MIN = 28, MAX = 208, last = -1, lastScroll = null;
    function pin(el, k, v) { el.style.setProperty(k, v, 'important'); }
    ['position:fixed', 'left:-10000px', 'top:0', 'visibility:hidden', 'pointer-events:none', 'height:auto', 'min-height:0',
     'max-height:none', 'padding:0', 'margin:0', 'border:0', 'box-sizing:content-box', 'white-space:pre-wrap',
     'overflow:hidden', 'transition:none', 'animation:none', 'contain:layout style'].forEach(function (d) {
      var i = d.indexOf(':'); pin(twin, d.slice(0, i), d.slice(i + 1));
    });

    function sync() {
      if (!ta.isConnected || !ta.clientWidth) return;
      if (!ta.value || !ta.value.trim()) {
        last = MIN;
        ta.style.setProperty('--lx-ta-h', MIN + 'px');
        ta.classList.remove('lx-grow-scroll');
        return;
      }
      var cs = getComputedStyle(ta);
      TWIN_PROPS.forEach(function (k) { pin(twin, k, cs.getPropertyValue(k)); });
      var padX = parseFloat(cs.paddingLeft) + parseFloat(cs.paddingRight);
      var padY = parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom);
      var bdY = cs.boxSizing === 'border-box' ? parseFloat(cs.borderTopWidth) + parseFloat(cs.borderBottomWidth) : 0;
      pin(twin, 'width', Math.max(1, ta.clientWidth - padX) + 'px');
      /* a trailing newline is a real line in a textarea, not in a div */
      twin.textContent = (ta.value || ' ').replace(/\n$/, '\n ');
      var natural = twin.scrollHeight + padY + bdY;
      var h = Math.max(MIN, Math.min(MAX, Math.ceil(natural)));
      if (h !== last) { last = h; ta.style.setProperty('--lx-ta-h', h + 'px'); }
      var scroll = natural > MAX + 1;
      if (scroll !== lastScroll) { lastScroll = scroll; ta.classList.toggle('lx-grow-scroll', scroll); }
    }
    ta.__lxSync = sync;
    ta.classList.add('lx-grow');
    ta.addEventListener('input', sync);
    ta.addEventListener('focus', sync);
    /* Programmatic changes (send clears it, voice fills it) all go
       through the app's own grow function, so follow that too. */
    var appGrow = ta.id === 'jarvis-input' && global.autoGrowJarvisInput;
    if (typeof appGrow === 'function' && !appGrow.__lx) {
      var wrapped = function () { var r = appGrow.apply(this, arguments); sync(); return r; };
      wrapped.__lx = true;
      global.autoGrowJarvisInput = wrapped;
    }
    new MutationObserver(sync).observe(ta, { attributes: true, attributeFilter: ['value'] });
    if (global.ResizeObserver) {
      var lastW = 0;
      new ResizeObserver(function (entries) {
        var w = Math.round(entries[0].contentRect.width);
        if (w !== lastW) { lastW = w; sync(); }
      }).observe(ta);
    }
    sync();
  }

  global.resetComposer = function (elOrId) {
    var ta = typeof elOrId === 'string' ? doc.getElementById(elOrId) : elOrId;
    if (!ta) return;
    ta.value = '';
    ta.style.removeProperty('height');
    ta.style.setProperty('height', '28px', 'important');
    ta.style.setProperty('--lx-ta-h', '28px');
    ta.classList.remove('lx-grow-scroll', 'au-shrinking', 'au-measuring');
    ta.dataset.grow = 'fit';
    var host = ta.closest ? ta.closest('.chat-container, .jarvis-input-container, .claude-input-container, .candidate-composer') : null;
    if (host) host.dataset.emptyInput = '1';
    if (typeof ta.__lxSync === 'function') ta.__lxSync();
    try { ta.dispatchEvent(new Event('input', { bubbles: true })); } catch (e) {}
  };

  /* ============================================================
   * 3d · COMPOSER ASSIST — never an empty box
   * ------------------------------------------------------------
   * While the field is empty a quiet hint cycles inside it — each
   * one a real thing Clavis can do, typed or spoken — and when the
   * owner focuses it, four suggestions rise above the box, chosen
   * from what is actually going on: the last answer, the lead
   * count, the time of day, the theme. One tap does short commands
   * at once; anything that spends credits is only filled in.
   * ============================================================ */
  var HINTS = [
    'Clavis se kuch bhi puchiye…',
    'Try: “Gurugram ke hospitals ki 20 leads nikalo”',
    'Try: “Neem Karoli Baba ki photos dikhao”',
    'Try: “Dark mode on karo”',
    'Try: “Settings me notifications kholo”',
    'Try: “Saari leads Excel me export karo”',
    'Try: “Dashboard kholo”',
    'Bolkar bhi puch sakte ho — orb par tap karo'
  ];
  function installComposerAssist() {
    var ta = doc.getElementById('jarvis-input');
    var box = ta && ta.closest('.jarvis-input-container');
    if (!ta || !box) return false;
    if (box.__lxAssist) return true;
    box.__lxAssist = true;

    /* the hint */
    var host = ta.parentElement;
    var hint = doc.createElement('span');
    hint.className = 'lx-ph';
    hint.setAttribute('aria-hidden', 'true');
    host.insertBefore(hint, ta.nextSibling);
    box.classList.add('lx-ph-on');
    var hi = 0, rot = 0;
    function paintHint(text, animate) {
      if (!animate || reducedMotion()) { hint.textContent = text; return; }
      hint.classList.add('is-out');
      setTimeout(function () { hint.textContent = text; hint.classList.remove('is-out'); }, 260);
    }
    function syncHint() { box.classList.toggle('lx-ph-hide', !!ta.value); }
    function rotate() {
      clearInterval(rot);
      rot = setInterval(function () {
        if (ta.value || doc.activeElement === ta || doc.hidden) return;
        hi = (hi + 1) % HINTS.length;
        paintHint(HINTS[hi], true);
      }, 4800);
    }
    paintHint(HINTS[0], false);
    rotate();
    ta.addEventListener('input', syncHint);
    ta.addEventListener('focus', function () { if (hi !== 0) { hi = 0; paintHint(HINTS[0], true); } });
    new MutationObserver(syncHint).observe(ta, { attributes: true, attributeFilter: ['value'] });
    var appGrow = global.autoGrowJarvisInput;
    if (typeof appGrow === 'function' && !appGrow.__lxHint) {
      /* every path that empties the field (send, clear, voice) comes through
         here — keep the hint and the app's clear/send state honest too */
      var w2 = function () {
        var r = appGrow.apply(this, arguments);
        syncHint();
        if (typeof global.updateComposerTypingState === 'function') { try { global.updateComposerTypingState(); } catch (e) {} }
        return r;
      };
      w2.__lx = appGrow.__lx; w2.__lxHint = true;
      global.autoGrowJarvisInput = w2;
    }

    /* the suggestions */
    var row = doc.createElement('div');
    row.className = 'lx-suggest';
    row.setAttribute('role', 'list');
    row.setAttribute('aria-label', 'Suggestions');
    box.parentElement.insertBefore(row, box);
    var hideT = 0;

    function pick() {
      var out = [];
      var t = currentTask();
      var pt = t && PicTasks.get(t.id);
      var fresh = t && t.phase === 'completed' && Date.now() - (t.endedAt || 0) < 20 * 60000;
      if (fresh && pt && pt.bundle && pt.bundle.items.length) {
        out.push({ icon: 'user', label: 'About ' + clip(pt.bundle.name, 22), text: pt.bundle.name + ' ke baare me detail me batao', send: true });
      } else if (fresh && t._text && !QuickTasks.has(t.id)) {
        out.push({ icon: 'bookOpen', label: 'Explain that simply', text: 'Pichla jawab simple language me examples ke saath samjhao', send: true });
      }
      var leads = (global.allLeads && global.allLeads.length) || 0;
      if (leads) {
        out.push({ icon: 'table', label: 'Export ' + leads + ' leads', text: 'Saari leads Excel me export karo', send: true });
        out.push({ icon: 'search', label: 'Best leads today', text: 'Meri leads me se sabse promising 5 companies batao aur kyun', send: true });
      } else {
        out.push({ icon: 'zap', label: '20 hotel leads · Gurugram', text: 'Gurugram me 20 hotels ki leads nikalo jinhe security guards chahiye', send: false });
      }
      var h = new Date().getHours();
      out.push(h < 12 ? { icon: 'listChecks', label: 'Plan my day', text: 'Aaj ke sales kaam ka simple plan banao', send: true }
        : h < 18 ? { icon: 'message', label: 'Follow-up message', text: 'Ek client ke liye polite follow-up WhatsApp message likho', send: true }
        : { icon: 'list', label: 'Summarise my day', text: 'Aaj ke kaam ka short summary aur kal ke 3 next steps batao', send: true });
      out.push({ icon: 'images', label: 'Show me photos', text: 'Taj Mahal ki photos dikhao', send: true });
      var dark = root.getAttribute('data-theme') === 'dark';
      out.push({ icon: dark ? 'sparkles' : 'sparkles', label: dark ? 'Light mode' : 'Dark mode', text: dark ? 'Light mode on karo' : 'Dark mode on karo', send: true });
      return out.slice(0, 4);
    }
    function paint() {
      row.innerHTML = pick().map(function (s, i) {
        return '<button type="button" role="listitem" class="lx-suggest-chip" style="--i:' + i + '" data-text="' + esc(s.text) + '" data-send="' + (s.send ? '1' : '') + '">' +
          icon(s.icon, 13) + '<span>' + esc(s.label) + '</span></button>';
      }).join('');
    }
    function show() {
      clearTimeout(hideT);
      if (ta.value || !doc.getElementById('view-jarvis') || !doc.getElementById('view-jarvis').classList.contains('active')) return;
      if (!row.classList.contains('is-on')) { paint(); row.classList.add('is-on'); }
    }
    function hide(delay) {
      clearTimeout(hideT);
      hideT = setTimeout(function () { row.classList.remove('is-on'); }, delay || 0);
    }
    ta.addEventListener('focus', show);
    ta.addEventListener('input', function () { if (ta.value) hide(); else show(); });
    ta.addEventListener('blur', function () { hide(180); });
    row.addEventListener('pointerdown', function (e) { e.preventDefault(); });   // keep focus in the field
    row.addEventListener('click', function (e) {
      var chip = e.target.closest && e.target.closest('.lx-suggest-chip');
      if (!chip) return;
      hide();
      if (chip.dataset.send) askClavis(chip.dataset.text);
      else { ta.value = chip.dataset.text; ta.dispatchEvent(new Event('input', { bubbles: true })); ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length); }
    });
    return true;
  }

  /* ============================================================
   * 4 · SURFACE — rows, titles, and the Deep Dive
   * ============================================================ */
  function surfaceEl() { return doc.getElementById('clavis-task-surface'); }
  function currentTask() {
    try { return global.ClavisTask && global.ClavisTask.current ? global.ClavisTask.current() : null; } catch (e) { return null; }
  }
  function resultText(task) {
    var r = (task && task.result) || {};
    return String(r.text || r.summary || '').trim();
  }

  var ROW_ICON = {
    detail: 'bookOpen', summary: 'list', next: 'listChecks', simplify: 'feather', working: 'calculator',
    table: 'table', rewrite: 'penLine', visual: 'images', tool: 'zap', go: 'arrowUpRight', follow: 'cornerDownRight'
  };
  var KIND_LABEL = {
    detail: 'Deep dive', summary: 'Summary', next: 'Next steps', simplify: 'Simplified', working: 'The working',
    table: 'Table', rewrite: 'Rewrite', visual: 'Visuals'
  };

  /* What a follow-up is, from its own words. Anything that has to
     touch the app's data (leads, exports, sends) goes through the
     engine and its tools; everything that is about understanding the
     answer better is answered right here in the panel. */
  function kindFor(label, ask) {
    var t = (String(label || '') + ' ' + String(ask || '')).toLowerCase();
    if (/summary|summar|3[- ]?point|bullet/.test(t)) return 'summary';
    if (/next step|next steps|action plan|practical action|what should i do|kya karu/.test(t)) return 'next';
    if (/simplif|simple aur clear|simple language|asaan/.test(t)) return 'simplify';
    if (/show the working|breakdown|step[- ]by[- ]step dikhao|yearly|12 mahine/.test(t)) return 'working';
    if (/table format|as table|chart ya table|show as table/.test(t)) return 'table';
    if (/visual|image|photo|picture|tasveer/.test(t)) return 'visual';
    if (/hindi version|in hindi|shorter|chhota|personali|follow-up variant|direct kar do|rewrite/.test(t)) return 'rewrite';
    if (/\bleads?\b|contacts?|export|excel|whatsapp|outreach|duplicates|decision maker|calling script|cold email|nikalo|message draft|send via/.test(t)) return 'tool';
    return 'detail';
  }

  function decorateRow(b) {
    if (b.dataset.lx) return;
    b.dataset.lx = '1';
    var label = (b.textContent || '').replace(/\s+/g, ' ').trim();
    var kind = (b.dataset.auGo || b.dataset.lxLink) ? 'go' : (b.dataset.lxFollow ? 'follow' : kindFor(label, b.dataset.auAsk || b.dataset.lxAsk || ''));
    b.dataset.lxKind = kind;
    b.textContent = '';
    b.insertAdjacentHTML('beforeend',
      '<span class="lx-row-icon">' + icon(ROW_ICON[kind] || 'arrowRight', 15) + '</span>' +
      '<span class="lx-row-label"></span>' +
      '<span class="lx-row-arrow">' + icon(kind === 'go' ? 'arrowUpRight' : 'arrowRight', 15) + '</span>');
    b.querySelector('.lx-row-label').textContent = label;
    if (!b.getAttribute('aria-label')) b.setAttribute('aria-label', label);
  }

  var GENERIC_TITLE = /^(Answered|Done|Search complete|Research complete|Draft ready|Created|Changes ready|Document analysed)$/;
  function cleanQuestion(text) {
    var t = String(text || '').replace(/\s+/g, ' ').trim();
    t = t.replace(/^(hi|hello|hey|hii+|namaste|ok|okay|acha|accha)\b[\s,!.]*/i, '');
    t = t.replace(/^(clavis|jarvis)\b[\s,!.:-]*/i, '');
    t = t.replace(/^(hi|hello|hey|namaste)\b[\s,!.]*/i, '');
    if (t.length < 4 || t.split(' ').length < 2) return '';
    /* his words, minus the typos and the "mujhe…batao" wrapping */
    try { t = Sense.cleanPhrase(t) || t; } catch (e) {}
    t = t.charAt(0).toUpperCase() + t.slice(1);
    return clip(t, 96);
  }

  function decorateAnswer(el, body) {
    if (el.getAttribute('data-phase') !== 'completed') return;
    var h = body.querySelector(':scope > h2.cts-title');
    if (!h || h.dataset.lx) return;
    h.dataset.lx = '1';
    if (body.querySelector(':scope > .cts-kicker')) return;   // intent bodies carry their own
    var generic = (h.textContent || '').trim();
    if (!GENERIC_TITLE.test(generic)) return;
    var q = cleanQuestion(currentTask() && currentTask()._text);
    if (!q) return;
    var kick = doc.createElement('p');
    kick.className = 'cts-kicker lx-ask-kicker';
    kick.textContent = generic === 'Answered' ? 'Answer' : generic;
    h.textContent = q;
    body.insertBefore(kick, h);
    /* the local pass knows common typos, not every name — the model
       proofreads the heading and it sharpens in place (≤ 3.5 s) */
    try {
      Sense.polish(q).then(function (better) {
        if (better && h.isConnected && h.textContent === q) swapText(h, clip(better, 96));
      });
    } catch (e) {}
  }

  /* Height moves on the panel's own spring (clavis-aurora.css). */
  function morphHeight(el, mutate) {
    var prev = el.getBoundingClientRect().height;
    mutate();
    el.style.height = 'auto';
    var next = el.getBoundingClientRect().height;
    if (!prev || Math.abs(next - prev) < 1 || reducedMotion()) { el.style.height = 'auto'; return; }
    el.style.height = prev + 'px';
    void el.offsetHeight;
    el.style.height = next + 'px';
    clearTimeout(el._lxH);
    el._lxH = setTimeout(function () { el.style.height = 'auto'; }, 520);
  }

  function keepOnScreen(el) {
    if (!el.classList.contains('is-moved')) return;
    setTimeout(function () {
      var r = el.getBoundingClientRect();
      var over = r.right - (global.innerWidth - 10);
      if (over > 0) el.style.left = Math.max(10, r.left - over) + 'px';
    }, 460);
  }

  function setHeadLabel(el, text) {
    var label = el.querySelector('.cts-head-label');
    if (label) label.textContent = text;
  }

  function openView(name) {
    try {
      if (typeof global.showView === 'function') return global.showView(name);
      if (typeof global.switchView === 'function') return global.switchView(name);
    } catch (e) { console.warn('[ClavisLuxe] view', name, e); }
  }

  /* The engine path — identical to typing it and pressing send. */
  function askClavis(text) {
    var input = doc.getElementById('jarvis-input');
    if (!input) return false;
    input.value = text;
    try { input.dispatchEvent(new Event('input', { bubbles: true })); } catch (e) {}
    if (typeof global.handleJarvisSend === 'function') { global.handleJarvisSend(); return true; }
    var send = doc.getElementById('jarvis-send-btn');
    if (send) { send.click(); return true; }
    return false;
  }

  function toast(type, title, msg) {
    try { if (typeof global.showToast === 'function') global.showToast(type, title, msg); } catch (e) {}
  }

  /* ── The session: a small stack so Back always goes back ───── */
  var session = null;   // { taskId, stack: [{type, html, scroll, job?}], job, headLabel }
  var jobSeq = 0;

  function snapshotSession(el, body) {
    if (!session || !body || !body.querySelector(':scope > .lx-dd')) return;
    session.viewHtml = body.innerHTML;
    session.viewScroll = body.scrollTop;
    var l = el.querySelector('.cts-head-label');
    session.viewHead = l ? l.textContent : '';
  }
  function restoreSession(el, body) {
    session.restoring = true;
    body.innerHTML = session.viewHtml;
    el.classList.add('lx-wide');
    el.setAttribute('data-lx-view', 'deep');
    var foot = el.querySelector('.cts-foot');
    if (foot) foot.hidden = true;
    if (session.viewHead) setHeadLabel(el, session.viewHead);
    body.scrollTop = session.viewScroll || 0;
    Array.prototype.forEach.call(body.querySelectorAll('.cts-next-btn'), decorateRow);
    session.restoring = false;
  }

  function endSession(el) {
    if (!session) return;
    if (session.job && session.job.ctrl) { try { session.job.ctrl.abort(); } catch (e) {} }
    var s = session;
    session = null;
    if (!el) return;
    var b = el.querySelector('.cts-body');
    if (b) b.classList.remove('lx-leaving');
    el.classList.remove('lx-wide');
    el.removeAttribute('data-lx-view');
    setHeadLabel(el, s.headLabel || 'Done');
    var foot = el.querySelector('.cts-foot');
    if (foot && s.footHidden === false) foot.hidden = false;
  }

  function onBodyMutation(el, body) {
    var mine = !!body.querySelector(':scope > .lx-dd');
    if (!mine && session && !session.restoring) {
      /* Closing and reopening the panel repaints the task's first
         answer. If the owner had gone deeper on that same task, put
         them back where they were — Back still walks the trail. */
      var t = currentTask();
      if (session.viewHtml && t && t.id === session.taskId && t.phase === 'completed') { restoreSession(el, body); return; }
      endSession(el);
    }
    if (!mine) {
      body.classList.remove('lx-leaving');
      decorateQuick(el, body);
      decorateAnswer(el, body);
      decoratePictures(el, body);
      Array.prototype.forEach.call(body.querySelectorAll('.cts-next-btn'), decorateRow);
      var result = body.querySelector('.cts-result');
      if (result) enhanceImages(result, function () { morphHeight(el, function () {}); });
    } else {
      Array.prototype.forEach.call(body.querySelectorAll('.cts-next-btn'), decorateRow);
    }
  }

  function installSurface() {
    var el = surfaceEl();
    if (!el) return false;
    if (el.__lx) return true;
    var body = el.querySelector('.cts-body');
    if (!body) return false;
    el.__lx = true;
    new MutationObserver(function () { onBodyMutation(el, body); }).observe(body, { childList: true });
    var wasOpen = el.classList.contains('is-open');
    new MutationObserver(function () {
      var open = el.classList.contains('is-open');
      if (wasOpen && !open) snapshotSession(el, body);
      wasOpen = open;
    }).observe(el, { attributes: true, attributeFilter: ['class'] });
    onBodyMutation(el, body);

    /* Clicks inside the panel, delegated once. Capture, so nothing
       older can double-handle a follow-up. */
    el.addEventListener('click', function (e) {
      var t = e.target;
      if (!t || !t.closest) return;
      var next = t.closest('.cts-next-btn');
      if (next && el.contains(next)) {
        e.preventDefault();
        e.stopPropagation();
        onNext(el, body, next, e);
        return;
      }
      var act = t.closest('[data-lx-act]');
      if (act && el.contains(act)) {
        e.preventDefault();
        e.stopPropagation();
        onAct(el, body, act);
      }
    }, true);

    el.addEventListener('pointerdown', function (e) {
      var row = e.target.closest && e.target.closest('.cts-next-btn');
      if (!row || reducedMotion()) return;
      var r = row.getBoundingClientRect();
      var dot = doc.createElement('span');
      dot.className = 'lx-ripple';
      dot.style.left = (e.clientX - r.left) + 'px';
      dot.style.top = (e.clientY - r.top) + 'px';
      row.appendChild(dot);
      setTimeout(function () { dot.remove(); }, 760);
    });
    return true;
  }

  function onNext(el, body, btn, e) {
    if (btn.classList.contains('is-picked')) return;
    var kind = btn.dataset.lxKind || 'detail';
    var label = ((btn.querySelector('.lx-row-label') || btn).textContent || '').trim();
    var ask = btn.dataset.auAsk || btn.dataset.lxAsk || label;

    if (btn.dataset.lxLink) {
      try { global.open(btn.dataset.lxLink, '_blank', 'noopener,noreferrer'); } catch (e2) {}
      return;
    }
    if (btn.dataset.auGo) {
      btn.classList.add('is-picked');
      setTimeout(function () { btn.classList.remove('is-picked'); openView(btn.dataset.auGo); }, 260);
      return;
    }
    if (kind === 'tool') {
      pickRow(body, btn);
      setTimeout(function () {
        if (!askClavis(ask)) toast('error', 'Could not send', 'The Clavis composer was not found.');
      }, 320);
      /* A real run repaints the panel with the new task. If nothing
         took over (no brain, a device command, an error toast), put
         the rows back so the panel is never left looking busy. */
      setTimeout(function () {
        if (!btn.isConnected) return;
        Array.prototype.forEach.call(body.querySelectorAll('.cts-next-btn'), function (b) { b.classList.remove('is-picked', 'is-dimmed'); });
      }, 4000);
      return;
    }
    if (kind === 'follow') kind = kindFor(label, ask);
    startDeepDive(el, body, btn, kind === 'tool' ? 'detail' : kind, label, ask);
  }

  function pickRow(body, btn) {
    btn.classList.add('is-picked');
    Array.prototype.forEach.call(body.querySelectorAll('.cts-next-btn'), function (b) {
      if (b !== btn) b.classList.add('is-dimmed');
    });
  }

  /* ── Deep dive: launch ───────────────────────────────────────── */
  function startDeepDive(el, body, btn, kind, label, ask) {
    var task = currentTask();
    var first = !session;
    var snapshot = body.innerHTML;             // before any pick classes
    var scroll = body.scrollTop;

    var ctx;
    if (first) {
      ctx = {
        question: (task && task._text) || '',
        answer: resultText(task),
        mode: (task && task.mode) || 'thinking',
        rows: task && task.result && Array.isArray(task.result.rows) ? task.result.rows.slice(0, 8) : null,
        trail: ''
      };
      if (!ctx.answer) ctx.answer = (body.innerText || '').slice(0, 1600);
    } else {
      var prevJob = session.job || {};
      var d = prevJob.data || {};
      ctx = {
        question: label,
        answer: [d.title, d.tldr].concat((d.points || []).map(function (p) { return (p.title ? p.title + ': ' : '') + p.detail; })).filter(Boolean).join('\n'),
        mode: 'thinking',
        rows: null,
        trail: (prevJob.ctx ? prevJob.ctx.question : '') + ' → ' + (prevJob.label || '')
      };
    }

    pickRow(body, btn);
    el.classList.add('lx-wide');
    keepOnScreen(el);

    if (first) {
      var foot = el.querySelector('.cts-foot');
      var label0 = el.querySelector('.cts-head-label');
      session = {
        taskId: task ? task.id : null,
        stack: [],
        job: null,
        headLabel: label0 ? label0.textContent : 'Done',
        footHidden: foot ? foot.hidden : true
      };
      if (foot) foot.hidden = true;
    } else if (session.job && session.job.ctrl) {
      try { session.job.ctrl.abort(); } catch (e) {}
    }
    session.stack.push({ type: first ? 'answer' : 'deep', html: snapshot, scroll: scroll, job: first ? null : session.job });

    var job = {
      id: ++jobSeq, kind: kind, label: label, ask: ask, ctx: ctx,
      ctrl: (typeof AbortController === 'function') ? new AbortController() : { signal: undefined, abort: function () {} },
      data: null
    };
    session.job = job;
    el.setAttribute('data-lx-view', 'deep');

    setTimeout(function () { if (session && session.job === job) body.classList.add('lx-leaving'); }, 190);
    setTimeout(function () {
      if (!session || session.job !== job) return;
      setHeadLabel(el, 'Researching');
      session.restoring = true;
      morphHeight(el, function () {
        body.classList.remove('lx-leaving');
        body.innerHTML = loadingHTML(job);
        body.scrollTop = 0;
      });
      session.restoring = false;
      runJob(el, body, job);
    }, 400);
  }

  function barHTML() {
    return '<div class="lx-dd-bar">' +
      '<button type="button" class="lx-dd-back" data-lx-act="back">' + icon('arrowLeft', 15) + '<span>Back</span></button>' +
      '<div class="lx-dd-tools">' +
      '<button type="button" class="lx-dd-tool" data-lx-act="copy" aria-label="Copy" title="Copy">' + icon('copy', 15) + '</button>' +
      '<button type="button" class="lx-dd-tool" data-lx-act="chat" aria-label="Add to chat" title="Add to chat">' + icon('chatText', 15) + '</button>' +
      '</div></div>';
  }

  var STEPS = ['Understanding', 'Gathering', 'Writing', 'Visuals'];
  function loadingHTML(job) {
    var steps = STEPS.map(function (s, i) {
      return '<li' + (i === 0 ? ' class="is-live"' : '') + '><i></i><span>' + s + '</span>' + (i < STEPS.length - 1 ? '<b></b>' : '') + '</li>';
    }).join('');
    var topic = clip(job.ctx.question, 140);
    return '<div class="lx-dd" data-kind="' + job.kind + '" data-state="loading" aria-busy="true">' +
      barHTML() +
      '<p class="cts-kicker lx-dd-kicker">' + icon(ROW_ICON[job.kind] || 'bookOpen', 13) + esc(job.label) + '</p>' +
      '<h2 class="cts-title lx-dd-title">' + esc(researchVerb(job.kind)) + '</h2>' +
      (topic ? '<p class="lx-dd-topic">“' + esc(topic) + '”</p>' : '') +
      '<ol class="lx-steps" aria-label="Progress">' + steps + '</ol>' +
      '<div class="lx-skel" aria-hidden="true"><div class="sk-line w90"></div><div class="sk-line w75"></div>' +
      '<div class="sk-media"></div><div class="sk-line w90"></div><div class="sk-line w60"></div><div class="sk-card"></div><div class="sk-card"></div></div>' +
      '</div>';
  }
  function researchVerb(kind) {
    return ({
      detail: 'Digging deeper…', summary: 'Distilling it…', next: 'Planning your moves…', simplify: 'Making it simple…',
      working: 'Working it out…', table: 'Building the table…', rewrite: 'Rewriting…', visual: 'Finding visuals…'
    })[kind] || 'Researching…';
  }

  function setStep(body, job, n) {
    if (!session || session.job !== job) return;
    var items = body.querySelectorAll('.lx-steps li');
    Array.prototype.forEach.call(items, function (li, i) {
      li.classList.toggle('is-done', i < n);
      li.classList.toggle('is-live', i === n);
    });
  }

  /* ── Deep dive: the work ─────────────────────────────────────── */
  function runJob(el, body, job) {
    var signal = job.ctrl.signal;
    var started = performance.now();
    var kw = keywords(job.ctx.question);
    if (kw.split(' ').length < 2) kw = keywords(job.ctx.question + ' ' + job.ctx.answer.slice(0, 160));
    var notesP = (kw && job.kind !== 'rewrite' && job.kind !== 'working')
      ? Research.wiki(kw, signal, 4).catch(function () { return []; })
      : Promise.resolve([]);

    wait(460).then(function () {
      setStep(body, job, 1);
      return Research.within(notesP, 2600, []);
    }).then(function (notes) {
      if (!alive(job)) return null;
      setStep(body, job, 2);
      var brain = Research.hasBrain();
      var p = brain
        ? Research.llm(buildMessages(job, notes), signal).then(parseDeep, function (err) { job.error = err; return null; })
        : Promise.resolve(null);
      return p.then(function (data) {
        job.offline = !brain;
        job.notes = notes;
        return data;
      });
    }).then(function (data) {
      if (!alive(job)) return;
      if (!data || isEmptyDeep(data)) data = fallbackDeep(job);
      job.data = data;
      setStep(body, job, 3);
      /* Pictures only of the ONE named thing the answer is about, from
         the trusted chain in Pictures — loose keyword searches are how
         a tortoise ended up under a saint. General advice gets none. */
      var det = Pictures.detect(job.ctx.question);
      var subject = str(data.subject) || (det && det.subject) || '';
      var wantsMedia = !!subject && (job.kind === 'visual' || job.kind === 'detail' || job.kind === 'simplify');
      var imagesP = wantsMedia
        ? Pictures.find(subject, { era: det && det.era }, signal).then(function (b) { return b.sure ? b.items.slice(0, 7) : []; }, function () { return []; })
        : Promise.resolve([]);
      var minDwell = Math.max(0, 900 - (performance.now() - started));
      return wait(Math.min(minDwell, 360) + 220).then(function () {
        if (!alive(job)) return;
        renderDeep(el, body, job, wantsMedia);
        return Research.within(imagesP, 7000, []).then(function (imgs) {
          if (!alive(job)) return;
          fillMedia(el, body, job, imgs || []);
        });
      });
    }).catch(function (err) {
      if (!alive(job)) return;
      console.warn('[ClavisLuxe] deep dive failed', err);
      job.error = err;
      job.data = fallbackDeep(job);
      renderDeep(el, body, job, false);
    });
  }
  function alive(job) { return !!(session && session.job === job && !(job.ctrl.signal && job.ctrl.signal.aborted)); }

  function isEmptyDeep(d) {
    return !d || !(d.tldr || d.draft || (d.points && d.points.length) || (d.steps && d.steps.length) ||
      (d.examples && d.examples.length) || (d.table && d.table.rows && d.table.rows.length));
  }

  var STOP = new Set(('a an the and or but if to of in on for with by from at as is are was were be been being do does did have has had i you he she it we they me my your our their this that these those what which who whom how why when where can could should would will shall may might must not no yes please tell give show make explain about into than then so very more most some any each every also just only get got want need like ' +
    'ko ki ka ke kya kaise kaisa kaisi kyu kyun kyunki hai hain ho hoga hogi hoge raha rahi rahe tha thi the me mein se par pe aur ya bhi to toh na nahi nahin kar karo karu karun karna karne karte karta karti karke karein kijiye dijiye batao bataiye bata samjhao samjha chahiye chahta chahti mujhe mera meri mere hum ham aap aapka aapki iska uska iske uske isko usko inke inka inki unke unka unki yeh ye woh wo jo jis jiske koi kuch sab sabse har ek do teen jab tab agar lekin isliye matlab yani phir abhi kabhi hamesha thoda bahut bohot zyada jyada kam liye jaise wahi wala wali wale apne apna apni hota hoti hote rakho lagao dekho bolo sirf bas zaroor jaldi sir clavis jarvis hello hi hey namaste acha accha theek thik sahi haan ji detail examples example summary point points next step steps').split(' '));
  function keywords(text) {
    var words = String(text || '').toLowerCase().match(/[a-z][a-z0-9-]{2,}/g) || [];
    var seen = {}, out = [];
    words.forEach(function (w) {
      if (STOP.has(w) || seen[w]) return;
      seen[w] = 1;
      out.push(w);
    });
    return out.slice(0, 4).join(' ');
  }

  /* ── Prompt ──────────────────────────────────────────────────── */
  var SYSTEM = [
    'You are Clavis Deep Dive, a sharp research writer inside a business app used by an Indian security-guard and facility-staffing company.',
    'Your job: expand an earlier answer for the ACTION the user tapped. Stay on the same topic.',
    '',
    'OUTPUT: exactly one JSON object and nothing else. No markdown, no code fences, no commentary.',
    'LANGUAGE: write every text value in the same language and script as QUESTION. Roman Hinglish stays Roman Hinglish. Devanagari Hindi stays Devanagari. English stays English. Keep business terms in English.',
    'TRUTH: never invent statistics, prices, laws, dates, company names or quotes. If you are not sure of a number, describe it without the number. Examples are illustrative scenarios, not claims about real companies.',
    'STYLE: short, concrete, practical. Each text value at most 32 words. No emoji.',
    '',
    'ACTION RULES:',
    '{rules}',
    '',
    'JSON KEYS (always include every key; use "" or [] when it does not apply):',
    '{"subject": string, "title": string (max 8 words), "tldr": string, "points": [{"title": string (2-6 words), "detail": string}], "examples": [{"title": string, "situation": string, "action": string, "result": string}], "steps": [{"title": string, "detail": string, "when": string}], "pitfalls": [string], "table": {"columns": [string], "rows": [[string]]}, "draft": string, "takeaway": string, "image_queries": [string], "followups": [string]}',
    '',
    'subject: the exact English name, as titled on Wikipedia, of the ONE real and specific person, place, organisation, event or object the question is about (for example "Neem Karoli Baba", "Taj Mahal", "Tata Group"). Use "" for general advice, how-to or business topics with no single named subject.',
    'image_queries: always [].',
    'followups: 3 short follow-up questions (max 7 words each) in the language of QUESTION.'
  ].join('\n');

  var RULES = {
    detail: 'points: 3 to 5 key ideas. examples: 2 or 3 realistic scenarios from the user\'s world (security, facility staffing, B2B sales in India) when relevant. pitfalls: 2 or 3 common mistakes. takeaway: one memorable line. steps, table, draft: empty.',
    summary: 'points: exactly 3; title is a bold 2-5 word lead, detail is one sentence. tldr: the bottom line in one sentence. takeaway, examples, steps, pitfalls, table, draft: empty.',
    next: 'steps: 4 to 6 concrete actions in order; "when" is a short time label such as "Aaj", "Is hafte", "Is mahine" written in the language of QUESTION. The first step must be doable today. pitfalls: 1 or 2. takeaway: one line. points, examples, table, draft: empty.',
    simplify: 'tldr: the whole idea in one plain sentence a school student understands. points: 3 plain-language points. examples: exactly 1 everyday analogy (situation = the analogy, action = how it maps, result = the lesson). takeaway: one line. steps, pitfalls, table, draft: empty.',
    working: 'steps: every calculation line in order (title = what is computed, detail = the arithmetic with numbers, when = ""). tldr: the final result. takeaway: one line of interpretation. Use only numbers present in QUESTION or ANSWER; if a needed number is missing, say which one in tldr. image_queries: [].',
    table: 'table: 2 to 5 columns and 3 to 8 rows built only from QUESTION and ANSWER. tldr: what the table shows. points: up to 2 insights. image_queries: []. Everything else empty.',
    rewrite: 'draft: the complete rewritten text, ready to paste (use \\n for line breaks). points: 2 or 3 notes on what changed (title 2-4 words). tldr: one line describing the new version. image_queries: []. Everything else empty.',
    visual: 'points: 3 things the pictures should help the user notice. tldr: one line. image_queries: 3 or 4 phrases. Everything else empty.'
  };

  function buildMessages(job, notes) {
    var sys = SYSTEM.replace('{rules}', RULES[job.kind] || RULES.detail);
    var u = [];
    u.push('QUESTION: ' + clip(job.ctx.question || '(not given)', 700));
    u.push('ANSWER: ' + clip(job.ctx.answer || '(not given)', 2600));
    u.push('ACTION: ' + job.label + (job.ask && job.ask !== job.label ? ' — ' + job.ask : ''));
    if (job.ctx.rows && job.ctx.rows.length) u.push('DATA ROWS: ' + clip(JSON.stringify(job.ctx.rows), 1400));
    if (job.ctx.trail) u.push('EARLIER: ' + clip(job.ctx.trail, 400));
    if (notes && notes.length) {
      u.push('REFERENCE NOTES (use only if relevant; they may be unrelated):\n' + notes.slice(0, 3).map(function (n) {
        return '- ' + n.title + ': ' + clip(n.extract, 280);
      }).join('\n'));
    }
    var trainedDs = [];
    try { trainedDs = JSON.parse(localStorage.getItem('clavis_trained_dataset') || '[]'); } catch (e) { trainedDs = []; }
    if (trainedDs.length) {
      u.push('TRAINED USER RULES & PREFERENCES:\n' + trainedDs.slice(0, 5).map(function (d) { return '- ' + d.fact; }).join('\n'));
    }
    u.push('Return the JSON object now.');
    return [{ role: 'system', content: sys }, { role: 'user', content: u.join('\n\n') }];
  }

  function parseDeep(raw) {
    var t = String(raw || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '');
    var a = t.indexOf('{'), b = t.lastIndexOf('}');
    var obj = null;
    if (a > -1 && b > a) {
      var s = t.slice(a, b + 1);
      try { obj = JSON.parse(s); } catch (e) {
        try { obj = JSON.parse(s.replace(/[“”]/g, '"').replace(/,\s*([}\]])/g, '$1')); } catch (e2) { obj = null; }
      }
    }
    return obj ? normalizeDeep(obj) : textToDeep(t);
  }
  function str(v) { return typeof v === 'string' ? v.trim() : (v == null ? '' : (typeof v === 'object' ? '' : String(v).trim())); }
  function arr(v) { return Array.isArray(v) ? v : []; }
  function normalizeDeep(o) {
    var table = o.table && typeof o.table === 'object' ? {
      columns: arr(o.table.columns).map(str).slice(0, 5),
      rows: arr(o.table.rows).filter(Array.isArray).map(function (r) { return r.map(str).slice(0, 5); }).slice(0, 10)
    } : null;
    if (table && (!table.columns.length || !table.rows.length)) table = null;
    return {
      subject: str(o.subject).slice(0, 100),
      title: str(o.title).slice(0, 120),
      tldr: str(o.tldr),
      points: arr(o.points).map(function (p) { return typeof p === 'string' ? { title: '', detail: p.trim() } : { title: str(p && p.title), detail: str(p && p.detail) }; })
        .filter(function (p) { return p.title || p.detail; }).slice(0, 6),
      examples: arr(o.examples).map(function (x) { return x && typeof x === 'object' ? { title: str(x.title), situation: str(x.situation), action: str(x.action), result: str(x.result) } : { title: '', situation: str(x), action: '', result: '' }; })
        .filter(function (x) { return x.title || x.situation || x.action; }).slice(0, 3),
      steps: arr(o.steps).map(function (s) { return typeof s === 'string' ? { title: s.trim(), detail: '', when: '' } : { title: str(s && s.title), detail: str(s && s.detail), when: str(s && s.when) }; })
        .filter(function (s) { return s.title || s.detail; }).slice(0, 8),
      pitfalls: arr(o.pitfalls).map(str).filter(Boolean).slice(0, 4),
      table: table,
      draft: str(o.draft),
      takeaway: str(o.takeaway),
      image_queries: arr(o.image_queries).map(str).filter(function (q) { return q && q.length < 60; }).slice(0, 4),
      followups: arr(o.followups).map(str).filter(Boolean).slice(0, 3),
      background: []
    };
  }
  function sentences(text) {
    return String(text || '').replace(/\s+/g, ' ').trim().split(/(?<=[.!?।])\s+(?=\S)/).map(function (s) { return s.trim(); }).filter(function (s) { return s.length > 2; });
  }
  function textToDeep(t) {
    var clean = String(t || '').replace(/[#*_>`]/g, '').trim();
    var lines = clean.split(/\n+/).map(function (l) { return l.trim(); }).filter(Boolean);
    var bullets = lines.filter(function (l) { return /^([-•]|\d+[.)])\s+/.test(l); }).map(function (l) { return l.replace(/^([-•]|\d+[.)])\s+/, ''); });
    var paras = lines.filter(function (l) { return !/^([-•]|\d+[.)])\s+/.test(l); });
    var d = normalizeDeep({});
    d.tldr = paras[0] || '';
    d.points = (bullets.length ? bullets : sentences(paras.slice(1).join(' '))).slice(0, 5).map(function (x) { return { title: '', detail: x }; });
    return d;
  }

  function fallbackDeep(job) {
    var d = normalizeDeep({});
    var s = sentences(job.ctx.answer);
    d.title = KIND_LABEL[job.kind] || job.label;
    if (job.kind === 'summary') {
      d.tldr = s[0] || '';
      d.points = s.slice(0, 3).map(function (x) { return { title: '', detail: x }; });
    } else if (job.kind === 'next') {
      d.tldr = s[0] || '';
      d.steps = s.slice(0, 5).map(function (x) { return { title: x, detail: '', when: '' }; });
    } else {
      d.tldr = s[0] || '';
      d.points = s.slice(1, 5).map(function (x) { return { title: '', detail: x }; });
    }
    d.background = (job.notes || []).slice(0, 3).map(function (n) {
      return { title: n.title, detail: sentences(n.extract)[0] || n.extract, link: n.link };
    });
    d.note = job.offline
      ? { text: 'Clavis ka AI brain abhi connect nahi hai, isliye ye basic research hai. AI key connect karte hi poora deep dive — examples, steps aur visuals ke saath — milega.', action: 'Connect AI key', act: 'key' }
      : { text: 'AI se poora jawab nahi aa paya' + (job.error && job.error.message ? ' (' + clip(job.error.message, 80) + ')' : '') + '. Jo mila wo dikha raha hoon.', action: 'Try again', act: 'retry' };
    return d;
  }

  /* ── Deep dive: rendering ────────────────────────────────────── */
  function section(title, iconName, inner) {
    return '<section class="lx-sec"><h3 class="lx-sec-h">' + icon(iconName, 13) + esc(title) + '</h3>' + inner + '</section>';
  }
  function pointsHTML(points) {
    return '<ol class="lx-points">' + points.map(function (p) {
      return '<li>' + (p.title ? '<b>' + inline(p.title) + '</b>' : '') + (p.detail ? '<p>' + inline(p.detail) + '</p>' : '') + '</li>';
    }).join('') + '</ol>';
  }
  function examplesHTML(list, kind) {
    return '<div class="lx-examples">' + list.map(function (x, i) {
      var tag = kind === 'simplify' ? 'Analogy' : 'Example ' + (i + 1);
      return '<article class="lx-ex"><span class="lx-ex-tag">' + esc(tag) + '</span>' +
        (x.title ? '<h4>' + inline(x.title) + '</h4>' : '') +
        '<dl>' +
        (x.situation ? '<div><dt>' + icon('mapPin', 13) + '</dt><dd>' + inline(x.situation) + '</dd></div>' : '') +
        (x.action ? '<div><dt>' + icon('arrowRight', 13) + '</dt><dd>' + inline(x.action) + '</dd></div>' : '') +
        (x.result ? '<div><dt class="is-result">' + icon('check', 13, 2.2) + '</dt><dd class="is-result">' + inline(x.result) + '</dd></div>' : '') +
        '</dl></article>';
    }).join('') + '</div>';
  }
  function stepsHTML(steps) {
    return '<ol class="lx-timeline">' + steps.map(function (s) {
      return '<li><button type="button" class="lx-check" data-lx-act="check" aria-label="Mark done">' + icon('check', 12, 2.5) + '</button>' +
        '<div class="lx-step-head"><span class="lx-step-title">' + inline(s.title) + '</span>' + (s.when ? '<span class="lx-when">' + esc(s.when) + '</span>' : '') + '</div>' +
        (s.detail ? '<p class="lx-step-detail">' + inline(s.detail) + '</p>' : '') + '</li>';
    }).join('') + '</ol>';
  }
  function tableHTML(t) {
    return '<div class="lx-table-wrap"><table class="lx-table"><thead><tr>' + t.columns.map(function (c) { return '<th>' + esc(c) + '</th>'; }).join('') +
      '</tr></thead><tbody>' + t.rows.map(function (r) { return '<tr>' + r.map(function (c) { return '<td>' + inline(c) + '</td>'; }).join('') + '</tr>'; }).join('') +
      '</tbody></table></div>';
  }
  function followHTML(list) {
    if (!list.length) return '';
    return '<div class="cts-next lx-next"><span class="cts-next-label">Go further</span>' + list.map(function (f) {
      return '<button type="button" class="cts-next-btn" data-lx-follow="1" data-lx-ask="' + esc(f) + '">' + esc(f) + '</button>';
    }).join('') + '</div>';
  }

  function renderDeep(el, body, job, expectMedia) {
    var d = job.data;
    var h = [barHTML()];
    h.push('<p class="cts-kicker lx-dd-kicker">' + icon(ROW_ICON[job.kind] || 'bookOpen', 13) + esc(job.label) + '</p>');
    h.push('<h2 class="cts-title lx-dd-title">' + inline(d.title || KIND_LABEL[job.kind] || job.label) + '</h2>');
    if (d.tldr) h.push('<p class="lx-dd-tldr">' + inline(d.tldr) + '</p>');
    if (expectMedia) {
      h.push('<div class="lx-media" data-count="4" data-pending="1">' +
        '<span class="lx-shot is-hero" aria-hidden="true"></span><span class="lx-shot" aria-hidden="true"></span>' +
        '<span class="lx-shot" aria-hidden="true"></span><span class="lx-shot" aria-hidden="true"></span></div>');
    }
    if (d.draft) h.push('<div class="lx-draft">' + esc(d.draft) + '</div>');
    if (d.table) h.push(tableHTML(d.table));
    if (d.points.length) {
      var ptitle = { summary: 'In three points', rewrite: 'What changed', visual: 'What to notice', table: 'Insights', simplify: 'In plain words' }[job.kind] || 'Key ideas';
      h.push(section(ptitle, job.kind === 'summary' ? 'list' : 'sparkles', pointsHTML(d.points)));
    }
    if (d.examples.length) h.push(section(job.kind === 'simplify' ? 'Think of it like this' : 'Examples', 'lightbulb', examplesHTML(d.examples, job.kind)));
    if (d.steps.length) h.push(section(job.kind === 'working' ? 'The working' : 'Your next steps', job.kind === 'working' ? 'calculator' : 'listChecks', stepsHTML(d.steps)));
    if (d.pitfalls.length) h.push(section('Watch out', 'alert', '<ul class="lx-pitfalls">' + d.pitfalls.map(function (p) { return '<li>' + icon('alert', 14) + '<span>' + inline(p) + '</span></li>'; }).join('') + '</ul>'));
    if (d.background && d.background.length) {
      h.push(section('Background', 'globe', '<ol class="lx-points">' + d.background.map(function (b) {
        return '<li><b>' + esc(b.title) + '</b><p>' + inline(clip(b.detail, 260)) + '</p></li>';
      }).join('') + '</ol>'));
    }
    if (d.takeaway) h.push('<blockquote class="lx-take">' + icon('quote', 16) + inline(d.takeaway) + '</blockquote>');
    if (d.note) {
      h.push('<div class="lx-note">' + icon(d.note.act === 'key' ? 'key' : 'refresh', 15) + '<div>' + esc(d.note.text) +
        '<br><button type="button" data-lx-act="' + (d.note.act === 'key' ? 'key' : 'retry') + '">' + esc(d.note.action) + '</button></div></div>');
    }
    h.push('<div class="lx-refs" hidden></div>');
    h.push(followHTML(d.followups || []));

    session.restoring = true;
    morphHeight(el, function () {
      body.innerHTML = '<div class="lx-dd" data-kind="' + job.kind + '" data-state="ready">' + h.join('') + '</div>';
      body.scrollTop = 0;
    });
    session.restoring = false;
    setHeadLabel(el, KIND_LABEL[job.kind] || 'Deep dive');
    Array.prototype.forEach.call(body.querySelectorAll('.cts-next-btn'), decorateRow);
    snapshotSession(el, body);
  }

  function fillMedia(el, body, job, imgs) {
    var media = body.querySelector('.lx-media[data-pending]');
    var refs = body.querySelector('.lx-refs');
    var links = [];
    (job.notes || []).forEach(function (n) { if (n.link) links.push({ title: n.title, link: n.link, source: 'Wikipedia' }); });

    if (!media) { paintRefs(refs, links); return; }
    if (!imgs.length) {
      morphHeight(el, function () { media.remove(); });
      paintRefs(refs, links);
      return;
    }
    var shown = imgs.slice(0, 7);
    media.removeAttribute('data-pending');
    media.setAttribute('data-gallery', '');
    media.innerHTML = shown.map(function (im, i) {
      var extra = i >= 4;
      var more = (i === 3 && shown.length > 4) ? '<span class="lx-shot-more">+' + (shown.length - 4) + '</span>' : '';
      return '<button type="button" class="lx-shot' + (extra ? ' is-extra' : '') + '" data-full="' + esc(im.full || im.thumb) + '" data-title="' + esc(im.title) +
        '" data-credit="' + esc(im.credit || im.source || '') + '" data-link="' + esc(im.link || '') + '" aria-label="' + esc('Open image: ' + im.title) + '"' + (extra ? ' hidden' : '') + '>' +
        '<img src="' + esc(im.thumb) + '" alt="' + esc(im.title) + '" loading="eager" decoding="async" referrerpolicy="no-referrer">' +
        '<span class="lx-shot-zoom">' + icon('zoomIn', 14) + '</span>' + more + '</button>';
    }).join('');
    layoutMedia(media);
    var cap = doc.createElement('p');
    cap.className = 'lx-media-cap';
    cap.innerHTML = icon('images', 12) + '<span></span>';
    cap.querySelector('span').textContent = shown[0].title + ' · ' + (shown[0].credit || shown[0].source || '');
    media.insertAdjacentElement('afterend', cap);
    wireImages(media, function () { layoutMedia(media); });
    shown.forEach(function (im) { if (im.link) links.push({ title: im.title, link: im.link, source: im.source }); });
    paintRefs(refs, links);
    morphHeight(el, function () {});
    snapshotSession(el, body);
  }

  function layoutMedia(media) {
    var shots = Array.prototype.filter.call(media.querySelectorAll('.lx-shot'), function (s) { return !s.classList.contains('is-broken'); });
    var n = shots.length;
    if (!n) {
      var cap = media.nextElementSibling;
      if (cap && cap.classList.contains('lx-media-cap')) cap.remove();
      media.remove();
      return;
    }
    var visible = shots.slice(0, 4);
    shots.forEach(function (s, i) {
      s.classList.toggle('is-extra', i >= 4);
      s.hidden = i >= 4;
      s.classList.toggle('is-hero', i === 0 && n !== 2);
      var m = s.querySelector('.lx-shot-more');
      if (m) m.remove();
    });
    if (n > 4) visible[3].insertAdjacentHTML('beforeend', '<span class="lx-shot-more">+' + (n - 4) + '</span>');
    media.setAttribute('data-count', String(Math.min(n, 4)));
  }

  function wireImages(container, onSettle) {
    var imgs = container.querySelectorAll('.lx-shot img');
    var pending = imgs.length;
    function settle() { if (--pending <= 0 && onSettle) onSettle(); }
    Array.prototype.forEach.call(imgs, function (img) {
      var shot = img.closest('.lx-shot');
      function ok() { shot.classList.add('is-loaded'); settle(); }
      function bad() { shot.classList.add('is-broken'); settle(); }
      if (img.complete && img.naturalWidth) ok();
      else if (img.complete) bad();
      else {
        img.addEventListener('load', ok, { once: true });
        img.addEventListener('error', bad, { once: true });
      }
    });
  }

  function paintRefs(refs, links) {
    if (!refs) return;
    var seen = {}, out = [];
    links.forEach(function (l) {
      var t = String(l.title || '').toLowerCase();
      if (!l.link || seen[l.link] || seen[t]) return;
      seen[l.link] = 1;
      seen[t] = 1;
      out.push(l);
    });
    out = out.slice(0, 4);
    if (!out.length) return;
    refs.innerHTML = out.map(function (l) {
      return '<a class="lx-ref" href="' + esc(l.link) + '" target="_blank" rel="noopener noreferrer">' + icon(l.source === 'Wikipedia' ? 'globe' : 'images', 12) +
        '<span>' + esc(clip(l.title, 38)) + '</span></a>';
    }).join('');
    refs.hidden = false;
  }

  /* ── Deep dive: actions ──────────────────────────────────────── */
  function onAct(el, body, btn) {
    var act = btn.getAttribute('data-lx-act');
    if (act === 'back') return goBack(el, body);
    if (act === 'pics-more') return morePictures(el, body, btn);
    if (act === 'check') {
      var li = btn.closest('li');
      if (li) li.classList.toggle('is-checked');
      return;
    }
    if (act === 'copy') return copyDeep(btn);
    if (act === 'chat') return sendDeepToChat(btn);
    if (act === 'key') {
      try { (global.openClavisCredentialDialog || global.openKeySettings)(); } catch (e) {}
      return;
    }
    if (act === 'retry' && session && session.job) {
      var job = session.job;
      var fresh = { id: ++jobSeq, kind: job.kind, label: job.label, ask: job.ask, ctx: job.ctx, data: null,
        ctrl: (typeof AbortController === 'function') ? new AbortController() : { signal: undefined, abort: function () {} } };
      session.job = fresh;
      session.restoring = true;
      morphHeight(el, function () { body.innerHTML = loadingHTML(fresh); body.scrollTop = 0; });
      session.restoring = false;
      setHeadLabel(el, 'Researching');
      runJob(el, body, fresh);
    }
  }

  function goBack(el, body) {
    if (!session || !session.stack.length) return;
    if (session.job && session.job.ctrl) { try { session.job.ctrl.abort(); } catch (e) {} }
    var prev = session.stack.pop();
    if (prev.type === 'answer') {
      var s = session;
      endSession(el);
      morphHeight(el, function () { body.innerHTML = prev.html; });
      body.scrollTop = prev.scroll || 0;
      void s;
      return;
    }
    session.job = prev.job;
    session.restoring = true;
    morphHeight(el, function () { body.innerHTML = prev.html; });
    session.restoring = false;
    session.viewHtml = prev.html;
    body.scrollTop = prev.scroll || 0;
    Array.prototype.forEach.call(body.querySelectorAll('.cts-next-btn.is-picked, .cts-next-btn.is-dimmed'), function (b) {
      b.classList.remove('is-picked', 'is-dimmed');
    });
    setHeadLabel(el, KIND_LABEL[prev.job && prev.job.kind] || 'Deep dive');
  }

  function deepPlainText() {
    var job = session && session.job;
    var d = job && job.data;
    if (!d) return '';
    var out = [];
    out.push(d.title || job.label);
    if (d.tldr) out.push(d.tldr);
    if (d.draft) out.push(d.draft);
    if (d.table) {
      out.push(d.table.columns.join(' | '));
      d.table.rows.forEach(function (r) { out.push(r.join(' | ')); });
    }
    d.points.forEach(function (p, i) { out.push((i + 1) + '. ' + (p.title ? p.title + ' — ' : '') + p.detail); });
    d.examples.forEach(function (x, i) {
      out.push('Example ' + (i + 1) + (x.title ? ': ' + x.title : ''));
      if (x.situation) out.push('  • ' + x.situation);
      if (x.action) out.push('  → ' + x.action);
      if (x.result) out.push('  ✓ ' + x.result);
    });
    d.steps.forEach(function (s, i) { out.push((i + 1) + '. ' + s.title + (s.when ? ' (' + s.when + ')' : '') + (s.detail ? ' — ' + s.detail : '')); });
    d.pitfalls.forEach(function (p) { out.push('! ' + p); });
    if (d.takeaway) out.push('“' + d.takeaway + '”');
    return out.join('\n');
  }
  function copyDeep(btn) {
    var text = deepPlainText();
    if (!text) return;
    var done = function () {
      btn.classList.add('is-done');
      var old = btn.innerHTML;
      btn.innerHTML = icon('check', 15, 2.2);
      setTimeout(function () { btn.classList.remove('is-done'); btn.innerHTML = old; }, 1400);
    };
    try {
      navigator.clipboard.writeText(text).then(done, function () { legacyCopy(text); done(); });
    } catch (e) { legacyCopy(text); done(); }
  }
  function legacyCopy(text) {
    var ta = doc.createElement('textarea');
    ta.value = text;
    ta.style.cssText = 'position:fixed;opacity:0;pointer-events:none';
    doc.body.appendChild(ta);
    ta.select();
    try { doc.execCommand('copy'); } catch (e) {}
    ta.remove();
  }
  function sendDeepToChat(btn) {
    var job = session && session.job;
    var d = job && job.data;
    if (!d || typeof global.appendJarvisBubble !== 'function') { toast('info', 'Chat not ready', 'Open Clavis AI once, then try again.'); return; }
    var html = '<p><strong>' + inline(d.title || job.label) + '</strong></p>' + (d.tldr ? '<p>' + inline(d.tldr) + '</p>' : '');
    if (d.draft) html += '<p>' + esc(d.draft).replace(/\n/g, '<br>') + '</p>';
    if (d.points.length) html += '<ul>' + d.points.map(function (p) { return '<li>' + (p.title ? '<b>' + inline(p.title) + '</b> — ' : '') + inline(p.detail) + '</li>'; }).join('') + '</ul>';
    if (d.examples.length) html += '<ul>' + d.examples.map(function (x) { return '<li><b>' + inline(x.title || 'Example') + '</b> — ' + inline([x.situation, x.action, x.result].filter(Boolean).join(' → ')) + '</li>'; }).join('') + '</ul>';
    if (d.steps.length) html += '<ol>' + d.steps.map(function (s) { return '<li><b>' + inline(s.title) + '</b>' + (s.when ? ' · ' + esc(s.when) : '') + (s.detail ? ' — ' + inline(s.detail) : '') + '</li>'; }).join('') + '</ol>';
    if (d.takeaway) html += '<p><em>' + inline(d.takeaway) + '</em></p>';
    var shots = doc.querySelectorAll('#clavis-task-surface .lx-media .lx-shot.is-loaded');
    if (shots.length) {
      html += '<div class="lx-inline-media" data-gallery data-count="' + Math.min(shots.length, 4) + '">' + Array.prototype.slice.call(shots, 0, 4).map(function (s) {
        var img = s.querySelector('img');
        return '<button type="button" class="lx-shot is-loaded" data-full="' + esc(s.dataset.full) + '" data-title="' + esc(s.dataset.title) + '" data-credit="' + esc(s.dataset.credit) +
          '" data-link="' + esc(s.dataset.link) + '"><img src="' + esc(img.getAttribute('src')) + '" alt="' + esc(s.dataset.title) + '" referrerpolicy="no-referrer"></button>';
      }).join('') + '</div>';
    }
    try {
      global.appendJarvisBubble('assistant', html);
      try { global.updateJarvisChatStage && global.updateJarvisChatStage(true); } catch (e) {}
      btn.classList.add('is-done');
      setTimeout(function () { btn.classList.remove('is-done'); }, 1400);
      var hidden = root.classList.contains('clavis-stage-v2') && !root.classList.contains('clavis-transcript-on');
      toast('success', 'Added to chat', hidden ? 'Saved in the transcript — open it from More → Transcript.' : 'The deep dive is now part of this conversation.');
    } catch (e) { console.warn('[ClavisLuxe] add to chat', e); }
  }

  /* ============================================================
   * 5 · RESEARCH — the brain and the open image sources
   * ============================================================ */
  var Research = (function () {
    var cache = new Map();

    function hasBrain() {
      try {
        if (global.ClavisDirect && global.ClavisDirect.hasKey && global.ClavisDirect.hasKey()) return true;
        return !!(global.NexusAIChat && global.NexusAIChat.complete && global.SupabaseAuth && global.SupabaseAuth.getAccessToken && global.SupabaseAuth.getAccessToken());
      } catch (e) { return false; }
    }

    function llm(messages, signal, opts) {
      opts = opts || {};
      var temp = opts.temperature != null ? opts.temperature : 0.45, maxT = opts.max_tokens || 1500;
      var D = global.ClavisDirect;
      if (D && D.hasKey && D.hasKey()) {
        return D.complete({ messages: messages, temperature: temp, max_tokens: maxT }, signal).then(function (data) {
          return (data && data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content) || '';
        });
      }
      var N = global.NexusAIChat;
      if (N && N.complete) {
        var free = (global.SKYLARK_CONFIG && (global.SKYLARK_CONFIG.CLAVIS_FREE_MODELS || global.SKYLARK_CONFIG.JARVIS_FREE_MODELS)) || [];
        var model = 'openrouter/' + (free[0] || 'meta-llama/llama-3.3-70b-instruct:free');
        return N.complete({ model: model, messages: messages, temperature: temp, max_tokens: maxT }, signal).then(function (data) {
          return (data && data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content) || '';
        });
      }
      return Promise.reject(Object.assign(new Error('No AI key connected'), { code: 'AI_CREDENTIAL_MISSING' }));
    }

    function within(p, ms, fallback) {
      return Promise.race([p, wait(ms).then(function () { return fallback; })]).catch(function () { return fallback; });
    }

    function getJSON(url, signal, ms) {
      if (cache.has(url)) return cache.get(url);
      var ctrl = typeof AbortController === 'function' ? new AbortController() : null;
      var timer = setTimeout(function () { if (ctrl) ctrl.abort(); }, ms || 8000);
      if (signal && ctrl) signal.addEventListener('abort', function () { ctrl.abort(); }, { once: true });
      var p = fetch(url, { signal: ctrl ? ctrl.signal : undefined, credentials: 'omit', referrerPolicy: 'no-referrer' })
        .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
        .finally(function () { clearTimeout(timer); });
      cache.set(url, p);
      p.catch(function () { cache.delete(url); });
      return p;
    }

    /* Judged on the file name only — every URL here contains
       "wikimedia", so matching the whole URL rejected everything. */
    var JUNK = /(^|[_\-\s:])(logo|icon|flag|coat[_ ]of[_ ]arms|symbol|signature|seal|question[_ ]book|ambox|edit-clear|padlock|disambig|location[_ ]map|blank[_ ]map|wiki[_ ]letter|tortoise|turtle|map|diagram|chart|template|placeholder|stub|default|missing|unknown)([_\-.\s]|$)|\.svg(\.png)?$/i;
    function fileName(url) { try { return decodeURIComponent(String(url || '').split('?')[0].split('/').pop()); } catch (e) { return String(url || ''); } }
    function bump(url, from, to, origW) {
      if (!url) return url;
      if (origW && origW <= to) return null;
      return url.replace('/' + from + 'px-', '/' + to + 'px-');
    }

    function wiki(query, signal, limit) {
      var url = 'https://en.wikipedia.org/w/api.php?action=query&format=json&origin=*&redirects=1' +
        '&generator=search&gsrnamespace=0&gsrlimit=' + (limit || 4) + '&gsrsearch=' + encodeURIComponent(query) +
        '&prop=pageimages%7Cextracts%7Cinfo&piprop=thumbnail%7Coriginal&pithumbsize=960&pilicense=any' +
        '&exintro=1&explaintext=1&exsentences=2&inprop=url';
      /* a note only counts if its page is about the words asked for */
      var qWords = query.toLowerCase().replace(/[^a-z0-9\s]/gi, ' ').split(/\s+/).filter(function (w) { return w.length > 2; });
      function isRelevant(pageTitle) {
        if (!qWords.length) return true;
        var tl = String(pageTitle || '').toLowerCase();
        var hits = qWords.filter(function (w) { return tl.indexOf(w) >= 0; }).length;
        return qWords.length >= 2 ? hits >= Math.ceil(qWords.length * 0.5) : hits > 0;
      }
      return getJSON(url, signal, 7000).then(function (j) {
        var pages = (j && j.query && j.query.pages) ? Object.keys(j.query.pages).map(function (k) { return j.query.pages[k]; }) : [];
        pages.sort(function (a, b) { return (a.index || 0) - (b.index || 0); });
        return pages.map(function (p) {
          var th = p.thumbnail && p.thumbnail.source;
          var orig = p.original || {};
          var relevant = isRelevant(p.title);
          var good = relevant && th && !JUNK.test(fileName(th).replace(/^\d+px-/, '')) && (p.thumbnail.width || 0) >= 320;
          return {
            title: p.title,
            extract: String(p.extract || '').trim(),
            link: p.fullurl || ('https://en.wikipedia.org/wiki/' + encodeURIComponent(p.title)),
            thumb: good ? th : null,
            full: good ? (bump(th, 960, 1920, orig.width) || orig.source || th) : null,
            source: 'Wikipedia',
            credit: 'Wikipedia',
            _relevant: relevant
          };
        }).filter(function (p) { return (p.extract && p._relevant) || p.thumb; });
      });
    }

    function stripTags(html) {
      var d = doc.createElement('div');
      d.innerHTML = String(html || '');
      return (d.textContent || '').replace(/\s+/g, ' ').trim();
    }

    function commons(query, signal) {
      var url = 'https://commons.wikimedia.org/w/api.php?action=query&format=json&origin=*' +
        '&generator=search&gsrnamespace=6&gsrlimit=8&gsrsearch=' + encodeURIComponent(query + ' filetype:bitmap') +
        '&prop=imageinfo&iiprop=url%7Csize%7Cmime%7Cextmetadata&iiurlwidth=960' +
        '&iiextmetadatafilter=ObjectName%7CLicenseShortName%7CArtist';
      return getJSON(url, signal, 8000).then(function (j) {
        var pages = (j && j.query && j.query.pages) ? Object.keys(j.query.pages).map(function (k) { return j.query.pages[k]; }) : [];
        pages.sort(function (a, b) { return (a.index || 0) - (b.index || 0); });
        return pages.map(function (p) {
          var ii = p.imageinfo && p.imageinfo[0];
          if (!ii || !ii.thumburl) return null;
          if (!/^image\/(jpeg|png|webp)$/.test(ii.mime || '')) return null;
          if ((ii.width || 0) < 480 || JUNK.test(String(p.title || '').replace(/^File:/, ''))) return null;
          var ratio = (ii.width || 1) / (ii.height || 1);
          if (ratio < 0.5 || ratio > 2.6) return null;
          var meta = ii.extmetadata || {};
          var name = stripTags(meta.ObjectName && meta.ObjectName.value) ||
            String(p.title || '').replace(/^File:/, '').replace(/\.[a-z0-9]+$/i, '').replace(/[_-]+/g, ' ');
          var lic = stripTags(meta.LicenseShortName && meta.LicenseShortName.value);
          return {
            title: clip(name, 80),
            thumb: ii.thumburl,
            full: bump(ii.thumburl, 960, 1920, ii.width) || ii.url,
            link: ii.descriptionurl,
            source: 'Wikimedia Commons',
            credit: 'Wikimedia Commons' + (lic ? ' · ' + lic : '')
          };
        }).filter(Boolean);
      });
    }

    function images(queries, notes, fallbackQuery, signal) {
      var qs = (queries || []).slice(0, 3);
      if (!qs.length && fallbackQuery) qs = [fallbackQuery];
      return Promise.all(qs.map(function (q) {
        return Promise.all([
          commons(q, signal).catch(function () { return []; }),
          wiki(q, signal, 3).catch(function () { return []; })
        ]).then(function (res) {
          var c = res[0].slice(0, 3);
          var w = res[1].filter(function (x) { return x.thumb; }).slice(0, 2);
          var out = [];
          for (var i = 0; i < Math.max(c.length, w.length); i++) {
            if (w[i]) out.push(w[i]);
            if (c[i]) out.push(c[i]);
          }
          return out;
        });
      })).then(function (lists) {
        var merged = [], seen = {};
        for (var round = 0; round < 6; round++) {
          lists.forEach(function (l) {
            var x = l[round];
            if (!x) return;
            var key = String(x.thumb).split('/').pop().replace(/^\d+px-/, '');
            if (seen[key]) return;
            seen[key] = 1;
            merged.push(x);
          });
        }
        (notes || []).forEach(function (n) {
          if (merged.length >= 6 || !n.thumb) return;
          var key = String(n.thumb).split('/').pop().replace(/^\d+px-/, '');
          if (seen[key]) return;
          seen[key] = 1;
          merged.push(n);
        });
        return merged.slice(0, 7);
      });
    }

    return { hasBrain: hasBrain, llm: llm, wiki: wiki, commons: commons, images: images, within: within, getJSON: getJSON, stripTags: stripTags };
  })();

  /* ============================================================
   * 5b · PICTURES — "photos dikhao" shows the right photos
   * ------------------------------------------------------------
   * Asked for pictures, the model said it can't pull up images, and
   * the deep dive searched loose keywords, so "Neemaroli Baba" came
   * back with a tortoise. Pictures now start from WHO or WHAT is
   * meant: the name is corrected (the model when a key is connected,
   * Wikipedia's search either way), then taken from the most trusted
   * sources first — the article's own image, the subject's Commons
   * category (linked from Wikidata), the files the article uses —
   * and only then from open search (Commons, Openverse), where every
   * result must actually name the subject. No picture beats a wrong one.
   * ============================================================ */
  var Pictures = (function () {
    /* voice-typing misspells the picture word too (foto, photu, phtos) */
    var IMG = '(?:images?|imgs?|imges|photos?|photoz|fotos?|photu|phota|phtos?|phots|photographs?|pictures?|pics?|picz|snaps?|wallpapers?|tasveer(?:en|ein|e|ain)?|tasvir(?:en|ein|e)?|tasweer(?:en|ein|e)?|फ़?ोटो|फोटोज़?|तस्वीर(?:ें|े)?|चित्र)';
    var IMG_RE = new RegExp('(^|[^a-z])' + IMG + '($|[^a-z])', 'i');
    var MAKE_RE = /\b(generate|create|draw|paint|design|make|edit|upscale|convert|compress|crop|resize|remove background|banao|bana\s*(?:do|de|dijiye|na|ke)|banaiye|screenshot|screen\s*shot|analy[sz]e|describe|ocr|upload|attach|send|bhejo|save|download karo)\b/i;
    var OWN_RE = /^(my|mine|meri|mera|mere|apni|apna|apne|our|hamari|hamare|this|that|these|those|ye|yeh|is|us|iski|uski|inki|unki|mujhe|me|main|मेरी|मेरा|मेरे|अपनी|इसकी|उसकी)$/i;
    var ERA_DECADE = /\b(19\d{2}s?|20[0-2]\d\s*s?|[4-9]0'?s|\d{2}'s)\b|(?:\b[4-9]0\s*(?:ke\s*dashak|ka\s*daur)\b)/i;
    var ERA_OLD = /\b(old|older|oldest|vintage|historic(?:al)?|history|rare|archive|archival|purani|puraani|purane|puraane|black\s*(?:and|&|n)\s*white|b\s*&\s*w|bachpan|jawani|young|retros?)\b|पुरान|पुराना|पुरानी/i;
    var ERA_NEW = /\b(latest|recent|new|nayi|naye|current|aaj\s*kal|abhi\s*ki)\b|नई|नये|ताज़ा/i;
    var LEAD = /^(?:(?:hey|hi|hello|ok|okay|clavis|jarvis|please|pls|plz|kindly|zara|jara|mujhe|mujhko|humein|hume|hamein|can you|could you|will you|would you|i want to see|i wanna see|let me see|dekhna hai|dekhni hai)[\s,!.:]+)+/i;
    var EDGE_HEAD = /^(?:please|pls|plz|kindly|zara|mujhe|mujhko|humein|hume|kuch|koi|some|few|a few|a|an|the|all|any|more|of|for|about|from|me|ki|ke|ka|kii|bhi|to|toh|best|good|nice|real|original|asli|hd|high quality|achi|acchi|sundar|कुछ|मुझे|कोई)\s+/i;
    var EDGE_TAIL = /\s+(?:please|pls|plz|ji|jee|sahab|saheb|sahib|sir|madam|ki|ke|ka|kii|ko|bhi|na|yaar|bhai|dikhao|dikhaiye|dikha(?:\s*do|\s*dijiye|\s*na)?|dekhao|dihao|dikao|dikhau|dikhaao|dehao|dhikao|dikhaye|dikhayiye|dekhaao|dikhado|do|dedo|de\s*do|bhejo|chahiye|chahie|chaiye|nikalo|nikal\s*do|dhundo|dhoondo|dhundho|search\s*karo|karo|kar\s*do|lao|laao|layo|milegi|milenge|hai|hain|online|internet\s*se|google\s*se|now|abhi|jaldi|zara|जी|की|के|का|को|भी|दिखाओ|दिखा\s*दो|दिखाइए|दिखाइये|भेजो|चाहिए|प्लीज़?)$/i;
    var AFTER = '(?=[\\s?.!,।]|$)';
    function tidy(raw) {
      var s = ' ' + String(raw || '') + ' ';
      var decadeMatch = s.match(ERA_DECADE);
      var decade = decadeMatch ? decadeMatch[0].trim() : '';
      var old = ERA_OLD.test(s) || Boolean(decade);
      var recent = !old && ERA_NEW.test(s);
      s = s.replace(new RegExp('(^|\\s)' + IMG + '(?=\\s|$)', 'gi'), ' ')
        .replace(ERA_DECADE, ' ')
        .replace(/\b(old|older|oldest|vintage|historic(?:al)?|rare|archive|archival|purani|puraani|purane|puraane|latest|recent|new|nayi|naye|current|black\s*(?:and|&|n)\s*white|b\s*&\s*w|hd|4k|retros?)\b/gi, ' ')
        .replace(/[“”"'`?!.,;:]+/g, ' ').replace(/\s+/g, ' ').trim();
      for (var i = 0; i < 6; i++) {
        var t = s.replace(EDGE_HEAD, '').replace(EDGE_TAIL, '').trim();
        if (t === s) break;
        s = t;
      }
      return { subject: s, old: old, recent: recent, decade: decade };
    }

    function isPhotoContext() {
      var T = global.ClavisTask;
      var cur = T && T.current && T.current();
      if (cur && (PicTasks.has(cur.id) || cur.intent === 'media' || (cur.result && cur.result.type === 'images') || /photos?/i.test(cur.title || '') || /photos?/i.test(cur.subtitle || ''))) return true;
      return false;
    }

    /* A plain picture request → { subject, old, recent }, else null. */
    /* noContext: judge the words alone (titles, chips), not whether a
       photo task happens to be on screen */
    function detect(text, noContext) {
      var t = String(text || '').replace(/\s+/g, ' ').trim();
      if (!t || t.length > 180 || MAKE_RE.test(t)) return null;
      var hasImg = IMG_RE.test(t);
      var hasEra = ERA_DECADE.test(t);
      var inPhoto = noContext ? false : isPhotoContext();
      if (!hasImg && !hasEra && !inPhoto) return null;

      var body = t.replace(LEAD, '');
      var patterns = [
        new RegExp('^(?:show|display|find|get|fetch|search|pull up|bring up|give|send)\\b(?:\\s+me)?(?:\\s+\\S+){0,4}?\\s+' + IMG + '\\s+(?:of|for|about|from|showing)\\s+(.+)$', 'i'),
        new RegExp('^(?:(?:some|a few|few|the|old|older|vintage|rare|latest|recent|hd|real)\\s+)*' + IMG + '\\s+(?:of|for|about|from)\\s+(.+)$', 'i'),
        new RegExp('^' + IMG + '\\s+(?:dikhao|dikhaiye|dikha do|bhejo|chahiye|दिखाओ|भेजो)\\s+(.+)$', 'i'),
        new RegExp('^(.+?)\\s+(?:ki|ke|ka|kii|की|के|का)\\s+((?:\\S+\\s+)*?)' + IMG + AFTER + '(.*)$', 'i'),
        new RegExp('^(.+?)\\s+' + IMG + AFTER + '(.*)$', 'i')
      ];
      for (var i = 0; i < patterns.length; i++) {
        var m = body.match(patterns[i]);
        if (!m) continue;
        var tail = i >= 3 ? (m[m.length - 1] || '') : '';
        /* "X photos ke baare me kya sochte ho" is a question, not a request */
        if (tail && tidy('x ' + tail).subject.toLowerCase() !== 'x') continue;
        var picked = tidy(i === 3 ? m[1] + ' ' + (m[2] || '') : m[1]);
        var words = picked.subject.split(' ').filter(Boolean);
        if (!picked.subject || picked.subject.length < 2 || words.length > 9 || OWN_RE.test(words[0]) && words.length <= 2) return null;
        picked.era = picked.decade || (ERA_OLD.test(t) ? 'old' : (ERA_NEW.test(t) ? 'recent' : ''));
        return picked;
      }
      /* Follow-up or era-driven request without explicit "photo" keyword (e.g., "sunjay dutt 90s").
         With a photo task on screen, only a short NAME counts ("Krishna", "aur Ganesh ji", "90s
         wali") — a whole sentence ("I'm going to go to the next video" from a video playing in
         the room) used to become a photo search for "Next Video". */
      if (inPhoto && !hasEra && (t.split(' ').length > 4 || /\b(i|i'm|im|you|we|they|he|she|it|is|are|was|were|will|would|can|could|going|go|gonna|let's|lets|next|video|videos|song|music|play|watch|this|that|what|why|how|kya|kyun|kaise|hai|hain|tha|thi|karo|karna|kar|mera|meri|mujhe|tum|aap)\b/i.test(t))) return null;
      if (inPhoto || hasEra) {
        var directPicked = tidy(body);
        var dirWords = directPicked.subject.split(' ').filter(Boolean);
        if (directPicked.subject && directPicked.subject.length >= 2 && dirWords.length <= 9 && !(OWN_RE.test(dirWords[0]) && dirWords.length <= 2)) {
          directPicked.era = directPicked.decade || (ERA_OLD.test(t) ? 'old' : (ERA_NEW.test(t) ? 'recent' : ''));
          return directPicked;
        }
      }
      return null;
    }

    /* ── name matching ──────────────────────────────────────────── */
    function squash(s) {
      return String(s || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9ऀ-ॿ]+/g, '');
    }
    function phoneticSquash(s) {
      return squash(s)
        .replace(/ph/g, 'f')
        .replace(/sh/g, 's')
        .replace(/kh/g, 'k')
        .replace(/gh/g, 'g')
        .replace(/dh/g, 'd')
        .replace(/th/g, 't')
        .replace(/bh/g, 'b')
        .replace(/ch/g, 'c')
        .replace(/ee+/g, 'i')
        .replace(/oo+/g, 'u')
        .replace(/ou/g, 'u')
        .replace(/[aeiouy]+/g, 'a')
        .replace(/w/g, 'v')
        .replace(/z/g, 'j');
    }
    function lev(a, b) {
      if (Math.abs(a.length - b.length) > 8) return 99;
      var prev = [], cur, i, j;
      for (j = 0; j <= b.length; j++) prev[j] = j;
      for (i = 1; i <= a.length; i++) {
        cur = [i];
        for (j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
        prev = cur;
      }
      return prev[b.length];
    }
    function likeness(a, b) {
      var sa = squash(a), sb = squash(String(b || '').replace(/\s*\(.*?\)\s*/g, ' '));
      if (!sa || !sb) return 0;
      if (sa === sb) return 1;
      var pa = phoneticSquash(a), pb = phoneticSquash(b);
      if (pa === pb) return 0.96;
      var n = Math.max(sa.length, sb.length);
      var sub = (sa.indexOf(sb) >= 0 || sb.indexOf(sa) >= 0) ? Math.min(sa.length, sb.length) / n + 0.15 : 0;
      var directScore = Math.max(sub, 1 - lev(sa, sb) / n);
      var np = Math.max(pa.length, pb.length);
      var phonScore = 1 - lev(pa, pb) / np;
      return Math.max(directScore, phonScore * 0.92);
    }
    /* words that don't tell one subject from another — honorifics,
       common surnames ("Singh", "Khan"), kinds of place */
    var GENERIC = /^(the|and|of|in|on|at|ji|sri|shri|shree|sant|saint|baba|maharaj|swami|guru|mata|devi|king|queen|mr|mrs|dr|city|temple|mandir|fort|palace|river|lake|mount|old|new|singh|kumar|kumari|sharma|verma|gupta|khan|prasad)$/i;
    function tokensOf(name) {
      var all = String(name || '').toLowerCase().replace(/\(.*?\)/g, ' ').split(/[^a-z0-9ऀ-ॿ]+/).filter(function (w) { return w.length >= 3; });
      var strong = all.filter(function (w) { return !GENERIC.test(w); });
      return strong.length ? strong : all;
    }
    /* Is this picture about the subject? A name's words must appear in
       what the file says about itself. One short word is not enough
       for a two-word name — "Neem Karoli Baba" is not the neem tree,
       "Taj Mahal" is not Mumtaz Mahal (a word of 6+ letters, like
       "karoli", is distinctive enough alone). A token ending in "$" must be
       a whole word ("shiva$" is not "Shivaji"), and an alias list
       (tokens.any — a deity's many names) needs just one of them. */
    function mentions(text, tokens) {
      if (!tokens || !tokens.length) return true;
      var raw = String(text || '');
      var hay = ' ' + raw.toLowerCase().replace(/[_\-]+/g, ' ') + ' ';
      var words = null;
      var long = false;
      var hits = tokens.filter(function (w) {
        var ok;
        if (w.charAt(w.length - 1) === '$') {
          if (words === null) words = ' ' + raw.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase().replace(/[^a-z0-9ऀ-ॿ]+/g, ' ') + ' ';
          ok = words.indexOf(' ' + w.slice(0, -1) + ' ') >= 0;
        } else {
          ok = hay.indexOf(w) >= 0;
        }
        if (ok && w.replace(/\$$/, '').length >= 6) long = true;
        return ok;
      }).length;
      if (!hits) return false;
      if (tokens.any || tokens.length < 2) return true;
      return hits >= 2 || long;
    }

    /* ── sources ────────────────────────────────────────────────── */
    function q(host, params) {
      var p = Object.assign({ action: 'query', format: 'json', origin: '*' }, params);
      return 'https://' + host + '/w/api.php?' + Object.keys(p).map(function (k) { return encodeURIComponent(k) + '=' + encodeURIComponent(p[k]); }).join('&');
    }
    function pagesOf(j) {
      var pages = j && j.query && j.query.pages;
      if (!pages) return [];
      return Object.keys(pages).map(function (k) { return pages[k]; }).sort(function (a, b) { return (a.index || 0) - (b.index || 0); });
    }

    function searchTitles(text, signal) {
      return Research.getJSON(q('en.wikipedia.org', { list: 'search', srsearch: text, srlimit: 8, srinfo: 'suggestion', srprop: '' }), signal, 6000)
        .then(function (j) {
          return {
            titles: ((j.query && j.query.search) || []).map(function (h) { return h.title; }),
            suggestion: j.query && j.query.searchinfo && j.query.searchinfo.suggestion
          };
        }).catch(function () { return { titles: [], suggestion: null }; });
    }
    function bestTitle(name, titles, floor) {
      var best = null, score = floor || 0.58;
      titles.forEach(function (t, i) {
        var s = likeness(name, t) - i * 0.015;
        var tTokens = tokensOf(t), nTokens = tokensOf(name);
        var shared = nTokens.filter(function (tk) { return tTokens.some(function (tt) { return likeness(tk, tt) >= 0.75; }); }).length;
        if (shared && shared === nTokens.length) s += 0.18;
        if (s > score) { score = s; best = t; }
      });
      if (!best && titles.length && likeness(name, titles[0]) >= 0.45) {
        best = titles[0];
      }
      return best;
    }

    /* The model is good at "neemaroli baba ji" → "Neem Karoli Baba" —
       IF it is told who is asking. Given only "lord" it picked the
       British title; given the whole request and that sir is an Indian,
       Hinglish-speaking owner, "lord ki photo dikhao" means God. */
    var CULTURE =
      'The user is an Indian business owner who writes Hinglish (Hindi in Roman script mixed with English), often voice-typed with spelling mistakes. ' +
      'Read the request the way an Indian Hindi speaker means it: "lord", "bhagwan", "god", "ishwar", "prabhu", "devta" on their own mean the Hindu deities ' +
      '(kind "group"), never the British title or the English word. "shiv ji"/"mahadev"/"bholenath" = Shiva, "bajrang bali"/"hanuman ji" = Hanuman, ' +
      '"kanha"/"shri krishna" = Krishna, "ganpati"/"ganesh ji" = Ganesha, "ram ji"/"shri ram" = Rama, "mata rani"/"durga maa"/"sherawali" = Durga, ' +
      '"sai baba" = Sai Baba of Shirdi. "ji", "baba", "maharaj", "sahab" are honorifics that belong to a famous name ("neemaroli baba" = Neem Karoli Baba). ' +
      'When a name is ambiguous, prefer the Indian person, place or thing (film star, cricketer, politician, saint, city, temple).';
    var canonCache = new Map();          // one model call per request, shared by the title and the search
    function canonical(subject, signal, raw) {
      if (!Research.hasBrain()) return Promise.resolve(null);
      var ck = squash(subject) + '|' + squash(raw || '');
      if (canonCache.has(ck)) return canonCache.get(ck);
      var msgs = [
        { role: 'system', content: 'You work out WHO or WHAT a photo request is about. ' + CULTURE +
          ' Reply with ONLY minified JSON: {"title":"<exact English Wikipedia article title if one exists, else the correctly spelled name>",' +
          '"display":"<the name correctly spelled and capitalised, as a caption>","kind":"person|deity|place|thing|event|group|other",' +
          '"items":["<ONLY when kind is group: 2 to 9 exact Wikipedia titles of its best-known members>"]}' },
        { role: 'user', content: 'Request: "' + clip(raw || subject, 200) + '"\nSubject as extracted: "' + clip(subject, 120) + '"' }
      ];
      var cp = Research.within(Research.llm(msgs, signal, { temperature: 0, max_tokens: 160 }).then(function (out) {
        var m = String(out || '').match(/\{[\s\S]*\}/);
        if (!m) return null;
        try {
          var o = JSON.parse(m[0]);
          if (!o || !o.title) return null;
          var items = Array.isArray(o.items) ? o.items.map(function (x) { return String(x || '').trim().slice(0, 90); }).filter(Boolean).slice(0, 9) : [];
          return {
            title: String(o.title).slice(0, 120),
            display: String(o.display || o.title).replace(/\s*\([^)]*\)\s*$/, '').slice(0, 90),
            kind: String(o.kind || ''),
            items: String(o.kind || '') === 'group' && items.length >= 2 ? items : null
          };
        } catch (e) { return null; }
      }), 3500, null);
      canonCache.set(ck, cp);
      cp.then(function (r) { if (!r) canonCache.delete(ck); });
      return cp;
    }

    function resolve(subject, signal, raw) {
      return Promise.all([canonical(subject, signal, raw), searchTitles(subject, signal)]).then(function (r) {
        var canon = r[0], found = r[1];
        var viaSearch = bestTitle(subject, found.titles);
        /* "cricketers ki photos": several people, each labelled */
        if (canon && canon.items) return { title: canon.title, name: canon.display, display: canon.display, sure: true, group: canon.items, kind: 'group' };
        if (canon && canon.title) {
          if (likeness(canon.title, viaSearch || '') > 0.85) return { title: viaSearch || canon.title, name: canon.title, display: canon.display, sure: true, kind: canon.kind };
          return searchTitles(canon.title, signal).then(function (f2) {
            var t = bestTitle(canon.title, f2.titles, 0.65) || bestTitle(subject, f2.titles);
            return { title: t || canon.title, name: t || canon.title, display: canon.display, sure: !!t, kind: canon.kind };
          });
        }
        if (viaSearch) return { title: viaSearch, name: viaSearch, display: viaSearch.replace(/\s*\([^)]*\)\s*$/, ''), sure: true };
        if (found.suggestion) {
          return searchTitles(found.suggestion, signal).then(function (f2) {
            var t = bestTitle(found.suggestion, f2.titles, 0.6) || bestTitle(subject, f2.titles);
            return { title: t || found.suggestion, name: t || found.suggestion, sure: !!t };
          });
        }
        var fallbackTitle = found.titles[0] || subject;
        return { title: fallbackTitle, name: fallbackTitle, sure: Boolean(found.titles.length) };
      });
    }

    function article(title, signal) {
      if (!title) return Promise.resolve(null);
      return Research.getJSON(q('en.wikipedia.org', {
        redirects: 1, titles: title, prop: 'pageimages|extracts|pageprops|info|images',
        piprop: 'name|original|thumbnail', pithumbsize: 1280, pilicense: 'any', exintro: 1, explaintext: 1, exsentences: 3,
        inprop: 'url', ppprop: 'wikibase_item|disambiguation', imlimit: 80
      }), signal, 7000).then(function (j) {
        var p = pagesOf(j)[0];
        if (!p || p.missing !== undefined) return null;
        var props = p.pageprops || {};
        return {
          title: p.title,
          extract: String(p.extract || '').trim(),
          link: p.fullurl || ('https://en.wikipedia.org/wiki/' + encodeURIComponent(p.title)),
          lead: p.original || null,
          leadThumb: p.thumbnail || null,
          leadFile: p.pageimage ? 'File:' + p.pageimage : null,
          qid: props.wikibase_item || null,
          disambiguation: props.disambiguation !== undefined,
          files: (p.images || []).map(function (i) { return i.title; })
        };
      }).catch(function () { return null; });
    }

    /* Every picture an article uses — minus its illustrations of OTHER
       things (the ashram, a disciple, a map), which is how an unrelated
       face ended up under a saint's name. tokens = what must be named. */
    function wikiMediaList(title, signal, tokens) {
      if (!title) return Promise.resolve([]);
      var url = 'https://en.wikipedia.org/api/rest_v1/page/media-list/' + encodeURIComponent(String(title || '').replace(/\s+/g, '_'));
      return Research.getJSON(url, signal, 6000).then(function (j) {
        var items = (j && j.items) || [];
        return items.map(function (it) {
          if (!it || it.type !== 'image' || !it.srcset || !it.srcset.length) return null;
          var fileTitle = String(it.title || '').replace(/^File:/, '');
          if (JUNK.test(fileTitle) || /logo|icon|flag|signature|coat_of_arms/i.test(fileTitle)) return null;
          var thumb = it.srcset[0].src;
          if (thumb.indexOf('//') === 0) thumb = 'https:' + thumb;
          var full = it.srcset[it.srcset.length - 1].src;
          if (full.indexOf('//') === 0) full = 'https:' + full;
          var cap = it.caption ? (it.caption.text || Research.stripTags(it.caption.html || '')) : '';
          if (tokens && tokens.length && !mentions(fileTitle + ' ' + cap, tokens)) return null;
          var name = cap || fileTitle.replace(/\.[a-z0-9]+$/i, '').replace(/_/g, ' ');
          return {
            key: squash(fileTitle),
            title: clip(name, 90),
            thumb: thumb,
            full: full,
            w: 640, h: 480,
            link: 'https://en.wikipedia.org/wiki/' + encodeURIComponent(title),
            source: 'Wikipedia',
            credit: 'Wikipedia',
            year: yearOf(cap + ' ' + fileTitle)
          };
        }).filter(Boolean);
      }).catch(function () { return []; });
    }

    function commonsCategory(qid, signal) {
      if (!qid) return Promise.resolve(null);
      return Research.getJSON('https://www.wikidata.org/w/api.php?action=wbgetclaims&format=json&origin=*&property=P373&entity=' + encodeURIComponent(qid), signal, 5000)
        .then(function (j) {
          var c = j && j.claims && j.claims.P373 && j.claims.P373[0];
          return (c && c.mainsnak && c.mainsnak.datavalue && c.mainsnak.datavalue.value) || null;
        }).catch(function () { return null; });
    }

    var II = { prop: 'imageinfo', iiprop: 'url|size|mime|extmetadata', iiurlwidth: 960, iiextmetadatafilter: 'ObjectName|LicenseShortName|Artist|DateTimeOriginal|ImageDescription' };
    var JUNK = /(^|[_\-\s:(])(logo|icon|flag|coat[_ ]of[_ ]arms|emblem|symbol|signature|seal|stamp|question[_ ]book|ambox|commons-logo|wikiquote|wiktionary|wikisource|edit-clear|padlock|disambig|locator|location[_ ]map|blank[_ ]map|map[_ ]of|wiki[_ ]letter|increase|decrease|steady|red[_ ]pencil|audio|speaker|film[_ ]reel|folder|crystal|nuvola|pictogram|gnome|oojs|button|arrow|placeholder|no[_ ]image)([_\-.\s)]|$)|\.(svg|gif|webm|ogv|ogg|oga|mp3|pdf|djvu|stl)(\.\w+)?$/i;
    function yearOf(text) {
      var m = String(text || '').match(/\b(1[89]\d{2}|20[0-4]\d)\b/);
      return m ? +m[1] : null;
    }
    function fromPage(p, trusted, tokens) {
      var ii = p.imageinfo && p.imageinfo[0];
      if (!ii || !ii.thumburl) return null;
      var file = String(p.title || '').replace(/^File:/, '');
      if (JUNK.test(file) || !/^image\/(jpeg|png|webp|tiff)$/.test(ii.mime || '')) return null;
      if ((ii.width || 0) < 180 || (ii.height || 0) < 160) return null;
      var ratio = (ii.width || 1) / (ii.height || 1);
      if (ratio < 0.25 || ratio > 4.0) return null;
      var meta = ii.extmetadata || {};
      var val = function (k) { return Research.stripTags(meta[k] && meta[k].value); };
      var name = val('ObjectName') || file.replace(/\.[a-z0-9]+$/i, '').replace(/_/g, ' ');
      var desc = val('ImageDescription');
      if (!trusted && tokens.length && !mentions(file + ' ' + name + ' ' + desc, tokens)) return null;
      var big = ii.width > 1920 ? ii.thumburl.replace(/\/\d+px-/, '/1920px-') : (/tiff/.test(ii.mime) ? ii.thumburl : ii.url);
      return {
        key: squash(file),
        title: clip(name, 90),
        thumb: ii.thumburl,
        full: big || ii.thumburl,
        w: ii.thumbwidth || ii.width, h: ii.thumbheight || ii.height,
        link: ii.descriptionurl,
        source: 'Wikimedia Commons',
        credit: [clip(val('Artist'), 40), val('LicenseShortName')].filter(Boolean).join(' · '),
        year: yearOf(val('DateTimeOriginal') + ' ' + name + ' ' + desc)
      };
    }
    function commonsList(params, signal, trusted, tokens) {
      return Research.getJSON(q('commons.wikimedia.org', Object.assign({}, II, params)), signal, 8000).then(function (j) {
        return {
          items: pagesOf(j).map(function (p) { return fromPage(p, trusted, tokens); }).filter(Boolean),
          next: j && j.continue ? j.continue : null
        };
      }).catch(function () { return { items: [], next: null }; });
    }
    function articleFiles(files, signal, tokens) {
      var list = (files || []).filter(function (f) { return !JUNK.test(f); }).slice(0, 45);
      if (!list.length) return Promise.resolve({ items: [] });
      /* files an article uses are on topic, but its illustrations of
         OTHER things (a map, a related person) still need the name */
      return commonsList({ titles: list.join('|') }, signal, false, tokens);
    }
    function openverse(name, signal, tokens, page) {
      return Research.getJSON('https://api.openverse.org/v1/images/?mature=false&page_size=20&page=' + (page || 1) + '&q=' + encodeURIComponent(name), signal, 5500)
        .then(function (j) {
          return ((j && j.results) || []).map(function (r) {
            if (!r || !r.url || !r.thumbnail) return null;
            if ((r.width && r.width < 320) || (r.height && r.height < 260)) return null;
            var tags = (r.tags || []).map(function (t) { return t && t.name; }).join(' ');
            if (!mentions((r.title || '') + ' ' + tags, tokens)) return null;
            if (/\.(svg|gif)(\?|$)/i.test(r.url)) return null;
            return {
              key: squash(r.url), title: clip(r.title || name, 90), thumb: r.thumbnail, full: r.url, w: r.width, h: r.height,
              link: r.foreign_landing_url || r.url,
              source: r.source ? r.source.charAt(0).toUpperCase() + r.source.slice(1) : 'Openverse',
              credit: [clip(r.creator || '', 40), (r.license ? String(r.license).toUpperCase() + (r.license_version ? ' ' + r.license_version : '') : '')].filter(Boolean).join(' · '),
              year: null
            };
          }).filter(Boolean);
        }).catch(function () { return []; });
    }

    /* Lead images of the articles a search turns up. A search for a
       name also finds pages that merely MENTION it; only pages whose
       title or opening line names the subject may lend their picture. */
    function wikiPageImages(query, signal, tokens) {
      var url = q('en.wikipedia.org', {
        generator: 'search', gsrnamespace: 0, gsrlimit: 8, gsrsearch: query,
        prop: 'pageimages|extracts|info', piprop: 'thumbnail|original', pithumbsize: 1280, pilicense: 'any',
        exintro: 1, explaintext: 1, exsentences: 2, inprop: 'url'
      });
      return Research.getJSON(url, signal, 6000).then(function (j) {
        var pages = pagesOf(j);
        return pages.map(function (p) {
          var th = p.thumbnail && p.thumbnail.source;
          var orig = p.original || {};
          if (!th || JUNK.test(p.title) || (p.thumbnail.width || 0) < 260) return null;
          /* the TITLE must name him: "Ram Dass" mentions Neem Karoli Baba
             in its first line, and is still somebody else */
          if (tokens && tokens.length && !mentions(p.title, tokens)) return null;
          return {
            key: squash(p.title + '_lead'),
            title: p.title,
            thumb: th,
            full: orig.source || th,
            w: p.thumbnail.width, h: p.thumbnail.height,
            link: p.fullurl || ('https://en.wikipedia.org/wiki/' + encodeURIComponent(p.title)),
            source: 'Wikipedia',
            credit: 'Wikipedia',
            year: yearOf(p.extract || p.title)
          };
        }).filter(Boolean);
      }).catch(function () { return []; });
    }

    function commonsBroad(query, signal, tokens) {
      return commonsList({ generator: 'search', gsrnamespace: 6, gsrsearch: query, gsrlimit: 35 }, signal, false, tokens)
        .then(function (r) { return r.items || []; })
        .catch(function () { return []; });
    }

    function merge(lists, era) {
      var seen = {}, out = [];
      lists.forEach(function (list) {
        (list || []).forEach(function (it) {
          if (!it || seen[it.key]) return;
          seen[it.key] = 1;
          out.push(it);
        });
      });
      if (era === 'old' || /^\d{2}s?$/i.test(era)) {
        var targetDecade = parseInt(era, 10);
        if (targetDecade < 100) targetDecade = 1900 + targetDecade;
        out = out.map(function (it, i) { return { it: it, i: i }; }).sort(function (a, b) {
          var inTargetA = a.it.year && a.it.year >= targetDecade && a.it.year <= targetDecade + 9;
          var inTargetB = b.it.year && b.it.year >= targetDecade && b.it.year <= targetDecade + 9;
          if (inTargetA && !inTargetB) return -1;
          if (!inTargetA && inTargetB) return 1;
          var ya = a.it.year || 9999, yb = b.it.year || 9999;
          return ya !== yb ? ya - yb : a.i - b.i;
        }).map(function (x) { return x.it; });
      } else if (era === 'recent') {
        out = out.map(function (it, i) { return { it: it, i: i }; }).sort(function (a, b) {
          var ya = a.it.year || 0, yb = b.it.year || 0;
          return ya !== yb ? yb - ya : a.i - b.i;
        }).map(function (x) { return x.it; });
      }
      return out;
    }

    var cache = new Map();
    /* find(subject, {era, raw, onName}) → { name, title, extract, link, items, sure, more() }
       raw    — sir's whole request, so "shankar ji" is read as a deity
                even though the tidied subject lost its "ji"
       onName — called once the real name is known, before any picture
                has loaded, so the window's title can upgrade early */
    function find(subject, opts, signal) {
      opts = opts || {};
      var tidied = tidy(subject);
      var effectiveSubject = tidied.subject || subject;
      /* "neemaroli baba" searches as "Neem Karoli baba" — the dictionary's
         spelling first, the model's (resolve) on top */
      try { effectiveSubject = Sense.fixTypos(effectiveSubject) || effectiveSubject; } catch (e) {}
      var effectiveEra = opts.era || tidied.decade || (tidied.old ? 'old' : (tidied.recent ? 'recent' : ''));
      opts.era = effectiveEra;
      /* the owner's own words first: a deity, or "lord" = the deities */
      var hit = null;
      try { hit = (opts.raw && Sense.lookup(Sense.core(opts.raw).subject)) || Sense.lookup(subject) || Sense.lookup(effectiveSubject); } catch (e) { hit = null; }
      var key = (hit ? '@' + (hit.group ? hit.id : hit.wiki) : squash(effectiveSubject)) + '|' + (opts.era || '');
      if (cache.has(key)) return cache.get(key);
      var named = function (who) {
        try { if (typeof opts.onName === 'function') opts.onName(who); } catch (e) {}
        return who;
      };
      var p;
      if (hit && hit.group) {
        named({ display: hit.name, title: hit.title, group: true });
        p = findGroup(subject, hit, signal);
      } else {
        var whoP = hit
          ? Promise.resolve({ title: hit.wiki, name: hit.wiki, display: hit.name, sure: true, kind: 'deity' })
          : resolve(effectiveSubject, signal, opts.raw);
        p = whoP.then(named).then(function (who) {
          if (who.group && who.group.length >= 2) {
            return findGroup(subject, {
              id: squash(who.title), name: who.display || who.title, title: (who.display || who.title) + ' — Photos',
              members: who.group.map(function (t) { var tk = tokensOf(t); return { wiki: t, name: t.replace(/\s*\([^)]*\)\s*$/, ''), tokens: tk }; })
            }, signal);
          }
          return findOne(subject, who, hit, opts, signal);
        });
      }
      cache.set(key, p);
      /* an empty result (offline, a blip) is not remembered — asking again retries */
      p.then(function (b) { if (!b || !b.items || !b.items.length) cache.delete(key); }, function () { cache.delete(key); });
      return p;
    }

    function findOne(subject, who, hit, opts, signal) {
        var name = who.title || who.name || subject;
        /* a deity is found by any of its names; a person by theirs */
        var tokens = hit ? hit.tokens : tokensOf(name);
        var searchName = (hit && hit.search) || name;
        return article(who.title, signal).then(function (art) {
          if (art && art.disambiguation) art = null;
          var resolvedTitle = art ? art.title : who.title;
          /* what the window calls it: the deity's Indian name, else the
             model's spelling, else the article's title without "(actor)" */
          var display = (hit && hit.name) || who.display || String(art ? art.title : name).replace(/\s*\([^)]*\)\s*$/, '');
          return Promise.all([
            commonsCategory(art && art.qid, signal),
            wikiMediaList(resolvedTitle, signal, tokens)
          ]).then(function (initRes) {
            var cat = initRes[0];
            var mediaListItems = initRes[1] || [];
            var state = { searchOffset: 0, openversePage: 1, catNext: null };
            var lead = [];
            if (art && art.lead && art.leadThumb && art.leadFile && !JUNK.test(art.leadFile)) {
              var src = art.leadThumb.source;
              lead.push({
                key: squash(art.leadFile.replace(/^File:/, '')), title: art.title, thumb: src,
                full: (art.lead.width && art.lead.width > 1920) ? src.replace(/\/\d+px-/, '/1920px-') : art.lead.source,
                w: art.leadThumb.width || 640, h: art.leadThumb.height || 480, link: art.link, source: 'Wikipedia', credit: 'Wikipedia', year: null
              });
            }
            var eraTerm = opts.era ? (' ' + opts.era) : '';
            function pack(items) {
              var bundle = {
                subject: subject, name: display, display: display, title: display + ' — Photos', wiki: art ? art.title : name,
                era: opts.era || '', sure: !!(art || who.sure), extract: art ? art.extract : '',
                link: art ? art.link : null, category: cat, items: items,
                more: function (sig) { return more(bundle, state, name, tokens, opts.era, sig); }
              };
              return bundle;
            }
            return Promise.all([
              cat ? commonsList({ generator: 'categorymembers', gcmtitle: 'Category:' + cat, gcmtype: 'file', gcmlimit: 50 }, signal, true, tokens) : Promise.resolve({ items: [] }),
              art ? articleFiles(art.files, signal, tokens) : Promise.resolve({ items: [] }),
              commonsBroad(name + eraTerm, signal, tokens),
              commonsBroad(searchName, signal, tokens),
              wikiPageImages(name + eraTerm, signal, tokens),
              Research.within(openverse(searchName + eraTerm, signal, tokens, 1), 5500, [])
            ]).then(function (res) {
              state.catNext = res[0].next;
              var allLists = [mediaListItems, res[0].items, res[1].items, res[2], res[3], res[4], res[5]];
              var items = lead.concat(merge(allLists, opts.era).filter(function (it) { return !lead.length || it.key !== lead[0].key; }));
              if (!items.length) {
                return Promise.all([
                  wikiPageImages(name, signal, tokens),
                  Research.within(openverse(name, signal, tokens, 1), 5000, [])
                ]).then(function (fallbackRes) {
                  return pack(lead.concat(merge([fallbackRes[0], fallbackRes[1]], opts.era)));
                });
              }
              return pack(items);
            });
          });
        });
    }

    /* Several subjects at once — "lord" / "bhagwan" is the major Hindu
       deities, one clearly labelled picture each (the article's own lead
       image: the most trusted picture there is), and "More photos" walks
       through each one's article pictures in turn. */
    function findGroup(subject, grp, signal) {
      var members = (grp.members || []).slice(0, 6);
      var state = { next: 0 };
      function labelled(m, it) {
        it.title = m.name;
        it.label = m.name;
        return it;
      }
      var url = q('en.wikipedia.org', {
        redirects: 1, titles: members.map(function (m) { return m.wiki; }).join('|'),
        prop: 'pageimages|info', piprop: 'thumbnail|original|name', pithumbsize: 960, pilicense: 'any', inprop: 'url'
      });
      return Research.getJSON(url, signal, 7000).then(function (j) {
        var pages = pagesOf(j), qq = (j && j.query) || {};
        var alias = {};
        (qq.normalized || []).concat(qq.redirects || []).forEach(function (r) { if (r && r.from) alias[r.from] = r.to; });
        function pageFor(t) {
          for (var n = 0; alias[t] && n < 3; n++) t = alias[t];
          return pages.filter(function (p) { return p.title === t; })[0] || null;
        }
        return members.map(function (m) {
          var pg = pageFor(m.wiki);
          if (!pg || pg.missing !== undefined || !pg.thumbnail || !pg.thumbnail.source) return null;
          if (pg.pageimage && JUNK.test(pg.pageimage)) return null;
          var th = pg.thumbnail, orig = pg.original || {};
          return labelled(m, {
            key: squash(pg.pageimage || pg.title), thumb: th.source,
            full: (orig.width && orig.width > 1920) ? th.source.replace(/\/\d+px-/, '/1920px-') : (orig.source || th.source),
            w: th.width || 640, h: th.height || 480,
            link: pg.fullurl || ('https://en.wikipedia.org/wiki/' + encodeURIComponent(pg.title)),
            source: 'Wikipedia', credit: 'Wikipedia', year: null
          });
        }).filter(Boolean);
      }).catch(function () { return []; }).then(function (items) {
        var bundle = {
          subject: subject, name: grp.name, display: grp.name, title: grp.title || (grp.name + ' — Photos'), group: true,
          era: '', sure: true, extract: grp.extract || (grp.name + ': ' + members.map(function (m) { return m.name; }).join(', ') + '.'),
          link: grp.link || null, category: null, items: items,
          more: function (sig) {
            var batch = members.slice(state.next, state.next + 3);
            state.next += 3;
            if (!batch.length) return Promise.resolve(0);
            return Promise.all(batch.map(function (m) {
              return wikiMediaList(m.wiki, sig, m.tokens).then(function (list) {
                return list.slice(0, 4).map(function (it) { return labelled(m, it); });
              });
            })).then(function (lists) {
              var before = bundle.items.length;
              bundle.items = merge([bundle.items].concat(lists), '');
              return bundle.items.length - before || (state.next < members.length ? bundle.more(sig) : 0);
            });
          }
        };
        return bundle;
      });
    }

    function more(bundle, state, name, tokens, era, signal) {
      var jobs = [];
      if (state.catNext && state.catNext.gcmcontinue) {
        jobs.push(commonsList({ generator: 'categorymembers', gcmtitle: 'Category:' + bundle.category, gcmtype: 'file', gcmlimit: 50, gcmcontinue: state.catNext.gcmcontinue }, signal, true, tokens)
          .then(function (r) { state.catNext = r.next; return r.items; }));
      }
      if (state.searchOffset) {
        jobs.push(commonsList({ generator: 'search', gsrnamespace: 6, gsrsearch: '"' + name + '" filetype:bitmap', gsrlimit: 30, gsroffset: state.searchOffset }, signal, false, tokens)
          .then(function (r) { state.searchOffset = (r.next && r.next.gsroffset) || 0; return r.items; }));
      }
      state.openversePage += 1;
      jobs.push(Research.within(openverse(name, signal, tokens, state.openversePage), 6000, []));
      return Promise.all(jobs).then(function (lists) {
        var before = bundle.items.length;
        bundle.items = merge([bundle.items].concat(lists), era);
        return bundle.items.length - before;
      });
    }

    return { detect: detect, tidy: tidy, find: find, resolve: resolve, likeness: likeness, tokensOf: tokensOf, mentions: mentions, squash: squash, phonetic: phoneticSquash, eraRe: ERA_DECADE };
  })();

  /* ============================================================
   * 5b+ · SENSE — what sir means, spelled the way it should be
   * ------------------------------------------------------------
   * "lord ki photo dikhao" came back with random pictures: "lord"
   * went to the search as an English word (a British title, a
   * cricket ground). For this owner — Indian, Hindi-speaking —
   * "lord", "bhagwan", "prabhu" mean God, and "shiv ji", "bajrang
   * bali", "kanha" are Shiva, Hanuman, Krishna. A small dictionary
   * answers those instantly and with no AI key; anything it does not
   * know goes to the model with the WHOLE request and that context
   * (Pictures' canonical()), then Wikipedia's search, inside ~3.5 s.
   *
   * The same pass keeps his typos out of the floating window: voice-
   * typed "neemaroli baba ki photo dihao" is titled "Neem Karoli
   * Baba — Photos" at once, and the canonical name swaps in when the
   * lookup lands.
   *
   *   understand(raw)     → { subject, search, name, title, kind, sure, wiki, group, era }
   *   resolve(raw)        → Promise of the same, upgraded by model + Wikipedia
   *   cleanTitle(text)    → a task title without typos and filler
   * ============================================================ */
  var Sense = (function () {
    /* [Wikipedia title, the name the window shows, how sir says it,
        words its pictures are labelled with ("x$" = a whole word)].
       Bare words that are ALSO people or products (govinda the actor,
       maruti the car, surya the film star, kartik, gauri) are left out
       on purpose; with "ji"/"bhagwan"/"lord" in front they still match. */
    var DEITIES = [
      ['Shiva', 'Lord Shiva',
        'shiva|shiv|shivji|shiv ji|shiv shankar|shankar ji|shankar bhagwan|bhole shankar|mahadev|mahadeva|mahadeo|bholenath|bhole nath|bhole baba|neelkanth|nilkanth|mahakal|mahakaal|maheshwar|shambhu|har har mahadev|om namah shivay|om namah shivaya|adiyogi|शिव|शिवजी|महादेव|भोलेनाथ',
        'shiva$|mahadev|mahadeva$|shankar$|bholenath|rudra$|nataraja|shivling|shivalinga|shiva linga|lingam|mahakal|neelkanth|adiyogi'],
      ['Vishnu', 'Lord Vishnu',
        'vishnu|vishnu ji|narayana|narayan ji|shri hari|sri hari|vishnu bhagwan|lakshmi narayan|laxmi narayan|विष्णु',
        'vishnu|narayana$|narayan$|vaikuntha|padmanabha|anantashayana|lakshmi narayan'],
      ['Krishna', 'Lord Krishna',
        'krishna|krishn|krishan|shri krishna|shree krishna|sri krishna|krishna ji|kanha|kanha ji|kanhaiya|kanhaiyya|murlidhar|murli manohar|bal gopal|laddu gopal|bankey bihari|banke bihari|dwarkadhish|shrinathji|कृष्ण|कान्हा|श्री कृष्ण',
        'krishna$|krsna|kanha$|kanhaiya|murlidhar|bal gopal|laddu gopal|bankey bihari|banke bihari|dwarkadhish|shrinathji'],
      ['Rama', 'Lord Rama',
        'ram|rama|ram ji|ramji|shri ram|shree ram|sri ram|jai shri ram|ram chandra|ramchandra|ramachandra|raghunath|ram lalla|ramlala|ram bhagwan|prabhu ram|राम|श्री राम|रामजी',
        'rama$|shri ram|sri ram|shree ram|lord ram$|ram lalla|ramlala|ram darbar|ramachandra|ramchandra|raghunath|kodanda'],
      ['Ganesha', 'Lord Ganesha',
        'ganesh|ganesha|ganesh ji|ganeshji|ganpati|ganpati bappa|ganapati|ganapathi|ganpathi|vinayak|vinayaka|gajanan|gajanana|lambodar|bappa|siddhivinayak|गणेश|गणपति|गणेश जी',
        'ganesha|ganesh$|ganeshji|ganpati|ganapati|ganapathi|vinayaka|vinayak$|gajanan|lambodar|siddhivinayak'],
      ['Hanuman', 'Lord Hanuman',
        'hanuman|hanuman ji|hanumanji|hanumaan|bajrang bali|bajrangbali|bajarang bali|bajrang|pawan putra|pavan putra|anjaneya|anjaneyar|maruti nandan|sankat mochan|हनुमान|बजरंगबली|बजरंग बली',
        'hanuman|bajrang|anjaneya|maruti$|maruthi|sankat mochan'],
      ['Durga', 'Maa Durga',
        'durga|durga maa|durga mata|maa durga|mata rani|sherawali|sheranwali|sherawali maa|ambe maa|jagdamba|jagadamba|navdurga|दुर्गा|माता रानी|शेरावाली',
        'durga$|durga puja|mata rani|ambe$|jagdamba|jagadamba|mahishasuramardini|navdurga|sherawali'],
      ['Lakshmi', 'Maa Lakshmi',
        'lakshmi|laxmi|lakshmi maa|laxmi maa|lakshmi mata|laxmi mata|mahalakshmi|mahalaxmi|लक्ष्मी',
        'lakshmi|laxmi|mahalakshmi|mahalaxmi|gajalakshmi'],
      ['Saraswati', 'Maa Saraswati',
        'saraswati|sarasvati|saraswathi|saraswati maa|saraswati mata|maa saraswati|sharda maa|सरस्वती',
        'saraswati|sarasvati|saraswathi|sharada$|sharda$'],
      ['Parvati', 'Maa Parvati', 'parvati|parvathi|parvati maa|gauri maa|पार्वती', 'parvati|parvathi|gauri$|uma$'],
      ['Kali', 'Maa Kali', 'kali|kali maa|kaali|kaali maa|mahakali|maa kali|kalika|bhadrakali|काली', 'kali$|kaali|mahakali|kalika|bhadrakali'],
      ['Sita', 'Mata Sita', 'sita|seeta|sita maa|sita mata|mata sita|janaki|सीता', 'sita$|seeta|janaki|vaidehi|siya$'],
      ['Radha', 'Radha Rani', 'radha|radha rani|radharani|राधा', 'radha$|radharani|radha rani'],
      ['Radha Krishna', 'Radha Krishna', 'radha krishna|radhe krishna|radhe shyam|radha kishan|radhakrishna|राधा कृष्ण', 'radha krishna|radhakrishna|radha$|krishna$'],
      ['Brahma', 'Lord Brahma', 'brahma|brahma ji|brahmaji|ब्रह्मा', 'brahma$|brahmaji'],
      ['Surya', 'Surya Dev', 'surya dev|suryadev|surya devta|surya bhagwan|सूर्य देव', 'surya$|suryadev|surya dev|sun god'],
      ['Shani (deity)', 'Shani Dev', 'shani|shani dev|shanidev|shani maharaj|शनि देव', 'shani$|shanidev|shani dev|shanaishchara'],
      ['Kartikeya', 'Lord Kartikeya', 'kartikeya|kartikey|kartikey bhagwan|murugan|subramanya|subrahmanya', 'kartikeya|murugan|skanda$|subramanya|subrahmanya'],
      ['Jagannath', 'Lord Jagannath', 'jagannath|jagannath ji|jagannatha|जगन्नाथ', 'jagannath|jagannatha'],
      ['Venkateswara', 'Lord Venkateswara', 'balaji|tirupati balaji|venkateswara|venkateshwara|venkatesh bhagwan', 'venkateswara|venkateshwara|balaji$|tirupati|srinivasa$'],
      ['Vithoba', 'Lord Vitthal', 'vitthal|vithoba|vithal|pandurang|panduranga|vitthal rukmini', 'vithoba|vitthal|vithal$|pandurang'],
      ['Vaishno Devi', 'Vaishno Devi', 'vaishno devi|vaishno mata|vaishno maa|vaishnodevi', 'vaishno|vaishnodevi'],
      ['Nataraja', 'Nataraja', 'nataraj|nataraja|natraj', 'nataraja|nataraj$|natraj$'],
      ['Sai Baba of Shirdi', 'Sai Baba of Shirdi', 'sai baba|saibaba|shirdi sai baba|shirdi wale sai baba|sai nath|sainath|shirdi sai|साईं बाबा', 'sai baba|saibaba|shirdi|sainath'],
      ['Gautama Buddha', 'Gautama Buddha', 'buddha|gautam buddha|gautama buddha|mahatma buddha|lord buddha|bhagwan buddha|siddhartha gautama|बुद्ध', 'buddha|gautama|siddhartha'],
      ['Mahavira', 'Bhagwan Mahavir', 'mahavir|mahavira|bhagwan mahavir|mahaveer|vardhaman|महावीर', 'mahavira|mahavir$|mahaveer|vardhamana'],
      ['Guru Nanak', 'Guru Nanak Dev Ji', 'guru nanak|guru nanak dev|guru nanak dev ji|nanak dev|baba nanak|गुरु नानक', 'guru nanak|nanak$'],
      ['Jesus', 'Jesus Christ', 'jesus|jesus christ|yeshu|yishu|isa masih|lord jesus', 'jesus|christ$|yeshu']
    ];
    /* "lord" / "bhagwan" on their own — for this owner, God */
    var GROUPS = {
      deities: {
        name: 'Hindu Deities', search: 'Hindu deities',
        members: ['Shiva', 'Vishnu', 'Krishna', 'Rama', 'Ganesha', 'Hanuman', 'Durga', 'Lakshmi', 'Saraswati'],
        link: 'https://en.wikipedia.org/wiki/Hindu_deities',
        extract: 'Bhagwan — Hindu dharm ke pramukh devi-devta: Lord Shiva, Lord Vishnu, Lord Krishna, Lord Rama, Lord Ganesha, Lord Hanuman, Maa Durga, Maa Lakshmi aur Maa Saraswati. Kisi ek ki aur photos ke liye unka naam boliye, jaise "shiv ji ki photo".'
      },
      goddesses: {
        name: 'Hindu Goddesses', search: 'Hindu goddesses',
        members: ['Durga', 'Lakshmi', 'Saraswati', 'Parvati', 'Kali', 'Sita', 'Radha'],
        link: 'https://en.wikipedia.org/wiki/Devi',
        extract: 'Devi — Hindu dharm ki pramukh deviyan: Maa Durga, Maa Lakshmi, Maa Saraswati, Maa Parvati, Maa Kali, Mata Sita aur Radha Rani. Kisi ek ki aur photos ke liye unka naam boliye, jaise "durga maa ki photo".'
      }
    };
    function set(words) { var o = {}; words.split(/\s+/).forEach(function (w) { if (w) o[w] = 1; }); return o; }
    var GOD = set('lord lords god gods bhagwan bhagwaan bhagvan bhagawan bhagwano bhagwanon ishwar ishvar eshwar parmeshwar parmatma prabhu devta devte devtao devtaon deity deities भगवान ईश्वर प्रभु देवता परमात्मा');
    var GODDESS = set('goddess goddesses devi deviyan deviyon mata mataji देवी देवियां माता');
    /* words that only add respect — dropped to find the name inside */
    var HONOR = set(Object.keys(GOD).join(' ') + ' ' + Object.keys(GODDESS).join(' ') +
      ' shri shree sri ji jee maa ma dev bappa jai om hindu sabhi sab saare sare all the of ki ka ke aur and श्री जी माँ मां जय ॐ');

    function norm2(t) { return String(t || '').toLowerCase().replace(/[^a-z0-9ऀ-ॿ\s]+/g, ' ').replace(/\s+/g, ' ').trim(); }
    function tokenList(spec) { var a = spec.split('|').filter(Boolean); a.any = true; return a; }

    var ALIAS = {}, STRIPPED = {}, PHON = {}, BY_WIKI = {}, NAME_WORD = {};
    var NOT_A_NAME = set('kali kaali bhole');        // also plain Hindi words ("kaali" = black)
    DEITIES.forEach(function (row) {
      var hit = { kind: 'deity', wiki: row[0], name: row[1], title: row[1] + ' — Photos', search: row[1], tokens: tokenList(row[3]) };
      BY_WIKI[row[0]] = hit;
      row[2].split('|').forEach(function (a) {
        a = norm2(a);
        if (!a) return;
        if (!ALIAS[a]) ALIAS[a] = hit;
        var bare = a.split(' ').filter(function (w) { return !HONOR[w]; }).join(' ');
        if (bare && bare !== 'rani' && !STRIPPED[bare]) STRIPPED[bare] = hit;
        /* sound-alike spellings, long names only — "baapu" must not become "bappa" */
        if (/^[a-z ]{6,}$/.test(a)) { var ph = Pictures.phonetic(a); if (ph && !PHON[ph]) PHON[ph] = hit; }
        if (/^[a-z]{4,}$/.test(a) && !NOT_A_NAME[a]) NAME_WORD[a] = a.charAt(0).toUpperCase() + a.slice(1);
      });
    });
    NAME_WORD.shiv = 'Shiv';
    'gurugram gurgaon delhi noida mumbai pune bangalore bengaluru hyderabad chennai kolkata jaipur ahmedabad lucknow indore chandigarh faridabad ghaziabad manesar sonipat'
      .split(' ').forEach(function (c) { NAME_WORD[c] = c.charAt(0).toUpperCase() + c.slice(1); });
    var GROUP_HIT = {};
    Object.keys(GROUPS).forEach(function (id) {
      var g = GROUPS[id];
      GROUP_HIT[id] = {
        kind: 'group', group: true, id: id, name: g.name, title: g.name + ' — Photos', search: g.search, link: g.link, extract: g.extract,
        members: g.members.map(function (w) { var d = BY_WIKI[w]; return { wiki: w, name: d.name, tokens: d.tokens }; })
      };
    });

    /* A deity or a group of them, from how sir said it — or null. */
    function lookup(text) {
      var s = norm2(fixTypos(text));
      if (!s || s.split(' ').length > 6) return null;
      if (ALIAS[s]) return ALIAS[s];
      var words = s.split(' ');
      var core = words.filter(function (w) { return !HONOR[w]; });
      if (!core.length) {
        if (words.some(function (w) { return GOD[w]; })) return GROUP_HIT.deities;
        if (words.some(function (w) { return GODDESS[w]; })) return GROUP_HIT.goddesses;
        return null;
      }
      var c = core.join(' ');
      if (ALIAS[c]) return ALIAS[c];
      /* "lord shankar", "surya bhagwan": the respect word makes a bare
         name that is also a person's ("shankar", "surya") a deity */
      if (core.length < words.length && STRIPPED[c]) return STRIPPED[c];
      if (/^[a-z ]{6,}$/.test(c)) { var ph = PHON[Pictures.phonetic(c)]; if (ph) return ph; }   // "hanumaan", "krisna"
      return null;
    }

    /* ── spelling ─────────────────────────────────────────────── */
    var TYPO = {
      dihao: 'dikhao', dikao: 'dikhao', dikhau: 'dikhao', dikhaao: 'dikhao', dekhao: 'dikhao', dehao: 'dikhao', dhikao: 'dikhao', dikhoa: 'dikhao', dikhado: 'dikha do',
      btao: 'batao', bato: 'batao', bataao: 'batao', batau: 'batao', btaao: 'batao', smjhao: 'samjhao', samjao: 'samjhao', samjhau: 'samjhao', smjao: 'samjhao',
      chaiye: 'chahiye', chahie: 'chahiye', chahiy: 'chahiye', chaahiye: 'chahiye', chiye: 'chahiye', chaie: 'chahiye', chahiyee: 'chahiye',
      kro: 'karo', krna: 'karna', krni: 'karni', krdo: 'kar do', kardo: 'kar do', krke: 'karke', kese: 'kaise', kaese: 'kaise', kaisey: 'kaise',
      nhi: 'nahi', nahe: 'nahi', mje: 'mujhe', muje: 'mujhe', mujhey: 'mujhe', plz: 'please', pls: 'please', plzz: 'please', plss: 'please',
      bhot: 'bahut', bohot: 'bahut', bhut: 'bahut', kon: 'kaun', kaon: 'kaun', bary: 'baare',
      foto: 'photo', fotos: 'photos', photu: 'photo', phota: 'photo', phto: 'photo', phtos: 'photos', photoz: 'photos', phots: 'photos',
      imges: 'images', imags: 'images', tasvir: 'tasveer', tasweer: 'tasveer', tasveeren: 'tasveerein', tasviren: 'tasveerein',
      hanumaan: 'hanuman', ganpathi: 'ganpati', krisna: 'krishna', krishana: 'krishna', sarswati: 'saraswati', laksmi: 'lakshmi', durgaa: 'durga', mahadeo: 'mahadev',
      /* cities the lead searches name every day */
      gurgoan: 'Gurgaon', gurgao: 'Gurgaon', gurugaon: 'Gurugram', gurugam: 'Gurugram', dehli: 'Delhi', delih: 'Delhi', banglore: 'Bangalore', bangaluru: 'Bengaluru',
      hydrabad: 'Hyderabad', hyderbad: 'Hyderabad', mumabi: 'Mumbai', mumbia: 'Mumbai', faridabaad: 'Faridabad', gaziabad: 'Ghaziabad', ghaziabaad: 'Ghaziabad',
      chandigrah: 'Chandigarh', ahmdabad: 'Ahmedabad', ahemdabad: 'Ahmedabad', luckhnow: 'Lucknow', lukhnow: 'Lucknow', kolkatta: 'Kolkata', calcutta: 'Kolkata', jaipure: 'Jaipur'
    };
    /* names voice typing mangles the same way every time */
    var PHRASE = [
      [/\bn(?:ee|i|e)[mb]\s*k?a?r(?:o|au|ou)[lr]i(\s+baba)?\b/gi, function (m, baba) { return 'Neem Karoli' + (baba ? ' Baba' : ''); }]
    ];
    function fixTypos(text) {
      var s = String(text || '');
      PHRASE.forEach(function (p) { s = s.replace(p[0], p[1]); });
      return s.replace(/[A-Za-z]+/g, function (w) {
        var f = TYPO[w.toLowerCase()];
        if (!f) return w;
        return /^[A-Z]/.test(w) ? f.charAt(0).toUpperCase() + f.slice(1) : f;
      });
    }

    var SMALL = set('of the and ki ka ke se in on at for to a an vs aur me mein wale wali');
    var UPPER = { ms: 'MS', apj: 'APJ', ntr: 'NTR', srk: 'SRK', ipl: 'IPL', isro: 'ISRO', nasa: 'NASA', usa: 'USA', uk: 'UK', bmw: 'BMW', ai: 'AI', iit: 'IIT', dj: 'DJ', mg: 'MG', rss: 'RSS', bts: 'BTS', ww2: 'WW2' };
    function titleCase(s) {
      return String(s || '').split(' ').map(function (w, i) {
        var lw = w.toLowerCase();
        if (UPPER[lw]) return UPPER[lw];
        if (i > 0 && SMALL[lw]) return lw;
        if (/[A-Z]/.test(w.slice(1))) return w;                 // iPhone, McDonald stay as written
        return w.charAt(0).toUpperCase() + w.slice(1);
      }).join(' ');
    }
    function capNames(s) {
      return String(s || '').replace(/[A-Za-z]+/g, function (w) { return NAME_WORD[w] || w; });
    }

    /* ── what a picture request is about ─────────────────────── */
    /* The subject WITH its respect words: "shankar ji" stays "shankar
       ji" (a deity), where Pictures.tidy alone would leave "shankar". */
    function core(raw) {
      var fixed = fixTypos(String(raw || '').replace(/\s+/g, ' ').trim());
      var prot = fixed.replace(/(^|\s)(ji|jee|जी)(?=\s|$)/gi, '$1jiHON');
      var det = null;
      try { det = Pictures.detect(prot, true) || Pictures.detect(prot + ' photos', true); } catch (e) { det = null; }
      var t = det || Pictures.tidy(prot);
      var sub = String(t.subject || '').replace(/jiHON/gi, 'ji').replace(/\s+/g, ' ').trim();
      var era = det ? (det.era || '') : (t.decade || (t.old ? 'old' : (t.recent ? 'recent' : '')));
      return { subject: sub, fixed: fixed.replace(/jiHON/gi, 'ji'), era: era };
    }

    function understand(raw) {
      var c = core(raw);
      var hit = lookup(c.subject);
      if (hit) {
        return {
          raw: String(raw || ''), subject: hit.name, search: hit.search, name: hit.name, title: hit.title,
          kind: hit.kind, sure: true, wiki: hit.wiki || null,
          group: hit.group ? hit.members.map(function (m) { return m.wiki; }) : null,
          labels: hit.group ? hit.members.map(function (m) { return m.name; }) : null,
          tokens: hit.tokens || null,       // what an on-subject picture is labelled with (Pictures.mentions)
          era: c.era
        };
      }
      var name = titleCase(c.subject.replace(/\s+(?:ki|ke|ka|kii|ko)$/i, ''));
      var era = c.era === 'old' ? 'Old Photos' : (c.era === 'recent' ? 'Latest Photos' : (c.era ? c.era + ' Photos' : 'Photos'));
      return {
        raw: String(raw || ''), subject: c.subject, search: c.subject, name: name, title: name ? name + ' — ' + era : 'Photos',
        kind: 'other', sure: false, wiki: null, group: null, labels: null, tokens: Pictures.tokensOf(name), era: c.era
      };
    }

    /* The local reading at once; the model + Wikipedia's reading when it
       lands (≤ ~3.8 s), else the local one stands. Never rejects. */
    var resolved = new Map();
    function resolveQuery(raw, signal) {
      var u = understand(raw);
      if (u.sure || !u.subject) return Promise.resolve(u);
      var key = squashKey(u.subject);
      if (resolved.has(key)) return resolved.get(key);
      var p = Research.within(Pictures.resolve(u.subject, signal, raw).then(function (who) {
        if (!who) return u;
        if (who.group && who.group.length >= 2) {
          return Object.assign({}, u, { name: who.display, subject: who.display, search: who.display, title: who.display + ' — Photos', kind: 'group', group: who.group, labels: who.group, tokens: null, sure: true });
        }
        var disp = String(who.display || (who.sure ? who.title : '') || '').replace(/\s*\([^)]*\)\s*$/, '').trim();
        if (!disp) return u;
        if (disp === disp.toLowerCase()) disp = titleCase(disp);
        return Object.assign({}, u, { name: disp, subject: disp, search: who.title || disp, title: disp + ' — Photos', wiki: who.sure ? who.title : null, kind: who.kind || u.kind, sure: !!who.sure, tokens: Pictures.tokensOf(who.title || disp) });
      }, function () { return u; }), 3800, u);
      resolved.set(key, p);
      return p;
    }
    function squashKey(s) { return norm2(s).replace(/\s+/g, ''); }

    /* ── titles ───────────────────────────────────────────────── */
    var PIC_WORD = /(^|[^a-z])(photos?|images?|pictures?|pics?|picz|wallpapers?|tasveer\w*|tasvir\w*|fotos?|photu)($|[^a-z])/i;
    var MAKE = /\b(generate|create|draw|paint|design|make|edit|banao|bana\s*do|upscale|convert|compress|crop|resize|screenshot|analy[sz]e|describe|upload|attach|save|download)\b/i;
    var LEAD_FILLER = /^(?:(?:hi+|hello|hey|ok|okay|acha|accha|clavis|jarvis|please|kindly|zara|jara|mujhe|mujhko|humein|hume|hamein|can you|could you|will you|would you|ek baar|ek bar)[\s,!.:-]+)+/i;
    var TAIL_FILLER = /(?:[\s,]+(?:please|zara|jara|yaar|yar|bhai|na|jaldi|abhi|dikhao|dikha do|dikhaiye|batao|bata do|bataiye|bataye|samjhao|samjha do|samjhaiye|sir))+(?=[\s?!.।]*$)/i;
    var ABOUT_TAIL = /\s+(?:ke|ki|ka)\s+(?:baare|bare)\s+m(?:e|ein|ai|ain|en)n?(?=[\s?!.।]*$)/i;

    function isPictureAsk(text) {
      if (!PIC_WORD.test(text) || MAKE.test(text)) return false;
      try { return !!Pictures.detect(text, true); } catch (e) { return false; }
    }
    /* One phrase in sir's words, cleaned: typos fixed, "mujhe…batao"
       trimmed, names capitalised. A photo request becomes its subject. */
    function cleanPhrase(text) {
      var s = String(text || '').replace(/\s+/g, ' ').trim();
      if (!s) return '';
      if (/^[A-Z][a-z]+(?:\s[a-z]+)?…$/.test(s)) return s;         // "Thinking…", "Finding photos…"
      var cut = /…$/.test(s);
      s = fixTypos(s.replace(/…$/, '').trim());
      if (isPictureAsk(s)) { var u = understand(s); if (u.name) return u.title; }
      var before = s, prev;
      do {
        prev = s;
        s = s.replace(LEAD_FILLER, '').replace(TAIL_FILLER, '').replace(ABOUT_TAIL, '').trim();
      } while (s && s !== prev);
      if (s.replace(/[?!.।\s]/g, '').length < 2) s = before;
      s = capNames(s);
      s = s.charAt(0).toUpperCase() + s.slice(1);
      return cut ? s + '…' : s;
    }
    /* Task titles come as "Searching · <his words>" — only his words
       are touched; a photo request's title is the subject itself. */
    function cleanTitle(text) {
      var s = String(text || '').replace(/\s+/g, ' ').trim();
      if (!s) return '';
      var m = s.match(/^([^·]{2,40}?)\s·\s(.+)$/);
      if (!m) return cleanPhrase(s);
      var fixedSub = fixTypos(m[2].replace(/…$/, ''));
      if (isPictureAsk(fixedSub)) { var u = understand(fixedSub); if (u.name) return u.title; }
      var sub = cleanPhrase(m[2]);
      return sub ? m[1] + ' · ' + sub : m[1];
    }

    /* The model proofreads a heading the local pass could not vouch for
       (≤ 3.5 s, cached). Resolves to the corrected heading or null. */
    var polished = new Map();
    function polish(text, signal) {
      var t = String(text || '').replace(/\s+/g, ' ').trim();
      // A whole AI call just to proofread a heading ate the free daily quota
      // his real questions need — opt-in only (localStorage clavis_title_ai).
      if (localStorage.getItem('clavis_title_ai') !== 'true') return Promise.resolve(null);
      if (!t || t.length < 6 || t.length > 140 || !Research.hasBrain()) return Promise.resolve(null);
      if (polished.has(t)) return polished.get(t);
      var p = Research.within(Research.llm([
        { role: 'system', content: 'You proofread a short heading shown to an Indian user. Fix ONLY spelling, typos and the capitalisation of names (people, places, deities, brands). ' +
          'Keep the language exactly as given (Hinglish stays Hinglish in Roman script, Hindi stays Hindi), keep the meaning and the word order, add nothing, remove nothing. Reply with the corrected heading only.' },
        { role: 'user', content: t }
      ], signal, { temperature: 0, max_tokens: 70 }).then(function (out) {
        var c = String(out || '').split('\n')[0].trim().replace(/^["'“”]+|["'“”]+$/g, '').trim();
        if (!c || c === t || c.length > t.length * 1.5 + 8 || c.length < t.length * 0.6) return null;
        if (/^(sure|here|corrected|the corrected)/i.test(c)) return null;
        return c;
      }, function () { return null; }), 3500, null);
      polished.set(t, p);
      p.then(function (r) { if (r == null) polished.delete(t); });
      return p;
    }

    return {
      understand: understand, resolve: resolveQuery, lookup: lookup, core: core,
      cleanTitle: cleanTitle, cleanPhrase: cleanPhrase, fixTypos: fixTypos, titleCase: titleCase, polish: polish,
      isPictureAsk: isPictureAsk, groups: GROUP_HIT, deity: function (wiki) { return BY_WIKI[wiki] || null; }
    };
  })();

  /* A text swap the eye reads as the same heading getting sharper, not
     a new one arriving: out 110 ms, in 220 ms. */
  function swapText(node, text) {
    if (!node || !text || node.textContent === text) return;
    if (reducedMotion() || typeof node.animate !== 'function') { node.textContent = text; return; }
    var out = node.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 110, easing: 'ease-out', fill: 'forwards' });
    out.onfinish = function () {
      node.textContent = text;
      node.animate([{ opacity: 0, filter: 'blur(3px)' }, { opacity: 1, filter: 'blur(0px)' }], { duration: 220, easing: 'cubic-bezier(0.2, 0.9, 0.1, 1)' });
      try { out.cancel(); } catch (e) {}
    };
  }


  /* ============================================================
   * 5c · SAY IT, IT HAPPENS — pictures and app control by voice/text
   * ------------------------------------------------------------
   * Everything typed or spoken to Clavis passes ClavisCommands.route
   * first. Plain requests are handled right here, instantly, with no
   * AI round trip: pictures, opening any page, Settings (any section,
   * any switch by its label), theme, sidebar, the task window, new
   * chat, scrolling, lead export / Sheets sync / stats. Anything
   * subtler reaches the model, which now also has tools for the same
   * things (show_images, change_setting, open_settings, set_theme…).
   * ============================================================ */
  var PicTasks = new Map();          // task id → { state, subject, bundle }
  var pendingChatGallery = null;     // pictures a model tool found, for the next reply bubble

  var PAGES = [
    ['dashboard', /\b(dashboard|dash\s*board|home\s*page|overview|mukhya\s*page)\b|डैशबोर्ड/i, 'Dashboard'],
    ['leads', /\b(all\s*leads|leads?\s*(?:page|list|database|db|hub|data)|lead\s*list|leads)\b|लीड्स/i, 'All Leads'],
    ['agent', /\b(run\s*agent|agent\s*page|lead\s*gen(?:eration)?|client\s*acquisition|agent)\b/i, 'Run Agent'],
    ['jarvis', /\b(clavis|jarvis|studio|assistant)\b/i, 'Clavis AI Studio'],
    ['chat', /\b(client\s*ai|chat\s*ai|lead\s*chat|chat\s*page)\b/i, 'Client AI'],
    ['voice-ai', /\b(voice\s*(?:ai|calling|dialer)|calling\s*(?:ai|page)|dialer)\b/i, 'Voice Calling AI'],
    ['candidate-ai', /\b(candidate\s*ai|recruit(?:er|ment)?)\b/i, 'Candidate AI'],
    ['candidate-db', /\b(candidate\s*(?:db|database|list)|candidates)\b/i, 'Candidate DB'],
    ['excel', /\b(excel(?:\s*manager)?|spreadsheet|sheet\s*manager)\b/i, 'Excel Manager'],
    ['analytics', /\b(analytics|reports?|charts?|insights)\b/i, 'Analytics'],
    ['email', /\b(email|e-mail|mail)(?:\s*(?:auto(?:mation)?|page|campaign))?\b/i, 'Email Automation'],
    ['whatsapp', /\b(whats\s*app|whatsapp)\b/i, 'WhatsApp Automation'],
    ['accounts', /\b(accounts?|connected\s*accounts|gmail\s*account)\b/i, 'Accounts'],
    ['plugins', /\b(plugins?|integrations?)\b/i, 'Plugins'],
    ['tokens', /\b(api\s*keys?|keys?\s*dashboard|token(?:s)?\s*(?:usage|dashboard))\b/i, 'API Keys']
  ];
  var SECTIONS = [
    ['profile', /\b(profile|my\s*details|user\s*profile|naam\s*badl)/i], ['appearance', /\b(appearance|look|theme\s*settings|design)\b/i],
    ['dashboard', /\bdashboard\s*settings\b/i], ['usage', /\b(usage|limits|credits)\b/i], ['leadrules', /\blead\s*rules?\b/i],
    ['ai-models', /\b(ai\s*models?|model\s*settings|llm|ai\s*keys?)\b/i], ['voice-settings', /\b(voice\s*settings?|voice|awaaz\s*settings)\b/i],
    ['notifications', /\b(notifications?|alerts?)\b/i], ['security', /\b(security|privacy|backup)\b/i],
    ['performance', /\b(performance|speed|fps|gpu)\b/i], ['about', /\b(about|version)\b/i]
  ];
  var OPEN_RE = /\b(open|show|go\s*to|goto|take\s*me\s*to|navigate\s*to|switch\s*to|launch|khol(?:o|do|\s*do|\s*de|iye|na)?|kholiye|chalo|chal\s*o|jao|jaao|le\s*chalo|dikhao|dikha\s*do|par\s*jao|pe\s*jao|page\s*par)\b|खोलो|दिखाओ|जाओ/i;
  var ON_RE = /\b(on|enable|enabled|start|activate|chalu|shuru|jalao|laga\s*do|allow|haan)\b|चालू|ऑन/i;
  var OFF_RE = /\b(off|disable|disabled|stop|deactivate|band|bandh|bund|hatao|hata\s*do|mute|nahi\s*chahiye)\b|बंद|ऑफ/i;
  var UP_RE = /\b(increase|badhao|badha\s*do|zyada|jyada|more|up|louder|tez|bada)\b/i;
  var DOWN_RE = /\b(decrease|kam|ghatao|less|down|quieter|dheere|chhota)\b/i;

  function norm(t) { return String(t || '').replace(/\s+/g, ' ').trim(); }

  function beginOrReuse(text) {
    var T = global.ClavisTask;
    if (!T || !T.begin) return null;
    var cur = T.current && T.current();
    if (cur && cur._text === text && Date.now() - cur.startedAt < 1500 && cur.phase !== 'completed') return cur.id;
    return T.begin(text, { source: (global.jarvisHandsFree || global.isJarvisListening) ? 'voice' : 'composer' });
  }
  var QuickTasks = new Set();
  function finishQuick(text, spoken, keepOpen) {
    var T = global.ClavisTask;
    var el0 = surfaceEl();
    /* a window sir is already reading is never closed by a quick command */
    if (el0 && el0.classList.contains('is-open')) keepOpen = true;
    var id = beginOrReuse(text);
    if (id) {
      QuickTasks.add(id);
      T.complete(id, { type: 'text', text: spoken, summary: spoken }, []);
      if (!keepOpen) {
        /* a command's confirmation is a glance, not a document */
        setTimeout(function () {
          var t = T.current && T.current();
          var el = surfaceEl();
          if (t && t.id === id && el && !el.matches(':hover') && !el.contains(doc.activeElement)) try { global.ClavisTaskSurface.hide(); } catch (e) {}
        }, 2600);
      }
    }
    return { handled: true, spoken: spoken };
  }

  /* ── settings, by what the label says ───────────────────────── */
  function settingsIndex() {
    var out = [];
    Array.prototype.forEach.call(doc.querySelectorAll('#settings-overlay .smodal-label'), function (l) {
      var field = l.closest('.smodal-field') || l.parentElement;
      var control = field && field.querySelector('input:not([type="hidden"]), select, textarea');
      if (!control) return;
      var sec = field.closest('.smodal-section');
      out.push({ label: norm(l.textContent), control: control, section: sec ? sec.id.replace(/^smsc-/, '') : '' });
    });
    return out;
  }
  function openSettings(section) {
    if (typeof global.openSettingsModal !== 'function') return false;
    global.openSettingsModal();
    if (section && typeof global.settingsNavTo === 'function') {
      var btn = doc.querySelector('.smodal-nav-item[data-section="' + section + '"]');
      global.settingsNavTo(section, btn);
    }
    return true;
  }
  function fire(control) {
    control.dispatchEvent(new Event('input', { bubbles: true }));
    control.dispatchEvent(new Event('change', { bubbles: true }));
  }
  function settingWords(label) {
    return label.toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').split(' ').filter(function (w) { return w.length > 2 && !/^(and|the|for|per|mode)$/.test(w); });
  }
  function findSetting(text) {
    var low = ' ' + text.toLowerCase() + ' ';
    var best = null, score = 0;
    settingsIndex().forEach(function (s) {
      var words = settingWords(s.label);
      if (!words.length) return;
      var hits = words.filter(function (w) { return low.indexOf(w) >= 0; }).length;
      var sc = hits / words.length + (low.indexOf(s.label.toLowerCase()) >= 0 ? 1 : 0);
      if (hits && sc > score) { score = sc; best = s; }
    });
    return score >= 0.99 ? best : null;
  }
  function applySetting(s, text, explicitValue) {
    var c = s.control, low = String(text || '').toLowerCase();
    if (c.type === 'checkbox') {
      var want = explicitValue != null ? !!explicitValue : (OFF_RE.test(low) ? false : (ON_RE.test(low) ? true : !c.checked));
      if (c.checked !== want) { c.checked = want; fire(c); }
      return s.label + (want ? ' on kar diya.' : ' band kar diya.');
    }
    if (c.tagName === 'SELECT') {
      var opts = Array.prototype.slice.call(c.options);
      var pick = explicitValue != null ? opts.find(function (o) { return o.value === String(explicitValue) || norm(o.textContent).toLowerCase() === String(explicitValue).toLowerCase(); })
        : opts.find(function (o) { var t = norm(o.textContent).toLowerCase(); return t && low.indexOf(t) >= 0; });
      if (!pick) return null;
      c.value = pick.value; fire(c);
      return s.label + ' ab "' + norm(pick.textContent) + '" hai.';
    }
    if (c.type === 'range' || c.type === 'number') {
      var min = parseFloat(c.min || 0), max = parseFloat(c.max || 100), cur = parseFloat(c.value || 0);
      var num = explicitValue != null ? parseFloat(explicitValue) : parseFloat((low.match(/-?\d+(?:\.\d+)?/) || [])[0]);
      var next = !isNaN(num) ? num : (UP_RE.test(low) ? cur + (max - min) * 0.2 : (DOWN_RE.test(low) ? cur - (max - min) * 0.2 : NaN));
      if (isNaN(next)) return null;
      next = Math.max(min, Math.min(max, next));
      c.value = String(Math.round(next * 100) / 100); fire(c);
      return s.label + ' ' + c.value + ' kar diya.';
    }
    if (explicitValue != null) { c.value = String(explicitValue); fire(c); return s.label + ' update kar diya.'; }
    return null;
  }

  function scrollMain(dir) {
    var box = doc.querySelector('.view.active .jarvis-chat-container, .view.active') ;
    var area = doc.getElementById('main-scroll-area');
    var el = (area && area.scrollHeight > area.clientHeight + 4) ? area : box;
    if (!el) return false;
    var dy = dir === 'top' ? -el.scrollTop : dir === 'bottom' ? el.scrollHeight : (dir === 'up' ? -1 : 1) * el.clientHeight * 0.7;
    el.scrollBy({ top: dy, behavior: reducedMotion() ? 'auto' : 'smooth' });
    return true;
  }

  /* ── timer & training handlers ───────────────────────────────── */
  var ActiveTimers = [];
  function handleTimerCommand(text, low) {
    if (/\b(cancel|band|stop|hatao|delete)\b/i.test(low)) {
      if (!ActiveTimers.length) return { spoken: 'Abhi koi active timer nahi hai.' };
      var count = ActiveTimers.length;
      ActiveTimers.forEach(function (at) { clearTimeout(at.timeoutId); });
      ActiveTimers = [];
      return { spoken: count > 1 ? 'Saare active timers cancel kar diye.' : 'Timer cancel kar diya.' };
    }
    if (/\b(status|kitna\s*time|kitna\s*bacha|remaining|bache?)\b/i.test(low)) {
      if (!ActiveTimers.length) return { spoken: 'Abhi koi active timer nahi chal raha hai.' };
      var now = Date.now();
      var remainingList = ActiveTimers.map(function (at) {
        var diffSec = Math.max(0, Math.round((at.endsAt - now) / 1000));
        var mins = Math.floor(diffSec / 60);
        var secs = diffSec % 60;
        return at.label + ' me ' + (mins ? mins + ' minute ' : '') + secs + ' second bache hain';
      });
      return { spoken: remainingList.join(', ') + '.' };
    }

    var m = low.match(/(\d+(?:\.\d+)?)\s*(minute|min|m|second|sec|s|ghante?|hour|h)\b/i);
    var num = m ? parseFloat(m[1]) : 5;
    var unit = m ? m[2].toLowerCase() : 'min';
    var ms = num * 60 * 1000;
    var label = num + ' minute';
    if (/^s/i.test(unit)) { ms = num * 1000; label = num + ' second'; }
    else if (/^h|ghant/i.test(unit)) { ms = num * 3600 * 1000; label = num + ' ghanta'; }

    var timerEntry = {
      id: Date.now(),
      label: label,
      endsAt: Date.now() + ms,
      timeoutId: null
    };

    timerEntry.timeoutId = setTimeout(function () {
      ActiveTimers = ActiveTimers.filter(function (at) { return at.id !== timerEntry.id; });
      try {
        var AudioCtx = window.AudioContext || window.webkitAudioContext;
        if (AudioCtx) {
          var ctx = new AudioCtx();
          [587.33, 880, 1046.5].forEach(function (freq, i) {
            var osc = ctx.createOscillator();
            var gain = ctx.createGain();
            osc.type = 'sine';
            osc.frequency.value = freq;
            gain.gain.setValueAtTime(0.15, ctx.currentTime + i * 0.18);
            gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + i * 0.18 + 0.35);
            osc.connect(gain);
            gain.connect(ctx.destination);
            osc.start(ctx.currentTime + i * 0.18);
            osc.stop(ctx.currentTime + i * 0.18 + 0.36);
          });
        }
      } catch (e) {}

      var T = global.ClavisTask;
      if (T && T.begin) {
        var id = T.begin('Timer Complete: ' + label, { source: 'timer' });
        if (id) T.complete(id, { type: 'text', text: 'Timer poora hua: ' + label + '!', summary: 'Timer poora hua: ' + label + '!' }, []);
      }
      try { global.ClavisTaskSurface.show(); } catch (e) {}
      if (typeof global.speakText === 'function' && global.jarvisSpeechEnabled) {
        global.speakText('Aapka ' + label + ' ka timer poora ho gaya hai sir.');
      }
    }, ms);

    ActiveTimers.push(timerEntry);
    return { spoken: label + ' ka timer shuru kar diya.' };
  }

  function handleTrainingCommand(text, low) {
    var fact = text.replace(/^(?:clavis|jarvis|hey|hi|please|zara)[\s,!.:]+/i, '')
      .replace(/^(?:yaad\s*rakh(?:na|o|naa)?|remember\s*(?:this|that)?|train\s*(?:karo|karna)?|note\s*kar\s*lo|save\s*(?:this\s*)?(?:preference|rule|fact))\s*(?:ki|that|:)?\s*/i, '')
      .replace(/\s+(?:yaad\s*rakhna|remember|note\s*karo|save\s*karo)$/i, '').trim();
    if (!fact) fact = text;

    try {
      if (global.ClavisMind && global.ClavisMind.remember) {
        global.ClavisMind.remember(fact, { tags: ['user-trained', 'voice-train'], importance: 0.9, confidence: 0.95 });
      }
      var ds = [];
      try { ds = JSON.parse(localStorage.getItem('clavis_trained_dataset') || '[]'); } catch (e) { ds = []; }
      ds.unshift({ id: 'train_' + Date.now(), fact: fact, date: new Date().toISOString() });
      if (ds.length > 200) ds = ds.slice(0, 200);
      localStorage.setItem('clavis_trained_dataset', JSON.stringify(ds));
    } catch (e) {}

    return { spoken: 'Yaad rakh liya sir: "' + clip(fact, 60) + '". Maine ise apne dataset me train kar liya hai.' };
  }

  /* ── the router ─────────────────────────────────────────────── */
  function control(raw) {
    var text = norm(raw);
    if (!text || text.length > 220) return null;
    /* PC automation (clavis-automation.js) owns desktop commands — "excel
       kholo" is the Excel app, not the in-app Excel Manager page. When it
       claims the sentence, this router steps aside (not handled). */
    try {
      var Auto = global.ClavisAutomation;
      if (Auto && typeof Auto.claims === 'function' && Auto.claims(text)) return null;
    } catch (e) {}
    var low = text.toLowerCase();

    var pic = Pictures.detect(text);
    if (pic) return pictureAnswer(text, pic);

    /* timer / alarm */
    if (/\b(timer|alarm)\b/i.test(low) && (/\b(\d+)\s*(minute|min|m|second|sec|s|ghanta|hour|h)\b/i.test(low) || /\b(lagao|set|start|chalu|cancel|band|stop|status|kitna)\b/i.test(low))) {
      var tRes = handleTimerCommand(text, low);
      if (tRes) return finishQuick(text, tRes.spoken, true);
    }

    /* train / remember / preferences */
    if (/\b(yaad\s*rakh(?:na|o|naa)?|remember\s*(?:this|that)?|train\s*(?:karo|karna)?|note\s*kar\s*lo|save\s*(?:this\s*)?(?:preference|rule|fact))\b/i.test(low)) {
      var memRes = handleTrainingCommand(text, low);
      if (memRes) return finishQuick(text, memRes.spoken, true);
    }
    if (/\b(kya\s*yaad\s*(?:hai|rakha|kiya)|what\s*do\s*you\s*remember|show\s*(?:memory|preferences|trained\s*data)|meri\s*preferences?|trained\s*dataset)\b/i.test(low)) {
      var ds = [];
      try { ds = JSON.parse(localStorage.getItem('clavis_trained_dataset') || '[]'); } catch (e) { ds = []; }
      if (!ds.length) {
        return finishQuick(text, 'Abhi tak koi training rule save nahi kiya gaya hai. Aap "yaad rakhna ki..." bolkar koi bhi rule train kar sakte hain.', true);
      }
      var recent = ds.slice(0, 3).map(function (d, i) { return (i + 1) + '. ' + d.fact; }).join('; ');
      return finishQuick(text, 'Maine ye baatein yaad rakhi hain: ' + recent + ' (Total: ' + ds.length + ' facts).', true);
    }

    /* youtube: open, search or play */
    if (/\byoutube\b/i.test(low)) {
      if (OPEN_RE.test(low) || /\b(search|chalao|play|chalu|dekho|kholo|dhoondo|dhundo)\b/i.test(low)) {
        var yq = low.replace(/\byoutube\b/gi, '').replace(/\b(open|show|go\s*to|kholo|khol\s*do|par|pe|me|search|karo|chalao|play|chalu|dekho|dhoondo|dhundo|please|zara|song|gaana|video)\b/gi, ' ').trim();
        var yurl = yq ? ('https://www.youtube.com/results?search_query=' + encodeURIComponent(yq)) : 'https://youtube.com';
        if (global.ClavisPC && typeof global.ClavisPC.open === 'function') global.ClavisPC.open(yurl);
        else global.open(yurl, '_blank');
        return finishQuick(text, yq ? ('YouTube par "' + yq + '" search kar diya.') : 'YouTube khol diya.');
      }
    }

    /* google: open or search */
    if (/\bgoogle\b/i.test(low)) {
      if (OPEN_RE.test(low) || /\b(search|dhoondo|dhundo|par|pe|karo)\b/i.test(low)) {
        var gq = low.replace(/\bgoogle\b/gi, '').replace(/\b(open|show|go\s*to|kholo|khol\s*do|par|pe|me|search|karo|dhoondo|dhundo|karke|batao|please|zara)\b/gi, ' ').trim();
        var gurl = gq ? ('https://www.google.com/search?q=' + encodeURIComponent(gq)) : 'https://www.google.com';
        if (global.ClavisPC && typeof global.ClavisPC.open === 'function') global.ClavisPC.open(gurl);
        else global.open(gurl, '_blank');
        return finishQuick(text, gq ? ('Google par "' + gq + '" search kar diya.') : 'Google khol diya.');
      }
    }

    /* wikipedia: open or search */
    if (/\bwikipedia\b/i.test(low)) {
      if (OPEN_RE.test(low) || /\b(search|dekho|padho|kholo|par|pe)\b/i.test(low)) {
        var wq = low.replace(/\bwikipedia\b/gi, '').replace(/\b(open|show|go\s*to|kholo|khol\s*do|par|pe|me|search|dekho|padho|karo|dhoondo|dhundo|please|zara)\b/gi, ' ').trim();
        var wurl = wq ? ('https://en.wikipedia.org/wiki/Special:Search?search=' + encodeURIComponent(wq)) : 'https://en.wikipedia.org';
        if (global.ClavisPC && typeof global.ClavisPC.open === 'function') global.ClavisPC.open(wurl);
        else global.open(wurl, '_blank');
        return finishQuick(text, wq ? ('Wikipedia par "' + wq + '" khol diya.') : 'Wikipedia khol diya.');
      }
    }

    /* theme */
    if (/\b(dark|night|raat)\s*(mode|theme)?\b|डार्क/i.test(low) && (ON_RE.test(low) || OPEN_RE.test(low) || /\b(karo|kar\s*do|chahiye|laga|set|switch|use)\b/.test(low) || /^(dark|dark mode|night mode)$/.test(low))) {
      if (global.ThemeController) global.ThemeController.set('dark', { animate: true, manual: true });
      return finishQuick(text, 'Dark mode on kar diya.');
    }
    if (/\b(light|day|din|white)\s*(mode|theme)\b|लाइट/i.test(low) || /^(light|light mode|day mode)$/.test(low)) {
      if (global.ThemeController) global.ThemeController.set('light', { animate: true, manual: true });
      return finishQuick(text, 'Light mode on kar diya.');
    }
    if (/\b(theme|mode)\b/.test(low) && /\b(badlo|badal\s*do|change|toggle|switch|palto|ulta)\b/.test(low)) {
      if (typeof global.toggleDayNightTheme === 'function') global.toggleDayNightTheme();
      return finishQuick(text, 'Theme badal diya.');
    }

    /* sidebar */
    if (/\b(sidebar|side\s*bar|menu|navigation)\b/.test(low) && global.SidebarController) {
      if (OFF_RE.test(low) || /\b(collapse|chhota|close|hide|chupao)\b/.test(low)) { global.SidebarController.collapse(); return finishQuick(text, 'Sidebar band kar diya.'); }
      if (OPEN_RE.test(low) || ON_RE.test(low) || /\b(expand|bada|show)\b/.test(low)) { global.SidebarController.expand(); return finishQuick(text, 'Sidebar khol diya.'); }
    }

    /* the task window itself */
    if (/\b(floating\s*window|task\s*window|peek\s*tasks?|panel|tasks?\s*window|result\s*window)\b/.test(low)) {
      if (OFF_RE.test(low) || /\b(close|hide|hatao|chupao)\b/.test(low)) { try { global.ClavisTaskSurface.hide(); } catch (e) {} return { handled: true, spoken: 'Theek hai.' }; }
      try { global.ClavisTaskSurface.show({ user: true }); } catch (e) {}
      return { handled: true, spoken: 'Ye raha.' };
    }

    /* new chat, scrolling */
    if (/\b(new|nayi|naya|nai|fresh)\s*(chat|conversation|baat)\b/.test(low) && typeof global.newJarvisChat === 'function') {
      global.newJarvisChat();
      return finishQuick(text, 'Nayi chat shuru kar di.');
    }
    if (/\b(scroll|neeche|niche|upar|oopar|top|bottom)\b/.test(low) && /\b(scroll|jao|karo|chalo|le\s*jao)\b/.test(low) && low.split(' ').length <= 6) {
      var dir = /\b(upar|oopar|up)\b/.test(low) ? 'up' : /\btop\b/.test(low) ? 'top' : /\bbottom\b/.test(low) ? 'bottom' : 'down';
      if (scrollMain(dir)) return { handled: true, spoken: '' , silent: true };
    }

    /* voice switches in the studio header */
    if (/\b(hands?\s*free)\b/.test(low) && typeof global.toggleJarvisHandsFree === 'function') {
      var hf = !!global.jarvisHandsFree, wantHF = OFF_RE.test(low) ? false : (ON_RE.test(low) ? true : !hf);
      if (wantHF !== hf) global.toggleJarvisHandsFree();
      return finishQuick(text, 'Hands-free ' + (wantHF ? 'on' : 'off') + ' kar diya.');
    }
    if (/\b(speaker|awaaz|awaz|voice\s*reply|bol\s*kar\s*jawab|reply\s*voice)\b/.test(low) && (ON_RE.test(low) || OFF_RE.test(low)) && typeof global.toggleJarvisSpeech === 'function') {
      var sp = !!global.jarvisSpeechEnabled, wantSp = !OFF_RE.test(low);
      if (wantSp !== sp) global.toggleJarvisSpeech();
      return finishQuick(text, wantSp ? 'Main ab bol kar jawab dunga.' : 'Theek hai, ab chup-chaap likh kar jawab dunga.');
    }

    /* settings: close it, flip a named switch, or open a section */
    var wantsSettings = /\b(settings?|setting|preferences|seting|सेटिंग)/i.test(low);
    if ((wantsSettings || /\b(popup|modal)\b/.test(low)) && /\b(close|band|bandh|hatao|hata\s*do|exit)\b/.test(low) && !findSetting(text)) {
      if (typeof global.closeSettingsModal === 'function') global.closeSettingsModal();
      return finishQuick(text, 'Settings band kar diya.');
    }
    var s = findSetting(text);
    if (s && (ON_RE.test(low) || OFF_RE.test(low) || UP_RE.test(low) || DOWN_RE.test(low) || /\d/.test(low) || s.control.tagName === 'SELECT' || wantsSettings)) {
      var said = applySetting(s, text);
      if (said) return finishQuick(text, said);
    }
    if (wantsSettings && (OPEN_RE.test(low) || low.split(' ').length <= 3)) {
      var section = null;
      SECTIONS.forEach(function (x) { if (!section && x[1].test(low.replace(/settings?/g, ''))) section = x[0]; });
      if (openSettings(section)) return finishQuick(text, section ? 'Settings me ' + section.replace(/-/g, ' ') + ' khol diya.' : 'Settings khol diya.');
    }

    /* a page */
    if (OPEN_RE.test(low) || /\b(page|tab|screen)\b/.test(low)) {
      for (var i = 0; i < PAGES.length; i++) {
        if (PAGES[i][1].test(low) && typeof global.showView === 'function') {
          if (PAGES[i][0] === 'jarvis' && !/\b(page|tab|studio|kholo|open|jao)\b/.test(low)) continue;
          global.location.hash = '#' + PAGES[i][0];
          return finishQuick(text, PAGES[i][2] + ' khol diya.');
        }
      }
    }

    /* external app, website, or URL open */
    var appMatch = low.match(/^(?:open|launch|kholo|start|run|chalao)\s+([a-z0-9_.\-/: ]+?)(?:\s+(?:app|application|website|site|kholo|open))?$/i) ||
                   low.match(/^([a-z0-9_.\-/: ]+?)\s+(?:kholo|open\s*karo|chalao|launch\s*karo)$/i);
    if (appMatch) {
      var target = appMatch[1].trim();
      if (!/\b(settings?|theme|sidebar|chat|window|dark|light|mode|page|tab)\b/i.test(target)) {
        if (global.ClavisPC && typeof global.ClavisPC.open === 'function') {
          /* ClavisPC.open answers { ok:false, error } when the app isn't
             installed — say that, never a "khol diya" that didn't happen */
          var appName = target.charAt(0).toUpperCase() + target.slice(1);
          var opened;
          try { opened = global.ClavisPC.open(target); } catch (e) { opened = Promise.reject(e); }
          return Promise.resolve(opened).then(function (r) {
            if (r && r.ok === false) return finishQuick(text, String(r.error || (appName + ' nahi khul paya.')), true);
            return finishQuick(text, appName + ' khol diya.');
          }, function (err) {
            return finishQuick(text, appName + ' nahi khul paya' + (err && err.message ? ': ' + err.message : '.'), true);
          });
        } else if (/^https?:\/\/|[\w-]+\.[a-z]{2,}/i.test(target)) {
          var dest = /^https?:\/\//i.test(target) ? target : 'https://' + target;
          global.open(dest, '_blank');
          return finishQuick(text, target + ' khol diya.');
        }
      }
    }

    /* data actions the skills already know */
    var S = global.JarvisSkills;
    if (S && S.invoke) {
      if (/\b(export|download)\b.*\bleads?\b|\bleads?\b.*\b(export|download|excel\s*me|csv\s*me)\b/.test(low)) {
        var fmt = /\bcsv\b/.test(low) ? 'csv' : 'excel';
        return S.invoke('export_leads', { format: fmt }).then(function (o) { return finishQuick(text, o.success ? 'Leads ' + fmt + ' me export kar diye.' : ('Export nahi hua: ' + (o.error || ''))); });
      }
      if (/\b(sync|update)\b.*\b(sheet|sheets|google\s*sheet)\b/.test(low)) {
        return S.invoke('sync_leads_to_sheets', {}).then(function (o) { return finishQuick(text, o.success ? 'Google Sheets sync kar diya.' : ('Sync nahi hua: ' + (o.error || ''))); });
      }
      if (/\b(kitni|kitne|how\s*many|count|stats|total)\b.*\bleads?\b|\bleads?\b.*\b(kitni|kitne|count|stats)\b/.test(low)) {
        return S.invoke('get_lead_stats', {}).then(function (o) {
          var r = o && o.result;
          var line = typeof r === 'string' ? r : (r && (r.total != null) ? 'Abhi database me ' + r.total + ' leads hain.' : 'Lead stats: ' + clip(JSON.stringify(r || {}), 160));
          return finishQuick(text, line, true);
        });
      }
    }
    return null;
  }

  /* ── pictures, answered ─────────────────────────────────────── */
  /* The window's heading for a task, set from here (the task model and
     the surface are other files): the clean local reading at once, the
     canonical name when the lookup lands. */
  function setTaskTitle(id, title) {
    if (!id || !title) return;
    try { if (global.ClavisTaskSurface && typeof global.ClavisTaskSurface.setTitle === 'function') global.ClavisTaskSurface.setTitle(id, title, { kicker: 'Photos' }); } catch (e) {}
  }
  function spokenFor(b, n) {
    if (!n) return 'Maine ' + b.name + ' ke results fetch kar liye hain. Aap direct Google Images ya Wikipedia par bhi dekh sakte hain.';
    if (b.group) return 'Ye rahi ' + b.name + ' ki ' + n + ' tasveerein — har photo par naam likha hai.';
    return 'Ye rahi ' + b.name + ' ki ' + (n > 1 ? n + ' tasveerein' : 'tasveer') + '.';
  }
  function pictureAnswer(text, det) {
    var T = global.ClavisTask;
    var id = beginOrReuse(text);
    /* what he MEANT, spelled right — instantly, no network */
    var sense = null;
    try { sense = Sense.understand(text); } catch (e) { sense = null; }
    var label = (sense && sense.name) || det.subject;
    if (id) {
      PicTasks.set(id, { state: 'loading', subject: det.subject, sense: sense });
      if (sense) setTaskTitle(id, sense.title);
      try { T.event(id, { type: 'searching', label: 'Finding photos of ' + label }); } catch (e) {}
    }
    var onName = function (who) {
      var disp = who && (who.display || (who.sure && who.title));
      if (id && disp) setTaskTitle(id, who.group ? (who.title || disp + ' — Photos') : String(disp).replace(/\s*\([^)]*\)\s*$/, '') + ' — Photos');
    };
    return Pictures.find(det.subject, { era: det.era, raw: text, onName: onName }).then(function (b) {
      // Sir's rule: 2 to 6 pictures, never a wall of 23.
      b.items = (b.items || []).slice(0, 6);
      var n = b.items.length;
      if (!n && !b.group && (det.subject.indexOf(' ') > 0 || det.era)) {
        /* ERA_DECADE lives inside Pictures — referencing it bare here threw,
           turning every empty era search into a failed task */
        var cleanSub = det.subject.replace(Pictures.eraRe, '').trim();
        return Pictures.find(cleanSub, {}).then(function (b2) {
          if (b2.items.length) { b = b2; b.items = b.items.slice(0, 6); n = b.items.length; }
          if (id) { PicTasks.set(id, { state: 'ready', subject: det.subject, bundle: b, sense: sense }); setTaskTitle(id, b.title); }
          var spoken = n ? spokenFor(b, n) : ('Maine ' + b.name + ' ke baare me jankari fetch kar li hai.');
          if (id) T.complete(id, { type: 'images', text: n ? (b.extract || spoken) : spoken, summary: spoken }, []);
          return { handled: true, spoken: spoken, bubbleHtml: n ? chatGalleryHTML(b) : '' };
        });
      }
      if (id) { PicTasks.set(id, { state: 'ready', subject: det.subject, bundle: b, sense: sense }); setTaskTitle(id, b.title); }
      var spoken = spokenFor(b, n);
      if (id) T.complete(id, { type: 'images', text: n ? (b.extract || spoken) : spoken, summary: spoken }, []);
      return { handled: true, spoken: spoken, bubbleHtml: n ? chatGalleryHTML(b) : '' };
    }).catch(function (err) {
      var msg = 'Abhi tasveerein load ho rahi hain — topic summary ye raha.';
      if (id) { PicTasks.delete(id); try { T.fail(id, err || new Error(msg)); } catch (e) {} }
      return { handled: true, spoken: msg };
    });
  }

  function shotHTML(im, cls, hidden) {
    return '<button type="button" class="lx-shot' + (cls ? ' ' + cls : '') + '" data-full="' + esc(im.full || im.thumb) + '" data-title="' + esc(im.title) +
      '" data-credit="' + esc([im.source, im.credit].filter(Boolean).join(' · ')) + '" data-link="' + esc(im.link || '') + '" aria-label="' + esc('Open photo: ' + im.title) + '"' + (hidden ? ' hidden' : '') + '>' +
      '<img src="' + esc(im.thumb) + '" alt="' + esc(im.title) + '" loading="lazy" decoding="async" referrerpolicy="no-referrer">' +
      (im.label ? '<span class="lx-shot-cap">' + esc(im.label) + '</span>' : '') +
      '<span class="lx-shot-zoom">' + icon('zoomIn', 14) + '</span></button>';
  }
  function chatGalleryHTML(b) {
    var shown = b.items.slice(0, 6);
    return '<div class="lx-inline-media" data-gallery data-count="' + Math.min(shown.length, 4) + '">' +
      b.items.slice(0, 24).map(function (im, i) { return shotHTML(im, '', i >= 6); }).join('') + '</div>' +
      '<p class="lx-inline-cap">' + icon('images', 12) + '<span>' + esc(b.name) + ' · ' + esc(uniqueSources(b.items).join(' · ')) + '</span></p>';
  }
  function uniqueSources(items) {
    var seen = {}, out = [];
    items.forEach(function (i) { if (i.source && !seen[i.source]) { seen[i.source] = 1; out.push(i.source); } });
    return out.slice(0, 3);
  }

  /* the panel: a real gallery, and next steps that fit pictures */
  var GAL_VISIBLE = 9;
  function galleryHTML(b) {
    var items = b.items;
    var extra = Math.max(0, items.length - GAL_VISIBLE);
    return '<section class="lx-gallery" data-gallery data-count="' + Math.min(items.length, GAL_VISIBLE) + '">' +
      '<div class="lx-gal-grid">' + items.map(function (im, i) {
        var cls = (i === 0 ? 'is-hero' : '') + (i === GAL_VISIBLE - 1 && extra ? ' has-more' : '');
        var h = shotHTML(im, cls, i >= GAL_VISIBLE);
        return (i === GAL_VISIBLE - 1 && extra) ? h.replace('</button>', '<span class="lx-shot-more">+' + extra + '</span></button>') : h;
      }).join('') + '</div>' +
      '<div class="lx-gal-foot"><span class="lx-gal-count">' + icon('images', 13) + '<span>' + items.length + ' photo' + (items.length === 1 ? '' : 's') + ' · ' + esc(uniqueSources(items).join(' · ')) + '</span></span>' +
      '<button type="button" class="lx-gal-more" data-lx-act="pics-more">' + icon('plus', 13) + '<span>More photos</span></button></div>' +
      '</section>';
  }
  function picturesNextHTML(b) {
    var name = b.name;
    var rows = [
      '<button type="button" class="cts-next-btn" data-lx-ask="' + esc(name + ' ke baare me detail me batao — kaun hai/kya hai, kyun famous hai') + '">' + esc('About ' + clip(name, 26)) + '</button>'
    ];
    /* a group (the deities) has no single life story to tell */
    if (!b.group) rows.push('<button type="button" class="cts-next-btn" data-lx-ask="' + esc(name + ' ki life / history ka timeline batao') + '">Timeline &amp; key moments</button>');
    var gImgUrl = 'https://www.google.com/search?tbm=isch&q=' + encodeURIComponent(b.name + (b.era ? ' ' + b.era : ''));
    rows.push('<button type="button" class="cts-next-btn" data-lx-link="' + esc(gImgUrl) + '">Search on Google Images</button>');
    if (b.link) rows.push('<button type="button" class="cts-next-btn" data-lx-link="' + esc(b.link) + '">Open on Wikipedia</button>');
    return '<div class="cts-next lx-pics-next"><span class="cts-next-label">Next</span>' + rows.join('') + '</div>';
  }
  /* A command's confirmation is one calm line, not an answer card. */
  function decorateQuick(el, body) {
    var t = currentTask();
    var quick = !!(t && QuickTasks.has(t.id) && t.phase === 'completed');
    el.classList.toggle('lx-quick', quick);
    if (!quick || body.querySelector(':scope > .lx-quick-line')) return;
    var said = (t.result && (t.result.summary || t.result.text)) || 'Done';
    body.innerHTML = '<p class="lx-quick-line"><span class="lx-quick-tick">' + icon('check', 14, 2.2) + '</span><span></span></p>';
    body.querySelector('.lx-quick-line span:last-child').textContent = said;
    setHeadLabel(el, 'Done');
  }

  function decoratePictures(el, body) {
    var t = currentTask();
    var pt = t && PicTasks.get(t.id);
    el.classList.toggle('lx-pics', !!pt);
    if (!pt) return;
    if (pt.state === 'loading') {
      if (body.querySelector(':scope > .lx-gal-loading')) return;
      body.insertAdjacentHTML('beforeend', '<div class="lx-gal-loading" aria-hidden="true"><span class="lx-shot is-hero"></span><span class="lx-shot"></span><span class="lx-shot"></span><span class="lx-shot"></span><span class="lx-shot"></span></div>');
      return;
    }
    /* .lx-pics-empty too: the empty card is a body mutation of its own,
       and without this check the observer re-added it forever — a photo
       search with no results froze the whole page */
    if (el.getAttribute('data-phase') !== 'completed' || body.querySelector(':scope > .lx-gallery, :scope > .lx-pics-empty')) return;
    var b = pt.bundle;
    var h = body.querySelector(':scope > h2.cts-title');
    if (h) { h.textContent = b.name; h.dataset.lx = '1'; }
    var kick = body.querySelector(':scope > .cts-kicker');
    if (kick) kick.textContent = 'Photos';
    else if (h) h.insertAdjacentHTML('beforebegin', '<p class="cts-kicker lx-ask-kicker">Photos</p>');
    if (!b.items.length) {
      var anchor = body.querySelector(':scope > .cts-result') || h;
      var gImgUrl = 'https://www.google.com/search?tbm=isch&q=' + encodeURIComponent(b.name + (b.era ? ' ' + b.era : ''));
      var emptyCard = '<div class="lx-pics-empty" style="padding: 14px 0; text-align: center;">' +
        '<p style="font-size: 13px; color: var(--cts-text-sub, #888); margin-bottom: 12px;">' + esc(b.name) + ' ki photos web par available hain.</p>' +
        '<button type="button" class="cts-next-btn" data-lx-link="' + esc(gImgUrl) + '">' + icon('images', 14) + ' Search on Google Images</button>' +
        '</div>';
      var emptyFrag = doc.createRange().createContextualFragment(emptyCard);
      if (anchor && anchor.nextSibling) body.insertBefore(emptyFrag, anchor.nextSibling);
      else body.appendChild(emptyFrag);
      var oldNext = body.querySelector(':scope > .cts-next');
      if (oldNext) oldNext.remove();
      body.insertAdjacentHTML('beforeend', picturesNextHTML(b));
      Array.prototype.forEach.call(body.querySelectorAll('.cts-next-btn'), decorateRow);
      morphHeight(el, function () {});
      return;
    }
    var anchor = body.querySelector(':scope > .cts-result') || h;
    var holder = doc.createElement('div');
    holder.innerHTML = galleryHTML(b);
    var gal = holder.firstChild;
    if (anchor && anchor.nextSibling) body.insertBefore(gal, anchor.nextSibling); else body.appendChild(gal);
    var oldNext = body.querySelector(':scope > .cts-next');
    if (oldNext) oldNext.remove();
    body.insertAdjacentHTML('beforeend', picturesNextHTML(b));
    Array.prototype.forEach.call(body.querySelectorAll('.cts-next-btn'), decorateRow);
    wireImages(gal, function () { morphHeight(el, function () {}); });
    morphHeight(el, function () {});
  }
  function morePictures(el, body, btn) {
    var t = currentTask();
    var pt = t && PicTasks.get(t.id);
    if (!pt || !pt.bundle || btn.classList.contains('is-busy')) return;
    btn.classList.add('is-busy');
    pt.bundle.more().then(function (added) {
      btn.classList.remove('is-busy');
      if (!added) { btn.querySelector('span').textContent = 'That’s all I found'; btn.disabled = true; return; }
      var gal = body.querySelector('.lx-gallery');
      if (!gal) return;
      var holder = doc.createElement('div');
      holder.innerHTML = galleryHTML(pt.bundle);
      morphHeight(el, function () { gal.replaceWith(holder.firstChild); });
      wireImages(body.querySelector('.lx-gallery'), function () {});
    }, function () { btn.classList.remove('is-busy'); });
  }

  /* "sidebar band karo" and "UI sounds band karo" end in the stop
     phrase, so the app silenced itself instead of doing them. A stop
     word only means stop when the sentence isn't about something. */
  function looksLikeCommand(t) {
    var low = norm(t).toLowerCase();
    if (/\b(sidebar|side\s*bar|menu|panel|window|theme|dark|light|mode|settings?|sounds?|pet|notifications?|page|tab|dashboard|leads?|whatsapp|email|excel|analytics|agent|hands?\s*free|mic|microphone|cursor|glow|tilt|blur|toasts?|alerts?|chat)\b/.test(low)) return true;
    return !!findSetting(t);
  }

  function installControl() {
    var C = global.ClavisCommands;
    if (!C || typeof C.route !== 'function') return false;
    if (C.route.__lx) return true;
    if (typeof C.isStop === 'function' && !C.isStop.__lx) {
      var stopInner = C.isStop;
      var isStop = function (t) { return looksLikeCommand(t) ? false : stopInner.apply(C, arguments); };
      isStop.__lx = true;
      C.isStop = isStop;
    }
    var inner = C.route;
    var route = function (text) {
      var mine = null;
      try { mine = control(text); } catch (e) { console.warn('[ClavisLuxe] control', e); }
      if (mine) return Promise.resolve(mine);
      return inner.apply(C, arguments);
    };
    route.__lx = true;
    C.route = route;
    return true;
  }

  /* clavis-voice-nav.js is consulted inside ClavisCommands.route after
     this router. Its patterns are broad — "report", "stats", "home" or
     "settings" anywhere in a sentence navigates away — and it re-sends
     lead requests into the composer, where the duplicate-turn guard
     drops them. Only short imperatives reach it now; questions and
     lead asks go on to the model, which has the real tools. */
  function installVoiceNavGate() {
    var VN = global.ClavisVoiceNav;
    if (!VN || typeof VN.route !== 'function') return !!global.ClavisCommands;
    if (VN.route.__lx) return true;
    var inner = VN.route;
    var gated = function (text) {
      var low = norm(text).toLowerCase();
      if (low.split(' ').length > 9 || /\?|\b(kaise|kya|kyun|kyu|kab|kaun|kitna|how|what|why|when|who|which|explain|batao|samjhao|bataiye)\b/.test(low)) return { handled: false };
      if (/\b(leads?|contacts?|companies)\b/.test(low) && /\b(nikalo|generate|dhundho|dhoondo|search|lao|chahiye|find|get)\b/.test(low)) return { handled: false };
      if (!OPEN_RE.test(low) && !ON_RE.test(low) && !OFF_RE.test(low) && !/\b(badlo|toggle|switch|export|download|lagao)\b/.test(low)) return { handled: false };
      return inner.apply(VN, arguments);
    };
    gated.__lx = true;
    VN.route = gated;
    return true;
  }

  function installTools() {
    var S = global.JarvisSkills;
    if (!S || !S.register) return false;
    if (S.has && S.has('show_images')) return true;
    S.register('show_images', {
      description: 'Find REAL photos of a person, place or thing (Wikipedia, Wikimedia Commons, Openverse) and SHOW them to the owner in the Clavis window, where they can tap to enlarge. Use this whenever the owner wants to see pictures, photos, images or tasveer of anything — you CAN show images through this tool, never say you cannot.',
      params: { query: 'exact name of what to show, in English as titled on Wikipedia (e.g. "Neem Karoli Baba")', era: 'optional: "old" or "recent"' },
      run: function (p) {
        var subject = String((p && p.query) || '').trim();
        if (!subject) throw new Error('query is required');
        var era = p && /old|purani|vintage/i.test(p.era || '') ? 'old' : (p && /recent|latest|new/i.test(p.era || '') ? 'recent' : '');
        return Pictures.find(subject, { era: era }).then(function (b) {
          var t = currentTask();
          if (t) PicTasks.set(t.id, { state: 'ready', subject: subject, bundle: b });
          pendingChatGallery = b.items.length ? b : null;
          return b.items.length ? ('Showing ' + b.items.length + ' photos of ' + b.name + ' in the Clavis window (' + uniqueSources(b.items).join(', ') + '). Reply in one short line; do not list the photos.')
            : ('No reliable photos of ' + b.name + ' were found. Say so in one line and suggest the correct spelling.');
        });
      }
    });
    var list = settingsIndex().map(function (s) { return s.label; }).slice(0, 80).join(', ');
    S.register('change_setting', {
      description: 'Change an app setting by its label. Available: ' + list + '. For on/off switches value is true/false; for sliders a number; for dropdowns the option text.',
      params: { setting: 'label of the setting', value: 'new value' },
      run: function (p) {
        var label = String((p && p.setting) || '');
        var s = settingsIndex().filter(function (x) { return x.label.toLowerCase() === label.toLowerCase(); })[0] || findSetting(label);
        if (!s) throw new Error('No setting called "' + label + '"');
        var v = p.value;
        if (s.control.type === 'checkbox') v = v === true || /^(true|on|yes|1|enable|enabled)$/i.test(String(v));
        var said = applySetting(s, '', v);
        if (!said) throw new Error('Could not set ' + s.label + ' to ' + p.value);
        return said;
      }
    });
    S.register('open_settings', {
      description: 'Open the Settings window, optionally at a section: profile, appearance, dashboard, usage, leadrules, ai-models, voice-settings, notifications, security, performance, about.',
      params: { section: 'optional section id' },
      run: function (p) { if (!openSettings(p && p.section)) throw new Error('Settings not available'); return 'Settings opened' + (p && p.section ? ' at ' + p.section : '') + '.'; }
    });
    S.register('set_theme', {
      description: 'Switch the app theme with its animation: "dark", "light" or "toggle".',
      params: { mode: 'dark | light | toggle' },
      run: function (p) {
        var m = String((p && p.mode) || 'toggle').toLowerCase();
        if (m === 'toggle' && typeof global.toggleDayNightTheme === 'function') global.toggleDayNightTheme();
        else if (global.ThemeController) global.ThemeController.set(m === 'light' ? 'light' : 'dark', { animate: true, manual: true });
        return 'Theme is now ' + (root.getAttribute('data-theme') || m) + '.';
      }
    });
    S.register('app_control', {
      description: 'Do small things in the app UI: "expand_sidebar", "collapse_sidebar", "show_task_window", "hide_task_window", "new_chat", "scroll_down", "scroll_up", "scroll_top".',
      params: { action: 'one of the listed actions' },
      run: function (p) {
        var a = String((p && p.action) || '');
        if (a === 'expand_sidebar' && global.SidebarController) global.SidebarController.expand();
        else if (a === 'collapse_sidebar' && global.SidebarController) global.SidebarController.collapse();
        else if (a === 'show_task_window') global.ClavisTaskSurface && global.ClavisTaskSurface.show({ user: true });
        else if (a === 'hide_task_window') global.ClavisTaskSurface && global.ClavisTaskSurface.hide();
        else if (a === 'new_chat' && typeof global.newJarvisChat === 'function') global.newJarvisChat();
        else if (/^scroll_/.test(a)) scrollMain(a.replace('scroll_', ''));
        else throw new Error('Unknown action ' + a);
        return 'Done: ' + a;
      }
    });
    return true;
  }

  /* ============================================================
   * 6 · VIEWER — the lightbox
   * ------------------------------------------------------------
   * The picture grows out of its thumbnail: the full image starts
   * scaled and cropped (clip-path inset) exactly over the thumb,
   * then both release together, so the crop opens up as it grows
   * instead of the thumb stretching into place. Closing reverses
   * it into wherever the thumbnail is now.
   * ============================================================ */
  var Viewer = (function () {
    var st = null;
    var EASE_IN = 'cubic-bezier(0.2, 0.9, 0.1, 1)';
    var EASE_OUT = 'cubic-bezier(0.4, 0, 0.2, 1)';

    function itemsFrom(shots) {
      return shots.map(function (s) {
        var img = s.querySelector('img');
        return {
          el: s,
          thumb: img ? (img.currentSrc || img.src) : '',
          full: s.dataset.full || (img ? img.src : ''),
          title: s.dataset.title || (img ? img.alt : ''),
          credit: s.dataset.credit || '',
          link: s.dataset.link || ''
        };
      });
    }

    function fit(w, h) {
      var vw = global.innerWidth, vh = global.innerHeight;
      var mx = vw < 720 ? 14 : 84;
      var top = 70, bottom = vw < 720 ? 96 : 110;
      var maxW = vw - mx * 2, maxH = vh - top - bottom;
      var s = Math.min(maxW / w, maxH / h, 2);
      var fw = Math.round(w * s), fh = Math.round(h * s);
      return { left: Math.round((vw - fw) / 2), top: Math.round(top + (maxH - fh) / 2), width: fw, height: fh };
    }
    function place(img, r) {
      img.style.left = r.left + 'px';
      img.style.top = r.top + 'px';
      img.style.width = r.width + 'px';
      img.style.height = r.height + 'px';
    }
    function thumbRect(item) {
      if (!item || !item.el || !item.el.isConnected || item.el.hidden) return null;
      var r = item.el.getBoundingClientRect();
      if (!r.width || r.bottom < 0 || r.top > global.innerHeight) return null;
      return r;
    }
    function morphFrames(T, F, radius) {
      var s = Math.max(T.width / F.width, T.height / F.height);
      var dx = (T.left + T.width / 2) - (F.left + F.width / 2);
      var dy = (T.top + T.height / 2) - (F.top + F.height / 2);
      var ix = Math.max(0, (F.width - T.width / s) / 2);
      var iy = Math.max(0, (F.height - T.height / s) / 2);
      return [
        { transform: 'translate(' + dx + 'px,' + dy + 'px) scale(' + s + ')', clipPath: 'inset(' + iy + 'px ' + ix + 'px round ' + (radius / s) + 'px)' },
        { transform: 'translate(0px,0px) scale(1)', clipPath: 'inset(0px 0px round 14px)' }
      ];
    }

    function open(shots, index, fromEl) {
      if (st) close(true);
      var items = itemsFrom(shots);
      if (!items.length) return;
      index = clamp(index, 0, items.length - 1);

      var wrap = doc.createElement('div');
      wrap.className = 'lx-lb' + (items.length < 2 ? ' is-single' : '');
      wrap.setAttribute('role', 'dialog');
      wrap.setAttribute('aria-modal', 'true');
      wrap.setAttribute('aria-label', 'Image viewer');
      wrap.innerHTML =
        '<div class="lx-lb-veil" data-lb="close"></div>' +
        '<img class="lx-lb-img" alt="" referrerpolicy="no-referrer" draggable="false">' +
        '<div class="lx-lb-chrome">' +
        '<div class="lx-lb-top"><span class="lx-lb-count"></span><div class="lx-lb-actions">' +
        '<a class="lx-lb-btn" data-lb="open" target="_blank" rel="noopener noreferrer" aria-label="Open original" title="Open original">' + icon('external', 18) + '</a>' +
        '<button type="button" class="lx-lb-btn" data-lb="close" aria-label="Close" title="Close (Esc)">' + icon('x', 18) + '</button>' +
        '</div></div>' +
        '<button type="button" class="lx-lb-btn lx-lb-nav lx-lb-prev" data-lb="prev" aria-label="Previous image">' + icon('chevronLeft', 20) + '</button>' +
        '<button type="button" class="lx-lb-btn lx-lb-nav lx-lb-next" data-lb="next" aria-label="Next image">' + icon('chevronRight', 20) + '</button>' +
        '<div class="lx-lb-cap"></div>' +
        '</div>';
      doc.body.appendChild(wrap);

      st = { wrap: wrap, img: wrap.querySelector('.lx-lb-img'), veil: wrap.querySelector('.lx-lb-veil'), items: items, index: index, returnFocus: fromEl || doc.activeElement };
      var item = items[index];
      var thumbImg = item.el.querySelector('img');
      var nw = (thumbImg && thumbImg.naturalWidth) || 1200, nh = (thumbImg && thumbImg.naturalHeight) || 800;
      st.img.src = item.thumb;
      st.img.alt = item.title;
      var F = fit(nw, nh);
      place(st.img, F);
      st.img.style.clipPath = 'inset(0px 0px round 14px)';
      caption();

      var T = thumbRect(item);
      var motion = !reducedMotion();
      st.veil.animate({ opacity: [0, 1] }, { duration: motion ? 420 : 1, easing: 'ease-out' });
      var a;
      if (T && motion) a = st.img.animate(morphFrames(T, F, 12), { duration: 620, easing: EASE_IN });
      else a = st.img.animate({ opacity: [0, 1], transform: ['scale(0.96)', 'scale(1)'] }, { duration: motion ? 320 : 1, easing: EASE_IN });
      item.el.style.visibility = 'hidden';
      a.onfinish = function () {
        if (!st || st.wrap !== wrap) return;
        wrap.classList.add('is-ready');
        var closeBtn = wrap.querySelector('[data-lb="close"].lx-lb-btn');
        try { closeBtn.focus({ preventScroll: true }); } catch (e) {}
        loadFull();
      };
      if (reducedMotion()) wrap.classList.add('is-ready');

      wrap.addEventListener('click', onClick);
      st.img.addEventListener('click', toggleZoom);
      st.img.addEventListener('mousemove', pan);
    }

    function caption() {
      if (!st) return;
      var item = st.items[st.index];
      var cap = st.wrap.querySelector('.lx-lb-cap');
      cap.innerHTML = '';
      if (item.title) { var b = doc.createElement('b'); b.textContent = item.title; cap.appendChild(b); }
      if (item.credit) { var s = doc.createElement('span'); s.textContent = item.credit; cap.appendChild(s); }
      st.wrap.querySelector('.lx-lb-count').textContent = (st.index + 1) + ' / ' + st.items.length;
      var openA = st.wrap.querySelector('[data-lb="open"]');
      var href = item.link || item.full;
      if (href) { openA.href = href; openA.hidden = false; } else openA.hidden = true;
    }

    function loadFull() {
      if (!st) return;
      var item = st.items[st.index];
      if (!item.full || item.full === item.thumb) return;
      var want = st.index;
      var pre = new Image();
      pre.referrerPolicy = 'no-referrer';
      pre.onload = function () { if (st && st.index === want) st.img.src = item.full; };
      pre.src = item.full;
    }

    function go(delta) {
      if (!st || st.items.length < 2) return;
      unzoom();
      var from = st.items[st.index];
      from.el.style.visibility = '';
      st.index = (st.index + delta + st.items.length) % st.items.length;
      var item = st.items[st.index];
      var img = st.img;
      var motion = !reducedMotion();
      var out = img.animate({ opacity: [1, 0], transform: ['translateX(0px)', 'translateX(' + (-delta * 28) + 'px)'] }, { duration: motion ? 170 : 1, easing: EASE_OUT, fill: 'forwards' });
      out.onfinish = function () {
        if (!st) return;
        var ti = item.el.querySelector('img');
        var F = fit((ti && ti.naturalWidth) || 1200, (ti && ti.naturalHeight) || 800);
        img.src = item.thumb;
        img.alt = item.title;
        place(img, F);
        out.cancel();
        img.animate({ opacity: [0, 1], transform: ['translateX(' + (delta * 36) + 'px) scale(0.985)', 'translateX(0px) scale(1)'] }, { duration: motion ? 420 : 1, easing: EASE_IN });
        item.el.style.visibility = 'hidden';
        caption();
        loadFull();
      };
    }

    function toggleZoom(e) {
      if (!st) return;
      e.stopPropagation();
      var wrap = st.wrap, img = st.img;
      if (wrap.classList.contains('is-zoomed')) { unzoom(); return; }
      var r = img.getBoundingClientRect();
      img.style.transformOrigin = ((e.clientX - r.left) / r.width * 100).toFixed(1) + '% ' + ((e.clientY - r.top) / r.height * 100).toFixed(1) + '%';
      wrap.classList.add('is-zoomed');
      img.style.transform = 'scale(2)';
    }
    function unzoom() {
      if (!st) return;
      st.wrap.classList.remove('is-zoomed');
      st.img.style.transform = '';
    }
    function pan(e) {
      if (!st || !st.wrap.classList.contains('is-zoomed')) return;
      var img = st.img;
      var r = img.getBoundingClientRect();
      var base = { left: parseFloat(img.style.left), top: parseFloat(img.style.top), width: parseFloat(img.style.width), height: parseFloat(img.style.height) };
      void r;
      var x = clamp((e.clientX - base.left) / base.width, 0, 1) * 100;
      var y = clamp((e.clientY - base.top) / base.height, 0, 1) * 100;
      img.style.transformOrigin = x.toFixed(1) + '% ' + y.toFixed(1) + '%';
    }

    function onClick(e) {
      var t = e.target.closest && e.target.closest('[data-lb]');
      if (!t) return;
      var what = t.getAttribute('data-lb');
      if (what === 'open') return;          // let the link open
      e.preventDefault();
      if (what === 'close') close();
      else if (what === 'prev') go(-1);
      else if (what === 'next') go(1);
    }

    function close(instant) {
      if (!st) return;
      var s = st;
      st = null;
      var item = s.items[s.index];
      var motion = !reducedMotion() && !instant;
      s.wrap.classList.remove('is-ready');
      s.wrap.style.pointerEvents = 'none';
      var img = s.img;
      if (s.wrap.classList.contains('is-zoomed')) { img.style.transition = 'none'; img.style.transform = ''; }
      var F = { left: parseFloat(img.style.left), top: parseFloat(img.style.top), width: parseFloat(img.style.width), height: parseFloat(img.style.height) };
      var T = thumbRect(item);
      var finish = function () {
        item.el.style.visibility = '';
        s.wrap.remove();
        try { if (s.returnFocus && s.returnFocus.focus) s.returnFocus.focus({ preventScroll: true }); } catch (e) {}
      };
      if (!motion) { finish(); return; }
      s.veil.animate({ opacity: [1, 0] }, { duration: 360, easing: EASE_OUT, fill: 'forwards' });
      var a;
      if (T) {
        var frames = morphFrames(T, F, 12).reverse();
        a = img.animate(frames, { duration: 460, easing: 'cubic-bezier(0.32, 0.72, 0, 1)', fill: 'forwards' });
      } else {
        a = img.animate({ opacity: [1, 0], transform: ['scale(1)', 'scale(0.96)'] }, { duration: 240, easing: EASE_OUT, fill: 'forwards' });
      }
      a.onfinish = finish;
    }

    /* The window listens first: the floating panel dismisses itself
       on any outside pointerdown and on Esc, at document capture —
       neither may fire while the viewer owns the screen. */
    global.addEventListener('pointerdown', function (e) {
      if (!st) return;
      if (st.wrap.contains(e.target)) e.stopPropagation();
    }, true);
    global.addEventListener('keydown', function (e) {
      if (!st) return;
      if (e.key === 'Escape') { e.stopPropagation(); e.preventDefault(); close(); }
      else if (e.key === 'ArrowRight') { e.stopPropagation(); e.preventDefault(); go(1); }
      else if (e.key === 'ArrowLeft') { e.stopPropagation(); e.preventDefault(); go(-1); }
      else if (e.key === 'Tab') {
        var f = Array.prototype.filter.call(st.wrap.querySelectorAll('.lx-lb-btn'), function (b) { return !b.hidden && b.offsetParent !== null; });
        if (!f.length) return;
        var i = f.indexOf(doc.activeElement);
        e.preventDefault();
        f[(i + (e.shiftKey ? -1 : 1) + f.length) % f.length].focus();
      }
    }, true);
    global.addEventListener('resize', function () {
      if (!st) return;
      var ti = st.items[st.index].el.querySelector('img');
      place(st.img, fit((ti && ti.naturalWidth) || 1200, (ti && ti.naturalHeight) || 800));
    });

    return { open: open, close: close, get isOpen() { return !!st; } };
  })();

  /* Any .lx-shot anywhere opens the viewer with its siblings. */
  doc.addEventListener('click', function (e) {
    var shot = e.target && e.target.closest ? e.target.closest('.lx-shot') : null;
    if (!shot || shot.closest('.lx-lb')) return;
    if (!shot.querySelector('img') || shot.classList.contains('is-broken')) return;
    e.preventDefault();
    e.stopPropagation();
    var gallery = shot.closest('[data-gallery], .lx-media, .lx-inline-media') || shot.parentNode;
    var shots = Array.prototype.filter.call(gallery.querySelectorAll('.lx-shot'), function (s) {
      return s.querySelector('img') && !s.classList.contains('is-broken');
    });
    Viewer.open(shots, shots.indexOf(shot), shot);
  }, true);

  /* ============================================================
   * 7 · ANSWERS — images written into replies become images
   * ============================================================ */
  var IMG_MD = /!\[([^\]]{0,160})\]\((https?:\/\/[^\s)]+)\)/g;
  var IMG_URL = /(^|[\s(])(https?:\/\/[^\s<>"')]+?\.(?:png|jpe?g|webp|gif|avif)(?:\?[^\s<>"')]*)?)(?=$|[\s),.])/gi;

  function enhanceImages(container, onChange) {
    if (!container || container.__lxImgs) return;
    container.__lxImgs = true;
    var walker = doc.createTreeWalker(container, NodeFilter.SHOW_TEXT, null);
    var nodes = [];
    while (walker.nextNode()) {
      var n = walker.currentNode;
      if (n.nodeValue && n.nodeValue.indexOf('http') > -1 && !(n.parentNode && n.parentNode.closest && n.parentNode.closest('a, code, pre, .lx-inline-media'))) nodes.push(n);
    }
    var found = [];
    nodes.forEach(function (n) {
      var text = n.nodeValue;
      var next = text.replace(IMG_MD, function (m, alt, url) { found.push({ src: url, alt: alt }); return ''; });
      next = next.replace(IMG_URL, function (m, lead, url) { found.push({ src: url, alt: '' }); return lead; });
      if (next !== text) n.nodeValue = next;
    });
    if (!found.length) return;
    var seen = {};
    found = found.filter(function (f) { if (seen[f.src]) return false; seen[f.src] = 1; return true; }).slice(0, 8);
    var grid = doc.createElement('div');
    grid.className = 'lx-inline-media';
    grid.setAttribute('data-gallery', '');
    grid.setAttribute('data-count', String(Math.min(found.length, 4)));
    found.forEach(function (f) {
      var b = doc.createElement('button');
      b.type = 'button';
      b.className = 'lx-shot';
      b.dataset.full = f.src;
      b.dataset.title = f.alt || '';
      b.dataset.link = f.src;
      b.setAttribute('aria-label', f.alt ? 'Open image: ' + f.alt : 'Open image');
      var img = doc.createElement('img');
      img.src = f.src;
      img.alt = f.alt || '';
      img.loading = 'lazy';
      img.decoding = 'async';
      img.referrerPolicy = 'no-referrer';
      b.appendChild(img);
      b.insertAdjacentHTML('beforeend', '<span class="lx-shot-zoom">' + icon('zoomIn', 14) + '</span>');
      grid.appendChild(b);
    });
    container.appendChild(grid);
    grid.__wired = true;
    wireImages(grid, function () {
      var ok = grid.querySelectorAll('.lx-shot:not(.is-broken)').length;
      if (!ok) grid.remove();
      else grid.setAttribute('data-count', String(Math.min(ok, 4)));
      if (onChange) onChange();
    });
    if (onChange) onChange();
  }

  function installChatImages() {
    var box = doc.getElementById('jarvis-messages');
    if (!box) return false;
    if (box.__lxImgs) return true;
    box.__lxImgs = true;
    function scan(node) {
      if (!node || node.nodeType !== 1) return;
      var bubbles = node.matches && node.matches('.chat-message.assistant') ? [node] : (node.querySelectorAll ? node.querySelectorAll('.chat-message.assistant') : []);
      Array.prototype.forEach.call(bubbles, function (m) {
        var b = m.querySelector('.chat-bubble');
        if (b && pendingChatGallery && !b.querySelector('.lx-inline-media')) {
          b.insertAdjacentHTML('beforeend', chatGalleryHTML(pendingChatGallery));
          pendingChatGallery = null;
        }
        if (b) {
          enhanceImages(b);
          var g = b.querySelector('.lx-inline-media');
          if (g && !g.__wired) { g.__wired = true; wireImages(g); }
        }
      });
    }
    new MutationObserver(function (list) {
      list.forEach(function (mu) { Array.prototype.forEach.call(mu.addedNodes, scan); });
    }).observe(box, { childList: true });
    scan(box);
    return true;
  }

  /* ============================================================
   * INSTALL
   * ============================================================ */
  function install() {
    var tasks = {
      perf: installPerf,
      composer: installComposerGrow,
      assist: installComposerAssist,
      theme: ThemeReveal.install,
      glide: installGlide,
      tips: installTips,
      tip: installTipGlyph,
      surface: installSurface,
      control: installControl,
      navpill: installNavPill,
      settings: installSettingsPolish,
      scrollbar: installMainScrollbarHelper,
      tools: installTools,
      voicenav: installVoiceNavGate,
      chat: installChatImages
    };
    var done = {};
    function tick() {
      var all = true;
      Object.keys(tasks).forEach(function (k) {
        if (done[k]) return;
        try { done[k] = !!tasks[k](); } catch (e) { console.warn('[ClavisLuxe] ' + k, e); done[k] = true; }
        if (!done[k]) all = false;
      });
      return all;
    }
    if (tick()) return;
    var n = 0;
    var iv = setInterval(function () {
      if (tick() || ++n > 120) clearInterval(iv);
    }, 250);
    /* The floating panel is built lazily on the first task. */
    var mo = new MutationObserver(function () {
      if (!done.surface && surfaceEl()) { try { done.surface = installSurface(); } catch (e) {} }
      if (done.surface) mo.disconnect();
    });
    mo.observe(doc.body, { childList: true });
  }

  ready(install);

  global.ClavisLuxe = {
    version: '2.1',
    kindFor: kindFor,
    keywords: keywords,
    parseDeep: parseDeep,
    cleanQuestion: cleanQuestion,
    research: Research,
    pictures: Pictures,
    /* clavis-voice-nav.js calls this for "X ki photos"; same trusted path as typing it */
    researchImages: function (topic) {
      var t = String(topic || '').trim();
      if (!t) return;
      var det = Pictures.detect(t + ' photos') || { subject: Pictures.tidy(t).subject || t, era: '' };
      return pictureAnswer(t + ' photos', det);
    },
    sense: Sense,
    /* ── Query understanding, shared with clavis-canvas.js (voice/Live),
       clavis-task-surface.js (titles) and the chips ──────────────────
       understandImageQuery(raw) → { subject, search, name, title, kind,
         sure, wiki, group, labels, era } — instant and local, no key:
         'lord ki photo dikhao'        → kind 'group', title 'Hindu Deities — Photos'
         'shiv ji ki photo'            → kind 'deity', wiki 'Shiva', name 'Lord Shiva'
         'neemaroli baba ki photo dihao' → name 'Neem Karoli Baba'            */
    understandImageQuery: function (raw) {
      try { return Sense.understand(raw); } catch (e) {
        var t = String(raw || '').replace(/\s+/g, ' ').trim();
        return { raw: t, subject: t, search: t, name: t, title: t ? t + ' — Photos' : 'Photos', kind: 'other', sure: false, wiki: null, group: null, labels: null, era: '' };
      }
    },
    /* the same, upgraded by the model (with sir's cultural context) and
       Wikipedia within ~3.8 s; never rejects — the local reading stands */
    resolveImageQuery: function (raw, signal) {
      try { return Sense.resolve(raw, signal); } catch (e) { return Promise.resolve(global.ClavisLuxe.understandImageQuery(raw)); }
    },
    /* on-subject pictures for a request: Promise<{ name, title, items[{thumb, full, title, label?, source, link}], group?, more() }> */
    findImages: function (raw, signal) {
      var c = Sense.core(raw);
      return Pictures.find(c.subject || String(raw || ''), { era: c.era, raw: String(raw || '') }, signal);
    },
    /* titles for the floating window: "Finding photos · neemaroli baba ki photo dihao" → "Neem Karoli Baba — Photos" */
    cleanTitle: function (text) { try { return Sense.cleanTitle(text); } catch (e) { return String(text || ''); } },
    cleanText: function (text) { try { return Sense.cleanPhrase(text); } catch (e) { return String(text || ''); } },
    fixTypos: function (text) { try { return Sense.fixTypos(text); } catch (e) { return String(text || ''); } },
    polishTitle: function (text, signal) { try { return Sense.polish(text, signal); } catch (e) { return Promise.resolve(null); } },
    /* what the chips should be about: the picture's real name, else his cleaned words */
    subjectFor: function (task) {
      if (!task) return null;
      var raw = String(task._text || task.title || '');
      var pt = PicTasks.get(task.id);
      var nm = pt && ((pt.bundle && pt.bundle.name) || (pt.sense && pt.sense.name));
      if (nm) return { subject: nm, query: nm, kind: 'images' };
      var q = raw;
      try { q = Sense.cleanPhrase(raw) || raw; } catch (e) {}
      return { subject: '', query: q, kind: '' };
    },
    viewer: Viewer,
    theme: ThemeReveal,
    selfTest: function () {
      var fails = [];
      if (kindFor('More detail + examples', 'Isko aur detail me samjhao with examples') !== 'detail') fails.push('detail');
      if (kindFor('3-point summary', 'Iska summary 3 bullet points me do') !== 'summary') fails.push('summary');
      if (kindFor("What's my next step?", 'Iske basis par next steps kya honge?') !== 'next') fails.push('next');
      if (kindFor('Get contacts', 'In leads ke decision maker ka phone aur email nikalo') !== 'tool') fails.push('tool');
      if (kindFor('In Hindi', 'Isi message ka Hindi version bana do') !== 'rewrite') fails.push('rewrite');
      if (keywords('sales team ko motivate kaise karu') !== 'sales team motivate') fails.push('keywords → ' + keywords('sales team ko motivate kaise karu'));
      var p = parseDeep('```json\n{"title":"T","tldr":"x","points":[{"title":"a","detail":"b"}],}\n```');
      if (p.title !== 'T' || p.points.length !== 1) fails.push('parse');
      if (cleanQuestion('hello clavis, sales team ko motivate kaise karu?') !== 'Sales team ko motivate kaise karu?') fails.push('title → ' + cleanQuestion('hello clavis, sales team ko motivate kaise karu?'));
      var senseFails = global.ClavisLuxe._senseSelfTest();
      if (senseFails !== 'ok') fails = fails.concat(senseFails);
      return fails.length ? fails : 'ok';
    },
    /* pure checks for the query understanding and title cleaning above */
    _senseSelfTest: function () {
      var fails = [];
      function u(t) { return Sense.understand(t); }
      var lord = u('lord ki photo dikhao');
      if (lord.kind !== 'group' || (lord.group || []).indexOf('Shiva') < 0 || !/Hindu Deities/.test(lord.title)) fails.push('lord → ' + lord.kind + ' / ' + lord.title);
      if (u('bhagwan ki photos').kind !== 'group') fails.push('bhagwan');
      var shiv = u('shiv ji ki photo');
      if (shiv.wiki !== 'Shiva' || shiv.name !== 'Lord Shiva') fails.push('shiv ji → ' + shiv.wiki + ' / ' + shiv.name);
      if (u('lord shiva ki photo dikhao').wiki !== 'Shiva') fails.push('lord shiva');
      if (u('mahadev ki tasveer').wiki !== 'Shiva') fails.push('mahadev');
      if (u('bajrang bali ki photo').wiki !== 'Hanuman') fails.push('bajrang bali');
      if (u('hanuman ji ki photos dikhao').wiki !== 'Hanuman') fails.push('hanuman ji');
      if (u('kanha ki photo').wiki !== 'Krishna') fails.push('kanha');
      if (u('ganpati bappa ki photo').wiki !== 'Ganesha') fails.push('ganpati');
      if (u('ram ji ki photo').wiki !== 'Rama') fails.push('ram ji');
      if (u('mata rani ki photo').wiki !== 'Durga') fails.push('mata rani');
      if (u('durga maa ki photo dikhao').wiki !== 'Durga') fails.push('durga maa');
      if (u('shankar ji ki photo').wiki !== 'Shiva') fails.push('shankar ji');
      /* not deities: a British title, an actor, a king, a car */
      if (u('lord mountbatten ki photo').kind !== 'other') fails.push('lord mountbatten');
      if (u('ram charan ki photo').kind !== 'other') fails.push('ram charan');
      if (u('shivaji maharaj ki photo').kind !== 'other') fails.push('shivaji');
      if (u('govinda ki photo').kind !== 'other') fails.push('govinda');
      var nkb = u('neemaroli baba ki photo dihao');
      if (!/^Neem Karoli Baba/.test(nkb.name) || /dihao|dikhao|photo /i.test(nkb.title)) fails.push('neemaroli → ' + nkb.title);
      var t1 = Sense.cleanTitle('Finding photos · Neemaroli baba ki photo dihao');
      if (t1 !== 'Neem Karoli Baba — Photos') fails.push('cleanTitle photo → ' + t1);
      var t2 = Sense.cleanTitle('Finding photos · Lord ki photo dikhao');
      if (t2 !== 'Hindu Deities — Photos') fails.push('cleanTitle lord → ' + t2);
      if (Sense.cleanTitle('Thinking…') !== 'Thinking…') fails.push('cleanTitle gerund');
      var t3 = Sense.cleanTitle('Thinking · Mujhe neem karoli baba ke baare me btao');
      if (t3 !== 'Thinking · Neem Karoli Baba') fails.push('cleanTitle ask → ' + t3);
      var shivaT = Sense.deity('Shiva').tokens;
      if (Pictures.mentions('Shivaji_Maharaj_portrait.jpg', shivaT)) fails.push('mentions shivaji');
      if (!Pictures.mentions('LordShiva_statue_Murudeshwar.jpg', shivaT)) fails.push('mentions shiva');
      if (Pictures.mentions('Neem_tree_leaves.jpg', ['neem', 'karoli'])) fails.push('mentions neem tree');
      if (!Pictures.mentions('Neem Karoli Baba 1970.jpg', ['neem', 'karoli'])) fails.push('mentions nkb');
      return fails.length ? fails : 'ok';
    }
  };
})(window);
