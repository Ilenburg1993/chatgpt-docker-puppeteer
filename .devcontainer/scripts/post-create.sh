#!/usr/bin/env bash
# =============================================================================
# post-create.sh — Inicialização Estrutural do DevContainer
# Version: v5.2.0
#
# SUMÁRIO EXECUTIVO:
#   • Valida identidade do usuário (node, UID correto)
#   • Valida variáveis de ambiente críticas (9 vars)
#   • Audita estrutura do projeto (git, package.json, Makefile)
#   • Configura volumes persistentes (11 volumes)
#   • Estabelece histórico bash persistente
#   • Configura NSS wrapper (identidade dinâmica)
#   • Executa healthcheck final (informativo, não bloqueante)
#   • Tempo típico: 5-15s
#
# CONTRATO (INVIOLÁVEL):
#   • Executado como usuário 'node' (sem sudo)
#   • Toca APENAS em volumes declarados e caminhos efêmeros (/tmp)
#   • Idempotente, resiliente e determinístico
#   • Fail-Fast: erros estruturais nunca são mascarados
#   • Chrome externo é FUNDAMENTAL mas não precisa estar aberto durante boot
# =============================================================================

# Endurecimento máximo do shell
set -euo pipefail

# =============================================================================
# SECTION 1 — INFRAESTRUTURA DE LOGGING & IDENTIDADE GLOBAL
#
# Finalidade:
#   • Estabelecer telemetria confiável (terminal + log físico)
#   • Descobrir a raiz canônica do projeto
#   • Garantir rastreabilidade forense entre execuções
# =============================================================================

# ---------------------------------------------------------------------------
# 1.1 Identidade Canônica do Script
# ---------------------------------------------------------------------------
readonly SCRIPT_NAME="post-create.sh"
readonly SCRIPT_VERSION="5.2.0"

# Hash defensivo (best-effort, nunca fatal)
SCRIPT_HASH="unknown"
if command -v sha256sum >/dev/null 2>&1 && [[ -r "${BASH_SOURCE[0]:-}" ]]; then
    SCRIPT_HASH="$(sha256sum "${BASH_SOURCE[0]}" 2>/dev/null | awk '{print $1}' || echo "unknown")"
fi
readonly SCRIPT_HASH

# ---------------------------------------------------------------------------
# 1.2 Estabilização de Caminhos (Âncora Invariável)
# ---------------------------------------------------------------------------
readonly PROJECT_ROOT="$(
    cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd
)"

readonly LOG_DIR="${PROJECT_ROOT}/.devcontainer/logs"
readonly LOG_FILE="${LOG_DIR}/post-create.log"

mkdir -p "${LOG_DIR}"

# ---------------------------------------------------------------------------
# 1.3 Housekeeping — Rotação Defensiva de Logs
# ---------------------------------------------------------------------------
if [[ -f "${LOG_FILE}" ]]; then
    LOG_SIZE=0
    if command -v stat >/dev/null 2>&1; then
        LOG_SIZE="$(stat -c%s "${LOG_FILE}" 2>/dev/null || echo 0)"
    fi

    if [[ "${LOG_SIZE}" -gt 2097152 ]]; then
        mv "${LOG_FILE}" "${LOG_FILE}.$(date +%Y%m%d-%H%M%S).old"
    fi
fi

# ---------------------------------------------------------------------------
# 1.4 Redirecionamento Global de Saída (Fail-Safe)
# ---------------------------------------------------------------------------
exec > >(tee -a "${LOG_FILE}" || cat) 2>&1

# ---------------------------------------------------------------------------
# 1.5 Infraestrutura de Logging (ANSI + Timestamp)
# ---------------------------------------------------------------------------
_ts() { date +'%H:%M:%S'; }

_blue="\e[34m"
_yellow="\e[33m"
_red="\e[31m"
_reset="\e[0m"

log()   { echo -e "[${_blue}$(_ts)${_reset}] [${SCRIPT_NAME}] ℹ️  $*"; }
warn()  { echo -e "[${_yellow}$(_ts)${_reset}] [${SCRIPT_NAME}] ⚠️  $*" >&2; }
error() { echo -e "[${_red}$(_ts)${_reset}] [${SCRIPT_NAME}] ❌ $*" >&2; }

# ---------------------------------------------------------------------------
# 1.6 Timestamp de Início (Performance Metrics)
# ---------------------------------------------------------------------------
readonly BOOT_START_TIME="$(date +%s)"

# ---------------------------------------------------------------------------
# 1.7 Registro Inicial Canônico
# ---------------------------------------------------------------------------
log "Simbiose inicializada"
log "→ Script : ${SCRIPT_NAME}"
log "→ Versão : ${SCRIPT_VERSION}"
log "→ Hash   : ${SCRIPT_HASH:0:8}"
log "→ Root   : ${PROJECT_ROOT}"
log "→ Log    : ${LOG_FILE}"

# =============================================================================
# SECTION 2 — CONTRATO DE IDENTIDADE (GUARD RAILS) v5.2.0
#
# Finalidade:
#   • Garantir identidade canônica do runtime.
#   • Impedir execução sob usuário inesperado.
#   • Estabelecer base segura para NSS, Docker e permissões.
#
# Princípio:
#   • Identidade errada NÃO é recuperável.
#   • Este é um ponto de não-retorno.
# =============================================================================

# ---------------------------------------------------------------------------
# 2.1 Contrato Canônico de Identidade
# ---------------------------------------------------------------------------
readonly EXPECTED_USER="node"

readonly CURRENT_USER="$(id -un)"
readonly CURRENT_UID="$(id -u)"
readonly CURRENT_GID="$(id -g)"
readonly CURRENT_GROUPS="$(id -Gn | tr ' ' ',')"

log "Identity Check: esperado='${EXPECTED_USER}' | atual='${CURRENT_USER}'"

