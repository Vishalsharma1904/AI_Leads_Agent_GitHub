'use strict';

const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(ROOT, file), 'utf8');
const exists = file => fs.existsSync(path.join(ROOT, file));

const main = read('backend/main.py');
const agent = read('agent.js');
const scraper = read('real-scraper.js');
const chat = read('chat.js');
const jobs = exists('backend/api/lead_jobs.py') ? read('backend/api/lead_jobs.py') : '';
const checks = [
  ['lead job API module exists', exists('backend/api/lead_jobs.py')],
  ['credential vault API module exists', exists('backend/api/credentials.py')],
  ['Google Sheets API module exists', exists('backend/api/google_sheets.py')],
  ['lead job router is mounted', /lead_jobs_router/.test(main)],
  ['provider calls are not made directly from browser', !/https:\/\/api\.apify\.com/.test(agent + scraper) && /NexusLeadJobs/.test(scraper)],
  ['LLM calls use authenticated backend proxy', exists('backend/api/ai_chat.py') && exists('ai-chat-client.js') && /NexusAIChat/.test(chat) && !/https:\/\/(api\.groq\.com|openrouter\.ai)/.test(chat)],
  ['lead jobs expose required lifecycle states', ['queued', 'running', 'completed', 'partial', 'failed', 'cancelled'].every(s => jobs.includes(s))],
  ['UI overlays synchronize hidden state and focus', exists('ui-hardening.js') && /inert/.test(read('ui-hardening.js')) && /aria-hidden/.test(read('ui-hardening.js')) && /keydown/.test(read('ui-hardening.js'))],
  ['Mobile layout has a narrow-screen guard', /@media\s*\([^)]*max-width\s*:\s*390px/.test(read('theme-flow.css') + read('styles.css'))],
];

let failed = 0;
for (const [name, ok] of checks) {
  if (ok) console.log(`PASS  ${name}`);
  else { console.log(`FAIL  ${name}`); failed++; }
}
if (failed) process.exit(1);
console.log('All enterprise contract checks passed.');
