"""Tenant-scoped Gmail sending through verified Google OAuth connections."""

import re
import os
import asyncio
import base64
import binascii
import json
import uuid
import logging
from email.message import EmailMessage
from email.utils import formataddr, parseaddr
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from api.auth_sync import UserAccount, get_current_user
from api.auth_sync import get_db
from api.credentials import decrypt_secret
from api.crm import CRMRecord, CRMActivity, record_outreach, _recipient_records
from sqlalchemy.orm import Session
import httpx

router = APIRouter(prefix="/api/email", tags=["email"])


# ── Request / Response models ─────────────────────────────────────────────────

class Attachment(BaseModel):
    name: str = Field(min_length=1, max_length=180)
    type: str = Field(min_length=3, max_length=120)
    data: str = Field(min_length=1, max_length=7_000_000)


class InlineImage(BaseModel):
    cid: str = Field(min_length=1, max_length=120)
    name: str = Field(min_length=1, max_length=180)
    type: str = Field(min_length=3, max_length=120)
    data: str = Field(min_length=1, max_length=2_000_000)


class SendEmailRequest(BaseModel):
    to: str = Field(min_length=3, max_length=4000)
    subject: str = Field(min_length=1, max_length=240)
    htmlBody: str = Field(min_length=1, max_length=250_000)
    cc: Optional[str] = Field(default="", max_length=4000)
    bcc: Optional[str] = Field(default="", max_length=4000)
    replyTo: Optional[str] = Field(default="", max_length=320)
    senderName: Optional[str] = Field(default="", max_length=160)
    attachments: Optional[List[Attachment]] = []
    inlineImages: Optional[List[InlineImage]] = []
    crmRecordId: Optional[str] = Field(default=None, min_length=1, max_length=64)
    idempotencyKey: Optional[str] = Field(default=None, min_length=1, max_length=128)


class ConfigureRequest(BaseModel):
    gmail_address: str = Field(min_length=5, max_length=320)
    gmail_app_password: str = Field(min_length=16, max_length=32)


class SendEmailResponse(BaseModel):
    status: str          # "success" | "error"
    message: str
    to: Optional[str] = None
    quotaNote: Optional[str] = None


class StatusResponse(BaseModel):
    status: str
    configured: bool
    senderEmail: Optional[str] = None
    message: str


def _mailbox(value: str) -> str:
    name, address = parseaddr(value.strip())
    if name or address != value.strip() or not re.fullmatch(r"[^@\s<>;,]+@[^@\s<>;,]+\.[^@\s<>;,]+", address):
        raise HTTPException(status_code=422, detail="Enter a valid single email address")
    return address


def _mailbox_list(value: str) -> list[str]:
    return [_mailbox(item) for item in value.split(",") if item.strip()]


@router.get("/connected-status")
def connected_email_status(db: Session = Depends(get_db), user: UserAccount = Depends(get_current_user)):
    """Only a Google account authorized by this tenant is a usable sender."""
    from api.connectors import _credential
    provider_configured = bool(os.getenv("GOOGLE_CLIENT_ID") and os.getenv("GOOGLE_CLIENT_SECRET"))
    record = _credential(db, user.id, "google_workspace")
    if not record:
        return {"connected": False, "configured": provider_configured, "canRead": False,
                "senderEmail": "", "updatedAt": 0}
    try:
        stored = json.loads(decrypt_secret(record))
    except (ValueError, KeyError):
        return {"connected": False, "configured": provider_configured, "canRead": False,
                "senderEmail": "", "updatedAt": 0}
    scope = "https://www.googleapis.com/auth/gmail.send"
    account = stored.get("account", "")
    connected = bool(stored.get("refresh_token") and account and scope in stored.get("scope", "").split())
    can_read = "https://www.googleapis.com/auth/gmail.readonly" in stored.get("scope", "").split()
    return {"connected": connected, "configured": provider_configured,
            "canRead": bool(connected and can_read), "senderEmail": account if connected else "",
            "updatedAt": record.updated_at or 0}


