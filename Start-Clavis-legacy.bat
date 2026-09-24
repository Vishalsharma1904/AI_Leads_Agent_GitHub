@echo off
setlocal EnableExtensions
title Clavis
cd /d "%~dp0"
if not exist "logs" mkdir "logs"

:: --no-browser = started from the clavis:// launcher; the tab is already open.
set "NO_BROWSER="
if /i "%~1"=="--no-browser" set "NO_BROWSER=1"

:: clavis:// launcher: index.html (file://) khulte hi isko call karta hai aur
:: Clavis khud start ho jata hai. Per-user registry, har run par refresh.
reg add "HKCU\Software\Classes\clavis" /ve /d "URL:Clavis Launcher" /f >nul 2>&1
reg add "HKCU\Software\Classes\clavis" /v "URL Protocol" /d "" /f >nul 2>&1
reg add "HKCU\Software\Classes\clavis\shell\open\command" /ve /d "\"%SystemRoot%\System32\wscript.exe\" \"%~dp0Clavis-Launch.vbs\" \"%%1\"" /f >nul 2>&1

:: Kokoro model local folder, agar hai
if exist "%~dp0speech-models\kokoro\config.json" set "CLAVIS_KOKORO_MODEL=%~dp0speech-models\kokoro"
:: model pehle se download hai -> har boot par HuggingFace se check mat karo (yahi slow tha)
if exist "%USERPROFILE%\.cache\huggingface\hub\models--hexgrad--Kokoro-82M" set "HF_HUB_OFFLINE=1"
set "HF_HUB_DISABLE_TELEMETRY=1"

echo.
echo   Clavis start ho raha hai...
echo.

:: --- Node.js dhoondo ---------------------------------------------------------
:: clavis:// / desktop icon se chalne par PATH kabhi-kabhi purana hota hai
:: ("'node' is not recognized"). Common install folders bhi dekh lo.
set "HAVE_NODE="
set "NODE_DIR="
where node >nul 2>&1 && set "HAVE_NODE=1"
if defined HAVE_NODE goto :node_done
if exist "%ProgramFiles%\nodejs\node.exe" set "NODE_DIR=%ProgramFiles%\nodejs"
if not defined NODE_DIR if exist "%LOCALAPPDATA%\Programs\nodejs\node.exe" set "NODE_DIR=%LOCALAPPDATA%\Programs\nodejs"
if not defined NODE_DIR if defined NVM_SYMLINK if exist "%NVM_SYMLINK%\node.exe" set "NODE_DIR=%NVM_SYMLINK%"
if not defined NODE_DIR if exist "%APPDATA%\nvm\current\node.exe" set "NODE_DIR=%APPDATA%\nvm\current"
if not defined NODE_DIR if exist "%ProgramFiles(x86)%\nodejs\node.exe" set "NODE_DIR=%ProgramFiles(x86)%\nodejs"
if defined NODE_DIR set "PATH=%NODE_DIR%;%PATH%"
if defined NODE_DIR set "HAVE_NODE=1"
:node_done

:: --- jo pehle se chal raha hai use dobara mat chalao (netstat sirf ek baar) ---
set "PORTS=%TEMP%\clavis-ports.txt"
netstat -an > "%PORTS%" 2>nul
set "NEED_FE=1"
set "NEED_BE=1"
set "NEED_BR=1"
findstr /c:":3000 " "%PORTS%" | findstr /c:"LISTENING" >nul && set "NEED_FE=0"
findstr /c:":8000 " "%PORTS%" | findstr /c:"LISTENING" >nul && set "NEED_BE=0"
findstr /c:":8777 " "%PORTS%" | findstr /c:"LISTENING" >nul && set "NEED_BR=0"
del "%PORTS%" >nul 2>&1

:: 1) static frontend on http://localhost:3000
::    serve-clavis.js ~1 sec me start hota hai. Node na mile to PowerShell
::    wala built-in server (scripts\serve-clavis.ps1) - UI kabhi atakna nahi chahiye.
if "%NEED_FE%"=="0" (
  echo   - frontend  : pehle se chal raha hai
  goto :backend
)
echo   - frontend  : http://localhost:3000
if defined HAVE_NODE (
  start "Clavis Server" /min cmd /c "node serve-clavis.js >logs\frontend.log 2>&1"
) else (
  echo     [!] Node.js nahi mila - PowerShell server use kar raha hoon
  start "Clavis Server" /min cmd /c "powershell -NoProfile -ExecutionPolicy Bypass -File scripts\serve-clavis.ps1 >logs\frontend.log 2>&1"
)

