from __future__ import annotations

import asyncio
import logging
from typing import Optional

from ..llm.openrouter import OpenRouterService
from ..speech.audio import pcm16_to_wav, resample_pcm16
from ..speech.contracts import ConversationState, new_generation_id
from ..speech.kokoro_engine import get_kokoro_engine
from ..speech.scheduler import SpeechScheduler
from ..speech.stt_engine import get_stt_engine
from ..speech.vad import VADTurnTracker, get_vad_engine
from .state_machine import ConversationStateMachine

logger = logging.getLogger(__name__)

JARVIS_SYSTEM_PROMPT = (
    "You are CLAVIS, a warm, patient, highly professional AI voice calling assistant representing the business "
    "you were configured for. You are speaking on a live phone call, not in a text chat.\n\n"
    "LANGUAGE: Match the caller's Hindi/English mix naturally. Write Hindi in Devanagari for reliable speech "
    "routing; keep technical English terms in English. Never switch language inside a token.\n\n"
    "STYLE: Keep every response SHORT (1-3 sentences), usually 8-22 spoken words per sentence. Be conversational, "
    "calm, precise, and patient. Avoid repetitive fillers such as Sure, Absolutely, and Of course.\n\n"
    "DISCLOSURE: If asked whether you are an AI, be honest and say so briefly, then continue helping naturally.\n\n"
    "BOUNDARIES: Never invent facts about pricing, availability, or commitments the business hasn't authorized. "
    "If unsure, offer to have a human follow up instead of guessing."
)


class VoiceOrchestrator:
    """Concurrent STT -> LLM -> Kokoro pipeline for live Exotel calls."""

    def __init__(self, system_prompt: Optional[str] = None):
        self.llm = OpenRouterService()
        self.stt = get_stt_engine()
        self.tts = get_kokoro_engine()
        self.vad_tracker = VADTurnTracker(get_vad_engine(), pre_roll_frames=4, hangover_frames=4, start_frames=2)
        self.state_machine = ConversationStateMachine()
        self.state = ConversationState()

        self.is_speaking = False
        self.interrupted = False
        self._generation_id = ""
        self._generation_task: Optional[asyncio.Task] = None
        self._scheduler: Optional[SpeechScheduler] = None

        self._audio_buffer = bytearray()

        self.conversation_history = [{
            "role": "system",
            "content": system_prompt or JARVIS_SYSTEM_PROMPT,
        }]

    async def process_user_audio(self, audio_bytes: bytes, audio_handler) -> None:
        """Buffer turns without blocking the receive loop, so barge-in is real."""
        state, active = self.vad_tracker.feed(audio_bytes)
        if state == "speech_start":
            if self.is_speaking:
                await self.interrupt(audio_handler)
            self._audio_buffer.clear()
            self._audio_buffer.extend(self.vad_tracker.take_pre_roll())
            return
        if active or state == "speech_end":
            self._audio_buffer.extend(audio_bytes)
        if state != "speech_end" or not self._audio_buffer:
            return

        buffered = bytes(self._audio_buffer)
        self._audio_buffer.clear()
        self.vad_tracker.reset()
        task = asyncio.create_task(self._respond_to_audio(buffered, audio_handler))
        self._generation_task = task

    async def interrupt(self, audio_handler) -> None:
        """Cancel every future stage before clearing provider playback."""
        if not self.is_speaking and not self._generation_task:
            return
        self.interrupted = True
        self._generation_id = new_generation_id()
        if self._scheduler:
            await self._scheduler.cancel()
            self._scheduler = None
        task = self._generation_task
        if task and task is not asyncio.current_task() and not task.done():
            task.cancel()
            try:
                await task
            except asyncio.CancelledError:
                pass
        self._generation_task = None
        self.is_speaking = False
        if hasattr(audio_handler, "send_clear"):
            await audio_handler.send_clear()

    async def _respond_to_audio(self, buffered: bytes, audio_handler):
        try:
            logger.info("Transcribing buffered utterance locally...")
            result = await self.stt.transcribe_wav(pcm16_to_wav(buffered, 16000))
            user_text = result.text.strip()
            if not user_text:
                return
            logger.info("User said: %s", user_text)
            self.conversation_history.append({"role": "user", "content": user_text})
            self.state_machine.transition("asking", "neutral")
            messages = self.conversation_history.copy()
            messages.append({"role": "system", "content": self.state_machine.get_system_instruction()})
            await self._generate_and_speak(messages, audio_handler)
        except asyncio.CancelledError:
            raise
        except Exception:
            logger.exception("Voice turn failed")
        finally:
            if self._generation_task is asyncio.current_task():
                self._generation_task = None

    async def _generate_and_speak(self, messages, audio_handler):
        generation_id = new_generation_id()
        self._generation_id = generation_id
        self.interrupted = False
        self.is_speaking = True
        full_response = ""

        async def on_audio(audio: bytes, segment):
            if self.interrupted or segment.generation_id != self._generation_id:
                return
            # Kokoro is native 24 kHz; Exotel is configured for 16 kHz.
            await audio_handler.send_audio_chunk(resample_pcm16(audio, 24000, 16000))

        self._scheduler = SpeechScheduler(self.tts, on_audio, self.state, generation_id)
        self._scheduler.start()
        try:
            async for token in self.llm.generate_stream(messages):
                if self.interrupted or generation_id != self._generation_id:
                    break
                full_response += token
                await self._scheduler.push_text(token)
            if not self.interrupted and generation_id == self._generation_id:
                await self._scheduler.finish()
                if full_response.strip():
                    self.conversation_history.append({"role": "assistant", "content": full_response.strip()})
                    await audio_handler.send_mark("turn-end")
        except asyncio.CancelledError:
            raise
        except Exception:
            logger.exception("Generation or local speech failed")
        finally:
            if self._scheduler and self._scheduler.generation_id == generation_id:
                if self.interrupted:
                    await self._scheduler.cancel()
                self._scheduler = None
            if generation_id == self._generation_id:
                self.is_speaking = False
