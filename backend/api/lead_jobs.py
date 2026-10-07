"""Authenticated, persisted lead sourcing jobs backed by real providers."""
import json
import os
import time
import uuid
import asyncio
import logging
import re
import math
import hashlib
from collections import defaultdict
from typing import Any, Optional

import httpx
from fastapi import APIRouter, BackgroundTasks, Depends, Header, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import Column, Integer, String, Text, Float, UniqueConstraint
from sqlalchemy.orm import Session

from api.auth_sync import AUTO_CREATE_SCHEMA, Base, UserAccount, get_current_user, get_db
from api.credentials import get_provider_secret
from api.limits import consume, remaining
from api.crm import upsert_lead
from services.leads.website_crawler import enrich_authority_via_search, enrich_public_websites
from services.leads.maps_scraper import discover_businesses
from services.leads.directory_discovery import discover_indexed_businesses, public_lead, recover_company_websites

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
DEFAULT_BUYER_SECTORS = [
    "Corporate Offices", "IT Companies", "Hotels", "Hospitals",
    "Manufacturing Companies", "Shopping Malls", "Warehouses & Logistics",
    "Residential Societies", "Schools & Universities", "Banks & Financial Institutions",
    "Retail Chains & Supermarkets", "Restaurants & Event Venues",
]
PROVIDER_RE = re.compile(
    r"\b(security\s+(?:agenc(?:y|ies)|services?|solutions?|guards?|guarding|contractors?)|guarding|"
    r"man\s*power|manpower|housekeeping\s+(?:agenc(?:y|ies)|services?)|facility\s+management|facilities\s+management|"
    r"integrated\s+facilit\w*|staffing|placement\s+(?:agenc(?:y|ies)|services?)|"
    r"recruit(?:ment)?\s+(?:agenc(?:y|ies)|services?|consultan\w*)|cleaning\s+services?|"
    r"janitorial|pest\s+control|detective|surveillance\s+service|bouncers?)\b",
    re.IGNORECASE,
)

CITY_ALIASES = {"gurgaon": "gurugram", "bangalore": "bengaluru", "bombay": "mumbai", "madras": "chennai"}


def _city_matches(city: str, place: str) -> bool:
    # A picker city is qualified by its state; both must occur in the address.
    if "," in city:
        parts = [part.strip() for part in city.split(",") if part.strip()]
        return bool(parts) and all(_city_matches(part, place) for part in parts)
    normalized = re.sub(r"[^a-z0-9]+", " ", place.casefold()).strip()
    for alias, canonical in CITY_ALIASES.items():
        normalized = re.sub(rf"\b{alias}\b", canonical, normalized)
    needle = re.sub(r"[^a-z0-9]+", " ", city.casefold()).strip()
    for alias, canonical in CITY_ALIASES.items():
        needle = re.sub(rf"\b{alias}\b", canonical, needle)
    return bool(needle) and f" {needle} " in f" {normalized} "


def _search_plan(cities: list[str], industries: list[str], limit: int = 12) -> list[str]:
    topics = industries or []
    broad = not topics or any(str(topic).strip().upper() == "ALL" for topic in topics)
    if broad:
        topics = DEFAULT_BUYER_SECTORS
    queries = [f"{topic} in {city}" for city in cities for topic in topics]
    if len(queries) <= limit:
        return queries
    step = len(queries) / limit
    return [queries[int(index * step)] for index in range(limit)]


def _is_provider(item: dict[str, Any]) -> bool:
    categories = item.get("categories") or item.get("category") or ""
    if isinstance(categories, list):
        categories = " ".join(str(value) for value in categories)
    fields = (item.get("title"), item.get("name"), item.get("categoryName"), categories)
    return bool(PROVIDER_RE.search(" ".join(str(value or "") for value in fields)))


