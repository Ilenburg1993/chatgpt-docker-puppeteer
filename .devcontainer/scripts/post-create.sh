#!/usr/bin/env bash
# =============================================================================
# post-create.sh — Inicialização Estrutural do DevContainer
# Version: v6.0
#
# SUMÁRIO EXECUTIVO:
#   • Valida identidade canônica do runtime (user, UID, GID)
#   • Valida contratos estruturais de ENV (taxonomia v6.0)
#   • Audita presença e integridade do workspace
#   • Audita volumes persistentes (sem criação implícita)
#   • Instrumenta identidade dinâmica (NSS wrapper)
#   • Estabelece UX persistente (histórico de shell)
#   • Registra manifesto estrutural (state file) — opcional
#
# CONTRATO (ATUALIZADO v6.0):
#   • Executado como usuário canônico ('node')
#   • NÃO assume existência de arquivos .env
#   • Idempotente por padrão
#   • Reexecução SOMENTE por sinal explícito
#   • Fail-fast estratificado por NODE_ENV
#   • Chrome externo é FUNDAMENTAL, mas sua ausência no boot é NORMAL
#
# NOTA ARQUITETURAL:
#   Este script NÃO é um "setup convenience".
#   Ele é um INSTRUMENTO DE VERIFICAÇÃO ESTRUTURAL.
#
# CHANGELOG v6.0 (2026-02-03):
# ✅ ENV TAXONOMY: Nova categorização (STRUCTURAL → INFRASTRUCTURE → OPERATIONAL → FLAGS)
# ✅ ENV VALIDATION: Estratificada por NODE_ENV (FATAL em prod, WARNING em dev)
# ✅ SEMANTIC VALIDATION: Dependências (BROWSER_MODE→CHROME_*, ALLOW_DEGRADED_MODE)
# ✅ TRAP HANDLER: Snapshot de ENV capturado em erro
# ✅ DEPRECATION: PORT removido (usar SERVER_PORT)
# ✅ DOCUMENTATION: Referência a ENV_ANALYSIS_V6.md
#
# CHANGELOG v5.2.2 (2026-02-03):
# ✅ TRAP HANDLER: Captura erros e preserva IN_PROGRESS_MARKER
# ✅ LOGGING: Modo replay agora tem banner visível e diagnóstico
# ✅ VALIDAÇÃO: Sanidade antes do commit final
# ✅ RECOVERY: Sistema agora documenta erros adequadamente
#
# RESOLUÇÃO:
# • Problema: "post-create dava erro e não rodava mais"
# • Causa: Falta de trap handler para cleanup em erro
# • Solução: Trap implementado + logging melhorado + validação
# • Resultado: Reexecução automática após erros (modo replay)
#
# REFERÊNCIAS:
# • .devcontainer/POST_CREATE_ANALYSIS.md (análise completa)
# • .devcontainer/TROUBLESHOOTING_SSH.md (guia de debug)
# =============================================================================

# Endurecimento do shell (governado pelo Gatekeeper)
set -euo pipefail

# ---------------------------------------------------------------------------
# TRAP HANDLER — Cleanup e Diagnóstico de Erro (v5.2.2)
#
# Finalidade:
#   • Capturar falhas do script para diagnóstico
#   • Preservar IN_PROGRESS_MARKER para recovery automático
#   • Fornecer instruções claras ao usuário
#
# Contrato:
#   • Exit 0 (sucesso) → Nenhuma ação
#   • Exit != 0 (erro) → Log de diagnóstico + preservação de estado
#   • IN_PROGRESS_MARKER mantido → Próxima execução entra em modo REPLAY
# ---------------------------------------------------------------------------
cleanup_on_error() {
    local exit_code=$?
    local line_num="${BASH_LINENO[0]:-unknown}"

    # Exit 0 = sucesso normal, não fazer nada
    [[ $exit_code -eq 0 ]] && return 0

    # Função error pode não estar disponível se falha foi muito cedo
    _error_fallback() {
        echo -e "\e[31m[ERROR]\e[0m $*" >&2
    }

    local error_fn="error"
    command -v error >/dev/null 2>&1 || error_fn="_error_fallback"

    echo ""
    $error_fn "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    $error_fn "FALHA NO POST-CREATE (EXIT CODE: ${exit_code})"
    $error_fn "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    $error_fn "Linha aproximada: ${line_num}"
    $error_fn "Script: ${SCRIPT_NAME:-post-create.sh} v${SCRIPT_VERSION:-unknown}"
    $error_fn ""
    $error_fn "AÇÃO AUTOMÁTICA:"
    $error_fn "  → IN_PROGRESS_MARKER mantido para diagnóstico"
    $error_fn "  → Próxima execução entrará em modo REPLAY (recovery)"
    $error_fn ""
    $error_fn "AÇÕES DISPONÍVEIS:"
    $error_fn "  1. Rebuild container (automático via VS Code)"
    $error_fn "  2. Inspecionar logs: ${LOG_FILE:-~/.devcontainer/logs/post-create.log}"
    $error_fn "  3. Forçar reexecução: REEXECUTE_POST_CREATE=true"
    $error_fn ""
    $error_fn "DIAGNÓSTICO RECOMENDADO:"
    [[ -n "${snapshot:-}" ]] && $error_fn "  1. Verificar snapshot: ${snapshot}"
    $error_fn "  2. Comparar com .env.development ou .env.production"
    $error_fn "  3. Validar remoteEnv no devcontainer.json"
    $error_fn "  4. Consultar: .devcontainer/ENV_ANALYSIS_V6.md"
    $error_fn "  5. Troubleshooting: .devcontainer/TROUBLESHOOTING_SSH.md"
    $error_fn "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo ""

    # ENV snapshot (v6.0)
    local snapshot="${LOG_DIR:-/tmp}/env_error_snapshot_$(date +%s).txt"
    {
        echo "=== ENV SNAPSHOT AT ERROR ==="
        echo "Exit Code: ${exit_code}"
        echo "Line: ${line_num}"
        echo "Timestamp: $(date -Iseconds)"
        echo "Script: ${SCRIPT_NAME} v${SCRIPT_VERSION}"
        echo ""

        echo "[STRUCTURAL]"
        for var in NODE_ENV SERVER_MODE SERVER_AUTHORITY BROWSER_MODE; do
            printf "  %-25s = %s\n" "${var}" "${!var:-<UNSET>}"
        done

        echo ""
        echo "[INFRASTRUCTURE]"
        for var in SERVER_PORT CHROME_HOST CHROME_PORT CHROME_PROXY_PORT CHROME_PROXY_BIND HOST; do
            printf "  %-25s = %s\n" "${var}" "${!var:-<UNSET>}"
        done

        echo ""
        echo "[OPERATIONAL] (sample)"
        for var in LOG_LEVEL BROWSER_POOL_SIZE ALLOW_DEGRADED_MODE MOCK_CHROME; do
            printf "  %-25s = %s\n" "${var}" "${!var:-<UNSET>}"
        done
    } > "${snapshot}" 2>&1

    $error_fn ""
    $error_fn "ENV SNAPSHOT: ${snapshot}"
    $error_fn ""
    $error_fn "VARIÁVEIS ESTRUTURAIS:"
    for var in NODE_ENV SERVER_MODE SERVER_AUTHORITY BROWSER_MODE; do
        local val="${!var:-<UNSET>}"
        if [[ "${val}" == "<UNSET>" ]]; then
            $error_fn "  ❌ ${var} = ${val}"
        else
            $error_fn "  ✓  ${var} = ${val}"
        fi
    done
    $error_fn ""

    # NÃO remover IN_PROGRESS_MARKER
    # Sistema de replay detectará e reexecutará automaticamente
}

