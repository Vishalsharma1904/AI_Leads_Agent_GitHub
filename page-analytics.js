/**
 * Analytics compatibility entry point.
 * The real data-driven controller is defined by page-dashboard.js.
 * This file intentionally contains no sample, random, or fabricated metrics.
 */
'use strict';

(function AnalyticsEntryPoint() {
  function render() {
    if (window.AnalyticsCtrl?.init) window.AnalyticsCtrl.init();
  }

  window.renderAnalytics = render;
  document.addEventListener('nexus:themechange', function () {
    if (window.__themeTransitioning) {
      document.addEventListener('nexus:themechange:settled', render, { once: true });
    } else {
      render();
    }
  });
  document.addEventListener('DOMContentLoaded', () => setTimeout(render, 0));
})();