def _spread_results(items: list[dict[str, Any]], queries: list[str], limit: int) -> list[dict[str, Any]]:
    groups: dict[str, list[dict[str, Any]]] = defaultdict(list)
    unknown: list[dict[str, Any]] = []
    by_lower = {query.casefold(): query for query in queries}
    for item in items:
        source = str(item.get("searchString") or item.get("searchQuery") or "").strip().casefold()
        query = by_lower.get(source) or next((q for q in queries if source.startswith(q.casefold())), None)
        if query:
            groups[query].append(item)
        else:
            unknown.append(item)
    result: list[dict[str, Any]] = []
    depth = 0
    while len(result) < limit:
        added = False
        for query in queries:
            group = groups.get(query, [])
            if depth < len(group):
                result.append(group[depth]); added = True
                if len(result) >= limit:
                    break
        if depth < len(unknown) and len(result) < limit:
            result.append(unknown[depth]); added = True
        if not added:
            break
        depth += 1
    return result


def _contactable_items(items: list[dict], queries: list[str], count: int) -> list[dict]:
    selected, seen = [], set()
    for item in items:
        if not item.get("email") and isinstance(item.get("emails"), list) and item["emails"]:
            item["email"] = item["emails"][0]
        if not (item.get("phone") or item.get("phoneNumber") or item.get("email")):
            continue
        identity = str(item.get("placeId") or item.get("url") or
                       (str(item.get("title")) + "|" + str(item.get("address")))).casefold()
        if identity not in seen:
            seen.add(identity)
            selected.append(item)
    return _spread_results(selected, queries, count)


class LeadJobRequest(BaseModel):
    cities: list[str] = Field(min_length=1, max_length=20)
    industries: list[str] = Field(default_factory=list, max_length=20)
    service_type: list[str] = Field(default_factory=list, max_length=10)
    count: int = Field(default=25, ge=1, le=100)
    sources: list[str] = Field(default_factory=lambda: ["sulekha", "justdial", "maps", "apify"], max_length=7)

    @field_validator("sources")
    @classmethod
    def valid_sources(cls, values):
        allowed = {"sulekha", "justdial", "maps", "apify", "linkedin", "indeed", "google"}
        if not values or any(value not in allowed for value in values):
            raise ValueError("Choose at least one supported source")
        return list(dict.fromkeys(values))

    @field_validator("cities", "industries", "service_type")
    @classmethod
    def bounded_terms(cls, values):
        if any(len(str(value).strip()) > 120 for value in values):
            raise ValueError("Lead query terms must be 120 characters or fewer")
        return [str(value).strip() for value in values if str(value).strip()]


def _job_payload(job: LeadJob) -> dict[str, Any]:
    detail = {}
    if job.status == 'running' and str(job.error or '').startswith('{'):
        try: detail = json.loads(job.error)
        except (ValueError, TypeError): pass
    stage = detail.get('label') or (job.error if job.status == "running" else "")
    if re.search(r"Apify|Scrapling|Google Maps|public Maps|Sulekha|Justdial", stage or "", re.I):
        stage = "Discovering companies and checking business contacts"
    return {"id": job.id, "status": job.status, "result_count": job.result_count or 0,
            "stage": stage,
            "progress": {**detail, "label": stage} if detail else {},
            "error": ("A business contact source is unavailable; saved contacts are retained" if re.search(r"Apify|Scrapling|Google Maps|Sulekha|Justdial", job.error or "", re.I) else job.error) if job.status == 'failed' else None,
            "created_at": job.created_at, "updated_at": job.updated_at}


async def _send_progress(callback, event):
    if callback:
        result = callback(event)
        if hasattr(result, '__await__'): await result


_enrichment_cleanup = set()


