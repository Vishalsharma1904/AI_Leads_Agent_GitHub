"""Directory-only selection, persistence and white-label API checks. No network."""
import json
import os
import unittest
from unittest.mock import patch
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from api import lead_jobs as api


class DirectoryPipelineTest(unittest.IsolatedAsyncioTestCase):
    async def test_selected_directory_runs_and_retains_private_evidence(self):
        engine = create_engine('sqlite:///:memory:')
        api.Base.metadata.create_all(engine)
        factory = sessionmaker(bind=engine)
        db = factory()
        db.add(api.UserAccount(id='directory-user', email='directory@example.test', name='Fixture'))
        request = api.LeadJobRequest(cities=['Delhi'], industries=['Hotels'], count=3, sources=['justdial'])
        db.add(api.LeadJob(id='directory-job', owner_user_id='directory-user', status='queued', request_payload=request.model_dump_json()))
        db.commit()
        async def directories(queries, providers, **kwargs):
            self.assertEqual(providers, ['justdial'])
            return [{'title': 'Fixture Hotel', 'address': 'Delhi', 'phone': '9811100042',
                     'searchString': queries[0], 'discoveryEvidence': [{'provider': 'justdial', 'url': 'https://justdial.com/fixture'}]}]
        async def unexpected(*args, **kwargs): raise AssertionError('Unselected source must not start discovery')
        with patch.object(api, 'discover_indexed_businesses', side_effect=directories), \
             patch.object(api, 'discover_businesses', side_effect=unexpected), \
             patch.dict(os.environ, {'LEAD_WEBSITE_CRAWLER_ENABLED':'false'}):
            await api._run_apify('directory-job', 'directory-user', factory)
        db.expire_all()
        self.assertEqual(db.query(api.LeadJob).one().status, 'partial')
        self.assertEqual(db.query(api.LeadJob).one().result_count, 1)
        raw = json.loads(db.query(api.LeadRecord).one().payload)
        self.assertIn('discoveryEvidence', raw, 'Server keeps provenance')
        user = db.query(api.UserAccount).one()
        payload = api.get_lead_job('directory-job', db, user)
        self.assertNotIn('justdial', json.dumps(payload).lower(), 'Customer response hides discovery destination')
        self.assertEqual(payload['leads'][0]['phone'], '9811100042')
        db.close(); engine.dispose()

    def test_progress_keeps_company_but_hides_provider(self):
        job = api.LeadJob(id='x', status='running', result_count=0, error=json.dumps({'label':'Apify scanning', 'company':'Fixture', 'companyIndex':1}))
        payload = api._job_payload(job)
        self.assertNotIn('apify', json.dumps(payload).lower())
        self.assertEqual(payload['progress']['company'], 'Fixture')
        with self.assertRaises(ValueError):
            api.LeadJobRequest(cities=['Delhi'], sources=['https://private.test'])


if __name__ == '__main__': unittest.main()
