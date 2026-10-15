"""Authenticated ElevenAgents studio. API schemas checked against ElevenLabs OpenAPI.

One provider account belongs to one app tenant; every mutable resource is also
bound locally. Provider credentials and Groq workspace secrets never reach JS.
"""
import asyncio
import hashlib
import json
import re
import time
from typing import Literal
from urllib.parse import urlparse
from html.parser import HTMLParser

import httpx
from fastapi import APIRouter, Depends, HTTPException, Query, Response
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import Column, Float, String, Text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from api.auth_sync import AUTO_CREATE_SCHEMA, Base, UserAccount, engine, get_current_user, get_db
from api.credentials import get_provider_secret

router = APIRouter(prefix="/api/v1/elevenlabs", tags=["elevenlabs"])
BASE_URL = "https://api.elevenlabs.io/v1"
ID_RE = re.compile(r"^[A-Za-z0-9_-]{1,160}$")
E164_RE = re.compile(r"^\+[1-9]\d{7,14}$")
GROQ_MODELS = {"llama-3.3-70b-versatile", "llama-3.1-8b-instant", "openai/gpt-oss-120b", "openai/gpt-oss-20b"}
TTS_MODELS = {"eleven_flash_v2_5", "eleven_turbo_v2_5", "eleven_multilingual_v2", "eleven_v3_conversational"}
_BATCH_SUBMIT_LOCK = asyncio.Lock()  # ponytail: one API worker; durable row claims prevent in-process duplicate dispatch.


class ElevenLabsResource(Base):
    __tablename__ = "elevenlabs_resources"
    kind = Column(String(32), primary_key=True)
    resource_id = Column(String(160), primary_key=True)
    owner_user_id = Column(String(64), index=True, nullable=False)
    name = Column(String(255), nullable=False, default="")
    details = Column(Text, nullable=False, default="{}")
    updated_at = Column(Float, default=time.time)


if AUTO_CREATE_SCHEMA:
    Base.metadata.create_all(bind=engine)


class StrictRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")


class AgentRequest(StrictRequest):
    name: str = Field(min_length=1, max_length=120)
    instructions: str = Field(min_length=10, max_length=30000)
    first_message: str = Field(default="Namaste, main Rudra AI hoon. Main aapki kaise madad kar sakta hoon?", max_length=2000)
    language: Literal["hi", "en", "es", "fr", "de", "pt", "ar", "ta", "te", "bn", "mr", "gu", "kn", "ml", "pa"] = "hi"
    hinglish_mode: bool = True
    voice_id: str = Field(min_length=1, max_length=160)
    tts_model: str = "eleven_flash_v2_5"
    groq_model: str = "openai/gpt-oss-120b"
    reasoning_effort: Literal["low", "medium", "high"] = "low"
    temperature: float = Field(default=0.4, ge=0, le=1)
    max_tokens: int = Field(default=350, ge=50, le=2000)
    stability: float = Field(default=0.5, ge=0, le=1)
    similarity_boost: float = Field(default=0.8, ge=0, le=1)
    speed: float = Field(default=1, ge=0.7, le=1.2)
    turn_eagerness: Literal["patient", "normal", "eager"] = "normal"
    turn_timeout: float = Field(default=10, ge=3, le=60)
    silence_end_call_timeout: float = Field(default=45, ge=10, le=300)
    max_duration_seconds: int = Field(default=600, ge=60, le=3600)
    disable_first_message_interruptions: bool = False
    speculative_turn: bool = False
    keywords: list[str] = Field(default_factory=list, max_length=30)
    record_voice: bool = False
    retention_days: int = Field(default=7, ge=1, le=90)
    delete_transcript_and_pii: bool = False
    evaluation_goal: str = Field(default="", max_length=3000)
    knowledge_ids: list[str] = Field(default_factory=list, max_length=20)
    tool_ids: list[str] = Field(default_factory=list, max_length=20)
    end_call: bool = True
    language_detection: bool = True


class PhoneRequest(StrictRequest):
    provider: Literal["sip_trunk", "twilio", "exotel"]
    phone_number: str = Field(min_length=8, max_length=16)
    label: str = Field(min_length=1, max_length=120)
    supports_inbound: bool = False
    inbound_allowed_addresses: list[str] = Field(default_factory=list, max_length=20)
    agent_id: str = Field(default="", max_length=160)
    address: str = Field(default="", max_length=255)
    transport: Literal["tls", "tcp", "udp", "auto"] = "tls"
    media_encryption: Literal["required", "allowed", "disabled"] = "allowed"
    username: str = Field(default="", max_length=255)
    password: str = Field(default="", max_length=4096)
    sid: str = Field(default="", max_length=255)
    token: str = Field(default="", max_length=4096)
    account_sid: str = Field(default="", max_length=255)
    api_key: str = Field(default="", max_length=4096)
    api_token: str = Field(default="", max_length=4096)
    api_subdomain: Literal["api.in.exotel.com", "api.exotel.com"] = "api.in.exotel.com"
    app_id: str = Field(default="", max_length=255)


class AssignRequest(StrictRequest):
    agent_id: str = Field(min_length=1, max_length=160)


class CallRequest(StrictRequest):
    agent_id: str = Field(min_length=1, max_length=160)
    phone_number_id: str = Field(min_length=1, max_length=160)
    to_number: str = Field(min_length=8, max_length=16)
    dynamic_variables: dict[str, str] = Field(default_factory=dict)
    confirmed: bool = False


class BatchRecipient(StrictRequest):
    phone_number: str = Field(min_length=8, max_length=16)
    dynamic_variables: dict[str, str] = Field(default_factory=dict, max_length=20)
    crm_record_id: str | None = Field(default=None, min_length=1, max_length=36)


class BatchCallRequest(StrictRequest):
    request_id: str = Field(min_length=16, max_length=64, pattern=r"^[A-Za-z0-9_-]+$")
    agent_id: str = Field(min_length=1, max_length=160)
    phone_number_id: str = Field(min_length=1, max_length=160)
    call_name: str = Field(min_length=1, max_length=120)
    recipients: list[BatchRecipient] = Field(min_length=1, max_length=200)
    confirmed: bool = False


class VerifyCallRequest(StrictRequest):
    agent_id: str = Field(min_length=1, max_length=160, pattern=r"^[A-Za-z0-9_-]+$")
    to_number: str = Field(min_length=8, max_length=16, pattern=r"^\+[1-9]\d{7,14}$")
    started_at: float = Field(gt=0, allow_inf_nan=False)


class KnowledgeRequest(StrictRequest):
    name: str = Field(min_length=1, max_length=120)
    text: str = Field(default="", max_length=100000)
    url: str = Field(default="", max_length=2000)


class ToolRequest(StrictRequest):
    type: Literal["open_page", "webhook"]
    name: str = Field(default="open_page", min_length=1, max_length=64, pattern=r"^[A-Za-z_][A-Za-z0-9_]*$")
    description: str = Field(default="Open an app page when the user asks to view it.", min_length=10, max_length=2000)
    url: str = Field(default="", max_length=2000)


def _owned(db, user, kind, resource_id):
    if not isinstance(resource_id, str) or not ID_RE.fullmatch(resource_id):
        raise HTTPException(404, "Resource not found")
    row = db.query(ElevenLabsResource).filter_by(kind=kind, resource_id=resource_id, owner_user_id=user.id).first()
    if not row:
        raise HTTPException(404, "Resource not found for this account")
    return row


def _ownership_conflict(kind):
    if kind == "account":
        return HTTPException(409, {"code": "ELEVENLABS_ACCOUNT_OWNERSHIP", "message":
            "This ElevenLabs account is connected to another app account. Sign in to the original app account, "
            "or connect a separate ElevenLabs account in Setup. Changing the API key of the same ElevenLabs account does not transfer ownership."})
    return HTTPException(409, {"code": "ELEVENLABS_RESOURCE_OWNERSHIP", "message":
        "This ElevenLabs resource is already connected to another app account. Choose a resource belonging to this account."})


def _bind(db, user, kind, resource_id, name="", details=None):
    if not isinstance(resource_id, str) or not ID_RE.fullmatch(resource_id):
        raise HTTPException(502, "ElevenLabs returned an invalid resource ID")
    row = db.query(ElevenLabsResource).filter_by(kind=kind, resource_id=resource_id).first()
    if row and row.owner_user_id != user.id:
        raise _ownership_conflict(kind)
    if not row:
        row = ElevenLabsResource(kind=kind, resource_id=resource_id, owner_user_id=user.id)
        db.add(row)
    row.name, row.updated_at = name[:255], time.time()
    if details is not None:
        row.details = json.dumps(details)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise _ownership_conflict(kind) from None
    return row


