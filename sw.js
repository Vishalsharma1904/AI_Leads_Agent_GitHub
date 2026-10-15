'use strict';
// Written by build:web-release. Unprovisioned checkouts use the network normally.
const RELEASE_VERSION = '1.0.9';
const RELEASE_HASH = 'c69b2944ea4ae57f9c9f2fa404bfd5ad53b661a5b2cfe28b93f537edbdffc071';
const PREFIX = 'rudra24-web-';
const CACHE = PREFIX + RELEASE_VERSION + '-' + RELEASE_HASH.slice(0,16);
const MAX_BYTES = 128 * 1024 * 1024;
let paths = new Set();
async function readBounded(response, limit) {
  if (!response.ok || Number(response.headers.get('content-length') || 0) > limit) throw Error('Web download rejected');
  const reader = response.body.getReader(), chunks = [];let size = 0;
  while (true) {
    const item = await reader.read();if(item.done)break;
    size += item.value.byteLength;
    if(size > limit){await reader.cancel();throw Error('Web download exceeds byte limit');}
    chunks.push(item.value);
  }
  const result = new Uint8Array(size);let offset = 0;
  for(const chunk of chunks){result.set(chunk,offset);offset += chunk.byteLength;}
  return result;
}
function assetPath(name) {
  if (typeof name !== 'string' || name.startsWith('/') || name.includes('\\') || name.includes(':') ||
      name.split('/').some(part => !part || part === '.' || part === '..') ||
      /^(api|backend|electron|scripts|tests|clavis-bridge)\//i.test(name) || /(?:secret|credential|desktop-config|desktop-setup|public-auth-config)/i.test(name)) throw Error('Invalid web asset');
  return new URL(name, self.registration.scope).pathname;
}
async function manifest() {
  const response = await fetch(new URL('web-assets.json', self.registration.scope), { cache: 'no-store', credentials: 'omit', redirect: 'error' });
  const bytes = await readBounded(response,1024 * 1024);
  const digest = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)), value=>value.toString(16).padStart(2,'0')).join('');
  if(digest !== RELEASE_HASH)throw Error('Web manifest hash mismatch');
  const text = new TextDecoder().decode(bytes);
  const data = JSON.parse(text);
  if (data.schema !== 1 || data.version !== RELEASE_VERSION || !Array.isArray(data.files) || !data.files.length || data.files.length > 5000) throw Error('Invalid web release');
  return data;
}
self.addEventListener('install', event => {
  if (RELEASE_VERSION === 'unprovisioned') return;
  event.waitUntil((async () => {
    const data = await manifest(), cache = await caches.open(CACHE);
    let total = 0; const names = new Set();
    try {
      for (const file of data.files) {
        const pathname = assetPath(file.path);
        if (names.has(pathname) || !Number.isInteger(file.bytes) || file.bytes < 0 || !/^[a-f0-9]{64}$/.test(file.sha256) || (total += file.bytes) > MAX_BYTES) throw Error('Invalid web asset manifest');
        names.add(pathname);
        const response = await fetch(new URL(file.path, self.registration.scope), { cache: 'no-store', credentials: 'omit', redirect: 'error' });
        const bytes = await readBounded(response,file.bytes);
        if (bytes.byteLength !== file.bytes) throw Error('Web asset size mismatch');
        const digest = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), value => value.toString(16).padStart(2,'0')).join('');
        if (digest !== file.sha256) throw Error('Web asset hash mismatch');
        await cache.put(new URL(file.path, self.registration.scope), new Response(bytes, { headers: { 'Content-Type': response.headers.get('content-type') || 'application/octet-stream' } }));
      }
      if (!names.has(assetPath('index.html')) || !names.has(assetPath('update-client.js'))) throw Error('Web shell incomplete');
      paths = names;
    } catch (error) { await caches.delete(CACHE); throw error; }
  })());
});
self.addEventListener('activate', event => event.waitUntil((async () => {
  if (RELEASE_VERSION === 'unprovisioned') return;
  // Only our namespace is ours to clean. Auth/account data never enters it.
  for (const key of await caches.keys()) if (key.startsWith(PREFIX) && key !== CACHE) await caches.delete(key);
  await self.clients.claim();
})()));
self.addEventListener('message', event => {
  if (event.data?.type !== 'APPLY_UPDATE') return;
  event.waitUntil(self.clients.matchAll({type:'window',includeUncontrolled:true}).then(clients => {
    if (clients.length === 1 && clients[0].id === event.source?.id) return self.skipWaiting();
    event.source?.postMessage({type:'UPDATE_DEFERRED'});
  }));
});
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (RELEASE_VERSION === 'unprovisioned' || event.request.method !== 'GET' || url.origin !== self.location.origin ||
      event.request.headers.has('Authorization') || /\/(?:api|auth)(?:\/|$)/.test(url.pathname) ||
      /(?:^|[?&])(?:code|token|access_token|refresh_token|error)=/.test(url.search) || /desktop-config|public-auth-config/.test(url.pathname)) return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    // Recover known asset paths after worker suspension without a network request.
    if (!paths.size) paths = new Set((await cache.keys()).map(request => new URL(request.url).pathname));
    const root = new URL('.', self.registration.scope).pathname;
    const pathname = url.pathname === root ? assetPath('index.html') : url.pathname;
    if (!paths.has(pathname)) return fetch(event.request);
    const cached = await cache.match(new URL(pathname, self.location.origin));
    return cached || fetch(event.request);
  })());
});
