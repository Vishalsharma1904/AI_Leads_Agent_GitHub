@echo off
title Clavis PC Bridge (mouse/keyboard control ON) - keep open
cd /d "%~dp0"
echo Starting Clavis PC bridge WITH mouse/keyboard control enabled.
echo Clavis can now move your mouse, click, scroll and type on this PC when you ask it to.
echo Close this window at any time to instantly revoke that access.
set CLAVIS_BRIDGE_ALLOW_CONTROL=1
node bridge.js
pause
