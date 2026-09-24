const fs = require('fs');
const path = require('path');

const basePath = path.resolve(__dirname, '..');

// 2. Update clavis-aurora.css
const auroraCssPath = path.join(basePath, 'clavis-aurora.css');
let auroraCss = fs.readFileSync(auroraCssPath, 'utf8');
const normAurora = auroraCss.replace(/\r\n/g, '\n');

const oldAuroraSection = `html body .cts-head::before {
  content: "";
  position: absolute;
  left: 50%;
  top: 6px;
  width: 26px;
  height: 3px;
  border-radius: 3px;
  background: var(--au-line);
  transform: translateX(-50%) scaleX(0.4);
  opacity: 0;
  transition: opacity var(--au-t-fast) var(--au-out), transform 280ms var(--au-spring);
  pointer-events: none;
}
html body .cts:hover .cts-head::before,
html body .cts.is-dragging .cts-head::before {
  opacity: 1;
  transform: translateX(-50%) scaleX(1);
}
html body .cts.is-dragging {
  cursor: grabbing;
  transition: box-shadow 200ms var(--au-out) !important;
  box-shadow: var(--au-lift-drag) !important;
  z-index: 10000;
}
html body .cts.is-dragging .cts-head { cursor: grabbing; }
/* The settle after you let go: a real spring, slightly longer
   than the drag lift so the shadow lands after the panel does. */
html body .cts.is-settling {
  transition:
    transform 620ms var(--au-spring),
    left 620ms var(--au-spring),
    top 620ms var(--au-spring),
    box-shadow 420ms var(--au-out) !important;
}`;

const newAuroraSection = `html body .cts-head::before {
  content: "";
  position: absolute;
  left: 50%;
  top: 5px;
  width: 32px;
  height: 3.5px;
  border-radius: 4px;
  background: var(--au-line);
  transform: translateX(-50%) scaleX(0.4);
  opacity: 0;
  transition: opacity var(--au-t-fast) var(--au-out), transform 320ms var(--au-spring), width 320ms var(--au-spring);
  pointer-events: none;
}
html body .cts:hover .cts-head::before {
  opacity: 0.85;
  transform: translateX(-50%) scaleX(1.15);
  background: var(--au-accent);
}
html body .cts-head:hover::before,
html body .cts.is-dragging .cts-head::before {
  opacity: 1;
  transform: translateX(-50%) scaleX(1.4);
  background: var(--au-accent);
}
html body .cts:hover {
  border-color: rgba(201, 100, 66, 0.22) !important;
  box-shadow:
    0 0 0 1px rgba(201, 100, 66, 0.12),
    0 4px 12px -2px rgba(23, 21, 18, 0.08),
    0 16px 36px -8px rgba(23, 21, 18, 0.16),
    0 36px 70px -16px rgba(23, 21, 18, 0.22),
    0 64px 110px -30px rgba(23, 21, 18, 0.18) !important;
}
html[data-theme="dark"] body .cts:hover {
  border-color: rgba(255, 255, 255, 0.14) !important;
  box-shadow:
    0 0 0 1px rgba(255, 255, 255, 0.08),
    0 6px 16px -4px rgba(0, 0, 0, 0.5),
    0 18px 42px -10px rgba(0, 0, 0, 0.65),
    0 40px 80px -18px rgba(0, 0, 0, 0.72),
    0 72px 130px -32px rgba(0, 0, 0, 0.6) !important;
}
html body .cts.is-dragging {
  cursor: grabbing;
  transition: box-shadow 260ms var(--au-out) !important;
  box-shadow: var(--au-lift-drag) !important;
  z-index: 10000;
  will-change: transform !important;
}
html body .cts.is-dragging .cts-head { cursor: grabbing; }
/* The settle after you let go: a real spring, slightly longer
   than the drag lift so the shadow lands after the panel does. */
html body .cts.is-settling {
  transition:
    transform 560ms var(--au-spring),
    box-shadow 420ms var(--au-out),
    border-color 320ms var(--au-out) !important;
}`;

const normOldAuroraSection = oldAuroraSection.replace(/\r\n/g, '\n');
if (normAurora.includes(normOldAuroraSection)) {
  const updatedAurora = normAurora.replace(normOldAuroraSection, newAuroraSection);
  fs.writeFileSync(auroraCssPath, updatedAurora, 'utf8');
  console.log('Successfully updated clavis-aurora.css');
} else {
  console.error('Could not find target section in clavis-aurora.css');
}

// 3. Update clavis-aurora.js
const auroraJsPath = path.join(basePath, 'clavis-aurora.js');
let auroraJs = fs.readFileSync(auroraJsPath, 'utf8');
const normAuroraJs = auroraJs.replace(/\r\n/g, '\n');

