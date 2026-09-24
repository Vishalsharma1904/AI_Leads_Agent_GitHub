param([switch]$SkipSpeechModels)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$setup = Join-Path $root 'scripts\setup-clavis-runtime.ps1'
& powershell -NoProfile -ExecutionPolicy Bypass -File $setup

$python = Join-Path $root 'backend\.venv312\Scripts\python.exe'
& $python -m pip install pyinstaller
$dist = Join-Path $root 'dist\Clavis'
if (Test-Path -LiteralPath $dist) { Remove-Item -LiteralPath $dist -Recurse -Force }
New-Item -ItemType Directory -Path $dist -Force | Out-Null

# Freeze the API into a relocatable onedir executable. The frontend still
# starts beside it, while the Python environment itself stays out of the
# shipped application directory.
Push-Location (Join-Path $root 'installer')
try {
  & $python -m PyInstaller --noconfirm --clean --distpath (Join-Path $root 'dist\backend-runtime') --workpath (Join-Path $root 'build\pyinstaller') (Join-Path $root 'installer\ClavisBackend.spec')
  if ($LASTEXITCODE) { throw "PyInstaller failed with exit code $LASTEXITCODE" }
} finally { Pop-Location }
if (Test-Path -LiteralPath (Join-Path $root 'dist\backend-runtime\ClavisBackend')) {
  Copy-Item -LiteralPath (Join-Path $root 'dist\backend-runtime\ClavisBackend') -Destination (Join-Path $dist 'backend-runtime') -Recurse -Force
}

# Static frontend and local reaction assets are copied beside the bundled API.
# NOTE: Windows PowerShell 5.1 me -Include tabhi asar karta hai jab path wildcard par
# khatam ho ya -Recurse ho. -LiteralPath wildcard le hi nahi sakta, isliye 5.1 par purani
# line 0 files deti thi aur dist sirf index.html leke ship ho jata tha (PS 7 par chalti hai,
# isliye bug kabhi-kabhi hi dikhta tha). 'path + \*' dono par kaam karta hai.
# Neeche ka throw ise ab silent fail nahi hone dega.
Copy-Item -LiteralPath (Join-Path $root 'index.html') -Destination $dist -Force
$rootFiles = Get-ChildItem -Path (Join-Path $root '*') -File -Include *.js,*.css,*.svg,*.png,*.jpg,*.json,*.bat,*.ps1
if (-not $rootFiles) { throw 'No root frontend files matched - staging would ship a broken bundle.' }
$rootFiles | Copy-Item -Destination $dist -Force
Write-Host "Staged $($rootFiles.Count) root frontend files"

Copy-Item -LiteralPath (Join-Path $root 'audio') -Destination $dist -Recurse -Force
Copy-Item -LiteralPath (Join-Path $root 'clavis-bridge') -Destination $dist -Recurse -Force

# index.html supabase UMD ko node_modules se load karta hai, aur serve-clavis.js
# serve-handler par chalta hai. Inke bina bundle boot hi nahi hoga.
Copy-Item -LiteralPath (Join-Path $root 'node_modules') -Destination $dist -Recurse -Force
foreach ($needed in @(
  'node_modules\@supabase\supabase-js\dist\umd\supabase.js',
  'node_modules\serve-handler\package.json'
)) {
  if (-not (Test-Path -LiteralPath (Join-Path $dist $needed))) { throw "Missing in bundle: $needed" }
}

# Reuse already downloaded Hugging Face snapshots when available so a release
# build is offline on first launch. Missing snapshots are reported explicitly;
# silently shipping a bundle that later falls back to a cloud voice is not OK.
$speechModels = Join-Path $dist 'speech-models'
$kokoroCache = Join-Path $env:USERPROFILE '.cache\huggingface\hub\models--hexgrad--Kokoro-82M\snapshots'
$kokoroSnapshot = Get-ChildItem -LiteralPath $kokoroCache -Directory -ErrorAction SilentlyContinue |
  Sort-Object LastWriteTime -Descending | Select-Object -First 1
if ($kokoroSnapshot) {
  New-Item -ItemType Directory -Path $speechModels -Force | Out-Null
  Copy-Item -LiteralPath $kokoroSnapshot.FullName -Destination (Join-Path $speechModels 'kokoro') -Recurse -Force
  Write-Host "Bundled Kokoro snapshot: $($kokoroSnapshot.FullName)"
} else {
  Write-Warning 'Kokoro snapshot not found in the local Hugging Face cache; release will require a model preparation step.'
}

$backendStage = Join-Path $dist 'backend'
New-Item -ItemType Directory -Path $backendStage -Force | Out-Null
# skylark_cloud.db bhi exclude - fresh install ko purane accounts nahi milne chahiye.
Get-ChildItem -LiteralPath (Join-Path $root 'backend') -Force | Where-Object {
  $_.Name -notin @('.venv', '.venv312', '__pycache__', 'skylark_cloud.db', 'tests')
} | ForEach-Object {
  Copy-Item -LiteralPath $_.FullName -Destination $backendStage -Recurse -Force
}

# main.py `load_dotenv()` bina argument ke chalata hai - wo CWD se upar dhoondhta hai.
# Frozen exe app root se start hota hai, isliye .env root me bhi chahiye warna
# SUPABASE_URL khaali rahega aur app "Supabase Auth is not configured" dikhayega.
$envFile = Join-Path $root 'backend\.env'
if (Test-Path -LiteralPath $envFile) {
  Copy-Item -LiteralPath $envFile -Destination (Join-Path $dist '.env') -Force
  Write-Warning 'Bundle me backend\.env hai (SUPABASE_SECRET_KEY sameth). Ye build kisi ke saath share mat kijiye.'
} else {
  Write-Warning 'backend\.env nahi mila - bundle bina auth config ke boot hoga.'
}

Write-Host "Clavis onedir staging bundle prepared at $dist"
Write-Host 'Run installer/Clavis.iss with Inno Setup to create Clavis-Setup.exe.'
