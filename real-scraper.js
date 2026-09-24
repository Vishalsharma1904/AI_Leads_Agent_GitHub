/**
 * ============================================================
 *  REAL SCRAPER ENGINE v1.0
 *  Zero-fabrication B2B lead extraction.
 *
 *  Pipeline:
 *   1. Google Maps discovery (Scrapling, keyless — backend /leads/maps-search)
 *      → company, phone, website, address, rating  [REAL]
 *   2. Website contact scrape (Crawlee+Playwright, keyless — backend /leads/enrich-websites)
 *      → emails, extra phones from the actual site  [REAL]
 *   3. Dedup + score + trim to requested count
 *   4. Auto Excel export
 *
 *  Every field is scraped. Nothing is generated. No API key required —
 *  both steps run on the app's own FastAPI backend (Start-Clavis.bat).
 * ============================================================
 */
'use strict';

const RealScraper = (() => {

  const BACKEND_BASE  = () => window.SKYLARK_CONFIG?.BACKEND_URL || 'http://localhost:8000';
  let aborted = false;

  // ── Callbacks ────────────────────────────────────────────
  let cb = {
    onLog:      () => {},
    onPhase:    () => {},
    onLead:     () => {},
    onComplete: () => {},
    onError:    () => {},
    // Short, human-readable live status for the UI companion (the desk pet).
    onStatus:   () => {}
  };
  // step = 1..7 for a coarse progress read, text = what is literally happening
  function status(text, step, extra) {
    try { cb.onStatus({ text, step: step || 0, ...(extra || {}) }); } catch (_) {}
  }
  function setCallbacks(c) { cb = { ...cb, ...c }; }

  // ── Response cache — reuse REAL scraped data, never fabricate ──────
  // Business contact details change slowly, so an identical search or an
  // already-seen website can be served from a short-lived local cache instead
  // of paying Apify again. Every cached record is genuine data that was really
  // scraped; a TTL keeps it fresh. Cache hits cost ZERO credits and return
  // instantly, so repeat/overlapping runs are far faster and much cheaper —
  // with no change to the data or the success criteria.
  const Cache = (() => {
    const NS = 'skylark_apify_cache_v2';
    const MAX_BYTES = 3_500_000;              // stay well under the ~5 MB localStorage cap
    const MAX_ENTRIES = 500;

    const enabled = () => window.AppSettings?.get?.('cacheEnabled') !== false;   // default ON
    const ttlMs = () => Math.max(1, Number(window.AppSettings?.get?.('cacheDays')) || 21) * 864e5;

    const read = () => { try { return JSON.parse(localStorage.getItem(NS) || '{}'); } catch (_) { return {}; } };
    function write(o) {
      try {
        let s = JSON.stringify(o);
        if (s.length > MAX_BYTES) {                 // evict oldest until within budget
          const ent = Object.entries(o).sort((a, b) => a[1].t - b[1].t);
          while (s.length > MAX_BYTES && ent.length) { delete o[ent.shift()[0]]; s = JSON.stringify(o); }
        }
        localStorage.setItem(NS, s);
      } catch (_) { try { localStorage.removeItem(NS); } catch (_) {} }
    }
    function get(k) {
      if (!enabled()) return null;
      const o = read(), e = o[k];
      if (!e) return null;
      if (Date.now() - e.t > ttlMs()) { delete o[k]; write(o); return null; }
      return e.v;
    }
    function put(k, v) {
      if (!enabled() || v == null) return;
      const o = read();
      o[k] = { t: Date.now(), v };
      const keys = Object.keys(o);
      if (keys.length > MAX_ENTRIES) {
        keys.map(kk => [kk, o[kk].t]).sort((a, b) => a[1] - b[1])
          .slice(0, keys.length - MAX_ENTRIES).forEach(([kk]) => delete o[kk]);
      }
      write(o);
    }
    return { get, put, enabled };
  })();

  // Stable key for a Maps search so an identical query re-uses its real result.
  function mapsCacheKey(input) {
    const q = Array.isArray(input.searchStringsArray) ? [...input.searchStringsArray].sort() : [];
    return `maps|${input.maxCrawledPlacesPerSearch || 0}|${input.countryCode || ''}|${q.join('¦')}`;
  }

  // Normalised cache key for a single scraped page (protocol/www/trailing-slash
  // insensitive) so a redirect variant still matches what we stored.
  const contactCacheKey = (url) =>
    'contact|' + String(url || '')
      .replace(/^https?:\/\//i, '').replace(/^www\./i, '').replace(/\/+$/, '').toLowerCase();

  // ── Backend calls (Scrapling + Crawlee — keyless, no login) ─────
  // Each query is a real browser search, so serve repeat/overlapping rounds
  // (the retry loop below re-asks with the same industries/locations) from
  // the same Cache the old Apify path used — real scraped data, zero re-scrape.
  const mapsQueryCacheKey = (q) => `maps2|${String(q).toLowerCase().trim()}`;

  async function callBackendMapsSearch(queries, maxPerQuery, label) {
    const toFetch = [];
    const reused = [];
    for (const q of queries) {
      const hit = Cache.get(mapsQueryCacheKey(q));
      if (hit && hit.maxPerQuery >= maxPerQuery) reused.push(...hit.items);
      else toFetch.push(q);
    }
    if (reused.length) cb.onLog('info', `  ⚡ ${label}: reused ${reused.length} cached real records (0 new searches)`);
    if (!toFetch.length) return reused;

    let res;
    try {
      res = await fetch(`${BACKEND_BASE()}/api/v1/leads/maps-search`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ queries: toFetch, max_per_query: maxPerQuery })
      });
    } catch (err) {
      throw new Error(`${label}: Clavis backend not reachable at ${BACKEND_BASE()} — is Start-Clavis.bat running?`);
    }
    if (res.status === 503) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.detail || 'Scrapling is not installed on the backend yet.');
    }
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`${label} HTTP ${res.status}: ${body.slice(0, 160)}`);
    }
    const json = await res.json();
    const fresh = Array.isArray(json.items) ? json.items : [];
    for (const q of toFetch) {
      Cache.put(mapsQueryCacheKey(q), { maxPerQuery, items: fresh.filter(it => it.searchString === q) });
    }
    return [...reused, ...fresh];
  }

  async function callBackendEnrichWebsites(records) {
    let res;
    try {
      res = await fetch(`${BACKEND_BASE()}/api/v1/leads/enrich-websites`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ records })
      });
    } catch (err) {
      throw new Error(`Clavis backend not reachable at ${BACKEND_BASE()} — is Start-Clavis.bat running?`);
    }
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`Website enrichment HTTP ${res.status}: ${body.slice(0, 160)}`);
    }
    const json = await res.json();
    return Array.isArray(json.records) ? json.records : [];
  }

  // ── STRICT VALIDATORS (reject anything not verifiably real) ──
  const JUNK_EMAIL_HOSTS = [
    'example.com','example.org','test.com','domain.com','yourdomain.com',
    'sentry.io','wixpress.com','schema.org','googleapis.com','gstatic.com',
    'cloudflare.com','fontawesome.com','githubusercontent.com','w3.org',
    'sentry-next.wixpress.com','placeholder.com','email.com','mail.com'
  ];
  const JUNK_EMAIL_PREFIX = ['test@','fake@','dummy@','sample@','noreply@','no-reply@','donotreply@'];

  function cleanEmail(raw) {
    if (!raw || typeof raw !== 'string') return '';
    const e = raw.trim().toLowerCase().replace(/^mailto:/, '');
    if (!/^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/.test(e)) return '';
    if (/\.(png|jpe?g|svg|gif|webp|ico|css|js)$/i.test(e)) return '';
    if (JUNK_EMAIL_HOSTS.some(h => e.endsWith('@' + h) || e.includes('@' + h))) return '';
    if (JUNK_EMAIL_PREFIX.some(p => e.startsWith(p))) return '';
    // Reject hashed/tracking addresses (long random local part)
    const local = e.split('@')[0];
    if (local.length > 40) return '';
    if (/^[0-9a-f]{16,}$/.test(local)) return '';
    return e;
  }

  // ── Phone classification & formatting (prioritizes Indian mobiles) ──
  function parsePhoneNumber(raw) {
    if (!raw) return null;
    const str = String(raw).trim();
    let d = str.replace(/\D/g, '');

    // Strip international prefixes
    if (d.startsWith('0091')) d = d.slice(4);
    else if (d.startsWith('091')) d = d.slice(3);
    else if (d.startsWith('91') && d.length > 10) d = d.slice(2);

    let hadLeadingZero = false;
    if (d.startsWith('0')) {
      hadLeadingZero = true;
      d = d.slice(1);
    }

    if (d.length < 8 || d.length > 11) return null;
    if (/^(\d)\1+$/.test(d)) return null;
    if (['9876543210', '1234567890', '0123456789', '9999999999'].includes(d)) return null;
    if (/^(0123|1234|2345|3456|4567|5678|6789)/.test(d)) return null;

    // Indian Mobile: 10 digits starting with 6, 7, 8, 9
    if (d.length === 10 && /^[6-9]/.test(d)) {
      return {
        type: 'mobile',
        raw: str,
        digits: d,
        formatted: `+91 ${d.slice(0, 5)} ${d.slice(5)}`
      };
    }

    // Common Indian STD codes: 2-digit, 3-digit
    const std2 = ['11', '22', '33', '44', '80', '40', '20', '79'];
    const std3 = [
      '124', '120', '129', '141', '522', '261', '484', '172', '121', '135',
      '161', '175', '181', '183', '240', '241', '257', '260', '281', '343',
      '361', '413', '422', '431', '452', '471', '512', '532', '542', '562',
      '612', '641', '657', '712', '731', '755', '761', '821', '824', '831',
      '836', '863', '866', '877', '891'
    ];

    for (const code of std2) {
      if (d.startsWith(code) && d.length === 10) {
        const rest = d.slice(2);
        return {
          type: 'landline',
          raw: str,
          digits: d,
          formatted: `+91 0${code} ${rest.slice(0, 4)} ${rest.slice(4)}`
        };
      }
    }

    for (const code of std3) {
      if (d.startsWith(code) && (d.length === 10 || d.length === 11)) {
        const rest = d.slice(3);
        return {
          type: 'landline',
          raw: str,
          digits: d,
          formatted: `+91 0${code} ${rest}`
        };
      }
    }

    // Standard 10-digit number
    if (d.length === 10) {
      const isMobile = /^[6-9]/.test(d);
      return {
        type: isMobile ? 'mobile' : 'landline',
        raw: str,
        digits: d,
        formatted: isMobile ? `+91 ${d.slice(0, 5)} ${d.slice(5)}` : `+91 0${d}`
      };
    }

    // General landline (8 to 11 digits)
    if (d.length >= 8 && d.length <= 11) {
      return {
        type: 'landline',
        raw: str,
        digits: d,
        formatted: `+91 ${hadLeadingZero ? '0' : ''}${d}`
      };
    }

    return null;
  }

  function cleanPhone(raw) {
    const p = parsePhoneNumber(raw);
    return p ? p.formatted : '';
  }

  function assignPhones(lead, candidates) {
    if (!lead) return;
    const list = Array.isArray(candidates) ? candidates : [candidates];
    const parsed = [];
    const seen = new Set();

    function addCandidate(raw) {
      if (!raw) return;
      if (Array.isArray(raw)) {
        raw.forEach(addCandidate);
        return;
      }
      const p = parsePhoneNumber(raw);
      if (p && !seen.has(p.digits)) {
        seen.add(p.digits);
        parsed.push(p);
      }
    }

    if (lead.phone) addCandidate(lead.phone);
    if (lead.phoneAlt) addCandidate(lead.phoneAlt);
    list.forEach(addCandidate);

    const mobiles = parsed.filter(p => p.type === 'mobile');
    const landlines = parsed.filter(p => p.type === 'landline');

    if (mobiles.length > 0) {
      lead.phone = mobiles[0].formatted;
      lead.phoneAlt = landlines[0]?.formatted || mobiles[1]?.formatted || '';
    } else if (landlines.length > 0) {
      lead.phone = landlines[0].formatted;
      lead.phoneAlt = landlines[1]?.formatted || '';
    }
  }

  // Extracts a plausible human name from a PERSONAL LinkedIn profile URL
  // only (never a /company/ page). Returns '' rather than guess when the
  // slug doesn't look like a real name — this must never invent a name.
  function personNameFromLinkedIn(url) {
    if (!url || !/linkedin\.com\/in\//i.test(url)) return '';
    const m = String(url).match(/linkedin\.com\/in\/([a-z0-9-]+)/i);
    if (!m) return '';
    let slug = m[1].replace(/-[a-z0-9]{4,}$/i, ''); // strip trailing random id suffix, e.g. -53a212b8
    const words = slug.split('-').filter(Boolean);
    if (words.length < 2 || words.length > 4) return '';
    if (words.some(w => /\d/.test(w) || w.length < 2)) return '';
    return words.map(w => w[0].toUpperCase() + w.slice(1)).join(' ');
  }

  function cleanWebsite(raw) {
    if (!raw || typeof raw !== 'string') return '';
    let w = raw.trim();
    if (!/^https?:\/\//i.test(w)) w = 'https://' + w;
    try {
      const u = new URL(w);
      // Reject aggregators / non-company domains
      const bad = ['google.com','facebook.com','instagram.com','justdial.com',
                   'indiamart.com','tripadvisor.','yelp.','sulekha.com','linkedin.com'];
      if (bad.some(b => u.hostname.includes(b))) return '';
      return u.origin;
    } catch { return ''; }
  }

  // Categorise an email by its local part
  function bucketEmail(lead, email) {
    const lp = email.split('@')[0];
    const set = (field) => { if (!lead[field]) lead[field] = email; };
    if (/^(hr|careers?|jobs|recruit|hiring|talent)/.test(lp))        set('hrEmail');
    else if (/^(purchase|procure|sourcing|buying)/.test(lp))          set('purchaseEmail');
    else if (/^(vendor|supplier|partner)/.test(lp))                   set('vendorEmail');
    else if (/^(facility|facilities|maintenance|admin|estate)/.test(lp)) set('facilityEmail');
    else if (/^(security)/.test(lp))                                  set('securityEmail');
    else if (/^(housekeep|cleaning|janitor)/.test(lp))                set('housekeepingEmail');
    else if (/^(support|help|care|service)/.test(lp))                 set('supportEmail');
    else if (/^(info|contact|enquir|inquir|reach|hello|mail|office|reception)/.test(lp)) set('officialEmail');
    else set('officialEmail');
  }

  // ══════════════════════════════════════════════════════════
  //  PHASE 1 — GOOGLE MAPS DISCOVERY (real businesses)
  // ══════════════════════════════════════════════════════════
  async function discoverFromMaps({ industries, locations, targetCount }) {
    cb.onPhase(1, 'active', 0);
    cb.onLog('phase', '▶ PHASE 1 — Google Maps Business Discovery');

    // If no specific industry requested or 'ALL', auto-expand to commercial sectors
    // "ALL" = the businesses that buy what HE sells (ClavisBusiness profile).
    const profileBuyers = (() => { try { return window.ClavisBusiness?.buyerQueries?.() || null; } catch (_) { return null; } })();
    const activeIndustries = (!industries.length || industries.some(i => String(i).toUpperCase() === 'ALL'))
      ? (profileBuyers && profileBuyers.length ? profileBuyers : [
          'Corporate Offices',
          'IT Companies',
          'Hotels',
          'Hospitals',
          'Manufacturing Companies',
          'Shopping Malls',
          'Warehouses & Logistics'
        ])
      : industries;

    // Build search queries: industry × city
    let queries = [];
    for (const city of locations) {
      for (const ind of activeIndustries) {
        queries.push(`${ind} in ${city}`);
      }
    }
    if (!queries.length) throw new Error('No search queries built');

    // Cap it — each query is a real live browser search (Scrapling), not an
    // instant API call, so a broad "ALL industries × every NCR city" request
    // can otherwise explode to 40+ searches. Sample evenly across the full
    // list so every city/industry still gets a shot.
    const MAX_QUERIES = 8;
    if (queries.length > MAX_QUERIES) {
      const before = queries.length;
      const step = queries.length / MAX_QUERIES;
      queries = Array.from({ length: MAX_QUERIES }, (_, i) => queries[Math.floor(i * step)]);
      cb.onLog('info', `⚡ Narrowed ${before} possible searches to the ${MAX_QUERIES} most useful — broad requests stay fast. Ask for a specific city/industry for a deeper sweep.`);
    }

    // Over-fetch so we still hit target after dedup/filtering
    const perQuery = Math.max(3, Math.ceil((targetCount * 2.2) / queries.length));

    status(`Searching Google Maps · ${queries.length} ${queries.length === 1 ? 'query' : 'queries'}`, 1);
    cb.onLog('info', `🔍 ${queries.length} search queries · ~${perQuery} places each · target ${targetCount} leads`);
    queries.slice(0, 6).forEach(q => cb.onLog('info', `   • ${q}`));
    if (queries.length > 6) cb.onLog('info', `   • …and ${queries.length - 6} more`);

    // Split into parallel chunks — big speed win
    const CHUNK = 5;
    const chunks = [];
    for (let i = 0; i < queries.length; i += CHUNK) chunks.push(queries.slice(i, i + CHUNK));

    const all = [];
    let done = 0;

    // Run chunks in parallel (max 3 concurrent to respect rate limits)
    const CONCURRENCY = 3;
    for (let i = 0; i < chunks.length; i += CONCURRENCY) {
      if (aborted) throw new Error('ABORTED');
      const group = chunks.slice(i, i + CONCURRENCY);

      const settled = await Promise.allSettled(group.map(async (chunkQueries, gi) => {
        const label = `Maps batch ${i + gi + 1}/${chunks.length}`;
        cb.onLog('info', `⚡ ${label} running…`);
        const items = await callBackendMapsSearch(chunkQueries, perQuery, label);
        return items;
      }));

      settled.forEach((r, gi) => {
        done++;
        if (r.status === 'fulfilled') {
          all.push(...r.value);
          status(`Found ${all.length} businesses so far…`, 1, { found: all.length });
          cb.onLog('success', `  ✓ Maps batch ${i + gi + 1}: ${r.value.length} places found`);
        } else {
          cb.onLog('error', `  ✕ Maps batch ${i + gi + 1} failed: ${r.reason?.message || r.reason}`);
        }
        cb.onPhase(1, 'active', Math.round((done / chunks.length) * 100));
      });
    }

    cb.onPhase(1, 'done', 100);
    cb.onLog('success', `✓ Phase 1 complete — ${all.length} raw business records from Google Maps`);
    return all;
  }

  // ══════════════════════════════════════════════════════════
  //  PHASE 2 — NORMALISE + DEDUP (real fields only)
  // ══════════════════════════════════════════════════════════
  function normalise(raw, industries, locations, serviceTypes) {
    const company = String(raw.title || raw.name || '').split(/[|–]/)[0].trim();
    if (!company || company.length < 2) return null;
    const selectedServices = Array.from(new Set(
      (Array.isArray(serviceTypes) && serviceTypes.length
        ? serviceTypes
        : ['Security', 'Housekeeping', 'Pantry Boy'])
        .map(value => String(value || '').trim())
        .filter(Boolean)
    ));

    // Derive city and industry from Maps or query
    let city = locations[0] || '';
    let industry = industries[0] || '';
    const ss = raw.searchString || raw.searchQuery || '';
    if (ss.includes(' in ')) {
      const [indPart, cityPart] = ss.split(' in ');
      if (indPart)  industry = indPart.trim();
      if (cityPart) city     = cityPart.trim();
    }
    // Prefer real category or city from Google Maps
    if (raw.categoryName) industry = raw.categoryName;
    if (raw.city) city = raw.city;

    // Website
    const website = cleanWebsite(
      raw.website || raw.webUrl || raw.domain || raw.site ||
      raw.contactDetails?.website || ''
    );

    const lead = {
      id: `rl_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
      company,
      industry: industry || 'Commercial Business',
      sector: industry || 'Commercial Business',
      category: industry || 'Commercial Business',
      city,
      state: raw.state || '',
      country: raw.countryCode === 'IN' ? 'India' : (raw.countryCode || 'India'),
      address: raw.address || raw.street || '',
      postalCode: raw.postalCode || '',

      phone: '',
      phoneAlt: '',
      email: '',
      officialEmail: '', hrEmail: '', purchaseEmail: '', vendorEmail: '',
      facilityEmail: '', securityEmail: '', housekeepingEmail: '', supportEmail: '',

      website,
      linkedinUrl: '',
      facebookUrl: '',
      instagramUrl: '',
      contactPerson: '',
      contactPersonSource: '',

      googleRating: raw.totalScore ? parseFloat(raw.totalScore) : null,
      reviewCount:  raw.reviewsCount ? parseInt(raw.reviewsCount) : null,
      googleMapsUrl: raw.url || '',
      placeId: raw.placeId || '',

      serviceTypes: selectedServices.slice(),
      servicesToOffer: selectedServices.slice(),
      type: selectedServices.join(' + '),
      requirement: selectedServices.join(' + '),

      source: 'Google Maps (verified public listing)',
      sourceUrl: raw.url || website || '',
      status: 'New',
      timestamp: Date.now(),
      lastUpdated: new Date().toLocaleDateString('en-IN'),
      enrichedByMaps: true,
      enrichedByCrawler: false,
      dataQuality: 'verified'
    };

    // Assign phone candidates, prioritizing mobiles and capturing STD landlines
    assignPhones(lead, [
      raw.phone, raw.phoneUnformatted, raw.phoneNumber,
      raw.internationalPhoneNumber,
      ...(Array.isArray(raw.phones) ? raw.phones : []),
      raw.contactDetails?.phone,
      ...(Array.isArray(raw.contactDetails?.phones) ? raw.contactDetails.phones : [])
    ]);

    // Emails that Apify's scrapeContacts already pulled from the website
    const mapsEmails = []
      .concat(raw.emails || [])
      .concat(raw.contactDetails?.emails || [])
      .concat(raw.email ? [raw.email] : []);
    mapsEmails.forEach(e => {
      const c = cleanEmail(e);
      if (c) bucketEmail(lead, c);
    });

    // Social profiles (real, from scrapeContacts)
    const li = [].concat(raw.linkedIns || [], raw.contactDetails?.linkedIns || [])[0];
    const fb = [].concat(raw.facebooks || [], raw.contactDetails?.facebooks || [])[0];
    const ig = [].concat(raw.instagrams || [], raw.contactDetails?.instagrams || [])[0];
    if (li) {
      lead.linkedinUrl = li;
      const name = personNameFromLinkedIn(li);
      if (name) { lead.contactPerson = name; lead.contactPersonSource = 'LinkedIn'; }
    }
    if (fb) lead.facebookUrl  = fb;
    if (ig) lead.instagramUrl = ig;

    lead.email = lead.officialEmail || lead.hrEmail || lead.purchaseEmail
              || lead.facilityEmail || lead.supportEmail || '';

    return lead;
  }

  function normaliseLocText(s) {
    return String(s || '').toLowerCase().replace(/[^a-z]/g, '');
  }

  // A lead only counts as "in the requested location(s)" when its city or
  // address text actually names one of the cities the user asked for. This
  // is the safety net that stops a business from a totally different city
  // (e.g. a Bhuj hotel showing up in a Noida run) from slipping through,
  // even if the upstream city field from Google Maps was wrong or blank.
  function matchesRequestedLocation(lead, locations) {
    if (!Array.isArray(locations) || !locations.length) return true;
    const hay = normaliseLocText(`${lead.city || ''} ${lead.address || ''}`);
    if (!hay) return false;
    return locations.some(loc => {
      const needle = normaliseLocText(loc);
      return needle && hay.indexOf(needle) !== -1;
    });
  }

  function dedupe(leads) {
    const seen = new Set();
    const out  = [];
    for (const l of leads) {
      // Key on normalised company + city, plus phone/domain as secondary keys
      const k1 = `${l.company.toLowerCase().replace(/[^a-z0-9]/g, '')}|${(l.city || '').toLowerCase()}`;
      const k2 = l.phone   ? `p:${l.phone.replace(/\D/g, '')}` : null;
      const k3 = l.website ? `w:${l.website.toLowerCase()}`    : null;
      if (seen.has(k1) || (k2 && seen.has(k2)) || (k3 && seen.has(k3))) continue;
      seen.add(k1);
      if (k2) seen.add(k2);
      if (k3) seen.add(k3);
      out.push(l);
    }
    return out;
  }

  // ══════════════════════════════════════════════════════════
  //  PHASE 3 — WEBSITE CONTACT SCRAPE (for leads missing email)
  //  Visits the company's real website + contact/about pages
  // ══════════════════════════════════════════════════════════
  async function enrichFromWebsites(leads) {
    cb.onPhase(3, 'active', 0);
    cb.onLog('phase', '▶ PHASE 3 — Website Contact Extraction');

    const needsContact = leads.filter(l => !l.email && l.website);
    if (!needsContact.length) {
      cb.onPhase(3, 'done', 100);
      cb.onLog('success', '✓ All discovered leads already have verified contact details');
      return leads;
    }

    status(`Scraping ${needsContact.length} company websites for emails`, 3, { sites: needsContact.length });
    cb.onLog('info', `🌐 ${needsContact.length} companies need email — scraping their websites…`);

    const byId = new Map(needsContact.map(l => [l.id, l]));
    const ids = [...byId.keys()];
    const BATCH = 25; // one real page load per site on the backend — keep batches modest
    let emailsFound = 0;

    for (let i = 0; i < ids.length; i += BATCH) {
      if (aborted) break;
      const batchIds = ids.slice(i, i + BATCH);
      const records = batchIds.map(id => ({ id, website: byId.get(id).website }));
      try {
        const enriched = await callBackendEnrichWebsites(records);
        enriched.forEach(rec => {
          const lead = byId.get(rec.id);
          if (!lead) return;
          if (rec.email) {
            const c = cleanEmail(rec.email);
            if (c) { bucketEmail(lead, c); emailsFound++; }
          }
          if (rec.phone) assignPhones(lead, [rec.phone]);
          lead.enrichedByCrawler = Boolean(rec.crawler_enriched);
        });
      } catch (err) {
        cb.onLog('warn', `  ⚠ Website batch ${Math.floor(i / BATCH) + 1}: ${err.message || 'failed'}`);
      }
      cb.onPhase(3, 'active', Math.round(((i + batchIds.length) / ids.length) * 100));
      status(`Reading websites · ${emailsFound} emails found`, 3, { emails: emailsFound });
    }

    leads.forEach(l => {
      l.email = l.officialEmail || l.hrEmail || l.purchaseEmail
             || l.facilityEmail || l.supportEmail || l.vendorEmail || l.email || '';
    });

    cb.onPhase(3, 'done', 100);
    cb.onLog('success', `✓ Phase 3 complete — ${emailsFound} verified emails extracted from company websites`);
    return leads;
  }

  // ══════════════════════════════════════════════════════════
  //  PHASE 4 — SCORE, RANK, TRIM
  // ══════════════════════════════════════════════════════════
  function requiredFields() {
    const r = window.AppSettings?.requiredFields?.();
    return r || { website: false, email: false, phone: false };
  }

  function isQualifiedLead(lead) {
    if (!lead) return false;
    // A lead is contactable if it has a verified phone OR email
    const hasPhone = !!cleanPhone(lead.phone);
    const hasEmail = !!cleanEmail(lead.email);
    return hasPhone || hasEmail;
  }

  // We ARE the security / housekeeping / manpower provider, so a business
  // that is itself one of those is a competitor — never a customer. The user
  // wants service CONSUMERS only, so these are dropped before ranking.
  const PROVIDER_RE = /\b(security\s+(agency|agencies|service|services|solutions|guard|guards|guarding)|guarding|man\s*power|manpower|housekeeping\s+service|housekeeping\s+services|facility\s+management|facilities\s+management|integrated\s+facilit|staffing|placement\s+(agency|agencies|service|services)|recruit(?:ment)?\s+(agency|agencies|service|services|consultan)|cleaning\s+service|cleaning\s+services|janitorial|pest\s+control|detective|surveillance\s+service|bouncer)/i;
  function isProviderCompetitor(lead) {
    const hay = [
      lead && lead.company, lead && lead.industry,
      lead && lead.category, lead && lead.address
    ].map(v => String(v || '')).join(' ').toLowerCase();
    // Competitors follow what he sells (IT firms for an IT seller, etc.).
    let re = PROVIDER_RE;
    try { re = window.ClavisBusiness?.competitorRegex?.() || PROVIDER_RE; } catch (_) {}
    return re.test(hay);
  }

  function scoreAndTrim(leads, targetCount) {
    cb.onPhase(4, 'active', 30);
    status('Verifying contact details · ranking leads', 4);
    cb.onLog('phase', '▶ PHASE 4 — Contact Verification & Ranking');

    let droppedCompetitors = 0;
    const qualified = leads.filter(lead => {
      // Drop competitors (other security/housekeeping/manpower vendors).
      if (isProviderCompetitor(lead)) { droppedCompetitors++; return false; }
      lead.website = cleanWebsite(lead.website);
      lead.email = cleanEmail(lead.email);
      lead.phone = cleanPhone(lead.phone);
      if (lead.phoneAlt) lead.phoneAlt = cleanPhone(lead.phoneAlt);
      if (!isQualifiedLead(lead)) return false;

      let score = 55;
      // Bonus for mobile phone (best for calling/WhatsApp)
      if (lead.phone && /^\+91 [6-9]/.test(lead.phone)) score += 18;
      else if (lead.phone) score += 12;

      // Bonus for email
      if (lead.email) score += 15;
      if (lead.hrEmail || lead.purchaseEmail || lead.facilityEmail) score += 8;

      // Bonus for website & web presence
      if (lead.website) score += 10;
      if (lead.linkedinUrl) score += 5;

      // Bonus for rating and address
      if (lead.address) score += 5;
      if (lead.googleRating >= 4) score += 4;
      if (lead.reviewCount > 20) score += 3;

      lead.leadScore = Math.min(100, score);
      lead.contactable = true;
      lead.completeContact = !!(lead.website && lead.email && lead.phone);
      return true;
    });

    if (droppedCompetitors) {
      cb.onLog('info', `🚫 Skipped ${droppedCompetitors} ${(window.ClavisBusiness?.label?.() || 'security/housekeeping').toLowerCase()} providers (competitors, not customers)`);
    }
    // Sort by lead score descending
    qualified.sort((a, b) => (b.leadScore || 0) - (a.leadScore || 0));
    const selected = qualified.slice(0, targetCount);
    cb.onLog('info', `📊 ${qualified.length} contactable leads verified (top ${selected.length} selected)`);
    cb.onPhase(4, 'done', 100);
    cb.onLog('success', `✓ ${selected.length} verified leads ready`);
    return selected;
  }

  // ══════════════════════════════════════════════════════════
  //  EXCEL EXPORT (auto-download on completion)
  // ══════════════════════════════════════════════════════════
  function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(url); }, 1500);
  }

  function exportCSV(rows, filename) {
    const headers = Object.keys(rows[0]);
    const esc = (v) => {
      const s = String(v ?? '');
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const csv = [
      headers.join(','),
      ...rows.map(r => headers.map(h => esc(r[h])).join(','))
    ].join('\r\n');
    downloadBlob(new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' }), filename);
  }

  function exportExcel(leads, filenameHint) {
    if (!leads || !leads.length) {
      cb.onLog('warn', '⚠ Nothing to export — 0 leads');
      return false;
    }
    const rows = leads.map((l, i) => {
      let primaryMobile = '';
      let secondaryLandline = '';
      if (l.phone && /^\+91 [6-9]/.test(l.phone)) {
        primaryMobile = l.phone;
        secondaryLandline = l.phoneAlt || '';
      } else if (l.phoneAlt && /^\+91 [6-9]/.test(l.phoneAlt)) {
        primaryMobile = l.phoneAlt;
        secondaryLandline = l.phone || '';
      } else {
        // No genuine mobile number was found for this lead — never put a
        // landline in the column labelled "(Mobile)". Leave Primary blank
        // and keep the landline (the only number available) in Secondary.
        primaryMobile = '';
        secondaryLandline = l.phone || l.phoneAlt || '';
      }
      const altEmails = [l.hrEmail, l.purchaseEmail, l.facilityEmail, l.supportEmail, l.vendorEmail]
        .filter(e => e && e !== l.email);

      return {
        '#': i + 1,
        'Company Name': l.company || '',
        'Industry': l.industry || '',
        'City': l.city || '',
        'Full Address': l.address || '',
        'Primary Phone (Mobile)': primaryMobile,
        'Secondary Phone (Landline)': secondaryLandline,
        'Primary Email': l.email || '',
        'Alternate Emails': altEmails.join(', ') || '',
        'Website': l.website || '',
        'LinkedIn': l.linkedinUrl || '',
        'Contact Person (for Calling)': l.contactPerson || '',
        'Contact Person Source': l.contactPersonSource || '',
        'Google Rating': l.googleRating ?? '',
        'Review Count': l.reviewCount ?? '',
        'Google Maps Link': l.googleMapsUrl || '',
        'Selected Service Lines': Array.isArray(l.serviceTypes) && l.serviceTypes.length
          ? l.serviceTypes.join(' + ')
          : (l.type || l.requirement || ''),
        'Lead Score': l.leadScore ?? '',
        'Contactable': (primaryMobile || secondaryLandline || l.email) ? 'YES' : 'NO',
        'Source': l.source || '',
        'Scraped On': new Date(l.timestamp || Date.now()).toLocaleString('en-IN')
      };
    });

    const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
    const brand = (window.UserProfileManager?.getProfile?.().company || 'Leads')
      .replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 28) || 'Leads';
    const base  = `${brand}-Leads-${filenameHint || 'export'}-${stamp}`;

    // Preferred path: real .xlsx via SheetJS
    if (typeof XLSX !== 'undefined' && XLSX.utils) {
      try {
        const ws = XLSX.utils.json_to_sheet(rows);
        ws['!cols'] = Object.keys(rows[0]).map(k => ({
          wch: Math.min(46, Math.max(k.length + 2, ...rows.map(r => String(r[k] ?? '').length + 2)))
        }));
        ws['!autofilter'] = { ref: ws['!ref'] };
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, 'Verified Leads');

        const wbout = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
        downloadBlob(
          new Blob([wbout], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }),
          `${base}.xlsx`
        );
        cb.onLog('success', `📥 Excel downloaded: ${base}.xlsx (${rows.length} rows)`);
        if (typeof window.showToast === 'function') {
          window.showToast('success', 'Excel Downloaded', `${rows.length} leads exported`);
        }
        return true;
      } catch (err) {
        cb.onLog('warn', `⚠ XLSX write failed (${err.message}) — falling back to CSV`);
      }
    } else {
      cb.onLog('warn', '⚠ XLSX library not loaded (offline / CDN blocked) — exporting CSV instead');
    }

    // Fallback: CSV
    try {
      exportCSV(rows, `${base}.csv`);
      cb.onLog('success', `📥 CSV downloaded: ${base}.csv (${rows.length} rows)`);
      if (typeof window.showToast === 'function') {
        window.showToast('success', 'CSV Downloaded', `${rows.length} leads exported`);
      }
      return true;
    } catch (err) {
      cb.onLog('error', `✕ Export failed entirely: ${err.message}`);
      return false;
    }
  }

  // ══════════════════════════════════════════════════════════
  //  MAIN ORCHESTRATOR
  // ══════════════════════════════════════════════════════════
  let running = false;

  async function run(opts) {
    const {
      industries   = [],
      locations    = [],
      serviceTypes = ['All relevant requirements'],
      targetCount  = 20,
      autoExcel    = true,
      saveToDb     = true
    } = opts || {};

    if (running) { cb.onError("Still working on your last search — give it a few more seconds and I'll show what I found (or ask again to retry)."); return null; }

    // If backend is active and user is signed in, use NexusLeadJobs
    if (window.NexusLeadJobs && window.SupabaseAuth?.getAccessToken?.()) {
      running = true;
      aborted = false;
      try {
        const startedAt = Date.now();
        const rawLeads = await window.NexusLeadJobs.run({
          industries, locations, types: serviceTypes, countPerCombo: targetCount
        }, { onLog: cb.onLog, onProgressDetails: d => cb.onStatus({ text: d.label || `Lead job ${d.status || 'running'}`, step: 3, ...d }) });
        if (aborted) throw new Error('ABORTED');
        const leads = rawLeads.map(item => ({
          id: item.id || `lead_${crypto.randomUUID()}`,
          company: item.title || item.name || '',
          city: item.city || locations[0] || '',
          address: item.address || '',
          phone: cleanPhone(item.phone || item.phoneNumber || ''),
          phoneAlt: cleanPhone(item.phone_alt || item.phoneAlt || ''),
          email: cleanEmail(item.email || item.contactEmail || ''),
          website: cleanWebsite(item.website || item.url || ''),
          sourceUrl: item.placeUrl || item.url || '',
          source: item.source || item.provider || 'Lead provider',
          industry: item.industry || industries[0] || 'Commercial Business',
          serviceType: item.serviceType || serviceTypes[0] || '',
          serviceTypes: Array.isArray(item.serviceTypes) ? item.serviceTypes : serviceTypes,
          sourceTimestamp: item.created_at || Date.now(),
          status: 'New',
          timestamp: Date.now()
        })).filter(item => item.company && (item.phone || item.email));
        const completeContacts = leads.filter(item => item.website && item.email && item.phone).length;
        let added = 0;
        for (const lead of leads) {
          const saved = saveToDb && window.MemoryEngine?.addLead ? await window.MemoryEngine.addLead(lead) : { success: true };
          if (saved?.success) { added++; cb.onLead(lead); }
        }
        if (autoExcel && leads.length) {
          exportExcel(leads, `${locations[0] || 'leads'}-${leads.length}`);
        }
        cb.onComplete({ source: 'backend', added, dupes: leads.length - added, total: leads.length,
          requested: targetCount, complete: leads.length > 0,
          completeContacts, elapsed: ((Date.now() - startedAt) / 1000).toFixed(1), leads });
        return leads;
      } catch (err) {
        cb.onLog('warn', `Backend lead job returned: ${err.message}. Falling back to the direct Scrapling pipeline...`);
      } finally { running = false; }
    }

    if (!industries.length || !locations.length) {
      cb.onError('Pick at least one industry and one city');
      return null;
    }

    running = true;
    aborted = false;
    const t0 = Date.now();

    try {
      status(`Starting hunt for ${targetCount} leads`, 0, { target: targetCount });
      cb.onLog('info', '═══════════════════════════════════════════════');
      cb.onLog('info', `  REAL LEAD EXTRACTION — target: ${targetCount} leads`);
      cb.onLog('info', `  ${new Date().toLocaleString('en-IN')}`);
      cb.onLog('info', '═══════════════════════════════════════════════');

      let leads = [];
      let finalLeads = [];
      const skipDupes = window.AppSettings?.get?.('skipDupes') !== false;
      const existing = skipDupes
        ? (() => { try { return JSON.parse(localStorage.getItem('allLeads') || '[]'); } catch (_) { return []; } })()
        : [];
      const identity = lead => {
        const phone = String(lead.phone || '').replace(/\D/g, '');
        const email = String(lead.email || '').toLowerCase();
        const website = cleanWebsite(lead.website).toLowerCase();
        return [phone && `p:${phone}`, email && `e:${email}`, website && `w:${website}`].filter(Boolean);
      };
      const existingKeys = new Set(existing.flatMap(identity));

      const maxRounds = window.AppSettings?.rounds?.() || 3;
      for (let round = 1; round <= maxRounds && finalLeads.length < targetCount; round++) {
        if (aborted) throw new Error('ABORTED');
        if (round > 1) status(`Searching deeper (round ${round}/${maxRounds})`, 1, { round });
        cb.onLog('info', `🔄 Discovery round ${round}/${maxRounds} — searching for verified contacts`);
        const rawPlaces = await discoverFromMaps({ industries, locations, targetCount: targetCount * round });
        const normalizedAll = rawPlaces.map(record => normalise(record, industries, locations, serviceTypes)).filter(Boolean);
        const normalized = normalizedAll.filter(lead => matchesRequestedLocation(lead, locations));
        const droppedOutside = normalizedAll.length - normalized.length;
        if (droppedOutside > 0) {
          cb.onLog('info', `📍 ${droppedOutside} result(s) discarded — outside the requested location(s)`);
        }
        const before = leads.length + normalized.length;
        status('Removing duplicate companies', 2);
        leads = dedupe([...leads, ...normalized]);
        cb.onPhase(2, 'done', 100);
        cb.onLog('success', `✓ ${leads.length} unique real businesses (${before - leads.length} duplicates removed)`);
        leads = await enrichFromWebsites(leads);
        const available = leads.filter(lead => !identity(lead).some(key => existingKeys.has(key)));
        finalLeads = scoreAndTrim(available, targetCount);
      }

      if (!finalLeads.length) {
        throw new Error('NO_LEADS_FOUND');
      }

      // 5 — Persist
      let added = 0, dupes = 0;
      if (saveToDb && window.MemoryEngine?.addLead) {
        status(`Saving ${finalLeads.length} verified leads`, 5, { saving: finalLeads.length });
        cb.onLog('phase', '▶ SAVING — Writing verified leads to database');
        for (const lead of finalLeads) {
          try {
            const res = await window.MemoryEngine.addLead(lead);
            if (res?.success) { added++; cb.onLead(lead); }
            else dupes++;
          } catch { /* keep going */ }
        }
        try {
          await window.MemoryEngine.incrementMeta('sessions_run');
        } catch {}
      } else {
        added = finalLeads.length;
        finalLeads.forEach(l => cb.onLead(l));
      }

      // Mirror into localStorage so existing UI reads it
      try {
        const existing = JSON.parse(localStorage.getItem('allLeads') || '[]');
        const merged = [...finalLeads, ...existing];
        localStorage.setItem('allLeads', JSON.stringify(merged.slice(0, 5000)));
        window.allLeads = merged;
        window.filteredLeads = [...merged];
      } catch {}

      const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
      const withPhone = finalLeads.filter(l => l.phone).length;
      const withEmail = finalLeads.filter(l => l.email).length;
      const withWebsite = finalLeads.filter(l => l.website).length;

      cb.onLog('success', '═══════════════════════════════════════════════');
      cb.onLog('success', `  ✓ COMPLETE in ${elapsed}s`);
      cb.onLog('success', `  ✓ Leads delivered : ${finalLeads.length}`);
      cb.onLog('success', `  ✓ With phone      : ${withPhone}`);
      cb.onLog('success', `  ✓ With email      : ${withEmail}`);
      cb.onLog('success', `  ✓ Saved to DB     : ${added} (${dupes} already existed)`);
      cb.onLog('success', '═══════════════════════════════════════════════');

      // 6 — Auto Excel
      if (autoExcel && finalLeads.length) {
        status('Building your Excel file…', 6);
        const hint = `${locations[0] || 'multi'}-${finalLeads.length}`;
        exportExcel(finalLeads, hint);
        status('Excel downloaded', 7, { downloaded: true });
      }

      try {
        localStorage.setItem('skylark_run_count',
          String((parseInt(localStorage.getItem('skylark_run_count') || '0', 10) || 0) + 1));
      } catch (_) {}

      cb.onComplete({
        added, dupes, total: finalLeads.length, requested: targetCount,
        complete: true, elapsed, withPhone, withEmail, withWebsite, leads: finalLeads
      });
      return finalLeads;

    } catch (err) {
      if (err.message === 'ABORTED') {
        cb.onLog('warn', '⊘ Scrape stopped by user');
      } else if (err.message === 'NO_LEADS_FOUND') {
        cb.onLog('error', '✕ No contactable leads found matching the criteria in this location.');
        cb.onError('No businesses matched that search on Google Maps. Try a specific city and industry (e.g. "IT companies in Gurugram") instead of a whole region — narrower searches find real results faster.');
      } else if (err.message === 'NO_APIFY_KEY' || err.message === 'ALL_KEYS_EXHAUSTED') {
        cb.onLog('error', '✕ No lead provider completed the request. Apify and the local scraper were unavailable.');
        cb.onError(err.message);
      } else {
        cb.onLog('error', `✕ ${err.message}`);
        cb.onError(err.message);
      }
      return null;
    } finally {
      running = false;
    }
  }

  function abort()       { aborted = true; }
  function isRunning()   { return running; }

  return {
    run, abort, isRunning, setCallbacks, exportExcel,
    cleanEmail, cleanPhone, cleanWebsite, isQualifiedLead,
    parsePhoneNumber, assignPhones
  };
})();

window.RealScraper = RealScraper;
// Compatibility alias so page-agent.js finds a real engine
window.MiningPipeline = {
  run: (o) => RealScraper.run(o),
  abort: () => RealScraper.abort(),
  setCallbacks: (c) => RealScraper.setCallbacks(c),
  getIsRunning: () => RealScraper.isRunning()
};
