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
    // Idle = a slow breathing gradient; 30 fps is indistinguishable there and
    // hands half the GPU budget back to everything else on screen. Speaking /
    // listening / thinking stay at full rate, where the motion is the point.
    window.__clavisOrbFps = { idle: lite ? 24 : 30, active: 60 };
    window.__clavisOrbNoGlass = false;
    document.documentElement.setAttribute('data-perf', t);
    let st = document.getElementById('cx-perf-style');
    if (!st) { st = document.createElement('style'); st.id = 'cx-perf-style'; document.head.appendChild(st); }
    // Blur is only removed when he explicitly picks "Smooth" — Auto never
    // changes how the app looks.
    /* ── Always on, every tier ───────────────────────────────
       Three things cost frames on EVERY machine here, and none of them is
       something anyone chose to look at:

       1. A hidden view's animations keep running. There are ~120 `infinite`
          keyframes across the stylesheets; the browser does not stop one
          because its view is off screen, only because it is `display:none`
          — and these views are hidden with opacity/visibility. So the orb,
          the sidebar and the window all share a compositor with dozens of
          animations nobody can see.
       2. `backdrop-filter` re-blurs everything BEHIND an element every
          frame it moves. ~190 rules declare one. During a drag or a panel
          transition that is the single most expensive thing on screen, and
          it buys nothing — the backdrop is sliding past too fast to read.
       3. A moving element with a five-layer shadow repaints all five.
       None of this changes how the app looks when it is standing still. */
    const ALWAYS = `
      /* Keep old messages in the DOM for search/copy, but skip offscreen paint. */
      #jarvis-messages > .chat-message:not(:nth-last-child(-n+2)),
      #chat-messages > .chat-message:not(:nth-last-child(-n+2)) {
        content-visibility: auto;
        contain-intrinsic-block-size: auto 80px;
      }
      .view:not(.active), .view:not(.active) *,
      [hidden] *, [aria-hidden="true"] * {
        animation-play-state: paused !important;
      }
      .cts.is-dragging, .cts.is-dragging *,
      #sidebar.is-animating, #sidebar.is-animating * {
        backdrop-filter: none !important;
        -webkit-backdrop-filter: none !important;
      }
      .cts.is-dragging {
        box-shadow: 0 10px 30px -10px rgba(23, 21, 18, .28) !important;
        transition: none !important;
      }
      /* A dragged window does not need to re-run its own entry animation. */
      .cts.is-dragging * { transition: none !important; }
    `;
    st.textContent = ALWAYS + (lite && mode() === 'lite' ? `
      html[data-perf="lite"] *, html[data-perf="lite"] *::before, html[data-perf="lite"] *::after {
        backdrop-filter: none !important; -webkit-backdrop-filter: none !important;
      }
      html[data-perf="lite"] .desktop-notification-card, html[data-perf="lite"] #clavis-task-surface,
      html[data-perf="lite"] .mac-dialog, html[data-perf="lite"] .smodal { box-shadow: 0 8px 24px -12px rgba(0,0,0,.28) !important; }
    ` : '');
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

  /* Mark the sidebar while its width transition is actually running, so the
     blur behind it can stand down for those frames. One listener on the
     element beats hooking all four places that toggle `.collapsed`
     (app.js, luxury-ui.js, SidebarController, the intent layer) — and it
     cannot drift out of sync with a caller nobody remembered to patch. */
  function watchSidebar() {
    const bar = document.getElementById('sidebar');
    if (!bar || bar.dataset.cxPerfWatched === '1') return;
    bar.dataset.cxPerfWatched = '1';
    const on = (e) => { if (e.target === bar) bar.classList.add('is-animating'); };
    const off = (e) => { if (e.target === bar) bar.classList.remove('is-animating'); };
    bar.addEventListener('transitionstart', on);
    bar.addEventListener('transitionend', off);
    bar.addEventListener('transitioncancel', off);
  }

  apply();
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', watchSidebar, { once: true });
  else watchSidebar();
  document.addEventListener('click', () => { watchSidebar(); setTimeout(mount, 80); }, { passive: true });
  window.ClavisPerf = { tier, mode, set, detect };
})();
