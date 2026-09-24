"""Authenticated server-side LLM proxy. Provider keys never reach the browser."""
import os
from typing import Any

import httpx
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from api.auth_sync import UserAccount, get_current_user, get_db
from api.credentials import AI_PROVIDER_CONFIG, get_provider_secret, normalize_provider

router = APIRouter(prefix="/api/v1/ai", tags=["ai"])


def provider_error(code: str, message: str, retryable: bool, action: str,
                  status_code: int) -> HTTPException:
    return HTTPException(status_code=status_code, detail={
        "code": code,
        "message": message,
        "retryable": retryable,
        "action": action,
    })


class ChatRequest(BaseModel):
    model: str = Field(min_length=2, max_length=160)
    messages: list[dict[str, str]] = Field(min_length=1, max_length=20)
    temperature: float = Field(default=0.7, ge=0, le=1.5)
    max_tokens: int = Field(default=2048, ge=1, le=4096)


def resolve_provider(model: str) -> tuple[str, str]:
    """Resolve an explicit provider/model prefix without trusting client keys."""
    raw = str(model or "").strip()
    if "/" in raw:
        prefix, provider_model = raw.split("/", 1)
        provider = normalize_provider(prefix)
        if provider in AI_PROVIDER_CONFIG and provider_model.strip():
            return provider, provider_model.strip()
    # Keep existing models working: unprefixed models use the primary provider.
    return "openrouter", raw


def gemini_payload(messages: list[dict[str, str]]) -> tuple[list[dict[str, Any]], dict[str, Any] | None]:
    contents = []
    system_instruction = None
    for message in messages:
        role = str(message.get("role", "user")).lower()
        text = str(message.get("content", ""))
        if not text:
            continue
        if role == "system":
            system_instruction = {"parts": [{"text": text}]}
            continue
        contents.append({"role": "model" if role == "assistant" else "user",
                         "parts": [{"text": text}]})
    return contents, system_instruction


def normalize_gemini_response(data: dict[str, Any]) -> dict[str, Any]:
    if not isinstance(data, dict):
        raise provider_error("AI_EMPTY_RESPONSE", "The AI provider returned no usable reply.",
                             True, "RETRY", 502)
    candidates = data.get("candidates", [])
    parts = candidates[0].get("content", {}).get("parts", []) if candidates else []
    content = "".join(str(part.get("text", "")) for part in parts if isinstance(part, dict))
    if not content.strip():
        raise provider_error("AI_EMPTY_RESPONSE", "The AI provider returned no usable reply.",
                             True, "RETRY", 502)
    return {"success": True, "choices": [{"message": {"role": "assistant", "content": content}}],
            "usage": data.get("usageMetadata", {})}


@router.post("/chat")
async def chat(req: ChatRequest, db=Depends(get_db), user: UserAccount = Depends(get_current_user)):
    provider, model = resolve_provider(req.model)
    # Groq's shared TPM window counts the prompt and requested completion
    # budget. Bound Clavis turns so long history cannot consume the whole
    # free-window allowance in one request.
    effective_max_tokens = min(req.max_tokens, 1200) if provider == "groq" else req.max_tokens
    key = get_provider_secret(provider, user, db)
    if not key:
        raise provider_error("AI_CREDENTIAL_MISSING", f"{provider} credential is not configured for this workspace",
                             False, "OPEN_CREDENTIAL_SETUP", 503)
    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(45.0, connect=8.0)) as client:
            if provider == "gemini":
                contents, system_instruction = gemini_payload(req.messages)
                if not contents:
                    raise provider_error("AI_EMPTY_RESPONSE", "No user message was provided.", False, "RETRY", 422)
                body = {"contents": contents, "generationConfig": {"temperature": req.temperature,
                        "maxOutputTokens": effective_max_tokens}}
                if system_instruction:
                    body["systemInstruction"] = system_instruction
                response = await client.post(
                    f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent",
                    params={"key": key}, json=body)
            else:
                base_url = AI_PROVIDER_CONFIG[provider]["base_url"]
                headers = {"Authorization": f"Bearer {key}", "Content-Type": "application/json"}
                if provider == "openrouter": headers["X-Title"] = "Clavis AI"
                response = await client.post(f"{base_url}/chat/completions", headers=headers,
                                             json={"model": model, "messages": req.messages,
                                                   "temperature": req.temperature, "max_tokens": effective_max_tokens})
            if response.status_code == 401 or response.status_code == 403:
                raise provider_error("AI_CREDENTIAL_INVALID", "The provider credential was rejected.",
                                     False, "OPEN_CREDENTIAL_SETUP", 502)
            if response.status_code == 429:
                raise provider_error("AI_RATE_LIMITED", "The AI provider rate limit was reached.",
                                     True, "RETRY", 429)
            response.raise_for_status()
            data = response.json()
        if provider == "gemini":
            return normalize_gemini_response(data)
        choices = data.get("choices", [])
        if not isinstance(choices, list) or not choices or not choices[0].get("message", {}).get("content"):
            raise provider_error("AI_EMPTY_RESPONSE", "The AI provider returned no usable reply.",
                                 True, "RETRY", 502)
        return {"success": True, "choices": choices, "usage": data.get("usage", {})}
    except HTTPException:
        raise
    except httpx.HTTPStatusError as exc:
        raise provider_error("AI_BACKEND_UNAVAILABLE", "The AI provider rejected the request.",
                             True, "RETRY", 502)
    except httpx.TimeoutException:
        raise provider_error("AI_TIMEOUT", "The AI provider took too long to respond.",
                             True, "RETRY", 504)
    except (httpx.HTTPError, ValueError, TypeError):
        raise provider_error("AI_BACKEND_UNAVAILABLE", "The AI provider is unavailable.",
                             True, "RETRY", 502)
