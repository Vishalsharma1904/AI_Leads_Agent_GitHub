#!/usr/bin/env python3
"""
Gemini voice migration patch — index.html, app.js, jarvis_ui.js.

Same rules as the project's existing apply_jarvis_patch*.py: every edit is
anchored on a string that must appear exactly once, nothing is written if
any anchor is missing, and re-running is a safe no-op.

This removes the "Kokoro local voice" settings UI (both copies) and points
saveVoiceSettings()/initClavisLocalVoiceControls() at a single Gemini voice
picker instead of the old English-voice/Hindi-voice/rate/pause/reaction
controls, which no longer apply now that Gemini handles both languages
with one voice and has no pause/reaction knobs to expose.
"""

import io
import os

ROOT = os.path.dirname(os.path.abspath(__file__))
GREEN, YELLOW, RED, DIM, OFF = "\033[92m", "\033[93m", "\033[91m", "\033[2m", "\033[0m"

VOICE_OPTIONS = (
    '<option value="Charon" selected>Charon · composed narration</option>'
    '<option value="Orus">Orus · narration</option>'
    '<option value="Kore">Kore · clear, neutral</option>'
    '<option value="Fenrir">Fenrir · dramatic</option>'
    '<option value="Puck">Puck · dramatic</option>'
)


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


def patch_index_html():
    print("\nindex.html")
    p = Patcher("index.html")

    # Panel 1: the floating voice-config panel under the JARVIS orb.
    p.replace(
        "floating voice panel -> Gemini",
        '                <div class="clavis-local-voice-header">\n'
        '                  <div><strong>Kokoro local voice</strong><small>One shared model · 24 kHz PCM · no browser fallback</small></div>\n'
        '                  <span class="clavis-engine-status" data-clavis-engine-status data-clavis-speech-status data-status="loading">Checking engine…</span>\n'
        '                </div>\n'
        '                <div class="clavis-voice-grid">\n'
        '                  <label>English voice<select id="clavis-kokoro-en-voice"><option value="bm_george">George · executive masculine</option></select></label>\n'
        '                  <label>Hindi voice<select id="clavis-kokoro-hi-voice"><option value="hm_omega">Omega · Indian masculine</option></select></label>\n'
        '                  <label>Language mode<select id="clavis-voice-language-mode"><option value="auto">Auto · clause aware</option><option value="en">English</option><option value="hi">Hindi / Hinglish</option></select></label>\n'
        '                  <label>Speaking rate<input id="clavis-kokoro-rate" type="range" min="0.86" max="1.12" step="0.01" value="1"><span id="clavis-kokoro-rate-value">1.00×</span></label>\n'
        '                  <label>Pause intensity<input id="clavis-kokoro-pause" type="range" min="0" max="1" step="0.05" value="0.45"><span id="clavis-kokoro-pause-value">Balanced</span></label>\n'
        '                  <label>Reaction intensity<input id="clavis-kokoro-reaction" type="range" min="0" max="1" step="0.05" value="0.25"><span id="clavis-kokoro-reaction-value">Subtle</span></label>\n'
        '                </div>\n',
        '                <div class="clavis-local-voice-header">\n'
        '                  <div><strong>Voice · Google Gemini</strong><small>Cloud speech, one API key · 24 kHz PCM</small></div>\n'
        '                  <span class="clavis-engine-status" data-clavis-engine-status data-clavis-speech-status data-status="loading">Checking engine…</span>\n'
        '                </div>\n'
        '                <div class="clavis-voice-grid">\n'
        f'                  <label>Voice<select id="clavis-gemini-voice">{VOICE_OPTIONS}</select></label>\n'
        '                </div>\n',
        marker='Voice · Google Gemini',
    )
    p.replace(
        "floating voice panel Test button",
        '<button type="button" onclick="testJarvisVoice()">Test Kokoro</button>',
        '<button type="button" onclick="testJarvisVoice()">Test voice</button>',
        marker='>Test voice<',
    )

    # Panel 2: the duplicate controls inside the big Settings modal.
    p.replace(
        "settings-modal voice engine block -> Gemini",
        '              <div class="smodal-field">\n'
        '                <div class="smodal-field-left">\n'
        '                  <label class="smodal-label">Voice engine</label>\n'
        '                  <span class="smodal-hint">Strict local Kokoro · shared 24 kHz model · no browser/cloud fallback</span>\n'
        '                </div>\n'
        '                <select id="sm-tts-model" class="smodal-select">\n'
        '                  <option value="kokoro" selected>Kokoro Local · Executive profile</option>\n'
        '                </select>\n'
        '              </div>\n'
        '\n'
        '              <div class="smodal-field">\n'
        '                <div class="smodal-field-left"><label class="smodal-label" for="sm-kokoro-en-voice">English voice</label></div>\n'
        '                <select id="sm-kokoro-en-voice" class="smodal-select"><option value="bm_george">George · masculine executive</option></select>\n'
        '              </div>\n'
        '\n'
        '              <div class="smodal-field">\n'
        '                <div class="smodal-field-left"><label class="smodal-label" for="sm-kokoro-hi-voice">Hindi voice</label></div>\n'
        '                <select id="sm-kokoro-hi-voice" class="smodal-select"><option value="hm_omega">Omega · Indian masculine</option></select>\n'
        '              </div>\n'
        '\n'
        '              <div class="smodal-field">\n'
        '                <div class="smodal-field-left"><label class="smodal-label" for="sm-kokoro-language">Language routing</label><span class="smodal-hint">Clause-aware English / Hindi / Hinglish</span></div>\n'
        '                <select id="sm-kokoro-language" class="smodal-select"><option value="auto" selected>Auto</option><option value="en">English</option><option value="hi">Hindi / Hinglish</option></select>\n'
        '              </div>\n',
        '              <div class="smodal-field">\n'
        '                <div class="smodal-field-left">\n'
        '                  <label class="smodal-label">Voice engine</label>\n'
        '                  <span class="smodal-hint">Google Gemini · cloud speech, one API key, both languages</span>\n'
        '                </div>\n'
        '                <select id="sm-tts-model" class="smodal-select">\n'
        '                  <option value="gemini" selected>Gemini</option>\n'
        '                </select>\n'
        '              </div>\n'
        '\n'
        '              <div class="smodal-field">\n'
        '                <div class="smodal-field-left"><label class="smodal-label" for="sm-gemini-voice">Voice</label></div>\n'
        f'                <select id="sm-gemini-voice" class="smodal-select">{VOICE_OPTIONS}</select>\n'
        '              </div>\n',
        marker='id="sm-gemini-voice"',
    )
    return p.save()


