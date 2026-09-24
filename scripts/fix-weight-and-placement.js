const fs = require('fs');
const path = require('path');

const basePath = path.resolve(__dirname, '..');

// 1. Update clavis-aurora.js
const auroraJsPath = path.join(basePath, 'clavis-aurora.js');
let auroraJs = fs.readFileSync(auroraJsPath, 'utf8').replace(/\r\n/g, '\n');

// Find the section between "var dragRaf = 0;" and "function onKeyDown(e)"
const dragSectionRegex = /var dragRaf = 0;[\s\S]*?(?=function onKeyDown\(e\))/;

const newDragSection = `var dragRaf = 0;

  function onPointerDown(e) {
    var el = surfaceEl();
    if (!el || !el.classList.contains('is-open')) return;
    if (e.button !== 0 || !e.target || !e.target.closest) return;

    var onHead = e.target.closest('.cts-head');
    var anywhere = e.shiftKey && el.contains(e.target);     // shift-drag from anywhere
    if ((!onHead || !el.contains(onHead)) && !anywhere) return;
    if (e.target.closest('button, a, input, select, textarea')) return;

    var r = el.getBoundingClientRect();
    var b = bounds(el);
    drag = {
      el: el,
      bounds: b,
      startX: e.clientX, startY: e.clientY,
      nextClientX: e.clientX, nextClientY: e.clientY,
      baseL: r.left, baseT: r.top,
      lastX: e.clientX, lastT: performance.now(),
      vx: 0,
      moved: false
    };

    el.classList.remove('is-settling', 'is-snapped-left', 'is-snapped-right');
    el.classList.add('is-dragging');
    place(el, r.left, r.top, b);

    doc.addEventListener('pointermove', onPointerMove, true);
    doc.addEventListener('pointerup', onPointerUp, true);
    doc.addEventListener('pointercancel', onPointerUp, true);

    /* Stop here: the surface's own header listener must not also
       start a drag, or the two fight over left/top. */
    e.stopPropagation();
    e.preventDefault();
  }

  function onPointerMove(e) {
    if (!drag) return;
    drag.nextClientX = e.clientX;
    drag.nextClientY = e.clientY;
    if (dragRaf) {
      e.stopPropagation();
      e.preventDefault();
      return;
    }
    dragRaf = requestAnimationFrame(function () {
      dragRaf = 0;
      if (!drag) return;
      var cx = drag.nextClientX;
      var cy = drag.nextClientY;
      var dx = cx - drag.startX;
      var dy = cy - drag.startY;
      if (Math.abs(dx) > 2 || Math.abs(dy) > 2) drag.moved = true;

      // 1:1 direct tracking: solid physical weight, no loose rubber lag
      place(drag.el, drag.baseL + dx, drag.baseT + dy, drag.bounds);

      // Emil Apple Weight: subtle 0.8° inertia tilt conveys mass, not lightness
      if (!reducedMotion()) {
        var now = performance.now();
        var dt = Math.max(1, now - drag.lastT);
        var vx = (cx - drag.lastX) / dt * 16.7;
        drag.lastX = cx; drag.lastT = now;
        var tilt = clamp(vx * 0.035, -0.8, 0.8);
        drag.el.style.transform = 'rotate(' + tilt.toFixed(2) + 'deg)';
      }
    });
    e.stopPropagation();
    e.preventDefault();
  }

  function onPointerUp(e) {
    if (!drag) return;
    if (dragRaf) { cancelAnimationFrame(dragRaf); dragRaf = 0; }
    var el = drag.el;
    var moved = drag.moved;
    var cx = (e && typeof e.clientX === 'number') ? e.clientX : drag.nextClientX;
    var cy = (e && typeof e.clientY === 'number') ? e.clientY : drag.nextClientY;
    var b = drag.bounds;
    var baseL = drag.baseL;
    var baseT = drag.baseT;
    var startX = drag.startX;
    var startY = drag.startY;
    drag = null;

    doc.removeEventListener('pointermove', onPointerMove, true);
    doc.removeEventListener('pointerup', onPointerUp, true);
    doc.removeEventListener('pointercancel', onPointerUp, true);

    el.classList.remove('is-dragging');
    el.style.transform = '';

    if (!moved) return;

    // Exactly where released: "jha roku vhi ruk jaye jase phle hota tha" - zero drift or jumping
    var finalLeft = clamp(baseL + (cx - startX), MARGIN, b.maxL);
    var finalTop = clamp(baseT + (cy - startY), MARGIN, b.maxT);
    place(el, finalLeft, finalTop, b);
    savePos(el);

    if (e) { e.stopPropagation(); }
  }

  `;