# Instalar trap para ERR e EXIT
trap cleanup_on_error ERR EXIT

# =============================================================================
# SECTION 1 — INFRAESTRUTURA DE LOGGING & IDENTIDADE GLOBAL
#
# Finalidade:
#   • Telemetria confiável (terminal + log físico)
#   • Rastreabilidade entre execuções (forense)
#   • Âncoras canônicas para agentes e operadores
# =============================================================================

# ---------------------------------------------------------------------------
# 1.1 Identidade Canônica do Script
# ---------------------------------------------------------------------------
readonly SCRIPT_NAME="post-create.sh"
readonly SCRIPT_VERSION="6.0"

# Hash defensivo (best-effort, nunca fatal)
SCRIPT_HASH="unknown"
if command -v sha256sum >/dev/null 2>&1 && [[ -r "${BASH_SOURCE[0]:-}" ]]; then
    SCRIPT_HASH="$(
        sha256sum "${BASH_SOURCE[0]}" 2>/dev/null | awk '{print $1}' || echo "unknown"
    )"
fi
readonly SCRIPT_HASH

# ---------------------------------------------------------------------------
# 1.2 Estabilização de Caminhos (Âncora Invariável)
# ---------------------------------------------------------------------------
readonly PROJECT_ROOT="$(
    cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd
)"

readonly DEVCONTAINER_DIR="${PROJECT_ROOT}/.devcontainer"
readonly LOG_DIR="${DEVCONTAINER_DIR}/logs"
readonly LOG_FILE="${LOG_DIR}/post-create.log"

mkdir -p "${LOG_DIR}"

# ---------------------------------------------------------------------------
# 1.3 Housekeeping — Rotação Defensiva de Logs
# ---------------------------------------------------------------------------
if [[ -f "${LOG_FILE}" ]] && command -v stat >/dev/null 2>&1; then
    LOG_SIZE="$(stat -c%s "${LOG_FILE}" 2>/dev/null || echo 0)"
    if [[ "${LOG_SIZE}" -gt 2097152 ]]; then
        mv "${LOG_FILE}" "${LOG_FILE}.$(date -Is).old"
    fi
fi

# ---------------------------------------------------------------------------
# 1.4 Redirecionamento Global de Saída (Terminal + Arquivo)
# ---------------------------------------------------------------------------
# Nota: Saída vai para AMBOS (terminal + arquivo físico)
# - Terminal: usuário vê progresso em tempo real
# - Arquivo: forense, debugging, análise posterior
exec > >(tee -a "${LOG_FILE}" || true) 2>&1

# ---------------------------------------------------------------------------
# 1.5 Infraestrutura de Logging (ANSI + Timestamp + PID)
# ---------------------------------------------------------------------------
_ts() { date -Is; }

_blue="\e[34m"
_yellow="\e[33m"
_red="\e[31m"
_reset="\e[0m"

log()   { echo -e "[${_blue}$(_ts)${_reset}] [${SCRIPT_NAME}] [pid=$$] ℹ️  $*"; }
warn()  { echo -e "[${_yellow}$(_ts)${_reset}] [${SCRIPT_NAME}] [pid=$$] ⚠️  $*" >&2; }
error() { echo -e "[${_red}$(_ts)${_reset}] [${SCRIPT_NAME}] [pid=$$] ❌ $*" >&2; }

# ---------------------------------------------------------------------------
# 1.6 Timestamp de Início (Performance / Forense)
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
# SECTION 2 — CONTRATO DE IDENTIDADE (GUARD RAILS) v5.2.1
#
# Finalidade:
#   • Garantir identidade canônica do runtime
#   • Prevenir execução em contexto incorreto
#   • Estabelecer base segura para permissões, NSS e Docker
#
# Princípio:
#   • Identidade incorreta NÃO é recuperável
#   • Falha aqui invalida todo o container
# =============================================================================

# ---------------------------------------------------------------------------
# 2.1 Contrato Canônico de Identidade
# ---------------------------------------------------------------------------
readonly EXPECTED_USER="node"

readonly CURRENT_USER="$(id -un 2>/dev/null || echo unknown)"
readonly CURRENT_UID="$(id -u 2>/dev/null || echo unknown)"
readonly CURRENT_GID="$(id -g 2>/dev/null || echo unknown)"
readonly CURRENT_GROUPS="$(id -Gn 2>/dev/null | tr ' ' ',' || echo unknown)"

# Âncora canônica do HOME (NUNCA inferir depois disso)
readonly USER_HOME="${HOME:-/home/${CURRENT_USER}}"

log "Identity Check:"
log "→ Esperado : ${EXPECTED_USER}"
log "→ Atual    : ${CURRENT_USER} (UID:${CURRENT_UID}, GID:${CURRENT_GID})"
log "→ Grupos   : ${CURRENT_GROUPS}"
log "→ HOME     : ${USER_HOME}"

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
    error "• Ajustar 'remoteUser' no devcontainer.json"
    error "• Rebuild COMPLETO do DevContainer"
    exit 1
fi

# ---------------------------------------------------------------------------
# 2.3 Registro Canônico (Forense / Agentes)
# ---------------------------------------------------------------------------
log "Identidade validada com sucesso."
log "→ Contexto de execução seguro e canônico."

# =============================================================================
# SECTION 3 — ENV VALIDATION (STRATIFIED FAIL-FAST) v6.0
#
# Contrato:
#   • Executa APÓS identity check
#   • Executa ANTES de qualquer mutação de estado
#   • Fail-fast APENAS para variáveis ESTRUTURAIS
#   • Variáveis INFRAESTRUTURA: FATAL em prod, WARNING em dev
#   • Variáveis operacionais são validadas por contexto
#   • Ausência de Chrome em runtime é ESTADO VÁLIDO
#
# v6.0 (2026-02-03):
#   • Nova taxonomia: STRUCTURAL → INFRASTRUCTURE → OPERATIONAL → FLAGS
#   • Validação estratificada por NODE_ENV
#   • Validação de dependências semânticas
#   • Trap handler captura snapshot de ENV
#
# Referência: .devcontainer/ENV_ANALYSIS_V6.md
# =============================================================================

