param(
  [string]$BackendUrl = '',
  [string]$SupabaseUrl = ''
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$npm = Get-Command npm.cmd -ErrorAction Stop
$env:CLAVIS_BACKEND_URL = $BackendUrl
$env:CLAVIS_SUPABASE_URL = $SupabaseUrl
Push-Location -LiteralPath $root
try {
  & $npm.Source ci --no-audit --no-fund
  if ($LASTEXITCODE) { throw "npm install failed ($LASTEXITCODE)" }
  & $npm.Source run dist:win
  if ($LASTEXITCODE) { throw "Electron installer build failed ($LASTEXITCODE)" }
} finally {
  Pop-Location
}
