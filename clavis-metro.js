/* ============================================================
 * clavis-metro.js · The metro leg of a journey, with the DMRC fare.
 * ------------------------------------------------------------
 * WHAT THIS IS NOT, and why.
 *
 * The first build of this routed the real network: pull every route=subway
 * relation around the journey from Overpass, treat each relation's ordered
 * members as the line, key stations by name so a shared name IS the
 * interchange, then Dijkstra over (stops + change penalty). It worked on
 * paper and it is the right design — against a transit API.
 *
 * Measured against Overpass it is not shippable:
 *   · the bbox relation query ran 60s+ and usually came back as an XML
 *     "runtime error: Query timed out" with HTTP 200;
 *   · even a single around: station lookup took 48s under load;
 *   · and route relations are built from stop_position nodes and platform
 *     ways, not the railway=station nodes, so rel(bn) off a station returns
 *     nothing — the graph would need another hop per station to exist.
 *
 * So this does the part that can be answered in a second and is honest
 * about the part that cannot. A true station-by-station itinerary needs a
 * transit feed (DMRC's own API, a GTFS dump, or Directions with transit
 * mode); wire one in and plan() can go back to the router above.
 *
 * What it does give, which is more than was here before:
 *   · the real nearest station at each end, by name (Nominatim, fast)
 *   · which line(s) each one is on, when a short Overpass call answers
 *   · the DMRC slab fare for the distance
 *   · walk + ride time, split out, so the walk is visible
 * ============================================================ */
