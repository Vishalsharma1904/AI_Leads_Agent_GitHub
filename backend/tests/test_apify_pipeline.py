"""Apify lifecycle regression; responses are fixtures, never real account calls."""
import asyncio
import json
import os
import sys
import unittest
from pathlib import Path
from unittest.mock import patch

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
import httpx

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from api import lead_jobs as leads


class ApifyPipelineTest(unittest.TestCase):
    def test_cancel_keeps_sourced_rows_and_aborts_actor(self):
        engine = create_engine('sqlite:///:memory:')
        leads.Base.metadata.create_all(engine)
        factory = sessionmaker(bind=engine)
        db = factory()
        db.add(leads.UserAccount(id='stop-user', email='stop@example.test', name='Test'))
        db.add(leads.LeadJob(id='stop-job', owner_user_id='stop-user', status='queued', request_payload=json.dumps(
            {'cities': ['Delhi'], 'industries': ['Hotels'], 'count': 2})))
        db.commit()
        aborted = []

        def provider(request):
            path = request.url.path
            if path.endswith('/runs'):
                self.assertEqual(json.loads(request.content)['maxCrawledPlacesPerSearch'], 2)
                return httpx.Response(200, json={'data': {'id': 'run-stop', 'status': 'RUNNING', 'defaultDatasetId': 'data-stop'}})
            if path.endswith('/abort'):
                aborted.append(True)
                return httpx.Response(200, json={'data': {'status': 'ABORTED'}})
            if '/actor-runs/' in path:
                other = factory()
                other.query(leads.LeadJob).filter_by(id='stop-job').update({'status': 'cancelled'})
                other.commit(); other.close()
                return httpx.Response(200, json={'data': {'status': 'RUNNING'}})
            return httpx.Response(200, json=[{'title': 'Stopped Hotel', 'city': 'Delhi', 'address': 'Delhi',
                                              'phone': '+91 9811100001', 'searchString': 'Hotels in Delhi'}])

        original_client = httpx.AsyncClient
        with patch.object(leads, 'get_provider_secret', return_value='test-token'), \
             patch.object(leads.httpx, 'AsyncClient', side_effect=lambda **kw: original_client(
                 transport=httpx.MockTransport(provider), **kw)):
            asyncio.run(leads._run_apify('stop-job', 'stop-user', factory))
        db.expire_all()
        self.assertTrue(aborted)
        self.assertEqual(db.query(leads.LeadJob).filter_by(id='stop-job').one().status, 'cancelled')
        self.assertEqual(db.query(leads.LeadRecord).count(), 1)
        db.close(); engine.dispose()

    def test_poll_dataset_alias_and_progressive_persistence(self):
        engine = create_engine('sqlite:///:memory:')
        leads.Base.metadata.create_all(engine)
        factory = sessionmaker(bind=engine)
        db = factory()
        db.add(leads.UserAccount(id='test-user', email='test@example.test', name='Test'))
        db.add(leads.LeadJob(id='test-job', owner_user_id='test-user', status='queued', request_payload=json.dumps(
            {'cities': ['Gurgaon'], 'industries': ['Hotels'], 'count': 1})))
        db.commit()
        calls = []

        def provider(request):
            calls.append(request.url.path)
            if request.url.path.endswith('/runs'):
                data = {'data': {'id': 'run1', 'status': 'RUNNING'}}
            elif '/actor-runs/' in request.url.path:
                data = {'data': {'id': 'run1', 'status': 'SUCCEEDED', 'defaultDatasetId': 'data1'}}
            else:
                data = [{'title': 'Fixture Hotel', 'city': 'Gurugram', 'address': 'Gurugram',
                         'phone': '+91 9876543210', 'website': 'https://fixture.example.test',
                         'searchString': 'Hotels in Gurgaon'}]
            return httpx.Response(200, json=data)

        async def enrich(records, **kwargs):
            progress = factory()
            self.assertEqual(progress.query(leads.LeadJob).one().status, 'running')
            self.assertEqual(progress.query(leads.LeadJob).one().result_count, 1)
            self.assertEqual(progress.query(leads.LeadRecord).count(), 1)
            progress.close()
            records[0]['email'] = 'contact@fixture.example.test'
            raise asyncio.TimeoutError('website budget expired')

        original_client = httpx.AsyncClient
        with patch.object(leads, 'get_provider_secret', return_value='test-token'), \
             patch.object(leads.httpx, 'AsyncClient', side_effect=lambda **kw: original_client(
                 transport=httpx.MockTransport(provider), **kw)), \
             patch.object(leads, 'enrich_public_websites', side_effect=enrich), \
             patch.dict(os.environ, {'LEAD_WEBSITE_CRAWLER_ENABLED': 'true'}):
            asyncio.run(leads._run_apify('test-job', 'test-user', factory))
        db.expire_all()
        job = db.query(leads.LeadJob).filter_by(id='test-job').one()
        self.assertEqual(job.status, 'completed')
        self.assertEqual(job.result_count, 1)
        self.assertEqual(db.query(leads.LeadRecord).count(), 1)
        self.assertEqual(json.loads(db.query(leads.LeadRecord).one().payload)['email'], 'contact@fixture.example.test')
        self.assertTrue(any('/actor-runs/' in path for path in calls))
        db.close()
        engine.dispose()

    def test_contact_selection_preserves_real_fields_and_deduplicates(self):
        items = [{'title': 'Fixture A', 'placeId': '1', 'phone': '123', 'searchString': 'Hotels in Delhi'},
                 {'title': 'Duplicate A', 'placeId': '1', 'phone': '123'},
                 {'title': 'No contact', 'placeId': '2'},
                 {'title': 'Fixture B', 'placeId': '3', 'emails': ['observed@example.test']}]
        selected = leads._contactable_items(items, ['Hotels in Delhi'], 5)
        self.assertEqual(len(selected), 2)
        self.assertEqual(selected[1]['email'], 'observed@example.test')
        self.assertLessEqual(len(leads._search_plan(['Delhi'], ['ALL'], 3)), 3)


if __name__ == '__main__':
    unittest.main()
