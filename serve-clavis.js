// Rudra24 AI static server. `serve` CLI ka use nahi karte kyunki wo start hone se
// pehle npm registry par update-check karta hai — network slow ho to 15-20 sec
// block, aur Chrome usse pehle hi khul kar connection refused kha jata hai.
// serve-handler wahi static logic hai, bina us check ke.
const http = require('http');
const https = require('https');
const handler = require('serve-handler');
const omniApi = require('./api/omnidimension');
const grokApi = require('./api/grok-voice');
const publicConfig = require('./api/public-config');
let desktopAuthCallback;
// ponytail: local session connections expire on UI-server restart; production
// uses its persistent Vercel secret. No provider key is saved to a local file.
if (!process.env.OMNIDIM_SESSION_KEY) process.env.OMNIDIM_SESSION_KEY = require('crypto').randomBytes(32).toString('hex');

const PORT = Number(process.env.CLAVIS_UI_PORT || 3000);
// directoryListing:false => node_modules / backend ki listing kabhi expose na ho.
// Uske saath '/' ko explicitly index.html par rewrite karna padta hai.
const opts = {
  public: __dirname,
  cleanUrls: false,
  directoryListing: false,
  rewrites: [{ source: '/', destination: '/index.html' }],
};

// serve-handler dotfiles bhi serve kar deta hai. backend/.env jaisi cheez
// localhost par bhi kabhi expose nahi honi chahiye.
const BLOCKED = /(^|\/)\.|^\/(backend|electron|clavis-bridge|migrations|logs|voice|tests|scripts|release|installer|docs|_claude_tmp|openwa|_to_delete)\/|^\/(?:package(?:-lock)?|desktop-config)\.json$|(?:secrets?\.local|credentials?|backup)[^/]*\.(?:js|json)$|\.(?:env|db|sqlite3?|log|zip|7z|csv|xlsx|pem|key|pfx|toml|ps1|bat|py)$/i;

// Sarvam ka REST API browser se seedha nahi khulta (CORS). Yeh patla
// same-origin proxy hai: /sarvam-api/<path> -> https://apps.sarvam.ai/<path>.
// Key browser header me bhejta hai; yahan na store hoti hai na log.
// sarvam-calling.js pehle direct try karta hai, fail ho to yahan aata hai.
const SARVAM_HOST = 'apps.sarvam.ai';
const SARVAM_PREFIX = '/sarvam-api';
const PASS_HEADERS = ['api-subscription-key', 'x-api-key', 'content-type', 'accept'];

function proxySarvam(req, res) {
  const headers = { host: SARVAM_HOST };
  for (const h of PASS_HEADERS) if (req.headers[h]) headers[h] = req.headers[h];
  const upstream = https.request(
    { host: SARVAM_HOST, path: req.url.slice(SARVAM_PREFIX.length) || '/', method: req.method, headers },
    (r) => {
      res.writeHead(r.statusCode || 502, { 'content-type': r.headers['content-type'] || 'application/json' });
      r.pipe(res);
    }
  );
  upstream.on('error', (e) => {
    res.writeHead(502, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ detail: 'Sarvam proxy: ' + e.message }));
  });
  req.pipe(upstream);
}


