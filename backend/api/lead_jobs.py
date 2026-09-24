"""Authenticated, persisted lead sourcing jobs backed by real providers."""
import json
import os
import time
import uuid
import asyncio
import logging
from typing import Any, Optional

import httpx
from fastapi import APIRouter, BackgroundTasks, Depends, Header, HTTPException
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import Column, Integer, String, Text, Float, UniqueConstraint
from sqlalchemy.orm import Session

from api.auth_sync import AUTO_CREATE_SCHEMA, Base, UserAccount, get_current_user, get_db
from api.credentials import get_provider_secret
from services.leads.website_crawler import enrich_public_websites
from services.leads.maps_scraper import discover_businesses

logger = logging.getLogger(__name__)


class LeadJob(Base):
    __tablename__ = "lead_jobs"
    __table_args__ = (UniqueConstraint("owner_user_id", "idempotency_key", name="uq_job_idempotency"),)

    id = Column(String(64), primary_key=True)
    owner_user_id = Column(String(64), index=True, nullable=False)
    status = Column(String(20), index=True, nullable=False, default="queued")
    request_payload = Column(Text, nullable=False)
    result_count = Column(Integer, default=0)
    error = Column(Text, nullable=True)
    idempotency_key = Column(String(128), nullable=True)
    created_at = Column(Float, default=time.time)
    updated_at = Column(Float, default=time.time)


class LeadRecord(Base):
    __tablename__ = "lead_records"
    id = Column(String(64), primary_key=True)
    owner_user_id = Column(String(64), index=True, nullable=False)
    job_id = Column(String(64), index=True, nullable=False)
    payload = Column(Text, nullable=False)
    created_at = Column(Float, default=time.time)


from api.auth_sync import engine
if AUTO_CREATE_SCHEMA:
    Base.metadata.create_all(bind=engine)

router = APIRouter(prefix="/api/v1", tags=["lead_jobs"])
JOB_STATES = {"queued", "running", "completed", "partial", "failed", "cancelled"}


class LeadJobRequest(BaseModel):
    cities: list[str] = Field(min_length=1, max_length=20)
    industries: list[str] = Field(default_factory=list, max_length=20)
    service_type: list[str] = Field(default_factory=list, max_length=10)
    count: int = Field(default=25, ge=1, le=100)

    @field_validator("cities", "industries", "service_type")
    @classmethod
    def bounded_terms(cls, values):
        if any(len(str(value).strip()) > 120 for value in values):
            raise ValueError("Lead query terms must be 120 characters or fewer")
        return [str(value).strip() for value in values if str(value).strip()]


def _job_payload(job: LeadJob) -> dict[str, Any]:
    return {"id": job.id, "status": job.status, "result_count": job.result_count or 0,
            "error": job.error, "created_at": job.created_at, "updated_at": job.updated_at}


