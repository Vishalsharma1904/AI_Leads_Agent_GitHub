/* Offline UI fixture. No requests reach Meta or a real backend. */
'use strict';
const http = require('node:http'), fs = require('node:fs'), path = require('node:path');
const root = path.resolve(__dirname, '..');
const index = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const section = index.match(/<section id="wa-cloud"[\s\S]*?<\/section>/)[0];
const assets = { '/whatsapp-cloud.js': ['text/javascript', 'whatsapp-cloud.js'], '/whatsapp-cloud.css': ['text/css', 'whatsapp-cloud.css'] };
const styles = [...index.matchAll(/<link\b[^>]*>/g)].map(match => match[0]).filter(tag => /rel="stylesheet"/.test(tag) && !/href="https?:/.test(tag)).filter(tag => {
  const href = tag.match(/href="([^"]+)"/)?.[1]; if (!href) return false;
  const filename = href.split('?')[0], absolute = path.resolve(root, filename);
  if (!absolute.startsWith(root + path.sep) || !fs.existsSync(absolute)) return false;
  assets['/' + filename.replace(/\\/g, '/')] = ['text/css', filename]; return true;
}).join('\n');
const server = http.createServer((req, res) => {
  const pathname = new URL(req.url, 'http://localhost').pathname;
  if (assets[pathname]) { res.setHeader('Content-Type', assets[pathname][0]); return res.end(fs.readFileSync(path.join(root, assets[pathname][1]))); }
  if (pathname !== '/') { res.writeHead(404); return res.end(); }
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.end(`<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1">${styles}<style>body{display:block;min-height:100vh;padding:24px 16px}#view-whatsapp{display:block;max-width:1040px;margin:auto}</style></head><body><section id="view-whatsapp" class="view active">${section}</section><script>
  location.hash='whatsapp'; window.SupabaseAuth={getUser:()=>({id:'fixture-only'}),getAccessToken:()=> 'fixture-token'};
  window.allLeads=[{company:'Olive Hotel',city:'Delhi',phone:'9876543210'},{company:'Cream Hospital',city:'Noida',phone:'9876543211'}];
  window.fetch=async(url,options={})=>({ok:true,json:async()=> url.endsWith('/connection')?{connected:true,display_phone_number:'+91 90000 00000',quota:{used:3,limit:20,left:17}}:url.endsWith('/templates')?{templates:[{name:'service_introduction',language:'en',status:'APPROVED',components:[{type:'BODY',text:'Hello {{1}}, thank you for requesting details of our housekeeping services in {{2}}.'}]}]}:url.endsWith('/messages/template')?{status:'accepted'}:{messages:[{to:'919876543210',template:'service_introduction',status:'delivered',created_at:'2026-10-08 10:30'}]}});
  </script><script src="/whatsapp-cloud.js"></script></body></html>`);
});
server.listen(Number(process.env.WA_FIXTURE_PORT) || 3191, '127.0.0.1', () => console.log('Offline WhatsApp UI fixture: http://127.0.0.1:3191/'));
