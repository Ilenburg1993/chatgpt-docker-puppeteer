#!/usr/bin/env bash
# Test: Bypass VS Code Port Forwarding
# Access Vite directly via container IP with 0.0.0.0 bind

set -euo pipefail

echo "=========================================="
echo "🧪 TESTE: BYPASS PORT FORWARDING"
echo "=========================================="
echo ""

# Get container IP
CONTAINER_IP=$(hostname -I | awk '{print $1}')
echo "📍 Container IP: $CONTAINER_IP"
echo ""

# Show current Vite config
echo "📋 Configuração Atual do Vite:"
grep -A 5 "host:" /workspaces/chatgpt-docker-puppeteer/src/dashboard-ui/vite.config.js | head -6
echo ""

echo "=========================================="
echo "🔧 ALTERNATIVA TEMPORÁRIA"
echo "=========================================="
echo ""
echo "Para bypassar o VS Code port forwarding, você pode:"
echo ""
echo "1️⃣ OPÇÃO A: Acessar via IP do container (NÃO RECOMENDADO - apenas teste)"
echo "   → Mudar vite.config.js: host: '0.0.0.0'"
echo "   → Reiniciar Vite"
echo "   → Acessar: http://$CONTAINER_IP:5173/dashboard/"
echo ""
echo "2️⃣ OPÇÃO B: Usar ngrok/localhost.run (túnel público - teste externo)"
echo ""
echo "3️⃣ OPÇÃO C: Forward manual no VS Code (RECOMENDADO)"
echo "   → Aba PORTS → [+] → 5173"
echo ""
echo "=========================================="
echo ""
echo "❓ Quer tentar OPÇÃO A (mudar para 0.0.0.0 temporariamente)?"
echo "   Isso vai permitir testar se o problema é realmente o port forwarding."
echo ""
echo "   Digite: bash scripts/test-direct-container-access.sh"
echo ""
echo "=========================================="

exit 0