def _bind_listed(db, user, kind, resource_id, name="", details=None):
    # Account ownership is checked by _provider before any upstream listing.
    # Imported/migrated individual resources can still belong to another tenant.
    # Hide those rows instead of allowing one conflict to disable the entire UI.
    try:
        # A private family key shares credits, not historic provider resources.
        # Only resources explicitly created/imported by this app account appear.
        from services.developer_control import ProviderAssignment
        assignment = db.query(ProviderAssignment).filter_by(user_id=user.id, provider='elevenlabs').first()
        shared = bool(assignment and assignment.mode == 'shared')
        if (shared or _family_member(user, db)) and not db.query(ElevenLabsResource).filter_by(kind=kind,resource_id=resource_id).first():
            return None
        return _bind(db, user, kind, resource_id, name, details)
    except HTTPException as error:
        if error.status_code == 409 and isinstance(error.detail, dict) and error.detail.get("code") == "ELEVENLABS_RESOURCE_OWNERSHIP":
            return None
        raise


def _family_member(user, db):
    from services.family_provider_access import get_family_secret
    secret = get_family_secret('elevenlabs', getattr(user,'email',''))
    return bool(secret and secret == get_provider_secret('elevenlabs',user,db))

def _claim_account(db, user, data):
    # A shared provider account cannot be used to browse another app tenant's
    # calls/numbers. Local resource checks remain necessary with distinct keys.
    account_id = data.get("user_id") if isinstance(data, dict) else None
    if not account_id:
        raise HTTPException(502, "ElevenLabs did not identify the connected account")
    from services.developer_control import ProviderAssignment
    assignment = db.query(ProviderAssignment).filter_by(user_id=user.id, provider='elevenlabs').first()
    if assignment and assignment.mode == 'shared':
        return None  # Provider account may be shared; resource ownership never is.
    existing = db.query(ElevenLabsResource).filter_by(kind='account',resource_id=account_id).first()
    if existing and existing.owner_user_id != user.id and _family_member(user,db):
        from services.family_provider_access import get_family_secret
        original = db.query(UserAccount).filter_by(id=existing.owner_user_id).first()
        if original and get_family_secret('elevenlabs',original.email):
            return existing  # individual resource ownership still enforced
    return _bind(db, user, "account", account_id, "ElevenLabs account")


async def _provider(method, path, user, db, payload=None, binary=False):
    from services.developer_control import check_access, reserve_provider
    cancellation = bool(getattr(user, '_control_cancel', False) and (path.endswith('/cancel') or method == 'GET'))
    if not cancellation and not (method == 'GET' and getattr(user, '_support_read', False)):
        check_access(db, user, 'calls')
    key = get_provider_secret("elevenlabs", user, db)
    if not key:
        raise HTTPException(409, "Connect your ElevenLabs API key first")
    if not cancellation and method not in ('GET', 'DELETE'):
        reserve_provider(db, user, 'elevenlabs')
    try:
        async with httpx.AsyncClient(timeout=30) as client:
            headers = {"xi-api-key": key}
            account = await client.get(BASE_URL + "/user", headers=headers)
            _check_response(account)
            account_data = account.json()
            _claim_account(db, user, account_data)
            if path == "/user" and method == "GET":
                return account_data
            response = await client.request(method, BASE_URL + path, headers=headers, json=payload)
            _check_response(response)
            if binary:
                if len(response.content) > 50_000_000:
                    raise HTTPException(502, "Recording is too large to preview")
                return response.content
            return response.json() if response.content else {}
    except HTTPException:
        raise
    except (httpx.HTTPError, ValueError):
        raise HTTPException(502, "ElevenLabs could not be reached. Check connectivity and try again.") from None


def _check_response(response):
    code = response.status_code
    if code in (401, 403):
        raise HTTPException(422, "ElevenLabs rejected this request. Check API key permissions and plan access in ElevenLabs.")
    if code == 429:
        raise HTTPException(429, "ElevenLabs quota or concurrency limit reached. Check your account allowance.")
    if code == 404:
        raise HTTPException(404, "Resource is unavailable in the connected ElevenLabs account")
    if code >= 400:
        # Provider bodies can echo credentials, prompt content or trunk secrets.
        status = 422 if code < 500 else 502
        raise HTTPException(status, f"ElevenLabs rejected the configuration ({code}). Check the required fields and provider setup.")


def _public_url(value):
    parsed = urlparse(value)
    if parsed.scheme != "https" or not parsed.hostname or parsed.username or parsed.password or parsed.fragment:
        raise HTTPException(422, "Use a public HTTPS URL without credentials or a fragment")
    hostname = parsed.hostname.lower()
    import ipaddress
    try:
        address = ipaddress.ip_address(hostname)
        private = not address.is_global
    except ValueError:
        private = hostname == "localhost" or "." not in hostname or hostname.endswith((".local", ".internal", ".localhost"))
    if private:
        raise HTTPException(422, "Use a public HTTPS hostname")
    return value


async def _groq_secret(user, db):
    key = get_provider_secret("groq", user, db)
    if not key:
        raise HTTPException(409, "Connect your Groq key in Rudra AI Setup before saving an ElevenLabs agent")
    account = await _provider("GET", "/user", user, db)
    account_id = account["user_id"]
    row = db.query(ElevenLabsResource).filter_by(kind="groq_secret", resource_id=account_id, owner_user_id=user.id).first()
    saved = json.loads(row.details) if row else {}
    digest = hashlib.sha256(key.encode()).hexdigest()
    if saved.get("secret_id") and saved.get("key_hash") == digest:
        return saved["secret_id"]
    if saved.get("secret_id"):
        await _provider("PATCH", f"/convai/secrets/{saved['secret_id']}", user, db,
                        {"type": "new", "name": f"Rudra Groq {hashlib.sha256(user.id.encode()).hexdigest()[:12]}", "value": key})
        secret_id = saved["secret_id"]
    else:
        data = await _provider("POST", "/convai/secrets", user, db,
                               {"type": "new", "name": f"Rudra Groq {hashlib.sha256(user.id.encode()).hexdigest()[:12]}", "value": key})
        secret_id = data.get("secret_id")
    if not isinstance(secret_id, str) or not ID_RE.fullmatch(secret_id):
        raise HTTPException(502, "ElevenLabs did not return a protected Groq secret")
    _bind(db, user, "groq_secret", account_id, "Groq", {"secret_id": secret_id, "key_hash": digest})
    return secret_id


async def _agent_payload(req, user, db):
    if req.groq_model not in GROQ_MODELS or req.tts_model not in TTS_MODELS:
        raise HTTPException(422, "Choose a supported Groq or ElevenLabs model")
    if not req.name.strip() or not req.instructions.strip() or any(len(word) > 100 for word in req.keywords):
        raise HTTPException(422, "Agent name, instructions and keywords must contain valid text")
    knowledge = []
    for resource_id in req.knowledge_ids:
        row = _owned(db, user, "knowledge", resource_id)
        knowledge.append({"id": resource_id, "name": row.name, "type": json.loads(row.details).get("type", "text"), "usage_mode": "auto"})
    phone_tools = []
    for resource_id in req.tool_ids:
        row = _owned(db, user, "tool", resource_id)
        if json.loads(row.details).get("type") not in ("open_page", "client"):
            phone_tools.append(resource_id)
    secret_id = await _groq_secret(user, db)
    built_in = {}
    for tool_name, enabled in (("end_call", req.end_call), ("language_detection", req.language_detection)):
        built_in[tool_name] = {"type": "system", "name": tool_name, "params": {"system_tool_type": tool_name}} if enabled else None
    return {"name": req.name.strip(), "conversation_config": {
        "asr": {"provider": "scribe_realtime", "quality": "high", "user_input_audio_format": "pcm_16000", "keywords": req.keywords},
        "agent": {"first_message": req.first_message, "language": req.language,
                  "hinglish_mode": req.hinglish_mode and req.language == "hi",
                  "disable_first_message_interruptions": req.disable_first_message_interruptions,
                  "prompt": {"prompt": req.instructions, "llm": "custom-llm", "temperature": req.temperature,
                             "max_tokens": req.max_tokens, "timezone": "Asia/Kolkata", "enable_reasoning_summary": False,
                             "ignore_default_personality": True, "backup_llm_config": {"preference": "disabled"},
                             "custom_llm": {"url": "https://api.groq.com/openai/v1/chat/completions", "model_id": req.groq_model,
                                            "api_type": "chat_completions", "api_key": {"secret_id": secret_id}},
                             "knowledge_base": knowledge, "tool_ids": phone_tools, "built_in_tools": built_in}},
        "tts": {"voice_id": req.voice_id, "model_id": req.tts_model, "stability": req.stability,
                "speed": req.speed, "similarity_boost": req.similarity_boost, "agent_output_audio_format": "pcm_16000"},
        "turn": {"turn_eagerness": req.turn_eagerness, "turn_timeout": req.turn_timeout,
                 "silence_end_call_timeout": req.silence_end_call_timeout, "speculative_turn": req.speculative_turn},
        "conversation": {"max_duration_seconds": req.max_duration_seconds,
                         "client_events": ["conversation_initiation_metadata", "ping", "audio", "interruption", "user_transcript", "agent_response", "agent_response_correction", "client_tool_call", "client_error"]}},
        "platform_settings": {"auth": {"enable_auth": True}, "summary_language": req.language,
                              "overrides": {"custom_llm_extra_body": True, "conversation_config_override": {"agent": {"prompt": {"tool_ids": True}}}},
                              "privacy": {"record_voice": req.record_voice, "retention_days": req.retention_days,
                                          "delete_transcript_and_pii": req.delete_transcript_and_pii},
                              "evaluation": {"criteria": [{"id": "calling_goal", "name": "Calling goal", "type": "prompt",
                                                               "conversation_goal_prompt": req.evaluation_goal}] if req.evaluation_goal else []}}}


