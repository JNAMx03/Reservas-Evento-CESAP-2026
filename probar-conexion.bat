@echo off
title Probar conexion segura
cd /d "%~dp0"
set "OPCIONES=--disable-warning=ExperimentalWarning"
node --use-system-ca -e "" >nul 2>nul
if not errorlevel 1 set "OPCIONES=%OPCIONES% --use-system-ca"
if exist "%~dp0certificados.pem" set "NODE_EXTRA_CA_CERTS=%~dp0certificados.pem"
echo.
node %OPCIONES% probar-conexion.js
echo.
pause