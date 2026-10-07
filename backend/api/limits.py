"""Per-tenant daily limits, counted and enforced on this server.

THE RULE THIS FILE EXISTS FOR
-----------------------------
A limit enforced inside the customer's EXE is not a limit. They own the
machine: they can edit a JSON file, roll the clock back, patch the binary or
just call the API themselves. The only number that holds is the one counted
here, behind their login, where they cannot reach it.

Same reason the API keys are not in the EXE. If the client could decrypt a key
to use it, so could its owner with a debugger — so the keys stay in this
server's vault (api/credentials.py) and the client only ever sees results.

WHAT A DAY MEANS
----------------
Asia/Kolkata, because the customers and the calling windows are Indian. The
day boundary is computed from a stored date string, never from "hours since
last reset", so a clock the client controls cannot buy extra quota.

CAPS DO NOT ROLL OVER, WORK DOES
--------------------------------
50 leads a day and 25 calls a day are hard ceilings. What carries to tomorrow
is the WORK: leads found today but not yet called stay in the queue and get
dialled tomorrow at 25 a day. Rolling the caps themselves over would mean a
tenant idle for a month could fire 750 calls in one afternoon — a bill shock
for whoever owns the Sarvam account, and a spam complaint for everyone.
"""
from __future__ import annotations

import os
import time
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import Column, Float, Integer, String, case
from sqlalchemy.orm import Session

from api.auth_sync import AUTO_CREATE_SCHEMA, Base, UserAccount, engine, get_current_user, get_db

router = APIRouter(prefix="/api/v1/limits", tags=["limits"])

IST = timezone(timedelta(hours=5, minutes=30))

# What a tenant gets unless the operator changes it for them.
DEFAULT_LIMITS = {"leads": 50, "calls": 25, "ai": 300}
METERS = tuple(DEFAULT_LIMITS)          # the only names a caller may spend


def today_key() -> str:
    return datetime.now(IST).strftime("%Y-%m-%d")


class TenantLimits(Base):
    """One row per tenant: the ceilings, and what today has spent."""
    __tablename__ = "tenant_limits"
    owner_user_id = Column(String(64), primary_key=True)
    email = Column(String(255), default="")           # so the admin list is readable
    leads_per_day = Column(Integer, default=DEFAULT_LIMITS["leads"])
    calls_per_day = Column(Integer, default=DEFAULT_LIMITS["calls"])
    ai_per_day = Column(Integer, default=DEFAULT_LIMITS["ai"])
    day = Column(String(10), default="")              # YYYY-MM-DD in IST
    leads_used = Column(Integer, default=0)
    calls_used = Column(Integer, default=0)
    ai_used = Column(Integer, default=0)
    leads_total = Column(Integer, default=0)          # lifetime, for the admin view
    calls_total = Column(Integer, default=0)
    ai_total = Column(Integer, default=0)
    blocked = Column(Integer, default=0)              # operator kill switch
    note = Column(String(500), default="")
    last_seen = Column(Float, default=0.0)
    updated_at = Column(Float, default=time.time)


if AUTO_CREATE_SCHEMA:
    Base.metadata.create_all(bind=engine)
    # create_all() does not add a column to a table that already exists, so a
    # DB created before the `ai` meter existed 500s on every request that
    # touches limits — i.e. every chat turn ("backend is unavailable"). Run
    # the patch here, at import, where it cannot be skipped by a startup-event
    # ordering problem. print() so it lands in logs/backend.log even if the
    # logging config swallows warnings.
    try:
        from api.auth_sync import ensure_columns
        _added = ensure_columns()
        print("[schema] columns added:", _added or "none needed", flush=True)
    except Exception as _exc:  # noqa: BLE001 - never block import
        print("[schema] column sync FAILED:", _exc, flush=True)


# ── core ────────────────────────────────────────────────────────────

def _row(db: Session, user: UserAccount) -> TenantLimits:
    row = db.query(TenantLimits).filter_by(owner_user_id=user.id).first()
    if not row:
        row = TenantLimits(owner_user_id=user.id, day=today_key(), updated_at=time.time())
        db.add(row)
    email = getattr(user, "email", "") or ""
    if email and row.email != email:
        row.email = email[:255]
    # The reset is a date comparison, not a timer: a client that moves its own
    # clock cannot talk this server into a fresh day.
    key = today_key()
    if row.day != key:
        row.day = key
        for meter in METERS:
            setattr(row, f"{meter}_used", 0)
    row.last_seen = time.time()
    db.commit()
    return row


def _cap(row: TenantLimits, meter: str) -> int:
    return int(getattr(row, f"{meter}_per_day", 0) or 0)


def _used(row: TenantLimits, meter: str) -> int:
    return int(getattr(row, f"{meter}_used", 0) or 0)


def snapshot(db: Session, user: UserAccount) -> dict:
    row = _row(db, user)
    return {
        "day": row.day,
        "blocked": bool(row.blocked),
        "meters": {m: {"used": _used(row, m), "limit": _cap(row, m),
                       "left": max(0, _cap(row, m) - _used(row, m))} for m in METERS},
    }


