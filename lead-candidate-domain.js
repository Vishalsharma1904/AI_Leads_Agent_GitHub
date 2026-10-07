/*
 * Rudra24 AI lead/candidate request planning.
 *
 * This is intentionally a small, deterministic boundary between the chat
 * language and the sourcing engines. It keeps the product open-ended: a
 * service role is data, not a hard-coded enum, and an omitted industry means
 * "all relevant industries" rather than the old security-only default.
 */
(function (global) {
  'use strict';

  var CITY_ALIASES = [
    /* NCR localities he names on their own (longest match wins, so
       "Noida Extension" is not also "Noida") */
    ['greater noida west', 'Greater Noida West'], ['noida extension', 'Noida Extension'], ['noida extn', 'Noida Extension'],
    ['gaur city', 'Greater Noida West'], ['sahibabad', 'Sahibabad'], ['indirapuram', 'Indirapuram'], ['vaishali', 'Vaishali'],
    ['kaushambi', 'Kaushambi'], ['vasundhara', 'Vasundhara'], ['raj nagar extension', 'Raj Nagar Extension'],
    ['crossings republik', 'Crossings Republik'], ['mohan nagar', 'Mohan Nagar'], ['kavi nagar', 'Kavi Nagar'],
    ['site 4 sahibabad', 'Sahibabad'], ['udyog vihar', 'Udyog Vihar'], ['okhla', 'Okhla'], ['dwarka', 'Dwarka'],
    ['new delhi', 'New Delhi'], ['greater noida', 'Greater Noida'], ['gr noida', 'Greater Noida'],
    ['gurugram', 'Gurugram'], ['gurgaon', 'Gurugram'], ['gurgao', 'Gurugram'], ['gurgoan', 'Gurugram'],
    ['bangalore', 'Bengaluru'], ['bengaluru', 'Bengaluru'], ['banglore', 'Bengaluru'],
    ['mumbai', 'Mumbai'], ['bombay', 'Mumbai'], ['delhi', 'Delhi'], ['dehli', 'Delhi'], ['dilli', 'Delhi'],
    ['hyderabad', 'Hyderabad'], ['chennai', 'Chennai'], ['madras', 'Chennai'], ['pune', 'Pune'],
    ['kolkata', 'Kolkata'], ['calcutta', 'Kolkata'], ['ahmedabad', 'Ahmedabad'],
    ['noida', 'Noida'], ['noidaa', 'Noida'], ['jaipur', 'Jaipur'], ['lucknow', 'Lucknow'],
    ['surat', 'Surat'], ['kochi', 'Kochi'], ['chandigarh', 'Chandigarh'],
    ['ghaziabad', 'Ghaziabad'], ['gahziabad', 'Ghaziabad'], ['gaziyabad', 'Ghaziabad'],
    ['gaziabad', 'Ghaziabad'], ['ghaziyabad', 'Ghaziabad'],
    ['faridabad', 'Faridabad'], ['faridabaad', 'Faridabad'], ['meerut', 'Meerut'],
    ['rohtak', 'Rohtak'], ['sonipat', 'Sonipat'], ['panipat', 'Panipat'], ['manesar', 'Manesar'],
    ['bhiwadi', 'Bhiwadi'], ['neemrana', 'Neemrana'], ['navi mumbai', 'Navi Mumbai'],
    /* NCR towns that kept losing to the Gurugram default — the fuzzy
       fallback below only catches typos of a KNOWN name, not a real
       place that was simply never on the list. */
    ['loni', 'Loni'], ['lonee', 'Loni'], ['muradnagar', 'Muradnagar'], ['modinagar', 'Modinagar'],
    ['khurja', 'Khurja'], ['pilkhuwa', 'Pilkhuwa'], ['hapur', 'Hapur'], ['bulandshahr', 'Bulandshahr'],
    ['bulandshahar', 'Bulandshahr'], ['muzaffarnagar', 'Muzaffarnagar'], ['shamli', 'Shamli'],
    ['baghpat', 'Baghpat'], ['dadri', 'Dadri'], ['bahadurgarh', 'Bahadurgarh'], ['jhajjar', 'Jhajjar'],
    ['rewari', 'Rewari'], ['palwal', 'Palwal'], ['nuh', 'Nuh'], ['alwar', 'Alwar'], ['bharatpur', 'Bharatpur'],
    ['dharuhera', 'Dharuhera'], ['bawal', 'Bawal'], ['karnal', 'Karnal'], ['bhiwani', 'Bhiwani'],
    ['jind', 'Jind'], ['kanpur', 'Kanpur'], ['agra', 'Agra'], ['varanasi', 'Varanasi'], ['nagpur', 'Nagpur'],
    ['nashik', 'Nashik'], ['thane', 'Thane'], ['vadodara', 'Vadodara'], ['rajkot', 'Rajkot'],
    ['indore', 'Indore'], ['bhopal', 'Bhopal'], ['ludhiana', 'Ludhiana'], ['amritsar', 'Amritsar'],
    ['patna', 'Patna'], ['ranchi', 'Ranchi'], ['raipur', 'Raipur'], ['bhubaneswar', 'Bhubaneswar'],
    ['guwahati', 'Guwahati'], ['kochi', 'Kochi'], ['cochin', 'Kochi'], ['visakhapatnam', 'Visakhapatnam'],
    ['vijayawada', 'Vijayawada'], ['dehradun', 'Dehradun'], ['goa', 'Goa']
  ];

  var KNOWN_CITIES = [
    'Ghaziabad', 'Noida', 'Greater Noida', 'Delhi', 'New Delhi', 'Gurugram',
    'Faridabad', 'Meerut', 'Mumbai', 'Bengaluru', 'Hyderabad', 'Chennai', 'Pune',
    'Kolkata', 'Ahmedabad', 'Jaipur', 'Lucknow', 'Chandigarh', 'Manesar', 'Sonipat',
    'Loni', 'Muradnagar', 'Modinagar', 'Khurja', 'Pilkhuwa', 'Hapur', 'Bulandshahr',
    'Muzaffarnagar', 'Shamli', 'Baghpat', 'Dadri', 'Bahadurgarh', 'Jhajjar', 'Rewari',
    'Palwal', 'Nuh', 'Alwar', 'Bharatpur', 'Dharuhera', 'Bawal', 'Karnal', 'Bhiwani', 'Jind',
    'Sahibabad', 'Indirapuram', 'Vaishali', 'Kaushambi', 'Vasundhara'
  ];

  var ROLE_ALIASES = [
    ['security|guard|suraksha|bouncer', 'Security'],
    ['housekeep(?:ing)?|cleaning|safai|janitor|sweeper|facility', 'Housekeeping'],
    ['pantry(?:\\s*boy)?|tea\\s*boy|chai|coffee\\s*boy|canteen|office\\s*boy|peon|helper', 'Pantry Boy'],
    ['cook|cooks|chef|chefs', 'Cooks'], ['nurse|nurses|nursing', 'Nurses'], ['driver|drivers|chauffeur', 'Drivers'],
    ['delivery(?:\\s*boy|\\s*executive)?', 'Delivery Executives'], ['developer|software\\s*engineer', 'Software Developers'],
    ['engineer', 'Engineers'], ['accountant', 'Accountants'], ['receptionist', 'Receptionists'],
    ['sales', 'Sales Executives'], ['teacher|teachers|faculty', 'Teachers'], ['waiter|waiters|steward', 'Waiters'],
    ['electrician', 'Electricians'], ['plumber', 'Plumbers'], ['warehouse|picker|packer', 'Warehouse Staff']
  ];

  /* A question about leads already in the database — never a new scrape. */
  var ABOUT_EXISTING_RE = /\b(saved|purani|puraani|existing|database|stats?|statistics|export|download|sync|delete|remove|count|total|kitni|kitne|report|summary|summari\w*|analy\w*|breakdown|status)\b/i;

  var LEAD_TARGET_CUES = /\b(lead|leads|prospect|prospects|client|clients|company|companies|businesses|buyers?)\b/i;
  var LEAD_ACTION_CUES = /\b(find|get|search|generate|nikalo|nikaal|dhundho|chahiye|chahie|laao|source|extract|scrape|pull|do|dedo|de\s*do|bhejo|lao|nikal|nikalwao|banao|chahiye)\b/i;
  var CANDIDATE_CUES = /\b(candidate|candidates|resume|resumes|cv|talent|applicant|job seeker|hire|hiring|recruit)\b/i;
  var GENERIC_REQUIREMENT_CUES = /\b(requirement|requirements|staff|manpower|service|services|vendor|outsourc|hiring)\b/i;

  function levenshtein(a, b) {
    if (!a || !b) return (a || b).length;
    var m = a.length, n = b.length;
    var dp = [];
    for (var i = 0; i <= m; i++) {
      dp[i] = [i];
      for (var j = 1; j <= n; j++) {
        dp[i][j] = i === 0 ? j : 0;
      }
    }
    for (var i = 1; i <= m; i++) {
      for (var j = 1; j <= n; j++) {
        if (a[i - 1] === b[j - 1]) dp[i][j] = dp[i - 1][j - 1];
        else dp[i][j] = 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
      }
    }
    return dp[m][n];
  }

  function normalise(value) {
    return String(value || '').toLowerCase().replace(/[‘’]/g, "'").replace(/\s+/g, ' ').trim();
  }

  function unique(values) {
    var seen = Object.create(null);
    return (values || []).filter(function (value) {
      var key = normalise(value);
      if (!key || seen[key]) return false;
      seen[key] = true;
      return true;
    });
  }

  function titleCase(value) {
    return String(value || '').replace(/\b\w/g, function (c) { return c.toUpperCase(); });
  }

  // Region shorthands: a region name means the whole cluster of hubs, not
  // one city — so "Delhi NCR" pulls leads from across the capital region.
  var REGION_ALIASES = [
    [/\bdelhi[\s-]*ncr\b|\bncr\b|national capital region/i,
      ['Delhi', 'Noida', 'Greater Noida', 'Ghaziabad', 'Meerut', 'Loni', 'Gurugram', 'Faridabad', 'Manesar', 'Sonipat', 'Bahadurgarh', 'Panipat']],
    [/\bmmr\b|mumbai metropolitan/i,
      ['Mumbai', 'Navi Mumbai', 'Thane']],
    [/\btricity\b/i,
      ['Chandigarh', 'Mohali', 'Panchkula']]
  ];

  function extractCities(text) {
    var lower = normalise(text);
    // Whole words only ("colonies" is not Loni), longest alias first, and a
    // matched span is blanked so "noida extension" does not also give Noida.
    var rest = ' ' + lower + ' ';
    var found = [];
    // Consume precise areas BEFORE their parent city. A city token inside
    // "East Delhi" or "Sector 62 Noida" must never widen the request.
    var qualified = [];
    var direction = /\b((?:north[\s-]+east|north[\s-]+west|south[\s-]+east|south[\s-]+west|north|south|east|west|central)[\s-]+(?:new\s+)?[a-z]+)\b/gi;
    var dm;
    while ((dm = direction.exec(lower))) {
      if (CITY_ALIASES.some(function (p) { return dm[1].endsWith(' ' + p[0]); })) qualified.push(dm[1]);
    }
    var clauses = /\b(?:in|at|near|from)\s+(.+?)(?=\s+(?:with|for|who|that|having|ki|ka|ke|mein|me|leads?|data|chahiye|chahie)\b|[.!?;]|$)|(?:^|[,.!?;]|\b(?:mujhe|hume|humko|find|get|search|nikalo|lao)\s+)([a-z0-9][a-z0-9\s,-]{1,70}?)\s+(?:ki|ka|ke|mein|me)\b/gi;
    var cm;
    while ((cm = clauses.exec(lower))) {
      var phrase = (cm[1] || cm[2] || '').trim().replace(/^(?:(?:mujhe|hume|humko|find|get|search|nikalo|lao|please)\s+)+/i, '').replace(/^(?:\d+\s+)?(?:leads?|companies|hotels?|hospitals?|data)\s+(?:in\s+)?/i, '').trim();
      var states = global.IndiaLocations?.states || [];
      var parts = phrase.split(',').map(function (v) { return v.trim(); });
      var paired = parts.length === 2 && states.some(function (s) { return normalise(s.name) === parts[1] && s.cities.some(function (c) { return normalise(c) === parts[0]; }); });
      if (paired || states.some(function (s) { return normalise(s.name) === phrase; })) { qualified.push(phrase); continue; }
      phrase.split(/\s+(?:aur|and)\s+|,/).forEach(function (part) {
        part = part.trim();
        if (part && /[a-z]/.test(part) && part.split(/\s+/).length <= 6 && !/\b(leads?|companies|hotels?|hospitals?|chahiye|chahie|nikalo|please|number|email|ncr|mmr|tricity)\b/.test(part)) qualified.push(part);
      });
    }
    qualified.sort(function (a, b) { return b.length - a.length; }).forEach(function (phrase) {
      // A standalone known name is handled by the alias pass below.
      if (CITY_ALIASES.some(function (p) { return p[0] === phrase; })) return;
      var escaped = phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      var re = new RegExp('(^|[^a-z0-9])' + escaped + '(?=[^a-z0-9]|$)', 'g');
      var at = rest.search(re);
      if (at !== -1) {
        found.push([at, titleCase(phrase)]);
        rest = rest.replace(re, function (m, pre) { return pre + ' '.repeat(m.length - pre.length); });
      }
    });
    var india = (global.IndiaLocations?.states || []).flatMap(function (s) { return [[s.name.toLowerCase(), s.name]].concat(s.cities.map(function (c) { return [c.toLowerCase(), c]; })); });
    CITY_ALIASES.concat(india).sort(function (a, b) { return b[0].length - a[0].length; }).forEach(function (pair) {
      var re = new RegExp('(^|[^a-z])' + pair[0].replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/ /g, '\\s+') + '(?=[^a-z]|$)', 'g');
      var at = rest.search(re);
      if (at !== -1) {
        found.push([at, pair[1]]);
        rest = rest.replace(re, function (m, pre) { return pre + ' '.repeat(m.length - pre.length); });
      }
    });
    found = found.sort(function (a, b) { return a[0] - b[0]; }).map(function (x) { return x[1]; });   // his order

    // Expand any region shorthand to its member hubs, so "koi bhi 10 leads
    // Delhi NCR ki" searches across the whole region's areas, not just Delhi.
    REGION_ALIASES.forEach(function (pair) {
      if (pair[0].test(lower)) pair[1].forEach(function (c) { found.push(c); });
    });

    // Fuzzy matching fallback for typos not explicitly aliased
    var words = found.length ? [] : rest.replace(/[^a-z\s]/g, ' ').split(/\s+/).filter(function (w) { return w.length >= 4 && !/^(find|need|data|lead|leads|from|with|near|more|first|best|mail|email|phone|number|count|please)$/.test(w); });
    words.forEach(function (word) {
      KNOWN_CITIES.forEach(function (city) {
        var cLower = city.toLowerCase();
        // dist <= 1 only. At 2, "shimla" matched "Shamli" and "udaipur"
        // matched "Jaipur" — a real request answered for a different town.
        if (Math.abs(word.length - cLower.length) <= 1) {
          if (levenshtein(word, cLower) <= 1) found.push(city);
        }
      });
    });

    // Generic fallback — the alias list can never be exhaustive for every
    // Indian town. When nothing above matched, look for a location marker
    // (Hindi postposition or an English preposition) next to a plausible
    // place name and trust the user's own word for it, instead of quietly
    // substituting a default city that was never asked for.
    if (!found.length) {
      var stopWord = /^(lead|leads|company|companies|client|clients|prospect|prospects|candidate|candidates|data|chahiye|chahie|nikalo|nikaal|dhundho|do|dedo|mujhe|hume|humko|please|plz|record|records|number|numbers|contact|contacts|se|ka|ki|ke|mein|me|mai|in|at|near|from|the|a|an)$/i;
      var markerRe = /\b([a-z][a-z\s]{1,24}?)\s+(?:ka|ki|ke|mein|me|mai|se)\b|\b(?:in|at|near|from)\s+([a-z][a-z\s]{1,24}?)(?=[\s,.!?]|$)/gi;
      var mm;
      while ((mm = markerRe.exec(lower)) !== null) {
        var phrase = (mm[1] || mm[2] || '').trim();
        var wordsInPhrase = phrase.split(/\s+/).filter(function (w) { return w && !stopWord.test(w); });
        if (wordsInPhrase.length) {
          var candidateCity = titleCase(wordsInPhrase.slice(-2).join(' '));
          if (candidateCity.length >= 3) found.push(candidateCity);
        }
      }
    }

    return unique(found);
  }

  function extractRoles(text) {
    var lower = normalise(text);
    var roles = [];
    ROLE_ALIASES.forEach(function (pair) {
      if (new RegExp('(?:^|\\s|,|/|-)(?:' + pair[0] + ')(?:$|\\s|,|/|-)', 'i').test(lower)) roles.push(pair[1]);
    });

    /* Preserve an explicit free-form role such as "solar technicians" or
       "security supervisors". The result is a search term, never a claim. */
    var free = lower.match(/(?:find|get|search|source|for|need|needs|requirement(?:s)?|staff|manpower|role)\s+(?:me\s+)?(?:of\s+)?([a-z][a-z0-9 &\/-]{2,42}?)(?=\s+(?:in|at|near|from|for)\b|$)/i);
    if (free && free[1]) {
      var candidate = free[1].replace(/\b(leads?|companies|candidates?)\b/ig, '').trim();
      var parts = candidate.split(/\s+and\s+|,|\/|\+/);
      parts.forEach(function (part) {
        var p = part.trim();
        if (p && !/\b(area|city|location|this|these|those)\b/i.test(p)
          && !/^(all|any|some|more|new|relevant|me)$/i.test(p)) {
          // If part matched an alias already, don't duplicate
          var matchedAlias = false;
          ROLE_ALIASES.forEach(function (pair) {
            if (new RegExp('(?:^|\\s|,|/|-)(?:' + pair[0] + ')(?:$|\\s|,|/|-)', 'i').test(p)) {
              matchedAlias = true;
              roles.push(pair[1]);
            }
          });
          if (!matchedAlias) roles.push(titleCase(p));
        }
      });
    }
    return unique(roles);
  }

  function extractIndustries(text, catalog) {
    var lower = normalise(text);
    var found = [];
    (Array.isArray(catalog) ? catalog : []).forEach(function (name) {
      var n = normalise(name);
      if (n && new RegExp('\\b' + n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b', 'i').test(lower)) found.push(name);
    });
    var aliases = {
      hotel: 'Hotels & Hospitality', hospitality: 'Hotels & Hospitality', resort: 'Hotels & Hospitality',
      hospital: 'Hospitals & Healthcare', healthcare: 'Hospitals & Healthcare', clinic: 'Hospitals & Healthcare',
      medical: 'Hospitals & Healthcare', school: 'Schools & Universities', college: 'Schools & Universities',
      university: 'Schools & Universities', institute: 'Schools & Universities', education: 'Schools & Universities',
      mall: 'Malls & Retail Chains', retail: 'Malls & Retail Chains', shopping: 'Malls & Retail Chains',
      factory: 'Factories & Manufacturing', manufacturing: 'Factories & Manufacturing', plant: 'Factories & Manufacturing',
      industry: 'Factories & Manufacturing', industrial: 'Factories & Manufacturing',
      warehouse: 'Warehouses & Logistics', logistics: 'Warehouses & Logistics', transport: 'Warehouses & Logistics',
      ecommerce: 'Warehouses & Logistics', bank: 'Banks & Corporate Offices', office: 'Banks & Corporate Offices',
      corporate: 'Banks & Corporate Offices', it: 'Corporate IT Parks & Tech Hubs', tech: 'Corporate IT Parks & Tech Hubs',
      software: 'Corporate IT Parks & Tech Hubs', bpo: 'Corporate IT Parks & Tech Hubs',
      airport: 'Airports & Aviation', aviation: 'Airports & Aviation', builder: 'Real Estate & Housing',
      construction: 'Real Estate & Housing', society: 'Residential Societies', apartment: 'Residential Societies',
      restaurant: 'Restaurants & Food Service', food: 'Restaurants & Food Service', cafe: 'Restaurants & Food Service'
    };
    Object.keys(aliases).forEach(function (key) {
      var re = new RegExp('\\b' + key + '(?:s|es)?\\b', 'i');
      if (re.test(lower)) found.push(aliases[key]);
    });
    return unique(found);
  }

  function extractCount(text, fallback) {
    var match = normalise(text).match(/\b(\d{1,4})\s*(?:\+\s*)?(?:leads?|prospects?|companies|clients?|candidates?|records?|people|persons?)\b/)
      || normalise(text).replace(/\b(?:sector|phase|block|pin|pincode)\s*[-:]?\s*\d+\b/g, '').match(/\b(\d{1,4})\b/);
    var raw = match ? parseInt(match[1], 10) : parseInt(fallback, 10);
    return Math.max(1, Math.min(100, Number.isFinite(raw) ? raw : 20));
  }

  function parse(text, options) {
    var opts = options || {};
    var source = String(text || '').trim();
    var industries = extractIndustries(source, opts.industries || global.IndustryDB?.getNames?.() || []);
    var roles = extractRoles(source);
    var cityList = extractCities(source);
    var defaults = global.AgentCtrl?.getDefaults?.();
    var hasIndustryTarget = industries.length > 0;
    var hasLeadTarget = LEAD_TARGET_CUES.test(source) || hasIndustryTarget;
    var hasLeadAction = LEAD_ACTION_CUES.test(source);
    var isCandidate = (CANDIDATE_CUES.test(source) || (roles.length > 0 && /\b(chahiye|chahie|need|require|hiring|bhejo|lao)\b/i.test(source) && !hasLeadTarget)) && !/\bleads?\b/i.test(source);
    var isExplicitLead = hasLeadTarget && (hasLeadAction || /\b(\d+\s*(?:leads?|companies|clients?|[a-z]+))\b/i.test(source));
    var isLead = !isCandidate && (isExplicitLead || (hasLeadTarget && /\b(mujhe|hume|humko|give|send|provide)\b/i.test(source)) || (hasLeadTarget && cityList.length > 0 && (hasLeadAction || hasIndustryTarget)));
    if (!isCandidate && cityList.length && /\bdata\b/i.test(source) && hasLeadAction && !ABOUT_EXISTING_RE.test(source)) isLead = true;
    // "Gurgaon ki leads", "gurugram leads", "delhi ki leads dikhao": the word
    // "leads" plus a named city IS the request — it used to fall through to
    // the AI, which asked him for "more details".
    if (!isCandidate && !isLead && /\bleads?\b/i.test(source) && cityList.length > 0
        && source.split(/\s+/).length <= 8 && !/\b(saved|purani|puraani|existing|database|stats?|export|download|delete|count|kitni|kitne)\b/i.test(source)) {
      isLead = true;
    }
    // "leads chahiye", "aur leads", "mujhe leads do" — the word "leads" with
    // no city is still a search; the default city covers it. Only a question
    // about leads he ALREADY has stays out. He should never have to explain
    // the same request twice.
    if (!isCandidate && !isLead && /\b(leads?|prospects?|buyers?)\b/i.test(source)
        && !ABOUT_EXISTING_RE.test(source)) {
      isLead = true;
    }
    if (global.ClavisRequestIntent?.classify(source).answerOnly) { isCandidate = false; isLead = false; }
    var workstream = isCandidate ? 'candidates' : (isLead ? 'leads' : 'general');

    return {
      workstream: workstream,
      isSearch: !global.ClavisRequestIntent?.classify(source).answerOnly && (isCandidate || isLead || (hasLeadTarget && GENERIC_REQUIREMENT_CUES.test(source))),
      cities: cityList.length ? cityList : expandLocations(opts.defaultCity ? [opts.defaultCity] : defaults?.locations || ['Delhi NCR']),
      // True only when the parser actually matched a city name in the text.
      // Callers use this to decide whether the fallback default is trustworthy
      // or worth double-checking with the LLM before it's shown to the user.
      citiesExplicit: cityList.length > 0,
      industries: industries.length ? industries : (/\b(?:all|every)\s+industr(?:y|ies)\b|sab(?:hi)?\s+industr/i.test(source) ? ['ALL'] : defaults?.industries || ['ALL']),
      // Unspecified service type on a lead search defaults to this app's own
      // business — security/housekeeping/manpower-vendor targets — rather
      // than a placeholder string the job-title generator can't use. The
      // user names this explicitly and shouldn't have to repeat it per ask.
      serviceTypes: roles.length ? roles : (isLead ? ['Security', 'Housekeeping', 'Pantry Boy'] : []),
      roles: roles,
      count: extractCount(source, opts.count),
      sources: ['google_maps', 'google_search', 'official_website'],
      query: source
    };
  }

  /** Every spelling that means this city, canonical first. real-scraper.js
   *  matches a scraped address against ALL of them — Maps writes
   *  "Gurugram" where he said "Gurgaon", and that one mismatch used to
   *  throw away every lead in the run. */
  function aliasesFor(city) {
    var canon = String(city || '').trim();
    if (!canon) return [];
    var lower = canon.toLowerCase();
    var out = [canon];
    CITY_ALIASES.forEach(function (pair) {
      if (pair[1].toLowerCase() !== lower && pair[0] !== lower) return;
      if (out.indexOf(pair[0]) === -1) out.push(pair[0]);
      if (out.indexOf(pair[1]) === -1) out.push(pair[1]);
    });
    return out;
  }

  global.LeadCandidateDomain = {
    parseRequest: parse, extractCities: extractCities, extractRoles: extractRoles,
    expandLocations: expandLocations,
    aliasesFor: aliasesFor,
    aboutExisting: function (t) { return ABOUT_EXISTING_RE.test(String(t || '')); }
  };
  function expandLocations(locations) {
    return unique((locations || []).flatMap(function (name) {
      var region = REGION_ALIASES.find(function (entry) { return entry[0].test(String(name)); });
      return region ? region[1] : [String(name).trim()];
    }).filter(Boolean));
  }
})(window);
