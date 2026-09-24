/**
 * ============================================================
 *  JARVIS SKILLS ENGINE (jarvis_skills.js)
 *  Registry of real, callable "tools" Jarvis can invoke to actually DO
 *  things in this app — not just talk about them. Every skill:
 *    - has a name, a short description (for the LLM's tool menu)
 *    - a JSON parameter schema (for the LLM to fill in)
 *    - a run(params) function that performs the real action and
 *      returns a plain-language result string
 *
 *  Built-in skills wrap existing, already-working app functions
 *  (lead generation, CSV/Excel export, Sheets sync, candidate search,
 *  navigation). Dev Mode lets Jarvis register NEW skills at runtime by
 *  writing its own JS function body, sandboxed and persisted so it's
 *  available in future sessions too.
 * ============================================================
 */

const JarvisSkills = (() => {
  const registry = new Map(); // name -> { description, params, run, builtin }

  // ── Shared validation helpers (pure — covered by _selfTest below) ──
  const VALID_STATUSES = ['New', 'Contacted', 'Qualified', 'Closed'];
  const isValidEmail = (s) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(s || '').trim());
  const normalizeStatus = (s) =>
    VALID_STATUSES.find(v => v.toLowerCase() === String(s || '').trim().toLowerCase()) || null;

  function register(name, { description, params = {}, run, builtin = false }) {
    registry.set(name, { name, description, params, run, builtin });
  }

  function unregister(name) {
    const skill = registry.get(name);
    if (skill && skill.builtin) throw new Error('Cannot remove a built-in skill.');
    registry.delete(name);
  }

  function has(name) {
    return registry.has(name);
  }

  function get(name) {
    return registry.get(name);
  }

  function list() {
    return [...registry.values()];
  }

  /** Renders the skill menu as compact text for the LLM system prompt. */
  function describeForPrompt() {
    return list()
      .map(s => `- ${s.name}(${Object.keys(s.params || {}).join(', ')}): ${s.description || ''}`)
      .join('\n');
  }

  // Single choke point for EVERY skill call — the agentic loop, voice commands
  // and Dev Mode all route through here, so the risk gate and the result check
  // belong here rather than in each caller.
  async function invoke(name, params = {}) {
    const skill = registry.get(name);
    if (!skill) return { success: false, error: `Unknown skill: ${name}` };

    // Risk gate: anything at or above the configured risk level needs an
    // explicit yes from the owner before it runs.
    const gate = await window.ClavisMind?.safety?.gate?.(name, params || {});
    if (gate && !gate.allowed) {
      return { success: false, error: `Not run — ${gate.reason}.`, riskLevel: gate.riskLevel, denied: true };
    }

    try {
      const result = await skill.run(params || {});
      const outcome = { success: true, result };
      window.ClavisMind?.emit?.({
        type: 'tool.completed', source: 'tool', importance: 0.4,
        metadata: { tool: name, riskLevel: gate?.riskLevel ?? 0 },
      });
      return outcome;
    } catch (err) {
      const outcome = { success: false, error: err?.message || String(err) };
      // Tell the model whether this is worth one retry instead of letting it
      // guess (or worse, report success it never got).
      const verdict = window.ClavisMind?.verify?.(outcome);
      if (verdict?.retryRecommended) outcome.retryRecommended = true;
      window.ClavisMind?.emit?.({
        type: 'tool.failed', source: 'tool', importance: 0.6,
        metadata: { tool: name, reason: outcome.error, riskLevel: gate?.riskLevel ?? 0 },
      });
      return outcome;
    }
  }

  // ── Load persisted custom (Dev Mode) skills on startup ──────────
  async function loadCustomSkills() {
    if (!window.MemoryEngine?.getAllCustomSkills) return;
    const saved = await window.MemoryEngine.getAllCustomSkills();
    for (const s of saved) {
      try {
        // eslint-disable-next-line no-new-func
        const fn = new Function('params', 'app', `"use strict";\n${s.code}`);
        register(s.name, {
          description: s.description,
          params: s.params || {},
          run: (params) => fn(params, buildSandboxAPI()),
          builtin: false,
        });
      } catch (err) {
        console.error(`Failed to load custom skill "${s.name}":`, err);
      }
    }
  }

  /**
   * Sandbox API exposed to Dev-Mode-written skill code as the `app` argument.
   * Deliberately a curated allowlist — NOT raw `window` access — so
   * self-written code can do useful things without full page control.
   */
  function buildSandboxAPI() {
    return {
      MemoryEngine: window.MemoryEngine,
      showToast: window.showToast,
      showView: window.showView,
      escHtml: window.escHtml,
      fetch: window.fetch.bind(window),
      getAllLeads: () => window.MemoryEngine.getAllLeads(),
      getAllCandidates: () => window.MemoryEngine.getAllCandidates(),
    };
  }

  // ================================================================
  //  BUILT-IN SKILLS — real wrappers around existing app functionality
  // ================================================================

  register('generate_leads', {
    description: 'Run the lead-generation agent for given cities/industries/service type. Actually scrapes and saves new leads.',
    params: { cities: 'array of city names', industries: 'array of industry names (optional, defaults to all)', serviceType: 'array: Security, Housekeeping, or both', count: 'number of leads per city+industry combo (default 5)' },
    builtin: true,
    run: async ({ cities = [], industries = [], serviceType = ['Security', 'Housekeeping'], count = 5 }) => {
      if (!cities.length) throw new Error('At least one city is required.');
      if (window.RealScraper?.isRunning?.()) {
        return 'Already sourcing leads from an earlier request right now — hold on, results will show up shortly instead of starting a duplicate search.';
      }
      if (typeof window.selectedLocations === 'undefined') throw new Error('Lead-gen module not loaded.');
      window.selectedLocations = cities;
      if (typeof window.renderLocationTags === 'function') window.renderLocationTags();

      if (typeof window.clearAllIndustries === 'function') window.clearAllIndustries();
      const finalIndustries = industries.length ? industries : (window.IndustryDB ? window.IndustryDB.getNames() : []);
      document.querySelectorAll('.industry-card').forEach(c => {
        if (finalIndustries.includes(c.dataset.key) && typeof window.toggleIndustry === 'function') {
          window.toggleIndustry(c.dataset.key, c);
        }
      });

      const secCb = document.getElementById('target-security');
      const hkCb = document.getElementById('target-housekeeping');
      if (secCb) secCb.checked = serviceType.includes('Security');
      if (hkCb) hkCb.checked = serviceType.includes('Housekeeping');

      const batchSlider = document.getElementById('batch-size');
      if (batchSlider) { batchSlider.value = Math.max(1, Math.min(10, count)); if (window.updateBatchInfo) window.updateBatchInfo(); }

      window.showView('agent');
      await window.startAgentPipeline();
      return `Started lead generation for ${cities.join(', ')} across ${finalIndustries.length} industries. Check the Run Agent page for live progress.`;
    },
  });

  register('get_lead_stats', {
    description: 'Fetch real counts of leads in the database, broken down by industry and city.',
    params: {},
    builtin: true,
    run: async () => {
      const leads = await window.MemoryEngine.getAllLeads();
      const byIndustry = {};
      const byCity = {};
      leads.forEach(l => {
        byIndustry[l.industry || l.sector || 'Unknown'] = (byIndustry[l.industry || l.sector || 'Unknown'] || 0) + 1;
        byCity[l.city || 'Unknown'] = (byCity[l.city || 'Unknown'] || 0) + 1;
      });
      return { total: leads.length, byIndustry, byCity };
    },
  });

  register('get_candidate_stats', {
    description: 'Fetch real counts of candidates in the database, broken down by role and city.',
    params: {},
    builtin: true,
    run: async () => {
      const candidates = await window.MemoryEngine.getAllCandidates();
      const byRole = {};
      const byCity = {};
      candidates.forEach(c => {
        byRole[c.role || 'Unknown'] = (byRole[c.role || 'Unknown'] || 0) + 1;
        byCity[c.city || 'Unknown'] = (byCity[c.city || 'Unknown'] || 0) + 1;
      });
      return { total: candidates.length, byRole, byCity };
    },
  });

  register('list_leads', {
    description: 'Return actual lead records (company, city, industry, phone, email, status), optionally filtered by city/industry/status. Use when the owner asks to SEE or GET specific leads.',
    params: { city: 'optional city', industry: 'optional industry', status: 'optional status', limit: 'max records (default 15)' },
    builtin: true,
    run: async ({ city, industry, status, limit = 15 }) => {
      let leads = await window.MemoryEngine.getAllLeads();
      if (city) leads = leads.filter(l => (l.city || '').toLowerCase().includes(String(city).toLowerCase()));
      if (industry) leads = leads.filter(l => ((l.industry || l.sector || '')).toLowerCase().includes(String(industry).toLowerCase()));
      if (status) leads = leads.filter(l => (l.status || '').toLowerCase() === String(status).toLowerCase());
      const rows = leads.slice(0, limit).map(l => ({ company: l.company, city: l.city, industry: l.industry || l.sector, phone: l.phone || '', email: l.email || '', status: l.status || 'New' }));
      return { matched: leads.length, showing: rows.length, leads: rows };
    },
  });

  register('list_candidates', {
    description: 'Return actual candidate records (name, role, city, phone), optionally filtered by city/role. Use when the owner asks to SEE or GET specific candidates.',
    params: { city: 'optional city', role: 'optional role', limit: 'max records (default 15)' },
    builtin: true,
    run: async ({ city, role, limit = 15 }) => {
      let cands = await window.MemoryEngine.getAllCandidates();
      if (city) cands = cands.filter(c => (c.city || '').toLowerCase().includes(String(city).toLowerCase()));
      if (role) cands = cands.filter(c => (c.role || '').toLowerCase().includes(String(role).toLowerCase()));
      const rows = cands.slice(0, limit).map(c => ({ name: c.name, role: c.role, city: c.city, phone: c.phone || '' }));
      return { matched: cands.length, showing: rows.length, candidates: rows };
    },
  });

  register('export_leads', {
    description: 'Export current leads to a downloadable file.',
    params: { format: '"csv" or "excel"' },
    builtin: true,
    run: async ({ format = 'csv' }) => {
      if (format === 'excel') window.exportExcel();
      else window.exportCSV();
      return `Exported leads as ${format.toUpperCase()}. Check your Downloads folder.`;
    },
  });

  register('sync_leads_to_sheets', {
    description: 'Push all unsynced leads to the configured Google Sheet.',
    params: {},
    builtin: true,
    run: async () => {
      const result = await window.syncAllToSheets();
      if (!result.success) throw new Error(result.reason === 'no_url' ? 'Google Sheets URL is not configured in Settings.' : result.reason);
      return `Synced ${result.synced} leads to Google Sheets.`;
    },
  });

  register('navigate_to_page', {
    description: 'Switch the app to a different page/view.',
    params: { view: 'one of: dashboard, leads, candidate-db, agent, excel, analytics, settings, voice-ai, accounts, jarvis' },
    builtin: true,
    run: async ({ view }) => {
      if (!document.getElementById(`view-${view}`)) throw new Error(`No such page: ${view}`);
      window.showView(view);
      return `Opened the ${view} page.`;
    },
  });

  register('filter_leads', {
    description: 'Filter the Leads page table by industry/city/status and show it.',
    params: { industry: 'optional industry name', city: 'optional city name', status: 'optional: New, Contacted, Qualified, Closed' },
    builtin: true,
    run: async ({ industry, city, status }) => {
      window.showView('leads');
      await new Promise(r => setTimeout(r, 150));
      if (industry) {
        const sel = document.getElementById('filter-industry');
        const match = sel && Array.from(sel.options).find(o => o.value.toLowerCase().includes(industry.toLowerCase()));
        if (match) sel.value = match.value;
      }
      if (city) {
        const sel = document.getElementById('filter-city');
        const match = sel && Array.from(sel.options).find(o => o.value.toLowerCase() === city.toLowerCase());
        if (match) sel.value = match.value;
      }
      if (status) {
        const sel = document.getElementById('filter-status');
        if (sel) sel.value = status;
      }
      if (typeof window.applyFilters === 'function') window.applyFilters();
      return `Filtered leads${industry ? ' — industry: ' + industry : ''}${city ? ' — city: ' + city : ''}${status ? ' — status: ' + status : ''}.`;
    },
  });

  register('remember_fact', {
    description: 'Save a long-term fact about the owner or business that should be recalled in future sessions.',
    params: { key: 'short label', value: 'the fact to remember' },
    builtin: true,
    run: async ({ key, value }) => {
      await window.JarvisEngine.rememberFact(key, value);
      if (window.refreshJarvisSidePanels) window.refreshJarvisSidePanels();
      return `Saved to memory: ${key} = ${value}`;
    },
  });

  register('generate_call_script', {
    description: 'Generate a call script for an outbound client call.',
    params: { clientName: 'string', clientBusiness: 'string', purpose: 'string', language: 'Hindi, English, or Hinglish' },
    builtin: true,
    run: async (params) => {
      const script = await window.JarvisEngine.generateCallScript(params);
      if (window.refreshJarvisSidePanels) window.refreshJarvisSidePanels();
      return `Call script generated for ${script.clientName}. You can view/copy it from the Recent Call Scripts panel.`;
    },
  });

  register('send_email', {
    description: 'Draft and SEND a real email to one recipient via the configured Gmail/Outlook webhook. Always shows the owner a confirmation preview first — nothing is sent without approval. Use for one-off emails like "email the Taj Hotel manager our security quote".',
    params: { to: 'recipient email address', subject: 'subject line', body: 'full email body (plain text; line breaks become paragraphs)', cc: 'optional comma-separated CC addresses', bcc: 'optional comma-separated BCC addresses' },
    builtin: true,
    run: async ({ to, subject, body, cc = '', bcc = '' }) => {
      if (!window.EmailCtrl?._sendOne) throw new Error('Email module not loaded — open the Email page once, then retry.');
      to = String(to || '').trim();
      subject = String(subject || '').trim();
      body = String(body || '').trim();
      if (!isValidEmail(to)) throw new Error(`"${to}" is not a valid email address.`);
      if (!subject) throw new Error('Subject is required.');
      if (!body) throw new Error('Email body is required.');

      // ── Confirm-before-send gate: a human MUST approve every real send. ──
      // FIX (2026-09-04): was a raw window.confirm() — blocks the whole tab and
      // Chrome can silently disable repeated native dialogs page-wide, which
      // would let a send through (or block) with no visible error. Now uses the
      // shared styled clavisConfirm() dialog (see jarvis_ui.js).
      const preview = `To: ${to}${cc ? `\nCc: ${cc}` : ''}${bcc ? `\nBcc: ${bcc}` : ''}\nSubject: ${subject}\n\n${body}`;
      const confirmFn = window.clavisConfirm || ((msg) => Promise.resolve(window.confirm(msg)));
      const approved = await confirmFn(preview, { title: 'Send this email?', okLabel: 'Send', cancelLabel: 'Cancel' });
      if (!approved) return 'Email cancelled by the owner — nothing was sent.';

      const htmlBody = /<[a-z][\s\S]*>/i.test(body) ? body : body.replace(/\n/g, '<br>');
      const result = await window.EmailCtrl._sendOne({ to, subject, htmlBody, cc, bcc });
      if (!result || !result.success) throw new Error(result?.error || 'Send failed.');
      return `Email sent to ${to} — subject: "${subject}".`;
    },
  });

  register('update_lead_status', {
    description: 'Update a lead\'s CRM status by company name. Use for commands like "mark Taj Hotel as contacted".',
    params: { company: 'company name (or part of it) to match the lead', status: 'one of: New, Contacted, Qualified, Closed' },
    builtin: true,
    run: async ({ company, status }) => {
      const norm = normalizeStatus(status);
      if (!norm) throw new Error(`Status must be one of: ${VALID_STATUSES.join(', ')}.`);
      const q = String(company || '').trim().toLowerCase();
      if (!q) throw new Error('Company name is required.');
      const leads = await window.MemoryEngine.getAllLeads();
      const matches = leads.filter(l => (l.company || '').toLowerCase().includes(q));
      if (!matches.length) throw new Error(`No lead found matching "${company}".`);
      if (matches.length > 1) {
        return `Found ${matches.length} leads matching "${company}": ${matches.slice(0, 5).map(l => l.company).join(', ')}. Please be more specific.`;
      }
      const lead = matches[0];
      await window.MemoryEngine.updateLead(lead.id, { status: norm });
      const cached = window.allLeads && window.allLeads.find(l => l.id === lead.id);
      if (cached) cached.status = norm;                 // keep in-memory table in sync
      try { window.updateAllUI && window.updateAllUI(); } catch {}
      return `${lead.company} marked as ${norm}.`;
    },
  });

  register('add_candidate', {
    description: 'Add a new staff candidate (e.g. Security Guard, Housekeeping) to the candidate database.',
    params: { name: 'candidate full name', role: 'job role', city: 'city (optional)', phone: 'phone number (optional)' },
    builtin: true,
    run: async ({ name, role, city = '', phone = '' }) => {
      if (!String(name || '').trim()) throw new Error('Candidate name is required.');
      const candidate = {
        id: `cand_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
        name: String(name).trim(),
        role: String(role || '').trim() || 'Unspecified',
        city: String(city || '').trim(),
        phone: String(phone || '').trim(),
        addedAt: Date.now(),
        source: 'clavis',
      };
      await window.MemoryEngine.addCandidate(candidate);
      try { window.CandidatesCtrl?.render?.(); } catch {}
      return `Added candidate ${candidate.name} (${candidate.role}${candidate.city ? ', ' + candidate.city : ''}).`;
    },
  });

  // ── PC control (native bridge only) — Clavis's "hands" on the real
  //    desktop, not just the browser tab. Every call goes through
  //    window.ClavisPC, which throws a clear error if the bridge isn't
  //    running or control isn't enabled — invoke()'s catch turns that into
  //    a spoken explanation rather than a silent failure. click/type/key are
  //    registered at a higher risk tier (see clavis-mind.js RISKY map) so the
  //    owner gets one confirm() before Clavis touches the real mouse/keyboard.
  register('pc_move_mouse', {
    description: 'Move the real OS mouse cursor to a screen pixel coordinate (does not click). Use pc_get_screen first if unsure of screen size.',
    params: { x: 'pixel x from screen left', y: 'pixel y from screen top' },
    builtin: true,
    run: async ({ x, y }) => { await window.ClavisPC.moveMouse(Number(x), Number(y)); return `Moved the cursor to (${x}, ${y}).`; },
  });

  register('pc_click', {
    description: 'Click the real mouse at a screen pixel coordinate. button: left|right|middle. double: true for a double-click.',
    params: { x: 'pixel x', y: 'pixel y', button: 'left|right|middle (optional, default left)', double: 'true for double-click (optional)' },
    builtin: true,
    run: async ({ x, y, button = 'left', double = false }) => {
      await window.ClavisPC.click(Number(x), Number(y), { button, double: Boolean(double) });
      return `${double ? 'Double-c' : 'C'}licked (${button}) at (${x}, ${y}).`;
    },
  });

  register('pc_scroll', {
    description: 'Scroll the real mouse wheel. Positive amount scrolls up, negative scrolls down.',
    params: { amount: 'wheel notches, positive=up negative=down', x: 'optional x to move to first', y: 'optional y to move to first' },
    builtin: true,
    run: async ({ amount, x, y }) => { await window.ClavisPC.scroll(Number(amount), x != null ? Number(x) : undefined, y != null ? Number(y) : undefined); return `Scrolled ${amount > 0 ? 'up' : 'down'} ${Math.abs(amount)}.`; },
  });

  register('pc_drag', {
    description: 'Press the left mouse button at one point, drag to another, then release. For drag-and-drop or sliders.',
    params: { x: 'start x', y: 'start y', x2: 'end x', y2: 'end y' },
    builtin: true,
    run: async ({ x, y, x2, y2 }) => { await window.ClavisPC.drag(Number(x), Number(y), Number(x2), Number(y2)); return `Dragged from (${x}, ${y}) to (${x2}, ${y2}).`; },
  });

  register('pc_type_text', {
    description: 'Type literal text at wherever the OS text cursor/focus currently is — like a human typing on the keyboard. Does not click anything first.',
    params: { text: 'the literal text to type' },
    builtin: true,
    run: async ({ text }) => { await window.ClavisPC.typeText(text); return `Typed: "${String(text).slice(0, 60)}${String(text).length > 60 ? '…' : ''}"`; },
  });

  register('pc_press_key', {
    description: 'Press a keyboard shortcut or special key using Windows SendKeys syntax, e.g. "^c" for Ctrl+C, "{ENTER}", "%{F4}" for Alt+F4, "^{s}" for Ctrl+S.',
    params: { keys: 'SendKeys-syntax key combination' },
    builtin: true,
    run: async ({ keys }) => { await window.ClavisPC.pressKeys(keys); return `Pressed ${keys}.`; },
  });

  register('pc_get_screen', {
    description: 'Read-only. Returns the real screen resolution/bounds, so coordinates for mouse actions can be chosen correctly.',
    params: {},
    builtin: true,
    run: async () => {
      const size = await window.ClavisPC.screenSize();
      if (!size) return 'Screen size is not available (bridge not running).';
      return `Screen is ${size.width}x${size.height}, origin at (${size.left}, ${size.top}).`;
    },
  });

  register('pc_double_click', {
    description: 'Double-click the real mouse at a screen pixel coordinate.',
    params: { x: 'pixel x', y: 'pixel y' },
    builtin: true,
    run: async ({ x, y }) => { await window.ClavisPC.click(Number(x), Number(y), { double: true }); return `Double-clicked at (${x}, ${y}).`; },
  });

  register('pc_right_click', {
    description: 'Right-click the real mouse at a screen pixel coordinate (opens a context menu).',
    params: { x: 'pixel x', y: 'pixel y' },
    builtin: true,
    run: async ({ x, y }) => { await window.ClavisPC.click(Number(x), Number(y), { button: 'right' }); return `Right-clicked at (${x}, ${y}).`; },
  });

  register('pc_list_windows', {
    description: 'Read-only. Lists visible top-level windows on the real desktop (title, owning process) so a specific one can be targeted by name.',
    params: {},
    builtin: true,
    run: async () => {
      const wins = await window.ClavisPC.listWindows();
      if (!wins.length) return 'No visible windows found.';
      return wins.map((w) => `${w.title} (${w.process})`).join('\n');
    },
  });

  register('pc_get_cursor_position', {
    description: "Read-only. Returns the real OS mouse cursor's current pixel position.",
    params: {},
    builtin: true,
    run: async () => {
      const { x, y } = await window.ClavisPC.getCursorPosition();
      return `Cursor is at (${x}, ${y}).`;
    },
  });

  register('pc_minimize_window', {
    description: 'Minimize a real desktop window. Identify it by its visible title text (substring match) — use pc_list_windows first if unsure.',
    params: { title: 'window title or a distinctive substring of it' },
    builtin: true,
    run: async ({ title }) => { await window.ClavisPC.minimizeWindow(title); return `Minimized "${title}".`; },
  });

  register('pc_maximize_window', {
    description: 'Maximize a real desktop window. Identify it by its visible title text (substring match) — use pc_list_windows first if unsure.',
    params: { title: 'window title or a distinctive substring of it' },
    builtin: true,
    run: async ({ title }) => { await window.ClavisPC.maximizeWindow(title); return `Maximized "${title}".`; },
  });

  register('pc_restore_window', {
    description: 'Restore a minimized/maximized real desktop window to its normal size. Identify it by its visible title text.',
    params: { title: 'window title or a distinctive substring of it' },
    builtin: true,
    run: async ({ title }) => { await window.ClavisPC.restoreWindow(title); return `Restored "${title}".`; },
  });

  register('pc_focus_window', {
    description: 'Switch to (bring to front and focus) a real desktop window. Identify it by its visible title text.',
    params: { title: 'window title or a distinctive substring of it' },
    builtin: true,
    run: async ({ title }) => { await window.ClavisPC.focusWindow(title); return `Switched to "${title}".`; },
  });

  register('pc_close_window', {
    description: 'Close a real desktop window — like clicking the X. Unsaved work in it can be lost, so this always asks for a confirm first. Identify it by its visible title text.',
    params: { title: 'window title or a distinctive substring of it' },
    builtin: true,
    run: async ({ title }) => { await window.ClavisPC.closeWindow(title); return `Closed "${title}".`; },
  });

  register('pc_list_files', {
    description: 'Read-only. Lists files and folders inside a real path on this PC (name, type, size). Defaults to the user home folder if no path given.',
    params: { path: 'folder path (optional, defaults to the user home folder)' },
    builtin: true,
    run: async ({ path: p } = {}) => {
      const { entries } = await window.ClavisPC.listFiles(p);
      if (!entries.length) return 'That folder is empty.';
      return entries.map((e) => `${e.type === 'dir' ? '[dir] ' : ''}${e.name}`).join('\n');
    },
  });

  register('pc_search_files', {
    description: 'Read-only. Searches for files/folders whose name contains a query string, starting from a path (defaults to the user home folder).',
    params: { path: 'starting folder (optional)', query: 'text to search for in file/folder names' },
    builtin: true,
    run: async ({ path: p, query }) => {
      const results = await window.ClavisPC.searchFiles(p, query);
      if (!results.length) return `No files matching "${query}" found.`;
      return results.slice(0, 50).join('\n');
    },
  });

  register('pc_read_file', {
    description: "Read-only. Reads a real text file's content (up to 512KB). Use for config files, notes, code, logs, etc.",
    params: { path: 'file path to read' },
    builtin: true,
    run: async ({ path: p }) => { const { content } = await window.ClavisPC.readFile(p); return content; },
  });

  register('pc_write_file', {
    description: 'Create or overwrite a real text file with the given content. Creates parent folders if needed.',
    params: { path: 'file path to write', content: 'text content to write' },
    builtin: true,
    run: async ({ path: p, content }) => { const r = await window.ClavisPC.writeFile(p, content); return `Wrote ${String(content ?? '').length} characters to ${r.path}.`; },
  });

  register('pc_delete_file', {
    description: 'Permanently delete a real file or folder (and everything inside it, if a folder). Always asks for a confirm first — this cannot be undone.',
    params: { path: 'file or folder path to delete' },
    builtin: true,
    run: async ({ path: p }) => { const r = await window.ClavisPC.deleteFile(p); return `Deleted ${r.path}.`; },
  });

  register('pc_move_file', {
    description: 'Move or rename a real file or folder.',
    params: { from: 'current path', to: 'new path' },
    builtin: true,
    run: async ({ from, to }) => { const r = await window.ClavisPC.moveFile(from, to); return `Moved ${r.from} to ${r.to}.`; },
  });

  register('pc_create_folder', {
    description: 'Create a real folder (and any missing parent folders).',
    params: { path: 'folder path to create' },
    builtin: true,
    run: async ({ path: p }) => { const r = await window.ClavisPC.createFolder(p); return `Created folder ${r.path}.`; },
  });

  register('pc_run_python_script', {
    description: 'Runs a short Python script on the real PC and returns its output. Powerful and irreversible in effect — always asks for a confirm first.',
    params: { code: 'the Python source code to run', args: 'optional list of command-line arguments' },
    builtin: true,
    run: async ({ code, args }) => {
      const r = await window.ClavisPC.runPythonScript(code, args);
      const out = [r.stdout?.trim(), r.stderr?.trim() ? `stderr: ${r.stderr.trim()}` : ''].filter(Boolean).join('\n');
      return out || '(script ran with no output)';
    },
  });

  // Live internet answers: Google Search grounding (AI Studio key) first, then
  // Groq's built-in browser search (gpt-oss), then Wikipedia as the last net.
  async function groundedSearch(q) {
    const gem = window.ClavisDirect?.keyFor?.('gemini');
    if (gem) {
      for (const model of ['gemini-3.8-flash', 'gemini-3.5-flash', 'gemini-2.5-flash']) {
        const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(gem)}`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ role: 'user', parts: [{ text: `Search the web and answer factually and concisely (max 120 words), with today's information: ${q}` }] }],
            tools: [{ google_search: {} }],
          }),
        }).catch(() => null);
        if (!res) break;
        if (res.status === 404) continue;
        if (!res.ok) break;
        const data = await res.json();
        const cand = data.candidates?.[0];
        const answer = (cand?.content?.parts || []).map((p) => p.text || '').join('').trim();
        if (!answer) break;
        const sources = (cand?.groundingMetadata?.groundingChunks || []).map((c) => c.web && { title: c.web.title, url: c.web.uri }).filter(Boolean).slice(0, 5);
        return { found: true, via: 'Google Search', answer, sources, instruction: 'Answer only from this. Mention the source name if useful. If it does not cover the detail asked, say you could not verify it.' };
      }
    }
    const groq = window.ClavisDirect?.keyFor?.('groq');
    if (groq) {
      const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST', headers: { Authorization: `Bearer ${groq}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'openai/gpt-oss-20b', reasoning_effort: 'low', max_tokens: 600, temperature: 0.2,
          tools: [{ type: 'browser_search' }], tool_choice: 'required',
          messages: [{ role: 'user', content: `Search the web and answer factually and concisely (max 120 words): ${q}` }],
        }),
      }).catch(() => null);
      if (res && res.ok) {
        const data = await res.json();
        const answer = String(data.choices?.[0]?.message?.content || '').trim();
        if (answer) return { found: true, via: 'web search', answer, instruction: 'Answer only from this. If it does not cover the detail asked, say you could not verify it.' };
      }
    }
    return null;
  }

  register('search_web', {
    description: 'Look up anything real-world LIVE on the internet before stating it — news, prices, weather, people, companies, dates, events, "who is / what is / latest". Use this BEFORE answering anything you are not 100% certain of or that may have changed. Never state such a fact from memory alone.',
    params: { query: 'what to look up, e.g. "Sanjay Dutt parents" or "gold price in Delhi today"' },
    builtin: true,
    run: async ({ query }) => {
      const q = String(query || '').trim();
      if (!q) throw new Error('No search query given.');
      try { const live = await groundedSearch(q); if (live) return live; } catch (_) { /* fall back to Wikipedia */ }
      const searchUrl = `https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(q)}&srlimit=1&format=json&origin=*`;
      const searchRes = await fetch(searchUrl);
      if (!searchRes.ok) throw new Error(`Wikipedia search failed (${searchRes.status}).`);
      const searchData = await searchRes.json();
      const hit = searchData?.query?.search?.[0];
      if (!hit) return { found: false, note: 'No Wikipedia article matched this query. Tell the owner you could not verify this rather than guessing.' };
      const title = hit.title;
      const summaryRes = await fetch(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`);
      if (!summaryRes.ok) throw new Error(`Wikipedia summary failed (${summaryRes.status}).`);
      const summary = await summaryRes.json();
      return {
        found: true,
        title: summary.title,
        extract: summary.extract,
        url: summary.content_urls?.desktop?.page || `https://en.wikipedia.org/wiki/${encodeURIComponent(title)}`,
        instruction: 'Base your answer ONLY on this extract. If it does not cover the specific detail asked, say plainly that you could not verify it — do not fill the gap from memory.',
      };
    },
  });

  register('create_new_skill', {
    description: 'DEV MODE ONLY. When a requested task has no matching tool, Jarvis writes a brand-new skill for itself to make it possible, then it becomes available. Pass a clear description of the capability needed.',
    params: { instruction: 'plain-language description of the new capability to build' },
    builtin: true,
    run: async ({ instruction }) => {
      if (!window.JarvisEngine?.isDevMode?.()) {
        return 'Dev Mode is OFF, so I cannot write new code right now. Enable Dev Mode in Settings and I will build this capability.';
      }
      const res = await window.JarvisEngine.createSkillFromInstruction(instruction);
      if (!res.success) return `Could not create the skill: ${res.error}`;
      if (window.refreshJarvisSidePanels) window.refreshJarvisSidePanels();
      if (window.renderJarvisSkillsList) window.renderJarvisSkillsList();
      return `New skill "${res.skill.name}" created and ready: ${res.skill.description}. You can now ask me to use it.`;
    },
  });

  // Runnable check for the pure validation logic (run JarvisSkills._selfTest() in console).
  function _selfTest() {
    const checks = [
      isValidEmail('a@b.com') === true,
      isValidEmail('nope') === false,
      isValidEmail('a@b') === false,
      normalizeStatus('contacted') === 'Contacted',
      normalizeStatus('CLOSED') === 'Closed',
      normalizeStatus('bogus') === null,
    ];
    const passed = checks.filter(Boolean).length;
    console[passed === checks.length ? 'log' : 'error'](`JarvisSkills self-test: ${passed}/${checks.length} passed`);
    return passed === checks.length;
  }

  return {
    register,
    unregister,
    has,
    get,
    list,
    describeForPrompt,
    invoke,
    loadCustomSkills,
    buildSandboxAPI,
    _selfTest,
  };
})();

window.JarvisSkills = JarvisSkills;
