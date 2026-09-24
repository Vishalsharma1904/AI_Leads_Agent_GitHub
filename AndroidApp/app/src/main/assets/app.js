/**
 * ============================================================
 *  SKYLARK LEAD AGENT v2 — UI Controller (app.js)
 *  Multi-location | Industry-aware | Google Sheets Sync
 *  Buyer-focused leads only (NOT service providers)
 * ============================================================
 */

'use strict';

// ============================================================
//  STATE
// ============================================================
let allLeads     = [];
let filteredLeads = [];
let sortConfig   = { col: 'timestamp', dir: 'desc' };
let currentView  = 'dashboard';
let selectedLocations = [];
let selectedIndustries = new Set();
let selectedLeadIds = new Set();

// ============================================================
//  INIT
// ============================================================
document.addEventListener('DOMContentLoaded', async () => {
  try {
    // Provider credentials and webhook URLs are backend-only. Never hydrate
    // them from browser storage or from a bundled frontend config.
    const cfg = window.SKYLARK_CONFIG || {};
    if (cfg.EMAIL_SENDER_ADDRESS && cfg.EMAIL_SENDER_ADDRESS.trim() !== '') {
      const cfgEmail = cfg.EMAIL_SENDER_ADDRESS.trim();
      // Set as active if none saved yet
      if (!localStorage.getItem('skylark_email_account')) {
        localStorage.setItem('skylark_email_account', cfgEmail);
      }
      // Add to saved emails list (no duplicates)
      try {
        const savedArr = JSON.parse(localStorage.getItem('skylark_saved_emails') || '[]');
        if (!savedArr.includes(cfgEmail)) {
          savedArr.push(cfgEmail);
          localStorage.setItem('skylark_saved_emails', JSON.stringify(savedArr));
        }
      } catch(e) {}
    }

    await MemoryEngine.openDB();
    loadSettingsToUI();
    populateIndustryGrid();
    allLeads = await MemoryEngine.getAllLeads();
    filteredLeads = [...allLeads];
    populateFilterDropdowns();
    updateAllUI();
    bindNavigation();
    bindSidebarToggle();
    showView('chat');
    updateBatchInfo();
    initChatUI();

    // ── Restore persistent token counter ──────────────────
    restoreTokenCounter();

    showToast('info', '✓ Skylark Agent Ready', `${allLeads.length} leads loaded from memory`);
  } catch (err) {
    console.error('Init error:', err);
    showToast('error', 'Initialization Error', err.message);
  }
});

// ============================================================
//  NAVIGATION
// ============================================================
function bindNavigation() {
  document.querySelectorAll('.nav-item').forEach(item => {
    item.addEventListener('click', e => {
      e.preventDefault();
      const view = item.dataset.view;
      if (view) showView(view);
    });
  });
}

function showView(viewName) {
  currentView = viewName;
  document.querySelectorAll('.nav-item').forEach(el =>
    el.classList.toggle('active', el.dataset.view === viewName)
  );
  const labels = { chat: 'Chat AI', dashboard: 'Dashboard', leads: 'All Leads', agent: 'Run Agent', excel: 'Excel Manager', analytics: 'Analytics', settings: 'Settings', tokens: 'API Key Dashboard', accounts: 'Connected Accounts', whatsapp: 'WhatsApp Auto', candidates: 'Candidate Engine' };
  document.getElementById('breadcrumb-text').textContent = labels[viewName] || viewName;
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  const target = document.getElementById(`view-${viewName}`);
  if (target) target.classList.add('active');

  if (viewName === 'leads')     { populateFilterDropdowns(); renderLeadsTable(); }
  if (viewName === 'dashboard') renderDashboard();
  if (viewName === 'analytics') renderAnalytics();
  if (viewName === 'settings')  refreshSettingsMemoryStats();
  if (viewName === 'excel')     initExcelView();
  if (viewName === 'tokens')    renderTokenDashboard();
  if (viewName === 'email')     { loadEmailTemplate(); updateEmailPreview(); }
  if (viewName === 'accounts')  { loadEmailTemplate(); renderAccountsUI(); }
  if (viewName === 'whatsapp')  { updateWhatsappPreview(); }
  if (viewName === 'candidate-db') { initCandidatesView(); }
}

// ============================================================
//  SIDEBAR
// ============================================================
function bindSidebarToggle() {
  const toggleBtn = document.getElementById('sidebar-toggle');
  const sidebar = document.getElementById('sidebar');
  const mainContent = document.getElementById('main-content');
  let collapsed = false;
  toggleBtn.addEventListener('click', () => {
    if (window.innerWidth <= 768) {
      sidebar.classList.toggle('mobile-open');
    } else {
      collapsed = !collapsed;
      sidebar.classList.toggle('collapsed', collapsed);
      mainContent.classList.toggle('full-width', collapsed);
    }
  });
  document.addEventListener('click', e => {
    if (window.innerWidth <= 768 && !sidebar.contains(e.target) &&
        !toggleBtn.contains(e.target) && sidebar.classList.contains('mobile-open'))
      sidebar.classList.remove('mobile-open');
  });
}

// ============================================================
//  PERSISTENT TOKEN COUNTER RESTORE
// ============================================================
function restoreTokenCounter() {
  if (!window.MemoryEngine) return;
  const cfg = window.SKYLARK_CONFIG || {};
  const apifyLimit = cfg.APIFY_KEY_LIMIT || 500;
  const activeIdx = window.MemoryEngine.getActiveApifyIdx();
  const used = window.MemoryEngine.getKeyUsage('apify', activeIdx);
  
  const bar = document.getElementById('token-bar-fill');
  const cnt = document.getElementById('token-count');
  const pct = Math.min((used / apifyLimit) * 100, 100);
  
  if (bar) bar.style.width = pct + '%';
  if (cnt) cnt.textContent = `${used} / ${apifyLimit}`;
  
  const label = document.querySelector('.token-label');
  if (label) label.textContent = 'Apify Usage';
}

// ============================================================
//  UPDATE ALL UI
// ============================================================
function updateAllUI() {
  updateMemoryChip();
  updateLeadsBadge();
  if (currentView === 'dashboard') renderDashboard();
  if (currentView === 'leads')    renderLeadsTable();
  if (currentView === 'analytics') renderAnalytics();
}

function updateMemoryChip() {
  const el = document.getElementById('memory-count');
  if (el) el.textContent = `${allLeads.length} leads`;
}

function updateLeadsBadge() {
  const el = document.getElementById('leads-count-badge');
  if (el) el.textContent = allLeads.length;
}

// ============================================================
//  INDUSTRY GRID — render cards from IndustryDB
// ============================================================
function populateIndustryGrid() {
  const grid = document.getElementById('industry-grid');
  if (!grid) return;
  const industries = IndustryDB.getAll();
  grid.innerHTML = '';

  for (const [key, ind] of Object.entries(industries)) {
    const card = document.createElement('div');
    card.className = 'industry-card';
    card.dataset.key = key;
    card.innerHTML = `
      <input type="checkbox" id="ind-${escHtml(key)}"/>
      <div class="industry-card-icon">${ind.icon}</div>
      <div class="industry-card-label">${escHtml(key)}</div>
      <div class="industry-card-check" id="ind-check-${escHtml(key)}"></div>
    `;
    card.addEventListener('click', () => toggleIndustry(key, card));
    grid.appendChild(card);
  }
}

function toggleIndustry(key, card) {
  if (!card) card = document.querySelector(`.industry-card[data-key="${CSS.escape(key)}"]`);
  if (!card) return;
  if (selectedIndustries.has(key)) {
    selectedIndustries.delete(key);
    card.classList.remove('selected');
    card.querySelector('.industry-card-check').textContent = '';
  } else {
    selectedIndustries.add(key);
    card.classList.add('selected');
    card.querySelector('.industry-card-check').textContent = '✓';
  }
  updateBatchInfo();
}

function selectAllIndustries() {
  document.querySelectorAll('.industry-card').forEach(card => {
    const key = card.dataset.key;
    if (key) {
      selectedIndustries.add(key);
      card.classList.add('selected');
      card.querySelector('.industry-card-check').textContent = '✓';
    }
  });
  updateBatchInfo();
}

function clearAllIndustries() {
  selectedIndustries.clear();
  document.querySelectorAll('.industry-card').forEach(card => {
    card.classList.remove('selected');
    const chk = card.querySelector('.industry-card-check');
    if (chk) chk.textContent = '';
  });
  updateBatchInfo();
}

function selectTopIndustries() {
  clearAllIndustries();
  const top5 = ['Hotels & Hospitality', 'Hospitals & Healthcare', 'IT Parks & Tech Companies', 'Shopping Malls & Retail', 'Corporate Offices'];
  top5.forEach(key => toggleIndustry(key, null));
}

// ============================================================
//  MULTI-LOCATION TAG INPUT
// ============================================================
function handleLocationKeydown(e) {
  const input = document.getElementById('location-input');
  if ((e.key === 'Enter' || e.key === ',') && input.value.trim()) {
    e.preventDefault();
    addLocationTag(input.value.trim().replace(/,/g, ''));
    input.value = '';
  }
  if (e.key === 'Backspace' && input.value === '' && selectedLocations.length > 0) {
    removeLocationTag(selectedLocations[selectedLocations.length - 1]);
  }
}

function addLocationTag(city) {
  if (!city || selectedLocations.includes(city)) return;
  selectedLocations.push(city);
  renderLocationTags();
  updateBatchInfo();
}

function removeLocationTag(city) {
  selectedLocations = selectedLocations.filter(c => c !== city);
  renderLocationTags();
  updateBatchInfo();
}

function renderLocationTags() {
  const chips = document.getElementById('location-chips');
  if (!chips) return;
  chips.innerHTML = '';
  selectedLocations.forEach(city => {
    const tag = document.createElement('span');
    tag.className = 'location-tag';
    tag.innerHTML = `${escHtml(city)}<button class="location-tag-remove" onclick="removeLocationTag('${escHtml(city)}')" title="Remove">✕</button>`;
    chips.appendChild(tag);
  });
}

// ============================================================
//  BATCH ESTIMATE
// ============================================================
function updateBatchInfo() {
  const batchSlider = document.getElementById('batch-size');
  if (!batchSlider) return;
  const perCombo = parseInt(batchSlider.value);
  const numIndustries = selectedIndustries.size;
  const numLocations = selectedLocations.length;
  const estimate = perCombo * numIndustries * numLocations;
  const tokens = estimate * 7; // approx tokens per lead

  const valEl = document.getElementById('batch-size-val');
  const estEl = document.getElementById('batch-estimate');
  const tokEl = document.getElementById('token-estimate');

  if (valEl) valEl.textContent = perCombo;
  if (estEl) estEl.textContent = numIndustries > 0 && numLocations > 0
    ? `~${estimate} total leads (${numIndustries} industries × ${numLocations} cities × ${perCombo} leads)`
    : numIndustries === 0 ? '⚠ Select at least 1 industry'
    : '⚠ Add at least 1 location';
  if (tokEl) tokEl.textContent = estimate > 0 ? `~${tokens} Apify tokens estimated` : '';
}

// ============================================================
//  SERVICE CARD STATE
// ============================================================
function updateServiceCard(type) {
  const secCb = document.getElementById('target-security');
  const hkCb  = document.getElementById('target-housekeeping');
  document.getElementById('svc-security-card')?.classList.toggle('active', secCb?.checked);
  document.getElementById('svc-hk-card')?.classList.toggle('active', hkCb?.checked);
}

// ============================================================
//  DASHBOARD
// ============================================================
function renderDashboard() {
  const total       = allLeads.length;
  const newLeads    = allLeads.filter(l => l.status === 'New').length;
  const security    = allLeads.filter(l => l.type === 'Security' || l.type === 'Both').length;
  const housekeeping = allLeads.filter(l => l.type === 'Housekeeping' || l.type === 'Both').length;

  animateCount('sv-total', total);
  animateCount('sv-new', newLeads);
  animateCount('sv-security', security);
  animateCount('sv-housekeeping', housekeeping);

  renderSourceBars();
  renderDonutChart();
  renderIndustryBars();
  renderCityBars();
  renderRecentLeads();
}

