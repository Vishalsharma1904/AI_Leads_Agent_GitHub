"""Headless real-time voice test for Rudra24 AI (no real mic).

    python3 tests/voice_rt.py

Serves the app from this worktree via page.route (http://localhost:3000/**),
aborts the optional backend (:8000) and websockets, injects a fake
webkitSpeechRecognition driven from here, stubs the LLM (JarvisEngine.sendMessage)
and TTS (ClavisVoice.speak), then drives spoken turns with real pauses.
"""
import mimetypes
import os
import pathlib
import sys
import time

from playwright.sync_api import sync_playwright

ROOT = pathlib.Path(__file__).resolve().parent.parent
BASE = 'http://localhost:3000'

INIT = r"""
(() => {
  const ls = window.localStorage;
  ls.setItem('clavis_setup_snooze_until', '9999999999999');
  ls.setItem('clavis_mic_permission_granted', 'true');
  ls.setItem('clavis_defaults_v3', '1');
  ls.setItem('jarvis_hands_free', 'true');
  ls.setItem('jarvis_speech_enabled', 'true');
  ls.setItem('clavis_sound_trigger_enabled', 'false');   // the fake mic beep must not "clap"
  ls.setItem('clavis_bargein_enabled', 'false');         // test the semantic barge-in path
  ls.setItem('clavis_live_enabled', 'false');
  // Focus is controlled by the test (background-tab gate).
  window.__away = false;
  Document.prototype.hasFocus = function () { return !window.__away; };

  // ── fake Web Speech: one active recognizer, like Chrome ──
  const SR = window.__sr = { instances: [], active: null, starts: 0, failStarts: 0 };
  class FakeSR {
    constructor() { this.lang = ''; this.continuous = false; this.interimResults = false; this._results = []; this._running = false; SR.instances.push(this); }
    start() {
      if (SR.failStarts > 0) { SR.failStarts--; throw new DOMException('recognition busy', 'InvalidStateError'); }
      if (this._running) throw new DOMException('already started', 'InvalidStateError');
      if (SR.active && SR.active !== this) SR.active._kill('aborted');
      this._running = true; this._results = []; SR.active = this; SR.starts++;
      setTimeout(() => this.onstart && this.onstart(), 5);
    }
    stop() { this._kill(null); }
    abort() { this._kill('aborted'); }
    _kill(err) {
      if (!this._running) return;
      this._running = false;
      if (SR.active === this) SR.active = null;
      setTimeout(() => { if (err && this.onerror) this.onerror({ error: err }); if (this.onend) this.onend(); }, 5);
    }
    _emit(text, isFinal, cont) {
      let last = this._results[this._results.length - 1];
      // A new utterance after a pause: Chrome closes the open result first.
      if (!cont && last && !last.isFinal && !text.startsWith(last[0].transcript)) {
        last.isFinal = true;
        if (this.onresult) this.onresult({ resultIndex: this._results.length - 1, results: this._results });
      }
      if (!last || last.isFinal) { last = [{ transcript: '', confidence: 0.9 }]; this._results.push(last); }
      last[0].transcript = text; last.isFinal = !!isFinal;
      if (this.onresult) this.onresult({ resultIndex: this._results.indexOf(last), results: this._results });
    }
  }
  window.webkitSpeechRecognition = FakeSR;
  window.SpeechRecognition = FakeSR;
  window.__say = (text, isFinal) => { const a = SR.active; if (!a) return false; window.__lastSayAt = Date.now(); a._emit(text, isFinal, false); return true; };
})();
"""

