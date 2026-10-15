"""Pitch documents: load them once, tick the ones that belong in the pitch,
and let the calling agent send them on WhatsApp while it is still on the call.

The shape of this is set by two outside facts.

First, Meta will not deliver a free-form WhatsApp message to someone who has
not written to the business, and a phone call does not open that window. Every
document therefore leaves as an approved template with a document header.

Second, ElevenLabs calls a webhook tool as a plain GET with no Authorization
header of its own. The tenant is identified by an HMAC token inside the URL.
That token is a bearer credential, so it is scoped as narrowly as the feature
allows: it can only send the documents the owner already ticked, only to a
well-formed phone number, only a bounded number of times an hour, and it reads
nothing back. The worst a leaked token can do is spend the owner's own
WhatsApp allowance, which the rate limit then caps.
"""
from __future__ import annotations

import base64
import hashlib
import hmac
import json
import os
import re
import secrets
import time
from pathlib import Path

from fastapi import APIRouter, BackgroundTasks, Depends, File, Form, HTTPException, Query, Request, UploadFile
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import Boolean, Column, Float, Integer, String, Text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, sessionmaker

from api.auth_sync import AUTO_CREATE_SCHEMA, Base, UserAccount, engine, get_current_user, get_db
from api.credentials import _master_key
from services.whatsapp import cloud

router = APIRouter(prefix="/api/v1/pitch", tags=["pitch"])

E164_RE = re.compile(r"^\+[1-9]\d{7,14}$")
ID_RE = re.compile(r"^[a-f0-9]{16}$")
DOC_DIR = Path(os.getenv("PITCH_DOC_DIR", Path(__file__).resolve().parent.parent / "storage" / "pitch"))
MAX_BYTES = int(os.getenv("PITCH_DOC_MAX_BYTES", 20 * 1024 * 1024))
MAX_DOCS = 40
# One tenant gets at most this many document sends per rolling hour. A leaked
# webhook token cannot run up a bill past this.
SENDS_PER_HOUR = int(os.getenv("PITCH_SENDS_PER_HOUR", 60))
MAX_IN_PITCH = 5
ALLOWED_MIME = {
    "application/pdf": ".pdf",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document": ".docx",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": ".xlsx",
    "application/vnd.openxmlformats-officedocument.presentationml.presentation": ".pptx",
    "image/png": ".png",
    "image/jpeg": ".jpg",
}


class PitchDocument(Base):
    __tablename__ = "pitch_documents"
    id = Column(String(16), primary_key=True)
    owner_user_id = Column(String(64), index=True, nullable=False)
    name = Column(String(160), nullable=False, default="")
    filename = Column(String(200), nullable=False, default="")
    mime = Column(String(120), nullable=False, default="")
    size = Column(Integer, nullable=False, default=0)
    path = Column(String(500), nullable=False, default="")
    in_pitch = Column(Boolean, nullable=False, default=False)
    position = Column(Integer, nullable=False, default=0)
    media_id = Column(String(160), nullable=False, default="")
    media_expires = Column(Float, nullable=False, default=0)
    created_at = Column(Float, nullable=False, default=time.time)


class PitchSend(Base):
    """One row per (conversation, number). Also the idempotency key: a tool the
    agent calls twice in one conversation must not send the brochure twice."""

    __tablename__ = "pitch_sends"
    id = Column(String(64), primary_key=True)
    owner_user_id = Column(String(64), index=True, nullable=False)
    phone = Column(String(24), nullable=False, default="")
    person = Column(String(120), nullable=False, default="")
    conversation_id = Column(String(160), nullable=False, default="")
    documents = Column(Text, nullable=False, default="[]")
    status = Column(String(16), nullable=False, default="queued")
    detail = Column(Text, nullable=False, default="")
    created_at = Column(Float, nullable=False, default=time.time, index=True)


class PitchSetting(Base):
    __tablename__ = "pitch_settings"
    owner_user_id = Column(String(64), primary_key=True)
    data = Column(Text, nullable=False, default="{}")
    updated_at = Column(Float, nullable=False, default=time.time)


if AUTO_CREATE_SCHEMA:
    Base.metadata.create_all(bind=engine)

SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False)


# -- tenant token -----------------------------------------------------------
def tenant_token(user_id: str) -> str:
    """A URL-safe token that names the tenant and proves we minted it."""
    body = base64.urlsafe_b64encode(user_id.encode()).decode().rstrip("=")
    signature = hmac.new(_master_key(), body.encode(), hashlib.sha256).digest()
    return f"{body}.{base64.urlsafe_b64encode(signature[:24]).decode().rstrip('=')}"


