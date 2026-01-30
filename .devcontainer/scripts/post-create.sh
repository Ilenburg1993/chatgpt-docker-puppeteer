#!/usr/bin/env bash
# =============================================================================
# post-create.sh — Inicialização estrutural do DevContainer
# v3.8.0-Elite | Simbiose Tecnológica
#
# CONTRATO (INVIOLÁVEL):
#   • Executado como usuário 'node' (sem sudo)
#   • Toca APENAS em volumes declarados e caminhos efêmeros (/tmp)
#   • Idempotente e Resiliente (Self-healing estrutural)
#   • Fail-Fast: Reporta erros de infraestrutura sem mascará-los
# =============================================================================
set -e -o pipefail

# =============================================================================
# SECTION 1 — INFRAESTRUTURA DE LOGGING & IDENTIDADE GLOBAL
#
# Finalidade:
#   • Estabelecer a telemetria do script (Terminal + Arquivo).
#   • Estabilizar a raiz do projeto (Âncora Invariável).
#   • Implementar Housekeeping: Rotação automática de logs.
# =============================================================================
# 1.1 Identidade Centralizada
SCRIPT_NAME="post-create.sh"
SCRIPT_VERSION="3.8.0-Elite"
SCRIPT_HASH="$(sha256sum "$0" 2>/dev/null | awk '{print $1}' || echo "unknown")"

# 1.2 Estabilização de Caminhos (Âncora de Diretório)
# Descobre a raiz do projeto baseada na localização física deste script.
# Impede falhas se o script for invocado de subpastas ou via caminhos relativos.
readonly PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
readonly LOG_DIR="${PROJECT_ROOT}/.devcontainer/logs"
readonly LOG_FILE="${LOG_DIR}/post-create.log"

# Garante que o diretório de logs exista
mkdir -p "${LOG_DIR}"

# 1.3 Política de Retenção (Housekeeping)
if [[ -f "${LOG_FILE}" ]]; then
    # stat -c%s (GNU) ou fallback seguro
    if [ "$(stat -c%s "${LOG_FILE}" 2>/dev/null || echo 0)" -gt 2097152 ]; then
        mv "${LOG_FILE}" "${LOG_FILE}.old"
    fi
fi

# 1.4 Redirecionamento Global com Bypass (Fail-Safe)
exec > >(tee -a "${LOG_FILE}" || cat) 2>&1

# 1.5 Timestamps & Cores (ANSI)
_ts() { date +'%H:%M:%S'; }
_blue="\e[34m"
_yellow="\e[33m"
_red="\e[31m"
_reset="\e[0m"

# 1.6 Funções de Saída Padronizada
log()   { echo -e "[${_blue}$(_ts)${_reset}] [${SCRIPT_NAME}] ℹ️  $*"; }
warn()  { echo -e "[${_yellow}$(_ts)${_reset}] [${SCRIPT_NAME}] ⚠️  $*" >&2; }
error() { echo -e "[${_red}$(_ts)${_reset}] [${SCRIPT_NAME}] ❌ $*" >&2; }

log "Simbiose v${SCRIPT_VERSION} inicializada (Root: ${PROJECT_ROOT})"
log "Rastro físico: ${LOG_FILE}"

# =============================================================================
# SECTION 2 — CONTRATO DE IDENTIDADE (GUARD RAILS)
# =============================================================================
# Auditoria: Sincronizado com 'remoteUser' do devcontainer.json
readonly EXPECTED_USER="node"
readonly CURRENT_USER="$(id -un)"
readonly CURRENT_UID="$(id -u)"
readonly CURRENT_GID="$(id -g)"

if [[ "${CURRENT_USER}" != "${EXPECTED_USER}" ]]; then
    error "Contrato violado: esperado '${EXPECTED_USER}', recebido '${CURRENT_USER}'."
    error "Ação: Verifique a propriedade 'remoteUser' no devcontainer.json."
    exit 1
fi

log "Identidade validada: ${CURRENT_USER} (UID:${CURRENT_UID})"