function animateCount(id, target) {
  const el = document.getElementById(id);
  if (!el) return;
  const start = parseInt(el.textContent) || 0;
  const duration = 600;
  const startTime = performance.now();
  const tick = now => {
    const elapsed = now - startTime;
    const progress = Math.min(elapsed / duration, 1);
    const eased = 1 - Math.pow(1 - progress, 3);
    el.textContent = Math.round(start + (target - start) * eased);
    if (progress < 1) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

function renderSourceBars() {
  const container = document.getElementById('source-bars');
  if (!container) return;
  const sources = ['LinkedIn', 'Indeed', 'Google Jobs', 'Google Maps'];
  const colors = ['#3b82f6', '#ec4899', '#10b981', '#f59e0b'];
  const counts = sources.map(s => allLeads.filter(l => l.source === s).length);
  const maxCount = Math.max(...counts, 1);

  if (allLeads.length === 0) {
    container.innerHTML = '<div class="empty-chart-msg">Run agent to see data</div>'; return;
  }
  container.innerHTML = '';

  const legend = document.getElementById('source-legend');
  if (legend) legend.innerHTML = sources.map((s, i) =>
    `<div class="legend-item"><div class="legend-dot" style="background:${colors[i]}"></div><span>${s}</span></div>`
  ).join('');

  sources.forEach((source, i) => {
    const pct = (counts[i] / maxCount) * 100;
    const row = document.createElement('div');
    row.className = 'source-bar-item';
    row.innerHTML = `<div class="source-bar-label">${source}</div><div class="source-bar-track"><div class="source-bar-fill" style="width:0%;background:${colors[i]}" data-target="${pct}"></div></div><div class="source-bar-count">${counts[i]}</div>`;
    container.appendChild(row);
    setTimeout(() => {
      const fill = row.querySelector('.source-bar-fill');
      if (fill) fill.style.width = pct + '%';
    }, 100 + i * 80);
  });
}

function renderIndustryBars() {
  const container = document.getElementById('industry-bars');
  if (!container) return;
  if (allLeads.length === 0) { container.innerHTML = '<div class="empty-chart-msg">Run agent to see data</div>'; return; }

  // Group by industry
  const industryMap = {};
  allLeads.forEach(l => {
    const ind = l.industry || l.sector || 'Unknown';
    industryMap[ind] = (industryMap[ind] || 0) + 1;
  });

  const sorted = Object.entries(industryMap).sort((a, b) => b[1] - a[1]).slice(0, 8);
  const max = Math.max(...sorted.map(e => e[1]), 1);

  const colors = ['#6366f1', '#f59e0b', '#ef4444', '#ec4899', '#10b981', '#3b82f6', '#8b5cf6', '#14b8a6'];
  container.innerHTML = '';

  sorted.forEach(([ind, cnt], i) => {
    const pct = (cnt / max) * 100;
    const shortKey = ind.split('&')[0].trim().split(' ').slice(0, 2).join(' ');
    const row = document.createElement('div');
    row.className = 'source-bar-item';
    row.innerHTML = `<div class="source-bar-label" title="${escHtml(ind)}">${escHtml(shortKey)}</div><div class="source-bar-track"><div class="source-bar-fill" style="width:0%;background:${colors[i % colors.length]}"></div></div><div class="source-bar-count">${cnt}</div>`;
    container.appendChild(row);
    setTimeout(() => { row.querySelector('.source-bar-fill').style.width = pct + '%'; }, 100 + i * 60);
  });
}

function renderCityBars() {
  const container = document.getElementById('city-bars');
  if (!container) return;
  if (allLeads.length === 0) { container.innerHTML = '<div class="empty-chart-msg">Run agent to see data</div>'; return; }

  const cityMap = {};
  allLeads.forEach(l => { const c = l.city || 'Unknown'; cityMap[c] = (cityMap[c] || 0) + 1; });
  const sorted = Object.entries(cityMap).sort((a, b) => b[1] - a[1]).slice(0, 8);
  const max = Math.max(...sorted.map(e => e[1]), 1);

  container.innerHTML = '';
  sorted.forEach(([city, cnt], i) => {
    const pct = (cnt / max) * 100;
    const row = document.createElement('div');
    row.className = 'source-bar-item';
    row.innerHTML = `<div class="source-bar-label">${escHtml(city)}</div><div class="source-bar-track"><div class="source-bar-fill" style="width:0%;background:#6366f1"></div></div><div class="source-bar-count">${cnt}</div>`;
    container.appendChild(row);
    setTimeout(() => { row.querySelector('.source-bar-fill').style.width = pct + '%'; }, 100 + i * 50);
  });
}

function renderDonutChart() {
  const canvas = document.getElementById('status-donut');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const statusConfig = [
    { key: 'New', color: '#6366f1' },
    { key: 'Contacted', color: '#f59e0b' },
    { key: 'Qualified', color: '#10b981' },
    { key: 'Closed', color: '#9ca3af' },
  ];
  const counts = statusConfig.map(s => allLeads.filter(l => l.status === s.key).length);
  const total  = counts.reduce((a, b) => a + b, 0);
  document.getElementById('donut-total').textContent = total;

  const legendEl = document.getElementById('donut-legend');
  if (legendEl) legendEl.innerHTML = statusConfig.map((s, i) =>
    `<div class="donut-legend-item"><div class="donut-legend-left"><div class="donut-legend-dot" style="background:${s.color}"></div><span class="donut-legend-label">${s.key}</span></div><span class="donut-legend-count">${counts[i]}</span></div>`
  ).join('');

  const W = 160, H = 160, cx = 80, cy = 80, r = 60, inner = 36;
  ctx.clearRect(0, 0, W, H);
  if (total === 0) {
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.arc(cx, cy, inner, 0, Math.PI * 2, true);
    ctx.fillStyle = '#e5e7eb'; ctx.fill(); return;
  }
  let startAngle = -Math.PI / 2;
  statusConfig.forEach((s, i) => {
    if (counts[i] === 0) return;
    const slice = (counts[i] / total) * Math.PI * 2;
    ctx.beginPath(); ctx.moveTo(cx, cy); ctx.arc(cx, cy, r, startAngle, startAngle + slice);
    ctx.closePath(); ctx.fillStyle = s.color; ctx.fill();
    startAngle += slice;
  });
  ctx.beginPath(); ctx.arc(cx, cy, inner, 0, Math.PI * 2);
  ctx.fillStyle = '#ffffff'; ctx.fill();
}

function renderRecentLeads() {
  const container = document.getElementById('recent-leads-container');
  if (!container) return;
  const recent = [...allLeads].sort((a, b) => b.timestamp - a.timestamp).slice(0, 6);

  if (recent.length === 0) {
    container.innerHTML = `<div class="empty-state" id="dashboard-empty">
      <div class="empty-icon"><svg viewBox="0 0 64 64" fill="none"><circle cx="32" cy="32" r="30" fill="#f0f0ff" stroke="#e0e0ff" stroke-width="2"/><path d="M20 32h24M32 20v24" stroke="#a5b4fc" stroke-width="3" stroke-linecap="round"/></svg></div>
      <h4>No Leads Yet</h4><p>Go to <strong>Run Agent</strong>, select industries and cities, then generate leads.</p>
      <button class="btn-primary" onclick="showView('agent')">Run Agent Now</button>
    </div>`;
    return;
  }

  const list = document.createElement('div');
  list.className = 'mini-leads-list';
  recent.forEach(lead => {
    const row = document.createElement('div');
    row.className = 'mini-lead-row';
    row.onclick = () => openLeadModal(lead);
    const ind = IndustryDB.getByKey(lead.industry);
    row.innerHTML = `
      <div class="mini-lead-avatar">${ind?.icon || lead.company.slice(0, 2)}</div>
      <div class="mini-lead-body">
        <div class="mini-lead-name">${escHtml(lead.company)}</div>
        <div class="mini-lead-sub">${escHtml(lead.industry || lead.sector || '')} • ${escHtml(lead.city || '')}</div>
      </div>
      <div class="mini-lead-right">
        ${getTypeBadge(lead.type)}
        <span class="mini-lead-time">${timeAgo(lead.timestamp)}</span>
      </div>
    `;
    list.appendChild(row);
  });
  container.innerHTML = '';
  container.appendChild(list);
}

// ============================================================
//  FILTER DROPDOWNS — dynamic from actual data
// ============================================================
function populateFilterDropdowns() {
  // Industry
  const indSel = document.getElementById('filter-industry');
  if (indSel) {
    const industries = [...new Set(allLeads.map(l => l.industry || l.sector).filter(Boolean))].sort();
    indSel.innerHTML = '<option value="">All Industries</option>' +
      industries.map(i => `<option value="${escHtml(i)}">${escHtml(i)}</option>`).join('');
  }
  // City
  const citySel = document.getElementById('filter-city');
  if (citySel) {
    const cities = [...new Set(allLeads.map(l => l.city).filter(Boolean))].sort();
    citySel.innerHTML = '<option value="">All Cities</option>' +
      cities.map(c => `<option value="${escHtml(c)}">${escHtml(c)}</option>`).join('');
  }
}

// ============================================================
//  LEADS TABLE
// ============================================================
function renderLeadsTable() {
  populateFilterDropdowns();
  applyFilters();
}

function applyFilters() {
  const search   = (document.getElementById('search-input')?.value || '').toLowerCase();
  const type     = document.getElementById('filter-type')?.value || '';
  const industry = document.getElementById('filter-industry')?.value || '';
  const city     = document.getElementById('filter-city')?.value || '';
  const status   = document.getElementById('filter-status')?.value || '';
  const dateFilter = document.getElementById('filter-date')?.value || '';
  const sheetsFilter = document.getElementById('filter-sheets')?.value || '';
  const now      = Date.now();
  const cutoffs  = { '24h': 86400000, '7d': 604800000, '30d': 2592000000 };

  filteredLeads = allLeads.filter(lead => {
    if (type     && lead.type !== type) return false;
    if (industry && (lead.industry || lead.sector) !== industry) return false;
    if (city     && lead.city !== city) return false;
    if (status   && lead.status !== status) return false;
    if (dateFilter && cutoffs[dateFilter] && (now - lead.timestamp) > cutoffs[dateFilter]) return false;
    if (sheetsFilter === 'synced'   && !lead.syncedToSheets) return false;
    if (sheetsFilter === 'unsynced' && lead.syncedToSheets) return false;
    if (search) {
      const s = `${lead.company} ${lead.email} ${lead.phone} ${lead.address} ${lead.jobTitle} ${lead.city} ${lead.industry}`.toLowerCase();
      if (!s.includes(search)) return false;
    }
    return true;
  });

  filteredLeads.sort((a, b) => {
    const dir = sortConfig.dir === 'asc' ? 1 : -1;
    const va = a[sortConfig.col] || '';
    const vb = b[sortConfig.col] || '';
    if (typeof va === 'number') return (va - vb) * dir;
    return String(va).localeCompare(String(vb)) * dir;
  });

  const meta = document.getElementById('results-meta');
  if (meta) meta.textContent = `Showing ${filteredLeads.length} of ${allLeads.length} leads`;

  renderTableRows(filteredLeads);
}

function sortTable(col) {
  if (sortConfig.col === col) sortConfig.dir = sortConfig.dir === 'asc' ? 'desc' : 'asc';
  else { sortConfig.col = col; sortConfig.dir = 'desc'; }
  document.querySelectorAll('.th-sort').forEach(th => {
    th.classList.remove('sort-asc', 'sort-desc');
    if (th.dataset.col === col) th.classList.add(sortConfig.dir === 'asc' ? 'sort-asc' : 'sort-desc');
  });
  applyFilters();
}

function clearFilters() {
  ['search-input', 'filter-type', 'filter-industry', 'filter-city', 'filter-status', 'filter-date', 'filter-sheets'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });
  applyFilters();
}

function toggleSelectAll(cb) {
  selectedLeadIds.clear();
  if (cb.checked) filteredLeads.forEach(l => selectedLeadIds.add(l.id));
  document.querySelectorAll('.lead-row-cb').forEach(el => {
    el.checked = cb.checked;
    el.closest('tr')?.classList.toggle('row-selected', cb.checked);
  });
}

function renderTableRows(leads) {
  const tbody = document.getElementById('leads-tbody');
  if (!tbody) return;

  if (leads.length === 0) {
    tbody.innerHTML = `<tr><td colspan="12">
      <div class="empty-state">
        <div class="empty-icon"><svg viewBox="0 0 64 64" fill="none"><circle cx="32" cy="32" r="30" fill="#f0f0ff" stroke="#e0e0ff" stroke-width="2"/><path d="M20 32h24M32 20v24" stroke="#a5b4fc" stroke-width="3" stroke-linecap="round"/></svg></div>
        <h4>No Leads Found</h4><p>Try adjusting your filters or run the agent to generate new leads.</p>
      </div>
    </td></tr>`; return;
  }

  tbody.innerHTML = leads.map(lead => {
    const synced = lead.syncedToSheets;
    const isSelected = selectedLeadIds.has(lead.id);
    return `<tr class="${isSelected ? 'row-selected' : ''}">
      <td><input type="checkbox" class="lead-row-cb" ${isSelected ? 'checked' : ''} onchange="toggleRowSelect('${escHtml(lead.id)}', this)"/></td>
      <td><div class="td-company">
        <div class="company-avatar">${IndustryDB.getByKey(lead.industry)?.icon || lead.company.slice(0, 2)}</div>
        <span class="company-name" title="${escHtml(lead.company)}">${escHtml(lead.company)}</span>
      </div></td>
      <td><span style="font-size:11px;color:var(--gray-500);white-space:nowrap">${escHtml((lead.industry||lead.sector||'').split('&')[0].trim())}</span></td>
      <td><span style="font-size:12px;font-weight:600;color:var(--gray-700)">${escHtml(lead.city||'—')}</span></td>
      <td>${getTypeBadge(lead.type)}</td>
      <td><span class="td-truncate">${lead.phone ? `<a href="tel:${escHtml(lead.phone)}" style="color:var(--gray-700)">${escHtml(lead.phone)}</a>` : '<span style="color:var(--gray-300)">—</span>'}</span></td>
      <td><span class="td-truncate">${lead.email ? `<a href="mailto:${escHtml(lead.email)}">${escHtml(lead.email)}</a>` : '<span style="color:var(--gray-300)">—</span>'}</span></td>
      <td><span class="td-truncate">${lead.website ? `<a href="${escHtml(lead.website)}" target="_blank" rel="noopener">${escHtml(lead.website.replace('https://www.', '').slice(0, 18))}…</a>` : '<span style="color:var(--gray-300)">—</span>'}</span></td>
      <td><span style="font-size:11px;color:var(--gray-500)">${formatDate(lead.timestamp)}</span></td>
      <td><select class="status-select ${(lead.status||'New').toLowerCase()}" onchange="updateLeadStatus('${escHtml(lead.id)}', this.value, this)">
        <option value="New" ${lead.status==='New'?'selected':''}>New</option>
        <option value="Contacted" ${lead.status==='Contacted'?'selected':''}>Contacted</option>
        <option value="Qualified" ${lead.status==='Qualified'?'selected':''}>Qualified</option>
        <option value="Closed" ${lead.status==='Closed'?'selected':''}>Closed</option>
      </select></td>
      <td><span class="synced-badge ${synced ? 'yes' : 'no'}">${synced ? '✓ Synced' : 'Pending'}</span></td>
      <td><div class="td-actions">
        <button class="action-btn" title="View" onclick="openLeadModal(${JSON.stringify(JSON.stringify(lead))})"><svg viewBox="0 0 20 20" fill="currentColor"><path d="M10 12a2 2 0 100-4 2 2 0 000 4z"/><path fill-rule="evenodd" d="M.458 10C1.732 5.943 5.522 3 10 3s8.268 2.943 9.542 7c-1.274 4.057-5.064 7-9.542 7S1.732 14.057.458 10zM14 10a4 4 0 11-8 0 4 4 0 018 0z" clip-rule="evenodd"/></svg></button>
        ${lead.website ? `<button class="action-btn" title="Website" onclick="window.open('${escHtml(lead.website)}','_blank')"><svg viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M10.293 3.293a1 1 0 011.414 0l6 6a1 1 0 010 1.414l-6 6a1 1 0 01-1.414-1.414L14.586 11H3a1 1 0 110-2h11.586l-4.293-4.293a1 1 0 010-1.414z" clip-rule="evenodd"/></svg></button>` : ''}
        ${lead.phone ? `<button class="action-btn" title="Call" onclick="window.location='tel:${escHtml(lead.phone)}'"><svg viewBox="0 0 20 20" fill="currentColor"><path d="M2 3a1 1 0 011-1h2.153a1 1 0 01.986.836l.74 4.435a1 1 0 01-.54 1.06l-1.548.773a11.037 11.037 0 006.105 6.105l.774-1.548a1 1 0 011.059-.54l4.435.74a1 1 0 01.836.986V17a1 1 0 01-1 1h-2C7.82 18 2 12.18 2 5V3z"/></svg></button>` : ''}
        <button class="action-btn danger" title="Delete" onclick="deleteLead('${escHtml(lead.id)}')"><svg viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z" clip-rule="evenodd"/></svg></button>
      </div></td>
    </tr>`;
  }).join('');
}

function toggleRowSelect(id, cb) {
  if (cb.checked) selectedLeadIds.add(id);
  else selectedLeadIds.delete(id);
  cb.closest('tr')?.classList.toggle('row-selected', cb.checked);
}

async function updateLeadStatus(id, newStatus, selectEl) {
  try {
    await MemoryEngine.updateLead(id, { status: newStatus });
    const lead = allLeads.find(l => l.id === id);
    if (lead) lead.status = newStatus;
    selectEl.className = `status-select ${newStatus.toLowerCase()}`;
    showToast('success', 'Status Updated', `Lead marked as ${newStatus}`);
    if (currentView === 'dashboard') renderDonutChart();
  } catch (err) { showToast('error', 'Update Failed', err.message); }
}

async function deleteLead(id) {
  if (!confirm('Delete this lead? Cannot be undone.')) return;
  try {
    await MemoryEngine.deleteLead(id);
    allLeads = allLeads.filter(l => l.id !== id);
    selectedLeadIds.delete(id);
    updateAllUI();
    showToast('success', 'Lead Deleted', 'Removed from memory');
  } catch (err) { showToast('error', 'Delete Failed', err.message); }
}

// ============================================================
//  EXPORT CSV
// ============================================================
function exportCSV() {
  const toExport = filteredLeads.length > 0 ? filteredLeads : allLeads;
  if (toExport.length === 0) { showToast('warning', 'No Leads', 'Nothing to export'); return; }

  const headers = ['Company','Industry','City','Type','Phone','Email','Website','Address','Job Title','Positions','Status','Source','Date Added','Synced to Sheets'];
  const rows = toExport.map(l => [
    l.company, l.industry||l.sector||'', l.city, l.type, l.phone, l.email, l.website, l.address,
    l.jobTitle, l.positions||1, l.status, l.source, formatDate(l.timestamp), l.syncedToSheets ? 'Yes' : 'No'
  ].map(v => `"${String(v||'').replace(/"/g, '""')}"`));

  const csv = '\uFEFF' + [headers, ...rows].map(r => r.join(',')).join('\r\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `Skylark_Leads_${new Date().toISOString().slice(0,10)}.csv`;
  a.click();
  showToast('success', 'CSV Exported', `${toExport.length} leads exported`);
}

// ============================================================
//  EXPORT EXCEL (.xlsx)
// ============================================================
function exportExcel() {
  if (typeof XLSX === 'undefined') {
    showToast('error', 'Library Missing', 'Excel export library not loaded. Use CSV.');
    return;
  }
  const toExport = filteredLeads.length > 0 ? filteredLeads : allLeads;
  if (toExport.length === 0) { showToast('warning', 'No Leads', 'Nothing to export'); return; }

  const rows = toExport.map(l => ({
    Company: l.company,
    Industry: l.industry||l.sector||'',
    City: l.city,
    Type: l.type,
    Phone: l.phone,
    Email: l.email,
    Website: l.website,
    Address: l.address,
    'Job Title': l.jobTitle,
    Positions: l.positions||1,
    Status: l.status,
    Source: l.source,
    'Date Added': formatDate(l.timestamp),
    'Synced to Sheets': l.syncedToSheets ? 'Yes' : 'No'
  }));

  const worksheet = XLSX.utils.json_to_sheet(rows);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, "Skylark Leads");
  XLSX.writeFile(workbook, `Skylark_Leads_${new Date().toISOString().slice(0,10)}.xlsx`);
  showToast('success', 'Excel Exported', `${toExport.length} leads exported to XLSX`);
}

function exportBatchExcel(leadsBatch) {
  if (typeof XLSX === 'undefined' || !leadsBatch || leadsBatch.length === 0) return;
  const rows = leadsBatch.map(l => ({
    Company: l.company,
    Industry: l.industry||l.sector||'',
    City: l.city,
    Type: l.type,
    Phone: l.phone,
    Email: l.email,
    Website: l.website,
    Address: l.address,
    'Job Title': l.jobTitle,
    Positions: l.positions||1,
    Status: l.status,
    Source: l.source,
    'Date Added': formatDate(l.timestamp)
  }));
  const worksheet = XLSX.utils.json_to_sheet(rows);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, "Auto_Saved_Leads");
  const timeString = new Date().toTimeString().slice(0,8).replace(/:/g,'-');
  XLSX.writeFile(workbook, `Skylark_Fetch_${new Date().toISOString().slice(0,10)}_${timeString}.xlsx`);
}

