"""Tenant-owned Meta senders, durable reservations, signed delivery receipts."""
import hashlib
import hmac
import json
import os
import re
import time
import uuid

import httpx
from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import PlainTextResponse
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import Column, Float, String, Text, UniqueConstraint
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from api.auth_sync import AUTO_CREATE_SCHEMA, Base, UserAccount, engine, get_current_user, get_db
from api.credentials import ProviderCredential, decrypt_secret, encrypt_secret
from api.limits import TenantLimits, _row, snapshot, today_key
from api.connectors import _oauth_keys
from services.whatsapp import cloud

router = APIRouter(prefix="/api/v1/whatsapp", tags=["whatsapp"])


class WhatsAppConnection(Base):
    __tablename__ = "whatsapp_connections"
    owner_user_id = Column(String(64), primary_key=True)
    waba_id = Column(String(64), unique=True, nullable=False)
    phone_number_id = Column(String(64), unique=True, nullable=False)
    display_phone_number = Column(String(64), default="")
    onboarding_status = Column(String(32), default="cloud_ready")
    sync_requests = Column(Text, default="{}")
    updated_at = Column(Float, default=time.time)


class WhatsAppMessage(Base):
    __tablename__ = "whatsapp_messages"
    __table_args__ = (UniqueConstraint("owner_user_id", "idempotency_key", name="uq_whatsapp_request"),)
    id = Column(String(36), primary_key=True)
    owner_user_id = Column(String(64), index=True, nullable=False)
    idempotency_key = Column(String(128), nullable=False)
    request_hash = Column(String(64), nullable=False)
    phone_number_id = Column(String(64), nullable=False)
    to = Column(String(24), nullable=False)
    template = Column(String(120), nullable=False)
    status = Column(String(24), default="reserved", nullable=False)
    provider_message_id = Column(String(256), index=True, default="")
    detail = Column(Text, default="")
    created_at = Column(Float, default=time.time)
    updated_at = Column(Float, default=time.time)


class WhatsAppReceipt(Base):
    __tablename__ = "whatsapp_receipts"
    id = Column(String(64), primary_key=True)
    owner_user_id = Column(String(64), index=True, nullable=False)
    field = Column(String(64), nullable=False)
    phone_number_id = Column(String(64), default="")
    provider_message_id = Column(String(256), index=True, default="")
    status = Column(String(24), default="")
    metadata_json = Column(Text, default="{}")
    created_at = Column(Float, default=time.time)


if AUTO_CREATE_SCHEMA:
    Base.metadata.create_all(bind=engine)


class ConnectionRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    access_token: str = Field(min_length=10, max_length=4096)
    waba_id: str = Field(pattern=r"^[0-9]{1,64}$")
    phone_number_id: str = Field(pattern=r"^[0-9]{1,64}$")
    registration_pin: str | None = Field(default=None, pattern=r"^[0-9]{6}$")


class ExchangeRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    code: str = Field(min_length=1, max_length=4096)
    waba_id: str = Field(pattern=r"^[0-9]{1,64}$")
    phone_number_id: str = Field(pattern=r"^[0-9]{1,64}$")
    registration_pin: str | None = Field(default=None, pattern=r"^[0-9]{6}$")


class SendRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    to: str = Field(pattern=r"^\+?[1-9][0-9]{7,14}$")
    template: str = Field(pattern=r"^[a-z0-9_]{1,120}$")
    language: str = Field(pattern=r"^[A-Za-z_]{2,12}$")
    body_params: list[str] = Field(default_factory=list, max_length=30)
    idempotency_key: str = Field(min_length=8, max_length=128)
    opt_in: bool


def binding(db, owner):
    row = db.query(WhatsAppConnection).filter_by(owner_user_id=owner).first()
    credential = db.query(ProviderCredential).filter_by(owner_user_id=owner, provider="whatsapp_cloud").first()
    if not row or not credential:
        raise HTTPException(409, "Connect this account's WhatsApp business number first.")
    if row.onboarding_status in {"sync_pending", "sync_attention"}:
        raise HTTPException(409, "WhatsApp Business App synchronization needs operator attention.")
    return row, decrypt_secret(credential)


def public_message(row):
    return {key: getattr(row, key) for key in ("id", "to", "template", "status", "provider_message_id", "detail", "created_at")}


