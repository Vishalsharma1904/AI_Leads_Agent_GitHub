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

# A venv launcher can remain after its base Python was removed. Test execution
# instead of trusting the launcher file's existence.
$candidates = @(
  (Join-Path $backend '.venv-uv\Scripts\python.exe'),
  (Join-Path $backend '.venv312\Scripts\python.exe'),
  (Join-Path $backend '.venv\Scripts\python.exe')
)
$python = $candidates | Where-Object { Test-PythonRuntime $_ } | Select-Object -First 1
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
  # Fast path: dependencies pehle verify ho chuki hain aur requirements.txt
  # nahi badla -> har boot par fastapi/scrapling import-check (kai second) skip.
  $depsMarker = Join-Path $backend '.deps-ready'
  $browserMarker = Join-Path $backend '.scrapling-browser-ready'
  $reqStamp = "$python|$((Get-Item -LiteralPath (Join-Path $backend 'requirements.txt')).LastWriteTimeUtc.Ticks)"

  # A marker file is a promise, not a fact. Playwright bumps its Chromium
  # build number on every upgrade, and the browser for the NEW build was
  # never downloaded -- so leads quietly fell back to a static parser with no
  # phone numbers and no website enrichment, which reads as "leads fail".
  # Ask the runtime whether the browser is really on disk.
  function Test-LeadBrowser([string]$Py) {
    $probe = @'
import sys
try:
    from playwright.sync_api import sync_playwright
except Exception:
    sys.exit(3)
try:
    with sync_playwright() as p:
        path = p.chromium.executable_path
except Exception:
    sys.exit(4)
import os
sys.exit(0 if path and os.path.exists(path) else 5)
'@
    try { & $Py -c $probe 2>$null | Out-Null; return ($LASTEXITCODE -eq 0) } catch { return $false }
  }

  $browserOk = Test-LeadBrowser $python
  $depsFast = $browserOk -and (Test-Path -LiteralPath $depsMarker) -and
              ("$(Get-Content -LiteralPath $depsMarker -Raw -ErrorAction SilentlyContinue)".Trim() -eq $reqStamp)
  if ($depsFast) {
    & $python -m uvicorn main:app --host 127.0.0.1 --port $Port --workers 1
    return
  }
  if (-not $browserOk -and (Test-Path -LiteralPath $browserMarker)) {
    Add-Content -LiteralPath $installLog -Value "$(Get-Date -Format o) Lead browser missing despite marker - reinstalling"
    Remove-Item -LiteralPath $browserMarker -ErrorAction SilentlyContinue
  }

  # Install dependencies before uvicorn starts. The old background install
  # raced the first lead request and hid the actual failure.
  # crawlee was in requirements.txt but never reached the environment: this
  # probe only asked for fastapi, so a box with fastapi already installed
  # skipped the whole install and lost website enrichment.
  $fastapiReady = $false
  try { & $python -c "import fastapi, uvicorn, crawlee, playwright" 2>$null; $fastapiReady = ($LASTEXITCODE -eq 0) } catch {}
  if (-not $fastapiReady) {
    Add-Content -LiteralPath $installLog -Value "$(Get-Date -Format o) Installing backend requirements"
    if ($uv) { $setupCode = Invoke-Logged $uv @('pip', 'install', '--python', $python, '-r', (Join-Path $backend 'requirements.txt')) }
    else { $setupCode = Invoke-Logged $python @('-m', 'pip', 'install', '-r', (Join-Path $backend 'requirements.txt')) }
    if ($setupCode -ne 0) { throw "Backend dependency installation failed. See $installLog" }
  }

  $scraplingReady = $false
  try { & $python -c "import scrapling" 2>$null; $scraplingReady = ($LASTEXITCODE -eq 0) } catch {}
  if (-not $scraplingReady) {
    Add-Content -LiteralPath $installLog -Value "$(Get-Date -Format o) Installing Scrapling fetchers"
    if ($uv) { $setupCode = Invoke-Logged $uv @('pip', 'install', '--python', $python, 'scrapling[fetchers]>=0.4.15,<1') }
    else { $setupCode = Invoke-Logged $python @('-m', 'pip', 'install', 'scrapling[fetchers]>=0.4.15,<1') }
    if ($setupCode -ne 0) { throw "Scrapling installation failed. See $installLog" }
  }

  if (-not (Test-LeadBrowser $python)) {
    Add-Content -LiteralPath $installLog -Value "$(Get-Date -Format o) Installing the lead-scraper browser runtime"
    # Playwright first: it is the one both Scrapling and Crawlee actually
    # launch, and 'playwright install chromium' is the command that puts the
    # binary at the exact build path the installed version looks for.
    $setupCode = Invoke-Logged $python @('-m', 'playwright', 'install', 'chromium')
    if ($setupCode -ne 0) {
      $scraplingCli = Join-Path (Split-Path $python) 'scrapling.exe'
      if (Test-Path -LiteralPath $scraplingCli) {
        $setupCode = Invoke-Logged $scraplingCli @('install', '--force')
      } else {
        Add-Content -LiteralPath $installLog -Value "$(Get-Date -Format o) Scrapling CLI was not found in the selected environment"
      }
    }
    if (Test-LeadBrowser $python) {
      Set-Content -LiteralPath $browserMarker -Value (Get-Date -Format o)
    } else {
      Add-Content -LiteralPath $installLog -Value "$(Get-Date -Format o) Lead browser still missing - leads will run without phone/e-mail enrichment"
    }
  } elseif (-not (Test-Path -LiteralPath $browserMarker)) {
    Set-Content -LiteralPath $browserMarker -Value (Get-Date -Format o)
  }

  if (Test-Path -LiteralPath $browserMarker) { Set-Content -LiteralPath $depsMarker -Value $reqStamp }
  & $python -m uvicorn main:app --host 127.0.0.1 --port $Port --workers 1
} finally { Pop-Location }
