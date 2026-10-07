"""Connector page smoke test with mocked auth/provider state; no external account is touched."""
import json
from pathlib import Path

from playwright.sync_api import sync_playwright


ROOT = Path(__file__).resolve().parents[1]
SHOTS = ROOT / "tests" / "screenshots"
SHOTS.mkdir(exist_ok=True)


def run():
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(headless=True)
        page = browser.new_page(viewport={"width": 1365, "height": 768})
        page.route("**/api/v1/connectors/**", lambda route: route.fulfill(
            status=200, content_type="application/json", body=json.dumps(
                {"connections": {}, "configured": {"telegram": True}} if route.request.url.endswith("/status")
                else {"jobs": []})))
        page.goto("http://localhost:3000/index.html", wait_until="domcontentloaded")
        page.wait_for_function("window.showView && window.ConnectorsPage")
        page.evaluate("""() => {
            window.SupabaseAuth.getSession = () => ({ access_token: 'test-only' });
            window.SupabaseAuth.getAccessToken = () => 'test-only';
            document.getElementById('auth-screen').style.display = 'none';
            document.getElementById('app-shell').style.display = 'flex';
            window.showView('connectors');
        }""")
        later = page.locator('.cx-setup-dialog [data-act="later"]')
        if later.is_visible():
            later.click()
        page.locator(".cx-card").first.wait_for()
        assert page.locator(".cx-card").count() == 11
        assert page.get_by_text("Developer setup required").count() > 0
        assert page.locator(".cx-card-icon img").evaluate_all("images => images.every(img => img.complete && img.naturalWidth > 0)")
        page.screenshot(path=str(SHOTS / "connectors-desktop.png"))
        page.locator("#cx-search").fill("Telegram")
        assert page.locator(".cx-card").count() == 1
        page.locator("#cx-search").fill("")
        page.set_viewport_size({"width": 390, "height": 844})
        if later.is_visible():
            later.click()
        assert page.locator("#view-connectors").evaluate("el => el.scrollWidth <= el.clientWidth + 2")
        page.screenshot(path=str(SHOTS / "connectors-mobile.png"))
        setup_page = browser.new_page(viewport={"width": 1100, "height": 800})
        setup_page.set_content('<html><head></head><body></body></html>')
        setup_page.add_style_tag(path=str(ROOT / 'clavis-setup.css'))
        setup_page.add_script_tag(path=str(ROOT / 'clavis-setup.js'))
        setup_page.evaluate("window.ClavisSetup.open({provider:'apify'})")
        setup_page.locator('#cx-setup-root [data-input="apify"]').wait_for(state='visible')
        setup_page.screenshot(path=str(SHOTS / 'apify-setup.png'))
        browser.close()
    print("Connectors UI passed: cards, icons, search, mobile overflow")


if __name__ == "__main__":
    run()