@router.get("/connection")
def connection(db: Session = Depends(get_db), user: UserAccount = Depends(get_current_user)):
    row = db.query(WhatsAppConnection).filter_by(owner_user_id=user.id).first()
    credential = db.query(ProviderCredential).filter_by(owner_user_id=user.id, provider="whatsapp_cloud").first()
    app_id = os.getenv("META_APP_ID", "")
    config_id = os.getenv("WHATSAPP_EMBEDDED_CONFIG_ID", "")
    return {"connected": bool(row and credential), "waba_id": row.waba_id if row else "",
        "phone_number_id": row.phone_number_id if row else "",
        "display_phone_number": row.display_phone_number if row else "",
        "onboarding_status": row.onboarding_status if row else "disconnected",
        "quota": snapshot(db, user)["meters"]["whatsapp"],
        "embedded_signup": {"app_id": app_id, "config_id": config_id,
                            "graph_version": cloud.API_VERSION,
                            "enabled": bool(app_id and config_id and os.getenv("META_APP_SECRET"))}}


async def save_connection(req, db, user):
    app_id, app_secret = _oauth_keys("meta")
    claimed = db.query(WhatsAppConnection).filter(WhatsAppConnection.owner_user_id != user.id,
        (WhatsAppConnection.waba_id == req.waba_id) | (WhatsAppConnection.phone_number_id == req.phone_number_id)).first()
    if claimed:
        raise HTTPException(409, "This business account or number belongs to another client.")
    try:
        debug = (await cloud.graph(f"{app_id}|{app_secret}", "debug_token", params={"input_token": req.access_token})).get("data", {})
        scopes = set(debug.get("scopes") or [])
        if not debug.get("is_valid") or str(debug.get("app_id")) != app_id or not {"whatsapp_business_management", "whatsapp_business_messaging"} <= scopes:
            raise HTTPException(422, "Token must belong to the platform Meta App and authorize WhatsApp management and messaging.")
        # Phone membership is checked by Meta, never trusted from signup/browser fields.
        data = await cloud.graph(req.access_token, f"{req.waba_id}/phone_numbers", params={"fields": "id,display_phone_number,status,platform_type,is_on_biz_app", "limit": 100})
        phone = next((p for p in data.get("data", []) if str(p.get("id")) == req.phone_number_id), None)
        if not phone:
            raise HTTPException(422, "That phone number does not belong to the authorized WhatsApp business account.")
        await cloud.graph(req.access_token, f"{req.waba_id}/subscribed_apps", method="POST", payload={})
        coexistence = bool(phone.get("is_on_biz_app"))
        if coexistence and phone.get("platform_type") != "CLOUD_API":
            raise HTTPException(422, "Complete the WhatsApp Business App coexistence signup before connecting.")
        if not coexistence and (phone.get("status") != "CONNECTED" or phone.get("platform_type") != "CLOUD_API"):
            if not req.registration_pin:
                raise HTTPException(422, "This phone needs Cloud API registration. Supply its six-digit two-step verification PIN.")
            registered = await cloud.graph(req.access_token, f"{req.phone_number_id}/register", method="POST",
                payload={"messaging_product": "whatsapp", "pin": req.registration_pin})
            if not registered.get("success"):
                raise HTTPException(422, "Meta did not confirm phone registration.")
    except (cloud.WhatsAppError, httpx.HTTPError, ValueError):
        raise HTTPException(422, "Meta could not validate and subscribe this business account. Check permissions and IDs.") from None
    row = db.query(WhatsAppConnection).filter_by(owner_user_id=user.id).first() or WhatsAppConnection(owner_user_id=user.id)
    if row.phone_number_id and row.phone_number_id != req.phone_number_id and db.query(WhatsAppMessage).filter_by(owner_user_id=user.id, status="reserved").first():
        raise HTTPException(409, "A send is in progress; finish it before changing the sender.")
    same_phone = row.phone_number_id == req.phone_number_id
    # Keep the verified token separate from unverified generic credential updates.
    credential = db.query(ProviderCredential).filter_by(owner_user_id=user.id, provider="whatsapp_cloud").first() or ProviderCredential(owner_user_id=user.id, provider="whatsapp_cloud")
    credential.ciphertext, credential.nonce = encrypt_secret(req.access_token)
    credential.updated_at = time.time()
    row.waba_id, row.phone_number_id = req.waba_id, req.phone_number_id
    row.display_phone_number, row.updated_at = str(phone.get("display_phone_number", "")), time.time()
    if not same_phone:
        row.sync_requests = "{}"
        row.onboarding_status = "sync_pending" if coexistence else "cloud_ready"
    db.add_all([row, credential])
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(409, "This business account or number is already connected to another client.") from None
    if coexistence and row.onboarding_status == "sync_pending":
        requests = json.loads(row.sync_requests or "{}")
        for sync_type in ("smb_app_state_sync", "history"):
            if sync_type in requests:
                continue  # these APIs are one-shot; an ambiguous outcome must not be retried
            requests[sync_type] = {"status": "attempting"}
            row.sync_requests = json.dumps(requests)
            db.commit()
            try:
                response = await cloud.graph(req.access_token, f"{req.phone_number_id}/smb_app_data", method="POST",
                    payload={"messaging_product": "whatsapp", "sync_type": sync_type})
                requests[sync_type] = {"status": "requested", "request_id": response.get("request_id", "")}
            except (cloud.WhatsAppError, httpx.HTTPError, ValueError):
                requests[sync_type] = {"status": "unknown"}
            row.sync_requests = json.dumps(requests)
            db.commit()
        row.onboarding_status = "sync_requested" if all(r.get("status") == "requested" for r in requests.values()) else "sync_attention"
        db.commit()
    return connection(db, user)


