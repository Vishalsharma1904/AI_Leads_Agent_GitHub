'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const zlib = require('node:zlib');
const { safePath, trustedURL, hash, compare, LIMITS } = require('../electron/ui-updates');

function collect(root) {
  const packed = [], files = [];
  function add(relative) {
    if (relative === 'web-assets.json' || relative === 'sw.js') return;
    try { safePath(relative); } catch (_) { return; }
    const filename = path.join(root, relative);
    if (fs.lstatSync(filename).isSymbolicLink()) throw Error('Symlinks are not release assets');
    const bytes = fs.readFileSync(filename);
    if (/\.(?:html|js|json)$/i.test(relative) && /(?:AIza[\w-]{30,}|gsk_[\w-]{30,}|sk-or-v1-[\w-]{30,}|sb_secret_[\w-]{20,}|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----)/.test(bytes.toString('utf8'))) throw Error('Possible secret in ' + relative);
    files.push({ path: relative, bytes: bytes.length, sha256: hash(bytes) });
    packed.push({ path: relative, data: bytes.toString('base64') });
  }
  function walk(directory) {
    for (const name of fs.readdirSync(path.join(root, directory))) {
      const relative = directory + '/' + name, stat = fs.lstatSync(path.join(root, relative));
      if (stat.isSymbolicLink()) throw Error('Symlinks are not release assets');
      if (stat.isDirectory()) walk(relative); else add(relative);
    }
  }
  for (const name of fs.readdirSync(root).sort()) if (fs.lstatSync(path.join(root, name)).isFile()) add(name);
  for (const directory of ['assets', 'audio', 'fonts', 'vendor']) if (fs.existsSync(path.join(root, directory))) walk(directory);
  const supabase = 'node_modules/@supabase/supabase-js/dist/umd/supabase.js';
  if (fs.existsSync(path.join(root, supabase))) add(supabase);
  if (files.length > LIMITS.files || !files.some(f => f.path === 'index.html') || !files.some(f => f.path === 'update-client.js') || files.reduce((size, f) => size + f.bytes, 0) > LIMITS.expanded) throw Error('UI assets are incomplete or too large');
  return { files, packed };
}
function build(root, output, options) {
  const key = crypto.createPrivateKey(options.privateKey);
  if (key.asymmetricKeyType !== 'ed25519') throw Error('An Ed25519 signing key is required');
  compare(options.version, options.version); compare(options.minShell, options.maxShell);
  const publicKey = crypto.createPublicKey(key).export({ type: 'spki', format: 'pem' });
  const trust = JSON.parse(fs.readFileSync(path.join(root, 'electron', 'update-trust.json'), 'utf8'));
  if (!trust.publicKey || crypto.createPublicKey(trust.publicKey).export({ type: 'spki', format: 'pem' }) !== publicKey) throw Error('Signing key does not match the bundled trusted public key');
  const origin = trustedURL(options.baseURL, trust.hosts).replace(/\/+$/, '') + '/';
  const { files, packed } = collect(root);
  const expanded = Buffer.from(JSON.stringify({ files: packed }));
  if (expanded.length > LIMITS.expanded) throw Error('Expanded release exceeds byte limit');
  const bundle = zlib.gzipSync(expanded);
  if (bundle.length > LIMITS.bundle) throw Error('Compressed release exceeds byte limit');
  const bundleName = 'ui-' + options.version + '-' + hash(bundle).slice(0, 16) + '.json.gz';
  const manifest = { schema: 1, id: crypto.randomUUID(), platform: 'desktop-ui', version: options.version,
    compatibility: { minShell: options.minShell, maxShell: options.maxShell },
    bundle: { url: new URL(bundleName, origin).href, sha256: hash(bundle), bytes: bundle.length }, files };
  const manifestBytes = Buffer.from(JSON.stringify(manifest));
  if (manifestBytes.length > LIMITS.manifest) throw Error('Manifest exceeds byte limit');
  const manifestName = 'manifest-' + options.version + '-' + hash(manifestBytes).slice(0, 16) + '.json';
  const release = { version: options.version, platform: 'desktop-ui', notes: options.notes || '',
    manifest: { url: new URL(manifestName, origin).href, sha256: hash(manifestBytes), signature: crypto.sign(null, manifestBytes, key).toString('base64'), tested: !!options.tested, compatibility: manifest.compatibility } };
  fs.mkdirSync(output, { recursive: true });
  fs.writeFileSync(path.join(output, bundleName), bundle, { flag: 'wx' });
  fs.writeFileSync(path.join(output, manifestName), manifestBytes, { flag: 'wx' });
  fs.writeFileSync(path.join(output, 'release-' + options.version + '.json'), JSON.stringify(release, null, 2), { flag: 'wx' });
  return release;
}
function buildWeb(root, releaseVersion) {
  compare(releaseVersion, releaseVersion);
  const { files } = collect(root);
  const manifest = { schema: 1, version: releaseVersion, files };
  const worker = path.join(root, 'sw.js'), source = fs.readFileSync(worker, 'utf8');
  if (!source.includes("const RELEASE_VERSION = '") || !source.includes("const RELEASE_HASH = '")) throw Error('Web worker release marker is missing');
  const bytes = JSON.stringify(manifest);
  fs.writeFileSync(path.join(root, 'web-assets.json'), bytes);
  fs.writeFileSync(worker, source.replace(/const RELEASE_VERSION = '[^']*';/, "const RELEASE_VERSION = '" + releaseVersion + "';")
    .replace(/const RELEASE_HASH = '[^']*';/, "const RELEASE_HASH = '" + hash(bytes) + "';"));
  return manifest;
}
if (require.main === module) {
  const env = process.env, root = path.resolve(__dirname, '..');
  if (process.argv.includes('--web')) {
    const result = buildWeb(root, env.RUDRA_WEB_VERSION);
    console.log('Web asset snapshot prepared:', result.version, result.files.length, 'files (deploy complete directory atomically)');
    process.exit(0);
  }
  if (!env.RUDRA_UI_SIGNING_KEY || !env.RUDRA_UI_VERSION || !env.RUDRA_UI_BASE_URL || !env.RUDRA_UI_MIN_SHELL || !env.RUDRA_UI_MAX_SHELL) throw Error('Provide RUDRA_UI_SIGNING_KEY, VERSION, BASE_URL, MIN_SHELL and MAX_SHELL through environment only');
  const result = build(root, path.join(root, 'release', 'ui'), { privateKey: env.RUDRA_UI_SIGNING_KEY, version: env.RUDRA_UI_VERSION,
    baseURL: env.RUDRA_UI_BASE_URL, minShell: env.RUDRA_UI_MIN_SHELL, maxShell: env.RUDRA_UI_MAX_SHELL,
    tested: env.RUDRA_UI_TESTED === 'true', notes: env.RUDRA_UI_NOTES });
  console.log('Signed UI release prepared:', result.version, result.manifest.sha256, '(upload/publish separately)');
}
module.exports = { build, buildWeb };