async def _bounded_enrichment(records, on_progress=None, *, timeout=75):
    """Optional enrichment cannot withhold sourced contacts indefinitely."""
    async def work():
        try:
            await asyncio.wait_for(recover_company_websites(records, _city_matches), timeout=20)
        except Exception:
            pass  # Missing/blocked website evidence stays blank; sourced contacts remain.
        await _send_progress(on_progress, {'type':'stage', 'phase':'websites', 'label':f'Checking public websites for {len(records)} companies'})
        result = await enrich_public_websites(records,
            max_pages_per_site=max(1, min(5, int(os.getenv('LEAD_CRAWL_MAX_PAGES','3')))),
            max_concurrency=max(1, min(8, int(os.getenv('LEAD_CRAWL_MAX_CONCURRENCY','3')))),
            on_progress=on_progress)
        if os.getenv('LEAD_AUTHORITY_SEARCH','1') != '0':
            await _send_progress(on_progress, {'type':'stage', 'phase':'authority', 'label':'Checking public owner information; keeping sourced contacts available'})
            try:
                await asyncio.wait_for(enrich_authority_via_search(result,
                    max_lookups=max(0, min(25, int(os.getenv('LEAD_AUTHORITY_MAX','25'))))), timeout=15)
            except Exception:
                pass
        return result
    task = asyncio.create_task(work())
    try:
        done, _ = await asyncio.wait({task}, timeout=timeout)
        if task in done:
            try: return task.result()
            except Exception as exc:
                logger.info('Optional enrichment stopped: %s', type(exc).__name__)
                await _send_progress(on_progress, {'type':'warning','label':'Website checks unavailable; preserving sourced contacts'})
        else:
            await _send_progress(on_progress, {'type':'timeout','label':'Website time budget reached; preparing contacts already found'})
    finally:
        if not task.done():
            task.cancel()
            _enrichment_cleanup.add(task)
            def finish(t):
                _enrichment_cleanup.discard(t)
                if not t.cancelled(): t.exception()
            task.add_done_callback(finish)
            await asyncio.wait({task}, timeout=1)
    return json.loads(json.dumps(records))


async def _enrichment_events(records, save=None):
    queue = asyncio.Queue()
    started = time.monotonic()
    last_label = f'Checking public websites for {len(records)} companies'
    async def report(event):
        nonlocal last_label
        last_label = event.get('label') or last_label
        # Freeze payloads before another site mutates the shared records.
        await queue.put(json.loads(json.dumps(event)))
    task = asyncio.create_task(_bounded_enrichment(records, report))
    try:
        while not task.done() or not queue.empty():
            try: event = await asyncio.wait_for(queue.get(), timeout=2)
            except asyncio.TimeoutError:
                event = {'type':'heartbeat','label':last_label, 'elapsedSeconds':int(time.monotonic()-started)}
            yield json.dumps(event) + '\n'
        enriched = await task
        if save: save(enriched)
        yield json.dumps({'type':'result','records':enriched}) + '\n'
    finally:
        if not task.done():
            task.cancel()
            await asyncio.wait({task}, timeout=2)


def _save_crm_lead(db: Session, record: LeadRecord, item: dict) -> None:
    crm = upsert_lead(db, record.owner_user_id, record.id, public_lead(item),
                      created_at=record.created_at, source="backend")
    item["crmRecordId"] = crm.id
    item["sourceId"] = record.id
    record.payload = json.dumps(item)