# =============================================================================
# SECTION 3 — CONTEXTO, PATHS & IDEMPOTÊNCIA (GATEKEEPER)
# =============================================================================
# 3.1 Estabilização de Caminhos (Substitui o instável 'pwd')
readonly HOME_DIR="${HOME}"
readonly DEVCONTAINER_DIR="${PROJECT_ROOT}/.devcontainer"
readonly STATE_FILE="${DEVCONTAINER_DIR}/.initialized"

# Flag de compatibilidade: escrita/leitura do arquivo de estado é opt-in.
# Por padrão esta feature está DESATIVADA para forçar a descoberta via NERV.
if [[ "${ENABLE_STATE_FILE:-}" != "true" ]]; then
    log "ENABLE_STATE_FILE não habilitado — leituras/escritas de estado estrutural desativadas."
    SKIP_STATE_FILE=true
else
    SKIP_STATE_FILE=false
fi

# --- Verificação de Idempotência (Gatekeeper) ---
# Impede a execução duplicada em rebuilds se o estado já estiver consolidado.
if [[ "${SKIP_STATE_FILE}" != "true" && -f "${STATE_FILE}" ]]; then
    log "Estado detectado (${STATE_FILE}) — Simbiose já ativa."
    log "Abortando inicialização estrutural para preservar integridade."
    exit 0
fi

# --- Registro do "Momento Zero" ---
log "Iniciando Simbiose v${SCRIPT_VERSION} | Inicialização Estrutural"
log "Hash: ${SCRIPT_HASH:0:8} | User: ${CURRENT_USER} (UID:${CURRENT_UID})"
log "Paths: HOME=${HOME_DIR} | PROJECT_ROOT=${PROJECT_ROOT}"

# =============================================================================
# SECTION 4 — AUDITORIA DE ESTRUTURA (HANDSHAKE)
# =============================================================================
log "Realizando auditoria de estrutura de arquivos (Handshake)..."

# Detecção passiva de artefatos essenciais na raiz estabilizada
[[ -d "${PROJECT_ROOT}/.git" ]]         && log "Audit: Repositório Git detectado"
[[ -f "${PROJECT_ROOT}/package.json" ]] && log "Audit: Manifesto Node.js detectado"
[[ -f "${PROJECT_ROOT}/Makefile" ]]     && log "Audit: Makefile (Governor) detectado"

# Alerta passivo: A ausência do Makefile é crítica para a governança do container
if [[ ! -f "${PROJECT_ROOT}/Makefile" ]]; then
    warn "Audit: Makefile não localizado em ${PROJECT_ROOT}."
    warn "Verifique se o volume do workspace foi montado corretamente no Host."
fi

# =============================================================================
# SECTION 5 — GESTÃO DE VOLUMES & IDENTIDADE SSH (ESTRUTURAL & DEFENSIVA)
#
# Responsabilidade:
#   • Validar a presença e integridade de todos os volumes declarados
#   • Recuperar ownership quando mounts vêm do host como root
#   • Fail-Fast para volumes CRÍTICOS não graváveis
#   • Endurecer identidade (SSH / GPG) sem jamais tocar chaves privadas
#
# NOTAS DE SEGURANÇA:
#   • SSH keys pertencem EXCLUSIVAMENTE ao host (via agent)
#   • Este script NUNCA copia, cria ou lê chaves privadas
#   • Apenas garante estrutura, permissões e compatibilidade OpenSSH
# =============================================================================
log "Validando integridade estrutural dos volumes (Sincronia Total)..."

# ---------------------------------------------------------------------------
# 1. Lista canônica de volumes (sincronizada com devcontainer.json)
# ---------------------------------------------------------------------------
readonly VOLUME_DIRS=(
    "${HOME_DIR}/.cache"
    "${HOME_DIR}/.cache/puppeteer"
    "${HOME_DIR}/.npm"
    "${HOME_DIR}/.npm-global"
    "${HOME_DIR}/.pm2"
    "${HOME_DIR}/.config"
    "${HOME_DIR}/.local/share"
    "${HOME_DIR}/.local/state"
    "${HOME_DIR}/.claude"
    "${HOME_DIR}/.ssh"
    "${HOME_DIR}/.gnupg"
    "${HOME_DIR}/.vscode-server"
    "/home/${CURRENT_USER}-history"
)

