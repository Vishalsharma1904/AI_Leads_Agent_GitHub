"""
email_sender.py — Gmail SMTP email endpoint for Skylark Email Automation.

WHY THIS EXISTS:
  The frontend runs from file:// — browsers block CORS requests from file://
  origins, and Google Apps Script (GAS) webhooks require a CORS preflight that
  Chrome refuses to send for file:// pages.  Routing the send through this
  local Python backend completely bypasses CORS — it's a same-machine call
  (localhost) that is never subject to cross-origin restrictions.

  Emails sent via Gmail SMTP **DO** appear in the sender's Gmail Sent folder,
  which was the user's original requirement.

SETUP (one-time, takes ~2 minutes):
  1. Enable 2-Step Verification on your Google account.
  2. Visit https://myaccount.google.com/apppasswords
  3. Create an app password → choose "Mail" + "Windows Computer" → copy the
     16-character password (spaces are ignored).
  4. Open  backend/.env  (create from .env.example if it doesn't exist) and add:
       GMAIL_ADDRESS=alsharma2901@gmail.com
       GMAIL_APP_PASSWORD=xxxx xxxx xxxx xxxx
  5. Restart the backend:  npm run backend  (or  python -m uvicorn main:app ...)
"""

import os
import re
import smtplib
import base64
import logging
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from email.mime.base import MIMEBase
from email import encoders
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from api.auth_sync import UserAccount, get_current_user

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/email", tags=["email"])


# ── Request / Response models ─────────────────────────────────────────────────

class Attachment(BaseModel):
    name: str = Field(min_length=1, max_length=180)
    type: str = Field(min_length=3, max_length=120)
    data: str = Field(min_length=1, max_length=7_000_000)


class InlineImage(BaseModel):
    cid: str = Field(min_length=1, max_length=120)
    name: str = Field(min_length=1, max_length=180)
    type: str = Field(min_length=3, max_length=120)
    data: str = Field(min_length=1, max_length=2_000_000)


class SendEmailRequest(BaseModel):
    to: str = Field(min_length=3, max_length=4000)
    subject: str = Field(min_length=1, max_length=240)
    htmlBody: str = Field(min_length=1, max_length=250_000)
    cc: Optional[str] = Field(default="", max_length=4000)
    bcc: Optional[str] = Field(default="", max_length=4000)
    replyTo: Optional[str] = Field(default="", max_length=320)
    senderName: Optional[str] = Field(default="", max_length=160)
    attachments: Optional[List[Attachment]] = []
    inlineImages: Optional[List[InlineImage]] = []


class ConfigureRequest(BaseModel):
    gmail_address: str = Field(min_length=5, max_length=320)
    gmail_app_password: str = Field(min_length=16, max_length=32)


class SendEmailResponse(BaseModel):
    status: str          # "success" | "error"
    message: str
    to: Optional[str] = None
    quotaNote: Optional[str] = None


class StatusResponse(BaseModel):
    status: str
    configured: bool
    senderEmail: Optional[str] = None
    message: str


# ── Helper ────────────────────────────────────────────────────────────────────

def _get_credentials():
    """Return (gmail_address, app_password) from environment, or (None, None)."""
    addr = os.getenv("GMAIL_ADDRESS", "").strip()
    pwd  = os.getenv("GMAIL_APP_PASSWORD", "").replace(" ", "").strip()
    # Reject placeholder values
    if "YOUR_" in pwd or len(pwd) < 16:
        pwd = None
    return (addr or None, pwd or None)


# ── Routes ────────────────────────────────────────────────────────────────────

@router.get("/status", response_model=StatusResponse)
async def email_status(user: UserAccount = Depends(get_current_user)):
    """Health-check: confirms whether Gmail credentials are configured."""
    addr, pwd = _get_credentials()
    if addr and pwd:
        return StatusResponse(
            status="ok",
            configured=True,
            senderEmail=addr,
            message=f"Gmail SMTP ready — sending as {addr}"
        )
    return StatusResponse(
        status="not_configured",
        configured=False,
        message="Add GMAIL_ADDRESS and GMAIL_APP_PASSWORD to backend/.env"
    )


@router.post("/configure")
async def configure_email(req: ConfigureRequest, user: UserAccount = Depends(get_current_user)):
    # A browser user must never be able to overwrite the process-wide mail
    # credentials or write backend/.env. Configure mail through deployment
    # administration or a per-user encrypted credential vault instead.
    raise HTTPException(status_code=403, detail="Email credentials are managed by the backend administrator")


