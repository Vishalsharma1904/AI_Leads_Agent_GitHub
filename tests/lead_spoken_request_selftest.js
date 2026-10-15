'use strict';
const assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm');
const window = { AgentCtrl: { getDefaults: () => ({ locations: ['Gurugram'], industries: ['ALL'] }) } };
const ctx = vm.createContext({ window, console });
for (const file of ['clavis-request-intent.js', 'lead-candidate-domain.js']) vm.runInContext(fs.readFileSync(file, 'utf8'), ctx);
const parse = text => window.LeadCandidateDomain.parseRequest(text);
for (const [text, city, count] of [
  ['Fetch me five leads for Garziba.', 'Garziba', 5],
  ['Give me twenty five leads in Port Blair', 'Port Blair', 25],
  ['Fetch me five leads', 'Gurugram', 5],
  ['Rampur mein ten leads nikalo', 'Rampur', 10],
  ['Find 5 leads in Sector 62 Noida', 'Sector 62 Noida', 5],
  ['Fetch five leads in Noida with 2 contacts each', 'Noida', 5],
  ['Give me twenty one hotel leads in Delhi', 'Delhi', 21],
  ['Find five leads for solar services in Noida', 'Noida', 5],
  ['Fetch me five leads for all industries', 'Gurugram', 5],
  ['Can you fetch me five leads for Garziba?', 'Garziba', 5],
  ['Find five hospitals in Ramgarh.', 'Ramgarh', 5],
  ['Find twenty five hotels near Port Blair', 'Port Blair', 25],
]) {
  const plan = parse(text);
  assert.equal(plan.cities[0], city, text);
  assert.equal(plan.count, count, text);
  assert.equal(plan.workstream, 'leads', text);
  assert.equal(plan.isSearch, true, text);
}
assert.equal(parse('Can you find leads across every industry?').isSearch, false);
assert.equal(parse('How many saved leads are there?').isSearch, false);
assert.equal(parse('Do not fetch me five leads for Garziba.').isSearch, false);
assert.deepEqual([...parse('Find five leads for solar services in Noida').roles], [], 'quantity is not a service role');
assert.deepEqual([...parse('Fetch me five leads for Garziba').roles], [], 'a location following for is not a staffing service');
assert.deepEqual([...parse('Find five hospitals in Ramgarh.').serviceTypes], ['Security', 'Housekeeping', 'Pantry Boy'], 'buyer industry is not a staffing service');
assert.deepEqual([...parse('Find five solar technicians in Noida').roles], ['Solar Technicians'], 'a free-form candidate role keeps its name without the requested quantity');
console.log('Spoken lead requests preserve location/count; capability questions do not dispatch.');