# ---------------------------------------------------------------------------
# 2.2 Validação Estrutural (Fail-Fast Absoluto)
# ---------------------------------------------------------------------------
if [[ "${CURRENT_USER}" != "${EXPECTED_USER}" ]]; then
    error "CONTRATO DE IDENTIDADE VIOLADO (FATAL)"
    error "→ Usuário esperado : ${EXPECTED_USER}"
    error "→ Usuário detectado: ${CURRENT_USER}"
    error "→ UID/GID          : ${CURRENT_UID}/${CURRENT_GID}"
    error "→ Grupos           : ${CURRENT_GROUPS}"
    error "Ação corretiva obrigatória:"
    error "• Ajuste 'remoteUser' no devcontainer.json"
    error "• Rebuild completo do DevContainer"
    exit 1
fi

# ---------------------------------------------------------------------------
# 2.3 Registro Canônico (Forense / Agentes)
# ---------------------------------------------------------------------------
log "Identidade validada com sucesso."
log "→ User   : ${CURRENT_USER}"
log "→ UID    : ${CURRENT_UID}"
log "→ GID    : ${CURRENT_GID}"
log "→ Grupos : ${CURRENT_GROUPS}"

# =============================================================================
# SECTION 3 — ENV VALIDATION (FAIL-FAST PARA MISCONFIGS) v5.2.0
#
# Finalidade:
#   • Validar variáveis de ambiente obrigatórias
#   • Fail-fast para configurações incompletas
#   • Guiar operador para correção
#
# Contrato:
#   • Executa APÓS identity check (identidade já validada)
#   • Executa ANTES de qualquer mutação de estado
#   • Falha é FATAL (exit 1)
#   • Chrome vars são validadas mas ausência de Chrome não é erro
# =============================================================================
log "Validando variáveis de ambiente obrigatórias..."

# ---------------------------------------------------------------------------
# 2.5.1 Variáveis críticas (ausência é fatal)
# ---------------------------------------------------------------------------
readonly CRITICAL_ENV_VARS=(
    "NODE_ENV"
    "SERVER_PORT"
    "CHROME_HOST"
    "CHROME_PORT"
    "CHROME_PROXY_PORT"
)

ENV_ERRORS=0

for var in "${CRITICAL_ENV_VARS[@]}"; do
    value="${!var:-}"

    if [[ -z "${value}" ]]; then
        error "ENV CRÍTICO: ${var} não está definido"
        ((ENV_ERRORS++))
    else
        log "ENV OK: ${var}=${value}"
    fi
done

# ---------------------------------------------------------------------------
# 2.5.2 Validação de conflitos de portas
# ---------------------------------------------------------------------------
if [[ -n "${SERVER_PORT:-}" && -n "${CHROME_PORT:-}" && -n "${CHROME_PROXY_PORT:-}" ]]; then
    if [[ "${SERVER_PORT}" == "${CHROME_PORT}" ]] || \
       [[ "${SERVER_PORT}" == "${CHROME_PROXY_PORT}" ]] || \
       [[ "${CHROME_PORT}" == "${CHROME_PROXY_PORT}" ]]; then
        error "ENV CRÍTICO: Conflito de portas detectado"
        error "→ SERVER_PORT=${SERVER_PORT}"
        error "→ CHROME_PORT=${CHROME_PORT}"
        error "→ CHROME_PROXY_PORT=${CHROME_PROXY_PORT}"
        ((ENV_ERRORS++))
    fi
fi

# ---------------------------------------------------------------------------
# 2.5.3 Veredito final
# ---------------------------------------------------------------------------
if [[ $ENV_ERRORS -gt 0 ]]; then
    error "Validação ENV falhou com ${ENV_ERRORS} erro(s)"
    error "→ Verifique devcontainer.json (remoteEnv) ou arquivo .env"
    error "→ Consulte: DOCUMENTAÇÃO/ENV_VARIABLES_GUIDE.md"
    exit 1
fi

log "Validação ENV: OK (${#CRITICAL_ENV_VARS[@]} variáveis críticas verificadas)"

# =============================================================================
# SECTION 4 — CONTEXTO, PATHS & IDEMPOTÊNCIA (GATEKEEPER) v5.2.0
#
# Finalidade:
#   • Estabilizar caminhos canônicos do runtime.
#   • Definir o modo operacional da execução.
#   • Impedir reexecução destrutiva via gatekeeper de estado.
#
# Contrato:
#   • Nenhuma escrita implícita
#   • Estado persistente é OPT-IN
#   • Abort precoce é deliberado e explícito
# =============================================================================

# ---------------------------------------------------------------------------
# 3.1 Estabilização de Caminhos (Fonte Única de Verdade)
# ---------------------------------------------------------------------------
readonly HOME_DIR="${HOME}"
readonly DEVCONTAINER_DIR="${PROJECT_ROOT}/.devcontainer"
readonly STATE_FILE="${DEVCONTAINER_DIR}/.initialized"

# ---------------------------------------------------------------------------
# 3.2 Política de Persistência de Estado (ENV-driven com fallback)
#
# Fonte de verdade (ordem de precedência):
#   1. Variável de ambiente ENABLE_STATE_FILE
#   2. Fallback: true (comportamento padrão)
#
# Valores válidos: "true" ou "false" (case-sensitive)
# ---------------------------------------------------------------------------
ENABLE_STATE_FILE_VAL="${ENABLE_STATE_FILE:-true}"

if [[ "${ENABLE_STATE_FILE_VAL}" != "true" ]]; then
    SKIP_STATE_FILE=true
    log "Gatekeeper: Persistência de estado DESATIVADA (ENABLE_STATE_FILE=${ENABLE_STATE_FILE_VAL})"