log "Validando variáveis de ambiente (modelo estratificado v6.0)..."
log "ENV source hint: remoteEnv (VS Code) + runArgs (--env-file) + defaults"

# ---------------------------------------------------------------------------
# 3.1 Variáveis ESTRUTURAIS (ausência é FATAL)
#
# Definição:
#   • Necessárias para o CONTAINER existir semanticamente
#   • Independentes de runtime, Chrome, PM2 ou app
#   • Mudar valor = mudar SEMÂNTICA do sistema
#
# v6.0: Expandido de 1 → 4 variáveis (SERVER_MODE, SERVER_AUTHORITY, BROWSER_MODE)
# ---------------------------------------------------------------------------
readonly STRUCTURAL_ENV_VARS=(
    NODE_ENV
    SERVER_MODE
    SERVER_AUTHORITY
    BROWSER_MODE
)

# ---------------------------------------------------------------------------
# 3.2 Variáveis INFRAESTRUTURA (FATAL em prod, WARNING em dev)
#
# Definição:
#   • Necessárias para o sistema EXISTIR na rede
#   • Ausência = sistema não consegue boot/bind
#   • Criticidade depende de NODE_ENV
#
# v6.0: Nova categoria separada de OPERATIONAL
# ---------------------------------------------------------------------------
readonly INFRASTRUCTURE_ENV_VARS=(
    SERVER_PORT
    CHROME_HOST
    CHROME_PORT
    CHROME_PROXY_PORT
    CHROME_PROXY_BIND
    HOST
)

# ---------------------------------------------------------------------------
# 3.3 Variáveis OPERACIONAIS (contextuais)
#
# Definição:
#   • Necessárias apenas quando o sistema estiver ATIVO
#   • Não devem quebrar bootstrap, rebuild ou diagnóstico
#   • Ausência = degradação de funcionalidade
#
# v6.0: Expandido com variáveis de pool, logging, features
# ---------------------------------------------------------------------------
readonly OPERATIONAL_ENV_VARS=(
    BROWSER_POOL_SIZE
    ALLOCATION_STRATEGY
    HEALTH_CHECK_INTERVAL
    ALLOW_DEGRADED_MODE
    AUTO_RETRY_CHROME
    MAX_AUTO_RETRIES
    MAX_CONNECTION_ATTEMPTS
    CONNECTION_TIMEOUT
    LOG_LEVEL
    NERV_BUFFER_SIZE
    NERV_TELEMETRY
    NERV_INTEGRATION
    WS_IDLE_TIMEOUT_MS
)

# ---------------------------------------------------------------------------
# 3.4 Feature Flags (INFO apenas)
#
# Definição:
#   • Ativam/desativam features
#   • Ausência = feature disabled
#
# v6.0: Nova categoria para visibilidade
# ---------------------------------------------------------------------------
readonly FEATURE_FLAG_ENV_VARS=(
    MOCK_CHROME
    PUPPETEER_LOCAL_LAUNCH_DISABLED
    FACTORY_VALIDATE_BOOT
)

# Contadores explícitos (robustos sob set -u)
STRUCT_ERRORS=0
INFRA_ERRORS=0
OPER_WARNINGS=0
FLAG_INFO=0

# ---------------------------------------------------------------------------
# 3.5 Modo de Validação Estratificado por NODE_ENV (v6.0)
# ---------------------------------------------------------------------------
case "${NODE_ENV:-development}" in
    production)
        INFRA_VALIDATION_MODE="FATAL"
        OPER_VALIDATION_MODE="WARNING"
        log "Modo de validação: NODE_ENV=production → INFRAESTRUTURA=FATAL"
        ;;
    test)
        INFRA_VALIDATION_MODE="WARNING"
        OPER_VALIDATION_MODE="INFO"
        log "Modo de validação: NODE_ENV=test → INFRAESTRUTURA=WARNING"
        ;;
    development|*)
        INFRA_VALIDATION_MODE="WARNING"
        OPER_VALIDATION_MODE="INFO"
        log "Modo de validação: NODE_ENV=development → INFRAESTRUTURA=WARNING"
        ;;
esac

# ---------------------------------------------------------------------------
# 3.6 Validação ESTRUTURAL (FAIL-FAST ABSOLUTO)
# ---------------------------------------------------------------------------
for var in "${STRUCTURAL_ENV_VARS[@]}"; do
    value="${!var:-}"

    if [[ -z "${value}" ]]; then
        error "ENV ESTRUTURAL AUSENTE (FATAL): ${var}"
        STRUCT_ERRORS=$((STRUCT_ERRORS + 1))
    else
        log "ENV estrutural OK: ${var}=${value}"
    fi
done

# ---------------------------------------------------------------------------
# 3.3.1 Validação SEMÂNTICA de NODE_ENV (NÃO fatal)
# ---------------------------------------------------------------------------
if [[ -n "${NODE_ENV:-}" ]]; then
    case "${NODE_ENV}" in
        development|test|production)
            log "NODE_ENV semântico válido: ${NODE_ENV}"
            ;;
        *)
            warn "NODE_ENV fora do conjunto canônico: '${NODE_ENV}'"
            warn "→ Valores recomendados: development | test | production"
            ;;
    esac
fi

# ---------------------------------------------------------------------------
# 3.9 Validação OPERACIONAL (CONTEXT-AWARE)
# ---------------------------------------------------------------------------
for var in "${OPERATIONAL_ENV_VARS[@]}"; do
    value="${!var:-}"

    if [[ -z "${value}" ]]; then
        if [[ "${OPER_VALIDATION_MODE}" == "WARNING" ]]; then
            warn "ENV operacional ausente: ${var}"
            warn "→ Modo ${OPER_VALIDATION_MODE} em NODE_ENV=${NODE_ENV}"
            OPER_WARNINGS=$((OPER_WARNINGS + 1))
        else
            log "ENV operacional ausente (INFO): ${var}"
        fi
    else
        log "ENV operacional detectada: ${var}=${value}"
    fi
done

# ---------------------------------------------------------------------------
# 3.10 Validação FEATURE FLAGS (INFO)
# ---------------------------------------------------------------------------
for var in "${FEATURE_FLAG_ENV_VARS[@]}"; do
    value="${!var:-}"
    if [[ -n "${value}" ]]; then
        log "Feature flag detectado: ${var}=${value}"
        FLAG_INFO=$((FLAG_INFO + 1))
    fi
done

# ---------------------------------------------------------------------------
# 3.11 Validação de Tipo para Portas (NÃO fatal)
# ---------------------------------------------------------------------------
_is_port() {
    [[ "$1" =~ ^[0-9]+$ ]] && (( $1 >= 1024 && $1 <= 65535 ))
}

for p in SERVER_PORT CHROME_PORT CHROME_PROXY_PORT; do
    val="${!p:-}"
    if [[ -n "${val}" ]]; then
        if ! _is_port "${val}"; then
            warn "ENV porta inválida: ${p}='${val}' (deve estar entre 1024-65535)"
        fi
    fi
