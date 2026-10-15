'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const listeners = {}, mediaListeners = {}, screenListeners = {}, motionListeners = {};
const motion = { matches: false, addEventListener: (key, fn) => motionListeners[key] = fn };
let observer, plays = 0;
const video = { muted: true, controls: true, paused: true,
  addEventListener: (key, fn) => mediaListeners[key] = fn,
  pause() { this.paused = true; },
  play() { plays++; if (!this.muted) return Promise.reject({ name: 'NotAllowedError' }); this.paused = false; return Promise.resolve(); }
};
let screenHidden = false, checking = true, revealObserver;
const screen = { classList: { contains: name => name === 'is-checking' ? checking : screenHidden }, addEventListener: (key, fn) => screenListeners[key] = fn };
const document = { hidden: false, getElementById: id => id === 'rl-film-video' ? video : screen,
  addEventListener: (key, fn) => listeners[key] = fn };
const Observer = class { constructor(fn) { observer = fn; } observe() {} };
const source = fs.readFileSync('auth-antigravity.js', 'utf8').split('// Login film:')[1];
vm.runInNewContext(source.slice(source.indexOf('(function')), {
  window: { matchMedia: () => motion, IntersectionObserver: Observer, addEventListener: (key, fn) => listeners[key] = fn },
  document, IntersectionObserver: Observer, matchMedia: () => motion
  , MutationObserver: class { constructor(fn) { revealObserver = fn; } observe() {} }
});
(async () => {
  observer([{ isIntersecting: true }]);
  assert.equal(plays, 0, 'The hidden splash must not start a large video download or narration');
  checking = false; revealObserver();
  await Promise.resolve(); await Promise.resolve();
  assert.equal(video.controls, false);
  assert.equal(video.volume, 0.18);
  assert.equal(video.paused, false, 'Blocked sound must fall back to continuing muted playback');
  assert.equal(plays, 2);
  video.play = function () { this.paused = false; return Promise.resolve(); };
  screenListeners.pointerdown({ isTrusted: true });
  assert.equal(video.muted, false, 'Trusted interaction enables quiet narration');
  document.hidden = true; listeners.visibilitychange();
  assert.equal(video.paused, true); assert.equal(video.muted, true);
  document.hidden = false; motion.matches = true; motionListeners.change();
  assert.equal(video.paused, true, 'Reduced motion stops automatic playback');
  let rejectOld;
  motion.matches = false;
  video.play = function () { this.paused = false; return new Promise((resolve, reject) => rejectOld = reject); };
  observer([{ isIntersecting: true }]);
  motion.matches = true; motionListeners.change();
  rejectOld({ name: 'NotAllowedError' }); await Promise.resolve();
  assert.equal(video.paused, true, 'Late autoplay rejection must not restart reduced-motion playback');
  motion.matches = false;
  observer([{ isIntersecting: true }]);
  const rejectBeforeGesture = rejectOld;
  video.play = function () { this.paused = false; return Promise.resolve(); };
  screenListeners.pointerdown({ isTrusted: true });
  rejectBeforeGesture({ name: 'NotAllowedError' }); await Promise.resolve();
  assert.equal(video.muted, false, 'Old autoplay failure must not mute successful gesture narration');
  screenHidden = true; listeners['clavis:workspace-change']();
  assert.equal(video.paused, true, 'Entering the workspace must pause before the observer catches up');
  observer([{ isIntersecting: false }]);
  console.log('Login media: muted autoplay fallback, quiet gesture sound, hidden pause, reduced motion passed.');
})().catch(error => { console.error(error); process.exitCode = 1; });
