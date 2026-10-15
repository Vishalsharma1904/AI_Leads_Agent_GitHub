"""End-to-end provider mocks: Apify -> persisted CRM -> owned calling history."""
import asyncio
import json
import os
import sys
import unittest
from pathlib import Path
from unittest.mock import patch
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
os.environ.setdefault('CREDENTIAL_MASTER_KEY','a'*64)
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool
from fastapi import HTTPException
from fastapi import BackgroundTasks
import httpx
from api.auth_sync import Base,UserAccount
from api import lead_jobs as lj, elevenlabs as el, billing
from api.crm import CRMRecord,CRMActivity

class Pipeline(unittest.TestCase):
    def setUp(self):
        self.engine=create_engine('sqlite://',connect_args={'check_same_thread':False},poolclass=StaticPool)
        Base.metadata.create_all(self.engine);self.session=sessionmaker(bind=self.engine);self.db=self.session()
        self.user=UserAccount(id='owner',email='owner@test.com',name='Owner');self.db.add(self.user);self.db.commit()
    def tearDown(self):self.db.close();self.engine.dispose()
    def test_exact_sector_in_any_address_order(self):
        self.assertTrue(lj._city_matches('Noida Sector 62','Sector 62, Noida, Uttar Pradesh'))
        self.assertTrue(lj._city_matches('Noida, Sector62','Office, sector 62, Noida'))
        self.assertFalse(lj._city_matches('Noida Sector 62','Sector 63, Noida'))
        self.assertFalse(lj._city_matches('Noida Sector 62','Sector 620, Noida'))
    def test_stale_search_recovers_without_provider_retry(self):
        self.db.add(lj.LeadJob(id='stale',owner_user_id='owner',request_payload='{}',status='running',updated_at=1))
        self.db.add(lj.LeadRecord(id='saved',owner_user_id='owner',job_id='stale',payload='{}'));self.db.commit()
        self.assertEqual(lj.recover_stale_jobs(self.session),1)
        self.db.expire_all();job=self.db.get(lj.LeadJob,'stale')
        self.assertEqual(job.status,'partial');self.assertEqual(job.result_count,1)
        self.assertEqual(lj.recover_stale_jobs(self.session),0)
    def test_search_request_is_idempotent_and_reserves_quota_once(self):
        request=lj.LeadJobRequest(cities=['Noida'],count=10,sources=['apify','maps'])
        with patch.object(lj,'consume',return_value={}) as quota:
            first=lj.create_lead_job(request,BackgroundTasks(),self.db,self.user,'same-search-key')
            second=lj.create_lead_job(request,BackgroundTasks(),self.db,self.user,'same-search-key')
            self.assertEqual(first['job']['id'],second['job']['id']);quota.assert_called_once_with(self.db,self.user,'leads',10)
            with self.assertRaises(HTTPException):lj.create_lead_job(request.model_copy(update={'count':11}),BackgroundTasks(),self.db,self.user,'same-search-key')
        background=BackgroundTasks()
        with patch.object(lj,'consume',side_effect=HTTPException(429,'Daily search limit')):
            with self.assertRaises(HTTPException):lj.create_lead_job(request,background,self.db,self.user,'quota-failed')
        self.assertEqual(len(background.tasks),0)
    def test_apify_count_and_crm_persistence(self):
        queries=['Hotels','Hospitals','Malls']
        payload=lj.LeadJobRequest(cities=['Noida'],industries=queries,count=10,sources=['apify'])
        job=lj.LeadJob(id='fixture-job',owner_user_id='owner',request_payload=payload.model_dump_json(),status='queued')
        self.db.add(job);self.db.commit();seen=[]
        real_client=httpx.AsyncClient
        def handler(request):
            if request.method=='POST':seen.append(json.loads(request.content));data={'data':{'id':'run-1','status':'SUCCEEDED','defaultDatasetId':'dataset-1'}}
            else:data=[{'title':f'Buyer {i}','placeId':str(i),'city':'Noida','address':'Noida','phone':f'+9199999999{i:02}','searchString':f'{queries[i%3]} in Noida'} for i in range(12)]
            return httpx.Response(200,json=data)
        with patch.object(lj.httpx,'AsyncClient',side_effect=lambda **kw:real_client(transport=httpx.MockTransport(handler),**kw)),patch.object(lj,'get_provider_secret',return_value='fixture-token'),patch.object(lj,'consume'),patch.dict(os.environ,{'LEAD_WEBSITE_CRAWLER_ENABLED':'false'}):
            asyncio.run(lj._run_apify('fixture-job','owner',self.session))
        self.db.expire_all()
        self.assertEqual(seen[0]['maxCrawledPlacesPerSearch'],4)
        self.assertEqual(self.db.get(lj.LeadJob,'fixture-job').result_count,10)
        self.assertEqual(self.db.query(CRMRecord).filter_by(owner_user_id='owner').count(),10)
        self.assertTrue(all(json.loads(r.payload).get('crmRecordId') for r in self.db.query(lj.LeadRecord)))
    def test_owned_call_history_and_transcript(self):
        self.db.add_all([CRMRecord(id='lead-a',owner_user_id='owner',profile=json.dumps({'company':'Hotel A','phone':'+919876543210'})),CRMRecord(id='guest',owner_user_id='other',profile='{}')]);self.db.commit()
        el._bind(self.db,self.user,'agent','agent-a');el._bind(self.db,self.user,'phone','phone-a')
        received=[]
        async def provider(method,path,user,db,payload=None):
            received.append((method,path,payload))
            if path=='/convai/agents/agent-a':return {'agent_id':'agent-a'}
            if path=='/convai/phone-numbers/phone-a':return {'phone_number_id':'phone-a','provider':'exotel','supports_outbound':True}
            if method=='POST':return {'id':'batch-a','status':'pending'}
            if path=='/convai/conversations/conv-a':return {'conversation_id':'conv-a','agent_id':'agent-a','status':'done','transcript':[{'role':'user','message':'Please send a proposal.'}],'analysis':{'transcript_summary':'Proposal requested'}}
            return {'id':'batch-a','status':'completed','recipients':[{'phone_number':'+919876543210','status':'completed','conversation_id':'conv-a'}]}
        request=dict(request_id='fixture-batch-123456',agent_id='agent-a',phone_number_id='phone-a',call_name='Reviewed batch',confirmed=True,recipients=[{'phone_number':'+919876543210','crm_record_id':'lead-a'}])
        with patch.object(el,'_provider',provider),patch.object(el,'get_provider_secret',return_value='fixture-key'):
            bad={**request,'recipients':[{'phone_number':'+919876543210','crm_record_id':'guest'}]}
            with self.assertRaises(HTTPException):asyncio.run(el.submit_batch(el.BatchCallRequest(**bad),self.db,self.user))
            self.assertFalse(received)
            mismatch={**request,'recipients':[{'phone_number':'+919876543211','crm_record_id':'lead-a'}]}
            with self.assertRaises(HTTPException):asyncio.run(el.submit_batch(el.BatchCallRequest(**mismatch),self.db,self.user))
            record=self.db.get(CRMRecord,'lead-a');record.profile=json.dumps({'phone':'+919876543210','phoneOptOut':True});self.db.commit()
            with self.assertRaises(HTTPException):asyncio.run(el.submit_batch(el.BatchCallRequest(**request),self.db,self.user))
            record.profile=json.dumps({'company':'Hotel A','phone':'+919876543210'});self.db.commit()
            self.assertFalse(received)
            result=asyncio.run(el.submit_batch(el.BatchCallRequest(**request),self.db,self.user))
            self.assertEqual(result['recipients'][0]['crm_record_id'],'lead-a')
            async def stop(_):raise asyncio.CancelledError()
            with patch('api.auth_sync.SessionLocal',self.session),patch.object(el.asyncio,'sleep',stop):
                with self.assertRaises(asyncio.CancelledError):asyncio.run(el.batch_history_worker())
            self.db.expire_all()
            self.assertEqual(self.db.query(CRMActivity).filter_by(record_id='lead-a',kind='call_transcript').count(),1)
            asyncio.run(el.batch_call(request['request_id'],self.db,self.user))
            self.assertIsNone(asyncio.run(el.batch_call('batch-a',self.db,self.user))['request_id'])
            self.assertEqual(el._batch_details(self.db.query(el.ElevenLabsResource).filter_by(kind='batch_request',resource_id=request['request_id']).one())['status'],'completed')
            self.assertEqual(self.db.query(CRMActivity).filter_by(record_id='lead-a',kind='call_status').count(),2)
            asyncio.run(el.conversation('conv-a',self.db,self.user));asyncio.run(el.conversation('conv-a',self.db,self.user))
            notes=self.db.query(CRMActivity).filter_by(record_id='lead-a',kind='call_transcript').all()
            self.assertEqual(len(notes),1);self.assertIn('Please send a proposal',notes[0].note)
            with self.assertRaises(HTTPException):asyncio.run(el.conversation('conv-a',self.db,UserAccount(id='other')))
            posted=next(row[2] for row in received if row[0]=='POST')
            self.assertNotIn('crm_record_id',json.dumps(posted))
            self.assertEqual(posted['target_concurrency_limit'],1)

    def test_whatsapp_signed_status_reaches_crm_without_delivery_guess(self):
        from api import mobile_jobs as mobile
        from api.whatsapp import WhatsAppMessage
        Base.metadata.create_all(self.engine)
        self.db.add(CRMRecord(id='wa-lead',owner_user_id='owner',profile=json.dumps({'phone':'+919876543210'})));self.db.commit()
        request=mobile.BatchRequest(channel='whatsapp',request_id='wa-fixture-123456',record_ids=['wa-lead'],confirmed=True,template='intro',language='en',opt_in=True)
        result=mobile.create(request,self.db,self.user);job=self.db.get(mobile.OutreachJob,result['job']['id'])
        item=self.db.query(mobile.OutreachItem).filter_by(job_id=job.id).one()
        message=WhatsAppMessage(id='wa-message',owner_user_id='owner',idempotency_key=item.id,request_hash='digest',phone_number_id='phone',to=item.recipient,template='intro',status='accepted',provider_message_id='wamid.fixture',detail='Accepted by Meta; delivery awaits a signed webhook.')
        self.db.add(message);self.db.commit()
        mobile.public(self.db,job);mobile.public(self.db,job)
        self.assertEqual(self.db.query(CRMActivity).filter_by(record_id='wa-lead').count(),1)
        self.assertEqual(item.status,'accepted')
        message.status='delivered';message.detail='Verified Meta delivery status: delivered';self.db.commit()
        mobile.public(self.db,job)
        self.assertEqual(item.status,'delivered')
        self.assertEqual(self.db.query(CRMActivity).filter_by(record_id='wa-lead').count(),2)

if __name__=='__main__':unittest.main()