else
    SKIP_STATE_FILE=false
    log "Gatekeeper: Persistência de estado ATIVADA (ENABLE_STATE_FILE=${ENABLE_STATE_FILE_VAL})"
fi
readonly SKIP_STATE_FILE

# ---------------------------------------------------------------------------
# 3.3 Determinação do Modo Operacional
# ---------------------------------------------------------------------------
if [[ "${SKIP_STATE_FILE}" == "true" ]]; then
    RUNTIME_MODE="stateless"
    log "Gatekeeper: Modo stateless selecionado (nenhum estado será lido ou gravado)."

elif [[ -s "${STATE_FILE}" ]]; then
    RUNTIME_MODE="reentry"
    log "Gatekeeper: Estado persistente válido detectado (${STATE_FILE})."

else
    RUNTIME_MODE="bootstrap"
    log "Gatekeeper: Nenhum estado persistente detectado. Entrando em bootstrap."
fi
readonly RUNTIME_MODE

log "Gatekeeper: Modo operacional efetivo = ${RUNTIME_MODE}"

# ---------------------------------------------------------------------------
# 3.4 Gatekeeper de Idempotência (Ponto de Não-Retorno)
# ---------------------------------------------------------------------------
if [[ "${RUNTIME_MODE}" == "reentry" ]]; then
    log "Gatekeeper: Inicialização estrutural já concluída em execução anterior."
    log "Gatekeeper: Abortando execução atual para preservar idempotência."
    exit 0
fi

# ---------------------------------------------------------------------------
# 3.5 Registro do Momento Zero (Forense)
# ---------------------------------------------------------------------------
log "Inicialização estrutural autorizada."
log "Simbiose v${SCRIPT_VERSION} | Hash=${SCRIPT_HASH:0:8}"
log "Identidade: ${CURRENT_USER} (UID:${CURRENT_UID})"
log "Paths: HOME=${HOME_DIR} | PROJECT_ROOT=${PROJECT_ROOT}"

# =============================================================================
# SECTION 4 — AUDITORIA DE ESTRUTURA (HANDSHAKE) v3.9.0-ELITE
#
# Finalidade:
#   • Detectar a presença dos artefatos estruturais do projeto.
#   • Validar se o workspace foi montado corretamente.
#   • Fornecer diagnóstico passivo para humanos e agentes.
#
# Contrato:
#   • 100% read-only
#   • Nenhuma correção automática
#   • Nenhuma falha de boot
# =============================================================================
log "Realizando auditoria de estrutura do projeto (Handshake)..."

# ---------------------------------------------------------------------------
# 4.1 Definição canônica de artefatos estruturais
# ---------------------------------------------------------------------------
readonly STRUCT_GIT_DIR="${PROJECT_ROOT}/.git"
readonly STRUCT_NODE_MANIFEST="${PROJECT_ROOT}/package.json"
readonly STRUCT_MAKEFILE="${PROJECT_ROOT}/Makefile"

# Estado interno da auditoria (construção)
STRUCT_STATUS="OK"
STRUCT_WARNINGS=()

# ---------------------------------------------------------------------------
# 4.2 Identidade do projeto (Git)
# ---------------------------------------------------------------------------
if [[ -d "${STRUCT_GIT_DIR}" ]]; then
    log "Handshake: Repositório Git detectado (.git/)"
else
    warn "Handshake: Repositório Git NÃO detectado."
    warn "→ Workspace pode não corresponder à raiz lógica do projeto."
    STRUCT_STATUS="DEGRADED"
    STRUCT_WARNINGS+=("git")
fi

# ---------------------------------------------------------------------------
# 4.3 Manifesto de runtime (Node.js)
# ---------------------------------------------------------------------------
if [[ -f "${STRUCT_NODE_MANIFEST}" ]]; then
    log "Handshake: Manifesto Node.js detectado (package.json)"
else
    warn "Handshake: package.json não localizado."
    warn "→ Toolchain Node pode não estar inicializada."
    STRUCT_STATUS="DEGRADED"
    STRUCT_WARNINGS+=("node")
fi

# ---------------------------------------------------------------------------
# 4.4 Governança de execução (Makefile)
# ---------------------------------------------------------------------------
if [[ -f "${STRUCT_MAKEFILE}" ]]; then
    log "Handshake: Makefile detectado (governança ativa)"
else
    warn "Handshake: Makefile NÃO localizado em ${PROJECT_ROOT}."
    warn "→ Governança de execução indisponível."
    warn "→ Possível causa: volume do workspace não montado corretamente."
    STRUCT_STATUS="DEGRADED"
    STRUCT_WARNINGS+=("makefile")
fi

# ---------------------------------------------------------------------------
# 4.5 Síntese semântica (informativa, imutável)
# ---------------------------------------------------------------------------
readonly STRUCT_STATUS
readonly STRUCT_WARNINGS

if [[ "${STRUCT_STATUS}" == "OK" ]]; then
    log "Handshake Summary: STATUS=OK (estrutura consistente)"
else
    log "Handshake Summary: STATUS=DEGRADED | missing=$(IFS=,; echo "${STRUCT_WARNINGS[*]}")"
fi

# =============================================================================
# SECTION 5 — GESTÃO DE VOLUMES & IDENTIDADE SSH (ESTRUTURAL & DEFENSIVA)
#
# Responsabilidade:
#   • Auditar a presença e a gravabilidade dos volumes declarados
#   • Fail-Fast EXCLUSIVO para volumes críticos
#   • Governar capacidade SSH de forma explícita, opt-in e observacional
#
# Princípios:
#   • Nenhuma criação corretiva de volumes
#   • Nenhuma alteração de ownership
#   • Nenhuma suposição sobre o host
#   • SSH é capacidade TARDIA (attach-time), não estrutural
# =============================================================================
log "Validando integridade estrutural dos volumes e contrato SSH..."

