#!/usr/bin/env bash
# =============================================================================
# post-create.sh — Inicialização Estrutural do DevContainer (CANÔNICO)
#
# Version: v1.0.1 (final hardened)
#
# PRINCÍPIO:
#   Este script NÃO é conveniência de setup. É verificação estrutural.
#   Ele executa validações, auditorias e instrumentação mínima — com fail-fast
#   estratificado e idempotência por container.
#
# COMPATIBILIDADE:
#   - Bash 5+ (Debian Bookworm OK)
#   - Shell hardening: set -Eeuo pipefail
#   - Sem leitura interativa de stdin
#
# GARANTIAS (blindagens principais):
#   - Re-exec em bash se invocado por sh/posix inadvertido
#   - Logger robusto SEM process substitution (sem `>(...)`)
#     (usa coprocess/pipe; evita o erro “token inesperado '('”)
#   - Trap robusto (ERR + EXIT) com snapshot de ENV e preservação de marker
#   - Sem chown recursivo de workspace (proibido em bind-mount)
#   - Auditoria de volumes sem criação implícita (exceto /tmp e log dir; history é UX)
#
# CONTRATOS CANÔNICOS:
#   • Executado como usuário canônico ('node') por padrão
#   • Idempotente por container (reentry aborta com exit 0)
#   • Reexecução somente por sinal explícito (REEXECUTE_POST_CREATE=true)
#     ou por recovery automático (IN_PROGRESS_MARKER preservado em erro)
#   • Fail-fast absoluto para variáveis estruturais (ENV)
#   • Infraestrutura: FATAL em production; WARNING em development/test
#   • Chrome externo é fundamental para operação, mas ausência no boot é normal
#
# REFERÊNCIAS:
#   • .devcontainer/ENV_ANALYSIS_V6.md
#   • .devcontainer/TROUBLESHOOTING_SSH.md
# =============================================================================

# =============================================================================
# LAYER 0 — Helpers (sem efeitos colaterais ao "source")
# =============================================================================

# Se invocado por /bin/sh ou modo não-bash, re-exec em bash (blindagem máxima).
if [[ -z "${BASH_VERSION:-}" ]]; then
  exec /usr/bin/env bash "$0" "$@"
fi

# warn() mínimo (será substituído por logger completo na execução direta)
warn() { echo "[WARN] $*" >&2; }

# cria diretório idempotente (silencioso)
ensure_dir() {
  local dir="${1:-}"
  [[ -z "${dir}" ]] && return 0
  mkdir -p "${dir}" 2>/dev/null || true
}

# wrapper para chown seguro
safe_chown() { chown "$@" 2>/dev/null || true; }