def _agent_form(data):
    config = data.get("conversation_config", {})
    agent, tts, turn = config.get("agent", {}), config.get("tts", {}), config.get("turn", {})
    prompt, platform = agent.get("prompt", {}), data.get("platform_settings", {})
    privacy = platform.get("privacy", {})
    result = {"name": data.get("name", "Agent"), "instructions": prompt.get("prompt", ""),
              "first_message": agent.get("first_message", ""), "language": agent.get("language", "hi"),
              "hinglish_mode": agent.get("hinglish_mode", False), "voice_id": tts.get("voice_id", ""),
              "tts_model": tts.get("model_id", "eleven_flash_v2_5"),
              "groq_model": (prompt.get("custom_llm") or {}).get("model_id", "openai/gpt-oss-120b"),
              "knowledge_ids": [item["id"] for item in prompt.get("knowledge_base", [])], "tool_ids": prompt.get("tool_ids", []),
              "keywords": config.get("asr", {}).get("keywords", []),
              "max_duration_seconds": config.get("conversation", {}).get("max_duration_seconds", 600),
              "disable_first_message_interruptions": agent.get("disable_first_message_interruptions", False)}
    for field in ("temperature", "max_tokens"):
        result[field] = prompt.get(field, AgentRequest.model_fields[field].default)
    for field in ("stability", "similarity_boost", "speed"):
        result[field] = tts.get(field, AgentRequest.model_fields[field].default)
    for field in ("turn_eagerness", "turn_timeout", "silence_end_call_timeout", "speculative_turn"):
        result[field] = turn.get(field, AgentRequest.model_fields[field].default)
    for field in ("record_voice", "retention_days", "delete_transcript_and_pii"):
        result[field] = privacy.get(field, AgentRequest.model_fields[field].default)
    criteria = platform.get("evaluation", {}).get("criteria", [])
    result["evaluation_goal"] = next((c.get("conversation_goal_prompt", "") for c in criteria if c.get("id") == "calling_goal"), "")
    for field in ("end_call", "language_detection"):
        result[field] = bool(prompt.get("built_in_tools", {}).get(field))
    return result


def _llm_body(row):
    settings = json.loads(row.details)
    return {"reasoning_effort": settings.get("reasoning_effort", "low"), "include_reasoning": False} if settings.get("groq_model", "").startswith("openai/gpt-oss-") else {}


@router.get("/status")
async def status(db: Session = Depends(get_db), user: UserAccount = Depends(get_current_user)):
    if not get_provider_secret("elevenlabs", user, db):
        return {"connected": False, "groq_connected": bool(get_provider_secret("groq", user, db))}
    data = await _provider("GET", "/user", user, db)
    subscription = data.get("subscription", {})
    from services.developer_control import ProviderAssignment
    assignment = db.query(ProviderAssignment).filter_by(user_id=user.id, provider='elevenlabs').first()
    if assignment and assignment.mode == 'shared':
        return {'connected':True, 'groq_connected':bool(get_provider_secret('groq',user,db)), 'account':{'managed':True, 'basis':'shared provider; see your app usage allowance'}}
    return {"connected": True, "groq_connected": bool(get_provider_secret("groq", user, db)),
            "account": {key: subscription.get(key) for key in ("tier", "status", "character_count", "character_limit", "next_character_count_reset_unix")}}


@router.get("/voices")
async def voices(db: Session = Depends(get_db), user: UserAccount = Depends(get_current_user)):
    data = await _provider("GET", "/voices", user, db)
    return {"voices": [{key: voice.get(key) for key in ("voice_id", "name", "category", "labels")}
                       for voice in data.get("voices", [])[:100]]}


@router.get("/agents")
async def agents(db: Session = Depends(get_db), user: UserAccount = Depends(get_current_user)):
    rows = db.query(ElevenLabsResource).filter_by(kind="agent", owner_user_id=user.id).order_by(ElevenLabsResource.updated_at.desc()).all()
    return {"agents": [{"agent_id": row.resource_id, "name": row.name} for row in rows]}


@router.post("/agents")
async def create_agent(req: AgentRequest, db: Session = Depends(get_db), user: UserAccount = Depends(get_current_user)):
    payload = await _agent_payload(req, user, db)
    data = await _provider("POST", "/convai/agents/create", user, db, payload)
    row = _bind(db, user, "agent", data.get("agent_id"), req.name, {"groq_model": req.groq_model, "reasoning_effort": req.reasoning_effort, "tool_ids": req.tool_ids})
    return {"agent_id": row.resource_id, "name": row.name}


@router.post("/agents/{agent_id}/import")
async def import_agent(agent_id: str, db: Session = Depends(get_db), user: UserAccount = Depends(get_current_user)):
    if not ID_RE.fullmatch(agent_id):
        raise HTTPException(422, "Invalid agent ID")
    from services.developer_control import ProviderAssignment
    assignment = db.query(ProviderAssignment).filter_by(user_id=user.id, provider='elevenlabs').first()
    if assignment and assignment.mode == 'shared':
        raise HTTPException(403, 'Shared account resources must be created in this workspace')
    existing = db.query(ElevenLabsResource).filter_by(kind="agent", resource_id=agent_id).first()
    if existing and existing.owner_user_id != user.id:
        raise HTTPException(404, "Agent not found for this account")
    data = await _provider("GET", f"/convai/agents/{agent_id}", user, db)
    if data.get("agent_id") != agent_id:
        raise HTTPException(502, "ElevenLabs did not verify this agent")
    prompt = data.get("conversation_config", {}).get("agent", {}).get("prompt", {})
    for document in prompt.get("knowledge_base", []):
        _bind(db, user, "knowledge", document.get("id"), document.get("name", "Knowledge"), {"type": document.get("type", "text")})
    for tool_id in prompt.get("tool_ids", []):
        tool = await _provider("GET", f"/convai/tools/{tool_id}", user, db)
        config = tool.get("tool_config", {})
        _bind(db, user, "tool", tool_id, config.get("name", "Tool"), {"type": "open_page" if config.get("name") == "open_page" and config.get("type") == "client" else config.get("type", "webhook")})
    _bind(db, user, "agent", agent_id, data.get("name", "Agent"))
    return {"agent_id": agent_id}


@router.get("/agents/{agent_id}")
async def get_agent(agent_id: str, db: Session = Depends(get_db), user: UserAccount = Depends(get_current_user)):
    _owned(db, user, "agent", agent_id)
    data = await _provider("GET", f"/convai/agents/{agent_id}", user, db)
    form = _agent_form(data)
    row = _owned(db, user, "agent", agent_id)
    form["reasoning_effort"] = json.loads(row.details).get("reasoning_effort", "low")
    form["tool_ids"] = json.loads(row.details).get("tool_ids", form["tool_ids"])
    return {"agent_id": agent_id, "config": form}


@router.patch("/agents/{agent_id}")
async def update_agent(agent_id: str, req: AgentRequest, db: Session = Depends(get_db), user: UserAccount = Depends(get_current_user)):
    row = _owned(db, user, "agent", agent_id)
    payload = await _agent_payload(req, user, db)
    await _provider("PATCH", f"/convai/agents/{agent_id}", user, db, payload)
    row.name, row.updated_at = req.name, time.time()
    row.details = json.dumps({"groq_model": req.groq_model, "reasoning_effort": req.reasoning_effort, "tool_ids": req.tool_ids})
    db.commit()
    return {"agent_id": agent_id, "name": row.name}


@router.post("/agents/{agent_id}/preview")
async def preview(agent_id: str, db: Session = Depends(get_db), user: UserAccount = Depends(get_current_user)):
    row = _owned(db, user, "agent", agent_id)
    from api.limits import consume, finish_usage, fail_usage
    from services.developer_control import reserve_provider
    reservation = consume(db, user, 'voice_sessions', provider='elevenlabs', basis='preview_requested')
    submitted = False
    try:
        reserve_provider(db, user, 'elevenlabs')
        submitted = True
        data = await _provider("GET", f"/convai/conversation/get-signed-url?agent_id={agent_id}&include_conversation_id=true", user, db)
        signed = data.get("signed_url", "") if isinstance(data, dict) else ''
        parsed = urlparse(signed)
        if parsed.scheme != "wss" or parsed.hostname != "api.elevenlabs.io" or parsed.path != "/v1/convai/conversation":
            raise HTTPException(502, "ElevenLabs did not return a valid signed conversation URL")
    except BaseException as exc:
        fail_usage(db, user, 'voice_sessions', reservation, exc, submitted=submitted)
        raise
    finish_usage(db, user, reservation, 'issued', 'preview_url_issued')
    details = json.loads(row.details)
    overrides = {"agent": {"prompt": {"tool_ids": details["tool_ids"]}}} if "tool_ids" in details else {}
    return {"signed_url": signed, "custom_llm_extra_body": _llm_body(row), "conversation_config_override": overrides,
            "allowance_basis": "Issued preview sessions; vendor duration is not hard-capped by the app"}


