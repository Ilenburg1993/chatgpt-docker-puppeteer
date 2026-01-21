#!/bin/bash
# ============================================================================
#  SUPER LAUNCHER v2.0 - ChatGPT Docker Puppeteer
#  Audit Level: PM2-First Strategy (Opção A)
#  Estratégia: Menu interativo + validações + health checks + automações
# ============================================================================

set -euo pipefail

# ============================================================================
#  CONFIGURAÇÕES GLOBAIS
# ============================================================================
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

SERVER_PORT=2998
HEALTH_URL="http://localhost:${SERVER_PORT}/api/health"
CHROME_CONFIG="chrome-config.json"
BACKUP_DIR="backups/launcher-$(date +%Y%m%d-%H%M%S)"
LOG_FILE="logs/launcher.log"

# ============================================================================
#  CORES E FORMATAÇÃO
# ============================================================================
COLOR_RESET='\033[0m'
COLOR_GREEN='\033[92m'
COLOR_RED='\033[91m'
COLOR_YELLOW='\033[93m'
COLOR_CYAN='\033[96m'
COLOR_BOLD='\033[1m'

# ============================================================================
#  FUNÇÕES AUXILIARES
# ============================================================================
print_header() {
    clear
    echo -e "${COLOR_CYAN}============================================================${COLOR_RESET}"
    echo -e "${COLOR_BOLD}          SUPER LAUNCHER v2.0 - ChatGPT Puppeteer${COLOR_RESET}"
    echo -e "${COLOR_CYAN}============================================================${COLOR_RESET}"
}

print_section() {
    echo -e "${COLOR_CYAN}============================================================${COLOR_RESET}"
    echo -e "${COLOR_BOLD}  $1${COLOR_RESET}"
    echo -e "${COLOR_CYAN}============================================================${COLOR_RESET}"
}

check_command() {
    if command -v "$1" &> /dev/null; then
        echo -e "        ${COLOR_GREEN}✓${COLOR_RESET} $2 detectado"
        return 0
    else
        echo -e "        ${COLOR_RED}✗${COLOR_RESET} $2 não encontrado!"
        return 1
    fi
}

# ============================================================================
#  MENU PRINCIPAL
# ============================================================================
main_menu() {
    while true; do
        print_header
        echo ""
        echo -e " ${COLOR_GREEN}[1]${COLOR_RESET} Start System          ${COLOR_YELLOW}(boot completo com validações)${COLOR_RESET}"
        echo -e " ${COLOR_GREEN}[2]${COLOR_RESET} Stop System           ${COLOR_YELLOW}(shutdown gracioso PM2)${COLOR_RESET}"
        echo -e " ${COLOR_GREEN}[3]${COLOR_RESET} Restart System        ${COLOR_YELLOW}(reload sem downtime)${COLOR_RESET}"
        echo -e " ${COLOR_GREEN}[4]${COLOR_RESET} Status Check          ${COLOR_YELLOW}(health + PM2 + Chrome)${COLOR_RESET}"
        echo -e " ${COLOR_GREEN}[5]${COLOR_RESET} View Logs             ${COLOR_YELLOW}(tail agregado em tempo real)${COLOR_RESET}"
        echo -e " ${COLOR_GREEN}[6]${COLOR_RESET} Open PM2 GUI          ${COLOR_YELLOW}(interface gráfica Electron)${COLOR_RESET}"
        echo -e " ${COLOR_GREEN}[7]${COLOR_RESET} PM2 Monit             ${COLOR_YELLOW}(dashboard CLI oficial)${COLOR_RESET}"
        echo -e " ${COLOR_GREEN}[8]${COLOR_RESET} Clean System          ${COLOR_YELLOW}(limpar logs/tmp/cache)${COLOR_RESET}"
        echo -e " ${COLOR_GREEN}[9]${COLOR_RESET} Diagnose Crashes      ${COLOR_YELLOW}(análise forense automática)${COLOR_RESET}"
        echo -e " ${COLOR_GREEN}[10]${COLOR_RESET} Backup Configuration ${COLOR_YELLOW}(snapshot de configs críticos)${COLOR_RESET}"
        echo ""
        echo -e " ${COLOR_RED}[0]${COLOR_RESET} Exit"
        echo ""
        echo -e "${COLOR_CYAN}============================================================${COLOR_RESET}"
        echo ""

        read -p "Escolha uma opção: " choice

        case "$choice" in
            1) start_system ;;
            2) stop_system ;;
            3) restart_system ;;
            4) status_check ;;
            5) view_logs ;;
            6) open_pm2_gui ;;
            7) pm2_monit ;;
            8) clean_system ;;
            9) diagnose_crashes ;;
            10) backup_config ;;
            0) exit 0 ;;
            *)
                echo -e "${COLOR_RED}[ERRO] Opção inválida!${COLOR_RESET}"
                sleep 2
                ;;
        esac
    done
}

