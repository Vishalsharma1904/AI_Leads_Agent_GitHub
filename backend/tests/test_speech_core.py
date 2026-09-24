import asyncio
import math
import unittest

import numpy as np

from services.speech.audio import crossfade_pcm16, mix_pcm16, pcm16_to_float, resample_pcm16
from services.speech.contracts import ConversationState
from services.speech.language_router import detect_language, route_clauses
from services.speech.performance import SpeechPerformancePlanner
from services.speech.scheduler import SpeechScheduler, _stable_prefix
from services.speech.vad import VADTurnTracker


class FakeVAD:
    def __init__(self, values):
        self.values = iter(values)

    def is_speech(self, _frame):
        return next(self.values)


class FakeEngine:
    async def synthesize(self, _segment):
        return np.zeros(240, dtype=np.float32)


class SpeechCoreTests(unittest.TestCase):
    def test_language_and_clause_routing(self):
        self.assertEqual(detect_language("मुझे यह चाहिए"), "hi")
        self.assertEqual(detect_language("Mujhe ye chahiye sir"), "hinglish")
        routed = route_clauses("I found it. अब इसे खोलो।")
        self.assertEqual([part["language"] for part in routed], ["en", "hi"])
        self.assertEqual(route_clauses("Mujhe ye chahiye sir")[0]["language"], "hi")

    def test_incremental_prefix_is_lossless(self):
        prefix, remainder = _stable_prefix("The first answer is ready. The second")
        self.assertEqual(prefix, "The first answer is ready.")
        self.assertEqual(remainder, "The second")
        prefix, remainder = _stable_prefix(remainder + " answer is here.")
        self.assertEqual(prefix, "The second answer is here.")
        self.assertEqual(remainder, "")

    def test_planner_emotion_pause_and_generation(self):
        segments = SpeechPerformancePlanner().plan(
            "Warning: the deadline is urgent. आराम से, I am checking it.",
            ConversationState(),
            "generation-a",
        )
        self.assertEqual([s.generation_id for s in segments], ["generation-a", "generation-a"])
        self.assertEqual(segments[0].emotion, "urgent")
        self.assertLessEqual(max(s.pause_after_ms for s in segments), 300)

    def test_planner_applies_voice_settings_and_whisper_delivery(self):
        segments = SpeechPerformancePlanner().plan(
            "Quietly, Sir. The confidential update is ready.",
            ConversationState(),
            "generation-whisper",
            {"en_voice": "bm_george", "rate": 1.1, "pause_intensity": 0.9, "reaction_intensity": 0},
        )
        self.assertEqual(segments[0].emotion, "whisper")
        self.assertEqual(segments[0].delivery, "soft_whisper")
        self.assertEqual(segments[0].voice, "bm_george")
        self.assertGreater(segments[0].rate, 0.98)
        self.assertLessEqual(segments[0].pause_after_ms, 300)

    def test_scheduler_finishes_and_rejects_stale_queue(self):
        emitted = []

        async def on_audio(audio, segment):
            emitted.append((audio, segment.generation_id))

        async def run():
            scheduler = SpeechScheduler(FakeEngine(), on_audio, generation_id="g1")
            await scheduler.push_text("First sentence. Second sentence.")
            await scheduler.finish()
            self.assertTrue(emitted)
            self.assertTrue(all(generation == "g1" for _, generation in emitted))
            await scheduler.cancel()

        asyncio.run(run())

    def test_vad_gate_and_hangover(self):
        tracker = VADTurnTracker(FakeVAD([False, True, True, True, False, False, False, False]), hangover_frames=3, start_frames=2)
        frames = [b"x"] * 8
        states = [tracker.feed(frame)[0] for frame in frames]
        self.assertIn("speech_start", states)
        self.assertIn("speech_end", states)

    def test_real_24k_to_16k_resampling(self):
        samples = (0.25 * np.sin(2 * math.pi * 440 * np.arange(2400) / 24000)).astype(np.float32)
        pcm = (samples * 32767).astype("<i2").tobytes()
        converted = resample_pcm16(pcm, 24000, 16000)
        self.assertEqual(len(pcm16_to_float(converted)), 1600)

    def test_mixer_crossfade_is_click_safe_and_bounded(self):
        first = (np.ones(240, dtype=np.float32) * 0.2 * 32767).astype("<i2").tobytes()
        second = (np.ones(240, dtype=np.float32) * -0.2 * 32767).astype("<i2").tobytes()
        mixed = mix_pcm16([first, second], 24000, 8)
        self.assertLessEqual(len(pcm16_to_float(mixed)), len(pcm16_to_float(first)) + len(pcm16_to_float(second)))
        self.assertEqual(mixed, crossfade_pcm16(first, second, 24000, 8))


if __name__ == "__main__":
    unittest.main()
