"""Run from backend: .venv312/Scripts/python.exe -m unittest tests.test_voice_providers -q"""
import io
import json
import unittest
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import httpx
from fastapi import HTTPException, UploadFile
from api import speech, tts
from api import ai_chat, limits, auth_sync
from sqlalchemy import create_engine
from sqlalchemy.orm import Session
from fastapi.responses import StreamingResponse


class VoiceProviderTests(unittest.IsolatedAsyncioTestCase):
    async def test_transcription_uses_owned_vault_and_preserves_language(self):
        user = SimpleNamespace(id="owner-a")
        response = httpx.Response(200, json={"text": "CRM kaise use karun?", "segments": [{"no_speech_prob": .01}]}, request=httpx.Request("POST", "https://provider.test"))
        client = AsyncMock()
        client.__aenter__.return_value = client
        client.post.return_value = response
        with patch.object(speech, "get_provider_secret", return_value="test-secret") as vault, patch.object(speech.httpx, "AsyncClient", return_value=client), patch.object(speech,"prepare_transcription_wav",return_value=b"audio"):
            data = await speech.transcribe_audio(UploadFile(io.BytesIO(b"audio"), filename="voice.webm"), "hi-IN", "groq", user, "owned-db")
            vault.assert_called_once_with("groq", user, "owned-db")
            self.assertEqual(data["text"], "CRM kaise use karun?")
            self.assertEqual(client.post.call_args.kwargs["data"]["language"], "hi")
            self.assertEqual(client.post.call_args.kwargs["data"]["model"], "whisper-large-v3")
            response._content = b'{"text":"Thanks for watching","segments":[{"no_speech_prob":0.99}]}'
            silent = await speech.transcribe_audio(UploadFile(io.BytesIO(b"audio")), "", "groq", user, "owned-db")
            self.assertEqual(silent["text"], "")
            self.assertEqual(silent["reason"], "no_speech")
            for segment in ({"avg_logprob": -1.8}, {"compression_ratio": 3.1},
                            {"no_speech_prob": .7, "avg_logprob": -1.1}):
                response._content = json.dumps({"text": "I am going to " * 5, "segments": [segment]}).encode()
                rejected = await speech.transcribe_audio(UploadFile(io.BytesIO(b"audio")), "", "groq", user, "owned-db")
                self.assertEqual(rejected["text"], "")
                self.assertEqual(rejected["reason"], "unclear_audio")
            # A genuinely spoken phrase is allowed; no keyword blacklist.
            response._content = b'{"text":"I am going to Delhi","segments":[{"avg_logprob":-0.1,"no_speech_prob":0.01,"compression_ratio":1.2}]}'
            accepted = await speech.transcribe_audio(UploadFile(io.BytesIO(b"audio")), "", "groq", user, "owned-db")
            self.assertEqual(accepted["text"], "I am going to Delhi")
            client.post.return_value = httpx.Response(429, request=httpx.Request("POST", "https://provider.test"))
            with self.assertRaises(HTTPException) as error:
                await speech.transcribe_audio(UploadFile(io.BytesIO(b"audio")), "", "groq", user, "owned-db")
            self.assertEqual(error.exception.status_code, 429)

    async def test_silence_is_rejected_before_provider_request(self):
        from services.speech.audio import pcm16_to_wav, float_audio_to_pcm16
        import numpy as np
        audio=pcm16_to_wav(b'\0'*(16000*2*2),16000)
        noise=pcm16_to_wav(float_audio_to_pcm16(np.random.default_rng(0).normal(0,.04,16000)),16000)
        with patch.object(speech,"get_provider_secret",return_value="test-secret"), patch.object(speech.httpx,"AsyncClient") as client:
            for clip in (audio,noise):
                result=await speech.transcribe_audio(UploadFile(io.BytesIO(clip),filename="silent.wav"),"","groq",SimpleNamespace(id="a"),None)
                self.assertEqual(result["reason"],"no_speech")
                self.assertEqual(result["text"],"")
            client.assert_not_called()

    async def test_pcm_never_silently_becomes_gemini_wav(self):
        with patch.object(tts, "get_provider_secret", return_value="test-secret"), patch.object(tts, "synthesize_cartesia", side_effect=RuntimeError("provider down")), patch.object(tts, "synthesize_gemini_wav", new_callable=AsyncMock) as gemini:
            with self.assertRaises(HTTPException) as error:
                await tts.synthesize(tts.TTSRequest(text="Hello", engine="cartesia", fmt="pcm"), "db", SimpleNamespace(id="owner-a"))
            self.assertEqual(error.exception.status_code, 503)
            gemini.assert_not_called()
        with patch.object(tts, "get_provider_secret", return_value="test-secret"), patch.object(tts, "synthesize_cartesia", new_callable=AsyncMock, return_value=b"\x00\x01"):
            audio = await tts.synthesize(tts.TTSRequest(text="Hello", engine="cartesia", fmt="pcm"), "db", SimpleNamespace(id="owner-a"))
            self.assertEqual(audio.media_type, "audio/pcm")
            self.assertEqual(audio.headers["x-tts-engine"], "cartesia")

    async def test_failed_chat_does_not_spend_daily_allowance(self):
        daily=ai_chat.upstream_error("groq",429,'requests per day (RPD)')
        minute=ai_chat.upstream_error("groq",429,'tokens per minute (TPM)')
        self.assertEqual(daily.detail['code'],'AI_PROVIDER_DAILY_LIMIT')
        self.assertIn('per-minute',minute.detail['message'])
        engine = create_engine("sqlite:///:memory:")
        auth_sync.Base.metadata.create_all(engine)
        user = auth_sync.UserAccount(id="voice-test", email="voice@example.test", name="Test")
        request = ai_chat.ChatRequest(model="groq/test", messages=[{"role":"user", "content":"Hello"}])
        with Session(engine) as db:
            db.add(user); db.commit()
            with patch.object(ai_chat, "build_candidates", return_value=[]):
                with self.assertRaises(HTTPException): await ai_chat.chat(request, db, user)
            self.assertEqual(limits.snapshot(db,user)["meters"]["ai"]["used"], 0)
            with patch.object(ai_chat, "build_candidates", return_value=[("groq","test","owned-secret")]), \
                 patch.object(ai_chat, "run_provider", side_effect=ai_chat._TryNext(ai_chat.upstream_error("groq",429))):
                with self.assertRaises(HTTPException): await ai_chat.chat(request, db, user)
            self.assertEqual(limits.snapshot(db,user)["meters"]["ai"]["used"], 0)
            async def empty(): yield 'data: [DONE]\n\n'
            async def blank(): yield 'data: {"text":"   "}\n\n'
            async def answer(): yield 'data: {"text":"Hello"}\n\n'
            for events, expected in ((empty,0),(blank,0),(answer,1)):
                with patch.object(ai_chat, "build_candidates", return_value=[("groq","test","owned-secret")]), \
                     patch.object(ai_chat, "run_provider", return_value=StreamingResponse(events())), \
                     patch.object(ai_chat, "SessionLocal", side_effect=lambda: Session(engine)):
                    reply = await ai_chat.chat(request, db, user)
                    async for _ in reply.body_iterator: pass
                db.expire_all()
                self.assertEqual(limits.snapshot(db,user)["meters"]["ai"]["used"],expected)
            day=limits.today_key()
            row=db.get(limits.TenantLimits,user.id); row.day="2000-01-01"; row.ai_used=4; db.commit()
            limits.refund(db,user,"ai",day)
            self.assertEqual(db.get(limits.TenantLimits,user.id).ai_used,4,"old-day refunds cannot subtract new-day usage")


if __name__ == "__main__":
    unittest.main()
