/* ============================================================
 * clavis-perf.js · smooth on a 4 GB laptop too
 * ------------------------------------------------------------
 * Loaded in <head>, before anything draws. It picks a graphics tier
 * and tells the heavy parts how hard to work, so the GPU does the
 * compositing and the CPU isn't asked to repaint what nobody sees:
 *
 *   full   the orb renders at up to 2x DPR
 *   lite   (auto on <= 4 GB RAM or <= 4 cores) the orb renders at 1x DPR;
 *          only an explicit "Smooth" pick also drops backdrop blur
 *
 * Settings → Performance: Auto / Smooth (lite) / Max quality.
 * localStorage: clavis_perf_mode ('auto' | 'lite' | 'full').
 * ============================================================ */
(function () {
  'use strict';
  if (window.ClavisPerf) return;
  const KEY = 'clavis_perf_mode';
  const mode = () => { try { return localStorage.getItem(KEY) || 'auto'; } catch (_) { return 'auto'; } };
  function detect() {
    const mem = Number(navigator.deviceMemory) || 8;
    const cores = Number(navigator.hardwareConcurrency) || 8;
    return mem <= 4 || cores <= 4 ? 'lite' : 'full';
  }
  const tier = () => (mode() === 'auto' ? detect() : mode());

  function apply() {
    const t = tier();
    const lite = t === 'lite';
    // The orb's glass pass IS its round lens — never drop it (dropping it
    // turned the orb into a square). No frame caps either: a capped orb
    // looks choppy. Low-end PCs only render it at 1x pixel density.
    window.__clavisMaxDpr = lite ? 1 : 2;
    window.__clavisOrbFps = null;
    window.__clavisOrbNoGlass = false;
    document.documentElement.setAttribute('data-perf', t);
    let st = document.getElementById('cx-perf-style');
    if (!st) { st = document.createElement('style'); st.id = 'cx-perf-style'; document.head.appendChild(st); }
    // Blur is only removed when he explicitly picks "Smooth" — Auto never
    // changes how the app looks.
    st.textContent = lite && mode() === 'lite' ? `
      html[data-perf="lite"] *, html[data-perf="lite"] *::before, html[data-perf="lite"] *::after {
        backdrop-filter: none !important; -webkit-backdrop-filter: none !important;
      }
      html[data-perf="lite"] .desktop-notification-card, html[data-perf="lite"] #clavis-task-surface,
      html[data-perf="lite"] .mac-dialog, html[data-perf="lite"] .smodal { box-shadow: 0 8px 24px -12px rgba(0,0,0,.28) !important; }
    ` : '';
    return t;
  }

  function set(m) {
    if (!['auto', 'lite', 'full'].includes(m)) return tier();
    try { localStorage.setItem(KEY, m); } catch (_) {}
    const t = apply();
    // The orb picked its DPR at creation; rebuild it so the change shows now.
    try { if (window.StrandsOrb?.instance && document.getElementById('orb-container')) window.StrandsOrb.init('orb-container'); } catch (_) {}
    return t;
  }

  function mount() {
    const sec = document.getElementById('smsc-performance');
    if (!sec || document.getElementById('cx-perf-mode')) return;
    const head = sec.querySelector('.smodal-section-header');
    const row = document.createElement('div');
    row.className = 'smodal-field';
    row.innerHTML = `<div class="smodal-field-left"><label class="smodal-label" for="cx-perf-mode">Graphics</label>
      <span class="smodal-hint">Auto picks Smooth on 4 GB RAM / 4-core PCs. Now: <b id="cx-perf-now"></b></span></div>
      <select id="cx-perf-mode" class="smodal-select"><option value="auto">Auto</option><option value="lite">Smooth (lighter effects)</option><option value="full">Max quality</option></select>`;
    if (head && head.nextSibling) sec.insertBefore(row, head.nextSibling); else sec.appendChild(row);
    const sel = row.querySelector('select');
    const now = row.querySelector('#cx-perf-now');
    sel.value = mode();
    now.textContent = tier() === 'lite' ? 'Smooth' : 'Max quality';
    sel.addEventListener('change', () => { const t = set(sel.value); now.textContent = t === 'lite' ? 'Smooth' : 'Max quality'; });
  }

  apply();
  document.addEventListener('click', () => setTimeout(mount, 80), { passive: true });
  window.ClavisPerf = { tier, mode, set, detect };
})();
