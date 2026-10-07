"""Run: .venv312/Scripts/python.exe -m unittest discover -s tests -p test_crm.py"""
import json
import os
import sys
import unittest
from pathlib import Path
from unittest.mock import patch

from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
os.environ.setdefault("CREDENTIAL_MASTER_KEY", "a" * 64)
from api.auth_sync import Base, UserAccount, UserCloudData, get_db
from api.crm import CRMActivity, CRMDeal, CRMRecord, CRMSource, CRMMigration, CRMTask, _date, _import_legacy, record_outreach, router, upsert_lead
from api import crm_automation  # Register the additive tables used by meeting task writes.
from api.developer_insights import ProductSession
from api.lead_jobs import LeadRecord


class CRMTest(unittest.TestCase):
    def setUp(self):
        self.engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
        Base.metadata.create_all(self.engine)
        self.db = sessionmaker(bind=self.engine)()
        self.owner = UserAccount(id="owner", email="owner@example.test", name="Owner")
        self.other = UserAccount(id="other", email="other@example.test", name="Other")
        self.db.add_all([self.owner, self.other])
        self.db.commit()
        self.app = FastAPI()
        self.app.include_router(router)
        self.app.dependency_overrides[get_db] = lambda: self.db
        def verify(token):
            if token not in ("owner", "other"):
                raise HTTPException(401, "Invalid session")
            return {"sub": token, "email": token + "@example.test"}
        self.auth = patch("api.auth_sync._verify_supabase_token", side_effect=verify)
        self.auth.start()
        self.cloud = patch("api.crm._supabase_snapshot", return_value={})
        self.cloud.start()
        self.client = TestClient(self.app)

    def tearDown(self):
        self.client.close()
        self.cloud.stop()
        self.auth.stop()
        self.db.close()
        self.engine.dispose()

    def call(self, method, path, body=None, owner="owner"):
        headers = {"Authorization": "Bearer " + owner} if owner else {}
        return self.client.request(method, "/api/crm" + path, json=body, headers=headers)

    def lead(self, source_id="lead-1", owner="owner", **payload):
        item = upsert_lead(self.db, owner, source_id, {"company": "Same company", "email": source_id + "@example.test", **payload})
        self.db.commit()
        return item

    def test_auth_isolation_versions_and_persistence(self):
        item = self.lead()
        self.assertEqual(self.call("GET", "/records", owner=None).status_code, 401)
        self.assertEqual(self.call("GET", "/records", owner="invalid").status_code, 401)
        self.assertEqual(self.call("GET", "/records/" + item.id, owner="other").status_code, 404)
        self.assertEqual(self.call("GET", "/records", owner="other").json()["total"], 0)
        self.assertEqual(self.call("PATCH", "/records/" + item.id, {"version": 1, "profile": {"company": "Manual", "phoneOptOut": True}, "stage": "qualified"}).status_code, 200)
        self.assertEqual(self.call("PATCH", "/records/" + item.id, {"version": 1, "stage": "new"}).status_code, 409)
        upsert_lead(self.db, "owner", "lead-1", {"company": "Bad overwrite", "status": "New", "phone": "123"})
        self.db.commit()
        data = self.call("GET", "/records/" + item.id).json()
        self.assertEqual(data["profile"]["company"], "Manual")
        self.assertEqual(data["profile"]["phone"], "123")
        self.assertTrue(data["profile"]["phoneOptOut"])
        self.assertEqual(data["stage"], "qualified")
        self.assertIsNone(data["createdAt"])
        self.assertTrue(any(a["kind"] == "record_updated" for a in data["activities"]))
        self.assertEqual(self.call("PATCH", "/records/" + item.id, {"version": data["version"], "stage": "client"}).status_code, 422)
        self.assertEqual(self.call("POST", "/deals", {"recordId": item.id, "name": "foreign"}, owner="other").status_code, 404)

    def test_won_deals_derive_client_multiple_deals_and_task_audit(self):
        item = self.lead(status="Closed")
        self.assertEqual(item.stage, "review_required")
        a = self.call("POST", "/deals", {"recordId": item.id, "name": "Guarding", "stage": "won", "monthlyAmount": 1000}).json()
        b = self.call("POST", "/deals", {"recordId": item.id, "name": "Cleaning", "stage": "won"}).json()
        self.assertEqual(self.call("GET", "/records/" + item.id).json()["stage"], "client")
        self.assertEqual(self.call("PATCH", "/deals/" + a["id"], {"version": a["version"], "archived": True}).status_code, 200)
        self.assertEqual(self.call("GET", "/records/" + item.id).json()["stage"], "client")
        self.assertEqual(self.call("PATCH", "/deals/" + b["id"], {"version": b["version"], "stage": "lost", "lossReason": "Timing"}).status_code, 200)
        self.assertEqual(self.call("GET", "/records/" + item.id).json()["stage"], "qualified")
        task = self.call("POST", "/tasks", {"recordId": item.id, "title": "Follow up", "kind": "meeting", "dueAt": "2026-10-04", "notes": "Call buyer"}).json()
        self.assertEqual(self.call("PATCH", "/tasks/" + task["id"], {"version": task["version"], "status": "completed"}).status_code, 200)
        self.assertEqual(self.call("PATCH", "/tasks/" + task["id"], {"version": task["version"], "status": "open"}).status_code, 409)
        detail = self.call("GET", "/records/" + item.id).json()
        self.assertEqual(detail["tasks"][0]["notes"], "Call buyer")
        self.assertEqual(len(detail["deals"]), 2)
        self.assertTrue(any(x["kind"] == "deal_updated" for x in detail["activities"]))
        self.assertTrue(any(x["kind"] == "task_updated" for x in detail["activities"]))

    def test_manual_evidence_and_note_edit_audit(self):
        item = self.lead()
        self.assertEqual(self.call("POST", "/records/" + item.id + "/activities", {"kind": "outreach", "note": "Fake", "outcome": "sent", "channel": "email"}).status_code, 422)
        self.assertEqual(self.call("POST", "/records/" + item.id + "/activities", {"kind": "conversation", "note": "No answer", "outcome": "no_answer"}).status_code, 422)
        activity = self.call("POST", "/records/" + item.id + "/activities", {"kind": "remark", "note": "First", "idempotencyKey": "first-note"}).json()
        duplicate = self.call("POST", "/records/" + item.id + "/activities", {"kind": "remark", "note": "First", "idempotencyKey": "first-note"}).json()
        self.assertEqual(activity["id"], duplicate["id"])
        changed = self.call("PATCH", "/activities/" + activity["id"], {"version": activity["version"], "note": "Corrected"}).json()
        self.assertEqual(changed["noteHistory"][0]["note"], "First")
        self.assertEqual(self.call("PATCH", "/activities/" + activity["id"], {"version": activity["version"], "note": "Stale"}).status_code, 409)
        self.assertEqual(self.call("PATCH", "/activities/" + activity["id"], {"version": changed["version"], "note": "Attack"}, owner="other").status_code, 404)
        conversation = self.call("POST", "/records/" + item.id + "/activities", {"kind": "conversation", "note": "Buyer replied", "outcome": "replied"}).json()
        self.assertEqual(conversation["evidence"], "manual")
        self.assertEqual(self.call("GET", "/records/" + item.id).json()["stage"], "connected")

    def test_outreach_pending_receipt_dedup_and_no_stage_downgrade(self):
        item = self.lead(email="buyer@example.test", additionalContacts=[{"email": "SECONDARY@example.test"}])
        pending = record_outreach(self.db, "owner", recipient="secondary@example.test", outcome="unknown", evidence="pending", idempotency_key="request-1")
        self.db.commit()
        self.assertEqual(pending.record_id, item.id)
        sent = record_outreach(self.db, "owner", recipient="SECONDARY@example.test", outcome="sent", evidence="provider", provider_id="receipt-1", idempotency_key="request-1")
        self.db.commit()
        self.assertEqual(sent.id, pending.id)
        self.assertEqual(item.stage, "attempted")
        duplicate = record_outreach(self.db, "owner", recipient="secondary@example.test", provider_id="receipt-1", idempotency_key="callback-different-key")
        self.db.commit()
        self.assertEqual(duplicate.id, pending.id)
        self.assertEqual(self.db.query(CRMActivity).filter_by(kind="outreach").count(), 1)
        self.call("PATCH", "/records/" + item.id, {"version": item.version, "stage": "qualified"})
        record_outreach(self.db, "owner", record_id=item.id, recipient="buyer@example.test", provider_id="receipt-2")
        self.db.commit()
        self.assertEqual(item.stage, "qualified")
        self.call("POST", "/deals", {"recordId": item.id, "name": "Won", "stage": "won"})
        record_outreach(self.db, "owner", record_id=item.id, recipient="buyer@example.test", provider_id="receipt-3")
        self.db.commit()
        self.assertEqual(item.stage, "client")
        with self.assertRaises(HTTPException):
            record_outreach(self.db, "other", record_id=item.id, provider_id="attack")
        with self.assertRaises(HTTPException):
            record_outreach(self.db, "owner", record_id=item.id, outcome="sent", evidence="manual")
        self.assertEqual(self.call("GET", "/overview").json()["metrics"]["conversations"], 0)

    def test_ownerless_local_skipped_and_cloud_snapshot_identity_is_not_proof(self):
        body = {"source": "local", "snapshotUserId": "owner", "records": [{"id": "ownerless", "company": "Unsafe"}, {"id": "foreign", "ownerUserId": "other"}, {"id": "mine", "ownerUserId": "owner", "company": "Good", "status": "Closed"}]}
        result = self.call("POST", "/bootstrap", body).json()
        self.assertEqual(result["skipped"], 2)
        self.assertEqual(result["imported"], 1)
        self.assertEqual(result["reviewRequired"], 1)
        self.assertEqual(self.call("POST", "/bootstrap", body).json()["imported"], 0)
        forged = self.call("POST", "/bootstrap", {"source": "cloud", "snapshotUserId": "owner", "records": [{"id": "forged", "company": "Unverified"}]}).json()
        self.assertEqual(forged["skipped"], 1)
        self.assertEqual(self.db.query(CRMRecord).count(), 1)
        self.assertEqual(self.call("POST", "/bootstrap", {"snapshotUserId": "other"}).status_code, 403)
        self.assertEqual(self.call("POST", "/bootstrap", {"source": "local", "records": [{}] * 251}).status_code, 422)

    def test_stable_identity_no_company_merge_unknown_dates_and_history(self):
        a, b = self.lead("same-name-a"), self.lead("same-name-b")
        self.assertNotEqual(a.id, b.id)
        counts = _import_legacy(self.db, self.owner, [{"id": "same-name-a", "company": "Enriched", "remarks": "Historical note"}],
                                [{"id": "old-email", "leadId": "same-name-a", "status": "sent", "channel": "email"}], "cloud", trusted=True)
        self.db.commit()
        self.assertEqual(self.db.query(CRMRecord).count(), 2)
        self.assertEqual(self.db.query(CRMSource).filter_by(record_id=a.id).count(), 2)
        self.assertIsNone(a.created_at)
        self.assertEqual(a.profile and json.loads(a.profile)["company"], "Enriched")
        historical = self.db.query(CRMActivity).filter_by(kind="outreach").one()
        self.assertIsNone(historical.occurred_at)
        self.assertEqual(historical.outcome, "unknown")
        self.assertEqual(historical.evidence, "legacy_unverified")
        _import_legacy(self.db, self.owner, [{"id": "same-name-a", "remarks": "Source must not overwrite original"}], [], "cloud", trusted=True)
        self.db.commit()
        notes = [a.note for a in self.db.query(CRMActivity).filter_by(kind="remark").all()]
        self.assertIn("Historical note", notes)
        self.assertEqual(notes.count("Historical note"), 1)

    def test_metrics_date_filters_match_drilldowns_and_missing_values(self):
        a = self.lead("dated", createdAt="2026-10-04T23:59:59Z")
        self.lead("outside", createdAt="2026-10-05T00:00:00Z")
        self.lead("unknown")
        b = self.lead("foreign", owner="other", createdAt="2026-10-04")
        now = _date("2026-10-04T12:00:00Z")
        with patch("api.crm.time.time", return_value=now):
            self.call("POST", "/deals", {"recordId": a.id, "name": "Open", "monthlyAmount": 100.25})
            self.call("POST", "/deals", {"recordId": a.id, "name": "Missing"})
            self.call("POST", "/tasks", {"recordId": a.id, "title": "In range", "dueAt": "2026-10-04T23:59:59Z"})
            self.call("POST", "/tasks", {"recordId": a.id, "title": "Outside", "dueAt": "2026-10-05"})
            record_outreach(self.db, "owner", record_id=a.id, recipient="BUYER@example.test", provider_id="provider-a")
            record_outreach(self.db, "owner", record_id=a.id, recipient="buyer@example.test", provider_id="provider-b")
            self.db.commit()
            self.call("POST", "/records/" + a.id + "/activities", {"kind": "outreach", "channel": "whatsapp", "outcome": "user_confirmed", "note": "I sent it"})
            self.call("POST", "/records/" + a.id + "/activities", {"kind": "conversation", "outcome": "connected", "note": "Spoke to buyer"})
        span = "?from=2026-10-04&to=2026-10-04"
        data = self.call("GET", "/overview" + span).json()
        metrics = data["metrics"]
        self.assertEqual(metrics["leads"], self.call("GET", "/records" + span + "&view=leads").json()["total"])
        self.assertEqual(metrics["leads"], 1)
        self.assertEqual(metrics["pendingFollowUps"], self.call("GET", "/tasks" + span + "&status=open").json()["total"])
        self.assertEqual(metrics["messagesSent"], self.call("GET", "/activities" + span + "&kind=outreach&confirmed=true").json()["total"])
        self.assertEqual(metrics["uniqueRecipients"], self.call("GET", "/activities" + span + "&uniqueRecipients=true").json()["total"])
        self.assertEqual(metrics["conversations"], self.call("GET", "/activities" + span + "&kind=conversation&confirmed=true").json()["total"])
        self.assertEqual(metrics["pipelineMonthlyValue"], 100.25)
        self.assertEqual(metrics["incompleteDealValues"], 1)
        self.assertEqual(self.call("GET", "/deals" + span + "&stage=open").json()["total"], 2)
        self.assertEqual(sum(x["count"] for x in data["intake"]), 1)
        self.assertEqual(self.call("GET", "/overview?from=2026-10-05&to=2026-10-04").status_code, 422)

    def test_owner_usage_no_fabricated_history(self):
        self.assertIsNone(self.call("GET", "/usage").json()["historyKnownFrom"])
        epoch = _date("2026-10-04T09:00:00Z")
        self.db.add_all([ProductSession(id="session-owner", user_id="owner", device_id="device", device_label="Windows", platform="desktop", region="Asia/Calcutta", started_at=epoch, last_seen_at=epoch),
                         ProductSession(id="session-other", user_id="other", device_id="device", device_label="Windows", platform="desktop", region="Asia/Calcutta", started_at=epoch, last_seen_at=epoch)])
        self.db.commit()
        data = self.call("GET", "/usage?from=2026-10-04&to=2026-10-04").json()
        self.assertEqual(data["days"], [{"date": "2026-10-04", "sessions": 1, "activities": 0}])
        self.assertEqual(data["historyKnownFrom"], "2026-10-04")

    def test_bootstrap_resumes_past_old_500_and_10000_caps(self):
        self.db.bulk_save_objects([LeadRecord(id=f"backend-{i:05d}", owner_user_id="owner", job_id="old-job", payload=json.dumps({"company": f"Backend {i}"}), created_at=_date("2026-01-01")) for i in range(501)])
        self.db.add(LeadRecord(id="foreign-lead", owner_user_id="other", job_id="other-job", payload='{"company":"Foreign"}'))
        self.db.add(UserCloudData(email=self.owner.email, data_type="full_snapshot", payload=json.dumps({"leads": [{"id": f"cloud-{i}", "company": f"Cloud {i}"} for i in range(10001)]})))
        self.db.add(UserCloudData(email=self.other.email, data_type="full_snapshot", payload='{"leads":[{"id":"foreign-cloud"}]}'))
        self.db.commit()
        cursor, imported, calls = None, 0, 0
        while True:
            body = {"source": "local"}
            if cursor:
                body["cursor"] = cursor
            response = self.call("POST", "/bootstrap", body)
            self.assertEqual(response.status_code, 200, response.text)
            result = response.json()
            imported += result["imported"]
            calls += 1
            if calls == 1:
                self.assertFalse(result["complete"])
                self.assertEqual(self.call("POST", "/bootstrap", {"source": "local", "cursor": result["cursor"]}, owner="other").status_code, 404)
            if result["complete"]:
                break
            cursor = result["cursor"]
            self.assertLess(calls, 60)
        self.assertEqual(imported, 10502)
        self.assertEqual(self.db.query(CRMRecord).filter_by(owner_user_id="owner").count(), 10502)
        self.assertEqual(self.db.query(CRMSource).filter_by(owner_user_id="other").count(), 0)
        self.assertEqual(self.call("GET", "/records?offset=10000&limit=250").json()["total"], 10502)
        self.assertEqual(len(self.call("GET", "/records?offset=10501&limit=250").json()["records"]), 1)

    def test_cloud_rls_snapshot_frozen_and_retryable_failure(self):
        snapshot = {"leads": [{"id": f"remote-{i}", "company": "Remote"} for i in range(501)]}
        with patch("api.crm._supabase_snapshot", return_value=snapshot) as fetch:
            first = self.call("POST", "/bootstrap", {"source": "cloud"}).json()
            self.assertFalse(first["complete"])
            second = self.call("POST", "/bootstrap", {"source": "cloud", "cursor": first["cursor"]}).json()
            third = self.call("POST", "/bootstrap", {"source": "cloud", "cursor": second["cursor"]}).json()
            self.assertTrue(third["complete"])
            self.assertTrue(third["remoteComplete"])
            self.assertEqual(fetch.call_count, 1)
        with patch("api.crm._supabase_snapshot", side_effect=HTTPException(503, "DNS unavailable")):
            failed = self.call("POST", "/bootstrap", {"source": "cloud"}).json()
            self.assertTrue(failed["complete"])
            self.assertFalse(failed["remoteComplete"])
            self.assertEqual(failed["warnings"], ["DNS unavailable"])
            self.assertTrue(failed["cursor"])
        recovered = self.call("POST", "/bootstrap", {"source": "cloud", "cursor": failed["cursor"]}).json()
        self.assertTrue(recovered["remoteComplete"])


if __name__ == "__main__":
    unittest.main()