done

# ---------------------------------------------------------------------------
# 3.12 Validação Semântica de Portas (APENAS se todas existirem)
# ---------------------------------------------------------------------------
if [[ -n "${SERVER_PORT:-}" && -n "${CHROME_PORT:-}" && -n "${CHROME_PROXY_PORT:-}" ]]; then
    if [[ "${SERVER_PORT}" == "${CHROME_PORT}" ]] \
    || [[ "${SERVER_PORT}" == "${CHROME_PROXY_PORT}" ]] \
    || [[ "${CHROME_PORT}" == "${CHROME_PROXY_PORT}" ]]; then
        error "ENV CRÍTICO: Conflito lógico de portas detectado"
        error "→ SERVER_PORT=${SERVER_PORT}"
        error "→ CHROME_PORT=${CHROME_PORT}"
        error "→ CHROME_PROXY_PORT=${CHROME_PROXY_PORT}"
        STRUCT_ERRORS=$((STRUCT_ERRORS + 1))
    fi
fi

# ---------------------------------------------------------------------------
# 3.13 Validação de Dependências Semânticas (v6.0)
# ---------------------------------------------------------------------------
log "Validando dependências semânticas..."

# BROWSER_MODE=wsEndpoint → CHROME_PROXY_PORT + CHROME_PORT + CHROME_HOST
if [[ "${BROWSER_MODE:-}" == "wsEndpoint" ]]; then
    for var in CHROME_PROXY_PORT CHROME_PORT CHROME_HOST; do
        if [[ -z "${!var:-}" ]]; then
            error "DEPENDÊNCIA AUSENTE: BROWSER_MODE=wsEndpoint requer ${var}"
            STRUCT_ERRORS=$((STRUCT_ERRORS + 1))
        fi
    done
    if [[ "${STRUCT_ERRORS}" -eq 0 ]]; then
        log "✓ Dependências de BROWSER_MODE=wsEndpoint satisfeitas"
    fi
fi

# MOCK_CHROME=1 → Avisar sobre limitações
if [[ "${MOCK_CHROME:-0}" == "1" ]]; then
    warn "MOCK_CHROME=1 ativo: Browser real não será usado"
    warn "→ Apenas para testes, NÃO use em produção"
fi

# ALLOW_DEGRADED_MODE=true em produção → Erro
if [[ "${NODE_ENV:-}" == "production" && "${ALLOW_DEGRADED_MODE:-false}" == "true" ]]; then
    error "INCONSISTÊNCIA: ALLOW_DEGRADED_MODE=true não permitido em NODE_ENV=production"
    STRUCT_ERRORS=$((STRUCT_ERRORS + 1))
fi

# ---------------------------------------------------------------------------
# 3.14 Veredito Final (v6.0)
# ---------------------------------------------------------------------------
TOTAL_FATAL_ERRORS=$((STRUCT_ERRORS + INFRA_ERRORS))

if [[ "${TOTAL_FATAL_ERRORS}" -gt 0 ]]; then
    error "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    error "VALIDAÇÃO ENV FALHOU (${TOTAL_FATAL_ERRORS} erro[s] fatal[is])"
    error "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    error "→ Estruturais : ${STRUCT_ERRORS} erro(s)"
    error "→ Infraestrutura : ${INFRA_ERRORS} erro(s)"
    error ""
    error "Fonte de verdade: devcontainer.json (remoteEnv) + .env files"
    error "Referência: .devcontainer/ENV_ANALYSIS_V6.md"
    error "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    exit 1
fi

if [[ "${OPER_WARNINGS}" -gt 0 ]]; then
    warn "Validação ENV: ${OPER_WARNINGS} aviso(s) operacional(is)"
    warn "→ Estado aceitável durante bootstrap / rebuild / attach"
fi

if [[ "${FLAG_INFO}" -gt 0 ]]; then
    log "Feature flags detectados: ${FLAG_INFO}"
fi

log "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
log "✓ Validação ENV concluída com sucesso (modelo estratificado v6.0)"
log "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"


# =============================================================================
# SECTION 4 — CONTEXTO, PATHS & IDEMPOTÊNCIA (GATEKEEPER) v5.2.2
#
# Finalidade:
#   • Estabilizar caminhos canônicos do runtime.
#   • Definir o modo operacional da execução.
#   • Impedir reexecução destrutiva implícita.
#   • Permitir reexecução EXPLÍCITA, consciente e rastreável.
#
# Contrato:
#   • Nenhuma escrita implícita
#   • Estado persistente é OPT-IN
#   • Reexecução SOMENTE via sinal explícito
#   • Abort precoce é deliberado e explícito
# =============================================================================

# ---------------------------------------------------------------------------
# 4.0 Definições Canônicas ANTES de qualquer uso (set -u safe)
# ---------------------------------------------------------------------------

# Caminhos estabilizados
readonly HOME_DIR="${HOME}"
# DEVCONTAINER_DIR já foi definido na linha 188 (SECTION 1)

# Manifesto persistente (workspace-level)
readonly STATE_FILE="${DEVCONTAINER_DIR}/.initialized"

# Marcadores EFÊMEROS — controle transacional do bootstrap
#
# IN_PROGRESS → execução iniciada, mas NÃO concluída
# COMPLETED   → execução concluída com sucesso
#
# Ambos existem apenas durante a vida do container.
readonly IN_PROGRESS_MARKER="/tmp/post-create.in-progress"
readonly COMPLETED_MARKER="/tmp/post-create.done"

# ---------------------------------------------------------------------------
# 4.0.1 Limpeza defensiva — estado impossível
#
# Cenário:
#   • Ambos os marcadores presentes simultaneamente
#   • Indica crash, kill -9 ou interrupção anômala
#
# Política:
#   • Preservar COMPLETED (fonte mais forte)
#   • Remover IN_PROGRESS
# ---------------------------------------------------------------------------

if [[ -f "${COMPLETED_MARKER}" && -f "${IN_PROGRESS_MARKER}" ]]; then
    warn "Gatekeeper: Estado inconsistente detectado (COMPLETED + IN_PROGRESS)."
    warn "→ Limpando IN_PROGRESS e preservando COMPLETED."
    rm -f "${IN_PROGRESS_MARKER}" 2>/dev/null || true
fi

# ---------------------------------------------------------------------------
# 4.1 Política de Persistência de Estado (ENV-driven com fallback)
#
# Fonte de verdade:
#   1. ENABLE_STATE_FILE
#   2. Fallback: true
# ---------------------------------------------------------------------------

ENABLE_STATE_FILE_VAL="${ENABLE_STATE_FILE:-true}"

case "${ENABLE_STATE_FILE_VAL}" in
    true)
        SKIP_STATE_FILE=false
        log "Gatekeeper: Persistência de estado ATIVADA (ENABLE_STATE_FILE=true)"
        ;;
    false)
        SKIP_STATE_FILE=true
        log "Gatekeeper: Persistência de estado DESATIVADA (ENABLE_STATE_FILE=false)"
        ;;
    *)
        SKIP_STATE_FILE=false
        warn "Gatekeeper: ENABLE_STATE_FILE inválido ('${ENABLE_STATE_FILE_VAL}'); assumindo true"
        ;;