async def _run_apify(job_id: str, user_id: str, db_factory) -> None:
    db: Session = db_factory()
    job = db.query(LeadJob).filter_by(id=job_id, owner_user_id=user_id).first()
    if not job or job.status == "cancelled":
        db.close(); return
    user = db.query(UserAccount).filter_by(id=user_id).first()
    job.status, job.updated_at = "running", time.time(); db.commit()
    try:
        query = json.loads(job.request_payload)
        search_queries = _search_plan(query["cities"], query["industries"], min(12, max(3, query["count"])))
        max_queries = min(len(search_queries), query["count"])
        query_count = max_queries
        if query_count < len(search_queries):
            step = len(search_queries) / query_count
            search_queries = [search_queries[int(index * step)] for index in range(query_count)]
        valid_items: list[dict] = []
        provider = "Scrapling"
        provider_errors: list[str] = []

        # Use Apify when available; public Maps discovery covers missing keys,
        # exhausted credits, and empty datasets with the same contact filters.
        token = get_provider_secret("apify", user, db) if user and "apify" in query.get("sources", ["apify"]) else None
        if token:
            try:
                per_query = max(1, min(40, query["count"] // len(search_queries)))
                actor_input = {"searchStringsArray": search_queries, "maxCrawledPlacesPerSearch": per_query}
                url = "https://api.apify.com/v2/acts/compass~crawler-google-places/runs"
                async with httpx.AsyncClient(timeout=httpx.Timeout(35.0, connect=10.0)) as client:
                    headers = {"Authorization": f"Bearer {token}"}
                    response = await client.post(url, headers=headers, json=actor_input, params={"timeout": 300})
                    response.raise_for_status()
                    run = response.json()["data"]
                    run_id = run["id"]
                    dataset_id = run.get("defaultDatasetId")
                    deadline = time.monotonic() + 310
                    was_cancelled = False
                    while run["status"] not in {"SUCCEEDED", "FAILED", "ABORTED", "TIMED-OUT"}:
                        db.refresh(job)
                        if job.status == "cancelled":
                            await client.post(f"https://api.apify.com/v2/actor-runs/{run_id}/abort", headers=headers)
                            was_cancelled = True
                            break
                        job.error = "Apify Google Maps: " + str(run.get("statusMessage") or run["status"])[:180]
                        job.updated_at = time.time(); db.commit()
                        if time.monotonic() > deadline:
                            await client.post(f"https://api.apify.com/v2/actor-runs/{run_id}/abort", headers=headers)
                            raise RuntimeError("Apify exceeded five minutes. Reduce the search size and retry.")
                        response = await client.get(f"https://api.apify.com/v2/actor-runs/{run_id}", headers=headers, params={"waitForFinish": 10})
                        response.raise_for_status()
                        run = response.json()["data"]
                        dataset_id = run.get("defaultDatasetId") or dataset_id
                    if run["status"] != "SUCCEEDED" and not was_cancelled:
                        raise RuntimeError("Apify run " + run["status"] + ": " + str(run.get("statusMessage") or "Check actor credits and input"))
                    if not dataset_id: raise RuntimeError("Apify returned no dataset ID")
                    response = await client.get(f"https://api.apify.com/v2/datasets/{dataset_id}/items",
                                                headers=headers, params={"clean": "true", "limit": 300})
                    response.raise_for_status()
                    items = response.json()
                if not isinstance(items, list):
                    raise RuntimeError("Apify returned an invalid lead dataset")
                requested_cities = [str(city).strip() for city in query["cities"]]
                for item in items:
                    if not isinstance(item, dict) or not item.get("title") or _is_provider(item):
                        continue
                    place = " ".join(str(item.get(field) or "") for field in ("city", "address", "formattedAddress")).casefold()
                    if not any(_city_matches(city, place) for city in requested_cities):
                        continue
                    source = str(item.get("searchString") or item.get("searchQuery") or "").strip()
                    matched_query = next((q for q in search_queries if source.casefold().startswith(q.casefold())), None)
                    if not matched_query:
                        location_text = " ".join(str(item.get(field) or "") for field in ("city", "address", "formattedAddress")).casefold()
                        matched_city = next((city for city in sorted(requested_cities, key=len, reverse=True) if _city_matches(city, location_text)), None)
                        if not matched_city and len(requested_cities) == 1:
                            matched_city = requested_cities[0]
                        matched_query = next((q for q in search_queries if matched_city and q.casefold().endswith(f" in {matched_city.casefold()}")), None)
                    if matched_query:
                        item["searchString"] = matched_query
                        valid_items.append(item)
                valid_items = _spread_results(valid_items, search_queries, min(200, query["count"] * 2))
                if valid_items:
                    provider = "Apify"
                else:
                    provider_errors.append("Apify returned no usable leads")
            except Exception as exc:
                if isinstance(exc, httpx.HTTPStatusError):
                    code = exc.response.status_code
                    reason = "key rejected" if code in (401, 403) else "credits or billing required" if code == 402 else "rate limited" if code == 429 else f"HTTP {code}"
                    provider_errors.append(f"Apify {reason}")
                elif isinstance(exc, httpx.TimeoutException):
                    provider_errors.append("Apify timed out")
                else:
                    provider_errors.append(f"Apify: {str(exc)[:180]}")
                logger.warning("Apify lead source failed: %s", type(exc).__name__)
                job.error = provider_errors[-1] + "; trying public Maps listings"
                job.updated_at = time.time(); db.commit()
        else:
            job.error = "Apify token not set; searching public Maps listings"
            job.updated_at = time.time(); db.commit()

        db.refresh(job)
        if job.status == "cancelled" and not valid_items: return
        if "maps" in query.get("sources", ["maps"]) and len(_contactable_items(valid_items, search_queries, query['count'])) < query['count']:
            semaphore = asyncio.Semaphore(3)

            per_query = max(3, min(query["count"], math.ceil(query["count"] * 2.2 / len(search_queries))))

            async def discover(query_text: str) -> list[dict]:
                async with semaphore:
                    db.refresh(job)
                    if job.status == 'cancelled': return []
                    job.error = 'Searching public Maps · ' + query_text[:150]
                    job.updated_at = time.time(); db.commit()
                    try:
                        found = await asyncio.wait_for(discover_businesses(query_text, per_query, concurrency=4), timeout=60)
                    except Exception as exc:
                        logger.info('Maps query skipped: %s', type(exc).__name__)
                        return []
                    job.error = f'Public Maps · {query_text[:120]} · {len(found)} listings found'
                    job.updated_at = time.time(); db.commit()
                    return found

            job.error = "Searching public Maps listings"; job.updated_at = time.time(); db.commit()
            source_timeout = max(90, min(240, 30 * math.ceil(len(search_queries) / 3)))
            results = await asyncio.wait_for(asyncio.gather(
                *(discover(search) for search in search_queries), return_exceptions=True), timeout=source_timeout)
            for search, result in zip(search_queries, results):
                if isinstance(result, Exception):
                    provider_errors.append(f"Scrapling ({search}): {str(result)[:180]}")
                    logger.warning("Scrapling lead source failed for %r: %s", search, result)
                    continue
                for item in result:
                    place = " ".join(str(item.get(field) or "") for field in ("city", "address", "formattedAddress")) if isinstance(item, dict) else ""
                    if isinstance(item, dict) and item.get("title") and not _is_provider(item) and any(_city_matches(city, place) for city in query["cities"]):
                        item["searchString"] = search
                        valid_items.append(item)
            valid_items = _spread_results(valid_items, search_queries, min(200, query["count"] * 2))
            provider = 'Apify + public Maps' if provider == 'Apify' else 'Scrapling'

        for item in valid_items:
            item.setdefault("source", provider)
        # Publish genuine Maps contacts before optional website enrichment.
        # Updates reuse these records rather than inserting a second copy.
        published = {}
        published_items = _contactable_items(valid_items, search_queries, query["count"])
        for item in published_items:
            record = LeadRecord(id=f"lead_{uuid.uuid4().hex}", owner_user_id=user_id, job_id=job_id,
                                payload=json.dumps(item), created_at=time.time())
            db.add(record)
            _save_crm_lead(db, record, item)
            published[id(item)] = record
        job.result_count = len(published)
        job.error = f"{len(published)} sourced contacts saved; checking company websites"
        job.updated_at = time.time(); db.commit()
        db.refresh(job)
        if job.status == "cancelled": return
        directories = [source for source in query.get("sources", ["sulekha", "justdial"])
                       if source in {"sulekha", "justdial"}]
        if directories:
            async def directory_progress(event):
                db.refresh(job)
                if job.status == "cancelled": raise asyncio.CancelledError()
                job.error = event["label"]
                job.updated_at = time.time(); db.commit()
            try:
                extra = await asyncio.wait_for(discover_indexed_businesses(
                    search_queries, directories, existing=valid_items, discover=discover_businesses,
                    matches_city=_city_matches, on_progress=directory_progress,
                    cancelled=lambda: job.status == "cancelled"), timeout=90)
                valid_items.extend(item for item in extra if not _is_provider(item))
            except asyncio.TimeoutError:
                logger.info("Additional business discovery time budget reached")
            except Exception as exc:
                logger.warning("Additional discovery unavailable: %s", type(exc).__name__)
        if not valid_items:
            raise RuntimeError("No contactable companies were found in the requested area")
        if os.getenv("LEAD_WEBSITE_CRAWLER_ENABLED", "true").strip().lower() == "true":
            pending = sorted(
                [item for item in valid_items if
                 not ((item.get("phone") or item.get("phoneNumber")) and item.get("email") and item.get("contactPerson") and item.get("website"))],
                key=lambda item: bool(item.get("phone") or item.get("phoneNumber")),
            )
            async def company_progress(event):
                db.refresh(job)
                if job.status == 'cancelled': raise asyncio.CancelledError()
                job.error = json.dumps({k:v for k,v in event.items() if k != 'records'})
                # Publish newly observed contacts immediately, without duplicating slots.
                for item in _contactable_items(valid_items, search_queries, query['count']):
                    record = published.get(id(item))
                    if not record and len(published) < query['count']:
                        record = LeadRecord(id=f'lead_{uuid.uuid4().hex}', owner_user_id=user_id,
                                            job_id=job_id, payload='{}', created_at=time.time())
                        db.add(record); published[id(item)] = record; published_items.append(item)
                    if record: _save_crm_lead(db, record, item)
                job.result_count = len(published)
                job.updated_at = time.time(); db.commit()
            try:
                if pending: await _bounded_enrichment(pending, company_progress)
            except Exception as exc:
                # Contact enrichment is additive. Preserve real Maps leads if
                # a website blocks the crawler or times out.
                logger.warning("Website enrichment skipped after source success: %s", exc)
        db.refresh(job)
        if job.status == "cancelled": return
        # Already accepted contacts keep their slots; enrichment only fills the remainder.
        additional = [item for item in _contactable_items(valid_items, search_queries, query["count"])
                      if id(item) not in published]
        valid_items = (published_items + additional)[:query["count"]]
        if not valid_items:
            raise RuntimeError("Map listings and public websites supplied no contact details. Try another business category or a wider area.")
        for item in valid_items:
            record = published.get(id(item))
            if record:
                _save_crm_lead(db, record, item)
            else:
                record = LeadRecord(id=f"lead_{uuid.uuid4().hex}", owner_user_id=user_id, job_id=job_id,
                                    payload=json.dumps(item), created_at=time.time())
                db.add(record)
                _save_crm_lead(db, record, item)
        job.result_count = len(valid_items)
        job.error = None
        job.status = "completed" if job.result_count >= query["count"] else ("partial" if job.result_count else "failed")
        if job.status == "failed":
            job.error = "Provider returned no usable leads"
    except httpx.HTTPError:
        job.status, job.error = "failed", "Lead provider request failed"
    except RuntimeError as exc:
        job.status, job.error = "failed", str(exc)[:300]
    except asyncio.TimeoutError:
        job.status, job.error = "failed", "The browser lead source timed out. Narrow the category or area and retry."
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
    leads = [{"id": r.id, **public_lead(json.loads(r.payload)), "created_at": r.created_at} for r in records]
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
    return {"success": True, "leads": [{"id": r.id, "job_id": r.job_id, **public_lead(json.loads(r.payload)), "created_at": r.created_at} for r in records]}


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
async def maps_search(req: MapsSearchRequest, db: Session = Depends(get_db),
                      user: UserAccount = Depends(get_current_user)):
    """Keyless Google Maps discovery via Scrapling — no Apify, no login.

    Authenticated and metered. It used to be neither: anyone who could reach
    this backend could spend the operator's scraping capacity, and there was
    no tenant to charge the leads to.
    """
    left = remaining(db, user, "leads")
    if left <= 0:
        raise HTTPException(status_code=429,
                            detail="Aaj ki leads limit poori ho gayi. Kal apne aap reset ho jayegi.")

    # Never scrape more than the tenant is allowed to keep — a browser search
    # we then have to throw away is cost with nothing to show for it.
    per_query = max(1, min(req.max_per_query, -(-left // max(1, len(req.queries)))))
    semaphore = asyncio.Semaphore(3)

    async def search(query: str):
        async with semaphore:
            return await asyncio.wait_for(discover_businesses(query, per_query, concurrency=4), timeout=60)

    results = await asyncio.gather(*(search(query) for query in req.queries), return_exceptions=True)
    all_items: list[dict] = []
    failures: list[str] = []
    for query, result in zip(req.queries, results):
        if isinstance(result, BaseException):
            failures.append(str(result))
            logger.warning("Maps search failed for %r: %s", query, result)
            continue
        for item in result:
            item["searchString"] = query
        all_items.extend(result)
    if failures and not all_items:
        raise HTTPException(status_code=503, detail=failures[0][:200])
    # Charged on what actually came back, trimmed to what was left. A blocked
    # or empty search costs the tenant nothing.
    if len(all_items) > left:
        all_items = all_items[:left]
    if all_items:
        for item in all_items:
            # Reuse only a provider identity, never a company-name similarity.
            provider_id = str(item.get("placeId") or item.get("url") or "")
            source_id = ("maps_" + hashlib.sha256((user.id + "|" + provider_id).encode()).hexdigest()[:59]
                         if provider_id else f"lead_{uuid.uuid4().hex}")
            record = db.query(LeadRecord).filter_by(id=source_id, owner_user_id=user.id).first()
            if not record:
                record = LeadRecord(id=source_id, owner_user_id=user.id, job_id="maps-search",
                                    payload="{}", created_at=time.time())
                db.add(record)
            item["id"] = source_id
            _save_crm_lead(db, record, item)
        db.commit()
        consume(db, user, "leads", len(all_items))
    return {"success": True, "items": all_items, "leads_left": remaining(db, user, "leads")}


class EnrichWebsitesRequest(BaseModel):
    records: list[dict] = Field(min_length=1, max_length=100)


@router.post("/leads/enrich-websites")
async def enrich_websites_route(req: EnrichWebsitesRequest,
                                db: Session = Depends(get_db),
                                user: UserAccount = Depends(get_current_user)):
    """Read each record's own public website (homepage + /contact, /about, …)
    for a real email/phone using the Crawlee+Playwright crawler already in
    this repo — the same keyless enrichment _run_apify uses, exposed here for
    the frontend's client-side lead pipeline. Never fabricates a value."""
    enriched = await _bounded_enrichment(req.records)
    _persist_enrichment(db, user, enriched)
    return {"success": True, "records": enriched}


def _persist_enrichment(db, user, enriched):
    for item in enriched:
        source_id = str(item.get("sourceId") or item.get("id") or "")
        record = db.query(LeadRecord).filter_by(id=source_id, owner_user_id=user.id).first() if source_id else None
        if record:
            # Older callers send only ID + website. Preserve the original profile.
            merged = {**json.loads(record.payload), **{k:v for k,v in item.items() if v not in (None, '', [])}}
            _save_crm_lead(db, record, merged)
    db.commit()


@router.post('/leads/enrich-websites/stream')
async def enrich_websites_stream(req: EnrichWebsitesRequest,
                                db: Session = Depends(get_db),
                                user: UserAccount = Depends(get_current_user)):
    return StreamingResponse(_enrichment_events(req.records,
        lambda enriched: _persist_enrichment(db, user, enriched)),
        media_type='application/x-ndjson', headers={'Cache-Control':'no-store','X-Accel-Buffering':'no'})
