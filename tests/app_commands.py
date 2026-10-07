"""App-first commands: ClavisAppMap self-test + real handleJarvisSend turns.

Run:  python3 tests/app_commands.py   (serves THIS checkout via page.route)
"""
import json, os, pathlib, sys
from playwright.sync_api import sync_playwright

ROOT = pathlib.Path(__file__).resolve().parent.parent
BASE = 'http://localhost:3000'
TYPES = {'.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.json': 'application/json',
         '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.woff2': 'font/woff2', '.mp3': 'audio/mpeg', '.wav': 'audio/wav'}


def serve(route):
    path = route.request.url.split(BASE, 1)[1].split('?')[0].split('#')[0] or '/index.html'
    if path == '/':
        path = '/index.html'
    f = ROOT / path.lstrip('/')
    if f.is_file():
        route.fulfill(status=200, body=f.read_bytes(), headers={'Content-Type': TYPES.get(f.suffix, 'application/octet-stream')})
    else:
        route.fulfill(status=404, body='')


def open_app(p):
    b = p.chromium.launch(proxy={'server': os.environ['HTTPS_PROXY']} if os.environ.get('HTTPS_PROXY') else None)
    ctx = b.new_context(ignore_https_errors=True)
    ctx.add_init_script("localStorage.setItem('clavis_setup_snooze_until','9999999999999');")
    ctx.route(BASE + '/**', serve)
    ctx.route('http://localhost:8000/**', lambda r: r.abort())
    ctx.route('ws://**', lambda r: r.abort())
    ctx.route('https://generativelanguage.googleapis.com/**', lambda r: r.abort())
    page = ctx.new_page()
    errors = []
    page.on('pageerror', lambda e: errors.append(str(e)))
    page.goto(BASE + '/index.html', wait_until='load', timeout=90000)
    page.wait_for_function('window.ClavisAppMap && typeof window.handleJarvisSend === "function" && typeof window.showView === "function"', timeout=60000)
    page.wait_for_timeout(1500)
    return b, page, errors


def active_view(page):
    return page.evaluate("window.NEXUS && NEXUS.currentView ? NEXUS.currentView() : null")


def send(page, text):
    page.evaluate('t => handleJarvisSend(t)', text)
    page.wait_for_timeout(500)


def main():
    fails = []

    def check(name, cond):
        print(('PASS ' if cond else 'FAIL ') + name)
        if not cond:
            fails.append(name)

    with sync_playwright() as p:
        b, page, errors = open_app(p)
        st = page.evaluate('ClavisAppMap._selfTest()')
        check(f"self-test {st['total'] - len(st['fails'])}/{st['total']}", st['ok'])
        for f in st['fails']:
            print('   ', f)

        for text, view in [('candidate tab kholo', 'candidate-ai'), ('client AI ka page kholo', 'chat'),
                           ('Rudra24 AI tab kholo', 'jarvis'), ('client tab kholo', 'chat'), ('excel kholo', 'excel')]:
            send(page, text)
            check(f'"{text}" -> {view}', active_view(page) == view)

        # PC cue must NOT change the tab (it goes to the PC path)
        page.evaluate("window.ClavisPC = Object.assign(window.ClavisPC||{}, {open: async (t) => { window.__pcOpened = t; return {ok:true, native:true}; }})")
        send(page, 'candidate tab kholo')
        send(page, 'PC me notepad kholo')
        check('"PC me notepad kholo" leaves the app tab alone', active_view(page) == 'candidate-ai')

        send(page, 'settings me voice kholo')
        sec = page.evaluate("(document.querySelector('#settings-overlay .smodal-nav-item.active')||{}).dataset?.section || null")
        opened = page.evaluate("document.getElementById('settings-overlay')?.classList.contains('open')")
        check('settings opens on Voice section', opened and sec == 'voice-settings')
        page.evaluate("document.getElementById('settings-overlay')?.classList.remove('open')")

        page.evaluate("localStorage.setItem('jarvis_speech_enabled','true'); jarvisSpeechEnabled = true; updateJarvisSpeechIcon()")
        send(page, 'mute')
        pressed = page.evaluate("document.getElementById('jarvis-speak-toggle')?.getAttribute('aria-pressed')")
        check('"mute" flips speech toggle off', page.evaluate('jarvisSpeechEnabled') is False and pressed == 'false')
        send(page, 'unmute')
        check('"unmute" turns speech back on', page.evaluate('jarvisSpeechEnabled') is True)
        send(page, 'mute')

        # compound: two app parts
        page.evaluate("localStorage.setItem('jarvis_speech_enabled','true'); jarvisSpeechEnabled = true; updateJarvisSpeechIcon()")
        send(page, 'candidate tab kholo aur mute karo')
        check('compound "candidate tab kholo aur mute karo" does both',
              active_view(page) == 'candidate-ai' and page.evaluate('jarvisSpeechEnabled') is False)

        # compound: app part + map part. ClavisIntent is stubbed so only the
        # map PART is a map command (the real one is the map agent's).
        page.evaluate("""(() => { window.__intentCalls = [];
          ClavisIntent.route = async (t) => { window.__intentCalls.push(t);
            return (t === 'Delhi map pe dikhao') ? { handled: true, spoken: 'Delhi map par.' } : { handled: false }; }; })()""")
        send(page, 'dashboard kholo aur Delhi map pe dikhao')
        calls = page.evaluate('window.__intentCalls')
        check('compound runs app part', active_view(page) == 'dashboard')
        check('compound runs map part via ClavisIntent', 'Delhi map pe dikhao' in calls)

        # compound with a leftover part → the leftover goes on to the pipeline
        r = page.evaluate("ClavisAppMap.handle('leads kholo aur mujhe ek joke sunao').then(JSON.stringify)")
        r = json.loads(r)
        check('leftover part passed on', r['handled'] and r['rest'] == 'mujhe ek joke sunao' and active_view(page) == 'leads')

        # a lead search is never split and never navigates
        r = json.loads(page.evaluate("ClavisAppMap.handle('Ghaziabad aur Loni ki leads nikalo aur map pe dikhao').then(JSON.stringify)"))
        check('lead search stays whole (not handled by app map)', r['handled'] is False)

        real = [e for e in errors if 'ClavisAppMap' in e or 'clavis-app-map' in e or 'app map' in e]
        check('no page errors from the app map', not real)
        if errors:
            print('   (other page errors seen:', len(errors), ')', errors[:3])
        b.close()
    print('\n%d failed' % len(fails))
    sys.exit(1 if fails else 0)


if __name__ == '__main__':
    main()