@router.put("/connection")
async def connect(req: ConnectionRequest, db: Session = Depends(get_db), user: UserAccount = Depends(get_current_user)):
    return await save_connection(req, db, user)


@router.post("/embedded-signup/exchange")
async def exchange(req: ExchangeRequest, db: Session = Depends(get_db), user: UserAccount = Depends(get_current_user)):
    app_id, app_secret = _oauth_keys("meta")
    try:
        data = await cloud.graph(f"{app_id}|{app_secret}", "oauth/access_token", params={"client_id": app_id, "client_secret": app_secret, "code": req.code})
        token = data.get("access_token")
        if not token:
            raise ValueError("No token")
    except (cloud.WhatsAppError, httpx.HTTPError, ValueError):
        raise HTTPException(422, "Meta signup code exchange failed. Start signup again.") from None
    return await save_connection(ConnectionRequest(access_token=token, waba_id=req.waba_id, phone_number_id=req.phone_number_id, registration_pin=req.registration_pin), db, user)


@router.delete("/connection")
def disconnect(db: Session = Depends(get_db), user: UserAccount = Depends(get_current_user)):
    db.query(WhatsAppConnection).filter_by(owner_user_id=user.id).delete()
    db.query(ProviderCredential).filter_by(owner_user_id=user.id, provider="whatsapp_cloud").delete()
    db.commit()
    return {"connected": False}


async def approved_templates(row, token):
    result, after = [], None
    # Bound Meta pagination; never follow a remote URL containing a token.
    for _ in range(20):
        params = {"fields": "name,language,status,components,parameter_format", "limit": 100}
        if after:
            params["after"] = after
        data = await cloud.graph(token, f"{row.waba_id}/message_templates", params=params)
        result.extend(t for t in data.get("data", []) if t.get("status") == "APPROVED")
        paging = data.get("paging") or {}
        after = (paging.get("cursors") or {}).get("after") if paging.get("next") else None
        if not after:
            break
    return result


@router.get("/templates")
async def templates(db: Session = Depends(get_db), user: UserAccount = Depends(get_current_user)):
    row, token = binding(db, user.id)
    try:
        return {"templates": await approved_templates(row, token)}
    except (cloud.WhatsAppError, httpx.HTTPError, ValueError):
        raise HTTPException(502, "Meta templates could not be loaded.") from None


def reserve(db, user, key, digest, phone_number_id, to, template):
    old = db.query(WhatsAppMessage).filter_by(owner_user_id=user.id, idempotency_key=key).first()
    if old:
        if old.request_hash != digest:
            raise HTTPException(409, "Idempotency key was already used for a different message.")
        return old, False
    _row(db, user)
    record = WhatsAppMessage(id=str(uuid.uuid4()), owner_user_id=user.id, idempotency_key=key,
        request_hash=digest, phone_number_id=phone_number_id, to=to, template=template)
    try:
        db.add(record)
        db.flush()  # unique key and quota commit together, including concurrent requests
        changed = db.query(TenantLimits).filter(TenantLimits.owner_user_id == user.id,
            TenantLimits.day == today_key(), TenantLimits.blocked == 0,
            TenantLimits.whatsapp_used < TenantLimits.whatsapp_per_day).update({
            TenantLimits.whatsapp_used: TenantLimits.whatsapp_used + 1,
            TenantLimits.whatsapp_total: TenantLimits.whatsapp_total + 1}, synchronize_session=False)
        if not changed:
            db.rollback()
            raise HTTPException(429, "Daily WhatsApp app allowance reached or account paused.")
        db.commit()
        return record, True
    except IntegrityError:
        db.rollback()
        old = db.query(WhatsAppMessage).filter_by(owner_user_id=user.id, idempotency_key=key).one()
        if old.request_hash != digest:
            raise HTTPException(409, "Idempotency key conflict.")
        return old, False


