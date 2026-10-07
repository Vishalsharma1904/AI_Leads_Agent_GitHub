"""Reports/contract regressions; never contacts a live provider."""
import unittest
from datetime import datetime, timedelta, timezone
from sqlalchemy import event
import test_crm as fixture
from test_crm import CRMDeal, CRMActivity


class CRMInsightsTest(unittest.TestCase):
    setUp = fixture.CRMTest.setUp
    tearDown = fixture.CRMTest.tearDown
    call = fixture.CRMTest.call
    lead = fixture.CRMTest.lead

    def deal(self, record, **fields):
        response = self.call("POST", "/deals", {"recordId": record.id, "name": "Guarding", "stage": "won", **fields})
        self.assertEqual(response.status_code, 201, response.text)
        return response.json()

    def test_auth_range_and_owner_isolation(self):
        other = self.lead(owner="other")
        self.assertEqual(self.call("POST", "/deals", {"recordId": other.id, "name": "Other", "stage": "won"}, owner="other").status_code, 201)
        for path in ("/reports", "/clients"):
            self.assertEqual(self.call("GET", path, owner=None).status_code, 401)
        self.assertEqual(self.call("GET", "/clients").json()["total"], 0)
        self.assertEqual(self.call("GET", "/reports").json()["metrics"]["confirmedClients"], 0)
        for query in ("from=2025-01-01&to=2026-01-02", "from=2026-10-06&to=2026-10-05", "from=bad", "from=20261006", "timezone=Europe/London"):
            self.assertEqual(self.call("GET", "/reports?" + query).status_code, 422)
        self.assertEqual(self.call("GET", "/reports?from=2024-01-01&to=2024-12-31").status_code, 200)
        self.assertEqual(self.call("GET", "/clients?renewal=bad").status_code, 422)

    def test_india_day_totals_missing_values_and_matching_drilldowns(self):
        timestamp = datetime(2026, 10, 5, 19, 0, tzinfo=timezone.utc).timestamp()
        record = self.lead(createdAt="2026-10-05T19:00:00Z")
        record.created_at = timestamp
        a = self.deal(record, monthlyAmount=1000)
        b = self.deal(record)
        self.db.query(CRMDeal).filter(CRMDeal.id.in_([a["id"], b["id"]])).update({CRMDeal.won_at: timestamp}, synchronize_session=False)
        self.db.add(CRMActivity(id="pending", owner_user_id="owner", record_id=record.id, kind="outreach", channel="email", outcome="unknown", evidence="pending", occurred_at=timestamp, created_at=timestamp))
        self.db.add(CRMActivity(id="confirmed", owner_user_id="owner", record_id=record.id, kind="outreach", channel="email", outcome="sent", evidence="provider", occurred_at=timestamp, created_at=timestamp))
        self.db.commit()
        query = "from=2026-10-06&to=2026-10-06&timezone=Asia/Kolkata"
        data = self.call("GET", "/reports?" + query).json()
        self.assertEqual(data["metrics"]["leadsAdded"], 1)
        self.assertEqual(data["metrics"]["wonContracts"], 2)
        self.assertEqual(data["metrics"]["wonMonthlyValue"], 1000)
        self.assertEqual(data["wins"][0]["missingAmounts"], 1)
        self.assertEqual(sum(row["count"] for row in data["outreach"]), 2)
        self.assertEqual(sum(row["confirmed"] for row in data["outreach"]), 1)
        self.assertEqual(self.call("GET", "/deals?stage=won&" + query).json()["total"], 2)
        self.assertEqual(self.call("GET", "/records?" + query).json()["total"], 1)
        self.assertEqual(self.call("GET", "/reports?" + query.replace("Asia/Kolkata", "UTC")).json()["metrics"]["wonContracts"], 0)

    def test_contract_date_validation_conflicts_and_no_guessed_dates(self):
        record = self.lead()
        for fields in ({"contractStartDate": "2026-10-12", "contractEndDate": "2026-10-01"}, {"contractEndDate": "2026-02-30"}, {"contractStartDate": "tomorrow"}):
            self.assertEqual(self.call("POST", "/deals", {"recordId": record.id, "name": "Invalid", **fields}).status_code, 422)
        deal = self.deal(record, contractStartDate="2026-10-01", contractEndDate="2026-11-01")
        bad = self.call("PATCH", "/deals/" + deal["id"], {"version": deal["version"], "contractEndDate": "2026-09-30"})
        self.assertEqual(bad.status_code, 422)
        changed = self.call("PATCH", "/deals/" + deal["id"], {"version": deal["version"], "contractEndDate": None})
        self.assertEqual(changed.status_code, 200)
        self.assertIsNone(changed.json()["contractEndDate"])
        self.assertEqual(self.call("PATCH", "/deals/" + deal["id"], {"version": deal["version"], "contractEndDate": "2026-12-01"}).status_code, 409)
        self.assertIsNone(self.deal(record)["contractStartDate"])
        self.call("POST", "/tasks", {"recordId": record.id, "title": "Later", "dueAt": "2026-10-08T09:00:00+05:30"})
        self.call("POST", "/tasks", {"recordId": record.id, "title": "First renewal review", "dueAt": "2026-10-07T09:00:00+05:30"})
        self.assertEqual(self.call("GET", "/clients").json()["records"][0]["nextFollowUp"]["title"], "First renewal review")

    def test_renewals_pagination_archiving_and_expiry_does_not_change_won(self):
        today = datetime.now(timezone(timedelta(hours=5, minutes=30))).date()
        for i, days in enumerate((-1, 0, 30, 31, None)):
            record = self.lead("r" + str(i), company="Client " + str(i))
            self.deal(record, contractEndDate=(today + timedelta(days=days)).isoformat() if days is not None else None, monthlyAmount=100)
        self.assertEqual(self.call("GET", "/clients?renewal=due").json()["total"], 2)
        self.assertEqual(self.call("GET", "/clients?renewal=expired").json()["total"], 1)
        self.assertEqual(self.call("GET", "/clients?renewal=missing").json()["total"], 1)
        page1 = self.call("GET", "/clients?limit=2").json()
        page2 = self.call("GET", "/clients?limit=2&offset=2").json()
        self.assertEqual(page1["total"], 5)
        self.assertFalse({r["id"] for r in page1["records"]} & {r["id"] for r in page2["records"]})
        expired = self.call("GET", "/clients?renewal=expired").json()["records"][0]
        self.assertEqual(expired["contracts"][0]["stage"], "won")
        self.assertEqual(self.call("GET", "/clients?search=Client%204").json()["total"], 1)
        d = expired["contracts"][0]
        self.call("PATCH", "/deals/" + d["id"], {"version": d["version"], "archived": True})
        self.assertEqual(self.call("GET", "/clients").json()["total"], 4)

    def test_related_record_queries_are_batched(self):
        for i in range(8):
            self.deal(self.lead("batched" + str(i)))
        statements = []
        def capture(conn, cursor, statement, params, context, executemany):
            if statement.lstrip().startswith("SELECT"): statements.append(statement)
        event.listen(self.engine, "before_cursor_execute", capture)
        self.call("GET", "/records?limit=1")
        one = len(statements); statements.clear()
        self.call("GET", "/records?limit=8")
        self.assertEqual(len(statements), one)
        statements.clear(); self.call("GET", "/clients?limit=1")
        one = len(statements); statements.clear(); self.call("GET", "/clients?limit=8")
        self.assertEqual(len(statements), one)
        event.remove(self.engine, "before_cursor_execute", capture)


if __name__ == "__main__": unittest.main()
