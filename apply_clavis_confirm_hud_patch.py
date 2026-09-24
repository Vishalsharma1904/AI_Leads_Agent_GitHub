#!/usr/bin/env python3
"""Clavis Confirm HUD — Phase 1 of the requested voice-first/Task-HUD redesign,
scoped narrowly per the user's own choice: implement window.clavisConfirm() /
window.clavisConfirmAnswer(), which were referenced (in jarvis_skills.js's
send_email flow, in index.html's #clavis-confirm-dialog markup, and in a
clavis-mind.js code comment) but never actually defined anywhere in the app —
every call silently fell back to a plain window.confirm() via the
`window.clavisConfirm || ((msg) => Promise.resolve(window.confirm(msg)))`
guard already written in jarvis_skills.js.

This restyles the EXISTING #clavis-confirm-dialog markup (already in
index.html, already wired to onclick="clavisConfirmAnswer(...)") into a
compact, Apple/Siri-style floating confirmation card, and wires it up for
real:
  1. NEW clavis-confirm-hud.css — restyles #clavis-confirm-dialog only
     (scoped by ID, so the credential/API-key dialog it shares a base class
     with is untouched).
  2. NEW clavis-confirm-hud.js — implements clavisConfirm()/clavisConfirmAnswer().
  3. index.html — links the new stylesheet + script.
  4. clavis-mind.js — safety.gate() now awaits clavisConfirm() instead of the
     native window.confirm() for risky-action approval (its one caller,
     jarvis_skills.js's already-async invoke(), is updated to await it).

Same anchor-checked, idempotent Patcher as the other apply_*.py scripts in
this folder — safe to re-run."""

import io
import os

ROOT = os.path.dirname(os.path.abspath(__file__))
GREEN, YELLOW, RED, DIM, OFF = "\033[92m", "\033[93m", "\033[91m", "\033[2m", "\033[0m"


class Patcher:
    def __init__(self, path):
        self.path = os.path.join(ROOT, path)
        self.name = path
        with io.open(self.path, "r", encoding="utf-8", newline="") as fh:
            raw = fh.read()
        self.crlf = "\r\n" in raw
        self.text = raw.replace("\r\n", "\n") if self.crlf else raw
        self.original = self.text
        self.log = []

    def replace(self, label, old, new, *, marker=None):
        if marker and marker in self.text:
            self.log.append((YELLOW, "skip", f"{label} (already applied)"))
            return
        n = self.text.count(old)
        if n != 1:
            raise SystemExit(f"{RED}ANCHOR {'MISSING' if n == 0 else 'AMBIGUOUS'}{OFF} "
                              f"in {self.name}: {label} (found {n})\n  {old[:160]!r}")
        self.text = self.text.replace(old, new)
        self.log.append((GREEN, " ok ", label))

    def save(self):
        for c, tag, label in self.log:
            print(f"  {c}[{tag}]{OFF} {label}")
        if self.text == self.original:
            print(f"  {DIM}no changes to {self.name}{OFF}")
            return False
        out = self.text.replace("\n", "\r\n") if self.crlf else self.text
        with io.open(self.path, "w", encoding="utf-8", newline="") as fh:
            fh.write(out)
        print(f"  {GREEN}written:{OFF} {self.name}")
        return True


