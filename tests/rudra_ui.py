"""Offline login, branding, language and workspace voice checks."""
from playwright.sync_api import sync_playwright
from pw_harness import ROOT, SHOTS
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from threading import Thread

class QuietHandler(SimpleHTTPRequestHandler):
    def log_message(self, *args):
        pass

server = ThreadingHTTPServer(('127.0.0.1', 0), partial(QuietHandler, directory=str(ROOT)))
Thread(target=server.serve_forever, daemon=True).start()

with sync_playwright() as pw:
    browser = pw.chromium.launch()
    page = browser.new_page(viewport={'width': 1366, 'height': 768})
    errors = []
    page.on('pageerror', lambda error: errors.append(str(error)))
    page.goto(f'http://127.0.0.1:{server.server_port}/index.html', wait_until='domcontentloaded')
    page.wait_for_function('() => window.RudraI18n && window.ClavisVoiceState')
    page.wait_for_timeout(1500)
    assert page.title() == 'Rudra24 AI'
    assert page.locator('#auth-screen').is_visible()
    assert page.locator('.ag-logo-emblem img').evaluate('(img) => img.complete && img.naturalWidth > 0')
    assert page.locator('#rudra-auth-language').count() == 1
    assert page.locator('#rudra-topbar-language').count() == 1
    assert page.evaluate('() => !ClavisVoiceState.canSpeak() && !ClavisVoiceState.canProcessMic()')
    page.select_option('#rudra-auth-language', 'hi')
    assert page.locator('#ag-tab-login').inner_text().strip() == 'साइन इन करें'
    page.select_option('#rudra-auth-language', 'hinglish')
    assert page.locator('#ag-tab-login').inner_text().strip() == 'Sign in karein'
    catalog = page.evaluate('() => window.RUDRA_LOCALES')
    choices = page.locator('#rudra-auth-language option').evaluate_all('(options) => options.map(option => option.value)')
    assert set(choices) == {'en', 'hi', 'hinglish', *catalog.keys()}
    for code, translations in catalog.items():
        assert len(translations) == 44, (code, len(translations))
        page.select_option('#rudra-auth-language', code)
        assert page.locator('#ag-tab-login').inner_text().strip() == translations['Sign In'], code
        assert page.locator('#ag-google-btn-text').inner_text().strip() == translations['Continue with Google'], code
        assert page.locator('#rudra-topbar-language').input_value() == code
        assert page.locator('#rudra-auth-language').get_attribute('aria-label') == translations['Language'], code
        assert page.locator('html').get_attribute('dir') == ('rtl' if code in ('ar', 'ur') else 'ltr')
        if code in ('bn', 'ar'):
            page.screenshot(path=str(SHOTS / f'rudra-login-{code}.png'))
    page.select_option('#rudra-auth-language', 'en')
    assert page.locator('#ag-tab-login').inner_text().strip() == 'Sign In'
    assert 'Rudra' not in page.locator('#auth-screen').inner_text()
    page.screenshot(path=str(SHOTS / 'rudra-login.png'))
    assert not errors, errors
    browser.close()
    print(f'PASS Rudra login, {len(choices)} languages, restore and voice gate')
server.shutdown()
