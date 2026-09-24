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
  if (Test-PythonRuntime $systemPython) { $python = $systemPython }
}
if (-not $python) { throw 'No working Python runtime found. Install Python 3.12+ or uv, then start Clavis again.' }

Push-Location $backend
try {
  # Fast path: dependencies pehle verify ho chuki hain aur requirements.txt
  # nahi badla -> har boot par fastapi/scrapling import-check (kai second) skip.
  $depsMarker = Join-Path $backend '.deps-ready'
  $browserMarker = Join-Path $backend '.scrapling-browser-ready'
  $reqStamp = "$python|$((Get-Item -LiteralPath (Join-Path $backend 'requirements.txt')).LastWriteTimeUtc.Ticks)"
  $depsFast = (Test-Path -LiteralPath $depsMarker) -and (Test-Path -LiteralPath $browserMarker) -and
              ("$(Get-Content -LiteralPath $depsMarker -Raw -ErrorAction SilentlyContinue)".Trim() -eq $reqStamp)
  if ($depsFast) {
    & $python -m uvicorn main:app --host 0.0.0.0 --port $Port
    return
  }

  # Install dependencies before uvicorn starts. The old background install
  # raced the first lead request and hid the actual failure.
  $fastapiReady = $false
  try { & $python -c "import fastapi, uvicorn" 2>$null; $fastapiReady = ($LASTEXITCODE -eq 0) } catch {}
  if (-not $fastapiReady) {
    if (-not $uv) { throw 'The selected Python runtime has no FastAPI dependencies and uv is unavailable.' }
    Add-Content -LiteralPath $installLog -Value "$(Get-Date -Format o) Installing backend requirements"
    $setupCode = Invoke-Logged $uv @('pip', 'install', '--python', $python, '-r', (Join-Path $backend 'requirements.txt'))
    if ($setupCode -ne 0) { throw "Backend dependency installation failed. See $installLog" }
  }

  $scraplingReady = $false
  try { & $python -c "import scrapling" 2>$null; $scraplingReady = ($LASTEXITCODE -eq 0) } catch {}
  if (-not $scraplingReady) {
    if (-not $uv) { throw 'Scrapling is missing and uv is unavailable.' }
    Add-Content -LiteralPath $installLog -Value "$(Get-Date -Format o) Installing Scrapling fetchers"
    $setupCode = Invoke-Logged $uv @('pip', 'install', '--python', $python, 'scrapling[fetchers]>=0.4.15,<1')
    if ($setupCode -ne 0) { throw "Scrapling installation failed. See $installLog" }
  }

  if (-not (Test-Path -LiteralPath $browserMarker)) {
    Add-Content -LiteralPath $installLog -Value "$(Get-Date -Format o) Installing Scrapling browser runtime"
    $scraplingCli = Join-Path (Split-Path $python) 'scrapling.exe'
    if (Test-Path -LiteralPath $scraplingCli) {
      $setupCode = Invoke-Logged $scraplingCli @('install', '--force')
    } else {
      Add-Content -LiteralPath $installLog -Value "$(Get-Date -Format o) Scrapling CLI was not found in the selected environment"
      $setupCode = 1
    }
    if ($setupCode -eq 0) { Set-Content -LiteralPath $browserMarker -Value (Get-Date -Format o) }
  }

  if (Test-Path -LiteralPath $browserMarker) { Set-Content -LiteralPath $depsMarker -Value $reqStamp }
  & $python -m uvicorn main:app --host 0.0.0.0 --port $Port
} finally { Pop-Location }
