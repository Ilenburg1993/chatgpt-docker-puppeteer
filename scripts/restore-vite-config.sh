#!/usr/bin/env bash
# Restore Vite config to host: '127.0.0.1' (recommended by Vite docs)

set -euo pipefail

echo "=========================================="
echo "🔙 RESTAURANDO CONFIGURAÇÃO DO VITE"
echo "=========================================="
echo ""

VITE_CONFIG="/workspaces/chatgpt-docker-puppeteer/src/dashboard-ui/vite.config.js"
BACKUP="/workspaces/chatgpt-docker-puppeteer/src/dashboard-ui/vite.config.js.backup-127"

if [ -f "$BACKUP" ]; then
    echo "📦 Restaurando do backup..."
    mv "$BACKUP" "$VITE_CONFIG"
    echo "   ✅ Configuração restaurada"
else
    echo "⚠️  Backup não encontrado, mudando manualmente..."
    sed -i "s/host: '0.0.0.0'/host: '127.0.0.1'/g" "$VITE_CONFIG"
    echo "   ✅ host: '0.0.0.0' → '127.0.0.1'"
fi
echo ""

# Restart Vite
echo "🔄 Reiniciando Vite..."
pkill -f "vite" || true
sleep 2

cd /workspaces/chatgpt-docker-puppeteer/src/dashboard-ui
nohup npm run dev > /tmp/vite.log 2>&1 &
sleep 3

if pgrep -f "vite" > /dev/null; then
    echo "   ✅ Vite reiniciado com host: '127.0.0.1'"
else
    echo "   ❌ Falha ao reiniciar"
    exit 1
fi
echo ""

echo "=========================================="
echo "✅ CONFIGURAÇÃO RESTAURADA"
echo "=========================================="
echo ""
echo "📋 Configuração atual (recomendada pela documentação do Vite):"
echo "   host: '127.0.0.1'  →  VS Code port forwarding compatible"
echo ""
echo "🎯 Próximo passo:"
echo "   Forward manual da porta 5173 no VS Code"
echo "   (Aba PORTS → [+] → 5173)"
echo ""
echo "=========================================="

exit 0