def patch_app_js():
    print("\napp.js")
    p = Patcher("app.js")
    p.replace(
        "saveVoiceSettings Kokoro block -> Gemini",
        "  // System Settings panel fields\n"
        "  const tts = document.getElementById('sm-tts-model');\n"
        "  safeLocalStorageSet('skylark-tts-model', 'kokoro');\n"
        "  safeLocalStorageSet('skylark-tts-engine', 'kokoro');\n"
        "  const enVoice = document.getElementById('sm-kokoro-en-voice')?.value || document.getElementById('clavis-kokoro-en-voice')?.value || 'bm_george';\n"
        "  const hiVoice = document.getElementById('sm-kokoro-hi-voice')?.value || document.getElementById('clavis-kokoro-hi-voice')?.value || 'hm_omega';\n"
        "  const languageMode = document.getElementById('sm-kokoro-language')?.value || document.getElementById('clavis-voice-language-mode')?.value || 'auto';\n"
        "  safeLocalStorageSet('clavis_kokoro_en_voice', enVoice);\n"
        "  safeLocalStorageSet('clavis_kokoro_hi_voice', hiVoice);\n"
        "  safeLocalStorageSet('clavis_voice_language_mode', languageMode);\n"
        "  const speed = document.getElementById('sm-speech-speed');\n"
        "  if (speed) safeLocalStorageSet('skylark-speech-speed', speed.value);\n"
        "  const rate = document.getElementById('clavis-kokoro-rate')?.value;\n"
        "  if (rate) safeLocalStorageSet('jarvis_voice_rate', rate);\n"
        "  const pause = document.getElementById('clavis-kokoro-pause')?.value;\n"
        "  if (pause) safeLocalStorageSet('clavis_voice_pause_intensity', pause);\n"
        "  const reaction = document.getElementById('clavis-kokoro-reaction')?.value;\n"
        "  if (reaction) safeLocalStorageSet('clavis_voice_reaction_intensity', reaction);\n",
        "  // System Settings panel fields\n"
        "  const tts = document.getElementById('sm-tts-model');\n"
        "  safeLocalStorageSet('skylark-tts-model', 'gemini');\n"
        "  safeLocalStorageSet('skylark-tts-engine', 'gemini');\n"
        "  const geminiVoice = document.getElementById('sm-gemini-voice')?.value || document.getElementById('clavis-gemini-voice')?.value || 'Charon';\n"
        "  safeLocalStorageSet('clavis_gemini_voice', geminiVoice);\n"
        "  const speed = document.getElementById('sm-speech-speed');\n"
        "  if (speed) safeLocalStorageSet('skylark-speech-speed', speed.value);\n",
        marker="clavis_gemini_voice', geminiVoice",
    )
    return p.save()


