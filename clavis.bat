@echo off
setlocal
title Rudra24 AI - First launch setup
cd /d "%~dp0"

echo Setting up the Rudra24 AI desktop shortcut...
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0Install_Shortcut.ps1" -AppDir "%~dp0"
if errorlevel 1 (
  echo.
  echo Shortcut setup failed. Please check that Windows Script Host is enabled.
  pause
  exit /b 1
)

if not exist "%~dp0Clavis-App.vbs" (
  echo Clavis-App.vbs is missing from this folder.
  pause
  exit /b 1
)

echo Starting Rudra24 AI. Use the desktop shortcut next time.
start "" "%WINDIR%\System32\wscript.exe" "%~dp0Clavis-App.vbs"
exit /b 0