# ============================================================================
#  [1] START SYSTEM - Boot completo com validações
# ============================================================================
start_system() {
    clear
    print_section "INICIANDO SISTEMA - Validações Pré-Boot"
    echo ""

    # --- Validação 1: Node.js ---
    echo -e "${COLOR_YELLOW}[1/5] Verificando Node.js...${COLOR_RESET}"
    if check_command node "Node.js $(node --version)"; then
        echo ""
    else
        echo "        Instale em: https://nodejs.org/"
        read -p "Pressione ENTER para continuar..."
        return
    fi

    # --- Validação 2: PM2 ---
    echo -e "${COLOR_YELLOW}[2/5] Verificando PM2...${COLOR_RESET}"
    if npm list -g pm2 &> /dev/null; then
        echo -e "        ${COLOR_GREEN}✓${COLOR_RESET} PM2 instalado"
        echo ""
    else
        echo -e "        ${COLOR_RED}✗${COLOR_RESET} PM2 não encontrado!"
        echo "        Execute: npm install -g pm2"
        read -p "Pressione ENTER para continuar..."
        return
    fi

    # --- Validação 3: Dependências Node ---
    echo -e "${COLOR_YELLOW}[3/5] Verificando dependências...${COLOR_RESET}"
    if [ ! -d "node_modules" ]; then
        echo -e "        ${COLOR_YELLOW}Instalando dependências...${COLOR_RESET}"
        npm install
    fi
    echo -e "        ${COLOR_GREEN}✓${COLOR_RESET} Dependências OK"
    echo ""

    # --- Validação 4: Chrome Config ---
    echo -e "${COLOR_YELLOW}[4/5] Verificando Chrome config...${COLOR_RESET}"
    if [ ! -f "$CHROME_CONFIG" ]; then
        echo -e "        ${COLOR_YELLOW}Gerando chrome-config.json...${COLOR_RESET}"
        node -e "const CO = require('./src/infra/ConnectionOrchestrator'); CO.exportConfigForLauncher();"
    fi
    echo -e "        ${COLOR_GREEN}✓${COLOR_RESET} Chrome config disponível"
    echo ""

    # --- Validação 5: Crash Detection ---
    echo -e "${COLOR_YELLOW}[5/5] Verificando crashes anteriores...${COLOR_RESET}"
    if [ -d "logs/crash_reports" ]; then
        CRASH_COUNT=$(find logs/crash_reports -name "*.txt" 2>/dev/null | wc -l)
        if [ "$CRASH_COUNT" -gt 0 ]; then
            echo -e "        ${COLOR_RED}⚠ $CRASH_COUNT crash(es) detectado(s)!${COLOR_RESET}"
            echo "        Execute opção [9] para diagnóstico"
        else
            echo -e "        ${COLOR_GREEN}✓${COLOR_RESET} Sem crashes recentes"
        fi
    else
        echo -e "        ${COLOR_GREEN}✓${COLOR_RESET} Sem crashes recentes"
    fi
    echo ""

    # --- Backup Automático ---
    echo -e "${COLOR_YELLOW}[AUTO] Backup de segurança...${COLOR_RESET}"
    BACKUP_NAME="pre-start-$(date +%Y%m%d-%H%M%S)"
    mkdir -p "backups/$BACKUP_NAME"
    cp config.json "backups/$BACKUP_NAME/" 2>/dev/null || true
    cp controle.json "backups/$BACKUP_NAME/" 2>/dev/null || true
    cp dynamic_rules.json "backups/$BACKUP_NAME/" 2>/dev/null || true
    echo -e "        ${COLOR_GREEN}✓${COLOR_RESET} Backup: backups/$BACKUP_NAME"
    echo ""

    # --- Inicialização PM2 ---
    print_section "INICIANDO PM2 DAEMON"
    echo ""

    npm run daemon:start

    echo ""
    echo -e "${COLOR_YELLOW}Aguardando serviços iniciarem (10s)...${COLOR_RESET}"
    sleep 10

    # --- Health Check ---
    echo ""
    echo -e "${COLOR_YELLOW}Validando health checks...${COLOR_RESET}"
    if curl -s "$HEALTH_URL" > /dev/null 2>&1; then
        echo -e "${COLOR_GREEN}✓ Sistema operacional!${COLOR_RESET}"
    else
        echo -e "${COLOR_RED}[AVISO] Health endpoint não responde${COLOR_RESET}"
        echo "        Sistema pode estar iniciando..."
    fi

    echo ""
    echo -e "${COLOR_GREEN}============================================================${COLOR_RESET}"
    echo -e "${COLOR_GREEN}  ✓ SISTEMA INICIADO COM SUCESSO!${COLOR_RESET}"
    echo -e "${COLOR_GREEN}============================================================${COLOR_RESET}"
    echo ""
    echo "  Dashboard: http://localhost:$SERVER_PORT"
    echo "  PM2 Status: npm run queue:status"
    echo "  Logs: Option [5] no menu"
    echo ""
    read -p "Pressione ENTER para continuar..."
}

