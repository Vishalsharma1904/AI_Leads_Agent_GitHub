"""Tenant-scoped encrypted provider credentials.

Plaintext credentials never leave this module. The master key is supplied by
the deployment environment and is intentionally not exposed through the API.
"""
import base64
import hashlib
import json
import os
import secrets
import time
from datetime import datetime, timedelta, timezone
from typing import Optional

from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import Column, Integer, String, Text, Float, UniqueConstraint
from sqlalchemy.orm import Session
import httpx

from api.auth_sync import AUTO_CREATE_SCHEMA, Base, UserAccount, get_current_user, get_db


class ProviderCredential(Base):
    __tablename__ = "provider_credentials"
    __table_args__ = (UniqueConstraint("owner_user_id", "provider", name="uq_provider_owner"),)

    id = Column(Integer, primary_key=True, autoincrement=True)
    owner_user_id = Column(String(64), index=True, nullable=False)
    provider = Column(String(64), index=True, nullable=False)
    ciphertext = Column(Text, nullable=False)
    nonce = Column(String(64), nullable=False)
    key_version = Column(Integer, nullable=False, default=1)
    updated_at = Column(Float, default=time.time)


if AUTO_CREATE_SCHEMA:
    Base.metadata.create_all(bind=__import__("api.auth_sync", fromlist=["engine"]).engine)

router = APIRouter(prefix="/api/credentials", tags=["credentials"])
AI_PROVIDER_ALIASES = {
    "google": "gemini",
    "google_ai_studio": "gemini",
    "google-gemini": "gemini",
}

# Provider metadata is deliberately backend-only. The browser receives status,
# never endpoints, environment names, or credential material.
AI_PROVIDER_CONFIG = {
    "openrouter": {"env": "OPENROUTER_API_KEY", "base_url": "https://openrouter.ai/api/v1"},
    "groq": {"env": "GROQ_API_KEY", "base_url": "https://api.groq.com/openai/v1"},
    "openai": {"env": "OPENAI_API_KEY", "base_url": "https://api.openai.com/v1"},
    "deepseek": {"env": "DEEPSEEK_API_KEY", "base_url": "https://api.deepseek.com/v1"},
    "mistral": {"env": "MISTRAL_API_KEY", "base_url": "https://api.mistral.ai/v1"},
    "together": {"env": "TOGETHER_API_KEY", "base_url": "https://api.together.xyz/v1"},
    "fireworks": {"env": "FIREWORKS_API_KEY", "base_url": "https://api.fireworks.ai/inference/v1"},
    "xai": {"env": "XAI_API_KEY", "base_url": "https://api.x.ai/v1"},
    "cerebras": {"env": "CEREBRAS_API_KEY", "base_url": "https://api.cerebras.ai/v1"},
    "perplexity": {"env": "PERPLEXITY_API_KEY", "base_url": "https://api.perplexity.ai"},
    "gemini": {"env": "GEMINI_API_KEY", "base_url": "https://generativelanguage.googleapis.com"},
}
ALLOWED_PROVIDERS = {"apify", "google_sheets", "toughtongue", "sarvam", "composio", "cartesia", *AI_PROVIDER_CONFIG.keys()}
LIVE_MODELS = {"gemini-3.8-live", "gemini-2.5-flash-native-audio-preview-12-2025", "gemini-3.1-flash-live-preview"}


def normalize_provider(provider: str) -> str:
    value = str(provider or "").strip().lower().replace(" ", "_")
    return AI_PROVIDER_ALIASES.get(value, value)


def _verify_apify_key(secret: str) -> None:
    try:
        response = httpx.get("https://api.apify.com/v2/users/me",
                             headers={"Authorization": f"Bearer {secret}"}, timeout=10.0)
        if response.status_code in (401, 403):
            raise HTTPException(status_code=422, detail={"code": "APIFY_KEY_INVALID", "message": "Apify rejected this API key."})
        if response.status_code == 429:
            raise HTTPException(status_code=429, detail={"code": "APIFY_RATE_LIMITED", "message": "Apify is rate limiting key checks. Try again shortly."})
        response.raise_for_status()
    except HTTPException:
        raise
    except httpx.TimeoutException:
        raise HTTPException(status_code=504, detail={"code": "APIFY_TIMEOUT", "message": "Apify key check timed out. Try again."}) from None
    except httpx.HTTPError:
        raise HTTPException(status_code=502, detail={"code": "APIFY_UNAVAILABLE", "message": "Could not reach Apify to check the key."}) from None


def _master_key() -> bytes:
    raw = os.getenv("CREDENTIAL_MASTER_KEY", "").strip()
    if len(raw) < 32:
        raise HTTPException(status_code=503, detail="Credential vault is not configured")
    return hashlib.sha256(raw.encode("utf-8")).digest()


