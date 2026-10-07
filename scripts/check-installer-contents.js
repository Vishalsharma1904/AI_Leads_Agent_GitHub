#!/usr/bin/env node
'use strict';
/**
 * What the customer installer is allowed to contain.
 *
 * This is the check that stands between a build command and shipping every API
 * key you own to a customer's laptop. `backend/.env` alone holds the vault key,
 * Supabase secret, Razorpay secret and every platform provider key — one
 * careless glob in package.json and it lands inside the .exe, where anyone can
 * unpack it with a zip tool.
 *
 * No backend, Python environment or setup scripts reach the customer. The
 * small local PC Bridge includes its existing optional OS helpers separately.
 *
 * Run: node scripts/check-installer-contents.js
 */
const fs = require('node:fs');
const path = require('node:path');
const { backendOrigin } = require('../electron/runtime-config');
const globModule = require('minimatch'); // already supplied by electron-builder
const minimatch = globModule.minimatch || globModule;

const root = path.join(__dirname, '..');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const globs = pkg.build.files;

const includes = globs.filter((g) => !g.startsWith('!'));
const excludes = globs.filter((g) => g.startsWith('!')).map((g) => g.slice(1));

function matches(glob, file) {
  return minimatch(file, glob, { dot: true });
}

const packed = (file) =>
  includes.some((g) => matches(g, file)) && !excludes.some((g) => matches(g, file));

// Anything on this list reaching a customer machine is a shipped incident.
const MUST_NOT_SHIP = [
  'backend/.env',
  'backend/.env.example',
  'backend/main.py',
  'backend/api/credentials.py',
  'backend/requirements.txt',
  'backend/skylark_cloud.db',
  'scripts/start-backend.ps1',
  'scripts/setup-clavis-runtime.ps1',
  'secrets.local.js',
  'electron/prepare-build.js',
  'Start-Clavis.bat',
  'Fix-Leads.bat',
  'clavis-bridge/Start-Bridge.bat',
  '.env',
  'render.yaml',
  'package-lock.json',
  'skills-lock.json',
  'test_ai_intelligence.js',
  'assets/secret.env',
];

// The app is not an app without these.
const MUST_SHIP = [
  'index.html',
  'boot.html',
  'electron/main.js',
  'electron/preload.js',
  'electron/runtime-config.js',
  'clavis-bridge/bridge.js',
  'electron/desktop-config.json',
  'desktop-setup.html',
  'desktop-setup.js',
  'desktop-setup.css',
  'serve-clavis.js',
  'config.js',
  'composer-sizing.js',
  'sidebar-hover-scroll.js',
  'crm-insights.js',
  'crm-insights.css',
  'rudra-motion-ui.js',
  'rudra-motion-ui.css',
  'rudra-auth-claude.css',
  'clavis-claude.css',
  'fonts/geist-latin-wght-normal.woff2',
  'assets/rudra24-icon.png',
  'vendor/maplibre/maplibre-gl.js',
  'vendor/maplibre/maplibre-gl.css',
];

let failed = 0;

for (const file of MUST_NOT_SHIP) {
  if (packed(file)) {
    console.error(`  LEAK  ${file} would be packed into the installer`);
    failed++;
  }
}
for (const file of MUST_SHIP) {
  if (!packed(file)) {
    console.error(`  MISSING  ${file} would NOT be packed — the app needs it`);
    failed++;
  }
  if (!fs.existsSync(path.join(root, file))) {
    console.error(`  ABSENT  ${file} does not exist in the repo`);
    failed++;
  }
}

// The customer build must not be able to start anything locally.
const mainJs = fs.readFileSync(path.join(root, 'electron', 'main.js'), 'utf8');
if (!mainJs.includes('isLocalBackend')) {
  console.error('  main.js no longer gates the local backend on isLocalBackend()');
  failed++;
}
if (!mainJs.includes('windowsHide: true')) {
  console.error('  main.js spawns without windowsHide — a console window would flash');
  failed++;
}

const cfgPath = path.join(root, 'electron', 'desktop-config.json');
const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
const host = (() => { try { return new URL(cfg.backendUrl).hostname; } catch (_) { return ''; } })();
const localHost = ['localhost', '127.0.0.1', '::1'].includes(host);
// --strict is passed by `npm run dist:win`, after prepare-build.js has already
// written a real HTTPS url. Standalone runs stay a warning so the check is
// usable during development.
const strict = process.argv.includes('--strict');
if (strict) {
  try {
    if (cfg.backendUrl) backendOrigin(cfg.backendUrl);
    else if (!cfg.firstRunSetup) throw new Error('Missing server URL and first-run setup.');
  } catch (error) { console.error('  CONFIG  ' + error.message); failed++; }
}
if (localHost) {
  const line = `desktop-config.json points at ${cfg.backendUrl} — an installer built from this would reach a laptop, not your API.`;
  if (strict) { console.error('  ' + line); failed++; }
  else { console.warn(`  NOTE  ${line}`); }
}

// Audit the actual artifact as well as the declared globs after packaging.
const archiveIndex = process.argv.indexOf('--archive');
if (archiveIndex !== -1) {
  const archive = process.argv[archiveIndex + 1];
  const asar = require('@electron/asar');
  const actualFiles = new Set();
  for (const entry of asar.listPackage(archive)) {
    const nativeFile = entry.replace(/^[\\/]+/, '');
    const file = nativeFile.replace(/\\/g, '/');
    const stat = asar.statFile(archive, nativeFile);
    if (stat.files) continue;
    actualFiles.add(file);
    if (MUST_NOT_SHIP.includes(file) || /(^|\/)backend\/|\.(env|db|sqlite|py|bat|map)$/i.test(file)) {
      console.error('  ARCHIVE LEAK  ' + file); failed++;
    }
    if (!file.startsWith('node_modules/') && /\.(js|json|html)$/i.test(file)) {
      const source = asar.extractFile(archive, nativeFile).toString('utf8');
      if (/(?:AIza[\w-]{30,}|gsk_[\w-]{30,}|sk-or-v1-[\w-]{30,}|sb_secret_[\w-]{20,})/.test(source)) {
        console.error('  ARCHIVE KEY  ' + file); failed++;
      }
    }
  }
  for (const file of MUST_SHIP) {
    if (!actualFiles.has(file)) { console.error('  ARCHIVE MISSING  ' + file); failed++; }
  }
}

if (failed) {
  console.error(`\ninstaller check FAILED (${failed} problem${failed > 1 ? 's' : ''})`);
  process.exit(1);
}
console.log(`installer check passed — ${MUST_NOT_SHIP.length} secrets kept out, ${MUST_SHIP.length} required files present`);
