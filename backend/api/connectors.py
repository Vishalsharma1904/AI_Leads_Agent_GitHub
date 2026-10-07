"""Tenant-scoped OAuth connections and scheduled outbound actions."""
import asyncio
import base64
import hashlib
import hmac
import json
import os
import re
import secrets
import time
import uuid
from datetime import datetime, timezone
from email.message import EmailMessage
from urllib.parse import urlencode

import httpx
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import HTMLResponse
from pydantic import BaseModel, Field
from sqlalchemy import Column, Float, Integer, String, Text, UniqueConstraint
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from api.auth_sync import AUTO_CREATE_SCHEMA, Base, SessionLocal, UserAccount, get_current_user, get_db
from api.credentials import ProviderCredential, decrypt_secret, encrypt_secret, _master_key

router = APIRouter(prefix="/api/v1/connectors", tags=["connectors"])

GOOGLE_SCOPES = [
    "openid", "email",
    "https://www.googleapis.com/auth/spreadsheets",
    "https://www.googleapis.com/auth/gmail.send",
    "https://www.googleapis.com/auth/calendar.events",
    "https://www.googleapis.com/auth/drive.file",
]
GMAIL_SCOPES = [
    "openid", "email",
    "https://www.googleapis.com/auth/gmail.send",
    "https://www.googleapis.com/auth/gmail.readonly",
]
AUTOMATION_SCOPES = ["openid", "email", "https://www.googleapis.com/auth/calendar.events",
                     "https://www.googleapis.com/auth/gmail.send", "https://www.googleapis.com/auth/gmail.readonly"]
OAUTH_PROVIDERS = {"google_workspace", "slack", "github", "meta"}
ACTION_CONNECTION = {"telegram": "telegram", "slack": "slack", "gmail": "google_workspace",
                     "github": "github", "facebook": "meta", "instagram": "meta"}


class ConnectorJob(Base):
    __tablename__ = "connector_jobs"
    __table_args__ = (UniqueConstraint("owner_user_id", "idempotency_key", name="uq_connector_job_idempotency"),)

    id = Column(String(36), primary_key=True)
    owner_user_id = Column(String(64), index=True, nullable=False)
    idempotency_key = Column(String(64), nullable=False)
    provider = Column(String(32), nullable=False)
    target = Column(String(256), nullable=False)
    subject = Column(String(200), nullable=False, default="")
    message = Column(Text, nullable=False)
    media_url = Column(String(2048), nullable=False, default="")
    run_at = Column(Float, index=True, nullable=False)
    status = Column(String(16), index=True, nullable=False, default="queued")
    result_ref = Column(String(512), nullable=True)
    error = Column(String(256), nullable=True)
    created_at = Column(Float, nullable=False, default=time.time)
    updated_at = Column(Float, nullable=False, default=time.time)


if AUTO_CREATE_SCHEMA:
    Base.metadata.create_all(bind=__import__("api.auth_sync", fromlist=["engine"]).engine)


class TelegramSetup(BaseModel):
    token: str = Field(min_length=20, max_length=256)
    chat_id: str = Field(min_length=1, max_length=128)


class PublishRequest(BaseModel):
    provider: str
    target: str = Field(default="", max_length=256)
    subject: str = Field(default="", max_length=200)
    message: str = Field(min_length=1, max_length=4096)
    media_url: str = Field(default="", max_length=2048)
    run_at: datetime | None = None
    idempotency_key: str = Field(min_length=8, max_length=64)


def _credential(db: Session, user_id: str, provider: str) -> ProviderCredential | None:
    return db.query(ProviderCredential).filter_by(owner_user_id=user_id, provider=provider).first()


def _save_credential(db: Session, user_id: str, provider: str, payload: dict) -> None:
    ciphertext, nonce = encrypt_secret(json.dumps(payload))
    record = _credential(db, user_id, provider)
    if record:
        record.ciphertext, record.nonce, record.updated_at = ciphertext, nonce, time.time()
    else:
        db.add(ProviderCredential(owner_user_id=user_id, provider=provider,
                                  ciphertext=ciphertext, nonce=nonce, updated_at=time.time()))
    db.commit()


