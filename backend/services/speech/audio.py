from __future__ import annotations

import io
import math
import wave

import numpy as np

try:
    from scipy.signal import resample_poly
except Exception:  # pragma: no cover - the production bundle includes scipy
    resample_poly = None


SAMPLE_RATE = 24000


def float_audio_to_pcm16(samples: np.ndarray) -> bytes:
    values = np.asarray(samples, dtype=np.float32).reshape(-1)
    values = np.nan_to_num(values, nan=0.0, posinf=0.0, neginf=0.0)
    peak = float(np.max(np.abs(values))) if values.size else 0.0
    if peak > 0.98:
        values = values * (0.98 / peak)
    return (np.clip(values, -1.0, 1.0) * 32767.0).astype("<i2").tobytes()


def pcm16_to_float(audio: bytes) -> np.ndarray:
    if not audio:
        return np.zeros(0, dtype=np.float32)
    return np.frombuffer(audio, dtype="<i2").astype(np.float32) / 32768.0


def resample_pcm16(audio: bytes, source_rate: int, target_rate: int) -> bytes:
    if source_rate == target_rate or not audio:
        return audio
    if resample_poly is None:
        raise RuntimeError("scipy is required for production-quality audio resampling")
    samples = pcm16_to_float(audio)
    divisor = math.gcd(int(source_rate), int(target_rate))
    resampled = resample_poly(samples, target_rate // divisor, source_rate // divisor, window=("kaiser", 7.86))
    target_length = max(1, round(len(samples) * target_rate / source_rate))
    return float_audio_to_pcm16(np.asarray(resampled[:target_length], dtype=np.float32))


def apply_micro_fade(samples: np.ndarray, sample_rate: int = SAMPLE_RATE, fade_ms: int = 8) -> np.ndarray:
    values = np.asarray(samples, dtype=np.float32).copy()
    count = min(len(values) // 2, max(1, round(sample_rate * fade_ms / 1000)))
    if count:
        ramp = np.linspace(0.0, 1.0, count, dtype=np.float32)
        values[:count] *= ramp
        values[-count:] *= ramp[::-1]
    return values


def apply_whisper_processing(samples: np.ndarray, sample_rate: int = SAMPLE_RATE, mode: str = "soft_whisper") -> np.ndarray:
    values = np.asarray(samples, dtype=np.float32).copy()
    if not len(values) or not mode:
        return values
    gain = {"soft_whisper": 0.62, "urgent_whisper": 0.68, "confidential_whisper": 0.55}.get(mode, 0.62)
    spectrum = np.fft.rfft(values)
    frequencies = np.fft.rfftfreq(len(values), 1.0 / sample_rate)
    shaping = np.ones_like(frequencies, dtype=np.float32)
    shaping[frequencies < 140] *= 0.55
    shaping[frequencies > 6500] *= 0.72
    shaped = np.fft.irfft(spectrum * shaping, n=len(values)).astype(np.float32)
    return apply_micro_fade(shaped * gain, sample_rate)


def normalize_and_limit(samples: np.ndarray, target_rms: float = 0.16, ceiling: float = 0.93) -> np.ndarray:
    values = np.asarray(samples, dtype=np.float32)
    if not len(values):
        return values
    rms = float(np.sqrt(np.mean(np.square(values))))
    if rms > 0.0001:
        values = values * min(1.25, target_rms / rms)
    return np.tanh(values / max(ceiling, 0.1)) * ceiling


def add_pause(audio: bytes, pause_ms: int, sample_rate: int = SAMPLE_RATE) -> bytes:
    if pause_ms <= 0:
        return audio
    silence = np.zeros(round(sample_rate * pause_ms / 1000), dtype=np.float32)
    return audio + float_audio_to_pcm16(silence)


def crossfade_pcm16(first: bytes, second: bytes, sample_rate: int = SAMPLE_RATE, fade_ms: int = 8) -> bytes:
    """Join two mono PCM16 buffers without a click at the join."""
    if not first:
        return second
    if not second:
        return first
    left = pcm16_to_float(first)
    right = pcm16_to_float(second)
    overlap = min(len(left), len(right), max(1, round(sample_rate * fade_ms / 1000)))
    if overlap <= 0:
        return first + second
    blend = np.linspace(0.0, 1.0, overlap, dtype=np.float32)
    joined = np.concatenate((
        left[:-overlap],
        left[-overlap:] * (1.0 - blend) + right[:overlap] * blend,
        right[overlap:],
    ))
    return float_audio_to_pcm16(joined)


def mix_pcm16(chunks: list[bytes], sample_rate: int = SAMPLE_RATE, crossfade_ms: int = 8) -> bytes:
    """Bounded 24 kHz mono mixer used by streaming and compatibility TTS."""
    output = b""
    for chunk in chunks:
        output = crossfade_pcm16(output, chunk, sample_rate, crossfade_ms)
    return output


def pcm16_to_wav(audio: bytes, sample_rate: int = SAMPLE_RATE) -> bytes:
    output = io.BytesIO()
    with wave.open(output, "wb") as wav:
        wav.setnchannels(1)
        wav.setsampwidth(2)
        wav.setframerate(sample_rate)
        wav.writeframes(audio)
    return output.getvalue()


def wav_to_pcm16(data: bytes) -> tuple[bytes, int]:
    with wave.open(io.BytesIO(data), "rb") as wav:
        return wav.readframes(wav.getnframes()), wav.getframerate()
