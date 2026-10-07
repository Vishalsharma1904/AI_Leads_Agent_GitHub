// Build-time only: bundle translated UI copy so the sign-in screen works offline.
const fs = require('node:fs');
const path = require('node:path');

const codes = ['bn', 'ta', 'te', 'mr', 'gu', 'pa', 'ur', 'kn', 'ml', 'or', 'as', 'ne',
  'es', 'fr', 'de', 'pt', 'ar', 'ru', 'zh', 'ja', 'ko', 'id', 'tr', 'vi'];
const sources = [
  'Welcome back, User', 'Enter your email and password to sync all your data',
  'Continue with Google', 'Sign in with Google', 'or continue with email',
  'Create Account', 'Create Account & Sync', 'Sign In', 'Sign in',
  'Full Name', 'Company / Agency', 'Email Address', 'Mobile / WhatsApp',
  'Password', 'Password (min. 8 chars)', 'Forgot password / Unlock device',
  'Account-protected workspace', 'Sign in required', 'Agency / Firm Name',
  'Answer', 'Welcome', 'Set up your profile', 'Profile & Company',
  'Dashboard', 'Run Agent', 'Settings', 'Language', 'History', 'Shortcuts',
  'Connect Sheets', 'All Leads', 'Candidate Database', 'New Chat', 'Search',
  'Save', 'Cancel', 'Close', 'Delete', 'Edit', 'Retry', 'Continue', 'Back',
  'Next', 'Done'
];
const destination = path.join(__dirname, '..', 'rudra-locales.js');
const existing = fs.existsSync(destination)
  ? JSON.parse(fs.readFileSync(destination, 'utf8').replace(/^window\.RUDRA_LOCALES = /, '').replace(/;\s*$/, ''))
  : {};

function batches(items) {
  const result = [];
  let batch = [];
  for (const item of items) {
    if (([...batch, item].join('\n')).length > 450) {
      result.push(batch);
      batch = [];
    }
    batch.push(item);
  }
  if (batch.length) result.push(batch);
  return result;
}

function decode(text) {
  return text.replace(/&#(x[\da-f]+|\d+);/gi, (_, code) =>
    String.fromCodePoint(parseInt(code.replace(/^x/i, '0x'), 0)))
    .replace(/&amp;/g, '&').replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#39;/g, "'");
}

async function translate(code, batch) {
  const url = new URL('https://api.mymemory.translated.net/get');
  url.searchParams.set('q', batch.join('\n'));
  url.searchParams.set('langpair', `en|${code}`);
  const response = await fetch(url, { signal: AbortSignal.timeout(20000) });
  if (!response.ok) throw new Error(`${code}: HTTP ${response.status}`);
  const data = await response.json();
  if (data.quotaFinished || data.responseStatus !== 200) throw new Error(`${code}: quota/error ${data.responseStatus}`);
  const lines = decode(data.responseData.translatedText).split(/\r?\n/).map(text => text.trim());
  if (lines.length !== batch.length || lines.some(text => !text || /mymemory warning/i.test(text))) {
    throw new Error(`${code}: invalid batch (${lines.length}/${batch.length})`);
  }
  return lines;
}

async function main() {
  for (const code of codes) {
    const locale = existing[code] || {};
    for (const batch of batches(sources.filter(source => !locale[source]))) {
      try {
        const translations = await translate(code, batch);
        batch.forEach((source, index) => { locale[source] = translations[index]; });
      } catch (error) { console.error(error.message); }
    }
    existing[code] = locale;
    fs.writeFileSync(destination, `window.RUDRA_LOCALES = ${JSON.stringify(existing, null, 2)};\n`);
    console.log(`${code}: ${Object.keys(locale).length}/${sources.length}`);
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
