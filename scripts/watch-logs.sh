#!/bin/bash
# ============================================================================
#  WATCH-LOGS - Visualização de logs em tempo real com agregação
#  Uso: watch-logs.sh [filtro]
#  Filtro opcional: error, warn, info, debug
# ============================================================================

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR/.."

FILTER="${1:-}"

COLOR_CYAN="\033[96m"
COLOR_YELLOW="\033[93m"
COLOR_RESET="\033[0m"

echo -e "${COLOR_CYAN}============================================================${COLOR_RESET}"
echo -e "${COLOR_CYAN}  WATCH-LOGS - Monitoramento em Tempo Real${COLOR_RESET}"
echo -e "${COLOR_CYAN}============================================================${COLOR_RESET}"
echo ""

if [ -z "$FILTER" ]; then
    echo -e "${COLOR_YELLOW}Modo: TODOS os logs${COLOR_RESET}"
    echo "Pressione Ctrl+C para sair"
    echo ""
    sleep 2
    npx pm2 logs --raw --timestamp
else
    echo -e "${COLOR_YELLOW}Modo: Filtro '$FILTER'${COLOR_RESET}"
    echo "Pressione Ctrl+C para sair"
    echo ""
    sleep 2
    npx pm2 logs --raw --timestamp | grep -i "$FILTER"
fi

exit 0
