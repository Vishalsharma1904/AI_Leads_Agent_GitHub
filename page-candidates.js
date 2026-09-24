/**
 * page-candidates.js
 * Candidate AI & Candidate Database Controller (macOS / Claude Aesthetic)
 * AI conversational candidate sourcing, verified candidate database, export tools, and 1-click recruitment reachout.
 */
'use strict';

const CandidatesCtrl = {
  candidates: [],
  selectedModel: 'llama-3.3-70b-versatile',
  // Which real Apify job portals to query. All on by default.
  activeSources: ['naukri', 'workindia', 'shine', 'apna'],
  isScraping: false,

  init() {
    this.restoreSources();
    this.loadCandidates();
    this.renderCandidateTable();
    this.bindEvents();
    this.bindSourceChips();
    this.bindQuickstart();
    this.updateSourceCount();
    this.loadChatHistory();
  },

  bindQuickstart() {
    // Candidate AI intentionally mirrors Client AI's minimal composer —
    // no quick-chip row — so there is nothing to bind here. Kept as a no-op
    // hook in case a future design adds prompts back in.
  },

  updateSourceCount() {
    const count = this.activeSources.length;
    const countEl = document.getElementById('candidate-source-count');
    const trigger = document.getElementById('candidate-source-menu-btn');
    if (countEl) countEl.textContent = String(count);
    if (trigger) trigger.setAttribute('aria-label', `${count} live source${count === 1 ? '' : 's'} selected`);
  },

  setSourceMenuOpen(open) {
    const picker = document.querySelector('#view-candidate-ai .candidate-source-picker');
    const trigger = document.getElementById('candidate-source-menu-btn');
    const menu = document.getElementById('cand-source-chips');
    if (!picker || !trigger || !menu) return;
    menu.hidden = !open;
    picker.classList.toggle('is-open', open);
    trigger.setAttribute('aria-expanded', open ? 'true' : 'false');
  },

  restoreSources() {
    try {
      const saved = window.UserStorage
        ? window.UserStorage.getJSON('candidate_sources', null)
        : JSON.parse(localStorage.getItem('candidate_sources') || 'null');
      if (Array.isArray(saved) && saved.length) {
        const valid = (window.CandidateSourcing?.SOURCE_ORDER) || ['naukri', 'workindia', 'shine', 'apna'];
        this.activeSources = saved.filter(s => valid.includes(s));
        if (!this.activeSources.length) this.activeSources = valid.slice();
      }
    } catch (e) { /* keep defaults */ }
  },

  saveSources() {
    try {
      if (window.UserStorage) window.UserStorage.setJSON('candidate_sources', this.activeSources);
      localStorage.setItem('candidate_sources', JSON.stringify(this.activeSources));
    } catch (e) { /* non-fatal */ }
  },

  bindSourceChips() {
    const picker = document.querySelector('#view-candidate-ai .candidate-source-picker');
    const trigger = document.getElementById('candidate-source-menu-btn');
    const menu = document.getElementById('cand-source-chips');
    const chips = document.querySelectorAll('#cand-source-chips .cand-src-chip');
    if (!picker || !trigger || !menu || !chips.length) return;

    chips.forEach(chip => {
      const src = chip.getAttribute('data-source');
      const selected = this.activeSources.includes(src);
      chip.classList.toggle('active', selected);
      chip.setAttribute('aria-pressed', selected ? 'true' : 'false');
      if (chip.dataset.sourceBound === 'true') return;
      chip.dataset.sourceBound = 'true';
      chip.addEventListener('click', () => {
        if (this.isScraping) return;
        const on = chip.classList.toggle('active');
        chip.setAttribute('aria-pressed', on ? 'true' : 'false');
        if (on && !this.activeSources.includes(src)) this.activeSources.push(src);
        if (!on) this.activeSources = this.activeSources.filter(s => s !== src);
        // At least one real portal is always required for a search.
        if (!this.activeSources.length) {
          chip.classList.add('active');
          chip.setAttribute('aria-pressed', 'true');
          this.activeSources.push(src);
          if (window.showToast) window.showToast('Keep at least one source enabled.', 'warning');
        }
        this.saveSources();
        this.updateSourceCount();
      });
    });

    if (this._sourceMenuBound) return;
    this._sourceMenuBound = true;
    trigger.addEventListener('click', (event) => {
      event.stopPropagation();
      this.setSourceMenuOpen(menu.hidden);
    });
    menu.addEventListener('click', event => event.stopPropagation());
    document.addEventListener('click', event => {
      if (!picker.contains(event.target)) this.setSourceMenuOpen(false);
    });
    document.addEventListener('keydown', event => {
      if (event.key !== 'Escape' || menu.hidden) return;
      this.setSourceMenuOpen(false);
      trigger.focus();
    });
  },

  bindEvents() {
    const chatInput = document.getElementById('candidate-ai-input') || document.getElementById('cand-chat-input');
    if (chatInput) {
      chatInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          this.handleAiChatSubmit();
        }
      });
    }

    // Dropdown selection for model
    const dropdownItems = document.querySelectorAll('.claude-model-wrapper .custom-dropdown-list li');
    dropdownItems.forEach(item => {
      item.addEventListener('click', (e) => {
        const val = e.currentTarget.getAttribute('data-value');
        if (val) {
          this.selectedModel = val;
          const select = document.getElementById('candidate-ai-model-select');
          if (select) select.value = val;
          const label = document.querySelector('.claude-model-wrapper .custom-dropdown-text');
          if (label) label.textContent = e.currentTarget.textContent.split('(')[0].trim();
        }
      });
    });
  },

  async loadCandidates() {
    try {
      if (Array.isArray(window.all_candidates) && window.all_candidates.length > 0) {
        this.candidates = window.all_candidates;
        return this.candidates;
      }

      if (window.UserStorage) {
        const scoped = window.UserStorage.getJSON('all_candidates', null);
        if (Array.isArray(scoped) && scoped.length > 0) {
          this.candidates = scoped;
          window.all_candidates = this.candidates;
          return this.candidates;
        }
      }

      if (window.MemoryEngine && typeof window.MemoryEngine.getAllCandidates === 'function') {
        const dbCandidates = await window.MemoryEngine.getAllCandidates();
        if (Array.isArray(dbCandidates) && dbCandidates.length > 0) {
          this.candidates = dbCandidates;
          window.all_candidates = this.candidates;
          if (window.UserStorage) window.UserStorage.setJSON('all_candidates', this.candidates);
          return this.candidates;
        }
      }

      const raw = localStorage.getItem('all_candidates');
      if (raw) {
        this.candidates = JSON.parse(raw);
        window.all_candidates = this.candidates;
      } else {
        // No seed data. The database starts empty and is filled ONLY with real
        // results scraped from the selected job portals.
        this.candidates = [];
      }
    } catch(e) {
      this.candidates = [];
    }
    return this.candidates;
  },

  saveCandidates() {
    try {
      window.all_candidates = this.candidates;
      if (window.UserStorage) {
        window.UserStorage.setJSON('all_candidates', this.candidates);
      }
      localStorage.setItem('all_candidates', JSON.stringify(this.candidates));

      if (window.MemoryEngine && typeof window.MemoryEngine.saveAllCandidates === 'function') {
        window.MemoryEngine.saveAllCandidates(this.candidates);
      }

      if (window.CloudSyncManager && typeof window.CloudSyncManager.schedulePush === 'function') {
        window.CloudSyncManager.schedulePush(600);
      }
    } catch (e) {
      console.error('[CandidatesCtrl] Error saving candidates:', e);
    }
  },

  // ── Candidate DB Table & Filter ──
  filterCandidates(query) {
    const q = (query != null ? query : (document.getElementById('candidate-search-input')?.value || '')).toLowerCase().trim();
    const portal = (document.getElementById('candidate-filter-source')?.value || '').toLowerCase().trim();

    let list = Array.isArray(this.candidates) ? this.candidates : [];
    if (portal) {
      list = list.filter(c => (c.source || '').toLowerCase().includes(portal));
    }
    if (q) {
      list = list.filter(c => {
        const text = `${c.name || ''} ${c.role || ''} ${c.company || ''} ${c.phone || ''} ${(c.skills || []).join(' ')} ${c.city || ''} ${c.experience || ''} ${c.status || ''}`.toLowerCase();
        return text.includes(q);
      });
    }

    const pill = document.getElementById('candidate-count-pill');
    if (pill) {
      pill.textContent = `${list.length} candidate${list.length === 1 ? '' : 's'}`;
    }

    this.renderCandidateTable(list);
  },

  renderCandidateTable(customCandidatesList = null) {
    const tbodies = [
      document.getElementById('candidates-tbody'),
      document.getElementById('cand-table-body')
    ].filter(Boolean);

    const targetList = Array.isArray(customCandidatesList) ? customCandidatesList : (this.candidates || []);
    const emptyState = document.getElementById('candidates-empty-state');

    const pill = document.getElementById('candidate-count-pill');
    if (pill && !customCandidatesList) {
      pill.textContent = `${targetList.length} candidate${targetList.length === 1 ? '' : 's'}`;
    }

    if (typeof window.updateRealtimeTokenCounters === 'function') {
      window.updateRealtimeTokenCounters();
    }

    if (targetList.length === 0) {
      tbodies.forEach(tb => tb.innerHTML = '');
      if (emptyState) {
        emptyState.style.display = 'block';
        if (customCandidatesList && (this.candidates || []).length > 0) {
          emptyState.innerHTML = '<div style="padding:20px 0; color:var(--do-t2, #6b7280);">🔍 No candidates match your search filter.</div>';
        } else {
          emptyState.innerHTML = '<svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style="color:var(--gray-300); margin-bottom:12px;"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path><circle cx="9" cy="7" r="4"></circle><path d="M23 21v-2a4 4 0 0 0-3-3.87"></path><path d="M16 3.13a4 4 0 0 1 0 7.75"></path></svg><br>No candidates searched yet.<br>Enter a role and city above to start scraping.';
        }
      }
      return;
    }

    if (emptyState) emptyState.style.display = 'none';

    const esc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    const rowsHtml = targetList.map((c, i) => {
      const meta = [c.company, c.experience].filter(Boolean).join(' • ') || (c.city ? esc(c.city) : '');
      const detailBits = [];
      if (c.skills && c.skills.length) detailBits.push(esc(c.skills.join(', ')));
      if (c.salary) detailBits.push('💰 ' + esc(c.salary));
      if (c.qualification) detailBits.push(esc(c.qualification));
      const detail = detailBits.length ? detailBits.join(' &nbsp;·&nbsp; ') : esc(c.city || '');
      const link = c.url
        ? `<a href="${esc(c.url)}" target="_blank" rel="noopener" style="font-size:11.5px; color:var(--do-blue, #007aff); text-decoration:underline;">${esc(c.source || 'Source')} ↗</a>`
        : `<span style="font-size:11.5px; color:var(--do-t3, #9aa0a6);">${esc(c.source || 'No link')}</span>`;
      const phone = c.phone
        ? `<span style="font-family:monospace; font-size:12.5px; font-weight:600; color:var(--do-t1, #202124);">${esc(c.phone)}</span>`
        : `<span style="font-size:11.5px; color:var(--do-t3, #9aa0a6);">Apply via link</span>`;
      return `
      <tr class="candidate-table-row">
        <td><input type="checkbox" data-id="${esc(c.id)}"></td>
        <td>
          <div style="font-weight:600; color:var(--do-t1, #202124); display:flex; align-items:center; gap:6px;">
            ${esc(c.role || c.name)}
            <span title="Real listing from ${esc(c.source || 'job portal')}" style="color:var(--do-blue, #007aff); font-size:10px; border:1px solid currentColor; border-radius:10px; padding:0 6px;">${esc(c.source || 'Live')}</span>
          </div>
          <div style="font-size:11.5px; color:var(--do-t2, #5f6368);">${meta}</div>
        </td>
        <td>${phone}</td>
        <td>
          <div style="font-size:12px; color:var(--do-t1, #3c4043); max-width:340px; white-space:normal; line-height:1.45;">${detail}</div>
        </td>
        <td>${link}</td>
        <td>
          <span class="status-badge status-new" style="font-size:11px; padding:3px 8px; border-radius:12px; font-weight:600;">${esc(c.status || 'New')}</span>
        </td>
        <td>
          <div style="display:flex; gap:6px;">
            <button type="button" class="btn-secondary" style="font-size:11px; padding:4px 8px; border-color:#25D366; color:#128c7e;" title="Chat on WhatsApp" onclick="CandidatesCtrl.reachoutWhatsApp('${esc(c.id)}')">
              💬 WhatsApp
            </button>
            <button type="button" class="btn-secondary" style="font-size:11px; padding:4px 8px; color:#ef4444; border-color:#ef4444;" title="Delete" onclick="CandidatesCtrl.deleteCandidate('${esc(c.id)}')">
              ✕
            </button>
          </div>
        </td>
      </tr>`;
    }).join('');

    tbodies.forEach(tb => tb.innerHTML = rowsHtml);
  },

  reachoutWhatsApp(candId) {
    const cand = this.candidates.find(c => c.id === candId);
    if (!cand) return;

    let phone = (cand.phone || '').replace(/[^0-9]/g, '');
    if (!phone) {
      // No number was published for this listing — open the real source instead
      // rather than dialing a fabricated number.
      if (cand.url) {
        window.open(cand.url, '_blank');
        if (window.showToast) window.showToast('No phone published — opened the source listing.', 'info');
      } else if (window.showToast) {
        window.showToast('This listing has no published contact number.', 'warning');
      }
      return;
    }
    if (phone.length === 10) phone = '91' + phone;

    const company = (() => {
      try {
        const u = JSON.parse(localStorage.getItem('skylark_user') || '{}');
        return u.company || (window.UserProfileManager?.getProfile?.().company || 'our company');
      } catch(e) { return 'our company'; }
    })();

    const msg = `Namaste,\nWe are reaching out from *${company}* regarding the *${cand.role}*`
      + `${cand.company ? ' listing by ' + cand.company : ''}${cand.city ? ' in ' + cand.city : ''}.`
      + `\nAre you open to connect regarding staffing / hiring? Please reply to discuss.`;

    window.open(`https://wa.me/${phone}?text=${encodeURIComponent(msg)}`, '_blank');
  },

  deleteCandidate(candId) {
    this.candidates = this.candidates.filter(c => c.id !== candId);
    localStorage.setItem('all_candidates', JSON.stringify(this.candidates));
    this.renderCandidateTable();
    if (window.showToast) window.showToast('Candidate removed from database.', 'info');
  },

  clearAll() {
    if (!confirm('Are you sure you want to clear all candidate profiles?')) return;
    this.candidates = [];
    localStorage.setItem('all_candidates', JSON.stringify([]));
    this.renderCandidateTable();
    if (window.showToast) window.showToast('Candidate database cleared.', 'info');
  },

  // ── Export ──
  exportCSV() {
    if (this.candidates.length === 0) {
      if (window.showToast) window.showToast('No candidates to export.', 'warning');
      return;
    }
    const q = (v) => `"${String(v == null ? '' : v).replace(/"/g, '""')}"`;
    const headers = ['#', 'Role', 'Company', 'City', 'Experience', 'Salary', 'Phone', 'Email', 'Skills', 'Source', 'Listing URL'];
    const rows = this.candidates.map((c, i) => [
      i + 1,
      q(c.role),
      q(c.company),
      q(c.city),
      q(c.experience),
      q(c.salary),
      q(c.phone),
      q(c.email),
      q((c.skills || []).join('; ')),
      q(c.source),
      q(c.url)
    ]);

    const csvContent = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${((window.UserProfileManager?.getProfile?.().company || 'Leads').replace(/[^A-Za-z0-9]+/g,'_').replace(/^_|_$/g,'') || 'Leads')}_Candidates_${new Date().toISOString().slice(0,10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    if (window.showToast) window.showToast('Exported candidate CSV successfully!', 'success');
  },

  exportExcel() {
    if (typeof XLSX === 'undefined') {
      this.exportCSV();
      return;
    }
    const rows = this.candidates.map((c, i) => ({
      '#': i + 1,
      'Role / Position': c.role || '',
      'Company': c.company || '',
      'Location / City': c.city || '',
      'Experience': c.experience || '',
      'Salary': c.salary || '',
      'Phone': c.phone || '',
      'Email': c.email || '',
      'Key Skills / Industry': (c.skills || []).join(', '),
      'Source Portal': c.source || '',
      'Listing URL': c.url || ''
    }));

    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Candidates');
    XLSX.writeFile(wb, `${((window.UserProfileManager?.getProfile?.().company || 'Leads').replace(/[^A-Za-z0-9]+/g,'_').replace(/^_|_$/g,'') || 'Leads')}_Candidates_${new Date().toISOString().slice(0,10)}.xlsx`);
    if (window.showToast) window.showToast('Exported candidate Excel sheet successfully!', 'success');
  },

  // ── AI Conversational Chat → REAL multi-portal scrape ──
  async handleAiChatSubmit() {
    if (this.isScraping) return;
    const input = document.getElementById('candidate-ai-input') || document.getElementById('cand-chat-input');
    if (!input || !input.value.trim()) return;

    const query = input.value.trim();
    input.value = '';
    if (typeof window.resetComposer === 'function') {
      window.resetComposer(input);
    } else {
      input.style.removeProperty('height');
      input.style.setProperty('height', '28px', 'important');
      input.style.setProperty('--lx-ta-h', '28px');
      input.classList.remove('lx-grow-scroll', 'au-shrinking', 'au-measuring');
      input.dataset.grow = 'fit';
      const composerHost = input.closest('.claude-input-container, .candidate-composer');
      if (composerHost) composerHost.dataset.emptyInput = '1';
      input.dispatchEvent(new Event('input', { bubbles: true }));
    }

    const welcome = document.getElementById('candidate-chat-welcome');
    const messages = document.getElementById('candidate-chat-messages');
    if (welcome) welcome.style.display = 'none';
    if (messages) messages.style.display = 'flex';
    const box = document.querySelector('#view-candidate-ai .chat-container');
    if (box) box.dataset.chatState = 'active';

    this.appendUserMessage(query);

    try {
      if (window.ClavisTask?.begin) {
        const activeTask = window.ClavisTask.current?.();
        if (!activeTask || ['completed', 'failed'].includes(activeTask.phase)) {
          window.ClavisTask.begin(query, { source: 'composer' });
        }
      }
    } catch (_) {}

    if (!window.CandidateSourcing) {
      this.appendAiMessage('Sourcing engine is not loaded. Please refresh the page and try again.');
      try {
        const cur = window.ClavisTask?.current?.();
        if (cur) window.ClavisTask.fail(cur.id, { message: 'Sourcing engine is not loaded.' });
      } catch (_) {}
      return;
    }

    // 1. Understand the request (offline parser — no token cost, always works)
    // Cross-workstream check: if user asks for business leads while in Candidate AI
    const parsedRequest = window.LeadCandidateDomain?.parseRequest ? window.LeadCandidateDomain.parseRequest(query) : null;
    if (parsedRequest && parsedRequest.workstream === 'leads') {
      const leadAction = {
        type: 'generate',
        cities: parsedRequest.cities,
        industries: parsedRequest.industries,
        serviceType: parsedRequest.serviceTypes,
        count: parsedRequest.count,
        query: query
      };
      const citiesStr = parsedRequest.cities.join(', ');
      const indStr = parsedRequest.industries.join(', ');
      const msg = `Switching to **Lead Generation**: searching verified business prospects for **${indStr}** in **${citiesStr}** (${parsedRequest.count} leads requested). Starting live pipeline discovery now...`;
      this.appendAiMessage(msg);
      if (typeof window.runScrapeFromChat === 'function') {
        window.runScrapeFromChat(leadAction);
      } else if (typeof window.executeChatAction === 'function') {
        window.executeChatAction(leadAction);
      }
      return;
    }

    const intent = window.CandidateSourcing.parseIntent(query);

    if (!intent.isSearch || !intent.role) {
      if (window.ClavisDirect?.hasKey?.()) {
        this.showTypingIndicator();
        try {
          const honorific = window.UserProfileManager?.getHonorificName?.() || 'Sir';
          const candidateSystemPrompt = `You are Clavis Candidate AI — Senior Talent Acquisition & Workforce Strategist with 15+ years of Indian staffing experience (blue-collar, grey-collar, and corporate roles).
Always address the user respectfully as "${honorific}".

### COGNITIVE & RECRUITMENT EXPERTISE:
1. INDIAN LABOR MARKET MASTERY:
   - Minimum wages & salary benchmarks across Delhi-NCR, Mumbai, Bengaluru, Pune, Hyderabad.
   - Understanding 8-hour vs 12-hour shifts, PF/ESIC statutory compliance, overtime calculations.
   - Roles: Security Guards/Supervisors, Housekeeping, Pantry Boys, Delivery Executives, Drivers, Telecallers, Accountants, Software Engineers.

2. SCREENING & VERIFICATION INTEL:
   - Security: 5'7"+ height standard, physical fitness, police verification, Aadhaar linking, PSARA compliance.
   - Housekeeping/Pantry: Clean hygiene standards, chemical handling awareness, basic etiquette.
   - Drivers/Delivery: Valid commercial DL, clean driving record, local route familiarity.

3. PROACTIVE VALUE-ADD:
   - When discussing hiring, proactively suggest 5-question telephonic screening scripts, salary ranges, or interview invitation templates.
   - If user asks for candidates, encourage them with role and city: "Mujhe role, city, aur count bataiye (jaise: 'Gurugram me 15 security supervisor') aur main live portals se verified listings source kar dunga."

4. CONVERSATIONAL TONE:
   - Speak with executive warmth, authority, and natural conversational cadence (Hinglish or English matching user).
   - Never sound robotic or generic. Avoid filler preambles.`;

          const res = await window.ClavisDirect.complete({
            messages: [
              { role: 'system', content: candidateSystemPrompt },
              { role: 'user', content: query }
            ],
            temperature: 0.7,
            max_tokens: 500
          });
          this.hideTypingIndicator();
          const reply = res.choices?.[0]?.message?.content || 'Tell me the role and city you want candidates for!';
          this.appendAiMessage(reply);
          try {
            const cur = window.ClavisTask?.current?.();
            if (cur && cur.phase !== 'completed') {
              window.ClavisTask.complete(cur.id, { type: 'text', text: reply });
            }
          } catch (_) {}
          return;
        } catch (e) {
          this.hideTypingIndicator();
        }
      }

      // Offline / Local Recruitment Intelligence Fallback
      const localRecruitmentReply = this.getLocalRecruitmentAdvice(query);
      this.appendAiMessage(localRecruitmentReply);
      try {
        const cur = window.ClavisTask?.current?.();
        if (cur && cur.phase !== 'completed') {
          window.ClavisTask.complete(cur.id, { type: 'text', text: localRecruitmentReply });
        }
      } catch (_) {}
      return;
    }

    const sources = this.activeSources.slice();
    const sourceLabels = sources.map(s => window.CandidateSourcing.labelFor(s)).join(', ');
    const cityText = intent.city || 'India (all cities)';

    const activeTask = window.ClavisTask?.current?.();
    if (!activeTask || ['completed', 'failed'].includes(activeTask.phase)) {
      window.ClavisTask?.begin?.(query, { source: 'composer' });
    }
    this.isScraping = true;
    this.showTypingIndicator();
    this._statusStep?.(`Searching ${sourceLabels} for "${intent.role}"…`, 18);

    try {
      const { records, report, requested } = await window.CandidateSourcing.scrape({
        role: intent.role,
        city: intent.city,
        quantity: intent.quantity,
        sources,
        onProgress: (msg, rep) => {
          const done = (rep || []).length;
          const pct = Math.min(90, 18 + done * 22);
          this._statusStep?.(msg, pct);
          document.dispatchEvent(new CustomEvent('nexus:candidateprogress', { detail: { text: msg, label: msg, pct } }));
        }
      });

      this.removeTypingIndicator();

      if (!records.length) {
        document.dispatchEvent(new CustomEvent('nexus:candidatesdone', { detail: { ok: false, total: 0, candidates: [] } }));
        this.appendAiMessage(this.buildNoResultMessage(intent, report));
        this.isScraping = false;
        return;
      }

      // 3. Store REAL results (newest first), persist, render
      this.candidates = records.concat(this.candidates);
      this.saveCandidates();
      this.renderCandidateTable();

      this.appendAiMessage(this.buildResultMessage(intent, records, report, requested));
      document.dispatchEvent(new CustomEvent('nexus:candidatesdone', {
        detail: { ok: true, total: records.length, candidates: records, requested }
      }));

      // 4. Show the database and auto-export the fresh data
      if (window.NEXUS && typeof window.NEXUS.showView === 'function') {
        window.NEXUS.showView('candidate-db');
      }
      this.exportExcel();

    } catch (err) {
      this.removeTypingIndicator();
      document.dispatchEvent(new CustomEvent('nexus:candidatesdone', { detail: { ok: false, total: 0, candidates: [], error: err?.message || 'unknown error' } }));
      const msg = (err && err.code === 'AUTH_REQUIRED')
        ? 'Sign in to this workspace before sourcing live candidate listings. Provider credentials stay protected on the server.'
        : `Search failed: ${err && err.message ? err.message : 'unknown error'}.`;
      this.appendAiMessage(msg);
      if (window.showToast) window.showToast('Candidate search failed.', 'error');
    } finally {
      this.isScraping = false;
    }
  },

  // ── Offline / Local Recruitment Intelligence Engine ──
  getLocalRecruitmentAdvice(query) {
    const q = String(query || '').toLowerCase().trim();
    const honorific = window.UserProfileManager?.getHonorificName?.() || 'Sir';

    // Greetings
    if (/^(hi|hello|hey|namaste|good\s+(morning|afternoon|evening)|kaise\s+ho|kya\s+haal|who\s+are\s+you)\b/i.test(q)) {
      const hour = new Date().getHours();
      const timeGreeting = hour < 12 ? 'Good morning' : (hour < 17 ? 'Good afternoon' : 'Good evening');
      return `${timeGreeting}, ${honorific}! I am Clavis Candidate AI — your Senior Talent Acquisition & Workforce Strategist.<br/><br/>` +
        `Main aapki candidate sourcing, salary benchmarking, telephonic screening, aur interview planning me madad kar sakta hoon. ` +
        `Aap mujhse kisi bhi role ke standard market wages ya screening criteria pooch sakte hain, ya directly candidates source karne ke liye command de sakte hain (jaise: <i>"Gurugram me 20 security guard chahiye"</i>). Batayein, aaj kis role ki hiring plan karni hai?`;
    }

    // Salary & Wage Benchmarks
    if (/\b(salary|wage|wages|kitna\s*pay|kitne\s*paise|minimum\s*wage|paisa|remuneration)\b/i.test(q)) {
      return `📊 <b>Current Salary & Wage Benchmarks (Delhi-NCR / Metros) for ${honorific}:</b><br/><br/>` +
        `• <b>Security Guard (8-hr shift):</b> ₹13,500 – ₹16,500 in-hand + PF/ESIC<br/>` +
        `• <b>Security Guard (12-hr shift):</b> ₹18,000 – ₹22,000 in-hand (including overtime)<br/>` +
        `• <b>Security Supervisor:</b> ₹22,000 – ₹28,000 in-hand (ex-servicemen / experienced)<br/>` +
        `• <b>Housekeeping Staff:</b> ₹12,500 – ₹15,000 in-hand<br/>` +
        `• <b>Pantry Boy / Office Helper:</b> ₹13,000 – ₹16,000 in-hand<br/>` +
        `• <b>Commercial Driver:</b> ₹18,000 – ₹25,000 in-hand<br/><br/>` +
        `💡 <i>Proactive Tip:</i> Statutory compliance (PF 12% + ESIC 3.25%) provide karne se candidate retention 40% tak badh jata hai. Kis specific role ke candidates source karne hain?`;
    }

    // Interview & Screening Questions
    if (/\b(interview|screening|sawal|question|questions|kya\s*puchh|kaise\s*judge|checklist)\b/i.test(q)) {
      return `📋 <b>5-Point Telephonic Screening Checklist for ${honorific}:</b><br/><br/>` +
        `1. <b>Prior Experience & Duty Hours:</b> <i>"Pehle kis site par kaam kiya hai? Kya 12-hour day/night rotational shifts comfortable hain?"</i><br/>` +
        `2. <b>Current Residence & Commute:</b> <i>"Site se kitni door rehte hain? Daily aane-jane ka kya sadhan hai?"</i> (30+ mins commute causes absenteeism).<br/>` +
        `3. <b>Documentation Check:</b> <i>"Aadhaar card, Bank account, aur Police verification/character certificate available hai?"</i><br/>` +
        `4. <b>Physical Fitness (Security):</b> Height check (min 5'7"+) aur uniform discipline confirm karein.<br/>` +
        `5. <b>Notice Period:</b> <i>"Kitne din me duty join kar sakte hain?"</i> (Immediate joiners preferred).<br/><br/>` +
        `💡 <i>Proactive Suggestion:</i> Aap jis role ke liye hiring kar rahe hain, mujhe batayein (e.g. <i>"Delhi me 15 security guard"</i>), main live candidate listings pull kar dunga!`;
    }

    // Attrition & Retention Tips
    if (/\b(attrition|retention|turnover|chhod|bhag|leave|absent|chhutti)\b/i.test(q)) {
      return `🛡️ <b>Proven Strategies to Reduce Staff Attrition in Facility/Security:</b><br/><br/>` +
        `1. <b>Strict On-Time Salary (7th of every month):</b> Blue-collar staff ka sabse bada turnover reason delayed salary hota hai.<br/>` +
        `2. <b>Monthly Attendance Bonus:</b> Full month zero-absenteeism par ₹500 – ₹1,000 ka cash incentive dein.<br/>` +
        `3. <b>Regular Supervisor Check-ins:</b> Ground par supervisor ka respectful behavior guard turnover 30% drop kar deta hai.<br/>` +
        `4. <b>Rotational Shift Fatigue Management:</b> Continuous 12-hr night shifts na lagayein, weekly off ensure karein.<br/><br/>` +
        `Kya aapko fresh candidates source karne hain to bridge recent vacancies?`;
    }

    // Default intelligent guidance
    return `Main aapki talent acquisition, candidate screening, aur recruitment planning me madad kar sakta hoon.<br/><br/>` +
      `• <b>Live Sourcing:</b> <i>"Delhi me 20 security guard chahiye"</i> ya <i>"Gurugram 15 pantry boy"</i><br/>` +
      `• <b>Salary Benchmarks:</b> <i>"Security supervisor ki salary kya hoti hai?"</i><br/>` +
      `• <b>Screening Guides:</b> <i>"Housekeeping staff ke interview me kya puchhe?"</i><br/><br/>` +
      `Batayein ${honorific}, kis position ke liye talent plan karna hai?`;
  },

  buildResultMessage(intent, records, report, requested) {
    const ok = report.filter(r => r.ok);
    const failed = report.filter(r => !r.ok);
    const withPhone = records.filter(r => r.phone).length;
    const honorific = window.UserProfileManager?.getHonorificName?.() || 'Sir';

    let html = `🎯 Sourced <b>${records.length}</b> verified listing${records.length === 1 ? '' : 's'} for `
      + `<b>${this.escapeHtml(intent.role)}</b>${intent.city ? ' in <b>' + this.escapeHtml(intent.city) + '</b>' : ''}.`;
    html += `<div style="font-size:12px; color:#64748b; margin-top:8px; line-height:1.7;">`;
    ok.forEach(r => { html += `✓ ${r.source}: <b>${r.count}</b><br/>`; });
    failed.forEach(r => { html += `⚠ ${r.source}: ${this.escapeHtml(r.error || 'no data')}<br/>`; });
    html += `</div>`;
    html += `<div style="font-size:12px; color:#334155; margin-top:8px;">`
      + `${withPhone} listing${withPhone === 1 ? '' : 's'} include a direct published contact number. `
      + `All candidates are saved to your Candidate Database below and the Excel sheet has been generated.</div>`;
    if (records.length < requested) {
      html += `<div style="font-size:11.5px; color:#94a3b8; margin-top:6px;">`
        + `Fewer than ${requested} were available for this exact query — try a broader role title or another nearby city.</div>`;
    }
    html += `<div style="margin-top:10px; padding:8px 12px; background:rgba(37,99,235,0.06); border-left:3px solid #2563eb; border-radius:4px; font-size:12px; color:#1e40af;">`
      + `💡 <b>Proactive Next Step for ${honorific}:</b> In candidates ko contact karte waqt, kya aap chahte hain ki main ek customized WhatsApp interview invite message ya 5-point telephonic screening checklist generate kar doon?</div>`;
    return html;
  },

  buildNoResultMessage(intent, report) {
    const failed = report.filter(r => !r.ok);
    let html = `No live listings came back for <b>${this.escapeHtml(intent.role)}</b>`
      + `${intent.city ? ' in <b>' + this.escapeHtml(intent.city) + '</b>' : ''}.`;
    if (failed.length) {
      html += `<div style="font-size:12px; color:#64748b; margin-top:8px; line-height:1.7;">`;
      failed.forEach(r => { html += `⚠ ${r.source}: ${this.escapeHtml(r.error || 'no data')}<br/>`; });
      html += `</div>`;
    }
    html += `<div style="font-size:12px; color:#334155; margin-top:6px;">Try a more common job title, a different city, or enable more sources.</div>`;
    return html;
  },

  escapeHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  },

  // These three mirror app.js's Chat-page message rendering exactly
  // (chat-message / chat-avatar / chat-bubble) so Candidate AI looks pixel
  // identical to Client AI while keeping its own real sourcing logic.
  hideWelcome() {
    const welcome = document.getElementById('candidate-chat-welcome');
    if (welcome) welcome.style.display = 'none';
  },

  async loadChatHistory() {
    try {
      if (!window.MemoryEngine?.getCandidateChatHistory) return;
      const history = await window.MemoryEngine.getCandidateChatHistory(30);
      if (history && history.length) {
        this.hideWelcome();
        history.forEach(m => {
          if (m.role === 'user') this.appendUserMessage(m.text, false);
          else this.appendAiMessage(m.text, false);
        });
      }
    } catch (_) {}
  },

  createActionToolbar(bubble, container, inputId) {
    const actionsDiv = document.createElement('div');
    actionsDiv.className = 'chat-msg-actions';
    actionsDiv.innerHTML = `
      <button type="button" class="chat-act-btn act-copy" title="Copy message" aria-label="Copy message">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>
        <span class="act-label">Copy</span>
      </button>
      <button type="button" class="chat-act-btn act-retry" title="Retry response" aria-label="Retry response">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67"/></svg>
        <span class="act-label">Retry</span>
      </button>
      <button type="button" class="chat-act-btn act-like" title="Helpful" aria-label="Good response">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 9V5a3 3 0 0 0-3-3l-4 9v11h11.28a2 2 0 0 0 2-1.7l1.38-9a2 2 0 0 0-2-2.3zM7 22H4a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2h3"></path></svg>
      </button>
      <button type="button" class="chat-act-btn act-dislike" title="Not helpful" aria-label="Bad response">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 15v4a3 3 0 0 0 3 3l4-9V2H5.72a2 2 0 0 0-2 1.7l-1.38 9a2 2 0 0 0 2 2.3zm7-13h3a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2h-3"></path></svg>
      </button>
    `;

    const copyBtn = actionsDiv.querySelector('.act-copy');
    if (copyBtn) {
      copyBtn.onclick = () => {
        const textToCopy = bubble.innerText;
        navigator.clipboard.writeText(textToCopy).then(() => {
          copyBtn.classList.add('is-copied');
          const label = copyBtn.querySelector('.act-label');
          if (label) label.textContent = 'Copied!';
          setTimeout(() => {
            copyBtn.classList.remove('is-copied');
            if (label) label.textContent = 'Copy';
          }, 2000);
        }).catch(() => {});
      };
    }

    const retryBtn = actionsDiv.querySelector('.act-retry');
    if (retryBtn) {
      retryBtn.onclick = () => {
        const userMessages = (container || document).querySelectorAll('.chat-message.user .chat-bubble');
        if (userMessages.length > 0) {
          const lastUserText = userMessages[userMessages.length - 1].innerText.trim();
          const input = document.getElementById(inputId || 'candidate-ai-input');
          if (input) {
            input.value = lastUserText;
            if (typeof window.CandidatesCtrl?.handleAiChatSubmit === 'function') {
              window.CandidatesCtrl.handleAiChatSubmit();
            } else if (typeof handleCandidateChatSend === 'function') {
              handleCandidateChatSend();
            }
          }
        }
      };
    }

    const likeBtn = actionsDiv.querySelector('.act-like');
    const dislikeBtn = actionsDiv.querySelector('.act-dislike');
    if (likeBtn) {
      likeBtn.onclick = () => {
        likeBtn.classList.toggle('is-active');
        if (dislikeBtn) dislikeBtn.classList.remove('is-active');
      };
    }
    if (dislikeBtn) {
      dislikeBtn.onclick = () => {
        dislikeBtn.classList.toggle('is-active');
        if (likeBtn) likeBtn.classList.remove('is-active');
      };
    }

    return actionsDiv;
  },

  appendAiMessage(html, save = true) {
    const messages = document.getElementById('candidate-chat-messages');
    if (!messages) return;
    this.hideWelcome();

    if (typeof window.streamAssistantMessage === 'function') {
      window.streamAssistantMessage({
        container: messages,
        text: html,
        welcomeId: 'candidate-chat-welcome',
        inputId: 'candidate-ai-input',
        createToolbar: (bubble, container, inputId) => this.createActionToolbar(bubble, container, inputId)
      });
    } else {
      const msgDiv = document.createElement('div');
      msgDiv.className = 'chat-message assistant';

      const avatar = document.createElement('div');
      avatar.className = 'chat-avatar';
      avatar.textContent = 'AI';

      const contentWrap = document.createElement('div');
      contentWrap.className = 'chat-content-wrap';

      const bubble = document.createElement('div');
      bubble.className = 'chat-bubble';

      const parsedHtml = (typeof window.parseChatMarkdown === 'function')
        ? window.parseChatMarkdown(html)
        : (html || '');
      bubble.innerHTML = parsedHtml;

      const actionsDiv = this.createActionToolbar(bubble, messages, 'candidate-ai-input');
      contentWrap.appendChild(bubble);
      contentWrap.appendChild(actionsDiv);

      msgDiv.appendChild(avatar);
      msgDiv.appendChild(contentWrap);
      messages.appendChild(msgDiv);
      messages.scrollTop = messages.scrollHeight;
    }

    if (save) {
      try {
        window.MemoryEngine?.addCandidateChatMessage?.({
          id: `cand_a_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
          role: 'assistant',
          text: html,
          timestamp: Date.now()
        });
      } catch (_) {}
    }
  },

  appendUserMessage(text, save = true) {
    const messages = document.getElementById('candidate-chat-messages');
    if (!messages) return;
    this.hideWelcome();

    const msgDiv = document.createElement('div');
    msgDiv.className = 'chat-message user';

    const avatar = document.createElement('div');
    avatar.className = 'chat-avatar';
    avatar.textContent = 'U';

    const bubble = document.createElement('div');
    bubble.className = 'chat-bubble';
    bubble.textContent = text;

    msgDiv.appendChild(avatar);
    msgDiv.appendChild(bubble);
    messages.appendChild(msgDiv);
    messages.scrollTop = messages.scrollHeight;

    if (save) {
      try {
        window.MemoryEngine?.addCandidateChatMessage?.({
          id: `cand_u_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
          role: 'user',
          text: text,
          timestamp: Date.now()
        });
      } catch (_) {}
    }
  },

  showTypingIndicator() {
    const messages = document.getElementById('candidate-chat-messages');
    if (!messages) return;
    this.hideWelcome();

    const row = document.createElement('div');
    row.id = 'cand-typing-indicator';
    row.className = 'chat-message assistant lx-status-row';
    row.innerHTML = `
      <div class="chat-avatar lx-status-avatar">
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m12 3-1.9 5.8a2 2 0 0 1-1.3 1.3L3 12l5.8 1.9a2 2 0 0 1 1.3 1.3L12 21l1.9-5.8a2 2 0 0 1 1.3-1.3L21 12l-5.8-1.9a2 2 0 0 1-1.3-1.3Z"/></svg>
      </div>
      <div class="lx-ai-status" role="status" aria-live="polite">
        <div class="lx-ai-status-glow"></div>
        <div class="lx-ai-status-main">
          <span class="lx-ai-status-dots"><i></i><i></i><i></i></span>
          <span class="lx-ai-status-text">Thinking</span>
        </div>
        <div class="lx-ai-status-track"><div class="lx-ai-status-bar"></div></div>
      </div>`;
    messages.appendChild(row);
    messages.scrollTop = messages.scrollHeight;

    const textEl = row.querySelector('.lx-ai-status-text');
    const barEl = row.querySelector('.lx-ai-status-bar');
    this._statusStep = (label, pct) => {
      if (label && textEl && textEl.textContent !== label) {
        textEl.classList.remove('lx-flip'); void textEl.offsetWidth;
        textEl.textContent = label; textEl.classList.add('lx-flip');
      }
      if (typeof pct === 'number' && barEl) barEl.style.width = `${Math.max(6, Math.min(100, pct))}%`;
    };
  },

  removeTypingIndicator() {
    const el = document.getElementById('cand-typing-indicator');
    if (el) el.remove();
    this._statusStep = null;
  },

  resetCandidateChat() {
    const messages = document.getElementById('candidate-chat-messages');
    if (messages) {
      messages.innerHTML = '';
      messages.style.removeProperty('display');
    }
    const welcome = document.getElementById('candidate-chat-welcome');
    if (welcome) welcome.style.removeProperty('display');
    const box = document.querySelector('#view-candidate-ai .chat-container');
    if (box) box.dataset.chatState = 'empty';
    const input = document.getElementById('candidate-ai-input') || document.getElementById('cand-chat-input');
    if (input) {
      input.value = '';
      if (typeof window.resetComposer === 'function') {
        window.resetComposer(input);
      } else {
        input.style.removeProperty('height');
        input.style.setProperty('height', '28px', 'important');
        input.style.setProperty('--lx-ta-h', '28px');
        input.classList.remove('lx-grow-scroll', 'au-shrinking', 'au-measuring');
        input.dataset.grow = 'fit';
        input.dispatchEvent(new Event('input', { bubbles: true }));
      }
    }
    const status = document.getElementById('candidate-ai-status');
    if (status) status.textContent = '';
    this.removeTypingIndicator();
    this.isScraping = false;
    try {
      if (window.MemoryEngine?.clearCandidateChatHistory) {
        window.MemoryEngine.clearCandidateChatHistory();
      }
    } catch (_) {}
    if (window.showToast) window.showToast('Started a new candidate search session.', 'info');
  },

  reachoutWhatsAppByPhone(phone, name, role, city) {
    let p = (phone || '').replace(/[^0-9]/g, '');
    if (p.length === 10) p = '91' + p;
    const company = (window.UserProfileManager?.getProfile?.().company) || 'our company';
    const msg = `Namaste,\nWe came across the ${role || 'job'} listing${city ? ' in ' + city : ''} and represent ${company}. `
      + `Are you still hiring / open to connect regarding staffing? Please reply to discuss.`;
    window.open(`https://wa.me/${p}?text=${encodeURIComponent(msg)}`, '_blank');
  }
};

// Global Bridges
window.CandidatesCtrl = CandidatesCtrl;
window.initCandidatesView = () => CandidatesCtrl.init();
window.handleCandidateChatSend = () => CandidatesCtrl.handleAiChatSubmit();
window.resetCandidateChat = () => CandidatesCtrl.resetCandidateChat();
window.exportCandidatesCSV = () => CandidatesCtrl.exportCSV();
window.exportCandidatesExcel = () => CandidatesCtrl.exportExcel();
window.clearAllCandidates = () => CandidatesCtrl.clearAll();

document.addEventListener('DOMContentLoaded', () => {
  CandidatesCtrl.init();
});
