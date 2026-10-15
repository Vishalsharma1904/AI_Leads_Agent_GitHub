"""Authenticated candidate/job-market sourcing jobs.

These actors return public job listings, not private resume databases. The
browser receives tenant-scoped records and never receives the Apify token.
"""
from __future__ import annotations

import asyncio
import json
import os
import time
import uuid
from typing import Any, Optional

import httpx
from fastapi import APIRouter, BackgroundTasks, Depends, Header, HTTPException
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import Column, Integer, String, Text, Float, UniqueConstraint, case
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from api.auth_sync import AUTO_CREATE_SCHEMA, Base, UserAccount, get_current_user, get_db
from api.credentials import get_provider_secret
from api.auth_sync import engine


class CandidateJob(Base):
    __tablename__ = "candidate_jobs"
    __table_args__ = (UniqueConstraint("owner_user_id", "idempotency_key", name="uq_candidate_job_idempotency"),)

    id = Column(String(64), primary_key=True)
    owner_user_id = Column(String(64), index=True, nullable=False)
    status = Column(String(20), index=True, nullable=False, default="queued")
    request_payload = Column(Text, nullable=False)
    result_count = Column(Integer, default=0)
    error = Column(Text, nullable=True)
    source_errors = Column(Text, nullable=True)
    idempotency_key = Column(String(128), nullable=True)
    created_at = Column(Float, default=time.time)
    updated_at = Column(Float, default=time.time)


class CandidateRecord(Base):
    __tablename__ = "candidate_records"
    id = Column(String(64), primary_key=True)
    owner_user_id = Column(String(64), index=True, nullable=False)
    job_id = Column(String(64), index=True, nullable=False)
    payload = Column(Text, nullable=False)
    created_at = Column(Float, default=time.time)


if AUTO_CREATE_SCHEMA:
    Base.metadata.create_all(bind=engine)

router = APIRouter(prefix="/api/v1", tags=["candidate_jobs"])
ACTORS = {
    "naukri": ("xYOP3UjaS8w38IWM7", "Naukri"),
    "workindia": ("23KtodpG4T4RFCLe4", "WorkIndia"),
    "shine": ("nkFTTcWfTpWK1mj9f", "Shine"),
    "apna": ("shahidirfan~apna-co-jobs-scraper", "Apna"),
}


class CandidateJobRequest(BaseModel):
    role: str = Field(min_length=2, max_length=120)
    city: str = Field(default="", max_length=120)
    quantity: int = Field(default=20, ge=1, le=200)
    sources: list[str] = Field(default_factory=lambda: list(ACTORS), max_length=4)

    @field_validator("sources")
    @classmethod
    def valid_sources(cls, values):
        selected = [str(value).strip().lower() for value in values if str(value).strip().lower() in ACTORS]
        return list(dict.fromkeys(selected)) or list(ACTORS)


def _payload(job: CandidateJob) -> dict[str, Any]:
    try:
        source_errors = json.loads(job.source_errors) if job.source_errors else {}
    except (TypeError, ValueError):
        source_errors = {}
    return {"id": job.id, "status": job.status, "result_count": job.result_count or 0,
            "error": job.error, "source_errors": source_errors,
            "created_at": job.created_at, "updated_at": job.updated_at}


def _actor_input(key: str, role: str, city: str, quantity: int) -> dict[str, Any]:
    if key in {"workindia", "apna"}:
        return {"keyword": role, "city": city or "india", "results_wanted": quantity, "max_pages": 10, "includeDetails": True}
    result = {"keyword": role, "maxResults": quantity, "fetchDetails": True, "postedBy": "Company"}
    if city:
        result["location"] = city
    return result


async def _run_actor(client: httpx.AsyncClient, key: str, token: str, query: dict[str, Any]) -> tuple[str, list[dict], Optional[str]]:
    actor_id, label = ACTORS[key]
    try:
        response = await client.post(
            f"https://api.apify.com/v2/acts/{actor_id}/run-sync-get-dataset-items",
            headers={"Authorization": f"Bearer {token}"},
            json=_actor_input(key, query["role"], query["city"], query["quantity"]),
        )
        response.raise_for_status()
        items = response.json()
        if not isinstance(items, list):
            return label, [], "Provider returned an invalid dataset"
        return label, [{**item, "source_key": key, "source": label} for item in items if isinstance(item, dict)], None
    except httpx.HTTPStatusError as exc:
        return label, [], f"Provider returned HTTP {exc.response.status_code}"
    except Exception:
        return label, [], "Provider request failed"


def _settle_results(db, user, reservation, count):
    """Release unused lead allowance once; keep provider attempts separately."""
    from api.limits import TenantLimits
    from services.developer_control import UsageEvent
    event = db.query(UsageEvent).filter_by(id=reservation['usage_id'], user_id=user.id).with_for_update().first()
    if not event or event.state != 'reserved': return
    unused = int(event.amount) - count
    if unused < 0: raise ValueError('Candidate results exceed their reservation')
    if unused:
        used, total = TenantLimits.leads_used, TenantLimits.leads_total
        db.query(TenantLimits).filter_by(owner_user_id=user.id).update({
            used: case((TenantLimits.day == reservation['day'], case((used >= unused, used-unused), else_=0)), else_=used),
            total: case((total >= unused, total-unused), else_=0)}, synchronize_session=False)
    event.amount, event.state = count, 'succeeded' if count else 'refunded'


