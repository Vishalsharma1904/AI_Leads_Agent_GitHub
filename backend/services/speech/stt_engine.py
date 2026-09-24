from __future__ import annotations

import asyncio
import io
import logging
import os
import wave
from dataclasses import dataclass
from typing import Optional

import numpy as np

logger = logging.getLogger(__name__)


@dataclass
class STTResult:
    text: str
    language: str = ""
    duration: float = 0.0

    def to_dict(self) -> dict:
        return {"text": self.text, "language": self.language, "duration": self.duration}


class FasterWhisperEngine:
    def __init__(self):
        self.model_size = os.getenv("CLAVIS_WHISPER_MODEL", "large-v3-turbo")
        self.device = os.getenv("CLAVIS_WHISPER_DEVICE", "cpu")
        self.compute_type = os.getenv("CLAVIS_WHISPER_COMPUTE", "int8")
        self._model = None
        self._error: Optional[str] = None
        self._load_lock = asyncio.Lock()
        self._inference_lock = asyncio.Lock()

    @property
    def ready(self) -> bool:
        return self._model is not None and self._error is None

    def health(self) -> dict:
        return {
            "engine": "faster-whisper",
            "ready": self.ready,
            "error": self._error,
            "model": self.model_size,
            "device": self.device,
            "compute_type": self.compute_type,
        }

    def _load_sync(self):
        if self._model is not None:
            return
        try:
            from faster_whisper import WhisperModel
            self._model = WhisperModel(self.model_size, device=self.device, compute_type=self.compute_type)
            self._error = None
        except Exception as exc:
            self._error = f"faster-whisper unavailable: {exc}"
            raise RuntimeError(self._error) from exc

    async def _ensure_loaded(self):
        if self._model is not None:
            return
        async with self._load_lock:
            if self._model is None:
                await asyncio.to_thread(self._load_sync)

    @staticmethod
    def _decode_wav(data: bytes) -> tuple[np.ndarray, int]:
        with wave.open(io.BytesIO(data), "rb") as wav:
            channels = wav.getnchannels()
            rate = wav.getframerate()
            sample_width = wav.getsampwidth()
            frames = wav.readframes(wav.getnframes())
        if sample_width != 2:
            raise ValueError("Only PCM16 WAV input is supported")
        samples = np.frombuffer(frames, dtype="<i2").astype(np.float32) / 32768.0
        if channels > 1:
            samples = samples.reshape(-1, channels).mean(axis=1)
        return samples, rate

    def _transcribe_sync(self, audio: bytes, language_hint: str = "") -> STTResult:
        self._load_sync()
        samples, rate = self._decode_wav(audio)
        segments, info = self._model.transcribe(
            samples,
            language=language_hint if language_hint and language_hint.lower() not in {"auto", "detect"} else None,
            beam_size=1,
            best_of=1,
            temperature=0.0,
            condition_on_previous_text=False,
            vad_filter=True,
            vad_parameters={"min_silence_duration_ms": 350},
        )
        text = " ".join((segment.text or "").strip() for segment in segments).strip()
        return STTResult(text=text, language=getattr(info, "language", ""), duration=len(samples) / max(rate, 1))

    async def transcribe_wav(self, audio: bytes, language_hint: str = "") -> STTResult:
        await self._ensure_loaded()
        async with self._inference_lock:
            return await asyncio.to_thread(self._transcribe_sync, audio, language_hint)


_ENGINE = FasterWhisperEngine()


def get_stt_engine() -> FasterWhisperEngine:
    return _ENGINE
