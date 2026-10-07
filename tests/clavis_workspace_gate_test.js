// node tests/clavis_workspace_gate_test.js
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const nodes = {
  'auth-screen': { style: { display: '' }, classList: { contains: () => false } },
  'app-shell': { style: { display: 'none' } },
  'view-jarvis': { classList: { contains: () => true } },
};
const win = {
  document: { readyState: 'loading', getElementById: (id) => nodes[id], addEventListener() {} },
  localStorage: { getItem: () => null },
  SupabaseAuth: { getSession: () => null, isRecoveryMode: () => false },
  setInterval: () => 0, setTimeout: () => 0,
  addEventListener() {}, dispatchEvent() {},
  console,
};
win.window = win;
vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', 'clavis-voice-state.js'), 'utf8'), win);
const voice = win.ClavisVoiceState;
assert.strictEqual(voice.canProcessMic(), false, 'login blocks microphone');
assert.strictEqual(voice.canSpeak(), false, 'login blocks speech');
win.SupabaseAuth.getSession = () => ({ user: { id: 'test' } });
nodes['auth-screen'].classList.contains = (name) => name === 'ag-hidden';
nodes['app-shell'].style.display = 'flex';
assert.strictEqual(voice.isClavisWorkspace(), true, 'signed-in Rudra24 AI view enables voice');
nodes['view-jarvis'].classList.contains = () => false;
assert.strictEqual(voice.canProcessMic(), false, 'another view blocks microphone');
assert.strictEqual(voice.canSpeak(), false, 'another view blocks speech');
console.log('Rudra24 AI workspace voice gate: OK');
