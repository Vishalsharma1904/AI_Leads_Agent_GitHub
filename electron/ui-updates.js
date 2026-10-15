'use strict';
// Downloaded UI is data served to the sandboxed renderer, never required as Node code.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const zlib = require('node:zlib');
const LIMITS = { manifest: 1024 * 1024, bundle: 64 * 1024 * 1024, expanded: 128 * 1024 * 1024, files: 5000 };
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const version = value => {
  if (typeof value !== 'string' || !/^\d{1,6}\.\d{1,6}\.\d{1,6}$/.test(value)) throw Error('Invalid release version');
  return value.split('.').map(Number);
};
function compare(a, b) { const aa = version(a), bb = version(b); return aa[0] - bb[0] || aa[1] - bb[1] || aa[2] - bb[2]; }
function safePath(name) {
  if (typeof name !== 'string' || name.length > 240 || !/^[a-zA-Z0-9_@/(). -]+$/.test(name) ||
      name.split('/').some(part => !part || part === '.' || part === '..' || /[. ]$/.test(part) || /^(con|prn|aux|nul|com\d|lpt\d)(\.|$)/i.test(part)) ||
      /(?:secret|credential|backup|test)/i.test(name)) throw Error('Invalid UI asset path');
  const roots = ['assets', 'audio', 'fonts', 'vendor'];
  if (name.includes('/') && !roots.includes(name.split('/')[0]) && name !== 'node_modules/@supabase/supabase-js/dist/umd/supabase.js') throw Error('UI asset directory is not allowed');
  if (!/\.(?:html|js|css|json|svg|png|jpe?g|webp|gif|ico|woff2?|ttf|mp3|wav|ogg|mp4|webm)$/i.test(name) ||
      /^(?:package(?:-lock)?\.json|serve-clavis\.js|desktop-config\.js|desktop-setup\.(?:html|js|css))$/i.test(name)) throw Error('UI asset type is not allowed');
  return name;
}
function trustedURL(raw, hosts) {
  const url = new URL(raw);
  if (url.protocol !== 'https:' || url.username || url.password || url.hash || (url.port && url.port !== '443') || !hosts.includes(url.hostname)) throw Error('Untrusted update URL');
  return url.href;
}
async function download(raw, max, hosts, fetcher = fetch) {
  const response = await fetcher(trustedURL(raw, hosts), { redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(120000) });
  if (!response.ok || Number(response.headers.get('content-length') || 0) > max) throw Error('Update download rejected');
  const chunks = []; let size = 0;
  for await (const chunk of response.body) {
    size += chunk.length;
    if (size > max) { await response.body.cancel?.().catch(() => {}); throw Error('Update exceeds byte limit'); }
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}
function verifyManifest(bytes, envelope, trust, shellVersion) {
  if (!trust.publicKey || !trust.hosts?.length) throw Error('UI update trust is not provisioned');
  if (!/^[a-f0-9]{64}$/.test(envelope.sha256) || hash(bytes) !== envelope.sha256) throw Error('Manifest hash mismatch');
  const key = crypto.createPublicKey(trust.publicKey);
  if (key.asymmetricKeyType !== 'ed25519' || !crypto.verify(null, bytes, key, Buffer.from(envelope.signature || '', 'base64'))) throw Error('Manifest signature mismatch');
  const manifest = JSON.parse(bytes.toString('utf8'));
  if (manifest.schema !== 1 || manifest.platform !== 'desktop-ui' || !/^[a-f0-9]{64}$/.test(manifest.bundle?.sha256) ||
      !Number.isInteger(manifest.bundle.bytes) || manifest.bundle.bytes < 1 || manifest.bundle.bytes > LIMITS.bundle ||
      !Array.isArray(manifest.files) || !manifest.files.length || manifest.files.length > LIMITS.files) throw Error('Invalid UI manifest');
  version(manifest.version);
  if (compare(shellVersion, manifest.compatibility?.minShell) < 0 || compare(shellVersion, manifest.compatibility?.maxShell) > 0) throw Error('Shell version is incompatible');
  trustedURL(manifest.bundle.url, trust.hosts);
  const names = new Set(); let size = 0;
  for (const file of manifest.files) {
    safePath(file.path);
    const lower = file.path.toLowerCase();
    if (names.has(lower) || !Number.isInteger(file.bytes) || file.bytes < 0 || !/^[a-f0-9]{64}$/.test(file.sha256)) throw Error('Invalid UI file manifest');
    names.add(lower); size += file.bytes;
  }
  if (size > LIMITS.expanded || !names.has('index.html') || !names.has('update-client.js')) throw Error('UI bundle is incomplete or too large');
  return manifest;
}
function unpack(bytes, manifest, destination) {
  if (bytes.length !== manifest.bundle.bytes || hash(bytes) !== manifest.bundle.sha256) throw Error('Bundle hash mismatch');
  const data = JSON.parse(zlib.gunzipSync(bytes, { maxOutputLength: LIMITS.expanded }).toString('utf8'));
  if (!Array.isArray(data.files) || data.files.length !== manifest.files.length) throw Error('Bundle file list mismatch');
  const expected = new Map(manifest.files.map(file => [file.path, file]));
  for (const file of data.files) {
    safePath(file.path);
    const spec = expected.get(file.path);
    if (!spec || typeof file.data !== 'string' || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(file.data)) throw Error('Bundle file mismatch');
    const content = Buffer.from(file.data, 'base64');
    if (content.length !== spec.bytes || hash(content) !== spec.sha256) throw Error('Asset hash mismatch');
    expected.delete(file.path);
    const target = path.resolve(destination, file.path);
    if (!target.startsWith(path.resolve(destination) + path.sep)) throw Error('Asset escaped UI directory');
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, content, { flag: 'wx' });
  }
}
function atomicJSON(file, data) { fs.writeFileSync(file + '.tmp', JSON.stringify(data)); fs.renameSync(file + '.tmp', file); }
class UIUpdates {
  constructor(directory, installed, shellVersion, trust, fetcher = fetch) {
    this.directory = directory; this.installed = installed; this.shellVersion = shellVersion; this.trust = trust; this.fetcher = fetcher;
    fs.mkdirSync(directory, { recursive: true });
    this.statePath = path.join(directory, 'state.json');
    try {
      if (fs.statSync(this.statePath).size > 256 * 1024) throw Error('Update state exceeds byte limit');
      this.state = JSON.parse(fs.readFileSync(this.statePath));
      if (!this.state || typeof this.state !== 'object' || Array.isArray(this.state)) throw Error('Invalid update state');
      this.state.rejected = (Array.isArray(this.state.rejected) ? this.state.rejected : []).filter(value => /^[a-f0-9]{64}$/.test(value)).slice(-32);
    } catch (_) { this.state = {}; }
    this.running = false;
  }
  save() { atomicJSON(this.statePath, this.state); }
  root(record) {
    if (!record || !/^[a-f0-9]{64}$/.test(record.hash)) return this.installed;
    const root = path.join(this.directory, record.hash);
    try {
      const bytes = fs.readFileSync(path.join(root, 'manifest.json'));
      const manifest = verifyManifest(bytes, record.envelope, this.trust, this.shellVersion);
      if (record.version !== manifest.version || record.hash !== hash(bytes)) throw Error('Stored release mismatch');
      for (const file of manifest.files) {
        const contents = fs.readFileSync(path.join(root, 'ui', file.path));
        if (contents.length !== file.bytes || hash(contents) !== file.sha256) throw Error('Stored UI integrity failed');
      }
      return path.join(root, 'ui');
    } catch (_) { return this.installed; }
  }
  fallback() {
    const failed = this.state.active;
    this.state.rejected = [...new Set([...(this.state.rejected || []), failed?.hash].filter(Boolean))].slice(-32);
    this.state.active = this.state.previous || null; this.state.previous = null; this.state.attempting = false; this.save();
    return this.root(this.state.active);
  }
  start() {
    if (this.state.attempting) this.fallback();
    if (this.state.pending) {
      if (this.state.pending.installed === true) {
        this.state.active = null; this.state.previous = null;
      } else if (this.root(this.state.pending) !== this.installed) {
        this.state.previous = this.state.pending.rollback ? null : this.state.active || null;
        this.state.active = this.state.pending;
      }
      this.state.pending = null;
    }
    let root = this.root(this.state.active);
    if (root === this.installed && this.state.active) root = this.fallback();
    if (root === this.installed) this.state.active = null;
    this.state.attempting = !!this.state.active; this.save();
    return root;
  }
  healthy() {
    this.state.attempting = false; this.save();
    const retained = new Set([this.state.active?.hash, this.state.previous?.hash, this.state.pending?.hash]);
    for (const name of fs.readdirSync(this.directory)) {
      if (/^[a-f0-9]{64}(?:\.tmp)?$/.test(name) && !retained.has(name) && !this.running) {
        fs.rmSync(path.join(this.directory, name), { recursive: true, force: true });
      }
    }
  }
  status() { return { enabled: !!(this.trust.publicKey && this.trust.hosts?.length), active: this.state.active?.version || this.shellVersion, pending: this.state.pending?.version || null, downloading: this.running }; }
  rollbackToPrevious(releaseId) {
    if (!this.state.active || this.state.active.releaseId !== releaseId) return this.status();
    const previous = this.state.previous;
    this.state.pending = previous && this.root(previous) !== this.installed ? { ...previous, rollback: true } : { installed: true, version: this.shellVersion };
    this.save(); return this.status();
  }
  async stage(release) {
    if (!release) { this.state.pending = null; this.save(); return this.status(); }
    if (this.running || !release || release.platform !== 'desktop-ui' || !['published', 'released'].includes(release.status)) return this.status();
    this.running = true;
    try {
      const envelope = release.manifest;
      const bytes = await download(envelope.url, LIMITS.manifest, this.trust.hosts, this.fetcher);
      const manifest = verifyManifest(bytes, envelope, this.trust, this.shellVersion);
      const digest = hash(bytes);
      if (release.version !== manifest.version) throw Error('Release identity mismatch');
      if (this.state.rejected?.includes(digest) || digest === this.state.active?.hash || digest === this.state.pending?.hash) return this.status();
      if (release.rollback_from && this.state.active && compare(manifest.version, this.state.active.version) < 0) {
        const previous = this.state.previous;
        if (previous?.hash === digest && previous.version === manifest.version && this.root(previous) !== this.installed) {
          this.state.pending = { ...previous, rollback: true }; this.save(); return this.status();
        }
        if (!previous && manifest.version === this.shellVersion) {
          this.state.pending = { installed: true, version: this.shellVersion }; this.save(); return this.status();
        }
        throw Error('Rollback is not a previously verified release');
      }
      if (compare(manifest.version, this.state.active?.version || this.shellVersion) <= 0) return this.status();
      const packed = await download(manifest.bundle.url, LIMITS.bundle, this.trust.hosts, this.fetcher);
      const target = path.join(this.directory, digest), temp = path.join(this.directory, digest + '.tmp');
      // Both paths are fixed SHA256 names under our own UI directory.
      fs.rmSync(temp, { recursive: true, force: true }); fs.mkdirSync(temp);
      try {
        unpack(packed, manifest, path.join(temp, 'ui'));
        fs.writeFileSync(path.join(temp, 'manifest.json'), bytes);
        if (fs.existsSync(target)) fs.rmSync(target, { recursive: true, force: true });
        fs.renameSync(temp, target);
      } catch (error) { fs.rmSync(temp, { recursive: true, force: true }); throw error; }
      this.state.pending = { hash: digest, version: manifest.version, envelope, releaseId: release.id }; this.save();
      return this.status();
    } finally { this.running = false; }
  }
}
module.exports = { UIUpdates, LIMITS, hash, compare, safePath, trustedURL, download, verifyManifest, unpack, atomicJSON };
