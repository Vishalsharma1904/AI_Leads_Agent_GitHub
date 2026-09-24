/**
 * candidate-actors.js
 * ─────────────────────────────────────────────────────────────
 * Real candidate / job-market sourcing for the Candidate AI page.
 *
 * This module calls REAL Apify actors and returns REAL data only. There is no
 * seeded, mocked or fabricated candidate anywhere in this file. If an actor
 * fails (bad key, no plan credit, rate limit) the failure is reported honestly
 * and the other sources still return their real results.
 *
 * IMPORTANT — what these actors actually return:
 *   Naukri, WorkIndia, Shine and Apna are JOB-LISTING portals. The actors below
 *   extract PUBLIC job postings (company, role, salary, location, skills, and —
 *   where the employer publishes it — a walk-in HR contact number). They do NOT
 *   scrape private job-seeker resume databases, which sit behind paid recruiter
 *   logins and cannot be accessed without violating those portals' terms.
 *
 *   For a staffing agency this job-market data is still directly useful: each
 *   record is a company that is actively hiring (a potential client) and many
 *   blue/grey-collar listings expose a walk-in HR phone number.
 *
 * The browser calls the authenticated candidate-job backend. Apify credentials
 * stay in the backend vault and are never resolved from localStorage here.
 * ─────────────────────────────────────────────────────────────
 */
'use strict';

