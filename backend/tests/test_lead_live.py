import asyncio
import json
import unittest
from unittest.mock import patch
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from api import lead_jobs as api


class LeadLiveTest(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.env = patch.dict(api.os.environ, {'LEAD_AUTHORITY_SEARCH':'0'})
        self.env.start()
        self.addCleanup(self.env.stop)

    async def test_all_includes_every_available_buyer_sector(self):
        plan = api._search_plan(['Delhi'], ['ALL'], 12)
        self.assertEqual(len(plan), len(api.DEFAULT_BUYER_SECTORS))
        self.assertIn('Warehouses & Logistics in Delhi', plan)

    async def test_partial_enrichment_preserves_profile_and_owner(self):
        engine=create_engine('sqlite:///:memory:')
        api.Base.metadata.create_all(engine)
        db=sessionmaker(bind=engine)()
        a=api.UserAccount(id='a',email='a@example.test',name='A')
        b=api.UserAccount(id='b',email='b@example.test',name='B')
        db.add_all([a,b,api.LeadRecord(id='a-row',owner_user_id='a',job_id='test',payload=json.dumps({'title':'Observed company','phone':'9811100042','address':'Delhi'})),
                    api.LeadRecord(id='b-row',owner_user_id='b',job_id='test',payload=json.dumps({'title':'Other company'}))]);db.commit()
        api._persist_enrichment(db,a,[{'id':'a-row','email':'public@example.test','phone':''},{'id':'b-row','email':'wrong@example.test'}])
        saved=json.loads(db.query(api.LeadRecord).filter_by(id='a-row').one().payload)
        self.assertEqual(saved['title'],'Observed company');self.assertEqual(saved['phone'],'9811100042')
        self.assertEqual(saved['email'],'public@example.test')
        self.assertNotIn('email',json.loads(db.query(api.LeadRecord).filter_by(id='b-row').one().payload))
        db.close();engine.dispose()
    async def test_stalled_enrichment_finishes_with_observed_partial_data(self):
        self.assertTrue(callable(getattr(api, '_bounded_enrichment', None)), 'enrichment needs a bounded lifecycle')
        rows = [{'id':'one','title':'Fixture','website':'https://example.test','phone':'+919811100042'}]
        async def blocked(items, **kwargs):
            items[0]['email'] = 'observed@example.test'
            await asyncio.Event().wait()
        events = []
        with patch.object(api, 'enrich_public_websites', side_effect=blocked):
            result = await asyncio.wait_for(api._bounded_enrichment(rows, events.append, timeout=.03), .5)
        self.assertEqual(result[0]['phone'], '+919811100042')
        self.assertEqual(result[0]['email'], 'observed@example.test')
        self.assertTrue(any(e.get('type') == 'timeout' for e in events))

    async def test_stream_emits_observed_company_progress_and_final_rows(self):
        self.assertTrue(callable(getattr(api, '_enrichment_events', None)), 'company progress must stream before completion')
        rows = [{'id':'one','title':'Fixture','website':'https://example.test','phone':'+919811100042'}]
        async def enrich(items, **kwargs):
            await kwargs['on_progress']({'type':'page','company':'Fixture','companyIndex':1,'companyTotal':1,'label':'Company 1/1: reading Fixture'})
            items[0]['email']='observed@example.test'
            return items
        with patch.object(api, 'enrich_public_websites', side_effect=enrich):
            events=[json.loads(line) async for line in api._enrichment_events(rows)]
        self.assertTrue(any(e.get('company') == 'Fixture' for e in events[:-1]))
        self.assertEqual(events[-1]['type'], 'result')
        self.assertEqual(events[-1]['records'][0]['email'], 'observed@example.test')


if __name__ == '__main__': unittest.main()
