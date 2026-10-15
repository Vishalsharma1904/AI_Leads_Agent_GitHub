"""Durable reviewed outreach. Existing provider senders own quotas and evidence."""
import asyncio
import hashlib
import html
import json
import logging
import re
import time
import uuid
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import Column, Float, String, Text, UniqueConstraint
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session
from api.auth_sync import AUTO_CREATE_SCHEMA, Base, SessionLocal, UserAccount, engine, get_current_user, get_db
from api.crm import CRMRecord

router = APIRouter(prefix='/api/v1/outreach-jobs', tags=['mobile outreach'])
log = logging.getLogger(__name__)

class OutreachJob(Base):
    __tablename__ = 'outreach_jobs'
    __table_args__ = (UniqueConstraint('owner_user_id', 'request_id', name='uq_outreach_request'),)
    id = Column(String(64), primary_key=True)
    owner_user_id = Column(String(64), nullable=False, index=True)
    request_id = Column(String(64), nullable=False)
    digest = Column(String(64), nullable=False)
    channel = Column(String(16), nullable=False)
    status = Column(String(24), nullable=False, default='queued', index=True)
    content = Column(Text, nullable=False)
    created_at = Column(Float, default=time.time)
    updated_at = Column(Float, default=time.time)

class OutreachItem(Base):
    __tablename__ = 'outreach_items'
    id = Column(String(64), primary_key=True)
    job_id = Column(String(64), nullable=False, index=True)
    record_id = Column(String(64), nullable=False)
    recipient = Column(String(320), nullable=False)
    status = Column(String(24), nullable=False, default='pending', index=True)
    result = Column(Text, default='{}')
    updated_at = Column(Float, default=time.time)

if AUTO_CREATE_SCHEMA:
    Base.metadata.create_all(engine)

class BatchRequest(BaseModel):
    model_config = ConfigDict(extra='forbid')
    channel: Literal['email', 'whatsapp']
    request_id: str = Field(min_length=16, max_length=64, pattern=r'^[A-Za-z0-9_-]+$')
    record_ids: list[str] = Field(min_length=1, max_length=200)
    confirmed: bool = False
    subject: str = Field(default='', max_length=240)
    message: str = Field(default='', max_length=20000)
    template: str = Field(default='', max_length=120)
    language: str = Field(default='en', max_length=12)
    body_params: list[str] = Field(default_factory=list, max_length=30)
    opt_in: bool = False

def owned(db, user, job_id):
    row = db.query(OutreachJob).filter_by(id=job_id, owner_user_id=user.id).first()
    if not row: raise HTTPException(404, 'Batch not found')
    return row

def public(db, row):
    items = db.query(OutreachItem).filter_by(job_id=row.id).order_by(OutreachItem.id).all()
    if row.channel == 'whatsapp':
        sync_whatsapp_history(db,row,items)
    return dict(id=row.id, request_id=row.request_id, channel=row.channel, status=row.status, created_at=row.created_at,
        updated_at=row.updated_at, items=[dict(id=x.id, record_id=x.record_id, recipient=x.recipient,
            status=x.status, result=json.loads(x.result or '{}')) for x in items])

def sync_whatsapp_history(db,job,items):
    from api.whatsapp import WhatsAppMessage, public_message
    from api.crm import CRMActivity, _activity
    indexed = {item.id:item for item in items}
    messages = db.query(WhatsAppMessage).filter(WhatsAppMessage.owner_user_id==job.owner_user_id,
        WhatsAppMessage.idempotency_key.in_(indexed)).all() if indexed else []
    for message in messages:
        item = indexed[message.idempotency_key]
        item.status,item.result = message.status,json.dumps(public_message(message))
        record = db.query(CRMRecord).filter_by(id=item.record_id,owner_user_id=job.owner_user_id).first()
        key='wa-status:'+hashlib.sha256((message.id+'|'+message.status).encode()).hexdigest()
        if record and not db.query(CRMActivity).filter_by(owner_user_id=job.owner_user_id,idempotency_key=key).first():
            _activity(db,job.owner_user_id,record.id,'whatsapp_status',message.detail or ('Meta status: '+message.status),
                channel='whatsapp',outcome=message.status,evidence='provider' if message.provider_message_id else 'server',recipient=item.recipient,
                provider_id=message.provider_message_id,idempotency_key=key)
    if job.status == 'completed' and any(item.status == 'failed' for item in items):
        job.status,job.updated_at='attention',time.time()
    db.commit()

