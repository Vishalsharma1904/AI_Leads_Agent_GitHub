"""Build the Rudra24 AI share ZIP without local keys, accounts, logs or databases.

Run from the repo: python scripts/build-share-zip.py
"""
from __future__ import annotations

import hashlib
from pathlib import Path
import re
import zipfile
import argparse
import json
import os
import base64
import sqlite3
import secrets

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / 'exports' / 'Rudra24-AI-Share-2026-10-12.zip'
ROOT_EXT = {".html", ".js", ".mjs", ".css", ".json", ".webmanifest", ".svg", ".png", ".jpg", ".jpeg", ".gif", ".webp", ".ico", ".woff", ".woff2", ".ttf", ".mp3", ".wav", ".ogg", ".bat", ".vbs", ".ps1"}
ASSET_DIRS = {"audio", "fonts", "vendor", "assets", "clavis-bridge", "installer", "api"}
BACKEND_DIRS = {"api", "models", "schemas", "services", "utils", "workers", "ws_handlers", "migrations"}
SCRIPTS = {"start-backend.ps1", "serve-clavis.ps1", "setup-clavis-runtime.ps1"}
KEY_RE = re.compile(rb"(?:AIza[0-9A-Za-z_-]{30,}|sk-or-v1-[0-9a-f]{25,}|sk-[A-Za-z0-9]{35,}|sb_secret_[A-Za-z0-9_-]{20,}|ghp_[A-Za-z0-9]{30,})")


