"""Google callback/session fixtures with the Python API unavailable. No real OAuth account."""
import json
import mimetypes
from pathlib import Path
from urllib.parse import urlparse, parse_qs
from playwright.sync_api import sync_playwright

root=Path(__file__).resolve().parents[1]/'pwa'
artifacts=Path(__file__).resolve().parents[1]/'artifacts'
artifacts.mkdir(exist_ok=True)
exchanges=[]
errors=[]

def route(req):
    url=urlparse(req.request.url)
    path=url.path
    if path=='/public-auth-config.json':
        req.fulfill(json={'supabase_url':'https://mobile.test','supabase_publishable_key':'sb_publishable_fixture'})
    elif path=='/auth/v1/settings':
        req.fulfill(json={'external':{'google':True}})
    elif path=='/auth/v1/authorize':
        params=parse_qs(url.query)
        assert params['provider']==['google'] and params['code_challenge_method']==['s256']
        assert len(params['code_challenge'][0])==43 and 'code_verifier' not in params
        assert params['redirect_to']==['https://mobile.test/']
        # A separate navigation lets Playwright intercept the callback too;
        # routing only intercepts the first request of an HTTP redirect chain.
        req.fulfill(content_type='text/html',body="<script>location.replace('https://mobile.test/?code=google-fixture')</script>")
    elif path=='/auth/v1/token':
        payload=req.request.post_data_json
        assert payload['auth_code']=='google-fixture' and len(payload['code_verifier'])==43
        exchanges.append(payload)
        req.fulfill(json={'access_token':'fixture','refresh_token':'refresh','expires_in':3600,'user':{'id':'owner','email':'google-owner@example.com'},'provider_token':'do-not-store'})
    elif path=='/auth/v1/logout':req.fulfill(json={})
    elif path.startswith('/api/'):
        req.fulfill(status=503,json={'detail':'Cloud operations setup pending. Google account is connected.'})
    else:
        file=root/(path.lstrip('/') or 'index.html')
        if not file.is_file():req.fulfill(status=404);return
        req.fulfill(body=file.read_bytes(),content_type='text/javascript' if file.suffix=='.js' else mimetypes.guess_type(str(file))[0] or 'application/octet-stream')

with sync_playwright() as p:
    browser=p.chromium.launch()
    for width,height in [(320,720),(390,844),(820,1180)]:
        page=browser.new_page(viewport={'width':width,'height':height},reduced_motion='reduce')
        page.on('pageerror',lambda error:errors.append(str(error)))
        page.route('https://mobile.test/**',route)
        page.goto('https://mobile.test/')
        google=page.get_by_role('button',name='Continue with Google',exact=True)
        google.wait_for()
        assert not page.locator('#backend').is_visible()
        assert not page.locator('#nav').is_visible()
        assert not page.locator('#email').is_visible()
        assert page.evaluate('document.documentElement.scrollWidth<=innerWidth')
        page.screenshot(path=str(artifacts/f'google-login-{width}.png'),full_page=True)
        before=len(exchanges)
        google.click()
        try:
            page.get_by_role('heading',name='Namaste, google-owner',exact=True).wait_for(timeout=10000)
        except Exception:
            print({'url':page.url,'status':page.evaluate("document.querySelector('#status')?.textContent"),'errors':errors,'exchanges':len(exchanges)},flush=True)
            raise
        assert len(exchanges)==before+1
        assert urlparse(page.url).query==''
        session=page.evaluate("JSON.parse(localStorage.getItem('rudra-mobile-session'))")
        assert session['user']['id']=='owner' and 'provider_token' not in session
        page.reload()
        page.get_by_role('heading',name='Namaste, google-owner',exact=True).wait_for()
        assert len(exchanges)==before+1
        page.get_by_role('link',name='More',exact=True).click()
        page.get_by_role('button',name='Sign out',exact=True).click()
        google.wait_for()
        assert page.evaluate("localStorage.getItem('rudra-mobile-session')") is None
        page.goto('https://mobile.test/?code=google-fixture')
        google.wait_for()
        try:
            page.wait_for_function("document.querySelector('#status').textContent.includes('expired')",timeout=10000)
        except Exception:
            print({'replay_url':page.url,'status':page.evaluate("document.querySelector('#status')?.textContent"),'errors':errors,'exchanges':len(exchanges),'pending':page.evaluate("localStorage.getItem('rudra-mobile-google-pkce')")},flush=True)
            raise
        assert page.evaluate("localStorage.getItem('rudra-mobile-session')") is None
        assert len(exchanges)==before+1
        page.close()
    browser.close()
assert not errors,errors
print('PASS: 320/390/820px Google-first login, no API needed for sign-in, callback/session/reload/logout/replay protection, no overflow or JS errors')
