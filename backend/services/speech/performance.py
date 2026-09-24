from __future__ import annotations

import hashlib
import re
from typing import Dict, Iterable, List, Optional

from .contracts import ConversationState, ReactionEvent, SpeechPerformanceSegment, new_generation_id
from .language_router import route_clauses


PROFILES: Dict[str, Dict[str, float]] = {
    "calm": {"rate": 0.98, "pitch": -0.02, "energy": 0.78, "pause": 135},
    "confident": {"rate": 1.01, "pitch": -0.01, "energy": 0.86, "pause": 115},
    "curious": {"rate": 1.00, "pitch": 0.04, "energy": 0.82, "pause": 145},
    "thinking": {"rate": 0.94, "pitch": -0.03, "energy": 0.72, "pause": 205},
    "concerned": {"rate": 0.96, "pitch": -0.04, "energy": 0.74, "pause": 180},
    "amused": {"rate": 1.00, "pitch": 0.02, "energy": 0.82, "pause": 130},
    "urgent": {"rate": 1.06, "pitch": 0.02, "energy": 0.90, "pause": 95},
    "firm": {"rate": 0.97, "pitch": -0.05, "energy": 0.88, "pause": 145},
    "apologetic": {"rate": 0.95, "pitch": -0.03, "energy": 0.68, "pause": 180},
    "serious": {"rate": 0.95, "pitch": -0.04, "energy": 0.80, "pause": 170},
    "relieved": {"rate": 0.99, "pitch": 0.01, "energy": 0.80, "pause": 130},
    "whisper": {"rate": 0.96, "pitch": -0.03, "energy": 0.52, "pause": 160},
}


class SpeechPerformancePlanner:
    """Deterministic, low-latency speech direction; it never calls an LLM."""

    def __init__(self, reaction_budget: int = 2):
        self.reaction_budget = max(0, min(3, reaction_budget))

    @staticmethod
    def emotion_for(text: str, state: Optional[ConversationState] = None) -> str:
        value = text.lower()
        if re.search(r"\b(whisper|quietly|softly|confidential|secret|धीरे|धीमी)\b", value):
            return "whisper"
        if state and state.mood in {"whisper", "confidential_whisper"}:
            return "whisper"
        if re.search(r"\b(sorry|apolog|maaf|galti)\b", value):
            return "apologetic"
        if re.search(r"\b(urgent|immediately|jaldi|abhi|warning|alert|danger)\b", value):
            return "urgent"
        if re.search(r"\b(careful|concern|problem|issue|risk|dhyan)\b", value):
            return "concerned"
        if re.search(r"\b(haha|funny|nice one|mazak|amusing)\b", value):
            return "amused"
        if re.search(r"\b(think|checking|analy|calculat|dekh raha|soch)\b", value):
            return "thinking"
        if state and state.urgency > 0.75:
            return "urgent"
        if state and state.user_sentiment in {"frustrated", "angry"}:
            return "concerned"
        return "calm"

    @staticmethod
    def _reaction_for(clause: str, index: int, emotion: str, budget: int, generation_id: str):
        if budget <= 0 or index > 0:
            return None
        lowered = clause.lower()
        if re.search(r"\b(samajh gaya|got it|understood|theek hai|done)\b", lowered):
            digest = hashlib.sha256(f"{generation_id}:{clause}".encode()).digest()[0]
            if digest % 5 == 0:
                return ReactionEvent("mm_ack", 0.28)
        if emotion == "thinking" and len(clause.split()) > 5:
            return ReactionEvent("hmm_thinking", 0.26)
        if emotion == "amused":
            return ReactionEvent("soft_chuckle", 0.24)
        return None

    def plan(
        self,
        text: str,
        state: Optional[ConversationState] = None,
        generation_id: Optional[str] = None,
        voice_settings: Optional[Dict[str, object]] = None,
    ) -> List[SpeechPerformanceSegment]:
        generation = generation_id or new_generation_id()
        state = state or ConversationState()
        voice_settings = voice_settings or {}
        try:
            user_rate = max(0.86, min(1.12, float(voice_settings.get("rate", 1.0))))
        except (TypeError, ValueError):
            user_rate = 1.0
        try:
            pause_intensity = max(0.0, min(1.0, float(voice_settings.get("pause_intensity", 0.45))))
        except (TypeError, ValueError):
            pause_intensity = 0.45
        try:
            reaction_intensity = max(0.0, min(1.0, float(voice_settings.get("reaction_intensity", 0.25))))
        except (TypeError, ValueError):
            reaction_intensity = 0.25
        reaction_budget = 0 if reaction_intensity <= 0.02 else self.reaction_budget
        clauses = route_clauses(text)
        segments: List[SpeechPerformanceSegment] = []
        remaining = self.reaction_budget
        for index, clause in enumerate(clauses):
            clause_text = clause["text"]
            emotion = self.emotion_for(clause_text, state)
            profile = PROFILES[emotion]
            reaction = self._reaction_for(clause_text, index, emotion, min(remaining, reaction_budget), generation)
            if reaction:
                remaining -= 1
            emphasis = []
            if emotion in {"urgent", "firm", "confident"}:
                emphasis = re.findall(r"\b(?:important|critical|zaroori|abhi|now)\b", clause_text, flags=re.I)[:2]
            segments.append(SpeechPerformanceSegment(
                text=clause_text,
                language=clause["language"],
                source_language=clause["source_language"],
                emotion=emotion,
                intensity=max(0.0, min(1.0, state.intensity)),
                delivery="soft_whisper" if emotion == "whisper" else emotion,
                rate=max(0.82, min(1.18, profile["rate"] * user_rate)),
                pitch_tendency=profile["pitch"],
                energy=profile["energy"],
                emphasis=emphasis,
                pause_before_ms=0 if index == 0 else 80,
                pause_after_ms=max(45, min(300, int(profile["pause"] * (0.72 + pause_intensity * 0.56)))),
                reaction=reaction,
                voice=str(voice_settings.get("hi_voice" if clause["language"] == "hi" else "en_voice") or "") or None,
                generation_id=generation,
            ))
        return segments
