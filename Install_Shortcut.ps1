# Install_Shortcut.ps1
# Creates a Windows Desktop shortcut for Skylark AI Agent
# This runs automatically on first launch from Launch_App.bat

param(
  [string]$AppDir = $PSScriptRoot,
  [string]$BatchFile = ""
)

# ── Setup ──────────────────────────────────────────────────────────────────
$AppName    = "Clavis"
$Desktop    = [System.Environment]::GetFolderPath("Desktop")
$ShortcutPath = Join-Path $Desktop "$AppName.lnk"

# Determine the batch file path
if (-not $BatchFile) {
  $BatchFile = Join-Path $AppDir "Clavis-App.vbs"
}

# Normalize paths
$AppDir     = [System.IO.Path]::GetFullPath($AppDir.TrimEnd('\').TrimEnd('/'))
$BatchFile  = [System.IO.Path]::GetFullPath($BatchFile)

# ── Icon: Use SVG or find a suitable icon ──────────────────────────────────
# We'll use the Windows shell32.dll icon as fallback since SVG can't be used directly
$IconPath = ""

# Check if there's a .ico file
$icoFile = Join-Path $AppDir "icon.ico"
if (Test-Path $icoFile) {
  $IconPath = $icoFile
} else {
  # Use a nice Windows system icon (Internet Explorer / Edge style web app icon)
  # Shell32 icon 14 = Earth/Globe (good for web app)
  # Shell32 icon 13 = Web pages
  $IconPath = "%SystemRoot%\System32\shell32.dll,13"
}

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
  $Shortcut.Description  = "Launch Skylark AI Lead Generation Agent"
  
  # Set icon
  if ($IconPath -and (Test-Path $IconPath.Split(',')[0])) {
    $Shortcut.IconLocation = $IconPath
  } else {
    # Use Chrome icon if available (looks great for web apps)
    $ChromePaths = @(
      "$env:PROGRAMFILES\Google\Chrome\Application\chrome.exe",
      "${env:PROGRAMFILES(X86)}\Google\Chrome\Application\chrome.exe",
      "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe"
    )
    foreach ($cp in $ChromePaths) {
      if (Test-Path $cp) {
        $Shortcut.IconLocation = "$cp,0"
        break
      }
    }
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
  $SM.Description = "Launch Skylark AI Lead Generation Agent"
  if ($IconPath -and (Test-Path $IconPath.Split(',')[0])) {
    $SM.IconLocation = $IconPath
  }
  $SM.Save()
  
  Write-Host "  [OK] Start Menu entry also created."
  
} catch {
  # Start Menu shortcut is optional — ignore errors
}

Write-Host "  Setup complete! You can now launch the app from your Desktop."