@router.post('', status_code=202)
def create(req: BatchRequest, db: Session = Depends(get_db), user: UserAccount = Depends(get_current_user)):
    if not req.confirmed: raise HTTPException(422, 'Review and confirm this batch first')
    if len(set(req.record_ids)) != len(req.record_ids): raise HTTPException(422, 'Remove duplicate leads')
    if req.channel == 'email' and (not req.subject.strip() or not req.message.strip() or re.search(r'[\r\n]', req.subject)):
        raise HTTPException(422, 'A one-line subject and message are required')
    if req.channel == 'whatsapp' and (not req.opt_in or not re.fullmatch(r'[a-z0-9_]{1,120}', req.template) or
            not re.fullmatch(r'[A-Za-z_]{2,12}', req.language) or any(not x.strip() or len(x)>1024 for x in req.body_params)):
        raise HTTPException(422, 'Confirmed opt-in, valid template and language are required')
    digest = hashlib.sha256(req.model_dump_json(exclude={'request_id'}).encode()).hexdigest()
    prior = db.query(OutreachJob).filter_by(owner_user_id=user.id, request_id=req.request_id).first()
    if prior:
        if prior.digest != digest: raise HTTPException(409, 'Request ID belongs to a different batch')
        return {'job': public(db, prior), 'idempotent': True}
    targets, destinations = [], set()
    for record_id in req.record_ids:
        row = db.query(CRMRecord).filter_by(id=record_id, owner_user_id=user.id).first()
        if not row: raise HTTPException(404, 'Selected lead not found in this account')
        profile = json.loads(row.profile or '{}')
        if profile.get('emailOptOut' if req.channel == 'email' else 'phoneOptOut'):
            raise HTTPException(409, 'A selected recipient opted out')
        destination = str(profile.get('email') if req.channel == 'email' else (profile.get('phone') or profile.get('mobile')) or '').strip()
        pattern = r'[^@\s<>;,]+@[^@\s<>;,]+\.[^@\s<>;,]+' if req.channel == 'email' else r'\+[1-9][0-9]{7,14}'
        if not re.fullmatch(pattern, destination): raise HTTPException(422, 'Each selected lead needs a valid email or E.164 phone number')
        if destination.casefold() in destinations: raise HTTPException(422, 'Remove duplicate destinations')
        destinations.add(destination.casefold()); targets.append((row.id, destination))
    job = OutreachJob(id=uuid.uuid4().hex, owner_user_id=user.id, request_id=req.request_id,
        digest=digest, channel=req.channel, status='queued', content=req.model_dump_json(exclude={'record_ids','request_id','confirmed'}))
    db.add(job)
    for index, (record_id, destination) in enumerate(targets):
        db.add(OutreachItem(id=f'{job.id}_{index:03}', job_id=job.id, record_id=record_id, recipient=destination))
    try: db.commit()
    except IntegrityError:
        db.rollback()
        prior = db.query(OutreachJob).filter_by(owner_user_id=user.id, request_id=req.request_id).first()
        if not prior or prior.digest != digest: raise HTTPException(409, 'Batch already being submitted') from None
        job = prior
    return {'job': public(db, job)}

@router.get('')
def listing(db: Session = Depends(get_db), user: UserAccount = Depends(get_current_user)):
    rows = db.query(OutreachJob).filter_by(owner_user_id=user.id).order_by(OutreachJob.created_at.desc()).limit(50).all()
    return {'jobs': [public(db, x) for x in rows]}

@router.get('/{job_id}')
def detail(job_id: str, db: Session = Depends(get_db), user: UserAccount = Depends(get_current_user)):
    return {'job': public(db, owned(db,user,job_id))}

@router.post('/{job_id}/cancel')
def cancel(job_id: str, db: Session = Depends(get_db), user: UserAccount = Depends(get_current_user)):
    row = owned(db,user,job_id)
    if row.status in {'queued','attention'}:
        row.status, row.updated_at = 'cancelled', time.time()
        db.query(OutreachItem).filter_by(job_id=row.id,status='pending').update({'status':'cancelled'})
        db.commit()
    return {'job': public(db,row)}  # An already in-flight provider send cannot be recalled.

