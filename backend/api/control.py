"""Owner-only control plane; ordinary clients receive capabilities only."""
import asyncio
import json
import os
import re
import time
import uuid
from datetime import datetime, timezone
from typing import Literal

import httpx
from fastapi import APIRouter, Depends, HTTPException, Query, Request, BackgroundTasks
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field, ConfigDict
from sqlalchemy import Column, String, Float, Integer, Text, func, or_
from sqlalchemy.orm import Session
from api.auth_sync import AUTO_CREATE_SCHEMA, Base, engine, get_db, get_current_user, UserAccount, SessionLocal
from services.developer_control import (AccountControl, ManagedSession, ProviderAssignment, ProviderBudget,
    ControlAudit, UsageEvent, FEATURES, DISCLOSURE_VERSION, require_owner, account, audit, bump, check_access, is_owner)

router = APIRouter(prefix='/api/control', tags=['developer_control'])

class Release(Base):
    __tablename__ = 'control_releases'
    id = Column(String(36), primary_key=True)
    version = Column(String(40), nullable=False)
    platform = Column(String(20), nullable=False)
    manifest = Column(Text, nullable=False)
    notes = Column(String(2000), nullable=False, default='')
    status = Column(String(16), nullable=False, default='draft')
    cohort = Column(Integer, nullable=False, default=0)
    created_at = Column(Float, nullable=False, default=time.time)
    updated_at = Column(Float, nullable=False, default=time.time)

if AUTO_CREATE_SCHEMA:
    Base.metadata.create_all(bind=engine)
    from api.auth_sync import ensure_columns
    ensure_columns()

class Strict(BaseModel):
    model_config = ConfigDict(extra='forbid')

class AccountPatch(Strict):
    status: Literal['pending', 'active', 'trial', 'blocked'] | None = None
    expires_at: float | None = Field(None, ge=0)
    features: dict[str, bool] | None = None
    daily_limits: dict[str, int] | None = None
    monthly_limits: dict[str, int] | None = None
    note: str | None = Field(None, max_length=500)

class ProviderPatch(Strict):
    mode: Literal['shared', 'individual', 'disabled']
    secret: str | None = Field(None, max_length=4096)

class SharedProvider(Strict):
    secret: str | None = Field(None, max_length=4096)
    enabled: bool = False
    monthly_requests: int = Field(0, ge=0, le=10000000)
    monthly_spend_inr: float = Field(0, ge=0, le=10000000)
    max_request_cost_inr: float = Field(0, ge=0, le=10000000)

class Disclosure(Strict):
    version: str
    accepted: Literal[True]

class Activity(Strict):
    kind: Literal['route', 'task_completed', 'task_failed', 'sync']
    page: str = Field('', max_length=80)
    state: Literal['synced', 'pending', 'offline', ''] = ''

class ReleaseInput(Strict):
    version: str = Field(pattern=r'^\d+\.\d+\.\d+(?:-[A-Za-z0-9.]+)?$', max_length=40)
    platform: Literal['desktop-ui', 'web', 'android', 'windows']
    manifest: dict
    notes: str = Field('', max_length=2000)

class ReleaseAction(Strict):
    action: Literal['publish', 'pause', 'promote', 'rollback']


def target_user(db, uid):
    user = db.query(UserAccount).filter_by(id=uid).first()
    if not user: raise HTTPException(404, 'User not found')
    return user


def policy_payload(db, user):
    from api.limits import snapshot
    from api.billing import entitlement
    row = account(db, user.id)
    from services.developer_control import managed_access
    status = 'active' if row.status == 'pending' and not managed_access() else row.status
    return {'user_id': user.id, 'owner': bool(getattr(user, '_verified_owner', False)), 'status': status, 'expires_at': row.expires_at,
            'testing': not managed_access(),
            'features': {k: json.loads(row.features).get(k, True) for k in FEATURES},
            'monthly_limits': json.loads(row.monthly_limits), 'revision': row.revision,
            'disclosure': {'version': DISCLOSURE_VERSION, 'accepted': row.disclosure_version == DISCLOSURE_VERSION},
            'limits': snapshot(db, user), 'subscription': entitlement(user, db), 'note': row.note}