def validate_template(template, params):
    if template.get("parameter_format") == "NAMED":
        raise HTTPException(422, "Choose a template with numbered body parameters.")
    body = ""
    for c in template.get("components", []):
        kind = c.get("type", "").upper()
        if kind == "BODY":
            body = c.get("text", "")
        elif kind == "HEADER" and (c.get("format") != "TEXT" or "{{" in c.get("text", "")):
            raise HTTPException(422, "This template needs a media or variable header; choose a text body template.")
        elif kind == "BUTTONS" and any("{{" in b.get("url", "") or b.get("type") in {"COPY_CODE", "FLOW", "QUICK_REPLY"} for b in c.get("buttons", [])):
            raise HTTPException(422, "This template needs button parameters; choose a text body template.")
    count = len(set(re.findall(r"\{\{([0-9]+)\}\}", body)))
    if len(params) != count or any(not p.strip() or len(p) > 1024 for p in params):
        raise HTTPException(422, f"Provide {count} non-empty body parameters, up to 1024 characters each.")


@router.post("/messages/template")
async def send(req: SendRequest, db: Session = Depends(get_db), user: UserAccount = Depends(get_current_user)):
    if not req.opt_in:
        raise HTTPException(422, "Recipient WhatsApp opt-in is required.")
    row, token = binding(db, user.id)
    if row.onboarding_status in {"sync_pending", "sync_attention"}:
        raise HTTPException(409, "Business App sync needs attention before API sending. Check Meta onboarding; do not repeat one-shot sync requests.")
    digest = hashlib.sha256(json.dumps(req.model_dump(exclude={"idempotency_key"}), sort_keys=True).encode()).hexdigest()
    old = db.query(WhatsAppMessage).filter_by(owner_user_id=user.id, idempotency_key=req.idempotency_key).first()
    if old:
        if old.request_hash != digest:
            raise HTTPException(409, "Idempotency key conflict.")
        return public_message(old)
    try:
        choices = await approved_templates(row, token)
    except (cloud.WhatsAppError, httpx.HTTPError, ValueError):
        raise HTTPException(502, "Meta templates could not be verified; nothing was sent.") from None
    selected = next((t for t in choices if t.get("name") == req.template and t.get("language") == req.language), None)
    if not selected:
        raise HTTPException(422, "An approved template and matching language are required.")
    validate_template(selected, req.body_params)
    record, fresh = reserve(db, user, req.idempotency_key, digest, row.phone_number_id, req.to, req.template)
    if not fresh:
        return public_message(record)
    try:
        record.provider_message_id = await cloud.send_template(token, row.phone_number_id, req.to.lstrip("+"), req.template, req.language, req.body_params)
        record.status = "accepted" if record.provider_message_id else "unknown"
        record.detail = "Accepted by Meta; delivery awaits a signed webhook." if record.provider_message_id else "No message ID received. Do not automatically resend."
    except (cloud.WhatsAppError, httpx.HTTPError, ValueError) as error:
        record.status = "failed" if isinstance(error, cloud.WhatsAppError) and 400 <= error.status < 500 else "unknown"
        record.detail = "Meta rejected the request." if record.status == "failed" else "Outcome unknown. Do not automatically resend."
    record.updated_at = time.time()
    db.commit()
    apply_receipts(db, record)
    return public_message(record)


@router.get("/messages")
def history(db: Session = Depends(get_db), user: UserAccount = Depends(get_current_user)):
    rows = db.query(WhatsAppMessage).filter_by(owner_user_id=user.id).order_by(WhatsAppMessage.created_at.desc()).limit(100).all()
    for row in rows:
        apply_receipts(db, row)
    return {"messages": [public_message(row) for row in rows]}


@router.get("/webhook", response_class=PlainTextResponse)
def verify_webhook(request: Request):
    secret = os.getenv("WHATSAPP_WEBHOOK_VERIFY_TOKEN", "")
    params = request.query_params
    if not secret or params.get("hub.mode") != "subscribe" or not hmac.compare_digest(params.get("hub.verify_token", ""), secret):
        raise HTTPException(403, "Invalid webhook verification")
    return params.get("hub.challenge", "")


def valid_signature(body, signature):
    secret = os.getenv("META_APP_SECRET", "")
    expected = "sha256=" + hmac.new(secret.encode(), body, hashlib.sha256).hexdigest()
    return bool(secret and hmac.compare_digest(signature, expected))


