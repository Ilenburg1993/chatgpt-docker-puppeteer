#!/usr/bin/env bash
# =============================================================================
# postcreate-diagnostics.sh v2.0
# Diagnostico exaustivo pos-criacao do Dev Container
# =============================================================================
#
# OBJETIVO
# --------
# Este script e executado imediatamente apos a criacao do Dev Container.
# Ele NAO modifica o sistema. Sua funcao e:
#
# • Diagnosticar o ambiente (host, container, filesystem)
# • Informar o usuario de forma clara e visual
# • Detectar riscos classicos (WSL2, I/O lento, CRLF, mounts errados)
# • Registrar informacoes uteis para debug futuro
#
# ESTE SCRIPT NAO:
# ----------------
# • NAO instala dependencias
# • NAO executa npm/yarn/pnpm
# • NAO altera permissoes
# • NAO cria diretorios
# • NAO assume root
#
# Ele e puramente informativo e diagnostico.
#
# CHANGELOG v2.0:
# • Encoding UTF-8 limpo (sem caracteres especiais corrompidos)
# • Banner atualizado: ChatGPT Docker Puppeteer
# • hr() simplificado (ASCII)
#
# =============================================================================

set -euo pipefail

# -----------------------------------------------------------------------------
# Logging
# -----------------------------------------------------------------------------
LOG_FILE="/tmp/devcontainer-postcreate.log"
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
  echo "🧩 $1"
  hr
}

sub() {
  echo "  • $1"
}

ok() {
  echo "    ✅ $1"
}

warn() {
  echo "    ⚠️  $1"
}

fail() {
  echo "    ❌ $1"
}

# -----------------------------------------------------------------------------
# Banner inicial
# -----------------------------------------------------------------------------
clear 2>/dev/null || true

echo "╔════════════════════════════════════════════════════════════════════╗"
echo "║  🔍 ChatGPT Docker Puppeteer - DIAGNOSTICO POS-CRIACAO            ║"
echo "║                                                                    ║"
echo "║  Este script NAO altera o ambiente.                               ║"
echo "║  Ele existe para lhe dizer exatamente ONDE voce esta.             ║"
echo "╚════════════════════════════════════════════════════════════════════╝"
echo ""

# -----------------------------------------------------------------------------
# [1] Deteccao do Host OS
# -----------------------------------------------------------------------------
section "1. Deteccao do Host (Windows / WSL2 / Linux)"

HOST_OS="unknown"

if [ -f /proc/version ] && grep -qi microsoft /proc/version; then
  HOST_OS="wsl2"
  ok "Ambiente Windows detectado via WSL2"
elif [ -f /etc/debian_version ]; then
  HOST_OS="debian"
  ok "Host Linux Debian detectado"
elif uname -s | grep -qi linux; then
  HOST_OS="linux"
  ok "Host Linux generico detectado"
else
  warn "Host nao identificado com precisao"
fi

echo "$HOST_OS" > /tmp/host-os.txt
sub "Host OS registrado em /tmp/host-os.txt"

# -----------------------------------------------------------------------------
# [2] Container e usuario
# -----------------------------------------------------------------------------
section "2. Ambiente do Container"

sub "Usuario atual"
id

sub "Diretorio HOME"
echo "    HOME=$HOME"

sub "Shell"
echo "    SHELL=$SHELL"

# -----------------------------------------------------------------------------
# [3] Workspace
# -----------------------------------------------------------------------------
section "3. Workspace e Filesystem"

WORKSPACE_DIR="${DEVCONTAINER_WORKSPACE_FOLDER:-$(pwd)}"

sub "Workspace configurado"
echo "    $WORKSPACE_DIR"

if mountpoint -q "$WORKSPACE_DIR" 2>/dev/null; then
  ok "Workspace e um mountpoint"
else
  warn "Workspace NAO e mountpoint (possivel bind mount)"
fi

if echo "$WORKSPACE_DIR" | grep -q "/mnt/"; then
  warn "Workspace parece estar sob /mnt/* (I/O lento no WSL2)"
  warn "Recomendado: usar /workspaces/"
else
  ok "Workspace nao esta sob /mnt/*"
fi

