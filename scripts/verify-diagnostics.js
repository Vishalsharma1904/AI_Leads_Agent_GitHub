/**
 * Runs the real diagnostics.js against a DOM/localStorage stub and asserts the
 * behaviour that makes it trustworthy:
 *
 *  - it DETECTS planted faults (it is not a decorative green tick)
 *  - it REPAIRS them and the fault is genuinely gone afterwards
 *  - it NEVER reports "repaired" unless the re-check passed
 *  - a check that throws is reported, not swallowed
 *  - repairs never delete leads
 */

'use strict';

const fs = require('fs');
const path = require('path');

// ── Minimal DOM ───────────────────────────────────────────────────────────
const store = new Map();
const localStorageStub = {
  get length() { return store.size; },
  key: i => [...store.keys()][i],
  getItem: k => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: k => store.delete(k)
};

function makeEl(id) {
  return {
    id,
    style: { setProperty() {}, display: '', opacity: '' },
    classList: { _s: new Set(), add(c) { this._s.add(c); }, remove(c) { this._s.delete(c); }, contains(c) { return this._s.has(c); } },
    children: [],
    remove() {},
    setAttribute() {}, getAttribute() { return null; },
    querySelector() { return null; }, querySelectorAll() { return []; },
    appendChild() {}, focus() {}, textContent: '', innerHTML: ''
  };
}

const elements = new Map();
let computed = {};                       // id -> computed style overrides

const htmlEl = makeEl('html');
htmlEl._attrs = {};
htmlEl.setAttribute = (k, v) => { htmlEl._attrs[k] = v; };
htmlEl.getAttribute = k => (k in htmlEl._attrs ? htmlEl._attrs[k] : null);

const documentStub = {
  documentElement: htmlEl,
  body: { appendChild() {} },
  addEventListener() {},
  dispatchEvent() { return true; },
  getElementById: id => elements.get(id) || null,
  querySelector: sel => elements.get(sel) || null,
  querySelectorAll: sel => (elements.get('all:' + sel) || []),
  createElement: () => makeEl('created')
};

const windowStub = {
  location: { protocol: 'http:' },
  addEventListener() {},
  navigator: {},
  getComputedStyle: el => Object.assign({ display: 'block', opacity: '1', top: 'auto', bottom: 'auto' }, computed[el?.id] || {}),
  showToast() {}
};

const src = fs.readFileSync(path.join(__dirname, '..', 'diagnostics.js'), 'utf8');
new Function('window', 'document', 'localStorage', 'console', 'navigator', 'getComputedStyle', 'caches', src)(
  windowStub, documentStub, localStorageStub,
  { warn() {}, error() {}, info() {}, log() {} },
  { serviceWorker: undefined },
  windowStub.getComputedStyle,
  undefined
);

const diag = windowStub.Diagnostics;

let failures = 0;
function check(name, cond, detail) {
  if (cond) console.log('  PASS  ' + name);
  else { console.log('  FAIL  ' + name + (detail ? ' -> ' + detail : '')); failures++; }
}
const find = (findings, id) => findings.find(f => f.id === id);

console.log('\nDiagnostics engine verification\n');