@router.get('/me')
def my_control(db: Session = Depends(get_db), user: UserAccount = Depends(get_current_user)):
    value = policy_payload(db, user)
    value.pop('note', None)
    value['providers'] = provider_status(db, user.id)
    return value


@router.post('/disclosure')
def accept_disclosure(payload: Disclosure, db: Session = Depends(get_db), user: UserAccount = Depends(get_current_user)):
    if payload.version != DISCLOSURE_VERSION: raise HTTPException(409, 'Please read the current disclosure')
    row = account(db, user.id)
    row.disclosure_version, row.disclosure_at = payload.version, time.time()
    bump(db, user.id)
    audit(db, user, user.id, 'disclosure.accepted', {'version': payload.version})
    db.commit()
    return {'accepted': True}


@router.post('/activity')
def activity(payload: Activity, db: Session = Depends(get_db), user: UserAccount = Depends(get_current_user)):
    detail = {'page': re.sub(r'[^A-Za-z0-9_#-]', '', payload.page), 'state': payload.state}
    last = db.query(ControlAudit).filter_by(actor_id=user.id, action='client.' + payload.kind).order_by(ControlAudit.created_at.desc()).first()
    if last and last.created_at > time.time() - 5 and json.loads(last.detail) == detail: return {'ok': True}
    # Never accept message contents, headers, arbitrary URLs or stack traces.
    audit(db, user, user.id, 'client.' + payload.kind, detail)
    db.commit()
    return {'ok': True}


@router.get('/users')
def users(q: str = Query('', max_length=200), offset: int = Query(0, ge=0), limit: int = Query(30, ge=1, le=100), db: Session = Depends(get_db), owner: UserAccount = Depends(require_owner)):
    query = db.query(UserAccount)
    if q:
        safe = q.replace('\\', '\\\\').replace('%', '\\%').replace('_', '\\_')
        query = query.filter(or_(UserAccount.email.ilike('%' + safe + '%', escape='\\'), UserAccount.name.ilike('%' + safe + '%', escape='\\')))
    total = query.count()
    items = []
    for user in query.order_by(UserAccount.created_at.desc(), UserAccount.id).offset(offset).limit(limit):
        row = account(db, user.id, False)
        items.append({'id': user.id, 'email': user.email, 'name': user.name, 'company': user.company,
                      'status': row.status if row else 'unmanaged', 'last_seen': user.last_login,
                      'revision': row.revision if row else 0})
    return {'items': items, 'total': total, 'offset': offset, 'limit': limit}


@router.get('/users/{uid}')
def user_detail(uid: str, db: Session = Depends(get_db), owner: UserAccount = Depends(require_owner)):
    user = target_user(db, uid)
    from api.developer_insights import ProductSession
    devices = db.query(ProductSession).filter_by(user_id=uid).order_by(ProductSession.last_seen_at.desc()).limit(30).all()
    sync = db.query(ControlAudit).filter_by(actor_id=uid, action='client.sync').order_by(ControlAudit.created_at.desc()).first()
    audit(db, owner, uid, 'account.view')
    db.commit()
    return {**policy_payload(db, user), 'email': user.email, 'name': user.name, 'phone': user.phone, 'company': user.company,
            'providers': provider_status(db, uid),
            'sync': {'state': json.loads(sync.detail).get('state'), 'reported_at': sync.created_at} if sync else None,
            'devices': [{'label': s.device_label, 'platform': s.platform, 'last_seen': s.last_seen_at} for s in devices]}


