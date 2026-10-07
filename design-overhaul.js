/** Core theme, navigation and number animation controller. */
'use strict';

(function DesignCore() {
  let themeTimer = null;
  function applyTheme(theme, options = {}) {
    const next = theme === 'light' ? 'light' : 'dark';
    const html = document.documentElement;

    clearTimeout(themeTimer);
    // PERF: switch instantly with all transitions + backdrop-filter frozen (perf-fix.css),
    // then release after two frames. Animating ~thousands of nodes caused the lag.
    html.classList.add('theme-switching');
    html.classList.remove('theme-transitioning');

    html.setAttribute('data-theme', next);
    localStorage.setItem('skylark-theme', next);
    requestAnimationFrame(() => requestAnimationFrame(() => {
      themeTimer = setTimeout(() => html.classList.remove('theme-switching'), 60);
    }));

    const btn = document.getElementById('mark-bennett-theme-btn');
    if (btn) {
      btn.setAttribute('aria-checked', String(next === 'dark'));
      btn.classList.toggle('is-dark', next === 'dark');
    }
    const checkbox = document.getElementById('sm-darkmode');
    if (checkbox) checkbox.checked = next === 'dark';
    const darkToggle = document.getElementById('darkModeToggle');
    if (darkToggle && darkToggle.type === 'checkbox') darkToggle.checked = next === 'dark';

    document.dispatchEvent(new CustomEvent('nexus:themechange', { detail: { theme: next, manual: !!options.manual } }));
    document.dispatchEvent(new CustomEvent('themechange', { detail: { theme: next, manual: !!options.manual } }));

    try {
      if (options.manual && window.SoundFX && typeof window.SoundFX.playToggle === 'function') {
        window.SoundFX.playToggle();
      }
    } catch (_) {}

    return next;
  }

  window.ThemeController = { set: (theme, options = { animate: true }) => applyTheme(theme, options), get: () => document.documentElement.getAttribute('data-theme') || 'dark' };
  window.toggleDayNightTheme = () => applyTheme(window.ThemeController.get() === 'dark' ? 'light' : 'dark', { animate: true, manual: true });

  window.setNavActive = function(viewId) {
    document.querySelectorAll('.nav-item, .nav-sub-item').forEach(el => el.classList.remove('active'));
    const target = document.querySelector(`[data-view="${viewId}"]`);
    target?.classList.add('active');
    target?.closest('.nav-category-block')?.querySelector('.main-cat-header')?.classList.add('active');
  };

  const originalShowView = window.showView;
  window.showView = function(id) {
    originalShowView?.(id);
    setTimeout(() => window.setNavActive?.(id), 0);
  };

  window.animateNumber = function(element, target, duration = 800) {
    if (!element) return;
    const start = Number.parseInt(element.textContent, 10) || 0;
    const started = performance.now();
    const tick = now => {
      const progress = Math.min((now - started) / duration, 1);
      element.textContent = Math.round(start + (target - start) * (1 - Math.pow(1 - progress, 3))).toLocaleString('en-IN');
      if (progress < 1) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  };

  document.addEventListener('DOMContentLoaded', () => {
    applyTheme(localStorage.getItem('skylark-theme') || 'dark', { animate: false });
    const current = document.querySelector('.view.active');
    if (current) window.setNavActive(current.id.replace('view-', ''));
    window.lucide?.createIcons?.();
  });
})();
