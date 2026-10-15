// Bump VERSION for every PWA release. One complete asset snapshot per version.
const VERSION = 'v5';
const CACHE = 'rudra24-mobile-' + VERSION;
const SHELL = ['./','./index.html','./mobile.css','./mobile.js','./account-control.js','./google-auth.js','./contract.js','./crm.js','./icon.svg','./icon-192.png','./icon-512.png','./manifest.webmanifest'];
self.addEventListener('install', event => event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(SHELL.map(asset => new Request(new URL(asset,self.location),{cache:'reload'}))))));
self.addEventListener('message', event => {
  if (event.data?.type !== 'APPLY_UPDATE') return;
  // A second tab may hold unsaved work. Wait for it to close instead of reloading it.
  event.waitUntil(self.clients.matchAll({type:'window',includeUncontrolled:true}).then(clients => {
    if (clients.length === 1 && clients[0].id === event.source?.id) return self.skipWaiting();
    event.source?.postMessage({type:'UPDATE_DEFERRED'});
  }));
});
self.addEventListener('activate', event => event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key.startsWith('rudra24-mobile-') && key !== CACHE).map(key => caches.delete(key)))).then(()=>self.clients.claim())));
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  // Never cache authenticated API responses, account data, tokens or provider requests.
  if (event.request.method !== 'GET' || url.origin !== self.location.origin || url.search || url.pathname.includes('/api/') || !SHELL.some(path => new URL(path,self.location).pathname === url.pathname)) return;
  // No runtime asset replacement: JS/CSS from different releases must not mix.
  event.respondWith(caches.open(CACHE).then(cache=>cache.match(event.request)).then(response=>response||fetch(event.request)));
});
