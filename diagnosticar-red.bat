@echo off
title Diagnostico de red
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0diagnosticar-red.ps1"
echo.
pause
