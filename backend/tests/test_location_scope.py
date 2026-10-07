import asyncio
import json
import sys
import unittest
from pathlib import Path
from unittest.mock import AsyncMock, patch
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from api import lead_jobs as leads


class LocationScopeTest(unittest.TestCase):
    def test_boundaries_and_city_aliases(self):
        for requested, place, expected in [
            ('East Delhi', 'Patparganj, East Delhi, Delhi', True),
            ('East Delhi', 'Dwarka, New Delhi, Delhi', False),
            ('East Delhi', 'Delhi', False),
            ('East Delhi', '', False),
            ('Sector 62 Noida', 'Sector 62, Noida', True),
            ('Sector 62 Noida', 'Sector 620, Noida', False),
            ('Loni', 'Colonies Road', False),
            ('Gurgaon', 'Gurugram, Haryana', True),
            ('Meerut, Uttar Pradesh', 'Meerut, Meerut district, Uttar Pradesh', True),
            ('Meerut, Uttar Pradesh', 'Meerut', False),
            ('Rampur, Uttar Pradesh', 'Rampur, Himachal Pradesh', False),
            ('Gurgaon, Haryana', 'Gurugram, Sector 44, Haryana', True),
        ]:
            with self.subTest(requested=requested, place=place):
                self.assertEqual(leads._city_matches(requested, place), expected)

    def test_fallback_filters_before_publish_and_enriches_missing_phone(self):
        engine = create_engine('sqlite:///:memory:')
        leads.Base.metadata.create_all(engine)
        factory = sessionmaker(bind=engine)
        db = factory()
        db.add(leads.UserAccount(id='scope-test', email='scope@example.test', name='Test'))
        db.add(leads.LeadJob(id='scope-job', owner_user_id='scope-test', status='queued', request_payload=json.dumps(
            {'cities': ['East Delhi'], 'industries': ['Hotels'], 'count': 2})))
        db.commit()
        records = [
            {'title': 'Local fixture', 'city': 'Delhi', 'address': 'East Delhi, Delhi', 'email': 'local@example.test', 'website': 'https://example.test'},
            {'title': 'Outside fixture', 'city': 'New Delhi', 'address': 'Dwarka, New Delhi', 'phone': '+91 9811100042'},
        ]

        async def enrich(items, **kwargs):
            self.assertEqual([item['title'] for item in items], ['Local fixture'])
            # The API has only published the matching record at this stage.
            self.assertEqual(db.query(leads.LeadRecord).count(), 1)
            items[0]['phone'] = '+91 9811100043'
            items[0]['contact_phone_source'] = 'https://example.test/contact'
            return items

        with patch.object(leads, 'get_provider_secret', return_value=None), \
             patch.object(leads, 'discover_businesses', new=AsyncMock(return_value=records)), \
             patch.object(leads, 'enrich_public_websites', side_effect=enrich), \
             patch.dict(leads.os.environ, {'LEAD_WEBSITE_CRAWLER_ENABLED': 'true'}):
            asyncio.run(leads._run_apify('scope-job', 'scope-test', factory))
        db.expire_all()
        saved = [json.loads(r.payload) for r in db.query(leads.LeadRecord).all()]
        self.assertEqual(len(saved), 1)
        self.assertEqual(saved[0]['title'], 'Local fixture')
        self.assertEqual(saved[0]['phone'], '+91 9811100043')
        self.assertEqual(db.query(leads.LeadJob).one().status, 'partial')
        db.close()
        engine.dispose()


if __name__ == '__main__':
    unittest.main()
