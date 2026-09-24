#!/usr/bin/env python3
"""Small follow-up patch: fixes one real bug (a <select> value pointing at
an option that no longer exists) and freshens stale "Kokoro" wording left
in comments/toasts after the Gemini voice migration. Same anchor-checked,
idempotent Patcher as the other apply_*.py scripts in this folder."""

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


def patch_app_js():
    print("\napp.js")
    p = Patcher("app.js")
    p.replace(
        "settings-reset voice select value: real bug -- 'kokoro' option no longer exists",
        "if (voiceEl) voiceEl.value = 'kokoro';",
        "if (voiceEl) voiceEl.value = 'gemini';",
        marker="voiceEl.value = 'gemini'",
    )
    return p.save()


def patch_jarvis_ui():
    print("\njarvis_ui.js")
    p = Patcher("jarvis_ui.js")
    p.replace(
        "header comment",
        " *  - Chat rendering, local Kokoro voice input/output, spoken replies",
        " *  - Chat rendering, Gemini voice input/output, spoken replies",
        marker="Chat rendering, Gemini voice",
    )
    p.replace(
        "no-browser-voices comment",
        "  // The voice path is intentionally local Kokoro only. Do not unlock or\n"
        "  // enumerate browser SpeechSynthesis voices; that used to create a slow\n"
        "  // Microsoft/Google fallback race and a second audible persona.",
        "  // The voice path is intentionally Gemini only. Do not unlock or\n"
        "  // enumerate browser SpeechSynthesis voices; that used to create a slow\n"
        "  // Microsoft/Google fallback race and a second audible persona.",
        marker="voice path is intentionally Gemini only",
    )
    p.replace(
        "warm-health comment",
        "  // Warm only the local health endpoint. Kokoro itself remains lazy so text\n"
        "  // chat stays usable while the first model load is in progress.",
        "  // Just checks Gemini is configured; there is no local model to warm up.",
        marker="there is no local model to warm up",
    )
    p.replace(
        "voice-panel comment",
        "  // Voice settings are rendered by the Kokoro-only panel. Never populate it\n"
        "  // from browser SpeechSynthesis or a cloud voice inventory.",
        "  // Voice settings are rendered by the Gemini-only panel. Never populate it\n"
        "  // from browser SpeechSynthesis or a separate cloud voice inventory.",
        marker="rendered by the Gemini-only panel",
    )
    p.replace(
        "streaming-scheduler comment",
        "  // Keep one output generation open while the brain emits visible text. The\n"
        "  // backend scheduler splits clauses and Kokoro can synthesize the first one\n"
        "  // before the complete answer is stored in chat.",
        "  // Keep one output generation open while the brain emits visible text. The\n"
        "  // backend scheduler splits sentences and Gemini can synthesize the first\n"
        "  // one before the complete answer is stored in chat.",
        marker="backend scheduler splits sentences and Gemini",
    )
    p.replace(
        "cloud-voice-retired comment",
        "  /* Cloud/browser voice inventory intentionally retired; Kokoro is strict. */",
        "  /* Cloud/browser voice inventory intentionally retired; Gemini is the only voice engine. */",
        marker="Gemini is the only voice engine",
    )
    p.replace(
        "mic-unavailable toast wording",
        "showToast('error', 'Local voice unavailable', 'Start the Clavis backend to use Kokoro voice input.');",
        "showToast('error', 'Voice unavailable', 'Start the Clavis backend and set GEMINI_API_KEY to use voice input.');",
        marker="set GEMINI_API_KEY to use voice input",
    )
    return p.save()


def patch_jarvis_js():
    print("\njarvis.js")
    p = Patcher("jarvis.js")
    p.replace(
        "tool-preamble comment",
        "      // discard its preamble instead of ever sending raw tool JSON to Kokoro.",
        "      // discard its preamble instead of ever sending raw tool JSON to the voice engine.",
        marker="raw tool JSON to the voice engine",
    )
    p.replace(
        "streaming comment",
        "          // allowing Kokoro to begin as soon as the final visible provider",
        "          // allowing speech to begin as soon as the final visible provider",
        marker="allowing speech to begin as soon as",
    )
    return p.save()


def patch_apple_polish_js():
    print("\napple-polish.js")
    p = Patcher("apple-polish.js")
    p.replace(
        "browser-voice-picker comment",
        "      // Clavis uses the local Kokoro inventory; browser voices are not part of\n"
        "      // the production path and must never be rendered into settings.",
        "      // Clavis uses the Gemini voice inventory; browser voices are not part of\n"
        "      // the production path and must never be rendered into settings.",
        marker="Clavis uses the Gemini voice inventory",
    )
    return p.save()


def main():
    need = ["app.js", "jarvis_ui.js", "jarvis.js", "apple-polish.js"]
    missing = [f for f in need if not os.path.exists(os.path.join(ROOT, f))]
    if missing:
        raise SystemExit(f"{RED}Missing:{OFF} {', '.join(missing)}")

    print("=" * 60)
    print(" Gemini voice cleanup patch (bug fix + comment wording)")
    print("=" * 60)
    n = patch_app_js() + patch_jarvis_ui() + patch_jarvis_js() + patch_apple_polish_js()
    print("\n" + "=" * 60)
    print(f" Done. {n} file(s) updated.")
    print("=" * 60)


if __name__ == "__main__":
    main()
