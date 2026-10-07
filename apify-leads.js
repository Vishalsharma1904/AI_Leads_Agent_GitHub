/* ============================================================
 * apify-leads.js  ·  Rudra24 AI — Apify lead sourcing (browser-direct)
 * ------------------------------------------------------------
 * Why this exists:
 *   The Scrapling/Crawlee path needs the local FastAPI backend on :8000.
 *   When that backend is asleep every lead run either hangs for minutes
 *   or ends in "no businesses found". Apify runs in Apify's own cloud, so
 *   the browser talks to it directly — no backend, no sign-in, no wait.
 *
 * One actor does the whole job:
 *   compass/crawler-google-places  with  scrapeContacts: true
 *     → Google Maps discovery (name, phone, website, address, category)
 *     → the company's own website read for e-mails + socials
 *   Its output field names are exactly what RealScraper.normalise()
 *   already expects, because that normaliser was written for Apify.
 *
 * Nothing is invented here. Every field is what Apify actually returned.
 * ============================================================ */
'use strict';

window.ApifyLeads = (function () {

  var API = 'https://api.apify.com/v2';
  var ACTOR = 'compass~crawler-google-places';
  var LS_TOKEN = 'clavis_apify_token';
  var LS_CONTACTS = 'clavis_apify_scrape_contacts';

  /* ── token ──────────────────────────────────────────────────
     The server key vault deliberately never hands a secret back to the
     browser, and the browser is where this call has to be made from.
     So the Apify token lives in this browser's own storage, like the
     other device-local settings. It never leaves this machine except
     to api.apify.com. */
  function token() {
    try {
      var t = (localStorage.getItem(LS_TOKEN) || '').trim();
      if (t) return t;
    } catch (e) {}
    try {
      var cfg = window.SKYLARK_CONFIG && window.SKYLARK_CONFIG.APIFY_API_KEYS;
      if (Array.isArray(cfg) && cfg.length) return String(cfg[0] || '').trim();
    } catch (e) {}
    return '';
  }
  function setToken(t) {
    t = String(t || '').trim();
    try { t ? localStorage.setItem(LS_TOKEN, t) : localStorage.removeItem(LS_TOKEN); } catch (e) {}
    try { window.dispatchEvent(new CustomEvent('clavis:apify-changed', { detail: { connected: !!t } })); } catch (e) {}
    return !!t;
  }
  function clearToken() { return setToken(''); }
  function hasToken() { return !!token(); }
  function mask() {
    var t = token();
    return t ? t.slice(0, 10) + '…' + t.slice(-4) : '';
  }

  /* Website contact scraping costs extra Apify credits, so it is a
     switch — on by default, because an e-mail is half the lead. */
  function contactsOn() {
    try { return localStorage.getItem(LS_CONTACTS) !== '0'; } catch (e) { return true; }
  }
  function setContacts(on) {
    try { localStorage.setItem(LS_CONTACTS, on ? '1' : '0'); } catch (e) {}
  }

  /* ── plumbing ───────────────────────────────────────────── */
  function url(path, params) {
    var q = Object.assign({ token: token() }, params || {});
    var qs = Object.keys(q)
      .filter(function (k) { return q[k] !== undefined && q[k] !== null && q[k] !== ''; })
      .map(function (k) { return encodeURIComponent(k) + '=' + encodeURIComponent(q[k]); })
      .join('&');
    return API + path + (qs ? '?' + qs : '');
  }

  function req(path, params, init, timeoutMs) {
    var ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    var timer = setTimeout(function () { try { ctrl && ctrl.abort(); } catch (e) {} }, timeoutMs || 25000);
    var opts = Object.assign({ cache: 'no-store' }, init || {});
    if (ctrl) opts.signal = ctrl.signal;
    return fetch(url(path, params), opts)
      .then(function (res) {
        return res.text().then(function (body) {
          var json = null;
          try { json = JSON.parse(body); } catch (e) {}
          if (!res.ok) {
            var detail = (json && json.error && json.error.message) || body.slice(0, 180) || ('HTTP ' + res.status);
            var err = new Error(detail);
            err.status = res.status;
            throw err;
          }
          return json;
        });
      })
      .finally(function () { clearTimeout(timer); });
  }

  /* ── verify: is this token real, and what plan is behind it ── */
  function verify(candidate) {
    var saved = token();
    var probe = String(candidate || saved || '').trim();
    if (!probe) return Promise.resolve({ ok: false, reason: 'empty' });
    var original = saved;
    try { localStorage.setItem(LS_TOKEN, probe); } catch (e) {}
    return req('/users/me', null, null, 12000)
      .then(function (json) {
        var d = (json && json.data) || {};
        return { ok: true, username: d.username || '', plan: (d.plan && d.plan.id) || '' };
      })
      .catch(function (err) {
        // restore whatever was there before a failed probe
        try { original ? localStorage.setItem(LS_TOKEN, original) : localStorage.removeItem(LS_TOKEN); } catch (e) {}
        return { ok: false, reason: err.status === 401 ? 'unauthorized' : (err.message || 'unreachable') };
      });
  }

  /* ── the actual search ───────────────────────────────────── */
  var RUN_TIMEOUT_S = 300;     // hard cap on Apify's side — a run can never hang
  var POLL_MS = 2500;

  /**
   * @param {object} o
   *   queries      string[]  e.g. ["Hotels in Ghaziabad", "Hospitals in Noida"]
   *   maxPerQuery  number    places per query
   *   countryCode  string    default 'in'
   *   language     string    default 'en'
   *   onLog        (level, text) => void
   *   onPartial    (items[]) => void   called while the run streams results
   *   isAborted    () => boolean
   * @returns Promise<item[]>  raw Apify place objects
   */
  function search(o) {
    o = o || {};
    var queries = (o.queries || []).filter(Boolean);
    var log = o.onLog || function () {};
    var aborted = o.isAborted || function () { return false; };
    if (!hasToken()) return Promise.reject(new Error('NO_APIFY_KEY'));
    if (!queries.length) return Promise.resolve([]);

    var input = {
      searchStringsArray: queries,
      maxCrawledPlacesPerSearch: Math.max(1, Math.min(200, o.maxPerQuery || 20)),
      language: o.language || 'en',
      countryCode: (o.countryCode || 'in').toLowerCase(),
      skipClosedPlaces: true,
      scrapeContacts: contactsOn(),
      // Everything below is noise for a B2B lead and costs time + credits.
      maxReviews: 0,
      maxImages: 0,
      maxQuestions: 0,
      scrapeReviewsPersonalData: false,
      scrapeImageAuthors: false,
      deeperCityScrape: false
    };

    var runId = '', datasetId = '', seen = 0;

    return req('/acts/' + ACTOR + '/runs',
      { timeout: RUN_TIMEOUT_S, memory: 4096 },
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) },
      30000
    ).then(function (json) {
      var d = (json && json.data) || {};
      runId = d.id;
      datasetId = d.defaultDatasetId;
      if (!runId || !datasetId) throw new Error('Apify ne run start nahi kiya');
      log('info', '  ⚡ Apify run ' + runId.slice(0, 8) + ' chalu — ' + queries.length + ' search');
      return poll();
    });

    function poll() {
      var started = Date.now();

      function tick() {
        if (aborted()) return abortRun().then(items).then(function (list) {
          try { o.onPartial && o.onPartial(list); } catch (e) {}
          return list;
        });
        if (Date.now() - started > (RUN_TIMEOUT_S + 40) * 1000) {
          return abortRun().then(function () { throw new Error('Apify run time limit par pahunch gaya'); });
        }
        return req('/actor-runs/' + runId, { fields: 'status,stats,statusMessage' }, null, 15000).then(function (json) {
          var st = (json && json.data && json.data.status) || 'RUNNING';
          try { o.onProgress && o.onProgress({
            text: 'Apify Google Maps · ' + (json?.data?.statusMessage || st.toLowerCase()) + ' · ' + Math.floor((Date.now()-started)/1000) + 's elapsed',
            phase:'discovery', status:st, found:seen
          }); } catch (e) {}
          if (st === 'SUCCEEDED' || st === 'FAILED' || st === 'ABORTED' || st === 'TIMED-OUT') {
            return items().then(function (list) {
              if (!list.length && st !== 'SUCCEEDED') {
                throw new Error('Apify run ' + st.toLowerCase() + ' — koi record nahi aaya');
              }
              return list;
            });
          }
          // still running: stream what has landed so far, so the floating
          // window counts up instead of staring at a spinner
          return items().then(function (list) {
            if (list.length !== seen) {
              seen = list.length;
              try { o.onPartial && o.onPartial(list); } catch (e) {}
            }
            return wait(POLL_MS).then(tick);
          });
        });
      }
      return tick();
    }

    function items() {
      return req('/datasets/' + datasetId + '/items', { clean: 'true', format: 'json', limit: 2000 }, null, 25000)
        .then(function (list) { return Array.isArray(list) ? list : []; })
        .catch(function () { return []; });
    }

    function abortRun() {
      if (!runId) return Promise.resolve();
      return req('/actor-runs/' + runId + '/abort', null, { method: 'POST' }, 8000).catch(function () {});
    }
  }

  function wait(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

  /* ── self-check: ApifyLeads.demo() ────────────────────────
     No network. Proves the bits that silently break: the query string
     builder and the token round-trip. */
  function demo() {
    var before = token();
    console.assert(url('/x', { a: 1 }).indexOf('a=1') > 0, 'params land in the query string');
    console.assert(url('/x', { a: '', b: 'q w' }).indexOf('a=') === -1, 'empty params are dropped');
    console.assert(url('/x', { b: 'q w' }).indexOf('b=q%20w') > 0, 'params are encoded');
    setToken('apify_api_TESTTOKEN0000000000000000');
    console.assert(hasToken() && mask().indexOf('…') > 0, 'token saves and masks');
    setToken(before);
    console.assert(token() === before, 'token restored');
    return 'ok';
  }

  return {
    token: token, setToken: setToken, clearToken: clearToken,
    hasToken: hasToken, mask: mask,
    contactsOn: contactsOn, setContacts: setContacts,
    verify: verify, search: search, actor: ACTOR, demo: demo
  };
})();
