"""Compatibility shim; new code must use the shared Kokoro engine."""

from ..speech.kokoro_engine import KokoroEngine


class PiperTTS(KokoroEngine):
    """Deprecated name retained for third-party imports during migration."""

    async def synthesize(self, text: str) -> bytes:
        from ..speech.audio import float_audio_to_pcm16
        from ..speech.contracts import SpeechPerformanceSegment
        segment = SpeechPerformanceSegment(text=text, language="en")
        samples = await super().synthesize(segment)
        return float_audio_to_pcm16(samples)
