"""ElevenLabs realtime credentials/metadata and Groq transcription fallback."""
from __future__ import annotations

import asyncio
import io
import logging
import math
import os
import wave

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile, WebSocket
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field
from api.auth_sync import UserAccount, get_current_user, authenticate_websocket, get_db
from api.credentials import get_provider_secret
from sqlalchemy.orm import Session
import httpx

from services.speech import gemini_client
from services.speech import elevenlabs_client

logger = logging.getLogger(__name__)
router = APIRouter(tags=["speech"])
_WS_ORIGINS = {value.strip() for value in os.getenv("CORS_ORIGINS", "http://localhost:3000,http://127.0.0.1:3000,http://localhost:3210").split(",") if value.strip()}


def prepare_transcription_wav(data: bytes):
    # The persistent ElevenLabs path needs no scipy/torch startup cost. Load
    # the existing local speech gate only when Groq upload fallback is used.
    from services.speech.audio import prepare_transcription_wav as prepare
    return prepare(data)


def speech_health() -> dict:
    return {
        "engine": "elevenlabs",
        "tts": {"engine": "elevenlabs", "model": elevenlabs_client.DEFAULT_MODEL_ID, "sample_rate": 24000},
        "stt": {"engine": "elevenlabs", "model": "scribe_v2_realtime"},
        "fallbacks": {"stt": "groq", "tts": "cartesia"},
        "strict_local_voice": False,
    }


@router.get("/api/speech/health")
async def speech_health_endpoint(user: UserAccount = Depends(get_current_user)):
    return speech_health()


class ElevenLabsTokenRequest(BaseModel):
    language: str = Field(default="", max_length=16)


@router.post("/api/speech/elevenlabs-token")
async def elevenlabs_token(req: ElevenLabsTokenRequest, db: Session = Depends(get_db), user: UserAccount = Depends(get_current_user)):
    key = get_provider_secret("elevenlabs", user, db)
    if not key:
        raise HTTPException(503, detail={"code": "ELEVENLABS_KEY_MISSING", "message": "Connect ElevenLabs in Setup first."})
    # Language/VAD belong in the browser's Scribe connection parameters. The
    # documented token endpoint accepts the token type, without a JSON body.
    from services.developer_control import reserve_provider
    from api.limits import consume, finish_usage, fail_usage
    reservation = consume(db, user, 'voice_sessions', provider='elevenlabs', basis='token_requested')
    submitted = False
    try:
        reserve_provider(db, user, 'elevenlabs')
        submitted = True
        data = await elevenlabs_client.request_json("POST", "/v1/single-use-token/realtime_scribe", key)
        token = data.get("token") if isinstance(data, dict) else None
        if not isinstance(token, str) or not token or len(token) > 8192 or token == key:
            raise elevenlabs_client.provider_error(502)
    except BaseException as exc:
        fail_usage(db, user, 'voice_sessions', reservation, exc, submitted=submitted)
        raise
    finish_usage(db, user, reservation, 'issued', 'token_issued')
    return JSONResponse({"token": token, "provider": "elevenlabs", "model_id": "scribe_v2_realtime", "expires_in": 900,
                         "allowance_basis": "Issued sessions; vendor connection duration is not hard-capped by the app"},
                        headers={"Cache-Control": "no-store"})


