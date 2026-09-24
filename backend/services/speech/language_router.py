from __future__ import annotations

import re
import unicodedata
from typing import Dict, List


DEVANAGARI_RE = re.compile(r"[\u0900-\u097F]")
ENGLISH_RE = re.compile(r"[A-Za-z]")
CLAUSE_RE = re.compile(r"(.+?(?:[.!?।]+|$))", re.DOTALL)
HINGLISH_MARKERS = {
    "aap", "ap", "main", "mein", "mujhe", "mujh", "hai", "hain", "hoon",
    "kar", "karo", "krdo", "batao", "bnao", "chahiye", "iska", "isko", "se",
    "ke", "ki", "ka", "par", "aur", "abhi", "phir", "nahi", "nahin", "haan",
    "theek", "thik", "suno", "dekho", "bolo", "sir", "ji", "bilkul",
}


def clean_for_speech(text: str) -> str:
    """Remove visual-only syntax without changing normal spoken wording."""
    value = str(text or "")
    value = re.sub(r"\|\|\|?[\s\S]*?\|\|\|?", " ", value)
    value = re.sub(r"https?://\S+", " ", value)
    value = re.sub(r"```[\s\S]*?```", " ", value)
    value = re.sub(r"[*_#~>`]", "", value)
    value = re.sub(r"^\s*[-*•]\s+", "", value, flags=re.MULTILINE)
    value = re.sub(r"\n+", ". ", value)
    value = re.sub(r"\s{2,}", " ", value)
    return value.strip()


def detect_language(text: str) -> str:
    value = str(text or "")
    devanagari = len(DEVANAGARI_RE.findall(value))
    latin = len(ENGLISH_RE.findall(value))
    words = set(re.findall(r"[a-zA-Z']+", value.lower()))
    marker_count = len(words & HINGLISH_MARKERS)
    marker_ratio = marker_count / max(1, len(words))
    if devanagari and devanagari >= max(2, latin * 0.15):
        return "hi"
    # A lone honorific such as "Sir" or "Ji" must not switch an otherwise
    # English clause onto the Hindi voice.
    if marker_count >= 2 and marker_ratio >= 0.18:
        return "hinglish"
    return "en"


def split_clauses(text: str, max_chars: int = 180) -> List[str]:
    """Split at sentence/clause boundaries while preserving words and punctuation."""
    cleaned = clean_for_speech(text)
    if not cleaned:
        return []
    parts: List[str] = []
    for match in CLAUSE_RE.finditer(cleaned):
        candidate = match.group(1).strip()
        if not candidate:
            continue
        if len(candidate) <= max_chars:
            parts.append(candidate)
            continue
        words = candidate.split()
        buffer: List[str] = []
        for word in words:
            next_value = " ".join(buffer + [word])
            if buffer and len(next_value) > max_chars:
                parts.append(" ".join(buffer).strip())
                buffer = [word]
            else:
                buffer.append(word)
        if buffer:
            parts.append(" ".join(buffer).strip())
    return parts or [cleaned]


def route_clauses(text: str) -> List[Dict[str, str]]:
    result: List[Dict[str, str]] = []
    for clause in split_clauses(text):
        source = detect_language(clause)
        # Route Roman Hindi/Hinglish to the Hindi Kokoro pipeline at clause
        # level, while allowing English clauses in the same answer to remain
        # on the English pipeline.
        language = "hi" if source in {"hi", "hinglish"} else "en"
        result.append({"text": clause, "language": language, "source_language": source})
    return result
