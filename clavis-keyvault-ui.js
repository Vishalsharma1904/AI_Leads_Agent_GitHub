/* ============================================================
 * clavis-keyvault-ui.js  ·  The two-click key experience
 * ------------------------------------------------------------
 * One panel, one job: know whether Clavis can think right now, and
 * fix it in two clicks if it cannot.
 *
 *   Open console  →  paste  →  verified & live.
 *
 * The panel never displays a secret. It shows a mask, a state, and the
 * shortest path to a working key. When a provider runs dry mid-task the
 * AI layer raises clavis:refuel-needed and this file puts the refuel
 * step directly in front of the user instead of an error card.
 *
 * Visual language matches the floating window: ink on paper, hairline
 * borders, no decorative colour.
 * ============================================================ */
(function (global) {
  'use strict';

  if (global.ClavisKeyVaultUI) return;
  var doc = global.document;
  var Vault = function () { return global.ClavisKeyVault; };

  var panel = null, backdrop = null, refuelCard = null, lastFocus = null;

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function icon(name) {
    var paths = {
      key:   '<path d="M15.5 7.5a4.5 4.5 0 1 0-4.24 4.49L10 13.25V15H8v2H6v2H3v-2.5l6.51-6.51"/><circle cx="16.5" cy="7.5" r=".9" fill="currentColor" stroke="none"/>',
      out:   '<path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><path d="M15 3h6v6"/><path d="M10 14 21 3"/>',
      check: '<path d="M20 6 9 17l-5-5"/>',
      x:     '<path d="M18 6 6 18M6 6l12 12"/>',
      plus:  '<path d="M12 5v14M5 12h14"/>'
    };
    return '<svg class="kv-i" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
           'stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
           (paths[name] || '') + '</svg>';
  }

  /* ── Panel ────────────────────────────────────────────────── */
  function build() {
    if (panel) return panel;

    backdrop = doc.createElement('div');
    backdrop.className = 'kv-backdrop';
    backdrop.addEventListener('click', close);

    panel = doc.createElement('section');
    panel.className = 'kv-panel';
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-modal', 'true');
    panel.setAttribute('aria-label', 'API key vault');
    panel.innerHTML =
      '<header class="kv-head">' +
      '  <div class="kv-head-text">' +
      '    <h2 class="kv-title">Keys</h2>' +
      '    <p class="kv-sub">Stored encrypted on this device. Clavis falls through them in order.</p>' +
      '  </div>' +
      '  <button type="button" class="kv-close" aria-label="Close">' + icon('x') + '</button>' +
      '</header>' +
      '<div class="kv-list"></div>' +
      '<footer class="kv-foot"><span class="kv-foot-note"></span></footer>';

    panel.querySelector('.kv-close').addEventListener('click', close);
    doc.body.appendChild(backdrop);
    doc.body.appendChild(panel);

    panel.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') { e.stopPropagation(); close(); }
    });

    if (Vault()) Vault().onChange(render);
    return panel;
  }

  function stateLabel(p) {
    if (p.state === 'empty') return 'Not connected';
    if (p.state === 'spent') return 'Out of quota';
    return p.healthy > 1 ? p.healthy + ' keys live' : 'Live';
  }

  function row(id, p, order) {
    var open = p.state !== 'live';
    return '' +
      '<article class="kv-row" data-provider="' + esc(id) + '" data-state="' + esc(p.state) + '">' +
      '  <div class="kv-row-head">' +
      '    <span class="kv-order">' + (order + 1) + '</span>' +
      '    <div class="kv-row-id">' +
      '      <span class="kv-name">' + esc(p.label) + '</span>' +
      '      <span class="kv-note">' + esc(p.note) + '</span>' +
      '    </div>' +
      '    <span class="kv-state">' + esc(stateLabel(p)) + '</span>' +
      '  </div>' +
      (p.masks.length
        ? '  <div class="kv-keys">' + p.masks.map(function (m, i) {
            var h = p.health[i] || 'unknown';
            return '<span class="kv-chip" data-health="' + esc(h) + '">' +
                   '<code>' + esc(m) + '</code>' +
                   '<button type="button" class="kv-chip-x" data-remove="' + i + '" aria-label="Remove this key">' + icon('x') + '</button>' +
                   '</span>';
          }).join('') + '</div>'
        : '') +
      '  <div class="kv-add' + (open ? ' is-open' : '') + '">' +
      '    <a class="kv-get" href="' + esc(p.console) + '" target="_blank" rel="noopener noreferrer">' +
      '      Get a key ' + icon('out') + '</a>' +
      '    <div class="kv-paste">' +
      '      <input type="password" class="kv-input" spellcheck="false" autocomplete="off"' +
      '             placeholder="Paste key here" aria-label="Paste ' + esc(p.label) + ' key">' +
      '      <button type="button" class="kv-save" data-save="' + esc(id) + '">Save</button>' +
      '    </div>' +
      '    <p class="kv-msg" role="status"></p>' +
      '  </div>' +
      (p.state === 'live'
        ? '  <button type="button" class="kv-more" data-more="' + esc(id) + '">' + icon('plus') + ' Add another key</button>'
        : '') +
      '</article>';
  }

  function render(snap) {
    if (!panel) return;
    snap = snap || (Vault() && Vault().status());
    if (!snap) return;

    var list = panel.querySelector('.kv-list');
    var order = snap.chain.filter(function (p) { return snap.providers[p]; });
    list.innerHTML = order.map(function (id, i) { return row(id, snap.providers[id], i); }).join('');

    var note = panel.querySelector('.kv-foot-note');
    if (!snap.anyKey) note.textContent = 'No key yet. Groq takes about a minute and is free.';
    else if (snap.allSpent) note.textContent = 'Every key is out of quota. Add one above, or wait for the daily reset.';
    else note.textContent = 'Clavis tries these top to bottom. If one runs dry it moves to the next on its own.';

    wire(list);
  }

  function wire(list) {
    list.addEventListener('click', function (e) {
      var more = e.target.closest('[data-more]');
      if (more) {
        var box = more.closest('.kv-row').querySelector('.kv-add');
        box.classList.toggle('is-open');
        if (box.classList.contains('is-open')) box.querySelector('.kv-input').focus();
        return;
      }
      var rm = e.target.closest('[data-remove]');
      if (rm) {
        var prov = rm.closest('.kv-row').dataset.provider;
        Vault().remove(prov, parseInt(rm.dataset.remove, 10));
        return;
      }
      var save = e.target.closest('[data-save]');
      if (save) { commit(save.dataset.save, save.closest('.kv-add')); }
    });

    list.addEventListener('keydown', function (e) {
      if (e.key !== 'Enter') return;
      var input = e.target.closest('.kv-input');
      if (!input) return;
      e.preventDefault();
      var box = input.closest('.kv-add');
      commit(box.closest('.kv-row').dataset.provider, box);
    });
  }

  function commit(provider, box) {
    var input = box.querySelector('.kv-input');
    var btn = box.querySelector('.kv-save');
    var msg = box.querySelector('.kv-msg');
    var key = (input.value || '').trim();
    if (!key) { input.focus(); return; }

    btn.disabled = true;
    btn.textContent = 'Checking';
    msg.textContent = '';
    msg.dataset.tone = '';

    Vault().add(provider, key).then(function (res) {
      input.value = '';
      msg.dataset.tone = 'ok';
      msg.textContent = res.warn
        ? 'Saved as ' + res.mask + '. Could not reach the provider to confirm, but it should work.'
        : 'Saved as ' + res.mask + ' and verified.' + (res.synced ? ' Synced to your account.' : '');
      dismissRefuel();
    }).catch(function (err) {
      msg.dataset.tone = 'bad';
      msg.textContent = err.message || 'That key did not work.';
    }).then(function () {
      btn.disabled = false;
      btn.textContent = 'Save';
    });
  }

  /* ── Open / close ─────────────────────────────────────────── */
  function open(focusProvider) {
    build();
    lastFocus = doc.activeElement;
    render();
    backdrop.classList.add('is-open');
    panel.classList.add('is-open');
    requestAnimationFrame(function () {
      var target = focusProvider
        ? panel.querySelector('.kv-row[data-provider="' + focusProvider + '"] .kv-input')
        : panel.querySelector('.kv-row[data-state="empty"] .kv-input, .kv-row[data-state="spent"] .kv-input');
      (target || panel.querySelector('.kv-close')).focus();
    });
  }

  function close() {
    if (!panel) return;
    backdrop.classList.remove('is-open');
    panel.classList.remove('is-open');
    try { lastFocus && lastFocus.focus(); } catch (_) {}
  }

  /* ── Refuel prompt ────────────────────────────────────────
     Raised only when a provider is genuinely dry. It says which one,
     and its primary action goes straight to that provider's console. */
  function refuel(detail) {
    dismissRefuel();
    refuelCard = doc.createElement('div');
    refuelCard.className = 'kv-refuel';
    refuelCard.setAttribute('role', 'status');
    refuelCard.innerHTML =
      '<div class="kv-refuel-body">' +
      '  <span class="kv-refuel-title">' + esc(detail.label) + ' is out of quota</span>' +
      '  <span class="kv-refuel-sub">' +
      (detail.anyLive ? 'Clavis switched to your next key and carried on.' : 'Add a key to keep going — it takes about a minute.') +
      '  </span>' +
      '</div>' +
      '<div class="kv-refuel-acts">' +
      '  <button type="button" class="kv-refuel-act is-primary" data-fix>Refuel</button>' +
      '  <button type="button" class="kv-refuel-act" data-later aria-label="Dismiss">' + icon('x') + '</button>' +
      '</div>';

    refuelCard.querySelector('[data-fix]').addEventListener('click', function () {
      try { global.open(detail.console, '_blank', 'noopener'); } catch (_) {}
      open(detail.provider);
      dismissRefuel();
    });
    refuelCard.querySelector('[data-later]').addEventListener('click', dismissRefuel);

    doc.body.appendChild(refuelCard);
    requestAnimationFrame(function () { refuelCard.classList.add('is-in'); });

    // A quiet notice should not outstay its welcome.
    clearTimeout(refuel._t);
    refuel._t = setTimeout(dismissRefuel, detail.anyLive ? 7000 : 18000);
  }

  function dismissRefuel() {
    if (!refuelCard) return;
    var node = refuelCard;
    refuelCard = null;
    node.classList.remove('is-in');
    setTimeout(function () { try { node.remove(); } catch (_) {} }, 260);
  }

  global.addEventListener('clavis:refuel-needed', function (e) { refuel(e.detail || {}); });

  /* Keyboard: Ctrl/⌘ + Shift + K */
  global.addEventListener('keydown', function (e) {
    if ((e.metaKey || e.ctrlKey) && e.shiftKey && (e.key === 'K' || e.key === 'k')) {
      e.preventDefault();
      panel && panel.classList.contains('is-open') ? close() : open();
    }
  });

  global.ClavisKeyVaultUI = { open: open, close: close, refuel: refuel };
  // Convenience: ClavisKeyVault.open() reads better from the console.
  if (global.ClavisKeyVault) global.ClavisKeyVault.open = open;
})(window);