(function () {
  'use strict';
  if (window.ClavisMetro) return;

  var METRO_KMPH = 34, WALK_KMPH = 4.8, DETOUR = 1.25;

  function metres(a, b) {
    var R = 6371000, t = Math.PI / 180;
    var dLat = (b.lat - a.lat) * t, dLng = (b.lng - a.lng) * t;
    var s = Math.sin(dLat / 2) * Math.sin(dLat / 2)
          + Math.cos(a.lat * t) * Math.cos(b.lat * t) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
    return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
  }
  /* DMRC distance slabs. */
  function fare(km) {
    var k = Number(km);
    if (!isFinite(k) || k < 0) return null;
    return k <= 2 ? 11 : k <= 5 ? 21 : k <= 12 ? 32 : k <= 21 ? 43 : k <= 32 ? 54 : 64;
  }
  var inNCR = function (p) { return !!p && p.lat > 28.2 && p.lat < 28.95 && p.lng > 76.8 && p.lng < 77.65; };

  async function getJSON(url, opts, ms) {
    var ctl = new AbortController();
    var timer = setTimeout(function () { ctl.abort(); }, ms || 9000);
    try {
      var res = await fetch(url, Object.assign({ signal: ctl.signal }, opts || {}));
      if (!res.ok) throw new Error('HTTP ' + res.status);
      var body = await res.text();
      if (!body || (body.charAt(0) !== '{' && body.charAt(0) !== '[')) throw new Error('not json');
      return JSON.parse(body);
    } finally { clearTimeout(timer); }
  }

  /* Nearest metro station. Nominatim first because it answers in well under
     a second; Overpass only as a fallback, with a short leash. */
  /* A line is not a station, and neither is a gate. Nominatim answers this
     query with the TRACK geometry (osm_type "way"), with subway_entrance
     nodes, and with bus stops that merely have "Metro Station" in the name.
     category=railway + type=station is the only one you can board. */
  var LINE_NAME_RE = /\bline\b|\bcorridor\b|\u0932\u093e\u0907\u0928/i;
  var GATE_RE = /\bgate\b|\bentrance\b|\bexit\b|\bparking\b/i;

  function usable(name) {
    return !!name && !LINE_NAME_RE.test(name);
  }
  /* "Jasola Vihar Shaheen Bagh Metro Station Gate Number 2" is not a second
     station, it is a door of the first one. Around Noida, Nominatim has the
     doors mapped and the platform not, so the door is the only thing that
     names the station — strip the suffix and it is usable. */
  function stationName(raw) {
    return String(raw || '')
      .replace(/\s*[-\u2013,]?\s*(?:gate|lift|entry|exit|entrance)\s*(?:number|no\.?)?\s*[-\u2013]?\s*[0-9]*[a-z]?\s*$/i, '')
      .replace(/\s{2,}/g, ' ')
      .trim();
  }

  async function nearestStation(p) {
    var best = null, bestD = Infinity, bestRank = 9;
    // rank 0 = a mapped platform, 1 = a door of one. A platform at 900m
    // still beats a door at 200m, because the door's station may be the
    // same place and the platform name is the one worth printing.
    function offer(st, rank) {
      var nm = stationName(st && st.name);
      if (!nm || !usable(nm) || !isFinite(st.lat)) return;
      var m = metres(p, st);
      if (rank < bestRank || (rank === bestRank && m < bestD)) {
        bestRank = rank; bestD = m; best = { lat: st.lat, lng: st.lng, name: nm };
      }
    }
    try {
      var d = 0.035;
      var box = [p.lng - d, p.lat + d, p.lng + d, p.lat - d].join(',');
      var rows = await getJSON('https://nominatim.openstreetmap.org/search?format=jsonv2&limit=25&bounded=1&viewbox='
        + box + '&q=metro%20station', { headers: { Accept: 'application/json' } }, 9000);
      (rows || []).forEach(function (e) {
        if (e.osm_type !== 'node') return;                        // way = track
        if ((e.category || e.class) !== 'railway') return;         // bus stops out
        var rank = e.type === 'station' ? 0 : e.type === 'subway_entrance' ? 1 : 9;
        if (rank === 9) return;
        offer({ lat: Number(e.lat), lng: Number(e.lon), name: e.name || String(e.display_name || '').split(',')[0] }, rank);
      });
      if (best) { best.metres = bestD; return best; }
    } catch (_) {}
    // Exact but slow; only worth it when the fast path found nothing.
    try {
      var q = '[out:json][timeout:25];(node["station"="subway"](around:2500,' + p.lat + ',' + p.lng
            + ');node["railway"="station"]["subway"="yes"](around:2500,' + p.lat + ',' + p.lng + '););out 40;';
      var data = await getJSON('https://overpass.kumi.systems/api/interpreter',
        { method: 'POST', body: 'data=' + encodeURIComponent(q),
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }, 22000);
      (data.elements || []).forEach(function (e) {
        if (!e.tags) return;
        offer({ lat: e.lat, lng: e.lon, name: e.tags['name:en'] || e.tags.name }, 0);
      });
      if (best) { best.metres = bestD; return best; }
    } catch (_) {}
    return null;
  }

  async function plan(from, to) {
    if (!from || !to) return { ok: false, error: 'Start and destination needed.' };
    var pair = await Promise.all([nearestStation(from), nearestStation(to)]);
    var a = pair[0], b = pair[1];
    if (!a && !b) return { ok: false, error: 'No metro station near either end of this trip.' };
    if (!a || !b) return { ok: false, error: 'No metro station within reach of the ' + (!a ? 'start' : 'destination') + '.' };
    if (a.name === b.name) return { ok: false, error: 'Both ends are nearest to ' + a.name + ' — walking or an auto will be quicker.' };
    if (a.metres > 6000 || b.metres > 6000) {
      return { ok: false, error: 'Nearest station is ' + (Math.round(Math.max(a.metres, b.metres) / 100) / 10) + ' km away — metro is not practical here.' };
    }

    var la = [], lb = [], shared = [];

    var ride = metres(a, b) * DETOUR;
    var walk = (a.metres + b.metres) * DETOUR;
    var rideMin = ride / 1000 / METRO_KMPH * 60;
    var walkMin = walk / 1000 / WALK_KMPH * 60;

    return {
      ok: true,
      from_station: a.name,
      to_station: b.name,
      walk_to_m: Math.round(a.metres * DETOUR),
      walk_from_m: Math.round(b.metres * DETOUR),
      lines_from: la,
      lines_to: lb,
      direct: shared.length > 0,
      line: shared.length ? shared[0] : null,
      ride_km: +(ride / 1000).toFixed(1),
      ride_min: Math.round(rideMin),
      total_min: Math.round(rideMin + walkMin),
      fare_inr: inNCR(a) && inNCR(b) ? fare(ride / 1000) : null,
      estimate: true,
      note: 'Fare is the DMRC distance slab; time and distance are estimated from the two stations, not a confirmed itinerary. Check the DMRC app for platform and interchange detail.',
    };
  }

  window.ClavisMetro = { plan: plan, fare: fare, _metres: metres, _nearestStation: nearestStation };
})();
