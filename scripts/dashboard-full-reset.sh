#!/usr/bin/env bash
# Dashboard Full Reset - Clear EVERYTHING and restart clean

set -euo pipefail

echo "=== DASHBOARD FULL RESET ==="
echo ""

# 1. Kill ALL Vite/Node processes
echo "🔪 Killing all Vite/Node processes..."
pkill -9 -f "vite" 2>/dev/null || true
pkill -9 -f "esbuild" 2>/dev/null || true
pkill -9 -f "node.*dashboard" 2>/dev/null || true
sleep 2

# 2. Clear ALL caches
echo "🧹 Clearing ALL caches..."
cd /workspaces/chatgpt-docker-puppeteer/src/dashboard-ui
rm -rf node_modules/.vite
rm -rf node_modules/.cache
rm -rf dist
rm -rf .vite
rm -f /tmp/vite-*.log

# 3. Clear browser cache hint
echo "⚠️  IMPORTANT: Clear browser cache!"
echo "   Chrome: Ctrl+Shift+Del → Clear cache"
echo "   Or: Ctrl+F5 (hard refresh)"
echo ""

# 4. Restart Vite CLEAN
echo "🚀 Starting Vite clean..."
nohup npm run dev > /tmp/vite-clean.log 2>&1 &
VITE_PID=$!
echo "   Vite PID: $VITE_PID"
sleep 6

# 5. Check if Vite started
if ! curl -sf http://localhost:5173/dashboard/ >/dev/null 2>&1; then
    echo "❌ Vite FAILED to start!"
    echo "   Logs:"
    tail -30 /tmp/vite-clean.log
    exit 1
fi

# 6. Get network info
CONTAINER_IP=$(hostname -I | awk '{print $1}')
echo ""
echo "✅ Vite started successfully!"
echo ""
echo "📌 Access URLs:"
echo "   Local:   http://localhost:5173/dashboard/"
echo "   Network: http://$CONTAINER_IP:5173/dashboard/"
echo ""
echo "💡 IMPORTANT STEPS:"
echo "   1. Open Chrome/Edge NO Windows"
echo "   2. Press Ctrl+Shift+Del → Clear cache"
echo "   3. Navigate to: http://$CONTAINER_IP:5173/dashboard/"
echo "   4. Press Ctrl+F5 (hard refresh)"
echo "   5. Open DevTools (F12) → Console tab"
echo "   6. Check for errors"
echo ""
echo "📋 If still blank page:"
echo "   - Check Console for errors (F12)"
echo "   - Check Network tab (F12) → See if files load"
echo "   - Try incognito mode (Ctrl+Shift+N)"
echo ""

exit 0