# ---------------------------------------------------------------------------
# 2. Volumes CRÍTICOS (falha ⇒ aborta boot)
# ---------------------------------------------------------------------------
readonly CRITICAL_VOLUMES=(
    "${HOME_DIR}/.config"
    "${HOME_DIR}/.claude"
    "${HOME_DIR}/.local/state"
)

# ---------------------------------------------------------------------------
# 3. Auditoria principal de volumes
# ---------------------------------------------------------------------------
for dir in "${VOLUME_DIRS[@]}"; do
    # A. Criação defensiva (não falha)
    if [[ ! -d "${dir}" ]]; then
        log "Audit: Criando ponto de montagem ausente: ${dir}"
        mkdir -p "${dir}" 2>/dev/null || true
    fi

    # B. Recuperação de ownership (best-effort, sem sudo)
    if [[ "$(stat -c '%u' "${dir}" 2>/dev/null)" != "${CURRENT_UID}" ]]; then
        warn "Audit: Ownership divergente detectado: ${dir}"
        chown "${CURRENT_USER}:${CURRENT_USER}" "${dir}" 2>/dev/null || true
    fi

    # C. Auditoria de escrita (Fail-Fast seletivo)
    if [[ ! -w "${dir}" ]]; then
        is_critical=false
        for crit in "${CRITICAL_VOLUMES[@]}"; do
            [[ "${dir}" == "${crit}" ]] && is_critical=true
        done

        if [[ "${is_critical}" == "true" ]]; then
            error "FALHA CRÍTICA: Volume essencial não gravável: ${dir}"
            error "O Agente Simbiótico não pode operar sem este volume."
            exit 1
        else
            warn "Volume não gravável (não-crítico): ${dir}. Funcionalidades limitadas."
        fi
    fi
done

# ---------------------------------------------------------------------------
# 3.1 SSH Agent — Diagnóstico explícito (não-operacional)
#
# Nota:
# • SSH_AUTH_SOCK deve ser injetado pelo devcontainer.json (remoteEnv)
# • A ausência NÃO é erro fatal (apenas desativa Git/SSH autenticado)
# • Este script NUNCA tenta iniciar ssh-agent
# ---------------------------------------------------------------------------
if [[ -z "${SSH_AUTH_SOCK:-}" ]]; then
    warn "SSH Agent: SSH_AUTH_SOCK não definido — agent forwarding INATIVO."
    warn "→ Git/SSH autenticado pode falhar (esperado se não configurado)."
elif [[ ! -S "${SSH_AUTH_SOCK}" ]]; then
    warn "SSH Agent: SSH_AUTH_SOCK definido, mas socket inválido: ${SSH_AUTH_SOCK}"
    warn "→ Verifique mount do socket e ssh-agent no host."
else
    log "SSH Agent: Forwarding ativo (${SSH_AUTH_SOCK})"
fi

# ---------------------------------------------------------------------------
# 4. SSH — Estrutura mínima e compatibilidade OpenSSH
#
# Garantias:
#   • ~/.ssh existe
#   • ~/.ssh/config existe (mesmo vazio)
#   • Permissões estritas (700 / 600)
#   • Nenhuma chave é criada ou tocada
# ---------------------------------------------------------------------------
if [[ -d "${HOME_DIR}/.ssh" ]]; then
    # Criação defensiva do config (necessário para alguns clientes)
    if [[ ! -f "${HOME_DIR}/.ssh/config" ]]; then
        log "Audit: Inicializando ~/.ssh/config (defensivo)"
        touch "${HOME_DIR}/.ssh/config" 2>/dev/null || true
    fi

    chmod 700 "${HOME_DIR}/.ssh" 2>/dev/null || true
    chmod 600 "${HOME_DIR}/.ssh/config" 2>/dev/null || true
fi

# ---------------------------------------------------------------------------
# 5. GPG — Endurecimento mínimo (estrutura apenas)
# ---------------------------------------------------------------------------
if [[ -d "${HOME_DIR}/.gnupg" ]]; then
    chmod 700 "${HOME_DIR}/.gnupg" 2>/dev/null || true
fi

log "Volumes, identidade SSH e segredos auditados com sucesso."

