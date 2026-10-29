@echo off
title PokeBonk Offline Server
cd /d "%~dp0"
start "" "http://localhost:3000"
node server.mjs
pause
