#!/usr/bin/env bash
# ============================================================================
#  CHROME PROXY LAUNCHER - Linux Reference Script
#  Version: 1.0 (2026-01-30)
#
#  ⚠️  IMPORTANTE - CENÁRIO CANÔNICO:
#
#  Este script é apenas REFERÊNCIA para ambientes Linux standalone.
#
#  No cenário canônico do projeto (Container Docker + Chrome Windows),
#  o Chrome e o Proxy rodam no Windows HOST, não no container Linux.
#
#  Container Linux → http://192.168.0.2:9224 → Proxy (Windows) → Chrome (Windows)
#
#  QUANDO USAR ESTE SCRIPT:
#  - Desenvolvimento local Linux (fora de Docker)
#  - Testes em máquina Linux standalone
#  - CI/CD em ambiente Linux nativo
#
#  QUANDO NÃO USAR:
#  - Container Docker (use start-chrome-proxy.bat no Windows host)
#  - DevContainer VSCode (Chrome roda no host Windows)
#
# ============================================================================

set -euo pipefail

# ============================================================================
#  CONFIGURAÇÕES
# ============================================================================
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$SCRIPT_DIR"

CHROME_DEBUG_PORT="${CHROME_PORT:-9225}"
PROXY_PORT="${PROXY_PORT:-9224}"
PUBLIC_IP="${PUBLIC_IP:-}"
MAX_WAIT_SECONDS=15

# Cores
COLOR_RESET='\033[0m'
COLOR_GREEN='\033[92m'
COLOR_RED='\033[91m'
COLOR_YELLOW='\033[93m'
COLOR_CYAN='\033[96m'
COLOR_BOLD='\033[1m'

# ============================================================================
#  FUNÇÕES
# ============================================================================
print_header() {
    echo -e "${COLOR_CYAN}════════════════════════════════════════════════════════════════${COLOR_RESET}"
    echo -e "${COLOR_BOLD}  CHROME PROXY LAUNCHER - Linux${COLOR_RESET}"
    echo -e "${COLOR_CYAN}════════════════════════════════════════════════════════════════${COLOR_RESET}"
}

log_info() {
    echo -e "${COLOR_CYAN}[INFO]${COLOR_RESET} $1"
}

log_success() {
    echo -e "${COLOR_GREEN}[OK]${COLOR_RESET} $1"
}

log_error() {
    echo -e "${COLOR_RED}[ERRO]${COLOR_RESET} $1"
}

log_warning() {
    echo -e "${COLOR_YELLOW}[WARN]${COLOR_RESET} $1"
}

# ============================================================================
#  VALIDAÇÕES
# ============================================================================
check_environment() {
    echo
    log_info "Verificando ambiente Linux..."

    # Node.js
    if ! command -v node &> /dev/null; then
        log_error "Node.js não encontrado!"
        echo
        echo "Instale Node.js 20+: https://nodejs.org/"
        exit 1
    fi
    log_success "Node.js $(node --version)"

    # Chrome/Chromium
    CHROME_PATH=""
    if command -v google-chrome &> /dev/null; then
        CHROME_PATH="$(command -v google-chrome)"
    elif command -v chromium &> /dev/null; then
        CHROME_PATH="$(command -v chromium)"
    elif command -v chromium-browser &> /dev/null; then
        CHROME_PATH="$(command -v chromium-browser)"
    fi

    if [ -z "$CHROME_PATH" ]; then
        log_error "Chrome/Chromium não encontrado!"
        echo
        echo "Instale Chrome ou Chromium:"
        echo "  Ubuntu/Debian: sudo apt install chromium-browser"
        echo "  Fedora:        sudo dnf install chromium"
        echo "  Arch:          sudo pacman -S chromium"
        exit 1
    fi
    log_success "Chrome/Chromium: $CHROME_PATH"

    # Proxy script
    if [ ! -f "scripts/chrome-proxy-service.js" ]; then
        log_error "Proxy script não encontrado: scripts/chrome-proxy-service.js"
        exit 1
    fi
    log_success "Proxy script encontrado"
}

detect_public_ip() {
    echo
    log_info "Detectando IP público..."

    # Tenta hostname -I (Linux)
    if PUBLIC_IP=$(hostname -I 2>/dev/null | awk '{print $1}'); then
        if [ -n "$PUBLIC_IP" ] && [ "$PUBLIC_IP" != "127.0.0.1" ]; then
            log_success "IP detectado: $PUBLIC_IP"
            return 0
        fi
    fi

    # Tenta ip route
    if PUBLIC_IP=$(ip route get 1 2>/dev/null | awk '{print $7; exit}'); then
        if [ -n "$PUBLIC_IP" ] && [ "$PUBLIC_IP" != "127.0.0.1" ]; then
            log_success "IP detectado: $PUBLIC_IP"
            return 0
        fi
    fi

    # Fallback
    PUBLIC_IP="192.168.0.2"
    log_warning "Não foi possível detectar IP, usando padrão: $PUBLIC_IP"
}

