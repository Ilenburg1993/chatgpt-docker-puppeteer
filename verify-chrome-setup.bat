@echo off
REM ============================================================================
REM  CHROME PROXY SETUP VERIFIER
REM  Version: 1.1 (2026-01-30) - Fixed encoding and syntax errors
REM
REM  Purpose: Diagnostica e valida configuracao Chrome Proxy sem iniciar servicos
REM ============================================================================

REM Configura UTF-8 para exibir caracteres corretamente
chcp 65001 >nul 2>&1

setlocal enabledelayedexpansion

set SCRIPT_DIR=%~dp0
set CONFIG_FILE=%SCRIPT_DIR%config.json
set CHROME_CONFIG_FILE=%SCRIPT_DIR%chrome-config.json
set PROXY_SCRIPT=%SCRIPT_DIR%scripts\chrome-proxy-service.js

echo.
echo ════════════════════════════════════════════════════════════════════════════
echo   CHROME PROXY SETUP VERIFIER
echo ════════════════════════════════════════════════════════════════════════════
echo.

REM ============================================================================
REM  1. ARQUIVOS DE CONFIGURACAO
REM ============================================================================
echo [1] Verificando arquivos de configuracao...
echo.

set FILES_OK=1

if exist "%CONFIG_FILE%" (
    echo [OK] config.json encontrado
) else (
    echo [ERRO] config.json NAO encontrado: %CONFIG_FILE%
    set FILES_OK=0
)

if exist "%CHROME_CONFIG_FILE%" (
    echo [OK] chrome-config.json encontrado
) else (
    echo [WARN] chrome-config.json NAO encontrado: %CHROME_CONFIG_FILE%
    echo [INFO] Arquivo opcional, mas recomendado
)

if exist "%PROXY_SCRIPT%" (
    echo [OK] chrome-proxy-service.js encontrado
) else (
    echo [ERRO] chrome-proxy-service.js NAO encontrado: %PROXY_SCRIPT%
    set FILES_OK=0
)

if %FILES_OK% equ 0 (
    echo.
    echo [ERRO] Arquivos criticos faltando! Sistema nao funcionara.
    echo.
    pause
    exit /b 1
)

REM ============================================================================
REM  2. VALIDACAO DE config.json
REM ============================================================================
echo.
echo [2] Validando config.json...
echo.

REM Auto-detectar IP publico
set PUBLIC_IP=
for /f "tokens=2 delims=:" %%a in ('ipconfig ^| findstr /C:"IPv4"') do (
    for /f "tokens=1" %%b in ("%%a") do (
        set PUBLIC_IP=%%b
        goto :IP_FOUND
    )
)
:IP_FOUND
if "!PUBLIC_IP!"=="" set PUBLIC_IP=192.168.0.2
echo [INFO] IP publico detectado: !PUBLIC_IP!
echo.

set CONFIG_OK=1

REM Verificar BROWSER_MODE
findstr /C:"\"BROWSER_MODE\": \"wsEndpoint\"" "%CONFIG_FILE%" >nul 2>&1
if %errorlevel% equ 0 (
    echo [OK] BROWSER_MODE: "wsEndpoint"
) else (
    echo [ERRO] BROWSER_MODE nao e "wsEndpoint"
    echo [INFO] Esperado: "BROWSER_MODE": "wsEndpoint"
    set CONFIG_OK=0
)

REM Verificar DEBUG_PORT
findstr /C:"\"DEBUG_PORT\"" "%CONFIG_FILE%" >nul 2>&1
if %errorlevel% equ 0 (
    findstr /C:"\"DEBUG_PORT\": \"http://!PUBLIC_IP!:9224\"" "%CONFIG_FILE%" >nul 2>&1
    if !errorlevel! equ 0 (
        echo [OK] DEBUG_PORT: "http://!PUBLIC_IP!:9224"
    ) else (
        echo [WARN] DEBUG_PORT pode nao apontar para !PUBLIC_IP!:9224
        set CONFIG_OK=0
    )
) else (
    echo [ERRO] DEBUG_PORT nao encontrado em config.json
    set CONFIG_OK=0
)

REM Verificar CHROME_PROXY_ENABLED
findstr /C:"\"CHROME_PROXY_ENABLED\": true" "%CONFIG_FILE%" >nul 2>&1
if %errorlevel% equ 0 (
    echo [OK] CHROME_PROXY_ENABLED: true
) else (
    echo [ERRO] CHROME_PROXY_ENABLED nao esta habilitado
    echo [INFO] Esperado: "CHROME_PROXY_ENABLED": true
    set CONFIG_OK=0
)

