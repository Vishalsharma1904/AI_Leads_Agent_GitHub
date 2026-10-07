"""Speech endpoints for the Rudra24 AI browser chat UI.

Browser Groq transcription uses the signed-in account's server vault key.
Groq uploads pass the installed Silero speech gate before cloud transcription;
no local Whisper transcription model is loaded. The legacy socket still uses
Google Gemini and wraps raw PCM16 in a WAV header.

The turn-detection (VAD) and worklet/websocket contract are unchanged from
before, so jarvis_ui.js / clavis-local-speech.js needed no protocol changes
-- only the engine behind the socket changed.

NOTE: services/speech/kokoro_engine.py, stt_engine.py, scheduler.py and
performance.py still exist and are still used -- by
services/conversation/orchestrator.py, the Exotel phone-call pipeline. That
is a separate feature nobody asked to change, so it was left alone.
"""
from __future__ import annotations

import json
import asyncio
import logging
import os
import re
import time
from typing import Optional

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile, WebSocket, WebSocketDisconnect
from api.auth_sync import UserAccount, get_current_user, authenticate_websocket, get_db
from api.credentials import get_provider_secret
from sqlalchemy.orm import Session
import httpx

from services.speech import gemini_client
from services.speech.audio import pcm16_to_wav, prepare_transcription_wav
from services.speech.contracts import new_generation_id
from services.speech.vad import VADTurnTracker, get_vad_engine

logger = logging.getLogger(__name__)
router = APIRouter(tags=["speech"])
_WS_ORIGINS = {value.strip() for value in os.getenv("CORS_ORIGINS", "http://localhost:3000,http://127.0.0.1:3000,http://localhost:3210").split(",") if value.strip()}


def speech_health() -> dict:
    gemini = gemini_client.health()
    return {
        "engine": "gemini",
        "tts": gemini,
        "stt": gemini,
        "vad": get_vad_engine().health(),
        "strict_local_voice": False,
    }


@router.get("/api/speech/health")
async def speech_health_endpoint(user: UserAccount = Depends(get_current_user)):
    return speech_health()


@router.post("/api/speech/transcribe")
async def transcribe_audio(file: UploadFile = File(...), language_hint: str = "", provider: str = "groq",
                           user: UserAccount = Depends(get_current_user), db: Session = Depends(get_db)):
    data = await file.read(8 * 1024 * 1024 + 1)
    if not data:
        raise HTTPException(status_code=400, detail="audio is required")
    if len(data) > 8 * 1024 * 1024:
        raise HTTPException(status_code=413, detail="audio is too large")
    if provider not in {"groq", "gemini"}:
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
        fields = {"model": "whisper-large-v3", "temperature": "0", "response_format": "verbose_json"}
        language = language_hint.split("-")[0].lower()
        if language in {"hi", "en"}:
            fields["language"] = language
        try:
            async with httpx.AsyncClient(timeout=20.0) as client:
                response = await client.post("https://api.groq.com/openai/v1/audio/transcriptions",
                    headers={"Authorization": f"Bearer {key}"}, data=fields,
                    files={"file": ("speech.wav", data, "audio/wav")})
            if response.status_code in {401, 403}:
                raise HTTPException(status_code=422, detail="Groq rejected the connected key")
            if response.status_code == 429:
                raise HTTPException(status_code=429, detail="Groq speech request limit reached. Check the connected provider's allowance in Setup.")
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
        except HTTPException:
            raise
        except (httpx.HTTPError, ValueError, TypeError) as exc:
            logger.warning("Groq transcription unavailable: %s", type(exc).__name__)
            raise HTTPException(status_code=503, detail="Groq speech transcription is temporarily unavailable") from None
        # Whisper can hallucinate a canned transcript for a silent recording.
        return {"text": "" if silent or unclear else str(result.get("text") or "").strip(),
                "reason": "no_speech" if silent else "unclear_audio" if unclear else "",
                "language": result.get("language") or language_hint, "duration": result.get("duration") or 0,
                "provider": "groq"}
    try:
        text = await gemini_client.transcribe_wav(data, language_hint)
    except Exception as exc:
        logger.exception("Gemini transcription failed")
        raise HTTPException(status_code=503, detail="Speech transcription is temporarily unavailable") from exc
    return {"text": text, "language": language_hint, "duration": 0.0}


