"""ElevenLabs speech output, with an optional Cartesia fallback before audio.

Live PCM is signed 16-bit little-endian at 24 kHz. Explicit engine selections
are honored; Gemini is retired from the active speech path.
"""

import logging
import os
import time
from typing import Literal

from fastapi import APIRouter, HTTPException, Depends
from fastapi.responses import Response, StreamingResponse
from pydantic import BaseModel, Field, model_validator
from sqlalchemy.orm import Session

from api.auth_sync import UserAccount, get_current_user, get_db
from api.credentials import get_provider_secret
from api.limits import consume, finish_usage, fail_usage

from api.speech import speech_health
from services.speech import elevenlabs_client

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/tts", tags=["tts"])


# The owner's chosen voice. Overridable per request, and by CARTESIA_VOICE_ID.
DEFAULT_CARTESIA_VOICE = "4459a9a5-69d6-4680-b970-e13dc51845b6"
CARTESIA_URL = "https://api.cartesia.ai/tts/bytes"
CARTESIA_VERSION = "2026-08-14"

# What Cartesia actually accepts. Anything else is sent as "neutral" rather
# than rejected -- a wrong emotion must never cost the user their sentence.
CARTESIA_EMOTIONS = {
    "neutral", "calm", "content", "happy", "excited", "triumphant",
    "sad", "angry", "scared", "anxious", "surprised", "sarcastic",
    "curious", "confused", "determined", "grateful", "hopeful", "proud",
    "sympathetic", "tired", "whispering", "shouting",
}


class PronunciationDictionaryLocator(BaseModel):
    pronunciation_dictionary_id: str = Field(min_length=1, max_length=128, pattern=r"^[A-Za-z0-9_-]+$")
    version_id: str | None = Field(default=None, min_length=1, max_length=128, pattern=r"^[A-Za-z0-9_-]+$")


class TTSRequest(BaseModel):
    text: str = Field(min_length=1, max_length=2000)
    lang: str = Field(default="en", max_length=16)
    voice: str = Field(default="", max_length=40)
    engine: Literal["", "elevenlabs", "cartesia"] = ""
    emotion: str = Field(default="", max_length=24)
    speed: float = Field(default=1.0, ge=0.6, le=1.5)
    volume: float = Field(default=1.0, ge=0.5, le=2.0)
    voice_id: str = Field(default="", max_length=64, pattern=r"^[A-Za-z0-9_-]*$")
    fmt: Literal["wav", "pcm"] = "wav"
    model_id: str = Field(default=elevenlabs_client.DEFAULT_MODEL_ID, min_length=1, max_length=80, pattern=r"^[A-Za-z0-9_-]+$")
    stability: float = Field(default=.5, ge=0, le=1)
    similarity_boost: float = Field(default=.75, ge=0, le=1)
    style: float | None = Field(default=None, ge=0, le=1)
    use_speaker_boost: bool | None = None
    pronunciation_dictionary_locators: list[PronunciationDictionaryLocator] = Field(default_factory=list, max_length=3)
    apply_text_normalization: Literal["auto", "on", "off"] = "auto"
    previous_text: str = Field(default="", max_length=2000)
    seed: int | None = Field(default=None, ge=0, le=4294967295)

    @model_validator(mode="after")
    def elevenlabs_speed_range(self):
        if self.engine != "cartesia" and not .7 <= self.speed <= 1.2:
            raise ValueError("ElevenLabs voice speed must be between 0.7 and 1.2")
        return self


def elevenlabs_body(req: TTSRequest, text: str) -> dict:
    body = {"text": text, "model_id": req.model_id,
            "voice_settings": {"stability": req.stability, "similarity_boost": req.similarity_boost, "speed": req.speed},
            "apply_text_normalization": req.apply_text_normalization}
    if req.style is not None:
        body["voice_settings"]["style"] = req.style
    if req.use_speaker_boost is not None:
        body["voice_settings"]["use_speaker_boost"] = req.use_speaker_boost
    if req.model_id in {"eleven_v4", "eleven_v4_turbo"}:
        # These current models support stability/similarity only. Sending the
        # older pacing/style controls can reject an otherwise valid request.
        for setting in ("style", "speed", "use_speaker_boost"):
            body["voice_settings"].pop(setting, None)
    elif req.model_id == "eleven_v3":
        # v3 has three stability modes and does not support the v2
        # similarity, speed or speaker-boost controls.
        body["voice_settings"] = {"stability": min((0., .5, 1.), key=lambda mode: abs(mode - req.stability))}
    # Auto language is preferable for natural Hindi/English code switching.
    language = (req.lang or "").strip().lower().split("-")[0]
    if language and language not in {"auto", "hinglish"} and len(language) == 2 and language.isalpha() and req.model_id != "eleven_multilingual_v2":
        body["language_code"] = language
    if req.pronunciation_dictionary_locators:
        body["pronunciation_dictionary_locators"] = [locator.model_dump(exclude_none=True) for locator in req.pronunciation_dictionary_locators]
    if req.previous_text:
        body["previous_text"] = req.previous_text
    if req.seed is not None:
        body["seed"] = req.seed
    return body