def _phone_public(data):
    return {key: data.get(key) for key in ("phone_number_id", "phone_number", "label", "provider", "assigned_agent", "supports_outbound", "supports_inbound")}


@router.get("/phones")
async def phones(db: Session = Depends(get_db), user: UserAccount = Depends(get_current_user)):
    data = await _provider("GET", "/convai/phone-numbers", user, db)
    items = data if isinstance(data, list) else data.get("phone_numbers", [])
    output, unavailable = [], 0
    for item in items[:100]:
        if not _bind_listed(db, user, "phone", item["phone_number_id"], item.get("label", "Number"), _phone_public(item)):
            unavailable += 1
            continue
        output.append(_phone_public(item))
    return {"phone_numbers": output, "unavailable_count": unavailable}


@router.post("/phones")
async def import_phone(req: PhoneRequest, db: Session = Depends(get_db), user: UserAccount = Depends(get_current_user)):
    if not E164_RE.fullmatch(req.phone_number):
        raise HTTPException(422, "Use an E.164 phone number, e.g. +919876543210")
    if req.agent_id:
        _owned(db, user, "agent", req.agent_id)
    payload = {"phone_number": req.phone_number, "label": req.label, "provider": req.provider,
               "supports_inbound": req.supports_inbound, "supports_outbound": True}
    if req.agent_id:
        payload["agent_id"] = req.agent_id
    if req.provider == "twilio":
        if not req.sid or not req.token:
            raise HTTPException(422, "Twilio SID and auth token are required")
        payload.update(sid=req.sid, token=req.token)
    elif req.provider == "exotel":
        if not all((req.account_sid, req.api_key, req.api_token, req.app_id)):
            raise HTTPException(422, "Exotel account SID, API key, token and app ID are required")
        payload.update(account_sid=req.account_sid, api_key=req.api_key, api_token=req.api_token, app_id=req.app_id, api_subdomain=req.api_subdomain)
    else:
        if not req.address or not re.fullmatch(r"[A-Za-z0-9.-]+(?::\d{1,5})?", req.address):
            raise HTTPException(422, "Enter your SIP provider's outbound hostname, optionally with its port")
        trunk = {"address": req.address, "transport": req.transport, "media_encryption": req.media_encryption}
        if req.username:
            trunk["credentials"] = {"username": req.username, "password": req.password}
        payload["outbound_trunk_config"] = trunk
        if req.supports_inbound:
            import ipaddress
            if not req.inbound_allowed_addresses:
                raise HTTPException(422, "Add your SIP provider's incoming IP addresses or CIDR ranges before enabling inbound calls")
            try:
                for value in req.inbound_allowed_addresses:
                    if not ipaddress.ip_network(value, strict=False).network_address.is_global:
                        raise ValueError("Not a public source network")
            except ValueError:
                raise HTTPException(422, "Use public IP addresses or CIDR ranges supplied by your SIP provider") from None
            payload["inbound_trunk_config"] = {"allowed_addresses": req.inbound_allowed_addresses, "media_encryption": req.media_encryption}
    data = await _provider("POST", "/convai/phone-numbers", user, db, payload)
    resource_id = data.get("phone_number_id")
    _bind(db, user, "phone", resource_id, req.label, {"provider": req.provider, "phone_number": req.phone_number, "supports_outbound": True})
    return {"phone_number_id": resource_id, "label": req.label, "provider": req.provider}


@router.patch("/phones/{phone_id}/assign")
async def assign_phone(phone_id: str, req: AssignRequest, db: Session = Depends(get_db), user: UserAccount = Depends(get_current_user)):
    _owned(db, user, "phone", phone_id)
    _owned(db, user, "agent", req.agent_id)
    await _provider("PATCH", f"/convai/phone-numbers/{phone_id}", user, db, {"agent_id": req.agent_id})
    return {"phone_number_id": phone_id, "agent_id": req.agent_id, "assigned": True}


@router.post("/calls")
async def call(req: CallRequest, db: Session = Depends(get_db), user: UserAccount = Depends(get_current_user)):
    row = _owned(db, user, "agent", req.agent_id)
    _owned(db, user, "phone", req.phone_number_id)
    if not req.confirmed or not E164_RE.fullmatch(req.to_number):
        raise HTTPException(422, "Confirm the destination and use an E.164 phone number before placing a call")
    if len(req.dynamic_variables) > 20 or any(len(k) > 64 or len(v) > 1000 for k, v in req.dynamic_variables.items()):
        raise HTTPException(422, "Call variables are too large")
    number = await _provider("GET", f"/convai/phone-numbers/{req.phone_number_id}", user, db)
    provider = number.get("provider")
    paths = {"sip_trunk": "sip-trunk", "twilio": "twilio", "exotel": "exotel"}
    if provider not in paths or not number.get("supports_outbound", False):
        raise HTTPException(409, "This number is not provisioned for outbound calls")
    payload = {"agent_id": req.agent_id, "agent_phone_number_id": req.phone_number_id, "to_number": req.to_number}
    payload["conversation_initiation_client_data"] = {"dynamic_variables": req.dynamic_variables, "custom_llm_extra_body": _llm_body(row)}
    from api.limits import consume, refund
    from api.billing import require_calling, record_call
    require_calling(user, db)
    reservation = consume(db, user, 'calls')
    try:
        data = await _provider("POST", f"/convai/{paths[provider]}/outbound-call", user, db, payload)
    except HTTPException as exc:
        if exc.status_code < 500:
            refund(db, user, 'calls', reservation['day'], reservation.get('usage_id'))
        raise
    if data.get("conversation_id"):
        _bind(db, user, "conversation", data["conversation_id"], "Outbound call", {"agent_id": req.agent_id})
    # Accepted does not mean answered or delivered. Return the provider result.
    return {key: data.get(key) for key in ("success", "message", "conversation_id", "callSid", "sip_call_id", "call_id") if key in data}


@router.get("/calling-readiness")
async def calling_readiness(agent_id: str = Query(min_length=1, max_length=160),
                            phone_number_id: str = Query(min_length=1, max_length=160),
                            db: Session = Depends(get_db), user: UserAccount = Depends(get_current_user)):
    _owned(db, user, "agent", agent_id)
    _owned(db, user, "phone", phone_number_id)
    missing = [name for name in ("elevenlabs", "groq") if not get_provider_secret(name, user, db)]
    if missing:
        return {"ready": False, "missing": missing, "message": "Connect ElevenLabs and Groq in Setup before calling."}
    agent = await _provider("GET", f"/convai/agents/{agent_id}", user, db)
    number = await _provider("GET", f"/convai/phone-numbers/{phone_number_id}", user, db)
    if agent.get("agent_id") != agent_id or number.get("phone_number_id") != phone_number_id:
        raise HTTPException(502, "ElevenLabs did not verify the selected agent and phone number")
    ready = number.get("provider") in ("sip_trunk", "twilio", "exotel") and bool(number.get("supports_outbound"))
    duration = (agent.get("conversation_config") or {}).get("conversation", {}).get("max_duration_seconds", 600)
    duration = duration if isinstance(duration, int) and 60 <= duration <= 3600 else 600
    # Readiness verifies configuration, not answer/delivery or provider credit availability.
    return {"ready": ready, "missing": [] if ready else ["outbound_number"],
            "message": "Agent and outbound number verified. Calls use provider credits." if ready else "Provision this number for outbound calls before starting.",
            "agent_id": agent_id, "phone_number_id": phone_number_id, "provider": number.get("provider"),
            "phone_number": number.get("phone_number"), "max_duration_seconds": duration}


def _batch_public(data):
    fields = ("id", "name", "agent_id", "phone_number_id", "phone_provider", "created_at_unix",
              "scheduled_time_unix", "last_updated_at_unix", "status", "total_calls_dispatched",
              "total_calls_scheduled", "total_calls_finished", "target_concurrency_limit")
    result = {key: data.get(key) for key in fields if key in data}
    result["recipients"] = [{key: item.get(key) for key in ("id", "phone_number", "status", "conversation_id", "created_at_unix", "updated_at_unix") if key in item}
                            for item in data.get("recipients", []) if isinstance(item, dict)]
    return result


def _batch_details(row):
    try:
        return json.loads(row.details or "{}")
    except (TypeError, ValueError):
        return {}


def _save_batch(db, row, details):
    row.details = json.dumps(details)
    row.updated_at = time.time()
    db.commit()


def _batch_result(row):
    details = _batch_details(row)
    return {"request_id": row.resource_id, "batch_id": details.get("batch_id"),
            "name": row.name, "status": details.get("status", "unknown"),
            "agent_id": details.get("agent_id"), "phone_number_id": details.get("phone_number_id"),
            "created_at": row.updated_at, "recipients": details.get("recipients", []),
            "provider": details.get("provider", {}), "uncertain": details.get("status") in ("submitting", "unknown")}


