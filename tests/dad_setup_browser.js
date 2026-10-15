'use strict';

// Deterministic Chrome check: real setup/vault scripts, fake account and provider keys.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE ||
  'C:/Users/Khushi/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const root = path.resolve(__dirname, '..');
const fixtures = {
  groq: 'gsk_fixtureGroq012345678901234567890',
  elevenlabs: 'fixtureElevenLabs012345678901234567890',
  apify: 'apify_api_fixtureApify012345678901234567890'
};
const calls = [], errors = [], credentials = new Set();
let mode = 'available', verified = true;
const headers = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, PUT, POST, DELETE, OPTIONS',
  'access-control-allow-headers': 'authorization, content-type'
};

(async function () {
  const browser = await chromium.launch({ headless: true, channel: 'chrome' });
  try {
    const context = await browser.newContext();
    await context.route('**/*', async route => {
      const request = route.request(), url = new URL(request.url());
      if (url.pathname === '/index.html') {
        return route.fulfill({ contentType: 'text/html', body:
          '<!doctype html><html><head><meta charset="utf-8"></head><body>' +
          '<script src="clavis-keyvault.js"></script><script src="clavis-setup.js"></script>' +
          '</body></html>' });
      }
      if (['/clavis-keyvault.js', '/clavis-setup.js'].includes(url.pathname)) {
        return route.fulfill({ contentType: 'application/javascript',
          body: fs.readFileSync(path.join(root, url.pathname.slice(1)), 'utf8') });
      }
      if (url.pathname === '/api/credentials') {
        if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers });
        calls.push({ url: request.url(), method: request.method(), headers: request.headers(),
          body: request.method() === 'PUT' ? request.postDataJSON() : null });
        if (mode === 'unavailable') return route.abort('connectionrefused');
        let data;
        if (request.method() === 'PUT') {
          const body = request.postDataJSON();
          assert.equal(body.secret, fixtures[body.provider]);
          credentials.add(body.provider);
          data = { verified, note: verified ? 'Provider verified.' :
            'Key saved, but provider verification could not be completed.' };
        } else {
          data = { credentials: Array.from(credentials, provider => ({ provider, configured: true })) };
        }
        return route.fulfill({ headers, contentType: 'application/json', body: JSON.stringify(data) });
      }
      throw new Error('Unexpected request (direct-provider calls are forbidden): ' + url.origin + url.pathname);
    });
    await context.addInitScript(() => {
      window.SKYLARK_CONFIG = { BACKEND_URL: 'http://127.0.0.1:3032' };
      window.SupabaseAuth = {
        getAccessToken: () => 'fixture-auth-token',
        getUser: () => ({ id: 'fixture-user' }),
        getSession: () => null
      };
    });
    const page = await context.newPage();
    page.on('pageerror', error => errors.push(error.message));
    await page.goto('http://127.0.0.1:3032/index.html');
    await page.evaluate(() => window.ClavisKeyVault.refresh());

    mode = 'unavailable';
    for (const [provider, key] of Object.entries(fixtures)) {
      const result = await page.evaluate(([provider, key]) =>
        window.ClavisSetup.saveKey(provider, key), [provider, key]);
      assert.equal(result.saved, false, provider + ' must not claim a failed save succeeded');
      assert.equal(result.status, 'unknown');
      assert.match(result.message, /backend is not reachable/i);
      assert.doesNotMatch(result.message, /failed to fetch/i);
    }

    mode = 'available';
    for (const [provider, key] of Object.entries(fixtures)) {
      verified = true;
      const result = await page.evaluate(([provider, key]) =>
        window.ClavisSetup.saveKey(provider, key), [provider, key]);
      assert.equal(result.saved, true);
      assert.equal(result.status, 'ok');
      assert.equal(result.mask, 'Server vault');
      verified = false;
      const unverified = await page.evaluate(([provider, key]) =>
        window.ClavisSetup.saveKey(provider, key), [provider, key]);
      assert.equal(unverified.saved, true);
      assert.equal(unverified.status, 'unknown', 'stored keys must not claim successful verification');
      assert.match(unverified.message, /verification could not be completed/);
    }

    mode = 'unavailable';
    assert.equal(await page.evaluate(() => window.ClavisKeyVault.refresh()), false);
    let status = await page.evaluate(() => window.ClavisKeyVault.status());
    assert.deepEqual(status.connected.sort(), Object.keys(fixtures).sort(),
      'temporary connection failures must preserve the last successful inventory');
    assert.match(status.connectionError, /backend is not reachable/i);

    mode = 'available';
    await page.evaluate(() => { window.SKYLARK_CONFIG.BACKEND_URL = ' https://fixture-cloud.example/ '; });
    assert.equal(await page.evaluate(() => window.ClavisKeyVault.refresh()), true);
    assert.equal(calls.at(-1).url, 'https://fixture-cloud.example/api/credentials');
    await page.evaluate(key => window.ClavisSetup.saveKey('groq', key), fixtures.groq);
    assert.equal(calls.at(-1).url, 'https://fixture-cloud.example/api/credentials');
    status = await page.evaluate(() => window.ClavisKeyVault.status());
    assert.equal(status.connectionError, '');

    const saves = calls.filter(call => call.method === 'PUT');
    assert.equal(saves.length, 10);
    assert.deepEqual(Array.from(new Set(saves.map(call => call.body.provider))).sort(),
      Object.keys(fixtures).sort());
    for (const call of calls) assert.equal(call.headers.authorization, 'Bearer fixture-auth-token');
    const storage = await page.evaluate(() => JSON.stringify({ ...localStorage }));
    for (const key of Object.values(fixtures)) assert.equal(storage.includes(key), false);
    assert.equal(storage.includes('clavis_provider_keys'), false);
    assert.deepEqual(errors, []);
    console.log('PASS dad setup browser: Groq/ElevenLabs/Apify authenticated vault saves, clear backend errors, truthful verification, preserved inventory, current backend URL, no browser secrets');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
