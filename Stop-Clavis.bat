@echo off
setlocal
title Stop Clavis
echo Clavis band kar raha hoon...
for %%P in (3000 8000 8777) do (
  for /f "tokens=5" %%A in ('netstat -ano ^| findstr /c:":%%P" ^| findstr /c:"LISTENING"') do (
    taskkill /PID %%A /F >nul 2>&1
  )
)
echo Done.
timeout /t 2 /nobreak >nul