@router.websocket("/ws/speech/input")
async def speech_input_socket(websocket: WebSocket):
    claims = await authenticate_websocket(websocket, _WS_ORIGINS)
    if not claims:
        return
    audio = bytearray()
    language_hint = ""
    generation_id = new_generation_id()
    # The worklet sends 512 samples (32 ms) per frame. Seven stable frames
    # gives a ~224 ms speech gate; eleven quiet frames gives ~352 ms hangover.
    tracker = VADTurnTracker(get_vad_engine(), pre_roll_frames=4, hangover_frames=11, start_frames=7)
    capturing = False

    async def emit_final() -> None:
        nonlocal capturing
        if not audio or not capturing:
            return
        try:
            # Gemini needs a real WAV file, not a bare PCM16 buffer.
            wav_bytes = pcm16_to_wav(bytes(audio), 16000)
            text = await gemini_client.transcribe_wav(wav_bytes, language_hint)
            await websocket.send_json({
                "type": "final", "generation_id": generation_id,
                "text": text, "language": language_hint, "duration": 0.0,
            })
        except Exception as exc:
            await websocket.send_json({"type": "error", "generation_id": generation_id, "error": "Speech transcription unavailable"})
        audio.clear()
        tracker.reset()
        capturing = False
    try:
        while True:
            message = await websocket.receive()
            if time.time() >= claims["exp"]:
                await websocket.close(code=1008)
                return
            if message.get("bytes") is not None:
                frame = message["bytes"]
                if len(frame) > 65536 or len(audio) + len(frame) > 8 * 1024 * 1024:
                    await websocket.close(code=1009)
                    return
                state, active = tracker.feed(frame)
                if state == "speech_start":
                    audio.clear()
                    audio.extend(tracker.take_pre_roll())
                    capturing = True
                elif capturing:
                    audio.extend(frame)
                await websocket.send_json({
                    "type": "vad",
                    "state": state,
                    "generation_id": generation_id,
                    "active": active,
                    "bytes": len(audio) if capturing else 0,
                })
                if state == "speech_end":
                    await emit_final()
                continue
            raw = message.get("text")
            if not raw:
                continue
            payload = json.loads(raw)
            message_type = payload.get("type")
            if message_type == "start":
                audio.clear()
                tracker.reset()
                capturing = False
                generation_id = payload.get("generation_id") or new_generation_id()
                language_hint = str(payload.get("language_hint") or "")
                await websocket.send_json({"type": "ready", "generation_id": generation_id})
            elif message_type == "cancel":
                audio.clear()
                tracker.reset()
                capturing = False
                await websocket.send_json({"type": "cancelled", "generation_id": generation_id})
            elif message_type == "stop":
                if payload.get("generation_id") and payload.get("generation_id") != generation_id:
                    continue
                await emit_final()
    except (WebSocketDisconnect, RuntimeError):
        return


_SENTENCE_BOUNDARY = re.compile(r"[.!?।…]+[\"')\]]*\s+")


