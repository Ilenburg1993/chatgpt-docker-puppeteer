#!/usr/bin/env bash
# ============================================================================
# setup-devcontainer.sh v4.0 — Infraestrutura pós-criação do Dev Container
# ============================================================================
#
# FINALIDADE
# ----------
# Script de infraestrutura executado via postCreateCommand (fase 6/9).
# Prepara ambiente de desenvolvimento de forma segura, idempotente e previsível.
#
# PRINCÍPIOS
# ----------
# • Workspace dinâmico (detecta automaticamente)
# • Privilégios mínimos (sudo apenas se necessário)
# • Idempotente (execuções repetidas são seguras)
# • Seguro para bind mounts (chown é opt-in)
# • Separação clara entre infra (container) e runtime (projeto)
# • Otimizado para Debian (host primário) + Windows/WSL2 (secundário)
#
# ESCOPO
# ------
# Este script cuida de:
#   ✓ Configuração básica do Git
#   ✓ Estrutura de diretórios do projeto
#   ✓ Permissões de ownership (opt-in)
#   ✓ Permissões de execução de scripts
#   ✓ Verificação de toolchain base
#   ✓ Detecção de host OS (Debian/WSL2)
#   ✓ Scripts modulares do .devcontainer
#
# Este script NÃO cuida de:
#   ✗ Instalação de pacotes de sistema (apt, apk) → Dockerfile
#   ✗ Instalação de ferramentas globais (npm -g, pip) → Dockerfile
#   ✗ Instalação de dependências do projeto → npm ci (postCreateCommand fase 5)
#   ✗ Validação de Chromium/Chrome → postCreateCommand fase 2-3
#   ✗ Inicialização de serviços → pm2, systemd (runtime)
#
# VARIÁVEIS DE CONTROLE
# ---------------------
# DEVCONTAINER_APPLY_CHOWN=true
#   → Aplica chown em diretórios específicos
#   ⚠️  Pode afetar permissões de arquivos do host em bind mounts
#
# DEVCONTAINER_WORKSPACE_FOLDER
#   → Path do workspace (detectado automaticamente se ausente)
#
# CONTAINER_SCRIPTS_PATH
#   → Path dos scripts modulares (default: /usr/local/bin)
#
# CHANGELOG
# ---------
# v4.0 (2026-01-23):
#   • Sincronizado com devcontainer.json v11.0
#   • Detecção de host OS (Debian/WSL2) via /tmp/host-os.txt
#   • Suporte a scripts modulares (CONTAINER_SCRIPTS_PATH)
#   • Validação de scripts do .devcontainer
#   • Avisos específicos por OS
#   • Melhorada estrutura de logs
#   • Remoção de código duplicado (Chrome/Chromium movido para postCreate)
# ============================================================================

set -euo pipefail

# ============================================================================
# CONFIGURAÇÃO CENTRALIZADA
# ============================================================================

readonly SCRIPT_VERSION="4.0"
readonly SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

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

# ============================================================================
# LOGGING & CORES
# ============================================================================

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

# ============================================================================
# FUNÇÕES AUXILIARES
# ============================================================================

safe_chown() {
    local target="$1"

    if [ ! -e "$target" ]; then
        log_warning "chown: alvo não existe: $target"
        return 1
    fi

    if [ "$RUN_MODE" = "user-no-sudo" ]; then
        log_warning "chown: sem privilégios: $target"
        return 1
    fi

    if $SUDO_CMD chown -R node:node "$target" 2>/dev/null; then
        local owner
        owner=$(stat -c '%U:%G' "$target" 2>/dev/null || echo 'unknown')
        log_success "chown executado: $target → $owner"
        return 0
    else
        log_warning "chown falhou (não-crítico): $target"
        return 1
    fi
}

has_command() {
    command -v "$1" >/dev/null 2>&1
}

# ============================================================================
# DETECÇÃO DO HOST OS
# ============================================================================

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

