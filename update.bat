@echo off
title PokeBonk Auto-Updater
cd /d "%~dp0"
echo Checking pokebonk.com for game updates...
node scripts/update_game.mjs %*
echo.
pause
