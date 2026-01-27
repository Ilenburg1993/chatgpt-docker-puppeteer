#!/usr/bin/env bash
# =============================================================================
# poststart-healthcheck.sh v2.0
# Health check informativo ao iniciar o Dev Container
# =============================================================================
#
# OBJETIVO
# --------
# Executado toda vez que o container e iniciado (postStartCommand).
# Este script:
#
# • NAO altera o ambiente
# • NAO falha o container
# • NAO interfere no Docker healthcheck
#
# Ele existe exclusivamente para INFORMAR o desenvolvedor
# sobre o estado operacional do ambiente.
#
# CHANGELOG v2.0:
# • Encoding UTF-8 limpo (sem caracteres especiais corrompidos)
# • Banner atualizado
# • Nome consistente: ChatGPT Docker Puppeteer
#
# =============================================================================

set -euo pipefail

# -----------------------------------------------------------------------------
# Logging
# -----------------------------------------------------------------------------
LOG_FILE="/tmp/devcontainer-poststart-healthcheck.log"
exec > >(tee -a "$LOG_FILE") 2>&1

# -----------------------------------------------------------------------------
# Helpers visuais
# -----------------------------------------------------------------------------
hr() {
  printf '%*s\n' "$(tput cols 2>/dev/null || echo 80)" '' | tr ' ' '-'
}

section() {
  echo ""
  hr
  echo "🩺 $1"
  hr
}

ok()   { echo "    ✅ $*"; }
warn() { echo "    ⚠️  $*"; }
info() { echo "    ℹ️  $*"; }

# -----------------------------------------------------------------------------
# Banner
# -----------------------------------------------------------------------------
echo "╔════════════════════════════════════════════════════════════════════╗"
echo "║  🩺 ChatGPT Docker Puppeteer - HEALTHCHECK AO INICIAR             ║"
echo "║                                                                    ║"
echo "║  Este check e INFORMATIVO e nao bloqueia o container.             ║"
echo "╚════════════════════════════════════════════════════════════════════╝"
echo ""

# -----------------------------------------------------------------------------
# [1] Host OS
# -----------------------------------------------------------------------------
section "1. Ambiente"

HOST_OS="unknown"
[ -f /tmp/host-os.txt ] && HOST_OS="$(cat /tmp/host-os.txt)"

info "Host OS: ${HOST_OS}"

# -----------------------------------------------------------------------------
# [2] Node.js
# -----------------------------------------------------------------------------
section "2. Runtime JavaScript"

if command -v node >/dev/null 2>&1; then
  ok "Node.js disponivel: $(node --version)"
else
  warn "Node.js NAO encontrado - ambiente incompleto"
fi

if command -v npm >/dev/null 2>&1; then
  ok "npm disponivel: $(npm --version)"
else
  warn "npm nao encontrado"
fi

# -----------------------------------------------------------------------------
# [3] VS Code Server
# -----------------------------------------------------------------------------
section "3. VS Code Server"

if [ -d "/home/node/.vscode-server" ]; then
  ok "VS Code Server presente"
else
  info "VS Code Server ainda nao instalado (normal no primeiro start)"
fi

# -----------------------------------------------------------------------------
# [4] Chrome remoto (controle do LLM)
# -----------------------------------------------------------------------------
section "4. Chrome remoto (Windows / Host)"

CHROME_HOST="${CHROME_REMOTE_HOST:-host.docker.internal}"
CHROME_PORT="${CHROME_REMOTE_PORT:-9222}"

info "Endpoint esperado: http://${CHROME_HOST}:${CHROME_PORT}"

if command -v curl >/dev/null 2>&1; then
  if curl -s --connect-timeout 2 "http://${CHROME_HOST}:${CHROME_PORT}/json/version" >/dev/null 2>&1; then
    ok "Chrome remoto acessivel"
  else
    warn "Chrome remoto NAO acessivel neste momento"
    if [ "$HOST_OS" = "wsl2" ]; then
      info "Inicie no Windows: chrome.exe --remote-debugging-port=9222"
    fi
  fi
else
  info "curl ausente - teste de Chrome remoto ignorado"
fi

# -----------------------------------------------------------------------------
# [5] Chromium local (compatibilidade tecnica)
# -----------------------------------------------------------------------------
section "5. Chromium local (compatibilidade)"

if command -v chromium >/dev/null 2>&1; then
  ok "Chromium local disponivel"
else
  info "Chromium local ausente (ok se usar Chrome remoto)"
fi

# -----------------------------------------------------------------------------
# [6] Resumo
# -----------------------------------------------------------------------------
section "6. Resumo"

cat <<EOF
Este healthcheck:
  • NAO altera o sistema
  • NAO bloqueia o container
  • NAO substitui o Docker healthcheck

Logs:
  • ${LOG_FILE}

Se algo acima estiver ⚠️, verifique antes de iniciar o Puppeteer.
EOF

echo ""
ok "Healthcheck informativo concluido"
echo ""