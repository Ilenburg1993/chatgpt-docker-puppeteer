#!/usr/bin/env bash
# =============================================================================
# pm2-check.sh - PM2 Health Check & Diagnostics
# =============================================================================
# Verifica se todos os processos PM2 estão rodando corretamente
# Uso: bash scripts/pm2-check.sh [--fix]
# =============================================================================

set -euo pipefail

# Cores
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

FIX_MODE=false
if [[ "${1:-}" == "--fix" ]]; then
    FIX_MODE=true
fi

# Processos esperados
EXPECTED_PROCESSES=("agente-gpt" "dashboard-web" "chrome-proxy")

echo ""
echo -e "${BLUE}═══════════════════════════════════════════════════════════${NC}"
echo -e "${BLUE}  PM2 Health Check (PM2 Sovereign Mode)${NC}"
echo -e "${BLUE}═══════════════════════════════════════════════════════════${NC}"
echo ""

# =============================================================================
# CHECK 1: PM2 daemon está rodando?
# =============================================================================
echo -e "${YELLOW}[1/6]${NC} Verificando daemon PM2..."

if ! command -v pm2 &> /dev/null; then
    echo -e "${RED}❌ PM2 não instalado${NC}"
    echo "   Instalar: npm install -g pm2"
    exit 1
fi

if ! pm2 ping &> /dev/null; then
    echo -e "${RED}❌ PM2 daemon não está respondendo${NC}"
    if [ "$FIX_MODE" = true ]; then
        echo "   Iniciando daemon..."
        pm2 ping
    else
        echo "   Executar: pm2 ping"
        exit 1
    fi
else
    echo -e "${GREEN}✅ PM2 daemon online${NC}"
fi

# =============================================================================
# CHECK 2: Processos esperados estão rodando?
# =============================================================================
echo -e "${YELLOW}[2/6]${NC} Verificando processos gerenciados..."

MISSING_PROCESSES=()
STOPPED_PROCESSES=()
ERROR_PROCESSES=()

for process in "${EXPECTED_PROCESSES[@]}"; do
    if pm2 list | grep -q "$process"; then
        status=$(pm2 jlist | jq -r ".[] | select(.name==\"$process\") | .pm2_env.status")

        if [ "$status" == "online" ]; then
            echo -e "${GREEN}✅ $process (online)${NC}"
        elif [ "$status" == "stopped" ]; then
            STOPPED_PROCESSES+=("$process")
            echo -e "${YELLOW}⚠️  $process (stopped)${NC}"
        else
            ERROR_PROCESSES+=("$process")
            echo -e "${RED}❌ $process ($status)${NC}"
        fi
    else
        MISSING_PROCESSES+=("$process")
        echo -e "${RED}❌ $process (não encontrado)${NC}"
    fi
done

# =============================================================================
# CHECK 3: Restarts excessivos?
# =============================================================================
echo -e "${YELLOW}[3/6]${NC} Verificando restarts..."

for process in "${EXPECTED_PROCESSES[@]}"; do
    if pm2 list | grep -q "$process"; then
        restarts=$(pm2 jlist | jq -r ".[] | select(.name==\"$process\") | .pm2_env.restart_time")

        if [ "$restarts" -eq 0 ]; then
            echo -e "${GREEN}✅ $process (0 restarts)${NC}"
        elif [ "$restarts" -lt 3 ]; then
            echo -e "${YELLOW}⚠️  $process ($restarts restarts)${NC}"
        else
            echo -e "${RED}❌ $process ($restarts restarts - instável!)${NC}"
        fi
    fi
done

# =============================================================================
# CHECK 4: Memória dentro dos limites?
# =============================================================================
echo -e "${YELLOW}[4/6]${NC} Verificando uso de memória..."

for process in "${EXPECTED_PROCESSES[@]}"; do
    if pm2 list | grep -q "$process"; then
        memory_mb=$(pm2 jlist | jq -r ".[] | select(.name==\"$process\") | .monit.memory" | awk '{print int($1/1024/1024)}')

        # Limites: agente-gpt=3GB, dashboard-web=3GB, chrome-proxy=500MB
        limit=3000
        if [ "$process" == "chrome-proxy" ]; then
            limit=500
        fi

        if [ "$memory_mb" -lt "$limit" ]; then
            echo -e "${GREEN}✅ $process (${memory_mb}MB / ${limit}MB)${NC}"
        else
            echo -e "${RED}❌ $process (${memory_mb}MB / ${limit}MB - LIMITE EXCEDIDO!)${NC}"
        fi
    fi
done

# =============================================================================
# CHECK 5: Variáveis de ambiente corretas?
# =============================================================================
echo -e "${YELLOW}[5/6]${NC} Verificando variáveis de ambiente..."