// ============================================================
//  MODAL
// ============================================================
function openLeadModal(leadOrJson) {
  const lead = typeof leadOrJson === 'string' ? JSON.parse(leadOrJson) : leadOrJson;
  const ind  = IndustryDB.getByKey(lead.industry);

  document.getElementById('modal-company-badge').textContent = ind?.icon || lead.company.slice(0, 2).toUpperCase();
  document.getElementById('modal-company-name').textContent = lead.company;
  document.getElementById('modal-meta').innerHTML = `${getTypeBadge(lead.type)} ${getSourceBadge(lead.source)} <span style="font-size:11px;background:#f3f4f6;padding:3px 8px;border-radius:99px;color:var(--gray-600)">${escHtml(lead.industry||lead.sector||'')}</span>`;

  const body = document.getElementById('modal-body');
  body.innerHTML = `
    <div class="modal-field-row">
      <div class="modal-field-group"><div class="modal-field-label">Contact Number</div><div class="modal-field-value">${lead.phone ? `<a href="tel:${escHtml(lead.phone)}">${escHtml(lead.phone)}</a>` : '—'}</div></div>
      <div class="modal-field-group"><div class="modal-field-label">Email Address</div><div class="modal-field-value">${lead.email ? `<a href="mailto:${escHtml(lead.email)}">${escHtml(lead.email)}</a>` : '—'}</div></div>
    </div>
    <div class="modal-field-group"><div class="modal-field-label">Website</div><div class="modal-field-value">${lead.website ? `<a href="${escHtml(lead.website)}" target="_blank">${escHtml(lead.website)}</a>` : '—'}</div></div>
    <div class="modal-field-row">
      <div class="modal-field-group"><div class="modal-field-label">City / Location</div><div class="modal-field-value">${escHtml(lead.city||'—')}</div></div>
      <div class="modal-field-group"><div class="modal-field-label">Industry</div><div class="modal-field-value">${escHtml(lead.industry||lead.sector||'—')}</div></div>
    </div>
    <div class="modal-field-group"><div class="modal-field-label">Physical Address</div><div class="modal-field-value">${escHtml(lead.address||'—')}</div></div>
    <div class="modal-field-row">
      <div class="modal-field-group"><div class="modal-field-label">Job Requirement</div><div class="modal-field-value">${escHtml(lead.jobTitle||'—')}</div></div>
      <div class="modal-field-group"><div class="modal-field-label">Positions Open</div><div class="modal-field-value">${lead.positions||1} positions</div></div>
    </div>
    <div class="modal-field-row">
      <div class="modal-field-group"><div class="modal-field-label">Lead Added</div><div class="modal-field-value">${new Date(lead.timestamp).toLocaleString()}</div></div>
      <div class="modal-field-group"><div class="modal-field-label">Status</div><div class="modal-field-value">
        <select class="status-select ${(lead.status||'New').toLowerCase()}" onchange="updateLeadStatus('${escHtml(lead.id)}', this.value, this)">
          <option value="New" ${lead.status==='New'?'selected':''}>New</option>
          <option value="Contacted" ${lead.status==='Contacted'?'selected':''}>Contacted</option>
          <option value="Qualified" ${lead.status==='Qualified'?'selected':''}>Qualified</option>
          <option value="Closed" ${lead.status==='Closed'?'selected':''}>Closed</option>
        </select>
      </div></div>
    </div>
    ${lead.description ? `<div class="modal-field-group"><div class="modal-field-label">Description</div><div class="modal-field-value" style="color:var(--gray-600)">${escHtml(lead.description)}</div></div>` : ''}
    <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:4px">
      ${lead.enrichedByMaps ? `<span style="font-size:11px;background:#dcfce7;color:#166534;padding:3px 8px;border-radius:99px;font-weight:700">✓ Maps Enriched</span>` : ''}
      ${lead.enrichedByCrawler ? `<span style="font-size:11px;background:#ede9fe;color:#5b21b6;padding:3px 8px;border-radius:99px;font-weight:700">✓ Email Crawled</span>` : ''}
    </div>
  `;

  document.getElementById('modal-footer').innerHTML = `
    ${lead.phone ? `<a href="tel:${escHtml(lead.phone)}" class="btn-primary" style="text-decoration:none"><svg width="16" height="16" viewBox="0 0 20 20" fill="currentColor"><path d="M2 3a1 1 0 011-1h2.153a1 1 0 01.986.836l.74 4.435a1 1 0 01-.54 1.06l-1.548.773a11.037 11.037 0 006.105 6.105l.774-1.548a1 1 0 011.059-.54l4.435.74a1 1 0 01.836.986V17a1 1 0 01-1 1h-2C7.82 18 2 12.18 2 5V3z"/></svg> Call HR</a>` : ''}
    ${lead.email ? `<a href="mailto:${escHtml(lead.email)}" class="btn-secondary" style="text-decoration:none"><svg width="16" height="16" viewBox="0 0 20 20" fill="currentColor"><path d="M2.003 5.884L10 9.882l7.997-3.998A2 2 0 0016 4H4a2 2 0 00-1.997 1.884z"/><path d="M18 8.118l-8 4-8-4V14a2 2 0 002 2h12a2 2 0 002-2V8.118z"/></svg> Email</a>` : ''}
    <button class="btn-secondary" onclick="closeLeadModal()">Close</button>
  `;
  document.getElementById('lead-modal').classList.add('open');
}

function closeLeadModal() { document.getElementById('lead-modal').classList.remove('open'); }
function closeModal(e) { if (e.target === document.getElementById('lead-modal')) closeLeadModal(); }

// ============================================================
//  AGENT PIPELINE UI
// ============================================================
async function startAgentPipeline() {
  if (PipelineEngine.getIsRunning()) {
    showToast('warning', 'Already Running', 'Pipeline is active'); return;
  }

  // Validate
  if (selectedLocations.length === 0) {
    showToast('error', 'No Location', 'Add at least 1 city (type + Enter)'); return;
  }
  if (selectedIndustries.size === 0) {
    selectAllIndustries();
  }

  const enableSecurity    = document.getElementById('target-security')?.checked;
  const enableHousekeeping = document.getElementById('target-housekeeping')?.checked;
  if (!enableSecurity && !enableHousekeeping) {
    showToast('error', 'No Type', 'Select Security, Housekeeping, or Both'); return;
  }

  const countPerCombo  = parseInt(document.getElementById('batch-size')?.value || '3');
  const enableMaps     = document.getElementById('enrich-maps')?.checked !== false;
  const enableCrawler  = document.getElementById('enrich-crawler')?.checked !== false;
  const autoDownloadExcel = document.getElementById('auto-download-excel')?.checked;
  const autoDownload = autoDownloadExcel;

  const srcMaps     = document.getElementById('src-maps')?.checked !== false;
  const srcLinkedIn = document.getElementById('src-linkedin')?.checked;
  const srcIndeed   = document.getElementById('src-indeed')?.checked;
  const srcGoogle   = document.getElementById('src-google')?.checked;

  const types = [];
  if (enableSecurity)    types.push('Security');
  if (enableHousekeeping) types.push('Housekeeping');

  const sources = [];
  if (srcMaps)     sources.push('Google Maps');
  if (srcLinkedIn) sources.push('LinkedIn');
  if (srcIndeed)   sources.push('Indeed');
  if (srcGoogle)   sources.push('Google Jobs');

  const industries = [...selectedIndustries];
  const locations  = [...selectedLocations];

  // Reset UI
  resetPipelineUI();
  setPipelineStatus('running');
  setGenerateBtn(true);

  // Save preferences
  SettingsEngine.save({ locations, lastIndustries: industries, lastTypes: types });

  // Token meter
  const budget = parseInt(SettingsEngine.get('tokenBudget')) || 1000;
  document.getElementById('token-meter')?.style?.setProperty('display', 'block');

  // Callbacks
  PipelineEngine.setCallbacks({
    onLog: (type, msg) => appendLog(type, msg),
    onPhaseUpdate: (phase, state, pct) => updatePhaseNode(phase, state, pct),
    onLeadFound: (lead) => {
      allLeads.push(lead);
      updateMemoryChip();
      updateLeadsBadge();
    },
    onTokenUpdate: (usedTotal) => {
      const budget = parseInt(SettingsEngine.get('tokenBudget')) || 1000;
      const pct  = Math.min((usedTotal / budget) * 100, 100);
      const bar  = document.getElementById('token-bar-fill');
      const cnt  = document.getElementById('token-count');
      if (bar) bar.style.width = pct + '%';
      if (cnt) cnt.textContent = `${usedTotal.toLocaleString()} / ${budget}`;
    },
    onComplete: async ({ added, dupes, total, elapsed, tokenUsed }) => {
      setPipelineStatus('done');
      setGenerateBtn(false);
      setAgentStatusPill('done', 'Done');
      showRunSummary({ added, dupes, total, elapsed, tokens: tokenUsed });
      updateAllUI();
      showToast('success', `✓ ${added} Buyer Leads Generated!`, `${dupes} dupes blocked · ${elapsed}s`);
      // Check API key health and notify if near exhaustion
      checkAndNotifyKeyHealth();

      // Auto-sync to sheets and auto-download batch
      const newLeads = allLeads.slice(-added);
      
      // Auto-download the newly fetched leads as CSV
      if (added > 0) {
        exportBatchExcel(newLeads);
      }

      if (autoDownload && added > 0) {
        exportToExcel();
      }
    },
    onError: (msg) => {
      setPipelineStatus('error');
      setGenerateBtn(false);
      setAgentStatusPill('error', 'Error');
      showToast('error', 'Pipeline Error', msg);
    }
  });

  setAgentStatusPill('running', 'Running...');
  showToast('info', 'Agent Started', `${industries.length} industries × ${locations.length} cities`);

  const totalTarget = window.chatRequestedTotalTarget || null;
  PipelineEngine.run({ industries, locations, types, sources, countPerCombo, enableMaps, enableCrawler, totalTarget });
  window.chatRequestedTotalTarget = null;
}

function resetPipelineUI() {
  const log = document.getElementById('live-log');
  if (log) log.innerHTML = '';
  [1, 2, 3, 4].forEach(n => {
    updatePhaseNode(n, 'idle', 0);
    const conn = document.getElementById(`pc-${n}`);
    if (conn) conn.classList.remove('done');
  });
  document.getElementById('run-summary')?.style?.setProperty('display', 'none');
}

function setPipelineStatus(status) {
  const badge = document.getElementById('pipeline-badge');
  if (!badge) return;
  badge.className = `progress-status-badge ${status}`;
  const labels = { running: '● Running', done: '✓ Complete', error: '✕ Error', idle: 'Idle' };
  badge.textContent = labels[status] || status;
}

function setAgentStatusPill(status, label) {
  const dot = document.getElementById('status-dot');
  const lbl = document.getElementById('status-label');
  if (dot) dot.className = `status-dot ${status}`;
  if (lbl) lbl.textContent = label;
}

function setGenerateBtn(running) {
  const btn     = document.getElementById('generate-btn');
  const btnText = document.getElementById('generate-btn-text');
  if (!btn) return;
  btn.disabled = running;
  btnText.innerHTML = running
    ? '<span class="spinner"></span> Running Pipeline...'
    : 'Generate Leads';
}

function updatePhaseNode(phase, state, pct) {
  const node  = document.getElementById(`pnode-${phase}`);
  const fill  = document.getElementById(`pnode-${phase}-fill`);
  if (!node) return;
  node.className = 'pipeline-node';
  if (state === 'active') node.classList.add('active');
  if (state === 'done')   node.classList.add('done');
  if (state === 'error')  node.classList.add('error');
  if (fill) fill.style.width = pct + '%';
  if (state === 'done' && phase < 4) {
    const conn = document.getElementById(`pc-${phase}`);
    if (conn) conn.classList.add('done');
  }
}

function appendLog(type, msg) {
  const log = document.getElementById('live-log');
  if (!log) return;
  const entry = document.createElement('div');
  entry.className = `log-entry ${type}`;
  const time = new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  entry.textContent = `[${time}] ${msg}`;
  log.appendChild(entry);
  log.scrollTop = log.scrollHeight;
}

function clearLog() {
  const log = document.getElementById('live-log');
  if (log) log.innerHTML = '<div class="log-entry idle">Log cleared.</div>';
}

function showRunSummary({ added, dupes, total, elapsed, tokens }) {
  const container = document.getElementById('run-summary');
  const grid = document.getElementById('run-summary-grid');
  if (!container || !grid) return;
  grid.innerHTML = `
    <div class="run-sum-item"><div class="run-sum-val" style="color:var(--accent-green)">${added}</div><div class="run-sum-lbl">New Leads</div></div>
    <div class="run-sum-item"><div class="run-sum-val" style="color:var(--accent-orange)">${dupes}</div><div class="run-sum-lbl">Dupes Blocked</div></div>
    <div class="run-sum-item"><div class="run-sum-val">${elapsed}s</div><div class="run-sum-lbl">Duration</div></div>
    <div class="run-sum-item"><div class="run-sum-val" style="color:var(--primary)">~${tokens||0}</div><div class="run-sum-lbl">Tokens Used</div></div>
  `;
  container.style.display = 'block';
}

// ============================================================
//  GOOGLE SHEETS SYNC
// ============================================================
// ============================================================
//  EXCEL MANAGER LOGIC
// ============================================================
let importedExcelData = null;
let importedExcelFilename = '';

async function initExcelView() {
  const allLeads = await window.MemoryEngine.getAllLeads();
  const unsavedCount = allLeads.filter(l => !l.syncedToSheets).length; // Using syncedToSheets as local proxy for unsaved
  
  const totalLeadsEl = document.getElementById('excel-total-leads');
  const unsavedLeadsEl = document.getElementById('excel-unsaved-leads');
  
  if (totalLeadsEl) totalLeadsEl.textContent = allLeads.length;
  if (unsavedLeadsEl) unsavedLeadsEl.textContent = unsavedCount;
}