@router.get("/api/speech/elevenlabs-config")
async def elevenlabs_config(db: Session = Depends(get_db), user: UserAccount = Depends(get_current_user),
                           voice_page_token: str = Query(default="", max_length=256), search: str = Query(default="", max_length=120)):
    key = get_provider_secret("elevenlabs", user, db)
    defaults = {"voice_id": elevenlabs_client.DEFAULT_VOICE_ID, "model_id": elevenlabs_client.DEFAULT_MODEL_ID,
                "stt_model_id": "scribe_v2_realtime", "sample_rate": 24000, "stability": .5,
                "similarity_boost": .75, "style": 0, "use_speaker_boost": True, "speed": 1}
    result = {"provider": "elevenlabs", "configured": bool(key), "voices": [], "models": [], "subscription": None,
              "defaults": defaults, "voices_has_more": False, "voices_next_page_token": None, "errors": {}}
    if not key:
        return JSONResponse(result, headers={"Cache-Control": "no-store"})
    params = {"page_size": 100, "include_total_count": "false"}
    if isinstance(voice_page_token, str) and voice_page_token:
        params["next_page_token"] = voice_page_token
    if isinstance(search, str) and search:
        params["search"] = search
    responses = await asyncio.gather(
        elevenlabs_client.request_json("GET", "/v2/voices", key, params=params),
        elevenlabs_client.request_json("GET", "/v1/models", key),
        elevenlabs_client.request_json("GET", "/v1/user/subscription", key), return_exceptions=True)
    # Permission scopes vary by key; a subscription-read error should not
    # empty a working voice list. Only publish the fields needed by the UI.
    for resource, data in zip(("voices", "models", "subscription"), responses):
        if isinstance(data, HTTPException):
            result["errors"][resource] = data.detail
            continue
        if isinstance(data, BaseException):
            result["errors"][resource] = elevenlabs_client.provider_error(502).detail
            continue
        if resource == "voices" and isinstance(data, dict) and isinstance(data.get("voices"), list):
            result[resource] = [{**{field: voice.get(field) for field in ("voice_id", "name", "category", "labels", "description", "preview_url", "available_for_tiers")},
                                "verified_languages": [{field: item.get(field) for field in ("language", "locale", "accent")} for item in (voice.get("verified_languages") if isinstance(voice.get("verified_languages"), list) else [])[:20] if isinstance(item, dict)]}
                                for voice in data["voices"][:200] if isinstance(voice, dict) and voice.get("voice_id")]
            result["voices_has_more"] = data.get("has_more") is True
            result["voices_next_page_token"] = data.get("next_page_token") if isinstance(data.get("next_page_token"), str) else None
        elif resource == "models" and isinstance(data, list):
            fields = ("model_id", "name", "description", "languages", "can_do_text_to_speech", "can_use_style", "can_use_speaker_boost",
                      "requires_alpha_access", "maximum_text_length_per_request", "model_rates")
            result[resource] = [{field: model.get(field) for field in fields} for model in data[:100]
                                if isinstance(model, dict) and model.get("can_do_text_to_speech") is True]
        elif resource == "subscription" and isinstance(data, dict):
            from services.developer_control import ProviderAssignment
            assignment = db.query(ProviderAssignment).filter_by(user_id=user.id, provider='elevenlabs').first()
            if assignment and assignment.mode == 'shared':
                result[resource] = {'managed': True, 'basis': 'Shared provider account; see your app usage allowance'}
                continue
            fields = ("tier", "character_count", "character_limit", "next_character_count_reset_unix", "status", "currency", "billing_period",
                      "can_extend_character_limit", "voice_limit", "can_use_instant_voice_cloning", "can_use_professional_voice_cloning")
            result[resource] = {field: data.get(field) for field in fields}
            count, limit = data.get("character_count"), data.get("character_limit")
            result[resource]["remaining_characters"] = max(0, limit - count) if type(count) is int and type(limit) is int else None
        else:
            result["errors"][resource] = elevenlabs_client.provider_error(502).detail
    return JSONResponse(result, headers={"Cache-Control": "no-store"})


