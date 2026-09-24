#!/usr/bin/env python3
"""Clavis AI page header declutter — Apple-style pass, requested explicitly
by the user (audit + redesign). Scoped ONLY to the Jarvis-specific header row
(#view-jarvis .jarvis-hero-header and its children) — the shared app-wide top
bar (title/History/Shortcuts/Run Agent) is left untouched since it's likely
shared across other pages (Dashboard, Data Hub, etc.) that were never part of
this request.

Adds ONE new stylesheet loaded last (after the 5 existing "polish" files) so
it wins the cascade cleanly, rather than hand-editing 16 existing CSS files
blind with no way to visually verify the result. This matches the codebase's
own established pattern (apple-polish.css, jarvis-studio-polish.css, etc. are
all themselves late-loaded override layers).

Also removes one genuine duplicate control: the More-menu had a second
"Toggle Side Panel" button doing the exact same thing as the always-visible
header icon right next to it.

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


HEADER_CSS = r'''/* ============================================================
 * CLAVIS HEADER DECLUTTER (clavis-header-declutter.css)
 * ------------------------------------------------------------
 * Scoped to #view-jarvis .jarvis-hero-header only. Loaded LAST (see
 * index.html <link> order) so it wins the cascade over the five
 * earlier "polish" stylesheets without editing any of them blind.
 *
 * What changed and why:
 *  - "New Chat" collapses to icon-only on desktop too (the font-size:0
 *    trick was already proven for mobile in clavis-voice-polish.css;
 *    the text label was the single widest thing in this row).
 *  - Icon-only controls sit a little tighter together (6px -> 4px).
 *  - The mic-status label truncates with an ellipsis instead of
 *    forcing the row to wrap at moderate window widths.
 *  - Hover/press easing slows from the ~120-160ms snap used elsewhere
 *    to 220ms on Apple's own spring curve (already used for the
 *    dropdown menus in apple-polish.css) -- smoother, not snappier.
 * ============================================================ */

html body #view-jarvis.active .jarvis-newchat-pill {
  font-size: 0 !important;
  width: 32px !important;
  padding: 0 !important;
  justify-content: center !important;
  gap: 0 !important;
}
html body #view-jarvis.active .jarvis-newchat-pill svg {
  flex-shrink: 0;
}

html body #view-jarvis.active .jarvis-hero-actions,
html body #view-jarvis.active .jarvis-hero-actions--compact {
  gap: 4px !important;
}

html body #view-jarvis.active .clavis-live-mic-status {
  max-width: 32vw;
}
html body #view-jarvis.active #clavis-mic-live-label {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  display: inline-block;
  max-width: 100%;
  vertical-align: bottom;
}

html body #view-jarvis.active .jarvis-icon-pill,
html body #view-jarvis.active .jarvis-newchat-pill {
  transition:
    transform 220ms cubic-bezier(0.16, 1, 0.3, 1),
    background-color 220ms cubic-bezier(0.16, 1, 0.3, 1),
    border-color 220ms cubic-bezier(0.16, 1, 0.3, 1),
    box-shadow 220ms cubic-bezier(0.16, 1, 0.3, 1) !important;
}

@media (prefers-reduced-motion: reduce) {
  html body #view-jarvis.active .jarvis-icon-pill,
  html body #view-jarvis.active .jarvis-newchat-pill {
    transition: none !important;
  }
}
'''


def write_header_css():
    print("\nclavis-header-declutter.css (new file)")
    path = os.path.join(ROOT, "clavis-header-declutter.css")
    if os.path.exists(path):
        print(f"  {YELLOW}[skip]{OFF} already exists")
        return False
    with io.open(path, "w", encoding="utf-8", newline="\r\n") as fh:
        fh.write(HEADER_CSS.replace("\n", "\r\n"))
    print(f"  {GREEN}written:{OFF} clavis-header-declutter.css")
    return True


def patch_index_html():
    print("\nindex.html")
    p = Patcher("index.html")

    p.replace(
        "link the new header stylesheet last",
        '  <link rel="stylesheet" href="clavis-voice-polish.css?v=1.0">',
        '  <link rel="stylesheet" href="clavis-voice-polish.css?v=1.0">\n'
        '  <link rel="stylesheet" href="clavis-header-declutter.css?v=1.0">',
        marker='clavis-header-declutter.css',
    )

    p.replace(
        "remove the duplicate Side Panel entry from the More menu",
        '                    <button class="jarvis-more-item" id="jarvis-panel-toggle" onclick="toggleJarvisSidePanel(); toggleJarvisMoreMenu(false)" title="Toggle Side Panel">\n'
        '                      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="15" y1="3" x2="15" y2="21"/></svg>\n'
        '                      Side Panel\n'
        '                    </button>\n'
        '                    <button class="jarvis-more-item" id="jarvis-voice-config-btn" onclick="toggleJarvisVoicePanel(); toggleJarvisMoreMenu(false)" title="Voice settings">',
        '                    <!-- "Side Panel" removed here 2026-09: duplicate of the always-visible\n'
        '                         #jarvis-header-panel-toggle icon right next to New Chat, same onclick. -->\n'
        '                    <button class="jarvis-more-item" id="jarvis-voice-config-btn" onclick="toggleJarvisVoicePanel(); toggleJarvisMoreMenu(false)" title="Voice settings">',
        marker='"Side Panel" removed here',
    )

    return p.save()


def main():
    need = ["index.html"]
    missing = [f for f in need if not os.path.exists(os.path.join(ROOT, f))]
    if missing:
        raise SystemExit(f"{RED}Missing:{OFF} {', '.join(missing)}")

    print("=" * 60)
    print(" Clavis AI page header declutter (Apple-style pass)")
    print("=" * 60)
    n = 0
    n += write_header_css()
    n += patch_index_html()
    print("\n" + "=" * 60)
    print(f" Done. {n} file(s) written/updated.")
    print("=" * 60)


if __name__ == "__main__":
    main()
