#!/usr/bin/env bash
# =============================================================================
# copilot-network-diagnose.sh - Diagnóstico rápido de conectividade do Copilot
# =============================================================================
# Uso:
#   bash scripts/ops/copilot-network-diagnose.sh
#   bash scripts/ops/copilot-network-diagnose.sh --proxy http://proxy.local:3128
#
# Objetivo:
#   1) Validar reachability de endpoints críticos do Copilot
#   2) Medir latências de DNS/TCP/TLS/TTFB/Total
#   3) Dar saída acionável para incidentes de timeout intermitente (408/ETIMEDOUT)
# =============================================================================

set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

PROXY_URL=''
if [[ "${1:-}" == "--proxy" ]]; then
    PROXY_URL="${2:-}"
    if [[ -z "$PROXY_URL" ]]; then
        echo -e "${RED}❌ Uso inválido:${NC} informe URL após --proxy"
        echo "Exemplo: bash scripts/ops/copilot-network-diagnose.sh --proxy http://proxy.local:3128"
        exit 2
    fi
fi

ENDPOINTS=(
    'https://copilot-proxy.githubusercontent.com/_ping'
    'https://api.githubcopilot.com/_ping'
)

CURL_BASE_ARGS=(
    --silent
    --show-error
    --output /dev/null
    --connect-timeout 8
    --max-time 20
    --write-out 'http=%{http_code} dns=%{time_namelookup} connect=%{time_connect} tls=%{time_appconnect} ttfb=%{time_starttransfer} total=%{time_total}\n'
)

if [[ -n "$PROXY_URL" ]]; then
    CURL_BASE_ARGS+=(--proxy "$PROXY_URL")
fi

echo ''
echo -e "${BLUE}═══════════════════════════════════════════════════════════${NC}"
echo -e "${BLUE}  Copilot Network Diagnose (Timeout/408)${NC}"
echo -e "${BLUE}═══════════════════════════════════════════════════════════${NC}"
if [[ -n "$PROXY_URL" ]]; then
    echo -e "${YELLOW}Proxy em uso:${NC} $PROXY_URL"
else
    echo -e "${YELLOW}Proxy em uso:${NC} auto/sistema"
fi

echo ''
echo -e "${YELLOW}[1/4]${NC} Reachability + latências dos endpoints críticos"

FAILURES=0
for url in "${ENDPOINTS[@]}"; do
    echo ''
    echo "URL: $url"

    if output=$(curl "${CURL_BASE_ARGS[@]}" "$url" 2>&1); then
        echo "$output"
        http_code=$(echo "$output" | sed -n 's/.*http=\([0-9][0-9][0-9]\).*/\1/p')
        if [[ "$http_code" == '200' ]]; then
            echo -e "${GREEN}✅ OK${NC}"
        else
            echo -e "${RED}❌ HTTP inesperado (${http_code:-desconhecido})${NC}"
            FAILURES=$((FAILURES + 1))
        fi
    else
        echo -e "${RED}❌ Falha de conexão${NC}"
        echo "$output"
        FAILURES=$((FAILURES + 1))
    fi
done

echo ''
echo -e "${YELLOW}[2/4]${NC} DNS dos hosts do Copilot"
getent hosts copilot-proxy.githubusercontent.com || true
getent hosts api.githubcopilot.com || true

echo ''
echo -e "${YELLOW}[3/4]${NC} Status público do GitHub (amostra)"
if status_sample=$(curl -sS --max-time 15 https://www.githubstatus.com/api/v2/components.json | head -c 400); then
    echo "$status_sample"
else
    echo -e "${YELLOW}⚠️ Não foi possível consultar githubstatus API${NC}"
fi

echo ''
echo -e "${YELLOW}[4/4]${NC} Interpretação rápida"
if [[ "$FAILURES" -eq 0 ]]; then
    echo -e "${GREEN}✅ Rede base aparentemente saudável para Copilot.${NC}"
    echo 'Se timeout persistir no chat, foque em: extensão/VS Code desatualizados, autenticação expirada, ou saturação transitória do serviço.'
    echo 'Ações recomendadas: abrir Chat Diagnostics, habilitar log TRACE temporário e coletar janela de falha.'
    echo ''
    echo -e "${BLUE}Exit code:${NC} 0"
    exit 0
fi

echo -e "${RED}❌ Falhas detectadas no caminho de rede do Copilot.${NC}"
echo 'Checklist de mitigação:'
echo '  1) Validar allowlist corporativa (domínios githubcopilot/githubusercontent/api.github.com).'
echo '  2) Testar novamente com proxy explícito (--proxy http://host:port).'
echo '  3) Revisar certificados corporativos no trust store do sistema (Linux: /etc/ssl/certs).'
echo '  4) Coletar Developer: Chat Diagnostics + logs TRACE para suporte interno.'
echo ''
echo -e "${BLUE}Exit code:${NC} 1"
exit 1
