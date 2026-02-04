# PowerShell Script to Test Dashboard Access from Windows
# Run this on Windows PowerShell (not inside container)

Write-Host "=========================================="
Write-Host "🪟 DASHBOARD ACCESS TEST - WINDOWS HOST"
Write-Host "=========================================="
Write-Host ""

# Test Connection to Port 5173
Write-Host "1️⃣ Testing Port 5173 Availability..."
$testResult = Test-NetConnection -ComputerName localhost -Port 5173 -WarningAction SilentlyContinue

if ($testResult.TcpTestSucceeded) {
    Write-Host "   ✅ Port 5173 is ACCESSIBLE from Windows" -ForegroundColor Green
    Write-Host "   → TCP Connection: SUCCESS"
    Write-Host ""

    # Test HTTP
    Write-Host "2️⃣ Testing HTTP Response..."
    try {
        $response = Invoke-WebRequest -Uri "http://localhost:5173/dashboard/" -TimeoutSec 5 -UseBasicParsing
        Write-Host "   ✅ HTTP Status: $($response.StatusCode) $($response.StatusDescription)" -ForegroundColor Green

        if ($response.Content -match '<title>(.*?)</title>') {
            Write-Host "   ✅ HTML Title: $($matches[1])" -ForegroundColor Green
        }

        Write-Host ""
        Write-Host "=========================================="
        Write-Host "✅ DASHBOARD IS ACCESSIBLE!" -ForegroundColor Green
        Write-Host "=========================================="
        Write-Host ""
        Write-Host "📍 Open in your browser:"
        Write-Host "   → http://localhost:5173/dashboard/"
        Write-Host ""

    } catch {
        Write-Host "   ⚠️  HTTP Request Failed: $($_.Exception.Message)" -ForegroundColor Yellow
        Write-Host ""
        Write-Host "Port is open but HTTP failed. Possible causes:"
        Write-Host "   - Vite may be starting up (wait 10 seconds)"
        Write-Host "   - Browser security blocking connection"
        Write-Host "   - Firewall rule interfering"
    }

} else {
    Write-Host "   ❌ Port 5173 is NOT ACCESSIBLE from Windows" -ForegroundColor Red
    Write-Host "   → TCP Connection: FAILED"
    Write-Host ""
    Write-Host "=========================================="
    Write-Host "🚨 PORT FORWARDING NOT ACTIVE" -ForegroundColor Red
    Write-Host "=========================================="
    Write-Host ""
    Write-Host "📋 SOLUTION - Add Port Forwarding in VS Code:"
    Write-Host ""
    Write-Host "   Step 1: Open VS Code"
    Write-Host "   Step 2: Click on PORTS tab (bottom panel)"
    Write-Host "           (Next to TERMINAL, PROBLEMS, OUTPUT)"
    Write-Host ""
    Write-Host "   Step 3: Click [+] 'Forward a Port' button"
    Write-Host "   Step 4: Type: 5173"
    Write-Host "   Step 5: Press ENTER"
    Write-Host ""
    Write-Host "   Expected result:"
    Write-Host "   ┌──────┬────────────────────┬─────────────────┐"
    Write-Host "   │ Port │ Forwarded Address  │ Local Address   │"
    Write-Host "   ├──────┼────────────────────┼─────────────────┤"
    Write-Host "   │ 5173 │ localhost:5173     │ 127.0.0.1:5173  │"
    Write-Host "   └──────┴────────────────────┴─────────────────┘"
    Write-Host ""
    Write-Host "   Step 6: Run this script again to verify"
    Write-Host ""
    Write-Host "=========================================="
}

Write-Host ""
Write-Host "💡 TIP: If port forwarding doesn't work:"
Write-Host "   - Restart VS Code"
Write-Host "   - Check Docker Desktop is running"
Write-Host "   - Check Windows Firewall settings"
Write-Host ""
Write-Host "=========================================="

# Keep window open if run directly
Write-Host ""
Write-Host "Press any key to exit..."
$null = $Host.UI.RawUI.ReadKey("NoEcho,IncludeKeyDown")