REM Verificar CHROME_PROXY_PORT
findstr /C:"\"CHROME_PROXY_PORT\": 9224" "%CONFIG_FILE%" >nul 2>&1
if %errorlevel% equ 0 (
    echo [OK] CHROME_PROXY_PORT: 9224
) else (
    echo [ERRO] CHROME_PROXY_PORT nao e 9224
    echo [INFO] Esperado: "CHROME_PROXY_PORT": 9224
    set CONFIG_OK=0
)

REM Verificar ALLOW_BROWSER_FALLBACK
findstr /C:"\"ALLOW_BROWSER_FALLBACK\": true" "%CONFIG_FILE%" >nul 2>&1
if %errorlevel% equ 0 (
    echo [OK] ALLOW_BROWSER_FALLBACK: true
) else (
    echo [WARN] ALLOW_BROWSER_FALLBACK nao esta habilitado
    echo [INFO] Recomendado: "ALLOW_BROWSER_FALLBACK": true
)

if %CONFIG_OK% equ 0 (
    echo.
    echo [ERRO] config.json tem configuracoes incorretas!
    echo [INFO] Edite manualmente ou regenere com scripts corretos
    echo.
    pause
    exit /b 1
)

REM ============================================================================
REM  3. VALIDACAO DE chrome-config.json (OPCIONAL)
REM ============================================================================
if exist "%CHROME_CONFIG_FILE%" (
    echo.
    echo [3] Validando chrome-config.json...
    echo.

    findstr /C:"\"mode\": \"wsEndpoint\"" "%CHROME_CONFIG_FILE%" >nul 2>&1
    if %errorlevel% equ 0 (
        echo [OK] connection.mode: "wsEndpoint"
    ) else (
        echo [WARN] connection.mode nao e "wsEndpoint"
    )

    findstr /C:"\"enabled\": true" "%CHROME_CONFIG_FILE%" >nul 2>&1
    if %errorlevel% equ 0 (
        echo [OK] chromeProxy.enabled: true
    ) else (
        echo [WARN] chromeProxy.enabled nao e true
    )
)

REM ============================================================================
REM  4. PORTAS E SERVICOS
REM ============================================================================
echo.
echo [4] Verificando portas e servicos...
echo.

REM Verificar Browser externo (detalhe operacional remoto)
REM (Não mencionar porta 9224 no contrato; sistema usa endpoint container-facing 9224)

REM Verificar Proxy (9224)
netstat -ano | findstr ":9224" >nul 2>&1
if %errorlevel% equ 0 (
    echo [OK] Porta 9224 Proxy em uso
) else (
    echo [INFO] Porta 9224 Proxy livre - Proxy nao esta rodando
)

REM ============================================================================
REM  5. TESTE DE CONECTIVIDADE (SE SERVICOS ESTIVEREM RODANDO)
REM ============================================================================
echo.
echo [5] Testando conectividade se servicos estiverem ativos...
echo.

REM (Verificações operacionais do browser devem usar o endpoint proxy 9224 quando aplicável)

curl -s --connect-timeout 2 "http://localhost:9224/json/version" >nul 2>&1
if %errorlevel% equ 0 (
    echo [OK] Proxy respondendo em http://localhost:9224

    REM Verificar URL rewriting
    for /f "delims=" %%i in ('curl -s "http://localhost:9224/json/version" 2^>nul') do set PROXY_RESPONSE=%%i
    if defined PROXY_RESPONSE (
        echo !PROXY_RESPONSE! | findstr /C:"!PUBLIC_IP!:9224" >nul 2>&1
        if !errorlevel! equ 0 (
            echo [OK] URL rewriting funcionando localhost para !PUBLIC_IP!
        ) else (
            echo [WARN] URL rewriting pode nao estar funcionando
        )
    )
) else (
    echo [INFO] Proxy nao esta respondendo normal se nao iniciado
)

REM ============================================================================
REM  RESULTADO FINAL
REM ============================================================================
echo.
echo ════════════════════════════════════════════════════════════════════════════
echo   RESULTADO DA VERIFICACAO
echo ════════════════════════════════════════════════════════════════════════════
echo.

if %FILES_OK% equ 1 if %CONFIG_OK% equ 1 (
    echo [OK] CONFIGURACAO VALIDA!
    echo.
    echo Proximos passos:
    echo   1. Inicie os servicos:  start-chrome-proxy.bat
    echo   2. Teste do container:  curl http://!PUBLIC_IP!:9224/json/version
    echo   3. Inicie o sistema:    npm start
    echo.
) else (
    echo [ERRO] CONFIGURACAO INVALIDA!
    echo.
    echo Corrija os erros acima antes de iniciar o sistema.
    echo.
    echo Documentacao: DOCUMENTACAO\CHROME_PROXY_SETUP.md
    echo.
)

echo.
pause
exit /b 0
