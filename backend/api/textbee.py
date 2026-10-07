"""Self-hosted Android gateway. Reserve before dispatch; uncertain sends never auto-repeat."""
import json
import os
import re
import time
import uuid
from datetime import datetime
from zoneinfo import ZoneInfo

import httpx
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import Column, Integer, String, Text, Float, UniqueConstraint
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session
from api.auth_sync import Base, AUTO_CREATE_SCHEMA, engine, get_db, get_current_user, UserAccount, SessionLocal
from api.credentials import ProviderCredential, encrypt_secret, decrypt_secret
from api.crm import CRMRecord, CRMActivity, _load, _owned, _cas, _activity

router = APIRouter(prefix='/api/textbee', tags=['textbee'])


class SMSCampaign(Base):
    __tablename__ = 'sms_campaigns'
    id = Column(String(36), primary_key=True)
    owner_user_id = Column(String(64), nullable=False, index=True)
    name = Column(String(200), nullable=False)
    message = Column(Text, nullable=False)
    recipients = Column(Text, nullable=False)
    created_at = Column(Float, nullable=False)


class SMSDispatch(Base):
    __tablename__ = 'sms_dispatches'
    __table_args__ = (UniqueConstraint('owner_user_id', 'phone', name='uq_sms_owner_phone'),)
    id = Column(String(36), primary_key=True)
    owner_user_id = Column(String(64), nullable=False, index=True)
    campaign_id = Column(String(36), nullable=False, index=True)
    record_id = Column(String(36), nullable=False)
    phone = Column(String(24), nullable=False)
    day = Column(String(10), nullable=False, index=True)
    status = Column(String(24), nullable=False)
    provider_id = Column(String(128), nullable=True)
    device_id = Column(String(128), nullable=False)
    error = Column(Text, nullable=True)
    created_at = Column(Float, nullable=False)


class SMSBudget(Base):
    __tablename__ = 'sms_daily_budget'
    __table_args__ = (UniqueConstraint('owner_user_id', 'day', name='uq_sms_owner_day'),)
    id = Column(String(36), primary_key=True)
    owner_user_id = Column(String(64), nullable=False)
    day = Column(String(10), nullable=False)
    used = Column(Integer, nullable=False, default=0)


if AUTO_CREATE_SCHEMA:
    Base.metadata.create_all(engine, tables=[SMSCampaign.__table__, SMSDispatch.__table__, SMSBudget.__table__])


def phone_number(raw):
    value = re.sub(r'\D', '', str(raw or ''))
    if len(value) == 10 and value[0] in '6789': value = '91' + value
    if not 11 <= len(value) <= 15 or value.startswith('0'): return None
    return '+' + value


def day_key():
    return datetime.now(ZoneInfo('Asia/Kolkata')).date().isoformat()


def daily_budget(db, owner):
    day = day_key()
    budget = db.query(SMSBudget).filter_by(owner_user_id=owner, day=day).first()
    if budget: return budget
    # Offline Android queues must not stack yesterday's 50 on today's 50.
    carryover = db.query(SMSDispatch).filter(SMSDispatch.owner_user_id == owner, SMSDispatch.day != day,
                                             SMSDispatch.status.in_(['queued', 'unknown'])).count()
    budget = SMSBudget(id=str(uuid.uuid4()), owner_user_id=owner, day=day, used=carryover)
    db.add(budget)
    try: db.commit()
    except IntegrityError:
        db.rollback()
        budget = db.query(SMSBudget).filter_by(owner_user_id=owner, day=day).one()
    return budget


def config(db, owner):
    row = db.query(ProviderCredential).filter_by(owner_user_id=owner, provider='textbee').first()
    if not row: raise HTTPException(503, 'Connect your self-hosted TextBee device first.')
    return json.loads(decrypt_secret(row))


def base_url():
    value = os.getenv('TEXTBEE_BASE_URL', 'http://127.0.0.1:3001/api/v1').rstrip('/')
    if not value.startswith(('http://', 'https://')): raise HTTPException(503, 'Invalid server TextBee URL.')
    return value


def gateway(cfg, method, path, body=None):
    try:
        response = httpx.request(method, base_url() + path, headers={'x-api-key': cfg['apiKey']}, json=body, timeout=20, follow_redirects=False)
        response.raise_for_status()
        return response.json().get('data', {})
    except (httpx.HTTPError, ValueError) as error:
        raise HTTPException(502, 'TextBee gateway did not confirm the request. Check the device and gateway history.') from error


class SettingsWrite(BaseModel):
    apiKey: str = Field(min_length=1, max_length=512)
    deviceId: str = Field(pattern=r'^[a-zA-Z0-9_-]{1,128}$')
    dailyLimit: int = Field(default=20, ge=20, le=50)


