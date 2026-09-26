/**
 * clavis-manual.js · Voice Command Guide + Notification expand/collapse
 *
 * 1. Wires expand/collapse tap-to-open on each desktop notification card.
 * 2. Injects a Voice Commands Guide banner into the Shortcuts window.
 */
(function () {
  'use strict';

  /* ══════════════════════════════════════════════════════════════
     1. NOTIFICATION EXPAND / COLLAPSE
  ══════════════════════════════════════════════════════════════ */
  function wireCard(card) {
    if (card._cmWired) return;
    card._cmWired = true;

    // Inject an "expand hint" line below the body if there are actions or detail
    var body   = card.querySelector('.desktop-notif-body');
    var detail = card.querySelector('.desktop-notif-detail');
    var acts   = card.querySelector('.desktop-notif-actions');

    // Only show hint if there's something hidden (actions or long body)
    if (body || acts) {
      var hint = document.createElement('span');
      hint.className = 'desktop-notif-expand-hint';
      hint.textContent = acts ? 'Tap to expand options' : 'Tap to read more';
      var insertAfter = detail || body;
      if (insertAfter) insertAfter.after(hint);
    }

    card.addEventListener('click', function (e) {
      // Ignore close-button and action-button clicks
      if (e.target.closest('.desktop-notif-close-btn') ||
          e.target.closest('.desktop-notif-btn')) return;
      card.classList.toggle('is-expanded');
    });
  }

  function observeNotifications() {
    // Wire existing cards
    document.querySelectorAll('.desktop-notification-card').forEach(wireCard);

    // Watch for new cards
    var obs = new MutationObserver(function (mutations) {
      mutations.forEach(function (m) {
        m.addedNodes.forEach(function (n) {
          if (n.nodeType !== 1) return;
          if (n.classList && n.classList.contains('desktop-notification-card')) wireCard(n);
          // In case a container was just added
          n.querySelectorAll && n.querySelectorAll('.desktop-notification-card').forEach(wireCard);
        });
      });
    });
    obs.observe(document.body, { childList: true, subtree: true });
  }

  /* ══════════════════════════════════════════════════════════════
     2. VOICE COMMAND MANUAL — inject into Shortcuts window
  ══════════════════════════════════════════════════════════════ */

  var VOICE_CMDS = [
    /* Wake */
    { group: 'Wake',
      items: [
        { phrase: '"Clavis" ya "Hey Buddy"',  desc: 'Clavis ko jagao — har kaam se pehle yahi bolo' },
        { phrase: '"Thodi der chup ho jao"',   desc: 'Clavis so jayega, agle wake tak chup rahega' },
        { phrase: '"Suno" ya orb tap',         desc: 'Chup Clavis ko wapas jagao' }
      ]
    },
    /* Navigation */
    { group: 'Navigation',
      items: [
        { phrase: '"Dashboard dikhao"',        desc: 'Dashboard pe jao' },
        { phrase: '"Leads pe jao"',            desc: 'Leads Database kholo' },
        { phrase: '"Chat AI" / "Jarvis"',      desc: 'Clavis AI Studio mein jao' },
        { phrase: '"Settings kholo"',          desc: 'System Settings window kholo' },
        { phrase: '"Map kholo"',               desc: 'Maps panel open karo' }
      ]
    },
    /* Map */
    { group: 'Map & Routes',
      items: [
        { phrase: '"[A] se [B] route batao"',  desc: 'Driving route + distance dikhao' },
        { phrase: '"Metro kaise jau [A] se [B]"', desc: 'DMRC metro fare + interchange' },
        { phrase: '"Map band karo"',            desc: 'Map panel close karo' }
      ]
    },
    /* Leads */
    { group: 'Lead Generation',
      items: [
        { phrase: '"[City] mein hotels ki leads nikalo"', desc: 'Leads search karo — city aur type bolo' },
        { phrase: '"Leads download karo"',      desc: 'Excel mein export karo' },
        { phrase: '"Map pe dikhao"',            desc: 'Leads ko map pins mein dekho' }
      ]
    },
    /* Window */
    { group: 'Window Control',
      items: [
        { phrase: '"Band karo" / "Close karo"', desc: 'Open window ya panel band karo' },
        { phrase: '"Settings band karo"',       desc: 'Settings modal close karo' },
        { phrase: '"Sab band karo"',            desc: 'Clavis ka screen clear karo' }
      ]
    }
  ];

  function buildManualHTML() {
    var rows = '';
    VOICE_CMDS.forEach(function (grp) {
      rows += '<div class="cvm-group">';
      rows += '<div class="cvm-group-label">' + grp.group + '</div>';
      grp.items.forEach(function (item) {
        rows += '<div class="cvm-row">' +
          '<span class="cvm-phrase">' + item.phrase + '</span>' +
          '<span class="cvm-desc">'   + item.desc   + '</span>' +
          '</div>';
      });
      rows += '</div>';
    });

    return '<div class="sc-manual-wrap">' +
      '<div class="sc-manual-banner">' +
        '<p class="sc-manual-quote">Bass apni awaaz se control karo &mdash; bolo aur Clavis sun lega</p>' +
        '<span class="sc-manual-sub">Tap any command row to speak it · &ldquo;Clavis&rdquo; se pehle wake karo</span>' +
      '</div>' +
      '<div class="cvm-table">' + rows + '</div>' +
    '</div>';
  }

  var _manualPanel = null;

  function injectManual() {
    var grid = document.getElementById('sc-grid');
    if (!grid) return;

    // Remove stale panel if grid was re-rendered
    if (_manualPanel && _manualPanel.parentNode !== grid) _manualPanel = null;

    if (!_manualPanel) {
      var wrap = document.createElement('div');
      wrap.className = 'sc-manual-section';
      wrap.innerHTML = buildManualHTML();
      _manualPanel = wrap;

      // Click-to-speak: speak the phrase via Clavis if possible
      wrap.addEventListener('click', function (e) {
        var row = e.target.closest('.cvm-row');
        if (!row) return;
        var phrase = row.querySelector('.cvm-phrase');
        if (!phrase) return;
        var text = phrase.textContent
          .replace(/^["'"']|["'"']$/g, '')  // strip quotes
          .replace(/\[.*?\]/g, 'Gurugram');                      // fill placeholder
        if (window.speechSynthesis) {
          var utt = new SpeechSynthesisUtterance(text);
          utt.lang = 'hi-IN';
          utt.volume = 0.7;
          speechSynthesis.cancel();
          speechSynthesis.speak(utt);
        }
      });
    }

    // Prepend if not already there
    if (grid.firstChild !== _manualPanel) {
      grid.insertBefore(_manualPanel, grid.firstChild);
    }
  }

  function watchShortcutsGrid() {
    var grid = document.getElementById('sc-grid');
    if (!grid) return;

    // Inject once now
    injectManual();

    // Re-inject after renderShortcuts fires (it replaces innerHTML)
    var obs = new MutationObserver(function () {
      injectManual();
    });
    obs.observe(grid, { childList: true });
  }

  function watchShortcutsOverlay() {
    var overlay = document.getElementById('shortcuts-overlay');
    if (!overlay) return;

    // Watch for overlay becoming visible (open class added)
    var obs = new MutationObserver(function () {
      if (overlay.classList.contains('open') || overlay.style.display !== 'none') {
        watchShortcutsGrid();
      }
    });
    obs.observe(overlay, { attributes: true, attributeFilter: ['class', 'style'] });
  }

  /* ── Init ────────────────────────────────────────────────── */
  function init() {
    observeNotifications();
    watchShortcutsOverlay();
    // Also try immediately in case overlay is already open
    watchShortcutsGrid();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
