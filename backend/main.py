import logging
import os
import asyncio
import re
import time
import secrets
import logging
from collections import defaultdict, deque

from fastapi import FastAPI, WebSocket, WebSocketDisconnect, HTTPException, Depends, Response
from fastapi.middleware.cors import CORSMiddleware
from starlette.middleware.trustedhost import TrustedHostMiddleware
from pydantic import BaseModel, Field
from dotenv import load_dotenv
import uvicorn

from services.conversation.orchestrator import VoiceOrchestrator
from services.telephony.exotel_adapter import ExotelAdapter
from ws_handlers.audio_handler import AudioHandler
from api.auth_sync import router as auth_sync_router
from api.email_sender import router as email_router
from api.outlook_bridge import router as outlook_router
from api.sms_fast2sms import router as sms_router
from api.lead_jobs import router as lead_jobs_router
from api.candidate_jobs import router as candidate_jobs_router
from api.credentials import router as credentials_router
from api.google_sheets import router as google_sheets_router
from api.ai_chat import router as ai_chat_router
from api.tts import router as tts_router
from api.speech import router as speech_router
from api.web_reader import router as web_reader_router
from services.capability_registry import list_capabilities
from api.auth_sync import engine as auth_engine, get_current_user, UserAccount
from services.speech.kokoro_engine import get_kokoro_engine

load_dotenv()

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = FastAPI(
    title="Jarvis Voice Calling Agent API",
    description="Backend API for the Clavis AI Voice Assistant (Exotel + OpenRouter)",
    version="1.1.0"
)

# Configure CORS for the static HTML frontend
cors_origins = [origin.strip() for origin in os.getenv(
    "CORS_ORIGINS", "http://localhost:3000,http://127.0.0.1:3000"
).split(",") if origin.strip()]
if APP_ENV := os.getenv("APP_ENV", "development").strip().lower():
    if APP_ENV == "production" and not cors_origins:
        raise RuntimeError("CORS_ORIGINS must be configured in production")

allowed_hosts = [host.strip() for host in os.getenv(
    "ALLOWED_HOSTS", "localhost,127.0.0.1"
).split(",") if host.strip()]

app.add_middleware(
    CORSMiddleware,
    allow_origins=cors_origins,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type", "Idempotency-Key"],
)
if APP_ENV == "production":
    app.add_middleware(TrustedHostMiddleware, allowed_hosts=allowed_hosts)

MAX_REQUEST_BYTES = int(os.getenv("MAX_REQUEST_BYTES", str(10 * 1024 * 1024)))
_rate_windows = defaultdict(deque)
_RATE_LIMITED_PREFIXES = ("/api/auth/", "/api/v1/ai/", "/api/v1/lead-jobs", "/api/email/", "/api/sms/")

@app.middleware("http")
async def security_controls(request, call_next):
    content_length = request.headers.get("content-length")
    if content_length and content_length.isdigit() and int(content_length) > MAX_REQUEST_BYTES:
        return Response(content='{"detail":"Request body is too large"}', status_code=413,
                        media_type="application/json")
    if request.url.path.startswith(_RATE_LIMITED_PREFIXES):
        now = time.monotonic()
        bucket = _rate_windows[(request.client.host if request.client else "unknown", request.url.path)]
        while bucket and now - bucket[0] > 60:
            bucket.popleft()
        if len(bucket) >= int(os.getenv("RATE_LIMIT_PER_MINUTE", "60")):
            return Response(content='{"detail":"Too many requests"}', status_code=429,
                            media_type="application/json", headers={"Retry-After": "60"})
        bucket.append(now)
    response = await call_next(request)
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
    response.headers["Permissions-Policy"] = "camera=(), geolocation=(), payment=()"
    response.headers["Cache-Control"] = "no-store" if request.url.path.startswith("/api/") else "no-cache"
    if APP_ENV == "production":
        response.headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains"
    return response

app.include_router(auth_sync_router)
app.include_router(email_router)
app.include_router(outlook_router)
app.include_router(sms_router)
app.include_router(lead_jobs_router)
app.include_router(candidate_jobs_router)
app.include_router(credentials_router)
app.include_router(google_sheets_router)
app.include_router(ai_chat_router)
app.include_router(tts_router)
app.include_router(speech_router)
app.include_router(web_reader_router)


@app.on_event("startup")
async def warm_local_kokoro():
    """Warm the shared model in the background so the first spoken turn is not
    charged the model-load cost. Set CLAVIS_WARM_KOKORO=false for a text-only
    or memory-constrained deployment."""
    if os.getenv("CLAVIS_WARM_KOKORO", "true").lower() == "false":
        return

    async def load():
        try:
            await get_kokoro_engine().warm()
            logger.info("Shared Kokoro model warmed and ready")
        except Exception as exc:
            logger.warning("Kokoro warm-up deferred: %s", exc)

    asyncio.create_task(load(), name="clavis-kokoro-warmup")

exotel = ExotelAdapter()


