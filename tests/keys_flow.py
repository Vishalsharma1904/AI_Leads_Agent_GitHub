"""Setup popup key flow: paste fills (no save), Check & Save tests quota honestly.

Run:  python3 tests/keys_flow.py   (serves THIS checkout via page.route; Google mocked per key)
"""
import json, os, sys, urllib.parse
from playwright.sync_api import sync_playwright
from app_commands import BASE, serve

K_OK = 'AQ.Ab8RN6working' + 'x' * 24
K_QUOTA = 'AQ.Ab8RN6quota00' + 'y' * 24
K_BAD = 'AQ.Ab8RN6invalid' + 'z' * 24
MODELS = {'models': [
    {'name': 'models/gemini-2.5-flash', 'supportedGenerationMethods': ['generateContent']},
    {'name': 'models/gemini-2.5-flash-lite', 'supportedGenerationMethods': ['generateContent']},
    {'name': 'models/gemini-2.5-flash-native-audio-preview-12-2025', 'supportedGenerationMethods': ['bidiGenerateContent']},
]}
QUOTA_BODY = {'error': {'code': 429, 'status': 'RESOURCE_EXHAUSTED', 'message': 'You exceeded your current quota.',
                        'details': [{'violations': [{'quotaId': 'GenerateRequestsPerDayPerProjectPerModel-FreeTier'}]}]}}
BAD_BODY = {'error': {'code': 400, 'status': 'INVALID_ARGUMENT', 'message': 'API key not valid. Please pass a valid API key.',
                      'details': [{'reason': 'API_KEY_INVALID'}]}}
backend_posts = []
google_calls = []


def google(route):
    url = route.request.url
    key = urllib.parse.parse_qs(urllib.parse.urlparse(url).query).get('key', [''])[0]
    gen = ':generateContent' in url
    google_calls.append((key[-6:], 'gen' if gen else 'list'))
    j = lambda s, b: route.fulfill(status=s, body=json.dumps(b), headers={'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*'})
    if key == K_BAD:
        return j(400, BAD_BODY)
    if not gen:
        return j(200, MODELS)
    if key == K_QUOTA:
        return j(429, QUOTA_BODY)
    return j(200, {'candidates': [{'content': {'parts': [{'text': 'H'}]}}]})


def backend(route):
    if route.request.method == 'OPTIONS':
        return route.fulfill(status=204, headers={'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': 'POST'})
    backend_posts.append(json.loads(route.request.post_data or '{}'))
    route.fulfill(status=200, body='{"success":true}', headers={'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*'})