@router.put('/settings')
def save_settings(body: SettingsWrite, db: Session = Depends(get_db), user: UserAccount = Depends(get_current_user)):
    ciphertext, nonce = encrypt_secret(body.model_dump_json())
    row = db.query(ProviderCredential).filter_by(owner_user_id=user.id, provider='textbee').first()
    if not row:
        row = ProviderCredential(owner_user_id=user.id, provider='textbee'); db.add(row)
    row.ciphertext, row.nonce, row.updated_at = ciphertext, nonce, time.time()
    db.commit()
    return {'configured': True, 'deviceId': body.deviceId, 'dailyLimit': body.dailyLimit}


@router.get('/status')
def status(db: Session = Depends(get_db), user: UserAccount = Depends(get_current_user)):
    used = daily_budget(db, user.id)
    try: cfg = config(db, user.id)
    except HTTPException: return {'configured': False, 'usedToday': used.used if used else 0, 'dailyLimit': 20}
    result = {'configured': True, 'deviceId': cfg['deviceId'], 'dailyLimit': cfg['dailyLimit'], 'usedToday': used.used if used else 0, 'gatewayUrl': base_url()}
    try:
        device = gateway(cfg, 'GET', '/gateway/devices/' + cfg['deviceId'])
        result['device'] = {key: device.get(key) for key in ('name', 'enabled', 'lastSeen', 'lastHeartbeatAt')}
        result['reachable'] = True
    except HTTPException as error:
        result.update(reachable=False, error=error.detail)
    return result


