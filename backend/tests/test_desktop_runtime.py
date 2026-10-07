"""Run: .venv312/Scripts/python.exe -m unittest tests.test_desktop_runtime -q"""
import asyncio
import os
import sys
import unittest
from unittest.mock import AsyncMock, patch

import numpy as np
import main
from services.speech.vad import AdaptiveVAD


class DesktopRuntimeTests(unittest.TestCase):
    def test_cloud_startup_does_not_load_kokoro_and_explicit_opt_in_works(self):
        async def run():
            warm = AsyncMock()
            with patch.object(main, "get_kokoro_engine") as engine:
                engine.return_value.warm = warm
                with patch.dict(os.environ, {}, clear=True):
                    await main.warm_local_kokoro()
                    await asyncio.sleep(0)
                    engine.assert_not_called()
                with patch.dict(os.environ, {"CLAVIS_WARM_KOKORO": "true"}):
                    await main.warm_local_kokoro()
                    await asyncio.sleep(0)
                    warm.assert_awaited_once()
        asyncio.run(run())

    def test_cloud_vad_shares_onnx_and_does_not_import_torch(self):
        from faster_whisper.vad import get_vad_model
        vad = AdaptiveVAD()
        self.assertTrue(vad.health()["ready"])
        self.assertIs(vad._model, get_vad_model())
        self.assertFalse(vad.is_speech(b"\0" * 1024))
        # Both speech decisions still go through the ONNX model.
        with patch.object(vad, "_model", return_value=np.array([.8])):
            self.assertTrue(vad.is_speech(b"\0" * 1024))
        self.assertNotIn("torch", sys.modules)


if __name__ == "__main__":
    unittest.main()
