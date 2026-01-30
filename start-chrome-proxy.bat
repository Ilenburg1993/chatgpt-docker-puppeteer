@echo off
REM ============================================================================
REM Configura UTF-8 para exibir caracteres corretamente
chcp 65001 >nul 2>&1

REM  CHROME PROXY LAUNCHER - Consolidated & Production-Ready
REM  Version: 3.0 (2026-01-30)
REM
REM  Purpose:
REM    Inicializa Chrome + Proxy corretamente para ConnectionOrchestrator
REM
REM  Architecture:
REM    Windows Host:
REM      - Chrome (127.0.0.1:9224) - Remote debugging
REM      - Proxy (0.0.0.0:9224) - WebSocket proxy with URL rewriting
REM
REM    Docker Container:
REM      - ConnectionOrchestrator → http://192.168.0.2:9224
REM      - Receives: ws://192.168.0.2:9224/devtools/... (rewritten)
REM
REM  Documentation: DOCUMENTAÇÃO/CHROME_PROXY_SETUP.md
REM ============================================================================

setlocal enabledelayedexpansion

REM ============================================================================
REM  CONFIGURAÇÕES
REM ============================================================================
set CHROME_DEBUG_PORT=9224
set PROXY_PORT=9224
set CHROME_USER_DATA_DIR=%USERPROFILE%\.chrome-debug-profile
set MAX_WAIT_SECONDS=15
set SCRIPT_DIR=%~dp0
set CONFIG_FILE=%SCRIPT_DIR%config.json
set PROXY_SCRIPT=%SCRIPT_DIR%scripts\chrome-proxy-service.js

REM ============================================================================
REM  HEADER
REM ============================================================================
echo.
echo ════════════════════════════════════════════════════════════════════════════
echo   CHROME PROXY LAUNCHER v3.0
echo   Production-Ready Initialization for ConnectionOrchestrator
echo ════════════════════════════════════════════════════════════════════════════
echo.

REM ============================================================================
REM  ETAPA 1: VALIDAÇÃO DE AMBIENTE
REM ============================================================================
echo [ETAPA 1] Validando ambiente...
echo.

REM 1.1 Verificar Node.js
where node >nul 2>&1
if %errorlevel% neq 0 (
    echo [ERRO] Node.js não encontrado!
    echo.
    echo Instale Node.js 20+ de: https://nodejs.org/
    exit /b 1
)
for /f "tokens=*" %%i in ('node --version') do set NODE_VERSION=%%i
echo [OK] Node.js encontrado: %NODE_VERSION%

REM 1.2 Verificar Chrome
set CHROME_PATH=
if exist "C:\Program Files\Google\Chrome\Application\chrome.exe" (
    set "CHROME_PATH=C:\Program Files\Google\Chrome\Application\chrome.exe"
) else if exist "C:\Program Files (x86)\Google\Chrome\Application\chrome.exe" (
    set "CHROME_PATH=C:\Program Files (x86)\Google\Chrome\Application\chrome.exe"
) else if exist "%LOCALAPPDATA%\Google\Chrome\Application\chrome.exe" (
    set "CHROME_PATH=%LOCALAPPDATA%\Google\Chrome\Application\chrome.exe"
)

if not defined CHROME_PATH (
    echo [ERRO] Google Chrome não encontrado!
    echo.
    echo Instale Chrome de: https://www.google.com/chrome/
    exit /b 1
)
echo [OK] Chrome encontrado: %CHROME_PATH%

REM 1.3 Verificar proxy script
if not exist "%PROXY_SCRIPT%" (
    echo [ERRO] Proxy script não encontrado: %PROXY_SCRIPT%
    echo.
    echo O arquivo scripts\chrome-proxy-service.js é necessário.
    exit /b 1
)
echo [OK] Proxy script encontrado

REM 1.4 Auto-detectar IP público
echo.
echo [INFO] Detectando IP público...
set PUBLIC_IP=
for /f "tokens=2 delims=:" %%a in ('ipconfig ^| findstr /C:"IPv4"') do (
    for /f "tokens=1" %%b in ("%%a") do (
        set PUBLIC_IP=%%b
        goto :IP_FOUND
    )
)
:IP_FOUND

