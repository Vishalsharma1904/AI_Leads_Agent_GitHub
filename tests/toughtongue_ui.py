"""Browser smoke for the embedded agent setup and call request, with provider mocked."""
import json
from pathlib import Path
from playwright.sync_api import sync_playwright
from pw_harness import open_app, _json

SCENARIO_ID = '689e283d8ff2b6aca6239d8b'
saved = {}


def backend(route):
    url = route.request.url
    method = route.request.method
    if url.endswith('/api/credentials') and method == 'PUT':
        assert json.loads(route.request.post_data)['provider'] == 'toughtongue'
        return _json(route, {'success': True})
    if url.endswith('/api/v1/toughtongue/trunks'):
        return _json(route, {'trunks': [{'id': 'trunk-1', 'name': 'Business line'}]})
    if url.endswith('/api/v1/toughtongue/generate'):
        return _json(route, {'name': 'Sales assistant', 'ai_instructions': 'You are a sales agent. Qualify the lead.',
                             'user_friendly_description': 'Talk about our services', 'user_instructions': 'Be ready to answer questions.'})
    if url.endswith('/api/v1/toughtongue/scenarios'):
        if method == 'GET':
            return _json(route, {'scenarios': [{'id': SCENARIO_ID, 'name': saved['name']}] if saved else []})
        saved.update(json.loads(route.request.post_data)['config'])
        return _json(route, {'id': SCENARIO_ID, 'name': saved['name']})
    if url.endswith(f'/api/v1/toughtongue/scenarios/{SCENARIO_ID}/preview'):
        return _json(route, {'iframe_src': f'https://app.toughtongueai.com/embed/{SCENARIO_ID}?scenarioAccessToken=short-lived'})
    if url.endswith(f'/api/v1/toughtongue/scenarios/{SCENARIO_ID}/calls'):
        return _json(route, {'calls': []})
    if url.endswith('/api/v1/toughtongue/calls'):
        body = json.loads(route.request.post_data)
        assert body['scenario_id'] == SCENARIO_ID and body['phone_number'] == '+919876543210'
        return _json(route, {'success': True, 'call_id': 'call-1'})
    return _json(route, {'detail': 'No fixture'}, 404)


with sync_playwright() as pw:
    browser, page, errors = open_app(pw, backend=backend, wait_for="() => typeof VoiceAI !== 'undefined' && document.getElementById('tt-form')")
    try:
        page.evaluate("window.SupabaseAuth.getAccessToken = () => 'verified-test-token'")
        page.evaluate("showView('voice-ai')")
        page.locator('#tt-key').fill('test-pat')
        page.get_by_role('button', name='Connect account').click()
        page.wait_for_function("document.querySelector('#tt-status').textContent.includes('connected')")
        page.locator('#tt-brief').fill('We sell security staffing to hotels. Qualify prospects and offer a meeting.')
        page.get_by_role('button', name='Draft with AI').click()
        page.wait_for_function("document.querySelector('#tt-status').textContent.includes('Draft ready')")
        assert 'Qualify the lead' in page.locator('#tt-form [name=ai_instructions]').input_value()
        page.locator('#tt-form button[type=submit]').click()
        page.wait_for_function("document.querySelector('#tt-status').textContent.includes('saved')")
        assert page.locator('#tt-agents button').count() == 1
        page.get_by_role('button', name='Test in app').click()
        page.wait_for_function("document.querySelector('#tt-preview').hidden === false")
        assert SCENARIO_ID in page.locator('#tt-frame').get_attribute('src')
        page.locator('#tt-call-form [name=phone_number]').fill('+919876543210')
        page.locator('#tt-call-form [name=sip_trunk_id]').select_option('trunk-1')
        page.locator('#tt-call-form [name=permission]').check()
        page.get_by_role('button', name='Place call').click()
        page.wait_for_function("document.querySelector('#tt-call-result').textContent.includes('call-1')")
        page.locator('#view-voice-ai').screenshot(path=str(Path(__file__).parent / 'screenshots' / 'toughtongue-studio.png'))
        print('PASS connect, AI draft, create, preview and call request in app')
        print('Page errors:', errors[:3])
    finally:
        browser.close()