start_chrome() {
    echo
    log_info "Verificando Chrome na porta $CHROME_DEBUG_PORT..."

    if curl -s --connect-timeout 2 "http://localhost:$CHROME_DEBUG_PORT/json/version" &>/dev/null; then
        log_success "Chrome já está rodando"
        return 0
    fi

    log_info "Iniciando Chrome com remote debugging..."

    # Inicia Chrome em background
    nohup "$CHROME_PATH" \
        --remote-debugging-port="$CHROME_DEBUG_PORT" \
        --user-data-dir="$HOME/.chrome-debug-profile" \
        --no-first-run \
        --no-default-browser-check \
        --disable-features=TranslateUI \
        --disable-sync \
        --headless=new \
        > /dev/null 2>&1 &

    # Aguarda Chrome iniciar
    local waited=0
    while [ $waited -lt $MAX_WAIT_SECONDS ]; do
        if curl -s --connect-timeout 1 "http://localhost:$CHROME_DEBUG_PORT/json/version" &>/dev/null; then
            log_success "Chrome iniciado com sucesso!"
            return 0
        fi
        sleep 1
        ((waited++))
    done

    log_error "Timeout: Chrome não iniciou em ${MAX_WAIT_SECONDS}s"
    return 1
}

start_proxy() {
    echo
    log_info "Verificando Proxy na porta $PROXY_PORT..."

    if curl -s --connect-timeout 2 "http://localhost:$PROXY_PORT/json/version" &>/dev/null; then
        log_success "Proxy já está rodando"
        return 0
    fi

    log_info "Iniciando Chrome Proxy Service..."

    # Inicia proxy em background
    nohup node scripts/chrome-proxy-service.js "$PUBLIC_IP" info > /dev/null 2>&1 &
    local PROXY_PID=$!
    echo "$PROXY_PID" > /tmp/chrome-proxy.pid

    # Aguarda proxy iniciar
    local waited=0
    while [ $waited -lt $MAX_WAIT_SECONDS ]; do
        if curl -s --connect-timeout 1 "http://localhost:$PROXY_PORT/json/version" &>/dev/null; then
            log_success "Proxy iniciado com sucesso (PID: $PROXY_PID)"
            return 0
        fi
        sleep 1
        ((waited++))
    done

    log_error "Timeout: Proxy não iniciou em ${MAX_WAIT_SECONDS}s"
    return 1
}

health_checks() {
    echo
    log_info "Executando health checks..."

    # Chrome direto
    if curl -s "http://localhost:$CHROME_DEBUG_PORT/json/version" &>/dev/null; then
        log_success "Chrome respondendo em http://localhost:$CHROME_DEBUG_PORT"
    else
        log_error "Chrome não está respondendo!"
        return 1
    fi

    # Proxy local
    if curl -s "http://localhost:$PROXY_PORT/json/version" &>/dev/null; then
        log_success "Proxy respondendo em http://localhost:$PROXY_PORT"
    else
        log_error "Proxy não está respondendo!"
        return 1
    fi

    # Proxy via IP público
    if curl -s "http://$PUBLIC_IP:$PROXY_PORT/json/version" &>/dev/null; then
        log_success "Proxy acessível via IP público: http://$PUBLIC_IP:$PROXY_PORT"
    else
        log_warning "Proxy não acessível via IP público (pode ser firewall)"
    fi

    # Validar URL rewriting
    local response
    response=$(curl -s "http://localhost:$PROXY_PORT/json/version")
    if echo "$response" | grep -q "$PUBLIC_IP:$PROXY_PORT"; then
        log_success "URL rewriting funcionando (localhost → $PUBLIC_IP)"
    else
        log_warning "URL rewriting pode não estar funcionando"
    fi

    return 0
}

# ============================================================================
#  MAIN
# ============================================================================
main() {
    print_header
    echo

    check_environment
    detect_public_ip
    start_chrome || exit 1
    start_proxy || exit 1
    health_checks || exit 1

    echo
    echo -e "${COLOR_GREEN}════════════════════════════════════════════════════════════════${COLOR_RESET}"
    echo -e "${COLOR_GREEN}  ✅ SISTEMA INICIADO COM SUCESSO!${COLOR_RESET}"
    echo -e "${COLOR_GREEN}════════════════════════════════════════════════════════════════${COLOR_RESET}"
    echo
    echo -e "${COLOR_CYAN}[CONFIGURAÇÃO]${COLOR_RESET}"
    echo "  • IP Público:              $PUBLIC_IP"
    echo "  • Chrome Debug Port:       $CHROME_DEBUG_PORT"
    echo "  • Proxy Port:              $PROXY_PORT"
    echo
    echo -e "${COLOR_CYAN}[SERVIÇOS ATIVOS]${COLOR_RESET}"
    echo "  • Chrome Remote Debugging: http://localhost:$CHROME_DEBUG_PORT"
    echo "  • Chrome Proxy Service:    http://$PUBLIC_IP:$PROXY_PORT"
    echo "  • WebSocket Endpoint:      ws://$PUBLIC_IP:$PROXY_PORT/devtools/..."
    echo
    echo -e "${COLOR_CYAN}[TESTE]${COLOR_RESET}"
    echo "  curl http://$PUBLIC_IP:$PROXY_PORT/json/version"
    echo
    echo -e "${COLOR_CYAN}[PARAR SERVIÇOS]${COLOR_RESET}"
    echo "  pkill -f 'chrome.*remote-debugging-port=$CHROME_DEBUG_PORT'"
    echo "  kill \$(cat /tmp/chrome-proxy.pid 2>/dev/null || echo '')"
    echo
}

# ============================================================================
#  TRAP
# ============================================================================
cleanup() {
    echo
    log_info "Limpando recursos..."

    if [ -f /tmp/chrome-proxy.pid ]; then
        local pid
        pid=$(cat /tmp/chrome-proxy.pid 2>/dev/null || echo '')
        if [ -n "$pid" ]; then
            kill "$pid" 2>/dev/null || true
        fi
        rm -f /tmp/chrome-proxy.pid
    fi
}

trap cleanup EXIT INT TERM

# ============================================================================
#  EXECUTE
# ============================================================================
main "$@"
