'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { backendOrigin } = require('./runtime-config');

function requireHttps(name, value) {
  try { return backendOrigin(value); }
  catch (error) { throw new Error(`${name}: ${error.message}`); }
}

const backendUrl = process.env.CLAVIS_BACKEND_URL;
const supabaseUrl = process.env.CLAVIS_SUPABASE_URL;
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
fs.writeFileSync(path.join(__dirname, 'desktop-config.json'), JSON.stringify(config) + '\n');
console.log(config.backendUrl ? `Building Rudra24 AI for ${config.backendUrl}` : 'Building Rudra24 AI with first-run connection setup.');
