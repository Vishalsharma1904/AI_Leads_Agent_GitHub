"""One-shot speech output (used outside the live chat voice socket).

Cartesia first, Gemini second. Cartesia leads because AI Studio made billing
mandatory, which quietly knocked the whole chain down to the browser's
built-in voice -- the robotic one. Cartesia also takes an explicit emotion
per request, which is what makes this sound like a person rather than a
screen reader.

Both keys live in the server vault and are never handed to the browser.
"""

import logging
import os

from fastapi import APIRouter, HTTPException, Depends
from fastapi.responses import Response
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from api.auth_sync import UserAccount, get_current_user, get_db
from api.credentials import get_provider_secret

from api.speech import speech_health, synthesize_gemini_wav

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


class TTSRequest(BaseModel):
    text: str = Field(min_length=1, max_length=2000)
    lang: str = Field(default="en", max_length=16)
    voice: str = Field(default="", max_length=40)
    # Cartesia extras. All optional, all ignored by the Gemini path.
    engine: str = Field(default="", max_length=16)      # "cartesia" | "gemini" | ""
    emotion: str = Field(default="", max_length=24)
    speed: float = Field(default=1.0, ge=0.6, le=1.5)
    volume: float = Field(default=1.0, ge=0.5, le=2.0)
    voice_id: str = Field(default="", max_length=64)    # Cartesia voice uuid
    fmt: str = Field(default="wav", max_length=8)       # "wav" | "pcm"


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
        detail = res.text[:200]
        raise RuntimeError(f"cartesia {res.status_code}: {detail}")
    return res.content


@router.get("/health")
async def tts_health(user: UserAccount = Depends(get_current_user)):
    return speech_health()


@router.post("")
async def synthesize(
    req: TTSRequest,
    db: Session = Depends(get_db),
    user: UserAccount = Depends(get_current_user),
):
    """Speak text with the user's OWN Gemini key.

    The browser cannot do this itself: a key saved to the server vault is
    never handed back to the page (that is the point of the vault), so the
    browser's Gemini TTS had no key and silently fell back to the robotic
    built-in `speechSynthesis` voice. The key lives here, so synthesis
    belongs here too. GEMINI_API_KEY in backend/.env stays the fallback for
    a workspace that has not connected its own key.
    """
    text = (req.text or "").strip()
    if not text:
        raise HTTPException(status_code=400, detail="text is required")
    if len(text) > 2000:
        text = text[:2000]  # guard against runaway synthesis

    want = (req.engine or "").strip().lower()
    pcm = (req.fmt or "").lower() == "pcm"
    if want not in {"", "cartesia", "gemini"} or req.fmt not in {"wav", "pcm"}:
        raise HTTPException(status_code=422, detail="Unsupported speech engine or audio format")

    # Cartesia first unless the caller explicitly asked for Gemini.
    if want != "gemini":
        ckey = get_provider_secret("cartesia", user, db) or os.getenv("CARTESIA_API_KEY") or ""
        if ckey:
            try:
                audio = await synthesize_cartesia(
                    text, api_key=ckey, voice_id=req.voice_id.strip(),
                    lang=req.lang, emotion=req.emotion, speed=req.speed,
                    volume=req.volume, pcm=pcm,
                )
                return Response(
                    content=audio,
                    media_type="audio/pcm" if pcm else "audio/wav",
                    headers={"X-TTS-Engine": "cartesia"},
                )
            except Exception as exc:
                logger.warning("Cartesia TTS unavailable: %s", type(exc).__name__)
                if want == "cartesia" or pcm:
                    raise HTTPException(status_code=503, detail="Cartesia speech is temporarily unavailable") from None
        elif want == "cartesia":
            raise HTTPException(status_code=503, detail="No Cartesia key connected")

    if pcm:
        raise HTTPException(status_code=422, detail="Raw PCM requires Cartesia")

    key = get_provider_secret("gemini", user, db) or ""
    try:
        wav = await synthesize_gemini_wav(text, req.voice.strip(), api_key=key)
    except Exception as exc:
        logger.warning("tts failed: %s", exc)
        raise HTTPException(status_code=503, detail="Gemini TTS is temporarily unavailable") from exc
    return Response(content=wav, media_type="audio/wav", headers={"X-TTS-Engine": "gemini"})
