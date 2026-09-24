param(
  [switch]$NoBackend
)

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path

if (-not (Test-Path -LiteralPath (Join-Path $projectRoot 'package.json'))) {
  throw "Clavis package.json was not found at $projectRoot"
}

Push-Location -LiteralPath $projectRoot
try {
  if ($NoBackend) { npm run frontend } else { npm run dev }
} finally {
  Pop-Location
}