async def _run_apify(job_id: str, user_id: str, db_factory) -> None:
    db: Session = db_factory()
    job = db.query(LeadJob).filter_by(id=job_id, owner_user_id=user_id).first()
    if not job or job.status == "cancelled":
        db.close(); return
    user = db.query(UserAccount).filter_by(id=user_id).first()
    job.status, job.updated_at = "running", time.time(); db.commit()
    try:
        query = json.loads(job.request_payload)
        requested_topics = query["industries"] or []
        if any(str(topic).strip().upper() == "ALL" for topic in requested_topics):
            requested_topics = [topic for topic in query["service_type"]
                                if str(topic).strip().upper() not in {"ALL", "ALL RELEVANT REQUIREMENTS"}]
        topics = requested_topics or ["businesses"]
        search_queries = [f"{topic} {city}" for city in query["cities"] for topic in topics]
        valid_items: list[dict] = []
        provider = "Scrapling"
        provider_errors: list[str] = []

        # Provider cascade: use a configured Apify key when it is healthy, but
        # never make a lead run depend on it. A missing, rate-limited, or
        # malformed Apify response falls through to the local browser scraper.
        token = get_provider_secret("apify", user, db) if user else None
        if token:
            try:
                actor_input = {"searchStringsArray": search_queries, "maxCrawledPlacesPerSearch": query["count"]}
                url = "https://api.apify.com/v2/acts/compass~crawler-google-places/run-sync-get-dataset-items"
                async with httpx.AsyncClient(timeout=httpx.Timeout(60.0, connect=10.0)) as client:
                    response = await client.post(url, headers={"Authorization": f"Bearer {token}"}, json=actor_input)
                    response.raise_for_status()
                    items = response.json()
                if not isinstance(items, list):
                    raise RuntimeError("Apify returned an invalid lead dataset")
                valid_items = [item for item in items[: query["count"]] if isinstance(item, dict) and item.get("title")]
                if valid_items:
                    provider = "Apify"
                else:
                    provider_errors.append("Apify returned no usable leads")
            except Exception as exc:
                provider_errors.append(f"Apify: {str(exc)[:180]}")
                logger.warning("Apify lead source failed; falling back to Scrapling: %s", exc)
        else:
            provider_errors.append("Apify key not configured")

        if not valid_items:
            semaphore = asyncio.Semaphore(3)

            async def discover(query_text: str) -> list[dict]:
                async with semaphore:
                    return await discover_businesses(query_text, query["count"])

            results = await asyncio.gather(*(discover(search) for search in search_queries), return_exceptions=True)
            for search, result in zip(search_queries, results):
                if isinstance(result, Exception):
                    provider_errors.append(f"Scrapling ({search}): {str(result)[:180]}")
                    logger.warning("Scrapling lead source failed for %r: %s", search, result)
                    continue
                for item in result:
                    if isinstance(item, dict) and item.get("title"):
                        item["searchString"] = search
                        valid_items.append(item)
            valid_items = valid_items[: query["count"]]
            provider = "Scrapling"

        if not valid_items:
            detail = "; ".join(provider_errors[-3:]) or "No provider returned usable leads"
            raise RuntimeError(detail)

        for item in valid_items:
            item.setdefault("source", provider)
        if os.getenv("LEAD_WEBSITE_CRAWLER_ENABLED", "true").strip().lower() == "true":
            try:
                valid_items = await enrich_public_websites(
                    valid_items,
                    max_pages_per_site=max(1, min(5, int(os.getenv("LEAD_CRAWL_MAX_PAGES", "3")))),
                    max_concurrency=max(1, min(8, int(os.getenv("LEAD_CRAWL_MAX_CONCURRENCY", "3")))),
                )
            except Exception as exc:
                # Contact enrichment is additive. Preserve real Maps leads if
                # a website blocks the crawler or times out.
                logger.warning("Website enrichment skipped after source success: %s", exc)
        for item in valid_items:
            db.add(LeadRecord(id=f"lead_{uuid.uuid4().hex}", owner_user_id=user_id, job_id=job_id,
                              payload=json.dumps(item), created_at=time.time()))
        job.result_count = len(valid_items)
        job.status = "completed" if job.result_count >= query["count"] else ("partial" if job.result_count else "failed")
        if job.status == "failed":
            job.error = "Provider returned no usable leads"
    except httpx.HTTPError:
        job.status, job.error = "failed", "Lead provider request failed"
    except Exception as exc:
        job.status, job.error = "failed", "Lead job could not be completed"
    finally:
        job.updated_at = time.time(); db.commit(); db.close()


@router.post("/lead-jobs", status_code=202)
def create_lead_job(req: LeadJobRequest, background: BackgroundTasks, db: Session = Depends(get_db), user: UserAccount = Depends(get_current_user), idempotency_key: Optional[str] = Header(default=None, alias="Idempotency-Key")):
    key = (idempotency_key or "").strip()[:128] or None
    if key:
        existing = db.query(LeadJob).filter_by(owner_user_id=user.id, idempotency_key=key).first()
        if existing:
            return {"success": True, "job": _job_payload(existing), "idempotent": True}
    job = LeadJob(id=f"job_{uuid.uuid4().hex}", owner_user_id=user.id, status="queued",
                  request_payload=req.model_dump_json(), idempotency_key=key, created_at=time.time(), updated_at=time.time())
    db.add(job); db.commit(); db.refresh(job)
    background.add_task(_run_apify, job.id, user.id, __import__("api.auth_sync", fromlist=["SessionLocal"]).SessionLocal)
    return {"success": True, "job": _job_payload(job)}


