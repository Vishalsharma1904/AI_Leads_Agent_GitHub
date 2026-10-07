"""Check the setup recovery shown when Chrome blocks microphone access."""
from playwright.sync_api import sync_playwright
from pw_harness import open_app


with sync_playwright() as pw:
    browser, page, errors = open_app(pw)
    page.evaluate("""() => {
      navigator.mediaDevices.getUserMedia = () => Promise.reject(new DOMException('Blocked', 'NotAllowedError'));
      ClavisSetup.open({reason:'manual'});
    }""")
    page.locator('#cx-setup-root [data-act="mic"]').click()
    page.wait_for_function("() => ClavisSetup.status().mic === 'denied'")
    assert page.locator('#cx-setup-root [data-mic-label]').inner_text() == 'Permission dobara check karein'
    assert 'Site settings' in page.locator('#cx-setup-root [data-msg="mic"]').inner_text()
    assert not errors, errors
    browser.close()
    print('PASS blocked mic recovery')
