param([string]$TargetRoot = '')
$ErrorActionPreference = 'Stop'
$backup = (Resolve-Path -LiteralPath $PSScriptRoot).ProviderPath
$manifest = Get-Content -LiteralPath (Join-Path $backup 'manifest.json') -Raw | ConvertFrom-Json
if (-not $TargetRoot) { $TargetRoot = $manifest.workspace }
$target = [IO.Path]::GetFullPath($TargetRoot).TrimEnd('\')
if (-not [IO.Path]::IsPathRooted($TargetRoot)) { throw 'Target must be an absolute directory' }
$operations = @()
foreach ($entry in $manifest.entries) {
  if ([IO.Path]::IsPathRooted($entry.relativePath) -or ($entry.relativePath -split '[\\/]') -contains '..') { throw 'Unsafe manifest path' }
  $source = [IO.Path]::GetFullPath((Join-Path (Join-Path $backup 'unused') $entry.relativePath))
  $destination = [IO.Path]::GetFullPath((Join-Path $target $entry.relativePath))
  if (-not $source.StartsWith($backup + '\unused\', [StringComparison]::OrdinalIgnoreCase) -or -not $destination.StartsWith($target + '\', [StringComparison]::OrdinalIgnoreCase)) { throw 'Path escaped backup or target' }
  if (-not (Test-Path -LiteralPath $source) -or (Get-FileHash -LiteralPath $source -Algorithm SHA256).Hash -ne $entry.sha256) { throw "Backup damaged: $($entry.relativePath)" }
  if (Test-Path -LiteralPath $destination) {
    if ((Get-FileHash -LiteralPath $destination -Algorithm SHA256).Hash -ne $entry.sha256) { throw "Restore stopped: destination changed: $($entry.relativePath). No files have been overwritten." }
  } else { $operations += [pscustomobject]@{ source=$source; destination=$destination } }
}
foreach ($operation in $operations) {
  New-Item -ItemType Directory -Path (Split-Path -Parent $operation.destination) -Force | Out-Null
  Copy-Item -LiteralPath $operation.source -Destination $operation.destination
}
Write-Output "Restored $($operations.Count) files; existing identical files preserved. Backup retained."
