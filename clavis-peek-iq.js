/* ============================================================
 * clavis-peek-iq.js
 * ------------------------------------------------------------
 * Makes the floating Peek Task window think.
 *
 * It attaches from the outside — clavis-task-surface.js is not
 * modified — using the two hooks that file already exports:
 * ClavisTask.subscribe() to know what just happened, and
 * ClavisTaskSurface.submitFollowUp() to act on it.
 *
 * What it adds:
 *   · follow-up chips written for the subject that is actually on
 *     screen. Local ones appear the instant the answer lands; the
 *     model's own set cross-fades over them a second later.
 *   · the answer settling in word by word instead of blinking on.
 *   · the composer's "+" menu, which used to be a fixed list of six
 *     pills, rebuilt from the same reading of the conversation.
 *
 * Failure is always silent and always local: if ClavisIQ is missing
 * or the network is down, the window behaves exactly as it did
 * before this file existed.
 * ============================================================ */
(function (global) {
  'use strict';

  if (global.ClavisPeekIQ) return;

  var doc = global.document;
  var SURFACE_ID = 'clavis-task-surface';

  function IQ() { return global.ClavisIQ; }
  function Surface() { return global.ClavisTaskSurface; }

  function reduced() {
    try { return global.matchMedia('(prefers-reduced-motion: reduce)').matches; }
    catch (e) { return false; }
  }

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  /* ══════════════════════════════════════════════════════════
     Icons — one line each, no dependency
     ══════════════════════════════════════════════════════════ */
  var P = {
    depth:   '<path d="M12 3v18M5 10l7 7 7-7"/>',
    simple:  '<circle cx="12" cy="12" r="9"/><path d="M9.2 9.2a2.8 2.8 0 1 1 3.6 3.6c-.6.3-.8.8-.8 1.4"/><path d="M12 17.2h.01"/>',
    compare: '<path d="M4 6h7M4 12h7M4 18h7"/><path d="M20 6h-4M20 12h-4M20 18h-4"/>',
    example: '<path d="M4 5h16v11H4z"/><path d="M9 20h6M12 16v4"/>',
    apply:   '<path d="m13 2-9 12h7l-1 8 9-12h-7z"/>',
    steps:   '<path d="M4 18h4v-4H4zM10 14h4v-4h-4zM16 10h4V6h-4z"/>',
    risk:    '<path d="M12 3 2 20h20z"/><path d="M12 10v4M12 17h.01"/>',
    chart:   '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
    tool:    '<path d="M14.7 6.3a4 4 0 0 1 5 5L21 13l-8 8-5-5 8-8z"/><path d="m3 21 4-4"/>',
    map:     '<path d="m9 4 6 2 6-2v14l-6 2-6-2-6 2V6z"/><path d="M9 4v14M15 6v14"/>',
    cost:    '<circle cx="12" cy="12" r="9"/><path d="M12 7v10M9.5 9.5h4a2 2 0 0 1 0 4h-4"/>',
    globe:   '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a15 15 0 0 1 0 18a15 15 0 0 1 0-18"/>',
    debug:   '<circle cx="12" cy="12" r="9"/><path d="M12 8v5M12 16h.01"/>',
    code:    '<path d="m8 8-4 4 4 4M16 8l4 4-4 4"/>',
    table:   '<path d="M3 5h18v14H3z"/><path d="M3 10h18M9 10v9"/>',
    list:    '<path d="M8 6h13M8 12h13M8 18h13M3.5 6h.01M3.5 12h.01M3.5 18h.01"/>',
    mail:    '<path d="M3 6h18v12H3z"/><path d="m3 7 9 6 9-6"/>',
    next:    '<path d="M5 12h13M13 6l6 6-6 6"/>',
    link:    '<path d="M10 13a5 5 0 0 0 7 0l2-2a5 5 0 0 0-7-7l-1 1"/><path d="M14 11a5 5 0 0 0-7 0l-2 2a5 5 0 0 0 7 7l1-1"/>',
    plus:    '<path d="M12 5v14M5 12h14"/>',
    contact: '<path d="M4 5h16v14H4z"/><circle cx="10" cy="11" r="2"/><path d="M6.5 17c.6-1.6 2-2.4 3.5-2.4s2.9.8 3.5 2.4M15.5 9.5H18M15.5 13H18"/>',
    download:'<path d="M12 4v10M8 11l4 4 4-4M5 19h14"/>',
    send:    '<path d="M21 3 3 10l7 3 3 7z"/>',
    spark:   '<path d="m12 3-1.9 5.8a2 2 0 0 1-1.3 1.3L3 12l5.8 1.9a2 2 0 0 1 1.3 1.3L12 21l1.9-5.8a2 2 0 0 1 1.3-1.3L21 12l-5.8-1.9a2 2 0 0 1-1.3-1.3z"/>'
  };

  function icon(name) {
    var d = P[name] || P.spark;
    return '<span class="cts-chip-ico" aria-hidden="true">' +
      '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
      'stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' + d + '</svg></span>';
  }

  /* ══════════════════════════════════════════════════════════
     Smart chips
     ══════════════════════════════════════════════════════════ */

  var railEl = null;
  var currentToken = 0;

  function rail() {
    var surface = doc.getElementById(SURFACE_ID);
    if (!surface) return null;
    if (railEl && railEl.isConnected && railEl.parentNode === surface) return railEl;

    railEl = surface.querySelector('.cts-smart');
    if (!railEl) {
      railEl = doc.createElement('div');
      railEl.className = 'cts-smart';
      railEl.hidden = true;
      railEl.innerHTML =
        '<div class="cts-smart-label">' + icon('spark') +
        '<span>Continue</span><i class="cts-smart-spark"></i></div>' +
        '<div class="cts-smart-row"></div>';
      var composer = surface.querySelector('.cts-composer');
      if (composer) surface.insertBefore(railEl, composer);
      else surface.appendChild(railEl);
      wireRail(railEl);
    }
    return railEl;
  }

  function wireRail(node) {
    node.addEventListener('click', function (e) {
      var btn = e.target.closest && e.target.closest('.cts-smart-chip');
      if (!btn) return;
      e.preventDefault();
      e.stopPropagation();

      var prompt = btn.getAttribute('data-prompt') || btn.textContent.trim();
      if (!prompt) return;

      if (IQ()) {
        IQ().learn('chip', { move: btn.getAttribute('data-move'), domain: node.getAttribute('data-domain') });
        IQ().learn('ask', { text: prompt });
      }

      btn.classList.add('is-fired');
      var send = function () {
        try {
          if (Surface() && typeof Surface().submitFollowUp === 'function') {
            Surface().submitFollowUp(prompt);
          }
        } catch (err) { /* the window stays usable either way */ }
      };
      if (reduced()) send(); else setTimeout(send, 170);
    });
  }

  function renderChips(chips, domain, thinking) {
    var node = rail();
    if (!node) return;
    var row = node.querySelector('.cts-smart-row');
    if (!row) return;

    if (!chips || !chips.length) {
      node.hidden = true;
      row.innerHTML = '';
      return;
    }

    node.setAttribute('data-domain', domain || '');
    node.classList.toggle('is-thinking', !!thinking);
    row.innerHTML = chips.map(function (c, i) {
      return '<button type="button" class="cts-smart-chip" style="--ciq-chip-i:' + i + '"' +
        ' data-move="' + esc(c.move || '') + '"' +
        ' data-prompt="' + esc(c.prompt) + '"' +
        ' title="' + esc(c.prompt) + '">' +
        icon(c.icon) + '<span>' + esc(c.label) + '</span></button>';
    }).join('');
    node.hidden = false;
  }

  /* The model's set replaces the local set without the row jumping:
     fade out, swap, fade in. Same height, same place. */
  function swapChips(chips, domain) {
    var node = rail();
    if (!node || !chips || !chips.length) {
      if (node) node.classList.remove('is-thinking');
      return;
    }
    if (reduced()) { renderChips(chips, domain, false); return; }

    node.classList.add('is-swapping');
    setTimeout(function () {
      renderChips(chips, domain, false);
      node.classList.remove('is-swapping');
    }, 220);
  }

  function clearChips() {
    var node = rail();
    if (!node) return;
    node.hidden = true;
    node.classList.remove('is-thinking', 'is-swapping');
    var row = node.querySelector('.cts-smart-row');
    if (row) row.innerHTML = '';
  }

  function think(query, answer, count) {
    if (!IQ()) return;
    var token = ++currentToken;
    var res = IQ().suggest({ query: query, answer: answer, count: count || 4 });
    renderChips(res.chips, res.signal.domain, true);

    res.refine.then(function (better) {
      if (token !== currentToken) return;        // a newer answer has landed
      if (!better || !better.length) {
        var node = rail();
        if (node) node.classList.remove('is-thinking');
        return;
      }
      swapChips(better, res.signal.domain);
    });
  }

  /* ══════════════════════════════════════════════════════════
     The answer settles in, word by word
     ══════════════════════════════════════════════════════════ */

  /* A set, not a comma string: 'PRE,CODE,…'.indexOf('P') is 0, which
     silently rejected every <p> in the answer — i.e. all of the prose. */
  var SKIP_IN = {};
  ['PRE', 'CODE', 'TABLE', 'THEAD', 'TBODY', 'TR', 'TD', 'TH',
   'SVG', 'SCRIPT', 'STYLE', 'BUTTON', 'TEXTAREA', 'INPUT'].forEach(function (t) { SKIP_IN[t] = 1; });
  var BLOCK_SELECTORS = '.cts-preview-wrap,.cts-pipeline,.cts-stats,.cts-meter,pre,table';
  var MAX_WORDS = 260;
  // A short confirmation line staggering in word-by-word reads as a
  // typewriter effect, not craft. Below this, the calm whole-body fade
  // the base stylesheet already does is the better answer.
  var MIN_WORDS_FOR_STAGGER = 14;
  var wrapping = false;

  function revealBody(body) {
    if (!body || wrapping) return;

    // Signature first, THEN compare. Reading a not-yet-written signature
    // and comparing it to itself is how this quietly did nothing at all.
    var sig = String(body.innerHTML.length) + ':' + String(body.childElementCount);
    if (body.dataset.twDone === sig) return;

    wrapping = true;
    try {
      // Non-prose blocks fade as single objects; reading a table one word
      // at a time is noise, not craft.
      var blocks = body.querySelectorAll(BLOCK_SELECTORS);
      var idx = 0;
      Array.prototype.forEach.call(blocks, function (b) {
        b.classList.add('cts-tw-b');
        b.style.setProperty('--w', String(idx));
        idx += 3;
      });

      var walker = doc.createTreeWalker(body, NodeFilter.SHOW_TEXT, {
        acceptNode: function (n) {
          if (!n.nodeValue || !n.nodeValue.trim()) return NodeFilter.FILTER_REJECT;
          var p = n.parentElement;
          while (p && p !== body) {
            if (SKIP_IN[p.tagName]) return NodeFilter.FILTER_REJECT;
            if (p.classList && (p.classList.contains('cts-tw-w') || p.classList.contains('cts-tw-b'))) {
              return NodeFilter.FILTER_REJECT;
            }
            p = p.parentElement;
          }
          return NodeFilter.FILTER_ACCEPT;
        }
      });

      var nodes = [];
      var total = 0;
      var n;
      while ((n = walker.nextNode())) {
        nodes.push(n);
        total += n.nodeValue.split(/\s+/).length;
        if (total > MAX_WORDS) break;
      }

      // A very long answer gets the block treatment instead — 400 animated
      // spans is a cost the reader pays for no extra meaning. A very short
      // one gets it too, the other direction: staggering three or four
      // words in is a typewriter effect, not the considered arrival it
      // looks like on a real paragraph.
      if (total > MAX_WORDS || total < MIN_WORDS_FOR_STAGGER) {
        body.classList.remove('has-words');
        body.dataset.twDone = String(body.innerHTML.length) + ':' + String(body.childElementCount);
        return;
      }

      var step = Math.max(7, Math.min(26, Math.round(760 / Math.max(1, total))));
      body.style.setProperty('--wstep', step + 'ms');

      var w = idx;
      nodes.forEach(function (node) {
        var parts = node.nodeValue.split(/(\s+)/);
        var frag = doc.createDocumentFragment();
        parts.forEach(function (part) {
          if (!part) return;
          if (/^\s+$/.test(part)) { frag.appendChild(doc.createTextNode(part)); return; }
          var span = doc.createElement('span');
          span.className = 'cts-tw-w';
          span.style.setProperty('--w', String(w++));
          span.textContent = part;
          frag.appendChild(span);
        });
        if (node.parentNode) node.parentNode.replaceChild(frag, node);
      });

      body.classList.add('has-words');
      body.classList.remove('is-settled');
      // Recorded AFTER wrapping, so the signature describes the wrapped
      // DOM — otherwise our own edit would look like fresh content.
      body.dataset.twDone = String(body.innerHTML.length) + ':' + String(body.childElementCount);

      // Hand the paint budget back once everything has landed.
      var settleIn = w * step + 700;
      clearTimeout(body._twSettle);
      body._twSettle = setTimeout(function () {
        body.classList.add('is-settled');
        try {
          body.classList.toggle('is-scrollable', body.scrollHeight > body.clientHeight + 1);
        } catch (e) {}
      }, Math.min(settleIn, 4000));
    } catch (e) {
      /* a malformed answer must never take the panel down */
    } finally {
      wrapping = false;
    }
  }

  /* ══════════════════════════════════════════════════════════
     The "+" menu, rebuilt from the conversation
     ══════════════════════════════════════════════════════════
     The original menu is left in place and its contents replaced the
     moment it opens, so nothing in clavis-task-surface.js has to change.
     ══════════════════════════════════════════════════════════ */

  var lastSeen = { query: '', answer: '' };

  function rebuildQuickMenu(menu) {
    if (!menu || menu.dataset.iq === '1') return;
    menu.dataset.iq = '1';
    if (!IQ()) return;

    var res = IQ().suggest({
      query: lastSeen.query || (IQ().memory().asked ? 'continue' : ''),
      answer: lastSeen.answer,
      count: 6
    });

    var chips = res.chips;
    if (!chips.length) return;

    menu.innerHTML = chips.map(function (c) {
      return '<div class="cts-action-pill cts-action-pill--iq" data-iq-prompt="' + esc(c.prompt) + '"' +
        ' data-iq-move="' + esc(c.move || '') + '" title="' + esc(c.prompt) + '">' +
        icon(c.icon) + '<span>' + esc(c.label) + '</span></div>';
    }).join('');

    menu.addEventListener('click', function (e) {
      var pill = e.target.closest && e.target.closest('.cts-action-pill--iq');
      if (!pill) return;
      var prompt = pill.getAttribute('data-iq-prompt');
      if (!prompt) return;
      if (IQ()) IQ().learn('chip', { move: pill.getAttribute('data-iq-move'), domain: res.signal.domain });
      var input = doc.querySelector('.cts-composer-input');
      if (input) {
        input.value = prompt;
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.focus();
        try { input.setSelectionRange(prompt.length, prompt.length); } catch (err) {}
      }
    }, true);

    res.refine.then(function (better) {
      if (!better || !better.length || !menu.isConnected) return;
      menu.innerHTML = better.slice(0, 6).map(function (c) {
        return '<div class="cts-action-pill cts-action-pill--iq" data-iq-prompt="' + esc(c.prompt) + '"' +
          ' data-iq-move="LLM" title="' + esc(c.prompt) + '">' +
          icon(c.icon) + '<span>' + esc(c.label) + '</span></div>';
      }).join('');
    });
  }

  /* ══════════════════════════════════════════════════════════
     Wiring
     ══════════════════════════════════════════════════════════ */

  function bindTask() {
    if (!global.ClavisTask || typeof global.ClavisTask.subscribe !== 'function') return false;

    global.ClavisTask.subscribe(function (task) {
      if (!task) { clearChips(); return; }

      if (task.phase === 'working' || task.phase === 'understanding') {
        clearChips();
        lastSeen.query = task._text || task.title || lastSeen.query;
        return;
      }

      if (task.phase === 'completed') {
        var query = task._text || task.title || '';
        var answer = (task.result && (task.result.text || task.result.summary)) || '';
        // Rows carry their own meaning; give the reader something to read.
        if (!answer && task.result && task.result.rows && task.result.rows.length) {
          answer = task.result.rows.length + ' records returned.';
        }
        lastSeen.query = query;
        lastSeen.answer = answer;
        // One frame behind paint(), so the chips arrive with the answer,
        // not before the body it belongs to.
        requestAnimationFrame(function () {
          requestAnimationFrame(function () { think(query, answer, 4); });
        });
        return;
      }

      if (task.phase === 'failed') { clearChips(); return; }
    });
    return true;
  }

  function bindSurface() {
    var surface = doc.getElementById(SURFACE_ID);
    if (!surface) return false;

    var body = surface.querySelector('.cts-body');
    if (body) {
      new MutationObserver(function () {
        if (wrapping) return;
        var phase = surface.dataset.phase;
        if (phase !== 'completed' && phase !== 'idle') return;
        revealBody(body);
      }).observe(body, { childList: true });
      if (surface.dataset.phase === 'completed') revealBody(body);
    }

    // The quick-actions menu is created on demand by the surface file.
    new MutationObserver(function (muts) {
      for (var i = 0; i < muts.length; i++) {
        var added = muts[i].addedNodes;
        for (var j = 0; j < added.length; j++) {
          var n = added[j];
          if (n.nodeType !== 1) continue;
          if (n.classList && n.classList.contains('cts-composer-actions')) rebuildQuickMenu(n);
          var inner = n.querySelector && n.querySelector('.cts-composer-actions');
          if (inner) rebuildQuickMenu(inner);
        }
      }
    }).observe(surface, { childList: true, subtree: true });

    rail();
    return true;
  }

  /* The surface builds itself lazily on the first task, so wait for it
     rather than assuming it is in the document at load. */
  function boot() {
    var taskBound = bindTask();
    var surfaceBound = bindSurface();
    if (taskBound && surfaceBound) return;

    var tries = 0;
    var timer = setInterval(function () {
      if (!taskBound) taskBound = bindTask();
      if (!surfaceBound) surfaceBound = bindSurface();
      if ((taskBound && surfaceBound) || ++tries > 60) clearInterval(timer);
    }, 250);

    // ...and if it appears later than that, catch it on arrival.
    new MutationObserver(function () {
      if (!surfaceBound && doc.getElementById(SURFACE_ID)) surfaceBound = bindSurface();
    }).observe(doc.body, { childList: true });
  }

  if (doc.readyState === 'loading') {
    doc.addEventListener('DOMContentLoaded', boot, { once: true });
  } else {
    boot();
  }

  global.ClavisPeekIQ = {
    refresh: function (q, a) { think(q || lastSeen.query, a || lastSeen.answer, 4); },
    clear: clearChips,
    reveal: function () {
      var b = doc.querySelector('#' + SURFACE_ID + ' .cts-body');
      if (b) { delete b.dataset.twDone; revealBody(b); }
    }
  };
})(window);