# agente-gpt deve ter SERVER_MODE=split
if pm2 list | grep -q "agente-gpt"; then
    server_mode=$(pm2 jlist | jq -r '.[] | select(.name=="agente-gpt") | .pm2_env.SERVER_MODE')
    if [ "$server_mode" == "split" ]; then
        echo -e "${GREEN}✅ agente-gpt (SERVER_MODE=split)${NC}"
    else
        echo -e "${RED}❌ agente-gpt (SERVER_MODE=$server_mode - esperado: split)${NC}"
    fi
fi

# dashboard-web deve ter DAEMON_MODE=true
if pm2 list | grep -q "dashboard-web"; then
    daemon_mode=$(pm2 jlist | jq -r '.[] | select(.name=="dashboard-web") | .pm2_env.DAEMON_MODE')
    if [ "$daemon_mode" == "true" ]; then
        echo -e "${GREEN}✅ dashboard-web (DAEMON_MODE=true)${NC}"
    else
        echo -e "${RED}❌ dashboard-web (DAEMON_MODE=$daemon_mode)${NC}"
    fi
fi

# =============================================================================
# CHECK 6: Logs sem erros críticos?
# =============================================================================
echo -e "${YELLOW}[6/6]${NC} Verificando logs recentes (últimas 50 linhas)..."

CRITICAL_ERRORS=0

for process in "${EXPECTED_PROCESSES[@]}"; do
    if pm2 list | grep -q "$process"; then
        errors=$(pm2 logs "$process" --lines 50 --nostream --err 2>/dev/null | grep -c "\[FATAL\]\|\[ERROR\]" || true)

        if [ "$errors" -eq 0 ]; then
            echo -e "${GREEN}✅ $process (sem erros críticos)${NC}"
        else
            echo -e "${RED}❌ $process ($errors erros nos logs)${NC}"
            CRITICAL_ERRORS=$((CRITICAL_ERRORS + errors))
        fi
    fi
done

# =============================================================================
# RESUMO & FIX
# =============================================================================
echo ""
echo -e "${BLUE}═══════════════════════════════════════════════════════════${NC}"

TOTAL_ISSUES=0
TOTAL_ISSUES=$((TOTAL_ISSUES + ${#MISSING_PROCESSES[@]}))
TOTAL_ISSUES=$((TOTAL_ISSUES + ${#STOPPED_PROCESSES[@]}))
TOTAL_ISSUES=$((TOTAL_ISSUES + ${#ERROR_PROCESSES[@]}))

if [ "$TOTAL_ISSUES" -eq 0 ] && [ "$CRITICAL_ERRORS" -eq 0 ]; then
    echo -e "${GREEN}🎉 TODOS OS CHECKS PASSARAM! PM2 está operacional.${NC}"
    echo -e "${BLUE}═══════════════════════════════════════════════════════════${NC}"
    exit 0
else
    echo -e "${RED}⚠️  PROBLEMAS DETECTADOS:${NC}"
    echo ""

    if [ "${#MISSING_PROCESSES[@]}" -gt 0 ]; then
        echo -e "${RED}  • Processos não iniciados: ${MISSING_PROCESSES[*]}${NC}"
    fi

    if [ "${#STOPPED_PROCESSES[@]}" -gt 0 ]; then
        echo -e "${YELLOW}  • Processos parados: ${STOPPED_PROCESSES[*]}${NC}"
    fi

    if [ "${#ERROR_PROCESSES[@]}" -gt 0 ]; then
        echo -e "${RED}  • Processos com erro: ${ERROR_PROCESSES[*]}${NC}"
    fi

    if [ "$CRITICAL_ERRORS" -gt 0 ]; then
        echo -e "${RED}  • $CRITICAL_ERRORS erros nos logs${NC}"
    fi

    echo ""

    if [ "$FIX_MODE" = true ]; then
        echo -e "${YELLOW}Aplicando correções automáticas...${NC}"

        if [ "${#MISSING_PROCESSES[@]}" -gt 0 ] || [ "${#STOPPED_PROCESSES[@]}" -gt 0 ]; then
            echo "  → Iniciando processos faltantes/parados..."
            pm2 start ecosystem.config.js
            sleep 3
            pm2 status
        fi

        if [ "${#ERROR_PROCESSES[@]}" -gt 0 ]; then
            echo "  → Reiniciando processos com erro..."
            for process in "${ERROR_PROCESSES[@]}"; do
                pm2 restart "$process"
            done
            sleep 3
        fi

        echo ""
        echo -e "${GREEN}✅ Correções aplicadas. Executar novamente para validar.${NC}"
    else
        echo -e "${YELLOW}SOLUÇÕES:${NC}"
        echo ""
        echo "  1. Iniciar processos: pm2 start ecosystem.config.js"
        echo "  2. Reiniciar processos: pm2 restart all"
        echo "  3. Ver logs: pm2 logs"
        echo "  4. Auto-fix: bash scripts/pm2-check.sh --fix"
    fi

    echo -e "${BLUE}═══════════════════════════════════════════════════════════${NC}"
    exit 1
fi
