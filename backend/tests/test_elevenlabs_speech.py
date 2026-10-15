"""Run from backend: .venv312/Scripts/python.exe -m unittest tests.test_elevenlabs_speech -q

All ElevenLabs traffic uses httpx.MockTransport; no key or paid audio is used.
"""
import io
import json
import os
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import httpx
from fastapi import FastAPI, HTTPException, UploadFile
from fastapi.testclient import TestClient
from pydantic import ValidationError
from sqlalchemy import create_engine
from sqlalchemy.orm import Session

from api import auth_sync, credentials, speech, tts
from services.speech import elevenlabs_client as eleven

REAL_CLIENT = httpx.AsyncClient


class Chunks(httpx.AsyncByteStream):
    def __init__(self, values, fail=False):
        self.values, self.fail = values, fail
        self.reads, self.closed = 0, False

    async def __aiter__(self):
        for chunk in self.values:
            self.reads += 1
            yield chunk
        if self.fail:
            raise httpx.ReadError("never disclose private-provider-key")

    async def aclose(self):
        self.closed = True


def mock_client(handler):
    transport = httpx.MockTransport(handler)
    return patch.object(httpx, "AsyncClient", side_effect=lambda **kwargs: REAL_CLIENT(transport=transport, **kwargs))


class ElevenLabsSpeechTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.control_tmp = tempfile.TemporaryDirectory()
        self.control_engine = create_engine('sqlite:///' + str(Path(self.control_tmp.name)/'unit.db'))
        from services.developer_control import ProviderAssignment, UsageEvent
        auth_sync.Base.metadata.create_all(self.control_engine)
        self.control_db = Session(self.control_engine)
    async def asyncTearDown(self):
        self.control_db.close();self.control_engine.dispose();self.control_tmp.cleanup()

    async def test_vault_is_encrypted_and_has_no_shared_environment_fallback(self):
        with tempfile.TemporaryDirectory() as directory:
            engine = create_engine("sqlite:///" + (Path(directory) / "speech.db").as_posix())
            auth_sync.Base.metadata.create_all(engine)
            try:
                with Session(engine) as db, patch.dict(os.environ, {"CREDENTIAL_MASTER_KEY": "test-master-key-32-bytes-long-not-real", "ELEVENLABS_API_KEY": "operator-private-key"}), \
                        patch.object(credentials, "probe_key", return_value=("ok", "accepted")):
                    a, b = SimpleNamespace(id="tenant-a"), SimpleNamespace(id="tenant-b")
                    credentials.upsert_credential(credentials.CredentialRequest(provider="elevenlabs", secret=" tenant-key "), db, a)
                    record = db.query(credentials.ProviderCredential).one()
                    self.assertNotIn("tenant-key", record.ciphertext)
                    self.assertEqual(credentials.get_provider_secret("elevenlabs", a, db), "tenant-key")
                    self.assertIsNone(credentials.get_provider_secret("elevenlabs", b, db))
                    self.assertNotIn("tenant-key", str(credentials.list_credentials(db, a)))
                    credentials.delete_credential("elevenlabs", db, b)
                    self.assertEqual(db.query(credentials.ProviderCredential).count(), 1)
            finally:
                engine.dispose()

    async def test_cheap_probe_rejects_only_invalid_credentials(self):
        for status, code, expected in ((200, "", "ok"), (401, "invalid_api_key", "rejected"),
                                      (401, "missing_permissions", "unverified"), (403, "missing_permissions", "unverified"),
                                      (429, "too_many_concurrent_requests", "unverified")):
            response = httpx.Response(status, json={"detail": {"status": code}})
            with patch.object(credentials.httpx, "request", return_value=response) as request:
                state, _ = credentials.probe_key("elevenlabs", "private-provider-key")
                self.assertEqual(state, expected)
                self.assertEqual(request.call_args.args[:2], ("GET", "https://api.elevenlabs.io/v1/user/subscription"))
                self.assertEqual(request.call_args.kwargs["headers"], {"xi-api-key": "private-provider-key"})

    async def test_single_use_token_contract_and_secret_redaction(self):
        calls = []
        def handler(request):
            calls.append(request)
            return httpx.Response(200, json={"token": "sutkn_temporary-only"})
        user = SimpleNamespace(id="tenant-a")
        with patch.object(speech, "get_provider_secret", return_value="private-provider-key") as vault, mock_client(handler):
            response = await speech.elevenlabs_token(speech.ElevenLabsTokenRequest(language="hi"), self.control_db, user)
        self.assertEqual(json.loads(response.body)["token"], "sutkn_temporary-only")
        self.assertEqual(response.headers["cache-control"], "no-store")
        self.assertNotIn("private-provider-key", response.body.decode())
        vault.assert_called_once_with("elevenlabs", user, self.control_db)
        self.assertEqual(calls[0].method, "POST")
        self.assertEqual(calls[0].url.path, "/v1/single-use-token/realtime_scribe")
        self.assertEqual(calls[0].content, b"")
        self.assertEqual(calls[0].headers["xi-api-key"], "private-provider-key")

    async def test_metadata_uses_real_allowance_and_survives_scope_failure(self):
        def handler(request):
            if request.url.path == "/v2/voices":
                self.assertEqual(request.url.params["page_size"], "100")
                self.assertEqual(request.url.params["next_page_token"], "page-2")
                return httpx.Response(200, json={"voices": [{"voice_id": "v1", "name": "Voice", "owner_secret": "hidden",
                    "verified_languages": [{"language": "hi", "locale": "hi-IN", "accent": "indian", "owner_secret": "hidden"}, "malformed"]},
                    {"voice_id": "v2", "verified_languages": "malformed"}], "has_more": True, "next_page_token": "page-3"})
            if request.url.path == "/v1/models":
                return httpx.Response(200, json=[{"model_id": "m1", "can_do_text_to_speech": True, "can_use_style": False}, {"model_id": "stt", "can_do_text_to_speech": False}])
            return httpx.Response(200, json={"tier": "free", "character_count": 2500, "character_limit": 10000, "status": "active", "open_invoices": [{"secret": "hidden"}]})
        with patch.object(speech, "get_provider_secret", return_value="private-provider-key"), mock_client(handler):
            response = await speech.elevenlabs_config(self.control_db, SimpleNamespace(id="a"), "page-2", "")
        data = json.loads(response.body)
        self.assertEqual(data["subscription"]["remaining_characters"], 7500)
        self.assertEqual(data["models"][0]["model_id"], "m1")
        self.assertEqual(len(data["models"]), 1)
        self.assertEqual(data["voices_next_page_token"], "page-3")
        self.assertEqual(data["voices"][0]["verified_languages"], [{"language": "hi", "locale": "hi-IN", "accent": "indian"}])
        self.assertEqual(data["voices"][1]["verified_languages"], [])
        self.assertNotIn("hidden", response.body.decode())
        async def scoped(method, path, key, **kwargs):
            if path == "/v1/user/subscription":
                raise eleven.provider_error(401, {"detail": {"status": "missing_permissions"}})
            return {"voices": [{"voice_id": "v1"}]} if path == "/v2/voices" else []
        with patch.object(speech, "get_provider_secret", return_value="private-provider-key"), patch.object(eleven, "request_json", side_effect=scoped):
            data = json.loads((await speech.elevenlabs_config(self.control_db, SimpleNamespace(id="a"), "", "")).body)
        self.assertEqual(len(data["voices"]), 1)
        self.assertIsNone(data["subscription"])
        self.assertEqual(data["errors"]["subscription"]["code"], "ELEVENLABS_PERMISSION")

    async def test_provider_errors_are_actionable_and_never_echo_body(self):
        cases = ((401, "quota_exceeded", 429, "ELEVENLABS_QUOTA"),
                 (401, "invalid_api_key", 422, "ELEVENLABS_KEY_INVALID"),
                 (401, "missing_permissions", 403, "ELEVENLABS_PERMISSION"),
                 (402, "", 402, "ELEVENLABS_PLAN_REQUIRED"),
                 (429, "too_many_concurrent_requests", 429, "ELEVENLABS_RATE_LIMIT"),
                 (500, "", 502, "ELEVENLABS_UNAVAILABLE"))
        for status, code, expected_status, expected_code in cases:
            error = eleven.provider_error(status, {"detail": {"status": code, "message": "private-provider-key"}})
            self.assertEqual(error.status_code, expected_status)
            self.assertEqual(error.detail["code"], expected_code)
            self.assertNotIn("private-provider-key", str(error.detail))
        for status, code, expected_status, expected_code in ((402, "insufficient_credits", 402, "ELEVENLABS_QUOTA"),
                                                            (401, "insufficient_permissions", 403, "ELEVENLABS_PERMISSION"),
                                                            (403, "subscription_required", 402, "ELEVENLABS_PLAN_REQUIRED")):
            error = eleven.provider_error(status, {"detail": {"code": code, "status": "obsolete"}})
            self.assertEqual(error.status_code, expected_status)
            self.assertEqual(error.detail["code"], expected_code)

    async def test_pcm_reaches_browser_incrementally_with_settings_and_cleanup(self):
        stream = Chunks([b"\x00\x01", b"\x02", b"\x03\x04\x05"])
        calls = []
        def handler(request):
            calls.append(request)
            return httpx.Response(200, stream=stream)
        req = tts.TTSRequest(text="Namaste", engine="elevenlabs", fmt="pcm", voice_id="chosen-voice", lang="hi-IN", speed=1.1,
                             stability=.3, style=.2, similarity_boost=.8, use_speaker_boost=False,
                             pronunciation_dictionary_locators=[{"pronunciation_dictionary_id": "dictionary-a", "version_id": "version-b"}])
        with patch.object(tts, "get_provider_secret", return_value="private-provider-key"), mock_client(handler):
            response = await tts.synthesize(req, self.control_db, SimpleNamespace(id="a"))
            self.assertEqual(stream.reads, 1, "only prime the first chunk; do not buffer the entire response")
            audio = [chunk async for chunk in response.body_iterator]
        self.assertEqual(audio, stream.values)
        self.assertTrue(stream.closed)
        self.assertEqual(response.headers["x-tts-engine"], "elevenlabs")
        self.assertEqual(response.headers["x-audio-sample-rate"], "24000")
        self.assertEqual(calls[0].url.params["output_format"], "pcm_24000")
        body = json.loads(calls[0].content)
        self.assertEqual(body["model_id"], "eleven_flash_v2_5")
        self.assertEqual(body["language_code"], "hi")
        self.assertEqual(body["voice_settings"]["speed"], 1.1)
        self.assertEqual(body["pronunciation_dictionary_locators"][0]["version_id"], "version-b")
        self.assertNotIn("private-provider-key", str((response.headers, body)))

    async def test_explicit_provider_never_falls_back_and_auto_fallback_does_not_reuse_voice_id(self):
        def handler(request):
            return httpx.Response(401, json={"detail": {"status": "invalid_api_key", "message": "private-provider-key"}})
        with patch.object(tts, "get_provider_secret", return_value="private-provider-key"), mock_client(handler), \
                patch.object(tts, "synthesize_cartesia", new_callable=AsyncMock, return_value=b"\x00\x01") as cartesia:
            with self.assertRaises(HTTPException) as error:
                await tts.synthesize(tts.TTSRequest(text="Hello", engine="elevenlabs", fmt="pcm"), self.control_db, SimpleNamespace(id="a"))
            self.assertEqual(error.exception.status_code, 422)
            cartesia.assert_not_called()
            response = await tts.synthesize(tts.TTSRequest(text="Hello", voice_id="eleven-voice", fmt="pcm"), self.control_db, SimpleNamespace(id="a"))
            self.assertEqual(response.headers["x-tts-engine"], "cartesia")
            self.assertEqual(cartesia.call_args.kwargs["voice_id"], "")

    async def test_partial_output_failure_never_replays_or_switches_provider(self):
        stream = Chunks([b"\x00\x01"], fail=True)
        with patch.object(tts, "get_provider_secret", return_value="private-provider-key"), \
                mock_client(lambda request: httpx.Response(200, stream=stream)), patch.object(tts, "synthesize_cartesia", new_callable=AsyncMock) as cartesia:
            response = await tts.synthesize(tts.TTSRequest(text="Hello", fmt="pcm"), self.control_db, SimpleNamespace(id="a"))
            self.assertEqual(await anext(response.body_iterator), b"\x00\x01")
            with self.assertRaisesRegex(RuntimeError, "audio stream interrupted") as error:
                await anext(response.body_iterator)
            self.assertNotIn("private-provider-key", str(error.exception))
            cartesia.assert_not_called()
        self.assertTrue(stream.closed)

    async def test_cancel_closes_upstream_without_reading_remaining_audio(self):
        stream = Chunks([b"\x00\x01", b"\x02\x03"])
        with mock_client(lambda request: httpx.Response(200, stream=stream)):
            response = await eleven.synthesize_response("private-provider-key", "voice", {"text": "Hi"}, pcm=True)
            await anext(response.body_iterator)
            await response.body_iterator.aclose()
        self.assertTrue(stream.closed)
        self.assertEqual(stream.reads, 1)

    async def test_successful_non_audio_response_never_reaches_playback(self):
        stream = Chunks([b'{"detail":"private-provider-key"}'])
        with mock_client(lambda request: httpx.Response(200, headers={"content-type": "application/json"}, stream=stream)):
            with self.assertRaises(HTTPException) as error:
                await eleven.synthesize_response("private-provider-key", "voice", {"text": "Hi"}, pcm=True)
        self.assertEqual(error.exception.status_code, 502)
        self.assertEqual(stream.reads, 0, "an error document is closed before priming PCM")
        self.assertTrue(stream.closed)
        self.assertNotIn("private-provider-key", str(error.exception))

    async def test_legacy_gemini_paths_are_retired_and_requests_are_bounded(self):
        for fields in ({"engine": "gemini"}, {"engine": "elevenlabs", "speed": 1.5}, {"voice_id": "../foreign"},
                       {"pronunciation_dictionary_locators": [{"pronunciation_dictionary_id": "a"}] * 4}, {"stability": 1.1}):
            with self.assertRaises(ValidationError):
                tts.TTSRequest(text="hello", **fields)
        with self.assertRaises(HTTPException) as error:
            await speech.transcribe_audio(UploadFile(io.BytesIO(b"audio")), "", "gemini", SimpleNamespace(id="a"), None)
        self.assertEqual(error.exception.status_code, 422)
        self.assertEqual(speech.speech_health()["engine"], "elevenlabs")
        body = tts.elevenlabs_body(tts.TTSRequest(text="Hello", engine="elevenlabs", model_id="eleven_v4_turbo"), "Hello")
        self.assertEqual(set(body["voice_settings"]), {"stability", "similarity_boost"})
        body = tts.elevenlabs_body(tts.TTSRequest(text="Hello", engine="elevenlabs"), "Hello")
        self.assertNotIn("style", body["voice_settings"])
        self.assertNotIn("use_speaker_boost", body["voice_settings"])
        body = tts.elevenlabs_body(tts.TTSRequest(text="Hello", engine="elevenlabs", model_id="eleven_v3", stability=.3,
                                               similarity_boost=.9, speed=1.1, style=.2, use_speaker_boost=True), "Hello")
        self.assertEqual(body["voice_settings"], {"stability": .5}, "v3 cannot receive the unsupported v2 controls")
        body = tts.elevenlabs_body(tts.TTSRequest(text="Aapki report is ready", engine="elevenlabs", lang="auto"), "Aapki report is ready")
        self.assertNotIn("language_code", body, "code switching keeps provider language detection")

    async def test_http_endpoints_require_authentication(self):
        app = FastAPI()
        app.include_router(speech.router)
        app.include_router(tts.router)
        with TestClient(app) as client:
            for method, path, kwargs in (("post", "/api/speech/elevenlabs-token", {"json": {}}),
                                         ("get", "/api/speech/elevenlabs-config", {}),
                                         ("post", "/api/tts", {"json": {"text": "Hello"}})):
                response = getattr(client, method)(path, **kwargs)
                self.assertEqual(response.status_code, 401)


if __name__ == "__main__":
    unittest.main()
