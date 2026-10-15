@echo off
setlocal
title Stop Rudra24 AI
echo Rudra24 AI band kar raha hoon...
rem Engine watchdog pehle band karo, warna wo engine ko dobara chala dega.
powershell -NoProfile -Command "Get-CimInstance Win32_Process -Filter \"Name='powershell.exe'\" | Where-Object { $_.CommandLine -like '*start-backend.ps1*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }" >nul 2>&1
for %%P in (3000 8000 8777) do (
  for /f "tokens=5" %%A in ('netstat -ano ^| findstr /c:":%%P " ^| findstr /c:"LISTENING"') do (
    taskkill /PID %%A /F >nul 2>&1
  )
)
echo Done.
timeout /t 2 /nobreak >nul
