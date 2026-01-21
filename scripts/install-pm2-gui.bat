@echo off
REM ============================================================================
REM  INSTALL-PM2-GUI - Helper para instalação do pm2-gui
REM  Interface gráfica Electron para gerenciar processos PM2
REM ============================================================================

setlocal enabledelayedexpansion

echo ============================================================
echo  PM2-GUI INSTALLER
echo ============================================================
echo.
echo O pm2-gui e uma interface grafica Electron para PM2.
echo.
echo Recursos:
echo   - Dashboard visual de processos
echo   - Monitoramento de CPU/RAM em tempo real
echo   - Logs integrados
echo   - Controles start/stop/restart
echo   - Gratuito e open-source
echo.
echo Repositorio: https://github.com/Tjatse/pm2-gui
echo.
echo ============================================================
echo.

REM Verificar se já está instalado
where pm2-gui >nul 2>&1
if not errorlevel 1 (
    echo [INFO] pm2-gui ja esta instalado!
    echo.
    set /p launch="Deseja abrir pm2-gui agora? (S/N): "
    if /i "!launch!"=="S" (
        echo.
        echo Abrindo pm2-gui...
        start pm2-gui
    )
    goto END
)

echo [INFO] pm2-gui nao encontrado no sistema.
echo.
set /p confirm="Deseja instalar pm2-gui globalmente? (S/N): "

if /i not "%confirm%"=="S" (
    echo.
    echo Instalacao cancelada.
    goto END
)

echo.
echo [INFO] Instalando pm2-gui via npm...
echo        Isso pode levar alguns minutos...
echo.

call npm install -g pm2-gui

if errorlevel 1 (
    echo.
    echo [ERROR] Falha na instalacao!
    echo.
    echo Tente manualmente:
    echo   npm install -g pm2-gui
    echo.
    goto END
)

echo.
echo ============================================================
echo  [SUCCESS] pm2-gui instalado com sucesso!
echo ============================================================
echo.
echo Para usar:
echo   1. Execute: pm2-gui
echo   2. Acesse: http://localhost:8088
echo.
echo Ou use o LAUNCHER.bat opcao [6]
echo.

set /p launch="Deseja abrir pm2-gui agora? (S/N): "
if /i "!launch!"=="S" (
    echo.
    echo Abrindo pm2-gui...
    start pm2-gui
)

:END
echo.
pause
exit /b 0
