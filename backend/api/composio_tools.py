"""Composio — one managed-OAuth layer for 250+ outside apps (Gmail, Calendar,
Slack, Notion, Linear …).

Why this exists next to api/connectors.py: connectors.py hand-rolls OAuth and
knows four providers. Composio holds and refreshes the user's tokens itself, so
adding a fifth app here costs one string instead of a new OAuth branch. Nothing
third-party is stored on our side — only the tenant's own Composio API key, and
that lives in the same encrypted vault as every other provider key.

Every call is scoped to the tenant's own user id, so one browser's Gmail can
never answer for another's.

The SDK is imported lazily and on purpose: a server without the `composio`
package must fail on these four routes alone, never at import time.
"""
from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from api.auth_sync import UserAccount, get_current_user, get_db
from api.credentials import get_provider_secret
from api.limits import consume

router = APIRouter(prefix="/api/composio", tags=["composio"])

# ponytail: session ids cached in memory, not in the DB. A restart just mints a
# fresh session (cheap, no user-visible effect) — move to a table only if
# session-scoped state ever has to survive a deploy.
_SESSIONS: dict[str, str] = {}


def _api_key(user: UserAccount, db: Session) -> Optional[str]:
    return get_provider_secret("composio", user, db)


def _client(user: UserAccount, db: Session):
    key = _api_key(user, db)
    if not key:
        raise HTTPException(status_code=503, detail={
            "code": "COMPOSIO_NOT_CONFIGURED",
            "message": "Add your Composio API key in Setup first."})
    try:
        from composio import Composio
    except ImportError:
        raise HTTPException(status_code=503, detail={
            "code": "COMPOSIO_SDK_MISSING",
            "message": "This server does not have the composio package installed."}) from None
    return Composio(api_key=key)


def _session(client, user: UserAccount, toolkits: Optional[list[str]] = None):
    """Reuse the tenant's session when we have one; mint a new one if not.

    A stale id (expired server-side, or minted by a previous deploy) must not
    strand the tenant — it is dropped and replaced rather than raised.
    """
    cached = _SESSIONS.get(user.id)
    if cached:
        try:
            return client.use(cached)
        except Exception:
            _SESSIONS.pop(user.id, None)
    kwargs: dict[str, Any] = {"user_id": user.id}
    if toolkits:
        kwargs["toolkits"] = toolkits
    session = client.create(**kwargs)
    session_id = getattr(session, "session_id", None)
    if session_id:
        _SESSIONS[user.id] = session_id
    return session


def _upstream(error: Exception) -> HTTPException:
    return HTTPException(status_code=502, detail={
        "code": "COMPOSIO_UNAVAILABLE",
        "message": f"Composio could not complete that: {str(error)[:160]}",
        "retryable": True, "action": "RETRY"})


@router.get("/status")
def composio_status(db: Session = Depends(get_db), user: UserAccount = Depends(get_current_user)):
    """Never 503s. An unconfigured tenant is a normal state, not an error —
    the Setup screen reads this to decide what to show."""
    if not _api_key(user, db):
        return {"success": True, "configured": False, "connected": []}
    try:
        client = _client(user, db)
        accounts = client.connected_accounts.list(user_ids=[user.id], statuses=["ACTIVE"])
    except HTTPException:
        raise
    except Exception as error:
        # Configured but unreachable is still worth reporting as configured.
        return {"success": True, "configured": True, "connected": [],
                "warning": str(error)[:160]}
    items = getattr(accounts, "items", accounts) or []
    connected = []
    for account in items:
        toolkit = getattr(account, "toolkit", None)
        connected.append({
            "id": getattr(account, "id", None),
            "toolkit": getattr(toolkit, "slug", None) or str(toolkit or ""),
            "status": getattr(account, "status", None),
        })
    return {"success": True, "configured": True, "connected": connected}


class ConnectRequest(BaseModel):
    toolkit: str = Field(min_length=2, max_length=64)
    callback_url: Optional[str] = Field(default=None, max_length=512)


@router.post("/connect")
def connect_toolkit(req: ConnectRequest, db: Session = Depends(get_db),
                    user: UserAccount = Depends(get_current_user)):
    """Hand back the URL the owner opens to authorise an app. We never see the
    app's password or token — Composio completes the handshake."""
    client = _client(user, db)
    toolkit = req.toolkit.strip().lower()
    try:
        session = _session(client, user, [toolkit])
        request = session.authorize(toolkit)
    except Exception as error:
        raise _upstream(error) from None
    url = getattr(request, "redirect_url", None)
    if not url:
        # No redirect means the app needed no browser step (API-key auth) or is
        # already connected. Either way there is nothing for the owner to open.
        return {"success": True, "toolkit": toolkit, "redirect_url": None,
                "message": "Already connected."}
    return {"success": True, "toolkit": toolkit, "redirect_url": url}


@router.get("/tools")
def list_tools(toolkits: str = "", db: Session = Depends(get_db),
               user: UserAccount = Depends(get_current_user)):
    """Tool definitions for whatever the owner has connected, in OpenAI format —
    feed straight to the model as its tool list."""
    client = _client(user, db)
    wanted = [t.strip().lower() for t in toolkits.split(",") if t.strip()]
    try:
        session = _session(client, user, wanted or None)
        tools = session.tools()
    except Exception as error:
        raise _upstream(error) from None
    return {"success": True, "tools": tools}


class ExecuteRequest(BaseModel):
    tool: str = Field(min_length=2, max_length=128)
    arguments: dict[str, Any] = Field(default_factory=dict)


@router.post("/execute")
def execute_tool(req: ExecuteRequest, db: Session = Depends(get_db),
                 user: UserAccount = Depends(get_current_user)):
    """Run one tool. Metered on the 'ai' bucket like every other model-driven
    action, so a runaway agent hits the tenant's cap and not the bill."""
    client = _client(user, db)
    consume(db, user, "ai")
    try:
        result = client.tools.execute(
            req.tool.strip().upper(),
            user_id=user.id,
            arguments=req.arguments,
            dangerously_skip_version_check=True,
        )
    except Exception as error:
        raise _upstream(error) from None
    return {"success": True, "tool": req.tool, "result": result}
