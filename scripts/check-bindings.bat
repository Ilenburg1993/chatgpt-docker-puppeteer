@echo off
setlocal EnableDelayedExpansion
REM Version: 1.0 (2026-01-30)
REM Usage: scripts\check-bindings.bat

set "PORTS=3000,3001,3002,3008,9100,9224"
set "FAIL=0"

for %%P in (%PORTS:,= %) do (
  set "PORT=%%P"
  netstat -ano | findstr ":%%PORT" > "%TEMP%\binding_tmp.txt" 2>nul
  if %ERRORLEVEL% neq 0 (
    echo [FAIL] Port %%PORT: not listening
    set "FAIL=1"
    goto :continue_loop
  )

  set "NONLOCAL=0"
  for /f "usebackq delims=" %%L in ("%TEMP%\binding_tmp.txt") do (
    echo %%L | findstr /R /C:"127\.[0-9]*\.[0-9]*\.[0-9]*:%%PORT" >nul
    if %ERRORLEVEL% neq 0 (
      set "NONLOCAL=1"
      goto :found_nonlocal_%%PORT%%
    )
  )
  :found_nonlocal_%%PORT%%
  if "!NONLOCAL!"=="1" (
    echo [OK] Port %%PORT: binding acceptable
  ) else (
    echo [FAIL] Port %%PORT: bound only to localhost
    set "FAIL=1"
  )
  :continue_loop
)

del "%TEMP%\binding_tmp.txt" >nul 2>nul
if "%FAIL%"=="1" (exit /b 1) else (exit /b 0)
