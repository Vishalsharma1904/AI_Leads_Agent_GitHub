/**
 * ============================================================
 *  SARVAM CALLING ENGINE (sarvam-calling.js)
 *
 *  Master calling agent ka dimaag. DOM ko haath nahi lagata —
 *  sirf config, Sarvam ki REST API, aur ek sequential call queue.
 *  UI sarvam-calling-ui.js me hai.
 *
 *  Kyun Sarvam: asli PSTN call Sarvam ke side se jaati hai, isliye
 *  app me kabhi koi audio nahi bajta — na AI ki awaaz, na saamne
 *  wale ki. Hum sirf status, transcript aur recording URL padhte
 *  hain. Yahi owner ki requirement thi.
 *
 *  API (docs.sarvam.ai, verified 2026-09-30):
 *    POST /api/outbounds/v1/orgs/{org}/workspaces/{ws}/outbounds
 *         { app_config:{ app_id, app_version,
 *             connection_config:{ connection_id, agent_phone_number } },
 *           user_config:{ user_phone_number, agent_variables? } }
 *                                                  -> { attempt_id }
 *    GET  /api/app-authoring/v1/orgs/{org}/workspaces/{ws}/deployments
 *    GET  /api/analytics/v1/{org}/{ws}/{app}/attempts?start_datetime&end_datetime
 *    GET  /api/analytics/v1/{org}/{ws}/{app}/transcripts/{interaction_id}
 *    GET  /api/analytics/v1/{org}/{ws}/{app}/recordings/{interaction_id}
 *  Auth: header `api-subscription-key` (analytics X-API-Key bhi leta
 *  hai) — hum dono bhejte hain, sasta hai.
 *
 *  API: window.SarvamCalling
 * ============================================================
 */
'use strict';