if (dragSectionRegex.test(auroraJs)) {
  auroraJs = auroraJs.replace(dragSectionRegex, newDragSection);
  fs.writeFileSync(auroraJsPath, auroraJs, 'utf8');
  console.log('Successfully updated clavis-aurora.js with zero-drift placement and physical weight');
} else {
  console.error('Could not find drag section in clavis-aurora.js');
}

// 2. Update clavis-luxe.css
const luxeCssPath = path.join(basePath, 'clavis-luxe.css');
let luxeCss = fs.readFileSync(luxeCssPath, 'utf8').replace(/\r\n/g, '\n');

const luxeWindowRegex = /\/\* ── 8 · Floating window ──[\s\S]*?(?=html:not\(#_\):not\(#_\) body:not\(#_\):not\(#_\) \.cts \.cts-head-label)/;

const newLuxeWindowSection = `/* ── 8 · Floating window ────────────────────────────────────── */
html:not(#_):not(#_) body:not(#_):not(#_) .cts {
  --cts-panel: var(--lxe-raised);
  background: var(--lxe-raised) !important;
  border: 1px solid var(--lxe-line) !important;
  border-radius: 18px !important;
  box-shadow: var(--lxe-shadow-float), var(--lxe-highlight) !important;
  color: var(--lxe-ink);
  transition:
    opacity 280ms var(--lxe-out),
    transform 320ms cubic-bezier(0.16, 1, 0.3, 1),
    height 400ms cubic-bezier(0.16, 1, 0.3, 1),
    width 400ms cubic-bezier(0.16, 1, 0.3, 1),
    box-shadow 380ms cubic-bezier(0.16, 1, 0.3, 1),
    border-color 300ms cubic-bezier(0.16, 1, 0.3, 1) !important;
}
/* Silky smooth hover elevation bloom & subtle highlight */
html:not(#_):not(#_) body:not(#_):not(#_) .cts:hover {
  border-color: rgba(166, 58, 91, 0.24) !important;
  box-shadow:
    0 0 0 1px rgba(166, 58, 91, 0.16),
    0 4px 14px -2px rgba(56, 25, 50, 0.08),
    0 16px 36px -8px rgba(56, 25, 50, 0.14),
    0 38px 72px -16px rgba(56, 25, 50, 0.18),
    0 72px 130px -36px rgba(56, 25, 50, 0.15),
    var(--lxe-highlight) !important;
}
html[data-theme="dark"]:not(#_):not(#_) body:not(#_):not(#_) .cts:hover {
  border-color: rgba(239, 179, 140, 0.24) !important;
  box-shadow:
    0 0 0 1px rgba(239, 179, 140, 0.2),
    0 6px 18px -4px rgba(0, 0, 0, 0.6),
    0 22px 48px -10px rgba(0, 0, 0, 0.72),
    0 50px 96px -20px rgba(0, 0, 0, 0.8),
    0 96px 160px -40px rgba(0, 0, 0, 0.68),
    var(--lxe-highlight) !important;
}
/* Grounded physical weight when dragging */
html:not(#_):not(#_) body:not(#_):not(#_) .cts.is-dragging {
  cursor: grabbing !important;
  z-index: 10000 !important;
  border-color: rgba(166, 58, 91, 0.35) !important;
  transition: box-shadow 200ms var(--lxe-out), border-color 200ms var(--lxe-out) !important;
  box-shadow:
    0 0 0 1px rgba(166, 58, 91, 0.25),
    0 6px 16px -2px rgba(56, 25, 50, 0.15),
    0 22px 48px -8px rgba(56, 25, 50, 0.24),
    0 48px 90px -18px rgba(56, 25, 50, 0.3),
    0 80px 140px -32px rgba(56, 25, 50, 0.22),
    var(--lxe-highlight) !important;
}
html[data-theme="dark"]:not(#_):not(#_) body:not(#_):not(#_) .cts.is-dragging {
  border-color: rgba(239, 179, 140, 0.35) !important;
  box-shadow:
    0 0 0 1px rgba(239, 179, 140, 0.25),
    0 8px 20px -4px rgba(0, 0, 0, 0.65),
    0 26px 56px -10px rgba(0, 0, 0, 0.8),
    0 56px 110px -20px rgba(0, 0, 0, 0.85),
    0 100px 170px -40px rgba(0, 0, 0, 0.75),
    var(--lxe-highlight) !important;
}
html[data-theme="dark"]:not(#_):not(#_) body:not(#_):not(#_) .cts {
  background: linear-gradient(180deg, #211A21 0%, #1B151B 100%) !important;
}
html:not(#_):not(#_) body:not(#_):not(#_) .cts .cts-head {
  position: relative !important;
  min-height: 42px;
  padding: 9px 8px 9px 14px !important;
  border-bottom: 1px solid var(--lxe-line-2) !important;
  cursor: grab !important;
  touch-action: none !important;
  transition: background 300ms cubic-bezier(0.16, 1, 0.3, 1) !important;
}
html:not(#_):not(#_) body:not(#_):not(#_) .cts:hover .cts-head {
  background: linear-gradient(180deg, rgba(255, 255, 255, 0.04) 0%, transparent 100%) !important;
}
html:not(#_):not(#_) body:not(#_):not(#_) .cts.is-dragging .cts-head {
  cursor: grabbing !important;
}
html:not(#_):not(#_) body:not(#_):not(#_) .cts-head::before {
  content: "";
  position: absolute;
  left: 50%;
  top: 5px;
  width: 32px;
  height: 3.5px;
  border-radius: 4px;
  background: var(--lxe-line);
  transform: translateX(-50%) scaleX(0.4);
  opacity: 0;
  transition:
    opacity 280ms cubic-bezier(0.16, 1, 0.3, 1),
    transform 360ms cubic-bezier(0.16, 1, 0.3, 1),
    background-color 280ms cubic-bezier(0.16, 1, 0.3, 1);
  pointer-events: none;
}
html:not(#_):not(#_) body:not(#_):not(#_) .cts:hover .cts-head::before {
  opacity: 0.85;
  transform: translateX(-50%) scaleX(1.15);
  background: var(--lxe-accent) !important;
}
html:not(#_):not(#_) body:not(#_):not(#_) .cts-head:hover::before {
  opacity: 1;
  transform: translateX(-50%) scaleX(1.35);
  background: var(--lxe-accent) !important;
}
html:not(#_):not(#_) body:not(#_):not(#_) .cts.is-dragging .cts-head::before {
  opacity: 1;
  transform: translateX(-50%) scaleX(1.4);
  background: var(--lxe-accent) !important;
}
`;

if (luxeWindowRegex.test(luxeCss)) {
  luxeCss = luxeCss.replace(luxeWindowRegex, newLuxeWindowSection);
  fs.writeFileSync(luxeCssPath, luxeCss, 'utf8');
  console.log('Successfully updated clavis-luxe.css with refined hover and weighted drag');
} else {
  console.error('Could not find floating window section in clavis-luxe.css');
}