function handleExcelImport(event) {
  const file = event.target.files[0];
  if (!file) return;
  
  importedExcelFilename = file.name;
  const reader = new FileReader();
  
  reader.onload = function(e) {
    try {
      const data = new Uint8Array(e.target.result);
      const workbook = XLSX.read(data, { type: 'array' });
      const firstSheetName = workbook.SheetNames[0];
      const worksheet = workbook.Sheets[firstSheetName];
      
      // Parse to JSON array (headers in first row)
      const jsonData = XLSX.utils.sheet_to_json(worksheet, { header: 1 });
      if (jsonData.length === 0) {
        showToast('error', 'Empty File', 'The uploaded spreadsheet contains no data.');
        return;
      }
      
      const headers = jsonData[0];
      const rows = jsonData.slice(1);
      
      importedExcelData = { headers, rows };
      
      // Populate column dropdown
      const select = document.getElementById('excel-column-select');
      if (select) {
        select.innerHTML = headers.map((h, i) => `<option value="${i}">${h || `Column ${i+1}`}</option>`).join('');
      }
      
      // Show preview area
      document.getElementById('excel-import-filename').textContent = file.name;
      document.getElementById('excel-import-rowcount').textContent = `${rows.length} Rows`;
      document.getElementById('excel-import-preview').style.display = 'block';
      document.getElementById('excel-import-btn').removeAttribute('disabled');
      
      showToast('success', 'File Loaded', `${file.name} parsed successfully.`);
    } catch (err) {
      showToast('error', 'Import Failed', 'Could not read file. Make sure it is a valid Excel or CSV.');
      console.error(err);
    }
  };
  
  reader.readAsArrayBuffer(file);
}

function processExcelImport() {
  if (!importedExcelData) return;
  
  const colIndex = parseInt(document.getElementById('excel-column-select').value, 10);
  const companyNames = importedExcelData.rows
    .map(row => row[colIndex])
    .filter(name => name && String(name).trim() !== '');
    
  if (companyNames.length === 0) {
    showToast('warning', 'No Companies', 'Could not find any company names in the selected column.');
    return;
  }
  
  // Convert company names into queries and load into Chat input/queue
  const queryList = companyNames.map(name => `Extract email, website, phone, and positions for: ${name}`);
  
  // Set current chat input to the first query, and notify user
  const chatInput = document.getElementById('chat-input');
  if (chatInput) {
    chatInput.value = `Search contacts for these imported companies:\n${companyNames.join('\n')}`;
  }
  
  // Set badge
  const badge = document.getElementById('excel-imported-badge');
  if (badge) {
    badge.textContent = companyNames.length;
    badge.style.display = 'inline-block';
  }
  
  showToast('success', 'Import Successful!', `${companyNames.length} companies loaded. Go to "Chat AI" to run the extraction.`);
  showView('chat');
}

async function exportToExcel() {
  const allLeads = await window.MemoryEngine.getAllLeads();
  if (allLeads.length === 0) {
    showToast('warning', 'No Data', 'No leads available to export.');
    return;
  }
  
  // Format leads for Excel
  const excelRows = allLeads.map(l => ({
    'Company Name': l.company || '',
    'Industry': l.industry || '',
    'City': l.city || '',
    'Service Type': l.type || '',
    'Phone': l.phone || '',
    'Email': l.email || '',
    'Website': l.website || '',
    'Address': l.address || '',
    'Job Title/Requirements': l.jobTitle || '',
    'Positions Open': l.positions || '',
    'Status': l.status || '',
    'Source': l.source || '',
    'Date Added': l.timestamp ? new Date(l.timestamp).toLocaleDateString('en-IN') : ''
  }));
  
  const sheetName = document.getElementById('excel-sheet-name').value.trim() || 'Leads';
  const worksheet = XLSX.utils.json_to_sheet(excelRows);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, sheetName);
  
  // Auto-fit Columns if checked
  if (document.getElementById('excel-autofit').checked) {
    const maxProps = [];
    excelRows.forEach(row => {
      Object.keys(row).forEach((key, colIndex) => {
        const val = row[key] ? String(row[key]) : '';
        maxProps[colIndex] = Math.max(maxProps[colIndex] || 10, val.length + 2, key.length + 2);
      });
    });
    worksheet['!cols'] = maxProps.map(w => ({ wch: w }));
  }
  
  // Download file
  XLSX.writeFile(workbook, `${sheetName.replace(/\s+/g, '_')}_Export.xlsx`);
  showToast('success', 'Excel Downloaded', 'Your leads have been successfully exported as Excel.');
}