# =============================================================================
# SECTION 6 — A PONTE DO HISTÓRICO (O ELO PERDIDO)
#
# Responsabilidade:
#   • Vincular o histórico do shell a um volume persistente externo.
#   • Garantir que o histórico sobreviva a Rebuilds do container.
#   • Sincronia: "source=devcontainer-bash-history,target=/home/${CURRENT_USER}-history"
# =============================================================================
log "Soldando o 'Elo Perdido': Persistência de Histórico..."

# 1. Definição de Caminhos (Invariáveis)
readonly HISTORY_VOL="/home/${CURRENT_USER}-history"
readonly HISTORY_FILE="${HOME_DIR}/.bash_history"

# 2. Validação do Ponto de Montagem
if [[ -d "${HISTORY_VOL}" ]]; then

    # A. Garantia de Existência Física no Volume Externo
    # Se o arquivo não existir (primeiro boot), nós o inicializamos.
    if [[ ! -f "${HISTORY_VOL}/.bash_history" ]]; then
        log "Audit: Inicializando arquivo de histórico no volume persistente."
        touch "${HISTORY_VOL}/.bash_history" 2>/dev/null || warn "Falha ao criar arquivo no volume."
    fi

    # B. Soldagem Atômica do Link Simbólico
    # -s: simbólico | -f: força (sobrescreve se existir) | -n: no-dereference
    # Isso garante que ~/.bash_history aponte sempre para o volume.
    if ln -sfn "${HISTORY_VOL}/.bash_history" "${HISTORY_FILE}"; then
        log "Audit: Link estabelecido (${_blue}${HISTORY_FILE}${_reset} ➜ ${_blue}${HISTORY_VOL}/.bash_history${_reset})"
        log "Elo Perdido: Memória do terminal conectada com sucesso."
    else
        error "Falha ao criar link simbólico para o histórico."
    fi

else
    warn "Volume de histórico não detectado em ${HISTORY_VOL}."
    warn "Atenção: Os comandos desta sessão serão perdidos ao destruir o container."
fi

# =============================================================================
# SECTION 7 — GATEKEEPER NSS (RUNTIME IDENTITY v3.8.0-ELITE)
#
# Finalidade:
#   • Mapear identidade (Passwd/Group) em runtime via NSS Wrapper.
#   • Resiliência: Escrita Atômica (.tmp -> mv) para evitar arquivos corrompidos.
#   • Sincronia: Garante que o usuário 'node' tenha nome e grupos no shell.
# =============================================================================
log "Configurando Gatekeeper NSS (Identidade Dinâmica Atômica)..."

readonly NSS_BASE_DIR="/tmp/devcontainer-nss"
readonly NSS_PASSWD_FILE="${NSS_BASE_DIR}/passwd"
readonly NSS_GROUP_FILE="${NSS_BASE_DIR}/group"

# 1. Preparação do Namespace Isolado
mkdir -p "${NSS_BASE_DIR}" && chmod 700 "${NSS_BASE_DIR}"
if [[ ! -w "${NSS_BASE_DIR}" ]]; then
    error "Falha crítica: Diretório NSS em ${NSS_BASE_DIR} não é gravável."
    exit 1
fi

# 2. Diagnóstico Antecipado de Dependência
# Verifica se a biblioteca necessária para o spoofing de identidade está presente.
if ! ldconfig -p | grep -q "libnss_wrapper.so"; then
    warn "NSS: libnss_wrapper.so ausente. Identidade dinâmica pode falhar."
fi

# 3. passwd: Geração Atômica da Identidade Primária
# O swap atômico impede que o container fique sem usuário se o disco lotar.
cat > "${NSS_PASSWD_FILE}.tmp" <<EOF
# Generated by ${SCRIPT_NAME} v${SCRIPT_VERSION}
${CURRENT_USER}:x:${CURRENT_UID}:${CURRENT_GID}:${CURRENT_USER} user:${HOME_DIR}:/bin/bash
EOF
mv "${NSS_PASSWD_FILE}.tmp" "${NSS_PASSWD_FILE}"

