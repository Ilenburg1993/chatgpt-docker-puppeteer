@echo off
REM ============================================================================
REM  INSTALL-PM2-GUI v3.0 - Helper para instalação do pm2-gui
REM  Version: 3.0 (2026-01-21) - Enhanced error handling & install logging
REM  Interface gráfica Electron para gerenciar processos PM2
REM ============================================================================

setlocal enabledelayedexpansion

REM Check npm availability
where npm >nul 2>&1
if errorlevel 1 (
    echo [FAIL] npm not found!
    echo [HINT] Install Node.js from https://nodejs.org/
    pause
    exit /b 1
)

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
echo        Log de instalacao: logs\pm2-gui-install.log
echo.

if not exist logs mkdir logs
call npm install -g pm2-gui >logs\pm2-gui-install.log 2>&1

if errorlevel 1 (
    echo.
    echo [FAIL] Falha na instalacao!
    echo.
    echo [TROUBLESHOOTING]
    echo   1. Verifique o log: logs\pm2-gui-install.log
    echo   2. Problemas comuns:
    echo      - Permissoes: tente com direitos de administrador
    echo      - Rede: verifique conexao com npmjs.com
    echo      - Cache: execute 'npm cache clean --force'
    echo.
    echo   3. Instalacao manual:
    echo      npm install -g pm2-gui
    echo.
    pause
    exit /b 1
)

echo.
echo ============================================================
echo  [OK] pm2-gui instalado com sucesso!
echo ============================================================
echo.
echo Para usar:
   1. Execute: pm2-gui
   2. Acesse: http://localhost:8088
echo.
echo Ou use o LAUNCHER.bat opcao [6]
echo Log completo: logs\pm2-gui-install.log
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
