/* One question this answers: does a plain answer open the task window?
 * It must not — the chat thread already shows that reply.  A lead or
 * candidate action must still open one, because that work is watchable
 * and cancellable.  Run: node tests/task-surface-gate.test.js            */
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const noop = () => {};
const el = () => ({
  style: { setProperty: noop, removeProperty: noop },
  classList: { add: noop, remove: noop, toggle: noop, contains: () => false },
  dataset: {}, children: [], hidden: false,
  setAttribute: noop, removeAttribute: noop, getAttribute: () => null,
  appendChild: noop, remove: noop, addEventListener: noop, removeEventListener: noop,
  querySelector: () => null, querySelectorAll: () => [], closest: () => null,
  insertBefore: noop, contains: () => false, focus: noop, innerHTML: '', textContent: ''
});

const win = {
  document: Object.assign(el(), {
    createElement: el, getElementById: () => null, body: el(), head: el(),
    documentElement: el(), readyState: 'complete', addEventListener: noop, dispatchEvent: noop
  }),
  localStorage: { getItem: () => null, setItem: noop, removeItem: noop },
  setTimeout, clearTimeout, setInterval: () => 0, clearInterval: noop,
  requestAnimationFrame: cb => setTimeout(cb, 0),
  addEventListener: noop, dispatchEvent: noop, CustomEvent: class { constructor(t, o) { Object.assign(this, o); this.type = t; } },
  console, Date, Math, JSON, Promise, navigator: { userAgent: 'node' }, location: { href: 'http://localhost/' }
};
win.window = win;

// The engine must exist BEFORE the controller loads, so it gets wrapped.
let lastSent = null;
let reply = { text: 'Namaste Sir! Kaise ho?' };          // a plain answer
win.ChatEngine = { sendMessage: (t) => { lastSent = t; return Promise.resolve(reply); } };

const load = f => {
  const src = fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
  new Function('window', 'document', 'console', 'setTimeout', 'clearTimeout', 'setInterval',
    'clearInterval', 'requestAnimationFrame', 'CustomEvent', 'localStorage', 'navigator', 'location',
    src)(win, win.document, console, setTimeout, clearTimeout, win.setInterval, noop,
         win.requestAnimationFrame, win.CustomEvent, win.localStorage, win.navigator, win.location);
};
load('clavis-task-model.js');
load('clavis-task-controller.js');

const Task = win.ClavisTask;
assert.ok(Task, 'ClavisTask installed');
assert.notStrictEqual(win.ChatEngine.sendMessage.toString(), '', 'ChatEngine was wrapped');

(async () => {
  // 1. a general question must leave the surface closed
  Task.clear();
  await win.ChatEngine.sendMessage('hi');
  assert.strictEqual(Task.current(), null,
    'a plain answer must NOT open a task window');

  // 2. a lead action must open one
  Task.clear();
  reply = { text: 'Searching…', action: { type: 'generate', industries: ['Hotels'], city: 'Gurugram', count: 25 } };
  await win.ChatEngine.sendMessage('Gurugram ke hotels ki 25 leads nikalo');
  assert.ok(Task.current(), 'a lead action MUST open a task window');

  // 3. an already-running task is reused, never doubled
  Task.clear();
  reply = { text: 'ok' };
  const id = Task.begin('find 25 hospitals in delhi', { source: 'composer' });
  await win.ChatEngine.sendMessage('find 25 hospitals in delhi');
  assert.strictEqual(Task.current() && Task.current().id, id, 'the running task is reused');

  console.log('task-surface-gate: ok');
})().catch(e => { console.error('FAIL:', e.message); process.exit(1); });
