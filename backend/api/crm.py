"""Tenant-owned CRM and honest outreach ledger; source imports never replace manual edits."""
import hashlib
import json
import math
import os
import re
import time
import uuid
from collections import Counter
from datetime import date, datetime, timedelta, timezone
from typing import Optional

import httpx
from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.security import HTTPAuthorizationCredentials
from pydantic import BaseModel, ConfigDict, Field, field_validator
from sqlalchemy import Boolean, Column, Float, ForeignKey, Integer, String, Text, UniqueConstraint, Index, and_, case, func, or_
from sqlalchemy.orm import Session
from api.auth_sync import AUTO_CREATE_SCHEMA, Base, UserAccount, UserCloudData, bearer_scheme, engine, get_current_user, get_db

router = APIRouter(prefix="/api/crm", tags=["crm"])
STAGES = ("new", "attempted", "connected", "follow_up", "qualified", "client", "not_interested", "review_required")
DEAL_STAGES = ("qualification", "proposal", "negotiation", "won", "lost")
CONVERSATION_OUTCOMES = ("connected", "replied", "meeting", "qualified", "follow_up", "not_interested", "completed")
PROFILE_FIELDS = "company contactPerson designation phone mobile email website address industry source serviceRequirement leadScore nextAction followUpDate additionalContacts secondaryEmail rating employees annualRevenue salutation firstName lastName fax skypeId emailOptOut phoneOptOut".split()


class CRMRecord(Base):
    __tablename__ = "crm_records"
    __table_args__ = (Index("ix_crm_records_owner_created", "owner_user_id", "created_at"),)
    id = Column(String(36), primary_key=True)
    owner_user_id = Column(String(64), nullable=False, index=True)
    version = Column(Integer, nullable=False, default=1)
    stage = Column(String(24), nullable=False, default="new", index=True)
    profile = Column(Text, nullable=False, default="{}")
    manual_fields = Column(Text, nullable=False, default="[]")
    created_at = Column(Float, nullable=True, index=True)
    updated_at = Column(Float, nullable=True)
    last_contact_at = Column(Float, nullable=True)


class CRMSource(Base):
    __tablename__ = "crm_sources"
    __table_args__ = (UniqueConstraint("owner_user_id", "source", "source_id", name="uq_crm_source"),)
    id = Column(String(36), primary_key=True)
    owner_user_id = Column(String(64), nullable=False, index=True)
    record_id = Column(String(36), ForeignKey("crm_records.id"), nullable=False, index=True)
    source = Column(String(32), nullable=False)
    source_id = Column(String(256), nullable=False)


class CRMDeal(Base):
    __tablename__ = "crm_deals"
    __table_args__ = (Index("ix_crm_deals_owner_stage_won", "owner_user_id", "archived", "stage", "won_at"),
                      Index("ix_crm_deals_owner_renewal", "owner_user_id", "archived", "stage", "contract_end_date"))
    id = Column(String(36), primary_key=True)
    owner_user_id = Column(String(64), nullable=False, index=True)
    record_id = Column(String(36), ForeignKey("crm_records.id"), nullable=False, index=True)
    version = Column(Integer, nullable=False, default=1)
    name = Column(String(200), nullable=False)
    service_type = Column(String(200), nullable=False, default="")
    monthly_amount = Column(Float, nullable=True)
    duration_months = Column(Integer, nullable=True)
    expected_close_date = Column(Float, nullable=True)
    contract_start_date = Column(Float, nullable=True)
    contract_end_date = Column(Float, nullable=True)
    stage = Column(String(24), nullable=False, default="qualification", index=True)
    next_step = Column(Text, nullable=False, default="")
    probability = Column(Float, nullable=True)
    loss_reason = Column(Text, nullable=False, default="")
    archived = Column(Boolean, nullable=False, default=False)
    created_at = Column(Float, nullable=False)
    updated_at = Column(Float, nullable=False)
    won_at = Column(Float, nullable=True, index=True)


class CRMTask(Base):
    __tablename__ = "crm_tasks"
    __table_args__ = (Index("ix_crm_tasks_owner_due", "owner_user_id", "archived", "status", "due_at"),)
    id = Column(String(36), primary_key=True)
    owner_user_id = Column(String(64), nullable=False, index=True)
    record_id = Column(String(36), ForeignKey("crm_records.id"), nullable=False, index=True)
    version = Column(Integer, nullable=False, default=1)
    title = Column(String(200), nullable=False)
    kind = Column(String(16), nullable=False, default="task")
    due_at = Column(Float, nullable=True, index=True)
    status = Column(String(16), nullable=False, default="open", index=True)
    notes = Column(Text, nullable=False, default="")
    archived = Column(Boolean, nullable=False, default=False)
    created_at = Column(Float, nullable=False)
    updated_at = Column(Float, nullable=False)


class CRMActivity(Base):
    __tablename__ = "crm_activities"
    __table_args__ = (UniqueConstraint("owner_user_id", "idempotency_key", name="uq_crm_activity_key"),
                      Index("ix_crm_activity_owner_occurred", "owner_user_id", "occurred_at"))
    id = Column(String(36), primary_key=True)
    version = Column(Integer, nullable=False, default=1)
    owner_user_id = Column(String(64), nullable=False, index=True)
    record_id = Column(String(36), ForeignKey("crm_records.id"), nullable=True, index=True)
    kind = Column(String(32), nullable=False, index=True)
    note = Column(Text, nullable=False, default="")
    note_history = Column(Text, nullable=False, default="[]")
    channel = Column(String(24), nullable=True)
    outcome = Column(String(80), nullable=True)
    evidence = Column(String(32), nullable=False, default="manual")
    recipient = Column(String(320), nullable=True)
    provider_id = Column(String(256), nullable=True)
    idempotency_key = Column(String(256), nullable=True)
    occurred_at = Column(Float, nullable=True, index=True)
    created_at = Column(Float, nullable=False)


class CRMMigration(Base):
    __tablename__ = "crm_migrations"
    __table_args__ = (UniqueConstraint("owner_user_id", "cursor", name="uq_crm_migration_cursor"),)
    id = Column(String(36), primary_key=True)
    owner_user_id = Column(String(64), nullable=False, index=True)
    cursor = Column(String(64), nullable=False)
    state = Column(Text, nullable=False)
    created_at = Column(Float, nullable=False)


if AUTO_CREATE_SCHEMA:
    Base.metadata.create_all(bind=engine, tables=[CRMRecord.__table__, CRMSource.__table__, CRMDeal.__table__, CRMTask.__table__, CRMActivity.__table__, CRMMigration.__table__])


def _id():
    return str(uuid.uuid4())


def _load(raw, default):
    try:
        return json.loads(raw) if raw else default
    except (ValueError, TypeError):
        return default


def _date(value):
    if value is None or value == "":
        return None
    try:
        if isinstance(value, (int, float)):
            value = float(value)
            value = value / 1000 if value > 1e11 else value
            if not math.isfinite(value) or value < 0:
                raise ValueError()
            datetime.fromtimestamp(value, timezone.utc)
            return value
        parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
        return parsed.replace(tzinfo=timezone.utc).timestamp() if parsed.tzinfo is None else parsed.timestamp()
    except (ValueError, TypeError, OverflowError, OSError):
        raise HTTPException(422, "Invalid ISO date") from None


def _historical_date(value):
    try:
        return _date(value)
    except HTTPException:
        return None


def _iso(value):
    return datetime.fromtimestamp(value, timezone.utc).isoformat().replace("+00:00", "Z") if value is not None else None


def _bounds(start, end, zone="UTC"):
    if zone != "UTC":
        if zone != "Asia/Kolkata" or not start or not end:
            raise HTTPException(422, "A report drill-down requires dated Asia/Kolkata bounds")
        return _report_period(start, end, zone)[0]
    lower, upper = _date(start), _date(end)
    if end and len(end) == 10:
        upper += 86400
    elif upper is not None:
        upper += .000001
    if lower is not None and upper is not None and lower >= upper:
        raise HTTPException(422, "Date range is reversed")
    return lower, upper


