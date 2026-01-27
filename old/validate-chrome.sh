#!/usr/bin/env bash
# =============================================================================
# validate-chrome.sh v2.0 — Chrome Remote Validation
# =============================================================================
# Propósito: Validar conexão com Chrome remoto no host
# Uso: Chamado pelo postCreateCommand (fase 3/9) ou manualmente
# Path: ${CONTAINER_SCRIPTS_PATH}/validate-chrome.sh
#
# CASO DE USO:
# • Host primário: Debian (google-chrome --remote-debugging-port=9222)
# • Host secundário: Windows/WSL2 (chrome.exe --remote-debugging-port=9222)
# • Puppeteer: Controla LLM via Chrome externo (host:9222)
#
# EXIT CODES:
# • 0: Chrome remoto acessível
# • 1: Chrome remoto não acessível (não-crítico para setup)
#
# OUTPUT FILES:
# • /tmp/chrome-remote-ws.txt: WebSocket endpoint (se disponível)
# • /tmp/chrome-remote-status.txt: Status da conexão
# • /tmp/chrome-remote-info.json: Info completa do Chrome (se disponível)
#
# FILOSOFIA:
# • Validação é não-bloqueante (setup continua mesmo se Chrome ausente)
# • Instruções específicas por host OS
# • Logs estruturados e informativos
#
# CHANGELOG:
# v2.0 (2026-01-23):
#   • Detecção de host OS (Debian/WSL2)
#   • Instruções contextuais por OS
#   • Salva info completa do Chrome em JSON
#   • Logs coloridos e estruturados
#   • Sincronizado com devcontainer.json v11.0
# =============================================================================

set -euo pipefail

# =============================================================================
# CONFIGURAÇÃO
# =============================================================================

readonly CHROME_HOST="${CHROME_REMOTE_HOST:-host.docker.internal}"
readonly CHROME_PORT="${CHROME_REMOTE_PORT:-9222}"
readonly CHROME_URL="http://${CHROME_HOST}:${CHROME_PORT}"
readonly TIMEOUT=3

readonly STATUS_FILE="/tmp/chrome-remote-status.txt"
readonly WS_FILE="/tmp/chrome-remote-ws.txt"
readonly INFO_FILE="/tmp/chrome-remote-info.json"

# =============================================================================
# DETECÇÃO DE HOST OS
# =============================================================================

HOST_OS="unknown"
if [ -f /tmp/host-os.txt ]; then
    HOST_OS=$(cat /tmp/host-os.txt)
fi

# =============================================================================
# CORES
# =============================================================================

readonly GREEN='\033[0;32m'
readonly YELLOW='\033[1;33m'
readonly CYAN='\033[0;36m'
readonly NC='\033[0m'

# =============================================================================
# LOGGING
# =============================================================================

log_info() {
    echo -e "   ${CYAN}ℹ${NC}  $*"
}

log_ok() {
    echo -e "   ${GREEN}✓${NC}  $*"
}

log_warn() {
    echo -e "   ${YELLOW}⚠${NC}  $*"
}

# =============================================================================
# INSTRUÇÕES POR OS
# =============================================================================

show_instructions() {
    echo ""
    log_info "Como iniciar Chrome remoto:"
    echo ""
    
    if [ "$HOST_OS" = "debian" ]; then
        echo "   🐧 Debian:"
        echo "   google-chrome --remote-debugging-port=9222 --user-data-dir=/tmp/chrome-debug"
        echo ""
        echo "   Ou em background:"
        echo "   nohup google-chrome --remote-debugging-port=9222 --user-data-dir=/tmp/chrome-debug &"
        
    elif [ "$HOST_OS" = "wsl2" ]; then
        echo "   🪟 Windows (PowerShell):"
        echo "   Start-Process chrome.exe -ArgumentList '--remote-debugging-port=9222','--user-data-dir=%TEMP%\\chrome-debug'"
        echo ""
        echo "   Ou CMD:"
        echo "   start chrome.exe --remote-debugging-port=9222 --user-data-dir=%TEMP%\\chrome-debug"
        echo ""
        log_warn "IMPORTANTE: Rodar no Windows, NÃO dentro do WSL2"
        
    else
        echo "   Chrome/Chromium:"
        echo "   google-chrome --remote-debugging-port=9222 --user-data-dir=/tmp/chrome-debug"
        echo ""
        echo "   Ou Chromium:"
        echo "   chromium --remote-debugging-port=9222 --user-data-dir=/tmp/chrome-debug"
    fi
    
    echo ""
}

# =============================================================================
# VALIDAÇÃO
# =============================================================================

validate_chrome() {
    if ! command -v curl >/dev/null 2>&1; then
        log_warn "curl não disponível, validação ignorada"
        echo "skipped:no_curl" > "$STATUS_FILE"
        return 1
    fi
    
    log_info "Testando conexão: ${CHROME_URL}"
    
    # Tenta acessar endpoint /json/version
    if ! curl -sf --connect-timeout "$TIMEOUT" "${CHROME_URL}/json/version" > "$INFO_FILE" 2>/dev/null; then
        log_warn "Chrome remoto NÃO acessível em ${CHROME_URL}"
        log_info "Isso é operacional — o DevContainer continuará"
        
        show_instructions
        
        echo "unavailable" > "$STATUS_FILE"
        rm -f "$INFO_FILE"
        return 1
    fi
    
    log_ok "Chrome remoto ACESSÍVEL em ${CHROME_URL}"
    
    # Extrai informações
    local browser_version
    local ws_url
    local user_agent
    local protocol_version
    
    if command -v jq >/dev/null 2>&1; then
        browser_version=$(jq -r '.Browser // "unknown"' "$INFO_FILE" 2>/dev/null || echo "unknown")
        ws_url=$(jq -r '.webSocketDebuggerUrl // ""' "$INFO_FILE" 2>/dev/null || echo "")
        user_agent=$(jq -r '."User-Agent" // "unknown"' "$INFO_FILE" 2>/dev/null || echo "unknown")
        protocol_version=$(jq -r '."Protocol-Version" // "unknown"' "$INFO_FILE" 2>/dev/null || echo "unknown")
    else
        # Fallback: grep (menos confiável mas funciona)
        browser_version=$(grep -oP '"Browser"\s*:\s*"\K[^"]+' "$INFO_FILE" 2>/dev/null || echo "unknown")
        ws_url=$(grep -oP '"webSocketDebuggerUrl"\s*:\s*"\K[^"]+' "$INFO_FILE" 2>/dev/null || echo "")
        user_agent="unknown"
        protocol_version="unknown"
    fi
    
    log_ok "Versão: ${browser_version}"
    [ "$user_agent" != "unknown" ] && log_info "User-Agent: ${user_agent}"
    [ "$protocol_version" != "unknown" ] && log_info "Protocol: ${protocol_version}"
    
    # Salva WebSocket endpoint
    if [ -n "$ws_url" ]; then
        echo "$ws_url" > "$WS_FILE"
        log_ok "WebSocket endpoint salvo em ${WS_FILE}"
    fi
    
    # Salva status
    echo "available:${browser_version}" > "$STATUS_FILE"
    log_ok "Status salvo em ${STATUS_FILE}"
    log_ok "Info completa salva em ${INFO_FILE}"
    
    return 0
}

# =============================================================================
# MAIN
# =============================================================================

main() {
    echo ""
    
    if validate_chrome; then
        echo ""
        log_ok "Validação concluída com sucesso"
        return 0
    else
        echo ""
        log_warn "Chrome remoto não disponível (não-crítico)"
        return 1
    fi
}

main "$@"