// OpenWA = local WhatsApp gateway (openwa/ folder, Start-OpenWA.bat, port 2785).
// Browser ke paas key nahi hoti: admin key yahin openwa/data/.api-key (ya
// OPENWA_API_KEY env) se padh kar header me lagti hai. Sirf /sessions routes.
const OPENWA_PREFIX = '/openwa-api/';
const OPENWA_PORT = Number(process.env.OPENWA_PORT || 2785);
function openwaKey() {
  if (process.env.OPENWA_API_KEY) return process.env.OPENWA_API_KEY.trim();
  try { return require('fs').readFileSync(require('path').join(__dirname, 'openwa', 'data', '.api-key'), 'utf8').trim(); }
  catch (_) { return ''; }
}
function proxyOpenwa(req, res) {
  const rest = req.url.slice(OPENWA_PREFIX.length);
  const fail = (code, detail) => { if (!res.headersSent) res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify({ detail })); };
  if (!/^sessions(\/|\?|$)/.test(rest) || rest.includes('..')) return fail(404, 'Not found');
  const key = openwaKey();
  if (!key) return fail(503, 'OpenWA ki API key nahi mili. Start-OpenWA.bat ek baar chalaiye (pehli baar me key banti hai).');
  const headers = { 'x-api-key': key };
  for (const h of ['content-type', 'accept', 'idempotency-key']) if (req.headers[h]) headers[h] = req.headers[h];
  const upstream = http.request({ host: '127.0.0.1', port: OPENWA_PORT, method: req.method, path: '/api/' + rest, headers }, (r) => {
    res.writeHead(r.statusCode || 502, { 'content-type': r.headers['content-type'] || 'application/json' });
    r.pipe(res);
  });
  upstream.setTimeout(60000, () => upstream.destroy(new Error('timeout')));
  upstream.on('error', () => fail(503, 'OpenWA band hai. Start-OpenWA.bat chalaiye aur window khuli rakhiye.'));
  req.pipe(upstream);
}

// Same-origin engine proxy: /api, /ws, /health -> FastAPI on 127.0.0.1:8000.
// Browser requests stay same-origin; engine connection uses IPv4.
const ENGINE_PORT = Number(process.env.CLAVIS_ENGINE_PORT || 8000);
const ENGINE_PATH = /^\/(api|ws|health)(\/|\?|$)/;
function proxyEngine(req, res) {
  const headers = { ...req.headers, host: `127.0.0.1:${ENGINE_PORT}` };
  const up = http.request({ host: '127.0.0.1', port: ENGINE_PORT, method: req.method, path: req.url, headers }, (r) => {
    res.writeHead(r.statusCode || 502, { ...r.headers, 'cache-control': 'no-store' });
    r.pipe(res);
  });
  up.on('error', () => {
    if (!res.headersSent) res.writeHead(503, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ detail: 'AI engine start ho raha hai, kuch second me dobara try kijiye.' }));
  });
  res.on('close', () => { if (!res.writableEnded) up.destroy(); });
  req.pipe(up);
}

