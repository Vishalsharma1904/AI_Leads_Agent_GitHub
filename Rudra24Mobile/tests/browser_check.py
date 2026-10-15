"""Isolated mobile/tablet browser fixtures; no real login or provider sends."""
import json
import mimetypes
from pathlib import Path
from playwright.sync_api import sync_playwright

root=Path(__file__).resolve().parents[1] / 'pwa'
artifacts=Path(__file__).resolve().parents[1] / 'artifacts'
artifacts.mkdir(exist_ok=True)
records=[{'id':str(i),'version':1,'stage':'new','profile':{'company':f'Hotel {i}','phone':f'+9199999999{i:02}','email':f'lead{i}@example.com','address':'Noida'}} for i in range(1,4)]
sent=[];jobs=[];errors=[];activities=[];tasks=[];lead_jobs=[];call_jobs=[];ready={'value':True}
def route(request):
    path=request.request.url.split('mobile.test')[-1].split('?')[0]
    if path.startswith('/auth/v1/token'):
        data={'access_token':'fixture','refresh_token':'fixture-refresh','expires_in':3600,'user':{'id':'owner','email':'owner@test.com'}}
    elif path in ['/api/public-config','/public-auth-config.json']: data={'supabase_url':'https://mobile.test','supabase_publishable_key':'sb_publishable_fixture'}
    elif path=='/api/crm/records': data={'records':records,'total':len(records)}
    elif path.endswith('/activities') and path.startswith('/api/crm/records/'):
        payload=request.request.post_data_json;activities.append({'id':str(len(activities)+1),'kind':payload['kind'],'note':payload['note'],'occurredAt':'2026-10-12'});data=activities[-1]
    elif path.startswith('/api/crm/records/'):
        record=next(r for r in records if r['id']==path.split('/')[-1])
        if request.request.method=='PATCH':
            payload=request.request.post_data_json;assert payload['version']==record['version'];record['profile'].update(payload.get('profile',{}));record['stage']=payload.get('stage',record['stage']);record['version']+=1
        data={**record,'activities':activities,'tasks':tasks}
    elif path=='/api/crm/tasks':
        payload=request.request.post_data_json;tasks.append({'id':str(len(tasks)+1),'version':1,'title':payload['title'],'status':'open','dueAt':payload.get('dueAt','')});data=tasks[-1]
    elif path.startswith('/api/crm/tasks/'):
        task=next(t for t in tasks if t['id']==path.split('/')[-1]);payload=request.request.post_data_json;assert payload['version']==task['version'];task['status']=payload['status'];task['version']+=1;data=task
    elif path=='/api/v1/lead-jobs':
        if request.request.method=='POST':
            sent.append(('lead',request.request.post_data_json));lead_jobs.append({'id':str(len(lead_jobs)+1),'status':'completed','result_count':1,'request_id':request.request.headers.get('idempotency-key')});data={'job':lead_jobs[-1]}
            records.append({'id':str(len(records)+1),'version':1,'stage':'new','profile':{'company':'New Apify lead '+str(len(lead_jobs)),'phone':'+918888888888','email':'new@example.com','address':'Noida'}})
        else: data={'jobs':lead_jobs}
    elif path=='/api/v1/elevenlabs/calling-readiness':data={'ready':ready['value'],'message':'Fixture readiness verified' if ready['value'] else 'Outbound setup incomplete'}
    elif path=='/api/v1/outreach-jobs':
        if request.request.method=='POST':
            payload=request.request.post_data_json;sent.append(('email',payload));jobs.append({'id':'job1','request_id':payload['request_id'],'channel':'email','status':'queued','items':[]});data={'job':jobs[-1]}
        else:data={'jobs':jobs}
    elif path=='/api/v1/elevenlabs/batch-calls':
        if request.request.method=='POST':
            payload=request.request.post_data_json;sent.append(('calls',payload));job={'request_id':payload['request_id'],'batch_id':'call-'+str(len(call_jobs)+1),'name':'Calling batch','status':'completed','recipients':[{**row,'status':'completed','conversation_id':'conv-fixture'} for row in payload['recipients']]};call_jobs.append(job);data=job
        else:data={'batch_calls':call_jobs}
    elif path=='/api/v1/elevenlabs/conversations/conv-fixture':data={'conversation_id':'conv-fixture','status':'done','analysis':{'transcript_summary':'Proposal requested'},'transcript':[{'role':'user','message':'Please send details.'}]}
    elif path=='/api/v1/elevenlabs/agents':data={'agents':[{'agent_id':'agent1','name':'Rudra sales'}]}
    elif path=='/api/v1/elevenlabs/phones':data={'phone_numbers':[{'phone_number_id':'phone1','label':'+919888888888'}]}
    elif path=='/api/v1/whatsapp/templates':data={'templates':[{'name':'intro','language':'en'}]}
    elif path=='/api/credentials':data={'credentials':[{'provider':p,'configured':True} for p in ['apify','groq','elevenlabs']]}
    elif path.startswith('/auth/v1/logout'):data={}
    elif path.startswith('/api/'):
        request.fulfill(status=404,json={'detail':'Fixture route missing: '+path});return
    else:
        file=root / (path.lstrip('/') or 'index.html')
        if not file.is_file():request.fulfill(status=404);return
        request.fulfill(body=file.read_bytes(),content_type='text/javascript' if file.suffix=='.js' else mimetypes.guess_type(str(file))[0] or 'application/octet-stream');return
    request.fulfill(json=data)

