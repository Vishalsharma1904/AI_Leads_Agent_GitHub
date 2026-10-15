"""Run python backend/tests/test_whatsapp_cloud.py; all Meta calls mocked, real DB/auth boundaries."""
import asyncio
import hashlib
import hmac
import json
import os
import sys
import tempfile
import types
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
os.environ['CREDENTIAL_MASTER_KEY'] = 'w' * 40
os.environ['META_APP_ID'] = '123'
os.environ['META_APP_SECRET'] = 'server-secret'
os.environ['WHATSAPP_WEBHOOK_VERIFY_TOKEN'] = 'verify-me'
from sqlalchemy import Column, String, create_engine
from sqlalchemy.orm import declarative_base, sessionmaker
from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient
from fastapi.security import HTTPBearer

engine = create_engine('sqlite:///' + str(Path(tempfile.mkdtemp()) / 'wa.db'), connect_args={'check_same_thread': False, 'timeout': 20})
Base = declarative_base()
class UserAccount(Base):
    __tablename__ = 'users'
    id = Column(String(64), primary_key=True)
    email = Column(String(255), default='')
Session = sessionmaker(bind=engine)
CURRENT = {'id': 'one'}
def get_db():
    db = Session()
    try: yield db
    finally: db.close()
def get_user(): return UserAccount(id=CURRENT['id'], email=CURRENT['id'] + '@test.com')
auth = types.ModuleType('api.auth_sync')
for k, v in {'AUTO_CREATE_SCHEMA': True, 'Base': Base, 'UserAccount': UserAccount, 'engine': engine, 'get_db': get_db, 'get_current_user': get_user, 'SessionLocal': Session, 'ensure_columns': lambda: []}.items(): setattr(auth, k, v)
sys.modules['api.auth_sync'] = auth
auth.bearer_scheme = HTTPBearer(auto_error=False)
auth._verify_supabase_token = lambda token: {}
connectors = types.ModuleType('api.connectors'); connectors._oauth_keys = lambda provider: ('123', 'server-secret')
sys.modules['api.connectors'] = connectors
from api import whatsapp as wa
from api.credentials import ProviderCredential, decrypt_secret
from api.limits import TenantLimits
app = FastAPI(); app.include_router(wa.router)
client = TestClient(app)
CALLS = []
async def fake_graph(token, path, method='GET', params=None, payload=None):
    CALLS.append((path, method))
    if path == 'debug_token': return {'data': {'is_valid': True, 'app_id': '123', 'scopes': ['whatsapp_business_management', 'whatsapp_business_messaging']}}
    if path.endswith('/phone_numbers'): return {'data': [{'id': '222' if path.startswith('111/') else '444', 'display_phone_number': '+919999999999', 'platform_type': 'CLOUD_API', 'status': 'CONNECTED'}]}
    if path.endswith('/message_templates'): return {'data': [{'name': 'hello', 'language': 'en', 'status': 'APPROVED', 'components': [{'type': 'BODY', 'text': 'Hi {{1}}'}]}]}
    return {'success': True}
wa.cloud.graph = fake_graph
SEND = []
async def fake_send(*args): SEND.append(args); return 'wamid.' + str(len(SEND))
wa.cloud.send_template = fake_send
for owner, waba, phone in [('one','111','222'),('two','333','444')]:
    CURRENT['id'] = owner
    r = client.put('/api/v1/whatsapp/connection', json={'access_token': owner + '-token-secret', 'waba_id': waba, 'phone_number_id': phone})
    assert r.status_code == 200, r.text
    assert 'access_token' not in r.text and owner + '-token-secret' not in r.text
with Session() as db:
    cred = db.query(ProviderCredential).filter_by(owner_user_id='one', provider='whatsapp_cloud').one()
    assert 'one-token-secret' not in cred.ciphertext and decrypt_secret(cred) == 'one-token-secret'
# Cross-tenant claim rejected before any Meta mutation.
CALLS.clear()
r = client.put('/api/v1/whatsapp/connection', json={'access_token':'two-token-secret','waba_id':'111','phone_number_id':'222'})
assert r.status_code == 409 and not CALLS
CURRENT['id'] = 'one'
payload = {'to': '+919876543210','template':'hello','language':'en','body_params':['Person'],'idempotency_key':'request-0001','opt_in':True}
r = client.post('/api/v1/whatsapp/messages/template', json=payload); assert r.status_code == 200, r.text
assert r.json()['status'] == 'accepted' and len(SEND) == 1
assert client.post('/api/v1/whatsapp/messages/template', json=payload).json()['id'] == r.json()['id'] and len(SEND) == 1
assert client.post('/api/v1/whatsapp/messages/template', json={**payload,'to':'+919876543211'}).status_code == 409
assert client.post('/api/v1/whatsapp/messages/template', json={**payload,'opt_in':False}).status_code == 422
CURRENT['id'] = 'two'; assert client.get('/api/v1/whatsapp/messages').json()['messages'] == []
# Concurrent reservations exercise production logic, including same idempotency key.
with Session() as db:
    row = db.query(TenantLimits).filter_by(owner_user_id='two').one(); row.whatsapp_per_day = 3; db.commit()