async def synthesize_cartesia(
    text: str, *, api_key: str, voice_id: str = "", lang: str = "hi",
    emotion: str = "", speed: float = 1.0, volume: float = 1.0, pcm: bool = False,
) -> bytes:
    """Cartesia Sonic -> audio bytes.

    pcm=True returns headerless pcm_s16le @24kHz, which is exactly what the
    browser's AudioWorklet player already consumes -- no decode step, no
    format conversion, nothing between the response and the speaker.
    """
    import httpx

    emotion = (emotion or "").strip().lower()
    if emotion not in CARTESIA_EMOTIONS:
        emotion = "neutral"

    output_format = (
        {"container": "raw", "encoding": "pcm_s16le", "sample_rate": 24000}
        if pcm else
        {"container": "wav", "encoding": "pcm_s16le", "sample_rate": 24000}
    )
    body = {
        "model_id": os.getenv("CARTESIA_MODEL", "sonic-3.6"),
        "transcript": text,
        "voice": {"id": voice_id or os.getenv("CARTESIA_VOICE_ID") or DEFAULT_CARTESIA_VOICE},
        "output_format": output_format,
        "language": (lang or "hi")[:2],
        "generation_config": {
            "emotion": emotion,
            "speed": max(0.6, min(1.5, float(speed or 1.0))),
            "volume": max(0.5, min(2.0, float(volume or 1.0))),
        },
    }
    async with httpx.AsyncClient(timeout=25.0) as client:
        res = await client.post(
            CARTESIA_URL, json=body,
            headers={
                "Authorization": f"Bearer {api_key}",
                "Cartesia-Version": CARTESIA_VERSION,
                "Content-Type": "application/json",
            },
        )
    if res.status_code != 200:
        if res.status_code in {401, 403}:
            raise HTTPException(422, detail={"code": "CARTESIA_KEY_INVALID", "message": "Cartesia rejected the connected key. Reconnect it in Setup."})
        if res.status_code == 429:
            raise HTTPException(429, detail={"code": "CARTESIA_RATE_LIMIT", "message": "Cartesia's allowance or concurrency limit was reached."})
        raise HTTPException(502, detail={"code": "CARTESIA_UNAVAILABLE", "message": "Cartesia speech is temporarily unavailable."})
    return res.content


def metered_audio(response, db, user, reservation):
    if not isinstance(response, StreamingResponse):
        finish_usage(db, user, reservation, 'succeeded')
        return response
    original, bind = response.body_iterator, db.get_bind()
    async def chunks():
        complete, checked_at = False, 0
        try:
            async for chunk in original:
                if time.monotonic() - checked_at >= 5:
                    from services.developer_control import check_access, check_session
                    with Session(bind=bind) as policy_db:
                        check_access(policy_db, user, 'voice')
                        if getattr(user, '_session_claims', None): check_session(policy_db, user, user._session_claims)
                    checked_at = time.monotonic()
                yield chunk
            complete = True
        finally:
            try:
                if hasattr(original, 'aclose'): await original.aclose()
            finally:
                with Session(bind=bind) as usage_db:
                    finish_usage(usage_db, user, reservation, 'succeeded' if complete else 'unknown')
    response.body_iterator = chunks()
    return response


@router.get("/health")
async def tts_health(user: UserAccount = Depends(get_current_user)):
    return speech_health()


@router.post("")
async def synthesize(
    req: TTSRequest,
    db: Session = Depends(get_db),
    user: UserAccount = Depends(get_current_user),
):
    """Speak through the chosen tenant provider. Fallback ends at first audio."""
    text = (req.text or "").strip()
    if not text:
        raise HTTPException(status_code=400, detail="text is required")
    want, pcm = req.engine, req.fmt == "pcm"
    error = None
    if want != "cartesia":
        key = get_provider_secret("elevenlabs", user, db)
        if key:
            reservation = consume(db, user, 'tts_characters', len(text), provider='elevenlabs', basis='submitted_characters')
            submitted = False
            try:
                from services.developer_control import reserve_provider
                reserve_provider(db, user, 'elevenlabs')
                submitted = True
                response = await elevenlabs_client.synthesize_response(
                    key, req.voice_id or elevenlabs_client.DEFAULT_VOICE_ID, elevenlabs_body(req, text), pcm=pcm)
                return metered_audio(response, db, user, reservation)
            except HTTPException as exc:
                fail_usage(db, user, 'tts_characters', reservation, exc, submitted=submitted)
                if want == "elevenlabs":
                    raise
                error = exc
            except BaseException as exc:
                fail_usage(db, user, 'tts_characters', reservation, exc, submitted=submitted)
                raise
        elif want == "elevenlabs":
            raise HTTPException(503, detail={"code": "ELEVENLABS_KEY_MISSING", "message": "Connect ElevenLabs in Setup first."})

    ckey = get_provider_secret("cartesia", user, db)
    if ckey:
        reservation = consume(db, user, 'tts_characters', len(text), provider='cartesia', basis='submitted_characters')
        submitted = False
        try:
            from services.developer_control import reserve_provider
            reserve_provider(db, user, 'cartesia')
            submitted = True
            audio = await synthesize_cartesia(
                text, api_key=ckey, voice_id=req.voice_id if want == "cartesia" else "",
                lang=req.lang, emotion=req.emotion, speed=req.speed, volume=req.volume, pcm=pcm)
            finish_usage(db, user, reservation, 'succeeded')
            return Response(content=audio, media_type="audio/pcm" if pcm else "audio/wav",
                            headers={"X-TTS-Engine": "cartesia", "X-Audio-Sample-Rate": "24000", "Cache-Control": "no-store"})
        except HTTPException as exc:
            fail_usage(db, user, 'tts_characters', reservation, exc, submitted=submitted)
            raise
        except Exception as exc:
            fail_usage(db, user, 'tts_characters', reservation, exc, submitted=submitted)
            logger.warning("Cartesia TTS unavailable: %s", type(exc).__name__)
            raise HTTPException(503, detail="Cartesia speech is temporarily unavailable") from None
        except BaseException as exc:
            fail_usage(db, user, 'tts_characters', reservation, exc, submitted=submitted)
            raise
    if error:
        raise error
    raise HTTPException(503, detail={"code": "VOICE_KEY_MISSING", "message": "Connect ElevenLabs or Cartesia in Setup first."})