@router.patch('/users/{uid}')
def patch_user(uid: str, payload: AccountPatch, background: BackgroundTasks, db: Session = Depends(get_db), owner: UserAccount = Depends(require_owner)):
    user = target_user(db, uid)
    if is_owner(user) and payload.status == 'blocked': raise HTTPException(409, 'Owner account cannot block itself')
    from api.limits import _row, METERS
    for values in (payload.daily_limits, payload.monthly_limits):
        if values and (set(values) - set(METERS) or any(v < 0 or v > 10000000 for v in values.values())): raise HTTPException(422, 'Invalid allowance')
    if payload.features and set(payload.features) - set(FEATURES): raise HTTPException(422, 'Unknown feature')
    row = account(db, uid)
    if payload.status is not None: row.status = payload.status
    if payload.expires_at is not None: row.expires_at = payload.expires_at
    if payload.features is not None: row.features = json.dumps(payload.features)
    if payload.monthly_limits is not None: row.monthly_limits = json.dumps(payload.monthly_limits)
    if payload.note is not None: row.note = payload.note
    limits = _row(db, user)
    if payload.status is not None: limits.blocked = int(payload.status == 'blocked')
    if payload.daily_limits:
        for meter, cap in payload.daily_limits.items(): setattr(limits, meter + '_per_day', cap)
    if payload.status == 'blocked':
        revoke_user_sessions(db, uid)
        background.add_task(cancel_remote_batches, uid, owner.id)
    bump(db, uid)
    audit(db, owner, uid, 'account.update', payload.model_dump(exclude_none=True))
    db.commit()
    return policy_payload(db, user)


async def cancel_remote_batches(uid, actor_id):
    from api.elevenlabs import ElevenLabsResource, cancel_batch
    with SessionLocal() as db:
        target = db.query(UserAccount).filter_by(id=uid).first()
        actor = db.query(UserAccount).filter_by(id=actor_id).first()
        if not target or not actor: return
        target._control_cancel = True
        rows = db.query(ElevenLabsResource).filter_by(owner_user_id=uid, kind='batch_request').all()
        for row in rows:
            details = json.loads(row.details or '{}')
            if details.get('status') not in ('pending','in_progress','submitting','unknown'): continue
            bid = details.get('batch_id')
            if not bid: continue
            try:
                await cancel_batch(bid, db, target)
                audit(db, actor, uid, 'batch.cancel.requested', {'batch_id': bid})
            except Exception:
                db.rollback()
                audit(db, actor, uid, 'batch.cancel.needs_review', {'batch_id': bid})
            db.commit()


def revoke_user_sessions(db, uid):
    account(db, uid).revoked_before = time.time()
    db.query(ManagedSession).filter_by(user_id=uid).update({ManagedSession.revoked: 1}, synchronize_session=False)
    # Explicit revocation also stops jobs that outlive their browser session.
    from api.lead_jobs import LeadJob
    from api.mobile_jobs import OutreachJob
    db.query(LeadJob).filter(LeadJob.owner_user_id == uid, LeadJob.status.in_(['queued','running'])).update({LeadJob.status: 'cancelled'}, synchronize_session=False)
    db.query(OutreachJob).filter(OutreachJob.owner_user_id == uid, OutreachJob.status == 'queued').update({OutreachJob.status: 'paused'}, synchronize_session=False)


@router.post('/users/{uid}/revoke')
def revoke(uid: str, background: BackgroundTasks, db: Session = Depends(get_db), owner: UserAccount = Depends(require_owner)):
    target_user(db, uid)
    if uid == owner.id: raise HTTPException(409, 'Use sign out to revoke your current owner session')
    revoke_user_sessions(db, uid)
    background.add_task(cancel_remote_batches, uid, owner.id)
    bump(db, uid)
    audit(db, owner, uid, 'sessions.revoked')
    db.commit()
    return {'ok': True}