def patch_jarvis_ui():
    print("\njarvis_ui.js")
    p = Patcher("jarvis_ui.js")
    p.replace(
        "initClavisLocalVoiceControls -> single Gemini voice picker",
        "function initClavisLocalVoiceControls() {\n"
        "  const values = {\n"
        "    'clavis-kokoro-en-voice': localStorage.getItem('clavis_kokoro_en_voice') || 'bm_george',\n"
        "    'sm-kokoro-en-voice': localStorage.getItem('clavis_kokoro_en_voice') || 'bm_george',\n"
        "    'clavis-kokoro-hi-voice': localStorage.getItem('clavis_kokoro_hi_voice') || 'hm_omega',\n"
        "    'sm-kokoro-hi-voice': localStorage.getItem('clavis_kokoro_hi_voice') || 'hm_omega',\n"
        "    'clavis-voice-language-mode': localStorage.getItem('clavis_voice_language_mode') || 'auto',\n"
        "    'sm-kokoro-language': localStorage.getItem('clavis_voice_language_mode') || 'auto',\n"
        "  };\n"
        "  Object.entries(values).forEach(([id, value]) => { const el = document.getElementById(id); if (el) el.value = value; });\n"
        "  const rate = document.getElementById('clavis-kokoro-rate');\n"
        "  if (rate) {\n"
        "    rate.value = localStorage.getItem('jarvis_voice_rate') || '1';\n"
        "    rate.addEventListener('input', () => { const out = document.getElementById('clavis-kokoro-rate-value'); if (out) out.textContent = `${Number(rate.value).toFixed(2)}×`; });\n"
        "    rate.dispatchEvent(new Event('input'));\n"
        "  }\n"
        "  const pause = document.getElementById('clavis-kokoro-pause');\n"
        "  if (pause) {\n"
        "    pause.value = localStorage.getItem('clavis_voice_pause_intensity') || '0.45';\n"
        "    pause.addEventListener('input', () => { const out = document.getElementById('clavis-kokoro-pause-value'); if (out) out.textContent = Number(pause.value) > .7 ? 'Deliberate' : Number(pause.value) < .25 ? 'Tight' : 'Balanced'; });\n"
        "    pause.dispatchEvent(new Event('input'));\n"
        "  }\n"
        "  const reaction = document.getElementById('clavis-kokoro-reaction');\n"
        "  if (reaction) {\n"
        "    reaction.value = localStorage.getItem('clavis_voice_reaction_intensity') || '0.25';\n"
        "    reaction.addEventListener('input', () => { const out = document.getElementById('clavis-kokoro-reaction-value'); if (out) out.textContent = Number(reaction.value) > .7 ? 'Expressive' : Number(reaction.value) < .25 ? 'Off' : 'Subtle'; });\n"
        "    reaction.dispatchEvent(new Event('input'));\n"
        "  }\n"
        "}\n",
        "function initClavisLocalVoiceControls() {\n"
        "  const voice = localStorage.getItem('clavis_gemini_voice') || 'Charon';\n"
        "  ['clavis-gemini-voice', 'sm-gemini-voice'].forEach((id) => { const el = document.getElementById(id); if (el) el.value = voice; });\n"
        "}\n",
        marker="const voice = localStorage.getItem('clavis_gemini_voice')",
    )
    p.replace(
        "speakJarvisText comment + error text -> Gemini",
        "// Single production voice path: local Kokoro over the cancellable PCM socket.\n"
        "// The old browser/cloud renderers remain named legacy* above so no call site\n"
        "// can accidentally reintroduce a second voice persona.",
        "// Single production voice path: Google Gemini over the cancellable PCM socket.\n"
        "// The old browser/cloud renderers remain named legacy* above so no call site\n"
        "// can accidentally reintroduce a second voice persona.",
        marker="Single production voice path: Google Gemini",
    )
    p.replace(
        "speakJarvisText catch -> Gemini wording",
        "    setJarvisStatus('unavailable', 'Kokoro unavailable — text mode ready');\n"
        "    console.warn('[Clavis local Kokoro]', error);",
        "    setJarvisStatus('unavailable', 'Voice unavailable — text mode ready');\n"
        "    console.warn('[Clavis voice]', error);",
        marker="'[Clavis voice]'",
    )
    return p.save()


def main():
    need = ["index.html", "app.js", "jarvis_ui.js"]
    missing = [f for f in need if not os.path.exists(os.path.join(ROOT, f))]
    if missing:
        raise SystemExit(f"{RED}Missing:{OFF} {', '.join(missing)}")

    print("=" * 60)
    print(" Gemini voice UI patch")
    print("=" * 60)
    n = patch_index_html() + patch_app_js() + patch_jarvis_ui()
    print("\n" + "=" * 60)
    print(f" Done. {n} file(s) updated.")
    print("=" * 60)


if __name__ == "__main__":
    main()
