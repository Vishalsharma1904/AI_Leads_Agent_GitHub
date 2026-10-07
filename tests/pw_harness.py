"""Shared Playwright harness: serves this worktree at http://localhost:3000,
mocks every outside service the map and the lead pipeline use (no real
network), and fixes the browser location to Ghaziabad."""
import json, math, mimetypes, os, pathlib, re
from urllib.parse import urlparse, parse_qs, unquote_plus

ROOT = pathlib.Path(__file__).resolve().parent.parent
SHOTS = ROOT / 'tests' / 'screenshots'
HOME = {'latitude': 28.6692, 'longitude': 77.4538}   # Ghaziabad

STYLE = {'version': 8, 'sources': {}, 'layers': [{'id': 'bg', 'type': 'background', 'paint': {'background-color': '#e8e4da'}}]}

# name -> (lat, lng, place_rank); rank < 26 = city-level (not a real address)
PLACES = {
    'ghaziabad station': (28.6505, 77.4297, 30),
    'loni border': (28.7322, 77.2946, 30),
    'rajiv chowk': (28.6328, 77.2197, 30),
    'noida sector 18': (28.5708, 77.3261, 30),
    'noida': (28.5355, 77.3910, 16),
    'delhi': (28.6139, 77.2090, 16),
    'gurugram': (28.4595, 77.0266, 16),
    'skyline towers, raj nagar extension, ghaziabad': (28.6989, 77.4300, 30),
    'city only corp, ghaziabad': (28.6692, 77.4538, 16),
}


def metres(a, b):
    R, r = 6371000, math.pi / 180
    dlat, dlng = (b[0] - a[0]) * r, (b[1] - a[1]) * r
    h = math.sin(dlat / 2) ** 2 + math.cos(a[0] * r) * math.cos(b[0] * r) * math.sin(dlng / 2) ** 2
    return 2 * R * math.asin(math.sqrt(h))


def _json(route, data, status=200):
    route.fulfill(status=status, body=json.dumps(data), headers={'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*'})


def _nominatim(route):
    u = urlparse(route.request.url)
    q = parse_qs(u.query)
    if u.path.startswith('/reverse'):
        return _json(route, {'name': 'Test Road', 'display_name': 'Test Road, Ghaziabad, Uttar Pradesh, India'})
    text = unquote_plus(q.get('q', [''])[0]).lower().strip()
    if text == 'subway station':
        box = [float(v) for v in q.get('viewbox', ['77.43,28.69,77.47,28.65'])[0].split(',')]
        lat, lng = (box[1] + box[3]) / 2, (box[0] + box[2]) / 2
        return _json(route, [{'lat': str(lat + 0.0054), 'lon': str(lng), 'name': f'Station {lat:.2f}', 'type': 'subway'}])
    for key, (lat, lng, rank) in PLACES.items():
        if text == key or text.startswith(key):
            return _json(route, [{'lat': str(lat), 'lon': str(lng), 'name': key.title(), 'display_name': key.title() + ', India', 'place_rank': rank, 'type': 'x', 'boundingbox': None}])
    return _json(route, [])


def _overpass(route):
    body = unquote_plus(route.request.post_data or urlparse(route.request.url).query)
    m = re.search(r'around:2000,([\d.]+),([\d.]+)', body)
    if not m:
        return _json(route, {'elements': []})
    lat, lng = float(m.group(1)), float(m.group(2))
    # a station ~600 m north of every point, named after where it is
    return _json(route, {'elements': [{'type': 'node', 'lat': lat + 0.0054, 'lon': lng, 'tags': {'name': f'Station {lat:.2f}', 'station': 'subway'}}]})


def _osrm(route):
    m = re.search(r'/(routed-\w+)/route/v1/driving/([\d.]+),([\d.]+);([\d.]+),([\d.]+)', route.request.url)
    prof, lng1, lat1, lng2, lat2 = m.group(1), *map(float, m.groups()[1:])
    d = metres((lat1, lng1), (lat2, lng2)) * 1.3
    speed = {'routed-car': 8.33, 'routed-bike': 4.2, 'routed-foot': 1.39}[prof]
    _json(route, {'code': 'Ok', 'routes': [{'distance': d, 'duration': d / speed, 'geometry': {'type': 'LineString', 'coordinates': [[lng1, lat1], [(lng1 + lng2) / 2, lat1], [lng2, lat2]]}}]})


def _serve(route):
    url = route.request.url.split('?')[0].split('#')[0]
    rel = url.replace('http://localhost:3000/', '') or 'index.html'
    p = ROOT / rel
    if p.is_file():
        route.fulfill(path=str(p), content_type=mimetypes.guess_type(str(p))[0] or 'application/octet-stream')
    else:
        route.fulfill(status=404, body='')


def open_app(pw, backend=None, wait_for='() => window.ClavisCanvas && window.ClavisIntent && window.ClavisEar'):
    """backend(route) handles http://localhost:8000/** (None = aborted)."""
    SHOTS.mkdir(parents=True, exist_ok=True)
    b = pw.chromium.launch(proxy={'server': os.environ['HTTPS_PROXY']} if os.environ.get('HTTPS_PROXY') else None,
                           args=['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader'])
    ctx = b.new_context(ignore_https_errors=True, viewport={'width': 1440, 'height': 900},
                        geolocation=HOME, permissions=['geolocation'])
    ctx.add_init_script("localStorage.setItem('clavis_setup_snooze_until','9999999999999');"
                        "localStorage.setItem('clavis_consent_v1', JSON.stringify({ at: Date.now(), mic: false }))")
    # abort every ws:// / wss:// (route_web_socket deadlocks the sync API on this
    # page): sockets are pointed at a closed local port, so they fail at once
    ctx.add_init_script("(() => { const W = window.WebSocket; const F = function (u, p) { return new W('ws://127.0.0.1:9/'); };"
                        " F.prototype = W.prototype; Object.assign(F, { CONNECTING: 0, OPEN: 1, CLOSING: 2, CLOSED: 3 }); window.WebSocket = F; })()")
    ctx.route(re.compile(r'^(?!http://localhost).*'), lambda r: r.abort())
    ctx.route('https://tiles.openfreemap.org/styles/**', lambda r: _json(r, STYLE))
    ctx.route('https://nominatim.openstreetmap.org/**', _nominatim)
    ctx.route('https://photon.komoot.io/**', lambda r: _json(r, {'features': []}))
    ctx.route('https://overpass-api.de/**', _overpass)
    ctx.route('https://routing.openstreetmap.de/**', _osrm)
    ctx.route('http://localhost:3000/**', _serve)
    ctx.route('http://localhost:8000/**', backend or (lambda r: r.abort()))
    page = ctx.new_page()
    errors = []
    page.on('pageerror', lambda e: errors.append(str(e)))
    page.goto('http://localhost:3000/index.html', wait_until='commit', timeout=60000)
    page.wait_for_function(wait_for, timeout=30000)
    page.wait_for_timeout(2500)
    return b, page, errors
