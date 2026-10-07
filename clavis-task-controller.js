/* ============================================================
 * clavis-task-controller.js  ·  services/taskController.ts
 *                               + the task state store
 * ------------------------------------------------------------
 * Owns task lifecycle and turns the engine's real callbacks into
 * a generic event stream the UI can render without knowing what
 * an "agent" is.
 *
 * Integration is by wrapping, not rewriting: voice and composer
 * both already funnel into handleJarvisSend(), which calls
 * JarvisEngine.sendMessage(text, signal, onStep, onTextDelta).
 * That one call carries everything the surface needs — the
 * utterance, real tool events, streaming text, the final answer,
 * errors, and an AbortSignal for cancellation — so it is the only
 * seam we take. Device commands bypass the engine, so
 * ClavisCommands.route is wrapped too.
 *
 * No timers invent progress. If the engine reports no measurable
 * progress, the task stays indeterminate and the UI says so.
 * ============================================================ */
(function (global) {
  'use strict';

  var Model = global.ClavisTaskModel;
  if (!Model) { console.warn('[ClavisTask] model missing; controller disabled'); return; }

  var uid = 0;
  function nextId(p) { return p + '_' + (++uid) + '_' + Date.now().toString(36); }

  /* ── Store ───────────────────────────────────────────────── */
  var listeners = [];
  var tasks = new Map();      // id -> FloatingTaskState (many, for concurrency later)
  var activeId = null;

  function emit() {
    var snap = current();
    for (var i = 0; i < listeners.length; i++) {
      try { listeners[i](snap); } catch (e) { console.warn('[ClavisTask] listener failed', e); }
    }
  }
  function current() { return activeId ? tasks.get(activeId) || null : null; }

  var Store = {
    subscribe: function (fn) {
      listeners.push(fn);
      try { fn(current()); } catch (e) { /* first paint must not break subscribe */ }
      return function () { listeners = listeners.filter(function (l) { return l !== fn; }); };
    },
    get: function (id) { return id ? tasks.get(id) || null : current(); },
    all: function () { return Array.from(tasks.values()); },
    clear: function (id) {
      var target = id || activeId;
      if (!target) return;
      tasks.delete(target);
      if (activeId === target) {
        var rest = Array.from(tasks.keys());
        activeId = rest.length ? rest[rest.length - 1] : null;
      }
      emit();
    }
  };

  /* ── Lifecycle ───────────────────────────────────────────── */

  /**
   * begin(text, options) → task id
   * options: { source: 'voice'|'composer'|'auto', onCancel, onRetry }
   */
  function begin(text, options) {
    var opts = options || {};
    var classification = Model.IntentClassifier.classify(text);
    var id = nextId('task');
    var task = {
      id: id,
      source: opts.source || 'composer',
      classification: classification,
      intent: classification.intent,
      confidence: classification.confidence,
      mode: classification.profile().mode,
      phase: 'understanding',
      title: classification.title(),
      subtitle: '',
      progress: null,          // null = genuinely unknown, never faked
      events: [],
      result: null,
      actions: [],
      requiresApproval: false,
      metrics: {},             // sources / files / pages — only real counts
      attachments: opts.attachments || [],
      images: opts.images || [],
      startedAt: Date.now(),
      endedAt: null,
      error: null,
      _onCancel: opts.onCancel || null,
      _onRetry: opts.onRetry || null,
      _text: String(text || '')
    };
    if (opts.display) task.display = opts.display;
    // auto = wrapper ne source guess kiya (koi asli typed submission nahi).
    if (opts.auto) task.auto = true;
    if (task.source === 'voice') global._clavisLastVoiceTurnAt = Date.now();
    tasks.set(id, task);
    activeId = id;
    emit();
    return id;
  }

  /* Ek hi turn ke liye doosra task mat banao. handleJarvisSend (jarvis_ui)
     pehle hi task begin kar deta hai (source/display ke saath); phir
     ClavisCommands.route / JarvisEngine.sendMessage / ChatEngine.sendMessage
     ke wrappers apna naya 'composer' task bana dete the — wahi low-confidence
     "Rudra24 AI · Thinking… · Stop" panel pop hota tha. Ab: current task abhi
     chal raha hai aur (same text hai ya ~1.5 s pehle shuru hua) → wahi lo. */
  var REUSE_WINDOW_MS = 1500;
  function normText(t) { return String(t || '').toLowerCase().replace(/\s+/g, ' ').trim(); }
  function reusable(text) {
    var t = current();
    if (!t || t.phase === 'completed' || t.phase === 'failed') return null;
    var same = normText(t._text) && normText(t._text) === normText(text);
    var recent = Date.now() - (t.startedAt || 0) <= REUSE_WINDOW_MS;
    return (same || recent) ? t : null;
  }
  /** Spelling-clean the heading shown at the top of the panel. Runs after
   * the instant local title is already on screen (same instant-local +
   * async-LLM-refine idiom as ClavisIQ's ghost suggestions) and only swaps
   * it in if the corrected text still classifies at least as confidently —
   * a bad correction never overwrites a good title with a worse one. */
  function refineTitle(id, rawText) {
    if (!global.ClavisIQ || typeof global.ClavisIQ.callModel !== 'function') return;
    // Opt-in: an extra AI call per request only for a prettier heading used up
    // the free daily quota that answers need (clavis_title_ai = 'true' to enable).
    try { if (localStorage.getItem('clavis_title_ai') !== 'true') return; } catch (_) { return; }
    var text = String(rawText || '').trim();
    if (!text || text.length > 200) return;
    global.ClavisIQ.callModel([
      { role: 'system', content: 'Fix only spelling and obvious typos in the user text below. Keep the language (Hindi/Hinglish/English as given), meaning, and word order exactly the same. Reply with just the corrected text and nothing else.' },
      { role: 'user', content: text }
    ], { fast: true, temperature: 0, max_tokens: 60 }).then(function (corrected) {
      var clean = String(corrected || '').trim().replace(/^["']|["']$/g, '');
      if (!clean || clean.length > 220) return;
      var t = tasks.get(id);
      if (!t || t.phase === 'completed' || t.phase === 'failed') return;
      var reclassified = Model.IntentClassifier.classify(clean);
      if (reclassified && reclassified.confidence >= t.confidence - 0.05) {
        t.classification = reclassified;
        t.title = reclassified.title();
        emit();
      }
    }).catch(function () {});
  }

  function withTask(id, fn) {
    var t = tasks.get(id || activeId);
    if (!t) return null;
    fn(t);
    emit();
    return t;
  }

  /** Generic event ingestion — the only way the body content moves. */
  function event(id, evt) {
    return withTask(id, function (t) {
      var e = {
        id: nextId('evt'),
        timestamp: Date.now(),
        type: evt.type || 'thinking',
        label: evt.label || '',
        detail: evt.detail || '',
        progress: typeof evt.progress === 'number' ? evt.progress : undefined
      };
      t.events.push(e);
      if (t.events.length > 60) t.events.splice(0, t.events.length - 60);
      if (t.phase === 'understanding') t.phase = 'working';
      if (typeof e.progress === 'number') t.progress = Math.max(0, Math.min(1, e.progress));
      if (e.label) t.subtitle = e.label;
      // Re-read the intent: the classifier may have changed its mind.
      t.intent = t.classification.intent;
      t.confidence = t.classification.confidence;
      t.mode = t.classification.profile().mode;
      if (t.confidence >= 0.4) t.title = t.classification.title();
    });
  }

  /** A real tool started. Feeds evidence channel 2 and the event list. */
  function toolStart(id, name, detail) {
    var t = tasks.get(id || activeId);
    if (!t) return null;
    t.classification.observeTool(name);
    return event(id, { type: activityFor(name), label: humanise(name), detail: detail || '' });
  }

  /** A tool finished. Real counts only — nothing is invented here. */
  function toolResult(id, name, outcome) {
    var t = tasks.get(id || activeId);
    if (!t) return null;
    var ok = !outcome || outcome.success !== false;
    var o = outcome || {};

    var sources = firstNumber([o.sources && o.sources.length, o.sourceCount, o.results && o.results.length, o.count]);
    if (sources != null) t.metrics.sources = (t.metrics.sources || 0) + sources;

    var files = firstNumber([o.files && o.files.length, o.fileCount, o.changed && o.changed.length]);
    if (files != null) t.metrics.files = (t.metrics.files || 0) + files;

    var pages = firstNumber([o.pages, o.pageCount]);
    if (pages != null) t.metrics.pages = pages;

    /* Domain counts, for the lead / contact / dataset bodies. Same
       rule as every other metric here: only a number the tool
       actually reported. Nothing is derived, defaulted, or filled
       in from a neighbouring field. */
    var leads = firstNumber([o.leads && o.leads.length, o.leadCount, o.leadsFound]);
    if (leads != null) t.metrics.leads = (t.metrics.leads || 0) + leads;

    var verified = firstNumber([o.verified && o.verified.length, o.verifiedCount]);
    if (verified != null) t.metrics.verified = (t.metrics.verified || 0) + verified;

    var contacts = firstNumber([o.contacts && o.contacts.length, o.contactCount]);
    if (contacts != null) t.metrics.contacts = (t.metrics.contacts || 0) + contacts;

    var emails = firstNumber([o.emails && o.emails.length, o.emailCount]);
    if (emails != null) t.metrics.emails = (t.metrics.emails || 0) + emails;

    var phones = firstNumber([o.phones && o.phones.length, o.phoneCount, o.numbers && o.numbers.length]);
    if (phones != null) t.metrics.phones = (t.metrics.phones || 0) + phones;

    var candidates = firstNumber([o.candidates && o.candidates.length, o.candidateCount]);
    if (candidates != null) t.metrics.candidates = (t.metrics.candidates || 0) + candidates;

    var rows = firstNumber([o.rows && o.rows.length, o.rowCount, o.records && o.records.length]);
    if (rows != null) t.metrics.rows = (t.metrics.rows || 0) + rows;

    var columns = firstNumber([o.columns && o.columns.length, o.columnCount]);
    if (columns != null) t.metrics.columns = columns;

    var recipients = firstNumber([o.recipients && o.recipients.length, o.recipientCount, o.sent]);
    if (recipients != null) t.metrics.recipients = (t.metrics.recipients || 0) + recipients;

    var drafts = firstNumber([o.drafts && o.drafts.length, o.draftCount]);
    if (drafts != null) t.metrics.drafts = (t.metrics.drafts || 0) + drafts;

    if (typeof o.progress === 'number') t.progress = Math.max(0, Math.min(1, o.progress));

    return event(id, {
      type: ok ? 'success' : 'error',
      label: humanise(name) + (ok ? '' : ' failed'),
      detail: ok ? summariseOutcome(o) : (o.error || '')
    });
  }

  function setResult(id, result) {
    return withTask(id, function (t) {
      t.result = result || null;
      if (result && result.type) t.classification.observeResult(result.type);
    });
  }

  function requireApproval(id, request) {
    return withTask(id, function (t) {
      t.phase = 'waiting';
      t.requiresApproval = true;
      t.approval = request || {};
      t.subtitle = (request && request.label) || 'Waiting for your approval';
    });
  }

  function resolveApproval(id, approved) {
    var t = tasks.get(id || activeId);
    if (!t) return null;
    var req = t.approval || {};
    t.requiresApproval = false;
    t.phase = 'working';
    emit();
    try { if (approved) req.onApprove && req.onApprove(approved); else req.onCancel && req.onCancel(); }
    catch (e) { console.warn('[ClavisTask] approval handler failed', e); }
    return t;
  }

  function toggleApprovalOption(id, optionId) {
    return withTask(id, function (t) {
      var req = t.approval;
      if (!t.requiresApproval || !req || !req.multiSelect) return;
      var option = req.options.find(function (o) { return o.id === optionId; });
      if (!option) return;
      var selected = req.selected || [];
      if (selected.indexOf(optionId) >= 0) selected = selected.filter(function (x) { return x !== optionId; });
      else if (option.exclusive) selected = [optionId];
      else selected = selected.filter(function (x) { return !req.options.find(function (o) { return o.id === x && o.exclusive; }); }).concat(optionId);
      req.selected = selected;
    });
  }

  function approvalValues(id) {
    var req = tasks.get(id || activeId)?.approval;
    if (!req) return [];
    return Array.from(new Set((req.options || []).filter(function (o) { return (req.selected || []).indexOf(o.id) >= 0; }).flatMap(function (o) { return o.value || [o.id]; })));
  }

  function complete(id, result, actions) {
    return withTask(id, function (t) {
      t.phase = 'completed';
      t.endedAt = Date.now();
      t.requiresApproval = false;
      if (result) { t.result = result; if (result.type) t.classification.observeResult(result.type); }
      t.actions = actions || t.actions || [];
      t.progress = 1;
      t.intent = t.classification.intent;
      t.mode = t.classification.profile().mode;
    });
  }

  function fail(id, error) {
    return withTask(id, function (t) {
      t.phase = 'failed';
      t.endedAt = Date.now();
      t.requiresApproval = false;
      t.error = {
        message: (error && (error.message || error.toString())) || 'Something went wrong',
        code: (error && error.code) || ''
      };
    });
  }

  function cancel(id) {
    var t = tasks.get(id || activeId);
    if (!t) return null;
    try {
      if (t._onCancel && t._onCancel() === true) {
        event(t.id, { type: 'reading', label: 'Stopping search and preparing collected leads' });
        return t;
      }
    } catch (e) { console.warn('[ClavisTask] cancel failed', e); }
    t.phase = 'failed';
    t.endedAt = Date.now();
    t.error = { message: 'Cancelled', code: 'CANCELLED', cancelled: true };
    emit();
    return t;
  }

  function retry(id) {
    var t = tasks.get(id || activeId);
    if (!t) return null;
    try { t._onRetry ? t._onRetry(t._text) : resend(t._text); }
    catch (e) { console.warn('[ClavisTask] retry failed', e); }
    return t;
  }

  function resend(text) {
    var input = document.getElementById('jarvis-input');
    if (input && typeof global.handleJarvisSend === 'function') {
      input.value = text;
      global.handleJarvisSend();
    }
  }

  /* ── Helpers ─────────────────────────────────────────────── */
  function firstNumber(candidates) {
    for (var i = 0; i < candidates.length; i++) {
      if (typeof candidates[i] === 'number' && isFinite(candidates[i])) return candidates[i];
    }
    return null;
  }

  /* Tool name → user-facing activity verb. Never the tool's own id. */
  var ACTIVITY = [
    { re: /search|serp|google|bing/i,          type: 'searching', label: 'Searching the web' },
    { re: /browse|fetch_url|open_page|crawl/i, type: 'reading',   label: 'Reading pages' },
    { re: /scrape|extract/i,                   type: 'reading',   label: 'Extracting data' },
    { re: /pdf|docx|image|vision|ocr/i,        type: 'analyzing', label: 'Reading the document' },
    { re: /excel|xlsx|sheet|csv/i,             type: 'writing',   label: 'Building the sheet' },
    { re: /mail|whatsapp|send/i,               type: 'executing', label: 'Sending' },
    { re: /lead|prospect|enrich|candidate/i,   type: 'analyzing', label: 'Checking records' },
    { re: /code|patch|diff|file_write/i,       type: 'editing',   label: 'Editing files' },
    { re: /open_app|launch|clipboard|note/i,   type: 'executing', label: 'Running the action' }
  ];
  function activityFor(name) {
    for (var i = 0; i < ACTIVITY.length; i++) if (ACTIVITY[i].re.test(String(name || ''))) return ACTIVITY[i].type;
    return 'thinking';
  }
  function humanise(name) {
    for (var i = 0; i < ACTIVITY.length; i++) if (ACTIVITY[i].re.test(String(name || ''))) return ACTIVITY[i].label;
    return 'Working';
  }
  function summariseOutcome(o) {
    if (!o) return '';
    if (typeof o.summary === 'string') return o.summary.slice(0, 120);
    if (Array.isArray(o.sources)) return o.sources.length + ' sources';
    if (typeof o.count === 'number') return o.count + ' results';
    return '';
  }

  /* ── Bridge: wrap the real call sites ────────────────────── */

  function detectSource() {
    if (global._clavisLastInputSource) {
      var src = global._clavisLastInputSource;
      global._clavisLastInputSource = null;
      return src;
    }
    var btn = document.getElementById('jarvis-voice-btn');
    if (btn && btn.classList.contains('recording')) return 'voice';
    if (global.jarvisHandsFree) return 'voice';
    try { if (global.ClavisLive && typeof global.ClavisLive.isActive === 'function' && global.ClavisLive.isActive()) return 'voice'; } catch (e) {}
    // Abhi-abhi bola gaya turn (jarvis_ui __clavisLastVoiceAt set karta hai; begin() khud _clavisLastVoiceTurnAt).
    var lastVoice = Math.max(Number(global._clavisLastVoiceTurnAt) || 0, Number(global.__clavisLastVoiceAt) || 0);
    if (lastVoice && Date.now() - lastVoice <= 4000) return 'voice';
    return 'composer';
  }

  var wrapped = { engine: false, commands: false, chatEngine: false };

  function wrapChatEngine() {
    var engine = global.ChatEngine;
    if (wrapped.chatEngine || !engine || typeof engine.sendMessage !== 'function') return false;
    var original = engine.sendMessage.bind(engine);

    engine.sendMessage = function (text, signal, options) {
      if (options?.answerOnly || global.ClavisRequestIntent?.classify(text).answerOnly) return original(text, signal, options);
      /* The task surface is for work worth watching and cancelling — a lead
         run, a candidate search. A plain answer already lands in the chat
         thread, and opening a window for it means the user reads the same
         reply twice. So no task is opened up front: either one is already
         running (the caller decided this is a task) or the response itself
         proves there is real work, and only then is one begun. */
      var id = null;
      try {
        var active = current();
        if (active && !['completed', 'failed'].includes(active.phase)) id = active.id;
      } catch (e) {
        console.warn('[ClavisTask] could not read the active task for ChatEngine', e);
        return original(text, signal, options);
      }

      function ensureTask() {
        if (id) return id;
        try {
          id = begin(text, {
            source: detectSource(),
            auto: true,
            onCancel: function () { try { global.stopChatGeneration && global.stopChatGeneration(); } catch (e) {} }
          });
        } catch (e) {
          console.warn('[ClavisTask] could not start task surface for ChatEngine', e);
          id = null;
        }
        return id;
      }

      if (id) event(id, { type: 'thinking', label: 'Analyzing request' });

      if (signal && typeof signal.addEventListener === 'function') {
        signal.addEventListener('abort', function () {
          if (!id) return;
          var t = Store.get(id);
          if (t && t.phase !== 'completed') {
            t.phase = 'failed';
            t.error = { message: 'Cancelled', code: 'CANCELLED', cancelled: true };
            t.endedAt = Date.now();
            emit();
          }
        }, { once: true });
      }

      return Promise.resolve(original(text, signal, options))
        .then(function (response) {
          try {
            var action = response && response.action;
            if (action && action.type === 'generate') {
              ensureTask();
              // Client AI owns this run through AgentCtrl. Starting a second
              // RealScraper run here overwrites its callbacks mid-search.
              if (options?.leadOwner === 'client-chat') event(id, { type: 'reading', label: 'Starting live lead search' });
              else if (needsLeadScope(action)) askLeadScope(id, action, text);
              else runLeadGeneration(id, action, text);
            } else if (action && action.type === 'candidate_search') {
              ensureTask();
              runCandidateGeneration(id, action, text);
            } else if (id) {
              complete(id, buildResult(Store.get(id), response), buildActions(Store.get(id)));
            }
          } catch (e) { console.warn('[ClavisTask] ChatEngine complete failed', e); }
          return response;
        })
        .catch(function (err) {
          try {
            if (!id) { /* no surface was opened — the chat reports the error */ }
            else if (err && (err.name === 'AbortError' || err.code === 'AI_CANCELLED')) {
              var t = Store.get(id);
              if (t) { t.phase = 'failed'; t.error = { message: 'Cancelled', code: 'CANCELLED', cancelled: true }; t.endedAt = Date.now(); emit(); }
            } else {
              fail(id, err);
            }
          } catch (e) { console.warn('[ClavisTask] fail bookkeeping failed', e); }
          throw err;
        });
    };
    wrapped.chatEngine = true;
    return true;
  }

  function wrapEngine() {
    var engine = global.JarvisEngine;
    if (wrapped.engine || !engine || typeof engine.sendMessage !== 'function') return false;
    var original = engine.sendMessage.bind(engine);

    engine.sendMessage = function (text, signal, onStep, onTextDelta, extra) {
      if (extra?.source === 'composer' && (extra.answerOnly || global.ClavisAppMap?.guide?.isQuestion(text))) return original(text, signal, onStep, onTextDelta, extra);
      /* This wrapper sits on the reply path. Nothing in here may throw:
         a panel that fails to open is a cosmetic bug, but a throw before
         original() would silently kill every reply in the app. If the
         instrumentation dies, hand the call straight to the engine. */
      var id = null;
      var reused = false;
      var atts = (extra && extra.attachments) || [];
      var imgs = (extra && extra.images) || (atts ? atts.map(function (a) { return a.dataUrl || a.url; }).filter(Boolean) : []);
      try {
        var existing = reusable(text);
        if (existing) {
          // Same turn — owner (jarvis_ui) ka task, uska source/display waisa hi rahega.
          id = existing.id;
          reused = true;
        } else {
          id = begin(text, {
            source: detectSource(),
            auto: true,
            attachments: atts,
            images: imgs,
            onCancel: function () { try { global.stopJarvisGeneration && global.stopJarvisGeneration(); } catch (e) {} }
          });
        }
        var tObj = Store.get(id);
        if (tObj) {
          if (atts.length || !tObj.attachments) tObj.attachments = atts;
          if (imgs.length || !tObj.images) tObj.images = imgs;
        }
      } catch (e) {
        console.warn('[ClavisTask] could not start task surface; running untracked', e);
        return original(text, signal, onStep, onTextDelta, extra);
      }

      var wrappedStep = function (step) {
        try {
          if (!step) { /* nothing to record */ }
          else if (step.type === 'tool_start') toolStart(id, step.skill || step.tool || step.name, step.detail);
          else if (step.type === 'tool_result') toolResult(id, step.skill || step.tool || step.name, step.outcome);
          else if (step.type === 'progress' && typeof step.progress === 'number') {
            event(id, { type: 'thinking', label: step.label || '', progress: step.progress });
          } else if (step.label) {
            event(id, { type: step.type || 'thinking', label: step.label, detail: step.detail });
          }
        } catch (e) { console.warn('[ClavisTask] step bridge', e); }
        if (typeof onStep === 'function') return onStep(step);
      };

      var sawText = false;
      var wrappedDelta = function (delta) {
        if (!sawText) {
          sawText = true;
          event(id, { type: 'writing', label: 'Writing the reply' });
        }
        if (typeof onTextDelta === 'function') return onTextDelta(delta);
      };

      if (!reused && signal && typeof signal.addEventListener === 'function') {
        signal.addEventListener('abort', function () {
          var t = Store.get(id);
          if (t && t.phase !== 'completed') {
            t.phase = 'failed';
            t.error = { message: 'Cancelled', code: 'CANCELLED', cancelled: true };
            t.endedAt = Date.now();
            emit();
          }
        }, { once: true });
      }

      // Reused task ka owner khud complete/fail karta hai; hum sirf safety net
      // rakhte hain agar owner ne kuch na kiya ho.
      function settleLater(fn) {
        setTimeout(function () {
          var t = Store.get(id);
          if (t && t.phase !== 'completed' && t.phase !== 'failed') { try { fn(); } catch (e) {} }
        }, REUSE_WINDOW_MS);
      }

      return Promise.resolve(original(text, signal, wrappedStep, wrappedDelta, extra))
        .then(function (response) {
          try {
            var done = function () { complete(id, buildResult(Store.get(id), response), buildActions(Store.get(id))); };
            if (reused) settleLater(done); else done();
          }
          catch (e) { console.warn('[ClavisTask] complete failed', e); }
          return response;   // the reply must survive a broken panel
        })
        .catch(function (err) {
          if (reused) {
            settleLater(function () { fail(id, err); });
            throw err;
          }
          try {
            if (err && (err.name === 'AbortError' || err.code === 'AI_CANCELLED')) {
              var t = Store.get(id);
              if (t) { t.phase = 'failed'; t.error = { message: 'Cancelled', code: 'CANCELLED', cancelled: true }; t.endedAt = Date.now(); emit(); }
            } else {
              fail(id, err);
            }
          } catch (e) { console.warn('[ClavisTask] fail bookkeeping failed', e); }
          throw err;         // the app's own error handling still runs
        });
    };
    wrapped.engine = true;
    return true;
  }

  function wrapCommands() {
    var cmds = global.ClavisCommands;
    if (wrapped.commands || !cmds || typeof cmds.route !== 'function') return false;
    var original = cmds.route.bind(cmds);

    cmds.route = function (text) {
      var probe;
      try { probe = Model.IntentClassifier.label(text); }
      catch (e) { return original(text); }   // never block a device command
      // Only surface device commands that plausibly ARE device commands;
      // route() returns {handled:false} for ordinary chat and we don't
      // want a task card flashing for every message.
      var likely = probe.mode === 'system' || probe.intent === 'system_action';
      var existing = likely ? reusable(text) : null;
      var reused = !!existing;
      var id = existing ? existing.id : (likely ? begin(text, { source: detectSource(), auto: true }) : null);
      if (id) event(id, { type: 'executing', label: 'Preparing action' });

      return Promise.resolve(original(text))
        .then(function (res) {
          if (!id) return res;
          // Owner (jarvis_ui) ka task: result wahi likhega; "not handled" par
          // task ko clear mat karo — engine abhi usi task par chalega.
          if (reused) return res;
          if (res && res.handled) {
            // `text` is what belongs on screen (e.g. a website brief); `spoken` is the voice line.
            complete(id, { type: 'text', text: res.text || res.spoken || 'Done' }, []);
          } else {
            Store.clear(id);   // not a device command after all — engine takes over
          }
          return res;
        })
        .catch(function (err) { if (id && !reused) fail(id, err); throw err; });
    };
    wrapped.commands = true;
    return true;
  }

  /* Result assembly — pick the renderer-relevant type from what we
     actually observed, not from the intent alone. */
  function buildResult(task, response) {
    if (!task) return null;
    var text = (response && (response.text || response.output || response.message)) || '';
    var type = 'text';
    if (task.metrics.candidates) type = 'candidates';
    else if (task.metrics.leads) type = 'leads';
    else if (task.metrics.contacts || task.metrics.emails || task.metrics.phones) type = 'contacts';
    else if (task.metrics.rows) type = 'table';
    else if (task.metrics.sources) type = 'sources';
    else if (task.metrics.files) type = 'file';
    else if (/```/.test(text)) type = 'code';
    else if (/^#{1,3}\s|\n[-*]\s/.test(text)) type = 'markdown';
    /* Rows travel with the result so the panel can preview real
       records instead of describing them. Only ever what the engine
       handed back — an array or nothing. */
    var rows = (response && (response.rows || response.leads || response.records || response.items)) || null;
    return {
      type: type,
      text: text,
      summary: firstSentence(text),
      rows: Array.isArray(rows) ? rows : undefined,
      metrics: task.metrics
    };
  }

  function buildActions(task) {
    if (!task) return [];
    if (global.ClavisRequestIntent?.classify(task._text).answerOnly) return [{ id: 'elaborate-answer', label: 'Elaborate this', run: function () { global.handleJarvisSend?.({ text: 'Explain in more detail: ' + task._text, answerOnly: true, elaborate: true }); } }];
    var actions = [];
    var rawText = (task._text || '').toLowerCase();
    var resultText = (task.result && task.result.text ? task.result.text : '').toLowerCase();
    var hasImages = Boolean(task.images && task.images.length);

    // 1. Leads / Excel / Companies / Scraping / Data
    if (
      task.metrics.leads || task.metrics.contacts ||
      /\b(lead|leads|company|companies|excel|sheet|download|export|table|b2b|scrape|database|csv|records)\b/i.test(rawText) ||
      /\b(lead|leads|company|companies|spreadsheet|excel|sheet)\b/i.test(resultText)
    ) {
      var leadRows = function () {
        return (task.result && Array.isArray(task.result.rows) && task.result.rows.length)
          ? task.result.rows
          : (global.allLeads && global.allLeads.length ? global.allLeads : null);
      };
      var hint = function (rows) {
        var c = Array.from(new Set((rows || []).map(function (r) { return r && r.city; }).filter(Boolean))).slice(0, 3).join('-');
        return (c || 'clavis') + '-' + (rows ? rows.length : 0);
      };
      actions.push({
        id: 'download-excel',
        label: 'Download Excel',
        primary: true,
        run: function () {
          try {
            var rows = leadRows();
            if (global.RealScraper && typeof global.RealScraper.exportExcel === 'function' && rows) {
              global.RealScraper.exportExcel(rows, hint(rows));
            } else if (global.LeadsCtrl && typeof global.LeadsCtrl.exportToExcel === 'function') {
              global.LeadsCtrl.exportToExcel();
            } else if (typeof global.exportToExcel === 'function') {
              global.exportToExcel();
            }
          } catch (e) {
            console.warn('[ClavisTask] Excel export error', e);
          }
        }
      });
      if (task.result && Array.isArray(task.result.rows) && task.result.rows.length) {
        actions.push({
          id: 'download-csv',
          label: 'Download CSV',
          run: function () {
            try { var rows = leadRows(); if (rows && global.RealScraper && global.RealScraper.exportCsv) global.RealScraper.exportCsv(rows, hint(rows)); }
            catch (e) { console.warn('[ClavisTask] CSV export error', e); }
          }
        });
        actions.push({
          id: 'show-on-map',
          label: 'Show on map',
          run: function () { var rows = leadRows(); leadsToMap(rows, 'Leads'); }
        });
      }
      actions.push({
        id: 'open-leads-hub',
        label: 'Open Leads Hub',
        run: function () { openView('leads'); }
      });
      return actions;
    }

    // 2. Candidate Sourcing / Hiring / Resumes
    if (
      task.metrics.candidates ||
      /\b(candidate|candidates|resume|cv|hiring|recruit|staff|guard|housekeeping)\b/i.test(rawText)
    ) {
      actions.push({
        id: 'download-candidates',
        label: '📥 Download Candidates (.xlsx)',
        primary: true,
        run: function () {
          try {
            if (global.CandidatesCtrl && typeof global.CandidatesCtrl.exportExcel === 'function') {
              global.CandidatesCtrl.exportExcel();
            } else if (global.showToast) {
              global.showToast('Downloading candidate database...', 'success');
            }
          } catch (e) {}
        }
      });
      actions.push({
        id: 'open-candidates-db',
        label: '👥 Open Candidates DB',
        run: function () { openView('candidate-db'); }
      });
      return actions;
    }

    // 3. Image / Screenshot Inspection (Vision)
    if (
      hasImages ||
      /\b(screenshot|image|photo|picture|inspect|dekho|ye kya hai|ocr|read screen)\b/i.test(rawText)
    ) {
      actions.push({
        id: 'copy-analysis',
        label: '📋 Copy Analysis',
        primary: true,
        run: function () {
          var t = (task.result && task.result.text) || '';
          if (t && navigator.clipboard) {
            navigator.clipboard.writeText(t);
            if (global.showToast) global.showToast('Analysis copied to clipboard.', 'success');
          }
        }
      });
      actions.push({
        id: 'extract-ocr',
        label: '🔍 Extract Text',
        run: function () {
          if (global.ClavisTaskSurface && typeof global.ClavisTaskSurface.submitFollowUp === 'function') {
            global.ClavisTaskSurface.submitFollowUp('Please extract all visible text and numbers from this image word-for-word.');
          }
        }
      });
      return actions;
    }

    // 4. Cold Calling Script / Outreach / Follow-up Draft
    if (
      /\b(script|call|cold call|pitch|outreach|email|message|draft|follow up|whatsapp|sms)\b/i.test(rawText)
    ) {
      actions.push({
        id: 'copy-script',
        label: '📋 Copy Script',
        primary: true,
        run: function () {
          var t = (task.result && task.result.text) || '';
          if (t && navigator.clipboard) {
            navigator.clipboard.writeText(t);
            if (global.showToast) global.showToast('Script copied to clipboard.', 'success');
          }
        }
      });
      actions.push({
        id: 'email-variation',
        label: '✉️ Email Variation',
        run: function () {
          if (global.ClavisTaskSurface && typeof global.ClavisTaskSurface.submitFollowUp === 'function') {
            global.ClavisTaskSurface.submitFollowUp('Isi script ka ek professional cold email variation draft karo.');
          }
        }
      });
      return actions;
    }

    // 5. Code / Programming / Technical
    if (
      /\b(code|function|script|html|css|javascript|python|bug|error|refactor)\b/i.test(rawText) ||
      (task.result && task.result.text && task.result.text.indexOf('```') !== -1)
    ) {
      actions.push({
        id: 'copy-code',
        label: '💻 Copy Code',
        primary: true,
        run: function () {
          var t = (task.result && task.result.text) || '';
          var codeMatch = t.match(/```(?:[\w]*\n)?([\s\S]*?)```/);
          var toCopy = codeMatch ? codeMatch[1].trim() : t;
          if (navigator.clipboard) {
            navigator.clipboard.writeText(toCopy);
            if (global.showToast) global.showToast('Code copied to clipboard.', 'success');
          }
        }
      });
      return actions;
    }

    // 6. General Research / Q&A / Knowledge (Fallback)
    actions.push({
      id: 'copy-answer',
      label: '📋 Copy Answer',
      primary: true,
      run: function () {
        var t = (task.result && task.result.text) || '';
        if (t && navigator.clipboard) {
          navigator.clipboard.writeText(t);
          if (global.showToast) global.showToast('Answer copied to clipboard.', 'success');
        }
      }
    });
    actions.push({
      id: 'key-takeaways',
      label: '⚡ Key Takeaways',
      run: function () {
        if (global.ClavisTaskSurface && typeof global.ClavisTaskSurface.submitFollowUp === 'function') {
          global.ClavisTaskSurface.submitFollowUp('Isko 3 bullet points me summarize karo.');
        }
      }
    });

    return actions;
  }

  /* The app has exposed this under a couple of names over time;
     try each and fail quietly rather than throwing out of a click. */
  function openView(name) {
    try {
      if (global.ClavisTaskSurface) global.ClavisTaskSurface.hide();
      if (global.location.hash !== '#' + name) { global.location.hash = '#' + name; return; }
      if (typeof global.showView === 'function') return global.showView(name);
      if (typeof global.switchView === 'function') return global.switchView(name);
      if (typeof global.navigateTo === 'function') return global.navigateTo(name);
    } catch (e) { console.warn('[ClavisTask] could not open view', name, e); }
  }

  function firstSentence(text) {
    var t = String(text || '').replace(/\s+/g, ' ').trim();
    if (!t) return '';
    var m = t.match(/^.{0,180}?[.!?](\s|$)/);
    var s = m ? m[0].trim() : t.slice(0, 160);
    return s.length < t.length ? s : t.slice(0, 180);
  }

  /* The engine and command modules load in their own order, so poll
     briefly instead of guessing. Stops as soon as both are wrapped. */
  function install() {
    wrapEngine();
    wrapCommands();
    wrapChatEngine();
    return wrapped.engine && wrapped.commands && wrapped.chatEngine;
  }
  if (!install()) {
    var tries = 0;
    var iv = setInterval(function () {
      if (install() || ++tries > 40) clearInterval(iv);
    }, 250);
  }

  /* The sourcing engines run outside JarvisEngine. Bridge their real browser
     events into the same task object so Peek Tasks describes the work that is
     actually happening, rather than stopping at "Starting the agent". */
  /* ── Real engine runners (leads / candidates) ───────────────
   * These are the missing link: chat.js already builds a grounded
   * {type:'generate'|'candidate_search',...} action from the deterministic
   * domain parser, and attachSourcingEvents() below already knows how to
   * turn a nexus:scrapedone/candidatesdone event into a completed task with
   * real rows and the right action buttons. Nothing ever called the real
   * engine or dispatched those events, so the task sat in "reading" forever
   * (leads) or the surface's own composer handler fake-completed it with
   * generic text (candidates). This actually runs RealScraper /
   * CandidateSourcing and feeds their callbacks into the existing pipeline —
   * no new UI, no new completion logic, both already built. */

  /** LLM city check — used only when the deterministic parser had to guess
   * (no city matched in the text), so a real place name the static list
   * doesn't know about isn't silently replaced by the default city. Never
   * runs when the parser already found an explicit match. */
  function cityFromModel(query) {
    if (!global.ClavisIQ || typeof global.ClavisIQ.callModel !== 'function') return Promise.resolve(null);
    return global.ClavisIQ.callModel([
      { role: 'system', content: 'The user is asking for business leads or candidates in an Indian city/town. Reply with ONLY that city/town name, correctly spelled. If no place is mentioned, reply with NONE.' },
      { role: 'user', content: String(query || '') }
    ], { fast: true, temperature: 0, max_tokens: 12 }).then(function (out) {
      var clean = String(out || '').trim().replace(/^["'.\s]+|["'.\s]+$/g, '');
      if (!clean || clean.length > 40 || /^none$/i.test(clean)) return null;
      return clean;
    }).catch(function () { return null; });
  }

  var WANTS_MAP = /\b(map|maps|naksha|nakshe|naksa|location|locations|lokeshan)\b|मैप|नक्शा|नक्शे|लोकेशन/i;

  function needsLeadScope(action) {
    return action && Array.isArray(action.industries) && action.industries.some(function (value) {
      return String(value || '').trim().toUpperCase() === 'ALL';
    });
  }

  function askLeadScope(id, action, rawQuery, runner) {
    var choices = [
      { id: 'hotels', label: 'Hotels & Hospitality', value: ['Hotels & Hospitality'] },
      { id: 'healthcare', label: 'Hospitals & Healthcare', value: ['Hospitals & Healthcare'] },
      { id: 'offices', label: 'Offices & IT Parks', value: ['Corporate Offices', 'IT Companies'] },
      { id: 'industrial', label: 'Factories, Malls & Warehouses', value: ['Manufacturing Companies', 'Shopping Malls', 'Warehouses & Logistics'] },
      { id: 'all-buyers', label: 'All industries', value: ['ALL'], exclusive: true }
    ];
    requireApproval(id, {
      title: 'Which buyer companies should I target?',
      label: 'Select one or more industries, then Start search',
      detail: 'Location: ' + ((action.cities?.length ? action.cities : global.AgentCtrl?.getDefaults?.().locations || [global.SKYLARK_CONFIG?.DEFAULT_CITY || 'Delhi NCR']).join(', ')) + '. Choose several industries together, or All industries. Start search uses this location.',
      multiSelect: true,
      selected: [],
      options: choices,
      onApprove: function (selected) {
        var next = Object.assign({}, action, { industries: Array.isArray(selected) && selected.length ? selected : ['ALL'] });
        event(id, { type: 'reading', label: 'Starting live lead search for the selected buyer segment' });
        if (typeof runner === 'function') runner(id, next, rawQuery);
        else runLeadGeneration(id, next, rawQuery);
      },
      onCancel: function () { event(id, { type: 'reading', label: 'Lead search cancelled before sourcing started' }); }
    });
  }

  /* Put finished lead rows on the Rudra24 AI map; resolves the placed count. */
  function leadsToMap(rows, title) {
    var C = global.ClavisCanvas;
    if (!C || typeof C.showLeads !== 'function' || !rows || !rows.length) return Promise.resolve(null);
    return Promise.resolve(C.showLeads(rows, { title: title })).catch(function () { return null; });
  }

  function runLeadGeneration(id, action, rawQuery) {
    if (!global.RealScraper || typeof global.RealScraper.run !== 'function') {
      fail(id, { message: 'Lead search engine is not available in this build.', code: 'NO_SCRAPER' });
      return;
    }
    if (global.RealScraper.isRunning?.()) {
      fail(id, { message: 'A lead search is already running. Wait for its result before starting another.', code: 'SCRAPE_BUSY' });
      return;
    }
    event(id, { type: 'reading', label: 'Starting live lead search' });
    // "…aur map pe dikhao": the finished leads also go on the map.
    var task0 = Store.get(id);
    if (task0) {
      task0.showOnMap = WANTS_MAP.test(String(rawQuery || ''));
      task0.display = 'window';
      task0._onCancel = function () { global.RealScraper.abort(); return true; };
    }

    function launch(cities) {
      global.RealScraper.setCallbacks({
        onLog: function () {},
        onPhase: function (step, phaseStatus, pct) {
          var frac = Math.max(0, Math.min(1, ((step - 1) + (pct || 0) / 100) / 4));
          event(id, { type: 'reading', label: 'Working through the source plan', progress: frac });
        },
        onStatus: function (d) {
          if (d && Array.isArray(d.leads)) {
            var task = Store.get(id);
            if (task) {
              task.partialRows = d.leads;
              task.metrics.leads = d.leads.length;
            }
          }
          var label = (d && d.text) || 'Working through the source plan';
          if (d && d.count) label = d.count + ' sourced contacts saved. ' + label;
          var state = String((d && d.status) || '').toLowerCase();
          var progress = state === 'queued' ? 0.08 : state === 'running' ? 0.28 :
            (state === 'completed' || state === 'partial') ? 0.94 : undefined;
          if (d?.phase === 'websites' || d?.phase === 'authority' || /checking company websites|enriching contacts|website|public page/i.test(label)) progress = 0.62;
          else if (/sourced contacts saved|contact details|ranking/i.test(label)) progress = 0.78;
          else if (/preparing sourced results|excel|ready/i.test(label)) progress = 0.92;
          event(id, { type: 'reading', label: label, detail: d && d.status || '', progress: progress });
        },
        onLead: function () {},
        onComplete: function (summary) {
          var s = summary || {};
          document.dispatchEvent(new CustomEvent('nexus:scrapedone', { detail: {
            ok: !!(s.leads && s.leads.length), taskId: id,
            leads: s.leads || [], total: s.total, requested: s.requested, added: s.added, completeContacts: s.completeContacts,
            stopped: !!s.stopped
          } }));
        },
        onError: function (message) {
          document.dispatchEvent(new CustomEvent('nexus:scrapedone', { detail: {
            ok: false, taskId: id, error: typeof message === 'string' ? message : 'Lead search failed'
          } }));
        }
      });
      global.RealScraper.run({
        industries: action.industries,
        locations: cities,
        serviceTypes: action.serviceType,
        targetCount: action.count,
        autoExcel: true
      }).catch(function (err) { fail(id, err); });
    }

    if (!action.cities?.length) {
      var defaults = global.AgentCtrl?.getDefaults?.().locations;
      var fallback = defaults?.length ? defaults : [global.SKYLARK_CONFIG?.DEFAULT_CITY || 'Delhi NCR'];
      launch(global.LeadCandidateDomain?.expandLocations(fallback) || fallback); return;
    }
    if (action.explicitCity) { launch(action.cities); return; }
    cityFromModel(rawQuery).then(function (city) {
      launch(city ? [city] : action.cities);
    }).catch(function () { launch(action.cities); });
  }

  function runCandidateGeneration(id, action, rawQuery) {
    if (!global.CandidateSourcing || typeof global.CandidateSourcing.scrape !== 'function') {
      fail(id, { message: 'Candidate search engine is not available in this build.', code: 'NO_CANDIDATE_ENGINE' });
      return;
    }
    event(id, { type: 'reading', label: 'Starting live candidate search' });

    function launch(city) {
      global.CandidateSourcing.scrape({
        role: action.role,
        city: city,
        quantity: action.count,
        onProgress: function (label) { event(id, { type: 'reading', label: label || 'Reading candidate sources' }); }
      }).then(function (out) {
        document.dispatchEvent(new CustomEvent('nexus:candidatesdone', { detail: {
          ok: true, candidates: (out && out.records) || []
        } }));
      }).catch(function (err) { fail(id, err); });
    }

    if (action.explicitCity || !action.city) { launch(action.city); return; }
    cityFromModel(rawQuery).then(function (city) {
      launch(city || action.city);
    }).catch(function () { launch(action.city); });
  }

  function attachSourcingEvents() {
    if (!global.document || document.__clavisSourcingEvents) return;
    document.__clavisSourcingEvents = true;

    document.addEventListener('nexus:scrapeprogress', function (e) {
      var t = current();
      var d = e.detail || {};
      if (!t || t.phase === 'completed' || t.phase === 'failed' || (d.taskId && d.taskId !== t.id)) return;
      event(t.id, { type: 'reading', label: d.label || 'Working through the source plan', progress: typeof d.pct === 'number' ? d.pct / 100 : undefined });
    });

    document.addEventListener('nexus:agentstatus', function (e) {
      var t = current();
      var d = e.detail || {};
      if (!t || t.phase === 'completed' || t.phase === 'failed' || !d.text || (d.taskId && d.taskId !== t.id)) return;
      if (Array.isArray(d.leads)) {
        t.partialRows = d.leads;
        t.metrics.leads = d.leads.length;
      }
      event(t.id, { type: d.finished ? 'success' : 'thinking', label: d.text, progress: typeof d.step === 'number' && d.step > 0 ? Math.min(0.98, d.step / 7) : undefined });
    });

    document.addEventListener('nexus:scrapedone', function (e) {
      var t = current();
      var d = e.detail || {};
      if (!t || t.phase === 'completed' || t.phase === 'failed' || (d.taskId && d.taskId !== t.id)) return;
      if (d.ok === false) {
        fail(t.id, { message: d.error || 'No contactable leads found for this search.', code: 'SCRAPE_FAILED' });
        return;
      }
      var rows = Array.isArray(d.leads) ? d.leads : [];
      t.intent = Model.INTENT.LEAD_GEN;
      t.mode = 'leads';
      t.metrics.leads = Number(d.total || d.added || rows.length || 0);
      if (d.completeContacts != null) t.metrics.completeContacts = Number(d.completeContacts) || 0;
      var named = rows.filter(function (r) { return r && r.contactPerson; }).length;
      var cities = Array.from(new Set(rows.map(function (r) { return r && r.city; }).filter(Boolean)));
      var result = {
        type: 'leads',
        text: d.ok
          ? `${t.metrics.leads}${d.requested && t.metrics.leads < d.requested ? ` of ${d.requested}` : ''} ${d.stopped ? 'leads collected before Stop' : 'sourced leads are ready'}${cities.length ? ` (${cities.join(', ')})` : ''}${named ? ` — ${named} with a named owner / authority` : ''}. Preview below; download Excel or CSV when you are ready.`
          : (t.metrics.leads ? `${t.metrics.leads} leads found.` : 'No leads found matching criteria.'),
        rows: rows,
        metrics: t.metrics
      };
      var wantMap = !!t.showOnMap && rows.length > 0;
      if (wantMap) result.text += ' Placing them on the map…';
      complete(t.id, result, buildActions({ ...t, result: result, metrics: t.metrics, mode: 'leads' }));
      if (wantMap) {
        var tid = t.id;
        leadsToMap(rows, cities.length ? 'Leads · ' + cities.join(', ') : 'Leads').then(function (r) {
          var task = Store.get(tid);
          if (!task || !task.result) return;
          task.result.text = task.result.text.replace(' Placing them on the map…', r
            ? ` ${r.shown} of ${rows.length} placed on the map${r.skipped ? ` (${r.skipped} had no reliable location)` : ''}.`
            : ' The map could not be opened.');
          task.result.mapShown = r ? r.shown : 0;
          emit();
        });
      }
    });

    document.addEventListener('nexus:candidateprogress', function (e) {
      var t = current();
      var d = e.detail || {};
      if (!t || t.phase === 'completed' || t.phase === 'failed') return;
      event(t.id, { type: 'reading', label: d.label || d.text || 'Reading candidate sources', progress: typeof d.pct === 'number' ? d.pct / 100 : undefined });
    });

    document.addEventListener('nexus:candidatesdone', function (e) {
      var t = current();
      var d = e.detail || {};
      if (!t || t.phase === 'completed' || t.phase === 'failed') return;
      var rows = Array.isArray(d.candidates) ? d.candidates : [];
      if (d.ok === false) {
        fail(t.id, { message: d.error || 'Candidate sourcing could not complete.', code: 'CANDIDATE_SEARCH_FAILED' });
        return;
      }
      t.intent = Model.INTENT.DATASET;
      t.mode = 'dataset';
      t.metrics.candidates = Number(d.total || rows.length || 0);
      var result = { type: 'candidates', text: `${t.metrics.candidates} candidate records are ready.`, rows: rows, metrics: t.metrics };
      complete(t.id, result, buildActions({ ...t, result: result, metrics: t.metrics, mode: 'dataset' }));
    });
  }
  attachSourcingEvents();

  global.ClavisTask = {
    Store: Store,
    begin: begin, event: event, toolStart: toolStart, toolResult: toolResult,
    setResult: setResult, complete: complete, fail: fail, cancel: cancel,
    retry: retry, requireApproval: requireApproval, resolveApproval: resolveApproval,
    toggleApprovalOption: toggleApprovalOption, approvalValues: approvalValues,
    requestLeadScope: function (id, action, rawQuery, runner) { askLeadScope(id, action, rawQuery, runner); },
    clear: Store.clear, current: current,
    install: install,

    /* ── self-check: ClavisTask.demo() ─────────────────────── */
    demo: function () {
      var seen = [];
      var off = Store.subscribe(function (t) { seen.push(t && t.phase); });
      var id = begin('find the best crm for small teams', { source: 'composer' });
      toolStart(id, 'web_search');
      toolResult(id, 'web_search', { success: true, sources: [1, 2, 3, 4, 5] });
      var mid = Store.get(id);
      console.assert(mid.phase === 'working', 'phase advances on first event');
      console.assert(mid.metrics.sources === 5, 'real source count recorded');
      console.assert(mid.progress === null, 'progress stays unknown when unreported');
      complete(id, { type: 'sources', text: 'Five options stand out.' }, []);
      var done = Store.get(id);
      console.assert(done.phase === 'completed', 'completes');
      console.assert(seen.indexOf('working') !== -1, 'subscribers saw the working phase');
      Store.clear(id);
      off();
      return 'ok';
    }
  };
})(window);
