#!/usr/bin/env bash
# =============================================================================
# healthcheck.sh v2.0 — Container Health Check (Dual Browser)
# =============================================================================
# Propósito: Validar estado do container para Docker healthcheck
# Uso: Chamado por healthchecks locais/containers quando necessário
# Path: .devcontainer/scripts/healthcheck.sh
#
# CASO DE USO:
# • Host primário: Debian (programação via VS Code + DevContainer)
# • Host secundário: Windows/WSL2 (desenvolvimento alternativo)
# • Puppeteer: Controla LLM via proxy/CDP em localhost:9224
# • Chromium local: Apenas compatibilidade técnica
#
# EXIT CODES:
# • 0: Healthy (tudo OK ou avisos não-críticos)
# • 1: Unhealthy (falha crítica)
#
# CHECKS:
# 1. Node.js disponível e funcional (CRÍTICO)
# 2. VS Code Server instalado (não-bloqueante)
# 3. Endpoint CDP/proxy (não-bloqueante, apenas informativo)
# 4. Chromium local (não-bloqueante, apenas informativo)
#
# FILOSOFIA:
# • Apenas Node.js é bloqueante (sem Node = container inútil)
# • Chrome/Chromium ausentes = avisos (não bloqueiam healthcheck)
# • VS Code Server ausente = normal em primeiro boot
#
# CHANGELOG:
# v2.0 (2026-01-23):
#   • Sincronizado com docker-compose.yml v3.0
#   • Detecção de host OS para mensagens contextuais
#   • Apenas Node.js é crítico (exit 1)
#   • Todos outros checks são informativos
#   • Logs estruturados para stderr
#   • Path configurável via CONTAINER_SCRIPTS_PATH
# =============================================================================

set -euo pipefail

# =============================================================================
# CONFIGURAÇÃO
# =============================================================================

readonly LEGACY_CHROME_HEALTH_BASE_URL="http://${CHROME_REMOTE_HOST:-${CHROME_HOST:-host.docker.internal}}:${CHROME_REMOTE_PORT:-${CHROME_PROXY_PORT:-9224}}"
readonly CHROME_HEALTH_BASE_URL="${CHROME_HEALTH_BASE_URL:-${PUPPETEER_WS_ENDPOINT:-${LEGACY_CHROME_HEALTH_BASE_URL}}}"
readonly CHROMIUM_PATH="/usr/bin/chromium"
readonly CHECK_TIMEOUT_SECONDS="${HEALTHCHECK_COMMAND_TIMEOUT_SECONDS:-5}"

# Exit codes
readonly EXIT_HEALTHY=0
readonly EXIT_UNHEALTHY=1

# =============================================================================
# DETECÇÃO DE HOST OS
# =============================================================================

HOST_OS="unknown"
if [ -f /tmp/host-os.txt ]; then
    HOST_OS=$(cat /tmp/host-os.txt)
fi

# =============================================================================
# LOGGING
# =============================================================================

log_info() {
    echo "[healthcheck] ℹ️  $*" >&2
}

log_ok() {
    echo "[healthcheck] ✅ $*" >&2
}

log_warn() {
    echo "[healthcheck] ⚠️  $*" >&2
}

log_error() {
    echo "[healthcheck] ❌ $*" >&2
}

run_with_timeout() {
    local seconds="$1"
    shift

    if command -v timeout >/dev/null 2>&1; then
        timeout "${seconds}" "$@"
        return $?
    fi

    "$@"
}

# =============================================================================
# CHECKS
# =============================================================================

check_node() {
    if ! command -v node >/dev/null 2>&1; then
        log_error "Node.js não encontrado"
        return 1
    fi

    if ! node --version >/dev/null 2>&1; then
        log_error "Node.js não funcional"
        return 1
    fi

    local node_version
    node_version=$(node --version)
    log_ok "Node.js $node_version"
    return 0
}

check_vscode_server() {
    if [ ! -d /home/node/.vscode-server ]; then
        log_info "VS Code Server não instalado (esperado em primeiro boot)"
        return 0  # Não-bloqueante
    fi

    log_ok "VS Code Server instalado"
    return 0
}

