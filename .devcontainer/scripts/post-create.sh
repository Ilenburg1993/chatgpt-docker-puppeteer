#!/usr/bin/env bash
# =============================================================================
# post-create.sh — Inicialização estrutural do DevContainer (DEV)
#
# VERSÃO: 1.2.2 (CANÔNICA FINAL)
# DATA:   2026-01-26
#
# CONTRATO (INVIOLÁVEL):
#   • Executado UMA ÚNICA VEZ após criação do container
#   • Pode falhar (diferente do post-attach)
#   • Não interativo
#   • Idempotente
#   • Não inicia serviços
#   • Não instala dependências
#   • Não executa build, npm install, npm ci ou make
#   • Não define identidade Git
#
# OBJETIVO:
#   Normalizar a infraestrutura estrutural do ambiente DEV para:
#   • VS Code Server
#   • GitHub Copilot / Copilot Chat
#   • Docker CLI (via socket)
#   • Puppeteer (Chrome externo + fallback)
#
# AUTORIDADE:
#   • Execução e lifecycle: Makefile
#   • UX e orientação: post-attach.sh
# =============================================================================

set -euo pipefail

# =============================================================================
# SECTION 0 — Guard rails e metadados
# =============================================================================
SCRIPT_NAME="post-create.sh"
SCRIPT_VERSION="1.2.2"
SCRIPT_DATE="2026-01-26"

if [[ "$(whoami)" != "node" ]]; then
    echo "[${SCRIPT_NAME}] ❌ Este script deve ser executado como usuário 'node'"
    exit 1
fi

# =============================================================================
# SECTION 1 — Helpers de log
# =============================================================================
log()   { echo "[${SCRIPT_NAME}] ℹ️  $*"; }
warn()  { echo "[${SCRIPT_NAME}] ⚠️  $*" >&2; }
error() { echo "[${SCRIPT_NAME}] ❌ $*" >&2; }

# =============================================================================
# SECTION 2 — Contexto e idempotência
# =============================================================================
HOME_DIR="${HOME}"
WORKSPACE_DIR="$(pwd)"
DEVCONTAINER_DIR="${WORKSPACE_DIR}/.devcontainer"
CONFIG_DIR="${DEVCONTAINER_DIR}/config"
STATE_FILE="${DEVCONTAINER_DIR}/.initialized"

if [[ -f "${STATE_FILE}" ]]; then
    log "Inicialização já registrada — post-create não será reexecutado"
    exit 0
fi

log "Inicialização estrutural do DevContainer"
log "Versão: ${SCRIPT_VERSION} (${SCRIPT_DATE})"
log "Workspace: ${WORKSPACE_DIR}"
log "Home: ${HOME_DIR}"
log "Usuário: $(whoami)"

# =============================================================================
# SECTION 3 — Detecção passiva do projeto (read-only)
# =============================================================================
IS_GIT_REPO=false
IS_NODE_PROJECT=false
HAS_MAKEFILE=false
HAS_PACKAGE_LOCK=false

[[ -d ".git" ]] && IS_GIT_REPO=true
[[ -f "package.json" ]] && IS_NODE_PROJECT=true
[[ -f "Makefile" ]] && HAS_MAKEFILE=true
[[ -f "package-lock.json" ]] && HAS_PACKAGE_LOCK=true

$IS_GIT_REPO      && log "Repositório Git detectado"      || warn "Não é um repositório Git"
$IS_NODE_PROJECT  && log "Projeto Node.js detectado"     || warn "package.json não encontrado"
$HAS_MAKEFILE     && log "Makefile detectado"            || warn "Makefile não encontrado"
$HAS_PACKAGE_LOCK && log "package-lock.json detectado"   || warn "package-lock.json ausente"

# =============================================================================
# SECTION 4 & 5 — Preparação estrutural do usuário + /tmp (filesystem neutro)
#
# Finalidade:
#   Garantir que TODOS os diretórios críticos já existam antes que qualquer
#   processo do VS Code Server, extensões (Copilot) ou runtime Node seja iniciado.
#
# Esta etapa evita:
#   • EACCES silencioso (Copilot, VS Code Server, extensões)
#   • Criação tardia de diretórios por processos não-determinísticos
#   • Diferenças de comportamento entre primeiro attach e rebuild
#
# Princípios:
#   • Idempotente
#   • Não executa lógica de runtime
#   • Não depende de VS Code já estar rodando
#   • Apenas filesystem + permissões
# =============================================================================