with sync_playwright() as p:
    browser=p.chromium.launch()
    for width,height in [(390,844),(820,1180)]:
        page=browser.new_page(viewport={'width':width,'height':height},reduced_motion='reduce')
        page.on('pageerror',lambda error:errors.append(str(error)))
        page.route('https://mobile.test/**',route)
        page.goto('https://mobile.test/');page.get_by_text('Use email & password',exact=True).click();page.locator('#email').fill('owner@test.com');page.locator('#password').fill('fixture')
        page.get_by_role('button',name='Sign in',exact=True).click()
        page.get_by_role('heading',name='Namaste, owner').wait_for()
        page.get_by_role('link',name='Leads',exact=True).click()
        page.get_by_role('heading',name='Find your next client').wait_for()
        page.locator('[data-select="1"]').check();page.locator('[data-select="2"]').check()
        page.get_by_role('button',name='Use selected leads').click()
        page.get_by_role('button',name='Email',exact=True).click();page.wait_for_timeout(150)
        page.locator('#subject').fill('Business proposal');page.locator('#message').fill('Hello from Rudra24');page.locator('#limit').fill('1')
        before=len(sent);page.get_by_role('button',name='Review batch',exact=True).click()
        assert page.locator('#review').is_visible(), page.locator('#status').inner_text()
        assert len(sent)==before
        assert '1 email recipients' in page.locator('#review').inner_text()
        page.get_by_role('button',name='Back',exact=True).click();assert len(sent)==before
        page.get_by_role('button',name='Review batch',exact=True).click()
        page.get_by_role('button',name='Confirm & submit',exact=True).click()
        page.wait_for_function("!document.querySelector('#review').open")
        page.wait_for_timeout(150)
        assert len(sent)==before+1 and sent[-1][1]['record_ids']==['1'],sent
        page.get_by_role('button',name='Calls',exact=True).click()
        page.locator('#agent').select_option('agent1');page.locator('#phone').select_option('phone1');page.locator('#limit').fill('1')
        ready['value']=False;before=len(sent)
        page.get_by_role('button',name='Review batch',exact=True).click()
        try: page.wait_for_function("document.querySelector('#status').textContent.includes('Outbound setup incomplete')",timeout=5000)
        except Exception:
            raise AssertionError(page.evaluate("({status:document.querySelector('#status').textContent,agent:document.querySelector('#agent').value,phone:document.querySelector('#phone').value,selected:document.querySelectorAll('[data-select]:checked').length,open:document.querySelector('#review').open})"))
        assert not page.locator('#review').is_visible() and len(sent)==before
        ready['value']=True;page.get_by_role('button',name='Review batch',exact=True).click();page.locator('#review').wait_for(state='visible')
        assert len(sent)==before
        page.get_by_role('button',name='Confirm & submit',exact=True).click()
        page.get_by_text('Call recipients',exact=True).first.click()
        page.get_by_role('button',name='Open transcript',exact=True).first.click()
        page.get_by_text('Please send details.',exact=False).wait_for()
        assert sent[-1][0]=='calls' and sent[-1][1]['recipients'][0]['crm_record_id']=='1'
        page.locator('#call-transcript').get_by_role('button',name='Close',exact=True).click()
        page.get_by_role('link',name='More',exact=True).click()
        page.get_by_role('button',name='Check connected providers',exact=True).click()
        page.wait_for_function("document.querySelector('#provider-status').textContent.includes('apify: configured')")
        assert page.get_by_role('button',name='Sign out',exact=True).is_visible()
        page.get_by_role('button',name='Sign out',exact=True).click()
        page.get_by_role('heading',name='Welcome to Rudra24').wait_for()
        assert page.locator('text=Hotel 1').count()==0
        page.get_by_role('button',name='Continue with Google',exact=True).wait_for()
        page.get_by_text('Use email & password',exact=True).click();page.locator('#email').fill('owner@test.com');page.locator('#password').fill('fixture');page.get_by_role('button',name='Sign in',exact=True).click()
        page.get_by_role('link',name='Leads',exact=True).click()
        page.get_by_role('button',name='Details',exact=True).first.click()
        page.wait_for_function("document.querySelector('#detail').textContent.includes('Hotel 1')")
        page.locator('#crm-stage').select_option('connected')
        page.get_by_role('button',name='Save contact & stage',exact=True).click()
        page.wait_for_function("document.querySelector('#crm-stage').value==='connected'")
        page.locator('#crm-note-text').fill('Owner note '+str(width))
        page.get_by_role('button',name='Save note',exact=True).click()
        page.get_by_text('Owner note '+str(width),exact=True).wait_for()
        page.locator('#crm-task-title').fill('Follow up '+str(width));page.locator('#crm-task-date').fill('2026-10-14')
        page.get_by_role('button',name='Add follow-up',exact=True).click()
        page.get_by_text('Follow up '+str(width),exact=True).wait_for()
        page.get_by_role('button',name='Mark completed',exact=True).last.click()
        page.wait_for_function("document.querySelectorAll('[data-complete-task]').length===0")
        page.locator('#count').fill('2');page.get_by_role('button',name='Start search',exact=True).click()
        page.get_by_role('heading',name='New Apify lead '+str(len(lead_jobs)),exact=True).wait_for()
        assert sent[-1][0]=='lead' and sent[-1][1]['sources']==['apify','maps']
        assert page.evaluate('document.documentElement.scrollWidth<=innerWidth'),width
        page.screenshot(path=str(artifacts / f'mobile-{width}.png'),full_page=True)
        page.close()
    # A refresh that finishes after logout must not restore the previous account.
    page=browser.new_page(viewport={'width':390,'height':844})
    page.route('https://mobile.test/**',route)
    page.add_init_script("localStorage.setItem('rudra-mobile-session',JSON.stringify({access_token:'fixture',refresh_token:'fixture-refresh',expires_at:1,user:{id:'owner',email:'owner@test.com'}}))")
    held=[]
    page.route('https://mobile.test/auth/v1/token?grant_type=refresh_token',lambda request:held.append(request))
    page.goto('https://mobile.test/#more')
    page.wait_for_function("document.querySelector('[data-action=logout]') !== null")
    page.get_by_role('button',name='Sign out',exact=True).click()
    if held:
        held[0].fulfill(json={'access_token':'late','refresh_token':'late-refresh','expires_in':3600,'user':{'id':'owner','email':'owner@test.com'}})
        page.wait_for_timeout(200)
    assert page.evaluate("localStorage.getItem('rudra-mobile-session')") is None
    assert page.get_by_role('heading',name='Welcome to Rudra24').is_visible()
    page.close()
    browser.close()
assert not errors,errors
print('PASS: phone/tablet login, reviewed batch, CRM edits/notes/follow-ups, Apify auto-refresh, provider checks without logout, refresh-race isolation, no overflow or JS errors')
