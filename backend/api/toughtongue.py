"""Tenant-scoped Tough Tongue scenario studio and calling proxy."""
import re
import time

import httpx
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import Column, Float, String
from sqlalchemy.orm import Session

from api.auth_sync import AUTO_CREATE_SCHEMA, Base, UserAccount, engine, get_current_user, get_db
from api.credentials import get_provider_secret

router = APIRouter(prefix="/api/v1/toughtongue", tags=["toughtongue"])
BASE_URL = "https://app.toughtongueai.com/api/public"
ID_RE = re.compile(r"^[a-fA-F0-9]{24}$")
SCENARIO_FIELDS = {
    "name", "type", "description", "user_friendly_description", "ai_instructions",
    "user_instructions", "rubrik", "is_public", "is_recording", "recording_mode",
    "passcode", "analysis_access", "appearance", "session_analysis", "strategy",
    "ai_model_config", "memory", "tools_config", "knowledge_base_ids", "custom_function_ids", "pre_connect",
    "user_metadata",
}
FORBIDDEN_FIELDS = {"id", "owner_id", "owner_user_id", "user_id", "org_id", "organization_id",
                    "created_at", "updated_at", "version_id", "created_by", "is_featured"}


class VoiceScenario(Base):
    __tablename__ = "toughtongue_scenarios"
    scenario_id = Column(String(64), primary_key=True)
    owner_user_id = Column(String(64), index=True, nullable=False)
    name = Column(String(255), nullable=False)
    updated_at = Column(Float, default=time.time)


if AUTO_CREATE_SCHEMA:
    Base.metadata.create_all(bind=engine)


class ScenarioRequest(BaseModel):
    config: dict = Field(default_factory=dict)


class GenerateRequest(BaseModel):
    name: str = Field(min_length=3, max_length=120)
    context: str = Field(min_length=10, max_length=5000)


class CallRequest(BaseModel):
    scenario_id: str
    sip_trunk_id: str = Field(min_length=1, max_length=128)
    phone_number: str = Field(min_length=8, max_length=16)
    user_name: str = Field(default="", max_length=120)
    dynamic_vars: dict[str, str] = Field(default_factory=dict)


def _owned(db: Session, user: UserAccount, scenario_id: str) -> VoiceScenario:
    if not ID_RE.fullmatch(scenario_id):
        raise HTTPException(404, "Agent not found")
    row = db.query(VoiceScenario).filter_by(scenario_id=scenario_id, owner_user_id=user.id).first()
    if not row:
        raise HTTPException(404, "Agent not found")
    return row


def _config(config: dict) -> dict:
    if len(str(config)) > 100_000 or set(config) & FORBIDDEN_FIELDS:
        raise HTTPException(422, "Unsupported or oversized scenario configuration")
    name, instructions = config.get("name"), config.get("ai_instructions")
    if not isinstance(name, str) or not name.strip() or len(name) > 120 or not isinstance(instructions, str) or not instructions.strip() or len(instructions) > 50_000:
        raise HTTPException(422, "Agent name and AI instructions are required")
    return config


async def _provider(method: str, path: str, user: UserAccount, db: Session, payload=None):
    token = get_provider_secret("toughtongue", user, db)
    if not token:
        raise HTTPException(409, "Connect a Tough Tongue API key first")
    try:
        async with httpx.AsyncClient(timeout=20.0) as client:
            response = await client.request(method, BASE_URL + path,
                headers={"Authorization": f"Bearer {token}"}, json=payload)
        if response.status_code in (401, 403):
            raise HTTPException(422, "Tough Tongue rejected this API key or access")
        if response.status_code == 429:
            raise HTTPException(429, "Tough Tongue rate limit reached")
        if response.status_code >= 400:
            raise HTTPException(502, f"Tough Tongue request failed ({response.status_code})")
        return response.json()
    except HTTPException:
        raise
    except (httpx.HTTPError, ValueError):
        raise HTTPException(502, "Tough Tongue is unavailable") from None


@router.get("/status")
async def status(db: Session = Depends(get_db), user: UserAccount = Depends(get_current_user)):
    return {"connected": bool(get_provider_secret("toughtongue", user, db))}


@router.get("/scenarios")
async def scenarios(db: Session = Depends(get_db), user: UserAccount = Depends(get_current_user)):
    rows = db.query(VoiceScenario).filter_by(owner_user_id=user.id).order_by(VoiceScenario.updated_at.desc()).all()
    return {"scenarios": [{"id": row.scenario_id, "name": row.name} for row in rows]}


@router.post("/generate")
async def generate(req: GenerateRequest, db: Session = Depends(get_db), user: UserAccount = Depends(get_current_user)):
    data = await _provider("POST", "/v2/scenario/generate-advanced", user, db, {
        "name": req.name,
        "context": "Create an autonomous voice agent for inbound or outbound business calls. " + req.context,
    })
    if not isinstance(data, dict) or not isinstance(data.get("instructions"), str):
        raise HTTPException(502, "Tough Tongue did not return agent instructions")
    return {"name": req.name, "ai_instructions": data["instructions"],
            "user_friendly_description": data.get("user_friendly_description") or "",
            "user_instructions": data.get("user_instructions") or ""}


