"""Google Gemini speech client -- the voice engine for the Clavis chat UI.

Both legs of a voice turn go through ONE Google API key
(GEMINI_API_KEY in backend/.env):

  - transcribe_wav(): audio in -> text.
  - synthesize():     text in -> PCM16 mono 24kHz audio out.

Both are one-shot REST calls (httpx), not the bidirectional "Live" socket
(gemini-3.1-flash-live-preview). That keeps this a small, boring change on
top of the VAD/worklet/generation-id plumbing in api/speech.py that already
works, instead of forking the whole conversation onto a second, Gemini-only
brain that would need its own copy of the JARVIS persona, tools and memory.
If true full-duplex audio-to-audio is wanted later, this is the one file
that would be replaced.

NOTE: backend/services/speech/kokoro_engine.py, stt_engine.py, scheduler.py
and performance.py are intentionally left in place and untouched -- the
Exotel phone-call pipeline (services/conversation/orchestrator.py) still
depends on them. Only api/speech.py (what the browser chat UI talks to)
uses this module instead.
"""
from __future__ import annotations

import base64
import logging
import os

import httpx

logger = logging.getLogger(__name__)

API_BASE = "https://generativelanguage.googleapis.com/v1beta/models"

# One place to change model names as Google renames/upgrades them.
# gemini-3.5-transcribe (Google's dedicated STT model) was still returning
# empty transcriptions on documented REST paths as of Sep 2026, so
# transcription uses a general model via the long-stable audio-understanding
# path instead.
STT_MODEL = os.getenv("GEMINI_STT_MODEL", "gemini-3.8-flash")
TTS_MODEL = os.getenv("GEMINI_TTS_MODEL", "gemini-3.1-flash-tts-preview")
DEFAULT_VOICE = os.getenv("GEMINI_TTS_VOICE", "Charon")

TRANSCRIBE_PROMPT = (
    "Transcribe the speech in this audio exactly as spoken. The speaker may "
    "mix Hindi and English in the same sentence (Hinglish). Write Hindi "
    "words in Devanagari script and English words in Roman script, mixed "
    "naturally as spoken -- never transliterate Hindi into Roman letters. "
    "Output only the transcript, nothing else, no notes or preamble. If "
    "there is no intelligible speech, output nothing."
)


class GeminiSpeechError(RuntimeError):
    pass


def _api_key() -> str:
    key = (os.getenv("GEMINI_API_KEY") or "").strip()
    if not key:
        raise GeminiSpeechError("GEMINI_API_KEY is not set in backend/.env")
    return key


async def transcribe_wav(wav_bytes: bytes, language_hint: str = "") -> str:
    """One-shot audio -> text. wav_bytes must be a valid PCM16 WAV file."""
    body = {
        "contents": [{
            "parts": [
                {"text": TRANSCRIBE_PROMPT},
                {"inlineData": {"mimeType": "audio/wav", "data": base64.b64encode(wav_bytes).decode("ascii")}},
            ]
        }],
        "generationConfig": {"temperature": 0, "maxOutputTokens": 512},
    }
    url = f"{API_BASE}/{STT_MODEL}:generateContent"
    async with httpx.AsyncClient(timeout=20) as client:
        resp = await client.post(url, params={"key": _api_key()}, json=body)
    if resp.status_code != 200:
        raise GeminiSpeechError(f"Gemini transcription failed ({resp.status_code}): {resp.text[:300]}")
    data = resp.json()
    try:
        parts = data["candidates"][0]["content"]["parts"]
        text = "".join(p.get("text", "") for p in parts).strip()
    except (KeyError, IndexError, TypeError):
        text = ""
    return text


async def synthesize(text: str, voice: str = "", style: str = "") -> bytes:
    """One-shot text -> raw PCM16 mono 24kHz audio bytes (no WAV header)."""
    spoken = f"{style.strip()}: {text}" if style and style.strip() else text
    body = {
        "contents": [{"parts": [{"text": spoken}]}],
        "generationConfig": {
            "responseModalities": ["AUDIO"],
            "speechConfig": {
                "voiceConfig": {"prebuiltVoiceConfig": {"voiceName": voice or DEFAULT_VOICE}}
            },
        },
    }
    url = f"{API_BASE}/{TTS_MODEL}:generateContent"
    async with httpx.AsyncClient(timeout=30) as client:
        resp = await client.post(url, params={"key": _api_key()}, json=body)
    if resp.status_code != 200:
        raise GeminiSpeechError(f"Gemini speech synthesis failed ({resp.status_code}): {resp.text[:300]}")
    data = resp.json()
    try:
        inline = data["candidates"][0]["content"]["parts"][0]["inlineData"]
        audio_b64 = inline["data"]
    except (KeyError, IndexError, TypeError) as exc:
        raise GeminiSpeechError(f"Gemini speech response had no audio: {str(data)[:300]}") from exc
    return base64.b64decode(audio_b64)


def health() -> dict:
    configured = bool((os.getenv("GEMINI_API_KEY") or "").strip())
    return {
        "configured": configured,
        "stt_model": STT_MODEL,
        "tts_model": TTS_MODEL,
        "voice": DEFAULT_VOICE,
        "ready": configured,
        "error": None if configured else "GEMINI_API_KEY not set in backend/.env",
    }


def _demo():
    """ponytail self-check: no network calls, just verifies the pure logic
    (key lookup, health shape) without needing a real key or internet."""
    old = os.environ.pop("GEMINI_API_KEY", None)
    try:
        h = health()
        assert h["configured"] is False and h["ready"] is False
        try:
            _api_key()
            raise AssertionError("expected GeminiSpeechError for missing key")
        except GeminiSpeechError:
            pass
        os.environ["GEMINI_API_KEY"] = "test-key"
        assert _api_key() == "test-key"
        h2 = health()
        assert h2["configured"] is True and h2["ready"] is True
        print("gemini_client self-check OK")
    finally:
        if old is None:
            os.environ.pop("GEMINI_API_KEY", None)
        else:
            os.environ["GEMINI_API_KEY"] = old


if __name__ == "__main__":
    _demo()