def _dated(query, column, bounds):
    lower, upper = bounds
    if lower is not None:
        query = query.filter(column >= lower)
    if upper is not None:
        query = query.filter(column < upper)
    return query


def _owned(db, model, item_id, owner):
    item = db.query(model).filter_by(id=item_id, owner_user_id=owner).first()
    if item is None:
        raise HTTPException(404, "CRM item not found")
    return item


def _profile(payload, legacy=False):
    if not isinstance(payload, dict):
        raise HTTPException(422, "Profile must be an object")
    result = {k: payload[k] for k in PROFILE_FIELDS if k in payload}
    if legacy:
        aliases = {"company": ("title", "name", "companyName"), "phone": ("phoneNumber",), "contactPerson": ("contact",), "industry": ("categoryName", "category"), "website": ("url",)}
        for field, names in aliases.items():
            if not result.get(field):
                result[field] = next((payload[n] for n in names if payload.get(n)), "")
        if not result.get("email") and isinstance(payload.get("emails"), list):
            result["email"] = next((x for x in payload["emails"] if isinstance(x, str)), "")
    for key, value in result.items():
        if key == "additionalContacts":
            if not isinstance(value, list) or len(value) > 100 or any(not isinstance(x, (dict, str)) for x in value):
                raise HTTPException(422, "Invalid additional contacts")
        elif key in ("emailOptOut", "phoneOptOut"):
            if not isinstance(value, bool):
                raise HTTPException(422, "Opt-out flags must be boolean")
        elif value is not None and not isinstance(value, (str, int, float)):
            raise HTTPException(422, "Invalid profile field")
        if isinstance(value, float) and not math.isfinite(value):
            raise HTTPException(422, "Profile numbers must be finite")
        try:
            serialized = json.dumps(value, allow_nan=False)
        except (ValueError, TypeError):
            raise HTTPException(422, "Profile fields must contain valid JSON") from None
        if len(serialized) > 12000:
            raise HTTPException(422, "Profile field too large")
    if "followUpDate" in result:
        result["followUpDate"] = _iso(_date(result["followUpDate"]))
    return result


def _legacy_stage(value):
    value = str(value or "new").strip().lower().replace("-", "_").replace(" ", "_")
    aliases = {"contacted": "attempted", "followup": "follow_up", "interested": "qualified", "closed": "review_required", "client": "review_required", "won": "review_required", "converted": "review_required"}
    return aliases.get(value, value if value in STAGES else "review_required")


def _record_json(db, item, sources=None):
    profile = {key: "" for key in PROFILE_FIELDS}
    profile.update({"additionalContacts": [], "followUpDate": None, "emailOptOut": False, "phoneOptOut": False})
    profile.update(_load(item.profile, {}))
    return {"id": item.id, "version": item.version, "stage": item.stage, "profile": profile,
            "createdAt": _iso(item.created_at), "updatedAt": _iso(item.updated_at), "lastContactAt": _iso(item.last_contact_at),
            "sourceIds": [{"source": m.source, "sourceId": m.source_id} for m in (sources if sources is not None else db.query(CRMSource).filter_by(owner_user_id=item.owner_user_id, record_id=item.id).all())]}


def _deal_json(item):
    return {"id": item.id, "recordId": item.record_id, "version": item.version, "name": item.name, "serviceType": item.service_type,
            "monthlyAmount": item.monthly_amount, "durationMonths": item.duration_months, "expectedCloseDate": _iso(item.expected_close_date),
            "contractStartDate": _iso(item.contract_start_date), "contractEndDate": _iso(item.contract_end_date),
            "stage": item.stage, "nextStep": item.next_step, "probability": item.probability, "lossReason": item.loss_reason,
            "archived": item.archived, "createdAt": _iso(item.created_at), "updatedAt": _iso(item.updated_at), "wonAt": _iso(item.won_at)}


def _task_json(item):
    return {"id": item.id, "recordId": item.record_id, "version": item.version, "title": item.title, "kind": item.kind,
            "dueAt": _iso(item.due_at), "status": item.status, "notes": item.notes, "archived": item.archived,
            "createdAt": _iso(item.created_at), "updatedAt": _iso(item.updated_at)}


def _activity_json(item):
    return {"id": item.id, "version": item.version, "recordId": item.record_id, "kind": item.kind, "note": item.note, "channel": item.channel,
            "outcome": item.outcome, "evidence": item.evidence, "occurredAt": _iso(item.occurred_at), "createdAt": _iso(item.created_at),
            "recipient": item.recipient, "noteHistory": _load(item.note_history, [])}


def _activity(db, owner, record_id, kind, note, occurred_at=None, **fields):
    item = CRMActivity(id=_id(), owner_user_id=owner, record_id=record_id, kind=kind, note=note or "",
                       occurred_at=occurred_at, created_at=time.time(), **fields)
    db.add(item)
    db.flush()
    return item


def _cas(db, item, version, values):
    if version != item.version:
        raise HTTPException(409, "CRM item changed; refresh before saving")
    changed = db.query(type(item)).filter_by(id=item.id, owner_user_id=item.owner_user_id, version=version).update(
        {**values, "version": version + 1}, synchronize_session=False)
    if changed != 1:
        raise HTTPException(409, "CRM item changed; refresh before saving")
    db.expire(item)
    return item


def upsert_lead(db, owner_user_id, source_id, payload, created_at=None, source="backend"):
    """Stable explicit IDs only; never merge companies or overwrite manually edited fields."""
    source_id = str(source_id).strip()
    if not source_id or len(source_id) > 256 or len(source) > 32:
        raise HTTPException(422, "A bounded source ID is required")
    mapping = db.query(CRMSource).filter_by(owner_user_id=owner_user_id, source=source, source_id=source_id).first()
    # Backend/browser IDs denote the same lead only when the IDs are exactly equal.
    if not mapping and source in ("backend", "cloud", "local", "supabase"):
        mapping = db.query(CRMSource).filter(CRMSource.owner_user_id == owner_user_id, CRMSource.source_id == source_id,
                                            CRMSource.source.in_(("backend", "cloud", "local", "supabase"))).first()
    incoming = _profile(payload.get("profile", payload), legacy=True)
    now = time.time()
    if mapping:
        record = _owned(db, CRMRecord, mapping.record_id, owner_user_id)
        current = _load(record.profile, {})
        manual = set(_load(record.manual_fields, []))
        changes = {k: v for k, v in incoming.items() if k not in manual and v not in (None, "", []) and current.get(k) != v}
        if changes:
            current.update(changes)
            _cas(db, record, record.version, {"profile": json.dumps(current), "updated_at": now})
        if not db.query(CRMSource).filter_by(owner_user_id=owner_user_id, source=source, source_id=source_id).first():
            db.add(CRMSource(id=_id(), owner_user_id=owner_user_id, record_id=record.id, source=source, source_id=source_id))
    else:
        date = _historical_date(created_at if created_at is not None else payload.get("createdAt", payload.get("timestamp")))
        record = CRMRecord(id=_id(), owner_user_id=owner_user_id, version=1, stage=_legacy_stage(payload.get("stage", payload.get("status"))),
                           profile=json.dumps(incoming), manual_fields="[]", created_at=date, updated_at=_historical_date(payload.get("updatedAt")))
        db.add(record)
        db.flush()
        db.add(CRMSource(id=_id(), owner_user_id=owner_user_id, record_id=record.id, source=source, source_id=source_id))
    db.flush()
    remarks = payload.get("remarks", payload.get("remark"))
    if isinstance(remarks, str) and remarks.strip():
        key = "legacy-note:" + record.id + ":" + hashlib.sha256(remarks.encode()).hexdigest()
        if not db.query(CRMActivity).filter_by(owner_user_id=owner_user_id, idempotency_key=key).first():
            _activity(db, owner_user_id, record.id, "remark", remarks[:12000], _historical_date(payload.get("remarksAt")), evidence="manual", idempotency_key=key)
    return record


