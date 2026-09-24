/* ============================================================
 * clavis-aurora.js — the floating surface, upgraded.
 * ------------------------------------------------------------
 * Three things live here, and nothing else:
 *
 *  1. INTENT BODIES. The surface already looks up a renderer per
 *     mode, so "reply according to what was asked" is a registry
 *     entry, not a branch. This file adds the modes the app
 *     actually deals in — leads, contacts, outreach, datasets,
 *     calculations — and wraps the ones already registered so
 *     every body gets a kicker and the panel gets a data-intent.
 *
 *  2. GRAB AND MOVE, properly. The built-in drag sets left/top
 *     and stops. This one carries velocity into a spring settle,
 *     tilts into the direction of travel, snaps flush to an edge
 *     when you let go near one, and answers the arrow keys.
 *
 *  3. SIZE. A resize grip and a collapse toggle, both remembered.
 *
 * Nothing here reaches into the surface's privates. It registers
 * renderers through the public API, and takes over the drag by
 * claiming the pointerdown at document-capture — which always
 * runs before a listener bound to the header itself.
 *
 * Self-check: `ClavisAurora.demo()` in the console.
 * ============================================================ */
(function (global) {
  'use strict';

  var doc = global.document;

  function ready(fn) {
    if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', fn, { once: true });
    else fn();
  }

  /* ── small shared helpers ────────────────────────────────── */
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
  function num(v) { return typeof v === 'number' && isFinite(v) ? v : null; }
  function surfaceEl() { return doc.getElementById('clavis-task-surface'); }

  /* ============================================================
   * 1 · READING THE ASK
   * ------------------------------------------------------------
   * The chips are the panel saying "this is what I understood".
   * Everything below comes out of the user's own words — nothing
   * is inferred, invented, or defaulted. If a term is not in the
   * sentence it does not become a chip.
   * ============================================================ */
  var PLACES = [
    'delhi', 'new delhi', 'ncr', 'gurugram', 'gurgaon', 'noida', 'faridabad', 'ghaziabad',
    'mumbai', 'navi mumbai', 'thane', 'pune', 'nashik', 'nagpur',
    'bangalore', 'bengaluru', 'hyderabad', 'chennai', 'kolkata', 'ahmedabad', 'surat',
    'jaipur', 'lucknow', 'kanpur', 'indore', 'bhopal', 'chandigarh', 'ludhiana', 'amritsar',
    'patna', 'ranchi', 'bhubaneswar', 'kochi', 'coimbatore', 'visakhapatnam', 'vizag',
    'dehradun', 'meerut', 'agra', 'varanasi', 'goa', 'mysore', 'mysuru', 'vadodara', 'rajkot'
  ];
  var SECTORS = [
    'hotel', 'hotels', 'hospital', 'hospitals', 'school', 'schools', 'college', 'colleges',
    'factory', 'factories', 'warehouse', 'warehouses', 'mall', 'malls', 'society', 'societies',
    'builder', 'builders', 'real estate', 'construction', 'manufacturing', 'logistics',
    'retail', 'restaurant', 'restaurants', 'cafe', 'clinic', 'clinics', 'bank', 'banks',
    'showroom', 'showrooms', 'office', 'offices', 'apartment', 'apartments', 'gym', 'gyms',
    'security', 'guard', 'guards', 'staffing', 'housekeeping', 'facility', 'it company',
    'startup', 'startups', 'sme', 'msme', 'enterprise', 'corporate'
  ];
  var QUALIFIERS = [
    ['verified', 'Verified only'], ['verify', 'Verified only'],
    ['email', 'With email'], ['e-mail', 'With email'],
    ['phone', 'With phone'], ['mobile', 'With phone'], ['number', 'With phone'],
    ['whatsapp', 'WhatsApp'],
    ['decision maker', 'Decision makers'], ['owner', 'Owners'], ['director', 'Directors'],
    ['hr', 'HR contacts'], ['procurement', 'Procurement'],
    ['high intent', 'High intent'], ['hot lead', 'High intent'], ['warm', 'Warm'],
    ['new', 'New only'], ['today', 'Today'], ['this week', 'This week'], ['this month', 'This month'],
    ['linkedin', 'LinkedIn'], ['justdial', 'JustDial'], ['indiamart', 'IndiaMART'], ['google map', 'Google Maps']
  ];

  /* Title-case a matched term without mangling acronyms the user
     typed in caps ("NCR" must not become "Ncr"). */
  function pretty(term, raw) {
    var i = raw.toLowerCase().indexOf(term);
    var asTyped = i >= 0 ? raw.slice(i, i + term.length) : term;
    if (asTyped === asTyped.toUpperCase() && asTyped.length <= 5) return asTyped;
    return term.replace(/\b\w/g, function (c) { return c.toUpperCase(); });
  }

  function readAsk(task) {
    var raw = String((task && (task._text || task.title)) || '');
    var t = ' ' + raw.toLowerCase().replace(/\s+/g, ' ') + ' ';
    var out = { count: null, places: [], sectors: [], quals: [] };

    /* "500 leads", "top 50", and the shape this app actually gets:
       "200 verified hotels ke leads" — a number, a few words, then
       the noun. The gapped form needs two digits so "5 star hotels
       ke leads" does not come back as a target of five. A bare
       number with no noun after it is never a target. */
    var NOUN = 'leads?|contacts?|companies|company|numbers?|rows?|records?|e-?mails?|prospects?|clients?';
    var m = t.match(new RegExp('\\b(\\d{1,5})\\s*\\+?\\s*(?:' + NOUN + ')\\b'));
    if (!m) m = t.match(new RegExp('\\b(\\d{2,5})\\s*\\+?\\s*(?:[a-z\\u0900-\\u097F]+\\s+){1,3}(?:' + NOUN + ')\\b'));
    if (!m) m = t.match(/\b(?:top|first|best)\s+(\d{1,4})\b/);
    if (m) out.count = parseInt(m[1], 10);

    PLACES.forEach(function (p) {
      if (t.indexOf(' ' + p + ' ') === -1 && t.indexOf(' ' + p + ',') === -1) return;
      // "new delhi" already covers "delhi"
      out.places = out.places.filter(function (x) { return p.indexOf(x.toLowerCase()) === -1; });
      if (!out.places.some(function (x) { return x.toLowerCase().indexOf(p) !== -1; })) out.places.push(pretty(p, raw));
    });
    SECTORS.forEach(function (s) {
      if (t.indexOf(' ' + s + ' ') === -1 && t.indexOf(' ' + s + ',') === -1) return;
      var singular = s.replace(/(ie)?s$/, function (x) { return x === 'ies' ? 'y' : ''; });
      if (out.sectors.some(function (x) { return x.toLowerCase().indexOf(singular) === 0; })) return;
      out.sectors.push(pretty(s, raw));
    });
    QUALIFIERS.forEach(function (q) {
      if (t.indexOf(q[0]) === -1) return;
      if (out.quals.indexOf(q[1]) === -1) out.quals.push(q[1]);
    });

    out.places = out.places.slice(0, 2);
    out.sectors = out.sectors.slice(0, 2);
    out.quals = out.quals.slice(0, 3);
    return out;
  }

  function chipsHTML(task, leadChip) {
    var ask = readAsk(task);
    var chips = [];
    if (leadChip) chips.push('<span class="cts-chip is-accent">' + esc(leadChip) + '</span>');
    if (ask.count) chips.push('<span class="cts-chip is-accent">' + ask.count + ' target</span>');
    ask.sectors.forEach(function (s) { chips.push('<span class="cts-chip">' + esc(s) + '</span>'); });
    ask.places.forEach(function (p) { chips.push('<span class="cts-chip">' + esc(p) + '</span>'); });
    ask.quals.forEach(function (q) { chips.push('<span class="cts-chip">' + esc(q) + '</span>'); });
    if (!chips.length) return '';
    return '<div class="cts-chips">' + chips.join('') + '</div>';
  }

  /* ============================================================
   * 2 · BODY PIECES
   * ============================================================ */
  function kicker(text) { return '<p class="cts-kicker">' + esc(text) + '</p>'; }

  /* Short enough to sit in a 300px header without wrapping. */
  function shortTitle(task) {
    // The surface's cleaned title ("Neem Karoli Baba — Photos"), not his raw,
    // typo-ridden words; falls back to the raw title if the surface is older.
    var clean = '';
    try { clean = (global.ClavisTaskSurface && global.ClavisTaskSurface.titleFor) ? global.ClavisTaskSurface.titleFor(task) : ''; } catch (e) { clean = ''; }
    var t = String(clean || (task && task.title) || '').trim();
    var cut = t.indexOf(' · ');
    if (cut > -1) t = t.slice(cut + 3).trim();
    t = t.replace(/[…\s]+$/, '');
    if (t.length > 30) t = t.slice(0, 28).replace(/\s+\S*$/, '') + '…';
    return t;
  }

  /* The classifier's title is "Finding leads · <their words>". The
     kicker above already says "Lead intelligence", so the gerund
     is said twice — drop it and let the user's own sentence be the
     headline. If there is no sentence, the gerund is all we have. */
  function titleOf(task, fallback) {
    var t = (task && task.title) || fallback || 'Working';
    if (task && task.confidence < 0.35) t = fallback || 'Clavis';
    var cut = t.indexOf(' · ');
    if (cut > -1) {
      var subject = t.slice(cut + 3).trim();
      if (subject.length > 2) t = subject;
    }
    t = t.replace(/[…\s]+$/, '');
    return '<h2 class="cts-title">' + esc(t) + '</h2>';
  }

  function liveLine(task, fallback) {
    var last = task && task.events && task.events.length ? task.events[task.events.length - 1] : null;
    var text = (last && last.label) || (task && task.subtitle) || fallback || '';
    if (!text) return '';
    return '<p class="cts-live"><span class="cts-live-text">' + esc(text) + '</span></p>';
  }

  function meter(task) {
    if (!task || task.phase === 'completed' || task.phase === 'failed') return '';
    if (typeof task.progress === 'number') {
      return '<div class="cts-meter"><i style="width:' + Math.round(task.progress * 100) + '%"></i></div>';
    }
    return '<div class="cts-meter cts-meter-idle"><i></i></div>';
  }

  function stats(pairs) {
    var rows = pairs.filter(function (p) { return p[1] != null && p[1] !== ''; });
    if (!rows.length) return '';
    return '<dl class="cts-stats">' + rows.map(function (p) {
      return '<div><dt>' + esc(p[0]) + '</dt><dd>' + esc(p[1]) + '</dd></div>';
    }).join('') + '</dl>';
  }

  function figure(value, label) {
    if (value == null) return '';
    return '<div class="cts-figure"><b>' + esc(value) + '</b><span>' + esc(label) + '</span></div>';
  }

  /* Four stages, shown only while something is running. The label
     appears for the live one and for no other — four labels under
     four dots is a dashboard. */
  function steps(task, names) {
    if (!task || task.phase === 'completed' || task.phase === 'failed') return '';
    var live = clamp(stageIndex(task, names.length), 0, names.length - 1);
    return '<div class="cts-steps">' + names.map(function (n, i) {
      var cls = 'cts-step' + (i < live ? ' is-done' : (i === live ? ' is-live' : ''));
      return '<div class="' + cls + '"><i></i><span>' + esc(n) + '</span></div>';
    }).join('') + '</div>';
  }

  /* Stage comes from real evidence: how many tools have reported
     back. Never from a timer — a fake progress bar is worse than
     no progress bar. */
  function stageIndex(task, total) {
    if (typeof task.progress === 'number') return Math.floor(task.progress * (total - 1) + 0.0001);
    var done = (task.events || []).filter(function (e) { return e.type === 'success'; }).length;
    return Math.min(done, total - 1);
  }

  /* Rows only render when the engine handed real ones back. */
  function rowsOf(task) {
    var r = (task && task.result) || {};
    var list = r.rows || r.items || r.leads || r.records || null;
    return Array.isArray(list) ? list : null;
  }

  function rowsHTML(task, limit) {
    var list = rowsOf(task);
    if (!list || !list.length) return '';
    var n = limit || 4;
    var html = list.slice(0, n).map(function (row) {
      if (row == null) return '';
      if (typeof row === 'string') return '<li><b>' + esc(row) + '</b></li>';
      var main = row.name || row.company || row.title || row.label || row.email || '—';
      var side = row.phone || row.city || row.email || row.score || row.status || '';
      return '<li><b>' + esc(main) + '</b>' + (side ? '<i>' + esc(side) + '</i>' : '') + '</li>';
    }).join('');
    var rest = list.length - n;
    return '<ul class="cts-rows">' + html + '</ul>' +
      (rest > 0 ? '<p class="cts-more">+ ' + rest + ' more in the Leads Hub</p>' : '');
  }

  /* The light structure the completed body uses — paragraphs,
     bullets, inline code. Deliberately not a markdown engine. */
  function richText(text) {
    var t = String(text || '').trim();
    if (!t) return '';
    var html = t.split(/\n{2,}/).map(function (block) {
      var lines = block.split(/\n/).map(function (l) { return l.trim(); }).filter(Boolean);
      var bullets = lines.filter(function (l) { return /^([-*•]|\d+[.)])\s+/.test(l); });
      if (bullets.length && bullets.length === lines.length) {
        return '<ul class="cts-list">' + lines.map(function (l) {
          return '<li>' + inline(l.replace(/^([-*•]|\d+[.)])\s+/, '')) + '</li>';
        }).join('') + '</ul>';
      }
      return '<p class="cts-summary">' + inline(lines.join(' ')) + '</p>';
    }).join('');
    return '<div class="cts-result">' + html + '</div>';
  }
  function inline(s) {
    return esc(s)
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  }


  /* ============================================================
   * 2b · WHAT TO DO NEXT
   * ------------------------------------------------------------
   * The panel knows what was asked, what came back and how much
   * of it there is. Re-typing the obvious follow-up in the
   * composer throws all of that away and pays for the whole task
   * again. So the panel offers the next moves as buttons: some
   * open a place in the app (free), some send one precise,
   * already-scoped sentence (cheap, and never a re-ask of what
   * was just answered).
   *
   * Every suggestion is built from evidence — a place only shows
   * up if it was in the ask, an export only if rows came back.
   * Nothing is offered that the task cannot actually do.
   * ============================================================ */
  function openView(name) {
    try {
      if (typeof global.showView === 'function') return global.showView(name);
      if (typeof global.switchView === 'function') return global.switchView(name);
    } catch (e) { console.warn('[ClavisAurora] view', name, e); }
  }

  /* Uses the app's own composer and send button, so the follow-up
     travels the identical path a typed message does — same engine,
     same history, same task surface. */
  function askClavis(text) {
    var input = doc.getElementById('jarvis-input') || doc.getElementById('chat-input');
    if (!input) return;
    input.value = text;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.focus();
    var send = doc.getElementById('jarvis-send-btn') || doc.getElementById('chat-send-btn');
    if (send) send.click();
    else if (typeof global.handleJarvisSend === 'function') global.handleJarvisSend();
  }

  /* ── Smart contextual suggestions ───────────────────────────
     Reads the actual result text to decide which follow-up is
     most useful. Never generic — always rooted in what was said. */
  function smartNext(task) {
    var text = String(((task.result || {}).text) || ((task.result || {}).summary) || task.title || '').toLowerCase();
    var ask = readAsk(task);
    var out = [];

    // If the answer mentions leads / companies / businesses
    if (/lead|company|companies|business|hotel|hospital|school|office|factory|clinic/.test(text)) {
      if (ask.places.length) out.push({ ask: 'In leads ke decision maker ka phone aur email nikalo', label: 'Get their contacts' });
      out.push({ ask: 'In leads ke liye WhatsApp outreach message draft karo', label: 'Draft outreach' });
      out.push({ go: 'leads', label: 'Open Leads Hub' });
      if (ask.sectors.length) out.push({ ask: 'Aur ' + ask.sectors[0] + ' leads nikalo with verified contacts', label: 'More ' + ask.sectors[0] });
      return out;
    }

    // If the answer is a script / email / message / template
    if (/script|email|message|template|draft|pitch|follow.?up/.test(text)) {
      out.push({ ask: 'Isko thoda aur personalized kar do', label: 'Personalise it' });
      out.push({ ask: 'Iska Hindi version bana do', label: 'In Hindi' });
      out.push({ ask: 'Ek shorter version bhi do', label: 'Shorter version' });
      out.push({ go: 'whatsapp', label: 'Send via WhatsApp Auto' });
      return out;
    }

    // If the answer mentions numbers / calculations / totals
    if (/₹|\$|total|revenue|cost|percent|%|amount|budget|crore|lakh|profit|loss/.test(text)) {
      out.push({ ask: 'Iska step-by-step breakdown do', label: 'Show the working' });
      out.push({ ask: 'Ye 12 mahine ke liye calculate karo', label: 'Yearly total' });
      out.push({ ask: 'Isko chart ya table me dikhao', label: 'Show as table' });
      return out;
    }

    // If the answer explains something / gives advice / answers a question
    if (/because|since|means|explains|suggests|recommend|should|could|would|karo|chahiye|kyunki|iska matlab/.test(text)) {
      out.push({ ask: 'Isko aur detail me samjhao with examples', label: 'More detail + examples' });
      out.push({ ask: 'Iska summary 3 bullet points me do', label: '3-point summary' });
      out.push({ ask: 'Iske basis par next steps kya honge?', label: 'What\'s my next step?' });
      return out;
    }

    // Generic but smart fallback — always 3 useful options
    out.push({ ask: 'Aur detail me samjhao with examples', label: 'Explain with examples' });
    out.push({ ask: 'Iska practical action plan do step by step', label: 'Action plan' });
    out.push({ ask: 'Isko simple aur clear language me rewrite karo', label: 'Simplify this' });
    return out;
  }

  var NEXT = {
    leads: function (t, m, a) {
      var out = [];
      if (m.leads || m.sources) out.push({ go: 'leads', label: 'Open Leads Hub' });
      if (m.leads || m.rows) out.push({ ask: 'Ye leads Excel me export kar do', label: 'Export to Excel' });
      if (a.places.length) out.push({ ask: 'Aur leads nikalo ' + a.places[0] + ' se, wahi filters rakhna', label: 'More from ' + a.places[0] });
      out.push({ ask: 'In leads ke decision maker ka phone aur email nikalo', label: 'Get contacts' });
      out.push({ ask: 'In leads ke liye WhatsApp message draft karo', label: 'Draft outreach' });
      return out;
    },
    contacts: function (t, m) {
      var out = [];
      if (m.emails) out.push({ ask: 'In contacts ke liye cold email draft karo', label: 'Draft cold email' });
      if (m.phones) out.push({ ask: 'In numbers ke liye calling script banao', label: 'Calling script' });
      out.push({ go: 'leads', label: 'Open Leads Hub' });
      out.push({ ask: 'In contacts ko Excel me export kar do', label: 'Export to Excel' });
      return out;
    },
    outreach: function () {
      return [
        { ask: 'Isko thoda chhota aur direct kar do', label: 'Make it shorter' },
        { ask: 'Isi message ka Hindi version bana do', label: 'In Hindi' },
        { ask: 'Ek follow-up variant bhi bana do agar reply na aaye', label: 'Add follow-up' },
        { go: 'whatsapp', label: 'Open WhatsApp Auto' }
      ];
    },
    dataset: function (t, m) {
      var out = [{ go: 'excel', label: 'Open Excel Manager' }];
      if (m.rows) out.push({ ask: 'Is data ka summary aur top patterns batao', label: 'Summarise data' });
      out.push({ ask: 'Isme se duplicates hata do', label: 'Remove duplicates' });
      out.push({ go: 'analytics', label: 'See analytics' });
      return out;
    },
    calculate: function () {
      return [
        { ask: 'Iska breakdown step by step dikhao', label: 'Show the working' },
        { ask: 'Ye 12 mahine ka total kitna banega?', label: 'Yearly total' },
        { ask: 'Isko table format me dikhao', label: 'Show as table' }
      ];
    },
    thinking: function (task) {
      return smartNext(task);
    }
  };


  /* A task that stopped to ask something gets choices instead of a
     blank composer — the clarification is the one place where a
     re-ask is guaranteed to be wasted tokens. */
  function nextHTML(task) {
    if (!task) return '';
    var build = NEXT[task.mode];
    if (!build) return '';
    var items;
    try { items = build(task, task.metrics || {}, readAsk(task)) || []; }
    catch (e) { return ''; }
    items = items.slice(0, 4);
    if (!items.length) return '';
    return '<div class="cts-next"><span class="cts-next-label">Next</span>' +
      items.map(function (it) {
        var attr = it.go ? ' data-au-go="' + esc(it.go) + '"' : ' data-au-ask="' + esc(it.ask) + '"';
        return '<button type="button" class="cts-next-btn' + (it.go ? ' is-go' : '') + '"' + attr + '>' +
          esc(it.label) + '</button>';
      }).join('') + '</div>';
  }

  /* One delegated listener for every follow-up ever rendered — the
     body is replaced on each paint, so per-button binding would
     leak a listener per repaint. */
  function wireNext(el) {
    if (el.__auNext) return;
    el.__auNext = true;
    el.addEventListener('click', function (e) {
      var b = e.target.closest && e.target.closest('.cts-next-btn');
      if (!b) return;
      e.preventDefault();
      if (b.dataset.auGo) openView(b.dataset.auGo);
      else if (b.dataset.auAsk) askClavis(b.dataset.auAsk);
    });
  }

  /* ============================================================
   * 3 · THE INTENT BODIES
   * ============================================================ */
  var BODIES = {
    leads: function (task) {
      var m = task.metrics || {};
      var found = num(m.leads) != null ? m.leads : num(m.sources);
      if (task.phase === 'completed') {
        return kicker('Lead intelligence') +
          titleOf(task, 'Leads ready') +
          (found != null ? figure(found, found === 1 ? 'lead' : 'leads') : '') +
          richText((task.result && (task.result.text || task.result.summary)) || '') +
          rowsHTML(task, 4) +
          stats([['Verified', m.verified], ['Sources', m.sources], ['Files', m.files]]) +
          nextHTML(task);
      }
      return kicker('Lead intelligence') +
        titleOf(task, 'Finding leads') +
        chipsHTML(task, 'Leads') +
        liveLine(task, 'Scanning sources') +
        steps(task, ['Plan', 'Find', 'Enrich', 'Score']) +
        stats([['Found', found], ['Verified', m.verified]]) +
        meter(task);
    },

    contacts: function (task) {
      var m = task.metrics || {};
      var got = num(m.contacts) != null ? m.contacts : num(m.sources);
      if (task.phase === 'completed') {
        return kicker('Contact extraction') +
          titleOf(task, 'Contacts extracted') +
          (got != null ? figure(got, got === 1 ? 'contact' : 'contacts') : '') +
          richText((task.result && (task.result.text || task.result.summary)) || '') +
          rowsHTML(task, 4) +
          stats([['Emails', m.emails], ['Phones', m.phones], ['Files', m.files]]) +
          nextHTML(task);
      }
      return kicker('Contact extraction') +
        titleOf(task, 'Pulling contacts') +
        chipsHTML(task, 'Contacts') +
        liveLine(task, 'Reading pages') +
        steps(task, ['Fetch', 'Parse', 'Verify']) +
        stats([['Emails', m.emails], ['Phones', m.phones]]) +
        meter(task);
    },

    outreach: function (task) {
      var m = task.metrics || {};
      if (task.phase === 'completed') {
        return kicker('Outreach') +
          titleOf(task, 'Draft ready') +
          richText((task.result && (task.result.text || task.result.summary)) || '') +
          stats([['Drafts', m.drafts], ['Recipients', m.recipients]]) +
          nextHTML(task);
      }
      return kicker('Outreach') +
        titleOf(task, 'Writing') +
        chipsHTML(task, null) +
        liveLine(task, 'Drafting') +
        steps(task, ['Read', 'Draft', 'Polish']) +
        stats([['Recipients', m.recipients]]) +
        meter(task);
    },

    dataset: function (task) {
      var m = task.metrics || {};
      var rows = num(m.rows) != null ? m.rows : num(m.records);
      if (task.phase === 'completed') {
        return kicker('Data') +
          titleOf(task, 'Data ready') +
          (rows != null ? figure(rows, rows === 1 ? 'row' : 'rows') : '') +
          richText((task.result && (task.result.text || task.result.summary)) || '') +
          rowsHTML(task, 5) +
          stats([['Columns', m.columns], ['Files', m.files], ['Pages', m.pages]]) +
          nextHTML(task);
      }
      return kicker('Data') +
        titleOf(task, 'Working the data') +
        chipsHTML(task, null) +
        liveLine(task, 'Reading rows') +
        steps(task, ['Load', 'Clean', 'Summarise']) +
        stats([['Rows', rows], ['Files', m.files]]) +
        meter(task);
    },

    calculate: function (task) {
      var r = task.result || {};
      if (task.phase === 'completed') {
        /* If the answer is one number, that number IS the body. */
        var one = String(r.text || r.summary || '').trim();
        var bare = one.match(/^[₹$€]?\s*[\d,]+(?:\.\d+)?\s*%?$/);
        return kicker('Calculation') +
          (bare ? figure(one, 'result') : titleOf(task, 'Answer') + richText(one)) +
          nextHTML(task);
      }
      return kicker('Calculation') + titleOf(task, 'Working it out') + liveLine(task, 'Calculating') + meter(task);
    }
  };

  /* ============================================================
   * 4 · WIRING THE BODIES IN
   * ============================================================ */
  var KICKERS = {
    search: 'Search', research: 'Research', code: 'Code', file: 'Document',
    writing: 'Draft', create: 'Create', system: 'Action', thinking: 'Clavis',
    leads: 'Lead intelligence', contacts: 'Contacts', outreach: 'Outreach',
    dataset: 'Data', calculate: 'Calculation'
  };
  var LABELS = {
    leads: 'Leads', contacts: 'Contacts', outreach: 'Outreach',
    dataset: 'Data', calculate: 'Maths'
  };

  /* Every renderer — mine and the ones already there — goes
     through this. It is the only place that touches the panel's
     attributes, so the panel and its body can never disagree
     about which intent is on screen. */
  function decorate(mode, fn) {
    return function (task) {
      var html = '';
      try { html = fn(task) || ''; } catch (e) { console.warn('[ClavisAurora] renderer failed', mode, e); }
      try {
        var el = surfaceEl();
        if (el) {
          el.dataset.intent = task && task.mode ? task.mode : mode;
          var label = el.querySelector('.cts-head-label');
          if (label) {
            if (LABELS[task && task.mode] && task.phase !== 'completed' && task.phase !== 'failed' && !task.requiresApproval) {
              label.textContent = LABELS[task.mode];
            }
            /* Collapsed, the header is all there is — so it carries
               the task's own words. CSS reveals this only in that
               state, which is why it can be set on every paint. */
            label.dataset.taskTitle = shortTitle(task);
          }
        }
      } catch (e) { /* decoration is cosmetic — never let it break a paint */ }
      /* Bodies that already write their own kicker keep it. */
      if (html && html.indexOf('cts-kicker') === -1 && KICKERS[mode]) {
        html = kicker(KICKERS[mode]) + html;
      }
      return html;
    };
  }

  function installBodies() {
    var S = global.ClavisTaskSurface;
    if (!S || !S.register || !S.registry) return false;
    if (S.__auroraBodies) return true;
    S.__auroraBodies = true;

    /* Wrap what is already registered … */
    Object.keys(S.registry).forEach(function (mode) {
      var original = S.registry[mode];
      if (typeof original !== 'function' || original.__aurora) return;
      var wrapped = decorate(mode, original);
      wrapped.__aurora = true;
      S.registry[mode] = wrapped;
    });

    /* … then add the ones this app actually needs. */
    Object.keys(BODIES).forEach(function (mode) {
      var wrapped = decorate(mode, BODIES[mode]);
      wrapped.__aurora = true;
      S.register(mode, wrapped);
    });

    /* The surface routes every completed task to `completed`,
       whatever its mode — which is right for a generic answer and
       wrong for a lead run, where the whole point is the count and
       the records. So `completed` becomes a dispatcher: an intent
       body if there is one, the generic result body otherwise. */
    var generic = S.registry.completed;
    var dispatch = function (task) {
      var body = task && BODIES[task.mode];
      if (body) return decorate(task.mode, body)(task);
      return (generic ? generic(task) : '') + nextHTML(task);
    };
    dispatch.__aurora = true;
    S.register('completed', dispatch);
    return true;
  }

  /* ============================================================
   * 5 · GRAB AND MOVE
   * ------------------------------------------------------------
   * Claimed at document-capture, which runs before the header's
   * own listener, so the built-in drag never starts. Velocity is
   * sampled over the last few moves and carried into a spring
   * settle; near an edge the settle becomes a snap.
   * ============================================================ */
  var POS_KEY = 'clavis-task-pos';
  var SIZE_KEY = 'clavis-task-size';
  var MARGIN = 10;
  var SNAP = 34;          // release this close to an edge → flush
  var THROW = 0.085;      // how much of the release velocity carries
  var MAX_TILT = 2.2;     // degrees, at full speed

  var drag = null;

  function reducedMotion() {
    try { return global.matchMedia('(prefers-reduced-motion: reduce)').matches; }
    catch (e) { return false; }
  }

  function bounds(el) {
    var r = el.getBoundingClientRect();
    return {
      w: r.width, h: r.height,
      maxL: Math.max(MARGIN, global.innerWidth - r.width - MARGIN),
      maxT: Math.max(MARGIN, global.innerHeight - r.height - MARGIN)
    };
  }

  function place(el, left, top, b) {
    b = b || bounds(el);
    el.classList.add('is-moved');
    el.style.left = clamp(left, MARGIN, b.maxL) + 'px';
    el.style.top = clamp(top, MARGIN, b.maxT) + 'px';
    el.style.right = 'auto';
  }

  function savePos(el) {
    try {
      global.localStorage.setItem(POS_KEY, JSON.stringify({
        left: parseFloat(el.style.left), top: parseFloat(el.style.top)
      }));
    } catch (e) { /* private mode: position just won't persist */ }
  }

  function resetPos(el) {
    el.classList.remove('is-moved', 'is-snapped-left', 'is-snapped-right');
    el.style.left = el.style.top = el.style.right = '';
    el.style.transform = '';
    try { global.localStorage.removeItem(POS_KEY); } catch (e) {}
  }

  var dragRaf = 0;

  function onPointerDown(e) {
    var el = surfaceEl();
    if (!el || !el.classList.contains('is-open')) return;
    if (e.button !== 0 || !e.target || !e.target.closest) return;

    var onHead = e.target.closest('.cts-head');
    var anywhere = e.shiftKey && el.contains(e.target);     // shift-drag from anywhere
    if ((!onHead || !el.contains(onHead)) && !anywhere) return;
    if (e.target.closest('button, a, input, select, textarea')) return;

    var r = el.getBoundingClientRect();
    var b = bounds(el);
    drag = {
      el: el,
      bounds: b,
      startX: e.clientX, startY: e.clientY,
      nextClientX: e.clientX, nextClientY: e.clientY,
      baseL: r.left, baseT: r.top,
      lastX: e.clientX, lastT: performance.now(),
      vx: 0,
      moved: false
    };

    el.classList.remove('is-settling', 'is-snapped-left', 'is-snapped-right');
    el.classList.add('is-dragging');
    place(el, r.left, r.top, b);

    doc.addEventListener('pointermove', onPointerMove, true);
    doc.addEventListener('pointerup', onPointerUp, true);
    doc.addEventListener('pointercancel', onPointerUp, true);

    /* Stop here: the surface's own header listener must not also
       start a drag, or the two fight over left/top. */
    e.stopPropagation();
    e.preventDefault();
  }

  function onPointerMove(e) {
    if (!drag) return;
    drag.nextClientX = e.clientX;
    drag.nextClientY = e.clientY;
    if (dragRaf) {
      e.stopPropagation();
      e.preventDefault();
      return;
    }
    dragRaf = requestAnimationFrame(function () {
      dragRaf = 0;
      if (!drag) return;
      var cx = drag.nextClientX;
      var cy = drag.nextClientY;
      var dx = cx - drag.startX;
      var dy = cy - drag.startY;
      if (Math.abs(dx) > 2 || Math.abs(dy) > 2) drag.moved = true;

      // 1:1 direct tracking: solid physical weight, no loose rubber lag
      place(drag.el, drag.baseL + dx, drag.baseT + dy, drag.bounds);

      // Emil Apple Weight: subtle 0.8° inertia tilt conveys mass, not lightness
      if (!reducedMotion()) {
        var now = performance.now();
        var dt = Math.max(1, now - drag.lastT);
        var vx = (cx - drag.lastX) / dt * 16.7;
        drag.lastX = cx; drag.lastT = now;
        var tilt = clamp(vx * 0.035, -0.8, 0.8);
        drag.el.style.transform = 'rotate(' + tilt.toFixed(2) + 'deg)';
      }
    });
    e.stopPropagation();
    e.preventDefault();
  }

  function onPointerUp(e) {
    if (!drag) return;
    if (dragRaf) { cancelAnimationFrame(dragRaf); dragRaf = 0; }
    var el = drag.el;
    var moved = drag.moved;
    var cx = (e && typeof e.clientX === 'number') ? e.clientX : drag.nextClientX;
    var cy = (e && typeof e.clientY === 'number') ? e.clientY : drag.nextClientY;
    var b = drag.bounds;
    var baseL = drag.baseL;
    var baseT = drag.baseT;
    var startX = drag.startX;
    var startY = drag.startY;
    drag = null;

    doc.removeEventListener('pointermove', onPointerMove, true);
    doc.removeEventListener('pointerup', onPointerUp, true);
    doc.removeEventListener('pointercancel', onPointerUp, true);

    el.classList.remove('is-dragging');
    el.style.transform = '';

    if (!moved) return;

    // Exactly where released: "jha roku vhi ruk jaye jase phle hota tha" - zero drift or jumping
    var finalLeft = clamp(baseL + (cx - startX), MARGIN, b.maxL);
    var finalTop = clamp(baseT + (cy - startY), MARGIN, b.maxT);
    place(el, finalLeft, finalTop, b);
    savePos(el);

    if (e) { e.stopPropagation(); }
  }

  function onKeyDown(e) {
    var el = surfaceEl();
    if (!el || !el.classList.contains('is-open')) return;
    var head = el.querySelector('.cts-head');
    if (!head || doc.activeElement !== head) return;

    if (e.key === 'Home') { resetPos(el); e.preventDefault(); return; }
    var step = e.altKey ? 1 : (e.shiftKey ? 48 : 14);
    var d = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key];
    if (!d) return;

    var r = el.getBoundingClientRect();
    el.classList.remove('is-snapped-left', 'is-snapped-right');
    place(el, r.left + d[0], r.top + d[1]);
    savePos(el);
    e.preventDefault();
  }

  function restorePos(el) {
    var saved = null;
    try { saved = JSON.parse(global.localStorage.getItem(POS_KEY) || 'null'); } catch (e) {}
    if (saved && typeof saved.left === 'number' && typeof saved.top === 'number') place(el, saved.left, saved.top);
  }

  /* ============================================================
   * 6 · SIZE — resize grip and collapse
   * ============================================================ */
  function readSize() {
    try { return JSON.parse(global.localStorage.getItem(SIZE_KEY) || 'null'); } catch (e) { return null; }
  }
  function applySize(el) {
    var s = readSize();
    if (!s) return;
    if (s.w) el.style.setProperty('width', s.w + 'px', 'important');
    if (s.h) el.style.setProperty('max-height', s.h + 'px', 'important');
  }
  function saveSize(w, h) {
    try { global.localStorage.setItem(SIZE_KEY, JSON.stringify({ w: Math.round(w), h: Math.round(h) })); } catch (e) {}
  }

  function installChrome(el) {
    if (el.__auroraChrome) return;
    el.__auroraChrome = true;

    var head = el.querySelector('.cts-head');
    var close = el.querySelector('.cts-x');
    if (head) {
      head.setAttribute('tabindex', '0');
      head.setAttribute('role', 'toolbar');
      head.setAttribute('aria-label', 'Move the Clavis panel — arrow keys move it, Home resets it');
      head.addEventListener('dblclick', function (e) {
        if (e.target.closest('button')) return;
        resetPos(el);
      });
    }

    /* Collapse to the header. Height is set explicitly so the
       panel's own height spring owns the motion. */
    if (head && close && !el.querySelector('.cts-min')) {
      var min = doc.createElement('button');
      min.type = 'button';
      min.className = 'cts-min';
      min.setAttribute('aria-label', 'Collapse');
      min.innerHTML = '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="m6 15 6-6 6 6"/></svg>';
      min.addEventListener('click', function (e) {
        e.stopPropagation();
        toggleCollapse(el);
      });
      head.insertBefore(min, close);
    }

    if (!el.querySelector('.cts-grip')) {
      var grip = doc.createElement('div');
      grip.className = 'cts-grip';
      grip.setAttribute('aria-hidden', 'true');
      el.appendChild(grip);
      attachResize(el, grip);
    }

    applySize(el);
    restorePos(el);
  }

  function toggleCollapse(el) {
    var head = el.querySelector('.cts-head');
    var headH = head ? head.offsetHeight : 42;
    var isCurrentlyCollapsed = el.classList.contains('is-collapsed') || el.classList.contains('is-collapsing');

    clearTimeout(el._auCollapse);

    if (isCurrentlyCollapsed) {
      /* ── EXPANDING (Apple Dynamic Island blooming) ── */
      el.__auCollapsed = false;
      var currentH = el.offsetHeight;
      el.classList.remove('is-collapsed');
      el.classList.remove('is-collapsing');
      el.classList.add('is-expanding');

      // Start from current presentation height to guarantee interruptibility
      el.style.height = currentH + 'px';
      el.style.overflow = 'hidden';
      void el.offsetHeight; // Force layout reflow

      // Measure true target height with body visible
      var targetH = el.scrollHeight;
      el.style.height = targetH + 'px';

      el._auCollapse = setTimeout(function () {
        el.classList.remove('is-expanding');
        el.style.height = 'auto';
        el.style.overflow = '';
      }, 420);
    } else {
      /* ── COLLAPSING (Apple Dynamic Island compacting) ── */
      el.__auCollapsed = true;
      var currentH = el.offsetHeight;
      el.classList.remove('is-expanding');
      el.classList.add('is-collapsing');

      // Start from current presentation height
      el.style.height = currentH + 'px';
      el.style.overflow = 'hidden';
      void el.offsetHeight; // Force layout reflow

      // Animate container down to header pill height
      el.style.height = headH + 'px';

      el._auCollapse = setTimeout(function () {
        el.classList.remove('is-collapsing');
        el.classList.add('is-collapsed');
        el.style.overflow = '';
      }, 380);
    }
  }

  function attachResize(el, grip) {
    var rs = null;
    grip.addEventListener('pointerdown', function (e) {
      if (e.button !== 0) return;
      var r = el.getBoundingClientRect();
      rs = { x: e.clientX, y: e.clientY, w: r.width, h: r.height };
      grip.setPointerCapture(e.pointerId);
      el.classList.add('is-dragging');     // borrow the lift, same idea
      e.stopPropagation();
      e.preventDefault();
    });
    grip.addEventListener('pointermove', function (e) {
      if (!rs) return;
      var w = clamp(rs.w + (e.clientX - rs.x), 268, Math.min(560, global.innerWidth - 2 * MARGIN));
      var h = clamp(rs.h + (e.clientY - rs.y), 140, global.innerHeight - 2 * MARGIN);
      el.style.setProperty('width', Math.round(w) + 'px', 'important');
      el.style.setProperty('max-height', Math.round(h) + 'px', 'important');
      e.stopPropagation();
    });
    function endResize(e) {
      if (!rs) return;
      var r = el.getBoundingClientRect();
      rs = null;
      el.classList.remove('is-dragging');
      try { grip.releasePointerCapture(e.pointerId); } catch (err) {}
      saveSize(r.width, r.height);
    }
    grip.addEventListener('pointerup', endResize);
    grip.addEventListener('pointercancel', endResize);
    grip.addEventListener('dblclick', function () {
      el.style.removeProperty('width');
      el.style.removeProperty('max-height');
      try { global.localStorage.removeItem(SIZE_KEY); } catch (e) {}
    });
  }

  /* ============================================================
   * 7 · SETTLE — stop paying for the blur once it has arrived
   * ============================================================ */
  function watchSettle(el) {
    if (el.__auroraSettle) return;
    el.__auroraSettle = true;
    /* The focus blur is a keyframe animation now (see cts-focus in
       the stylesheet), so the arrival signal is animationend. A
       transitionend on `filter` no longer exists and never fired
       reliably anyway — which is how the panel used to get stuck
       mid-blur. */
    el.addEventListener('animationend', function (e) {
      if (e.target !== el || e.animationName !== 'cts-focus') return;
      el.classList.remove('au-focus-in');
      if (el.classList.contains('is-open')) el.classList.add('au-settled');
    });
    var wasOpen = el.classList.contains('is-open');
    /* Leaving reverses it, so the next open blurs in again.
       NEVER write a class here unless it actually changes: this
       observer watches the very attribute it writes, `remove()`
       re-serialises `class` even when the token was absent, and
       MutationObserver callbacks are microtasks — so one
       unconditional remove() is an infinite microtask loop and a
       hung tab. Both branches below are guarded for that reason. */
    new MutationObserver(function () {
      var cl = el.classList;
      /* The blur belongs to ONE edge — closed to open. Hanging it
         off `.is-open` meant every other class change replayed it,
         which is why dragging the panel re-blurred it. */
      var open = cl.contains('is-open');
      if (open && !wasOpen) { cl.add('au-focus-in'); }
      else if (!open && cl.contains('au-focus-in')) { cl.remove('au-focus-in'); }
      wasOpen = open;
      if (!open && cl.contains('au-settled')) cl.remove('au-settled');
      // a repaint re-expanded it — keep the user's choice
      if (el.__auCollapsed && !cl.contains('is-collapsed') && !cl.contains('is-collapsing')) cl.add('is-collapsed');
    }).observe(el, { attributes: true, attributeFilter: ['class'] });
  }

  /* ============================================================
   * 8 · THE RAIL
   * ------------------------------------------------------------
   * One job: say which end of the nav has more content, so the
   * stylesheet can fade only that end. A permanent top fade dims
   * the first item and reads as a rendering bug.
   * ============================================================ */
  /* ── 8a. Peek ────────────────────────────────────────────────
     Three separate setCollapsed() implementations live in this app
     (app.js, luxury-ui.js, nexus-enhancements.js) and each writes
     `.collapsed`, `data-sidebar-state` and `--sidebar-current` on
     its own schedule. A CSS-only `:hover` expand raced all three:
     the labels un-collapsed while the rail stayed 64px, so every
     label rendered at full width and got clipped by the rail's
     own `overflow: hidden`. One class, owned here, cannot disagree
     with itself — and the width is written inline, which outranks
     every stylesheet in the app including the !important ones. */
  // Keep one canonical peek width. The old 232/236px mismatch made the
  // labels and the main sheet settle on different frames.
  var PEEK_W = 232, PEEK_IN = 35, PEEK_OUT = 140;

  function installPeek() {
    var rail = doc.getElementById('sidebar');
    if (!rail || rail.__auroraPeek) return !!rail;
    rail.__auroraPeek = true;

    var timer = 0;
    function collapsed() { return rail.classList.contains('collapsed'); }

    function set(on) {
      on = !!on && collapsed();
      if (rail.classList.contains('au-peek') === on) return;
      rail.classList.toggle('au-peek', on);
      // The sheet follows the reversible rail motion instead of being
      // clipped underneath it while the labels arrive.
      doc.documentElement.style.setProperty('--sidebar-current', on ? PEEK_W + 'px' : '62px');
      doc.documentElement.style.setProperty('--main-left', on ? PEEK_W + 'px' : '62px');
      ['width', 'min-width', 'max-width'].forEach(function (p) {
        if (on) rail.style.setProperty(p, PEEK_W + 'px', 'important');
        else rail.style.removeProperty(p);
      });
      /* apple-polish.js places its tooltip once, against whatever
         width the rail had at that instant. Any geometry change
         strands it, so every geometry change clears it. */
      Array.prototype.forEach.call(doc.querySelectorAll('.ap-tip'), function (n) {
        n.classList.remove('ap-tip-in');
      });
    }
    function later(on) { clearTimeout(timer); timer = setTimeout(function () { set(on); }, on ? PEEK_IN : PEEK_OUT); }

    rail.addEventListener('pointerenter', function () { later(true); });
    rail.addEventListener('pointerleave', function () { later(false); });
    rail.addEventListener('focusin', function () { set(true); });
    rail.addEventListener('focusout', function (e) {
      if (!rail.contains(e.relatedTarget)) set(false);
    });

    /* Someone expanded the rail for real — drop the peek so the two
       states cannot both be on. Guarded: the branch only fires when
       it will actually change something, or this observer would be
       writing the very class it watches, forever. */
    new MutationObserver(function () {
      if (!collapsed() && rail.classList.contains('au-peek')) set(false);
    }).observe(rail, { attributes: true, attributeFilter: ['class'] });

    /* ⌘/Ctrl + B — what every app with a rail binds. Uses the app's
       own controller rather than a fourth setCollapsed(). */
    doc.addEventListener('keydown', function (e) {
      if (!(e.metaKey || e.ctrlKey) || e.altKey || e.shiftKey) return;
      if (String(e.key).toLowerCase() !== 'b') return;
      var c = global.SidebarController;
      if (!c || typeof c.toggle !== 'function') return;
      set(false);
      c.toggle();
      e.preventDefault();
    });
    return true;
  }

  /* ── 8b. The travelling marker ───────────────────────────────
     One element that slides to the active row, instead of a bar
     drawn on each row. The eye follows one object rather than
     re-finding a new highlight. */
  function installMarker() {
    var nav = doc.getElementById('sidebar-nav-scroll') || doc.querySelector('#sidebar .sidebar-nav');
    var rail = doc.getElementById('sidebar');
    if (!nav || !rail || nav.__auroraMarker) return !!nav;
    nav.__auroraMarker = true;

    var marker = doc.createElement('i');
    marker.className = 'au-rail-marker';
    marker.setAttribute('aria-hidden', 'true');
    nav.appendChild(marker);
    rail.classList.add('has-marker');

    var queued = false;
    function place() {
      queued = false;
      var active = nav.querySelector('.nav-item.active, .nav-sub-item.active');
      if (!active || active.offsetParent === null) { marker.classList.remove('is-on'); return; }
      var a = active.getBoundingClientRect(), n = nav.getBoundingClientRect();
      if (!a.height) { marker.classList.remove('is-on'); return; }
      var h = Math.min(20, a.height - 10);
      marker.style.height = h + 'px';
      marker.style.setProperty('--au-marker-y', (a.top - n.top + nav.scrollTop + (a.height - h) / 2) + 'px');
      marker.classList.add('is-on');
    }
    function schedule() { if (!queued) { queued = true; requestAnimationFrame(place); } }

    /* The app swaps `.active` when the view changes; the rail also
       reflows on collapse, on peek and on scroll. All of them move
       the row, so all of them move the marker. */
    new MutationObserver(schedule).observe(nav, { subtree: true, attributes: true, attributeFilter: ['class'] });
    new MutationObserver(schedule).observe(rail, { attributes: true, attributeFilter: ['class', 'style'] });
    nav.addEventListener('scroll', schedule, { passive: true });
    global.addEventListener('resize', schedule);
    setTimeout(schedule, 300);
    schedule();
    return true;
  }

  /* ── 8c. The sheet's top edge ────────────────────────────────
     Same rule as the rail: a fade only on the side that has more
     content. A permanent one dims the first row of every page. */
  function installSheet() {
    var sheet = doc.querySelector('.views-container') || doc.getElementById('main-scroll-area');
    if (!sheet || sheet.__auroraSheet) return !!sheet;
    sheet.__auroraSheet = true;
    var queued = false;
    function edge() {
      queued = false;
      var want = sheet.scrollTop > 6 ? 'scrolled' : 'top';
      if (sheet.dataset.edge !== want) sheet.dataset.edge = want;
    }
    function schedule() { if (!queued) { queued = true; requestAnimationFrame(edge); } }
    sheet.addEventListener('scroll', schedule, { passive: true });
    global.addEventListener('resize', schedule);
    edge();
    return true;
  }

  /* ── 8d. The rail opens closed ───────────────────────────────
     Three modules restore `.collapsed` from lx-sidebar-collapsed,
     so once you had expanded the rail it came back expanded every
     launch. With peek on hover the open rail is a state you enter,
     not a state you live in — so every launch starts closed, and
     the key is set to match so the other three agree with us.

     Boot only. Expanding it by hand afterwards still sticks for
     the rest of the session; this does not fight the user, it
     just decides where the session starts. Reuses the app's own
     controller rather than becoming a fourth setCollapsed(). */
  function closeRailAtBoot() {
    var rail = doc.getElementById('sidebar');
    if (!rail || rail.__auroraClosed) return !!rail;
    rail.__auroraClosed = true;
    function shut() {
      try { global.localStorage.setItem('lx-sidebar-collapsed', 'true'); } catch (e) {}
      if (global.SidebarController && global.SidebarController.collapse) {
        global.SidebarController.collapse();
      } else if (!rail.classList.contains('collapsed')) {
        rail.classList.add('collapsed');
      }
      doc.documentElement.dataset.sidebarState = 'collapsed';
    }
    shut();
    /* luxury-ui restores its stored width on a later frame; the key
       now says collapsed, so this second pass just settles it. */
    requestAnimationFrame(shut);
    setTimeout(shut, 400);
    return true;
  }

  function installRail() {
    closeRailAtBoot();
    installPeek();
    installMarker();
    installSheet();
    var nav = doc.getElementById('sidebar-nav-scroll') ||
              doc.querySelector('#sidebar .sidebar-nav');
    if (!nav || nav.__auroraRail) return !!nav;
    nav.__auroraRail = true;

    var queued = false;
    function edge() {
      queued = false;
      var over = nav.scrollHeight - nav.clientHeight;
      if (over < 6) { nav.dataset.edge = 'none'; return; }
      var top = nav.scrollTop > 4;
      var bottom = nav.scrollTop < over - 4;
      nav.dataset.edge = top && bottom ? 'both' : (top ? 'top' : (bottom ? 'bottom' : 'none'));
    }
    function schedule() { if (!queued) { queued = true; requestAnimationFrame(edge); } }

    nav.addEventListener('scroll', schedule, { passive: true });
    global.addEventListener('resize', schedule);
    // items appear and groups expand, both of which change scrollHeight
    new MutationObserver(schedule).observe(nav, { childList: true, subtree: true });
    // …and a webfont landing reflows the list without touching the DOM
    try { doc.fonts && doc.fonts.ready.then(schedule); } catch (e) {}
    setTimeout(schedule, 900);
    edge();
    return true;
  }

  /* ============================================================
   * 9 · THE CONVERSATION STRIP
   * ------------------------------------------------------------
   * Names the open conversation from what was actually asked —
   * "200 verified hotel leads in Gurugram", not "New chat" and
   * not the raw first 30 characters. It reads the same two things
   * the panel reads: the classifier's intent and the chips pulled
   * out of the user's own words.
   * ============================================================ */
  var THREAD_NOUN = { leads: 'leads', contacts: 'contacts', outreach: 'outreach', dataset: 'records' };
  var THREAD_KICKER = {
    leads: 'Leads', contacts: 'Contacts', outreach: 'Outreach', dataset: 'Data',
    calculate: 'Maths', search: 'Search', research: 'Research', code: 'Code',
    file: 'Document', writing: 'Draft', create: 'Create', system: 'Action', thinking: 'Chat'
  };

  function singular(word) {
    return String(word || '').replace(/ies$/i, 'y').replace(/([^s])s$/i, '$1');
  }
  function sentence(s) {
    s = String(s || '').replace(/\s+/g, ' ').trim();
    return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
  }

  /** describe(text) → { kicker, title } — exported for the self-check. */
  function describe(text) {
    var M = global.ClavisTaskModel;
    var label = M && M.IntentClassifier ? M.IntentClassifier.label(text) : null;
    var mode = (label && label.mode) || 'thinking';
    var ask = readAsk({ _text: text });
    var noun = THREAD_NOUN[mode];

    /* The good case: we understood enough to write the phrase
       ourselves. Anything less and we hand back their own words —
       a half-built phrase is worse than a plain quote. */
    if (noun && (ask.count || ask.sectors.length || ask.places.length)) {
      var bits = [];
      if (ask.count) bits.push(ask.count);
      if (ask.quals.indexOf('Verified only') > -1) bits.push('verified');
      if (ask.sectors.length) bits.push(singular(ask.sectors[0]).toLowerCase());
      bits.push(noun);
      if (ask.places.length) bits.push('in ' + ask.places.slice(0, 2).join(' & '));
      return { kicker: THREAD_KICKER[mode] || 'Chat', title: sentence(bits.join(' ')) };
    }

    /* The classifier writes "Verb · <their words>" and drops to a
       bare "Verb…" when it is not confident. A bare verb is not a
       conversation name — "Thinking" tells you nothing — so in
       that case the title is their own sentence, trimmed. */
    var t = (label && label.title) || '';
    var subject = t.indexOf(' · ') > -1 ? shortTitle({ title: t }) : '';
    if (!subject) subject = shortTitle({ title: String(text || '') });
    return { kicker: THREAD_KICKER[mode] || 'Chat', title: sentence(subject) };
  }

  function installThread() {
    var header = doc.querySelector('#view-jarvis .jarvis-hero-header');
    if (!header) return false;
    if (header.__auroraThread) return true;
    header.__auroraThread = true;

    var strip = doc.createElement('div');
    strip.className = 'au-thread';
    strip.setAttribute('aria-live', 'polite');
    strip.innerHTML = '<span class="au-thread-kicker"></span><span class="au-thread-title"></span>';
    strip.hidden = true;
    var actions = header.querySelector('.jarvis-hero-actions');
    if (actions) header.insertBefore(strip, actions); else header.appendChild(strip);

    var kickerEl = strip.querySelector('.au-thread-kicker');
    var titleEl = strip.querySelector('.au-thread-title');
    var named = false;

    function set(text) {
      var d = describe(text);
      if (titleEl.textContent === d.title && kickerEl.textContent === d.kicker) return;
      kickerEl.textContent = d.kicker;
      titleEl.textContent = d.title;
      strip.hidden = false;
      strip.classList.remove('is-new');
      void strip.offsetWidth;
      strip.classList.add('is-new');
    }
    function clear() {
      named = false;
      strip.hidden = true;
      kickerEl.textContent = titleEl.textContent = '';
    }

    /* The first real ask names the thread and it keeps that name.
       Re-titling on every message makes the header twitch. */
    if (global.ClavisTask && global.ClavisTask.Store) {
      global.ClavisTask.Store.subscribe(function (task) {
        if (!task || named) return;
        var text = task._text || '';
        if (text.trim().length < 3) return;
        named = true;
        set(text);
      });
    }

    /* "New chat" empties the message list — that is the signal, and
       it works however the chat was cleared. */
    var msgs = doc.getElementById('jarvis-messages');
    if (msgs) {
      new MutationObserver(function () {
        if (named && !msgs.children.length) clear();
      }).observe(msgs, { childList: true });
    }
    return true;
  }

  /* ============================================================
   * 9b · THE COMPOSER
   * ------------------------------------------------------------
   * Three pages, three textareas, one set of rules. The box grows
   * with what you type and it grows slowly, on the same spring the
   * rest of the app moves on.
   *
   * A height transition needs two numbers. `scrollHeight` only
   * tells the truth at `height: auto`, and `auto` is not a number
   * you can animate from — so: kill the transition, go to auto,
   * read, put the old height back, flush it, then turn the
   * transition on and set the new height. The flush at the OLD
   * height is what makes the animation start from where the box
   * actually was rather than snapping first.
   *
   * The stylesheet's transition carries !important (it has to, to
   * reach past four other stylesheets), so `style.transition` can't
   * beat it. A class can.
   * ============================================================ */
  var GROW_MIN = 28, GROW_MAX = 208;
  var COMPOSERS = ['jarvis-input', 'chat-input', 'candidate-ai-input'];

  /* Five stylesheets pin this textarea with `height: 24|28|30px`
     or `height: auto`, all !important. A plain inline height loses
     to every one of them, so the height goes in as !important too
     — the same thing the rail's peek does with its width. */
  function setH(ta, v) { ta.style.setProperty('height', v, 'important'); }

  function growBox(ta) {
    var prevH = parseFloat(ta.style.height) || GROW_MIN;
    if (!ta.value || !ta.value.trim()) {
      setH(ta, GROW_MIN + 'px');
      ta.classList.remove('au-measuring');
      ta.classList.remove('au-shrinking');
      ta.dataset.grow = 'fit';
      ta.style.setProperty('--lx-ta-h', GROW_MIN + 'px');
      var hst = ta.closest ? ta.closest('.chat-container, .jarvis-input-container, .claude-input-container, .candidate-composer') : null;
      if (hst) hst.dataset.emptyInput = '1';
      return;
    }
    ta.classList.add('au-measuring');
    setH(ta, 'auto');
    var next = Math.max(GROW_MIN, Math.min(ta.scrollHeight, GROW_MAX));
    /* While the view is display:none scrollHeight reads 0, which
       would pin the box at its floor. Leave it as it was instead. */
    if (!ta.scrollHeight) next = prevH || GROW_MIN;

    /* KEY FIX: Only animate when growing, never when shrinking.
       On shrink (text deleted) we snap immediately — no spring
       bounce, no fluctuation. This is exactly how Claude/ChatGPT
       handle it: grow feels physical, shrink is instant.         */
    var growing = next > prevH + 1;
    if (growing) {
      ta.classList.remove('au-shrinking');
    } else {
      ta.classList.add('au-shrinking');
    }

    /* Measurement technique: set old height back, flush, then
       set new height so the transition starts from correct point. */
    setH(ta, prevH + 'px');
    void ta.offsetHeight; /* layout flush */
    ta.classList.remove('au-measuring');
    setH(ta, next + 'px');

    var full = next >= GROW_MAX ? 'full' : 'fit';
    if (ta.dataset.grow !== full) ta.dataset.grow = full;

    var host = ta.closest ? ta.closest('.chat-container, .jarvis-input-container, .claude-input-container, .candidate-composer') : null;
    if (host) {
      var empty = !ta.value.trim() ? '1' : '0';
      if (host.dataset.emptyInput !== empty) host.dataset.emptyInput = empty;
    }
  }


  function installComposer() {
    var found = 0;
    COMPOSERS.forEach(function (id) {
      var ta = doc.getElementById(id);
      if (!ta) return;
      found++;
      if (ta.__auroraGrow) return;
      ta.__auroraGrow = true;

      /* An empty textarea is as tall as its `rows`, and the two chat
         pages never set one — so they opened two lines tall while the
         studio opened at one. Same component, same resting height. */
      if (ta.rows !== 1) ta.rows = 1;

      var grow = function () { growBox(ta); };
      ta.addEventListener('input', grow);
      ta.addEventListener('focus', grow);
      /* Quick-action chips and voice dictation write .value straight
         in, which fires no input event. */
      new MutationObserver(grow).observe(ta, { attributes: true, attributeFilter: ['value'] });
      /* …and the first real measurement can only happen once the
         view stops being display:none and the box gets a width.
         WIDTH only: growBox writes the height, so a height-driven
         re-measure would cut its own animation short every frame
         and the box would ease toward its target forever. */
      var lastW = -1;
      try {
        new ResizeObserver(function (entries) {
          var w = Math.round(entries[0].contentRect.width);
          if (w === lastW) return;
          lastW = w;
          grow();
        }).observe(ta);
      } catch (e) { setTimeout(grow, 500); }
      grow();
    });
    return found === COMPOSERS.length;
  }

  /* ============================================================
   * 10 · INSTALL
   * ============================================================ */
  function adopt() {
    var el = surfaceEl();
    if (!el) return false;
    installChrome(el);
    watchSettle(el);
    return true;
  }

  function install() {
    installBodies();

    /* The panel is built lazily on the first task, so claim the
       pointer at the document and wait for the element. */
    doc.addEventListener('pointerdown', onPointerDown, true);
    doc.addEventListener('keydown', onKeyDown);
    global.addEventListener('resize', function () {
      var el = surfaceEl();
      if (!el || !el.classList.contains('is-moved')) return;
      place(el, parseFloat(el.style.left) || 0, parseFloat(el.style.top) || 0);
    });

    if (!adopt()) {
      var mo = new MutationObserver(function () { if (adopt()) mo.disconnect(); });
      mo.observe(doc.body, { childList: true });
      /* Belt and braces: the surface may also appear via a route
         the observer misses on a slow first paint. */
      var tries = 0;
      var iv = setInterval(function () {
        if (adopt() || ++tries > 40) { clearInterval(iv); try { mo.disconnect(); } catch (e) {} }
      }, 250);
    }

    /* The renderers, the rail and the header all load in their own
       order, so poll briefly rather than guessing. Each returns
       true once it is done; the tick stops when all three are. */
    var t = 0;
    var iv2 = setInterval(function () {
      var done = installBodies() & installRail() & installThread() & installComposer();
      if (done || ++t > 40) clearInterval(iv2);
    }, 250);
    installRail();
    installThread();
    installComposer();
  }

  ready(install);

  /* ============================================================
   * 9 · Self-check — ClavisAurora.demo()
   * ============================================================ */
  global.ClavisAurora = {
    readAsk: readAsk,
    describe: describe,
    reset: function () {
      var el = surfaceEl();
      if (el) { resetPos(el); el.style.removeProperty('width'); el.style.removeProperty('max-height'); }
      try { global.localStorage.removeItem(SIZE_KEY); global.localStorage.removeItem(POS_KEY); } catch (e) {}
      return 'ok';
    },

    /* Drives a real lead task through the panel so the bodies,
       the chips and the motion can all be seen at once. */
    demo: function (which) {
      var Task = global.ClavisTask;
      if (!Task) throw new Error('ClavisTask not loaded');
      var asks = {
        leads: 'Gurugram ke hotels ke 200 verified leads nikalo with phone numbers',
        contacts: 'in companies ke decision maker ke email aur phone extract karo',
        outreach: 'high intent leads ke liye follow-up whatsapp message draft karo',
        dataset: 'leads.xlsx ke rows clean karke summary do',
        calculate: '12500 ka 18% gst kitna hoga'
      };
      /* Tool names matter: the classifier weighs observed tools
         above wording, so a demo that fires `lead_search` for every
         intent would relabel them all as leads — correctly. Each
         run gets the tools its own intent would really use. */
      var tools = {
        leads: ['lead_search', 'enrich_prospects'],
        contacts: ['contact_lookup', 'verify_email'],
        outreach: ['draft_outreach', 'campaign_preview'],
        dataset: ['sheet_update', 'dedupe_rows'],
        calculate: ['calc', 'calc']
      };
      var payload = {
        leads: [{ leadCount: 84, sources: [1, 2, 3] }, { verifiedCount: 61 }],
        contacts: [{ contactCount: 84 }, { emailCount: 54, phoneCount: 61 }],
        outreach: [{ recipientCount: 61 }, { draftCount: 3 }],
        dataset: [{ rowCount: 1240 }, { columnCount: 11 }],
        calculate: [{}, {}]
      };
      var key = which || 'leads';
      var text = asks[key] || asks.leads;
      var tl = tools[key] || tools.leads;
      var pl = payload[key] || payload.leads;

      var id = Task.begin(text, { source: 'composer' });
      Task.toolStart(id, tl[0]);
      Task.toolResult(id, tl[0], Object.assign({ success: true }, pl[0]));
      setTimeout(function () { Task.toolStart(id, tl[1]); }, 700);
      setTimeout(function () { Task.toolResult(id, tl[1], Object.assign({ success: true }, pl[1])); }, 1500);
      setTimeout(function () {
        var types = { leads: 'leads', contacts: 'contacts', outreach: 'outreach', dataset: 'table', calculate: 'text' };
        Task.complete(id, {
          type: types[key] || 'text',
          text: key === 'calculate' ? '₹2,250' : 'Verified 61 of 84 records. Phone lines checked, duplicates merged.',
          rows: key === 'calculate' ? undefined : [
            { name: 'Sunrise Hotel', city: 'Gurugram' },
            { name: 'Leela Ambience', city: 'Gurugram' },
            { name: 'Trident Hotel', city: 'Gurugram' }
          ]
        }, [
          { id: 'hub', label: 'Open Leads Hub', primary: true, run: function () { try { global.showView && global.showView('leads'); } catch (e) {} } },
          { id: 'view', label: 'View reply', run: function () {} }
        ]);
      }, 2600);
      return 'watch the panel: ' + text;
    },

    /* Pure checks — no DOM, safe to run any time. */
    selfTest: function () {
      var fails = [];
      var a = readAsk({ _text: 'Gurugram ke 200 verified hotels ke leads chahiye with phone' });
      if (a.count !== 200) fails.push('count not read → ' + a.count);
      if (a.places.indexOf('Gurugram') === -1) fails.push('place not read → ' + a.places.join(','));
      if (!a.sectors.length) fails.push('sector not read');
      if (a.quals.indexOf('Verified only') === -1) fails.push('qualifier not read → ' + a.quals.join(','));

      var b = readAsk({ _text: 'hello' });
      if (b.count || b.places.length || b.sectors.length) fails.push('invented chips from a bare greeting');

      /* A bare number must not become a target. */
      var c = readAsk({ _text: 'call 98100 karke pucho' });
      if (c.count) fails.push('bare number became a target → ' + c.count);

      /* The conversation strip must write a phrase, not echo. */
      var d = describe('Gurugram ke hotels ke 200 verified leads nikalo with phone numbers');
      if (d.kicker !== 'Leads') fails.push('thread kicker wrong → ' + d.kicker);
      if (!/200 verified hotel leads in Gurugram/i.test(d.title)) fails.push('thread title not composed → ' + d.title);
      var d2 = describe('hello');
      if (!d2.title) fails.push('thread title empty for a bare greeting');
      if (d2.title.length > 60) fails.push('thread title too long → ' + d2.title);

      /* The rail's two states must never both be on, and peek must
         own the width itself rather than hoping a stylesheet wins. */
      var rail = doc.getElementById('sidebar');
      if (rail) {
        if (!rail.__auroraPeek) fails.push('rail peek not installed');
        if (!rail.querySelector('.au-rail-marker')) fails.push('rail marker missing');
        if (!rail.classList.contains('collapsed') && rail.classList.contains('au-peek')) {
          fails.push('rail is expanded and peeking at the same time');
        }
        if (rail.classList.contains('au-peek') && !rail.style.width) {
          fails.push('peek did not write its own width');
        }
      }

      /* All three composers answer to the same owner, and none of
         them may sit at zero height. */
      COMPOSERS.forEach(function (id) {
        var ta = doc.getElementById(id);
        if (!ta) return;
        if (!ta.__auroraGrow) fails.push(id + ' has no grow owner');
        if (ta.classList.contains('au-measuring')) fails.push(id + ' was left mid-measure');
        var h = parseFloat(ta.style.height) || 0;
        if (h && h < GROW_MIN) fails.push(id + ' collapsed below its floor → ' + h);
      });

      /* The sheet must still scroll, or every long page loses its
         bottom half — and the orb must carry no filter from us. */
      var sheet = doc.querySelector('.views-container') || doc.getElementById('main-scroll-area');
      if (sheet && getComputedStyle(sheet).overflowY !== 'auto') fails.push('the page sheet cannot scroll');
      var orb = doc.getElementById('orb-container');
      if (orb) {
        var os = getComputedStyle(orb);
        if (os.filter !== 'none') fails.push('something is filtering the orb → ' + os.filter);
        if (os.overflow !== 'visible') fails.push('something is clipping the orb → ' + os.overflow);
      }

      if (typeof BODIES.leads !== 'function') fails.push('leads body missing');
      var html = BODIES.leads({ _text: 'delhi leads', metrics: {}, events: [], phase: 'working', title: 'Finding leads', confidence: 0.8 });
      if (html.indexOf('cts-kicker') === -1) fails.push('leads body has no kicker');
      if (/undefined|NaN|null/.test(html)) fails.push('leads body leaked a placeholder value');

      console.assert(fails.length === 0, 'ClavisAurora failures:\n' + fails.join('\n'));
      return fails.length ? fails : 'ok';
    }
  };
})(window);
