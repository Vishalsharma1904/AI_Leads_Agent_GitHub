import logging
from fastapi import WebSocket, WebSocketDisconnect
import json
import base64

logger = logging.getLogger(__name__)


class AudioHandler:
    """
    Handles bidirectional streaming audio over WebSocket for Exotel's AgentStream
    (VoiceBot applet). Exotel sends/receives raw linear16 PCM (mono, 16-bit
    little-endian) as base64 — no mu-law conversion needed, unlike Twilio.

    Protocol reference: https://developer.exotel.com/docs/agentstream/developer-guide
    Events received: connected, start, media, dtmf, mark, stop
    Events sent:      media, mark, clear (barge-in)
    """
    def __init__(self, websocket: WebSocket):
        self.websocket = websocket
        self.stream_sid = None
        self.call_sid = None

    async def connect(self):
        await self.websocket.accept()
        logger.info("WebSocket connection accepted for Exotel audio stream")

    async def disconnect(self):
        logger.info(f"WebSocket disconnected for stream {self.stream_sid}")

    async def receive_audio_chunk(self):
        """
        Receives a single event from the WebSocket (Exotel AgentStream JSON).
        Returns raw PCM16 bytes for 'media' events, b"EOF" on 'stop', or None
        for control events that don't carry audio.
        """
        try:
            message = await self.websocket.receive_text()
            data = json.loads(message)
            event = data.get("event")

            if event == "connected":
                return None

            if event == "start":
                start = data.get("start", data)
                self.stream_sid = start.get("stream_sid")
                self.call_sid = start.get("call_sid")
                logger.info(f"Started AgentStream: stream_sid={self.stream_sid} call_sid={self.call_sid}")
                return None

            if event == "media":
                payload = data["media"]["payload"]
                # Already raw PCM16 mono — no mu-law decode needed for Exotel.
                pcm_bytes = base64.b64decode(payload)
                return pcm_bytes

            if event == "dtmf":
                digit = data.get("dtmf", {}).get("digit")
                logger.info(f"DTMF received: {digit}")
                return None

            if event == "mark":
                # Previously sent audio finished playing — useful for turn-taking timing.
                return None

            if event == "stop":
                reason = data.get("stop", {}).get("reason", "unknown")
                logger.info(f"Stream stopped by provider (reason={reason})")
                return b"EOF"

        except WebSocketDisconnect:
            raise
        except Exception as e:
            logger.error(f"Error receiving audio chunk: {e}")
            return None

    async def send_audio_chunk(self, pcm_bytes: bytes):
        """
        Sends raw PCM16 audio back to the caller as an Exotel 'media' event.
        """
        if not self.stream_sid:
            return
        try:
            payload = base64.b64encode(pcm_bytes).decode("ascii")
            message = {
                "event": "media",
                "stream_sid": self.stream_sid,
                "media": {"payload": payload},
            }
            await self.websocket.send_text(json.dumps(message))
        except Exception as e:
            logger.error(f"Error sending audio chunk: {e}")

    async def send_mark(self, name: str = "turn-end"):
        """Tag a playback position — Exotel echoes this back once playback finishes."""
        if not self.stream_sid:
            return
        try:
            await self.websocket.send_text(json.dumps({
                "event": "mark",
                "stream_sid": self.stream_sid,
                "mark": {"name": name},
            }))
        except Exception as e:
            logger.error(f"Error sending mark event: {e}")

    async def send_clear(self):
        """Flush any buffered outbound audio — used for barge-in / interruption handling."""
        if not self.stream_sid:
            return
        try:
            await self.websocket.send_text(json.dumps({
                "event": "clear",
                "stream_sid": self.stream_sid,
            }))
        except Exception as e:
            logger.error(f"Error sending clear event: {e}")