class _TextToSpeechScheduler:
    """Buffers streamed reply text into sentences and speaks each one
    through Gemini as soon as it is complete, so playback can start before
    the whole reply has finished generating.

    ponytail: sentences are synthesized one at a time, in order (simplest
    correct thing -- guaranteed ordering, no reorder buffer). If the gap
    between sentences is ever noticeable, synthesize the next sentence
    concurrently while the previous one is still playing and hold results
    in a small ordered queue.
    """

    def __init__(self, on_audio, generation_id: str, voice: str = ""):
        self.generation_id = generation_id
        self._on_audio = on_audio
        self._voice = voice
        self._buffer = ""
        self._cancelled = False
        self._sequence = 0

    async def push_text(self, delta: str) -> None:
        self._buffer += delta
        while True:
            match = _SENTENCE_BOUNDARY.search(self._buffer)
            if not match:
                break
            sentence, self._buffer = self._buffer[:match.end()], self._buffer[match.end():]
            sentence = sentence.strip()
            if sentence:
                await self._speak(sentence)

    async def finish(self) -> None:
        tail = self._buffer.strip()
        self._buffer = ""
        if tail:
            await self._speak(tail)

    async def _speak(self, sentence: str) -> None:
        if self._cancelled:
            return
        try:
            audio = await gemini_client.synthesize(sentence, self._voice)
        except Exception as exc:
            logger.warning("Gemini TTS failed for a segment, skipping it: %s", exc)
            return
        if self._cancelled:
            return
        await self._on_audio(audio, self._sequence)
        self._sequence += 1

    def cancel(self) -> None:
        self._cancelled = True


@router.websocket("/ws/speech/output")
async def speech_output_socket(websocket: WebSocket):
    claims = await authenticate_websocket(websocket, _WS_ORIGINS)
    if not claims:
        return
    scheduler: Optional[_TextToSpeechScheduler] = None
    socket_closed = False
    try:
        while True:
            message = await websocket.receive_text()
            if time.time() >= claims["exp"] or len(message) > 16384:
                await websocket.close(code=1008)
                return
            payload = json.loads(message)
            message_type = payload.get("type")
            if message_type == "start":
                socket_closed = False
                if scheduler:
                    scheduler.cancel()
                generation_id = payload.get("generation_id") or new_generation_id()
                voice_settings = payload.get("voice_settings") or {}
                voice = str(voice_settings.get("voice") or "")

                async def on_audio(audio: bytes, sequence: int):
                    nonlocal socket_closed
                    if socket_closed:
                        return
                    try:
                        await websocket.send_json({
                            "type": "audio", "generation_id": generation_id,
                            "sample_rate": 24000, "sequence": sequence,
                        })
                        await websocket.send_bytes(audio)
                        await websocket.send_json({
                            "type": "segment_end", "generation_id": generation_id, "sequence": sequence,
                        })
                    except (WebSocketDisconnect, RuntimeError):
                        # The browser may cancel/close while Gemini is still
                        # finishing a call. Do not turn that normal barge-in
                        # race into an ASGI traceback.
                        socket_closed = True

                scheduler = _TextToSpeechScheduler(on_audio, generation_id, voice)
                await websocket.send_json({"type": "ready", "generation_id": generation_id})
            elif message_type == "text_delta" and scheduler:
                if payload.get("generation_id") in {None, "", scheduler.generation_id}:
                    await scheduler.push_text(str(payload.get("text") or ""))
            elif message_type == "finish" and scheduler:
                if payload.get("generation_id") not in {None, "", scheduler.generation_id}:
                    continue
                generation_id = scheduler.generation_id
                await scheduler.finish()
                if not socket_closed:
                    await websocket.send_json({"type": "done", "generation_id": generation_id})
                scheduler = None
            elif message_type == "cancel":
                generation_id = scheduler.generation_id if scheduler else payload.get("generation_id", "")
                if scheduler:
                    scheduler.cancel()
                    scheduler = None
                if not socket_closed:
                    await websocket.send_json({"type": "cancelled", "generation_id": generation_id})
    except (WebSocketDisconnect, RuntimeError):
        if scheduler:
            scheduler.cancel()


async def synthesize_gemini_wav(text: str, voice: str = "", api_key: str = "") -> bytes:
    """One-shot text -> WAV, for the simple /api/tts REST endpoint."""
    pcm = await gemini_client.synthesize(text, voice, api_key=api_key)
    return pcm16_to_wav(pcm, 24000)
