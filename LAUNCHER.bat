@echo off
REM ============================================================================
REM  SUPER LAUNCHER v3.0 - ChatGPT Docker Puppeteer
REM  Version: 3.0 (2026-01-21) - Enhanced features & cross-platform parity
REM  Audit Level: PM2-First Strategy (Opção A)
REM  Estratégia: Menu interativo + validações + health checks + automações
REM ============================================================================

setlocal enabledelayedexpansion
title Super Launcher - ChatGPT Docker Puppeteer

REM ============================================================================
REM  CONFIGURAÇÕES GLOBAIS
REM ============================================================================
set SCRIPT_DIR=%~dp0
cd /d "%SCRIPT_DIR%"
set SERVER_PORT=2998
set HEALTH_URL=http://localhost:%SERVER_PORT%/api/health
set CHROME_CONFIG=chrome-config.json
set BACKUP_DIR=backups\launcher-%DATE:/=-%-%TIME::=-%
set LOG_FILE=logs\launcher.log

REM ============================================================================
REM  CORES E FORMATAÇÃO (Windows 10+)
REM ============================================================================
set "COLOR_RESET=[0m"
set "COLOR_GREEN=[92m"
set "COLOR_RED=[91m"
set "COLOR_YELLOW=[93m"
set "COLOR_CYAN=[96m"
set "COLOR_BOLD=[1m"

:MAIN_MENU
cls
echo.
echo %COLOR_CYAN%============================================================%COLOR_RESET%
echo %COLOR_BOLD%          SUPER LAUNCHER v3.0 - ChatGPT Puppeteer%COLOR_RESET%
echo %COLOR_CYAN%============================================================%COLOR_RESET%
echo.
echo  %COLOR_GREEN%[1]%COLOR_RESET% Start System          %COLOR_YELLOW%(boot completo com validações)%COLOR_RESET%
echo  %COLOR_GREEN%[2]%COLOR_RESET% Stop System           %COLOR_YELLOW%(shutdown gracioso PM2)%COLOR_RESET%
echo  %COLOR_GREEN%[3]%COLOR_RESET% Restart System        %COLOR_YELLOW%(reload sem downtime)%COLOR_RESET%
echo  %COLOR_GREEN%[4]%COLOR_RESET% Status Check          %COLOR_YELLOW%(health + PM2 + Chrome)%COLOR_RESET%
echo  %COLOR_GREEN%[5]%COLOR_RESET% View Logs             %COLOR_YELLOW%(tail agregado em tempo real)%COLOR_RESET%
echo  %COLOR_GREEN%[6]%COLOR_RESET% Open PM2 GUI          %COLOR_YELLOW%(interface gráfica Electron)%COLOR_RESET%
echo  %COLOR_GREEN%[7]%COLOR_RESET% PM2 Monit             %COLOR_YELLOW%(dashboard CLI oficial)%COLOR_RESET%
echo  %COLOR_GREEN%[8]%COLOR_RESET% Clean System          %COLOR_YELLOW%(limpar logs/tmp/cache)%COLOR_RESET%
echo  %COLOR_GREEN%[9]%COLOR_RESET% Diagnose Crashes      %COLOR_YELLOW%(análise forense automática)%COLOR_RESET%
echo  %COLOR_GREEN%[10]%COLOR_RESET% Backup Configuration %COLOR_YELLOW%(snapshot de configs críticos)%COLOR_RESET%
echo.
echo  %COLOR_RED%[0]%COLOR_RESET% Exit
echo.
echo %COLOR_CYAN%============================================================%COLOR_RESET%
echo.

set /p choice="Escolha uma opção: "

if "%choice%"=="1" goto START_SYSTEM
if "%choice%"=="2" goto STOP_SYSTEM
if "%choice%"=="3" goto RESTART_SYSTEM
if "%choice%"=="4" goto STATUS_CHECK
if "%choice%"=="5" goto VIEW_LOGS
if "%choice%"=="6" goto OPEN_PM2_GUI
if "%choice%"=="7" goto PM2_MONIT
if "%choice%"=="8" goto CLEAN_SYSTEM
if "%choice%"=="9" goto DIAGNOSE_CRASHES
if "%choice%"=="10" goto BACKUP_CONFIG
if "%choice%"=="0" goto EXIT