@router.post("/api/speech/transcribe")
async def transcribe_audio(file: UploadFile = File(...), language_hint: str = "", provider: str = "groq",
                           user: UserAccount = Depends(get_current_user), db: Session = Depends(get_db)):
    data = await file.read(8 * 1024 * 1024 + 1)
    if not data:
        raise HTTPException(status_code=400, detail="audio is required")
    if len(data) > 8 * 1024 * 1024:
        raise HTTPException(status_code=413, detail="audio is too large")
    if provider != "groq":
        raise HTTPException(status_code=422, detail="Unsupported transcription provider")
    if provider == "groq":
        key = get_provider_secret("groq", user, db)
        if not key:
            raise HTTPException(status_code=503, detail="Connect Groq in Setup for speech recognition")
        try:
            data = await asyncio.to_thread(prepare_transcription_wav, data)
        except ValueError:
            raise HTTPException(status_code=422, detail="Audio could not be decoded, or exceeded 60 seconds") from None
        except Exception as exc:
            logger.warning("Voice audio validation unavailable: %s", type(exc).__name__)
            raise HTTPException(status_code=503, detail="Voice audio validation is unavailable") from None
        if data is None:
            return {"text":"", "reason":"no_speech", "language":"", "duration":0, "provider":"groq"}
        with wave.open(io.BytesIO(data), 'rb') as wav:
            submitted_seconds = wav.getnframes() / wav.getframerate()
        if not 0 < submitted_seconds <= 60:
            raise HTTPException(422, 'Voice recording must be under 60 seconds')
        from api.limits import consume, finish_usage, fail_usage
        reservation = consume(db, user, 'voice_seconds', math.ceil(submitted_seconds),
                              provider='groq', basis='submitted_audio_seconds')
        submitted = False
        fields = {"model": "whisper-large-v3", "temperature": "0", "response_format": "verbose_json"}
        language = language_hint.split("-")[0].lower()
        if language in {"hi", "en"}:
            fields["language"] = language
        try:
            from services.developer_control import reserve_provider
            reserve_provider(db, user, 'groq')
            submitted = True
            async with httpx.AsyncClient(timeout=20.0) as client:
                response = await client.post("https://api.groq.com/openai/v1/audio/transcriptions",
                    headers={"Authorization": f"Bearer {key}"}, data=fields,
                    files={"file": ("speech.wav", data, "audio/wav")})
            if response.status_code in {401, 403}:
                raise HTTPException(status_code=422, detail="Groq rejected the connected key")
            if response.status_code == 429:
                raise HTTPException(status_code=429, detail="Groq speech request limit reached. Check the connected provider's allowance in Setup.")
            if 400 <= response.status_code < 500:
                raise HTTPException(status_code=422, detail="Groq rejected the transcription request")
            response.raise_for_status()
            result = response.json()
            if not isinstance(result, dict) or not isinstance(result.get("text", ""), str):
                raise ValueError("Invalid transcription response")
            segments = result.get("segments") or []
            if not isinstance(segments, list) or any(not isinstance(segment, dict) for segment in segments):
                raise ValueError("Invalid transcription segments")
            silent = bool(segments) and all(float(segment.get("no_speech_prob", 0)) > .85 for segment in segments)
            # Reject uncertain/repetitive decoding; never turn it into a command.
            unclear = any(float(segment.get("avg_logprob", 0)) < -1.5
                          or float(segment.get("compression_ratio", 0)) > 2.4
                          or (float(segment.get("no_speech_prob", 0)) > .6
                              and float(segment.get("avg_logprob", 0)) < -1)
                          for segment in segments)
        except HTTPException as exc:
            fail_usage(db, user, 'voice_seconds', reservation, exc, submitted=submitted)
            raise
        except (httpx.HTTPError, ValueError, TypeError) as exc:
            fail_usage(db, user, 'voice_seconds', reservation, exc, submitted=submitted)
            logger.warning("Groq transcription unavailable: %s", type(exc).__name__)
            raise HTTPException(status_code=503, detail="Groq speech transcription is temporarily unavailable") from None
        except BaseException as exc:
            fail_usage(db, user, 'voice_seconds', reservation, exc, submitted=submitted)
            raise
        finish_usage(db, user, reservation, 'succeeded')
        duration = result.get('duration')
        if type(duration) in (int, float) and math.isfinite(duration) and duration >= 0:
            from services.developer_control import record_usage
            record_usage(db, user, 'stt_seconds', duration, request_id=reservation['usage_id'],
                         provider='groq', state='succeeded', basis='provider_reported')
            db.commit()
        # Whisper can hallucinate a canned transcript for a silent recording.
        return {"text": "" if silent or unclear else str(result.get("text") or "").strip(),
                "reason": "no_speech" if silent else "unclear_audio" if unclear else "",
                "language": result.get("language") or language_hint, "duration": result.get("duration") or 0,
                "provider": "groq"}


@router.websocket("/ws/speech/input")
@router.websocket("/ws/speech/output")
async def retired_speech_socket(websocket: WebSocket):
    if not await authenticate_websocket(websocket, _WS_ORIGINS):
        return
    await websocket.send_json({"type": "error", "code": "VOICE_SOCKET_RETIRED",
                               "error": "Use ElevenLabs realtime speech in Rudra voice settings."})
    await websocket.close(code=1008)


async def synthesize_gemini_wav(text: str, voice: str = "", api_key: str = "") -> bytes:
    """Historical helper; active Rudra speech never selects Gemini."""
    from services.speech.audio import pcm16_to_wav
    pcm = await gemini_client.synthesize(text, voice, api_key=api_key)
    return pcm16_to_wav(pcm, 24000)
