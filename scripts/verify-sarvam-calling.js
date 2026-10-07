/** Offline regression checks for the Sarvam voice calling agent. */
'use strict';

const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const read = (name) => fs.readFileSync(path.join(ROOT, name), 'utf8');

const store = new Map();
const localStorageStub = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
};
const windowStub = { addEventListener() {}, dispatchEvent() {} };
new Function('window', 'localStorage', 'indexedDB', 'location', 'CustomEvent', 'setTimeout', read('sarvam-calling.js'))(
  windowStub, localStorageStub, { open: () => ({}) }, { protocol: 'http:' }, function () {}, setTimeout
);
const S = windowStub.SarvamCalling;

let failures = 0;
function check(name, condition, detail = '') {
  if (condition) console.log('  PASS  ' + name);
  else { console.log('  FAIL  ' + name + (detail ? ' -> ' + detail : '')); failures++; }
}

console.log('\nSarvam calling agent verification\n');

// ── engine ────────────────────────────────────────────────────────────────
check('engine exposes its public contract',
  ['getConfig', 'setConfig', 'missingFields', 'startCall', 'listAttempts', 'getTranscript',
   'getRecording', 'enqueue', 'start', 'stop', 'allThreads', 'calendarLink', 'icsFor', 'mailLink']
    .every((n) => typeof S[n] === 'function'));

let selfTest = '';
try { selfTest = S._selfTest(); } catch (err) { selfTest = 'threw: ' + err.message; }
check('phone / transcript / status / call-window self-test', selfTest === 'SarvamCalling self-test OK', selfTest);

// A call must never go out on a half-configured agent — that is a real
// phone ringing at someone's desk.
S.setConfig({ ...S.DEFAULTS });
check('blocks dialling until the agent is configured', S.missingFields().length === 7,
  String(S.missingFields().length));

S.setConfig({
  orgId: 'org_1', workspaceId: 'ws_1', appId: 'app_1', connectionId: 'conn_1',
  agentPhoneNumber: '+918047168000', businessName: 'Acme Facility',
  businessWhatWeSell: 'security guards', ownerName: 'Vishal', meetingDurationMin: 30,
});
check('setup complete clears every blocker', S.missingFields().length === 0);

const vars = S.callVariables({ company: 'Hotel Taj', contactName: 'Asha', city: 'Gurugram' });
check('per-call variables carry business + lead', vars.business_name === 'Acme Facility' && vars.company === 'Hotel Taj');
check('opening line is filled, never left with placeholders',
  vars.opening_line.includes('Acme Facility') && !vars.opening_line.includes('{{'), vars.opening_line);

const prompt = S.buildAgentPrompt();
check('agent prompt is built from the owner settings',
  prompt.includes('Acme Facility') && prompt.includes('security guards') && !prompt.includes('undefined'));

// ── queue ─────────────────────────────────────────────────────────────────
const res = S.enqueue([
  { id: 'a', company: 'Hotel Taj', phone: '98765 43210' },
  { id: 'b', company: 'No Number', phone: '' },
  { id: 'c', company: 'Apex Mall', phone: '+919812345678' },
]);
check('queue takes only leads with a dialable number', res.added === 2 && res.skipped === 1,
  `added=${res.added} skipped=${res.skipped}`);
check('queue normalises numbers to E.164', S.queueSnapshot()[0].lead.phone === '+919876543210');
S.clearQueue();

// ── handoff ───────────────────────────────────────────────────────────────
const thread = {
  id: 't1', company: 'Hotel Taj', phone: '+919876543210', email: 'a@taj.in',
  summary: 'Interested.', meeting: { date_iso: '2026-10-06', time_24h: '15:00', note: 'Site visit' },
  emailDraft: { to: 'a@taj.in', subject: 'Follow up', body: 'Dhanyavaad' },
};
check('calendar link carries the agreed slot',
  decodeURIComponent(S.calendarLink(thread)).includes('20261006T') && S.calendarLink(thread).includes('calendar.google.com'));
check('.ics has a start and an end', /DTSTART:20261006T/.test(S.icsFor(thread)) && /DTEND:2026100/.test(S.icsFor(thread)));
check('no meeting means no calendar link', S.calendarLink({ id: 'x' }) === '' && S.icsFor({ id: 'x' }) === '');
check('mail link opens a compose window, it does not send',
  S.mailLink(thread).includes('mail.google.com') && S.mailLink(thread, { gmail: false }).startsWith('mailto:'));

// ── wiring ────────────────────────────────────────────────────────────────
const html = read('index.html');
check('page, nav entry and scripts are wired into the app',
  html.includes('id="view-calling"') && html.includes('data-view="calling"')
  && html.includes('sarvam-calling.js') && html.includes('sarvam-calling-ui.js')
  && html.includes('sarvam-calling.css'));
check('leads page can hand its list to the agent', html.includes('SarvamCallingUI.pullLeads()'));

const app = read('app.js');
check('showView renders the calling page', app.includes("viewName === 'calling'") && app.includes("calling: 'Calling Agent'"));
check('a finished lead run offers the leads instead of dialling on its own',
  app.includes('offerLeadsToCallingAgent'));

const ui = read('sarvam-calling-ui.js');
check('Rudra24 AI asks before handing leads over', ui.includes("nexus:scrapedone") && ui.includes('offerLeads'));
check('Rudra24 AI skills are registered for voice control',
  ['send_leads_to_calling_agent', 'start_calling', 'calling_status'].every((n) => ui.includes(`'${n}'`)));
check('customer sits right, agent sits left',
  ui.includes('sc-msg-user') && ui.includes('sc-msg-agent') && ui.includes("me ? 'Customer'"));
check('the app never plays call audio by itself',
  ui.includes('preload="none"') && !/new Audio\(/.test(ui) && !/\.play\(\)/.test(ui));

const serve = read('serve-clavis.js');
check('same-origin Sarvam proxy exists for the CORS fallback',
  serve.includes('/sarvam-api') && serve.includes('apps.sarvam.ai') && serve.includes('api-subscription-key'));
check('proxy only forwards to Sarvam and never logs the key',
  serve.includes("const SARVAM_HOST = 'apps.sarvam.ai'") && !/console\.log\([^)]*headers/.test(serve));

const vault = read('clavis-keyvault.js');
check('Sarvam key lives in the encrypted vault, not in source',
  vault.includes('sarvam:') && !read('config.js').match(/SARVAM_API_KEYS:\s*\[\s*['"]/));
check('Sarvam is not in the LLM fallback chain',
  /var CHAIN = \[[^\]]*\];/.test(vault) && !vault.match(/var CHAIN = \[[^\]]*sarvam/));

if (failures) {
  console.error(`\n${failures} Sarvam calling check(s) failed.`);
  process.exit(1);
}
console.log('\nAll Sarvam calling checks passed.');
