#!/usr/bin/env bash
# ============================================================================
#  QUICK-OPS v3.0 - Operações rápidas via CLI
#  Uso: quick-ops.sh <comando> [args]
#  Comandos: start, stop, restart, status, health, logs, backup
#  Version: 3.0 (2026-01-21) - Enhanced error handling & exit codes
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
        if npm run daemon:start; then
            echo -e "${COLOR_GREEN}✓ PM2 processes started${COLOR_RESET}"
            echo -e "${COLOR_YELLOW}⏳ Waiting for services to be ready (5s)...${COLOR_RESET}"
            sleep 5
            "$0" health || { echo -e "${COLOR_RED}⚠ Services started but health checks failed${COLOR_RESET}"; exit 1; }
        else
            echo -e "${COLOR_RED}✗ Failed to start PM2 processes${COLOR_RESET}"
            exit 1
        fi
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
        response=$(curl -sS --max-time 3 http://localhost:2998/api/health 2>/dev/null || echo "")
        if [ -n "$response" ]; then
            # Use jq if available, fallback to node
            if command -v jq >/dev/null 2>&1; then
                status=$(echo "$response" | jq -r '.status // "unknown"' 2>/dev/null || echo "error")
                echo -e "  ${COLOR_GREEN}✓${COLOR_RESET} Status: $status"
                echo "$response" | jq -r 'to_entries | .[] | select(.key != "status") | "  \(.key): \(.value.status // .value)"' 2>/dev/null || true
            else
                echo "$response" | node -e "
                    const s=require('fs').readFileSync(0,'utf8');
                    try {
                        const j=JSON.parse(s);
                        console.log('  ✓ Status: '+j.status);
                        const components = Object.keys(j).filter(k=>k!=='status');
                        console.log('  Components: '+components.join(', '));
                    } catch(e) {
                        console.log('  [ERROR] Invalid response');
                        process.exit(1);
                    }
                " 2>/dev/null || echo -e "  ${COLOR_RED}✗ Failed to parse response${COLOR_RESET}"
            fi
        else
            echo -e "  ${COLOR_RED}✗ Health endpoint not responding${COLOR_RESET}"
            exit 1
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
        mkdir -p "backups/$BACKUP_NAME" || { echo -e "${COLOR_RED}✗ Failed to create backup directory${COLOR_RESET}"; exit 1; }

        files_backed=0
        for file in config.json controle.json dynamic_rules.json ecosystem.config.js; do
            if [ -f "$file" ]; then
                if cp -f "$file" "backups/$BACKUP_NAME/" 2>/dev/null; then
                    echo -e "  ${COLOR_GREEN}✓${COLOR_RESET} $file"
                    ((files_backed++))
                fi
            fi
        done

        if [ $files_backed -eq 0 ]; then
            echo -e "${COLOR_RED}✗ No files were backed up${COLOR_RESET}"
            exit 1
        fi

        echo -e "${COLOR_GREEN}✓ Backup complete: backups/$BACKUP_NAME ($files_backed files)${COLOR_RESET}"
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
