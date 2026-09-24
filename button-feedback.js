/**
 * ============================================================
 *  BUTTON FEEDBACK (button-feedback.js)
 *
 *  Gives a button an inline, visible result right where the user clicked,
 *  instead of relying only on a corner toast that is easy to miss.
 *
 *  Why this exists:
 *  Actions like "Save Webhook" wrote to storage and returned silently. With no
 *  visible change on the button, the action looked like it had done nothing.
 *
 *  Usage:
 *    const done = ButtonFeedback.busy(btn, 'Saving…');   // disables + spinner text
 *    done.success('Saved');                              // green tick, auto-revert
 *    done.error('Could not save');                       // red cross, auto-revert
 *
 *  Or the one-liner wrapper, which handles sync + async and never leaves the
 *  button stuck in a loading state:
 *    ButtonFeedback.run(btn, async () => { ... }, {
 *      busy: 'Saving…', success: 'Saved', error: 'Failed'
 *    });
 * ============================================================
 */

'use strict';

window.ButtonFeedback = (function () {

  const REVERT_MS = 2200;

  function resolve(target) {
    if (!target) return null;
    if (typeof target === 'string') return document.getElementById(target);
    if (target instanceof HTMLElement) return target;
    // Allow passing an event, so inline onclick="...(event)" works too.
    if (target.currentTarget instanceof HTMLElement) return target.currentTarget;
    if (target.target instanceof HTMLElement) return target.target.closest('button') || target.target;
    return null;
  }

  /** Remember the button's original look exactly once, so revert is lossless. */
  function snapshot(btn) {
    if (!btn.__bfOriginal) {
      btn.__bfOriginal = {
        html: btn.innerHTML,
        disabled: btn.disabled,
        // Only the properties we touch, so we never clobber unrelated inline CSS.
        background: btn.style.background,
        borderColor: btn.style.borderColor,
        color: btn.style.color,
        cursor: btn.style.cursor,
        opacity: btn.style.opacity
      };
    }
    return btn.__bfOriginal;
  }

  function revert(btn) {
    const original = btn.__bfOriginal;
    if (!original) return;
    clearTimeout(btn.__bfTimer);
    btn.innerHTML = original.html;
    btn.disabled = original.disabled;
    btn.style.background = original.background;
    btn.style.borderColor = original.borderColor;
    btn.style.color = original.color;
    btn.style.cursor = original.cursor;
    btn.style.opacity = original.opacity;
    btn.removeAttribute('aria-busy');
    delete btn.__bfOriginal;
  }

  function paint(btn, { html, background, color, disabled, hold }) {
    snapshot(btn);
    clearTimeout(btn.__bfTimer);
    btn.innerHTML = html;
    btn.disabled = !!disabled;
    if (background) {
      btn.style.background = background;
      btn.style.borderColor = 'transparent';
      btn.style.color = '#fff';
    }
    if (color) btn.style.color = color;
    btn.style.cursor = disabled ? 'progress' : '';
    btn.style.opacity = '';
    if (hold) {
      btn.__bfTimer = setTimeout(() => revert(btn), hold);
    }
  }

  /**
   * Put the button into a loading state and return the handles used to finish it.
   * Every terminal call also announces the result to screen readers via the live
   * region, because a colour change alone is not accessible.
   */
  function busy(target, label) {
    const btn = resolve(target);
    if (!btn) return noopHandle();

    snapshot(btn);
    btn.setAttribute('aria-busy', 'true');
    paint(btn, {
      html: `<span class="bf-spin" aria-hidden="true"></span><span>${escapeHtml(label || 'Working…')}</span>`,
      disabled: true
    });

    return {
      success(message) {
        announce(message || 'Done');
        paint(btn, {
          html: `<span aria-hidden="true">✓</span><span>${escapeHtml(message || 'Done')}</span>`,
          background: 'linear-gradient(135deg,#10b981,#059669)',
          disabled: false,
          hold: REVERT_MS
        });
      },
      error(message) {
        announce(message || 'Failed');
        paint(btn, {
          html: `<span aria-hidden="true">✕</span><span>${escapeHtml(message || 'Failed')}</span>`,
          background: 'linear-gradient(135deg,#ef4444,#dc2626)',
          disabled: false,
          hold: REVERT_MS
        });
      },
      warn(message) {
        announce(message || 'Check this');
        paint(btn, {
          html: `<span aria-hidden="true">!</span><span>${escapeHtml(message || 'Check this')}</span>`,
          background: 'linear-gradient(135deg,#f59e0b,#d97706)',
          disabled: false,
          hold: REVERT_MS
        });
      },
      reset() { revert(btn); }
    };
  }

  function noopHandle() {
    return { success() {}, error() {}, warn() {}, reset() {} };
  }

  /**
   * Wrap any handler. Works for sync and async. If the handler throws or
   * rejects, the button shows the failure rather than staying stuck on "Saving…".
   *
   * Convention: the handler may return `false` or `{ ok:false, message }` to
   * signal a handled failure without throwing.
   */
  async function run(target, handler, labels = {}) {
    const handle = busy(target, labels.busy || 'Working…');
    try {
      const result = await handler();

      if (result === false) {
        handle.error(labels.error || 'Failed');
        return result;
      }
      if (result && typeof result === 'object' && result.ok === false) {
        handle.error(result.message || labels.error || 'Failed');
        return result;
      }

      handle.success(labels.success || 'Done');
      return result;
    } catch (err) {
      console.error('[ButtonFeedback] action failed:', err);
      handle.error(labels.error || shortMessage(err));
      throw err;
    }
  }

  function shortMessage(err) {
    const raw = (err && err.message) ? String(err.message) : 'Failed';
    return raw.length > 40 ? raw.slice(0, 37) + '…' : raw;
  }

  function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, ch => (
      { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]
    ));
  }

  /** Polite live region so the result is announced, not just coloured. */
  function announce(message) {
    let region = document.getElementById('bf-live-region');
    if (!region) {
      region = document.createElement('div');
      region.id = 'bf-live-region';
      region.setAttribute('role', 'status');
      region.setAttribute('aria-live', 'polite');
      region.style.cssText =
        'position:absolute;width:1px;height:1px;margin:-1px;padding:0;' +
        'overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap;border:0;';
      document.body.appendChild(region);
    }
    region.textContent = '';
    setTimeout(() => { region.textContent = String(message || ''); }, 30);
  }

  // Spinner + layout for the injected content.
  (function injectStyles() {
    if (document.getElementById('bf-styles')) return;
    const style = document.createElement('style');
    style.id = 'bf-styles';
    style.textContent = `
      .bf-spin {
        display:inline-block; width:13px; height:13px;
        border:2px solid currentColor; border-right-color:transparent;
        border-radius:50%; animation:bf-spin .6s linear infinite;
        vertical-align:-2px;
      }
      @keyframes bf-spin { to { transform: rotate(360deg); } }
      @media (prefers-reduced-motion: reduce) {
        .bf-spin { animation-duration: 2s; }
      }
    `;
    document.head.appendChild(style);
  })();

  return { busy, run, revert: t => { const b = resolve(t); if (b) revert(b); }, announce };
})();