def _verify_ai_key(provider: str, secret: str) -> None:
    try:
        if provider == "gemini":
            # AI Studio issues "AIza…" (legacy) and "AQ.…" (current) keys; both
            # authenticate via x-goog-api-key on the native Gemini endpoint.
            if not (secret.startswith("AIza") or secret.startswith("AQ.")):
                raise HTTPException(status_code=422, detail="Use an AI Studio API key from aistudio.google.com/apikey")
            response = httpx.get("https://generativelanguage.googleapis.com/v1beta/models",
                                 headers={"x-goog-api-key": secret}, timeout=8.0)
        else:
            response = httpx.get(f"{AI_PROVIDER_CONFIG[provider]['base_url']}/models",
                                 headers={"Authorization": f"Bearer {secret}"}, timeout=8.0)
        if response.status_code in (400, 401, 403):
            raise HTTPException(status_code=422, detail="The provider rejected this API key")
        if response.status_code == 429:
            raise HTTPException(status_code=429, detail="Provider verification is rate limited; retry shortly")
        response.raise_for_status()
    except HTTPException:
        raise
    except httpx.HTTPError:
        raise HTTPException(status_code=502, detail="Could not verify the provider key; existing key was not changed") from None


def encrypt_secret(secret: str) -> tuple[str, str]:
    nonce = secrets.token_bytes(12)
    ciphertext = AESGCM(_master_key()).encrypt(nonce, secret.encode("utf-8"), None)
    return base64.urlsafe_b64encode(ciphertext).decode(), base64.urlsafe_b64encode(nonce).decode()


def decrypt_secret(record: ProviderCredential) -> str:
    ciphertext = base64.urlsafe_b64decode(record.ciphertext.encode())
    nonce = base64.urlsafe_b64decode(record.nonce.encode())
    return AESGCM(_master_key()).decrypt(nonce, ciphertext, None).decode("utf-8")


class CredentialRequest(BaseModel):
    provider: str = Field(min_length=2, max_length=64)
    secret: str = Field(min_length=1, max_length=4096)


@router.put("")
def upsert_credential(req: CredentialRequest, db: Session = Depends(get_db), user: UserAccount = Depends(get_current_user)):
    provider = normalize_provider(req.provider)
    if provider not in ALLOWED_PROVIDERS:
        raise HTTPException(status_code=400, detail="Unsupported provider")
    _master_key()
    if provider in AI_PROVIDER_CONFIG:
        _verify_ai_key(provider, req.secret.strip())
    if provider == "apify":
        _verify_apify_key(req.secret.strip())
    if provider == "toughtongue":
        try:
            response = httpx.get("https://app.toughtongueai.com/api/public/scenarios",
                                 headers={"Authorization": f"Bearer {req.secret}"}, timeout=10.0)
            if response.status_code in (401, 403):
                raise HTTPException(status_code=422, detail="Tough Tongue rejected this API key")
            response.raise_for_status()
        except HTTPException:
            raise
        except httpx.HTTPError:
            raise HTTPException(status_code=502, detail="Could not verify the Tough Tongue API key") from None
    if provider == "sarvam":
        # Sarvam has no cheap "whoami", so the cheapest real call that proves
        # the key is a text-to-speech model list. A bad key 401s here.
        try:
            response = httpx.get("https://api.sarvam.ai/text-to-speech/models",
                                 headers={"api-subscription-key": req.secret}, timeout=10.0)
            if response.status_code in (401, 403):
                raise HTTPException(status_code=422, detail="Sarvam rejected this API key")
        except HTTPException:
            raise
        except httpx.HTTPError:
            # Reachability is not the tenant's problem — store it and let the
            # first real call report the truth.
            pass
    ciphertext, nonce = encrypt_secret(req.secret.strip() if provider == "apify" else req.secret)
    record = db.query(ProviderCredential).filter_by(owner_user_id=user.id, provider=provider).first()
    if record:
        record.ciphertext, record.nonce, record.updated_at = ciphertext, nonce, time.time()
    else:
        record = ProviderCredential(owner_user_id=user.id, provider=provider, ciphertext=ciphertext, nonce=nonce, updated_at=time.time())
        db.add(record)
    db.commit()
    return {"success": True, "provider": provider, "updated_at": record.updated_at}


@router.get("")
def list_credentials(db: Session = Depends(get_db), user: UserAccount = Depends(get_current_user)):
    records = db.query(ProviderCredential).filter_by(owner_user_id=user.id).all()
    configured = [{"provider": r.provider, "updated_at": r.updated_at, "configured": True} for r in records]
    owned = {r.provider for r in records}
    for provider in ALLOWED_PROVIDERS - owned:
        if get_provider_secret(provider, user, db):
            configured.append({"provider": provider, "configured": True, "source": "platform"})
    return {"success": True, "credentials": configured}


