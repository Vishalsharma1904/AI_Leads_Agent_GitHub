/** Offline regression checks for lead generation — the filters that used to
 *  silently return zero leads, and the intent parse that used to ask him
 *  for details he had already given. */
'use strict';

const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const read = (n) => fs.readFileSync(path.join(ROOT, n), 'utf8');

global.window = { addEventListener() {}, dispatchEvent() {} };
global.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
global.document = { addEventListener() {}, getElementById: () => null };
global.location = { protocol: 'http:' };
Object.defineProperty(global, "navigator", { value: {}, configurable: true });
global.fetch = () => Promise.reject(new Error('offline'));
global.CustomEvent = function () {};
require(path.join(ROOT, 'lead-candidate-domain.js'));
require(path.join(ROOT, 'real-scraper.js'));

const D = global.window.LeadCandidateDomain;
const R = global.window.RealScraper;

let failures = 0;
function check(name, cond, detail = '') {
  if (cond) console.log('  PASS  ' + name);
  else { console.log('  FAIL  ' + name + (detail ? ' -> ' + detail : '')); failures++; }
}

console.log('\nLead generation verification\n');

// ── intent: he never explains the same request twice ──────────────────────
const search = (t) => D.parseRequest(t).isSearch;
check('"leads chahiye" alone is a search', search('leads chahiye'));
check('"mujhe leads do" is a search', search('mujhe leads do'));
check('"aur leads" is a search', search('aur leads'));
check('"Gurugram ki leads nikalo" is a search', search('Gurugram ki leads nikalo'));
check('a question about saved leads is NOT a new scrape',
  !search('saved leads kitni hain') && !search('leads export karo'));

// ── city: his spelling, his town ──────────────────────────────────────────
const cityOf = (t) => D.parseRequest(t).cities[0];
check('"gurgaon" and "gurugram" resolve to ONE canonical city',
  cityOf('gurgaon ki leads') === 'Gurugram' && cityOf('Gurugram ki leads') === 'Gurugram',
  cityOf('gurgaon ki leads'));
check('an unknown town keeps his spelling, it is not swapped',
  cityOf('shimla ki leads nikalo') === 'Shimla' && cityOf('Udaipur me leads chahiye') === 'Udaipur',
  cityOf('shimla ki leads nikalo') + ' / ' + cityOf('Udaipur me leads chahiye'));
check('a real typo still resolves', cityOf('gaziabad ki leads') === 'Ghaziabad', cityOf('gaziabad ki leads'));
check('aliasesFor covers every spelling of a city',
  D.aliasesFor('Gurugram').includes('gurgaon') && D.aliasesFor('Bengaluru').includes('bangalore'));
check('specific areas never widen to the parent city',
  JSON.stringify(D.parseRequest('East Delhi ki leads nikalo 20 leads').cities) === '["East Delhi"]' &&
  JSON.stringify(D.parseRequest('find 10 hotels in East Delhi').cities) === '["East Delhi"]' &&
  cityOf('mujhe east delhi ka data chahie') === 'East Delhi' &&
  cityOf('Sector 62 Noida ki leads') === 'Sector 62 Noida' &&
  cityOf('find leads in Mayur Vihar Delhi') === 'Mayur Vihar Delhi');
check('separate requested areas remain separate',
  JSON.stringify(D.parseRequest('East Delhi aur Noida ki leads').cities) === '["East Delhi","Noida"]' &&
  JSON.stringify(D.parseRequest('Laxmi Nagar aur Shakarpur ki leads').cities) === '["Laxmi Nagar","Shakarpur"]');
check('compound directional areas stay specific', cityOf('North East Delhi leads') === 'North East Delhi');
check('sector numbers are not lead counts', D.parseRequest('Sector 62 Noida ki leads').count === 20);

// ── location filter: the bug that threw away every lead ───────────────────
const at = (address) => ({ company: 'Test Hotel', address, sourceCity: '' });
check('a Gurugram address satisfies a "Gurgaon" request',
  R.matchesRequestedLocation(at('DLF Phase 3, Gurugram, Haryana 122002'), ['Gurgaon']));
check('a Gurgaon address satisfies a "Gurugram" request',
  R.matchesRequestedLocation(at('Sector 14, Gurgaon, Haryana'), ['Gurugram']));
check('a Bengaluru address satisfies a "Bangalore" request',
  R.matchesRequestedLocation(at('MG Road, Bengaluru, Karnataka'), ['Bangalore']));
check('an out-of-area listing is still rejected',
  !R.matchesRequestedLocation(at('Bhuj, Gujarat 370001'), ['Gurugram']));
check('a listing with no address is still rejected',
  !R.matchesRequestedLocation(at(''), ['Gurugram']));
check('East Delhi rejects generic Delhi and out-of-area addresses',
  R.matchesRequestedLocation(at('Patparganj, East Delhi, Delhi'), ['East Delhi']) &&
  !R.matchesRequestedLocation(at('Dwarka, New Delhi, Delhi'), ['East Delhi']) &&
  !R.matchesRequestedLocation({ city: 'East Delhi', address: '', sourceCity: '' }, ['East Delhi']));