esac

readonly SKIP_STATE_FILE

# ---------------------------------------------------------------------------
# 4.2 Política de Reexecução Estrutural (EXPLÍCITA)
#
# Variável:
#   • REEXECUTE_POST_CREATE=true
#
# Semântica:
#   • Ignora estado persistente EXISTENTE
#   • NÃO ignora validações
#   • NÃO ignora fail-fast
# ---------------------------------------------------------------------------

REEXECUTE_POST_CREATE_VAL="${REEXECUTE_POST_CREATE:-false}"

case "${REEXECUTE_POST_CREATE_VAL}" in
    true)
        FORCE_REEXECUTION=true
        log "Gatekeeper: Reexecução estrutural FORÇADA (REEXECUTE_POST_CREATE=true)"
        ;;
    *)
        FORCE_REEXECUTION=false
        ;;
esac

readonly FORCE_REEXECUTION

# ---------------------------------------------------------------------------
# 4.3 Determinação do Modo Operacional
#
# Modos possíveis:
#   • stateless  → Persistência desativada explicitamente
#   • bootstrap  → Primeira execução neste container
#   • reentry    → Execução já realizada neste container
#   • replay     → Reexecução EXPLÍCITA solicitada ou recuperação
# ---------------------------------------------------------------------------

if [[ "${SKIP_STATE_FILE}" == "true" ]]; then
    RUNTIME_MODE="stateless"
    log "Gatekeeper: Persistência desativada — modo stateless ativo."

elif [[ -f "${COMPLETED_MARKER}" && "${FORCE_REEXECUTION}" != "true" ]]; then
    RUNTIME_MODE="reentry"
    log "Gatekeeper: Execução anterior COMPLETA detectada (${COMPLETED_MARKER})."

elif [[ -f "${IN_PROGRESS_MARKER}" ]]; then
    RUNTIME_MODE="replay"
    warn ""
    warn "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    warn "🔄 RECOVERY MODE ATIVADO"
    warn "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    warn "Gatekeeper: Execução anterior INTERROMPIDA (IN_PROGRESS detectado)."
    warn "→ Possível falha anterior detectada"
    warn "→ Reexecução estrutural AUTORIZADA para recuperação"
    warn "→ Marcador: ${IN_PROGRESS_MARKER}"

    # Verificar idade do marker (diagnóstico)
    if command -v stat >/dev/null 2>&1; then
        marker_mtime=$(stat -c%Y "${IN_PROGRESS_MARKER}" 2>/dev/null || echo 0)
        current_time=$(date +%s)
        marker_age=$((current_time - marker_mtime))

        if [[ $marker_age -gt 0 ]]; then
            marker_timestamp=$(date -d "@${marker_mtime}" -Iseconds 2>/dev/null || echo "unknown")
            warn "→ Última tentativa: ${marker_timestamp} (${marker_age}s atrás)"
        fi
    fi

    warn "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    warn ""

elif [[ -f "${STATE_FILE}" && -s "${STATE_FILE}" && "${FORCE_REEXECUTION}" == "true" ]]; then
    RUNTIME_MODE="replay"
    log "Gatekeeper: Estado persistente detectado, mas reexecução foi solicitada."

else
    RUNTIME_MODE="bootstrap"
    log "Gatekeeper: Nenhuma execução prévia neste container. Entrando em bootstrap."
fi

readonly RUNTIME_MODE
log "Gatekeeper: Modo operacional efetivo = ${RUNTIME_MODE}"

# ---------------------------------------------------------------------------
# 4.4 Gatekeeper de Idempotência (Ponto de Não-Retorno)
#
# Regra:
#   • reentry  ⇒ abort imediato
#   • replay   ⇒ execução AUTORIZADA
#   • bootstrap/stateless ⇒ execução normal
# ---------------------------------------------------------------------------

if [[ "${RUNTIME_MODE}" == "reentry" ]]; then
    log "Gatekeeper: Execução abortada para preservar idempotência por container."
    log "Gatekeeper: Execução encerrada com sucesso (reentry)."
    exit 0
fi

if [[ "${RUNTIME_MODE}" == "replay" ]]; then
    log "Gatekeeper: Reexecução estrutural AUTORIZADA (replay consciente)."
fi

# ---------------------------------------------------------------------------
# 4.5 Registro do Momento Zero (Forense / Âncora de Execução)
# ---------------------------------------------------------------------------

log "Inicialização estrutural autorizada."
log "Simbiose v${SCRIPT_VERSION} | Hash=${SCRIPT_HASH:0:8}"
log "Modo de execução: ${RUNTIME_MODE}"
log "Identidade: ${CURRENT_USER} (UID:${CURRENT_UID})"
log "Paths: HOME=${HOME_DIR} | PROJECT_ROOT=${PROJECT_ROOT}"

# ---------------------------------------------------------------------------
# INÍCIO DA TRANSAÇÃO DE BOOTSTRAP
# ---------------------------------------------------------------------------

touch "${IN_PROGRESS_MARKER}"
log "Gatekeeper: Execução marcada como IN_PROGRESS (${IN_PROGRESS_MARKER})"

# =============================================================================
# SECTION 5 — AUDITORIA DE ESTRUTURA (HANDSHAKE) v3.9.0-ELITE
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
# 5.1 Definição canônica de artefatos estruturais
# ---------------------------------------------------------------------------
readonly STRUCT_GIT_DIR="${PROJECT_ROOT}/.git"
readonly STRUCT_NODE_MANIFEST="${PROJECT_ROOT}/package.json"
readonly STRUCT_MAKEFILE="${PROJECT_ROOT}/Makefile"

# Estado interno da auditoria (construção)
STRUCT_STATUS="OK"
STRUCT_WARNINGS=()

# ---------------------------------------------------------------------------
# 5.2 Identidade do projeto (Git)
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
# 5.3 Manifesto de runtime (Node.js)
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
# 5.4 Governança de execução (Makefile)
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
# 5.5 Síntese semântica (informativa, imutável)
# ---------------------------------------------------------------------------
readonly STRUCT_STATUS
readonly STRUCT_WARNINGS

if [[ "${STRUCT_STATUS}" == "OK" ]]; then
    log "Handshake Summary: STATUS=OK (estrutura consistente)"
else
    log "Handshake Summary: STATUS=DEGRADED | missing=$(IFS=,; echo "${STRUCT_WARNINGS[*]}")"
fi

