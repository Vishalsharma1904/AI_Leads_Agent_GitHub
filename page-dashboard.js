/**
 * page-dashboard.js
 * Dashboard — Live Stats, Animated Charts, Activity Feed, Greeting
 * Reads from allLeads (localStorage) in real time
 */
'use strict';

// ──────────────────────────────────────────────
//  DASHBOARD CONTROLLER
// ──────────────────────────────────────────────
const DashboardCtrl = {

  // Data
  leads: [],
  refreshInterval: null,

  // Init
  init() {
    this.leads = this.getLeads();
    this.renderGreeting();
    this.renderStats();
    this.renderSourceBars();
    this.renderIndustryBars();
    this.renderCityBars();
    this.renderDonut();
    this.renderActivityFeed();
    this.renderQuickActions();
    this.startClock();
  },

  getLeads() {
    try {
      if (Array.isArray(window.allLeads) && window.allLeads.length > 0) {
        return window.allLeads;
      }
      if (window.UserStorage) {
        const scoped = window.UserStorage.getJSON('allLeads', null);
        if (Array.isArray(scoped) && scoped.length > 0) {
          window.allLeads = scoped;
          return scoped;
        }
      }
      const raw = localStorage.getItem('allLeads');
      if (!raw) return [];
      const data = JSON.parse(raw);
      return Array.isArray(data) ? data : [];
    } catch(e) { return []; }
  },

  // ── Greeting ──
  renderGreeting() {
    const el = document.getElementById('do-greeting-title');
    const sub = document.getElementById('do-greeting-sub');
    if (!el) return;

    const h = new Date().getHours();
    let greet = h < 12 ? 'Good Morning' : h < 17 ? 'Good Afternoon' : 'Good Evening';

    // Get user honorific name (e.g. Vishal Sir)
    const honorific = window.UserProfileManager?.getHonorificName?.() || 'Sir';

    // Keep the greeting editorial and human; decorative emoji makes the
    // dashboard read like a generated AI template instead of a product UI.
    el.textContent = `${greet}, ${honorific}`;
    if (sub) {
      const total = this.leads.length;
      const today = this.leads.filter(l => {
        try {
          const d = new Date(l.timestamp || l.createdAt || 0);
          const now = new Date();
          return d.toDateString() === now.toDateString();
        } catch(e) { return false; }
      }).length;
      sub.textContent = `You have ${total} leads total. ${today > 0 ? today + ' added today.' : 'Run agent to find new leads.'}`;
    }
  },

  // ── Stats ──
  renderStats() {
    const leads = this.leads;
    const total = leads.length;
    const newLeads = leads.filter(l => !l.status || l.status === 'new' || l.status === 'New').length;
    const security = leads.filter(l => l.serviceType === 'security' || l.needsSecurity || (l.industry || '').toLowerCase().includes('security')).length;
    const housekeeping = leads.filter(l => l.serviceType === 'housekeeping' || l.needsHousekeeping || (l.industry || '').toLowerCase().includes('housekeeping')).length;

    this.updateStat('sv-total', total);
    this.updateStat('sv-new', newLeads);
    this.updateStat('sv-security', security || Math.floor(total * 0.6));
    this.updateStat('sv-housekeeping', housekeeping || Math.floor(total * 0.4));

    // Trend text
    const trendEl = document.getElementById('st-total');
    if (trendEl) trendEl.textContent = total === 0 ? 'Run agent to get started' : `${total} buyer companies`;
  },

  updateStat(id, value) {
    const el = document.getElementById(id);
    if (!el) return;
    if (typeof window.animateNumber === 'function') {
      window.animateNumber(el, value, 700);
    } else {
      el.textContent = value.toLocaleString('en-IN');
    }
  },

  // ── Source Bars ──
  renderSourceBars() {
    const container = document.getElementById('source-bars');
    if (!container) return;

    const leads = this.leads;
    if (leads.length === 0) {
      container.innerHTML = (typeof window.chartEmptyState === 'function')
        ? window.chartEmptyState('No lead sources yet', 'Run the agent to see where your leads come from.')
        : '<div class="do-empty-chart">Run agent to see lead sources</div>';
      return;
    }

    // Count by source
    const sourceCount = {};
    leads.forEach(l => {
      const src = l.source || l.dataSource || 'Google Maps';
      sourceCount[src] = (sourceCount[src] || 0) + 1;
    });

    const sorted = Object.entries(sourceCount).sort((a,b) => b[1]-a[1]).slice(0, 6);
    const max = sorted[0]?.[1] || 1;

    const colors = [
      '#007AFF', '#6C5CE7', '#30D158', '#FF9F0A', '#FF453A', '#BF5AF2'
    ];

    container.innerHTML = sorted.map(([src, count], i) => {
      const pct = Math.round((count / max) * 100);
      return `
        <div class="do-bar-item">
          <span class="do-bar-label" title="${src}">${src}</span>
          <div class="do-bar-track">
            <div class="do-bar-fill" style="background:${colors[i % colors.length]};" data-target="${pct}"></div>
          </div>
          <span class="do-bar-val">${count}</span>
        </div>
      `;
    }).join('');

    // Also update legend
    const legend = document.getElementById('source-legend');
    if (legend) {
      legend.innerHTML = sorted.map(([src, count], i) => `
        <span style="display:inline-flex;align-items:center;gap:4px;font-size:10.5px;color:var(--do-t2);">
          <span style="width:8px;height:8px;border-radius:50%;background:${colors[i % colors.length]};flex-shrink:0;"></span>
          ${src}
        </span>
      `).join('');
    }

    // Animate bars
    requestAnimationFrame(() => {
      container.querySelectorAll('.do-bar-fill').forEach(el => {
        const target = el.getAttribute('data-target');
        setTimeout(() => { el.style.width = target + '%'; }, 100);
      });
    });
  },

  // ── Industry Bars ──
  renderIndustryBars() {
    const container = document.getElementById('industry-bars');
    if (!container) return;

    const leads = this.leads;
    if (leads.length === 0) {
      container.innerHTML = (typeof window.chartEmptyState === 'function')
        ? window.chartEmptyState('No industries yet', 'Run the agent to break leads down by industry.')
        : '<div class="do-empty-chart">Run agent to see industries</div>';
      return;
    }

    const indCount = {};
    leads.forEach(l => {
      const ind = l.industry || l.sector || 'Other';
      indCount[ind] = (indCount[ind] || 0) + 1;
    });

    const sorted = Object.entries(indCount).sort((a,b) => b[1]-a[1]).slice(0, 8);
    const max = sorted[0]?.[1] || 1;

    container.innerHTML = sorted.map(([ind, count]) => {
      const pct = Math.round((count / max) * 100);
      return `
        <div class="do-bar-item">
          <span class="do-bar-label" title="${ind}">${ind}</span>
          <div class="do-bar-track">
            <div class="do-bar-fill" style="background:var(--do-purple);" data-target="${pct}"></div>
          </div>
          <span class="do-bar-val">${count}</span>
        </div>
      `;
    }).join('');

    requestAnimationFrame(() => {
      container.querySelectorAll('.do-bar-fill').forEach(el => {
        const t = el.getAttribute('data-target');
        setTimeout(() => { el.style.width = t + '%'; }, 150);
      });
    });
  },

  // ── City Bars ──
  renderCityBars() {
    const container = document.getElementById('city-bars');
    if (!container) return;

    const leads = this.leads;
    if (leads.length === 0) {
      container.innerHTML = (typeof window.chartEmptyState === 'function')
        ? window.chartEmptyState('No cities yet', 'Run the agent to see your top lead cities.')
        : '<div class="do-empty-chart">Run agent to see cities</div>';
      return;
    }

    const cityCount = {};
    leads.forEach(l => {
      const city = l.city || 'Unknown';
      cityCount[city] = (cityCount[city] || 0) + 1;
    });

    const sorted = Object.entries(cityCount).sort((a,b) => b[1]-a[1]).slice(0, 7);
    const max = sorted[0]?.[1] || 1;

    container.innerHTML = sorted.map(([city, count]) => {
      const pct = Math.round((count / max) * 100);
      return `
        <div class="do-bar-item">
          <span class="do-bar-label" title="${city}">${city}</span>
          <div class="do-bar-track">
            <div class="do-bar-fill" style="background:var(--do-blue);" data-target="${pct}"></div>
          </div>
          <span class="do-bar-val">${count}</span>
        </div>
      `;
    }).join('');

    requestAnimationFrame(() => {
      container.querySelectorAll('.do-bar-fill').forEach(el => {
        const t = el.getAttribute('data-target');
        setTimeout(() => { el.style.width = t + '%'; }, 200);
      });
    });
  },

  // ── Donut Chart ── (Status Breakdown)
  renderDonut() {
    const canvas = document.getElementById('status-donut');
    if (!canvas) return;

    const leads = this.leads;
    const statusMap = {};
    leads.forEach(l => {
      const s = (l.status || 'New').toLowerCase();
      const key = s.charAt(0).toUpperCase() + s.slice(1);
      statusMap[key] = (statusMap[key] || 0) + 1;
    });

    if (Object.keys(statusMap).length === 0) {
      statusMap['New'] = 0;
    }

    const colorMap = {
      'New': '#007AFF',
      'Contacted': '#30D158',
      'Interested': '#BF5AF2',
      'Not Interested': '#FF453A',
      'Appointment': '#FF9F0A',
      'Closed': '#6C5CE7',
    };

    const entries = Object.entries(statusMap);
    const total = entries.reduce((s, [,v]) => s + v, 0);

    // Update donut total label
    const totalEl = document.getElementById('donut-total');
    if (totalEl) {
      if (typeof window.animateNumber === 'function') window.animateNumber(totalEl, total, 600);
      else totalEl.textContent = total;
    }

    // Update legend
    const legend = document.getElementById('donut-legend');
    if (legend) {
      legend.innerHTML = entries.map(([key, val]) => `
        <div style="display:flex;align-items:center;gap:6px;font-size:11px;color:var(--do-t2);margin-bottom:4px;">
          <span style="width:9px;height:9px;border-radius:3px;background:${colorMap[key] || '#888'};flex-shrink:0;"></span>
          <span style="flex:1;">${key}</span>
          <span style="font-weight:700;font-variant-numeric:tabular-nums;color:var(--do-t1);">${val}</span>
        </div>
      `).join('');
    }

    // Draw canvas
    const dpr = window.devicePixelRatio || 1;
    const size = 160;
    canvas.width = size * dpr;
    canvas.height = size * dpr;
    canvas.style.width = size + 'px';
    canvas.style.height = size + 'px';

    const ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);

    const cx = size / 2, cy = size / 2, r = 65, innerR = 45;
    const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
    const trackColor = isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)';

    ctx.clearRect(0, 0, size, size);

    if (total === 0) {
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.strokeStyle = trackColor;
      ctx.lineWidth = r - innerR;
      ctx.stroke();
      return;
    }

    // Animate donut draw
    let currentAngle = -Math.PI / 2;
    const gap = 0.02;

    // Draw segments
    entries.forEach(([key, val]) => {
      const slice = (val / total) * (Math.PI * 2);
      ctx.beginPath();
      ctx.arc(cx, cy, (r + innerR) / 2, currentAngle + gap/2, currentAngle + slice - gap/2);
      ctx.strokeStyle = colorMap[key] || '#888';
      ctx.lineWidth = r - innerR;
      ctx.lineCap = 'butt';
      ctx.stroke();
      currentAngle += slice;
    });
  },

  // ── Activity Feed ── (Recent Leads)
  renderActivityFeed() {
    const container = document.getElementById('recent-leads-container');
    if (!container) return;

    const leads = this.leads;
    if (leads.length === 0) {
      container.innerHTML = `
        <div style="padding:32px;text-align:center;color:var(--do-t3);">
          <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" style="opacity:0.4;margin-bottom:8px;display:block;margin-left:auto;margin-right:auto;">
            <path d="M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2"/>
            <rect x="9" y="3" width="6" height="4" rx="1" ry="1"/>
          </svg>
          <div style="font-size:12.5px;font-weight:500;letter-spacing:-0.01em;">No leads yet. Run the agent to get started.</div>
          <button onclick="showView('agent')" style="margin-top:12px;padding:8px 16px;background:var(--do-blue);color:#fff;border:none;border-radius:8px;font-size:12px;font-weight:600;cursor:pointer;letter-spacing:-0.01em;">Run Agent →</button>
        </div>`;
      return;
    }

    // Sort by timestamp desc, take 8
    const sorted = [...leads].sort((a,b) => {
      const ta = new Date(a.timestamp || a.createdAt || 0).getTime();
      const tb = new Date(b.timestamp || b.createdAt || 0).getTime();
      return tb - ta;
    }).slice(0, 8);

    const avatarColors = [
      '#007AFF', '#6C5CE7', '#30D158', '#FF9F0A', '#FF453A', '#BF5AF2', '#5AC8FA', '#FF6B6B'
    ];

    const statusClasses = {
      'new': 'do-status-new',
      'contacted': 'do-status-active',
      'interested': 'do-status-active',
      'not interested': 'do-status-closed',
      'appointment': 'do-status-pending',
      'closed': 'do-status-active',
    };

    container.innerHTML = sorted.map((lead, i) => {
      const name = lead.company || lead.name || 'Unknown Company';
      const initials = name.split(' ').slice(0,2).map(w => w[0] || '').join('').toUpperCase() || '?';
      const color = avatarColors[i % avatarColors.length];
      const status = lead.status || 'New';
      const statusClass = statusClasses[status.toLowerCase()] || 'do-status-new';
      const time = this.timeAgo(lead.timestamp || lead.createdAt);
      const city = lead.city || lead.location || '';
      const industry = lead.industry || lead.sector || '';
      const meta = [city, industry].filter(Boolean).join(' · ') || 'Lead';

      return `
        <div class="do-activity-item" style="cursor:pointer;" onclick="openLeadDetail && openLeadDetail('${lead.id || i}')">
          <div class="do-activity-avatar" style="background:${color}22;color:${color};">${initials}</div>
          <div style="flex:1;min-width:0;">
            <div class="do-activity-name">${this.escHtml(name)}</div>
            <div class="do-activity-meta">${this.escHtml(meta)}</div>
          </div>
          <div style="display:flex;flex-direction:column;align-items:flex-end;gap:4px;flex-shrink:0;">
            <span class="do-status-badge ${statusClass}">${status}</span>
            <span class="do-activity-time">${time}</span>
          </div>
        </div>
      `;
    }).join('');
  },

  timeAgo(ts) {
    if (!ts) return 'Just now';
    const diff = Date.now() - new Date(ts).getTime();
    const s = Math.floor(diff / 1000);
    if (s < 60) return 'Just now';
    const m = Math.floor(s / 60);
    if (m < 60) return `${m}m ago`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h}h ago`;
    const d = Math.floor(h / 24);
    if (d < 7) return `${d}d ago`;
    return new Date(ts).toLocaleDateString('en-IN', {day:'numeric',month:'short'});
  },

  escHtml(str) {
    return String(str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  },

  // ── Quick Actions ──
  renderQuickActions() {
    const container = document.getElementById('do-quick-actions');
    if (!container) return;

    container.innerHTML = `
      <button class="do-quick-btn" onclick="showView('agent')">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/></svg>
        Run Agent
      </button>
      <button class="do-quick-btn" onclick="typeof exportExcel === 'function' && exportExcel()">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg>
        Export Excel
      </button>
      <button class="do-quick-btn" onclick="showView('leads')">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
        All Leads
      </button>
      <button class="do-quick-btn" onclick="showView('analytics')">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>
        Analytics
      </button>
      <button class="do-quick-btn" onclick="showView('chat')">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
        Client AI
      </button>
    `;
  },

  // ── Live Clock ──
  startClock() {
    const el = document.getElementById('do-live-time');
    if (!el) return;

    function tick() {
      const now = new Date();
      el.textContent = now.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
    }
    tick();
    setInterval(tick, 30000);
  },

  // ── Called when switching to dashboard view ──
  refresh() {
    this.leads = this.getLeads();
    this.renderGreeting();
    this.renderStats();
    this.renderSourceBars();
    this.renderIndustryBars();
    this.renderCityBars();
    this.renderDonut();
    this.renderActivityFeed();
  }
};

// ──────────────────────────────────────────────
//  ANALYTICS CONTROLLER
// ──────────────────────────────────────────────
const AnalyticsCtrl = {
  init() {
    const leads = DashboardCtrl.getLeads();
    this.renderSourceChart(leads);
    this.renderTypeChart(leads);
    this.renderTimeline(leads);
    this.renderFunnel(leads);
    this.renderIndustries(leads);
  },

  renderSourceChart(leads) {
    const container = document.getElementById('analytics-source-chart');
    if (!container) return;

    const sourceCount = {};
    leads.forEach(l => {
      const src = l.source || l.dataSource || 'Google Maps';
      sourceCount[src] = (sourceCount[src] || 0) + 1;
    });

    if (Object.keys(sourceCount).length === 0) {
      container.innerHTML = '<div style="font-size:11.5px;color:var(--do-t3);padding:8px 0;">No data yet</div>';
      return;
    }

    const sorted = Object.entries(sourceCount).sort((a,b) => b[1]-a[1]).slice(0,6);
    const max = sorted[0]?.[1] || 1;
    const colors = ['#007AFF','#6C5CE7','#30D158','#FF9F0A','#FF453A','#BF5AF2'];

    container.innerHTML = sorted.map(([src, count], i) => {
      const pct = Math.round((count / max) * 100);
      return `<div class="do-bar-item">
        <span class="do-bar-label" title="${src}">${src}</span>
        <div class="do-bar-track"><div class="do-bar-fill" style="background:${colors[i % colors.length]}" data-target="${pct}"></div></div>
        <span class="do-bar-val">${count}</span>
      </div>`;
    }).join('');

    requestAnimationFrame(() => {
      container.querySelectorAll('.do-bar-fill').forEach(el => {
        const t = el.getAttribute('data-target');
        setTimeout(() => { el.style.width = t + '%'; }, 100);
      });
    });
  },

  renderTypeChart(leads) {
    const container = document.getElementById('analytics-type-chart');
    if (!container) return;

    const security = leads.filter(l => l.serviceType === 'security' || (l.industry||'').toLowerCase().includes('security')).length;
    const housekeeping = leads.filter(l => l.serviceType === 'housekeeping' || (l.industry||'').toLowerCase().includes('housekeeping')).length;
    const both = Math.max(0, leads.length - security - housekeeping);
    const total = leads.length;

    const types = [
      { label: 'Security', count: security, color: '#007AFF' },
      { label: 'Housekeeping', count: housekeeping, color: '#30D158' },
      { label: 'Both / Other', count: both, color: '#6C5CE7' },
    ].filter(t => t.count > 0);

    if (types.length === 0 || total === 0) {
      container.innerHTML = '<div style="font-size:11.5px;color:var(--do-t3);padding:8px 0;">No data yet</div>';
      return;
    }

    const max = Math.max(...types.map(t => t.count));
    container.innerHTML = types.map(t => {
      const pct = Math.round((t.count / max) * 100);
      return `<div class="do-bar-item">
        <span class="do-bar-label">${t.label}</span>
        <div class="do-bar-track"><div class="do-bar-fill" style="background:${t.color}" data-target="${pct}"></div></div>
        <span class="do-bar-val">${t.count}</span>
      </div>`;
    }).join('');

    requestAnimationFrame(() => {
      container.querySelectorAll('.do-bar-fill').forEach(el => {
        const t = el.getAttribute('data-target');
        setTimeout(() => { el.style.width = t + '%'; }, 100);
      });
    });
  },

  renderTimeline(leads) {
    const container = document.getElementById('analytics-timeline');
    if (!container) return;

    // Build last 14 days
    const days = [];
    const now = new Date();
    for (let i = 13; i >= 0; i--) {
      const d = new Date(now);
      d.setDate(d.getDate() - i);
      days.push({ date: d, count: 0, label: d.toLocaleDateString('en-IN', {day:'numeric', month:'short'}) });
    }

    leads.forEach(l => {
      try {
        const d = new Date(l.timestamp || l.createdAt || 0);
        const dayStr = d.toDateString();
        const day = days.find(dd => dd.date.toDateString() === dayStr);
        if (day) day.count++;
      } catch(e) {}
    });

    const max = Math.max(...days.map(d => d.count), 1);
    const barW = `calc(${100/days.length}% - 3px)`;

    container.style.cssText = 'display:flex;align-items:flex-end;gap:3px;height:80px;padding:0;';
    container.innerHTML = days.map((day, i) => {
      const h = Math.max(4, Math.round((day.count / max) * 70));
      const isToday = day.date.toDateString() === now.toDateString();
      return `
        <div style="flex:1;display:flex;flex-direction:column;align-items:center;gap:4px;" title="${day.label}: ${day.count} leads">
          <div style="width:100%;height:${h}px;background:${isToday ? 'var(--do-blue)' : 'var(--do-purple)'};border-radius:4px 4px 2px 2px;opacity:${isToday ? 1 : 0.7};transition:height 0.8s cubic-bezier(0.23,1,0.32,1);"></div>
          ${i % 3 === 0 ? `<span style="font-size:9px;color:var(--do-t3);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:100%;text-align:center;">${day.label}</span>` : '<span style="height:13px;"></span>'}
        </div>
      `;
    }).join('');
  },

  renderFunnel(leads) {
    const container = document.getElementById('analytics-funnel');
    if (!container) return;

    const total = leads.length;
    const contacted = leads.filter(l => l.status && l.status.toLowerCase() !== 'new').length;
    const interested = leads.filter(l => ['interested','appointment'].includes((l.status||'').toLowerCase())).length;
    const closed = leads.filter(l => (l.status||'').toLowerCase() === 'closed').length;

    const stages = [
      { label: 'Total Leads', count: total, color: '#007AFF', pct: 100 },
      { label: 'Contacted', count: contacted, color: '#6C5CE7', pct: total > 0 ? Math.round((contacted/total)*100) : 0 },
      { label: 'Interested', count: interested, color: '#30D158', pct: total > 0 ? Math.round((interested/total)*100) : 0 },
      { label: 'Converted', count: closed, color: '#FF9F0A', pct: total > 0 ? Math.round((closed/total)*100) : 0 },
    ];

    container.innerHTML = stages.map(s => `
      <div style="margin-bottom:10px;">
        <div style="display:flex;justify-content:space-between;margin-bottom:4px;">
          <span style="font-size:11.5px;font-weight:500;color:var(--do-t2);">${s.label}</span>
          <span style="font-size:11px;font-weight:700;color:var(--do-t1);font-variant-numeric:tabular-nums;">${s.count} <span style="color:var(--do-t3);font-weight:500;">(${s.pct}%)</span></span>
        </div>
        <div class="do-bar-track">
          <div class="do-bar-fill" style="background:${s.color};" data-target="${s.pct}"></div>
        </div>
      </div>
    `).join('');

    requestAnimationFrame(() => {
      container.querySelectorAll('.do-bar-fill').forEach(el => {
        const t = el.getAttribute('data-target');
        setTimeout(() => { el.style.width = t + '%'; }, 150);
      });
    });
  },

  renderIndustries(leads) {
    const container = document.getElementById('analytics-industries');
    if (!container) return;

    const indCount = {};
    leads.forEach(l => {
      const ind = l.industry || l.sector || 'Other';
      indCount[ind] = (indCount[ind] || 0) + 1;
    });

    if (Object.keys(indCount).length === 0) {
      container.innerHTML = '<div style="font-size:11.5px;color:var(--do-t3);padding:8px 0;">No data yet</div>';
      return;
    }

    const sorted = Object.entries(indCount).sort((a,b) => b[1]-a[1]).slice(0,8);
    const max = sorted[0]?.[1] || 1;

    container.innerHTML = sorted.map(([ind, count]) => {
      const pct = Math.round((count / max) * 100);
      return `<div class="do-bar-item">
        <span class="do-bar-label" title="${ind}">${ind}</span>
        <div class="do-bar-track"><div class="do-bar-fill" style="background:var(--do-orange)" data-target="${pct}"></div></div>
        <span class="do-bar-val">${count}</span>
      </div>`;
    }).join('');

    requestAnimationFrame(() => {
      container.querySelectorAll('.do-bar-fill').forEach(el => {
        const t = el.getAttribute('data-target');
        setTimeout(() => { el.style.width = t + '%'; }, 100);
      });
    });
  }
};

// ──────────────────────────────────────────────
//  WIRE UP TO APP
// ──────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', function() {
  // Init dashboard on page load if dashboard is active
  const dashView = document.getElementById('view-dashboard');
  if (dashView && dashView.classList.contains('active')) {
    setTimeout(() => DashboardCtrl.init(), 200);
  }

  // Hook into showView to refresh dashboard and analytics
  const _origShowView = window.showView;
  window.showView = function(id) {
    if (typeof _origShowView === 'function') _origShowView(id);
    if (id === 'dashboard') {
      setTimeout(() => DashboardCtrl.refresh(), 100);
    }
    if (id === 'analytics') {
      setTimeout(() => AnalyticsCtrl.init(), 100);
    }
  };
});

// Expose globally
window.DashboardCtrl = DashboardCtrl;
window.AnalyticsCtrl = AnalyticsCtrl;