def _recipient_records(db, owner, recipient):
    # Exact contact identity; ambiguous shared inboxes stay unattached to avoid misattribution.
    normalized = str(recipient or "").strip().casefold()
    if not normalized:
        return []
    matches = []
    for record in db.query(CRMRecord).filter_by(owner_user_id=owner).yield_per(250):
        profile = _load(record.profile, {})
        contacts = [profile.get(k) for k in ("email", "secondaryEmail", "phone", "mobile")]
        for contact in profile.get("additionalContacts", []):
            contacts.extend(contact.get(k) for k in ("email", "phone", "mobile")) if isinstance(contact, dict) else contacts.append(contact)
        if any(str(c or "").strip().casefold() == normalized for c in contacts):
            matches.append(record)
    return matches


def record_outreach(db, owner_user_id, record_id=None, recipient=None, channel="email", outcome="sent", evidence="provider", provider_id=None, note=None, occurred_at=None, idempotency_key=None):
    recipient = str(recipient).strip().casefold() if recipient else None
    if channel not in ("email", "whatsapp", "sms", "call") or outcome not in ("sent", "failed", "unknown", "user_confirmed"):
        raise HTTPException(422, "Invalid outreach event")
    if evidence not in ("provider", "pending", "server", "manual", "user_confirmation", "legacy_unverified"):
        raise HTTPException(422, "Invalid outreach evidence")
    if outcome == "sent" and (evidence != "provider" or not provider_id):
        raise HTTPException(422, "Provider-confirmed sends need a provider receipt")
    if outcome == "user_confirmed" and (channel != "whatsapp" or evidence != "user_confirmation"):
        raise HTTPException(422, "User confirmation is supported for WhatsApp")
    if record_id:
        record = _owned(db, CRMRecord, record_id, owner_user_id)
    else:
        matches = _recipient_records(db, owner_user_id, recipient)
        record = matches[0] if len(matches) == 1 else None
        record_id = record.id if record else None
    key = idempotency_key or (f"provider:{channel}:{provider_id}:{outcome}" if provider_id else None)
    if key and len(key) > 256:
        raise HTTPException(422, "Idempotency key too long")
    existing = db.query(CRMActivity).filter_by(owner_user_id=owner_user_id, channel=channel, provider_id=provider_id, outcome="sent").first() if provider_id else None
    if existing is None and key:
        existing = db.query(CRMActivity).filter_by(owner_user_id=owner_user_id, idempotency_key=key).first()
    if existing:
        if existing.channel != channel or (existing.recipient or "").casefold() != (recipient or "").casefold() or (record_id and existing.record_id != record_id):
            raise HTTPException(409, "Idempotency key belongs to another event")
        if existing.outcome == "unknown" and outcome in ("sent", "failed"):
            existing.version += 1
            existing.outcome, existing.evidence, existing.provider_id = outcome, evidence, provider_id
            existing.note = note or existing.note
            existing.occurred_at = _date(occurred_at) if occurred_at is not None else time.time()
            item = existing
        else:
            return existing
    else:
        item = _activity(db, owner_user_id, record_id, "outreach", note, _date(occurred_at) if occurred_at is not None else time.time(),
                         recipient=recipient, channel=channel, outcome=outcome, evidence=evidence, provider_id=provider_id, idempotency_key=key)
    if record and outcome in ("sent", "user_confirmed"):
        values = {"last_contact_at": max(record.last_contact_at or 0, item.occurred_at or 0), "updated_at": time.time()}
        if record.stage == "new":
            values["stage"] = "attempted"
        _cas(db, record, record.version, values)
    db.flush()
    return item


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class RecordPatch(StrictModel):
    version: int = Field(ge=1)
    profile: Optional[dict] = None
    stage: Optional[str] = None


class DealWrite(StrictModel):
    recordId: Optional[str] = Field(default=None, max_length=36)
    version: Optional[int] = Field(default=None, ge=1)
    name: Optional[str] = Field(default=None, min_length=1, max_length=200)
    serviceType: Optional[str] = Field(default=None, max_length=200)
    monthlyAmount: Optional[float] = Field(default=None, ge=0, allow_inf_nan=False)
    durationMonths: Optional[int] = Field(default=None, ge=1, le=1200)
    expectedCloseDate: Optional[str] = None
    contractStartDate: Optional[str] = None
    contractEndDate: Optional[str] = None
    stage: Optional[str] = None
    nextStep: Optional[str] = Field(default=None, max_length=4000)
    probability: Optional[float] = Field(default=None, ge=0, le=100, allow_inf_nan=False)
    lossReason: Optional[str] = Field(default=None, max_length=4000)
    archived: Optional[bool] = None


class TaskWrite(StrictModel):
    recordId: Optional[str] = Field(default=None, max_length=36)
    version: Optional[int] = Field(default=None, ge=1)
    title: Optional[str] = Field(default=None, min_length=1, max_length=200)
    kind: Optional[str] = None
    dueAt: Optional[str] = None
    status: Optional[str] = None
    notes: Optional[str] = Field(default=None, max_length=12000)
    archived: Optional[bool] = None


class ActivityWrite(StrictModel):
    kind: str
    note: str = Field(default="", max_length=12000)
    channel: Optional[str] = None
    outcome: Optional[str] = Field(default=None, max_length=80)
    idempotencyKey: Optional[str] = Field(default=None, min_length=1, max_length=128)
    occurredAt: Optional[str] = None


class ActivityPatch(StrictModel):
    version: int = Field(ge=1)
    note: str = Field(max_length=12000)


class BootstrapWrite(StrictModel):
    source: str = "cloud"
    records: list[dict] = Field(default_factory=list, max_length=250)
    activities: list[dict] = Field(default_factory=list, max_length=250)
    snapshotUserId: Optional[str] = None
    cursor: Optional[str] = Field(default=None, max_length=64)

    @field_validator("records", "activities")
    @classmethod
    def bounded_payload(cls, value):
        if len(json.dumps(value, allow_nan=False)) > 4000000:
            raise ValueError("Import chunk too large")
        return value


def _page(query, offset, limit, serialize, key):
    total = query.count()
    return {key: [serialize(row) for row in query.offset(offset).limit(limit).all()], "total": total, "offset": offset, "limit": limit}


def _record_query(db, owner, search, stage, view, bounds):
    query = db.query(CRMRecord).filter_by(owner_user_id=owner)
    if search:
        query = query.filter(CRMRecord.profile.ilike("%" + search + "%"))
    if stage:
        if stage not in STAGES:
            raise HTTPException(422, "Invalid record stage")
        query = query.filter(CRMRecord.stage == stage)
    if view == "clients":
        won = _dated(db.query(CRMDeal.record_id).filter_by(owner_user_id=owner, archived=False, stage="won"), CRMDeal.won_at, bounds)
        query = query.filter(CRMRecord.id.in_(won))
    else:
        if view not in (None, "leads"):
            raise HTTPException(422, "Invalid record view")
        if view == "leads":
            query = query.filter(CRMRecord.stage != "client")
        query = _dated(query, CRMRecord.created_at, bounds)
    return query


@router.get("/records")
def records(search: str = Query("", max_length=200), stage: Optional[str] = None, view: Optional[str] = None,
            offset: int = Query(0, ge=0), limit: int = Query(50, ge=1, le=250),
            start: Optional[str] = Query(None, alias="from"), end: Optional[str] = Query(None, alias="to"),
            timezoneName: str = Query("UTC", alias="timezone"), db: Session = Depends(get_db), user: UserAccount = Depends(get_current_user)):
    query = _record_query(db, user.id, search, stage, view, _bounds(start, end, timezoneName)).order_by(CRMRecord.created_at.desc(), CRMRecord.id)
    total = query.count()
    rows = query.offset(offset).limit(limit).all()
    sources = {}
    if rows:
        for source in db.query(CRMSource).filter(CRMSource.owner_user_id == user.id, CRMSource.record_id.in_([r.id for r in rows])):
            sources.setdefault(source.record_id, []).append(source)
    return {"records": [_record_json(db, r, sources.get(r.id, [])) for r in rows], "total": total, "offset": offset, "limit": limit}


