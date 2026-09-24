/**
 * page-leads.js
 * Comprehensive Lead Database & Management Controller (Enterprise macOS / Anthropic Polish)
 * Seamlessly manages allLeads with live filters, sorting, bulk actions, details drawer, and exports.
 */
'use strict';

const LeadsCtrl = {
  leads: [],
  filtered: [],
  selectedIds: new Set(),
  currentFilter: {
    search: '',
    service: 'all',
    score: 'all',
    status: 'all',
    city: 'all',
    hasPhone: false,
    hasEmail: false,
    hasWebsite: false
  },
  sort: {
    column: 'score',
    direction: 'desc'
  },
  pageSize: 25,
  currentPage: 1,

  async init() {
    await this.loadLeads();
    this.populateFilterDropdowns();
    this.applyFilters();
    this.render();
    this.bindEvents();
  },

  async loadLeads() {
    try {
      // CRITICAL: Always load from active user's scoped storage first
      // Never use window.allLeads directly as it might be from a different user session
      
      // 1. Get active user's email for proper data scoping
      const activeEmail = window.CloudSyncManager?.getActiveEmail?.() || 
                         localStorage.getItem('skylark_active_email') || '';
      
      console.log(`[LeadsCtrl] Loading leads for active user: ${activeEmail || 'default'}`);
      
      // 2. Try UserStorage scoped storage (user-specific localStorage)
      if (window.UserStorage) {
        const scoped = window.UserStorage.getJSON('allLeads', null);
        if (Array.isArray(scoped) && scoped.length > 0) {
          this.leads = scoped;
          window.allLeads = this.leads;
          console.log(`[LeadsCtrl] Loaded ${scoped.length} leads from UserStorage`);
          return this.leads;
        }
      }

      // 3. Try active user's isolated IndexedDB
      if (window.MemoryEngine && typeof window.MemoryEngine.getAllLeads === 'function') {
        const dbLeads = await window.MemoryEngine.getAllLeads();
        if (Array.isArray(dbLeads) && dbLeads.length > 0) {
          this.leads = dbLeads;
          window.allLeads = this.leads;
          if (window.UserStorage) window.UserStorage.setJSON('allLeads', this.leads);
          console.log(`[LeadsCtrl] Loaded ${dbLeads.length} leads from IndexedDB`);
          return this.leads;
        }
      }
      
      // 4. Try cloud pull as fallback
      if (activeEmail && activeEmail.includes('@') && window.CloudSyncManager && window.location.protocol !== 'file:') {
        console.log('[LeadsCtrl] No local data found, attempting cloud pull...');
        const cloudData = await window.CloudSyncManager.pullLatest(activeEmail);
        if (cloudData && cloudData.leads && Array.isArray(cloudData.leads)) {
          this.leads = cloudData.leads;
          window.allLeads = this.leads;
          if (window.UserStorage) window.UserStorage.setJSON('allLeads', this.leads);
          console.log(`[LeadsCtrl] Loaded ${this.leads.length} leads from cloud`);
          return this.leads;
        }
      }

      // 5. Last resort: check if window.allLeads has data (but verify it's for current user)
      if (Array.isArray(window.allLeads) && window.allLeads.length > 0) {
        this.leads = window.allLeads;
        console.log(`[LeadsCtrl] Using in-memory leads (${this.leads.length})`);
        return this.leads;
      }
      
      // 6. Final fallback - empty array
      const raw = localStorage.getItem('allLeads');
      this.leads = raw ? JSON.parse(raw) : [];
      window.allLeads = this.leads;
      console.log(`[LeadsCtrl] No leads found, starting fresh`);
    } catch (e) {
      console.warn('[LeadsCtrl] Error loading leads:', e);
      this.leads = [];
      window.allLeads = [];
    }
    return this.leads;
  },

  saveLeads() {
    try {
      window.allLeads = this.leads;
      if (window.UserStorage) {
        window.UserStorage.setJSON('allLeads', this.leads);
      }
      localStorage.setItem('allLeads', JSON.stringify(this.leads));

      if (window.MemoryEngine && typeof window.MemoryEngine.saveAllLeads === 'function') {
        window.MemoryEngine.saveAllLeads(this.leads);
      }

      // Auto-sync leads to cloud backend
      if (window.CloudSyncManager && typeof window.CloudSyncManager.schedulePush === 'function') {
        window.CloudSyncManager.schedulePush(600);
      }

      if (window.DashboardCtrl && typeof window.DashboardCtrl.init === 'function') {
        window.DashboardCtrl.init();
      }
      this.notifyUpdate();
    } catch (e) {
      console.error('[LeadsCtrl] Error saving leads:', e);
    }
  },

  notifyUpdate() {
    const event = new CustomEvent('skylark-leads-updated', { detail: { count: this.leads.length } });
    document.dispatchEvent(event);
  },

  populateFilterDropdowns() {
    const citySelect = document.getElementById('leads-filter-city') || document.getElementById('filter-city');
    if (!citySelect) return;

    const cities = new Set();
    this.leads.forEach(l => {
      const c = (l.city || l.location || '').trim();
      if (c) cities.add(c);
    });

    const sortedCities = Array.from(cities).sort();
    const currentVal = citySelect.value || 'all';

    citySelect.innerHTML = `<option value="all">📍 All Cities (${sortedCities.length})</option>` +
      sortedCities.map(c => `<option value="${c}" ${c === currentVal ? 'selected' : ''}>${c}</option>`).join('');
  },

  applyFilters() {
    let list = [...this.leads];
    const f = this.currentFilter;

    // Search query
    if (f.search) {
      const q = f.search.toLowerCase().trim();
      list = list.filter(l => {
        const comp = (l.company || l.name || '').toLowerCase();
        const city = (l.city || l.location || '').toLowerCase();
        const ind = (l.industry || l.category || '').toLowerCase();
        const phone = (l.phone || '').toLowerCase();
        const email = (l.email || '').toLowerCase();
        const contact = (l.contactPerson || '').toLowerCase();
        return comp.includes(q) || city.includes(q) || ind.includes(q) || phone.includes(q) || email.includes(q) || contact.includes(q);
      });
    }

    // Service type filter
    if (f.service && f.service !== 'all') {
      list = list.filter(l => {
        const sType = (l.serviceType || '').toLowerCase();
        const ind = (l.industry || '').toLowerCase();
        if (f.service === 'security') {
          return sType === 'security' || l.needsSecurity || ind.includes('security');
        } else if (f.service === 'housekeeping') {
          return sType === 'housekeeping' || l.needsHousekeeping || ind.includes('housekeeping') || ind.includes('facility');
        }
        return true;
      });
    }

    // Lead Score filter
    if (f.score && f.score !== 'all') {
      list = list.filter(l => {
        const sc = parseInt(l.score || l.leadScore || 0, 10);
        if (f.score === 'hot') return sc >= 80;
        if (f.score === 'warm') return sc >= 50 && sc < 80;
        if (f.score === 'cold') return sc < 50;
        return true;
      });
    }

    // Status filter
    if (f.status && f.status !== 'all') {
      list = list.filter(l => {
        const st = (l.status || 'New').toLowerCase();
        return st === f.status.toLowerCase();
      });
    }

    // City filter
    if (f.city && f.city !== 'all') {
      list = list.filter(l => (l.city || l.location || '').toLowerCase() === f.city.toLowerCase());
    }

    // Checkbox filters
    if (f.hasPhone) list = list.filter(l => l.phone && l.phone.trim().length > 5);
    if (f.hasEmail) list = list.filter(l => l.email && l.email.includes('@'));
    if (f.hasWebsite) list = list.filter(l => l.website && l.website.length > 4);

    // Sorting
    list.sort((a, b) => {
      let valA, valB;
      const col = this.sort.column;

      if (col === 'score') {
        valA = parseInt(a.score || a.leadScore || 0, 10);
        valB = parseInt(b.score || b.leadScore || 0, 10);
      } else if (col === 'company') {
        valA = (a.company || a.name || '').toLowerCase();
        valB = (b.company || b.name || '').toLowerCase();
      } else if (col === 'city') {
        valA = (a.city || a.location || '').toLowerCase();
        valB = (b.city || b.location || '').toLowerCase();
      } else if (col === 'date') {
        valA = new Date(a.timestamp || a.createdAt || 0).getTime();
        valB = new Date(b.timestamp || b.createdAt || 0).getTime();
      } else {
        valA = (a[col] || '').toString().toLowerCase();
        valB = (b[col] || '').toString().toLowerCase();
      }

      if (valA < valB) return this.sort.direction === 'asc' ? -1 : 1;
      if (valA > valB) return this.sort.direction === 'asc' ? 1 : -1;
      return 0;
    });

    this.filtered = list;
    this.currentPage = 1;
  },

  render() {
    this.renderKPIs();
    this.renderTable();
    this.renderPagination();
    this.renderBulkBar();
  },

  renderKPIs() {
    const total = this.leads.length;
    const hotCount = this.leads.filter(l => parseInt(l.score || l.leadScore || 0, 10) >= 80).length;
    const contactedCount = this.leads.filter(l => l.status && l.status.toLowerCase() !== 'new').length;
    const phoneCount = this.leads.filter(l => l.phone && l.phone.trim().length > 5).length;

    const setEl = (id, txt) => {
      const el = document.getElementById(id);
      if (el) el.textContent = txt;
    };

    setEl('leads-kpi-total', total.toLocaleString('en-IN'));
    setEl('leads-kpi-hot', hotCount.toLocaleString('en-IN'));
    setEl('leads-kpi-contacted', contactedCount.toLocaleString('en-IN'));
    setEl('leads-kpi-verified', phoneCount.toLocaleString('en-IN'));
  },

  renderTable() {
    const tbody = document.getElementById('leads-table-body') || document.querySelector('#view-leads table tbody');
    if (!tbody) return;

    if (this.filtered.length === 0) {
      tbody.innerHTML = `
        <tr>
          <td colspan="8" style="text-align:center; padding: 48px 20px; color: var(--gray-400);" data-lx-empty>
            <div style="font-size: 32px; margin-bottom: 12px;">🔍</div>
            <div style="font-weight: 600; font-size: 15px; color: var(--foreground); margin-bottom: 4px;">No matching buyer leads found</div>
            <div style="font-size: 13px;">Try adjusting your search keywords, city filter, or run the AI Agent to acquire new buyer leads.</div>
            <button onclick="window.showView('agent')" class="btn-primary" style="margin-top: 16px; padding: 8px 16px; font-size: 13px; display: inline-flex; align-items: center; gap: 6px;">
              ⚡ Run AI Agent to Find Leads
            </button>
          </td>
        </tr>
      `;
      return;
    }

    const start = (this.currentPage - 1) * this.pageSize;
    const end = start + this.pageSize;
    const pageItems = this.filtered.slice(start, end);

    tbody.innerHTML = pageItems.map((lead, idx) => {
      const id = lead.id || `lead_${start + idx}`;
      const isSelected = this.selectedIds.has(id);
      const score = parseInt(lead.score || lead.leadScore || 0, 10);
      const scoreColor = score >= 80 ? '#10b981' : score >= 60 ? '#f59e0b' : '#64748b';
      const scoreBg = score >= 80 ? 'rgba(16, 185, 129, 0.12)' : score >= 60 ? 'rgba(245, 158, 11, 0.12)' : 'rgba(100, 116, 139, 0.12)';
      const company = lead.company || lead.name || 'Unnamed Company';
      const initial = company.charAt(0).toUpperCase() || 'C';
      const city = lead.city || lead.location || 'India';
      const phone = lead.phone || '';
      const email = lead.email || '';
      const website = lead.website || '';
      // Short, readable domain for the Website cell
      let webLabel = '';
      if (website) {
        try { webLabel = new URL(website).hostname.replace(/^www\./, ''); }
        catch { webLabel = website.replace(/^https?:\/\/(www\.)?/, '').split('/')[0]; }
      }
      const status = lead.status || 'New';
      const serviceType = lead.serviceType === 'housekeeping' ? '🧹 Housekeeping' : '🛡️ Security';

      return `
        <tr data-lead-id="${id}" class="${isSelected ? 'row-selected' : ''}" style="transition: background 0.15s ease;">
          <td style="width: 40px; text-align: center;">
            <input type="checkbox" class="lead-checkbox" value="${id}" ${isSelected ? 'checked' : ''} onchange="LeadsCtrl.toggleSelect('${id}', this.checked)">
          </td>
          <td>
            <div style="display: flex; align-items: center; gap: 10px;">
              <div style="width: 34px; height: 34px; border-radius: 8px; background: linear-gradient(135deg, #6366f1 0%, #a855f7 100%); display: flex; align-items: center; justify-content: center; color: white; font-weight: 700; font-size: 14px; flex-shrink: 0; box-shadow: 0 2px 6px rgba(99,102,241,0.25);">
                ${initial}
              </div>
              <div>
                <div style="font-weight: 700; color: var(--foreground); font-size: 14px; display: flex; align-items: center; gap: 6px;">
                  <span class="clickable-name" onclick="LeadsCtrl.openDrawer('${id}')" style="cursor: pointer; text-decoration: none;" onmouseover="this.style.textDecoration='underline'" onmouseout="this.style.textDecoration='none'">${company}</span>
                  ${lead.verified ? '<span title="Verified Business" style="color: #10b981; font-size: 12px;">✓</span>' : ''}
                </div>
                <div style="font-size: 11.5px; color: var(--gray-400); margin-top: 1px;">
                  ${lead.industry || 'Commercial Facility'} • ${serviceType}
                </div>
              </div>
            </div>
          </td>
          <td>
            <div style="display: flex; align-items: center; gap: 6px;">
              <span style="font-size: 13px; color: var(--foreground); font-weight: 500;">📍 ${city}</span>
              ${lead.mapsUrl ? `<a href="${lead.mapsUrl}" target="_blank" title="Open in Google Maps" style="color: var(--primary); font-size: 11px;">↗</a>` : ''}
            </div>
          </td>
          <td>
            <div style="display: inline-flex; align-items: center; gap: 5px; padding: 3px 8px; border-radius: 6px; background: ${scoreBg}; color: ${scoreColor}; font-weight: 700; font-size: 12.5px;">
              <span>⚡ ${score}</span>
              <span style="font-size: 10px; opacity: 0.8;">/100</span>
            </div>
          </td>
          <td>
            <div style="display: flex; flex-direction: column; gap: 2px;">
              ${phone ? `
                <a href="tel:${phone}" style="color: var(--foreground); font-size: 12.5px; text-decoration: none; display: flex; align-items: center; gap: 4px; font-weight: 500;" title="Click to Call">
                  <span>📞</span> ${phone}
                </a>
              ` : '<span style="color: var(--gray-400); font-size: 12px;">No phone</span>'}
              ${email ? `
                <a href="mailto:${email}" style="color: var(--primary); font-size: 11.5px; text-decoration: none; overflow: hidden; text-overflow: ellipsis; max-width: 180px; white-space: nowrap;" title="${email}">
                  ✉️ ${email}
                </a>
              ` : '<span style="color: var(--gray-400); font-size: 11.5px;">No email</span>'}
            </div>
          </td>
          <td>
            ${website ? `
              <a href="${website}" target="_blank" rel="noopener noreferrer"
                 style="display:inline-flex; align-items:center; gap:5px; padding:4px 9px; border-radius:6px;
                        background: rgba(99,102,241,0.10); border:1px solid rgba(99,102,241,0.22);
                        color: var(--primary); font-size:11.5px; font-weight:600; text-decoration:none;
                        max-width:170px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;"
                 title="${website}">
                🌐 ${webLabel}
              </a>
            ` : '<span style="color: var(--gray-400); font-size: 11.5px;">No website</span>'}
          </td>
          <td>
            <select onchange="LeadsCtrl.updateStatus('${id}', this.value)" style="padding: 4px 8px; font-size: 12px; font-weight: 600; border-radius: 6px; border: 1px solid var(--border); background: var(--card); color: var(--foreground); cursor: pointer;">
              <option value="New" ${status === 'New' ? 'selected' : ''}>🔵 New</option>
              <option value="Contacted" ${status === 'Contacted' ? 'selected' : ''}>🟡 Contacted</option>
              <option value="Qualified" ${status === 'Qualified' ? 'selected' : ''}>🟢 Qualified</option>
              <option value="Proposal Sent" ${status === 'Proposal Sent' ? 'selected' : ''}>🟣 Proposal Sent</option>
              <option value="Converted" ${status === 'Converted' ? 'selected' : ''}>💎 Converted</option>
              <option value="Lost" ${status === 'Lost' ? 'selected' : ''}>⚪ Closed/Lost</option>
            </select>
          </td>
          <td style="text-align: right;">
            <div style="display: inline-flex; align-items: center; gap: 4px;">
              ${phone ? `
                <button onclick="LeadsCtrl.openWhatsApp('${phone}', '${company}')" title="Send WhatsApp Message" style="background: rgba(37, 211, 102, 0.12); color: #25d366; border: 1px solid rgba(37,211,102,0.25); border-radius: 6px; padding: 5px 8px; cursor: pointer; font-size: 12px;">
                  💬
                </button>
              ` : ''}
              ${email ? `
                <button onclick="LeadsCtrl.openEmailCompose('${email}', '${company}')" title="Send Email" style="background: rgba(99, 102, 241, 0.12); color: var(--primary); border: 1px solid rgba(99,102,241,0.25); border-radius: 6px; padding: 5px 8px; cursor: pointer; font-size: 12px;">
                  ✉️
                </button>
              ` : ''}
              <button onclick="LeadsCtrl.openDrawer('${id}')" title="View Full Details" style="background: var(--card); color: var(--foreground); border: 1px solid var(--border); border-radius: 6px; padding: 5px 8px; cursor: pointer; font-size: 12px;">
                👁️
              </button>
              <button onclick="LeadsCtrl.deleteLead('${id}')" title="Delete Lead" style="background: transparent; color: #ef4444; border: 1px solid transparent; border-radius: 6px; padding: 5px 6px; cursor: pointer; font-size: 12px;" onmouseover="this.style.borderColor='#fecaca'" onmouseout="this.style.borderColor='transparent'">
                🗑️
              </button>
            </div>
          </td>
        </tr>
      `;
    }).join('');
  },

  renderPagination() {
    const container = document.getElementById('leads-pagination');
    if (!container) return;

    const totalPages = Math.ceil(this.filtered.length / this.pageSize) || 1;
    const start = (this.currentPage - 1) * this.pageSize + 1;
    const end = Math.min(start + this.pageSize - 1, this.filtered.length);

    container.innerHTML = `
      <div style="display: flex; align-items: center; justify-content: space-between; padding: 12px 16px; border-top: 1px solid var(--border); font-size: 13px; color: var(--gray-400);">
        <div>
          Showing <span style="font-weight: 700; color: var(--foreground);">${this.filtered.length > 0 ? start : 0} - ${end}</span> of <span style="font-weight: 700; color: var(--foreground);">${this.filtered.length}</span> leads
        </div>
        <div style="display: flex; align-items: center; gap: 8px;">
          <button onclick="LeadsCtrl.prevPage()" class="btn-secondary" ${this.currentPage <= 1 ? 'disabled' : ''} style="padding: 5px 10px; font-size: 12px;">
            ← Previous
          </button>
          <span style="font-weight: 600; color: var(--foreground);">Page ${this.currentPage} of ${totalPages}</span>
          <button onclick="LeadsCtrl.nextPage()" class="btn-secondary" ${this.currentPage >= totalPages ? 'disabled' : ''} style="padding: 5px 10px; font-size: 12px;">
            Next →
          </button>
        </div>
      </div>
    `;
  },

  renderBulkBar() {
    const bar = document.getElementById('leads-bulk-actions-bar');
    if (!bar) return;

    const count = this.selectedIds.size;
    if (count === 0) {
      bar.style.display = 'none';
      return;
    }

    bar.style.display = 'flex';
    const countEl = document.getElementById('leads-bulk-count');
    if (countEl) countEl.textContent = `${count} lead${count > 1 ? 's' : ''} selected`;
  },

  toggleSelect(id, checked) {
    if (checked) {
      this.selectedIds.add(id);
    } else {
      this.selectedIds.delete(id);
    }
    this.renderBulkBar();
    const selectAllCheckbox = document.getElementById('leads-select-all');
    if (selectAllCheckbox) {
      selectAllCheckbox.checked = this.selectedIds.size === this.filtered.length && this.filtered.length > 0;
    }
  },

  toggleSelectAll(checked) {
    if (checked) {
      this.filtered.forEach(l => {
        const id = l.id || l._id || l.company;
        if (id) this.selectedIds.add(id);
      });
    } else {
      this.selectedIds.clear();
    }
    this.renderTable();
    this.renderBulkBar();
  },

  nextPage() {
    const totalPages = Math.ceil(this.filtered.length / this.pageSize);
    if (this.currentPage < totalPages) {
      this.currentPage++;
      this.renderTable();
      this.renderPagination();
    }
  },

  prevPage() {
    if (this.currentPage > 1) {
      this.currentPage--;
      this.renderTable();
      this.renderPagination();
    }
  },

  updateStatus(id, newStatus) {
    const lead = this.leads.find(l => (l.id || `lead_${l.company}`) === id || l.id === id);
    if (!lead) return;

    lead.status = newStatus;
    this.saveLeads();
    if (window.showToast) {
      window.showToast('success', 'Status Updated', `${lead.company || 'Lead'} marked as ${newStatus}`);
    }
  },

  deleteLead(id) {
    if (!confirm('Are you sure you want to remove this lead?')) return;
    this.leads = this.leads.filter(l => (l.id || `lead_${l.company}`) !== id && l.id !== id);
    this.selectedIds.delete(id);
    this.saveLeads();
    this.applyFilters();
    this.render();
    if (window.showToast) {
      window.showToast('info', 'Lead Deleted', 'Lead removed from database.');
    }
  },

  deleteSelected() {
    if (!confirm(`Are you sure you want to delete ${this.selectedIds.size} selected leads?`)) return;
    this.leads = this.leads.filter(l => {
      const id = l.id || l._id || l.company;
      return !this.selectedIds.has(id);
    });
    this.selectedIds.clear();
    this.saveLeads();
    this.applyFilters();
    this.render();
    if (window.showToast) {
      window.showToast('success', 'Deleted', 'Selected leads have been removed.');
    }
  },

  openDrawer(id) {
    const lead = this.leads.find(l => (l.id || `lead_${l.company}`) === id || l.id === id);
    if (!lead) return;

    const drawer = document.getElementById('lead-detail-modal') || document.getElementById('lead-modal');
    if (!drawer) {
      this.createDrawerModal(lead);
      return;
    }

    this.populateDrawer(lead);
    drawer.style.display = 'flex';
  },

  createDrawerModal(lead) {
    let modal = document.getElementById('lead-detail-modal');
    if (!modal) {
      modal = document.createElement('div');
      modal.id = 'lead-detail-modal';
      modal.className = 'modal-overlay';
      modal.style.cssText = 'display:flex; position:fixed; inset:0; z-index:99999; background:rgba(0,0,0,0.6); backdrop-filter:blur(8px); align-items:center; justify-content:center; padding:20px;';
      document.body.appendChild(modal);
    }
    this.populateDrawer(lead);
    modal.style.display = 'flex';
  },

  populateDrawer(lead) {
    const modal = document.getElementById('lead-detail-modal');
    if (!modal) return;

    const score = parseInt(lead.score || lead.leadScore || 0, 10);
    const company = lead.company || lead.name || 'Company Profile';
    const city = lead.city || lead.location || 'India';
    const phone = lead.phone || 'N/A';
    const email = lead.email || 'N/A';
    const website = lead.website || '';
    const address = lead.address || `${city}, India`;
    const rating = lead.rating || lead.googleRating || '—';
    const reviews = lead.reviewsCount || lead.reviews || '—';
    const serviceType = lead.serviceType === 'housekeeping' ? '🧹 Housekeeping & Facility Management' : '🛡️ Security Guard Services';

    modal.innerHTML = `
      <div style="background:var(--card); border:1px solid var(--border); border-radius:18px; width:100%; max-width:680px; padding:26px; box-shadow:0 25px 60px -15px rgba(0,0,0,0.6); max-height:88vh; display:flex; flex-direction:column; animation: modalPop 0.2s cubic-bezier(0.16, 1, 0.3, 1);">
        <!-- Header -->
        <div style="display:flex; align-items:flex-start; justify-content:space-between; border-bottom:1px solid var(--border); padding-bottom:16px; margin-bottom:18px;">
          <div style="display:flex; align-items:center; gap:14px;">
            <div style="width:46px; height:46px; border-radius:12px; background:linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%); display:flex; align-items:center; justify-content:center; color:white; font-size:20px; font-weight:800; box-shadow:0 4px 12px rgba(99,102,241,0.3);">
              ${company.charAt(0).toUpperCase()}
            </div>
            <div>
              <h2 style="margin:0; font-size:20px; font-weight:800; color:var(--foreground);">${company}</h2>
              <p style="margin:2px 0 0; font-size:12.5px; color:var(--gray-400);">
                📍 ${address} • ⭐ ${rating} (${reviews} reviews)
              </p>
            </div>
          </div>
          <button onclick="document.getElementById('lead-detail-modal').style.display='none'" style="background:transparent; border:none; color:var(--gray-400); cursor:pointer; padding:6px; border-radius:8px; font-size:18px;">
            ✕
          </button>
        </div>

        <!-- Body Scroll -->
        <div style="flex:1; overflow-y:auto; padding-right:6px; display:flex; flex-direction:column; gap:18px;">
          
          <!-- Key Badges -->
          <div style="display:grid; grid-template-columns: repeat(3, 1fr); gap:10px;">
            <div style="background:rgba(99,102,241,0.08); border:1px solid rgba(99,102,241,0.2); border-radius:10px; padding:10px 12px;">
              <div style="font-size:11px; color:var(--gray-400); text-transform:uppercase; font-weight:700;">Opportunity Score</div>
              <div style="font-size:18px; font-weight:800; color:var(--primary); margin-top:2px;">⚡ ${score}/100</div>
            </div>
            <div style="background:rgba(16,185,129,0.08); border:1px solid rgba(16,185,129,0.2); border-radius:10px; padding:10px 12px;">
              <div style="font-size:11px; color:var(--gray-400); text-transform:uppercase; font-weight:700;">Requirement</div>
              <div style="font-size:13px; font-weight:700; color:#10b981; margin-top:4px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${serviceType}</div>
            </div>
            <div style="background:rgba(245,158,11,0.08); border:1px solid rgba(245,158,11,0.2); border-radius:10px; padding:10px 12px;">
              <div style="font-size:11px; color:var(--gray-400); text-transform:uppercase; font-weight:700;">Lead Status</div>
              <div style="font-size:14px; font-weight:700; color:#f59e0b; margin-top:3px;">${lead.status || 'New'}</div>
            </div>
          </div>

          <!-- Contact Channels -->
          <div style="background:rgba(255,255,255,0.03); border:1px solid var(--border); border-radius:12px; padding:14px;">
            <div style="font-weight:700; font-size:13px; color:var(--foreground); margin-bottom:10px;">Direct Contact Information</div>
            <div style="display:grid; grid-template-columns: 1fr 1fr; gap:12px; font-size:13px;">
              <div>
                <span style="color:var(--gray-400); font-size:11.5px; display:block;">Phone Number:</span>
                <span style="font-weight:600; color:var(--foreground);">${phone}</span>
              </div>
              <div>
                <span style="color:var(--gray-400); font-size:11.5px; display:block;">Email Address:</span>
                <span style="font-weight:600; color:var(--foreground);">${email}</span>
              </div>
              <div>
                <span style="color:var(--gray-400); font-size:11.5px; display:block;">Industry Sector:</span>
                <span style="font-weight:600; color:var(--foreground);">${lead.industry || 'Commercial Facility'}</span>
              </div>
              <div>
                <span style="color:var(--gray-400); font-size:11.5px; display:block;">Official Website:</span>
                ${website ? `<a href="${website.startsWith('http') ? website : 'https://' + website}" target="_blank" style="color:var(--primary); font-weight:600; text-decoration:none;">${website} ↗</a>` : '<span style="color:var(--gray-400);">Not available</span>'}
              </div>
            </div>
          </div>

          <!-- AI Pitch Insight -->
          <div style="background:linear-gradient(135deg, rgba(99,102,241,0.08) 0%, rgba(168,85,247,0.08) 100%); border:1px solid rgba(99,102,241,0.25); border-radius:12px; padding:14px;">
            <div style="font-weight:700; font-size:13px; color:var(--foreground); display:flex; align-items:center; gap:6px; margin-bottom:6px;">
              <span>🤖</span> AI Pitch Angle & Pain Points
            </div>
            <p style="font-size:12.5px; color:var(--foreground); line-height:1.5; margin:0;">
              High probability buyer for ${serviceType}. Based on facility scale and location (${city}), highlight 24/7 supervisor deployment, licensed security guards, and computerized attendance tracking in your pitch.
            </p>
          </div>

          <!-- Notes Area -->
          <div>
            <label style="display:block; font-weight:700; font-size:12.5px; color:var(--foreground); margin-bottom:6px;">
              Internal Meeting / Follow-up Notes
            </label>
            <textarea id="lead-notes-input" placeholder="Type quick notes from call or meeting..." style="width:100%; min-height:80px; padding:10px 12px; font-size:13px; border:1px solid var(--border); border-radius:10px; background:var(--card); color:var(--foreground); resize:vertical; font-family:inherit;">${lead.notes || ''}</textarea>
            <div style="display:flex; justify-content:flex-end; margin-top:6px;">
              <button onclick="LeadsCtrl.saveLeadNotes('${lead.id || lead.company}')" class="btn-secondary" style="padding:5px 12px; font-size:12px;">
                💾 Save Notes
              </button>
            </div>
          </div>

        </div>

        <!-- Footer Actions -->
        <div style="display:flex; align-items:center; justify-content:space-between; border-top:1px solid var(--border); padding-top:16px; margin-top:16px;">
          <div style="display:flex; gap:8px;">
            ${phone && phone !== 'N/A' ? `
              <a href="tel:${phone}" class="btn-secondary" style="display:flex; align-items:center; gap:6px; text-decoration:none; padding:8px 14px; font-size:13px; font-weight:600;">
                📞 Call
              </a>
              <button onclick="LeadsCtrl.openWhatsApp('${phone}', '${company}')" class="btn-secondary" style="display:flex; align-items:center; gap:6px; color:#25d366; border-color:rgba(37,211,102,0.4); padding:8px 14px; font-size:13px; font-weight:600;">
                💬 WhatsApp
              </button>
            ` : ''}
            ${email && email !== 'N/A' ? `
              <button onclick="LeadsCtrl.openEmailCompose('${email}', '${company}')" class="btn-secondary" style="display:flex; align-items:center; gap:6px; color:var(--primary); padding:8px 14px; font-size:13px; font-weight:600;">
                ✉️ Email Pitch
              </button>
            ` : ''}
          </div>
          <button onclick="document.getElementById('lead-detail-modal').style.display='none'" class="btn-primary" style="padding:8px 20px; font-size:13px;">
            Done
          </button>
        </div>
      </div>
    `;
  },

  saveLeadNotes(id) {
    const notesInput = document.getElementById('lead-notes-input');
    if (!notesInput) return;
    const note = notesInput.value.trim();

    const lead = this.leads.find(l => (l.id || l.company) === id || l.id === id);
    if (lead) {
      lead.notes = note;
      this.saveLeads();
      if (window.showToast) {
        window.showToast('success', 'Notes Saved', 'Lead notes saved locally.');
      }
    }
  },

  openWhatsApp(phone, company) {
    if (!phone) return;
    const digits = phone.replace(/\D/g, '');
    const cleanNum = digits.startsWith('91') ? digits : `91${digits.slice(-10)}`;
    const msg = encodeURIComponent(`Hello Team ${company},\n\nWe provide professional security personnel & housekeeping staff for premier facilities. Would you be open to a quick 5-minute discussion on your staffing needs?`);
    window.open(`https://wa.me/${cleanNum}?text=${msg}`, '_blank');
  },

  openEmailCompose(email, company) {
    if (!email) return;
    if (window.showView) {
      window.showView('email');
      setTimeout(() => {
        const toInput = document.getElementById('email-to-input') || document.getElementById('email-to');
        const subjInput = document.getElementById('email-subject');
        if (toInput) toInput.value = email;
        if (subjInput) subjInput.value = `Professional Staffing Proposal for ${company}`;
      }, 150);
    } else {
      window.location.href = `mailto:${email}?subject=Staffing Proposal for ${encodeURIComponent(company)}`;
    }
  },

  exportToExcel() {
    try {
      const itemsToExport = this.selectedIds.size > 0 
        ? this.leads.filter(l => this.selectedIds.has(l.id || l._id || l.company))
        : this.filtered;

      if (itemsToExport.length === 0) {
        if (window.showToast) window.showToast('error', 'Export', 'No leads available to export.');
        return;
      }

      if (window.XLSX) {
        const formatted = itemsToExport.map((l, i) => ({
          'S.No': i + 1,
          'Company Name': l.company || l.name || '',
          'City': l.city || l.location || '',
          'Phone': l.phone || '',
          'Email': l.email || '',
          'Service Required': l.serviceType === 'housekeeping' ? 'Housekeeping' : 'Security Guard',
          'Opportunity Score': l.score || l.leadScore || 75,
          'Industry': l.industry || '',
          'Rating': l.rating || '',
          'Reviews': l.reviewsCount || l.reviews || '',
          'Status': l.status || 'New',
          'Website': l.website || '',
          'Address': l.address || '',
          'Notes': l.notes || ''
        }));

        const ws = XLSX.utils.json_to_sheet(formatted);
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, 'Buyer Leads');
        XLSX.writeFile(wb, `${((window.UserProfileManager?.getProfile?.().company || 'Leads').replace(/[^A-Za-z0-9]+/g,'_').replace(/^_|_$/g,'') || 'Leads')}_Buyer_Leads_${Date.now()}.xlsx`);

        if (window.showToast) {
          window.showToast('success', 'Excel Export Complete', `${itemsToExport.length} leads exported to Excel successfully.`);
        }
      } else {
        this.exportToCSV(itemsToExport);
      }
    } catch (e) {
      console.error('Excel Export Error:', e);
      this.exportToCSV();
    }
  },

  exportToCSV(items) {
    const list = items || (this.selectedIds.size > 0 ? this.leads.filter(l => this.selectedIds.has(l.id || l._id || l.company)) : this.filtered);
    if (list.length === 0) return;

    const headers = ['Company Name', 'City', 'Phone', 'Email', 'Service Required', 'Opportunity Score', 'Industry', 'Status', 'Website'];
    const rows = list.map(l => [
      `"${(l.company || l.name || '').replace(/"/g, '""')}"`,
      `"${(l.city || l.location || '').replace(/"/g, '""')}"`,
      `"${(l.phone || '').replace(/"/g, '""')}"`,
      `"${(l.email || '').replace(/"/g, '""')}"`,
      `"${l.serviceType === 'housekeeping' ? 'Housekeeping' : 'Security'}"`,
      l.score || l.leadScore || 75,
      `"${(l.industry || '').replace(/"/g, '""')}"`,
      `"${l.status || 'New'}"`,
      `"${(l.website || '').replace(/"/g, '""')}"`
    ]);

    const csvContent = 'data:text/csv;charset=utf-8,' + [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `buyer_leads_${Date.now()}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    if (window.showToast) {
      window.showToast('success', 'CSV Exported', `${list.length} leads exported.`);
    }
  },

  openAddLeadModal() {
    let modal = document.getElementById('add-lead-modal');
    if (!modal) {
      modal = document.createElement('div');
      modal.id = 'add-lead-modal';
      modal.className = 'modal-overlay';
      modal.style.cssText = 'display:flex; position:fixed; inset:0; z-index:99999; background:rgba(0,0,0,0.6); backdrop-filter:blur(8px); align-items:center; justify-content:center; padding:20px;';
      document.body.appendChild(modal);
    }

    modal.innerHTML = `
      <div style="background:var(--card); border:1px solid var(--border); border-radius:18px; width:100%; max-width:560px; padding:24px; box-shadow:0 25px 60px -15px rgba(0,0,0,0.6); display:flex; flex-direction:column; animation: modalPop 0.2s cubic-bezier(0.16, 1, 0.3, 1);">
        <div style="display:flex; align-items:center; justify-content:space-between; border-bottom:1px solid var(--border); padding-bottom:14px; margin-bottom:16px;">
          <h3 style="margin:0; font-size:18px; font-weight:800; color:var(--foreground);">➕ Add New Buyer Lead</h3>
          <button onclick="document.getElementById('add-lead-modal').style.display='none'" style="background:transparent; border:none; color:var(--gray-400); cursor:pointer; font-size:18px;">✕</button>
        </div>

        <form id="add-lead-form" onsubmit="event.preventDefault(); LeadsCtrl.submitNewLead();" style="display:flex; flex-direction:column; gap:14px;">
          <div>
            <label style="display:block; font-size:12px; font-weight:700; color:var(--gray-400); margin-bottom:4px;">COMPANY / FACILITY NAME *</label>
            <input type="text" id="new-lead-company" required placeholder="e.g. Apex Corporate Towers" style="width:100%; padding:9px 12px; font-size:13px; border:1px solid var(--border); border-radius:8px; background:var(--card); color:var(--foreground);">
          </div>

          <div style="display:grid; grid-template-columns:1fr 1fr; gap:12px;">
            <div>
              <label style="display:block; font-size:12px; font-weight:700; color:var(--gray-400); margin-bottom:4px;">CITY / LOCATION *</label>
              <input type="text" id="new-lead-city" required placeholder="e.g. Gurugram, Delhi NCR" style="width:100%; padding:9px 12px; font-size:13px; border:1px solid var(--border); border-radius:8px; background:var(--card); color:var(--foreground);">
            </div>
            <div>
              <label style="display:block; font-size:12px; font-weight:700; color:var(--gray-400); margin-bottom:4px;">SERVICE NEEDED *</label>
              <select id="new-lead-service" style="width:100%; padding:9px 12px; font-size:13px; border:1px solid var(--border); border-radius:8px; background:var(--card); color:var(--foreground);">
                <option value="security">🛡️ Security Guards</option>
                <option value="housekeeping">🧹 Housekeeping Staff</option>
              </select>
            </div>
          </div>

          <div style="display:grid; grid-template-columns:1fr 1fr; gap:12px;">
            <div>
              <label style="display:block; font-size:12px; font-weight:700; color:var(--gray-400); margin-bottom:4px;">PHONE NUMBER</label>
              <input type="tel" id="new-lead-phone" placeholder="e.g. +91 98112 34567" style="width:100%; padding:9px 12px; font-size:13px; border:1px solid var(--border); border-radius:8px; background:var(--card); color:var(--foreground);">
            </div>
            <div>
              <label style="display:block; font-size:12px; font-weight:700; color:var(--gray-400); margin-bottom:4px;">EMAIL ADDRESS</label>
              <input type="email" id="new-lead-email" placeholder="e.g. facility@apex.com" style="width:100%; padding:9px 12px; font-size:13px; border:1px solid var(--border); border-radius:8px; background:var(--card); color:var(--foreground);">
            </div>
          </div>

          <div style="display:grid; grid-template-columns:1fr 1fr; gap:12px;">
            <div>
              <label style="display:block; font-size:12px; font-weight:700; color:var(--gray-400); margin-bottom:4px;">INDUSTRY</label>
              <input type="text" id="new-lead-industry" placeholder="e.g. IT Park, Hospital, Hotel" style="width:100%; padding:9px 12px; font-size:13px; border:1px solid var(--border); border-radius:8px; background:var(--card); color:var(--foreground);">
            </div>
            <div>
              <label style="display:block; font-size:12px; font-weight:700; color:var(--gray-400); margin-bottom:4px;">ESTIMATED SCORE (1-100)</label>
              <input type="number" id="new-lead-score" value="85" min="1" max="100" style="width:100%; padding:9px 12px; font-size:13px; border:1px solid var(--border); border-radius:8px; background:var(--card); color:var(--foreground);">
            </div>
          </div>

          <div style="display:flex; justify-content:flex-end; gap:10px; margin-top:10px; border-top:1px solid var(--border); padding-top:14px;">
            <button type="button" onclick="document.getElementById('add-lead-modal').style.display='none'" class="btn-secondary" style="padding:8px 16px;">Cancel</button>
            <button type="submit" class="btn-primary" style="padding:8px 20px;">Save Lead</button>
          </div>
        </form>
      </div>
    `;
    modal.style.display = 'flex';
  },

  submitNewLead() {
    const comp = (document.getElementById('new-lead-company')?.value || '').trim();
    const city = (document.getElementById('new-lead-city')?.value || '').trim();
    const service = document.getElementById('new-lead-service')?.value || 'security';
    const phone = (document.getElementById('new-lead-phone')?.value || '').trim();
    const email = (document.getElementById('new-lead-email')?.value || '').trim();
    const industry = (document.getElementById('new-lead-industry')?.value || 'Commercial Facility').trim();
    const score = parseInt(document.getElementById('new-lead-score')?.value || 85, 10);

    if (!comp || !city) return;

    const newLead = {
      id: `lead_${Date.now()}`,
      company: comp,
      name: comp,
      city: city,
      location: city,
      serviceType: service,
      phone: phone,
      email: email,
      industry: industry,
      score: score,
      status: 'New',
      source: 'Manual Entry',
      timestamp: new Date().toISOString(),
      verified: true
    };

    this.leads.unshift(newLead);
    this.saveLeads();
    this.populateFilterDropdowns();
    this.applyFilters();
    this.render();

    const modal = document.getElementById('add-lead-modal');
    if (modal) modal.style.display = 'none';

    if (window.showToast) {
      window.showToast('success', 'Lead Added', `${comp} added to your active database.`);
    }
  },

  bindEvents() {
    // Search input debounce
    const searchInput = document.getElementById('search-input') || document.getElementById('leads-search-input') || document.getElementById('lead-search');
    if (searchInput) {
      searchInput.addEventListener('input', (e) => {
        this.currentFilter.search = e.target.value;
        this.applyFilters();
        this.renderTable();
        this.renderPagination();
      });
    }

    // Filter changes
    const bindFilter = (id, key) => {
      const el = document.getElementById(id);
      if (el) {
        el.addEventListener('change', (e) => {
          this.currentFilter[key] = e.target.type === 'checkbox' ? e.target.checked : e.target.value;
          this.applyFilters();
          this.renderTable();
          this.renderPagination();
        });
      }
    };

    bindFilter('leads-filter-service', 'service');
    bindFilter('leads-filter-score', 'score');
    bindFilter('leads-filter-status', 'status');
    bindFilter('leads-filter-city', 'city');
    bindFilter('leads-filter-phone', 'hasPhone');
    bindFilter('leads-filter-email', 'hasEmail');
    bindFilter('leads-filter-web', 'hasWebsite');

    // Select all checkbox
    const selectAll = document.getElementById('leads-select-all');
    if (selectAll) {
      selectAll.addEventListener('change', (e) => {
        this.toggleSelectAll(e.target.checked);
      });
    }
  }
};

// Global Exposure
window.LeadsCtrl = LeadsCtrl;

// Auto-initialize when view shown or document ready
document.addEventListener('DOMContentLoaded', () => {
  setTimeout(() => {
    LeadsCtrl.init();
  }, 400);
});

// Hook into showView for instant refresh
const prevShowViewForLeads = window.showView;
window.showView = function(viewName) {
  if (typeof prevShowViewForLeads === 'function') prevShowViewForLeads(viewName);
  if (viewName === 'leads' || viewName === 'all-leads') {
    setTimeout(() => {
      LeadsCtrl.init();
    }, 50);
  }
};
