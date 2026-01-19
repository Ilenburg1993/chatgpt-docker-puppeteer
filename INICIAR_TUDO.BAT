@echo off
title Agente GPT - Launcher (Modo Silencioso)
color 0B

echo ==================================================
echo   SISTEMA DE AUTOMACAO (AUDIT LEVEL 10)
echo ==================================================
echo.

REM 1. Limpeza de Processos Antigos
echo [1/4] Limpando processos anteriores...
call npx pm2 kill >nul 2>&1

REM 2. Preparação do Chrome
echo [2/4] Verificando Chrome...
if not exist "C:\chrome-automation-profile" mkdir "C:\chrome-automation-profile"

REM Tenta abrir. Se ja estiver aberto, o Windows apenas foca na janela.
start "" "C:\Program Files\Google\Chrome\Application\chrome.exe" --remote-debugging-port=9222 --user-data-dir="C:\chrome-automation-profile" --no-first-run --no-default-browser-check

echo [WAIT] Aguardando 5 segundos para o Chrome carregar...
timeout /t 5 >nul

REM 3. Inicia o Painel de Controle (Servidor)
echo [3/4] Iniciando Painel Web...
call npx pm2 start server.js --name dashboard-web --no-autorestart

REM 4. Registra o Robo em modo STOP (Standby)
echo [4/4] Registrando Robo (Status: PARADO)...
call npx pm2 start index.js --name agente-gpt --stop --node-args="--expose-gc" --max-memory-restart 1G

REM 5. Abre a Interface
echo.
echo [OK] Sistema Pronto.
echo      - Painel: Online (Abrindo navegador...)
echo      - Robo:   PARADO (Aguardando comando no painel)
echo.

start http://localhost:3000

echo Pressione qualquer tecla para fechar esta janela.
echo O sistema continuara rodando em background.
pause >nul