check('location matching preserves word and sector boundaries',
  !R.matchesRequestedLocation(at('South Delhi'), ['East Delhi']) &&
  !R.matchesRequestedLocation(at('Sector 620, Noida'), ['Sector 62 Noida']) &&
  !R.matchesRequestedLocation(at('Colonies Road'), ['Loni']));

// ── competitor filter: keep rivals out, keep buyers in ────────────────────
const lead = (o) => Object.assign({ company: '', mapsCategory: '', industry: '', address: '' }, o);
check('a rival security agency is dropped',
  R.isProviderCompetitor(lead({ company: 'Rudra Security Services Pvt Ltd' })));
check('a manpower/staffing vendor is dropped',
  R.isProviderCompetitor(lead({ company: 'Shakti Manpower Solutions' })));
check('Google\'s own category can drop a rival',
  R.isProviderCompetitor(lead({ company: 'SK Enterprises', mapsCategory: 'Security guard service' })));
check('a hotel is kept', !R.isProviderCompetitor(lead({ company: 'Hotel Taj Gurugram', mapsCategory: 'Hotel' })));
check('a hospital is kept', !R.isProviderCompetitor(lead({ company: 'Apollo Hospital' })));
// These two were the real killers: our own query text and a street name.
check('our own search term never drops the buyer it found',
  !R.isProviderCompetitor(lead({ company: 'Unitech Cyber Park', industry: 'Facility Management Companies' })));
check('a street name never drops a buyer',
  !R.isProviderCompetitor(lead({ company: 'Hotel Bristol', address: 'Manpower Chowk, Sector 18' })));

// ── contact quality ───────────────────────────────────────────────────────
check('a real mobile is kept as a mobile', R.parsePhoneNumber('98112 34567')?.type === 'mobile');
check('landline is recognised, not discarded', Boolean(R.parsePhoneNumber('0120 4567890')));
check('junk and sample numbers are rejected',
  !R.cleanPhone('1234567890') && !R.cleanPhone('9876543210') && !R.cleanPhone('9999999999'));
check('a lead needs a real phone or email', !R.isQualifiedLead({ company: 'X' })
  && R.isQualifiedLead({ company: 'X', phone: '9811234567' })
  && R.isQualifiedLead({ company: 'X', email: 'gm@acmehotels.in' }));
check('aggregator sites are not accepted as a company website',
  !R.cleanWebsite('https://www.justdial.com/abc') && Boolean(R.cleanWebsite('acmehotels.in')));

// ── honesty ───────────────────────────────────────────────────────────────
const rs = read('real-scraper.js');
check('a dead backend is reported as an outage, not an empty city',
  rs.includes('if (!all.length && failures.length)') && rs.includes('not reachable|Scrapling is not installed'));
check('the competitor filter no longer reads our query text or the address',
  rs.includes('const hay = [lead && lead.company, lead && lead.mapsCategory]'));

const maps = read('backend/services/leads/maps_scraper.py');
check('Google\'s category is actually scraped, not left blank',
  maps.includes('_CATEGORY_SEL') && !maps.includes('"categoryName": "",'));

const wc = read('backend/services/leads/website_crawler.py');
check('every lead on a shared domain gets the contact crawl',
  wc.includes('prepared[key].append(record)') && wc.includes('for record in siblings:'));

// ── nothing is invented ───────────────────────────────────────────────────
const appjs = read('app.js');
check('a missing contact name stays blank, it is never invented',
  appjs.includes("if (this.isFakeName(s.name)) s.name = '';")
  && !appjs.includes('${s.company} Contact'));
const ag = read('agent.js');
check('vendor / hiring / staff-size are not guessed from a review count',
  !ag.includes("'Likely Agency Contract (Empanelled)'")
  && !ag.includes("'250-1000+ Staff'")
  && !ag.includes("'Likely Outsourcing Procurement Active'")
  && !ag.includes("status: 'Verified Client Lead'"));

const jv = read('jarvis.js');
check('Rudra24 AI never asks which city / how many for a lead search',
  jv.includes('LEADS ARE NEVER AMBIGUOUS'));
check('Rudra24 AI offers the calling agent once the leads are in',
  jv.includes('calling agent ko de doon'));
check('the realtime voice brain says the same', read('clavis-live.js').includes('LEADS ARE NEVER AMBIGUOUS'));

// ── listening speed ───────────────────────────────────────────────────────
const vs = read('clavis-voice-state.js');
check('a trailing "sir" / "Rudra" no longer buys 2.5s of silence',
  vs.includes('VOCATIVE_END') && vs.includes('stripVocative') && !vs.includes('if (dangles(t)) return 2500;'));
check('a finished sentence commits fast',
  read('jarvis_ui.js').includes('if (isFinal && d !== Infinity && d <= 450 && !ear.holding) d = 120;'));

if (failures) {
  console.error(`\n${failures} lead pipeline check(s) failed.`);
  process.exit(1);
}
console.log('\nAll lead pipeline checks passed.');
