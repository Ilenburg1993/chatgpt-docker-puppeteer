#!/usr/bin/env bash
# =============================================================================
# pm2-startup.sh - PM2 Sovereign Mode Startup
# =============================================================================
# Inicialização segura e validada do PM2 com todos os checks
# Uso: bash scripts/pm2-startup.sh
# =============================================================================

set -euo pipefail

# Cores
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m'

echo ""
echo -e "${CYAN}╔════════════════════════════════════════════════════════════╗${NC}"
echo -e "${CYAN}║  PM2 Sovereign Mode - Startup Sequence                    ║${NC}"
echo -e "${CYAN}╚════════════════════════════════════════════════════════════╝${NC}"
echo ""

# =============================================================================
# FASE 1: Pré-voo (Validações)
# =============================================================================
echo -e "${BLUE}[1/5]${NC} Pré-voo: Validações..."

# Check 1: PM2 instalado?
if ! command -v pm2 &> /dev/null; then
    echo -e "${RED}❌ PM2 não instalado${NC}"
    echo "   Instalar: npm install -g pm2"
    exit 1
fi
echo -e "${GREEN}  ✓ PM2 instalado${NC}"

# Check 2: ecosystem.config.js existe?
if [ ! -f "ecosystem.config.js" ]; then
    echo -e "${RED}❌ ecosystem.config.js não encontrado${NC}"
    exit 1
fi
echo -e "${GREEN}  ✓ ecosystem.config.js encontrado${NC}"

# Check 3: Node.js version >= 20?
node_version=$(node -v | cut -d'.' -f1 | sed 's/v//')
if [ "$node_version" -lt 20 ]; then
    echo -e "${RED}❌ Node.js $node_version < 20 (requerido)${NC}"
    exit 1
fi
echo -e "${GREEN}  ✓ Node.js $(node -v) OK${NC}"

# Check 4: Diretórios necessários existem?
for dir in logs fila respostas; do
    if [ ! -d "$dir" ]; then
        mkdir -p "$dir"
        echo -e "${YELLOW}  ⚠ Criado diretório: $dir${NC}"
    fi
done
echo -e "${GREEN}  ✓ Estrutura de diretórios OK${NC}"

# =============================================================================
# FASE 2: Limpeza (Processos órfãos)
# =============================================================================
echo -e "${BLUE}[2/5]${NC} Limpeza: Verificando processos órfãos..."

if pm2 list 2>/dev/null | grep -q "agente-gpt\|dashboard-web\|chrome-proxy"; then
    echo -e "${YELLOW}  ⚠ Processos PM2 já rodando${NC}"
    read -p "  Deseja parar e reiniciar? [y/N] " -n 1 -r
    echo
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        echo "  → Parando processos..."
        pm2 stop agente-gpt dashboard-web chrome-proxy 2>/dev/null || true
        pm2 delete agente-gpt dashboard-web chrome-proxy 2>/dev/null || true
        echo -e "${GREEN}  ✓ Processos limpos${NC}"
    else
        echo -e "${YELLOW}  ⚠ Processos mantidos (pode causar conflitos)${NC}"
    fi
else
    echo -e "${GREEN}  ✓ Nenhum processo órfão${NC}"
fi

# =============================================================================
# FASE 3: Inicialização (PM2 start)
# =============================================================================
echo -e "${BLUE}[3/5]${NC} Inicialização: Iniciando processos PM2..."

pm2 start ecosystem.config.js

sleep 3

echo -e "${GREEN}  ✓ Processos iniciados${NC}"

# =============================================================================
# FASE 4: Validação (Health checks)
# =============================================================================
echo -e "${BLUE}[4/5]${NC} Validação: Health checks..."

# Wait for processes to stabilize
sleep 5

# Check status
if ! pm2 list | grep -q "agente-gpt.*online"; then
    echo -e "${RED}❌ agente-gpt não está online${NC}"
    pm2 logs agente-gpt --lines 20 --nostream
    exit 1
fi
echo -e "${GREEN}  ✓ agente-gpt online${NC}"

if ! pm2 list | grep -q "dashboard-web.*online"; then
    echo -e "${RED}❌ dashboard-web não está online${NC}"
    pm2 logs dashboard-web --lines 20 --nostream
    exit 1
fi
echo -e "${GREEN}  ✓ dashboard-web online${NC}"

if ! pm2 list | grep -q "chrome-proxy.*online"; then
    echo -e "${RED}❌ chrome-proxy não está online${NC}"
    pm2 logs chrome-proxy --lines 20 --nostream
    exit 1
fi
echo -e "${GREEN}  ✓ chrome-proxy online${NC}"

# Check HTTP server
echo "  → Testando servidor HTTP (porta 3008)..."
for i in {1..10}; do
    if curl -sf http://localhost:3008/api/health > /dev/null 2>&1; then
        echo -e "${GREEN}  ✓ Servidor HTTP respondendo${NC}"
        break
    fi

    if [ $i -eq 10 ]; then
        echo -e "${RED}❌ Servidor HTTP não respondeu após 10s${NC}"
        pm2 logs dashboard-web --lines 20 --nostream
        exit 1
    fi

    sleep 1
done

# =============================================================================
# FASE 5: Informações (Status)
# =============================================================================
echo -e "${BLUE}[5/5]${NC} Status: Resumo do sistema..."
echo ""

pm2 status

echo ""
echo -e "${CYAN}╔════════════════════════════════════════════════════════════╗${NC}"
echo -e "${CYAN}║  ${GREEN}✅ PM2 Sovereign Mode - Sistema Operacional${NC}             ${CYAN}║${NC}"
echo -e "${CYAN}╚════════════════════════════════════════════════════════════╝${NC}"
echo ""
echo -e "${GREEN}Comandos úteis:${NC}"
echo "  • Ver logs:      pm2 logs"
echo "  • Monitorar:     pm2 monit"
echo "  • Status:        pm2 status"
echo "  • Restart:       pm2 restart all"
echo "  • Health check:  bash scripts/pm2-check.sh"
echo "  • Dashboard:     http://localhost:3008"
echo ""
echo -e "${YELLOW}Sistema pronto para uso!${NC}"
echo ""
