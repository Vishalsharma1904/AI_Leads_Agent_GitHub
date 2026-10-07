"""Tenant-scoped Sarvam AI voice-calling proxy.

Why this exists at all: sarvam-calling.js used to talk to apps.sarvam.ai
straight from the browser with the subscription key in hand. That is fine for
one owner on one laptop and impossible to sell — the key sits in the page, any
tenant can read any other tenant's, and there is no server-side record of who
placed which call.

Here the key lives in the same AES-GCM vault the rest of the app uses
(api/credentials.py), scoped to owner_user_id, and the browser only ever sees
results. One company = one login = its own key, its own workspace, its own
numbers, with nothing to configure beyond pasting the key once.

Endpoints are explicit on purpose. A generic "proxy any path with the tenant's
key" would have been a third of the code and an SSRF hole.

Sarvam API (docs.sarvam.ai, checked 2026-09-30):
  POST /api/outbounds/v1/orgs/{org}/workspaces/{ws}/outbounds
  GET  /api/app-authoring/v1/orgs/{org}/workspaces/{ws}/deployments
  GET  /api/analytics/v1/{org}/{ws}/{app}/attempts
  GET  /api/analytics/v1/{org}/{ws}/{app}/transcripts/{interaction_id}
  GET  /api/analytics/v1/{org}/{ws}/{app}/recordings/{interaction_id}
Auth header: api-subscription-key (analytics also accepts X-API-Key).
"""
from __future__ import annotations

import re
import time
from datetime import datetime, timedelta, timezone

import httpx
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import Column, Float, Integer, String
from sqlalchemy.orm import Session

from api.auth_sync import AUTO_CREATE_SCHEMA, Base, UserAccount, engine, get_current_user, get_db
from api.billing import record_call, require_calling
from api.credentials import get_provider_secret
from api.limits import consume

router = APIRouter(prefix="/api/v1/sarvam", tags=["sarvam"])

BASE_URL = "https://apps.sarvam.ai"
# Sarvam ids are opaque; keep them to what can safely go in a URL path.
ID_RE = re.compile(r"^[A-Za-z0-9._:-]{1,128}$")
TIMEOUT = httpx.Timeout(25.0)


class SarvamSettings(Base):
    """One row per tenant. Everything needed to place a call, nothing secret."""
    __tablename__ = "sarvam_settings"
    owner_user_id = Column(String(64), primary_key=True)
    org_id = Column(String(128), default="")
    workspace_id = Column(String(128), default="")
    app_id = Column(String(128), default="")
    app_version = Column(Integer, default=1)
    connection_id = Column(String(128), default="")
    agent_phone_number = Column(String(24), default="")
    updated_at = Column(Float, default=time.time)


if AUTO_CREATE_SCHEMA:
    Base.metadata.create_all(bind=engine)


class SettingsRequest(BaseModel):
    org_id: str = Field(default="", max_length=128)
    workspace_id: str = Field(default="", max_length=128)
    app_id: str = Field(default="", max_length=128)
    app_version: int = Field(default=1, ge=1, le=9999)
    connection_id: str = Field(default="", max_length=128)
    agent_phone_number: str = Field(default="", max_length=24)


class CallRequest(BaseModel):
    phone_number: str = Field(min_length=8, max_length=20)
    agent_variables: dict[str, str] = Field(default_factory=dict)


def normalize_phone(raw: str) -> str:
    """Indian-first E.164. The browser normalises too, but the number that is
    actually dialled is decided here — a client is not a trust boundary."""
    s = re.sub(r"[^\d+]", "", str(raw or "").strip())
    if s.startswith("+"):
        s = "+" + re.sub(r"\D", "", s[1:])
    else:
        digits = re.sub(r"\D", "", s)
        if len(digits) == 10:
            s = "+91" + digits
        elif len(digits) == 11 and digits.startswith("0"):
            s = "+91" + digits[1:]
        elif len(digits) == 12 and digits.startswith("91"):
            s = "+" + digits
        elif 11 <= len(digits) <= 15:
            s = "+" + digits
        else:
            return ""
    digits = s[1:]
    if not 10 <= len(digits) <= 15:
        return ""
    # An Indian mobile is 91 + [6-9]xxxxxxxxx. Anything else with a 91 prefix
    # is a typo, and a typo that dials is a typo that costs money.
    if len(digits) == 12 and digits.startswith("91") and not re.match(r"^91[6-9]", digits):
        return ""
    return s


def _settings(db: Session, user: UserAccount) -> SarvamSettings:
    row = db.query(SarvamSettings).filter_by(owner_user_id=user.id).first()
    if not row:
        row = SarvamSettings(owner_user_id=user.id, updated_at=time.time())
        db.add(row)
        db.commit()
    return row