def provider_status(db, uid):
    from api.credentials import ProviderCredential, ALLOWED_PROVIDERS
    assignments = {r.provider: r.mode for r in db.query(ProviderAssignment).filter_by(user_id=uid)}
    own = {r.provider for r in db.query(ProviderCredential).filter_by(owner_user_id=uid) if r.ciphertext}
    shared = {r.provider for r in db.query(ProviderCredential).filter_by(owner_user_id='__platform__') if r.ciphertext}
    shared &= {r.provider for r in db.query(ProviderBudget).filter_by(enabled=1)}
    return [{'provider': p, 'mode': assignments.get(p, 'individual' if p in own else 'disabled'),
             'configured': p in (shared if assignments.get(p) == 'shared' else own) and assignments.get(p) != 'disabled'} for p in sorted(ALLOWED_PROVIDERS)]


def save_key(db, uid, provider, secret):
    from api.credentials import ProviderCredential, encrypt_secret, probe_key
    clean = (secret or '').strip()
    if not clean: raise HTTPException(422, 'Paste a key first')
    state, note = probe_key(provider, clean)
    if state == 'rejected': raise HTTPException(422, 'Provider rejected this credential')
    ciphertext, nonce = encrypt_secret(clean)
    row = db.query(ProviderCredential).filter_by(owner_user_id=uid, provider=provider).first()
    if not row:
        row = ProviderCredential(owner_user_id=uid, provider=provider, ciphertext=ciphertext, nonce=nonce)
        db.add(row)
    row.ciphertext, row.nonce, row.updated_at = ciphertext, nonce, time.time()
    return {'verified': state == 'ok', 'note': note}


@router.put('/users/{uid}/providers/{provider}')
def assign_provider(uid: str, provider: str, payload: ProviderPatch, db: Session = Depends(get_db), owner: UserAccount = Depends(require_owner)):
    target_user(db, uid)
    from api.credentials import ALLOWED_PROVIDERS
    if provider not in ALLOWED_PROVIDERS: raise HTTPException(422, 'Unsupported provider')
    result = {}
    if payload.mode == 'individual' and payload.secret is not None: result = save_key(db, uid, provider, payload.secret)
    row = db.query(ProviderAssignment).filter_by(user_id=uid, provider=provider).first()
    if not row:
        row = ProviderAssignment(user_id=uid, provider=provider)
        db.add(row)
    row.mode, row.updated_at = payload.mode, time.time()
    bump(db, uid)
    audit(db, owner, uid, 'provider.assignment', {'provider': provider, 'mode': payload.mode, 'key_changed': payload.secret is not None})
    db.commit()
    return {'ok': True, **result, 'providers': provider_status(db, uid)}


@router.get('/providers')
def shared_providers(db: Session = Depends(get_db), owner: UserAccount = Depends(require_owner)):
    from api.credentials import ALLOWED_PROVIDERS, ProviderCredential
    result = []
    for provider in sorted(ALLOWED_PROVIDERS):
        credential = db.query(ProviderCredential).filter_by(owner_user_id='__platform__', provider=provider).first()
        budget = db.query(ProviderBudget).filter_by(provider=provider).first()
        result.append({'provider': provider, 'configured': bool(credential and credential.ciphertext), 'enabled': bool(budget and budget.enabled),
                       'monthly_requests': budget.monthly_units if budget else 0, 'used_requests': budget.used_units if budget else 0,
                       'month': budget.month if budget else '', 'monthly_spend_inr': budget.monthly_spend if budget else 0,
                       'reserved_spend_inr': budget.reserved_spend if budget else 0, 'max_request_cost_inr': budget.cost_per_request if budget else 0, 'basis': 'request ceiling, not provider bill'})
    return {'items': result}