:backend
:: 2) backend API + speech runtime on :8000
if "%NEED_BE%"=="0" (
  echo   - backend   : pehle se chal raha hai
  goto :bridge
)
echo   - backend   : http://localhost:8000
if exist "%~dp0backend-runtime\ClavisBackend.exe" (
  start "Clavis Backend" /min cmd /c "backend-runtime\ClavisBackend.exe >logs\backend.log 2>&1"
) else (
  start "Clavis Backend" /min cmd /c "powershell -NoProfile -ExecutionPolicy Bypass -File scripts\start-backend.ps1 >logs\backend.log 2>&1"
)

:bridge
:: 3) PC bridge - apps kholna, Notepad, screenshots (Node chahiye)
if "%NEED_BR%"=="0" goto :wait
if not defined HAVE_NODE (
  echo   - pc bridge : skip ^(Node.js nahi mila^)
  goto :wait
)
echo   - pc bridge : http://127.0.0.1:8777
rem Full PC control (apps, windows, mouse/keyboard, files) for Clavis only:
rem the bridge refuses every web page except localhost:3000.
start "Clavis PC Bridge" /min cmd /c "set CLAVIS_BRIDGE_ALLOW_CONTROL=1&& node clavis-bridge\bridge.js >logs\bridge.log 2>&1"

:wait
:: --- asli readiness check (fixed sleep nahi) ---
echo.
echo   Servers ka wait kar raha hoon...
powershell -NoProfile -Command "function P($p){try{$c=New-Object Net.Sockets.TcpClient;$c.Connect('127.0.0.1',$p);$c.Close();$true}catch{$false}}; for($i=0;$i -lt 150;$i++){ if((P 3000) -and (P 8000)){exit 0}; Start-Sleep -Milliseconds 400 }; exit 1"
if errorlevel 1 (
  echo.
  echo   [X] Server time par start nahi hua.
  echo       logs\frontend.log aur logs\backend.log kholkar dekhiye.
  echo.
  if "%NO_BROWSER%"=="1" exit /b 1
  pause
  exit /b 1
)

if "%NO_BROWSER%"=="1" goto :after_browser
set "APP_URL=http://localhost:3000/index.html#jarvis"

set "CHROME="
if exist "%PROGRAMFILES%\Google\Chrome\Application\chrome.exe" set "CHROME=%PROGRAMFILES%\Google\Chrome\Application\chrome.exe"
if exist "%PROGRAMFILES(X86)%\Google\Chrome\Application\chrome.exe" set "CHROME=%PROGRAMFILES(X86)%\Google\Chrome\Application\chrome.exe"
if exist "%LOCALAPPDATA%\Google\Chrome\Application\chrome.exe" set "CHROME=%LOCALAPPDATA%\Google\Chrome\Application\chrome.exe"

if not "%CHROME%"=="" (
  rem --force-device-scale-factor=1 rasterisation scale pin karta hai. 125%% display
  rem par fractional scale se fonts smeared lagte the.
  start "" "%CHROME%" --app=%APP_URL% --start-maximized --force-device-scale-factor=1 --no-first-run --no-default-browser-check --autoplay-policy=no-user-gesture-required
) else (
  start "" %APP_URL%
)

:after_browser
:: Desktop shortcut - sirf pehli baar
if not exist "%USERPROFILE%\Desktop\Clavis.lnk" (
  powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0Install_Shortcut.ps1" -AppDir "%~dp0" -BatchFile "%~dp0Clavis-App.vbs" >nul 2>&1
  if exist "%USERPROFILE%\Desktop\Clavis.lnk" echo   Desktop par "Clavis" shortcut bana diya.
)

echo.
echo   Clavis ready: %APP_URL%
echo   Ise band karne ke liye Stop-Clavis.bat chalaiye.
echo.
timeout /t 4 /nobreak >nul
