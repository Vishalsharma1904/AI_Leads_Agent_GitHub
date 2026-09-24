/* ============================================================
 * clavis-task-model.js  ·  models/intent.ts + models/task.ts
 * ------------------------------------------------------------
 * Intent taxonomy, task/event/result shapes, and the hybrid
 * IntentClassifier.
 *
 * The classifier is deliberately NOT a keyword table. It scores
 * three independent evidence channels and combines them:
 *
 *   1. utterance  — lexical features (verb / object / structure),
 *                   language-agnostic enough for Hinglish
 *   2. activity   — which tools the engine actually started
 *   3. result     — what came back
 *
 * Later channels revise the earlier posterior, so a request that
 * looked like ANSWER becomes RESEARCH the moment the engine
 * fires its third web lookup. Confidence travels with the label
 * so the UI can stay vague while the guess is weak.
 * ============================================================ */
(function (global) {
  'use strict';

  /* ── Intents ─────────────────────────────────────────────── */
  var INTENT = {
    SEARCH: 'search',
    RESEARCH: 'research',
    WEB_BROWSE: 'web_browse',
    ANSWER: 'answer',
    SUMMARIZE: 'summarize',
    WRITE: 'write',
    REWRITE: 'rewrite',
    CODE: 'code',
    DEBUG: 'debug',
    CREATE_FILE: 'create_file',
    EDIT_FILE: 'edit_file',
    ANALYZE_FILE: 'analyze_file',
    COMPARE: 'compare',
    CALCULATE: 'calculate',
    AUTOMATION: 'automation',
    SYSTEM_ACTION: 'system_action',
    NAVIGATION: 'navigation',
    MEDIA: 'media',
    IMAGE_GENERATION: 'image_generation',
    DATA_EXTRACTION: 'data_extraction',
    /* ── The four this app is actually for ──────────────────────
       Everything above is generic assistant work. These are the
       jobs the user opens Clavis to do, so they get their own
       label, their own panel body, and their own evidence. */
    LEAD_GEN: 'lead_gen',
    CANDIDATE_GEN: 'candidate_gen',
    CONTACT_EXTRACT: 'contact_extract',
    OUTREACH: 'outreach',
    DATASET: 'dataset',
    UNKNOWN: 'unknown'
  };

  /* Which renderer each intent asks for, and what it needs on screen.
     `mode` is the only thing the UI layer switches on. */
  var PROFILE = {
    search:           { mode: 'search',   progress: true,  sources: true,  artifact: false },
    research:         { mode: 'research', progress: true,  sources: true,  artifact: false },
    web_browse:       { mode: 'search',   progress: true,  sources: true,  artifact: false },
    answer:           { mode: 'thinking', progress: false, sources: false, artifact: false },
    summarize:        { mode: 'writing',  progress: true,  sources: false, artifact: false },
    write:            { mode: 'writing',  progress: true,  sources: false, artifact: true  },
    rewrite:          { mode: 'writing',  progress: true,  sources: false, artifact: true  },
    code:             { mode: 'code',     progress: true,  sources: false, artifact: true  },
    debug:            { mode: 'code',     progress: true,  sources: false, artifact: false },
    create_file:      { mode: 'create',   progress: true,  sources: false, artifact: true  },
    edit_file:        { mode: 'create',   progress: true,  sources: false, artifact: true  },
    analyze_file:     { mode: 'file',     progress: true,  sources: false, artifact: true  },
    compare:          { mode: 'research', progress: true,  sources: true,  artifact: false },
    calculate:        { mode: 'calculate', progress: false, sources: false, artifact: false },
    automation:       { mode: 'system',   progress: true,  sources: false, artifact: false },
    system_action:    { mode: 'system',   progress: false, sources: false, artifact: false },
    navigation:       { mode: 'system',   progress: false, sources: false, artifact: false },
    media:            { mode: 'create',   progress: true,  sources: false, artifact: true  },
    image_generation: { mode: 'create',   progress: true,  sources: false, artifact: true  },
    data_extraction:  { mode: 'contacts', progress: true,  sources: true,  artifact: true  },
    lead_gen:         { mode: 'leads',    progress: true,  sources: true,  artifact: true  },
    candidate_gen:    { mode: 'dataset', progress: true,  sources: true,  artifact: true  },
    contact_extract:  { mode: 'contacts', progress: true,  sources: true,  artifact: true  },
    outreach:         { mode: 'outreach', progress: true,  sources: false, artifact: true  },
    dataset:          { mode: 'dataset',  progress: true,  sources: false, artifact: true  },
    unknown:          { mode: 'thinking', progress: false, sources: false, artifact: false }
  };

  /* Present-tense line shown while the task runs. Kept as a verb
     phrase so the title reads "Searching the web for X". */
  var GERUND = {
    search: 'Searching', research: 'Researching', web_browse: 'Browsing',
    answer: 'Thinking', summarize: 'Summarising', write: 'Drafting',
    rewrite: 'Rewriting', code: 'Editing', debug: 'Debugging',
    create_file: 'Creating', edit_file: 'Editing', analyze_file: 'Analysing',
    compare: 'Comparing', calculate: 'Calculating', automation: 'Running',
    system_action: 'Preparing action', navigation: 'Opening',
    media: 'Finding photos', image_generation: 'Generating',
    data_extraction: 'Extracting',
    lead_gen: 'Finding leads', candidate_gen: 'Finding candidates', contact_extract: 'Extracting contacts',
    outreach: 'Drafting outreach', dataset: 'Working the data',
    unknown: 'Thinking'
  };

  /* ── Lexical features ────────────────────────────────────────
     Three separate channels per intent. A verb alone is weak; a
     verb plus a matching object is what makes a confident label,
     which is why these are scored apart instead of as one bag. */
  var VERBS = {
    search:       ['search', 'find', 'look up', 'lookup', 'dhundo', 'dhoondo', 'khojo', 'search karo', 'nikalo'],
    research:     ['research', 'investigate', 'deep dive', 'study', 'explore', 'research karo', 'padho', 'jaanch'],
    web_browse:   ['open the site', 'visit', 'browse', 'go to', 'site kholo', 'website kholo'],
    answer:       ['what', 'why', 'how', 'when', 'who', 'which', 'explain', 'tell me', 'batao', 'bata', 'samjhao', 'kya', 'kyu', 'kaise', 'kaun', 'kab'],
    summarize:    ['summarize', 'summarise', 'tldr', 'recap', 'short karo', 'summary', 'saransh'],
    write:        ['write', 'draft', 'compose', 'likho', 'likh do', 'draft karo', 'banao email', 'script'],
    rewrite:      ['rewrite', 'rephrase', 'improve', 'polish', 'shorten', 'sudharo', 'dubara likho', 'better karo'],
    code:         ['code', 'implement', 'refactor', 'build a function', 'add a component', 'patch', 'wire up'],
    debug:        ['debug', 'fix the bug', 'why is it failing', 'error aa raha', 'crash', 'stack trace', 'thik karo'],
    create_file:  ['create a file', 'make a file', 'new file', 'generate a', 'export', 'file banao', 'sheet banao', 'deck banao'],
    edit_file:    ['edit the file', 'update the file', 'change the file', 'file me badlo', 'add a column', 'add a row'],
    analyze_file: ['analyze', 'analyse', 'review this file', 'read this', 'check this file', 'padh ke batao', 'analyse karo'],
    compare:      ['compare', 'versus', ' vs ', 'difference between', 'better than', 'antar', 'compare karo'],
    calculate:    ['calculate', 'compute', 'how much', 'total', 'sum of', 'percentage', 'hisaab', 'kitna hoga', 'jod'],
    automation:   ['automate', 'run the agent', 'schedule', 'every day', 'workflow', 'pipeline chalao', 'agent chalao'],
    system_action:['open', 'launch', 'screenshot', 'take a screenshot', 'kholo', 'chalu karo', 'chalao', 'save note', 'copy to'],
    navigation:   ['go to dashboard', 'show leads', 'open settings', 'switch to', 'dashboard kholo', 'page kholo'],
    media:        ['play', 'record', 'transcribe', 'video', 'audio', 'gaana'],
    image_generation: ['generate an image', 'draw', 'create an image', 'picture banao', 'image banao', 'logo banao'],
    data_extraction:  ['extract', 'scrape', 'pull the data', 'get emails', 'get phone numbers', 'nikaal ke do', 'data nikalo'],

    /* Hinglish carries the intent in the object, not the verb —
       "leads nikalo" and "leads chahiye" are the same request with
       different verbs, so the noun has to be able to win on its
       own. That is what the STRUCTURE rules below are for. */
    lead_gen:         ['generate leads', 'lead generation', 'find leads', 'get leads', 'leads nikalo', 'leads chahiye',
                       'leads do', 'leads laao', 'lead list', 'new leads', 'prospect', 'prospecting',
                       'companies dhundo', 'client dhundo', 'naye client', 'business dhundo'],
    candidate_gen:    ['find candidates', 'get candidates', 'source candidates', 'candidates chahiye', 'candidate nikalo',
                       'resume dhundo', 'talent source', 'hire candidates'],
    contact_extract:  ['get contact', 'get contacts', 'contact nikalo', 'contact details', 'phone number nikalo',
                       'email nikalo', 'number nikalo', 'extract emails', 'extract contacts', 'find the owner',
                       'decision maker', 'hr contact', 'contact nikaal'],
    outreach:         ['follow up', 'follow-up', 'cold email', 'cold call list', 'outreach', 'campaign',
                       'bulk message', 'broadcast', 'blast', 'drip', 'sequence', 'message bhejo', 'mail bhejo',
                       'whatsapp bhejo', 'pitch bhejo', 'reminder bhejo'],
    dataset:          ['clean the data', 'data clean', 'dedupe', 'deduplicate', 'duplicate hatao', 'duplicates hatao', 'merge sheets',
                       'combine sheets', 'pivot', 'group by', 'sort the', 'filter the', 'enrich the sheet',
                       'sheet update karo', 'column add karo', 'kitne leads', 'conversion rate', 'pipeline report']
  };

  var OBJECTS = {
    search:       ['best', 'top', 'cheapest', 'under', 'near me', 'price', 'reviews', 'options'],
    research:     ['market', 'industry', 'trends', 'report', 'landscape', 'competitors', 'policy'],
    web_browse:   ['http', 'www.', '.com', '.in', '.org', 'link', 'url'],
    answer:       ['meaning', 'definition', 'difference', 'reason'],
    summarize:    ['this thread', 'this chat', 'the document', 'the article', 'notes'],
    write:        ['email', 'message', 'whatsapp', 'post', 'proposal', 'spec', 'pitch', 'script', 'reply'],
    rewrite:      ['draft', 'this text', 'paragraph', 'copy'],
    code:         ['function', 'component', 'api', 'endpoint', 'css', 'javascript', 'python', 'query', 'schema'],
    debug:        ['error', 'exception', 'failing', 'broken', 'not working', 'undefined', 'null'],
    create_file:  ['excel', 'xlsx', 'csv', 'pdf', 'docx', 'presentation', 'deck', 'spreadsheet', 'document'],
    edit_file:    ['excel', 'xlsx', 'csv', 'sheet', 'column', 'row', 'cell'],
    analyze_file: ['pdf', 'xlsx', 'csv', 'docx', 'image', 'screenshot', 'report', 'invoice', 'statement'],
    compare:      ['plans', 'options', 'vendors', 'products', 'pricing'],
    calculate:    ['%', 'gst', 'salary', 'wage', 'margin', 'total', 'average'],
    automation:   ['leads', 'pipeline', 'agent', 'batch', 'daily', 'cron'],
    system_action:['notepad', 'chrome', 'settings', 'app', 'folder', 'clipboard', 'screen'],
    navigation:   ['dashboard', 'leads', 'candidates', 'analytics', 'settings', 'excel manager'],
    media:        ['song', 'video', 'audio', 'clip', 'recording', 'photos', 'photo', 'images', 'image', 'pictures', 'picture', 'tasveer', 'tasveerein'],
    image_generation: ['image', 'poster', 'logo', 'thumbnail', 'illustration'],
    data_extraction:  ['emails', 'phone numbers', 'contacts', 'table', 'list of', 'companies'],
    lead_gen:         ['leads', 'lead', 'prospects', 'clients', 'customers', 'companies', 'hotels', 'hospitals',
                       'schools', 'factories', 'builders', 'societies', 'verified', 'icp', 'pipeline'],
    candidate_gen:    ['candidate', 'candidates', 'resume', 'resumes', 'cv', 'talent', 'applicant', 'job seeker'],
    contact_extract:  ['email', 'emails', 'phone', 'phones', 'mobile', 'number', 'numbers', 'contact', 'contacts',
                       'owner', 'director', 'hr', 'procurement', 'whatsapp'],
    outreach:         ['email', 'whatsapp', 'message', 'sms', 'call script', 'template', 'subject line', 'reply',
                       'leads', 'clients', 'prospects'],
    dataset:          ['excel', 'xlsx', 'csv', 'sheet', 'rows', 'columns', 'records', 'data', 'report', 'dashboard']
  };

  /* Structural cues are the strongest signal we have without a
     model: they key off sentence shape, not vocabulary. */
  var STRUCTURE = [
    { re: /\b(photos?|images?|pictures?|tasveer(?:en|ein)?|pics?)\b/i, intent: INTENT.MEDIA,   w: 3.5 },
    { re: /\b(19\d{2}s?|20[0-2]\d\s*s?|[4-9]0'?s)\b/i,               intent: INTENT.SEARCH,  w: 1.8 },
    { re: /https?:\/\/\S+|\bwww\.\S+/i,                       intent: INTENT.WEB_BROWSE,   w: 3.0 },
    { re: /[\d.]+\s*[-+*/x×%]\s*[\d.]+|\b\d+\s*%\s*(of|ka)\b/i, intent: INTENT.CALCULATE,  w: 3.0 },
    { re: /\b[\w-]+\.(pdf|xlsx?|csv|docx?|pptx?|png|jpe?g|json|txt)\b/i, intent: INTENT.ANALYZE_FILE, w: 2.6 },
    { re: /\b(\w[\w\s]{0,24})\s+(vs\.?|versus)\s+(\w[\w\s]{0,24})\b/i,  intent: INTENT.COMPARE,      w: 2.8 },
    { re: /^\s*(what|why|how|when|who|which|kya|kyu|kyun|kaise|kab|kaun)\b/i, intent: INTENT.ANSWER, w: 1.5 },
    { re: /\?\s*$/,                                            intent: INTENT.ANSWER,       w: 0.8 },
    { re: /\b(under|below|less than)\s*(₹|rs\.?|inr)?\s*[\d,]+/i, intent: INTENT.SEARCH,     w: 2.0 },
    { re: /\b(best|top)\s+\d*\s*\w+/i,                         intent: INTENT.SEARCH,       w: 1.6 },

    /* ── The app's own shapes ───────────────────────────────────
       In Hinglish the verb is the weakest part of the sentence:
       "leads nikalo", "leads chahiye", "leads do" and "leads laao"
       are one request with four verbs. So the noun carries the
       weight here, and the verb only sharpens it. */
    { re: /\bleads?\b/i,                                       intent: INTENT.LEAD_GEN,        w: 2.4 },
    { re: /\b(leads?|prospects?|clients?|compan(?:y|ies))\b[\s\S]{0,18}?\b(list|nikal\w*|chahiye|laao|generate|banao|do|de\s*do)\b/i,
                                                               intent: INTENT.LEAD_GEN,        w: 3.4 },
    { re: /\b(candidates?|resumes?|cvs?|talent|applicants?)\b[\s\S]{0,24}?\b(find|source|nikal\w*|chahiye|laao|generate|do|de\s*do)\b/i,
                                                               intent: INTENT.CANDIDATE_GEN,   w: 3.4 },
    { re: /\b(\d{2,5})\s*\+?\s*(leads?|prospects?|compan(?:y|ies))\b/i, intent: INTENT.LEAD_GEN, w: 2.6 },
    { re: /\b(e-?mail|phone|mobile|contact|number)s?\b[\s\S]{0,20}?\b(nikal\w*|extract|scrape|pull|chahiye|de\s*do|nikaal\w*)\b/i,
                                                               intent: INTENT.CONTACT_EXTRACT, w: 3.2 },
    { re: /\b(decision\s*maker|owner\s*(ka|ke)?\s*(number|contact)|hr\s*contact)\b/i,
                                                               intent: INTENT.CONTACT_EXTRACT, w: 2.8 },
    { re: /\b(follow[\s-]?up|cold\s*(e-?mail|call)|outreach|campaign|broadcast|bulk\s*(message|e-?mail)|drip)\b/i,
                                                               intent: INTENT.OUTREACH,        w: 3.0 },
    /* Both orders: English puts the operation first ("dedupe the
       sheet"), Hinglish puts the object first ("sheet me se
       duplicates hatao"). One rule each, or half the requests in
       this app score zero. */
    { re: /\b(dedupe|deduplicate|duplicates?|pivot|merge|clean|sort|filter)\b[\s\S]{0,26}?\b(data|sheet|excel|csv|rows?|columns?|records?)\b/i,
                                                               intent: INTENT.DATASET,         w: 3.4 },
    { re: /\b(data|sheet|excel|csv|rows?|columns?|records?)\b[\s\S]{0,26}?\b(dedupe|deduplicate|duplicates?|pivot|merge|clean|sort|filter|hatao|hata\s*do)\b/i,
                                                               intent: INTENT.DATASET,         w: 3.4 },
    { re: /\b(kitne|kitni|how\s+many)\b[\s\S]{0,24}?\b(leads?|contacts?|rows?|clients?|records?|companies)\b/i,
                                                               intent: INTENT.DATASET,         w: 3.0 },
    { re: /\b(conversion|pipeline|funnel)\s*(rate|report|summary|analysis)\b/i, intent: INTENT.DATASET, w: 2.8 }
  ];

  /* Tool name fragments → what the engine is really doing. This is
     evidence channel 2, and it outranks the utterance because it is
     observed behaviour rather than a guess about wording. */
  var TOOL_HINTS = [
    { re: /search|serp|google|bing|duckduck/i,      intent: INTENT.SEARCH,          w: 2.2 },
    { re: /browse|fetch_url|open_page|crawl|scrape/i, intent: INTENT.DATA_EXTRACTION, w: 2.6 },
    { re: /research|multi_?search|deep/i,           intent: INTENT.RESEARCH,        w: 3.4 },
    { re: /excel|xlsx|sheet|csv/i,                  intent: INTENT.CREATE_FILE,     w: 2.8 },
    { re: /pdf|docx|document|report/i,              intent: INTENT.ANALYZE_FILE,    w: 2.6 },
    { re: /image|vision|screenshot|ocr/i,           intent: INTENT.ANALYZE_FILE,    w: 2.4 },
    { re: /lead|prospect|enrich/i,                   intent: INTENT.LEAD_GEN,        w: 3.0 },
    { re: /candidate|resume|cv|talent|applicant/i,   intent: INTENT.CANDIDATE_GEN,   w: 3.0 },
    { re: /contact|email_lookup|verify_email|phone|reverse_lookup/i, intent: INTENT.CONTACT_EXTRACT, w: 2.6 },
    { re: /campaign|outreach|sequence|send_mail|send_email|whatsapp_send/i, intent: INTENT.OUTREACH, w: 2.8 },
    { re: /dataframe|pivot|dedupe|sheet_update|rows?_/i, intent: INTENT.DATASET,     w: 2.6 },
    { re: /mail|smtp|whatsapp|send/i,               intent: INTENT.WRITE,           w: 2.0 },
    { re: /code|patch|diff|repo|file_write/i,       intent: INTENT.CODE,            w: 2.8 },
    { re: /open_app|launch|system|clipboard|note/i, intent: INTENT.SYSTEM_ACTION,   w: 3.0 }
  ];

  /* What a returned result implies, once we have one. */
  var RESULT_HINTS = {
    sources: INTENT.SEARCH, diff: INTENT.CODE, code: INTENT.CODE,
    file: INTENT.CREATE_FILE, table: INTENT.DATASET,
    image: INTENT.IMAGE_GENERATION, chart: INTENT.DATASET,
    markdown: INTENT.WRITE,
    leads: INTENT.LEAD_GEN, candidates: INTENT.CANDIDATE_GEN, contacts: INTENT.CONTACT_EXTRACT, outreach: INTENT.OUTREACH
  };

  function normalise(text) {
    return String(text || '')
      .toLowerCase()
      .replace(/[‘’]/g, "'")
      .replace(/\s+/g, ' ')
      .trim();
  }

  /* Longer phrases are worth more than single words: "fix the bug"
     should beat a stray "fix". Weight grows with token count. */
  function phraseScore(haystack, phrases, weight) {
    var total = 0;
    for (var i = 0; i < phrases.length; i++) {
      var p = phrases[i];
      if (haystack.indexOf(p) === -1) continue;
      total += weight * (1 + 0.35 * (p.split(' ').length - 1));
    }
    return total;
  }

  /* Turn raw scores into a confidence by comparing the winner with
     the runner-up. A landslide reads as certain; a near-tie doesn't,
     and the UI then stays on the neutral thinking surface. */
  function decide(scores) {
    var best = INTENT.UNKNOWN, bestScore = 0, second = 0;
    for (var k in scores) {
      if (!Object.prototype.hasOwnProperty.call(scores, k)) continue;
      if (scores[k] > bestScore) { second = bestScore; bestScore = scores[k]; best = k; }
      else if (scores[k] > second) { second = scores[k]; }
    }
    if (bestScore <= 0) return { intent: INTENT.UNKNOWN, confidence: 0 };
    var margin = (bestScore - second) / bestScore;          // 0..1
    var mass = Math.min(1, bestScore / 6);                  // absolute evidence
    var confidence = Math.max(0, Math.min(1, 0.35 * mass + 0.65 * margin * mass + 0.2));
    return { intent: best, confidence: Number(confidence.toFixed(2)) };
  }

  function scoreUtterance(text) {
    var t = normalise(text);
    var padded = ' ' + t + ' ';
    var scores = {};
    for (var intent in VERBS) {
      if (!Object.prototype.hasOwnProperty.call(VERBS, intent)) continue;
      var s = phraseScore(padded, VERBS[intent], 1.0);
      if (OBJECTS[intent]) {
        var objectHit = phraseScore(padded, OBJECTS[intent], 0.55);
        // an object only counts once a verb put this intent in play
        s += s > 0 ? objectHit * 1.6 : objectHit;
      }
      if (s > 0) scores[intent] = (scores[intent] || 0) + s;
    }
    for (var i = 0; i < STRUCTURE.length; i++) {
      if (STRUCTURE[i].re.test(text)) {
        scores[STRUCTURE[i].intent] = (scores[STRUCTURE[i].intent] || 0) + STRUCTURE[i].w;
      }
    }
    // A long, multi-clause request is research-shaped even when the
    // verb is a plain "find".
    var words = t ? t.split(' ').length : 0;
    if (words > 18 && scores[INTENT.SEARCH]) {
      scores[INTENT.RESEARCH] = (scores[INTENT.RESEARCH] || 0) + scores[INTENT.SEARCH] * 0.6;
    }
    return scores;
  }

  /* A classification is a live object: the controller keeps feeding
     it evidence and re-reads .intent as the task unfolds. */
  function Classification(text) {
    this.text = String(text || '');
    this.base = scoreUtterance(this.text);
    this.evidence = {};
    this.toolCount = 0;
    this.recompute();
  }

  Classification.prototype.recompute = function () {
    var merged = {};
    var k;
    for (k in this.base) if (Object.prototype.hasOwnProperty.call(this.base, k)) merged[k] = this.base[k];
    for (k in this.evidence) {
      if (!Object.prototype.hasOwnProperty.call(this.evidence, k)) continue;
      merged[k] = (merged[k] || 0) + this.evidence[k];
    }
    var d = decide(merged);
    this.intent = d.intent;
    this.confidence = d.confidence;
    this.scores = merged;
    return this;
  };

  /* Evidence channel 2 — a tool the engine actually started. */
  Classification.prototype.observeTool = function (toolName) {
    var name = String(toolName || '');
    if (!name) return this;
    this.toolCount++;
    for (var i = 0; i < TOOL_HINTS.length; i++) {
      if (!TOOL_HINTS[i].re.test(name)) continue;
      var intent = TOOL_HINTS[i].intent;
      this.evidence[intent] = (this.evidence[intent] || 0) + TOOL_HINTS[i].w;
      // Repeated lookups mean research, not a one-shot search. And when
      // the wording already leaned research, every lookup is evidence FOR
      // that reading rather than against it — a research task is made of
      // searches, so letting search evidence outvote it was backwards.
      if (intent === INTENT.SEARCH) {
        if (this.base[INTENT.RESEARCH]) {
          this.evidence[INTENT.RESEARCH] = (this.evidence[INTENT.RESEARCH] || 0) + TOOL_HINTS[i].w;
        } else if (this.toolCount >= 3) {
          this.evidence[INTENT.RESEARCH] = (this.evidence[INTENT.RESEARCH] || 0) + 2.0;
        }
      }
    }
    return this.recompute();
  };

  /* Evidence channel 3 — the shape of what came back. */
  Classification.prototype.observeResult = function (resultType) {
    var intent = RESULT_HINTS[String(resultType || '')];
    if (intent) {
      this.evidence[intent] = (this.evidence[intent] || 0) + 2.2;
      this.recompute();
    }
    return this;
  };

  Classification.prototype.profile = function () {
    return PROFILE[this.intent] || PROFILE.unknown;
  };

  /* Title the user actually wants to read: the verb plus their own
     words, trimmed. Never an internal agent or tool name. */
  var LEAD_NOISE = /^(please\s+|can you\s+|could you\s+|clavis[,\s]+|zara\s+|ek\s+baar\s+)+/i;
  var LEAD_VERB = /^(search(?:\s+for)?|find(?:\s+me)?|look\s+up|research|investigate|explore|study|write|draft|compose|summari[sz]e|rewrite|analy[sz]e|review|compare|calculate|compute|create|make|generate|build|open|launch|extract|scrape|debug|fix|dhundo|dhoondo|khojo|likho|banao|kholo|nikalo|batao|samjhao)\s+/i;

  Classification.prototype.title = function () {
    var verb = GERUND[this.intent] || 'Working';
    var subject = this.text.replace(/\s+/g, ' ').trim();
    // Strip politeness and the user's own imperative verb — the gerund
    // already says what is happening, so repeating it wastes the line.
    subject = subject.replace(LEAD_NOISE, '').replace(LEAD_VERB, '').replace(/^(the|a|an|about|on|for)\s+/i, '');
    if (subject.length > 52) subject = subject.slice(0, 50).replace(/\s+\S*$/, '') + '…';
    // Speech-to-text hands us all-lowercase; a title that starts mid-case
    // looks like a bug rather than a design choice.
    subject = subject.charAt(0).toUpperCase() + subject.slice(1);
    if (this.confidence < 0.4 || !subject) return verb + '…';
    return verb + ' · ' + subject;
  };

  var IntentClassifier = {
    INTENT: INTENT,
    PROFILE: PROFILE,
    /** classify(text) → live Classification */
    classify: function (text) { return new Classification(text); },
    /** Exposed for the self-check and for callers that only want a label. */
    label: function (text) {
      var c = new Classification(text);
      return { intent: c.intent, confidence: c.confidence, title: c.title(), mode: c.profile().mode };
    }
  };

  global.ClavisTaskModel = {
    INTENT: INTENT,
    PROFILE: PROFILE,
    GERUND: GERUND,
    IntentClassifier: IntentClassifier,

    /* ── self-check: ClavisTaskModel.demo() ────────────────── */
    demo: function () {
      var L = IntentClassifier.label;
      var cases = [
        ['Find the best gaming laptops under 100k', ['search']],
        ['research India semiconductor industry policy and market trends in detail please', ['research']],
        ['what is the difference between LFP and NMC', ['answer', 'compare']],
        ['likho ek whatsapp message client ke liye', ['write']],
        ['quarterly_report.pdf analyse karo', ['analyze_file']],
        ['12500 ka 18% gst kitna hoga', ['calculate']],
        ['open notepad', ['system_action']],
        ['fix the bug, TypeError undefined aa raha hai', ['debug']],
        ['https://example.com kholo', ['web_browse']],
        /* the four this app is actually for */
        ['Gurugram ke hotels ke 200 verified leads nikalo', ['lead_gen']],
        ['mujhe naye leads chahiye is week ke liye', ['lead_gen']],
        ['in companies ke decision maker ka phone number nikalo', ['contact_extract']],
        ['high intent leads ke liye follow-up whatsapp message draft karo', ['outreach']],
        ['leads sheet me se duplicates hatao', ['dataset']],
        ['kitne leads closed hue is mahine', ['dataset']]
      ];
      var fails = [];
      cases.forEach(function (c) {
        var got = L(c[0]).intent;
        if (c[1].indexOf(got) === -1) fails.push(c[0] + ' → ' + got + ' (wanted ' + c[1].join('/') + ')');
      });

      // channel 2 must be able to overrule a weak utterance guess
      var live = IntentClassifier.classify('kuch karo');
      live.observeTool('web_search').observeTool('web_search').observeTool('web_search');
      if (live.intent !== 'research' && live.intent !== 'search') fails.push('tool evidence ignored → ' + live.intent);

      // a vague utterance must NOT come back confident
      if (IntentClassifier.label('hmm').confidence > 0.45) fails.push('vague text over-confident');

      // a research request stays research even though it runs searches
      var deep = IntentClassifier.classify('research the indian semiconductor industry in depth');
      deep.observeTool('web_search').observeTool('web_search');
      if (deep.intent !== 'research') fails.push('search tools hijacked a research task → ' + deep.intent);

      // the title must not echo the user's own verb back at them
      var ti = IntentClassifier.label('find the best gaming laptops under 100k').title;
      if (/find/i.test(ti)) fails.push('title repeats the user verb: ' + ti);
      if (ti.length > 70) fails.push('title too long: ' + ti);

      console.assert(fails.length === 0, 'ClavisTaskModel failures:\n' + fails.join('\n'));
      return fails.length ? fails : 'ok';
    }
  };
})(window);
