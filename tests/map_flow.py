"""Map flow, end to end in Chromium with every outside service mocked.
Run: python3 tests/map_flow.py"""
import sys
from playwright.sync_api import sync_playwright
from pw_harness import open_app, SHOTS, _json

results = []


def check(name, ok, detail=''):
    results.append((name, bool(ok)))
    print(('PASS ' if ok else 'FAIL ') + name + (f'  [{detail}]' if detail else ''))


with sync_playwright() as pw:
    b, page, errors = open_app(pw)

    check('canvas self-test', page.evaluate('() => window.ClavisCanvas._selfTest()'))
    check('intent self-test', page.evaluate('() => window.ClavisIntent._selfTest()'))

    # 1. bare "map kholo" opens the map on his location, below the live caption
    page.evaluate("""() => {
      if (!document.getElementById('clavis-ear-caption')) {
        const cap = document.createElement('div'); cap.id = 'clavis-ear-caption';
        Object.assign(cap.style, { position: 'fixed', top: '145px', right: '40px', width: '420px', height: '52px', zIndex: '2147482000' });
        document.body.appendChild(cap);
      }
      window.ClavisEar.caption.live('do line ka test caption');
    }""")
    r = page.evaluate("() => window.ClavisIntent.route('map kholo')")
    check('"map kholo" handled', r.get('handled'), r.get('spoken'))
    page.wait_for_function("() => document.querySelector('#clavis-canvas .ccv-map.is-ready')", timeout=20000)
    page.wait_for_timeout(2500)
    geo = page.evaluate("""() => {
      const cap = document.getElementById('clavis-ear-caption');
      const capTop = parseFloat(getComputedStyle(cap).top);
      const cv = document.getElementById('clavis-canvas').getBoundingClientRect();
      const c = window.ClavisCanvas.map().getCenter();
      return { capTop, capBottom: cap.getBoundingClientRect().bottom, top: cv.top, title: document.querySelector('.ccv-title').textContent, lat: c.lat, lng: c.lng };
    }""")
    check('map opened on my location', abs(geo['lat'] - 28.6692) < 0.01 and abs(geo['lng'] - 77.4538) < 0.01, geo)
    check('window sits below the 2-line caption band', geo['top'] >= geo['capTop'] + 52 + 12 - 1 and geo['top'] >= geo['capBottom'], geo)
    page.screenshot(path=str(SHOTS / 'map_1_open.png'))

    # still below after a resize
    page.set_viewport_size({'width': 1280, 'height': 820})
    page.wait_for_timeout(400)
    g2 = page.evaluate("() => ({ top: document.getElementById('clavis-canvas').getBoundingClientRect().top, capTop: parseFloat(getComputedStyle(document.getElementById('clavis-ear-caption')).top) })")
    check('below caption after resize', g2['top'] >= g2['capTop'] + 63, g2)

    # 2. card mode is explorable: a drag moves the centre
    page.wait_for_function("() => !window.ClavisCanvas.map().isMoving()", timeout=15000)
    before = page.evaluate("() => window.ClavisCanvas.map().getCenter().toArray()")
    box = page.evaluate("() => { const r = document.querySelector('#clavis-canvas .ccv-map').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; }")
    page.mouse.move(box['x'], box['y'])
    page.mouse.down()
    for i in range(1, 11):
        page.mouse.move(box['x'] - 12 * i, box['y'] + 6 * i)
        page.wait_for_timeout(16)
    page.mouse.up()
    page.wait_for_timeout(600)
    after = page.evaluate("() => window.ClavisCanvas.map().getCenter().toArray()")
    check('drag in card mode moves the map', abs(before[0] - after[0]) + abs(before[1] - after[1]) > 1e-4, f'{before} -> {after}')
    check('still card (not expanded) after drag', page.evaluate("() => !document.getElementById('clavis-canvas').classList.contains('is-expanded')"))

    # 3. leads with mixed coordinates: never invented
    res = page.evaluate("""() => window.ClavisCanvas.showLeads([
      { company: 'Alpha Facility Pvt Ltd', lat: 28.6711, lng: 77.4512, contactPerson: 'Rakesh Sharma', designation: 'Director', phones: ['+91 98100 11111', '+91 98100 22222'], email: 'info@alpha.in', website: 'alpha.in', address: 'RDC, Ghaziabad' },
      { company: 'Beta Hospital', lat: 28.6711, lng: 77.4512, phone: '+91 99990 33333', address: 'RDC, Ghaziabad' },
      { company: 'Gamma Mall', latitude: 28.7340, longitude: 77.2890, address: 'Loni' },
      { company: 'Skyline Towers', address: 'Raj Nagar Extension', city: 'Ghaziabad' },
      { company: 'City Only Corp', city: 'Ghaziabad' },
      { company: 'Nowhere Traders', address: 'Unknown lane', city: 'Atlantis' },
    ], { title: 'Test leads' })""")
    check('showLeads shown/skipped', res.get('shown') == 4 and res.get('skipped') == 2, res)
    pins = page.evaluate("() => document.querySelectorAll('#clavis-canvas .ccv-lead').length")
    check('4 lead pins on the map', pins == 4, pins)
    offs = page.evaluate("() => [...document.querySelectorAll('#clavis-canvas .ccv-lead')].slice(0, 2).map((e) => e.getBoundingClientRect().left)")
    check('overlapping pins fanned out', len(offs) == 2 and abs(offs[0] - offs[1]) > 8, offs)
    page.wait_for_timeout(2000)
    page.evaluate("() => document.querySelector('#clavis-canvas .ccv-lead').click()")
    page.wait_for_timeout(500)
    pop = page.evaluate("() => document.querySelector('#clavis-canvas .maplibregl-popup')?.innerText || ''")
    check('pin popup has contacts + in-app directions', all(x in pop for x in ['Alpha Facility', 'Rakesh Sharma', 'Director', '98100 22222', 'info@alpha.in', 'Directions', 'from you']) and 'Google Maps' not in pop, pop.replace('\n', ' | '))
    page.screenshot(path=str(SHOTS / 'map_2_leads.png'))

    # 4. Directions from the popup -> in-app route with the four modes
    page.evaluate("() => document.querySelector('#clavis-canvas .maplibregl-popup [data-act=dir]').click()")
    page.wait_for_function("() => document.querySelectorAll('#clavis-canvas .ccv-route ul li').length === 4", timeout=15000)
    check('Directions button draws a route', True)

    # 5. route between two named places: 4 modes, estimates labelled, metro fare
    r = page.evaluate("() => window.ClavisCanvas.route({ from: 'Ghaziabad Station', to: 'Loni Border' })")
    rows = page.evaluate("() => [...document.querySelectorAll('#clavis-canvas .ccv-route ul li')].map((li) => li.textContent.trim())")
    check('route panel shows Car / Two-wheeler / Walk / Metro', len(rows) == 4 and all(row.startswith(name) for row, name in zip(rows, ['Car', 'Two-wheeler', 'Walk', 'Metro'])), rows)
    check('two-wheeler + metro labelled estimate, "without traffic" note', 'estimate' in rows[1] and 'estimate' in rows[3] and 'Without traffic' in page.inner_text('#clavis-canvas .ccv-route'))
    m = r.get('metro') or {}
    fare_ok = page.evaluate(f"() => window.ClavisCanvas.metroFare({m.get('ride_km', 0)})") == m.get('fare_inr')
    check('route result has car/walk/metro estimate', r.get('car') and r.get('walk') and m.get('practical') and fare_ok, {k: r.get(k) for k in ('car', 'two_wheeler', 'walk', 'metro')})
    check('compact trip details float over map', page.evaluate("() => { const map = document.querySelector('#clavis-canvas .ccv-map').getBoundingClientRect(), card = document.querySelector('#clavis-canvas .ccv-route').getBoundingClientRect(); return map.height >= 300 && card.top >= map.top && card.bottom <= map.bottom && !document.querySelector('#clavis-canvas .ccv-foot').offsetHeight; }"))
    page.evaluate("() => document.querySelector('#clavis-canvas [data-act=route-details]').click()")
    check('compact trip details expand in place', page.evaluate("() => document.querySelector('#clavis-canvas .ccv-route').classList.contains('is-detailed')"))
    fares = page.evaluate("() => [0, 2, 2.01, 5, 5.5, 12, 12.5, 21, 21.5, 32, 32.5, 60].map((k) => window.ClavisCanvas.metroFare(k))")
    check('fare slabs', fares == [11, 11, 21, 21, 32, 32, 43, 43, 54, 54, 64, 64], fares)
    page.wait_for_timeout(2000)
    page.screenshot(path=str(SHOTS / 'map_3_route.png'))
    check('route line drawn', page.evaluate("() => !!window.ClavisCanvas.map().getLayer('ccv-route-line')"))

    # 6. route intents (Hinglish + Devanagari) reply with the numbers
    for q in ['Ghaziabad Station se Loni Border kitni door hai', 'Rajiv Chowk se Noida Sector 18 metro ka kiraya', 'meri current location se nearest metro station tak route dikhao']:
        rr = page.evaluate(f"() => window.ClavisIntent.route({q!r})")
        check(f'intent: {q}', rr.get('handled') and any(ch.isdigit() for ch in rr.get('spoken', '')), rr.get('spoken'))

    # 7. click two points -> route
    page.evaluate("() => { window.ClavisCanvas.map().jumpTo({ center: [77.45, 28.67], zoom: 13 }); }")
    page.evaluate("() => document.querySelector('#clavis-canvas [data-act=route-clear]')?.click()")
    page.wait_for_timeout(300)
    mb = page.evaluate("() => { const r = document.querySelector('#clavis-canvas .ccv-map').getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; }")
    page.mouse.click(mb['x'] + mb['w'] * 0.7, mb['y'] + mb['h'] * 0.75)
    page.wait_for_timeout(400)
    page.mouse.click(mb['x'] + mb['w'] * 0.85, mb['y'] + mb['h'] * 0.35)
    page.wait_for_function("() => document.querySelectorAll('#clavis-canvas .ccv-pt').length === 2 && document.querySelectorAll('#clavis-canvas .ccv-route ul li').length === 4", timeout=15000)
    check('two clicks -> points A, B and a route', True)

    # 8. expand / collapse: FLIP, no page errors, still below the caption
    n_err = len(errors)
    page.evaluate("() => window.ClavisCanvas.expand()")
    page.wait_for_timeout(250)
    mid = page.evaluate("() => getComputedStyle(document.getElementById('clavis-canvas')).transform")
    page.wait_for_timeout(500)
    ex = page.evaluate("() => { const r = document.getElementById('clavis-canvas').getBoundingClientRect(); return { top: r.top, bottom: innerHeight - r.bottom, left: r.left, right: innerWidth - r.right, w: r.width, h: r.height, bd: getComputedStyle(document.querySelector('.ccv-backdrop')).backdropFilter }; }")
    page.screenshot(path=str(SHOTS / 'map_4_expanded.png'))
    check('expand animates with transform', mid not in ('none', ''), mid)
    check('expanded: below caption, wide map, no blur', ex['top'] >= geo['capBottom'] + 10 and abs(ex['left'] - ex['right']) < 3 and ex['w'] > 1000 and ex['h'] > 450 and ex['bd'] in ('none', ''), ex)
    page.evaluate("() => window.ClavisCanvas.collapse()")
    page.wait_for_timeout(150)
    mid2 = page.evaluate("() => { const e = document.getElementById('clavis-canvas'); return { layout: e.offsetWidth, painted: e.getBoundingClientRect().width }; }")
    page.wait_for_timeout(1200)
    w = page.evaluate("() => { const e = document.getElementById('clavis-canvas'); return { layout: e.offsetWidth, painted: e.getBoundingClientRect().width, anims: e.getAnimations().length }; }")
    check('collapse: laid out once at card size, glides there', mid2['layout'] < 700 and mid2['painted'] > mid2['layout'] and w['painted'] < 700 and w['anims'] == 0, (mid2, w))
    check('no page errors during expand/collapse', len(errors) == n_err, errors[n_err:])

    # 9. meri location dikhao
    rr = page.evaluate("() => window.ClavisIntent.route('meri location dikhao')")
    check('"meri location dikhao"', rr.get('handled') and page.evaluate("() => !!document.querySelector('#clavis-canvas .ccv-me')"), rr.get('spoken'))

    # 10. pictures open in their OWN window, on the left while the map is open
    ov = {'results': [{'thumbnail': 'http://localhost:3000/x.png', 'url': f'http://localhost:3000/x{i}.png', 'title': f'Taj Mahal {i}', 'source': 'test', 'foreign_landing_url': ''} for i in range(4)]}
    page.route('https://api.openverse.org/**', lambda r: _json(r, ov))
    page.route('https://commons.wikimedia.org/**', lambda r: _json(r, {}))
    page.evaluate("() => window.ClavisCanvas.showImages({ query: 'Taj Mahal' })")
    page.wait_for_function("() => window.ClavisCanvas.peekOpen()", timeout=20000)
    page.wait_for_timeout(1200)
    two = page.evaluate("""() => { const m = document.getElementById('clavis-canvas').getBoundingClientRect(), p = document.getElementById('clavis-peek-canvas').getBoundingClientRect();
      return { mapOpen: window.ClavisCanvas.mapOpen(), peekOpen: window.ClavisCanvas.peekOpen(), pRight: p.right, mLeft: m.left, pLeft: p.left, mapKind: document.getElementById('clavis-canvas').dataset.kind }; }""")
    page.screenshot(path=str(SHOTS / 'map_5_side_by_side.png'))
    check('map + floating window are two windows, no overlap', two['mapOpen'] and two['peekOpen'] and two['mapKind'] == 'map' and two['pRight'] <= two['mLeft'], two)
    page.evaluate("() => window.ClavisCanvas.hideMap()")
    page.wait_for_timeout(1200)
    solo = page.evaluate("() => { const p = document.getElementById('clavis-peek-canvas').getBoundingClientRect(); return { right: innerWidth - p.right, left: p.left }; }")
    check('floating window alone goes back to the right', solo['right'] < 60, solo)

    check('no page errors overall', not errors, errors[:5])
    b.close()

failed = [n for n, ok in results if not ok]
print(f'\n{len(results) - len(failed)}/{len(results)} passed')
sys.exit(1 if failed else 0)
