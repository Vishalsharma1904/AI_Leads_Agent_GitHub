/**
 * Verifies the Fast2SMS plugin and the "every card has a setup guide" rule.
 *
 * The security-critical assertion here: the Fast2SMS API key must NEVER be a
 * browser-side setup field. If someone later "simplifies" this by asking for the
 * key in the UI, this test fails.
 */

'use strict';

const fs = require('fs');
const path = require('path');

const store = new Map();
const localStorageStub = {
  get length() { return store.size; },
  key: i => [...store.keys()][i],
  getItem: k => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: k => store.delete(k)
};

const documentStub = {
  addEventListener() {}, dispatchEvent() { return true; }, getElementById() { return null; }
};
const windowStub = { SKYLARK_CONFIG: {} };

function load(file) {
  const src = fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
  new Function('window', 'document', 'localStorage', 'console', 'fetch', src)(
    windowStub, documentStub, localStorageStub,
    { warn() {}, error() {}, info() {}, log() {} },
    () => Promise.reject(new Error('network disabled in test'))
  );
}

load('plugin-core.js');
load('plugin-manifests.js');
const core = windowStub.PluginCore;

let failures = 0;
function check(name, cond, detail) {
  if (cond) console.log('  PASS  ' + name);
  else { console.log('  FAIL  ' + name + (detail ? ' -> ' + detail : '')); failures++; }
}

console.log('\nSMS plugin + setup guide verification\n');

(async () => {
  const sms = core.describe('sms-fast2sms');
  check('sms-fast2sms is registered', Boolean(sms));
  check('it is in the communication category', sms.category === 'communication', sms.category);
  check('it declares bulk sending', (sms.capabilities || []).includes('bulk_sms'));
  check('it declares DLT template sending', (sms.capabilities || []).includes('dlt_template_sms'));

  // ── SECURITY: the provider key must not be requested in the browser ─────
  const fieldBlob = JSON.stringify(sms.setup?.fields || []).toLowerCase();
  check('setup does NOT ask for an API key in the browser',
    !/apikey|api_key|authorization/.test(fieldBlob), fieldBlob);
  check('setup asks for the backend relay URL instead',
    (sms.setup?.fields || []).some(f => f.key === 'relayUrl'));
  check('the detail explains why sending is server-side',
    /cors/i.test(sms.detail) && /wallet|key/i.test(sms.detail));

  // ── Blocked until a relay is configured ─────────────────────────────────
  check('blocked with no relay URL', sms.ready === false);
  check('the blocker mentions the relay', /relay/i.test(sms.missing[0]?.label || ''), sms.missing[0]?.label);

  // Rejects being pointed at Fast2SMS directly — that would leak the key.
  const wrong = await core.saveSetup('sms-fast2sms', { relayUrl: 'https://www.fast2sms.com/dev' });
  check('refuses the Fast2SMS API address as the relay', wrong.ok === false, wrong.message);

  const notUrl = await core.saveSetup('sms-fast2sms', { relayUrl: 'localhost:8000' });
  check('requires an http/https scheme', notUrl.ok === false, notUrl.message);

  const good = await core.saveSetup('sms-fast2sms', { relayUrl: 'http://localhost:8000' });
  check('accepts a valid relay URL', good.ok === true, good.message);
  check('relay URL persisted', store.get('sms_relay_url') === 'http://localhost:8000');
  check('plugin unblocks once the relay is set', core.describe('sms-fast2sms').ready === true);

  // Health check must fail honestly when the relay is unreachable.
  await core.enable('sms-fast2sms');
  const health = await core.checkHealth('sms-fast2sms');
  check('unreachable relay reports DISCONNECTED, not CONNECTED',
    health.state === 'DISCONNECTED', health.state);
  check('health message names the relay address',
    /localhost:8000/.test(health.message), health.message);

  // ── Every plugin must be explainable from its card ──────────────────────
  const all = core.list();
  const noSteps = all.filter(p => !(p.setup?.steps || []).length);
  check('every plugin has setup steps for the guide button',
    noSteps.length === 0, noSteps.map(p => p.id).join(', '));

  const noSummaryish = all.filter(p => !p.summary && !p.description);
  check('every plugin has card copy', noSummaryish.length === 0, noSummaryish.map(p => p.id).join(', '));

  // ── Card copy must stay short enough for the clamped line ──────────────
  const controller = fs.readFileSync(path.join(__dirname, '..', 'page-plugins.js'), 'utf8');
  check('card uses a shortened summary rather than the full description',
    /_firstSentence/.test(controller));
  check('guide() exists and is separate from explain()',
    /guide\(id\)/.test(controller) && /explain\(id\)/.test(controller));
  check('every card renders the How to set up button',
    /How to set up/.test(controller));
  check('capability chips are no longer rendered on the card',
    !/_card[\s\S]{0,1200}pg-cap"/.test(controller));

  // ── Backend route exists and keeps the key server-side ─────────────────
  const backend = fs.readFileSync(path.join(__dirname, '..', 'backend', 'api', 'sms_fast2sms.py'), 'utf8');
  check('backend relay exists', backend.length > 500);
  check('backend reads the key from the environment',
    /os\.getenv\(["']FAST2SMS_API_KEY/.test(backend));
  check('backend exposes wallet, send and send-dlt',
    /\/wallet/.test(backend) && /"\/send"/.test(backend) && /"\/send-dlt"/.test(backend));
  check('backend validates Indian mobile numbers',
    /\[6-9\]\\d\{9\}/.test(backend));
  check('backend enforces the 1000-recipient provider limit',
    /MAX_RECIPIENTS\s*=\s*1000/.test(backend));
  check('backend de-duplicates recipients so nobody is billed twice',
    /de-duplicate/i.test(backend));
  check('backend never returns the key to the client',
    !/return.*_api_key\(\)/.test(backend));

  const mainPy = fs.readFileSync(path.join(__dirname, '..', 'backend', 'main.py'), 'utf8');
  check('sms router is mounted in main.py',
    /include_router\(sms_router\)/.test(mainPy));

  const docs = fs.readFileSync(path.join(__dirname, '..', 'docs', 'SMS-TEMPLATES.md'), 'utf8');
  check('all five templates are documented',
    (docs.match(/## Template \d/g) || []).length === 5);
  check('docs warn about DLT being required for production',
    /TRAI/.test(docs));

  console.log('');
  if (failures) { console.error(failures + ' check(s) failed'); process.exit(1); }
  console.log('All SMS plugin checks passed');
})();
