"""Authenticated, minimal product telemetry and support reports."""
import os
import time
import uuid
from collections import Counter
from datetime import datetime, timezone
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from fastapi import APIRouter, Depends, HTTPException
from fastapi.security import HTTPAuthorizationCredentials
from pydantic import BaseModel, Field
from sqlalchemy import Column, Float, Integer, String, Text, func
from sqlalchemy.orm import Session

from api.auth_sync import AUTO_CREATE_SCHEMA, Base, UserAccount, _verify_supabase_token, bearer_scheme, engine, get_current_user, get_db

router = APIRouter(prefix="/api/insights", tags=["product_insights"])


class ProductSession(Base):
    __tablename__ = "product_sessions"
    id = Column(String(36), primary_key=True)
    user_id = Column(String(64), index=True, nullable=False)
    device_id = Column(String(64), index=True, nullable=False)
    device_label = Column(String(80), nullable=False)
    platform = Column(String(24), nullable=False)
    region = Column(String(80), nullable=False)
    started_at = Column(Float, index=True, nullable=False)
    last_seen_at = Column(Float, index=True, nullable=False)
    duration_seconds = Column(Integer, default=0, nullable=False)


class ProductError(Base):
    __tablename__ = "product_errors"
    id = Column(String(36), primary_key=True)
    user_id = Column(String(64), index=True, nullable=False)
    kind = Column(String(24), nullable=False)
    message = Column(String(300), nullable=False)
    page = Column(String(80), nullable=False)
    created_at = Column(Float, index=True, nullable=False)


class BugReport(Base):
    __tablename__ = "product_bug_reports"
    id = Column(String(36), primary_key=True)
    user_id = Column(String(64), index=True, nullable=False)
    email = Column(String(255), nullable=False)
    title = Column(String(120), nullable=False)
    description = Column(Text, nullable=False)
    steps = Column(Text, nullable=False)
    page = Column(String(80), nullable=False)
    status = Column(String(20), default="open", nullable=False)
    created_at = Column(Float, index=True, nullable=False)
    updated_at = Column(Float, nullable=False)


if AUTO_CREATE_SCHEMA:
    Base.metadata.create_all(bind=engine, tables=[ProductSession.__table__, ProductError.__table__, BugReport.__table__])


def _developer_allowed(user: UserAccount, credentials: HTTPAuthorizationCredentials) -> bool:
    # A signed Supabase token is verified by get_current_user. The allowlist is
    # server owned; localStorage/profile email and UI state never grant access.
    configured = os.getenv("DEVELOPER_EMAILS", "vishalsharma190405@gmail.com")
    allowed = {email.strip().lower() for email in configured.split(",") if email.strip()}
    if not credentials or user.email.lower() not in allowed:
        return False
    claims = _verify_supabase_token(credentials.credentials)
    # Developer login uses the existing Google OAuth flow. A self-registered,
    # unconfirmed password account with the same address must not gain access.
    return claims.get("sub") == user.id and (claims.get("app_metadata") or {}).get("provider") == "google"


def require_developer(user: UserAccount = Depends(get_current_user),
                      credentials: HTTPAuthorizationCredentials = Depends(bearer_scheme)) -> UserAccount:
    if not _developer_allowed(user, credentials):
        raise HTTPException(status_code=403, detail="Developer access required")
    return user


class Heartbeat(BaseModel):
    session_id: str = Field(min_length=36, max_length=36)
    device_id: str = Field(min_length=16, max_length=64)
    device_label: str = Field(max_length=80)
    platform: str = Field(max_length=24)
    region: str = Field(max_length=80)
    active: bool = True


class ErrorSignal(BaseModel):
    kind: str = Field(max_length=24)
    message: str = Field(min_length=1, max_length=300)
    page: str = Field(max_length=80)


class NewBugReport(BaseModel):
    title: str = Field(min_length=5, max_length=120)
    description: str = Field(min_length=15, max_length=4000)
    steps: str = Field(default="", max_length=2000)
    page: str = Field(default="", max_length=80)


class BugStatus(BaseModel):
    status: str


@router.post("/heartbeat")
def heartbeat(payload: Heartbeat, db: Session = Depends(get_db), user: UserAccount = Depends(get_current_user)):
    now = time.time()
    item = db.query(ProductSession).filter_by(id=payload.session_id, user_id=user.id).first()
    if not item:
        item = ProductSession(id=payload.session_id, user_id=user.id, device_id=payload.device_id,
                              device_label=payload.device_label, platform=payload.platform,
                              region=payload.region, started_at=now, last_seen_at=now, duration_seconds=0)
        db.add(item)
    else:
        if item.device_id != payload.device_id:
            raise HTTPException(status_code=409, detail="Session device mismatch")
        delta = max(0, min(60, int(now - item.last_seen_at))) if payload.active else 0
        item.duration_seconds += delta
        item.last_seen_at = now if payload.active else item.last_seen_at
    db.commit()
    return {"ok": True}


