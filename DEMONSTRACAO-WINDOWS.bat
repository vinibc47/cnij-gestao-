@echo off
chcp 65001 >nul
title CN-IJ Gestao - DEMONSTRACAO
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 ( start https://nodejs.org/pt & echo Instale o Node.js LTS e tente novamente. & pause & exit /b )
if not exist node_modules ( echo Preparando, aguarde... & call npm install --omit=dev )
if not exist data\demo.sqlite ( call node --disable-warning=ExperimentalWarning scripts/demo-data.js )
echo.
echo  DEMONSTRACAO com dados ficticios. Entre com:
echo    E-mail: irineu@demo.com.br    Senha: Demo1234
echo    (Area do Cliente: helena@exemplo.com / Demo1234)
echo.
start "" http://localhost:3000
node --disable-warning=ExperimentalWarning server/index.js --demo
pause
