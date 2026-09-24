"""Generate tiny deterministic offline reaction placeholders for the local mixer.

They are intentionally restrained non-verbal textures, not a cloned person's
voice. A production voice pack can replace these WAVs without changing code.
"""

from pathlib import Path
import math
import struct
import wave

RATE = 24000
OUT = Path(__file__).resolve().parents[1] / "audio" / "reactions"

SPECS = {
    "hmm": (0.22, 145, 185),
    "uhm": (0.26, 125, 165),
    "mm": (0.18, 170, 205),
    "breath": (0.30, 0, 0),
    "sigh": (0.45, 0, 0),
    "soft_chuckle": (0.32, 220, 280),
    "realization": (0.22, 360, 520),
    "surprise": (0.16, 300, 620),
}


def write_asset(name: str, duration: float, start_hz: float, end_hz: float) -> None:
    count = int(RATE * duration)
    values = []
    for i in range(count):
        t = i / RATE
        progress = i / max(1, count - 1)
        envelope = min(1.0, i / (RATE * 0.035), (count - i) / (RATE * 0.08))
        if start_hz:
            hz = start_hz + (end_hz - start_hz) * progress
            sample = 0.11 * math.sin(2 * math.pi * hz * t) + 0.035 * math.sin(2 * math.pi * hz * 2.01 * t)
        else:
            sample = 0.018 * math.sin(2 * math.pi * 90 * t) + 0.006 * math.sin(2 * math.pi * 173 * t)
        values.append(int(max(-1, min(1, sample * envelope)) * 32767))
    OUT.mkdir(parents=True, exist_ok=True)
    with wave.open(str(OUT / f"{name}.wav"), "wb") as stream:
        stream.setnchannels(1)
        stream.setsampwidth(2)
        stream.setframerate(RATE)
        stream.writeframes(b"".join(struct.pack("<h", value) for value in values))


if __name__ == "__main__":
    for asset, spec in SPECS.items():
        write_asset(asset, *spec)
    print(f"generated {len(SPECS)} reaction assets in {OUT}")
