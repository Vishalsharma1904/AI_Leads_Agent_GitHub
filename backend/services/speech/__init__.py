"""Local speech-performance primitives used by Clavis desktop and telephony."""

from .contracts import ConversationState, SpeechPerformanceSegment, new_generation_id
from .language_router import clean_for_speech, route_clauses
from .performance import SpeechPerformancePlanner
from .reaction_engine import ReactionAssetRegistry

__all__ = [
    "ConversationState",
    "SpeechPerformanceSegment",
    "SpeechPerformancePlanner",
    "clean_for_speech",
    "new_generation_id",
    "route_clauses",
    "ReactionAssetRegistry",
]