# ============================================================================
#  [2] STOP SYSTEM - Shutdown gracioso PM2
# ============================================================================
stop_system() {
    clear
    print_section "PARANDO SISTEMA"
    echo ""

    npm run daemon:stop

    echo ""
    echo -e "${COLOR_GREEN}✓ Sistema parado com sucesso!${COLOR_RESET}"
    echo ""
    read -p "Pressione ENTER para continuar..."
}

# ============================================================================
#  [3] RESTART SYSTEM - Reload sem downtime
# ============================================================================
restart_system() {
    clear
    print_section "REINICIANDO SISTEMA (Zero Downtime)"
    echo ""

    npm run daemon:reload

    echo ""
    echo -e "${COLOR_GREEN}✓ Sistema reiniciado!${COLOR_RESET}"
    echo ""
    read -p "Pressione ENTER para continuar..."
}

# ============================================================================
#  [4] STATUS CHECK - Health + PM2 + Chrome
# ============================================================================
status_check() {
    clear
    print_section "STATUS DO SISTEMA"
    echo ""

    # --- PM2 Status ---
    echo -e "${COLOR_YELLOW}[PM2 Processes]${COLOR_RESET}"
    if npx pm2 jlist > temp_pm2.json 2>/dev/null; then
        node -e "
            const fs = require('fs');
            const processes = JSON.parse(fs.readFileSync('temp_pm2.json'));
            processes.forEach(p => {
                const mem = (p.monit.memory / 1024 / 1024).toFixed(0);
                console.log('  ' + p.name + ': ' + p.pm2_env.status + ' (PID: ' + p.pid + ', Memory: ' + mem + 'MB)');
            });
        " 2>/dev/null || echo "  Erro ao processar status"
        rm -f temp_pm2.json
    else
        echo -e "  ${COLOR_RED}PM2 não está rodando${COLOR_RESET}"
    fi
    echo ""

    # --- Health Endpoints ---
    echo -e "${COLOR_YELLOW}[Health Checks]${COLOR_RESET}"

    curl -s "$HEALTH_URL/chrome" 2>/dev/null | node -e "
        const stdin = process.stdin;
        let data = '';
        stdin.on('data', chunk => data += chunk);
        stdin.on('end', () => {
            try {
                const j = JSON.parse(data);
                console.log('  Chrome: ' + j.status);
            } catch(e) {}
        });
    " 2>/dev/null || echo "  Chrome: unavailable"

    curl -s "$HEALTH_URL/pm2" 2>/dev/null | node -e "
        const stdin = process.stdin;
        let data = '';
        stdin.on('data', chunk => data += chunk);
        stdin.on('end', () => {
            try {
                const j = JSON.parse(data);
                console.log('  PM2: ' + j.status);
            } catch(e) {}
        });
    " 2>/dev/null || echo "  PM2: unavailable"

    curl -s "$HEALTH_URL/kernel" 2>/dev/null | node -e "
        const stdin = process.stdin;
        let data = '';
        stdin.on('data', chunk => data += chunk);
        stdin.on('end', () => {
            try {
                const j = JSON.parse(data);
                console.log('  Kernel: ' + j.status);
            } catch(e) {}
        });
    " 2>/dev/null || echo "  Kernel: unavailable"

    curl -s "$HEALTH_URL/disk" 2>/dev/null | node -e "
        const stdin = process.stdin;
        let data = '';
        stdin.on('data', chunk => data += chunk);
        stdin.on('end', () => {
            try {
                const j = JSON.parse(data);
                console.log('  Disk: ' + j.status + ' (' + j.usage.total.mb + 'MB)');
            } catch(e) {}
        });
    " 2>/dev/null || echo "  Disk: unavailable"
    echo ""

    # --- Queue Status ---
    echo -e "${COLOR_YELLOW}[Queue Status]${COLOR_RESET}"
    npm run queue:status --silent 2>/dev/null | grep -iE "pending|running|done|failed" || echo "  Queue info unavailable"
    echo ""

    echo -e "${COLOR_CYAN}============================================================${COLOR_RESET}"
    read -p "Pressione ENTER para continuar..."
}

