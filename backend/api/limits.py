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
DEFAULT_LIMITS = {"leads": 50, "calls": 25, "ai": 300, "whatsapp": 20,
                  "tts_characters": 50000, "voice_seconds": 3600, "voice_sessions": 100}
METERS = tuple(DEFAULT_LIMITS)          # the only names a caller may spend
VOICE_METERS = ('tts_characters', 'voice_seconds', 'voice_sessions')


def today_key() -> str:
    return datetime.now(IST).strftime("%Y-%m-%d")


class TenantLimits(Base):
    """One row per tenant: the ceilings, and what today has spent."""
    __tablename__ = "tenant_limits"
    owner_user_id = Column(String(64), primary_key=True)
    email = Column(String(255), default="")           # so the admin list is readable
    leads_per_day = Column(Integer, default=DEFAULT_LIMITS["leads"])
    calls_per_day = Column(Integer, default=DEFAULT_LIMITS["calls"])
    whatsapp_per_day = Column(Integer, default=20)
    whatsapp_used = Column(Integer, default=0)
    whatsapp_total = Column(Integer, default=0)
    ai_per_day = Column(Integer, default=DEFAULT_LIMITS["ai"])
    tts_characters_per_day = Column(Integer, default=DEFAULT_LIMITS['tts_characters'])
    voice_seconds_per_day = Column(Integer, default=DEFAULT_LIMITS['voice_seconds'])
    voice_sessions_per_day = Column(Integer, default=DEFAULT_LIMITS['voice_sessions'])
    tts_characters_used = Column(Integer, default=0)
    voice_seconds_used = Column(Integer, default=0)
    voice_sessions_used = Column(Integer, default=0)
    tts_characters_total = Column(Integer, default=0)
    voice_seconds_total = Column(Integer, default=0)
    voice_sessions_total = Column(Integer, default=0)
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
    from sqlalchemy.exc import IntegrityError
    row = db.query(TenantLimits).filter_by(owner_user_id=user.id).first()
    if not row:
        try:
            db.add(TenantLimits(owner_user_id=user.id, email=getattr(user, "email", "") or "", day=today_key()))
            db.commit()
        except IntegrityError:
            db.rollback()
    key = today_key()
    # Conditional SQL reset: midnight requests cannot erase each other's spend.
    db.query(TenantLimits).filter(TenantLimits.owner_user_id == user.id, TenantLimits.day != key).update(
        {TenantLimits.day: key, **{getattr(TenantLimits, f"{m}_used"): 0 for m in METERS}}, synchronize_session=False)
    db.query(TenantLimits).filter_by(owner_user_id=user.id).update(
        {TenantLimits.last_seen: time.time()}, synchronize_session=False)
    db.commit()
    db.expire_all()
    return db.query(TenantLimits).filter_by(owner_user_id=user.id).one()


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


