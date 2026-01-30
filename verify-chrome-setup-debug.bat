@echo off
REM Debug version - shows every step
chcp 65001 >nul 2>&1
setlocal enabledelayedexpansion

echo.
echo ════════════════════════════════════════════════════════════════════════════
echo   CHROME PROXY SETUP VERIFIER - DEBUG MODE
echo ════════════════════════════════════════════════════════════════════════════
echo.
echo [DEBUG] Script iniciado...
echo [DEBUG] Pressione qualquer tecla para continuar cada etapa
pause

set SCRIPT_DIR=%~dp0
echo [DEBUG] SCRIPT_DIR = %SCRIPT_DIR%
pause

set CONFIG_FILE=%SCRIPT_DIR%config.json
set CHROME_CONFIG_FILE=%SCRIPT_DIR%chrome-config.json
set PROXY_SCRIPT=%SCRIPT_DIR%scripts\chrome-proxy-service.js

echo [DEBUG] CONFIG_FILE = %CONFIG_FILE%
echo [DEBUG] CHROME_CONFIG_FILE = %CHROME_CONFIG_FILE%
echo [DEBUG] PROXY_SCRIPT = %PROXY_SCRIPT%
pause

echo.
echo [1] Verificando arquivos...
echo.

set FILES_OK=1

if exist "%CONFIG_FILE%" (
    echo [OK] config.json encontrado
) else (
    echo [ERRO] config.json NAO encontrado
    set FILES_OK=0
)

if exist "%CHROME_CONFIG_FILE%" (
    echo [OK] chrome-config.json encontrado
) else (
    echo [WARN] chrome-config.json NAO encontrado
)

if exist "%PROXY_SCRIPT%" (
    echo [OK] chrome-proxy-service.js encontrado
) else (
    echo [ERRO] chrome-proxy-service.js NAO encontrado
    set FILES_OK=0
)

echo [DEBUG] FILES_OK = %FILES_OK%
pause

if %FILES_OK% equ 0 (
    echo.
    echo [ERRO] Arquivos criticos faltando!
    echo.
    echo [DEBUG] Saindo com erro...
    pause
    exit /b 1
)

echo.
echo [2] Detectando IP publico...
echo.

set PUBLIC_IP=
for /f "tokens=2 delims=:" %%a in ('ipconfig ^| findstr /C:"IPv4"') do (
    for /f "tokens=1" %%b in ("%%a") do (
        set PUBLIC_IP=%%b
        goto :IP_FOUND
    )
)
:IP_FOUND

if "!PUBLIC_IP!"=="" set PUBLIC_IP=192.168.0.2
echo [INFO] IP detectado: !PUBLIC_IP!
echo [DEBUG] PUBLIC_IP = !PUBLIC_IP!
pause

echo.
echo [3] Validando config.json...
echo.

set CONFIG_OK=1

findstr /C:"\"BROWSER_MODE\": \"wsEndpoint\"" "%CONFIG_FILE%" >nul 2>&1
if %errorlevel% equ 0 (
    echo [OK] BROWSER_MODE correto
) else (
    echo [ERRO] BROWSER_MODE incorreto
    set CONFIG_OK=0
)

findstr /C:"\"CHROME_PROXY_ENABLED\": true" "%CONFIG_FILE%" >nul 2>&1
if %errorlevel% equ 0 (
    echo [OK] CHROME_PROXY_ENABLED correto
) else (
    echo [ERRO] CHROME_PROXY_ENABLED incorreto
    set CONFIG_OK=0
)

echo [DEBUG] CONFIG_OK = %CONFIG_OK%
pause

if %CONFIG_OK% equ 0 (
    echo.
    echo [ERRO] Configuracao invalida!
    echo.
    echo [DEBUG] Saindo com erro...
    pause
    exit /b 1
)

echo.
echo ════════════════════════════════════════════════════════════════════════════
echo   RESULTADO: SUCESSO!
echo ════════════════════════════════════════════════════════════════════════════
echo.
echo [DEBUG] Chegou ao final do script
echo [DEBUG] Pressione qualquer tecla para sair...
pause
echo [DEBUG] Apos pause, vai executar exit /b 0
pause

exit /b 0
