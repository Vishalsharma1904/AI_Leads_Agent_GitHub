/**
 * page-agent.js
 * Client Acquisition Agent Controller (macOS / Anthropic UX)
 * Manages Multi-Location Targeting, Industry Selection, Live 4-Phase Pipeline, and Live Logging.
 */
'use strict';

const AgentCtrl = {
  selectedLocations: ['Delhi NCR'],
  selectedIndustries: new Set(['Hotels & Hospitality', 'Hospitals & Healthcare', 'IT Parks & Tech Companies', 'Shopping Malls & Retail', 'Factories & Manufacturing']),
  batchSize: 3,
  isRunning: false,
  targetCount: null,   // set by chat for an exact-count run
  chatServiceTypes: null,
  serviceOptions: [
    { key: 'auto', label: 'Auto-detect all requirements', aliases: ['all relevant', 'all requirements', 'auto', 'any requirement', 'all manpower'] },
    { key: 'security', label: 'Security', aliases: ['security', 'guard', 'bouncer'] },
    { key: 'housekeeping', label: 'Housekeeping', aliases: ['housekeep', 'cleaning', 'facility'] },
    { key: 'pantry', label: 'Pantry Boy', aliases: ['pantry', 'office boy', 'canteen', 'tea'] }
  ],

  normalizeServiceTypes(types) {
    const requested = (Array.isArray(types) ? types : [])
      .map(value => String(value || '').trim().toLowerCase())
      .filter(Boolean);
    const known = this.serviceOptions
      .filter(option => requested.some(value => option.aliases.some(alias => value.includes(alias))))
      .map(option => option.label);
    const custom = requested
      .filter(value => !this.serviceOptions.some(option => option.aliases.some(alias => value.includes(alias))))
      .map(value => value.replace(/\s+/g, ' ').trim())
      .filter(value => value && !known.some(item => item.toLowerCase() === value.toLowerCase()))
      .map(value => value.replace(/\b\w/g, c => c.toUpperCase()));
    return [...known, ...custom];
  },

  getSelectedServiceTypes() {
    return this.serviceOptions
      .filter(option => document.getElementById(`target-${option.key}`)?.checked === true)
      .map(option => option.label);
  },

  setSelectedServiceTypes(types) {
    const selected = this.normalizeServiceTypes(types);
    if (!selected.length) return false;
    this.serviceOptions.forEach(option => {
      const checkbox = document.getElementById(`target-${option.key}`);
      if (checkbox) checkbox.checked = selected.includes(option.label);
    });
    this.syncServiceCards();
    return true;
  },

  syncServiceCards() {
    this.serviceOptions.forEach(option => {
      const checkbox = document.getElementById(`target-${option.key}`);
      const card = document.getElementById(`svc-${option.key === 'housekeeping' ? 'hk' : option.key}-card`);
      const selected = checkbox?.checked === true;
      card?.classList.toggle('active', selected);
      card?.setAttribute('data-selected', selected ? 'true' : 'false');
    });
    const selected = this.getSelectedServiceTypes();
    const count = document.getElementById('service-selection-count');
    if (count) count.textContent = `${selected.length} selected`;
    return selected;
  },

  handleServiceToggle(type) {
    let selected = this.getSelectedServiceTypes();
    if (!selected.length) {
      const checkbox = document.getElementById(`target-${type}`);
      if (checkbox) checkbox.checked = true;
      selected = this.getSelectedServiceTypes();
      window.showToast?.('warning', 'Service Required', 'Keep at least one service selected.');
    }
    this.syncServiceCards();
    return selected;
  },

  /**
   * Configure + immediately run from a chat command.
   * Guarantees the chat's cities / industries / count actually reach the engine.
   */
  async runFromChat({ cities, industries, serviceTypes, count }) {
    if (Array.isArray(cities) && cities.length) {
      this.selectedLocations = [...cities];
      this.renderLocationChips();
    }
    if (Array.isArray(industries) && industries.length) {
      const requestedIndustries = industries.filter(value => String(value || '').trim().toUpperCase() !== 'ALL');
      const allIndustries = (window.IndustryDB && typeof window.IndustryDB.getNames === 'function')
        ? window.IndustryDB.getNames()
        : [];
      const configuredBuyers = window.ClavisBusiness?.buyerQueries?.() || [];
      const buyerSectors = configuredBuyers.length ? configuredBuyers : (allIndustries.length ? allIndustries : this.getDefaults().industries);
      this.selectedIndustries = new Set(requestedIndustries.length ? requestedIndustries : buyerSectors);
      this.renderIndustryGrid();
    }
    if (count && Number.isFinite(+count)) {
      // Preserve the explicit request within the supported 1–100 range.
      this.targetCount = Math.max(1, Math.min(100, parseInt(count, 10)));
    }
    if (Array.isArray(serviceTypes) && serviceTypes.length) {
      const normalized = this.normalizeServiceTypes(serviceTypes);
      this.chatServiceTypes = normalized.length ? normalized : null;
      this.setSelectedServiceTypes(serviceTypes);
    }
    if (this.isRunning) {
      this.log('warn', 'A scrape is already running — ignoring the new chat command.');
      return;
    }
    return this.startPipeline();
  },

  init() {
    this.loadDefaults();
    this.renderLocationChips();
    this.renderIndustryGrid();
    this.updateBatchInfo();
    this.bindEvents();
    this.syncServiceCards();
  },

  bindEvents() {
    const locInput = document.getElementById('location-input');
    if (locInput) {
      if (!locInput.__bound) {
        locInput.__bound = true;
        locInput.addEventListener('keydown', (e) => this.handleLocationKeydown(e));
      }
    }
    const batchRange = document.getElementById('batch-size');
    if (batchRange) {
      batchRange.addEventListener('input', () => this.updateBatchInfo());
    }
  },

  // â”€â”€ Locations Tag Input â”€â”€
  renderLocationChips() {
    const wrapper = document.getElementById('location-chips');
    if (!wrapper) return;

    wrapper.innerHTML = this.selectedLocations.map((loc, idx) => `
      <span class="location-chip">
        <span>${String(loc).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</span>
        <button type="button" class="chip-remove-btn" aria-label="Remove location ${idx + 1}" onclick="AgentCtrl.removeLocation(${idx})">✕</button>
      </span>
    `).join('');
    this.updateBatchInfo();
  },

  getDefaults() {
    const defaultLocations = [window.SKYLARK_CONFIG?.DEFAULT_CITY || 'Delhi NCR'];
    const saved = window.UserStorage?.getJSON('agent_search_defaults', null);
    if (saved && Array.isArray(saved.locations) && Array.isArray(saved.industries)) {
      const clean = values => [...new Set(values.filter(v => typeof v === 'string').map(v => v.trim().slice(0, 100)).filter(Boolean))].slice(0, 20);
      const aliases = { 'Corporate IT Parks & Tech Hubs': 'IT Parks & Tech Companies', 'Malls & Retail Chains': 'Shopping Malls & Retail' };
      const locations = clean(saved.locations), industries = clean(saved.industries).map(v => aliases[v] || v);
      return { locations: locations.length ? locations : defaultLocations, industries: industries.length ? industries : ['ALL'] };
    }
    return { locations: defaultLocations, industries: ['Hotels & Hospitality', 'Hospitals & Healthcare', 'IT Parks & Tech Companies', 'Shopping Malls & Retail', 'Factories & Manufacturing'] };
  },

  loadDefaults() {
    if (this.isRunning) return;
    const saved = this.getDefaults();
    this.selectedLocations = [...saved.locations];
    this.selectedIndustries = new Set(saved.industries);
  },

  saveDefaults() {
    window.UserStorage?.setJSON('agent_search_defaults', { locations: [...this.selectedLocations], industries: [...this.selectedIndustries] });
  },

  addLocation(value) {
    const name = String(value || '').trim().slice(0, 100);
    if (!name || this.selectedLocations.some(loc => loc.toLowerCase() === name.toLowerCase())) return;
    if ((window.LeadCandidateDomain?.expandLocations([...this.selectedLocations, name]) || [...this.selectedLocations, name]).length > 20) {
      window.showToast?.('warning', 'Location limit', 'Choose up to 20 search areas per run. Delhi NCR counts as 12 areas.');
      return;
    }
    this.selectedLocations.push(name);
    this.saveDefaults();
    this.renderLocationChips();
  },

  handleLocationKeydown(e) {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      const input = e.target;
      const val = input.value.trim().replace(/^,+|,+$/g, '');
      if (val && !this.selectedLocations.includes(val)) {
        this.addLocation(val);
        input.value = '';
        this.renderLocationChips();
      }
    } else if (e.key === 'Backspace' && !e.target.value && this.selectedLocations.length > 0) {
      this.selectedLocations.pop();
      this.saveDefaults();
      this.renderLocationChips();
    }
  },

  removeLocation(idx) {
    this.selectedLocations.splice(idx, 1);
    this.saveDefaults();
    this.renderLocationChips();
  },

  // â”€â”€ Industries Grid â”€â”€
  renderIndustryGrid() {
    const grid = document.getElementById('industry-grid');
    if (!grid) return;

    const allIndustries = (window.IndustryDB && typeof window.IndustryDB.getAll === 'function')
      ? window.IndustryDB.getAll()
      : {
        'Hotels & Hospitality': { icon: 'ðŸ¨', desc: 'Hotels, resorts, banquet halls' },
        'Hospitals & Healthcare': { icon: 'ðŸ¥', desc: 'Hospitals, clinics, labs' },
        'IT Parks & Tech Companies': { icon: 'ðŸ’»', desc: 'Tech parks, IT campuses' },
        'Shopping Malls & Retail': { icon: 'ðŸ›ï¸', desc: 'Shopping malls, retail chains' },
        'Factories & Manufacturing': { icon: 'ðŸ­', desc: 'Industrial plants, manufacturing units' },
        'Warehouses & Logistics': { icon: 'ðŸ“¦', desc: 'Fulfillment centers, transport hubs' },
        'Residential Societies': { icon: 'ðŸ—ï¸', desc: 'Gated apartments, townships' },
        'Schools & Universities': { icon: 'ðŸ«', desc: 'Colleges, schools, universities' },
        'Banks & Corporate Offices': { icon: 'ðŸ¢', desc: 'Bank branches, corporate towers' },
      };

    const esc = (v) => String(v).replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');

    // Industry names contain "&" and apostrophes, which broke the old inline
    // onclick attributes. The name now travels in a data attribute and one
    // delegated listener does the toggling, so multi-select is reliable.
    grid.innerHTML = Object.entries(allIndustries).map(([name, data]) => {
      const on = this.selectedIndustries.has(name);
      return `
        <button type="button" class="industry-chip-card${on ? ' selected' : ''}"
                data-industry="${esc(name)}" aria-pressed="${on}">
          <span class="ind-box" aria-hidden="true"></span>
          <span class="ind-info">
            <span class="ind-name">${esc(name)}</span>
            <span class="ind-desc">${esc(data.desc || 'Commercial facility')}</span>
          </span>
        </button>`;
    }).join('');

    if (!grid.__bound) {
      grid.__bound = true;
      grid.addEventListener('click', (e) => {
        const card = e.target.closest('[data-industry]');
        if (!card) return;
        e.preventDefault();
        this.toggleIndustry(card.dataset.industry);
      });
    }

    this.updateIndustryCount();
    this.updateBatchInfo();
  },

  updateIndustryCount() {
    const n = this.selectedIndustries.size;
    const el = document.getElementById('industry-count');
    if (el) el.textContent = n === 0 ? 'None selected' : n + ' selected';
  },

  toggleIndustry(name) {
    if (this.selectedIndustries.has(name)) {
      this.selectedIndustries.delete(name);
    } else {
      this.selectedIndustries.add(name);
    }
    this.saveDefaults();
    this.renderIndustryGrid();
  },

  selectAllIndustries() {
    const all = (window.IndustryDB && typeof window.IndustryDB.getNames === 'function')
      ? window.IndustryDB.getNames()
      : ['Hotels & Hospitality', 'Hospitals & Healthcare', 'IT Parks & Tech Companies', 'Shopping Malls & Retail', 'Factories & Manufacturing', 'Warehouses & Logistics', 'Residential Societies', 'Schools & Universities', 'Banks & Corporate Offices'];
    this.selectedIndustries = new Set(all);
    this.saveDefaults();
    this.renderIndustryGrid();
  },

  clearAllIndustries() {
    this.selectedIndustries.clear();
    this.saveDefaults();
    this.renderIndustryGrid();
  },

  selectTopIndustries() {
    this.selectedIndustries = new Set([
      'Hotels & Hospitality',
      'Hospitals & Healthcare',
      'IT Parks & Tech Companies',
      'Shopping Malls & Retail',
      'Factories & Manufacturing'
    ]);
    this.saveDefaults();
    this.renderIndustryGrid();
  },

  // â”€â”€ Calculation â”€â”€
  updateBatchInfo() {
    const range = document.getElementById('batch-size');
    const valEl = document.getElementById('batch-size-val');
    const estEl = document.getElementById('batch-estimate');
    const tokenEl = document.getElementById('token-estimate');

    if (range) this.batchSize = parseInt(range.value, 10) || 3;
    if (valEl) valEl.textContent = this.batchSize;

    const locCount = Math.max(1, this.selectedLocations.length);
    const indCount = Math.max(1, this.selectedIndustries.size);
    const expected = locCount * indCount * this.batchSize;
    const tokens = Math.round(expected * 1.8);

    if (estEl) estEl.textContent = `~${expected} total buyer companies expected`;
    if (tokenEl) tokenEl.textContent = `~${tokens} credits`;
  },

  // â”€â”€ Live Logger â”€â”€
  log(type, msg) {
    const container = document.getElementById('live-log');
    if (!container) return;

    if (container.querySelector('.idle')) {
      container.innerHTML = '';
    }

    const time = new Date().toLocaleTimeString('en-IN', { hour12: false });
    const div = document.createElement('div');
    div.className = `log-entry ${type || 'info'}`;
    div.innerHTML = `<span class="log-time" style="opacity:0.4; font-variant-numeric:tabular-nums; margin-right:8px;">[${time}]</span> ${msg}`;
    container.appendChild(div);
    container.scrollTop = container.scrollHeight;
  },

  clearLog() {
    const container = document.getElementById('live-log');
    if (container) {
      container.innerHTML = '<div class="log-entry idle">Log cleared. Ready for next run.</div>';
    }
  },

  // â”€â”€ Live Pipeline Visualizer Node State â”€â”€
  setPhaseState(phaseNum, state, progress = 0) {
    const node = document.getElementById(`pnode-${phaseNum}`);
    const fill = document.getElementById(`pnode-${phaseNum}-fill`);
    const check = document.getElementById(`pnode-${phaseNum}-check`);
    const connector = document.getElementById(`pc-${phaseNum}`);

    if (node) {
      node.classList.remove('active', 'done', 'error');
      if (state === 'active') node.classList.add('active');
      if (state === 'done') node.classList.add('done');
      if (state === 'error') node.classList.add('error');
    }

    if (fill) {
      fill.style.width = `${progress}%`;
    }

    if (check) {
      if (state === 'done') {
        check.style.opacity = '1';
        check.style.background = 'var(--do-green)';
        check.style.color = '#fff';
      } else {
        check.style.opacity = '0.3';
        check.style.background = 'transparent';
      }
    }

    if (connector) {
      if (state === 'done') connector.classList.add('done');
      else connector.classList.remove('done');
    }
  },

  resetPipeline() {
    for (let i = 1; i <= 4; i++) {
      this.setPhaseState(i, 'idle', 0);
    }
    const badge = document.getElementById('pipeline-badge');
    if (badge) {
      badge.className = 'progress-status-badge idle';
      badge.textContent = 'Idle';
    }
  },

  // â”€â”€ Run Pipeline â”€â”€
  async startPipeline() {
    if (this.isRunning) {
      window.RealScraper?.abort?.();
      this.log('warn', 'Stopping lead search; collected leads will remain available.');
      return;
    }

    const locations = window.LeadCandidateDomain?.expandLocations(this.selectedLocations) || [...this.selectedLocations];
    if (!locations.length) {
      window.showToast?.('warning', 'Location required', 'Choose a city, state or Delhi NCR before searching.');
      document.getElementById('location-input')?.focus();
      return;
    }
    const industries = Array.from(this.selectedIndustries);

    if (industries.length === 0) {
      if (window.showToast) window.showToast('warning', 'Industry Required', 'Please select at least one target industry.');
      else alert('Please select at least 1 Target Industry!');
      return;
    }

    // Chat requests may contain an open-ended role such as "solar
    // technicians". Keep that term for the backend even though the compact
    // manual panel only exposes the three common service cards.
    const types = this.chatServiceTypes?.length ? [...this.chatServiceTypes] : this.getSelectedServiceTypes();
    if (!types.length) {
      window.showToast?.('warning', 'Service Required', 'Select at least one service line.');
      return;
    }
    this.syncServiceCards();

    const sources = [];
    if (document.getElementById('src-maps')?.checked) sources.push('Google Maps');
    if (document.getElementById('src-linkedin')?.checked) sources.push('LinkedIn Jobs');
    if (document.getElementById('src-indeed')?.checked) sources.push('Indeed');
    if (document.getElementById('src-google')?.checked) sources.push('Google Jobs');

    const enableMaps = document.getElementById('enrich-maps')?.checked !== false;
    const enableCrawler = document.getElementById('enrich-crawler')?.checked !== false;
    const autoExcel = document.getElementById('auto-download-excel')?.checked === true;

    this.isRunning = true;
    this.updateBtnState(true);
    this.resetPipeline();

    const badge = document.getElementById('pipeline-badge');
    if (badge) {
      badge.className = 'progress-status-badge active';
      badge.textContent = 'Live Agent Running...';
    }

    const runSummary = document.getElementById('run-summary');
    if (runSummary) runSummary.style.display = 'none';

    // â”€â”€ REAL SCRAPER (zero fabrication) â”€â”€
    const engine = window.RealScraper;

    if (!engine) {
      this.log('error', '✕ Real scraper engine not loaded. Check that real-scraper.js is included.');
      this.isRunning = false;
      this.updateBtnState(false);
      if (badge) { badge.className = 'progress-status-badge error'; badge.textContent = 'Engine Missing'; }
      return;
    }
    if (engine.isRunning?.()) {
      this.isRunning = false;
      this.updateBtnState(false);
      window.showToast?.('info', 'Lead search running', 'The current search will finish before another starts.');
      return;
    }

    const activeTask = window.ClavisTask?.current?.();
    const leadTaskId = activeTask && !['completed', 'failed'].includes(activeTask.phase) && activeTask.mode === 'leads'
      ? activeTask.id
      : window.ClavisTask?.begin?.(`Generate leads in ${locations.join(', ')}`, { source: 'composer', display: 'window' });
    const leadTask = window.ClavisTask?.Store?.get?.(leadTaskId);
    if (leadTask) {
      leadTask.display = 'window';
      leadTask._onCancel = () => { engine.abort(); return true; };
    }
    window.ClavisTaskSurface?.show?.();

    // Count policy: if the user named a number, honour it within 1–100.
    // If they named nothing, deliver exactly the default (20).
    const requested = this.targetCount || (window.AppSettings?.defaultCount?.()) || 20;
    const targetCount = Math.max(1, Math.min(100, parseInt(requested, 10) || 20));

    const PHASE_LABELS = {
      1: 'Discovering businesses on Google Maps',
      2: 'Removing duplicate companies',
      3: 'Visiting websites for verified contacts',
      4: 'Validating website · email · phone'
    };
    const emit = (name, detail) => document.dispatchEvent(new CustomEvent(name, { detail }));

    engine.setCallbacks({
      // Real-time narration for the desk pet / chat status card
      onStatus: (s) => emit('nexus:agentstatus', { ...s, taskId: leadTaskId }),
      onLog: (type, msg) => this.log(type, msg),
      onPhase: (phase, status, pct) => {
        this.setPhaseState(phase, status, pct);
        if (status !== 'done' && PHASE_LABELS[phase]) {
          emit('nexus:scrapeprogress', { phase, status, pct, label: PHASE_LABELS[phase], taskId: leadTaskId });
        }
      },
      onLead: (lead) => {
        const contact = lead.phone || lead.email || 'no direct contact found';
        this.log('success', `  ✔ <b>${lead.company}</b> — ${lead.city} · ${contact}`);
        emit('nexus:agentstatus', { text: `Got ${lead.company}`, step: 5, lead: true, taskId: leadTaskId });
      },
      onComplete: (summary) => {
        const totalFound = summary?.total || summary?.added || (summary?.leads ? summary.leads.length : 0);
        const complete = totalFound > 0;
        this.isRunning = false;
        this.targetCount = null;
        this.chatServiceTypes = null;
        this.updateBtnState(false);
        if (!complete) {
          if (badge) { badge.className = 'progress-status-badge error'; badge.textContent = 'No Leads Found'; }
          this.log('error', `No contactable leads found matching the criteria in this location.`);
          window.showToast?.('error', 'No Leads Found', 'Could not find contactable leads matching your search.');
          emit('nexus:scrapedone', { ok: false, added: 0, requested: summary?.requested || targetCount, taskId: leadTaskId });
          return;
        }
        emit('nexus:scrapedone', {
          ok: true,
          added: summary.added ?? totalFound,
          requested: summary.requested || targetCount,
          total: totalFound,
          completeContacts: summary.completeContacts ?? (summary.leads || []).filter(lead => lead.website && lead.email && lead.phone).length,
          leads: Array.isArray(summary.leads) ? summary.leads : [],
          stopped: !!summary.stopped,
          exported: !!summary.exported,
          taskId: leadTaskId
        });
        if (badge) {
          badge.className = 'progress-status-badge done';
          badge.textContent = summary.stopped ? 'Stopped' : 'Completed';
        }
        this.renderRunSummary({
          added: summary.added || totalFound,
          dupes: summary.dupes || 0,
          total: totalFound,
          elapsed: summary.elapsed || '0',
          tokenUsed: totalFound
        });
        emit('nexus:agentstatus', { text: `${totalFound} leads ready to preview and download`, step: 7, finished: true, taskId: leadTaskId });
        window.showToast?.('success', summary.stopped ? 'Search stopped' : 'Your data is ready',
          `${totalFound} verified leads · preview and download available`);
        window.LeadsCtrl?.init?.();
        window.DashboardCtrl?.init?.();
      },
      onError: (err) => {
        this.isRunning = false;
        this.targetCount = null;
        this.chatServiceTypes = null;
        this.updateBtnState(false);
        if (badge) {
          badge.className = 'progress-status-badge error';
          badge.textContent = 'Error';
        }
        this.log('error', `Scrape failed: ${err}`);
        emit('nexus:scrapedone', { ok: false, error: String(err), taskId: leadTaskId });
        if (window.showToast) {
          window.showToast('error', 'Scrape Failed', String(err));
        }
      }
    });

    this.log('info', `Services selected: <b>${types.join(' + ')}</b>`);
    await engine.run({
      industries,
      locations,
      serviceTypes: types,
      targetCount,
      autoExcel: true,
      saveToDb: true
    });
  },

  updateBtnState(running) {
    const btn = document.getElementById('generate-btn');
    const txt = document.getElementById('generate-btn-text');
    if (!btn || !txt) return;

    if (running) {
      btn.classList.add('running');
      btn.style.background = '#ef4444';
      txt.textContent = 'Stop Pipeline';
    } else {
      btn.classList.remove('running');
      btn.style.background = 'var(--do-blue)';
      txt.textContent = 'Generate Leads';
    }
  },

  renderRunSummary(summary) {
    const wrap = document.getElementById('run-summary');
    const grid = document.getElementById('run-summary-grid');
    if (!wrap || !grid) return;

    wrap.style.display = 'block';
    grid.innerHTML = `
      <div class="run-stat-card">
        <div class="run-stat-val" style="color:var(--do-green);">${summary.added || 0}</div>
        <div class="run-stat-lbl">Leads Added</div>
      </div>
      <div class="run-stat-card">
        <div class="run-stat-val" style="color:var(--do-blue);">${summary.dupes || 0}</div>
        <div class="run-stat-lbl">Duplicates Skipped</div>
      </div>
      <div class="run-stat-card">
        <div class="run-stat-val">${summary.elapsed || '0.0'}s</div>
        <div class="run-stat-lbl">Time Elapsed</div>
      </div>
      <div class="run-stat-card">
        <div class="run-stat-val" style="color:var(--do-purple);">${summary.tokenUsed || 0}</div>
        <div class="run-stat-lbl">Tokens Used</div>
      </div>
    `;
  }
};

// Global shortcuts for inline HTML handlers
window.AgentCtrl = AgentCtrl;
window.handleLocationKeydown = (e) => AgentCtrl.handleLocationKeydown(e);
window.selectAllIndustries = () => AgentCtrl.selectAllIndustries();
window.clearAllIndustries = () => AgentCtrl.clearAllIndustries();
window.selectTopIndustries = () => AgentCtrl.selectTopIndustries();
window.updateBatchInfo = () => AgentCtrl.updateBatchInfo();
window.startAgentPipeline = () => AgentCtrl.startPipeline();
window.clearLog = () => AgentCtrl.clearLog();
window.updateServiceCard = (type) => AgentCtrl.handleServiceToggle(type);

document.addEventListener('DOMContentLoaded', () => {
  AgentCtrl.init();
});