def consume(db: Session, user: UserAccount, meter: str, amount: int = 1, request_id: str | None = None,
            *, provider: str = '', basis: str = 'app_count') -> dict:
    """Atomically reserve quota BEFORE doing the expensive thing."""
    if not isinstance(amount, int) or amount <= 0:
        raise HTTPException(422, 'Reservation amount must be positive')
    if meter not in METERS:
        raise HTTPException(500, f"Unknown meter {meter!r}")
    row = _row(db, user)
    from services.developer_control import check_access
    check_access(db, user, 'voice' if meter in VOICE_METERS else meter)
    if row.blocked:
        raise HTTPException(403, "This account is paused. Contact support.")
    # Serialize admission even on SQLite and reuse a durable retry reservation.
    db.query(TenantLimits).filter_by(owner_user_id=user.id).update({TenantLimits.updated_at: TenantLimits.updated_at}, synchronize_session=False)
    if request_id:
        from services.developer_control import UsageEvent
        existing = db.query(UsageEvent).filter_by(user_id=user.id, request_id=request_id, meter=meter).first()
        if existing:
            if existing.amount != amount: raise HTTPException(409, 'Request ID belongs to another reservation')
            db.commit()
            return {**snapshot(db, user), 'usage_id': existing.id, 'idempotent': True}
    cap, used = _cap(row, meter), _used(row, meter)
    from services.developer_control import managed_access
    # Testing phase (CLAVIS_MANAGED_ACCESS off): usage is still counted for the
    # owner's dashboard, but daily caps never stop a test run.
    testing = not managed_access()
    if testing:
        cap = max(cap, used + amount)
    if cap <= 0:
        raise HTTPException(403, f"Your plan has no {meter} allowance.")
    if used + amount > cap:
        raise HTTPException(429, (
            f"Aaj ki {meter} limit ({cap}) poori ho gayi. "
            f"{(datetime.now(IST) + timedelta(days=1)).strftime('%d %b')} ko midnight IST par reset hogi."
        ))
    used_col = getattr(TenantLimits, f"{meter}_used")
    total_col = getattr(TenantLimits, f"{meter}_total")
    from services.developer_control import reserve_monthly, record_usage
    reserve_monthly(db, user, meter, amount)
    usage_event = record_usage(db, user, meter, amount, request_id=request_id, provider=provider, basis=basis)
    if meter == 'calls':
        from api.billing import Subscription, PLANS, FREE_QUOTA
        sub = db.query(Subscription).filter_by(owner_user_id=user.id).first()
        if sub and sub.status == 'active' and sub.period_end > time.time():
            quota = PLANS.get(sub.plan, {}).get('call_quota', FREE_QUOTA)
            changed_sub = db.query(Subscription).filter(Subscription.owner_user_id == user.id,
                Subscription.calls_used + amount <= quota).update({Subscription.calls_used: Subscription.calls_used + amount}, synchronize_session=False)
            if not changed_sub:
                db.rollback()
                raise HTTPException(429, 'Subscription call allowance reached')
    cap_filter = [] if testing else [used_col + amount <= getattr(TenantLimits, f"{meter}_per_day")]
    changed = db.query(TenantLimits).filter(
        TenantLimits.owner_user_id == user.id, TenantLimits.day == row.day,
        TenantLimits.blocked == 0, *cap_filter
    ).update({used_col: used_col + amount, total_col: total_col + amount,
              TenantLimits.updated_at: time.time()}, synchronize_session=False)
    if not changed:
        db.rollback()
        raise HTTPException(429, f"Daily {meter} allowance reached. Check Usage & Limits.")
    db.commit()
    db.expire_all()
    return {**snapshot(db, user), "usage_id": usage_event.id}


def refund(db: Session, user: UserAccount, meter: str, day: str, usage_id: str | None = None) -> None:
    """Return a failed request's reservation, without subtracting from a new day."""
    amount = 1
    if usage_id:
        from services.developer_control import UsageEvent
        changed = db.query(UsageEvent).filter(UsageEvent.id == usage_id, UsageEvent.user_id == user.id,
            UsageEvent.state != 'refunded').update({UsageEvent.state: 'refunded'}, synchronize_session=False)
        if not changed:
            db.rollback()
            return
        event = db.query(UsageEvent).filter_by(id=usage_id, user_id=user.id).first()
        amount = int(event.amount) if event else 1
        if meter == 'calls' and event:
            from api.billing import Subscription
            db.query(Subscription).filter(Subscription.owner_user_id == user.id, Subscription.period_start <= event.created_at, Subscription.calls_used >= amount).update({Subscription.calls_used: Subscription.calls_used - amount}, synchronize_session=False)
    used = getattr(TenantLimits, f"{meter}_used")
    total = getattr(TenantLimits, f"{meter}_total")
    db.query(TenantLimits).filter(TenantLimits.owner_user_id == user.id).update({
        used: case((TenantLimits.day == day, case((used >= amount, used - amount), else_=0)), else_=used),
        total: case((total >= amount, total - amount), else_=0),
    }, synchronize_session=False)
    if usage_id:
        from services.developer_control import UsageEvent
        db.query(UsageEvent).filter_by(id=usage_id, user_id=user.id).update({UsageEvent.state: 'refunded'}, synchronize_session=False)
    db.commit()
    db.expire_all()


def remaining(db: Session, user: UserAccount, meter: str) -> int:
    row = _row(db, user)
    if row.blocked:
        return 0
    return max(0, _cap(row, meter) - _used(row, meter))


