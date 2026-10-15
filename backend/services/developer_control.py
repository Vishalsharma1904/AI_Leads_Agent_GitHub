"""Server-owned account policy, credential assignment and audit primitives."""
import json
import os
import time
import uuid
from datetime import datetime, timezone

from fastapi import Depends, HTTPException
from fastapi.security import HTTPAuthorizationCredentials
from sqlalchemy import Column, Float, Integer, String, Text, UniqueConstraint
from sqlalchemy.exc import IntegrityError
from api.auth_sync import Base, UserAccount, get_current_user, bearer_scheme, _verify_supabase_token

FEATURES = ('ai', 'leads', 'calls', 'voice', 'whatsapp')
DISCLOSURE_VERSION = '2026-10-13'

class AccountControl(Base):
    __tablename__ = 'account_controls'
    user_id = Column(String(64), primary_key=True)
    status = Column(String(16), nullable=False, default='pending')
    expires_at = Column(Float, nullable=False, default=0)
    features = Column(Text, nullable=False, default='{}')
    monthly_limits = Column(Text, nullable=False, default='{}')
    note = Column(String(500), nullable=False, default='')
    revision = Column(Integer, nullable=False, default=1)
    disclosure_version = Column(String(32), nullable=False, default='')
    disclosure_at = Column(Float, nullable=False, default=0)
    revoked_before = Column(Float, nullable=False, default=0)
    updated_at = Column(Float, nullable=False, default=time.time)

class ManagedSession(Base):
    __tablename__ = 'managed_sessions'
    user_id = Column(String(64), primary_key=True)
    session_id = Column(String(128), primary_key=True)
    revoked = Column(Integer, nullable=False, default=0)
    last_seen = Column(Float, nullable=False, default=time.time)

class ProviderAssignment(Base):
    __tablename__ = 'provider_assignments'
    user_id = Column(String(64), primary_key=True)
    provider = Column(String(64), primary_key=True)
    mode = Column(String(16), nullable=False, default='disabled')
    updated_at = Column(Float, nullable=False, default=time.time)

class ControlAudit(Base):
    __tablename__ = 'control_audit'
    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    actor_id = Column(String(64), index=True, nullable=False)
    target_id = Column(String(64), index=True, nullable=False)
    action = Column(String(64), nullable=False)
    detail = Column(Text, nullable=False, default='{}')
    created_at = Column(Float, index=True, nullable=False, default=time.time)

class UsageEvent(Base):
    __tablename__ = 'control_usage'
    __table_args__ = (UniqueConstraint('user_id', 'request_id', 'meter', name='uq_control_usage_request'),)
    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    user_id = Column(String(64), index=True, nullable=False)
    request_id = Column(String(160), nullable=False)
    meter = Column(String(32), nullable=False)
    provider = Column(String(64), nullable=False, default='')
    amount = Column(Float, nullable=False, default=0)
    state = Column(String(24), nullable=False, default='reserved')
    basis = Column(String(24), nullable=False, default='app_count')
    estimated_cost = Column(Float, nullable=True)
    created_at = Column(Float, index=True, nullable=False, default=time.time)

class ProviderBudget(Base):
    __tablename__ = 'provider_budgets'
    provider = Column(String(64), primary_key=True)
    monthly_units = Column(Float, nullable=False, default=0)
    used_units = Column(Float, nullable=False, default=0)
    month = Column(String(7), nullable=False, default='')
    unit = Column(String(24), nullable=False, default='requests')
    enabled = Column(Integer, nullable=False, default=0)
    monthly_spend = Column(Float, nullable=False, default=0)
    reserved_spend = Column(Float, nullable=False, default=0)
    cost_per_request = Column(Float, nullable=False, default=0)


def owner_emails():
    # Same server-owned authority for analytics and all admin routes.
    raw = os.getenv('DEVELOPER_EMAILS', os.getenv('CLAVIS_ADMIN_EMAILS', 'vishalsharma190405@gmail.com'))
    return {s.strip().lower() for s in raw.split(',') if s.strip()}


def is_owner(user):
    return str(user.email or '').lower() in owner_emails()


def owner_claims(user, claims):
    return is_owner(user) and claims.get('sub') == user.id and (claims.get('app_metadata') or {}).get('provider') == 'google'