class CampaignWrite(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    message: str = Field(min_length=1, max_length=160)
    recordIds: list[str] = Field(default_factory=list, max_length=10000)


def eligible(db, owner, ids=None):
    query = db.query(CRMRecord).filter_by(owner_user_id=owner)
    if ids: query = query.filter(CRMRecord.id.in_(ids))
    contacted = {row.phone for row in db.query(SMSDispatch).filter_by(owner_user_id=owner)}
    recipients, seen = [], set()
    for record in query.order_by(CRMRecord.id).yield_per(250):
        profile = _load(record.profile, {})
        number = phone_number(profile.get('mobile')) or phone_number(profile.get('phone'))
        if not number or profile.get('phoneOptOut') or number in contacted or number in seen: continue
        seen.add(number); recipients.append({'recordId': record.id, 'phone': number, 'company': profile.get('company', '')})
    return recipients


@router.get('/audience')
def audience(db: Session = Depends(get_db), user: UserAccount = Depends(get_current_user)):
    rows = eligible(db, user.id)
    return {'total': len(rows), 'preview': rows[:50]}


@router.post('/campaigns', status_code=201)
def create_campaign(body: CampaignWrite, db: Session = Depends(get_db), user: UserAccount = Depends(get_current_user)):
    # One physical segment, including UCS-2 Hindi: daily limit is messages, not API requests.
    gsm = set('@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !"#¤%&\'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà')
    units = sum(2 if char in '^{}\\[~]|€' else 1 for char in body.message)
    if any(char not in gsm and char not in '^{}\\[~]|€' for char in body.message):
        units = len(body.message.encode('utf-16-le')) // 2
        if units > 70: raise HTTPException(422, 'Hindi/Unicode messages must fit 70 UTF-16 units for one SMS. Shorten the message.')
    elif units > 160: raise HTTPException(422, 'This message exceeds one SMS segment.')
    cfg = config(db, user.id)
    recipients = eligible(db, user.id, body.recordIds)
    if not recipients: raise HTTPException(422, 'No eligible new lead phone numbers. Opt-outs and previously attempted numbers are excluded.')
    campaign = SMSCampaign(id=str(uuid.uuid4()), owner_user_id=user.id, name=body.name, message=body.message, recipients=json.dumps(recipients), created_at=time.time())
    db.add(campaign); db.commit()
    return {'id': campaign.id, 'name': campaign.name, 'total': len(recipients), 'dailyLimit': cfg['dailyLimit']}


def serialize(campaign, rows):
    counts = {}
    for row in rows: counts[row.status] = counts.get(row.status, 0) + 1
    return {'id': campaign.id, 'name': campaign.name, 'message': campaign.message, 'total': len(json.loads(campaign.recipients)), 'counts': counts,
            'remaining': max(0, len(json.loads(campaign.recipients)) - len(rows)),
            'dispatches': [{'id': r.id, 'phone': r.phone, 'recordId': r.record_id, 'status': r.status, 'error': r.error} for r in rows]}


@router.get('/campaigns')
def campaigns(db: Session = Depends(get_db), user: UserAccount = Depends(get_current_user)):
    return {'campaigns': [serialize(c, db.query(SMSDispatch).filter_by(owner_user_id=user.id, campaign_id=c.id).all()) for c in db.query(SMSCampaign).filter_by(owner_user_id=user.id).order_by(SMSCampaign.created_at.desc())]}


def sms_activity(db, row, outcome):
    key = 'textbee:' + row.id
    event = db.query(CRMActivity).filter_by(owner_user_id=row.owner_user_id, idempotency_key=key).first()
    if not event: event = _activity(db, row.owner_user_id, row.record_id, 'outreach', 'TextBee Android gateway', row.created_at, channel='sms', recipient=row.phone, outcome=outcome, evidence='provider', provider_id=row.provider_id, idempotency_key=key)
    else: event.outcome, event.provider_id = outcome, row.provider_id
    if outcome in ('sent', 'delivered'):
        record = _owned(db, CRMRecord, row.record_id, row.owner_user_id)
        values = {'last_contact_at': max(record.last_contact_at or 0, row.created_at), 'updated_at': time.time()}
        if record.stage == 'new': values['stage'] = 'attempted'
        _cas(db, record, record.version, values)


@router.post('/campaigns/{campaign_id}/run')
def run_campaign(campaign_id: str, db: Session = Depends(get_db), user: UserAccount = Depends(get_current_user)):
    campaign = _owned(db, SMSCampaign, campaign_id, user.id); cfg = config(db, user.id)
    # Dispatch one per click. Persisted queue can be safely resumed after a restart.
    current = eligible(db, user.id, [r['recordId'] for r in json.loads(campaign.recipients)])
    original = {r['recordId']: r['phone'] for r in json.loads(campaign.recipients)}
    candidate = next((row for row in current if original.get(row['recordId']) == row['phone']), None)
    if not candidate: return {'done': True}
    day = day_key(); budget = daily_budget(db, user.id)
    if db.query(SMSBudget).filter_by(id=budget.id).filter(SMSBudget.used < cfg['dailyLimit']).update({SMSBudget.used: SMSBudget.used + 1}, synchronize_session=False) != 1:
        db.rollback(); raise HTTPException(429, 'Daily SMS limit reached. Resume tomorrow.')
    row = SMSDispatch(id=str(uuid.uuid4()), owner_user_id=user.id, campaign_id=campaign.id, record_id=candidate['recordId'], phone=candidate['phone'], day=day, status='unknown', device_id=cfg['deviceId'], created_at=time.time())
    db.add(row)
    try: db.commit()
    except IntegrityError: db.rollback(); raise HTTPException(409, 'This number has already been reserved; refresh.')
    try:
        reply = gateway(cfg, 'POST', '/gateway/devices/' + row.device_id + '/send-sms', {'recipients': [row.phone], 'message': campaign.message})
        row.provider_id = str(reply.get('smsBatchId') or '') or None
        row.status = 'queued' if row.provider_id else 'unknown'
        row.error = None if row.provider_id else 'Gateway response has no tracking ID. Check TextBee history; do not resend.'
    except HTTPException as error: row.error = error.detail
    # Preserve tracking even if an unrelated CRM edit conflicts after dispatch.
    db.commit()
    try:
        sms_activity(db, row, row.status); db.commit()
    except Exception:
        db.rollback()
        row.error = (row.error or '') + ' CRM timeline sync needs a status refresh. Do not resend.'
        db.commit()
    return {'done': False, 'status': row.status, 'id': row.id, 'phone': row.phone, 'error': row.error}


@router.post('/refresh')
def refresh(db: Session = Depends(get_db), user: UserAccount = Depends(get_current_user)):
    cfg = config(db, user.id)
    daily_budget(db, user.id)
    for row in db.query(SMSDispatch).filter(SMSDispatch.owner_user_id == user.id, SMSDispatch.provider_id.isnot(None), SMSDispatch.status.in_(['queued', 'unknown', 'sent'])).limit(50):
        report = gateway(cfg, 'GET', f'/gateway/devices/{row.device_id}/sms-batch/{row.provider_id}')
        previous = row.status
        if report.get('deliveredCount', 0): row.status = 'delivered'
        elif report.get('sentCount', 0): row.status = 'sent'
        elif report.get('failureCount', 0): row.status = 'failed'
        elif report.get('unknownCount', 0): row.status = 'unknown'
        missing_event = not db.query(CRMActivity.id).filter_by(owner_user_id=user.id, idempotency_key='textbee:' + row.id).first()
        if previous != row.status or missing_event or 'CRM timeline sync' in (row.error or ''):
            sms_activity(db, row, row.status)
            if row.error and 'CRM timeline sync' in row.error: row.error = None
    db.commit()
    return {'refreshed': True}
