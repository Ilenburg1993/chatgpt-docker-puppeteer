#!/usr/bin/env bash
# Start PM2 processes with Node Inspector (debug) enabled
# This allows VS Code to attach debugger to running processes

set -euo pipefail

echo "=========================================="
echo "🐛 PM2 DEBUG MODE STARTER"
echo "=========================================="
echo ""

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Check if PM2 is installed
if ! command -v pm2 &> /dev/null; then
    echo -e "${RED}❌ PM2 não está instalado${NC}"
    echo "   Instale com: npm install -g pm2"
    exit 1
fi

echo "📋 Opções de Debug:"
echo ""
echo "  1️⃣  Iniciar AGENTE com debug (porta 9229)"
echo "  2️⃣  Iniciar DASHBOARD com debug (porta 9230)"
echo "  3️⃣  Iniciar AMBOS com debug (9229 + 9230)"
echo "  4️⃣  Verificar status de debug"
echo "  5️⃣  Parar todos os processos"
echo ""
read -r -p "Escolha uma opção (1-5): " OPTION

case $OPTION in
    1)
        echo ""
        echo "🚀 Iniciando agente-gpt com debug..."
        pm2 delete agente-gpt 2> /dev/null || true
        pm2 start ecosystem.config.js --only agente-gpt --node-args="--inspect=0.0.0.0:9229"
        echo -e "${GREEN}✅ Agente iniciado com debug na porta 9229${NC}"
        echo "   → No VS Code: Run > Attach to PM2 (9229)"
        ;;
    2)
        echo ""
        echo "📊 Iniciando dashboard-web com debug..."
        pm2 delete dashboard-web 2> /dev/null || true
        pm2 start ecosystem.config.js --only dashboard-web --node-args="--inspect=0.0.0.0:9230"
        echo -e "${GREEN}✅ Dashboard iniciado com debug na porta 9230${NC}"
        echo "   → No VS Code: Run > Attach to PM2 (9230)"
        ;;
    3)
        echo ""
        echo "🚀 Iniciando AMBOS com debug..."
        pm2 delete all 2> /dev/null || true
        pm2 start ecosystem.config.js --only agente-gpt --node-args="--inspect=0.0.0.0:9229"
        pm2 start ecosystem.config.js --only dashboard-web --node-args="--inspect=0.0.0.0:9230"
        echo -e "${GREEN}✅ Agente: debug porta 9229${NC}"
        echo -e "${GREEN}✅ Dashboard: debug porta 9230${NC}"
        echo "   → No VS Code: Run > Attach to PM2 (9229 ou 9230)"
        ;;
    4)
        echo ""
        echo "🔍 Verificando status de debug..."
        echo ""
        echo "--- PM2 Status ---"
        pm2 list
        echo ""
        echo "--- Portas de Debug ---"
        if netstat -tln 2> /dev/null | grep ":9229" > /dev/null; then
            echo -e "${GREEN}✅ Porta 9229: ATIVA${NC}"
            curl -s http://127.0.0.1:9229/json/list | grep -o '"title":"[^"]*"' | head -3 || true
        else
            echo -e "${YELLOW}⚠️  Porta 9229: INATIVA${NC}"
        fi

        if netstat -tln 2> /dev/null | grep ":9230" > /dev/null; then
            echo -e "${GREEN}✅ Porta 9230: ATIVA${NC}"
            curl -s http://127.0.0.1:9230/json/list | grep -o '"title":"[^"]*"' | head -3 || true
        else
            echo -e "${YELLOW}⚠️  Porta 9230: INATIVA${NC}"
        fi
        ;;
    5)
        echo ""
        echo "🛑 Parando todos os processos PM2..."
        pm2 delete all
        echo -e "${GREEN}✅ Todos os processos foram parados${NC}"
        ;;
    *)
        echo -e "${RED}❌ Opção inválida${NC}"
        exit 1
        ;;
esac

echo ""
echo "=========================================="
echo "📖 DOCUMENTAÇÃO"
echo "=========================================="
echo ""
echo "🔹 Para anexar o debugger no VS Code:"
echo "   1. Abra a aba 'Run and Debug' (Ctrl+Shift+D)"
echo "   2. Selecione '📌 Attach to PM2 (9229)' ou (9230)"
echo "   3. Pressione F5"
echo ""
echo "🔹 Para verificar se debug está ativo:"
echo "   curl http://127.0.0.1:9229/json/list"
echo ""
echo "🔹 Para ver logs:"
echo "   pm2 logs"
echo ""
echo "🔹 Para reiniciar com debug:"
echo "   bash $0"
echo ""
echo "=========================================="

exit 0