# ============================================================================
#  [5] VIEW LOGS - Tail agregado
# ============================================================================
view_logs() {
    clear
    print_section "VISUALIZAR LOGS (Ctrl+C para sair)"
    echo ""
    echo "Escolha o tipo de log:"
    echo ""
    echo " [1] PM2 Logs (agente + dashboard)"
    echo " [2] Error Logs"
    echo " [3] Application Logs"
    echo " [4] Todos os logs"
    echo ""
    read -p "Opção: " log_choice

    case "$log_choice" in
        1) npx pm2 logs ;;
        2) tail -f logs/error.log 2>/dev/null || echo "Arquivo não existe" ;;
        3) tail -f logs/application.log 2>/dev/null || echo "Arquivo não existe" ;;
        4) npx pm2 logs --raw --lines 100 ;;
        *)
            echo "Opção inválida"
            sleep 2
            ;;
    esac
}

# ============================================================================
#  [6] OPEN PM2 GUI - Interface gráfica Electron
# ============================================================================
open_pm2_gui() {
    clear
    print_section "PM2 GUI (Interface Gráfica)"
    echo ""

    if command -v pm2-gui &> /dev/null; then
        echo "Abrindo pm2-gui..."
        pm2-gui &
    else
        echo -e "${COLOR_YELLOW}pm2-gui não está instalado.${COLOR_RESET}"
        echo ""
        read -p "Deseja instalar agora? (s/N): " install_gui
        if [[ "$install_gui" =~ ^[Ss]$ ]]; then
            echo ""
            echo "Instalando pm2-gui..."
            npm install -g pm2-gui
            echo ""
            echo -e "${COLOR_GREEN}✓ Instalação concluída!${COLOR_RESET}"
            echo "Abrindo pm2-gui..."
            pm2-gui &
        fi
    fi

    echo ""
    read -p "Pressione ENTER para continuar..."
}

# ============================================================================
#  [7] PM2 MONIT - Dashboard CLI oficial
# ============================================================================
pm2_monit() {
    clear
    print_section "PM2 MONIT (Dashboard Interativo)"
    echo ""
    echo "Pressione Ctrl+C para sair"
    sleep 2
    npx pm2 monit
}

# ============================================================================
#  [8] CLEAN SYSTEM - Limpar logs/tmp/cache
# ============================================================================
clean_system() {
    clear
    print_section "LIMPEZA DO SISTEMA"
    echo ""
    echo -e "${COLOR_RED}ATENÇÃO: Esta operação irá remover:${COLOR_RESET}"
    echo "  - Logs antigos (mantém últimos 7 dias)"
    echo "  - Arquivos temporários (.tmp)"
    echo "  - Cache PM2"
    echo "  - Crash reports processados"
    echo ""
    read -p "Confirma limpeza? (s/N): " confirm

    if [[ ! "$confirm" =~ ^[Ss]$ ]]; then
        echo "Operação cancelada."
        read -p "Pressione ENTER para continuar..."
        return
    fi

    echo ""
    echo "Executando limpeza..."
    npm run clean

    echo ""
    echo -e "${COLOR_GREEN}✓ Limpeza concluída!${COLOR_RESET}"
    echo ""
    read -p "Pressione ENTER para continuar..."
}