async def deliver(db, user, row, data):
    target = db.query(CRMRecord).filter_by(id=row.record_id, owner_user_id=user.id).first()
    if not target: raise HTTPException(404, 'Lead no longer exists')
    profile = json.loads(target.profile or '{}')
    channel = data['channel']
    if profile.get('emailOptOut' if channel == 'email' else 'phoneOptOut'):
        raise HTTPException(409, 'Recipient opted out')
    if channel == 'email':
        from api.email_sender import SendEmailRequest, connected_email_send
        return await connected_email_send(SendEmailRequest(to=row.recipient, subject=data['subject'],
            htmlBody='<p>'+html.escape(data['message']).replace('\n','<br>')+'</p>',
            crmRecordId=row.record_id, idempotencyKey=row.id), db, user)
    from api.whatsapp import SendRequest, send
    return await send(SendRequest(to=row.recipient, template=data['template'], language=data['language'],
        body_params=data['body_params'], opt_in=data['opt_in'], idempotency_key=row.id), db, user)

async def tick(session_factory=SessionLocal):
    with session_factory() as db:
        # A process crash cannot prove delivery. Never automatically resend a stale reservation.
        stale = db.query(OutreachItem).filter(OutreachItem.status=='sending', OutreachItem.updated_at < time.time()-180).all()
        for item in stale:
            item.status, item.result = 'unknown', json.dumps({'detail':'Interrupted send. Check provider history before any new batch.'})
            db.query(OutreachJob).filter_by(id=item.job_id,status='queued').update({'status':'attention'})
        db.commit()
        job = db.query(OutreachJob).filter_by(status='queued').order_by(OutreachJob.created_at).first()
        if not job: return
        user = db.query(UserAccount).filter_by(id=job.owner_user_id).first()
        from services.developer_control import check_access
        try:
            if not user: raise HTTPException(404, 'Account unavailable')
            check_access(db, user, 'whatsapp' if job.channel == 'whatsapp' else 'calls')
        except HTTPException:
            job.status, job.updated_at = 'paused', time.time()
            db.commit()
            return
        if db.query(OutreachItem).filter_by(job_id=job.id,status='sending').first(): return
        item = db.query(OutreachItem).filter_by(job_id=job.id,status='pending').order_by(OutreachItem.id).first()
        if not item:
            job.status,job.updated_at='completed',time.time(); db.commit(); return
        claimed = db.query(OutreachItem).filter_by(id=item.id,status='pending').update({'status':'sending','updated_at':time.time()})
        db.commit()
        if not claimed: return
        db.refresh(job)
        if job.status != 'queued':
            item.status='cancelled'; db.commit(); return
        user = db.query(UserAccount).filter_by(id=job.owner_user_id).first()
        try:
            if not user: raise HTTPException(404,'Account unavailable')
            from services.developer_control import check_access
            check_access(db, user, 'whatsapp' if job.channel == 'whatsapp' else 'calls')
            result = await deliver(db,user,item,json.loads(job.content))
            status = result.get('status','unknown')
            item.status = 'accepted' if status in {'success','accepted','sent','delivered','read'} else 'unknown' if status in {'reserved','unknown'} else 'failed'
            item.result=json.dumps(result)
        except asyncio.CancelledError:
            raise  # Durable sending reservation remains; no automatic resend on restart.
        except Exception:
            db.rollback(); item=db.query(OutreachItem).filter_by(id=item.id).one()
            item.status,item.result='unknown',json.dumps({'detail':'Send needs review. Check the provider and connection before creating another batch.'})
            log.warning('Outreach send needs review: %s',item.id)
        item.updated_at=time.time(); db.commit()
        if job.channel == 'whatsapp':
            sync_whatsapp_history(db,job,db.query(OutreachItem).filter_by(job_id=job.id).all())
        db.refresh(job)
        if job.status=='queued':
            if item.status in {'unknown','failed'}: job.status='attention'
            elif not db.query(OutreachItem).filter(OutreachItem.job_id==job.id,OutreachItem.status.in_(['pending','sending'])).first(): job.status='completed'
            job.updated_at=time.time(); db.commit()

async def worker():
    while True:
        try: await tick()
        except asyncio.CancelledError: raise
        except Exception: log.exception('Outreach worker pass failed')
        await asyncio.sleep(2)