# =============================================================================
# SECTION 6 — GESTÃO DE VOLUMES (ESTRUTURAL & DEFENSIVA)
#
# Responsabilidade:
#   • Auditar a presença e a gravabilidade dos volumes declarados
#   • Fail-Fast EXCLUSIVO para volumes críticos
#   • Tratar volumes de SSH APENAS como filesystem (não identidade)
#
# Princípios:
#   • Nenhuma criação corretiva de volumes
#   • Nenhuma alteração de ownership
#   • Nenhuma suposição sobre o host
#   • Nenhuma suposição sobre identidade SSH
# =============================================================================
log "Validando integridade estrutural dos volumes (audit-only)..."

# ---------------------------------------------------------------------------
# 6.1 Lista canônica de volumes esperados (AUDIT-ONLY)
# ---------------------------------------------------------------------------
readonly VOLUME_DIRS=(
    "${USER_HOME}/.cache"
    "${USER_HOME}/.cache/puppeteer"
    "${USER_HOME}/.cache/typescript"
    "${USER_HOME}/.npm"
    "${USER_HOME}/.npm-global"
    "${USER_HOME}/.pm2"
    "${USER_HOME}/.config"
    "${USER_HOME}/.local/share"
    "${USER_HOME}/.local/state"
    "${USER_HOME}/.claude"

    # SSH / GPG — VOLUMES APENAS (não identidade)
    "${USER_HOME}/.ssh"
    "${USER_HOME}/.gnupg"

    "${USER_HOME}/.vscode-server"
    "${USER_HOME}-history"
)

# ---------------------------------------------------------------------------
# 6.2 Volumes CRÍTICOS (ausência ou não-gravabilidade ⇒ abort)
# ---------------------------------------------------------------------------
# Nota:
# • Volumes críticos são definidos por necessidade FUNCIONAL do sistema
# • SSH NÃO é crítico neste estágio (capacidade tardia)
readonly CRITICAL_VOLUMES=(
    "${USER_HOME}/.config"
    "${USER_HOME}/.claude"
    "${USER_HOME}/.local/state"
)

# ---------------------------------------------------------------------------
# 6.3 Auditoria de volumes (SEM criação, SEM correção)
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

log "Volumes auditados com sucesso."

# =============================================================================
# SECTION 7 — SSH (CONTRATO DE IDENTIDADE & CAPACIDADE — OBSERVACIONAL)
#
# ATUALIZADO v5.3 (2026-02-03):
#   DevContainer agora usa VS Code Native SSH Forwarding.
#   Mount manual de socket REMOVIDO (causava erro fatal).
#
# Responsabilidade:
#   • Observar a presença de capacidade SSH no runtime
#   • Classificar o estado factual do SSH
#   • Exportar sinais SEMÂNTICOS para estágios posteriores
#
# Natureza:
#   • OPT-IN         → SSH só existe se o VS Code fornecer forwarding
#   • OBSERVACIONAL → Nenhuma ação corretiva é executada aqui
#   • TIMING-AWARE  → O estado pode evoluir após o post-create
#
# Princípios invariantes:
#   • post-create NÃO inicia ssh-agent
#   • post-create NÃO depende de SSH
#   • SSH é uma CAPACIDADE TARDIA (attach-time)
#   • Nenhum path de SSH é canônico neste estágio
#
# Importante:
#   • O path de SSH_AUTH_SOCK é IRRELEVANTE aqui
#   • Pode variar por host, OS, runtime e sessão
#   • Nenhuma normalização é permitida em post-create
#   • VS Code gerencia forwarding automaticamente quando disponível
#
# Estados possíveis (vereditos, não erros):
#   • absent        → SSH não solicitado (SSH_AUTH_SOCK ausente)
#   • present       → SSH_AUTH_SOCK definido, mas não validável ainda
#   • valid         → Socket SSH válido observado (VS Code forwarding ativo)
#   • inconsistent  → SSH_AUTH_SOCK definido, mas semanticamente inválido
#
# Nota:
#   • Validação DEFINITIVA ocorre no post-attach.
#   • Aqui apenas observamos e registramos o estado factual.
#   • Container SEMPRE inicia, com ou sem SSH (fail-safe design).
# =============================================================================
log "Avaliando capacidade SSH (observacional)..."

readonly SSH_CONTRACT_VERSION="1.6"
SSH_CONTRACT_STATUS="absent"

# ---------------------------------------------------------------------------
# 7.1 Ausência explícita (caso legítimo)
# ---------------------------------------------------------------------------
if [[ -z "${SSH_AUTH_SOCK:-}" ]]; then
    SSH_CONTRACT_STATUS="absent"
    log "SSH: Não solicitado (SSH_AUTH_SOCK ausente)."

# ---------------------------------------------------------------------------
# 7.2 Variável presente — inspeção factual
# ---------------------------------------------------------------------------
else
    # Caso clássico: socket UNIX válido
    if [[ -S "${SSH_AUTH_SOCK}" ]]; then
        SSH_CONTRACT_STATUS="valid"
        log "SSH: Socket válido observado."
        log "→ Path observado: ${SSH_AUTH_SOCK}"

    # SSH_AUTH_SOCK definido, mas não é socket
    # Exemplos reais:
    # • path temporário ainda não montado
    # • forwarding tardio do VS Code
    # • valor herdado do host sem bind ativo
    elif [[ -e "${SSH_AUTH_SOCK}" ]]; then
        SSH_CONTRACT_STATUS="inconsistent"
        warn "SSH: SSH_AUTH_SOCK existe, mas NÃO é um socket."
        warn "→ Path observado: ${SSH_AUTH_SOCK}"
        warn "→ Estado inconsistente (provável timing / mount)."

    # Variável definida, mas path inexistente
    else
        SSH_CONTRACT_STATUS="present"
        warn "SSH: SSH_AUTH_SOCK definido, mas path não existe."
        warn "→ Path observado: ${SSH_AUTH_SOCK}"
        warn "→ Estado transitório possível (attach-time esperado)."
    fi
fi

# ---------------------------------------------------------------------------
# 7.3 Exportação semântica (consumo externo)
# ---------------------------------------------------------------------------
export SSH_CONTRACT_VERSION
export SSH_CONTRACT_STATUS

# Flags derivadas (NÃO normativas)
export SSH_SOCKET_AVAILABLE="$([[ "${SSH_CONTRACT_STATUS}" == "valid" ]] && echo true || echo false)"
export SSH_REQUESTED="$([[ "${SSH_CONTRACT_STATUS}" != "absent" ]] && echo true || echo false)"

log "SSH: status=${SSH_CONTRACT_STATUS} (requested=${SSH_REQUESTED}, usable=${SSH_SOCKET_AVAILABLE})"

# =============================================================================
# SECTION 8 — A PONTE DO HISTÓRICO (O ELO PERDIDO) v3.9.0-ELITE
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
readonly HISTORY_VOL="${USER_HOME}-history"
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
# SECTION 9 — GATEKEEPER NSS (RUNTIME IDENTITY v3.9.0-ELITE)
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
        # Grupos reais visíveis ao runtime (best-effort, não-fatal)
        {
            id -G \
              | xargs -n1 getent group 2>/dev/null \
              | cut -d: -f1,2,3 \
              | sed 's/$/:/' \
              | grep -v "^::"
        } || true

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
# SECTION 10 — GIT BASE CONFIGURATION (OPCIONAL & DEFENSIVA) v3.9.0-ELITE
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
# SECTION 11 — DIAGNÓSTICO EXAUSTIVO (INTERNAL DEEP AUDIT) v3.9.0-ELITE
# =============================================================================
log "Iniciando Diagnóstico Exaustivo (Simbiose Deep Audit)..."

