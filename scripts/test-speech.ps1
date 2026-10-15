$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$backend = Join-Path $root 'backend'
$python = Join-Path $backend '.venv312\Scripts\python.exe'
if (-not (Test-Path -LiteralPath $python)) {
  $python = Join-Path $backend '.venv\Scripts\python.exe'
}
if (-not (Test-Path -LiteralPath $python)) {
  throw 'Clavis Python runtime not found. Run scripts/setup-clavis-runtime.ps1 first.'
}
$env:PYTHONPATH = $backend
Push-Location $root
try {
  & $python backend/scripts/check_backend.py
  if ($LASTEXITCODE) { exit $LASTEXITCODE }
} finally {
  Pop-Location
}
