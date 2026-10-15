"""Candidate jobs obey access, idempotency and quota before spending."""
import asyncio
import json
import os
import time
import unittest
from unittest.mock import patch
from fastapi import BackgroundTasks, HTTPException
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool
from api import auth_sync, billing, candidate_jobs as api
from api.limits import TenantLimits
from services.developer_control import AccountControl, UsageEvent


class CandidateJobsTest(unittest.TestCase):
    def setUp(self):
        self.engine = create_engine('sqlite://', connect_args={'check_same_thread':False}, poolclass=StaticPool)
        auth_sync.Base.metadata.create_all(self.engine)
        self.factory = sessionmaker(bind=self.engine)
        self.db = self.factory()
        self.user = auth_sync.UserAccount(id='customer', email='customer@example.test', name='Customer')
        self.db.add_all([self.user, AccountControl(user_id=self.user.id,status='active',expires_at=time.time()+600)])
        self.db.commit()
        self.requests = []
        async def actor(client, key, token, query):
            self.requests.append(query['quantity'])
            return api.ACTORS[key][1], [{'source_key':key,'title':str(n)} for n in range(query['quantity'])], None
        for change in [patch.dict(os.environ, {'CLAVIS_MANAGED_ACCESS':'true'}),
                       patch.object(api,'get_provider_secret',return_value='fixture-provider-key'),
                       patch.object(api,'_run_actor',side_effect=actor)]:
            change.start(); self.addCleanup(change.stop)

    def tearDown(self):
        self.db.close(); self.engine.dispose()

    def create(self, quantity=4, key='fixture-request', role='Guard'):
        return api.create_candidate_job(api.CandidateJobRequest(role=role,city='Delhi',quantity=quantity,sources=['naukri','shine']),
                                        BackgroundTasks(),self.db,self.user,key)['job']['id']

    def run_job(self, job):
        asyncio.run(api._run_job(job,self.user.id,self.factory))
        self.db.expire_all()
        return self.db.get(api.CandidateJob,job)

    def test_block_after_queue_pauses_without_provider_work(self):
        job = self.create()
        self.db.get(AccountControl,self.user.id).status='blocked'; self.db.commit()
        self.assertEqual(self.run_job(job).status,'paused')
        self.assertEqual(self.requests,[])
        self.assertEqual(self.db.query(api.CandidateRecord).count(),0)

    def test_same_request_id_cannot_change_the_search(self):
        first = self.create()
        self.assertEqual(self.create(),first)
        with self.assertRaises(HTTPException) as error: self.create(role='Nurse')
        self.assertEqual(error.exception.status_code,409)

    def test_exhausted_allowance_never_starts_actors(self):
        self.db.add(TenantLimits(owner_user_id=self.user.id,leads_per_day=0));self.db.commit()
        self.assertEqual(self.run_job(self.create()).status,'paused')
        self.assertEqual(self.requests,[])

    def test_quantity_is_shared_across_sources_and_usage_is_actual(self):
        job=self.create(quantity=5)
        self.assertEqual(self.run_job(job).result_count,5)
        self.assertEqual(sum(self.requests),5)
        self.assertEqual(self.db.get(TenantLimits,self.user.id).leads_used,5)
        event=self.db.query(UsageEvent).filter_by(user_id=self.user.id,meter='leads').one()
        self.assertEqual(event.amount,5)
        before=list(self.requests)
        self.run_job(job)
        self.assertEqual(self.requests,before,'A finished background job cannot spend again')

    def test_partial_results_release_unused_quota(self):
        async def partial(*args): return 'Naukri',[{'title':'One observed listing'}],None
        with patch.object(api,'_run_actor',side_effect=partial): job=self.run_job(self.create(quantity=5))
        self.assertEqual(job.status,'partial')
        self.assertEqual(job.result_count,2)
        self.assertEqual(self.db.get(TenantLimits,self.user.id).leads_used,2)
        self.assertEqual(self.db.query(UsageEvent).filter_by(meter='leads').one().amount,2)


if __name__=='__main__': unittest.main()
