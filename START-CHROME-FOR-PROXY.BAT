@echo off
REM ============================================================================
REM START-CHROME-FOR-PROXY.BAT
REM Versão: 2.0 (2026-02-01) - Consolidado para integração com Chrome Proxy
REM ============================================================================
REM
REM Propósito:
REM   Inicia Chrome no Windows Host com remote debugging na porta 9225
REM   Preparado para uso com Chrome Proxy Service (porta 9224)
REM
REM Arquitetura:
REM   Chrome (localhost:9225) ← Proxy (0.0.0.0:9224) ← Container
REM
REM Uso:
REM   1. Execute este script no Windows Host
REM   2. Valide: curl http://localhost:9225/json/version
REM   3. Inicie o proxy: node scripts/chrome-proxy-service.js
REM   4. Inicie o sistema: npm run daemon:start
REM
REM Configuração:
REM   CHROME_PORT=9225 (padrão, pode ser alterado)
REM   Profile isolado: %TEMP%\chrome-debug-9225
REM
REM ============================================================================

chcp 65001 >nul 2>&1
setlocal enabledelayedexpansion

REM ===== CONFIGURAÇÃO =====
if defined CHROME_PORT (
    set DEBUG_PORT=%CHROME_PORT%
) else (
    set DEBUG_PORT=9225
)

set PROFILE_DIR=%TEMP%\chrome-debug-%DEBUG_PORT%
set MAX_RETRIES=10
set RETRY_DELAY=1

echo.
echo ═══════════════════════════════════════════════════════════
echo   CHROME LAUNCHER - Proxy Integration Ready
echo ═══════════════════════════════════════════════════════════
echo.
echo Configuração:
echo   Porta Chrome:      %DEBUG_PORT%
echo   Profile Dir:       %PROFILE_DIR%
echo   Porta Proxy:       9224 (inicie separadamente)
echo.

REM ===== LOCALIZAR CHROME =====
echo [1/5] Localizando Chrome...

set CHROME_PATH=
if exist "C:\Program Files\Google\Chrome\Application\chrome.exe" (
    set "CHROME_PATH=C:\Program Files\Google\Chrome\Application\chrome.exe"
    echo       Encontrado: Program Files
) else if exist "C:\Program Files (x86)\Google\Chrome\Application\chrome.exe" (
    set "CHROME_PATH=C:\Program Files (x86)\Google\Chrome\Application\chrome.exe"
    echo       Encontrado: Program Files (x86)
) else if exist "%LOCALAPPDATA%\Google\Chrome\Application\chrome.exe" (
    set "CHROME_PATH=%LOCALAPPDATA%\Google\Chrome\Application\chrome.exe"
    echo       Encontrado: LocalAppData
)

if not defined CHROME_PATH (
    echo.
    echo [ERRO] Chrome não encontrado!
    echo.
    echo Locais verificados:
    echo   - C:\Program Files\Google\Chrome\Application\chrome.exe
    echo   - C:\Program Files (x86)\Google\Chrome\Application\chrome.exe
    echo   - %%LOCALAPPDATA%%\Google\Chrome\Application\chrome.exe
    echo.
    echo Solução: Instale Chrome ou defina manualmente:
    echo   set CHROME_PATH="C:\caminho\para\chrome.exe"
    echo.
    pause
    exit /b 1
)

echo       [OK] %CHROME_PATH%

REM ===== VERIFICAR PORTA =====
echo.
echo [2/5] Verificando porta %DEBUG_PORT%...

netstat -ano | findstr ":%DEBUG_PORT%" | findstr "LISTENING" >nul 2>&1
if %errorlevel% equ 0 (
    echo       Porta ocupada - verificando se é Chrome...

    curl -s --connect-timeout 2 "http://localhost:%DEBUG_PORT%/json/version" >nul 2>&1
    if !errorlevel! equ 0 (
        echo.
        echo       [OK] Chrome já está rodando com DevTools!
        echo.
        echo ═══════════════════════════════════════════════════════════
        echo   ✅ CHROME PRONTO PARA USO
        echo ═══════════════════════════════════════════════════════════
        echo.
        echo Validação:
        curl -s "http://localhost:%DEBUG_PORT%/json/version"
        echo.
        echo.
        echo Próximos passos:
        echo   1. Inicie o proxy: node scripts\chrome-proxy-service.js
        echo   2. Inicie o sistema: npm run daemon:start
        echo.
        pause
        exit /b 0
    ) else (
        echo       [AVISO] Porta ocupada por outro processo!
        echo.

        for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":%DEBUG_PORT%" ^| findstr "LISTENING"') do (
            set PID=%%a
            echo       PID detectado: %%a

            for /f "tokens=1" %%b in ('tasklist /FI "PID eq %%a" /NH 2^>nul ^| findstr /V "INFO:"') do (
                echo       Processo: %%b
                set PROCESS_NAME=%%b
            )
        )

        echo.
        choice /C SN /M "Deseja encerrar o processo e continuar (S/N)"
        if errorlevel 2 (
            echo       Operação cancelada pelo usuário
            exit /b 1
        )

        echo       Encerrando processo PID !PID!...
        taskkill /PID !PID! /F >nul 2>&1
        if !errorlevel! equ 0 (
            echo       [OK] Processo encerrado
            timeout /t 2 /nobreak >nul
        ) else (
            echo       [ERRO] Falha ao encerrar. Execute como Administrador.
            pause
            exit /b 1
        )
    )
) else (
    echo       [OK] Porta livre
)

