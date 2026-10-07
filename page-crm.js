/** Owner-scoped CRM. All counts and mutations come from the authenticated ledger. */
'use strict';
window.CRMCtrl = (() => {
  const stages = { new: 'New', attempted: 'Contact attempted', connected: 'Connected', follow_up: 'Follow-up', qualified: 'Qualified', client: 'Confirmed client', not_interested: 'Not interested', review_required: 'Review required' };
  const dealStages = { qualification: 'Qualification', proposal: 'Proposal', negotiation: 'Negotiation', won: 'Won', lost: 'Lost' };
  const fields = [
    ['company', 'Company'], ['contactPerson', 'Contact person'], ['designation', 'Designation'], ['phone', 'Phone', 'tel'], ['mobile', 'Mobile', 'tel'], ['email', 'Email', 'email'], ['website', 'Website'], ['address', 'Address', 'textarea'], ['industry', 'Industry'], ['source', 'Source'], ['serviceRequirement', 'Service requirement', 'textarea'], ['leadScore', 'Lead score', 'number'], ['nextAction', 'Next action'], ['followUpDate', 'Follow-up date', 'date'], ['additionalContacts', 'Additional contacts', 'textarea'], ['secondaryEmail', 'Secondary email', 'email'], ['rating', 'Rating'], ['employees', 'Employees'], ['annualRevenue', 'Annual revenue'], ['salutation', 'Salutation'], ['firstName', 'First name'], ['lastName', 'Last name'], ['fax', 'Fax'], ['skypeId', 'Skype ID'], ['emailOptOut', 'Email opt-out', 'checkbox'], ['phoneOptOut', 'Phone opt-out', 'checkbox']
  ];
  let owner = '', epoch = 0, activeView = '', timer = null, initialized = false, verifiedOwner = '';
  let aborter = new AbortController(), pageData = null, detail = null, opener = null, panelTab = 'profile', dirty = false, loadSerial = 0, detailSerial = 0;
  let filters = { search: '', stage: '', view: 'leads', from: '', to: '', offset: 0 }, activityTab = 'tasks', recordsTab = 'records', calendarMode = false;
  let channel = null, channelOwner = '', closeTimer = null, refreshPending = 0, renderedSignature = '';
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const number = value => value == null ? '—' : new Intl.NumberFormat('en-IN').format(value);
  const money = value => value == null ? 'Not entered' : new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(value);
  const when = value => value && !Number.isNaN(Date.parse(value)) ? new Date(value).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : 'Date unknown';
  const dateOnly = value => value ? String(value).slice(0, 10) : '';
  const options = (values, selected) => Object.entries(values).map(([key, label]) => `<option value="${key}"${key === selected ? ' selected' : ''}>${esc(label)}</option>`).join('');
  const button = (label, action, attrs = '') => `<button type="button" data-crm-action="${action}" ${attrs}>${label}</button>`;
  const currentOwner = () => window.SupabaseAuth?.getUser?.()?.id || '';
  const root = () => document.getElementById(`view-crm-${activeView}`);
  const status = (message, error = false) => {
    const el = root()?.querySelector('[data-crm-status]');
    if (el) { el.textContent = message; el.classList.toggle('crm-error', error); }
  };
  function migrationNotice() {
    const notices = root()?.querySelector('[data-crm-migration]');
    if (!notices) return;
    const state = window.CRMBridge?.migrationStatus;
    const messages = [...(state?.warnings || [])];
    if (state?.skippedOwnerless) messages.push(`${number(state.skippedOwnerless)} local records need account ownership evidence before importing.`);
    notices.textContent = messages.join(' '); notices.hidden = !messages.length;
  }
  function ensureRoots() {
    const host = document.getElementById('main-scroll-area');
    if (!host) return;
    ['overview', 'pipeline', 'activity', 'reports', 'clients'].forEach(view => {
      let el = document.getElementById(`view-crm-${view}`);
      if (!el) { el = document.createElement('section'); el.id = `view-crm-${view}`; el.className = 'view'; host.append(el); }
      el.classList.add('crm-workspace');
    });
  }
  function resetOwner() {
    epoch++; aborter.abort(); aborter = new AbortController(); loadSerial++; detailSerial++;
    owner = currentOwner(); verifiedOwner = ''; pageData = null; detail = null; dirty = false; renderedSignature = '';
    filters = { search: '', stage: '', view: 'leads', from: '', to: '', offset: 0 };
    closePanel(true); document.querySelectorAll('.crm-workspace').forEach(el => { el.replaceChildren(); el.removeAttribute('inert'); });
    channel?.close(); channel = null;
    if (owner && window.BroadcastChannel) {
      channelOwner = owner; channel = new BroadcastChannel(`clavis-crm-${owner}`);
      channel.onmessage = () => { window.CRMBridge?.invalidate?.(); if (currentOwner() === channelOwner && !document.hidden && activeView) refresh(true); };
    }
  }
  async function verify() {
    if (!owner || owner !== currentOwner()) throw new Error('Sign in to see your CRM workspace.');
    if (verifiedOwner === owner) return;
    const expected = owner, stamp = epoch;
    const auth = window.SupabaseAuth?.getClient?.()?.auth;
    if (!auth?.getUser) throw new Error('Secure sign-in is not ready. Retry after signing in.');
    const result = await auth.getUser();
    if (stamp !== epoch || expected !== currentOwner()) throw new DOMException('Account changed', 'AbortError');
    if (result.error || result.data?.user?.id !== expected) throw new Error('Your sign-in could not be verified. Sign in again.');
    verifiedOwner = expected;
  }
  async function request(path, options = {}) {
    await verify();
    const stamp = epoch, identity = owner;
    const config = { ...options, signal: aborter.signal };
    let data;
    if (window.CRMBridge?.request) data = await window.CRMBridge.request(path, config);
    else {
      const token = window.SupabaseAuth?.getAccessToken?.();
      if (!token) throw new Error('Sign in to see your CRM workspace.');
      const base = String(window.SKYLARK_CONFIG?.BACKEND_URL || 'http://localhost:8000').replace(/\/+$/, '');
      const response = await fetch(`${base}/api/crm${path}`, { ...config, cache: 'no-store', headers: { Authorization: `Bearer ${token}`, ...(config.body ? { 'Content-Type': 'application/json' } : {}) } });
      data = await response.json().catch(() => ({}));
      if (!response.ok) {
        const error = new Error(response.status === 409 ? 'This record changed elsewhere. Reload the record before saving your changes.' : typeof data.detail === 'string' ? data.detail : `CRM request failed (${response.status}).`);
        error.status = response.status; throw error;
      }
    }
    if (stamp !== epoch || identity !== currentOwner()) throw new DOMException('Account changed', 'AbortError');
    return data;
  }
  function query(extra = {}) {
    const params = new URLSearchParams();
    Object.entries({ ...filters, limit: 50, ...extra }).forEach(([key, value]) => { if (value !== '' && value != null) params.set(key, value); });
    return params.toString();
  }
  function pageShell() {
    const el = root(); if (!el || el.querySelector('.crm-page')) return;
    const names = { overview: ['CRM overview', 'A clear view of your leads, clients and next steps.'], pipeline: ['Pipeline', 'Keep the relationship and the deal in one place.'], activity: ['Follow-ups & activity', 'Your tasks, meetings and conversation history.'], reports: ['Reports', 'Explore your intake, contracts and outreach with clear, interactive reports.'], clients: ['Clients & contracts', 'Your confirmed clients, service agreements and upcoming renewals.'] };
    el.innerHTML = `<div class="crm-page"><header class="crm-heading"><div><p class="crm-eyebrow">Client workspace</p><h1>${names[activeView][0]}</h1><p>${names[activeView][1]}</p></div>${button('Refresh', 'refresh', 'class="crm-secondary"')}</header><nav class="crm-nav" aria-label="CRM workspace">${Object.entries(names).map(([key, text]) => `<button type="button" data-crm-action="route" data-route="${key}"${activeView === key ? ' aria-current="page"' : ''}>${text[0]}</button>`).join('')}</nav><form class="crm-filters" data-crm-form="filters"><label ${['overview', 'reports'].includes(activeView) ? 'hidden' : ''}>Search<input type="search" name="search" placeholder="Company, contact or activity" value="${esc(filters.search)}" maxlength="200"></label><label ${activeView === 'clients' ? 'hidden' : ''}>From<input type="date" name="from" value="${filters.from}"></label><label ${activeView === 'clients' ? 'hidden' : ''}>To<input type="date" name="to" value="${filters.to}"></label><button type="submit">Apply filters</button>${button('Clear', 'clear', 'class="crm-secondary"')}</form><p class="crm-migration-notice" data-crm-migration role="status" hidden></p><p class="crm-status" data-crm-status role="status" aria-live="polite">Loading your workspace…</p><div data-crm-content></div></div>`;
  }
  function empty(message) { return `<div class="crm-empty"><h2>Nothing here yet</h2><p>${message}</p></div>`; }
  function activityList(items = []) {
    const note = item => {
      if (item.kind === 'record_updated') {
        try { const changes = JSON.parse(item.note).changes || {}; return `Updated ${[...(changes.profile ? Object.keys(changes.profile).map(key => fields.find(field => field[0] === key)?.[1] || key) : []), ...(changes.stage ? ['relationship stage'] : [])].join(', ') || 'record details'}.`; } catch (_) { return 'Record details updated.'; }
      }
      return item.note || 'No note entered.';
    };
    return items.length ? `<ol class="crm-timeline">${items.map(item => `<li><div><span class="crm-tag">${esc((item.kind || 'Activity').replace(/_/g, ' '))}</span><time datetime="${esc(item.occurredAt || '')}">${when(item.occurredAt)}</time></div><p>${esc(note(item))}</p><div class="crm-row-meta">${[item.channel, item.outcome, item.evidence].filter(Boolean).map(value => esc(String(value).replace(/_/g, ' '))).join(' · ')}</div>${item.recordId ? button('Open record', 'record', `data-id="${esc(item.recordId)}" class="crm-text-button"`) : ''}${['remark', 'conversation'].includes(item.kind) ? button('Edit note', 'edit-activity', `data-id="${esc(item.id)}" class="crm-text-button"`) : ''}</li>`).join('')}</ol>` : empty('Your recorded activity will appear here.');
  }
  function chart(title, items, action, label, value, meta) {
    const max = Math.max(1, ...items.map(item => Number(value(item)) || 0));
    return `<section class="crm-chart"><h2>${title}</h2>${items.length ? `<div class="crm-bars">${items.map(item => {
      const count = Number(value(item)) || 0, name = label(item), attributes = meta(item);
      return `<button type="button" class="crm-bar" data-crm-action="${action}" ${attributes} aria-label="${esc(name)}: ${number(count)}. Open matching records."><span>${esc(name)}</span><span class="crm-bar-track"><svg viewBox="0 0 100 12" preserveAspectRatio="none" aria-hidden="true"><rect x="0" y="0" width="${Math.max(0, count / max * 100)}" height="12" rx="2" /></svg></span><strong>${number(count)}</strong><span class="crm-tooltip" role="tooltip">${esc(name)} · ${number(count)}</span></button>`;
    }).join('')}</div>` : `<p class="crm-muted">No dated entries in this period.</p>`}</section>`;
  }
  function usageHeatmap(usage) {
    const known = new Map((usage.days || []).map(day => [day.date, day]));
    if (!known.size) return `<section class="crm-chart"><h2>Daily workspace activity</h2><p class="crm-muted">Usage history is not yet available.</p></section>`;
    const dates = [...known.keys()].sort(), end = filters.to || dates[dates.length - 1], endTime = Date.parse(`${end}T00:00:00Z`);
    const startTime = Math.max(filters.from ? Date.parse(`${filters.from}T00:00:00Z`) : endTime - 89 * 86400000, usage.historyKnownFrom ? Date.parse(`${usage.historyKnownFrom}T00:00:00Z`) : endTime - 89 * 86400000);
    const max = Math.max(1, ...usage.days.map(day => day.activities));
    const cells = [];
    // ponytail: 366 visible days; apply a narrower date range for older daily detail.
    for (let time = Math.max(startTime, endTime - 365 * 86400000); time <= endTime; time += 86400000) {
      const date = new Date(time).toISOString().slice(0, 10), item = known.get(date) || { sessions: 0, activities: 0 };
      const level = item.activities ? Math.min(4, Math.ceil(item.activities / max * 4)) : 0;
      cells.push(`<button type="button" class="crm-heat-cell crm-heat-${level}" data-crm-action="day-activity" data-date="${date}" aria-label="${date}: ${number(item.sessions)} sessions, ${number(item.activities)} activities. Open daily activity."><span class="crm-tooltip">${date} · ${number(item.sessions)} sessions · ${number(item.activities)} activities</span></button>`);
    }
    return `<section class="crm-chart"><h2>Daily workspace activity</h2><div class="crm-heatmap">${cells.join('')}</div><p class="crm-muted">${new Date(Math.max(startTime, endTime - 365 * 86400000)).toISOString().slice(0, 10)} – ${end} · Darker green means more recorded activity. Select a day to see its entries.</p></section>`;
  }
  function overview(data) {
    const metrics = data.overview.metrics;
    const cards = [ ['Leads', 'leads', 'leads'], ['Confirmed clients', 'clients', 'clients'], ['Conversations', 'conversations', 'conversations'], ['Pending follow-ups', 'pendingFollowUps', 'tasks'], ['Messages sent', 'messagesSent', 'sent'], ['Unique recipients', 'uniqueRecipients', 'recipients'] ];
    return `<div class="crm-metrics">${cards.map(([label, key, target]) => `<button type="button" data-crm-action="metric" data-target="${target}"><span>${label}</span><strong>${number(metrics[key])}</strong><small>View details</small></button>`).join('')}</div><div class="crm-values"><button type="button" data-crm-action="metric" data-target="deals"><span>Open monthly pipeline</span><strong>${money(metrics.pipelineMonthlyValue)}</strong></button><button type="button" data-crm-action="metric" data-target="won"><span>Won monthly value</span><strong>${money(metrics.wonMonthlyValue)}</strong></button><p>Deal amounts in INR per month. Won value records agreements, not received revenue.${metrics.incompleteDealValues ? ` ${number(metrics.incompleteDealValues)} deals have no monthly amount.` : ''}</p></div><div class="crm-chart-grid">${chart('Relationship stages', data.overview.stages || [], 'stage', item => stages[item.stage] || item.stage, item => item.count, item => `data-stage="${esc(item.stage)}"`)}${chart('Lead intake', data.overview.intake || [], 'day-records', item => item.date, item => item.count, item => `data-date="${esc(item.date)}"`)}${chart('Outreach outcomes', data.overview.outreach || [], 'outreach', item => `${item.channel} · ${item.outcome}`, item => item.count, item => `data-channel="${esc(item.channel)}" data-outcome="${esc(item.outcome)}"`)}${usageHeatmap(data.usage)}</div><p class="crm-muted">${data.usage.historyKnownFrom ? `Usage history available from ${esc(data.usage.historyKnownFrom)}.` : 'Usage history is not yet available.'} Unknown historical dates are excluded from date charts.</p><section class="crm-section"><div class="crm-section-title"><h2>Recent activity</h2>${button('See all activity', 'metric', 'data-target="activity" class="crm-text-button"')}</div>${activityList(data.overview.recentActivity)}</section>`;
  }
  function pager(total) {
    return `<div class="crm-pagination"><span>${total ? `${number(filters.offset + 1)}–${number(Math.min(filters.offset + 50, total))} of ${number(total)}` : '0 records'}</span>${button('Previous', 'previous', filters.offset <= 0 ? 'disabled' : '')}${button('Next', 'next', filters.offset + 50 >= total ? 'disabled' : '')}</div>`;
  }
  function recordRows(data) {
    return data.records?.length ? `<div class="crm-table-wrap"><table class="crm-table"><caption class="crm-sr-only">${filters.view === 'clients' ? 'Client' : 'Lead'} records</caption><thead><tr><th scope="col">Company / contact</th><th scope="col">Stage</th><th scope="col">Next step</th><th scope="col">Follow-up</th><th scope="col">Contact</th></tr></thead><tbody>${data.records.map(record => `<tr><td><button type="button" data-crm-action="record" data-id="${esc(record.id)}" class="crm-record-link">${esc(record.profile.company || record.profile.contactPerson || 'Unnamed record')}</button><span class="crm-cell-sub">${esc(record.profile.contactPerson || record.profile.industry || '')}</span></td><td><span class="crm-tag">${esc(stages[record.stage] || record.stage)}</span></td><td>${esc(record.profile.nextAction || '—')}</td><td>${esc(dateOnly(record.profile.followUpDate) || '—')}</td><td>${esc(record.profile.email || record.profile.phone || record.profile.mobile || '—')}</td></tr>`).join('')}</tbody></table></div>${pager(data.total)}` : empty('Imported or collected leads will appear here. Try clearing the filters.');
  }
  function dealCard(deal, inPanel = false) {
    return `<article class="crm-deal"><div class="crm-section-title"><h3>${esc(deal.name || 'Untitled deal')}</h3><span class="crm-tag">${esc(dealStages[deal.stage] || deal.stage)}</span></div><strong>${money(deal.monthlyAmount)}${deal.monthlyAmount != null ? '<small> / month</small>' : ''}</strong><p>${esc(deal.serviceType || 'Service not entered')} · ${deal.durationMonths == null ? 'Duration not entered' : `${number(deal.durationMonths)} months`}</p><p>${esc(deal.nextStep || 'Next step not entered')}</p><div class="crm-row-meta">Expected close: ${esc(dateOnly(deal.expectedCloseDate) || 'Unknown')} · Probability: ${deal.probability == null ? 'Unknown' : `${deal.probability}%`}${deal.lossReason ? ` · ${esc(deal.lossReason)}` : ''}</div>${button(inPanel ? 'Edit deal' : 'Open record', inPanel ? 'edit-deal' : 'record', `data-id="${esc(inPanel ? deal.id : deal.recordId)}" class="crm-text-button"`)}</article>`;
  }
  function pipeline(data) {
    if (recordsTab === 'business') return `<div class="crm-segments">${button('Records', 'records-tab', 'data-tab="records"')}${button('Deals', 'records-tab', 'data-tab="deals"')}${button('Business outcomes', 'records-tab', 'data-tab="business" aria-pressed="true"')}</div>` + window.CRMBusiness.render(data.business) + pager(data.business.total);
    const tabs = `<div class="crm-toolbar"><div class="crm-segments" aria-label="Pipeline display">${button('Records', 'records-tab', `data-tab="records" aria-pressed="${recordsTab === 'records'}"`)}${button('Deals', 'records-tab', `data-tab="deals" aria-pressed="${recordsTab === 'deals'}"`)}${button('Business outcomes', 'records-tab', `data-tab="business" aria-pressed="${recordsTab === 'business'}"`)}</div>${recordsTab === 'records' ? `<label>Relationship<select data-crm-filter="view">${options({ '': 'All records', leads: 'Leads', clients: 'Confirmed clients' }, filters.view)}</select></label><label>Stage<select data-crm-filter="stage"><option value="">All stages</option>${options(stages, filters.stage)}</select></label>` : `<label>Deal stage<select data-crm-filter="dealStage"><option value="">All deals</option><option value="open"${filters.dealStage === 'open' ? ' selected' : ''}>Open pipeline</option>${options(dealStages, filters.dealStage)}</select></label>`}</div>`;
    if (recordsTab === 'records') return tabs + recordRows(data.records);
    const deals = data.deals.deals || [];
    return tabs + (deals.length ? `<div class="crm-deal-grid">${deals.filter(deal => !deal.archived && (!filters.dealStage || (filters.dealStage === 'open' ? !['won', 'lost'].includes(deal.stage) : deal.stage === filters.dealStage))).map(deal => dealCard(deal)).join('')}</div>${pager(data.deals.total)}` : empty('Open a record and add a deal to build your pipeline.'));
  }
  function taskList(tasks = [], inPanel = false) {
    return tasks.length ? `<ul class="crm-tasks">${tasks.filter(task => !task.archived).map(task => `<li><div><span class="crm-tag">${esc(task.kind)} · ${esc(task.status)}</span><h3>${esc(task.title)}</h3><p>${esc(task.notes || '')}</p><time datetime="${esc(task.dueAt || '')}" class="${task.status === 'open' && task.dueAt && Date.parse(task.dueAt) < Date.now() ? 'crm-overdue' : ''}">${when(task.dueAt)}</time></div><div class="crm-task-actions">${button(task.status === 'completed' ? 'Reopen' : 'Complete', 'task-status', `data-id="${esc(task.id)}" data-version="${task.version}" data-status="${task.status === 'completed' ? 'open' : 'completed'}"`)}${button(inPanel ? 'Edit' : 'Open record', inPanel ? 'edit-task' : 'record', `data-id="${esc(inPanel ? task.id : task.recordId)}" class="crm-secondary"`)}</div></li>`).join('')}</ul>` : empty('Open a record to schedule a task or meeting.');
  }
  function taskCalendar(tasks) {
    const months = new Map();
    tasks.forEach(task => { const date = dateOnly(task.dueAt); if (!date) return; const month = date.slice(0,7); if (!months.has(month)) months.set(month, new Map()); const days = months.get(month); if (!days.has(date)) days.set(date, []); days.get(date).push(task); });
    if (!months.size) return '<p class="crm-muted">No dated follow-ups in this filtered page. Undated tasks remain available in List view.</p>';
    return [...months].sort().map(([month, days]) => { const first = new Date(month + '-01T12:00:00Z'), count = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth()+1,0)).getUTCDate(); return `<section class="crm-calendar"><h2>${first.toLocaleDateString(undefined,{month:'long',year:'numeric',timeZone:'UTC'})}</h2><div class="crm-calendar-grid">${['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].map(day=>`<span>${day}</span>`).join('')}${'<span></span>'.repeat(first.getUTCDay())}${Array.from({length:count},(_,i)=>{const date=month+'-'+String(i+1).padStart(2,'0');return `<div class="crm-calendar-day"><span>${i+1}</span>${(days.get(date)||[]).map(task=>button(esc(task.title),'record',`data-id="${esc(task.recordId)}" title="${esc(when(task.dueAt))} · ${esc(task.status)}"`)).join('')}</div>`;}).join('')}</div></section>`; }).join('') + '<p class="crm-muted">Calendar shows dated tasks from the current filtered page. Use Next for remaining tasks.</p>';
  }
  function activityPage(data) {
    return `<div class="crm-toolbar"><div class="crm-segments" aria-label="Activity display">${button('Follow-ups & meetings', 'activity-tab', `data-tab="tasks" aria-pressed="${activityTab === 'tasks'}"`)}${button(calendarMode ? 'List view' : 'Calendar view', 'task-calendar', `aria-pressed="${calendarMode}"`)}${button('Activity log', 'activity-tab', `data-tab="activities" aria-pressed="${activityTab === 'activities'}"`)}</div><label>${activityTab === 'tasks' ? 'Task type' : 'Activity type'}<select data-crm-filter="kind"><option value="">All types</option>${options(activityTab === 'tasks' ? { task: 'Task', meeting: 'Meeting' } : { remark: 'Remark', conversation: 'Conversation', outreach: 'Outreach', record_updated: 'Record updates' }, filters.kind)}</select></label>${activityTab === 'tasks' ? `<label>Status<select data-crm-filter="status"><option value="">All statuses</option>${options({ open: 'Open', completed: 'Completed' }, filters.status)}</select></label>` : ''}</div>${activityTab === 'tasks' ? (calendarMode ? taskCalendar(data.tasks.tasks) : taskList(data.tasks.tasks)) + pager(data.tasks.total) : `${filters.confirmed || filters.uniqueRecipients || filters.channel || filters.outcome ? `<p class="crm-muted">Showing ${filters.uniqueRecipients ? 'one confirmed entry per recipient' : filters.confirmed ? 'confirmed entries' : 'matching entries'}${filters.channel ? ` · ${esc(filters.channel)}` : ''}${filters.outcome ? ` · ${esc(filters.outcome)}` : ''}. ${button('Show all activity', 'all-activity', 'class="crm-text-button"')}</p>` : ''}${activityList(data.activities.activities)}${pager(data.activities.total)}`}`;
  }
  function render() {
    const content = root()?.querySelector('[data-crm-content]');
    if (!content || !pageData) return;
    const opened = [...content.querySelectorAll('details[data-business-section][open]')].map(el => el.dataset.businessSection);
    content.innerHTML = activeView === 'overview' ? overview(pageData) : activeView === 'pipeline' ? pipeline(pageData) : activeView === 'reports' ? window.CRMInsights.reports(pageData.reports) : activeView === 'clients' ? window.CRMInsights.clients(pageData.clients, filters.renewal || '') + pager(pageData.clients.total) : activityPage(pageData);
    renderedSignature = JSON.stringify(pageData);
    opened.forEach(key => { const el = content.querySelector(`details[data-business-section="${key}"]`); if (el) el.open = true; });
  }
  async function refresh(background = false) {
    if (!activeView || document.hidden && background || background && refreshPending) return;
    if (owner !== currentOwner()) resetOwner();
    pageShell();
    const stamp = epoch, serial = ++loadSerial, view = activeView;
    if (!background) status('Loading your workspace…');
    refreshPending++;
    try {
      await verify();
      await window.CRMBridge?.ensureBootstrap?.();
      if (stamp !== epoch || view !== activeView) return;
      migrationNotice();
      let next;
      if (view === 'overview') {
        const [summary, usage] = await Promise.all([request(`/overview?${query({ search: '', stage: '', view: '', offset: '', limit: '' })}`), request(`/usage?${query({ search: '', stage: '', view: '', offset: '', limit: '' })}`)]);
        next = { overview: summary, usage };
      } else if (view === 'reports') next = { reports: await request(`/reports?${query({ search: '', stage: '', view: '', offset: '', limit: '', timezone: 'Asia/Kolkata' })}`) };
      else if (view === 'clients') next = { clients: await request(`/clients?${new URLSearchParams({ search: filters.search, renewal: filters.renewal || '', offset: filters.offset, limit: 50 })}`) };
      else if (view === 'pipeline') {
        if (recordsTab === 'business') next = { business: await window.CRMBusiness.load(filters.offset, filters.search, filters.from, filters.to) };
        else if (recordsTab === 'records') next = { records: await request(`/records?${query()}`) };
        else next = { deals: await request(`/deals?${query({ view: '', stage: filters.dealStage || '' })}`) };
      } else if (activityTab === 'tasks') next = { tasks: await request(`/tasks?${query({ stage: '', view: '' })}`) };
      else next = { activities: await request(`/activities?${query({ stage: '', view: '' })}`) };
      if (stamp !== epoch || serial !== loadSerial || view !== activeView) return;
      pageData = next;
      if (next.clients) document.dispatchEvent(new CustomEvent('crm:insights', { detail: { ...next.clients.summary, asOf: next.clients.asOf } }));
      // Polling never replaces a focused list control or any open record form.
      const visiblePanel = document.getElementById('crm-record-panel');
      if (!background || (JSON.stringify(next) !== renderedSignature && (!visiblePanel || visiblePanel.hidden) && !root()?.querySelector('[data-crm-content]')?.contains(document.activeElement))) render();
      status(`Updated ${new Date().toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}.`);
    } catch (error) {
      if (stamp !== epoch || serial !== loadSerial || error.name === 'AbortError') return;
      status(`${error.message}${pageData ? ' Showing the last successful update.' : ''}`, true);
      if (!pageData) root()?.querySelector('[data-crm-content]')?.replaceChildren();
    } finally { refreshPending--; }
  }
  function route(view) {
    if (closePanel() === false) return;
    const hash = `#crm-${view}`;
    if (window.location && window.location.hash !== hash) { window.location.hash = hash; return; }
    if (typeof window.showView === 'function') window.showView(`crm-${view}`);
    else init(view);
  }
  function field(key, label, type = 'text', value = '', required = false) {
    const id = `crm-field-${key}`;
    if (type === 'checkbox') return `<label class="crm-check" for="${id}"><input id="${id}" name="${key}" type="checkbox"${value ? ' checked' : ''}>${label}</label>`;
    const normalized = ['date', 'datetime-local'].includes(type) ? type === 'date' ? dateOnly(value) : value && !Number.isNaN(Date.parse(value)) ? new Date(Date.parse(value) - new Date(value).getTimezoneOffset() * 60000).toISOString().slice(0, 16) : '' : typeof value === 'object' ? JSON.stringify(value) : value ?? '';
    return `<label for="${id}">${label}${type === 'textarea' ? `<textarea id="${id}" name="${key}" rows="3" maxlength="10000">${esc(normalized)}</textarea>` : `<input id="${id}" name="${key}" type="${type}" value="${esc(normalized)}"${type === 'number' ? ' step="any" min="0"' : ''}${required ? ' required' : ''}${key === 'probability' ? ' max="100"' : ''}>`}</label>`;
  }
  function profileForm() {
    const contacts = Array.isArray(detail.profile.additionalContacts) ? detail.profile.additionalContacts : [];
    return `<form data-crm-form="profile" class="crm-form"><p class="crm-muted">Update the relationship here. Client status comes from an active Won deal.</p><label>Relationship stage<select name="stage"${detail.stage === 'client' ? ' disabled' : ''}>${options(stages, detail.stage).replace('<option value="client"', `<option value="client"${detail.stage === 'client' ? '' : ' disabled'}`)}</select></label><div class="crm-field-grid">${fields.filter(([key]) => key !== 'additionalContacts').map(([key, label, type]) => field(key, label, type, detail.profile[key])).join('')}</div><fieldset class="crm-contacts"><legend>Additional contacts</legend><div data-crm-contacts>${contacts.map((contact, index) => contactFields(contact, index)).join('')}</div>${button('Add contact', 'add-contact', 'class="crm-secondary"')}</fieldset><div class="crm-form-actions"><button type="submit">Save profile</button>${button('Reload record', 'reload-record', 'class="crm-secondary"')}<span data-crm-save-status role="status"></span></div></form>`;
  }
  function contactFields(contact = {}, index = 0) {
    if (typeof contact === 'string') contact = { name: contact };
    return `<div class="crm-contact-row" data-crm-contact data-original="${esc(JSON.stringify(contact))}"><label>Name<input name="contactName" type="text" value="${esc(contact.name || contact.contactPerson || '')}" aria-label="Additional contact ${index + 1} name"></label><label>Email<input name="contactEmail" type="email" value="${esc(contact.email || '')}" aria-label="Additional contact ${index + 1} email"></label><label>Phone<input name="contactPhone" type="tel" value="${esc(contact.phone || contact.mobile || '')}" aria-label="Additional contact ${index + 1} phone"></label>${button('Remove', 'remove-contact', 'class="crm-secondary"')}</div>`;
  }
  function panelBody() {
    if (!detail) return '';
    if (panelTab === 'profile') return profileForm();
    if (panelTab === 'deals') return `<div class="crm-section-title"><h2>Deals</h2>${button('Add deal', 'new-deal')}</div><div data-crm-editor></div>${(detail.deals || []).filter(deal => !deal.archived).map(deal => dealCard(deal, true)).join('') || empty('Add the real service, amount and next step when they are known.')}`;
    if (panelTab === 'tasks') return `<div class="crm-section-title"><h2>Tasks & meetings</h2>${button('Add task', 'new-task')}</div><div data-crm-editor></div>${taskList(detail.tasks, true)}`;
    return (window.CRMBusiness?.form(detail) || '') + `<form data-crm-form="activity" class="crm-form"><h2>Add an activity</h2><label>Type<select name="kind"><option value="remark">Remark</option><option value="conversation">Conversation log</option></select></label><label>Channel<select name="channel"><option value="">No channel</option>${options({ call: 'Phone', email: 'Email', whatsapp: 'WhatsApp', meeting: 'Meeting' }, '')}</select></label><label>Conversation outcome<select name="outcome"><option value="">Choose an outcome</option>${options({ connected: 'Connected', replied: 'Replied', meeting: 'Meeting held', qualified: 'Qualified', follow_up: 'Follow-up needed', not_interested: 'Not interested', completed: 'Conversation completed' }, '')}</select></label>${field('note', 'Note', 'textarea', '', true)}<p class="crm-muted">A conversation is your explicit log. Sent messages and confirmed WhatsApp delivery are separate entries.</p><button type="submit">Save activity</button><span data-crm-save-status role="status"></span></form>${activityList(detail.activities)}`;
  }
  function ensurePanel() {
    let panel = document.getElementById('crm-record-panel'); if (panel) return panel;
    panel = document.createElement('div'); panel.id = 'crm-record-panel'; panel.className = 'crm-panel-layer'; panel.hidden = true;
    panel.innerHTML = '<div class="crm-panel-scrim" data-crm-action="close"></div><aside class="crm-panel" role="dialog" aria-modal="true" aria-labelledby="crm-panel-title" tabindex="-1"><div data-crm-panel-head></div><div data-crm-panel-body></div><p class="crm-panel-status" role="status" aria-live="polite" data-crm-panel-status></p></aside>';
    document.body.append(panel); return panel;
  }
  function renderPanel() {
    const panel = ensurePanel();
    if (!detail) return;
    panel.querySelector('[data-crm-panel-head]').innerHTML = `<header class="crm-panel-heading"><div><p class="crm-eyebrow">${esc(stages[detail.stage] || detail.stage)}</p><h2 id="crm-panel-title">${esc(detail.profile.company || detail.profile.contactPerson || 'Record details')}</h2><p>${esc(detail.profile.contactPerson || detail.profile.email || '')}</p></div>${button('Close', 'close', 'aria-label="Close record details" class="crm-secondary"')}</header><div class="crm-channel-actions">${button('Email', 'channel', `data-channel="email"${!detail.profile.email || detail.profile.emailOptOut ? ' disabled' : ''}`)}${button('WhatsApp', 'channel', `data-channel="whatsapp"${!(detail.profile.mobile || detail.profile.phone) || detail.profile.phoneOptOut ? ' disabled' : ''}`)}${button('Call', 'channel', `data-channel="calling"${!(detail.profile.mobile || detail.profile.phone) || detail.profile.phoneOptOut ? ' disabled' : ''}`)}</div><div class="crm-panel-tabs" role="tablist" aria-label="Record details">${Object.entries({ profile: 'Profile', deals: 'Deals', tasks: 'Tasks', activity: 'Activity' }).map(([key, label]) => `<button type="button" role="tab" id="crm-tab-${key}" aria-controls="crm-panel-content" aria-selected="${panelTab === key}" tabindex="${panelTab === key ? 0 : -1}" data-crm-action="panel-tab" data-tab="${key}">${label}</button>`).join('')}</div>`;
    panel.querySelector('[data-crm-panel-body]').innerHTML = `<div id="crm-panel-content" role="tabpanel" aria-labelledby="crm-tab-${panelTab}">${panelBody()}</div>`;
  }
  async function openRecord(id, preserveTab = false) {
    if (owner !== currentOwner()) resetOwner();
    const serial = ++detailSerial, stamp = epoch;
    if (!preserveTab) { opener = document.activeElement; panelTab = 'profile'; }
    const panel = ensurePanel(); clearTimeout(closeTimer); panel.hidden = false;
    if (!preserveTab) { detail = null; dirty = false; panel.querySelector('[data-crm-panel-head]').innerHTML = '<header class="crm-panel-heading"><h2 id="crm-panel-title">Record details</h2>' + button('Close', 'close', 'class="crm-secondary"') + '</header>'; panel.querySelector('[data-crm-panel-body]').replaceChildren(); }
    document.getElementById('app-shell')?.setAttribute('inert', '');
    panel.querySelector('[data-crm-panel-status]').textContent = 'Loading record…';
    panel.classList.toggle('crm-instant', window.matchMedia?.('(prefers-reduced-motion: reduce)').matches || !window.CRMCtrl.pointerInput);
    requestAnimationFrame(() => panel.classList.add('is-open'));
    panel.querySelector('.crm-panel').focus();
    try {
      const record = await request(`/records/${encodeURIComponent(id)}`);
      if (stamp !== epoch || serial !== detailSerial) return;
      detail = record; dirty = false; renderPanel(); panel.querySelector('[data-crm-panel-status]').textContent = '';
      panel.querySelector('[data-crm-action="close"]:not(.crm-panel-scrim)')?.focus();
    } catch (error) {
      if (stamp === epoch && serial === detailSerial && error.name !== 'AbortError') panel.querySelector('[data-crm-panel-status]').textContent = error.message;
    }
  }
  function closePanel(immediate = false) {
    const panel = document.getElementById('crm-record-panel');
    if (dirty && !immediate && !window.confirm('Discard unsaved changes in this record?')) return false;
    detailSerial++;
    if (!panel || panel.hidden) return;
    panel.classList.remove('is-open'); document.getElementById('app-shell')?.removeAttribute('inert');
    clearTimeout(closeTimer);
    const finish = () => { if (!panel.classList.contains('is-open')) { panel.hidden = true; detail = null; dirty = false; panel.querySelector('[data-crm-panel-head]').replaceChildren(); panel.querySelector('[data-crm-panel-body]').replaceChildren(); } };
    if (immediate || panel.classList.contains('crm-instant')) finish(); else closeTimer = setTimeout(finish, 320);
    if (opener?.isConnected) opener.focus();
  }
  function dealEditor(id) {
    const deal = (detail.deals || []).find(item => item.id === id) || {};
    const el = document.querySelector('#crm-record-panel [data-crm-editor]');
    el.innerHTML = `<form data-crm-form="deal" data-id="${esc(deal.id || '')}" data-version="${deal.version || ''}" class="crm-form crm-editor"><h3>${deal.id ? 'Edit deal' : 'New deal'}</h3><div class="crm-field-grid">${field('name', 'Deal name', 'text', deal.name, true)}${field('serviceType', 'Service type', 'text', deal.serviceType)}${field('monthlyAmount', 'Monthly amount (INR)', 'number', deal.monthlyAmount)}${field('durationMonths', 'Duration (months)', 'number', deal.durationMonths)}${field('expectedCloseDate', 'Expected close date', 'date', deal.expectedCloseDate)}${field('contractStartDate', 'Contract start date', 'date', deal.contractStartDate)}${field('contractEndDate', 'Contract end date', 'date', deal.contractEndDate)}${field('probability', 'Probability (%)', 'number', deal.probability)}<label>Deal stage<select name="stage">${options(dealStages, deal.stage || 'qualification')}</select></label>${field('nextStep', 'Next step', 'text', deal.nextStep)}${field('lossReason', 'Loss reason', 'textarea', deal.lossReason)}</div><div class="crm-form-actions"><button type="submit">Save deal</button>${button('Cancel', 'cancel-editor', 'class="crm-secondary"')}${deal.id ? button('Archive deal', 'archive-deal', `data-id="${esc(deal.id)}" data-version="${deal.version}" class="crm-text-button"`) : ''}<span data-crm-save-status role="status"></span></div></form>`;
    el.querySelector('input')?.focus();
  }
  function taskEditor(id, seed = {}) {
    const task = (detail.tasks || []).find(item => item.id === id) || seed;
    const el = document.querySelector('#crm-record-panel [data-crm-editor]');
    el.innerHTML = `<form data-crm-form="task" data-id="${esc(task.id || '')}" data-version="${task.version || ''}" class="crm-form crm-editor"><h3>${task.id ? 'Edit task' : 'New task / meeting'}</h3>${field('title', 'Title', 'text', task.title, true)}<label>Type<select name="kind">${options({ task: 'Task', meeting: 'Meeting' }, task.kind || 'task')}</select></label>${field('dueAt', 'Due date and time', 'datetime-local', task.dueAt)}${field('notes', 'Notes', 'textarea', task.notes)}<label>Status<select name="status">${options({ open: 'Open', completed: 'Completed' }, task.status || 'open')}</select></label><div class="crm-form-actions"><button type="submit">Save task</button>${button('Cancel', 'cancel-editor', 'class="crm-secondary"')}${task.id ? button('Archive task', 'archive-task', `data-id="${esc(task.id)}" data-version="${task.version}" class="crm-text-button"`) : ''}<span data-crm-save-status role="status"></span></div></form>`;
    el.querySelector('input')?.focus();
  }
  async function changed() {
    channel?.postMessage({ changed: true });
    await window.CRMBridge?.refreshStages?.();
    document.dispatchEvent(new CustomEvent('crm:updated', { detail: { ownerId: owner } }));
    refresh(true);
  }
  async function mutate(path, body, method = 'PATCH', form) {
    const visiblePanel = document.getElementById('crm-record-panel');
    const msg = form?.querySelector('[data-crm-save-status]') || (visiblePanel && !visiblePanel.hidden ? visiblePanel.querySelector('[data-crm-panel-status]') : root()?.querySelector('[data-crm-status]'));
    const controls = [...(form?.querySelectorAll('button') || [])];
    controls.forEach(control => { control.disabled = true; }); if (msg) msg.textContent = 'Saving…';
    const stamp = epoch, recordId = detail?.id;
    try {
      await request(path, { method, body: JSON.stringify(body) });
      if (stamp !== epoch) return;
      dirty = false; if (msg) msg.textContent = 'Saved.';
      await changed();
      if (recordId && detail?.id === recordId) await openRecord(recordId, true);
    } catch (error) {
      if (stamp === epoch && error.name !== 'AbortError' && msg) msg.textContent = error.status === 409 ? 'This record changed elsewhere. Reload the record, then apply your changes again.' : error.message;
    } finally { if (stamp === epoch) controls.forEach(control => { control.disabled = false; }); }
  }
  async function submit(event) {
    const form = event.target.closest('[data-crm-form]'); if (!form) return;
    event.preventDefault();
    const values = Object.fromEntries(new FormData(form)), kind = form.dataset.crmForm;
    if (kind === 'filters') {
      if (values.from && values.to && values.from > values.to) { status('Choose an end date on or after the start date.', true); return; }
      Object.assign(filters, values, { offset: 0 });
      if (activeView === 'overview' && values.search) { recordsTab = 'records'; route('pipeline'); }
      refresh(); return;
    }
    if (!detail) return;
    if (kind === 'profile') {
      const profile = {};
      fields.filter(([key]) => key !== 'additionalContacts').forEach(([key, , type]) => { profile[key] = type === 'checkbox' ? Boolean(values[key]) : type === 'number' ? values[key] === '' ? null : Number(values[key]) : values[key] || (type === 'date' ? null : ''); });
      profile.additionalContacts = [...form.querySelectorAll('[data-crm-contact]')].map(row => ({ ...JSON.parse(row.dataset.original), name: row.querySelector('[name="contactName"]').value, email: row.querySelector('[name="contactEmail"]').value, phone: row.querySelector('[name="contactPhone"]').value }));
      await mutate(`/records/${encodeURIComponent(detail.id)}`, { version: detail.version, stage: values.stage || detail.stage, profile }, 'PATCH', form);
    } else if (kind === 'deal' || kind === 'task') {
      const body = { ...values };
      if (kind === 'deal') {
        ['monthlyAmount', 'durationMonths', 'probability'].forEach(key => { body[key] = values[key] === '' ? null : Number(values[key]); });
        body.expectedCloseDate = values.expectedCloseDate || null;
        body.contractStartDate = values.contractStartDate || null; body.contractEndDate = values.contractEndDate || null;
        if (body.contractStartDate && body.contractEndDate && body.contractStartDate > body.contractEndDate) { form.querySelector('[data-crm-save-status]').textContent = 'Contract end cannot be before its start.'; return; }
        if (body.durationMonths != null && (!Number.isInteger(body.durationMonths) || body.durationMonths < 1)) { form.querySelector('[data-crm-save-status]').textContent = 'Duration must be a positive whole number of months.'; return; }
      } else body.dueAt = values.dueAt ? new Date(values.dueAt).toISOString() : null;
      const id = form.dataset.id;
      if (id) body.version = Number(form.dataset.version); else body.recordId = detail.id;
      await mutate(`/${kind}s${id ? `/${encodeURIComponent(id)}` : ''}`, body, id ? 'PATCH' : 'POST', form);
    } else if (kind === 'activity') {
      if (!values.note?.trim() || values.kind === 'conversation' && !values.outcome?.trim()) { form.querySelector('[data-crm-save-status]').textContent = 'Enter a note and a conversation outcome.'; return; }
      await mutate(`/records/${encodeURIComponent(detail.id)}/activities`, { ...values, idempotencyKey: crypto.randomUUID() }, 'POST', form);
    } else if (kind === 'edit-activity') await mutate(`/activities/${encodeURIComponent(form.dataset.id)}`, { version: Number(form.dataset.version), note: values.note }, 'PATCH', form);
  }
  async function action(event) {
    const control = event.target.closest('[data-crm-action]'); if (!control || control.disabled) return;
    const act = control.dataset.crmAction, data = control.dataset;
    if (act === 'refresh') { window.CRMBridge?.invalidate?.(); return refresh(); }
    if (act === 'report-period') {
      const days = Number(data.days); setReportPeriod(days);
      root()?.replaceChildren(); pageShell(); return refresh();
    }
    if (act === 'report-export' && pageData?.reports) {
      const url = URL.createObjectURL(new Blob([window.CRMInsights.csv(pageData.reports)], { type: 'text/csv;charset=utf-8' }));
      const anchor = document.createElement('a'); anchor.href = url; anchor.download = `Rudra24-CRM-${pageData.reports.period.from}-${pageData.reports.period.to}.csv`;
      document.body.append(anchor); anchor.click(); anchor.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000); return;
    }
    if (act === 'report-table-page' && pageData?.reports) {
      const table = control.closest('[data-report-table]');
      table.querySelector('[data-report-table-body]').innerHTML = window.CRMInsights.table(pageData.reports, table.dataset.reportTable, table.dataset.valueKey, Number(data.offset));
      table.querySelector('[data-report-table-body] button:not(:disabled)')?.focus(); return;
    }
    if (act === 'report-drill' || act === 'report-stage') {
      event.preventDefault();
      filters = { search: '', stage: data.stage || '', view: '', from: data.from || '', to: data.to || '', offset: 0, timezone: act === 'report-drill' ? 'Asia/Kolkata' : 'UTC' };
      recordsTab = data.kind === 'wins' ? 'deals' : 'records';
      if (recordsTab === 'deals') filters.dealStage = 'won';
      return route('pipeline');
    }
    if (act === 'report-outreach') {
      filters = { search: '', stage: '', view: '', from: pageData.reports.period.from, to: pageData.reports.period.to, timezone: 'Asia/Kolkata', offset: 0, kind: 'outreach', channel: data.channel, outcome: data.outcome };
      activityTab = 'activities'; return route('activity');
    }
    if (act === 'renewal-filter') { filters.renewal = data.renewal; filters.offset = 0; return refresh(); }
    if (act === 'renewal-task') {
      await openRecord(data.id); if (!detail || detail.id !== data.id) return;
      const deal = detail.deals.find(d => d.id === data.deal); if (!deal) return;
      panelTab = 'tasks'; renderPanel();
      let dueAt = '';
      if (deal.contractEndDate) {
        const due = new Date(deal.contractEndDate); due.setUTCDate(due.getUTCDate() - 30);
        const today = new Date(Date.now() + 19800000).toISOString().slice(0, 10);
        dueAt = (due.toISOString().slice(0, 10) < today ? today : due.toISOString().slice(0, 10)) + 'T09:00:00';
      }
      taskEditor('', { title: ('Review renewal: ' + deal.name).slice(0, 200), kind: 'task', dueAt, notes: `Review the ${deal.name} contract with the client. ${deal.contractEndDate ? 'Recorded end: ' + deal.contractEndDate.slice(0, 10) : 'Confirm the missing contract dates.'}`, status: 'open' });
      dirty = true; return;
    }
    if (act === 'route') return route(data.route);
    if (act === 'record') return openRecord(data.id);
    if (act === 'close') return closePanel();
    if (act === 'reload-record' && detail) { if (dirty && !window.confirm('Discard your unsaved changes and reload this record?')) return; return openRecord(detail.id, true); }
    if (act === 'add-contact') {
      const host = document.querySelector('#crm-record-panel [data-crm-contacts]');
      if (host.children.length >= 100) return;
      host.insertAdjacentHTML('beforeend', contactFields({}, host.children.length)); host.lastElementChild.querySelector('input').focus(); dirty = true; return;
    }
    if (act === 'remove-contact') { control.closest('[data-crm-contact]').remove(); dirty = true; return; }
    if (act === 'clear') { if (activeView === 'reports') { setReportPeriod(); root().replaceChildren(); pageShell(); return refresh(); } filters = { search: '', stage: '', view: 'leads', from: '', to: '', offset: 0 }; root().replaceChildren(); pageShell(); return refresh(); }
    if (act === 'previous' || act === 'next') { filters.offset = Math.max(0, filters.offset + (act === 'next' ? 50 : -50)); return refresh(); }
    if (act === 'records-tab') { recordsTab = data.tab; filters.offset = 0; return refresh(); }
    if (act === 'task-calendar') { calendarMode = !calendarMode; activityTab = 'tasks'; render(); return; }
    if (act === 'activity-tab' || act === 'all-activity') { activityTab = data.tab || 'activities'; filters.offset = 0; filters.kind = filters.status = filters.channel = filters.outcome = filters.confirmed = filters.uniqueRecipients = ''; return refresh(); }
    if (act === 'panel-tab') {
      if (dirty && !window.confirm('Discard unsaved changes in this record?')) return;
      panelTab = data.tab; dirty = false; renderPanel(); document.getElementById(`crm-tab-${panelTab}`)?.focus(); return;
    }
    if (act === 'stage' || act === 'day-records' || act === 'metric' && ['leads', 'clients', 'deals', 'won'].includes(data.target)) {
      filters.offset = 0; filters.stage = act === 'stage' ? data.stage : ''; filters.view = data.target === 'clients' ? 'clients' : ['stage', 'day-records'].includes(act) ? '' : 'leads';
      filters.kind = filters.outcome = filters.channel = filters.status = filters.confirmed = filters.uniqueRecipients = '';
      recordsTab = ['deals', 'won'].includes(data.target) ? 'deals' : 'records'; filters.dealStage = data.target === 'won' ? 'won' : data.target === 'deals' ? 'open' : '';
      if (data.date) filters.from = filters.to = data.date;
      route('pipeline'); root()?.replaceChildren(); pageShell(); return refresh();
    }
    if (act === 'metric' || act === 'outreach' || act === 'day-activity') {
      activityTab = data.target === 'tasks' ? 'tasks' : 'activities'; filters.offset = 0;
      filters.kind = data.target === 'conversations' ? 'conversation' : act === 'outreach' || ['sent', 'recipients'].includes(data.target) ? 'outreach' : ''; filters.outcome = data.outcome || ''; filters.channel = data.channel || '';
      filters.confirmed = ['conversations', 'sent', 'recipients'].includes(data.target) ? true : '';
      filters.uniqueRecipients = data.target === 'recipients' ? true : '';
      filters.status = data.target === 'tasks' ? 'open' : ''; if (data.date) filters.from = filters.to = data.date;
      route('activity'); root()?.replaceChildren(); pageShell(); return refresh();
    }
    if (act === 'new-deal' || act === 'edit-deal') return dealEditor(data.id);
    if (act === 'new-task' || act === 'edit-task') return taskEditor(data.id);
    if (act === 'cancel-editor') { document.querySelector('#crm-record-panel [data-crm-editor]')?.replaceChildren(); dirty = false; return; }
    if (act === 'task-status') { control.disabled = true; try { await mutate(`/tasks/${encodeURIComponent(data.id)}`, { version: Number(data.version), status: data.status }); } finally { control.disabled = false; } return; }
    if (act === 'archive-deal' || act === 'archive-task') return mutate(`/${act === 'archive-deal' ? 'deals' : 'tasks'}/${encodeURIComponent(data.id)}`, { version: Number(data.version), archived: true });
    if (act === 'edit-activity') {
      const item = (detail?.activities || pageData?.activities?.activities || pageData?.overview?.recentActivity || []).find(entry => entry.id === data.id);
      if (!item) return;
      if (!detail && item.recordId) { await openRecord(item.recordId); panelTab = 'activity'; renderPanel(); }
      const target = document.querySelector('#crm-record-panel [data-crm-panel-body]'); if (!target) return;
      const editor = document.createElement('form'); editor.dataset.crmForm = 'edit-activity'; editor.dataset.id = item.id; editor.dataset.version = item.version; editor.className = 'crm-form crm-editor';
      editor.innerHTML = `<h3>Edit activity note</h3>${field('note', 'Note', 'textarea', item.note, true)}<p class="crm-muted">Earlier wording remains in the audit history.</p><button type="submit">Save note</button><span data-crm-save-status role="status"></span>`;
      target.prepend(editor); editor.querySelector('textarea').focus(); return;
    }
    if (act === 'channel' && detail) {
      const record = detail;
      if (window.CRMBridge?.openChannel) { closePanel(true); return window.CRMBridge.openChannel(data.channel, record); }
      if (data.channel === 'email' && window.EmailCtrl?.setLeadAudience) { closePanel(true); window.showView?.('email'); window.EmailCtrl.setLeadAudience([{ ...record.profile, id: record.id, crmRecordId: record.id }]); }
      else document.querySelector('[data-crm-panel-status]').textContent = 'This channel is not ready. Open it from the main navigation.';
    }
  }
  function keyboard(event) {
    const layer = document.getElementById('crm-record-panel');
    if (!layer || layer.hidden || !layer.classList.contains('is-open')) return;
    if (event.key === 'Escape') { event.preventDefault(); closePanel(); return; }
    if (event.target.getAttribute('role') === 'tab' && ['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) {
      event.preventDefault(); const tabs = [...layer.querySelectorAll('[role="tab"]')], index = tabs.indexOf(event.target);
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : (index + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
      tabs[next].click(); return;
    }
    if (event.key === 'Tab') {
      const focusable = [...layer.querySelectorAll('button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex="0"]')].filter(el => el.offsetParent !== null && el.tabIndex >= 0);
      const first = focusable[0], last = focusable[focusable.length - 1];
      if (event.shiftKey && (document.activeElement === first || document.activeElement === layer.querySelector('.crm-panel'))) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    }
  }
  function bind() {
    if (initialized) return; initialized = true;
    document.addEventListener('click', action); document.addEventListener('submit', submit);
    const chartHint = event => {
      const point = event.target.closest?.('.crm-trend-svg a');
      if (!point || activeView !== 'reports') return;
      const output = point.closest('.crm-trend').querySelector('.crm-chart-tooltip');
      output.textContent = point.getAttribute('aria-label').replace('. Open matching entries.', '');
    };
    document.addEventListener('pointerover', chartHint, { passive: true });
    document.addEventListener('focusin', chartHint);
    document.addEventListener('toggle', event => { const table = event.target; if (activeView === 'reports' && table.matches?.('[data-report-table]') && table.open && pageData?.reports) table.querySelector('[data-report-table-body]').innerHTML = window.CRMInsights.table(pageData.reports, table.dataset.reportTable, table.dataset.valueKey); }, true);
    document.addEventListener('input', event => { if (event.target.closest('#crm-record-panel form')) dirty = true; });
    document.addEventListener('change', event => { if (event.target.dataset.crmFilter) { filters[event.target.dataset.crmFilter] = event.target.value; filters.offset = 0; refresh(); } });
    document.addEventListener('keydown', event => { window.CRMCtrl.pointerInput = false; keyboard(event); });
    document.addEventListener('pointerdown', () => { window.CRMCtrl.pointerInput = true; }, { passive: true });
    document.addEventListener('visibilitychange', () => { if (!document.hidden && activeView) refresh(true); });
    window.addEventListener('focus', () => { if (activeView && !document.hidden) refresh(true); });
    window.addEventListener('online', () => { if (activeView && !document.hidden) refresh(true); });
    window.addEventListener('rudra:auth-state', onAccountChange);
    window.addEventListener('clavis:workspace-change', () => {
      if (activeView && !root()?.classList.contains('active')) dispose();
    });
  }
  function setReportPeriod(days = 30) {
    filters.to = new Date(Date.now() + 19800000).toISOString().slice(0, 10);
    filters.from = new Date(Date.parse(filters.to + 'T00:00:00Z') - (days - 1) * 86400000).toISOString().slice(0, 10); filters.offset = 0;
  }
  async function init(view = 'overview') {
    ensureRoots(); bind();
    view = String(view).replace(/^crm-/, ''); if (!['overview', 'pipeline', 'activity', 'reports', 'clients'].includes(view)) view = 'overview';
    if (owner !== currentOwner()) resetOwner();
    if (activeView !== view) { pageData = null; document.getElementById(`view-crm-${view}`)?.replaceChildren(); }
    if (view === 'reports' && !filters.from && !filters.to) setReportPeriod();
    activeView = view; pageShell(); clearInterval(timer);
    timer = setInterval(() => { if (!document.hidden && root()?.classList.contains('active')) refresh(true); }, 15000);
    await refresh();
  }
  function dispose() { clearInterval(timer); timer = null; activeView = ''; closePanel(true); loadSerial++; }
  function onAccountChange() { const view = activeView; resetOwner(); if (view) { activeView = view; pageShell(); refresh(); } }
  ensureRoots();
  return { businessQueueChanged: () => { filters.offset = 0; refresh(); }, init, refresh, dispose, onAccountChange, openRecord, syncLegacy: () => window.CRMBridge?.ensureBootstrap?.(), pointerInput: false };
})();
