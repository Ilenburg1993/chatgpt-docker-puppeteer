#!/usr/bin/env bash
# =============================================================================
# post-attach.sh — DevContainer UX & Orientation Hook
# Projeto: ChatGPT Docker Puppeteer
#
# FINALIDADE:
#   Executado TODA VEZ que o VS Code se anexa ao container.
#
# PRINCÍPIOS FUNDAMENTAIS:
#   • Nunca falhar
#   • Nunca modificar estado estrutural do sistema
#   • Nunca iniciar serviços
#   • Nunca instalar dependências
#   • Nunca configurar credenciais (Git, tokens, etc.)
#   • Comunicação HUMANA, não automação
#
# ESTE SCRIPT:
#   ✔ Informa
#   ✔ Orienta
#   ✔ Diagnostica levemente
#
# ESTE SCRIPT NÃO:
#   ✖ Faz setup
#   ✖ Faz bootstrap
#   ✖ Faz healthcheck ativo
#   ✖ Executa Makefile
#
# =============================================================================

# -----------------------------------------------------------------------------
# MODO DE EXECUÇÃO SEGURO
# -----------------------------------------------------------------------------
# O attach NUNCA pode falhar. Nenhum erro aqui deve quebrar o VS Code.
set +e

# -----------------------------------------------------------------------------
# HELPERS DE UX (cores e semântica)
# -----------------------------------------------------------------------------
GREEN="\033[0;32m"
YELLOW="\033[1;33m"
BLUE="\033[0;34m"
CYAN="\033[0;36m"
RED="\033[0;31m"
NC="\033[0m"

info() {
    echo -e "${CYAN}ℹ️  $1${NC}"
}

ok() {
    echo -e "${GREEN}✅ $1${NC}"
}

warn() {
    echo -e "${YELLOW}⚠️  $1${NC}"
}

error() {
    echo -e "${RED}❌ $1${NC}"
}

# -----------------------------------------------------------------------------
# BANNER DE ATTACH
# -----------------------------------------------------------------------------
echo ""
echo -e "${BLUE}══════════════════════════════════════════════════════════════${NC}"
echo -e "${BLUE}🔗 VS Code anexado ao DevContainer — ChatGPT Docker Puppeteer${NC}"
echo -e "${BLUE}══════════════════════════════════════════════════════════════${NC}"
echo ""

# -----------------------------------------------------------------------------
# CONTEXTO BÁSICO DO AMBIENTE
# -----------------------------------------------------------------------------
info "Contexto do ambiente:"

WORKSPACE_DIR="$(pwd)"
CURRENT_USER="$(whoami)"

NODE_VERSION="$(node --version 2>/dev/null || echo 'não disponível')"
NPM_VERSION="$(npm --version 2>/dev/null || echo 'não disponível')"

echo "  • Usuário:           ${CURRENT_USER}"
echo "  • Workspace:         ${WORKSPACE_DIR}"
echo "  • Node.js:           ${NODE_VERSION}"
echo "  • npm:               ${NPM_VERSION}"
echo ""

# -----------------------------------------------------------------------------
# ESTADO DO DEVCONTAINER (post-create)
# -----------------------------------------------------------------------------
INIT_MARKER=".devcontainer/.initialized"

if [ -f "${INIT_MARKER}" ]; then
    ok "DevContainer já inicializado (post-create executado)"
else
    warn "DevContainer ainda não foi inicializado (post-create não detectado)"
    warn "→ Se algo parecer inconsistente, considere: Rebuild Container"
fi
echo ""

# -----------------------------------------------------------------------------
# ÚLTIMO ESTADO DE HEALTH (PASSIVO)
# -----------------------------------------------------------------------------
HEALTH_STATUS_FILE="/tmp/devcontainer-health.status"

info "Estado conhecido do sistema:"