CONFIRM_CSS = r'''/* ============================================================
 * CLAVIS CONFIRM HUD (clavis-confirm-hud.css)
 * ------------------------------------------------------------
 * Restyles the existing #clavis-confirm-dialog (already in index.html,
 * already wired to window.clavisConfirmAnswer()) into a compact,
 * Apple/Siri-style floating confirmation card instead of the generic
 * centered form-dialog look it inherited from .clavis-credential-dialog.
 * Scoped entirely to #clavis-confirm-dialog by ID, so the actual
 * credential dialog (API key setup) keeps its current look untouched.
 *
 * This is the first piece of the requested Task HUD system: it replaces
 * the risky-action confirmation, which previously fell back silently to
 * a plain window.confirm() every time (see clavis-confirm-hud.js and
 * clavis-mind.js's safety.gate()).
 * ============================================================ */

#clavis-confirm-dialog {
  place-items: start center;
  padding-top: 12vh;
  background: rgba(20, 20, 26, 0.32);
  backdrop-filter: blur(10px);
  -webkit-backdrop-filter: blur(10px);
  opacity: 0;
  transition: opacity 200ms ease;
}
#clavis-confirm-dialog.is-open {
  opacity: 1;
  transition: opacity 260ms ease;
}

#clavis-confirm-dialog .clavis-credential-card {
  width: min(90vw, 360px);
  max-height: min(80vh, 460px);
  padding: 26px 22px 20px;
  border-radius: 22px;
  text-align: center;
  box-shadow: 0 24px 60px rgba(0, 0, 0, 0.28), 0 2px 10px rgba(0, 0, 0, 0.10);
  transform: scale(0.92) translateY(-14px);
  opacity: 0;
  /* Closed-state (default) transition -- used when this class is REMOVED,
     i.e. on close. Deliberately shorter than the open transition below:
     exits should feel faster than entrances. */
  transition: transform 200ms cubic-bezier(0.4, 0, 1, 1), opacity 180ms ease;
}
#clavis-confirm-dialog.is-open .clavis-credential-card {
  transform: scale(1) translateY(0);
  opacity: 1;
  /* Open-state transition -- used when .is-open is ADDED. Apple's own
     spring curve, already used for menus in apple-polish.css and for the
     header controls in clavis-header-declutter.css. */
  transition: transform 340ms cubic-bezier(0.16, 1, 0.3, 1), opacity 280ms ease;
}

/* Small gradient avatar badge standing in for a contact photo -- no new
   image asset, just a circle in the app's own accent color. */
#clavis-confirm-dialog .clavis-credential-card::before {
  content: '';
  display: block;
  width: 44px;
  height: 44px;
  margin: 0 auto 14px;
  border-radius: 50%;
  background: linear-gradient(135deg, var(--primary), #9b8cf5);
  box-shadow: 0 6px 16px rgba(108, 92, 231, 0.35);
}

#clavis-confirm-dialog .clavis-dialog-close {
  top: 10px;
  right: 10px;
  width: 32px;
  height: 32px;
  font-size: 18px;
  opacity: 0.55;
}
#clavis-confirm-dialog .clavis-dialog-close:hover {
  opacity: 1;
}

#clavis-confirm-dialog .clavis-dialog-kicker {
  text-align: center;
  margin: 0 0 4px;
}
#clavis-confirm-dialog h2 {
  margin: 0 0 10px;
  font-size: 18px;
  text-align: center;
}
#clavis-confirm-dialog .clavis-credential-card > p:not(.clavis-dialog-kicker) {
  text-align: left;
  font-size: 13.5px;
  background: rgba(127, 127, 127, 0.10);
  border-radius: 12px;
  padding: 10px 12px;
  margin: 0 0 20px;
}

#clavis-confirm-dialog .clavis-dialog-actions {
  justify-content: stretch;
  gap: 10px;
}
#clavis-confirm-dialog .clavis-dialog-actions button {
  flex: 1;
  border-radius: 999px;
  min-height: 46px;
  font-weight: 600;
  transition: transform 160ms cubic-bezier(0.16, 1, 0.3, 1), filter 160ms ease;
}
#clavis-confirm-dialog .clavis-dialog-actions button:active {
  transform: scale(0.96);
}
#clavis-confirm-dialog .clavis-primary-action--danger {
  background: #e5484d;
  border-color: #e5484d;
}

@media (prefers-reduced-motion: reduce) {
  #clavis-confirm-dialog,
  #clavis-confirm-dialog .clavis-credential-card,
  #clavis-confirm-dialog .clavis-dialog-actions button {
    transition: opacity 120ms linear !important;
    transform: none !important;
  }
}
'''


CONFIRM_JS = r'''/**
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
'''


def write_new_files():
    print("\nnew files")
    n = 0
    for fname, content in (("clavis-confirm-hud.css", CONFIRM_CSS), ("clavis-confirm-hud.js", CONFIRM_JS)):
        path = os.path.join(ROOT, fname)
        if os.path.exists(path):
            print(f"  {YELLOW}[skip]{OFF} {fname} already exists")
            continue
        with io.open(path, "w", encoding="utf-8", newline="\r\n") as fh:
            fh.write(content.replace("\n", "\r\n"))
        print(f"  {GREEN}written:{OFF} {fname}")
        n += 1
    return n


def patch_index_html():
    print("\nindex.html")
    p = Patcher("index.html")

    p.replace(
        "link the new confirm-HUD stylesheet last",
        '  <link rel="stylesheet" href="clavis-header-declutter.css?v=1.0">',
        '  <link rel="stylesheet" href="clavis-header-declutter.css?v=1.0">\n'
        '  <link rel="stylesheet" href="clavis-confirm-hud.css?v=1.0">',
        marker='clavis-confirm-hud.css',
    )

    p.replace(
        "load clavis-confirm-hud.js before clavis-mind.js (which awaits clavisConfirm)",
        '  <script src="clavis-mind.js?v=1.0" defer></script>',
        '  <script src="clavis-confirm-hud.js?v=1.0" defer></script>\n'
        '  <script src="clavis-mind.js?v=1.0" defer></script>',
        marker='clavis-confirm-hud.js',
    )

    return p.save()


