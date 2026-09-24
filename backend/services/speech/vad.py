from __future__ import annotations

import logging
import threading
from collections import deque
from typing import Optional

import numpy as np

logger = logging.getLogger(__name__)


class AdaptiveVAD:
    """Silero VAD with conservative adaptive-energy fallback and shared state."""

    def __init__(self, sample_rate: int = 16000):
        self.sample_rate = sample_rate
        self._model = None
        self._silero_error: Optional[str] = None
        self._noise_floor = 0.008
        self._lock = threading.Lock()

    def _ensure_model(self):
        if self._model is not None or self._silero_error:
            return
        with self._lock:
            if self._model is not None or self._silero_error:
                return
            try:
                from silero_vad import load_silero_vad
                self._model = load_silero_vad(onnx=True)
            except Exception as exc:
                self._silero_error = str(exc)
                logger.warning("Silero VAD unavailable; using adaptive energy gate: %s", exc)

    def health(self) -> dict:
        self._ensure_model()
        return {"engine": "silero-vad", "ready": self._model is not None, "error": self._silero_error}

    def is_speech(self, pcm16: bytes) -> bool:
        if not pcm16:
            return False
        samples = np.frombuffer(pcm16, dtype="<i2").astype(np.float32) / 32768.0
        rms = float(np.sqrt(np.mean(np.square(samples)))) if samples.size else 0.0
        self._ensure_model()
        if self._model is not None:
            try:
                import torch
                usable = samples[: (len(samples) // 512) * 512]
                if usable.size:
                    window = torch.from_numpy(usable).reshape(-1, 512)
                    scores = [float(self._model(chunk, self.sample_rate)) for chunk in window]
                    return max(scores, default=0.0) >= 0.52
            except Exception as exc:
                logger.debug("Silero frame failed, using energy gate: %s", exc)
        # Learn noise only on quiet frames. This avoids a loud utterance
        # permanently raising the threshold for the next turn.
        if rms < max(0.025, self._noise_floor * 2.0):
            self._noise_floor = min(0.08, self._noise_floor * 0.985 + rms * 0.015)
        return rms >= max(0.018, self._noise_floor * 2.35)


class VADTurnTracker:
    """Adds pre-roll and stable speech gates around frame-level VAD results."""

    def __init__(self, vad: AdaptiveVAD, pre_roll_frames: int = 4, hangover_frames: int = 4, start_frames: int = 2):
        self.vad = vad
        self.pre_roll = deque(maxlen=max(0, pre_roll_frames))
        self.hangover_frames = max(1, hangover_frames)
        self.start_frames = max(1, start_frames)
        self.in_speech = False
        self._positive = 0
        self._quiet = 0

    def feed(self, frame: bytes) -> tuple[str, bool]:
        speaking = self.vad.is_speech(frame)
        self.pre_roll.append(frame)
        if not self.in_speech:
            self._positive = self._positive + 1 if speaking else 0
            if self._positive >= self.start_frames:
                self.in_speech = True
                self._quiet = 0
                return "speech_start", True
            return "quiet", False
        if speaking:
            self._quiet = 0
            return "speech", True
        self._quiet += 1
        if self._quiet >= self.hangover_frames:
            self.in_speech = False
            self._positive = 0
            self._quiet = 0
            return "speech_end", False
        return "hangover", True

    def take_pre_roll(self) -> bytes:
        return b"".join(self.pre_roll)

    def reset(self) -> None:
        self.pre_roll.clear()
        self.in_speech = False
        self._positive = 0
        self._quiet = 0


_VAD_ENGINE = AdaptiveVAD()


def get_vad_engine() -> AdaptiveVAD:
    return _VAD_ENGINE
