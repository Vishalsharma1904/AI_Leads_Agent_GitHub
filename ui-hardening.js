/* Small progressive-enhancement layer for modal semantics and keyboard use. */
(function () {
  'use strict';
  const selector = '[role="dialog"], .settings-overlay, .mac-settings-overlay';
  const focusable = 'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
  let activeDialog = null;

  // This app closes its dialogs by fading them out and switching the
  // subtree to pointer-events:none — it does NOT set display:none or
  // visibility:hidden. The old test therefore reported every closed
  // dialog as visible, so the autofocus below fired on a hidden
  // dialog's first button several times a second and tore focus out of
  // whatever the user was typing in. That made every composer in the
  // app impossible to type in, and left closed dialogs non-inert.
  function isDialogVisible(dialog) {
    if (dialog.hidden) return false;
    const cs = getComputedStyle(dialog);
    if (cs.display === 'none' || cs.visibility === 'hidden') return false;
    if (parseFloat(cs.opacity) < 0.02) return false;
    if (cs.pointerEvents === 'none') return false;
    const r = dialog.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) return false;
    return true;
  }

  function sync(dialog) {
    const visible = isDialogVisible(dialog);
    // Idempotent writes: only touch the attribute/property when the value
    // actually changes. Writing aria-hidden unconditionally here (with the
    // observer below watching aria-hidden) created an infinite mutation loop
    // that pegged the main thread — "Page Unresponsive" right after load.
    const ariaVal = String(!visible);
    if (dialog.getAttribute('aria-hidden') !== ariaVal) dialog.setAttribute('aria-hidden', ariaVal);
    if (dialog.inert !== !visible) dialog.inert = !visible;
    if (visible && activeDialog !== dialog) {
      activeDialog = dialog;
      requestAnimationFrame(() => {
        const ae = document.activeElement;
        if (ae && dialog.contains(ae)) return;               // already inside
        // Never rip focus away from a field the user is typing in.
        if (ae && /^(INPUT|TEXTAREA)$/.test(ae.tagName)) return;
        if (ae && ae.isContentEditable) return;
        dialog.querySelector(focusable)?.focus();
      });
    } else if (!visible && activeDialog === dialog) {
      activeDialog = null;
    }
  }

  // Coalesce bursts of mutations into a single pass per frame so a chatty page
  // (animations changing style/class constantly) can't thrash this.
  let syncScheduled = false;
  function runSync() { syncScheduled = false; document.querySelectorAll(selector).forEach(sync); }
  function syncAll() {
    if (syncScheduled) return;
    syncScheduled = true;
    requestAnimationFrame(runSync);
  }
  function onKeydown(event) {
    if (!activeDialog) return;
    if (event.key === 'Escape') {
      const close = activeDialog.querySelector('[aria-label*="Close" i], .mac-dialog-btn.cancel');
      if (close) { event.preventDefault(); close.click(); }
      return;
    }
    if (event.key !== 'Tab') return;
    const nodes = [...activeDialog.querySelectorAll(focusable)].filter(node => node.getClientRects().length);
    if (!nodes.length) return;
    const first = nodes[0], last = nodes[nodes.length - 1];
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  }

  function init() {
    syncAll();
    // NB: do NOT observe 'aria-hidden' here — sync() writes it, so watching it
    // would re-trigger this observer. We only watch the inputs that change a
    // dialog's visibility (style/class/hidden).
    new MutationObserver(syncAll).observe(document.body, { subtree: true, attributes: true, attributeFilter: ['style', 'class', 'hidden'] });
    document.addEventListener('keydown', onKeydown, true);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
  else init();
})();