const oldAuroraJsDrag = `  var dragRaf = 0;
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
      vx: 0, vy: 0, lastY: e.clientY,
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
      var now = performance.now();
      var dt = Math.max(1, now - drag.lastT);
      var cx = drag.nextClientX;
      var cy = drag.nextClientY;
      drag.vx = (cx - drag.lastX) / dt * 16.7;      // px per frame
      drag.vy = (cy - drag.lastY) / dt * 16.7;
      drag.lastX = cx; drag.lastY = cy; drag.lastT = now;

      var dx = cx - drag.startX;
      var dy = cy - drag.startY;
      if (Math.abs(dx) > 2 || Math.abs(dy) > 2) drag.moved = true;

      place(drag.el, drag.baseL + dx, drag.baseT + dy, drag.bounds);

      /* Tilt into the direction of travel. Small — 2° reads as
         weight, 6° reads as a bug. */
      if (!reducedMotion()) {
        var tilt = clamp(drag.vx * 0.09, -MAX_TILT, MAX_TILT);
        drag.el.style.transform = 'rotate(' + tilt.toFixed(2) + 'deg) scale(1.012)';
      }
    });
    e.stopPropagation();
    e.preventDefault();
  }

  function onPointerUp(e) {
    if (!drag) return;
    if (dragRaf) { cancelAnimationFrame(dragRaf); dragRaf = 0; }
    var el = drag.el;
    var v = { x: drag.vx, y: drag.vy };
    var moved = drag.moved;
    drag = null;

    doc.removeEventListener('pointermove', onPointerMove, true);
    doc.removeEventListener('pointerup', onPointerUp, true);
    doc.removeEventListener('pointercancel', onPointerUp, true);

    el.classList.remove('is-dragging');
    el.style.transform = '';

    if (!moved) return;                       // a click on the header, not a drag

    var b = bounds(el);
    var left = clamp(parseFloat(el.style.left) + v.x * THROW * 16, MARGIN, b.maxL);
    var top = clamp(parseFloat(el.style.top) + v.y * THROW * 16, MARGIN, b.maxT);

    /* Near an edge, the throw becomes a snap. Both edges are
       candidates; the closer one wins, and only if it is close. */
    var dl = left - MARGIN, dr = b.maxL - left;
    if (dl < SNAP && dl <= dr) { left = MARGIN; el.classList.add('is-snapped-left'); }
    else if (dr < SNAP) { left = b.maxL; el.classList.add('is-snapped-right'); }

    if (!reducedMotion()) {
      el.classList.add('is-settling');
      clearTimeout(el._auSettle);
      el._auSettle = setTimeout(function () { el.classList.remove('is-settling'); }, 660);
    }
    place(el, left, top, b);
    savePos(el);

    if (e) { e.stopPropagation(); }
  }`;

