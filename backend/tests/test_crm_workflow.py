"""CRM send integration; provider is always mocked, never real Gmail."""
import asyncio
import ast
import json
import os
import time
import unittest
from collections import defaultdict, deque
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import httpx
from fastapi import HTTPException
from starlette.responses import Response
from sqlalchemy.orm import sessionmaker

if __package__:
    from . import test_connected_email as email_fixture
else:
    import test_connected_email as email_fixture
from api import email_sender
from api import lead_jobs as leads_api
from api.crm import CRMActivity, CRMRecord, upsert_lead
from api.lead_jobs import LeadRecord, _save_crm_lead


class CRMWorkflowTest(unittest.TestCase):
    setUp = email_fixture.ConnectedEmailTest.setUp
    tearDown = email_fixture.ConnectedEmailTest.tearDown
    def request(self, record=None, key="workflow-key"):
        return email_sender.SendEmailRequest(to="lead@example.com", subject="Hello", htmlBody="Hi",
                                            crmRecordId=record.id if record else None, idempotencyKey=key)

    def test_provider_receipt_idempotency_and_advanced_stage(self):
        record = upsert_lead(self.db, self.owner.id, "lead-1", {"company": "Hotel", "email": "lead@example.com"})
        record.stage = "qualified"
        self.db.commit()
        client = email_fixture.FakeClient()
        with patch("api.connectors._google_token", new=AsyncMock(return_value="token")), \
             patch("api.email_sender.httpx.AsyncClient", return_value=client) as provider:
            first = asyncio.run(email_sender.connected_email_send(self.request(record), self.db, self.owner))
            again = asyncio.run(email_sender.connected_email_send(self.request(record), self.db, self.owner))
        self.assertEqual(first["messageId"], again["messageId"])
        self.assertTrue(again["idempotent"])
        self.assertEqual(provider.call_count, 1)
        self.assertEqual(self.db.query(CRMActivity).filter_by(kind="outreach").count(), 1)
        self.assertEqual(self.db.query(CRMActivity).filter_by(kind="outreach").one().evidence, "provider")
        self.db.refresh(record)
        self.assertEqual(record.stage, "qualified")

    def test_successful_send_survives_ledger_failure(self):
        real = email_sender.record_outreach

        def fail_receipt(*args, **kwargs):
            if kwargs.get("outcome") == "sent":
                raise RuntimeError("fixture ledger failure")
            return real(*args, **kwargs)

        with patch("api.connectors._google_token", new=AsyncMock(return_value="token")), \
             patch("api.email_sender.httpx.AsyncClient", return_value=email_fixture.FakeClient()), \
             patch("api.email_sender.record_outreach", side_effect=fail_receipt), \
             self.assertLogs("api.email_sender", level="ERROR"):
            result = asyncio.run(email_sender.connected_email_send(self.request(), self.db, self.owner))
        self.assertEqual(result["status"], "success")
        self.assertIn("Do not resend", result["ledgerWarning"])
        self.assertEqual(self.db.query(CRMActivity).filter_by(kind="outreach").one().outcome, "unknown")

    def test_unknown_provider_response_is_not_safe_to_repeat(self):
        client = email_fixture.FakeClient()
        client.post = AsyncMock(side_effect=httpx.ReadTimeout("fixture response lost"))
        with patch("api.connectors._google_token", new=AsyncMock(return_value="token")), \
             patch("api.email_sender.httpx.AsyncClient", return_value=client):
            with self.assertRaises(HTTPException):
                asyncio.run(email_sender.connected_email_send(self.request(), self.db, self.owner))
            with self.assertRaises(HTTPException) as error:
                asyncio.run(email_sender.connected_email_send(self.request(), self.db, self.owner))
        self.assertEqual(client.post.call_count, 1)
        self.assertIn("unknown", error.exception.detail)
        self.assertEqual(self.db.query(CRMActivity).filter_by(kind="outreach").one().outcome, "unknown")

    def test_tenant_record_preflight_and_opt_out(self):
        other = upsert_lead(self.db, self.other.id, "other-lead", {"email": "lead@example.com"})
        opted_out = upsert_lead(self.db, self.owner.id, "opt-out", {"email": "lead@example.com", "emailOptOut": True})
        self.db.commit()
        with patch("api.email_sender.httpx.AsyncClient") as provider:
            for record, expected in [(other, 404), (opted_out, 409)]:
                with self.assertRaises(HTTPException) as error:
                    asyncio.run(email_sender.connected_email_send(self.request(record), self.db, self.owner))
                self.assertEqual(error.exception.status_code, expected)
            with self.assertRaises(HTTPException) as error:
                asyncio.run(email_sender.connected_email_send(self.request(), self.db, self.owner))
            self.assertEqual(error.exception.status_code, 409)
        provider.assert_not_called()

    def test_source_enrichment_reuses_same_record(self):
        source = LeadRecord(id="backend-lead", owner_user_id=self.owner.id, job_id="fixture", payload="{}", created_at=1234)
        self.db.add(source)
        item = {"title": "Hotel", "phone": "919811100001"}
        _save_crm_lead(self.db, source, item)
        original = item["crmRecordId"]
        self.db.commit()
        item["email"] = "enriched@example.test"
        _save_crm_lead(self.db, source, item)
        self.db.commit()
        self.assertEqual(item["crmRecordId"], original)
        self.assertEqual(self.db.query(CRMRecord).count(), 1)
        self.assertEqual(self.db.query(CRMActivity).filter_by(kind="intake").count(), 0)

    def test_enrichment_keeps_previously_accepted_contact_slots(self):
        self.db.add(leads_api.LeadJob(id="slot-job", owner_user_id=self.owner.id, status="queued",
                                    request_payload=json.dumps({"cities": ["Delhi"], "industries": ["Hotels"], "count": 1})))
        self.db.commit()

        def provider(request):
            if request.url.path.endswith("/runs"):
                return httpx.Response(200, json={"data": {"id": "fixture-run", "status": "SUCCEEDED", "defaultDatasetId": "fixture-dataset"}})
            return httpx.Response(200, json=[
                {"title": "Newly enriched hotel", "address": "Delhi", "website": "https://fixture.example.test"},
                {"title": "Initially accepted hotel", "address": "Delhi", "phone": "919811100001"}])

        async def enrich(items, **kwargs):
            items[0]["phone"] = "919811100002"
            return items

        original_client = httpx.AsyncClient
        with patch.object(leads_api, "get_provider_secret", return_value="fixture-token"), \
             patch.object(leads_api.httpx, "AsyncClient", side_effect=lambda **kw: original_client(transport=httpx.MockTransport(provider), **kw)), \
             patch.object(leads_api, "enrich_public_websites", side_effect=enrich), \
             patch.dict(os.environ, {"LEAD_WEBSITE_CRAWLER_ENABLED": "true"}):
            asyncio.run(leads_api._run_apify("slot-job", self.owner.id, sessionmaker(bind=self.engine)))
        self.db.expire_all()
        records = self.db.query(LeadRecord).all()
        self.assertEqual(len(records), 1)
        self.assertEqual(json.loads(records[0].payload)["title"], "Initially accepted hotel")
        self.assertEqual(self.db.query(CRMRecord).count(), 1)

    def test_production_crm_rate_limit_and_explicit_override(self):
        # Execute the actual middleware without importing optional voice engines.
        tree = ast.parse((Path(__file__).parents[1] / "main.py").read_text(encoding="utf-8-sig"))
        handler = next(node for node in tree.body if isinstance(node, ast.AsyncFunctionDef) and node.name == "security_controls")
        handler.decorator_list = []
        namespace = {"os": os, "time": time, "Response": Response, "APP_ENV": "production",
                     "_rate_windows": defaultdict(deque), "_RATE_LIMITED_PREFIXES": ("/api/crm",), "MAX_REQUEST_BYTES": 1000}
        exec(compile(ast.Module(body=[handler], type_ignores=[]), "main.py", "exec"), namespace)
        request = SimpleNamespace(headers={}, url=SimpleNamespace(path="/api/crm/records"), client=SimpleNamespace(host="fixture"))

        async def next_request(request):
            return Response("{}", media_type="application/json")

        async def check(ceiling):
            namespace["_rate_windows"].clear()
            for _ in range(ceiling):
                response = await namespace["security_controls"](request, next_request)
                self.assertEqual(response.status_code, 200)
                self.assertIn("Strict-Transport-Security", response.headers)
            blocked = await namespace["security_controls"](request, next_request)
            self.assertEqual(blocked.status_code, 429)
            self.assertEqual(blocked.headers["Retry-After"], "60")

        clean = {key: value for key, value in os.environ.items() if key not in ("RATE_LIMIT_PER_MINUTE", "CRM_RATE_LIMIT_PER_MINUTE")}
        with patch.dict(os.environ, clean, clear=True):
            asyncio.run(check(240))
            with patch.dict(os.environ, {"RATE_LIMIT_PER_MINUTE": "3"}):
                asyncio.run(check(3))
            with patch.dict(os.environ, {"CRM_RATE_LIMIT_PER_MINUTE": "4"}):
                asyncio.run(check(4))


if __name__ == "__main__":
    unittest.main()