(() => {
  if (window.SarvamCalling) return;

  const BASE = 'https://apps.sarvam.ai';
  const PROXY = '/sarvam-api';          // serve-clavis.js same-origin proxy (CORS ke liye)
  const LS_CONFIG = 'clavis_sarvam_config';
  const DB_NAME = 'clavis-calls';
  const DB_STORE = 'threads';

  /* Jo route pehli baar chala wahi yaad — har call par direct+proxy
     dono try karna hi "delay" tha. */
  let route = null;

  /* ── config ──────────────────────────────────────────────── */

  const DEFAULTS = {
    orgId: '', workspaceId: '', appId: '', appVersion: 1,
    connectionId: '', agentPhoneNumber: '',
    businessName: '', businessWhatWeSell: '', businessCity: '',
    businessWebsite: '', businessUsp: '', businessPricingLine: '',
    agentName: 'Priya', agentRole: 'Business development executive',
    language: 'hi-IN', tone: 'warm, respectful, seedha point par',
    openingLine: 'Namaste, main {{agent_name}} bol rahi hoon {{business_name}} se. Kya main {{contact_name}} se baat kar rahi hoon?',
    callGoal: 'meeting',
    qualifyingQuestions: '', objectionNotes: '', doNotSay: '',
    meetingSlots: 'Mon-Fri 11:00-17:00', meetingDurationMin: 30, timezone: 'Asia/Kolkata',
    ownerName: '', ownerPhone: '', ownerEmail: '',
    consentLine: 'Yeh ek business call hai. Agar aap chaahein to main abhi rakh deti hoon.',
    recordCalls: true,
    callWindowStart: '10:00', callWindowEnd: '19:00',
    maxCallSeconds: 300, batchSize: 10, gapSeconds: 20, retries: 1,
    emailTone: 'short, polite, professional', emailSignature: '',
  };

  let config = load();

  function load() {
    try {
      const raw = JSON.parse(localStorage.getItem(LS_CONFIG) || '{}');
      return { ...DEFAULTS, ...(raw && typeof raw === 'object' ? raw : {}) };
    } catch (_) { return { ...DEFAULTS }; }
  }

  function getConfig() { return { ...config }; }

  function setConfig(patch) {
    config = { ...config, ...(patch || {}) };
    try { localStorage.setItem(LS_CONFIG, JSON.stringify(config)); } catch (_) {}
    emit('config', { config: getConfig() });
    pushSettings();
    return getConfig();
  }

  /** Call se pehle kya missing hai. UI isi se red fields dikhata hai. */
  function missingFields() {
    const need = {
      orgId: 'Organisation ID', workspaceId: 'Workspace ID', appId: 'Agent (app) ID',
      connectionId: 'Connection ID', agentPhoneNumber: 'Agent phone number',
      businessName: 'Company ka naam', businessWhatWeSell: 'Aap kya bechte hain',
    };
    return Object.keys(need).filter((k) => !String(config[k] || '').trim())
      .map((k) => ({ key: k, label: need[k] }));
  }

  /* ── API key ─────────────────────────────────────────────── */

  async function apiKey() {
    try {
      const V = window.ClavisKeyVault;
      if (V) { await V.ready(); const k = V.use('sarvam'); if (k) return k; }
    } catch (_) {}
    return window.SKYLARK_CONFIG?.SARVAM_API_KEYS?.[0] || '';
  }

  async function hasKey() { return Boolean(await apiKey()); }

  /* ── transport ───────────────────────────────────────────── */

  class ApiError extends Error {
    constructor(status, data) {
      super(readableError(status, data));
      this.name = 'SarvamApiError';
      this.status = status;
      this.data = data;
    }
  }

  function readableError(status, data) {
    const detail = data && (data.detail || data.message || data.error);
    const text = typeof detail === 'string' ? detail
      : detail ? JSON.stringify(detail).slice(0, 300) : '';
    if (status === 401 || status === 403) return 'Sarvam key galat ya expire — Key Vault me dobara daaliye.';
    if (status === 404) return `Sarvam: resource nahi mila (404). Org / Workspace / Agent ID check kijiye.${text ? ' — ' + text : ''}`;
    if (status === 422) return `Sarvam ne request reject ki (422). ${text || 'Koi field galat hai.'}`;
    if (status === 429) return 'Sarvam rate limit. Thodi der baad dobara.';
    return `Sarvam error ${status}${text ? ': ' + text : ''}`;
  }

  function cleanQuery(q2) {
    const out = {};
    Object.keys(q2 || {}).forEach((k) => {
      if (q2[k] !== undefined && q2[k] !== null && q2[k] !== '') out[k] = String(q2[k]);
    });
    return out;
  }

  async function req(path, opts = {}) {
    const { method = 'GET', body = null, query = null } = opts;
    const key = await apiKey();
    if (!key) throw new Error('Sarvam API key nahi mili. Key Vault me "Sarvam AI" key add kijiye.');

    const qs = query ? '?' + new URLSearchParams(cleanQuery(query)).toString() : '';
    const headers = { 'api-subscription-key': key, 'X-API-Key': key };
    if (body) headers['Content-Type'] = 'application/json';

    const order = route ? [route] : ['direct', 'proxy'];
    let lastNetErr = null;

    for (const r of order) {
      const url = (r === 'direct' ? BASE : PROXY) + path + qs;
      let res;
      try {
        res = await fetch(url, { method, headers, body: body ? JSON.stringify(body) : null });
      } catch (e) {
        lastNetErr = e;      // CORS / network — agla route
        continue;
      }
      route = r;             // response mila = yeh route kaam karta hai
      const text = await res.text().catch(() => '');
      let data;
      try { data = text ? JSON.parse(text) : {}; } catch (_) { data = { raw: text }; }
      if (!res.ok) throw new ApiError(res.status, data);
      return data;
    }

    route = null;
    const hint = location.protocol === 'file:'
      ? ' App ko file:// se mat kholiye — Start-Clavis.bat se kholiye, tabhi proxy chalta hai.'
      : ' Local server (serve-clavis.js) band lagta hai — Start-Clavis.bat se app kholiye.';
    throw new Error('Sarvam tak nahi pahunch paya (network/CORS).' + hint +
      (lastNetErr ? ' [' + lastNetErr.message + ']' : ''));
  }

  /* ── backend transport (multi-tenant) ────────────────────────
     The browser used to hold the subscription key and talk to
     apps.sarvam.ai itself. That works for one owner on one laptop and
     cannot be sold: the key is readable in the page, and there is no
     server-side record of who called whom.

     Signed in → every Sarvam call goes through our own backend, which
     holds the key encrypted per tenant (backend/api/sarvam.py). Signed
     out (the owner's own local session) → the old direct route still
     works, so nothing that worked yesterday stopped working.          */

  const backendBase = () =>
    (window.SKYLARK_CONFIG?.BACKEND_URL || 'http://localhost:8000').replace(/\/+$/, '');
  const backendApi = () =>
    (location.port === '8000' ? '' : backendBase()) + '/api/v1/sarvam';

  function authToken() {
    try { return window.SupabaseAuth?.getAccessToken?.() || ''; } catch (_) { return ''; }
  }
  function useBackend() { return Boolean(authToken()); }

  async function backendReq(path, { method = 'GET', body = null, query = null } = {}) {
    const token = authToken();
    if (!token) throw new Error('Sign in to use the calling agent — keys are stored per company on the server.');
    const qs = query ? '?' + new URLSearchParams(cleanQuery(query)).toString() : '';
    let res;
    try {
      res = await fetch(backendApi() + path + qs, {
        method,
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: body ? JSON.stringify(body) : null,
      });
    } catch (_) {
      throw new Error('Rudra24 AI backend se baat nahi ho paayi — Rudra24 AI dobara start kijiye.');
    }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = new Error(typeof data.detail === 'string' ? data.detail : `Sarvam request failed (${res.status})`);
      err.status = res.status;
      // 429 = aaj ka quota khatam. Ye failure nahi hai, sirf "kal phir".
      err.quotaExhausted = res.status === 429;
      throw err;
    }
    return data;
  }

  /** Mirror the local config to this tenant's server-side row. */
  let pushTimer = 0;
  function pushSettings() {
    if (!useBackend()) return;
    clearTimeout(pushTimer);
    pushTimer = setTimeout(() => {
      backendReq('/settings', { method: 'PUT', body: {
        org_id: config.orgId, workspace_id: config.workspaceId,
        app_id: config.appId, app_version: Number(config.appVersion) || 1,
        connection_id: config.connectionId, agent_phone_number: config.agentPhoneNumber,
      } }).catch(() => {});          // best effort: the next call reports the truth
    }, 400);
  }

  /** What the server thinks this tenant still has to fill in. */
  async function serverStatus() {
    if (!useBackend()) return null;
    try { return await backendReq('/status'); } catch (_) { return null; }
  }

  /* ── endpoints ───────────────────────────────────────────── */

  const orgPath = () =>
    `/orgs/${encodeURIComponent(config.orgId)}/workspaces/${encodeURIComponent(config.workspaceId)}`;
  const analyticsPath = () =>
    `/api/analytics/v1/${encodeURIComponent(config.orgId)}/${encodeURIComponent(config.workspaceId)}/${encodeURIComponent(config.appId)}`;

  /** Deployments se app_id / app_version / phone auto-fill hota hai. */
  async function listDeployments() {
    if (useBackend()) {
      const data = await backendReq('/deployments');
      return Array.isArray(data?.items) ? data.items : [];
    }
    const data = await req(`/api/app-authoring/v1${orgPath()}/deployments`, { query: { limit: 100 } });
    return Array.isArray(data?.items) ? data.items : [];
  }

  function adoptDeployment(dep) {
    if (!dep) return getConfig();
    const patch = {};
    if (dep.app_id) patch.appId = dep.app_id;
    if (dep.app_version != null) patch.appVersion = Number(dep.app_version) || 1;
    const phone = Array.isArray(dep.phone_numbers) ? dep.phone_numbers[0] : dep.phone_number;
    if (phone) patch.agentPhoneNumber = phone;
    const conn = dep.connection_id || dep.connection_config?.connection_id || dep.connection?.connection_id;
    if (conn) patch.connectionId = conn;
    return setConfig(patch);
  }

  /** Ek call shuru. Resolve hote hi attempt_id — call PSTN par jaati hai. */
  async function startCall(lead, extraVars) {
    const phone = normalizePhone(lead?.phone || lead?.mobile || lead?.contactNumber);
    if (!phone) throw new Error('Is lead ka phone number valid nahi hai.');
    const body = {
      app_config: {
        app_id: config.appId,
        app_version: Number(config.appVersion) || 1,
        connection_config: {
          connection_id: config.connectionId,
          agent_phone_number: config.agentPhoneNumber,
        },
      },
      user_config: {
        user_phone_number: phone,
        agent_variables: { ...callVariables(lead), ...(extraVars || {}) },
      },
    };
    if (useBackend()) {
      // The server holds the key, re-normalises the number and decides what
      // is actually dialled — a browser is not a trust boundary.
      const out = await backendReq('/calls', { method: 'POST', body: {
        phone_number: phone,
        agent_variables: body.user_config.agent_variables,
      } });
      if (!out?.attempt_id) throw new Error('Sarvam ne attempt_id nahi diya.');
      return String(out.attempt_id);
    }
    const data = await req(`/api/outbounds/v1${orgPath()}/outbounds`, { method: 'POST', body });
    if (!data?.attempt_id) throw new Error('Sarvam ne attempt_id nahi diya.');
    return String(data.attempt_id);
  }

  async function listAttempts({ hours = 6, limit = 200 } = {}) {
    const end = new Date();
    const start = new Date(end.getTime() - hours * 3600e3);
    if (useBackend()) {
      const out = await backendReq('/attempts', { query: { hours, limit } });
      return Array.isArray(out?.items) ? out.items : [];
    }
    const data = await req(`${analyticsPath()}/attempts`, {
      query: { start_datetime: start.toISOString(), end_datetime: end.toISOString(), limit, offset: 0 },
    });
    return Array.isArray(data?.items) ? data.items : [];
  }

  async function findAttempt(attemptId, hours = 6) {
    const items = await listAttempts({ hours });
    return items.find((a) => String(a.attempt_id) === String(attemptId)) || null;
  }

  async function getTranscript(interactionId) {
    if (!interactionId) return [];
    if (useBackend()) {
      const out = await backendReq(`/transcripts/${encodeURIComponent(interactionId)}`);
      return normalizeTranscript(out?.data);
    }
    return normalizeTranscript(await req(`${analyticsPath()}/transcripts/${encodeURIComponent(interactionId)}`));
  }

  async function getRecording(interactionId) {
    if (!interactionId) return '';
    if (useBackend()) {
      const out = await backendReq(`/recordings/${encodeURIComponent(interactionId)}`);
      return normalizeRecording(out?.data);
    }
    return normalizeRecording(await req(`${analyticsPath()}/recordings/${encodeURIComponent(interactionId)}`));
  }

  /* ── pure helpers (self-test inke upar hai) ──────────────── */

  /** Indian numbers -> E.164. Kuch bhi ajeeb ho to '' — call jaati hi nahi. */
  function normalizePhone(raw) {
    let s = String(raw || '').trim();
    if (!s) return '';
    s = s.replace(/[^\d+]/g, '');
    if (s.startsWith('+')) s = '+' + s.slice(1).replace(/\D/g, '');
    else s = s.replace(/\D/g, '');
    if (!s.startsWith('+')) {
      if (s.length === 10) s = '+91' + s;
      else if (s.length === 11 && s.startsWith('0')) s = '+91' + s.slice(1);
      else if (s.length === 12 && s.startsWith('91')) s = '+' + s;
      else if (s.length >= 11 && s.length <= 15) s = '+' + s;
      else return '';
    }
    const digits = s.slice(1);
    if (digits.length < 10 || digits.length > 15) return '';
    if (digits.startsWith('91') && digits.length === 12 && !/^91[6-9]/.test(digits)) return '';
    return s;
  }

  /** Transcript kai shakl me aata hai — sabko ek shakl me. */
  function normalizeTranscript(data) {
    if (!data) return [];
    const arr = Array.isArray(data) ? data
      : Array.isArray(data.interaction_transcript) ? data.interaction_transcript
      : Array.isArray(data.transcript) ? data.transcript
      : Array.isArray(data.items) ? data.items
      : Array.isArray(data.messages) ? data.messages
      : Array.isArray(data.turns) ? data.turns : [];
    return arr.map((t) => {
      const role = String(t.role || t.speaker || t.from || '').toLowerCase();
      const text = t.en_text || t.text || t.content || t.message || t.transcript || '';
      return {
        role: /user|customer|human|caller|callee/.test(role) ? 'user' : 'agent',
        text: String(text || '').trim(),
        at: t.timestamp || t.start_time || t.at || null,
      };
    }).filter((t) => t.text);
  }

  function normalizeRecording(data) {
    if (!data) return '';
    if (typeof data === 'string') return data;
    return data.url || data.audio_url || data.recording_url || data.signed_url
      || data.download_url || data.recording?.url || '';
  }

  /** {{company}} jaisi jagah bharo; unknown placeholder khaali. */
  function fillTemplate(tpl, vars) {
    return String(tpl || '').replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_, k) => {
      const v = vars?.[k];
      return v === undefined || v === null ? '' : String(v);
    });
  }

  /** Har call par Sarvam agent ko jaane wale variables. */
  function callVariables(lead) {
    const c = config;
    const base = {
      agent_name: c.agentName, agent_role: c.agentRole,
      business_name: c.businessName, what_we_sell: c.businessWhatWeSell,
      business_city: c.businessCity, business_website: c.businessWebsite,
      usp: c.businessUsp, pricing_line: c.businessPricingLine,
      call_goal: c.callGoal, qualifying_questions: c.qualifyingQuestions,
      objection_notes: c.objectionNotes, do_not_say: c.doNotSay,
      meeting_slots: c.meetingSlots, meeting_duration_min: String(c.meetingDurationMin),
      timezone: c.timezone, owner_name: c.ownerName, owner_phone: c.ownerPhone,
      owner_email: c.ownerEmail, consent_line: c.consentLine,
      language: c.language, tone: c.tone,
      company: lead?.company || lead?.name || '',
      contact_name: lead?.contactName || lead?.contact_person || lead?.owner || '',
      city: lead?.city || '', industry: lead?.industry || lead?.sector || '',
      lead_email: lead?.email || '',
    };
    base.opening_line = fillTemplate(c.openingLine, base);
    return base;
  }

  /** Sarvam dashboard me paste karne ke liye poora agent prompt. */
  function buildAgentPrompt() {
    const c = config;
    const goal = c.callGoal === 'qualify' ? 'lead ko qualify karna aur unki zaroorat samajhna'
      : c.callGoal === 'pitch' ? 'service ka short pitch dena aur interest naapna'
      : `${c.meetingDurationMin} minute ki meeting fix karna`;
    return [
      `Tum ${c.agentName} ho — ${c.businessName} ki ${c.agentRole}.`,
      `${c.businessName} ${c.businessWhatWeSell} provide karti hai${c.businessCity ? `, mainly ${c.businessCity} me` : ''}.`,
      c.businessUsp ? `Hamari khaasiyat: ${c.businessUsp}` : '',
      c.businessPricingLine ? `Pricing ke baare me sirf itna: ${c.businessPricingLine}` : '',
      '',
      `IS CALL KA MAQSAD: ${goal}.`,
      'Tum {{company}} ko call kar rahi ho. Agar {{contact_name}} hai to unka naam lo.',
      '',
      'SHURUAAT:',
      c.openingLine,
      c.consentLine ? `Pehle 15 second me yeh keh do: ${c.consentLine}` : '',
      '',
      c.qualifyingQuestions ? 'YEH PUCHHNA HAI:\n' + c.qualifyingQuestions : '',
      c.objectionNotes ? 'OBJECTIONS KA JAWAB:\n' + c.objectionNotes : '',
      '',
      `MEETING: slots — ${c.meetingSlots} (${c.timezone}). Duration ${c.meetingDurationMin} min.`,
      `Haan kahein to slot confirm karo aur bolo ki ${c.ownerName || 'hamari team'} se confirmation aayega.`,
      c.ownerEmail ? `Email confirmation ${c.ownerEmail} se jaayega.` : '',
      '',
      'STYLE:',
      `- ${c.tone}`,
      `- ${c.language === 'hi-IN' ? 'Hindi/Hinglish me baat karo — jaise saamne wala bole.' : 'Match the language the other person uses.'}`,
      '- Chhote jawab. Ek baar me ek sawaal. Beech me mat kaato.',
      '- Kabhi jhooth mat bolo. Jo nahi pata, bolo "main pata karke batati hoon".',
      c.doNotSay ? `- Yeh kabhi mat bolna: ${c.doNotSay}` : '',
      '',
      'ANT ME: interested hain to email confirm karo. Nahi to shukriya bolkar politely call khatam karo.',
    ].filter((l) => l !== '').join('\n');
  }

  /* ── threads (IndexedDB) ─────────────────────────────────── */
  /* Apna chhota store. memory.js ka DB_VERSION bump karne se uski
     migrations tootne ka risk tha — yeh alag DB hai, alag zindagi. */

  function db() {
    return new Promise((resolve, reject) => {
      const r = indexedDB.open(DB_NAME, 1);
      r.onupgradeneeded = () => {
        if (!r.result.objectStoreNames.contains(DB_STORE)) {
          r.result.createObjectStore(DB_STORE, { keyPath: 'id' });
        }
      };
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
  }

  function putThread(thread) {
    return db().then((d) => new Promise((resolve, reject) => {
      const tx = d.transaction(DB_STORE, 'readwrite');
      tx.objectStore(DB_STORE).put(JSON.parse(JSON.stringify(thread)));
      tx.oncomplete = () => resolve(thread);
      tx.onerror = () => reject(tx.error);
    })).catch(() => thread);
  }

  function allThreads() {
    return db().then((d) => new Promise((resolve, reject) => {
      const r = d.transaction(DB_STORE, 'readonly').objectStore(DB_STORE).getAll();
      r.onsuccess = () => resolve((r.result || []).sort((a, b) => (b.startedAt || 0) - (a.startedAt || 0)));
      r.onerror = () => reject(r.error);
    })).catch(() => []);
  }

  function deleteThread(id) {
    return db().then((d) => new Promise((resolve) => {
      const tx = d.transaction(DB_STORE, 'readwrite');
      tx.objectStore(DB_STORE).delete(id);
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => resolve(false);
    })).catch(() => false);
  }

  /* ── queue ───────────────────────────────────────────────── */

  const q = { items: [], running: false, stopRequested: false, limit: 10, currentId: null };

  const STATUS = {
    pending: 'Queue me', dialing: 'Dial ho raha hai', ringing: 'Ring ho rahi hai',
    connected: 'Baat chal rahi hai', done: 'Ho gayi', no_answer: 'Uthaya nahi',
    busy: 'Busy', failed: 'Fail', skipped: 'Chhoda',
  };

  function emit(kind, detail) {
    try { window.dispatchEvent(new CustomEvent('sarvam:' + kind, { detail: detail || {} })); } catch (_) {}
  }

  function leadKey(lead) {
    return String(lead?.id || lead?._id || lead?.company || normalizePhone(lead?.phone) || Math.random());
  }

  /** Leads queue me. Bina valid number wale chup-chaap skip. */
  function enqueue(leads) {
    const list = Array.isArray(leads) ? leads : [leads];
    let added = 0, skipped = 0;
    list.forEach((lead) => {
      const phone = normalizePhone(lead?.phone || lead?.mobile || lead?.contactNumber);
      if (!phone) { skipped++; return; }
      const id = leadKey(lead);
      if (q.items.some((i) => i.id === id && i.status !== 'failed')) return;
      q.items.push({
        id, lead: { ...lead, phone },
        status: 'pending', attemptId: null, interactionId: null,
        threadId: null, error: '', tries: 0,
      });
      added++;
    });
    emit('queue', { items: queueSnapshot(), added, skipped });
    return { added, skipped, total: q.items.length };
  }

  function queueSnapshot() {
    return q.items.map((i) => ({ ...i, statusLabel: STATUS[i.status] || i.status }));
  }

  function clearQueue() {
    if (q.running) return false;
    q.items = [];
    emit('queue', { items: [] });
    return true;
  }

  function removeFromQueue(id) {
    if (q.currentId === id) return false;
    q.items = q.items.filter((i) => i.id !== id);
    emit('queue', { items: queueSnapshot() });
    return true;
  }

  function setItem(item, patch) {
    Object.assign(item, patch);
    emit('queue', { items: queueSnapshot(), changed: item.id });
  }

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  function withinCallWindow(now = new Date()) {
    const [sh, sm] = String(config.callWindowStart || '00:00').split(':').map(Number);
    const [eh, em] = String(config.callWindowEnd || '23:59').split(':').map(Number);
    const mins = now.getHours() * 60 + now.getMinutes();
    const start = (sh || 0) * 60 + (sm || 0);
    const end = (eh || 23) * 60 + (em || 59);
    return start <= end ? mins >= start && mins <= end : mins >= start || mins <= end;
  }

  /** Sarvam ka connectivity_status -> hamari shakl. */
  function mapStatus(raw) {
    const s = String(raw || '').toLowerCase();
    if (/no[_\s-]?answer|noanswer|missed|unanswered/.test(s)) return 'no_answer';
    if (/busy/.test(s)) return 'busy';
    if (/fail|error|reject|declin|invalid|cancel/.test(s)) return 'failed';
    if (/connect|complete|answered|success|ended|finish/.test(s)) return 'done';
    if (/ring/.test(s)) return 'ringing';
    if (/dial|initiat|queue|progress|calling/.test(s)) return 'dialing';
    return '';
  }

  const TERMINAL = ['done', 'no_answer', 'busy', 'failed'];

  /** Ek call: dial -> poll -> transcript + recording -> thread save. */
  async function runOne(item) {
    q.currentId = item.id;
    setItem(item, { status: 'dialing', error: '' });

    let attemptId;
    try {
      attemptId = await startCall(item.lead);
    } catch (e) {
      // Aaj ki limit khatam hone par lead ko 'failed' mat karo — wo kal
      // dobara dial honi hai. Yahi "bachi hui leads kal call hongi" hai.
      if (e && e.quotaExhausted) {
        setItem(item, { status: 'pending', error: '' });
        q.currentId = null;
        const stop = new Error(e.message);
        stop.quotaExhausted = true;
        throw stop;
      }
      setItem(item, { status: 'failed', error: e.message });
      q.currentId = null;
      return item;
    }
    setItem(item, { attemptId });

    const thread = {
      id: attemptId, leadId: item.id,
      company: item.lead.company || item.lead.name || 'Unknown',
      contactName: item.lead.contactName || '',
      phone: item.lead.phone, email: item.lead.email || '', city: item.lead.city || '',
      startedAt: Date.now(), status: 'dialing', durationSec: 0,
      transcript: [], recordingUrl: '', summary: '', outcome: '',
      emailDraft: null, meeting: null, interactionId: '',
    };
    await putThread(thread);
    setItem(item, { threadId: thread.id });
    emit('thread', { thread });

    const deadline = Date.now() + (Number(config.maxCallSeconds) || 300) * 1000 + 90000;
    let attempt = null;
    let mapped = 'dialing';

    while (Date.now() < deadline && !q.stopRequested) {
      await sleep(5000);
      try {
        attempt = await findAttempt(attemptId, 2);
      } catch (e) {
        // Analytics thodi der baad populate hota hai — 404/422 chup-chaap.
        if (!(e instanceof ApiError)) setItem(item, { error: e.message });
        continue;
      }
      if (!attempt) continue;

      const next = mapStatus(attempt.connectivity_status);
      if (next && next !== mapped) {
        mapped = next;
        setItem(item, { status: next });
        thread.status = next;
        await putThread(thread);
        emit('thread', { thread });
      }
      if (attempt.interaction_id && !item.interactionId) {
        setItem(item, { interactionId: attempt.interaction_id });
        thread.interactionId = attempt.interaction_id;
      }
      if (TERMINAL.includes(next)) break;
    }

    if (attempt) {
      thread.durationSec = Number(attempt.duration_in_seconds) || 0;
      thread.status = mapped || 'done';
      thread.endedBy = attempt.ended_by || '';
      thread.failureReason = attempt.failure_reason || '';
      if (attempt.audio_url) thread.recordingUrl = attempt.audio_url;
      if (attempt.interaction_id) thread.interactionId = attempt.interaction_id;
    } else if (!TERMINAL.includes(mapped)) {
      thread.status = 'failed';
      thread.failureReason = 'Sarvam analytics me yeh call time par nahi dikhi.';
      setItem(item, { status: 'failed', error: thread.failureReason });
    }

    if (thread.interactionId) {
      try { thread.transcript = await getTranscript(thread.interactionId); } catch (_) {}
      if (!thread.recordingUrl) {
        try { thread.recordingUrl = await getRecording(thread.interactionId); } catch (_) {}
      }
    }

    thread.endedAt = Date.now();
    await putThread(thread);
    emit('thread', { thread, final: true });

    // Summary/email best-effort — queue inpe nahi rukti.
    if (thread.transcript.length) summarizeThread(thread).catch(() => {});

    q.currentId = null;
    return item;
  }

  /** Queue chalao: ek ke baad ek, `limit` tak. */
  async function start({ limit } = {}) {
    if (q.running) return { ok: false, reason: 'already-running' };
    const missing = missingFields();
    if (missing.length) return { ok: false, reason: 'config', missing };
    if (!(await hasKey())) return { ok: false, reason: 'no-key' };
    if (!withinCallWindow()) {
      return { ok: false, reason: 'window', window: `${config.callWindowStart}-${config.callWindowEnd}` };
    }

    q.limit = Math.max(1, Number(limit) || Number(config.batchSize) || 10);
    q.running = true;
    q.stopRequested = false;
    emit('run', { running: true, limit: q.limit });

    let done = 0;
    let quotaHit = '';
    try {
      while (!q.stopRequested && done < q.limit) {
        const item = q.items.find((i) => i.status === 'pending');
        if (!item) break;
        try {
          await runOne(item);
        } catch (e) {
          if (e && e.quotaExhausted) { quotaHit = e.message; break; }
          throw e;
        }
        done++;
        if (!q.stopRequested && done < q.limit && q.items.some((i) => i.status === 'pending')) {
          await sleep(Math.max(0, Number(config.gapSeconds) || 0) * 1000);
        }
      }
    } finally {
      q.running = false;
      q.currentId = null;
      emit('run', { running: false, completed: done, quota: quotaHit });
    }
    // The queue survives in IndexedDB, so whatever is still pending is simply
    // tomorrow's work — nothing is lost and nothing is re-scraped.
    const waiting = q.items.filter((i) => i.status === 'pending').length;
    return quotaHit
      ? { ok: true, completed: done, quota: quotaHit, waiting }
      : { ok: true, completed: done, waiting };
  }

  function stop() {
    if (!q.running) return false;
    q.stopRequested = true;
    emit('run', { running: true, stopping: true });
    return true;
  }

  /* ── post-call intelligence (best-effort, LLM) ───────────── */

  async function summarizeThread(thread) {
    const D = window.ClavisDirect;
    if (!D?.hasKey?.() || !thread.transcript?.length) return thread;

    const convo = thread.transcript
      .map((t) => `${t.role === 'user' ? 'CUSTOMER' : 'AGENT'}: ${t.text}`).join('\n');
    const sys = 'You read a sales phone call transcript and return STRICT JSON only, no markdown fence. '
      + 'Keys: summary (2 sentences, Hinglish), outcome (one of: interested, meeting_booked, callback, '
      + 'not_interested, wrong_number, no_decision), meeting (null, or {date_iso, time_24h, note}), '
      + 'email_subject, email_body. The email is written as if from the business owner to the customer, '
      + 'referencing what was actually said on the call. Never invent facts that are not in the transcript.';
    const user = [
      `Business: ${config.businessName} - ${config.businessWhatWeSell}`,
      `Owner: ${config.ownerName || ''} ${config.ownerEmail ? '<' + config.ownerEmail + '>' : ''}`,
      `Customer company: ${thread.company}${thread.contactName ? ' (' + thread.contactName + ')' : ''}`,
      `Email tone: ${config.emailTone}`,
      config.emailSignature ? `Signature to use:\n${config.emailSignature}` : '',
      `Today: ${new Date().toISOString().slice(0, 10)} (${config.timezone})`,
      '', 'TRANSCRIPT:', convo,
    ].filter(Boolean).join('\n');

    let parsed;
    try {
      const res = await D.complete({
        messages: [{ role: 'system', content: sys }, { role: 'user', content: user }],
        max_tokens: 900,
      });
      const raw = res.choices?.[0]?.message?.content || '';
      parsed = JSON.parse(raw.replace(/^```(?:json)?/gm, '').replace(/```$/gm, '').trim());
    } catch (_) { return thread; }

    thread.summary = String(parsed.summary || '');
    thread.outcome = String(parsed.outcome || '');
    thread.meeting = parsed.meeting || null;
    if (parsed.email_subject || parsed.email_body) {
      thread.emailDraft = {
        to: thread.email || '',
        subject: String(parsed.email_subject || ''),
        body: String(parsed.email_body || ''),
        approved: false, sentAt: null,
      };
    }
    await putThread(thread);
    emit('thread', { thread, enriched: true });
    return thread;
  }

  /* ── calendar + mail handoff (bina OAuth) ────────────────── */

  function meetingTimes(thread) {
    const m = thread?.meeting;
    if (!m?.date_iso) return null;
    const time = /^\d{1,2}:\d{2}$/.test(m.time_24h || '') ? m.time_24h : '11:00';
    const [hh, mm] = time.split(':');
    const start = new Date(`${m.date_iso}T${String(hh).padStart(2, '0')}:${mm}:00`);
    if (Number.isNaN(start.getTime())) return null;
    const end = new Date(start.getTime() + (Number(config.meetingDurationMin) || 30) * 60000);
    const z = (d) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
    return { start, end, gcal: `${z(start)}/${z(end)}` };
  }

  function calendarLink(thread) {
    const t = meetingTimes(thread);
    if (!t) return '';
    const p = new URLSearchParams({
      action: 'TEMPLATE',
      text: `${config.businessName} x ${thread.company}`,
      dates: t.gcal,
      details: [thread.summary, thread.meeting?.note, thread.phone].filter(Boolean).join('\n'),
      location: thread.phone || '',
      ctz: config.timezone,
    });
    return 'https://calendar.google.com/calendar/render?' + p.toString();
  }

  function icsFor(thread) {
    const t = meetingTimes(thread);
    if (!t) return '';
    const z = (d) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
    const esc = (s) => String(s || '').replace(/([,;\\])/g, '\\$1').replace(/\n/g, '\\n');
    return [
      'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Rudra24 AI//Sarvam Calling//EN', 'BEGIN:VEVENT',
      `UID:${thread.id}@clavis`,
      `DTSTAMP:${z(new Date())}`, `DTSTART:${z(t.start)}`, `DTEND:${z(t.end)}`,
      `SUMMARY:${esc(config.businessName + ' x ' + thread.company)}`,
      `DESCRIPTION:${esc([thread.summary, thread.meeting?.note].filter(Boolean).join('\n'))}`,
      thread.email ? `ATTENDEE;CN=${esc(thread.company)}:mailto:${thread.email}` : '',
      'END:VEVENT', 'END:VCALENDAR',
    ].filter(Boolean).join('\r\n');
  }

  /** Gmail compose — bhejta khud owner hai, yahi supervision wali baat thi. */
  function mailLink(thread, { gmail = true } = {}) {
    const d = thread?.emailDraft;
    if (!d) return '';
    const to = d.to || thread.email || '';
    if (gmail) {
      const p = new URLSearchParams({ view: 'cm', fs: '1', to, su: d.subject || '', body: d.body || '' });
      return 'https://mail.google.com/mail/?' + p.toString();
    }
    return `mailto:${encodeURIComponent(to)}?subject=${encodeURIComponent(d.subject || '')}`
      + `&body=${encodeURIComponent(d.body || '')}`;
  }

  async function saveEmailDraft(threadId, patch) {
    const list = await allThreads();
    const thread = list.find((t) => t.id === threadId);
    if (!thread) return null;
    thread.emailDraft = { ...(thread.emailDraft || { approved: false, sentAt: null }), ...patch };
    await putThread(thread);
    emit('thread', { thread });
    return thread;
  }

  /* ── self-check ──────────────────────────────────────────── */

  function _selfTest() {
    const eq = (a, b, m) => {
      if (a !== b) throw new Error(`${m}: ${JSON.stringify(a)} != ${JSON.stringify(b)}`);
    };

    eq(normalizePhone('98765 43210'), '+919876543210', 'plain 10-digit');
    eq(normalizePhone('+91-98765-43210'), '+919876543210', 'already E.164');
    eq(normalizePhone('09876543210'), '+919876543210', 'leading zero');
    eq(normalizePhone('919876543210'), '+919876543210', 'country code no plus');
    eq(normalizePhone('12345'), '', 'too short');
    eq(normalizePhone(''), '', 'empty');
    eq(normalizePhone('+915876543210'), '', 'invalid Indian prefix');

    eq(fillTemplate('Hi {{company}} / {{nope}}', { company: 'Acme' }), 'Hi Acme / ', 'template');

    const t = normalizeTranscript({ interaction_transcript: [
      { role: 'agent', en_text: 'Namaste' },
      { role: 'user', en_text: 'Haan boliye' },
      { role: 'agent', en_text: '  ' },
    ] });
    eq(t.length, 2, 'transcript drops empty');
    eq(t[1].role, 'user', 'transcript role');
    eq(normalizeTranscript({ messages: [{ speaker: 'customer', text: 'ok' }] })[0].role, 'user', 'alt shape');
    eq(normalizeRecording({ audio_url: 'x' }), 'x', 'recording');

    eq(mapStatus('NO_ANSWER'), 'no_answer', 'status no answer');
    eq(mapStatus('connected'), 'done', 'status connected');
    eq(mapStatus('weird'), '', 'status unknown');

    const saved = config;
    config = { ...DEFAULTS, callWindowStart: '10:00', callWindowEnd: '19:00' };
    eq(withinCallWindow(new Date(2026, 0, 1, 12, 0)), true, 'in window');
    eq(withinCallWindow(new Date(2026, 0, 1, 21, 0)), false, 'out of window');
    config = { ...DEFAULTS, callWindowStart: '22:00', callWindowEnd: '06:00' };
    eq(withinCallWindow(new Date(2026, 0, 1, 23, 30)), true, 'overnight window');

    config = { ...DEFAULTS, businessName: 'A', businessWhatWeSell: 'B' };
    eq(missingFields().length, 5, 'missing connection fields');
    config = saved;

    return 'SarvamCalling self-test OK';
  }

  window.SarvamCalling = {
    getConfig, setConfig, missingFields, hasKey, DEFAULTS, buildAgentPrompt,
    listDeployments, adoptDeployment, startCall, listAttempts, findAttempt,
    getTranscript, getRecording,
    enqueue, queueSnapshot, clearQueue, removeFromQueue, start, stop,
    isRunning: () => q.running, STATUS,
    allThreads, putThread, deleteThread, summarizeThread,
    calendarLink, icsFor, mailLink, saveEmailDraft, meetingTimes,
    normalizePhone, fillTemplate, callVariables, withinCallWindow,
    _selfTest,
  };
})();
