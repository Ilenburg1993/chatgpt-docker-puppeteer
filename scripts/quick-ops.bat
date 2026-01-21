@echo off
REM ============================================================================
REM  QUICK-OPS v3.0 - Operações rápidas via CLI
REM  Version: 3.0 (2026-01-21) - Enhanced error handling & exit codes
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
if errorlevel 1 (
    echo [FAIL] Failed to start PM2 processes
    exit /b 1
)
echo [OK] PM2 processes started
echo [INFO] Aguardando servicos iniciarem (5s)...
timeout /t 5 >nul
echo [INFO] Validating health checks...
call scripts\quick-ops.bat health
if errorlevel 1 (
    echo [WARN] Services started but health checks failed
    echo [HINT] Check logs with: npm run logs
    exit /b 1
)
echo [OK] System is healthy and operational
exit /b 0

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
curl -sS --max-time 3 http://localhost:2998/api/health 2>nul >temp_health.json
if errorlevel 1 (
    echo   [FAIL] Health endpoint not responding
    echo   [HINT] Start system with: quick-ops.bat start
    del temp_health.json 2>nul
    exit /b 1
)
node -e "const s=require('fs').readFileSync('temp_health.json','utf8');if(s){const j=JSON.parse(s);if(j.status==='ok'||j.status==='healthy'||j.status==='online'){console.log('  [OK] Status: '+j.status);const c=Object.keys(j).filter(k=>k!=='status');console.log('  Components: '+c.join(', '));process.exit(0);}else{console.log('  [WARN] Status: '+j.status);process.exit(1);}}else{console.log('  [FAIL] Invalid response');process.exit(1);}" 2>nul
set HEALTH_EXIT=%errorlevel%
del temp_health.json 2>nul
if %HEALTH_EXIT% neq 0 (
    echo   [HINT] Check PM2 status: npm run pm2
    exit /b 1
)
exit /b 0

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
set BACKUP_NAME=%BACKUP_NAME::=-%
mkdir backups\%BACKUP_NAME% 2>nul
if errorlevel 1 (
    echo [FAIL] Failed to create backup directory
    echo [HINT] Check permissions in backups\ folder
    exit /b 1
)

set FILES_BACKED=0
for %%F in (config.json controle.json dynamic_rules.json ecosystem.config.js) do (
    if exist %%F (
        copy %%F backups\%BACKUP_NAME%\ >nul 2>&1
        if not errorlevel 1 (
            echo   [OK] %%F
            set /a FILES_BACKED+=1
        ) else (
            echo   [WARN] Failed to backup %%F
        )
    )
)

if %FILES_BACKED% EQU 0 (
    echo [FAIL] No files were backed up
    echo [HINT] Check if config files exist in project root
    exit /b 1
)

echo [OK] Backup complete: backups\%BACKUP_NAME% ^(%FILES_BACKED% files^)
exit /b 0

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
REM Generic end point for commands that don't specify exit code
exit /b 0