check_chrome_remote() {
    if ! command -v curl >/dev/null 2>&1; then
        log_info "curl ausente, ignorando check de endpoint CDP"
        return 0
    fi

    local health_url="${CHROME_HEALTH_BASE_URL%/}/json/version"

    if run_with_timeout "${CHECK_TIMEOUT_SECONDS}" \
        curl -sf --connect-timeout 2 --max-time "${CHECK_TIMEOUT_SECONDS}" \
        "${health_url}" >/dev/null 2>&1; then
        log_ok "Endpoint CDP acessível (${CHROME_HEALTH_BASE_URL})"
        return 0
    else
        log_warn "Endpoint CDP indisponível (operacional, não-bloqueante)"

        # Instruções específicas por OS
        if [ "$HOST_OS" = "debian" ]; then
            log_info "Para iniciar o proxy/Chrome externo, valide PUPPETEER_WS_ENDPOINT e CHROME_PROXY_PORT."
        elif [ "$HOST_OS" = "wsl2" ]; then
                log_info "Para iniciar no Windows: chrome.exe --remote-debugging-port=9225 e garanta o proxy em localhost:9224"
        else
                log_info "Para iniciar o endpoint CDP: confira PUPPETEER_WS_ENDPOINT/CHROME_PROXY_PORT"
        fi

        return 0  # Não-bloqueante
    fi
}

check_chromium_local() {
    if [ ! -x "$CHROMIUM_PATH" ]; then
        log_warn "Chromium local não encontrado"
        return 0  # Não-bloqueante
    fi

    if ! run_with_timeout "${CHECK_TIMEOUT_SECONDS}" "$CHROMIUM_PATH" --version >/dev/null 2>&1; then
        log_warn "Chromium local não funcional"
        return 0  # Não-bloqueante
    fi

    log_ok "Chromium local funcional"
    return 0
}

# =============================================================================
# MAIN
# =============================================================================

main() {
    local exit_code=$EXIT_HEALTHY
    local health="ok"
    local npm_path=""
    local node_path=""

    # post-start may report degraded for advisory issues; only explicit fatal states should fail healthcheck
    if [[ -f "/tmp/devcontainer-health.status" ]]; then
        health=$(cat "/tmp/devcontainer-health.status" 2>/dev/null || echo ok)
        case "${health}" in
            ok)
                ;;
            fatal|unhealthy)
                log_error "health status file reports critical state '${health}' (post-start)"
                exit_code=$EXIT_UNHEALTHY
                ;;
            *)
                log_warn "health status file reports advisory state '${health}' (post-start)"
                ;;
        esac
    fi

    if command -v npm >/dev/null 2>&1; then
        npm_path=$(command -v npm)
        if [[ "${npm_path}" =~ ^/mnt/[A-Za-z]/ ]]; then
            log_warn "npm resolve para um binário do Windows (${npm_path}); prefira Node/npm Linux para evitar problemas de UNC e subprocessos."
        fi
    else
        log_warn "npm não encontrado no PATH."
    fi

    if command -v node >/dev/null 2>&1; then
        node_path=$(command -v node)
        if [[ "${node_path}" =~ ^/mnt/[A-Za-z]/ ]]; then
            log_error "node resolve para um binário do Windows (${node_path}); isso é um estado crítico no ambiente Linux."
            exit_code=$EXIT_UNHEALTHY
        fi
    fi

    log_info "Iniciando health check..."
    [ -n "$HOST_OS" ] && [ "$HOST_OS" != "unknown" ] && log_info "Host OS: $HOST_OS"

    # Check crítico: Node.js
    if ! check_node; then
        exit_code=$EXIT_UNHEALTHY
    fi

    # Checks não-bloqueantes (apenas informativos)
    check_vscode_server
    check_chrome_remote
    check_chromium_local

    if [ $exit_code -eq $EXIT_HEALTHY ]; then
        log_ok "Container healthy"
    else
        log_error "Container unhealthy (critical check failed)"
    fi

    # expose numeric code for external tooling (e.g. make info)
    log_info "HEALTHCODE=${exit_code}"

    return $exit_code
}

main "$@"
