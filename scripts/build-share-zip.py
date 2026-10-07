"""Build the Rudra24 AI share ZIP without local keys, accounts, logs or databases.

Run from the repo: python scripts/build-share-zip.py
"""
from __future__ import annotations

import hashlib
from pathlib import Path
import re
import zipfile

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT.parent / "Rudra24 AI-Leads-Share-2026-09-29.zip"
ROOT_EXT = {".html", ".js", ".mjs", ".css", ".json", ".webmanifest", ".svg", ".png", ".jpg", ".jpeg", ".gif", ".webp", ".ico", ".woff", ".woff2", ".ttf", ".mp3", ".wav", ".ogg", ".bat", ".vbs", ".ps1"}
ASSET_DIRS = {"audio", "fonts", "vendor", "node_modules", "clavis-bridge"}
BACKEND_DIRS = {"api", "models", "schemas", "services", "utils", "workers", "ws_handlers", "migrations"}
SCRIPTS = {"start-backend.ps1", "serve-clavis.ps1", "setup-clavis-runtime.ps1"}
KEY_RE = re.compile(rb"(?:AIza[0-9A-Za-z_-]{30,}|sk-or-v1-[0-9a-f]{25,}|sk-[A-Za-z0-9]{35,}|sb_secret_[A-Za-z0-9_-]{20,}|ghp_[A-Za-z0-9]{30,})")


def included(path: Path) -> bool:
    rel = path.relative_to(ROOT)
    parts = rel.parts
    if path.is_symlink() or any(part.startswith(".") or part in {"__pycache__", "tests"} for part in parts):
        return False
    if len(parts) == 1:
        return path.suffix.lower() in ROOT_EXT and not path.name.startswith(("audit-", "patch_", "apply_"))
    if parts[0] == "scripts":
        return len(parts) == 2 and path.name in SCRIPTS
    if parts[0] == "backend":
        return (len(parts) == 2 and path.name in {"main.py", "database.py", "requirements.txt", "alembic.ini", "packaged_entry.py"}) or (
            parts[1] in BACKEND_DIRS and path.suffix.lower() in {".py", ".ini"}
        )
    return parts[0] in ASSET_DIRS


README = """RUDRA24 AI LEADS - START HERE

1. Extract this ZIP completely to a folder on a Windows PC. Do not run it inside the ZIP.
2. Install Python 3.12 from https://www.python.org/downloads/ (enable 'Add Python to PATH').
   Node.js is optional; without it, the built-in PowerShell web server runs the UI.
3. Double-click Start-Clavis.bat. On the first run the backend downloads Python
   packages and the browser scraper. This can take several minutes and needs internet.
   If it fails, read logs/backend.log and logs/backend-install.log.
4. Open Client AI or Rudra24 AI, ask for leads by city, e.g. 'Ghaziabad ki leads do'.
   The floating window shows the first five leads; the full list is in the app.
5. Add your own Google/Gemini, Apify or Fish Audio keys in the app's setup if needed.
   No personal keys, accounts, leads, login session or database are in this ZIP.
   Google AI Studio key page: https://aistudio.google.com/apikey

Google Maps can block automated discovery; if a search returns no verified
businesses, try again later or use an Apify key. Cloud features require
their own keys and internet. For private/local sharing only; production auth
and deployment configuration must be set up separately.
"""


def build() -> tuple[int, int]:
    candidates = list(ROOT.iterdir())
    candidates += [ROOT / "scripts" / name for name in SCRIPTS]
    candidates += list((ROOT / "backend").iterdir())
    for dirname in ASSET_DIRS:
        folder = ROOT / dirname
        if folder.exists():
            candidates.extend(folder.rglob("*"))
    for dirname in BACKEND_DIRS:
        folder = ROOT / "backend" / dirname
        if folder.exists():
            candidates.extend(folder.rglob("*"))
    files = sorted(path for path in candidates if path.is_file() and included(path))
    assert any(path.name == "index.html" for path in files)
    assert any(path.name == "maps_scraper.py" for path in files)
    for path in files:
        if path.suffix.lower() in {".js", ".py", ".json", ".html"} and parts_root(path):
            if KEY_RE.search(path.read_bytes()):
                raise RuntimeError(f"Possible embedded key: {path.relative_to(ROOT)}")
    with zipfile.ZipFile(OUT, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=6) as archive:
        archive.writestr("Rudra24 AI-Leads/START-HERE.txt", README)
        for path in files:
            archive.write(path, "Rudra24 AI-Leads/" + path.relative_to(ROOT).as_posix())
    with zipfile.ZipFile(OUT) as archive:
        names = archive.namelist()
        bad = [name for name in names if any(part.startswith(".") or part in {"logs", "tests", "__pycache__"} for part in Path(name).parts) or name.endswith((".db", ".sqlite", ".sqlite3"))]
        assert not bad, bad
        assert archive.testzip() is None
        assert "Rudra24 AI-Leads/index.html" in names
        assert "Rudra24 AI-Leads/backend/services/leads/maps_scraper.py" in names
    return len(files), OUT.stat().st_size


def parts_root(path: Path) -> bool:
    return path.relative_to(ROOT).parts[0] not in {"node_modules", "vendor"}


if __name__ == "__main__":
    count, size = build()
    digest = hashlib.sha256(OUT.read_bytes()).hexdigest()
    print(f"ZIP {OUT} | files={count} | bytes={size} | sha256={digest}")