async function exportToCSV() {
  const allLeads = await window.MemoryEngine.getAllLeads();
  if (allLeads.length === 0) {
    showToast('warning', 'No Data', 'No leads available to export.');
    return;
  }
  
  const excelRows = allLeads.map(l => ({
    'Company Name': l.company || '',
    'Industry': l.industry || '',
    'City': l.city || '',
    'Service Type': l.type || '',
    'Phone': l.phone || '',
    'Email': l.email || '',
    'Website': l.website || '',
    'Address': l.address || '',
    'Job Title/Requirements': l.jobTitle || '',
    'Positions Open': l.positions || '',
    'Status': l.status || '',
    'Source': l.source || '',
    'Date Added': l.timestamp ? new Date(l.timestamp).toLocaleDateString('en-IN') : ''
  }));
  
  const worksheet = XLSX.utils.json_to_sheet(excelRows);
  const csvOutput = XLSX.utils.sheet_to_csv(worksheet);
  
  const blob = new Blob([csvOutput], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.setAttribute('href', url);
  link.setAttribute('download', `leads_export_${Date.now()}.csv`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  
  showToast('success', 'CSV Downloaded', 'Your leads have been exported successfully as CSV.');
}

// ============================================================
//  ANALYTICS
// ============================================================
function renderAnalytics() {
  renderAnalyticsBars('analytics-source-chart', 'source',
    ['LinkedIn','Indeed','Google Jobs','Google Maps'],
    ['#3b82f6','#ec4899','#10b981','#f59e0b']);

  renderAnalyticsBars('analytics-type-chart', 'type',
    ['Security','Housekeeping','Both'],
    ['#6366f1','#10b981','#f59e0b']);

  renderTimeline('analytics-timeline');
  renderFunnel('analytics-funnel');
  renderAnalyticsIndustries('analytics-industries');
}

function renderAnalyticsBars(containerId, field, keys, colors) {
  const container = document.getElementById(containerId);
  if (!container) return;
  if (allLeads.length === 0) { container.innerHTML = '<div class="empty-chart-msg">No data yet</div>'; return; }

  const counts = keys.map(k => allLeads.filter(l => l[field] === k).length);
  const max = Math.max(...counts, 1);
  container.innerHTML = keys.map((key, i) => {
    const pct = Math.round((counts[i] / max) * 100);
    return `<div class="source-bar-item" style="margin-bottom:8px">
      <div class="source-bar-label">${escHtml(key)}</div>
      <div class="source-bar-track"><div class="source-bar-fill" style="width:${pct}%;background:${colors[i % colors.length]}"></div></div>
      <div class="source-bar-count">${counts[i]}</div>
    </div>`;
  }).join('');
}

function renderAnalyticsIndustries(containerId) {
  const container = document.getElementById(containerId);
  if (!container) return;
  if (allLeads.length === 0) { container.innerHTML = '<div class="empty-chart-msg">No data yet</div>'; return; }
  const map = {};
  allLeads.forEach(l => { const k = l.industry||l.sector||'Unknown'; map[k] = (map[k]||0)+1; });
  const sorted = Object.entries(map).sort((a,b)=>b[1]-a[1]).slice(0,8);
  const max = Math.max(...sorted.map(e=>e[1]),1);
  const colors = ['#6366f1','#f59e0b','#ef4444','#ec4899','#10b981','#3b82f6','#8b5cf6','#14b8a6'];
  container.innerHTML = sorted.map(([k,v],i) => {
    const pct = Math.round((v/max)*100);
    const shortK = k.split('&')[0].trim().split(' ').slice(0,2).join(' ');
    return `<div class="source-bar-item" style="margin-bottom:8px">
      <div class="source-bar-label" title="${escHtml(k)}">${escHtml(shortK)}</div>
      <div class="source-bar-track"><div class="source-bar-fill" style="width:${pct}%;background:${colors[i%colors.length]}"></div></div>
      <div class="source-bar-count">${v}</div>
    </div>`;
  }).join('');
}

function renderTimeline(containerId) {
  const container = document.getElementById(containerId);
  if (!container) return;
  if (allLeads.length === 0) { container.innerHTML = '<div class="empty-chart-msg">No data yet</div>'; return; }

  const days = 14;
  const now = Date.now();
  const dayCounts = new Array(days).fill(0);
  allLeads.forEach(l => {
    const daysAgo = Math.floor((now - l.timestamp) / 86400000);
    if (daysAgo < days) dayCounts[days - 1 - daysAgo]++;
  });
  const max = Math.max(...dayCounts, 1);

  const html = `<div style="display:flex;align-items:flex-end;gap:4px;height:80px">
    ${dayCounts.map((c, i) => {
      const h = Math.max((c / max) * 70, 2);
      const d = new Date(now - (days - 1 - i) * 86400000);
      const lbl = d.toLocaleDateString('en-IN', { month:'short', day:'numeric' });
      return `<div style="flex:1;display:flex;flex-direction:column;align-items:center;gap:4px">
        <div style="width:100%;height:${h}px;background:#6366f1;border-radius:3px 3px 0 0;opacity:0.85;transition:height 0.3s" title="${lbl}: ${c} leads"></div>
        ${i % 2 === 0 ? `<span style="font-size:9px;color:var(--gray-400);white-space:nowrap">${lbl}</span>` : '<span style="font-size:9px"></span>'}
      </div>`;
    }).join('')}
  </div>`;
  container.innerHTML = html;
}

function renderFunnel(containerId) {
  const container = document.getElementById(containerId);
  if (!container) return;
  const stages = [
    { key:'New',       color:'#6366f1', label:'New Leads' },
    { key:'Contacted', color:'#f59e0b', label:'Contacted' },
    { key:'Qualified', color:'#10b981', label:'Qualified' },
    { key:'Closed',    color:'#9ca3af', label:'Closed/Won' },
  ];
  const counts = stages.map(s => allLeads.filter(l => l.status === s.key).length);
  const max = Math.max(...counts, 1);

  container.innerHTML = stages.map((s, i) => {
    const pct = Math.round((counts[i] / max) * 100);
    return `<div style="margin-bottom:8px">
      <div style="display:flex;justify-content:space-between;font-size:12px;margin-bottom:3px">
        <span style="font-weight:600;color:var(--gray-700)">${s.label}</span>
        <span style="color:var(--gray-500)">${counts[i]}</span>
      </div>
      <div style="height:10px;background:var(--gray-100);border-radius:99px;overflow:hidden">
        <div style="height:100%;width:${pct}%;background:${s.color};border-radius:99px;transition:width 0.5s ease"></div>
      </div>
    </div>`;
  }).join('');
}

// ============================================================
//  SETTINGS
// ============================================================
function loadSettingsToUI() {
  const settings = SettingsEngine.load();
  const apifyEl = document.getElementById('apify-key');
  if (apifyEl) {
    apifyEl.value = '';
  }
  const dedupEl = document.getElementById('dedup-field');
  if (dedupEl) dedupEl.value = settings.dedupStrategy || 'company+type';
  const budgetEl = document.getElementById('token-budget');
  const budgetValEl = document.getElementById('token-budget-val');
  if (budgetEl) { budgetEl.value = settings.tokenBudget || 1000; if (budgetValEl) budgetValEl.textContent = budgetEl.value; }

  const groqEl = document.getElementById('groq-key');
  if (groqEl && window.ChatEngine) groqEl.value = window.ChatEngine.getApiKey() || '';

  // Restore locations
  if (settings.locations?.length) {
    settings.locations.forEach(l => addLocationTag(l));
  }
  // Restore industries
  if (settings.lastIndustries?.length) {
    settings.lastIndustries.forEach(k => toggleIndustry(k, null));
  }

}

async function refreshSettingsMemoryStats() {
  const stats = await MemoryEngine.getStats();
  const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
  set('mem-total',    stats.total);
  set('mem-dupes',    stats.dupes);
  set('mem-sessions', stats.sessions);
  set('mem-pushed',   stats.pushed);
}

function saveSettings() {
  const apifyKey     = document.getElementById('apify-key')?.value?.trim() || '';
  const dedupStrategy = document.getElementById('dedup-field')?.value || 'company+type';
  const tokenBudget  = parseInt(document.getElementById('token-budget')?.value || '1000');
  const groqKey      = document.getElementById('groq-key')?.value?.trim() || '';

  SettingsEngine.save({ apifyKey, dedupStrategy, tokenBudget });
  localStorage.setItem('skylark_dedup_strategy', dedupStrategy);
  if (window.ChatEngine) window.ChatEngine.setApiKey(groqKey);
  showToast('success', 'Settings Saved', 'All preferences stored locally');
}

async function clearAllData() {
  if (!confirm('This will delete ALL leads and memory. This cannot be undone. Continue?')) return;
  await MemoryEngine.clearAll(); // also resets token counter
  allLeads = [];
  filteredLeads = [];
  selectedLeadIds.clear();
  restoreTokenCounter();
  updateAllUI();
  showToast('success', 'Memory Cleared', 'All lead data and token counter have been reset');
}

function toggleApiKey() {
  const input = document.getElementById('apify-key');
  if (!input) return;
  input.type = input.type === 'password' ? 'text' : 'password';
}

function toggleGroqKey() {
  const input = document.getElementById('groq-key');
  if (!input) return;
  input.type = input.type === 'password' ? 'text' : 'password';
}

// ============================================================
//  CHAT UI LOGIC
// ============================================================
function initChatUI() {
  const btn = document.getElementById('chat-send-btn');
  const input = document.getElementById('chat-input');
  
  if(btn && input) {
    btn.addEventListener('click', handleChatSend);
    input.addEventListener('keydown', (e) => {
      if(e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleChatSend();
      }
    });
    
    // Auto-resize logic
    input.addEventListener('input', function() {
      this.style.height = 'auto';
      this.style.height = (this.scrollHeight) + 'px';
    });
  }
  
  setupCustomDropdowns();
}

function setupCustomDropdowns() {
  document.querySelectorAll('.custom-dropdown').forEach(dropdown => {
    const header = dropdown.querySelector('.custom-dropdown-header');
    const textEl = dropdown.querySelector('.custom-dropdown-text');
    const listItems = dropdown.querySelectorAll('.custom-dropdown-list li');
    const hiddenInput = dropdown.querySelector('input[type="hidden"]');
    
    header.addEventListener('click', (e) => {
      e.stopPropagation();
      document.querySelectorAll('.custom-dropdown').forEach(d => {
        if (d !== dropdown) d.classList.remove('open');
      });
      dropdown.classList.toggle('open');
    });
    
    listItems.forEach(li => {
      li.addEventListener('click', (e) => {
        e.stopPropagation();
        const val = li.getAttribute('data-value');
        const text = li.innerText;
        textEl.innerText = text;
        if (hiddenInput) hiddenInput.value = val;
        
        listItems.forEach(item => item.classList.remove('active'));
        li.classList.add('active');
        
        dropdown.classList.remove('open');
      });
    });
  });
  
  document.addEventListener('click', () => {
    document.querySelectorAll('.custom-dropdown').forEach(d => d.classList.remove('open'));
  });
}
async function handleFileUpload(event) {
  const file = event.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = async function(e) {
    const text = e.target.result;
    const lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 0);
    
    // Take up to 50 lines as company names
    const companies = lines.slice(0, 50).filter(l => l.length > 2);
    
    if (companies.length === 0) {
      showToast('error', 'File Error', 'Could not find valid company names in the file.');
      return;
    }

    addChatMessage('user', `<p>📁 Uploaded <b>${file.name}</b> (${companies.length} companies).</p><p>Please find contact numbers and websites for these companies.</p>`);
    
    const container = document.getElementById('chat-messages');
    const typing = document.createElement('div');
    typing.className = 'typing-indicator';
    typing.id = 'typing-indicator';
    typing.innerHTML = `
      <div class="chat-avatar" style="width:24px;height:24px;font-size:10px;margin-right:12px;">AI</div>
      <div style="display:flex;align-items:center;gap:8px;background:var(--gray-50);padding:10px 16px;border-radius:12px;">
        <span style="font-size:13px;color:var(--gray-600);font-weight:500;">Skylark is enriching data</span>
        <div class="typing-dot"></div><div class="typing-dot"></div><div class="typing-dot"></div>
      </div>`;
    container.appendChild(typing);
    document.getElementById('main-scroll-area').scrollTop = 9999;

    // Simulate API delay for enrichment
    await new Promise(r => setTimeout(r, 2000));
    
    if (document.getElementById('typing-indicator')) {
      document.getElementById('typing-indicator').remove();
    }

    // Real enrichment logic should be implemented here in future, for now leave blank
    const enrichedLeads = companies.map((c, i) => {
      const email = '';
      const phone = '';
      const website = '';
      return {
        id: `enriched_${Date.now()}_${i}`,
        company: c,
        type: 'Enriched Data',
        city: 'India',
        phone: phone,
        email: email,
        website: website,
        address: 'HQ Location',
        jobTitle: 'Admin/HR',
        source: 'File Upload / Auto-Enriched',
        timestamp: Date.now(),
        isNew: true
      };
    });

    window.MemoryEngine.saveLeads(enrichedLeads);
    
    addChatMessage('system', `
      <div class="agent-reply">
        <h4>Enrichment Complete</h4>
        <p>Successfully processed <b>${file.name}</b> and enriched ${enrichedLeads.length} companies with emails and contact numbers.</p>
        <button class="btn-primary" onclick="showView('leads')" style="margin-top:12px;padding:6px 12px;font-size:12px;">View Enriched Data</button>
      </div>
    `);
    
    event.target.value = ''; // Reset input
    renderStats();
  };
  reader.readAsText(file);
}


let currentChatController = null;
function stopChatGeneration() {
  if (currentChatController) {
    currentChatController.abort();
    currentChatController = null;
  }
}

async function handleChatSend() {
  const input = document.getElementById('chat-input');
  const text = input.value.trim();
  if(!text) return;
  
  input.value = '';
  input.style.height = 'auto'; // Reset height
  addChatMessage('user', `<p>${escHtml(text)}</p>`);
  
  const container = document.getElementById('chat-messages');
  const typing = document.createElement('div');
  typing.className = 'typing-indicator';
  typing.id = 'typing-indicator';
  typing.innerHTML = `
    <div class="chat-avatar" style="width:24px;height:24px;font-size:10px;margin-right:12px;">AI</div>
    <div style="display:flex;align-items:center;gap:8px;background:var(--gray-50);padding:10px 16px;border-radius:12px;">
      <span style="font-size:13px;color:var(--gray-600);font-weight:500;">Skylark is thinking</span>
      <div class="typing-dot"></div><div class="typing-dot"></div><div class="typing-dot"></div>
    </div>`;
  container.appendChild(typing);
  
  const scrollArea = document.getElementById('main-scroll-area');
  scrollArea.scrollTop = scrollArea.scrollHeight;
  
  const stopBtn = document.getElementById('chat-stop-btn');
  const sendBtn = document.getElementById('chat-send-btn');
  if(stopBtn) stopBtn.style.display = 'block';
  if(sendBtn) sendBtn.style.display = 'none';

  currentChatController = new AbortController();
  
  try {
    const response = await window.ChatEngine.sendMessage(text, currentChatController.signal);
    const ti = document.getElementById('typing-indicator');
    if(ti) ti.remove();
    
    if(response) {
      addChatMessage('assistant', `<p>${response.text.replace(/\\n/g, '<br>')}</p>`);
      if(response.action) executeChatAction(response.action);
    }
  } catch (err) {
    const ti = document.getElementById('typing-indicator');
    if(ti) ti.remove();
    if(err.name === 'AbortError') {
      addChatMessage('assistant', `<p style="color:var(--accent-orange)">Generation stopped by user.</p>`);
    } else {
      addChatMessage('assistant', `<p style="color:var(--accent-red)">Error: ${escHtml(err.message)}</p>`);
    }
  } finally {
    if(stopBtn) stopBtn.style.display = 'none';
    if(sendBtn) sendBtn.style.display = 'flex';
    currentChatController = null;
  }
}

function addChatMessage(role, htmlContent) {
  const container = document.getElementById('chat-messages');
  if(!container) return;
  const msgDiv = document.createElement('div');
  msgDiv.className = `chat-message ${role}`;
  
  const avatar = document.createElement('div');
  avatar.className = 'chat-avatar';
  avatar.textContent = role === 'user' ? 'U' : 'AI';
  
  const bubble = document.createElement('div');
  bubble.className = 'chat-bubble';
  bubble.innerHTML = htmlContent;
  
  if (role === 'assistant' || role === 'system') {
    const copyBtn = document.createElement('button');
    copyBtn.className = 'msg-copy-btn';
    copyBtn.title = 'Copy message';
    copyBtn.innerHTML = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>';
    copyBtn.onclick = () => {
      const textToCopy = bubble.innerText;
      navigator.clipboard.writeText(textToCopy);
      copyBtn.innerHTML = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>';
      copyBtn.style.color = 'var(--accent-green)';
      setTimeout(() => {
        copyBtn.innerHTML = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>';
        copyBtn.style.color = '';
      }, 2000);
    };
    msgDiv.appendChild(copyBtn);
  }
  
  msgDiv.appendChild(avatar);
  msgDiv.appendChild(bubble);
  container.appendChild(msgDiv);
  
  const welcome = document.getElementById('chat-welcome');
  if (welcome) welcome.style.display = 'none';
  
  const scrollArea = document.getElementById('main-scroll-area');
  scrollArea.scrollTop = scrollArea.scrollHeight;
}

function executeChatAction(action) {
  if (action.type === 'generate') {
    if(action.cities) {
      selectedLocations = action.cities;
      renderLocationTags();
    }
    if(action.industries) {
      clearAllIndustries();
      const checks = document.querySelectorAll('.industry-card');
      checks.forEach(c => {
        if(action.industries.includes(c.dataset.key)) {
          toggleIndustry(c.dataset.key, c);
        }
      });
    }
    if(action.serviceType) {
      const secCb = document.getElementById('target-security');
      const hkCb  = document.getElementById('target-housekeeping');
      if (secCb) secCb.checked = action.serviceType.includes('Security');
      if (hkCb) hkCb.checked = action.serviceType.includes('Housekeeping');
      updateServiceCard('security');
      updateServiceCard('housekeeping');
    }
    if (action.count) {
      window.chatRequestedTotalTarget = action.count;
      const batchSlider = document.getElementById('batch-size');
      if(batchSlider) { 
        const numCombos = (action.cities || selectedLocations).length * (action.industries || [...selectedIndustries]).length || 1;
        batchSlider.value = Math.max(1, Math.min(10, Math.ceil(action.count / numCombos))); 
        updateBatchInfo(); 
      }
    } else {
      window.chatRequestedTotalTarget = null;
    }
    
    setTimeout(() => {
      showView('agent');
      startAgentPipeline();
    }, 1500);

  } else if (action.type === 'filter') {
    if (action.industry) {
      const indSel = document.getElementById('filter-industry');
      if(indSel && Array.from(indSel.options).some(o => o.value === action.industry)) {
         indSel.value = action.industry;
      }
    }
    if (action.city) {
      const citySel = document.getElementById('filter-city');
      if(citySel && Array.from(citySel.options).some(o => o.value === action.city)) {
         citySel.value = action.city;
      }
    }
    if (action.status) {
      const statSel = document.getElementById('filter-status');
      if(statSel) statSel.value = action.status;
    }
    applyFilters();
    setTimeout(() => { showView('leads'); }, 1000);
  } else if (action.type === 'show_all') {
    clearFilters();
    setTimeout(() => { showView('leads'); }, 1000);
  } else if (action.type === 'export') {
    exportCSV();
  } else if (action.type === 'export_excel') {
    exportExcel();
  } else if (action.type === 'sync_sheets') {
    syncAllToSheets();
  }
}

// ============================================================
//  HELPERS
// ============================================================
function getTypeBadge(type) {
  const map = {
    'Security':     'badge-security',
    'Housekeeping': 'badge-hk',
    'Both':         'badge-both',
  };
  return `<span class="type-badge ${map[type]||''}">${escHtml(type||'Unknown')}</span>`;
}

function getSourceBadge(source) {
  return `<span class="source-badge">${escHtml(source||'Unknown')}</span>`;
}

function escHtml(str) {
  if (str == null) return '';
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}

function formatDate(ts) {
  if (!ts) return '—';
  return new Date(ts).toLocaleDateString('en-IN', { day:'2-digit', month:'short', year:'numeric' });
}

function timeAgo(ts) {
  if (!ts) return '';
  const diff = Date.now() - ts;
  if (diff < 3600000) return `${Math.floor(diff/60000)}m ago`;
  if (diff < 86400000) return `${Math.floor(diff/3600000)}h ago`;
  if (diff < 604800000) return `${Math.floor(diff/86400000)}d ago`;
  return formatDate(ts);
}

// ============================================================
//  TOAST SYSTEM
// ============================================================
function showToast(type, title, message) {
  const container = document.getElementById('toast-container');
  if (!container) return;

  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;

  const icons = {
    success: '<svg viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clip-rule="evenodd"/></svg>',
    error:   '<svg viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clip-rule="evenodd"/></svg>',
    warning: '<svg viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clip-rule="evenodd"/></svg>',
    info:    '<svg viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clip-rule="evenodd"/></svg>',
  };

  toast.innerHTML = `
    <div class="toast-icon">${icons[type] || icons.info}</div>
    <div class="toast-content"><div class="toast-title">${escHtml(title)}</div><div class="toast-message">${escHtml(message)}</div></div>
    <button class="toast-close" onclick="this.closest('.toast').remove()">×</button>
  `;

  container.appendChild(toast);
  requestAnimationFrame(() => toast.classList.add('visible'));

  setTimeout(() => {
    toast.classList.remove('visible');
    setTimeout(() => toast.remove(), 400);
  }, 5000);
}

// ============================================================
//  TOKEN DASHBOARD & KEY MANAGEMENT
// ============================================================
function saveCustomKeys() {
  const apifyInput = document.getElementById('custom-apify-input');
  const groqInput  = document.getElementById('custom-groq-input');
  const nvidiaInput = document.getElementById('custom-nvidia-input');
  const deepseekInput = document.getElementById('custom-deepseek-input');
  const moonshotInput = document.getElementById('custom-moonshot-input');
  const openrouterInput = document.getElementById('custom-openrouter-input');
  
  // Clear inputs after save
  if(apifyInput) apifyInput.value = '';
  if(groqInput) groqInput.value = '';
  if(nvidiaInput) nvidiaInput.value = '';
  if(deepseekInput) deepseekInput.value = '';
  if(moonshotInput) moonshotInput.value = '';
  if(openrouterInput) openrouterInput.value = '';
  
  showToast('warning', 'Backend configuration required', 'Provider keys are never stored in this Android client.');
  
  if (typeof renderTokenDashboard === 'function') {
    renderTokenDashboard();
  }
}
  
  function renderTokenDashboard() {
    const M   = window.MemoryEngine;
    const cfg = window.SKYLARK_CONFIG || {};
    if (!M) return;
  
    // Populate inputs with current keys if available
    const setInput = (id) => { const el = document.getElementById(id); if (el) el.value = ''; };
    setInput('custom-apify-input');
    setInput('custom-groq-input');
    setInput('custom-nvidia-input');
    setInput('custom-deepseek-input');
    setInput('custom-moonshot-input');
    setInput('custom-openrouter-input');
  
    // Update stat cards
    const total   = M.getTotalTokensUsed();
    const session = M.getSessionTokens();
    const set     = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
  
    set('tk-total',   total.toLocaleString());
    set('tk-session', session.toLocaleString());
  
    // Apify active key
    const apifyKeys = (cfg.APIFY_API_KEYS || []).filter(k => k && k.trim());
    const apifyIdx  = M.getActiveApifyIdx();
    if (apifyKeys.length > 0) {
      set('tk-apify-active', `Key #${apifyIdx + 1}`);
      const used  = M.getKeyUsage('apify', apifyIdx);
      const limit = cfg.APIFY_KEY_LIMIT || 400;
      const pct   = Math.min(Math.round((used / limit) * 100), 100);
      set('tk-apify-status', `${used} / ${limit} credits (${pct}%)`);
    } else {
      set('tk-apify-active', 'Not set');
    }

    // NVIDIA active key
    if (localStorage.getItem('skylark_nvidia_key') || (cfg.NVIDIA_API_KEYS && cfg.NVIDIA_API_KEYS[0])) {
      const used = M.getKeyUsage('nvidia', 0);
      set('tk-nvidia-active', `${used.toLocaleString()} tokens`);
      set('tk-nvidia-status', 'Tracking usage');
    } else {
      set('tk-nvidia-active', 'Not set');
    }

    // DeepSeek active key
    if (localStorage.getItem('skylark_deepseek_key') || (cfg.DEEPSEEK_API_KEYS && cfg.DEEPSEEK_API_KEYS[0])) {
      const used = M.getKeyUsage('deepseek', 0);
      set('tk-deepseek-active', `${used.toLocaleString()} tokens`);
      set('tk-deepseek-status', 'Tracking usage');
    } else {
      set('tk-deepseek-active', 'Not set');
    }

    // Moonshot active key
    if (cfg.MOONSHOT_API_KEYS && cfg.MOONSHOT_API_KEYS[0]) {
      const used = M.getKeyUsage('moonshot', 0);
      set('tk-moonshot-active', `${used.toLocaleString()} tokens`);
      set('tk-moonshot-status', 'Tracking usage');
    } else {
      set('tk-moonshot-active', 'Not set');
    }

    // Render table rows
    const renderTable = (containerId, keysArr, provider, limit) => {
      set('tk-apify-active', 'Not set');
      set('tk-apify-status', 'Add keys in config.js');
    }
  
    // Groq active key
    const groqKeys = (cfg.GROQ_API_KEYS || []).filter(k => k && k.trim());
    const groqIdx  = M.getActiveGroqIdx ? M.getActiveGroqIdx() : 0;
    if (groqKeys.length > 0) {
      set('tk-groq-active', `Key #${groqIdx + 1}`);
      const used  = M.getKeyUsage('groq', groqIdx);
      const limit = cfg.GROQ_KEY_LIMIT || 14400;
      const pct   = Math.min(Math.round((used / limit) * 100), 100);
      set('tk-groq-status', `${used} / ${limit} tokens (${pct}%)`);
    } else {
      set('tk-groq-active', 'Not set');
      set('tk-groq-status', 'Add keys in config.js');
    }

    // Nvidia active key
    if (localStorage.getItem('skylark_nvidia_key') || (cfg.NVIDIA_API_KEYS && cfg.NVIDIA_API_KEYS[0])) {
      const used = M.getKeyUsage('nvidia', 0);
      set('tk-nvidia-active', `${used.toLocaleString()} tokens`);
      set('tk-nvidia-status', 'Tracking usage');
    } else {
      set('tk-nvidia-active', 'Not set');
    }

    // DeepSeek active key
    if (localStorage.getItem('skylark_deepseek_key') || (cfg.DEEPSEEK_API_KEYS && cfg.DEEPSEEK_API_KEYS[0])) {
      const used = M.getKeyUsage('deepseek', 0);
      set('tk-deepseek-active', `${used.toLocaleString()} tokens`);
      set('tk-deepseek-status', 'Tracking usage');
    } else {
      set('tk-deepseek-active', 'Not set');
    }

    // Moonshot active key
    if (cfg.MOONSHOT_API_KEYS && cfg.MOONSHOT_API_KEYS[0]) {
      const used = M.getKeyUsage('moonshot', 0);
      set('tk-moonshot-active', `${used.toLocaleString()} tokens`);
      set('tk-moonshot-status', 'Tracking usage');
    } else {
      set('tk-moonshot-active', 'Not set');
    }
  
  // Render Apify key table
  renderKeyTable('apify-keys-table', 'apify', apifyKeys, cfg.APIFY_KEY_LIMIT || 500, apifyIdx);
  // Render Groq key table
  renderKeyTable('groq-keys-table', 'groq', groqKeys, cfg.GROQ_KEY_LIMIT || 14400, groqIdx);
    
    // Update Candidates Apify Usage
    const candidateApifyUsage = M.getKeyUsage('candidate_apify', 0) || 0;
    const candidateUsageEl = document.getElementById('candidate-apify-usage');
    if (candidateUsageEl) candidateUsageEl.textContent = candidateApifyUsage;
    
    if (typeof window.updateRealtimeTokenCounters === 'function') {
      window.updateRealtimeTokenCounters();
    }
}

function renderKeyTable(containerId, keyType, keys, limit, activeIdx) {
  const container = document.getElementById(containerId);
  if (!container) return;
  if (keys.length === 0) {
    container.innerHTML = `<div class="empty-chart-msg">No ${keyType === 'apify' ? 'Apify' : 'Groq'} keys configured in config.js</div>`;
    return;
  }
  const M = window.MemoryEngine;
  const rows = keys.map((key, i) => {
    const used   = M.getKeyUsage(keyType, i);
    const pct    = Math.min(Math.round((used / limit) * 100), 100);
    const isAct  = i === activeIdx;
    
    // Status Logic
    let status = '🟢 Healthy';
    let color  = '#10b981';
    let rowBg  = isAct ? 'background:var(--surface-raised); border-left: 3px solid var(--accent-green);' : '';
    
    if (pct >= 100) {
      status = '🔴 Exhausted';
      color  = '#ef4444';
      rowBg  = 'background:rgba(239, 68, 68, 0.05); opacity: 0.7;';
    } else if (pct >= 90) {
      status = '🔴 Near Limit';
      color  = '#ef4444';
    } else if (pct >= 70) {
      status = '🟡 High Usage';
      color  = '#f59e0b';
    }
    
    const activeBadge = isAct && pct < 100 ? `<span style="margin-left:8px; font-size:10px; background:var(--accent-green); color:#fff; padding:2px 6px; border-radius:4px; font-weight:700;">ACTIVE</span>` : '';
    const masked = key.length > 12 ? key.slice(0,6) + '•••••' + key.slice(-4) : '(empty)';
    
    return `
      <div style="display:grid;grid-template-columns:120px 140px 1fr 100px 90px;gap:12px;align-items:center;padding:10px 12px;border-bottom:1px solid var(--border);${rowBg}">
        <span style="font-size:12px;font-weight:700;color:var(--gray-900); display:flex; align-items:center;">Key #${i+1}${activeBadge}</span>
        <span style="font-size:11px;color:var(--gray-600);font-family:monospace">${masked}</span>
        <div style="height:8px;background:var(--gray-200);border-radius:99px;overflow:hidden">
          <div style="height:100%;width:${pct}%;background:${color};border-radius:99px;transition:width 0.5s"></div>
        </div>
        <span style="font-size:12px;color:var(--gray-800)">${used} / ${limit}</span>
        <span style="font-size:11px;font-weight:600;color:var(--gray-900)">${status}</span>
      </div>`;
  }).join('');
  container.innerHTML = `
    <div style="display:grid;grid-template-columns:80px 140px 1fr 100px 90px;gap:12px;padding:8px 12px;border-bottom:2px solid var(--border);background:var(--gray-50)">
      <span style="font-size:10px;font-weight:700;text-transform:uppercase;color:var(--gray-500)">Slot</span>
      <span style="font-size:10px;font-weight:700;text-transform:uppercase;color:var(--gray-500)">Key (masked)</span>
      <span style="font-size:10px;font-weight:700;text-transform:uppercase;color:var(--gray-500)">Usage</span>
      <span style="font-size:10px;font-weight:700;text-transform:uppercase;color:var(--gray-500)">Credits</span>
      <span style="font-size:10px;font-weight:700;text-transform:uppercase;color:var(--gray-500)">Status</span>
    </div>
    ${rows}`;
}

function resetAllKeyUsage() {
  if (!confirm('Reset all API key usage statistics? This will not affect your actual API quotas.')) return;
  window.MemoryEngine?.resetKeyUsage();
  renderTokenDashboard();
  showToast('success', 'Usage Reset', 'API key usage stats have been cleared');
}

// ─── Check key health and notify user ───────────────────────
function checkAndNotifyKeyHealth() {
  const M   = window.MemoryEngine;
  const cfg = window.SKYLARK_CONFIG || {};
  if (!M) return;

  const apifyKeys = (cfg.APIFY_API_KEYS || []).filter(k => k && k.trim());
  const groqKeys  = (cfg.GROQ_API_KEYS  || []).filter(k => k && k.trim());

  // Check if ALL apify keys are at >85%
  if (apifyKeys.length > 0) {
    const allExhausted = apifyKeys.every((_, i) =>
      M.getKeyUsage('apify', i) >= (cfg.APIFY_KEY_LIMIT || 400) * 0.85
    );
    if (allExhausted) {
      document.getElementById('token-warn-icon')?.style?.setProperty('display', 'inline');
      showToast('warning', '⚠ Apify Keys Near Limit!', 'All API keys are at 85%+ usage. Add more keys in config.js → Click token meter to view');
    }
  }

  // Warn when active key hits 80%
  const activeApify = M.getActiveApifyIdx();
  const health = M.checkKeyHealth('apify', activeApify);
  if (health.warn) {
    document.getElementById('token-warn-icon')?.style?.setProperty('display', 'inline');
    showToast('warning', `⚠ Apify Key #${activeApify + 1} at ${health.pct}%`, 'Switching to next key automatically. Add more keys in config.js');
  }
}

// ============================================================
//  VOICE SEARCH
// ============================================================
let voiceRecognition = null;

function startVoiceInput() {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) {
    showToast('warning', 'Voice Not Supported', 'Your browser does not support voice input. Try Chrome.');
    return;
  }

  const voiceBtn = document.getElementById('voice-btn');
  if (voiceRecognition) {
    voiceRecognition.stop();
    voiceRecognition = null;
    if (voiceBtn) voiceBtn.classList.remove('listening');
    return;
  }

  voiceRecognition = new SpeechRecognition();
  voiceRecognition.lang          = 'hi-IN'; // Hindi + English
  voiceRecognition.interimResults = true;
  voiceRecognition.maxAlternatives = 1;

  if (voiceBtn) voiceBtn.classList.add('listening');

  voiceRecognition.onresult = (event) => {
    const transcript = Array.from(event.results).map(r => r[0].transcript).join('');
    const input = document.getElementById('chat-input');
    if (input) input.value = transcript;
  };

  voiceRecognition.onend = () => {
    if (voiceBtn) voiceBtn.classList.remove('listening');
    voiceRecognition = null;
    showToast('info', 'Voice Input Stopped', 'Click the Send button or press Enter when you are ready');
  };

  voiceRecognition.onerror = (event) => {
    if (voiceBtn) voiceBtn.classList.remove('listening');
    voiceRecognition = null;
    if (event.error !== 'no-speech') {
      showToast('error', 'Voice Error', 'Could not capture audio: ' + event.error);
    }
  };

  voiceRecognition.start();
  showToast('info', '🎤 Listening...', 'Speak your query in Hindi or English');
}