@router.put('/providers/{provider}')
def shared_provider(provider: str, payload: SharedProvider, db: Session = Depends(get_db), owner: UserAccount = Depends(require_owner)):
    from api.credentials import ALLOWED_PROVIDERS
    if provider not in ALLOWED_PROVIDERS: raise HTTPException(422, 'Unsupported provider')
    if payload.monthly_spend_inr > 0 and payload.max_request_cost_inr <= 0: raise HTTPException(422, 'Set a conservative maximum cost per request for the spending ceiling')
    result = save_key(db, '__platform__', provider, payload.secret) if payload.secret is not None else {}
    row = db.query(ProviderBudget).filter_by(provider=provider).first()
    if not row:
        row = ProviderBudget(provider=provider)
        db.add(row)
    row.enabled, row.monthly_units = int(payload.enabled), payload.monthly_requests
    row.monthly_spend, row.cost_per_request = payload.monthly_spend_inr, payload.max_request_cost_inr
    affected = db.query(ProviderAssignment.user_id).filter_by(provider=provider, mode='shared')
    db.query(AccountControl).filter(AccountControl.user_id.in_(affected)).update({AccountControl.revision: AccountControl.revision + 1}, synchronize_session=False)
    audit(db, owner, '__platform__', 'provider.shared', {'provider': provider, 'enabled': payload.enabled, 'monthly_requests': payload.monthly_requests, 'key_changed': payload.secret is not None})
    db.commit()
    return {'ok': True, **result}


@router.get('/users/{uid}/usage')
def usage(uid: str, offset: int = Query(0, ge=0), limit: int = Query(50, ge=1, le=100), db: Session = Depends(get_db), owner: UserAccount = Depends(require_owner)):
    target_user(db, uid)
    query = db.query(UsageEvent).filter_by(user_id=uid)
    return {'items': [{'id': e.id, 'request_id': e.request_id, 'meter': e.meter, 'provider': e.provider, 'amount': e.amount,
                       'state': e.state, 'basis': e.basis, 'estimated_cost': e.estimated_cost, 'created_at': e.created_at} for e in query.order_by(UsageEvent.created_at.desc()).offset(offset).limit(limit)], 'total': query.count()}


@router.get('/users/{uid}/audit')
def audit_log(uid: str, offset: int = Query(0, ge=0), limit: int = Query(50, ge=1, le=100), db: Session = Depends(get_db), owner: UserAccount = Depends(require_owner)):
    target_user(db, uid)
    query = db.query(ControlAudit).filter_by(target_id=uid)
    return {'items': [{'action': e.action, 'actor_id': e.actor_id, 'detail': json.loads(e.detail), 'created_at': e.created_at} for e in query.order_by(ControlAudit.created_at.desc()).offset(offset).limit(limit)], 'total': query.count()}


CONTENT_SECTIONS = {'leads', 'candidates', 'jarvis_facts', 'jarvis_messages', 'jarvis_scripts', 'jarvis_tasks', 'client_chat', 'candidate_chat'}

@router.get('/users/{uid}/content/{section}')
def content(uid: str, section: str, offset: int = Query(0, ge=0), limit: int = Query(30, ge=1, le=100), db: Session = Depends(get_db), owner: UserAccount = Depends(require_owner)):
    user = target_user(db, uid)
    row = account(db, uid)
    if row.disclosure_version != DISCLOSURE_VERSION: raise HTTPException(409, 'User has not acknowledged app-data visibility')
    if section not in CONTENT_SECTIONS: raise HTTPException(422, 'Unknown content section')
    base, key = os.getenv('SUPABASE_URL', '').rstrip('/'), os.getenv('SUPABASE_SECRET_KEY', '') or os.getenv('SUPABASE_SERVICE_ROLE_KEY', '')
    if not base or not key: raise HTTPException(503, 'Server account-data access is not configured')
    try:
        response = httpx.get(base + '/rest/v1/clavis_user_data', params={'user_id': 'eq.' + uid, 'select': 'payload,updated_at', 'limit': '1'}, headers={'apikey': key, 'Authorization': 'Bearer ' + key}, timeout=10)
        response.raise_for_status()
        records = response.json()
    except (httpx.HTTPError, ValueError): raise HTTPException(503, 'Account sync snapshot is unavailable') from None
    snapshot = records[0] if records else {}
    items = (snapshot.get('payload') or {}).get(section, [])
    if not isinstance(items, list): items = [items]
    audit(db, owner, uid, 'content.view', {'section': section, 'offset': offset, 'limit': limit})
    db.commit()
    return {'items': items[offset:offset + limit], 'total': len(items), 'synced_at': snapshot.get('updated_at'), 'source': 'last successful cloud sync'}