def _read_credential(db: Session, user: UserAccount) -> dict:
    from api.connectors import _credential
    record = _credential(db, user.id, "google_workspace")
    if not record:
        raise HTTPException(status_code=409, detail="Connect your Google account first")
    try:
        stored = json.loads(decrypt_secret(record))
    except (ValueError, KeyError):
        raise HTTPException(status_code=409, detail="Reconnect your Google account") from None
    if not stored.get("refresh_token") or not stored.get("account") or \
            "https://www.googleapis.com/auth/gmail.readonly" not in stored.get("scope", "").split():
        raise HTTPException(status_code=409, detail="Gmail read permission is missing; reconnect Google")
    return stored


async def _gmail_get(client: httpx.AsyncClient, token: str, path: str, **params) -> dict:
    try:
        response = await client.get(f"https://gmail.googleapis.com/gmail/v1/users/me/{path}",
                                    headers={"Authorization": f"Bearer {token}"}, params=params)
    except httpx.HTTPError:
        raise HTTPException(status_code=502, detail="Gmail is unavailable; try again") from None
    if response.status_code in {401, 403}:
        raise HTTPException(status_code=409, detail="Google permission expired; reconnect your account")
    if not response.is_success:
        raise HTTPException(status_code=502, detail="Gmail could not load this message")
    return response.json()


def _message_summary(item: dict) -> dict:
    headers = {header.get("name", "").lower(): header.get("value", "")
               for header in item.get("payload", {}).get("headers", [])}
    return {"id": item.get("id", ""), "threadId": item.get("threadId", ""),
            "from": headers.get("from", ""), "to": headers.get("to", ""),
            "subject": headers.get("subject", "(no subject)"), "date": headers.get("date", ""),
            "snippet": item.get("snippet", ""), "unread": "UNREAD" in item.get("labelIds", [])}


@router.get("/inbox")
async def inbox(q: str = "", limit: int = 15, db: Session = Depends(get_db),
                user: UserAccount = Depends(get_current_user)):
    """Read a bounded page on demand; do not store mailbox content on the server."""
    if len(q) > 200 or not 1 <= limit <= 25:
        raise HTTPException(status_code=422, detail="Search or page size is invalid")
    stored = _read_credential(db, user)
    from api.connectors import _google_token
    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(25.0, connect=5.0)) as client:
            token = await _google_token(stored, client)
            listing = await _gmail_get(client, token, "messages", q=q or "in:inbox", maxResults=limit)
            semaphore = asyncio.Semaphore(5)

            async def load_metadata(ref):
                message_id = ref.get("id", "")
                if not re.fullmatch(r"[A-Za-z0-9_-]{5,128}", message_id):
                    return None
                async with semaphore:
                    item = await _gmail_get(client, token, f"messages/{message_id}", format="metadata",
                                            metadataHeaders=["From", "To", "Subject", "Date"])
                return _message_summary(item)

            messages = [item for item in await asyncio.gather(*(
                load_metadata(ref) for ref in listing.get("messages", [])[:limit]
            )) if item]
    except httpx.HTTPError:
        raise HTTPException(status_code=502, detail="Google sign-in could not be refreshed") from None
    return {"account": stored["account"], "messages": messages}


def _plain_part(payload: dict) -> str:
    if payload.get("mimeType") == "text/plain":
        data = payload.get("body", {}).get("data", "")
        if data:
            try:
                return base64.urlsafe_b64decode(data + "=" * (-len(data) % 4)).decode("utf-8", "replace")
            except (ValueError, binascii.Error):
                return ""
    for part in payload.get("parts", []):
        found = _plain_part(part)
        if found:
            return found
    return ""


@router.get("/inbox/{message_id}")
async def inbox_message(message_id: str, db: Session = Depends(get_db),
                        user: UserAccount = Depends(get_current_user)):
    if not re.fullmatch(r"[A-Za-z0-9_-]{5,128}", message_id):
        raise HTTPException(status_code=422, detail="Invalid message ID")
    stored = _read_credential(db, user)
    from api.connectors import _google_token
    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(25.0, connect=5.0)) as client:
            token = await _google_token(stored, client)
            item = await _gmail_get(client, token, f"messages/{message_id}", format="full")
    except httpx.HTTPError:
        raise HTTPException(status_code=502, detail="Google sign-in could not be refreshed") from None
    return {**_message_summary(item), "body": _plain_part(item.get("payload", {}))[:30000]}