# validação leve de LD_PRELOAD (informativa)
validate_ld_preload() {
  local val="${1:-}"
  if [[ -z "${val}" ]]; then
    echo "⚠️  [post-create] LD_PRELOAD is empty; NSS may not activate" >&2
    return 1
  fi
  if (( ${#val} > 4096 )); then
    echo "⚠️  [post-create] LD_PRELOAD length ${#val} exceeds kernel limit; may be truncated" >&2
  fi
  return 0
}

# check_chown_contract <path> <current_uid>
# Emite warning se path pertence a outro UID (chown recursivo proibido).
check_chown_contract() {
  local path="${1:-}" current_uid="${2:-}"
  local owner="unknown"

  [[ -z "${path}" || -z "${current_uid}" ]] && return 0
  command -v stat >/dev/null 2>&1 || return 0

  if stat --version >/dev/null 2>&1; then
    owner="$(stat -c '%u' "${path}" 2>/dev/null || echo unknown)"
  else
    owner="$(stat -f '%u' "${path}" 2>/dev/null || echo unknown)"
  fi

  if [[ -n "${owner}" && "${owner}" != "${current_uid}" && "${owner}" != "unknown" ]]; then
    printf '[WARN] workspace root (%s) pertence a UID %s; chown recursivo é proibido.\n' \
      "${path}" "${owner}" >&2
  fi
}

# audit_mounts <project_root> <current_user>
audit_mounts() {
  local proj="${1:-}" user="${2:-}"
  echo -e "\n[2. Mount Analysis & Filesystem Context]"

  if ! command -v mount >/dev/null 2>&1; then
    echo "mount command not available"
    if command -v findmnt >/dev/null 2>&1; then
      findmnt --noheadings --target "${proj:-/workspaces}" 2>/dev/null || true
    fi
  elif command -v mount >/dev/null 2>&1; then
    local esc_project
    esc_project="$(printf '%s' "${proj}" | sed -e 's/[][\\.^$*+?()|{}]/\\&/g')"
    mount 2>/dev/null \
      | grep -E "(${esc_project}|/home/${user:-unknown})" 2>/dev/null \
      | column -t 2>/dev/null \
      || echo "Mount information unavailable or filtered."
  else
    echo "mount/findmnt indisponível"
  fi
}

# verifica libnss_wrapper; falha se ausente
check_nss_library() {
  local found="false"

  # ldconfig é o mais robusto quando disponível
  if command -v ldconfig >/dev/null 2>&1 && command -v grep >/dev/null 2>&1; then
    if ldconfig -p 2>/dev/null | grep -q "libnss_wrapper\.so"; then
      found="true"
    fi
  fi

  [[ "${found}" == "true" ]] && return 0

  # caminhos comuns (fallback)
  [[ -f "/usr/lib/libnss_wrapper.so" ]] && return 0
  [[ -f "/usr/lib/x86_64-linux-gnu/libnss_wrapper.so" ]] && return 0

  if command -v uname >/dev/null 2>&1; then
    local arch
    arch="$(uname -m 2>/dev/null || true)"
    if [[ -n "${arch}" && -f "/usr/lib/${arch}-linux-gnu/libnss_wrapper.so" ]]; then
      return 0
    fi
  fi

  echo "🔴 [post-create] libnss_wrapper.so não encontrado" >&2
  echo "   instale libnss-wrapper ou rebuild o container" >&2
  return 1
}

# ---------------------------------------------------------------------------
# Guard: se o arquivo foi "sourceado", apenas exporta helpers e retorna.
# (Sem set -euo, sem traps, sem execução.)
# ---------------------------------------------------------------------------
if [[ "${BASH_SOURCE[0]}" != "${0}" ]]; then
  return 0
fi

# =============================================================================
# LAYER 1 — Execução direta (hardening + traps)
# =============================================================================

set -Eeuo pipefail
IFS=$'\n\t'
set +o posix 2>/dev/null || true

# ---------------------------------------------------------------------------
# Identidade canônica do script (imutável)
# ---------------------------------------------------------------------------
SCRIPT_NAME="post-create.sh"
SCRIPT_VERSION="1.0.1"
readonly SCRIPT_NAME SCRIPT_VERSION

# ---------------------------------------------------------------------------
# Paths canônicos (o mais cedo possível, para suportar trap e logging)
# ---------------------------------------------------------------------------
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd -P)"
DEVCONTAINER_DIR="${PROJECT_ROOT}/.devcontainer"
LOG_DIR="${DEVCONTAINER_DIR}/logs"
LOG_FILE="${LOG_DIR}/post-create.log"

readonly SCRIPT_DIR PROJECT_ROOT DEVCONTAINER_DIR

# ---------------------------------------------------------------------------
# Markers transacionais (definidos cedo para recovery em falha precoce)
# ---------------------------------------------------------------------------
IN_PROGRESS_MARKER="/tmp/post-create.in-progress"
COMPLETED_MARKER="/tmp/post-create.done"
readonly IN_PROGRESS_MARKER COMPLETED_MARKER

# ---------------------------------------------------------------------------
# Logging: blindagem sem process substitution (coprocess tee)
#   - evita `exec > >(tee ...)` e o erro “token inesperado '('”
# ---------------------------------------------------------------------------

# logger state
_LOG_FD=""
_LOG_PID=""

# garantir diretório de log; se falhar, fallback /tmp (não quebra bootstrap)
ensure_dir "${LOG_DIR}"
if [[ ! -d "${LOG_DIR}" || ! -w "${LOG_DIR}" ]]; then
  LOG_DIR="/tmp/devcontainer-logs"
  ensure_dir "${LOG_DIR}"
  LOG_FILE="${LOG_DIR}/post-create.log"
fi
readonly LOG_DIR LOG_FILE

# Registra o estado bruto herdado do ambiente antes de redirecionar stdout/stderr para o logger.
if [[ -z "${LD_PRELOAD:-}" ]]; then
  validate_ld_preload "${LD_PRELOAD:-}" || true
fi

# Hash defensivo (best-effort)
SCRIPT_HASH="unknown"
if command -v sha256sum >/dev/null 2>&1 && [[ -r "${BASH_SOURCE[0]}" ]]; then
  SCRIPT_HASH="$(sha256sum "${BASH_SOURCE[0]}" 2>/dev/null | awk '{print $1}' || echo unknown)"
fi
readonly SCRIPT_HASH

# Rotação defensiva de logs (robusta; sem glob quebrando set -e)
if [[ -f "${LOG_FILE}" ]] && command -v stat >/dev/null 2>&1; then
  LOG_SIZE="$(stat -c%s "${LOG_FILE}" 2>/dev/null || echo 0)"
  if [[ "${LOG_SIZE:-0}" =~ ^[0-9]+$ ]] && (( LOG_SIZE > 2097152 )); then
    ts="$(date -Is 2>/dev/null | tr ':' '-' || echo rotated)"
    mv "${LOG_FILE}" "${LOG_FILE}.${ts}.old" 2>/dev/null || true
    gzip -9 "${LOG_FILE}.${ts}.old" 2>/dev/null || true

    shopt -s nullglob
    archives=( "${LOG_FILE}."*.old.gz )
    shopt -u nullglob
    if (( ${#archives[@]} > 3 )); then
      mapfile -t sorted < <(printf '%s\n' "${archives[@]}" | sort -r)
      for ((i=3; i<${#sorted[@]}; i++)); do
        rm -f "${sorted[$i]}" 2>/dev/null || true
      done
    fi
  fi
fi

# inicia tee como coprocess e redireciona stdout/stderr para ele
_start_logger() {
  # guarda stdout/stderr originais para fallback em caso extremo
  exec 9>&1 10>&2

  if command -v tee >/dev/null 2>&1; then
    # coproc evita process substitution
    coproc __POSTCREATE_LOGGER { tee -a "${LOG_FILE}"; }
    _LOG_PID="${__POSTCREATE_LOGGER_PID:-}"
    _LOG_FD="${__POSTCREATE_LOGGER[1]:-}"

    if [[ -n "${_LOG_FD}" ]]; then
      exec >"${_LOG_FD}" 2>&1
      return 0
    fi
  fi

  # fallback: arquivo apenas (ainda registra; mantém 9/10 para emergência)
  exec >>"${LOG_FILE}" 2>&1
  echo "[WARN] Logger degrade: tee/coprocess indisponível; log somente em arquivo: ${LOG_FILE}" >&2
  return 0
}

_stop_logger() {
  # best-effort; NÃO deve falhar sob set -e
  set +e
  set +o pipefail

  # fecha FD do coproc (se existir) e espera tee drenar
  if [[ -n "${_LOG_FD:-}" ]]; then
    exec {__tmp_close_fd}>&- 2>/dev/null || true
    # tentar fechar diretamente o fd conhecido
    eval "exec ${_LOG_FD}>&- 2>/dev/null" || true
  fi
  if [[ -n "${_LOG_PID:-}" ]]; then
    wait "${_LOG_PID}" 2>/dev/null || true
  fi
}

_start_logger

_ts() { date -Is 2>/dev/null || echo "unknown-time"; }

_blue=$'\e[34m'
_yellow=$'\e[33m'
_red=$'\e[31m'
_reset=$'\e[0m'

log()   { echo -e "[${_blue}$(_ts)${_reset}] [${SCRIPT_NAME}] [pid=$$] ℹ️  $*"; }
warn()  { echo -e "[${_yellow}$(_ts)${_reset}] [${SCRIPT_NAME}] [pid=$$] ⚠️  $*" >&2; }
error() { echo -e "[${_red}$(_ts)${_reset}] [${SCRIPT_NAME}] [pid=$$] ❌ $*" >&2; }

# Timestamp de início (atribui antes de readonly)
BOOT_START_TIME="$(date +%s 2>/dev/null || echo 0)"
readonly BOOT_START_TIME

log "Simbiose inicializada"
log "→ Script : ${SCRIPT_NAME}"
log "→ Versão : ${SCRIPT_VERSION}"
log "→ Hash   : ${SCRIPT_HASH:0:8}"
log "→ Root   : ${PROJECT_ROOT}"
log "→ Log    : ${LOG_FILE}"

# =============================================================================
# TRAPS — Diagnóstico + Recovery Marker + Logger Cleanup
# =============================================================================

_write_env_snapshot_on_error() {
  local exit_code="${1:-1}"
  local line_num="${2:-unknown}"
  local ts snapshot

  ts="$(date +%s 2>/dev/null || echo 0)"
  snapshot="${LOG_DIR:-/tmp}/env_error_snapshot_${ts}.txt"

  {
    echo "=== ENV SNAPSHOT AT ERROR ==="
    echo "Exit Code: ${exit_code}"
    echo "Line: ${line_num}"
    echo "Timestamp: $(date -Iseconds 2>/dev/null || echo unknown)"
    echo "Script: ${SCRIPT_NAME} v${SCRIPT_VERSION}"
    echo "Project Root: ${PROJECT_ROOT}"
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
  } > "${snapshot}" 2>&1 || true

  echo "${snapshot}"
}

_on_err() {
  local exit_code=$?
  local line_num="${1:-${BASH_LINENO[0]:-unknown}}"

  # handler deve ser best-effort
  set +e
  set +o pipefail

  [[ "${exit_code}" -eq 0 ]] && return 0

  # garantir marker para REPLAY mesmo se falhar antes do Gatekeeper
  if [[ -n "${IN_PROGRESS_MARKER:-}" && ! -f "${IN_PROGRESS_MARKER}" ]]; then
    touch "${IN_PROGRESS_MARKER}" 2>/dev/null || true
  fi

  local snapshot
  snapshot="$(_write_env_snapshot_on_error "${exit_code}" "${line_num}")" || snapshot=""

  echo ""
  error "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  error "FALHA NO POST-CREATE (EXIT CODE: ${exit_code})"
  error "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  error "Linha aproximada: ${line_num}"
  error "Script: ${SCRIPT_NAME} v${SCRIPT_VERSION}"
  error ""
  error "AÇÃO AUTOMÁTICA:"
  error "  → IN_PROGRESS_MARKER mantido/criado para diagnóstico"
  error "  → Próxima execução entrará em modo REPLAY (recovery)"
  error ""
  error "AÇÕES DISPONÍVEIS:"
  error "  1. Rebuild container (via VS Code)"
  error "  2. Inspecionar logs: ${LOG_FILE}"
  error "  3. Forçar reexecução: REEXECUTE_POST_CREATE=true"
  error ""
  error "DIAGNÓSTICO RECOMENDADO:"
  error "  1. Verificar snapshot: ${snapshot:-<falhou>}"
  error "  2. Validar remoteEnv/runArgs em devcontainer.json"
  error "  3. Consultar: .devcontainer/ENV_ANALYSIS_V6.md"
  error "  4. SSH: .devcontainer/TROUBLESHOOTING_SSH.md"
  error "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo ""
}

_on_exit() {
  local exit_code=$?

  # Sempre: garantir que não deixamos recursos do logger pendurados
  _stop_logger

  # Não mexer em markers no EXIT: o commit transacional é feito no fluxo normal.
  # Em erro, o marker já foi preservado/criado em _on_err.
  return "${exit_code}"
}

trap '_on_err $LINENO' ERR
trap '_on_exit' EXIT

# =============================================================================
# SECTION 2 — Contrato de Identidade (Fail-fast)
# =============================================================================

EXPECTED_USER="node"
readonly EXPECTED_USER

CURRENT_USER="$(id -un 2>/dev/null || echo unknown)"
CURRENT_UID="$(id -u 2>/dev/null || echo unknown)"
CURRENT_GID="$(id -g 2>/dev/null || echo unknown)"
CURRENT_GROUPS="$(id -Gn 2>/dev/null | tr ' ' ',' || echo unknown)"

# Fallback defensivo (antes de readonly)
if [[ "${CURRENT_USER}" == "unknown" ]]; then
  warn "Identidade não resolvida (UID=${CURRENT_UID}), usando 'node' como fallback."
  CURRENT_USER="node"
fi

readonly CURRENT_USER CURRENT_UID CURRENT_GID CURRENT_GROUPS

USER_HOME="${HOME:-/home/${CURRENT_USER}}"
HOME_DIR="${USER_HOME}"
readonly USER_HOME HOME_DIR

check_chown_contract "${PROJECT_ROOT}" "${CURRENT_UID}"

log "Identity Check:"
log "→ Esperado : ${EXPECTED_USER}"
log "→ Atual    : ${CURRENT_USER} (UID:${CURRENT_UID}, GID:${CURRENT_GID})"
log "→ Grupos   : ${CURRENT_GROUPS}"
log "→ HOME     : ${HOME_DIR}"

if [[ "${SKIP_IDENTITY_CHECK:-false}" == "true" ]]; then
  log "SKIP_IDENTITY_CHECK=true, pulando contrato de identidade"
else
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
fi

log "Identidade validada com sucesso."

# =============================================================================
# SECTION 3 — ENV Validation (Taxonomia v6.0, estratificada)
# =============================================================================

log "Validando variáveis de ambiente (modelo estratificado v6.0)..."
log "ENV source hint: remoteEnv (VS Code) + runArgs (--env-file) + defaults"

schema_vars() {
  local cat="${1:-}"
  if command -v jq >/dev/null 2>&1 && [[ -f "${PROJECT_ROOT}/.env.schema.json" ]]; then
    jq -r ".categories[\"${cat}\"].properties | keys[]" "${PROJECT_ROOT}/.env.schema.json" 2>/dev/null || true
  fi
  return 0
}

# carregar do schema, senão fallback
STRUCTURAL_ENV_VARS=()
INFRASTRUCTURE_ENV_VARS=()
OPERATIONAL_ENV_VARS=()

mapfile -t STRUCTURAL_ENV_VARS < <(schema_vars "STRUCTURAL")
mapfile -t INFRASTRUCTURE_ENV_VARS < <(schema_vars "INFRASTRUCTURE")
mapfile -t OPERATIONAL_ENV_VARS < <(schema_vars "OPERATIONAL")

if (( ${#STRUCTURAL_ENV_VARS[@]} == 0 )); then
  STRUCTURAL_ENV_VARS=( NODE_ENV SERVER_MODE SERVER_AUTHORITY BROWSER_MODE )
fi
if (( ${#INFRASTRUCTURE_ENV_VARS[@]} == 0 )); then
  INFRASTRUCTURE_ENV_VARS=( SERVER_PORT CHROME_HOST CHROME_PORT CHROME_PROXY_PORT CHROME_PROXY_BIND HOST )
fi
if (( ${#OPERATIONAL_ENV_VARS[@]} == 0 )); then
  OPERATIONAL_ENV_VARS=( \
    BROWSER_POOL_SIZE ALLOCATION_STRATEGY HEALTH_CHECK_INTERVAL ALLOW_DEGRADED_MODE \
    AUTO_RETRY_CHROME MAX_AUTO_RETRIES MAX_CONNECTION_ATTEMPTS CONNECTION_TIMEOUT \
    LOG_LEVEL NERV_BUFFER_SIZE NERV_TELEMETRY NERV_INTEGRATION WS_IDLE_TIMEOUT_MS \
    RAG_DB_DIR RAG_INDEX_DIR \
  )
fi

readonly STRUCTURAL_ENV_VARS INFRASTRUCTURE_ENV_VARS OPERATIONAL_ENV_VARS

FEATURE_FLAG_ENV_VARS=( MOCK_CHROME PUPPETEER_LOCAL_LAUNCH_DISABLED FACTORY_VALIDATE_BOOT )
readonly FEATURE_FLAG_ENV_VARS

STRUCT_ERRORS=0
INFRA_ERRORS=0
INFRA_WARNINGS=0
OPER_WARNINGS=0
FLAG_INFO=0

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
readonly INFRA_VALIDATION_MODE OPER_VALIDATION_MODE

# 3.6 Structural (fatal)
for var in "${STRUCTURAL_ENV_VARS[@]}"; do
  value="${!var:-}"
  if [[ -z "${value}" ]]; then
    error "ENV ESTRUTURAL AUSENTE (FATAL): ${var}"
    STRUCT_ERRORS=$((STRUCT_ERRORS + 1))
  else
    log "ENV estrutural OK: ${var}=${value}"
  fi
done

# 3.7 Infrastructure (fatal em prod; warning em dev/test)
for var in "${INFRASTRUCTURE_ENV_VARS[@]}"; do
  value="${!var:-}"
  if [[ -z "${value}" ]]; then
    if [[ "${INFRA_VALIDATION_MODE}" == "FATAL" ]]; then
      error "ENV infraestrutura ausente (FATAL): ${var}"
      INFRA_ERRORS=$((INFRA_ERRORS + 1))
    else
      warn "ENV infraestrutura ausente (${INFRA_VALIDATION_MODE}): ${var}"
      INFRA_WARNINGS=$((INFRA_WARNINGS + 1))
    fi
  else
    log "ENV infraestrutura OK: ${var}=${value}"
  fi
done

# 3.8 NODE_ENV semântico (não-fatal)
if [[ -n "${NODE_ENV:-}" ]]; then
  case "${NODE_ENV}" in
    development|test|production) log "NODE_ENV semântico válido: ${NODE_ENV}" ;;
    *) warn "NODE_ENV fora do conjunto canônico: '${NODE_ENV}' (development|test|production)" ;;
  esac
fi

# 3.9 Operational (contextual)
for var in "${OPERATIONAL_ENV_VARS[@]}"; do
  value="${!var:-}"
  if [[ -z "${value}" ]]; then
    if [[ "${OPER_VALIDATION_MODE}" == "WARNING" ]]; then
      warn "ENV operacional ausente: ${var} (modo WARNING em NODE_ENV=${NODE_ENV:-development})"
      OPER_WARNINGS=$((OPER_WARNINGS + 1))
    else
      log "ENV operacional ausente (INFO): ${var}"
    fi
  else
    log "ENV operacional detectada: ${var}=${value}"
  fi
done

# 3.10 Feature flags (info)
for var in "${FEATURE_FLAG_ENV_VARS[@]}"; do
  value="${!var:-}"
  if [[ -n "${value}" ]]; then
    log "Feature flag detectado: ${var}=${value}"
    FLAG_INFO=$((FLAG_INFO + 1))
  fi
done

_is_port() {
  local p="${1:-}"
  [[ "${p}" =~ ^[0-9]+$ ]] && (( p >= 1024 && p <= 65535 ))
}

for p in SERVER_PORT CHROME_PORT CHROME_PROXY_PORT; do
  val="${!p:-}"
  if [[ -n "${val}" ]] && ! _is_port "${val}"; then
    warn "ENV porta inválida: ${p}='${val}' (1024-65535)"
  fi
done

# conflito lógico de portas (se todas existirem)
if [[ -n "${SERVER_PORT:-}" && -n "${CHROME_PORT:-}" && -n "${CHROME_PROXY_PORT:-}" ]]; then
  if [[ "${SERVER_PORT}" == "${CHROME_PORT}" || "${SERVER_PORT}" == "${CHROME_PROXY_PORT}" || "${CHROME_PORT}" == "${CHROME_PROXY_PORT}" ]]; then
    error "ENV CRÍTICO: conflito lógico de portas"
    error "→ SERVER_PORT=${SERVER_PORT}"
    error "→ CHROME_PORT=${CHROME_PORT}"
    error "→ CHROME_PROXY_PORT=${CHROME_PROXY_PORT}"
    STRUCT_ERRORS=$((STRUCT_ERRORS + 1))
  fi
fi

log "Validando dependências semânticas..."

# BROWSER_MODE=wsEndpoint → CHROME_PROXY_PORT + CHROME_PORT + CHROME_HOST
if [[ "${BROWSER_MODE:-}" == "wsEndpoint" ]]; then
  for v in CHROME_PROXY_PORT CHROME_PORT CHROME_HOST; do
    if [[ -z "${!v:-}" ]]; then
      error "DEPENDÊNCIA AUSENTE: BROWSER_MODE=wsEndpoint requer ${v}"
      STRUCT_ERRORS=$((STRUCT_ERRORS + 1))
    fi
  done
  (( STRUCT_ERRORS == 0 )) && log "✓ Dependências de BROWSER_MODE=wsEndpoint satisfeitas"
fi

if [[ "${MOCK_CHROME:-0}" == "1" ]]; then
  warn "MOCK_CHROME=1 ativo: Browser real não será usado (não use em produção)"
fi

if [[ "${NODE_ENV:-}" == "production" && "${ALLOW_DEGRADED_MODE:-false}" == "true" ]]; then
  error "INCONSISTÊNCIA: ALLOW_DEGRADED_MODE=true não permitido em production"
  STRUCT_ERRORS=$((STRUCT_ERRORS + 1))
fi

TOTAL_FATAL_ERRORS=$((STRUCT_ERRORS + INFRA_ERRORS))
if (( TOTAL_FATAL_ERRORS > 0 )); then
  error "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  error "VALIDAÇÃO ENV FALHOU (${TOTAL_FATAL_ERRORS} erro[s] fatal[is])"
  error "→ Estruturais : ${STRUCT_ERRORS}"
  error "→ Infraestrutura : ${INFRA_ERRORS}"
  error "→ Infra warnings : ${INFRA_WARNINGS}"
  error "Referência: .devcontainer/ENV_ANALYSIS_V6.md"
  error "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  exit 1
fi

(( INFRA_WARNINGS > 0 )) && warn "Validação ENV: ${INFRA_WARNINGS} warning(s) de infraestrutura (aceitável em ${NODE_ENV:-development})"
(( OPER_WARNINGS > 0 )) && warn "Validação ENV: ${OPER_WARNINGS} warning(s) operacional(is) (aceitável em bootstrap)"
(( FLAG_INFO > 0 )) && log "Feature flags detectados: ${FLAG_INFO}"

log "✓ Validação ENV concluída com sucesso (modelo estratificado v6.0)"

# =============================================================================
# SECTION 4 — Gatekeeper (Idempotência + Modos + Persistência)
# =============================================================================

STATE_FILE="${DEVCONTAINER_DIR}/.initialized"
readonly STATE_FILE

ENABLE_STATE_FILE_VAL="${ENABLE_STATE_FILE:-true}"
case "${ENABLE_STATE_FILE_VAL}" in
  true)  SKIP_STATE_FILE="false"; log "Gatekeeper: Persistência de estado ATIVADA (ENABLE_STATE_FILE=true)" ;;
  false) SKIP_STATE_FILE="true";  log "Gatekeeper: Persistência de estado DESATIVADA (ENABLE_STATE_FILE=false)" ;;
  *)     SKIP_STATE_FILE="false"; warn "Gatekeeper: ENABLE_STATE_FILE inválido ('${ENABLE_STATE_FILE_VAL}'); assumindo true" ;;
esac
readonly SKIP_STATE_FILE

REEXECUTE_POST_CREATE_VAL="${REEXECUTE_POST_CREATE:-false}"
FORCE_REEXECUTION="false"
[[ "${REEXECUTE_POST_CREATE_VAL}" == "true" ]] && FORCE_REEXECUTION="true"
readonly FORCE_REEXECUTION

# estado impossível: ambos markers
if [[ -f "${COMPLETED_MARKER}" && -f "${IN_PROGRESS_MARKER}" ]]; then
  warn "Gatekeeper: Estado inconsistente (COMPLETED + IN_PROGRESS). Limpando IN_PROGRESS."
  rm -f "${IN_PROGRESS_MARKER}" 2>/dev/null || true
fi

# determinar modo
RUNTIME_MODE="bootstrap"
if [[ "${SKIP_STATE_FILE}" == "true" ]]; then
  RUNTIME_MODE="stateless"
elif [[ -f "${COMPLETED_MARKER}" && "${FORCE_REEXECUTION}" != "true" ]]; then
  RUNTIME_MODE="reentry"
elif [[ -f "${IN_PROGRESS_MARKER}" ]]; then
  RUNTIME_MODE="replay"
elif [[ -f "${STATE_FILE}" && -s "${STATE_FILE}" && "${FORCE_REEXECUTION}" == "true" ]]; then
  RUNTIME_MODE="replay"
else
  RUNTIME_MODE="bootstrap"
fi
readonly RUNTIME_MODE

log "Gatekeeper: Modo operacional efetivo = ${RUNTIME_MODE}"

if [[ "${RUNTIME_MODE}" == "reentry" ]]; then
  log "Gatekeeper: Execução abortada para preservar idempotência por container (reentry)."
  exit 0
fi

if [[ "${RUNTIME_MODE}" == "replay" ]]; then
  warn ""
  warn "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  warn "🔄 RECOVERY MODE ATIVADO"
  warn "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  warn "Gatekeeper: Reexecução estrutural autorizada (replay)."
  warn "Marker: ${IN_PROGRESS_MARKER}"
  warn "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  warn ""
fi

# início da transação (garantir marker)
touch "${IN_PROGRESS_MARKER}" 2>/dev/null || true
log "Gatekeeper: Execução marcada como IN_PROGRESS (${IN_PROGRESS_MARKER})"

log "Inicialização estrutural autorizada."
log "Simbiose v${SCRIPT_VERSION} | Hash=${SCRIPT_HASH:0:8}"
log "Modo de execução: ${RUNTIME_MODE}"
log "Identidade: ${CURRENT_USER} (UID:${CURRENT_UID})"
log "Paths: HOME=${HOME_DIR} | PROJECT_ROOT=${PROJECT_ROOT}"

# =============================================================================
# SECTION 5 — Handshake (audit-only)
# =============================================================================
log "Realizando auditoria de estrutura do projeto (Handshake)..."

STRUCT_GIT_DIR="${PROJECT_ROOT}/.git"
STRUCT_NODE_MANIFEST="${PROJECT_ROOT}/package.json"
STRUCT_MAKEFILE="${PROJECT_ROOT}/Makefile"
readonly STRUCT_GIT_DIR STRUCT_NODE_MANIFEST STRUCT_MAKEFILE

STRUCT_STATUS="OK"
STRUCT_WARNINGS=()

if [[ -d "${STRUCT_GIT_DIR}" ]]; then
  log "Handshake: Git detectado (.git/)"
else
  warn "Handshake: Git NÃO detectado. Workspace pode não ser a raiz do projeto."
  STRUCT_STATUS="DEGRADED"
  STRUCT_WARNINGS+=( "git" )
fi

if [[ -f "${STRUCT_NODE_MANIFEST}" ]]; then
  log "Handshake: package.json detectado"
else
  warn "Handshake: package.json ausente. Toolchain Node pode não estar inicializada."
  STRUCT_STATUS="DEGRADED"
  STRUCT_WARNINGS+=( "node" )
fi

if [[ -f "${STRUCT_MAKEFILE}" ]]; then
  log "Handshake: Makefile detectado"
else
  warn "Handshake: Makefile ausente. Governança de execução indisponível."
  STRUCT_STATUS="DEGRADED"
  STRUCT_WARNINGS+=( "makefile" )
fi

log "Handshake Summary: STATUS=${STRUCT_STATUS} | missing=$(IFS=,; echo "${STRUCT_WARNINGS[*]:-none}")"

# =============================================================================
# SECTION 6 — Volumes (audit-only; críticos abortam)
# =============================================================================
log "Validando integridade estrutural dos volumes (audit-only)..."

VOLUME_DIRS=(
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
  "${USER_HOME}/.ssh"
  "${USER_HOME}/.gnupg"
  "${USER_HOME}/.vscode-server"
  "${USER_HOME}-history"
)
readonly VOLUME_DIRS

CRITICAL_VOLUMES=(
  "${USER_HOME}/.config"
  "${USER_HOME}/.claude"
  "${USER_HOME}/.local/state"
)
readonly CRITICAL_VOLUMES

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
    is_critical="false"
    for crit in "${CRITICAL_VOLUMES[@]}"; do
      [[ "${dir}" == "${crit}" ]] && is_critical="true"
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
# SECTION 7 — SSH (observacional)
# =============================================================================
log "Avaliando capacidade SSH (observacional)..."

SSH_CONTRACT_VERSION="1.6"
SSH_CONTRACT_STATUS="absent"
readonly SSH_CONTRACT_VERSION

if [[ -z "${SSH_AUTH_SOCK:-}" ]]; then
  SSH_CONTRACT_STATUS="absent"
  log "SSH: Não solicitado (SSH_AUTH_SOCK ausente)."
else
  if [[ -S "${SSH_AUTH_SOCK}" ]]; then
    SSH_CONTRACT_STATUS="valid"
    log "SSH: Socket válido observado: ${SSH_AUTH_SOCK}"
  elif [[ -e "${SSH_AUTH_SOCK}" ]]; then
    SSH_CONTRACT_STATUS="inconsistent"
    warn "SSH: SSH_AUTH_SOCK existe, mas NÃO é socket: ${SSH_AUTH_SOCK}"
  else
    SSH_CONTRACT_STATUS="present"
    warn "SSH: SSH_AUTH_SOCK definido, mas path não existe (transitório): ${SSH_AUTH_SOCK}"
  fi
fi

export SSH_CONTRACT_VERSION SSH_CONTRACT_STATUS

SSH_SOCKET_AVAILABLE="false"
[[ "${SSH_CONTRACT_STATUS}" == "valid" ]] && SSH_SOCKET_AVAILABLE="true"
SSH_REQUESTED="false"
[[ "${SSH_CONTRACT_STATUS}" != "absent" ]] && SSH_REQUESTED="true"
export SSH_SOCKET_AVAILABLE SSH_REQUESTED

log "SSH: status=${SSH_CONTRACT_STATUS} (requested=${SSH_REQUESTED}, usable=${SSH_SOCKET_AVAILABLE})"

# =============================================================================
# SECTION 8 — Persistência de histórico (UX)
# =============================================================================
log "Persistindo histórico do bash (UX-only)..."

HISTORY_VOL="${USER_HOME}-history"
HISTORY_FILE="${HOME_DIR}/.bash_history"
HISTORY_TARGET="${HISTORY_VOL}/.bash_history"
readonly HISTORY_VOL HISTORY_FILE HISTORY_TARGET

HISTORY_VOLUME_READY="false"
if [[ ! -d "${HISTORY_VOL}" ]]; then
  warn "Histórico: Volume não detectado em ${HISTORY_VOL}. Sem persistência."
elif [[ ! -w "${HISTORY_VOL}" ]]; then
  warn "Histórico: Volume ${HISTORY_VOL} não é gravável. Persistência desativada."
else
  HISTORY_VOLUME_READY="true"
fi

if [[ "${HISTORY_VOLUME_READY}" == "true" ]]; then
  if [[ ! -f "${HISTORY_TARGET}" ]]; then
    log "Histórico: inicializando ${HISTORY_TARGET}"
    touch "${HISTORY_TARGET}" 2>/dev/null || { warn "Histórico: falha ao criar target; desativando"; HISTORY_VOLUME_READY="false"; }
  fi
fi

if [[ "${HISTORY_VOLUME_READY}" == "true" ]]; then
  if ln -sfn "${HISTORY_TARGET}" "${HISTORY_FILE}"; then
    log "Histórico: symlink OK → ${HISTORY_FILE} -> ${HISTORY_TARGET}"
  else
    warn "Histórico: falha ao criar symlink; histórico pode não persistir"
  fi
fi

# =============================================================================
# SECTION 9 — NSS wrapper (instrumental, runtime-only em /tmp)
# =============================================================================
log "Configurando Gatekeeper NSS (Identidade Dinâmica Instrumental)..."

if ! check_nss_library; then
  error "NSS: dependência libnss_wrapper ausente; abortando"
  exit 1
fi

NSS_BASE_DIR="${DEVCONTAINER_NSS_DIR:-/tmp/devcontainer-nss}"
NSS_PASSWD_FILE="${NSS_BASE_DIR}/passwd"
NSS_GROUP_FILE="${NSS_BASE_DIR}/group"
readonly NSS_BASE_DIR NSS_PASSWD_FILE NSS_GROUP_FILE

ensure_dir "${NSS_BASE_DIR}"
chmod 700 "${NSS_BASE_DIR}" 2>/dev/null || true
[[ -w "${NSS_BASE_DIR}" ]] || { error "NSS: ${NSS_BASE_DIR} não é gravável"; exit 1; }

HOME_DIR_EFF="${HOME_DIR:-${HOME:-/home/${CURRENT_USER}}}"
[[ "${CURRENT_UID}" != "unknown" && "${CURRENT_GID}" != "unknown" ]] || { error "NSS: UID/GID indisponível"; exit 1; }

cat > "${NSS_PASSWD_FILE}.tmp" <<PASSWD_BLOCK
${CURRENT_USER}:x:${CURRENT_UID}:${CURRENT_GID}:${CURRENT_USER} user:${HOME_DIR_EFF}:/bin/bash
PASSWD_BLOCK
mv "${NSS_PASSWD_FILE}.tmp" "${NSS_PASSWD_FILE}"
safe_chown "${CURRENT_UID}:${CURRENT_GID}" "${NSS_PASSWD_FILE}"
chmod 644 "${NSS_PASSWD_FILE}" 2>/dev/null || true

{
  # grupos reais (best-effort)
  if command -v id >/dev/null 2>&1 && command -v getent >/dev/null 2>&1 && command -v awk >/dev/null 2>&1; then
    id -G 2>/dev/null \
      | xargs -n1 getent group 2>/dev/null \
      | awk -F: 'NF>=3 {print $1 ":" $2 ":" $3 ":"}' \
      | awk '!seen[$0]++' \
      || true
  fi

  # docker group injection (observacional)
  if [[ -S /var/run/docker.sock ]] && command -v stat >/dev/null 2>&1; then
    sockgid="$(stat -c '%g' /var/run/docker.sock 2>/dev/null || true)"
    [[ -n "${sockgid:-}" ]] && echo "docker:x:${sockgid}:"
  elif command -v getent >/dev/null 2>&1 && getent group docker >/dev/null 2>&1; then
    dgid="$(getent group docker | cut -d: -f3)"
    [[ -n "${dgid:-}" ]] && echo "docker:x:${dgid}:"
  fi
} > "${NSS_GROUP_FILE}.tmp"

# sanitização final
if command -v awk >/dev/null 2>&1; then
  awk -F: 'NF==4 {print}' "${NSS_GROUP_FILE}.tmp" 2>/dev/null | awk '!seen[$0]++' > "${NSS_GROUP_FILE}.tmp.s" || true
  mv -f "${NSS_GROUP_FILE}.tmp.s" "${NSS_GROUP_FILE}.tmp" 2>/dev/null || true
fi

mv "${NSS_GROUP_FILE}.tmp" "${NSS_GROUP_FILE}"
safe_chown "${CURRENT_UID}:${CURRENT_GID}" "${NSS_GROUP_FILE}"
chmod 644 "${NSS_GROUP_FILE}" 2>/dev/null || true

# validação sintática
_validate_nss_files() {
  local pass="${1:-}" grp="${2:-}"
  [[ -s "${pass}" && -s "${grp}" ]] || return 20
  if command -v grep >/dev/null 2>&1; then
    grep -q $'\r' "${pass}" "${grp}" 2>/dev/null && return 21
    grep -qE '\$\{[A-Za-z_][A-Za-z0-9_]*\}' "${pass}" "${grp}" 2>/dev/null && return 22
  fi
  if command -v awk >/dev/null 2>&1; then
    awk -F: 'NF!=7{exit 1} END{exit 0}' "${pass}" 2>/dev/null || return 23
    awk -F: 'NF!=4{exit 1} END{exit 0}' "${grp}" 2>/dev/null || return 24
  fi
  return 0
}

if ! _validate_nss_files "${NSS_PASSWD_FILE}" "${NSS_GROUP_FILE}"; then
  rc=$?
  error "NSS: artefatos inválidos (rc=${rc})"
  error "→ passwd=${NSS_PASSWD_FILE}"
  error "→ group=${NSS_GROUP_FILE}"
  warn "Dump passwd (5 primeiras linhas):"; sed -n '1,5p' "${NSS_PASSWD_FILE}" 2>/dev/null || true
  warn "Dump group (10 primeiras linhas):"; sed -n '1,10p' "${NSS_GROUP_FILE}" 2>/dev/null || true
  exit 1
fi

# ativação via profile (best-effort)
if [[ -f /etc/profile.d/10-gatekeeper-nss.sh ]]; then
  # shellcheck disable=SC1091
  . /etc/profile.d/10-gatekeeper-nss.sh >/dev/null 2>&1 || true
else
  warn "NSS: /etc/profile.d/10-gatekeeper-nss.sh ausente; ativação automática não aplicada"
fi

if [[ -n "${NSS_WRAPPER_PASSWD:-}" && -n "${NSS_WRAPPER_GROUP:-}" ]]; then
  log "NSS: identidade dinâmica ativa (NSS_WRAPPER_* exportados)"
else
  warn "NSS: artefatos OK, mas NSS_WRAPPER_* não definidos (ver profile/lib)"
fi

# =============================================================================
# SECTION 10 — Git base config (opcional, defensivo)
# =============================================================================
log "Auditando configuração base do Git (defensivo)..."

GIT_BASE_APPLICABLE="true"
command -v git >/dev/null 2>&1 || { warn "Git não localizado; desativando"; GIT_BASE_APPLICABLE="false"; }

BASE_GITCONFIG="${DEVCONTAINER_DIR}/config/.gitconfig"
TARGET_GITCONFIG="${HOME_DIR}/.gitconfig"
readonly BASE_GITCONFIG TARGET_GITCONFIG

if [[ "${GIT_BASE_APPLICABLE}" == "true" && ! -f "${BASE_GITCONFIG}" ]]; then
  log "Git: template base não encontrado (${BASE_GITCONFIG})."
  GIT_BASE_APPLICABLE="false"
fi
if [[ "${GIT_BASE_APPLICABLE}" == "true" && -f "${TARGET_GITCONFIG}" ]]; then
  log "Git: ~/.gitconfig já existe; preservando."
  GIT_BASE_APPLICABLE="false"
fi

if [[ "${GIT_BASE_APPLICABLE}" == "true" ]]; then
  log "Git: aplicando template base (one-shot)..."
  if cp "${BASE_GITCONFIG}" "${TARGET_GITCONFIG}" 2>/dev/null; then
    chmod 644 "${TARGET_GITCONFIG}" 2>/dev/null || true
    log "Git: template aplicado em ~/.gitconfig"
  else
    warn "Git: falha ao copiar template; prosseguindo"
  fi
else
  log "Git: configuração base não aplicável."
fi

# =============================================================================
# SECTION 11 — Deep Audit (observacional)
# =============================================================================
log "Iniciando Diagnóstico Exaustivo (Deep Audit)..."

NET_STATUS="SKIP"
if command -v curl >/dev/null 2>&1; then
  if curl -Is --connect-timeout 2 --max-time 2 google.com >/dev/null 2>&1; then
    NET_STATUS="ONLINE"
  else
    NET_STATUS="OFFLINE"
  fi
fi

{
  echo -e "\n=== [DEEP AUDIT REPORT - $(date -Is 2>/dev/null || echo unknown)] ==="
  echo "Audit Mode: OBSERVATIONAL (non-fatal)"

  echo -e "\n[1. Volume Metadata & Ownership Registry]"
  for dir in "${VOLUME_DIRS[@]}"; do
    if [[ -d "${dir}" ]] && command -v stat >/dev/null 2>&1; then
      stat -c "PATH: %n | PERM: %a | OWNER: %U(%u) | GROUP: %G(%g)" "${dir}" 2>/dev/null \
        || echo "PATH: ${dir} | Metadata check failed."
    else
      echo "PATH: ${dir} | STATUS: $( [[ -d "${dir}" ]] && echo OK || echo NOT_FOUND )"
    fi
  done

  audit_mounts "${PROJECT_ROOT}" "${CURRENT_USER}"

  echo -e "\n[3. System Resource Snapshot]"
  df -h / 2>/dev/null | tail -1 | awk '{printf "Disk Usage: %s (%s available)\n", $5, $4}' || echo "Disk usage unavailable."
  df -i / 2>/dev/null | tail -1 | awk '{printf "Inode Usage: %s\n", $5}' || echo "Inode usage unavailable."
  [[ -d "/dev/shm" ]] && df -h /dev/shm 2>/dev/null | tail -1 | awk '{printf "Shared Memory (/dev/shm): %s free\n", $4}' || true
  echo "Umask: $(umask 2>/dev/null || echo unknown)"

  echo -e "\n[4. Network & Identity Check]"
  echo "Network Status (diagnostic): ${NET_STATUS}"
  echo "Whoami: $(whoami 2>/dev/null || echo unknown)"
  echo "UID: $(id -u 2>/dev/null || echo unknown)"
  echo "Groups: $(id -Gn 2>/dev/null | tr ' ' ',' || echo unknown)"

  echo -e "\n[5. SSH Agent Diagnostic]"
  if [[ -z "${SSH_AUTH_SOCK:-}" ]]; then
    echo "SSH: DISABLED (SSH_AUTH_SOCK not set)"
  else
    echo "SSH_AUTH_SOCK=${SSH_AUTH_SOCK}"
    [[ -S "${SSH_AUTH_SOCK}" ]] && echo "SSH Agent Socket: VALID" || echo "SSH Agent Socket: INVALID"
  fi

  echo -e "\n[6. Runtime & Execution Context]"
  echo "Node Path: $(command -v node 2>/dev/null || echo not-found)"
  echo "Node Version: $(node -v 2>/dev/null || echo N/A)"
  echo "=========================================="
} >> "${LOG_FILE}" 2>/dev/null || true

log "Relatório forense anexado ao log físico."

# =============================================================================
# SECTION 12 — Manifesto persistente (opcional; atômico; sem segredos)
# =============================================================================
log "Consolidando manifesto de estado..."

STATE_SWAP="${STATE_FILE}.tmp"
ensure_dir "$(dirname "${STATE_FILE}")"

# calcula duração parcial até aqui (para manifesto)
BOOT_NOW="$(date +%s 2>/dev/null || echo 0)"
BOOT_DURATION_SO_FAR=$(( BOOT_NOW - BOOT_START_TIME ))

if [[ "${SKIP_STATE_FILE}" == "true" ]]; then
  log "Persistência desativada; manifesto não será gravado."
else
  {
    printf '%s\n' \
"# =============================================================================" \
"# SIMBIOSE — STATE MANIFESTO" \
"# Version: ${SCRIPT_VERSION}" \
"# =============================================================================" \
"" \
"initialized_at=$(date -Is 2>/dev/null || echo unknown)" \
"script_name=${SCRIPT_NAME}" \
"script_version=${SCRIPT_VERSION}" \
"script_hash=${SCRIPT_HASH:0:8}" \
"total_setup_seconds=${BOOT_DURATION_SO_FAR}" \
"" \
"user=${CURRENT_USER}" \
"uid=${CURRENT_UID}" \
"gid=${CURRENT_GID}" \
"groups=$(id -Gn 2>/dev/null | tr ' ' ',' || echo unknown)" \
"nss_profile=EXTENDED" \
"" \
"home=${HOME_DIR}" \
"project_root=${PROJECT_ROOT}" \
"devcontainer_dir=${DEVCONTAINER_DIR}" \
"log_path=${LOG_FILE}" \
"" \
"system_arch=$(uname -m 2>/dev/null || echo unknown)" \
"node_version=$(node -v 2>/dev/null || echo N/A)" \
"network_status=${NET_STATUS:-unknown}" \
"" \
"ssh_requested=${SSH_REQUESTED}" \
"ssh_socket_available=${SSH_SOCKET_AVAILABLE}" \
"ssh_contract_status=${SSH_CONTRACT_STATUS}" \
"ssh_contract_version=${SSH_CONTRACT_VERSION}" \
"" \
"status=ready" \
"integrity=canonical"
  } > "${STATE_SWAP}"

  mv -f "${STATE_SWAP}" "${STATE_FILE}"
  chmod 444 "${STATE_FILE}" 2>/dev/null || true
  log "✅ Manifesto persistido em ${STATE_FILE}"
fi

# =============================================================================
# SECTION 13 — Healthcheck final (informativo) + Commit transacional
# =============================================================================
log "Executando healthcheck final (informativo)..."

BOOT_END_TIME="$(date +%s 2>/dev/null || echo 0)"
BOOT_DURATION=$(( BOOT_END_TIME - BOOT_START_TIME ))

CHROME_PROXY_STATUS="⏸️  não verificado"
CHROME_PROXY_NOTE=""
CHROME_BACKEND_STATUS="⏸️  não verificado"
CHROME_BACKEND_NOTE=""

if [[ "${BROWSER_MODE:-}" == "wsEndpoint" ]]; then
  CHROME_HOST_EFF="${CHROME_HOST:-host.docker.internal}"
  CHROME_PORT_EFF="${CHROME_PORT:-9225}"
  CHROME_PROXY_PORT_EFF="${CHROME_PROXY_PORT:-9224}"

  HAS_TIMEOUT="false"
  HAS_DEV_TCP="false"
  command -v timeout >/dev/null 2>&1 && HAS_TIMEOUT="true"
  ( : >/dev/tcp/127.0.0.1/1 ) 2>/dev/null && HAS_DEV_TCP="true"

  if [[ "${HAS_TIMEOUT}" == "true" && "${HAS_DEV_TCP}" == "true" ]]; then
    if timeout 3 bash -c "cat < /dev/null > /dev/tcp/${CHROME_HOST_EFF}/${CHROME_PORT_EFF}" 2>/dev/null; then
      CHROME_BACKEND_STATUS="✅ respondendo"
      CHROME_BACKEND_NOTE="Chrome Windows acessível em ${CHROME_HOST_EFF}:${CHROME_PORT_EFF} (OK, embora não esperado no boot)"
    else
      CHROME_BACKEND_STATUS="⏸️  aguardando demanda"
      CHROME_BACKEND_NOTE="Será iniciado quando necessário (START-CHROME-SIMPLE.bat)"
    fi

    if timeout 2 bash -c "cat < /dev/null > /dev/tcp/localhost/${CHROME_PROXY_PORT_EFF}" 2>/dev/null; then
      CHROME_PROXY_STATUS="✅ respondendo"
      CHROME_PROXY_NOTE="Proxy acessível em localhost:${CHROME_PROXY_PORT_EFF} (OK, embora não esperado no boot)"
    else
      CHROME_PROXY_STATUS="⏸️  aguardando demanda"
      CHROME_PROXY_NOTE="Será iniciado automaticamente quando necessário"
    fi
  else
    CHROME_BACKEND_STATUS="⏸️  diagnóstico indisponível"
    CHROME_BACKEND_NOTE="timeout ou /dev/tcp indisponível"
    CHROME_PROXY_STATUS="⏸️  diagnóstico indisponível"
    CHROME_PROXY_NOTE="timeout ou /dev/tcp indisponível"
  fi
fi

echo ""
printf "╔════════════════════════════════════════════════════════════╗\n"
printf "║  ✅ DevContainer Inicializado com Sucesso (v%-14s) ║\n" "${SCRIPT_VERSION}"
printf "╚════════════════════════════════════════════════════════════╝\n"
echo ""

echo "📊 Checklist:"
echo "  ✅ Identidade validada (${CURRENT_USER}, UID ${CURRENT_UID})"
echo "  ✅ ENV validado (${#STRUCTURAL_ENV_VARS[@]} críticas)"
echo "  ✅ Volumes auditados (${#VOLUME_DIRS[@]})"
echo "  ✅ Histórico bash (UX)"
echo "  ✅ NSS wrapper (instrumental)"
echo "  ${CHROME_BACKEND_STATUS} Chrome backend (Windows:${CHROME_PORT:-9225})"
[[ -n "${CHROME_BACKEND_NOTE}" ]] && echo "     └─ ${CHROME_BACKEND_NOTE}"
echo "  ${CHROME_PROXY_STATUS} Proxy server (container:${CHROME_PROXY_PORT:-9224})"
[[ -n "${CHROME_PROXY_NOTE}" ]] && echo "     └─ ${CHROME_PROXY_NOTE}"
echo ""
echo "⏱️  Tempo total: ${BOOT_DURATION}s"
echo ""
echo "📚 Próximos passos:"
echo "  • Iniciar sistema: make start"
echo "  • Ver logs: make logs-follow"
echo "  • Log físico: ${LOG_FILE}"
echo ""

# Sanidade: marker deve existir
if [[ ! -f "${IN_PROGRESS_MARKER}" ]]; then
  error "INCONSISTÊNCIA: IN_PROGRESS_MARKER ausente no commit final"
  exit 1
fi

if ! validate_ld_preload "${LD_PRELOAD:-}"; then
  warn "LD_PRELOAD parece inválido; NSS wrapper pode não carregar"
fi

log "Finalizando transação (commit)..."
rm -f "${IN_PROGRESS_MARKER}" 2>/dev/null || true
touch "${COMPLETED_MARKER}" 2>/dev/null || true
log "Gatekeeper: Execução concluída com sucesso (COMPLETED)."

echo ""
echo "╔════════════════════════════════════════════════════════════╗"
echo "║  ✅ POST-CREATE CONCLUÍDO COM SUCESSO                      ║"
echo "╚════════════════════════════════════════════════════════════╝"
echo ""
echo "📝 Log completo:"
echo "   ${LOG_FILE}"
echo ""
