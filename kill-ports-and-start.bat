@echo off
chcp 65001 >nul 2>&1
setlocal enabledelayedexpansion

echo.
echo ════════════════════════════════════════════════════════════════
echo   LIBERAR PORTAS E INICIAR CHROME + PROXY
echo ════════════════════════════════════════════════════════════════
echo.

REM Matar processos nas portas 9224 e 9224
echo [INFO] Liberando porta 9224...
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":9224" ^| findstr "LISTENING"') do (
    echo [INFO] Matando PID %%a...
    taskkill /PID %%a /F >nul 2>&1
)

echo [INFO] Liberando porta 9224...
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":9224" ^| findstr "LISTENING"') do (
    echo [INFO] Matando PID %%a...
    taskkill /PID %%a /F >nul 2>&1
)

echo [INFO] Aguardando 2 segundos...
timeout /t 2 /nobreak >nul

echo.
echo [INFO] Iniciando Chrome + Proxy...
call "%~dp0start-chrome-proxy-v4.bat"
