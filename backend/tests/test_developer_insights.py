"""Access control and report workflow for the developer workspace."""
import os
import sys
import unittest
from unittest.mock import patch

sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from api.auth_sync import Base, UserAccount, get_current_user, get_db
from api.developer_insights import router


class DeveloperInsightsTest(unittest.TestCase):
    def setUp(self):
        engine = create_engine('sqlite://', connect_args={'check_same_thread': False}, poolclass=StaticPool)
        Base.metadata.create_all(engine)
        self.session_factory = sessionmaker(bind=engine)
        with self.session_factory() as db:
            db.add_all([
                UserAccount(id='dev', email='vishalsharma190405@gmail.com', name='Vishal', created_at=100),
                UserAccount(id='member', email='member@example.com', name='Member', created_at=100),
            ])
            db.commit()
        self.identity = 'member'
        app = FastAPI()
        app.include_router(router)

        def db_dependency():
            with self.session_factory() as db:
                yield db

        def user_dependency():
            with self.session_factory() as db:
                return db.query(UserAccount).filter_by(id=self.identity).one()

        app.dependency_overrides[get_db] = db_dependency
        app.dependency_overrides[get_current_user] = user_dependency
        self.claim_provider = 'google'
        self.token_patch = patch('api.developer_insights._verify_supabase_token',
                                 side_effect=lambda _: {'sub': self.identity,
                                                        'app_metadata': {'provider': self.claim_provider}})
        self.token_patch.start()
        self.addCleanup(self.token_patch.stop)
        self.client = TestClient(app, headers={'Authorization': 'Bearer verified-test-token'})

    def test_non_developer_cannot_read_or_resolve_reports(self):
        self.assertEqual(self.client.get('/api/insights/dashboard').status_code, 403)
        self.assertEqual(self.client.patch('/api/insights/bugs/fake', json={'status': 'resolved'}).status_code, 403)
        self.identity = 'dev'
        self.claim_provider = 'email'
        self.assertEqual(self.client.get('/api/insights/dashboard').status_code, 403)

    def test_report_is_visible_only_to_developer_and_can_be_resolved(self):
        report = self.client.post('/api/insights/bugs', json={
            'title': 'Settings freezes', 'description': 'The settings panel freezes after I save my theme.',
            'steps': 'Open settings, change theme, save', 'page': '#settings'
        })
        self.assertEqual(report.status_code, 201)
        self.assertEqual(self.client.get('/api/insights/dashboard').status_code, 403)
        self.identity = 'dev'
        response = self.client.get('/api/insights/dashboard')
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()['bugs'][0]['email'], 'member@example.com')
        bug_id = report.json()['id']
        self.assertEqual(self.client.patch(f'/api/insights/bugs/{bug_id}', json={'status': 'resolved'}).status_code, 200)
        self.assertEqual(self.client.get('/api/insights/dashboard').json()['metrics']['open_bugs'], 0)

    def test_heartbeat_counts_real_session_and_rejects_device_change(self):
        payload = {'session_id': '11111111-1111-4111-8111-111111111111',
                   'device_id': '22222222-2222-4222-8222-222222222222',
                   'device_label': 'Desktop', 'platform': 'Windows', 'region': 'Asia/Kolkata'}
        self.assertEqual(self.client.post('/api/insights/heartbeat', json=payload).status_code, 200)
        self.assertEqual(self.client.post('/api/insights/heartbeat', json={**payload, 'device_id': 'changed-device-id'}).status_code, 409)
        self.identity = 'dev'
        metrics = self.client.get('/api/insights/dashboard').json()['metrics']
        self.assertEqual(metrics['active_users'], 1)
        self.assertEqual(metrics['active_devices'], 1)


if __name__ == '__main__':
    unittest.main()
