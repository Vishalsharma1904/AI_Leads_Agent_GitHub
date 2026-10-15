"""Offline checks for ElevenLabs payloads, tenant isolation and call boundaries."""
import asyncio
import json
import time
import unittest
from unittest.mock import patch

import httpx
from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient
from pydantic import ValidationError
from sqlalchemy import create_engine
from sqlalchemy.pool import StaticPool
from sqlalchemy.orm import Session

from api.auth_sync import UserAccount
from api import elevenlabs as el


class ElevenLabsCallingChecks(unittest.TestCase):
    def test_family_credits_do_not_share_agent_resources(self):
        UserAccount.__table__.create(self.engine,checkfirst=True)
        self.owner.email='dad-a@example.test'; self.db.add(self.owner)
        other=UserAccount(id='family-b',email='dad-b@example.test',name='Dad');self.db.add(other);self.db.commit()
        with patch('services.family_provider_access.get_family_secret',side_effect=lambda p,email:'family-fixture' if email in {'dad-a@example.test','dad-b@example.test'} else None),patch.object(el,'get_provider_secret',return_value='family-fixture'):
            el._claim_account(self.db,self.owner,{'user_id':'family-account'})
            el._claim_account(self.db,other,{'user_id':'family-account'})
            self.assertIsNone(el._bind_listed(self.db,other,'agent','old-unknown-agent'))
            el._bind(self.db,self.owner,'agent','owner-agent')
            self.assertIsNone(el._bind_listed(self.db,other,'agent','owner-agent'))
            el._bind(self.db,other,'agent','new-dad-agent')
            self.assertEqual(el._bind_listed(self.db,other,'agent','new-dad-agent').owner_user_id,other.id)

    def setUp(self):
        self.engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
        from api.limits import TenantLimits
        from api.billing import Subscription
        from services.developer_control import AccountControl
        el.Base.metadata.create_all(self.engine)
        self.db = Session(self.engine)
        self.owner = UserAccount(id="tenant-a", email="a@example.com", name="A")
        self.other = UserAccount(id="tenant-b", email="b@example.com", name="B")
        from services.developer_control import AccountControl
        self.db.add_all([self.owner,self.other,AccountControl(user_id=self.owner.id,status='trial',monthly_limits='{"calls": 500}'),AccountControl(user_id=self.other.id,status='trial',monthly_limits='{"calls": 500}')])
        self.db.commit()
        self.seen = []

    def tearDown(self):
        self.db.close()
        self.engine.dispose()

    def run_async(self, value):
        return asyncio.run(value)

    def agent_request(self, **fields):
        return el.AgentRequest(name="Rudra", instructions="Qualify the caller and answer briefly.", voice_id="voice-a", **fields)

    def batch_request(self, **fields):
        values = {"request_id": "request-1234567890", "agent_id": "agent-a", "phone_number_id": "phone-a",
            "call_name": "Rudra batch", "recipients": [el.BatchRecipient(phone_number="+919876543210", dynamic_variables={"company": "Hotel A"}),
            el.BatchRecipient(phone_number="+919876543211")], "confirmed": True}
        values.update(fields)
        return el.BatchCallRequest(**values)

    async def provider(self, method, path, user, db, payload=None, binary=False):
        self.seen.append((method, path, payload))
        if path == "/user":
            return {"user_id": "workspace-a", "subscription": {"tier": "free", "character_limit": 10000, "character_count": 25}}
        if path == "/convai/secrets":
            return {"secret_id": "protected-groq-a"}
        if path == "/convai/agents/create":
            return {"agent_id": "agent-a"}
        if path == "/convai/phone-numbers/phone-a":
            return {"provider": "exotel", "supports_outbound": True}
        if path == "/convai/exotel/outbound-call":
            return {"success": True, "conversation_id": "conv-a", "call_id": "call-a"}
        return {}

    def test_groq_custom_llm_and_secure_configuration(self):
        with patch.object(el, "_provider", self.provider), patch.object(el, "get_provider_secret", return_value="groq-test-key"):
            result = self.run_async(el.create_agent(self.agent_request(), self.db, self.owner))
        self.assertEqual(result["agent_id"], "agent-a")
        body = next(item[2] for item in self.seen if item[1] == "/convai/agents/create")
        prompt = body["conversation_config"]["agent"]["prompt"]
        self.assertEqual(prompt["llm"], "custom-llm")
        self.assertEqual(prompt["custom_llm"]["api_key"], {"secret_id": "protected-groq-a"})
        self.assertEqual(prompt["custom_llm"]["url"], "https://api.groq.com/openai/v1/chat/completions")
        self.assertEqual(body["conversation_config"]["asr"]["provider"], "scribe_realtime")
        self.assertTrue(body["platform_settings"]["auth"]["enable_auth"])
        self.assertTrue(body["platform_settings"]["overrides"]["custom_llm_extra_body"])
        self.assertNotIn("groq-test-key", json.dumps(body))
        self.assertNotIn("secret_id", json.dumps(el._agent_form(body)))

    def test_browser_tools_are_not_attached_to_phone_agent(self):
        el._bind(self.db, self.owner, "tool", "browser-a", "open_page", {"type": "open_page"})
        el._bind(self.db, self.owner, "tool", "webhook-a", "availability", {"type": "webhook"})
        with patch.object(el, "_provider", self.provider), patch.object(el, "get_provider_secret", return_value="groq-test-key"):
            self.run_async(el.create_agent(self.agent_request(tool_ids=["browser-a", "webhook-a"]), self.db, self.owner))
        body = next(item[2] for item in self.seen if item[1] == "/convai/agents/create")
        self.assertEqual(body["conversation_config"]["agent"]["prompt"]["tool_ids"], ["webhook-a"])
        row = el._owned(self.db, self.owner, "agent", "agent-a")
        self.assertEqual(json.loads(row.details)["tool_ids"], ["browser-a", "webhook-a"])
        self.assertFalse(el._llm_body(row)["include_reasoning"])

    def test_tenant_ids_are_blocked_before_provider(self):
        el._bind(self.db, self.owner, "agent", "agent-a", "Rudra")
        el._bind(self.db, self.owner, "phone", "phone-a", "Phone")
        el._bind(self.db, self.owner, "conversation", "conv-a", "Call")
        with patch.object(el, "_provider", self.provider):
            for request in [el.get_agent("agent-a", self.db, self.other), el.preview("agent-a", self.db, self.other),
                            el.update_agent("agent-a", self.agent_request(), self.db, self.other),
                            el.call(el.CallRequest(agent_id="agent-a", phone_number_id="phone-a", to_number="+919876543210", confirmed=True), self.db, self.other),
                            el.conversation("conv-a", self.db, self.other)]:
                with self.assertRaises(HTTPException) as error:
                    self.run_async(request)
                self.assertEqual(error.exception.status_code, 404)
        self.assertFalse(self.seen)

    def test_provider_account_cannot_be_shared_between_tenants(self):
        el._claim_account(self.db, self.owner, {"user_id": "workspace-a"})
        with self.assertRaises(HTTPException) as error:
            el._claim_account(self.db, self.other, {"user_id": "workspace-a"})
        self.assertEqual(error.exception.status_code, 409)
        self.assertEqual(error.exception.detail["code"], "ELEVENLABS_ACCOUNT_OWNERSHIP")
        self.assertNotIn("tenant-a", json.dumps(error.exception.detail))

    def test_foreign_resources_do_not_break_owned_listing_or_leak(self):
        el._bind(self.db, self.owner, "agent", "agent-a", "Rudra")
        el._bind(self.db, self.other, "phone", "phone-b", "Private number")
        el._bind(self.db, self.other, "conversation", "conv-b", "Private call")
        async def provider(method, path, user, db, payload=None):
            if path == "/convai/phone-numbers":
                return [{"phone_number_id": "phone-b", "phone_number": "+919999999999", "label": "Private number"},
                        {"phone_number_id": "phone-a", "phone_number": "+918888888888", "label": "Business"}]
            return {"conversations": [{"conversation_id": "conv-b", "agent_id": "agent-a", "transcript_summary": "Private transcript"},
                                      {"conversation_id": "conv-a", "agent_id": "agent-a", "status": "done"}]}
        with patch.object(el, "_provider", provider), patch.object(el, "get_provider_secret", return_value="groq-test-key"):
            numbers = self.run_async(el.phones(self.db, self.owner))
            calls = self.run_async(el.conversations("agent-a", "", self.db, self.owner))
        self.assertEqual(numbers["unavailable_count"], 1)
        self.assertEqual(calls["unavailable_count"], 1)
        self.assertEqual([row["phone_number_id"] for row in numbers["phone_numbers"]], ["phone-a"])
        self.assertEqual([row["conversation_id"] for row in calls["conversations"]], ["conv-a"])
        self.assertNotIn("Private", json.dumps([numbers, calls]))
        self.assertNotIn("+919999999999", json.dumps(numbers))
        self.assertEqual(el._owned(self.db, self.other, "phone", "phone-b").name, "Private number")

    def test_readiness_checks_owned_provider_resources_without_dialing(self):
        el._bind(self.db, self.owner, "agent", "agent-a", "Rudra")
        el._bind(self.db, self.owner, "phone", "phone-a", "Phone")
        async def provider(method, path, user, db, payload=None):
            self.seen.append((method, path, payload))
            if path.endswith("/agents/agent-a"):
                return {"agent_id": "agent-a", "conversation_config": {"conversation": {"max_duration_seconds": 180}}}
            return {"phone_number_id": "phone-a", "provider": "exotel", "supports_outbound": True}
        with patch.object(el, "_provider", provider), patch.object(el, "get_provider_secret", return_value="private-key"):
            result = self.run_async(el.calling_readiness("agent-a", "phone-a", self.db, self.owner))
            self.assertTrue(result["ready"])
            self.assertEqual(result["max_duration_seconds"], 180)
            with self.assertRaises(HTTPException):
                self.run_async(el.calling_readiness("agent-a", "phone-a", self.db, self.other))
        self.assertEqual(len(self.seen), 2)
        self.assertTrue(all(method == "GET" for method, _, _ in self.seen))
        self.assertNotIn("private-key", json.dumps(result))

    def test_readiness_does_not_claim_unprovisioned_number_ready(self):
        el._bind(self.db, self.owner, "agent", "agent-a", "Rudra")
        el._bind(self.db, self.owner, "phone", "phone-a", "Phone")
        async def provider(method, path, user, db, payload=None):
            if "/agents/" in path:
                return {"agent_id": "agent-a"}
            return {"phone_number_id": "phone-a", "provider": "exotel", "supports_outbound": False}
        with patch.object(el, "_provider", provider), patch.object(el, "get_provider_secret", return_value="private-key"):
            result = self.run_async(el.calling_readiness("agent-a", "phone-a", self.db, self.owner))
        self.assertFalse(result["ready"])
        self.assertIn("outbound_number", result["missing"])

    def test_call_requires_explicit_confirmation_and_real_provisioned_number(self):
        el._bind(self.db, self.owner, "agent", "agent-a", "Rudra")
        el._bind(self.db, self.owner, "phone", "phone-a", "Phone")
        with patch.object(el, "_provider", self.provider):
            with self.assertRaises(HTTPException):
                self.run_async(el.call(el.CallRequest(agent_id="agent-a", phone_number_id="phone-a", to_number="+919876543210"), self.db, self.owner))
            self.assertFalse(self.seen)
            result = self.run_async(el.call(el.CallRequest(agent_id="agent-a", phone_number_id="phone-a", to_number="+919876543210", confirmed=True, dynamic_variables={"company": "Hotel A"}), self.db, self.owner))
        self.assertTrue(result["success"])
        body = self.seen[-1][2]
        self.assertEqual(body["agent_phone_number_id"], "phone-a")
        self.assertEqual(body["conversation_initiation_client_data"]["dynamic_variables"]["company"], "Hotel A")
        self.assertEqual(el._owned(self.db, self.owner, "conversation", "conv-a").owner_user_id, self.owner.id)

    def test_batch_requires_confirmation_and_unique_e164_destinations(self):
        el._bind(self.db, self.owner, "agent", "agent-a", "Rudra")
        el._bind(self.db, self.owner, "phone", "phone-a", "Phone")
        with patch.object(el, "_provider", self.provider):
            with self.assertRaises(HTTPException):
                self.run_async(el.submit_batch(self.batch_request(confirmed=False), self.db, self.owner))
            duplicate = self.batch_request(recipients=[el.BatchRecipient(phone_number="+919876543210"), el.BatchRecipient(phone_number="+919876543210")])
            with self.assertRaises(HTTPException):
                self.run_async(el.submit_batch(duplicate, self.db, self.owner))
        self.assertFalse(self.seen)

    def test_native_batch_payload_idempotency_status_cancel_and_tenant_boundary(self):
        el._bind(self.db, self.owner, "agent", "agent-a", "Rudra")
        el._bind(self.db, self.owner, "phone", "phone-a", "Phone")
        provider_jobs = {"batch-a": {"id": "batch-a", "name": "Rudra batch [ref:request-1234567890]", "agent_id": "agent-a",
            "phone_number_id": "phone-a", "phone_provider": "exotel", "status": "pending", "target_concurrency_limit": 1,
            "total_calls_scheduled": 2, "total_calls_finished": 0,
            "recipients": [{"phone_number": "+919876543210", "status": "pending"}, {"phone_number": "+919876543211", "status": "pending"}]}}
        async def provider(method, path, user, db, payload=None):
            self.seen.append((method, path, payload))
            if path == "/convai/agents/agent-a": return {"agent_id": "agent-a"}
            if path == "/convai/phone-numbers/phone-a": return {"phone_number_id": "phone-a", "provider": "exotel", "supports_outbound": True}
            if path == "/convai/batch-calling/submit": return provider_jobs["batch-a"]
            if path == "/convai/batch-calling/batch-a" and method == "GET": return provider_jobs["batch-a"]
            if path == "/convai/batch-calling/batch-a/cancel":
                provider_jobs["batch-a"]["status"] = "cancelled"
                provider_jobs["batch-a"]["recipients"][1]["status"] = "cancelled"
                return {"id": "batch-a", "status": "cancelled"}
            return {}
        with patch.object(el, "_provider", provider), patch.object(el, "get_provider_secret", return_value="groq-test-key"):
            result = self.run_async(el.submit_batch(self.batch_request(), self.db, self.owner))
            self.assertEqual(result["batch_id"], "batch-a")
            payload = next(item[2] for item in self.seen if item[1] == "/convai/batch-calling/submit")
            self.assertEqual(payload["target_concurrency_limit"], 1)
            self.assertEqual([item["phone_number"] for item in payload["recipients"]], ["+919876543210", "+919876543211"])
            self.assertEqual(payload["recipients"][0]["conversation_initiation_client_data"]["dynamic_variables"], {"company": "Hotel A"})
            replay = self.run_async(el.submit_batch(self.batch_request(), self.db, self.owner))
            self.assertEqual(replay["batch_id"], "batch-a")
            duplicate_values = self.batch_request().model_dump()
            duplicate_values["request_id"] = "request-0987654321"
            duplicate = self.run_async(el.submit_batch(el.BatchCallRequest(**duplicate_values), self.db, self.owner))
            self.assertEqual(duplicate["batch_id"], "batch-a")
            self.assertEqual(sum(path == "/convai/batch-calling/submit" for _, path, _ in self.seen), 1)
            listing = self.run_async(el.batch_calls(self.db, self.owner))
            self.assertEqual(listing["batch_calls"][0]["batch_id"], "batch-a")
            detail = self.run_async(el.batch_call("batch-a", self.db, self.owner))
            self.assertEqual(detail["status"], "pending")
            self.assertIsNone(detail["request_id"])
            cancelled = self.run_async(el.cancel_batch("batch-a", self.db, self.owner))
            self.assertEqual(cancelled["status"], "cancelled")
            self.assertEqual(cancelled["recipients"][1]["status"], "cancelled")
            self.assertEqual(self.run_async(el.batch_calls(self.db, self.owner))["batch_calls"][0]["status"], "cancelled")
            with self.assertRaises(HTTPException) as error:
                self.run_async(el.batch_call("batch-a", self.db, self.other))
            self.assertEqual(error.exception.status_code, 404)
        self.assertNotIn("secret", json.dumps(result))

    def test_uncertain_batch_is_reconciled_without_second_submit(self):
        el._bind(self.db, self.owner, "agent", "agent-a", "Rudra")
        el._bind(self.db, self.owner, "phone", "phone-a", "Phone")
        name = "Rudra batch [ref:request-1234567890]"
        async def provider(method, path, user, db, payload=None):
            self.seen.append((method, path, payload))
            if path == "/convai/agents/agent-a": return {"agent_id": "agent-a"}
            if path == "/convai/phone-numbers/phone-a": return {"phone_number_id": "phone-a", "provider": "exotel", "supports_outbound": True}
            if path == "/convai/batch-calling/submit": raise HTTPException(502, "Timed out after submit")
            if path.startswith("/convai/batch-calling/workspace?"):
                return {"batch_calls": [{"id": "batch-a", "name": name, "status": "pending"}]}
            if path == "/convai/batch-calling/batch-a": return {"id": "batch-a", "name": name, "status": "pending", "recipients": []}
            return {}
        with patch.object(el, "_provider", provider), patch.object(el, "get_provider_secret", return_value="groq-test-key"):
            with self.assertRaises(HTTPException):
                self.run_async(el.submit_batch(self.batch_request(), self.db, self.owner))
            replay = self.run_async(el.submit_batch(self.batch_request(), self.db, self.owner))
            self.assertTrue(replay["uncertain"])
            reconciled = self.run_async(el.batch_call(replay["request_id"], self.db, self.owner))
            self.assertEqual(reconciled["batch_id"], "batch-a")
            self.assertFalse(reconciled["uncertain"])
        self.assertEqual(sum(path == "/convai/batch-calling/submit" for _, path, _ in self.seen), 1)

    def test_uncertain_batch_stays_idempotent_after_date_change_and_history_growth(self):
        el._bind(self.db, self.owner, "agent", "agent-a", "Rudra")
        el._bind(self.db, self.owner, "phone", "phone-a", "Phone")
        attempts = 0
        async def provider(method, path, user, db, payload=None):
            nonlocal attempts
            self.seen.append((method, path, payload))
            if path == "/convai/agents/agent-a": return {"agent_id": "agent-a"}
            if path == "/convai/phone-numbers/phone-a": return {"phone_number_id": "phone-a", "provider": "exotel", "supports_outbound": True}
            if path == "/convai/batch-calling/submit":
                attempts += 1
                raise HTTPException(502, "Timed out after submit")
            return {}
        first = self.batch_request(call_name="Rudra batch 2026-10-12")
        with patch.object(el, "_provider", provider), patch.object(el, "get_provider_secret", return_value="groq-test-key"):
            with self.assertRaises(HTTPException):
                self.run_async(el.submit_batch(first, self.db, self.owner))
            old = self.db.query(el.ElevenLabsResource).filter_by(kind="batch_request", resource_id=first.request_id).one()
            for i in range(105):
                self.db.add(el.ElevenLabsResource(kind="batch_request", resource_id=f"finished-{i:04d}",
                    owner_user_id=self.owner.id, name=f"Finished {i}",
                    details=json.dumps({"signature": f"finished-{i}", "status": "completed"}), updated_at=time.time() + i + 1))
            self.db.commit()
            next_day = self.batch_request(request_id="request-next-day-12345", call_name="Rudra batch 2026-10-13")
            replay = self.run_async(el.submit_batch(next_day, self.db, self.owner))
        self.assertEqual(replay["request_id"], old.resource_id)
        self.assertTrue(replay["uncertain"])
        self.assertEqual(attempts, 1)

    def test_provider_rejection_allows_safe_retry_with_fresh_request_id(self):
        el._bind(self.db, self.owner, "agent", "agent-a", "Rudra")
        el._bind(self.db, self.owner, "phone", "phone-a", "Phone")
        attempts = 0
        async def provider(method, path, user, db, payload=None):
            nonlocal attempts
            if path == "/convai/agents/agent-a": return {"agent_id": "agent-a"}
            if path == "/convai/phone-numbers/phone-a": return {"phone_number_id": "phone-a", "provider": "exotel", "supports_outbound": True}
            if path == "/convai/batch-calling/submit":
                attempts += 1
                if attempts == 1: raise HTTPException(429, "Quota reached")
                return {"id": "batch-retry", "name": "Rudra batch", "status": "pending", "recipients": []}
            return {}
        with patch.object(el, "_provider", provider), patch.object(el, "get_provider_secret", return_value="groq-test-key"):
            with self.assertRaises(HTTPException) as error:
                self.run_async(el.submit_batch(self.batch_request(), self.db, self.owner))
            self.assertEqual(error.exception.status_code, 429)
            failed = self.db.query(el.ElevenLabsResource).filter_by(kind="batch_request", resource_id="request-1234567890").first()
            self.assertEqual(el._batch_details(failed)["status"], "failed")
            retry_values = self.batch_request().model_dump()
            retry_values["request_id"] = "request-retry-12345"
            result = self.run_async(el.submit_batch(el.BatchCallRequest(**retry_values), self.db, self.owner))
        self.assertEqual(result["batch_id"], "batch-retry")
        self.assertEqual(attempts, 2)

    def test_batch_routes_require_auth_and_reject_foreign_resources(self):
        el._bind(self.db, self.owner, "agent", "agent-a", "Rudra")
        el._bind(self.db, self.owner, "phone", "phone-a", "Phone")
        app = FastAPI()
        app.include_router(el.router)
        app.dependency_overrides[el.get_db] = lambda: self.db
        with TestClient(app) as client:
            self.assertEqual(client.get("/api/v1/elevenlabs/batch-calls").status_code, 401)
            app.dependency_overrides[el.get_current_user] = lambda: self.other
            response = client.post("/api/v1/elevenlabs/batch-calls", json=self.batch_request().model_dump(mode="json"))
            self.assertEqual(response.status_code, 404)
        self.assertFalse(self.seen)

    def test_unprovisioned_number_never_places_call(self):
        el._bind(self.db, self.owner, "agent", "agent-a", "Rudra")
        el._bind(self.db, self.owner, "phone", "phone-a", "Phone")
        async def not_ready(*args, **kwargs):
            return {"provider": "exotel", "supports_outbound": False}
        with patch.object(el, "_provider", not_ready), self.assertRaises(HTTPException) as error:
            self.run_async(el.call(el.CallRequest(agent_id="agent-a", phone_number_id="phone-a", to_number="+919876543210", confirmed=True), self.db, self.owner))
        self.assertEqual(error.exception.status_code, 409)

    def test_provider_errors_never_echo_keys(self):
        for status in [400, 401, 403, 429, 422, 500]:
            with self.assertRaises(HTTPException) as error:
                el._check_response(httpx.Response(status, json={"detail": "secret-live-key"}))
            self.assertNotIn("secret-live-key", str(error.exception.detail))
            if status == 400: self.assertEqual(error.exception.status_code, 422)

    def test_request_validation_and_knowledge_ownership(self):
        with self.assertRaises(ValidationError):
            self.agent_request(api_key="do-not-accept")
        el._bind(self.db, self.other, "knowledge", "doc-b", "Other business", {"type": "text"})
        with patch.object(el, "_provider", self.provider), self.assertRaises(HTTPException):
            self.run_async(el._agent_payload(self.agent_request(knowledge_ids=["doc-b"]), self.owner, self.db))
        self.assertFalse(self.seen)
        for url in ["http://public.com/a", "https://localhost/a", "https://127.0.0.1/a", "https://169.254.169.254/a", "https://user:secret@public.com/a"]:
            with self.assertRaises(HTTPException):
                el._public_url(url)

    def test_http_client_auth_account_and_payload(self):
        seen = []
        def handler(request):
            seen.append(request)
            self.assertEqual(request.headers["xi-api-key"], "eleven-test-key")
            return httpx.Response(200, json={"user_id": "workspace-a"} if request.url.path.endswith("/user") else {"id": "doc-a"})
        client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
        with patch.object(el.httpx, "AsyncClient", return_value=client), patch.object(el, "get_provider_secret", return_value="eleven-test-key"):
            result = self.run_async(el._provider("POST", "/convai/knowledge-base/text", self.owner, self.db, {"text": "Business facts"}))
        self.assertEqual(result["id"], "doc-a")
        self.assertEqual([request.url.path for request in seen], ["/v1/user", "/v1/convai/knowledge-base/text"])
        self.assertEqual(json.loads(seen[1].content)["text"], "Business facts")

    def test_listing_never_bypasses_connected_provider_account_owner(self):
        el._claim_account(self.db, self.owner, {"user_id": "workspace-a"})
        seen = []
        def handler(request):
            seen.append(request.url.path)
            return httpx.Response(200, json={"user_id": "workspace-a"})
        client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
        with patch.object(el.httpx, "AsyncClient", return_value=client), patch.object(el, "get_provider_secret", return_value="eleven-test-key"):
            with self.assertRaises(HTTPException) as error:
                self.run_async(el.phones(self.db, self.other))
        self.assertEqual(error.exception.detail["code"], "ELEVENLABS_ACCOUNT_OWNERSHIP")
        self.assertEqual(seen, ["/v1/user"], 'Foreign account must never reach its provider phone list')

    def test_phone_import_payload_and_secret_redaction(self):
        for kind, fields in [("exotel", {"account_sid": "sid-a", "api_key": "private-api-key", "api_token": "private-api-token", "app_id": "app-a"}),
                             ("twilio", {"sid": "sid-a", "token": "private-twilio-token"}),
                             ("sip_trunk", {"address": "sip.example.com:5061", "username": "account-a", "password": "private-sip-password"})]:
            captured = []
            async def provider(method, path, user, db, payload=None):
                captured.append(payload)
                return {"phone_number_id": "phone-" + kind}
            req = el.PhoneRequest(provider=kind, phone_number="+918012345678", label="Business", **fields)
            with patch.object(el, "_provider", provider):
                result = self.run_async(el.import_phone(req, self.db, self.owner))
            self.assertEqual(captured[0]["provider"], kind)
            self.assertFalse(captured[0]["supports_inbound"])
            self.assertNotIn("private-", json.dumps(result))
            if kind == "sip_trunk":
                self.assertEqual(captured[0]["outbound_trunk_config"]["transport"], "tls")
                self.assertEqual(captured[0]["outbound_trunk_config"]["credentials"]["password"], fields["password"])
            else:
                secret_field = "api_token" if kind == "exotel" else "token"
                self.assertEqual(captured[0][secret_field], fields[secret_field])

    def test_inbound_sip_requires_provider_source_allowlist(self):
        with patch.object(el, "_provider", self.provider), self.assertRaises(HTTPException):
            self.run_async(el.import_phone(el.PhoneRequest(provider="sip_trunk", phone_number="+918012345678", label="Business",
                                                          address="sip.example.com", supports_inbound=True), self.db, self.owner))
        self.assertFalse(self.seen)
        with patch.object(el, "_provider", self.provider), self.assertRaises(HTTPException):
            self.run_async(el.import_phone(el.PhoneRequest(provider="sip_trunk", phone_number="+918012345678", label="Business",
                                                          address="sip.example.com", supports_inbound=True, inbound_allowed_addresses=["0.0.0.0/0"]), self.db, self.owner))

    def test_signed_preview_url_validation_and_no_provider_key(self):
        el._bind(self.db, self.owner, "agent", "agent-a", "Rudra", {"groq_model": "openai/gpt-oss-120b", "reasoning_effort": "low", "tool_ids": ["browser-a"]})
        async def provider(method, path, user, db, payload=None):
            self.assertIn("include_conversation_id=true", path)
            return {"signed_url": "wss://api.elevenlabs.io/v1/convai/conversation?conversation_signature=short-lived"}
        with patch.object(el, "_provider", provider):
            result = self.run_async(el.preview("agent-a", self.db, self.owner))
        self.assertEqual(result["conversation_config_override"]["agent"]["prompt"]["tool_ids"], ["browser-a"])
        self.assertFalse(result["custom_llm_extra_body"]["include_reasoning"])
        for url in ["https://api.elevenlabs.io/v1/convai/conversation", "wss://evil.example/v1/convai/conversation", "wss://api.elevenlabs.io/wrong"]:
            async def invalid(*args, **kwargs):
                return {"signed_url": url}
            with patch.object(el, "_provider", invalid), self.assertRaises(HTTPException):
                self.run_async(el.preview("agent-a", self.db, self.owner))

    def test_conversation_list_ignores_another_agent(self):
        el._bind(self.db, self.owner, "agent", "agent-a", "Rudra")
        async def provider(*args, **kwargs):
            return {"conversations": [{"conversation_id": "conv-a", "agent_id": "agent-a", "status": "done"},
                                      {"conversation_id": "conv-b", "agent_id": "agent-b", "status": "done"}]}
        with patch.object(el, "_provider", provider):
            result = self.run_async(el.conversations("agent-a", "", self.db, self.owner))
        self.assertEqual([row["conversation_id"] for row in result["conversations"]], ["conv-a"])
        with self.assertRaises(HTTPException):
            el._owned(self.db, self.owner, "conversation", "conv-b")

    def test_knowledge_create_metadata_and_validation(self):
        captured = []
        async def provider(method, path, user, db, payload=None):
            captured.append((path, payload))
            return {"id": "doc-a"}
        with patch.object(el, "_provider", provider):
            result = self.run_async(el.create_knowledge(el.KnowledgeRequest(name=" Services ", text=" सुरक्षा और सफाई "), self.db, self.owner))
            self.assertEqual(captured[0], ("/convai/knowledge-base/text", {"name": "Services", "text": "सुरक्षा और सफाई"}))
            self.assertEqual(result["characters"], len("सुरक्षा और सफाई"))
            self.assertEqual(result["type"], "text")
            for req in [el.KnowledgeRequest(name=" ", text="Business facts"), el.KnowledgeRequest(name="Services"),
                        el.KnowledgeRequest(name="Services", text="Facts", url="https://example.com")]:
                with self.assertRaises(HTTPException):
                    self.run_async(el.create_knowledge(req, self.db, self.owner))
        listing = self.run_async(el.knowledge(self.db, self.owner))
        self.assertEqual(listing["documents"][0]["name"], "Services")
        self.assertNotIn("text", listing["documents"][0])

    def test_knowledge_preview_is_owned_plain_text(self):
        el._bind(self.db, self.owner, "knowledge", "doc-a", "Services", {"type": "url"})
        async def provider(method, path, user, db, payload=None):
            self.seen.append(path)
            return {"id": "doc-a", "name": "Services", "type": "url", "url": "https://example.com/services", "metadata": {"size_bytes": 200},
                    "extracted_inner_html": '<h2>Security &amp; housekeeping</h2><script>stealCredentials()</script><p>Delhi NCR</p><img src="x" onerror="run()">'}
        with patch.object(el, "_provider", provider):
            with self.assertRaises(HTTPException):
                self.run_async(el.knowledge_content("doc-a", self.db, self.other))
            self.assertFalse(self.seen)
            result = self.run_async(el.knowledge_content("doc-a", self.db, self.owner))
        self.assertIn("Security & housekeeping", result["text"])
        self.assertIn("Delhi NCR", result["text"])
        self.assertNotIn("stealCredentials", result["text"])
        self.assertNotIn("<", result["text"])
        self.assertTrue(result["ready"])
        self.assertEqual(result["size_bytes"], 200)

    def test_knowledge_preview_is_bounded_and_detach_never_deletes_source(self):
        el._bind(self.db, self.owner, "knowledge", "doc-a", "Services", {"type": "text"})
        async def provider(method, path, user, db, payload=None):
            return {"id": "doc-a", "name": "Services", "type": "text", "content_format": "markdown", "extracted_inner_html": "a" * 50000, "metadata": {}}
        with patch.object(el, "_provider", provider):
            result = self.run_async(el.knowledge_content("doc-a", self.db, self.owner))
        self.assertEqual(len(result["text"]), 30000)
        self.assertTrue(result["truncated"])
        with patch.object(el, "_provider", self.provider), patch.object(el, "get_provider_secret", return_value="groq-test-key"):
            self.run_async(el.create_agent(self.agent_request(knowledge_ids=[]), self.db, self.owner))
        self.assertEqual(el._owned(self.db, self.owner, "knowledge", "doc-a").name, "Services")

    def test_uncertain_call_link_requires_owned_matching_finished_conversation(self):
        el._bind(self.db, self.owner, "agent", "agent-a", "Rudra")
        el._bind(self.db, self.owner, "conversation", "conv-a", "Call", {"agent_id": "agent-a"})
        result = {"conversation_id": "conv-a", "agent_id": "agent-a", "status": "done",
                  "metadata": {"start_time_unix_secs": 1000, "phone_call": {"external_number": "+919876543210"}}}
        async def provider(*args, **kwargs):
            return result
        req = el.VerifyCallRequest(agent_id="agent-a", to_number="+919876543210", started_at=1000)
        with patch.object(el, "_provider", provider):
            self.assertTrue(self.run_async(el.verify_call("conv-a", req, self.db, self.owner))["verified"])
            for changed in ({"status": "in-progress"}, {"agent_id": "agent-other"},
                            {"metadata": {"start_time_unix_secs": 1, "phone_call": {"external_number": "+919876543210"}}},
                            {"metadata": {"start_time_unix_secs": 1000, "phone_call": {"external_number": "+919876543211"}}}):
                previous = dict(result)
                result.update(changed)
                with self.assertRaises(HTTPException):
                    self.run_async(el.verify_call("conv-a", req, self.db, self.owner))
                result.clear()
                result.update(previous)
            with self.assertRaises(HTTPException):
                self.run_async(el.verify_call("conv-a", req, self.db, self.other))

    def test_app_navigation_tool_is_idempotent(self):
        el._bind(self.db, self.owner, "tool", "tool-a", "open_page", {"type": "open_page"})
        with patch.object(el, "_provider", self.provider):
            result = self.run_async(el.create_tool(el.ToolRequest(type="open_page"), self.db, self.owner))
        self.assertEqual(result["id"], "tool-a")
        self.assertFalse(self.seen)


if __name__ == "__main__":
    unittest.main()
