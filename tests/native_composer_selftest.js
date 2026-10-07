const fs = require('node:fs'), assert = require('node:assert/strict'), vm = require('node:vm');
const source = fs.readFileSync('luxury-ui.js', 'utf8');
const start = source.indexOf('  function attachToBox(box) {');
const end = source.indexOf('    ensureHoverGlow(box);', start);
for (const id of ['chat-input', 'candidate-ai-input']) {
  let attached = 0;
  const input = { id }, box = { querySelector: () => input };
  const context = { box, window: { ClavisComposerSizing: { attach(t) { assert.equal(t, input); attached++; } } } };
  vm.runInNewContext(source.slice(start, end) + '}\nattachToBox(box);attachToBox(box);', context);
  assert.equal(attached, 1);
}
console.log('Native caret bypass: both sibling inputs attach once to shared sizing.');
