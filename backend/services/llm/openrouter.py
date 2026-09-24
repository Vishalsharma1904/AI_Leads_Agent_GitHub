import os
import json
import logging
from typing import AsyncGenerator, Dict, Any, List

import httpx

logger = logging.getLogger(__name__)


class OpenRouterService:
    """
    Cloud LLM brain for Jarvis's voice-calling pipeline — replaces the local
    Ollama service so the calling agent doesn't need a RAM-hungry local model.

    - Reads keys from OPENROUTER_API_KEYS env var (comma-separated) so multiple
      free-tier keys can be rotated automatically.
    - Reads the model cascade from JARVIS_FREE_MODELS env var (comma-separated),
      defaulting to a sensible free-tier list. On rate limit (429), payment
      required (402), not-found (404) or 5xx, it rotates to the next model
      before rotating to the next key — so the pipeline effectively never
      "runs out" as long as at least one free model/key combo is available.
    """

    BASE_URL = "https://openrouter.ai/api/v1/chat/completions"

    DEFAULT_MODELS = [
        "meta-llama/llama-3.3-70b-instruct:free",
        "deepseek/deepseek-chat-v3.1:free",
        "deepseek/deepseek-r1:free",
        "qwen/qwen-2.5-72b-instruct:free",
        "google/gemini-2.0-flash-exp:free",
        "mistralai/mistral-nemo:free",
    ]

    def __init__(self, api_keys: List[str] = None, models: List[str] = None):
        env_keys = os.getenv("OPENROUTER_API_KEYS", "")
        self.api_keys = api_keys or [k.strip() for k in env_keys.split(",") if k.strip()]

        env_models = os.getenv("JARVIS_FREE_MODELS", "")
        self.models = models or ([m.strip() for m in env_models.split(",") if m.strip()] or self.DEFAULT_MODELS)

        self._key_idx = 0
        self._model_idx = 0

        if not self.api_keys:
            logger.warning(
                "No OpenRouter API keys configured. Set OPENROUTER_API_KEYS in your .env "
                "(get free keys at https://openrouter.ai/keys)."
            )

    def _current_key(self) -> str:
        if not self.api_keys:
            raise RuntimeError("No OpenRouter API keys configured")
        return self.api_keys[self._key_idx % len(self.api_keys)]

    def _current_model(self) -> str:
        return self.models[self._model_idx % len(self.models)]

    def _rotate(self):
        """Move to the next model first; wrap to the next key once all models tried."""
        self._model_idx += 1
        if self._model_idx % len(self.models) == 0:
            self._key_idx += 1

    async def check_health(self) -> bool:
        if not self.api_keys:
            return False
        try:
            async with httpx.AsyncClient(timeout=10.0) as client:
                resp = await client.get(
                    "https://openrouter.ai/api/v1/models",
                    headers={"Authorization": f"Bearer {self._current_key()}"},
                )
                return resp.status_code == 200
        except Exception as e:
            logger.error(f"OpenRouter health check failed: {e}")
            return False

    async def generate_stream(self, messages: List[Dict[str, str]], attempt: int = 0) -> AsyncGenerator[str, None]:
        """
        Streams response text chunks from OpenRouter. Auto-rotates model/key on
        failure and retries, up to (num_keys * num_models) attempts.
        """
        max_attempts = max(1, len(self.api_keys) * len(self.models))
        if attempt >= max_attempts:
            logger.error("OpenRouter: all model/key combinations exhausted.")
            yield "Sorry, I'm having trouble connecting to my AI brain right now."
            return

        key = self._current_key()
        model = self._current_model()

        payload = {
            "model": model,
            "messages": messages,
            "stream": True,
            "temperature": 0.4,
            "max_tokens": 200,  # keep voice responses short and snappy
        }
        headers = {
            "Authorization": f"Bearer {key}",
            "Content-Type": "application/json",
            "HTTP-Referer": "https://skylark.local",
            "X-Title": "Jarvis Voice Calling Agent",
        }

        try:
            async with httpx.AsyncClient(timeout=60.0) as client:
                async with client.stream("POST", self.BASE_URL, headers=headers, json=payload) as response:
                    if response.status_code == 429 or response.status_code == 402 or response.status_code >= 500:
                        logger.warning(f"OpenRouter {response.status_code} on model {model}. Rotating...")
                        self._rotate()
                        async for chunk in self.generate_stream(messages, attempt + 1):
                            yield chunk
                        return

                    response.raise_for_status()
                    async for line in response.aiter_lines():
                        if not line or not line.startswith("data: "):
                            continue
                        data_str = line[len("data: "):].strip()
                        if data_str == "[DONE]":
                            break
                        try:
                            data = json.loads(data_str)
                            delta = data.get("choices", [{}])[0].get("delta", {})
                            content = delta.get("content")
                            if content:
                                yield content
                        except json.JSONDecodeError:
                            continue
        except Exception as e:
            logger.error(f"Error streaming from OpenRouter (model={model}): {e}")
            self._rotate()
            if attempt + 1 < max_attempts:
                async for chunk in self.generate_stream(messages, attempt + 1):
                    yield chunk
            else:
                yield "Sorry, I am experiencing a technical issue right now."