@router.get("/lead-jobs/{job_id}")
def get_lead_job(job_id: str, db: Session = Depends(get_db), user: UserAccount = Depends(get_current_user)):
    job = db.query(LeadJob).filter_by(id=job_id, owner_user_id=user.id).first()
    if not job: raise HTTPException(status_code=404, detail="Lead job not found")
    records = db.query(LeadRecord).filter_by(job_id=job.id, owner_user_id=user.id).order_by(LeadRecord.created_at.asc()).all()
    leads = [{"id": r.id, **json.loads(r.payload), "created_at": r.created_at} for r in records]
    return {"success": True, "job": _job_payload(job), "leads": leads}


@router.post("/lead-jobs/{job_id}/cancel")
def cancel_lead_job(job_id: str, db: Session = Depends(get_db), user: UserAccount = Depends(get_current_user)):
    job = db.query(LeadJob).filter_by(id=job_id, owner_user_id=user.id).first()
    if not job: raise HTTPException(status_code=404, detail="Lead job not found")
    if job.status in {"queued", "running"}: job.status, job.updated_at = "cancelled", time.time(); db.commit()
    return {"success": True, "job": _job_payload(job)}


@router.get("/leads")
def list_leads(limit: int = 100, db: Session = Depends(get_db), user: UserAccount = Depends(get_current_user)):
    limit = max(1, min(limit, 500))
    records = db.query(LeadRecord).filter_by(owner_user_id=user.id).order_by(LeadRecord.created_at.desc()).limit(limit).all()
    return {"success": True, "leads": [{"id": r.id, "job_id": r.job_id, **json.loads(r.payload), "created_at": r.created_at} for r in records]}


class MapsSearchRequest(BaseModel):
    queries: list[str] = Field(min_length=1, max_length=20)
    max_per_query: int = Field(default=8, ge=1, le=40)

    @field_validator("queries")
    @classmethod
    def bounded_queries(cls, values):
        if any(len(str(value).strip()) > 160 for value in values):
            raise ValueError("Each search query must be 160 characters or fewer")
        return [str(value).strip() for value in values if str(value).strip()]


@router.post("/leads/maps-search")
async def maps_search(req: MapsSearchRequest):
    """Keyless Google Maps discovery via Scrapling — no Apify, no login.
    Runs one real, automated-browser search per query and returns raw place
    records in the same shape the old Apify actor produced, so the
    frontend's existing normalise()/scoreAndTrim() pipeline needs no changes."""
    all_items: list[dict] = []
    for query in req.queries:
        try:
            items = await discover_businesses(query, req.max_per_query)
        except RuntimeError as exc:
            raise HTTPException(status_code=503, detail=str(exc)) from exc
        for item in items:
            item["searchString"] = query
        all_items.extend(items)
    return {"success": True, "items": all_items}


class EnrichWebsitesRequest(BaseModel):
    records: list[dict] = Field(min_length=1, max_length=100)


@router.post("/leads/enrich-websites")
async def enrich_websites_route(req: EnrichWebsitesRequest):
    """Read each record's own public website (homepage + /contact, /about, …)
    for a real email/phone using the Crawlee+Playwright crawler already in
    this repo — the same keyless enrichment _run_apify uses, exposed here for
    the frontend's client-side lead pipeline. Never fabricates a value."""
    enriched = await enrich_public_websites(
        req.records,
        max_pages_per_site=max(1, min(5, int(os.getenv("LEAD_CRAWL_MAX_PAGES", "3")))),
        max_concurrency=max(1, min(8, int(os.getenv("LEAD_CRAWL_MAX_CONCURRENCY", "3")))),
    )
    return {"success": True, "records": enriched}
