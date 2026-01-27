#!/usr/bin/env bash
# =============================================================================
# postattach-summary.sh v2.0
# Resumo contextual ao anexar o VS Code ao Dev Container
# =============================================================================
#
# OBJETIVO
# --------
# Executado toda vez que o VS Code se anexa ao container.
#
# Este script:
# • NAO altera o ambiente
# • NAO executa verificacoes pesadas
# • NAO falha o container
#
# Ele existe para:
# • Informar rapidamente o estado do ambiente
# • Relembrar decisoes arquiteturais importantes
# • Orientar os proximos passos do desenvolvedor
#
# CHANGELOG v2.0:
# • Encoding UTF-8 limpo (sem caracteres especiais corrompidos)
# • Banner atualizado: ChatGPT Docker Puppeteer
# • hr() simplificado (ASCII)
# • Workspace path atualizado para chatgpt-docker-puppeteer
#
# =============================================================================

set -euo pipefail

# -----------------------------------------------------------------------------
# Logging
# -----------------------------------------------------------------------------
LOG_FILE="/tmp/devcontainer-postattach-summary.log"
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
  echo "📌 $1"
  hr
}

ok()   { echo "    ✅ $*"; }
info() { echo "    ℹ️  $*"; }
warn() { echo "    ⚠️  $*"; }

# -----------------------------------------------------------------------------
# Banner
# -----------------------------------------------------------------------------
echo "╔════════════════════════════════════════════════════════════════════╗"
echo "║  📌 ChatGPT Docker Puppeteer - RESUMO AO ANEXAR                   ║"
echo "║                                                                    ║"
echo "║  Este e um resumo rapido para retomar o contexto de trabalho.     ║"
echo "╚════════════════════════════════════════════════════════════════════╝"
echo ""

# -----------------------------------------------------------------------------
# [1] Onde voce esta
# -----------------------------------------------------------------------------
section "1. Contexto Atual"

HOST_OS="unknown"
[ -f /tmp/host-os.txt ] && HOST_OS="$(cat /tmp/host-os.txt)"

WORKSPACE_DIR="${DEVCONTAINER_WORKSPACE_FOLDER:-$(pwd)}"

info "Host OS:        ${HOST_OS}"
info "Workspace:      ${WORKSPACE_DIR}"
info "Usuario:        $(id -un)"
info "Shell:          ${SHELL:-desconhecido}"

# -----------------------------------------------------------------------------
# [2] O que ja foi feito automaticamente
# -----------------------------------------------------------------------------
section "2. O que o DevContainer ja fez por voce"

ok "Container criado e iniciado"
ok "Infraestrutura validada (postCreate)"
ok "Healthcheck informativo executado (postStart)"
ok "Volumes e mounts aplicados"
ok "Ambiente pronto para desenvolvimento"

# -----------------------------------------------------------------------------
# [3] Lembretes arquiteturais importantes
# -----------------------------------------------------------------------------
section "3. Lembretes Importantes (leia se estiver retomando)"

info "Este container e Linux (Debian)"
info "O host e Windows (via WSL2), se aplicavel"
info "O navegador controlado (LLM) roda no Windows"
info "Puppeteer conecta via WebSocket (connect, nao launch)"

if [ "$HOST_OS" = "wsl2" ]; then
  warn "Evite mover o projeto para /mnt/c ou /mnt/d"
  warn "Workspace ideal: /workspaces/chatgpt-docker-puppeteer"
fi

# -----------------------------------------------------------------------------
# [4] Estado rapido do runtime
# -----------------------------------------------------------------------------
section "4. Estado Rapido do Runtime"

if command -v node >/dev/null 2>&1; then
  ok "Node.js: $(node --version)"
else
  warn "Node.js nao encontrado"
fi

if [ -d "node_modules" ]; then
  ok "node_modules presente"
else
  info "node_modules ainda nao instalado (npm ci pendente)"
fi

# -----------------------------------------------------------------------------
# [5] Chrome remoto (controle do LLM)
# -----------------------------------------------------------------------------
section "5. Chrome Remoto (LLM)"

CHROME_HOST="${CHROME_REMOTE_HOST:-host.docker.internal}"
CHROME_PORT="${CHROME_REMOTE_PORT:-9222}"

info "Endpoint esperado: http://${CHROME_HOST}:${CHROME_PORT}"

if command -v curl >/dev/null 2>&1; then
  if curl -s --connect-timeout 2 "http://${CHROME_HOST}:${CHROME_PORT}/json/version" >/dev/null 2>&1; then
    ok "Chrome remoto acessivel"
  else
    warn "Chrome remoto nao acessivel agora"
    info "Inicie o Chrome no Windows com --remote-debugging-port=9222"
  fi
else
  info "curl ausente - status do Chrome nao verificado"
fi

# -----------------------------------------------------------------------------
# [6] Proximos passos tipicos
# -----------------------------------------------------------------------------
section "6. Proximos Passos"

cat <<EOF
Fluxo tipico de trabalho:

  1. (Se necessario) npm ci
  2. Iniciar Chrome no Windows (porta 9222)
     Comando: chrome.exe --remote-debugging-port=9222
  3. Executar o script principal da aplicacao
  4. Acompanhar logs em ./logs ou volumes dedicados

Dicas:
  • Use Puppeteer.connect(), nao launch()
  • Evite screenshots desnecessarios
  • Prefira page.evaluate() para leitura de estado
  • node_modules esta em volume (performance otimizada)
EOF

# -----------------------------------------------------------------------------
# [7] Encerramento
# -----------------------------------------------------------------------------
section "7. Encerramento"

ok "Resumo apresentado com sucesso"
info "Log salvo em: ${LOG_FILE}"
echo ""