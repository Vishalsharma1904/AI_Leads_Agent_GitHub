/* Checks for the two pieces of logic added for the metro button and the
 * lead owner lookup. Both failed in ways that LOOKED fine on screen:
 *   · "Delhi Metro Yellow Line" was being reported as the nearest station,
 *     because Nominatim answers type:"subway" for the track geometry too;
 *   · "Vice President" was canonicalising to "President", because the
 *     generic rule sat above the specific one.
 * Neither threw. Both printed something plausible. Hence these. */
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');
let failures = 0;
function check(label, ok) {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}`);
  if (!ok) failures++;
}

// ── metro: station naming ────────────────────────────────────────────────
const metroSrc = read('clavis-metro.js');
const stationName = eval('(' + metroSrc.match(/function stationName\(raw\) \{[\s\S]*?\n  \}/)[0] + ')');

check('a station entrance resolves to its station',
  stationName('Jasola Vihar Shaheen Bagh Metro Station Gate Number 2') === 'Jasola Vihar Shaheen Bagh Metro Station');
check('a lift number is stripped without eating the station number',
  stationName('Mayur Vihar - 1 Metro Station Lift Number 4A') === 'Mayur Vihar - 1 Metro Station');
check('a plain station name is left alone',
  stationName('Botanical Garden Metro Station') === 'Botanical Garden Metro Station');

check('Nominatim ways are rejected (they are track, not stations)',
  /osm_type !== 'node'/.test(metroSrc));
check('bus stops named "… Metro Station" are rejected',
  /!== 'railway'/.test(metroSrc));
check('a line name can never be returned as a station',
  /LINE_NAME_RE/.test(metroSrc) && /\\bline\\b/.test(metroSrc));

// the same bug existed in the app's own lookup
const canvas = read('clavis-canvas.js');
check("the app's own nearestStation also filters ways and line names",
  /osm_type === 'node'/.test(canvas) && /NOT_A_STATION/.test(canvas));

// ── metro: DMRC fare slabs ───────────────────────────────────────────────
const fare = eval('(' + metroSrc.match(/function fare\(km\) \{[\s\S]*?\n  \}/)[0] + ')');
check('DMRC fare slabs, including both sides of every boundary',
  [[0.5, 11], [2, 11], [2.1, 21], [5, 21], [5.1, 32], [12, 32],
   [12.1, 43], [21, 43], [21.1, 54], [32, 54], [32.1, 64], [60, 64]]
    .every(([km, rs]) => fare(km) === rs));
check('a nonsense distance prices nothing rather than guessing',
  fare(-1) === null && fare('abc') === null);

// ── map position: compact and expanded use DIFFERENT offsets ─────────────
check('expanded map clears only the app bar (--ccv-exp-top)',
  /--ccv-exp-top/.test(read('clavis-canvas.css')) && /setVar\('--ccv-exp-top', Math\.round\(topBarBottom\(\) \+ 12\)/.test(read('clavis-canvas.js')));
check('the caption band is only reserved while the caption is on screen',
  /capLive/.test(canvas));

// ── leads: the title ladder ──────────────────────────────────────────────
const crawler = read('backend/services/leads/website_crawler.py');
const vpAt = crawler.indexOf('vice[-\\s]?president');
const presAt = crawler.indexOf('(r"\\bpresident\\b"');
check('"Vice President" is matched before the bare "president" rule',
  vpAt > -1 && presAt > -1 && vpAt < presAt);
check('"Executive Director" is matched before the bare "director" rule',
  crawler.indexOf('executive\\s+director') < crawler.indexOf('(r"director", "Director"'));
check('the roles that buy security/housekeeping are in the ladder',
  ['Admin Head', 'HR Head', 'Operations Head', 'Facility Head', 'General Manager']
    .every((t) => crawler.includes(t)));
check('a web-search fallback exists for sites that name nobody',
  /async def authority_from_search/.test(crawler) && /enrich_authority_via_search/.test(crawler));
check('the search fallback reuses the name+title rule (cannot invent a person)',
  /authority_from_text\(blob\)/.test(crawler));

// ── leads: the owner actually reaches the output ─────────────────────────
check('CSV export carries Contact Person and Designation',
  read('app.js').includes("'Company','Contact Person','Designation'"));
check('Sheets sync carries them too',
  read('app.js').includes("'Company', 'Contact Person', 'Designation'"));
const leadsPage = read('page-leads.js');
check('the leads table exports them',
  leadsPage.includes("'Company Name', 'Contact Person', 'Designation'"));
check('the leads table shows them on screen',
  /\$\{person \?/.test(leadsPage));
check('names from web search are escaped before reaching innerHTML',
  /const esc = \(v\) =>/.test(leadsPage) && /personTitle = esc\(/.test(leadsPage));

if (failures) {
  console.error(`\n${failures} metro/authority check(s) failed.`);
  process.exit(1);
}
console.log('\nAll metro and lead-authority checks passed.');
