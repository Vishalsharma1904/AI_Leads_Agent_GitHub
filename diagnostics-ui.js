/**
 * ============================================================
 *  DIAGNOSTICS UI (diagnostics-ui.js)
 *
 *  Presents the Diagnostics engine: a progress state while checks run, then a
 *  grouped report showing what was repaired, what still needs a human, and what
 *  passed. Openable from Settings → About and from the Plugins page.
 * ============================================================
 */

'use strict';

window.DiagnosticsUI = (function () {

  const MODAL_ID = 'diag-modal';

  function esc(value) {
    return String(value ?? '').replace(/[&<>"']/g, ch => (
      { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]
    ));
  }

  function ensureModal() {
    let modal = document.getElementById(MODAL_ID);
    if (modal) return modal;

    modal = document.createElement('div');
    modal.id = MODAL_ID;
    modal.className = 'diag-modal';
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    modal.setAttribute('aria-labelledby', 'diag-title');
    modal.innerHTML = `
      <div class="diag-backdrop" onclick="DiagnosticsUI.close()"></div>
      <div class="diag-card" role="document">
        <header class="diag-head">
          <div>
            <h3 id="diag-title">Repair &amp; Diagnostics</h3>
            <p class="diag-sub">Checks the app and fixes what it safely can. Runs entirely on this device.</p>
          </div>
          <button class="diag-close" onclick="DiagnosticsUI.close()" aria-label="Close">✕</button>
        </header>
        <div class="diag-body" id="diag-body"></div>
        <footer class="diag-foot" id="diag-foot"></footer>
      </div>`;
    document.body.appendChild(modal);
    return modal;
  }

  function open() {
    const modal = ensureModal();
    modal.classList.add('is-open');
    document.addEventListener('keydown', onKey);
    modal.querySelector('.diag-close')?.focus();
  }

  function close() {
    document.getElementById(MODAL_ID)?.classList.remove('is-open');
    document.removeEventListener('keydown', onKey);
  }

  function onKey(e) { if (e.key === 'Escape') close(); }

  function renderProgress(state) {
    const body = document.getElementById('diag-body');
    const foot = document.getElementById('diag-foot');
    if (!body) return;
    const pct = state.total ? Math.round(((state.index + 1) / state.total) * 100) : 0;
    body.innerHTML = `
      <div class="diag-progress">
        <div class="diag-spinner" aria-hidden="true"></div>
        <div class="diag-progress-text">
          <div class="diag-progress-title">Checking: ${esc(state.title)}</div>
          <div class="diag-progress-count">${state.index + 1} of ${state.total}</div>
        </div>
      </div>
      <div class="diag-bar"><div class="diag-bar-fill" style="width:${pct}%"></div></div>`;
    if (foot) foot.innerHTML = '';
  }

  const TONE = {
    critical: { label: 'Critical', colour: '#ef4444' },
    warning:  { label: 'Warning',  colour: '#f59e0b' },
    info:     { label: 'Notice',   colour: '#60a5fa' }
  };

  function findingRow(f) {
    const tone = TONE[f.severity] || TONE.info;

    let statusIcon, statusClass, statusText;
    if (f.repaired)      { statusIcon = '🔧'; statusClass = 'fixed';  statusText = 'Repaired'; }
    else if (f.passed)   { statusIcon = '✓';  statusClass = 'ok';     statusText = 'OK'; }
    else                 { statusIcon = '!';  statusClass = 'failed'; statusText = tone.label; }

    // Only surface guidance where it is actionable: something still broken, or
    // something we changed and the user should know about.
    const showGuidance = (!f.passed || f.repaired) && f.guidance;

    return `
      <div class="diag-row diag-row--${statusClass}">
        <span class="diag-icon diag-icon--${statusClass}" aria-hidden="true">${statusIcon}</span>
        <div class="diag-row-main">
          <div class="diag-row-title">
            ${esc(f.title)}
            <span class="diag-tag diag-tag--${statusClass}">${esc(statusText)}</span>
            <span class="diag-cat">${esc(f.category)}</span>
          </div>
          <div class="diag-row-msg">${esc(f.message)}</div>
          ${f.repairMessage && f.repaired ? `<div class="diag-row-fix">🔧 ${esc(f.repairMessage)}</div>` : ''}
          ${f.repairMessage && !f.repaired && !f.passed ? `<div class="diag-row-warn">Repair attempted: ${esc(f.repairMessage)}</div>` : ''}
          ${showGuidance ? `<div class="diag-row-guide">${esc(f.guidance)}</div>` : ''}
          ${!f.passed && !f.repairable ? `<div class="diag-row-manual">This one needs a person — it is not safe to change automatically.</div>` : ''}
        </div>
      </div>`;
  }

  function renderReport(result) {
    const body = document.getElementById('diag-body');
    const foot = document.getElementById('diag-foot');
    if (!body) return;

    const { findings, summary } = result;
    const stillBroken = findings.filter(f => !f.passed);
    const repaired = findings.filter(f => f.repaired);
    const healthy = findings.filter(f => f.passed && !f.repaired);

    let headline, headlineTone;
    if (summary.critical > 0) {
      headline = `${summary.critical} critical issue${summary.critical === 1 ? '' : 's'} still need attention`;
      headlineTone = 'bad';
    } else if (stillBroken.length) {
      headline = `${stillBroken.length} issue${stillBroken.length === 1 ? '' : 's'} left, none critical`;
      headlineTone = 'warn';
    } else if (repaired.length) {
      headline = `Repaired ${repaired.length} issue${repaired.length === 1 ? '' : 's'} — app is stable`;
      headlineTone = 'good';
    } else {
      headline = 'Everything checks out';
      headlineTone = 'good';
    }

    const section = (title, rows) => rows.length
      ? `<div class="diag-section">
           <h4 class="diag-section-title">${title} <span>${rows.length}</span></h4>
           ${rows.map(findingRow).join('')}
         </div>` : '';

    body.innerHTML = `
      <div class="diag-headline diag-headline--${headlineTone}">
        <div class="diag-headline-text">${esc(headline)}</div>
        <div class="diag-headline-meta">
          ${summary.passed} of ${summary.total} checks passing${repaired.length ? ` · ${repaired.length} auto-repaired` : ''}
        </div>
      </div>

      ${section('Needs your attention', stillBroken)}
      ${section('Repaired automatically', repaired)}
      ${section('Healthy', healthy)}`;

    if (foot) {
      foot.innerHTML = `
        <span class="diag-foot-note">Nothing left this device. No leads or accounts were deleted.</span>
        <div class="diag-foot-actions">
          <button class="pg-btn pg-btn--ghost" style="flex:0 0 auto;" onclick="DiagnosticsUI.close()">Close</button>
          <button class="pg-btn pg-btn--primary" style="flex:0 0 auto;" onclick="DiagnosticsUI.rerun(event)">Run again</button>
        </div>`;
    }
  }

  let running = false;

  /**
   * Runs the engine with the modal open. `autoRepair` defaults to true, which is
   * what the Diagnose button promises: find and fix in one press.
   */
  async function runAndShow({ autoRepair = true, button = null } = {}) {
    if (running) return;
    running = true;

    const handle = (button && window.ButtonFeedback)
      ? window.ButtonFeedback.busy(button, 'Diagnosing…')
      : null;

    open();

    try {
      const result = await window.Diagnostics.run({
        autoRepair,
        onProgress: renderProgress
      });

      renderReport(result);

      const { summary } = result;
      if (summary.critical > 0) {
        handle?.error(`${summary.critical} critical`);
        window.showToast?.('error', 'Diagnostics finished',
          `${summary.critical} critical issue(s) still need attention.`);
      } else if (summary.remaining.length) {
        handle?.warn(`${summary.remaining.length} left`);
        window.showToast?.('warning', 'Diagnostics finished',
          `Repaired ${summary.repaired}. ${summary.remaining.length} item(s) need you.`);
      } else if (summary.repaired) {
        handle?.success(`Fixed ${summary.repaired}`);
        window.showToast?.('success', 'Repaired', `Fixed ${summary.repaired} issue(s). App is stable.`);
      } else {
        handle?.success('All clear');
        window.showToast?.('success', 'All clear', `All ${summary.total} checks passed.`);
      }
      return result;
    } catch (err) {
      console.error('[DiagnosticsUI] run failed:', err);
      handle?.error('Failed');
      const body = document.getElementById('diag-body');
      if (body) {
        body.innerHTML = `<div class="diag-headline diag-headline--bad">
          <div class="diag-headline-text">Diagnostics could not finish</div>
          <div class="diag-headline-meta">${esc(err?.message || 'Unknown error')}</div>
        </div>`;
      }
    } finally {
      running = false;
    }
  }

  function rerun(event) {
    return runAndShow({ autoRepair: true, button: event?.currentTarget || null });
  }

  return { runAndShow, rerun, open, close };
})();

/** Global entry point used by the Settings and Plugins buttons. */
window.runDiagnostics = function (event) {
  if (!window.Diagnostics || !window.DiagnosticsUI) {
    window.showToast?.('error', 'Diagnostics unavailable',
      'The diagnostics module did not load. Reload the page and try again.');
    return;
  }
  return window.DiagnosticsUI.runAndShow({
    autoRepair: true,
    button: event?.currentTarget || null
  });
};
