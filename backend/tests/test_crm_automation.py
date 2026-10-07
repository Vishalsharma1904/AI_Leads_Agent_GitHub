"""Mocked business workflow check: no real email, paid call or Calendar write."""
import asyncio
import base64
import json
import time
import unittest
from datetime import datetime, timedelta, timezone
from unittest.mock import patch, AsyncMock
import httpx
from backend.tests.test_crm import CRMTest
from api import crm_automation as business
from api.crm import CRMTask, CRMActivity, _load
from api.connectors import ConnectorJob, _oauth_url, _encode_state, _decode_state_payload
from api import connectors


class BusinessTest(unittest.TestCase):
    setUp = CRMTest.setUp
    tearDown = CRMTest.tearDown
    call = CRMTest.call
    lead = CRMTest.lead

    def start(self):
        self.app.include_router(business.router)
        return self.lead()

    def body(self, record, category="meeting", **extra):
        return {"recordId":record.id,"version":record.version,"category":category,"channel":"call",
            "summary":"Client confirmed the meeting", "idempotencyKey":"example-event-001",
            "meetingAt":(datetime.now(timezone.utc)+timedelta(days=2)).isoformat() if category=="meeting" else None, **extra}

    def test_outcomes_accounts_idempotence_conflicts_and_unknown_time(self):
        lead=self.start(); body=self.body(lead)
        self.assertEqual(self.call("POST","/automation/outcomes",body,owner="other").status_code,404)
        response=self.call("POST","/automation/outcomes",body); self.assertEqual(response.status_code,200,response.text)
        task=response.json()["task"]; self.assertEqual(self.db.query(CRMTask).count(),1)
        self.assertTrue(self.call("POST","/automation/outcomes",body).json()["idempotent"])
        self.assertEqual(self.db.query(CRMTask).count(),1)
        self.assertEqual(self.db.query(ConnectorJob).count(),2)
        sync=self.call("POST",f'/automation/meetings/{task["id"]}/sync').json()
        self.assertEqual(sync["status"],"queued")
        self.assertEqual(self.db.query(ConnectorJob).filter_by(status="cancelled").count(),0)
        self.assertEqual(self.call("GET","/automation/overview",owner="other").json()["total"],0)
        self.assertEqual(self.call("POST","/automation/outcomes",self.body(lead,"hot",version=1,idempotencyKey="example-other-001")).status_code,409)
        self.db.refresh(lead)
        self.assertEqual(self.call("POST","/automation/outcomes",self.body(lead,"meeting",meetingAt=None,idempotencyKey="example-review-01")).json()["category"],"review_required")
        self.assertEqual(self.db.query(CRMTask).count(),1)
        self.assertEqual(self.call("GET","/automation/overview?search=absent").json()["total"],0)
        self.assertEqual(self.call("GET","/automation/overview?from=garbage").status_code,422)
        self.assertEqual(self.call("PUT","/automation/settings",{"timezone":"Not/AZone"}).status_code,422)
        self.assertEqual(self.call("GET","/overview").json()["metrics"]["clients"],0)

    def test_late_no_answer_does_not_downgrade_and_ambiguous_date(self):
        lead=self.start(); now=time.time()
        business.apply_outcome(self.db,"owner",lead,business.OutcomeWrite(**self.body(lead,"hot")),occurred_at=now)
        self.db.commit(); self.db.refresh(lead)
        business.apply_outcome(self.db,"owner",lead,business.OutcomeWrite(**self.body(lead,"no_answer",idempotencyKey="late-event-001")),occurred_at=now-100)
        self.db.commit();self.db.refresh(lead)
        self.assertEqual(lead.stage,"qualified")
        self.assertEqual(self.db.get(business.BusinessOutcome,lead.id).category,"hot")
        business.apply_outcome(self.db,"owner",lead,business.OutcomeWrite(**self.body(lead,"no_answer",idempotencyKey="new-event-002")),occurred_at=now+1)
        self.db.commit();self.db.refresh(lead); self.assertEqual(lead.stage,"qualified")
        anchor=datetime(2030,1,1,8,tzinfo=business.ZoneInfo("Asia/Kolkata")).timestamp()
        self.assertIsNone(business.appointment_from_text("Sunday 5 baje meeting",anchor,"Asia/Kolkata"))
        self.assertIn("17:00:00+05:30",business.appointment_from_text("Sunday 5 pm meeting",anchor,"Asia/Kolkata"))
        self.assertIn("17:00:00+05:30",business.appointment_from_text("रविवार को शाम पाँच बजे मीटिंग",anchor,"Asia/Kolkata"))
        self.assertIsNone(business.appointment_from_text("रविवार रात बारह बजे मीटिंग",anchor,"Asia/Kolkata"))
        self.assertEqual(business.rule_analysis("If you are interested we could arrange a meeting",now,"Asia/Kolkata")["category"],"review_required")
        self.assertEqual(business.client_transcript([{ "role":"assistant","content":"Are you interested?"},{"role":"user","content":"No thanks"}]),"No thanks")

    def test_calendar_stable_id_reminders_reschedule_and_own_email(self):
        lead=self.start(); data=self.call("POST","/automation/outcomes",self.body(lead)).json()
        task=self.db.get(CRMTask,data["task"]["id"])
        link=self.db.get(business.MeetingLink,task.id); job=self.db.get(ConnectorJob,link.job_id)
        requests=[]; events={}
        def handle(req):
            requests.append(req)
            if req.method=="GET":return httpx.Response(200,json=events[req.url.path]) if req.url.path in events else httpx.Response(404)
            if req.url.host=="gmail.googleapis.com":return httpx.Response(200,json={"id":"mail-receipt"})
            body=json.loads(req.content); path=req.url.path if req.method=="PUT" else req.url.path+"/"+body["id"]
            events[path]={**body,"htmlLink":"https://calendar.google.com/calendar/event?eid=example"}
            return httpx.Response(200,json=events[path])
        real_client=httpx.AsyncClient
        stored={"account":"owner@example.test","refresh_token":"fake","scope":" ".join(business_scope for business_scope in ("https://www.googleapis.com/auth/calendar.events","https://www.googleapis.com/auth/gmail.send"))}
        with patch.object(business,"google_account",return_value=stored),patch.object(business,"_google_token",AsyncMock(return_value="fake")),patch.object(business.httpx,"AsyncClient",side_effect=lambda **kw:real_client(transport=httpx.MockTransport(handle),**kw)):
            asyncio.run(business.execute_automation_job(self.db,job)); first=json.loads(next(r.content for r in requests if r.method=="POST"))
            self.assertEqual(first["reminders"]["overrides"],[{"method":"popup","minutes":30},{"method":"popup","minutes":0}]);self.assertNotIn("attendees",first)
            updated=self.call("PATCH","/tasks/"+task.id,{"version":task.version,"dueAt":(datetime.now(timezone.utc)+timedelta(days=3)).isoformat()});self.assertEqual(updated.status_code,200,updated.text)
            self.db.refresh(link);job=self.db.get(ConnectorJob,link.job_id);asyncio.run(business.execute_automation_job(self.db,job))
            self.assertEqual(len(events),1)
            self.db.refresh(task)
            self.call("PATCH","/tasks/"+task.id,{"version":task.version,"status":"completed"})
            self.db.refresh(link);asyncio.run(business.execute_automation_job(self.db,self.db.get(ConnectorJob,link.job_id)))
            self.assertEqual(next(iter(events.values()))["reminders"]["overrides"],[])
            email=self.db.query(ConnectorJob).filter_by(provider="crm_email").first();email.target="attacker@example.test"
            self.assertEqual(asyncio.run(business.execute_automation_job(self.db,email)),"mail-receipt")
            raw=json.loads(requests[-1].content)["raw"];decoded=base64.urlsafe_b64decode(raw+"="*((-len(raw))%4)).decode()
            self.assertIn("To: owner@example.test",decoded);self.assertNotIn("attacker@example.test",decoded)
        url=_oauth_url("google_workspace","client","https://test/callback",_encode_state("owner","google_workspace","automation"),"automation")
        self.assertIn("calendar.events",url);self.assertIn("gmail.readonly",url)
        self.assertEqual(_decode_state_payload(_encode_state("owner","google_workspace","automation"),"google_workspace")["purpose"],"automation")

    def test_durable_reminders_and_digest_deduplicate_across_ticks(self):
        lead=self.start();self.call("PUT","/automation/settings",{"digestHour":0})
        self.db.add(CRMTask(id="due-task",owner_user_id="owner",record_id=lead.id,title="Call buyer",kind="task",due_at=time.time()-100,status="open",version=1,notes="Remember buyer",archived=False,created_at=time.time(),updated_at=time.time()));self.db.commit()
        with patch.object(business,"SessionLocal",return_value=self.db):
            asyncio.run(business.automation_tick());asyncio.run(business.automation_tick())
        self.assertEqual(self.db.query(business.BusinessNotice).count(),1)
        self.assertEqual(self.db.query(ConnectorJob).filter_by(provider="crm_email").count(),1)
        notice=self.call("GET","/automation/notices").json()["notices"][0]
        self.assertEqual(self.call("POST","/automation/notices/"+notice["id"]+"/read",owner="other").status_code,404)
        self.assertTrue(self.call("POST","/automation/notices/"+notice["id"]+"/read").json()["read"])

    def test_gmail_reply_uses_client_sender_and_ignores_quoted_pitch(self):
        lead=self.start();self.lead("foreign",owner="other",email="stranger@example.test")
        stored={"account":"owner@example.test","refresh_token":"fake","scope":"https://www.googleapis.com/auth/gmail.readonly"}
        def handle(req):
            if req.url.path.endswith('/messages'):return httpx.Response(200,json={"messages":[{"id":"reply-1"},{"id":"reply-2"}]})
            sender="lead-1@example.test" if req.url.path.endswith('reply-1') else "stranger@example.test"
            text="Yes we are interested.\nOn Monday our salesperson wrote:\nPlease arrange a meeting Sunday 5 pm."
            raw=base64.urlsafe_b64encode(text.encode()).decode().rstrip('=')
            return httpx.Response(200,json={"internalDate":str(int(time.time()*1000)),"payload":{"mimeType":"text/plain","body":{"data":raw},"headers":[{"name":"From","value":sender}]}})
        real_client=httpx.AsyncClient
        with patch.object(business,"google_account",return_value=stored),patch.object(business,"_google_token",AsyncMock(return_value="fake")),patch.object(business.httpx,"AsyncClient",side_effect=lambda **kw:real_client(transport=httpx.MockTransport(handle),**kw)):
            asyncio.run(business.poll_email(self.db,self.owner))
            cursor=self.db.get(business.ReplyCursor,"owner");cursor.next_poll=0;cursor.since=time.time()-60;self.db.commit()
            asyncio.run(business.poll_email(self.db,self.owner))
        self.assertEqual(self.db.query(business.BusinessOutcome).count(),1)
        self.assertEqual(self.db.get(business.BusinessOutcome,lead.id).category,"interested")
        self.assertEqual(self.db.query(CRMTask).count(),0)
        self.assertEqual(self.db.query(CRMActivity).filter_by(kind="business_outcome").count(),1)

    def test_automation_oauth_preserves_outreach_identity_and_requires_scopes(self):
        self.start()
        connectors._save_credential(self.db,"owner","google_workspace",{"account":"sender@example.test","refresh_token":"outreach-only"})
        scopes=" ".join(connectors.AUTOMATION_SCOPES)
        tokens={"access_token":"fake","refresh_token":"reminders-only","scope":scopes}
        account="reminders@example.test"
        def handle(req):
            if req.url.host=="oauth2.googleapis.com":return httpx.Response(200,json=tokens)
            return httpx.Response(200,json={"email":account,"email_verified":True})
        real_client=httpx.AsyncClient
        with patch.object(connectors,"_oauth_keys",return_value=("fake-client","fake-secret")),patch.object(connectors,"_redirect_uri",return_value="https://test/callback"),patch.object(connectors.httpx,"AsyncClient",side_effect=lambda **kw:real_client(transport=httpx.MockTransport(handle),**kw)):
            state=_encode_state("owner","google_workspace","automation")
            asyncio.run(connectors.oauth_callback("google_workspace",code="fake-code",state=state,db=self.db))
            self.assertEqual(business.google_account(self.db,"owner")["account"],"reminders@example.test")
            outreach=connectors._credential(self.db,"owner","google_workspace")
            self.assertEqual(json.loads(connectors.decrypt_secret(outreach))["account"],"sender@example.test")
            tokens["scope"]="https://www.googleapis.com/auth/gmail.send"
            asyncio.run(connectors.oauth_callback("google_workspace",code="fake-code",state=state,db=self.db))
            self.assertIn("calendar.events",business.google_account(self.db,"owner")["scope"])
            tokens["scope"]=scopes;tokens.pop("refresh_token");account="different@example.test"
            asyncio.run(connectors.oauth_callback("google_workspace",code="fake-code",state=state,db=self.db))
            self.assertEqual(business.google_account(self.db,"owner")["account"],"reminders@example.test")


if __name__=="__main__":unittest.main()