STUBS = r"""
(() => {
  // ── TTS stub: 1.2 s per reply, abortable ──
  const T = window.__tts = { said: [], aborted: 0, speaking: false };
  let cur = null;
  const V = window.ClavisVoice;
  V.speak = (text, opts = {}) => new Promise((resolve) => {
    T.said.push(String(text)); T.speaking = true;
    const done = (ok) => { if (cur !== me) return; cur = null; T.speaking = false; resolve(ok); };
    const me = { done, timer: setTimeout(() => done(true), 2500) };
    cur = me;
    opts.signal?.addEventListener?.('abort', () => { if (cur === me) { clearTimeout(me.timer); T.aborted++; T.abortAt = Date.now(); done(false); } }, { once: true });
  });
  V.isSpeaking = () => T.speaking;
  V.stop = () => { if (cur) { clearTimeout(cur.timer); T.aborted++; T.abortAt = Date.now(); const c = cur; c.done(false); } };

  // ── LLM stub (streams sentences like jarvis.js) ──
  const L = window.__llm = { calls: [], texts: [] };
  const replies = [
    [/error/i, 'Sir, main dekh raha hoon. Kya error aa raha hai?]]'],
    [/mausam|weather/i, 'Aaj Gurgaon me dhoop rahegi, sir. Shaam ko halki hawa chalegi.'],
    [/report/i, 'Report taiyaar hai, sir. Maine "sales summary" naam se rakh di.'],
  ];
  window.JarvisEngine.hasBrain = () => true;
  // Every turn that reaches the router (voice or typed), whoever handles it.
  const S = window.__sent = [];
  const orig = window.handleJarvisSend;
  window.handleJarvisSend = function (o) { S.push({ text: (o && o.text) || (typeof o === 'string' ? o : ''), source: o && o.source, at: Date.now() }); return orig.apply(this, arguments); };
  window.JarvisEngine.sendMessage = async (text, signal, onStep, onTextDelta, extra) => {
    L.calls.push({ text, at: Date.now(), source: extra && extra.source });
    const reply = (replies.find(([re]) => re.test(text)) || [0, 'Ji sir, ho gaya. Aur kuch?'])[1];
    await new Promise((r) => setTimeout(r, 250));   // time to first token
    const parts = reply.match(/[^.!?]+[.!?\]]+/g) || [reply];
    for (const p of parts) {
      if (signal && signal.aborted) throw Object.assign(new Error('cancelled'), { name: 'AbortError' });
      if (onTextDelta) await onTextDelta(p.trim());
      await new Promise((r) => setTimeout(r, 120));
    }
    L.texts.push(reply);
    return { text: reply, toolsRun: [] };
  };
})();
"""


LOGS = []


