/* ============================================================
 * clavis-globe.js · The little earth in the topbar.
 * ------------------------------------------------------------
 * It turns on its own, and when you click it, it GROWS into the map
 * instead of the map just appearing next to it. One continuous object,
 * so the eye never loses track of where the panel came from.
 *
 * The morph is FLIP done with a throwaway clone:
 *   the clone is laid out at the panel's final size, then transformed
 *   DOWN to the globe's box (translate + non-uniform scale, origin 0 0),
 *   then released to identity. Pure compositor work — no width/height,
 *   no layout, no jitter. border-radius rides along 50% -> 18px, and
 *   because the whole box is scaled, 50% reads as a circle at the start.
 *
 * The clone carries no content. The real panel fades in under it at ~62%,
 * which is the moment the shape has stopped being a circle and the eye
 * accepts it as a window.
 * ============================================================ */
(function () {
  'use strict';
  if (window.ClavisGlobe) return;

  var MORPH_MS = 760;      /* slow on purpose — this is the hero motion */
  var BACK_MS  = 420;      /* going home is always quicker than arriving */
  var EASE     = 'cubic-bezier(.16, 1, .3, 1)';

  var btn = null;

  function reduced() {
    try { return matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (_) { return false; }
  }
  function C() { return window.ClavisCanvas || null; }

  /* ---------- mount ---------- */

  function build() {
    var b = document.createElement('button');
    b.type = 'button';
    b.className = 'rf-globe-btn';
    b.id = 'rf-globe-btn';
    b.title = 'Map (M)';
    b.setAttribute('aria-label', 'Open the map');
    b.innerHTML = '<span class="rf-globe" aria-hidden="true"></span>';
    b.addEventListener('click', onClick);
    return b;
  }

  function mount() {
    if (document.getElementById('rf-globe-btn')) return true;
    /* sit just left of History — same cluster as the other display tools */
    var anchor = document.querySelector('.tb-history-btn')
              || document.querySelector('.tb-shortcuts-btn')
              || document.querySelector('.tb-sneak-peek-btn');
    if (!anchor || !anchor.parentNode) return false;
    btn = build();
    anchor.parentNode.insertBefore(btn, anchor);
    syncState();
    return true;
  }

  function syncState() {
    if (!btn) return;
    var live = false;
    try { live = !!(C() && C().mapOpen && C().mapOpen()); } catch (_) {}
    btn.classList.toggle('is-live', live);
    btn.setAttribute('aria-label', live ? 'Close the map' : 'Open the map');
  }

  /* ---------- the morph ---------- */

  function globeRect() {
    var g = btn && btn.querySelector('.rf-globe');
    return g ? g.getBoundingClientRect() : null;
  }
  function panelEl() {
    /* the map window is the .ccv that is currently open and holding a map */
    var all = document.querySelectorAll('.ccv.is-open');
    for (var i = 0; i < all.length; i++) {
      if (all[i].querySelector('.ccv-map, .ccv-map-gl')) return all[i];
    }
    return all.length ? all[all.length - 1] : null;
  }

  function flyOut(from, to) {
    /* clone is BORN at the panel's box, then squeezed back onto the globe
       and let go. Doing it this way means the end state is transform:none,
       so there is no sub-pixel drift when the animation finishes. */
    var c = document.createElement('div');
    c.className = 'rf-morph';
    c.style.left = to.left + 'px';
    c.style.top = to.top + 'px';
    c.style.width = to.width + 'px';
    c.style.height = to.height + 'px';
    c.style.transformOrigin = '0 0';
    document.body.appendChild(c);

    var sx = from.width / to.width, sy = from.height / to.height;
    var dx = from.left - to.left,   dy = from.top - to.top;

    var a = c.animate([
      { transform: 'translate(' + dx + 'px,' + dy + 'px) scale(' + sx + ',' + sy + ')',
        borderRadius: '50%', opacity: 1 },
      { offset: .62,
        transform: 'translate(' + (dx * .12) + 'px,' + (dy * .12) + 'px) scale(' + (sx + (1 - sx) * .88) + ',' + (sy + (1 - sy) * .88) + ')',
        borderRadius: '26px', opacity: .9 },
      { transform: 'none', borderRadius: '18px', opacity: 0 },
    ], { duration: MORPH_MS, easing: EASE, fill: 'forwards' });

    a.finished.catch(function () {}).then(function () { c.remove(); });
    return c;
  }

  function flyBack(from) {
    var g = globeRect();
    if (!g || reduced()) return;
    var c = document.createElement('div');
    c.className = 'rf-morph';
    c.style.left = from.left + 'px';
    c.style.top = from.top + 'px';
    c.style.width = from.width + 'px';
    c.style.height = from.height + 'px';
    c.style.transformOrigin = '0 0';
    document.body.appendChild(c);

    var sx = g.width / from.width, sy = g.height / from.height;
    var dx = g.left - from.left,   dy = g.top - from.top;

    c.animate([
      { transform: 'none', borderRadius: '18px', opacity: .85 },
      { transform: 'translate(' + dx + 'px,' + dy + 'px) scale(' + sx + ',' + sy + ')',
        borderRadius: '50%', opacity: 0 },
    ], { duration: BACK_MS, easing: 'cubic-bezier(.4,0,1,1)', fill: 'forwards' })
      .finished.catch(function () {}).then(function () { c.remove(); });
  }

  /* Open the map as a morph out of the globe.
     `place` may be omitted — a bare click means "where am I". */
  function morphOpen(place) {
    if (window.RudraMotionUI) {
      var display = C();
      if (!display) return Promise.resolve({ error: 'Display not loaded.' });
      var result = place ? display.showMap(typeof place === 'string' ? { place: place } : place)
        : display.locateMe ? display.locateMe({}) : display.showMap({ place: defaultCity() });
      Promise.resolve(result).then(syncState, syncState); return Promise.resolve(result);
    }
    var from = globeRect();
    var canvas = C();
    if (!canvas) return Promise.resolve({ error: 'Display not loaded.' });

    /* tell clavis-canvas to skip its own slide-in; the clone is the
       entrance this time and two entrances at once look broken */
    if (from && !reduced()) window.__RF_MORPH = true;

    var job = place
      ? canvas.showMap(typeof place === 'string' ? { place: place } : place)
      : (canvas.locateMe ? canvas.locateMe({}) : canvas.showMap({ place: defaultCity() }));

    /* run the clone as soon as the panel has a box, without waiting for
       tiles or geocoding — the motion must start on the click, not after
       a network round-trip */
    requestAnimationFrame(function () {
      requestAnimationFrame(function () {
        var p = panelEl();
        window.__RF_MORPH = false;
        if (!from || !p || reduced()) { if (p) p.style.opacity = ''; syncState(); return; }
        var to = p.getBoundingClientRect();
        if (!to.width || !to.height) { p.style.opacity = ''; syncState(); return; }

        flyOut(from, to);
        /* panel surfaces under the clone once the circle has become a box */
        p.style.opacity = '0';
        p.animate([{ opacity: 0 }, { opacity: 0 }, { opacity: 1 }],
          { duration: MORPH_MS, easing: 'linear', fill: 'forwards' })
          .finished.catch(function () {}).then(function () { p.style.opacity = ''; });
        syncState();
      });
    });

    Promise.resolve(job).catch(function () {}).then(function () {
      window.__RF_MORPH = false;
      syncState();
    });
    return Promise.resolve(job);
  }

  function morphClose() {
    if (window.RudraMotionUI) { C()?.hideMap?.(); setTimeout(syncState, 540); return; }
    var p = panelEl();
    var from = p ? p.getBoundingClientRect() : null;
    try { if (C() && C().hideMap) C().hideMap(); } catch (_) {}
    if (from) flyBack(from);
    setTimeout(syncState, 60);
  }

  function defaultCity() {
    try { return (window.SKYLARK_CONFIG && window.SKYLARK_CONFIG.DEFAULT_CITY) || 'Gurugram'; }
    catch (_) { return 'Gurugram'; }
  }

  function onClick(e) {
    e.preventDefault();
    e.stopPropagation();
    var open = false;
    try { open = !!(C() && C().mapOpen && C().mapOpen()); } catch (_) {}
    if (open) morphClose(); else morphOpen();
  }

  /* ---------- wiring ---------- */

  function ready() {
    if (!mount()) {
      /* the topbar is built by app.js after us on a cold boot */
      var tries = 0;
      var t = setInterval(function () {
        if (mount() || ++tries > 40) clearInterval(t);
      }, 250);
    }
    /* keep the lit state honest no matter who opened or closed the map */
    document.addEventListener('clavis:canvas', syncState);
    window.addEventListener('focus', syncState);
    setInterval(syncState, 1200);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', ready);
  else ready();

  /* M toggles the map, unless the caret is in something typeable */
  document.addEventListener('keydown', function (e) {
    if (e.key !== 'm' && e.key !== 'M') return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    var t = e.target;
    if (t && (t.isContentEditable || /^(input|textarea|select)$/i.test(t.tagName))) return;
    e.preventDefault();
    onClick(e);
  });

  window.ClavisGlobe = {
    open: morphOpen,
    close: morphClose,
    toggle: onClick,
    sync: syncState,
    el: function () { return btn; },
  };
})();
