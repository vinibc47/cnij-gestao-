@echo off
chcp 65001 >nul
title CN-IJ Gestao
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo  O Node.js ainda nao esta instalado neste computador.
  echo  Vou abrir a pagina de download. Instale a versao LTS, depois
  echo  feche esta janela e de dois cliques novamente neste arquivo.
  echo.
  start https://nodejs.org/pt
  pause
  exit /b
)
if not exist node_modules (
  echo  Preparando o sistema pela primeira vez, aguarde 1 a 2 minutos...
  call npm install --omit=dev
)
echo.
echo  Sistema iniciado! Ele vai abrir no navegador em instantes.
echo  NAO feche esta janela enquanto estiver usando o sistema.
echo.
start "" http://localhost:3000
node --disable-warning=ExperimentalWarning server/index.js
pause