def included(path: Path) -> bool:
    rel = path.relative_to(ROOT)
    parts = rel.parts
    if path.is_symlink() or any(part.startswith(".") or part in {"__pycache__", "tests"} for part in parts):
        return False
    if len(parts) == 1:
        return path.suffix.lower() in ROOT_EXT and not path.name.startswith(("audit-", "patch_", "apply_", "secrets.local")) and 'backup' not in path.name.lower()
    if parts[0] == "scripts":
        return len(parts) == 2 and path.name in SCRIPTS
    if parts[0] == "backend":
        return (len(parts) == 2 and path.name in {"main.py", "database.py", "requirements.txt", "alembic.ini", "packaged_entry.py"}) or (
            parts[1] in BACKEND_DIRS and path.suffix.lower() in {".py", ".ini", ".sql"}
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


def family_entries():
    from dotenv import dotenv_values
    from cryptography.hazmat.primitives.ciphers.aead import AESGCM
    source = dotenv_values(ROOT / 'backend' / '.env')
    master = hashlib.sha256(str(source.get('CREDENTIAL_MASTER_KEY') or '').encode()).digest()
    allowed = ['alsharma2901@gmail.com', 'alsharma2901555@gmail.com']
    portable_key = secrets.token_bytes(32)
    credentials = {}
    with sqlite3.connect(ROOT / 'backend' / 'skylark_cloud.db') as db:
        for provider, ciphertext, nonce in db.execute('SELECT provider,ciphertext,nonce FROM provider_credentials JOIN user_accounts ON user_accounts.id=provider_credentials.owner_user_id WHERE lower(email)=?', (allowed[1],)):
            if provider not in {'apify','groq','elevenlabs'} or not ciphertext:
                continue
            secret = AESGCM(master).decrypt(base64.urlsafe_b64decode(nonce), base64.urlsafe_b64decode(ciphertext), None)
            iv = secrets.token_bytes(12)
            credentials[provider] = {'nonce':base64.urlsafe_b64encode(iv).decode(),'ciphertext':base64.urlsafe_b64encode(AESGCM(portable_key).encrypt(iv,secret,provider.encode())).decode()}
    if set(credentials) != {'apify','groq','elevenlabs'}:
        raise RuntimeError('Dad primary account must have all three configured providers before family packaging')
    public = json.loads((ROOT / 'public-auth-config.json').read_text())
    env = 'APP_ENV=development\nSUPABASE_URL='+public['supabase_url']+'\nSUPABASE_PUBLISHABLE_KEY='+public['supabase_publishable_key']+'\nCREDENTIAL_MASTER_KEY='+secrets.token_urlsafe(48)+'\n'
    envelope = json.dumps({'version':1,'allowed_emails':allowed,'key':base64.urlsafe_b64encode(portable_key).decode(),'credentials':credentials})
    return {'backend/.family-providers.json':envelope,'backend/.env':env}

def build(family=False, node_runtime=None, python_runtime=None, site_packages=None) -> tuple[int, int]:
    candidates = list(ROOT.iterdir())
    candidates += [ROOT / "scripts" / name for name in SCRIPTS]
    candidates += list((ROOT / "backend").iterdir())
    # Only the static server's dependency closure, never Electron/dev tools.
    modules = ['serve-handler']; seen_modules = set()
    while modules:
        name = modules.pop()
        if name in seen_modules: continue
        seen_modules.add(name)
        folder = ROOT / 'node_modules' / name
        manifest = folder / 'package.json'
        if manifest.exists():
            modules.extend(json.loads(manifest.read_text()).get('dependencies', {}))
            candidates.extend(p for p in folder.rglob('*') if p.is_file())
    for dirname in ASSET_DIRS:
        folder = ROOT / dirname
        if folder.exists():
            candidates.extend(folder.rglob("*"))
    for dirname in BACKEND_DIRS:
        folder = ROOT / "backend" / dirname
        if folder.exists():
            candidates.extend(folder.rglob("*"))
    files = sorted(set(path for path in candidates if path.is_file() and (included(path) or path.relative_to(ROOT).parts[0]=='node_modules' and not any(p.startswith('.') or p in {'test','tests','__pycache__'} for p in path.relative_to(ROOT).parts) and not path.is_symlink())))
    assert any(path.name == "index.html" for path in files)
    assert any(path.name == "maps_scraper.py" for path in files)
    for path in files:
        if path.suffix.lower() in {".js", ".py", ".json", ".html"} and parts_root(path):
            if KEY_RE.search(path.read_bytes()):
                raise RuntimeError(f"Possible embedded key: {path.relative_to(ROOT)}")
    OUT.parent.mkdir(parents=True, exist_ok=True)
    extras = family_entries() if family else {}
    readme = ('RUDRA24 AI — PRIVATE DAD EDITION\n\nExtract this ZIP completely to a folder. Double-click clavis.bat once; it creates the Rudra24 AI desktop shortcut and starts the app with no command window. After that, open Rudra24 AI from the desktop shortcut. Portable Node/Python runtimes are included. Internet is required. Backend packages are already included, so the app opens in under a minute.\n\nSign in normally as alsharma2901@gmail.com or alsharma2901555@gmail.com. Their existing Groq, Apify and ElevenLabs access is included; no key entry needed. No passwords or login sessions are included. Accounts keep separate leads/history/personalization. Provider credits and carrier requirements still apply. Explicit Remove disconnects access for that account; adding a key reconnects it.\n\nThis private ZIP contains reusable provider access intended only for Dad. Keep it within the family. No project auth signing/service keys, leads, conversations or original database are included. The encryption prevents casual plaintext exposure; a person controlling this PC can extract the provider keys.\n') if family else README
    with zipfile.ZipFile(OUT, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=6) as archive:
        archive.writestr("Rudra24 AI-Leads/START-HERE.txt", readme)
        for path in files:
            archive.write(path, "Rudra24 AI-Leads/" + path.relative_to(ROOT).as_posix())
        for name, content in extras.items(): archive.writestr('Rudra24 AI-Leads/'+name, content)
        if node_runtime:
            archive.write(node_runtime,'Rudra24 AI-Leads/runtime/node/node.exe')
            archive.write(ROOT/'exports'/'Node-LICENSE.txt','Rudra24 AI-Leads/runtime/node/LICENSE.txt')
        if python_runtime:
            base=Path(python_runtime)
            for directory, subdirs, filenames in os.walk(base):
                subdirs[:] = [name for name in subdirs if name not in {'site-packages','__pycache__','Scripts','include','libs'} and not name.startswith('.')]
                for filename in filenames:
                    path=Path(directory)/filename
                    if not path.is_symlink(): archive.write(path,'Rudra24 AI-Leads/runtime/python/'+path.relative_to(base).as_posix())
        if site_packages:
            # Windows cp312 wheels pre-installed (scripts/build-windows-site-packages.sh) so the
            # backend starts in seconds on a fresh PC instead of pip-installing on first launch.
            base=Path(site_packages)
            for path in base.rglob('*'):
                rel=path.relative_to(base)
                if path.is_file() and rel.parts[0] not in {'bin','include'} and '__pycache__' not in rel.parts:
                    archive.write(path,'Rudra24 AI-Leads/runtime/python/Lib/site-packages/'+rel.as_posix())
    with zipfile.ZipFile(OUT) as archive:
        names = archive.namelist()
        exceptions = {'Rudra24 AI-Leads/'+name for name in extras}
        bad = [name for name in names if name not in exceptions and (any(part.startswith(".") or part in {"logs", "tests", "__pycache__"} for part in Path(name).parts) or name.endswith((".db", ".sqlite", ".sqlite3")))]
        assert not bad, bad
        assert archive.testzip() is None
        assert "Rudra24 AI-Leads/index.html" in names
        assert "Rudra24 AI-Leads/backend/services/leads/maps_scraper.py" in names
    if family:
        (ROOT / 'backend' / '.family-providers.json').write_text(extras['backend/.family-providers.json'],encoding='utf-8')
    return len(files), OUT.stat().st_size


def parts_root(path: Path) -> bool:
    return path.relative_to(ROOT).parts[0] not in {"node_modules", "vendor"}


if __name__ == "__main__":
    parser = argparse.ArgumentParser(); parser.add_argument('--family', action='store_true'); parser.add_argument('--node-runtime');parser.add_argument('--python-runtime');parser.add_argument('--site-packages');args=parser.parse_args()
    if args.family: OUT = ROOT / 'exports' / 'Rudra24-AI-Dad-Private-2026-10-12.zip'
    count, size = build(args.family,args.node_runtime,args.python_runtime,args.site_packages)
    digest = hashlib.sha256(OUT.read_bytes()).hexdigest()
    print(f"ZIP {OUT} | files={count} | bytes={size} | sha256={digest}")
