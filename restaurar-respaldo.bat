@echo off
title Restaurar respaldo
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0restaurar-respaldo.ps1"
echo.
pause