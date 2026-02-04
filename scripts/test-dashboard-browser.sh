#!/usr/bin/env bash
# Test Dashboard Integration - Browser Access

set -euo pipefail

echo "=== DASHBOARD BROWSER ACCESS TEST ==="
echo ""

# Get container IP
CONTAINER_IP=$(hostname -I | awk '{print $1}')
echo "📍 Container IP: $CONTAINER_IP"
echo ""

# Test Vite (Frontend)
echo "🔍 Testing Vite Dev Server..."
if curl -sf "http://localhost:5173/dashboard/" >/dev/null; then
    echo "✅ Vite: OK (http://$CONTAINER_IP:5173/dashboard/)"
else
    echo "❌ Vite: FAIL"
    exit 1
fi

# Test Express (Backend)
echo "🔍 Testing Express API..."
if curl -sf "http://localhost:3008/api/health" >/dev/null; then
    echo "✅ Express: OK (http://localhost:3008/api/health)"
else
    echo "❌ Express: FAIL"
    exit 1
fi

# Test PM2
echo "🔍 Testing PM2 processes..."
PM2_ONLINE=$(npx pm2 jlist 2>/dev/null | jq -r '.[] | select(.pm2_env.status=="online") | .name' | wc -l)
echo "✅ PM2: $PM2_ONLINE processes online"

echo ""
echo "=== 🎉 ALL TESTS PASSED ==="
echo ""
echo "📌 Access URLs (from Windows):"
echo "   Dashboard: http://$CONTAINER_IP:5173/dashboard/"
echo "   API:       http://localhost:3008/api/health"
echo ""
echo "💡 TIP: Open Chrome/Edge and navigate to the Dashboard URL above"
echo ""

exit 0