if [ -f "${HEALTH_STATUS_FILE}" ]; then
    HEALTH_STATUS="$(cat "${HEALTH_STATUS_FILE}")"
    if [ "${HEALTH_STATUS}" = "ok" ]; then
        ok "Último healthcheck conhecido: OK"
    else
        warn "Último healthcheck conhecido: FALHA"
        warn "→ Execute manualmente: make health"
    fi
else
    warn "Nenhum healthcheck registrado ainda"
    warn "→ Execute quando desejar: make health"
fi
echo ""

# -----------------------------------------------------------------------------
# PM2 — OBSERVAÇÃO PASSIVA
# -----------------------------------------------------------------------------
info "PM2 (observação passiva):"

if command -v pm2 >/dev/null 2>&1; then
    PM2_VERSION="$(pm2 --version 2>/dev/null)"
    ok "PM2 disponível (versão: ${PM2_VERSION})"
    pm2 list 2>/dev/null || warn "PM2 disponível, mas sem processos ativos"
elif [ -x "node_modules/.bin/pm2" ]; then
    PM2_VERSION="$(npx pm2 --version 2>/dev/null)"
    ok "PM2 disponível via npx (versão: ${PM2_VERSION})"
    npx pm2 list 2>/dev/null || warn "PM2 disponível, mas sem processos ativos"
else
    warn "PM2 não detectado (normal se o sistema não foi iniciado)"
    warn "→ O PM2 só é usado quando você executa o sistema explicitamente"
fi
echo ""

# -----------------------------------------------------------------------------
# CHROME EXTERNO (CDP) — DIAGNÓSTICO LEVE
# -----------------------------------------------------------------------------
info "Chrome externo (CDP):"

CHROME_ENDPOINT="${PUPPETEER_WS_ENDPOINT:-http://host.docker.internal:9222}"

if command -v curl >/dev/null 2>&1; then
    if curl -sf "${CHROME_ENDPOINT}/json/version" >/dev/null 2>&1; then
        ok "Chrome externo acessível via CDP (${CHROME_ENDPOINT})"
    else
        warn "Chrome externo NÃO respondeu em ${CHROME_ENDPOINT}"
        warn "→ Verifique se o Chrome no host está aberto com:"
        warn "   chrome.exe --remote-debugging-port=9222"
    fi
else
    warn "curl não disponível para testar Chrome externo"
fi
echo ""

# -----------------------------------------------------------------------------
# PORTAS RELEVANTES (DOCUMENTAÇÃO VIVA)
# -----------------------------------------------------------------------------
info "Mapa de portas relevantes:"

echo "  • 3008  → Servidor Socket.io / API"
echo "  • 9222  → Chrome DevTools Protocol (Chrome externo)"
echo "  • 9229  → Node.js Inspector (PM2 primário)"
echo "  • 9230  → Node.js Inspector (PM2 secundário)"
echo ""

# -----------------------------------------------------------------------------
# PRIMEIRO ATTACH (ONBOARDING HUMANO)
# -----------------------------------------------------------------------------
FIRST_ATTACH_MARKER=".devcontainer/.first-attach"

if [ ! -f "${FIRST_ATTACH_MARKER}" ]; then
    echo -e "${GREEN}👋 Bem-vindo! Este parece ser o primeiro attach neste container.${NC}"
    echo ""
    echo "Próximos passos sugeridos:"
    echo "  • make help     → ver comandos disponíveis"
    echo "  • make info     → informações do sistema"
    echo "  • make health   → verificar saúde do ambiente"
    echo "  • make start    → iniciar o sistema (quando desejar)"
    echo ""
    mkdir -p "$(dirname "${FIRST_ATTACH_MARKER}")" 2>/dev/null
    touch "${FIRST_ATTACH_MARKER}" 2>/dev/null
fi

# -----------------------------------------------------------------------------
# ENCERRAMENTO SEMÂNTICO
# -----------------------------------------------------------------------------
echo ""
ok "Ambiente pronto para uso."
info "Este script não executou nenhuma ação destrutiva ou automática."
echo ""

# FIM DO post-attach.sh
# =============================================================================
