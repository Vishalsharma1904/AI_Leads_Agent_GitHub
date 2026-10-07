/* ============================================================
 *  ClavisOperator — the master console (operator only)
 * ------------------------------------------------------------
 *  Every company that uses the app, what it spent today, and the
 *  two dials that matter: leads/day and calls/day, plus a pause
 *  switch.
 *
 *  Nothing here is a client-side permission. The console asks the
 *  backend for the tenant list, and the backend answers 404 to
 *  anyone whose e-mail is not in CLAVIS_ADMIN_EMAILS on the
 *  server. Hiding this file, or the button, would protect
 *  nothing — so it is not pretending to. The server is the guard.
 *
 *  Open with:  ClavisOperator.open()   (Dev mode → Operator)
 *  or Ctrl/⌘ + Shift + O.
 * ============================================================ */
window.ClavisOperator = (() => {
  'use strict';

  const backend = () =>
    (location.port === '8000' ? '' : (window.SKYLARK_CONFIG?.BACKEND_URL || 'http://localhost:8000').replace(/\/+$/, ''));
  const token = () => { try { return window.SupabaseAuth?.getAccessToken?.() || ''; } catch (_) { return ''; } };

  let root = null;
  let rows = [];

  async function api(path, opts = {}) {
    const t = token();
    if (!t) throw new Error('Sign in as the operator account first.');
    const res = await fetch(backend() + path, {
      method: opts.method || 'GET',
      headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' },
      body: opts.body ? JSON.stringify(opts.body) : null,
    });
    const data = await res.json().catch(() => ({}));
    if (res.status === 404 && path.includes('/admin/')) {
      throw new Error('This account is not an operator. Add its e-mail to CLAVIS_ADMIN_EMAILS on the server.');
    }
    if (!res.ok) throw new Error(typeof data.detail === 'string' ? data.detail : `Request failed (${res.status})`);
    return data;
  }

  const esc = (v) => String(v ?? '').replace(/[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const ago = (ts) => {
    if (!ts) return 'never';
    const m = Math.round((Date.now() - ts * 1000) / 60000);
    if (m < 1) return 'now';
    if (m < 60) return `${m}m ago`;
    const h = Math.round(m / 60);
    return h < 48 ? `${h}h ago` : `${Math.round(h / 24)}d ago`;
  };

  function mount() {
    if (root && document.body.contains(root)) return root;
    root = document.createElement('div');
    root.id = 'op-root';
    root.hidden = true;
    root.innerHTML = `
      <div class="op-backdrop" data-close></div>
      <div class="op-sheet" role="dialog" aria-modal="true" aria-label="Operator console">
        <header class="op-head">
          <div>
            <h2>Operator console</h2>
            <p id="op-sub">Every company, what it used today.</p>
          </div>
          <div class="op-head-actions">
            <button type="button" class="op-btn" data-refresh>Refresh</button>
            <button type="button" class="op-btn op-x" data-close aria-label="Close">&#215;</button>
          </div>
        </header>
        <div class="op-body"><p class="op-msg" id="op-msg">Loading…</p><div id="op-list"></div></div>
      </div>`;
    root.querySelectorAll('[data-close]').forEach((n) => n.addEventListener('click', close));
    root.querySelector('[data-refresh]').addEventListener('click', load);
    document.body.appendChild(root);
    return root;
  }

  function msg(text, bad) {
    const el = document.getElementById('op-msg');
    if (!el) return;
    el.textContent = text || '';
    el.hidden = !text;
    el.dataset.error = String(!!bad);
  }

  function render() {
    const list = document.getElementById('op-list');
    if (!list) return;
    if (!rows.length) { list.innerHTML = '<p class="op-msg">No companies have signed in yet.</p>'; return; }

    list.innerHTML = rows.map((t, i) => {
      const bar = (m) => {
        const pct = m.limit ? Math.min(100, Math.round((m.used / m.limit) * 100)) : 0;
        return `<div class="op-meter" data-full="${pct >= 100}"><span style="width:${pct}%"></span></div>`;
      };
      return `
        <article class="op-card" data-i="${i}" ${t.blocked ? 'data-blocked="true"' : ''}>
          <div class="op-card-top">
            <strong>${esc(t.email || t.owner_user_id)}</strong>
            <span class="op-seen">${esc(ago(t.last_seen))}</span>
          </div>
          <div class="op-grid">
            <label>Leads / day
              <input type="number" min="0" max="100000" value="${esc(t.leads.limit)}" data-set="leads_per_day" />
            </label>
            <div class="op-use">
              <span>${esc(t.leads.used)} / ${esc(t.leads.limit)} today</span>
              ${bar(t.leads)}
              <span class="op-dim">${esc(t.leads.total)} lifetime</span>
            </div>
            <label>Calls / day
              <input type="number" min="0" max="100000" value="${esc(t.calls.limit)}" data-set="calls_per_day" />
            </label>
            <div class="op-use">
              <span>${esc(t.calls.used)} / ${esc(t.calls.limit)} today</span>
              ${bar(t.calls)}
              <span class="op-dim">${esc(t.calls.total)} lifetime</span>
            </div>
          </div>
          <div class="op-card-foot">
            <label class="op-check"><input type="checkbox" data-set="blocked" ${t.blocked ? 'checked' : ''} /> Pause this company</label>
            <button type="button" class="op-btn op-save">Save</button>
          </div>
        </article>`;
    }).join('');

    list.querySelectorAll('.op-card').forEach((card) => {
      card.querySelector('.op-save').addEventListener('click', () => save(card));
    });
  }

  async function save(card) {
    const tenant = rows[Number(card.dataset.i)];
    if (!tenant) return;
    const read = (name) => card.querySelector(`[data-set="${name}"]`);
    const patch = {
      leads_per_day: Number(read('leads_per_day').value) || 0,
      calls_per_day: Number(read('calls_per_day').value) || 0,
      blocked: read('blocked').checked,
    };
    const btn = card.querySelector('.op-save');
    btn.disabled = true;
    btn.textContent = 'Saving…';
    try {
      await api(`/api/v1/limits/admin/tenants/${encodeURIComponent(tenant.owner_user_id)}`,
                { method: 'PATCH', body: patch });
      btn.textContent = 'Saved';
      // The new ceiling applies to the tenant's very next request, not on
      // their next restart — the number lives on the server, not in their app.
      setTimeout(() => { btn.textContent = 'Save'; btn.disabled = false; }, 1400);
      await load();
    } catch (e) {
      msg(e.message, true);
      btn.textContent = 'Save';
      btn.disabled = false;
    }
  }

  async function load() {
    msg('Loading…');
    try {
      const data = await api('/api/v1/limits/admin/tenants');
      rows = Array.isArray(data.tenants) ? data.tenants : [];
      const sub = document.getElementById('op-sub');
      if (sub) sub.textContent = `${rows.length} compan${rows.length === 1 ? 'y' : 'ies'} · usage for ${data.day} (IST)`;
      msg('');
      render();
    } catch (e) {
      rows = [];
      msg(e.message, true);
      const list = document.getElementById('op-list');
      if (list) list.innerHTML = '';
    }
  }

  function open() {
    mount();
    root.hidden = false;
    requestAnimationFrame(() => root.classList.add('is-in'));
    load();
  }

  function close() {
    if (!root) return;
    root.classList.remove('is-in');
    setTimeout(() => { if (root) root.hidden = true; }, 320);
  }

  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && (e.key === 'O' || e.key === 'o')) {
      e.preventDefault();
      root && !root.hidden ? close() : open();
    }
    if (e.key === 'Escape' && root && !root.hidden) close();
  });

  return { open, close, load };
})();
