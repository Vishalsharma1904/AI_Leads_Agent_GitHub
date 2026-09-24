/* ============================================================
 * clavis-intelligence.js  ·  ClavisIQ
 * ------------------------------------------------------------
 * The shared brain behind the floating Peek Task window and the
 * Clavis composer.
 *
 * It does four things, and nothing else:
 *
 *   1. analyze(text)      reads a message the way a person skims it —
 *                         what is this ABOUT, in what language, what
 *                         kind of ask, how deep.
 *   2. suggest(ctx)       turns that reading into follow-up chips that
 *                         belong to THIS subject. Never a fixed menu.
 *   3. complete(prefix)   predicts how the sentence being typed ends.
 *   4. learn(...)         watches which of its guesses were taken and
 *                         quietly reweights itself, forever.
 *
 * Two tiers, always:
 *   · a local pass that answers in <1ms and works with no network
 *   · an async model pass that REPLACES the local answer when it lands
 * So the UI is never empty, never stalls, and never reads as a script —
 * because most of the time what you see was written by the model, and
 * the ordering was decided by your own click history, not by this file.
 *
 * Nothing here throws into the page. Every public call is wrapped; the
 * worst failure mode is "you get the local answer".
 * ============================================================ */
(function (global) {
  'use strict';

  if (global.ClavisIQ && global.ClavisIQ.version >= 3) return;

  var STORE_KEY = 'clavis_iq_v3';
  var MAX_HISTORY = 90;
  var MAX_ACCEPTED = 50;

  /* ══════════════════════════════════════════════════════════
     0 · Memory — the part that makes it evolve
     ══════════════════════════════════════════════════════════
     Everything the user does with a suggestion is a vote. Votes
     become weights; weights reorder what gets offered next time.
     Two people using this build will see different chips for the
     same question within a week. That is the point. */

  var blankStore = function () {
    return {
      v: 3,
      lang: { hinglish: 0, en: 0, hi: 0 },
      domains: {},
      moves: { shown: {}, used: {} },
      entities: {},
      history: [],
      accepted: [],
      dismissed: 0,
      sessions: 0,
      updated: 0
    };
  };

  var store = blankStore();

  function loadStore() {
    try {
      var raw = localStorage.getItem(STORE_KEY);
      if (!raw) return;
      var parsed = JSON.parse(raw);
      if (parsed && parsed.v === 3) {
        store = Object.assign(blankStore(), parsed);
        store.lang = Object.assign({ hinglish: 0, en: 0, hi: 0 }, parsed.lang || {});
        store.moves = Object.assign({ shown: {}, used: {} }, parsed.moves || {});
      }
    } catch (e) { /* corrupt or blocked storage — start clean, never crash */ }
  }

  var saveTimer = 0;
  function saveStore() {
    if (saveTimer) return;
    saveTimer = setTimeout(function () {
      saveTimer = 0;
      try {
        store.updated = Date.now();
        if (store.history.length > MAX_HISTORY) store.history = store.history.slice(-MAX_HISTORY);
        if (store.accepted.length > MAX_ACCEPTED) store.accepted = store.accepted.slice(-MAX_ACCEPTED);
        localStorage.setItem(STORE_KEY, JSON.stringify(store));
      } catch (e) {}
    }, 900);
  }

  function bump(bag, key, by) {
    if (!key) return;
    bag[key] = (bag[key] || 0) + (by || 1);
  }

  /* Laplace-smoothed click-through per move type. A move nobody ever
     takes sinks; a move taken twice out of three offers floats. The +1/+3
     keeps a brand-new move at a fair 0.33 instead of zero, so the system
     stays curious instead of locking onto its first success. */
  function moveWeight(id) {
    var shown = store.moves.shown[id] || 0;
    var used = store.moves.used[id] || 0;
    return (used + 1) / (shown + 3);
  }

  function topKeys(bag, n) {
    return Object.keys(bag || {})
      .sort(function (a, b) { return bag[b] - bag[a]; })
      .slice(0, n || 5);
  }

  /* ══════════════════════════════════════════════════════════
     1 · Reading the text
     ══════════════════════════════════════════════════════════ */

  var HINGLISH_MARKERS = (
    'kya kaise kyun kyu kitna kitne kitni kaun kahan kab ' +
    'karo karna kar karke kiya karta karte karni ' +
    'batao bta bataye bataiye samjhao samjha sunao dikhao dikha dekho ' +
    'nikalo nikal laao lao bhejo bhej dedo dena deta ' +
    'chahiye zarurat jarurat mujhe mera meri mere hamara hamari ' +
    'hai hain tha thi the hoga hogi honge raha rahi rahe ' +
    'aur ya nahi nahin haan bilkul thoda zyada jyada bahut bohot ' +
    'abhi phir fir baad pehle pichle agla agle wala wali wale ' +
    'accha acha sahi galat theek thik matlab yaani yani ' +
    'sab saara saari sare koi kuch kuchh apna apne apni ' +
    'jaldi dhundho dhoondo dhund khojo banao bana likho likh ' +
    'me mein ko ka ki ke se par pe hi bhi to tak'
  ).split(/\s+/);

  var HINGLISH_SET = {};
  HINGLISH_MARKERS.forEach(function (w) { HINGLISH_SET[w] = 1; });

  var STOP = {};
  (
    'a an the is are was were be been being am do does did doing have has had having ' +
    'i me my we our you your he she it they them their this that these those of to in ' +
    'on at for with about from by as and or but if then than so such very more most ' +
    'much many some any all each other another can could would should will shall may ' +
    'might must please give tell explain show list find get make write need want know ' +
    'brief briefly detail details detailed summary summarize summarise overview intro ' +
    'introduction what which who whom whose when where why how here there now also just ' +
    'like into over under out up down off again once only own same too not no nor ' +
    'best top good great better worse worst nice cool bad right wrong new old big small ' +
    'put take keep look see think say tell ask use go come try start stop help let ' +
    'become leave call move run bring begin turn hold follow add change open close ' +
    'pay meet include continue set learn lead understand watch stand grow work ' +
    // generic container nouns: never the subject, always the wrapper
    'way ways thing things stuff item items guide tips idea ideas info information ' +
    'detail details example examples method methods process steps point points ' +
    'part parts type types kind kinds option options feature features benefit ' +
    'benefits recipe fix issue issues reason reasons difference differences ' +
    'between without within among across through during before after since until ' +
    'happen happened happens happening going got getting done made making said went ' +
    'came lose gain reduce increase improve build avoid prevent ' +
    'kya kaise kyun kyu batao bta samjhao dikhao nikalo chahiye mujhe mera meri mere ' +
    'hai hain tha thi the aur ya nahi haan thoda zyada bahut bohot abhi phir sab saara ' +
    'saari sare koi kuch apna apne me mein ko ka ki ke se par pe hi bhi to tak karo ' +
    'karna kar do dena bare baare wala wali wale ek do teen ' +
    'liye layi karke karta karte karti bina sath saath jaise waise agar lekin magar ' +
    'kyunki isliye kaunsa konsa upar niche andar bahar yaha waha yahan wahan ' +
    // voice-typed spellings of the same request words — never a subject
    'dihao dikao dikhau dikhaao dekhao dehao dikha dikhaiye btao bta bataao smjhao samjao chaiye chahie krna kro plz pls'
  ).split(/\s+/).forEach(function (w) { STOP[w] = 1; });

  /* Domains are prior probabilities, not routing rules. They decide
     which ANGLES are worth offering, never what the answer says. */
  var DOMAINS = {
    ai_ml: 'ai artificial intelligence machine learning ml deep learning neural network llm gpt model training dataset inference transformer nlp computer vision agent prompt embedding fine-tune finetune chatbot openai anthropic claude gemini llama diffusion',
    software: 'code coding programming developer software api function bug debug framework library javascript python java react node typescript css html backend frontend database sql git repo deploy server app build compile error exception class variable network networking tcp udp http https protocol port packet socket latency dns ip proxy cache thread async runtime',
    data: 'data analysis analytics dashboard chart graph metric kpi report spreadsheet excel csv statistics correlation regression sample median average visualization pivot query rows columns',
    leads: 'lead leads prospect prospects client clients business businesses company companies b2b outreach cold contact contacts phone email scrape scraping directory listing gurugram delhi mumbai noida pune bangalore hyderabad chennai vendor supplier',
    hiring: 'candidate candidates hiring recruit recruitment resume cv interview job jobs vacancy staffing guard guards housekeeping naukri shine apna workindia salary shift joining manpower labour labor worker workers',
    marketing: 'marketing seo ads advertising campaign brand branding social instagram linkedin content funnel conversion audience engagement reach impressions copywriting newsletter growth',
    finance: 'finance financial money revenue profit loss cost pricing price budget invoice billing gst tax investment stock stocks market fund mutual sip return roi margin cashflow loan emi interest crore lakh rupee',
    legal: 'legal law contract agreement clause compliance policy regulation licence license gdpr privacy terms liability dispute court act section notice',
    health: 'health medical doctor patient symptom symptoms treatment disease diet nutrition exercise fitness sleep mental therapy medicine dosage wellness weight fat belly gym workout calorie calories protein muscle cardio stamina yoga',
    history: 'history historical war battle empire dynasty independence revolution treaty colonial century medieval ancient freedom movement partition invasion king emperor civilisation civilization',
    science: 'science physics chemistry biology research experiment theory quantum molecule energy climate space astronomy evolution genetics reaction',
    education: 'learn learning study course syllabus exam tutorial beginner basics concept teach teaching student school college university roadmap curriculum certification',
    career: 'career job resume interview salary promotion skill skills portfolio linkedin freelance internship switch experience negotiation',
    travel: 'travel trip flight hotel visa itinerary tourist destination booking tour places visit city country beach mountain',
    food: 'food recipe cook cooking dish ingredient restaurant menu meal breakfast lunch dinner spice bake taste cuisine',
    product: 'design ui ux interface layout component figma wireframe prototype user experience accessibility typography colour color spacing animation responsive',
    news: 'news today latest current recent update breaking announced launched released yesterday week trending headline'
  };

  /* A domain in here only wins when one of its own unmistakable words is
     present — not merely words it shares with ordinary business talk. */
  var GATED = {
    leads:  ['lead', 'prospect', 'scrape', 'scraping', 'nikalo', 'dhundho', 'dhoondo',
             'listing', 'directory', 'outreach', 'cold email', 'cold call'],
    hiring: ['candidate', 'hiring', 'recruit', 'resume', 'cv', 'vacancy', 'naukri',
             'staffing', 'manpower', 'interview', 'joining', 'shift']
  };

  var DOMAIN_WORDS = {};
  Object.keys(DOMAINS).forEach(function (d) {
    DOMAIN_WORDS[d] = {};
    DOMAINS[d].split(/\s+/).forEach(function (w) { DOMAIN_WORDS[d][w] = 1; });
  });

  function normalise(s) {
    return String(s || '')
      .toLowerCase()
      .replace(/[`*_~#>|]/g, ' ')
      .replace(/https?:\/\/\S+/g, ' ')
      .replace(/[^\p{L}\p{N}\s+.-]/gu, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function words(s) {
    return normalise(s).split(' ').filter(Boolean);
  }

  function detectLang(text) {
    var raw = String(text || '');
    if (/[ऀ-ॿ]/.test(raw)) return 'hi';
    var w = words(raw);
    if (!w.length) return profileLang();
    var hits = 0;
    for (var i = 0; i < w.length; i++) if (HINGLISH_SET[w[i]]) hits++;
    var ratio = hits / w.length;
    if (ratio >= 0.16 || (hits >= 2 && w.length <= 12)) return 'hinglish';
    return 'en';
  }

  /* The long-run language of this person, used only as a tiebreak.
     If he has typed Hinglish for a month, an English one-liner does not
     flip every chip to English. */
  function profileLang() {
    var l = store.lang;
    var total = l.hinglish + l.en + l.hi;
    if (total < 4) return 'hinglish';
    if (l.hi > l.hinglish && l.hi > l.en) return 'hi';
    return l.hinglish >= l.en ? 'hinglish' : 'en';
  }

  function blendLang(current) {
    var p = profileLang();
    if (current === p) return current;
    // A single English message from a Hinglish user is not a language switch.
    var l = store.lang;
    var total = l.hinglish + l.en + l.hi;
    if (total >= 10 && (l[p] / total) > 0.7) return p;
    return current;
  }

  /* "ai" must come back as AI, not Ai. Anything the writer typed in caps
     stays in caps; everything else is title-cased word by word. */
  function prettify(s, acros) {
    return String(s || '').split(' ').map(function (w) {
      if (!w) return w;
      if (acros && acros[w]) return acros[w];
      return w.charAt(0).toUpperCase() + w.slice(1);
    }).join(' ');
  }

  function titleCase(s) {
    return prettify(s, null);
  }

  /* Pull the subject out. Query terms outrank answer terms, phrases
     outrank single words, and anything the writer capitalised or put in
     a heading gets a lift — the same cues a reader uses. */
  function extractTopics(query, answer) {
    var scores = {};
    var order = {};
    var seen = 0;

    function add(term, weight) {
      term = term.trim();
      if (!term || term.length < 3) return;
      if (STOP[term]) return;
      if (/^\d+[.\d]*$/.test(term)) return;
      scores[term] = (scores[term] || 0) + weight;
      if (!(term in order)) order[term] = seen++;
    }

    function harvest(text, base, phraseBoost) {
      var w = words(text);
      for (var i = 0; i < w.length; i++) {
        if (STOP[w[i]] || w[i].length < 3) continue;
        // position decay: what you say first is what you mean
        var near = 1 + Math.max(0, 1 - i / 40) * 0.6;
        add(w[i], base * near);
        if (i + 1 < w.length && !STOP[w[i + 1]] && w[i + 1].length >= 3) {
          // Phrases get the same position lift as single words — a phrase
          // in the opening clause is the subject far more often than a
          // stray noun further down.
          add(w[i] + ' ' + w[i + 1], base * phraseBoost * near);
        }
      }
    }

    harvest(query, 3.4, 1.55);

    var ans = String(answer || '');
    if (ans) {
      // headings and bolded runs carry the author's own topic sentence
      var emphasised = [];
      ans.replace(/^#{1,4}\s+(.+)$/gm, function (m, h) { emphasised.push(h); return m; });
      ans.replace(/\*\*(.+?)\*\*/g, function (m, b) { emphasised.push(b); return m; });
      emphasised.slice(0, 12).forEach(function (h) { harvest(h, 1.5, 1.5); });
      harvest(ans.slice(0, 1400), 0.42, 1.35);
    }

    // Capitalised runs in the original casing are usually proper subjects
    var caps = String(query + ' ' + ans.slice(0, 700)).match(/\b([A-Z][a-zA-Z]{2,}(?:\s+[A-Z][a-zA-Z]{2,})?)\b/g) || [];
    caps.slice(0, 20).forEach(function (c) {
      var lc = c.toLowerCase();
      if (!STOP[lc.split(' ')[0]]) add(lc, 1.9);
    });

    // Acronyms (AI, ML, CRM, GST, FDs) read as short but matter a lot.
    // The original casing is kept so a chip says "FDs", not "Fds".
    var acroMap = {};
    var acros = String(query + ' ' + ans.slice(0, 500)).match(/\b[A-Z]{2,6}s?\b/g) || [];
    acros.slice(0, 12).forEach(function (a) {
      if (a === 'I' || a === 'A') return;
      var lc = a.toLowerCase();
      acroMap[lc] = a;
      scores[lc] = (scores[lc] || 0) + 2.6;
      if (!(lc in order)) order[lc] = seen++;
    });

    // Anything the writer typed with an interior capital keeps its shape:
    // useEffect stays useEffect rather than becoming Useeffect.
    var camels = String(query + ' ' + ans.slice(0, 700)).match(/\b[a-zA-Z][a-zA-Z0-9]{1,24}\b/g) || [];
    camels.forEach(function (c) {
      if (!/[A-Z]/.test(c.slice(1))) return;
      var lc = c.toLowerCase();
      if (!acroMap[lc]) acroMap[lc] = c;
    });

    // A phrase beats the words inside it: drop the parts it absorbed
    var terms = Object.keys(scores);
    terms.forEach(function (t) {
      if (t.indexOf(' ') === -1) return;
      var parts = t.split(' ');
      if (scores[t] >= 2.6) {
        parts.forEach(function (p) {
          if (scores[p] != null) scores[p] *= 0.45;
        });
      }
    });

    var ranked = terms
      .sort(function (a, b) {
        var d = scores[b] - scores[a];
        return d !== 0 ? d : order[a] - order[b];
      })
      .filter(function (t) { return scores[t] > 0.9; });

    /* "machine learning" already covers "machine" and "learning". Keeping
       all three makes a comparison chip read "Machine Learning vs Machine",
       which is the kind of detail that gives the whole thing away. */
    var kept = [];
    ranked.forEach(function (t) {
      if (kept.length >= 7) return;
      var tw = t.split(' ');
      var swallowed = kept.some(function (k) {
        if (k === t) return true;
        var kw = k.split(' ');
        // one fully contains the other
        if (kw.length > 1 && (' ' + k + ' ').indexOf(' ' + t + ' ') !== -1) return true;
        if (tw.length > 1 && (' ' + t + ' ').indexOf(' ' + k + ' ') !== -1) return true;
        // overlapping n-grams off the same run: "react useEffect" then
        // "useEffect infinite". The second is an artefact of the window,
        // not a second subject.
        if (kw.length > 1 && tw.length > 1) {
          if (tw[0] === kw[kw.length - 1]) return true;
          if (tw[tw.length - 1] === kw[0]) return true;
        }
        return false;
      });
      if (!swallowed) kept.push(t);
    });

    /* A proper name he typed (or clavis-luxe.js spelled out) in capitals
       is one subject however many words it has: "Neem Karoli Baba" must
       not come back as "Neem Karoli". Runs of Capitalised words in the
       question, trimmed of stop words, replace any shorter term inside. */
    var runs = [];
    var qWords = String(query || '').replace(/[^\p{L}\p{N}\s'-]/gu, ' ').split(/\s+/).filter(Boolean);
    var cur = [];
    function closeRun() {
      while (cur.length && STOP[cur[0].toLowerCase()]) cur.shift();
      while (cur.length && STOP[cur[cur.length - 1].toLowerCase()]) cur.pop();
      if (cur.length >= 2 && cur.length <= 4) runs.push(cur.join(' ').toLowerCase());
      cur = [];
    }
    qWords.forEach(function (w) { if (/^[A-Z][a-z]{1,}$/.test(w)) cur.push(w); else closeRun(); });
    closeRun();
    if (runs.length) {
      var seenRun = {};
      kept = kept.map(function (t) {
        var run = runs.filter(function (r) { return r !== t && (' ' + r + ' ').indexOf(' ' + t + ' ') !== -1; })[0];
        return run || t;
      }).filter(function (t) { if (seenRun[t]) return false; seenRun[t] = 1; return true; });
    }

    return { terms: kept, acros: acroMap };
  }

  function classifyDomain(query, answer, topics) {
    var text = normalise(query + ' ' + String(answer || '').slice(0, 1200));
    var w = text.split(' ');
    var scores = {};
    Object.keys(DOMAIN_WORDS).forEach(function (d) { scores[d] = 0; });

    for (var i = 0; i < w.length; i++) {
      var weight = i < 24 ? 2.2 : 1;       // the question weighs more than the answer
      Object.keys(DOMAIN_WORDS).forEach(function (d) {
        if (DOMAIN_WORDS[d][w[i]]) scores[d] += weight;
      });
    }
    (topics || []).forEach(function (t) {
      t.split(' ').forEach(function (p) {
        Object.keys(DOMAIN_WORDS).forEach(function (d) {
          if (DOMAIN_WORDS[d][p]) scores[d] += 1.6;
        });
      });
    });

    // Gentle prior from what this person actually works on
    var domTotal = 0;
    Object.keys(store.domains).forEach(function (d) { domTotal += store.domains[d]; });
    if (domTotal > 6) {
      Object.keys(scores).forEach(function (d) {
        scores[d] += ((store.domains[d] || 0) / domTotal) * 1.8;
      });
    }

    /* The app-native domains route to real actions — pulling contacts,
       exporting sheets — so they must not be claimed on soft evidence.
       "security guard business pricing" is a pricing question that happens
       to contain two words from the leads vocabulary; without this gate it
       came back offering to export it to Excel. */
    Object.keys(GATED).forEach(function (d) {
      if (!scores[d]) return;
      var hit = GATED[d].some(function (mark) {
        return text.indexOf(mark) !== -1;
      });
      if (!hit) scores[d] *= 0.3;
    });

    var best = 'general', bestScore = 0;
    Object.keys(scores).forEach(function (d) {
      if (scores[d] > bestScore) { bestScore = scores[d]; best = d; }
    });
    return { domain: bestScore >= 2.2 ? best : 'general', scores: scores, confidence: bestScore };
  }

  function classifyKind(query) {
    var q = normalise(query);
    if (/\b(vs|versus|compare|comparison|difference|farak|fark|behtar|better|which is)\b/.test(q)) return 'compare';
    if (/\b(how to|how do|how can|kaise|steps|step by step|tarika|process|guide|tutorial)\b/.test(q)) return 'howto';
    if (/\b(what is|what are|define|definition|meaning|matlab|kya hai|kya hota)\b/.test(q)) return 'define';
    if (/\b(why|kyun|kyu|reason|because|wajah)\b/.test(q)) return 'why';
    if (/\b(list|top \d+|best|suggest|recommend|options|ideas|examples)\b/.test(q)) return 'list';
    if (/\b(write|draft|compose|likho|likh|banao|create|generate|make)\b/.test(q)) return 'make';
    if (/\b(leads?|prospects?|candidates?|export|excel|csv|scrape|nikalo|dhundho)\b/.test(q)) return 'data';
    if (/\b(fix|error|bug|not working|issue|problem|debug|crash)\b/.test(q)) return 'debug';
    return 'ask';
  }

  function extractEntities(query) {
    var raw = String(query || '');
    var cities = (normalise(raw).match(/\b(gurugram|gurgaon|delhi|noida|mumbai|pune|bangalore|bengaluru|hyderabad|chennai|kolkata|jaipur|ahmedabad|lucknow|indore|chandigarh|faridabad|ghaziabad)\b/g) || []);
    var numbers = (raw.match(/\b\d{1,5}\b/g) || []).map(Number).filter(function (n) { return n > 0 && n < 100000; });
    return { cities: Array.from(new Set(cities)), numbers: numbers };
  }

  function analyze(query, answer) {
    var q = String(query || '');
    var ex = extractTopics(q, answer);
    var topics = ex.terms;
    var dom = classifyDomain(q, answer, topics);
    var lang = blendLang(detectLang(q));
    var wcount = words(q).length;
    return {
      raw: q,
      lang: lang,
      topics: topics,
      acros: ex.acros,
      head: topics[0] || '',
      second: topics[1] || '',
      domain: dom.domain,
      domainConfidence: dom.confidence,
      kind: classifyKind(q),
      entities: extractEntities(q),
      depth: wcount > 18 ? 'deep' : (wcount > 7 ? 'normal' : 'quick'),
      answerLength: String(answer || '').length
    };
  }

  /* ══════════════════════════════════════════════════════════
     2 · Moves — the angles a curious person would take next
     ══════════════════════════════════════════════════════════
     A move is not a canned prompt. It is a lens. The subject that
     goes through the lens comes from the conversation, and the
     wording comes out in whatever language the user is speaking. */

  function T(sig) {
    var h = sig.head || '';
    var a = sig.acros || null;
    // A subject handed in by the caller (a photo search's real name) keeps
    // its proper casing in the prompt too: "Neem Karoli Baba", not lowercase.
    if (sig.subjectCased && normalise(sig.subjectCased) === h) h = sig.subjectCased;
    return {
      h: h,
      H: prettify(h, a),
      s: sig.second || '',
      S: prettify(sig.second || '', a),
      city: (sig.entities.cities[0] || store.topCity || 'Gurugram')
    };
  }

  /* Weighty enough to stand on one side of a "vs": a phrase, a known
     acronym, or a long enough single word. */
  function substantive(t, acros) {
    if (!t) return false;
    if (t.indexOf(' ') !== -1) return true;
    if (acros && acros[t]) return true;
    return t.length >= 8;
  }

  function sharesWord(a, b) {
    var aw = String(a || '').split(' ');
    var bw = String(b || '').split(' ');
    for (var i = 0; i < aw.length; i++) {
      if (aw[i] && bw.indexOf(aw[i]) !== -1) return true;
    }
    return false;
  }

  function pickLang(sig, en, hinglish, hi) {
    if (sig.lang === 'hi' && hi) return hi;
    if (sig.lang === 'hinglish' && hinglish) return hinglish;
    return en;
  }

  var MOVES = {
    DEEPEN: {
      base: 1.00,
      ok: function (s) { return !!s.head; },
      make: function (s) { var t = T(s); return {
        label: pickLang(s, 'Go deeper on ' + t.H, t.H + ' aur detail me', t.H + ' और विस्तार से'),
        prompt: pickLang(s,
          'Go deeper on ' + t.h + '. Cover the parts most explanations skip.',
          t.h + ' ke baare me aur detail me batao — wo cheezein jo log usually skip kar dete hain.',
          t.h + ' के बारे में और विस्तार से बताइए।'),
        icon: 'depth' }; }
    },
    SIMPLIFY: {
      base: 0.86,
      ok: function (s) { return !!s.head; },
      make: function (s) { var t = T(s); return {
        label: pickLang(s, 'Explain ' + t.H + ' simply', t.H + ' simple bhasha me', t.H + ' आसान भाषा में'),
        prompt: pickLang(s,
          'Explain ' + t.h + ' in plain language, as if to a smart beginner. Use one everyday analogy.',
          t.h + ' ko bilkul simple bhasha me samjhao, ek rozmarra ka example dekar.',
          t.h + ' को बिलकुल आसान भाषा में समझाइए, एक रोज़मर्रा के उदाहरण के साथ।'),
        icon: 'simple' }; }
    },
    CONTRAST: {
      base: 0.98,
      /* Two subjects that share a word are usually one subject seen twice,
         and "Hyderabadi Biryani vs Biryani Recipe" is exactly the kind of
         line that reveals a machine wrote it. Both sides also have to be
         weighty enough to compare — "Belly Fat vs Gym" is not a question
         anyone asked. */
      ok: function (s) {
        return !!s.head && !!s.second &&
          !sharesWord(s.head, s.second) &&
          (s.kind === 'compare' || (substantive(s.head, s.acros) && substantive(s.second, s.acros)));
      },
      make: function (s) { var t = T(s); return {
        label: t.H + ' vs ' + t.S,
        prompt: pickLang(s,
          'Compare ' + t.h + ' and ' + t.s + ' directly — where each one wins, where each one fails, and which to pick when.',
          t.h + ' aur ' + t.s + ' me fark kya hai — kaun kahan behtar hai aur kab kya choose karna chahiye.',
          t.h + ' और ' + t.s + ' में अंतर क्या है और कब क्या चुनना चाहिए?'),
        icon: 'compare' }; }
    },
    ALTERNATIVES: {
      base: 0.80,
      ok: function (s) {
        if (['history', 'news', 'science', 'health'].indexOf(s.domain) !== -1) return false;
        return !!s.head && (!s.second || sharesWord(s.head, s.second) ||
          !substantive(s.second, s.acros));
      },
      make: function (s) { var t = T(s); return {
        label: pickLang(s, 'Alternatives to ' + t.H, t.H + ' ke alternatives', t.H + ' के विकल्प'),
        prompt: pickLang(s,
          'What are the real alternatives to ' + t.h + ', and honestly, when is each one the better choice?',
          t.h + ' ke asli alternatives kya hain, aur sach me kab kaunsa behtar hota hai?',
          t.h + ' के विकल्प क्या हैं और कब कौन सा बेहतर है?'),
        icon: 'compare' }; }
    },
    EXAMPLE: {
      base: 0.94,
      ok: function (s) { return !!s.head; },
      make: function (s) { var t = T(s); return {
        label: pickLang(s, 'Real examples', t.H + ' ke real examples', 'असली उदाहरण'),
        prompt: pickLang(s,
          'Give 3 concrete real-world examples of ' + t.h + ' — actual cases, not hypotheticals.',
          t.h + ' ke 3 real-world examples do — actual cases, hypothetical nahi.',
          t.h + ' के 3 असली उदाहरण दीजिए।'),
        icon: 'example' }; }
    },
    APPLY: {
      base: 0.90,
      ok: function (s) { return !!s.head; },
      make: function (s) { var t = T(s); return {
        label: pickLang(s, 'How do I use this?', t.H + ' kaise use karun', 'इसे कैसे इस्तेमाल करूँ'),
        prompt: pickLang(s,
          'How would I actually apply ' + t.h + ' in my own work this week? Be specific and practical.',
          'Main ' + t.h + ' ko apne kaam me is hafte kaise use kar sakta hoon? Specific aur practical batao.',
          'मैं ' + t.h + ' को अपने काम में कैसे इस्तेमाल करूँ?'),
        icon: 'apply' }; }
    },
    STEPS: {
      base: 0.88,
      ok: function (s) { return s.kind === 'howto' || s.kind === 'make' || s.domain === 'software' || s.domain === 'education'; },
      make: function (s) { var t = T(s); return {
        label: pickLang(s, 'Step-by-step', 'Step by step batao', 'चरण दर चरण'),
        prompt: pickLang(s,
          'Break ' + t.h + ' into a numbered step-by-step plan I can follow start to finish.',
          t.h + ' ko step by step numbered plan me todo, shuru se aakhir tak.',
          t.h + ' को चरण दर चरण समझाइए।'),
        icon: 'steps' }; }
    },
    RISK: {
      base: 0.78,
      ok: function (s) { return !!s.head && ['history', 'news'].indexOf(s.domain) === -1; },
      make: function (s) { var t = T(s); return {
        label: pickLang(s, 'Risks & limits', 'Risks aur limitations', 'जोखिम और सीमाएँ'),
        prompt: pickLang(s,
          'What are the real risks, limitations and common mistakes with ' + t.h + '? Be blunt.',
          t.h + ' ke asli risks, limitations aur common galtiyan kya hain? Bilkul seedha batao.',
          t.h + ' के जोखिम और सामान्य गलतियाँ क्या हैं?'),
        icon: 'risk' }; }
    },
    QUANTIFY: {
      base: 0.72,
      ok: function (s) { return s.domain !== 'food' && s.domain !== 'travel'; },
      make: function (s) { var t = T(s); return {
        label: pickLang(s, 'Numbers & benchmarks', 'Numbers aur benchmarks', 'आँकड़े और मानक'),
        prompt: pickLang(s,
          'Give me the numbers on ' + t.h + ' — benchmarks, typical ranges, what "good" looks like.',
          t.h + ' ke numbers do — benchmarks, typical range, aur "accha" kis level ko kehte hain.',
          t.h + ' के आँकड़े और मानक बताइए।'),
        icon: 'chart' }; }
    },
    TOOLS: {
      base: 0.76,
      ok: function (s) { return ['ai_ml', 'software', 'data', 'marketing', 'product', 'business'].indexOf(s.domain) !== -1; },
      make: function (s) { var t = T(s); return {
        label: pickLang(s, 'Best tools for this', 'Iske best tools', 'बेहतरीन टूल्स'),
        prompt: pickLang(s,
          'Which tools are actually worth using for ' + t.h + ' right now, and what does each cost?',
          t.h + ' ke liye abhi kaunse tools sach me worth hain, aur har ek ka kharcha kitna?',
          t.h + ' के लिए कौन से टूल्स सबसे अच्छे हैं?'),
        icon: 'tool' }; }
    },
    ROADMAP: {
      base: 0.74,
      ok: function (s) { return ['education', 'career', 'ai_ml', 'software'].indexOf(s.domain) !== -1; },
      make: function (s) { var t = T(s); return {
        label: pickLang(s, 'Learning roadmap', 'Sikhne ka roadmap', 'सीखने का रोडमैप'),
        prompt: pickLang(s,
          'Build me a realistic learning roadmap for ' + t.h + ' — what to learn in what order, and how long each stage takes.',
          t.h + ' sikhne ka realistic roadmap banao — kya pehle, kya baad me, aur har stage me kitna time.',
          t.h + ' सीखने का रोडमैप बनाइए।'),
        icon: 'map' }; }
    },
    COST: {
      base: 0.70,
      ok: function (s) { return ['finance', 'business', 'travel', 'marketing', 'leads'].indexOf(s.domain) !== -1; },
      make: function (s) { var t = T(s); return {
        label: pickLang(s, 'What does it cost?', 'Kharcha kitna aayega', 'खर्च कितना होगा'),
        prompt: pickLang(s,
          'Break down the real cost of ' + t.h + ' — upfront, ongoing, and the hidden ones.',
          t.h + ' ka asli kharcha breakdown karo — shuruaat ka, monthly, aur chhupe hue kharche.',
          t.h + ' का असली खर्च कितना है?'),
        icon: 'cost' }; }
    },
    LOCALISE: {
      base: 0.68,
      ok: function (s) { return s.lang !== 'en' || ['leads', 'hiring', 'finance', 'legal', 'business'].indexOf(s.domain) !== -1; },
      make: function (s) { var t = T(s); return {
        label: pickLang(s, 'In the India context', 'India ke context me', 'भारत के संदर्भ में'),
        prompt: pickLang(s,
          'How does ' + t.h + ' actually play out in India specifically — rules, costs, and what differs from the West?',
          t.h + ' India me specifically kaisa hai — rules, cost, aur West se kya alag hai?',
          t.h + ' भारत में कैसा है — नियम, खर्च और अंतर?'),
        icon: 'globe' }; }
    },
    DEBUG: {
      base: 0.95,
      ok: function (s) { return s.kind === 'debug'; },
      make: function (s) { var t = T(s); return {
        label: pickLang(s, 'Why is it failing?', 'Ye fail kyun ho raha hai', 'यह क्यों फेल हो रहा है'),
        prompt: pickLang(s,
          'Walk through the likely causes of this ' + (t.h || 'issue') + ' failing, most likely first, with how to confirm each.',
          'Is ' + (t.h || 'problem') + ' ke fail hone ki possible wajahen batao, sabse likely pehle, aur har ek ko confirm kaise karein.',
          'यह क्यों फेल हो रहा है और कैसे जाँचें?'),
        icon: 'debug' }; }
    },
    CODE: {
      base: 0.86,
      ok: function (s) { return s.domain === 'software' || s.domain === 'ai_ml' || s.domain === 'data'; },
      make: function (s) { var t = T(s); return {
        label: pickLang(s, 'Show me the code', 'Code dikhao', 'कोड दिखाइए'),
        prompt: pickLang(s,
          'Show a minimal working code example for ' + t.h + ', commented, that I can run as-is.',
          t.h + ' ka minimal working code example dikhao, comments ke saath, jo seedha run ho jaye.',
          t.h + ' का कोड उदाहरण दिखाइए।'),
        icon: 'code' }; }
    },
    TABLE: {
      base: 0.66,
      ok: function (s) { return s.answerLength > 320 || s.kind === 'list' || s.kind === 'compare'; },
      make: function (s) { return {
        label: pickLang(s, 'Show as a table', 'Table me dikhao', 'तालिका में दिखाइए'),
        prompt: pickLang(s,
          'Reformat that as a clean comparison table with the columns that actually matter.',
          'Isko ek clean comparison table me daal do, sirf wo columns jo sach me matter karte hain.',
          'इसे एक साफ़ तालिका में दिखाइए।'),
        icon: 'table' }; }
    },
    TLDR: {
      base: 0.64,
      ok: function (s) { return s.answerLength > 700; },
      make: function (s) { return {
        label: pickLang(s, 'TL;DR in 5 points', '5 points me summary', '5 बिंदुओं में सार'),
        prompt: pickLang(s,
          'Compress that into 5 sharp bullets — only what I would actually need to remember.',
          'Isko 5 sharp bullets me compress karo — sirf wahi jo yaad rakhna zaroori hai.',
          'इसे 5 बिंदुओं में समेटिए।'),
        icon: 'list' }; }
    },
    DRAFT: {
      base: 0.72,
      ok: function (s) { return ['leads', 'hiring', 'marketing', 'business', 'career'].indexOf(s.domain) !== -1; },
      make: function (s) { var t = T(s); return {
        label: pickLang(s, 'Draft an email', 'Email draft karo', 'ईमेल ड्राफ़्ट करें'),
        prompt: pickLang(s,
          'Draft a short, non-salesy email about ' + t.h + ' that a busy person would actually reply to.',
          t.h + ' ke baare me ek chhota, non-salesy email draft karo jiska busy banda sach me reply kare.',
          t.h + ' के बारे में एक छोटा ईमेल ड्राफ़्ट कीजिए।'),
        icon: 'mail' }; }
    },
    NEXT: {
      base: 0.62,
      ok: function () { return true; },
      make: function (s) { return {
        label: pickLang(s, 'What should I do next?', 'Ab aage kya karun', 'अब आगे क्या करूँ'),
        prompt: pickLang(s,
          'Given all that, what is the single most useful thing for me to do next? Just one.',
          'Ye sab dekhte hue, ab mere liye sabse useful agla kaam kya hai? Sirf ek batao.',
          'अब आगे मेरे लिए सबसे उपयोगी कदम क्या है?'),
        icon: 'next' }; }
    },
    SOURCES: {
      base: 0.58,
      ok: function (s) { return s.domain === 'news' || s.domain === 'science' || s.domain === 'health' || s.domain === 'legal'; },
      make: function (s) { return {
        label: pickLang(s, 'Where is this from?', 'Sources kya hain', 'स्रोत क्या हैं'),
        prompt: pickLang(s,
          'What are the sources for that, and how confident should I be in each?',
          'Iske sources kya hain, aur har ek par kitna bharosa karna chahiye?',
          'इसके स्रोत क्या हैं और कितने भरोसेमंद हैं?'),
        icon: 'link' }; }
    },

    /* ── App-native moves: these do real work in Clavis ── */
    MORE_LEADS: {
      base: 1.05,
      ok: function (s) { return s.domain === 'leads'; },
      make: function (s) { var t = T(s); return {
        label: pickLang(s, '20 more in ' + titleCase(t.city), '20 aur ' + titleCase(t.city) + ' me', titleCase(t.city) + ' में 20 और'),
        prompt: pickLang(s,
          'Find 20 more verified leads in ' + t.city + ' like these.',
          '20 aur verified leads nikalo ' + t.city + ' mein, inhi jaise.',
          t.city + ' में 20 और वेरिफाइड लीड्स निकालिए।'),
        icon: 'plus' }; }
    },
    CONTACTS: {
      base: 1.00,
      ok: function (s) { return s.domain === 'leads' || s.domain === 'hiring'; },
      make: function (s) { return {
        label: pickLang(s, 'Pull emails & phones', 'Email + phone nikalo', 'ईमेल और फ़ोन निकालिए'),
        prompt: pickLang(s,
          'Extract verified email addresses and direct phone numbers for all of these.',
          'In sabke verified email address aur direct phone numbers nikalo.',
          'इन सभी के ईमेल और फ़ोन नंबर निकालिए।'),
        icon: 'contact' }; }
    },
    EXPORT: {
      base: 0.95,
      ok: function (s) { return s.domain === 'leads' || s.domain === 'hiring' || s.domain === 'data' || s.kind === 'data'; },
      make: function (s) { return {
        label: pickLang(s, 'Export to Excel', 'Excel me export karo', 'एक्सेल में एक्सपोर्ट'),
        prompt: pickLang(s,
          'Export all of this to an Excel sheet.',
          'Ye sab Excel me export kar do.',
          'यह सब एक्सेल में एक्सपोर्ट कीजिए।'),
        icon: 'download' }; }
    },
    OUTREACH: {
      base: 0.82,
      ok: function (s) { return s.domain === 'leads'; },
      make: function (s) { return {
        label: pickLang(s, 'Write outreach for these', 'Inke liye outreach likho', 'इनके लिए संदेश लिखिए'),
        prompt: pickLang(s,
          'Write a short outreach message for these leads — security and housekeeping staffing, first touch.',
          'In leads ke liye chhota outreach message likho — security aur housekeeping staffing, pehla contact.',
          'इन लीड्स के लिए संदेश लिखिए।'),
        icon: 'send' }; }
    },
    NEARBY: {
      base: 0.74,
      ok: function (s) { return s.domain === 'leads' && s.entities.cities.length > 0; },
      make: function (s) { var t = T(s); return {
        label: pickLang(s, 'Try a nearby city', 'Paas ke sheher me bhi', 'पास के शहर में भी'),
        prompt: pickLang(s,
          'Run the same search in the nearest comparable cities to ' + t.city + '.',
          'Yahi search ' + t.city + ' ke paas wale similar shehron me bhi chalao.',
          t.city + ' के पास के शहरों में भी यही खोजिए।'),
        icon: 'map' }; }
    }
  };

  var MOVE_IDS = Object.keys(MOVES);

  /* Ask a comparison and you should get a comparison back near the top.
     This is the difference between a system that read the question and one
     that merely detected its topic. */
  var KIND_AFFINITY = {
    compare: { CONTRAST: 0.55, ALTERNATIVES: 0.3, TABLE: 0.3 },
    howto:   { STEPS: 0.5, APPLY: 0.35, TOOLS: 0.2 },
    define:  { SIMPLIFY: 0.4, EXAMPLE: 0.3, DEEPEN: 0.2 },
    why:     { DEEPEN: 0.4, EXAMPLE: 0.25 },
    list:    { EXAMPLE: 0.35, TABLE: 0.35, QUANTIFY: 0.2 },
    make:    { CODE: 0.3, DRAFT: 0.35, STEPS: 0.25 },
    debug:   { DEBUG: 0.55, CODE: 0.35, STEPS: 0.2 },
    data:    { EXPORT: 0.45, CONTACTS: 0.3, TABLE: 0.3 },
    ask:     {}
  };

  /* ══════════════════════════════════════════════════════════
     3 · Chips: instant local, then model-written
     ══════════════════════════════════════════════════════════ */

  function localChips(sig, count) {
    var want = count || 4;
    var eligible = MOVE_IDS.filter(function (id) {
      try { return MOVES[id].ok(sig); } catch (e) { return false; }
    });

    var affinity = KIND_AFFINITY[sig.kind] || {};

    var ranked = eligible.map(function (id) {
      var w = moveWeight(id);
      // base priority × learned appetite, plus a little noise so the same
      // question twice in a row is not the same four chips twice in a row
      var score = (MOVES[id].base + (affinity[id] || 0)) * (0.55 + 1.7 * w) + Math.random() * 0.1;
      return { id: id, score: score };
    }).sort(function (a, b) { return b.score - a.score; });

    // Keep one exploration slot: an angle it has not tried on this user yet.
    var unexplored = eligible.filter(function (id) { return !(store.moves.shown[id] > 2); });
    if (unexplored.length && Math.random() < 0.35) {
      var pick = unexplored[Math.floor(Math.random() * unexplored.length)];
      ranked = ranked.filter(function (r) { return r.id !== pick; });
      ranked.splice(Math.min(2, ranked.length), 0, { id: pick, score: 0 });
    }

    var out = [];
    var usedLabels = {};
    for (var i = 0; i < ranked.length && out.length < want; i++) {
      var id = ranked[i].id;
      var chip;
      try { chip = MOVES[id].make(sig); } catch (e) { continue; }
      if (!chip || !chip.label || !chip.prompt) continue;
      var key = chip.label.toLowerCase();
      if (usedLabels[key]) continue;
      usedLabels[key] = 1;
      chip.move = id;
      chip.origin = 'local';
      out.push(chip);
    }
    return out;
  }

  /* ── Model pass ─────────────────────────────────────────── */

  var llmCache = {};
  var llmInFlight = {};

  function hash(s) {
    var h = 0, str = String(s);
    for (var i = 0; i < str.length; i++) { h = ((h << 5) - h + str.charCodeAt(i)) | 0; }
    return String(h);
  }

  function preferredModel(fast) {
    try {
      var pref = localStorage.getItem('jarvis_preferred_model') || '';
      if (fast || pref === 'groq-fast') return 'groq/openai/gpt-oss-20b';
      if (pref === 'groq') return 'groq/openai/gpt-oss-120b';
    } catch (e) {}
    // Small helper calls (titles, chips) get their own Groq model so they
    // never eat the main reply's per-minute budget.
    return 'groq/openai/gpt-oss-20b';
  }

  function callModel(messages, opts) {
    var o = opts || {};
    var payload = {
      model: o.model || preferredModel(o.fast),
      messages: messages,
      temperature: o.temperature == null ? 0.85 : o.temperature,
      max_tokens: o.max_tokens || 240
    };
    function pick(data) {
      return (data && data.choices && data.choices[0] && data.choices[0].message.content) || '';
    }
    // Prefer the user's OWN pasted key (Groq/OpenRouter via ClavisDirect):
    // it needs no backend and no login, so the semantic ghost completion
    // and suggestion chips actually reach the model. Before this, callModel
    // only knew NexusAIChat (backend + Supabase auth); running locally with a
    // BYO key it always threw, so completion silently dropped to history/
    // n-gram only — which is exactly the "primitive, history-based" feel.
    if (global.ClavisDirect && global.ClavisDirect.hasKey && global.ClavisDirect.hasKey()) {
      return global.ClavisDirect.complete(payload).then(pick);
    }
    if (global.NexusAIChat && typeof global.NexusAIChat.complete === 'function') {
      return global.NexusAIChat.complete(payload).then(pick);
    }
    return Promise.reject(new Error('no-ai-client'));
  }

  function parseChipJson(text) {
    var t = String(text || '').trim();
    t = t.replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
    var start = t.indexOf('[');
    var end = t.lastIndexOf(']');
    if (start === -1 || end === -1 || end < start) return null;
    var arr;
    try { arr = JSON.parse(t.slice(start, end + 1)); } catch (e) { return null; }
    if (!Array.isArray(arr)) return null;
    return arr.map(function (x) {
      if (!x) return null;
      var label = String(x.label || x.title || '').trim();
      var prompt = String(x.prompt || x.text || x.query || label).trim();
      if (!label || !prompt) return null;
      if (label.length > 34) label = label.slice(0, 32).replace(/\s+\S*$/, '') + '…';
      return { label: label, prompt: prompt, move: 'LLM', origin: 'model', icon: 'spark' };
    }).filter(Boolean).slice(0, 5);
  }

  var LANG_NAME = { en: 'English', hinglish: 'Hinglish (Hindi written in Roman script, mixed with English — the way Indians actually chat)', hi: 'Hindi (Devanagari)' };

  function llmChips(sig, query, answer, count) {
    var key = hash(query + '|' + String(answer || '').slice(0, 600) + '|' + sig.lang + '|' + (count || 4));
    if (llmCache[key]) return Promise.resolve(llmCache[key]);
    if (llmInFlight[key]) return llmInFlight[key];

    var taste = topKeys(store.moves.used, 3).map(function (id) {
      return MOVES[id] ? id.toLowerCase().replace(/_/g, ' ') : null;
    }).filter(Boolean);

    var sys =
      'You write follow-up suggestion chips for a chat assistant called Clavis.\n' +
      'Return STRICT JSON only: an array of exactly ' + (count || 4) + ' objects, each {"label": "...", "prompt": "..."}.\n' +
      'label: max 28 characters, no trailing period, reads like a button.\n' +
      'prompt: the full message that will be sent if the user taps it, first person, natural.\n' +
      'Language for BOTH fields: ' + (LANG_NAME[sig.lang] || 'English') + '.\n' +
      'Spell every name correctly with its standard capitalisation, even if the user misspelled it (e.g. "neemaroli baba" is "Neem Karoli Baba"). ' +
      'The user is Indian: "lord"/"bhagwan" means the Hindu deities, "shiv ji" is Lord Shiva. ' +
      (sig.subjectCased ? 'The subject is exactly: ' + sig.subjectCased + '. Every chip must be about it. ' : '') +
      'Rules: every suggestion must be specific to the actual subject discussed — never generic filler like ' +
      '"tell me more" or "any other questions". Each of the four must open a genuinely different direction ' +
      '(e.g. deeper mechanism, a comparison, a concrete application, a risk or a number). ' +
      'Never repeat what the answer already said. No emoji. No markdown. JSON array only.' +
      (taste.length ? '\nThis user most often taps suggestions of these kinds: ' + taste.join(', ') + '. Lean that way when it fits.' : '');

    var user =
      'Subject detected: ' + (sig.topics.slice(0, 4).join(', ') || 'unclear') + '\n' +
      'Domain: ' + sig.domain + '\n\n' +
      'USER ASKED:\n' + query.slice(0, 700) + '\n\n' +
      (answer ? ('ASSISTANT ANSWERED:\n' + String(answer).slice(0, 1100) + '\n\n') : '') +
      'Write the ' + (count || 4) + ' follow-up chips now.';

    var p = callModel(
      [{ role: 'system', content: sys }, { role: 'user', content: user }],
      { max_tokens: 300, temperature: 0.9 }
    ).then(function (text) {
      var chips = parseChipJson(text);
      if (!chips || chips.length < 2) return null;
      llmCache[key] = chips;
      return chips;
    }).catch(function () {
      return null;
    }).then(function (r) {
      delete llmInFlight[key];
      return r;
    });

    llmInFlight[key] = p;
    return p;
  }

  /**
   * suggest({query, answer, count})
   *   → { signal, chips, refine }
   * `chips` is usable immediately. `refine` resolves to a better,
   * model-written set, or null if the model could not be reached.
   */
  function suggest(ctx) {
    var c = ctx || {};
    var query = String(c.query || '');
    var answer = String(c.answer || '');
    var count = c.count || 4;
    /* chips are built from his words — mend the voice-typing first
       (clavis-luxe.js's dictionary, when it is loaded) */
    try { if (global.ClavisLuxe && typeof global.ClavisLuxe.fixTypos === 'function') query = global.ClavisLuxe.fixTypos(query); } catch (e) {}
    var sig;
    try { sig = analyze(query, answer); } catch (e) { sig = analyze('', ''); }
    /* the caller knows the subject for certain (a photo search resolved
       "lord" to the Hindu deities): it leads, spelled as given */
    var subject = String(c.subject || '').replace(/\s+/g, ' ').trim();
    if (subject) {
      var sj = normalise(subject);
      if (sj) {
        sig.topics = [sj].concat(sig.topics.filter(function (t) { return t !== sj && sj.indexOf(t) === -1 && t.indexOf(sj) === -1; })).slice(0, 7);
        sig.head = sj;
        sig.second = sig.topics[1] || '';
        sig.subjectCased = subject;
        sig.acros = Object.assign({}, sig.acros || {});
        subject.split(' ').forEach(function (w) { if (w) sig.acros[w.toLowerCase()] = w; });
      }
    }

    var chips;
    try { chips = localChips(sig, count); } catch (e) { chips = []; }

    chips.forEach(function (ch) { bump(store.moves.shown, ch.move); });
    bump(store.domains, sig.domain);
    bump(store.lang, sig.lang);
    sig.entities.cities.forEach(function (city) { bump(store.entities, city); });
    store.topCity = topKeys(store.entities, 1)[0] || store.topCity;
    saveStore();

    var refine = (c.useModel === false)
      ? Promise.resolve(null)
      : llmChips(sig, query, answer, count);

    return { signal: sig, chips: chips, refine: refine };
  }

  /* ══════════════════════════════════════════════════════════
     4 · Ghost completion for the composer
     ══════════════════════════════════════════════════════════
     Local first so the grey text appears while you are still
     typing, then the model quietly upgrades it if it has something
     better before you reach for Tab. */

  function historyCompletion(prefix) {
    var p = prefix.toLowerCase().trim();
    if (p.length < 3) return '';
    var hist = store.history;
    var best = '';
    for (var i = hist.length - 1; i >= 0; i--) {
      var h = hist[i].q || '';
      if (h.length <= prefix.length) continue;
      if (h.toLowerCase().indexOf(p) === 0) {
        best = h.slice(prefix.length);
        break;
      }
    }
    return best;
  }

  /* A tiny trigram model over the person's own past messages. It is not
     clever, but it is HIS phrasing, which beats clever. */
  var ngram = null;
  function buildNgram() {
    ngram = {};
    store.history.forEach(function (h) {
      var w = String(h.q || '').toLowerCase().split(/\s+/).filter(Boolean);
      for (var i = 0; i < w.length - 1; i++) {
        var k1 = w[i];
        var k2 = w[i] + ' ' + w[i + 1];
        (ngram[k1] = ngram[k1] || {})[w[i + 1]] = (ngram[k1][w[i + 1]] || 0) + 1;
        if (i + 2 < w.length) {
          (ngram[k2] = ngram[k2] || {})[w[i + 2]] = (ngram[k2][w[i + 2]] || 0) + 1;
        }
      }
    });
  }

  function ngramCompletion(prefix, maxWords) {
    if (!ngram) buildNgram();
    var w = prefix.toLowerCase().trim().split(/\s+/).filter(Boolean);
    if (w.length < 2) return '';
    var out = [];
    var cur = w.slice();
    for (var n = 0; n < (maxWords || 5); n++) {
      var key2 = cur.length >= 2 ? cur[cur.length - 2] + ' ' + cur[cur.length - 1] : null;
      var bag = (key2 && ngram[key2]) || ngram[cur[cur.length - 1]];
      if (!bag) break;
      var bestW = '', bestN = 0;
      Object.keys(bag).forEach(function (k) { if (bag[k] > bestN) { bestN = bag[k]; bestW = k; } });
      if (!bestW || bestN < 2) break;
      out.push(bestW);
      cur.push(bestW);
    }
    return out.length ? ' ' + out.join(' ') : '';
  }

  function localCompletion(prefix) {
    // Instant placeholder ONLY — a short phrasing hint from the user's own
    // n-grams, never a verbatim replay of a whole past prompt (that made it
    // feel like history autocomplete). The model pass writes the real,
    // semantic continuation a beat later and replaces this.
    if (!/\s$/.test(prefix) && prefix.split(/\s+/).length < 3) return '';
    return ngramCompletion(prefix.replace(/\s+$/, ''), 4);
  }

  var ghostCache = {};

  /* Google-AI-Studio-style ghost completion: given the intent behind
     what he's typing — not just a literal match against something he
     typed before — write the rest of the thought as a real sentence.
     A bare word or two is not a useful suggestion; the whole point of
     Tab is to save him from writing the sentence himself. */
  function llmCompletion(prefix, sig) {
    var key = hash('g|' + prefix);
    if (ghostCache[key] != null) return Promise.resolve(ghostCache[key]);

    var recent = store.history.slice(-6).map(function (h) { return '- ' + h.q; }).join('\n');
    var s = sig;
    if (!s) { try { s = analyze(prefix); } catch (e) { s = null; } }
    var topicLine = (s && s.topics && s.topics.length)
      ? ('This looks like it is about: ' + s.topics.slice(0, 3).join(', ') + '. If the prefix reads like a fresh, unrelated request, complete THAT — do not drag in an old topic just because it is on the list below.\n')
      : '';

    var sys =
      'You are an inline autocomplete for a chat composer — the same idea as Google AI Studio\'s ' +
      'prompt autocomplete. Given what the user has typed so far, write ONLY the continuation: the ' +
      'characters that come immediately after their cursor, so that prefix + your text reads as one ' +
      'natural, specific sentence.\n' +
      'Write a REAL continuation, not a stub — normally one full sentence, and sometimes a sentence ' +
      'and a half when the thought genuinely needs it. Never stop after a single word or two; that is ' +
      'not a usable suggestion here.\n' +
      'Judge the continuation from what he actually seems to be asking right now, not only from what ' +
      'he has asked before — his past messages below are for matching his phrasing and voice, not for ' +
      'deciding the topic. A brand-new prefix deserves a brand-new, specific continuation, never a copy ' +
      'of something he already sent.\n' +
      'No quotes, no preamble, no explanation, no markdown, no newline. ' +
      'If the sentence already reads as fully complete, reply with nothing at all. ' +
      'Match his language and register exactly, including Hinglish if that is what he writes. ' +
      'If he typed a partial word, finish that word first (no leading space); otherwise start with a single space.';
    var user =
      (recent ? ('His past messages, for voice and style only — do not repeat these:\n' + recent + '\n\n') : '') +
      topicLine +
      'He is typing right now:\n"' + prefix + '"\n\nContinuation:';

    return callModel(
      [{ role: 'system', content: sys }, { role: 'user', content: user }],
      { max_tokens: 70, temperature: 0.5, fast: true }
    ).then(function (text) {
      var out = String(text || '').replace(/^["'`]+|["'`]+$/g, '').split('\n')[0];
      if (/^\s*$/.test(out)) out = '';
      if (out.length > 220) out = out.slice(0, 220);
      // Model sometimes echoes the prefix back; strip it if so.
      if (out.toLowerCase().indexOf(prefix.toLowerCase()) === 0) out = out.slice(prefix.length);
      ghostCache[key] = out;
      return out;
    }).catch(function () { return ''; });
  }

  /**
   * complete(prefix) → { text, refine }
   * `text` is instant (may be ''). `refine` resolves to a model
   * completion, or '' when unavailable. The model pass always runs
   * (it does not require a history match) so a sentence he has never
   * typed before still gets a real, on-topic suggestion.
   */
  function complete(prefix, opts) {
    var p = String(prefix || '');
    var o = opts || {};
    var local = '';
    try { local = localCompletion(p); } catch (e) {}
    var sig = null;
    if (p.trim().length >= 3) { try { sig = analyze(p); } catch (e) { sig = null; } }
    var refine = (o.useModel === false || p.trim().length < 4)
      ? Promise.resolve('')
      : llmCompletion(p, sig);
    return { text: local, refine: refine };
  }

  /* ══════════════════════════════════════════════════════════
     5 · Feedback — every interaction is a vote
     ══════════════════════════════════════════════════════════ */

  function learn(kind, payload) {
    try {
      var p = payload || {};
      if (kind === 'chip') {
        bump(store.moves.used, p.move || 'LLM', 1);
        if (p.domain) bump(store.domains, p.domain, 2);
      } else if (kind === 'ask') {
        var q = String(p.text || '').trim();
        if (q && q.length < 400) {
          store.history.push({ t: Date.now(), q: q });
          ngram = null;                        // rebuilt lazily on next ghost
          bump(store.lang, detectLang(q));
          extractEntities(q).cities.forEach(function (c) { bump(store.entities, c); });
          store.topCity = topKeys(store.entities, 1)[0] || store.topCity;
        }
      } else if (kind === 'ghost-accept') {
        store.accepted.push({ t: Date.now(), p: String(p.prefix || '').slice(0, 120), g: String(p.ghost || '').slice(0, 120) });
      } else if (kind === 'ghost-reject') {
        store.dismissed++;
      } else if (kind === 'session') {
        store.sessions++;
      }
      saveStore();
    } catch (e) {}
  }

  /* ── Public surface ─────────────────────────────────────── */

  loadStore();
  learn('session', {});

  global.ClavisIQ = {
    version: 3,
    analyze: function (q, a) { try { return analyze(q, a); } catch (e) { return analyze('', ''); } },
    suggest: function (ctx) {
      try { return suggest(ctx); }
      catch (e) { return { signal: analyze('', ''), chips: [], refine: Promise.resolve(null) }; }
    },
    complete: function (prefix, opts) {
      try { return complete(prefix, opts); }
      catch (e) { return { text: '', refine: Promise.resolve('') }; }
    },
    learn: learn,
    // Raw model access for other modules (task controller's city-check /
    // title spelling-correction) that need a one-shot LLM call but not the
    // ghost-suggestion machinery above. Same configured provider/key.
    callModel: callModel,
    memory: function () {
      return {
        language: profileLang(),
        topDomains: topKeys(store.domains, 4),
        topMoves: topKeys(store.moves.used, 4),
        topCities: topKeys(store.entities, 3),
        asked: store.history.length,
        sessions: store.sessions
      };
    },
    reset: function () {
      store = blankStore();
      ngram = null;
      try { localStorage.removeItem(STORE_KEY); } catch (e) {}
    },
    _moves: MOVES
  };
})(window);