def tenant_from_token(token: str) -> str:
    """Return the user id, or '' for anything that does not verify."""
    if not isinstance(token, str) or token.count(".") != 1 or len(token) > 400:
        return ""
    body, _, _signature = token.partition(".")
    try:
        user_id = base64.urlsafe_b64decode(body + "=" * (-len(body) % 4)).decode()
    except Exception:
        return ""
    # compare_digest, not ==, so a wrong token cannot be guessed a byte at a time.
    if not hmac.compare_digest(tenant_token(user_id), token):
        return ""
    return user_id


def _settings(db: Session, owner: str) -> dict:
    row = db.query(PitchSetting).filter_by(owner_user_id=owner).first()
    try:
        return json.loads(row.data) if row else {}
    except ValueError:
        return {}


class SettingsRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    phone_number_id: str = Field(default="", max_length=64, pattern=r"^[0-9]*$")
    template: str = Field(default="", max_length=120, pattern=r"^[a-z0-9_]*$")
    language: str = Field(default="en", max_length=12, pattern=r"^[A-Za-z_]{2,12}$")
    enabled: bool = True


class DocumentPatch(BaseModel):
    model_config = ConfigDict(extra="forbid")
    name: str | None = Field(default=None, min_length=1, max_length=160)
    in_pitch: bool | None = None


# -- document library -------------------------------------------------------
def _public(row: PitchDocument) -> dict:
    return {"id": row.id, "name": row.name, "filename": row.filename, "mime": row.mime,
            "size": row.size, "in_pitch": row.in_pitch, "created_at": row.created_at}


@router.get("/documents")
def list_documents(db: Session = Depends(get_db), user: UserAccount = Depends(get_current_user)):
    rows = (db.query(PitchDocument).filter_by(owner_user_id=user.id)
            .order_by(PitchDocument.position, PitchDocument.created_at).all())
    base = (os.getenv("PUBLIC_BASE_URL") or "").rstrip("/")
    return {"documents": [_public(row) for row in rows],
            "settings": _settings(db, user.id),
            "webhook_url": f"{base}/api/v1/pitch/send?t={tenant_token(user.id)}" if base else ""}


@router.post("/documents")
async def add_document(file: UploadFile = File(...), name: str = Form(default=""),
                       db: Session = Depends(get_db), user: UserAccount = Depends(get_current_user)):
    if db.query(PitchDocument).filter_by(owner_user_id=user.id).count() >= MAX_DOCS:
        raise HTTPException(409, f"You can keep up to {MAX_DOCS} documents. Delete one first.")
    mime = (file.content_type or "").split(";")[0].strip().lower()
    if mime not in ALLOWED_MIME:
        raise HTTPException(415, "WhatsApp accepts PDF, Word, Excel, PowerPoint, PNG and JPEG here.")
    # Read with a ceiling rather than trusting content-length, which a client sets.
    payload = await file.read(MAX_BYTES + 1)
    if len(payload) > MAX_BYTES:
        raise HTTPException(413, f"Keep documents under {MAX_BYTES // (1024 * 1024)} MB.")
    if not payload:
        raise HTTPException(422, "That file is empty.")
    document_id = secrets.token_hex(8)
    folder = DOC_DIR / hashlib.sha256(user.id.encode()).hexdigest()[:16]
    folder.mkdir(parents=True, exist_ok=True)
    # The stored name is ours, never the client's: an uploaded filename is
    # attacker-controlled and must not decide where the bytes land.
    target = folder / f"{document_id}{ALLOWED_MIME[mime]}"
    target.write_bytes(payload)
    safe_name = re.sub(r"[\\/\r\n\t]", " ", (name or file.filename or "Document")).strip()[:160] or "Document"
    shown = re.sub(r"[^A-Za-z0-9 ._-]", "", (file.filename or safe_name))[:200] or f"document{ALLOWED_MIME[mime]}"
    row = PitchDocument(id=document_id, owner_user_id=user.id, name=safe_name, filename=shown,
                        mime=mime, size=len(payload), path=str(target), created_at=time.time())
    db.add(row)
    db.commit()
    return _public(row)


def _owned_document(db: Session, owner: str, document_id: str) -> PitchDocument:
    if not ID_RE.fullmatch(str(document_id or "")):
        raise HTTPException(404, "Document not found")
    row = db.query(PitchDocument).filter_by(id=document_id, owner_user_id=owner).first()
    if not row:
        raise HTTPException(404, "Document not found")
    return row