def _sync_batch_crm(db, user, details):
    """Only the reviewed account-owned selection can receive provider history."""
    from api.crm import CRMRecord, CRMActivity, _activity
    targets = details.get('crm_targets', {})
    batch_id = details.get('batch_id')
    if not targets or not batch_id:
        return
    for recipient in details.get('recipients', []):
        number = recipient.get('phone_number')
        record_id = targets.get(number)
        record = db.query(CRMRecord).filter_by(id=record_id, owner_user_id=user.id).first() if record_id else None
        if not record:
            continue
        recipient['crm_record_id'] = record.id
        status = str(recipient.get('status') or 'pending')[:40]
        cid = recipient.get('conversation_id')
        if cid and ID_RE.fullmatch(str(cid)):
            bound = db.query(ElevenLabsResource).filter_by(kind='conversation', resource_id=cid).first()
            if not bound or bound.owner_user_id == user.id:
                _bind(db, user, 'conversation', cid, 'Batch call', {'agent_id':details.get('agent_id'),
                    'batch_id':batch_id, 'crm_record_id':record.id, 'phone_number':number})
        key = 'batch-call:' + hashlib.sha256(f'{batch_id}|{record.id}|{status}|{cid or ""}'.encode()).hexdigest()
        if not db.query(CRMActivity).filter_by(owner_user_id=user.id, idempotency_key=key).first():
            _activity(db,user.id,record.id,'call_status',f'ElevenLabs call status: {status}. Number: {number}. Batch: {batch_id}. Conversation: {cid or "not available"}.',
                channel='call',outcome=status,evidence='provider',recipient=number,provider_id=cid or batch_id,idempotency_key=key)
    db.commit()


@router.post("/batch-calls", status_code=201)
async def submit_batch(req: BatchCallRequest, db: Session = Depends(get_db), user: UserAccount = Depends(get_current_user)):
    agent = _owned(db, user, "agent", req.agent_id)
    phone = _owned(db, user, "phone", req.phone_number_id)
    numbers = [item.phone_number for item in req.recipients]
    if not req.confirmed or any(not E164_RE.fullmatch(number) for number in numbers):
        raise HTTPException(422, "Confirm the batch and use an E.164 number for every recipient")
    if len(set(numbers)) != len(numbers):
        raise HTTPException(422, "Remove duplicate phone numbers before submitting this batch")
    crm_targets = {}
    from api.crm import CRMRecord
    for recipient in req.recipients:
        if not recipient.crm_record_id:
            continue
        record = db.query(CRMRecord).filter_by(id=recipient.crm_record_id, owner_user_id=user.id).first()
        if not record:
            raise HTTPException(404, 'Selected CRM lead not found in this account')
        profile = json.loads(record.profile or '{}')
        phones = [re.sub(r'[\s().-]', '', str(profile.get(field) or '')) for field in ('phone','mobile')]
        if profile.get('phoneOptOut'):
            raise HTTPException(409, 'This lead opted out of phone outreach')
        if recipient.phone_number not in phones:
            raise HTTPException(422, 'Destination must match the selected CRM lead')
        crm_targets[recipient.phone_number] = record.id
    if any(len(key) > 64 or len(value) > 1000 for item in req.recipients for key, value in item.dynamic_variables.items()):
        raise HTTPException(422, "Recipient variables are too large")
    if not get_provider_secret("groq", user, db):
        raise HTTPException(409, "Connect Groq in Voice AI Setup before placing calls with this agent.")

    # Verify the owned agent and caller ID before creating a durable idempotency record.
    agent_data = await _provider("GET", f"/convai/agents/{req.agent_id}", user, db)
    phone_data = await _provider("GET", f"/convai/phone-numbers/{req.phone_number_id}", user, db)
    if agent_data.get("agent_id") != req.agent_id or phone_data.get("phone_number_id") != req.phone_number_id:
        raise HTTPException(502, "ElevenLabs did not verify the selected agent and phone number")
    if phone_data.get("provider") not in ("sip_trunk", "twilio", "exotel") or not phone_data.get("supports_outbound"):
        raise HTTPException(409, "This number is not provisioned for outbound calls")

    # Display names may include the current date; idempotency must describe the
    # actual call targets so an unresolved batch cannot become new tomorrow.
    submitted = {"agent_id": req.agent_id, "phone_number_id": req.phone_number_id,
                 "recipients": [item.model_dump(exclude_none=True) for item in req.recipients]}
    signature = hashlib.sha256(json.dumps(submitted, sort_keys=True, separators=(",", ":")).encode()).hexdigest()
    async with _BATCH_SUBMIT_LOCK:
        request_row = db.query(ElevenLabsResource).filter_by(kind="batch_request", resource_id=req.request_id).first()
        if request_row:
            if request_row.owner_user_id != user.id:
                raise _ownership_conflict("batch")
            details = _batch_details(request_row)
            if details.get("signature") != signature:
                raise HTTPException(409, "This batch request ID was already used for a different selection")
            return _batch_result(request_row)
        # ponytail: scan all owner requests to protect old uncertain jobs; add an indexed active-state/signature query if history grows large.
        prior = db.query(ElevenLabsResource).filter_by(kind="batch_request", owner_user_id=user.id).all()
        for previous in prior:
            details = _batch_details(previous)
            if details.get("signature") == signature and details.get("status") in ("submitting", "unknown", "pending", "in_progress"):
                return _batch_result(previous)

        # Claim durably before releasing the lock or calling ElevenLabs. A timeout
        # then has one owner-visible request to reconcile instead of a second POST.
        provider_name = f"{req.call_name.strip()} [ref:{req.request_id}]"[:180]
        details = {"signature": signature, "status": "submitting", "agent_id": agent.resource_id,
                   "phone_number_id": phone.resource_id, "recipients": [{"phone_number": number, "status": "pending"} for number in numbers],
                   "provider": {}, "crm_targets": crm_targets}
        request_row = ElevenLabsResource(kind="batch_request", resource_id=req.request_id, owner_user_id=user.id,
                                         name=provider_name, details=json.dumps(details), updated_at=time.time())
        from api.billing import require_calling, entitlement
        from api.limits import consume
        require_calling(user, db)
        if len(numbers) > entitlement(user, db)['calls_left']:
            raise HTTPException(429, 'This batch exceeds your remaining call allowance')
        reservation = consume(db, user, 'calls', len(numbers), request_id=req.request_id)
        details['usage_id'] = reservation.get('usage_id')
        request_row.details = json.dumps(details)
        db.add(request_row)
        try:
            db.commit()
        except IntegrityError:
            db.rollback()
            existing = db.query(ElevenLabsResource).filter_by(kind="batch_request", resource_id=req.request_id, owner_user_id=user.id).first()
            if existing and _batch_details(existing).get("signature") == signature:
                return _batch_result(existing)
            raise HTTPException(409, "This batch request is already being submitted") from None

    payload = {"call_name": provider_name, "agent_id": agent.resource_id,
               "agent_phone_number_id": phone.resource_id, "target_concurrency_limit": 1,
               "recipients": [{"phone_number": item.phone_number,
                               "conversation_initiation_client_data": {"dynamic_variables": item.dynamic_variables}}
                              for item in req.recipients]}
    try:
        data = await _provider("POST", "/convai/batch-calling/submit", user, db, payload)
    except HTTPException as error:
        # A provider 4xx is a known rejection and can be retried with a fresh ID.
        # 5xx and transport failures remain uncertain because the POST may have landed.
        details["status"] = "failed" if error.status_code < 500 else "unknown"
        _save_batch(db, request_row, details)
        raise
    except Exception:
        details["status"] = "unknown"
        _save_batch(db, request_row, details)
        raise
    batch_id = data.get("id")
    if not batch_id:
        details["status"] = "unknown"
        _save_batch(db, request_row, details)
        raise HTTPException(502, "ElevenLabs returned no batch ID; refresh status before creating another batch")
    public = _batch_public(data)
    details.update(batch_id=batch_id, status=public.get("status", "pending"), provider=public,
                   recipients=public.get("recipients") or details["recipients"])
    _sync_batch_crm(db,user,details)
    _save_batch(db, request_row, details)
    _bind(db, user, "batch", batch_id, provider_name, public)
    return _batch_result(request_row)


@router.get("/batch-calls")
async def batch_calls(db: Session = Depends(get_db), user: UserAccount = Depends(get_current_user)):
    rows = db.query(ElevenLabsResource).filter_by(kind="batch_request", owner_user_id=user.id).order_by(ElevenLabsResource.updated_at.desc()).limit(100).all()
    return {"batch_calls": [_batch_result(row) for row in rows]}


