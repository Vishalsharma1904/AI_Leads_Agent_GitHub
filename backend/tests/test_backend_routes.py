"""Actual HTTP failure/readiness boundaries; providers are never contacted."""
import json
import os
import time
import unittest
from unittest.mock import AsyncMock, patch
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool
import main
from api import auth_sync, credentials, candidate_jobs, web_reader
from services.developer_control import AccountControl


class BackendRoutesTest(unittest.TestCase):
    def setUp(self):
        self.engine = create_engine('sqlite://', connect_args={'check_same_thread':False}, poolclass=StaticPool)
        auth_sync.Base.metadata.create_all(self.engine)
        self.factory = sessionmaker(bind=self.engine)
        with self.factory() as db:
            db.add(auth_sync.UserAccount(id='customer', email='customer@example.test', name='Customer'))
            db.add(AccountControl(user_id='customer', status='active', expires_at=time.time()-60))
            db.commit()
        def database():
            with self.factory() as db: yield db
        main.app.dependency_overrides[auth_sync.get_db] = database
        self.addCleanup(main.app.dependency_overrides.clear)
        self.client = TestClient(main.app, raise_server_exceptions=False)
        self.addCleanup(self.client.close)
        self.addCleanup(self.engine.dispose)
        claims = {'sub':'customer','email':'customer@example.test','iat':time.time(),'exp':time.time()+600,'session_id':'fixture-session'}
        for change in [patch.dict(os.environ, {'CLAVIS_MANAGED_ACCESS':'true'}),
                       patch.object(auth_sync, '_verify_supabase_token', return_value=claims)]:
            change.start(); self.addCleanup(change.stop)
        self.headers = {'Authorization':'Bearer fixture-token'}

    def test_database_failure_is_not_reported_healthy(self):
        with patch.object(main, 'auth_engine') as engine:
            engine.connect.side_effect = RuntimeError('private-database-connection')
            response = self.client.get('/health')
        self.assertEqual(response.status_code, 503)
        self.assertEqual(response.json()['status'], 'degraded')
        self.assertEqual(response.json()['services']['db'], 'error')
        self.assertNotIn('private-database-connection', response.text)

    def test_healthy_database_keeps_startup_contract(self):
        with patch.object(main, 'auth_engine', self.engine):
            response = self.client.get('/health')
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()['status'], 'healthy')

    def test_web_read_requires_sign_in(self):
        with patch.object(web_reader, '_check_public', side_effect=lambda url:url), \
             patch.object(web_reader, '_get', new=AsyncMock(return_value=('https://example.test','<title>Public page</title><p>'+'Readable text. '*100+'</p>'))):
            response = self.client.post('/api/v1/web/read', json={'url':'https://example.test'})
        self.assertEqual(response.status_code, 401)

    def test_expired_account_denied_before_paid_provider_setup(self):
        cases = [('/api/v1/ai/chat', {'model':'groq/test','messages':[{'role':'user','content':'Hello'}]}),
                 ('/api/v1/candidate-jobs', {'role':'Guard','city':'Delhi','quantity':1})]
        for url, body in cases:
            with self.subTest(url=url), patch.object(candidate_jobs, '_run_job', new_callable=AsyncMock):
                response = self.client.post(url, json=body, headers=self.headers)
                self.assertEqual(response.status_code, 402, response.text)

    def test_unreadable_vault_has_actionable_response(self):
        with patch.dict(os.environ, {'CREDENTIAL_MASTER_KEY':'original-fixture-master-key-at-least-32-bytes'}):
            ciphertext, nonce = credentials.encrypt_secret('private-fixture-provider-key')
        with self.factory() as db:
            db.add(credentials.ProviderCredential(owner_user_id='customer', provider='groq', ciphertext=ciphertext, nonce=nonce)); db.commit()
        with patch.dict(os.environ, {'CREDENTIAL_MASTER_KEY':'different-fixture-master-key-at-least-32-bytes'}):
            response = self.client.post('/api/credentials/verify/groq', headers=self.headers)
        self.assertEqual(response.status_code, 503, response.text)
        self.assertEqual(response.json()['detail']['code'], 'CREDENTIAL_UNREADABLE')
        self.assertNotIn('private-fixture-provider-key', response.text)


if __name__ == '__main__': unittest.main()
