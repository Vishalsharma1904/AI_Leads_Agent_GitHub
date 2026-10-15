"""Preserve generated app bundles and verify an extracted export before cleanup."""
from pathlib import Path
import hashlib
import json
import zipfile
import zlib

root=Path(__file__).resolve().parents[1]
recovery=root/'work'/'cleanup-recovery-20261012'
recovery.mkdir(exist_ok=True)
archive=recovery/'packaged-app-resources.zip'
resources=[root/'release'/'win-unpacked'/'resources',root/'tests'/'artifacts'/'package-verification'/'win-unpacked'/'resources']
records=[]
with zipfile.ZipFile(archive,'w',zipfile.ZIP_DEFLATED,compresslevel=9) as out:
    for directory in resources:
        for path in directory.rglob('*'):
            if path.is_file():
                relative=path.relative_to(root).as_posix()
                out.write(path,relative)
                records.append({'path':relative,'bytes':path.stat().st_size,'sha256':hashlib.sha256(path.read_bytes()).hexdigest()})
with zipfile.ZipFile(archive) as saved:
    assert saved.testzip() is None
    for entry in records:
        assert hashlib.sha256(saved.read(entry['path'])).hexdigest()==entry['sha256']

extracted=root/'work'/'dad-package-runtime'
original=root/'exports'/'Rudra24-AI-Dad-Private-2026-10-12.zip'
checked=0
with zipfile.ZipFile(original) as saved:
    assert saved.testzip() is None
    for path in extracted.rglob('*'):
        if not path.is_file():continue
        name=path.relative_to(extracted).as_posix()
        entry=saved.getinfo(name)
        assert entry.file_size==path.stat().st_size,(name,'size differs from kept export')
        crc=0
        with path.open('rb') as source:
            for chunk in iter(lambda:source.read(1024*1024),b''):crc=zlib.crc32(chunk,crc)
        assert (crc&0xffffffff)==entry.CRC,(name,'content differs from kept export')
        checked+=1

preserve=[root/'index.html',root/'package.json',root/'backend/main.py',root/'backend/api/auth_sync.py',
          root/'Rudra24Mobile/android/app/src/main/java/ai/rudra24/mobile/Workspace.kt',
          root/'Rudra24Mobile/android/app/src/main/java/ai/rudra24/mobile/MainActivity.kt',
          root/'Rudra24Mobile/artifacts/Rudra24-Mobile-1.2.0.apk']
result={'resource_recovery_archive':str(archive.relative_to(root)),'archive_bytes':archive.stat().st_size,
        'resources':records,'extracted_export_files_verified':checked,'kept_original_export':str(original.relative_to(root)),
        'protected_hashes':{str(p.relative_to(root)):hashlib.sha256(p.read_bytes()).hexdigest() for p in preserve}}
(recovery/'preservation.json').write_text(json.dumps(result,indent=2),encoding='utf-8')
print(json.dumps({k:v for k,v in result.items() if k not in {'resources','protected_hashes'}},indent=2))
