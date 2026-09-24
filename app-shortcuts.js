/**
 * ============================================================
 *  NEXUS AI SHORTCUTS HUB + CHAT HISTORY (app-shortcuts.js)
 *  - macOS-style Shortcuts window (opens like Settings)
 *  - Global keyboard shortcuts (⌘K palette, ⌘N new chat, ...)
 *  - Claude-inspired Chat History with local storage,
 *    per-chat delete, search, and reveal animations
 *  - Buttery-smooth sidebar wheel + edge-hover scrolling
 * ============================================================
 */
(function () {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };
  var isMac = /Mac|iPhone|iPad|iPod/.test(navigator.platform || navigator.userAgent || '');
  var MOD = isMac ? '⌘' : 'Ctrl';

  function escHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function toast(type, title, msg) {
    if (typeof window.showToast === 'function') window.showToast(type, title, msg);
  }
  function safeShowView(view) {
    try {
      if (typeof window.showView === 'function') { window.showView(view); return; }
    } catch (e) {}
    var el = $('view-' + view);
    if (el) { el.classList.add('active'); }
  }

  /* ════════════════════════════════════════════════════════════
     2. SHORTCUTS REGISTRY
  ════════════════════════════════════════════════════════════ */
  var CATS = {
    general: { label: 'General', icon: '<circle cx="12" cy="12" r="3"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41"/>' },
    nav:     { label: 'Navigation', icon: '<path d="M3 12l9-9 9 9"/><path d="M5 10v10a1 1 0 001 1h12a1 1 0 001-1V10"/>' },
    jarvis:  { label: 'Clavis AI', icon: '<circle cx="12" cy="12" r="3"/><path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"/>' },
    data:    { label: 'Data & Export', icon: '<ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"/><path d="M3 12c0 1.66 4 3 9 3s9-1.34 9-3"/>' }
  };

  var SHORTCUTS = [
    /* ── General ── */
    { id: 'open-shortcuts', cat: 'general', name: 'Open Shortcuts', desc: 'Shortcut hub & command palette',
      keys: [[MOD, 'K']], icon: '<polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>',
      action: function () { toggleShortcuts(); } },
    { id: 'new-chat', cat: 'general', name: 'New Chat', desc: 'Fresh Clavis conversation',
      keys: [[MOD, 'N']], icon: '<path d="M12 5v14M5 12h14"/>',
      action: function () { closeOverlays(); window.ChatHistory.newChat(); } },
    { id: 'chat-history', cat: 'general', name: 'Chat History', desc: 'Browse all previous conversations',
      keys: [[MOD, '⇧', 'H']], icon: '<path d="M3 3v5h5"/><path d="M3.05 13A9 9 0 106 5.3L3 8"/><path d="M12 7v5l4 2"/>',
      action: function () { window.ChatHistory.open(); } },
    { id: 'settings', cat: 'general', name: 'Open Settings', desc: 'System Settings window',
      keys: [[MOD, ',']], icon: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 11-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 11-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 11-2.83-2.83l.06-.06a1.65 1.65 0 00.33-1.82 1.65 1.65 0 00-1.51-1H3a2 2 0 110-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 112.83-2.83l.06.06a1.65 1.65 0 001.82.33H9a1.65 1.65 0 001-1.51V3a2 2 0 114 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 112.83 2.83l-.06.06a1.65 1.65 0 00-.33 1.82V9a1.65 1.65 0 001.51 1H21a2 2 0 110 4h-.09a1.65 1.65 0 00-1.51 1z"/>',
      action: function () { closeOverlays(); openSettings(); } },
    { id: 'toggle-theme', cat: 'general', name: 'Toggle Theme', desc: 'Switch dark / light mode',
      keys: [[MOD, '⇧', 'D']], icon: '<path d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z"/>',
      action: function () { closeOverlays(); toggleTheme(); } },

    /* ── Navigation ── */
    { id: 'nav-dashboard', cat: 'nav', name: 'Dashboard', desc: 'Overview & KPI analytics', keys: [[MOD, '1']],
      icon: '<rect x="3" y="3" width="7" height="9" rx="1"/><rect x="14" y="3" width="7" height="5" rx="1"/><rect x="14" y="12" width="7" height="9" rx="1"/><rect x="3" y="16" width="7" height="5" rx="1"/>',
      action: function () { runNav('dashboard'); } },
    { id: 'nav-leads', cat: 'nav', name: 'Leads Database', desc: 'All leads in Data Hub', keys: [[MOD, '2']],
      icon: '<ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"/><path d="M3 12c0 1.66 4 3 9 3s9-1.34 9-3"/>',
      action: function () { runNav('leads'); } },
    { id: 'nav-jarvis', cat: 'nav', name: 'Client AI', desc: 'Clavis AI Studio chat', keys: [[MOD, '3']],
      icon: '<circle cx="12" cy="5" r="2"/><circle cx="5" cy="19" r="2"/><circle cx="19" cy="19" r="2"/><path d="M12 7v8M5 19l5-4M19 19l-5-4"/>',
      action: function () { runNav('chat'); } },
    { id: 'nav-email', cat: 'nav', name: 'Email Automation', desc: 'Personalized bulk email campaigns', keys: [[MOD, '4']],
      icon: '<path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/>',
      action: function () { runNav('email'); } },
    { id: 'nav-whatsapp', cat: 'nav', name: 'WhatsApp Automation', desc: 'WhatsApp click-to-chat messaging', keys: [[MOD, '5']],
      icon: '<path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/>',
      action: function () { runNav('whatsapp'); } },
    { id: 'nav-agent', cat: 'nav', name: 'Run Agent', desc: 'Launch lead scraping agent', keys: [[MOD, '6']],
      icon: '<polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>',
      action: function () { runNav('agent'); } },
    { id: 'nav-analytics', cat: 'nav', name: 'Analytics', desc: 'Performance & conversion metrics', keys: [[MOD, '7']],
      icon: '<line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/>',
      action: function () { runNav('analytics'); } },
    { id: 'nav-accounts', cat: 'nav', name: 'Accounts', desc: 'Account & workspace profiles', keys: [[MOD, '8']],
      icon: '<path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>',
      action: function () { runNav('accounts'); } },

    /* ── Clavis AI ── */
    { id: 'j-voice', cat: 'jarvis', name: 'Voice Input', desc: 'Push-to-talk microphone', keys: [[MOD, '⇧', 'V']],
      icon: '<path d="M12 2a3 3 0 00-3 3v7a3 3 0 006 0V5a3 3 0 00-3-3z"/><path d="M19 10v2a7 7 0 01-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/>',
      action: function () { closeOverlays(); if (typeof window.startJarvisVoiceInput === 'function') window.startJarvisVoiceInput(); } },
    { id: 'j-stop', cat: 'jarvis', name: 'Stop Generation', desc: 'Abort Clavis reply instantly', keys: [[MOD, '⇧', 'X']],
      icon: '<rect x="6" y="6" width="12" height="12" rx="2"/>',
      action: function () { closeOverlays(); if (typeof window.stopJarvisGeneration === 'function') window.stopJarvisGeneration(); } },

    /* ── Data & Export ── */
    { id: 'd-excel', cat: 'data', name: 'Excel Export', desc: 'Export leads to .xlsx / .csv', keys: [[MOD, '9']],
      icon: '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M3 15h18M9 3v18M15 3v18"/>',
      action: function () { runNav('excel'); } }
  ];

  function runNav(view) {
    closeOverlays();
    safeShowView(view);
  }
  function openSettings() {
    if (typeof window.openSettingsModal === 'function') window.openSettingsModal();
  }
  function openSettingsSection(section) {
    openSettings();
    if (typeof window.settingsNavTo === 'function') {
      window.settingsNavTo(section, document.querySelector('.smodal-nav-item[data-section="' + section + '"]'));
    }
  }
  function toggleTheme() {
    if (typeof window.toggleDayNightTheme === 'function') window.toggleDayNightTheme();
    else {
      var d = document.documentElement;
      var next = d.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
      d.setAttribute('data-theme', next);
      localStorage.setItem('skylark-theme', next);
    }
  }

  /* ════════════════════════════════════════════════════════════
     3. SHORTCUTS MODAL
  ════════════════════════════════════════════════════════════ */
  var scOpen = false;
  var scQuery = '';
  var scCat = 'all';

  function toggleShortcuts() { scOpen ? closeShortcuts() : openShortcuts(); }

  function openShortcuts() {
    var ov = $('shortcuts-overlay');
    if (!ov) return;
    if (window.ChatHistory) window.ChatHistory.close();
    ov.classList.remove('closing');
    ov.classList.add('open');
    scOpen = true;
    var input = $('sc-search');
    if (input) { input.value = scQuery; setTimeout(function () { input.focus(); }, 60); }
    renderShortcuts();
  }

  function closeShortcuts() {
    var ov = $('shortcuts-overlay');
    if (!ov || !scOpen) return;
    ov.classList.add('closing');
    ov.classList.remove('open');
    scOpen = false;
    setTimeout(function () { ov.classList.remove('closing'); }, 180);
  }

  function closeOverlays() {
    closeShortcuts();
    if (window.ChatHistory) window.ChatHistory.close();
  }

  function renderShortcuts() {
    var grid = $('sc-grid');
    if (!grid) return;
    var q = scQuery.toLowerCase().trim();
    var matches = function (s) {
      if (scCat !== 'all' && s.cat !== scCat) return false;
      if (!q) return true;
      var hay = (s.name + ' ' + s.desc + ' ' + s.keys.map(function (k) { return k.join('+'); }).join(' ')).toLowerCase();
      return hay.indexOf(q) !== -1;
    };

    var html = '';
    var total = 0;
    Object.keys(CATS).forEach(function (cat) {
      var items = SHORTCUTS.filter(function (s) { return s.cat === cat && matches(s); });
      if (!items.length) return;
      total += items.length;
      html += '<div class="sc-section" data-cat="' + cat + '">' +
        '<div class="sc-section-head">' +
          '<span class="sc-section-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">' + CATS[cat].icon + '</svg></span>' +
          '<span class="sc-section-label">' + CATS[cat].label + '</span>' +
          '<span class="sc-section-count">' + items.length + '</span>' +
        '</div>' +
        items.map(function (s, i) {
          return '<div class="sc-row" data-id="' + s.id + '" style="animation-delay:' + Math.min(i * 24, 300) + 'ms">' +
            '<span class="sc-row-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">' + s.icon + '</svg></span>' +
            '<span class="sc-row-body"><span class="sc-row-name">' + escHtml(s.name) + '</span><span class="sc-row-desc">' + escHtml(s.desc) + '</span></span>' +
            '<span class="sc-keys">' + s.keys.map(function (k, ki) {
              return (ki > 0 ? '<span class="sc-key-or">or</span>' : '') + k.map(function (part) { return '<span class="sc-kbd">' + escHtml(part) + '</span>'; }).join('');
            }).join('') + '</span>' +
            '</div>';
        }).join('') +
      '</div>';
    });

    if (!total) {
      grid.innerHTML = '<div class="sc-empty"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg><div>Koi shortcut nahi mila — try "chat", "theme" ya "export"</div></div>';
      return;
    }
    grid.innerHTML = html;
  }

  function renderChips() {
    var wrap = $('sc-chips');
    if (!wrap) return;
    var html = '<button class="sc-chip' + (scCat === 'all' ? ' active' : '') + '" data-cat="all">All</button>';
    Object.keys(CATS).forEach(function (c) {
      html += '<button class="sc-chip' + (scCat === c ? ' active' : '') + '" data-cat="' + c + '">' + CATS[c].label + '</button>';
    });
    wrap.innerHTML = html;
  }

  function initShortcutsModal() {
    renderChips();
    renderShortcuts();
    var ov = $('shortcuts-overlay');
    if (!ov) return;

    var pill = ov.querySelector('.smodal-status-pill');
    if (pill) pill.innerHTML = '<span class="smodal-status-dot"></span> ' + SHORTCUTS.length + ' Ready';

    ov.addEventListener('click', function (e) {
      if (e.target === ov || e.target.classList.contains('settings-backdrop')) { closeShortcuts(); return; }
      var row = e.target.closest('.sc-row');
      if (row) {
        var s = SHORTCUTS.find(function (x) { return x.id === row.dataset.id; });
        if (s) { s.action(); }
        return;
      }
      var chip = e.target.closest('.sc-chip');
      if (chip) {
        scCat = chip.dataset.cat;
        document.querySelectorAll('#sc-chips .sc-chip').forEach(function (c) { c.classList.toggle('active', c === chip); });
        renderShortcuts();
      }
    });

    var input = $('sc-search');
    if (input) {
      input.addEventListener('input', function () {
        scQuery = input.value;
        renderShortcuts();
      });
      input.addEventListener('keydown', function (e) {
        if (e.key === 'Escape') { closeShortcuts(); e.preventDefault(); }
      });
    }

    // Buttons in the HTML titlebar
    var closeBtn = ov.querySelector('.smodal-dot-close');
    if (closeBtn) closeBtn.addEventListener('click', function () { closeShortcuts(); });
  }

  function setScWindowSize(mode) {
    var m = document.querySelector('#shortcuts-overlay .settings-modal');
    if (!m) return;
    m.classList.remove('minimized', 'maximized');
    if (mode === 'min') m.classList.add('minimized');
    else if (mode === 'max') m.classList.add('maximized');
  }

  /* ════════════════════════════════════════════════════════════
     4. CHAT HISTORY (Claude-inspired)
  ════════════════════════════════════════════════════════════ */
  var CONV_GAP = 45 * 60 * 1000;
  var chOpen = false;
  var chQuery = '';
  var chSelected = null;   // { id, messages, legacy }
  var chConvs = [];        // cached list

  function readMetaMap() {
    try { return JSON.parse(localStorage.getItem('skylark_jarvis_convs') || '{}'); }
    catch (e) { return {}; }
  }

  function groupConversations(all) {
    var byConv = {};
    var legacy = [];
    (all || []).forEach(function (m) {
      if (m.conv) {
        if (!byConv[m.conv]) byConv[m.conv] = [];
        byConv[m.conv].push(m);
      } else {
        legacy.push(m);
      }
    });

    var groups = [];
    Object.keys(byConv).forEach(function (id) {
      var msgs = byConv[id].sort(function (a, b) { return a.timestamp - b.timestamp; });
      groups.push({ id: id, messages: msgs, legacy: false });
    });

    // Legacy grouping by time gap
    var cur = null;
    legacy.sort(function (a, b) { return a.timestamp - b.timestamp; }).forEach(function (m) {
      if (!cur || m.timestamp - cur.last > CONV_GAP) {
        cur = { messages: [m], last: m.timestamp };
        groups.push({ id: 'legacy_' + m.timestamp, messages: cur.messages, legacy: true });
      } else {
        cur.messages.push(m);
        cur.last = m.timestamp;
      }
    });

    groups.sort(function (a, b) {
      var ta = a.messages[a.messages.length - 1].timestamp;
      var tb = b.messages[b.messages.length - 1].timestamp;
      return tb - ta;
    });
    return groups;
  }

  function convTitle(conv, metaMap) {
    var meta = metaMap[conv.id];
    if (meta && meta.title) return meta.title;
    var first = conv.messages.find(function (m) { return m.role === 'user'; });
    return (first && first.text) ? first.text.replace(/\s+/g, ' ').trim().slice(0, 64) : 'New chat';
  }
  function convPreview(conv) {
    var last = conv.messages[conv.messages.length - 1];
    var t = last ? last.text : '';
    return (last && last.role === 'user' ? 'You: ' : 'Clavis: ') + t.replace(/\s+/g, ' ').trim().slice(0, 90);
  }
  function timeAgo(ts) {
    var s = Math.floor((Date.now() - ts) / 1000);
    if (s < 60) return 'abhi';
    if (s < 3600) return Math.floor(s / 60) + ' min';
    if (s < 86400) return Math.floor(s / 3600) + ' hr';
    if (s < 604800) return Math.floor(s / 86400) + ' d';
    var d = new Date(ts);
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  }
  function dayLabel(ts) {
    var today = new Date(); today.setHours(0, 0, 0, 0);
    var day = new Date(ts); day.setHours(0, 0, 0, 0);
    var diff = Math.round((today - day) / 86400000);
    if (diff <= 0) return 'Today';
    if (diff === 1) return 'Yesterday';
    if (diff < 7) return 'Previous 7 Days';
    if (diff < 30) return 'Previous 30 Days';
    return 'Older';
  }

  function openHistory() {
    var ov = $('history-overlay');
    if (!ov) return;
    if (scOpen) closeShortcuts();
    ov.classList.remove('closing');
    ov.classList.add('open');
    chOpen = true;
    var input = $('ch-search');
    if (input) { input.value = chQuery; }
    refreshHistory();
  }

  function closeHistory() {
    var ov = $('history-overlay');
    if (!ov || !chOpen) return;
    ov.classList.add('closing');
    ov.classList.remove('open');
    chOpen = false;
    setTimeout(function () { ov.classList.remove('closing'); }, 180);
  }

  async function refreshHistory() {
    var ov = $('history-overlay');
    if (!ov) return;
    disarmDelete();
    if (window.MemoryEngine && window.MemoryEngine.getAllJarvisMessages) {
      try {
        var all = await window.MemoryEngine.getAllJarvisMessages();
        chConvs = groupConversations(all);
      } catch (e) { chConvs = []; }
    } else { chConvs = []; }

    var metaMap = readMetaMap();
    var q = chQuery.toLowerCase().trim();

    // If selected conversation vanished, clear selection
    if (chSelected && !chConvs.some(function (c) { return c.id === chSelected.id; })) chSelected = null;

    renderHistoryList(metaMap, q);
    renderHistoryDetail();
    var count = $('history-count');
    if (count) count.textContent = chConvs.length + ' chats';
  }

  function renderHistoryList(metaMap, q) {
    var list = $('ch-convs');
    if (!list) return;
    if (!chConvs.length) {
      list.innerHTML = '<div class="ch-empty-state"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/></svg><div>Abhi koi chat history nahi hai.<br>Clavis se baat karein — sab chats yahan save hongi.</div></div>';
      return;
    }

    var filtered = chConvs.filter(function (c) {
      if (!q) return true;
      return (convTitle(c, metaMap) + ' ' + convPreview(c)).toLowerCase().indexOf(q) !== -1;
    });

    var buckets = { 'Today': [], 'Yesterday': [], 'Previous 7 Days': [], 'Previous 30 Days': [], 'Older': [] };
    filtered.forEach(function (c) {
      var last = c.messages[c.messages.length - 1].timestamp;
      buckets[dayLabel(last)].push(c);
    });

    var html = '';
    Object.keys(buckets).forEach(function (label) {
      if (!buckets[label].length) return;
      html += '<div class="ch-group-label">' + label + '</div>';
      buckets[label].forEach(function (c, i) {
        var meta = metaMap[c.id];
        var title = convTitle(c, metaMap);
        var count = meta && meta.count ? meta.count : c.messages.length;
        html += '<div class="ch-item' + (chSelected && chSelected.id === c.id ? ' active' : '') + '" data-conv="' + escHtml(c.id) + '" style="animation-delay:' + Math.min(i * 30, 360) + 'ms">' +
          '<div class="ch-item-avatar">' + escHtml(title.charAt(0).toUpperCase()) + '</div>' +
          '<div class="ch-item-body">' +
            '<div class="ch-item-title">' + escHtml(title) + '</div>' +
            '<div class="ch-item-preview">' + escHtml(convPreview(c)) + '</div>' +
            '<div class="ch-item-meta"><span class="ch-item-time">' + timeAgo(c.messages[c.messages.length - 1].timestamp) + '</span><span class="ch-item-dot">·</span><span class="ch-item-count">' + count + '</span></div>' +
          '</div>' +
          '<button class="ch-del-btn" data-del="' + escHtml(c.id) + '" title="Delete chat">' +
            '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/></svg>' +
          '</button>' +
        '</div>';
      });
    });

    if (!filtered.length) {
      html = '<div class="ch-empty-state"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg><div>Koi matching chat nahi mili.</div></div>';
    }
    list.innerHTML = html;
  }

  function renderHistoryDetail() {
    var pane = $('ch-detail');
    if (!pane) return;
    if (!chSelected) {
      pane.innerHTML = '<div class="ch-detail-empty">' +
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></svg>' +
        '<div>Left side se koi chat select karein</div></div>';
      return;
    }
    var conv = chSelected;
    var metaMap = readMetaMap();
    var msgs = conv.messages.slice(-30);
    var html = '';
    msgs.forEach(function (m, i) {
      var role = m.role === 'user' ? 'user' : 'ai';
      html += '<div class="ch-msg ' + role + '" style="animation-delay:' + Math.min(i * 26, 400) + 'ms">' +
        '<div class="ch-msg-avatar">' + (m.role === 'user' ? 'U' : 'J') + '</div>' +
        '<div><div class="ch-msg-bubble">' + escHtml(m.text || '') + '</div>' +
        '<div class="ch-msg-time">' + new Date(m.timestamp).toLocaleString(undefined, { hour: '2-digit', minute: '2-digit' }) + '</div></div>' +
        '</div>';
    });
    pane.innerHTML = html;
  }

  async function selectConversation(id) {
    var conv = chConvs.find(function (c) { return c.id === id; });
    if (!conv) return;
    chSelected = conv;
    renderHistoryList(readMetaMap(), chQuery.toLowerCase().trim());
    renderHistoryDetail();
  }

  var chArmedId = null;
  var chArmTimer = null;
  function disarmDelete() {
    chArmedId = null;
    if (chArmTimer) { clearTimeout(chArmTimer); chArmTimer = null; }
    document.querySelectorAll('#history-overlay [data-del].armed').forEach(function (b) {
      b.classList.remove('armed');
      b.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/></svg>';
    });
    document.querySelectorAll('#history-overlay .ch-item.ch-del-armed').forEach(function (i) { i.classList.remove('ch-del-armed'); });
    var topBtn = document.getElementById('ch-del-conv-btn');
    if (topBtn) {
      topBtn.classList.remove('armed');
      topBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/></svg>Delete';
    }
  }
  function armDelete(id, btn) {
    disarmDelete();
    chArmedId = id;
    if (btn) {
      btn.classList.add('armed');
      btn.innerHTML = 'Confirm?';
      var item = btn.closest('.ch-item');
      if (item) item.classList.add('ch-del-armed');
    }
    chArmTimer = setTimeout(disarmDelete, 4000);
  }
  function handleDeleteRequest(id, btn) {
    if (chArmedId === id) { disarmDelete(); deleteConversation(id); }
    else armDelete(id, btn);
  }

  async function deleteConversation(id) {
    var conv = chConvs.find(function (c) { return c.id === id; });
    if (!conv) return;
    try {
      if (conv.legacy) {
        var ids = conv.messages.map(function (m) { return m.id; });
        if (window.MemoryEngine) await window.MemoryEngine.deleteJarvisMessages(ids);
      } else if (window.JarvisEngine && window.JarvisEngine.clearConversation) {
        await window.JarvisEngine.clearConversation(id);
      }
      if (chSelected && chSelected.id === id) chSelected = null;
      toast('success', '🗑️ Chat Deleted', 'Conversation permanently removed.');
      await refreshHistory();
    } catch (e) {
      console.error('Delete conversation error:', e);
      toast('error', 'Delete Failed', e.message || 'Kuch galat ho gaya.');
    }
  }

  async function openConversation(id) {
    var conv = chConvs.find(function (c) { return c.id === id; });
    if (!conv) return;
    try {
      var msgs = conv.messages;
      var convId = conv.id;
      if (conv.legacy && window.JarvisEngine && window.JarvisEngine.backfillConversation) {
        convId = await window.JarvisEngine.backfillConversation(msgs);
      }
      if (window.JarvisEngine && window.JarvisEngine.loadConversation) {
        await window.JarvisEngine.loadConversation(convId);
      }
      window.__jarvisRenderedAt = Date.now();
      closeHistory();
      safeShowView('jarvis');
      if (typeof window.renderJarvisConversation === 'function') {
        window.renderJarvisConversation(msgs);
      } else if (typeof window.renderJarvisHistory === 'function') {
        window.renderJarvisHistory(msgs);
      }
      toast('success', '💬 Chat Opened', 'Purani conversation load ho gayi.');
    } catch (e) {
      console.error('Open conversation error:', e);
      toast('error', 'Open Failed', e.message || 'Chat load nahi hui.');
    }
  }

  async function newChat() {
    closeHistory();
    window.__jarvisRenderedAt = Date.now();
    safeShowView('jarvis');
    if (window.JarvisEngine && window.JarvisEngine.startNewConversation) {
      try { await window.JarvisEngine.startNewConversation(); } catch (e) {}
    }
    var container = $('jarvis-messages');
    if (container) container.innerHTML = '';
    var welcome = $('jarvis-welcome');
    if (welcome) welcome.style.display = 'flex';
    if (typeof window.setJarvisStatus === 'function') window.setJarvisStatus('online', 'Clavis Online');
    toast('success', '✨ New Chat', 'Nayi conversation shuru ho gayi.');
  }

  function initHistoryModal() {
    var ov = $('history-overlay');
    if (!ov) return;

    ov.addEventListener('click', function (e) {
      if (e.target === ov || e.target.classList.contains('settings-backdrop')) { disarmDelete(); closeHistory(); return; }

      var delBtn = e.target.closest('[data-del]');
      if (delBtn) { e.stopPropagation(); handleDeleteRequest(delBtn.dataset.del, delBtn); return; }

      var item = e.target.closest('.ch-item');
      if (item) { disarmDelete(); selectConversation(item.dataset.conv); return; }

      if (e.target.closest('#ch-new-btn')) { disarmDelete(); newChat(); return; }
      if (e.target.closest('#ch-open-btn')) { if (chSelected) { disarmDelete(); openConversation(chSelected.id); } return; }
      if (e.target.closest('#ch-del-conv-btn')) { if (chSelected) handleDeleteRequest(chSelected.id, document.getElementById('ch-del-conv-btn')); return; }
    });

    var input = $('ch-search');
    if (input) {
      input.addEventListener('input', function () {
        chQuery = input.value;
        refreshHistory();
      });
      input.addEventListener('keydown', function (e) {
        if (e.key === 'Escape') { closeHistory(); e.preventDefault(); }
      });
    }

    var closeBtn = ov.querySelector('.smodal-dot-close');
    if (closeBtn) closeBtn.addEventListener('click', function () { closeHistory(); });
  }

  function setHistoryWindowSize(mode) {
    var m = document.querySelector('#history-overlay .settings-modal');
    if (!m) return;
    m.classList.remove('minimized', 'maximized');
    if (mode === 'min') m.classList.add('minimized');
    else if (mode === 'max') m.classList.add('maximized');
  }

  /* ════════════════════════════════════════════════════════════
     5. GLOBAL KEYBOARD SHORTCUTS
  ════════════════════════════════════════════════════════════ */
  var NUM_VIEWS = { 
    '1': 'dashboard', 
    '2': 'leads', 
    '3': 'chat', 
    '4': 'email', 
    '5': 'whatsapp', 
    '6': 'agent',
    '7': 'analytics',
    '8': 'accounts',
    '9': 'excel'
  };

  function initGlobalKeys() {
    document.addEventListener('keydown', function (e) {
      var mod = e.ctrlKey || e.metaKey;
      var shift = e.shiftKey;

      if (e.key === 'Escape') {
        if (scOpen) { closeShortcuts(); e.preventDefault(); return; }
        if (chOpen) { closeHistory(); e.preventDefault(); return; }
      }
      if (!mod) return;

      var k = (e.key || '').toLowerCase();

      if (!shift && k === 'k') { e.preventDefault(); toggleShortcuts(); return; }
      if (!shift && k === 'n') { e.preventDefault(); newChat(); return; }
      if (!shift && k === ',') { e.preventDefault(); openSettings(); return; }
      if (shift && k === 'h') { e.preventDefault(); openHistory(); return; }
      if (shift && k === 'd') { e.preventDefault(); closeOverlays(); toggleTheme(); return; }
      if (shift && k === 'v') { e.preventDefault(); closeOverlays(); if (typeof window.startJarvisVoiceInput === 'function') window.startJarvisVoiceInput(); return; }
      if (shift && k === 'x') { e.preventDefault(); closeOverlays(); if (typeof window.stopJarvisGeneration === 'function') window.stopJarvisGeneration(); return; }
      if (shift && k === 'f') { e.preventDefault(); closeOverlays(); runNav('excel'); return; }

      if (!shift && k >= '0' && k <= '9') {
        var v = NUM_VIEWS[k];
        if (v) { e.preventDefault(); closeOverlays(); safeShowView(v); }
      }
    });
  }

  /* ════════════════════════════════════════════════════════════
     6. INIT
  ════════════════════════════════════════════════════════════ */
  function initTopbarGlow() {
    var btn = document.querySelector('.tb-shortcuts-btn');
    if (!btn) return;
    btn.addEventListener('mousemove', function (e) {
      var r = btn.getBoundingClientRect();
      btn.style.setProperty('--tb-gx', ((e.clientX - r.left) / r.width * 100) + '%');
      btn.style.setProperty('--tb-gy', ((e.clientY - r.top) / r.height * 100) + '%');
    });
  }

  function init() {
    initShortcutsModal();
    initHistoryModal();
    initGlobalKeys();
    initTopbarGlow();
    console.info('[ShortcutsHub] ⌘K shortcuts + chat history initialized');
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();

  // Public API
  window.Shortcuts = {
    open: openShortcuts,
    close: closeShortcuts,
    toggle: toggleShortcuts,
    minimize: function () { setScWindowSize('min'); },
    expand: function () { setScWindowSize('max'); }
  };
  window.ChatHistory = {
    open: openHistory,
    close: closeHistory,
    newChat: newChat,
    refresh: refreshHistory,
    minimize: function () { setHistoryWindowSize('min'); },
    expand: function () { setHistoryWindowSize('max'); }
  };
})();
