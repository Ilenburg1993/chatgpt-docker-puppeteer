@echo off
chcp 65001 >nul 2>&1
setlocal enabledelayedexpansion

set CHROME_DEBUG_PORT=9224
set PROXY_PORT=9224
set CHROME_USER_DATA_DIR=%USERPROFILE%\.chrome-debug-profile
set SCRIPT_DIR=%~dp0
set PROXY_SCRIPT=%SCRIPT_DIR%scripts\chrome-proxy-service.js
set LOG_DIR=%SCRIPT_DIR%logs
set LOG_FILE=%LOG_DIR%\chrome-launcher.log

if not exist "%LOG_DIR%" mkdir "%LOG_DIR%"

echo.
echo ════════════════════════════════════════════════════════════════
echo   CHROME PROXY LAUNCHER - SIMPLE & ROBUST
echo ════════════════════════════════════════════════════════════════
echo.
echo Logs: %LOG_FILE%
echo.

echo. >> "%LOG_FILE%"
echo [%DATE% %TIME%] LAUNCHER STARTED >> "%LOG_FILE%"

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
echo [INFO] IP: !PUBLIC_IP!
echo [%TIME%] IP: !PUBLIC_IP! >> "%LOG_FILE%"

REM Verificar Chrome
set CHROME_PATH=
if exist "C:\Program Files\Google\Chrome\Application\chrome.exe" (
    set "CHROME_PATH=C:\Program Files\Google\Chrome\Application\chrome.exe"
) else if exist "C:\Program Files (x86)\Google\Chrome\Application\chrome.exe" (
    set "CHROME_PATH=C:\Program Files (x86)\Google\Chrome\Application\chrome.exe"
)

if not defined CHROME_PATH (
    echo [ERRO] Chrome não encontrado!
    pause
    exit /b 1
)

echo.
echo [1] Verificando porta %CHROME_DEBUG_PORT% (Chrome)...
netstat -ano | findstr ":%CHROME_DEBUG_PORT%" | findstr "LISTENING" >nul 2>&1
if %errorlevel% equ 0 (
    echo     Porta ocupada - verificando se é Chrome...
    curl -s --connect-timeout 2 "http://localhost:%CHROME_DEBUG_PORT%/json/version" >nul 2>&1
    if !errorlevel! equ 0 (
        echo     [OK] Chrome já está rodando!
        set SKIP_CHROME=1
    ) else (
        echo     [ERRO] Porta ocupada por outro processo!
        echo     Execute: check-ports.bat para ver qual processo
        echo.
        echo     Deseja matar o processo? (S/N)
        set /p KILL_CHROME="Resposta: "
        if /i "!KILL_CHROME!"=="S" (
            for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":%CHROME_DEBUG_PORT%" ^| findstr "LISTENING"') do (
                echo     Matando PID %%a...
                taskkill /PID %%a /F >nul 2>&1
            )
            timeout /t 2 /nobreak >nul
            set SKIP_CHROME=0
        ) else (
            echo     Operação cancelada
            pause
            exit /b 1
        )
    )
) else (
    echo     Porta livre
    set SKIP_CHROME=0
)

if %SKIP_CHROME% equ 0 (
    echo.
    echo [2] Iniciando Chrome...
    if not exist "%CHROME_USER_DATA_DIR%" mkdir "%CHROME_USER_DATA_DIR%"

    start "" "%CHROME_PATH%" --remote-debugging-port=%CHROME_DEBUG_PORT% --user-data-dir="%CHROME_USER_DATA_DIR%" --no-first-run --no-default-browser-check

    echo     Aguardando Chrome iniciar...
    set WAITED=0
    :WAIT_CHROME
    curl -s --connect-timeout 1 "http://localhost:%CHROME_DEBUG_PORT%/json/version" >nul 2>&1
    if %errorlevel% equ 0 goto :CHROME_OK

    set /a WAITED+=1
    echo     Tentativa !WAITED!/10...

    if !WAITED! geq 10 (
        echo     [ERRO] Timeout!
        pause
        exit /b 1
    )

    timeout /t 1 /nobreak >nul
    goto :WAIT_CHROME

    :CHROME_OK
    echo     [OK] Chrome iniciado!
)

echo.
echo [3] Verificando porta %PROXY_PORT% (Proxy)...
netstat -ano | findstr ":%PROXY_PORT%" | findstr "LISTENING" >nul 2>&1
if %errorlevel% equ 0 (
    echo     Porta ocupada - verificando se é Proxy...
    curl -s --connect-timeout 2 "http://localhost:%PROXY_PORT%/json/version" >nul 2>&1
    if !errorlevel! equ 0 (
        echo     [OK] Proxy já está rodando!
        set SKIP_PROXY=1
    ) else (
        echo     [ERRO] Porta ocupada por outro processo!
        echo.
        echo     Deseja matar o processo? (S/N)
        set /p KILL_PROXY="Resposta: "
        if /i "!KILL_PROXY!"=="S" (
            for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":%PROXY_PORT%" ^| findstr "LISTENING"') do (
                echo     Matando PID %%a...
                taskkill /PID %%a /F >nul 2>&1
            )
            timeout /t 2 /nobreak >nul
            set SKIP_PROXY=0
        ) else (
            echo     Operação cancelada
            pause
            exit /b 1
        )
    )
) else (
    echo     Porta livre
    set SKIP_PROXY=0
)

if %SKIP_PROXY% equ 0 (
    echo.
    echo [4] Iniciando Proxy...

    start "Chrome Proxy Service" node "%PROXY_SCRIPT%" !PUBLIC_IP! info

    echo     Aguardando Proxy iniciar...
    set WAITED=0
    :WAIT_PROXY
    curl -s --connect-timeout 1 "http://localhost:%PROXY_PORT%/json/version" >nul 2>&1
    if %errorlevel% equ 0 goto :PROXY_OK

    set /a WAITED+=1
    echo     Tentativa !WAITED!/10...

    if !WAITED! geq 10 (
        echo     [ERRO] Timeout!
        echo     Verifique a janela: Chrome Proxy Service
        pause
        exit /b 1
    )

    timeout /t 1 /nobreak >nul
    goto :WAIT_PROXY

    :PROXY_OK
    echo     [OK] Proxy iniciado!
)

echo.
echo ════════════════════════════════════════════════════════════════
echo   ✅ SUCESSO!
echo ════════════════════════════════════════════════════════════════
echo.
echo Serviços rodando:
echo   Chrome: http://localhost:%CHROME_DEBUG_PORT%
echo   Proxy:  http://!PUBLIC_IP!:%PROXY_PORT%
echo.
echo Próximos passos:
echo   1. Do container: curl http://!PUBLIC_IP!:%PROXY_PORT%/json/version
echo   2. Do container: npm start
echo.

pause
exit /b 0