@router.get("/records/{record_id}")
def record_detail(record_id: str, db: Session = Depends(get_db), user: UserAccount = Depends(get_current_user)):
    item = _owned(db, CRMRecord, record_id, user.id)
    return {**_record_json(db, item), "deals": [_deal_json(x) for x in db.query(CRMDeal).filter_by(owner_user_id=user.id, record_id=record_id).all()],
            "tasks": [_task_json(x) for x in db.query(CRMTask).filter_by(owner_user_id=user.id, record_id=record_id).all()],
            "activities": [_activity_json(x) for x in db.query(CRMActivity).filter_by(owner_user_id=user.id, record_id=record_id).order_by(CRMActivity.created_at.desc()).all()]}


@router.patch("/records/{record_id}")
def patch_record(record_id: str, body: RecordPatch, db: Session = Depends(get_db), user: UserAccount = Depends(get_current_user)):
    item = _owned(db, CRMRecord, record_id, user.id)
    changes = {"updated_at": time.time()}
    before = _record_json(db, item)
    if body.stage is not None:
        if body.stage not in STAGES:
            raise HTTPException(422, "Invalid record stage")
        won = db.query(CRMDeal).filter_by(owner_user_id=user.id, record_id=record_id, stage="won", archived=False).first()
        if body.stage == "client" and not won:
            raise HTTPException(422, "Client status requires an active Won deal")
        if won and body.stage != "client":
            raise HTTPException(422, "Active Won deals determine client status")
        changes["stage"] = body.stage
    if body.profile is not None:
        if set(body.profile) - set(PROFILE_FIELDS):
            raise HTTPException(422, "Unknown profile field")
        profile = _load(item.profile, {})
        profile.update(_profile(body.profile))
        changes.update(profile=json.dumps(profile), manual_fields=json.dumps(sorted(set(_load(item.manual_fields, [])) | set(body.profile))))
    _cas(db, item, body.version, changes)
    _activity(db, user.id, item.id, "record_updated", json.dumps({"before": before, "changes": body.model_dump(exclude_none=True)}), time.time())
    db.commit()
    return _record_json(db, item)


@router.post("/records/{record_id}/activities", status_code=201)
def create_activity(record_id: str, body: ActivityWrite, db: Session = Depends(get_db), user: UserAccount = Depends(get_current_user)):
    record = _owned(db, CRMRecord, record_id, user.id)
    if body.kind not in ("remark", "conversation", "outreach") or not body.note.strip():
        raise HTTPException(422, "Choose an activity kind and enter a note")
    occurred_at = _date(body.occurredAt) if body.occurredAt else time.time()
    if occurred_at > time.time() + 300:
        raise HTTPException(422, "Activity time cannot be in the future")
    if body.kind == "outreach":
        if body.outcome not in ("failed", "unknown", "user_confirmed"):
            raise HTTPException(422, "Browser logs cannot claim provider-confirmed delivery")
        item = record_outreach(db, user.id, record_id, channel=body.channel or "email", outcome=body.outcome,
                               evidence="user_confirmation" if body.outcome == "user_confirmed" else "manual", note=body.note,
                               occurred_at=occurred_at,
                               idempotency_key=("manual:" + body.idempotencyKey) if body.idempotencyKey else None)
    else:
        if body.kind == "conversation" and body.outcome not in CONVERSATION_OUTCOMES:
            raise HTTPException(422, "A conversation requires a confirmed conversation outcome")
        if body.channel and body.channel not in ("email", "whatsapp", "sms", "call", "meeting"):
            raise HTTPException(422, "Invalid conversation channel")
        key = "manual:" + body.idempotencyKey if body.idempotencyKey else None
        item = db.query(CRMActivity).filter_by(owner_user_id=user.id, idempotency_key=key).first() if key else None
        if item and (item.record_id != record_id or item.kind != body.kind):
            raise HTTPException(409, "Idempotency key belongs to another activity")
        if not item:
            item = _activity(db, user.id, record_id, body.kind, body.note, occurred_at, channel=body.channel, outcome=body.outcome,
                             evidence="manual", idempotency_key=key)
            if body.kind == "conversation" and body.outcome in ("connected", "replied", "meeting", "qualified", "follow_up"):
                values = {"updated_at": time.time(), "last_contact_at": item.occurred_at}
                if record.stage in ("new", "attempted"):
                    values["stage"] = "connected"
                _cas(db, record, record.version, values)
    db.commit()
    return _activity_json(item)


@router.patch("/activities/{activity_id}")
def patch_activity(activity_id: str, body: ActivityPatch, db: Session = Depends(get_db), user: UserAccount = Depends(get_current_user)):
    item = _owned(db, CRMActivity, activity_id, user.id)
    if item.evidence != "manual" or item.kind not in ("remark", "conversation", "outreach"):
        raise HTTPException(422, "Verified and audit events cannot be edited")
    history = _load(item.note_history, [])
    history.append({"note": item.note, "editedAt": _iso(time.time())})
    _cas(db, item, body.version, {"note_history": json.dumps(history), "note": body.note})
    db.commit()
    return _activity_json(item)


def _entity_query(db, model, owner, record_id, search, bounds, stage=None, status=None, kind=None):
    query = db.query(model).filter_by(owner_user_id=owner, archived=False)
    if record_id:
        _owned(db, CRMRecord, record_id, owner)
        query = query.filter_by(record_id=record_id)
    if search:
        query = query.filter((model.name if model is CRMDeal else model.title).ilike("%" + search + "%"))
    if stage:
        if stage not in (*DEAL_STAGES, "open"):
            raise HTTPException(422, "Invalid deal stage")
        query = query.filter(model.stage.in_(DEAL_STAGES[:3])) if stage == "open" else query.filter_by(stage=stage)
    if status:
        if status not in ("open", "completed"):
            raise HTTPException(422, "Invalid task status")
        query = query.filter_by(status=status)
    if kind:
        if kind not in ("task", "meeting"):
            raise HTTPException(422, "Invalid task kind")
        query = query.filter_by(kind=kind)
    column = model.due_at if model is CRMTask else model.won_at if stage == "won" else model.created_at
    return _dated(query, column, bounds)


@router.get("/deals")
def deals(recordId: Optional[str] = None, search: str = Query("", max_length=200), stage: Optional[str] = None,
          offset: int = Query(0, ge=0), limit: int = Query(50, ge=1, le=250), start: Optional[str] = Query(None, alias="from"),
          end: Optional[str] = Query(None, alias="to"), timezoneName: str = Query("UTC", alias="timezone"), db: Session = Depends(get_db), user: UserAccount = Depends(get_current_user)):
    query = _entity_query(db, CRMDeal, user.id, recordId, search, _bounds(start, end, timezoneName), stage=stage).order_by(CRMDeal.updated_at.desc(), CRMDeal.id)
    return _page(query, offset, limit, _deal_json, "deals")


@router.get("/tasks")
def tasks(recordId: Optional[str] = None, search: str = Query("", max_length=200), status: Optional[str] = None, kind: Optional[str] = None,
          offset: int = Query(0, ge=0), limit: int = Query(50, ge=1, le=250), start: Optional[str] = Query(None, alias="from"),
          end: Optional[str] = Query(None, alias="to"), db: Session = Depends(get_db), user: UserAccount = Depends(get_current_user)):
    query = _entity_query(db, CRMTask, user.id, recordId, search, _bounds(start, end), status=status, kind=kind).order_by(CRMTask.due_at, CRMTask.id)
    return _page(query, offset, limit, _task_json, "tasks")


