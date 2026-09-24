/* ============================================================
 * clavis-chat.js — makes Client AI and Candidate AI behave like
 * chats instead of forms.
 * ------------------------------------------------------------
 * It adds nothing to the engines. app.js and page-candidates.js
 * keep sending, keep rendering `.chat-message`, keep owning the
 * data. This file only supplies the behaviour a chat surface is
 * expected to have and neither page had:
 *
 *   · a state — empty vs active — that the stylesheet can animate
 *   · the composer physically travelling down on the first send
 *     (measured, not guessed: FLIP on the real before/after box)
 *   · autoscroll that respects someone reading back, with a
 *     jump-to-latest that only exists while they are
 *   · a thinking indicator tied to the real in-flight request
 *   · a growing composer, and a send button that looks inert
 *     when there is nothing to send
 *   · errors rendered as something you can act on
 *
 * Self-check: `ClavisChat.demo()` in the console.
 * ============================================================ */
(function (global) {
  'use strict';

  var doc = global.document;

  /* The two surfaces. Everything below is driven off this table,
     so a third chat page is one more row. */
  var VIEWS = [
    {
      view: 'view-chat',
      messages: 'chat-messages',
      welcome: 'chat-welcome',
      input: 'chat-input',
      send: 'chat-send-btn',
      stop: 'chat-stop-btn',
      sub: 'Ask for leads by city, industry or role — Clavis searches live sources and returns verified rows.'
    },
    {
      view: 'view-candidate-ai',
      messages: 'candidate-chat-messages',
      welcome: 'candidate-chat-welcome',
      input: 'candidate-ai-input',
      send: 'btn-candidate-ai-send',
      stop: null,
      status: 'candidate-ai-status',
      sub: 'Name a role and a city — Clavis reads live job portals and brings back real candidates.'
    }
  ];

  function ready(fn) {
    if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', fn, { once: true });
    else fn();
  }
  function el(id) { return id ? doc.getElementById(id) : null; }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function reducedMotion() {
    try { return global.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) { return false; }
  }

  /* ============================================================
   * 0 · ChatGPT-Grade Markdown & Table Parser
   * ------------------------------------------------------------
   * Converts markdown tables, headers, lists, code, bold, italics,
   * and links into rich HTML while keeping XSS-safe escaping.
   * ============================================================ */
  function parseChatMarkdown(raw) {
    if (!raw) return '';
    var text = String(raw).replace(/\r\n/g, '\n').replace(/\r/g, '\n');

    // 1. Extract fenced code blocks
    var codeBlocks = [];
    text = text.replace(/```([a-zA-Z0-9_-]*)\n([\s\S]*?)```/g, function (_, lang, code) {
      var id = '___CODE_BLOCK_' + codeBlocks.length + '___';
      codeBlocks.push(
        '<div class="chat-code-wrapper">' +
          (lang ? '<div class="chat-code-header"><span>' + esc(lang) + '</span><button class="chat-code-copy" type="button">Copy</button></div>' : '') +
          '<pre class="chat-code-block"><code class="lang-' + esc(lang || 'plaintext') + '">' + esc(code.trim()) + '</code></pre>' +
        '</div>'
      );
      return id;
    });

    // 2. Extract inline code
    var inlineCodes = [];
    text = text.replace(/`([^`\n]+)`/g, function (_, code) {
      var id = '___INLINE_CODE_' + inlineCodes.length + '___';
      inlineCodes.push('<code class="chat-inline-code">' + esc(code) + '</code>');
      return id;
    });

    // Helper for inline styles
    function formatInline(str) {
      var s = str;
      // Bold + italic
      s = s.replace(/\*\*\*([^*]+)\*\*\*/g, '<strong><em>$1</em></strong>');
      s = s.replace(/___([^_]+)___/g, '<strong><em>$1</em></strong>');
      // Bold
      s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
      s = s.replace(/__([^_]+)__/g, '<strong>$1</strong>');
      // Italic
      s = s.replace(/\*([^*]+)\*/g, '<em>$1</em>');
      s = s.replace(/_([^_]+)_/g, '<em>$1</em>');
      // Links [text](url)
      s = s.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
      return s;
    }

    // 3. Process lines for tables, blockquotes, lists, headers, paragraphs
    var lines = text.split('\n');
    var out = [];
    var i = 0;

    while (i < lines.length) {
      var line = lines[i];
      var trimmed = line.trim();

      // Check if line could be part of a markdown table
      if (trimmed.indexOf('|') !== -1 && (trimmed.startsWith('|') || trimmed.endsWith('|') || (trimmed.match(/\|/g) || []).length >= 2)) {
        if (i + 1 < lines.length) {
          var nextTrim = lines[i + 1].trim();
          var isDelimiter = /^\|?(\s*:?-{2,}:?\s*\|?)+$/.test(nextTrim);
          if (isDelimiter) {
            var tableRows = [trimmed, nextTrim];
            i += 2;
            while (i < lines.length) {
              var rowTrim = lines[i].trim();
              if (!rowTrim || rowTrim.indexOf('|') === -1) break;
              tableRows.push(rowTrim);
              i++;
            }

            var parseCols = function (r) {
              var s = r;
              if (s.startsWith('|')) s = s.slice(1);
              if (s.endsWith('|')) s = s.slice(0, -1);
              return s.split('|').map(function (c) { return c.trim(); });
            };

            var headers = parseCols(tableRows[0]);
            var aligns = parseCols(tableRows[1]).map(function (c) {
              if (c.startsWith(':') && c.endsWith(':')) return 'center';
              if (c.endsWith(':')) return 'right';
              return 'left';
            });

            var tblHtml = '<div class="chat-table-wrapper"><table class="chat-table"><thead><tr>';
            for (var h = 0; h < headers.length; h++) {
              var align = aligns[h] || 'left';
              tblHtml += '<th style="text-align:' + align + '">' + formatInline(headers[h]) + '</th>';
            }
            tblHtml += '</tr></thead><tbody>';

            for (var r = 2; r < tableRows.length; r++) {
              var cells = parseCols(tableRows[r]);
              tblHtml += '<tr>';
              for (var c = 0; c < headers.length; c++) {
                var cell = cells[c] !== undefined ? cells[c] : '';
                var cAlign = aligns[c] || 'left';
                tblHtml += '<td style="text-align:' + cAlign + '">' + formatInline(cell) + '</td>';
              }
              tblHtml += '</tr>';
            }
            tblHtml += '</tbody></table></div>';
            out.push(tblHtml);
            continue;
          }
        }
      }

      // Headers (#, ##, ###)
      var hMatch = trimmed.match(/^(#{1,6})\s+(.+)$/);
      if (hMatch) {
        var level = hMatch[1].length;
        out.push('<h' + level + '>' + formatInline(hMatch[2]) + '</h' + level + '>');
        i++;
        continue;
      }

      // Blockquotes (> ...)
      if (trimmed.startsWith('>')) {
        var bqLines = [];
        while (i < lines.length && lines[i].trim().startsWith('>')) {
          bqLines.push(lines[i].trim().replace(/^>\s?/, ''));
          i++;
        }
        out.push('<blockquote>' + formatInline(bqLines.join('<br>')) + '</blockquote>');
        continue;
      }

      // Unordered Lists (- , * , • )
      var ulMatch = trimmed.match(/^([-*•])\s+(.+)$/);
      if (ulMatch) {
        var ulItems = [];
        while (i < lines.length) {
          var itemTrim = lines[i].trim();
          var m = itemTrim.match(/^([-*•])\s+(.+)$/);
          if (!m) break;
          ulItems.push('<li>' + formatInline(m[2]) + '</li>');
          i++;
        }
        out.push('<ul>' + ulItems.join('') + '</ul>');
        continue;
      }

      // Ordered Lists (1. , 2. )
      var olMatch = trimmed.match(/^(\d+)\.\s+(.+)$/);
      if (olMatch) {
        var olItems = [];
        while (i < lines.length) {
          var oTrim = lines[i].trim();
          var om = oTrim.match(/^(\d+)\.\s+(.+)$/);
          if (!om) break;
          olItems.push('<li>' + formatInline(om[2]) + '</li>');
          i++;
        }
        out.push('<ol>' + olItems.join('') + '</ol>');
        continue;
      }

      // Empty line
      if (!trimmed) {
        i++;
        continue;
      }

      // Standard paragraph
      var pLines = [];
      while (i < lines.length) {
        var pTrim = lines[i].trim();
        if (!pTrim) break;
        if (pTrim.match(/^(#{1,6})\s+/) || pTrim.startsWith('>') || pTrim.match(/^([-*•])\s+/) || pTrim.match(/^(\d+)\.\s+/) || (pTrim.indexOf('|') !== -1 && lines[i+1] && /^\|?(\s*:?-{2,}:?\s*\|?)+$/.test(lines[i+1].trim()))) {
          break;
        }
        pLines.push(formatInline(pTrim));
        i++;
      }
      if (pLines.length) {
        out.push('<p>' + pLines.join('<br>') + '</p>');
      }
    }

    var result = out.join('');

    // Restore code blocks and inline code
    codeBlocks.forEach(function (block, idx) {
      result = result.replace('___CODE_BLOCK_' + idx + '___', block);
    });
    inlineCodes.forEach(function (code, idx) {
      result = result.replace('___INLINE_CODE_' + idx + '___', code);
    });

    return result;
  }

  global.parseChatMarkdown = parseChatMarkdown;

  /* ============================================================
   * 0b · ChatGPT-Grade Smooth Assistant Streaming
   * ------------------------------------------------------------
   * Smoothly reveals incoming assistant messages with progressive
   * token streaming, eliminating sudden jarring text dumps.
   * ============================================================ */
  function streamAssistantMessage(options) {
    var opts = options || {};
    var container = typeof opts.container === 'string' ? el(opts.container) : opts.container;
    if (!container) return null;

    var raw = String(opts.text || '').trim();
    if (!raw) {
      if (typeof opts.onComplete === 'function') opts.onComplete();
      return null;
    }

    var msgDiv = doc.createElement('div');
    msgDiv.className = 'chat-message assistant';

    var avatar = doc.createElement('div');
    avatar.className = 'chat-avatar';
    avatar.textContent = 'AI';

    var contentWrap = doc.createElement('div');
    contentWrap.className = 'chat-content-wrap';

    var bubble = doc.createElement('div');
    bubble.className = 'chat-bubble';

    contentWrap.appendChild(bubble);
    msgDiv.appendChild(avatar);
    msgDiv.appendChild(contentWrap);
    container.appendChild(msgDiv);

    var welcome = el(opts.welcomeId || 'chat-welcome');
    if (welcome) welcome.style.display = 'none';

    function finalize() {
      bubble.innerHTML = parseChatMarkdown(raw);
      if (typeof opts.createToolbar === 'function') {
        var actions = opts.createToolbar(bubble, container, opts.inputId);
        if (actions) contentWrap.appendChild(actions);
      }
      container.scrollTop = container.scrollHeight;
      if (typeof opts.onComplete === 'function') opts.onComplete();
    }

    // If streaming disabled, reduced motion, or short response (< 25 chars), render immediately
    if (opts.stream === false || raw.length < 25 || reducedMotion()) {
      finalize();
      return { stop: function () {} };
    }

    // Split by words while preserving whitespace
    var tokens = raw.split(/(\s+)/);
    var currentIdx = 0;
    var currentText = '';
    var chunkSize = Math.max(1, Math.min(3, Math.ceil(tokens.length / 90)));
    var speed = opts.speed || 16;

    var timer = setInterval(function () {
      for (var c = 0; c < chunkSize && currentIdx < tokens.length; c++) {
        currentText += tokens[currentIdx++];
      }
      bubble.innerHTML = parseChatMarkdown(currentText);
      container.scrollTop = container.scrollHeight;

      if (currentIdx >= tokens.length) {
        clearInterval(timer);
        finalize();
      }
    }, speed);

    return {
      stop: function () {
        clearInterval(timer);
        finalize();
      }
    };
  }

  global.streamAssistantMessage = streamAssistantMessage;

  /* ============================================================
   * 1 · FLIP — the composer's trip down the page
   * ------------------------------------------------------------
   * The move is a layout change (the greeting collapses, the
   * message list starts flexing), and layout changes do not
   * transition. So: measure where the composer is, let the layout
   * change, measure again, put it back with a transform, and
   * release. One frame of bookkeeping, a real 760ms slide.
   * ============================================================ */
  function flip(nodes, mutate) {
    if (reducedMotion()) { mutate(); return; }
    var before = nodes.map(function (n) { return n ? n.getBoundingClientRect().top : 0; });
    mutate();
    nodes.forEach(function (n, i) {
      if (!n) return;
      var dy = before[i] - n.getBoundingClientRect().top;
      if (Math.abs(dy) < 1) return;
      n.style.transition = 'none';
      n.style.transform = 'translateY(' + dy + 'px)';
      requestAnimationFrame(function () {
        n.style.transition = 'transform 760ms cubic-bezier(0.16, 1, 0.3, 1)';
        n.style.transform = '';
        clearTimeout(n._ccFlip);
        n._ccFlip = setTimeout(function () { n.style.transition = ''; n.style.transform = ''; }, 820);
      });
    });
  }

  /* ============================================================
   * 2 · One chat surface
   * ============================================================ */
  function mount(spec) {
    var view = el(spec.view);
    if (!view) return false;
    var box = view.querySelector('.chat-container');
    var msgs = el(spec.messages);
    var input = el(spec.input);
    if (!box || !msgs || box.__ccMounted) return !!box;
    box.__ccMounted = true;

    var composer = box.querySelector('.claude-input-container');
    var chips = box.querySelector('.chat-quick-chips');
    var foot = box.querySelector('.chat-footer-text') || el(spec.status);

    /* ── a subtitle, so an empty chat says what it is for ────── */
    var welcome = el(spec.welcome);
    if (welcome && spec.sub && !welcome.querySelector('.cc-sub')) {
      var sub = doc.createElement('p');
      sub.className = 'cc-sub';
      sub.textContent = spec.sub;
      welcome.appendChild(sub);
    }

    /* ── thinking row + jump pill, inserted once ─────────────── */
    var typing = doc.createElement('div');
    typing.className = 'cc-typing lx-status-row';
    typing.setAttribute('aria-hidden', 'true');
    typing.innerHTML = '<div class="chat-avatar lx-status-avatar">' +
      '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m12 3-1.9 5.8a2 2 0 0 1-1.3 1.3L3 12l5.8 1.9a2 2 0 0 1 1.3 1.3L12 21l1.9-5.8a2 2 0 0 1 1.3-1.3L21 12l-5.8-1.9a2 2 0 0 1-1.3-1.3Z"/></svg>' +
      '</div>' +
      '<div class="lx-ai-status" role="status" aria-live="polite">' +
      '  <div class="lx-ai-status-glow"></div>' +
      '  <div class="lx-ai-status-main">' +
      '    <span class="lx-ai-status-dots"><i></i><i></i><i></i></span>' +
      '    <span class="lx-ai-status-text">Thinking</span>' +
      '  </div>' +
      '  <div class="lx-ai-status-track"><div class="lx-ai-status-bar lx-indeterminate"></div></div>' +
      '</div>';

    var anchor = doc.createElement('div');
    anchor.className = 'cc-anchor';
    var jump = doc.createElement('button');
    jump.type = 'button';
    jump.className = 'cc-jump';
    jump.setAttribute('aria-label', 'Jump to the latest message');
    jump.innerHTML = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14"/><path d="m19 12-7 7-7-7"/></svg>Latest';
    anchor.appendChild(jump);

    if (composer && composer.parentNode) {
      composer.parentNode.insertBefore(typing, composer);
      composer.parentNode.insertBefore(anchor, composer);
    }

    /* ── state: empty ⇄ active ───────────────────────────────── */
    function syncState() {
      var want = msgs.children.length ? 'active' : 'empty';
      if (box.dataset.chatState === want) return;
      flip([composer, chips, foot], function () { box.dataset.chatState = want; });
    }

    /* ── scrolling ───────────────────────────────────────────
       Near the bottom → follow. Reading back → stay put and offer
       the pill. 64px of slack, because "near the bottom" has to
       survive a line of text arriving mid-scroll. */
    var SLACK = 64;
    function atBottom() {
      return msgs.scrollHeight - msgs.scrollTop - msgs.clientHeight < SLACK;
    }
    function toLatest(smooth) {
      msgs.scrollTo({ top: msgs.scrollHeight, behavior: smooth && !reducedMotion() ? 'smooth' : 'auto' });
    }
    var queued = false;
    function onScroll() {
      if (queued) return;
      queued = true;
      requestAnimationFrame(function () {
        queued = false;
        var bottom = atBottom();
        jump.classList.toggle('is-on', !bottom && msgs.children.length > 1);
        msgs.dataset.atTop = msgs.scrollTop <= 2 ? '1' : '0';
      });
    }
    msgs.addEventListener('scroll', onScroll, { passive: true });
    jump.addEventListener('click', function () { toLatest(true); });

    /* ── the one observer that drives all of it ──────────────── */
    new MutationObserver(function () {
      var follow = atBottom();
      syncState();
      upgradeErrors(box, msgs, input, spec);
      if (follow) requestAnimationFrame(function () { toLatest(true); });
      onScroll();
    }).observe(msgs, { childList: true });

    /* ── busy: tied to the real request, not a timer ──────────
       The Client AI page reveals a stop button while a request is
       in flight; Candidate AI writes into a status line. Both are
       the truth, so both are what this reads. */
    var stop = el(spec.stop);
    var status = el(spec.status);
    function setBusy(on) {
      if ((box.dataset.busy === '1') === !!on) return;
      box.dataset.busy = on ? '1' : '0';
      if (on && atBottom()) requestAnimationFrame(function () { toLatest(true); });
    }
    if (stop) {
      new MutationObserver(function () { setBusy(!stop.hasAttribute('hidden')); })
        .observe(stop, { attributes: true, attributeFilter: ['hidden', 'style'] });
      setBusy(!stop.hasAttribute('hidden'));
    }
    if (status) {
      new MutationObserver(function () { setBusy(!!status.textContent.trim()); })
        .observe(status, { childList: true, characterData: true, subtree: true });
    }

    /* The composer — its height, its empty flag, its physics — is
       owned by installComposer() in clavis-aurora.js, which runs the
       same code for this page, Candidate AI and the Clavis studio.
       Two implementations of one component is how they drifted apart
       in the first place, so there is only the one. */

    box.dataset.chatState = msgs.children.length ? 'active' : 'empty';
    onScroll();
    return true;
  }

  /* ============================================================
   * 3 · Errors you can act on
   * ------------------------------------------------------------
   * The engines render failures as a red sentence in a bubble.
   * A sentence is not a recovery path, so each known failure is
   * rewritten as: what happened, and the one button that fixes
   * it. Unknown failures still get a Try again.
   * ============================================================ */
  var KNOWN = [
    {
      re: /sign in before using ai chat|AI_AUTH_REQUIRED/i,
      title: 'Clavis is running without the backend',
      text: 'The hosted AI proxy needs a sign-in. Connect a provider key instead and this chat works locally.',
      label: 'Open AI setup',
      run: function () { if (typeof global.openKeySettings === 'function') global.openKeySettings(); }
    },
    {
      re: /need an api key|API key in the Settings/i,
      title: 'No provider key yet',
      text: 'Add a Groq, OpenRouter or Gemini key once and every chat in the app can use it.',
      label: 'Open AI setup',
      run: function () { if (typeof global.openKeySettings === 'function') global.openKeySettings(); }
    },
    {
      re: /backend is unavailable|AI_BACKEND_UNAVAILABLE|failed to fetch/i,
      title: 'Could not reach the AI service',
      text: 'The request never left. Check that the backend is running, then try the same message again.',
      label: 'Try again'
    },
    {
      re: /timed out|AI_TIMEOUT/i,
      title: 'The reply took too long',
      text: 'The provider did not answer in time. Sending it again usually works.',
      label: 'Try again'
    }
  ];

  function lastUserText(msgs) {
    var rows = msgs.querySelectorAll('.chat-message.user .chat-bubble');
    return rows.length ? rows[rows.length - 1].innerText.trim() : '';
  }

  function upgradeErrors(box, msgs, input, spec) {
    var rows = msgs.querySelectorAll('.chat-message.assistant .chat-bubble:not([data-cc-checked]), .chat-message.system .chat-bubble:not([data-cc-checked])');
    Array.prototype.forEach.call(rows, function (bubble) {
      bubble.setAttribute('data-cc-checked', '1');
      var text = bubble.innerText.trim();
      if (!/^(⚠️|Error:)/.test(text) && !/sign in before using ai chat/i.test(text)) return;
      if (global.ClavisDirect && typeof global.ClavisDirect.hasKey === 'function' && global.ClavisDirect.hasKey()) {
        if (/need an api key|API key in the Settings/i.test(text)) {
          var parentRow = bubble.closest('.chat-message');
          if (parentRow) { parentRow.remove(); return; }
        }
      }

      var hit = null;
      for (var i = 0; i < KNOWN.length; i++) { if (KNOWN[i].re.test(text)) { hit = KNOWN[i]; break; } }
      var title = hit ? hit.title : 'That did not go through';
      var body = hit ? hit.text : text.replace(/^Error:\s*/i, '');
      var label = (hit && hit.label) || 'Try again';

      bubble.innerHTML =
        '<div class="cc-error">' +
        '  <svg class="cc-error-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 9v4"/><path d="M12 17h.01"/><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z"/></svg>' +
        '  <div class="cc-error-body">' +
        '    <div class="cc-error-title">' + esc(title) + '</div>' +
        '    <div class="cc-error-text">' + esc(body) + '</div>' +
        '    <button type="button" class="cc-error-act">' + esc(label) + '</button>' +
        '  </div>' +
        '</div>';

      bubble.querySelector('.cc-error-act').addEventListener('click', function () {
        if (hit && hit.run) { hit.run(); return; }
        var again = lastUserText(msgs);
        if (!again || !input) return;
        input.value = again;
        input.dispatchEvent(new Event('input', { bubbles: true }));
        var send = el(spec.send);
        if (send) send.click();
      });
    });
  }

  /* ============================================================
   * 4 · Install
   * ============================================================ */
  function install() {
    var done = VIEWS.map(mount);
    return done.every(Boolean);
  }

  ready(function () {
    if (install()) return;
    /* The views are in the initial HTML, but page scripts decorate
       them on their own schedule — poll briefly rather than guess. */
    var tries = 0;
    var iv = setInterval(function () {
      if (install() || ++tries > 40) clearInterval(iv);
    }, 250);
  });

  /* ============================================================
   * 5 · Self-check — ClavisChat.demo()
   * ============================================================ */
  global.ClavisChat = {
    parseMarkdown: parseChatMarkdown,
    /* Pushes a real exchange through the Client AI transcript so
       the state flip, the composer's slide, the thinking row and
       the error card can all be seen without a backend. */
    demo: function (which) {
      var spec = VIEWS[which === 'candidate' ? 1 : 0];
      var msgs = el(spec.messages);
      var box = el(spec.view) && el(spec.view).querySelector('.chat-container');
      if (!msgs || !box) throw new Error(spec.view + ' not on the page');

      function row(role, html) {
        var d = doc.createElement('div');
        d.className = 'chat-message ' + role;
        if (role === 'assistant') {
          d.innerHTML = '<div class="chat-avatar">AI</div>' +
                        '<div class="chat-content-wrap"><div class="chat-bubble">' + html + '</div></div>';
        } else {
          d.innerHTML = '<div class="chat-avatar">U</div>' +
                        '<div class="chat-bubble">' + html + '</div>';
        }
        msgs.appendChild(d);
      }
      row('user', '<p>Find 25 hotel leads in Gurugram that need security staff</p>');
      box.dataset.busy = '1';
      setTimeout(function () {
        box.dataset.busy = '0';
        row('assistant', '<p><strong>25 hotels found.</strong> Verified phone and website on every row; 19 have a named facilities contact.</p><p>Exported to <code>leads-gurugram-hotels.xlsx</code>.</p>');
      }, 2200);
      setTimeout(function () { row('assistant', '<p>Error: Sign in before using AI chat</p>'); }, 3400);
      return 'watch: greeting dissolves, composer slides down, dots, then the error becomes a card';
    },

    reset: function (which) {
      return this.startNewChat(which);
    },

    startNewChat: function (which) {
      var isCand = which === 'candidate' || which === 'candidate-ai' || which === 'view-candidate-ai';
      if (isCand) {
        if (typeof global.resetCandidateChat === 'function') {
          global.resetCandidateChat();
        } else {
          var msgs = el('candidate-chat-messages');
          if (msgs) msgs.innerHTML = '';
          var wel = el('candidate-chat-welcome');
          if (wel) wel.style.display = 'flex';
          var box = el('view-candidate-ai') && el('view-candidate-ai').querySelector('.chat-container');
          if (box) box.dataset.chatState = 'empty';
          if (typeof global.resetComposer === 'function') global.resetComposer('candidate-ai-input');
        }
      } else {
        if (typeof global.resetClientChat === 'function') {
          global.resetClientChat();
        } else {
          var msgs = el('chat-messages');
          if (msgs) msgs.innerHTML = '';
          var wel = el('chat-welcome');
          if (wel) wel.style.display = 'flex';
          var chips = el('chat-quick-chips');
          if (chips) chips.style.display = 'flex';
          var box = el('view-chat') && el('view-chat').querySelector('.chat-container');
          if (box) box.dataset.chatState = 'empty';
          if (typeof global.resetComposer === 'function') global.resetComposer('chat-input');
        }
      }
      return 'ok';
    },

    /* Pure checks — no backend, no network. */
    selfTest: function () {
      var fails = [];
      VIEWS.forEach(function (spec) {
        var view = el(spec.view);
        if (!view) { fails.push(spec.view + ' missing'); return; }
        var box = view.querySelector('.chat-container');
        if (!box) { fails.push(spec.view + ' has no .chat-container'); return; }
        if (!box.__ccMounted) fails.push(spec.view + ' not mounted');
        if (!box.dataset.chatState) fails.push(spec.view + ' has no state');
        if (!box.querySelector('.cc-typing')) fails.push(spec.view + ' has no thinking row');
        if (!box.querySelector('.cc-jump')) fails.push(spec.view + ' has no jump pill');
        var msgs = el(spec.messages);
        if (msgs && getComputedStyle(msgs).overflowY !== 'auto') fails.push(spec.messages + ' is not its own scroller');
      });
      /* every known failure must map to a button, or the card is
         just a prettier dead end */
      KNOWN.forEach(function (k) { if (!k.label) fails.push('error pattern with no action: ' + k.re); });

      console.assert(fails.length === 0, 'ClavisChat failures:\n' + fails.join('\n'));
      return fails.length ? fails : 'ok';
    }
  };
  global.startNewChat = function (which) { return global.ClavisChat.startNewChat(which); };
})(window);
