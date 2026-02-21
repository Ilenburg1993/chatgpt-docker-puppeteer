#!/bin/bash
# ==========================================================================
# scripts/test-health-endpoints.sh
# Testa os 4 novos health endpoints do Super Launcher
# ==========================================================================

set -e

PORT=3030
BASE_URL="http://localhost:${PORT}"

echo "=========================================="
echo "TESTANDO HEALTH ENDPOINTS"
echo "=========================================="
echo ""

# Função helper para testar endpoint
test_endpoint() {
    local endpoint=$1
    local name=$2

    echo "📡 Testando ${name}..."
    echo "   GET ${BASE_URL}${endpoint}"

    HTTP_CODE=$(curl -s -o /tmp/health_response.json -w "%{http_code}" "${BASE_URL}${endpoint}")

    echo "   Status: ${HTTP_CODE}"

    if [ -f /tmp/health_response.json ]; then
        echo "   Response:"
        cat /tmp/health_response.json | jq '.' 2>/dev/null || cat /tmp/health_response.json
        echo ""
    fi

    echo ""
}

# Testa endpoint agregado existente
test_endpoint "/api/health" "Health Agregado (Existente)"

# Testa 4 novos endpoints
test_endpoint "/api/health/chrome" "Chrome Health"
test_endpoint "/api/health/pm2" "PM2 Health"
test_endpoint "/api/health/kernel" "Kernel Health"
test_endpoint "/api/health/disk" "Disk Health"

echo "=========================================="
echo "RESUMO DE TODOS OS ENDPOINTS:"
echo "=========================================="
echo ""
echo "✓ GET /api/health         - Health agregado (Docker healthcheck)"
echo "✓ GET /api/health/chrome  - Chrome debug port status"
echo "✓ GET /api/health/pm2     - PM2 processes status"
echo "✓ GET /api/health/kernel  - Kernel NERV bus status"
echo "✓ GET /api/health/disk    - Disk usage (logs/fila/respostas)"
echo ""
echo "Para usar no Super Launcher:"
echo "  curl -s http://localhost:3030/api/health/chrome | jq '.connected'"
echo "  curl -s http://localhost:3030/api/health/pm2 | jq '.agent'"
echo ""