def _oauth_keys(provider: str) -> tuple[str, str]:
    prefix = {"google_workspace": "GOOGLE", "slack": "SLACK", "github": "GITHUB", "meta": "META"}.get(provider)
    if not prefix:
        raise HTTPException(status_code=404, detail="Unsupported connector")
    client_id = os.getenv("META_APP_ID" if provider == "meta" else f"{prefix}_CLIENT_ID", "").strip()
    client_secret = os.getenv("META_APP_SECRET" if provider == "meta" else f"{prefix}_CLIENT_SECRET", "").strip()
    if not client_id or not client_secret:
        raise HTTPException(status_code=503, detail=f"{provider} developer app is not configured on the backend")
    return client_id, client_secret


def _meta_graph() -> str:
    version = os.getenv("META_GRAPH_VERSION", "v26.0").strip()
    if not re.fullmatch(r"v\d+\.\d+", version):
        raise HTTPException(status_code=503, detail="META_GRAPH_VERSION is invalid")
    return f"https://graph.facebook.com/{version}"


def _redirect_uri(provider: str) -> str:
    base = os.getenv("CONNECTOR_PUBLIC_BASE_URL", "").strip().rstrip("/")
    if not base:
        if os.getenv("APP_ENV", "development").lower() == "production":
            raise HTTPException(status_code=503, detail="CONNECTOR_PUBLIC_BASE_URL is required")
        base = "http://localhost:8000"
    if not (base.startswith("https://") or base.startswith("http://localhost:") or base.startswith("http://127.0.0.1:")):
        raise HTTPException(status_code=503, detail="Connector callback must use HTTPS")
    return f"{base}/api/v1/connectors/oauth/{provider}/callback"


def _encode_state(user_id: str, provider: str, purpose: str = "workspace") -> str:
    payload = json.dumps({"sub": user_id, "provider": provider, "exp": int(time.time()) + 600,
                          "nonce": secrets.token_urlsafe(24), "purpose": purpose}, separators=(",", ":")).encode()
    body = base64.urlsafe_b64encode(payload).decode().rstrip("=")
    signature = hmac.new(_master_key(), body.encode(), hashlib.sha256).hexdigest()
    return f"{body}.{signature}"


def _decode_state_payload(state: str, provider: str) -> dict:
    try:
        body, signature = state.split(".", 1)
        expected = hmac.new(_master_key(), body.encode(), hashlib.sha256).hexdigest()
        if not hmac.compare_digest(signature, expected):
            raise ValueError("bad signature")
        data = json.loads(base64.urlsafe_b64decode(body + "=" * (-len(body) % 4)))
        if data["provider"] != provider or int(data["exp"]) < time.time():
            raise ValueError("expired or wrong provider")
        if data.get("purpose", "workspace") not in {"workspace", "gmail", "automation"}:
            raise ValueError("invalid purpose")
        return data
    except (KeyError, TypeError, ValueError, UnicodeDecodeError):
        raise HTTPException(status_code=400, detail="Authorization session expired; try connecting again") from None


def _decode_state(state: str, provider: str) -> str:
    return str(_decode_state_payload(state, provider)["sub"])


def _oauth_url(provider: str, client_id: str, redirect_uri: str, state: str,
               purpose: str = "workspace") -> str:
    if provider == "google_workspace":
        params = {"client_id": client_id, "redirect_uri": redirect_uri, "response_type": "code",
                  "scope": " ".join(AUTOMATION_SCOPES if purpose == "automation" else GMAIL_SCOPES if purpose == "gmail" else GOOGLE_SCOPES),
                  "access_type": "offline", "prompt": "select_account consent",
                  "include_granted_scopes": "true", "state": state}
        return "https://accounts.google.com/o/oauth2/v2/auth?" + urlencode(params)
    if provider == "slack":
        return "https://slack.com/oauth/v2/authorize?" + urlencode({
            "client_id": client_id, "scope": "chat:write", "redirect_uri": redirect_uri, "state": state})
    if provider == "meta":
        version = _meta_graph().rsplit("/", 1)[-1]
        return f"https://www.facebook.com/{version}/dialog/oauth?" + urlencode({
            "client_id": client_id, "redirect_uri": redirect_uri, "response_type": "code", "state": state,
            "scope": "pages_show_list,pages_read_engagement,pages_manage_posts,instagram_basic,instagram_content_publish"})
    return "https://github.com/login/oauth/authorize?" + urlencode({
        "client_id": client_id, "scope": "public_repo", "redirect_uri": redirect_uri, "state": state})


