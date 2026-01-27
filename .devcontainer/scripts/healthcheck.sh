#!/usr/bin/env bash
# =============================================================================
# healthcheck.sh v2.0 — Container Health Check (Dual Browser)
# =============================================================================
# Propósito: Validar estado do container para Docker healthcheck
# Uso: Chamado via docker-compose.yml healthcheck
# Path: ${CONTAINER_SCRIPTS_PATH}/devcontainer-healthcheck.sh
#
# CASO DE USO:
# • Host primário: Debian (programação via VS Code + DevContainer)
# • Host secundário: Windows/WSL2 (desenvolvimento alternativo)
# • Puppeteer: Controla LLM via Chrome externo (host:9222)
# • Chromium local: Apenas compatibilidade técnica
#
# EXIT CODES:
# • 0: Healthy (tudo OK ou avisos não-críticos)
# • 1: Unhealthy (falha crítica)
#
# CHECKS:
# 1. Node.js disponível e funcional (CRÍTICO)
# 2. VS Code Server instalado (não-bloqueante)
# 3. Chrome remoto (não-bloqueante, apenas informativo)
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

readonly CHROME_REMOTE_HOST="${CHROME_REMOTE_HOST:-host.docker.internal}"
readonly CHROME_REMOTE_PORT="${CHROME_REMOTE_PORT:-9222}"
readonly CHROMIUM_PATH="/usr/bin/chromium"

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
        log_info "curl ausente, ignorando check de Chrome remoto"
        return 0
    fi
    
    if curl -sf --connect-timeout 2 "http://${CHROME_REMOTE_HOST}:${CHROME_REMOTE_PORT}/json/version" >/dev/null 2>&1; then
        log_ok "Chrome remoto acessível (${CHROME_REMOTE_HOST}:${CHROME_REMOTE_PORT})"
        return 0
    else
        log_warn "Chrome remoto indisponível (operacional, não-bloqueante)"
        
        # Instruções específicas por OS
        if [ "$HOST_OS" = "debian" ]; then
            log_info "Para iniciar: google-chrome --remote-debugging-port=9222"
        elif [ "$HOST_OS" = "wsl2" ]; then
            log_info "Para iniciar no Windows: chrome.exe --remote-debugging-port=9222"
        else
            log_info "Para iniciar Chrome remoto: --remote-debugging-port=9222"
        fi
        
        return 0  # Não-bloqueante
    fi
}

check_chromium_local() {
    if [ ! -x "$CHROMIUM_PATH" ]; then
        log_warn "Chromium local não encontrado"
        return 0  # Não-bloqueante
    fi
    
    if ! "$CHROMIUM_PATH" --version >/dev/null 2>&1; then
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
        log_error "Container unhealthy (Node.js ausente)"
    fi
    
    return $exit_code
}

main "$@"