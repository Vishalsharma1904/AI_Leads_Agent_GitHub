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


# ── one table, one code path ─────────────────────────────────────────────────
# Every provider says here how a key is PROVED. The rule that matters is the
# one about rejection: only a definite authentication failure may refuse a key.
#
# This is what was wrong before. Sarvam was checked with
# GET /text-to-speech/models, which is not in Sarvam's API, and Sarvam answers
# 403 both for a bad key and for an authenticated request it will not serve —
# their docs say the body's error.code is what tells the two apart. So a
# perfectly good key came back "rejected". The AI providers had the same shape
# of bug: an HTTP 400 was read as "key rejected" when it only means the probe
# request was malformed, and Perplexity has no /models at all, so its keys
# could never be saved either.
#
# Now a check can only ever reject on 401/403 (plus the provider's own error
# code where it has one). Anything else — a moved endpoint, a rate limit, a
# network blip — stores the key and reports it unverified, because refusing to
# store a key you merely could not check is how a working key gets called bad.
PROVIDER_CHECKS: dict = {
    "apify": {
        "label": "Apify", "method": "GET", "url": "https://api.apify.com/v2/users/me",
        "headers": lambda s: {"Authorization": f"Bearer {s}"},
        "code": "APIFY_KEY_INVALID", "console": "https://console.apify.com/account/integrations",
    },
    "toughtongue": {
        "label": "Tough Tongue", "method": "GET",
        "url": "https://app.toughtongueai.com/api/public/scenarios",
        "headers": lambda s: {"Authorization": f"Bearer {s}"},
        "console": "https://app.toughtongueai.com/",
    },
    "sarvam": {
        # Sarvam publishes no cheap GET. An empty body on a real endpoint is the
        # cheapest honest probe: a bad key is refused before the body is read,
        # and a good key gets a validation error without translating anything.
        "label": "Sarvam AI", "method": "POST", "url": "https://api.sarvam.ai/translate",
        "json": {}, "headers": lambda s: {"api-subscription-key": s},
        "marker": "invalid_api_key_error",     # the only thing that may reject
        "ok_also": (400, 422),                 # got past auth = the key works
        "console": "https://dashboard.sarvam.ai/admin",
    },
    "cartesia": {
        "label": "Cartesia", "method": "GET", "url": "https://api.cartesia.ai/voices",
        "headers": lambda s: {"X-API-Key": s, "Cartesia-Version": "2024-06-10"},
        "console": "https://play.cartesia.ai/keys",
    },
    "gemini": {
        "label": "Google AI Studio", "method": "GET",
        "url": "https://generativelanguage.googleapis.com/v1beta/models",
        "headers": lambda s: {"x-goog-api-key": s},
        "console": "https://aistudio.google.com/apikey",
    },
}
# Everything OpenAI-compatible is proved the same way.
for _name, _cfg in AI_PROVIDER_CONFIG.items():
    PROVIDER_CHECKS.setdefault(_name, {
        "label": _name.replace("_", " ").title(), "method": "GET",
        "url": f"{_cfg['base_url']}/models",
        "headers": lambda s: {"Authorization": f"Bearer {s}"}, "console": "",
    })

PROVIDER_CONSOLES = {k: v.get("console", "") for k, v in PROVIDER_CHECKS.items()}
PROVIDER_CONSOLES.setdefault("google_sheets", "")
PROVIDER_CONSOLES.setdefault("composio", "https://app.composio.dev/settings")


def provider_label(provider: str) -> str:
    check = PROVIDER_CHECKS.get(provider)
    return check["label"] if check else provider.replace("_", " ").title()


