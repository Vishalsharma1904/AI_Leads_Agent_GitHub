"""Razorpay subscriptions: a company pays, and its Voice Calling unlocks.

The whole point of this file is one sentence: payment is confirmed on THIS
server, never by the browser saying so. A client that can flip its own plan is
not a paywall, it is a suggestion.

Two paths in, both signed:
  · /verify  — the checkout callback. Razorpay signs order_id|payment_id with
    our key secret; we recompute it. Good for instant unlock while the user
    is still looking at the screen.
  · /webhook — Razorpay's server-to-server call, signed over the raw body.
    This is the source of truth: it still arrives if the customer closed the
    tab, and it is what carries refunds and failures later.

No SDK. Razorpay's REST API is one authenticated POST and the signature is
HMAC-SHA256 from the standard library.

Environment:
  RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET   — from the Razorpay dashboard
  RAZORPAY_WEBHOOK_SECRET                — set when creating the webhook
"""
from __future__ import annotations

import hashlib
import hmac
import json
import os
import re
import time

import httpx
from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field
from sqlalchemy import Column, Float, Integer, String, or_, text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session
from starlette.concurrency import run_in_threadpool

from api.auth_sync import AUTO_CREATE_SCHEMA, Base, UserAccount, engine, get_current_user, get_db

from services.developer_control import AccountControl, UsageEvent

router = APIRouter(prefix="/api/v1/billing", tags=["billing"])

RAZORPAY_API = "https://api.razorpay.com/v1"
MONTH_SECONDS = 30 * 24 * 3600

# Hardcoded on purpose. Two plans do not need an admin CRUD screen, and a
# price that lives in the database is a price someone can change by accident.
# ponytail: move to a table when there are enough plans to argue about.
PLANS = {
    "starter": {"label": "Starter", "amount_paise": 499_00, "call_quota": 500},
    "growth": {"label": "Growth", "amount_paise": 1499_00, "call_quota": 2500},
}
FREE_QUOTA = 10          # so a new company can try a real call before paying


class Subscription(Base):
    __tablename__ = "subscriptions"
    owner_user_id = Column(String(64), primary_key=True)
    plan = Column(String(32), default="")
    status = Column(String(24), default="none")      # none | active | expired
    period_end = Column(Float, default=0.0)
    period_start = Column(Float, default=0.0)
    calls_used = Column(Integer, default=0)
    order_id = Column(String(64), default="")
    payment_id = Column(String(64), default="")
    updated_at = Column(Float, default=time.time)


class PaymentReceipt(Base):
    """Server-only purchase ledger; each payment and order can grant once."""
    __tablename__ = "payment_receipts"
    payment_id = Column(String(64), primary_key=True)
    order_id = Column(String(64), unique=True, nullable=False)
    owner_user_id = Column(String(64), nullable=False, index=True)
    plan = Column(String(32), nullable=False)
    amount_paise = Column(Integer, nullable=False)
    currency = Column(String(3), nullable=False)
    status = Column(String(24), nullable=False)
    period_start = Column(Float, default=0.0, nullable=False)
    period_end = Column(Float, default=0.0, nullable=False)
    created_at = Column(Float, default=time.time, nullable=False)
    updated_at = Column(Float, default=time.time, nullable=False)


if AUTO_CREATE_SCHEMA:
    Base.metadata.create_all(bind=engine)


class OrderRequest(BaseModel):
    plan: str = Field(min_length=1, max_length=32)


class VerifyRequest(BaseModel):
    razorpay_order_id: str = Field(min_length=4, max_length=64)
    razorpay_payment_id: str = Field(min_length=4, max_length=64)
    razorpay_signature: str = Field(min_length=16, max_length=256)


def _keys() -> tuple[str, str]:
    key_id = os.getenv("RAZORPAY_KEY_ID", "").strip()
    secret = os.getenv("RAZORPAY_KEY_SECRET", "").strip()
    if not key_id or not secret:
        raise HTTPException(503, "Payments are not configured on this server yet")
    return key_id, secret


def _row(db: Session, user_id: str) -> Subscription:
    row = db.query(Subscription).filter_by(owner_user_id=user_id).first()
    if not row:
        row = Subscription(owner_user_id=user_id, updated_at=time.time())
        db.add(row)
        db.commit()
    return row


