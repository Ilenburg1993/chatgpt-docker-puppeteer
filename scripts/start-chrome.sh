#!/usr/bin/env bash
# ============================================================================
#  CHROME LAUNCHER - Automated Chrome Startup with Remote Debugging
#  Version: 1.0 (2026-01-29)
#  Audit Level: Infrastructure Automation
# ============================================================================
#
#  Responsabilidade:
#  - Detecta se Chrome já está rodando com remote debugging
#  - Inicia Chrome automaticamente se necessário
#  - Suporta Windows (via cmd.exe) e Linux
#  - Valida conectividade antes de retornar
#
# ============================================================================

set -euo pipefail

# ============================================================================
#  CONFIGURAÇÕES
# ============================================================================
# Porta do Chrome no host (use CHROME_PORT para sobrescrever). Padrão: 9225
CHROME_PORT="${CHROME_PORT:-9225}"
CHROME_DEBUG_PORT="${CHROME_PORT}"
CHROME_USER_DATA_DIR="${CHROME_USER_DATA_DIR:-$HOME/.chrome-debug-profile}"
HEALTH_CHECK_URL="http://localhost:${CHROME_DEBUG_PORT}/json/version"
MAX_WAIT_SECONDS=10

# Cores
GREEN='\033[92m'
RED='\033[91m'
YELLOW='\033[93m'
CYAN='\033[96m'
RESET='\033[0m'

# ============================================================================
#  FUNÇÕES AUXILIARES
# ============================================================================

log_info() {
    echo -e "${CYAN}ℹ️  $1${RESET}"
}

log_success() {
    echo -e "${GREEN}✓ $1${RESET}"
}

log_error() {
    echo -e "${RED}✗ $1${RESET}"
}

log_warning() {
    echo -e "${YELLOW}⚠️  $1${RESET}"
}

# ============================================================================
#  DETECÇÃO DE PLATAFORMA E CHROME
# ============================================================================

detect_platform() {
    if [[ "$OSTYPE" == "msys" ]] || [[ "$OSTYPE" == "win32" ]] || [[ "$OSTYPE" == "cygwin" ]]; then
        echo "windows"
    elif [[ "$OSTYPE" == "linux-gnu"* ]]; then
        # Verifica se está no WSL
        if grep -qEi "(Microsoft|WSL)" /proc/version 2>/dev/null; then
            echo "wsl"
        else
            echo "linux"
        fi
    elif [[ "$OSTYPE" == "darwin"* ]]; then
        echo "macos"
    else
        echo "unknown"
    fi
}

find_chrome_path() {
    local platform="$1"

    case "$platform" in
        windows|wsl)
            # Windows paths (WSL pode acessar via /mnt/c/)
            local paths=(
                "/mnt/c/Program Files/Google/Chrome/Application/chrome.exe"
                "/mnt/c/Program Files (x86)/Google/Chrome/Application/chrome.exe"
                "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe"
                "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe"
            )
            ;;
        linux)
            local paths=(
                "/usr/bin/google-chrome"
                "/usr/bin/google-chrome-stable"
                "/usr/bin/chromium"
                "/usr/bin/chromium-browser"
            )
            ;;
        macos)
            local paths=(
                "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
            )
            ;;
        *)
            return 1
            ;;
    esac

    for path in "${paths[@]}"; do
        if [[ -f "$path" ]] || [[ -x "$path" ]]; then
            echo "$path"
            return 0
        fi
    done

    return 1
}

# ============================================================================
#  VERIFICAÇÃO DE CHROME RODANDO
# ============================================================================

is_chrome_running() {
    # Tenta conectar ao endpoint de health check
    if curl -s --connect-timeout 2 "$HEALTH_CHECK_URL" &>/dev/null; then
        return 0
    fi
    return 1
}

# ============================================================================
#  INICIALIZAÇÃO DO CHROME
# ============================================================================