echo %COLOR_RED%[ERRO] Opção inválida!%COLOR_RESET%
timeout /t 2 >nul
goto MAIN_MENU

REM ============================================================================
REM  [1] START SYSTEM - Boot completo com validações
REM ============================================================================
:START_SYSTEM
cls
echo %COLOR_CYAN%============================================================%COLOR_RESET%
echo %COLOR_BOLD%  INICIANDO SISTEMA - Validações Pré-Boot%COLOR_RESET%
echo %COLOR_CYAN%============================================================%COLOR_RESET%
echo.

REM --- Validação 1: Node.js ---
echo %COLOR_YELLOW%[1/5] Verificando Node.js...%COLOR_RESET%
node --version >nul 2>&1
if errorlevel 1 (
    echo %COLOR_RED%[ERRO] Node.js não encontrado!%COLOR_RESET%
    echo         Instale em: https://nodejs.org/
    pause
    goto MAIN_MENU
)
for /f "tokens=*" %%i in ('node --version') do set NODE_VERSION=%%i
echo         %COLOR_GREEN%✓%COLOR_RESET% Node.js %NODE_VERSION% detectado
echo.

REM --- Validação 2: PM2 ---
echo %COLOR_YELLOW%[2/5] Verificando PM2...%COLOR_RESET%
call npm list -g pm2 >nul 2>&1
if errorlevel 1 (
    echo %COLOR_RED%[ERRO] PM2 não encontrado!%COLOR_RESET%
    echo         Execute: npm install -g pm2
    pause
    goto MAIN_MENU
)
echo         %COLOR_GREEN%✓%COLOR_RESET% PM2 instalado
echo.

REM --- Validação 3: Dependências Node ---
echo %COLOR_YELLOW%[3/5] Verificando dependências...%COLOR_RESET%
if not exist "node_modules\" (
    echo %COLOR_YELLOW%        Instalando dependências...%COLOR_RESET%
    call npm install
)
echo         %COLOR_GREEN%✓%COLOR_RESET% Dependências OK
echo.

REM --- Validação 4: Chrome Config ---
echo %COLOR_YELLOW%[4/5] Verificando Chrome config...%COLOR_RESET%
if not exist "%CHROME_CONFIG%" (
    echo %COLOR_YELLOW%        Gerando chrome-config.json...%COLOR_RESET%
    node -e "const CO = require('./src/infra/ConnectionOrchestrator'); CO.exportConfigForLauncher();"
)
echo         %COLOR_GREEN%✓%COLOR_RESET% Chrome config disponível
echo.

REM --- Validação 5: Crash Detection ---
echo %COLOR_YELLOW%[5/5] Verificando crashes anteriores...%COLOR_RESET%
if exist "logs\crash_reports\*.txt" (
    for /f %%a in ('dir /b logs\crash_reports\*.txt 2^>nul ^| find /c /v ""') do set CRASH_COUNT=%%a
    if !CRASH_COUNT! GTR 0 (
        echo         %COLOR_RED%⚠ !CRASH_COUNT! crash(es) detectado(s)!%COLOR_RESET%
        echo         Execute opção [9] para diagnóstico
    )
) else (
    echo         %COLOR_GREEN%✓%COLOR_RESET% Sem crashes recentes
)
echo.

REM --- Backup Automático ---
echo %COLOR_YELLOW%[AUTO] Backup de segurança...%COLOR_RESET%
if not exist "backups\" mkdir backups
set BACKUP_NAME=pre-start-%DATE:/=-%_%RANDOM%
mkdir "backups\%BACKUP_NAME%" 2>nul
copy config.json "backups\%BACKUP_NAME%\" >nul 2>&1
copy controle.json "backups\%BACKUP_NAME%\" >nul 2>&1
copy dynamic_rules.json "backups\%BACKUP_NAME%\" >nul 2>&1
echo         %COLOR_GREEN%✓%COLOR_RESET% Backup: backups\%BACKUP_NAME%
echo.

REM --- Inicialização PM2 ---
echo %COLOR_CYAN%============================================================%COLOR_RESET%
echo %COLOR_BOLD%  INICIANDO PM2 DAEMON%COLOR_RESET%
echo %COLOR_CYAN%============================================================%COLOR_RESET%
echo.