def _activate(db: Session, user_id: str, plan: str, order_id: str, payment_id: str) -> Subscription:
    order, payment = _fetch_purchase(order_id, payment_id)
    if _binding(order, payment, user_id)[1] != plan:
        raise HTTPException(400, "Payment plan does not match")
    return apply_verified_payment(db, user_id, order, payment)


def _binding(order: dict, payment: dict, owner: str | None = None) -> tuple[str, str]:
    notes = order.get("notes")
    if not isinstance(notes, dict):
        raise HTTPException(400, "Order has no buyer binding")
    buyer, plan = notes.get("owner_user_id"), notes.get("plan")
    if not isinstance(buyer, str) or not buyer or len(buyer) > 64 or not isinstance(plan, str) or plan not in PLANS:
        raise HTTPException(400, "Order buyer or plan is invalid")
    if owner is not None and buyer != owner:
        raise HTTPException(403, "That payment belongs to another buyer")
    amount = PLANS[plan]["amount_paise"]
    if (order.get("amount") != amount or payment.get("amount") != amount
            or order.get("currency") != "INR" or payment.get("currency") != "INR"
            or not order.get("id") or payment.get("order_id") != order["id"]
            or not payment.get("id")):
        raise HTTPException(400, "Payment amount, currency or order does not match")
    return buyer, plan


def _lock_purchase(db: Session, owner: str, order_id: str, payment_id: str) -> None:
    # Billing owns this transaction. Drop the authentication read transaction
    # before taking a writer lock; no endpoint calls this with pending writes.
    db.rollback()
    dialect = db.get_bind().dialect.name
    if dialect == "sqlite":
        db.execute(text("BEGIN IMMEDIATE"))
    elif dialect == "postgresql":
        # Locks also cover an absent subscription/receipt. Row locks cannot.
        for identity in sorted(("buyer:" + owner, "order:" + order_id, "payment:" + payment_id)):
            key = int.from_bytes(hashlib.sha256(identity.encode()).digest()[:8], "big", signed=True)
            db.execute(text("SELECT pg_advisory_xact_lock(:key)"), {"key": key})
    else:
        raise HTTPException(503, "Billing requires SQLite or PostgreSQL")


def _receipt(db: Session, owner: str, plan: str, order: dict, payment: dict) -> PaymentReceipt | None:
    receipt = db.query(PaymentReceipt).filter(or_(
        PaymentReceipt.payment_id == payment["id"], PaymentReceipt.order_id == order["id"]
    )).first()
    if receipt and (receipt.owner_user_id != owner or receipt.plan != plan
                    or receipt.payment_id != payment["id"] or receipt.order_id != order["id"]
                    or receipt.amount_paise != PLANS[plan]["amount_paise"] or receipt.currency != "INR"):
        raise HTTPException(409, "Payment or order is already bound to another purchase")
    return receipt


def apply_verified_payment(db: Session, user_id: str, order: dict, payment: dict) -> Subscription:
    """Apply entities fetched from Razorpay, atomically with their receipt."""
    owner, plan = _binding(order, payment, user_id)
    if (payment.get("status") != "captured" or payment.get("captured") is not True
            or payment.get("amount_refunded", 0) != 0 or order.get("status") != "paid"):
        raise HTTPException(400, "Payment is not captured and paid")
    try:
        _lock_purchase(db, owner, order["id"], payment["id"])
        receipt = _receipt(db, owner, plan, order, payment)
        row = db.query(Subscription).filter_by(owner_user_id=owner).first()
        if receipt:
            if receipt.status != "captured" or row is None:
                raise HTTPException(409, "That purchase no longer grants access")
            db.commit()
            return row
        now = time.time()
        if row is None:
            row = Subscription(owner_user_id=owner, calls_used=0)
            db.add(row)
        # Legacy subscriptions have no ledger yet. Import their last purchase
        # without extending it when an old signed callback is replayed.
        legacy = row.payment_id == payment["id"] and row.order_id == order["id"]
        if legacy and row.status != "active":
            raise HTTPException(409, "That purchase no longer grants access")
        base = max(now, row.period_end or 0) if row.status == "active" else now
        if not legacy:
            row.plan, row.status = plan, "active"
            row.period_start, row.period_end = now, base + MONTH_SECONDS
            row.calls_used = 0
            row.order_id, row.payment_id = order["id"], payment["id"]
            row.updated_at = now
        db.add(PaymentReceipt(payment_id=payment["id"], order_id=order["id"],
                              owner_user_id=owner, plan=plan, amount_paise=PLANS[plan]["amount_paise"],
                              currency="INR", status="captured", period_start=(max(row.period_start or 0, (row.period_end or 0) - MONTH_SECONDS) if legacy else base),
                              period_end=row.period_end, created_at=now, updated_at=now))
        db.commit()
        return row
    except IntegrityError:
        db.rollback()
        raise HTTPException(409, "Payment or order is already recorded") from None
    except Exception:
        db.rollback()
        raise


