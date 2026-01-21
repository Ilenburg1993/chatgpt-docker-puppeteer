#!/bin/bash
# ============================================================================
#  QUICK-OPS - Operações rápidas via CLI
#  Uso: quick-ops.sh <comando> [args]
#  Comandos: start, stop, restart, status, health, logs, backup
# ============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR/.."

COLOR_GREEN="\033[92m"
COLOR_RED="\033[91m"
COLOR_YELLOW="\033[93m"
COLOR_RESET="\033[0m"

show_help() {
    echo ""
    echo "============================================================"
    echo "  QUICK-OPS - CLI para operações rápidas"
    echo "============================================================"
    echo ""
    echo "Uso: quick-ops.sh <comando> [args]"
    echo ""
    echo "Comandos disponíveis:"
    echo "  start      Inicia o sistema PM2"
    echo "  stop       Para o sistema PM2"
    echo "  restart    Reinicia com zero downtime"
    echo "  status     Mostra status PM2"
    echo "  health     Verifica health endpoints"
    echo "  logs [app] Mostra logs (opcional: app específico)"
    echo "  backup     Cria backup rápido de configs"
    echo "  help       Mostra esta ajuda"
    echo ""
    echo "Exemplos:"
    echo "  ./quick-ops.sh start"
    echo "  ./quick-ops.sh health"
    echo "  ./quick-ops.sh logs agente-gpt"
    echo "  ./quick-ops.sh backup"
    echo ""
}

if [ $# -eq 0 ]; then
    show_help
    exit 0
fi

COMMAND="$1"
ARG1="${2:-}"

case "$COMMAND" in
    start)
        echo -e "${COLOR_YELLOW}[QUICK-OPS] Iniciando sistema...${COLOR_RESET}"
        npm run daemon:start
        sleep 5
        "$0" health
        ;;

    stop)
        echo -e "${COLOR_YELLOW}[QUICK-OPS] Parando sistema...${COLOR_RESET}"
        npm run daemon:stop
        ;;

    restart)
        echo -e "${COLOR_YELLOW}[QUICK-OPS] Reiniciando sistema (zero downtime)...${COLOR_RESET}"
        npm run daemon:reload
        ;;

    status)
        echo -e "${COLOR_YELLOW}[QUICK-OPS] Status PM2:${COLOR_RESET}"
        npx pm2 list
        ;;

    health)
        echo -e "${COLOR_YELLOW}[QUICK-OPS] Health Check:${COLOR_RESET}"
        response=$(curl -s http://localhost:2998/api/health 2>/dev/null)
        if [ -n "$response" ]; then
            echo "$response" | node -e "
                const s=require('fs').readFileSync(0,'utf8');
                try {
                    const j=JSON.parse(s);
                    console.log('  Status: '+j.status);
                    const components = Object.keys(j).filter(k=>k!=='status');
                    console.log('  Components: '+components.join(', '));
                } catch(e) {
                    console.log('  [ERROR] Invalid response');
                }
            " 2>/dev/null || echo -e "  ${COLOR_RED}[ERROR] Failed to parse response${COLOR_RESET}"
        else
            echo -e "  ${COLOR_RED}[ERROR] Health endpoint not responding${COLOR_RESET}"
        fi
        ;;

    logs)
        if [ -z "$ARG1" ]; then
            echo -e "${COLOR_YELLOW}[QUICK-OPS] Logs PM2 (Ctrl+C para sair):${COLOR_RESET}"
            npx pm2 logs --lines 50
        else
            echo -e "${COLOR_YELLOW}[QUICK-OPS] Logs de $ARG1:${COLOR_RESET}"
            npx pm2 logs "$ARG1" --lines 50
        fi
        ;;

    backup)
        echo -e "${COLOR_YELLOW}[QUICK-OPS] Criando backup...${COLOR_RESET}"
        BACKUP_NAME="quickops-$(date +%Y%m%d-%H%M%S)-$$"
        mkdir -p "backups/$BACKUP_NAME"
        cp -f config.json "backups/$BACKUP_NAME/" 2>/dev/null || true
        cp -f controle.json "backups/$BACKUP_NAME/" 2>/dev/null || true
        cp -f dynamic_rules.json "backups/$BACKUP_NAME/" 2>/dev/null || true
        echo -e "${COLOR_GREEN}[SUCCESS] Backup: backups/$BACKUP_NAME${COLOR_RESET}"
        ;;

    help)
        show_help
        ;;

    *)
        echo -e "${COLOR_RED}[ERROR] Comando desconhecido: $COMMAND${COLOR_RESET}"
        show_help
        exit 1
        ;;
esac

exit 0