const newAuroraJsDrag = `  var dragRaf = 0;

  function rubberband(overshoot, dimension, constant) {
    constant = constant || 0.42;
    return (overshoot * dimension * constant) / (dimension + constant * Math.abs(overshoot));
  }

  function startDragLoop() {
    if (dragRaf) return;
    function loop() {
      if (!drag || !drag.active) {
        dragRaf = 0;
        return;
      }

      // Calculate target with soft rubber-band resistance at boundaries
      var rawLeft = drag.baseL + drag.targetDx;
      var rawTop = drag.baseT + drag.targetDy;
      var clampedL = rawLeft;
      var clampedT = rawTop;

      if (rawLeft < MARGIN) {
        clampedL = MARGIN - rubberband(MARGIN - rawLeft, 180, 0.45);
      } else if (rawLeft > drag.bounds.maxL) {
        clampedL = drag.bounds.maxL + rubberband(rawLeft - drag.bounds.maxL, 180, 0.45);
      }

      if (rawTop < MARGIN) {
        clampedT = MARGIN - rubberband(MARGIN - rawTop, 180, 0.45);
      } else if (rawTop > drag.bounds.maxT) {
        clampedT = drag.bounds.maxT + rubberband(rawTop - drag.bounds.maxT, 180, 0.45);
      }

      var targetDx = clampedL - drag.baseL;
      var targetDy = clampedT - drag.baseT;

      // Pure butter physics: Viscous damping (0.84 blend = ultra-responsive yet silky smooth)
      drag.curDx += (targetDx - drag.curDx) * 0.84;
      drag.curDy += (targetDy - drag.curDy) * 0.84;

      // Velocity-based aerodynamic tilt (horizontal banking + subtle vertical lean)
      var targetTiltX = clamp(drag.vx * 0.12, -MAX_TILT, MAX_TILT);
      drag.curTiltX += (targetTiltX - drag.curTiltX) * 0.22;

      var targetTiltY = clamp(drag.vy * -0.06, -1.8, 1.8);
      drag.curTiltY += (targetTiltY - drag.curTiltY) * 0.22;

      if (!reducedMotion()) {
        drag.el.style.transform =
          'translate3d(' + drag.curDx.toFixed(2) + 'px, ' + drag.curDy.toFixed(2) + 'px, 0) ' +
          'rotate(' + drag.curTiltX.toFixed(2) + 'deg) ' +
          'scale(1.022)';
      } else {
        drag.el.style.transform = 'translate3d(' + drag.curDx.toFixed(2) + 'px, ' + drag.curDy.toFixed(2) + 'px, 0)';
      }

      dragRaf = requestAnimationFrame(loop);
    }
    dragRaf = requestAnimationFrame(loop);
  }

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
      targetDx: 0, targetDy: 0,
      curDx: 0, curDy: 0,
      curTiltX: 0, curTiltY: 0,
      baseL: r.left, baseT: r.top,
      lastX: e.clientX, lastY: e.clientY,
      lastT: performance.now(),
      vx: 0, vy: 0,
      moved: false,
      active: true
    };

    el.classList.remove('is-settling', 'is-snapped-left', 'is-snapped-right');
    el.classList.add('is-dragging');
    el.style.willChange = 'transform';
    place(el, r.left, r.top, b);

    doc.addEventListener('pointermove', onPointerMove, true);
    doc.addEventListener('pointerup', onPointerUp, true);
    doc.addEventListener('pointercancel', onPointerUp, true);

    startDragLoop();

    /* Stop here: the surface's own header listener must not also
       start a drag, or the two fight over left/top. */
    e.stopPropagation();
    e.preventDefault();
  }

  function onPointerMove(e) {
    if (!drag) return;
    var now = performance.now();
    var dt = Math.max(1, now - drag.lastT);
    var cx = e.clientX;
    var cy = e.clientY;

    // Smoothed velocity calculation (exponential moving average for silky throw)
    var instVx = (cx - drag.lastX) / dt * 16.7;
    var instVy = (cy - drag.lastY) / dt * 16.7;
    drag.vx = drag.vx * 0.6 + instVx * 0.4;
    drag.vy = drag.vy * 0.6 + instVy * 0.4;

    drag.lastX = cx;
    drag.lastY = cy;
    drag.lastT = now;

    drag.targetDx = cx - drag.startX;
    drag.targetDy = cy - drag.startY;

    if (Math.abs(drag.targetDx) > 2 || Math.abs(drag.targetDy) > 2) drag.moved = true;

    e.stopPropagation();
    e.preventDefault();
  }

  function onPointerUp(e) {
    if (!drag) return;
    drag.active = false;
    if (dragRaf) { cancelAnimationFrame(dragRaf); dragRaf = 0; }
    var el = drag.el;
    var v = { x: drag.vx, y: drag.vy };
    var moved = drag.moved;
    var curDx = drag.curDx;
    var curDy = drag.curDy;
    var curTiltX = drag.curTiltX;
    var baseL = drag.baseL;
    var baseT = drag.baseT;
    var b = drag.bounds;
    drag = null;

    doc.removeEventListener('pointermove', onPointerMove, true);
    doc.removeEventListener('pointerup', onPointerUp, true);
    doc.removeEventListener('pointercancel', onPointerUp, true);

    el.classList.remove('is-dragging');

    if (!moved) {
      el.style.transform = '';
      el.style.willChange = 'auto';
      return;
    }

    // Momentum throw calculation (Apple fluid interfaces)
    var finalLeft = clamp(baseL + curDx + v.x * THROW * 16, MARGIN, b.maxL);
    var finalTop = clamp(baseT + curDy + v.y * THROW * 16, MARGIN, b.maxT);

    // Edge snapping
    var dl = finalLeft - MARGIN, dr = b.maxL - finalLeft;
    if (dl < SNAP && dl <= dr) { finalLeft = MARGIN; el.classList.add('is-snapped-left'); }
    else if (dr < SNAP) { finalLeft = b.maxL; el.classList.add('is-snapped-right'); }

    // Seamless GPU settle:
    var startRelX = (baseL + curDx) - finalLeft;
    var startRelY = (baseT + curDy) - finalTop;

    place(el, finalLeft, finalTop, b);
    savePos(el);

    if (!reducedMotion() && (Math.abs(startRelX) > 0.5 || Math.abs(startRelY) > 0.5 || Math.abs(curTiltX) > 0.1)) {
      el.style.transition = 'none';
      el.style.transform = 'translate3d(' + startRelX.toFixed(2) + 'px, ' + startRelY.toFixed(2) + 'px, 0) rotate(' + (curTiltX * 0.6).toFixed(2) + 'deg) scale(1.01)';
      void el.offsetHeight; // force reflow
      el.classList.add('is-settling');
      el.style.transition = '';
      el.style.transform = '';
      clearTimeout(el._auSettle);
      el._auSettle = setTimeout(function () {
        el.classList.remove('is-settling');
        el.style.willChange = 'auto';
      }, 580);
    } else {
      el.style.transform = '';
      el.style.willChange = 'auto';
    }

    if (e) { e.stopPropagation(); }
  }`;

const normOldAuroraJsDrag = oldAuroraJsDrag.replace(/\r\n/g, '\n');
if (normAuroraJs.includes(normOldAuroraJsDrag)) {
  const updatedAuroraJs = normAuroraJs.replace(normOldAuroraJsDrag, newAuroraJsDrag);
  fs.writeFileSync(auroraJsPath, updatedAuroraJs, 'utf8');
  console.log('Successfully updated clavis-aurora.js');
} else {
  console.error('Could not find target section in clavis-aurora.js');
}
