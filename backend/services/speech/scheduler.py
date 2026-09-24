from __future__ import annotations

import asyncio
import logging
import re
from typing import Awaitable, Callable, Optional

import numpy as np

from .audio import add_pause, crossfade_pcm16, float_audio_to_pcm16, wav_to_pcm16
from .contracts import ConversationState, SpeechPerformanceSegment, new_generation_id
from .kokoro_engine import KokoroEngine
from .performance import SpeechPerformancePlanner
from .reaction_engine import ReactionAssetRegistry

logger = logging.getLogger(__name__)

AudioCallback = Callable[[bytes, SpeechPerformanceSegment], Awaitable[None]]
_STOP = object()


def _stable_prefix(text: str, max_chars: int = 180) -> tuple[str, str]:
    """Return only complete spoken clauses and retain every remainder byte-for-byte."""
    value = str(text or "")
    if not value.strip():
        return "", value

    # A punctuation boundary is stable only once it is followed by whitespace
    # (or the stream has explicitly ended). This prevents "Wait." + "ing" from
    # becoming two spoken segments when the provider emits small deltas.
    boundary = 0
    for match in re.finditer(r"[.!?।]+(?=\s+|$)", value):
        boundary = match.end()

    # Long provider chunks still need bounded latency. Split at the last word
    # boundary before max_chars, never in the middle of a token.
    if not boundary and len(value) >= max_chars:
        candidate = value[:max_chars]
        cut = candidate.rfind(" ")
        if cut >= 40:
            boundary = cut

    if not boundary:
        return "", value
    return value[:boundary].strip(), value[boundary:].lstrip()


class SpeechScheduler:
    """Lossless clause-aware scheduler with one Kokoro worker and two-item queue."""

    def __init__(
        self,
        engine: KokoroEngine,
        on_audio: AudioCallback,
        state: Optional[ConversationState] = None,
        generation_id: Optional[str] = None,
        voice_settings: Optional[dict] = None,
    ):
        self.engine = engine
        self.on_audio = on_audio
        self.state = state or ConversationState()
        self.generation_id = generation_id or new_generation_id()
        self.planner = SpeechPerformancePlanner()
        self.voice_settings = voice_settings or {}
        self.reactions = ReactionAssetRegistry()
        self.queue: asyncio.Queue = asyncio.Queue(maxsize=2)
        self._worker: Optional[asyncio.Task] = None
        self._cancelled = False
        self._closing = False
        self._text_buffer = ""

    @property
    def buffered_text(self) -> str:
        return self._text_buffer

    def start(self) -> None:
        if self._worker is None or self._worker.done():
            self._worker = asyncio.create_task(self._run(), name=f"speech-{self.generation_id[:8]}")

    async def push_text(self, text: str) -> None:
        if self._cancelled or self._closing:
            return
        self.start()
        self._text_buffer += str(text or "")
        while True:
            prefix, remainder = _stable_prefix(self._text_buffer)
            if not prefix:
                break
            self._text_buffer = remainder
            for planned in self.planner.plan(prefix, self.state, self.generation_id, self.voice_settings):
                await self._enqueue(planned)

    async def finish(self) -> None:
        if self._cancelled or self._closing:
            return
        self._closing = True
        final = self._text_buffer.strip()
        self._text_buffer = ""
        if final:
            for planned in self.planner.plan(final, self.state, self.generation_id, self.voice_settings):
                await self._enqueue(planned)
        if self._worker:
            await self.queue.join()
            await self.queue.put(_STOP)
            await self._worker
            self._worker = None

    async def cancel(self) -> None:
        self._cancelled = True
        self._closing = True
        self._text_buffer = ""
        while True:
            try:
                item = self.queue.get_nowait()
            except asyncio.QueueEmpty:
                break
            else:
                self.queue.task_done()
                if item is _STOP:
                    break
        if self._worker and not self._worker.done():
            self._worker.cancel()
            try:
                await self._worker
            except asyncio.CancelledError:
                pass
        self._worker = None

    async def _enqueue(self, segment: SpeechPerformanceSegment) -> None:
        if not self._cancelled and segment.generation_id == self.generation_id:
            await self.queue.put(segment)

    async def _run(self) -> None:
        while True:
            try:
                segment = await self.queue.get()
            except asyncio.CancelledError:
                raise
            if segment is _STOP:
                self.queue.task_done()
                return
            try:
                audio = await self.engine.synthesize(segment)
                if self._cancelled or segment.generation_id != self.generation_id:
                    continue
                pcm = float_audio_to_pcm16(audio)
                if segment.reaction:
                    reaction_kind = {"mm_ack": "mm", "hmm_thinking": "hmm"}.get(segment.reaction.kind, segment.reaction.kind)
                    asset = self.reactions.get(reaction_kind)
                    if asset:
                        reaction_pcm, _ = wav_to_pcm16(asset.path.read_bytes())
                        pcm = crossfade_pcm16(reaction_pcm, add_pause(b"", 70) + pcm)
                pcm = add_pause(pcm, segment.pause_before_ms)
                pcm = add_pause(pcm, segment.pause_after_ms)
                await self.on_audio(pcm, segment)
            except asyncio.CancelledError:
                raise
            except Exception:
                logger.exception("Speech segment failed")
            finally:
                self.queue.task_done()