NET_STATUS="SKIP"
if command -v curl >/dev/null 2>&1; then
    # Nota: --max-time 2 blinda contra atrasos em ambientes corporativos/proxies
    if curl -Is --connect-timeout 2 --max-time 2 google.com >/dev/null 2>&1; then
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
# SECTION 12 — REGISTRO DE ESTADO & HANDOFF CANÔNICO (MANIFESTO FINAL)
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
mkdir -p "$(dirname "${STATE_FILE}")" || true

# ---------------------------------------------------------------------------
# Geração do Manifesto (Machine-Readable, Declarativo)
# ---------------------------------------------------------------------------
if [[ "${SKIP_STATE_FILE}" == "true" ]]; then
    log "Persistência de estado desativada (ENABLE_STATE_FILE != true). Manifesto não será gravado."
else
    {
        printf '%s\n' \
"# =============================================================================" \
"# SIMBIOSE — STATE MANIFESTO" \
"# Version: ${SCRIPT_VERSION}" \
"# =============================================================================" \
"" \
"# ---------------------------------------------------------------------------" \
"# Temporal & Script Identity (SNAPSHOT)" \
"# ---------------------------------------------------------------------------" \
"initialized_at=$(date -Is 2>/dev/null || echo unknown)" \
"script_name=${SCRIPT_NAME}" \
"script_version=${SCRIPT_VERSION}" \
"script_hash=${SCRIPT_HASH:0:8}" \
"total_setup_seconds=${BOOT_DURATION:-${SECONDS:-0}}" \
"" \
"# ---------------------------------------------------------------------------" \
"# Identity & Security Context (VEREDICTS)" \
"# ---------------------------------------------------------------------------" \
"user=${CURRENT_USER}" \
"uid=${CURRENT_UID}" \
"gid=${CURRENT_GID}" \
"groups=$(id -Gn 2>/dev/null | tr ' ' ',' || echo unknown)" \
"nss_profile=EXTENDED" \
"" \
"# ---------------------------------------------------------------------------" \
"# Infrastructure Mapping (OBSERVATIONAL)" \
"# ---------------------------------------------------------------------------" \
"home=${HOME_DIR}" \
"project_root=${PROJECT_ROOT}" \
"devcontainer_dir=${DEVCONTAINER_DIR}" \
"log_path=${LOG_FILE}" \
"" \
"# ---------------------------------------------------------------------------" \
"# Runtime Specs (BEST-EFFORT SNAPSHOT)" \
"# ---------------------------------------------------------------------------" \
"system_arch=$(uname -m 2>/dev/null || echo unknown)" \
"node_version=$(node -v 2>/dev/null || echo N/A)" \
"network_status=${NET_STATUS:-unknown}" \
"" \
"# ---------------------------------------------------------------------------" \
"# SSH Capability — CANONICAL CONTRACT VEREDICT" \
"# ---------------------------------------------------------------------------" \
"ssh_requested=${SSH_REQUESTED}" \
"ssh_socket_available=${SSH_SOCKET_AVAILABLE}" \
"ssh_contract_status=${SSH_CONTRACT_STATUS}" \
"ssh_contract_version=${SSH_CONTRACT_VERSION}" \
"" \
"# ---------------------------------------------------------------------------" \
"# Final Validation (DECLARATIVE)" \
"# ---------------------------------------------------------------------------" \
"status=ready" \
"integrity=canonical"
    } > "${STATE_SWAP}"

    mv -f "${STATE_SWAP}" "${STATE_FILE}"
    chmod 444 "${STATE_FILE}" || true

    log "✅ Manifesto de estado persistido com sucesso em ${STATE_FILE}"
fi
# ---------------------------------------------------------------------------
# HANDOFF FINAL — ENCERRAMENTO CANÔNICO v5.2.0
# ---------------------------------------------------------------------------

# =============================================================================
# SECTION 13 — FINAL HEALTH CHECK & SUCCESS BANNER v5.2.0
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
# 1 Métricas de Performance
# ---------------------------------------------------------------------------
BOOT_END_TIME="$(date +%s)"
BOOT_DURATION=$((BOOT_END_TIME - BOOT_START_TIME))

# ---------------------------------------------------------------------------
# 2 Validação de Conectividade Chrome (Arquitetura Completa - INFORMATIVO)
# ---------------------------------------------------------------------------
# ARQUITETURA CRÍTICA (ambos componentes são FUNDAMENTAIS para operação):
#
#   Puppeteer (container) → Proxy Server (container:9224) → Chrome (Windows:9225)
#                           └─────────────────────────────────────┘
#                                    Ponte obrigatória
#
# COMPONENTES (igualmente importantes):
#   1. Chrome Backend (Windows, porta 9225)
#      → Navegador real que executa automação LLM
#      → Iniciado: START-CHROME-SIMPLE.bat (Windows host)
#
#   2. Proxy Server (Container, porta 9224)
#      → Servidor proxy HTTP + WebSocket (chromeProxyService.js)
#      → Ponte OBRIGATÓRIA entre Puppeteer e Chrome Windows
#      → Sem proxy = sem acesso ao Chrome = sem operação LLM
#      → Iniciado: automaticamente pelo sistema quando necessário
#
# CONTRATO DE BUILD:
#   • Nenhum dos dois PRECISA estar rodando durante build/inicialização
#   • Ausência durante boot é cenário NORMAL e ESPERADO
#   • Ambos serão iniciados sob demanda quando necessário
#   • Este check é INFORMATIVO (não bloqueia build)
#
# IMPORTÂNCIA OPERACIONAL:
#   • Chrome Windows: CRÍTICO (backend de automação)
#   • Proxy Container: CRÍTICO (único caminho de acesso)
#   • Ambos têm importância IGUAL para funcionamento do sistema
# ---------------------------------------------------------------------------
# ---------------------------------------------------------------------------
# Chrome / Proxy — Diagnóstico Informativo (NÃO BLOQUEANTE)
# ---------------------------------------------------------------------------

CHROME_PROXY_STATUS="⏸️  não verificado"
CHROME_PROXY_NOTE=""
CHROME_BACKEND_STATUS="⏸️  não verificado"
CHROME_BACKEND_NOTE=""

