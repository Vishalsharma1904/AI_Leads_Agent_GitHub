/**
 * Nexus AI motion scroll engine.
 *
 * Wheel scrolling is handled by one compositor-friendly RAF per surface. CSS
 * \`scroll-behavior: smooth\` is intentionally not used for wheel input: it
 * restarts a new animation for every wheel tick and makes the UI feel slow or
 * jittery. Native keyboard, touch and programmatic scrolling remain intact.
 */
(function () {
  'use strict';

  var SELECTORS = [
    '#main-scroll-area',
    '#settings-modal-content',
    '.smodal-nav'
  ];
  var states = [];
  var reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function normaliseDelta(event, element) {
    if (event.deltaMode === 1) return event.deltaY * 24;
    if (event.deltaMode === 2) return event.deltaY * element.clientHeight;
    return event.deltaY;
  }

  function isScrollable(element) {
    if (!element || element === document.body || element === document.documentElement) return false;
    return element.scrollHeight > element.clientHeight + 1;
  }

  /* Let a nested table/list keep its own native scroll when the pointer is
     actually over it. This prevents the main page from stealing that gesture. */
  function nestedScrollableTarget(target, root) {
    var node = target && target.nodeType === 1 ? target : target && target.parentElement;
    while (node && node !== root) {
      if (isScrollable(node)) {
        var style = window.getComputedStyle(node);
        var overflow = style.overflowY;
        if (overflow === 'auto' || overflow === 'scroll' || overflow === 'overlay') return node;
      }
      node = node.parentElement;
    }
    return null;
  }

  function attach(element) {
    if (!element || element.dataset.motionScrollReady === 'true') return;
    element.dataset.motionScrollReady = 'true';
    element.style.scrollBehavior = 'auto';

    var state = {
      element: element,
      current: element.scrollTop,
      target: element.scrollTop,
      frame: 0,
      lastTime: 0,
      internalWriteUntil: 0
    };
    states.push(state);

    function stop() {
      state.frame = 0;
      state.lastTime = 0;
    }

    function tick(now) {
      state.frame = 0;
      if (reduceMotion.matches || document.documentElement.dataset.motion === 'off') {
        state.target = state.current = element.scrollTop;
        stop();
        return;
      }

      var dt = state.lastTime ? Math.min((now - state.lastTime) / 1000, 0.034) : 0.016;
      state.lastTime = now;
      var max = Math.max(0, element.scrollHeight - element.clientHeight);
      state.target = clamp(state.target, 0, max);
      var blend = 1 - Math.exp(-24 * dt);
      state.current += (state.target - state.current) * blend;
      if (Math.abs(state.target - state.current) < 0.35) state.current = state.target;

      state.internalWriteUntil = performance.now() + 80;
      element.scrollTop = state.current;
      if (Math.abs(state.target - state.current) > 0.35) {
        state.frame = requestAnimationFrame(tick);
      } else {
        stop();
      }
    }

    function request() {
      if (!state.frame) state.frame = requestAnimationFrame(tick);
    }

    element.addEventListener('wheel', function (event) {
      if (reduceMotion.matches || document.documentElement.dataset.motion === 'off') return;
      if (nestedScrollableTarget(event.target, element)) return;

      var max = Math.max(0, element.scrollHeight - element.clientHeight);
      if (!max) return;

      event.preventDefault();
      var livePosition = element.scrollTop;
      if (!state.frame || Math.abs(livePosition - state.current) > 2) {
        state.current = livePosition;
        state.target = livePosition;
      }

      var delta = normaliseDelta(event, element);
      /* A small cap prevents an accidental high-resolution wheel spike from
         launching the panel several screens away. */
      state.target = clamp(state.target + clamp(delta, -240, 240), 0, max);
      request();
    }, { passive: false });

    element.addEventListener('scroll', function () {
      if (performance.now() > state.internalWriteUntil && !state.frame) {
        state.current = state.target = element.scrollTop;
      }
    }, { passive: true });

    if (reduceMotion.addEventListener) {
      reduceMotion.addEventListener('change', function () {
        state.current = state.target = element.scrollTop;
        stop();
      });
    }
  }

  function scan() {
    SELECTORS.forEach(function (selector) {
      document.querySelectorAll(selector).forEach(attach);
    });
  }

  function init() {
    scan();
    new MutationObserver(scan).observe(document.body, { childList: true, subtree: true });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }

  window.NexusMotionScroll = { scan: scan };
})();
