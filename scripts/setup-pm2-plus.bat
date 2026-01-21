@echo off
REM ============================================================================
REM  SETUP-PM2-PLUS - Guia de configuração PM2 Plus (opcional)
REM  Monitoramento cloud profissional para PM2
REM ============================================================================

setlocal enabledelayedexpansion

echo ============================================================
echo  PM2 PLUS - Monitoramento Cloud Profissional
echo ============================================================
echo.
echo O PM2 Plus e um servico cloud OPCIONAL da Keymetrics
echo para monitoramento avancado de aplicacoes PM2.
echo.
echo Recursos (plano FREE ate 4 servidores):
echo   - Dashboard web centralizado
echo   - Metricas em tempo real (CPU, RAM, eventos)
echo   - Alertas e notificacoes
echo   - Logs centralizados
echo   - Monitoramento de multiplos servidores
echo   - API de gerenciamento remoto
echo.
echo ============================================================
echo.
echo [IMPORTANTE] Este projeto NAO requer PM2 Plus.
echo              O sistema funciona 100%% standalone com PM2 local.
echo.
echo ============================================================
echo.

set /p proceed="Deseja ver as instrucoes de setup? (S/N): "

if /i not "%proceed%"=="S" (
    echo.
    echo Setup cancelado.
    goto END
)

echo.
echo ============================================================
echo  INSTRUCOES DE SETUP PM2 PLUS
echo ============================================================
echo.
echo 1. Acesse: https://app.pm2.io/
echo.
echo 2. Crie uma conta gratuita
echo.
echo 3. Crie um novo "Bucket" para este projeto
echo.
echo 4. Copie a chave publica e privada fornecidas
echo.
echo 5. No terminal, execute:
echo.
echo    pm2 link [chave-secreta] [chave-publica]
echo.
echo 6. Seus processos PM2 aparecerao no dashboard web
echo.
echo ============================================================
echo.
echo Documentacao completa:
echo   https://pm2.io/docs/plus/quick-start/
echo.
echo ============================================================
echo.

set /p open_browser="Deseja abrir o site do PM2 Plus? (S/N): "

if /i "!open_browser!"=="S" (
    echo.
    echo Abrindo navegador...
    start https://app.pm2.io/
)

:END
echo.
pause
exit /b 0