@router.get("/batch-calls/{batch_id}")
async def batch_call(batch_id: str, db: Session = Depends(get_db), user: UserAccount = Depends(get_current_user)):
    if not ID_RE.fullmatch(batch_id):
        raise HTTPException(404, "Batch not found")
    request_row = db.query(ElevenLabsResource).filter_by(kind="batch_request", resource_id=batch_id, owner_user_id=user.id).first()
    native_id_lookup = request_row is None
    if not request_row:
        _owned(db,user,'batch',batch_id)
        request_row = next((row for row in db.query(ElevenLabsResource).filter_by(kind='batch_request',owner_user_id=user.id)
            if _batch_details(row).get('batch_id') == batch_id), None)
    if request_row:
        details = _batch_details(request_row)
        provider_id = details.get("batch_id")
        if not provider_id:
            # Reconcile a timed-out POST by its unique provider-visible reference. Never resubmit it.
            query = f"/convai/batch-calling/workspace?limit=100&agent_id={details.get('agent_id', '')}"
            try:
                listing = await _provider("GET", query, user, db)
                matches = [item for item in listing.get("batch_calls", []) if item.get("name") == request_row.name]
                if len(matches) == 1 and matches[0].get("id"):
                    provider_id = matches[0]["id"]
                    details["batch_id"] = provider_id
                    details["status"] = matches[0].get("status", "unknown")
                elif len(matches) > 1:
                    details["status"] = "unknown"
                    details["reconciliation"] = "Multiple provider jobs matched; inspect ElevenLabs workspace before retrying."
            except HTTPException:
                raise
            if not provider_id:
                _save_batch(db, request_row, details)
                return _batch_result(request_row)
        batch_id = provider_id
    else:
        _owned(db, user, "batch", batch_id)
    if not request_row:
        _owned(db, user, "batch", batch_id)
    data = await _provider("GET", f"/convai/batch-calling/{batch_id}", user, db)
    if data.get("id") != batch_id:
        raise HTTPException(502, "ElevenLabs did not verify this batch")
    public = _batch_public(data)
    row = _bind(db, user, "batch", batch_id, data.get("name", "Calling batch"), public)
    if request_row:
        details = _batch_details(request_row)
        details.update(batch_id=batch_id, status=public.get("status", details.get("status", "unknown")),
                       provider=public, recipients=public.get("recipients") or details.get("recipients", []))
        _sync_batch_crm(db,user,details)
        _save_batch(db, request_row, details)
        if native_id_lookup:
            return {"request_id": None, "batch_id": row.resource_id, "name": row.name, **public, "uncertain": False}
        return _batch_result(request_row)
    return {"request_id": None, "batch_id": row.resource_id, "name": row.name, **public, "uncertain": False}


@router.post("/batch-calls/{batch_id}/cancel")
async def cancel_batch(batch_id: str, db: Session = Depends(get_db), user: UserAccount = Depends(get_current_user)):
    row = _owned(db, user, "batch", batch_id)
    data = await _provider("POST", f"/convai/batch-calling/{batch_id}/cancel", user, db, {})
    updated = await _provider("GET", f"/convai/batch-calling/{batch_id}", user, db)
    if updated.get("id") != batch_id:
        raise HTTPException(502, "ElevenLabs did not verify the cancelled batch status")
    public = _batch_public(updated)
    _bind(db, user, "batch", batch_id, updated.get("name", row.name), public)
    request_rows = db.query(ElevenLabsResource).filter_by(kind="batch_request", owner_user_id=user.id).all()
    for request_row in request_rows:
        details = _batch_details(request_row)
        if details.get("batch_id") == batch_id:
            details.update(status=public.get("status", details.get("status", "unknown")), provider=public,
                           recipients=public.get("recipients") or details.get("recipients", []))
            _sync_batch_crm(db,user,details)
            _save_batch(db, request_row, details)
            break
    return {"batch_id": batch_id, "cancel": _batch_public(data) if isinstance(data, dict) else {}, **public, "uncertain": False}


@router.get("/agents/{agent_id}/conversations")
async def conversations(agent_id: str, cursor: str = Query(default="", max_length=500), db: Session = Depends(get_db), user: UserAccount = Depends(get_current_user)):
    _owned(db, user, "agent", agent_id)
    from urllib.parse import urlencode
    query = urlencode({"agent_id": agent_id, "page_size": 20, **({"cursor": cursor} if cursor else {})})
    data = await _provider("GET", "/convai/conversations?" + query, user, db)
    rows, unavailable = [], 0
    for item in data.get("conversations", []):
        if item.get("agent_id") != agent_id:
            continue
        if not _bind_listed(db, user, "conversation", item["conversation_id"], "Conversation", {"agent_id": agent_id}):
            unavailable += 1
            continue
        rows.append({key: item.get(key) for key in ("conversation_id", "agent_id", "start_time_unix_secs", "call_duration_secs", "status", "call_successful", "transcript_summary", "call_summary_title")})
    return {"conversations": rows, "next_cursor": data.get("next_cursor"), "has_more": data.get("has_more", False), "unavailable_count": unavailable}


async def _conversation(conversation_id, user, db):
    _owned(db, user, "conversation", conversation_id)
    data = await _provider("GET", f"/convai/conversations/{conversation_id}", user, db)
    if data.get('conversation_id') != conversation_id:
        raise HTTPException(502, 'Provider returned a different conversation')
    _owned(db, user, "agent", data.get("agent_id", ""))
    duration = (data.get('metadata') or {}).get('call_duration_secs')
    if isinstance(duration, (int, float)) and duration >= 0:
        from services.developer_control import reported_usage
        reported_usage(db, user, 'call_seconds', duration, 'elevenlabs', 'conversation:' + conversation_id)
    return data


@router.get("/conversations/{conversation_id}")
async def conversation(conversation_id: str, db: Session = Depends(get_db), user: UserAccount = Depends(get_current_user)):
    data = await _conversation(conversation_id, user, db)
    binding = _batch_details(_owned(db,user,'conversation',conversation_id))
    if binding.get('crm_record_id') and data.get('status') in ('done','failed'):
        from api.crm import CRMRecord, CRMActivity, _activity
        record = db.query(CRMRecord).filter_by(id=binding['crm_record_id'],owner_user_id=user.id).first()
        if record and binding.get('agent_id') == data.get('agent_id'):
            transcript = '\n'.join(f"{item.get('role','speaker')}: {item.get('message','')}" for item in (data.get('transcript') or []) if isinstance(item,dict))[:10000]
            summary = str((data.get('analysis') or {}).get('transcript_summary') or '')[:1500]
            note = f'Provider call transcript ({conversation_id})\n{transcript}\nSummary: {summary}'
            key = 'call-transcript:' + hashlib.sha256((conversation_id+'|'+note).encode()).hexdigest()
            if not db.query(CRMActivity).filter_by(owner_user_id=user.id,idempotency_key=key).first():
                _activity(db,user.id,record.id,'call_transcript',note,channel='call',outcome=data.get('status'),
                    evidence='provider',provider_id=conversation_id,recipient=binding.get('phone_number'),idempotency_key=key)
                db.commit()
    return {key: data.get(key) for key in ("conversation_id", "agent_id", "status", "transcript", "metadata", "analysis", "has_audio")}


async def batch_history_worker():
    """Read existing jobs only; never submit or retry an outbound call."""
    from api.auth_sync import SessionLocal
    import logging
    while True:
        try:
            with SessionLocal() as db:
                # ponytail: JSON state scan; add an indexed status column if batch history grows large.
                rows = db.query(ElevenLabsResource).filter_by(kind='batch_request').order_by(ElevenLabsResource.updated_at).yield_per(100)
                active = []
                for row in rows:
                    details = _batch_details(row)
                    transcripts_pending = bool(details.get('crm_targets')) and any(
                        item.get('conversation_id') and item['conversation_id'] not in details.get('transcripts_saved', [])
                        for item in details.get('recipients', []))
                    if details.get('status') in ('pending','in_progress','submitting','unknown') or transcripts_pending:
                        active.append(row)
                        if len(active) == 5: break
                for row in active:
                    user = db.query(UserAccount).filter_by(id=row.owner_user_id).first()
                    if user:
                        try:
                            from services.developer_control import check_access, audit
                            try:
                                check_access(db,user,'calls')
                            except HTTPException:
                                bid = _batch_details(row).get('batch_id')
                                if bid:
                                    user._control_cancel = True
                                    try:
                                        await cancel_batch(bid,db,user)
                                        audit(db,user,user.id,'batch.access.cancel.requested',{'batch_id':bid})
                                    finally:
                                        user._control_cancel = False
                                    db.commit()
                                continue
                            await batch_call(row.resource_id,db,user)
                            details = _batch_details(row)
                            saved = details.setdefault('transcripts_saved', [])
                            pending = [item.get('conversation_id') for item in details.get('recipients', [])
                                if item.get('crm_record_id') and item.get('conversation_id') and item['conversation_id'] not in saved][:2]
                            for cid in pending:
                                result = await conversation(cid,db,user)
                                if result.get('status') in ('done','failed'):
                                    saved.append(cid)
                            _save_batch(db,row,details)
                        except asyncio.CancelledError: raise
                        except Exception:
                            db.rollback(); row.updated_at=time.time(); db.commit()
                            logging.getLogger(__name__).warning('Calling history refresh unavailable')
        except asyncio.CancelledError: raise
        except Exception: logging.getLogger(__name__).warning('Calling history worker pass unavailable')
        await asyncio.sleep(30)