def _reverse_payment(db: Session, order: dict, payment: dict) -> bool:
    owner, plan = _binding(order, payment)
    refunded = payment.get("status") == "refunded" or payment.get("amount_refunded", 0) > 0
    if not refunded and payment.get("status") != "failed":
        return False
    try:
        _lock_purchase(db, owner, order["id"], payment["id"])
        receipt = db.query(PaymentReceipt).filter_by(payment_id=payment['id']).first()
        if receipt and (receipt.owner_user_id != owner or receipt.order_id != order['id']):
            raise HTTPException(409, 'Payment binding mismatch')
        row = db.query(Subscription).filter_by(owner_user_id=owner).first()
        now = time.time()
        if receipt is None and row and row.payment_id == payment["id"] and row.order_id == order["id"]:
            receipt = PaymentReceipt(payment_id=payment["id"], order_id=order["id"],
                                     owner_user_id=owner, plan=plan, amount_paise=PLANS[plan]["amount_paise"],
                                     currency="INR", status="captured", period_start=max(row.period_start or 0, (row.period_end or 0) - MONTH_SECONDS),
                                     period_end=row.period_end or 0, created_at=now, updated_at=now)
            db.add(receipt)
        if receipt is None:
            # A processed refund can beat an in-flight captured callback.
            # Persist its tombstone so that stale callback cannot grant later.
            if refunded:
                db.add(PaymentReceipt(payment_id=payment["id"], order_id=order["id"],
                                      owner_user_id=owner, plan=plan, amount_paise=PLANS[plan]["amount_paise"],
                                      currency="INR", status="refunded", created_at=now, updated_at=now))
            db.commit()
            return refunded
        if receipt.status == "captured":
            # Any processed refund cancels this grant. Keep independently paid
            # periods, and move their future intervals forward consistently.
            remaining = max(0, receipt.period_end - max(now, receipt.period_start))
            if row and remaining:
                row.period_end = max(now, (row.period_end or 0) - remaining)
                later = db.query(PaymentReceipt).filter(
                    PaymentReceipt.owner_user_id == owner, PaymentReceipt.status == "captured",
                    PaymentReceipt.period_start >= receipt.period_end,
                    PaymentReceipt.payment_id != receipt.payment_id).all()
                for grant in later:
                    grant.period_start -= remaining
                    grant.period_end -= remaining
                if row.period_end <= now:
                    row.status = "refunded" if refunded else "failed"
                elif row.payment_id == payment["id"]:
                    previous = db.query(PaymentReceipt).filter(
                        PaymentReceipt.owner_user_id == owner, PaymentReceipt.status == "captured",
                        PaymentReceipt.payment_id != receipt.payment_id).order_by(PaymentReceipt.period_end.desc()).first()
                    if previous:
                        row.plan, row.order_id, row.payment_id = previous.plan, previous.order_id, previous.payment_id
                row.updated_at = now
            receipt.status = "refunded" if refunded else "failed"
            receipt.updated_at = now
        db.commit()
        return True
    except Exception:
        db.rollback()
        raise