def _deal_values(body, create=False):
    data = body.model_dump(exclude_unset=True)
    if create and (not data.get("name", "").strip() or not data.get("recordId")):
        raise HTTPException(422, "A record and deal name are required")
    if "name" in data and (data["name"] is None or not data["name"].strip()):
        raise HTTPException(422, "Deal name is required")
    if "stage" in data and data["stage"] not in DEAL_STAGES:
        raise HTTPException(422, "Invalid deal stage")
    names = {"serviceType": "service_type", "monthlyAmount": "monthly_amount", "durationMonths": "duration_months",
             "expectedCloseDate": "expected_close_date", "contractStartDate": "contract_start_date", "contractEndDate": "contract_end_date",
             "nextStep": "next_step", "lossReason": "loss_reason"}
    values = {names.get(k, k): v for k, v in data.items() if k not in ("recordId", "version")}
    if "expected_close_date" in values:
        values["expected_close_date"] = _date(values["expected_close_date"])
    for key in ("contract_start_date", "contract_end_date"):
        if key in values:
            if values[key] is not None:
                try:
                    if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", values[key]): raise ValueError()
                    values[key] = datetime.combine(date.fromisoformat(values[key]), datetime.min.time(), timezone.utc).timestamp()
                except (ValueError, TypeError):
                    raise HTTPException(422, "Contract dates must use YYYY-MM-DD")
    for key in ("service_type", "next_step", "loss_reason", "archived"):
        if key in values and values[key] is None:
            raise HTTPException(422, "Required deal field cannot be null")
    return values


def _validate_contract_dates(values, item=None):
    start = values.get("contract_start_date", getattr(item, "contract_start_date", None))
    end = values.get("contract_end_date", getattr(item, "contract_end_date", None))
    if start is not None and end is not None and end < start:
        raise HTTPException(422, "Contract end cannot be before its start")


def _client_stage(db, owner, record_id):
    db.flush()
    record = _owned(db, CRMRecord, record_id, owner)
    won = db.query(CRMDeal).filter_by(owner_user_id=owner, record_id=record_id, stage="won", archived=False).first()
    stage = "client" if won else "qualified" if record.stage == "client" else record.stage
    if stage != record.stage:
        _cas(db, record, record.version, {"stage": stage, "updated_at": time.time()})


@router.post("/deals", status_code=201)
def create_deal(body: DealWrite, db: Session = Depends(get_db), user: UserAccount = Depends(get_current_user)):
    values = _deal_values(body, create=True)
    _validate_contract_dates(values)
    _owned(db, CRMRecord, body.recordId, user.id)
    now = time.time()
    item = CRMDeal(id=_id(), owner_user_id=user.id, record_id=body.recordId, created_at=now, updated_at=now,
                   won_at=now if values.get("stage") == "won" else None, **values)
    db.add(item)
    db.flush()
    _client_stage(db, user.id, body.recordId)
    _activity(db, user.id, body.recordId, "deal_created", json.dumps(_deal_json(item)), now)
    db.commit()
    return _deal_json(item)


@router.patch("/deals/{deal_id}")
def patch_deal(deal_id: str, body: DealWrite, db: Session = Depends(get_db), user: UserAccount = Depends(get_current_user)):
    item = _owned(db, CRMDeal, deal_id, user.id)
    if body.recordId is not None and body.recordId != item.record_id:
        raise HTTPException(422, "Deal record cannot change")
    values = _deal_values(body)
    _validate_contract_dates(values, item)
    before = _deal_json(item)
    now = time.time()
    if "stage" in values and values["stage"] != item.stage:
        values["won_at"] = now if values["stage"] == "won" else None
    _cas(db, item, body.version, {**values, "updated_at": now})
    _client_stage(db, user.id, item.record_id)
    _activity(db, user.id, item.record_id, "deal_updated", json.dumps({"before": before, "after": _deal_json(item)}), now)
    db.commit()
    return _deal_json(item)


def _task_values(body, create=False):
    data = body.model_dump(exclude_unset=True)
    if create and (not data.get("title", "").strip() or not data.get("recordId")):
        raise HTTPException(422, "A record and task title are required")
    if "title" in data and (data["title"] is None or not data["title"].strip()):
        raise HTTPException(422, "Task title is required")
    if "kind" in data and data["kind"] not in ("task", "meeting"):
        raise HTTPException(422, "Invalid task kind")
    if "status" in data and data["status"] not in ("open", "completed"):
        raise HTTPException(422, "Invalid task status")
    values = {({"dueAt": "due_at"}.get(k, k)): v for k, v in data.items() if k not in ("recordId", "version")}
    if "due_at" in values:
        values["due_at"] = _date(values["due_at"])
    for key in ("notes", "archived"):
        if key in values and values[key] is None:
            raise HTTPException(422, "Required task field cannot be null")
    return values


@router.post("/tasks", status_code=201)
def create_task(body: TaskWrite, db: Session = Depends(get_db), user: UserAccount = Depends(get_current_user)):
    values = _task_values(body, create=True)
    _owned(db, CRMRecord, body.recordId, user.id)
    now = time.time()
    item = CRMTask(id=_id(), owner_user_id=user.id, record_id=body.recordId, created_at=now, updated_at=now, **values)
    db.add(item)
    db.flush()
    _activity(db, user.id, body.recordId, "task_created", json.dumps(_task_json(item)), now)
    if item.kind == "meeting" and body.dueAt and "T" in body.dueAt:
        from api.crm_automation import link_task
        link_task(db, item)
    db.commit()
    return _task_json(item)


@router.patch("/tasks/{task_id}")
def patch_task(task_id: str, body: TaskWrite, db: Session = Depends(get_db), user: UserAccount = Depends(get_current_user)):
    item = _owned(db, CRMTask, task_id, user.id)
    if body.recordId is not None and body.recordId != item.record_id:
        raise HTTPException(422, "Task record cannot change")
    before = _task_json(item)
    _cas(db, item, body.version, {**_task_values(body), "updated_at": time.time()})
    _activity(db, user.id, item.record_id, "task_updated", json.dumps({"before": before, "after": _task_json(item)}), time.time())
    from api.crm_automation import MeetingLink, link_task, sync_meeting
    link = db.get(MeetingLink, item.id)
    if link: sync_meeting(db, item, link)
    elif item.kind == "meeting" and body.dueAt and "T" in body.dueAt: link_task(db, item)
    db.commit()
    return _task_json(item)


def _activity_query(db, owner, bounds, record_id=None, search="", kind=None, channel=None, outcome=None):
    query = db.query(CRMActivity).filter_by(owner_user_id=owner)
    if record_id:
        _owned(db, CRMRecord, record_id, owner)
        query = query.filter_by(record_id=record_id)
    if search:
        query = query.filter(or_(CRMActivity.note.ilike("%" + search + "%"), CRMActivity.recipient.ilike("%" + search + "%")))
    for key, value in (("kind", kind), ("channel", channel), ("outcome", outcome)):
        if value:
            column = getattr(CRMActivity, key)
            query = query.filter(or_(column == value, column.is_(None), column == "") if value == "unknown" else column == value)
    return _dated(query, CRMActivity.occurred_at, bounds)


def _confirmed(query, kind=None):
    if kind == "conversation":
        return query.filter(CRMActivity.outcome.in_(CONVERSATION_OUTCOMES))
    return query.filter(or_(and_(CRMActivity.outcome.in_(("sent", "delivered")), CRMActivity.evidence == "provider"),
                            and_(CRMActivity.outcome == "user_confirmed", CRMActivity.evidence == "user_confirmation")))


@router.get("/activities")
def activities(recordId: Optional[str] = None, search: str = Query("", max_length=200), kind: Optional[str] = None,
               channel: Optional[str] = None, outcome: Optional[str] = None, confirmed: bool = False, uniqueRecipients: bool = False, offset: int = Query(0, ge=0), limit: int = Query(50, ge=1, le=250),
               start: Optional[str] = Query(None, alias="from"), end: Optional[str] = Query(None, alias="to"),
               timezoneName: str = Query("UTC", alias="timezone"), db: Session = Depends(get_db), user: UserAccount = Depends(get_current_user)):
    query = _activity_query(db, user.id, _bounds(start, end, timezoneName), recordId, search, kind, channel, outcome)
    if confirmed:
        query = _confirmed(query, kind)
    if uniqueRecipients:
        query = _confirmed(query.filter_by(kind="outreach")).filter(or_(CRMActivity.recipient.isnot(None), CRMActivity.record_id.isnot(None)))
        recipient = func.coalesce(func.nullif(func.lower(func.trim(CRMActivity.recipient)), ""), CRMActivity.record_id)
        representatives = query.with_entities(func.min(CRMActivity.id)).group_by(recipient)
        query = query.filter(CRMActivity.id.in_(representatives))
    query = query.order_by(CRMActivity.occurred_at.desc(), CRMActivity.id)
    return _page(query, offset, limit, _activity_json, "activities")