def _as_dict(row: SarvamSettings) -> dict:
    return {
        "org_id": row.org_id or "",
        "workspace_id": row.workspace_id or "",
        "app_id": row.app_id or "",
        "app_version": int(row.app_version or 1),
        "connection_id": row.connection_id or "",
        "agent_phone_number": row.agent_phone_number or "",
        "updated_at": row.updated_at,
    }


def _missing(row: SarvamSettings) -> list[str]:
    need = {
        "org_id": "Organisation ID",
        "workspace_id": "Workspace ID",
        "app_id": "Agent (app) ID",
        "connection_id": "Connection ID",
        "agent_phone_number": "Agent phone number",
    }
    return [label for key, label in need.items() if not str(getattr(row, key) or "").strip()]


def _key(user: UserAccount, db: Session) -> str:
    token = get_provider_secret("sarvam", user, db)
    if not token:
        raise HTTPException(409, "Connect a Sarvam API key first")
    return token


def _safe(value: str, what: str) -> str:
    value = str(value or "").strip()
    if not ID_RE.fullmatch(value):
        raise HTTPException(422, f"{what} is missing or has unexpected characters")
    return value


async def _sarvam(method: str, path: str, key: str, *, payload=None, params=None):
    headers = {"api-subscription-key": key, "X-API-Key": key}
    try:
        async with httpx.AsyncClient(timeout=TIMEOUT) as client:
            response = await client.request(method, BASE_URL + path,
                                            headers=headers, json=payload, params=params)
    except httpx.HTTPError:
        raise HTTPException(502, "Sarvam is unreachable right now") from None
    if response.status_code in (401, 403):
        raise HTTPException(422, "Sarvam rejected this API key")
    if response.status_code == 404:
        raise HTTPException(404, "Sarvam could not find that org / workspace / agent")
    if response.status_code == 429:
        raise HTTPException(429, "Sarvam rate limit reached")
    if response.status_code >= 400:
        detail = ""
        try:
            body = response.json()
            detail = str(body.get("detail") or body.get("message") or "")[:200]
        except ValueError:
            pass
        raise HTTPException(502, f"Sarvam request failed ({response.status_code}){': ' + detail if detail else ''}")
    try:
        return response.json()
    except ValueError:
        return {}


def _org_path(row: SarvamSettings) -> str:
    return f"/orgs/{_safe(row.org_id, 'Organisation ID')}/workspaces/{_safe(row.workspace_id, 'Workspace ID')}"


def _analytics_path(row: SarvamSettings) -> str:
    return (f"/api/analytics/v1/{_safe(row.org_id, 'Organisation ID')}"
            f"/{_safe(row.workspace_id, 'Workspace ID')}/{_safe(row.app_id, 'Agent (app) ID')}")


# ── settings ────────────────────────────────────────────────────────

@router.get("/status")
def status(db: Session = Depends(get_db), user: UserAccount = Depends(get_current_user)):
    row = _settings(db, user)
    connected = bool(get_provider_secret("sarvam", user, db))
    missing = _missing(row)
    return {
        "connected": connected,
        "ready": connected and not missing,
        "missing": missing,
        "settings": _as_dict(row),
    }


@router.put("/settings")
def save_settings(req: SettingsRequest, db: Session = Depends(get_db), user: UserAccount = Depends(get_current_user)):
    row = _settings(db, user)
    phone = ""
    if req.agent_phone_number.strip():
        phone = normalize_phone(req.agent_phone_number)
        if not phone:
            raise HTTPException(422, "The agent phone number is not a valid number")
    row.org_id = req.org_id.strip()
    row.workspace_id = req.workspace_id.strip()
    row.app_id = req.app_id.strip()
    row.app_version = req.app_version
    row.connection_id = req.connection_id.strip()
    row.agent_phone_number = phone
    row.updated_at = time.time()
    db.commit()
    return {"success": True, "settings": _as_dict(row), "missing": _missing(row)}


# ── discovery ───────────────────────────────────────────────────────

@router.get("/deployments")
async def deployments(db: Session = Depends(get_db), user: UserAccount = Depends(get_current_user)):
    """What this tenant already has in Sarvam.

    This is what turns setup into one field: paste the key, and the agent id,
    version, connection and phone number all come back from Sarvam itself.
    """
    row = _settings(db, user)
    data = await _sarvam("GET", f"/api/app-authoring/v1{_org_path(row)}/deployments",
                         _key(user, db), params={"limit": 100})
    items = data.get("items") if isinstance(data, dict) else None
    return {"success": True, "items": items if isinstance(items, list) else []}


