/* Owner control uses existing Supabase login and never receives provider secrets. */
(() => {
  'use strict';
  let revision = 0, abort = null, offset = 0, query = '', selected = null, root;
  const recordingURLs = new Set();
  function clearRecordings(){for(const url of recordingURLs)URL.revokeObjectURL(url);recordingURLs.clear();}
  const token = () => window.SupabaseAuth?.getAccessToken?.() || '';
  const base = () => (window.SKYLARK_CONFIG?.BACKEND_URL || '').replace(/\/+$/, '');
  const el = (tag, text, cls) => { const n = document.createElement(tag); if (text !== undefined) n.textContent = String(text); if (cls) n.className = cls; return n; };
  function button(text, action) { const n = el('button', text, 'di-button'); n.type = 'button'; n.addEventListener('click', () => action().catch(showError)); return n; }
  function field(label, value = '', type = 'text') { const wrap = el('label', undefined, 'dc-field'); wrap.append(el('span', label)); const input = el('input'); input.type = type; input.value = value ?? ''; wrap.append(input); return {wrap, input}; }
  function select(label, values, value) { const wrap = el('label', undefined, 'dc-field'); wrap.append(el('span', label)); const input = el('select'); values.forEach(v => { const option = el('option', v); option.value = v; input.append(option); }); input.value = value; wrap.append(input); return {wrap, input}; }
  function showError(error) { if(error?.name==='AbortError')return; const box = root?.querySelector('[role=status]'); if (box) box.textContent = error?.message || 'Request failed'; }
  async function api(path, method = 'GET', body) {
    const identity = token(), generation = revision;
    if (!identity) throw new Error('Sign in with Google first.');
    const response = await fetch(base() + '/api/control' + path, { method, headers: {Authorization: 'Bearer ' + identity, 'Content-Type': 'application/json'}, body: body === undefined ? undefined : JSON.stringify(body), signal: abort?.signal });
    const result = await response.json().catch(() => ({}));
    if (generation !== revision || identity !== token()) throw new DOMException('Account changed', 'AbortError');
    if (!response.ok) throw new Error(typeof result.detail === 'string' ? result.detail : `Request failed (${response.status})`);
    return result;
  }
  function section(title) { const n = el('section', undefined, 'di-panel dc-section'); n.append(el('h2', title)); return n; }
  function details(label, data) { const n = el('details'); n.append(el('summary', label), el('pre', JSON.stringify(data, null, 2))); return n; }
  function mount() {
    if (root) return;
    const shell = document.querySelector('#view-developer .di-shell') || document.querySelector('.di-shell');
    if (!shell) return;
    root = el('section', undefined, 'dc-root'); root.id = 'developer-control';
    const head = el('div', undefined, 'dc-toolbar'); head.append(el('h2', 'Developer control'));
    head.append(button('Users', users), button('Shared providers', providers), button('Releases', releases));
    const state = el('p', '', 'dc-status'); state.setAttribute('role', 'status');
    const body = el('div'); body.id = 'dc-body'; root.append(head, state, body); shell.append(root);
  }
  const body = () => root.querySelector('#dc-body');
  async function users() {
    clearRecordings();selected = null; const data = await api(`/users?q=${encodeURIComponent(query)}&offset=${offset}`); const box = body(); box.replaceChildren();
    const search = field('Search email or name', query, 'search'); let timer;
    search.input.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(() => { query = search.input.value; offset = 0; users().catch(showError); }, 250); });
    box.append(search.wrap, el('p', `${data.total} accounts · showing ${data.offset + (data.items.length ? 1 : 0)}–${data.offset + data.items.length}`));
    for (const user of data.items) { const row = el('div', undefined, 'dc-user'); row.append(el('span', `${user.name} · ${user.email}`), el('small', user.status), button('Open workspace', () => workspace(user.id))); box.append(row); }
    const nav = el('div', undefined, 'dc-toolbar'); if (offset > 0) nav.append(button('Previous', async () => { offset = Math.max(0, offset - 30); await users(); })); if (offset + data.items.length < data.total) nav.append(button('Next', async () => { offset += 30; await users(); })); box.append(nav);
  }
  async function workspace(uid) {
    clearRecordings();selected = uid; const data = await api('/users/' + encodeURIComponent(uid)); if (selected !== uid) return;
    const box = body(); box.replaceChildren(el('h3', `${data.name} · ${data.email}`), el('p', [data.company, data.phone].filter(Boolean).join(' · ')));
    box.append(el('p', data.sync ? `Last reported sync: ${data.sync.state} · ${new Date(data.sync.reported_at*1000).toLocaleString()}` : 'Sync state has not been reported by this device yet.'));
    const account = section('Access & subscription'); account.append(el('p', `${data.subscription.plan_label} · ${data.subscription.active ? 'Paid access active' : 'No active paid subscription'}`));
    const status = select('Access', ['pending', 'trial', 'active', 'blocked'], data.status);
    const expiry = field('Manual access expiry', data.expires_at ? new Date(data.expires_at*1000-new Date(data.expires_at*1000).getTimezoneOffset()*60000).toISOString().slice(0,16) : '', 'datetime-local');
    const note = field('Internal note', data.note); const grid = el('div', undefined, 'dc-grid'); grid.append(status.wrap, expiry.wrap, note.wrap);
    const caps = {}, monthly = {}, features = {};
    const meterLabels = {tts_characters: 'Speech output characters', voice_seconds: 'Uploaded audio seconds (rounded up)', voice_sessions: 'Realtime session tokens'};
    for (const [meter, value] of Object.entries(data.limits.meters)) { const label = meterLabels[meter] || meter; caps[meter] = field(`${label} per day`, value.limit, 'number'); caps[meter].input.min = 0; grid.append(caps[meter].wrap); monthly[meter] = field(`${label} per month (blank = no extra cap)`, data.monthly_limits[meter] ?? '', 'number'); monthly[meter].input.min = 0; grid.append(monthly[meter].wrap); }
    const flags = el('div', undefined, 'dc-toolbar'); for (const [name, enabled] of Object.entries(data.features)) { const f = field(name, '', 'checkbox'); f.input.checked = enabled; features[name] = f; flags.append(f.wrap); }
    account.append(grid, flags, button('Save access & limits', async () => { const daily_limits = {}, monthly_limits = {}, enabled = {}; for (const k of Object.keys(caps)) { daily_limits[k] = Number(caps[k].input.value); if (monthly[k].input.value !== '') monthly_limits[k] = Number(monthly[k].input.value); } for (const k of Object.keys(features)) enabled[k] = features[k].input.checked; await api('/users/' + uid, 'PATCH', {status: status.input.value, expires_at: expiry.input.value ? new Date(expiry.input.value).getTime()/1000 : 0, daily_limits, monthly_limits, features: enabled, note: note.input.value}); await workspace(uid); }), button('Revoke signed-in sessions', async () => { await api('/users/' + uid + '/revoke', 'POST'); showError({message: 'Sessions revoked. The user must sign in again.'}); }));
    account.append(el('p', 'Speech character and uploaded-audio limits apply before provider requests. Realtime limits count issued tokens or preview sessions; already-issued vendor sessions have no app-enforced duration ceiling. Unknown provider outcomes retain their reservation; confirmed rejections are refunded.'));
    box.append(account);
    const setup = section('Remote provider setup');
    for (const provider of data.providers) { const row = el('div', undefined, 'dc-provider'); const mode = select(provider.provider, ['disabled', 'shared', 'individual'], provider.mode); const key = field('New individual key (optional)', '', 'password'); key.input.autocomplete = 'new-password'; row.append(mode.wrap, key.wrap, el('small', provider.configured ? 'Configured' : 'Not configured'), button('Save', async () => { const value = {mode: mode.input.value}; if (mode.input.value === 'individual' && key.input.value.trim()) value.secret = key.input.value.trim(); await api(`/users/${uid}/providers/${provider.provider}`, 'PUT', value); key.input.value = ''; await workspace(uid); })); setup.append(row); }
    box.append(setup, details('Devices', data.devices));
    const views = section('Activity, usage & synced app data');
    views.append(el('p', data.disclosure.accepted ? 'User acknowledged owner app-data visibility.' : 'App content unlocks after the user acknowledges the disclosure.'));
    const tabs = el('div', undefined, 'dc-toolbar'), records = el('div');
    for (const tab of ['usage', 'audit', 'leads', 'candidates', 'jarvis_messages', 'jarvis_facts', 'jarvis_tasks', 'calls']) tabs.append(button(tab.replaceAll('_',' '), () => loadRecords(uid, tab, records)));
    views.append(tabs, records); box.append(views);
  }
  async function loadRecords(uid, tab, target, page = 0) {
    clearRecordings();const path = ['usage','audit','calls'].includes(tab) ? tab : 'content/' + tab;
    const data = await api(`/users/${uid}/${path}?offset=${page}&limit=30`); if (selected !== uid) return;
    target.replaceChildren(el('p', `${data.total ?? data.items.length} records${data.synced_at ? ' · synced ' + data.synced_at : ''}`));
    data.items.forEach((item, i) => { target.append(details(item.action || item.name || item.company || item.meter || item.role || `Record ${page + i + 1}`, item)); if (tab === 'calls' && item.kind === 'conversation') { target.append(button('Transcript', async () => { const r = await api(`/users/${uid}/calls/${encodeURIComponent(item.id)}`); target.append(details('Call transcript', r)); })); const audio = el('audio'); audio.controls = true; audio.preload = 'none'; target.append(button('Load recording', async () => { const response = await fetch(base() + `/api/control/users/${uid}/calls/${encodeURIComponent(item.id)}/audio`, {headers:{Authorization:'Bearer '+token()}}); if (!response.ok) throw new Error('Recording unavailable'); const url = URL.createObjectURL(await response.blob());recordingURLs.add(url);audio.src = url; audio.addEventListener('emptied', () => URL.revokeObjectURL(url), {once:true}); target.append(audio); })); } });
    if (page > 0) target.append(button('Previous', () => loadRecords(uid, tab, target, Math.max(0,page-30)))); if (page + data.items.length < data.total) target.append(button('Next', () => loadRecords(uid, tab, target, page+30)));
  }
  async function providers() {
    clearRecordings();selected = null; const data = await api('/providers'), box = body(); box.replaceChildren(el('h3', 'Shared provider vault'), el('p', 'Keys stay encrypted on the server. Assign shared access separately for each user. Request ceilings are not a provider bill.'));
    for (const provider of data.items) { const panel = section(provider.provider); const key = field('Replace shared key (optional)', '', 'password'); key.input.autocomplete = 'new-password'; const spending = field('Monthly cost reservation ceiling INR (0 = request ceiling only)', provider.monthly_spend_inr, 'number');const perRequest = field('Conservative maximum INR per request', provider.max_request_cost_inr, 'number');const cap = field('Monthly request ceiling', provider.monthly_requests, 'number'); cap.input.min = 0; const enabled = field('Enable shared access', '', 'checkbox'); enabled.input.checked = provider.enabled; panel.append(el('p', `${provider.configured ? 'Configured' : 'Not configured'} · ${provider.used_requests} reserved requests · ${provider.month || 'No usage yet'}`), key.wrap, cap.wrap, spending.wrap, perRequest.wrap, enabled.wrap, button('Save provider', async () => { const payload = {enabled: enabled.input.checked, monthly_requests: Number(cap.input.value),monthly_spend_inr:Number(spending.input.value),max_request_cost_inr:Number(perRequest.input.value)}; if (key.input.value.trim()) payload.secret = key.input.value.trim(); await api('/providers/'+provider.provider, 'PUT', payload); key.input.value = ''; await providers(); })); box.append(panel); }
  }
  async function releases() {
    clearRecordings();selected = null; const data = await api('/releases'), box = body(); box.replaceChildren(el('h3', 'Controlled updates'), el('p', 'Publish a tested, signed artifact. Promote: owner/test → 5% → 25% → 100%. Native changes require an app release.'));
    const form = section('Register tested artifact'); const version = field('Version', '', 'text'); const platform = select('Platform', ['desktop-ui','web','windows','android'], 'desktop-ui'); const notes = field('Release notes'); const manifest = el('textarea'); manifest.rows = 6; manifest.placeholder = 'Signed manifest JSON: url, sha256, signature, tested, compatibility'; manifest.setAttribute('aria-label','Signed release manifest JSON'); form.append(version.wrap, platform.wrap, notes.wrap, manifest, button('Create draft', async () => { await api('/releases','POST',{version:version.input.value,platform:platform.input.value,notes:notes.input.value,manifest:JSON.parse(manifest.value)}); await releases(); })); box.append(form);
    data.items.forEach(release => { const card = section(`${release.version} · ${release.platform}`); card.append(el('p', `${release.status} · ${release.cohort}% · ${release.notes}`)); for (const action of ['publish','pause','promote','rollback']) card.append(button(action, async () => { await api(`/releases/${release.id}/action`,'POST',{action}); await releases(); })); box.append(card); });
  }
  async function activate() { clearRecordings();revision++; abort?.abort(); abort = new AbortController(); mount(); if (root && location.hash === '#developer') { try { await users(); showError({message:''}); root.hidden = false; } catch (e) { root.hidden = true; if (e.name !== 'AbortError') showError(e); } } else if (root) { root.hidden = true; body().replaceChildren(); } }
  window.addEventListener('hashchange',activate); window.addEventListener('rudra:account-changed',activate);
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded',activate,{once:true}); else activate();
  window.RudraDeveloperControl = {refresh:activate};
})();
