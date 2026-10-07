"""Lead flow end to end: "Ghaziabad aur Loni ki 6 leads nikaal kar do aur map
pe dikhao" -> both cities searched -> rows with coords, owner, several phones
-> preview table + downloads in the floating window -> pins on the map.
The backend (maps-search / enrich-websites) is mocked with fixtures.
Run: python3 tests/leads_flow.py"""
import sys

from playwright.sync_api import sync_playwright
from pw_harness import open_app, SHOTS

from leads_fixtures import backend, calls

results = []


def check(name, ok, detail=''):
    results.append((name, bool(ok)))
    print(('PASS ' if ok else 'FAIL ') + name + (f'  [{detail}]' if detail else ''))


with sync_playwright() as pw:
    b, page, errors = open_app(pw, backend=backend)
    page.evaluate("""() => {
      window.__shown = [];
      const orig = window.ClavisCanvas.showLeads;
      window.ClavisCanvas.showLeads = (rows, o) => { window.__shown.push({ n: rows.length, o }); return orig(rows, o).then((r) => { window.__shownResult = r; return r; }); };
      window.__downloads = [];
    }""")
    page.evaluate("() => window.handleJarvisSend('Ghaziabad aur Loni ki 6 leads nikaal kar do aur map pe dikhao')")
    try:
        page.wait_for_function("() => { const t = window.ClavisTask && window.ClavisTask.current(); return t && (t.phase === 'completed' || t.phase === 'failed'); }", timeout=90000)
    except Exception as e:
        print('timeout waiting for task', e)
    task = page.evaluate("() => { const t = window.ClavisTask.current(); return t && { phase: t.phase, error: t.error, text: t.result && t.result.text, rows: (t.result && t.result.rows || []).map((r) => ({ company: r.company, city: r.city, lat: r.lat, lng: r.lng, contactPerson: r.contactPerson, designation: r.designation, phones: r.phones, email: r.email })) }; }")
    queries = [q for batch in calls['maps'] for q in batch]
    check('both cities searched', any('Ghaziabad' in q for q in queries) and any('Loni' in q for q in queries), queries[:4])
    check('task completed', task and task['phase'] == 'completed', task and (task.get('error') or task.get('phase')))
    rows = (task or {}).get('rows') or []
    check('6 rows from both cities', len(rows) == 6 and {r['city'] for r in rows} == {'Ghaziabad', 'Loni'}, [(r['company'], r['city']) for r in rows])
    check('rows carry lat/lng', rows and all(isinstance(r['lat'], (int, float)) and isinstance(r['lng'], (int, float)) for r in rows))
    check('owners + designations kept', sum(1 for r in rows if r['contactPerson'] and r['designation']) >= 4, [(r['contactPerson'], r['designation']) for r in rows])
    check('several phones, mobiles first', any(len(r['phones']) >= 2 for r in rows) and all(not r['phones'] or r['phones'][0].startswith('+91 9') for r in rows), [r['phones'] for r in rows][:3])
    cities_seq = [r['city'] for r in rows]
    check('nearby companies adjacent (cities not interleaved)', sum(1 for a, c in zip(cities_seq, cities_seq[1:]) if a != c) == 1, cities_seq)

    page.wait_for_timeout(2500)
    ui = page.evaluate("""() => {
      const el = document.getElementById('clavis-task-surface');
      const head = [...(el?.querySelectorAll('.cts-leads-preview th') || [])].map((x) => x.textContent);
      const trs = el?.querySelectorAll('.cts-leads-preview tbody tr').length || 0;
      const more = el?.querySelector('.cts-leads-preview tbody tr:last-child')?.textContent.trim() || '';
      const btns = [...(el?.querySelectorAll('button') || [])].map((x) => x.textContent.trim()).filter(Boolean);
      return { head, trs, more, btns, open: !!el && el.classList.contains('is-open') };
    }""")
    check('five lead preview plus remaining count', ui['head'] == ['Company', 'Authority', 'Mobile', 'Email', 'Area'] and ui['trs'] == 6 and '+1 more' in ui['more'], ui)
    check('Download Excel / CSV / Show on map buttons', all(any(x == lbl or x.endswith(lbl) for x in ui['btns']) for lbl in ('Download Excel', 'Download CSV', 'Show on map')), ui['btns'])
    try:
        page.wait_for_function("() => window.__shownResult", timeout=30000)
    except Exception:
        print('map diagnostic', page.evaluate("() => ({want: window.ClavisTask.current()?.showOnMap, text: window.ClavisTask.current()?.result?.text, calls: window.__shown, canvas: !!window.ClavisCanvas})"))
        raise
    shown = page.evaluate("() => ({ calls: window.__shown, r: window.__shownResult, pins: document.querySelectorAll('#clavis-canvas .ccv-lead').length, text: window.ClavisTask.current().result.text })")
    check('showLeads called with the rows', shown['calls'] and shown['calls'][0]['n'] == 6 and shown['r']['shown'] == 6 and shown['pins'] == 6, shown)
    check('summary mentions placed count', '6 of 6 placed on the map' in shown['text'], shown['text'])
    page.wait_for_timeout(2200)
    page.screenshot(path=str(SHOTS / 'leads_1_done.png'))
    ov = page.evaluate("() => { const a = document.getElementById('clavis-canvas').getBoundingClientRect(), b = document.getElementById('clavis-task-surface').getBoundingClientRect(); return { mapRight: a.right, surfLeft: b.left }; }")
    check('map card does not cover the lead preview window', ov['mapRight'] <= ov['surfLeft'], ov)

    # downloads: CSV has the owner's columns
    with page.expect_download(timeout=15000) as dl:
        page.evaluate("() => [...document.querySelectorAll('#clavis-task-surface button')].find((x) => /Download CSV/.test(x.textContent)).click()")
    csv = open(dl.value.path(), encoding='utf-8-sig').read()
    header = csv.splitlines()[0]
    want = 'Company,Owner / Authority,Designation,Mobile 1,Mobile 2,Mobile 3,Landline,Email,Other emails,Website,Address,Area/City,Latitude,Longitude,Google Maps link,Rating,Source'
    check('CSV columns', header == want, header)
    check('CSV row has owner, 2 mobiles, landline, coords', any('Rakesh Sharma' in ln and '+91 98100 22222' in ln and '28.6415' in ln for ln in csv.splitlines()), csv.splitlines()[1][:200])
    with page.expect_download(timeout=15000) as dl2:
        page.evaluate("() => [...document.querySelectorAll('#clavis-task-surface button')].find((x) => /Download Excel/.test(x.textContent)).click()")
    check('Excel download', dl2.value.suggested_filename.endswith(('.xlsx', '.csv')), dl2.value.suggested_filename)

    check('no page errors', not errors, errors[:5])
    b.close()

    # Client AI must own exactly one scraper run; the task wrapper also sees
    # ChatEngine.sendMessage and used to start a second run with new callbacks.
    b2, page2, errors2 = open_app(pw, backend=backend)
    page2.evaluate("""() => {
      window.showView('chat');
      window.__leadRuns = 0;
      const original = window.RealScraper.run;
      window.RealScraper.run = function (...args) { window.__leadRuns++; return original.apply(this, args); };
    }""")
    page2.evaluate("() => window.handleChatSend('Ghaziabad ki 6 leads nikaal do')")
    page2.wait_for_function("() => { const t = window.ClavisTask?.current?.(); return t && ['completed', 'failed'].includes(t.phase); }", timeout=90000)
    client = page2.evaluate("""() => {
      const t = window.ClavisTask.current();
      return { runs: window.__leadRuns, phase: t.phase, rows: t.result?.rows?.length || 0,
        preview: document.querySelectorAll('#clavis-task-surface .cts-leads-preview tbody tr').length,
        open: document.getElementById('clavis-task-surface')?.classList.contains('is-open') };
    }""")
    check('Client AI starts one lead run', client['runs'] == 1, client)
    check('Client AI result reaches floating preview', client['phase'] == 'completed' and client['rows'] > 0 and client['preview'] > 0 and client['open'], client)
    check('Client AI no page errors', not errors2, errors2[:5])
    b2.close()

failed = [n for n, ok in results if not ok]
print(f'\n{len(results) - len(failed)}/{len(results)} passed')
sys.exit(1 if failed else 0)
