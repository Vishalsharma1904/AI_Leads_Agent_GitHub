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
    var expandable = Boolean(card.querySelector('.desktop-notif-detail, .desktop-notif-actions')) || (card.querySelector('.desktop-notif-body')?.textContent.length || 0) > 110;
    if (!expandable) return;
    card.classList.add('has-more');
    var title = card.querySelector('.desktop-notif-title');
    if (!title) return;
    var trigger = document.createElement('button');
    trigger.type = 'button'; trigger.className = 'desktop-notif-expand';
    trigger.textContent = title.textContent; trigger.setAttribute('aria-expanded', 'false');
    title.replaceWith(trigger);
    function toggle(force) {
      var expanded = force === undefined ? !card.classList.contains('is-expanded') : force;
      card.classList.toggle('is-expanded', expanded); trigger.setAttribute('aria-expanded', String(expanded));
      pile(card.parentElement);
    }
    card.addEventListener('click', function (e) {
      if (e.target.closest('.desktop-notif-close-btn') || e.target.closest('.desktop-notif-btn') || e.target.closest('a')) return;
      toggle();
    });
    card.addEventListener('keydown', function (e) { if (e.key === 'Escape' && card.classList.contains('is-expanded')) { e.preventDefault(); toggle(false); trigger.focus(); } });
  }

  /* The pile: each card tucks under the one above it so exactly 8 px of it
     peeks out, whatever its height (a fixed -52 px overlap showed half a
     tall card, or a dark smear under a short one). */
  function pile(box) {
    if (!box) return;
    var cards = Array.prototype.filter.call(box.children, function (c) {
      return c.classList && c.classList.contains('desktop-notification-card') && !c.classList.contains('desktop-notif-exit');
    });
    cards.forEach(function (c, i) {
      var next = cards[i + 1];
      var v = next ? (-(next.offsetHeight - 8)) + 'px' : '0px';
      if (c.style.getPropertyValue('--pile-mb') !== v) c.style.setProperty('--pile-mb', v);
    });
  }

  function observeNotifications() {
    document.querySelectorAll('.desktop-notification-card').forEach(wireCard);
    var queued = new Set();
    var obs = new MutationObserver(function (mutations) {
      mutations.forEach(function (m) {
        if (m.target && m.target.classList && m.target.classList.contains('desktop-notification-container')) queued.add(m.target);
        m.addedNodes.forEach(function (n) {
          if (n.nodeType !== 1) return;
          if (n.classList && n.classList.contains('desktop-notification-card')) { wireCard(n); if (n.parentElement) queued.add(n.parentElement); }
          if (n.querySelectorAll) n.querySelectorAll('.desktop-notification-card').forEach(function (c) { wireCard(c); queued.add(c.parentElement); });
        });
      });
      if (queued.size) requestAnimationFrame(function () { queued.forEach(pile); queued.clear(); });
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
        { phrase: '"Rudra" ya "Hey Buddy"',  desc: 'Rudra24 AI ko jagao — har kaam se pehle yahi bolo' },
        { phrase: '"Thodi der chup ho jao"',   desc: 'Rudra24 AI so jayega, agle wake tak chup rahega' },
        { phrase: '"Suno" ya orb tap',         desc: 'Chup Rudra24 AI ko wapas jagao' }
      ]
    },
    /* Navigation */
    { group: 'Navigation',
      items: [
        { phrase: '"Dashboard dikhao"',        desc: 'Dashboard pe jao' },
        { phrase: '"Leads pe jao"',            desc: 'Leads Database kholo' },
        { phrase: '"Chat AI" / "Jarvis"',      desc: 'Rudra24 AI Studio mein jao' },
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
        { phrase: '"Sab band karo"',            desc: 'Rudra24 AI ka screen clear karo' }
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
        '<p class="sc-manual-quote">Bass apni awaaz se control karo &mdash; bolo aur Rudra24 AI sun lega</p>' +
        '<span class="sc-manual-sub">Tap any command row to speak it · &ldquo;Rudra24 AI&rdquo; se pehle wake karo</span>' +
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

      // Click-to-speak: speak the phrase via Rudra24 AI if possible
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
    if (!grid || grid.__cmGuideObserved) return;
    grid.__cmGuideObserved = true;

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

  /* ══════════════════════════════════════════════════════════════
     3. LOCATION — ask once, up front, so "meri location dikhao" is
        instant later (the map reads the cached fix, then refines).
  ══════════════════════════════════════════════════════════════ */
  function askLocationOnce() {
    try {
      if (!navigator.geolocation || localStorage.getItem('clavis_geo_asked')) return;
      var go = function () {
        localStorage.setItem('clavis_geo_asked', '1');
        navigator.geolocation.getCurrentPosition(function (p) {
          try { localStorage.setItem('clavis_last_pos', JSON.stringify({ lat: p.coords.latitude, lng: p.coords.longitude, acc: p.coords.accuracy || 0, at: Date.now() })); } catch (_) {}
        }, function () {}, { enableHighAccuracy: false, timeout: 10000, maximumAge: 300000 });
      };
      if (navigator.permissions && navigator.permissions.query) {
        navigator.permissions.query({ name: 'geolocation' }).then(function (st) {
          if (st.state === 'granted') go();
          else if (st.state === 'prompt') window.addEventListener('pointerdown', go, { once: true });
        }).catch(go);
      } else go();
    } catch (_) {}
  }

  /* Peek suggestions run through the same task route as a typed command. */
  document.addEventListener('click', function (e) {
    var b = e.target.closest && e.target.closest('#clavis-task-surface [data-fill]');
    if (b && window.ClavisTaskSurface) window.ClavisTaskSurface.submitFollowUp(b.getAttribute('data-fill'));
  });

  /* ── Init ────────────────────────────────────────────────── */
  function init() {
    askLocationOnce();
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