# -----------------------------------------------------------------------------
# [4] Node.js e npm
# -----------------------------------------------------------------------------
section "4. Runtime JavaScript"

if command -v node >/dev/null 2>&1; then
  ok "Node.js disponivel: $(node --version)"
else
  fail "Node.js NAO encontrado"
  exit 1
fi

if command -v npm >/dev/null 2>&1; then
  ok "npm disponivel: $(npm --version)"
else
  warn "npm nao encontrado"
fi

# -----------------------------------------------------------------------------
# [5] Chromium local (compatibilidade tecnica)
# -----------------------------------------------------------------------------
section "5. Chromium local (compatibilidade Puppeteer)"

CHROMIUM_FOUND="false"

for bin in chromium chromium-browser google-chrome; do
  if command -v "$bin" >/dev/null 2>&1; then
    ok "Encontrado: $bin -> $(command -v "$bin")"
    CHROMIUM_FOUND="true"
    break
  fi
done

if [ "$CHROMIUM_FOUND" = "false" ]; then
  warn "Nenhum Chromium local encontrado"
  warn "OK se voce usa Chrome remoto no Windows"
fi

# -----------------------------------------------------------------------------
# [6] Chrome remoto no host (controle LLM)
# -----------------------------------------------------------------------------
section "6. Chrome remoto no Host (controle do LLM)"

CHROME_HOST="${CHROME_REMOTE_HOST:-host.docker.internal}"
CHROME_PORT="${CHROME_REMOTE_PORT:-9222}"

sub "Endpoint esperado"
echo "    http://${CHROME_HOST}:${CHROME_PORT}"

if command -v curl >/dev/null 2>&1; then
  if curl -s --connect-timeout 3 "http://${CHROME_HOST}:${CHROME_PORT}/json/version" >/dev/null 2>&1; then
    ok "Chrome remoto acessivel"
    curl -s "http://${CHROME_HOST}:${CHROME_PORT}/json/version" > /tmp/chrome-remote-info.json
    sub "Informacoes salvas em /tmp/chrome-remote-info.json"
  else
    warn "Chrome remoto NAO acessivel neste momento"
    warn "Isso NAO bloqueia o DevContainer"
  fi
else
  warn "curl nao disponivel - nao foi possivel testar Chrome remoto"
fi

# -----------------------------------------------------------------------------
# [7] Git e line endings
# -----------------------------------------------------------------------------
section "7. Git e Line Endings"

if command -v git >/dev/null 2>&1; then
  ok "Git disponivel: $(git --version)"
  sub "core.eol = $(git config --global core.eol || echo 'nao definido')"
  sub "core.autocrlf = $(git config --global core.autocrlf || echo 'nao definido')"
else
  warn "Git nao disponivel"
fi

# -----------------------------------------------------------------------------
# [8] Avisos especificos para WSL2
# -----------------------------------------------------------------------------
if [ "$HOST_OS" = "wsl2" ]; then
  section "8. Avisos importantes para Windows / WSL2"

  warn "Voce esta usando Windows + WSL2"
  warn "I/O e mais lento que Linux nativo"
  warn "Use volumes nomeados para node_modules, logs e cache"
  warn "Evite /mnt/c, /mnt/d para projetos ativos"
  warn "Chrome deve rodar no Windows, nao no WSL2"
fi

# -----------------------------------------------------------------------------
# [9] Resumo final
# -----------------------------------------------------------------------------
section "9. Resumo Final"

cat <<EOF
Ambiente:
  • Host OS:        $HOST_OS
  • Workspace:      $WORKSPACE_DIR
  • Usuario:        $(id -un)
  • Node.js:        $(node --version)

Arquivos gerados:
  • $LOG_FILE
  • /tmp/host-os.txt
  • /tmp/chrome-remote-info.json (se disponivel)

Proximos passos:
  • setup-devcontainer.sh (infraestrutura)
  • npm ci (quando apropriado)
  • Iniciar Chrome remoto no Windows (porta 9222)

Este script NAO fez nenhuma alteracao no sistema.
EOF

echo ""
ok "Diagnostico pos-criacao concluido com sucesso"
echo "📋 Log completo: $LOG_FILE"
echo ""