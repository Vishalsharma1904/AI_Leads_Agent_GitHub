/**
 * Runs every verification suite and every JS syntax check in one command.
 *
 *   npm test
 *
 * Exits non-zero if anything fails, so it can gate a commit or a deploy.
 */

'use strict';

const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');

const SUITES = [
  'verify-app-integrity',
  'verify-toast-policy',
  'verify-plugin-core',
  'verify-plugin-manifests',
  'verify-plugin-setup',
  'verify-sms-plugin',
  'verify-diagnostics',
  'verify-candidate-sourcing',
  'verify-auth-security',
  'verify-enterprise-contract',
  'verify-clavis-voice'
];

let failed = 0;

// ── 1. Syntax check every root-level script ───────────────────────────────
process.stdout.write('\nSyntax\n');
const jsFiles = fs.readdirSync(ROOT).filter(f => f.endsWith('.js'));
const broken = [];
for (const file of jsFiles) {
  try {
    // Spawning Node once per script made the gate appear hung on Windows
    // machines with many root scripts. vm.Script performs the same parse-only
    // check in-process and keeps the gate deterministic and fast.
    new vm.Script(fs.readFileSync(path.join(ROOT, file), 'utf8'), { filename: file });
  } catch (err) {
    broken.push(file);
  }
}
if (broken.length) {
  console.log(`  FAIL  ${broken.length} file(s) do not parse: ${broken.join(', ')}`);
  failed++;
} else {
  console.log(`  PASS  all ${jsFiles.length} root scripts parse`);
}

// ── 2. JSON validity ──────────────────────────────────────────────────────
process.stdout.write('\nJSON\n');
const jsonFiles = ['package.json', 'manifest.json'];
const badJson = [];
for (const file of jsonFiles) {
  try { JSON.parse(fs.readFileSync(path.join(ROOT, file), 'utf8')); }
  catch (err) { badJson.push(`${file} (${err.message})`); }
}
if (badJson.length) {
  console.log('  FAIL  ' + badJson.join('; '));
  failed++;
} else {
  console.log(`  PASS  ${jsonFiles.join(', ')} are valid`);
}

// ── 3. No byte-order marks (a BOM breaks JSON.parse) ──────────────────────
process.stdout.write('\nEncoding\n');
const withBom = [];
for (const file of fs.readdirSync(ROOT)) {
  if (!/\.(js|json|css|html)$/.test(file)) continue;
  const buf = fs.readFileSync(path.join(ROOT, file));
  if (buf.length >= 3 && buf[0] === 0xEF && buf[1] === 0xBB && buf[2] === 0xBF) withBom.push(file);
}
if (withBom.length) {
  console.log('  FAIL  byte-order mark present in: ' + withBom.join(', '));
  failed++;
} else {
  console.log('  PASS  no byte-order marks');
}

// ── 4. Suites ─────────────────────────────────────────────────────────────
for (const suite of SUITES) {
  const file = path.join(__dirname, suite + '.js');
  if (!fs.existsSync(file)) {
    console.log(`\n${suite}\n  FAIL  suite file is missing`);
    failed++;
    continue;
  }
  process.stdout.write(`\n${suite}\n`);
  try {
    const out = execFileSync(process.execPath, [file], { encoding: 'utf8' });
    const lines = out.trim().split('\n');
    console.log('  ' + lines[lines.length - 1].trim());
  } catch (err) {
    const out = (err.stdout || '') + (err.stderr || '');
    out.trim().split('\n').filter(l => /FAIL|failed/.test(l)).forEach(l => console.log('  ' + l.trim()));
    failed++;
  }
}

console.log('');
if (failed) {
  console.error(`${failed} group(s) failed.`);
  process.exit(1);
}
console.log(`All checks passed (${SUITES.length} suites).`);
