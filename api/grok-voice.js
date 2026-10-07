'use strict';
const { authenticate, seal, unseal } = require('./omnidimension').check;
const COOKIE = '__Host-rudra-grok';
const fail = (status, message) => Object.assign(new Error(message), { status });
async function upstream(key, path, body) {
  let response;
  try {
    response = await fetch('https://api.x.ai' + path, { method: body ? 'POST' : 'GET', redirect: 'error',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(18000) });
  } catch (_) { throw fail(504, 'xAI did not respond. Check your connection and retry.'); }
  if (!response.ok) throw fail(response.status === 401 || response.status === 403 ? 422 : response.status === 429 ? 429 : 502,
    `xAI rejected this request (${response.status}). Check API key permissions, credits and voice access.`);
  return response.json();
}
module.exports = async function grok(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  try {
    if (!['GET', 'POST', 'DELETE'].includes(req.method)) throw fail(405, 'Method not allowed');
    if (req.method !== 'GET') {
      const local = !process.env.VERCEL && /^(localhost|127\.0\.0\.1)(:\d+)?$/.test(req.headers.host);
      if (req.headers.origin !== new URL((local ? 'http://' : 'https://') + req.headers.host).origin) throw fail(403, 'Use Grok from your own app.');
      if (!String(req.headers['content-type'] || '').startsWith('application/json')) throw fail(415, 'JSON request required');
    }
    if (req.method === 'DELETE') {
      res.setHeader('Set-Cookie', `${COOKIE}=; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=0`);
      return res.status(200).json({ connected: false });
    }
    const owner = 'grok:' + await authenticate(req);
    const cookie = (String(req.headers.cookie || '').split(';').map(x => x.trim()).find(x => x.startsWith(COOKIE + '=')) || '').slice(COOKIE.length + 1);
    const key = unseal(cookie, owner);
    if (req.method === 'GET') return res.status(200).json({ connected: !!key });
    let input = req.body;
    if (typeof input === 'string') { try { input = JSON.parse(input); } catch (_) { throw fail(400, 'Invalid JSON'); } }
    if (!input || typeof input !== 'object' || Array.isArray(input) || JSON.stringify(input).length > 4096) throw fail(413, 'Invalid or oversized request');
    if (!['connect', 'voices', 'token', 'numbers'].includes(input.action) || Object.keys(input).some(k => !['action', 'secret', 'confirmed'].includes(k))) throw fail(422, 'Unsupported operation');
    if (input.action === 'connect') {
      const secret = typeof input.secret === 'string' ? input.secret.trim() : '';
      if (!secret || secret.length > 1800 || /\s/.test(secret)) throw fail(422, 'Enter an xAI API key from console.x.ai → API Keys.');
      const data = await upstream(secret, '/v1/tts/voices');
      res.setHeader('Set-Cookie', `${COOKIE}=${seal(secret, owner)}; Path=/; Secure; HttpOnly; SameSite=Strict`);
      return res.status(200).json({ connected: true, voices: voices(data) });
    }
    if (!key) throw fail(409, 'Connect your xAI API key for this signed-in session first.');
    if (input.action === 'voices') return res.status(200).json({ voices: voices(await upstream(key, '/v1/tts/voices')) });
    if (input.action === 'numbers') {
      const data = await upstream(key, '/v2/phone-numbers?limit=100');
      return res.status(200).json({ numbers: (data.phone_numbers || []).slice(0, 100).map(n => ({ id: n.phone_number_id, name: n.name, phone_number: n.phone_number })) });
    }
    if (input.confirmed !== true) throw fail(409, 'Confirm the live test and xAI usage charges first.');
    const data = await upstream(key, '/v1/realtime/client_secrets', { expires_after: { seconds: 300 } });
    if (typeof data.value !== 'string' || data.value.length > 4000 || !/^[A-Za-z0-9._-]+$/.test(data.value)) throw fail(502, 'xAI did not return a valid live session token.');
    return res.status(200).json({ value: data.value, expires_at: data.expires_at });
  } catch (e) { return res.status(e.status || 500).json({ detail: e.status ? e.message : 'Grok connection failed. Credential details were not exposed.' }); }
};
function voices(data) {
  return (Array.isArray(data.voices) ? data.voices : []).slice(0, 100).map(v => ({ voice_id: v.voice_id, name: v.name }));
}
