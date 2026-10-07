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
import time

import httpx
from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field
from sqlalchemy import Column, Float, Integer, String
from sqlalchemy.orm import Session

from api.auth_sync import AUTO_CREATE_SCHEMA, Base, UserAccount, engine, get_current_user, get_db

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
    row = _row(db, user_id)
    now = time.time()
    # Paying again while still inside a period extends it rather than
    # throwing away what was already bought.
    base = row.period_end if row.status == "active" and row.period_end > now else now
    row.plan = plan
    row.status = "active"
    row.period_start = now
    row.period_end = base + MONTH_SECONDS
    row.calls_used = 0
    row.order_id = order_id
    row.payment_id = payment_id
    row.updated_at = now
    db.commit()
    return row


def entitlement(user: UserAccount, db: Session) -> dict:
    """The one answer every gated feature asks for."""
    row = _row(db, user.id)
    now = time.time()
    active = row.status == "active" and row.period_end > now
    if row.status == "active" and not active:
        row.status = "expired"
        row.updated_at = now
        db.commit()
    quota = PLANS.get(row.plan, {}).get("call_quota", 0) if active else FREE_QUOTA
    return {
        "plan": row.plan if active else "",
        "plan_label": PLANS.get(row.plan, {}).get("label", "") if active else "Free trial",
        "active": active,
        "period_end": row.period_end if active else 0,
        "calls_used": int(row.calls_used or 0),
        "call_quota": quota,
        "calls_left": max(0, quota - int(row.calls_used or 0)),
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
    row = _row(db, user.id)
    row.order_id = str(order.get("id", ""))
    row.updated_at = time.time()
    db.commit()
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
    row = _row(db, user.id)
    if row.order_id and row.order_id != req.razorpay_order_id:
        raise HTTPException(400, "That payment belongs to a different order")
    # Which plan was bought is read back from Razorpay's own notes, never from
    # the browser — otherwise anyone could pay for Starter and claim Growth.
    plan = _plan_from_order(req.razorpay_order_id)
    if plan not in PLANS:
        raise HTTPException(400, "Could not confirm which plan was paid for")
    _activate(db, user.id, plan, req.razorpay_order_id, req.razorpay_payment_id)
    return {"success": True, **entitlement(user, db)}


def _plan_from_order(order_id: str) -> str:
    key_id, secret = _keys()
    try:
        response = httpx.get(f"{RAZORPAY_API}/orders/{order_id}", auth=(key_id, secret), timeout=15.0)
        if response.status_code >= 400:
            return ""
        return str((response.json().get("notes") or {}).get("plan") or "")
    except (httpx.HTTPError, ValueError):
        return ""


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

    if event.get("event") not in ("payment.captured", "order.paid"):
        return {"success": True, "ignored": event.get("event")}

    entity = (((event.get("payload") or {}).get("payment") or {}).get("entity")) or {}
    notes = entity.get("notes") or {}
    owner = str(notes.get("owner_user_id") or "")
    plan = str(notes.get("plan") or "")
    if not owner or plan not in PLANS:
        # Nothing to attribute it to. Answer 200 so Razorpay stops retrying a
        # payment we genuinely cannot place, and leave it for the dashboard.
        return {"success": True, "ignored": "unattributed"}
    _activate(db, owner, plan, str(entity.get("order_id") or ""), str(entity.get("id") or ""))
    return {"success": True, "activated": plan}