@app.get("/")
async def root():
    return {"message": "Jarvis Voice Calling Agent API is running"}


@app.get("/health")
async def health_check():
    openrouter_ok = bool(os.getenv("OPENROUTER_API_KEYS"))
    exotel_ok = bool(os.getenv("EXOTEL_API_KEY") and os.getenv("EXOTEL_ACCOUNT_SID"))
    try:
        with auth_engine.connect() as connection:
            connection.exec_driver_sql("SELECT 1")
        db_status = "ok"
    except Exception:
        db_status = "error"
    return {
        "status": "healthy",
        "services": {
            "api": "ok",
            "openrouter": "configured" if openrouter_ok else "missing_keys",
            "exotel": "configured" if exotel_ok else "missing_credentials",
            "db": db_status,
            "redis": "pending",
            "chromadb": "pending",
        }
    }


@app.get("/api/capabilities")
async def capabilities(user: UserAccount = Depends(get_current_user)):
    """Expose the guarded operator capability registry to the UI."""
    return {"capabilities": list_capabilities()}


@app.get("/api/public-config")
async def public_config():
    """Only public browser configuration may cross this boundary."""
    return {
        "google_client_id": os.getenv("GOOGLE_CLIENT_ID", "").strip(),
        "supabase_url": os.getenv("SUPABASE_URL", "").strip().rstrip("/"),
        "supabase_publishable_key": os.getenv("SUPABASE_PUBLISHABLE_KEY", "").strip(),
        "supabase_redirect_url": os.getenv("SUPABASE_REDIRECT_URL", "http://localhost:3000/").strip(),
    }


class OutboundCallRequest(BaseModel):
    to_number: str = Field(min_length=8, max_length=16)  # E.164, e.g. "+919876543210"
    caller_id: str = Field(default="", max_length=32)    # must match configured Exotel caller ID
    record: bool = False
    custom_field: str = Field(default="", max_length=500)


@app.post("/api/calls/outbound")
async def start_outbound_call(req: OutboundCallRequest, user: UserAccount = Depends(get_current_user)):
    """
    Places a real outbound call via Exotel and connects it to Clavis's
    live voice pipeline over /ws/audio. Requires EXOTEL_* env vars and a
    publicly reachable PUBLIC_WSS_DOMAIN.
    """
    if not re.fullmatch(r"\+[1-9]\d{7,14}", req.to_number.strip()):
        raise HTTPException(status_code=422, detail="A valid E.164 destination number is required")
    configured_caller_id = os.getenv("EXOTEL_CALLER_ID", "").strip()
    if req.caller_id and req.caller_id != configured_caller_id:
        raise HTTPException(status_code=403, detail="Caller ID is not permitted")
    caller_id = configured_caller_id
    if not caller_id:
        raise HTTPException(status_code=400, detail="No caller_id provided and EXOTEL_CALLER_ID is not set")

    result = await exotel.make_outbound_call(
        to_number=req.to_number,
        caller_id=caller_id,
        record=req.record,
        custom_field=req.custom_field or None,
    )
    if result.get("status") == "error":
        raise HTTPException(status_code=502, detail=result.get("error", "Call failed"))
    return result


@app.get("/api/calls/active-streams")
async def active_streams(user: UserAccount = Depends(get_current_user)):
    return await exotel.get_active_streams()


@app.websocket("/ws/live-calls")
async def websocket_live_calls(websocket: WebSocket):
    """Dashboard-facing socket for streaming live call status/events to the UI."""
    if websocket.headers.get("origin") not in cors_origins:
        await websocket.close(code=1008)
        return
    await websocket.accept()
    try:
        while True:
            data = await websocket.receive_text()
            await websocket.send_text(f"Message text was: {data}")
    except WebSocketDisconnect:
        logger.info("Dashboard live-calls socket disconnected")


@app.websocket("/ws/audio")
async def websocket_audio(websocket: WebSocket):
    """
    The actual voice-call endpoint. Exotel's VoiceBot applet (or the
    streamurl passed to /calls/connect) points here. Runs one
    AudioHandler + VoiceOrchestrator per connected call leg.
    """
    if APP_ENV == "production":
        expected = os.getenv("EXOTEL_STREAM_TOKEN", "").strip()
        supplied = websocket.query_params.get("stream-token", "")
        if not expected or not supplied or not secrets.compare_digest(supplied, expected):
            await websocket.close(code=1008)
            return
    handler = AudioHandler(websocket)
    orchestrator = VoiceOrchestrator()
    await handler.connect()

    try:
        while True:
            chunk = await handler.receive_audio_chunk()
            if chunk is None:
                continue
            if chunk == b"EOF":
                break
            # Orchestrator buffers/transcribes/generates/synthesizes and
            # streams the reply back out over the same handler.
            await orchestrator.process_user_audio(chunk, handler)
    except WebSocketDisconnect:
        logger.info("Call audio stream disconnected")
    finally:
        await handler.disconnect()


if __name__ == "__main__":
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
