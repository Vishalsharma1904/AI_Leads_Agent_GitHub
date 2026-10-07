"""Run: python -m unittest tests.test_login_security. No live provider calls."""
import asyncio
import os
import time
import unittest
from unittest.mock import AsyncMock, patch

import httpx
import jwt
from fastapi import FastAPI, HTTPException, WebSocket
from fastapi.security import HTTPAuthorizationCredentials
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import Session

from api import auth_sync, credentials, ai_chat


class LoginSecurityCheck(unittest.TestCase):
    def test_jwt_and_subject_boundary(self):
        engine = create_engine("sqlite:///:memory:")
        auth_sync.Base.metadata.create_all(engine)
        now = int(time.time())
        claims = {"sub": "account-a", "email": "a@example.com", "role": "authenticated",
                  "aud": "authenticated", "iss": "https://auth.example/auth/v1", "iat": now, "exp": now + 600}
        signing_key = "unit-test-signing-key-with-at-least-32-bytes"
        with patch.object(auth_sync, "SUPABASE_URL", "https://auth.example"), \
                patch.object(auth_sync, "SUPABASE_ISSUER", claims["iss"]), \
                patch.object(auth_sync, "SUPABASE_JWT_SECRET", signing_key), Session(engine) as db:
            for invalid in [{**claims, "exp": now - 1}, {**claims, "aud": "anon"},
                            {**claims, "iss": "https://evil.example"}, {**claims, "role": "service_role"}]:
                with self.assertRaises(HTTPException):
                    auth_sync._verify_supabase_token(jwt.encode(invalid, signing_key, algorithm="HS256"))
            with self.assertRaises(HTTPException):
                auth_sync._verify_supabase_token(jwt.encode(claims, "attacker-signing-key-at-least-32-bytes", algorithm="HS256"))
            user = auth_sync.get_current_user(HTTPAuthorizationCredentials(scheme="Bearer", credentials=jwt.encode(claims, signing_key, algorithm="HS256")), db)
            self.assertEqual(user.id, "account-a")
            changed = {**claims, "sub": "account-b"}
            with self.assertRaises(HTTPException) as denied:
                auth_sync.get_current_user(HTTPAuthorizationCredentials(scheme="Bearer", credentials=jwt.encode(changed, signing_key, algorithm="HS256")), db)
            self.assertEqual(denied.exception.status_code, 409)
            self.assertEqual(db.query(auth_sync.UserAccount).one().id, "account-a")

    def test_encrypted_credentials_and_tenant_isolation(self):
        engine = create_engine("sqlite:///:memory:")
        auth_sync.Base.metadata.create_all(engine)
        a = auth_sync.UserAccount(id="a", email="a@example.com", name="A")
        b = auth_sync.UserAccount(id="b", email="b@example.com", name="B")
        key = "gsk_test_only_not_a_real_provider_key"
        with Session(engine) as db, patch.dict(os.environ, {"CREDENTIAL_MASTER_KEY": "test-master-key-32-bytes-long-not-real"}), \
                patch.object(credentials, "probe_key", return_value=("ok", "")):
            credentials.upsert_credential(credentials.CredentialRequest(provider="groq", secret=key), db, a)
            record = db.query(credentials.ProviderCredential).one()
            self.assertNotIn(key, record.ciphertext)
            self.assertEqual(credentials.decrypt_secret(record), key)
            with patch.dict(os.environ, {meta["env"]: "" for meta in credentials.AI_PROVIDER_CONFIG.values()}):
                self.assertIsNone(credentials.get_provider_secret("groq", b, db))
                status = credentials.list_credentials(db, a)
                self.assertNotIn(key, str(status))
                credentials.delete_credential("groq", db, b)
                self.assertEqual(db.query(credentials.ProviderCredential).count(), 1)
            with patch.object(credentials, "probe_key", return_value=("rejected", "Invalid")):
                with self.assertRaises(HTTPException):
                    credentials.upsert_credential(credentials.CredentialRequest(provider="groq", secret="bad-replacement"), db, a)
            self.assertEqual(credentials.decrypt_secret(record), key)

    def test_ephemeral_live_token_has_one_use_and_no_permanent_key(self):
        a = auth_sync.UserAccount(id="a", email="a@example.com", name="A")
        calls = []
        async def issue(_client, url, **kwargs):
            calls.append((url, kwargs))
            return httpx.Response(200, json={"name": "auth_tokens/test-ephemeral"}, request=httpx.Request("POST", url))
        with patch.object(credentials, "get_provider_secret", return_value="private-provider-key"), \
                patch("api.limits.consume"), patch.object(httpx.AsyncClient, "post", issue):
            result = asyncio.run(credentials.gemini_live_token(credentials.LiveTokenRequest(model="gemini-3.8-live"), None, a))
            self.assertNotIn("private-provider-key", str(result))
            payload = calls[0][1]["json"]
            self.assertEqual(payload["uses"], 1)
            self.assertEqual(payload["fieldMask"], "model")
            self.assertEqual(payload["bidiGenerateContentSetup"]["model"], "models/gemini-3.8-live")
            self.assertTrue(payload["expireTime"].endswith("Z"))
            self.assertNotIn("+00:00Z", payload["expireTime"])
            self.assertTrue(payload["newSessionExpireTime"].endswith("Z"))
            self.assertNotIn("private-provider-key", calls[0][0])
            with self.assertRaises(HTTPException):
                asyncio.run(credentials.gemini_live_token(credentials.LiveTokenRequest(model="unbounded-model"), None, a))
            self.assertEqual(len(calls), 1)

    def test_websocket_requires_auth_frame_and_allowed_origin(self):
        app = FastAPI()
        @app.websocket("/voice")
        async def voice(ws: WebSocket):
            if await auth_sync.authenticate_websocket(ws, {"http://localhost:3000"}):
                await ws.close()
        client = TestClient(app)
        from starlette.websockets import WebSocketDisconnect
        with self.assertRaises(WebSocketDisconnect):
            with client.websocket_connect("/voice", headers={"origin": "https://evil.example"}):
                pass
        for frame in [{"type": "start"}, {"type": "auth", "token": "forged"}]:
            with client.websocket_connect("/voice", headers={"origin": "http://localhost:3000"}) as ws:
                ws.send_json(frame)
                with self.assertRaises(WebSocketDisconnect):
                    ws.receive_json()
        with patch.object(auth_sync, "_verify_supabase_token", return_value={"sub": "a", "exp": time.time() + 60}):
            with client.websocket_connect("/voice", headers={"origin": "http://localhost:3000"}) as ws:
                ws.send_json({"type": "auth", "token": "test"})
                self.assertEqual(ws.receive_json()["type"], "authenticated")

    def test_gemini_secret_not_in_request_url(self):
        req = ai_chat.ChatRequest(model="gemini/gemini-3.8-flash", messages=[{"role": "user", "content": "hello"}])
        url, params, headers, _ = ai_chat.build_upstream("gemini", "gemini-3.8-flash", "private-key", req)
        self.assertNotIn("private-key", str((url, params)))
        self.assertEqual(headers["x-goog-api-key"], "private-key")


if __name__ == "__main__":
    unittest.main()