@router.post("/connected-send")
async def connected_email_send(req: SendEmailRequest, db: Session = Depends(get_db),
                               user: UserAccount = Depends(get_current_user)):
    """Send as the tenant's verified Google OAuth identity, never a typed alias."""
    from api.connectors import _credential, _google_token
    record = _credential(db, user.id, "google_workspace")
    if not record:
        raise HTTPException(status_code=409, detail="Connect your Google account first")
    try:
        stored = json.loads(decrypt_secret(record))
    except (ValueError, KeyError):
        raise HTTPException(status_code=409, detail="Reconnect your Google account") from None
    if "https://www.googleapis.com/auth/gmail.send" not in stored.get("scope", "").split():
        raise HTTPException(status_code=409, detail="Gmail send permission is missing; reconnect Google")
    if not stored.get("account") or not stored.get("refresh_token"):
        raise HTTPException(status_code=409, detail="Google sender identity is incomplete; reconnect Google")
    sender = _mailbox(stored.get("account", ""))
    to = _mailbox(req.to)
    cc = _mailbox_list(req.cc or "")
    bcc = _mailbox_list(req.bcc or "")
    reply_to = _mailbox(req.replyTo) if req.replyTo else ""
    if "\n" in req.subject or "\r" in req.subject or not req.subject.strip():
        raise HTTPException(status_code=422, detail="Subject must be one line")
    if "\n" in (req.senderName or "") or "\r" in (req.senderName or ""):
        raise HTTPException(status_code=422, detail="Invalid sender name")
    message = EmailMessage()
    message["From"] = formataddr((req.senderName or "", sender))
    message["To"] = to
    message["Subject"] = req.subject.strip()
    if cc:
        message["Cc"] = ", ".join(cc)
    if bcc:
        message["Bcc"] = ", ".join(bcc)
    if reply_to:
        message["Reply-To"] = reply_to
    plain = re.sub(r"<[^>]+>", " ", req.htmlBody).strip()
    message.set_content(plain)
    message.add_alternative(req.htmlBody, subtype="html")
    attachments = req.attachments or []
    if sum(len(item.data) for item in attachments) > 7_000_000:
        raise HTTPException(status_code=413, detail="Attachments exceed the 5 MB limit")
    for item in attachments:
        try:
            data = base64.b64decode(item.data, validate=True)
        except (ValueError, binascii.Error):
            raise HTTPException(status_code=422, detail="Invalid attachment") from None
        maintype, _, subtype = item.type.partition("/")
        if not subtype:
            maintype, subtype = "application", "octet-stream"
        message.add_attachment(data, maintype=maintype, subtype=subtype, filename=item.name)
    for image in req.inlineImages or []:
        try:
            data = base64.b64decode(image.data, validate=True)
        except (ValueError, binascii.Error):
            raise HTTPException(status_code=422, detail="Invalid inline image") from None
        if not image.type.startswith("image/") or not re.fullmatch(r"[A-Za-z0-9_-]+", image.cid):
            raise HTTPException(status_code=422, detail="Invalid inline image")
        message.get_payload()[1].add_related(data, maintype="image", subtype=image.type.split("/", 1)[1], cid=f"<{image.cid}>")
    raw = base64.urlsafe_b64encode(message.as_bytes()).decode().rstrip("=")
    if req.crmRecordId:
        target = db.query(CRMRecord).filter_by(id=req.crmRecordId, owner_user_id=user.id).first()
        if not target:
            raise HTTPException(status_code=404, detail="CRM record not found")
        if json.loads(target.profile or "{}").get("emailOptOut"):
            raise HTTPException(status_code=409, detail="This lead opted out of email outreach")
    known_recipients = _recipient_records(db, user.id, to)
    if any(json.loads(item.profile or "{}").get("emailOptOut") for item in known_recipients):
        raise HTTPException(status_code=409, detail="This recipient opted out of email outreach")
    if req.crmRecordId and not any(item.id == req.crmRecordId for item in known_recipients):
        raise HTTPException(status_code=422, detail="Recipient must match the selected CRM record contact")
    key = req.idempotencyKey or f"email_{uuid.uuid4().hex}"
    existing = db.query(CRMActivity).filter_by(owner_user_id=user.id, idempotency_key=key).first()
    if existing:
        if existing.recipient != to or (req.crmRecordId and existing.record_id != req.crmRecordId) or existing.channel != "email":
            raise HTTPException(status_code=409, detail="This send key belongs to a different recipient")
        if existing.outcome == "sent" and existing.provider_id:
            return {"status": "success", "messageId": existing.provider_id,
                    "senderEmail": sender, "to": to, "idempotent": True}
        raise HTTPException(status_code=409, detail="This send was already attempted; its status may be unknown. Check Gmail Sent before retrying")
    # Durable pending evidence prevents a lost provider response from causing a resend.
    record_outreach(db, user.id, record_id=req.crmRecordId, recipient=to,
                    outcome="unknown", evidence="pending", note="Gmail send awaiting confirmation",
                    idempotency_key=key)
    db.commit()
    send_started = False

    def save_outcome(outcome, provider_id=None, note=None):
        try:
            record_outreach(db, user.id, record_id=req.crmRecordId, recipient=to,
                            outcome=outcome, evidence="provider" if outcome == "sent" else "server",
                            provider_id=provider_id, note=note, idempotency_key=key)
            db.commit()
            return None
        except Exception:
            db.rollback()
            logging.getLogger(__name__).exception("Gmail outcome ledger could not be updated")
            return "Gmail accepted the email, but CRM confirmation could not be saved. Do not resend; check Gmail Sent."

    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(35.0, connect=5.0)) as client:
            token = await _google_token(stored, client)
            send_started = True
            response = await client.post("https://gmail.googleapis.com/gmail/v1/users/me/messages/send",
                                         headers={"Authorization": f"Bearer {token}"}, json={"raw": raw})
        if response.status_code == 429:
            raise HTTPException(status_code=429, detail="Gmail rate or daily limit reached; stop this batch")
        if response.status_code in {401, 403}:
            raise HTTPException(status_code=409, detail="Google permission expired; reconnect before sending")
        if not response.is_success:
            raise HTTPException(status_code=502, detail="Gmail rejected the send; check recipient and account")
        try:
            provider_reply = response.json()
            provider_id = provider_reply.get("id", "") if isinstance(provider_reply, dict) else ""
        except (ValueError, TypeError):
            provider_id = ""
        if not provider_id:
            raise HTTPException(status_code=502, detail="Gmail send status is unknown; check Sent before retrying")
        warning = save_outcome("sent", provider_id=provider_id, note="Accepted by Gmail")
        return {"status": "success", "messageId": provider_id, "senderEmail": sender, "to": to,
                "ledgerWarning": warning}
    except HTTPException as exc:
        save_outcome("unknown" if "unknown" in str(exc.detail).lower() else "failed", note=str(exc.detail))
        raise
    except httpx.HTTPError:
        save_outcome("unknown" if send_started else "failed", note="Gmail response unavailable" if send_started else "Google sign-in could not be refreshed")
        raise HTTPException(status_code=502, detail="Gmail send status is unknown; check Sent before retrying" if send_started else "Google sign-in could not be refreshed; no email was sent") from None


