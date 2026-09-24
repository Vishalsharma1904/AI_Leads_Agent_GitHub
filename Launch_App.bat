@echo off
title Skylark AI Agent — Launching...
color 0A

echo.
echo  ████████████████████████████████████████████████
echo  █                                              █
echo  █        SKYLARK AI LEAD AGENT                 █
echo  █        Starting your workspace...            █
echo  █                                              █
echo  ████████████████████████████████████████████████
echo.

:: ── Step 1: Create Desktop Shortcut (only on first run) ──────────────────
set "SHORTCUT_FLAG=%APPDATA%\SkylarkAI\shortcut_created.flag"
if not exist "%APPDATA%\SkylarkAI" mkdir "%APPDATA%\SkylarkAI"

if not exist "%SHORTCUT_FLAG%" (
  echo  [*] Creating Desktop Shortcut for easy access...
  powershell -ExecutionPolicy Bypass -File "%~dp0Install_Shortcut.ps1" -AppDir "%~dp0" -BatchFile "%~f0"
  echo 1 > "%SHORTCUT_FLAG%"
  echo  [✓] Desktop Shortcut Created! Look for "Skylark AI Agent" on your Desktop.
  echo.
)

:: ── Step 2: Open index.html in Chrome App Mode ──────────────────
echo  [*] Starting local frontend and Outlook service...
cd /d "%~dp0"
start "Skylark Local Services" /min cmd /c "cd /d ""%~dp0"" && npm run dev"
timeout /t 4 /nobreak >nul
echo  [*] Opening Skylark AI Agent...

set "CHROME_PATH="
:: Check common Chrome locations
if exist "%PROGRAMFILES%\Google\Chrome\Application\chrome.exe" (
  set "CHROME_PATH=%PROGRAMFILES%\Google\Chrome\Application\chrome.exe"
) else if exist "%PROGRAMFILES(X86)%\Google\Chrome\Application\chrome.exe" (
  set "CHROME_PATH=%PROGRAMFILES(X86)%\Google\Chrome\Application\chrome.exe"
) else if exist "%LOCALAPPDATA%\Google\Chrome\Application\chrome.exe" (
  set "CHROME_PATH=%LOCALAPPDATA%\Google\Chrome\Application\chrome.exe"
)

:: IMPORTANT: The screenshot UI is the root static app (index.html + styles.css + page-*.js).
:: frontend/ is a separate experimental React app and is not used by this launcher.
:: The query string prevents an old app tab/proxy from reusing a previous document.
set "APP_URL=http://localhost:3000/index.html?ui=live#email"

if not "%CHROME_PATH%"=="" (
  echo  [✓] Opening in Chrome App Mode...
  start "" "%CHROME_PATH%" --app="%APP_URL%" --window-size=1400,900 --window-position=50,30 --no-first-run --disable-extensions-except --no-default-browser-check
  goto :done
)

:: Fallback: Microsoft Edge App Mode
set "EDGE_PATH="
if exist "%PROGRAMFILES(X86)%\Microsoft\Edge\Application\msedge.exe" (
  set "EDGE_PATH=%PROGRAMFILES(X86)%\Microsoft\Edge\Application\msedge.exe"
) else if exist "%PROGRAMFILES%\Microsoft\Edge\Application\msedge.exe" (
  set "EDGE_PATH=%PROGRAMFILES%\Microsoft\Edge\Application\msedge.exe"
)

if not "%EDGE_PATH%"=="" (
  echo  [✓] Opening in Microsoft Edge App Mode...
  start "" "%EDGE_PATH%" --app="%APP_URL%" --window-size=1400,900 --window-position=50,30
  goto :done
)

:: Last fallback: just open in default browser
echo  [!] Chrome/Edge not found. Opening in default browser...
start "" "%APP_URL%"

:done
echo.
echo  ████████████████████████████████████████████████
echo  █  Skylark AI Agent is running!                █
echo  ████████████████████████████████████████████████
echo.
timeout /t 3 /nobreak >nul
