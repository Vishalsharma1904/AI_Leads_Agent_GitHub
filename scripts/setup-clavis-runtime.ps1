param(
  [switch]$SkipHeavySpeech,
  [switch]$Upgrade
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$backend = Join-Path $root 'backend'
$venv = Join-Path $backend '.venv312'
$python = Join-Path $venv 'Scripts\python.exe'

if (-not (Test-Path -LiteralPath $python)) {
  & py -3.12 -m venv $venv
}
if ($Upgrade) { & $python -m pip install --upgrade pip }

$requirements = Join-Path $backend 'requirements.txt'
if ($SkipHeavySpeech) {
  $temp = Join-Path $env:TEMP 'clavis-core-requirements.txt'
  Get-Content $requirements | Where-Object { $_ -notmatch '^(torch|kokoro|faster-whisper|silero-vad|onnxruntime)' } | Set-Content $temp
  & $python -m pip install -r $temp
  Remove-Item -LiteralPath $temp -Force
} else {
  & $python -m pip install -r $requirements
}

Write-Host "Clavis Python 3.12 runtime ready: $python"
Write-Host 'Speech models remain lazy and download into the local cache on first health/synthesis call.'