# 4. group: Mapeamento Atômico de Grupos (Extended Profile)
{
    echo "# Primary & System Groups Mapping (Simbiose Identity)"
    # Resolve os grupos reais injetados pelo Docker (como o GID do Docker Host)
    id -G | xargs -n1 getent group | cut -d: -f1,2,3 | sed 's/$/:/' | grep -v "^::"

    # Fallback Docker: Garante permissão para usar o docker.sock montado
    if getent group docker >/dev/null 2>&1 && ! id -Gn | grep -qw docker; then
        readonly D_GID=$(getent group docker | cut -d: -f3)
        echo "docker:x:${D_GID}:"
        log "Audit: Grupo Docker (GID: ${D_GID}) injetado no perfil NSS."
    fi
} > "${NSS_GROUP_FILE}.tmp"
mv "${NSS_GROUP_FILE}.tmp" "${NSS_GROUP_FILE}"

# 5. Validação e Permissões
chmod 644 "${NSS_PASSWD_FILE}" "${NSS_GROUP_FILE}"

if [[ -s "${NSS_PASSWD_FILE}" && -s "${NSS_GROUP_FILE}" ]]; then
    log "Artefatos NSS gerados com sucesso (Identidade Atômica)."
else
    error "Erro crítico na geração dos artefatos NSS. Verifique o espaço em /tmp."
    exit 1
fi

# =============================================================================
# SECTION 8 — GIT BASE CONFIGURATION (OPCIONAL & DEFENSIVA)
#
# Finalidade:
#   • Sincronizar configurações e aliases do projeto sem sobrescrever o usuário.
#   • Fail-Safe: Não interrompe o boot se o Git estiver ausente.
# =============================================================================
log "Auditando configuração de identidade Git..."

if command -v git >/dev/null 2>&1; then
    # Caminho sincronizado com a estrutura do projeto
    readonly BASE_GITCONFIG="${DEVCONTAINER_DIR}/config/.gitconfig"
    readonly TARGET_GITCONFIG="${HOME_DIR}/.gitconfig"

    if [[ -f "${BASE_GITCONFIG}" ]]; then
        # Só aplica se o usuário ainda não tiver um .gitconfig (preserva o Host)
        if [[ ! -f "${TARGET_GITCONFIG}" ]]; then
            log "Aplicando template Git em ${TARGET_GITCONFIG}..."
            cp "${BASE_GITCONFIG}" "${TARGET_GITCONFIG}"
            chmod 644 "${TARGET_GITCONFIG}"
            log "Audit: Configuração Git do projeto instalada."
        else
            log "Audit: Configuração Git preexistente detectada. Preservando."
        fi
    fi
else
    warn "Binário 'git' não localizado. Ignorando configuração de identidade."
fi

# =============================================================================
# SECTION 9 — DIAGNÓSTICO EXAUSTIVO (INTERNAL DEEP AUDIT)
#
# Responsabilidade:
#   • Realizar dump forense completo no arquivo de log físico.
#   • Resiliência: Parsing de disco imune a quebras de linha (tail -1).
#   • Nota: Esta seção é estritamente informativa para o log.
# =============================================================================
log "Iniciando Diagnóstico Exaustivo (Simbiose Deep Audit)..."

# --- 1. Pré-cálculo de Variáveis (Compartilhadas) ---
NET_STATUS="SKIP"
if command -v curl >/dev/null 2>&1; then
    if curl -Is --connect-timeout 2 google.com > /dev/null 2>&1; then
        NET_STATUS="ONLINE"
    else
        NET_STATUS="OFFLINE"
    fi
fi
NET_STATUS_LOWER=$(echo "$NET_STATUS" | tr '[:upper:]' '[:lower:]')