def _oauth_result_page(ok: bool) -> HTMLResponse:
    title = "Connected" if ok else "Connection failed"
    detail = "Return to Rudra24 AI. The Connectors page will update automatically." if ok else "Return to Rudra24 AI and try again."
    return HTMLResponse(f"""<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Rudra24 AI - {title}</title><body style="font:16px system-ui;background:#f8f9f5;color:#243322;display:grid;place-items:center;min-height:100vh;margin:0">
<main style="max-width:420px;padding:32px"><h1>{title}</h1><p>{detail}</p></main></body></html>""")


@router.get("/status")
def connector_status(db: Session = Depends(get_db), user: UserAccount = Depends(get_current_user)):
    records = db.query(ProviderCredential).filter(
        ProviderCredential.owner_user_id == user.id,
        ProviderCredential.provider.in_({"google_workspace", "google_sheets", "slack", "github", "telegram", "meta"}),
    ).all()
    connections = {}
    for record in records:
        try:
            stored = json.loads(decrypt_secret(record))
        except (ValueError, KeyError):
            stored = {}
        item = {"connected": bool(stored) and not (stored.get("expires_at") and stored["expires_at"] < time.time()),
                "account": stored.get("account", ""), "scopes": stored.get("scope", ""),
                "updated_at": record.updated_at}
        if record.provider == "meta":
            item["pages"] = [{"id": page["id"], "name": page.get("name", ""),
                              "instagram_id": page.get("instagram_id", ""),
                              "instagram_username": page.get("instagram_username", "")}
                             for page in stored.get("pages", [])]
        connections[record.provider] = item
    configured = {provider: bool(os.getenv(f"{prefix}_CLIENT_ID") and os.getenv(f"{prefix}_CLIENT_SECRET"))
                  for provider, prefix in (("google_workspace", "GOOGLE"), ("slack", "SLACK"), ("github", "GITHUB"))}
    configured["meta"] = bool(os.getenv("META_APP_ID") and os.getenv("META_APP_SECRET"))
    configured["telegram"] = True
    return {"connections": connections, "configured": configured}


@router.post("/oauth/{provider}/start")
def start_oauth(provider: str, purpose: str = "workspace",
                user: UserAccount = Depends(get_current_user)):
    if purpose not in {"workspace", "gmail", "automation"} or (purpose != "workspace" and provider != "google_workspace"):
        raise HTTPException(status_code=422, detail="Unsupported connection purpose")
    client_id, _ = _oauth_keys(provider)
    return {"authorization_url": _oauth_url(provider, client_id, _redirect_uri(provider),
                                             _encode_state(user.id, provider, purpose), purpose)}