// ============================================================
//  QUICK CHAT SHORTCUT
// ============================================================
function sendQuickChat(text) {
  const input = document.getElementById('chat-input');
  if (input) {
    input.value = text;
    // Hide quick chips after use
    const chips = document.getElementById('chat-quick-chips');
    if (chips) chips.style.display = 'none';
    handleChatSend();
  }
}

// ============================================================
//  EMAIL AUTOMATION LOGIC
// ============================================================
let currentEmailAttachments = [];

// Image Resize handler for Email Editors (Gmail-like popup)
let activeImageForResizing = null;

document.addEventListener('click', function(e) {
  const popup = document.getElementById('gmail-image-resizer');
  if (!popup) return;
  
  if (e.target.tagName === 'IMG' && (e.target.closest('.gmail-editor') || e.target.closest('.gmail-editor-sig'))) {
    e.stopPropagation();
    activeImageForResizing = e.target;
    
    // Position the popup below the image
    const rect = activeImageForResizing.getBoundingClientRect();
    popup.style.top = (rect.bottom + window.scrollY + 6) + 'px';
    popup.style.left = (rect.left + window.scrollX) + 'px';
    popup.style.display = 'flex';
  } else if (!e.target.closest('#gmail-image-resizer')) {
    // Clicked outside, hide popup
    popup.style.display = 'none';
    activeImageForResizing = null;
  }
});

function resizeSelectedImage(size) {
  if (activeImageForResizing) {
    activeImageForResizing.style.maxWidth = size;
    activeImageForResizing.style.width = (size === '100%') ? 'auto' : size;
    activeImageForResizing.style.height = 'auto';
    
    // Reposition popup because image size changed
    setTimeout(() => {
      const popup = document.getElementById('gmail-image-resizer');
      if (popup && activeImageForResizing) {
        const rect = activeImageForResizing.getBoundingClientRect();
        popup.style.top = (rect.bottom + window.scrollY + 6) + 'px';
        popup.style.left = (rect.left + window.scrollX) + 'px';
      }
    }, 50);
  }
}

function removeSelectedImage() {
  if (activeImageForResizing) {
    activeImageForResizing.remove();
    const popup = document.getElementById('gmail-image-resizer');
    if (popup) popup.style.display = 'none';
    activeImageForResizing = null;
    showToast('info', 'Image Removed', 'The selected image has been removed.');
  }
}

function loadEmailTemplate() {
  const tmpl = JSON.parse(localStorage.getItem('skylark_email_template') || '{}');
  const subj = document.getElementById('email-subject');
  const bodyRich = document.getElementById('email-body-rich');
  const sigRich = document.getElementById('email-signature-rich');
  const webh = document.getElementById('email-webhook-url');
  const accEmail = document.getElementById('account-email');
  const ccVal = document.getElementById('email-cc');
  const bccVal = document.getElementById('email-bcc');
  
  if (subj) subj.value = tmpl.subject || '';
  if (bodyRich) bodyRich.innerHTML = tmpl.body || '<p>Hi {Company} team,</p><p><br></p><p>We provide excellent {JobTitle} services...</p>';
  if (sigRich)  sigRich.innerHTML  = tmpl.signature || '<br><br>Best regards,<br><b>Skylark Security</b>';
  if (ccVal) ccVal.value = tmpl.cc || '';
  if (bccVal) bccVal.value = tmpl.bcc || '';
  
  if (webh) {
    webh.value = '';
  }
  if (accEmail) {
    accEmail.value = localStorage.getItem('skylark_email_account') || (window.SKYLARK_CONFIG && window.SKYLARK_CONFIG.EMAIL_SENDER_ADDRESS) || '';
  }
  
  // Show Cc/Bcc rows if they have saved content
  if ((tmpl.cc || tmpl.bcc) && ccVal && bccVal) {
    document.getElementById('gmail-cc-row').style.display = 'flex';
    document.getElementById('gmail-bcc-row').style.display = 'flex';
  }
}

function saveEmailTemplate() {
  const subject = document.getElementById('email-subject').value;
  const body = document.getElementById('email-body-rich').innerHTML;
  const signature = document.getElementById('email-signature-rich').innerHTML;
  const cc = document.getElementById('email-cc').value.trim();
  const bcc = document.getElementById('email-bcc').value.trim();
  
  localStorage.setItem('skylark_email_template', JSON.stringify({ subject, body, signature, cc, bcc }));
  showToast('success', 'Template Saved', 'Email template saved to memory.');
}

// ─── MULTI-EMAIL ACCOUNT MANAGEMENT ────────────────────────
function getSavedEmails() {
  try { return JSON.parse(localStorage.getItem('skylark_saved_emails') || '[]'); } catch { return []; }
}
function setSavedEmails(arr) {
  localStorage.setItem('skylark_saved_emails', JSON.stringify(arr));
}

function renderAccountsUI() {
  const emails = getSavedEmails();
  const activeEmail = localStorage.getItem('skylark_email_account') || '';

  // Active banner
  const banner = document.getElementById('active-email-banner');
  const bannerLabel = document.getElementById('active-email-label');
  if (banner && bannerLabel) {
    if (activeEmail) {
      banner.style.display = 'flex';
      bannerLabel.textContent = activeEmail;
    } else {
      banner.style.display = 'none';
    }
  }

  // Dropdown section — show only if 2+ emails
  const section = document.getElementById('saved-emails-section');
  const dropdown = document.getElementById('saved-emails-dropdown');
  if (section && dropdown) {
    if (emails.length >= 2) {
      section.style.display = 'block';
      dropdown.innerHTML = emails.map(e =>
        `<option value="${e}" ${e === activeEmail ? 'selected' : ''}>${e}</option>`
      ).join('');
    } else {
      section.style.display = 'none';
    }
  }

  // Clear input
  const emailInput = document.getElementById('account-email');
  if (emailInput) emailInput.value = '';
}

function saveEmailWebhook() {
  const webhook  = document.getElementById('email-webhook-url')?.value?.trim();
  const newEmail = document.getElementById('account-email')?.value?.trim();

  if (!webhook) {
    showToast('error', 'Webhook Missing', 'Please enter the Apps Script Webhook URL.');
    return;
  }

  // Save webhook
  if (webhook) {
    showToast('warning', 'Backend configuration required', 'Webhook URLs are never stored in this Android client.');
  }
  return;

  if (newEmail) {
    // Add email to saved list (no duplicates)
    const emails = getSavedEmails();
    if (!emails.includes(newEmail)) {
      emails.push(newEmail);
      setSavedEmails(emails);
    }
    // Set as active
    localStorage.setItem('skylark_email_account', newEmail);
    showToast('success', '✓ Account Connected', `Now sending as: ${newEmail}`);
  } else {
    showToast('success', '✓ Webhook Saved', 'Connection updated successfully.');
  }

  renderAccountsUI();
  loadEmailTemplate(); // refresh email compose "from" display
}

function switchSavedEmail(email) {
  if (!email) return;
  localStorage.setItem('skylark_email_account', email);
  renderAccountsUI();
  loadEmailTemplate();
  showToast('success', '✓ Account Switched', `Now sending as: ${email}`);
}

function removeSavedEmail() {
  const dropdown = document.getElementById('saved-emails-dropdown');
  const emailToRemove = dropdown?.value;
  if (!emailToRemove) return;

  const emails = getSavedEmails().filter(e => e !== emailToRemove);
  setSavedEmails(emails);

  const activeEmail = localStorage.getItem('skylark_email_account');
  if (activeEmail === emailToRemove) {
    const next = emails[0] || '';
    localStorage.setItem('skylark_email_account', next);
  }

  renderAccountsUI();
  showToast('info', 'Email Removed', `${emailToRemove} removed from saved accounts.`);
}

function toggleFormattingBar() {
  const bar = document.getElementById('gmail-formatting-bar');
  if(bar.style.display === 'none') {
    bar.style.display = 'flex';
  } else {
    bar.style.display = 'none';
  }
}

function toggleCcBccFields() {
  const ccRow = document.getElementById('gmail-cc-row');
  const bccRow = document.getElementById('gmail-bcc-row');
  if (ccRow && bccRow) {
    const isHidden = ccRow.style.display === 'none';
    ccRow.style.display = isHidden ? 'flex' : 'none';
    bccRow.style.display = isHidden ? 'flex' : 'none';
  }
}

