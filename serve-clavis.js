// Clavis static server. `serve` CLI ka use nahi karte kyunki wo start hone se
// pehle npm registry par update-check karta hai — network slow ho to 15-20 sec
// block, aur Chrome usse pehle hi khul kar connection refused kha jata hai.
// serve-handler wahi static logic hai, bina us check ke.
const http = require('http');
const handler = require('serve-handler');

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
const BLOCKED = /(^|\/)\.|^\/(backend|migrations|logs|voice)\//;

http.createServer((req, res) => {
  const path = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  if (BLOCKED.test(path)) {
    res.statusCode = 404;
    return res.end('Not found');
  }
  return handler(req, res, opts);
})
  .listen(PORT, '127.0.0.1', () => console.log(`Clavis UI → http://localhost:${PORT}`))
  .on('error', (e) => {
    console.error(e.code === 'EADDRINUSE' ? `Port ${PORT} busy — Clavis pehle se chal raha hai?` : e);
    process.exit(1);
  });