RANKS = {"reserved": 0, "unknown": 0, "accepted": 1, "sent": 2, "failed": 3, "delivered": 4, "read": 5}


def apply_receipts(db, row):
    if not row.provider_message_id:
        return
    receipts = db.query(WhatsAppReceipt).filter_by(owner_user_id=row.owner_user_id,
        phone_number_id=row.phone_number_id, provider_message_id=row.provider_message_id).all()
    for receipt in receipts:
        if RANKS.get(row.status, 0) < RANKS.get(receipt.status, 0):
            row.status, row.updated_at = receipt.status, time.time()
            row.detail = "Verified Meta delivery status: " + receipt.status
    db.commit()


@router.post("/webhook")
async def webhook(request: Request, db: Session = Depends(get_db)):
    body = await request.body()
    if len(body) > 5 * 1024 * 1024:
        raise HTTPException(413, "Webhook payload too large")
    if not valid_signature(body, request.headers.get("x-hub-signature-256", "")):
        raise HTTPException(403, "Invalid webhook signature")
    try:
        data = json.loads(body)
    except ValueError:
        raise HTTPException(400, "Invalid JSON") from None
    if not isinstance(data, dict) or not isinstance(data.get("entry", []), list):
        raise HTTPException(400, "Invalid webhook structure")
    for entry in data.get("entry", []):
        if not isinstance(entry, dict) or not isinstance(entry.get("changes", []), list):
            continue
        for change in entry.get("changes", []):
            if not isinstance(change, dict):
                continue
            value = change.get("value") or {}
            if not isinstance(value, dict):
                continue
            metadata = value.get("metadata") or {}
            if not isinstance(metadata, dict):
                continue
            phone = str(metadata.get("phone_number_id", ""))
            owner = db.query(WhatsAppConnection).filter_by(waba_id=str(entry.get("id", "")), phone_number_id=phone).first()
            if not owner:
                continue
            field = str(change.get("field", ""))[:64]
            if field in {"history", "smb_app_state_sync", "smb_message_echoes", "account_update"}:
                receipt_id = hashlib.sha256(owner.owner_user_id.encode() + body).hexdigest()
                if not db.get(WhatsAppReceipt, receipt_id):
                    # ponytail: bounded receipt metadata, a separate inbox import is needed for history reconstruction.
                    db.add(WhatsAppReceipt(id=receipt_id, owner_user_id=owner.owner_user_id, field=field,
                        metadata_json=json.dumps({"phone_number_id": phone, "bytes": len(body)})))
                    db.flush()
                    keep = db.query(WhatsAppReceipt.id).filter(WhatsAppReceipt.owner_user_id == owner.owner_user_id, WhatsAppReceipt.field != "messages").order_by(WhatsAppReceipt.created_at.desc()).limit(200)
                    db.query(WhatsAppReceipt).filter(WhatsAppReceipt.owner_user_id == owner.owner_user_id, WhatsAppReceipt.field != "messages", WhatsAppReceipt.id.not_in(keep)).delete(synchronize_session=False)
            statuses = value.get("statuses", [])
            for receipt in statuses if isinstance(statuses, list) else []:
                if not isinstance(receipt, dict):
                    continue
                status = receipt.get("status")
                if not isinstance(status, str) or status not in {"sent", "delivered", "read", "failed"}:
                    continue
                message_id = str(receipt.get("id", ""))[:256]
                if not message_id:
                    continue
                receipt_id = hashlib.sha256(f"{owner.owner_user_id}|{phone}|{message_id}|{status}".encode()).hexdigest()
                if not db.get(WhatsAppReceipt, receipt_id):
                    db.add(WhatsAppReceipt(id=receipt_id, owner_user_id=owner.owner_user_id, field="messages",
                        phone_number_id=phone, provider_message_id=message_id, status=status))
                row = db.query(WhatsAppMessage).filter_by(owner_user_id=owner.owner_user_id,
                    phone_number_id=phone, provider_message_id=message_id).first()
                if row and RANKS.get(row.status, 0) < RANKS[status]:
                    row.status, row.updated_at = status, time.time()
                    row.detail = "Verified Meta delivery status: " + status
    try:
        db.query(WhatsAppReceipt).filter(WhatsAppReceipt.created_at < time.time() - 30 * 86400).delete(synchronize_session=False)
        db.commit()
    except IntegrityError:
        db.rollback()  # concurrent identical signed receipt is already persisted
    return {"received": True}
