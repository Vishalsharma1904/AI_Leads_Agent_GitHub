// node tests/clavis_image_relevance_test.js
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'clavis-canvas.js'), 'utf8');
const start = source.indexOf('function keepOnSubject(');
const end = source.indexOf('function fromBundle(', start);
assert(start >= 0 && end > start, 'image relevance filter exists');
const context = {
  window: { ClavisLuxe: { pictures: { mentions: (title, tokens) => tokens.every((word) => title.toLowerCase().includes(word)) } } },
};
vm.runInNewContext(`${source.slice(start, end)}; this.filter = keepOnSubject;`, context);
const items = [{ title: 'Al Pacino portrait' }, { title: 'A random house' }];
assert.deepStrictEqual(Array.from(context.filter(items, { sure: true, tokens: ['al', 'pacino'] })), [items[0]]);

const loadStart = source.indexOf('async function withLoadedImage(');
const loadEnd = source.indexOf('async function searchImages(', loadStart);
assert(loadStart >= 0 && loadEnd > loadStart, 'image load check exists');
context.Image = class {
  set src(value) { queueMicrotask(() => (value.includes('valid') ? this.onload() : this.onerror())); }
};
context.withTimeout = (promise) => promise;
context.setTimeout = setTimeout;
context.clearTimeout = clearTimeout;
vm.runInNewContext(`${source.slice(loadStart, loadEnd)}; this.checkImage = withLoadedImage;`, context);
const luxe = fs.readFileSync(path.join(__dirname, '..', 'clavis-luxe.js'), 'utf8');
const luxeStart = luxe.indexOf('function readyPictures(');
const luxeEnd = luxe.indexOf('function pictureAnswer(', luxeStart);
assert(luxeStart >= 0 && luxeEnd > luxeStart, 'chat-gallery image load check exists');
vm.runInNewContext(`${luxe.slice(luxeStart, luxeEnd)}; this.checkGallery = readyPictures;`, context);
(async () => {
  assert.strictEqual((await context.checkImage({ items: [{ thumb: 'broken' }, { thumb: 'valid' }] })).items.length, 2);
  await assert.rejects(context.checkImage({ items: [{ thumb: 'broken' }] }));
  assert.strictEqual((await context.checkGallery({ items: [{ thumb: 'broken' }, { thumb: 'valid' }] })).items.length, 2);
  await assert.rejects(context.checkGallery({ items: [{ thumb: 'broken' }] }));
  console.log('Image relevance and load checks: OK');
})().catch((error) => { console.error(error); process.exitCode = 1; });
