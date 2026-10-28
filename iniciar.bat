@echo off
title Control de Retardos - El Boom Tractopartes
cd /d "%~dp0"
where node >nul 2>nul || (echo Necesita instalar Node.js 22.5 o superior: https://nodejs.org & pause & exit /b 1)
if not exist node_modules (
  echo Instalando dependencias por primera vez...
  call npm install --omit=dev || (pause & exit /b 1)
)
rem Abre el navegador unos segundos despues, cuando el sistema ya esta listo.
start "" /min cmd /c "timeout /t 3 /nobreak >nul & start http://localhost:3000"
node src\server.js
pause