def entitlement(user: UserAccount, db: Session) -> dict:
    """The one answer every gated feature asks for."""
    from services.developer_control import AccountControl
    row = _row(db, user.id)
    now = time.time()
    paid = row.status == "active" and row.period_end > now
    if row.status == "active" and not paid:
        row.status = "expired"
        row.updated_at = now
        db.commit()
    control = db.query(AccountControl).filter_by(user_id=user.id).first()
    manual = bool(control and control.status in ("active", "trial")
                  and (not control.expires_at or control.expires_at > now))
    blocked = bool(control and (control.status == "blocked"
                               or json.loads(control.features or "{}").get("calls") is False))
    active = (paid or manual) and not blocked
    quota = PLANS.get(row.plan, {}).get("call_quota", 0) if paid else FREE_QUOTA
    calls_used = int(row.calls_used or 0)
    if manual:
        quota = json.loads(control.monthly_limits or "{}").get("calls", quota)
        # Owner grants use the same calendar-month ledger as admission.
        from services.developer_control import UsageEvent
        from api.limits import IST
        from datetime import datetime
        from sqlalchemy import func
        start = datetime.now(IST).replace(day=1, hour=0, minute=0, second=0, microsecond=0).timestamp()
        calls_used = int(db.query(func.coalesce(func.sum(UsageEvent.amount), 0)).filter(
            UsageEvent.user_id == user.id, UsageEvent.meter == 'calls',
            UsageEvent.created_at >= start, UsageEvent.state != 'refunded').scalar())
    if blocked or control and not active:
        quota = 0
    return {
        "plan": row.plan if paid and active else "",
        "plan_label": (PLANS.get(row.plan, {}).get("label", "") if paid else "Owner access") if active else "Free trial",
        "active": active,
        "access_source": ("payment" if paid else "owner") if active else "none",
        "period_end": (row.period_end if paid else control.expires_at) if active else 0,
        "calls_used": calls_used,
        "call_quota": quota,
        "calls_left": max(0, quota - calls_used),
    }


def require_calling(user: UserAccount, db: Session) -> Subscription:
    """Gate for anything that spends money on the tenant's behalf.

    A free company gets a handful of real calls so it can see the thing work
    before paying; after that the paywall is the paywall.
    """
    ent = entitlement(user, db)
    if ent["calls_left"] <= 0:
        raise HTTPException(402, (
            "Free calls are used up — pick a plan to keep calling."
            if not ent["active"] else
            f"This month's {ent['call_quota']} calls are used up. Upgrade or wait for the next period."
        ))
    return _row(db, user.id)


def record_call(db: Session, user_id: str) -> None:
    row = _row(db, user_id)
    row.calls_used = int(row.calls_used or 0) + 1
    row.updated_at = time.time()
    db.commit()


# ── API ─────────────────────────────────────────────────────────────