if "!PUBLIC_IP!"=="" (
    echo [WARN] Não foi possível detectar IP público automaticamente
    echo [INFO] Usando IP padrão: 192.168.0.2
    set PUBLIC_IP=192.168.0.2
) else (
    echo [OK] IP público detectado: !PUBLIC_IP!
)

REM ============================================================================
REM  ETAPA 2: VALIDAÇÃO DE CONFIGURAÇÃO
REM ============================================================================
echo.
echo [ETAPA 2] Validando configuração do sistema...
echo.

REM 2.1 Verificar se config.json existe
if not exist "%CONFIG_FILE%" (
    echo [WARN] config.json não encontrado: %CONFIG_FILE%
    echo [INFO] Continuando com configurações padrão
    goto :SKIP_CONFIG_VALIDATION
)

REM 2.2 Validar BROWSER_MODE (deve ser wsEndpoint)
findstr /C:"\"BROWSER_MODE\": \"wsEndpoint\"" "%CONFIG_FILE%" >nul
if %errorlevel% neq 0 (
    echo [WARN] BROWSER_MODE não está configurado como "wsEndpoint" em config.json
    echo [INFO] ConnectionOrchestrator pode ter dificuldade para conectar
    echo [INFO] Recomendado: BROWSER_MODE: "wsEndpoint"
) else (
    echo [OK] BROWSER_MODE: wsEndpoint
)

REM 2.3 Validar DEBUG_PORT (deve apontar para proxy 9224)
findstr /C:"\"DEBUG_PORT\": \"http://!PUBLIC_IP!:%PROXY_PORT%\"" "%CONFIG_FILE%" >nul
if %errorlevel% neq 0 (
    findstr /C:"\"DEBUG_PORT\":" "%CONFIG_FILE%" >nul
    if %errorlevel% equ 0 (
        echo [WARN] DEBUG_PORT em config.json pode não apontar para proxy
        echo [INFO] Esperado: "DEBUG_PORT": "http://!PUBLIC_IP!:%PROXY_PORT%"
    )
) else (
    echo [OK] DEBUG_PORT: http://!PUBLIC_IP!:%PROXY_PORT%
)

REM 2.4 Validar CHROME_PROXY_ENABLED
findstr /C:"\"CHROME_PROXY_ENABLED\": true" "%CONFIG_FILE%" >nul
if %errorlevel% neq 0 (
    echo [WARN] CHROME_PROXY_ENABLED não está habilitado em config.json
    echo [INFO] Proxy funcionará, mas config pode estar desatualizado
) else (
    echo [OK] CHROME_PROXY_ENABLED: true
)

:SKIP_CONFIG_VALIDATION

REM ============================================================================
REM  ETAPA 3: INICIALIZAR CHROME
REM ============================================================================
echo.
echo [ETAPA 3] Inicializando Chrome Remote Debugging...
echo.

REM 3.1 Verificar se Chrome já está rodando
curl -s --connect-timeout 2 "http://localhost:%CHROME_DEBUG_PORT%/json/version" >nul 2>&1
if %errorlevel% equ 0 (
    echo [OK] Chrome já está rodando com remote debugging na porta %CHROME_DEBUG_PORT%
    goto :SKIP_CHROME_START
)

REM 3.2 Criar diretório de user data
if not exist "%CHROME_USER_DATA_DIR%" (
    echo [INFO] Criando diretório de perfil: %CHROME_USER_DATA_DIR%
    mkdir "%CHROME_USER_DATA_DIR%"
)

REM 3.3 Iniciar Chrome
echo [INFO] Iniciando Chrome com remote debugging...
start "" "%CHROME_PATH%" ^
    --remote-debugging-port=%CHROME_DEBUG_PORT% ^
    --user-data-dir="%CHROME_USER_DATA_DIR%" ^
    --no-first-run ^
    --no-default-browser-check ^
    --disable-features=TranslateUI ^
    --disable-sync ^
    --disable-background-networking

REM 3.4 Aguardar Chrome iniciar
echo [INFO] Aguardando Chrome iniciar (max %MAX_WAIT_SECONDS%s)...
set WAITED=0
:WAIT_CHROME_LOOP
curl -s --connect-timeout 1 "http://localhost:%CHROME_DEBUG_PORT%/json/version" >nul 2>&1
if %errorlevel% equ 0 goto :CHROME_READY

