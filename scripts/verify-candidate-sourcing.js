/**
 * Candidate sourcing integrity check.
 *
 * Locks in the "real data only" contract for the Candidate AI page:
 *   - the sourcing module wires the four required real Apify actors
 *   - the actor ids the user provided are intact
 *   - the mock/seed candidate fabrication is gone from page-candidates.js
 *   - the page reaches the real sourcing engine, not a fake generator
 */

'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const actors = fs.readFileSync(path.join(ROOT, 'candidate-actors.js'), 'utf8');
const page = fs.readFileSync(path.join(ROOT, 'page-candidates.js'), 'utf8');
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const backend = fs.readFileSync(path.join(ROOT, 'backend', 'api', 'candidate_jobs.py'), 'utf8');

let failures = 0;
function check(name, cond, detail) {
  if (cond) console.log('  PASS  ' + name);
  else { console.log('  FAIL  ' + name + (detail ? ' -> ' + detail : '')); failures++; }
}

console.log('\nCandidate sourcing verification\n');

// ── 1. All four required real actors are registered ───────────────────────
const REQUIRED_ACTORS = {
  naukri: 'xYOP3UjaS8w38IWM7',
  workindia: '23KtodpG4T4RFCLe4',
  shine: 'nkFTTcWfTpWK1mj9f',
  apna: 'apna-co-jobs-scraper'
};
for (const [key, id] of Object.entries(REQUIRED_ACTORS)) {
  check(`actor "${key}" is configured`, new RegExp(key + '\\s*:').test(actors));
  check(`actor "${key}" keeps its id (${id})`, actors.includes(id));
}

// ── 2. The public sourcing API exists ─────────────────────────────────────
check('CandidateSourcing is exported', /window\.CandidateSourcing\s*=/.test(actors));
check('scrape() is defined', /async function scrape\(/.test(actors) || /scrape\s*[:(]/.test(actors));
check('parseIntent() is defined', /function parseIntent\(/.test(actors));
check('uses run-sync-get-dataset-items endpoint',
  /run-sync-get-dataset-items/.test(backend));
check('reports per-source failures instead of throwing away the run',
  /source_errors/.test(backend) && /source_error/.test(backend));

// ── 3. No fabricated candidate data remains ───────────────────────────────
check('no fake generateAiResponse in page-candidates.js', !/generateAiResponse/.test(page));
check('no random phone fabrication', !/Math\.floor\(\s*10000000/.test(page) && !/\+91 98' \+/.test(page));
check('no hard-coded seed candidate names',
  !/Dharmendra Yadav/.test(page) && !/Rajesh Kumar Singh/.test(page) && !/Sunita Kumari/.test(page));
check('loadCandidates starts empty without seeding',
  /this\.candidates\s*=\s*\[\];[\s\S]{0,160}real results scraped/.test(page) ||
  /No seed data/.test(page));

// ── 4. The page is wired to the real engine ───────────────────────────────
check('handleAiChatSubmit calls the real sourcing engine',
  /CandidateSourcing\.scrape\(/.test(page));
check('handleAiChatSubmit parses intent offline first',
  /CandidateSourcing\.parseIntent\(/.test(page));
check('candidate-actors.js is loaded before page-candidates.js',
  html.indexOf('candidate-actors.js') !== -1 &&
  html.indexOf('candidate-actors.js') < html.indexOf('page-candidates.js'));
check('source picker is inside the Candidate composer',
  /class="claude-input-container candidate-composer"[\s\S]*id="candidate-source-menu-btn"[\s\S]*id="cand-source-chips"[\s\S]*id="btn-candidate-ai-send"/.test(html));
check('source dropdown reports and controls its open state',
  /candidate-source-count/.test(page) && /setSourceMenuOpen\(/.test(page) &&
  /aria-expanded/.test(page) && /menu\.hidden/.test(page));
check('all four source options are present in the dropdown',
  /data-source="naukri"/.test(html) && /data-source="workindia"/.test(html) &&
  /data-source="shine"/.test(html) && /data-source="apna"/.test(html));
check('active portal selection reaches the real scraper with its API token',
  /const sources = this\.activeSources\.slice\(\)/.test(page) &&
  /sources,/.test(page) &&
  /ACTORS\[key\]/.test(backend) &&
  /Bearer \{token\}/.test(backend));

// ── 5. Browser never resolves or stores the Apify secret ──────────────────
check('does not resolve Apify keys in the browser',
  !/skylark_custom_apify/.test(page) && !/localStorage\.getItem\([^)]*apify/.test(page));

console.log('');
if (failures) { console.error(failures + ' check(s) failed'); process.exit(1); }
console.log('All candidate sourcing checks passed');
