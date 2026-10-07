'use strict';

// Same-origin, authenticated OmniDimension API. No Render/database dependency.
// ponytail: encrypted session cookie lasts 8 hours; use the existing database
// credential vault when persistent cross-device connections are needed.
const crypto = require('node:crypto');
const defaults = require('../public-auth-config.json');
const contract = require('../omnidimension-contract.json');
const BASE = 'https://omnidim.io/api/v1';
const COOKIE = '__Host-rudra-omni';
const MAX_BODY = 3 * 1024 * 1024;
const fail = (status, detail) => Object.assign(new Error(detail), { status });

function master() {
  const key = process.env.OMNIDIM_SESSION_KEY || '';
  if (key.length < 32) throw fail(503, 'OmniDimension secure connection is not configured on this deployment.');
  return crypto.createHash('sha256').update(key).digest();
}
function seal(secret, user) {
  const iv = crypto.randomBytes(12), cipher = crypto.createCipheriv('aes-256-gcm', master(), iv);
  cipher.setAAD(Buffer.from(user));
  const encrypted = Buffer.concat([cipher.update(JSON.stringify({ secret, until: Date.now() + 8 * 3600000 })), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString('base64url');
}
function unseal(cookie, user) {
  try {
    const bytes = Buffer.from(cookie, 'base64url');
    const decipher = crypto.createDecipheriv('aes-256-gcm', master(), bytes.subarray(0, 12));
    decipher.setAAD(Buffer.from(user)); decipher.setAuthTag(bytes.subarray(12, 28));
    const value = JSON.parse(Buffer.concat([decipher.update(bytes.subarray(28)), decipher.final()]).toString());
    return value.until > Date.now() && typeof value.secret === 'string' ? value.secret : '';
  } catch (error) { if (error.status === 503) throw error; return ''; }
}
function validate(value, schema, name = 'Request') {
  if (schema.allOf) schema.allOf.forEach(part => validate(value, part, name));
  for (const kind of ['oneOf', 'anyOf']) if (schema[kind]) {
    if (!schema[kind].some(part => { try { validate(value, part, name); return true; } catch (_) { return false; } })) throw fail(422, `${name}: invalid value`);
  }
  const type = schema.type;
  if (type && !(Array.isArray(type) ? type : [type]).some(t => t === 'object' ? value && typeof value === 'object' && !Array.isArray(value) : t === 'array' ? Array.isArray(value) : t === 'integer' ? Number.isSafeInteger(value) : t === 'number' ? typeof value === 'number' && Number.isFinite(value) : t === 'null' ? value === null : typeof value === t)) throw fail(422, `${name}: expected ${type}`);
  for (const [key, dependencies] of Object.entries(schema.dependentRequired || {})) if (value && typeof value === 'object' && key in value && dependencies.some(dependency => !(dependency in value))) throw fail(422, `${name}: ${key} requires ${dependencies.join(', ')}`);
  if (schema.enum && !schema.enum.includes(value)) throw fail(422, `${name}: choose a supported value`);
  if (typeof value === 'number' && ((schema.minimum !== undefined && value < schema.minimum) || (schema.maximum !== undefined && value > schema.maximum))) throw fail(422, `${name}: outside allowed range`);
  if (typeof value === 'string' && (value.length > (schema.maxLength || MAX_BODY) || value.length < (schema.minLength || 0))) throw fail(422, `${name}: invalid length`);
  if (Array.isArray(value)) {
    if (value.length < (schema.minItems || 0) || value.length > (schema.maxItems || 1000)) throw fail(422, `${name}: invalid item count`);
    if (schema.items) value.forEach((item, i) => validate(item, schema.items, `${name}[${i}]`));
  } else if (value && typeof value === 'object') {
    for (const required of schema.required || []) if (!(required in value)) throw fail(422, `${name}: ${required} is required`);
    for (const [key, item] of Object.entries(value)) {
      if (['__proto__', 'prototype', 'constructor', 'owner_user_id', 'organization_id', 'user_id'].includes(key)) throw fail(422, `${name}: unsupported identity field`);
      if (schema.properties?.[key]) validate(item, schema.properties[key], `${name}.${key}`);
      else if (schema.additionalProperties === false || schema.properties && schema.additionalProperties !== true && !schema.allOf) throw fail(422, `${name}: unsupported field ${key}`);
    }
  }
}
function operation(method, path) {
  if (typeof path !== 'string' || !/^\/[a-z0-9_/-]+$/.test(path)) throw fail(422, 'Invalid OmniDimension API path');
  const op = contract.find(o => o.method === method && new RegExp('^' + o.path.replace(/\{[^}]+\}/g, '[1-9][0-9]*') + '$').test(path));
  if (!op) throw fail(404, 'This OmniDimension operation is not supported');
  return op;
}
function queryString(query, op) {
  if (!query || typeof query !== 'object' || Array.isArray(query)) throw fail(422, 'Invalid query parameters');
  for (const [key, spec] of Object.entries(op.query)) if (spec.required && !(key in query)) throw fail(422, `${key} is required`);
  for (const [key, value] of Object.entries(query)) {
    if (!op.query[key]) throw fail(422, `Unsupported query parameter ${key}`);
    validate(value, op.query[key].schema, key);
  }
  const text = new URLSearchParams(query).toString();
  if (text.length > 2000) throw fail(422, 'Query is too long');
  return text ? '?' + text : '';
}
function needsConfirmation(method, path, body) {
  return method === 'DELETE' || /\/restore$|\/knowledge_base\/delete|\/phone_number\/(purchase|release|detach)$|\/sessions\/create$|\/calls\/dispatch$|\/simulations\/\d+\/(start|enhance-prompt)$/.test(path) ||
    path.startsWith('/calls/bulk_call') && method !== 'GET' && !(path.endsWith('/create') && body?.save_as_draft === true) && body?.action !== 'pause';
}
function clean(value, secret) {
  if (typeof value === 'string') return value.split(secret).join('[redacted]');
  if (Array.isArray(value)) return value.map(item => clean(item, secret));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).filter(([key]) => !/(?:api[_-]?key|secret|password|account_token|authorization|access_token|sip_password|^token$)/i.test(key)).map(([key, item]) => [key, clean(item, secret)]));
  return value;
}
async function provider(secret, method, path, body) {
  let response;
  try { response = await fetch(BASE + path, { method, redirect: 'error', headers: { Authorization: `Bearer ${secret}`, 'Content-Type': 'application/json' }, body: method === 'GET' || method === 'DELETE' ? undefined : JSON.stringify(body || {}), signal: AbortSignal.timeout(22000) }); }
  catch (_) { throw fail(504, method === 'GET' ? 'OmniDimension is unavailable. Try refreshing.' : 'OmniDimension did not confirm this request. Check agents/call logs before retrying; it may already have been accepted.'); }
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.success === false || data.status === 'error') {
    const status = response.status === 401 || response.status === 403 ? 422 : response.status === 429 ? 429 : response.status >= 400 && response.status < 500 ? response.status : 502;
    const code = String(data.error || data.code || '').replace(/[^a-z0-9_-]/gi, '').slice(0, 80);
    throw fail(status, `OmniDimension ${response.status === 401 || response.status === 403 ? 'rejected the key or permission' : 'could not complete this operation'}${code ? ` (${code})` : ` (${response.status})`}. Check wallet, permissions and configuration.`);
  }
  if (path === '/sessions/create') {
    let ws; try { ws = new URL(data.ws_url); } catch (_) { throw fail(502, 'OmniDimension did not return a web call URL'); }
    if (ws.protocol !== 'wss:' || !(ws.hostname === 'omnidim.io' || ws.hostname.endsWith('.omnidim.io'))) throw fail(502, 'Invalid web call host');
    return { session_id: data.session_id, expires_at: data.expires_at, ws_url: data.ws_url };
  }
  return clean(data, secret);
}
async function authenticate(req) {
  const token = String(req.headers.authorization || '');
  if (!/^Bearer [A-Za-z0-9._-]+$/.test(token) || token.length > 10000) throw fail(401, 'Sign in to connect OmniDimension');
  const url = process.env.SUPABASE_URL || defaults.supabase_url;
  const key = process.env.SUPABASE_PUBLISHABLE_KEY || defaults.supabase_publishable_key;
  if (!/^https:\/\/[a-z0-9-]+\.supabase\.co$/.test(url)) throw fail(503, 'Sign-in verification is unavailable');
  let response;
  try { response = await fetch(url + '/auth/v1/user', { headers: { Authorization: token, apikey: key }, signal: AbortSignal.timeout(7000) }); }
  catch (_) { throw fail(503, 'Sign-in verification is temporarily unavailable'); }
  if (!response.ok) throw fail(401, 'Your sign-in expired. Sign in again.');
  const user = await response.json();
  if (!user.id || user.is_anonymous) throw fail(401, 'A verified account is required');
  return user.id;
}
module.exports = async function omni(req, res) {
  res.setHeader('Cache-Control', 'no-store'); res.setHeader('X-Content-Type-Options', 'nosniff');
  const reply = (status, value) => res.status(status).json(value);
  try {
    if (!['GET', 'POST', 'DELETE'].includes(req.method)) throw fail(405, 'Method not allowed');
    if (req.method !== 'GET') {
      const loopback = !process.env.VERCEL && /^(localhost|127\.0\.0\.1)(:\d+)?$/.test(req.headers.host);
      const expected = new URL((loopback ? 'http://' : 'https://') + req.headers.host).origin;
      if (req.headers.origin !== expected) throw fail(403, 'Use this connection from your own app');
      if (!String(req.headers['content-type'] || '').startsWith('application/json')) throw fail(415, 'JSON request required');
    }
    if (req.method === 'DELETE') {
      res.setHeader('Set-Cookie', `${COOKIE}=; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=0`);
      return reply(200, { connected: false });
    }
    const user = await authenticate(req);
    master();
    const cookie = (String(req.headers.cookie || '').split(';').map(x => x.trim()).find(x => x.startsWith(COOKIE + '=')) || '').slice(COOKIE.length + 1);
    const secret = unseal(cookie, user);
    if (req.method === 'GET') return reply(200, { connected: !!secret, session_hours: 8 });
    let input = req.body;
    if (typeof input === 'string') { try { input = JSON.parse(input); } catch (_) { throw fail(400, 'Invalid JSON'); } }
    if (!input || typeof input !== 'object' || Array.isArray(input) || Buffer.byteLength(JSON.stringify(input)) > MAX_BODY) throw fail(413, 'Request too large. PDF uploads support up to 2 MB.');
    if (input.action === 'connect') {
      const key = typeof input.secret === 'string' ? input.secret.trim() : '';
      if (!key || key.length > 1800 || /[\s\r\n]/.test(key)) throw fail(422, 'Enter a valid OmniDimension API key');
      const account = await provider(key, 'GET', '/account/balance');
      res.setHeader('Set-Cookie', `${COOKIE}=${seal(key, user)}; Path=/; Secure; HttpOnly; SameSite=Strict`);
      return reply(200, { connected: true, account });
    }
    if (!secret) throw fail(409, 'Connect your OmniDimension API key for this sign-in session first');
    const op = operation(input.method, input.path);
    const body = input.body || {}, query = input.query || {};
    validate(body, op.schema);
    if (input.path === '/calls/dispatch' && !/^\+[1-9]\d{7,14}$/.test(body.to_number)) throw fail(422, 'Phone number must include country code, e.g. +919876543210');
    if (needsConfirmation(op.method, input.path, body) && input.confirmed !== true) throw fail(409, 'Confirm this operation and any provider charges before continuing');
    const suffix = queryString(query, op);
    return reply(200, await provider(secret, op.method, input.path + suffix, body));
  } catch (error) { return reply(error.status || 500, { detail: error.status ? error.message : 'OmniDimension connection failed. No credential details were exposed.' }); }
};
module.exports.check = { validate, operation, queryString, needsConfirmation, seal, unseal, clean };