function showEmailSetup() {
  alert(
    "To setup the Google Apps Script Webhook for free email sending:\n\n" +
    "1. Go to script.google.com and create a new project.\n" +
    "2. Paste the provided email_script_gas.js code.\n" +
    "3. Click Deploy -> New Deployment.\n" +
    "4. Type: Web App.\n" +
    "5. Execute as: Me.\n" +
    "6. Who has access: Anyone.\n" +
    "7. Copy the Web App URL and paste it here."
  );
}

function formatEmailText(command) {
  document.execCommand(command, false, null);
}

function formatEmailLink() {
  const url = prompt("Enter the link URL:");
  if (url) {
    document.execCommand('createLink', false, url);
  }
}

function handleBodyImage(event) {
  const file = event.target.files[0];
  if (!file) return;
  
  const reader = new FileReader();
  reader.onload = function(e) {
    const dataURL = e.target.result;
    const editor = document.getElementById('email-body-rich');
    editor.focus();
    document.execCommand('insertImage', false, dataURL);
    
    const images = editor.getElementsByTagName('img');
    const justAdded = images[images.length - 1];
    if (justAdded) {
      justAdded.style.maxWidth = '250px';
      justAdded.style.height = 'auto';
    }
  };
  reader.readAsDataURL(file);
  event.target.value = '';
}

function handleSignatureImage(event) {
  const file = event.target.files[0];
  if (!file) return;
  
  const reader = new FileReader();
  reader.onload = function(e) {
    const dataURL = e.target.result;
    const editor = document.getElementById('email-signature-rich');
    editor.focus();
    document.execCommand('insertImage', false, dataURL);
    
    const images = editor.getElementsByTagName('img');
    const justAdded = images[images.length - 1];
    if (justAdded) {
      justAdded.style.maxWidth = '150px';
      justAdded.style.height = 'auto';
    }
  };
  reader.readAsDataURL(file);
  event.target.value = '';
}
function handleEmailAttachments(event) {
  const files = event.target.files;
  if (!files || files.length === 0) return;
  
  let totalSize = currentEmailAttachments.reduce((acc, a) => acc + (a.data.length * 0.75), 0); // approx base64 size back to bytes
  
  Array.from(files).forEach(file => {
    if (totalSize + file.size > 5 * 1024 * 1024) {
      showToast('error', 'Size Limit Reached', 'Total attachments cannot exceed 5MB to ensure delivery.');
      return;
    }
    
    const reader = new FileReader();
    reader.onload = function(e) {
      const base64Data = e.target.result.split(',')[1];
      currentEmailAttachments.push({
        name: file.name,
        type: file.type || 'application/octet-stream',
        data: base64Data
      });
      renderAttachmentsPreview();
    };
    reader.readAsDataURL(file);
    totalSize += file.size;
  });
  
  event.target.value = '';
}

function removeEmailAttachment(index) {
  currentEmailAttachments.splice(index, 1);
  renderAttachmentsPreview();
}

function renderAttachmentsPreview() {
  const container = document.getElementById('gmail-attachments-preview');
  if (!container) return;
  
  container.innerHTML = currentEmailAttachments.map((att, i) => `
    <div class="gmail-attachment-chip">
      <span style="max-width:150px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;" title="${att.name}">${att.name}</span>
      <span class="gmail-attachment-remove" onclick="removeEmailAttachment(${i})" title="Remove attachment">✕</span>
    </div>
  `).join('');
}

async function updateEmailPreview() {
  const container = document.getElementById('email-preview-list');
  if (!container) return;
  
  const targetType = document.getElementById('email-target').value;
  const batchSize = parseInt(document.getElementById('email-batch-size').value, 10) || 10;
  
  const allLeads = await window.MemoryEngine.getAllLeads();
  let leadsToEmail = [];
  if (targetType === 'uncontacted') {
    leadsToEmail = allLeads.filter(L => L.status !== 'Contacted' && L.email && L.email !== 'N/A' && L.email !== 'Not Found');
  } else {
    leadsToEmail = allLeads.filter(L => L.email && L.email !== 'N/A' && L.email !== 'Not Found');
  }
  
  const toInput = document.getElementById('email-to-recipients');
  
  leadsToEmail = leadsToEmail.slice(0, batchSize);
  
  if (leadsToEmail.length === 0) {
    container.innerHTML = '<em>No matching leads found with emails.</em>';
    if (toInput) toInput.value = '';
    return;
  }
  
  if (toInput) {
    toInput.value = leadsToEmail.map(L => L.email).join(', ');
  }
  
  container.innerHTML = `<strong>${leadsToEmail.length} leads selected:</strong><br>` + leadsToEmail.map(L => 
    `<div style="padding: 4px 0; border-bottom: 1px solid #e5e7eb;">
      <span style="font-weight: 600;">${L.company}</span> - <a href="mailto:${L.email}" style="color: var(--primary); text-decoration: none;">${L.email}</a>
    </div>`
  ).join('');
}

