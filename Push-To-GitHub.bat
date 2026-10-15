@echo off
setlocal
cd /d "%~dp0"
title Rudra24 AI - GitHub par upload
echo.
echo   Aapka poora project GitHub par upload ho raha hai...
echo   (keys, .env, database, ZIP aur logs upload NAHI honge - .gitignore unhe rokta hai)
echo.
git checkout -B main || goto :fail
git add -A || goto :fail
git commit -m "Latest Rudra24 AI project - %date% %time%"
git push -u origin main || goto :fail
echo.
echo   Ho gaya! Ab phone par Claude app ke Code section me
echo   Vishalsharma1904/AI_Leads_Agent_GitHub repo kholiye.
echo.
pause
exit /b 0
:fail
echo.
echo   [X] Upload nahi hua. Upar ki error line ka screenshot Claude ko bhejiye.
pause
exit /b 1
