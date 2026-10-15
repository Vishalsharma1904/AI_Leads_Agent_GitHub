/* Selected-lead ElevenLabs calls. Never retry an ambiguous outbound request. */
'use strict';

window.ElevenLabsCampaign = (() => {
  const PREFIX = 'rudra_elevenlabs_campaign_v1:';
  const terminal = status => ['done', 'failed'].includes(status);
  const unresolved = item => item && !['pending', 'done', 'failed', 'skipped'].includes(item.status);
  const listeners = new Set(), requests = new Set(), waits = new Set();
  let owner = '', epoch = 0, sequence = 0, startup = 0, state, savedVersion = '', preparing = false, ownsLock = false;
  const identity = () => String(window.SupabaseAuth?.getUser?.()?.id || '');
  const blank = () => ({ items: [], running: false, paused: false, currentId: null, error: '', agentId: '', phoneNumberId: '', limit: 10, demo: null });
  const copy = value => JSON.parse(JSON.stringify(value));
  const normalizePhone = raw => {
    let value = window.SarvamCalling?.normalizePhone ? window.SarvamCalling.normalizePhone(raw) : String(raw || '').trim().replace(/[\s().-]/g, '');
    if (/^0[6-9]\d{9}$/.test(value)) value = '+91' + value.slice(1);
    else if (/^[6-9]\d{9}$/.test(value)) value = '+91' + value;
    else if (/^91[6-9]\d{9}$/.test(value)) value = '+' + value;
    return /^\+[1-9]\d{7,14}$/.test(value) && (!/^\+91\d{10}$/.test(value) || /^\+91[6-9]/.test(value)) ? value : '';
  };
  function restoredItem(raw, reload) {
    if (!raw || typeof raw !== 'object' || !raw.lead || typeof raw.lead !== 'object') return null;
    const phone = normalizePhone(raw.lead.phone || raw.lead.phoneNumber);
    if (!phone || typeof raw.id !== 'string' || !raw.id || raw.id.length > 200) return null;
    const statuses = ['pending', 'dialing', 'accepted', 'initiated', 'in-progress', 'processing', 'done', 'failed', 'unknown', 'skipped'];
    const status = !statuses.includes(raw.status) || (reload && raw.status === 'dialing') ? 'unknown' : raw.status;
    return { id: raw.id, lead: { company: String(raw.lead.company || 'Lead').slice(0, 255), phone, contactName: String(raw.lead.contactName || '').slice(0, 120) },
      demo: !!raw.demo, status, error: status === 'unknown' ? 'Call outcome is unknown. Review provider call history before any retry.' : String(raw.error || '').slice(0, 2000),
      conversationId: /^[A-Za-z0-9_-]{1,160}$/.test(raw.conversationId || '') ? raw.conversationId : '', detail: raw.detail && typeof raw.detail === 'object' ? raw.detail : null,
      startedAt: Number.isFinite(raw.startedAt) ? raw.startedAt : 0, agentId: String(raw.agentId || ''), phoneNumberId: String(raw.phoneNumberId || '') };
  }
  function loadSaved(reload = false, force = false) {
    if (!owner || (!force && (preparing || ownsLock))) return;
    try {
      const raw = localStorage.getItem(PREFIX + encodeURIComponent(owner)) || '';
      if (!force && raw === savedVersion) return;
      savedVersion = raw;
      const stored = JSON.parse(raw || 'null');
      if (!stored || !Array.isArray(stored.items)) { if (raw) state.error = 'Saved queue is invalid. Review provider history before starting again.'; return; }
      const items = stored.items.slice(0, 100).map(item => restoredItem(item, reload)).filter(Boolean);
      state = { ...blank(), items, demo: restoredItem(stored.demo, reload), agentId: String(stored.agentId || ''), phoneNumberId: String(stored.phoneNumberId || ''),
        limit: Math.max(1, Math.min(100, Number(stored.limit) || 10)), running: reload ? false : !!stored.running, paused: !!stored.paused, error: String(stored.error || '') };
      if (items.length !== stored.items.length) state.error = 'Invalid saved contacts were hidden. Review provider history before restarting.';
      state.currentId = state.items.find(unresolved)?.id || null;
      if (reload) state.paused = state.items.some(item => item.status === 'pending' || unresolved(item));
    } catch (_) { state.error = 'Saved calling queue could not be loaded. Review provider history before starting again.'; }
  }
  function save() {
    if (!owner || owner !== identity()) return false;
    try { savedVersion = JSON.stringify(state); localStorage.setItem(PREFIX + encodeURIComponent(owner), savedVersion); return true; }
    catch (_) { state.error = 'Calling queue could not be saved. Allow browser storage before placing calls.'; state.running = false; return false; }
  }
  function notify() {
    const value = copy(state);
    for (const listener of listeners) { try { listener(value); } catch (_) {} }
  }
  function publish() { const saved = save(); notify(); return saved; }
  function resetAccount() {
    if (state && owner === identity()) return;
    epoch++; startup++;
    for (const controller of requests) controller.abort();
    for (const cancel of waits) cancel();
    requests.clear(); waits.clear();
    owner = identity(); state = blank(); savedVersion = ''; preparing = false; ownsLock = false;
    loadSaved(true, true);
    notify();
  }
  function sync() { resetAccount(); loadSaved(); return state; }
  function context() { sync(); if (!owner) throw new Error('Sign in before using the calling queue.'); return { owner, epoch, state }; }
  const current = ctx => ctx.owner === identity() && ctx.epoch === epoch && ctx.state === state;
  const ensure = ctx => { if (!current(ctx)) throw new DOMException('Account changed. Call dispatch stopped.', 'AbortError'); };
  function active() { return state.items.find(unresolved) || (unresolved(state.demo) ? state.demo : null); }

  async function request(path, options, ctx) {
    ensure(ctx);
    const auth = window.SupabaseAuth?.getAccessToken?.();
    if (!auth) throw new Error('Sign in to connect your ElevenLabs calling account.');
    const controller = new AbortController(); requests.add(controller);
    const deadline = setTimeout(() => controller.abort(), 35000);
    const local = ['localhost', '127.0.0.1'].includes(location.hostname);
    const sameOrigin = /^https?:$/.test(location.protocol) && (!local || location.port === '8000');
    const base = sameOrigin ? '' : (window.SKYLARK_CONFIG?.BACKEND_URL || 'http://localhost:8000').replace(/\/+$/, '');
    try {
      const response = await fetch(base + '/api/v1/elevenlabs' + path, { ...options, signal: controller.signal,
        headers: { Authorization: `Bearer ${auth}`, 'Content-Type': 'application/json' } });
      const data = await response.json(); ensure(ctx);
      if (!response.ok) {
        const error = new Error(typeof data.detail === 'string' ? data.detail : data.detail?.message || `Calling request failed (${response.status}).`);
        error.status = response.status; error.code = data.detail?.code; throw error;
      }
      return data;
    } finally { clearTimeout(deadline); requests.delete(controller); }
  }
  async function readiness(options = {}, ctx = context()) {
    const agentId = String(options.agentId || state.agentId || ''), phoneNumberId = String(options.phoneNumberId || state.phoneNumberId || '');
    const missing = [];
    if (!agentId) missing.push('agent'); if (!phoneNumberId) missing.push('outbound_number');
    if (missing.length) return { ready: false, missing, message: 'Choose a saved agent and a provisioned outbound number.' };
    return request('/calling-readiness?agent_id=' + encodeURIComponent(agentId) + '&phone_number_id=' + encodeURIComponent(phoneNumberId), {}, ctx);
  }
  function enqueue(leads) {
    context();
    if (state.running) throw new Error('Pause or stop the campaign before adding more contacts.');
    let added = 0, skipped = 0;
    const phones = new Set(state.items.map(item => item.lead.phone));
    const ids = new Set(state.items.map(item => item.id));
    for (const lead of Array.isArray(leads) ? leads : []) {
      const phone = normalizePhone(lead?.phone || lead?.mobile || lead?.phoneNumber || lead?.contactNumber);
      const id = String(lead?.id || lead?._id || phone);
      if (!phone || phones.has(phone) || ids.has(id) || state.items.length >= 100) { skipped++; continue; }
      state.items.push({ id, lead: { company: String(lead?.company || lead?.name || 'Lead').slice(0, 255), phone,
        contactName: String(lead?.contactName || lead?.contact_person || '').slice(0, 120) }, demo: false, status: 'pending', error: '', conversationId: '', detail: null, startedAt: 0, agentId: '', phoneNumberId: '' });
      phones.add(phone); ids.add(id); added++;
    }
    if (!publish()) throw new Error(state.error);
    return { added, skipped, queued: state.items.filter(item => item.status === 'pending').length };
  }
  function delay(ctx, ms) {
    return new Promise(resolve => {
      const finish = () => { clearTimeout(timer); waits.delete(finish); resolve(); };
      const timer = setTimeout(finish, ms); waits.add(finish);
      if (!current(ctx)) finish();
    });
  }
  function halt(error) { state.running = false; state.paused = true; state.error = String(error?.message || error); }
  async function dispatch(item, options, ctx) {
    ensure(ctx);
    item.status = 'dialing'; item.error = ''; item.startedAt = Date.now(); item.agentId = options.agentId; item.phoneNumberId = options.phoneNumberId;
    if (!item.demo) state.currentId = item.id;
    if (!publish()) throw new Error(state.error);
    try {
      const result = await request('/calls', { method: 'POST', body: JSON.stringify({ agent_id: options.agentId, phone_number_id: options.phoneNumberId,
        to_number: item.lead.phone, confirmed: true, dynamic_variables: { company: item.lead.company, user_name: item.lead.contactName || '' } }) }, ctx);
      ensure(ctx);
      item.conversationId = String(result.conversation_id || '');
      item.detail = result;
      if (result.success === false) { item.status = 'failed'; item.error = result.message || 'Provider rejected this call.'; halt(item.error); }
      else if (!item.conversationId) { item.status = 'unknown'; item.error = 'Provider response has no conversation ID. Review call history before retrying.'; halt(item.error); }
      else item.status = 'accepted';
    } catch (error) {
      if (!current(ctx)) return;
      // Validation/quota errors prove no call was accepted. Server/network
      // failures do not: never automatically redial after an ambiguous POST.
      item.status = error.status && error.status < 500 ? (error.status === 429 ? 'pending' : 'failed') : 'unknown';
      item.error = error.status && error.status < 500 ? error.message : 'Call outcome is unknown. Review provider call history before retrying.';
      halt(item.error);
    }
    if (current(ctx) && !publish()) halt(state.error);
  }
  async function detail(item, ctx) {
    if (!item?.conversationId) throw new Error('No conversation ID is available. Review provider call history before retrying.');
    const data = await request('/conversations/' + encodeURIComponent(item.conversationId), {}, ctx);
    ensure(ctx); item.detail = data;
    const status = data.status;
    if (!['initiated', 'in-progress', 'processing', 'done', 'failed'].includes(status)) throw new Error('Provider returned an unknown call state. Refresh its review before continuing.');
    item.status = status; item.error = status === 'failed' ? 'Provider marked this conversation failed.' : '';
    if (terminal(status) && !item.demo) state.currentId = null;
    if (!publish()) throw new Error(state.error);
    return copy(item);
  }
  async function monitor(item, options, ctx) {
    const expires = (item.startedAt || Date.now()) + (options.maxDuration + 90) * 1000;
    while (current(ctx) && item.conversationId && !terminal(item.status)) {
      try {
        await detail(item, ctx);
        if (terminal(item.status)) return;
        if (Date.now() >= expires) throw new Error('Call is still unresolved after its expected duration. Refresh call review before continuing.');
        await delay(ctx, 3000);
      } catch (error) {
        if (!current(ctx)) return;
        item.status = 'unknown'; item.error = error.message; halt(error); publish(); return;
      }
    }
  }
  async function locked(ctx, action) {
    const locks = window.navigator?.locks;
    if (!locks?.request) throw new Error('Calling needs a secure modern browser so one campaign can own the outbound queue. Open this app on localhost or HTTPS.');
    let signal;
    const acquired = new Promise(resolve => { signal = resolve; });
    locks.request('rudra-elevenlabs-calling:' + ctx.owner, { ifAvailable: true }, async lock => {
      signal(!!lock);
      if (lock && current(ctx)) {
        ownsLock = true;
        try { loadSaved(false, true); ctx.state = state; await action(); }
        finally { if (ctx.owner === owner && ctx.epoch === epoch) ownsLock = false; }
      }
    }).catch(error => { signal(false); if (current(ctx)) { halt(error); publish(); } });
    if (!await acquired) throw new Error('Another calling session is active for this account. Stop or finish it before starting another.');
  }
  async function prepare(options, ctx) {
    if (options.confirmed !== true) throw new Error('Confirm the destinations and real provider charges before placing calls.');
    if (active()) throw new Error('Review and refresh the active or unknown call before starting another.');
    const result = await readiness(options, ctx); ensure(ctx);
    if (!result.ready) throw new Error(result.message || 'Calling configuration is incomplete.');
    return { agentId: String(options.agentId || state.agentId), phoneNumberId: String(options.phoneNumberId || state.phoneNumberId),
      maxDuration: Number(result.max_duration_seconds) || 600 };
  }
  async function start(options = {}) {
    const ctx = context();
    if (state.running) throw new Error('Calling queue is already running.');
    if (active()) throw new Error('Review and refresh the active or unknown call before starting another.');
    if (!state.items.some(item => item.status === 'pending')) throw new Error('Add selected leads with valid phone numbers first.');
    // running is set before async readiness so double clicks cannot dispatch twice.
    const ticket = ++startup;
    const selected = new Set(state.items.filter(item => item.status === 'pending').map(item => item.id));
    // Do not overwrite another tab's progress while waiting for readiness/lock.
    try { localStorage.setItem(PREFIX + encodeURIComponent(owner), localStorage.getItem(PREFIX + encodeURIComponent(owner)) || JSON.stringify(blank())); }
    catch (_) { throw new Error('Calling queue could not be saved. Allow browser storage before placing calls.'); }
    preparing = true; state.running = true; state.paused = false; state.error = ''; notify();
    try {
      const config = await prepare(options, ctx); ensure(ctx);
      if (!state.running || ticket !== startup) return snapshot();
      await locked(ctx, async () => {
        let attempted = 0;
        try {
          if (ticket !== startup) return;
          if (active()) throw new Error('Review and refresh the active or unknown call before starting another.');
          state.running = true; state.paused = false; state.error = ''; state.agentId = config.agentId; state.phoneNumberId = config.phoneNumberId;
          state.limit = Math.min(100, Math.max(1, Math.floor(Number(options.limit) || state.limit || 10)));
          preparing = false;
          if (!publish()) throw new Error(state.error);
          while (current(ctx) && state.running && attempted < state.limit) {
            const item = state.items.find(row => row.status === 'pending' && selected.has(row.id)); if (!item) break;
            attempted++; await dispatch(item, config, ctx); if (!current(ctx)) return;
            if (item.conversationId && !terminal(item.status)) await monitor(item, config, ctx);
            if (unresolved(item)) break;
          }
        } finally {
          if (current(ctx)) { state.running = false; if (!active()) state.currentId = null; publish(); }
        }
      });
      return snapshot();
    } catch (error) {
      if (current(ctx) && ticket === startup) { preparing = false; loadSaved(false, true); ctx.state = state; halt(error); notify(); }
      throw error;
    } finally { if (current(ctx) && ticket === startup) preparing = false; }
  }
  function pause() { context(); startup++; state.running = false; state.paused = true; publish(); return snapshot(); }
  function stop() { context(); startup++; state.running = false; state.paused = false; publish(); return snapshot(); }
  async function refreshActive(id) {
    const ctx = context();
    const item = id ? state.items.find(row => row.id === id) || (state.demo?.id === id ? state.demo : null) : active();
    if (!item) return null;
    return detail(item, ctx);
  }
  function recoveryItem(id) {
    context();
    if (state.running || ownsLock) throw new Error('Wait for call tracking to stop before resolving an uncertain call.');
    const item = state.items.find(row => row.id === id) || (state.demo?.id === id ? state.demo : null);
    if (!item || item.status !== 'unknown') throw new Error('Only an uncertain call can be reconciled.');
    return item;
  }
  function resolveUnknown({ id, confirmedReviewed } = {}) {
    const item = recoveryItem(id);
    if (confirmedReviewed !== true) throw new Error('Confirm that you reviewed provider history and this call has ended.');
    item.status = 'skipped'; item.error = 'Manually reviewed and skipped. The call outcome was not confirmed.';
    if (state.currentId === id) state.currentId = null;
    state.error = ''; state.running = false;
    if (!publish()) throw new Error(state.error);
    return copy(item);
  }
  async function linkConversation({ id, conversationId } = {}) {
    const item = recoveryItem(id), ctx = context();
    if (!/^[A-Za-z0-9_-]{1,160}$/.test(conversationId || '')) throw new Error('Enter the matching conversation ID from recent call history.');
    const result = await request('/conversations/' + encodeURIComponent(conversationId) + '/verify-call', {
      method: 'POST', body: JSON.stringify({ agent_id: item.agentId || state.agentId, to_number: item.lead.phone, started_at: item.startedAt / 1000 })
    }, ctx);
    ensure(ctx);
    if (!result.verified || !terminal(result.conversation?.status)) throw new Error('This conversation does not prove the uncertain call has ended.');
    item.conversationId = conversationId; item.detail = result.conversation; item.status = result.conversation.status; item.error = '';
    if (state.currentId === id) state.currentId = null;
    state.error = ''; if (!publish()) throw new Error(state.error); return copy(item);
  }
  async function demoCall(options = {}) {
    const ctx = context(), phone = normalizePhone(options.phone);
    if (!phone) throw new Error('Enter your receiving mobile number in E.164 format.');
    if (state.running) throw new Error('Pause the campaign before placing a separate demo call.');
    if (active()) throw new Error('Review and refresh the active or unknown call before starting another.');
    // Reserve the in-document start slot before asynchronous readiness checks.
    const ticket = ++startup;
    preparing = true; state.running = true;
    try {
      const config = await prepare(options, ctx); ensure(ctx);
      if (!state.running || ticket !== startup) return null;
      let accepted, rejected;
      const ready = new Promise((resolve, reject) => { accepted = resolve; rejected = reject; });
      await locked(ctx, async () => {
        try {
          if (active()) throw new Error('Review and refresh the active or unknown call before starting another.');
          if (ticket !== startup) { accepted(null); return; }
          const item = { id: 'demo-' + Date.now() + '-' + (++sequence), demo: true, lead: { company: 'Demo call', phone }, status: 'pending', error: '', conversationId: '', detail: null };
          state.demo = item; state.running = false; preparing = false;
          await dispatch(item, config, ctx); accepted(current(ctx) ? copy(item) : null);
          if (current(ctx) && item.conversationId) await monitor(item, config, ctx);
        } catch (error) { rejected(error); }
        finally { accepted(null); if (current(ctx)) { state.running = false; publish(); } }
      });
      return await ready;
    } catch (error) { if (current(ctx) && ticket === startup) { preparing = false; loadSaved(false, true); ctx.state = state; state.running = false; state.error = error.message; notify(); } throw error; }
    finally { if (current(ctx) && ticket === startup) preparing = false; }
  }
  function remove(id) {
    context(); const item = state.items.find(row => row.id === id);
    if (state.running || unresolved(item)) throw new Error('Stop the campaign and resolve active calls before removing them.');
    state.items = state.items.filter(row => row.id !== id); publish(); return snapshot();
  }
  function clear() {
    context(); if (state.running || active()) throw new Error('Stop the campaign and resolve active calls before clearing the queue.');
    state.items = []; state.error = ''; state.currentId = null; publish(); return snapshot();
  }
  function snapshot() { sync(); return copy(state); }
  function on(listener) { listeners.add(listener); listener(snapshot()); return () => listeners.delete(listener); }
  window.addEventListener('rudra:auth-state', resetAccount);
  window.addEventListener('storage', event => {
    if (event.key !== PREFIX + encodeURIComponent(owner)) return;
    // The active tab keeps its item references; another tab may stop dispatch.
    if (ownsLock) {
      try { const remote = JSON.parse(event.newValue || 'null'); if (remote && !remote.running) { state.running = false; state.paused = !!remote.paused; notify(); } } catch (_) {}
    } else { loadSaved(); notify(); }
  });
  resetAccount();
  return { enqueue, snapshot, readiness, preview: readiness, start, resume: start, pause, stop, refreshActive, resolveUnknown, linkConversation, demoCall, clear, remove, on, normalizePhone };
})();