def require_owner(user: UserAccount = Depends(get_current_user), credentials: HTTPAuthorizationCredentials = Depends(bearer_scheme)):
    if not credentials or not owner_claims(user, _verify_supabase_token(credentials.credentials)):
        raise HTTPException(403, 'Developer access required')
    return user


def managed_access():
    return os.getenv('CLAVIS_MANAGED_ACCESS', 'true' if os.getenv('APP_ENV') == 'production' else 'false').lower() == 'true'


def account(db, user_id, create=True):
    row = db.query(AccountControl).filter_by(user_id=user_id).populate_existing().first()
    if not row and create:
        row = AccountControl(user_id=user_id)
        db.add(row)
        try:
            db.commit()
        except IntegrityError:
            db.rollback()
        row = db.query(AccountControl).filter_by(user_id=user_id).one()
    return row


def bump(db, user_id):
    account(db, user_id)
    db.query(AccountControl).filter_by(user_id=user_id).update({AccountControl.revision: AccountControl.revision + 1, AccountControl.updated_at: time.time()}, synchronize_session=False)


def audit(db, actor, target, action, detail=None):
    db.add(ControlAudit(actor_id=actor.id, target_id=target, action=action, detail=json.dumps(detail or {})))


def check_session(db, user, claims):
    if 'exp' in claims:
        try: expired = float(claims['exp']) <= time.time()
        except (TypeError, ValueError): expired = True
        if expired: raise HTTPException(401, 'Session expired. Sign in again.')
    row = account(db, user.id, False)
    if row and row.revoked_before and float(claims.get('iat') or 0) <= row.revoked_before:
        raise HTTPException(401, 'This session was revoked. Sign in again.')
    sid = str(claims.get('session_id') or '')[:128]
    if not sid:
        if managed_access():
            raise HTTPException(401, 'A fresh authenticated session is required')
        return
    item = db.query(ManagedSession).filter_by(user_id=user.id, session_id=sid).first()
    if item and item.revoked:
        raise HTTPException(401, 'This session was revoked. Sign in again.')
    if not item:
        db.add(ManagedSession(user_id=user.id, session_id=sid))
        try:
            db.commit()
        except IntegrityError:
            db.rollback()
    else:
        item.last_seen = time.time()
        db.commit()


def check_access(db, user, feature=None):
    # User-facing quota and tenant block always remain authoritative.
    from api.limits import TenantLimits
    limits = db.query(TenantLimits).filter_by(owner_user_id=user.id).populate_existing().first()
    row = account(db, user.id, create=False)
    if (limits and limits.blocked) or (row and row.status == 'blocked'):
        raise HTTPException(403, 'This account is paused. Contact support.')
    if row and not json.loads(row.features or '{}').get(feature, True):
        raise HTTPException(403, 'This feature is disabled for your account')
    if not feature or getattr(user, "_verified_owner", False):
        return
    if not managed_access() and (not row or row.status == 'pending'):
        # Local/family install: nobody can buy a subscription here, and the
        # 'pending' row that /api/control/me auto-creates on first sign-in
        # used to 402 every AI, leads and voice call ("keys not working").
        return
    if row and row.status in ('active', 'trial') and (not row.expires_at or row.expires_at > time.time()):
        return
    from api.billing import Subscription
    sub = db.query(Subscription).filter_by(owner_user_id=user.id).first()
    if sub and sub.status == 'active' and sub.period_end > time.time() and (not row or row.status != 'blocked'):
        return
    raise HTTPException(402, 'Activate a subscription or contact support for a trial.')


def feature_for_path(path, method='POST'):
    if path.startswith(('/api/ai/', '/api/chat', '/api/v1/ai/', '/api/v1/web/')): return 'ai'
    if path.startswith(('/api/lead', '/api/v1/leads', '/api/v1/lead-jobs', '/api/v1/candidate-jobs')): return 'leads'
    if path == '/api/credentials/gemini-live-token': return 'voice'
    if path.startswith(('/api/tts', '/api/speech', '/ws/')): return 'voice'
    if path.startswith(('/api/v1/elevenlabs', '/api/v1/sarvam', '/api/calls', '/api/v1/toughtongue')): return 'calls'
    if path.startswith('/api/v1/outreach-jobs'): return 'calls'
    if path.startswith('/api/v1/whatsapp') and method not in ('GET', 'DELETE'): return 'whatsapp'
    return None


def month_key():
    from api.limits import IST
    return datetime.now(IST).strftime('%Y-%m')


