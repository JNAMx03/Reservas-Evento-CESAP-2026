@echo off
chcp 65001 >nul
title Restablecer contrasena
cd /d "%~dp0"
echo.
echo   Restablecer la contrasena de un usuario (CESAP o CESNE)
echo.
node --disable-warning=ExperimentalWarning restablecer-contrasena.js
echo.
pause
