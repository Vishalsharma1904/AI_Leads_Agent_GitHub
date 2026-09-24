from __future__ import annotations

from dataclasses import asdict, dataclass, field
from typing import Any, Dict, List, Optional
from uuid import uuid4


def new_generation_id() -> str:
    return uuid4().hex


@dataclass
class ConversationState:
    mood: str = "calm"
    intensity: float = 0.35
    user_sentiment: str = "neutral"
    urgency: float = 0.2
    confidence: float = 0.85
    tension: float = 0.0
    previous_delivery: str = "calm"

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)


@dataclass
class ReactionEvent:
    kind: str
    intensity: float = 0.35

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)


@dataclass
class SpeechPerformanceSegment:
    text: str
    language: str
    source_language: str = "en"
    emotion: str = "calm"
    intensity: float = 0.35
    delivery: str = "calm"
    rate: float = 1.0
    pitch_tendency: float = 0.0
    energy: float = 0.82
    emphasis: List[str] = field(default_factory=list)
    pause_before_ms: int = 0
    pause_after_ms: int = 120
    reaction: Optional[ReactionEvent] = None
    voice: Optional[str] = None
    generation_id: str = ""

    def to_dict(self) -> Dict[str, Any]:
        result = asdict(self)
        if self.reaction:
            result["reaction"] = self.reaction.to_dict()
        return result