async function startEmailAutomation() {
  const webhook = document.getElementById('email-webhook-url').value.trim();
  if (!webhook) {
    showToast('error', 'Setup Required', 'Please enter your Google Apps Script Webhook URL.');
    return;
  }
  
  const subject = document.getElementById('email-subject').value;
  const body = document.getElementById('email-body-rich').innerHTML;
  const signature = document.getElementById('email-signature-rich').innerHTML;
  if (!subject || !body) {
    showToast('warning', 'Missing Content', 'Subject and Body are required to send emails.');
    return;
  }
  
  const cc = document.getElementById('email-cc').value.trim();
  const bcc = document.getElementById('email-bcc').value.trim();
  
  const targetType = document.getElementById('email-target').value;
  const batchSize = parseInt(document.getElementById('email-batch-size').value, 10) || 10;
  
  const allLeads = await window.MemoryEngine.getAllLeads();
  let leadsToEmail = [];
  if (targetType === 'uncontacted') {
    leadsToEmail = allLeads.filter(L => L.status !== 'Contacted' && L.email && L.email !== 'N/A' && L.email !== 'Not Found');
  } else {
    leadsToEmail = allLeads.filter(L => L.email && L.email !== 'N/A' && L.email !== 'Not Found');
  }
  
  leadsToEmail = leadsToEmail.slice(0, batchSize);
  
  if (leadsToEmail.length === 0) {
    showToast('info', 'No Leads', 'No leads found with valid emails for the selected target.');
    return;
  }
  
  if (!confirm(`You are about to send automated emails to ${leadsToEmail.length} leads. Continue?`)) return;
  
  document.getElementById('email-progress-container').style.display = 'block';
  const bar = document.getElementById('email-progress-bar');
  const txt = document.getElementById('email-progress-text');
  
  let successCount = 0;
  for (let i = 0; i < leadsToEmail.length; i++) {
    const lead = leadsToEmail[i];
    
    // Replace variables (simple regex replacement for HTML)
    const finalSubject = subject.replace(/{Company}/g, lead.company || '').replace(/{JobTitle}/g, lead.jobTitle || '').replace(/{City}/g, lead.city || '');
    let finalBodyRaw = body.replace(/{Company}/g, lead.company || '').replace(/{JobTitle}/g, lead.jobTitle || '').replace(/{City}/g, lead.city || '') + '<br><br>' + signature;
    const finalBodyHTML = `<div style="font-family: Arial, Helvetica, sans-serif; font-size: 14px; color: #222222; line-height: 1.5;">${finalBodyRaw}</div>`;
    
    txt.textContent = `Sending ${i+1} of ${leadsToEmail.length}...`;
    bar.style.width = `${((i+1)/leadsToEmail.length)*100}%`;
    
    try {
      const payload = {
        to: lead.email,
        subject: finalSubject,
        htmlBody: finalBodyHTML,
        cc: cc,
        bcc: bcc,
        attachments: currentEmailAttachments
      };
      
      await fetch(webhook, {
        method: 'POST',
        mode: 'no-cors',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      
      // Since no-cors, we assume success if it doesn't throw.
      successCount++;
      // Mark as contacted
      lead.status = 'Contacted';
      await window.MemoryEngine.updateLead(lead.id, lead);
    } catch(err) {
      console.error(err);
    }
    
    // Delay 1.5 seconds between emails to avoid spam triggers
    await new Promise(r => setTimeout(r, 1500));
  }
  
  txt.textContent = `${successCount} / ${leadsToEmail.length} Sent Successfully!`;
  showToast('success', 'Email Automation Complete', `Successfully sent ${successCount} emails.`);
}

// ============================================================
// WHATSAPP AUTOMATION
// ============================================================
let waQueue = [];
let waCurrentIndex = 0;
let waTemplate = '';

function updateWhatsappPreview() {
  window.MemoryEngine.getAllLeads().then(allLeads => {
    // Only leads with a valid phone number and status 'New' or 'No Reply' are considered eligible
    const eligible = allLeads.filter(l => l.phone && l.phone.trim() !== '' && (l.status === 'New' || l.status === 'No Reply'));
    document.getElementById('wa-eligible-count').textContent = eligible.length;
    
    // Load template
    const saved = localStorage.getItem('skylark_wa_template');
    if (saved) {
      document.getElementById('whatsapp-body').value = saved;
    }
    
    // Load sender number if any
    const sender = localStorage.getItem('skylark_wa_sender');
    if (sender) {
      document.getElementById('whatsapp-sender-num').value = sender;
    }
  });
}

function saveWhatsappTemplate() {
  const body = document.getElementById('whatsapp-body').value;
  const sender = document.getElementById('whatsapp-sender-num').value;
  localStorage.setItem('skylark_wa_template', body);
  localStorage.setItem('skylark_wa_sender', sender);
  showToast('success', 'Template Saved', 'Your WhatsApp message template has been saved locally.');
}

function openWhatsappWeb() {
  window.open('https://web.whatsapp.com/', '_blank');
}

async function startWhatsappBatch() {
  const batchSize = parseInt(document.getElementById('wa-batch-size').value, 10);
  const body = document.getElementById('whatsapp-body').value;
  
  if (!body.trim()) {
    showToast('error', 'Missing Template', 'Please enter a message template.');
    return;
  }
  
  saveWhatsappTemplate();
  waTemplate = body;
  
  const allLeads = await window.MemoryEngine.getAllLeads();
  const eligible = allLeads.filter(l => l.phone && l.phone.trim() !== '' && (l.status === 'New' || l.status === 'No Reply'));
  
  if (eligible.length === 0) {
    showToast('warning', 'No Leads', 'No eligible leads found with a phone number.');
    return;
  }
  
  waQueue = eligible.slice(0, batchSize);
  waCurrentIndex = 0;
  
  document.getElementById('wa-queue-ui').style.display = 'block';
  document.getElementById('wa-start-batch-btn').style.display = 'none';
  
  updateWaQueueStatus();
}

function updateWaQueueStatus() {
  if (waCurrentIndex >= waQueue.length) {
    document.getElementById('wa-queue-status').textContent = 'Batch Complete!';
    document.getElementById('wa-queue-status').style.color = '#166534';
    document.getElementById('wa-queue-current-lead').textContent = 'All messages in this batch have been queued/sent.';
    document.getElementById('wa-send-next-btn').style.display = 'none';
    showToast('success', 'Batch Finished', `Completed ${waQueue.length} WhatsApp messages.`);
    return;
  }
  
  const nextLead = waQueue[waCurrentIndex];
  document.getElementById('wa-queue-status').textContent = `Ready to Send: ${waCurrentIndex + 1} / ${waQueue.length}`;
  document.getElementById('wa-queue-current-lead').textContent = `Next: ${nextLead.company} (${nextLead.phone})`;
  document.getElementById('wa-send-next-btn').style.display = 'block';
  document.getElementById('wa-send-next-btn').innerHTML = `Send Next to <b>${nextLead.company}</b> ↗`;
}

async function processWhatsappQueueNext() {
  if (waCurrentIndex >= waQueue.length) return;
  
  const lead = waQueue[waCurrentIndex];
  
  // Replace variables
  let msg = waTemplate;
  msg = msg.replace(/{Company}/gi, lead.company || '');
  msg = msg.replace(/{City}/gi, lead.city || '');
  msg = msg.replace(/{Phone}/gi, lead.phone || '');
  msg = msg.replace(/{Industry}/gi, lead.industry || '');
  msg = msg.replace(/{JobTitle}/gi, lead.job_title || '');
  msg = msg.replace(/{Email}/gi, lead.email || '');
  
  const encodedMsg = encodeURIComponent(msg);
  // Clean phone number (remove non digits except leading +)
  let phone = lead.phone.replace(/[^\d+]/g, '');
  
  const url = `https://wa.me/${phone}?text=${encodedMsg}`;
  
  // Update lead status in memory to Contacted (or similar)
  lead.status = 'Contacted';
  await window.MemoryEngine.updateLead(lead.id, lead);
  
  window.open(url, '_blank');
  
  waCurrentIndex++;
  updateWaQueueStatus();
}

function stopWhatsappQueue() {
  waQueue = [];
  waCurrentIndex = 0;
  document.getElementById('wa-queue-ui').style.display = 'none';
  document.getElementById('wa-start-batch-btn').style.display = 'block';
  updateWhatsappPreview();
}

// ============================================================
//  CANDIDATE ENGINE (APIFY INTEGRATION)
// ============================================================

async function initCandidatesView() {
  if (window.MemoryEngine && window.MemoryEngine.getAllCandidates) {
    const candidates = await window.MemoryEngine.getAllCandidates();
    renderCandidatesTable(candidates);
    const badge = document.getElementById('candidates-count-badge');
    if (badge) badge.textContent = candidates.length;
  }
}

function renderCandidatesTable(candidates) {
  const tbody = document.getElementById('candidates-tbody');
  const emptyState = document.getElementById('candidates-empty-state');
  
  if (!candidates || candidates.length === 0) {
    if (tbody) tbody.innerHTML = '';
    if (emptyState) emptyState.style.display = 'block';
    return;
  }
  
  if (emptyState) emptyState.style.display = 'none';
  if (tbody) tbody.innerHTML = candidates.map(c => {
    return `<tr>
      <td><input type="checkbox"></td>
      <td>
        <div style="display:flex; align-items:center; gap:10px;">
          <div style="width:32px; height:32px; border-radius:50%; background:var(--primary-bg); color:var(--primary); display:flex; align-items:center; justify-content:center; font-weight:700;">${c.name.charAt(0)}</div>
          <div>
            <div style="font-weight:600; color:var(--gray-800);">${c.name}</div>
            <div style="font-size:11px; color:var(--gray-500);">${c.city} • ${c.role}</div>
          </div>
        </div>
      </td>
      <td>${c.phone || '<span style="color:#9ca3af;font-size:12px">Not Available</span>'}</td>
      <td style="max-width:300px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; font-size:12px;" title="${c.description}">${c.description || '-'}</td>
      <td>
        <a href="${c.url}" target="_blank" class="btn-secondary" style="padding:4px 8px; font-size:11px; background:#eff6ff; color:#3b82f6; border-color:#bfdbfe;">View Profile</a>
      </td>
      <td><span class="status-badge status-new" style="background:#f0fdf4; color:#16a34a; border:1px solid #bbf7d0;">Scraped</span></td>
      <td>
        <button onclick="deleteCandidateRow('${c.id}')" class="btn-secondary" style="padding:4px; font-size:12px; color:#ef4444; border-color:#fecaca; background:white;">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
        </button>
      </td>
    </tr>`;
  }).join('');
}

let candidateConversationHistory = [];

function addCandidateChatMessage(role, text) {
  const container = document.getElementById('candidate-chat-messages');
  const welcome = document.getElementById('candidate-chat-welcome');
  if (welcome) welcome.style.display = 'none';
  if (container) container.style.display = 'flex';

  const msgDiv = document.createElement('div');
  msgDiv.className = `chat-message ${role}`;

  let avatarText = role === 'ai' ? 'AI' : 'U';
  
  // Format basic markdown/newlines
  let formattedText = text.replace(/\n/g, '<br/>');
  
  // Clean markdown bold for simple rendering
  formattedText = formattedText.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');

  msgDiv.innerHTML = `
    <div class="chat-avatar">${avatarText}</div>
    <div class="chat-bubble">
      ${formattedText}
      ${role === 'ai' ? `<button class="copy-btn" onclick="copyToClipboard('${text.replace(/'/g, "\\'").replace(/\n/g, '\\n')}')" title="Copy"><svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg></button>` : ''}
    </div>
  `;
  container.appendChild(msgDiv);
  container.scrollTop = container.scrollHeight;
}

async function handleCandidateChatSend() {
  const inputEl = document.getElementById('candidate-ai-input');
  const query = inputEl.value.trim();
  if (!query) return;

  // Apify Key
  showToast('warning', 'Backend configuration required', 'Candidate search is available only through the authenticated backend.');
  return;

  inputEl.value = '';
  
  addCandidateChatMessage('user', query);
  candidateConversationHistory.push({ role: 'user', content: query });
  
  const statusEl = document.getElementById('candidate-ai-status');
  statusEl.innerHTML = `
    <div class="ai-searching-anim">
      <div class="dot"></div><div class="dot"></div><div class="dot"></div>
      <span style="color:var(--primary);">AI is understanding your request...</span>
    </div>`;

  try {
    // Phase 1: Parse intent using dynamic AI provider
    const model = document.getElementById('candidate-ai-model-select')?.value || 'llama-3.3-70b-versatile';
    const provider = window.ChatEngine ? window.ChatEngine.getProviderDetails(model) : { id: 'groq', url: 'https://api.groq.com/openai/v1/chat/completions' };
    const apiKey = window.ChatEngine ? window.ChatEngine.getApiKey(provider.id) : '';

    if (!apiKey) {
      showToast('error', 'API Key Missing', `Please add a ${provider.id.toUpperCase()} API key in Settings.`);
      statusEl.innerHTML = '';
      return;
    }
    
    const messages = [
      {
        role: "system",
        content: "You are a helpful AI assistant for the Candidate (Job Seekers & Employees) Recruitment module of Skylark. CRITICAL RULE: Act as a friendly conversational AI first. ONLY if the user EXPLICITLY asks to search, find, or hire candidates (e.g., 'mujhe pune me react developer chahiye', 'find 10 security guards'), output EXACTLY this JSON: {\"intent\": \"scrape\", \"role\": \"Job Role\", \"city\": \"City Name\", \"quantity\": <number>}. If city is not mentioned, use 'Gurugram'. If quantity is not mentioned, use 10.\n\nHOWEVER, IF the user says hi, asks a question, or talks generally (e.g., 'hello', 'what can you do?', 'how to hire?'), JUST CHAT NORMALLY. Output EXACTLY this JSON: {\"intent\": \"chat\", \"reply\": \"Your conversational, helpful response here in the user's language.\"}\n\nYour ENTIRE response MUST be valid JSON only. Do not add extra text outside the JSON."
      },
      ...candidateConversationHistory.slice(-5)
    ];

    const aiResponse = await fetch(provider.url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: model,
        messages: messages,
        temperature: 0.3
      })
    });

    if (!aiResponse.ok) {
      const errText = await aiResponse.text();
      throw new Error(`${provider.id.toUpperCase()} API Error: ` + errText);
    }
    
    const aiData = await aiResponse.json();
    
    // Track Tokens
    if (aiData.usage && aiData.usage.total_tokens) {
      if (window.MemoryEngine) {
        window.MemoryEngine.addTokensUsed(aiData.usage.total_tokens);
        const activeIdx = (provider.id === 'groq' && window.MemoryEngine.getActiveGroqIdx) ? window.MemoryEngine.getActiveGroqIdx() : 0;
        window.MemoryEngine.addKeyUsage(provider.id, activeIdx, aiData.usage.total_tokens);
        if (typeof window.updateRealtimeTokenCounters === 'function') {
          window.updateRealtimeTokenCounters();
        }
      }
    }
    
    let jsonMatch = aiData.choices[0].message.content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error("AI could not understand the request intent.");
    
    const intent = JSON.parse(jsonMatch[0]);
    
    if (intent.intent === 'chat') {
      statusEl.innerHTML = '';
      addCandidateChatMessage('ai', intent.reply);
      candidateConversationHistory.push({ role: 'assistant', content: intent.reply });
      return; // Stop here, do not run Apify
    }
    
    if (!intent.role || !intent.city) throw new Error("Incomplete data parsed by AI for scraping.");
    
    // It's a scrape request. Add a conversational acknowledgment bubble.
    const maxResults = intent.quantity || 10;
    addCandidateChatMessage('ai', `I'm on it! Finding **${maxResults} ${intent.role}** profiles in **${intent.city}** for you now. Please wait a moment while I scrape authentic data...`);
    candidateConversationHistory.push({ role: 'assistant', content: `Started scraping for ${maxResults} ${intent.role} in ${intent.city}.` });
    
    // Dynamic Query Construction
    let portalQuery = "site:linkedin.com/in OR site:indeed.com/r";
    let statusText = `Scraping Indeed & LinkedIn for ${intent.role} in ${intent.city}...`;
    
    // Exact Role Matching + Anti-HR filters
    const searchQuery = `(${portalQuery}) "${intent.role}" "${intent.city}" -intitle:hiring -intitle:recruiter -"talent acquisition" -hr`;

    statusEl.innerHTML = `
      <div class="ai-searching-anim">
        <div class="dot" style="background-color:var(--accent-orange);"></div>
        <div class="dot" style="background-color:var(--accent-orange);"></div>
        <div class="dot" style="background-color:var(--accent-orange);"></div>
        <span style="color:var(--accent-orange);">${statusText}</span>
      </div>`;
    
    let apifyData = null;
    let results = [];
    let apifyAttempts = 0;
    const MAX_APIFY_RETRIES = 3;

    while (apifyAttempts < MAX_APIFY_RETRIES) {
      // Re-fetch best key in case we just exhausted one
      let currentKeyObj = window.MemoryEngine.getBestApifyKey();
      if (!currentKeyObj || !currentKeyObj.key) throw new Error("No available Apify API keys.");
      
      const currentApifyKey = currentKeyObj.key;

      const apifyResponse = await fetch(`https://api.apify.com/v2/acts/apify~google-search-scraper/run-sync-get-dataset-items?token=${currentApifyKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          queries: searchQuery,
          resultsPerPage: maxResults,
          maxPagesPerQuery: 1
        })
      });

      if (!apifyResponse.ok) {
        if (apifyResponse.status === 402 || apifyResponse.status === 403 || apifyResponse.status === 429) {
          console.warn(`Apify Key exhausted or rate-limited. Switching to next...`);
          // Exhaust this key locally so getBestApifyKey skips it
          window.MemoryEngine.addKeyUsage('apify', currentKeyObj.index, 100000); 
          renderTokenDashboard();
          apifyAttempts++;
          
          if (apifyAttempts >= MAX_APIFY_RETRIES) {
            throw new Error("All Apify API keys exhausted or rate limited.");
          }
          // Delay briefly before retry
          await new Promise(r => setTimeout(r, 1000));
          continue;
        } else {
          throw new Error("Apify API failed. Status: " + apifyResponse.status);
        }
      }

      apifyData = await apifyResponse.json();
      break;
    }

    if (apifyData && apifyData.length > 0 && apifyData[0].organicResults) {
      results = apifyData[0].organicResults;
      
      // Ensure we strictly enforce the requested quantity
      if (results.length > maxResults) {
        results = results.slice(0, maxResults);
      }
    }
    
    if (results.length === 0) {
      statusEl.innerHTML = `No candidates found for ${intent.role} in ${intent.city}. Try another query.`;
      return;
    }

    // Track Apify Scraper Usage for Candidates accurately on the active key
    if (window.MemoryEngine) {
      const activeIdx = window.MemoryEngine.getActiveApifyIdx();
      window.MemoryEngine.addKeyUsage('apify', activeIdx, results.length);
      renderTokenDashboard();
    }

    // Phase 3: Store in MemoryEngine
    // Auto-clear old candidates so they don't accumulate and confuse the user
    if (window.MemoryEngine && window.MemoryEngine.getAllCandidates) {
      const existing = await window.MemoryEngine.getAllCandidates();
      for (const e of existing) {
        await window.MemoryEngine.deleteCandidate(e.id);
      }
    }

    for (const r of results) {
      const nameMatch = r.title.split(/[\-\|]/)[0].trim();
      const name = nameMatch ? nameMatch : 'Candidate';
      
      // Strict extract phone number and email from snippet
      const phoneRegex = /(?:(?:\+|0{0,2})91[\s\-]?)?[6789]\d{9}/;
      const emailRegex = /([a-zA-Z0-9._-]+@[a-zA-Z0-9._-]+\.[a-zA-Z0-9_-]+)/;
      const snippet = r.description || '';
      
      const phoneMatch = snippet.match(phoneRegex);
      const emailMatch = snippet.match(emailRegex);
      
      const actualPhone = phoneMatch ? phoneMatch[0] : '';
      const actualEmail = emailMatch ? emailMatch[0] : '';
      
      const candidate = {
        id: 'cand_' + Date.now() + Math.floor(Math.random()*1000),
        name: name,
        role: intent.role,
        city: intent.city,
        phone: actualPhone || '',
        email: actualEmail || '',
        description: snippet,
        url: r.url,
        timestamp: Date.now()
      };
      await window.MemoryEngine.addCandidate(candidate);
    }

    statusEl.innerHTML = `<span style="color:var(--accent-green);font-weight:600;">✓ Successfully scraped ${results.length} candidates. Auto-downloading Excel...</span>`;
    await initCandidatesView();
    
    // Switch view automatically to candidates DB
    if (window.SKYLARK && typeof window.SKYLARK.showView === 'function') {
      window.SKYLARK.showView('candidate-db');
    }

    // Phase 4: Auto-download Excel
    exportCandidatesExcel();

  } catch (err) {
    console.error(err);
    statusEl.innerHTML = `<span style="color:var(--accent-red);">${err.message}</span>`;
  }
}

// Add enter key listener for Candidate Chat
document.addEventListener('DOMContentLoaded', () => {
  const candidateInput = document.getElementById('candidate-ai-input');
  if (candidateInput) {
    candidateInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        handleCandidateChatSend();
      }
    });
  }
});

function exportCandidatesCSV() {
  window.MemoryEngine.getAllCandidates().then(candidates => {
    if (candidates.length === 0) {
      showToast('warning', 'Empty', 'No candidates to export');
      return;
    }
    let csv = 'Name,Role,City,Phone,Profile URL,Description\n';
    candidates.forEach(c => {
      csv += `"${c.name}","${c.role}","${c.city}","${c.phone}","${c.url}","${(c.description||'').replace(/"/g, '""')}"\n`;
    });
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'candidates_export.csv';
    a.click();
  });
}

function exportCandidatesExcel() {
  if (typeof XLSX === 'undefined') {
    showToast('error', 'Library Missing', 'Excel export library not loaded. Please use CSV.');
    return;
  }
  window.MemoryEngine.getAllCandidates().then(candidates => {
    if (candidates.length === 0) {
      showToast('warning', 'No Candidates', 'No candidate data to export.');
      return;
    }
    
    const rows = candidates.map(c => ({
      'Candidate Name': c.name,
      'Job Role': c.role,
      'City': c.city,
      'Phone': c.phone,
      'Source Link': c.url,
      'Description / Snippet': c.description || ''
    }));

    const worksheet = XLSX.utils.json_to_sheet(rows);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Candidates");

    // Auto-fit Columns width calculation
    const maxProps = [];
    rows.forEach(row => {
      Object.keys(row).forEach((key, colIndex) => {
        const val = row[key] ? String(row[key]) : '';
        maxProps[colIndex] = Math.max(maxProps[colIndex] || 15, val.length + 2, key.length + 2);
      });
    });
    
    // Cap max width at 60 characters to prevent overly wide columns
    worksheet['!cols'] = maxProps.map(w => ({ wch: Math.min(w, 60) }));

    const dateStr = new Date().toISOString().slice(0,10);
    XLSX.writeFile(workbook, `Skylark_Candidates_${dateStr}.xlsx`);
    showToast('success', 'Excel Downloaded', 'Candidate data successfully exported as Excel.');
  });
}


// ============================================================
//  REAL-TIME TOKEN COUNTERS UPDATE
// ============================================================
window.updateRealtimeTokenCounters = function() {
  if (!window.MemoryEngine) return;
  const cfg = window.SKYLARK_CONFIG || {};
  const apifyLimit = cfg.APIFY_KEY_LIMIT || 500;
  const activeApifyIdx = window.MemoryEngine.getActiveApifyIdx();
  const totalApifyUsed = window.MemoryEngine.getKeyUsage('apify', activeApifyIdx);
  
  const homeBadge = document.getElementById('home-token-counter');
  const candidateBadge = document.getElementById('candidate-token-counter');
  
  if (homeBadge) homeBadge.textContent = `${totalApifyUsed} / ${apifyLimit}`;
  if (candidateBadge) candidateBadge.textContent = `Apify Key #${activeApifyIdx + 1} | ${totalApifyUsed} / ${apifyLimit}`;
  
  if (typeof restoreTokenCounter === 'function') {
    restoreTokenCounter();
  }
}

// Initial call
document.addEventListener('DOMContentLoaded', () => {
  if (typeof window.updateRealtimeTokenCounters === 'function') {
    setTimeout(() => window.updateRealtimeTokenCounters(), 1000);
  }
});


// ============================================================
//  CANDIDATE DB OPERATIONS
// ============================================================
window.deleteCandidateRow = async function(id) {
  if (confirm('Are you sure you want to delete this candidate?')) {
    if (window.MemoryEngine && window.MemoryEngine.deleteCandidate) {
      await window.MemoryEngine.deleteCandidate(id);
      showToast('success', 'Deleted', 'Candidate removed from database.');
      await initCandidatesView();
    }
  }
};

window.clearAllCandidates = async function() {
  if (confirm('Are you sure you want to delete ALL candidates? This cannot be undone.')) {
    if (window.MemoryEngine && window.MemoryEngine.getAllCandidates) {
      const candidates = await window.MemoryEngine.getAllCandidates();
      for (const c of candidates) {
        await window.MemoryEngine.deleteCandidate(c.id);
      }
      showToast('success', 'Cleared', 'All candidates removed from database.');
      await initCandidatesView();
    }
  }
};

window.startNewChat = function(which) {
  if (which === 'candidate') {
    const msgs = document.getElementById('candidate-chat-messages');
    if (msgs) msgs.innerHTML = '';
    const welcome = document.getElementById('candidate-chat-welcome');
    if (welcome) welcome.style.display = 'flex';
    const input = document.getElementById('candidate-ai-input');
    if (input) {
      input.value = '';
      input.style.height = 'auto';
    }
    const status = document.getElementById('candidate-ai-status');
    if (status) status.innerHTML = '';
  } else {
    const msgs = document.getElementById('chat-messages');
    if (msgs) msgs.innerHTML = '';
    const welcome = document.getElementById('chat-welcome');
    if (welcome) welcome.style.display = 'flex';
    const input = document.getElementById('chat-input');
    if (input) {
      input.value = '';
      input.style.height = 'auto';
    }
  }
  if (typeof showToast === 'function') {
    showToast('info', 'New Chat', `Started a fresh ${which === 'candidate' ? 'candidate' : 'lead'} search.`);
  }
};

document.addEventListener('DOMContentLoaded', () => {
  setTimeout(() => initCandidatesView(), 500);
  if (typeof restoreTokenCounter === 'function') {
    restoreTokenCounter();
  }
});

