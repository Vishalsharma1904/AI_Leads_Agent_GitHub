import httpx
import json
import logging
from typing import AsyncGenerator, Dict, Any, List

logger = logging.getLogger(__name__)

class OllamaService:
    def __init__(self, base_url: str = "http://localhost:11434", default_model: str = "llama3.1:8b"):
        self.base_url = base_url
        self.default_model = default_model
        
    async def check_health(self) -> bool:
        try:
            async with httpx.AsyncClient() as client:
                response = await client.get(f"{self.base_url}/api/tags")
                return response.status_code == 200
        except Exception as e:
            logger.error(f"Ollama health check failed: {e}")
            return False

    async def generate_stream(self, messages: List[Dict[str, str]], model: str = None) -> AsyncGenerator[str, None]:
        """
        Streams response from Ollama. Yields text chunks as they arrive.
        """
        target_model = model or self.default_model
        
        payload = {
            "model": target_model,
            "messages": messages,
            "stream": True,
            "options": {
                "temperature": 0.3, # Low temp for deterministic, professional voice responses
                "num_predict": 150  # Keep responses short for voice
            }
        }
        
        try:
            async with httpx.AsyncClient(timeout=60.0) as client:
                async with client.stream('POST', f"{self.base_url}/api/chat", json=payload) as response:
                    response.raise_for_status()
                    async for line in response.aiter_lines():
                        if not line:
                            continue
                        try:
                            data = json.loads(line)
                            if "message" in data and "content" in data["message"]:
                                yield data["message"]["content"]
                            if data.get("done"):
                                break
                        except json.JSONDecodeError:
                            logger.warning(f"Failed to parse Ollama response line: {line}")
        except Exception as e:
            logger.error(f"Error streaming from Ollama: {e}")
            yield "Sorry, I am experiencing a technical issue right now."