@router.get("/oauth/{provider}/callback", response_class=HTMLResponse)
async def oauth_callback(provider: str, code: str = "", state: str = "", error: str = "",
                         db: Session = Depends(get_db)):
    if provider not in OAUTH_PROVIDERS or error or not code or not state:
        return _oauth_result_page(False)
    try:
        state_data = _decode_state_payload(state, provider)
        user_id = str(state_data["sub"])
        if not db.query(UserAccount).filter_by(id=user_id).first():
            return _oauth_result_page(False)
        client_id, client_secret = _oauth_keys(provider)
        redirect_uri = _redirect_uri(provider)
        async with httpx.AsyncClient(timeout=httpx.Timeout(20.0, connect=5.0)) as client:
            if provider == "google_workspace":
                response = await client.post("https://oauth2.googleapis.com/token", data={
                    "code": code, "client_id": client_id, "client_secret": client_secret,
                    "redirect_uri": redirect_uri, "grant_type": "authorization_code"})
                response.raise_for_status()
                data = response.json()
                destination = "google_automation" if state_data.get("purpose") == "automation" else provider
                previous = _credential(db, user_id, destination)
                old = json.loads(decrypt_secret(previous)) if previous else {}
                profile = await client.get("https://www.googleapis.com/oauth2/v3/userinfo",
                                           headers={"Authorization": f"Bearer {data['access_token']}"})
                account = profile.json().get("email", "") if profile.is_success else ""
                refresh = data.get("refresh_token") or (old.get("refresh_token") if old.get("account") == account else None)
                if not refresh: return _oauth_result_page(False)
                granted = set(data.get("scope", "").split())
                required = {"https://www.googleapis.com/auth/gmail.send",
                            "https://www.googleapis.com/auth/gmail.readonly"} if state_data.get("purpose") == "gmail" else set()
                if state_data.get("purpose") == "automation": required = set(AUTOMATION_SCOPES[2:])
                if not account or not required.issubset(granted):
                    return _oauth_result_page(False)
                stored = {"refresh_token": refresh, "scope": data.get("scope", ""), "account": account}
            elif provider == "slack":
                response = await client.post("https://slack.com/api/oauth.v2.access", data={
                    "code": code, "client_id": client_id, "client_secret": client_secret,
                    "redirect_uri": redirect_uri})
                response.raise_for_status()
                data = response.json()
                if not data.get("ok") or not data.get("access_token"):
                    return _oauth_result_page(False)
                stored = {"access_token": data["access_token"], "account": data.get("team", {}).get("name", ""),
                          "scope": data.get("scope", ""), "refresh_token": data.get("refresh_token", ""),
                          "expires_at": time.time() + data.get("expires_in", 0) if data.get("expires_in") else 0}
            elif provider == "meta":
                graph = _meta_graph()
                response = await client.get(f"{graph}/oauth/access_token", params={
                    "client_id": client_id, "client_secret": client_secret,
                    "redirect_uri": redirect_uri, "code": code})
                response.raise_for_status()
                short_token = response.json()["access_token"]
                response = await client.get(f"{graph}/oauth/access_token", params={
                    "grant_type": "fb_exchange_token", "client_id": client_id,
                    "client_secret": client_secret, "fb_exchange_token": short_token})
                response.raise_for_status()
                token_data = response.json()
                page_response = await client.get(f"{graph}/me/accounts", params={
                    "fields": "id,name,access_token,instagram_business_account{id,username}", "limit": 100},
                    headers={"Authorization": f"Bearer {token_data['access_token']}"})
                page_response.raise_for_status()
                # ponytail: first 100 Pages; add cursor pagination when a tenant exceeds that ceiling.
                pages = [{"id": str(page["id"]), "name": page.get("name", ""),
                          "access_token": page["access_token"],
                          "instagram_id": str(page.get("instagram_business_account", {}).get("id", "")),
                          "instagram_username": page.get("instagram_business_account", {}).get("username", "")}
                         for page in page_response.json().get("data", []) if page.get("access_token")]
                if not pages:
                    return _oauth_result_page(False)
                stored = {"access_token": token_data["access_token"], "pages": pages,
                          "account": pages[0]["name"] + (f" +{len(pages) - 1}" if len(pages) > 1 else ""),
                          "expires_at": time.time() + token_data.get("expires_in", 0) if token_data.get("expires_in") else 0}
            else:
                response = await client.post("https://github.com/login/oauth/access_token", data={
                    "code": code, "client_id": client_id, "client_secret": client_secret,
                    "redirect_uri": redirect_uri}, headers={"Accept": "application/json"})
                response.raise_for_status()
                data = response.json()
                if not data.get("access_token"):
                    return _oauth_result_page(False)
                profile = await client.get("https://api.github.com/user", headers={
                    "Authorization": f"Bearer {data['access_token']}", "Accept": "application/vnd.github+json"})
                profile.raise_for_status()
                stored = {"access_token": data["access_token"], "account": profile.json().get("login", ""),
                          "scope": data.get("scope", "")}
        _save_credential(db, user_id, "google_automation" if provider == "google_workspace" and state_data.get("purpose") == "automation" else provider, stored)
        return _oauth_result_page(True)
    except (HTTPException, httpx.HTTPError, KeyError, ValueError):
        return _oauth_result_page(False)


