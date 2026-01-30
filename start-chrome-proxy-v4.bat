@echo off
REM ============================================================================
REM  CHROME PROXY LAUNCHER v4.0 - ENHANCED WITH AUTO-LOGGING & DIAGNOSTICS
REM  Version: 4.0 (2026-01-30)
REM
REM  New Features:
REM    - Auto-logging to file with timestamps
REM    - Shows WHO is using ports (PID + process name)
REM    - Never hangs - always shows what's happening
REM    - Offers actions (kill, use existing, skip)
REM    - Complete diagnostics in logs/chrome-launcher.log
REM ============================================================================

chcp 65001 >nul 2>&1
setlocal enabledelayedexpansion

REM ============================================================================
REM  CONFIGURAÇÕES
REM ============================================================================
set CHROME_DEBUG_PORT=9224
set PROXY_PORT=9224
set CHROME_USER_DATA_DIR=%USERPROFILE%\.chrome-debug-profile
set MAX_WAIT_SECONDS=10
set SCRIPT_DIR=%~dp0
set LOG_DIR=%SCRIPT_DIR%logs
set LOG_FILE=%LOG_DIR%\chrome-launcher.log

REM Criar diretório de logs se não existir
if not exist "%LOG_DIR%" mkdir "%LOG_DIR%"

REM Iniciar log
echo. >> "%LOG_FILE%"
echo ═══════════════════════════════════════════════════════════════ >> "%LOG_FILE%"
echo [%DATE% %TIME%] CHROME PROXY LAUNCHER v4.0 STARTED >> "%LOG_FILE%"
echo ═══════════════════════════════════════════════════════════════ >> "%LOG_FILE%"

REM ============================================================================
REM  FUNÇÕES DE LOG
REM ============================================================================
:LOG
    echo [%TIME%] %~1 >> "%LOG_FILE%"
    echo %~1
    goto :eof

:LOG_ERROR
    echo [%TIME%] [ERRO] %~1 >> "%LOG_FILE%"
    echo [ERRO] %~1
    goto :eof

:LOG_INFO
    echo [%TIME%] [INFO] %~1 >> "%LOG_FILE%"
    echo [INFO] %~1
    goto :eof

:LOG_SUCCESS
    echo [%TIME%] [OK] %~1 >> "%LOG_FILE%"
    echo [OK] %~1
    goto :eof

REM ============================================================================
REM  HEADER
REM ============================================================================
cls
call :LOG "════════════════════════════════════════════════════════════════"
call :LOG "  CHROME PROXY LAUNCHER v4.0"
call :LOG "  Production-Ready + Auto-Diagnostics + Logging"
call :LOG "════════════════════════════════════════════════════════════════"
call :LOG ""
call :LOG_INFO "Logs sendo salvos em: %LOG_FILE%"
call :LOG ""

REM ============================================================================
REM  ETAPA 1: VALIDAÇÃO DE AMBIENTE
REM ============================================================================
call :LOG "[ETAPA 1] Validando ambiente..."
call :LOG ""

REM Verificar Node.js
where node >nul 2>&1
if %errorlevel% neq 0 (
    call :LOG_ERROR "Node.js não encontrado!"
    call :LOG_ERROR "Instale de: https://nodejs.org/"
    pause
    exit /b 1
)
for /f "tokens=*" %%i in ('node --version 2^>nul') do set NODE_VERSION=%%i
call :LOG_SUCCESS "Node.js encontrado: %NODE_VERSION%"

REM Verificar Chrome
set CHROME_PATH=
if exist "C:\Program Files\Google\Chrome\Application\chrome.exe" (
    set "CHROME_PATH=C:\Program Files\Google\Chrome\Application\chrome.exe"
) else if exist "C:\Program Files (x86)\Google\Chrome\Application\chrome.exe" (
    set "CHROME_PATH=C:\Program Files (x86)\Google\Chrome\Application\chrome.exe"
) else if exist "%LOCALAPPDATA%\Google\Chrome\Application\chrome.exe" (
    set "CHROME_PATH=%LOCALAPPDATA%\Google\Chrome\Application\chrome.exe"
)

