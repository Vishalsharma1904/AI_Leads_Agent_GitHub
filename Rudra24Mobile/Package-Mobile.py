"""Package mobile source and backend deployment files; never include user secrets/data."""
from pathlib import Path
import hashlib
import os
import zipfile

mobile=Path(__file__).resolve().parent
root=mobile.parent
output=mobile/'artifacts'
output.mkdir(exist_ok=True)
archive=output/'Rudra24-Mobile-Source.zip'
excluded={'.toolchain','.gradle','build','artifacts','__pycache__','.venv','.venv312','.git','node_modules','logs','exports'}
def source_files(directory):
    for folder,dirs,names in os.walk(directory):
        dirs[:]=[name for name in dirs if name not in excluded and not name.startswith('.')]
        for name in names:
            yield Path(folder)/name
files=[]
for file in source_files(mobile):
    if file.name.startswith('.') and file.name!='.gitignore':continue
    if file.name=='local.properties':continue
    if file.is_file() and (file.suffix in {'.py','.ps1','.md','.json','.js','.mjs','.html','.css','.svg','.png','.webmanifest','.kts','.properties','.xml','.sql','.yaml'} or file.name in {'.gitignore','deployment.env.example'}):
        files.append((file,'Rudra24Mobile/'+file.relative_to(mobile).as_posix()))
for file in source_files(root/'backend'):
    relative=file.relative_to(root)
    if not file.is_file() or set(relative.parts)&excluded or any(part.startswith('.') for part in relative.parts):continue
    if file.suffix in {'.py','.sql','.txt','.md','.toml'} or file.name=='Dockerfile':
        files.append((file,relative.as_posix()))
files.append((root/'render.yaml','render.yaml'))
with zipfile.ZipFile(archive,'w',zipfile.ZIP_DEFLATED) as package:
    for file,name in files:package.write(file,name)
with zipfile.ZipFile(archive) as package:
    assert package.testzip() is None
    assert not any(Path(name).name in {'.env','.family-providers.json'} or name.endswith(('.db','.sqlite','.jks','.keystore')) for name in package.namelist())
digest=hashlib.sha256(archive.read_bytes()).hexdigest()
(output/'SHA256.txt').write_text(digest+'  '+archive.name+'\n',encoding='utf-8')
print(f'Packaged {len(files)} source/deployment files: {archive.name} ({archive.stat().st_size} bytes)')
