#!/usr/bin/env python3
"""Links the Clavis Stage v2 layer into index.html.

Two anchors only -- the stylesheets and the one script. Everything else
about the redesign lives in the new files themselves (the Task HUD builds
its own markup at runtime and injects its own More-menu item), so no
existing markup is touched.

Idempotent: re-running reports 'already applied' and changes nothing."""

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


def main():
    print("=" * 60)
    print(" Clavis Stage v2 — link into index.html")
    print("=" * 60)
    p = Patcher("index.html")

    p.replace(
        "link the stage + task HUD stylesheets last",
        '  <link rel="stylesheet" href="clavis-confirm-hud.css?v=1.0">',
        '  <link rel="stylesheet" href="clavis-confirm-hud.css?v=2.0">\n'
        '  <!-- CLAVIS STAGE v2: voice-first Clavis page + floating Task HUD.\n'
        '       Both are scoped to #view-jarvis / #clavis-task-hud and hang off the\n'
        '       .clavis-stage-v2 class that clavis-task-hud.js adds to <html>, so\n'
        '       localStorage.clavis_stage_v2 = \'off\' reverts the whole redesign. -->\n'
        '  <link rel="stylesheet" href="clavis-stage.css?v=1.0">\n'
        '  <link rel="stylesheet" href="clavis-task-hud.css?v=1.0">',
        marker='clavis-stage.css',
    )

    p.replace(
        "load the Task HUD controller",
        '  <script src="clavis-confirm-hud.js?v=1.0" defer></script>',
        '  <script src="clavis-confirm-hud.js?v=1.0" defer></script>\n'
        '  <script src="clavis-task-hud.js?v=1.0" defer></script>',
        # Must be the tag itself, not the bare filename: the stylesheet
        # comment inserted above also mentions clavis-task-hud.js, which
        # would make this edit look already-applied and silently skip.
        marker='<script src="clavis-task-hud.js',
    )

    n = 1 if p.save() else 0
    print("\n" + "=" * 60)
    print(f" Done. {n} file(s) updated.")
    print("=" * 60)


if __name__ == "__main__":
    main()
