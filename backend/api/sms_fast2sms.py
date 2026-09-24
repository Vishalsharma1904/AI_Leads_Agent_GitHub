"""
Fast2SMS relay.

WHY THIS IS SERVER-SIDE
The code sample this was built from was Node.js, but this project's backend is
FastAPI, so it is implemented here in Python and mounted like the other routers.

It must live on the server for two reasons:

  1. Fast2SMS does not send CORS headers, so a browser fetch to their API is
     rejected by the browser before it ever completes.
  2. The request carries FAST2SMS_API_KEY. Anything the browser can read, a
     visitor can read. A leaked key can be used to drain your SMS wallet.

So the key is read from the environment here and never returned to the client.

ROUTES
  GET  /api/sms/wallet     -> balance; doubles as the plugin health check
  POST /api/sms/send       -> quick route, no DLT registration required
  POST /api/sms/send-dlt   -> DLT route for production bulk SMS in India

TRAI / DLT NOTE
Route "q" is fine for testing and low volume. For production bulk SMS to Indian
numbers, TRAI requires a DLT-registered sender ID and pre-approved templates.
Use /api/sms/send-dlt in that case. See docs/SMS-TEMPLATES.md for templates.
"""

import logging
import os
import re
from typing import List, Optional, Union

import httpx
from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel, Field, field_validator
from api.auth_sync import UserAccount, get_current_user

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/sms", tags=["sms"])

FAST2SMS_BASE = "https://www.fast2sms.com/dev"
REQUEST_TIMEOUT = 20.0

# Fast2SMS accepts at most 1000 numbers per request.
MAX_RECIPIENTS = 1000

_TEN_DIGIT = re.compile(r"^[6-9]\d{9}$")


def _api_key() -> str:
    """Reads the key at call time so a .env change does not need a restart."""
    key = (os.getenv("FAST2SMS_API_KEY") or "").strip()
    if not key:
        # 503, not 500: the service is reachable but not configured. The plugin
        # health check relies on this distinction to give an accurate message.
        raise HTTPException(
            status_code=503,
            detail="FAST2SMS_API_KEY is not set in the backend environment.",
        )
    return key


def _normalise_numbers(numbers: Union[str, List[str]]) -> List[str]:
    """
    Accepts a single number, a comma-separated string, or a list.
    Strips +91 / 0 prefixes and whitespace, then validates each entry.
    """
    if isinstance(numbers, str):
        raw = numbers.split(",")
    else:
        raw = list(numbers)

    cleaned: List[str] = []
    invalid: List[str] = []

    for item in raw:
        digits = re.sub(r"\D", "", str(item))
        if len(digits) == 12 and digits.startswith("91"):
            digits = digits[2:]
        elif len(digits) == 11 and digits.startswith("0"):
            digits = digits[1:]

        if _TEN_DIGIT.match(digits):
            if digits not in cleaned:      # de-duplicate: never bill twice
                cleaned.append(digits)
        elif digits:
            invalid.append(str(item))

    if invalid:
        raise HTTPException(
            status_code=422,
            detail=f"Not valid Indian mobile numbers: {', '.join(invalid[:10])}",
        )
    if not cleaned:
        raise HTTPException(status_code=422, detail="No valid mobile number was supplied.")
    if len(cleaned) > MAX_RECIPIENTS:
        raise HTTPException(
            status_code=422,
            detail=f"{len(cleaned)} recipients supplied; Fast2SMS allows {MAX_RECIPIENTS} per request.",
        )
    return cleaned


