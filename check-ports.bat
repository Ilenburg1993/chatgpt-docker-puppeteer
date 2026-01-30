@echo off
chcp 65001 >nul 2>&1
setlocal enabledelayedexpansion

echo.
echo ════════════════════════════════════════════════════════════════
echo   DIAGNÓSTICO DE PORTAS - Chrome e Proxy
echo ════════════════════════════════════════════════════════════════
echo.

REM Verificar porta 9224 (Chrome)
echo [PORTA 9224 - Chrome Remote Debugging]
netstat -ano | findstr ":9224" | findstr "LISTENING" >nul 2>&1
if %errorlevel% equ 0 (
    echo   Status: OCUPADA
    for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":9224" ^| findstr "LISTENING"') do (
        set PID=%%a
        echo   PID: !PID!
        for /f "tokens=1" %%b in ('tasklist /FI "PID eq !PID!" /NH 2^>nul') do (
            echo   Processo: %%b
        )
    )
) else (
    echo   Status: LIVRE
)
echo.

REM Verificar porta 9224 (Proxy)
echo [PORTA 9224 - Chrome Proxy Service]
netstat -ano | findstr ":9224" | findstr "LISTENING" >nul 2>&1
if %errorlevel% equ 0 (
    echo   Status: OCUPADA
    for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":9224" ^| findstr "LISTENING"') do (
        set PID=%%a
        echo   PID: !PID!
        for /f "tokens=1" %%b in ('tasklist /FI "PID eq !PID!" /NH 2^>nul') do (
            echo   Processo: %%b
        )
    )
) else (
    echo   Status: LIVRE
)
echo.

REM Verificar todos os Chrome rodando
echo [PROCESSOS CHROME ATIVOS]
tasklist | findstr /I "chrome.exe" >nul 2>&1
if %errorlevel% equ 0 (
    tasklist /FI "IMAGENAME eq chrome.exe" /FO TABLE
) else (
    echo   Nenhum processo Chrome encontrado
)
echo.

REM Verificar Node.js (Proxy)
echo [PROCESSOS NODE.JS ATIVOS]
tasklist | findstr /I "node.exe" >nul 2>&1
if %errorlevel% equ 0 (
    tasklist /FI "IMAGENAME eq node.exe" /FO TABLE
) else (
    echo   Nenhum processo Node.js encontrado
)
echo.

echo ════════════════════════════════════════════════════════════════
echo.
echo Pressione qualquer tecla para sair...
pause >nul