def reserve(key):
    with Session() as db:
        try:
            _, fresh = wa.reserve(db, UserAccount(id='two'), key, 'same-hash', '444', '+919876543210', 'hello')
            return fresh
        except HTTPException as e: assert e.status_code == 429; return False
with ThreadPoolExecutor(max_workers=8) as pool:
    assert sum(pool.map(reserve, ['same-key-000'] * 8)) == 1
with ThreadPoolExecutor(max_workers=8) as pool:
    assert sum(pool.map(reserve, [f'other-key-{i}' for i in range(8)])) == 2
with Session() as db:
    assert db.query(TenantLimits).filter_by(owner_user_id='two').one().whatsapp_used == 3
    assert db.query(wa.WhatsAppMessage).filter_by(owner_user_id='two').count() == 3
# Webhook signatures + correct tenant + out-of-order status + durable early receipt.
def post_receipt(status, message='wamid.1', phone='222', waba='111'):
    body = json.dumps({'entry':[{'id':waba,'changes':[{'field':'messages','value':{'metadata':{'phone_number_id':phone},'statuses':[{'id':message,'status':status}]}}]}]}).encode()
    signature = 'sha256=' + hmac.new(b'server-secret', body, hashlib.sha256).hexdigest()
    assert client.post('/api/v1/whatsapp/webhook', content=body, headers={'x-hub-signature-256':signature}).status_code == 200
assert client.post('/api/v1/whatsapp/webhook', json={}).status_code == 403
post_receipt('delivered', phone='444', waba='333')
CURRENT['id'] = 'one'; assert client.get('/api/v1/whatsapp/messages').json()['messages'][0]['status'] == 'accepted'
post_receipt('read'); post_receipt('sent'); post_receipt('read')
assert client.get('/api/v1/whatsapp/messages').json()['messages'][0]['status'] == 'read'
post_receipt('delivered', message='wamid.early')
with Session() as db:
    row = wa.WhatsAppMessage(id='early', owner_user_id='one',idempotency_key='early-key',request_hash='x',phone_number_id='222',to='+919876543210',template='hello',status='accepted',provider_message_id='wamid.early')
    db.add(row); db.commit(); wa.apply_receipts(db,row); assert row.status == 'delivered'
# A timeout remains unknown and cannot cause a second send on replay.
async def timeout_send(*args): SEND.append(args); raise wa.httpx.ReadTimeout('unknown')
wa.cloud.send_template = timeout_send
payload['idempotency_key'] = 'request-timeout'
r=client.post('/api/v1/whatsapp/messages/template',json=payload);assert r.json()['status']=='unknown'
before=len(SEND);client.post('/api/v1/whatsapp/messages/template',json=payload);assert len(SEND)==before
body=b'[]'; signature='sha256='+hmac.new(b'server-secret',body,hashlib.sha256).hexdigest()
assert client.post('/api/v1/whatsapp/webhook',content=body,headers={'x-hub-signature-256':signature}).status_code==400
print('PASS: tenant binding/vault, quota concurrency/idempotency, signed tenant receipts, early/out-of-order statuses, unknown outcomes')
# The pitch caller must use the same verified binding, recipient consent, and daily ledger.
os.environ['PITCH_DOC_DIR'] = tempfile.mkdtemp()
from api import pitch
app.include_router(pitch.router)
with Session() as db:
    db.add(UserAccount(id='one',email='one@test.com')); db.commit()
