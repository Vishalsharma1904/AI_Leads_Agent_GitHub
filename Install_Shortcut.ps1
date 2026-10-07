# Install_Shortcut.ps1
# Creates a Windows Desktop + Start Menu shortcut for Rudra24 AI.
# This runs automatically on first launch from Launch_App.bat

param(
  [string]$AppDir = $PSScriptRoot,
  [string]$BatchFile = ""
)

# ── Setup ──────────────────────────────────────────────────────────────────
$AppName    = "Rudra24 AI"
$Desktop    = [System.Environment]::GetFolderPath("Desktop")
$ShortcutPath = Join-Path $Desktop "$AppName.lnk"

# Determine the batch file path
if (-not $BatchFile) {
  $BatchFile = Join-Path $AppDir "Clavis-App.vbs"
}

# Normalize paths
$AppDir     = [System.IO.Path]::GetFullPath($AppDir.TrimEnd('\').TrimEnd('/'))
$BatchFile  = [System.IO.Path]::GetFullPath($BatchFile)

# ── Icon ───────────────────────────────────────────────────────────────────
# The real brand icon, not a Windows globe and not Chrome's. A shortcut
# wearing someone else's icon is the fastest way to look like a script
# someone left on the desktop rather than an application.
$IconPath = ""
foreach ($candidate in @(
  (Join-Path $AppDir "installer\Rudra24.ico"),
  (Join-Path $AppDir "installer\Clavis.ico"),
  (Join-Path $AppDir "icon.ico")
)) {
  if (Test-Path -LiteralPath $candidate) { $IconPath = $candidate; break }
}
if (-not $IconPath) { $IconPath = "%SystemRoot%\System32\shell32.dll,13" }

Write-Host ""
Write-Host "  Creating Desktop Shortcut: $ShortcutPath"

# ── Create the .lnk shortcut ──────────────────────────────────────────────
try {
  $WshShell  = New-Object -ComObject WScript.Shell
  $Shortcut  = $WshShell.CreateShortcut($ShortcutPath)
  
  # Target the quiet VBS wrapper so the console never flashes on launch.
  $Shortcut.TargetPath  = "wscript.exe"
  $Shortcut.Arguments   = "`"$BatchFile`""
  $Shortcut.WorkingDirectory = $AppDir
  $Shortcut.WindowStyle  = 1
  $Shortcut.Description  = "Rudra24 AI"
  
  # Set icon
  if ($IconPath -and (Test-Path $IconPath.Split(',')[0])) {
    $Shortcut.IconLocation = $IconPath
  }
  
  $Shortcut.Save()
  
  Write-Host "  [OK] Desktop shortcut created successfully!"
  Write-Host "  [OK] Look for '$AppName' on your Desktop."
  Write-Host ""
  
} catch {
  Write-Warning "  Could not create shortcut: $_"
  Write-Host "  You can manually create a shortcut to: $BatchFile"
}

# ── Also create a Start Menu entry (optional, makes it even more app-like) ──
try {
  $StartMenuDir = Join-Path $env:APPDATA "Microsoft\Windows\Start Menu\Programs"
  $StartMenuShortcut = Join-Path $StartMenuDir "$AppName.lnk"
  
  $WshShell2 = New-Object -ComObject WScript.Shell
  $SM = $WshShell2.CreateShortcut($StartMenuShortcut)
  $SM.TargetPath = "wscript.exe"
  $SM.Arguments  = "`"$BatchFile`""
  $SM.WorkingDirectory = $AppDir
  $SM.WindowStyle = 1
  $SM.Description = "Rudra24 AI"
  if ($IconPath -and (Test-Path $IconPath.Split(',')[0])) {
    $SM.IconLocation = $IconPath
  }
  $SM.Save()
  
  Write-Host "  [OK] Start Menu entry also created."
  
} catch {
  # Start Menu shortcut is optional — ignore errors
}

Write-Host "  Setup complete! You can now launch the app from your Desktop."
