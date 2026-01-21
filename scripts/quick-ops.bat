@echo off
REM ============================================================================
REM  QUICK-OPS - Operações rápidas via CLI
REM  Uso: quick-ops.bat <comando> [args]
REM  Comandos: start, stop, restart, status, health, logs, backup
REM ============================================================================

setlocal enabledelayedexpansion

if "%~1"=="" goto SHOW_HELP

set COMMAND=%~1
set ARG1=%~2

REM Navegar para raiz do projeto
cd /d "%~dp0.."

if /i "%COMMAND%"=="start" goto CMD_START
if /i "%COMMAND%"=="stop" goto CMD_STOP
if /i "%COMMAND%"=="restart" goto CMD_RESTART
if /i "%COMMAND%"=="status" goto CMD_STATUS
if /i "%COMMAND%"=="health" goto CMD_HEALTH
if /i "%COMMAND%"=="logs" goto CMD_LOGS
if /i "%COMMAND%"=="backup" goto CMD_BACKUP
if /i "%COMMAND%"=="help" goto SHOW_HELP

echo [ERROR] Comando desconhecido: %COMMAND%
goto SHOW_HELP

:CMD_START
echo [QUICK-OPS] Iniciando sistema...
call npm run daemon:start
timeout /t 5 >nul
call scripts\quick-ops.bat health
goto END

:CMD_STOP
echo [QUICK-OPS] Parando sistema...
call npm run daemon:stop
goto END

:CMD_RESTART
echo [QUICK-OPS] Reiniciando sistema (zero downtime)...
call npm run daemon:reload
goto END

:CMD_STATUS
echo [QUICK-OPS] Status PM2:
call npx pm2 list
goto END

:CMD_HEALTH
echo [QUICK-OPS] Health Check:
curl -s http://localhost:2998/api/health 2>nul | node -e "const s=require('fs').readFileSync(0,'utf8');if(s){const j=JSON.parse(s);console.log('  Status: '+j.status);console.log('  Components: '+Object.keys(j).filter(k=>k!=='status').join(', '));}" 2>nul || echo   [ERROR] Health endpoint not responding
goto END

:CMD_LOGS
if "%ARG1%"=="" (
    echo [QUICK-OPS] Logs PM2 (Ctrl+C para sair):
    call npx pm2 logs --lines 50
) else (
    echo [QUICK-OPS] Logs de %ARG1%:
    call npx pm2 logs %ARG1% --lines 50
)
goto END

:CMD_BACKUP
echo [QUICK-OPS] Criando backup...
set BACKUP_NAME=quickops-%DATE:/=-%_%TIME::=-%_%RANDOM%
mkdir backups\%BACKUP_NAME% 2>nul
copy config.json backups\%BACKUP_NAME%\ >nul 2>&1
copy controle.json backups\%BACKUP_NAME%\ >nul 2>&1
copy dynamic_rules.json backups\%BACKUP_NAME%\ >nul 2>&1
echo [SUCCESS] Backup: backups\%BACKUP_NAME%
goto END

:SHOW_HELP
echo.
echo ============================================================
echo  QUICK-OPS - CLI para operacoes rapidas
echo ============================================================
echo.
echo Uso: quick-ops.bat ^<comando^> [args]
echo.
echo Comandos disponiveis:
echo   start      Inicia o sistema PM2
echo   stop       Para o sistema PM2
echo   restart    Reinicia com zero downtime
echo   status     Mostra status PM2
echo   health     Verifica health endpoints
echo   logs [app] Mostra logs (opcional: app especifico)
echo   backup     Cria backup rapido de configs
echo   help       Mostra esta ajuda
echo.
echo Exemplos:
echo   quick-ops.bat start
echo   quick-ops.bat health
echo   quick-ops.bat logs agente-gpt
echo   quick-ops.bat backup
echo.
goto END

:END
exit /b 0
