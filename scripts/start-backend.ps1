param([int]$Port = 8000)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$backend = Join-Path $root 'backend'
$logsDir = Join-Path $root 'logs'
if (-not (Test-Path -LiteralPath $logsDir)) { New-Item -ItemType Directory -Path $logsDir | Out-Null }
$installLog = Join-Path $logsDir 'backend-install.log'

function Invoke-Logged([string]$FilePath, [string[]]$Arguments) {
  $previous = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  try {
    & $FilePath @Arguments *>> $installLog
    return $LASTEXITCODE
  } finally { $ErrorActionPreference = $previous }
}

function Test-PythonRuntime([string]$Candidate) {
  if ([string]::IsNullOrWhiteSpace($Candidate) -or -not (Test-Path -LiteralPath $Candidate)) { return $false }
  try {
    & $Candidate -c "import sys; print(sys.version)" 2>$null | Out-Null
    return $LASTEXITCODE -eq 0
  } catch { return $false }
}

# Check installed packages without importing the whole app twice. Uvicorn and
# the launcher's /health check validate the actual application once it starts.
$dependencyProbe = @'
import sys
from pathlib import Path
from importlib.metadata import version
from packaging.requirements import Requirement
optional = {'torch', 'kokoro', 'silero-vad'}
for line in Path(sys.argv[1]).read_text().splitlines():
    line = line.strip()
    if not line or line.startswith('#'):
        continue
    requirement = Requirement(line)
    if requirement.name.lower() in optional or (requirement.marker and not requirement.marker.evaluate()):
        continue
    installed = version(requirement.name)
    if not requirement.specifier.contains(installed):
        raise RuntimeError(f'{requirement.name} {installed} does not satisfy {requirement.specifier}')
'@
$requirements = Join-Path $backend 'requirements.txt'

# A venv launcher can remain after its base Python was removed. Test execution
# instead of trusting the launcher file's existence.
$candidates = @(
  (Join-Path $backend '.venv-uv\Scripts\python.exe'),
  (Join-Path $backend '.venv312\Scripts\python.exe'),
  (Join-Path $backend '.venv\Scripts\python.exe')
)
# The shared ZIP ships its backend packages inside runtime\python, so that
# copy wins: a half-installed venv from an older failed run must not shadow it.
$python = $null
$portableReady = $false
$portablePython = Join-Path $root 'runtime\python\python.exe'
if (Test-PythonRuntime $portablePython) {
  if ((Invoke-Logged $portablePython @('-c', $dependencyProbe, $requirements)) -eq 0) {
    $python = $portablePython
    $portableReady = $true
  }
}
if (-not $python) { $python = $candidates | Where-Object { Test-PythonRuntime $_ } | Select-Object -First 1 }
$uv = (Get-Command uv -ErrorAction SilentlyContinue).Source

if (-not $python -and $uv) {
  $managedEnv = Join-Path $backend '.venv-uv'
  $managedPython = Join-Path $managedEnv 'Scripts\python.exe'
  if (-not (Test-PythonRuntime $managedPython)) {
    Add-Content -LiteralPath $installLog -Value "$(Get-Date -Format o) Creating managed Python 3.12 runtime with uv"
    $setupCode = Invoke-Logged $uv @('venv', '--python', '3.12', $managedEnv)
    if ($setupCode -ne 0) { throw "Python runtime creation failed. See $installLog" }
  }
  if (Test-PythonRuntime $managedPython) { $python = $managedPython }
}

if (-not $python) {
  $systemPython = (Get-Command python -ErrorAction SilentlyContinue).Source
  if (Test-PythonRuntime $portablePython) { $systemPython = $portablePython }
  if (Test-PythonRuntime $systemPython) {
    $managedEnv = Join-Path $backend '.venv312'
    $managedPython = Join-Path $managedEnv 'Scripts\python.exe'
    & $systemPython -m venv $managedEnv
    if ($LASTEXITCODE -ne 0 -or -not (Test-PythonRuntime $managedPython)) { throw 'Could not create the local Python runtime.' }
    $python = $managedPython
  }
}
if (-not $python) { throw 'No working Python runtime found. Install Python 3.12+ or uv, then start Clavis again.' }

Push-Location $backend
try {
  $depsMarker = Join-Path $backend '.deps-ready'
  $reqStamp = "$python|$((Get-Item -LiteralPath (Join-Path $backend 'requirements.txt')).LastWriteTimeUtc.Ticks)|$((Get-Item -LiteralPath $PSCommandPath).LastWriteTimeUtc.Ticks)"
  $ready = $portableReady -or ((Test-Path -LiteralPath $depsMarker) -and
           ("$(Get-Content -LiteralPath $depsMarker -Raw -ErrorAction SilentlyContinue)".Trim() -eq $reqStamp))
  if (-not $ready) {
    $ready = (Invoke-Logged $python @('-c', $dependencyProbe, $requirements)) -eq 0
    if (-not $ready) {
      # Cloud Groq/ElevenLabs/Apify need no local speech model downloads.
      # Existing setup-clavis-runtime.ps1 installs the full local voice stack on demand.
      $coreRequirements = Join-Path $logsDir 'backend-core-requirements.txt'
      Get-Content -LiteralPath (Join-Path $backend 'requirements.txt') |
        Where-Object { $_ -notmatch '^(torch|kokoro|silero-vad)' } |
        Set-Content -LiteralPath $coreRequirements
      if ($uv) { $setupCode = Invoke-Logged $uv @('pip', 'install', '--python', $python, '-r', $coreRequirements) }
      else { $setupCode = Invoke-Logged $python @('-m', 'pip', 'install', '-r', $coreRequirements) }
      if ($setupCode -ne 0) { throw "Backend dependency installation failed. See $installLog" }
      if ((Invoke-Logged $python @('-c', $dependencyProbe, $requirements)) -ne 0) { throw "Backend dependencies are incomplete. See $installLog" }
    }
    Set-Content -LiteralPath $depsMarker -Value $reqStamp
  }
  # The lead pipeline's existing ensure_browser() installs Chromium when needed.
  # An optional scraper download must not hold API key setup hostage.
  # Watchdog: agar engine kabhi band ho jaye (crash, sleep) to 3 sec me khud
  # dobara start. Stop-Clavis.bat is PowerShell ko bhi band kar deta hai.
  while ($true) {
    & $python -m uvicorn main:app --host 127.0.0.1 --port $Port --workers 1
    Add-Content -LiteralPath (Join-Path $logsDir 'backend-restarts.log') -Value "$(Get-Date -Format o) engine exited ($LASTEXITCODE), restarting"
    Start-Sleep -Seconds 3
  }
} finally { Pop-Location }
