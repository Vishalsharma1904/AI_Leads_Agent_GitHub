// Isolated component preview, loopback only; exposes no app/account/backend files.
const http = require('node:http'), fs = require('node:fs'), path = require('node:path');
const root = path.resolve(__dirname, '..');
const allowed = new Map([
  ['/', 'tests/lead-map-preview.html'],
  ['/clavis-canvas.js', 'clavis-canvas.js'], ['/clavis-canvas.css', 'clavis-canvas.css'],
  ['/clavis-manual.css', 'clavis-manual.css'],
  ['/vendor/maplibre/maplibre-gl.js', 'vendor/maplibre/maplibre-gl.js'],
  ['/vendor/maplibre/maplibre-gl.css', 'vendor/maplibre/maplibre-gl.css']
]);
const server = http.createServer((req, res) => {
  const file = allowed.get(new URL(req.url, 'http://localhost').pathname);
  if (!file) { res.writeHead(404); res.end(); return; }
  res.setHeader('Content-Type', file.endsWith('.css') ? 'text/css' : file.endsWith('.js') ? 'application/javascript' : 'text/html');
  res.setHeader('Cache-Control', 'no-store');
  fs.createReadStream(path.join(root, file)).pipe(res);
});
server.listen(Number(process.env.MAP_PREVIEW_PORT || 3098), '127.0.0.1', () => console.log('Map preview ready'));
setTimeout(() => { server.close(); process.exit(0); }, 600000);
