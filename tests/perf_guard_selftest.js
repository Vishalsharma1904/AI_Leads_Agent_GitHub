/* The three frame-eaters this guard exists for. Run: node tests/perf_guard_selftest.js */
const fs = require('fs');
const assert = require('assert');
const read = (f) => fs.readFileSync(__dirname + '/../' + f, 'utf8');

const perf = read('clavis-perf.js');
const surface = read('clavis-task-surface.js');
assert(/content-visibility:\s*auto/.test(perf), 'old offscreen messages must skip paint without removing searchable text');

// 1. Hidden views must not keep ~120 infinite keyframes running.
assert(/\.view:not\(\.active\)[\s\S]{0,200}animation-play-state:\s*paused/.test(perf),
  'hidden views are not pausing their animations');

// 2. Blur must stand down while something is moving — it is the per-frame cost.
assert(/\.cts\.is-dragging[\s\S]{0,260}backdrop-filter:\s*none/.test(perf),
  'backdrop-filter still active during drag');
assert(/#sidebar\.is-animating/.test(perf), 'sidebar transition not covered');

// 3. The class the CSS waits for has to actually be applied by something.
assert(/transitionstart/.test(perf) && /is-animating/.test(perf),
  'nothing sets #sidebar.is-animating');

// 4. The orb idles at a lower rate; speaking/listening stay at 60.
const fps = perf.match(/__clavisOrbFps\s*=\s*\{([^}]*)\}/);
assert(fps, '__clavisOrbFps is not an object (null = uncapped)');
assert(/idle/.test(fps[1]) && /active:\s*60/.test(fps[1]), 'idle cap or active rate wrong: ' + fps[1]);

// 5. Drag follows the pointer 1:1 — easing here reads as dropped frames.
const ease = surface.match(/var dragEase = ([^;]+);/);
assert(ease, 'dragEase not found');
assert(ease[1].trim() === '1', 'drag is still eased: ' + ease[1]);

console.log('PASS — 5 checks');
