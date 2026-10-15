'use strict';

// Local HTTP only: fake engine + the real UI server on ephemeral ports.
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
const received = [];
function listen(server) {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.removeListener('error', reject);
      resolve(server.address().port);
    });
  });
}
function close(server) {
  return new Promise(resolve => server && server.listening ? server.close(resolve) : resolve());
}
function request(port, pathname, options = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ hostname: '127.0.0.1', port, path: pathname, agent: false,
      method: options.method || 'GET', headers: options.headers || {} }, response => {
      let body = '';
      response.setEncoding('utf8');
      response.on('data', chunk => { body += chunk; });
      response.on('end', () => resolve({ status: response.statusCode, headers: response.headers, body }));
      response.on('error', reject);
    });
    req.setTimeout(5000, () => req.destroy(new Error('Local proxy test timed out')));
    req.on('error', reject);
    req.end(options.body);
  });
}
function backendFromConfig(window, origin = 'http://127.0.0.1:3032') {
  const url = new URL(origin);
  vm.runInNewContext(fs.readFileSync(path.join(root, 'config.js'), 'utf8'), {
    window, location: { origin: url.origin, hostname: url.hostname, protocol: url.protocol }
  });
  return window.SKYLARK_CONFIG.BACKEND_URL;
}

(async function () {
  const previous = process.env.CLAVIS_ENGINE_PORT;
  const engine = http.createServer(async (req, res) => {
    let body = '';
    for await (const chunk of req) body += chunk;
    received.push({ method: req.method, path: req.url, headers: req.headers, body });
    res.writeHead(req.url.startsWith('/health') ? 200 : 201, { 'content-type': 'application/json' });
    res.end(JSON.stringify(req.url.startsWith('/health') ? { ok: true } : { verified: true }));
  });
  let ui;
  try {
    const enginePort = await listen(engine);
    process.env.CLAVIS_ENGINE_PORT = String(enginePort);
    ui = require('../serve-clavis').server;
    const uiPort = await listen(ui), origin = 'http://127.0.0.1:' + uiPort;
    let returnedCode;
    require('../serve-clavis').setAuthCallback(url => { returnedCode = url.searchParams.get('code'); return true; });
    const callback = await request(uiPort, '/?code=fixture-authorization-code');
    assert.equal(returnedCode, 'fixture-authorization-code');
    assert.equal(callback.status, 200);
    assert.equal(callback.headers['cache-control'], 'no-store');
    assert.equal(callback.headers['referrer-policy'], 'no-referrer');
    assert.doesNotMatch(callback.body, /fixture-authorization-code/);
    require('../serve-clavis').setAuthCallback(null);
    const body = JSON.stringify({ provider: 'groq', secret: 'fixture-key-no-real-credits' });
    const saved = await request(uiPort, '/api/credentials', { method: 'PUT', body,
      headers: { authorization: 'Bearer fixture-token', 'content-type': 'application/json',
        'idempotency-key': 'fixture-request' } });
    assert.equal(saved.status, 201);
    assert.deepEqual(JSON.parse(saved.body), { verified: true });
    assert.equal(received[0].method, 'PUT');
    assert.equal(received[0].path, '/api/credentials');
    assert.equal(received[0].body, body);
    assert.equal(received[0].headers.authorization, 'Bearer fixture-token');
    assert.equal(received[0].headers['idempotency-key'], 'fixture-request');
    assert.equal(received[0].headers.host, '127.0.0.1:' + enginePort);

    const health = await request(uiPort, '/health?fixture=1');
    assert.equal(health.status, 200);
    assert.deepEqual(JSON.parse(health.body), { ok: true });
    assert.equal(received[1].path, '/health?fixture=1');

    const dynamicConfig = await request(uiPort, '/desktop-config.js');
    assert.equal(dynamicConfig.status, 200);
    assert.equal(dynamicConfig.headers['cache-control'], 'no-store');
    const window = {};
    vm.runInNewContext(dynamicConfig.body, { window });
    assert.equal(window.CLAVIS_LOCAL_ENGINE_PROXY, true);
    // The test does not load or expose the developer's private runtime values.
    window.CLAVIS_DESKTOP_BACKEND_URL = '';
    assert.equal(backendFromConfig(window, origin), origin);
    assert.equal(backendFromConfig({}), 'http://127.0.0.1:8000');
    assert.equal(backendFromConfig({}, 'file:///fixture/index.html'), 'http://127.0.0.1:8000');
    assert.equal(backendFromConfig({ CLAVIS_LOCAL_ENGINE_PROXY: true,
      CLAVIS_DESKTOP_BACKEND_URL: 'https://fixture-engine.example' }, origin),
      'https://fixture-engine.example');
    assert.equal(backendFromConfig({}, 'https://fixture-app.example'), 'https://fixture-app.example');

    await close(engine);
    const unavailable = await request(uiPort, '/api/credentials', { method: 'PUT', body,
      headers: { authorization: 'Bearer fixture-token', 'content-type': 'application/json' } });
    assert.equal(unavailable.status, 503);
    assert.match(unavailable.headers['content-type'], /application\/json/);
    assert.match(JSON.parse(unavailable.body).detail, /AI engine/);
    assert.doesNotMatch(unavailable.body, /failed to fetch/i);
    console.log('PASS local engine proxy: credentials bearer/body forwarding, same-origin health, dynamic proxy marker, IPv4 fallback, remote override, unavailable engine returns 503 JSON');
  } finally {
    await close(ui);
    await close(engine);
    if (previous === undefined) delete process.env.CLAVIS_ENGINE_PORT;
    else process.env.CLAVIS_ENGINE_PORT = previous;
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
