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
ALLOWED_PROVIDERS = {"apify", "google_sheets", *AI_PROVIDER_CONFIG.keys()}


def normalize_provider(provider: str) -> str:
    value = str(provider or "").strip().lower().replace(" ", "_")
    return AI_PROVIDER_ALIASES.get(value, value)


def _master_key() -> bytes:
    raw = os.getenv("CREDENTIAL_MASTER_KEY", "").strip()
    if len(raw) < 32:
        raise HTTPException(status_code=503, detail="Credential vault is not configured")
    return hashlib.sha256(raw.encode("utf-8")).digest()


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
    ciphertext, nonce = encrypt_secret(req.secret)
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
    return {"success": True, "credentials": [{"provider": r.provider, "updated_at": r.updated_at, "configured": True} for r in records]}


@router.post("/verify/{provider}")
def verify_credential(provider: str, db: Session = Depends(get_db), user: UserAccount = Depends(get_current_user)):
    provider = normalize_provider(provider)
    if provider not in AI_PROVIDER_CONFIG:
        raise HTTPException(status_code=400, detail={"code": "CREDENTIAL_VERIFY_UNSUPPORTED", "message": "This provider cannot be verified yet."})
    record = db.query(ProviderCredential).filter_by(owner_user_id=user.id, provider=provider).first()
    if not record:
        raise HTTPException(status_code=404, detail={"code": "AI_CREDENTIAL_MISSING", "message": "OpenRouter credential is not configured."})
    try:
        secret = decrypt_secret(record)
        if provider == "gemini":
            response = httpx.get("https://generativelanguage.googleapis.com/v1beta/models",
                                 params={"key": secret}, timeout=8.0)
        else:
            response = httpx.get(f"{AI_PROVIDER_CONFIG[provider]['base_url']}/models",
                                 headers={"Authorization": f"Bearer {secret}"}, timeout=8.0)
        if response.status_code in (401, 403):
            raise HTTPException(status_code=422, detail={"code": "AI_CREDENTIAL_INVALID", "message": "The provider rejected this key."})
        if response.status_code == 429:
            raise HTTPException(status_code=429, detail={"code": "AI_RATE_LIMITED", "message": "OpenRouter rate limit was reached.", "retryable": True, "action": "RETRY"})
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
    env_name = {"apify": "APIFY_API_TOKEN", **{name: meta["env"] for name, meta in AI_PROVIDER_CONFIG.items()}}.get(provider, "")
    return os.getenv(env_name, "").strip() or None
