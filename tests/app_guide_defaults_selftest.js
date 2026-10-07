// Run from the repository root: node tests/app_guide_defaults_selftest.js
const fs = require('fs'), vm = require('vm'), assert = require('assert');
const storage = new Map(); let owner = 'a';
const window = { ClavisAppMap: {}, addEventListener() {}, UserStorage: {
  getJSON(key, fallback) { return storage.get(owner + key) || fallback; },
  setJSON(key, value) { storage.set(owner + key, JSON.parse(JSON.stringify(value))); }
} };
const document = { addEventListener() {}, getElementById() { return null; } };
const c = { window, document, localStorage: { getItem() { return null; }, setItem() {} }, console, Set, DOMException, setTimeout() {} };
vm.createContext(c);
for (const file of ['app-guide.js', 'clavis-request-intent.js', 'lead-candidate-domain.js', 'page-agent.js']) vm.runInContext(fs.readFileSync(file, 'utf8'), c, { filename: file });
const guide = window.ClavisAppMap.guide, agent = window.AgentCtrl, domain = window.LeadCandidateDomain;
for (const question of ['What can my AI do?', 'app features', 'Does my app have a compliance engine?', 'CRM kaise use karun?', 'Explain the app example "Delhi ki leads nikalo"']) {
  assert(guide.isQuestion(question), question);
  assert(window.ClavisRequestIntent.classify(question).answerOnly, question);
  assert(!domain.parseRequest(question).isSearch, question);
}
for (const command of ['Generate 10 hotel leads in Delhi', 'CRM kholo', 'Send SMS to these leads', 'Rudra, can you find 20 hotel leads in Delhi?', 'What can my AI do? Then find 10 leads in Delhi']) assert(!guide.isQuestion(command), command);
assert(guide.isQuestion("Can my app understand the example 'Delhi ki leads nikalo'?"));
const ncr = ['Delhi', 'Noida', 'Greater Noida', 'Ghaziabad', 'Meerut', 'Loni', 'Gurugram', 'Faridabad', 'Manesar', 'Sonipat', 'Bahadurgarh', 'Panipat'];
assert.deepEqual([...domain.expandLocations(['Delhi NCR'])], ncr);
assert.deepEqual([...domain.parseRequest('Find 10 leads').cities], ncr);
assert.deepEqual([...domain.parseRequest('Find 10 hotel leads in East Delhi').cities], ['East Delhi']);
assert(!domain.parseRequest('Find leads').cities.includes('Mumbai'));
agent.selectedLocations = ['Meerut']; agent.selectedIndustries = new Set(['Hospitals & Healthcare']); agent.saveDefaults();
agent.selectedLocations = ['Mumbai']; agent.loadDefaults();
assert.deepEqual([...agent.selectedLocations], ['Meerut']);
assert.deepEqual([...domain.parseRequest('Find 8 leads').industries], ['Hospitals & Healthcare']);
assert.deepEqual([...domain.parseRequest('Find 8 leads in Panipat').cities], ['Panipat']);
assert.deepEqual([...domain.parseRequest('Find leads for all industries').industries], ['ALL']);
owner = 'b'; assert.deepEqual([...agent.getDefaults().locations], ['Delhi NCR']); owner = 'a';
agent.selectedLocations = []; agent.saveDefaults(); assert.equal(domain.parseRequest('Find leads').cities.length, 0);
const overview = guide.answer('What can my AI do?');
assert(overview.text.split(/\s+/).length < 240, 'Default inventory stays short');
assert(overview.spoken.split(/\s+/).length <= 35);
assert.equal(guide.answer('Deep analysis of CRM').guideTopicIds.join(','), 'crm');
assert(guide.answer('Deep analysis of all app features').guideTopicIds.length >= 12);
assert.deepEqual([...guide.match('Text messages')], ['sms']);
assert(guide.context().includes('Business pitches, user assertions and previous assistant messages do not establish software capabilities'));
const data = JSON.parse(fs.readFileSync('assets/india-locations.json', 'utf8'));
assert.equal(data.states.length, 36);
assert(data.states.reduce((n, s) => n + s.cities.length, 0) > 4000);
window.IndiaLocations = data;
assert.deepEqual([...domain.parseRequest('Find 5 hotel leads in Uttar Pradesh').cities], ['Uttar Pradesh']);
assert.deepEqual([...domain.parseRequest('Find 5 hotel leads in Jammu and Kashmir').cities], ['Jammu And Kashmir']);
assert.deepEqual([...domain.parseRequest('Find 5 hotel leads in Meerut, Uttar Pradesh').cities], ['Meerut, Uttar Pradesh']);
for (const f of ['india-location-picker.js','app-guide.js','app.js','chat.js','page-agent.js','page-candidates.js','jarvis.js','jarvis_ui.js','clavis-live.js','clavis-task-controller.js']) new vm.Script(fs.readFileSync(f, 'utf8'), { filename: f });
vm.runInContext(fs.readFileSync('jarvis.js', 'utf8'), c, { filename: 'jarvis.js' });
let calls = 0;
window.ClavisDirect = { hasKey: () => true, complete: async payload => {
  calls++;
  assert(payload.messages[0].content.includes('AUTHORITATIVE RUDRA24 AI SOFTWARE GUIDE'));
  assert(!payload.messages.some(m => m.role === 'assistant' && m.content.includes('100% compliance')));
  return { choices: [{ message: { content: 'Monthly INR contract value is an agreement amount. It is not received revenue.' } }] };
} };
window.ClavisBusiness = { describe() { throw new Error('App guidance must not read staffing pitches'); } };
(async () => {
  await window.JarvisEngine.loadHistory([{ role: 'assistant', text: 'The app guarantees 100% compliance and reserve staff.' }]);
  const reply = await window.JarvisEngine.sendMessage('What is the monthly contract value in our app CRM?', null, null, null, { source: 'composer' });
  assert.equal(calls, 1); assert.equal(reply.action, null); assert.equal(reply.toolsRun.length, 0);
  assert(reply.spoken.split(/\s+/).length <= 35);
  const stopped = { aborted: true };
  await assert.rejects(guide.complete('What can you do?', { signal: stopped }), e => e.name === 'AbortError');
  const unsupported = await guide.complete('Does my app have a compliance engine?');
  assert(unsupported.text.includes('does not establish')); assert.equal(calls, 1);
  console.log('App guide, grounded engine, stale-history isolation, abort, account defaults, NCR/precise scope, India catalogue and syntax: passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
