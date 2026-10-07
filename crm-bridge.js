/* Connect existing account-owned leads and outreach to the authoritative CRM. */
(() => {
  'use strict';
  let owner = '', generation = 0, pending = null, timer = null;
  let stages = new Map();
  let serverBootstrapped = false, remoteCursor = null;
  let migrationStatus = { warnings: [], skippedOwnerless: 0, remoteComplete: false };
  const requests = new Set();
  const readCache = new Map(), inFlight = new Map();
  let readRevision = 0;
  function invalidate() { readRevision++; readCache.clear(); inFlight.clear(); }
  const labels = { new: 'New', attempted: 'Contact attempted', connected: 'Connected', follow_up: 'Follow-up', qualified: 'Qualified', client: 'Confirmed client', not_interested: 'Not interested', review_required: 'Review required' };
  const userId = () => window.SupabaseAuth?.getUser?.()?.id || '';
  function setDisclosure(open, keyboard = false) {
    const toggle = document.getElementById('crm-nav-toggle'), links = document.getElementById('crm-nav-links');
    if (!toggle || !links) return;
    toggle.setAttribute('aria-expanded', String(open)); links.inert = !open;
    links.classList.toggle('is-open', open); links.classList.toggle('crm-immediate', keyboard);
    document.getElementById('crm-nav-group')?.classList.toggle('is-open', open);
    document.getElementById('crm-nav-group')?.classList.toggle('crm-immediate', keyboard);
  }
  function checkOwner() {
    const next = userId();
    if (next === owner) return;
    owner = next; generation++; stages.clear(); pending = null;
    invalidate();
    serverBootstrapped = false; remoteCursor = null; migrationStatus = { warnings: [], skippedOwnerless: 0, remoteComplete: false };
    clearTimeout(timer); requests.forEach(controller => controller.abort()); requests.clear();
    window.CRMCtrl?.onAccountChange?.();
    const badge = document.getElementById('crm-due-count'); if (badge) { badge.hidden = true; badge.textContent = ''; }
    if (owner) timer = setTimeout(() => ensureBootstrap().catch(error => { if (error.name !== 'AbortError') console.warn('[CRM] Account reconciliation pending:', error.message); }), 400);
  }
  async function request(path, options = {}) {
    checkOwner();
    const token = window.SupabaseAuth?.getAccessToken?.();
    if (!owner || !token) throw new Error('Sign in to load your CRM.');
    if (options.signal?.aborted) throw new DOMException('Request cancelled', 'AbortError');
    const read = !options.method || options.method.toUpperCase() === 'GET';
    const key = owner + ':' + path, revision = readRevision;
    if (read && !options.fresh) {
      const cached = readCache.get(key);
      if (cached && cached.until > Date.now()) return cached.data;
      if (inFlight.has(key)) return inFlight.get(key);
    }
    if (!read) invalidate();
    const operation = performRequest(path, options, token, read, revision, key);
    if (read) inFlight.set(key, operation);
    try { return await operation; }
    finally { if (inFlight.get(key) === operation) inFlight.delete(key); }
  }
  async function performRequest(path, options, token, read, revision, key) {
    const ticket = generation, controller = new AbortController(); requests.add(controller);
    const cancel = () => controller.abort();
    if (options.signal?.aborted) cancel();
    options.signal?.addEventListener('abort', cancel, { once: true });
    const base = String(window.SKYLARK_CONFIG?.BACKEND_URL || 'http://localhost:8000').replace(/\/+$/, '');
    try {
      const response = await fetch(`${base}/api/crm${path}`, { ...options, signal: controller.signal, cache: 'no-store', headers: { Authorization: `Bearer ${token}`, ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...options.headers } });
      const data = await response.json().catch(() => ({}));
      if (ticket !== generation || owner !== userId()) throw new DOMException('Account changed', 'AbortError');
      if (!response.ok) { const error = new Error(response.status === 409 ? 'This CRM record changed elsewhere. Reload it before saving.' : typeof data.detail === 'string' ? data.detail : `CRM request failed (${response.status})`); error.status = response.status; throw error; }
      if (read && revision !== readRevision) throw new DOMException('CRM changed during read', 'AbortError');
      if (read) {
        if (readCache.size >= 64) readCache.delete(readCache.keys().next().value);
        readCache.set(key, { data, until: Date.now() + 15000 });
      } else invalidate();
      return data;
    } finally { options.signal?.removeEventListener('abort', cancel); requests.delete(controller); }
  }
  async function refreshStages() {
    checkOwner(); const ticket = generation, next = new Map();
    let offset = 0;
    while (true) {
      const data = await request(`/records?offset=${offset}&limit=250`);
      for (const record of data.records || []) {
        next.set(String(record.id), record);
        for (const source of record.sourceIds || []) next.set(String(source.sourceId), record);
      }
      offset += (data.records || []).length;
      if (!data.records?.length || offset >= data.total) break;
    }
    if (ticket !== generation) return;
    stages = next;
    document.dispatchEvent(new CustomEvent('crm:stateupdated'));
    document.dispatchEvent(new CustomEvent('crm:stagesupdated'));
    const today = new Date().toISOString().slice(0, 10);
    const due = await request(`/tasks?status=open&to=${today}&limit=1`);
    if (ticket !== generation) return;
    const badge = document.getElementById('crm-due-count');
    if (badge) { badge.textContent = String(due.total || ''); badge.hidden = !due.total; badge.title = `${due.total} follow-ups due today or earlier`; }
  }
  async function bootstrap() {
    const ticket = generation;
    if (!serverBootstrapped || remoteCursor) {
      let cursor = remoteCursor, complete = false;
      do {
        const result = await request('/bootstrap', { method: 'POST', body: JSON.stringify({ source: 'cloud', cursor }) });
        complete = result.complete; cursor = result.cursor;
        migrationStatus = { ...migrationStatus, warnings: result.warnings || [], remoteComplete: result.remoteComplete !== false };
        if (!complete && !cursor) throw new Error('CRM migration did not return a continuation cursor.');
      } while (!complete && ticket === generation);
      if (ticket === generation) { serverBootstrapped = true; remoteCursor = migrationStatus.remoteComplete ? null : cursor; }
    }
    // Sanitized-email legacy silos cannot prove ownership. Only explicitly
    // attributed new records are submitted; verified cloud history is read server-side.
    const leads = await window.MemoryEngine?.getAllLeads?.() || [];
    const own = leads.filter(lead => lead.ownerUserId === owner);
    migrationStatus.skippedOwnerless = leads.length - own.length;
    for (let offset = 0; offset < own.length && ticket === generation; offset += 250) {
      await request('/bootstrap', { method: 'POST', body: JSON.stringify({ source: 'local', records: own.slice(offset, offset + 250) }) });
    }
    if (ticket === generation) { await refreshStages(); await replayConfirmations(); }
  }
  function ensureBootstrap() {
    checkOwner();
    if (!owner) return Promise.reject(new Error('Sign in to load your CRM.'));
    if (!pending) {
      const ticket = generation;
      pending = bootstrap().catch(error => { if (ticket === generation) pending = null; throw error; });
    }
    return pending;
  }
  function notifyLeads() {
    checkOwner(); if (!owner) return;
    clearTimeout(timer);
    timer = setTimeout(async () => {
      pending = null;
      try { await ensureBootstrap(); await window.CRMCtrl?.refresh?.(); }
      catch (error) { if (error.name !== 'AbortError') console.warn('[CRM] Lead reconciliation pending:', error.message); }
    }, 400);
  }
  async function updateStage(lead, label) {
    await ensureBootstrap();
    const record = stages.get(String(lead.crmRecordId || lead.id));
    if (!record) throw new Error('This legacy lead needs verified account migration before CRM editing.');
    const stage = Object.keys(labels).find(key => labels[key] === label) || ({ Contacted: 'attempted', Closed: 'review_required' })[label];
    if (!stage) throw new Error('Choose a valid CRM stage.');
    const updated = await request(`/records/${encodeURIComponent(record.id)}`, { method: 'PATCH', body: JSON.stringify({ version: record.version, stage }) });
    await refreshStages(); window.CRMCtrl?.refresh?.(); return updated;
  }
  function confirmations() {
    try { const rows = JSON.parse(localStorage.getItem(`clavis_crm_confirmations_${owner}`) || '[]'); return Array.isArray(rows) ? rows : []; } catch (_) { return []; }
  }
  function saveConfirmations(rows) { localStorage.setItem(`clavis_crm_confirmations_${owner}`, JSON.stringify(rows)); }
  async function replayConfirmations() {
    const ticket = generation;
    for (const event of confirmations()) {
      const recordId = event.recordId || stages.get(String(event.leadId))?.id;
      if (!recordId) continue;
      await request(`/records/${encodeURIComponent(recordId)}/activities`, { method: 'POST', body: JSON.stringify({ kind: 'outreach', channel: 'whatsapp', outcome: 'user_confirmed', note: `User confirmed sending in WhatsApp at ${event.confirmedAt}.`, occurredAt: event.confirmedAt, idempotencyKey: event.key }) });
      if (ticket !== generation) return;
      saveConfirmations(confirmations().filter(row => row.key !== event.key));
    }
  }
  async function logWhatsApp(lead) {
    checkOwner();
    if (!owner) throw new Error('Sign in to retain this WhatsApp confirmation.');
    const confirmedAt = new Date().toISOString(), key = `whatsapp:${lead.id}:${confirmedAt}`;
    saveConfirmations([...confirmations(), { key, leadId: lead.id, recordId: lead.crmRecordId || stages.get(String(lead.id))?.id, confirmedAt }]);
    await ensureBootstrap(); await replayConfirmations();
    if (confirmations().some(row => row.key === key)) throw new Error('Confirmation saved on this device; this lead is awaiting verified CRM migration.');
    await refreshStages(); window.CRMCtrl?.refresh?.();
  }
  function openChannel(channel, record) {
    if (channel === 'calling') channel = 'call';
    const p = record.profile || {}, lead = { id: record.sourceIds?.[0]?.sourceId || record.id, crmRecordId: record.id, company: p.company, name: p.contactPerson, phone: p.mobile || p.phone, email: p.email, city: p.address, status: labels[record.stage] };
    window.crmSelectedLead = lead;
    location.hash = `#${channel === 'call' ? 'calling' : channel}`;
    if (channel === 'email') window.EmailCtrl?.setLeadAudience?.([lead]);
    if (channel === 'whatsapp') {
      window.WhatsAppCtrl?.init?.();
      if (window.WhatsAppCtrl) { window.WhatsAppCtrl.crmAudience = [lead]; window.WhatsAppCtrl.queue = [lead]; window.WhatsAppCtrl.currentIndex = 0; window.WhatsAppCtrl.updatePreview?.(); }
    }
    if (channel === 'call') {
      window.SarvamCallingUI?.sendLeads?.([lead], { silent: true });
    }
  }
  window.CRMBridge = { request, invalidate, ensureBootstrap, syncLegacy: ensureBootstrap, notifyLeads, notifyCloud: () => { serverBootstrapped = false; remoteCursor = null; notifyLeads(); }, logWhatsApp, refreshStages, updateStage, openChannel, setDisclosure,
    get migrationStatus() { return migrationStatus; },
    getRecord: id => stages.get(String(id)), getStage: id => stages.get(String(id))?.stage,
    getRecordId: id => stages.get(String(id))?.id,
    stageLabel: stage => labels[stage] || stage, labels };
  window.addEventListener('clavis:workspace-change', checkOwner);
  window.addEventListener('online', () => { pending = null; if (location.hash.startsWith('#crm')) notifyLeads(); });
  window.addEventListener('focus', checkOwner);
  document.addEventListener('nexus:leadsupdated', notifyLeads);
  document.addEventListener('DOMContentLoaded', () => {
    checkOwner();
    const toggle = document.getElementById('crm-nav-toggle');
    toggle?.addEventListener('click', event => setDisclosure(toggle.getAttribute('aria-expanded') !== 'true', event.detail === 0));
    document.getElementById('crm-nav-links')?.addEventListener('keydown', event => {
      if (event.key === 'Escape') { event.preventDefault(); setDisclosure(false, true); toggle.focus(); }
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        const links = [...document.querySelectorAll('#crm-nav-links a')], index = links.indexOf(document.activeElement);
        event.preventDefault(); links[(index + (event.key === 'ArrowDown' ? 1 : links.length - 1)) % links.length]?.focus();
      }
    });
  });
})();
