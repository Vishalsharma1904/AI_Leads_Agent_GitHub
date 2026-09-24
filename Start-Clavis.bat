@echo off
:: Clavis ab Clavis.exe se chalta hai (ek double-click, turant window).
:: Yeh file sirf purane shortcuts ke liye hai.
cd /d "%~dp0"
if exist "Clavis.exe" (
  start "" "Clavis.exe" %*
  exit /b 0
)
if exist "Start-Clavis-legacy.bat" call "Start-Clavis-legacy.bat" %*
