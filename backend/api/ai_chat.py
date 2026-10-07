"""Authenticated server-side LLM proxy. Provider keys never reach the browser."""
import json
import os
import re
import base64
from typing import Any

import httpx
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field, validator

from api.auth_sync import SessionLocal, UserAccount, get_current_user, get_db
from api.limits import consume, refund
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
    # dict[str, Any], not dict[str, str]: a tool result message carries a
    # tool_call_id and structured content, and strict str values rejected it.
    messages: list[dict[str, Any]] = Field(min_length=1, max_length=40)
    temperature: float = Field(default=0.7, ge=0, le=1.5)
    max_tokens: int = Field(default=2048, ge=1, le=4096)
    stream: bool = False
    images: list[str] = Field(default_factory=list, max_length=4)
    # Tools were not in this model at all, so they never reached the provider.
    tools: list[dict[str, Any]] = Field(default_factory=list, max_length=64)
    tool_choice: Any = None

    @validator("images")
    def safe_images(cls, value):
        for image in value:
            if len(image) > 2_000_000 or not re.fullmatch(r"data:image/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+", image):
                raise ValueError("Use a PNG, JPEG or WebP attachment under 1.5 MB")
            base64.b64decode(image.split(",", 1)[1], validate=True)
        return value


GEMINI_KEY_HINT = (
    'The Gemini key was rejected. Create one at aistudio.google.com/apikey \u2014 '
    'it starts with "AQ." (current) or "AIza" (legacy); both work here.'
)


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


def stream_text(provider: str, data: dict[str, Any]) -> str:
    if not isinstance(data, dict):
        return ""
    if provider == "gemini":
        candidates = data.get("candidates", [])
        candidate = candidates[0] if isinstance(candidates, list) and candidates else {}
        content = candidate.get("content", {}) if isinstance(candidate, dict) else {}
        parts = content.get("parts", []) if isinstance(content, dict) else []
        return "".join(part["text"] for part in parts if isinstance(part, dict) and isinstance(part.get("text"), str))
    choices = data.get("choices", [])
    choice = choices[0] if isinstance(choices, list) and choices else {}
    delta = choice.get("delta", {}) if isinstance(choice, dict) else {}
    content = delta.get("content", "") if isinstance(delta, dict) else ""
    return content if isinstance(content, str) else ""


def stream_tool_calls(provider: str, data: dict[str, Any]) -> list[dict[str, Any]]:
    """Tool-call fragments from one streamed chunk.

    A turn that decides to call a tool emits NO content, so a stream that
    only forwards content delivers an empty answer and the browser reports
    "received an empty reply". These fragments are forwarded so the caller
    can assemble the call and run it.
    """
    if provider == "gemini" or not isinstance(data, dict):
        return []
    choices = data.get("choices", [])
    choice = choices[0] if isinstance(choices, list) and choices else {}
    delta = choice.get("delta", {}) if isinstance(choice, dict) else {}
    calls = delta.get("tool_calls") if isinstance(delta, dict) else None
    return calls if isinstance(calls, list) else []


# Pehle: ek provider fail hua -> poora jawab mar gaya. Ab agla provider try
# hota hai, bas wahi jiski key is server par maujood ho. User ko jawab milna
# chahiye; kaunse provider se mila, ye uski fikar nahi.
# Measured against this account on 2026-10-04: of the names this chain used
# to carry, Groq serves ONLY the gpt-oss pair. llama-3.3-70b-versatile,
# llama-3.1-8b-instant, llama-4-scout, qwen3-32b and kimi-k2 are all refused.
# Every refusal fell through to Gemini, which AI Studio now bills for and
# which answers 403 — so a single Groq hiccup surfaced as "no reply" or the
# Gemini key complaint. Gemini is out of the chain entirely; it has no key
# and cannot be the thing that catches a failure.
FALLBACK_CHAIN = [
    ("groq", "openai/gpt-oss-20b"),
    ("groq", "openai/gpt-oss-120b"),
    ("openrouter", "meta-llama/llama-3.3-70b-instruct"),
    ("openai", "gpt-4o-mini"),
    ("deepseek", "deepseek-chat"),
]


class _TryNext(Exception):
    """Is provider se nahi hua — agla try karo (agar koi aur hai)."""

    def __init__(self, error: HTTPException):
        super().__init__(error.detail)
        self.error = error


def build_candidates(provider: str, model: str, user: UserAccount, db) -> list[tuple[str, str, str]]:
    """(provider, model, key) — pehla wahi jo maanga gaya, phir backup."""
    out: list[tuple[str, str, str]] = []
    seen: set[str] = set()

    def add(name: str, model_id: str) -> None:
        if name in seen or name not in AI_PROVIDER_CONFIG or not model_id:
            return
        key = get_provider_secret(name, user, db)
        if not key:
            return
        seen.add(name)
        out.append((name, model_id, key))

    add(provider, model)
    for name, model_id in FALLBACK_CHAIN:
        add(name, model_id)
    return out