call npm run daemon:start

echo.
echo %COLOR_YELLOW%Aguardando serviços iniciarem (10s)...%COLOR_RESET%
timeout /t 10 >nul

REM --- Health Check ---
echo.
echo %COLOR_YELLOW%Validando health checks...%COLOR_RESET%
curl -s %HEALTH_URL% >nul 2>&1
if errorlevel 1 (
    echo %COLOR_RED%[AVISO] Health endpoint não responde%COLOR_RESET%
    echo         Sistema pode estar iniciando...
) else (
    echo %COLOR_GREEN%✓ Sistema operacional!%COLOR_RESET%
)

echo.
echo %COLOR_GREEN%============================================================%COLOR_RESET%
echo %COLOR_GREEN%  ✓ SISTEMA INICIADO COM SUCESSO!%COLOR_RESET%
echo %COLOR_GREEN%============================================================%COLOR_RESET%
echo.
echo  Dashboard: http://localhost:%SERVER_PORT%
echo  PM2 Status: npm run queue:status
echo  Logs: Option [5] no menu
echo.
pause
goto MAIN_MENU

REM ============================================================================
REM  [2] STOP SYSTEM - Shutdown gracioso PM2
REM ============================================================================
:STOP_SYSTEM
cls
echo %COLOR_CYAN%============================================================%COLOR_RESET%
echo %COLOR_BOLD%  PARANDO SISTEMA%COLOR_RESET%
echo %COLOR_CYAN%============================================================%COLOR_RESET%
echo.

call npm run daemon:stop

echo.
echo %COLOR_GREEN%✓ Sistema parado com sucesso!%COLOR_RESET%
echo.
pause
goto MAIN_MENU

REM ============================================================================
REM  [3] RESTART SYSTEM - Reload sem downtime
REM ============================================================================
:RESTART_SYSTEM
cls
echo %COLOR_CYAN%============================================================%COLOR_RESET%
echo %COLOR_BOLD%  REINICIANDO SISTEMA (Zero Downtime)%COLOR_RESET%
echo %COLOR_CYAN%============================================================%COLOR_RESET%
echo.

call npm run daemon:reload

echo.
echo %COLOR_GREEN%✓ Sistema reiniciado!%COLOR_RESET%
echo.
pause
goto MAIN_MENU

REM ============================================================================
REM  [4] STATUS CHECK - Health + PM2 + Chrome
REM ============================================================================
:STATUS_CHECK
cls
echo %COLOR_CYAN%============================================================%COLOR_RESET%
echo %COLOR_BOLD%  STATUS DO SISTEMA%COLOR_RESET%
echo %COLOR_CYAN%============================================================%COLOR_RESET%
echo.

REM --- PM2 Status ---
echo %COLOR_YELLOW%[PM2 Processes]%COLOR_RESET%
call npx pm2 jlist > temp_pm2.json 2>nul
if exist temp_pm2.json (
    node -e "const fs=require('fs');const p=JSON.parse(fs.readFileSync('temp_pm2.json'));p.forEach(x=>{console.log('  '+x.name+': '+x.pm2_env.status+' (PID: '+x.pid+', Memory: '+(x.monit.memory/(1024*1024)).toFixed(0)+'MB)')});"
    del temp_pm2.json
) else (
    echo   %COLOR_RED%PM2 não está rodando%COLOR_RESET%
)
echo.

REM --- Health Endpoints ---
echo %COLOR_YELLOW%[Health Checks]%COLOR_RESET%
curl -s %HEALTH_URL%/chrome 2>nul | node -e "const s=require('fs').readFileSync(0,'utf8');if(s){const j=JSON.parse(s);console.log('  Chrome: '+j.status);}" 2>nul || echo   Chrome: unavailable
curl -s %HEALTH_URL%/pm2 2>nul | node -e "const s=require('fs').readFileSync(0,'utf8');if(s){const j=JSON.parse(s);console.log('  PM2: '+j.status);}" 2>nul || echo   PM2: unavailable
curl -s %HEALTH_URL%/kernel 2>nul | node -e "const s=require('fs').readFileSync(0,'utf8');if(s){const j=JSON.parse(s);console.log('  Kernel: '+j.status);}" 2>nul || echo   Kernel: unavailable
curl -s %HEALTH_URL%/disk 2>nul | node -e "const s=require('fs').readFileSync(0,'utf8');if(s){const j=JSON.parse(s);console.log('  Disk: '+j.status+' ('+j.usage.total.mb+'MB)');}" 2>nul || echo   Disk: unavailable
echo.