if not defined CHROME_PATH (
    call :LOG_ERROR "Chrome não encontrado!"
    pause
    exit /b 1
)
call :LOG_SUCCESS "Chrome encontrado: %CHROME_PATH%"

REM Verificar Proxy Script
set PROXY_SCRIPT=%SCRIPT_DIR%scripts\chrome-proxy-service.js
if not exist "%PROXY_SCRIPT%" (
    call :LOG_ERROR "Proxy script não encontrado: %PROXY_SCRIPT%"
    pause
    exit /b 1
)
call :LOG_SUCCESS "Proxy script encontrado"

REM Detectar IP
set PUBLIC_IP=
for /f "tokens=2 delims=:" %%a in ('ipconfig ^| findstr /C:"IPv4"') do (
    for /f "tokens=1" %%b in ("%%a") do (
        set PUBLIC_IP=%%b
        goto :IP_FOUND
    )
)
:IP_FOUND
if "!PUBLIC_IP!"=="" set PUBLIC_IP=192.168.0.2
call :LOG_INFO "IP público detectado: !PUBLIC_IP!"
call :LOG ""

REM ============================================================================
REM  ETAPA 2: DIAGNÓSTICO DE PORTAS (CRITICAL!)
REM ============================================================================
call :LOG "[ETAPA 2] Diagnóstico de portas..."
call :LOG ""

REM Verificar porta 9224 (Chrome)
call :LOG "Verificando porta %CHROME_DEBUG_PORT% (Chrome)..."
netstat -ano | findstr ":%CHROME_DEBUG_PORT%" | findstr "LISTENING" >nul 2>&1
if %errorlevel% equ 0 (
    call :LOG_INFO "Porta %CHROME_DEBUG_PORT% está OCUPADA"

    REM Descobrir QUEM está usando
    for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":%CHROME_DEBUG_PORT%" ^| findstr "LISTENING"') do (
        set CHROME_PID=%%a
        call :LOG_INFO "  PID: !CHROME_PID!"

        for /f "tokens=1" %%b in ('tasklist /FI "PID eq !CHROME_PID!" /NH 2^>nul ^| findstr /V "INFO:"') do (
            set CHROME_PROCESS=%%b
            call :LOG_INFO "  Processo: !CHROME_PROCESS!"
        )
    )

    REM Verificar se é Chrome com remote debugging
    curl -s --connect-timeout 2 "http://localhost:%CHROME_DEBUG_PORT%/json/version" >nul 2>&1
    if !errorlevel! equ 0 (
        call :LOG_SUCCESS "Chrome já está rodando com remote debugging!"
        set CHROME_ALREADY_RUNNING=1
    ) else (
        call :LOG_ERROR "Porta ocupada mas NÃO é Chrome com remote debugging"
        call :LOG ""
        echo O que deseja fazer?
        echo   [1] Matar o processo (PID: !CHROME_PID!) e iniciar Chrome
        echo   [2] Tentar usar mesmo assim
        echo   [3] Sair
        echo.
        set /p CHROME_ACTION="Escolha (1-3): "

        if "!CHROME_ACTION!"=="1" (
            call :LOG_INFO "Matando processo !CHROME_PID!..."
            taskkill /PID !CHROME_PID! /F >nul 2>&1
            timeout /t 2 /nobreak >nul
            set CHROME_ALREADY_RUNNING=0
        ) else if "!CHROME_ACTION!"=="2" (
            set CHROME_ALREADY_RUNNING=1
        ) else (
            call :LOG_ERROR "Operação cancelada"
            pause
            exit /b 1
        )
    )
) else (
    call :LOG_INFO "Porta %CHROME_DEBUG_PORT% está LIVRE"
    set CHROME_ALREADY_RUNNING=0
)
call :LOG ""