def record_usage(db, user, meter, amount, request_id=None, state='reserved', provider='', basis='app_count'):
    event = UsageEvent(user_id=user.id, meter=meter, amount=amount, request_id=request_id or str(uuid.uuid4()), state=state, provider=provider, basis=basis)
    db.add(event)
    return event


def reserve_monthly(db, user, meter, amount):
    # Lock the policy row so concurrent admissions cannot exceed the monthly cap.
    db.query(AccountControl).filter_by(user_id=user.id).update({AccountControl.revision: AccountControl.revision}, synchronize_session=False)
    row = db.query(AccountControl).filter_by(user_id=user.id).with_for_update().first()
    if not row: return
    cap = json.loads(row.monthly_limits or '{}').get(meter)
    if cap is None or not managed_access(): return  # testing phase: no monthly cap
    from sqlalchemy import func
    from api.limits import IST
    start = datetime.now(IST).replace(day=1, hour=0, minute=0, second=0, microsecond=0).timestamp()
    used = db.query(func.coalesce(func.sum(UsageEvent.amount), 0)).filter(UsageEvent.user_id == user.id, UsageEvent.meter == meter, UsageEvent.created_at >= start, UsageEvent.state != 'refunded').scalar()
    if used + amount > cap: raise HTTPException(429, 'Monthly allowance reached')


def assigned_secret(db, user, provider):
    from api.credentials import ProviderCredential, decrypt_secret
    assignment = db.query(ProviderAssignment).filter_by(user_id=user.id, provider=provider).populate_existing().first()
    if not assignment:
        return False, None
    if assignment.mode == 'disabled': return True, None
    if assignment.mode == 'shared':
        budget = db.query(ProviderBudget).filter_by(provider=provider).populate_existing().first()
        if not budget or not budget.enabled: return True, None
    owner = '__platform__' if assignment.mode == 'shared' else user.id
    record = db.query(ProviderCredential).filter_by(owner_user_id=owner, provider=provider).first()
    return True, decrypt_secret(record) if record and record.ciphertext else None


def reserve_provider(db, user, provider):
    assignment = db.query(ProviderAssignment).filter_by(user_id=user.id, provider=provider).populate_existing().first()
    if assignment and assignment.mode == 'disabled': raise HTTPException(403, 'Provider disabled for this account')
    if assignment and assignment.mode == 'shared':
        month = month_key()
        row = db.query(ProviderBudget).filter_by(provider=provider).with_for_update().first()
        if not row or not row.enabled: raise HTTPException(503, 'Shared provider budget is not enabled')
        db.query(ProviderBudget).filter(ProviderBudget.provider == provider, ProviderBudget.month != month).update({ProviderBudget.month: month, ProviderBudget.used_units: 0, ProviderBudget.reserved_spend: 0}, synchronize_session=False)
        criteria = [ProviderBudget.provider == provider, ProviderBudget.enabled == 1, ProviderBudget.used_units + 1 <= ProviderBudget.monthly_units]
        if row.monthly_spend > 0: criteria.append(ProviderBudget.reserved_spend + row.cost_per_request <= ProviderBudget.monthly_spend)
        changed = db.query(ProviderBudget).filter(*criteria).update({ProviderBudget.used_units: ProviderBudget.used_units + 1, ProviderBudget.reserved_spend: ProviderBudget.reserved_spend + row.cost_per_request}, synchronize_session=False)
        if not changed: raise HTTPException(429, 'Shared provider allowance reached')
        event = record_usage(db, user, 'provider_requests', 1, provider=provider, state='attempted')
        event.estimated_cost = row.cost_per_request if row.cost_per_request > 0 else None
        event.basis = 'owner_cost_reservation' if row.cost_per_request > 0 else 'app_count'
    # End admission reads without expiring the user snapshot used during streaming.
    expire = db.expire_on_commit
    db.expire_on_commit = False
    try:
        db.commit()
    finally:
        db.expire_on_commit = expire


def reported_usage(db, user, meter, amount, provider, request_id):
    """Update provider-reported totals once per external object, never double count reads."""
    row = db.query(UsageEvent).filter_by(user_id=user.id, request_id=request_id, meter=meter).first()
    if not row:
        row = record_usage(db, user, meter, amount, request_id=request_id, provider=provider, state='succeeded', basis='provider_reported')
    row.amount, row.state, row.basis = amount, 'succeeded', 'provider_reported'
    db.commit()
    return row
