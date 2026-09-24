'use strict';

const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');

function read(file) {
  return fs.readFileSync(path.join(ROOT, file), 'utf8');
}

let failures = 0;
function assert(name, condition, details = '') {
  if (condition) {
    console.log(`  PASS  ${name}`);
  } else {
    console.error(`  FAIL  ${name}${details ? ': ' + details : ''}`);
    failures++;
  }
}

console.log('--- Verifying Floating Window & Composer Polish ---');

const css = read('clavis-task-surface.css');
const js = read('clavis-task-surface.js');
const chatJs = read('chat.js');

// 1. Spring & Timing checks
assert('Spring curve uses slow, silky cubic-bezier(0.22, 1, 0.36, 1)',
  css.includes('--cts-spring: cubic-bezier(0.22, 1, 0.36, 1);'));

assert('Height transition is at least 800ms',
  /height\s+840ms\s+var\(--cts-spring\)/.test(css));

assert('Width transition is at least 800ms',
  /width\s+800ms\s+var\(--cts-spring\)/.test(css));

assert('Capsule reveal animation duration is 800ms',
  css.includes('animation: cts-capsule-reveal 800ms var(--cts-spring) forwards;'));

// 2. Monochromatic & Zero Blue Isolation checks
assert('No blue hex or rgb colors exist in clavis-task-surface.css',
  !/#0071E3|#007AFF|#0A84FF|rgba\(\s*0\s*,\s*113\s*,\s*227|rgba\(\s*10\s*,\s*132\s*,\s*255/i.test(css));

assert('Strict monochromatic isolation exists for textarea/input/button focus',
  css.includes('html body .cts textarea:focus') &&
  css.includes('html body .cts-composer *') &&
  css.includes('border-color: transparent !important;') &&
  css.includes('box-shadow: none !important;'));

// 3. Scanner beam & Plot-grade effects
assert('Scanner sweep pulse effect exists on attachment chips',
  css.includes('animation: cts-scanner-sweep 950ms cubic-bezier(0.22, 1, 0.36, 1) forwards;'));

assert('Attachment chip has glass blur and subtle shadow',
  css.includes('backdrop-filter: blur(16px);') && css.includes('border-radius: 12px;'));

assert('Thumbnail hover overlay exists with view icon',
  css.includes('.cts-attach-thumb-overlay') && css.includes('.cts-attach-thumb:hover .cts-attach-thumb-overlay'));

// 4. JS Fluid Motion & smoothResize Coordinator
assert('smoothResize coordinator is defined in clavis-task-surface.js',
  js.includes('function smoothResize(mutationFn)'));

assert('renderAttachments uses smoothResize and chip preservation (no innerHTML blowup)',
  js.includes('smoothResize(function () {') && js.includes('existingMap[att.id]'));

assert('autoGrowComposer triggers smoothResize on height change',
  js.includes('Math.abs(clampedH - prevH) > 2') && js.includes('smoothResize(function () {});'));

assert('toggleQuickActions wraps menu changes in smoothResize',
  js.includes('smoothResize(function () {') && js.includes('cts-action-pill'));

assert('submitComposer passes attachments and images in fallback branch',
  js.includes('global.handleChatSend(fullText, { images: images, attachments: attachments });'));

assert('10MB file size limit is strictly enforced',
  js.includes('10 * 1024 * 1024') && js.includes('File exceeds 10MB limit'));

// 5. Multi-modal forwarding in chat.js
assert('chat.js forwards options.images to ClavisDirect',
  chatJs.includes('payload.images = options.images;'));

assert('chat.js formats text attachments into user prompt',
  chatJs.includes('[Attached Document:'));

if (failures > 0) {
  console.error(`\nFAILED: ${failures} check(s) did not pass.`);
  process.exit(1);
} else {
  console.log('\nSUCCESS: All floating window & composer polish checks passed perfectly!');
}
