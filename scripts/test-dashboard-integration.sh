#!/bin/bash
# Test Dashboard Integration - Vue + Server

echo "=== DASHBOARD INTEGRATION TEST ==="
echo ""

echo "1️⃣  Testing Backend API (Express)..."
API_HEALTH=$(curl -s -m 5 http://localhost:3008/health)
if echo "$API_HEALTH" | grep -q "alive"; then
    echo "   ✅ API Health: OK"
else
    echo "   ❌ API Health: FAIL"
    exit 1
fi

API_TASKS=$(curl -s -m 5 http://localhost:3008/api/dashboard/tasks)
if echo "$API_TASKS" | grep -q "success"; then
    echo "   ✅ API Tasks: OK"
else
    echo "   ❌ API Tasks: FAIL"
    exit 1
fi

echo ""
echo "2️⃣  Testing Vite Dev Server..."
VITE_STATUS=$(curl -s -m 5 -o /dev/null -w "%{http_code}" http://localhost:5173/dashboard/)
if [ "$VITE_STATUS" = "200" ]; then
    echo "   ✅ Vite Server: OK (HTTP $VITE_STATUS)"
else
    echo "   ❌ Vite Server: FAIL (HTTP $VITE_STATUS)"
    exit 1
fi

echo ""
echo "3️⃣  Testing Vite → API Proxy..."
# Testar via Vite (deve fazer proxy para backend)
PROXY_TEST=$(curl -s -m 5 http://localhost:5173/api/dashboard/tasks)
if echo "$PROXY_TEST" | grep -q "success"; then
    echo "   ✅ Vite Proxy: OK"
else
    echo "   ❌ Vite Proxy: FAIL"
    echo "   Response: $PROXY_TEST"
    exit 1
fi

echo ""
echo "4️⃣  Testing PM2 Services..."
PM2_STATUS=$(npx pm2 jlist 2> /dev/null | jq -r '.[] | select(.pm2_env.status=="online") | .name')
EXPECTED_SERVICES=("agente-gpt" "dashboard-web" "chrome-proxy")

for service in "${EXPECTED_SERVICES[@]}"; do
    if echo "$PM2_STATUS" | grep -q "$service"; then
        echo "   ✅ $service: online"
    else
        echo "   ❌ $service: offline"
        exit 1
    fi
done

echo ""
echo "=== ✅ ALL TESTS PASSED ==="
echo ""
echo "Dashboard URLs:"
echo "  • Vite Dev:  http://172.17.0.2:5173/dashboard/"
echo "  • API:       http://localhost:3008/api/"
echo "  • Health:    http://localhost:3008/health"
echo ""
