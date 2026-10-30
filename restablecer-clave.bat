@echo off
title Recuperar acceso - Control de Retardos
cd /d "%~dp0"
where node >nul 2>nul || (echo Necesita Node.js instalado. & pause & exit /b 1)
node src\restablecer-clave.js
echo.
set /p USUARIO=Usuario al que se le pondra una contrasena temporal (Enter para salir):
if "%USUARIO%"=="" exit /b 0
node src\restablecer-clave.js %USUARIO%
echo.
pause
