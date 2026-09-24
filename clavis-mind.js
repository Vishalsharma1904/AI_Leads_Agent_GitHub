/**
 * ============================================================
 *  CLAVIS MIND (clavis-mind.js)
 *
 *  Clavis's cognitive core: the layer that decides WHETHER to speak, WHAT is
 *  worth remembering, and WHEN an unfinished conversation deserves a follow-up
 *  of its own. Ported to plain browser JS from a desktop-assistant cognition
 *  stack (event bus -> situation -> attention -> initiative -> speech), with
 *  every Node/Electron dependency removed. No build step, no bundler, no key
 *  of its own: it reuses ClavisDirect for the one LLM call it ever makes.
 *
 *  The pipeline, in one line:
 *    emit(event) -> SituationModel -> AttentionEngine -> InitiativeEngine
 *                -> IGNORE | REMEMBER | OBSERVE | WAIT | ASK | SPEAK | WARN
 *
 *  Two things it gives Clavis that it did not have:
 *    1. MIND VOICE  - after a real exchange goes quiet, Clavis privately checks
 *       whether it has one genuinely useful continuation, and says it. Bounded
 *       hard: at most ONE autonomous turn per user turn, energy-budgeted,
 *       repetition-suppressed, and silent the moment the user speaks.
 *    2. ACTIONABLE  - every tool call gets a risk level, high-risk ones need an
 *       explicit confirmation, and results are verified before Clavis claims
 *       success.
 *
 *  Everything is off-by-default-safe: if this file fails to load, every caller
 *  uses `?.` and Clavis behaves exactly as before.
 *
 *  Switches (localStorage):
 *    clavis_mind_enabled        'false' -> whole module inert
 *    clavis_mind_voice_enabled  'false' -> no autonomous speech (pipeline still runs)
 *    clavis_mind_confirm_risk   number 0-4, default 3 (risk >= this needs a yes)
 *    clavis_mind_debug          'true'  -> log every decision
 * ============================================================
 */
'use strict';

