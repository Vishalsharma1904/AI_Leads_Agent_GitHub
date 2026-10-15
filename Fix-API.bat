@echo off
setlocal
cd /d "%~dp0"
echo Closing the previous Rudra24 copy and starting this updated folder...
call Stop-Clavis.bat
call Start-Clavis-legacy.bat