set /a WAITED+=1
if %WAITED% geq %MAX_WAIT_SECONDS% (
    echo [ERRO] Timeout: Chrome não iniciou em %MAX_WAIT_SECONDS%s
    echo.
    echo Troubleshooting:
    echo   1. Verifique se porta %CHROME_DEBUG_PORT% está livre: netstat -ano ^| findstr :%CHROME_DEBUG_PORT%
    echo   2. Tente fechar Chrome manualmente: taskkill /IM chrome.exe /F
    echo   3. Execute novamente este script
    exit /b 1
)

timeout /t 1 /nobreak >nul
goto :WAIT_CHROME_LOOP

:CHROME_READY
echo [OK] Chrome iniciado com sucesso!

:SKIP_CHROME_START

REM ============================================================================
REM  ETAPA 4: INICIALIZAR PROXY
REM ============================================================================
echo.
echo [ETAPA 4] Inicializando Chrome Proxy Service...
echo.

REM 4.1 Verificar se proxy já está rodando
curl -s --connect-timeout 2 "http://localhost:%PROXY_PORT%/json/version" >nul 2>&1
if %errorlevel% equ 0 (
    echo [OK] Proxy já está rodando na porta %PROXY_PORT%
    goto :SKIP_PROXY_START
)

REM 4.2 Iniciar proxy
echo [INFO] Iniciando Chrome Proxy Service...
echo [INFO] Comando: node "%PROXY_SCRIPT%" !PUBLIC_IP! info
start "Chrome Proxy Service" node "%PROXY_SCRIPT%" !PUBLIC_IP! info

REM 4.3 Aguardar proxy iniciar
echo [INFO] Aguardando proxy iniciar (max %MAX_WAIT_SECONDS%s)...
set WAITED=0
:WAIT_PROXY_LOOP
curl -s --connect-timeout 1 "http://localhost:%PROXY_PORT%/json/version" >nul 2>&1
if %errorlevel% equ 0 goto :PROXY_READY

set /a WAITED+=1
if %WAITED% geq %MAX_WAIT_SECONDS% (
    echo [ERRO] Timeout: Proxy não iniciou em %MAX_WAIT_SECONDS%s
    echo.
    echo Troubleshooting:
    echo   1. Verifique se porta %PROXY_PORT% está livre: netstat -ano ^| findstr :%PROXY_PORT%
    echo   2. Verifique a janela "Chrome Proxy Service" para erros
    echo   3. Teste manualmente: node "%PROXY_SCRIPT%" !PUBLIC_IP! debug
    exit /b 1
)

timeout /t 1 /nobreak >nul
goto :WAIT_PROXY_LOOP

:PROXY_READY
echo [OK] Proxy iniciado com sucesso!

:SKIP_PROXY_START

REM ============================================================================
REM  ETAPA 5: HEALTH CHECKS
REM ============================================================================
echo.
echo [ETAPA 5] Executando health checks...
echo.

REM 5.1 Testar Chrome direto
echo [INFO] Testando Chrome (porta %CHROME_DEBUG_PORT%)...
curl -s "http://localhost:%CHROME_DEBUG_PORT%/json/version" > nul 2>&1
if %errorlevel% equ 0 (
    echo [OK] Chrome respondendo em http://localhost:%CHROME_DEBUG_PORT%
) else (
    echo [ERRO] Chrome não está respondendo!
    goto :HEALTH_CHECK_FAILED
)

REM 5.2 Testar Proxy local
echo [INFO] Testando Proxy local (porta %PROXY_PORT%)...
curl -s "http://localhost:%PROXY_PORT%/json/version" > nul 2>&1
if %errorlevel% equ 0 (
    echo [OK] Proxy respondendo em http://localhost:%PROXY_PORT%
) else (
    echo [ERRO] Proxy não está respondendo localmente!
    goto :HEALTH_CHECK_FAILED
)

REM 5.3 Testar Proxy via IP público
echo [INFO] Testando Proxy via IP público (!PUBLIC_IP!:%PROXY_PORT%)...
curl -s "http://!PUBLIC_IP!:%PROXY_PORT%/json/version" > nul 2>&1
if %errorlevel% equ 0 (
    echo [OK] Proxy respondendo em http://!PUBLIC_IP!:%PROXY_PORT%
) else (
    echo [WARN] Proxy não está acessível via IP público
    echo [INFO] Pode ser necessário configurar firewall
    echo [INFO] Execute: netsh advfirewall firewall add rule name="Chrome Proxy 9224" dir=in action=allow protocol=TCP localport=%PROXY_PORT%
)

