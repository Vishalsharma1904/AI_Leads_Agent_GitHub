'use strict';
// Isolated, local-only visual fixture server. Production's /tests block stays intact.
const http = require('node:http'), fs = require('node:fs'), path = require('node:path');
const root = path.resolve(__dirname, '..');
const stylePaths = [...fs.readFileSync(path.join(root, 'index.html'), 'utf8').matchAll(/<link\b[^>]*href=["']([^"']+\.css(?:\?[^"']*)?)["'][^>]*>/g)].map(m => m[1].split('?')[0]).filter(p => !/^https?:/.test(p));
const assets = new Set([...stylePaths, 'elevenlabs-studio.js', 'sarvam-calling-ui.js', 'clavis-setup.js']);
http.createServer((req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1');
  let requested; try { requested = decodeURIComponent(url.pathname).replace(/^\/+/, ''); } catch (_) { res.writeHead(400); return res.end(); }
  const fixture = requested === 'fixture' || requested === '';
  const font = /^fonts\/[A-Za-z0-9_./-]+\.(woff2?|ttf)$/.test(requested) && !requested.includes('..');
  if (!fixture && !assets.has(requested) && !font) { res.writeHead(404); return res.end(); }
  const file = fixture ? path.join(root, 'tests/artifacts/elevenlabs-studio-fixture.html') : path.join(root, requested);
  const type = fixture ? 'text/html' : file.endsWith('.css') ? 'text/css' : file.endsWith('.js') ? 'text/javascript' : 'application/octet-stream';
  fs.readFile(file, (error, data) => {
    if (fixture && !error) {
      data = Buffer.from(data.toString().replace(/<link[^>]*rel="stylesheet"[^>]*>/g, '')
        .replace('<html lang="en" data-theme="light">', '<html lang="en" data-theme="light" data-rudra-flow="true">')
        .replace('</nav>', '<button type="button" onclick="document.documentElement.setAttribute(\'data-theme\',document.documentElement.getAttribute(\'data-theme\')===\'dark\'?\'light\':\'dark\')">Toggle theme</button></nav>')
        .replace('</head>', stylePaths.map(p => `<link rel="stylesheet" href="/${p}">`).join('') + '</head>'));
    }
    res.writeHead(error ? 404 : 200, {'Content-Type':type, 'Cache-Control':'no-store'}); res.end(error ? '' : data);
  });
}).listen(3211, '127.0.0.1', () => process.stdout.write('ElevenLabs offline fixture: http://127.0.0.1:3211/fixture\n'));
