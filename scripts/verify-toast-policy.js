/**
 * Verifies the toast policy inside luxury-ui.js by executing the real source
 * of that IIFE against a minimal DOM stub. No jsdom needed.
 *
 * What this proves:
 *  1. A plain success toast ("Webhook Saved") reaches the underlying showToast.
 *     This is the regression that made every Save button look dead.
 *  2. An empty message stays empty and is NOT replaced by the error fallback.
 *  3. Secrets in toast text are redacted.
 *  4. An identical toast fired twice in quick succession is collapsed to one.
 *  5. A different toast is never collapsed.
 */

'use strict';

const fs = require('fs');
const path = require('path');

const source = fs.readFileSync(path.join(__dirname, '..', 'luxury-ui.js'), 'utf8');

// Pull out just the reliability-boundary IIFE.
const startMarker = '(function LuxuryReliabilityBoundary() {';
const start = source.indexOf(startMarker);
if (start === -1) {
  console.error('FAIL: LuxuryReliabilityBoundary not found in luxury-ui.js');
  process.exit(1);
}
const endMarker = '\n})();';
const end = source.indexOf(endMarker, start);
if (end === -1) {
  console.error('FAIL: could not find end of LuxuryReliabilityBoundary');
  process.exit(1);
}
const iife = source.slice(start, end + endMarker.length);

// ── Minimal DOM / window stubs ────────────────────────────────────────────
const received = [];
const listeners = {};

const documentStub = {
  addEventListener: (type, fn) => { listeners[type] = fn; },
  querySelectorAll: () => [],
  querySelector: () => null,
  getElementById: () => null
};

const windowStub = {
  addEventListener: () => {},
  showToast: (type, title, message) => { received.push({ type, title, message }); },
  matchMedia: () => ({ matches: true })
};

// Execute the IIFE with our stubs in scope.
// eslint-disable-next-line no-new-func
new Function('window', 'document', 'console', 'matchMedia', iife)(
  windowStub,
  documentStub,
  { warn() {}, error() {}, log() {} },
  () => ({ matches: true })
);

// The policy installs on DOMContentLoaded.
if (typeof listeners.DOMContentLoaded !== 'function') {
  console.error('FAIL: DOMContentLoaded handler was never registered');
  process.exit(1);
}
listeners.DOMContentLoaded();

if (windowStub.showToast.__lxPolicy !== true) {
  console.error('FAIL: toast policy did not install');
  process.exit(1);
}

// ── Assertions ────────────────────────────────────────────────────────────
let failures = 0;
function check(name, condition, detail) {
  if (condition) {
    console.log('  PASS  ' + name);
  } else {
    console.log('  FAIL  ' + name + (detail ? ' -> ' + detail : ''));
    failures++;
  }
}

console.log('\nToast policy verification\n');

// 1. The exact toast that used to be swallowed.
received.length = 0;
windowStub.showToast('success', '🔗 Webhook Saved', 'you@example.com is now connected.');
check('plain success toast passes through', received.length === 1, JSON.stringify(received));
check('type preserved', received[0] && received[0].type === 'success');
check('title preserved', received[0] && received[0].title === '🔗 Webhook Saved');

// 2. Empty message must stay empty.
received.length = 0;
windowStub.showToast('success', 'Saved', '');
check('empty message stays empty (no error fallback)',
  received.length === 1 && received[0].message === '',
  received[0] && JSON.stringify(received[0].message));

// 3. Secret redaction still applies.
received.length = 0;
windowStub.showToast('error', 'Request failed', 'api_key=super-secret-value-123 rejected');
check('secret redacted',
  received.length === 1 && !received[0].message.includes('super-secret-value-123'),
  received[0] && received[0].message);

// 4. Duplicate within the dedupe window is collapsed.
received.length = 0;
windowStub.showToast('success', 'Settings Saved', 'All preferences stored');
windowStub.showToast('success', 'Settings Saved', 'All preferences stored');
check('identical rapid duplicate collapsed to one', received.length === 1, 'count=' + received.length);

// 5. A different toast is not collapsed.
//    Note: use content not fired earlier in this run, otherwise the dedupe
//    window from an earlier assertion legitimately suppresses the first one.
received.length = 0;
windowStub.showToast('success', 'Lead Deleted', 'Removed from database');
windowStub.showToast('success', 'Status Updated', 'Lead marked Contacted');
check('distinct toasts both delivered', received.length === 2, 'count=' + received.length);

// 6. Unknown type normalises rather than breaking.
received.length = 0;
windowStub.showToast('banana', 'Odd type', 'still shown');
check('unknown type normalised to info',
  received.length === 1 && received[0].type === 'info',
  received[0] && received[0].type);

console.log('');
if (failures) {
  console.error(failures + ' check(s) failed');
  process.exit(1);
}
console.log('All toast policy checks passed');