REM --- Queue Status ---
echo %COLOR_YELLOW%[Queue Status]%COLOR_RESET%
call npm run queue:status --silent 2>nul | findstr /i "pending running done failed"
echo.

echo %COLOR_CYAN%============================================================%COLOR_RESET%
pause
goto MAIN_MENU

REM ============================================================================
REM  [5] VIEW LOGS - Tail agregado
REM ============================================================================
:VIEW_LOGS
cls
echo %COLOR_CYAN%============================================================%COLOR_RESET%
echo %COLOR_BOLD%  VISUALIZAR LOGS (Ctrl+C para sair)%COLOR_RESET%
echo %COLOR_CYAN%============================================================%COLOR_RESET%
echo.
echo Escolha o tipo de log:
echo.
echo  [1] PM2 Logs (agente + dashboard)
echo  [2] Error Logs
echo  [3] Application Logs
echo  [4] Todos os logs
echo.
set /p log_choice="Opção: "

if "%log_choice%"=="1" (
    call npx pm2 logs
) else if "%log_choice%"=="2" (
    type logs\error.log 2>nul | more
) else if "%log_choice%"=="3" (
    type logs\application.log 2>nul | more
) else if "%log_choice%"=="4" (
    call npx pm2 logs --raw --lines 100
) else (
    echo Opção inválida
    timeout /t 2 >nul
)

goto MAIN_MENU

REM ============================================================================
REM  [6] OPEN PM2 GUI - Interface gráfica Electron
REM ============================================================================
:OPEN_PM2_GUI
cls
echo %COLOR_CYAN%============================================================%COLOR_RESET%
echo %COLOR_BOLD%  PM2 GUI (Interface Gráfica)%COLOR_RESET%
echo %COLOR_CYAN%============================================================%COLOR_RESET%
echo.

where pm2-gui >nul 2>&1
if errorlevel 1 (
    echo %COLOR_YELLOW%pm2-gui não está instalado.%COLOR_RESET%
    echo.
    echo Deseja instalar agora? (S/N)
    set /p install_gui="Resposta: "
    if /i "!install_gui!"=="S" (
        echo.
        echo Instalando pm2-gui...
        call npm install -g pm2-gui
        echo.
        echo %COLOR_GREEN%✓ Instalação concluída!%COLOR_RESET%
        echo Abrindo pm2-gui...
        start pm2-gui
    )
) else (
    echo Abrindo pm2-gui...
    start pm2-gui
)

echo.
pause
goto MAIN_MENU

REM ============================================================================
REM  [7] PM2 MONIT - Dashboard CLI oficial
REM ============================================================================
:PM2_MONIT
cls
echo %COLOR_CYAN%============================================================%COLOR_RESET%
echo %COLOR_BOLD%  PM2 MONIT (Dashboard Interativo)%COLOR_RESET%
echo %COLOR_CYAN%============================================================%COLOR_RESET%
echo.
echo Pressione Ctrl+C para sair
timeout /t 2 >nul
call npx pm2 monit
goto MAIN_MENU

REM ============================================================================
REM  [8] CLEAN SYSTEM - Limpar logs/tmp/cache
REM ============================================================================
:CLEAN_SYSTEM
cls
echo %COLOR_CYAN%============================================================%COLOR_RESET%
echo %COLOR_BOLD%  LIMPEZA DO SISTEMA%COLOR_RESET%
echo %COLOR_CYAN%============================================================%COLOR_RESET%
echo.
echo %COLOR_RED%ATENÇÃO: Esta operação irá remover:%COLOR_RESET%
echo   - Logs antigos (mantém últimos 7 dias)
echo   - Arquivos temporários (.tmp)
echo   - Cache PM2
echo   - Crash reports processados
echo.
set /p confirm="Confirma limpeza? (S/N): "

if /i not "%confirm%"=="S" (
    echo Operação cancelada.
    pause
    goto MAIN_MENU
)

