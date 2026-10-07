"""Email sender must use the authenticated tenant's verified Google account."""
import asyncio
import base64
import json
import os
import sys
import unittest
from email import message_from_bytes
from pathlib import Path
from unittest.mock import AsyncMock, patch

from fastapi import HTTPException
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
os.environ.setdefault("CREDENTIAL_MASTER_KEY", "a" * 64)

from api.auth_sync import Base, UserAccount  # noqa: E402
from api.credentials import ProviderCredential, encrypt_secret  # noqa: E402
from api.email_sender import SendEmailRequest, connected_email_send, connected_email_status, inbox, inbox_message  # noqa: E402


class FakeResponse:
    is_success = True
    status_code = 200

    def json(self):
        return {"id": "gmail-message-123"}


class FakeClient:
    async def __aenter__(self):
        return self

    async def __aexit__(self, *args):
        return None

    async def post(self, url, headers=None, json=None):
        assert url == "https://gmail.googleapis.com/gmail/v1/users/me/messages/send"
        self.sent = message_from_bytes(base64.urlsafe_b64decode(json["raw"] + "=" * (-len(json["raw"]) % 4)))
        return FakeResponse()


class FakeInboxResponse:
    is_success = True
    status_code = 200

    def __init__(self, payload):
        self.payload = payload

    def json(self):
        return self.payload


class FakeInboxClient(FakeClient):
    async def get(self, url, headers=None, params=None):
        assert headers["Authorization"] == "Bearer token"
        if url.endswith("/messages"):
            return FakeInboxResponse({"messages": [{"id": "msg_12345"}]})
        if url.endswith("/messages/msg_12345"):
            return FakeInboxResponse({"id": "msg_12345", "snippet": "Hello", "labelIds": ["UNREAD"],
                                      "payload": {"mimeType": "text/plain", "headers": [
                                          {"name": "From", "value": "lead@example.com"},
                                          {"name": "Subject", "value": "Staffing"}],
                                          "body": {"data": base64.urlsafe_b64encode(b"Need two guards").decode()}}})
        raise AssertionError(url)


class ConnectedEmailTest(unittest.TestCase):
    def setUp(self):
        self.engine = create_engine("sqlite:///:memory:")
        Base.metadata.create_all(self.engine)
        self.db = sessionmaker(bind=self.engine)()
        self.owner = UserAccount(id="owner", email="app-user@example.test", name="Owner")
        self.other = UserAccount(id="other", email="other@example.test", name="Other")
        ciphertext, nonce = encrypt_secret(json.dumps({
            "refresh_token": "encrypted-at-rest", "account": "verified@example.com",
            "scope": "https://www.googleapis.com/auth/gmail.send"
        }))
        self.db.add_all([self.owner, self.other, ProviderCredential(
            owner_user_id="owner", provider="google_workspace", ciphertext=ciphertext, nonce=nonce
        )])
        self.db.commit()

    def tearDown(self):
        self.db.close()
        self.engine.dispose()

    def test_tenant_status_and_verified_sender(self):
        self.assertEqual(connected_email_status(self.db, self.owner)["senderEmail"], "verified@example.com")
        self.assertFalse(connected_email_status(self.db, self.other)["connected"])
        with self.assertRaises(HTTPException):
            asyncio.run(connected_email_send(SendEmailRequest(
                to="lead@example.com", subject="Hello", htmlBody="<p>Hi</p>"
            ), self.db, self.other))

        client = FakeClient()
        request = SendEmailRequest(to="lead@example.com", subject="Hello", htmlBody="<p>Hi</p>",
                                   senderName="Agency", cc="manager@example.com")
        with patch("api.connectors._google_token", new=AsyncMock(return_value="token")), \
             patch("api.email_sender.httpx.AsyncClient", return_value=client):
            result = asyncio.run(connected_email_send(request, self.db, self.owner))
        self.assertEqual(result["messageId"], "gmail-message-123")
        self.assertEqual(client.sent["From"], "Agency <verified@example.com>")
        self.assertEqual(client.sent["To"], "lead@example.com")

    def test_header_injection_is_rejected(self):
        with self.assertRaises(HTTPException):
            asyncio.run(connected_email_send(SendEmailRequest(
                to="lead@example.com", subject="Hello\r\nBcc: attacker@example.com", htmlBody="Hi"
            ), self.db, self.owner))

    def test_inbox_requires_read_scope_and_owner(self):
        with self.assertRaises(HTTPException):
            asyncio.run(inbox("", 15, self.db, self.owner))
        with self.assertRaises(HTTPException):
            asyncio.run(inbox("", 15, self.db, self.other))
        record = self.db.query(ProviderCredential).filter_by(owner_user_id="owner").one()
        record.ciphertext, record.nonce = encrypt_secret(json.dumps({
            "refresh_token": "encrypted-at-rest", "account": "verified@example.com",
            "scope": "https://www.googleapis.com/auth/gmail.send https://www.googleapis.com/auth/gmail.readonly"
        }))
        self.db.commit()
        self.assertTrue(connected_email_status(self.db, self.owner)["canRead"])
        with patch("api.connectors._google_token", new=AsyncMock(return_value="token")), \
             patch("api.email_sender.httpx.AsyncClient", return_value=FakeInboxClient()):
            listing = asyncio.run(inbox("", 15, self.db, self.owner))
            detail = asyncio.run(inbox_message("msg_12345", self.db, self.owner))
        self.assertEqual(listing["messages"][0]["subject"], "Staffing")
        self.assertEqual(detail["body"], "Need two guards")
        with self.assertRaises(HTTPException):
            asyncio.run(inbox_message("../../other", self.db, self.owner))


if __name__ == "__main__":
    unittest.main()