log "Preparando filesystem estrutural do usuário e /tmp"

# -------------------------------------------------------------------------
# Diretórios de runtime (estado ativo do usuário)
# -------------------------------------------------------------------------
RUNTIME_DIRS=(
    "${HOME_DIR}/.npm"
    "${HOME_DIR}/.npm-global"
    "${HOME_DIR}/.pm2"
    "${HOME_DIR}/.ssh"
    "${HOME_DIR}/.gnupg"
    "${HOME_DIR}/.config"
    "${HOME_DIR}/.local"
    "${HOME_DIR}/.local/share"
    "${HOME_DIR}/.vscode-server"
    "${HOME_DIR}/.vscode-server/bin"
    "${HOME_DIR}/.vscode-server/data"
    "${HOME_DIR}/.vscode-server/data/Machine"
    "${HOME_DIR}/.vscode-server/data/User"
    "${HOME_DIR}/.vscode-server/extensions"
)

# -------------------------------------------------------------------------
# Diretórios de cache (XDG / tooling / Copilot / Puppeteer)
# -------------------------------------------------------------------------
CACHE_DIRS=(
    "${HOME_DIR}/.cache"
    "${HOME_DIR}/.cache/puppeteer"
    "${HOME_DIR}/.cache/Microsoft"
    "${HOME_DIR}/.vscode-server/extensionsCache"
)

# -------------------------------------------------------------------------
# Criação idempotente
# -------------------------------------------------------------------------
for dir in "${RUNTIME_DIRS[@]}" "${CACHE_DIRS[@]}"; do
    [[ -d "${dir}" ]] || mkdir -p "${dir}"
done

# -------------------------------------------------------------------------
# Permissões mínimas e seguras
# -------------------------------------------------------------------------
chmod 700 "${HOME_DIR}/.ssh" 2>/dev/null || true
chmod 700 "${HOME_DIR}/.gnupg" 2>/dev/null || true

chmod -R u+rwX "${HOME_DIR}/.cache" 2>/dev/null || true
chmod -R u+rwX "${HOME_DIR}/.vscode-server" 2>/dev/null || true

# -------------------------------------------------------------------------
# Ownership (blindagem contra UID/GID inconsistentes)
# -------------------------------------------------------------------------
chown -R node:node \
    "${HOME_DIR}/.npm" \
    "${HOME_DIR}/.npm-global" \
    "${HOME_DIR}/.pm2" \
    "${HOME_DIR}/.cache" \
    "${HOME_DIR}/.vscode-server" \
    "${HOME_DIR}/.config" \
    "${HOME_DIR}/.local" \
    "${HOME_DIR}/.ssh" \
    "${HOME_DIR}/.gnupg" \
    2>/dev/null || true

# -------------------------------------------------------------------------
# /tmp como infraestrutura real (VS Code Server / NSS Wrapper / IPC)
# -------------------------------------------------------------------------
## mkdir -p /tmp
## chmod 1777 /tmp

# =============================================================================
# SECTION 6 — NSS WRAPPER (UID/GID stability)
#
# Finalidade:
#   Garantir resolução consistente de usuário/grupo (getpwuid/getgrgid)
#   para processos que rodam com UID/GID dinâmicos (DevContainer / VS Code).
#
# Princípios:
#   • Runtime-only (NUNCA no Dockerfile)
#   • Escopo mínimo e seguro
#   • Idempotente
#   • Falha graciosa
#
# Justificativa:
#   • VS Code Server, Copilot e extensões usam libc NSS
#   • UID/GID reais não existem em /etc/passwd do container
#   • libnss_wrapper resolve isso sem alterar o sistema
# =============================================================================

log "Configurando NSS Wrapper (UID/GID dinâmicos)"

# -------------------------------------------------------------------------
# Paths canônicos (explícitos por segurança)
# -------------------------------------------------------------------------
NSS_PASSWD_FILE="/tmp/passwd"
NSS_GROUP_FILE="/tmp/group"

# -------------------------------------------------------------------------
# Gerar passwd temporário (idempotente)
# -------------------------------------------------------------------------
cat > "${NSS_PASSWD_FILE}" <<EOF
node:x:$(id -u):$(id -g):node user:${HOME_DIR}:/bin/bash
EOF