async def upload(*args): return 'media-test'
async def document_send(*args, **kwargs): SEND.append(args); return 'wamid.pitch'
wa.cloud.upload_media=upload;wa.cloud.send_document_template=document_send
CURRENT['id']='one'
r=client.post('/api/v1/pitch/documents',files={'file':('x.pdf',b'%PDF-1.4','application/pdf')});assert r.status_code==200,r.text
client.patch('/api/v1/pitch/documents/'+r.json()['id'],json={'in_pitch':True})
client.put('/api/v1/pitch/settings',json={'phone_number_id':'444','template':'hello','language':'en'})
params={'t':pitch.tenant_token('one'),'phone':'+919876543210','conversation_id':'pitch-test','opt_in':True}
before=len(SEND);r=client.get('/api/v1/pitch/send',params=params);assert 'does not match' in r.json()['message'] and len(SEND)==before
client.put('/api/v1/pitch/settings',json={'phone_number_id':'222','template':'hello','language':'en'})
r=client.get('/api/v1/pitch/send',params={**params,'opt_in':False});assert 'opt-in' in r.json()['message'] and len(SEND)==before
with Session() as db: before_used=db.query(TenantLimits).filter_by(owner_user_id='one').one().whatsapp_used
r=client.get('/api/v1/pitch/send',params=params);assert 'queued' in r.json()['message'] and len(SEND)==before+1
with Session() as db:
    assert db.query(TenantLimits).filter_by(owner_user_id='one').one().whatsapp_used==before_used+1
    assert db.query(pitch.PitchSend).one().status=='accepted'
r=client.get('/api/v1/pitch/send',params=params);assert len(SEND)==before+1
print('PASS: pitch verified sender, consent, shared quota, truthful acceptance, idempotency')
# Additional onboarding/permission boundary checks.
original_graph=wa.cloud.graph
async def invalid_token(token,path,**kwargs):
    if path=='debug_token': return {'data':{'is_valid':True,'app_id':'999','scopes':[]}}
    return await original_graph(token,path,**kwargs)
wa.cloud.graph=invalid_token
CURRENT['id']='three'
r=client.put('/api/v1/whatsapp/connection',json={'access_token':'third-token-secret','waba_id':'555','phone_number_id':'666'})
assert r.status_code==422
ONBOARD=[]
async def onboarding_graph(token,path,method='GET',params=None,payload=None):
    ONBOARD.append((path,method,payload))
    if path=='debug_token': return await original_graph(token,path,method=method,params=params,payload=payload)
    if path=='555/phone_numbers': return {'data':[{'id':'666','platform_type':'NOT_APPLICABLE','status':'PENDING','is_on_biz_app':False}]}
    if path=='777/phone_numbers': return {'data':[{'id':'888','platform_type':'CLOUD_API','is_on_biz_app':True}]}
    if path.endswith('/smb_app_data'): return {'request_id':'sync-'+payload['sync_type']}
    return {'success':True}
wa.cloud.graph=onboarding_graph
req={'access_token':'third-token-secret','waba_id':'555','phone_number_id':'666'}
assert client.put('/api/v1/whatsapp/connection',json=req).status_code==422
ONBOARD.clear()
r=client.put('/api/v1/whatsapp/connection',json={**req,'registration_pin':'123456'})
assert r.status_code==200,r.text
assert [p for p,m,_ in ONBOARD if m=='POST']==['555/subscribed_apps','666/register']
CURRENT['id']='four'
req={'access_token':'fourth-token-secret','waba_id':'777','phone_number_id':'888'}
ONBOARD.clear();r=client.put('/api/v1/whatsapp/connection',json=req)
assert r.status_code==200 and r.json()['onboarding_status']=='sync_requested',r.text
assert not any(p.endswith('/register') for p,_,_ in ONBOARD)
assert [v['sync_type'] for p,_,v in ONBOARD if p.endswith('/smb_app_data')]==['smb_app_state_sync','history']
ONBOARD.clear();r=client.put('/api/v1/whatsapp/connection',json=req)
assert r.status_code==200 and not any(p.endswith('/smb_app_data') for p,_,_ in ONBOARD)
# No state downgrade: sent -> failed is permitted, delivered/read -> failed is not.
CURRENT['id']='one'
post_receipt('sent',message='wamid.early');post_receipt('failed',message='wamid.early')
with Session() as db: assert db.get(wa.WhatsAppMessage,'early').status=='delivered'
with Session() as db:
    row=wa.WhatsAppMessage(id='fail-after-sent',owner_user_id='one',idempotency_key='fail-key',request_hash='x',phone_number_id='222',to='+919876543210',template='hello',status='sent',provider_message_id='wamid.failed')
    db.add(row);db.commit()
post_receipt('failed',message='wamid.failed')
with Session() as db: assert db.get(wa.WhatsAppMessage,'fail-after-sent').status=='failed'
assert client.post('/api/v1/pitch/documents',files={'file':('x.exe',b'MZ','application/x-msdownload')}).status_code==415
CURRENT['id']='two';assert client.get('/api/v1/pitch/documents').json()['documents']==[]
print('PASS: token app/scope refusal, new PIN registration order, coexistence one-shot sync, failed receipt, document isolation')
