/**
 * ============================================================
 *  CLAVIS SUGGESTIONS (clavis-suggestions.js)
 *  Contextual quick suggestion chips when the composer is empty.
 *  Centered above the composer box; dismisses when typing.
 * ============================================================
 */
'use strict';

(() => {
  const SUGGESTIONS = [
    { icon: '🚀', label: '20 Leads Gurugram', text: '20 verified leads nikalo Gurugram mein' },
    { icon: '🏨', label: 'Hotel Leads Mumbai', text: '15 hotel leads Mumbai mein dhundho' },
    { icon: '🏥', label: 'Hospital Leads Delhi', text: '20 hospital leads Delhi mein nikalo' },
    { icon: '💻', label: 'IT Leads Bangalore', text: 'IT company leads Bangalore mein dhundho' },
    { icon: '📊', label: 'Dashboard', text: 'Dashboard dikhao' },
    { icon: '📥', label: 'CSV Export', text: 'Saari leads CSV export karo' },
    { icon: '📋', label: 'Saari Leads Dikhao', text: 'Saari leads table dikhao' },
    { icon: '🏭', label: 'Factory Leads Pune', text: 'Factory aur manufacturing leads Pune' }
  ];

  let wrap = null;
  let hideTimer = null;
  let installed = false;

  function buildWrap() {
    if (wrap && wrap.isConnected) return wrap;
    wrap = document.createElement('div');
    wrap.className = 'clavis-suggestions-wrap';
    wrap.setAttribute('aria-label', 'Suggested prompts');

    wrap.innerHTML =
      '<div class="clavis-suggestions-label">' +
      '  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275L12 3Z"/></svg>' +
      '  <span>Suggestions</span>' +
      '</div>' +
      '<div class="clavis-suggestion-chips"></div>';

    const chips = wrap.querySelector('.clavis-suggestion-chips');
    const shown = pickRandom(SUGGESTIONS, 4);
    shown.forEach((s, i) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'clavis-suggestion-chip';
      btn.style.animationDelay = (i * 50) + 'ms';
      btn.innerHTML = `<span class="clavis-suggestion-chip-icon">${s.icon}</span><span>${escapeHtml(s.label)}</span>`;
      btn.title = s.text;
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        fillComposer(s.text);
      });
      chips.appendChild(btn);
    });
    return wrap;
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
  }

  function pickRandom(arr, n) {
    const a = arr.slice();
    const out = [];
    while (out.length < n && a.length) {
      out.push(a.splice(Math.floor(Math.random() * a.length), 1)[0]);
    }
    return out;
  }

  function fillComposer(text) {
    const input = document.querySelector('#jarvis-input, #home-chat-input, .jarvis-luxury-textarea');
    if (!input) return;
    input.value = text;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.focus();
    hide();
  }

  function show() {
    clearTimeout(hideTimer);
    const input = document.querySelector('#jarvis-input');
    if (!input) return;

    // Check if view-jarvis is active
    const jarvisView = document.getElementById('view-jarvis');
    if (jarvisView && !jarvisView.classList.contains('active')) return;

    // If chat conversation already has messages, don't obstruct the message flow
    const msgs = document.getElementById('jarvis-messages');
    if (msgs && msgs.children.length > 0) {
      hide();
      return;
    }

    // Find the composer container
    const container = input.closest('.jarvis-input-container, .jarvis-luxury-composer');
    if (!container) return;

    const w = buildWrap();
    if (!w.isConnected) {
      container.parentElement.insertBefore(w, container);
    }
    requestAnimationFrame(() => {
      w.classList.add('is-visible');
    });
  }

  function hide() {
    if (!wrap) return;
    wrap.classList.remove('is-visible');
  }

  function onInput(e) {
    const input = e.target;
    if (!input || input.id !== 'jarvis-input') return;
    clearTimeout(hideTimer);
    if (!input.value.trim()) {
      hideTimer = setTimeout(show, 180);
    } else {
      hide();
    }
  }

  function onFocus(e) {
    const input = e.target;
    if (!input || input.id !== 'jarvis-input') return;
    if (!input.value.trim()) {
      show();
    }
  }

  function install() {
    if (installed) return;
    installed = true;
    document.addEventListener('input', onInput, { passive: true });
    document.addEventListener('focusin', onFocus, { passive: true });

    // Initial check
    setTimeout(() => {
      const input = document.querySelector('#jarvis-input');
      if (input && !input.value.trim()) {
        show();
      }
    }, 400);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', install, { once: true });
  } else {
    install();
  }

  // Also listen for view changes to Clavis tab
  document.addEventListener('click', (e) => {
    if (e.target.closest && e.target.closest('[data-view="jarvis"], [data-view="view-jarvis"], [href*="jarvis"]')) {
      setTimeout(show, 300);
    }
  });

  window.ClavisSuggestions = { show, hide, install };
})();
