@echo off
REM Windows launcher to start Chrome with proxy settings
REM This file is intentionally simple and used by integration checks.

SET CHROME_DEBUG_PORT=9225
SET PROXY_PORT=9224

REM Example: start the proxy (PUBLIC_IP can be passed as first arg)
node scripts/chrome-proxy-service.js %1 %2

REM End of script