def finish_usage(db: Session, user: UserAccount, reservation: dict, state: str, basis: str | None = None):
    from services.developer_control import UsageEvent
    changes = {UsageEvent.state: state}
    if basis is not None: changes[UsageEvent.basis] = basis
    db.query(UsageEvent).filter(UsageEvent.id == reservation['usage_id'], UsageEvent.user_id == user.id,
                              UsageEvent.state != 'refunded').update(changes, synchronize_session=False)
    db.commit()


def fail_usage(db: Session, user: UserAccount, meter: str, reservation: dict, error: BaseException, *, submitted: bool):
    """Refund definite rejection; retain the reservation when upstream outcome is unknown."""
    from services.developer_control import UsageEvent, record_usage
    known = not submitted or (isinstance(error, HTTPException) and 400 <= error.status_code < 500)
    if not known:
        finish_usage(db, user, reservation, 'unknown')
        return
    event = db.query(UsageEvent).filter_by(id=reservation['usage_id'], user_id=user.id).one()
    provider, request_id, basis = event.provider, event.request_id, event.basis
    refund(db, user, meter, reservation['day'], reservation['usage_id'])
    # A failed attempt stays visible without consuming the refunded allowance.
    if not db.query(UsageEvent).filter_by(user_id=user.id, request_id=request_id + ':failed', meter=meter).first():
        record_usage(db, user, meter, 0, request_id=request_id + ':failed', provider=provider, state='failed', basis=basis)
        db.commit()


# ── who may administer ──────────────────────────────────────────────

def is_admin(user: UserAccount) -> bool:
    """Operator accounts come from the environment, not from a database row.

    A role column would be one SQL injection or one bad migration away from
    letting a customer promote themselves. An env var on the server they do
    not control cannot be edited from the product at all.
    """
    from services.developer_control import is_owner
    return is_owner(user)


def require_admin(user: UserAccount = Depends(get_current_user), credentials=Depends(__import__('api.auth_sync', fromlist=['bearer_scheme']).bearer_scheme)) -> UserAccount:
    from services.developer_control import owner_claims
    from api.auth_sync import _verify_supabase_token
    if not credentials or not owner_claims(user, _verify_supabase_token(credentials.credentials)):
        raise HTTPException(403, "Developer access required")
    return user


# ── tenant-facing ───────────────────────────────────────────────────

@router.get("/me")
def my_limits(db: Session = Depends(get_db), user: UserAccount = Depends(get_current_user)):
    """Read-only. The client renders this; it can never set it."""
    return {"success": True, **snapshot(db, user)}


# ── operator console ────────────────────────────────────────────────

class LimitPatch(BaseModel):
    ai_per_day: int | None = Field(default=None, ge=0, le=100_000)
    whatsapp_per_day: int | None = Field(default=None, ge=0, le=100_000)
    leads_per_day: int | None = Field(default=None, ge=0, le=100_000)
    calls_per_day: int | None = Field(default=None, ge=0, le=100_000)
    tts_characters_per_day: int | None = Field(default=None, ge=0, le=10_000_000)
    voice_seconds_per_day: int | None = Field(default=None, ge=0, le=10_000_000)
    voice_sessions_per_day: int | None = Field(default=None, ge=0, le=10_000_000)
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
        "whatsapp": {"used": int(r.whatsapp_used or 0) if r.day == key else 0,
                     "limit": int(r.whatsapp_per_day or 0), "total": int(r.whatsapp_total or 0)},
        "last_seen": r.last_seen or 0,
    } for r in rows]}


@router.patch("/admin/tenants/{owner_user_id}")
def patch_tenant(owner_user_id: str, patch: LimitPatch,
                 db: Session = Depends(get_db), _: UserAccount = Depends(require_admin)):
    row = db.query(TenantLimits).filter_by(owner_user_id=owner_user_id).first()
    if not row:
        raise HTTPException(404, "Tenant not found")
    for meter in METERS:
        value = getattr(patch, meter + '_per_day')
        if value is not None: setattr(row, meter + '_per_day', value)
    if patch.blocked is not None:
        row.blocked = 1 if patch.blocked else 0
    if patch.note is not None:
        row.note = patch.note
    row.updated_at = time.time()
    from services.developer_control import bump, audit
    bump(db, owner_user_id)
    audit(db, _, owner_user_id, 'limits.update', patch.model_dump(exclude_none=True))
    db.commit()
    return {"success": True, "owner_user_id": owner_user_id}
