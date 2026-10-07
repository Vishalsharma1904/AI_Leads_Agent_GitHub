"""Small security regression check for connector OAuth state."""
import os
import sys
import unittest
import asyncio
from datetime import datetime, timedelta, timezone
from pathlib import Path

from fastapi import HTTPException
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
os.environ.setdefault("CREDENTIAL_MASTER_KEY", "a" * 64)

from api.auth_sync import Base, UserAccount  # noqa: E402
from api.connectors import PublishRequest, _decode_state, _decode_state_payload, _encode_state, _oauth_url, create_job, list_jobs, cancel_job  # noqa: E402
from api.credentials import ProviderCredential, encrypt_secret  # noqa: E402


class ConnectorStateTest(unittest.TestCase):
    def test_user_provider_and_signature(self):
        state = _encode_state("user-123", "github")
        self.assertEqual(_decode_state(state, "github"), "user-123")
        with self.assertRaises(HTTPException):
            _decode_state(state, "slack")
        with self.assertRaises(HTTPException):
            _decode_state(state[:-1] + ("0" if state[-1] != "0" else "1"), "github")

    def test_gmail_connection_requests_read_and_send_with_signed_purpose(self):
        state = _encode_state("user-123", "google_workspace", "gmail")
        self.assertEqual(_decode_state_payload(state, "google_workspace")["purpose"], "gmail")
        url = _oauth_url("google_workspace", "client-id", "http://localhost:8000/callback", state, "gmail")
        self.assertIn("gmail.readonly", url)
        self.assertIn("gmail.send", url)
        self.assertNotIn("spreadsheets", url)

    def test_scheduled_job_is_tenant_scoped_and_idempotent(self):
        engine = create_engine("sqlite:///:memory:")
        Base.metadata.create_all(engine)
        db = sessionmaker(bind=engine)()
        try:
            owner = UserAccount(id="owner", email="owner@example.test", name="Owner")
            other = UserAccount(id="other", email="other@example.test", name="Other")
            ciphertext, nonce = encrypt_secret('{"token":"test","chat_id":"123"}')
            db.add_all([owner, other, ProviderCredential(owner_user_id=owner.id, provider="telegram",
                                                          ciphertext=ciphertext, nonce=nonce)])
            db.commit()
            request = PublishRequest(provider="telegram", message="Test only", idempotency_key="same-action",
                                     run_at=datetime.now(timezone.utc) + timedelta(hours=1))
            first = asyncio.run(create_job(request, db, owner))
            second = asyncio.run(create_job(request, db, owner))
            self.assertEqual(first["id"], second["id"])
            self.assertEqual(first["status"], "queued")
            self.assertEqual(len(list_jobs(db, owner)["jobs"]), 1)
            self.assertEqual(list_jobs(db, other)["jobs"], [])
            with self.assertRaises(HTTPException):
                cancel_job(first["id"], db, other)
            self.assertEqual(cancel_job(first["id"], db, owner)["status"], "cancelled")
        finally:
            db.close()
            engine.dispose()


if __name__ == "__main__":
    unittest.main()