def _confirmed_outreach():
    return or_(and_(CRMActivity.outcome.in_(("sent", "delivered")), CRMActivity.evidence == "provider"),
               and_(CRMActivity.outcome == "user_confirmed", CRMActivity.evidence == "user_confirmation"))


def _daily_counts(query, column, offset=0, amount=None):
    # Numeric day buckets work on both SQLite and PostgreSQL. Only aggregates
    # cross the database boundary, never an unbounded list of entity objects.
    bucket = func.floor((column + offset) / 86400.0)
    columns = [bucket, func.count()]
    if amount is not None:
        columns += [func.coalesce(func.sum(amount), 0), func.sum(case((amount.is_(None), 1), else_=0))]
    return [{"date": datetime.fromtimestamp(int(row[0]) * 86400, timezone.utc).date().isoformat(), "count": row[1],
             **({"monthlyValue": round(row[2], 2), "missingAmounts": row[3]} if amount is not None else {})}
            for row in query.filter(column.isnot(None)).with_entities(*columns).group_by(bucket).order_by(bucket)]


def _value_totals(query):
    count, amount, missing = query.with_entities(func.count(), func.coalesce(func.sum(CRMDeal.monthly_amount), 0),
                       func.coalesce(func.sum(case((CRMDeal.monthly_amount.is_(None), 1), else_=0)), 0)).one()
    return {"count": count, "monthlyValue": round(amount, 2), "missingAmounts": missing}


@router.get("/overview")
def overview(start: Optional[str] = Query(None, alias="from"), end: Optional[str] = Query(None, alias="to"),
             db: Session = Depends(get_db), user: UserAccount = Depends(get_current_user)):
    bounds = _bounds(start, end)
    lead_query = _record_query(db, user.id, "", None, "leads", bounds)
    intake_query = _dated(db.query(CRMRecord).filter_by(owner_user_id=user.id), CRMRecord.created_at, bounds)
    activity_query = _activity_query(db, user.id, bounds)
    outreach = activity_query.filter_by(kind="outreach")
    sent = outreach.filter(_confirmed_outreach())
    recipient = func.coalesce(func.nullif(func.lower(func.trim(CRMActivity.recipient)), ""), CRMActivity.record_id)
    sent_count, unique_count = sent.with_entities(func.count(), func.count(func.distinct(recipient))).one()
    open_deals = _dated(db.query(CRMDeal).filter(CRMDeal.owner_user_id == user.id, CRMDeal.archived == False,
                       CRMDeal.stage.in_(DEAL_STAGES[:3])), CRMDeal.created_at, bounds)
    open_values = _value_totals(open_deals)
    won_values = _value_totals(_entity_query(db, CRMDeal, user.id, None, "", bounds, stage="won"))
    metrics = {"leads": lead_query.count(), "conversations": activity_query.filter_by(kind="conversation").filter(CRMActivity.outcome.in_(CONVERSATION_OUTCOMES)).count(),
               "pendingFollowUps": _entity_query(db, CRMTask, user.id, None, "", bounds, status="open").count(),
               "clients": _record_query(db, user.id, "", None, "clients", bounds).count(), "messagesSent": sent_count,
               "uniqueRecipients": unique_count, "pipelineMonthlyValue": open_values["monthlyValue"],
               "wonMonthlyValue": won_values["monthlyValue"], "incompleteDealValues": open_values["missingAmounts"] + won_values["missingAmounts"]}
    stage_counts = dict(intake_query.with_entities(CRMRecord.stage, func.count(CRMRecord.id)).group_by(CRMRecord.stage).all())
    outcome_counts = outreach.with_entities(CRMActivity.channel, CRMActivity.outcome, func.count()).group_by(CRMActivity.channel, CRMActivity.outcome).all()
    return {"metrics": metrics, "stages": [{"stage": stage, "count": stage_counts.get(stage, 0)} for stage in STAGES],
            "intake": _daily_counts(intake_query, CRMRecord.created_at),
            "outreach": [{"channel": ch, "outcome": outcome, "count": n} for ch, outcome, n in outcome_counts],
            "recentActivity": [_activity_json(row) for row in activity_query.order_by(CRMActivity.occurred_at.desc(), CRMActivity.id).limit(20)]}


@router.get("/usage")
def usage(start: Optional[str] = Query(None, alias="from"), end: Optional[str] = Query(None, alias="to"),
          db: Session = Depends(get_db), user: UserAccount = Depends(get_current_user)):
    from api.developer_insights import ProductSession
    bounds = _bounds(start, end)
    sessions = _dated(db.query(ProductSession).filter_by(user_id=user.id), ProductSession.started_at, bounds)
    session_dates = {row["date"]: row["count"] for row in _daily_counts(sessions, ProductSession.started_at)}
    activity_dates = {row["date"]: row["count"] for row in _daily_counts(_activity_query(db, user.id, bounds), CRMActivity.occurred_at)}
    first_session = db.query(func.min(ProductSession.started_at)).filter_by(user_id=user.id).scalar()
    first_activity = db.query(func.min(CRMActivity.occurred_at)).filter_by(owner_user_id=user.id).scalar()
    known = [d for d in (first_session, first_activity) if d is not None]
    return {"days": [{"date": d, "sessions": session_dates.get(d, 0), "activities": activity_dates.get(d, 0)} for d in sorted(set(session_dates) | set(activity_dates))],
            "historyKnownFrom": datetime.fromtimestamp(min(known), timezone.utc).date().isoformat() if known else None}


def _report_period(start, end, zone):
    offsets = {"Asia/Kolkata": 19800, "UTC": 0}
    if zone not in offsets:
        raise HTTPException(422, "Supported report timezones are Asia/Kolkata and UTC")
    offset = offsets[zone]
    today = datetime.now(timezone(timedelta(seconds=offset))).date()
    try:
        if any(value and not re.fullmatch(r"\d{4}-\d{2}-\d{2}", value) for value in (start, end)): raise ValueError()
        to_date = date.fromisoformat(end) if end else today
        from_date = date.fromisoformat(start) if start else to_date - timedelta(days=29)
    except ValueError:
        raise HTTPException(422, "Report dates must use YYYY-MM-DD")
    days = (to_date - from_date).days + 1
    if not 1 <= days <= 366:
        raise HTTPException(422, "Choose an ordered date range of at most 366 days")
    local_zone = timezone(timedelta(seconds=offset))
    lower = datetime.combine(from_date, datetime.min.time(), local_zone).timestamp()
    upper = datetime.combine(to_date + timedelta(days=1), datetime.min.time(), local_zone).timestamp()
    return (lower, upper), from_date.isoformat(), to_date.isoformat(), offset