REM Verificar porta 9224 (Proxy)
call :LOG "Verificando porta %PROXY_PORT% (Proxy)..."
netstat -ano | findstr ":%PROXY_PORT%" | findstr "LISTENING" >nul 2>&1
if %errorlevel% equ 0 (
    call :LOG_INFO "Porta %PROXY_PORT% está OCUPADA"

    for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":%PROXY_PORT%" ^| findstr "LISTENING"') do (
        set PROXY_PID=%%a
        call :LOG_INFO "  PID: !PROXY_PID!"

        for /f "tokens=1" %%b in ('tasklist /FI "PID eq !PROXY_PID!" /NH 2^>nul ^| findstr /V "INFO:"') do (
            set PROXY_PROCESS=%%b
            call :LOG_INFO "  Processo: !PROXY_PROCESS!"
        )
    )

    REM Verificar se é o proxy
    curl -s --connect-timeout 2 "http://localhost:%PROXY_PORT%/json/version" >nul 2>&1
    if !errorlevel! equ 0 (
        call :LOG_SUCCESS "Proxy já está rodando!"
        set PROXY_ALREADY_RUNNING=1
    ) else (
        call :LOG_ERROR "Porta ocupada mas NÃO é o proxy"
        call :LOG ""
        echo O que deseja fazer?
        echo   [1] Matar o processo (PID: !PROXY_PID!) e iniciar Proxy
        echo   [2] Tentar usar mesmo assim
        echo   [3] Sair
        echo.
        set /p PROXY_ACTION="Escolha (1-3): "

        if "!PROXY_ACTION!"=="1" (
            call :LOG_INFO "Matando processo !PROXY_PID!..."
            taskkill /PID !PROXY_PID! /F >nul 2>&1
            timeout /t 2 /nobreak >nul
            set PROXY_ALREADY_RUNNING=0
        ) else if "!PROXY_ACTION!"=="2" (
            set PROXY_ALREADY_RUNNING=1
        ) else (
            call :LOG_ERROR "Operação cancelada"
            pause
            exit /b 1
        )
    )
) else (
    call :LOG_INFO "Porta %PROXY_PORT% está LIVRE"
    set PROXY_ALREADY_RUNNING=0
)
call :LOG ""

REM ============================================================================
REM  ETAPA 3: INICIALIZAR CHROME (SE NECESSÁRIO)
REM ============================================================================
if %CHROME_ALREADY_RUNNING% equ 0 (
    call :LOG "[ETAPA 3] Inicializando Chrome..."
    call :LOG ""

    if not exist "%CHROME_USER_DATA_DIR%" mkdir "%CHROME_USER_DATA_DIR%"

    call :LOG_INFO "Executando: %CHROME_PATH%"
    call :LOG_INFO "  --remote-debugging-port=%CHROME_DEBUG_PORT%"

    start "" "%CHROME_PATH%" --remote-debugging-port=%CHROME_DEBUG_PORT% --user-data-dir="%CHROME_USER_DATA_DIR%" --no-first-run --no-default-browser-check --disable-features=TranslateUI

    call :LOG_INFO "Aguardando Chrome iniciar (max %MAX_WAIT_SECONDS%s)..."
    set WAITED=0
    :WAIT_CHROME_LOOP
    curl -s --connect-timeout 1 "http://localhost:%CHROME_DEBUG_PORT%/json/version" >nul 2>&1
    if %errorlevel% equ 0 goto :CHROME_READY

    set /a WAITED+=1
    call :LOG_INFO "  Tentativa !WAITED!/%MAX_WAIT_SECONDS%..."

    if %WAITED% geq %MAX_WAIT_SECONDS% (
        call :LOG_ERROR "Timeout: Chrome não iniciou em %MAX_WAIT_SECONDS%s"
        call :LOG_ERROR "Verifique: tasklist | findstr chrome.exe"
        pause
        exit /b 1
    )

    timeout /t 1 /nobreak >nul
    goto :WAIT_CHROME_LOOP

    :CHROME_READY
    call :LOG_SUCCESS "Chrome iniciado com sucesso!"
    call :LOG ""
) else (
    call :LOG "[ETAPA 3] Chrome já estava rodando - SKIP"
    call :LOG ""
)