@router.post("/conversations/{conversation_id}/verify-call")
async def verify_call(conversation_id: str, req: VerifyCallRequest, db: Session = Depends(get_db), user: UserAccount = Depends(get_current_user)):
    _owned(db, user, "agent", req.agent_id)
    data = await _conversation(conversation_id, user, db)
    metadata = data.get("metadata") or {}
    phone = metadata.get("phone_call") or {}
    started = metadata.get("start_time_unix_secs")
    destination = phone.get("external_number") or phone.get("to_number")
    if (data.get("agent_id") != req.agent_id or data.get("status") not in ("done", "failed")
            or destination != req.to_number or not isinstance(started, (int, float))
            or abs(started - req.started_at) > 300):
        raise HTTPException(409, "This conversation does not match a finished call to this contact. Review provider history before skipping it.")
    return {"verified": True, "conversation": {key: data.get(key) for key in
            ("conversation_id", "agent_id", "status", "transcript", "metadata", "analysis", "has_audio")}}


@router.get("/conversations/{conversation_id}/audio")
async def conversation_audio(conversation_id: str, db: Session = Depends(get_db), user: UserAccount = Depends(get_current_user)):
    await _conversation(conversation_id, user, db)
    audio = await _provider("GET", f"/convai/conversations/{conversation_id}/audio", user, db, binary=True)
    return Response(audio, media_type="audio/mpeg", headers={"Cache-Control": "no-store"})


@router.get("/knowledge")
async def knowledge(db: Session = Depends(get_db), user: UserAccount = Depends(get_current_user)):
    rows = db.query(ElevenLabsResource).filter_by(kind="knowledge", owner_user_id=user.id).order_by(ElevenLabsResource.updated_at.desc()).all()
    return {"documents": [{"id": row.resource_id, "name": row.name, **{key: json.loads(row.details).get(key) for key in
                                                                    ("type", "url", "characters", "size_bytes")}} for row in rows]}


@router.post("/knowledge")
async def create_knowledge(req: KnowledgeRequest, db: Session = Depends(get_db), user: UserAccount = Depends(get_current_user)):
    if not req.name.strip():
        raise HTTPException(422, "Give this source a name")
    if bool(req.text.strip()) == bool(req.url.strip()):
        raise HTTPException(422, "Provide either document text or a public website URL")
    kind = "url" if req.url.strip() else "text"
    payload = {"name": req.name.strip(), kind: _public_url(req.url.strip()) if req.url else req.text.strip()}
    data = await _provider("POST", f"/convai/knowledge-base/{kind}", user, db, payload)
    details = {"type": kind, "url": req.url.strip() if kind == "url" else None,
               "characters": len(req.text.strip()) if kind == "text" else None,
               "size_bytes": len(req.text.strip().encode()) if kind == "text" else None}
    row = _bind(db, user, "knowledge", data.get("id"), req.name.strip(), details)
    return {"id": row.resource_id, "name": row.name, **details}


class _SourceText(HTMLParser):
    """Provider document HTML is display data, never executable UI markup."""
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.parts, self.hidden = [], 0

    def handle_starttag(self, tag, attrs):
        if tag in ("script", "style"):
            self.hidden += 1
        elif tag in ("p", "div", "br", "li", "h1", "h2", "h3", "tr"):
            self.parts.append("\n")

    def handle_endtag(self, tag):
        if tag in ("script", "style"):
            self.hidden = max(0, self.hidden - 1)
        elif tag in ("p", "div", "li", "h1", "h2", "h3", "tr"):
            self.parts.append("\n")

    def handle_data(self, data):
        if not self.hidden:
            self.parts.append(data)


@router.get("/knowledge/{document_id}/content")
async def knowledge_content(document_id: str, db: Session = Depends(get_db), user: UserAccount = Depends(get_current_user)):
    row = _owned(db, user, "knowledge", document_id)
    # The documented detail response includes extracted_inner_html for text,
    # URL and file sources. Returning plain text keeps provider HTML inert.
    data = await _provider("GET", f"/convai/knowledge-base/{document_id}", user, db)
    if data.get("id") != document_id or data.get("type") not in ("text", "url", "file"):
        raise HTTPException(502, "ElevenLabs could not return this source")
    content = data.get("extracted_inner_html", "")
    if not isinstance(content, str):
        raise HTTPException(502, "ElevenLabs returned an unreadable source")
    truncated = len(content) > 200_000
    content = content[:200_000]
    if data.get("content_format", "html") == "html":
        parser = _SourceText()
        parser.feed(content)
        content = re.sub(r"\n[ \t]*\n+", "\n\n", "".join(parser.parts)).strip()
    details = {"type": data["type"], "url": data.get("url"), "characters": len(content),
               "size_bytes": (data.get("metadata") or {}).get("size_bytes")}
    _bind(db, user, "knowledge", document_id, data.get("name") or row.name, details)
    return {"id": document_id, "name": row.name, **details, "text": content[:30_000],
            "truncated": truncated or len(content) > 30_000, "ready": bool(content.strip())}


@router.get("/tools")
async def tools(db: Session = Depends(get_db), user: UserAccount = Depends(get_current_user)):
    rows = db.query(ElevenLabsResource).filter_by(kind="tool", owner_user_id=user.id).all()
    return {"tools": [{"id": row.resource_id, "name": row.name, **json.loads(row.details)} for row in rows]}


@router.post("/tools")
async def create_tool(req: ToolRequest, db: Session = Depends(get_db), user: UserAccount = Depends(get_current_user)):
    if req.type == "open_page":
        existing = db.query(ElevenLabsResource).filter_by(kind="tool", owner_user_id=user.id, name="open_page").all()
        for row in existing:
            if json.loads(row.details).get("type") == "open_page":
                return {"id": row.resource_id, "name": row.name, "type": "open_page"}
        config = {"type": "client", "name": "open_page", "description": req.description, "expects_response": True,
                  "parameters": {"type": "object", "required": ["page"], "properties": {
                      "page": {"type": "string", "description": "App page to open", "enum": ["leads", "crm", "jarvis", "calling", "settings"]}}}}
    else:
        config = {"type": "webhook", "name": req.name, "description": req.description,
                  "response_timeout_secs": 15, "api_schema": {"url": _public_url(req.url), "method": "GET"}}
    data = await _provider("POST", "/convai/tools", user, db, {"tool_config": config})
    row = _bind(db, user, "tool", data.get("id"), config["name"], {"type": req.type})
    return {"id": row.resource_id, "name": row.name, "type": req.type}


# ── Rudra voice assistant (in-app voice mode) ─────────────────────────────
# One ElevenLabs agent per app account does hearing (Scribe), speaking and
# barge-in; the brain is the owner's Groq key, called by ElevenLabs as a
# custom LLM through a protected workspace secret (never reaches the browser). The browser sends the persona
# and its client-tool list; this keeps the agent + workspace tools in sync by
# hash, so a normal start is a single signed-URL request.
GROQ_URL = "https://api.groq.com/openai/v1/chat/completions"
ASSISTANT_TTS = "eleven_flash_v2_5"
ASSISTANT_EVENTS = ["conversation_initiation_metadata", "ping", "audio", "interruption", "user_transcript",
                    "tentative_user_transcript", "agent_response", "agent_response_correction", "client_tool_call", "client_error"]
_ASSISTANT_LOCKS: dict[str, asyncio.Lock] = {}


class AssistantTool(StrictRequest):
    name: str = Field(min_length=1, max_length=64, pattern=r"^[A-Za-z_][A-Za-z0-9_]*$")
    description: str = Field(min_length=1, max_length=1500)
    parameters: dict = Field(default_factory=dict)


class AssistantRequest(StrictRequest):
    persona: str = Field(min_length=50, max_length=40000)
    tools: list[AssistantTool] = Field(default_factory=list, max_length=64)
    voice_id: str = Field(default="", max_length=160)
    keywords: list[str] = Field(default_factory=list, max_length=30)
    groq_model: str = "openai/gpt-oss-120b"


def _assistant_params(schema):
    """Client-tool parameters as ElevenLabs accepts them: an object whose every
    property carries a type and a description. Empty -> no parameters at all."""
    if not isinstance(schema, dict) or not isinstance(schema.get("properties"), dict) or not schema["properties"]:
        return None
    if len(json.dumps(schema)) > 8000:
        raise HTTPException(422, "Tool parameter schema is too large")

    def prop(name, value):
        value = value if isinstance(value, dict) else {}
        kind = value.get("type") if value.get("type") in ("string", "number", "integer", "boolean", "array") else "string"
        out = {"type": kind, "description": str(value.get("description") or name)[:500]}
        if kind == "array":
            item = value.get("items") if isinstance(value.get("items"), dict) else {}
            out["items"] = {"type": item.get("type") if item.get("type") in ("string", "number", "integer", "boolean") else "string",
                            "description": str(item.get("description") or name)[:200]}
        return out

    props = {str(k)[:64]: prop(str(k), v) for k, v in schema["properties"].items()}
    required = [r for r in schema.get("required", []) if r in props] if isinstance(schema.get("required"), list) else []
    return {"type": "object", "properties": props, "required": required}


def _assistant_tool_config(tool):
    config = {"type": "client", "name": tool.name, "description": tool.description,
              "expects_response": True, "response_timeout_secs": 30}
    params = _assistant_params(tool.parameters)
    if params:
        config["parameters"] = params
    return config


