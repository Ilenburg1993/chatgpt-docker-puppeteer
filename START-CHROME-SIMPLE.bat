@echo off
REM =============================================================================
REM START-CHROME-SIMPLE.bat
REM Version: 3.1 Docker Desktop Edition (2026-02-01)
REM =============================================================================
REM
REM Purpose: Start Chrome on Windows Host for Docker Desktop access
REM Architecture: Docker Desktop -> Windows Host (Chrome on 0.0.0.0:9225)
REM
REM IMPORTANT: Chrome binds to 0.0.0.0 to allow Docker network access
REM
REM Usage:
REM   1. Run this on Windows Host: START-CHROME-SIMPLE.bat
REM   2. From container: curl http://host.docker.internal:9225/json/version
REM   3. From container: node scripts/chrome-proxy-service.js
REM
REM =============================================================================

set PORT=9225
set PROFILE=%TEMP%\chrome-docker

echo.
echo Starting Chrome for Docker Desktop access (Port %PORT%)...
echo.
echo IMPORTANT: Chrome will bind to 0.0.0.0 (all interfaces)
echo This allows Docker containers to access it.
echo.

REM Find Chrome
set CHROME=
if exist "C:\Program Files\Google\Chrome\Application\chrome.exe" set CHROME=C:\Program Files\Google\Chrome\Application\chrome.exe
if exist "C:\Program Files (x86)\Google\Chrome\Application\chrome.exe" set CHROME=C:\Program Files (x86)\Google\Chrome\Application\chrome.exe
if "%CHROME%"=="" (
    echo ERROR: Chrome not found
    pause
    exit /b 1
)

REM Create profile dir
if not exist "%PROFILE%" mkdir "%PROFILE%"

REM Start Chrome with 0.0.0.0 binding (Docker Desktop needs this)
start "" "%CHROME%" --remote-debugging-address=0.0.0.0 --remote-debugging-port=%PORT% --user-data-dir="%PROFILE%" --no-first-run --no-default-browser-check

echo.
echo Chrome started on 0.0.0.0:%PORT%
echo.
echo Validate from container:
echo   curl http://host.docker.internal:9225/json/version
echo.
echo Validate from Windows:
echo   curl http://localhost:9225/json/version
echo.
echo Press any key to close Chrome...
pause
