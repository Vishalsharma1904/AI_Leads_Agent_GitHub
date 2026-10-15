'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const vm = require('node:vm');
const { UIUpdates, hash, safePath, trustedURL, verifyManifest, download, LIMITS } = require('../electron/ui-updates');
const { build, buildWeb } = require('../scripts/build-ui-release');

async function main() {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'rudra-update-selftest-'));
  const source = path.join(temp, 'source'), output = path.join(temp, 'output');
  // Ephemeral fixture key only; no production signing key is generated or stored.
  const { privateKey, publicKey } = crypto.generateKeyPairSync('ed25519');
  const trust = { publicKey: publicKey.export({ type: 'spki', format: 'pem' }), hosts: ['updates.example.com'] };
  fs.mkdirSync(path.join(source, 'electron'), { recursive: true });
  fs.writeFileSync(path.join(source, 'electron', 'update-trust.json'), JSON.stringify(trust));
  fs.writeFileSync(path.join(source, 'index.html'), '<main>fixture</main>');
  fs.writeFileSync(path.join(source, 'update-client.js'), 'window.fixture = true;');
  const options = { privateKey: privateKey.export({ type: 'pkcs8', format: 'pem' }), version: '1.0.7', minShell: '1.0.6', maxShell: '1.0.6', baseURL: 'https://updates.example.com/ui/', tested: true };
  const release = { ...build(source, output, options), id: 'backend-generated-id', status: 'published' };
  const requests = [];
  const fetcher = async (url, init) => {
    requests.push({ url, init });
    const bytes = fs.readFileSync(path.join(output, path.basename(new URL(url).pathname)));
    return new Response(bytes);
  };
  const store = path.join(temp, 'cache');
  const updater = () => new UIUpdates(store, source, '1.0.6', trust, fetcher);
  try {
    let manager = updater();
    assert.equal(manager.start(), source);
    assert.equal((await manager.stage(release)).pending, '1.0.7');
    assert.equal(manager.state.active, null, 'download must not switch active UI');
    assert(requests.every(request => request.init.redirect === 'error'));
    manager = updater();
    const firstRoot = manager.start(); assert.notEqual(firstRoot, source);
    assert(fs.readFileSync(path.join(firstRoot, 'index.html'), 'utf8').includes('fixture'));
    manager.healthy();
    const second = { ...build(source, output, { ...options, version: '1.0.8' }), status: 'published', id: 'second' };
    await manager.stage(second);
    manager = updater(); const secondRoot = manager.start(); assert.notEqual(secondRoot, firstRoot);
    manager = updater(); assert.equal(manager.start(), firstRoot, 'failed first boot falls back to last known UI');
    manager.healthy();
    await assert.rejects(manager.stage({ ...release, manifest: { ...release.manifest, signature: 'AAAA' } }), /signature/);
    await assert.rejects(manager.stage({ ...release, version: '2.0.0' }), /identity/);
    const manifestBytes = fs.readFileSync(path.join(output, path.basename(new URL(release.manifest.url).pathname)));
    assert.throws(() => verifyManifest(manifestBytes, release.manifest, trust, '2.0.0'), /incompatible/);
    assert.throws(() => verifyManifest(Buffer.from('tampered'), release.manifest, trust, '1.0.6'), /hash/);
    for (const name of ['../index.html', 'assets/../../electron/main.js', '/index.html', 'assets/a\\b.js', 'assets/x:evil.js', 'assets/CON.js', 'electron/main.js', 'assets/x./evil.js', 'serve-clavis.js']) assert.throws(() => safePath(name));
    for (const url of ['http://updates.example.com/a', 'https://evil.example.com/a', 'https://user:pass@updates.example.com/a', 'https://updates.example.com:444/a']) assert.throws(() => trustedURL(url, trust.hosts));
    await assert.rejects(download('https://updates.example.com/a', 2, trust.hosts, async () => new Response('123')), /byte limit/);
    assert.throws(() => build(source, output, { ...options, privateKey: crypto.generateKeyPairSync('ed25519').privateKey.export({ type: 'pkcs8', format: 'pem' }) }), /trusted public key/);
    fs.writeFileSync(path.join(firstRoot, 'index.html'), 'modified');
    manager = updater(); assert.equal(manager.start(), source, 'local asset tampering falls back to immutable installed UI');
    // Cached rollback to the installed version is accepted; arbitrary lower artifacts are rejected.
    const freshStore = path.join(temp, 'rollback-cache');
    const fresh = () => new UIUpdates(freshStore, source, '1.0.6', trust, fetcher);
    manager = fresh();manager.start();await manager.stage(release);manager = fresh();manager.start();manager.healthy();
    const installed = { ...build(source, output, { ...options, version: '1.0.6' }), status: 'published', rollback_from: 'rolled-back-db-id' };
    assert.equal((await manager.stage(installed)).pending, '1.0.6');
    manager = fresh();assert.equal(manager.start(), source);
    await manager.stage(release);await manager.stage(null);assert.equal(manager.status().pending, null, 'paused discovery clears pending update');
    const cacheRollbackStore = path.join(temp, 'previous-cache');
    const cached = () => new UIUpdates(cacheRollbackStore, source, '1.0.6', trust, fetcher);
    manager = cached();manager.start();await manager.stage(release);manager = cached();const cachedFirst = manager.start();manager.healthy();
    await manager.stage(second);manager = cached();manager.start();manager.healthy();
    assert.equal((await manager.stage({ ...release, rollback_from: 'second-db-id' })).pending, '1.0.7');
    manager = cached();assert.equal(manager.start(), cachedFirst);
    // SW contract: no API/auth caching, stable asset snapshot, explicit single-tab activation.
    const events = {}, cacheEvents = [];
    const worker = { location: new URL('https://mobile.example.com/sw.js'), addEventListener: (name, fn) => { events[name] = fn; }, clients: { matchAll: async () => [{ id: 'tab' }], claim: async () => {} }, skipWaiting: async () => cacheEvents.push('activate') };
    vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', 'Rudra24Mobile', 'pwa', 'sw.js'), 'utf8'), { self: worker, URL, Request, caches: { open: async () => ({ match: async () => new Response('cached') }) }, fetch: async () => new Response('network') });
    for (const url of ['https://mobile.example.com/api/private', 'https://mobile.example.com/public-auth-config.json', 'https://mobile.example.com/index.html?code=secret', 'https://auth.example.com/auth/v1/token']) {
      let handled = false; events.fetch({ request: new Request(url), respondWith: () => { handled = true; } }); assert.equal(handled, false, url);
    }
    let activated;events.message({ data: { type: 'APPLY_UPDATE' }, source: { id: 'tab' }, waitUntil: value => { activated = value; } }); await activated;assert.deepEqual(cacheEvents, ['activate']);
    // Hosted web build stamps an exact manifest hash and preserves other cache namespaces.
    fs.copyFileSync(path.join(__dirname,'..','sw.js'),path.join(source,'sw.js'));
    const webManifest=buildWeb(source,'1.0.7');assert.equal(webManifest.files.length,2);
    const webEvents={}, stored=new Map(),removed=[];
    const webCache={put:async(url,response)=>stored.set(String(url),response),match:async url=>stored.get(String(url)),keys:async()=>Array.from(stored.keys()).map(url=>new Request(url))};
    const webWorker={...worker,registration:{scope:'https://mobile.example.com/'},addEventListener:(name,fn)=>{webEvents[name]=fn;}};
    vm.runInNewContext(fs.readFileSync(path.join(source,'sw.js'),'utf8'),{self:webWorker,URL,Request,Response,TextDecoder,Uint8Array,crypto:crypto.webcrypto,
      caches:{open:async()=>webCache,keys:async()=>['unrelated-account-cache','rudra24-web-old'],delete:async name=>removed.push(name)},
      fetch:async url=>new Response(fs.readFileSync(path.join(source,path.basename(new URL(url).pathname))),{headers:{'content-type':String(url).endsWith('.js')?'application/javascript':'text/html'}})});
    let work;webEvents.install({waitUntil:value=>{work=value;}});await work;assert.equal(stored.size,2);
    webEvents.activate({waitUntil:value=>{work=value;}});await work;assert.deepEqual(removed,['rudra24-web-old']);
    for(const url of ['https://mobile.example.com/api/private','https://mobile.example.com/index.html?code=secret','https://auth.example.com/auth/v1/token']){
      let handled=false;webEvents.fetch({request:new Request(url),respondWith:()=>{handled=true;}});assert.equal(handled,false,url);
    }
    let cachedResponse;webEvents.fetch({request:new Request('https://mobile.example.com/update-client.js?v=old'),respondWith:value=>{cachedResponse=value;}});assert.equal(await (await cachedResponse).text(),'window.fixture = true;');
    console.log('update delivery selftest: passed (signatures, hashes, size bounds, paths, atomic stage, restart/fallback, cached rollback, pause, PWA auth exclusions)');
  } finally {
    if (!temp.startsWith(path.join(os.tmpdir(), 'rudra-update-selftest-'))) throw Error('Unsafe fixture cleanup');
    fs.rmSync(temp, { recursive: true, force: true });
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
