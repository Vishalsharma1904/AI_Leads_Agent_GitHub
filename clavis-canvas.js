/* ============================================================
 * clavis-canvas.js · Clavis's display — the one window that shows
 * things (maps, pictures, websites) while the voice does the talking.
 * ------------------------------------------------------------
 * Conversation never opens this. It opens only when there is
 * something to SEE:
 *
 *   showMap({ place })            globe -> slow fly-in -> pulsing pin
 *   mapControl({ style, zoom… })  satellite / map / dark / 3D, zoom, rotate
 *   showNearby({ category })      JARVIS-style area scan (radius sweep,
 *                                 every hospital / police station / … around)
 *   showImages({ query })         grid; click -> expands like Claude's images
 *   showWebsite({ url, summary }) screenshot left, overview right
 *
 * Click the map card (or say "expand") and it grows to the whole
 * screen with the same slow ease; there you can drag, zoom, tilt.
 *
 * Everything here is keyless:
 *   map tiles   OpenFreeMap (OpenStreetMap data)   styles liberty / dark
 *   satellite   Esri World Imagery (attribution shown; swap the URL in
 *               SKYLARK_CONFIG.MAP_SATELLITE_TILES for a commercial key)
 *   geocoding   Nominatim, then Photon
 *   nearby      Overpass API (OpenStreetMap)
 *   images      Clavis backend (/api/v1/web/images), else Wikimedia
 *               Commons + Openverse straight from the browser
 *   websites    Clavis backend /api/v1/web/read (+ screenshot), else a
 *               WordPress mShots screenshot
 * MapLibre GL 5.24 is vendored in vendor/maplibre and only loaded the
 * first time a map is shown.
 * ============================================================ */
