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
  & $python -m unittest discover -s backend/tests -p 'test_*.py' -v
  if ($LASTEXITCODE) { exit $LASTEXITCODE }
} finally {
  Pop-Location
}