@router.post("/adopt")
async def adopt(payload: dict, db: Session = Depends(get_db), user: UserAccount = Depends(get_current_user)):
    """Take one deployment from /deployments and make it this tenant's agent."""
    row = _settings(db, user)
    dep = payload if isinstance(payload, dict) else {}
    phones = dep.get("phone_numbers")
    phone = (phones[0] if isinstance(phones, list) and phones else dep.get("phone_number")) or ""
    conn = (dep.get("connection_id")
            or (dep.get("connection_config") or {}).get("connection_id")
            or (dep.get("connection") or {}).get("connection_id") or "")
    if dep.get("app_id"):
        row.app_id = str(dep["app_id"])[:128]
    if dep.get("app_version") is not None:
        try:
            row.app_version = max(1, int(dep["app_version"]))
        except (TypeError, ValueError):
            pass
    if conn:
        row.connection_id = str(conn)[:128]
    if phone:
        row.agent_phone_number = normalize_phone(phone) or row.agent_phone_number
    row.updated_at = time.time()
    db.commit()
    return {"success": True, "settings": _as_dict(row), "missing": _missing(row)}


# ── calling ─────────────────────────────────────────────────────────

@router.post("/calls")
async def place_call(req: CallRequest, db: Session = Depends(get_db), user: UserAccount = Depends(get_current_user)):
    row = _settings(db, user)
    missing = _missing(row)
    if missing:
        raise HTTPException(409, "Finish the Sarvam setup first: " + ", ".join(missing))
    # Two gates, both on this server. The plan says whether they may call at
    # all this month; the daily cap says not more than N today. The client is
    # shown both numbers and can change neither.
    require_calling(user, db)
    consume(db, user, "calls")
    phone = normalize_phone(req.phone_number)
    if not phone:
        raise HTTPException(422, "That phone number is not valid")
    if phone == row.agent_phone_number:
        raise HTTPException(422, "The agent cannot call its own number")
    body = {
        "app_config": {
            "app_id": row.app_id,
            "app_version": int(row.app_version or 1),
            "connection_config": {
                "connection_id": row.connection_id,
                "agent_phone_number": row.agent_phone_number,
            },
        },
        "user_config": {
            "user_phone_number": phone,
            # Values only — a variable map is data, never instructions.
            "agent_variables": {str(k)[:64]: str(v)[:500] for k, v in list(req.agent_variables.items())[:40]},
        },
    }
    data = await _sarvam("POST", f"/api/outbounds/v1{_org_path(row)}/outbounds", _key(user, db), payload=body)
    attempt = data.get("attempt_id") if isinstance(data, dict) else None
    if not attempt:
        raise HTTPException(502, "Sarvam accepted the request but returned no attempt id")
    record_call(db, user.id)      # counted only once Sarvam has accepted it
    try:
        from api.crm_automation import track_call
        track_call(db, user.id, "sarvam", str(attempt), phone)
    except Exception:
        db.rollback()  # An accepted call must not be retried because CRM tracking failed.
    return {"success": True, "attempt_id": str(attempt), "phone_number": phone}


@router.get("/attempts")
async def attempts(hours: int = 6, limit: int = 200,
                   db: Session = Depends(get_db), user: UserAccount = Depends(get_current_user)):
    row = _settings(db, user)
    hours = max(1, min(int(hours or 6), 168))
    limit = max(1, min(int(limit or 200), 500))
    end = datetime.now(timezone.utc)
    start = end - timedelta(hours=hours)
    data = await _sarvam("GET", f"{_analytics_path(row)}/attempts", _key(user, db), params={
        "start_datetime": start.isoformat(),
        "end_datetime": end.isoformat(),
        "limit": limit,
        "offset": 0,
    })
    items = data.get("items") if isinstance(data, dict) else None
    return {"success": True, "items": items if isinstance(items, list) else []}


@router.get("/transcripts/{interaction_id}")
async def transcript(interaction_id: str, db: Session = Depends(get_db), user: UserAccount = Depends(get_current_user)):
    row = _settings(db, user)
    ident = _safe(interaction_id, "Interaction id")
    return {"success": True, "data": await _sarvam("GET", f"{_analytics_path(row)}/transcripts/{ident}", _key(user, db))}


@router.get("/recordings/{interaction_id}")
async def recording(interaction_id: str, db: Session = Depends(get_db), user: UserAccount = Depends(get_current_user)):
    row = _settings(db, user)
    ident = _safe(interaction_id, "Interaction id")
    return {"success": True, "data": await _sarvam("GET", f"{_analytics_path(row)}/recordings/{ident}", _key(user, db))}
