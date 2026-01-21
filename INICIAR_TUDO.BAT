@echo off
title Agente GPT - Launcher (Modo Silencioso)
color 0B

echo ==================================================
echo   SISTEMA DE AUTOMACAO (AUDIT LEVEL 10)
echo ==================================================
echo.

REM 1. Limpeza de Processos Antigos
echo [1/3] Limpando processos anteriores...
call npx pm2 kill >nul 2>&1

REM 2. Preparação do Chrome
echo [2/3] Verificando Chrome...
if not exist "C:\chrome-automation-profile" mkdir "C:\chrome-automation-profile"

REM Tenta abrir. Se ja estiver aberto, o Windows apenas foca na janela.
start "" "C:\Program Files\Google\Chrome\Application\chrome.exe" --remote-debugging-port=9222 --user-data-dir="C:\chrome-automation-profile" --no-first-run --no-default-browser-check

echo [WAIT] Aguardando 5 segundos para o Chrome carregar...
timeout /t 5 >nul

REM 3. Inicia o Sistema (PM2 com ecosystem.config.js)
echo [3/3] Iniciando sistema completo...
call npm run daemon:start

REM Aguarda PM2 inicializar
timeout /t 3 >nul

REM 4. Abre a Interface
echo.
echo [OK] Sistema Pronto.
echo      - Agente GPT:   Rodando (via PM2)
echo      - Dashboard:    Rodando (via PM2)
echo      - Interface:    http://localhost:3008
echo.
echo Use 'npm run daemon:status' para ver status
echo Use 'npm run daemon:logs' para ver logs
echo Use 'npm run daemon:stop' para parar
echo.

start http://localhost:3008

echo Pressione qualquer tecla para fechar esta janela.
echo O sistema continuara rodando em background via PM2.
pause >nul