def probe_key(provider: str, secret: str):
    """Return (state, message) where state is 'ok' | 'rejected' | 'unverified'."""
    check = PROVIDER_CHECKS.get(provider)
    label = provider_label(provider)
    if not check:
        return "unverified", f"Saved. {label} has no key check yet, so it is proved on first use."
    try:
        response = httpx.request(check["method"], check["url"],
                                 headers=check["headers"](secret),
                                 json=check.get("json"), timeout=10.0)
    except httpx.TimeoutException:
        return "unverified", f"Saved. {label} did not answer in time, so the key is unchecked."
    except httpx.HTTPError:
        return "unverified", f"Saved. {label} could not be reached, so the key is unchecked."

    status = response.status_code
    if status in (401, 403):
        marker = check.get("marker")
        if not marker:
            return "rejected", f"{label} rejected this key."
        body = (response.text or "")[:4000].lower()
        if marker in body:
            return "rejected", f"{label} rejected this key."
        # 403 that does not name a bad key: authenticated, but not allowed here.
        return "unverified", (f"Saved. {label} accepted the key but refused this check "
                              f"— check the plan or permissions on that account.")
    if status in check.get("ok_also", ()):
        return "ok", f"{label} accepted this key."
    if status == 429:
        return "unverified", f"Saved. {label} is rate limiting key checks right now."
    if status >= 500:
        return "unverified", f"Saved. {label} is having trouble right now, so the key is unchecked."
    if status < 300:
        return "ok", f"{label} accepted this key."
    # 400 / 404 / 405 prove the probe URL is wrong, never that the key is.
    return "unverified", f"Saved. {label} answered {status} to the check; it will be proved on first use."


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
    _master_key()
    # Strip once, here, for every provider. Pasting a key from a web page
    # carries a trailing newline often enough that it used to be stored broken
    # for anything that was not Apify, and then every later call failed too.
    secret = req.secret.strip()
    if not secret:
        raise HTTPException(status_code=422, detail={"code": "CREDENTIAL_EMPTY", "message": "Paste a key first."})
    state, note = probe_key(provider, secret)
    if state == "rejected":
        check = PROVIDER_CHECKS.get(provider) or {}
        raise HTTPException(status_code=422, detail={
            "code": check.get("code", "CREDENTIAL_REJECTED"),
            "message": note,
            "console": check.get("console", ""),
        })
    ciphertext, nonce = encrypt_secret(secret)
    record = db.query(ProviderCredential).filter_by(owner_user_id=user.id, provider=provider).first()
    if record:
        record.ciphertext, record.nonce, record.updated_at = ciphertext, nonce, time.time()
    else:
        record = ProviderCredential(owner_user_id=user.id, provider=provider, ciphertext=ciphertext, nonce=nonce, updated_at=time.time())
        db.add(record)
    db.commit()
    return {"success": True, "provider": provider, "updated_at": record.updated_at,
            "verified": state == "ok", "note": note,
            "console": PROVIDER_CONSOLES.get(provider, "")}


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
    """Re-check a stored key. Every provider in the registry can be checked now
    — Sarvam and Cartesia used to answer "cannot be verified yet"."""
    provider = normalize_provider(provider)
    if provider not in ALLOWED_PROVIDERS:
        raise HTTPException(status_code=400, detail={"code": "CREDENTIAL_VERIFY_UNSUPPORTED",
                                                     "message": "Unsupported provider."})
    record = db.query(ProviderCredential).filter_by(owner_user_id=user.id, provider=provider).first()
    if not record:
        raise HTTPException(status_code=404, detail={"code": "AI_CREDENTIAL_MISSING",
                                                     "message": f"{provider_label(provider)} is not connected yet."})
    state, note = probe_key(provider, decrypt_secret(record))
    if state == "rejected":
        check = PROVIDER_CHECKS.get(provider) or {}
        raise HTTPException(status_code=422, detail={
            "code": check.get("code", "AI_CREDENTIAL_INVALID"),
            "message": note, "console": check.get("console", ""),
        })
    return {"success": True, "provider": provider, "verified": state == "ok", "note": note,
            "console": PROVIDER_CONSOLES.get(provider, "")}


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
