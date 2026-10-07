'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

async function main() {
  const storage = new Map(), writes = [], calls = [], events = new Map();
  let session = 'test-session', failSave = false;
  const key = 'gsk_test_only_not_a_real_key_123456789';
  const window = {
    SKYLARK_CONFIG: { BACKEND_URL: 'http://localhost:8000', GROQ_API_KEYS: [key] },
    SupabaseAuth: { getAccessToken: () => session },
    ClavisWake: { allowBackground: () => true },
    addEventListener: (name, fn) => events.set(name, fn), dispatchEvent() {},
    NexusAIChat: { complete: async payload => {
      calls.push({ chat: payload }); return { choices: [{ message: { content: 'real reply' } }] };
    } }
  };
  const context = vm.createContext({ window, URL, Promise, console, AbortController, CustomEvent: class {},
    location: { protocol: 'http:', hostname: 'localhost' }, setTimeout, clearTimeout,
    localStorage: { getItem: name => storage.get(name) || null, removeItem: name => storage.delete(name),
      setItem: (name, value) => { writes.push(value); storage.set(name, value); } },
    fetch: async (url, options = {}) => {
      calls.push({ url, options });
      assert.ok(url.startsWith('http://localhost:8000/api/credentials'));
      assert.equal(options.headers.Authorization, 'Bearer test-session');
      if (options.method === 'PUT' && failSave) return { ok: false, json: async () => ({ detail: 'verification failed' }) };
      return { ok: true, json: async () => ({ credentials: [{ provider: 'groq', configured: true }] }) };
    }
  });
  for (const name of ['clavis-keyvault.js', 'clavis-direct.js']) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, '..', name), 'utf8'), context);
  }
  await window.ClavisKeyVault.refresh();
  assert.equal(window.ClavisKeyVault.use('groq'), '');
  assert.equal(window.ClavisKeyVault.all('groq').length, 0);
  assert.equal(window.ClavisDirect.keyFor('groq'), '');
  assert.equal(window.ClavisDirect.providerConfigured('groq'), true);
  await window.ClavisDirect.setKey('groq', key);
  assert.equal(writes.some(value => String(value).includes(key)), false);
  assert.equal(JSON.stringify(window.ClavisKeyVault.status()).includes(key), false);
  await window.ClavisDirect.complete({ messages: [{ role: 'user', content: 'hello' }] });
  assert.equal(calls.at(-1).chat.model, 'groq/openai/gpt-oss-20b');
  assert.equal(JSON.stringify(calls.at(-1)).includes(key), false);
  failSave = true;
  await assert.rejects(window.ClavisKeyVault.add('groq', key));
  assert.equal(window.ClavisDirect.providerConfigured('groq'), true);
  session = '';
  const before = calls.length;
  await assert.rejects(window.ClavisKeyVault.add('groq', key));
  await assert.rejects(window.ClavisDirect.complete({ messages: [] }), error => error.code === 'AI_AUTH_REQUIRED');
  assert.equal(calls.length, before);
  assert.equal(window.ClavisKeyVault.status().anyKey, false);
  console.log('Server vault security checks passed: no browser key access/storage, authenticated save/chat, safe failed replacement and logout.');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
