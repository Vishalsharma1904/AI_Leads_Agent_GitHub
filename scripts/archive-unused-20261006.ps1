param([string]$BackupRoot = 'C:\Users\Khushi\Desktop\Rudra24-Unused-Backup-20261006-154531')
$ErrorActionPreference = 'Stop'
$workspace = (Resolve-Path -LiteralPath (Split-Path -Parent $PSScriptRoot)).ProviderPath
$backup = (Resolve-Path -LiteralPath $BackupRoot).ProviderPath
if (-not $backup.StartsWith('C:\Users\Khushi\Desktop\Rudra24-Unused-Backup-', [StringComparison]::OrdinalIgnoreCase)) { throw 'Unexpected backup directory' }
$entries = @()
foreach ($directory in @('_rebrand_backup', '_claude_tmp')) {
  $candidate = Join-Path $workspace $directory
  if (-not (Test-Path -LiteralPath $candidate)) { continue }
  foreach ($file in Get-ChildItem -LiteralPath $candidate -Recurse -File -Force) {
    if ($file.Name -eq 'caption-check.html' -or $file.Extension -match '^\.(db|sqlite3?|env|pem|key|pfx)$' -or $file.Name -match '^\.env') { continue }
    if ($file.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Reparse point cannot be archived' }
    $source = (Resolve-Path -LiteralPath $file.FullName).ProviderPath
    if (-not $source.StartsWith($workspace + '\', [StringComparison]::OrdinalIgnoreCase)) { throw 'Source escaped workspace' }
    $relative = $source.Substring($workspace.Length + 1)
    $destination = [IO.Path]::GetFullPath((Join-Path (Join-Path $backup 'unused') $relative))
    if (-not $destination.StartsWith($backup + '\unused\', [StringComparison]::OrdinalIgnoreCase) -or (Test-Path -LiteralPath $destination)) { throw 'Unsafe or existing destination' }
    $entries += [pscustomobject]@{ relativePath=$relative; sha256=(Get-FileHash -LiteralPath $source -Algorithm SHA256).Hash; bytes=$file.Length; reason= $(if($directory -eq '_rebrand_backup') {'Superseded rebranding snapshot; no HTML, dynamic code, launcher, test or packaging dependency'} else {'Temporary patch/archive/output; no runtime or tooling reference. Referenced caption-check.html retained'}) }
  }
}
if (-not $entries.Count) { throw 'No verified candidates to archive' }
# Manifest is written before any move, so interrupted operations remain recoverable.
$manifest = [pscustomobject]@{ workspace=$workspace; createdAt=(Get-Date -Format o); entries=$entries }
$manifest | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath (Join-Path $backup 'manifest.json') -Encoding utf8
foreach ($entry in $entries) {
  $source = Join-Path $workspace $entry.relativePath
  $destination = Join-Path (Join-Path $backup 'unused') $entry.relativePath
  New-Item -ItemType Directory -Path (Split-Path -Parent $destination) -Force | Out-Null
  Move-Item -LiteralPath $source -Destination $destination
  if ((Get-FileHash -LiteralPath $destination -Algorithm SHA256).Hash -ne $entry.sha256) { throw 'Archive checksum mismatch' }
}
Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'restore-unused-backup.ps1') -Destination (Join-Path $backup 'Restore.ps1')
Write-Output ("Archived {0} files, {1} bytes to {2}" -f $entries.Count, ($entries | Measure-Object bytes -Sum).Sum, $backup)
