/* clavis-refine.js — make the sneak-peek pipeline window draggable.
   Drag by its header bar; position is remembered per browser and
   re-clamped into view on resize. Buttons in the header still click. */
(function () {
  'use strict';

  var KEY = 'clavis-peek-pos';
  var MARGIN = 8;

  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

  function place(win, left, top) {
    var r = win.getBoundingClientRect();
    win.classList.add('csp-dragged');
    win.style.left = clamp(left, MARGIN, Math.max(MARGIN, innerWidth - r.width - MARGIN)) + 'px';
    win.style.top = clamp(top, MARGIN, Math.max(MARGIN, innerHeight - r.height - MARGIN)) + 'px';
  }

  function restore(win) {
    var saved;
    try { saved = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch (e) { saved = null; }
    if (saved && typeof saved.left === 'number' && typeof saved.top === 'number') place(win, saved.left, saved.top);
  }

  function attach(win) {
    if (win.dataset.cspDrag) return;
    win.dataset.cspDrag = '1';

    var bar = win.querySelector('.csp-header-bar');
    if (!bar) return;

    var startX = 0, startY = 0, baseLeft = 0, baseTop = 0, dragging = false;

    bar.addEventListener('pointerdown', function (e) {
      if (e.button !== 0 || e.target.closest('button, a, input, select')) return;
      var r = win.getBoundingClientRect();
      dragging = true;
      startX = e.clientX; startY = e.clientY;
      baseLeft = r.left; baseTop = r.top;
      win.classList.add('csp-dragging');
      place(win, baseLeft, baseTop); // pin to left/top before the first move
      bar.setPointerCapture(e.pointerId);
      e.preventDefault();
    });

    bar.addEventListener('pointermove', function (e) {
      if (!dragging) return;
      place(win, baseLeft + (e.clientX - startX), baseTop + (e.clientY - startY));
    });

    function end(e) {
      if (!dragging) return;
      dragging = false;
      win.classList.remove('csp-dragging');
      try { bar.releasePointerCapture(e.pointerId); } catch (err) { /* already released */ }
      try {
        localStorage.setItem(KEY, JSON.stringify({ left: parseFloat(win.style.left), top: parseFloat(win.style.top) }));
      } catch (err) { /* private mode: position just won't persist */ }
    }
    bar.addEventListener('pointerup', end);
    bar.addEventListener('pointercancel', end);

    bar.addEventListener('dblclick', function () {   // snap back to the anchor
      win.classList.remove('csp-dragged');
      win.style.left = win.style.top = '';
      try { localStorage.removeItem(KEY); } catch (err) { /* ignore */ }
    });

    addEventListener('resize', function () {
      if (!win.classList.contains('csp-dragged')) return;
      place(win, parseFloat(win.style.left) || 0, parseFloat(win.style.top) || 0);
    });

    restore(win);
  }

  // The window is built lazily by clavis-sneak-peek.js, so watch for it.
  function scan() {
    var win = document.getElementById('clavis-sneak-peek-window');
    if (win) attach(win);
    return !!win;
  }

  if (!scan()) {
    var mo = new MutationObserver(function () { if (scan()) mo.disconnect(); });
    mo.observe(document.body, { childList: true });
  }

  // ── self-check: `ClavisPeekDrag.demo()` in the console ──
  window.ClavisPeekDrag = {
    demo: function () {
      var win = document.getElementById('clavis-sneak-peek-window');
      if (!win) throw new Error('peek window not built yet — open it first');
      place(win, -9999, -9999);
      console.assert(parseFloat(win.style.left) === MARGIN, 'left clamped to margin');
      console.assert(parseFloat(win.style.top) === MARGIN, 'top clamped to margin');
      place(win, 99999, 99999);
      var r = win.getBoundingClientRect();
      console.assert(Math.round(r.right) <= innerWidth - MARGIN + 1, 'stays inside right edge');
      console.assert(Math.round(r.bottom) <= innerHeight - MARGIN + 1, 'stays inside bottom edge');
      win.classList.remove('csp-dragged');
      win.style.left = win.style.top = '';
      return 'ok';
    }
  };
})();
