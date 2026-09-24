import logging
import os
from typing import Dict, Any, Optional

import httpx

logger = logging.getLogger(__name__)


class ExotelAdapter:
    """
    Adapter for Exotel Voice (AgentStream) — India-focused telephony provider.

    Why Exotel over Twilio for this project:
    - Native Indian carrier routing + DLT/TRAI compliant number provisioning
      (Twilio's India presence is limited/indirect and often blocked for
      unregistered outbound traffic under Indian telecom regulations).
    - AgentStream gives a bidirectional raw-PCM WebSocket (linear16, 8/16/24kHz)
      to your own server — same "VoiceBot applet" pattern this codebase's
      AudioHandler / VoiceOrchestrator already expects.
    - INR billing, local support, better rates for Indian outbound minutes.

    Docs: https://developer.exotel.com/docs/agentstream/developer-guide
    """

    def __init__(
        self,
        api_key: str = "",
        api_token: str = "",
        account_sid: str = "",
        subdomain: str = "api.in.exotel.com",  # Mumbai region; use api.exotel.com for Singapore
        websocket_domain: str = "",
    ):
        self.api_key = api_key or os.getenv("EXOTEL_API_KEY", "")
        self.api_token = api_token or os.getenv("EXOTEL_API_TOKEN", "")
        self.account_sid = account_sid or os.getenv("EXOTEL_ACCOUNT_SID", "")
        self.subdomain = subdomain or os.getenv("EXOTEL_SUBDOMAIN", "api.in.exotel.com")
        self.websocket_domain = websocket_domain or os.getenv("PUBLIC_WSS_DOMAIN", "")

        if not (self.api_key and self.api_token and self.account_sid):
            logger.warning(
                "Exotel credentials not fully configured. Set EXOTEL_API_KEY, EXOTEL_API_TOKEN, "
                "EXOTEL_ACCOUNT_SID in your .env to enable real outbound calls."
            )

    def _base_url(self) -> str:
        return f"https://{self.api_key}:{self.api_token}@{self.subdomain}/v1/accounts/{self.account_sid}"

    def get_stream_url(self, sample_rate: int = 16000) -> str:
        """
        The WebSocket URL Exotel's VoiceBot applet will connect to. Must be
        publicly reachable over wss:// (use a tunnel like ngrok in dev, or your
        real domain in production) and route to the /ws/audio FastAPI endpoint.
        """
        if not self.websocket_domain:
            logger.warning("PUBLIC_WSS_DOMAIN not configured — outbound calls will fail to stream audio.")
        stream_token = os.getenv("EXOTEL_STREAM_TOKEN", "").strip()
        token_query = f"&stream-token={stream_token}" if stream_token else ""
        return f"wss://{self.websocket_domain}/ws/audio?sample-rate={sample_rate}{token_query}"

    async def make_outbound_call(
        self,
        to_number: str,
        caller_id: str,
        record: bool = False,
        status_callback: Optional[str] = None,
        custom_field: Optional[str] = None,
        time_limit: int = 3600,
    ) -> Dict[str, Any]:
        """
        Places a real outbound call and connects it directly to Jarvis's
        WebSocket bot (no IVR flow needed) — Exotel's "Connect Voice AI" API.

        to_number: E.164 format, e.g. "+919876543210"
        caller_id: one of your purchased/verified Exophone numbers
        """
        if not (self.api_key and self.api_token and self.account_sid):
            return {"status": "error", "error": "Exotel credentials not configured"}

        url = f"{self._base_url()}/calls/connect"
        data = {
            "from": to_number,
            "callerid": caller_id,
            "streamurl": self.get_stream_url(),
            "streamtype": "bidirectional",
        }
        if record:
            data["record"] = "true"
        if status_callback:
            data["statuscallback"] = status_callback
            data["statuscallbackevents[]"] = "terminal"
        if custom_field:
            data["customfield"] = custom_field[:128]
        if time_limit:
            data["timelimit"] = min(time_limit, 14400)

        try:
            async with httpx.AsyncClient(timeout=20.0) as client:
                resp = await client.post(url, data=data)
                resp.raise_for_status()
                result = resp.json()
                logger.info(f"Outbound call placed: {result.get('call', {}).get('sid')}")
                return {"status": "success", "call": result.get("call", {})}
        except httpx.HTTPStatusError as e:
            logger.error(f"Exotel call failed: {e.response.status_code} {e.response.text}")
            return {"status": "error", "error": e.response.text}
        except Exception as e:
            logger.error(f"Exotel call failed: {e}")
            return {"status": "error", "error": str(e)}

    async def get_active_streams(self) -> Dict[str, Any]:
        """Check how many AgentStream sessions are currently live on the account."""
        url = f"{self._base_url()}/activestreams"
        try:
            async with httpx.AsyncClient(timeout=10.0) as client:
                resp = await client.get(url)
                resp.raise_for_status()
                return resp.json()
        except Exception as e:
            logger.error(f"Failed to fetch active streams: {e}")
            return {"status": "error", "error": str(e)}