REM 5.4 Validar URL rewriting
echo [INFO] Validando URL rewriting...
for /f "delims=" %%i in ('curl -s "http://localhost:%PROXY_PORT%/json/version"') do set PROXY_RESPONSE=%%i
echo !PROXY_RESPONSE! | findstr /C:"!PUBLIC_IP!:%PROXY_PORT%" >nul
if %errorlevel% equ 0 (
    echo [OK] URL rewriting funcionando (localhost → !PUBLIC_IP!)
) else (
    echo [WARN] URL rewriting pode não estar funcionando corretamente
    echo [INFO] WebSocket URL deve conter !PUBLIC_IP!:%PROXY_PORT%
)

REM ============================================================================
REM  SUCESSO
REM ============================================================================
echo.
echo ════════════════════════════════════════════════════════════════════════════
echo   ✅ SISTEMA INICIALIZADO COM SUCESSO!
echo ════════════════════════════════════════════════════════════════════════════
echo.
echo [CONFIGURAÇÃO]
echo   • IP Público:              !PUBLIC_IP!
echo   • Chrome Debug Port:       %CHROME_DEBUG_PORT%
echo   • Proxy Port:              %PROXY_PORT%
echo   • Browser Mode:            wsEndpoint
echo.
echo [SERVIÇOS ATIVOS]
echo   • Chrome Remote Debugging: http://localhost:%CHROME_DEBUG_PORT%
echo   • Chrome Proxy Service:    http://!PUBLIC_IP!:%PROXY_PORT%
echo   • WebSocket Endpoint:      ws://!PUBLIC_IP!:%PROXY_PORT%/devtools/...
echo.
echo [ENDPOINTS DE TESTE]
echo   • Local:  curl http://localhost:%PROXY_PORT%/json/version
echo   • Remote: curl http://!PUBLIC_IP!:%PROXY_PORT%/json/version
echo.
echo [TESTE DO CONTAINER]
echo   Execute do container Docker:
echo     curl http://!PUBLIC_IP!:%PROXY_PORT%/json/version
echo.
echo   Deve retornar JSON com:
echo     "webSocketDebuggerUrl": "ws://!PUBLIC_IP!:%PROXY_PORT%/devtools/browser/..."
echo.
echo [CONNECTIONORCHESTRATOR]
echo   O ConnectionOrchestrator tentará conectar na seguinte ordem:
echo     1. !PUBLIC_IP!:%PROXY_PORT% (PROXY - PREFERENCIAL)
echo     2. host.docker.internal:%PROXY_PORT% (PROXY via Docker DNS)
echo     3. host.docker.internal:%CHROME_DEBUG_PORT% (DIRETO)
echo     4. Outros fallbacks...
echo.
echo [PRÓXIMOS PASSOS]
echo   1. Teste do container: curl http://!PUBLIC_IP!:%PROXY_PORT%/json/version
echo   2. Inicie o sistema:   npm start (ou node src/main.js)
echo   3. Verifique logs:     Procure por "Conectado via Chrome Proxy Service"
echo.
echo [PARAR SERVIÇOS]
echo   1. Feche a janela "Chrome Proxy Service"
echo   2. Feche o Chrome (ou deixe rodando para próximo uso)
echo.
echo Documentação completa: DOCUMENTAÇÃO\CHROME_PROXY_SETUP.md
echo.

exit /b 0

REM ============================================================================
REM  ERROR HANDLERS
REM ============================================================================
:HEALTH_CHECK_FAILED
echo.
echo [ERRO] Health checks falharam!
echo.
echo Troubleshooting:
echo   1. Verifique se Chrome está rodando: tasklist ^| findstr chrome.exe
echo   2. Verifique se Proxy está rodando: netstat -ano ^| findstr :%PROXY_PORT%
echo   3. Teste manualmente:
echo        curl http://localhost:%CHROME_DEBUG_PORT%/json/version
echo        curl http://localhost:%PROXY_PORT%/json/version
echo   4. Verifique firewall: netsh advfirewall show allprofiles
echo.
exit /b 1