(async () => {
  check('engine exposes checks', diag.list().length >= 12, 'count=' + diag.list().length);
  check('every check has a title and category',
    diag.list().every(c => c.title && c.category));

  // ══ 1. Corrupt JSON: plant, detect, repair, confirm ═══════════════════
  store.set('allLeads', '{ this is not valid json');
  let res = await diag.run({ autoRepair: false });
  let f = find(res.findings, 'storage-json');
  check('DETECTS corrupt stored JSON', f && !f.passed, f && f.message);

  res = await diag.run({ autoRepair: true });
  f = find(res.findings, 'storage-json');
  check('REPAIRS corrupt JSON', f && f.repaired === true, f && f.repairMessage);
  check('corrupt entry is actually gone afterwards', store.get('allLeads') === undefined);

  // ══ 2. Repairs must not destroy good lead data ════════════════════════
  const goodLeads = JSON.stringify([{ id: 'l1', company: 'Acme' }, { id: 'l2', company: 'Globex' }]);
  store.set('allLeads', goodLeads);
  await diag.run({ autoRepair: true });
  check('valid leads are NOT deleted by a repair sweep',
    store.get('allLeads') === goodLeads,
    String(store.get('allLeads')));

  // ══ 3. Invalid theme ══════════════════════════════════════════════════
  store.set('skylark-theme', 'neon-pink');
  store.set('lx-accent', 'chartreuse');
  res = await diag.run({ autoRepair: false });
  f = find(res.findings, 'theme-values');
  check('DETECTS invalid theme and accent', f && !f.passed, f && f.message);

  res = await diag.run({ autoRepair: true });
  f = find(res.findings, 'theme-values');
  check('REPAIRS invalid theme', f && f.repaired === true);
  check('theme reset to a valid value', store.get('skylark-theme') === 'dark', store.get('skylark-theme'));
  check('accent reset to a valid value', store.get('lx-accent') === 'purple', store.get('lx-accent'));

  // ══ 4. Toast container stretched (the reported bug) ════════════════════
  const toast = makeEl('toast-container');
  elements.set('toast-container', toast);
  computed['toast-container'] = { top: '20px', bottom: '24px', display: 'flex', opacity: '1' };

  res = await diag.run({ autoRepair: false });
  f = find(res.findings, 'toast-position');
  check('DETECTS a stretched notification container', f && !f.passed, f && f.message);
  check('message explains the topbar overlap',
    f && /topbar/i.test(f.message), f && f.message);

  // Make the repair observable: record what it sets, then reflect it.
  const applied = {};
  toast.style.setProperty = (prop, value) => { applied[prop] = value; };
  res = await diag.run({ autoRepair: true });
  check('repair anchors the container to the bottom',
    applied.top === 'auto' && applied.bottom === '24px',
    JSON.stringify(applied));

  // ══ 5. The "no false fixed" rule ══════════════════════════════════════
  // A container whose computed style refuses to change must NOT be reported
  // as repaired, because the re-check still fails.
  f = find(res.findings, 'toast-position');
  check('does NOT claim repaired while the re-check still fails',
    f && f.repaired === false,
    'repaired=' + (f && f.repaired));
  check('still reported as failing', f && f.passed === false);

  // Now let the computed style actually change, and it should report repaired.
  computed['toast-container'] = { top: 'auto', bottom: '24px', display: 'flex', opacity: '1' };
  res = await diag.run({ autoRepair: true });
  f = find(res.findings, 'toast-position');
  check('reports PASS once the fault is genuinely gone', f && f.passed === true, f && f.message);

  // ══ 6. Session inconsistency ══════════════════════════════════════════
  store.set('skylark_logged_in', 'true');
  store.delete('skylark_active_email');
  res = await diag.run({ autoRepair: false });
  f = find(res.findings, 'session-consistency');
  check('DETECTS signed-in with no account email', f && !f.passed, f && f.message);
  check('this is rated critical', f && f.severity === 'critical');

  store.set('allLeads', goodLeads);
  res = await diag.run({ autoRepair: true });
  f = find(res.findings, 'session-consistency');
  check('REPAIRS the inconsistent session flag', f && f.repaired === true);
  check('session repair did NOT delete leads', store.get('allLeads') === goodLeads);

  // ══ 7. Environment notice, correctly NOT auto-repaired ════════════════
  windowStub.location.protocol = 'file:';
  res = await diag.run({ autoRepair: true });
  f = find(res.findings, 'file-protocol');
  check('DETECTS running from file://', f && !f.passed, f && f.message);
  check('file:// is not falsely marked repaired', f && f.repaired === false);
  check('file:// is flagged as not repairable', f && f.repairable === false);
  check('file:// guidance tells the user how to serve the app',
    f && /serve/i.test(f.guidance), f && f.guidance);
  windowStub.location.protocol = 'http:';

  // ══ 8. A throwing check is surfaced, not swallowed ════════════════════
  diag.checks.push({
    id: 'test-explodes',
    title: 'Deliberately broken check',
    category: 'Test',
    severity: 'info',
    guidance: 'test only',
    detect() { throw new Error('boom'); }
  });
  res = await diag.run({ autoRepair: true });
  f = find(res.findings, 'test-explodes');
  check('a throwing check is reported as failing', f && !f.passed);
  check('the thrown reason is included', f && /boom/.test(f.message), f && f.message);
  diag.checks.pop();

  // ══ 9. Summary integrity ══════════════════════════════════════════════
  res = await diag.run({ autoRepair: true });
  const s = res.summary;
  check('summary counts add up',
    s.passed + s.remaining.length === s.total,
    `${s.passed} + ${s.remaining.length} != ${s.total}`);
  check('summary counts only real repairs',
    s.repaired === res.findings.filter(x => x.repaired).length);
  check('critical count matches failing critical findings',
    s.critical === res.findings.filter(x => !x.passed && x.severity === 'critical').length);

  // ══ 10. Clean app reports clean ═══════════════════════════════════════
  store.clear();
  store.set('skylark-theme', 'dark');
  store.set('lx-accent', 'purple');
  htmlEl.setAttribute('data-theme', 'dark');
  computed['toast-container'] = { top: 'auto', bottom: '24px', display: 'flex', opacity: '1' };
  res = await diag.run({ autoRepair: true });
  check('a healthy app reports zero critical issues', res.summary.critical === 0,
    res.summary.remaining.filter(x => x.severity === 'critical').map(x => x.title).join(', '));

  console.log('');
  if (failures) { console.error(failures + ' check(s) failed'); process.exit(1); }
  console.log('All diagnostics checks passed');
})();