window.ClavisMind = (() => {
  // ── small helpers ───────────────────────────────────────
  const clamp = (v) => Math.max(0, Math.min(1, Number.isFinite(Number(v)) ? Number(v) : 0));
  const uid = () => (crypto?.randomUUID?.() || `id_${Date.now()}_${Math.random().toString(36).slice(2)}`);
  const clone = (v) => { try { return structuredClone(v); } catch { return JSON.parse(JSON.stringify(v)); } };
  const norm = (v) => String(v || '').trim().toLowerCase().replace(/\s+/g, ' ');
  const lsBool = (k, dflt) => { const v = localStorage.getItem(k); return v === null ? dflt : v !== 'false'; };
  // Number(null) is 0, not NaN — reading an unset key with a bare Number()
  // silently returns 0 instead of the default. For a risk threshold that means
  // "confirm everything", so the empty case is checked explicitly.
  const lsNum = (k, dflt) => {
    const raw = localStorage.getItem(k);
    if (raw === null || String(raw).trim() === '') return dflt;
    const v = Number(raw);
    return Number.isFinite(v) ? v : dflt;
  };
  const debug = (...a) => { if (localStorage.getItem('clavis_mind_debug') === 'true') console.log('[ClavisMind]', ...a); };

  const CONFIG = {
    // Attention thresholds. Below remember -> forget it; above speak -> say it.
    remember: 0.24, mention: 0.48, speak: 0.68, interrupt: 0.86,
    repetitionCooldownMs: 180000,
    maxMemories: 300,
    tickMinMs: 6000, tickMaxMs: 12000,
    activeWindowMs: 180000,      // a conversation stays "live" this long
    minFollowupDelayMs: 45000,   // give him time to think before any follow-up
  };

  // ══════════════════════════════════════════════════════════
  //  EVENT BUS
  // ══════════════════════════════════════════════════════════
  const bus = (() => {
    const listeners = new Map();
    const history = [];
    const MAX = 200;

    function normalize(input) {
      return Object.freeze({
        type: String(input.type || 'unknown'),
        source: input.source || 'app',
        projectId: input.projectId || null,
        dedupeKey: input.dedupeKey || null,
        id: uid(),
        timestamp: input.timestamp || new Date().toISOString(),
        importance: clamp(input.importance ?? 0.35),
        confidence: clamp(input.confidence ?? 0.8),
        metadata: Object.freeze({ ...(input.metadata || {}) }),
      });
    }

    function publish(event) {
      history.push(event);
      if (history.length > MAX) history.splice(0, history.length - MAX);
      const fns = [...(listeners.get(event.type) || []), ...(listeners.get('*') || [])];
      for (const fn of fns) { try { fn(event); } catch (e) { console.warn('[ClavisMind] listener failed:', e); } }
      return event;
    }

    function subscribe(type, fn) {
      const set = listeners.get(type) || new Set();
      set.add(fn); listeners.set(type, set);
      return () => { set.delete(fn); if (!set.size) listeners.delete(type); };
    }

    return { normalize, publish, subscribe, recent: (n = 25) => history.slice(-Math.max(0, n)) };
  })();

  // ══════════════════════════════════════════════════════════
  //  SITUATION MODEL — the live picture of "what is going on"
  // ══════════════════════════════════════════════════════════
  const situation = (() => {
    const snap = {
      state: 'IDLE',
      activeApp: null, activeWindow: null,
      conversationTopic: null, currentActivity: null,
      userActivity: 'active',           // active | idle | away
      userSpeaking: false, clavisSpeaking: false, clavisWasInterrupted: false,
      silenceStartedAt: null,
      recentImportantEvents: [], recentFailures: [], recentSuccesses: [],
      pendingRisk: null, autonomyPaused: false,
      updatedAt: new Date().toISOString(),
    };

    function stateFor(type, fallback) {
      if (type === 'conversation.user_started_speaking') return 'LISTENING';
      if (type === 'conversation.user_interrupted_clavis') return 'INTERRUPTED';
      if (type === 'conversation.clavis_started_speaking') return 'SPEAKING';
      if (type.startsWith('tool.')) return 'ACTING';
      if (type.startsWith('memory.')) return 'LEARNING';
      if (type.startsWith('conversation.')) return 'THINKING';
      if (type.startsWith('system.') || type.startsWith('desktop.')) return 'OBSERVING';
      return fallback;
    }

    function apply(event) {
      const m = event.metadata;
      snap.state = snap.autonomyPaused ? 'PAUSED' : stateFor(event.type, snap.state);
      snap.updatedAt = event.timestamp;
      if (typeof m.topic === 'string') snap.conversationTopic = m.topic;
      if (typeof m.activity === 'string') snap.currentActivity = m.activity;
      if (typeof m.activeApp === 'string') snap.activeApp = m.activeApp;
      if (typeof m.activeWindow === 'string') snap.activeWindow = m.activeWindow;

      switch (event.type) {
        case 'conversation.user_started_speaking':
          snap.userSpeaking = true; snap.silenceStartedAt = null;
          if (snap.clavisSpeaking) snap.clavisWasInterrupted = true;
          break;
        case 'conversation.user_stopped_speaking':
        case 'conversation.user_input':
          snap.userSpeaking = false; snap.silenceStartedAt = event.timestamp;
          break;
        case 'conversation.clavis_started_speaking':
          snap.clavisSpeaking = true; snap.clavisWasInterrupted = false;
          break;
        case 'conversation.clavis_stopped_speaking':
        case 'conversation.turn_completed':
          snap.clavisSpeaking = false;
          break;
        case 'conversation.user_interrupted_clavis':
          snap.clavisSpeaking = false; snap.clavisWasInterrupted = true;
          break;
        case 'safety.confirmation_required':
          snap.pendingRisk = { eventId: event.id, description: String(m.description || 'A risky action needs confirmation.'), level: Math.round(Math.max(0, Math.min(4, Number(m.riskLevel) || 0))) };
          break;
        case 'safety.confirmation_resolved':
          snap.pendingRisk = null;
          break;
        case 'system.user_idle': snap.userActivity = 'idle'; break;
        case 'system.user_away': snap.userActivity = 'away'; break;
        case 'system.user_active': snap.userActivity = 'active'; break;
      }

      const summary = { id: event.id, type: event.type, timestamp: event.timestamp, importance: event.importance };
      const push = (arr, limit) => { arr.push(summary); if (arr.length > limit) arr.shift(); };
      if (event.importance >= 0.45) push(snap.recentImportantEvents, 40);
      if (/failed|error|crashed|blocked/.test(event.type)) push(snap.recentFailures, 12);
      if (/completed|succeeded|finished|recovered/.test(event.type)) push(snap.recentSuccesses, 12);
      return get();
    }

    function get() {
      const started = snap.silenceStartedAt ? new Date(snap.silenceStartedAt).getTime() : null;
      return { ...clone(snap), silenceSeconds: started ? Math.max(0, Math.floor((Date.now() - started) / 1000)) : 0 };
    }

    function setPaused(paused) {
      snap.autonomyPaused = Boolean(paused);
      snap.state = paused ? 'PAUSED' : 'OBSERVING';
      return get();
    }

    return { apply, get, setPaused };
  })();

  // ══════════════════════════════════════════════════════════
  //  ATTENTION — how much does this event deserve?
  //  Repetition is penalised, interrupting a busy user is expensive.
  // ══════════════════════════════════════════════════════════
  const attention = (() => {
    const seen = new Map();

    function defaults(type, meta) {
      if (/delete|security|data_loss|credential/.test(type)) return { urgency: 0.95, risk: 0.98, relevance: 0.95, userImpact: 0.98, taskRelevance: 0.85 };
      if (/crashed|failed|blocked|confirmation_required/.test(type)) return { urgency: 0.78, risk: 0.72, relevance: 0.86, userImpact: 0.84, taskRelevance: 0.82 };
      if (/completed|succeeded|finished/.test(type)) {
        const recovered = meta.recoveredAfterFailures === true;
        return { urgency: recovered ? 0.62 : 0.36, risk: 0.08, relevance: recovered ? 0.88 : 0.62, userImpact: recovered ? 0.82 : 0.56, taskRelevance: 0.8 };
      }
      if (/user_interrupted|correction/.test(type)) return { urgency: 0.66, risk: 0.2, relevance: 0.92, userImpact: 0.74, taskRelevance: 0.82 };
      if (/active_window_changed|clipboard_changed|frame_received/.test(type)) return { urgency: 0.08, risk: 0.05, relevance: 0.24, userImpact: 0.12, taskRelevance: 0.32 };
      return { urgency: 0.25, risk: 0.15, relevance: 0.5, userImpact: 0.4, taskRelevance: 0.45 };
    }

    // Talking over someone is the one mistake an assistant never recovers from.
    function interruptionCost(s) {
      if (s.pendingRisk?.level >= 3) return 0.05;
      if (s.userSpeaking) return 0.98;
      if (s.clavisSpeaking) return 0.75;
      if (s.userActivity === 'away') return 0.85;
      const app = `${s.activeApp || ''} ${s.activeWindow || ''}`.toLowerCase();
      if (/obs|premiere|resolve|game|youtube|netflix|meet|zoom|teams|presentation/.test(app)) return 0.78;
      return 0.25;
    }

    function semanticKey(event) {
      const m = event.metadata;
      return [event.type, event.projectId, m.path, m.tool, m.application, m.reason]
        .filter((v) => v !== undefined && v !== null && v !== '')
        .join('|').toLowerCase().replace(/\s+/g, ' ').slice(0, 300) || event.type;
    }

    function assess(event, s, at = Date.now()) {
      const key = event.dedupeKey || semanticKey(event);
      const prev = seen.get(key);
      const d = defaults(event.type, event.metadata);
      const sig = (name, fallback) => {
        const v = event.metadata[name];
        return typeof v === 'number' && Number.isFinite(v) ? clamp(v) : clamp(fallback);
      };

      const urgency = sig('urgency', d.urgency);
      const risk = sig('risk', d.risk);
      const relevance = sig('relevance', d.relevance);
      const userImpact = sig('userImpact', d.userImpact);
      const taskRelevance = sig('taskRelevance', d.taskRelevance);
      const cost = sig('interruptionCost', interruptionCost(s));

      const withinCooldown = prev && at - prev.lastSeenAt < CONFIG.repetitionCooldownMs;
      const escalated = prev && urgency > prev.highestUrgency + 0.15;
      const repetitionPenalty = withinCooldown && !escalated ? Math.min(1, 0.48 + prev.count * 0.12) : 0;
      const lowSignal = /active_window_changed|clipboard_changed|frame_received/.test(event.type);
      const novelty = sig('novelty', prev
        ? (withinCooldown ? (escalated ? 0.72 : 0.15) : 0.62)
        : (lowSignal ? 0.28 : 1));

      const factors = { relevance, novelty, urgency, risk, userImpact, taskRelevance, confidence: event.confidence, repetitionPenalty, interruptionCost: cost };
      const weighted =
        relevance * 0.16 + novelty * 0.14 + urgency * 0.18 + risk * 0.20 +
        userImpact * 0.12 + taskRelevance * 0.10 + event.confidence * 0.10 -
        repetitionPenalty * 0.20 - cost * 0.12;
      const score = clamp(weighted * 0.82 + event.importance * 0.18);

      const why = [];
      if (risk >= 0.7) why.push('high risk');
      if (urgency >= 0.7) why.push('time-sensitive');
      if (taskRelevance >= 0.75) why.push('relevant to the current task');
      if (withinCooldown && !escalated) why.push('recently handled; repetition suppressed');
      if (cost >= 0.7) why.push('interrupting the user would be costly');

      return { eventId: event.id, score, factors, semanticKey: key, explanation: why.length ? why : ['routine observation'] };
    }

    function record(a, at = Date.now()) {
      const prev = seen.get(a.semanticKey);
      seen.set(a.semanticKey, {
        lastSeenAt: at,
        count: (prev?.count || 0) + 1,
        highestUrgency: Math.max(prev?.highestUrgency || 0, a.factors.urgency),
      });
      if (seen.size > 600) {
        [...seen.entries()].sort((x, y) => x[1].lastSeenAt - y[1].lastSeenAt)
          .slice(0, 150).forEach(([k]) => seen.delete(k));
      }
    }

    return { assess, record, interruptionCost, _reset: () => seen.clear() };
  })();

  // ══════════════════════════════════════════════════════════
  //  INITIATIVE — turn a score into an action
  // ══════════════════════════════════════════════════════════
  function decide(event, a, s) {
    const social = typeof event.metadata.socialOpportunityScore === 'number'
      ? clamp(event.metadata.socialOpportunityScore) : 0;
    const score = event.type.startsWith('internal.') ? Math.max(a.score, social) : a.score;
    const f = a.factors;
    let action;

    if (s.autonomyPaused) action = score >= CONFIG.remember ? 'OBSERVE' : 'IGNORE';
    else if (f.repetitionPenalty >= 0.55 && f.urgency < 0.8) action = score >= CONFIG.remember ? 'REMEMBER' : 'IGNORE';
    else if (score < CONFIG.remember) action = 'IGNORE';
    else if (score < CONFIG.mention) action = 'REMEMBER';
    else if (score < CONFIG.speak) action = 'WAIT';
    else if (f.risk >= 0.8 || /confirmation_required|delete/.test(event.type)) action = 'WARN';
    else if (score >= CONFIG.interrupt && f.urgency >= 0.75) action = 'WARN';
    else if (event.metadata.needsClarification === true) action = 'ASK';
    else action = 'SPEAK';

    // Internal thoughts already cleared the thought queue and the social gate.
    // Do not apply a second, contradictory threshold to them here.
    if (event.type.startsWith('internal.')) {
      action = event.metadata.internalOnly === true
        ? (score >= CONFIG.remember ? 'OBSERVE' : 'IGNORE')
        : (event.metadata.suggestedAction === 'ASK' ? 'ASK' : 'SPEAK');
    }
    // A user turn already has a direct reply path; never create a second answer.
    if (/^conversation\.(user_input|user_question|user_correction)$/.test(event.type)) {
      action = action === 'IGNORE' ? 'IGNORE' : 'OBSERVE';
    }

    const mayInterrupt = ['SPEAK', 'ASK', 'WARN'].includes(action)
      && f.interruptionCost < (f.risk >= 0.85 ? 1 : 0.8);

    return {
      eventId: event.id, action, attentionScore: score,
      reason: a.explanation[0],
      tone: f.risk >= 0.85 ? 'friendly-serious'
        : /completed|succeeded/.test(event.type) ? 'warm-relieved'
        : f.urgency >= 0.75 ? 'concise-alert' : 'natural-casual',
      shouldSpeak: mayInterrupt,
    };
  }

  // ══════════════════════════════════════════════════════════
  //  SPEECH ORCHESTRATOR — one voice, priority ordered
  //  Without this, a proactive nudge and a real answer talk over each other.
  // ══════════════════════════════════════════════════════════
  const speech = (() => {
    const PRIORITY = { critical_warning: 5, user_response: 4, task_result: 3, conversation_continuation: 2, casual_initiative: 1 };
    const STUCK_MS = 30000;
    let active = null;
    let userSpeaking = false;
    let watchdog = null;
    const queue = [];

    // Nothing can guarantee a "finished speaking" signal — a TTS engine can die,
    // a line can be empty, a tab can be backgrounded mid-sentence. Without this
    // the floor would stay held forever and Clavis would go permanently mute.
    function hold(item) {
      active = item;
      clearTimeout(watchdog);
      watchdog = setTimeout(() => { debug('speech watchdog released a stuck turn'); release(); }, STUCK_MS);
    }

    function release() {
      const done = active;
      active = null;
      clearTimeout(watchdog);
      watchdog = null;
      deliverNext();
      return done;
    }

    function request(req) {
      const item = { id: uid(), source: 'casual_initiative', deliver: () => {}, ...req };
      if (userSpeaking && item.source !== 'critical_warning') return false;
      if (!active) { hold(item); item.deliver(); return true; }
      if (PRIORITY[item.source] > PRIORITY[active.source]) queue.unshift(item); else queue.push(item);
      queue.sort((x, y) => PRIORITY[y.source] - PRIORITY[x.source]);
      return true;
    }

    function deliverNext() {
      if (userSpeaking || active) return;
      const next = queue.shift();
      if (!next) return;
      hold(next);
      try { next.deliver(); } catch (e) { console.warn('[ClavisMind] speech deliver failed:', e); release(); }
    }

    return {
      request,
      onUserSpeechStarted() {
        userSpeaking = true;
        const interrupted = active && active.source !== 'user_response' ? active : null;
        queue.splice(0, queue.length, ...queue.filter((i) => i.source === 'critical_warning'));
        return interrupted;
      },
      onUserSpeechStopped() { userSpeaking = false; deliverNext(); },
      /**
       * A direct answer to the owner does not go through request() — it is
       * spoken by the chat flow. Claim the floor for it anyway, so a casual
       * nudge queues behind the reply instead of landing on top of it.
       */
      observeUserResponse() { if (!active) hold({ id: 'direct-turn', source: 'user_response', deliver: () => {} }); },
      onTurnComplete: release,
      onInterrupted() { const cut = active; active = null; clearTimeout(watchdog); watchdog = null; return cut; },
      status: () => ({ active: active?.source || null, queued: queue.length, userSpeaking }),
      _reset() { active = null; userSpeaking = false; clearTimeout(watchdog); watchdog = null; queue.length = 0; },
      PRIORITY,
    };
  })();

  // ══════════════════════════════════════════════════════════
  //  STRUCTURED MEMORY — typed, confidence-weighted, decaying.
  //  Complements MemoryEngine (leads/chat rows); this stores what Clavis has
  //  LEARNED about the owner: preferences, corrections, project facts.
  // ══════════════════════════════════════════════════════════
  const memory = (() => {
    const KEY = 'clavis_mind_memories';
    let items = [];

    function load() {
      try { items = JSON.parse(localStorage.getItem(KEY) || '[]'); }
      catch { items = []; }
      if (!Array.isArray(items)) items = [];
      return items.length;
    }

    function persist() {
      // Keep the newest, most important ones if we ever hit the cap.
      if (items.length > CONFIG.maxMemories) {
        items.sort((a, b) => (b.importance + b.confidence) - (a.importance + a.confidence));
        items = items.slice(0, CONFIG.maxMemories);
      }
      try { localStorage.setItem(KEY, JSON.stringify(items)); }
      catch (e) { console.warn('[ClavisMind] memory persist failed:', e); }
    }

    function tokenize(text) {
      return new Set(norm(text).split(/[^a-z0-9ऀ-ॿ]+/).filter((t) => t.length > 2));
    }

    function add({ kind = 'semantic', content, tags = [], confidence = 0.65, importance = 0.5, source = 'clavis', expiresAt = null }) {
      const text = String(content || '').trim();
      if (!text) return null;
      const dup = items.find((i) => i.active && i.kind === kind && norm(i.content) === norm(text));
      const now = new Date().toISOString();
      if (dup) {
        // Hearing the same thing twice is evidence, not noise.
        dup.confirmations += 1;
        dup.confidence = clamp(Math.max(dup.confidence, confidence) + 0.04);
        dup.importance = clamp(Math.max(dup.importance, importance));
        dup.tags = [...new Set([...dup.tags, ...tags])];
        dup.updatedAt = now;
        persist();
        return clone(dup);
      }
      const item = {
        id: uid(), kind, content: text, tags: [...new Set(tags)],
        confidence: clamp(confidence), confirmations: 1, importance: clamp(importance),
        source, createdAt: now, updatedAt: now, lastAccessedAt: now, accessCount: 0,
        expiresAt, supersedesId: null, active: true,
      };
      items.push(item);
      persist();
      return clone(item);
    }

    /** An explicit user correction beats everything it replaces. */
    function correct(targetId, correctedContent) {
      const target = targetId ? items.find((i) => i.id === targetId && i.active) : null;
      if (target) { target.active = false; target.confidence = clamp(target.confidence * 0.35); target.updatedAt = new Date().toISOString(); }
      const created = add({ kind: 'correction', content: correctedContent, tags: ['user-correction'], confidence: 0.98, importance: 0.9, source: 'user-correction' });
      if (created && target) {
        const stored = items.find((i) => i.id === created.id);
        if (stored) { stored.supersedesId = target.id; persist(); }
      }
      return created;
    }

    function score(item, queryTokens, at) {
      const itemTokens = tokenize(`${item.content} ${item.tags.join(' ')}`);
      const overlap = queryTokens.size
        ? [...queryTokens].filter((t) => itemTokens.has(t)).length / queryTokens.size
        : 0.45;
      const ageDays = Math.max(0, (at - new Date(item.updatedAt).getTime()) / 86400000);
      const recency = Math.exp(-ageDays / 60);
      return overlap * 0.42 + recency * 0.16 + item.importance * 0.18 + item.confidence * 0.18
        + (item.kind === 'correction' ? 0.12 : 0);
    }

    function retrieve({ text = '', kinds = null, limit = 8, minConfidence = 0.2 } = {}) {
      const at = Date.now();
      const q = tokenize(text);
      const ranked = items
        .filter((i) => i.active && i.confidence >= minConfidence
          && !(i.expiresAt && new Date(i.expiresAt).getTime() <= at)
          && (!kinds?.length || kinds.includes(i.kind)))
        .map((i) => ({ i, s: score(i, q, at) }))
        .sort((a, b) => b.s - a.s)
        .slice(0, Math.max(1, Math.min(limit, 50)));
      const now = new Date().toISOString();
      for (const { i } of ranked) { i.lastAccessedAt = now; i.accessCount += 1; }
      if (ranked.length) persist();
      return ranked.map(({ i }) => clone(i));
    }

    /** Old, unconfirmed, unimportant memories fade instead of piling up forever. */
    function decay(at = Date.now()) {
      let expired = 0, decayed = 0;
      for (const i of items) {
        if (!i.active) continue;
        if (i.expiresAt && new Date(i.expiresAt).getTime() <= at) { i.active = false; expired++; continue; }
        const ageDays = (at - new Date(i.updatedAt).getTime()) / 86400000;
        if (ageDays > 30 && i.importance < 0.55 && i.confirmations < 2) {
          i.confidence = clamp(i.confidence * 0.97);
          i.updatedAt = new Date(at).toISOString();
          decayed++;
        }
      }
      if (expired || decayed) persist();
      return { expired, decayed };
    }

    load();
    return { add, correct, retrieve, decay, load, list: () => items.map(clone), count: () => items.filter((i) => i.active).length, _clear() { items = []; persist(); } };
  })();

  // ══════════════════════════════════════════════════════════
  //  CONVERSATION CONTINUATION — is there an unfinished thread?
  // ══════════════════════════════════════════════════════════
  const continuation = (() => {
    let thread = null;

    const openEnded = (t) => /\?|\b(later|maybe|baad me|not sure|decide|figure out|confused|samajh|pata nahi|soch|dekhte)\b/i.test(t);
    const boundedUnique = (arr, limit) => [...new Set(arr.map((s) => String(s).trim()).filter(Boolean))].slice(-limit);

    function observe(event) {
      const text = typeof event.metadata.text === 'string' ? event.metadata.text.trim() : '';
      const at = new Date(event.timestamp).getTime();

      if (/^conversation\.(user_input|user_question|user_correction)$/.test(event.type) && text) {
        const prev = thread;
        thread = {
          id: prev?.id || uid(),
          topic: text.replace(/\s+/g, ' ').slice(0, 140) || prev?.topic || 'current conversation',
          status: 'ACTIVE',
          importance: Math.max(prev?.importance || 0.5, event.importance),
          unresolvedPoints: boundedUnique([...(prev?.unresolvedPoints || []), text], 6),
          openQuestions: boundedUnique([...(prev?.openQuestions || []), ...(openEnded(text) ? [text] : [])], 5),
          lastUserStatement: text,
          lastClavisStatement: prev?.lastClavisStatement || null,
          interruptedThoughts: prev?.interruptedThoughts || [],
          lastUserAt: at, lastClavisAt: prev?.lastClavisAt || null,
          activeUntil: at + CONFIG.activeWindowMs,
          autonomousTurnsSinceUser: 0,
        };
        return;
      }
      if (event.type === 'conversation.turn_completed' && text && thread) {
        thread.lastClavisStatement = text;
        thread.lastClavisAt = at;
        thread.status = 'OPEN_ENDED';
        thread.activeUntil = at + CONFIG.activeWindowMs;
        return;
      }
      if (event.type === 'conversation.user_interrupted_clavis' && thread) {
        thread.status = 'INTERRUPTED';
        const cut = typeof event.metadata.interruptedThought === 'string' ? event.metadata.interruptedThought.trim() : '';
        if (cut) thread.interruptedThoughts = boundedUnique([...thread.interruptedThoughts, cut], 4);
        return;
      }
      if (event.type === 'internal.autonomous_speech_completed' && thread) {
        thread.autonomousTurnsSinceUser += 1;
        thread.status = 'WAITING_FOR_USER';
      }
    }

    function classifySilence(s, at) {
      const recent = thread?.lastUserAt ? at - thread.lastUserAt < CONFIG.activeWindowMs : false;
      if (s.userActivity === 'away' && !recent) return 'USER_AWAY';
      const app = `${s.activeApp || ''} ${s.activeWindow || ''}`.toLowerCase();
      if (/obs|premiere|resolve|game|meet|zoom|record|presentation/.test(app)) return 'WORKING_SILENCE';
      if (!thread || at > thread.activeUntil) return 'NATURAL_END';
      if (thread.status === 'INTERRUPTED') return 'AWKWARD_UNRESOLVED_SILENCE';
      if (thread.status === 'ACTIVE' || thread.status === 'OPEN_ENDED') return 'CONVERSATIONAL_PAUSE';
      return 'THINKING_SILENCE';
    }

    /**
     * The single gate that stops Clavis from becoming a chatterbox: a follow-up
     * needs a real exchange (user said something AND Clavis replied), the thread
     * still live, at most one autonomous turn, and a silence that is a pause —
     * not the user walking away or deep in another app.
     */
    function opportunity(s, at = Date.now()) {
      if (!thread || !thread.lastUserStatement || !thread.lastClavisStatement) return null;
      if (s.autonomyPaused || s.userSpeaking || s.clavisSpeaking) return null;
      if (thread.autonomousTurnsSinceUser >= 1 || at > thread.activeUntil) return null;
      const lastTurnAt = thread.lastClavisAt || thread.lastUserAt || at;
      if (at - lastTurnAt < CONFIG.minFollowupDelayMs) return null;
      const silenceType = classifySilence(s, at);
      if (['USER_AWAY', 'WORKING_SILENCE', 'NATURAL_END'].includes(silenceType)) return null;
      const reason = thread.interruptedThoughts.length ? 'interrupted_thought'
        : thread.openQuestions.length ? 'open_question' : 'unfinished_conversation';
      return { reason, thread: clone(thread), silenceType };
    }

    return { observe, opportunity, classifySilence, getThread: () => (thread ? clone(thread) : null), _reset: () => { thread = null; } };
  })();

  // ══════════════════════════════════════════════════════════
  //  CURIOSITY — is there a gap worth asking about?
  // ══════════════════════════════════════════════════════════
  function detectCuriosity(thread) {
    const statement = thread?.lastUserStatement;
    if (!statement) return null;
    const uncertain = /\b(later|maybe|baad|not sure|decide|either|or|should|want|learn|remember|confirm|dekhte|soch)\b/i.test(statement);
    if (!uncertain && !thread.openQuestions.length) return null;
    return {
      known: statement,
      unknown: 'One relevant preference, constraint or assumption is still unclear.',
      importance: Math.min(0.9, thread.importance + 0.12),
    };
  }

  // ══════════════════════════════════════════════════════════
  //  SOCIAL INITIATIVE — an energy budget for speaking unprompted.
  //  Speaking costs energy; it recharges slowly; the user engaging refunds it.
  // ══════════════════════════════════════════════════════════
  const social = (() => {
    let energy = 1;
    let lastUpdate = Date.now();
    let quietUntil = 0;
    const spoken = new Map();
    const SPEAK_THRESHOLD = 0.68;
    const REPEAT_COOLDOWN_MS = 300000;

    function recharge(at) {
      energy = Math.min(1, energy + Math.max(0, at - lastUpdate) / 600000); // full recharge ≈ 10 min
      lastUpdate = at;
    }

    function semanticKeyFor(t) {
      return `${t.origin}|${t.relatedTopic || ''}|${t.content}`
        .toLowerCase().replace(/[^a-z0-9ऀ-ॿ ]/g, ' ').replace(/\s+/g, ' ')
        .trim().split(' ').slice(0, 24).join(' ');
    }

    function cost(s) {
      if (s.userSpeaking) return 1;
      if (s.clavisSpeaking) return 0.9;
      if (s.userActivity === 'away') return 0.95;
      const app = `${s.activeApp || ''} ${s.activeWindow || ''}`.toLowerCase();
      if (/obs|premiere|resolve|game|youtube|netflix|meet|zoom|record|presentation/.test(app)) return 0.85;
      if (s.userActivity === 'idle') return 0.35;
      return 0.18;
    }

    function evaluate(thought, s, at = Date.now(), ctx = {}) {
      recharge(at);
      const key = semanticKeyFor(thought);
      const prev = spoken.get(key);
      const repeated = prev !== undefined && at - prev < REPEAT_COOLDOWN_MS;
      const interruptionCost = cost(s);
      const availability = Math.max(0, 1 - interruptionCost);
      const continuationValue = ctx.activeConversation ? 0.9
        : thought.origin === 'unfinished_thread' ? 0.9
        : thought.origin === 'curiosity' ? 0.78 : 0.62;
      const score = clamp(
        availability * 0.20 + thought.relevance * 0.24 + thought.novelty * 0.18 +
        thought.socialValue * 0.18 + continuationValue * 0.20
      );
      const opportunity = { score, reason: repeated ? 'recently expressed' : `${thought.origin} with contextual value`, availability, interruptionCost, continuationValue };

      if (repeated) return { decision: 'DROP', opportunity, semanticKey: key };
      if (at < quietUntil && thought.urgency < 0.9) return { decision: 'WAIT', opportunity, semanticKey: key };
      if (s.userSpeaking || s.clavisSpeaking || s.userActivity === 'away') return { decision: 'REVISIT_LATER', opportunity, semanticKey: key };
      const threshold = ctx.activeConversation ? Math.min(SPEAK_THRESHOLD, 0.62) : SPEAK_THRESHOLD;
      if (score < threshold) return { decision: score >= threshold - 0.12 ? 'REMEMBER' : 'DROP', opportunity, semanticKey: key };
      if (energy < 0.55 && thought.urgency < 0.8) return { decision: 'WAIT', opportunity, semanticKey: key };
      const decision = thought.suggestedAction === 'ASK' || thought.origin === 'curiosity' ? 'ASK' : 'SPEAK';
      return { decision, opportunity, semanticKey: key };
    }

    return {
      evaluate,
      recordSpeech(key, at = Date.now()) {
        spoken.set(key, at);
        energy = Math.max(0, energy - 0.65);
        if (spoken.size > 150) [...spoken.entries()].sort((a, b) => a[1] - b[1]).slice(0, 40).forEach(([k]) => spoken.delete(k));
      },
      restoreFromUser() { energy = Math.min(1, energy + 0.4); },
      suppress(ms) { quietUntil = ms === undefined ? Number.POSITIVE_INFINITY : Date.now() + Math.max(0, ms); },
      restore() { quietUntil = 0; energy = Math.max(energy, 0.7); },
      status(at = Date.now()) { recharge(at); return { energy, quietUntil }; },
      _reset() { energy = 1; quietUntil = 0; spoken.clear(); lastUpdate = Date.now(); },
    };
  })();

  // ══════════════════════════════════════════════════════════
  //  AUTONOMOUS MIND — the mind voice
  //  Ticks quietly. When (and only when) an unfinished exchange is sitting
  //  there, it asks the model for ONE private candidate thought, runs it past
  //  the social gate, and speaks it through the orchestrator.
  // ══════════════════════════════════════════════════════════
  const mind = (() => {
    let timer = null, running = false, inFlight = false;
    let queue = [];
    let lastOpportunityKey = '', lastOpportunityAt = 0;
    const counters = { ticks: 0, thoughts: 0, dropped: 0, spoken: 0, interrupted: 0 };

    // With Clavis Live connected, Live is the one voice and keeps its own
    // conversation going — a second brain speaking follow-ups on top of it
    // was the "two AIs talking at once" (one of them in broken Hindi).
    const voiceEnabled = () => lsBool('clavis_mind_voice_enabled', true) && !window.ClavisLive?.isAvailable?.();

    function buildPrompt(ctx) {
      const memoryLines = ctx.memories.slice(0, 5).map((m) => `- ${m.content.slice(0, 240)}`).join('\n');
      return [
        "You are Clavis's private internal thought generator. This is an endogenous cognitive cycle — the user did NOT send a new message.",
        'Return NO_COGNITION if there is no genuinely useful, novel, contextually relevant continuation or question. Silence is the correct answer most of the time.',
        'Do not produce chain-of-thought. Return only a compact JSON candidate.',
        `Opportunity: ${ctx.reason}`,
        `Topic: ${ctx.thread.topic}`,
        `Last user statement: ${ctx.thread.lastUserStatement || 'none'}`,
        `Last Clavis statement: ${ctx.thread.lastClavisStatement || 'none'}`,
        `Unresolved points: ${ctx.thread.unresolvedPoints.join(' | ') || 'none'}`,
        `Open questions: ${ctx.thread.openQuestions.join(' | ') || 'none'}`,
        ctx.curiosity ? `Unclear: ${ctx.curiosity.unknown} Context: ${ctx.curiosity.known}` : 'Unclear: none detected',
        `Relevant memories:\n${memoryLines || '- none'}`,
        'Voice: mirror the conversation. Hindi/Hinglish -> natural conversational Hindi in Devanagari script, with English business words (leads, email, report) in Roman letters; English -> polished English. Never broken or translated-sounding Hindi. Address the user as "sir". One or two short sentences, max ~28 words. No greeting, no emoji, no self-introduction, and never repeat something already said.',
        'JSON schema:',
        '{"origin":"curiosity|unfinished_thread|memory|goal|reflection|social","content":"the line to actually say","relevance":0.0,"novelty":0.0,"urgency":0.0,"socialValue":0.0,"confidence":0.0,"suggestedAction":"SPEAK|ASK|WAIT","relatedTopic":"topic"}',
        'Score high only when saying this would genuinely improve the conversation. Never make small talk just because time passed.',
      ].join('\n');
    }

    function parseThought(text, ctx) {
      const trimmed = String(text || '').trim();
      if (!trimmed || /^NO_COGNITION\b/i.test(trimmed)) return null;
      const json = trimmed.match(/\{[\s\S]*\}/)?.[0];
      if (!json) return null;
      let v;
      try { v = JSON.parse(json); } catch { return null; }
      const content = String(v.content || '').trim();
      if (!content) return null;
      const origins = ['memory', 'curiosity', 'unfinished_thread', 'goal', 'reflection', 'social'];
      const num = (k, d) => (Number.isFinite(Number(v[k])) ? clamp(v[k]) : d);
      return {
        id: uid(), createdAt: Date.now(),
        origin: origins.includes(v.origin) ? v.origin : 'unfinished_thread',
        content,
        relevance: num('relevance', 0.7), novelty: num('novelty', 0.65),
        urgency: num('urgency', 0.2), socialValue: num('socialValue', 0.7),
        confidence: num('confidence', 0.65),
        suggestedAction: ['SPEAK', 'ASK', 'WAIT'].includes(v.suggestedAction) ? v.suggestedAction : 'SPEAK',
        relatedTopic: typeof v.relatedTopic === 'string' ? v.relatedTopic : ctx.thread.topic,
        expiresAt: Date.now() + 180000,
      };
    }

    async function generate(ctx) {
      if (!window.ClavisDirect?.complete || !window.ClavisDirect.hasKey?.()) return null;
      const data = await window.ClavisDirect.complete({
        messages: [
          { role: 'system', content: buildPrompt(ctx) },
          { role: 'user', content: 'Produce your candidate now, or NO_COGNITION.' },
        ],
        max_tokens: 220,
      });
      return parseThought(data?.choices?.[0]?.message?.content, ctx);
    }

    function enqueue(t) {
      queue.push(t);
      queue.sort((a, b) => (b.relevance * 0.3 + b.novelty * 0.2 + b.urgency * 0.2 + b.socialValue * 0.3)
        - (a.relevance * 0.3 + a.novelty * 0.2 + a.urgency * 0.2 + a.socialValue * 0.3));
      if (queue.length > 12) { counters.dropped += queue.length - 12; queue = queue.slice(0, 12); }
    }

    function evaluateQueue(s, at) {
      const thought = queue[0];
      if (!thought) return;
      const thread = continuation.getThread();
      const activeConversation = Boolean(thread?.lastUserAt && at - thread.lastUserAt < CONFIG.activeWindowMs && thread.autonomousTurnsSinceUser < 1);
      const ev = social.evaluate(thought, s, at, { activeConversation });
      debug('initiative', ev.decision, ev.opportunity.score.toFixed(2), thought.content.slice(0, 60));
      if (ev.decision === 'DROP') { queue.shift(); counters.dropped += 1; return; }
      if (!['SPEAK', 'ASK'].includes(ev.decision)) return;

      queue.shift();
      social.recordSpeech(ev.semanticKey, at);
      api.emit({
        type: thought.origin === 'curiosity' ? 'internal.curiosity_detected' : 'internal.unfinished_topic',
        source: 'internal',
        importance: Math.max(0.72, ev.opportunity.score),
        confidence: thought.confidence,
        dedupeKey: ev.semanticKey,
        metadata: {
          thoughtId: thought.id, thought: thought.content, origin: thought.origin,
          topic: thought.relatedTopic, suggestedAction: ev.decision,
          relevance: thought.relevance, novelty: thought.novelty, urgency: thought.urgency,
          userImpact: thought.socialValue, interruptionCost: ev.opportunity.interruptionCost,
          socialOpportunityScore: ev.opportunity.score,
        },
      });
      speak(thought.content, thought.id);
    }

    /** Route autonomous speech through the orchestrator so it can never talk over a real answer. */
    function speak(line, thoughtId) {
      speech.request({
        source: 'conversation_continuation',
        thoughtId,
        deliver: () => {
          counters.spoken += 1;
          try {
            window.appendJarvisBubble?.('assistant', String(line).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])));
            window.scrollJarvisToBottom?.();
          } catch (_) {}
          // speakJarvisText resolves when it STARTS speaking, not when it ends —
          // the floor is released by noteSpeakingStopped (or the watchdog).
          Promise.resolve(window.speakJarvisText?.(line)).catch(() => speech.onTurnComplete());
          api.emit({ type: 'internal.autonomous_speech_completed', source: 'internal', importance: 0.3, metadata: { internalOnly: true, thoughtId } });
          window.dispatchEvent(new CustomEvent('clavis:mindvoice', { detail: { line, thoughtId } }));
        },
      });
    }

    async function tick(at = Date.now()) {
      if (inFlight || !lsBool('clavis_mind_enabled', true)) return;
      inFlight = true;
      counters.ticks += 1;
      try {
        queue = queue.filter((t) => !t.expiresAt || t.expiresAt > at);
        const s = situation.get();
        if (!voiceEnabled()) return;
        // A hidden tab has no user to talk to; do not burn a request on it.
        if (document.hidden) return;

        const opp = continuation.opportunity(s, at);
        if (opp) {
          const key = `${opp.thread.id}:${opp.thread.lastUserAt}:${opp.thread.lastClavisAt}:${opp.reason}`;
          // One deep thought per opportunity (or per minute) — not per tick.
          if (key !== lastOpportunityKey || at - lastOpportunityAt >= 60000) {
            lastOpportunityKey = key; lastOpportunityAt = at;
            const ctx = {
              reason: opp.reason, thread: opp.thread, situation: s,
              memories: memory.retrieve({ text: opp.thread.topic, limit: 5 }),
              curiosity: detectCuriosity(opp.thread),
            };
            try {
              const thought = await generate(ctx);
              if (thought) { enqueue(thought); counters.thoughts += 1; debug('thought', thought.origin, thought.content); }
            } catch (e) {
              // A provider hiccup must not kill cognition — retry this opportunity in ~10s.
              lastOpportunityAt = at - 50000;
              debug('thought generation failed:', e?.message || e);
            }
          }
        }
        evaluateQueue(situation.get(), Date.now());
      } finally {
        inFlight = false;
      }
    }

    function schedule() {
      if (!running || timer) return;
      const delay = CONFIG.tickMinMs + Math.floor(Math.random() * (CONFIG.tickMaxMs - CONFIG.tickMinMs + 1));
      timer = setTimeout(() => { timer = null; tick().finally(schedule); }, delay);
    }

    return {
      start() { if (running) return; running = true; schedule(); },
      stop() { running = false; if (timer) { clearTimeout(timer); timer = null; } },
      tick,
      markInterrupted(remaining) {
        counters.interrupted += 1;
        speech.onInterrupted();
        if (remaining && String(remaining).trim()) {
          enqueue({ id: uid(), createdAt: Date.now(), origin: 'unfinished_thread', content: String(remaining).trim(), relevance: 0.78, novelty: 0.65, urgency: 0.25, socialValue: 0.72, confidence: 0.7, suggestedAction: 'SPEAK', expiresAt: Date.now() + 180000 });
        }
      },
      status: () => ({ running, queued: queue.length, counters: { ...counters }, thread: continuation.getThread(), social: social.status() }),
      _reset() { queue = []; lastOpportunityKey = ''; lastOpportunityAt = 0; },
    };
  })();

  // ══════════════════════════════════════════════════════════
  //  ACTIONABLE — tool risk, confirmation, result verification
  //  Every skill gets a risk level; risk >= threshold needs an explicit yes;
  //  the critic checks the result actually happened before Clavis claims it did.
  // ══════════════════════════════════════════════════════════
  const safety = (() => {
    const READ_ONLY = /^(get|list|read|search|find|show|export|filter|describe|stats)/i;
    const RISKY = {
      send_email: 3, delete: 4, remove: 3, clear: 3, purge: 4,
      create_new_skill: 3, update_lead_status: 1, add_candidate: 1,
      // Mouse/keyboard control touches the real desktop, not just this tab —
      // a misjudged click or typed shortcut can submit a form, close work, or
      // land in the wrong window. move/scroll are read-adjacent (level 2,
      // below the default confirm threshold of 3) since they can't commit
      // anything; click/drag/type/key need an explicit yes every time.
      pc_move_mouse: 2, pc_scroll: 2, pc_get_screen: 0,
      pc_click: 3, pc_drag: 3, pc_type_text: 3, pc_press_key: 3,
      // Window management: read-only/repositioning is low risk (nothing is
      // committed or lost); closing a window can drop unsaved work in it, so
      // it's held to the same 'needs a yes' tier as click/drag/type.
      pc_list_windows: 0, pc_get_cursor_position: 0,
      pc_minimize_window: 1, pc_maximize_window: 1, pc_restore_window: 1, pc_focus_window: 1,
      pc_close_window: 3, pc_double_click: 3, pc_right_click: 3,
      // File operations: reads are free (same reasoning as READ_ONLY above);
      // a plain write/move/mkdir is a normal 'writes' action; pc_delete_file
      // needs no entry of its own -- it already matches the generic 'delete'
      // pattern above (risk 4). Running arbitrary code can do anything a
      // delete can and more, so it's held at the same max tier.
      pc_list_files: 0, pc_search_files: 0, pc_read_file: 0,
      pc_write_file: 1, pc_move_file: 1, pc_create_folder: 1,
      pc_run_python_script: 4,
    };
    // Skills that already show their own full preview + confirm. Their risk
    // level stays honest (the model and the UI should see it), but gating them
    // again here would ask the owner the same question twice.
    const SELF_CONFIRMING = new Set(['send_email']);

    /** 0 = free, 1 = writes, 2 = notable, 3 = needs a yes, 4 = destructive. */
    function assess(name, args = {}) {
      const n = String(name || '');
      for (const [pattern, level] of Object.entries(RISKY)) {
        if (n === pattern || n.startsWith(pattern + '_') || n.includes(pattern)) {
          // A permanent delete is worse than a soft one; say so.
          return args.permanent === true ? 4 : level;
        }
      }
      if (READ_ONLY.test(n)) return 0;
      if (/^(create|write|save|add|update|set|sync|navigate|generate)/i.test(n)) return 1;
      return 2;
    }

    function threshold() { return Math.max(0, Math.min(4, lsNum('clavis_mind_confirm_risk', 3))); }

    /**
     * Returns { allowed, riskLevel, reason }.
     * UPDATED (2026-09-07): now awaits the styled, Promise-based
     * clavisConfirm() (clavis-confirm-hud.js) instead of the native
     * window.confirm() — window.confirm() blocks the whole tab and Chrome
     * can silently disable repeated native dialogs page-wide, which would
     * let a risky action through (or block it) with no visible error.
     * gate() is async now; its one caller (jarvis_skills.js's invoke(),
     * already async) awaits it.
     */
    async function gate(name, args = {}) {
      const riskLevel = assess(name, args);
      if (SELF_CONFIRMING.has(name)) return { allowed: true, riskLevel, reason: 'the skill confirms with the owner itself' };
      if (riskLevel < threshold()) return { allowed: true, riskLevel, reason: 'within the configured risk boundary' };
      api.emit({
        type: 'safety.confirmation_required', source: 'tool', importance: 0.85,
        metadata: { tool: name, riskLevel, description: `${name} can cause significant or irreversible changes.` },
      });
      const summary = Object.entries(args).slice(0, 6)
        .map(([k, v]) => `  ${k}: ${String(v).slice(0, 120)}`).join('\n');
      const confirmFn = window.clavisConfirm || ((msg) => Promise.resolve(window.confirm(msg)));
      const ok = await confirmFn(`Action: ${name}\nRisk level: ${riskLevel}/4${summary ? `\n${summary}` : ''}`, {
        title: 'Clavis wants to run a high-risk action',
        okLabel: 'Allow', cancelLabel: 'Deny', danger: riskLevel >= 4,
      });
      api.emit({ type: 'safety.confirmation_resolved', source: 'tool', importance: 0.4, metadata: { tool: name, approved: ok } });
      return ok
        ? { allowed: true, riskLevel, reason: 'owner approved' }
        : { allowed: false, riskLevel, reason: 'owner declined' };
    }

    return { assess, gate, threshold };
  })();

  const TRANSIENT = /timeout|temporar|unavailable|connection|network|rate limit|busy|locked|429|503/i;

  /** Did the tool actually do the thing? Prevents "Ho gaya, sir ✅" over a failure. */
  function verify(outcome, expectedFields = []) {
    if (!outcome || outcome.success !== true) {
      return {
        passed: false,
        retryRecommended: TRANSIENT.test(outcome?.error || ''),
        reason: outcome?.error || 'The tool did not report success.',
        missing: [],
      };
    }
    const result = outcome.result && typeof outcome.result === 'object' ? outcome.result : {};
    const missing = expectedFields.filter((f) => !(f in result));
    return {
      passed: missing.length === 0,
      retryRecommended: false,
      reason: missing.length ? `Tool reported success but these fields are missing: ${missing.join(', ')}.` : 'Result confirms completion.',
      missing,
    };
  }

  // ══════════════════════════════════════════════════════════
  //  PUBLIC API
  // ══════════════════════════════════════════════════════════
  const api = {
    /** The one entry point. Feed it lifecycle events; it decides what they mean. */
    emit(input) {
      if (!lsBool('clavis_mind_enabled', true)) return null;
      let outcome = null;
      try {
        const event = bus.normalize(input);
        const s = situation.apply(event);
        continuation.observe(event);
        if (/^conversation\.(user_input|user_question|user_correction)$/.test(event.type)) social.restoreFromUser();
        const assessment = attention.assess(event, s);
        const decision = decide(event, assessment, s);
        attention.record(assessment);
        outcome = { event, situation: s, attention: assessment, decision };
        debug(event.type, decision.action, assessment.score.toFixed(2));

        // Opt-in only: auto-storing every conversational turn would bury the
        // memories that actually matter under a transcript.
        if (event.metadata.remember === true && typeof event.metadata.text === 'string') {
          memory.add({
            kind: event.type.startsWith('conversation.') ? 'episodic' : 'semantic',
            content: event.metadata.text,
            tags: [event.type],
            importance: assessment.score,
            confidence: event.confidence,
            source: event.source,
          });
        }
        bus.publish(event);
        window.dispatchEvent(new CustomEvent('clavis:mind', { detail: outcome }));
      } catch (e) {
        // Cognition is an enhancement. It must never break a conversation.
        console.warn('[ClavisMind] emit failed:', e);
      }
      return outcome;
    },

    // ── Lifecycle shorthands. These are the only things the UI needs to call;
    //    everything above is driven from them. Each is safe to call twice.
    /** The owner said (or typed) something. Silences any pending mind voice. */
    noteUserTurn(text) {
      speech.onUserSpeechStarted();
      api.emit({ type: 'conversation.user_input', source: 'user', importance: 0.6, metadata: { text: String(text || '') } });
      speech.onUserSpeechStopped();
      speech.observeUserResponse();
    },
    /** Clavis finished a reply — this is what opens a follow-up opportunity. */
    noteClavisTurn(text) {
      api.emit({ type: 'conversation.turn_completed', source: 'clavis', importance: 0.45, metadata: { text: String(text || '') } });
    },
    noteSpeakingStarted(text) {
      speech.observeUserResponse();
      api.emit({ type: 'conversation.clavis_started_speaking', source: 'clavis', importance: 0.2, metadata: { text: String(text || '') } });
    },
    noteSpeakingStopped() {
      api.emit({ type: 'conversation.clavis_stopped_speaking', source: 'clavis', importance: 0.2, metadata: {} });
      speech.onTurnComplete();
    },
    /** The owner cut Clavis off — clap, barge-in or "chup". */
    noteInterrupted(remaining) {
      api.emit({ type: 'conversation.user_interrupted_clavis', source: 'user', importance: 0.66, metadata: { interruptedThought: String(remaining || '') } });
      mind.markInterrupted(remaining);
    },
    /** Explicitly store something the owner told Clavis to remember. */
    remember(text, opts = {}) {
      return memory.add({ kind: 'preference', content: text, importance: 0.75, confidence: 0.85, source: 'owner', ...opts });
    },

    on: bus.subscribe,
    recent: bus.recent,
    situation: situation.get,
    setPaused: situation.setPaused,
    memory,
    speech,
    mind,
    social,
    continuation,
    safety,
    verify,
    decide,
    attention,
    CONFIG,

    status() {
      return {
        enabled: lsBool('clavis_mind_enabled', true),
        voice: lsBool('clavis_mind_voice_enabled', true),
        situation: situation.get(),
        mind: mind.status(),
        speech: speech.status(),
        memories: memory.count(),
        confirmRisk: safety.threshold(),
      };
    },

    /** Runnable check for the decision logic — ClavisMind._selfTest() in console. */
    _selfTest() {
      const fails = [];
      let total = 0;
      const check = (label, cond) => { total += 1; if (!cond) fails.push(label); };
      const S = { userSpeaking: false, clavisSpeaking: false, userActivity: 'active', activeApp: '', activeWindow: '', autonomyPaused: false, pendingRisk: null };
      const ev = (type, extra = {}) => bus.normalize({ type, source: 'test', ...extra });

      // Attention: a destructive event outscores a window change.
      const risky = ev('filesystem.delete_requested', { importance: 0.9 });
      const noise = ev('desktop.active_window_changed');
      check('risky > noise', attention.assess(risky, S).score > attention.assess(noise, S).score);

      // Attention: repeating the same event is suppressed.
      const a1 = attention.assess(ev('task.failed', { dedupeKey: 'dup' }), S);
      attention.record(a1);
      const a2 = attention.assess(ev('task.failed', { dedupeKey: 'dup' }), S);
      check('repetition penalised', a2.score < a1.score);

      // Interruption cost: talking over a speaking user is maximally expensive.
      check('user speaking is costly', attention.interruptionCost({ ...S, userSpeaking: true }) > attention.interruptionCost(S));

      // Initiative: a user turn never generates a second answer.
      check('user_input observes only', ['OBSERVE', 'IGNORE'].includes(decide(ev('conversation.user_input', { importance: 0.9 }), attention.assess(ev('conversation.user_input'), S), S).action));
      // Initiative: paused autonomy never speaks.
      check('paused never speaks', !['SPEAK', 'ASK', 'WARN'].includes(decide(risky, attention.assess(risky, S), { ...S, autonomyPaused: true }).action));

      // Speech: a critical warning jumps a casual line.
      speech._reset();
      const order = [];
      speech.request({ source: 'user_response', deliver: () => order.push('user') });
      speech.request({ source: 'casual_initiative', deliver: () => order.push('casual') });
      speech.request({ source: 'critical_warning', deliver: () => order.push('critical') });
      speech.onTurnComplete();
      check('critical preempts casual', order.join(',') === 'user,critical');
      speech._reset();

      // Speech: a direct reply holds the floor, so a nudge waits its turn.
      speech.observeUserResponse();
      let nudged = false;
      speech.request({ source: 'casual_initiative', deliver: () => { nudged = true; } });
      check('nudge waits for a reply', nudged === false);
      speech.onTurnComplete();
      check('nudge speaks after the reply', nudged === true);
      speech.onTurnComplete();
      speech._reset();

      // Social: energy runs out, so Clavis cannot monologue.
      social._reset();
      const thought = { origin: 'unfinished_thread', content: 'x', relatedTopic: 't', relevance: 0.9, novelty: 0.9, urgency: 0.1, socialValue: 0.9, confidence: 0.8, suggestedAction: 'SPEAK' };
      check('first thought speaks', social.evaluate(thought, S, Date.now(), { activeConversation: true }).decision === 'SPEAK');
      social.recordSpeech('unfinished thread t x');
      check('same thought suppressed', social.evaluate(thought, S).decision === 'DROP');
      social._reset();

      // Continuation: no follow-up without a real two-sided exchange.
      continuation._reset();
      check('no thread, no opportunity', continuation.opportunity(S) === null);
      const t0 = Date.now() - 60000;
      continuation.observe(bus.normalize({ type: 'conversation.user_input', timestamp: new Date(t0).toISOString(), metadata: { text: 'sir maybe we should decide the pricing later' } }));
      check('no reply yet, no opportunity', continuation.opportunity(S) === null);
      continuation.observe(bus.normalize({ type: 'conversation.turn_completed', timestamp: new Date(t0 + 2000).toISOString(), metadata: { text: 'Theek hai sir.' } }));
      check('exchange creates opportunity', continuation.opportunity(S) !== null);
      check('user speaking blocks it', continuation.opportunity({ ...S, userSpeaking: true }) === null);
      continuation.observe(bus.normalize({ type: 'internal.autonomous_speech_completed', metadata: {} }));
      check('one autonomous turn max', continuation.opportunity(S) === null);
      continuation._reset();

      // Curiosity fires on hedged language, not on a settled statement.
      check('curiosity on hedge', detectCuriosity({ lastUserStatement: 'maybe later we decide', openQuestions: [], importance: 0.5 }) !== null);
      check('no curiosity on fact', detectCuriosity({ lastUserStatement: 'the office is in mumbai', openQuestions: [], importance: 0.5 }) === null);

      // Safety: an unset threshold must default to 3, never to 0 (= confirm all).
      check('unset threshold defaults to 3', localStorage.getItem('clavis_mind_confirm_risk') !== null || safety.threshold() === 3);
      // Safety: reads are free, sends need a yes.
      check('read is risk 0', safety.assess('list_leads') === 0);
      check('send_email needs confirm', safety.assess('send_email') >= 3);
      check('permanent delete is max risk', safety.assess('delete_lead', { permanent: true }) === 4);
      check('window list is read-only', safety.assess('pc_list_windows') === 0);
      check('closing a window needs confirm', safety.assess('pc_close_window') >= 3);
      check('reading a file is free', safety.assess('pc_read_file') === 0);
      check('deleting a file needs confirm', safety.assess('pc_delete_file') >= 3);
      check('running a script needs confirm', safety.assess('pc_run_python_script') >= 3);

      // Critic: a failure is never reported as done.
      check('failure fails', verify({ success: false, error: 'boom' }).passed === false);
      check('transient retryable', verify({ success: false, error: 'network timeout' }).retryRecommended === true);
      check('missing field fails', verify({ success: true, result: {} }, ['id']).passed === false);
      check('complete result passes', verify({ success: true, result: { id: 1 } }, ['id']).passed === true);

      const passed = total - fails.length;
      console[fails.length ? 'error' : 'log'](`ClavisMind self-test: ${passed}/${total} passed${fails.length ? ` — failed: ${fails.join(', ')}` : ''}`);
      return fails.length === 0;
    },
  };

  // Boot: memories decay once per session, mind starts if enabled.
  try { memory.decay(); } catch (_) {}
  const boot = () => { if (lsBool('clavis_mind_enabled', true)) mind.start(); };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();

  return api;
})();
