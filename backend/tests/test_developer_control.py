"""Control-plane integration tests with real dependencies and isolated file DB."""
import os
import sys
import tempfile
import time
import unittest
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from fastapi import FastAPI, Depends
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from api.auth_sync import Base, UserAccount, get_db, get_current_user
from api.control import router
from api.billing import Subscription
from api.lead_jobs import LeadJob
from api.mobile_jobs import OutreachJob
from api.elevenlabs import ElevenLabsResource
from api.developer_insights import ProductSession
from api.credentials import router as credentials_router, get_provider_secret
from api.limits import consume, TenantLimits
from services.developer_control import AccountControl, ProviderAssignment, ManagedSession, UsageEvent, check_access

class ControlTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.engine = create_engine('sqlite:///' + str(Path(self.tmp.name)/'control.sqlite'), connect_args={'check_same_thread':False,'timeout':30})
        Base.metadata.create_all(self.engine)
        self.factory=sessionmaker(bind=self.engine, expire_on_commit=False)
        control_sessions=patch('api.control.SessionLocal',self.factory);control_sessions.start();self.addCleanup(control_sessions.stop)
        self.env=patch.dict(os.environ, {'CLAVIS_MANAGED_ACCESS':'true','CREDENTIAL_MASTER_KEY':'test-only-vault-key-at-least-32-characters','DEVELOPER_EMAILS':'vishalsharma190405@gmail.com','CLAVIS_RELEASE_HOSTS':'updates.example.com'})
        self.env.start();self.addCleanup(self.env.stop)
        self.identities={'owner':'vishalsharma190405@gmail.com','a':'a@example.com','b':'b@example.com'}
        with self.factory() as db:
            for uid,email in self.identities.items():db.add(UserAccount(id=uid,email=email,name=uid))
            db.commit()
        app=FastAPI();app.include_router(router);app.include_router(credentials_router)
        def dbdep():
            with self.factory() as db:yield db
        app.dependency_overrides[get_db]=dbdep
        @app.post('/api/ai/test')
        def paid(user=Depends(get_current_user)):return {'ok':True}
        self.client=TestClient(app)
        def claims(token):return {'sub':token,'email':self.identities[token],'iat':time.time(),'session_id':'session-'+token,'app_metadata':{'provider':'google'},'user_metadata':{}}
        self.claims=patch('api.auth_sync._verify_supabase_token',side_effect=claims);self.claims.start();self.addCleanup(self.claims.stop)
        ownerclaims=patch('services.developer_control._verify_supabase_token',side_effect=claims);ownerclaims.start();self.addCleanup(ownerclaims.stop)
        self.headers={'Authorization':'Bearer owner'}
        self.addCleanup(self.tmp.cleanup);self.addCleanup(self.engine.dispose);self.addCleanup(self.client.close)
    def call(self,path,method='GET',body=None,uid='owner'):
        return self.client.request(method,'/api/control'+path,json=body,headers={'Authorization':'Bearer '+uid})
    def activate(self,uid='a',**extra):
        return self.call('/users/'+uid,'PATCH',{'status':'trial','expires_at':time.time()+3600,**extra})
    def test_owner_identity_not_profile_email(self):
        self.assertEqual(self.call('/users',uid='a').status_code,403)
        with self.factory() as db:
            member=db.query(UserAccount).filter_by(id='a').one();member.role='Owner';db.commit()
        self.assertEqual(self.call('/users',uid='a').status_code,403)
        self.assertEqual(self.call('/users').json()['total'],3)
    def test_payment_needed_and_block_revoke_immediate(self):
        h={'Authorization':'Bearer a'}
        self.assertEqual(self.client.post('/api/ai/test',headers=h).status_code,402)
        self.assertEqual(self.activate().status_code,200)
        self.assertEqual(self.client.post('/api/ai/test',headers=h).status_code,200)
        self.assertEqual(self.call('/users/a/revoke','POST').status_code,200)
        self.assertEqual(self.client.post('/api/ai/test',headers=h).status_code,401)
        self.assertEqual(self.call('/users/a','PATCH',{'status':'blocked'}).status_code,200)
        with self.factory() as db:
            user=db.query(UserAccount).filter_by(id='a').one()
            with self.assertRaises(Exception):check_access(db,user,'ai')
    def test_expiry_and_feature_flags(self):
        self.activate(features={'ai':False})
        self.assertEqual(self.client.post('/api/ai/test',headers={'Authorization':'Bearer a'}).status_code,403)
        self.call('/users/a','PATCH',{'features':{'ai':True},'expires_at':time.time()-10})
        self.assertEqual(self.client.post('/api/ai/test',headers={'Authorization':'Bearer a'}).status_code,402)
    @patch('api.credentials.probe_key',return_value=('ok','Accepted'))
    def test_self_saved_key_resolves_in_managed_mode(self,_probe):
        result=self.client.put('/api/credentials',headers={'Authorization':'Bearer a'},json={'provider':'apify','secret':'test-only-apify-secret'})
        self.assertEqual(result.status_code,200)
        with self.factory() as db:
            user=db.query(UserAccount).filter_by(id='a').one()
            self.assertEqual(get_provider_secret('apify',user,db),'test-only-apify-secret')
            self.assertEqual(db.query(ProviderAssignment).filter_by(user_id='a',provider='apify').one().mode,'individual')
        self.assertNotIn('test-only-apify-secret',self.client.get('/api/credentials',headers={'Authorization':'Bearer a'}).text)
    @patch('api.credentials.probe_key',return_value=('ok','Accepted'))
    def test_assignments_encrypted_no_fallback_or_export(self,_probe):
        shared='fake-shared-secret-do-not-use'
        self.assertEqual(self.call('/providers/groq','PUT',{'secret':shared,'enabled':True,'monthly_requests':10}).status_code,200)
        self.assertEqual(self.call('/users/a/providers/groq','PUT',{'mode':'shared'}).status_code,200)
        self.assertNotIn(shared,self.call('/users/a').text)
        with self.factory() as db:
            a=db.query(UserAccount).filter_by(id='a').one();b=db.query(UserAccount).filter_by(id='b').one()
            self.assertEqual(get_provider_secret('groq',a,db),shared)
            self.assertIsNone(get_provider_secret('groq',b,db))
        self.assertEqual(self.call('/users/a/providers/groq','PUT',{'mode':'individual'}).status_code,200)
        with self.factory() as db:self.assertIsNone(get_provider_secret('groq',db.query(UserAccount).filter_by(id='a').one(),db))
        self.assertNotIn(shared,self.call('/users/a/audit').text)
        self.call('/users/a/providers/groq','PUT',{'mode':'disabled'})
        response=self.client.put('/api/credentials',json={'provider':'groq','secret':'new-fake-secret'},headers={'Authorization':'Bearer a'})
        self.assertEqual(response.status_code,403)
    def test_content_disclosure_and_tenant_filter(self):
        self.assertEqual(self.call('/users/a/content/leads').status_code,409)
        self.assertEqual(self.call('/disclosure','POST',{'version':'2026-10-13','accepted':True},uid='a').status_code,200)
        with patch.dict(os.environ,{'SUPABASE_URL':'https://example.supabase.co','SUPABASE_SECRET_KEY':'test-server-secret'}),patch('api.control.httpx.get') as get:
            get.return_value.json.return_value=[{'payload':{'leads':[{'name':'A lead'}]},'updated_at':'now'}]
            get.return_value.raise_for_status.return_value=None
            response=self.call('/users/a/content/leads')
            self.assertEqual(response.status_code,200)
            self.assertEqual(get.call_args.kwargs['params']['user_id'],'eq.a')
            self.assertNotIn('test-server-secret',response.text)
        self.assertEqual(self.call('/users/a/content/leads',uid='b').status_code,403)
    def test_sync_transition_and_disabled_shared_status(self):
        for state in ['pending','offline','synced']:
            self.assertEqual(self.call('/activity','POST',{'kind':'sync','state':state},uid='a').status_code,200)
        self.assertEqual(self.call('/users/a').json()['sync']['state'],'synced')
        with patch('api.credentials.probe_key',return_value=('ok','Accepted')):
            self.call('/providers/groq','PUT',{'secret':'test-only-shared','enabled':True,'monthly_requests':10})
            self.call('/users/a/providers/groq','PUT',{'mode':'shared'})
        self.call('/providers/groq','PUT',{'enabled':False,'monthly_requests':10})
        self.assertFalse(next(p for p in self.call('/users/a').json()['providers'] if p['provider']=='groq')['configured'])
    def test_monthly_quota_concurrency(self):
        self.activate(daily_limits={'ai':100},monthly_limits={'ai':2})
        def spend(_):
            with self.factory() as db:
                user=db.query(UserAccount).filter_by(id='a').one()
                try:consume(db,user,'ai');return True
                except Exception:db.rollback();return False
        with ThreadPoolExecutor(max_workers=5) as pool:outcomes=list(pool.map(spend,range(5)))
        self.assertEqual(sum(outcomes),2)
        with self.factory() as db:self.assertEqual(db.query(UsageEvent).filter_by(user_id='a',meter='ai').count(),2)
    def test_request_id_and_refund_are_exactly_once(self):
        self.activate(daily_limits={'ai':10},monthly_limits={'ai':10})
        from api.limits import refund, snapshot
        with self.factory() as db:
            user=db.query(UserAccount).filter_by(id='a').one()
            first=consume(db,user,'ai',3,request_id='retry-reservation')
            second=consume(db,user,'ai',3,request_id='retry-reservation')
            self.assertEqual(first['usage_id'],second['usage_id'])
            self.assertEqual(snapshot(db,user)['meters']['ai']['used'],3)
            refund(db,user,'ai',first['day'],first['usage_id'])
            refund(db,user,'ai',first['day'],first['usage_id'])
            self.assertEqual(snapshot(db,user)['meters']['ai']['used'],0)
    def test_paid_call_period_cap_is_atomic(self):
        self.activate(daily_limits={'calls':100})
        with self.factory() as db:
            db.query(Subscription).filter_by(owner_user_id='a').update({'status':'active','plan':'starter','period_start':time.time()-10,'period_end':time.time()+3600,'calls_used':499})
            db.commit()
        def spend(_):
            with self.factory() as db:
                user=db.query(UserAccount).filter_by(id='a').one()
                try:consume(db,user,'calls');return True
                except Exception:db.rollback();return False
        with ThreadPoolExecutor(max_workers=4) as pool:outcomes=list(pool.map(spend,range(4)))
        self.assertEqual(sum(outcomes),1)
        with self.factory() as db:self.assertEqual(db.query(Subscription).filter_by(owner_user_id='a').one().calls_used,500)
    @patch('api.credentials.probe_key',return_value=('ok','Accepted'))
    def test_shared_budget_and_disabled_assignment(self,_probe):
        from services.developer_control import reserve_provider
        self.call('/providers/groq','PUT',{'secret':'fixture-secret','enabled':True,'monthly_requests':10,'monthly_spend_inr':4,'max_request_cost_inr':2})
        self.call('/users/a/providers/groq','PUT',{'mode':'shared'})
        with self.factory() as db:
            user=db.query(UserAccount).filter_by(id='a').one()
            reserve_provider(db,user,'groq');reserve_provider(db,user,'groq')
            with self.assertRaises(Exception):reserve_provider(db,user,'groq')
            db.rollback()
        self.call('/users/a/providers/groq','PUT',{'mode':'disabled'})
        with self.factory() as db:
            with self.assertRaises(Exception):reserve_provider(db,db.query(UserAccount).filter_by(id='a').one(),'groq')

    def test_release_validation_and_staged_cohorts(self):
        data={'version':'1.2.3','platform':'desktop-ui','manifest':{'url':'https://evil.example/bundle','sha256':'a'*64,'signature':'fake-test-signature','tested':True}}
        self.assertEqual(self.call('/releases','POST',data).status_code,422)
        data['manifest']['url']='https://updates.example.com/bundle'
        release=self.call('/releases','POST',data).json();rid=release['id']
        self.assertEqual(self.call('/releases/'+rid+'/action','POST',{'action':'publish'}).json()['cohort'],0)
        self.assertIsNone(self.call('/release',uid='a').json()['release'])
        self.assertIsNotNone(self.call('/release').json()['release'])
        for cap in (5,25,100):self.assertEqual(self.call('/releases/'+rid+'/action','POST',{'action':'promote'}).json()['cohort'],cap)
        self.assertIsNotNone(self.call('/release',uid='a').json()['release'])
        self.call('/releases/'+rid+'/action','POST',{'action':'rollback'})
        self.assertIsNone(self.call('/release',uid='a').json()['release'])

if __name__=='__main__':unittest.main()