REM ===== CRIAR PROFILE DIR =====
echo.
echo [3/5] Preparando profile isolado...

if not exist "%PROFILE_DIR%" (
    mkdir "%PROFILE_DIR%" 2>nul
    if !errorlevel! equ 0 (
        echo       [OK] Criado: %PROFILE_DIR%
    ) else (
        echo       [ERRO] Falha ao criar diretório
        pause
        exit /b 1
    )
) else (
    echo       [OK] Diretório existe: %PROFILE_DIR%
)

REM ===== INICIAR CHROME =====
echo.
echo [4/5] Iniciando Chrome com DevTools...

start "" "%CHROME_PATH%" ^
    --remote-debugging-port=%DEBUG_PORT% ^
    --user-data-dir="%PROFILE_DIR%" ^
    --no-first-run ^
    --no-default-browser-check ^
    --disable-background-networking ^
    --disable-default-apps ^
    --disable-extensions ^
    --disable-popup-blocking ^
    --disable-component-update ^
    --enable-logging ^
    --v=1

if !errorlevel! neq 0 (
    echo       [ERRO] Falha ao iniciar Chrome
    pause
    exit /b 1
)

echo       [OK] Processo iniciado

REM ===== VALIDAR DEVTOOLS =====
echo.
echo [5/5] Validando DevTools endpoint...

set RETRY_COUNT=0
:WAIT_LOOP

curl -s --connect-timeout 1 "http://localhost:%DEBUG_PORT%/json/version" >nul 2>&1
if !errorlevel! equ 0 goto :CHROME_READY

set /a RETRY_COUNT+=1
echo       Tentativa !RETRY_COUNT!/%MAX_RETRIES%...

if !RETRY_COUNT! geq %MAX_RETRIES% (
    echo.
    echo [ERRO] Timeout esperando Chrome inicializar!
    echo.
    echo Troubleshooting:
    echo   1. Verifique se porta %DEBUG_PORT% está livre: netstat -ano ^| findstr ":%DEBUG_PORT%"
    echo   2. Verifique firewall/antivírus
    echo   3. Tente porta alternativa: set CHROME_PORT=9226
    echo   4. Execute como Administrador
    echo.
    pause
    exit /b 1
)

timeout /t %RETRY_DELAY% /nobreak >nul
goto :WAIT_LOOP

:CHROME_READY
echo       [OK] DevTools endpoint online!

REM ===== VALIDAÇÃO COMPLETA =====
echo.
echo ═══════════════════════════════════════════════════════════
echo   ✅ CHROME INICIADO COM SUCESSO
echo ═══════════════════════════════════════════════════════════
echo.
echo Configuração:
echo   Porta DevTools:    %DEBUG_PORT%
echo   Profile:           %PROFILE_DIR%
echo   Endpoint:          http://localhost:%DEBUG_PORT%
echo.
echo Validação (JSON):
curl -s "http://localhost:%DEBUG_PORT%/json/version"
echo.
echo.
echo ═══════════════════════════════════════════════════════════
echo   PRÓXIMOS PASSOS
echo ═══════════════════════════════════════════════════════════
echo.
echo 1. Validar Chrome manualmente:
echo    curl http://localhost:%DEBUG_PORT%/json/version
echo.
echo 2. Iniciar Chrome Proxy Service (Terminal 2):
echo    node scripts\chrome-proxy-service.js
echo.
echo 3. Validar Proxy (após iniciar):
echo    curl http://192.168.0.2:9224/health
echo.
echo 4. Iniciar sistema (após proxy online):
echo    npm run daemon:start
echo.
echo 5. Validar sistema completo:
echo    make health
echo.
echo ═══════════════════════════════════════════════════════════
echo.
echo Mantenha esta janela aberta (Chrome está rodando)
echo Pressione qualquer tecla para fechar (isso encerrará Chrome)
echo.
pause