def patch_clavis_mind():
    print("\nclavis-mind.js")
    p = Patcher("clavis-mind.js")

    p.replace(
        "safety.gate() awaits clavisConfirm() instead of window.confirm()",
        "    /**\n"
        "     * Returns { allowed, riskLevel, reason }.\n"
        "     * NOTE (2026-09-04): send_email and the Vision toggle now confirm via the\n"
        "     * styled, Promise-based clavisConfirm() (jarvis_ui.js) instead of the\n"
        "     * native window.confirm() — it doesn't freeze every timer on the page and\n"
        "     * can't be silently killed by Chrome's \"stop showing dialogs\" guard. This\n"
        "     * gate still uses window.confirm() below because it's called SYNCHRONOUSLY\n"
        "     * from many places in the skill-execution path; switching it to the async\n"
        "     * dialog means auditing every caller of gate(), which wasn't done here —\n"
        "     * left as a deliberate follow-up, not an oversight.\n"
        "     */\n"
        "    function gate(name, args = {}) {\n"
        "      const riskLevel = assess(name, args);\n"
        "      if (SELF_CONFIRMING.has(name)) return { allowed: true, riskLevel, reason: 'the skill confirms with the owner itself' };\n"
        "      if (riskLevel < threshold()) return { allowed: true, riskLevel, reason: 'within the configured risk boundary' };\n"
        "      api.emit({\n"
        "        type: 'safety.confirmation_required', source: 'tool', importance: 0.85,\n"
        "        metadata: { tool: name, riskLevel, description: `${name} can cause significant or irreversible changes.` },\n"
        "      });\n"
        "      const summary = Object.entries(args).slice(0, 6)\n"
        "        .map(([k, v]) => `  ${k}: ${String(v).slice(0, 120)}`).join('\\n');\n"
        "      const ok = window.confirm(`Clavis wants to run a high-risk action.\\n\\nAction: ${name}\\nRisk level: ${riskLevel}/4\\n${summary ? `\\n${summary}\\n` : ''}\\nAllow it?`);\n"
        "      api.emit({ type: 'safety.confirmation_resolved', source: 'tool', importance: 0.4, metadata: { tool: name, approved: ok } });\n"
        "      return ok\n"
        "        ? { allowed: true, riskLevel, reason: 'owner approved' }\n"
        "        : { allowed: false, riskLevel, reason: 'owner declined' };\n"
        "    }\n",
        "    /**\n"
        "     * Returns { allowed, riskLevel, reason }.\n"
        "     * UPDATED (2026-09-07): now awaits the styled, Promise-based\n"
        "     * clavisConfirm() (clavis-confirm-hud.js) instead of the native\n"
        "     * window.confirm() — window.confirm() blocks the whole tab and Chrome\n"
        "     * can silently disable repeated native dialogs page-wide, which would\n"
        "     * let a risky action through (or block it) with no visible error.\n"
        "     * gate() is async now; its one caller (jarvis_skills.js's invoke(),\n"
        "     * already async) awaits it.\n"
        "     */\n"
        "    async function gate(name, args = {}) {\n"
        "      const riskLevel = assess(name, args);\n"
        "      if (SELF_CONFIRMING.has(name)) return { allowed: true, riskLevel, reason: 'the skill confirms with the owner itself' };\n"
        "      if (riskLevel < threshold()) return { allowed: true, riskLevel, reason: 'within the configured risk boundary' };\n"
        "      api.emit({\n"
        "        type: 'safety.confirmation_required', source: 'tool', importance: 0.85,\n"
        "        metadata: { tool: name, riskLevel, description: `${name} can cause significant or irreversible changes.` },\n"
        "      });\n"
        "      const summary = Object.entries(args).slice(0, 6)\n"
        "        .map(([k, v]) => `  ${k}: ${String(v).slice(0, 120)}`).join('\\n');\n"
        "      const confirmFn = window.clavisConfirm || ((msg) => Promise.resolve(window.confirm(msg)));\n"
        "      const ok = await confirmFn(`Action: ${name}\\nRisk level: ${riskLevel}/4${summary ? `\\n${summary}` : ''}`, {\n"
        "        title: 'Clavis wants to run a high-risk action',\n"
        "        okLabel: 'Allow', cancelLabel: 'Deny', danger: riskLevel >= 4,\n"
        "      });\n"
        "      api.emit({ type: 'safety.confirmation_resolved', source: 'tool', importance: 0.4, metadata: { tool: name, approved: ok } });\n"
        "      return ok\n"
        "        ? { allowed: true, riskLevel, reason: 'owner approved' }\n"
        "        : { allowed: false, riskLevel, reason: 'owner declined' };\n"
        "    }\n",
        marker='async function gate(name, args = {})',
    )

    return p.save()


def patch_jarvis_skills():
    print("\njarvis_skills.js")
    p = Patcher("jarvis_skills.js")

    p.replace(
        "await the now-async safety.gate()",
        "    const gate = window.ClavisMind?.safety?.gate?.(name, params || {});",
        "    const gate = await window.ClavisMind?.safety?.gate?.(name, params || {});",
        marker='const gate = await window.ClavisMind',
    )

    return p.save()


def main():
    need = ["index.html", "clavis-mind.js", "jarvis_skills.js"]
    missing = [f for f in need if not os.path.exists(os.path.join(ROOT, f))]
    if missing:
        raise SystemExit(f"{RED}Missing:{OFF} {', '.join(missing)}")

    print("=" * 60)
    print(" Clavis Confirm HUD (Task-HUD Phase 1, first slice)")
    print("=" * 60)
    n = 0
    n += write_new_files()
    n += patch_index_html()
    n += patch_clavis_mind()
    n += patch_jarvis_skills()
    print("\n" + "=" * 60)
    print(f" Done. {n} file(s) written/updated.")
    print("=" * 60)


if __name__ == "__main__":
    main()
