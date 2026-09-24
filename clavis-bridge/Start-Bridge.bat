@echo off
title Clavis PC Bridge - keep open
cd /d "%~dp0"
echo Starting Clavis PC bridge...
echo Close this window to revoke Clavis's access to your PC.
echo (Mouse/keyboard control is OFF here. Use Start-Bridge-With-Control.bat to enable it.)
node bridge.js
pause
