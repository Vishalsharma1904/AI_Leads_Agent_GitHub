"""Redacted local voice diagnostics; never prints keys or user details.

Run from backend with .venv312/Scripts/python.exe scripts/diagnose_voice_credentials.py.
Add --live for quota-free provider metadata checks for a single voice workspace.
"""
import argparse
import asyncio
import json
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from api.auth_sync import SessionLocal, UserAccount
from api.credentials import ProviderCredential, get_provider_secret
import httpx


async def main(live):
    with SessionLocal() as db:
        rows = db.query(ProviderCredential).filter(ProviderCredential.provider.in_(["groq", "elevenlabs"])).all()
        owners = {r.owner_user_id for r in rows if r.provider == "elevenlabs"}
        print(json.dumps({"saved_credentials": {p: sum(r.provider == p for r in rows) for p in ("groq", "elevenlabs")}, "voice_workspaces": len(owners)}))
        if not live or len(owners) != 1:
            if live: print(json.dumps({"live": "skipped", "reason": "A single voice workspace is required to select its owned credentials."}))
            return
        user = db.get(UserAccount, next(iter(owners)))
        if user is None:
            print(json.dumps({"live": "skipped", "reason": "Voice credential owner is unavailable."}))
            return
        probes = [
            ("groq", "https://api.groq.com/openai/v1/models", "models"),
            ("elevenlabs", "https://api.elevenlabs.io/v1/voices", "voices"),
            ("elevenlabs", "https://api.elevenlabs.io/v1/models", "models"),
            ("elevenlabs", "https://api.elevenlabs.io/v1/user/subscription", "subscription"),
        ]
        async with httpx.AsyncClient(timeout=12) as client:
            for provider, url, kind in probes:
                key = get_provider_secret(provider, user, db)
                if not key:
                    print(json.dumps({"provider": provider, "probe": kind, "configured": False})); continue
                headers = {"xi-api-key": key} if provider == "elevenlabs" else {"Authorization": "Bearer " + key}
                try:
                    response = await client.get(url, headers=headers)
                    data = response.json()
                    result = {"provider": provider, "probe": kind, "status": response.status_code}
                    if response.is_success:
                        if kind == "subscription":
                            result["characters_remaining"] = max(0, (data.get("character_limit") or 0) - (data.get("character_count") or 0))
                        else:
                            items = data.get("data", []) if provider == "groq" else data.get("voices", []) if isinstance(data, dict) else data
                            result["count"] = len(items)
                            if provider == "groq": result["gpt_oss_available"] = [m.get("id") for m in items if m.get("id", "").startswith("openai/gpt-oss-")]
                    else:
                        detail = data.get("detail", {}) if isinstance(data, dict) else {}
                        result["error_code"] = detail.get("status", "provider_rejected") if isinstance(detail, dict) else "provider_rejected"
                    print(json.dumps(result))
                except Exception as error:
                    print(json.dumps({"provider": provider, "probe": kind, "error": type(error).__name__}))


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--live", action="store_true")
    asyncio.run(main(parser.parse_args().live))