def main():
    errors, logs = [], LOGS
    with sync_playwright() as p:
        launch = dict(headless=True, args=['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required'])
        if os.environ.get('HTTPS_PROXY'):
            launch['proxy'] = {'server': os.environ['HTTPS_PROXY']}
        browser = p.chromium.launch(**launch)
        ctx = browser.new_context(ignore_https_errors=True, permissions=['microphone'])
        ctx.add_init_script(INIT)
        page = ctx.new_page()
        page.on('pageerror', lambda e: errors.append(str(e)))
        page.on('console', lambda m: logs.append(f'{m.type}: {m.text}'))

        def serve(route):
            url = route.request.url.split('?')[0].split('#')[0]
            rel = url[len(BASE):].lstrip('/') or 'index.html'
            f = (ROOT / rel).resolve()
            if ROOT in f.parents and f.is_file():
                ctype = mimetypes.guess_type(str(f))[0] or 'application/octet-stream'
                route.fulfill(status=200, body=f.read_bytes(), headers={'content-type': ctype, 'cache-control': 'no-store'})
            else:
                route.fulfill(status=404, body='')
        page.route(BASE + '/**', serve)
        page.route('http://localhost:8000/**', lambda r: r.abort())
        page.route('http://127.0.0.1:8000/**', lambda r: r.abort())
        page.route(lambda u: u.startswith('ws://') or u.startswith('wss://'), lambda r: r.abort())
        # Third-party network is irrelevant to the voice pipeline and slow via the proxy.
        page.route(lambda u: not u.startswith(BASE), lambda r: r.abort())

        page.goto(BASE + '/index.html#jarvis', wait_until='domcontentloaded')
        page.wait_for_function('() => typeof window.initJarvisUI === "function" && window.ClavisVoiceState && window.JarvisEngine && window.ClavisVoice', timeout=30000)
        page.evaluate('() => { if (location.hash !== "#jarvis") location.hash = "#jarvis"; try { window.initJarvisUI && window.initJarvisUI(); } catch (e) {} }')
        # The boot greeting (real voice) says "…'Rudra' boliye" — silence it first,
        # otherwise "hey clavis" said over it is (correctly) treated as its echo.
        page.wait_for_timeout(1500)
        page.evaluate('() => { try { window.stopJarvisSpeech(); window.ClavisVoice.stop(); window.speechSynthesis && speechSynthesis.cancel(); } catch (e) {} }')
        page.evaluate(STUBS)
        page.wait_for_function('() => !window.ClavisEar.isSpeaking() && window.ClavisEar.msSinceSpoke() > 3000', timeout=20000)

        def js(expr, arg=None):
            return page.evaluate(expr, arg)

        def say(text, final=False):
            ok = js('([t, f]) => window.__say(t, f)', [text, final])
            assert ok, f'no active recognizer when saying {text!r}'

        def wait(cond, timeout=6.0, msg=''):
            t0 = time.time()
            while time.time() - t0 < timeout:
                if js(cond):
                    return time.time() - t0
                time.sleep(0.05)
            raise AssertionError(f'timeout: {msg or cond}')

        def caption():
            return js('() => (document.querySelector("#clavis-ear-caption .ce-line") || {}).textContent || ""')

        def llm_calls():
            return js('() => window.__llm.calls.length')

        wait('() => window.__sr.active && window.ClavisVoiceState.mic.owner === "wake"', 10, 'wake listener running')
        print('wake listener up; state', js('() => ClavisVoiceState.state()'))

        # ── turn 1: wake word + sentence with a 2 s mid-sentence pause ──
        say('hey clavis')
        time.sleep(0.3)
        wait('() => ClavisWake.isAwake()', 2, 'woke on name')
        say('hey clavis mujhe aaj ka')
        t_pause = time.time()
        wait('() => (document.querySelector("#clavis-ear-caption .ce-line")||{}).textContent.includes("mujhe aaj ka")', 2, 'partial in caption')
        print('partial caption:', repr(caption()))
        time.sleep(max(0, 2.0 - (time.time() - t_pause)))
        assert llm_calls() == 0, 'a 2 s pause after a dangling word must not commit'
        say('hey clavis mujhe aaj ka mausam batao', True)
        t_final = time.time()
        wait('() => window.__llm.calls.length === 1', 3, 'turn 1 dispatched')
        print('marks:', js('() => { const r = ClavisVoiceState.metrics().raw.slice(-1)[0]; const b = r.last_voice; return Object.fromEntries(Object.entries(r).map(([k, v]) => [k, v - b])); }'), js('() => window.__llm.calls[0].at') - js('() => ClavisVoiceState.metrics().raw.slice(-1)[0].last_voice'))
        print(f'turn 1 dispatched {int((time.time() - t_final) * 1000)} ms after the final word')
        assert js('() => window.__llm.calls[0].text') == 'mujhe aaj ka mausam batao', js('() => window.__llm.calls[0].text')
        wait('() => window.__tts.said.length >= 1', 3, 'reply spoken')
        wait('() => !window.__tts.speaking && ClavisVoiceState.state() === "LISTENING"', 6, 'back to listening')

        # ── turn 2 + 3: no wake word (continuous session) ──
        assert js('() => ClavisWake.isAwake()'), 'session must still be awake'
        say('aur kal ka mausam kaisa rahega')
        time.sleep(0.2)
        say('aur kal ka mausam kaisa rahega?', True)
        wait('() => window.__llm.calls.length === 2', 3, 'turn 2 (no wake word)')
        wait('() => !window.__tts.speaking && window.__tts.said.length >= 2 && ClavisVoiceState.state() === "LISTENING"', 8, 'turn 2 reply done')
        say('ek error aa raha hai check karo', True)
        wait('() => window.__llm.calls.length === 3', 3, 'turn 3 (no wake word)')

        # ── barge-in during TTS: echo is ignored, "chup" stops it ──
        wait('() => window.__tts.speaking', 3, 'turn 3 speaking')
        said3 = js('() => window.__tts.said.slice(-1)[0]')
        say(said3.lower(), True)              # its own voice heard back
        time.sleep(0.1)
        assert js('() => window.__tts.speaking'), 'echo must not interrupt'
        aborted = js('() => window.__tts.aborted')
        t0 = time.time()
        say('chup')
        wait(f'() => window.__tts.aborted > {aborted} && !window.__tts.speaking', 1, 'barge-in stopped TTS')
        print('barge-in stop:', js('() => window.__tts.abortAt - window.__lastSayAt'), 'ms after the partial')
        time.sleep(1.5)
        assert llm_calls() == 3, 'echo / "chup" must not become a turn'
        texts = js('() => window.__tts.said.join(" | ")')
        body = js('() => document.body.innerText')
        assert ']]' not in texts, f'"]]" spoken: {texts}'
        assert ']]' not in body, 'rendered "]]"'

        # ── background tab: an action is asked first; "haan" runs / "na" drops ──
        js('() => { window.__away = true; }')
        n = js('() => window.__sent.length')
        say('sales ki report likh do', True)
        wait('() => window.__tts.said.some((t) => t.includes("dusre tab"))', 3, 'gate asked')
        wait('() => !window.__tts.speaking', 6)
        time.sleep(0.3)
        assert js('() => window.__sent.length') == n, 'must not run before yes'
        say('haan', True)
        wait(f'() => window.__sent.length === {n + 1}', 3, '"haan" runs it')
        wait('() => !window.__tts.speaking && ClavisVoiceState.state() === "LISTENING"', 8)
        n = js('() => window.__sent.length')
        say('chrome me naya tab kholo', True)
        wait('() => window.__tts.said.filter((t) => t.includes("dusre tab")).length === 2', 3, 'gate asked again')
        wait('() => !window.__tts.speaking', 6)
        say('na', True)
        wait('() => window.__tts.said.some((t) => t.includes("nahi karta"))', 3, '"na" acknowledged')
        time.sleep(0.5)
        assert js('() => window.__sent.length') == n, '"na" must drop it'
        # typed turn while away: never gated
        wait('() => !window.__tts.speaking', 6)
        js('() => { const i = document.getElementById("jarvis-input"); i.value = "typed: aaj ka mausam"; window.handleJarvisSend(); }')
        wait(f'() => window.__sent.length === {n + 1} && window.__sent[{n}].source !== "voice"', 3, 'typed turn not gated')
        js('() => { window.__away = false; }')
        wait(f'() => window.__llm.texts.length >= window.__llm.calls.length', 5, 'typed reply done')
        time.sleep(0.3)
        wait('() => !window.__tts.speaking', 8)

        # -- "ruko" holds the turn until "ab batao" --
        n = js('() => window.__sent.length')
        say('ruko', True)
        time.sleep(0.3)
        say('mujhe gurgaon ki report chahiye', True)
        time.sleep(3.0)
        assert js('() => window.__sent.length') == n, '"ruko" must hold the turn'
        say('ab batao', True)
        wait(f'() => window.__sent.length === {n + 1}', 2, '"ab batao" releases')
        held = js(f'() => window.__sent[{n}].text')
        assert held == 'mujhe gurgaon ki report chahiye', held
        wait('() => !window.__tts.speaking && ClavisVoiceState.state() === "LISTENING"', 8)
        n = js('() => window.__sent.length') - 2

        # -- debug panel --
        page.keyboard.press('Control+Shift+D')
        wait('() => !!document.querySelector("#clavis-voice-debug .cvs-body div")', 2, 'Ctrl+Shift+D panel')
        page.keyboard.press('Control+Shift+D')

        # ── silent mode ──
        say('5 minute chup raho', True)
        wait('() => ClavisVoiceState.state() === "SILENT_MODE"', 3, 'silent mode')
        k = js('() => window.__tts.said.length')
        say('aaj ka mausam batao', True)
        wait(f'() => window.__sent.length === {n + 2}', 3, 'silent mode still listens')
        time.sleep(1.0)
        assert js('() => window.__tts.said.length') == k, 'silent mode must not speak'
        js('() => ClavisVoiceState.unsilence()')

        # ── watchdog: recognizer dies and cannot restart itself ──
        js('() => { window.__sr.failStarts = 1; window.__sr.active._kill("network"); }')
        t0 = time.time()
        wait('() => window.__sr.active && window.__sr.active._running', 4, 'watchdog restarted the recognizer')
        print(f'watchdog restart: {int((time.time() - t0) * 1000)} ms')

        # ── "bas karo" ends the session ──
        say('bas karo', True)
        wait('() => !ClavisWake.isAwake() && ClavisVoiceState.state() === "SLEEPING"', 3, 'bas karo sleeps')
        wait('() => window.__sr.active && ClavisVoiceState.mic.owner === "wake"', 4, 'wake listener back')
        n = js('() => window.__sent.length')
        say('aaj ka mausam batao', True)
        time.sleep(1.8)
        assert js('() => window.__sent.length') == n, 'asleep: nothing runs without the wake word'

        m = js('() => ClavisVoiceState.metrics()')
        print('\nlatency (ms)          last   p50   p90   p95   n')
        for k2, s in m['spans'].items():
            print(f"  {k2:20s} {str(m['last'].get(k2, '-')):>5} {str(s['p50']):>5} {str(s['p90']):>5} {str(s['p95']):>5} {s['n']:>3}")
        print('recognizer starts:', js('() => window.__sr.starts'), '| mic restarts by watchdog:', js('() => ClavisVoiceState.mic.restarts'))
        browser.close()

    real_errors = [e for e in errors if 'Failed to fetch' not in e and 'NetworkError' not in e]
    if real_errors:
        print('\npageerrors:\n  ' + '\n  '.join(real_errors))
    assert not real_errors, 'page errors'
    print('\nvoice_rt: all passed')


if __name__ == '__main__':
    try:
        main()
    except AssertionError as e:
        print('FAIL:', e)
        print('--- last console lines ---')
        print('\n'.join([l for l in LOGS if 'Rudra' in l or 'Wake' in l or 'Ear' in l][-40:]))
        sys.exit(1)