def main():
    fails = []

    def check(name, cond):
        print(('PASS ' if cond else 'FAIL ') + name)
        if not cond:
            fails.append(name)

    with sync_playwright() as p:
        b = p.chromium.launch(proxy={'server': os.environ['HTTPS_PROXY']} if os.environ.get('HTTPS_PROXY') else None)
        ctx = b.new_context(ignore_https_errors=True)
        ctx.add_init_script("localStorage.setItem('clavis_setup_snooze_until','9999999999999');")
        ctx.route(BASE + '/**', serve)
        ctx.route('http://localhost:8000/**', lambda r: r.abort())
        ctx.route('http://localhost:8000/api/credentials/gemini-local', backend)
        ctx.route('ws://**', lambda r: r.abort())
        ctx.route('https://generativelanguage.googleapis.com/**', google)
        page = ctx.new_page()
        errors = []
        page.on('pageerror', lambda e: errors.append(str(e)))
        page.goto(BASE + '/index.html', wait_until='load', timeout=90000)
        page.wait_for_function('window.ClavisSetup && window.ClavisKeyVault', timeout=60000)
        page.evaluate('ClavisKeyVault.ready()')
        page.wait_for_timeout(1500)
        # first-run mic/permissions sheet (clavis-ear.js) sits on top — not part of this test
        page.evaluate("document.getElementById('clavis-voiceid-sheet')?.remove()")
        page.evaluate("ClavisSetup.open({ provider: 'gemini' })")
        page.wait_for_timeout(400)

        inp = '[data-input="gemini"]'
        msg = '[data-msg="gemini"]'
        chip = lambda: page.inner_text('[data-chip="gemini"]')
        vault0 = lambda: page.evaluate("ClavisKeyVault.all('gemini')[0] || ''")

        def paste(key):
            page.evaluate("""k => { const i = document.querySelector('[data-input="gemini"]'); i.focus(); i.value = k;
                i.dispatchEvent(new ClipboardEvent('paste', { bubbles: true })); }""", key)
            page.wait_for_timeout(300)

        def save():
            page.click('[data-act="save"][data-p="gemini"]')
            page.wait_for_function("!document.querySelector('[data-card=\"gemini\"]').classList.contains('is-busy')", timeout=20000)
            page.wait_for_timeout(300)

        # 1. paste fills, does not save
        paste(K_OK)
        check('paste keeps the key in the field', page.input_value(inp) == K_OK)
        check('paste does not save', vault0() != K_OK)
        check('paste shows "Check & Save" hint', 'Check & Save' in page.inner_text(msg))

        # 2. Check & Save → saved, working, backend copy
        save()
        check('Check & Save stores the key first', vault0() == K_OK)
        check('chip says Connected', chip() == 'Connected')
        check('message says it works', 'chal rahi hai' in page.inner_text(msg))
        page.wait_for_timeout(300)
        check('backend POST sent with the key', {'key': K_OK} in backend_posts)
        check('field shows saved mask as placeholder', page.get_attribute(inp, 'placeholder').startswith('Saved: AQ.'))
        check('a real 1-token test call was made', (K_OK[-6:], 'gen') in google_calls)

        # 3. quota-exhausted key → saved + honest per-project / reset message
        paste(K_QUOTA)
        save()
        text = page.inner_text(msg)
        check('429 key is still saved', page.evaluate("ClavisKeyVault.all('gemini').includes(%s)" % json.dumps(K_QUOTA)))
        check('quota message: per project + new project + reset time',
              'project' in text and 'new project' in text and ('12:30' in text or '1:30' in text))

        # 4. invalid key → not saved
        paste(K_BAD)
        save()
        check('invalid key is not saved', not page.evaluate("ClavisKeyVault.all('gemini').includes(%s)" % json.dumps(K_BAD)))
        check('invalid key message', 'sahi nahi' in page.inner_text(msg))

        # 5. every key spent → "Quota khatam"; re-applying the old key clears it
        page.evaluate("""() => { const n = ClavisKeyVault.all('gemini').length;
            for (let i = 0; i < n; i++) ClavisKeyVault.report('gemini', 'exhausted');
            localStorage.setItem('clavis_live_spent', JSON.stringify({ [%s.slice(-6)]: Date.now() })); }""" % json.dumps(K_OK))
        page.evaluate("ClavisSetup.open({ provider: 'gemini' })")
        page.wait_for_timeout(300)
        check('all spent → chip "Quota khatam"', chip() == 'Quota khatam')
        paste(K_OK)
        save()
        check('re-applied old key → chip Connected', chip() == 'Connected')
        check('re-applied key is used first', vault0() == K_OK)
        check('live spent entry cleared', K_OK[-6:] not in page.evaluate("localStorage.getItem('clavis_live_spent') || ''"))
        check('ClavisDirect.keyFor returns it', page.evaluate("ClavisDirect.keyFor('gemini')") == K_OK)

        # 6. public API used by Settings → Voice
        r = page.evaluate("ClavisSetup.saveKey('gemini', %s)" % json.dumps(K_QUOTA))
        check('ClavisSetup.saveKey → quota status', r['saved'] and r['status'] == 'quota')
        r = page.evaluate("ClavisSetup.saveKey('gemini', %s)" % json.dumps(K_BAD))
        check('ClavisSetup.saveKey → invalid, not saved', not r['saved'] and r['status'] == 'invalid')

        mine = [e for e in errors if 'setup' in e.lower() or 'vault' in e.lower()]
        check('no page errors from setup/vault', not mine)
        b.close()
    print('\n%d failed' % len(fails))
    sys.exit(1 if fails else 0)


if __name__ == '__main__':
    sys.path.insert(0, os.path.dirname(__file__))
    main()
