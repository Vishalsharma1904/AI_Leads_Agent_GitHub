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
from sqlalchemy import Column, Integer, String, Text, Float, UniqueConstraint
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
        return selected or list(ACTORS)


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
            json=_actor_input(key, query["role"], query["city"], max(5, query["quantity"])),
        )
        response.raise_for_status()
        items = response.json()
        if not isinstance(items, list):
            return label, [], "Provider returned an invalid dataset"
        return label, [{"source_key": key, "source": label, **item} for item in items if isinstance(item, dict)], None
    except httpx.HTTPStatusError as exc:
        return label, [], f"Provider returned HTTP {exc.response.status_code}"
    except Exception:
        return label, [], "Provider request failed"


async def _run_job(job_id: str, user_id: str, db_factory) -> None:
    db: Session = db_factory()
    job = db.query(CandidateJob).filter_by(id=job_id, owner_user_id=user_id).first()
    if not job:
        db.close()
        return
    user = db.query(UserAccount).filter_by(id=user_id).first()
    job.status, job.updated_at = "running", time.time()
    db.commit()
    try:
        token = get_provider_secret("apify", user, db)
        if not token:
            raise RuntimeError("Apify credential is not configured for this workspace")
        query = json.loads(job.request_payload)
        async with httpx.AsyncClient(timeout=httpx.Timeout(180.0, connect=15.0)) as client:
            results = await asyncio.gather(*[_run_actor(client, key, token, query) for key in query["sources"]])
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
        job.status = "partial" if source_errors or not records else "completed"
        if not records:
            job.error = "No public job listings returned"
    except Exception:
        job.status, job.error = "failed", "Candidate provider could not complete the request"
    finally:
        job.updated_at = time.time()
        db.commit()
        db.close()


@router.post("/candidate-jobs", status_code=202)
def create_candidate_job(req: CandidateJobRequest, background: BackgroundTasks,
                         db: Session = Depends(get_db), user: UserAccount = Depends(get_current_user),
                         idempotency_key: Optional[str] = Header(default=None, alias="Idempotency-Key")):
    key = (idempotency_key or "").strip()[:128] or None
    if key:
        existing = db.query(CandidateJob).filter_by(owner_user_id=user.id, idempotency_key=key).first()
        if existing:
            return {"success": True, "job": _payload(existing), "idempotent": True}
    job = CandidateJob(id=f"candidate_job_{uuid.uuid4().hex}", owner_user_id=user.id, status="queued",
                       request_payload=req.model_dump_json(), idempotency_key=key,
                       created_at=time.time(), updated_at=time.time())
    db.add(job)
    db.commit()
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
