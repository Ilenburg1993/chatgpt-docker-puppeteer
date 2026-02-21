#!/usr/bin/env bash
# ============================================================================
#  WATCH-LOGS v3.0 - Visualização de logs em tempo real com agregação
#  Uso: watch-logs.sh [filtro]
#  Filtro opcional: error, warn, info, debug, all
#  Version: 3.0 (2026-01-21) - Enhanced filtering & color coding
# ============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR/.."

FILTER="${1:-}"

COLOR_CYAN="\033[96m"
COLOR_YELLOW="\033[93m"
COLOR_RED="\033[91m"
COLOR_GREEN="\033[92m"
COLOR_RESET="\033[0m"

# Check if PM2 is available
if ! command -v pm2 >/dev/null 2>&1; then
    echo -e "${COLOR_RED}✗ PM2 not found! Install with: npm install -g pm2${COLOR_RESET}"
    exit 1
fi

echo -e "${COLOR_CYAN}============================================================${COLOR_RESET}"
echo -e "${COLOR_CYAN}  WATCH-LOGS - Monitoramento em Tempo Real${COLOR_RESET}"
echo -e "${COLOR_CYAN}============================================================${COLOR_RESET}"
echo ""

if [ -z "$FILTER" ] || [ "$FILTER" = "all" ]; then
    echo -e "${COLOR_YELLOW}Modo: TODOS os logs${COLOR_RESET}"
    echo -e "${COLOR_CYAN}Dica: Use 'error', 'warn', 'info' ou 'debug' como filtro${COLOR_RESET}"
    echo "Pressione Ctrl+C para sair"
    echo ""
    sleep 2
    npx pm2 logs --raw --timestamp --lines 100 || { echo -e "${COLOR_RED}✗ Failed to read PM2 logs${COLOR_RESET}"; exit 1; }
else
    echo -e "${COLOR_YELLOW}Modo: Filtro '$FILTER'${COLOR_RESET}"
    echo "Pressione Ctrl+C para sair"
    echo ""

    # Color code based on filter level
    case "$FILTER" in
        error|ERROR)
            echo -e "${COLOR_RED}Mostrando apenas ERROs...${COLOR_RESET}"
            ;;
        warn|WARN|warning|WARNING)
            echo -e "${COLOR_YELLOW}Mostrando apenas WARNINGs...${COLOR_RESET}"
            ;;
        info|INFO)
            echo -e "${COLOR_GREEN}Mostrando apenas INFO...${COLOR_RESET}"
            ;;
        debug|DEBUG)
            echo -e "${COLOR_CYAN}Mostrando apenas DEBUG...${COLOR_RESET}"
            ;;
    esac

    sleep 2
    npx pm2 logs --raw --timestamp --lines 100 | grep -i "$FILTER" --color=always || {
        echo -e "${COLOR_YELLOW}⚠ No logs matching filter '$FILTER'${COLOR_RESET}"
        exit 0
    }
fi

exit 0