def build_upstream(provider: str, model: str, key: str, req: ChatRequest):
    """Ek provider ke liye url, params, headers, body."""
    # Groq's shared TPM window counts the prompt and requested completion
    # budget. Bound Rudra24 AI turns so long history cannot consume the whole
    # free-window allowance in one request.
    max_tokens = min(req.max_tokens, 1200) if provider == "groq" else req.max_tokens
    if provider == "gemini":
        if not re.fullmatch(r"[a-zA-Z0-9_.-]+", model):
            raise HTTPException(status_code=422, detail="Invalid Gemini model")
        contents, system_instruction = gemini_payload(req.messages)
        if not contents:
            raise provider_error("AI_EMPTY_RESPONSE", "No user message was provided.", False, "RETRY", 422)
        body: dict[str, Any] = {"contents": contents, "generationConfig": {
            "temperature": req.temperature, "maxOutputTokens": max_tokens}}
        if system_instruction:
            body["systemInstruction"] = system_instruction
        if req.images:
            target = next((content for content in reversed(contents) if content["role"] == "user"), None)
            if target is None:
                raise HTTPException(status_code=422, detail="A user message is required for images")
            for image in req.images:
                header, data = image.split(",", 1)
                target["parts"].append({"inlineData": {"mimeType": header[5:-7], "data": data}})
        method = "streamGenerateContent" if req.stream else "generateContent"
        url = f"https://generativelanguage.googleapis.com/v1beta/models/{model}:{method}"
        return url, ({"alt": "sse"} if req.stream else None), {"x-goog-api-key": key}, body
    base_url = AI_PROVIDER_CONFIG[provider]["base_url"]
    headers = {"Authorization": f"Bearer {key}", "Content-Type": "application/json"}
    if provider == "openrouter":
        headers["X-Title"] = "Rudra24 AI"
    body = {"model": model, "messages": req.messages, "temperature": req.temperature,
            "max_tokens": max_tokens}
    # Forward the tools. Without this the model was asked to "open the map"
    # with no map tool in front of it, so it answered with nothing at all.
    if req.tools:
        body["tools"] = req.tools
        if req.tool_choice is not None:
            body["tool_choice"] = req.tool_choice
    if provider == "groq" and model.startswith("openai/gpt-oss-"):
        body.update(reasoning_effort="low", include_reasoning=False)
    if req.stream:
        body["stream"] = True
    return f"{base_url}/chat/completions", None, headers, body


def upstream_error(provider: str, status: int, body: str = "") -> HTTPException:
    """Upstream ke status ko app ke error me badalta hai."""
    if status in (401, 403) or (status == 404 and provider == "gemini"):
        # Gemini 404 = galat key ya hataya hua model. Chup-chaap 502 dene se
        # user ko kabhi pata hi nahi chalta ki key badalni hai.
        message = GEMINI_KEY_HINT if provider == "gemini" else "The provider credential was rejected."
        return provider_error("AI_CREDENTIAL_INVALID", message, False, "OPEN_CREDENTIAL_SETUP", 502)
    if status == 429:
        if re.search(r"per day|\b[rt]pd\b|daily", body, re.I):
            return provider_error("AI_PROVIDER_DAILY_LIMIT", "The connected AI provider's daily limit was reached.",
                                  False, "OPEN_CREDENTIAL_SETUP", 429)
        if re.search(r"per minute|\b[rt]pm\b", body, re.I):
            return provider_error("AI_RATE_LIMITED", "The AI provider's per-minute limit was reached.",
                                  True, "RETRY", 429)
        return provider_error("AI_RATE_LIMITED", "The AI provider rate limit was reached.",
                              True, "RETRY", 429)
    return provider_error("AI_BACKEND_UNAVAILABLE", "The AI provider rejected the request.",
                          True, "RETRY", 502)


