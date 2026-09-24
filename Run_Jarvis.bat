@echo off
echo =======================================
echo     Starting Jarvis AI Local Server
echo =======================================
echo.
echo Your browser will open automatically. 
echo This local server fixes the "Microphone Permission" issue
echo so you only have to allow the mic ONCE!
echo.
echo Press Ctrl+C in this window to stop the server when you are done.
echo.
start http://localhost:8000
python -m http.server 8000
pause
