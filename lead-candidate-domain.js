/*
 * Clavis lead/candidate request planning.
 *
 * This is intentionally a small, deterministic boundary between the chat
 * language and the sourcing engines. It keeps the product open-ended: a
 * service role is data, not a hard-coded enum, and an omitted industry means
 * "all relevant industries" rather than the old security-only default.
 */
(function (global) {
  'use strict';

  var CITY_ALIASES = [
    ['new delhi', 'New Delhi'], ['greater noida', 'Greater Noida'], ['gr noida', 'Greater Noida'],
    ['gurugram', 'Gurugram'], ['gurgaon', 'Gurgaon'], ['gurgao', 'Gurgaon'], ['gurgoan', 'Gurgaon'],
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
    'Ghaziabad', 'Noida', 'Greater Noida', 'Delhi', 'New Delhi', 'Gurgaon', 'Gurugram',
    'Faridabad', 'Meerut', 'Mumbai', 'Bengaluru', 'Hyderabad', 'Chennai', 'Pune',
    'Kolkata', 'Ahmedabad', 'Jaipur', 'Lucknow', 'Chandigarh', 'Manesar', 'Sonipat',
    'Loni', 'Muradnagar', 'Modinagar', 'Khurja', 'Pilkhuwa', 'Hapur', 'Bulandshahr',
    'Muzaffarnagar', 'Shamli', 'Baghpat', 'Dadri', 'Bahadurgarh', 'Jhajjar', 'Rewari',
    'Palwal', 'Nuh', 'Alwar', 'Bharatpur', 'Dharuhera', 'Bawal', 'Karnal', 'Bhiwani', 'Jind'
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
      ['Delhi', 'New Delhi', 'Gurugram', 'Noida', 'Greater Noida', 'Ghaziabad', 'Faridabad']],
    [/\bmmr\b|mumbai metropolitan/i,
      ['Mumbai', 'Navi Mumbai', 'Thane']],
    [/\btricity\b/i,
      ['Chandigarh', 'Mohali', 'Panchkula']]
  ];

  function extractCities(text) {
    var lower = normalise(text);
    var found = CITY_ALIASES.filter(function (pair) { return lower.indexOf(pair[0]) !== -1; })
      .sort(function (a, b) { return b[0].length - a[0].length; })
      .map(function (pair) { return pair[1]; });

    // Expand any region shorthand to its member hubs, so "koi bhi 10 leads
    // Delhi NCR ki" searches across the whole region's areas, not just Delhi.
    REGION_ALIASES.forEach(function (pair) {
      if (pair[0].test(lower)) pair[1].forEach(function (c) { found.push(c); });
    });

    // Fuzzy matching fallback for typos not explicitly aliased
    var words = lower.replace(/[^a-z\s]/g, ' ').split(/\s+/).filter(function (w) { return w.length >= 4; });
    words.forEach(function (word) {
      KNOWN_CITIES.forEach(function (city) {
        var cLower = city.toLowerCase();
        if (Math.abs(word.length - cLower.length) <= 2) {
          var dist = levenshtein(word, cLower);
          if (dist <= 2 && dist < word.length / 2) {
            found.push(city);
          }
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
      || normalise(text).match(/\b(\d{1,4})\b/);
    var raw = match ? parseInt(match[1], 10) : parseInt(fallback, 10);
    return Math.max(1, Math.min(100, Number.isFinite(raw) ? raw : 20));
  }

  function parse(text, options) {
    var opts = options || {};
    var source = String(text || '').trim();
    var industries = extractIndustries(source, opts.industries || global.IndustryDB?.getNames?.() || []);
    var roles = extractRoles(source);
    var cityList = extractCities(source);
    var hasIndustryTarget = industries.length > 0;
    var hasLeadTarget = LEAD_TARGET_CUES.test(source) || hasIndustryTarget;
    var hasLeadAction = LEAD_ACTION_CUES.test(source);
    var isCandidate = (CANDIDATE_CUES.test(source) || (roles.length > 0 && /\b(chahiye|chahie|need|require|hiring|bhejo|lao)\b/i.test(source) && !hasLeadTarget)) && !/\bleads?\b/i.test(source);
    var isExplicitLead = hasLeadTarget && (hasLeadAction || /\b(\d+\s*(?:leads?|companies|clients?|[a-z]+))\b/i.test(source));
    var isLead = !isCandidate && (isExplicitLead || (hasLeadTarget && /\b(mujhe|hume|humko|give|send|provide)\b/i.test(source)) || (hasLeadTarget && cityList.length > 0 && (hasLeadAction || hasIndustryTarget)));
    var workstream = isCandidate ? 'candidates' : (isLead ? 'leads' : 'general');

    return {
      workstream: workstream,
      isSearch: isCandidate || isLead || (hasLeadTarget && GENERIC_REQUIREMENT_CUES.test(source)),
      cities: cityList.length ? cityList : [opts.defaultCity || global.SKYLARK_CONFIG?.DEFAULT_CITY || 'Gurugram'],
      // True only when the parser actually matched a city name in the text.
      // Callers use this to decide whether the fallback default is trustworthy
      // or worth double-checking with the LLM before it's shown to the user.
      citiesExplicit: cityList.length > 0,
      industries: industries.length ? industries : ['ALL'],
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

  global.LeadCandidateDomain = { parseRequest: parse, extractCities: extractCities, extractRoles: extractRoles };
})(window);
