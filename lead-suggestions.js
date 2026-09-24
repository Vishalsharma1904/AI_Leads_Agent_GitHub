'use strict';

/* Rotating, typewritten empty-state prompts. This only changes the native
   placeholder; it never writes to the textarea value or alters send logic. */
(function LeadSuggestionTypewriter() {
  const SUGGESTIONS = [
    'Find companies needing cooks, nurses, drivers…',
    'Find hotels hiring chefs in Gurugram with public contacts…',
    'Show hospitals needing nurses in Delhi with phone and email…',
    'Find companies hiring delivery executives in Mumbai…',
    'Search IT parks needing housekeeping teams in Noida…',
    'Find manufacturers hiring electricians in Ahmedabad…',
    'Show verified companies requiring sales executives this month…'
  ];

  function attach(textarea) {
    if (!textarea || textarea.dataset.suggestionWriter === 'true') return;
    textarea.dataset.suggestionWriter = 'true';

    const original = textarea.getAttribute('placeholder') || SUGGESTIONS[0];
    let suggestionIndex = Math.max(0, SUGGESTIONS.indexOf(original));
    let timer = 0;
    let generation = 0;
    let active = true;

    const stop = () => {
      generation++;
      clearTimeout(timer);
      timer = 0;
    };

    const type = (text, token, pos = 0) => {
      if (!active || token !== generation || textarea.value) return;
      textarea.setAttribute('placeholder', text.slice(0, pos));
      if (pos < text.length) {
        timer = window.setTimeout(() => type(text, token, pos + 1), 32);
      } else {
        timer = window.setTimeout(() => erase(text, token, text.length), 2200);
      }
    };

    const erase = (text, token, pos) => {
      if (!active || token !== generation || textarea.value) return;
      textarea.setAttribute('placeholder', text.slice(0, Math.max(0, pos)));
      if (pos > 0) {
        timer = window.setTimeout(() => erase(text, token, pos - 1), 10);
      } else {
        suggestionIndex = (suggestionIndex + 1) % SUGGESTIONS.length;
        timer = window.setTimeout(() => type(SUGGESTIONS[suggestionIndex], token), 260);
      }
    };

    const restart = () => {
      stop();
      if (textarea.value) {
        textarea.setAttribute('placeholder', '');
        return;
      }
      const token = ++generation;
      type(SUGGESTIONS[suggestionIndex], token);
    };

    textarea.addEventListener('input', () => {
      if (textarea.value) {
        active = false;
        stop();
        textarea.setAttribute('placeholder', '');
      } else {
        active = true;
        restart();
      }
    });
    textarea.addEventListener('focus', () => { active = true; restart(); });
    textarea.addEventListener('blur', () => { active = true; restart(); });
    restart();
  }

  function boot() {
    ['chat-input', 'candidate-ai-input'].forEach(id => attach(document.getElementById(id)));
    attachClientSourcePicker();
  }

  function attachClientSourcePicker() {
    const picker = document.querySelector('#view-chat .client-source-picker');
    const trigger = document.getElementById('client-source-menu-btn');
    const menu = document.getElementById('client-source-chips');
    const hidden = document.getElementById('client-ai-sources');
    const count = document.getElementById('client-source-count');
    if (!picker || !trigger || !menu || !hidden || picker.dataset.sourceBound === 'true') return;
    picker.dataset.sourceBound = 'true';
    const sync = () => {
      const selected = [...menu.querySelectorAll('[data-client-source].active')].map(el => el.dataset.clientSource);
      hidden.value = selected.join(',');
      if (count) count.textContent = String(selected.length);
      trigger.setAttribute('aria-label', `${selected.length} live source${selected.length === 1 ? '' : 's'} selected`);
    };
    trigger.addEventListener('click', event => {
      event.stopPropagation();
      const open = menu.hidden;
      menu.hidden = !open;
      picker.classList.toggle('is-open', open);
      trigger.setAttribute('aria-expanded', String(open));
    });
    menu.querySelectorAll('[data-client-source]').forEach(chip => chip.addEventListener('click', () => {
      const active = chip.classList.toggle('active');
      chip.setAttribute('aria-pressed', String(active));
      if (!menu.querySelector('[data-client-source].active')) {
        chip.classList.add('active');
        chip.setAttribute('aria-pressed', 'true');
      }
      sync();
    }));
    menu.addEventListener('click', event => event.stopPropagation());
    document.addEventListener('click', event => {
      if (!picker.contains(event.target)) {
        menu.hidden = true;
        picker.classList.remove('is-open');
        trigger.setAttribute('aria-expanded', 'false');
      }
    });
    document.addEventListener('keydown', event => {
      if (event.key === 'Escape') {
        menu.hidden = true;
        picker.classList.remove('is-open');
        trigger.setAttribute('aria-expanded', 'false');
      }
    });
    sync();
  }

  document.addEventListener('DOMContentLoaded', boot);
  document.addEventListener('nexus:viewchange', boot);
})();