@router.patch("/documents/{document_id}")
def update_document(document_id: str, patch: DocumentPatch,
                    db: Session = Depends(get_db), user: UserAccount = Depends(get_current_user)):
    row = _owned_document(db, user.id, document_id)
    if patch.in_pitch is True and not row.in_pitch:
        picked = db.query(PitchDocument).filter_by(owner_user_id=user.id, in_pitch=True).count()
        if picked >= MAX_IN_PITCH:
            raise HTTPException(409, f"Pick at most {MAX_IN_PITCH} documents for the pitch.")
    if patch.in_pitch is not None:
        row.in_pitch = patch.in_pitch
    if patch.name is not None:
        row.name = re.sub(r"[\\/\r\n\t]", " ", patch.name).strip()[:160] or row.name
    db.commit()
    return _public(row)


@router.delete("/documents/{document_id}")
def delete_document(document_id: str, db: Session = Depends(get_db), user: UserAccount = Depends(get_current_user)):
    row = _owned_document(db, user.id, document_id)
    stored = Path(row.path)
    db.delete(row)
    db.commit()
    try:
        if stored.is_file() and str(stored.resolve()).startswith(str(DOC_DIR.resolve())):
            stored.unlink()
    except OSError:
        pass            # the row is gone; a stray file is not worth a 500
    return {"deleted": document_id}


@router.put("/settings")
def save_settings(req: SettingsRequest, db: Session = Depends(get_db), user: UserAccount = Depends(get_current_user)):
    row = db.query(PitchSetting).filter_by(owner_user_id=user.id).first() or PitchSetting(owner_user_id=user.id)
    row.data = json.dumps(req.model_dump())
    row.updated_at = time.time()
    db.add(row)
    db.commit()
    return req.model_dump()


@router.get("/sends")
def recent_sends(db: Session = Depends(get_db), user: UserAccount = Depends(get_current_user)):
    rows = (db.query(PitchSend).filter_by(owner_user_id=user.id)
            .order_by(PitchSend.created_at.desc()).limit(50).all())
    return {"sends": [{"phone": row.phone, "person": row.person, "status": row.status,
                       "detail": row.detail, "documents": json.loads(row.documents),
                       "at": row.created_at} for row in rows]}


# -- the webhook the agent calls mid-call -----------------------------------
def _say(text: str) -> dict:
    """Everything this endpoint returns is read aloud by the agent, so it is
    always 200 with a sentence. A 4xx would leave the agent with nothing to
    say, and the caller would hear dead air in the middle of a sales call."""
    return {"ok": True, "message": text}


@router.get("/send")
def send_pitch(background: BackgroundTasks, request: Request,
               t: str = Query(default="", max_length=400),
               phone: str = Query(default="", max_length=24),
               name: str = Query(default="", max_length=120),
               conversation_id: str = Query(default="", max_length=160),
               opt_in: bool = Query(default=False),
               db: Session = Depends(get_db)):
    owner = tenant_from_token(t)
    if not owner:
        # No hint about why. An unsigned caller learns nothing from this.
        raise HTTPException(403, "Not authorised")
    if not opt_in:
        return _say("WhatsApp recipient opt-in has not been confirmed, so I have not sent anything.")
    from api.whatsapp import binding
    try:
        sender, _ = binding(db, owner)
    except HTTPException:
        return _say("Connect and verify this account's WhatsApp business number first.")
    number = re.sub(r"[\s()-]", "", phone or "")
    if number and not number.startswith("+"):
        number = "+" + number
    if not E164_RE.fullmatch(number):
        return _say("I could not read that number, so I have not sent anything.")

    settings = _settings(db, owner)
    if settings.get("phone_number_id") != sender.phone_number_id:
        return _say("The pitch sender does not match this account's verified WhatsApp number.")
    if not settings.get("enabled", True) or not settings.get("phone_number_id") or not settings.get("template"):
        return _say("Document sending is not switched on for this account yet.")

    documents = (db.query(PitchDocument).filter_by(owner_user_id=owner, in_pitch=True)
                 .order_by(PitchDocument.position, PitchDocument.created_at).all())
    if not documents:
        return _say("No documents are selected for the pitch, so I have not sent anything.")

    window = time.time() - 3600
    if db.query(PitchSend).filter(PitchSend.owner_user_id == owner,
                                  PitchSend.created_at > window).count() >= SENDS_PER_HOUR:
        return _say("I have hit this hour's sending limit, so no new document request was queued.")

    # Idempotency: the agent may well call its own tool twice in one call.
    scope = conversation_id or (request.client.host if request.client else "")
    key = hashlib.sha256(f"{owner}|{scope}|{number}".encode()).hexdigest()
    if db.query(PitchSend).filter_by(id=key).first():
        return _say("That document request was already recorded. Check its delivery status in the app.")

    person = re.sub(r"[\r\n\t]", " ", name or "").strip()[:120]
    db.add(PitchSend(id=key, owner_user_id=owner, phone=number, person=person,
                     conversation_id=conversation_id[:160], status="queued",
                     documents=json.dumps([row.id for row in documents]), created_at=time.time()))
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        return _say("That document request was already recorded. Check its delivery status in the app.")
    # The agent is mid-sentence and its tool call times out in seconds, so the
    # uploading and sending happens after this answer, not before it.
    background.add_task(_deliver, key, owner)
    count = len(documents)
    return _say(f"I queued {count} document{'s' if count > 1 else ''} for WhatsApp. Sending and delivery are not confirmed yet.")