const server = http.createServer(async (req, res) => {
  let callbackURL;
  try { callbackURL = new URL(req.url, 'http://localhost:3210'); }
  catch (_) { res.statusCode = 400; return res.end('Invalid request URL'); }
  if (req.method === 'GET' && callbackURL.pathname === '/' &&
      (callbackURL.searchParams.has('code') || callbackURL.searchParams.has('error')) && desktopAuthCallback?.(callbackURL)) {
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Referrer-Policy', 'no-referrer');
    return res.end('Google sign-in returned to Rudra24 AI. You can close this tab and return to the app.');
  }
  const host = String(req.headers.host || '').split(':')[0];
  if (!['localhost', '127.0.0.1'].includes(host)) { res.statusCode = 403; return res.end('Invalid host'); }
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  // Inline handlers still exist in this legacy UI; this is containment, not a
  // strict script CSP. Do not claim that it makes the app XSS-proof.
  res.setHeader('Content-Security-Policy', "base-uri 'self'; object-src 'none'; frame-ancestors 'none'; form-action 'self'");
  if (['/api/omnidimension', '/api/grok-voice', '/api/public-config'].includes(req.url.split('?')[0])) {
    res.setHeader('Content-Type', 'application/json');
    res.status = code => { res.statusCode = code; return res; };
    res.json = value => res.end(JSON.stringify(value));
    if (req.url.split('?')[0] === '/api/public-config') return publicConfig(req, res);
    let bytes = 0, body = '';
    try {
      for await (const chunk of req) {
        bytes += chunk.length;
        if (bytes > 3 * 1024 * 1024) return res.status(413).json({ detail: 'Request too large. PDF uploads support up to 2 MB.' });
        body += chunk.toString();
      }
      req.body = body || undefined;
      return await (req.url.split('?')[0] === '/api/grok-voice' ? grokApi : omniApi)(req, res);
    } catch (_) { if (!res.writableEnded) return res.status(400).json({ detail: 'Could not read request' }); }
    return;
  }
  if (req.url.split('?')[0] === '/desktop-config.js') {
    res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    return res.end(`window.CLAVIS_LOCAL_ENGINE_PROXY=true;window.CLAVIS_DESKTOP_BACKEND_URL=${JSON.stringify(process.env.CLAVIS_DESKTOP_BACKEND_URL || '')};window.CLAVIS_DESKTOP_BRIDGE_URL=${JSON.stringify(process.env.CLAVIS_BRIDGE_PORT ? `http://127.0.0.1:${process.env.CLAVIS_BRIDGE_PORT}` : '')};window.CLAVIS_DESKTOP_BRIDGE_TOKEN=${JSON.stringify(process.env.CLAVIS_BRIDGE_TOKEN || '')};`);
  }
  if (ENGINE_PATH.test(req.url)) return proxyEngine(req, res);
  if (req.url.startsWith(OPENWA_PREFIX)) return proxyOpenwa(req, res);
  if (req.url.startsWith(SARVAM_PREFIX + '/')) { res.statusCode = 410; return res.end('Use the authenticated backend connector'); }

  let path;
  try { path = decodeURIComponent(new URL(req.url, 'http://localhost').pathname).replace(/\\/g, '/'); }
  catch (_) { res.statusCode = 400; return res.end('Invalid path'); }
  if (path.startsWith('/node_modules/') && path !== '/node_modules/@supabase/supabase-js/dist/umd/supabase.js') {
    res.statusCode = 404; return res.end('Not found');
  }
  if (BLOCKED.test(path)) {
    res.statusCode = 404;
    return res.end('Not found');
  }
  // Har request par browser dobara check kare (ETag se sasta) — git pull ke
  // baad purani JS/CSS kabhi na chale, bina Ctrl+Shift+R ke bhi.
  res.setHeader('Cache-Control', 'no-cache');
  return handler(req, res, path === "/desktop-setup.html" ? { ...opts, public: __dirname } : opts);
});

// WebSockets (voice /ws/...) go through the same door.
server.on('upgrade', (req, socket, head) => {
  if (!ENGINE_PATH.test(req.url)) return socket.destroy();
  const up = require('net').connect(ENGINE_PORT, '127.0.0.1', () => {
    const lines = [`${req.method} ${req.url} HTTP/1.1`];
    for (let i = 0; i < req.rawHeaders.length; i += 2) {
      lines.push(`${req.rawHeaders[i]}: ${/^host$/i.test(req.rawHeaders[i]) ? `127.0.0.1:${ENGINE_PORT}` : req.rawHeaders[i + 1]}`);
    }
    up.write(lines.join('\r\n') + '\r\n\r\n');
    if (head && head.length) up.write(head);
    up.pipe(socket); socket.pipe(up);
  });
  up.on('error', () => socket.destroy());
  socket.on('error', () => up.destroy());
});

function start() {
  return server.listen(PORT, '127.0.0.1', () => console.log(`Rudra24 AI UI → http://localhost:${PORT}`))
    .on('error', (e) => {
    console.error(e.code === 'EADDRINUSE' ? `Port ${PORT} busy — Rudra24 AI pehle se chal raha hai?` : e);
    if (require.main === module) process.exit(1);
  });
}

if (require.main === module) start();
function setUIRoot(root) {
  const resolved = require('path').resolve(root);
  if (!require('fs').existsSync(require('path').join(resolved, 'index.html'))) throw new Error('Verified UI root requires index.html');
  opts.public = resolved;
}
module.exports = { server, start, setUIRoot, setAuthCallback: callback => { desktopAuthCallback = callback; } };
