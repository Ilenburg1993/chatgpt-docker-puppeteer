@echo off
REM ============================================================================
REM  WATCH-LOGS v3.0 - Visualização de logs em tempo real com agregação
REM  Version: 3.0 (2026-01-21) - Enhanced filtering & error handling
REM  Uso: watch-logs.bat [filtro]
REM  Filtro opcional: error, warn, info, debug
REM ============================================================================

setlocal enabledelayedexpansion

cd /d "%~dp0.."

REM Check PM2 availability
where pm2 >nul 2>&1
if errorlevel 1 (
    echo [FAIL] PM2 not found!
    echo [HINT] Install with: npm install -g pm2
    exit /b 1
)

set FILTER=%~1

echo ============================================================
echo  WATCH-LOGS v3.0 - Monitoramento em Tempo Real
echo ============================================================
echo.

if "%FILTER%"=="" (
    echo Modo: TODOS os logs ^(100 linhas de contexto^)
    echo Filtros disponiveis: error, warn, info, debug
    echo Pressione Ctrl+C para sair
    echo.
    timeout /t 2 >nul
    call npx pm2 logs --raw --timestamp --lines 100
) else (
    if /i "%FILTER%"=="error" (
        echo [91mModo: Filtrando apenas ERRORs[0m
    ) else if /i "%FILTER%"=="warn" (
        echo [93mModo: Filtrando apenas WARNINGs[0m
    ) else if /i "%FILTER%"=="info" (
        echo [92mModo: Filtrando apenas INFOs[0m
    ) else if /i "%FILTER%"=="debug" (
        echo [96mModo: Filtrando apenas DEBUGs[0m
    ) else (
        echo Modo: Filtro customizado '%FILTER%'
    )
    echo Pressione Ctrl+C para sair
    echo.
    timeout /t 2 >nul
    call npx pm2 logs --raw --timestamp --lines 100 | findstr /i %FILTER%
    if errorlevel 1 (
        echo.
        echo [WARN] Nenhum log encontrado com o filtro '%FILTER%'
        echo [HINT] Use sem filtro para ver todos os logs
        exit /b 0
    )
)

exit /b 0
