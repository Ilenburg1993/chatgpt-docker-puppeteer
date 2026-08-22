#!/usr/bin/env bash
# Force Port 5173 Forwarding in VS Code
# This script helps diagnose and fix port forwarding issues

set -euo pipefail

echo "=========================================="
echo "🔧 VS CODE PORT FORWARDING FIX"
echo "=========================================="
echo ""

# Check if Vite is running
echo "1️⃣ Verificando se Vite está rodando..."
if pgrep -f "vite" > /dev/null; then
    echo "   ✅ Vite is RUNNING"
else
    echo "   ❌ Vite is NOT running - Starting now..."
    cd /workspaces/chatgpt-docker-puppeteer/src/dashboard-ui
    nohup npm run dev > /tmp/vite.log 2>&1 &
    sleep 3
    echo "   ✅ Vite started"
fi
echo ""

# Check port listening
echo "2️⃣ Verificando porta 5173..."
if netstat -tln | grep ":5173" > /dev/null; then
    echo "   ✅ Port 5173 is LISTENING"
    netstat -tln | grep ":5173"
else
    echo "   ❌ Port 5173 NOT listening"
    exit 1
fi
echo ""

# Test HTTP
echo "3️⃣ Testando HTTP interno..."
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:5173/dashboard/ 2> /dev/null || echo "000")
if [ "$HTTP_CODE" = "200" ]; then
    echo "   ✅ HTTP 200 OK - Vite respondendo"
else
    echo "   ❌ HTTP $HTTP_CODE - Falha"
    exit 1
fi
echo ""

# Instructions
echo "=========================================="
echo "✅ VITE ESTÁ FUNCIONANDO NO CONTAINER"
echo "=========================================="
echo ""
echo "🚨 PROBLEMA: Port Forwarding NÃO está ativo no VS Code"
echo ""
echo "📋 SOLUÇÃO - Siga ESTES PASSOS:"
echo ""
echo "┌─────────────────────────────────────────┐"
echo "│  PASSO 1: Abrir aba PORTS no VS Code   │"
echo "└─────────────────────────────────────────┘"
echo ""
echo "  No VS Code (painel inferior):"
echo "  - Procure a aba 'PORTS' (ao lado de TERMINAL)"
echo "  - Se não aparecer: Ctrl+Shift+P → digite 'Ports: Focus'"
echo ""
echo "┌─────────────────────────────────────────┐"
echo "│  PASSO 2: Adicionar Porta 5173          │"
echo "└─────────────────────────────────────────┘"
echo ""
echo "  Na aba PORTS:"
echo "  - Clique no botão [+] 'Forward a Port'"
echo "  - Digite: 5173"
echo "  - Pressione ENTER"
echo ""
echo "  Deve aparecer:"
echo "  ┌──────┬───────────────────┬─────────────────┐"
echo "  │ Port │ Forwarded Address │ Local Address   │"
echo "  ├──────┼───────────────────┼─────────────────┤"
echo "  │ 5173 │ localhost:5173    │ 127.0.0.1:5173  │"
echo "  └──────┴───────────────────┴─────────────────┘"
echo ""
echo "┌─────────────────────────────────────────┐"
echo "│  PASSO 3: Testar no Navegador           │"
echo "└─────────────────────────────────────────┘"
echo ""
echo "  Abra no navegador Windows:"
echo "  → http://localhost:5173/dashboard/"
echo ""
echo "  Esperado:"
echo "  ✅ Dashboard carrega (tema escuro)"
echo "  ✅ Console (F12): '[vite] connected.'"
echo ""
echo "=========================================="
echo ""
echo "🔍 DIAGNÓSTICO ADICIONAL (Se ainda falhar):"
echo ""
echo "A) No terminal Windows (PowerShell):"
echo "   Test-NetConnection -ComputerName localhost -Port 5173"
echo ""
echo "B) Verificar se Docker Desktop está rodando"
echo ""
echo "C) Verificar se WSL2 está atualizado"
echo ""
echo "D) Screenshot da aba PORTS + erro do navegador"
echo ""
echo "=========================================="

exit 0
