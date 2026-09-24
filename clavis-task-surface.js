/* ============================================================
 * clavis-task-surface.js  ·  components/floating-task/*
 * ------------------------------------------------------------
 * The floating surface: header, body, actions, and the renderer
 * registry that picks a body per intent mode.
 *
 * Renderers are looked up in a registry, never a switch, so a new
 * task type is one entry plus one function.
 *
 * Motion notes (this is why it stays at 60fps):
 *  · every state change is coalesced into one rAF paint, so a
 *    burst of tool events costs one layout, not ten
 *  · the panel is `contain: layout paint style`, so animating its
 *    height cannot reflow the page behind it
 *  · body content only ever animates opacity + translateY
 *  · entrances are slow and settled (420ms), exits are quick
 *    (140ms) — the asymmetry is what reads as calm rather than sluggish
 * ============================================================ */
(function (global) {
  'use strict';

  var Task = global.ClavisTask;
  if (!Task) { console.warn('[ClavisTaskSurface] controller missing'); return; }

  /* Width is capped deliberately low: long output should grow DOWN, not
     sideways. A narrow measure (~46 characters) is also what makes a
     wall of text readable rather than a slab. Height is the axis that
     moves — see .cts max-height in the stylesheet. */
  /* Width is no longer a fixed step per density — it is a RANGE. The
     window measures what it is about to show and settles somewhere
     inside that range: a one-line answer stays narrow, a wall of prose
     or a table earns the extra width instead of turning into a column
     of two-word lines. Height does the same, independently. */
  var DENSITY = { compact: 340, normal: 400, expanded: 480 };
  var WIDTH = { min: 320, minTable: 480, max: 560, maxTable: 800 };
  var DRAG_KEY = 'clavis-task-pos';
  var MARGIN = 8;

  var el = null, headerEl = null, bodyEl = null, footerEl = null, dotEl = null, labelEl = null, cancelEl = null;
  var composerEl = null, composerInput = null, composerSendBtn = null, placeholderTimer = null;
  var attachmentsTray = null, fileInput = null, attachBtn = null;
  var currentAttachments = [];
  var frame = 0, lastSignature = '', manuallyHidden = false, hiddenTaskId = null;
  // Sir opened the window himself (Peek Tasks): it shows every task, voice
  // ones included, until he closes it.
  var userPinned = false;

  /* ── Rotating Placeholders for Integrated Composer ───────── */
  var PLACEHOLDERS = [
    'Ask follow-up or suggest changes...',
    'Paste screenshot or attach document...',
    'Give a substitute or better option...',
    'Export these results to Excel...',
    'Find email & phone contacts...',
    'Simplify this answer...',
    'Compare with other options...'
  ];
  var placeholderIdx = 0;

  /* ── Composer shape ───────────────────────────────────────
     A cached page can still be carrying the old three-control row
     (attach, quick-actions, and a send button floating outside the
     field). This rebuilds it into the current shape: one field, with
     the send control living INSIDE it. Attaching still works — paste
     and drag-and-drop were always the faster routes anyway, and the
     row is calmer without two icons competing with the text. */
  function normaliseComposer(root) {
    var comp = root.querySelector('.cts-composer');
    if (!comp) {
      comp = document.createElement('div');
      comp.className = 'cts-composer';
      comp.id = 'clavis-task-composer';
      root.appendChild(comp);
    }

    // Retire the two left-hand buttons wherever they came from.
    ['.cts-composer-attach', '.cts-composer-icon'].forEach(function (sel) {
      var n = comp.querySelector(sel);
      if (n && n.parentNode) n.parentNode.removeChild(n);
    });

    var tray = comp.querySelector('.cts-composer-attachments');
    if (!tray) {
      tray = document.createElement('div');
      tray.className = 'cts-composer-attachments';
      tray.id = 'cts-composer-attachments';
      tray.hidden = true;
      comp.insertBefore(tray, comp.firstChild);
    }

    var row = comp.querySelector('.cts-composer-row');
    if (!row) {
      row = document.createElement('div');
      row.className = 'cts-composer-row';
      comp.appendChild(row);
    }

    if (!comp.querySelector('.cts-file-input')) {
      var finp = document.createElement('input');
      finp.type = 'file';
      finp.className = 'cts-file-input';
      finp.style.display = 'none';
      finp.accept = 'image/*,.pdf,.txt,.csv,.json,.md,.js,.py,.docx,.xlsx';
      finp.multiple = true;
      row.appendChild(finp);
    }

    var wrap = comp.querySelector('.cts-composer-input-wrap');
    if (!wrap) {
      wrap = document.createElement('div');
      wrap.className = 'cts-composer-input-wrap';
      row.appendChild(wrap);
    }

    var ta = comp.querySelector('.cts-composer-input');
    if (!ta) {
      ta = document.createElement('textarea');
      ta.className = 'cts-composer-input';
      ta.rows = 1;
      ta.setAttribute('aria-label', 'Follow-up message');
    }
    ta.placeholder = 'Reply to Clavis';
    if (ta.parentNode !== wrap) wrap.insertBefore(ta, wrap.firstChild);

    var send = comp.querySelector('.cts-composer-send');
    if (!send) {
      send = document.createElement('button');
      send.type = 'button';
      send.className = 'cts-composer-send';
      send.setAttribute('aria-label', 'Send');
      send.title = 'Send (Enter)';
      send.innerHTML =
        '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
        'stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">' +
        '<line x1="12" y1="19" x2="12" y2="5"/><polyline points="5 12 12 5 19 12"/></svg>';
    }
    // The send control belongs inside the field, not beside it.
    if (send.parentNode !== wrap) wrap.appendChild(send);

    return comp;
  }

  /* ── DOM ─────────────────────────────────────────────────── */
  function build() {
    if (el) return el;

    // Clean up any legacy or orphan elements from previous turns
    var legacyGroup = document.getElementById('clavis-task-surface-group');
    var legacyPill = document.getElementById('clavis-floating-pill-dock');
    if (legacyPill && legacyPill.parentNode) legacyPill.parentNode.removeChild(legacyPill);

    el = document.getElementById('clavis-task-surface');
    if (!el) {
      el = document.createElement('section');
      el.className = 'cts';
      el.id = 'clavis-task-surface';
      el.setAttribute('role', 'status');
      el.setAttribute('aria-live', 'polite');
      el.setAttribute('aria-label', 'Clavis task');
      el.innerHTML =
        '<header class="cts-head">' +
        '  <span class="cts-dot" aria-hidden="true"></span>' +
        '  <span class="cts-head-label">Clavis</span>' +
        '  <button type="button" class="cts-x" aria-label="Dismiss">' +
        '    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg>' +
        '  </button>' +
        '</header>' +
        '<div class="cts-body"></div>' +
        '<footer class="cts-foot" hidden></footer>' +
        '<div class="cts-composer" id="clavis-task-composer">' +
        '<div class="cts-composer-attachments" id="cts-composer-attachments" hidden></div>' +
          '<div class="cts-composer-row">' +
          '  <input type="file" class="cts-file-input" style="display:none;" accept="image/*,.pdf,.txt,.csv,.json,.md,.js,.py,.docx,.xlsx" multiple>' +
          '  <div class="cts-composer-input-wrap">' +
          '    <textarea class="cts-composer-input" rows="1" placeholder="Reply to Clavis" aria-label="Follow-up message"></textarea>' +
          '    <button type="button" class="cts-composer-send" aria-label="Send" title="Send (Enter)">' +
          '      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">' +
          '        <line x1="12" y1="19" x2="12" y2="5"/><polyline points="5 12 12 5 19 12"/>' +
          '      </svg>' +
          '    </button>' +
          '  </div>' +
          '</div>' +
        '</div>';
      document.body.appendChild(el);
    } else {
      if (el.parentNode !== document.body) {
        document.body.appendChild(el);
      }
      normaliseComposer(el);
    }

    if (legacyGroup && legacyGroup.parentNode) {
      legacyGroup.parentNode.removeChild(legacyGroup);
    }

    headerEl = el.querySelector('.cts-head');
    bodyEl = el.querySelector('.cts-body');
    footerEl = el.querySelector('.cts-foot');
    dotEl = el.querySelector('.cts-dot');
    labelEl = el.querySelector('.cts-head-label');
    cancelEl = el.querySelector('.cts-x');

    composerEl = el.querySelector('.cts-composer');
    composerInput = el.querySelector('.cts-composer-input');
    composerSendBtn = el.querySelector('.cts-composer-send');
    attachmentsTray = el.querySelector('.cts-composer-attachments');
    fileInput = el.querySelector('.cts-file-input');
    attachBtn = el.querySelector('.cts-composer-attach');

    cancelEl.addEventListener('click', function () {
      var t = Task.current();
      if (t && (t.phase === 'working' || t.phase === 'understanding')) Task.cancel(t.id);
      dismiss();
    });

    wireComposer();
    attachDrag();
    restorePosition();
    attachDismiss();
    return el;
  }

  /* ── Geometry ─────────────────────────────────────────────
     Everything about how big the window wants to be lives here, so the
     open animation and a mid-task resize agree on the answer instead of
     each guessing separately. */

  function reducedMotion() {
    try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches; }
    catch (e) { return false; }
  }

  function ceilingH() {
    return Math.min(window.innerHeight * 0.76, window.innerHeight - 104);
  }
  function ceilingW(hasTable) {
    return Math.min(hasTable ? WIDTH.maxTable : WIDTH.max, window.innerWidth - 48);
  }

  /* Measure the box the current content actually wants, on both axes.
     `max-content` asks the layout engine "how wide would you be if you
     never wrapped?" — clamped, that turns into: short text stays narrow,
     long text widens to the reading maximum, then grows downward. */
  function measure() {
    if (!el) return { w: WIDTH.min, h: 200 };
    // Leads/contacts/dataset tables get real breathing room; plain text
    // stays at the narrower reading width.
    var hasTable = !!el.querySelector('.cts-preview-wrap, .cts-preview-table');
    var prevW = el.style.width, prevH = el.style.height;
    var prevMax = el.style.maxWidth, prevTrans = el.style.transition;

    el.style.transition = 'none';
    el.style.height = 'auto';
    el.style.maxWidth = ceilingW(hasTable) + 'px';
    el.style.width = 'max-content';
    // A compact 3-row preview table doesn't naturally ask for much room —
    // its cells are deliberately truncated — so raising only the ceiling
    // would leave it just as narrow. A table gets a floor as well, so the
    // panel genuinely reads as an expanded view, not a squeezed one.
    var w = clamp(Math.ceil(el.getBoundingClientRect().width), hasTable ? WIDTH.minTable : WIDTH.min, ceilingW(hasTable));

    el.style.width = w + 'px';
    var h = Math.min(Math.ceil(el.getBoundingClientRect().height), ceilingH());

    el.style.width = prevW;
    el.style.height = prevH;
    el.style.maxWidth = prevMax;
    el.style.transition = prevTrans;
    void el.offsetHeight;
    return { w: w, h: h };
  }

  var geoAnim = null;

  function cancelGeo() {
    if (geoAnim) { try { geoAnim.cancel(); } catch (e) {} geoAnim = null; }
  }

  /* Already-open window, content just changed: glide both axes to the
     new box. No jump, no snap back to a fixed width. */
  function smoothResize(mutationFn) {
    if (!el) { if (typeof mutationFn === 'function') mutationFn(); return; }

    var from = el.getBoundingClientRect();
    if (typeof mutationFn === 'function') mutationFn();

    var to = measure();
    if (reducedMotion() || !el.animate) {
      el.style.width = to.w + 'px';
      el.style.height = 'auto';
      return;
    }

    cancelGeo();
    el.style.overflow = 'hidden';
    geoAnim = el.animate(
      [
        { width: Math.round(from.width) + 'px', height: Math.round(from.height) + 'px' },
        { width: to.w + 'px', height: to.h + 'px' }
      ],
      { duration: 560, easing: 'cubic-bezier(0.22, 1, 0.36, 1)', fill: 'both' }
    );
    var a = geoAnim;
    geoAnim.onfinish = function () {
      if (!el) return;
      el.style.width = to.w + 'px';
      el.style.height = 'auto';
      el.style.overflow = '';
      try { a.cancel(); } catch (e) {}   // release the forced geometry
      if (geoAnim === a) geoAnim = null;
    };
  }

  /* ── Open / close ─────────────────────────────────────────
     ONE animation, used by every route in: a task completing, a task
     failing, and the Peek Tasks button. It used to differ per path,
     which is why opening it by hand felt like a different app.

     The shape of it: the window arrives as a small capsule pinned to
     its corner, holds for a beat so the eye catches it, then unfurls —
     widening and dropping at the same time — into the finished card.
     Content fades up slightly behind the unfurl so text never appears
     squashed inside a half-open box. */

  function playOpen() {
    if (!el) return;
    var to = measure();

    if (reducedMotion() || !el.animate) {
      el.style.width = to.w + 'px';
      el.style.height = 'auto';
      return;
    }

    cancelGeo();
    el.style.overflow = 'hidden';

    var capsuleW = Math.min(236, to.w);
    var capsuleH = 40;

    geoAnim = el.animate(
      [
        { width: capsuleW + 'px', height: capsuleH + 'px', borderRadius: '999px',
          opacity: 0, transform: 'translateY(-8px) scale(0.965)', offset: 0 },
        { width: capsuleW + 'px', height: capsuleH + 'px', borderRadius: '999px',
          opacity: 1, transform: 'translateY(0) scale(1)', offset: 0.2 },
        { width: to.w + 'px', height: to.h + 'px', borderRadius: '18px',
          opacity: 1, transform: 'none', offset: 1 }
      ],
      { duration: 780, easing: 'cubic-bezier(0.22, 1, 0.36, 1)', fill: 'both' }
    );
    var opened = geoAnim;
    geoAnim.onfinish = function () {
      if (!el) return;
      el.style.width = to.w + 'px';
      el.style.height = 'auto';
      el.style.overflow = '';
      el.style.borderRadius = '';
      try { opened.cancel(); } catch (e) {}
      if (geoAnim === opened) geoAnim = null;
    };

    // Content trails the unfurl by a beat — it reads as the card
    // revealing what it holds, rather than everything arriving at once.
    [bodyEl, footerEl, composerEl].forEach(function (node, i) {
      if (!node || node.hidden) return;
      try {
        node.animate(
          [ { opacity: 0, transform: 'translateY(7px)' },
            { opacity: 1, transform: 'none' } ],
          { duration: 420, delay: 210 + i * 55, easing: 'cubic-bezier(0.22, 1, 0.36, 1)', fill: 'both' }
        );
      } catch (e) {}
    });
  }

  /* Exits fold back toward where they came from — unhurried, so the
     window settles away instead of vanishing. */
  function playClose(done) {
    if (!el || reducedMotion() || !el.animate) { done(); return; }
    cancelGeo();
    var from = el.getBoundingClientRect();
    el.style.overflow = 'hidden';
    var a = el.animate(
      [
        { width: Math.round(from.width) + 'px', height: Math.round(from.height) + 'px',
          opacity: 1, transform: 'none', borderRadius: '18px' },
        { width: Math.round(Math.min(236, from.width)) + 'px', height: '40px',
          opacity: 0, transform: 'translateY(-6px) scale(0.97)', borderRadius: '999px' }
      ],
      { duration: 460, easing: 'cubic-bezier(0.65, 0, 0.35, 1)', fill: 'both' }
    );
    a.onfinish = function () {
      try { a.cancel(); } catch (e) {}
      if (el) { el.style.overflow = ''; el.style.borderRadius = ''; }
      done();
    };
  }

  /* ── Embedded Composer Logic ─────────────────────────────── */
  function formatBytes(bytes) {
    if (!bytes || bytes <= 0) return '0 B';
    var k = 1024;
    var sizes = ['B', 'KB', 'MB', 'GB'];
    var i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  }

  function openImageLightbox(src, title) {
    var modal = document.getElementById('cts-image-lightbox');
    if (!modal) {
      modal = document.createElement('div');
      modal.id = 'cts-image-lightbox';
      modal.className = 'cts-lightbox';
      modal.innerHTML =
        '<div class="cts-lightbox-backdrop"></div>' +
        '<div class="cts-lightbox-dialog">' +
        '  <div class="cts-lightbox-header">' +
        '    <span class="cts-lightbox-title"></span>' +
        '    <button type="button" class="cts-lightbox-close" aria-label="Close preview">' +
        '      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg>' +
        '    </button>' +
        '  </div>' +
        '  <div class="cts-lightbox-body">' +
        '    <img src="" alt="Screenshot Preview" class="cts-lightbox-img" />' +
        '  </div>' +
        '</div>';
      document.body.appendChild(modal);

      var closeBtn = modal.querySelector('.cts-lightbox-close');
      var backdrop = modal.querySelector('.cts-lightbox-backdrop');
      function closeLb() {
        modal.classList.remove('is-open');
        setTimeout(function () { modal.style.display = 'none'; }, 240);
      }
      closeBtn.addEventListener('click', closeLb);
      backdrop.addEventListener('click', closeLb);
      document.addEventListener('keydown', function (e) {
        if (e.key === 'Escape' && modal.classList.contains('is-open')) closeLb();
      });
    }

    var img = modal.querySelector('.cts-lightbox-img');
    var titleEl = modal.querySelector('.cts-lightbox-title');
    if (img) img.src = src;
    if (titleEl) titleEl.textContent = title || 'Screenshot Preview';
    modal.style.display = 'flex';
    void modal.offsetWidth;
    modal.classList.add('is-open');
  }
  global.openImageLightbox = openImageLightbox;

  function renderAttachments() {
    if (!attachmentsTray) return;
    smoothResize(function () {
      if (!currentAttachments.length) {
        attachmentsTray.innerHTML = '';
        attachmentsTray.hidden = true;
        if (composerEl) composerEl.classList.remove('has-attachments');
        return;
      }
      attachmentsTray.hidden = false;
      if (composerEl) composerEl.classList.add('has-attachments');

      // Preserve existing chips to prevent keyframe flicker
      var existingMap = {};
      attachmentsTray.querySelectorAll('.cts-attach-chip').forEach(function (node) {
        var id = node.getAttribute('data-id');
        if (id) existingMap[id] = node;
      });

      // Remove chips no longer in currentAttachments
      var currentIds = new Set(currentAttachments.map(function (a) { return a.id; }));
      Object.keys(existingMap).forEach(function (id) {
        if (!currentIds.has(id)) {
          existingMap[id].remove();
        }
      });

      // Append only new chips
      currentAttachments.forEach(function (att) {
        if (existingMap[att.id]) return;

        var chip = document.createElement('div');
        chip.className = 'cts-attach-chip';
        chip.setAttribute('data-id', att.id);

        var thumbHtml = '';
        if (att.isImage && att.dataUrl) {
          thumbHtml = '<img src="' + att.dataUrl + '" alt="' + esc(att.name) + '" class="cts-attach-img" />' +
            '<div class="cts-attach-thumb-overlay" title="Click to enlarge">' +
            '  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>' +
            '</div>';
        } else {
          thumbHtml = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
            '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>' +
            '<polyline points="14 2 14 8 20 8"/>' +
            '</svg>';
        }

        var ext = (att.name.split('.').pop() || 'FILE').toUpperCase();
        var badgeText = att.isImage ? 'IMAGE' : ext;

        chip.innerHTML =
          '<div class="cts-attach-thumb">' + thumbHtml + '</div>' +
          '<div class="cts-attach-meta">' +
            '<span class="cts-attach-name" title="' + esc(att.name) + '">' + esc(att.name) + '</span>' +
            '<div class="cts-attach-sub-row">' +
              '<span class="cts-attach-badge">' + esc(badgeText) + '</span>' +
              '<span class="cts-attach-size">' + formatBytes(att.size) + '</span>' +
            '</div>' +
          '</div>' +
          '<button type="button" class="cts-attach-remove" data-remove-id="' + att.id + '" aria-label="Remove ' + esc(att.name) + '" title="Remove">' +
            '<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg>' +
          '</button>';

        // Wire handlers
        var removeBtn = chip.querySelector('.cts-attach-remove');
        if (removeBtn) {
          removeBtn.addEventListener('click', function (e) {
            e.preventDefault();
            e.stopPropagation();
            removeAttachment(att.id);
          });
        }
        var thumb = chip.querySelector('.cts-attach-thumb');
        if (thumb && att.isImage && att.dataUrl) {
          thumb.addEventListener('click', function (e) {
            e.preventDefault();
            e.stopPropagation();
            openImageLightbox(att.dataUrl, att.name);
          });
        }

        attachmentsTray.appendChild(chip);
      });
    });
  }

  function removeAttachment(id) {
    if (!attachmentsTray) return;
    var chip = attachmentsTray.querySelector('.cts-attach-chip[data-id="' + id + '"]');
    if (chip) {
      chip.classList.add('is-leaving');
      setTimeout(function () {
        currentAttachments = currentAttachments.filter(function (a) { return a.id !== id; });
        renderAttachments();
        if (composerEl) composerEl.classList.toggle('has-text', Boolean(composerInput && composerInput.value.trim()) || currentAttachments.length > 0);
      }, 240);
    } else {
      currentAttachments = currentAttachments.filter(function (a) { return a.id !== id; });
      renderAttachments();
      if (composerEl) composerEl.classList.toggle('has-text', Boolean(composerInput && composerInput.value.trim()) || currentAttachments.length > 0);
    }
  }

  function clearAttachments() {
    currentAttachments = [];
    if (attachmentsTray) {
      smoothResize(function () {
        attachmentsTray.innerHTML = '';
        attachmentsTray.hidden = true;
      });
    }
    if (composerEl) composerEl.classList.remove('has-attachments');
  }

  function addAttachmentFile(file) {
    if (!file) return false;
    var MAX_SIZE = 10 * 1024 * 1024; // 10MB
    if (file.size > MAX_SIZE) {
      var msg = 'File exceeds 10MB limit (' + (file.size / (1024 * 1024)).toFixed(1) + ' MB). Please select a smaller file.';
      if (typeof global.showToast === 'function') global.showToast(msg, 'warning');
      else alert(msg);
      return false;
    }

    var isImg = file.type.indexOf('image') !== -1 || /\.(png|jpe?g|gif|webp|svg|bmp)$/i.test(file.name);
    var isText = file.type.indexOf('text') !== -1 || /\.(txt|csv|json|md|js|py|html|css|ts|jsx|tsx|log)$/i.test(file.name);

    var cleanName = file.name;
    if (!cleanName || cleanName === 'image.png' || cleanName === 'blob') {
      var imgCount = currentAttachments.filter(function (a) { return a.isImage; }).length + 1;
      cleanName = 'Screenshot ' + imgCount + '.png';
    }

    var reader = new FileReader();
    if (isImg) {
      reader.onload = function () {
        var att = {
          id: 'cts_att_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7),
          file: file,
          name: cleanName,
          size: file.size,
          type: file.type || 'image/png',
          isImage: true,
          dataUrl: reader.result
        };
        currentAttachments.push(att);
        renderAttachments();
        if (composerEl) composerEl.classList.add('has-text');
        if (composerInput) composerInput.focus();
      };
      reader.readAsDataURL(file);
    } else if (isText) {
      reader.onload = function () {
        var att = {
          id: 'cts_att_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7),
          file: file,
          name: cleanName,
          size: file.size,
          type: file.type || 'text/plain',
          isImage: false,
          textContent: reader.result
        };
        currentAttachments.push(att);
        renderAttachments();
        if (composerEl) composerEl.classList.add('has-text');
        if (composerInput) composerInput.focus();
      };
      reader.readAsText(file);
    } else {
      // PDF or other binary file
      reader.onload = function () {
        var att = {
          id: 'cts_att_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7),
          file: file,
          name: cleanName,
          size: file.size,
          type: file.type || 'application/octet-stream',
          isImage: false,
          dataUrl: reader.result
        };
        currentAttachments.push(att);
        renderAttachments();
        if (composerEl) composerEl.classList.add('has-text');
        if (composerInput) composerInput.focus();
      };
      reader.readAsDataURL(file);
    }
    return true;
  }

  function wireComposer() {
    if (!composerInput || composerInput.__wired) return;
    composerInput.__wired = true;

    // Attach File / Screenshot button
    if (attachBtn) {
      attachBtn.addEventListener('click', function (e) {
        e.preventDefault();
        e.stopPropagation();
        if (fileInput) fileInput.click();
      });
    }

    // Hidden file input change
    if (fileInput) {
      fileInput.addEventListener('change', function (e) {
        var files = e.target.files;
        if (files && files.length) {
          for (var i = 0; i < files.length; i++) {
            addAttachmentFile(files[i]);
          }
        }
        fileInput.value = '';
      });
    }

    // Quick actions button
    var iconBtn = composerEl && composerEl.querySelector('.cts-composer-icon');
    if (iconBtn) {
      iconBtn.addEventListener('click', function (e) {
        e.preventDefault();
        e.stopPropagation();
        toggleQuickActions();
      });
    }

    composerInput.addEventListener('input', function () {
      autoGrowComposer();
      var hasVal = Boolean(composerInput.value.trim()) || currentAttachments.length > 0;
      if (composerEl) composerEl.classList.toggle('has-text', hasVal);
    });

    // Clipboard Paste Listener for Screenshots and Files (Plot / macOS style)
    function handlePaste(e) {
      var clip = e.clipboardData || (e.originalEvent && e.originalEvent.clipboardData);
      if (!clip) return;
      var items = clip.items;
      var files = clip.files;
      var handled = false;

      if (items && items.length) {
        for (var i = 0; i < items.length; i++) {
          var item = items[i];
          if (item.type && item.type.indexOf('image') !== -1) {
            var blob = item.getAsFile();
            if (blob) {
              e.preventDefault();
              handled = true;
              addAttachmentFile(blob);
            }
          } else if (item.kind === 'file') {
            var file = item.getAsFile();
            if (file) {
              e.preventDefault();
              handled = true;
              addAttachmentFile(file);
            }
          }
        }
      } else if (files && files.length) {
        for (var j = 0; j < files.length; j++) {
          handled = true;
          addAttachmentFile(files[j]);
        }
        if (handled) e.preventDefault();
      }

      if (handled) {
        if (composerEl) composerEl.classList.add('has-text');
      }
    }

    composerInput.addEventListener('paste', handlePaste);

    // Drag & drop support
    if (composerEl) {
      composerEl.addEventListener('dragover', function (e) {
        e.preventDefault();
        e.stopPropagation();
        composerEl.classList.add('cts-drop-target');
      });
      composerEl.addEventListener('dragleave', function (e) {
        e.preventDefault();
        e.stopPropagation();
        composerEl.classList.remove('cts-drop-target');
      });
      composerEl.addEventListener('drop', function (e) {
        e.preventDefault();
        e.stopPropagation();
        composerEl.classList.remove('cts-drop-target');
        var files = e.dataTransfer && e.dataTransfer.files;
        if (files && files.length) {
          for (var k = 0; k < files.length; k++) {
            addAttachmentFile(files[k]);
          }
        }
      });
    }

    composerInput.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        submitComposer();
      }
    });

    if (composerSendBtn) {
      composerSendBtn.addEventListener('click', function (e) {
        e.preventDefault();
        submitComposer();
      });
    }

    initRotatingPlaceholders();
  }

  function toggleQuickActions() {
    if (!composerEl) return;
    var existing = composerEl.querySelector('.cts-composer-actions');
    if (existing) {
      smoothResize(function () {
        existing.remove();
      });
      return;
    }
    smoothResize(function () {
      var menu = document.createElement('div');
      menu.className = 'cts-composer-actions';
      menu.innerHTML =
        '<div class="cts-action-pill" data-act="photos">Photos</div>' +
        '<div class="cts-action-pill" data-act="google">Search</div>' +
        '<div class="cts-action-pill" data-act="wiki">Wikipedia</div>' +
        '<div class="cts-action-pill" data-act="timer">Timer</div>' +
        '<div class="cts-action-pill" data-act="memory">Memory</div>' +
        '<div class="cts-action-pill" data-act="theme">Theme</div>';
      composerEl.insertBefore(menu, composerEl.firstChild);

      menu.addEventListener('click', function (ev) {
        var pill = ev.target.closest('.cts-action-pill');
        if (!pill) return;
        var act = pill.dataset.act;
        smoothResize(function () { menu.remove(); });
        if (act === 'photos') {
          composerInput.value = 'Photos of ';
          composerInput.focus();
          autoGrowComposer();
          if (composerEl) composerEl.classList.add('has-text');
        } else if (act === 'google') {
          composerInput.value = 'Search Google for ';
          composerInput.focus();
          autoGrowComposer();
          if (composerEl) composerEl.classList.add('has-text');
        } else if (act === 'wiki') {
          composerInput.value = 'Wikipedia ';
          composerInput.focus();
          autoGrowComposer();
          if (composerEl) composerEl.classList.add('has-text');
        } else if (act === 'timer') {
          composerInput.value = '5 minute ka timer lagao';
          submitComposer();
        } else if (act === 'memory') {
          composerInput.value = 'kya yaad rakha';
          submitComposer();
        } else if (act === 'theme') {
          composerInput.value = 'toggle theme';
          submitComposer();
        }
      });

      var iconBtn = composerEl.querySelector('.cts-composer-icon');
      var dismissPills = function (e2) {
        if (!menu.contains(e2.target) && (!iconBtn || !iconBtn.contains(e2.target))) {
          smoothResize(function () { menu.remove(); });
          document.removeEventListener('click', dismissPills);
        }
      };
      setTimeout(function () { document.addEventListener('click', dismissPills); }, 10);
    });
  }

  function autoGrowComposer() {
    if (!composerInput || !composerEl) return;
    var prevH = composerInput.offsetHeight;
    composerInput.style.height = 'auto';
    var scrollH = composerInput.scrollHeight;
    var clampedH = Math.min(124, Math.max(20, scrollH));
    composerInput.style.height = clampedH + 'px';
    // One line stays compact; the row only changes alignment once the
    // text genuinely wraps, so an empty composer is never tall for
    // no reason.
    composerEl.classList.toggle('is-multiline', clampedH > 30);
    composerEl.classList.toggle('is-empty', !(composerInput.value || '').trim() && !currentAttachments.length);

    if (Math.abs(clampedH - prevH) > 2 && el && el.classList.contains('is-open')) {
      smoothResize(function () {});
    }
  }

  function submitComposer() {
    if (!composerInput) return;
    var text = (composerInput.value || '').trim();
    var attachments = currentAttachments.slice();
    if (!text && !attachments.length) return;

    // Default intent text if only attachment was provided
    if (!text && attachments.length) {
      if (attachments[0].isImage) {
        text = 'Please inspect and analyze this screenshot in detail and explain what you observe.';
      } else {
        text = 'Please analyze this attached file: ' + attachments[0].name;
      }
    }

    composerInput.value = '';
    clearAttachments();
    autoGrowComposer();
    if (composerEl) composerEl.classList.remove('has-text');

    // Extract images and file snippets for AI
    var images = [];
    var fileSnippets = [];
    attachments.forEach(function (att) {
      if (att.isImage && att.dataUrl) {
        images.push(att.dataUrl);
      } else if (att.textContent) {
        fileSnippets.push('[Attached File: ' + att.name + ' (' + formatBytes(att.size) + ')]:\n```\n' + att.textContent.slice(0, 20000) + '\n```');
      }
    });

    var fullText = text;
    if (fileSnippets.length) {
      fullText += '\n\n' + fileSnippets.join('\n\n');
    }

    // Begin Clavis Task
    var taskId = null;
    if (global.ClavisTask && typeof global.ClavisTask.begin === 'function') {
      taskId = global.ClavisTask.begin(fullText, {
        source: 'composer',
        images: images,
        attachments: attachments
      });
      if (images.length) {
        global.ClavisTask.toolStart(taskId, 'image', 'Analyzing screenshot: ' + (attachments[0]?.name || 'image'));
      } else if (attachments.length) {
        global.ClavisTask.toolStart(taskId, 'file', 'Reading attached document: ' + (attachments[0]?.name || 'file'));
      }
    }

    // Route to ChatEngine
    if (global.ChatEngine && typeof global.ChatEngine.sendMessage === 'function') {
      global.ChatEngine.sendMessage(fullText, null, {
        images: images,
        attachments: attachments
      }).then(function (res) {
        // A 'generate' (leads) or 'candidate_search' action means a real
        // async search just got kicked off by ClavisTask's own wrapped
        // ChatEngine.sendMessage — it owns completing this task once the
        // real engine finishes. Completing it here too, with just the
        // template confirmation line, is the fake-instant-done bug: it
        // showed "done" with the wrong/default city while the real search
        // hadn't even started.
        var pending = res && res.action && (res.action.type === 'generate' || res.action.type === 'candidate_search');
        if (taskId && res && res.text && !pending) {
          global.ClavisTask.complete(taskId, {
            type: 'answer',
            text: res.text,
            summary: res.text.slice(0, 150)
          });
        }
      }).catch(function (err) {
        if (taskId) global.ClavisTask.fail(taskId, err);
      });
    } else {
      var mainInput = document.getElementById('chat-input') || document.getElementById('jarvis-input');
      if (mainInput) {
        mainInput.value = fullText;
        mainInput.dispatchEvent(new Event('input', { bubbles: true }));
      }
      if (typeof global.handleChatSend === 'function') {
        global.handleChatSend(fullText, { images: images, attachments: attachments });
      } else if (typeof global.handleJarvisSend === 'function') {
        global.handleJarvisSend();
      } else {
        var sendBtn = document.getElementById('chat-send-btn') || document.getElementById('jarvis-send-btn');
        if (sendBtn) sendBtn.click();
      }
    }
  }

  function initRotatingPlaceholders() {
    if (placeholderTimer) clearInterval(placeholderTimer);
    placeholderTimer = setInterval(function () {
      if (!composerInput || composerInput.value.trim() || document.activeElement === composerInput || currentAttachments.length > 0) return;
      placeholderIdx = (placeholderIdx + 1) % PLACEHOLDERS.length;
      composerInput.placeholder = PLACEHOLDERS[placeholderIdx];
    }, 5000);
  }

  /* Click-away and Esc close it. Both are pointerdown/keydown on the
     document, added once, and both ignore clicks that land inside. */
  function attachDismiss() {
    document.addEventListener('pointerdown', function (e) {
      if (!el || !el.classList.contains('is-open')) return;
      if (el.contains(e.target)) return;
      // Do not dismiss when clicking inside the main composer or floating pill dock
      if (e.target.closest && e.target.closest(
        '#tb-sneak-peek-btn, #jarvis-header-panel-toggle, #jarvis-input, .jarvis-luxury-composer, .jarvis-input-container, .claude-input-container, #clavis-floating-pill-dock'
      )) return;
      dismiss();
    }, true);

    document.addEventListener('keydown', function (e) {
      if (e.key !== 'Escape' || !el || !el.classList.contains('is-open')) return;
      dismiss();
    });
  }

  function dismiss() {
    userPinned = false;
    var t = Task.current();
    hiddenTaskId = t ? t.id : null;
    manuallyHidden = true;
    // Save current output state so re-open restores it
    if (bodyEl && bodyEl.innerHTML) {
      try {
        sessionStorage.setItem('cts_saved_html', bodyEl.innerHTML);
        sessionStorage.setItem('cts_saved_scroll', String(bodyEl.scrollTop || 0));
        sessionStorage.setItem('cts_saved_task', hiddenTaskId || '');
        sessionStorage.setItem('cts_saved_label', labelEl ? labelEl.textContent : 'Clavis');
      } catch (e) {}
    }
    hide();
  }

  /* ── Renderer registry ───────────────────────────────────── */
  var registry = {};
  function register(mode, fn) { registry[mode] = fn; }
  function rendererFor(task) {
    if (task.phase === 'idle' || task.mode === 'idle') return registry.idle;
    if (task.phase === 'failed') return registry.error;
    if (task.requiresApproval) return registry.approval;
    if (task.phase === 'completed') return registry.completed;
    return registry[task.mode] || registry.thinking;
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  /* ── Title hygiene ──────────────────────────────────────────
     Task titles are built from what sir typed or said — voice-typed
     Hinglish, typos and all ("Finding photos · neemaroli baba ki photo
     dihao"). The task model is another file, so the clean-up happens
     here, at render time: ClavisLuxe.cleanTitle when it is loaded (typo
     dictionary, "mujhe…batao" trimmed, names capitalised, a photo
     request titled by its subject), a whitespace/case pass when not.
     A resolver that learns the real name later — the photo search's
     "Neem Karoli Baba" — swaps it in with setTitle(id, title): the
     heading sharpens in place, the body is not repainted. */
  var titleOverrides = {};
  var cleanCache = {}, cleanCacheSize = 0;
  var paintedId = null;
  function basicClean(t) {
    var s = String(t || '').replace(/\s+/g, ' ').trim();
    return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
  }
  function cleanTitleText(t) {
    var s = String(t == null ? '' : t);
    if (!s) return s;
    if (Object.prototype.hasOwnProperty.call(cleanCache, s)) return cleanCache[s];
    var out = s;
    try {
      var L = global.ClavisLuxe;
      out = (L && typeof L.cleanTitle === 'function') ? (L.cleanTitle(s) || basicClean(s)) : basicClean(s);
    } catch (e) { out = basicClean(s) || s; }
    if (++cleanCacheSize > 300) { cleanCache = {}; cleanCacheSize = 0; }
    cleanCache[s] = out;
    return out;
  }
  function displayTitle(task) {
    if (task && titleOverrides[task.id]) return titleOverrides[task.id].title;
    return cleanTitleText((task && task.title) || 'Working');
  }
  function kickerFor(task) {
    var ov = task && titleOverrides[task.id];
    return ov && ov.kicker ? '<p class="cts-kicker">' + esc(ov.kicker) + '</p>' : '';
  }
  function unesc(s) {
    return String(s).replace(/&(amp|lt|gt|quot|#39);/g, function (m, k) {
      return { amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'" }[k];
    });
  }
  /* Bodies registered by other files (clavis-aurora.js's lead/contacts/
     data bodies) print task.title — or its "· <his words>" half — as is.
     The heading of whatever renderer ran is cleaned here, after the
     fact; a heading that is not his words is left alone. */
  function cleanHeading(html, task) {
    if (!html || !task || !task.title) return html;
    return html.replace(/<h2 class="cts-title">([^<]*)<\/h2>/, function (m, inner) {
      var text = unesc(inner).trim();
      var raw = String(task.title).replace(/\s+/g, ' ').trim();
      var cut = raw.indexOf(' · ');
      var sub = cut > -1 ? raw.slice(cut + 3).replace(/[…\s]+$/, '').trim() : null;
      var out = null;
      if (text === raw) out = displayTitle(task);
      else if (sub && text === sub) {
        var ov = titleOverrides[task.id];
        var c = ov ? ov.title : cleanTitleText(raw);
        var k = c.indexOf(' · ');
        out = k > -1 ? c.slice(k + 3) : c;
      }
      return out && out !== text ? '<h2 class="cts-title">' + esc(out) + '</h2>' : m;
    });
  }
  /* The live line can carry his words too ("Searching dehli hotels"). */
  function cleanLine(text) {
    try {
      var L = global.ClavisLuxe;
      return (L && typeof L.fixTypos === 'function') ? L.fixTypos(text) : text;
    } catch (e) { return text; }
  }
  function swapTitle(node, text) {
    if (!node || node.textContent === text) return;
    var reduced = false;
    try { reduced = global.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) {}
    if (reduced || typeof node.animate !== 'function') { node.textContent = text; return; }
    var out = node.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 110, easing: 'ease-out', fill: 'forwards' });
    out.onfinish = function () {
      node.textContent = text;
      node.animate([{ opacity: 0, filter: 'blur(3px)' }, { opacity: 1, filter: 'blur(0px)' }], { duration: 220, easing: 'cubic-bezier(0.2, 0.9, 0.1, 1)' });
      try { out.cancel(); } catch (e) {}
    };
  }

  /* shared pieces ------------------------------------------------ */
  /* overrideTitle is a renderer's own fixed wording ("Clavis", an
     approval's title) and is shown as given; the task's title — his
     words — goes through the clean-up above. */
  function titleBlock(task, overrideTitle) {
    var t = overrideTitle ? overrideTitle : displayTitle(task);
    return (overrideTitle ? '' : kickerFor(task)) + '<h2 class="cts-title">' + esc(t) + '</h2>';
  }
  /* The live line is the single most recent activity — a scrolling
     log of internal steps is exactly the dashboard feeling we are
     removing. One line, replaced in place. */
  function liveLine(task, fallback) {
    var last = task.events.length ? task.events[task.events.length - 1] : null;
    var text = (last && last.label) || task.subtitle || fallback || '';
    if (!text) return '';
    return '<p class="cts-live"><span class="cts-live-text">' + esc(cleanLine(text)) + '</span></p>';
  }
  function meter(task) {
    if (task.phase === 'completed' || task.phase === 'failed') return '';
    if (typeof task.progress === 'number') {
      return '<div class="cts-meter"><i style="width:' + Math.round(task.progress * 100) + '%"></i></div>';
    }
    // Unknown duration: a travelling hairline, never a fake percentage.
    return '<div class="cts-meter cts-meter-idle"><i></i></div>';
  }
  function stats(pairs) {
    var rows = pairs.filter(function (p) { return p[1] != null && p[1] !== ''; });
    if (!rows.length) return '';
    return '<dl class="cts-stats">' + rows.map(function (p) {
      return '<div><dt>' + esc(p[0]) + '</dt><dd>' + esc(p[1]) + '</dd></div>';
    }).join('') + '</dl>';
  }

  register('thinking', function (task) {
    return titleBlock(task, task.confidence < 0.4 && !titleOverrides[task.id] ? 'Clavis' : null) +
           liveLine(task, 'Thinking…') + meter(task);
  });

  register('search', function (task) {
    return titleBlock(task) +
           liveLine(task, 'Searching the web') +
           stats([['Sources', task.metrics.sources || null]]) +
           meter(task);
  });

  register('research', function (task) {
    // No "current step" stat: the live line above already IS the step,
    // and printing it twice is how a calm panel turns into a dashboard.
    return titleBlock(task) +
           liveLine(task, 'Reading sources') +
           stats([['Sources', task.metrics.sources || null]]) +
           meter(task);
  });

  register('code', function (task) {
    return titleBlock(task) +
           liveLine(task, 'Editing') +
           stats([['Files changed', task.metrics.files || null]]) +
           meter(task);
  });

  register('file', function (task) {
    return titleBlock(task) +
           liveLine(task, 'Reading the document') +
           stats([['Pages', task.metrics.pages || null]]) +
           meter(task);
  });

  register('writing', function (task) {
    var stage = task.events.some(function (e) { return e.type === 'writing'; }) ? 'Drafting' : 'Preparing';
    return titleBlock(task) + liveLine(task, stage) + meter(task);
  });

  register('create', function (task) {
    return titleBlock(task) + liveLine(task, 'Creating') +
           stats([['Files', task.metrics.files || null]]) + meter(task);
  });

  /* ── Idle State: Executive Greeting, 4-Stage Track & Agent Cards ─ */
  register('idle', function (task) {
    var hour = new Date().getHours();
    var greeting = 'Good evening';
    if (hour < 12) greeting = 'Good morning';
    else if (hour < 17) greeting = 'Good afternoon';

    return [
      '<div class="cts-task-banner">',
      '  <div class="cts-task-eyebrow">Autonomous Agent Pipeline</div>',
      '  <h3 class="cts-task-title">' + greeting + ', <em>Director</em></h3>',
      '  <p class="cts-task-subtitle">Clavis autonomous agents are synchronized &amp; standing by to execute.</p>',
      '  <div class="cts-pipeline-track">',
      '    <div class="cts-pipe-node-wrap done">',
      '      <div class="cts-pipe-node"></div>',
      '      <span class="cts-pipe-node-label">Plan</span>',
      '    </div>',
      '    <div class="cts-pipe-node-wrap active">',
      '      <div class="cts-pipe-node">2</div>',
      '      <span class="cts-pipe-node-label">Scrape</span>',
      '    </div>',
      '    <div class="cts-pipe-node-wrap">',
      '      <div class="cts-pipe-node">3</div>',
      '      <span class="cts-pipe-node-label">Enrich</span>',
      '    </div>',
      '    <div class="cts-pipe-node-wrap">',
      '      <div class="cts-pipe-node">4</div>',
      '      <span class="cts-pipe-node-label">Dispatch</span>',
      '    </div>',
      '  </div>',
      '</div>',
      '',
      '<div class="cts-agent-cards-stack">',
      '  <div class="cts-agent-card active-agent">',
      '    <div class="cts-agent-top">',
      '      <div class="cts-agent-meta">',
      '        <span class="cts-agent-icon">⚡</span>',
      '        <span class="cts-agent-name">Orchestrator Agent</span>',
      '      </div>',
      '      <span class="cts-agent-badge">Active</span>',
      '    </div>',
      '    <p class="cts-agent-log">Decomposes objectives into concurrent intelligence work streams.</p>',
      '    <div class="cts-agent-metrics">',
      '      <span class="cts-metric-chip">180ms latency</span>',
      '      <span class="cts-metric-chip">Ready</span>',
      '    </div>',
      '  </div>',
      '',
      '  <div class="cts-agent-card">',
      '    <div class="cts-agent-top">',
      '      <div class="cts-agent-meta">',
      '        <span class="cts-agent-icon">🌐</span>',
      '        <span class="cts-agent-name">Web Intelligence Agent</span>',
      '      </div>',
      '      <span class="cts-agent-badge">Ready</span>',
      '    </div>',
      '    <p class="cts-agent-log">Scans verified registries, Google Maps listings &amp; commercial hubs.</p>',
      '    <div class="cts-agent-metrics">',
      '      <span class="cts-metric-chip">Multi-source crawler</span>',
      '    </div>',
      '  </div>',
      '',
      '  <div class="cts-agent-card">',
      '    <div class="cts-agent-top">',
      '      <div class="cts-agent-meta">',
      '        <span class="cts-agent-icon">🧠</span>',
      '        <span class="cts-agent-name">Synthesis &amp; Scoring Agent</span>',
      '      </div>',
      '      <span class="cts-agent-badge">Standby</span>',
      '    </div>',
      '    <p class="cts-agent-log">Multi-point ICP compliance verification &amp; contact extraction.</p>',
      '    <div class="cts-agent-metrics">',
      '      <span class="cts-metric-chip">ICP Target &gt;90%</span>',
      '    </div>',
      '  </div>',
      '',
      '  <div class="cts-agent-card">',
      '    <div class="cts-agent-top">',
      '      <div class="cts-agent-meta">',
      '        <span class="cts-agent-icon">📬</span>',
      '        <span class="cts-agent-name">Dispatch &amp; Sync Agent</span>',
      '      </div>',
      '      <span class="cts-agent-badge">Standby</span>',
      '    </div>',
      '    <p class="cts-agent-log">Synchronizes validated entries into Leads Data Hub &amp; Excel sheets.</p>',
      '    <div class="cts-agent-metrics">',
      '      <span class="cts-metric-chip">Auto-export ready</span>',
      '    </div>',
      '  </div>',
      '</div>',
      '',
      '<div class="cts-prompt-section">',
      '  <div class="cts-prompt-heading">Suggested Actions</div>',
      '  <div class="cts-prompt-pills">',
      '    <button type="button" class="cts-prompt-pill" onclick="window.ClavisTaskSurface.fillComposer(\'Find high-growth SaaS companies in Bangalore with verified founder contacts\')">',
      '      <span>Find high-growth SaaS in Bangalore</span>',
      '      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><path d="M5 12h14M12 5l7 7-7 7"/></svg>',
      '    </button>',
      '    <button type="button" class="cts-prompt-pill" onclick="window.ClavisTaskSurface.fillComposer(\'Extract verified phone numbers for manufacturing exporters in Delhi NCR\')">',
      '      <span>Verified contacts for exporters in Delhi NCR</span>',
      '      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><path d="M5 12h14M12 5l7 7-7 7"/></svg>',
      '    </button>',
      '    <button type="button" class="cts-prompt-pill" onclick="window.ClavisTaskSurface.fillComposer(\'Top 50 healthcare clinics in Mumbai with phone and address\')">',
      '      <span>Top 50 healthcare clinics in Mumbai</span>',
      '      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><path d="M5 12h14M12 5l7 7-7 7"/></svg>',
      '    </button>',
      '    <button type="button" class="cts-prompt-pill" onclick="window.ClavisTaskSurface.fillComposer(\'Analyze talent pool for senior Python &amp; AI developers in India\')">',
      '      <span>Analyze Python &amp; AI developer talent pool</span>',
      '      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><path d="M5 12h14M12 5l7 7-7 7"/></svg>',
      '    </button>',
      '  </div>',
      '</div>'
    ].join('\n');
  });

  /* ── 4-Stage Live Pipeline & Table Preview ──────────────── */
  function pipeline(steps) {
    if (!Array.isArray(steps) || !steps.length) return '';
    var items = steps.map(function (s, idx) {
      var stateClass = s.state === 'done' ? 'is-done' : (s.state === 'active' ? 'is-active' : 'is-pending');
      // Done steps carry a plain dot, not a checkmark — the CSS draws it.
      var numContent = s.state === 'done' ? '' : String(idx + 1);
      return '<div class="cts-pipe-step ' + stateClass + '">' +
        '<div class="cts-pipe-num">' + numContent + '</div>' +
        '<div class="cts-pipe-info">' +
          '<span class="cts-pipe-title">' + esc(s.title) + '</span>' +
          (s.sub ? '<span class="cts-pipe-sub">' + esc(s.sub) + '</span>' : '') +
        '</div>' +
      '</div>';
    }).join('');
    return '<div class="cts-pipeline">' + items + '</div>';
  }

  function getLeadPipelineSteps(task) {
    var p = typeof task.progress === 'number' ? task.progress : 0.15;
    var sub = String(task.subtitle || '').toLowerCase();
    var m = task.metrics || {};

    var activeIdx = 0;
    if (task.phase === 'completed' || p >= 0.98) {
      activeIdx = 3;
    } else if (p >= 0.70 || /phone|mobile|landline|verif|contact/i.test(sub)) {
      activeIdx = 2;
    } else if (p >= 0.35 || /website|url|domain|scrape|email|site/i.test(sub)) {
      activeIdx = 1;
    } else {
      activeIdx = 0;
    }

    var step1Sub = m.leads ? (m.leads + ' businesses discovered') : (activeIdx === 0 ? (task.subtitle || 'Scanning local business listings') : 'Business discovery completed');
    var step2Sub = (m.emails || m.completeContacts) ? ((m.completeContacts || m.emails) + ' website profiles scraped') : (activeIdx === 1 ? (task.subtitle || 'Extracting official site emails & domains') : (activeIdx > 1 ? 'Website contact scraping completed' : 'Queued'));
    var step3Sub = m.phones ? (m.phones + ' verified phone numbers') : (activeIdx === 2 ? (task.subtitle || 'Separating mobile (+91 9...) vs landline') : (activeIdx > 2 ? 'Phone verification completed' : 'Queued'));
    var step4Sub = task.phase === 'completed' ? 'Excel sheet ready & downloaded' : (activeIdx === 3 ? 'Compiling verified rows into Excel' : 'Auto-export on completion');

    var states = ['pending', 'pending', 'pending', 'pending'];
    for (var i = 0; i < 4; i++) {
      if (task.phase === 'completed') states[i] = 'done';
      else if (i < activeIdx) states[i] = 'done';
      else if (i === activeIdx) states[i] = 'active';
      else states[i] = 'pending';
    }

    return [
      { title: 'Google Maps Discovery', sub: step1Sub, state: states[0] },
      { title: 'Website Contact Scrape', sub: step2Sub, state: states[1] },
      { title: 'Mobile & Landline Verification', sub: step3Sub, state: states[2] },
      { title: 'Excel Lead Sheet', sub: step4Sub, state: states[3] }
    ];
  }

  function getCandidatePipelineSteps(task) {
    var p = typeof task.progress === 'number' ? task.progress : 0.15;
    var sub = String(task.subtitle || '').toLowerCase();
    var m = task.metrics || {};

    var activeIdx = 0;
    if (task.phase === 'completed' || p >= 0.98) {
      activeIdx = 3;
    } else if (p >= 0.70 || /contact|phone|whatsapp|verif/i.test(sub)) {
      activeIdx = 2;
    } else if (p >= 0.35 || /profile|extract|snippet|candidate/i.test(sub)) {
      activeIdx = 1;
    } else {
      activeIdx = 0;
    }

    var step1Sub = m.sources ? (m.sources + ' portals active (Naukri, WorkIndia, Shine, Apna)') : (activeIdx === 0 ? (task.subtitle || 'Querying real job portals') : 'Job portals scanned');
    var step2Sub = m.candidates ? (m.candidates + ' candidates extracted') : (activeIdx === 1 ? (task.subtitle || 'Parsing profiles & job requirements') : (activeIdx > 1 ? 'Candidate profiles extracted' : 'Queued'));
    var step3Sub = (activeIdx === 2) ? (task.subtitle || 'Verifying phone numbers & availability') : (activeIdx > 2 ? 'Direct contact numbers verified' : 'Queued');
    var step4Sub = task.phase === 'completed' ? 'Database updated & Excel generated' : (activeIdx === 3 ? 'Compiling candidate records' : 'Auto-export on completion');

    var states = ['pending', 'pending', 'pending', 'pending'];
    for (var i = 0; i < 4; i++) {
      if (task.phase === 'completed') states[i] = 'done';
      else if (i < activeIdx) states[i] = 'done';
      else if (i === activeIdx) states[i] = 'active';
      else states[i] = 'pending';
    }

    return [
      { title: 'Job Portals Discovery', sub: step1Sub, state: states[0] },
      { title: 'Candidate Profile Extraction', sub: step2Sub, state: states[1] },
      { title: 'Direct Contact & Verification', sub: step3Sub, state: states[2] },
      { title: 'Candidate Sheet & Database', sub: step4Sub, state: states[3] }
    ];
  }

  function previewTable(rows, isCandidate) {
    if (!Array.isArray(rows) || !rows.length) return '';
    var sample = rows.slice(0, 3);
    var head1 = isCandidate ? 'Candidate' : 'Business';
    var head2 = 'Phone';
    var head3 = isCandidate ? 'Role' : 'City';

    var trs = sample.map(function (row) {
      var name = esc(row.name || row.business_name || row.title || row.candidate_name || 'Listing');
      var phone = row.phone || row.mobile || row.contact || '';
      var phoneHtml = phone
        ? '<span class="cts-badge-phone">' + esc(phone) + '</span>'
        : '<span style="color:var(--cts-faint);">—</span>';
      var extra = esc(isCandidate ? (row.role || row.source || row.city || '') : (row.city || row.industry || ''));
      return '<tr>' +
        '<td><strong>' + name + '</strong></td>' +
        '<td>' + phoneHtml + '</td>' +
        '<td>' + extra + '</td>' +
      '</tr>';
    }).join('');

    return '<div class="cts-preview-wrap">' +
      '<table class="cts-preview-table">' +
        '<thead><tr><th>' + head1 + '</th><th>' + head2 + '</th><th>' + head3 + '</th></tr></thead>' +
        '<tbody>' + trs + '</tbody>' +
      '</table>' +
    '</div>';
  }

  register('leads', function (task) {
    return titleBlock(task) +
           pipeline(getLeadPipelineSteps(task)) +
           stats([
             ['Leads', task.metrics.leads || null],
             ['Complete contacts', task.metrics.completeContacts || null],
             ['Sources', task.metrics.sources || null]
           ]) + meter(task);
  });

  register('contacts', function (task) {
    return titleBlock(task) +
           pipeline(getLeadPipelineSteps(task)) +
           stats([
             ['Contacts', task.metrics.contacts || null],
             ['Emails', task.metrics.emails || null],
             ['Phones', task.metrics.phones || null]
           ]) + meter(task);
  });

  register('dataset', function (task) {
    return titleBlock(task) +
           pipeline(getCandidatePipelineSteps(task)) +
           stats([
             ['Rows', task.metrics.rows || null],
             ['Candidates', task.metrics.candidates || null],
             ['Files', task.metrics.files || null]
           ]) + meter(task);
  });

  register('outreach', function (task) {
    return titleBlock(task) + liveLine(task, 'Preparing outreach') +
           stats([['Drafts', task.metrics.drafts || null], ['Recipients', task.metrics.recipients || null]]) + meter(task);
  });

  register('system', function (task) {
    return titleBlock(task) + liveLine(task, 'Preparing action') + meter(task);
  });

  register('approval', function (task) {
    var a = task.approval || {};
    return titleBlock(task, a.title || 'Waiting for your approval') +
           (a.detail ? '<p class="cts-note">' + esc(a.detail) + '</p>' : '');
  });

  /* Result-first: once it is done the panel stops being a monitor.
     The whole answer is shown — a one-sentence teaser that vanishes is
     worse than no panel at all. Long answers scroll inside the body. */
  register('completed', function (task) {
    var r = task.result || {};
    var m = task.metrics || {};
    var isCandidate = (task.mode === 'dataset' || !!m.candidates);
    var hasRows = Array.isArray(r.rows) && r.rows.length > 0;
    var previewHtml = hasRows ? previewTable(r.rows, isCandidate) : '';
    // When result.rows already gives us a real table, a model that ALSO
    // wrote one out in prose (common habit after a tool call) would
    // otherwise show up as a second, redundant table right below it.
    var textHtml = richText(r.text || r.summary || '', { suppressTables: hasRows });

    // A heading a resolver set (a photo search's real name) outlives the
    // run; everything else gets the generic headline that clavis-luxe.js
    // turns into his cleaned question.
    var ov = titleOverrides[task.id];
    return (ov ? kickerFor(task) : '') + '<h2 class="cts-title">' + esc(ov ? ov.title : completionHeadline(task)) + '</h2>' +
           previewHtml +
           textHtml +
           stats([
             ['Sources', m.sources || null],
             ['Files', m.files || null],
             ['Pages', m.pages || null],
             ['Leads', m.leads || null],
             ['Complete contacts', m.completeContacts || null],
             ['Candidates', m.candidates || null],
             ['Emails', m.emails || null],
             ['Phones', m.phones || null]
           ]);
  });

  /* Full-fidelity structured rendering for the floating window:
     Headers, code blocks, lists, bold/italics, and paragraphs. */
  function richText(text, opts) {
    var t = String(text || '').trim();
    if (!t) return '';
    var suppressTables = !!(opts && opts.suppressTables);

    // Handle code blocks first
    var codeBlocks = [];
    t = t.replace(/```([a-zA-Z0-9_-]*)\n([\s\S]*?)```/g, function (_, lang, code) {
      var id = '___CODE_' + codeBlocks.length + '___';
      codeBlocks.push('<pre class="cts-code-block"><div class="cts-code-header"><span>' + esc(lang || 'code') + '</span><button type="button" class="cts-code-copy" onclick="navigator.clipboard.writeText(this.closest(\'.cts-code-block\').querySelector(\'code\').innerText); this.textContent=\'Copied!\'; setTimeout(() => this.textContent=\'Copy\', 1500);">Copy</button></div><code>' + esc(code.trim()) + '</code></pre>');
      return id;
    });

    var blocks = t.split(/\n{2,}/);
    var html = blocks.map(function (block) {
      var trimmed = block.trim();
      var codeMatch = trimmed.match(/^___CODE_(\d+)___$/);
      if (codeMatch) {
        return codeBlocks[parseInt(codeMatch[1], 10)] || '';
      }

      var lines = block.split(/\n/).map(function (l) { return l.trim(); }).filter(Boolean);

      // A bare "---"/"___"/"===" line used as a section separator never
      // renders as raw text — that's the scrambled look. A hairline instead.
      if (lines.length === 1 && /^([-*_=])\1{2,}$/.test(lines[0])) {
        return '<hr class="cts-hr">';
      }

      // GFM-style pipe table (with or without outer pipes) — the exact
      // "scrambled | | |" shape leads/dataset answers come back in.
      if (lines.length >= 2 && lines[0].indexOf('|') !== -1) {
        var pipeTable = parsePipeTable(lines);
        if (pipeTable) return suppressTables ? '' : renderPipeTable(pipeTable);
      }

      if (lines.length === 1 && /^#{1,4}\s+/.test(lines[0])) {
        var hLevel = lines[0].match(/^(#{1,4})\s+/)[1].length;
        var hText = lines[0].replace(/^#{1,4}\s+/, '');
        return '<h' + (hLevel + 1) + ' class="cts-heading cts-h' + (hLevel + 1) + '">' + inline(hText) + '</h' + (hLevel + 1) + '>';
      }

      var bullets = lines.filter(function (l) { return /^([-*•]|\d+[.)])\s+/.test(l); });
      if (bullets.length && bullets.length === lines.length) {
        return '<ul class="cts-list">' + lines.map(function (l) {
          return '<li>' + inline(l.replace(/^([-*•]|\d+[.)])\s+/, '')) + '</li>';
        }).join('') + '</ul>';
      }
      return '<p class="cts-summary">' + inline(lines.join(' ')) + '</p>';
    }).join('');

    codeBlocks.forEach(function (cbHtml, idx) {
      html = html.replace('___CODE_' + idx + '___', cbHtml);
    });

    return '<div class="cts-result">' + html + '</div>';
  }
  function inline(s) {
    return esc(s)
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/\*([^*]+)\*/g, '<em>$1</em>');
  }

  /* GFM pipe-table detection: a header row, a "|---|---|" rule row, then
     data rows. Returns null (falls back to a plain paragraph) for
     anything that isn't actually a table, so stray "a | b" text is safe. */
  function parsePipeTable(lines) {
    if (lines.length < 2) return null;
    var sep = lines[1];
    if (!/^\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)+\|?$/.test(sep)) return null;
    function splitRow(line) {
      var s = line.trim();
      if (s.charAt(0) === '|') s = s.slice(1);
      if (s.charAt(s.length - 1) === '|') s = s.slice(0, -1);
      return s.split('|').map(function (c) { return c.trim(); });
    }
    var header = splitRow(lines[0]);
    if (header.length < 2) return null;
    var rows = [];
    for (var i = 2; i < lines.length; i++) {
      if (lines[i].indexOf('|') === -1) continue;
      rows.push(splitRow(lines[i]));
    }
    if (!rows.length) return null;
    return { header: header, rows: rows };
  }

  function renderPipeTable(tbl) {
    var thead = '<tr>' + tbl.header.map(function (h) {
      return '<th>' + inline(h) + '</th>';
    }).join('') + '</tr>';
    var tbody = tbl.rows.map(function (r) {
      return '<tr>' + tbl.header.map(function (_, i) {
        return '<td>' + (r[i] ? inline(r[i]) : '<span style="color:var(--cts-faint);">—</span>') + '</td>';
      }).join('') + '</tr>';
    }).join('');
    return '<div class="cts-preview-wrap"><table class="cts-preview-table"><thead>' + thead + '</thead><tbody>' + tbody + '</tbody></table></div>';
  }

  register('error', function (task) {
    var e = task.error || {};
    return '<h2 class="cts-title">' + esc(e.cancelled ? 'Stopped' : 'Could not finish') + '</h2>' +
           (e.message && !e.cancelled ? '<p class="cts-note">' + esc(e.message) + '</p>' : '');
  });

  function completionHeadline(task) {
    var m = task.metrics || {};
    switch (task.mode) {
      case 'search':   return m.sources ? 'Search complete' : 'Answered';
      case 'research': return 'Research complete';
      case 'code':     return m.files ? 'Changes ready' : 'Done';
      case 'file':     return 'Document analysed';
      case 'writing':  return 'Draft ready';
      case 'create':   return 'Created';
      case 'leads':    return m.leads ? 'Leads ready' : 'Lead search complete';
      case 'contacts': return 'Contacts ready';
      case 'dataset':  return m.candidates ? 'Candidates ready' : 'Dataset ready';
      case 'outreach': return 'Outreach ready';
      case 'system':   return 'Done';
      default:         return 'Answered';
    }
  }

  /* ── Density ─────────────────────────────────────────────── */
  function densityFor(task) {
    if (task.phase === 'idle' || task.mode === 'idle') return 'normal';
    if (task.phase === 'completed' && (task.result && (task.result.summary || (task.result.rows && task.result.rows.length)))) return 'expanded';
    if (task.requiresApproval) return 'normal';
    if (task.mode === 'leads' || task.mode === 'contacts' || task.mode === 'dataset') return 'normal';
    if (task.mode === 'thinking' && !task.events.length) return 'compact';
    if (task.mode === 'research' || task.mode === 'code' || task.mode === 'file') return 'normal';
    if (task.metrics.sources || task.metrics.files || task.metrics.pages || task.metrics.leads || task.metrics.candidates) return 'normal';
    return 'compact';
  }

  function headLabel(task) {
    if (task.phase === 'idle' || task.mode === 'idle') return 'Live Agent Pipeline';
    if (task.phase === 'failed') return task.error && task.error.cancelled ? 'Stopped' : 'Failed';
    if (task.requiresApproval) return 'Needs you';
    if (task.phase === 'completed') return 'Done';
    return 'Clavis';
  }

  function actionsFor(task) {
    if (task.phase === 'idle' || task.mode === 'idle') {
      return [{
        id: 'hub',
        label: 'View in Leads Hub',
        primary: true,
        run: function () {
          if (typeof window.switchTab === 'function') window.switchTab('leads');
        }
      }];
    }
    if (task.requiresApproval) {
      return [
        { id: 'approve', label: 'Approve', primary: true, run: function () { Task.resolveApproval(task.id, true); } },
        { id: 'deny', label: 'Cancel', run: function () { Task.resolveApproval(task.id, false); } }
      ];
    }
    if (task.phase === 'failed' && !(task.error && task.error.cancelled)) {
      var why = String((task.error && (task.error.message || task.error.code)) || '');
      // Rate limits and transient provider failures are recoverable; asking
      // for a new key there is misleading and does not match the error.
      // Only missing/rejected credentials need the key vault action.
      var rateLimited = /rate limit|too many requests|tokens? per minute|try again in|429/i.test(why);
    var keyProblem = !rateLimited && /no ai key|credential.*missing|missing.*credential|api key.*missing|missing.*api key|unauthor|invalid.*key|rejected.*key/i.test(why);
      if (keyProblem && global.ClavisKeyVaultUI) {
        return [
          { id: 'key', label: 'Add a key', primary: true, run: function () { global.ClavisKeyVaultUI.open(); } },
          { id: 'retry', label: 'Retry', run: function () { Task.retry(task.id); } }
        ];
      }
      return [{ id: 'retry', label: 'Retry', primary: true, run: function () { Task.retry(task.id); } }];
    }
    if (task.phase === 'completed') return task.actions || [];
    return [{ id: 'stop', label: 'Stop', run: function () { Task.cancel(task.id); } }];
  }

  /* ── Post-paint pass ──────────────────────────────────────
     innerHTML gives us structure; this gives it behaviour. Anything
     that can only be decided once the content is measurable in the
     document happens here — chiefly crossing off whatever just
     finished, which needs real text widths to draw over. */
  function decorate(root, task) {
    if (!root) return;
    try {
      if (global.ClavisPencil) {
        // One frame's grace so text has laid out and widths are real.
        requestAnimationFrame(function () {
          requestAnimationFrame(function () { global.ClavisPencil.scan(root); });
        });
      }
    } catch (e) {}

    // A scroll fade is an affordance for scrolling; it has no business
    // dimming the last line of a body that fits.
    try {
      root.classList.toggle('is-scrollable', root.scrollHeight > root.clientHeight + 1);
    } catch (e) {}
  }

  /* ── Paint ───────────────────────────────────────────────── */
  var pendingTask = null;

  function schedule(task) {
    pendingTask = task;
    if (frame) return;                       // coalesce a burst into one paint
    frame = requestAnimationFrame(function () { frame = 0; paint(pendingTask); });
  }

  function shouldSurfaceShow(task) {
    if (!task) return false;
    if (task.phase === 'idle' || task.mode === 'idle') return true;

    // Action requiring explicit user approval: show surface
    if (task.requiresApproval) return true;

    // The presenter (jarvis_ui.js) decided this turn has something to show.
    if (task.display === 'window') return true;

    // Voice and short spoken turns stay in the orb/audio channel. The store
    // emits again on completion; ignoring this choice here was reopening the
    // floating window after every spoken reply.
    if (task.display === 'voice' || task.source === 'voice') {
      return task.phase === 'failed';
    }

    // On completion: ALWAYS open floating surface with the answer + composer
    if (task.phase === 'completed') {
      return true;
    }

    // On failure: show error and retry action
    if (task.phase === 'failed') {
      return true;
    }

    // For voice queries: keep closed while understanding/working (Orb speaks/listens)
    if (task.source === 'voice') {
      return false;
    }

    // For text queries from composer: show while working/understanding
    if (task.phase === 'working' || task.phase === 'understanding') {
      return true;
    }

    return false;
  }

  function paint(task) {
    if (!task) { hide(); return; }
    // A voice-only turn leaves the window exactly as it is — open with the
    // last result, or closed. No flash open, no flash closed.
    if (task.display === 'voice' && !task.requiresApproval && !userPinned) return;
    build();
    // The user closed this one; keep it closed until a new task starts.
    if (manuallyHidden && task.id === hiddenTaskId) return;

    var wantsShow = userPinned || shouldSurfaceShow(task);
    var density = densityFor(task);
    var width = DENSITY[density];
    var html = cleanHeading((rendererFor(task) || registry.thinking)(task), task);
    var acts = actionsFor(task);
    var signature = task.id + '|' + task.phase + '|' + task.mode + '|' + density + '|' + html + '|' + acts.map(function (a) { return a.id; }).join(',');
    // Never closes itself: a turn that has nothing to show leaves whatever
    // sir is reading where it is. It closes on ×, Esc, a click outside,
    // or when he asks.
    if (signature === lastSignature) {
      if (wantsShow) show();
      return;
    }
    if (!wantsShow) return;
    lastSignature = signature;
    paintedId = task.id;

    el.dataset.phase = task.phase;
    el.dataset.mode = task.mode;
    el.dataset.density = density;
    labelEl.textContent = headLabel(task);

    /* Order matters: the content goes in BEFORE the reveal runs, so the
       open animation measures the real box. Painting first and animating
       second is what makes the Peek Tasks route and the task-completion
       route land on the same motion. */
    var wasClosed = !el.classList.contains('is-open');

    function applyContent() {
      bodyEl.innerHTML = html;
      footerEl.innerHTML = '';
      if (acts.length) {
        acts.forEach(function (a) {
          var b = document.createElement('button');
          b.type = 'button';
          b.className = 'cts-act' + (a.primary ? ' is-primary' : '');
          b.dataset.actionId = a.id || '';
          b.textContent = a.label;
          b.addEventListener('click', function () { try { a.run && a.run(); } catch (e) { console.warn(e); } });
          footerEl.appendChild(b);
        });
        footerEl.hidden = false;
      } else {
        footerEl.hidden = true;
      }
      decorate(bodyEl, task);
    }

    if (wasClosed) {
      // Opening: playOpen() already fades the body in as part of the
      // unfurl. Adding cts-enter on top would double the fade and make
      // the text arrive twice.
      applyContent();
      show();
    } else {
      // Already open: the content is being swapped underneath, so it
      // gets its own small entrance while the box glides to fit.
      smoothResize(applyContent);
      bodyEl.classList.remove('cts-enter');
      void bodyEl.offsetWidth;
      bodyEl.classList.add('cts-enter');
    }

    // No auto-dismiss. A result that disappears while you are still
    // reading it is worse than one that needs a click to close.
    // It closes on: the × , Esc, a click outside, or the next task.
  }

  function show() {
    if (!el) return;
    var wasClosed = !el.classList.contains('is-open');
    el.classList.add('is-open');
    el.removeAttribute('aria-hidden');
    if (!wasClosed) return;
    // Let the browser commit visibility before measuring, otherwise the
    // content reports zero and the window unfurls to nothing.
    requestAnimationFrame(function () { playOpen(); });
  }

  function hide() {
    if (!el || !el.classList.contains('is-open')) { finishHide(); return; }
    playClose(finishHide);
  }

  function finishHide() {
    if (!el) return;
    cancelGeo();
    el.classList.remove('is-open');
    el.setAttribute('aria-hidden', 'true');
    el.style.removeProperty('width');
    el.style.removeProperty('height');
    if (composerInput) {
      composerInput.value = '';
      if (composerEl) composerEl.classList.remove('has-text', 'is-multiline');
      composerInput.style.height = 'auto';
    }
    clearAttachments();
    try {
      if (document.activeElement && el.contains(document.activeElement)) {
        document.activeElement.blur();
      }
    } catch (e) {}
  }

  /* ── Drag ────────────────────────────────────────────────── */
  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

  function place(left, top) {
    if (!el) return;
    var r = el.getBoundingClientRect();
    el.classList.add('is-moved');
    var clampedL = clamp(left, MARGIN, Math.max(MARGIN, innerWidth - r.width - MARGIN));
    var clampedT = clamp(top, MARGIN, Math.max(MARGIN, innerHeight - r.height - MARGIN));
    el.style.left = clampedL + 'px';
    el.style.top = clampedT + 'px';
    el.style.right = 'auto';
  }

  function restorePosition() {
    var saved;
    try { saved = JSON.parse(localStorage.getItem(DRAG_KEY) || 'null'); } catch (e) { saved = null; }
    if (saved && typeof saved.left === 'number' && typeof saved.top === 'number') place(saved.left, saved.top);
  }

  function attachDrag() {
    var startX = 0, startY = 0, baseL = 0, baseT = 0, dragging = false;

    headerEl.addEventListener('pointerdown', function (e) {
      if (e.button !== 0 || e.target.closest('button')) return;
      var r = el.getBoundingClientRect();
      dragging = true; startX = e.clientX; startY = e.clientY; baseL = r.left; baseT = r.top;
      el.classList.add('is-dragging');
      place(baseL, baseT);
      headerEl.setPointerCapture(e.pointerId);
      e.preventDefault();
    });
    headerEl.addEventListener('pointermove', function (e) {
      if (!dragging) return;
      place(baseL + (e.clientX - startX), baseT + (e.clientY - startY));
    });
    function end(e) {
      if (!dragging) return;
      dragging = false;
      el.classList.remove('is-dragging');
      try { headerEl.releasePointerCapture(e.pointerId); } catch (err) {}
      try { localStorage.setItem(DRAG_KEY, JSON.stringify({ left: parseFloat(el.style.left), top: parseFloat(el.style.top) })); } catch (err) {}
    }
    headerEl.addEventListener('pointerup', end);
    headerEl.addEventListener('pointercancel', end);
    headerEl.addEventListener('dblclick', function () {
      el.classList.remove('is-moved');
      el.style.left = el.style.top = el.style.right = '';
      try { localStorage.removeItem(DRAG_KEY); } catch (e) {}
    });
    addEventListener('resize', function () {
      if (!el.classList.contains('is-moved')) return;
      place(parseFloat(el.style.left) || 0, parseFloat(el.style.top) || 0);
    });
  }

  /* ── Wire up ─────────────────────────────────────────────── */
  Task.Store.subscribe(function (task) {
    if (task && task.phase === 'understanding') {
      // New task starting: clear the manual hidden state so new task shows
      manuallyHidden = false;
      hiddenTaskId = null;
      // Clear saved state since a new task is now active
      try { sessionStorage.removeItem('cts_saved_html'); } catch(e) {}
    }
    schedule(task);
  });

  function signatureOf(task) {
    var density = densityFor(task);
    var html = cleanHeading((rendererFor(task) || registry.thinking)(task), task);
    var acts = actionsFor(task);
    return task.id + '|' + task.phase + '|' + task.mode + '|' + density + '|' + html + '|' + acts.map(function (a) { return a.id; }).join(',');
  }

  /* setTitle(id, title, { kicker }): a cleaner/canonical heading for one
     task (and optionally the small label above it, e.g. "Photos"). If
     that task is on screen and nothing else changed, only the heading
     text crossfades — no repaint, no re-entrance, no flicker. */
  function setTitle(id, title, opts) {
    var clean = String(title == null ? '' : title).replace(/\s+/g, ' ').trim();
    var kicker = opts && opts.kicker ? String(opts.kicker) : ((titleOverrides[id] && titleOverrides[id].kicker) || '');
    var prev = titleOverrides[id];
    if (!id || !clean || (prev && prev.title === clean && prev.kicker === kicker)) return false;
    var task = null;
    try { task = Task.Store && Task.Store.get ? Task.Store.get(id) : null; } catch (e) { task = null; }
    var before = null;
    try { before = task ? signatureOf(task) : null; } catch (e) { before = null; }
    titleOverrides[id] = { title: clean, kicker: kicker };
    var keys = Object.keys(titleOverrides);
    if (keys.length > 60) delete titleOverrides[keys[0]];
    if (!task || !el) return true;
    if (before && before === lastSignature && paintedId === id && el.classList.contains('is-open')) {
      var h = bodyEl && bodyEl.querySelector(':scope > h2.cts-title');
      var kick = bodyEl && bodyEl.querySelector(':scope > .cts-kicker');
      // clavis-luxe.js owns a finished answer's heading (data-lx) — leave it
      if (h && !h.dataset.lx) swapTitle(h, clean);
      if (kicker && kick && kick.textContent !== kicker && !(h && h.dataset.lx)) swapTitle(kick, kicker);
      try { lastSignature = signatureOf(task); } catch (e) {}
    } else {
      var cur = null;
      try { cur = Task.current(); } catch (e) {}
      if (cur && cur.id === id) schedule(cur);
    }
    return true;
  }

  global.ClavisTaskSurface = {
    register: register,
    registry: registry,
    setTitle: setTitle,
    titleFor: function (task) { return task ? displayTitle(task) : ''; },
    cleanTitle: cleanTitleText,
    // show({ user: true }) = sir asked for the window (pins it open for
    // voice tasks too); plain show() = the app revealing a result.
    show: function (opts) {
      build();
      manuallyHidden = false;
      hiddenTaskId = null;
      if (opts && opts.user) userPinned = true;
      var t = Task.current();
      if (t) {
        lastSignature = '';
        paint(t);
      } else {
        paint({ id: 'idle', phase: 'idle', mode: 'idle', events: [], metrics: {} });
      }
      show();
    },
    hide: function () { dismiss(); },
    openLightbox: openImageLightbox,
    fillComposer: function (text) {
      build();
      show();
      if (composerInput) {
        composerInput.value = text;
        autoGrowComposer();
        composerInput.focus();
        if (composerEl) composerEl.classList.add('has-text');
      }
    },
    submitFollowUp: function (text) {
      build();
      show();
      if (composerInput) {
        composerInput.value = text;
        autoGrowComposer();
        submitComposer();
      }
    },
    toggle: function () {
      build();
      if (el.classList.contains('is-open')) { dismiss(); return; }
      manuallyHidden = false; hiddenTaskId = null; userPinned = true;
      var t = Task.current();
      if (t) { lastSignature = ''; paint(t); }
      else {
        // Try to restore last saved output
        var savedHtml = '';
        var savedLabel = 'Clavis';
        var savedScroll = 0;
        try {
          savedHtml = sessionStorage.getItem('cts_saved_html') || '';
          savedLabel = sessionStorage.getItem('cts_saved_label') || 'Clavis';
          savedScroll = parseInt(sessionStorage.getItem('cts_saved_scroll') || '0', 10);
        } catch(e) {}
        if (savedHtml) {
          el.dataset.phase = 'completed';
          el.dataset.density = 'normal';
          labelEl.textContent = savedLabel;
          bodyEl.innerHTML = savedHtml;
          footerEl.hidden = true;
          decorate(bodyEl, null);
          // Leave width/height unset: playOpen() measures the restored
          // content so this route unfurls exactly like a fresh task.
          el.style.removeProperty('width');
          el.style.removeProperty('height');
          show();
          // Restore scroll position after paint
          requestAnimationFrame(function() {
            try { bodyEl.scrollTop = savedScroll; } catch(e) {}
          });
        } else {
          // Nothing running, nothing saved: paint rich idle executive pipeline
          paint({ id: 'idle', phase: 'idle', mode: 'idle', events: [], metrics: {} });
        }
      }
    },

    /* ── self-check: ClavisTaskSurface.demo() ──────────────── */
    demo: function () {
      var id = Task.begin('research the indian ev battery market in detail', { source: 'composer' });
      Task.toolStart(id, 'web_search');
      Task.toolResult(id, 'web_search', { success: true, sources: [1, 2, 3] });
      Task.toolStart(id, 'web_search');
      Task.toolResult(id, 'web_search', { success: true, sources: [1, 2] });
      setTimeout(function () {
        Task.complete(id, { type: 'sources', text: 'LFP is taking share.', summary: 'LFP chemistry is taking share as pack prices fall.' },
          [{ id: 'view', label: 'View results', run: function () {} }]);
      }, 1400);
      return 'watch the panel: research → complete';
    }
  };

  /* If a cached page still has the retired popover in the DOM, take it
     out — two floating task panels at once is not a state worth having. */
  (function killLegacy() {
    ['clavis-sneak-peek-window', 'clavis-sneak-peek-overlay'].forEach(function (id) {
      var n = document.getElementById(id);
      if (n && n.parentNode) n.parentNode.removeChild(n);
    });
  })();

  /* Old entry points in index.html called ClavisSneakPeek.toggle(). */
  global.ClavisSneakPeek = global.ClavisSneakPeek || {};
  global.ClavisSneakPeek.toggle = function () { global.ClavisTaskSurface.toggle(); };
  global.ClavisSneakPeek.open = function () { global.ClavisTaskSurface.show({ user: true }); };
  global.ClavisSneakPeek.close = function () { global.ClavisTaskSurface.hide(); };
})(window);
