"""Create a backend-only deployment snapshot; never copy local data or credentials."""
from pathlib import Path
import hashlib
import json
import os
import re
import shutil
import zipfile

root = Path(__file__).resolve().parents[1]
target = root / 'work' / 'mobile-cloud-deployment'
assert not target.exists(), 'Deployment snapshot already exists; inspect before replacing it.'
excluded = {'.venv', '.venv312', '__pycache__', 'storage', 'tests', '.git'}
allowed = {'.py', '.txt', '.sql', '.md', '.json', '.yaml', '.yml', '.toml'}
known_names = {'Dockerfile', '.dockerignore', '.env.example'}
secret = re.compile(r'(?:gsk_[A-Za-z0-9]{25,}|apify_api_[A-Za-z0-9]{20,}|AIza[A-Za-z0-9_-]{30,}|sb_secret_[A-Za-z0-9_-]{20,}|sk-[A-Za-z0-9]{30,}|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----)')
files = []
sources = []
for folder, dirs, names in os.walk(root / 'backend', followlinks=False):
    dirs[:] = [name for name in dirs if name not in excluded and not name.startswith('.')]
    sources.extend(Path(folder) / name for name in names)
for source in sorted(sources):
    relative = source.relative_to(root)
    if any(part in excluded for part in relative.parts) or source.is_symlink():
        continue
    if not source.is_file():
        continue
    if source.name.startswith('.') and source.name not in known_names:
        continue
    if source.name.startswith('.env') and source.name != '.env.example':
        continue
    if source.name not in known_names and source.suffix not in allowed:
        continue
    if secret.search(source.read_text(encoding='utf-8', errors='replace')):
        raise RuntimeError(f'Potential embedded credential in {relative}; no upload permitted.')
    files.append((source, relative))
assert any(relative.as_posix() == 'backend/main.py' for _, relative in files)
assert any(relative.as_posix() == 'backend/api/mobile_jobs.py' for _, relative in files)
files.append((root / 'Rudra24Mobile/render-supabase.yaml', Path('render.yaml')))
target.mkdir(parents=True)
manifest = {}
for source, relative in files:
    destination = target / relative
    destination.parent.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(source, destination)
    manifest[relative.as_posix()] = hashlib.sha256(destination.read_bytes()).hexdigest()
(target / '.gitignore').write_text('.env\n.env.*\n!.env.example\n*.db\n*.sqlite*\n__pycache__/\n.venv*/\nstorage/\n', encoding='utf-8')
archive = root / 'Rudra24Mobile/artifacts/Rudra24-Cloud-Backend.zip'
with zipfile.ZipFile(archive, 'w', zipfile.ZIP_DEFLATED) as package:
    for path in sorted(target.rglob('*')):
        if path.is_file():
            package.write(path, path.relative_to(target).as_posix())
with zipfile.ZipFile(archive) as package:
    assert package.testzip() is None
    for name, checksum in manifest.items():
        assert hashlib.sha256(package.read(name)).hexdigest() == checksum
    assert not any(name.endswith(('.db', '.sqlite', '.jks', '.keystore')) for name in package.namelist())
    assert 'backend/.family-providers.json' not in package.namelist()
(root / 'work/cleanup-recovery-20261012/deployment-manifest.json').write_text(json.dumps(manifest, indent=2), encoding='utf-8')
print(json.dumps({'source_files': len(files), 'source_bytes': sum((target / r).stat().st_size for _, r in files), 'archive_bytes': archive.stat().st_size, 'archive_sha256': hashlib.sha256(archive.read_bytes()).hexdigest()}))
