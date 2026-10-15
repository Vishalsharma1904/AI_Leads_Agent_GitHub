"""Offline checks for the in-app Rudra voice agent sync (no network)."""
import asyncio
import unittest
from unittest.mock import patch

from sqlalchemy import create_engine
from sqlalchemy.orm import Session
from sqlalchemy.pool import StaticPool

from api.auth_sync import UserAccount
from api import elevenlabs as el


class RudraVoiceAssistantChecks(unittest.TestCase):
    def setUp(self):
        self.engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
        el.Base.metadata.create_all(self.engine)
        self.db = Session(self.engine)
        self.user = UserAccount(id="tenant-a", email="a@example.com", name="A")
        self.db.add(self.user); self.db.commit()
        self.calls = []
        self.secret = "protected-groq-a"

    def tearDown(self):
        self.db.close(); self.engine.dispose()

    async def xi(self, client, key, method, path, payload=None):
        self.calls.append((method, path))
        if path == "/convai/tools":
            return {"id": "tool-" + payload["tool_config"]["name"]}
        if path == "/convai/agents/create":
            self.payload = payload
            return {"agent_id": "agent-rudra"}
        return {}

    async def provider(self, *args, **kwargs):
        return {"user_id": "workspace-a"}

    def request(self, persona="You are Rudra. " * 5):
        return el.AssistantRequest(persona=persona, tools=[
            el.AssistantTool(name="find_leads", description="Start leads", parameters={"type": "object", "properties": {"request": {"type": "string"}}, "required": ["request"]}),
            el.AssistantTool(name="close_display", description="Close the display")])

    async def groq_secret(self, user, db):
        return self.secret

    def sync(self, req):
        with patch.object(el, "_xi", self.xi), patch.object(el, "_provider", self.provider), \
             patch.object(el, "_groq_secret", self.groq_secret), \
             patch.object(el, "get_provider_secret", return_value="xi-key"), \
             patch("services.developer_control.reserve_provider", return_value=None):
            return asyncio.run(el._sync_assistant(req, self.user, self.db))

    def test_creates_once_then_reuses_and_patches_only_on_change(self):
        self.assertEqual(self.sync(self.request()), "agent-rudra")
        prompt = self.payload["conversation_config"]["agent"]["prompt"]
        self.assertEqual(prompt["llm"], "custom-llm")                # brain = his Groq key
        self.assertEqual(prompt["custom_llm"]["url"], "https://api.groq.com/openai/v1/chat/completions")
        self.assertEqual(prompt["custom_llm"]["model_id"], "openai/gpt-oss-120b")
        self.assertEqual(prompt["custom_llm"]["api_key"], {"secret_id": "protected-groq-a"})
        self.assertEqual(prompt["backup_llm_config"], {"preference": "disabled"})   # never a silent Gemini fallback
        self.assertTrue(self.payload["platform_settings"]["overrides"]["custom_llm_extra_body"])
        self.assertEqual(prompt["tool_ids"], ["tool-find_leads", "tool-close_display"])
        self.assertEqual(self.payload["conversation_config"]["tts"]["agent_output_audio_format"], "pcm_24000")
        self.assertEqual(self.payload["conversation_config"]["turn"]["turn_model"], "turn_v3")
        self.assertTrue(self.payload["conversation_config"]["conversation"]["file_input"]["enabled"])
        self.calls.clear()
        self.sync(self.request())                                       # unchanged -> zero provider writes
        self.assertEqual(self.calls, [])
        self.sync(self.request(persona="You are Rudra, updated. " * 5))  # persona change -> agent PATCH only
        self.assertEqual(self.calls, [("PATCH", "/convai/agents/agent-rudra")])
        self.calls.clear(); self.secret = "protected-groq-b"            # new Groq key -> agent updated
        self.sync(self.request(persona="You are Rudra, updated. " * 5))
        self.assertEqual(self.calls, [("PATCH", "/convai/agents/agent-rudra")])
        from fastapi import HTTPException
        with self.assertRaises(HTTPException):                          # only Groq models are a brain
            self.sync(el.AssistantRequest(persona="You are Rudra. " * 5, groq_model="gemini-2.5-flash"))

    def test_screen_image_upload_checks_jpeg_and_returns_file_id(self):
        import base64
        from fastapi import HTTPException
        sent = {}

        class FakeResponse:
            status_code = 200
            content = b'{"file_id": "file_1"}'
            def json(self): return {"file_id": "file_1"}

        class FakeClient:
            def __init__(self, **kw): pass
            async def __aenter__(self): return self
            async def __aexit__(self, *a): return False
            async def post(self, url, headers=None, files=None):
                sent.update(url=url, files=files); return FakeResponse()

        el._bind(self.db, self.user, "assistant", "agent-rudra", "Rudra voice assistant", {})
        jpeg = base64.b64encode(b"\xff\xd8" + b"x" * 200).decode()
        with patch.object(el.httpx, "AsyncClient", FakeClient), patch.object(el, "_provider", self.provider), \
             patch.object(el, "get_provider_secret", return_value="xi-key"):
            out = asyncio.run(el.assistant_image("conv_1", el.AssistantImage(image_b64=jpeg), self.db, self.user))
            self.assertEqual(out, {"file_id": "file_1"})
            self.assertTrue(sent["url"].endswith("/convai/conversations/conv_1/files"))
            png = base64.b64encode(b"\x89PNG" + b"x" * 200).decode()
            with self.assertRaises(HTTPException):
                asyncio.run(el.assistant_image("conv_1", el.AssistantImage(image_b64=png), self.db, self.user))

    def test_params_get_descriptions_and_empty_schema_is_dropped(self):
        params = el._assistant_params({"type": "object", "properties": {"cities": {"type": "array"}, "n": {"type": "weird"}}, "required": ["n", "x"]})
        self.assertEqual(params["properties"]["cities"]["items"]["type"], "string")
        self.assertEqual(params["properties"]["n"], {"type": "string", "description": "n"})
        self.assertEqual(params["required"], ["n"])
        self.assertIsNone(el._assistant_params({"type": "object", "properties": {}}))

    def test_agent_setup_network_failure_returns_recoverable_gateway_error(self):
        import httpx
        from fastapi import HTTPException
        class Unreachable:
            async def request(self, *args, **kwargs):
                raise httpx.ReadTimeout('private-key-must-not-leak')
        with self.assertRaises(HTTPException) as failure:
            asyncio.run(el._xi(Unreachable(), 'private-key', 'POST', '/convai/tools', {}))
        self.assertEqual(failure.exception.status_code, 502)
        self.assertNotIn('private-key', str(failure.exception.detail))
        self.assertIn('retry', str(failure.exception.detail).lower())


if __name__ == "__main__":
    unittest.main()
