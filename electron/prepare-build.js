'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { backendOrigin, serviceConfigURL } = require('./runtime-config');
const { trustedURL } = require('./ui-updates');
const crypto = require('node:crypto');

function requireHttps(name, value) {
  try { return backendOrigin(value); }
  catch (error) { throw new Error(`${name}: ${error.message}`); }
}

const backendUrl = process.env.CLAVIS_BACKEND_URL;
const supabaseUrl = process.env.CLAVIS_SUPABASE_URL;
const serviceUrl = process.env.CLAVIS_SERVICE_CONFIG_URL;
// Long-lived provider credentials must never be shipped inside an installer.
const root = path.resolve(__dirname, '..');
for (const name of fs.readdirSync(root)) {
  if (!/\.(js|json|html)$/i.test(name) || name === 'secrets.local.js') continue;
  const source = fs.readFileSync(path.join(root, name), 'utf8');
  if (/(?:AIza[\w-]{30,}|gsk_[\w-]{30,}|sk-or-v1-[\w-]{30,}|sb_secret_[\w-]{20,})/.test(source)) {
    throw new Error(`Refusing to package ${name}: possible private API key. Move it to the server and rotate it.`);
  }
}
if (!!backendUrl !== !!supabaseUrl) {
  throw new Error('Provide both public URLs, or neither for first-run connection setup.');
}
const config = backendUrl ? {
  backendUrl: requireHttps('CLAVIS_BACKEND_URL', backendUrl),
  supabaseUrl: requireHttps('CLAVIS_SUPABASE_URL', supabaseUrl)
} : { backendUrl: '', supabaseUrl: '', firstRunSetup: true };
if (serviceUrl) config.serviceConfigUrl = serviceConfigURL(serviceUrl);
if ((process.env.RUDRA_CUSTOMER_BUILD === 'true' || process.argv.includes('--customer')) && !backendUrl && !serviceUrl) {
  throw Error('Customer builds need a configured backend or public connection file. Do not ship a setup-only build to customers.');
}
fs.writeFileSync(path.join(__dirname, 'desktop-config.json'), JSON.stringify(config) + '\n');
// Only the public verification key is bundled. The private key stays in release CI.
if (process.env.RUDRA_UI_PUBLIC_KEY || process.env.RUDRA_UPDATE_HOSTS) {
  const publicKey = process.env.RUDRA_UI_PUBLIC_KEY || '';
  const hosts = (process.env.RUDRA_UPDATE_HOSTS || '').split(',').map(host => host.trim()).filter(Boolean);
  if (!publicKey || !hosts.length || hosts.some(host => !/^[a-z0-9.-]+$/i.test(host))) throw Error('Provide a public update key and exact HTTPS host allowlist together');
  if (/PRIVATE KEY/.test(publicKey) || crypto.createPublicKey(publicKey).asymmetricKeyType !== 'ed25519') throw Error('UI updates require an Ed25519 public verification key');
  const feed = process.env.RUDRA_NATIVE_FEED || '', publisher = process.env.RUDRA_NATIVE_PUBLISHER || '';
  if (!!feed !== !!publisher) throw Error('Provide native feed and signing publisher together');
  if (feed) trustedURL(feed, hosts);
  fs.writeFileSync(path.join(__dirname, 'update-trust.json'), JSON.stringify({ publicKey, hosts,
    native: { enabled: !!feed, feed, publisher } }) + '\n');
}
console.log(config.backendUrl ? `Building Rudra24 AI for ${config.backendUrl}` : 'Building Rudra24 AI with first-run connection setup.');