@router.post("/telegram")
async def connect_telegram(req: TelegramSetup, db: Session = Depends(get_db),
                           user: UserAccount = Depends(get_current_user)):
    token = req.token.strip()
    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(12.0, connect=5.0)) as client:
            response = await client.get(f"https://api.telegram.org/bot{token}/getMe")
        data = response.json()
        if not response.is_success or not data.get("ok"):
            raise HTTPException(status_code=422, detail="Telegram rejected this bot token")
    except (httpx.HTTPError, ValueError):
        raise HTTPException(status_code=502, detail="Could not verify Telegram bot") from None
    _save_credential(db, user.id, "telegram", {"token": token, "chat_id": req.chat_id.strip(),
                                                "account": "@" + data["result"].get("username", "bot")})
    return {"connected": True, "account": "@" + data["result"].get("username", "bot")}


@router.delete("/{provider}")
def disconnect(provider: str, db: Session = Depends(get_db), user: UserAccount = Depends(get_current_user)):
    if provider not in OAUTH_PROVIDERS | {"telegram"}:
        raise HTTPException(status_code=404, detail="Unsupported connector")
    record = _credential(db, user.id, provider)
    if record:
        db.delete(record)
        db.commit()
    return {"connected": False}


def _job_view(job: ConnectorJob) -> dict:
    return {"id": job.id, "provider": job.provider, "target": job.target, "subject": job.subject,
            "run_at": job.run_at, "status": job.status, "result_ref": job.result_ref,
            "error": job.error, "created_at": job.created_at}


@router.get("/jobs")
def list_jobs(db: Session = Depends(get_db), user: UserAccount = Depends(get_current_user)):
    jobs = db.query(ConnectorJob).filter_by(owner_user_id=user.id).order_by(ConnectorJob.created_at.desc()).limit(30).all()
    return {"jobs": [_job_view(job) for job in jobs]}


@router.post("/jobs")
async def create_job(req: PublishRequest, db: Session = Depends(get_db),
                     user: UserAccount = Depends(get_current_user)):
    if req.provider not in ACTION_CONNECTION:
        raise HTTPException(status_code=400, detail="This action is not supported yet")
    if not _credential(db, user.id, ACTION_CONNECTION[req.provider]):
        raise HTTPException(status_code=409, detail="Connect this app before creating an action")
    if req.provider == "gmail" and (not re.fullmatch(r"[^@\s]+@[^@\s]+\.[^@\s]+", req.target) or not req.subject.strip()):
        raise HTTPException(status_code=422, detail="Recipient email and subject are required")
    if req.provider == "github" and (not re.fullmatch(r"[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+", req.target)
                                     or any(part in {".", ".."} for part in req.target.split("/")) or not req.subject.strip()):
        raise HTTPException(status_code=422, detail="Enter owner/repository and an issue title")
    if req.provider == "slack" and not re.fullmatch(r"[CGDU][A-Z0-9]+", req.target.strip()):
        raise HTTPException(status_code=422, detail="Enter a Slack channel ID")
    if req.provider in {"facebook", "instagram"} and req.target and not req.target.isdigit():
        raise HTTPException(status_code=422, detail="Enter a Page or Instagram account ID from the connected Meta account")
    if req.provider == "instagram" and not re.fullmatch(r"https://[^\s]+", req.media_url):
        raise HTTPException(status_code=422, detail="Instagram photo needs a public HTTPS image URL")
    if req.provider == "gmail" and ("\r" in req.subject or "\n" in req.subject):
        raise HTTPException(status_code=422, detail="Subject must be one line")
    existing = db.query(ConnectorJob).filter_by(owner_user_id=user.id, idempotency_key=req.idempotency_key).first()
    if existing:
        return _job_view(existing)
    run_at = req.run_at.timestamp() if req.run_at else time.time()
    if run_at > time.time() + 366 * 86400:
        raise HTTPException(status_code=422, detail="Schedule within one year")
    job = ConnectorJob(id=str(uuid.uuid4()), owner_user_id=user.id, idempotency_key=req.idempotency_key,
                       provider=req.provider, target=req.target.strip(), subject=req.subject.strip(),
                       message=req.message.strip(), media_url=req.media_url.strip(),
                       run_at=max(run_at, time.time()), status="queued")
    db.add(job)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        existing = db.query(ConnectorJob).filter_by(owner_user_id=user.id, idempotency_key=req.idempotency_key).first()
        if existing:
            return _job_view(existing)
        raise
    if job.run_at <= time.time() + 2:
        await execute_job(job.id)
        db.refresh(job)
    return _job_view(job)