@router.post("/scenarios")
async def create_scenario(req: ScenarioRequest, db: Session = Depends(get_db), user: UserAccount = Depends(get_current_user)):
    config = _config(req.config)
    result = await _provider("POST", "/scenarios", user, db, config)
    scenario_id = result.get("id") if isinstance(result, dict) else None
    if not isinstance(scenario_id, str) or not ID_RE.fullmatch(scenario_id):
        raise HTTPException(502, "Tough Tongue did not return an agent ID")
    db.add(VoiceScenario(scenario_id=scenario_id, owner_user_id=user.id, name=config["name"]))
    db.commit()
    return {"id": scenario_id, "name": config["name"]}


@router.post("/scenarios/{scenario_id}/import")
async def import_scenario(scenario_id: str, db: Session = Depends(get_db), user: UserAccount = Depends(get_current_user)):
    if not ID_RE.fullmatch(scenario_id):
        raise HTTPException(422, "Invalid agent ID")
    existing = db.query(VoiceScenario).filter_by(scenario_id=scenario_id).first()
    if existing and existing.owner_user_id != user.id:
        raise HTTPException(409, "Agent is already linked to another account")
    data = await _provider("GET", f"/scenarios/{scenario_id}", user, db)
    if not isinstance(data, dict) or data.get("id") != scenario_id:
        raise HTTPException(502, "Could not verify agent")
    if not existing:
        db.add(VoiceScenario(scenario_id=scenario_id, owner_user_id=user.id, name=str(data.get("name") or "Agent")[:255]))
        db.commit()
    return {"id": scenario_id, "name": data.get("name")}


@router.get("/scenarios/{scenario_id}")
async def get_scenario(scenario_id: str, db: Session = Depends(get_db), user: UserAccount = Depends(get_current_user)):
    _owned(db, user, scenario_id)
    data = await _provider("GET", f"/scenarios/{scenario_id}", user, db)
    return {"id": scenario_id, "config": {key: data[key] for key in SCENARIO_FIELDS if key in data}}


@router.put("/scenarios/{scenario_id}")
async def update_scenario(scenario_id: str, req: ScenarioRequest, db: Session = Depends(get_db), user: UserAccount = Depends(get_current_user)):
    row = _owned(db, user, scenario_id)
    config = _config(req.config)
    await _provider("POST", "/scenarios", user, db, {**config, "id": scenario_id})
    row.name, row.updated_at = config["name"], time.time()
    db.commit()
    return {"id": scenario_id, "name": row.name}


@router.post("/scenarios/{scenario_id}/preview")
async def preview(scenario_id: str, db: Session = Depends(get_db), user: UserAccount = Depends(get_current_user)):
    _owned(db, user, scenario_id)
    data = await _provider("POST", "/scenario-access-token/me", user, db, {"scenario_id": scenario_id})
    src = data.get("iframe_src") if isinstance(data, dict) else None
    if not isinstance(src, str) or not src.startswith(f"https://app.toughtongueai.com/embed/"):
        raise HTTPException(502, "Tough Tongue did not return a preview URL")
    return {"iframe_src": src, "expires_at": data.get("expires_at")}


@router.get("/trunks")
async def trunks(db: Session = Depends(get_db), user: UserAccount = Depends(get_current_user)):
    return await _provider("GET", "/v2/sip/trunks", user, db)


@router.get("/scenarios/{scenario_id}/calls")
async def scenario_calls(scenario_id: str, db: Session = Depends(get_db), user: UserAccount = Depends(get_current_user)):
    _owned(db, user, scenario_id)
    return await _provider("GET", f"/v2/sip/calls?scenario_id={scenario_id}&limit=20", user, db)


@router.post("/calls")
async def call(req: CallRequest, db: Session = Depends(get_db), user: UserAccount = Depends(get_current_user)):
    _owned(db, user, req.scenario_id)
    if not re.fullmatch(r"\+[1-9]\d{7,14}", req.phone_number):
        raise HTTPException(422, "Use an E.164 phone number, e.g. +919876543210")
    if len(req.dynamic_vars) > 20 or any(len(k) > 64 or len(v) > 500 for k, v in req.dynamic_vars.items()):
        raise HTTPException(422, "Too many or oversized call variables")
    result = await _provider("POST", "/v2/sip/call", user, db, req.model_dump(exclude_defaults=True))
    call_id = result.get("call_id") or result.get("id") if isinstance(result, dict) else None
    if call_id:
        try:
            from api.crm_automation import track_call
            track_call(db, user.id, "toughtongue", str(call_id), req.phone_number, req.scenario_id)
        except Exception:
            db.rollback()
    return result
