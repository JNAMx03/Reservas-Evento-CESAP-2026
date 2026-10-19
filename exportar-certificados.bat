@echo off
title Exportar certificados de la red
cd /d "%~dp0"
echo.
echo   Revisando los certificados de las conexiones seguras...
echo.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0exportar-certificados.ps1"
echo.
pause