# ============================================================================
# DETECÇÃO DO WORKSPACE
# ============================================================================

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
    WORKSPACE="/workspaces"
    WORKSPACE_DETECTED_BY="fallback:/workspaces"
fi

# ============================================================================
# DETECÇÃO DE PRIVILÉGIOS
# ============================================================================

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

# ============================================================================
# CABEÇALHO
# ============================================================================

echo ""
echo "╔════════════════════════════════════════════════════════════════════╗"
echo "║  🚀 DevContainer Setup v${SCRIPT_VERSION} — Infraestrutura Adicional          ║"
echo "╚════════════════════════════════════════════════════════════════════╝"
echo ""
log_info "Host OS: ${CYAN}${HOST_OS}${NC}"
log_info "Workspace: ${CYAN}${WORKSPACE}${NC}"
log_info "Detectado por: ${CYAN}${WORKSPACE_DETECTED_BY}${NC}"
log_info "Modo de execução: ${CYAN}${RUN_MODE}${NC}"
log_info "chown opt-in: ${CYAN}${DEVCONTAINER_APPLY_CHOWN:-false}${NC}"
log_info "Log: ${CYAN}${LOG_FILE}${NC}"
echo ""

if [ "${DEVCONTAINER_APPLY_CHOWN:-false}" = "true" ]; then
    log_warning "chown ativado — pode afetar arquivos do host em bind mounts"
    echo ""
fi

# ============================================================================
# FASE 1: GIT
# ============================================================================

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
    log_info "user.name definido (padrão)"
else
    existing_name=$(git config --global user.name)
    log_info "user.name preservado: ${CYAN}${existing_name}${NC}"
fi

if ! git config --global user.email >/dev/null 2>&1; then
    git config --global user.email "devcontainer@example.com"
    log_info "user.email definido (padrão)"
else
    existing_email=$(git config --global user.email)
    log_info "user.email preservado: ${CYAN}${existing_email}${NC}"
fi

log_success "Git configurado"
echo ""

# ============================================================================
# FASE 2: DIRETÓRIOS
# ============================================================================

echo -e "${BLUE}[2/6]${NC} Criando estrutura de diretórios..."

DIRS_CREATED=0
DIRS_EXISTED=0

for dir in "${PROJECT_DIRS[@]}"; do
    full_path="$WORKSPACE/$dir"

    if [ -d "$full_path" ]; then
        ((DIRS_EXISTED++))
    else
        if mkdir -p "$full_path" 2>/dev/null; then
            log_success "Criado: $dir"
            ((DIRS_CREATED++))
        else
            log_error "Falha ao criar: $dir"
        fi
    fi
done

log_info "Criados: ${CYAN}${DIRS_CREATED}${NC} | Já existiam: ${CYAN}${DIRS_EXISTED}${NC}"
log_success "Estrutura de diretórios pronta"
echo ""

# ============================================================================
# FASE 3: OWNERSHIP
# ============================================================================

if [ "${DEVCONTAINER_APPLY_CHOWN:-false}" = "true" ]; then
    echo -e "${BLUE}[3/6]${NC} Ajustando ownership (modo opt-in)..."

    CHOWN_EXECUTED=0
    CHOWN_SKIPPED=0
    CHOWN_FAILED=0

    for target in "${CHOWN_TARGETS[@]}"; do
        full_path="$WORKSPACE/$target"

        if [ ! -e "$full_path" ]; then
            ((CHOWN_SKIPPED++))
            continue
        fi

        if safe_chown "$full_path"; then
            ((CHOWN_EXECUTED++))
        else
            ((CHOWN_FAILED++))
        fi
    done

    log_info "Executados: ${CYAN}${CHOWN_EXECUTED}${NC} | Ignorados: ${CYAN}${CHOWN_SKIPPED}${NC} | Falhas: ${CYAN}${CHOWN_FAILED}${NC}"
    log_success "Ownership processado"
else
    echo -e "${BLUE}[3/6]${NC} Ajuste de ownership ignorado (opt-in desativado)"
