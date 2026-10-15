(function (window) {
  'use strict';
  let checking = false, lastCheck = 0, bootErrors = false;
  const desktop = window.RudraDesktop;
  // No automatic reload: an unknown task/draft/voice state is conservatively busy.
  // Verified desktop updates switch before a window exists on the next launch.
  window.addEventListener('error', () => { bootErrors = true; });
  async function check() {
    if (checking || !desktop || Date.now() - lastCheck < 60000) return;
    const auth = window.SupabaseAuth;
    const token = auth?.getAccessToken?.();
    const base = window.CLAVIS_DESKTOP_BACKEND_URL || window.SKYLARK_CONFIG?.BACKEND_URL;
    if (!token || !base) return;
    checking = true; lastCheck = Date.now();
    try {
      const current = await desktop.updateStatus();
      if (!current.enabled) return;
      const result = await desktop.stageUpdate(token);
      window.dispatchEvent(new CustomEvent('rudra:update', { detail: result }));
      if (result.pending && !result.error) {
        window.showToast?.('info', 'Update ready', 'App band karke agli baar kholenge tab update apply hoga.');
      }
    } catch (_) { /* Cached app remains available during network/provider failure. */ }
    finally { checking = false; }
  }
  window.RudraUpdates = Object.freeze({ check, status: () => desktop?.updateStatus?.() || Promise.resolve({ enabled: false }) });
  window.addEventListener('rudra:capabilities', check);
  window.addEventListener('rudra:auth-state', check);
  window.addEventListener('online', check);
  if (desktop) {
    const ready = () => setTimeout(() => {
      if (!bootErrors && document.querySelector('main, #main-content, .app-container') && window.SupabaseAuth) desktop.updateReady().catch(() => {});
      void check();
    }, 30000);
    if (document.readyState === 'complete') ready(); else window.addEventListener('load', ready, { once: true });
    setInterval(check, 15 * 60000);
  } else if ('serviceWorker' in navigator) {
    window.addEventListener('load', async () => {
      if (/^(localhost|127\.0\.0\.1)$/.test(location.hostname)) return;
      try {
        const registration = await navigator.serviceWorker.ready;
        if (!registration) return;
        const offer = () => {
          if (!registration.waiting || document.getElementById('rudra-web-update')) return;
          const notice = document.createElement('p');notice.id = 'rudra-web-update';notice.setAttribute('role','status');
          notice.textContent = 'Update ready. Save your work and close all app tabs; the next launch will use the new version.';
          document.body.append(notice);
        };
        offer();registration.addEventListener('updatefound', () => registration.installing?.addEventListener('statechange', offer));
      } catch (_) {}
    }, { once: true });
  }
})(window);
