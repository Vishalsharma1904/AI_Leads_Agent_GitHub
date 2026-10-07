const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require('node:path').join(__dirname, '../jarvis_ui.js'), 'utf8');
const match = source.match(/function clavisAIErrorFeedback\(err\) \{[\s\S]*?\n\}/);
assert.ok(match, 'Chat errors need quota-aware feedback');
const feedback = vm.runInNewContext(`(${match[0]})`);
const daily = feedback({status: 429, message: 'Aaj ki ai limit (300) poori ho gayi.'});
assert.equal(daily.title, 'Daily AI limit reached');
assert.equal(daily.busy, false);
const service = feedback({status: 503, message: 'Service unavailable'});
assert.equal(service.title, 'AI service unavailable');
assert.equal(service.busy, false);
const limited = feedback({code: 'AI_RATE_LIMITED', status: 429});
assert.equal(limited.title, 'AI provider limit reached');
assert.equal(limited.busy, true);
const monthly = feedback({status: 429, message: 'Monthly quota exhausted'});
assert.equal(monthly.title, 'AI provider quota reached');
assert.equal(monthly.busy, false);
for (const result of [daily, service, limited]) {
  assert.doesNotMatch(result.message, /every minute|few seconds|ten seconds|10 seconds/);
}
assert.equal(feedback({status: 502, message: 'Empty reply'}).message, 'Empty reply');
console.log('AI feedback: daily quota, provider limit, service failure and empty reply passed');