@router.post("/errors")
def report_error(payload: ErrorSignal, db: Session = Depends(get_db), user: UserAccount = Depends(get_current_user)):
    if payload.kind not in {"javascript", "promise"}:
        raise HTTPException(status_code=422, detail="Invalid error type")
    # Limit noisy clients to 20 errors per hour; never accept stack traces or URLs.
    count = db.query(func.count(ProductError.id)).filter(ProductError.user_id == user.id,
                                                         ProductError.created_at >= time.time() - 3600).scalar()
    if count >= 20:
        raise HTTPException(status_code=429, detail="Error limit reached")
    db.add(ProductError(id=str(uuid.uuid4()), user_id=user.id, kind=payload.kind,
                        message=payload.message, page=payload.page, created_at=time.time()))
    db.commit()
    return {"ok": True}


@router.post("/bugs", status_code=201)
def create_bug(payload: NewBugReport, db: Session = Depends(get_db), user: UserAccount = Depends(get_current_user)):
    now = time.time()
    item = BugReport(id=str(uuid.uuid4()), user_id=user.id, email=user.email,
                     title=payload.title.strip(), description=payload.description.strip(),
                     steps=payload.steps.strip(), page=payload.page, status="open",
                     created_at=now, updated_at=now)
    db.add(item)
    db.commit()
    return {"id": item.id, "status": item.status}


@router.get("/me")
def my_access(user: UserAccount = Depends(get_current_user),
              credentials: HTTPAuthorizationCredentials = Depends(bearer_scheme)):
    return {"developer": _developer_allowed(user, credentials),
            "email": user.email}


@router.get("/dashboard")
def dashboard(db: Session = Depends(get_db), user: UserAccount = Depends(require_developer)):
    now = time.time()
    day = now - 86400
    week = now - 7 * 86400
    users = db.query(UserAccount).all()
    sessions = db.query(ProductSession).all()
    bugs = db.query(BugReport).order_by(BugReport.created_at.desc()).limit(100).all()
    errors = db.query(ProductError).filter(ProductError.created_at >= week).order_by(ProductError.created_at.desc()).limit(100).all()
    open_bug_count = db.query(func.count(BugReport.id)).filter(BugReport.status != "resolved").scalar()
    error_count = db.query(func.count(ProductError.id)).filter(ProductError.created_at >= week).scalar()
    active = [s for s in sessions if s.last_seen_at >= now - 120]
    daily = Counter(datetime.fromtimestamp(s.started_at, timezone.utc).strftime("%Y-%m-%d") for s in sessions if s.started_at >= now - 30 * 86400)
    hours = Counter()
    for s in sessions:
        try:
            user_zone = ZoneInfo(s.region)
        except (ZoneInfoNotFoundError, ValueError):
            user_zone = timezone.utc
        hours[datetime.fromtimestamp(s.started_at, user_zone).hour] += 1
    platforms = Counter(s.platform for s in sessions)
    regions = Counter(s.region for s in active)
    devices = {}
    for s in sorted(sessions, key=lambda x: x.last_seen_at, reverse=True):
        key = (s.user_id, s.device_id)
        if key not in devices:
            owner = next((u for u in users if u.id == s.user_id), None)
            devices[key] = {"user": owner.email if owner else "Unknown user", "label": s.device_label,
                            "platform": s.platform, "region": s.region, "last_seen_at": s.last_seen_at,
                            "active": s.last_seen_at >= now - 120}
    return {
        "metrics": {"users_lifetime": len(users), "first_seen_today": sum(u.created_at >= day for u in users),
                    "sessions_today": sum(s.started_at >= day for s in sessions),
                    "signed_in_today": len({s.user_id for s in sessions if s.started_at >= day}),
                    "active_users": len({s.user_id for s in active}), "active_devices": len({(s.user_id, s.device_id) for s in active}),
                    "usage_hours": round(sum(s.duration_seconds for s in sessions) / 3600, 1),
                    "open_bugs": open_bug_count, "errors_week": error_count},
        "daily_sessions": [{"date": date, "count": daily[date]} for date in sorted(daily)],
        "peak_hours_local": [{"hour": h, "count": hours[h]} for h in range(24)],
        "platforms": dict(platforms), "active_regions": dict(regions),
        "devices": list(devices.values())[:100],
        "bugs": [{"id": b.id, "email": b.email, "title": b.title, "description": b.description,
                  "steps": b.steps, "page": b.page, "status": b.status, "created_at": b.created_at} for b in bugs],
        "errors": [{"kind": e.kind, "message": e.message, "page": e.page, "created_at": e.created_at} for e in errors]
    }


@router.patch("/bugs/{bug_id}")
def update_bug(bug_id: str, payload: BugStatus, db: Session = Depends(get_db),
               user: UserAccount = Depends(require_developer)):
    if payload.status not in {"open", "in_progress", "resolved"}:
        raise HTTPException(status_code=422, detail="Invalid status")
    item = db.query(BugReport).filter_by(id=bug_id).first()
    if not item:
        raise HTTPException(status_code=404, detail="Bug report not found")
    item.status = payload.status
    item.updated_at = time.time()
    db.commit()
    return {"id": item.id, "status": item.status}
