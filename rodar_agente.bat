@echo off
setlocal ENABLEEXTENSIONS ENABLEDELAYEDEXPANSION

REM ============================================================================
REM  AGENTE CHATGPT - SUPERVISOR DE INICIALIZAÇÃO (ROOT VERSION)
REM ============================================================================
REM  Este arquivo deve ficar na PASTA RAIZ do projeto (junto com index.js).
REM ============================================================================

REM --- Configurações ---
set "WINDOW_TITLE=Agente ChatGPT [Supervisor]"
set "NODE_CMD=node"
set "ENTRY_POINT=index.js"
set "WRAPPER_LOG_FILE=logs\wrapper_boot.log"

REM --- Watchdog Config ---
set "AUTO_RESTART=1"
set "RESTART_DELAY=10"

REM ============================================================================
REM  1. PREPARAÇÃO DO AMBIENTE
REM ============================================================================

chcp 65001 >nul
title %WINDOW_TITLE%

REM --- Navegação de Diretório (MODIFICADO PARA RAIZ) ---
REM %~dp0 expande para o caminho onde este arquivo .bat está.
set "PROJECT_ROOT=%~dp0"

REM Garante que o CMD esteja rodando na raiz do projeto, mesmo se executado como Admin
cd /d "%PROJECT_ROOT%"

REM Garante pasta de logs
if not exist "logs" mkdir "logs"

call :LOG "INFO" "Supervisor iniciado na raiz: %PROJECT_ROOT%"

REM ============================================================================
REM  2. VERIFICAÇÕES PRÉ-VOO
REM ============================================================================

REM Check: Node.js
where %NODE_CMD% >nul 2>&1
if errorlevel 1 (
    call :LOG "FATAL" "Node.js nao encontrado no PATH."
    cls
    color 0C
    echo [X] ERRO FATAL: Node.js nao encontrado.
    echo     Instale em: https://nodejs.org/
    goto ERROR_EXIT
)

REM Check: Entry Point
if not exist "%ENTRY_POINT%" (
    call :LOG "FATAL" "Arquivo %ENTRY_POINT% nao encontrado."
    cls
    color 0C
    echo [X] ERRO FATAL: %ENTRY_POINT% nao encontrado.
    echo     Este arquivo .bat esta na pasta correta? Ele deve estar junto com index.js.
    goto ERROR_EXIT
)

REM Check: Cria Pastas de Dados
for %%d in (fila respostas tmp src scripts) do (
    if not exist "%%d" mkdir "%%d"
)

REM Check: Dependências
if not exist "node_modules" (
    call :LOG "WARN" "node_modules ausente. Instalando..."
    cls
    color 0E
    echo [!] Dependencias ausentes. Instalando via npm...
    call npm install --omit=dev
    if errorlevel 1 (
        call :LOG "FATAL" "Falha no npm install."
        color 0C
        echo [X] Falha na instalacao.
        goto ERROR_EXIT
    )
)

REM ============================================================================
REM  3. LOOP DE EXECUÇÃO (WATCHDOG)
REM ============================================================================

:START_LOOP
cls
color 0A
echo ============================================================
echo  AGENTE CHATGPT - WATCHDOG ATIVO
echo ============================================================
echo  [INFO] Raiz:     %PROJECT_ROOT%
echo  [INFO] Logs:     logs\agente_current.log
echo  [INFO] Status:   ONLINE
echo ============================================================
echo.

call :LOG "INFO" "Iniciando processo Node.js..."

"%NODE_CMD%" "%ENTRY_POINT%"
set "EXIT_CODE=%ERRORLEVEL%"

echo.
echo ============================================================

if %EXIT_CODE% EQU 0 (
    call :LOG "INFO" "Processo finalizado voluntariamente."
    color 07
    echo [OK] Agente desligado corretamente.
    goto CLEAN_EXIT
) else (
    call :LOG "ERROR" "CRASH DETECTADO! Exit Code: %EXIT_CODE%"
    color 0C
    echo [X] CRASH DETECTADO (Erro %EXIT_CODE%)
    
    if "%AUTO_RESTART%"=="1" (
        echo.
        echo [!] REINICIANDO EM %RESTART_DELAY% SEGUNDOS...
        call :LOG "WARN" "Agendando reinicio..."
        timeout /t %RESTART_DELAY%
        goto START_LOOP
    ) else (
        goto ERROR_EXIT
    )
)

REM ============================================================================
REM  FUNÇÕES AUXILIARES
REM ============================================================================

:LOG
set "TIMESTAMP=%DATE% %TIME%"
set "TIMESTAMP=%TIMESTAMP: =0%"
echo [%TIMESTAMP%] [%~1] %~2 >> "%WRAPPER_LOG_FILE%"
exit /b 0

:ERROR_EXIT
echo.
echo Pressione qualquer tecla para sair...
pause >nul
exit /b 1

:CLEAN_EXIT
timeout /t 3 >nul
exit /b 0