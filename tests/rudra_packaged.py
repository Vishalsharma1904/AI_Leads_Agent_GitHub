"""Run against a packaged app launched with --remote-debugging-port=9229."""
from pathlib import Path
from playwright.sync_api import sync_playwright

with sync_playwright() as pw:
    browser = pw.chromium.connect_over_cdp('http://127.0.0.1:9229')
    page = browser.contexts[0].pages[0]
    page.wait_for_function('() => window.RudraI18n && window.ClavisVoiceState')
    assert page.title() == 'Rudra24 AI'
    assert page.locator('.ag-logo-emblem img').evaluate('(img) => img.naturalWidth > 0')
    assert page.evaluate("async () => (await navigator.permissions.query({name:'microphone'})).state") == 'granted'
    assert page.evaluate('() => !ClavisVoiceState.canSpeak() && !ClavisVoiceState.canProcessMic()')
    assert page.request.get('http://localhost:3210/backend/.env').status == 404
    assert page.request.get('http://localhost:8778/ping').ok
    page.screenshot(path=str(Path(__file__).parent / 'screenshots' / 'rudra-packaged.png'))
    print('PASS packaged Rudra title/logo, mic permission, login voice gate, bridge and secret blocking')
