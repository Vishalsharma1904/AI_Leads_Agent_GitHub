/**
 * CLAVIS CONFIRM HUD (clavis-confirm-hud.js)
 * --------------------------------------------------------------
 * Implements window.clavisConfirm() / window.clavisConfirmAnswer().
 * Both names were already referenced elsewhere in the app --
 * jarvis_skills.js's send_email flow, index.html's #clavis-confirm-dialog
 * markup, clavis-mind.js's safety gate -- but neither was ever actually
 * defined, so every caller silently fell back to a plain window.confirm().
 * This is that missing implementation, styled (see clavis-confirm-hud.css)
 * as a compact Apple/Siri-style floating card rather than a chat-style
 * dialog. Promise-based so callers can `await clavisConfirm(msg, opts)`.
 */
'use strict';

(function ClavisConfirmHUD() {
  let resolvePending = null;
  let previousFocus = null;

  function els() {
    return {
      dialog: document.getElementById('clavis-confirm-dialog'),
      kicker: document.getElementById('clavis-confirm-kicker'),
      title: document.getElementById('clavis-confirm-title'),
      desc: document.getElementById('clavis-confirm-desc'),
      okBtn: document.getElementById('clavis-confirm-ok-btn'),
      cancelBtn: document.getElementById('clavis-confirm-cancel-btn'),
    };
  }

  function onKeydown(e) {
    if (e.key === 'Escape') window.clavisConfirmAnswer(false);
  }

  window.clavisConfirm = function clavisConfirm(message, opts = {}) {
    const { dialog, kicker, title, desc, okBtn, cancelBtn } = els();
    if (!dialog) return Promise.resolve(window.confirm(message));

    // A second confirm while one is already open shouldn't orphan the
    // first caller's promise -- resolve it as cancelled before replacing it.
    if (resolvePending) window.clavisConfirmAnswer(false);

    return new Promise((resolve) => {
      resolvePending = resolve;
      previousFocus = document.activeElement;
      kicker.textContent = opts.kicker || 'Clavis';
      title.textContent = opts.title || 'Confirm';
      desc.textContent = message || '';
      okBtn.textContent = opts.okLabel || 'OK';
      cancelBtn.textContent = opts.cancelLabel || 'Cancel';
      okBtn.classList.toggle('clavis-primary-action--danger', !!opts.danger);

      dialog.hidden = false;
      dialog.inert = false;
      dialog.removeAttribute('inert');
      dialog.setAttribute('aria-hidden', 'false');
      document.addEventListener('keydown', onKeydown);
      // Default focus goes to Cancel, not OK -- this dialog only ever
      // appears for risky/high-impact actions, so Enter should not
      // accidentally approve one.
      requestAnimationFrame(() => {
        dialog.classList.add('is-open');
        cancelBtn.focus();
      });
    });
  };

  window.clavisConfirmAnswer = function clavisConfirmAnswer(approved) {
    const { dialog } = els();
    if (!dialog) return;
    document.removeEventListener('keydown', onKeydown);
    dialog.classList.remove('is-open');
    setTimeout(() => {
      dialog.hidden = true;
      dialog.setAttribute('aria-hidden', 'true');
      dialog.inert = true;
      if (previousFocus?.focus) previousFocus.focus();
    }, 180);
    if (resolvePending) {
      const resolve = resolvePending;
      resolvePending = null;
      resolve(!!approved);
    }
  };
})();