{
    echo -e "\n=== [DEEP AUDIT REPORT - $(date -Is)] ==="

    echo -e "\n[1. Volume Metadata & Ownership Registry]"
    for dir in "${VOLUME_DIRS[@]}"; do
        if [[ -d "${dir}" ]]; then
            # stat GNU-style compatível com Debian/Node
            stat -c "PATH: %n | PERM: %a | OWNER: %U(%u) | GROUP: %G(%g)" "${dir}" 2>/dev/null \
            || echo "PATH: ${dir} | Metadata check failed."
        else
            echo "PATH: ${dir} | STATUS: NOT_FOUND"
        fi
    done

    echo -e "\n[2. Mount Analysis & Filesystem Type]"
    mount | grep -E "(/workspaces|/home/${CURRENT_USER})" | column -t 2>/dev/null \
    || mount | grep -E "(/workspaces|/home/${CURRENT_USER})" || echo "Mount info unavailable."

    echo -e "\n[3. System Resource Snapshot (Chrome/Puppeteer Health)]"
    df -h / | tail -1 | awk '{printf "Disk Usage: %s (%s available)\n", $5, $4}'
    df -i / | tail -1 | awk '{printf "Inode Usage: %s\n", $5}'

    if [[ -d "/dev/shm" ]]; then
        df -h /dev/shm | tail -1 | awk '{printf "Shared Memory (/dev/shm): %s free\n", $4}'
    else
        echo "Shared Memory: /dev/shm not detected as a dedicated mount."
    fi
    echo "Umask: $(umask)"

    echo -e "\n[4. Network Connectivity & Identity Check]"
    echo "Network Status: ${NET_STATUS}"
    echo "Whoami: $(whoami) (ID: $(id -u))"
    echo "NSS Groups: $(id -Gn | tr ' ' ',')"
    getent passwd "${CURRENT_USER}" >/dev/null 2>&1 || echo "Alerta: NSS não resolveu usuário no shell atual."

    echo -e "\n[5. Runtime & Execution Context]"
    echo "Node Path: $(which node || echo 'not found')"
    echo "Node Version: $(node -v 2>/dev/null || echo 'N/A')"
    echo "Total Setup Time: ${SECONDS}s"
    echo "=========================================="

} >> "${LOG_FILE}" 2>&1

log "Relatório forense anexado ao log físico."

# =============================================================================
# SECTION 10 — REGISTRO DE ESTADO (MANIFESTO ATÔMICO)
#
# Responsabilidade:
#   • Persistir a "Verdade Absoluta" para o Agente (KERNEL).
#   • Integridade Total: Escrita via swap-file (.tmp -> mv).
#   • Idempotência: Atua como a trava de segurança para o próximo boot.
# =============================================================================
log "Consolidando manifesto de estado atômico (Visão Geral)..."

# Preparação de Caminho Temporário (Evita corrupção se o container cair)
STATE_SWAP="${STATE_FILE}.tmp"
mkdir -p "$(dirname "${STATE_FILE}")"

# Geração do Manifesto (Machine-Readable para o KERNEL)
if [[ "${SKIP_STATE_FILE}" == "true" ]]; then
    log "Persistência de estado desativada por configuração (ENABLE_STATE_FILE != true). Pulando escrita de manifesto."
else
    cat > "${STATE_SWAP}" <<EOF
# Simbiose State Manifesto (v${SCRIPT_VERSION})
initialized_at=$(date -Is)
script_name=${SCRIPT_NAME}
script_version=${SCRIPT_VERSION}
script_hash=${SCRIPT_HASH:0:8}
total_setup_seconds=${SECONDS}

# Identity & Security Context
user=${CURRENT_USER}
uid=${CURRENT_UID}
gid=${CURRENT_GID}
nss_profile=EXTENDED
groups=$(id -Gn | tr ' ' ',')

# Infrastructure Mapping
home=${HOME_DIR}
project_root=${PROJECT_ROOT}
devcontainer_dir=${DEVCONTAINER_DIR}
log_path=${LOG_FILE}

# Runtime Specs
system_arch=$(uname -m)
node_version=$(node -v 2>/dev/null || echo "N/A")
network_status=${NET_STATUS_LOWER}

# Final Validation
status=ready
integrity=canonical
EOF

# Swap Atômico: O arquivo final só passa a existir quando a escrita termina.
    mv "${STATE_SWAP}" "${STATE_FILE}"
    chmod 444 "${STATE_FILE}" 2>/dev/null || true

    log "✅ Estado persistido com sucesso em ${STATE_FILE}"
fi

# =============================================================================
# SECTION 11 — ENCERRAMENTO CANÔNICO (HANDOFF)
# =============================================================================
echo -e "\n--- [SIMBIOSE COMPLETE] ---"
log "Inicialização estrutural concluída com sucesso."
log "Rastro físico (Log): ${_blue}${LOG_FILE}${_reset}"
log "🚀 Ambiente Simbiótico v${SCRIPT_VERSION} está ONLINE."
echo -e "---------------------------\n"