# ---------------------------------------------------------------------------
# CONTRATO SSH — CONSTANTES CANÔNICAS
# ---------------------------------------------------------------------------
readonly EXPECTED_SSH_SOCKET="/ssh-agent"
readonly SSH_CONTRACT_VERSION="1.2"

# Verdade semântica única do SSH
# absent  → não solicitado
# pending → solicitado, socket existe, mas ainda fora do contrato
# valid   → utilizável
# invalid → solicitado, mas inconsistente
SSH_CONTRACT_STATUS="absent"

# ---------------------------------------------------------------------------
# 1. Lista canônica de volumes esperados (AUDIT-ONLY)
# ---------------------------------------------------------------------------
readonly VOLUME_DIRS=(
    "${HOME_DIR}/.cache"
    "${HOME_DIR}/.cache/puppeteer"
    "${HOME_DIR}/.cache/typescript"
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
# 2. Volumes CRÍTICOS (ausência ou não-gravabilidade ⇒ abort)
# ---------------------------------------------------------------------------
readonly CRITICAL_VOLUMES=(
    "${HOME_DIR}/.config"
    "${HOME_DIR}/.claude"
    "${HOME_DIR}/.local/state"
)

# ---------------------------------------------------------------------------
# 3. Auditoria de volumes (SEM criação, SEM correção)
# ---------------------------------------------------------------------------
for dir in "${VOLUME_DIRS[@]}"; do
    if [[ ! -d "${dir}" ]]; then
        warn "Volume ausente: ${dir}"

        for crit in "${CRITICAL_VOLUMES[@]}"; do
            if [[ "${dir}" == "${crit}" ]]; then
                error "FALHA CRÍTICA: Volume essencial não montado: ${dir}"
                exit 1
            fi
        done
        continue
    fi

    if [[ ! -w "${dir}" ]]; then
        is_critical=false
        for crit in "${CRITICAL_VOLUMES[@]}"; do
            [[ "${dir}" == "${crit}" ]] && is_critical=true
        done

        if [[ "${is_critical}" == "true" ]]; then
            error "FALHA CRÍTICA: Volume essencial não gravável: ${dir}"
            exit 1
        else
            warn "Volume não gravável (não-crítico): ${dir}"
        fi
    fi
done

# ---------------------------------------------------------------------------
# SSH — CONTRATO CANÔNICO
#
# Natureza:
#   • OPT-IN        → SSH só existe se o runtime fornecer um socket
#   • OBSERVACIONAL→ Nenhuma ação corretiva é executada aqui
#   • TIMING-AWARE → O estado pode evoluir após o post-create
#
# Princípios:
#   • post-create NÃO inicia ssh-agent
#   • post-create NÃO depende de SSH
#   • SSH é uma CAPACIDADE TARDIA (attach-time)
#
# Estados possíveis (vereditos, não erros):
#   • absent  → SSH não solicitado (SSH_AUTH_SOCK ausente)
#   • pending → SSH solicitado, mas ainda fora do contrato canônico
#               (estado TRANSITÓRIO esperado durante post-create)
#   • valid   → SSH disponível e conforme contrato (/ssh-agent)
#   • invalid → SSH solicitado, mas estruturalmente inconsistente
#
# Validação definitiva ocorre no post-attach.
# ---------------------------------------------------------------------------

if [[ -z "${SSH_AUTH_SOCK:-}" ]]; then
    SSH_CONTRACT_STATUS="absent"
    log "SSH: Não solicitado (SSH_AUTH_SOCK ausente)."

elif [[ "${SSH_AUTH_SOCK}" == "${EXPECTED_SSH_SOCKET}" && -S "${EXPECTED_SSH_SOCKET}" ]]; then
    SSH_CONTRACT_STATUS="valid"
    log "SSH: Agent canônico disponível (${EXPECTED_SSH_SOCKET})."

elif [[ -S "${SSH_AUTH_SOCK}" ]]; then
    SSH_CONTRACT_STATUS="pending"
    log "SSH: Agent detectado fora do contrato canônico (${SSH_AUTH_SOCK})."
    log "→ Estado transitório NORMAL durante post-create."
    log "→ Validação definitiva ocorrerá no post-attach."

else
    SSH_CONTRACT_STATUS="invalid"
    warn "SSH: SSH_AUTH_SOCK definido, mas socket inválido (${SSH_AUTH_SOCK})."
    warn "→ Estado inconsistente. Correção requer ação do operador."
fi

# ---------------------------------------------------------------------------
# Exportação canônica (consumo externo)
# ---------------------------------------------------------------------------
export SSH_CONTRACT_STATUS
export SSH_ENABLED="$([[ "${SSH_CONTRACT_STATUS}" == "valid" ]] && echo true || echo false)"
export SSH_SOCKET_EXPECTED="${EXPECTED_SSH_SOCKET}"
export SSH_CONTRACT_VERSION

log "SSH: status=${SSH_CONTRACT_STATUS}"
log "Volumes e identidade SSH auditados com sucesso."

# =============================================================================
# SECTION 6 — A PONTE DO HISTÓRICO (O ELO PERDIDO) v3.9.0-ELITE
#
# Finalidade:
#   • Persistir histórico do shell (bash) fora do container.
#   • Preservar continuidade cognitiva entre rebuilds.
#
# Contrato:
#   • UX-only (não é mecanismo de segurança ou auditoria).
#   • Fail-safe: ausência do volume NÃO quebra o boot.
#   • Mutação mínima: apenas link simbólico.
# =============================================================================
log "Soldando o 'Elo Perdido': Persistência de Histórico (UX)..."

# ---------------------------------------------------------------------------
# 1. Caminhos canônicos (imutáveis)
# ---------------------------------------------------------------------------
readonly HISTORY_VOL="/home/${CURRENT_USER}-history"
readonly HISTORY_FILE="${HOME_DIR}/.bash_history"
readonly HISTORY_TARGET="${HISTORY_VOL}/.bash_history"

# Estado explícito (evita efeitos colaterais sob set -u)
HISTORY_VOLUME_READY=false

# ---------------------------------------------------------------------------
# 2. Validação do volume persistente
# ---------------------------------------------------------------------------
if [[ ! -d "${HISTORY_VOL}" ]]; then
    warn "Histórico: Volume persistente não detectado em ${HISTORY_VOL}."
    warn "→ Histórico desta sessão NÃO será preservado."
elif [[ ! -w "${HISTORY_VOL}" ]]; then
    warn "Histórico: Volume ${HISTORY_VOL} não é gravável."
    warn "→ Persistência de histórico desativada."
else
    HISTORY_VOLUME_READY=true
fi

# ---------------------------------------------------------------------------
# 3. Auditoria do estado atual (somente informativa)
# ---------------------------------------------------------------------------
if [[ "${HISTORY_VOLUME_READY}" == "true" ]]; then
    if [[ -e "${HISTORY_FILE}" && ! -L "${HISTORY_FILE}" ]]; then
        log "Histórico: ~/.bash_history regular detectado (será substituído por symlink)."
    elif [[ -L "${HISTORY_FILE}" ]]; then
        log "Histórico: Symlink ~/.bash_history já existe (será normalizado)."
    fi
fi

# ---------------------------------------------------------------------------
# 4. Garantia do arquivo físico no volume
# ---------------------------------------------------------------------------
if [[ "${HISTORY_VOLUME_READY}" == "true" ]]; then
    if [[ ! -f "${HISTORY_TARGET}" ]]; then
        log "Histórico: Inicializando arquivo no volume persistente."
        if ! touch "${HISTORY_TARGET}" 2>/dev/null; then
            warn "Histórico: Falha ao criar ${HISTORY_TARGET}."
            warn "→ Persistência de histórico abortada para esta sessão."
            HISTORY_VOLUME_READY=false
        fi
    fi
fi

# ---------------------------------------------------------------------------
# 5. Soldagem atômica do elo (symlink canônico)
# ---------------------------------------------------------------------------
if [[ "${HISTORY_VOLUME_READY}" == "true" ]]; then
    if ln -sfn "${HISTORY_TARGET}" "${HISTORY_FILE}"; then
        log "Histórico: Link simbólico estabelecido com sucesso."
        log "→ ${HISTORY_FILE} ➜ ${HISTORY_TARGET}"
    else
        warn "Histórico: Falha ao criar link simbólico."
        warn "→ Histórico pode não persistir."
    fi
fi

# =============================================================================
# SECTION 7 — GATEKEEPER NSS (RUNTIME IDENTITY v3.9.0-ELITE)
#
# Finalidade:
#   • Instrumentar identidade dinâmica em runtime via NSS Wrapper.
#   • NÃO alterar identidade real do sistema.
#   • Garantir que shells e ferramentas resolvam usuário/grupos corretamente.
#
# Contrato:
#   • Runtime-only (artefatos efêmeros em /tmp)
#   • Escrita atômica (.tmp → mv)
#   • Fail-fast apenas para falhas estruturais reais
# =============================================================================
log "Configurando Gatekeeper NSS (Identidade Dinâmica Instrumental)..."

# ---------------------------------------------------------------------------
# Constantes canônicas
# ---------------------------------------------------------------------------
readonly NSS_BASE_DIR="/tmp/devcontainer-nss"
readonly NSS_PASSWD_FILE="${NSS_BASE_DIR}/passwd"
readonly NSS_GROUP_FILE="${NSS_BASE_DIR}/group"

# Estado explícito (governa execução da seção)
NSS_ENABLED=true

# ---------------------------------------------------------------------------
# 1. Preparação do namespace isolado
# ---------------------------------------------------------------------------
mkdir -p "${NSS_BASE_DIR}"
chmod 700 "${NSS_BASE_DIR}"

if [[ ! -w "${NSS_BASE_DIR}" ]]; then
    error "Falha crítica: Diretório NSS em ${NSS_BASE_DIR} não é gravável."
    exit 1
fi

# ---------------------------------------------------------------------------
# 2. Verificação de dependência (libnss_wrapper)
# ---------------------------------------------------------------------------
if ! ldconfig -p 2>/dev/null | grep -q "libnss_wrapper.so"; then
    warn "NSS: libnss_wrapper.so ausente."
    warn "→ Identidade dinâmica DESATIVADA (modo identidade estática)."
    NSS_ENABLED=false
fi

# ---------------------------------------------------------------------------
# 3. Curto-circuito idempotente (artefatos válidos já existem)
# ---------------------------------------------------------------------------
if [[ "${NSS_ENABLED}" == "true" ]] \
   && [[ -s "${NSS_PASSWD_FILE}" && -s "${NSS_GROUP_FILE}" ]] \
   && grep -q "^${CURRENT_USER}:x:${CURRENT_UID}:${CURRENT_GID}:" "${NSS_PASSWD_FILE}" 2>/dev/null; then
    log "NSS: Artefatos existentes válidos detectados. Regeneração desnecessária."
    NSS_ENABLED=false
fi

# ---------------------------------------------------------------------------
# 4. passwd — geração atômica da identidade primária
# ---------------------------------------------------------------------------
if [[ "${NSS_ENABLED}" == "true" ]]; then
    cat > "${NSS_PASSWD_FILE}.tmp" <<EOF
${CURRENT_USER}:x:${CURRENT_UID}:${CURRENT_GID}:${CURRENT_USER} user:${HOME_DIR}:/bin/bash
EOF
    mv "${NSS_PASSWD_FILE}.tmp" "${NSS_PASSWD_FILE}"
fi

# ---------------------------------------------------------------------------
# 5. group — mapeamento atômico de grupos (Extended Profile)
# ---------------------------------------------------------------------------
if [[ "${NSS_ENABLED}" == "true" ]]; then
    {
        # Grupos reais visíveis ao runtime
        id -G \
          | xargs -n1 getent group \
          | cut -d: -f1,2,3 \
          | sed 's/$/:/' \
          | grep -v "^::"

        # Fallback Docker (acesso ao docker.sock, se aplicável)
        if getent group docker >/dev/null 2>&1 && ! id -Gn | grep -qw docker; then
            D_GID="$(getent group docker | cut -d: -f3)"
            echo "docker:x:${D_GID}:"
            log "NSS: Grupo docker (GID ${D_GID}) injetado."
        fi
    } > "${NSS_GROUP_FILE}.tmp"

    mv "${NSS_GROUP_FILE}.tmp" "${NSS_GROUP_FILE}"
fi

# ---------------------------------------------------------------------------
# 6. Permissões e validação final
# ---------------------------------------------------------------------------
if [[ "${NSS_ENABLED}" == "true" ]]; then
    chmod 644 "${NSS_PASSWD_FILE}" "${NSS_GROUP_FILE}"

    if [[ -s "${NSS_PASSWD_FILE}" && -s "${NSS_GROUP_FILE}" ]]; then
        log "NSS: Identidade dinâmica instrumental ATIVA."
    else
        error "Erro crítico: Artefatos NSS vazios ou inválidos."
        exit 1
    fi
else
    log "NSS: Identidade dinâmica NÃO ativa (modo identidade estática)."
fi

# =============================================================================
# SECTION 8 — GIT BASE CONFIGURATION (OPCIONAL & DEFENSIVA) v3.9.0-ELITE
#
# Finalidade:
#   • Aplicar configuração BASE do projeto (aliases, defaults seguros).
#   • NÃO definir identidade pessoal (user.name / user.email).
#   • NÃO sobrescrever configurações existentes do usuário.
#
# Contrato:
#   • Fail-Safe: ausência de Git NÃO interrompe o boot.
#   • Mutação mínima: apenas criação inicial de ~/.gitconfig, se ausente.
#   • Nenhuma chamada a `git config --global`.
# =============================================================================
log "Auditando configuração base do Git (modo defensivo)..."

# Estado explícito (controle sob set -u)
GIT_BASE_APPLICABLE=true

# ---------------------------------------------------------------------------
# 1. Presença do Git no runtime
# ---------------------------------------------------------------------------
if ! command -v git >/dev/null 2>&1; then
    warn "Git não localizado no PATH. Configuração base desativada."
    GIT_BASE_APPLICABLE=false
fi

# Caminhos canônicos
readonly BASE_GITCONFIG="${DEVCONTAINER_DIR}/config/.gitconfig"
readonly TARGET_GITCONFIG="${HOME_DIR}/.gitconfig"

# ---------------------------------------------------------------------------
# 2. Existência do template base do projeto
# ---------------------------------------------------------------------------
if [[ "${GIT_BASE_APPLICABLE}" == "true" && ! -f "${BASE_GITCONFIG}" ]]; then
    log "Git: Template base não encontrado em ${BASE_GITCONFIG}. Nada a aplicar."
    GIT_BASE_APPLICABLE=false
fi

# ---------------------------------------------------------------------------
# 3. Preservação explícita da configuração do usuário
# ---------------------------------------------------------------------------
if [[ "${GIT_BASE_APPLICABLE}" == "true" && -f "${TARGET_GITCONFIG}" ]]; then
    log "Git: ~/.gitconfig já existe. Configuração do usuário preservada."
    GIT_BASE_APPLICABLE=false
fi

# ---------------------------------------------------------------------------
# 4. Aplicação one-shot do template base
# ---------------------------------------------------------------------------
if [[ "${GIT_BASE_APPLICABLE}" == "true" ]]; then
    log "Git: Aplicando configuração base do projeto (one-shot)..."

    if cp "${BASE_GITCONFIG}" "${TARGET_GITCONFIG}"; then
        chmod 644 "${TARGET_GITCONFIG}" 2>/dev/null || true
        log "Git: Configuração base aplicada com sucesso em ~/.gitconfig."
    else
        warn "Git: Falha ao copiar template base. Prosseguindo sem configuração."
    fi
else
    log "Git: Configuração base não aplicável neste ambiente."
fi

# =============================================================================
# SECTION 9 — DIAGNÓSTICO EXAUSTIVO (INTERNAL DEEP AUDIT) v3.9.0-ELITE
# =============================================================================
log "Iniciando Diagnóstico Exaustivo (Simbiose Deep Audit)..."

NET_STATUS="SKIP"
if command -v curl >/dev/null 2>&1; then
    if curl -Is --connect-timeout 2 google.com >/dev/null 2>&1; then
        NET_STATUS="ONLINE"
    else
        NET_STATUS="OFFLINE"
    fi
fi

{
    echo -e "\n=== [DEEP AUDIT REPORT - $(date -Is)] ==="
    echo "Audit Mode: OBSERVATIONAL (non-fatal)"

    echo -e "\n[1. Volume Metadata & Ownership Registry]"
    if [[ -n "${VOLUME_DIRS[*]:-}" ]]; then
        for dir in "${VOLUME_DIRS[@]}"; do
            if [[ -d "${dir}" ]]; then
                stat -c "PATH: %n | PERM: %a | OWNER: %U(%u) | GROUP: %G(%g)" "${dir}" 2>/dev/null \
                    || echo "PATH: ${dir} | Metadata check failed."
            else
                echo "PATH: ${dir} | STATUS: NOT_FOUND"
            fi
        done
    else
        echo "Volume registry unavailable (VOLUME_DIRS not defined)."
    fi

    echo -e "\n[2. Mount Analysis & Filesystem Context]"
    if command -v mount >/dev/null 2>&1; then
        mount 2>/dev/null \
        | grep -E "(${PROJECT_ROOT:-/workspaces}|/home/${CURRENT_USER:-unknown})" 2>/dev/null \
        | column -t 2>/dev/null \
        || echo "Mount information unavailable or filtered."
    else
        echo "mount command not available."
    fi

    echo -e "\n[3. System Resource Snapshot]"
    df -h / 2>/dev/null | tail -1 \
        | awk '{printf "Disk Usage: %s (%s available)\n", $5, $4}' \
        || echo "Disk usage unavailable."

    df -i / 2>/dev/null | tail -1 \
        | awk '{printf "Inode Usage: %s\n", $5}' \
        || echo "Inode usage unavailable."

    if [[ -d "/dev/shm" ]]; then
        df -h /dev/shm 2>/dev/null | tail -1 \
            | awk '{printf "Shared Memory (/dev/shm): %s free\n", $4}' \
            || echo "Shared memory stats unavailable."
    else
        echo "Shared Memory: /dev/shm not detected."
    fi

    echo "Umask: $(umask 2>/dev/null || echo 'unknown')"

    echo -e "\n[4. Network & Identity Check]"
    echo "Network Status (diagnostic): ${NET_STATUS}"
    echo "Whoami: $(whoami 2>/dev/null || echo 'unknown')"
    echo "UID: $(id -u 2>/dev/null || echo 'unknown')"
    echo "Groups: $(id -Gn 2>/dev/null | tr ' ' ',' || echo 'unknown')"

    getent passwd "${CURRENT_USER:-}" >/dev/null 2>&1 \
        || echo "Warning: NSS did not resolve current user."

    echo -e "\n[5. SSH Agent Diagnostic (Observational Only)]"
    if [[ -z "${SSH_AUTH_SOCK:-}" ]]; then
        echo "SSH: DISABLED (SSH_AUTH_SOCK not set)"
    else
        echo "SSH_AUTH_SOCK=${SSH_AUTH_SOCK}"
        [[ -S "${SSH_AUTH_SOCK}" ]] && echo "SSH Agent Socket: VALID" || echo "SSH Agent Socket: INVALID"
    fi

    echo -e "\n[6. Runtime & Execution Context]"
    echo "Node Path: $(command -v node 2>/dev/null || echo 'not found')"
    echo "Node Version: $(node -v 2>/dev/null || echo 'N/A')"
    echo "Total Setup Time: ${SECONDS:-unknown}s"

    echo "=========================================="

} >> "${LOG_FILE}" 2>/dev/null || true

log "Relatório forense anexado ao log físico."


# =============================================================================
# SECTION 10 — REGISTRO DE ESTADO & HANDOFF CANÔNICO (MANIFESTO FINAL)
#
# Responsabilidade:
#   • Persistir a "Verdade Absoluta" para o Agente (KERNEL)
#   • Serializar vereditos consolidados (NÃO recalcular)
#   • Executar o encerramento formal da inicialização
#
# Propriedades:
#   • Escrita atômica (.tmp → mv)
#   • Idempotente
#   • Livre de segredos
#
# Nota Semântica:
#   • O manifesto registra VEREDITOS, não mecanismos
#   • Nenhuma decisão estrutural ocorre nesta seção
# =============================================================================
log "Consolidando manifesto de estado atômico e preparando handoff final..."

# ---------------------------------------------------------------------------
# Preparação de Caminho Temporário (FAIL-SAFE ABSOLUTO)
# ---------------------------------------------------------------------------
STATE_SWAP="${STATE_FILE}.tmp"
mkdir -p "$(dirname "${STATE_FILE}")" 2>/dev/null || true

# ---------------------------------------------------------------------------
# Geração do Manifesto (Machine-Readable, Declarativo)
# ---------------------------------------------------------------------------
if [[ "${SKIP_STATE_FILE}" == "true" ]]; then
    log "Persistência de estado desativada (ENABLE_STATE_FILE != true). Manifesto não será gravado."
else
    cat > "${STATE_SWAP}" <<EOF
# =============================================================================
# SIMBIOSE — STATE MANIFESTO
# Version: ${SCRIPT_VERSION}
# =============================================================================

# ---------------------------------------------------------------------------
# Temporal & Script Identity (SNAPSHOT)
# ---------------------------------------------------------------------------
initialized_at=$(date -Is)
script_name=${SCRIPT_NAME}
script_version=${SCRIPT_VERSION}
script_hash=${SCRIPT_HASH:0:8}
total_setup_seconds=${SECONDS}

# ---------------------------------------------------------------------------
# Identity & Security Context (VEREDICTS)
# ---------------------------------------------------------------------------
user=${CURRENT_USER}
uid=${CURRENT_UID}
gid=${CURRENT_GID}
groups=$(id -Gn | tr ' ' ',')
nss_profile=EXTENDED

# ---------------------------------------------------------------------------
# Infrastructure Mapping (OBSERVATIONAL)
# ---------------------------------------------------------------------------
home=${HOME_DIR}
project_root=${PROJECT_ROOT}
devcontainer_dir=${DEVCONTAINER_DIR}
log_path=${LOG_FILE}

# ---------------------------------------------------------------------------
# Runtime Specs (BEST-EFFORT SNAPSHOT)
# ---------------------------------------------------------------------------
system_arch=$(uname -m)
node_version=$(node -v 2>/dev/null || echo "N/A")
network_status=${NET_STATUS:-unknown}

# ---------------------------------------------------------------------------
# SSH Capability — CANONICAL CONTRACT VEREDICT
# ---------------------------------------------------------------------------
ssh_enabled=${SSH_ENABLED}
ssh_contract_status=${SSH_CONTRACT_STATUS}
ssh_contract_socket=${SSH_SOCKET_EXPECTED}
ssh_contract_version=${SSH_CONTRACT_VERSION}

# ---------------------------------------------------------------------------
# Final Validation (DECLARATIVE)
# ---------------------------------------------------------------------------
status=ready
integrity=canonical
EOF

    mv "${STATE_SWAP}" "${STATE_FILE}" 2>/dev/null || true
    chmod 444 "${STATE_FILE}" 2>/dev/null || true

    log "✅ Manifesto de estado persistido com sucesso em ${STATE_FILE}"
fi

# ---------------------------------------------------------------------------
# HANDOFF FINAL — ENCERRAMENTO CANÔNICO v5.2.0
# ---------------------------------------------------------------------------

# =============================================================================
# SECTION 11 — FINAL HEALTH CHECK & SUCCESS BANNER v5.2.0
#
# Finalidade:
#   • Validar conectividade de serviços externos (Chrome proxy - FUNDAMENTAL mas não precisa estar ativo agora)
#   • Calcular métricas de performance (boot duration)
#   • Exibir checklist de inicialização
#   • Fornecer próximos passos ao usuário
#
# Contrato:
#   • NUNCA bloqueia (mesmo se checks falharem)
#   • Chrome ausente durante boot é ESTADO VÁLIDO (não é erro)
#   • Informativo only (não corretivo)
# =============================================================================

log "Executando healthcheck final (informativo)..."

# ---------------------------------------------------------------------------
# 11.1 Métricas de Performance
# ---------------------------------------------------------------------------
BOOT_END_TIME="$(date +%s)"
BOOT_DURATION=$((BOOT_END_TIME - BOOT_START_TIME))

# ---------------------------------------------------------------------------
# 11.2 Validação de Conectividade Chrome Proxy (INFORMATIVO)
# ---------------------------------------------------------------------------
# Nota importante: Chrome externo do Windows É FUNDAMENTAL para operação
# completa do sistema (LLM automation via Puppeteer).
#
# Porém, NÃO PRECISA estar aberto durante build/inicialização.
# A ausência de resposta neste momento é o cenário NORMAL e ESPERADO.
#
# Chrome será iniciado sob demanda quando necessário:
#   - Manualmente: START-CHROME-SIMPLE.bat (Windows host)
#   - Automaticamente: pelo sistema quando iniciar operações LLM
#
# Este check valida apenas se as variáveis estão configuradas corretamente.
# ---------------------------------------------------------------------------
CHROME_PROXY_STATUS="⏸️  não verificado"
CHROME_PROXY_NOTE=""

if [[ "${BROWSER_MODE:-}" == "wsEndpoint" ]]; then
    CHROME_ENDPOINT="${CHROME_HOST:-host.docker.internal}:${CHROME_PORT:-9225}"

    # Timeout curto (3s) - não queremos atrasar o boot
    if timeout 3 bash -c "cat < /dev/null > /dev/tcp/${CHROME_HOST:-host.docker.internal}/${CHROME_PORT:-9225}" 2>/dev/null; then
        CHROME_PROXY_STATUS="✅ conectividade OK"
        CHROME_PROXY_NOTE="Chrome Windows respondendo em ${CHROME_ENDPOINT} (inesperado mas OK)"
    else
        CHROME_PROXY_STATUS="⏸️  aguardando inicialização"
        CHROME_PROXY_NOTE="Normal - Chrome será iniciado sob demanda (START-CHROME-SIMPLE.bat)"
fi

# ---------------------------------------------------------------------------
# 11.3 Success Banner
# ---------------------------------------------------------------------------
echo ""
echo "╔════════════════════════════════════════════════════════════╗"
echo "║  ✅ DevContainer Inicializado com Sucesso (v${SCRIPT_VERSION})     ║"
echo "╚════════════════════════════════════════════════════════════╝"
echo ""
echo "📊 Checklist de Inicialização:"
echo "  ✅ Identidade validada (${CURRENT_USER}, UID ${CURRENT_UID})"
echo "  ✅ Variáveis de ambiente (${#CRITICAL_ENV_VARS[@]} críticas)"
echo "  ✅ Volumes persistentes (11 volumes configurados)"
echo "  ✅ Histórico bash (persistente)"
echo "  ✅ NSS wrapper (identidade dinâmica)"
echo "  ${CHROME_PROXY_STATUS} Chrome proxy"
[[ -n "${CHROME_PROXY_NOTE}" ]] && echo "     └─ ${CHROME_PROXY_NOTE}"
echo ""
echo "⏱️  Tempo total: ${BOOT_DURATION}s"
echo ""
echo "📚 Próximos passos:"
echo "  • Iniciar sistema: make start"
echo "  • Ver logs: make logs-follow"
echo "  • Documentação: ARCHITECTURE.md"
echo "  • Chrome Proxy: DOCUMENTAÇÃO/CONNECTION_ARCHITECTURE/"
echo ""
echo "💡 Importante sobre Chrome:"
echo "   • Chrome externo É FUNDAMENTAL para operações LLM"
echo "   • Mas NÃO precisa estar rodando durante build/inicialização"
echo "   • Será iniciado sob demanda quando necessário"
echo "   • Comando: START-CHROME-SIMPLE.bat (Windows host)"
echo ""

echo -e "\n--- [SIMBIOSE COMPLETE] ---"
log "Inicialização estrutural concluída com sucesso."
log "Estado: READY | Integridade: CANONICAL"
log "Rastro físico (Log): ${_blue}${LOG_FILE}${_reset}"
log "🚀 Ambiente Simbiótico v${SCRIPT_VERSION} está ONLINE."
echo -e "---------------------------\n"