@router.get('/users/{uid}/calls')
def call_records(uid: str, offset: int = Query(0, ge=0), limit: int = Query(30, ge=1, le=100), db: Session = Depends(get_db), owner: UserAccount = Depends(require_owner)):
    target_user(db, uid)
    if account(db, uid).disclosure_version != DISCLOSURE_VERSION: raise HTTPException(409, 'User disclosure acknowledgement required')
    from api.elevenlabs import ElevenLabsResource
    query = db.query(ElevenLabsResource).filter(ElevenLabsResource.owner_user_id == uid, ElevenLabsResource.kind.in_(['conversation', 'batch_request']))
    audit(db, owner, uid, 'calls.list', {'offset': offset})
    db.commit()
    return {'items': [{'id': r.resource_id, 'kind': r.kind, 'name': r.name, 'updated_at': r.updated_at} for r in query.order_by(ElevenLabsResource.updated_at.desc()).offset(offset).limit(limit)], 'total': query.count()}


@router.get('/users/{uid}/calls/{cid}')
async def call_content(uid: str, cid: str, db: Session = Depends(get_db), owner: UserAccount = Depends(require_owner)):
    target = target_user(db, uid)
    if account(db, uid).disclosure_version != DISCLOSURE_VERSION: raise HTTPException(409, 'User disclosure acknowledgement required')
    from api.elevenlabs import _conversation
    target._support_read = True
    result = await _conversation(cid, target, db)
    audit(db, owner, uid, 'call.transcript.view', {'conversation_id': cid})
    db.commit()
    return {key: result.get(key) for key in ('conversation_id', 'status', 'transcript', 'analysis', 'metadata', 'has_audio')}


@router.get('/users/{uid}/calls/{cid}/audio')
async def call_audio(uid: str, cid: str, db: Session = Depends(get_db), owner: UserAccount = Depends(require_owner)):
    target = target_user(db, uid)
    if account(db, uid).disclosure_version != DISCLOSURE_VERSION: raise HTTPException(409, 'User disclosure acknowledgement required')
    from api.elevenlabs import conversation_audio
    target._support_read = True
    result = await conversation_audio(cid, db, target)
    audit(db, owner, uid, 'call.recording.view', {'conversation_id': cid})
    db.commit()
    return result


def release_payload(row):
    return {k: getattr(row, k) for k in ('id', 'version', 'platform', 'notes', 'status', 'cohort', 'created_at', 'updated_at')} | {'manifest': json.loads(row.manifest)}


@router.get('/releases')
def releases(db: Session = Depends(get_db), owner: UserAccount = Depends(require_owner)):
    return {'items': [release_payload(r) for r in db.query(Release).order_by(Release.created_at.desc()).limit(50)]}


@router.post('/releases', status_code=201)
def new_release(payload: ReleaseInput, db: Session = Depends(get_db), owner: UserAccount = Depends(require_owner)):
    from urllib.parse import urlparse
    manifest = payload.manifest
    url = str(manifest.get('url') or '')
    parsed = urlparse(url)
    hosts = {s.strip() for s in os.getenv('CLAVIS_RELEASE_HOSTS', '').split(',') if s.strip()}
    if parsed.scheme != 'https' or parsed.hostname not in hosts or parsed.username or parsed.password: raise HTTPException(422, 'Use an allowlisted HTTPS release artifact')
    if not re.fullmatch('[a-fA-F0-9]{64}', str(manifest.get('sha256') or '')) or not manifest.get('signature') or not manifest.get('tested'):
        raise HTTPException(422, 'A tested, hashed and signed release artifact is required')
    row = Release(id=str(uuid.uuid4()), version=payload.version, platform=payload.platform, manifest=json.dumps(manifest), notes=payload.notes)
    db.add(row)
    audit(db, owner, '__platform__', 'release.created', {'release_id': row.id, 'version': payload.version})
    db.commit()
    return release_payload(row)