@router.post("/verify/{provider}")
def verify_credential(provider: str, db: Session = Depends(get_db), user: UserAccount = Depends(get_current_user)):
    provider = normalize_provider(provider)
    if provider != "apify" and provider not in AI_PROVIDER_CONFIG:
        raise HTTPException(status_code=400, detail={"code": "CREDENTIAL_VERIFY_UNSUPPORTED", "message": "This provider cannot be verified yet."})
    record = db.query(ProviderCredential).filter_by(owner_user_id=user.id, provider=provider).first()
    if not record:
        raise HTTPException(status_code=404, detail={"code": "AI_CREDENTIAL_MISSING", "message": f"{provider} credential is not configured."})
    try:
        secret = decrypt_secret(record)
        if provider == "apify":
            _verify_apify_key(secret)
            return {"success": True, "provider": provider, "verified": True}
        if provider == "gemini":
            response = httpx.get("https://generativelanguage.googleapis.com/v1beta/models",
                                 headers={"x-goog-api-key": secret}, timeout=8.0)
        else:
            response = httpx.get(f"{AI_PROVIDER_CONFIG[provider]['base_url']}/models",
                                 headers={"Authorization": f"Bearer {secret}"}, timeout=8.0)
        if response.status_code in (401, 403):
            raise HTTPException(status_code=422, detail={"code": "AI_CREDENTIAL_INVALID", "message": "The provider rejected this key."})
        if response.status_code == 429:
            raise HTTPException(status_code=429, detail={"code": "AI_RATE_LIMITED", "message": f"{provider} rate limit was reached.", "retryable": True, "action": "RETRY"})
        response.raise_for_status()
    except HTTPException:
        raise
    except httpx.TimeoutException:
        raise HTTPException(status_code=504, detail={"code": "AI_TIMEOUT", "message": "Provider verification timed out.", "retryable": True, "action": "RETRY"})
    except (httpx.HTTPError, ValueError):
        raise HTTPException(status_code=502, detail={"code": "AI_BACKEND_UNAVAILABLE", "message": "The provider could not be reached.", "retryable": True, "action": "RETRY"})
    return {"success": True, "provider": provider, "verified": True}


@router.delete("/{provider}")
def delete_credential(provider: str, db: Session = Depends(get_db), user: UserAccount = Depends(get_current_user)):
    provider = normalize_provider(provider)
    record = db.query(ProviderCredential).filter_by(owner_user_id=user.id, provider=provider).first()
    if record:
        db.delete(record)
        db.commit()
    return {"success": True, "provider": provider}


def get_provider_secret(provider: str, user: UserAccount, db: Session) -> Optional[str]:
    provider = normalize_provider(provider)
    record = db.query(ProviderCredential).filter_by(owner_user_id=user.id, provider=provider).first()
    if record:
        return decrypt_secret(record)
    # Platform fallback. A tenant with no key of its own uses the operator's,
    # read from this server's environment — which is how a customer can run the
    # product without ever being handed a key. The key is used here and never
    # serialised into any response, so there is nothing in the client to steal.
    env_name = {
        "apify": "APIFY_API_TOKEN",
        "sarvam": "SARVAM_API_KEY",
        "cartesia": "CARTESIA_API_KEY",
        "toughtongue": "TOUGHTONGUE_API_KEY",
        "composio": "COMPOSIO_API_KEY",
        **{name: meta["env"] for name, meta in AI_PROVIDER_CONFIG.items()},
    }.get(provider, "")
    return os.getenv(env_name, "").strip() or None


class LiveTokenRequest(BaseModel):
    model: str = Field(min_length=2, max_length=100)


@router.post("/gemini-live-token")
async def gemini_live_token(req: LiveTokenRequest, db: Session = Depends(get_db), user: UserAccount = Depends(get_current_user)):
    if req.model not in LIVE_MODELS:
        raise HTTPException(status_code=422, detail="Unsupported Live voice model")
    from api.limits import consume
    consume(db, user, "ai")
    key = get_provider_secret("gemini", user, db)
    if not key:
        raise HTTPException(status_code=503, detail="Connect Gemini in Setup first")
    now = datetime.now(timezone.utc)
    # Bind the one-use token to the requested model while leaving the browser's
    # voice setup intact. Google's token endpoint accepts this field mask.
    payload = {
        "uses": 1,
        "expireTime": (now + timedelta(minutes=10)).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "newSessionExpireTime": (now + timedelta(minutes=1)).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "fieldMask": "model",
        "bidiGenerateContentSetup": {"model": "models/" + req.model},
    }
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            response = await client.post("https://generativelanguage.googleapis.com/v1beta/auth_tokens",
                                         headers={"x-goog-api-key": key}, json=payload)
        if response.status_code == 400:
            raise ValueError("Google rejected the Live token request (400)")
        response.raise_for_status()
        data = response.json()
        # Google returns either {"name": "auth_tokens/..."} or newer format with token directly
        name = data.get("name") or data.get("token") or ""
        if not isinstance(name, str) or not (name.startswith("auth_tokens/") or len(name) > 20):
            raise ValueError("Google returned an invalid Live token response")
    except (httpx.HTTPError, ValueError) as e:
        raise HTTPException(status_code=502, detail=f"Google could not issue a secure Live token: {str(e)[:100]}") from None
    return {"token": name, "model": req.model, "expires_at": payload["expireTime"]}