(function CandidateSourcingModule() {

  // ── Actor registry ──────────────────────────────────────────
  // Each actor: an Apify id (numeric id or `username~actor-name`), a label, an
  // input builder matching that actor's real input schema, and a normaliser that
  // maps its real output fields into one common record shape.
  const ACTORS = {
    naukri: {
      id: 'xYOP3UjaS8w38IWM7',            // blackfalcondata/naukri-jobs-feed
      label: 'Naukri',
      buildInput(role, city, limit) {
        const input = { keyword: role, maxResults: limit, fetchDetails: true, postedBy: 'Company' };
        if (city) input.location = city;
        return input;
      },
      normalize(it, role, city) {
        const walk = it.walkInDetail || it.walkinDetail || {};
        return {
          role: it.title || role,
          company: it.companyName || '',
          city: it.location || city,
          experience: it.experienceText || '',
          salary: cleanSalary(it.salary),
          skills: cleanSkills(it.skills),
          url: it.portalUrl || it.companyApplyUrl || '',
          description: it.description || it.descriptionMarkdown || '',
          phone: firstValue(walk.hrPhone, walk.phone, walk.contactNumber, walk.hrContactNumber, it.phone),
          email: it.email || '',
          posted: it.createdDate || ''
        };
      }
    },

    workindia: {
      id: '23KtodpG4T4RFCLe4',            // shahidirfan/workindia-jobs-scraper
      label: 'WorkIndia',
      buildInput(role, city, limit) {
        return {
          keyword: role,
          city: city || 'india',
          results_wanted: limit,
          max_pages: 10,
          includeDetails: true
        };
      },
      normalize(it, role, city) {
        return {
          role: it.profile_job_title || role,
          company: it.branch_company_name || '',
          city: it.branch_location_city_name || city,
          area: it.branch_location_name || '',
          experience: it.job_experience || '',
          salary: cleanSalary(it.profile_salary_structure),
          qualification: it.profile_qualification_required || '',
          skills: it.profile_industry_display_name ? [it.profile_industry_display_name] : [],
          employmentType: it.employment_type || '',
          url: it.source_url || '',
          description: it.job_description || '',
          phone: firstValue(it.contact_number, it.phone, it.hr_phone),
          posted: it.created_at || ''
        };
      }
    },

    shine: {
      id: 'nkFTTcWfTpWK1mj9f',            // Shine.com scraper (user-provided actor)
      label: 'Shine',
      buildInput(role, city, limit) {
        const input = { keyword: role, maxResults: limit };
        if (city) input.location = city;
        return input;
      },
      normalize(it, role, city) {
        return {
          role: it.title || it.jobTitle || it.job_title || role,
          company: it.companyName || it.company || it.company_name || '',
          city: it.location || it.city || city,
          experience: it.experienceText || it.experience || '',
          salary: cleanSalary(it.salary || it.salaryText),
          skills: cleanSkills(it.skills),
          url: it.portalUrl || it.url || it.applyUrl || it.jobUrl || '',
          description: it.description || '',
          phone: firstValue(it.phone, it.contactNumber, it.recruiterPhone),
          email: it.email || '',
          posted: it.createdDate || it.postedDate || ''
        };
      }
    },

    apna: {
      id: 'shahidirfan~apna-co-jobs-scraper',  // Apna.co job scraper
      label: 'Apna',
      buildInput(role, city, limit) {
        return {
          keyword: role,
          city: city || 'india',
          results_wanted: limit,
          max_pages: 10
        };
      },
      normalize(it, role, city) {
        return {
          role: it.title || it.job_title || it.profile_job_title || role,
          company: it.company || it.company_name || it.branch_company_name || it.companyName || '',
          city: it.city || it.location || it.branch_location_city_name || city,
          salary: cleanSalary(it.salary || it.salary_text || it.profile_salary_structure),
          experience: it.experience || it.job_experience || '',
          skills: cleanSkills(it.tags || it.skills),
          employmentType: it.job_type || it.employment_type || '',
          url: it.url || it.job_url || it.source_url || it.link || '',
          description: it.description || '',
          phone: firstValue(it.hr_phone, it.contact_number, it.phone, it.recruiter_phone),
          posted: it.posted || it.created_at || ''
        };
      }
    }
  };

  const SOURCE_ORDER = ['naukri', 'workindia', 'shine', 'apna'];

  // ── Small helpers ────────────────────────────────────────────
  function firstValue(...vals) {
    for (const v of vals) {
      if (v === 0) continue;
      if (v !== undefined && v !== null && String(v).trim() !== '') return String(v).trim();
    }
    return '';
  }

  function cleanSalary(s) {
    if (!s) return '';
    const t = String(s).trim();
    return /not disclosed|not mentioned|^na$/i.test(t) ? '' : t;
  }

  function cleanSkills(skills) {
    if (!skills) return [];
    const arr = Array.isArray(skills) ? skills : String(skills).split(/[,;/]/);
    return arr
      .map(s => String(s).trim())
      .filter(s => s && !/more items$/i.test(s))
      .slice(0, 8);
  }

  const PHONE_RE = /(?:(?:\+|0{0,2})91[\s\-]?)?[6789]\d{9}/;
  const EMAIL_RE = /([a-zA-Z0-9._-]+@[a-zA-Z0-9._-]+\.[a-zA-Z0-9_-]+)/;

  function extractContact(rec, raw) {
    // Prefer contact fields the actor already gave us; fall back to a regex scan
    // of the full record so a published walk-in number is never missed.
    let phone = rec.phone || '';
    let email = rec.email || '';
    if (!phone || !email) {
      let blob = '';
      try { blob = JSON.stringify(raw); } catch (e) { blob = String(rec.description || ''); }
      if (!phone) { const m = blob.match(PHONE_RE); if (m) phone = m[0]; }
      if (!email) { const m = blob.match(EMAIL_RE); if (m) email = m[0]; }
    }
    return { phone, email };
  }

  function humanizeError(e) {
    const s = e && e.status;
    if (s === 401 || s === 403) return 'Apify key not authorised for this actor.';
    if (s === 402) return 'Apify plan / credit limit reached for this actor.';
    if (s === 404) return 'Actor not found or not accessible on this account.';
    if (s === 429) return 'Apify rate limit hit — try again shortly.';
    if (s === 400) return 'Actor rejected the search input.';
    if (e && e.name === 'AbortError') return 'Timed out waiting for results.';
    return (e && e.message) ? e.message : 'Unknown error.';
  }

  function finalizeRecord(actor, raw, role, city) {
    let rec;
    try {
      rec = actor.normalize(raw, role, city) || {};
    } catch (e) {
      rec = {};
    }
    const contact = extractContact(rec, raw);
    const company = rec.company || '';
    const jobRole = rec.role || role || 'Role';
    const displayName = company ? `${jobRole} — ${company}` : jobRole;

    const record = {
      id: 'cand_' + Date.now().toString(36) + Math.floor(Math.random() * 1e6).toString(36),
      name: displayName,
      role: jobRole,
      company,
      experience: rec.experience || '',
      city: rec.city || city || '',
      area: rec.area || '',
      phone: contact.phone || '',
      email: contact.email || '',
      skills: Array.isArray(rec.skills) ? rec.skills : [],
      salary: rec.salary || '',
      qualification: rec.qualification || '',
      employmentType: rec.employmentType || '',
      status: 'New',
      url: rec.url || '',
      description: rec.description || '',
      source: actor.label,
      posted: rec.posted || '',
      timestamp: Date.now()
    };

    if (window.DataSanitizer && typeof window.DataSanitizer.sanitizeCandidate === 'function') {
      const cleaned = window.DataSanitizer.sanitizeCandidate(record);
      if (cleaned) return cleaned;
    }
    return record;
  }

  function dedupe(records) {
    const seen = new Set();
    const out = [];
    for (const r of records) {
      const key = (r.url && r.url.trim()) ||
                  ((r.role || '') + '|' + (r.company || '') + '|' + (r.city || '')).toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(r);
    }
    return out;
  }

  // ── Authenticated backend candidate job ─────────────────────
  async function scrape(opts) {
    const role = (opts.role || '').trim();
    const city = (opts.city || '').trim();
    const quantity = Math.max(1, Math.min(200, opts.quantity || 20));
    const onProgress = typeof opts.onProgress === 'function' ? opts.onProgress : () => {};
    let selected = (opts.sources && opts.sources.length ? opts.sources : SOURCE_ORDER)
      .filter(s => ACTORS[s]);
    if (!selected.length) selected = SOURCE_ORDER.slice();

    const accessToken = window.SupabaseAuth?.getAccessToken?.() || '';
    if (!accessToken) {
      const err = new Error('Sign in before sourcing candidate records.');
      err.code = 'AUTH_REQUIRED';
      throw err;
    }

    const apiBase = `${window.SKYLARK_CONFIG?.BACKEND_URL || 'http://localhost:8000'}/api/v1`;
    const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` };
    const response = await fetch(`${apiBase}/candidate-jobs`, {
      method: 'POST',
      headers: { ...headers, 'Idempotency-Key': `candidate-${Date.now()}-${Math.random().toString(36).slice(2)}` },
      body: JSON.stringify({ role, city, quantity, sources: selected })
    });
    const created = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(created.detail || 'Candidate job could not be created');
      error.code = response.status === 401 ? 'AUTH_REQUIRED' : 'CANDIDATE_JOB_FAILED';
      throw error;
    }
    const jobId = created.job?.id;
    if (!jobId) throw new Error('Candidate service returned no job ID');

    onProgress('Candidate job queued…', []);
    for (let attempt = 0; attempt < 180; attempt++) {
      await new Promise(resolve => setTimeout(resolve, 1000));
      const statusResponse = await fetch(`${apiBase}/candidate-jobs/${encodeURIComponent(jobId)}`, { headers });
      const status = await statusResponse.json().catch(() => ({}));
      if (!statusResponse.ok) throw new Error(status.detail || 'Candidate job status could not be read');
      const state = status.job?.status;
      onProgress(state === 'running' ? 'Reading public job sources…' : `Candidate job ${state || 'updating'}…`, []);
      if (state === 'completed' || state === 'partial') {
        const raw = Array.isArray(status.records) ? status.records : [];
        const records = dedupe(raw.map(item => {
          const actor = ACTORS[item.source_key] || { label: item.source || 'Public listing', normalize: value => value };
          return actor.normalize ? finalizeRecord(actor, item, role, city) : item;
        })).slice(0, quantity);
        const sourceErrors = status.job?.source_errors && typeof status.job.source_errors === 'object'
          ? status.job.source_errors
          : {};
        const report = selected.map(key => {
          const source = ACTORS[key]?.label || key;
          const error = sourceErrors[source] || '';
          return {
            source,
            ok: !error,
            count: records.filter(r => r.source === source).length,
            error
          };
        });
        return { records, report, requested: quantity };
      }
      if (state === 'failed') throw new Error(status.job?.error || 'Candidate provider failed');
    }
    throw new Error('Candidate job timed out while waiting for the provider');
  }

  // ── Lightweight, offline intent parser (no token cost) ───────
  // Extracts role, city and quantity from a natural-language request in
  // English/Hinglish. Used as the primary path so sourcing works with only an
  // Apify key (no LLM key required).
  const CITY_LIST = [
    'delhi', 'new delhi', 'ncr', 'gurgaon', 'gurugram', 'noida', 'ghaziabad', 'faridabad',
    'mumbai', 'navi mumbai', 'thane', 'pune', 'nagpur', 'nashik',
    'bengaluru', 'bangalore', 'mysore', 'hyderabad', 'secunderabad',
    'chennai', 'coimbatore', 'kolkata', 'ahmedabad', 'surat', 'vadodara', 'rajkot',
    'jaipur', 'jodhpur', 'lucknow', 'kanpur', 'varanasi', 'agra', 'meerut',
    'indore', 'bhopal', 'gwalior', 'chandigarh', 'ludhiana', 'amritsar', 'jalandhar',
    'patna', 'ranchi', 'raipur', 'bhubaneswar', 'guwahati', 'kochi', 'cochin',
    'thiruvananthapuram', 'trivandrum', 'visakhapatnam', 'vijayawada', 'goa', 'dehradun'
  ];
  const CITY_CANON = {
    bangalore: 'Bengaluru', bengaluru: 'Bengaluru', gurgaon: 'Gurugram', gurugram: 'Gurugram',
    'new delhi': 'Delhi', delhi: 'Delhi', ncr: 'Delhi', cochin: 'Kochi', kochi: 'Kochi',
    trivandrum: 'Thiruvananthapuram'
  };
  const STOP_WORDS = new Set([
    'mujhe', 'chahiye', 'chahie', 'chaie', 'ki', 'ka', 'ke', 'list', 'log', 'logo', 'logon',
    'candidate', 'candidates', 'profile', 'profiles', 'find', 'get', 'need', 'want', 'me',
    'mein', 'in', 'for', 'the', 'a', 'an', 'of', 'give', 'show', 'nikaal', 'nikal', 'do',
    'dedo', 'please', 'plz', 'and', 'jobs', 'job', 'walo', 'wale', 'wala', 'search', 'karo',
    'dhundo', 'dhundho', 'chaiye', 'people', 'staff', 'hire', 'hiring', 'openings', 'vacancy',
    'vacancies', 'from', 'around', 'near', 'with', 'experience', 'exp', 'yrs', 'years', 'year'
  ]);

  function parseIntent(query) {
    const text = (query || '').trim();
    const lower = text.toLowerCase();

    // Quantity: first standalone number (capped later)
    let quantity = 20;
    const qtyMatch = lower.match(/\b(\d{1,3})\b/);
    if (qtyMatch) quantity = Math.max(1, Math.min(200, parseInt(qtyMatch[1], 10)));

    // City: longest matching known city name
    let city = '';
    let cityHit = '';
    for (const c of CITY_LIST) {
      const re = new RegExp('\\b' + c.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&') + '\\b', 'i');
      if (re.test(lower) && c.length > cityHit.length) cityHit = c;
    }
    if (cityHit) city = CITY_CANON[cityHit] || (cityHit.charAt(0).toUpperCase() + cityHit.slice(1));

    // Role: strip city, numbers and filler words → remaining tokens
    let roleSrc = lower;
    if (cityHit) roleSrc = roleSrc.replace(new RegExp('\\b' + cityHit + '\\b', 'gi'), ' ');
    roleSrc = roleSrc.replace(/\b\d{1,3}\b/g, ' ');
    const roleTokens = roleSrc
      .split(/[^a-z0-9+#.]+/i)
      .map(t => t.trim())
      .filter(t => t && !STOP_WORDS.has(t));
    const role = roleTokens.join(' ').replace(/\s+/g, ' ').trim();

    // Is this a search request or just conversation?
    const looksLikeSearch = Boolean(role) && (
      qtyMatch || cityHit ||
      /(develop|engineer|guard|security|housekeep|cleaner|driver|delivery|telecall|sales|nurse|electrician|plumber|technician|operator|manager|executive|accountant|receptionist|cook|helper|labour|worker|supervisor|admin|hr|marketing|designer|analyst|clerk|peon|welder|fitter|mechanic|carpenter|tailor|beautician|teacher|counsel)/i.test(lower)
    );

    return { role, city, quantity, isSearch: looksLikeSearch, raw: text };
  }

  // ── Public API ───────────────────────────────────────────────
  window.CandidateSourcing = {
    ACTORS,
    SOURCE_ORDER,
    scrape,
    parseIntent,
    labelFor: key => (ACTORS[key] ? ACTORS[key].label : key)
  };

})();