def consume(db: Session, user: UserAccount, meter: str, amount: int = 1) -> dict:
    """Atomically reserve quota BEFORE doing the expensive thing."""
    if meter not in METERS:
        raise HTTPException(500, f"Unknown meter {meter!r}")
    row = _row(db, user)
    if row.blocked:
        raise HTTPException(403, "This account is paused. Contact support.")
    cap, used = _cap(row, meter), _used(row, meter)
    if cap <= 0:
        raise HTTPException(403, f"Your plan has no {meter} allowance.")
    if used + amount > cap:
        raise HTTPException(429, (
            f"Aaj ki {meter} limit ({cap}) poori ho gayi. "
            f"{(datetime.now(IST) + timedelta(days=1)).strftime('%d %b')} ko midnight IST par reset hogi."
        ))
    used_col = getattr(TenantLimits, f"{meter}_used")
    total_col = getattr(TenantLimits, f"{meter}_total")
    changed = db.query(TenantLimits).filter(
        TenantLimits.owner_user_id == user.id, TenantLimits.day == row.day,
        TenantLimits.blocked == 0, used_col + amount <= getattr(TenantLimits, f"{meter}_per_day")
    ).update({used_col: used_col + amount, total_col: total_col + amount,
              TenantLimits.updated_at: time.time()}, synchronize_session=False)
    db.commit()
    db.expire_all()
    if not changed:
        raise HTTPException(429, f"Daily {meter} allowance reached. Check Usage & Limits.")
    return snapshot(db, user)


def refund(db: Session, user: UserAccount, meter: str, day: str) -> None:
    """Return a failed request's reservation, without subtracting from a new day."""
    used = getattr(TenantLimits, f"{meter}_used")
    total = getattr(TenantLimits, f"{meter}_total")
    db.query(TenantLimits).filter(TenantLimits.owner_user_id == user.id).update({
        used: case((TenantLimits.day == day, case((used > 0, used - 1), else_=0)), else_=used),
        total: case((total > 0, total - 1), else_=0),
    }, synchronize_session=False)
    db.commit()
    db.expire_all()


def remaining(db: Session, user: UserAccount, meter: str) -> int:
    row = _row(db, user)
    if row.blocked:
        return 0
    return max(0, _cap(row, meter) - _used(row, meter))


# ── who may administer ──────────────────────────────────────────────

def is_admin(user: UserAccount) -> bool:
    """Operator accounts come from the environment, not from a database row.

    A role column would be one SQL injection or one bad migration away from
    letting a customer promote themselves. An env var on the server they do
    not control cannot be edited from the product at all.
    """
    allow = {e.strip().lower() for e in os.getenv("CLAVIS_ADMIN_EMAILS", "").split(",") if e.strip()}
    email = (getattr(user, "email", "") or "").strip().lower()
    return bool(email and email in allow)


def require_admin(user: UserAccount = Depends(get_current_user)) -> UserAccount:
    if not is_admin(user):
        raise HTTPException(404, "Not found")      # 404, not 403: don't advertise the console
    return user


# ── tenant-facing ───────────────────────────────────────────────────

@router.get("/me")
def my_limits(db: Session = Depends(get_db), user: UserAccount = Depends(get_current_user)):
    """Read-only. The client renders this; it can never set it."""
    return {"success": True, **snapshot(db, user)}


# ── operator console ────────────────────────────────────────────────

class LimitPatch(BaseModel):
    leads_per_day: int | None = Field(default=None, ge=0, le=100_000)
    calls_per_day: int | None = Field(default=None, ge=0, le=100_000)
    blocked: bool | None = None
    note: str | None = Field(default=None, max_length=500)


@router.get("/admin/tenants")
def list_tenants(db: Session = Depends(get_db), _: UserAccount = Depends(require_admin)):
    rows = db.query(TenantLimits).order_by(TenantLimits.last_seen.desc()).limit(500).all()
    key = today_key()
    return {"success": True, "day": key, "tenants": [{
        "owner_user_id": r.owner_user_id,
        "email": r.email or "",
        "blocked": bool(r.blocked),
        "note": r.note or "",
        "leads": {"used": int(r.leads_used or 0) if r.day == key else 0,
                  "limit": int(r.leads_per_day or 0), "total": int(r.leads_total or 0)},
        "calls": {"used": int(r.calls_used or 0) if r.day == key else 0,
                  "limit": int(r.calls_per_day or 0), "total": int(r.calls_total or 0)},
        "last_seen": r.last_seen or 0,
    } for r in rows]}


@router.patch("/admin/tenants/{owner_user_id}")
def patch_tenant(owner_user_id: str, patch: LimitPatch,
                 db: Session = Depends(get_db), _: UserAccount = Depends(require_admin)):
    row = db.query(TenantLimits).filter_by(owner_user_id=owner_user_id).first()
    if not row:
        raise HTTPException(404, "Tenant not found")
    if patch.leads_per_day is not None:
        row.leads_per_day = patch.leads_per_day
    if patch.calls_per_day is not None:
        row.calls_per_day = patch.calls_per_day
    if patch.blocked is not None:
        row.blocked = 1 if patch.blocked else 0
    if patch.note is not None:
        row.note = patch.note
    row.updated_at = time.time()
    db.commit()
    return {"success": True, "owner_user_id": owner_user_id}
