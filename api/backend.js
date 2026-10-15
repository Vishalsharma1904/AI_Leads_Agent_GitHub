'use strict';
// Same-origin cloud gateway. Its destination is server configuration only.
const { backendOrigin } = require('../electron/runtime-config');
const { Readable } = require('node:stream');
module.exports = async function backendProxy(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  let origin;
  try { origin = backendOrigin(process.env.RUDRA_BACKEND_URL || ''); }
  catch (_) { return res.status(503).json({detail:'The workspace cloud connection is not configured.'}); }
  if (!['GET','POST','PUT','PATCH','DELETE'].includes(req.method)) return res.status(405).json({detail:'Method not allowed'});
  const route = String(req.query.path || '').replace(/^\/+/, '');
  if (!/^[A-Za-z0-9_/-]+$/.test(route) || route.split('/').includes('..')) return res.status(400).json({detail:'Invalid API path'});
  const url = new URL('/api/' + route, origin);
  for (const [key, value] of Object.entries(req.query)) if (key !== 'path') for (const part of Array.isArray(value) ? value : [value]) url.searchParams.append(key,String(part));
  const headers = {};
  for (const name of ['authorization','content-type','accept','idempotency-key','x-razorpay-signature']) if (req.headers[name]) headers[name] = req.headers[name];
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 55000);
  res.on('close', () => { if (!res.writableEnded) controller.abort(); });
  try {
    let body;
    if (!['GET','DELETE'].includes(req.method)) {
      if (req.body === undefined && typeof req[Symbol.asyncIterator] === 'function') {
        const chunks=[];let size=0;
        for await (const chunk of req) {size+=chunk.length;if(size>8*1024*1024)return res.status(413).json({detail:'Request too large'});chunks.push(chunk);}
        body=Buffer.concat(chunks);
      } else body = Buffer.isBuffer(req.body) || typeof req.body === 'string' ? req.body : JSON.stringify(req.body || {});
      if (Buffer.byteLength(body) > 8*1024*1024) return res.status(413).json({detail:'Request too large'});
    }
    const upstream = await fetch(url, {method:req.method,headers,body,redirect:'error',signal:controller.signal});
    res.status(upstream.status);res.setHeader('Content-Type',upstream.headers.get('content-type') || 'application/json');
    if (upstream.headers.get('retry-after')) res.setHeader('Retry-After',upstream.headers.get('retry-after'));
    if (!upstream.body) return res.end();
    await new Promise((resolve,reject) => { const stream=Readable.fromWeb(upstream.body); stream.on('error',reject);res.once('finish',resolve);res.once('close',resolve);stream.pipe(res); });
  } catch (_) {
    if (!res.headersSent) res.status(502).json({detail:'The workspace cloud connection is unavailable. Refresh operation history before retrying.'});
    else res.end();
  } finally { clearTimeout(timer); }
};

module.exports.config = {api:{bodyParser:false}};
