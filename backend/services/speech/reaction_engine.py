from __future__ import annotations

import hashlib
from dataclasses import dataclass
from pathlib import Path
from typing import Optional


REACTION_KINDS = (
    "hmm",
    "uhm",
    "mm",
    "breath",
    "sigh",
    "soft_chuckle",
    "realization",
    "surprise",
)


@dataclass(frozen=True)
class ReactionAsset:
    kind: str
    path: Path


class ReactionAssetRegistry:
    """Deterministic, offline-only reaction inventory.

    Missing WAVs are a valid installation state: the speech planner can still
    expose the reaction decision without blocking Kokoro or fetching media.
    """

    def __init__(self, root: Optional[Path] = None):
        self.root = root or Path(__file__).resolve().parents[3] / "audio" / "reactions"

    def get(self, kind: str) -> Optional[ReactionAsset]:
        if kind not in REACTION_KINDS:
            return None
        path = self.root / f"{kind}.wav"
        return ReactionAsset(kind, path) if path.is_file() else None

    def choose(self, kind: str, generation_id: str, clause: str) -> Optional[ReactionAsset]:
        # Stable selection prevents a repeated render from changing delivery.
        asset = self.get(kind)
        if not asset:
            return None
        digest = hashlib.sha256(f"{generation_id}:{clause}:{kind}".encode()).digest()
        return asset if digest[0] >= 0 else None