# ── Helper ────────────────────────────────────────────────────────────────────

@router.get("/status", response_model=StatusResponse)
async def email_status(db: Session = Depends(get_db), user: UserAccount = Depends(get_current_user)):
    """Compatibility status route; process-wide SMTP is never a sender."""
    connected = connected_email_status(db, user)
    if connected["connected"]:
        return StatusResponse(
            status="ok",
            configured=True,
            senderEmail=connected["senderEmail"],
            message=f"Google account connected: {connected['senderEmail']}"
        )
    return StatusResponse(
        status="not_configured",
        configured=False,
        message="Connect a Google account with Gmail send permission"
    )


@router.post("/configure")
async def configure_email(req: ConfigureRequest, user: UserAccount = Depends(get_current_user)):
    # A browser user must never be able to overwrite the process-wide mail
    # credentials or write backend/.env. Configure mail through deployment
    # administration or a per-user encrypted credential vault instead.
    raise HTTPException(status_code=403, detail="Email credentials are managed by the backend administrator")


@router.post("/send")
async def send_email(req: SendEmailRequest, db: Session = Depends(get_db),
                     user: UserAccount = Depends(get_current_user)):
    """Compatibility route with the same tenant-scoped OAuth sender checks."""
    return await connected_email_send(req, db, user)
