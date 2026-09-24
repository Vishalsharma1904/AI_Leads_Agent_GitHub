from __future__ import annotations

import asyncio
import logging
import os
import re
import threading
from pathlib import Path
from typing import Dict, Optional

import numpy as np

from .audio import SAMPLE_RATE, apply_micro_fade, apply_whisper_processing, normalize_and_limit
from .contracts import SpeechPerformanceSegment

logger = logging.getLogger(__name__)


class SpeechUnavailable(RuntimeError):
    pass


class KokoroEngine:
    """A lazy, singleton Kokoro engine shared by browser and Exotel paths."""

    SAMPLE_RATE = SAMPLE_RATE

    def __init__(self):
        self._pipelines: Dict[str, object] = {}
        self._model = None
        self._lock = threading.Lock()
        self._inference_lock = threading.Lock()
        self._load_error: Optional[str] = None
        self._loading = False
        self.model_name = os.getenv("CLAVIS_KOKORO_MODEL", "hexgrad/Kokoro-82M")
        self.english_voice = os.getenv("CLAVIS_KOKORO_EN_VOICE", "bm_george")
        self.hindi_voice = os.getenv("CLAVIS_KOKORO_HI_VOICE", "hm_omega")
        self.device = os.getenv("CLAVIS_KOKORO_DEVICE", "cpu")

    @property
    def ready(self) -> bool:
        return bool(self._pipelines) and not self._load_error

    def health(self) -> dict:
        return {
            "engine": "kokoro",
            "ready": self.ready,
            "loading": self._loading,
            "error": self._load_error,
            "voices": {"en": self.english_voice, "hi": self.hindi_voice},
            "sample_rate": self.SAMPLE_RATE,
            "model": self.model_name,
            "device": self.device,
        }

    def _ensure_loaded(self) -> None:
        if self.ready:
            return
        with self._lock:
            if self.ready:
                return
            self._loading = True
            try:
                import torch
                from kokoro import KModel, KPipeline
                # Small CPU machines are faster and more predictable when
                # inference does not oversubscribe their cores. This is
                # configurable for a workstation/GPU bundle.
                requested_threads = int(os.getenv("CLAVIS_KOKORO_THREADS", "0") or 0)
                if requested_threads <= 0:
                    requested_threads = max(1, min(4, os.cpu_count() or 1))
                if requested_threads > 0:
                    try:
                        torch.set_num_threads(requested_threads)
                        torch.set_num_interop_threads(1)
                    except RuntimeError:
                        # Another local torch consumer may have configured
                        # global thread pools already; keep its safe setting.
                        pass
                # Kokoro's official multi-language pattern is one KModel plus
                # one lightweight KPipeline per language. Do not construct a
                # second neural model for Hindi.
                model_path = Path(self.model_name)
                if model_path.is_dir():
                    config_path = model_path / "config.json"
                    weights_path = model_path / "kokoro-v1_0.pth"
                    if not config_path.exists() or not weights_path.exists():
                        raise FileNotFoundError(
                            f"Bundled Kokoro model is incomplete: {model_path}"
                        )
                    self._model = KModel(
                        repo_id="hexgrad/Kokoro-82M",
                        config=str(config_path),
                        model=str(weights_path),
                    )
                else:
                    self._model = KModel(repo_id=self.model_name)
                if hasattr(self._model, "to"):
                    self._model = self._model.to(self.device)
                if hasattr(self._model, "eval"):
                    self._model.eval()
                self._pipelines["en"] = KPipeline(
                    lang_code="b", repo_id="hexgrad/Kokoro-82M", model=self._model, device=self.device
                )
                self._pipelines["hi"] = KPipeline(
                    lang_code="h", repo_id="hexgrad/Kokoro-82M", model=self._model, device=self.device
                )
                self._load_error = None
            except Exception as exc:
                self._pipelines.clear()
                self._model = None
                self._load_error = f"Kokoro unavailable: {exc}"
                raise SpeechUnavailable(self._load_error) from exc
            finally:
                self._loading = False

    def _resolve_voice(self, language: str, requested: Optional[str] = None) -> str:
        default_voice = self.hindi_voice if language == "hi" else self.english_voice
        candidate = str(requested or default_voice)
        if not re.fullmatch(r"[a-z]{2}_[a-z0-9_]+", candidate):
            candidate = default_voice
        model_path = Path(self.model_name)
        local_voice = model_path / "voices" / f"{candidate}.pt"
        return str(local_voice) if model_path.is_dir() and local_voice.exists() else candidate

    def _warm_sync(self) -> None:
        self._ensure_loaded()
        for language, voice in (("en", self.english_voice), ("hi", self.hindi_voice)):
            self._pipelines[language].load_voice(self._resolve_voice(language, voice))

    async def warm(self) -> None:
        await asyncio.to_thread(self._warm_sync)

    def _synthesize_sync(self, segment: SpeechPerformanceSegment) -> np.ndarray:
        with self._inference_lock:
            self._ensure_loaded()
            pipeline = self._pipelines["hi" if segment.language == "hi" else "en"]
            # Voice IDs come from a browser setting/WS payload. Keep them as
            # Kokoro inventory IDs only; never allow an arbitrary local .pt
            # path or path traversal into torch.load().
            voice = self._resolve_voice(segment.language, segment.voice)
            chunks = []
            for _, _, audio in pipeline(segment.text, voice=voice, speed=segment.rate):
                chunks.append(np.asarray(audio, dtype=np.float32).reshape(-1))
            if not chunks:
                return np.zeros(0, dtype=np.float32)
            audio = np.concatenate(chunks)
            if segment.delivery in {"soft_whisper", "urgent_whisper", "confidential_whisper"}:
                audio = apply_whisper_processing(audio, self.SAMPLE_RATE, segment.delivery)
            audio = normalize_and_limit(audio)
            return apply_micro_fade(audio, self.SAMPLE_RATE)

    async def synthesize(self, segment: SpeechPerformanceSegment) -> np.ndarray:
        return await asyncio.to_thread(self._synthesize_sync, segment)


_ENGINE = KokoroEngine()


def get_kokoro_engine() -> KokoroEngine:
    return _ENGINE
