"""Optional Windows classic Outlook bridge.

This module deliberately imports win32com only inside request handlers. The rest
of the backend remains portable when Outlook or pywin32 is not installed.
"""
import html
import logging
import os
import platform
from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field
from api.auth_sync import UserAccount, get_current_user

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/outlook", tags=["outlook"])

class OutlookSendRequest(BaseModel):
    to: str = Field(min_length=3, max_length=4000)
    subject: str = Field(min_length=1, max_length=240)
    htmlBody: str = Field(min_length=1, max_length=250_000)

def _outlook():
    if platform.system() != "Windows":
        raise RuntimeError("Classic Outlook bridge is available only on Windows.")
    try:
        import win32com.client  # type: ignore
        return win32com.client.Dispatch("Outlook.Application")
    except ImportError as exc:
        raise RuntimeError("pywin32 is not installed. Install it with: pip install pywin32") from exc
    except Exception as exc:
        raise RuntimeError("Classic Outlook is not installed or could not be started.") from exc

@router.get("/status")
async def outlook_status(user: UserAccount = Depends(get_current_user)):
    try:
        app = _outlook()
        namespace = app.GetNamespace("MAPI")
        sender = ""
        try:
            sender = namespace.CurrentUser.AddressEntry.GetExchangeUser().PrimarySmtpAddress
        except Exception:
            sender = getattr(namespace.CurrentUser, "Name", "Classic Outlook")
        return {"status": "ok", "available": True, "senderEmail": sender, "message": "Classic Outlook bridge ready."}
    except Exception as exc:
        return {"status": "not_available", "available": False, "message": str(exc)}

@router.post("/send")
async def outlook_send(req: OutlookSendRequest, user: UserAccount = Depends(get_current_user)):
    if not req.to or "@" not in req.to:
        return {"status": "error", "message": "Invalid recipient email."}
    try:
        app = _outlook()
        item = app.CreateItem(0)  # olMailItem
        item.To = req.to
        item.Subject = req.subject
        item.HTMLBody = req.htmlBody
        item.Send()
        return {"status": "success", "message": "Email sent through classic Outlook.", "to": req.to}
    except Exception:
        logger.exception("Classic Outlook send failed")
        return {"status": "error", "message": "Outlook could not send the message."}
