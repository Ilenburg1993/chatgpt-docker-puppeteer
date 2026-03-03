#!/usr/bin/env bash
# Dashboard Access Diagnostics
# Verifica se o dashboard está acessível do Windows

set -euo pipefail

echo "=========================================="
echo "🔍 DASHBOARD ACCESS DIAGNOSTICS"
echo "=========================================="
echo ""

# 1. Check Vite Process
echo "1️⃣ Checking Vite Process..."
if pgrep -f "vite|npm.*dev" > /dev/null; then
    echo "   ✅ Vite is RUNNING"
    pgrep -af "vite" | awk '{print "   PID: " $1}'
else
    echo "   ❌ Vite is NOT running"
    echo "   → Run: cd src/dashboard-ui && npm run dev"
    exit 1
fi
echo ""

# 2. Check Port 5173
echo "2️⃣ Checking Port 5173..."
if netstat -tln 2>/dev/null | grep ":5173" > /dev/null || ss -tln 2>/dev/null | grep ":5173" > /dev/null; then
    echo "   ✅ Port 5173 is LISTENING"
    netstat -tln 2>/dev/null | grep ":5173" || ss -tln 2>/dev/null | grep ":5173"
else
    echo "   ❌ Port 5173 is NOT listening"
    exit 1
fi
echo ""

# 3. Test HTTP Response
echo "3️⃣ Testing HTTP Response..."
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:5173/dashboard/ 2>/dev/null || echo "000")
if [ "$HTTP_CODE" = "200" ]; then
    echo "   ✅ HTTP Response: 200 OK"
    curl -s http://127.0.0.1:5173/dashboard/ | grep -o "<title>.*</title>" || echo "   HTML loaded successfully"
else
    echo "   ❌ HTTP Response: $HTTP_CODE"
    exit 1
fi
echo ""

# 4. Check DevContainer Port Forwarding Config
echo "4️⃣ Checking DevContainer Config..."
if grep -q '"5173"' /workspaces/chatgpt-docker-puppeteer/.devcontainer/devcontainer.json; then
    echo "   ✅ Port 5173 in devcontainer.json forwardPorts"
else
    echo "   ⚠️  Port 5173 NOT in devcontainer.json (should have been added)"
fi
echo ""

# 5. Container Network Info
echo "5️⃣ Container Network Info..."
CONTAINER_IP=$(hostname -I | awk '{print $1}')
echo "   Container IP: $CONTAINER_IP"
echo "   Vite URL (internal): http://127.0.0.1:5173/dashboard/"
echo "   Vite URL (Windows): http://localhost:5173/dashboard/"
echo ""

# 6. Final Instructions
echo "=========================================="
echo "✅ ALL CHECKS PASSED - Dashboard is ready!"
echo "=========================================="
echo ""
echo "📌 NEXT STEPS:"
echo ""
echo "1. Verify Port Forwarding in VS Code:"
echo "   - Open PORTS tab (bottom panel)"
echo "   - Look for port 5173"
echo "   - Should show: Forwarded to localhost:5173"
echo ""
echo "2. If port NOT forwarded:"
echo "   - Click [+] Add Port button"
echo "   - Type: 5173"
echo "   - Press Enter"
echo ""
echo "3. Open in Windows Browser:"
echo "   - URL: http://localhost:5173/dashboard/"
echo "   - Expected: Dashboard loads (dark theme)"
echo "   - F12 Console: [vite] connected."
echo ""
echo "4. If still fails:"
echo "   - Screenshot VS Code PORTS tab"
echo "   - Screenshot browser error"
echo "   - Share with developer"
echo ""
echo "=========================================="

exit 0
