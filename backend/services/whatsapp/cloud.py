"""WhatsApp Cloud API client: upload a document once, send it as a template.

Meta will not accept a free-form message to someone who has not written to the
business first, and a PSTN phone call does not open that window. So every
document this app sends on its own initiative goes out as an APPROVED TEMPLATE
whose header is a document. That is not a design choice we can revisit here;
it is the platform rule the rest of the feature is built around.

Uploaded media is addressed by a media id that Meta keeps for about 30 days.
Re-uploading the same brochure for every call would be slow and wasteful, so
the caller caches the id and its expiry and only re-uploads when it lapses.
"""
from __future__ import annotations

import mimetypes
import os
from pathlib import Path

import httpx

GRAPH = "https://graph.facebook.com"
API_VERSION = os.getenv("WHATSAPP_API_VERSION", os.getenv("META_GRAPH_VERSION", "v26.0"))
# Meta keeps uploaded media for 30 days. Re-upload a little early so a send
# never races the expiry.
MEDIA_TTL_SECONDS = 26 * 24 * 3600
TIMEOUT = httpx.Timeout(connect=10.0, read=60.0, write=60.0, pool=10.0)


async def graph(token: str, path: str, *, method: str = "GET", params=None, payload=None) -> dict:
    async with httpx.AsyncClient(timeout=TIMEOUT) as client:
        response = await client.request(method, f"{GRAPH}/{API_VERSION}/{path}",
            headers={"Authorization": f"Bearer {token}"}, params=params, json=payload)
    if response.status_code >= 400:
        raise _fail(response)
    return response.json()


async def send_template(token: str, phone_number_id: str, to: str, template: str,
                        language: str, body_params: list[str]) -> str:
    components = [{"type": "body", "parameters": [{"type": "text", "text": value}
                  for value in body_params]}] if body_params else []
    data = await graph(token, f"{phone_number_id}/messages", method="POST", payload={
        "messaging_product": "whatsapp", "to": to, "type": "template",
        "template": {"name": template, "language": {"code": language}, "components": components}})
    return str((data.get("messages") or [{}])[0].get("id") or "")


class WhatsAppError(RuntimeError):
    """A failure Meta reported, with its own words kept for the audit log."""

    def __init__(self, message: str, *, status: int = 0, code: str = ""):
        super().__init__(message)
        self.status = status
        self.code = code
        # A 4xx other than 429 means the request itself is wrong: a bad number,
        # an unapproved template, a revoked token. Retrying it changes nothing
        # and only burns quota, so the caller is told not to.
        self.retryable = status == 429 or status >= 500 or status == 0


def _fail(response: httpx.Response) -> WhatsAppError:
    try:
        error = (response.json() or {}).get("error") or {}
    except ValueError:
        error = {}
    message = error.get("error_user_msg") or error.get("message") or f"WhatsApp request failed ({response.status_code})."
    return WhatsAppError(message, status=response.status_code, code=str(error.get("code") or ""))


async def upload_media(token: str, phone_number_id: str, path: str | Path, mime: str = "") -> str:
    """Upload one file and return its media id."""
    file_path = Path(path)
    if not file_path.is_file():
        raise WhatsAppError("The document file is missing on the server.")
    content_type = mime or mimetypes.guess_type(file_path.name)[0] or "application/octet-stream"
    async with httpx.AsyncClient(timeout=TIMEOUT) as client:
        with file_path.open("rb") as handle:
            response = await client.post(
                f"{GRAPH}/{API_VERSION}/{phone_number_id}/media",
                headers={"Authorization": f"Bearer {token}"},
                data={"messaging_product": "whatsapp", "type": content_type},
                files={"file": (file_path.name, handle, content_type)},
            )
    if response.status_code >= 400:
        raise _fail(response)
    media_id = (response.json() or {}).get("id")
    if not media_id:
        raise WhatsAppError("WhatsApp accepted the upload but returned no media id.", status=502)
    return str(media_id)


async def send_document_template(
    token: str,
    phone_number_id: str,
    to: str,
    *,
    template: str,
    language: str,
    media_id: str,
    filename: str,
    body_params: list[str] | None = None,
) -> str:
    """Send one approved template whose header carries one document."""
    components: list[dict] = [{
        "type": "header",
        "parameters": [{"type": "document", "document": {"id": media_id, "filename": filename}}],
    }]
    if body_params:
        components.append({
            "type": "body",
            "parameters": [{"type": "text", "text": str(value)} for value in body_params],
        })
    payload = {
        "messaging_product": "whatsapp",
        "recipient_type": "individual",
        "to": to,
        "type": "template",
        "template": {"name": template, "language": {"code": language}, "components": components},
    }
    async with httpx.AsyncClient(timeout=TIMEOUT) as client:
        response = await client.post(
            f"{GRAPH}/{API_VERSION}/{phone_number_id}/messages",
            headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
            json=payload,
        )
    if response.status_code >= 400:
        raise _fail(response)
    messages = (response.json() or {}).get("messages") or []
    return str(messages[0].get("id")) if messages and messages[0].get("id") else ""