@router.post('/releases/{rid}/action')
def release_action(rid: str, payload: ReleaseAction, db: Session = Depends(get_db), owner: UserAccount = Depends(require_owner)):
    row = db.query(Release).filter_by(id=rid).with_for_update().first()
    if not row: raise HTTPException(404, 'Release not found')
    if payload.action == 'publish':
        if row.status not in ('draft', 'paused'): raise HTTPException(409, 'Only a draft or paused release may be published')
        row.status = 'published'
    elif payload.action == 'promote':
        if row.status != 'published': raise HTTPException(409, 'Resume/publish a release before promotion')
        row.cohort = {0: 5, 5: 25, 25: 100}.get(row.cohort, 100)
    elif payload.action == 'pause': row.status = 'paused'
    elif payload.action == 'rollback': row.status = 'rolled_back'
    row.updated_at = time.time()
    audit(db, owner, '__platform__', 'release.' + payload.action, {'release_id': rid, 'cohort': row.cohort})
    db.commit()
    return release_payload(row)


@router.get('/release')
def client_release(platform: str = Query('desktop-ui', max_length=20), db: Session = Depends(get_db), user: UserAccount = Depends(get_current_user)):
    import hashlib
    bucket = int(hashlib.sha256(user.id.encode()).hexdigest()[:8], 16) % 100
    rollback = db.query(Release).filter_by(platform=platform, status='rolled_back').order_by(Release.updated_at.desc()).first()
    for row in db.query(Release).filter_by(platform=platform, status='published').order_by(Release.updated_at.desc()).limit(50):
        if getattr(user, '_verified_owner', False) or bucket < row.cohort:
            result = release_payload(row)
            if rollback and rollback.updated_at > row.updated_at:
                result['rollback_from'] = rollback.id
            return {'release': result}
    return {'release': None, 'rollback_from': rollback.id if rollback else None}


@router.get('/events')
async def events(request: Request, db: Session = Depends(get_db), user: UserAccount = Depends(get_current_user)):
    uid = user.id
    bearer = request.headers.get('authorization', '').removeprefix('Bearer ')
    from api.auth_sync import _verify_supabase_token
    claims = _verify_supabase_token(bearer)
    # Authentication is complete. Never hold its checkout for the SSE lifetime.
    db.close()
    # Private bearer-authorized stream. Payload is just an invalidation revision.
    async def stream():
        previous = None
        while not await request.is_disconnected():
            revoked = False
            with SessionLocal() as session:
                from api.auth_sync import _verify_supabase_token
                from services.developer_control import check_session
                try:
                    if float(claims.get('exp', 0)) <= time.time(): raise HTTPException(401, 'Session expired')
                    member = session.query(UserAccount).filter_by(id=uid).first()
                    if not member: break
                    check_session(session, member, claims)
                except HTTPException:
                    revoked = True
                if not revoked:
                    current = session.query(AccountControl).filter_by(user_id=uid).first()
                    value = (current.revision, current.status) if current else (0, 'pending')
            # A slow/disconnected client must not hold this snapshot transaction.
            if revoked:
                yield 'event: revoked\ndata: {}\n\n'
                break
            if value != previous:
                yield 'data: ' + json.dumps({'revision': value[0], 'status': value[1]}) + '\n\n'
                previous = value
            yield ': heartbeat\n\n'
            await asyncio.sleep(10)
    return StreamingResponse(stream(), media_type='text/event-stream', headers={'Cache-Control': 'no-store', 'X-Accel-Buffering': 'no'})
