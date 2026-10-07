/* Product insights: signed-in telemetry, private dashboard and bug reporting. */
(() => {
  'use strict';
  const backend = (window.SKYLARK_CONFIG?.BACKEND_URL || 'http://localhost:8000').replace(/\/+$/, '');
  const apiBase = location.port === '8000' && /^https?:$/.test(location.protocol) ? '' : backend;
  const el = id => document.getElementById(id);
  const uuid = () => crypto.randomUUID();
  const sessionId = uuid();
  const deviceKey = 'clavis_product_device_id';
  let deviceId;
  try { deviceId = localStorage.getItem(deviceKey); if (!deviceId) localStorage.setItem(deviceKey, deviceId = uuid()); }
  catch (_) { deviceId = uuid(); }
  let lastToken = '';
  let developer = false;
  let lastHeartbeat = 0;
  let errorCount = 0;
  const page = () => (location.hash || '#dashboard').slice(0, 80);
  const time = n => new Date(n * 1000).toLocaleString();
  const label = () => {
    const mobile = /Android|iPhone|iPad/i.test(navigator.userAgent);
    return `${mobile ? 'Mobile' : 'Desktop'} · ${navigator.platform || 'Browser'}`.slice(0, 80);
  };
  const platform = () => /Android/i.test(navigator.userAgent) ? 'Android' : /iPhone|iPad/i.test(navigator.userAgent) ? 'iOS' : /Win/i.test(navigator.platform) ? 'Windows' : /Mac/i.test(navigator.platform) ? 'macOS' : /Linux/i.test(navigator.platform) ? 'Linux' : 'Browser';
  const region = () => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone.slice(0, 80) || 'Unknown'; } catch (_) { return 'Unknown'; } };

  async function request(path, options = {}) {
    const token = window.SupabaseAuth?.getAccessToken?.();
    if (!token) throw new Error('Sign in with Google to use this feature.');
    const response = await fetch(`${apiBase}/api/insights${path}`, {
      ...options, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(options.headers || {}) }
    });
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      throw new Error(body.detail || `Request failed (${response.status})`);
    }
    return response.json();
  }

  async function syncAuth() {
    const token = window.SupabaseAuth?.getAccessToken?.() || '';
    if (token !== lastToken) {
      lastToken = token;
      developer = false;
      el('developer-nav').hidden = true;
      if (token) {
        try { developer = !!(await request('/me')).developer; } catch (_) { /* backend may be offline */ }
      }
      el('developer-nav').hidden = !developer;
      if (location.hash === '#developer') loadDashboard();
    }
    if (token && !document.hidden && Date.now() - lastHeartbeat > 30000) {
      lastHeartbeat = Date.now();
      request('/heartbeat', { method: 'POST', body: JSON.stringify({ session_id: sessionId, device_id: deviceId,
        device_label: label(), platform: platform(), region: region(), active: true }) }).catch(() => {});
    }
  }

  function node(tag, cls, content) {
    const item = document.createElement(tag);
    if (cls) item.className = cls;
    if (content !== undefined) item.textContent = String(content);
    return item;
  }
  function empty(target, message) { target.replaceChildren(node('p', 'di-empty', message)); }
  function metric(name, value, note) {
    const item = node('div', 'di-metric');
    item.append(node('span', 'di-metric-label', name), node('strong', '', value), node('small', '', note));
    return item;
  }
  function render(data) {
    const m = data.metrics;
    el('di-metrics').replaceChildren(
      metric('Lifetime users', m.users_lifetime, 'Verified accounts seen'),
      metric('First seen today', m.first_seen_today, 'Signup proxy'),
      metric('Signed in today', m.signed_in_today, `${m.sessions_today} app opens`),
      metric('Active now', m.active_users, `${m.active_devices} devices · last 2 min`),
      metric('Usage time', `${m.usage_hours}h`, 'Visible app time'),
      metric('Open reports', m.open_bugs, `${m.errors_week} errors this week`)
    );
    const activity = el('di-activity'); activity.replaceChildren();
    const map = new Map(data.daily_sessions.map(x => [x.date, x.count]));
    const max = Math.max(1, ...data.daily_sessions.map(x => x.count));
    for (let i = 29; i >= 0; i--) {
      const date = new Date(); date.setDate(date.getDate() - i);
      const key = `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
      const count = map.get(key) || 0;
      const cell = node('span', 'di-cell');
      cell.style.opacity = String(0.18 + count / max * 0.82);
      cell.title = `${key}: ${count} sessions`;
      cell.setAttribute('aria-label', cell.title);
      activity.append(cell);
    }
    const hours = el('di-hours'); hours.replaceChildren();
    const hourMap = new Map(data.peak_hours_local.map(x => [x.hour, x.count]));
    const hourMax = Math.max(1, ...data.peak_hours_local.map(x => x.count));
    for (let h = 0; h < 24; h++) {
      const count = hourMap.get(h) || 0;
      const row = node('div', 'di-bar-row');
      const fill = node('span', 'di-bar-fill'); fill.style.width = `${count / hourMax * 100}%`;
      row.append(node('span', '', `${String(h).padStart(2, '0')}:00`), fill, node('span', '', count));
      hours.append(row);
    }
    const regions = el('di-regions'); regions.replaceChildren();
    const regionEntries = Object.entries(data.active_regions).sort((a,b) => b[1]-a[1]);
    if (!regionEntries.length) empty(regions, 'No active regions right now.');
    for (const [name, count] of regionEntries) regions.append(row(name, `${count} active`));
    const devices = el('di-devices'); devices.replaceChildren();
    if (!data.devices.length) empty(devices, 'Devices will appear after verified sessions start.');
    for (const d of data.devices) devices.append(row(d.label, `${d.user} · ${d.region} · ${d.active ? 'Active' : time(d.last_seen_at)}`));
    const bugs = el('di-bugs'); bugs.replaceChildren();
    if (!data.bugs.length) empty(bugs, 'No bug reports yet.');
    for (const b of data.bugs) {
      const item = node('article', 'di-bug');
      const top = node('div', 'di-bug-top');
      const title = node('strong', '', b.title);
      const select = node('select', 'di-select'); select.setAttribute('aria-label', `Status for ${b.title}`);
      [['open','Open'], ['in_progress','In progress'], ['resolved','Resolved']].forEach(([value, caption]) => {
        const option = node('option', '', caption); option.value = value; select.append(option);
      });
      select.value = b.status;
      select.addEventListener('change', async () => {
        select.disabled = true;
        try { await request(`/bugs/${encodeURIComponent(b.id)}`, { method: 'PATCH', body: JSON.stringify({ status: select.value }) }); }
        catch (error) { select.value = b.status; alert(error.message); }
        finally { select.disabled = false; }
      });
      top.append(title, select);
      item.append(top, node('p', '', b.description));
      if (b.steps) item.append(node('p', 'di-steps', `Steps: ${b.steps}`));
      item.append(node('small', '', `${b.email} · ${b.page} · ${time(b.created_at)}`));
      bugs.append(item);
    }
    const errors = el('di-errors'); errors.replaceChildren();
    if (!data.errors.length) empty(errors, 'No captured errors in the last 7 days.');
    for (const e of data.errors) errors.append(row(`${e.kind}: ${e.message}`, `${e.page} · ${time(e.created_at)}`));
  }
  function row(a, b) { const item = node('div', 'di-row'); item.append(node('span', '', a), node('small', '', b)); return item; }

  async function loadDashboard() {
    if (location.hash !== '#developer') return;
    const state = el('di-state'); state.hidden = false;
    el('di-content').hidden = true;
    if (!window.SupabaseAuth?.getAccessToken?.()) {
      state.replaceChildren(node('span', '', 'Sign in with Google to open your developer workspace.'));
      const button = node('button', 'di-button', 'Developer login');
      button.addEventListener('click', async () => {
        const result = await window.SupabaseAuth.signInWithGoogle();
        if (!result?.success) state.textContent = result?.error || 'Login could not start.';
      });
      state.append(button); return;
    }
    state.textContent = 'Loading product activity…';
    try { const data = await request('/dashboard'); developer = true; el('developer-nav').hidden = false;
      render(data); state.hidden = true; el('di-content').hidden = false;
    } catch (error) { state.textContent = error.message === 'Developer access required' ? 'This verified account does not have developer access.' : error.message; }
  }

  function ensureDialog() {
    if (el('di-report-overlay')) return;
    const overlay = node('div', 'di-overlay'); overlay.id = 'di-report-overlay'; overlay.hidden = true;
    overlay.innerHTML = `<div class="di-dialog" role="dialog" aria-modal="true" aria-labelledby="di-report-title">
      <div class="di-dialog-head"><div><p class="di-eyebrow">HELP US IMPROVE</p><h2 id="di-report-title">Report a bug</h2></div><button type="button" class="di-close" aria-label="Close">×</button></div>
      <p class="di-dialog-copy">Tell us what happened. Please don't include passwords or API keys.</p>
      <form id="di-report-form"><label>Short title<input name="title" required minlength="5" maxlength="120" placeholder="What went wrong?"></label>
      <label>What happened?<textarea name="description" required minlength="15" maxlength="4000" rows="5" placeholder="Describe the problem and what you expected"></textarea></label>
      <label>Steps to reproduce <span>(optional)</span><textarea name="steps" maxlength="2000" rows="3" placeholder="1. Open…  2. Click…"></textarea></label>
      <div class="di-dialog-actions"><span id="di-report-status" role="status"></span><button type="submit" class="di-button di-primary">Send report</button></div></form></div>`;
    document.body.append(overlay);
    const close = () => { overlay.hidden = true; document.body.classList.remove('di-modal-open'); };
    overlay.querySelector('.di-close').addEventListener('click', close);
    overlay.addEventListener('click', e => { if (e.target === overlay) close(); });
    document.addEventListener('keydown', e => { if (e.key === 'Escape' && !overlay.hidden) close(); });
    el('di-report-form').addEventListener('submit', async e => {
      e.preventDefault();
      const form = e.currentTarget, button = form.querySelector('[type=submit]'), status = el('di-report-status');
      const values = Object.fromEntries(new FormData(form)); values.page = page();
      button.disabled = true; status.textContent = 'Sending…';
      try { await request('/bugs', { method: 'POST', body: JSON.stringify(values) });
        form.reset(); status.textContent = 'Report received. Thank you.';
        if (developer && location.hash === '#developer') loadDashboard();
      } catch (error) { status.textContent = error.message; }
      finally { button.disabled = false; }
    });
  }

  function openReport() { ensureDialog(); const overlay = el('di-report-overlay'); overlay.hidden = false;
    document.body.classList.add('di-modal-open');
    const status = el('di-report-status'); status.replaceChildren();
    if (!window.SupabaseAuth?.getAccessToken?.()) {
      status.append(node('span', '', 'Sign in to send a report. '));
      const login = node('button', 'di-inline-login', 'Sign in with Google');
      login.type = 'button';
      login.addEventListener('click', async () => {
        const result = await window.SupabaseAuth.signInWithGoogle();
        if (!result?.success) status.textContent = result?.error || 'Login could not start.';
      });
      status.append(login);
    }
    overlay.querySelector('input').focus(); }

  window.ProductInsights = { openReport, loadDashboard };
  document.addEventListener('DOMContentLoaded', () => {
    ensureDialog();
    el('di-refresh')?.addEventListener('click', loadDashboard);
    window.addEventListener('hashchange', () => { if (location.hash === '#developer') loadDashboard(); });
    setInterval(syncAuth, 10000); syncAuth();
    if (location.hash === '#developer') loadDashboard();
    window.addEventListener('error', e => {
      if (!window.SupabaseAuth?.getAccessToken?.() || ++errorCount > 10) return;
      request('/errors', { method: 'POST', body: JSON.stringify({kind:'javascript', message:e.error?.name || 'Script error', page:page()}) }).catch(() => {});
    });
    window.addEventListener('unhandledrejection', e => {
      if (!window.SupabaseAuth?.getAccessToken?.() || ++errorCount > 10) return;
      request('/errors', { method:'POST', body:JSON.stringify({kind:'promise', message:e.reason?.name || 'Rejected promise', page:page()}) }).catch(() => {});
    });
  });
})();
