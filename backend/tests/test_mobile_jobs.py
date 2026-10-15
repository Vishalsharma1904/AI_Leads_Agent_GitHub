"""Run directly: backend/.venv/Scripts/python backend/tests/test_mobile_jobs.py."""
import asyncio
import json
import sys
import tempfile
import types
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from sqlalchemy import Column, String, Text, create_engine
from sqlalchemy.orm import declarative_base, sessionmaker
from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient
from fastapi.security import HTTPBearer

Base = declarative_base()
engine = create_engine('sqlite:///' + (Path(tempfile.mkdtemp(dir=Path(__file__).resolve().parents[2] / 'work')) / 'mobile.db').as_posix())
Session = sessionmaker(bind=engine)
class User(Base):
    __tablename__ = 'users'
    id = Column(String, primary_key=True)
class Record(Base):
    __tablename__ = 'crm_records'
    id = Column(String, primary_key=True)
    owner_user_id = Column(String)
    profile = Column(Text)
current = {'id': 'owner'}
def db_dep():
    with Session() as db: yield db
auth = types.ModuleType('api.auth_sync')
for key, value in dict(Base=Base, engine=engine, AUTO_CREATE_SCHEMA=True, SessionLocal=Session,
    UserAccount=User, get_db=db_dep, get_current_user=lambda: User(id=current['id'])).items():
    setattr(auth, key, value)
sys.modules['api.auth_sync'] = auth
auth.bearer_scheme = HTTPBearer(auto_error=False)
auth._verify_supabase_token = lambda token: {}
crm = types.ModuleType('api.crm'); crm.CRMRecord = Record
sys.modules['api.crm'] = crm
from api import mobile_jobs as mobile
Base.metadata.create_all(engine)
with Session() as db:
    db.add_all([User(id='owner'), User(id='guest'), Record(id='a', owner_user_id='owner',
        profile=json.dumps({'company':'Example', 'email':'a@example.com','phone':'+919999999999'})),
        Record(id='b', owner_user_id='guest', profile=json.dumps({'email':'b@example.com'}))])
    db.commit()
app = FastAPI(); app.include_router(mobile.router)
client = TestClient(app)
payload = {'channel':'email','record_ids':['a'],'confirmed':True,'request_id':'test-request-0001',
           'subject':'Hello','message':'Business proposal'}
assert client.post('/api/v1/outreach-jobs', json={**payload,'confirmed':False}).status_code == 422
assert client.post('/api/v1/outreach-jobs', json={**payload,'record_ids':['b']}).status_code == 404
assert client.post('/api/v1/outreach-jobs', json={**payload,'channel':'whatsapp'}).status_code == 422
response = client.post('/api/v1/outreach-jobs', json=payload)
assert response.status_code == 202, response.text
job = response.json()['job']['id']
assert client.post('/api/v1/outreach-jobs', json=payload).json()['job']['id'] == job
assert client.post('/api/v1/outreach-jobs', json={**payload,'subject':'Different'}).status_code == 409
current['id'] = 'guest'
assert client.get('/api/v1/outreach-jobs').json()['jobs'] == []
assert client.get('/api/v1/outreach-jobs/' + job).status_code == 404
assert client.post('/api/v1/outreach-jobs/' + job + '/cancel').status_code == 404
current['id'] = 'owner'
sent = []
async def deliver(db, user, row, data):
    sent.append(row.recipient); return {'status':'success', 'messageId':'mock-id'}
mobile.deliver = deliver
asyncio.run(mobile.tick(Session)); asyncio.run(mobile.tick(Session))
assert sent == ['a@example.com'], sent
assert client.get('/api/v1/outreach-jobs/' + job).json()['job']['status'] == 'completed'
second = client.post('/api/v1/outreach-jobs', json={**payload,'request_id':'test-request-0002'}).json()['job']['id']
client.post('/api/v1/outreach-jobs/' + second + '/cancel')
asyncio.run(mobile.tick(Session)); assert len(sent) == 1
async def uncertain(*args): raise HTTPException(502, 'Provider unavailable')
mobile.deliver = uncertain
third = client.post('/api/v1/outreach-jobs', json={**payload,'request_id':'test-request-0003'}).json()['job']['id']
asyncio.run(mobile.tick(Session)); asyncio.run(mobile.tick(Session))
assert client.get('/api/v1/outreach-jobs/' + third).json()['job']['status'] == 'attention'
# A stale in-flight reservation is never retried after a worker restart.
with Session() as db:
    stale_job=mobile.create(mobile.BatchRequest(**{**payload,'request_id':'test-request-0004'}),db,User(id='owner'))['job']['id']
    item=db.query(mobile.OutreachItem).filter_by(job_id=stale_job).one()
    item.status='sending';item.updated_at=1;db.commit()
asyncio.run(mobile.tick(Session))
assert client.get('/api/v1/outreach-jobs/' + stale_job).json()['job']['status']=='attention'
assert len(sent)==1
print('PASS: isolation, validation, review, idempotency, persisted execution, cancel, uncertain stop')
