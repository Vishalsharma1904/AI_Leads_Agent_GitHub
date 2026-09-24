/**
 * ============================================================
 *  PLUGINS PAGE (page-plugins.js)
 *
 *  Renders the plugin catalogue from PluginCore. Every badge, message and
 *  button state is read from the registry — nothing on this page is decorative
 *  or hardcoded. If a plugin cannot work yet, the card says exactly why.
 * ============================================================
 */

'use strict';

const PluginsCtrl = {
  filter: 'all',
  search: '',
  busy: new Set(),
  /** id of the plugin whose inline setup panel is open, or null. */
  openSetup: null,

  init() {
    if (!window.PluginCore) {
      this._renderFatal('Plugin core failed to load. Check that plugin-core.js is included.');
      return;
    }
    this.bindOnce();
    this.render();
    // Refresh health for anything already enabled, without blocking first paint.
    setTimeout(() => this.refreshAll({ silent: true }), 250);
  },

  bindOnce() {
    if (this._bound) return;
    this._bound = true;

    document.getElementById('plugins-search')?.addEventListener('input', (e) => {
      this.search = e.target.value.trim().toLowerCase();
      this.renderGrid();
    });

    // Re-render whenever the registry changes, so the page can never drift
    // out of sync with actual plugin state.
    document.addEventListener('nexus:plugin:changed', () => {
      this.renderStats();
      this.renderGrid();
    });
  },

  // ── Rendering ──────────────────────────────────────────────────────────
  render() {
    this.renderStats();
    this.renderFilters();
    this.renderGrid();
  },

  renderStats() {
    const host = document.getElementById('plugins-stats');
    if (!host) return;
    const s = window.PluginCore.stats();

    const tiles = [
      { label: 'Available',   value: s.total,      tone: 'neutral' },
      { label: 'Enabled',     value: s.enabled,    tone: 'accent'  },
      { label: 'Connected',   value: s.connected,  tone: 'good'    },
      { label: 'Needs setup', value: s.needsSetup, tone: 'warn'    },
      { label: 'Problems',    value: s.problems,   tone: s.problems ? 'bad' : 'neutral' }
    ];

    host.innerHTML = tiles.map(t => `
      <div class="pg-stat pg-stat--${t.tone}">
        <div class="pg-stat-value">${t.value}</div>
        <div class="pg-stat-label">${t.label}</div>
      </div>
    `).join('');
  },

  renderFilters() {
    const host = document.getElementById('plugins-filters');
    if (!host) return;

    const cats = window.PluginCore.categories();
    const counts = {};
    window.PluginCore.list().forEach(p => {
      counts[p.category] = (counts[p.category] || 0) + 1;
    });

    const chips = [{ key: 'all', label: 'All', count: window.PluginCore.list().length }]
      .concat(Object.entries(cats)
        .filter(([key]) => counts[key])
        .map(([key, label]) => ({ key, label, count: counts[key] })));

    host.innerHTML = chips.map(c => `
      <button class="pg-chip ${this.filter === c.key ? 'is-active' : ''}"
              onclick="PluginsCtrl.setFilter('${c.key}')"
              aria-pressed="${this.filter === c.key}">
        ${this._esc(c.label)} <span class="pg-chip-count">${c.count}</span>
      </button>
    `).join('');
  },

  setFilter(key) {
    this.filter = key;
    this.renderFilters();
    this.renderGrid();
  },

  renderGrid() {
    const host = document.getElementById('plugins-grid');
    if (!host) return;

    let items = window.PluginCore.list();

    if (this.filter !== 'all') {
      items = items.filter(p => p.category === this.filter);
    }
    if (this.search) {
      items = items.filter(p =>
        p.name.toLowerCase().includes(this.search) ||
        (p.description || '').toLowerCase().includes(this.search) ||
        (p.capabilities || []).join(' ').toLowerCase().includes(this.search)
      );
    }

    // Working things first, then things needing setup, then planned.
    const rank = p => {
      if (p.health === 'CONNECTED') return 0;
      if (p.lifecycle === 'ENABLED') return 1;
      if (p.ready) return 2;
      if (p.tier === 'PARTIAL') return 3;
      return 4;
    };
    items.sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));

    if (!items.length) {
      host.innerHTML = `
        <div class="pg-empty">
          <div class="pg-empty-icon">🔌</div>
          <div class="pg-empty-title">No plugins match that search</div>
          <div class="pg-empty-sub">Try a different keyword or pick another category.</div>
        </div>`;
      return;
    }

    host.innerHTML = items.map(p => this._card(p)).join('');
  },

  /**
   * Compact card. Deliberately minimal: name, one-line summary, a single status
   * line, and two buttons. Capabilities, permissions and long explanations live
   * in the detail and guide panels so the grid stays scannable.
   */
  _card(p) {
    const isBusy = this.busy.has(p.id);
    const enabled = p.lifecycle === 'ENABLED';

    // One status line, never more. Priority: blocked > health > ready.
    let status = '';
    if (!p.ready) {
      status = `
        <div class="pg-status pg-status--blocked" title="${this._esc(p.missing.map(m => m.label).join('; '))}">
          <span class="pg-status-dot" aria-hidden="true"></span>
          <span class="pg-status-text">${this._esc(p.missing[0]?.label || 'Needs setup')}</span>
        </div>`;
    } else if (enabled && p.health) {
      status = `
        <div class="pg-status pg-status--${(p.health || '').toLowerCase()}" title="${this._esc(p.healthMessage || '')}">
          <span class="pg-status-dot" aria-hidden="true"></span>
          <span class="pg-status-text">${this._esc(p.healthMessage || p.health)}</span>
          ${p.checkedAt ? `<span class="pg-status-time">${this._ago(p.checkedAt)}</span>` : ''}
        </div>`;
    }

    return `
      <article class="pg-card ${enabled ? 'is-enabled' : ''} ${!p.ready ? 'is-blocked' : ''}"
               data-plugin-id="${this._esc(p.id)}">
        <header class="pg-card-head">
          <div class="pg-avatar" aria-hidden="true">${this._esc(this._initials(p.name))}</div>
          <div class="pg-card-title-wrap">
            <h3 class="pg-card-title">${this._esc(p.name)}</h3>
            <div class="pg-card-meta">${this._esc(p.vendor || '—')}</div>
          </div>
          ${this._badge(p)}
        </header>

        <p class="pg-card-desc">${this._esc(p.summary || this._firstSentence(p.description))}</p>

        ${status}

        <footer class="pg-card-actions">
          ${this._actions(p, isBusy)}
        </footer>

        ${this._setupPanel(p)}
      </article>`;
  },

  /** Keeps card copy to one line without losing the full text elsewhere. */
  _firstSentence(text) {
    const raw = String(text || '').trim();
    const cut = raw.match(/^(.{0,110}?[.!?])(\s|$)/);
    if (cut) return cut[1];
    return raw.length > 110 ? raw.slice(0, 107).trimEnd() + '…' : raw;
  },

  _badge(p) {
    // Badge reflects reality, in priority order.
    let text = 'Available';
    let tone = 'neutral';

    if (p.tier === 'PLANNED')                { text = 'Planned';     tone = 'planned'; }
    if (p.tier === 'PARTIAL' && !p.ready)    { text = 'Setup needed'; tone = 'warn';   }
    if (p.ready && p.lifecycle !== 'ENABLED'){ text = 'Ready';       tone = 'ready';   }
    if (p.lifecycle === 'ENABLED')           { text = 'Enabled';     tone = 'accent';  }
    if (p.health === 'CONNECTED')            { text = 'Connected';   tone = 'good';    }
    if (p.health === 'DEGRADED')             { text = 'Degraded';    tone = 'warn';    }
    if (p.health === 'AUTH_EXPIRED')         { text = 'Auth expired'; tone = 'bad';    }
    if (p.health === 'RATE_LIMITED')         { text = 'Rate limited'; tone = 'warn';   }
    if (p.health === 'ERROR')                { text = 'Error';       tone = 'bad';     }

    return `<span class="pg-badge pg-badge--${tone}">${this._esc(text)}</span>`;
  },

  /**
   * Two buttons, always. The left one is always "How to set up" so the guide is
   * in the same place on every card; the right one is the single most useful
   * next action for the plugin's current state.
   */
  _actions(p, isBusy) {
    const id = this._esc(p.id);
    const hasFields = (p.setup?.fields || []).length > 0;

    const guide = `<button class="pg-btn pg-btn--ghost" onclick="PluginsCtrl.guide('${id}')">
        <span aria-hidden="true">?</span> How to set up
      </button>`;

    let primary;
    if (p.tier === 'PLANNED') {
      primary = `<button class="pg-btn pg-btn--ghost" disabled
        title="Waiting on the backend service, not on you">Not available yet</button>`;
    } else if (p.lifecycle === 'ENABLED') {
      primary = `<button class="pg-btn pg-btn--soft" onclick="PluginsCtrl.openMenu('${id}', event)" ${isBusy ? 'disabled' : ''}>
        Manage</button>`;
    } else if (!p.ready && hasFields) {
      primary = `<button class="pg-btn pg-btn--primary" onclick="PluginsCtrl.toggleSetup('${id}')">Connect</button>`;
    } else if (!p.ready) {
      primary = `<button class="pg-btn pg-btn--ghost" disabled>Enable</button>`;
    } else {
      primary = `<button class="pg-btn pg-btn--primary" onclick="PluginsCtrl.enable('${id}', event)" ${isBusy ? 'disabled' : ''}>
        Enable</button>`;
    }

    return guide + primary;
  },

  /** Small popover for an enabled plugin, keeping the card itself to 2 buttons. */
  openMenu(id, event) {
    event?.stopPropagation();
    document.querySelectorAll('.pg-menu').forEach(m => m.remove());

    const p = window.PluginCore.describe(id);
    const hasFields = (p.setup?.fields || []).length > 0;
    const anchor = event?.currentTarget;
    if (!anchor) return;

    const menu = document.createElement('div');
    menu.className = 'pg-menu';
    menu.setAttribute('role', 'menu');
    menu.innerHTML = `
      ${hasFields ? `<button role="menuitem" onclick="PluginsCtrl.closeMenu(); PluginsCtrl.toggleSetup('${this._esc(id)}')">Edit settings</button>` : ''}
      <button role="menuitem" onclick="PluginsCtrl.closeMenu(); PluginsCtrl.check('${this._esc(id)}', event)">Re-check now</button>
      <button role="menuitem" onclick="PluginsCtrl.closeMenu(); PluginsCtrl.explain('${this._esc(id)}')">View details</button>
      <button role="menuitem" class="is-danger" onclick="PluginsCtrl.closeMenu(); PluginsCtrl.disable('${this._esc(id)}', event)">Disable</button>`;

    anchor.parentElement.style.position = 'relative';
    anchor.parentElement.appendChild(menu);
    menu.querySelector('button')?.focus();

    setTimeout(() => {
      document.addEventListener('click', this._menuAway = () => this.closeMenu(), { once: true });
    }, 0);
  },

  closeMenu() {
    document.querySelectorAll('.pg-menu').forEach(m => m.remove());
  },

  /**
   * Focused "how do I set this up" panel. Separate from the details modal on
   * purpose: this answers one question only, in order, with nothing else.
   */
  guide(id) {
    const p = window.PluginCore.describe(id);
    if (!p) return;
    const setup = p.setup || {};

    let modal = document.getElementById('pg-guide-modal');
    if (!modal) {
      modal = document.createElement('div');
      modal.id = 'pg-guide-modal';
      modal.className = 'pg-modal';
      modal.setAttribute('role', 'dialog');
      modal.setAttribute('aria-modal', 'true');
      document.body.appendChild(modal);
    }

    const needs = (p.requires || []).length
      ? `<div class="pg-guide-needs">
           <div class="pg-guide-needs-title">What you need first</div>
           <ul>${p.requires.map(r => `<li>${this._esc(r.detail || r.label)}</li>`).join('')}</ul>
         </div>`
      : `<div class="pg-guide-needs pg-guide-needs--none">Nothing to obtain — this works straight away.</div>`;

    const steps = (setup.steps || []).length
      ? `<ol class="pg-guide-steps">${setup.steps.map(s => `<li>${this._esc(s)}</li>`).join('')}</ol>`
      : '<p class="pg-muted">No steps needed.</p>';

    const canConnect = (setup.fields || []).length > 0 && p.tier !== 'PLANNED';

    modal.innerHTML = `
      <div class="pg-modal-backdrop" onclick="PluginsCtrl.closeGuide()"></div>
      <div class="pg-modal-card pg-modal-card--guide" role="document">
        <header class="pg-modal-head">
          <div class="pg-avatar" aria-hidden="true">${this._esc(this._initials(p.name))}</div>
          <div>
            <h3>Set up ${this._esc(p.name)}</h3>
            <div class="pg-card-meta">${this._esc(setup.summary || '')}</div>
          </div>
          <button class="pg-modal-close" onclick="PluginsCtrl.closeGuide()" aria-label="Close">✕</button>
        </header>

        ${needs}

        <h4 class="pg-guide-h">Steps</h4>
        ${steps}

        ${setup.docsUrl ? `<a class="pg-doclink" href="${this._esc(setup.docsUrl)}" target="_blank" rel="noopener noreferrer">
          Open ${this._esc(this._host(setup.docsUrl))} ↗</a>` : ''}

        ${setup.notes ? `<div class="pg-guide-note">${this._esc(setup.notes)}</div>` : ''}

        <div class="pg-setup-actions">
          <button class="pg-btn pg-btn--ghost" onclick="PluginsCtrl.closeGuide()">Close</button>
          ${canConnect ? `<button class="pg-btn pg-btn--primary"
            onclick="PluginsCtrl.closeGuide(); PluginsCtrl.toggleSetup('${this._esc(id)}')">
            I have what I need — connect</button>` : ''}
        </div>
      </div>`;

    modal.classList.add('is-open');
    modal.querySelector('.pg-modal-close')?.focus();
    this._guideEsc = (e) => { if (e.key === 'Escape') this.closeGuide(); };
    document.addEventListener('keydown', this._guideEsc);
  },

  closeGuide() {
    document.getElementById('pg-guide-modal')?.classList.remove('is-open');
    if (this._guideEsc) {
      document.removeEventListener('keydown', this._guideEsc);
      this._guideEsc = null;
    }
  },

  // ── Inline setup panel ─────────────────────────────────────────────────
  toggleSetup(id) {
    this.openSetup = this.openSetup === id ? null : id;
    this.renderGrid();
    if (this.openSetup === id) {
      const panel = document.querySelector(`[data-setup-for="${id}"]`);
      panel?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      panel?.querySelector('input, textarea')?.focus();
    }
  },

  _setupPanel(p) {
    if (this.openSetup !== p.id) return '';
    const setup = p.setup || {};
    const fields = setup.fields || [];
    const id = this._esc(p.id);

    const steps = (setup.steps || []).length ? `
      <ol class="pg-steps">
        ${setup.steps.map(s => `<li>${this._esc(s)}</li>`).join('')}
      </ol>` : '';

    const docs = setup.docsUrl ? `
      <a class="pg-doclink" href="${this._esc(setup.docsUrl)}" target="_blank" rel="noopener noreferrer">
        Open ${this._esc(this._host(setup.docsUrl))} ↗
      </a>` : '';

    const inputs = fields.map(f => {
      const current = typeof f.current === 'function' ? (f.current() || '') : '';
      const fieldId = `pg-f-${id}-${this._esc(f.key)}`;
      const common = `id="${fieldId}" data-field="${this._esc(f.key)}" class="pg-input" ` +
        `placeholder="${this._esc(f.placeholder || '')}"`;

      // A saved secret is never echoed back; we show that one exists instead.
      const isSecret = f.type === 'password';
      const valueAttr = isSecret ? '' : ` value="${this._esc(current)}"`;
      const savedNote = (isSecret && current)
        ? `<span class="pg-saved-note">A key is already saved — leave blank to keep it.</span>` : '';

      const control = f.type === 'textarea'
        ? `<textarea ${common} rows="3">${this._esc(current)}</textarea>`
        : `<input ${common} type="${isSecret ? 'password' : (f.type === 'url' ? 'url' : 'text')}"${valueAttr}
             ${isSecret ? 'autocomplete="off" spellcheck="false"' : ''}>`;

      return `
        <div class="pg-field">
          <label class="pg-label" for="${fieldId}">
            ${this._esc(f.label)}${f.required ? ' <span class="pg-req">*</span>' : ''}
          </label>
          ${control}
          ${f.hint ? `<span class="pg-hint">${this._esc(f.hint)}</span>` : ''}
          ${savedNote}
        </div>`;
    }).join('');

    return `
      <div class="pg-setup" data-setup-for="${id}">
        ${setup.summary ? `<p class="pg-setup-summary">${this._esc(setup.summary)}</p>` : ''}
        ${steps}
        ${docs}
        ${inputs ? `<div class="pg-fields">${inputs}</div>` : ''}
        <div class="pg-setup-actions">
          <button class="pg-btn pg-btn--ghost" onclick="PluginsCtrl.toggleSetup('${id}')">Close</button>
          ${fields.length ? `
            <button class="pg-btn pg-btn--primary" onclick="PluginsCtrl.saveSetup('${id}', event)">
              Save &amp; test
            </button>` : ''}
        </div>
        <div class="pg-setup-result" id="pg-result-${id}" role="status" aria-live="polite"></div>
      </div>`;
  },

  async saveSetup(id, event) {
    const btn = event?.currentTarget;
    const panel = document.querySelector(`[data-setup-for="${id}"]`);
    const resultEl = document.getElementById(`pg-result-${id}`);
    if (!panel) return;

    const values = {};
    panel.querySelectorAll('[data-field]').forEach(el => {
      const raw = el.value.trim();
      // Blank secret means "keep what is saved", so do not overwrite with ''.
      if (raw || el.type !== 'password') values[el.dataset.field] = raw;
    });

    const handle = window.ButtonFeedback ? window.ButtonFeedback.busy(btn, 'Saving…') : null;
    const say = (kind, text) => {
      if (!resultEl) return;
      const colour = { ok: '#10b981', warn: '#f59e0b', bad: '#ef4444' }[kind] || 'var(--gray-400)';
      resultEl.innerHTML = `<span style="color:${colour};font-weight:600;">${this._esc(text)}</span>`;
    };

    try {
      const saved = await window.PluginCore.saveSetup(id, values);

      if (!saved.ok) {
        handle?.error('Check input');
        say('bad', saved.message);
        panel.querySelector(`[data-field="${saved.field}"]`)?.focus();
        return;
      }

      if (!saved.ready) {
        handle?.warn('Still blocked');
        say('warn', saved.message);
        this.renderStats();
        return;
      }

      // Saved and requirements satisfied: enable and measure real health.
      const enabled = await window.PluginCore.enable(id);
      if (!enabled.ok) {
        handle?.warn('Saved, not enabled');
        say('warn', enabled.message);
        return;
      }

      const health = enabled.health || {};
      if (health.state === 'CONNECTED') {
        handle?.success('Connected');
        say('ok', health.message || 'Connected.');
        window.showToast?.('success', `${this._name(id)} connected`, health.message || '');
        this.openSetup = null;
      } else if (health.state === 'DEGRADED') {
        handle?.warn('Partly working');
        say('warn', health.message);
        window.showToast?.('warning', `${this._name(id)} enabled with limits`, health.message);
      } else {
        handle?.error(this._titleCase(health.state || 'Problem'));
        say('bad', health.message || 'Saved, but the provider rejected it.');
        window.showToast?.('error', `${this._name(id)}: ${this._titleCase(health.state)}`, health.message || '');
      }
    } catch (err) {
      handle?.error('Failed');
      say('bad', err?.message || 'Unexpected error.');
    } finally {
      this.renderStats();
      this.renderGrid();
    }
  },

  _host(url) {
    try { return new URL(url).hostname.replace(/^www\./, ''); }
    catch { return url; }
  },

  // ── Actions (all give visible feedback) ────────────────────────────────
  async enable(id, event) {
    const btn = event?.currentTarget;
    const handle = window.ButtonFeedback ? window.ButtonFeedback.busy(btn, 'Enabling…') : null;
    this.busy.add(id);

    try {
      const result = await window.PluginCore.enable(id);

      if (!result.ok) {
        handle?.warn('Blocked');
        window.showToast?.('warning', 'Cannot enable yet', result.message);
        this.explain(id);
        return;
      }

      const health = result.health || {};
      if (health.state === 'CONNECTED') {
        handle?.success('Connected');
        window.showToast?.('success', `${this._name(id)} enabled`, health.message || 'Connected.');
      } else if (health.state === 'DEGRADED') {
        handle?.warn('Degraded');
        window.showToast?.('warning', `${this._name(id)} enabled with limits`, health.message);
      } else {
        handle?.error(this._titleCase(health.state || 'Problem'));
        window.showToast?.('error', `${this._name(id)} enabled but not working`, health.message || '');
      }
    } catch (err) {
      handle?.error('Failed');
      window.showToast?.('error', 'Enable failed', err?.message || 'Unexpected error.');
    } finally {
      this.busy.delete(id);
      this.renderStats();
      this.renderGrid();
    }
  },

  disable(id, event) {
    const btn = event?.currentTarget;
    const handle = window.ButtonFeedback ? window.ButtonFeedback.busy(btn, 'Disabling…') : null;
    const result = window.PluginCore.disable(id);

    if (result.ok) {
      handle?.success('Disabled');
      window.showToast?.('info', `${this._name(id)} disabled`, 'It will not be used until you enable it again.');
    } else {
      handle?.error('Failed');
      window.showToast?.('error', 'Could not disable', result.message);
    }
    this.renderStats();
    this.renderGrid();
  },

  async check(id, event) {
    const btn = event?.currentTarget;
    const handle = window.ButtonFeedback ? window.ButtonFeedback.busy(btn, 'Checking…') : null;
    this.busy.add(id);

    try {
      const health = await window.PluginCore.checkHealth(id);
      if (health.state === 'CONNECTED') {
        handle?.success('Connected');
        window.showToast?.('success', `${this._name(id)} is healthy`, health.message);
      } else if (health.state === 'DEGRADED') {
        handle?.warn('Degraded');
        window.showToast?.('warning', `${this._name(id)}: limited`, health.message);
      } else {
        handle?.error(this._titleCase(health.state));
        window.showToast?.('error', `${this._name(id)}: ${this._titleCase(health.state)}`, health.message);
      }
    } finally {
      this.busy.delete(id);
      this.renderStats();
      this.renderGrid();
    }
  },

  async refreshAll(opts = {}) {
    const btn = opts.event?.currentTarget;
    const handle = (!opts.silent && window.ButtonFeedback) ? window.ButtonFeedback.busy(btn, 'Checking all…') : null;
    try {
      const results = await window.PluginCore.checkAllEnabled();
      const count = Object.keys(results).length;
      const bad = Object.values(results).filter(r => r.state !== 'CONNECTED').length;

      if (!opts.silent) {
        if (!count) {
          handle?.warn('None enabled');
          window.showToast?.('info', 'Nothing to check', 'No plugins are enabled yet.');
        } else if (bad) {
          handle?.warn(`${bad} need attention`);
          window.showToast?.('warning', 'Health check done', `${count} checked · ${bad} need attention.`);
        } else {
          handle?.success('All healthy');
          window.showToast?.('success', 'Health check done', `All ${count} enabled plugins are connected.`);
        }
      }
    } catch (err) {
      handle?.error('Failed');
      if (!opts.silent) window.showToast?.('error', 'Health check failed', err?.message || '');
    } finally {
      this.renderStats();
      this.renderGrid();
    }
  },

  /** Detail panel: capabilities, permissions, and the honest blocker detail. */
  explain(id) {
    const p = window.PluginCore.describe(id);
    if (!p) return;

    let modal = document.getElementById('pg-detail-modal');
    if (!modal) {
      modal = document.createElement('div');
      modal.id = 'pg-detail-modal';
      modal.className = 'pg-modal';
      modal.setAttribute('role', 'dialog');
      modal.setAttribute('aria-modal', 'true');
      document.body.appendChild(modal);
    }

    const section = (title, body) => body
      ? `<div class="pg-modal-section"><h4>${title}</h4>${body}</div>` : '';

    modal.innerHTML = `
      <div class="pg-modal-backdrop" onclick="PluginsCtrl.closeDetail()"></div>
      <div class="pg-modal-card" role="document">
        <header class="pg-modal-head">
          <div class="pg-avatar" aria-hidden="true">${this._esc(this._initials(p.name))}</div>
          <div>
            <h3 id="pg-modal-title">${this._esc(p.name)}</h3>
            <div class="pg-card-meta">${this._esc(p.categoryLabel)} · ${this._esc(p.vendor || '—')} · v${this._esc(p.version)}</div>
          </div>
          <button class="pg-modal-close" onclick="PluginsCtrl.closeDetail()" aria-label="Close">✕</button>
        </header>

        <p class="pg-modal-desc">${this._esc(p.description || '')}</p>

        ${!p.ready ? `
          <div class="pg-blocker pg-blocker--lg">
            <span class="pg-blocker-icon" aria-hidden="true">!</span>
            <div>
              <div class="pg-blocker-title">Why this is not active</div>
              ${p.missing.map(m => `
                <div class="pg-blocker-item">
                  <strong>${this._esc(m.label)}</strong>
                  ${m.detail ? `<div class="pg-blocker-detail">${this._esc(m.detail)}</div>` : ''}
                </div>`).join('')}
            </div>
          </div>` : ''}

        ${p.detail ? `<p class="pg-modal-detail">${this._esc(p.detail)}</p>` : ''}

        ${(p.setup?.steps || []).length ? section('How to set it up',
          `<ol class="pg-steps">${p.setup.steps.map(s => `<li>${this._esc(s)}</li>`).join('')}</ol>` +
          (p.setup.docsUrl
            ? `<a class="pg-doclink" href="${this._esc(p.setup.docsUrl)}" target="_blank" rel="noopener noreferrer">Open ${this._esc(this._host(p.setup.docsUrl))} ↗</a>`
            : '')) : ''}

        ${section('Capabilities', (p.capabilities || []).length
          ? `<div class="pg-caps">${p.capabilities.map(c => `<span class="pg-cap">${this._esc(this._humanize(c))}</span>`).join('')}</div>`
          : '<p class="pg-muted">None declared.</p>')}

        ${section('Permissions requested', (p.permissions || []).length
          ? `<ul class="pg-list">${p.permissions.map(x => `<li><code>${this._esc(x)}</code></li>`).join('')}</ul>`
          : '<p class="pg-muted">No special permissions.</p>')}

        ${section('Authentication', `<p class="pg-muted">${this._esc(this._authLabel(p.authentication?.type))}</p>`)}

        ${p.health ? section('Last health check',
          `<p class="pg-muted">${this._esc(p.health)} — ${this._esc(p.healthMessage || '')}${p.checkedAt ? ` (${this._ago(p.checkedAt)})` : ''}</p>`) : ''}
      </div>`;

    modal.classList.add('is-open');
    modal.querySelector('.pg-modal-close')?.focus();
    this._escHandler = (e) => { if (e.key === 'Escape') this.closeDetail(); };
    document.addEventListener('keydown', this._escHandler);
  },

  closeDetail() {
    const modal = document.getElementById('pg-detail-modal');
    modal?.classList.remove('is-open');
    if (this._escHandler) {
      document.removeEventListener('keydown', this._escHandler);
      this._escHandler = null;
    }
  },

  _renderFatal(message) {
    const host = document.getElementById('plugins-grid');
    if (host) {
      host.innerHTML = `<div class="pg-empty">
        <div class="pg-empty-icon">⚠️</div>
        <div class="pg-empty-title">Plugins unavailable</div>
        <div class="pg-empty-sub">${this._esc(message)}</div>
      </div>`;
    }
  },

  // ── Small helpers ──────────────────────────────────────────────────────
  _name(id) { return window.PluginCore.describe(id)?.name || id; },

  _authLabel(type) {
    return {
      none: 'No sign-in required.',
      api_key: 'Uses an API key you provide.',
      webhook: 'Uses a Web App URL you deploy.',
      oauth2: 'Uses OAuth 2.0 — requires the backend token service.'
    }[type] || 'Unknown.';
  },

  _humanize(value) {
    return String(value).replace(/[_.]/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
  },

  _titleCase(value) {
    return this._humanize(String(value || '').toLowerCase());
  },

  _initials(name) {
    const parts = String(name).replace(/[^\w\s]/g, '').trim().split(/\s+/).filter(Boolean);
    if (!parts.length) return '?';
    return (parts.length > 1 ? parts[0][0] + parts[1][0] : parts[0].slice(0, 2)).toUpperCase();
  },

  _ago(ts) {
    const secs = Math.max(0, Math.round((Date.now() - ts) / 1000));
    if (secs < 60) return `${secs}s ago`;
    if (secs < 3600) return `${Math.round(secs / 60)}m ago`;
    return `${Math.round(secs / 3600)}h ago`;
  },

  _esc(value) {
    return String(value ?? '').replace(/[&<>"']/g, ch => (
      { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]
    ));
  }
};

window.PluginsCtrl = PluginsCtrl;
