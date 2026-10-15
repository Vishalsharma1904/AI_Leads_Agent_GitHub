@echo off
setlocal
title OpenWA - WhatsApp gateway (Rudra24 AI)
cd /d "%~dp0openwa"

where node >nul 2>nul || (echo Node.js nahi mila. https://nodejs.org se Node 22 LTS install karke dobara chalaiye. & pause & exit /b 1)
for /f "tokens=1 delims=." %%v in ('node -p "process.versions.node"') do set NODE_MAJOR=%%v
if %NODE_MAJOR% LSS 22 (echo OpenWA ko Node 22.19+ chahiye. Aapke paas Node %NODE_MAJOR% hai - nodejs.org se Node 22 LTS install kariye. & pause & exit /b 1)

if not exist node_modules\ (
  echo [1/2] Pehli baar setup - packages install ho rahe hain, 5-10 minute lagenge...
  call npm ci || (echo Install fail hua. Upar ka error dekhiye. & pause & exit /b 1)
)
if not exist dist\main.js (
  echo [2/2] Build ho raha hai...
  call npm run build:all || (echo Build fail hua. Upar ka error dekhiye. & pause & exit /b 1)
)

echo.
echo OpenWA chal raha hai: http://localhost:2785   (is window ko band mat kariye)
echo Rudra24 AI me: WhatsApp Automation ^> "Apna WhatsApp number (OpenWA)"
echo.
node dist\main.js
pause