async def _deliver(send_id: str, owner: str) -> None:
    """Upload (or reuse) each document's media id and send one template each."""
    db = SessionLocal()
    try:
        claimed = db.query(PitchSend).filter_by(id=send_id, owner_user_id=owner, status="queued").update(
            {PitchSend.status: "processing"}, synchronize_session=False)
        db.commit()
        if not claimed:
            return
        record = db.query(PitchSend).filter_by(id=send_id, owner_user_id=owner).one()
        account = db.query(UserAccount).filter_by(id=owner).first()
        settings = _settings(db, owner)
        from api.whatsapp import binding, reserve
        try:
            sender, token = binding(db, owner)
        except HTTPException:
            sender, token = None, ""
        if sender and settings.get("phone_number_id") != sender.phone_number_id:
            token = ""
        if not token or not account:
            record.status = "failed"
            record.detail = "Connect and verify this account's WhatsApp business number."
            db.commit()
            return
        wanted = json.loads(record.documents)
        rows = db.query(PitchDocument).filter(PitchDocument.owner_user_id == owner,
                                              PitchDocument.id.in_(wanted)).all()
        sent, failures, uncertain = 0, [], False
        for row in rows:
            try:
                if not row.media_id or row.media_expires < time.time():
                    row.media_id = await cloud.upload_media(token, settings["phone_number_id"], row.path, row.mime)
                    row.media_expires = time.time() + cloud.MEDIA_TTL_SECONDS
                    db.commit()
                message, fresh = reserve(db, account, f"pitch:{send_id}:{row.id}",
                    hashlib.sha256(f"{record.phone}|{settings['template']}|{row.id}".encode()).hexdigest(),
                    sender.phone_number_id, record.phone, settings["template"])
                if not fresh:
                    failures.append(f"{row.name}: request already recorded; check its status")
                    continue
                try:
                    message_id = await cloud.send_document_template(
                        token, sender.phone_number_id, record.phone,
                        template=settings["template"], language=settings.get("language", "en"),
                        media_id=row.media_id, filename=row.filename,
                        body_params=[record.person or "there", row.name],
                    )
                    message.provider_message_id = message_id
                    message.status = "accepted" if message_id else "unknown"
                    uncertain = uncertain or not message_id
                    message.detail = "Meta acceptance is not delivery confirmation."
                    db.commit()
                except Exception:
                    uncertain = True
                    message.status = "unknown"
                    message.detail = "Send outcome unknown; do not automatically resend."
                    db.commit()
                    raise
                if message_id:
                    sent += 1
                else:
                    failures.append(f"{row.name}: outcome unknown")
            except cloud.WhatsAppError as error:
                # A rejected media id is the one failure worth clearing: the id
                # may have lapsed on Meta's side before our own expiry.
                if not error.retryable and row.media_id:
                    row.media_id, row.media_expires = "", 0
                    db.commit()
                failures.append(f"{row.name}: {error}")
            except Exception as error:                  # noqa: BLE001 - audit it, never kill the worker
                failures.append(f"{row.name}: {error}")
        record.status = "accepted" if sent and not failures else "partial" if sent else "unknown" if uncertain else "failed"
        record.detail = " | ".join(failures)[:2000]
        db.commit()
    finally:
        db.close()
