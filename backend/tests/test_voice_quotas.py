"""Real quota/HTTP integration with isolated DB and mocked paid providers."""
import asyncio
import io
import wave
import unittest
from concurrent.futures import ThreadPoolExecutor
from unittest.mock import AsyncMock, patch

import httpx
from fastapi import HTTPException
from fastapi.responses import Response, StreamingResponse
from api import speech, tts, credentials, elevenlabs
from api.limits import consume, snapshot
from api.auth_sync import UserAccount
from services.developer_control import UsageEvent
from tests import test_developer_control as control_fixture
from tests.test_elevenlabs_speech import mock_client


class VoiceQuotaTest(unittest.TestCase):
    call = control_fixture.ControlTest.call
    activate = control_fixture.ControlTest.activate

    def setUp(self):
        control_fixture.ControlTest.setUp(self)
        self.client.app.include_router(tts.router)
        self.client.app.include_router(speech.router)
        self.client.app.include_router(elevenlabs.router)

    def post(self, path, body):
        return self.client.post(path, json=body, headers={'Authorization': 'Bearer a'})

    def usage(self, meter):
        with self.factory() as db:
            user = db.query(UserAccount).filter_by(id='a').one()
            return snapshot(db, user)['meters'][meter]['used']

    def test_individual_tts_quota_and_known_rejection_refund(self):
        self.assertEqual(self.activate(daily_limits={'tts_characters': 3}).status_code, 200)
        with patch.object(tts, 'get_provider_secret', return_value='fixture-key'), patch.object(tts.elevenlabs_client, 'synthesize_response', new_callable=AsyncMock) as provider:
            provider.side_effect = HTTPException(422, 'Rejected key')
            self.assertEqual(self.post('/api/tts', {'text': 'abc', 'engine': 'elevenlabs'}).status_code, 422)
            self.assertEqual(self.usage('tts_characters'), 0)
            provider.side_effect = None
            provider.return_value = Response(b'fixture-audio', media_type='audio/wav')
            self.assertEqual(self.post('/api/tts', {'text': 'abc', 'engine': 'elevenlabs'}).status_code, 200)
            self.assertEqual(self.post('/api/tts', {'text': 'x', 'engine': 'elevenlabs'}).status_code, 429)
            self.assertEqual(provider.call_count, 2)
        with self.factory() as db:
            self.assertEqual({e.state for e in db.query(UsageEvent).filter_by(user_id='a', meter='tts_characters')}, {'refunded', 'failed', 'succeeded'})

    def test_timeout_retains_unknown_reservation_and_voice_disabled(self):
        self.activate(daily_limits={'tts_characters': 3})
        with patch.object(tts, 'get_provider_secret', return_value='fixture-key'), patch.object(tts.elevenlabs_client, 'synthesize_response', side_effect=HTTPException(504, 'timeout')):
            self.assertEqual(self.post('/api/tts', {'text': 'abc', 'engine': 'elevenlabs'}).status_code, 504)
        self.assertEqual(self.usage('tts_characters'), 3)
        with self.factory() as db:
            self.assertEqual(db.query(UsageEvent).filter_by(user_id='a', meter='tts_characters').one().state, 'unknown')
        self.activate(features={'voice': False})
        with patch.object(speech, 'get_provider_secret', return_value='fixture-key'), patch.object(speech.elevenlabs_client, 'request_json', new_callable=AsyncMock) as provider:
            self.assertEqual(self.post('/api/speech/elevenlabs-token', {}).status_code, 403)
            provider.assert_not_called()

    def test_session_monthly_limit_shared_and_individual(self):
        self.activate(daily_limits={'voice_sessions': 10}, monthly_limits={'voice_sessions': 1})
        with patch.object(speech, 'get_provider_secret', return_value='fixture-key'), patch.object(speech.elevenlabs_client, 'request_json', new_callable=AsyncMock, return_value={'token': 'ephemeral-fixture-token'}) as provider:
            first = self.post('/api/speech/elevenlabs-token', {})
            self.assertEqual(first.status_code, 200)
            self.assertIn('not hard-capped', first.json()['allowance_basis'])
            self.assertEqual(self.post('/api/speech/elevenlabs-token', {}).status_code, 429)
            self.assertEqual(provider.call_count, 1)
            with patch('api.credentials.probe_key', return_value=('ok', 'Accepted')):
                self.assertEqual(self.call('/providers/elevenlabs', 'PUT', {'secret': 'fixture-shared-key', 'enabled': True, 'monthly_requests': 10}).status_code, 200)
            self.assertEqual(self.call('/users/a/providers/elevenlabs', 'PUT', {'mode': 'shared'}).status_code, 200)
            self.assertEqual(self.post('/api/speech/elevenlabs-token', {}).status_code, 429)
            self.assertEqual(provider.call_count, 1)

    def test_uploaded_audio_seconds_are_reserved_before_provider(self):
        self.activate(daily_limits={'voice_seconds': 2})
        data = io.BytesIO()
        with wave.open(data, 'wb') as wav:
            wav.setnchannels(1); wav.setsampwidth(2); wav.setframerate(16000)
            wav.writeframes(b'\x01\x01' * 20000)
        calls = []
        def provider(request):
            calls.append(request)
            return httpx.Response(200, json={'text': 'Hello', 'duration': 1.25, 'segments': []})
        with patch.object(speech, 'get_provider_secret', return_value='fixture-key'), patch.object(speech, 'prepare_transcription_wav', return_value=data.getvalue()), mock_client(provider):
            for status in (200, 429):
                response = self.client.post('/api/speech/transcribe', headers={'Authorization': 'Bearer a'}, files={'file': ('speech.wav', data.getvalue(), 'audio/wav')})
                self.assertEqual(response.status_code, status)
        self.assertEqual(len(calls), 1)
        self.assertEqual(self.usage('voice_seconds'), 2)
        with self.factory() as db:
            event = db.query(UsageEvent).filter_by(user_id='a', meter='stt_seconds').one()
            self.assertEqual((event.amount, event.basis), (1.25, 'provider_reported'))

    def test_weighted_voice_concurrency(self):
        self.activate(daily_limits={'voice_seconds': 100}, monthly_limits={'voice_seconds': 5})
        def spend(_):
            with self.factory() as db:
                user = db.query(UserAccount).filter_by(id='a').one()
                try:
                    consume(db, user, 'voice_seconds', 3, provider='groq', basis='submitted_audio_seconds')
                    return True
                except HTTPException:
                    db.rollback()
                    return False
        with ThreadPoolExecutor(max_workers=4) as pool:
            self.assertEqual(sum(pool.map(spend, range(4))), 1)
        self.assertEqual(self.usage('voice_seconds'), 3)

    def test_stream_interruption_is_unknown_and_closes_audio(self):
        self.activate()
        closed = []
        async def audio():
            try:
                yield b'first'
                raise httpx.ReadError('provider interrupted')
            finally:
                closed.append(True)
        async def run():
            with self.factory() as db:
                user = db.query(UserAccount).filter_by(id='a').one()
                reservation = consume(db, user, 'tts_characters', 3, provider='elevenlabs')
                response = tts.metered_audio(StreamingResponse(audio()), db, user, reservation)
                with self.assertRaises(httpx.ReadError):
                    async for _ in response.body_iterator:
                        pass
        asyncio.run(run())
        self.assertTrue(closed)
        with self.factory() as db:
            self.assertEqual(db.query(UsageEvent).filter_by(user_id='a', meter='tts_characters').one().state, 'unknown')

    def test_legacy_live_token_cannot_bypass_session_cap(self):
        self.activate(daily_limits={'voice_sessions': 0})
        with patch.object(credentials, 'get_provider_secret', return_value='fixture-key'), patch.object(credentials.httpx, 'AsyncClient') as provider:
            response = self.client.post('/api/credentials/gemini-live-token', headers={'Authorization': 'Bearer a'}, json={'model': next(iter(credentials.LIVE_MODELS))})
            self.assertEqual(response.status_code, 403)
            provider.assert_not_called()

    def test_agent_preview_uses_the_same_session_allowance(self):
        self.activate(daily_limits={'voice_sessions': 1})
        with self.factory() as db:
            user = db.query(UserAccount).filter_by(id='a').one()
            elevenlabs._bind(db, user, 'agent', 'fixture-agent', 'Test')
        with patch.object(elevenlabs, '_provider', new_callable=AsyncMock, return_value={'signed_url': 'wss://api.elevenlabs.io/v1/convai/conversation?signature=fixture'}) as provider:
            for status in (200, 429):
                response = self.post('/api/v1/elevenlabs/agents/fixture-agent/preview', {})
                self.assertEqual(response.status_code, status)
            self.assertEqual(provider.call_count, 1)


if __name__ == '__main__':
    unittest.main()
