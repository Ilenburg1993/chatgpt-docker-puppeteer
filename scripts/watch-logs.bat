@echo off
REM ============================================================================
REM  WATCH-LOGS - Visualização de logs em tempo real com agregação
REM  Uso: watch-logs.bat [filtro]
REM  Filtro opcional: error, warn, info, debug
REM ============================================================================

setlocal enabledelayedexpansion

cd /d "%~dp0.."

set FILTER=%~1

echo ============================================================
echo  WATCH-LOGS - Monitoramento em Tempo Real
echo ============================================================
echo.

if "%FILTER%"=="" (
    echo Modo: TODOS os logs
    echo Pressione Ctrl+C para sair
    echo.
    timeout /t 2 >nul
    call npx pm2 logs --raw --timestamp
) else (
    echo Modo: Filtro '%FILTER%'
    echo Pressione Ctrl+C para sair
    echo.
    timeout /t 2 >nul
    call npx pm2 logs --raw --timestamp | findstr /i %FILTER%
)

exit /b 0
