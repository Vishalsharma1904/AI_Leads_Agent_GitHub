"""Browser smoke test for the existing Rudra24 AI developer and support surfaces."""
import pathlib
from playwright.sync_api import sync_playwright
from pw_harness import open_app, _json


def backend(route):
    path = route.request.url.split('/api/insights')[-1].split('?')[0]
    if path == '/me':
        return _json(route, {'developer': True, 'email': 'vishalsharma190405@gmail.com'})
    if path == '/dashboard':
        return _json(route, {'metrics': {'users_lifetime': 42, 'first_seen_today': 3, 'sessions_today': 15, 'signed_in_today': 8,
                                        'active_users': 7, 'active_devices': 9, 'usage_hours': 128.5,
                                        'open_bugs': 1, 'errors_week': 2},
                             'daily_sessions': [{'date': '2026-09-29', 'count': 15}],
                             'peak_hours_local': [{'hour': h, 'count': h % 6} for h in range(24)],
                             'platforms': {'Windows': 20}, 'active_regions': {'Asia/Kolkata': 7},
                             'devices': [{'user': 'member@example.com', 'label': 'Desktop · Windows',
                                          'platform': 'Windows', 'region': 'Asia/Kolkata',
                                          'last_seen_at': 1790680000, 'active': True}],
                             'bugs': [{'id': '1', 'email': 'member@example.com', 'title': 'Settings freezes',
                                       'description': 'The theme control froze.', 'steps': 'Open settings',
                                       'page': '#settings', 'status': 'open', 'created_at': 1790680000}],
                             'errors': []})
    if path == '/bugs' and route.request.method == 'POST':
        return _json(route, {'id': '2', 'status': 'open'}, 201)
    if path == '/bugs/1' and route.request.method == 'PATCH':
        return _json(route, {'id': '1', 'status': 'resolved'})
    return _json(route, {'ok': True})


with sync_playwright() as pw:
    browser, page, errors = open_app(pw, backend=backend)
    try:
        page.evaluate("window.SupabaseAuth.getAccessToken = () => 'verified-test-token'")
        page.evaluate("location.hash = '#developer'")
        page.wait_for_selector('#di-content:not([hidden])', timeout=15000)
        assert page.locator('#di-metrics .di-metric').count() == 6
        assert page.locator('#di-bugs .di-bug').count() == 1
        assert page.locator('#developer-nav').is_visible()
        page.locator('#di-bugs select').select_option('resolved')
        page.evaluate('ProductInsights.openReport()')
        assert page.locator('#di-report-overlay').is_visible()
        page.locator('#di-report-form [name=title]').fill('Button stopped working')
        page.locator('#di-report-form [name=description]').fill('The save button stopped working after the theme changed.')
        assert page.locator('#di-report-form').evaluate('(form) => form.checkValidity()'), 'Report form did not retain its fields'
        page.locator('#di-report-form [type=submit]').click()
        page.wait_for_function("document.querySelector('#di-report-status').textContent.includes('Report received')")
        page.locator('.di-close').click()
        page.screenshot(path=str(pathlib.Path(__file__).parent / 'screenshots' / 'developer-insights.png'))
        page.set_viewport_size({'width': 390, 'height': 800})
        assert page.locator('#di-metrics .di-metric').count() == 6
        assert page.evaluate("document.querySelector('#view-developer').scrollWidth <= document.querySelector('#view-developer').clientWidth + 2")
        page.evaluate("document.documentElement.setAttribute('data-theme', 'dark'); ProductInsights.openReport()")
        assert page.locator('#di-report-overlay').is_visible()
        print('PASS developer metrics, activity, report status, report submission')
        print('PASS mobile width and dark report dialog')
        print('Page errors:', errors[:3])
    finally:
        browser.close()