@router.get("/plans")
def plans():
    return {"plans": [
        {"id": pid, "label": p["label"], "price_inr": p["amount_paise"] // 100, "call_quota": p["call_quota"]}
        for pid, p in PLANS.items()
    ], "free_quota": FREE_QUOTA}


@router.get("/status")
def status(db: Session = Depends(get_db), user: UserAccount = Depends(get_current_user)):
    key_id = os.getenv("RAZORPAY_KEY_ID", "").strip()
    return {"success": True, "payments_ready": bool(key_id), "key_id": key_id, **entitlement(user, db)}


@router.post("/order")
async def create_order(req: OrderRequest, db: Session = Depends(get_db), user: UserAccount = Depends(get_current_user)):
    plan = PLANS.get(req.plan)
    if not plan:
        raise HTTPException(404, "Unknown plan")
    key_id, secret = _keys()
    try:
        async with httpx.AsyncClient(timeout=20.0) as client:
            response = await client.post(f"{RAZORPAY_API}/orders", auth=(key_id, secret), json={
                "amount": plan["amount_paise"],
                "currency": "INR",
                "receipt": f"{user.id[:24]}-{int(time.time())}",
                # The plan and the buyer travel with the order, so the webhook
                # can activate the right thing without trusting the browser.
                "notes": {"plan": req.plan, "owner_user_id": user.id},
            })
    except httpx.HTTPError:
        raise HTTPException(502, "Could not reach Razorpay") from None
    if response.status_code >= 400:
        raise HTTPException(502, f"Razorpay rejected the order ({response.status_code})")
    order = response.json()
    return {
        "success": True,
        "key_id": key_id,
        "order_id": order.get("id"),
        "amount": order.get("amount"),
        "currency": order.get("currency", "INR"),
        "plan": req.plan,
        "plan_label": plan["label"],
    }


@router.post("/verify")
def verify(req: VerifyRequest, db: Session = Depends(get_db), user: UserAccount = Depends(get_current_user)):
    """Checkout callback. Signed by Razorpay with our key secret."""
    _, secret = _keys()
    expected = hmac.new(secret.encode(), f"{req.razorpay_order_id}|{req.razorpay_payment_id}".encode(),
                        hashlib.sha256).hexdigest()
    if not hmac.compare_digest(expected, req.razorpay_signature):
        raise HTTPException(400, "Payment signature did not verify")
    order, payment = _fetch_purchase(req.razorpay_order_id, req.razorpay_payment_id)
    apply_verified_payment(db, user.id, order, payment)
    return {"success": True, **entitlement(user, db)}


def _fetch_entity(kind: str, identifier: str) -> dict:
    prefix = "order_" if kind == "orders" else "pay_"
    if not isinstance(identifier, str) or not identifier.startswith(prefix) or not re.fullmatch(r"[A-Za-z0-9_]{4,64}", identifier):
        raise HTTPException(400, "Invalid Razorpay identifier")
    key_id, secret = _keys()
    try:
        response = httpx.get(f"{RAZORPAY_API}/{kind}/{identifier}", auth=(key_id, secret), timeout=15.0)
        if response.status_code >= 400:
            raise HTTPException(502, "Could not confirm payment with Razorpay")
        entity = response.json()
    except (httpx.HTTPError, ValueError):
        raise HTTPException(502, "Could not confirm payment with Razorpay") from None
    if not isinstance(entity, dict) or entity.get("id") != identifier:
        raise HTTPException(502, "Razorpay returned a different payment or order")
    return entity


def _fetch_purchase(order_id: str, payment_id: str) -> tuple[dict, dict]:
    return _fetch_entity("orders", order_id), _fetch_entity("payments", payment_id)


@router.post("/webhook")
async def webhook(request: Request, db: Session = Depends(get_db)):
    """Razorpay server-to-server. Signed over the raw body, so read it raw."""
    secret = os.getenv("RAZORPAY_WEBHOOK_SECRET", "").strip()
    if not secret:
        raise HTTPException(503, "Webhook secret is not configured")
    raw = await request.body()
    sent = request.headers.get("X-Razorpay-Signature", "")
    expected = hmac.new(secret.encode(), raw, hashlib.sha256).hexdigest()
    if not sent or not hmac.compare_digest(expected, sent):
        raise HTTPException(400, "Bad webhook signature")

    try:
        event = json.loads(raw.decode("utf-8"))
    except (ValueError, UnicodeDecodeError):
        raise HTTPException(400, "Bad webhook body") from None

    if not isinstance(event, dict):
        raise HTTPException(400, "Bad webhook body")
    return await run_in_threadpool(_process_webhook, event, db)


def _process_webhook(event: dict, db: Session) -> dict:
    name = event.get("event")
    if name not in ("payment.captured", "order.paid", "payment.failed", "payment.refunded", "refund.processed"):
        return {"success": True, "ignored": event.get("event")}

    payload = event.get("payload")
    if not isinstance(payload, dict):
        raise HTTPException(400, "Bad webhook payload")
    payment_payload = payload.get("payment") or {}
    refund_payload = payload.get("refund") or {}
    order_payload = payload.get("order") or {}
    if not all(isinstance(item, dict) for item in (payment_payload, refund_payload, order_payload)):
        raise HTTPException(400, "Bad webhook entity")
    entity = payment_payload.get("entity") or {}
    refund = refund_payload.get("entity") or {}
    sent_order = order_payload.get("entity") or {}
    if not all(isinstance(item, dict) for item in (entity, refund, sent_order)):
        raise HTTPException(400, "Bad webhook entity")
    payment_id = entity.get("id") or refund.get("payment_id")
    payment = _fetch_entity("payments", payment_id)
    order = _fetch_entity("orders", payment.get("order_id"))
    if (entity.get("order_id") and entity["order_id"] != order["id"]
            or sent_order.get("id") and sent_order["id"] != order["id"]
            or refund.get("payment_id") and refund["payment_id"] != payment["id"]):
        raise HTTPException(400, "Webhook entities do not match this purchase")
    owner, plan = _binding(order, payment)
    if name in ("payment.failed", "payment.refunded", "refund.processed"):
        reversed_payment = _reverse_payment(db, order, payment)
        if name != "payment.failed" and not reversed_payment:
            raise HTTPException(503, "Refund is not reflected by Razorpay yet; retry this event")
        return {"success": True, "reversed": reversed_payment}
    # A delayed captured event must honour an actual later refund/failure.
    if payment.get("status") in ("failed", "refunded") or payment.get("amount_refunded", 0) > 0:
        return {"success": True, "reversed": _reverse_payment(db, order, payment)}
    apply_verified_payment(db, owner, order, payment)
    return {"success": True, "activated": plan}
