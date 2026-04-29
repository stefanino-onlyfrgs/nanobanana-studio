@echo off
setlocal
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js non trovato. Installa Node.js 20 o superiore e riavvia questo file.
  pause
  exit /b 1
)

echo Avvio Nano Banana 2 Tool...
echo Il server mostrera' l'indirizzo locale da aprire nel browser.
echo.
node --max-old-space-size=8192 server.js
pause