fi
echo ""

# ============================================================================
# FASE 4: SCRIPTS
# ============================================================================

echo -e "${BLUE}[4/6]${NC} Ajustando permissões de scripts..."

SCRIPTS_FOUND=0
SCRIPTS_FAILED=0

for pattern in "${EXECUTABLE_SCRIPTS[@]}"; do
    for script in $WORKSPACE/$pattern 2>/dev/null; do
        if [ -f "$script" ]; then
            if chmod +x "$script" 2>/dev/null; then
                log_success "Executável (projeto): $(basename "$script")"
                ((SCRIPTS_FOUND++))
            else
                log_warning "Falha: $(basename "$script")"
                ((SCRIPTS_FAILED++))
            fi
        fi
    done
done

if [ -d "$WORKSPACE/.devcontainer/scripts" ]; then
    for script in "$WORKSPACE/.devcontainer/scripts"/*.sh 2>/dev/null; do
        if [ -f "$script" ]; then
            if chmod +x "$script" 2>/dev/null; then
                log_success "Executável (.devcontainer): $(basename "$script")"
                ((SCRIPTS_FOUND++))
            else
                log_warning "Falha: $(basename "$script")"
                ((SCRIPTS_FAILED++))
            fi
        fi
    done
fi

if [ $SCRIPTS_FOUND -eq 0 ]; then
    log_info "Nenhum script encontrado (normal em primeiro setup)"
else
    log_info "Processados: ${CYAN}${SCRIPTS_FOUND}${NC} | Falhas: ${CYAN}${SCRIPTS_FAILED}${NC}"
    log_success "$SCRIPTS_FOUND scripts tornados executáveis"
fi
echo ""

# ============================================================================
# FASE 5: SCRIPTS MODULARES
# ============================================================================

echo -e "${BLUE}[5/6]${NC} Verificando scripts modulares..."

CONTAINER_SCRIPTS_PATH="${CONTAINER_SCRIPTS_PATH:-/usr/local/bin}"

SCRIPTS_MODULAR_OK=0
SCRIPTS_MODULAR_MISSING=0

if [ -x "${CONTAINER_SCRIPTS_PATH}/devcontainer-healthcheck.sh" ]; then
    log_success "devcontainer-healthcheck.sh disponível"
    ((SCRIPTS_MODULAR_OK++))
else
    log_warning "devcontainer-healthcheck.sh ausente"
    ((SCRIPTS_MODULAR_MISSING++))
fi

if [ -x "${CONTAINER_SCRIPTS_PATH}/validate-chrome.sh" ]; then
    log_success "validate-chrome.sh disponível"
    ((SCRIPTS_MODULAR_OK++))
else
    log_warning "validate-chrome.sh ausente"
    ((SCRIPTS_MODULAR_MISSING++))
fi

log_info "Scripts modulares: ${CYAN}${SCRIPTS_MODULAR_OK}${NC} OK | ${CYAN}${SCRIPTS_MODULAR_MISSING}${NC} ausentes"
echo ""

# ============================================================================
# FASE 6: TOOLCHAIN
# ============================================================================

echo -e "${BLUE}[6/6]${NC} Verificando ferramentas..."

TOOLS_CRITICAL_OK=0
TOOLS_CRITICAL_MISSING=0
TOOLS_OPTIONAL_OK=0
TOOLS_OPTIONAL_MISSING=0

if has_command node; then
    log_success "Node.js $(node --version)"
    ((TOOLS_CRITICAL_OK++))
else
    log_error "Node.js ausente (CRÍTICO)"
    ((TOOLS_CRITICAL_MISSING++))
fi

if has_command npm; then
    log_success "npm $(npm --version)"
    ((TOOLS_CRITICAL_OK++))
else
    log_error "npm ausente (CRÍTICO)"
    ((TOOLS_CRITICAL_MISSING++))
fi

if has_command git; then
    log_success "git $(git --version | head -1)"
    ((TOOLS_CRITICAL_OK++))
else
    log_error "git ausente (CRÍTICO)"
    ((TOOLS_CRITICAL_MISSING++))
fi

if has_command make; then
    log_success "make disponível"
    ((TOOLS_OPTIONAL_OK++))
else
    log_info "make não encontrado (opcional)"
    ((TOOLS_OPTIONAL_MISSING++))
fi

if has_command curl; then
    log_success "curl disponível"
    ((TOOLS_OPTIONAL_OK++))
else
    log_info "curl não encontrado (opcional)"
    ((TOOLS_OPTIONAL_MISSING++))
fi

for tool in bat fd rg fzf tree; do
    if has_command "$tool"; then
        log_success "$tool disponível"
        ((TOOLS_OPTIONAL_OK++))
    else
        log_info "$tool não encontrado (opcional)"
        ((TOOLS_OPTIONAL_MISSING++))
    fi
done

echo ""

# ============================================================================
# RESUMO FINAL
# ============================================================================

echo "╔════════════════════════════════════════════════════════════════════╗"
echo "║  🎉 SETUP ADICIONAL CONCLUÍDO                                     ║"
echo "╚════════════════════════════════════════════════════════════════════╝"
echo ""
echo "═══ RESUMO DO AMBIENTE ═══"
echo ""
echo "  Versão do script:         v${SCRIPT_VERSION}"
echo "  Host OS:                  ${HOST_OS}"
echo "  Workspace:                ${WORKSPACE}"
echo "  Detectado por:            ${WORKSPACE_DETECTED_BY}"
echo "  Modo de execução:         ${RUN_MODE}"
echo ""
echo "═══ AÇÕES EXECUTADAS ═══"
echo ""
echo "  Diretórios criados:       ${DIRS_CREATED}"
echo "  Diretórios existentes:    ${DIRS_EXISTED}"

if [ "${DEVCONTAINER_APPLY_CHOWN:-false}" = "true" ]; then
echo "  chown executados:         ${CHOWN_EXECUTED}"
echo "  chown ignorados:          ${CHOWN_SKIPPED}"
echo "  chown falhas:             ${CHOWN_FAILED}"
else
echo "  chown:                    desativado (opt-in)"
fi

echo "  Scripts executáveis:      ${SCRIPTS_FOUND}"
echo "  Scripts modulares:        ${SCRIPTS_MODULAR_OK} OK | ${SCRIPTS_MODULAR_MISSING} ausentes"
echo ""
echo "═══ TOOLCHAIN ═══"
echo ""
echo "  Ferramentas críticas:     ${TOOLS_CRITICAL_OK} OK | ${TOOLS_CRITICAL_MISSING} ausentes"
echo "  Ferramentas opcionais:    ${TOOLS_OPTIONAL_OK} OK | ${TOOLS_OPTIONAL_MISSING} ausentes"

if [ $TOOLS_CRITICAL_MISSING -gt 0 ]; then
echo ""
echo "  ⚠️  AMBIENTE INCONSISTENTE: Ferramentas críticas ausentes"
echo "  Verifique o Dockerfile e reconstrua o container"
fi

echo ""
echo "═══ AVISOS ESPECÍFICOS DO HOST ═══"
echo ""

if [ "$HOST_OS" = "debian" ]; then
    echo "  🐧 Debian detectado (host primário)"
    echo "  • Performance de I/O otimizada"
    echo "  • Chrome remoto: google-chrome --remote-debugging-port=9222"
elif [ "$HOST_OS" = "wsl2" ]; then
    echo "  🪟 Windows/WSL2 detectado"
    echo "  • Verifique que projeto está em ~/workspace (não /mnt/c/)"
    echo "  • Chrome remoto: Rodar no Windows (chrome.exe)"
    echo "  • Line endings: Configurado para LF"
fi

echo ""
echo "  Log completo: ${LOG_FILE}"
echo ""

exit 0
