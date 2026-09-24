"""Compatibility endpoint for one-shot speech output (used outside the
live chat voice socket). Speaks through Gemini -- see api/speech.py."""

from fastapi import APIRouter, HTTPException, Depends
from fastapi.responses import Response
from pydantic import BaseModel, Field
from api.auth_sync import UserAccount, get_current_user

from api.speech import speech_health, synthesize_gemini_wav

router = APIRouter(prefix="/api/tts", tags=["tts"])


class TTSRequest(BaseModel):
    text: str = Field(min_length=1, max_length=2000)
    lang: str = Field(default="en", max_length=16)


@router.get("/health")
async def tts_health(user: UserAccount = Depends(get_current_user)):
    return speech_health()


@router.post("")
async def synthesize(req: TTSRequest, user: UserAccount = Depends(get_current_user)):
    text = (req.text or "").strip()
    if not text:
        raise HTTPException(status_code=400, detail="text is required")
    if len(text) > 2000:
        text = text[:2000]  # guard against runaway synthesis

    try:
        wav = await synthesize_gemini_wav(text)
    except Exception as exc:
        raise HTTPException(status_code=503, detail="Gemini TTS is temporarily unavailable") from exc
    return Response(content=wav, media_type="audio/wav")
