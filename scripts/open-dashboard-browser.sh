#!/usr/bin/env bash
# Automated Solution: Open Dashboard in VS Code Simple Browser
# This bypasses the need for manual port forwarding

set -euo pipefail

echo "=========================================="
echo "🌐 OPENING DASHBOARD IN VS CODE BROWSER"
echo "=========================================="
echo ""

# Check if Vite is running
if ! ps aux | grep vite | grep -v grep > /dev/null; then
    echo "⚠️  Vite not running. Starting..."
    cd /workspaces/chatgpt-docker-puppeteer/src/dashboard-ui
    nohup npm run dev > /tmp/vite.log 2>&1 &
    echo "   Waiting for Vite to start..."
    sleep 5
fi

# Verify Vite is responding
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:5173/dashboard/ 2>/dev/null || echo "000")

if [ "$HTTP_CODE" != "200" ]; then
    echo "❌ Vite is not responding (HTTP $HTTP_CODE)"
    echo "   Try: cd src/dashboard-ui && npm run dev"
    exit 1
fi

echo "✅ Vite is running"
echo "✅ HTTP 200 OK"
echo ""

# Try to open Simple Browser
echo "🚀 Opening Simple Browser..."
echo ""
echo "   URL: http://localhost:5173/dashboard/"
echo ""
echo "   This will open VS Code's internal browser,"
echo "   which bypasses Windows port forwarding issues."
echo ""

# Create a temp file with the command
cat > /tmp/open-dashboard.sh << 'EOF'
#!/usr/bin/env bash
# Execute via VS Code terminal to trigger Simple Browser
code --command simpleBrowser.show "http://localhost:5173/dashboard/" 2>/dev/null || \
  echo "⚠️  Simple Browser command not available. Use manual method."
EOF

chmod +x /tmp/open-dashboard.sh

# Try to execute
if command -v code &> /dev/null; then
    code --command simpleBrowser.show "http://localhost:5173/dashboard/" 2>/dev/null && \
      echo "✅ Simple Browser opened" || \
      echo "⚠️  Could not auto-open. Follow manual instructions below."
else
    echo "⚠️  'code' CLI not available in PATH"
fi

echo ""
echo "=========================================="
echo "📌 MANUAL METHOD (If auto-open failed):"
echo "=========================================="
echo ""
echo "  1. Press: Ctrl + Shift + P"
echo "  2. Type: 'Simple Browser: Show'"
echo "  3. Paste URL: http://localhost:5173/dashboard/"
echo "  4. Press Enter"
echo ""
echo "=========================================="
echo ""
echo "💡 Alternative: Use External Browser"
echo ""
echo "  If Simple Browser doesn't work, add port forwarding:"
echo "    → Run: bash scripts/guide-port-forwarding.sh"
echo ""
echo "=========================================="

exit 0