async def _post_to_fast2sms(payload: dict) -> dict:
    """Single place where the provider is called, so error handling is uniform."""
    headers = {"authorization": _api_key()}
    try:
        async with httpx.AsyncClient(timeout=REQUEST_TIMEOUT) as client:
            response = await client.post(f"{FAST2SMS_BASE}/bulkV2", json=payload, headers=headers)
    except httpx.TimeoutException:
        raise HTTPException(status_code=504, detail="Fast2SMS did not respond in time.")
    except httpx.HTTPError as exc:
        logger.warning("Fast2SMS transport error: %s", exc)
        raise HTTPException(status_code=502, detail="Could not reach Fast2SMS.")

    if response.status_code in (401, 403):
        raise HTTPException(status_code=401, detail="Fast2SMS rejected the API key.")

    try:
        data = response.json()
    except ValueError:
        raise HTTPException(status_code=502, detail="Fast2SMS returned an unreadable response.")

    # Fast2SMS signals failure in the body with return:false.
    if data.get("return") is False:
        message = data.get("message")
        if isinstance(message, list):
            message = "; ".join(str(m) for m in message)
        raise HTTPException(status_code=400, detail=str(message or "Fast2SMS rejected the request."))

    if response.status_code >= 400:
        raise HTTPException(status_code=502, detail=f"Fast2SMS returned HTTP {response.status_code}.")

    return data


# ── Request models ────────────────────────────────────────────────────────
class SendSmsRequest(BaseModel):
    numbers: Union[str, List[str]]
    message: str = Field(min_length=1, max_length=1000)
    flash: int = 0

    @field_validator("message")
    @classmethod
    def message_not_blank(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("message cannot be blank")
        return value


class SendDltRequest(BaseModel):
    numbers: Union[str, List[str]]
    template_id: str = Field(min_length=1)
    sender_id: str = Field(min_length=3, max_length=6)
    variables: List[str] = []
    flash: int = 0


# ── Routes ────────────────────────────────────────────────────────────────
@router.get("/wallet")
async def wallet_balance(user: UserAccount = Depends(get_current_user)):
    """
    Wallet balance. The plugin uses this as its health check, because a number
    coming back proves both that this service is up and that the stored key
    is accepted by Fast2SMS.
    """
    try:
        async with httpx.AsyncClient(timeout=REQUEST_TIMEOUT) as client:
            response = await client.get(
                f"{FAST2SMS_BASE}/wallet",
                headers={"authorization": _api_key()},
            )
    except httpx.TimeoutException:
        raise HTTPException(status_code=504, detail="Fast2SMS did not respond in time.")
    except httpx.HTTPError:
        raise HTTPException(status_code=502, detail="Could not reach Fast2SMS.")

    if response.status_code in (401, 403):
        raise HTTPException(status_code=401, detail="Fast2SMS rejected the API key.")

    try:
        data = response.json()
    except ValueError:
        raise HTTPException(status_code=502, detail="Fast2SMS returned an unreadable response.")

    if data.get("return") is False:
        raise HTTPException(status_code=400, detail=str(data.get("message") or "Fast2SMS error."))

    # Only the balance is returned. The key is never echoed back.
    return {"ok": True, "wallet": data.get("wallet")}


@router.post("/send")
async def send_sms(payload: SendSmsRequest, user: UserAccount = Depends(get_current_user)):
    """
    Quick route ("q"). No DLT registration needed, so this works immediately.
    Suitable for testing and low volume; use /send-dlt for production bulk.
    """
    recipients = _normalise_numbers(payload.numbers)

    data = await _post_to_fast2sms({
        "route": "q",
        "message": payload.message,
        "language": "english",
        "flash": payload.flash,
        "numbers": ",".join(recipients),
    })

    logger.info("SMS queued via quick route to %d recipient(s)", len(recipients))
    return {
        "ok": True,
        "recipients": len(recipients),
        "request_id": data.get("request_id"),
        "provider_message": data.get("message"),
    }


@router.post("/send-dlt")
async def send_dlt_sms(payload: SendDltRequest, user: UserAccount = Depends(get_current_user)):
    """
    DLT route. Required by TRAI for production bulk SMS to Indian numbers.
    `template_id` and `sender_id` must already be approved with your operator.
    """
    recipients = _normalise_numbers(payload.numbers)

    data = await _post_to_fast2sms({
        "route": "dlt",
        "sender_id": payload.sender_id,
        "message": payload.template_id,
        "variables_values": "|".join(payload.variables),
        "flash": payload.flash,
        "numbers": ",".join(recipients),
    })

    logger.info(
        "DLT SMS queued to %d recipient(s) using template %s",
        len(recipients), payload.template_id,
    )
    return {
        "ok": True,
        "recipients": len(recipients),
        "request_id": data.get("request_id"),
        "provider_message": data.get("message"),
    }
