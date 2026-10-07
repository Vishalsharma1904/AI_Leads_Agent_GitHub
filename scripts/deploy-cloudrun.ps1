<#
  Rudra24 AI backend -> Google Cloud Run.

  Redis and Celery sit in requirements but nothing imports them, so the backend
  needs exactly one thing besides the container: a PostgreSQL URL. Your Supabase
  project already has one, so there is no Cloud SQL to create.

  Before running this, backend\.env must contain at least:
      APP_ENV=production
      DATABASE_URL=postgresql://...        (Supabase -> Settings -> Database -> Session pooler)
      CORS_ORIGINS=https://rudra24-ai.vercel.app

  Usage (PowerShell, from the project root):
      .\scripts\deploy-cloudrun.ps1 -Project <your-gcp-project-id>

  backend\.env never enters the image (.dockerignore); the values are sent to
  Cloud Run as environment variables and live only there.
#>
param(
  [Parameter(Mandatory = $true)][string]$Project,
  [string]$Region  = 'asia-south1',      # Mumbai
  [string]$Service = 'rudra24-api'
)
$ErrorActionPreference = 'Stop'

$envFile = Join-Path $PSScriptRoot '..\backend\.env'
if (-not (Test-Path $envFile)) { throw "backend\.env not found" }

# KEY=VALUE lines only. A value containing a comma would break --set-env-vars,
# so those are sent one per flag instead.
$pairs = Get-Content $envFile |
  Where-Object { $_ -match '^[A-Z0-9_]+=' -and $_ -notmatch '^[A-Z0-9_]+=\s*$' }

foreach ($must in @('APP_ENV','DATABASE_URL','CORS_ORIGINS')) {
  if (-not ($pairs -match "^$must=")) { throw "$must is missing from backend\.env — the backend refuses to start in production without it" }
}

$envArgs = @()
foreach ($p in $pairs) { $envArgs += @('--update-env-vars', $p) }

gcloud config set project $Project
gcloud services enable run.googleapis.com cloudbuild.googleapis.com artifactregistry.googleapis.com

gcloud run deploy $Service `
  --source backend `
  --region $Region `
  --allow-unauthenticated `
  --port 8080 `
  --memory 2Gi `
  --cpu 2 `
  --timeout 300 `
  --min-instances 1 `
  --max-instances 4 `
  @envArgs

$url = gcloud run services describe $Service --region $Region --format 'value(status.url)'
Write-Host ""
Write-Host "Backend live at: $url"
Write-Host ""
Write-Host "Last step: in vercel.json replace REPLACE-WITH-BACKEND-HOST with $($url -replace '^https://','')"
Write-Host "then commit and push — Vercel redeploys on its own."