@router.post("/send", response_model=SendEmailResponse)
async def send_email(req: SendEmailRequest, user: UserAccount = Depends(get_current_user)):
    """
    Send one email via Gmail SMTP.
    Emails sent this way appear in the sender's Gmail Sent folder.
    """
    addr, pwd = _get_credentials()
    if not addr or not pwd:
        return SendEmailResponse(
            status="error",
            message="Gmail credentials not configured. Add GMAIL_ADDRESS and GMAIL_APP_PASSWORD to backend/.env"
        )

    try:
        if sum(len((a.data or "")) for a in (req.attachments or [])) > 7_000_000:
            raise HTTPException(status_code=413, detail="Attachments are too large")
        # ── Build the MIME message ────────────────────────────────────────────
        # Root mixed container supports normal attachments; the related part
        # keeps CID signature images/GIFs attached to the HTML alternative.
        msg = MIMEMultipart("mixed")
        sender_display = f"{req.senderName} <{addr}>" if req.senderName else addr
        msg["From"]    = sender_display
        msg["To"]      = req.to
        msg["Subject"] = req.subject

        if req.cc:  msg["Cc"]       = req.cc
        if req.replyTo: msg["Reply-To"] = req.replyTo

        import re
        plain = re.sub(r"<[^>]+>", "", req.htmlBody).strip()
        alternatives = MIMEMultipart("alternative")
        alternatives.attach(MIMEText(plain, "plain", "utf-8"))

        if req.inlineImages:
            related = MIMEMultipart("related")
            related.attach(MIMEText(req.htmlBody, "html", "utf-8"))
            for inline in req.inlineImages:
                try:
                    safe_cid = re.sub(r"[^a-zA-Z0-9_-]", "", inline.cid)
                    if not safe_cid:
                        continue
                    raw = base64.b64decode(inline.data, validate=True)
                    maintype, subtype = inline.type.split("/", 1) if "/" in inline.type else ("image", "png")
                    part = MIMEBase(maintype, subtype)
                    part.set_payload(raw)
                    encoders.encode_base64(part)
                    part.add_header("Content-ID", f"<{safe_cid}>")
                    part.add_header("Content-Disposition", "inline", filename=inline.name)
                    related.attach(part)
                except Exception as exc:
                    logger.warning(f"Skipping inline image {inline.name}: {exc}")
            alternatives.attach(related)
        else:
            alternatives.attach(MIMEText(req.htmlBody, "html", "utf-8"))

        msg.attach(alternatives)

        # Attachments
        for att in (req.attachments or []):
            try:
                raw = base64.b64decode(att.data)
                part = MIMEBase(*att.type.split("/", 1) if "/" in att.type else ("application", "octet-stream"))
                part.set_payload(raw)
                encoders.encode_base64(part)
                part.add_header("Content-Disposition", "attachment", filename=att.name)
                msg.attach(part)
            except Exception as e:
                logger.warning(f"Skipping attachment {att.name}: {e}")

        # ── Collect all recipients (To + CC + BCC) ────────────────────────────
        recipients = [req.to]
        if req.cc:  recipients += [a.strip() for a in req.cc.split(",")  if a.strip()]
        if req.bcc: recipients += [a.strip() for a in req.bcc.split(",") if a.strip()]

        # ── Send via Gmail SMTP (port 587, STARTTLS) ──────────────────────────
        with smtplib.SMTP("smtp.gmail.com", 587, timeout=30) as server:
            server.ehlo()
            server.starttls()
            server.ehlo()
            server.login(addr, pwd)
            server.sendmail(addr, recipients, msg.as_string())

        logger.info(f"[EmailSender] Sent to {req.to} — Subject: {req.subject}")
        return SendEmailResponse(
            status="success",
            message="Email sent successfully via Gmail SMTP",
            to=req.to,
            quotaNote="Sent via Gmail SMTP — appears in your Gmail Sent folder"
        )

    except smtplib.SMTPAuthenticationError:
        logger.error("[EmailSender] Gmail SMTP authentication failed")
        return SendEmailResponse(
            status="error",
            message="Gmail authentication failed. Check your GMAIL_APP_PASSWORD in backend/.env. Make sure 2-Step Verification is ON and you used an App Password (not your regular password)."
        )
    except HTTPException:
        raise
    except smtplib.SMTPException as e:
        logger.error(f"[EmailSender] SMTP error: {e}")
        return SendEmailResponse(status="error", message="Email provider rejected the request")
    except Exception:
        logger.exception("[EmailSender] Unexpected send failure")
        return SendEmailResponse(status="error", message="Email could not be sent")