def _assistant_agent_payload(req, secret_id, tool_ids):
    keywords = [w.strip()[:100] for w in req.keywords if isinstance(w, str) and w.strip()][:30]
    return {"name": "Rudra voice assistant", "conversation_config": {
        "asr": {"provider": "scribe_realtime", "quality": "high", "user_input_audio_format": "pcm_16000", "keywords": keywords},
        "agent": {"first_message": "", "language": "hi", "hinglish_mode": True, "disable_first_message_interruptions": False,
                  "prompt": {"prompt": req.persona, "llm": "custom-llm", "temperature": 0.5, "max_tokens": 1500,
                             "timezone": "Asia/Kolkata", "ignore_default_personality": True, "tool_ids": tool_ids,
                             "enable_reasoning_summary": False, "backup_llm_config": {"preference": "disabled"},
                             "custom_llm": {"url": GROQ_URL, "model_id": req.groq_model, "api_type": "chat_completions",
                                            "api_key": {"secret_id": secret_id}}}},
        "tts": {"voice_id": req.voice_id or "JBFqnCBsd6RMkjVDRZzb", "model_id": ASSISTANT_TTS, "stability": 0.5,
                "similarity_boost": 0.8, "speed": 1.0, "agent_output_audio_format": "pcm_24000"},
        # speculative_turn starts thinking during his pause = faster replies.
        # turn_timeout is long so it never nags "aap wahan hain?" in silence.
        "turn": {"turn_eagerness": "normal", "turn_timeout": 60, "speculative_turn": True, "turn_model": "turn_v3"},
        "conversation": {"max_duration_seconds": 1800, "client_events": ASSISTANT_EVENTS,
                         "file_input": {"enabled": True, "max_files_in_memory": 2, "max_files_per_conversation": 30}}},
        "platform_settings": {"auth": {"enable_auth": True}, "overrides": {"custom_llm_extra_body": True},
                              "privacy": {"record_voice": False, "retention_days": 7, "delete_transcript_and_pii": False}}}


def _assistant_llm_body(model):
    # gpt-oss thinks inside its token budget: keep it short for voice speed.
    return {"reasoning_effort": "low", "include_reasoning": False} if model.startswith("openai/gpt-oss-") else {}


def _digest(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True).encode()).hexdigest()


async def _xi(client, key, method, path, payload=None):
    response = await client.request(method, BASE_URL + path, headers={"xi-api-key": key}, json=payload)
    _check_response(response)
    return response.json() if response.content else {}


async def _sync_assistant(req, user, db):
    """Create or update the account's assistant agent; returns its agent_id."""
    from services.developer_control import reserve_provider
    if req.groq_model not in GROQ_MODELS:
        raise HTTPException(422, "Choose a supported Groq model")
    secret_id = await _groq_secret(user, db)            # 409 when no Groq key; also access check
    key = get_provider_secret("elevenlabs", user, db)
    row = db.query(ElevenLabsResource).filter_by(kind="assistant", owner_user_id=user.id).first()
    saved = json.loads(row.details) if row else {}
    configs = {tool.name: _assistant_tool_config(tool) for tool in req.tools}
    want = _digest({"tools": configs, "persona": req.persona, "voice": req.voice_id, "keywords": req.keywords,
                    "groq": [req.groq_model, secret_id], "v": 3})
    if row and saved.get("hash") == want:
        return row.resource_id
    reserve_provider(db, user, "elevenlabs")
    tools = dict(saved.get("tools") or {})
    sem = asyncio.Semaphore(6)
    async with httpx.AsyncClient(timeout=30) as client:
        async def sync_tool(name, config):
            digest = _digest(config)
            known = tools.get(name) or {}
            if known.get("id") and known.get("hash") == digest:
                return
            async with sem:
                if known.get("id"):
                    try:
                        await _xi(client, key, "PATCH", f"/convai/tools/{known['id']}", {"tool_config": config})
                        tools[name] = {"id": known["id"], "hash": digest}
                        return
                    except HTTPException as error:
                        if error.status_code != 404:
                            raise
                data = await _xi(client, key, "POST", "/convai/tools", {"tool_config": config})
            if not isinstance(data.get("id"), str) or not ID_RE.fullmatch(data["id"]):
                raise HTTPException(502, "ElevenLabs did not return a tool ID")
            tools[name] = {"id": data["id"], "hash": digest}

        await asyncio.gather(*(sync_tool(name, config) for name, config in configs.items()))
        tool_ids = [tools[name]["id"] for name in configs]
        payload = _assistant_agent_payload(req, secret_id, tool_ids)
        agent_id = row.resource_id if row else None
        if agent_id:
            try:
                await _xi(client, key, "PATCH", f"/convai/agents/{agent_id}", payload)
            except HTTPException as error:
                if error.status_code != 404:
                    raise
                db.delete(row); db.commit(); row = agent_id = None
        if not agent_id:
            data = await _xi(client, key, "POST", "/convai/agents/create", payload)
            agent_id = data.get("agent_id")
    details = {"hash": want, "tools": {name: tools[name] for name in configs}, "groq_model": req.groq_model}
    if row:
        row.details, row.updated_at = json.dumps(details), time.time()
        db.commit()
    else:
        _bind(db, user, "assistant", agent_id, "Rudra voice assistant", details)
    return agent_id


@router.post("/assistant/session")
async def assistant_session(req: AssistantRequest, db: Session = Depends(get_db), user: UserAccount = Depends(get_current_user)):
    if not get_provider_secret("elevenlabs", user, db):
        raise HTTPException(409, {"code": "ELEVENLABS_KEY_MISSING", "message": "Connect your ElevenLabs API key in Setup first."})
    from api.limits import consume, finish_usage, fail_usage
    reservation = consume(db, user, 'voice_sessions', provider='elevenlabs', basis='assistant_session')
    submitted = False
    try:
        lock = _ASSISTANT_LOCKS.setdefault(user.id, asyncio.Lock())
        async with lock:   # two quick taps must not create two agents
            agent_id = await _sync_assistant(req, user, db)
        submitted = True
        try:
            data = await _provider("GET", f"/convai/conversation/get-signed-url?agent_id={agent_id}", user, db)
        except HTTPException as error:
            if error.status_code != 404:
                raise
            stale = db.query(ElevenLabsResource).filter_by(kind="assistant", owner_user_id=user.id).first()
            if stale:
                db.delete(stale); db.commit()
            async with lock:
                agent_id = await _sync_assistant(req, user, db)
            data = await _provider("GET", f"/convai/conversation/get-signed-url?agent_id={agent_id}", user, db)
        signed = data.get("signed_url", "") if isinstance(data, dict) else ""
        parsed = urlparse(signed)
        if parsed.scheme != "wss" or parsed.hostname != "api.elevenlabs.io" or parsed.path != "/v1/convai/conversation":
            raise HTTPException(502, "ElevenLabs did not return a valid signed conversation URL")
    except BaseException as exc:
        fail_usage(db, user, 'voice_sessions', reservation, exc, submitted=submitted)
        raise
    finish_usage(db, user, reservation, 'issued', 'assistant_session_issued')
    return Response(json.dumps({"signed_url": signed, "agent_id": agent_id, "custom_llm_extra_body": _assistant_llm_body(req.groq_model)}),
                    media_type="application/json",
                    headers={"Cache-Control": "no-store"})


class AssistantImage(StrictRequest):
    image_b64: str = Field(min_length=100, max_length=6_000_000)


@router.post("/assistant/conversations/{conversation_id}/image")
async def assistant_image(conversation_id: str, req: AssistantImage, db: Session = Depends(get_db),
                          user: UserAccount = Depends(get_current_user)):
    """Screen vision for the voice agent: upload one JPEG to the live
    conversation and hand back the file_id the browser references."""
    if not ID_RE.fullmatch(conversation_id):
        raise HTTPException(422, "Invalid conversation ID")
    if not db.query(ElevenLabsResource).filter_by(kind="assistant", owner_user_id=user.id).first():
        raise HTTPException(404, "Start a voice session first")
    import base64, binascii
    try:
        image = base64.b64decode(req.image_b64, validate=True)
    except (binascii.Error, ValueError):
        raise HTTPException(422, "Image is not valid base64") from None
    if not image.startswith(b"\xff\xd8"):
        raise HTTPException(422, "Only JPEG screenshots are accepted")
    await _provider("GET", "/user", user, db)          # access check + account claim
    key = get_provider_secret("elevenlabs", user, db)
    try:
        async with httpx.AsyncClient(timeout=30) as client:
            response = await client.post(f"{BASE_URL}/convai/conversations/{conversation_id}/files", headers={"xi-api-key": key},
                                         files={"file": ("screen.jpg", image, "image/jpeg")})
    except httpx.HTTPError:
        raise HTTPException(502, "ElevenLabs could not be reached. Check connectivity and try again.") from None
    _check_response(response)
    file_id = (response.json() if response.content else {}).get("file_id")
    if not isinstance(file_id, str) or not ID_RE.fullmatch(file_id):
        raise HTTPException(502, "ElevenLabs did not return a file ID")
    return {"file_id": file_id}