async def _run_job(job_id: str, user_id: str, db_factory) -> None:
    db: Session = db_factory()
    job = db.query(CandidateJob).filter_by(id=job_id, owner_user_id=user_id).first()
    if not job or job.status != 'queued':
        db.close()
        return
    user = db.query(UserAccount).filter_by(id=user_id).first()
    claimed = db.query(CandidateJob).filter_by(id=job_id, owner_user_id=user_id, status='queued').update(
        {CandidateJob.status:'running',CandidateJob.updated_at:time.time()}, synchronize_session=False)
    db.commit()
    if not claimed: db.close(); return
    reservation = None
    try:
        from api.limits import consume
        from services.developer_control import check_access, reserve_provider
        if not user: raise HTTPException(403, 'Account unavailable')
        check_access(db, user, 'leads')
        token = get_provider_secret("apify", user, db)
        if not token:
            raise HTTPException(503, "Connect Apify in Setup before starting candidate sourcing")
        query = json.loads(job.request_payload)
        reservation = consume(db, user, 'leads', query['quantity'], request_id=job.id, provider='apify')
        sources = query['sources'][:query['quantity']]
        size, extra = divmod(query['quantity'], len(sources))
        async def source(client, key, quantity):
            check_access(db, user, 'leads')
            reserve_provider(db, user, 'apify')
            return await _run_actor(client, key, token, {**query,'quantity':quantity})
        async with httpx.AsyncClient(timeout=httpx.Timeout(180.0, connect=15.0)) as client:
            results = await asyncio.gather(*[source(client,key,size+(index < extra)) for index,key in enumerate(sources)])
        check_access(db, user, 'leads')
        records: list[dict] = []
        source_errors: dict[str, str] = {}
        for label, items, source_error in results:
            records.extend(items)
            if source_error:
                source_errors[label] = source_error
        # Keep the provider response honest and bounded; frontend normalisation
        # handles the actor-specific public listing shape.
        records = records[: query["quantity"]]
        for item in records:
            db.add(CandidateRecord(id=f"candidate_{uuid.uuid4().hex}", owner_user_id=user_id,
                                   job_id=job_id, payload=json.dumps(item), created_at=time.time()))
        job.result_count = len(records)
        job.source_errors = json.dumps(source_errors) if source_errors else None
        job.status = "partial" if source_errors or len(records) < query['quantity'] else "completed"
        if not records:
            job.error = "No public job listings returned"
    except HTTPException as error:
        job.status = 'paused' if error.status_code in (402,403,429) else 'failed'
        job.error = error.detail if isinstance(error.detail,str) else error.detail.get('message','Candidate sourcing unavailable')
    except Exception:
        job.status, job.error = "failed", "Candidate provider could not complete the request"
    finally:
        try:
            if reservation: _settle_results(db,user,reservation,job.result_count or 0)
            job.updated_at = time.time()
            db.commit()
        finally: db.close()


@router.post("/candidate-jobs", status_code=202)
def create_candidate_job(req: CandidateJobRequest, background: BackgroundTasks,
                         db: Session = Depends(get_db), user: UserAccount = Depends(get_current_user),
                         idempotency_key: Optional[str] = Header(default=None, alias="Idempotency-Key")):
    key = (idempotency_key or "").strip()[:128] or None
    if key:
        existing = db.query(CandidateJob).filter_by(owner_user_id=user.id, idempotency_key=key).first()
        if existing:
            if json.loads(existing.request_payload) != req.model_dump():
                raise HTTPException(409,'This request ID belongs to a different candidate search')
            return {"success": True, "job": _payload(existing), "idempotent": True}
    job = CandidateJob(id=f"candidate_job_{uuid.uuid4().hex}", owner_user_id=user.id, status="queued",
                       request_payload=req.model_dump_json(), idempotency_key=key,
                       created_at=time.time(), updated_at=time.time())
    db.add(job)
    try: db.commit()
    except IntegrityError:
        db.rollback()
        existing = db.query(CandidateJob).filter_by(owner_user_id=user.id,idempotency_key=key).first() if key else None
        if existing and json.loads(existing.request_payload) == req.model_dump():
            return {"success":True,"job":_payload(existing),"idempotent":True}
        raise HTTPException(409,'Candidate request conflicts with an existing search') from None
    db.refresh(job)
    background.add_task(_run_job, job.id, user.id, __import__("api.auth_sync", fromlist=["SessionLocal"]).SessionLocal)
    return {"success": True, "job": _payload(job)}


@router.get("/candidate-jobs/{job_id}")
def get_candidate_job(job_id: str, db: Session = Depends(get_db), user: UserAccount = Depends(get_current_user)):
    job = db.query(CandidateJob).filter_by(id=job_id, owner_user_id=user.id).first()
    if not job:
        raise HTTPException(status_code=404, detail="Candidate job not found")
    records = db.query(CandidateRecord).filter_by(job_id=job.id, owner_user_id=user.id).order_by(CandidateRecord.created_at.asc()).all()
    return {"success": True, "job": _payload(job),
            "records": [{"id": record.id, **json.loads(record.payload)} for record in records]}
