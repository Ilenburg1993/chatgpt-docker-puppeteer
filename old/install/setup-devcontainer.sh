#!/usr/bin/env bash
# =============================================================================
# setup-devcontainer.sh v5.2 - Infraestrutura DevContainer
# =============================================================================
#
# FINALIDADE
# ----------
# Script de infraestrutura executado via postCreateCommand.
# Prepara ambiente de desenvolvimento de forma segura, idempotente e previsivel.
#
# CORREÇÃO v5.2:
# • Substituida aritmética ((VAR++)) por VAR=$((VAR+1)) para evitar
#   erros com 'set -e' quando o valor inicial é 0.
#
# =============================================================================

set -euo pipefail

# =============================================================================
# CONFIGURACAO CENTRALIZADA
# =============================================================================

readonly SCRIPT_VERSION="5.2"
readonly SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
readonly PROJECT_NAME="chatgpt-docker-puppeteer"

readonly PROJECT_DIRS=(
    fila
    respostas
    logs
    tmp
    backups
    monitoring
    monitoring/alerts
    monitoring/metrics
    profile
    node_modules
)

readonly CHOWN_TARGETS=(
    node_modules
    profile
    logs
    tmp
    backups
    respostas
    fila
)

readonly EXECUTABLE_SCRIPTS=(
    scripts/*.sh
    launcher.sh
)

# =============================================================================
# LOGGING
# =============================================================================

LOG_FILE="/tmp/devcontainer-setup.log"
exec > >(tee -a "$LOG_FILE") 2>&1

readonly RED='\033[0;31m'
readonly GREEN='\033[0;32m'
readonly YELLOW='\033[1;33m'
readonly BLUE='\033[0;34m'
readonly CYAN='\033[0;36m'
readonly NC='\033[0m'

log_info()    { echo -e "${BLUE}ℹ${NC}  $*"; }
log_success() { echo -e "${GREEN}✓${NC}  $*"; }
log_warning() { echo -e "${YELLOW}⚠${NC}  $*"; }
log_error()   { echo -e "${RED}✗${NC}  $*"; }

# =============================================================================
# FUNCOES AUXILIARES
# =============================================================================

safe_chown() {
    local target="$1"

    if [ ! -e "$target" ]; then
        log_warning "chown: alvo nao existe: $target"
        return 1
    fi

    if [ "$RUN_MODE" = "user-no-sudo" ]; then
        log_warning "chown: sem privilegios: $target"
        return 1
    fi

    if $SUDO_CMD chown -R node:node "$target" 2>/dev/null; then
        local owner
        owner=$(stat -c '%U:%G' "$target" 2>/dev/null || echo 'unknown')
        log_success "chown executado: $target → $owner"
        return 0
    else
        log_warning "chown falhou (nao-critico): $target"
        return 1
    fi
}

has_command() {
    command -v "$1" >/dev/null 2>&1
}

# =============================================================================
# DETECCAO DO HOST OS
# =============================================================================

HOST_OS="unknown"
if [ -f /tmp/host-os.txt ]; then
    HOST_OS=$(cat /tmp/host-os.txt)
else
    if [ -f /proc/version ]; then
        if grep -qi microsoft /proc/version; then
            HOST_OS="wsl2"
        elif grep -qi debian /proc/version || [ -f /etc/debian_version ]; then
            HOST_OS="debian"
        else
            HOST_OS="linux"
        fi
    fi
fi

# =============================================================================
# DETECCAO DO WORKSPACE
# =============================================================================

WORKSPACE="${DEVCONTAINER_WORKSPACE_FOLDER:-}"
WORKSPACE_DETECTED_BY="env:DEVCONTAINER_WORKSPACE_FOLDER"

if [ -z "$WORKSPACE" ] || [ ! -d "$WORKSPACE" ]; then
    if has_command git; then
        if git_root=$(git rev-parse --show-toplevel 2>/dev/null); then
            WORKSPACE="$git_root"
            WORKSPACE_DETECTED_BY="git:rev-parse"
        fi
    fi
fi

if [ -z "$WORKSPACE" ] && [ -f "${PWD}/package.json" ]; then
    WORKSPACE="$PWD"
    WORKSPACE_DETECTED_BY="pwd:package.json"
fi

if [ -z "$WORKSPACE" ]; then
    WORKSPACE="/workspaces/${PROJECT_NAME}"
    WORKSPACE_DETECTED_BY="fallback:/workspaces/${PROJECT_NAME}"
fi

# =============================================================================
# DETECCAO DE PRIVILEGIOS
# =============================================================================

RUN_MODE="user"
SUDO_CMD=""

if [ "$(id -u)" -eq 0 ]; then
    RUN_MODE="root"
elif has_command sudo && sudo -n true 2>/dev/null; then
    RUN_MODE="user-with-sudo"
    SUDO_CMD="sudo"
else
    RUN_MODE="user-no-sudo"
fi

# =============================================================================
# CABECALHO
# =============================================================================

echo ""
echo "╔════════════════════════════════════════════════════════════════════╗"
echo "║  🚀 DevContainer Setup v${SCRIPT_VERSION}                                   ║"
echo "╚════════════════════════════════════════════════════════════════════╝"
echo ""
log_info "Projeto: ${CYAN}${PROJECT_NAME}${NC}"
log_info "Host OS: ${CYAN}${HOST_OS}${NC}"
log_info "Workspace: ${CYAN}${WORKSPACE}${NC}"
log_info "Detectado por: ${CYAN}${WORKSPACE_DETECTED_BY}${NC}"
log_info "Modo de execucao: ${CYAN}${RUN_MODE}${NC}"
log_info "chown opt-in: ${CYAN}${DEVCONTAINER_APPLY_CHOWN:-false}${NC}"
log_info "Log: ${CYAN}${LOG_FILE}${NC}"
echo ""

if [ "${DEVCONTAINER_APPLY_CHOWN:-false}" = "true" ]; then
    log_warning "chown ativado — pode afetar arquivos do host em bind mounts"
    echo ""
fi

# =============================================================================
# FASE 1: GIT
# =============================================================================

echo -e "${BLUE}[1/6]${NC} Configurando Git..."

git config --global init.defaultBranch main 2>/dev/null || true
git config --global pull.rebase false 2>/dev/null || true
git config --global core.autocrlf input 2>/dev/null || true

if [ "$HOST_OS" = "wsl2" ]; then
    git config --global core.eol lf 2>/dev/null || true
    log_info "core.eol=lf configurado (WSL2)"
fi

if ! git config --global user.name >/dev/null 2>&1; then
    git config --global user.name "DevContainer User"
    log_info "user.name definido (padrao)"
else
    existing_name=$(git config --global user.name)
    log_info "user.name preservado: ${CYAN}${existing_name}${NC}"
fi

if ! git config --global user.email >/dev/null 2>&1; then
    git config --global user.email "devcontainer@example.com"
    log_info "user.email definido (padrao)"
else
    existing_email=$(git config --global user.email)
    log_info "user.email preservado: ${CYAN}${existing_email}${NC}"
fi

log_success "Git configurado"
echo ""

# =============================================================================
# FASE 2: DIRETORIOS
# =============================================================================

echo -e "${BLUE}[2/6]${NC} Criando estrutura de diretorios..."

DIRS_CREATED=0
DIRS_EXISTED=0

for dir in "${PROJECT_DIRS[@]}"; do
    full_path="$WORKSPACE/$dir"

    if [ -d "$full_path" ]; then
        DIRS_EXISTED=$((DIRS_EXISTED+1))
    else
        if mkdir -p "$full_path" 2>/dev/null; then
            log_success "Criado: $dir"
            DIRS_CREATED=$((DIRS_CREATED+1))
        else
            log_error "Falha ao criar: $dir"
        fi
    fi
done

log_info "Criados: ${CYAN}${DIRS_CREATED}${NC} | Ja existiam: ${CYAN}${DIRS_EXISTED}${NC}"
log_success "Estrutura de diretorios pronta"
echo ""

# =============================================================================
# FASE 3: OWNERSHIP
# =============================================================================

if [ "${DEVCONTAINER_APPLY_CHOWN:-false}" = "true" ]; then
    echo -e "${BLUE}[3/6]${NC} Ajustando ownership (modo opt-in)..."

    CHOWN_EXECUTED=0
    CHOWN_SKIPPED=0
    CHOWN_FAILED=0

    for target in "${CHOWN_TARGETS[@]}"; do
        full_path="$WORKSPACE/$target"

        if [ ! -e "$full_path" ]; then
            CHOWN_SKIPPED=$((CHOWN_SKIPPED+1))
            continue
        fi

        if safe_chown "$full_path"; then
            CHOWN_EXECUTED=$((CHOWN_EXECUTED+1))
        else
            CHOWN_FAILED=$((CHOWN_FAILED+1))
        fi
    done

    log_info "Executados: ${CYAN}${CHOWN_EXECUTED}${NC} | Ignorados: ${CYAN}${CHOWN_SKIPPED}${NC} | Falhas: ${CYAN}${CHOWN_FAILED}${NC}"
    log_success "Ownership processado"
else
    echo -e "${BLUE}[3/6]${NC} Ajuste de ownership ignorado (opt-in desativado)"
fi
echo ""

# =============================================================================
# FASE 4: SCRIPTS
# =============================================================================

echo -e "${BLUE}[4/6]${NC} Ajustando permissoes de scripts..."

SCRIPTS_FOUND=0
SCRIPTS_FAILED=0

# Permite glob vazio sem expandir para literal
shopt -s nullglob

for pattern in "${EXECUTABLE_SCRIPTS[@]}"; do
    for script in "$WORKSPACE"/$pattern; do
        if [ -f "$script" ]; then
            if chmod +x "$script" 2>/dev/null; then
                log_success "Executavel (projeto): $(basename "$script")"
                SCRIPTS_FOUND=$((SCRIPTS_FOUND+1))
            else
                log_warning "Falha: $(basename "$script")"
                SCRIPTS_FAILED=$((SCRIPTS_FAILED+1))
            fi
        fi
    done
done

if [ -d "$WORKSPACE/.devcontainer/scripts" ]; then
    for script in "$WORKSPACE/.devcontainer/scripts"/*.sh; do
        if [ -f "$script" ]; then
            if chmod +x "$script" 2>/dev/null; then
                log_success "Executavel (.devcontainer): $(basename "$script")"
                SCRIPTS_FOUND=$((SCRIPTS_FOUND+1))
            else
                log_warning "Falha: $(basename "$script")"
                SCRIPTS_FAILED=$((SCRIPTS_FAILED+1))
            fi
        fi
    done
fi

shopt -u nullglob

if [ "$SCRIPTS_FOUND" -eq 0 ]; then
    log_info "Nenhum script encontrado (normal em primeiro setup)"
else
    log_info "Processados: ${CYAN}${SCRIPTS_FOUND}${NC} | Falhas: ${CYAN}${SCRIPTS_FAILED}${NC}"
    log_success "$SCRIPTS_FOUND scripts tornados executaveis"
fi

echo ""

# =============================================================================
# FASE 5: SCRIPTS MODULARES
# =============================================================================

echo -e "${BLUE}[5/6]${NC} Verificando scripts modulares..."

CONTAINER_SCRIPTS_PATH="${CONTAINER_SCRIPTS_PATH:-/usr/local/bin}"

SCRIPTS_MODULAR_OK=0
SCRIPTS_MODULAR_MISSING=0

if [ -x "${CONTAINER_SCRIPTS_PATH}/devcontainer-healthcheck.sh" ]; then
    log_success "devcontainer-healthcheck.sh disponivel"
    SCRIPTS_MODULAR_OK=$((SCRIPTS_MODULAR_OK+1))
else
    log_warning "devcontainer-healthcheck.sh ausente"
    SCRIPTS_MODULAR_MISSING=$((SCRIPTS_MODULAR_MISSING+1))
fi

if [ -x "${CONTAINER_SCRIPTS_PATH}/validate-chrome.sh" ]; then
    log_success "validate-chrome.sh disponivel"
    SCRIPTS_MODULAR_OK=$((SCRIPTS_MODULAR_OK+1))
else
    log_warning "validate-chrome.sh ausente"
    SCRIPTS_MODULAR_MISSING=$((SCRIPTS_MODULAR_MISSING+1))
fi

log_info "Scripts modulares: ${CYAN}${SCRIPTS_MODULAR_OK}${NC} OK | ${CYAN}${SCRIPTS_MODULAR_MISSING}${NC} ausentes"
echo ""

# =============================================================================
# FASE 6: TOOLCHAIN
# =============================================================================

echo -e "${BLUE}[6/6]${NC} Verificando ferramentas..."

TOOLS_CRITICAL_OK=0
TOOLS_CRITICAL_MISSING=0
TOOLS_OPTIONAL_OK=0
TOOLS_OPTIONAL_MISSING=0

if has_command node; then
    log_success "Node.js $(node --version)"
    TOOLS_CRITICAL_OK=$((TOOLS_CRITICAL_OK+1))
else
    log_error "Node.js ausente (CRITICO)"
    TOOLS_CRITICAL_MISSING=$((TOOLS_CRITICAL_MISSING+1))
fi

if has_command npm; then
    log_success "npm $(npm --version)"
    TOOLS_CRITICAL_OK=$((TOOLS_CRITICAL_OK+1))
else
    log_error "npm ausente (CRITICO)"
    TOOLS_CRITICAL_MISSING=$((TOOLS_CRITICAL_MISSING+1))
fi

if has_command git; then
    log_success "git $(git --version | head -1)"
    TOOLS_CRITICAL_OK=$((TOOLS_CRITICAL_OK+1))
else
    log_error "git ausente (CRITICO)"
    TOOLS_CRITICAL_MISSING=$((TOOLS_CRITICAL_MISSING+1))
fi

if has_command make; then
    log_success "make disponivel"
    TOOLS_OPTIONAL_OK=$((TOOLS_OPTIONAL_OK+1))
else
    log_info "make nao encontrado (opcional)"
    TOOLS_OPTIONAL_MISSING=$((TOOLS_OPTIONAL_MISSING+1))
fi

if has_command curl; then
    log_success "curl disponivel"
    TOOLS_OPTIONAL_OK=$((TOOLS_OPTIONAL_OK+1))
else
    log_info "curl nao encontrado (opcional)"
    TOOLS_OPTIONAL_MISSING=$((TOOLS_OPTIONAL_MISSING+1))
fi

for tool in bat fd rg fzf tree; do
    if has_command "$tool"; then
        log_success "$tool disponivel"
        TOOLS_OPTIONAL_OK=$((TOOLS_OPTIONAL_OK+1))
    else
        log_info "$tool nao encontrado (opcional)"
        TOOLS_OPTIONAL_MISSING=$((TOOLS_OPTIONAL_MISSING+1))
    fi
done

echo ""

# =============================================================================
# RESUMO FINAL
# =============================================================================

echo "╔════════════════════════════════════════════════════════════════════╗"
echo "║  🎉 SETUP CONCLUIDO                                                ║"
echo "╚════════════════════════════════════════════════════════════════════╝"
echo ""
echo "═══ RESUMO DO AMBIENTE ═══"
echo ""
echo "  Versao do script:         v${SCRIPT_VERSION}"
echo "  Projeto:                  ${PROJECT_NAME}"
echo "  Host OS:                  ${HOST_OS}"
echo "  Workspace:                ${WORKSPACE}"
echo "  Detectado por:            ${WORKSPACE_DETECTED_BY}"
echo "  Modo de execucao:         ${RUN_MODE}"
echo ""
echo "═══ ACOES EXECUTADAS ═══"
echo ""
echo "  Diretorios criados:       ${DIRS_CREATED}"
echo "  Diretorios existentes:    ${DIRS_EXISTED}"

if [ "${DEVCONTAINER_APPLY_CHOWN:-false}" = "true" ]; then
    echo "  chown executados:         ${CHOWN_EXECUTED}"
    echo "  chown ignorados:          ${CHOWN_SKIPPED}"
    echo "  chown falhas:             ${CHOWN_FAILED}"
else
    echo "  chown:                    desativado (opt-in)"
fi

echo "  Scripts executaveis:      ${SCRIPTS_FOUND}"
echo "  Scripts modulares:        ${SCRIPTS_MODULAR_OK} OK | ${SCRIPTS_MODULAR_MISSING} ausentes"
echo ""
echo "═══ TOOLCHAIN ═══"
echo ""
echo "  Ferramentas criticas:     ${TOOLS_CRITICAL_OK} OK | ${TOOLS_CRITICAL_MISSING} ausentes"
echo "  Ferramentas opcionais:    ${TOOLS_OPTIONAL_OK} OK | ${TOOLS_OPTIONAL_MISSING} ausentes"

if [ $TOOLS_CRITICAL_MISSING -gt 0 ]; then
    echo ""
    echo "  ⚠️  AMBIENTE INCONSISTENTE: Ferramentas criticas ausentes"
    echo "  Verifique o Dockerfile e reconstrua o container"
fi

echo ""
echo "═══ PROXIMO PASSO ═══"
echo ""
echo "  Instale dependencias do projeto:"
echo "    cd ${WORKSPACE}"
echo "    npm ci"
echo ""
echo "═══ AVISOS ESPECIFICOS DO HOST ═══"
echo ""

if [ "$HOST_OS" = "debian" ]; then
    echo "  🐧 Debian detectado"
    echo "  • Performance de I/O otimizada"
    echo "  • Chrome remoto: google-chrome --remote-debugging-port=9222"
elif [ "$HOST_OS" = "wsl2" ]; then
    echo "  🪟 Windows/WSL2 detectado"
    echo "  • Path Windows: D:\\chatgpt-docker-puppeteer"
    echo "  • Path Container: /workspaces/chatgpt-docker-puppeteer"
    echo "  • Verifique que projeto esta em ~/workspace (nao /mnt/c/)"
    echo "  • Chrome remoto: Rodar no Windows (chrome.exe)"
    echo "  • Comando: chrome.exe --remote-debugging-port=9222"
    echo "  • Line endings: Configurado para LF"
else
    echo "  💻 Linux generico detectado"
    echo "  • Chrome remoto: google-chrome --remote-debugging-port=9222"
fi

echo ""
echo "  Log completo: ${LOG_FILE}"
echo ""

exit 0
