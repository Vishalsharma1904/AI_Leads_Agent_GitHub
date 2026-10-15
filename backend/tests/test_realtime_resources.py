"""Realtime must release DB connections before waiting for a slow client."""
import asyncio
import os
from pathlib import Path
import tempfile
import time
from types import SimpleNamespace
import unittest
from unittest.mock import AsyncMock, patch
from fastapi import HTTPException
from sqlalchemy import create_engine
from sqlalchemy.exc import TimeoutError as PoolTimeout
from sqlalchemy.orm import sessionmaker
from api import auth_sync, control
from services.developer_control import AccountControl, check_session, reserve_provider


class RealtimeResourcesTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.engine = create_engine('sqlite:///' + (Path(self.tmp.name)/'stream.db').as_posix(),
                                    pool_size=1,max_overflow=0,pool_timeout=.1)
        auth_sync.Base.metadata.create_all(self.engine)
        self.factory = sessionmaker(bind=self.engine)
        self.db = self.factory()
        self.db.add(auth_sync.UserAccount(id='customer',email='customer@example.test',name='Customer'))
        self.db.add(AccountControl(user_id='customer',status='trial',expires_at=time.time()+600))
        self.db.commit()
        self.user = self.db.get(auth_sync.UserAccount,'customer')
        self.claims = {'session_id':'fixture-stream','iat':time.time(),'exp':time.time()+600}

    def tearDown(self):
        self.db.close();self.engine.dispose();self.tmp.cleanup()

    def test_idle_stream_leaves_the_only_pool_connection_available(self):
        request = SimpleNamespace(headers={'authorization':'Bearer fixture'},is_disconnected=AsyncMock(return_value=False))
        async def run():
            reply = await control.events(request,self.db,self.user)
            try:
                frame = await anext(reply.body_iterator)
                self.assertIn('revision',frame)
                self.assertEqual(self.engine.pool.checkedout(),0,'No SQL transaction may stay open across a streamed frame')
            except PoolTimeout:
                self.fail('Realtime exhausted the only DB connection before its first frame')
            finally: await reply.body_iterator.aclose()
        with patch.object(control,'SessionLocal',self.factory),patch.object(auth_sync,'_verify_supabase_token',return_value=self.claims):
            asyncio.run(run())

    def test_expired_stream_claims_cannot_keep_using_a_session(self):
        with self.assertRaises(HTTPException) as error:
            check_session(self.db,self.user,{**self.claims,'exp':time.time()-1})
        self.assertEqual(error.exception.status_code,401)

    def test_individual_provider_admission_releases_the_connection(self):
        reserve_provider(self.db,self.user,'groq')
        self.assertEqual(self.user.email,'customer@example.test')
        self.assertEqual(self.engine.pool.checkedout(),0,'A slow provider must not hold an idle SQL transaction')


if __name__=='__main__':unittest.main()