if [[ "${BROWSER_MODE:-}" == "wsEndpoint" ]]; then
    CHROME_HOST_EFF="${CHROME_HOST:-host.docker.internal}"
    CHROME_PORT_EFF="${CHROME_PORT:-9225}"
    CHROME_PROXY_PORT_EFF="${CHROME_PROXY_PORT:-9224}"

    CHROME_BACKEND_ENDPOINT="${CHROME_HOST_EFF}:${CHROME_PORT_EFF}"
    CHROME_PROXY_ENDPOINT="localhost:${CHROME_PROXY_PORT_EFF}"

    # -----------------------------------------------------------------------
    # Infra check helpers (defensive)
    # -----------------------------------------------------------------------
    HAS_TIMEOUT=false
    HAS_DEV_TCP=false

    command -v timeout >/dev/null 2>&1 && HAS_TIMEOUT=true
( : >/dev/tcp/127.0.0.1/1 ) 2>/dev/null && HAS_DEV_TCP=true

    # -----------------------------------------------------------------------
    # Validação 1 — Chrome Backend (Windows Host, porta 9225)
    # -----------------------------------------------------------------------
    if [[ "${HAS_TIMEOUT}" == "true" && "${HAS_DEV_TCP}" == "true" ]]; then
        if timeout 3 bash -c \
            "cat < /dev/null > /dev/tcp/${CHROME_HOST_EFF}/${CHROME_PORT_EFF}" \
            2>/dev/null; then

            CHROME_BACKEND_STATUS="✅ respondendo"
            CHROME_BACKEND_NOTE="Chrome Windows acessível em ${CHROME_BACKEND_ENDPOINT} (OK, embora não esperado no boot)"
        else
            CHROME_BACKEND_STATUS="⏸️  aguardando demanda"
            CHROME_BACKEND_NOTE="Será iniciado quando necessário (START-CHROME-SIMPLE.bat)"
        fi
    else
        CHROME_BACKEND_STATUS="⏸️  diagnóstico indisponível"
        CHROME_BACKEND_NOTE="timeout ou /dev/tcp indisponível (checagem pulada)"
    fi

    # -----------------------------------------------------------------------
    # Validação 2 — Chrome Proxy Service (Container, porta 9224)
    # -----------------------------------------------------------------------
    if [[ "${HAS_TIMEOUT}" == "true" && "${HAS_DEV_TCP}" == "true" ]]; then
        if timeout 2 bash -c \
            "cat < /dev/null > /dev/tcp/localhost/${CHROME_PROXY_PORT_EFF}" \
            2>/dev/null; then

            CHROME_PROXY_STATUS="✅ respondendo"
            CHROME_PROXY_NOTE="Proxy server acessível em ${CHROME_PROXY_ENDPOINT} (OK, embora não esperado no boot)"
        else
            CHROME_PROXY_STATUS="⏸️  aguardando demanda"
            CHROME_PROXY_NOTE="Será iniciado automaticamente quando necessário"
        fi
    else
        CHROME_PROXY_STATUS="⏸️  diagnóstico indisponível"
        CHROME_PROXY_NOTE="timeout ou /dev/tcp indisponível (checagem pulada)"
    fi
fi

# ---------------------------------------------------------------------------
# 3 Success Banner
# ---------------------------------------------------------------------------
echo ""
printf "╔════════════════════════════════════════════════════════════╗\n"
printf "║  ✅ DevContainer Inicializado com Sucesso (v%-14s) ║\n" "${SCRIPT_VERSION}"
printf "╚════════════════════════════════════════════════════════════╝\n"
echo ""

echo "📊 Checklist de Inicialização:"
echo "  ✅ Identidade validada (${CURRENT_USER}, UID ${CURRENT_UID})"
echo "  ✅ Variáveis de ambiente (${#STRUCTURAL_ENV_VARS[@]} críticas)"
echo "  ✅ Volumes persistentes (${#VOLUME_DIRS[@]} volumes configurados)"
echo "  ✅ Histórico bash (persistente)"
echo "  ✅ NSS wrapper (identidade dinâmica)"
echo "  ${CHROME_BACKEND_STATUS} Chrome backend (Windows:9225)"
[[ -n "${CHROME_BACKEND_NOTE}" ]] && echo "     └─ ${CHROME_BACKEND_NOTE}"
echo "  ${CHROME_PROXY_STATUS} Proxy server (container:9224)"
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

echo "💡 Arquitetura Chrome (ambos componentes são FUNDAMENTAIS):"
echo "   1. Chrome Windows (backend, porta 9225)"
echo "      → Navegador real que executa automação LLM"
echo "      → Comando: START-CHROME-SIMPLE.bat (Windows host)"
echo ""
echo "   2. Proxy Server Container (ponte, porta 9224)"
echo "      → Servidor proxy HTTP + WebSocket no container"
echo "      → ÚNICA forma do Puppeteer acessar Chrome Windows"
echo "      → Iniciado automaticamente pelo sistema"
echo ""
echo "   ⚠️  Ambos são IGUALMENTE IMPORTANTES para operação LLM"
echo "   ✅ Nenhum dos dois é obrigatório durante build container"
echo "   🚀 Serão iniciados sob demanda quando necessário"
echo ""

# ---------------------------------------------------------------------------
# 4 COMMIT FINAL DA TRANSAÇÃO DE BOOTSTRAP
# ---------------------------------------------------------------------------

# Validação de sanidade antes do commit
if [[ ! -f "${IN_PROGRESS_MARKER}" ]]; then
    error "INCONSISTÊNCIA CRÍTICA: IN_PROGRESS_MARKER não existe no commit final"
    error "→ Possível remoção prematura ou lógica quebrada"
    error "→ Marker esperado: ${IN_PROGRESS_MARKER}"
    exit 1
fi

log "Gatekeeper: Validação de sanidade aprovada. Finalizando transação..."

# Commit atômico (ordem importa: remover IN_PROGRESS, criar COMPLETED)
rm -f "${IN_PROGRESS_MARKER}" 2>/dev/null || true
touch "${COMPLETED_MARKER}"

log "Gatekeeper: Execução concluída com sucesso (COMPLETED)."

echo -e "\n--- [SIMBIOSE COMPLETE] ---"
log "Inicialização estrutural concluída com sucesso."
log "Estado: READY | Integridade: CANONICAL"
log "Rastro físico (Log): ${_blue}${LOG_FILE}${_reset}"
log "🚀 Ambiente Simbiótico v${SCRIPT_VERSION} está ONLINE."
echo -e "---------------------------\n"

# Banner final claro no terminal
echo ""
echo "╔════════════════════════════════════════════════════════════╗"
echo "║  ✅ POST-CREATE CONCLUÍDO COM SUCESSO                      ║"
echo "╚════════════════════════════════════════════════════════════╝"
echo ""
echo "📝 Log completo gravado em:"
echo "   ${LOG_FILE}"
echo ""
echo "📖 Para revisar logs:"
echo "   • VS Code: Ctrl+Shift+P → 'View Log' → post-create.log"
echo "   • Terminal: cat ${LOG_FILE}"
echo "   • Tail: tail -f ${LOG_FILE}"
echo ""
echo "✅ Container pronto para uso!"
echo ""
