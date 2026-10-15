"""Browser checks of shipped control scripts, with isolated authenticated fixtures."""
from pathlib import Path
from playwright.sync_api import sync_playwright
import json

ROOT=Path(__file__).resolve().parents[1]
policy={'user_id':'member','owner':False,'status':'trial','expires_at':0,'features':{'ai':True,'leads':True,'voice':True,'calls':True,'whatsapp':True},'monthly_limits':{},'revision':1,'disclosure':{'version':'2026-10-13','accepted':False},'limits':{'meters':{'ai':{'used':2,'limit':300},'leads':{'used':1,'limit':50},'calls':{'used':0,'limit':25},'whatsapp':{'used':0,'limit':20}}},'subscription':{'plan_label':'Owner access','active':True},'note':'','providers':[{'provider':'groq','mode':'shared','configured':True}], 'email':'member@example.com','name':'<img src=x onerror=alert(1)>','phone':'','company':'Acme','devices':[]}
calls=[]
def handler(route):
    url=route.request.url
    if '/api/control/' in url:
        path=url.split('/api/control')[-1].split('?')[0];method=route.request.method;calls.append((path,method,route.request.post_data))
        if path=='/events':return route.fulfill(status=503,body='{}',content_type='application/json')
        if path=='/me':data=policy
        elif path=='/disclosure':policy['disclosure']['accepted']=True;data={'accepted':True}
        elif path=='/users':data={'items':[{'id':'member','name':policy['name'],'email':policy['email'],'status':'trial'}],'total':1,'offset':0,'limit':30}
        elif path=='/users/member' and method=='PATCH':data=policy
        elif path=='/users/member':data=policy
        elif path=='/users/member/providers/groq':data={'ok':True}
        elif path=='/users/member/audit':data={'items':[{'action':'account.view','created_at':0}],'total':1}
        elif path=='/users/member/usage':data={'items':[{'meter':'ai','amount':2,'basis':'provider_reported','state':'succeeded'}],'total':1}
        elif path=='/providers':data={'items':[{'provider':'groq','configured':True,'enabled':True,'monthly_requests':50,'used_requests':2,'monthly_spend_inr':100,'max_request_cost_inr':2}]}
        elif path=='/releases':data={'items':[]}
        else:data={'ok':True}
        return route.fulfill(body=json.dumps(data),content_type='application/json')
    path=url.split('http://localhost:3025/')[-1].split('?')[0]
    if path=='index.html':return route.fulfill(body='<html><head><link rel="stylesheet" href="developer-control.css"></head><body><main><div class="di-shell"></div></main><script src="developer-control.js"></script><script src="account-control.js"></script><script src="clavis-perf.js"></script></body></html>',content_type='text/html')
    file=ROOT/path
    if file.is_file():return route.fulfill(path=str(file))
    route.abort()

with sync_playwright() as pw:
    browser=pw.chromium.launch()
    ctx=browser.new_context(viewport={'width':1280,'height':900})
    ctx.route('**/*',handler)
    ctx.add_init_script("window.SKYLARK_CONFIG={BACKEND_URL:'http://localhost:3025'};window.identity='member';window.SupabaseAuth={getAccessToken:()=>window.identity?'fixture-'+window.identity:'',getUser:()=>window.identity?{id:window.identity}:null,signOut:async()=>{window.identity='';window.dispatchEvent(new CustomEvent('rudra:auth-state'));}};")
    page=ctx.new_page();errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
    page.goto('http://localhost:3025/index.html#developer')
    page.get_by_role('button',name='I understand — continue').click()
    page.wait_for_selector('.rudra-disclosure',state='detached')
    page.get_by_role('button',name='Open workspace').click()
    page.get_by_role('heading',name='Access & subscription').wait_for()
    assert page.locator('#developer-control img').count()==0
    page.get_by_label('ai per day',exact=True).fill('42')
    page.get_by_role('button',name='Save access & limits').click()
    page.wait_for_timeout(250)
    updates=[json.loads(body) for path,method,body in calls if path=='/users/member' and method=='PATCH']
    assert updates[-1]['daily_limits']['ai']==42
    page.get_by_role('button',name='usage',exact=True).click()
    page.get_by_text('provider_reported',exact=False).wait_for()
    page.get_by_role('button',name='Shared providers',exact=True).click()
    page.get_by_role('heading',name='Shared provider vault').wait_for()
    page.get_by_role('button',name='Releases',exact=True).click()
    page.get_by_role('heading',name='Controlled updates').wait_for()
    page.set_viewport_size({'width':390,'height':844})
    assert page.evaluate('document.documentElement.scrollWidth<=innerWidth+1')
    page.evaluate("window.identity='';window.dispatchEvent(new CustomEvent('rudra:auth-state'))")
    page.wait_for_timeout(100)
    assert page.locator('#dc-body').inner_text()==''
    assert not errors,errors
    browser.close()
print('PASS developer control browser: disclosure, safe rendering, remote limits, usage, providers, releases, mobile width and logout cleanup')