async def run_provider(req: ChatRequest, provider: str, model: str, key: str):
    """Ek provider par poori koshish. Provider ki galti ho to _TryNext."""
    url, params, headers, body = build_upstream(provider, model, key, req)
    if req.stream:
        client = httpx.AsyncClient(timeout=httpx.Timeout(12.0, connect=5.0))
        try:
            upstream = await client.send(client.build_request(
                "POST", url, params=params, headers=headers, json=body), stream=True)
        except httpx.TimeoutException:
            await client.aclose()
            raise _TryNext(provider_error("AI_TIMEOUT", "The AI provider took too long to respond.",
                                          True, "RETRY", 504))
        except httpx.HTTPError:
            await client.aclose()
            raise _TryNext(provider_error("AI_BACKEND_UNAVAILABLE", "The AI provider is unavailable.",
                                          True, "RETRY", 502))
        if upstream.is_error:
            status = upstream.status_code
            try:
                body = (await upstream.aread()).decode("utf-8", errors="replace")
            except httpx.HTTPError:
                body = ""
            await upstream.aclose()
            await client.aclose()
            # Pehla byte jaane se pehle hi pata chal gaya — fallback safe hai.
            raise _TryNext(upstream_error(provider, status, body))

        async def events():
            try:
                async for line in upstream.aiter_lines():
                    if not line.startswith("data:"):
                        continue
                    raw = line[5:].strip()
                    if raw == "[DONE]":
                        break
                    try:
                        chunk = json.loads(raw)
                    except (json.JSONDecodeError, TypeError, ValueError):
                        continue
                    delta = stream_text(provider, chunk)
                    if delta:
                        yield "data: " + json.dumps({"text": delta}, ensure_ascii=False) + "\n\n"
                    # A tool call carries no text. Forwarding it is the
                    # difference between the browser acting on the request
                    # and reporting "received an empty reply".
                    calls = stream_tool_calls(provider, chunk)
                    if calls:
                        yield "data: " + json.dumps({"tool_calls": calls}, ensure_ascii=False) + "\n\n"
                yield "data: [DONE]\n\n"
            except httpx.TimeoutException:
                yield 'data: {"error":{"code":"AI_TIMEOUT","message":"The AI provider took too long to respond.","retryable":true,"action":"RETRY"}}\n\n'
            except httpx.HTTPError:
                yield 'data: {"error":{"code":"AI_BACKEND_UNAVAILABLE","message":"The AI provider is unavailable.","retryable":true,"action":"RETRY"}}\n\n'
            finally:
                await upstream.aclose()
                await client.aclose()

        return StreamingResponse(events(), media_type="text/event-stream",
                                 headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})

    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(20.0, connect=5.0)) as client:
            response = await client.post(url, params=params, headers=headers, json=body)
            if response.is_error:
                raise _TryNext(upstream_error(provider, response.status_code, response.text))
            data = response.json()
    except httpx.TimeoutException:
        raise _TryNext(provider_error("AI_TIMEOUT", "The AI provider took too long to respond.",
                                      True, "RETRY", 504))
    except (httpx.HTTPError, ValueError, TypeError):
        raise _TryNext(provider_error("AI_BACKEND_UNAVAILABLE", "The AI provider is unavailable.",
                                      True, "RETRY", 502))

    if provider == "gemini":
        reply = normalize_gemini_response(data)
        text = reply.get("choices", [{}])[0].get("message", {}).get("content", "")
        if not text:
            raise _TryNext(provider_error("AI_EMPTY_RESPONSE", "The AI provider returned no usable reply.",
                                          True, "RETRY", 502))
        return reply
    choices = data.get("choices", [])
    if not isinstance(choices, list) or not choices or not choices[0].get("message", {}).get("content"):
        raise _TryNext(provider_error("AI_EMPTY_RESPONSE", "The AI provider returned no usable reply.",
                                      True, "RETRY", 502))
    return {"success": True, "choices": choices, "usage": data.get("usage", {})}


@router.post("/chat")
async def chat(req: ChatRequest, db=Depends(get_db), user: UserAccount = Depends(get_current_user)):
    provider, model = resolve_provider(req.model)
    candidates = build_candidates("gemini", "gemini-3.8-flash", user, db) if req.images else build_candidates(provider, model, user, db)
    if req.images:
        candidates = [candidate for candidate in candidates if candidate[0] == "gemini"]
    if not candidates:
        raise provider_error("AI_CREDENTIAL_MISSING",
                             f"{provider} credential is not configured for this workspace",
                             False, "OPEN_CREDENTIAL_SETUP", 503)
    reservation = consume(db, user, "ai")
    try:
        last: HTTPException | None = None
        for index, (name, model_id, key) in enumerate(candidates):
            try:
                reply = await run_provider(req, name, model_id, key)
                if isinstance(reply, StreamingResponse):
                    original = reply.body_iterator
                    async def metered_stream():
                        emitted = False
                        try:
                            async for event in original:
                                # DONE/errors do not constitute a useful AI response.
                                if event.startswith('data: {'):
                                    frame = json.loads(event[6:])
                                    emitted = emitted or bool(str(frame.get("text", "")).strip() or frame.get("tool_calls"))
                                yield event
                        finally:
                            if not emitted:
                                with SessionLocal() as quota_db:
                                    refund(quota_db, user, "ai", reservation["day"])
                    reply.body_iterator = metered_stream()
                return reply
            except _TryNext as exc:
                last = exc.error
                if index + 1 >= len(candidates):
                    raise last from None
        raise last  # pragma: no cover
    except BaseException:
        refund(db, user, "ai", reservation["day"])
        raise