(function () {
  'use strict';
  if (window.ClavisCanvas) return;

  const ML_JS = 'vendor/maplibre/maplibre-gl.js?v=5.24.0';
  const ML_CSS = 'vendor/maplibre/maplibre-gl.css?v=5.24.0';
  const STYLE_URL = {
    map: 'https://tiles.openfreemap.org/styles/liberty',
    dark: 'https://tiles.openfreemap.org/styles/dark',
  };
  const SAT_TILES = () => window.SKYLARK_CONFIG?.MAP_SATELLITE_TILES
    || 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';
  const SAT_ATTR = 'Imagery © Esri, Maxar, Earthstar Geographics';
  const BACKEND = () => (window.SKYLARK_CONFIG?.BACKEND_URL || 'http://localhost:8000').replace(/\/$/, '');
  const EASE = 'cubic-bezier(0.16, 1, 0.3, 1)';
  const EASE_IN_OUT = 'cubic-bezier(0.65, 0, 0.35, 1)';
  const OPEN_MS = 720, CLOSE_MS = 520, SWAP_MS = 420, EXPAND_MS = 760;

  const V = {
    el: null, head: null, body: null, foot: null, kicker: null, title: null, seg: null, backdrop: null,
    kind: '', open: false, expanded: false, anim: null, token: 0,
    map: null, mapWrap: null, mapStyle: 'map', place: null, pin: null, styleCache: {},
    nearby: null, scanRaf: 0, orbitRaf: 0,
    images: [], lightbox: null,
  };

  /* ── tiny helpers ───────────────────────────────────────────── */
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const reduced = () => { try { return matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (_) { return false; } };
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  function withTimeout(promise, ms, label) {
    let t;
    return Promise.race([promise, new Promise((_, rej) => { t = setTimeout(() => rej(new Error(`${label || 'Request'} timed out`)), ms); })])
      .finally(() => clearTimeout(t));
  }
  async function getJSON(url, opts, ms = 12000) {
    const res = await withTimeout(fetch(url, opts), ms, 'Lookup');
    if (!res.ok) throw Object.assign(new Error(`HTTP ${res.status}`), { status: res.status });
    return res.json();
  }
  function metres(a, b) {
    const R = 6371000, toR = Math.PI / 180;
    const dLat = (b[1] - a[1]) * toR, dLng = (b[0] - a[0]) * toR;
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(a[1] * toR) * Math.cos(b[1] * toR) * Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(h));
  }
  const fmtDist = (m) => (m < 950 ? `${Math.round(m / 10) * 10} m` : `${(m / 1000).toFixed(m < 9500 ? 1 : 0)} km`);
  const host = (u) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch (_) { return String(u || ''); } };

  const ICON = {
    expand: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14 4h6v6M10 20H4v-6M20 4l-7 7M4 20l7-7"/></svg>',
    collapse: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 14h6v6M20 10h-6V4M10 14l-7 7M14 10l7-7"/></svg>',
    close: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>',
    open: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14 4h6v6M20 4l-9 9M19 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h5"/></svg>',
    left: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 5l-7 7 7 7"/></svg>',
    right: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 5l7 7-7 7"/></svg>',
  };

  /* ── window ─────────────────────────────────────────────────── */
  function build() {
    if (V.el) return;
    const el = document.createElement('section');
    el.id = 'clavis-canvas';
    el.className = 'ccv';
    el.setAttribute('aria-hidden', 'true');
    el.setAttribute('aria-label', 'Clavis display');
    el.innerHTML =
      '<header class="ccv-head">' +
      '  <div class="ccv-headtext"><span class="ccv-kicker"></span><h2 class="ccv-title"></h2></div>' +
      '  <div class="ccv-tools">' +
      '    <div class="ccv-seg" role="group" aria-label="Map style">' +
      '      <button type="button" data-style="map">Map</button>' +
      '      <button type="button" data-style="satellite">Satellite</button>' +
      '      <button type="button" data-style="3d">3D</button>' +
      '    </div>' +
      `    <button type="button" class="ccv-icon" data-act="expand" aria-label="Expand" title="Expand">${ICON.expand}</button>` +
      `    <button type="button" class="ccv-icon" data-act="close" aria-label="Close" title="Close">${ICON.close}</button>` +
      '  </div>' +
      '</header>' +
      '<div class="ccv-body"></div>' +
      '<footer class="ccv-foot"></footer>';
    document.body.appendChild(el);
    const bd = document.createElement('div');
    bd.className = 'ccv-backdrop';
    document.body.appendChild(bd);
    Object.assign(V, {
      el, backdrop: bd, head: el.querySelector('.ccv-head'), body: el.querySelector('.ccv-body'), foot: el.querySelector('.ccv-foot'),
      kicker: el.querySelector('.ccv-kicker'), title: el.querySelector('.ccv-title'), seg: el.querySelector('.ccv-seg'),
    });
    el.addEventListener('click', (e) => {
      const act = e.target.closest('[data-act]')?.dataset.act;
      if (act === 'close') hide();
      else if (act === 'expand') setExpanded(!V.expanded);
      const st = e.target.closest('[data-style]')?.dataset.style;
      if (st) mapControl({ style: st });
    });
    bd.addEventListener('click', () => setExpanded(false));
    document.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape' || !V.open || V.lightbox) return;
      if (V.expanded) setExpanded(false); else hide();
    });
    addEventListener('resize', () => { try { V.map?.resize(); } catch (_) {} });
  }

  function setHeader(kind, kicker, title) {
    V.el.dataset.kind = kind;
    V.kicker.textContent = kicker;
    V.title.textContent = title || '';
    V.seg.hidden = kind !== 'map';
    V.el.querySelector('[data-act="expand"]').hidden = !(kind === 'map' || kind === 'website' || kind === 'images');
    syncSeg();
  }
  function syncSeg() {
    V.seg.querySelectorAll('[data-style]').forEach((b) => {
      const on = b.dataset.style === V.mapStyle || (b.dataset.style === 'map' && V.mapStyle === 'dark');
      b.classList.toggle('is-on', on);
      b.setAttribute('aria-pressed', String(on));
    });
  }

  /* Replace the content: fresh open unfurls, an open window crossfades. */
  async function present(kind, kicker, title, renderBody) {
    build();
    const token = ++V.token;
    stopScan(); stopOrbit();
    if (!V.open) {
      if (V.map) detachMap();
      setHeader(kind, kicker, title);
      V.body.innerHTML = ''; V.foot.innerHTML = '';
      renderBody();
      V.kind = kind;
      openWindow();
      return token;
    }
    if (V.kind === kind && kind === 'map') {         // same map, new place: no swap, the camera flies
      setHeader(kind, kicker, title);
      return token;
    }
    await fade(V.body, 1, 0, SWAP_MS * 0.45);
    if (token !== V.token) return token;
    if (V.map) detachMap();   // after the fade, so the map never blinks out
    setHeader(kind, kicker, title);
    V.body.innerHTML = ''; V.foot.innerHTML = '';
    renderBody();
    V.kind = kind;
    fade(V.body, 0, 1, SWAP_MS);
    return token;
  }
  function fade(node, from, to, ms) {
    if (!node || reduced() || !node.animate) return Promise.resolve();
    const a = node.animate([{ opacity: from, transform: `translateY(${from > to ? 0 : 6}px)` }, { opacity: to, transform: `translateY(${from > to ? -4 : 0}px)` }],
      { duration: ms, easing: from > to ? EASE_IN_OUT : EASE, fill: 'forwards' });
    return a.finished.then(() => { try { a.cancel(); } catch (_) {} node.style.opacity = to; }).catch(() => {});
  }

  function openWindow() {
    V.open = true;
    V.el.classList.add('is-open');
    V.el.removeAttribute('aria-hidden');
    try { V.anim?.cancel(); } catch (_) {}
    if (reduced() || !V.el.animate) return;
    V.anim = V.el.animate([
      { opacity: 0, transform: 'translateX(28px) scale(0.975)', filter: 'blur(8px)' },
      { opacity: 1, transform: 'none', filter: 'blur(0)' },
    ], { duration: OPEN_MS, easing: EASE });
    V.body.animate([{ opacity: 0, transform: 'translateY(8px)' }, { opacity: 1, transform: 'none' }],
      { duration: 560, delay: 220, easing: EASE, fill: 'backwards' });
  }

  function hide() {
    if (!V.el || !V.open) return;
    V.open = false;
    V.token++;
    stopScan(); stopOrbit();
    const finish = () => {
      if (V.open) return;
      V.el.classList.remove('is-open', 'is-expanded');
      V.el.setAttribute('aria-hidden', 'true');
      V.backdrop.classList.remove('is-on');
      V.expanded = false;
      detachMap();
      V.body.innerHTML = ''; V.foot.innerHTML = '';
      V.kind = '';
    };
    try { V.anim?.cancel(); } catch (_) {}
    if (reduced() || !V.el.animate) return finish();
    V.backdrop.classList.remove('is-on');
    V.anim = V.el.animate([
      { opacity: 1, transform: 'none', filter: 'blur(0)' },
      { opacity: 0, transform: 'translateX(22px) scale(0.98)', filter: 'blur(6px)' },
    ], { duration: CLOSE_MS, easing: EASE_IN_OUT, fill: 'forwards' });
    V.anim.onfinish = () => { finish(); try { V.anim.cancel(); } catch (_) {} };
  }

  /* Card <-> full screen, animated as real geometry so the map re-lays
     itself out every frame instead of stretching a picture of itself. */
  function setExpanded(on) {
    if (!V.open || V.expanded === !!on) return;
    const from = V.el.getBoundingClientRect();
    V.expanded = !!on;
    V.el.classList.toggle('is-expanded', V.expanded);
    V.backdrop.classList.toggle('is-on', V.expanded);
    const btn = V.el.querySelector('[data-act="expand"]');
    if (btn) { btn.innerHTML = V.expanded ? ICON.collapse : ICON.expand; btn.setAttribute('aria-label', V.expanded ? 'Collapse' : 'Expand'); }
    setMapInteractive(V.expanded);
    const to = V.el.getBoundingClientRect();
    if (reduced() || !V.el.animate) { V.map?.resize(); return; }
    try { V.anim?.cancel(); } catch (_) {}
    V.anim = V.el.animate([
      { top: from.top + 'px', left: from.left + 'px', width: from.width + 'px', height: from.height + 'px', right: 'auto', bottom: 'auto' },
      { top: to.top + 'px', left: to.left + 'px', width: to.width + 'px', height: to.height + 'px', right: 'auto', bottom: 'auto' },
    ], { duration: EXPAND_MS, easing: EASE });
    let raf = 0;
    const tick = () => { try { V.map?.resize(); } catch (_) {} raf = requestAnimationFrame(tick); };
    if (V.map) tick();
    const done = () => { cancelAnimationFrame(raf); try { V.map?.resize(); } catch (_) {} };
    V.anim.onfinish = done; V.anim.oncancel = done;
  }

  /* ── maps ───────────────────────────────────────────────────── */
  let mlLoading = null;
  function loadMapLibre() {
    if (window.maplibregl) return Promise.resolve();
    if (mlLoading) return mlLoading;
    mlLoading = new Promise((resolve, reject) => {
      if (!document.querySelector(`link[href="${ML_CSS}"]`)) {
        const l = document.createElement('link');
        l.rel = 'stylesheet'; l.href = ML_CSS;
        document.head.appendChild(l);
      }
      const s = document.createElement('script');
      s.src = ML_JS;
      s.onload = () => (window.maplibregl ? resolve() : reject(new Error('Map engine failed to start')));
      s.onerror = () => { mlLoading = null; reject(new Error('Map engine could not be loaded')); };
      document.head.appendChild(s);
    });
    return mlLoading;
  }

  async function baseStyle(url) {
    if (!V.styleCache[url]) V.styleCache[url] = getJSON(url, {}, 15000);
    try { return JSON.parse(JSON.stringify(await V.styleCache[url])); }
    catch (e) { delete V.styleCache[url]; throw e; }
  }

  async function styleFor(kind) {
    let style;
    if (kind === 'satellite') {
      style = await baseStyle(STYLE_URL.map);
      // Hybrid: imagery underneath, only the labels of the vector map on top.
      style.sources.clavisSat = { type: 'raster', tiles: [SAT_TILES()], tileSize: 256, maxzoom: 19, attribution: SAT_ATTR };
      style.layers = [{ id: 'clavis-sat', type: 'raster', source: 'clavisSat', paint: { 'raster-fade-duration': 250 } }]
        .concat(style.layers.filter((l) => l.type === 'symbol').map((l) => {
          if (!l.layout || !l.layout['text-field']) return l;
          l.paint = Object.assign({}, l.paint, { 'text-color': '#ffffff', 'text-halo-color': 'rgba(0,0,0,0.72)', 'text-halo-width': 1.4 });
          return l;
        }));
    } else {
      style = await baseStyle(kind === 'dark' ? STYLE_URL.dark : STYLE_URL.map);
    }
    style.projection = { type: 'globe' };
    style.sky = {
      'sky-color': '#bcd6f2', 'horizon-color': '#f4efe6', 'fog-color': '#f4efe6',
      'sky-horizon-blend': 0.6, 'horizon-fog-blend': 0.5, 'fog-ground-blend': 0.6,
      'atmosphere-blend': ['interpolate', ['linear'], ['zoom'], 0, 1, 5, 1, 8, 0],
    };
    return style;
  }

  function mountMapShell() {
    V.body.innerHTML =
      '<div class="ccv-map">' +
      '  <div class="ccv-map-gl"></div>' +
      '  <div class="ccv-scan" aria-hidden="true"></div>' +
      '  <button type="button" class="ccv-map-hit" aria-label="Expand map"></button>' +
      '  <div class="ccv-map-chip" hidden></div>' +
      '  <div class="ccv-map-loading"><span></span></div>' +
      '</div>' +
      '<aside class="ccv-side" hidden></aside>';
    V.mapWrap = V.body.querySelector('.ccv-map');
    V.mapWrap.querySelector('.ccv-map-hit').addEventListener('click', () => setExpanded(true));
  }

  async function ensureMap() {
    await loadMapLibre();
    if (V.map && V.mapWrap && V.body.contains(V.mapWrap)) return V.map;
    const container = V.body.querySelector('.ccv-map-gl');
    const style = await styleFor(V.mapStyle === '3d' ? 'map' : V.mapStyle);
    const map = new window.maplibregl.Map({
      container, style,
      center: [78.96, 21.5], zoom: 1.35, pitch: 0, bearing: 0,
      attributionControl: { compact: true }, fadeDuration: 180, maxPitch: 78,
      dragRotate: true, pitchWithRotate: true,
    });
    V.map = map;
    map.addControl(new window.maplibregl.NavigationControl({ visualizePitch: true }), 'bottom-right');
    map.on('style.load', () => { reapplyOverlays(); });
    await new Promise((resolve) => { if (map.loaded()) resolve(); else map.once('load', resolve); setTimeout(resolve, 9000); });
    V.mapWrap?.classList.add('is-ready');
    setMapInteractive(V.expanded);
    return map;
  }

  function setMapInteractive(on) {
    const m = V.map;
    if (!m) return;
    ['dragPan', 'scrollZoom', 'boxZoom', 'dragRotate', 'keyboard', 'doubleClickZoom', 'touchZoomRotate', 'touchPitch'].forEach((h) => {
      try { on ? m[h].enable() : m[h].disable(); } catch (_) {}
    });
    V.mapWrap?.classList.toggle('is-interactive', !!on);
    const side = V.body?.querySelector('.ccv-side');
    if (side) side.hidden = !(on && V.nearby && V.nearby.items.length);
  }

  function detachMap() {
    stopScan(); stopOrbit();
    try { V.pin?.remove(); } catch (_) {}
    try { V.map?.remove(); } catch (_) {}
    V.map = null; V.pin = null; V.mapWrap = null; V.nearby = null;
  }

  async function geocode(query) {
    const q = String(query || '').trim();
    if (!q) throw new Error('No place given.');
    try {
      const r = await getJSON(`https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&addressdetails=0&accept-language=en&q=${encodeURIComponent(q)}`, { headers: { Accept: 'application/json' } }, 9000);
      if (r && r[0]) {
        const b = r[0].boundingbox ? r[0].boundingbox.map(Number) : null;   // [south, north, west, east]
        return {
          name: r[0].name || r[0].display_name.split(',')[0], address: r[0].display_name,
          lat: Number(r[0].lat), lng: Number(r[0].lon), kind: r[0].type || r[0].category || '',
          bbox: b ? [[b[2], b[0]], [b[3], b[1]]] : null,
        };
      }
    } catch (_) { /* fall through to Photon */ }
    const p = await getJSON(`https://photon.komoot.io/api/?limit=1&lang=en&q=${encodeURIComponent(q)}`, {}, 9000);
    const f = p?.features?.[0];
    if (!f) throw new Error(`Couldn't find "${q}" on the map.`);
    const pr = f.properties || {};
    const e = pr.extent;   // [minLon, maxLat, maxLon, minLat]
    return {
      name: pr.name || q, address: [pr.name, pr.city, pr.state, pr.country].filter(Boolean).join(', '),
      lat: f.geometry.coordinates[1], lng: f.geometry.coordinates[0], kind: pr.osm_value || '',
      bbox: e ? [[e[0], e[3]], [e[2], e[1]]] : null,
    };
  }

  function targetCamera(place, zoomHint) {
    let zoom = Number.isFinite(Number(zoomHint)) ? Number(zoomHint) : 15.2;
    if (!Number.isFinite(Number(zoomHint)) && place.bbox && V.map) {
      try {
        const cam = V.map.cameraForBounds(place.bbox, { padding: 40 });
        if (cam && Number.isFinite(cam.zoom)) zoom = clamp(cam.zoom, 3, 16.4);
      } catch (_) {}
    }
    return { center: [place.lng, place.lat], zoom, pitch: zoom > 12 ? 52 : zoom > 8 ? 30 : 0, bearing: zoom > 12 ? -18 : 0 };
  }

  function dropPin(place) {
    try { V.pin?.remove(); } catch (_) {}
    const el = document.createElement('div');
    el.className = 'ccv-pin';
    el.innerHTML = '<i></i><i></i><span></span>';
    V.pin = new window.maplibregl.Marker({ element: el, anchor: 'center' }).setLngLat([place.lng, place.lat]).addTo(V.map);
  }

  function setChip(html) {
    const chip = V.body?.querySelector('.ccv-map-chip');
    if (!chip) return;
    chip.innerHTML = html;
    chip.hidden = !html;
    if (html && chip.animate && !reduced()) chip.animate([{ opacity: 0, transform: 'translateY(6px)' }, { opacity: 1, transform: 'none' }], { duration: 520, easing: EASE });
  }

  async function showMap({ place, query, style, zoom } = {}) {
    const q = String(place || query || '').trim();
    if (!q) return { error: 'No place given.' };
    if (style && ['map', 'satellite', 'dark', '3d'].includes(style)) V.mapStyle = style;
    const wasMap = V.open && V.kind === 'map' && V.map;
    const token = await present('map', 'Map', q, () => { mountMapShell(); });
    let found;
    try {
      [found] = await Promise.all([geocode(q), wasMap ? Promise.resolve() : ensureMap()]);
    } catch (e) {
      if (token === V.token) setChip(`<b>${esc(e.message || 'Map unavailable')}</b>`);
      V.body?.querySelector('.ccv-map-loading')?.remove();
      return { error: e.message || String(e) };
    }
    if (token !== V.token || !V.map) return { error: 'Display was closed.' };
    V.place = found;
    V.title.textContent = found.name;
    clearNearby();
    V.body.querySelector('.ccv-map-loading')?.remove();
    const cam = targetCamera(found, zoom);
    if (V.mapStyle === '3d') { cam.pitch = 62; cam.bearing = -28; cam.zoom = Math.max(cam.zoom, 16); }
    try { V.pin?.remove(); } catch (_) {}
    setChip('');
    let landed = false;
    const land = () => {
      if (landed || token !== V.token || !V.map) return;
      landed = true;
      dropPin(found);
      setChip(`<b>${esc(found.name)}</b><span>${esc(found.address.split(',').slice(1, 4).join(',').trim())}</span><em>${found.lat.toFixed(4)}°, ${found.lng.toFixed(4)}°</em>`);
      pulseScan(0.9);
    };
    // Listen BEFORE flying: a jump (reduced motion, same spot) ends synchronously.
    V.map.once('moveend', land);
    V.map.flyTo({ ...cam, speed: 0.72, curve: 1.5, maxDuration: wasMap ? 5200 : 6800, essential: true });
    setTimeout(land, 7600);
    renderMapFoot();
    return { ok: true, place: found.name, address: found.address, lat: +found.lat.toFixed(5), lng: +found.lng.toFixed(5), type: found.kind, style: V.mapStyle };
  }

  function renderMapFoot() {
    if (!V.place) return;
    const g = `https://www.google.com/maps/search/?api=1&query=${V.place.lat},${V.place.lng}`;
    V.foot.innerHTML =
      `<span class="ccv-meta">${esc(V.nearby ? `${V.nearby.items.length} ${V.nearby.label} within ${fmtDist(V.nearby.radius)}` : 'Click the map to explore it full-screen')}</span>` +
      `<a class="ccv-link" href="${esc(g)}" target="_blank" rel="noopener">Google Maps ${ICON.open}</a>`;
  }

  async function mapControl({ style, zoom, zoom_change, pitch, bearing, action } = {}) {
    if (!V.open || V.kind !== 'map' || !V.map) return { error: 'No map is open. Show a place first.' };
    const m = V.map;
    const out = { ok: true };
    if (style) {
      const s = String(style).toLowerCase();
      const want = /sat|imag|hybrid/.test(s) ? 'satellite' : /dark|night/.test(s) ? 'dark' : /3d|tilt|build/.test(s) ? '3d' : /flat|2d|normal|street|map|default/.test(s) ? 'map' : null;
      if (!want) return { error: `Unknown style "${style}". Use map, satellite, dark or 3d.` };
      const prevBase = V.mapStyle === '3d' ? 'map' : V.mapStyle;
      V.mapStyle = want;
      const base = want === '3d' ? 'map' : want;
      if (base !== prevBase) {
        try { m.setStyle(await styleFor(base), { diff: false }); } catch (e) { return { error: 'Map style could not load.' }; }
      }
      if (want === '3d') m.easeTo({ pitch: 62, bearing: m.getBearing() || -28, zoom: Math.max(m.getZoom(), 15.8), duration: 2400, easing: easeInOut });
      else if (s.match(/flat|2d/)) m.easeTo({ pitch: 0, bearing: 0, duration: 1800, easing: easeInOut });
      syncSeg();
      out.style = want;
    }
    const cur = { zoom: m.getZoom(), pitch: m.getPitch(), bearing: m.getBearing() };
    const next = {};
    if (Number.isFinite(Number(zoom))) next.zoom = clamp(Number(zoom), 1, 19);
    if (Number.isFinite(Number(zoom_change))) next.zoom = clamp(cur.zoom + Number(zoom_change), 1, 19);
    if (Number.isFinite(Number(pitch))) next.pitch = clamp(Number(pitch), 0, 75);
    if (Number.isFinite(Number(bearing))) next.bearing = Number(bearing);
    const a = String(action || '').toLowerCase();
    if (a === 'zoom_in') next.zoom = clamp(cur.zoom + 1.5, 1, 19);
    if (a === 'zoom_out') next.zoom = clamp(cur.zoom - 1.5, 1, 19);
    if (a === 'reset' || a === 'recenter') { if (V.place) Object.assign(next, targetCamera(V.place)); }
    if (a === 'world' || a === 'globe') Object.assign(next, { zoom: 1.4, pitch: 0, bearing: 0 });
    if (Object.keys(next).length) m.easeTo({ ...next, duration: 2200, easing: easeInOut });
    if (a === 'rotate' || a === 'orbit') startOrbit();
    if (a === 'stop') stopOrbit();
    if (a === 'expand') setExpanded(true);
    if (a === 'collapse') setExpanded(false);
    Object.assign(out, { zoom: +(next.zoom ?? cur.zoom).toFixed(1), pitch: Math.round(next.pitch ?? cur.pitch) });
    return out;
  }
  const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

  function startOrbit() {
    stopOrbit();
    const m = V.map;
    if (!m) return;
    let last = performance.now();
    const until = last + 24000;   // a slow showcase turn, not a map redrawing forever
    const step = (now) => {
      if (!V.map || !V.open || now > until) return;
      if (document.hidden) { last = now; V.orbitRaf = requestAnimationFrame(step); return; }
      const dt = now - last; last = now;
      m.setBearing((m.getBearing() + dt * 0.006) % 360);   // ~2°/s: slow, cinematic
      V.orbitRaf = requestAnimationFrame(step);
    };
    V.orbitRaf = requestAnimationFrame(step);
    ['mousedown', 'touchstart', 'wheel'].forEach((ev) => m.getCanvas().addEventListener(ev, stopOrbit, { once: true, passive: true }));
  }
  function stopOrbit() { cancelAnimationFrame(V.orbitRaf); V.orbitRaf = 0; }

  /* CSS ring that sweeps out from the pin — the "scanning" beat. */
  function pulseScan(scale) {
    const s = V.body?.querySelector('.ccv-scan');
    if (!s || reduced() || !s.animate) return;
    s.style.setProperty('--s', String(scale || 1));
    s.animate([{ transform: 'translate(-50%,-50%) scale(0.05)', opacity: 0.85 }, { transform: 'translate(-50%,-50%) scale(1)', opacity: 0 }],
      { duration: 1800, easing: EASE, iterations: 2 });
  }

  /* ── nearby (the area scan) ─────────────────────────────────── */
  const CATS = {
    hospital: [['amenity', 'hospital'], 'hospitals'], clinic: [['amenity', 'clinic'], 'clinics'],
    pharmacy: [['amenity', 'pharmacy'], 'pharmacies'], police: [['amenity', 'police'], 'police stations'],
    fire: [['amenity', 'fire_station'], 'fire stations'], school: [['amenity', 'school'], 'schools'],
    college: [['amenity', 'college|university'], 'colleges'], bank: [['amenity', 'bank'], 'banks'],
    atm: [['amenity', 'atm'], 'ATMs'], restaurant: [['amenity', 'restaurant'], 'restaurants'],
    cafe: [['amenity', 'cafe'], 'cafés'], fuel: [['amenity', 'fuel'], 'fuel stations'],
    parking: [['amenity', 'parking'], 'parking lots'], hotel: [['tourism', 'hotel|guest_house|hostel'], 'hotels'],
    mall: [['shop', 'mall|department_store'], 'malls'], supermarket: [['shop', 'supermarket'], 'supermarkets'],
    office: [['office', ''], 'offices'], company: [['office', 'company|it|coworking'], 'companies'],
    factory: [['man_made', 'works'], 'factories'], warehouse: [['building', 'warehouse'], 'warehouses'],
    metro: [['station', 'subway'], 'metro stations'], railway: [['railway', 'station'], 'railway stations'],
    bus: [['amenity', 'bus_station'], 'bus stations'], park: [['leisure', 'park'], 'parks'],
    gym: [['leisure', 'fitness_centre'], 'gyms'], worship: [['amenity', 'place_of_worship'], 'places of worship'],
    residential: [['landuse', 'residential'], 'residential areas'], security: [['office', 'security'], 'security agencies'],
  };
  const CAT_ALIASES = {
    hospitals: 'hospital', aspatal: 'hospital', medical: 'hospital', doctor: 'clinic', thana: 'police', 'police station': 'police',
    'fire station': 'fire', schools: 'school', university: 'college', banks: 'bank', food: 'restaurant', restaurants: 'restaurant',
    coffee: 'cafe', petrol: 'fuel', 'petrol pump': 'fuel', gas: 'fuel', hotels: 'hotel', malls: 'mall', shopping: 'mall',
    offices: 'office', 'it companies': 'company', companies: 'company', corporate: 'company', factories: 'factory', industry: 'factory',
    warehouses: 'warehouse', logistics: 'warehouse', subway: 'metro', 'metro station': 'metro', train: 'railway', station: 'railway',
    temple: 'worship', mandir: 'worship', mosque: 'worship', church: 'worship', gurudwara: 'worship', society: 'residential', societies: 'residential',
  };

  function circle(center, radius, steps = 72) {
    const [lng, lat] = center;
    const pts = [];
    for (let i = 0; i <= steps; i++) {
      const a = (i / steps) * 2 * Math.PI;
      const dx = (radius * Math.cos(a)) / (111320 * Math.cos((lat * Math.PI) / 180));
      const dy = (radius * Math.sin(a)) / 110540;
      pts.push([lng + dx, lat + dy]);
    }
    return { type: 'Feature', geometry: { type: 'Polygon', coordinates: [pts] }, properties: {} };
  }

  function clearNearby() {
    stopScan();
    V.nearby = null;
    const m = V.map;
    if (m && m.getStyle()) {
      ['ccv-nb-label', 'ccv-nb-dot', 'ccv-nb-halo', 'ccv-scan-line', 'ccv-scan-fill'].forEach((id) => { try { if (m.getLayer(id)) m.removeLayer(id); } catch (_) {} });
      ['ccv-nb', 'ccv-scan'].forEach((id) => { try { if (m.getSource(id)) m.removeSource(id); } catch (_) {} });
    }
    const side = V.body?.querySelector('.ccv-side');
    if (side) { side.innerHTML = ''; side.hidden = true; }
  }

  function addNearbyLayers(radiusNow) {
    const m = V.map, nb = V.nearby;
    if (!m || !nb) return;
    const scanData = { type: 'FeatureCollection', features: [circle(nb.center, radiusNow ?? nb.radius)] };
    if (!m.getSource('ccv-scan')) m.addSource('ccv-scan', { type: 'geojson', data: scanData });
    if (!m.getLayer('ccv-scan-fill')) m.addLayer({ id: 'ccv-scan-fill', type: 'fill', source: 'ccv-scan', paint: { 'fill-color': '#8e9a6a', 'fill-opacity': 0.1 } });
    if (!m.getLayer('ccv-scan-line')) m.addLayer({ id: 'ccv-scan-line', type: 'line', source: 'ccv-scan', paint: { 'line-color': '#4f583b', 'line-width': 1.6, 'line-opacity': 0.8, 'line-dasharray': [2, 2] } });
    const pts = { type: 'FeatureCollection', features: nb.items.map((it, i) => ({ type: 'Feature', geometry: { type: 'Point', coordinates: [it.lng, it.lat] }, properties: { n: i + 1, name: it.name } })) };
    if (!m.getSource('ccv-nb')) m.addSource('ccv-nb', { type: 'geojson', data: pts });
    if (!m.getLayer('ccv-nb-halo')) m.addLayer({ id: 'ccv-nb-halo', type: 'circle', source: 'ccv-nb', paint: { 'circle-radius': 11, 'circle-color': '#4f583b', 'circle-opacity': 0.16 } });
    if (!m.getLayer('ccv-nb-dot')) m.addLayer({ id: 'ccv-nb-dot', type: 'circle', source: 'ccv-nb', paint: { 'circle-radius': 5.5, 'circle-color': '#4f583b', 'circle-stroke-color': '#ffffff', 'circle-stroke-width': 2 } });
    if (!m.getLayer('ccv-nb-label') && m.getStyle()?.glyphs) {
      m.addLayer({ id: 'ccv-nb-label', type: 'symbol', source: 'ccv-nb', minzoom: 13.5,
        layout: { 'text-field': ['get', 'name'], 'text-size': 11.5, 'text-offset': [0, 1.25], 'text-anchor': 'top', 'text-max-width': 9, 'text-font': ['Noto Sans Regular'] },
        paint: { 'text-color': V.mapStyle === 'satellite' ? '#ffffff' : '#2b2a24', 'text-halo-color': V.mapStyle === 'satellite' ? 'rgba(0,0,0,.7)' : 'rgba(255,255,255,.92)', 'text-halo-width': 1.3 } });
    }
  }
  function reapplyOverlays() { try { if (V.nearby) addNearbyLayers(); } catch (_) {} }

  function sweep() {
    const m = V.map, nb = V.nearby;
    if (!m || !nb || reduced()) return;
    const t0 = performance.now(), dur = 1700;
    const frame = (now) => {
      const src = m.getSource('ccv-scan');
      if (!src || !V.nearby) return;
      const k = Math.min(1, (now - t0) / dur);
      src.setData({ type: 'FeatureCollection', features: [circle(nb.center, nb.radius * (1 - Math.pow(1 - k, 3)))] });
      if (k < 1) V.scanRaf = requestAnimationFrame(frame);
    };
    V.scanRaf = requestAnimationFrame(frame);
  }
  function stopScan() { cancelAnimationFrame(V.scanRaf); V.scanRaf = 0; }

  async function showNearby({ category, radius_m, place } = {}) {
    if (place && (!V.place || !new RegExp(String(place).slice(0, 12).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i').test(V.place.name))) {
      const r = await showMap({ place });
      if (r.error) return r;
      await new Promise((res) => { if (!V.map?.isMoving()) res(); else V.map.once('moveend', res); setTimeout(res, 7000); });
    }
    if (!V.open || V.kind !== 'map' || !V.map || !V.place) return { error: 'Show a place on the map first.' };
    const raw = String(category || '').toLowerCase().trim();
    const key = CATS[raw] ? raw : CAT_ALIASES[raw] || Object.keys(CATS).find((k) => raw.includes(k)) || null;
    if (!key) return { error: `Unknown category "${category}". Try: ${Object.keys(CATS).slice(0, 14).join(', ')}.` };
    const [[k, v], label] = CATS[key];
    const radius = clamp(Number(radius_m) || (key === 'residential' || key === 'factory' ? 3000 : 1500), 200, 10000);
    const center = [V.place.lng, V.place.lat];
    const filter = v ? `["${k}"~"^(${v})$"]` : `["${k}"]`;
    const ql = `[out:json][timeout:20];nwr${filter}(around:${radius},${center[1]},${center[0]});out center tags 80;`;
    setChip(`<b>Scanning ${esc(label)}…</b><span>within ${fmtDist(radius)} of ${esc(V.place.name)}</span>`);
    clearNearby();
    V.nearby = { center, radius, label, items: [] };
    addNearbyLayers(1);
    sweep();
    let els = [];
    try {
      const data = await getJSON('https://overpass-api.de/api/interpreter', { method: 'POST', body: 'data=' + encodeURIComponent(ql), headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }, 25000);
      els = data.elements || [];
    } catch (e) {
      setChip(`<b>Area scan unavailable</b><span>${esc(e.message)}</span>`);
      return { error: 'The OpenStreetMap area search did not answer. Try again in a moment.' };
    }
    const items = els.map((e) => {
      const lat = e.lat ?? e.center?.lat, lng = e.lon ?? e.center?.lon;
      const t = e.tags || {};
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
      const name = t.name || t['name:en'] || t.brand || t.operator || '';
      return { name: name || label.replace(/s$/, ''), named: !!name, lat, lng, dist: metres(center, [lng, lat]),
        phone: t.phone || t['contact:phone'] || '', website: t.website || t['contact:website'] || '', addr: [t['addr:housenumber'], t['addr:street'], t['addr:suburb']].filter(Boolean).join(' ') };
    }).filter(Boolean).sort((a, b) => (b.named - a.named) || (a.dist - b.dist)).slice(0, 40).sort((a, b) => a.dist - b.dist);
    if (!V.nearby) return { error: 'Display was closed.' };
    V.nearby.items = items;
    try { V.map.getSource('ccv-nb')?.setData({ type: 'FeatureCollection', features: items.map((it, i) => ({ type: 'Feature', geometry: { type: 'Point', coordinates: [it.lng, it.lat] }, properties: { n: i + 1, name: it.name } })) }); } catch (_) {}
    if (items.length) {
      const b = new window.maplibregl.LngLatBounds(center, center);
      items.forEach((it) => b.extend([it.lng, it.lat]));
      V.map.fitBounds(b, { padding: { top: 70, bottom: 70, left: 50, right: V.expanded ? 360 : 50 }, maxZoom: 16, duration: 2400, pitch: 35 });
    }
    setChip(items.length
      ? `<b>${items.length} ${esc(label)}</b><span>within ${fmtDist(radius)} · nearest ${esc(items[0].name)} (${fmtDist(items[0].dist)})</span>`
      : `<b>No ${esc(label)} found</b><span>within ${fmtDist(radius)} on OpenStreetMap</span>`);
    renderSide();
    renderMapFoot();
    return {
      ok: true, category: label, radius_m: radius, count: items.length,
      nearest: items.slice(0, 8).map((it) => ({ name: it.name, distance: fmtDist(it.dist), phone: it.phone || undefined, address: it.addr || undefined })),
      note: 'OpenStreetMap data — good coverage in cities, can miss some places.',
    };
  }

  function renderSide() {
    const side = V.body?.querySelector('.ccv-side');
    if (!side || !V.nearby) return;
    side.innerHTML = `<h3>${esc(V.nearby.items.length)} ${esc(V.nearby.label)}</h3><ol>` +
      V.nearby.items.map((it, i) => `<li data-i="${i}"><span class="ccv-n">${i + 1}</span><span class="ccv-nm">${esc(it.name)}${it.addr ? `<small>${esc(it.addr)}</small>` : ''}</span><em>${fmtDist(it.dist)}</em></li>`).join('') + '</ol>';
    side.hidden = !(V.expanded && V.nearby.items.length);
    side.querySelectorAll('li').forEach((li) => li.addEventListener('click', () => {
      const it = V.nearby.items[Number(li.dataset.i)];
      if (it) V.map.flyTo({ center: [it.lng, it.lat], zoom: 17, pitch: 55, duration: 2200, essential: true });
    }));
  }

  /* ── images ─────────────────────────────────────────────────── */
  async function searchImages(q, n) {
    try {
      const r = await getJSON(`${BACKEND()}/api/v1/web/images?q=${encodeURIComponent(q)}&n=${n}`, {}, 9000);
      if (Array.isArray(r.items) && r.items.length) return r.items.slice(0, n);
    } catch (_) { /* backend off or old: go direct */ }
    const [commons, openverse] = await Promise.all([
      getJSON(`https://commons.wikimedia.org/w/api.php?action=query&format=json&origin=*&generator=search&gsrnamespace=6&gsrlimit=14&gsrsearch=${encodeURIComponent(q)}&prop=imageinfo&iiprop=url|mime&iiurlwidth=720`, {}, 9000)
        .then((d) => Object.values(d?.query?.pages || {}).sort((a, b) => (a.index || 0) - (b.index || 0)).map((p) => {
          const ii = p.imageinfo?.[0];
          if (!ii || !/image\/(jpeg|png|webp)/.test(ii.mime || '')) return null;
          return { thumb: ii.thumburl || ii.url, full: ii.url, title: String(p.title || '').replace(/^File:/, '').replace(/\.[a-z]+$/i, ''), source: 'Wikimedia Commons', page: ii.descriptionurl };
        }).filter(Boolean)).catch(() => []),
      getJSON(`https://api.openverse.org/v1/images/?page_size=12&q=${encodeURIComponent(q)}`, {}, 9000)
        .then((d) => (d.results || []).map((r) => ({ thumb: r.thumbnail || r.url, full: r.url, title: r.title || q, source: r.source ? `Openverse · ${r.source}` : 'Openverse', page: r.foreign_landing_url }))).catch(() => []),
    ]);
    const seen = new Set();
    return commons.concat(openverse).filter((it) => it.full && !seen.has(it.full) && seen.add(it.full)).slice(0, n);
  }

  async function showImages({ query, count } = {}) {
    const q = String(query || '').trim();
    if (!q) return { error: 'No image query given.' };
    const n = clamp(Number(count) || 9, 3, 12);
    await present('images', 'Images', q, () => {
      V.body.innerHTML = `<div class="ccv-grid is-loading">${'<figure class="ccv-tile is-ghost"></figure>'.repeat(6)}</div>`;
      V.foot.innerHTML = '<span class="ccv-meta">Searching the web…</span>';
    });
    const token = V.token;
    let items = [];
    try { items = await searchImages(q, n); } catch (_) {}
    if (token !== V.token) return { error: 'Display was closed.' };
    V.images = items;
    const grid = V.body.querySelector('.ccv-grid');
    if (!items.length) {
      grid.outerHTML = `<p class="ccv-empty">No pictures found for “${esc(q)}”.</p>`;
      V.foot.innerHTML = '';
      return { ok: false, count: 0, note: 'No images found.' };
    }
    grid.classList.remove('is-loading');
    grid.innerHTML = items.map((it, i) =>
      `<figure class="ccv-tile" data-i="${i}" tabindex="0" role="button" aria-label="${esc(it.title)}"><img alt="${esc(it.title)}" loading="eager" decoding="async" referrerpolicy="no-referrer" src="${esc(it.thumb)}"></figure>`).join('');
    grid.querySelectorAll('.ccv-tile').forEach((fig, i) => {
      const img = fig.querySelector('img');
      img.addEventListener('load', () => {
        fig.classList.add('is-in');
        if (fig.animate && !reduced()) fig.animate([{ opacity: 0, transform: 'scale(0.96)' }, { opacity: 1, transform: 'none' }], { duration: 620, delay: i * 70, easing: EASE, fill: 'backwards' });
      }, { once: true });
      img.addEventListener('error', () => fig.remove(), { once: true });
      const openIt = () => openLightbox(i, fig);
      fig.addEventListener('click', openIt);
      fig.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openIt(); } });
    });
    const sources = [...new Set(items.map((it) => it.source.split(' · ')[0]))].join(', ');
    V.foot.innerHTML = `<span class="ccv-meta">${items.length} pictures · ${esc(sources)}</span><span class="ccv-meta">Click one to view it large</span>`;
    return { ok: true, count: items.length, titles: items.slice(0, 6).map((it) => it.title), sources };
  }

  /* Claude-style expand: the picture itself grows from its tile. */
  function openLightbox(i, fromEl) {
    const items = V.images;
    if (!items[i]) return;
    closeLightbox(true);
    const lb = document.createElement('div');
    lb.className = 'ccv-lb';
    lb.innerHTML =
      '<div class="ccv-lb-bg"></div>' +
      '<img class="ccv-lb-img" alt="" referrerpolicy="no-referrer">' +
      `<button type="button" class="ccv-lb-btn ccv-lb-prev" aria-label="Previous">${ICON.left}</button>` +
      `<button type="button" class="ccv-lb-btn ccv-lb-next" aria-label="Next">${ICON.right}</button>` +
      `<button type="button" class="ccv-lb-btn ccv-lb-x" aria-label="Close">${ICON.close}</button>` +
      '<div class="ccv-lb-cap"></div>';
    document.body.appendChild(lb);
    V.lightbox = { el: lb, i, fromEl };
    const img = lb.querySelector('.ccv-lb-img');
    const set = (k) => {
      const it = items[k];
      V.lightbox.i = k;
      img.src = it.thumb;
      const hi = new Image();
      hi.referrerPolicy = 'no-referrer';
      hi.onload = () => { if (V.lightbox?.i === k) img.src = it.full; };
      hi.src = it.full;
      lb.querySelector('.ccv-lb-cap').innerHTML = `<b>${esc(it.title)}</b>${it.page ? `<a href="${esc(it.page)}" target="_blank" rel="noopener">${esc(it.source)} ${ICON.open}</a>` : `<span>${esc(it.source)}</span>`}`;
    };
    set(i);
    const from = fromEl?.getBoundingClientRect();
    const place = () => {
      const r = img.getBoundingClientRect();
      if (!from || reduced() || !img.animate || !r.width) return;
      img.animate([
        { transform: `translate(${from.left + from.width / 2 - (r.left + r.width / 2)}px, ${from.top + from.height / 2 - (r.top + r.height / 2)}px) scale(${Math.max(from.width / r.width, from.height / r.height)})`, borderRadius: '14px' },
        { transform: 'none', borderRadius: '12px' },
      ], { duration: 640, easing: EASE });
    };
    if (img.complete && img.naturalWidth) place(); else img.addEventListener('load', place, { once: true });
    requestAnimationFrame(() => lb.classList.add('is-on'));
    const go = (d) => {
      const k = (V.lightbox.i + d + items.length) % items.length;
      if (img.animate && !reduced()) img.animate([{ opacity: 0.2, transform: `translateX(${d * 18}px)` }, { opacity: 1, transform: 'none' }], { duration: 420, easing: EASE });
      set(k);
    };
    lb.querySelector('.ccv-lb-prev').onclick = () => go(-1);
    lb.querySelector('.ccv-lb-next').onclick = () => go(1);
    lb.querySelector('.ccv-lb-x').onclick = () => closeLightbox();
    lb.querySelector('.ccv-lb-bg').onclick = () => closeLightbox();
    V.lightbox.key = (e) => {
      if (e.key === 'Escape') closeLightbox();
      else if (e.key === 'ArrowLeft') go(-1);
      else if (e.key === 'ArrowRight') go(1);
    };
    document.addEventListener('keydown', V.lightbox.key);
  }
  function closeLightbox(instant) {
    const L = V.lightbox;
    if (!L) return;
    V.lightbox = null;
    document.removeEventListener('keydown', L.key);
    const img = L.el.querySelector('.ccv-lb-img');
    const target = V.body?.querySelector(`.ccv-tile[data-i="${L.i}"]`) || L.fromEl;
    const to = target?.getBoundingClientRect();
    L.el.classList.remove('is-on');
    if (instant || reduced() || !img.animate || !to) { L.el.remove(); return; }
    const r = img.getBoundingClientRect();
    const a = img.animate([
      { transform: 'none', opacity: 1 },
      { transform: `translate(${to.left + to.width / 2 - (r.left + r.width / 2)}px, ${to.top + to.height / 2 - (r.top + r.height / 2)}px) scale(${Math.max(to.width / r.width, to.height / r.height)})`, opacity: 0.4 },
    ], { duration: 520, easing: EASE_IN_OUT, fill: 'forwards' });
    a.onfinish = () => L.el.remove();
  }

  /* ── websites ───────────────────────────────────────────────── */
  const mshots = (url) => `https://s.wordpress.com/mshots/v1/${encodeURIComponent(url)}?w=1280&h=800`;

  async function showWebsite({ url, summary } = {}) {
    let u = String(url || '').trim();
    if (!u) return { error: 'No website given.' };
    if (!/^https?:\/\//i.test(u)) u = 'https://' + u;
    await present('website', 'Website', host(u), () => {
      V.body.innerHTML =
        '<div class="ccv-site">' +
        '  <figure class="ccv-shot is-ghost"><img alt="" referrerpolicy="no-referrer" hidden></figure>' +
        '  <div class="ccv-over"><div class="ccv-line w60"></div><div class="ccv-line"></div><div class="ccv-line w80"></div><div class="ccv-line w40"></div></div>' +
        '</div>';
      V.foot.innerHTML = '<span class="ccv-meta">Reading the site in the background…</span>';
    });
    const token = V.token;
    let data = null;
    try {
      const res = await withTimeout(fetch(`${BACKEND()}/api/v1/web/read`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url: u, screenshot: true, follow_contact: true }),
      }), 40000, 'Website read');
      if (res.ok) data = await res.json();
    } catch (_) { /* backend off: screenshot service + summary only */ }
    if (token !== V.token) return { error: 'Display was closed.' };
    const shot = V.body.querySelector('.ccv-shot');
    const img = shot.querySelector('img');
    const src = data?.screenshot ? `data:image/jpeg;base64,${data.screenshot}` : mshots(u);
    let tries = 0;
    img.onload = () => {
      // mShots answers with a small "generating…" placeholder first; ask again.
      if (!data?.screenshot && img.naturalWidth < 500 && tries++ < 4) { setTimeout(() => { img.src = `${mshots(u)}&t=${Date.now()}`; }, 3500); return; }
      shot.classList.remove('is-ghost'); img.hidden = false;
      if (img.animate && !reduced()) img.animate([{ opacity: 0, transform: 'scale(1.015)' }, { opacity: 1, transform: 'none' }], { duration: 700, easing: EASE });
    };
    img.onerror = () => { shot.classList.add('is-empty'); };
    img.src = src;
    shot.onclick = () => { if (!img.hidden) { V.images = [{ thumb: img.src, full: img.src, title: data?.title || host(u), source: host(u), page: u }]; openLightbox(0, shot); } };
    const d = data || {};
    const over = V.body.querySelector('.ccv-over');
    const chips = (arr, cls) => (arr || []).map((x) => `<span class="${cls}">${esc(x)}</span>`).join('');
    over.innerHTML =
      `<div class="ccv-site-head"><img class="ccv-fav" alt="" src="https://icons.duckduckgo.com/ip3/${esc(host(d.url || u))}.ico" onerror="this.remove()"><div><h3>${esc(d.title || host(u))}</h3><a href="${esc(d.url || u)}" target="_blank" rel="noopener">${esc(host(d.url || u))} ${ICON.open}</a></div></div>` +
      (summary || d.description ? `<p class="ccv-sum">${esc(summary || d.description)}</p>` : '') +
      (d.headings?.length ? `<div class="ccv-sec"><h4>On the page</h4><ul>${d.headings.slice(0, 5).map((h) => `<li>${esc(h)}</li>`).join('')}</ul></div>` : '') +
      (d.fonts?.length ? `<div class="ccv-sec"><h4>Typography</h4><div class="ccv-chips">${chips(d.fonts.slice(0, 4), 'ccv-font')}</div></div>` : '') +
      (d.colors?.length ? `<div class="ccv-sec"><h4>Colours</h4><div class="ccv-sw">${d.colors.slice(0, 8).map((c) => `<span title="${esc(c)}" style="background:${esc(c)}"></span>`).join('')}</div></div>` : '') +
      ((d.emails?.length || d.phones?.length) ? `<div class="ccv-sec"><h4>Contact</h4><div class="ccv-chips">${chips(d.emails?.slice(0, 3), 'ccv-chip')}${chips(d.phones?.slice(0, 2), 'ccv-chip')}</div></div>` : '') +
      (!data ? '<p class="ccv-note">Live reading needs the Clavis backend running — showing a screenshot only.</p>' : '');
    if (over.animate && !reduced()) over.animate([{ opacity: 0, transform: 'translateY(8px)' }, { opacity: 1, transform: 'none' }], { duration: 620, easing: EASE });
    V.title.textContent = d.title || host(u);
    V.foot.innerHTML = `<span class="ccv-meta">${data ? (data.rendered ? 'Rendered in a background browser' : 'Read in the background') : 'Screenshot via mShots'}</span><a class="ccv-link" href="${esc(d.url || u)}" target="_blank" rel="noopener">Open site ${ICON.open}</a>`;
    if (!data) return { ok: true, url: u, note: 'Backend not reachable: only a screenshot is shown. Describe the site from general knowledge only if you are sure; otherwise say you could not read it.' };
    return {
      ok: true, url: d.url, title: d.title, description: d.description, headings: (d.headings || []).slice(0, 10),
      text: String(d.text || '').slice(0, 2500), emails: d.emails, phones: d.phones, social: (d.social || []).slice(0, 6),
      fonts: d.fonts, colors: d.colors,
    };
  }

  /* ── documents go to the existing task window (rich text + follow-ups) ── */
  function showDocument({ title, markdown } = {}) {
    const T = window.ClavisTask;
    if (!T) return { error: 'Task window not loaded.' };
    const text = String(markdown || '').trim();
    if (!text) return { error: 'Nothing to show.' };
    const id = T.begin(String(title || 'Clavis'), { source: 'voice' });
    const t = T.Store.get(id);
    if (t) { t.display = 'window'; if (title) t.title = String(title); }
    T.complete(id, { type: 'answer', text, summary: text.slice(0, 120) });
    return { ok: true, shown: 'document' };
  }

  /* The typed brain (JarvisEngine) gets the same display as the voice.
     When a visual result is on screen, the text task stays voice-only so
     two windows never compete for the same answer. */
  function registerSkills() {
    const S = window.JarvisSkills;
    if (!S?.register || S.has?.('show_map')) return;
    const visual = (fn) => async (params) => {
      const out = await fn(params || {});
      try {
        const t = window.ClavisTask?.current?.();
        if (t && t.phase !== 'completed' && t.phase !== 'failed') t.display = 'voice';
        window.ClavisTaskSurface?.hide?.();
      } catch (_) {}
      return out;
    };
    S.register('show_map', { builtin: true, description: 'Show a place on the map in the Clavis display (fly-in, pin). Use for any "where is / show on map / location" request.', params: { place: 'place name or address', style: 'optional: map, satellite, dark or 3d' }, run: visual(showMap) });
    S.register('show_nearby', { builtin: true, description: 'On the open map, scan the area and mark every place of one kind (hospital, police, hotel, office, school, bank, mall, metro...).', params: { category: 'what to find, e.g. hospital', place: 'optional place to scan around', radius_m: 'number of metres (default 1500)' }, run: visual(showNearby) });
    S.register('show_images', { builtin: true, description: 'Search the web for pictures and show them in the Clavis display.', params: { query: 'what to find pictures of' }, run: visual(showImages) });
    S.register('show_website', { builtin: true, description: 'Show a website in the Clavis display: screenshot plus overview (what it is, fonts, colours, contacts).', params: { url: 'URL or domain', summary: 'optional one-line description' }, run: visual(showWebsite) });
    S.register('show_map_style', { builtin: true, description: 'Change the open map: style (map/satellite/dark/3d), zoom, or action (zoom_in, zoom_out, rotate, reset, expand).', params: { style: 'optional style', action: 'optional action', zoom: 'number (optional)' }, run: (p) => mapControl(p || {}) });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', registerSkills, { once: true });
  else registerSkills();
  setTimeout(registerSkills, 1500);

  window.ClavisCanvas = {
    showMap, mapControl, showNearby, showImages, showWebsite, showDocument,
    hide, expand: () => setExpanded(true), collapse: () => setExpanded(false),
    isOpen: () => V.open, kind: () => V.kind, place: () => V.place,
    _selfTest() {
      const c = circle([77.2, 28.6], 1000);
      const ring = c.geometry.coordinates[0];
      const ok = [
        ring.length === 73,
        Math.abs(metres([77.2, 28.6], ring[0]) - 1000) < 15,
        fmtDist(420) === '420 m' && fmtDist(1500) === '1.5 km' && fmtDist(12000) === '12 km',
        host('https://www.stripe.com/in') === 'stripe.com',
        (CATS[CAT_ALIASES.thana] || [])[1] === 'police stations',
      ];
      const passed = ok.filter(Boolean).length;
      console[passed === ok.length ? 'log' : 'error'](`ClavisCanvas self-test: ${passed}/${ok.length}`);
      return passed === ok.length;
    },
  };
})();