REM ============================================================================
REM  ETAPA 4: INICIALIZAR PROXY (SE NECESSÁRIO)
REM ============================================================================
if %PROXY_ALREADY_RUNNING% equ 0 (
    call :LOG "[ETAPA 4] Inicializando Proxy..."
    call :LOG ""

    call :LOG_INFO "Executando: node %PROXY_SCRIPT% !PUBLIC_IP! info"

    start "Chrome Proxy Service" node "%PROXY_SCRIPT%" !PUBLIC_IP! info

    call :LOG_INFO "Aguardando Proxy iniciar (max %MAX_WAIT_SECONDS%s)..."
    set WAITED=0
    :WAIT_PROXY_LOOP
    curl -s --connect-timeout 1 "http://localhost:%PROXY_PORT%/json/version" >nul 2>&1
    if %errorlevel% equ 0 goto :PROXY_READY

    set /a WAITED+=1
    call :LOG_INFO "  Tentativa !WAITED!/%MAX_WAIT_SECONDS%..."

    if %WAITED% geq %MAX_WAIT_SECONDS% (
        call :LOG_ERROR "Timeout: Proxy não iniciou em %MAX_WAIT_SECONDS%s"
        call :LOG_ERROR "Verifique janela: Chrome Proxy Service"
        pause
        exit /b 1
    )

    timeout /t 1 /nobreak >nul
    goto :WAIT_PROXY_LOOP

    :PROXY_READY
    call :LOG_SUCCESS "Proxy iniciado com sucesso!"
    call :LOG ""
) else (
    call :LOG "[ETAPA 4] Proxy já estava rodando - SKIP"
    call :LOG ""
)

REM ============================================================================
REM  ETAPA 5: HEALTH CHECKS FINAIS
REM ============================================================================
call :LOG "[ETAPA 5] Health checks finais..."
call :LOG ""

curl -s "http://localhost:%CHROME_DEBUG_PORT%/json/version" >nul 2>&1
if %errorlevel% equ 0 (
    call :LOG_SUCCESS "Chrome: http://localhost:%CHROME_DEBUG_PORT% - OK"
) else (
    call :LOG_ERROR "Chrome não responde!"
)

curl -s "http://localhost:%PROXY_PORT%/json/version" >nul 2>&1
if %errorlevel% equ 0 (
    call :LOG_SUCCESS "Proxy: http://localhost:%PROXY_PORT% - OK"
) else (
    call :LOG_ERROR "Proxy não responde!"
)

curl -s "http://!PUBLIC_IP!:%PROXY_PORT%/json/version" >nul 2>&1
if %errorlevel% equ 0 (
    call :LOG_SUCCESS "Proxy remoto: http://!PUBLIC_IP!:%PROXY_PORT% - OK"
) else (
    call :LOG_ERROR "Proxy não acessível remotamente"
)

REM ============================================================================
REM  SUCESSO
REM ============================================================================
call :LOG ""
call :LOG "════════════════════════════════════════════════════════════════"
call :LOG "  ✅ SISTEMA INICIALIZADO COM SUCESSO!"
call :LOG "════════════════════════════════════════════════════════════════"
call :LOG ""
call :LOG "Logs salvos em: %LOG_FILE%"
call :LOG ""
call :LOG "Próximos passos:"
call :LOG "  1. Do container: curl http://!PUBLIC_IP!:%PROXY_PORT%/json/version"
call :LOG "  2. Do container: npm start"
call :LOG ""

pause
exit /b 0
