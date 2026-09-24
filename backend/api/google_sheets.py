"""Google Sheets incremental-consent and tenant-scoped sync endpoints."""
import json
import os
import time
from typing import Any

import httpx
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from api.auth_sync import UserAccount, get_current_user, get_db
from api.credentials import ProviderCredential, decrypt_secret, encrypt_secret

router = APIRouter(prefix="/api/v1/google-sheets", tags=["google_sheets"])
TOKEN_URL = "https://oauth2.googleapis.com/token"
SHEETS_SCOPE = "https://www.googleapis.com/auth/spreadsheets"


class SheetsConnectRequest(BaseModel):
    code: str = Field(min_length=10, max_length=8192)
    code_verifier: str = Field(min_length=43, max_length=128)


class SheetsSyncRequest(BaseModel):
    spreadsheet_id: str = Field(min_length=10, max_length=256)
    range: str = Field(default="Leads!A1", min_length=1, max_length=256)
    rows: list[list[Any]] = Field(min_length=1, max_length=5000)


def _oauth_config() -> tuple[str, str, str]:
    client_id = os.getenv("GOOGLE_CLIENT_ID", "").strip()
    client_secret = os.getenv("GOOGLE_CLIENT_SECRET", "").strip()
    redirect_uri = os.getenv("GOOGLE_SHEETS_REDIRECT_URI", "").strip()
    if not client_id or not client_secret or not redirect_uri:
        raise HTTPException(status_code=503, detail="Google Sheets OAuth is not configured on the server")
    return client_id, client_secret, redirect_uri


def _credential(user: UserAccount, db: Session) -> ProviderCredential | None:
    return db.query(ProviderCredential).filter_by(owner_user_id=user.id, provider="google_sheets").first()


@router.post("/connect")
async def connect_sheets(req: SheetsConnectRequest, db: Session = Depends(get_db), user: UserAccount = Depends(get_current_user)):
    client_id, client_secret, redirect_uri = _oauth_config()
    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(15.0, connect=5.0)) as client:
            response = await client.post(TOKEN_URL, data={
                "code": req.code, "client_id": client_id, "client_secret": client_secret,
                "redirect_uri": redirect_uri, "grant_type": "authorization_code",
                "code_verifier": req.code_verifier,
            })
        token_data = response.json()
        if response.status_code >= 400 or not token_data.get("refresh_token"):
            raise HTTPException(status_code=401, detail="Google Sheets authorization was not granted")
        secret = json.dumps({"refresh_token": token_data["refresh_token"], "scope": token_data.get("scope", SHEETS_SCOPE)})
        ciphertext, nonce = encrypt_secret(secret)
        record = _credential(user, db)
        if record:
            record.ciphertext, record.nonce, record.updated_at = ciphertext, nonce, time.time()
        else:
            record = ProviderCredential(owner_user_id=user.id, provider="google_sheets", ciphertext=ciphertext, nonce=nonce, updated_at=time.time())
            db.add(record)
        db.commit()
        return {"success": True, "provider": "google_sheets", "connected_at": record.updated_at}
    except HTTPException:
        raise
    except (httpx.HTTPError, ValueError):
        raise HTTPException(status_code=502, detail="Google authorization service is unavailable")


@router.get("/status")
def sheets_status(db: Session = Depends(get_db), user: UserAccount = Depends(get_current_user)):
    record = _credential(user, db)
    return {"success": True, "connected": bool(record), "updated_at": record.updated_at if record else None}


@router.post("/sync")
async def sync_sheets(req: SheetsSyncRequest, db: Session = Depends(get_db), user: UserAccount = Depends(get_current_user)):
    record = _credential(user, db)
    if not record:
        raise HTTPException(status_code=409, detail="Connect Google Sheets before syncing")
    client_id, client_secret, _ = _oauth_config()
    try:
        stored = json.loads(decrypt_secret(record))
        async with httpx.AsyncClient(timeout=httpx.Timeout(20.0, connect=5.0)) as client:
            token_response = await client.post(TOKEN_URL, data={
                "refresh_token": stored["refresh_token"], "client_id": client_id,
                "client_secret": client_secret, "grant_type": "refresh_token",
            })
            token_response.raise_for_status()
            access_token = token_response.json().get("access_token")
            if not access_token: raise RuntimeError("No Sheets access token returned")
            sheets_response = await client.post(
                f"https://sheets.googleapis.com/v4/spreadsheets/{req.spreadsheet_id}/values/{req.range}:append",
                params={"valueInputOption": "USER_ENTERED", "insertDataOption": "INSERT_ROWS"},
                headers={"Authorization": f"Bearer {access_token}"},
                json={"values": req.rows},
            )
            sheets_response.raise_for_status()
        return {"success": True, "updated_range": sheets_response.json().get("updates", {}).get("updatedRange")}
    except httpx.HTTPStatusError as exc:
        if exc.response.status_code in {401, 403}:
            raise HTTPException(status_code=401, detail="Google Sheets authorization expired or lacks access")
        raise HTTPException(status_code=502, detail="Google Sheets sync failed")
    except (httpx.HTTPError, KeyError, ValueError, RuntimeError):
        raise HTTPException(status_code=502, detail="Google Sheets service is unavailable")
