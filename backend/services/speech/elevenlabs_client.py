"""Small ElevenLabs HTTP adapter. API keys stay in the tenant vault.

Contracts: https://elevenlabs.io/docs/api-reference/tokens/create and
https://elevenlabs.io/docs/api-reference/text-to-speech/stream
"""
from __future__ import annotations

import logging

import httpx
from fastapi import HTTPException
from fastapi.responses import StreamingResponse
from starlette.background import BackgroundTask

logger = logging.getLogger(__name__)
BASE_URL = "https://api.elevenlabs.io"
DEFAULT_VOICE_ID = "JBFqnCBsd6RMkjVDRZzb"
DEFAULT_MODEL_ID = "eleven_flash_v2_5"
SAMPLE_RATE = 24000


def provider_error(status: int, data=None) -> HTTPException:
    """Classify provider codes; never echo their body, URL or credential."""
    detail = data.get("detail", {}) if isinstance(data, dict) else {}
    # Current responses use code; older STT/TTS responses used status.
    code = str(detail.get("code") or detail.get("status") or "").lower() if isinstance(detail, dict) else ""
    if code in {"quota_exceeded", "insufficient_credits", "insufficient_balance"}:
        result = (402 if status == 402 else 429, "ELEVENLABS_QUOTA", "ElevenLabs credits are exhausted. Check your account allowance.")
    elif code in {"missing_permissions", "insufficient_permissions", "workspace_access_denied", "forbidden", "voice_access_denied", "model_access_denied"}:
        result = (403, "ELEVENLABS_PERMISSION", "The ElevenLabs key does not have permission for this feature.")
    elif code in {"invalid_api_key", "unauthorized"} or status == 401:
        result = (422, "ELEVENLABS_KEY_INVALID", "ElevenLabs rejected the connected key. Reconnect it in Setup.")
    elif code in {"payment_required", "subscription_required", "paid_plan_required", "feature_not_available"} or status == 402:
        result = (402, "ELEVENLABS_PLAN_REQUIRED", "This ElevenLabs feature requires an eligible plan.")
    elif status == 403:
        result = (403, "ELEVENLABS_PERMISSION", "The ElevenLabs key does not have permission for this feature.")
    elif code in {"rate_limit_exceeded", "concurrent_limit_exceeded", "system_busy", "too_many_concurrent_requests"} or status == 429:
        result = (429, "ELEVENLABS_RATE_LIMIT", "ElevenLabs is at its request or concurrency limit. Try again shortly.")
    elif code in {"voice_not_found", "sample_not_found", "voice_collection_not_found"} or status == 404:
        result = (404, "ELEVENLABS_RESOURCE_MISSING", "The selected ElevenLabs voice or resource is unavailable.")
    elif status in {400, 422}:
        result = (422, "ELEVENLABS_SETTINGS_INVALID", "ElevenLabs could not use these voice settings. Check the selected voice and model.")
    else:
        result = (502, "ELEVENLABS_UNAVAILABLE", "ElevenLabs is temporarily unavailable. Try again shortly.")
    return HTTPException(result[0], detail={"code": result[1], "message": result[2]})


def checked_json(response: httpx.Response):
    try:
        data = response.json()
    except ValueError:
        data = None
    if not response.is_success:
        raise provider_error(response.status_code, data)
    if data is None:
        raise provider_error(502)
    return data


async def request_json(method: str, path: str, api_key: str, *, params=None):
    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            response = await client.request(method, BASE_URL + path,
                                            headers={"xi-api-key": api_key}, params=params)
        return checked_json(response)
    except httpx.TimeoutException:
        raise HTTPException(504, detail={"code": "ELEVENLABS_TIMEOUT", "message": "ElevenLabs did not answer in time. Try again."}) from None
    except httpx.HTTPError:
        raise provider_error(502) from None


async def synthesize_response(api_key: str, voice_id: str, body: dict, *, pcm: bool):
    """Prime one audio chunk so errors/fallback happen before response headers.

PCM is forwarded as it arrives, with cleanup on completion or browser cancel.
WAV needs its length header, so the non-live format is deliberately buffered.
"""
    client = httpx.AsyncClient(timeout=httpx.Timeout(25.0, connect=10.0))
    response = None
    try:
        request = client.build_request("POST", BASE_URL + f"/v1/text-to-speech/{voice_id}/stream",
                                       params={"output_format": "pcm_24000"},
                                       headers={"xi-api-key": api_key, "Content-Type": "application/json"}, json=body)
        response = await client.send(request, stream=True)
        if not response.is_success:
            await response.aread()
            checked_json(response)
        content_type = response.headers.get("content-type", "").lower()
        if content_type and not content_type.startswith(("audio/", "application/octet-stream")):
            # A proxy or provider error document is never PCM, even on HTTP 200.
            raise provider_error(502)
        chunks = response.aiter_bytes()
        first = await anext(chunks, b"")
        if not first:
            raise provider_error(502)
    except BaseException as exc:
        if response is not None:
            await response.aclose()
        await client.aclose()
        if isinstance(exc, httpx.TimeoutException):
            raise HTTPException(504, detail={"code": "ELEVENLABS_TIMEOUT", "message": "ElevenLabs speech did not start in time. Try again."}) from None
        if isinstance(exc, httpx.HTTPError):
            raise provider_error(502) from None
        raise

    async def close_stream():
        try:
            await response.aclose()
        finally:
            await client.aclose()

    async def audio_chunks():
        try:
            yield first
            async for chunk in chunks:
                yield chunk
        except httpx.HTTPError:
            # Headers/audio have already left the server: close the stream.
            # Never switch providers or replay the partly spoken sentence.
            logger.warning("ElevenLabs audio stream interrupted")
            raise RuntimeError("ElevenLabs audio stream interrupted") from None
        finally:
            await close_stream()

    headers = {"X-TTS-Engine": "elevenlabs", "X-Audio-Sample-Rate": str(SAMPLE_RATE), "Cache-Control": "no-store"}
    if pcm:
        return StreamingResponse(audio_chunks(), media_type="audio/pcm", headers=headers, background=BackgroundTask(close_stream))
    from fastapi.responses import Response
    from services.speech.audio import pcm16_to_wav
    audio = bytearray()
    try:
        async for chunk in audio_chunks():
            audio.extend(chunk)
    except RuntimeError:
        # Buffered WAV has not reached the browser, so ordinary HTTP error
        # handling (and automatic pre-audio fallback) remains safe here.
        raise provider_error(502) from None
    return Response(pcm16_to_wav(bytes(audio), SAMPLE_RATE), media_type="audio/wav", headers=headers)