@router.get("/reports")
def reports(start: Optional[str] = Query(None, alias="from"), end: Optional[str] = Query(None, alias="to"),
            timezoneName: str = Query("Asia/Kolkata", alias="timezone"), db: Session = Depends(get_db), user: UserAccount = Depends(get_current_user)):
    bounds, from_date, to_date, offset = _report_period(start, end, timezoneName)
    owned_records = db.query(CRMRecord).filter_by(owner_user_id=user.id)
    intake = _dated(owned_records, CRMRecord.created_at, bounds)
    owned_deals = db.query(CRMDeal).filter_by(owner_user_id=user.id, archived=False)
    won = _dated(owned_deals.filter_by(stage="won"), CRMDeal.won_at, bounds)
    pipeline = _value_totals(owned_deals.filter(CRMDeal.stage.in_(DEAL_STAGES[:3])))
    won_values = _value_totals(won)
    outreach = _activity_query(db, user.id, bounds).filter_by(kind="outreach")
    stage_counts = dict(owned_records.with_entities(CRMRecord.stage, func.count()).group_by(CRMRecord.stage).all())
    grouped = outreach.with_entities(CRMActivity.channel, CRMActivity.outcome, func.count(),
                  func.sum(case((_confirmed_outreach(), 1), else_=0))).group_by(CRMActivity.channel, CRMActivity.outcome).all()
    return {"period": {"from": from_date, "to": to_date, "timezone": timezoneName},
            "metrics": {"leadsAdded": intake.count(), "wonContracts": won_values["count"], "confirmedClients": _record_query(db, user.id, "", None, "clients", (None, None)).count(),
                        "wonMonthlyValue": won_values["monthlyValue"], "pipelineMonthlyValue": pipeline["monthlyValue"], "missingAmounts": won_values["missingAmounts"] + pipeline["missingAmounts"]},
            "intake": _daily_counts(intake, CRMRecord.created_at, offset),
            "wins": _daily_counts(won, CRMDeal.won_at, offset, CRMDeal.monthly_amount),
            "stages": [{"stage": stage, "count": stage_counts.get(stage, 0)} for stage in STAGES],
            "outreach": [{"channel": ch or "unknown", "outcome": outcome or "unknown", "count": n, "confirmed": confirmed} for ch, outcome, n, confirmed in grouped],
            "unknownDates": {"records": owned_records.filter(CRMRecord.created_at.is_(None)).count(),
                             "wins": owned_deals.filter_by(stage="won").filter(CRMDeal.won_at.is_(None)).count(),
                             "outreach": db.query(CRMActivity).filter_by(owner_user_id=user.id, kind="outreach").filter(CRMActivity.occurred_at.is_(None)).count()}}


def _renewal_state(deal, today):
    if deal.contract_end_date is None:
        return "missing"
    end = datetime.fromtimestamp(deal.contract_end_date, timezone.utc).date()
    if end < today:
        return "expired"
    return "due" if end <= today + timedelta(days=30) else "later"


@router.get("/clients")
def clients(search: str = Query("", max_length=200), renewal: str = "", offset: int = Query(0, ge=0), limit: int = Query(50, ge=1, le=100),
            db: Session = Depends(get_db), user: UserAccount = Depends(get_current_user)):
    if renewal not in ("", "due", "expired", "missing"):
        raise HTTPException(422, "Invalid renewal filter")
    today = datetime.now(timezone(timedelta(hours=5, minutes=30))).date()
    lower = datetime.combine(today, datetime.min.time(), timezone.utc).timestamp()
    upper = datetime.combine(today + timedelta(days=31), datetime.min.time(), timezone.utc).timestamp()
    won = db.query(CRMDeal).filter_by(owner_user_id=user.id, stage="won", archived=False)
    records_query = _record_query(db, user.id, search, None, "clients", (None, None))
    conditions = {"due": and_(CRMDeal.contract_end_date >= lower, CRMDeal.contract_end_date < upper),
                  "expired": CRMDeal.contract_end_date < lower, "missing": CRMDeal.contract_end_date.is_(None)}
    summary = {"clients": records_query.count()}
    for key, condition in conditions.items():
        summary[key] = records_query.filter(CRMRecord.id.in_(won.filter(condition).with_entities(CRMDeal.record_id))).count()
    if renewal:
        records_query = records_query.filter(CRMRecord.id.in_(won.filter(conditions[renewal]).with_entities(CRMDeal.record_id)))
    total = records_query.count()
    value_query = won.filter(CRMDeal.record_id.in_(records_query.with_entities(CRMRecord.id)))
    summary.update(_value_totals(value_query))
    rows = records_query.order_by(CRMRecord.updated_at.desc(), CRMRecord.id).offset(offset).limit(limit).all()
    ids = [r.id for r in rows]
    contracts, sources, followups = {}, {}, {}
    if ids:
        for deal in won.filter(CRMDeal.record_id.in_(ids)).order_by(CRMDeal.contract_end_date, CRMDeal.id):
            contracts.setdefault(deal.record_id, []).append({**_deal_json(deal), "renewalState": _renewal_state(deal, today)})
        for source in db.query(CRMSource).filter(CRMSource.owner_user_id == user.id, CRMSource.record_id.in_(ids)):
            sources.setdefault(source.record_id, []).append(source)
        ranked = db.query(CRMTask.record_id, CRMTask.id, CRMTask.title, CRMTask.kind, CRMTask.due_at,
                          func.row_number().over(partition_by=CRMTask.record_id, order_by=(CRMTask.due_at, CRMTask.id)).label("position")).filter(
                              CRMTask.owner_user_id == user.id, CRMTask.record_id.in_(ids), CRMTask.archived.is_(False),
                              CRMTask.status == "open", CRMTask.due_at.is_not(None)).subquery()
        for task in db.query(ranked).filter(ranked.c.position == 1):
            followups[task.record_id] = {"id": task.id, "title": task.title, "kind": task.kind, "dueAt": _iso(task.due_at)}
    return {"records": [{**_record_json(db, row, sources.get(row.id, [])), "contracts": contracts.get(row.id, []), "nextFollowUp": followups.get(row.id)} for row in rows],
            "summary": summary, "total": total, "offset": offset, "limit": limit, "asOf": today.isoformat()}


def ensure_crm_indexes():
    for table in (CRMRecord.__table__, CRMDeal.__table__, CRMTask.__table__, CRMActivity.__table__):
        for index in table.indexes:
            if index.name in {"ix_crm_records_owner_created", "ix_crm_deals_owner_stage_won", "ix_crm_deals_owner_renewal", "ix_crm_tasks_owner_due", "ix_crm_activity_owner_occurred"}:
                index.create(bind=engine, checkfirst=True)


def _snapshot_lists(payload, data_type=""):
    if isinstance(payload, dict):
        payload = payload.get("full_snapshot", payload)
    if isinstance(payload, list):
        return (payload, []) if "lead" in data_type.lower() else ([], payload) if data_type.lower() in ("activities", "outreach", "email_logs", "whatsapp_logs") else ([], [])
    if not isinstance(payload, dict):
        return [], []
    leads = payload.get("leads", payload.get("allLeads", []))
    activities = payload.get("activities", payload.get("outreach", []))
    return leads if isinstance(leads, list) else [], activities if isinstance(activities, list) else []


def _supabase_snapshot(user, credentials):
    url = os.getenv("SUPABASE_URL", "").strip().rstrip("/")
    key = os.getenv("SUPABASE_PUBLISHABLE_KEY", "").strip() or os.getenv("SUPABASE_ANON_KEY", "").strip()
    if not url or not key or not credentials:
        raise HTTPException(503, "Verified account cloud access is unavailable")
    try:
        response = httpx.get(url + "/rest/v1/clavis_user_data", headers={"apikey": key, "Authorization": "Bearer " + credentials.credentials},
                             params={"user_id": "eq." + user.id, "select": "user_id,payload"}, timeout=15)
        response.raise_for_status()
        rows = response.json()
        return next((row.get("payload") for row in rows if row.get("user_id") == user.id), {})
    except (httpx.HTTPError, ValueError, TypeError):
        raise HTTPException(503, "Account cloud snapshot could not be verified; migration can be resumed") from None


