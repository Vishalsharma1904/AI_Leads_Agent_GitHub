"""Screenshot regression (2026-10-15): slow Maps searches must not discard leads already found."""
import asyncio, json, os, sys, unittest
from pathlib import Path
from unittest.mock import patch

import httpx
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from api import lead_jobs as leads


class LeadSourceBudgetTest(unittest.TestCase):
    def test_gather_within_keeps_finished_results(self):
        async def fast(): return ['a']
        async def boom(): raise ValueError('x')
        async def slow(): await asyncio.sleep(5); return ['never']
        out = asyncio.run(leads._gather_within([fast(), boom(), slow()], 0.2))
        self.assertEqual(out[0], ['a'])
        self.assertIsInstance(out[1], ValueError)
        self.assertIsInstance(out[2], asyncio.TimeoutError)

    def test_slow_maps_after_apify_is_partial_not_failed(self):
        engine = create_engine('sqlite:///:memory:')
        leads.Base.metadata.create_all(engine)
        factory = sessionmaker(bind=engine)
        db = factory()
        db.add(leads.UserAccount(id='u', email='u@example.test', name='U'))
        db.add(leads.LeadJob(id='j', owner_user_id='u', status='queued', request_payload=json.dumps(
            {'cities': ['Gurugram'], 'industries': ['Hotels'], 'count': 5, 'sources': ['maps', 'apify']})))
        db.commit()

        def provider(request):
            if request.url.path.endswith('/runs'):
                return httpx.Response(200, json={'data': {'id': 'r', 'status': 'SUCCEEDED', 'defaultDatasetId': 'd'}})
            return httpx.Response(200, json=[{'title': 'Apify Hotel', 'city': 'Gurugram', 'address': 'Gurugram',
                                              'phone': '+91 9876500001', 'searchString': 'Hotels in Gurugram'}])

        async def hanging_maps(*a, **kw):
            await asyncio.sleep(30)

        real_gather = leads._gather_within

        async def short_budget(coros, timeout):
            return await real_gather(coros, 0.3)

        original_client = httpx.AsyncClient
        with patch.object(leads, 'get_provider_secret', return_value='t'), \
             patch.object(leads.httpx, 'AsyncClient', side_effect=lambda **kw: original_client(
                 transport=httpx.MockTransport(provider), **kw)), \
             patch.object(leads, 'discover_businesses', side_effect=hanging_maps), \
             patch.object(leads, '_gather_within', new=short_budget), \
             patch.dict(os.environ, {'LEAD_WEBSITE_CRAWLER_ENABLED': 'false'}):
            asyncio.run(leads._run_apify('j', 'u', factory))
        db.expire_all()
        job = db.query(leads.LeadJob).filter_by(id='j').one()
        self.assertEqual(job.status, 'partial', job.error)
        self.assertEqual(job.result_count, 1)
        db.close(); engine.dispose()


if __name__ == '__main__':
    unittest.main()