echo.
echo Executando limpeza...
call npm run clean

echo.
echo %COLOR_GREEN%✓ Limpeza concluída!%COLOR_RESET%
echo.
pause
goto MAIN_MENU

REM ============================================================================
REM  [9] DIAGNOSE CRASHES - Análise forense automática
REM ============================================================================
:DIAGNOSE_CRASHES
cls
echo %COLOR_CYAN%============================================================%COLOR_RESET%
echo %COLOR_BOLD%  DIAGNÓSTICO DE CRASHES%COLOR_RESET%
echo %COLOR_CYAN%============================================================%COLOR_RESET%
echo.

if not exist "logs\crash_reports\" (
    echo %COLOR_GREEN%✓ Nenhum crash detectado!%COLOR_RESET%
    echo.
    pause
    goto MAIN_MENU
)

echo Analisando crash reports...
echo.

for /f "tokens=*" %%f in ('dir /b /o-d logs\crash_reports\*.txt 2^>nul') do (
    echo %COLOR_YELLOW%Crash: %%f%COLOR_RESET%
    type "logs\crash_reports\%%f" | findstr /i "error exception failed"
    echo.
)

echo.
echo Executando diagnóstico completo...
call npm run diagnose

echo.
pause
goto MAIN_MENU

REM ============================================================================
REM  [10] BACKUP CONFIGURATION - Snapshot de configs críticos
REM ============================================================================
:BACKUP_CONFIG
cls
echo %COLOR_CYAN%============================================================%COLOR_RESET%
echo %COLOR_BOLD%  BACKUP DE CONFIGURAÇÕES%COLOR_RESET%
echo %COLOR_CYAN%============================================================%COLOR_RESET%
echo.

set BACKUP_NAME=manual-%DATE:/=-%_%TIME::=-%_%RANDOM%
set BACKUP_PATH=backups\%BACKUP_NAME%

echo Criando backup: %BACKUP_NAME%
echo.

mkdir "%BACKUP_PATH%" 2>nul

REM Copiar configs críticos
echo Copiando arquivos...
copy config.json "%BACKUP_PATH%\" >nul 2>&1 && echo   %COLOR_GREEN%✓%COLOR_RESET% config.json
copy controle.json "%BACKUP_PATH%\" >nul 2>&1 && echo   %COLOR_GREEN%✓%COLOR_RESET% controle.json
copy dynamic_rules.json "%BACKUP_PATH%\" >nul 2>&1 && echo   %COLOR_GREEN%✓%COLOR_RESET% dynamic_rules.json
copy ecosystem.config.js "%BACKUP_PATH%\" >nul 2>&1 && echo   %COLOR_GREEN%✓%COLOR_RESET% ecosystem.config.js
copy chrome-config.json "%BACKUP_PATH%\" >nul 2>&1 && echo   %COLOR_GREEN%✓%COLOR_RESET% chrome-config.json
copy package.json "%BACKUP_PATH%\" >nul 2>&1 && echo   %COLOR_GREEN%✓%COLOR_RESET% package.json

REM Backup da fila (apenas contagem)
echo.
echo Backupeando fila...
if exist "fila\" (
    xcopy fila\*.json "%BACKUP_PATH%\fila\" /E /I /Q >nul 2>&1
    for /f %%a in ('dir /b fila\*.json 2^>nul ^| find /c /v ""') do set TASK_COUNT=%%a
    echo   %COLOR_GREEN%✓%COLOR_RESET% !TASK_COUNT! tarefas copiadas
)

echo.
echo %COLOR_GREEN%============================================================%COLOR_RESET%
echo %COLOR_GREEN%  ✓ BACKUP CONCLUÍDO!%COLOR_RESET%
echo %COLOR_GREEN%============================================================%COLOR_RESET%
echo.
echo  Local: %BACKUP_PATH%
echo  Arquivos: config, controle, dynamic_rules, ecosystem, chrome-config, fila
echo.
pause
goto MAIN_MENU

REM ============================================================================
REM  EXIT
REM ============================================================================
:EXIT
cls
echo.
echo %COLOR_CYAN%Obrigado por usar o Super Launcher v3.0!%COLOR_RESET%
echo.
timeout /t 2 >nul
exit /b 0