@router.delete("/jobs/{job_id}")
def cancel_job(job_id: str, db: Session = Depends(get_db), user: UserAccount = Depends(get_current_user)):
    job = db.query(ConnectorJob).filter_by(id=job_id, owner_user_id=user.id).first()
    if not job:
        raise HTTPException(status_code=404, detail="Action not found")
    if job.status != "queued":
        raise HTTPException(status_code=409, detail="Only queued actions can be cancelled")
    job.status, job.updated_at = "cancelled", time.time()
    db.commit()
    return _job_view(job)


async def _google_token(stored: dict, client: httpx.AsyncClient) -> str:
    client_id, client_secret = _oauth_keys("google_workspace")
    response = await client.post("https://oauth2.googleapis.com/token", data={
        "refresh_token": stored["refresh_token"], "client_id": client_id,
        "client_secret": client_secret, "grant_type": "refresh_token"})
    response.raise_for_status()
    return response.json()["access_token"]


async def _send_action(job: ConnectorJob, stored: dict) -> str:
    async with httpx.AsyncClient(timeout=httpx.Timeout(20.0, connect=5.0)) as client:
        if job.provider == "telegram":
            response = await client.post(f"https://api.telegram.org/bot{stored['token']}/sendMessage", json={
                "chat_id": job.target or stored["chat_id"], "text": job.message})
            data = response.json()
            if not response.is_success or not data.get("ok"):
                raise ValueError("Telegram could not post to that chat. Check bot access and chat ID.")
            return str(data["result"].get("message_id", ""))
        if job.provider == "slack":
            if stored.get("expires_at") and stored["expires_at"] < time.time():
                raise ValueError("Slack authorization expired. Reconnect the workspace.")
            response = await client.post("https://slack.com/api/chat.postMessage", headers={
                "Authorization": f"Bearer {stored['access_token']}"}, json={
                    "channel": job.target, "text": job.message})
            data = response.json()
            if not response.is_success or not data.get("ok"):
                raise ValueError("Slack could not post. Invite the bot to the channel and check its ID.")
            return str(data.get("ts", ""))
        if job.provider == "github":
            response = await client.post(f"https://api.github.com/repos/{job.target}/issues", headers={
                "Authorization": f"Bearer {stored['access_token']}",
                "Accept": "application/vnd.github+json"}, json={"title": job.subject, "body": job.message})
            if not response.is_success:
                raise ValueError("GitHub could not create the issue. Check public repository access.")
            return str(response.json().get("html_url", ""))
        if job.provider in {"facebook", "instagram"}:
            if stored.get("expires_at") and stored["expires_at"] < time.time():
                raise ValueError("Meta authorization expired. Reconnect Facebook and Instagram.")
            pages = stored.get("pages", [])
            if job.provider == "facebook":
                page = next((p for p in pages if p["id"] == job.target), None) if job.target else next(iter(pages), None)
                if not page:
                    raise ValueError("Select a Page from your connected Meta account.")
                response = await client.post(f"{_meta_graph()}/{page['id']}/feed", data={"message": job.message},
                                             headers={"Authorization": f"Bearer {page['access_token']}"})
                if not response.is_success:
                    raise ValueError("Facebook could not publish. Check Page permission and app review.")
                return str(response.json().get("id", ""))
            page = next((p for p in pages if p.get("instagram_id") == job.target), None) if job.target else next(
                (p for p in pages if p.get("instagram_id")), None)
            if not page:
                raise ValueError("Connect an Instagram Professional account linked to a Facebook Page.")
            headers = {"Authorization": f"Bearer {page['access_token']}"}
            response = await client.post(f"{_meta_graph()}/{page['instagram_id']}/media",
                                         data={"image_url": job.media_url, "caption": job.message}, headers=headers)
            if not response.is_success:
                raise ValueError("Instagram could not prepare this image. Use a public direct HTTPS image URL.")
            container_id = str(response.json()["id"])
            for _ in range(8):
                status_response = await client.get(f"{_meta_graph()}/{container_id}", params={"fields": "status_code"},
                                                   headers=headers)
                status_response.raise_for_status()
                status = status_response.json().get("status_code")
                if status == "FINISHED":
                    break
                if status in {"ERROR", "EXPIRED"}:
                    raise ValueError("Instagram rejected this image container.")
                await asyncio.sleep(1)
            else:
                raise ValueError("Instagram image is still processing. Try a new action shortly.")
            response = await client.post(f"{_meta_graph()}/{page['instagram_id']}/media_publish",
                                         data={"creation_id": container_id}, headers=headers)
            if not response.is_success:
                raise ValueError("Instagram could not publish. Check account permissions and app review.")
            return str(response.json().get("id", ""))
        if "https://www.googleapis.com/auth/gmail.send" not in stored.get("scope", "").split():
            raise ValueError("Gmail send permission was not granted. Reconnect Google Workspace.")
        access_token = await _google_token(stored, client)
        message = EmailMessage()
        message["To"], message["Subject"] = job.target, job.subject
        if stored.get("account"):
            message["From"] = stored["account"]
        message.set_content(job.message)
        raw = base64.urlsafe_b64encode(message.as_bytes()).decode().rstrip("=")
        response = await client.post("https://gmail.googleapis.com/gmail/v1/users/me/messages/send",
                                     headers={"Authorization": f"Bearer {access_token}"}, json={"raw": raw})
        if not response.is_success:
            raise ValueError("Gmail could not send the message. Check access and recipient.")
        return str(response.json().get("id", ""))


