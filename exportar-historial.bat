@echo off
title Exportar historial de movimientos
cd /d "%~dp0"
echo.
echo   Exportando el historial de movimientos (control interno)...
echo.
node --disable-warning=ExperimentalWarning exportar-historial.js
echo.
pause