# ============================================================================
#  [9] DIAGNOSE CRASHES - Análise forense automática
# ============================================================================
diagnose_crashes() {
    clear
    print_section "DIAGNÓSTICO DE CRASHES"
    echo ""

    if [ ! -d "logs/crash_reports" ] || [ -z "$(ls -A logs/crash_reports 2>/dev/null)" ]; then
        echo -e "${COLOR_GREEN}✓ Nenhum crash detectado!${COLOR_RESET}"
        echo ""
        read -p "Pressione ENTER para continuar..."
        return
    fi

    echo "Analisando crash reports..."
    echo ""

    for crash_file in logs/crash_reports/*.txt; do
        if [ -f "$crash_file" ]; then
            echo -e "${COLOR_YELLOW}Crash: $(basename "$crash_file")${COLOR_RESET}"
            grep -iE "error|exception|failed" "$crash_file" | head -n 5
            echo ""
        fi
    done

    echo ""
    echo "Executando diagnóstico completo..."
    npm run diagnose

    echo ""
    read -p "Pressione ENTER para continuar..."
}

# ============================================================================
#  [10] BACKUP CONFIGURATION - Snapshot de configs críticos
# ============================================================================
backup_config() {
    clear
    print_section "BACKUP DE CONFIGURAÇÕES"
    echo ""

    BACKUP_NAME="manual-$(date +%Y%m%d-%H%M%S)"
    BACKUP_PATH="backups/$BACKUP_NAME"

    echo "Criando backup: $BACKUP_NAME"
    echo ""

    mkdir -p "$BACKUP_PATH"

    # Copiar configs críticos
    echo "Copiando arquivos..."
    cp config.json "$BACKUP_PATH/" 2>/dev/null && echo -e "  ${COLOR_GREEN}✓${COLOR_RESET} config.json"
    cp controle.json "$BACKUP_PATH/" 2>/dev/null && echo -e "  ${COLOR_GREEN}✓${COLOR_RESET} controle.json"
    cp dynamic_rules.json "$BACKUP_PATH/" 2>/dev/null && echo -e "  ${COLOR_GREEN}✓${COLOR_RESET} dynamic_rules.json"
    cp ecosystem.config.js "$BACKUP_PATH/" 2>/dev/null && echo -e "  ${COLOR_GREEN}✓${COLOR_RESET} ecosystem.config.js"
    cp chrome-config.json "$BACKUP_PATH/" 2>/dev/null && echo -e "  ${COLOR_GREEN}✓${COLOR_RESET} chrome-config.json"
    cp package.json "$BACKUP_PATH/" 2>/dev/null && echo -e "  ${COLOR_GREEN}✓${COLOR_RESET} package.json"

    # Backup da fila
    echo ""
    echo "Backupeando fila..."
    if [ -d "fila" ]; then
        mkdir -p "$BACKUP_PATH/fila"
        cp fila/*.json "$BACKUP_PATH/fila/" 2>/dev/null || true
        TASK_COUNT=$(find fila -name "*.json" 2>/dev/null | wc -l)
        echo -e "  ${COLOR_GREEN}✓${COLOR_RESET} $TASK_COUNT tarefas copiadas"
    fi

    echo ""
    echo -e "${COLOR_GREEN}============================================================${COLOR_RESET}"
    echo -e "${COLOR_GREEN}  ✓ BACKUP CONCLUÍDO!${COLOR_RESET}"
    echo -e "${COLOR_GREEN}============================================================${COLOR_RESET}"
    echo ""
    echo "  Local: $BACKUP_PATH"
    echo "  Arquivos: config, controle, dynamic_rules, ecosystem, chrome-config, fila"
    echo ""
    read -p "Pressione ENTER para continuar..."
}

# ============================================================================
#  INICIALIZAÇÃO
# ============================================================================
main_menu
