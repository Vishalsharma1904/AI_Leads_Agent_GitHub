/* ============================================================
 * clavis-composer-iq.js
 * ------------------------------------------------------------
 * Two upgrades that both composers share — the one in the Clavis
 * tab and the one inside the floating Peek Task window:
 *
 *   A. Ghost completion.  As you type, the rest of the sentence
 *      appears in grey ahead of the caret. Tab takes it: the grey
 *      turns black in place and stays fully editable. Esc drops it.
 *      Local prediction from your own phrasing shows in ~0ms; the
 *      model quietly replaces it if it finds something better
 *      before you reach for Tab.
 *
 *   B. Attachment tray.  Paste a screenshot and it lands in its own
 *      labelled tray above the text, the composer grows to fit
 *      instead of jumping, and five or six of them stay tidy.
 *
 * How the grey text is drawn: a transparent mirror sits exactly on
 * top of the textarea. It re-renders what you typed as invisible
 * text so the widths line up character for character, then paints
 * the suggestion after it. The textarea keeps the caret, the focus
 * and the selection — the mirror never receives a single event.
 * ============================================================ */
(function (global) {
  'use strict';

  if (global.ClavisComposerIQ) return;

  var doc = global.document;

  var TARGETS = [
    { sel: '#jarvis-input', scope: 'main' },
    { sel: '.cts-composer-input', scope: 'peek' },
    // Client AI and Candidate AI get the same ghost completion.
    { sel: '#chat-input', scope: 'client' },
    { sel: '#candidate-ai-input', scope: 'candidate' }
  ];

  var MIRROR_PROPS = [
    'fontFamily', 'fontSize', 'fontWeight', 'fontStyle', 'fontVariant',
    'letterSpacing', 'wordSpacing', 'lineHeight', 'textIndent', 'textTransform',
    'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft',
    'borderTopWidth', 'borderRightWidth', 'borderBottomWidth', 'borderLeftWidth',
    'boxSizing', 'whiteSpace', 'wordBreak', 'overflowWrap', 'direction', 'tabSize',
    // Glyph-shaping props: without these the invisible typed run can be a
    // few px wider/narrower than the real text, so the grey ghost started
    // after a visible gap (or on top of the last letters).
    'fontFeatureSettings', 'fontKerning', 'fontVariationSettings', 'fontStretch',
    'fontVariantLigatures', 'fontOpticalSizing', 'textRendering'
  ];

  function kebab(prop) {
    return prop.replace(/[A-Z]/g, function (c) { return '-' + c.toLowerCase(); });
  }

  function reduced() {
    try { return global.matchMedia('(prefers-reduced-motion: reduce)').matches; }
    catch (e) { return false; }
  }

  /* ══════════════════════════════════════════════════════════
     A · Ghost completion
     ══════════════════════════════════════════════════════════ */

  function Ghost(input, scope) {
    this.input = input;
    this.scope = scope;
    this.mirror = null;
    this.typedSpan = null;
    this.ghostSpan = null;
    this.hint = null;
    this.suggestion = '';
    this.basis = '';          // the exact value the suggestion was made for
    this.localTimer = 0;
    this.modelTimer = 0;
    this.seq = 0;
    this.composing = false;
    this.accepting = false;
    this.build();
    this.bind();
  }

  Ghost.prototype.build = function () {
    var parent = this.input.parentElement;
    if (!parent) return;
    if (getComputedStyle(parent).position === 'static') {
      parent.style.position = 'relative';
    }

    var m = doc.createElement('div');
    m.className = 'ciq-mirror';
    m.setAttribute('aria-hidden', 'true');
    m.innerHTML = '<span class="ciq-typed"></span><span class="ciq-ghost"></span>';
    parent.appendChild(m);

    this.mirror = m;
    this.typedSpan = m.querySelector('.ciq-typed');
    this.ghostSpan = m.querySelector('.ciq-ghost');

    // The Tab affordance lives on the composer shell, above the text.
    var shell = this.input.closest('.jarvis-luxury-composer, .jarvis-input-container, .cts-composer');
    if (shell) {
      if (getComputedStyle(shell).position === 'static') shell.style.position = 'relative';
      var hint = doc.createElement('div');
      hint.className = 'ciq-tab-hint';
      hint.setAttribute('aria-hidden', 'true');
      hint.innerHTML = '<kbd>Tab</kbd><span>accept</span>';
      /* Studio composer: the hint joins the bottom tool row as a flex item
         (between the +/attach tools and the right-hand buttons), so it can
         never sit on the ghost text or on a button, at any width. The
         floating window has no tool row and keeps the corner pill. */
      var bar = shell.querySelector('.jarvis-composer-bottom-bar');
      var right = bar && bar.querySelector(':scope > .jarvis-composer-right-tools');
      if (bar && right) {
        hint.classList.add('ciq-tab-hint--inbar');
        bar.insertBefore(hint, right);
      } else {
        shell.appendChild(hint);
      }
      this.hint = hint;
    }
  };

  /* Copy the textarea's exact metrics onto the mirror so a character
     typed at column 40 of line 3 lands at the same pixel in both. */
  Ghost.prototype.sync = function () {
    if (!this.mirror) return;
    var input = this.input;
    var cs = getComputedStyle(input);
    var m = this.mirror.style;
    for (var i = 0; i < MIRROR_PROPS.length; i++) {
      var v = cs[MIRROR_PROPS[i]];
      if (v == null || v === '') continue;
      // 'important': several theme layers pin font-family / features on
      // every div in the composer with !important, which silently beat
      // the plain inline copy and put the mirror in a different font.
      m.setProperty(kebab(MIRROR_PROPS[i]), v, 'important');
    }
    m.left = input.offsetLeft + 'px';
    m.top = input.offsetTop + 'px';
    m.width = input.offsetWidth + 'px';
    m.height = input.offsetHeight + 'px';

    /* Show whole lines only. The textarea is sized for what was typed, not
       for the ghost, so a long suggestion wraps onto a line the box has no
       room for — and the top few px of that line used to peek out under
       the real text (the squashed half-line). Clip the mirror to the last
       complete line instead; Tab still inserts the full suggestion. */
    var lh = parseFloat(cs.lineHeight);
    if (!lh || isNaN(lh)) lh = (parseFloat(cs.fontSize) || 15) * 1.25;
    var padTop = parseFloat(cs.paddingTop) || 0;
    var padBottom = parseFloat(cs.paddingBottom) || 0;
    var borderTop = parseFloat(cs.borderTopWidth) || 0;
    var inner = input.clientHeight - padTop - padBottom;
    var lines = Math.max(1, Math.floor((inner + 1) / lh));
    var visible = borderTop + padTop + lines * lh;
    var cut = Math.max(0, Math.floor(input.offsetHeight - visible));
    // While Tab is being accepted the mirror paints the real text, so it
    // must not be trimmed if the textarea has not finished growing yet.
    m.clipPath = (cut > 0 && !this.accepting) ? 'inset(0 0 ' + cut + 'px 0)' : '';

    /* Take the ink straight from the textarea rather than guessing a
       per-theme value, so the accepted text lands on exactly the colour
       the rest of the line is already using — whatever theme is on.
       Skipped while muted, when that colour is deliberately transparent. */
    if (!input.classList.contains('ciq-input-muted')) {
      this.mirror.style.setProperty('--ciq-ink', cs.color);
    }

    this.mirror.scrollTop = input.scrollTop;
  };

  Ghost.prototype.canSuggest = function () {
    var input = this.input;
    if (this.composing || this.accepting) return false;
    if (doc.activeElement !== input) return false;
    var v = input.value || '';
    if (v.trim().length < 3) return false;
    if (v.length > 600) return false;
    // Only ever complete from the end. Mid-text ghosting is a guessing
    // game the user did not ask to play.
    if (input.selectionStart !== v.length || input.selectionEnd !== v.length) return false;
    return true;
  };

  Ghost.prototype.render = function () {
    if (!this.mirror) return;
    var v = this.input.value || '';
    var g = (this.suggestion && this.basis === v) ? this.suggestion : '';
    this.typedSpan.textContent = v;
    this.ghostSpan.textContent = g;
    this.mirror.classList.toggle('is-live', !!g);
    if (this.hint) {
      this.hint.classList.toggle('is-live', !!g);
      if (g) this.fitHint();
    }
    if (g) this.sync();
  };

  /* In the tool row the hint only gets the space the buttons leave. If
     "Tab accept" does not fit, drop the word; if even the key does not
     fit, hide it — never show a clipped sliver of a pill. */
  Ghost.prototype.fitHint = function () {
    var h = this.hint;
    if (!h || !h.classList.contains('ciq-tab-hint--inbar')) return;
    h.classList.remove('is-compact', 'is-cramped');
    if (h.scrollWidth <= h.clientWidth + 1) return;
    h.classList.add('is-compact');
    if (h.scrollWidth <= h.clientWidth + 1) return;
    h.classList.add('is-cramped');
  };

  Ghost.prototype.clear = function (silent) {
    if (this.suggestion && !silent && global.ClavisIQ) {
      global.ClavisIQ.learn('ghost-reject', {});
    }
    this.suggestion = '';
    this.basis = '';
    this.seq++;
    this.render();
  };

  Ghost.prototype.propose = function (text, forValue, origin) {
    if (!text) return;
    if ((this.input.value || '') !== forValue) return;   // user moved on
    var t = String(text);
    // Never propose something that just repeats what is already typed.
    if (!t.trim()) return;
    // Long enough for a full sentence and a bit more — this is meant to
    // read as a real continuation, not a one- or two-word stub.
    if (t.length > 240) t = t.slice(0, 240);
    this.suggestion = t;
    this.basis = forValue;
    this.origin = origin;
    this.render();
  };

  Ghost.prototype.think = function () {
    var self = this;
    clearTimeout(this.localTimer);
    clearTimeout(this.modelTimer);

    if (!this.canSuggest()) { this.clear(true); return; }

    var value = this.input.value;
    var my = ++this.seq;

    // Instant pass — his own phrasing, no network.
    this.localTimer = setTimeout(function () {
      if (my !== self.seq || self.input.value !== value) return;
      if (!global.ClavisIQ) return;
      var r = global.ClavisIQ.complete(value, { useModel: false });
      if (r && r.text) self.propose(r.text, value, 'local');
    }, 90);

    // Model pass — only once typing actually pauses, so it is one call
    // per thought, not one per keystroke.
    this.modelTimer = setTimeout(function () {
      if (my !== self.seq || self.input.value !== value) return;
      if (!global.ClavisIQ) return;
      var r = global.ClavisIQ.complete(value);
      if (!r || !r.refine) return;
      r.refine.then(function (text) {
        if (my !== self.seq || self.input.value !== value) return;
        if (text) self.propose(text, value, 'model');
      });
    }, 460);
  };

  /* Tab: the grey becomes real text. The textarea's own glyphs are
     hidden for the length of the fade so the two never double-print,
     which is what makes the colour change read as one object rather
     than two stacked copies. */
  Ghost.prototype.accept = function () {
    var g = this.suggestion;
    var base = this.input.value || '';
    if (!g || this.basis !== base) return false;

    var self = this;
    var full = base + g;

    this.accepting = true;
    this.suggestion = '';

    if (global.ClavisIQ) global.ClavisIQ.learn('ghost-accept', { prefix: base, ghost: g });

    if (reduced()) {
      this.commit(full);
      this.accepting = false;
      this.render();
      return true;
    }

    // Paint the whole line in the mirror: what was typed in normal ink,
    // what was accepted still grey — then let the grey catch up.
    this.typedSpan.textContent = base;
    this.ghostSpan.textContent = g;
    this.mirror.classList.add('is-live', 'is-accepting');
    this.input.classList.add('ciq-input-muted');
    this.sync();

    this.commit(full);
    this.sync();

    requestAnimationFrame(function () {
      requestAnimationFrame(function () {
        if (self.mirror) self.mirror.classList.add('is-settled');
      });
    });

    setTimeout(function () {
      if (self.mirror) self.mirror.classList.remove('is-accepting', 'is-settled');
      self.input.classList.remove('ciq-input-muted');
      self.accepting = false;
      self.render();
      self.think();
    }, 430);

    return true;
  };

  Ghost.prototype.commit = function (full) {
    var input = this.input;
    input.value = full;
    try { input.setSelectionRange(full.length, full.length); } catch (e) {}
    this.basis = full;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    if (this.scope === 'main' && typeof global.autoGrowJarvisInput === 'function') {
      try { global.autoGrowJarvisInput(); } catch (e) {}
    }
  };

  Ghost.prototype.bind = function () {
    var self = this;
    var input = this.input;

    input.addEventListener('compositionstart', function () { self.composing = true; self.clear(true); });
    input.addEventListener('compositionend', function () { self.composing = false; self.think(); });

    input.addEventListener('input', function () {
      if (self.accepting) return;
      // A suggestion made for an older value is stale the moment a key lands.
      if (self.basis !== input.value) { self.suggestion = ''; self.render(); }
      self.think();
    });

    input.addEventListener('keydown', function (e) {
      if (e.key === 'Tab' && !e.shiftKey && self.suggestion) {
        e.preventDefault();
        e.stopPropagation();
        self.accept();
        return;
      }
      if (e.key === 'Escape' && self.suggestion) {
        e.preventDefault();
        e.stopPropagation();     // do not also close the floating window
        self.clear();
        return;
      }
      // Right arrow at the very end also accepts — the shortcut people
      // discover by accident and then keep using.
      if (e.key === 'ArrowRight' && self.suggestion &&
          input.selectionStart === input.value.length) {
        e.preventDefault();
        self.accept();
        return;
      }
      if (e.key === 'Enter' || e.key === 'ArrowUp' || e.key === 'ArrowDown') {
        self.clear(true);
      }
    });

    input.addEventListener('blur', function () { self.clear(true); });
    input.addEventListener('scroll', function () {
      if (self.mirror) self.mirror.scrollTop = input.scrollTop;
    }, { passive: true });
    input.addEventListener('click', function () { if (!self.canSuggest()) self.clear(true); });

    global.addEventListener('resize', function () { if (self.suggestion) self.sync(); }, { passive: true });
  };

  /* ══════════════════════════════════════════════════════════
     B · Attachment tray
     ══════════════════════════════════════════════════════════ */

  function upgradeTray() {
    var dock = doc.getElementById('clavis-composer-attachment-dock');
    if (!dock || dock.dataset.ciq === '1') return;
    dock.dataset.ciq = '1';

    // The tray gets a header so a stack of screenshots reads as one
    // labelled section rather than a loose row that pushed the text down.
    var head = doc.createElement('div');
    head.className = 'ciq-tray-head';
    head.innerHTML =
      '<span class="ciq-tray-icon" aria-hidden="true">' +
      '  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
      '    <rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="m21 15-5-5L5 21"/>' +
      '  </svg>' +
      '</span>' +
      '<span class="ciq-tray-count">1 attachment</span>' +
      '<button type="button" class="ciq-tray-clear">Clear all</button>';

    var wrap = doc.createElement('div');
    wrap.className = 'ciq-tray';
    dock.parentNode.insertBefore(wrap, dock);
    wrap.appendChild(head);
    wrap.appendChild(dock);

    head.querySelector('.ciq-tray-clear').addEventListener('click', function (e) {
      e.preventDefault();
      e.stopPropagation();
      var cards = dock.querySelectorAll('.clavis-att-card');
      Array.prototype.forEach.call(cards, function (c, i) {
        setTimeout(function () {
          if (typeof global.removeClavisScreenshot === 'function') global.removeClavisScreenshot(c.id);
          else c.remove();
        }, i * 45);
      });
    });

    function refresh() {
      var cards = dock.querySelectorAll('.clavis-att-card');
      var n = cards.length;
      wrap.classList.toggle('has-items', n > 0);
      head.querySelector('.ciq-tray-count').textContent =
        n === 1 ? '1 attachment' : (n + ' attachments');
      Array.prototype.forEach.call(cards, function (c, i) {
        c.style.setProperty('--ciq-i', String(i));
      });
      dock.classList.toggle('is-dense', n >= 4);
    }

    new MutationObserver(refresh).observe(dock, { childList: true });
    refresh();
  }

  /* A pasted screenshot should feel caught, not just appended. */
  function bindPasteFlash() {
    doc.addEventListener('paste', function (e) {
      var t = e.target;
      if (!t || !t.closest) return;
      var shell = t.closest('.jarvis-luxury-composer, .jarvis-input-container, .cts-composer');
      if (!shell) return;
      var cd = e.clipboardData;
      var hasImage = false;
      if (cd && cd.items) {
        for (var i = 0; i < cd.items.length; i++) {
          if (cd.items[i].type && cd.items[i].type.indexOf('image') === 0) { hasImage = true; break; }
        }
      }
      if (!hasImage) return;
      shell.classList.remove('ciq-caught');
      void shell.offsetWidth;
      shell.classList.add('ciq-caught');
      setTimeout(function () { shell.classList.remove('ciq-caught'); }, 700);
    }, true);
  }

  /* ══════════════════════════════════════════════════════════
     Wiring
     ══════════════════════════════════════════════════════════ */

  var attached = new WeakSet();

  function attachAll() {
    TARGETS.forEach(function (t) {
      var nodes = doc.querySelectorAll(t.sel);
      Array.prototype.forEach.call(nodes, function (n) {
        if (attached.has(n)) return;
        if (!n.parentElement) return;
        attached.add(n);
        try { new Ghost(n, t.scope); } catch (e) { /* never break the composer */ }
      });
    });
  }

  /* Remember what he actually sends, so tomorrow's ghost sounds like him. */
  function bindLearning() {
    doc.addEventListener('keydown', function (e) {
      if (e.key !== 'Enter' || e.shiftKey) return;
      var t = e.target;
      if (!t || !t.matches) return;
      if (!t.matches('#jarvis-input, .cts-composer-input, #chat-input, #candidate-ai-input')) return;
      var v = (t.value || '').trim();
      if (v && global.ClavisIQ) global.ClavisIQ.learn('ask', { text: v });
    }, true);

    doc.addEventListener('click', function (e) {
      var btn = e.target.closest && e.target.closest('#jarvis-send-btn, .cts-composer-send');
      if (!btn) return;
      var input = btn.id === 'jarvis-send-btn'
        ? doc.getElementById('jarvis-input')
        : doc.querySelector('.cts-composer-input');
      var v = input && (input.value || '').trim();
      if (v && global.ClavisIQ) global.ClavisIQ.learn('ask', { text: v });
    }, true);
  }

  function init() {
    attachAll();
    upgradeTray();
    bindPasteFlash();
    bindLearning();

    // The floating window builds its composer lazily, and the tray can be
    // rebuilt by other passes, so keep watching rather than assuming.
    // Coalesced to one check per frame: this page streams chat tokens into
    // the DOM, and an un-throttled observer here would run thousands of
    // times a minute for no reason.
    var queued = false;
    new MutationObserver(function () {
      if (queued) return;
      queued = true;
      requestAnimationFrame(function () {
        queued = false;
        attachAll();
        upgradeTray();
      });
    }).observe(doc.body, { childList: true, subtree: true });
  }

  if (doc.readyState === 'loading') {
    doc.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }

  global.ClavisComposerIQ = { attach: attachAll, refreshTray: upgradeTray };
})(window);
