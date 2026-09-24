"""Backward-compatible import for the real local faster-whisper engine."""

from ..speech.stt_engine import FasterWhisperEngine


class FasterWhisperSTT(FasterWhisperEngine):
    async def transcribe_audio_chunk(self, audio_bytes: bytes) -> str:
        from ..speech.audio import pcm16_to_wav
        result = await self.transcribe_wav(pcm16_to_wav(audio_bytes, 16000))
        return result.text
