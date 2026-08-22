#!/usr/bin/env bash
# Temporarily change Vite to 0.0.0.0 for direct container access test

set -euo pipefail

echo "=========================================="
echo "🧪 TESTE: ACESSO DIRETO AO CONTAINER"
echo "=========================================="
echo ""

VITE_CONFIG="/workspaces/chatgpt-docker-puppeteer/src/dashboard-ui/vite.config.js"
BACKUP="/workspaces/chatgpt-docker-puppeteer/src/dashboard-ui/vite.config.js.backup-127"

# Backup current config
echo "📦 Criando backup da configuração..."
cp "$VITE_CONFIG" "$BACKUP"
echo "   ✅ Backup salvo em: vite.config.js.backup-127"
echo ""

# Change host to 0.0.0.0
echo "🔧 Mudando host: '127.0.0.1' → '0.0.0.0'..."
sed -i "s/host: '127.0.0.1'/host: '0.0.0.0'/g" "$VITE_CONFIG"
echo "   ✅ Configuração alterada"
echo ""

# Kill current Vite
echo "🔄 Reiniciando Vite..."
pkill -f "vite" || true
sleep 2

# Start Vite in background
cd /workspaces/chatgpt-docker-puppeteer/src/dashboard-ui
nohup npm run dev > /tmp/vite-test.log 2>&1 &
sleep 3

# Check if started
if pgrep -f "vite" > /dev/null; then
    echo "   ✅ Vite reiniciado"
else
    echo "   ❌ Falha ao iniciar Vite"
    exit 1
fi
echo ""

# Get container IP
CONTAINER_IP=$(hostname -I | awk '{print $1}')

# Test internal access
echo "📡 Testando acesso interno..."
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" http://0.0.0.0:5173/dashboard/ 2> /dev/null || echo "000")
if [ "$HTTP_CODE" = "200" ]; then
    echo "   ✅ HTTP 200 OK"
else
    echo "   ⚠️  HTTP $HTTP_CODE (pode ser normal)"
fi
echo ""

echo "=========================================="
echo "✅ CONFIGURAÇÃO TEMPORÁRIA ATIVA"
echo "=========================================="
echo ""
echo "📍 URLs para testar no navegador Windows:"
echo ""
echo "   1. Via IP do Container:"
echo "      → http://$CONTAINER_IP:5173/dashboard/"
echo ""
echo "   2. Via localhost (se port forward estiver ativo):"
echo "      → http://localhost:5173/dashboard/"
echo ""
echo "=========================================="
echo ""
echo "🔙 PARA REVERTER (importante!):"
echo ""
echo "   bash scripts/restore-vite-config.sh"
echo ""
echo "   Isso vai restaurar host: '127.0.0.1' (recomendado pela documentação do Vite)"
echo ""
echo "=========================================="
echo ""
echo "📊 RESULTADO ESPERADO:"
echo ""
echo "   ✅ Se funcionar via $CONTAINER_IP → Problema é port forwarding"
echo "   ❌ Se NÃO funcionar → Outro problema (firewall/Windows networking)"
echo ""
echo "=========================================="

exit 0
