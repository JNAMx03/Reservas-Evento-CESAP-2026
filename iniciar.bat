@echo off
title Reservas de Palcos
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo   No se encontro Node.js en este equipo.
  echo   Instala la version LTS desde https://nodejs.org y vuelve a abrir este archivo.
  echo.
  pause
  exit /b 1
)

rem Certificados: la red puede inspeccionar las conexiones seguras con un certificado propio.
rem 1) Si esta version de Node lo permite, se usan los certificados en los que confia Windows.
rem 2) Si existe certificados.pem (ver exportar-certificados.ps1), tambien se usa.
set "OPCIONES=--disable-warning=ExperimentalWarning"
node --use-system-ca -e "" >nul 2>nul
if not errorlevel 1 set "OPCIONES=%OPCIONES% --use-system-ca"
if exist "%~dp0certificados.pem" set "NODE_EXTRA_CA_CERTS=%~dp0certificados.pem"

:inicio
node %OPCIONES% server.js
echo.
echo   El servidor se detuvo. Se reinicia en 5 segundos... cierra esta ventana para apagarlo del todo.
timeout /t 5 >nul
goto inicio