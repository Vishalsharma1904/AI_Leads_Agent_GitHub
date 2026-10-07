const assert = require('node:assert/strict');
const fs = require('node:fs'), vm = require('node:vm');
let now = 0, next = 0, top = 0, boundsReads = 0, topReads = 0, rangeReads = 0;
const frames = new Map(), navEvents = new Map(), railEvents = new Map(), docEvents = new Map(), windowEvents = new Map();
const classes = new Set();
const rail = { classList: { contains: name => classes.has(name) }, addEventListener: (name, fn) => railEvents.set(name, fn) };
const nav = { dataset: {}, get clientHeight() { rangeReads++; return 600; }, get scrollHeight() { rangeReads++; return 2000; },
  get scrollTop() { topReads++; return top; }, set scrollTop(v) { top = Math.round(v); },
  getBoundingClientRect() { boundsReads++; return { top: 0, height: 600 }; },
  contains(target) { return target === nav; },
  addEventListener(name, fn) { navEvents.set(name, fn); }
};
const document = { readyState: 'complete', hidden: false, documentElement: { dataset: {} }, getElementById: id => id === 'sidebar' ? rail : nav, addEventListener: (name, fn) => docEvents.set(name, fn) };
const context = { document, window: { addEventListener: (name, fn) => windowEvents.set(name, fn) }, performance: { now: () => now }, matchMedia: () => ({ matches: false, addEventListener() {} }), MutationObserver: class { observe() {} }, requestAnimationFrame: fn => { frames.set(++next, fn); return next; }, cancelAnimationFrame: id => frames.delete(id) };
const source = fs.readFileSync('sidebar-hover-scroll.js', 'utf8');
vm.runInNewContext(source, context); vm.runInNewContext(source, context);
navEvents.get('pointermove')({ pointerType: 'mouse', clientY: 598 });
for (let i = 0; i < 180; i++) {
  assert.equal(frames.size, 1, 'Exactly one scroll loop survives quantized subpixel frames');
  const [id, frame] = frames.entries().next().value; frames.delete(id); now += 1000 / 60; frame(now);
}
assert.ok(top > 250, 'Fractional movement accumulates instead of stopping at the first rounded zero');
assert.equal(boundsReads, 1, 'Stable geometry is cached');
assert.equal(rangeReads, 2, 'Stable scroll range is read once instead of every frame');
navEvents.get('wheel')(); assert.equal(frames.size, 0);
const idleReads = topReads;
docEvents.get('keydown')();docEvents.get('keydown')();
assert.equal(topReads, idleReads, 'Typing does not force idle sidebar layout');
now += 100; navEvents.get('pointermove')({ pointerType: 'mouse', clientY: 598 }); assert.equal(frames.size, 0);
now += 800; navEvents.get('pointermove')({ pointerType: 'mouse', clientY: 598 }); assert.equal(frames.size, 1);
document.hidden = true; docEvents.get('visibilitychange')(); assert.equal(frames.size, 0);
document.hidden = false; navEvents.get('pointermove')({ pointerType: 'mouse', clientY: 598 }); navEvents.get('pointerleave')(); assert.equal(frames.size, 0);
let prevented = false, wheelStart = top;
railEvents.get('wheel')({ target: rail, deltaY: 100, preventDefault() { prevented = true; } });
assert.ok(prevented); assert.equal(frames.size, 1);
for (let i = 0; i < 50 && frames.size; i++) { const [id, frame] = frames.entries().next().value; frames.delete(id); now += 1000 / 60; frame(now); }
assert.ok(top > wheelStart); assert.equal(frames.size, 0, 'Header wheel momentum settles');
document.documentElement.dataset.motion = 'off';
railEvents.get('wheel')({ target: rail, deltaY: 20, preventDefault() {} });
assert.equal(frames.size, 0); assert.ok(top > wheelStart);
console.log('Sidebar: fractional scroll, single edge/wheel loop, cached geometry, motion settings and lifecycle cleanup passed.');