# -------------------------------------------------------------------------
# Gerar group temporário (idempotente)
# -------------------------------------------------------------------------
DOCKER_GID="$(getent group docker 2>/dev/null | cut -d: -f3 || true)"

{
    echo "node:x:$(id -g):"
    if [[ -n "${DOCKER_GID}" ]]; then
        echo "docker:x:${DOCKER_GID}:"
    fi
} > "${NSS_GROUP_FILE}"

chmod 644 "${NSS_PASSWD_FILE}" "${NSS_GROUP_FILE}"

# -------------------------------------------------------------------------
# Ativação segura do NSS Wrapper
# -------------------------------------------------------------------------
if ldconfig -p 2>/dev/null | grep -q "libnss_wrapper.so"; then
    export NSS_WRAPPER_PASSWD="${NSS_PASSWD_FILE}"
    export NSS_WRAPPER_GROUP="${NSS_GROUP_FILE}"
    export LD_PRELOAD="libnss_wrapper.so"

    log "NSS Wrapper ativado com LD_PRELOAD (runtime-only)"

    # ---------------------------------------------------------------------
    # Persistência controlada (somente para shells interativos)
    # Não afeta outros ambientes nem login shells externos
    # ---------------------------------------------------------------------
    if ! grep -q "DevContainer NSS Wrapper" "${HOME_DIR}/.bashrc" 2>/dev/null; then
        cat >> "${HOME_DIR}/.bashrc" <<'EOF'

 # --- DevContainer NSS Wrapper (runtime-safe)
 if [ -f /tmp/passwd ] && ldconfig -p 2>/dev/null | grep -q libnss_wrapper.so; then
  export NSS_WRAPPER_PASSWD=/tmp/passwd
  export NSS_WRAPPER_GROUP=/tmp/group
  export LD_PRELOAD=libnss_wrapper.so
 fi
 # ---------------------------------------------

EOF
    fi
else
    warn "libnss_wrapper.so não encontrado — NSS Wrapper não ativado"
fi


# =============================================================================
# SECTION 7 — Git (infraestrutura base, sem identidade)
# =============================================================================
if command -v git >/dev/null 2>&1; then
    log "Git disponível: $(git --version)"
else
    error "Git não encontrado no ambiente"
fi

BASE_GITCONFIG_SOURCE="${CONFIG_DIR}/.gitconfig"
TARGET_GITCONFIG="${HOME_DIR}/.gitconfig"

if [[ -f "${BASE_GITCONFIG_SOURCE}" && ! -f "${TARGET_GITCONFIG}" ]]; then
    log "Copiando .gitconfig base"
    cp "${BASE_GITCONFIG_SOURCE}" "${TARGET_GITCONFIG}"
    chmod 644 "${TARGET_GITCONFIG}"
fi

GIT_USER_NAME="$(git config --global user.name || true)"
GIT_USER_EMAIL="$(git config --global user.email || true)"

[[ -n "${GIT_USER_NAME}" && -n "${GIT_USER_EMAIL}" ]] \
    && log "Identidade Git configurada" \
    || warn "Identidade Git NÃO configurada (esperado nesta fase)"

# =============================================================================
# SECTION 8 — Diagnóstico técnico (read-only)
# =============================================================================
log "Node.js: $(node --version)"
log "npm: $(npm --version)"
log "PUPPETEER_MODE=${PUPPETEER_MODE:-não definido}"
log "PUPPETEER_WS_ENDPOINT=${PUPPETEER_WS_ENDPOINT:-não definido}"

# =============================================================================
# SECTION 9 — Registro de estado de inicialização
# =============================================================================
mkdir -p "${DEVCONTAINER_DIR}"

cat > "${STATE_FILE}" <<EOF
# DevContainer initialization marker
# Do not delete unless you intend to re-run post-create
initialized_at=$(date -Is)
script=${SCRIPT_NAME}
version=${SCRIPT_VERSION}
git_repo=${IS_GIT_REPO}
node_project=${IS_NODE_PROJECT}
makefile=${HAS_MAKEFILE}
EOF

log "Estado registrado em ${STATE_FILE}"

# =============================================================================
# SECTION 10 — Encerramento semântico
# =============================================================================
log "Inicialização estrutural concluída com sucesso"