def _import_legacy(db, user, records, activities, source, trusted=False):
    counts = {"imported": 0, "reviewRequired": 0, "skipped": 0}
    for index, payload in enumerate(records):
        if not isinstance(payload, dict):
            counts["skipped"] += 1
            continue
        declared_owner = payload.get("ownerUserId", payload.get("owner_user_id"))
        if (declared_owner and declared_owner != user.id) or (not trusted and declared_owner != user.id):
            counts["skipped"] += 1
            continue
        source_id = str(payload.get("id", payload.get("leadId", ""))).strip()
        if not source_id:
            # Content-addressed records without source IDs cannot silently merge same-name companies.
            source_id = "anonymous:" + hashlib.sha256(json.dumps(payload, sort_keys=True).encode()).hexdigest()
        existed = db.query(CRMSource).filter_by(owner_user_id=user.id, source=source, source_id=source_id).first()
        try:
            record = upsert_lead(db, user.id, source_id, payload, source=source)
        except HTTPException as exc:
            if exc.status_code != 422:
                raise
            counts["skipped"] += 1
            continue
        if not existed:
            counts["imported"] += 1
            counts["reviewRequired"] += int(record.stage == "review_required")
    for payload in activities:
        if not isinstance(payload, dict):
            counts["skipped"] += 1
            continue
        declared_owner = payload.get("ownerUserId", payload.get("owner_user_id"))
        if (declared_owner and declared_owner != user.id) or (not trusted and declared_owner != user.id):
            counts["skipped"] += 1
            continue
        key = "legacy-activity:" + hashlib.sha256((source + ":" + str(payload.get("id") or json.dumps(payload, sort_keys=True))).encode()).hexdigest()
        if db.query(CRMActivity).filter_by(owner_user_id=user.id, idempotency_key=key).first():
            continue
        mapping = db.query(CRMSource).filter_by(owner_user_id=user.id, source_id=str(payload.get("leadId", payload.get("recordId", "")))).first()
        kind = payload.get("kind", "outreach")
        if kind not in ("remark", "conversation", "outreach"):
            counts["skipped"] += 1
            continue
        outcome = payload.get("outcome", payload.get("status"))
        if kind == "conversation" and outcome not in CONVERSATION_OUTCOMES:
            counts["skipped"] += 1
            continue
        # Browser historical logs are not provider receipts, even when they say 'sent'.
        if kind == "outreach":
            outcome = "failed" if outcome == "failed" else "unknown"
        _activity(db, user.id, mapping.record_id if mapping else None, kind, str(payload.get("note", payload.get("message", "")))[:12000],
                  _historical_date(payload.get("occurredAt", payload.get("timestamp"))), evidence="legacy_unverified", outcome=str(outcome)[:80] if outcome else None,
                  channel=str(payload.get("channel", "email"))[:24], recipient=str(payload.get("recipient", payload.get("to", "")))[:320], idempotency_key=key)
        counts["imported"] += 1
    return counts


@router.post("/bootstrap")
def bootstrap(body: BootstrapWrite = BootstrapWrite(), db: Session = Depends(get_db), user: UserAccount = Depends(get_current_user),
              credentials: Optional[HTTPAuthorizationCredentials] = Depends(bearer_scheme)):
    from api.lead_jobs import LeadRecord
    if body.source not in ("cloud", "local"):
        raise HTTPException(422, "Invalid import source")
    if body.snapshotUserId is not None and body.snapshotUserId != user.id:
        raise HTTPException(403, "Snapshot belongs to another account")
    if body.source == "local" and (body.records or body.activities):
        counts = _import_legacy(db, user, body.records, body.activities, "local", trusted=False)
        db.commit()
        return {"complete": True, "remoteComplete": None, "warnings": [], **counts, "cursor": None}
    if body.cursor:
        migration = db.query(CRMMigration).filter_by(owner_user_id=user.id, cursor=body.cursor).first()
        if not migration:
            raise HTTPException(404, "Migration cursor not found")
        state = _load(migration.state, {})
    else:
        state = {"backend": "", "backendDone": False, "cloudId": 0, "cloudOffset": 0, "cloudDone": False, "remoteOffset": 0, "remoteDone": body.source != "cloud"}
        migration = CRMMigration(id=_id(), owner_user_id=user.id, cursor=_id(), state="{}", created_at=time.time())
        db.add(migration)
    counts = {"imported": 0, "reviewRequired": 0, "skipped": 0}
    def add(result):
        for key in counts:
            counts[key] += result[key]
    # Posted cloud rows require a server source match; snapshotUserId alone never grants trust.
    if body.records or body.activities:
        if body.source == "local":
            add(_import_legacy(db, user, body.records, body.activities, "local", trusted=False))
        else:
            verified = []
            for row in body.records:
                identity = str(row.get("id", row.get("leadId", "")))
                mapping = db.query(CRMSource).filter(CRMSource.owner_user_id == user.id, CRMSource.source_id == identity, CRMSource.source.in_(("backend", "cloud", "supabase"))).first()
                if mapping:
                    # Untrusted browser data may fill empty source fields only via local attribution.
                    verified.append({**row, "ownerUserId": user.id})
                else:
                    counts["skipped"] += 1
            add(_import_legacy(db, user, verified, [], "local", trusted=False))
            counts["skipped"] += len(body.activities)
    budget = 250
    if not state["backendDone"]:
        rows = db.query(LeadRecord).filter(LeadRecord.owner_user_id == user.id, LeadRecord.id > state["backend"]).order_by(LeadRecord.id).limit(budget).all()
        for row in rows:
            payload = _load(row.payload, None)
            if isinstance(payload, dict):
                existed = db.query(CRMSource).filter_by(owner_user_id=user.id, source="backend", source_id=row.id).first()
                try:
                    record = upsert_lead(db, user.id, row.id, payload, created_at=row.created_at, source="backend")
                    counts["imported"] += int(not existed)
                    counts["reviewRequired"] += int(not existed and record.stage == "review_required")
                except HTTPException as exc:
                    if exc.status_code != 422:
                        raise
                    counts["skipped"] += 1
            else:
                counts["skipped"] += 1
            state["backend"] = row.id
        budget -= len(rows)
        state["backendDone"] = len(rows) < 250
    while budget and not state["cloudDone"]:
        row = db.query(UserCloudData).filter(UserCloudData.email == user.email.lower(), UserCloudData.id >= state["cloudId"]).order_by(UserCloudData.id).first()
        if row is None:
            state["cloudDone"] = True
            break
        if row.id != state["cloudId"]:
            state["cloudId"], state["cloudOffset"] = row.id, 0
        if "cloudPayload" not in state:
            state["cloudPayload"] = _load(row.payload, None)
        records, activities = _snapshot_lists(state["cloudPayload"], row.data_type)
        combined = [("record", item) for item in records] + [("activity", item) for item in activities]
        chunk = combined[state["cloudOffset"]:state["cloudOffset"] + budget]
        add(_import_legacy(db, user, [v for k, v in chunk if k == "record"], [v for k, v in chunk if k == "activity"], "cloud", trusted=True))
        state["cloudOffset"] += len(chunk)
        budget -= len(chunk)
        if state["cloudOffset"] >= len(combined):
            state["cloudId"], state["cloudOffset"] = row.id + 1, 0
            state.pop("cloudPayload", None)
    warnings = []
    if budget and not state["remoteDone"]:
        try:
            if "remotePayload" not in state:
                state["remotePayload"] = _supabase_snapshot(user, credentials)
            records, activities = _snapshot_lists(state["remotePayload"] or {})
            combined = [("record", item) for item in records] + [("activity", item) for item in activities]
            chunk = combined[state["remoteOffset"]:state["remoteOffset"] + budget]
            add(_import_legacy(db, user, [v for k, v in chunk if k == "record"], [v for k, v in chunk if k == "activity"], "supabase", trusted=True))
            state["remoteOffset"] += len(chunk)
            state["remoteDone"] = state["remoteOffset"] >= len(combined)
            if state["remoteDone"]:
                state.pop("remotePayload", None)
        except HTTPException as exc:
            if exc.status_code != 503:
                raise
            warnings.append(exc.detail)
    complete = state["backendDone"] and state["cloudDone"] and (state["remoteDone"] or bool(warnings))
    migration.state = json.dumps(state)
    db.commit()
    return {"complete": complete, "remoteComplete": state["remoteDone"], "warnings": warnings, **counts,
            "cursor": None if complete and state["remoteDone"] else migration.cursor}