start_chrome() {
    local platform="$1"
    local chrome_path="$2"

    log_info "Iniciando Chrome com remote debugging na porta $CHROME_DEBUG_PORT..."

    # Cria diretório de user data se não existir
    mkdir -p "$CHROME_USER_DATA_DIR"

    case "$platform" in
        windows)
            # Windows nativo (cmd.exe)
            cmd.exe /c start "" "$chrome_path" \
                --remote-debugging-port="$CHROME_DEBUG_PORT" \
                --user-data-dir="$CHROME_USER_DATA_DIR" \
                --no-first-run \
                --no-default-browser-check \
                --disable-features=TranslateUI \
                --remote-allow-origins=* \
                &>/dev/null &
            ;;
        wsl)
            # WSL chama Chrome do Windows
            local win_user_data_dir
            win_user_data_dir=$(wslpath -w "$CHROME_USER_DATA_DIR")

            cmd.exe /c start "" "$chrome_path" \
                --remote-debugging-port="$CHROME_DEBUG_PORT" \
                --user-data-dir="$win_user_data_dir" \
                --no-first-run \
                --no-default-browser-check \
                --disable-features=TranslateUI \
                --remote-allow-origins=* \
                &>/dev/null &
            ;;
        linux|macos)
            # Linux/Mac nativos
            nohup "$chrome_path" \
                --remote-debugging-port="$CHROME_DEBUG_PORT" \
                --user-data-dir="$CHROME_USER_DATA_DIR" \
                --no-first-run \
                --no-default-browser-check \
                --disable-features=TranslateUI \
                --remote-allow-origins=* \
                &>/dev/null &
            ;;
        *)
            log_error "Plataforma não suportada: $platform"
            return 1
            ;;
    esac

    # Aguarda Chrome iniciar
    log_info "Aguardando Chrome iniciar (max ${MAX_WAIT_SECONDS}s)..."
    local waited=0
    while ! is_chrome_running; do
        if [[ $waited -ge $MAX_WAIT_SECONDS ]]; then
            log_error "Timeout: Chrome não iniciou em ${MAX_WAIT_SECONDS}s"
            return 1
        fi
        sleep 1
        waited=$((waited + 1))
    done

    log_success "Chrome iniciado com sucesso!"
    return 0
}

# ============================================================================
#  MAIN
# ============================================================================

main() {
    echo ""
    log_info "═══════════════════════════════════════════════════════════"
    log_info "  CHROME LAUNCHER v1.0 - Automated Startup"
    log_info "═══════════════════════════════════════════════════════════"
    echo ""

    # Detecta plataforma
    local platform
    platform=$(detect_platform)
    log_info "Plataforma detectada: $platform"

    # Verifica se Chrome já está rodando
    if is_chrome_running; then
        log_success "Chrome já está rodando com remote debugging na porta $CHROME_DEBUG_PORT"

        # Mostra informações da versão
        local version_info
        version_info=$(curl -s "$HEALTH_CHECK_URL" 2>/dev/null || echo "{}")

        if [[ "$version_info" != "{}" ]]; then
            local browser_version
            browser_version=$(echo "$version_info" | grep -o '"Browser":"[^"]*"' | cut -d'"' -f4 || echo "unknown")
            log_info "Versão: $browser_version"
        fi

        echo ""
        log_success "✓ Sistema pronto para conectar ao Chrome!"
        return 0
    fi

    # Chrome não está rodando, tentar iniciar
    log_warning "Chrome não está rodando. Tentando iniciar automaticamente..."

    # Encontra caminho do Chrome
    local chrome_path
    if ! chrome_path=$(find_chrome_path "$platform"); then
        log_error "Chrome não encontrado!"
        echo ""
        echo "Por favor, instale o Google Chrome:"
        case "$platform" in
            windows|wsl)
                echo "  → https://www.google.com/chrome/"
                ;;
            linux)
                echo "  → sudo apt install google-chrome-stable"
                echo "  ou"
                echo "  → sudo apt install chromium-browser"
                ;;
            macos)
                echo "  → https://www.google.com/chrome/"
                ;;
        esac
        return 1
    fi

    log_info "Chrome encontrado: $chrome_path"

    # Inicia Chrome
    if ! start_chrome "$platform" "$chrome_path"; then
        log_error "Falha ao iniciar Chrome"
        return 1
    fi

    # Validação final
    if is_chrome_running; then
        echo ""
        log_success "═══════════════════════════════════════════════════════════"
        log_success "  Chrome iniciado com sucesso!"
        log_success "  Remote debugging port: $CHROME_DEBUG_PORT"
        log_success "  Health check: $HEALTH_CHECK_URL"
        log_success "═══════════════════════════════════════════════════════════"
        return 0
    else
        log_error "Chrome iniciou mas não está respondendo no health check"
        return 1
    fi
}

# ============================================================================
#  EXECUÇÃO
# ============================================================================
main "$@"