async def execute_job(job_id: str) -> None:
    db = SessionLocal()
    try:
        claimed = db.query(ConnectorJob).filter_by(id=job_id, status="queued").update(
            {ConnectorJob.status: "running", ConnectorJob.updated_at: time.time()})
        db.commit()
        if not claimed:
            return
        job = db.query(ConnectorJob).filter_by(id=job_id).first()
        try:
            if job.provider.startswith("crm_"):
                from api.crm_automation import execute_automation_job
                job.result_ref = await execute_automation_job(db, job)
                job.status = "succeeded"
                job.updated_at = time.time(); db.commit()
                return
            record = _credential(db, job.owner_user_id, ACTION_CONNECTION[job.provider])
            if not record:
                raise ValueError("Connector was disconnected before this action ran")
            job.result_ref = await _send_action(job, json.loads(decrypt_secret(record)))
            job.status = "succeeded"
        except ValueError as exc:
            job.status = "failed"
            job.error = str(exc)[:256]
        except httpx.TimeoutException:
            job.status = "unknown" if job.provider == "crm_email" else "failed"
            job.error = "Provider outcome is unknown. Review before retrying."
        except (httpx.HTTPError, KeyError, HTTPException):
            job.status = "failed"
            job.error = "Provider could not be reached or rejected this action. Review the connection and try again."
        if job.provider.startswith("crm_") and job.status in ("failed", "unknown"):
            from api.crm_automation import notice
            notice(db, job.owner_user_id, "delivery:" + job.id + ":" + job.status,
                   "Business reminder needs attention", job.subject + "\n" + (job.error or "Review delivery status in CRM."))
        job.updated_at = time.time()
        db.commit()
    finally:
        db.close()


async def connector_job_worker() -> None:
    while True:
        try:
            from api.crm_automation import automation_tick
            await automation_tick()
        except asyncio.CancelledError:
            raise
        except Exception:
            pass  # Automation migration/provider failures must not block other connectors.
        try:
            db = SessionLocal()
            try:
                due = [row[0] for row in db.query(ConnectorJob.id).filter(
                    ConnectorJob.status == "queued", ConnectorJob.run_at <= time.time()
                ).order_by(ConnectorJob.run_at).limit(20).all()]
            finally:
                db.close()
            for job_id in due:
                await execute_job(job_id)
        except asyncio.CancelledError:
            raise
        except Exception:
            # A failed scheduler pass must not stop the whole API.
            pass
        await asyncio.sleep(30)
