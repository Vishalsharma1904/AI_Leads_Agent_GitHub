# ============================================================
#  Downloads the best free/open-source Piper voices for Clavis.
#  Run:  powershell -ExecutionPolicy Bypass -File scripts\get-piper-voices.ps1
#
#  Voices (verified to exist in rhasspy/piper-voices):
#    en_GB-alan-medium      - deep British male, closest to a JARVIS feel
#    hi_IN-pratham-medium   - Hindi male
#    hi_IN-priyamvada-medium- Hindi female (optional alternate)
#
#  NOTE: hi_IN-swara does NOT exist in Piper (that is an Azure voice name).
#  The backend default was pointing at it, which could never have worked.
# ============================================================
param(
  [string]$Dest = "",
  [switch]$IncludeFemale
)

$ErrorActionPreference = "Stop"
$repo = "https://huggingface.co/rhasspy/piper-voices/resolve/main"

if (-not $Dest) {
  $Dest = Join-Path (Split-Path -Parent $PSScriptRoot) "backend\models"
}
if (-not (Test-Path $Dest)) { New-Item -ItemType Directory -Force -Path $Dest | Out-Null }
Write-Host "Downloading Piper voices into: $Dest`n" -ForegroundColor Cyan

# name = <locale>-<voice>-<quality> ; path = <lang>/<locale>/<voice>/<quality>
$voices = @(
  @{ name = "en_GB-alan-medium";       path = "en/en_GB/alan/medium" },
  @{ name = "hi_IN-pratham-medium";    path = "hi/hi_IN/pratham/medium" }
)
if ($IncludeFemale) {
  $voices += @{ name = "hi_IN-priyamvada-medium"; path = "hi/hi_IN/priyamvada/medium" }
}

foreach ($v in $voices) {
  foreach ($ext in @(".onnx", ".onnx.json")) {
    $file = "$($v.name)$ext"
    $out  = Join-Path $Dest $file
    if (Test-Path $out) { Write-Host "  already have $file" -ForegroundColor DarkGray; continue }
    $url = "$repo/$($v.path)/$file"
    Write-Host "  downloading $file ..." -NoNewline
    try {
      Invoke-WebRequest -Uri $url -OutFile $out -UseBasicParsing
      Write-Host " ok" -ForegroundColor Green
    } catch {
      Write-Host " FAILED" -ForegroundColor Red
      Write-Host "    $url"
      Write-Host "    $($_.Exception.Message)"
      if (Test-Path $out) { Remove-Item $out -Force }
    }
  }
}

Write-Host "`nDone. Now make sure the 'piper' binary is on your PATH:" -ForegroundColor Cyan
Write-Host "  https://github.com/rhasspy/piper/releases  (piper_windows_amd64.zip)"
Write-Host "Then restart the backend and check: http://localhost:8000/api/tts/health`n"
