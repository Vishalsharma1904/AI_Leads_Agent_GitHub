'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');

const storage = new Map();
global.localStorage = {
  getItem: key => storage.get(key) || null,
  setItem: (key, value) => storage.set(key, String(value)),
  removeItem: key => storage.delete(key)
};
global.window = {
  AppSettings: { get: () => false, rounds: () => 1 },
  ApifyLeads: { hasToken: () => true },
  addEventListener() {}, dispatchEvent() {}
};
global.document = new EventTarget();
document.createElement = () => { throw new Error('Unexpected download'); };
global.CustomEvent = class extends Event { constructor(name, options) { super(name); this.detail = options.detail; } };
window.document = document;
require(path.join(__dirname, '..', 'real-scraper.js'));
const scraper = window.RealScraper;
assert.equal(scraper.matchesRequestedLocation({ address: 'Meerut, Meerut district, Uttar Pradesh' }, ['Meerut, Uttar Pradesh']), true);
assert.equal(scraper.matchesRequestedLocation({ address: 'Rampur, Himachal Pradesh' }, ['Rampur, Uttar Pradesh']), false);
assert.equal(scraper.matchesRequestedLocation({ address: 'Meerut' }, ['Meerut, Uttar Pradesh']), false);

const places = Array.from({ length: 25 }, (_, i) => ({
  title: `Hotel ${i + 1}`, city: 'Delhi', address: `Road ${i + 1}, Delhi`,
  phone: String(9811100001 + i), categoryName: 'Hotel'
}));
const opts = { industries: ['Hotels', 'Hospitals', 'Malls', 'Offices', 'Warehouses', 'Factories'],
  locations: ['Delhi'], targetCount: 20, autoExcel: false, saveToDb: false };

async function main() {
  let result;
  let queryCoverage=0;
  scraper.setCallbacks({ onComplete: summary => { result = summary; } });
  window.ApifyLeads.search = async ({ queries, maxPerQuery, onPartial }) => {
    assert.ok(queries.length * maxPerQuery <= 20, 'first Apify pass stays within the requested budget');
    queryCoverage=queries.length;
    onPartial(places);
    return places;
  };
  const full = await scraper.run(opts);
  assert.equal(queryCoverage,6,'all selected industries stay in the sourcing plan');
  assert.equal(full.length, 20);
  assert.equal(result.leads.length, 20);

  window.ApifyLeads.search = async ({ queries, maxPerQuery }) => {
    assert.equal(queries.length * maxPerQuery, 3);
    return places;
  };
  assert.equal((await scraper.run({ ...opts, targetCount: 3 })).length, 3,
    'small explicit requests are not raised to 20');

  let paidRuns = 0;
  window.AppSettings.rounds = () => 3;
  window.ApifyLeads.search = async () => { paidRuns++; return places.slice(0, 4); };
  assert.equal((await scraper.run(opts)).length, 4);
  assert.equal(paidRuns, 1, 'a short Apify result does not trigger another paid run');

  result = null;
  storage.delete('allLeads');
  const saved = [];
  window.MemoryEngine = { addLead: async lead => { saved.push(lead); return { success: true }; } };
  window.ApifyLeads.search = async ({ onPartial }) => {
    onPartial(places.slice(0, 4));
    await new Promise(resolve => setTimeout(resolve, 15));
    return places.slice(0, 8);
  };
  const stopped = scraper.run({ ...opts, saveToDb: true });
  setTimeout(() => scraper.abort(), 1);
  const rows = await stopped;
  assert.equal(rows.length, 4, 'Stop freezes the last visible verified rows');
  assert.equal(result.stopped, true);
  assert.equal(result.leads.length, 4);
  assert.equal(saved.length, 4, 'stopped rows are persisted');
  assert.equal(JSON.parse(storage.get('allLeads')).length, 4, 'Leads Hub can read stopped rows');

  const interval = global.setInterval;
  global.setInterval = () => 0;
  require(path.join(__dirname, '..', 'clavis-task-model.js'));
  require(path.join(__dirname, '..', 'clavis-task-controller.js'));
  global.setInterval = interval;
  const taskId = window.ClavisTask.begin('Find 20 hotel leads in Delhi');
  let aborted = false;
  window.ClavisTask.Store.get(taskId)._onCancel = () => { aborted = true; return true; };
  window.ClavisTask.cancel(taskId);
  assert.equal(aborted, true);
  assert.equal(window.ClavisTask.Store.get(taskId).phase, 'working');
  document.dispatchEvent(new CustomEvent('nexus:agentstatus', {
    detail: { taskId, text: '2 verified leads ready', leads: rows.slice(0, 2) }
  }));
  assert.equal(window.ClavisTask.Store.get(taskId).partialRows.length, 2);
  document.dispatchEvent(new CustomEvent('nexus:scrapedone', {
    detail: { taskId, ok: true, stopped: true, total: 2, leads: rows.slice(0, 2) }
  }));
  const task = window.ClavisTask.Store.get(taskId);
  assert.equal(task.phase, 'completed');
  assert.equal(task.result.rows.length, 2, 'partial rows drive the preview');
  const excel = task.actions.find(action => action.id === 'download-excel');
  assert.ok(excel, 'stopped task exposes Excel download');
  let exported;
  window.RealScraper.exportExcel = resultRows => { exported = resultRows; };
  excel.run();
  assert.equal(exported.length, 2, 'Excel uses only the stopped task rows');
  console.log('Lead count and Stop partial-result checks passed');
}

main().catch(error => { console.error(error); process.exitCode = 1; });
