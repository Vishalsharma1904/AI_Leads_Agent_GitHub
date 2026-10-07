@echo off
setlocal
:: ============================================================
::  Fix-Leads.bat  ·  leads ke liye browser runtime theek karta hai
:: ------------------------------------------------------------
::  Leads dono kaam ke liye ek real browser chalati hain:
::    1. Google Maps se company list (Scrapling)
::    2. Har company ki apni website se email/phone (Crawlee)
::  Playwright har upgrade pe apna Chromium build number badal deta
::  hai. Jab wo badla, naya Chromium download hua hi nahi -- isliye
::  leads bina phone aur bina email ke aa rahi thi, aur app "No
::  contactable leads found" bol rahi thi.
::
::  Ye file wahi missing browser laga deti hai. Ek baar chalaiye.
:: ============================================================
cd /d "%~dp0"
echo.
echo   Clavis - lead scraper ka browser install kar raha hoon...
echo   (pehli baar me 2-3 minute lag sakte hain, ~150 MB download)
echo.

set "PY="
for %%P in (
  "%~dp0backend\.venv-uv\Scripts\python.exe"
  "%~dp0backend\.venv312\Scripts\python.exe"
  "%~dp0backend\.venv\Scripts\python.exe"
) do (
  if not defined PY if exist "%%~P" set "PY=%%~P"
)
if not defined PY (
  echo   [X] Backend ka Python nahi mila.
  echo       Pehle ek baar Clavis start kijiye - wo khud environment bana deta hai.
  echo.
  pause
  exit /b 1
)
echo   Python: %PY%
echo.

:: A stale VIRTUAL_ENV pointer makes pip install into the wrong place.
set "VIRTUAL_ENV="

echo   [1/3] Backend requirements (crawlee, playwright, scrapling)...
"%PY%" -m pip install --disable-pip-version-check -r "%~dp0backend\requirements.txt"

echo.
echo   [2/3] Chromium browser...
"%PY%" -m playwright install chromium
if errorlevel 1 (
  echo   playwright install nahi chala - scrapling se try kar raha hoon...
  "%PY%" -m scrapling install
)

echo.
echo   [3/3] Verify...
"%PY%" -c "import os; from playwright.sync_api import sync_playwright; p=sync_playwright().start(); x=p.chromium.executable_path; p.stop(); print('   OK  ' + x if os.path.exists(x) else '   MISSING  ' + x)"
if errorlevel 1 (
  echo   [X] Browser abhi bhi ready nahi hai. logs\backend-install.log dekhiye.
  echo.
  pause
  exit /b 1
)

:: The launcher's fast-path markers must be re-earned after this.
if exist "%~dp0backend\.deps-ready" del /q "%~dp0backend\.deps-ready"
if exist "%~dp0backend\.scrapling-browser-ready" del /q "%~dp0backend\.scrapling-browser-ready"

echo.
echo   ========================================================
echo    Ho gaya. Ab Clavis band karke dobara chalaiye --
echo    leads me phone aur email dono aayenge.
echo   ========================================================
echo.
pause
